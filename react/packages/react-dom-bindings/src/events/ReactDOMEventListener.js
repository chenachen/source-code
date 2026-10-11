/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {EventPriority} from 'react-reconciler/src/ReactEventPriorities';
import type {AnyNativeEvent} from '../events/PluginModuleType';
import type {Fiber, FiberRoot} from 'react-reconciler/src/ReactInternalTypes';
import type {
  Container,
  ActivityInstance,
  SuspenseInstance,
} from '../client/ReactFiberConfigDOM';
import type {DOMEventName} from '../events/DOMEventNames';

import {
  isDiscreteEventThatRequiresHydration,
  clearIfContinuousEvent,
  queueIfContinuousEvent,
} from './ReactDOMEventReplaying';
import {attemptSynchronousHydration} from 'react-reconciler/src/ReactFiberReconciler';
import {
  getNearestMountedFiber,
  getContainerFromFiber,
  getActivityInstanceFromFiber,
  getSuspenseInstanceFromFiber,
} from 'react-reconciler/src/ReactFiberTreeReflection';
import {
  HostRoot,
  ActivityComponent,
  SuspenseComponent,
} from 'react-reconciler/src/ReactWorkTags';
import {type EventSystemFlags, IS_CAPTURE_PHASE} from './EventSystemFlags';

import getEventTarget from './getEventTarget';
import {
  getInstanceFromNode,
  getClosestInstanceFromNode,
} from '../client/ReactDOMComponentTree';

import {dispatchEventForPluginEventSystem} from './DOMPluginEventSystem';
import {
  getCurrentUpdatePriority,
  setCurrentUpdatePriority,
} from '../client/ReactDOMUpdatePriority';

import {
  getCurrentPriorityLevel as getCurrentSchedulerPriorityLevel,
  IdlePriority as IdleSchedulerPriority,
  ImmediatePriority as ImmediateSchedulerPriority,
  LowPriority as LowSchedulerPriority,
  NormalPriority as NormalSchedulerPriority,
  UserBlockingPriority as UserBlockingSchedulerPriority,
} from 'react-reconciler/src/Scheduler';
import {
  DiscreteEventPriority,
  ContinuousEventPriority,
  DefaultEventPriority,
  IdleEventPriority,
} from 'react-reconciler/src/ReactEventPriorities';
import ReactSharedInternals from 'shared/ReactSharedInternals';
import {isRootDehydrated} from 'react-reconciler/src/ReactFiberShellHydration';

// TODO：确认这些函数是否可以停止导出。
let _enabled: boolean = true;

// FB 构建会导出该入口，供旧 FB layer 基础设施使用。
// 希望移除该兼容入口，但目前无法确认是否安全。
/** 切换事件派发总开关；HostConfig 在 DOM mutation 期间临时关闭它。 */
export function setEnabled(enabled: ?boolean): void {
  _enabled = !!enabled;
}

/** 读取事件派发总开关。 */
export function isEnabled(): boolean {
  return _enabled;
}

/** 绑定原生事件名、flags 和容器，返回不额外设置优先级的 dispatch wrapper。 */
export function createEventListenerWrapper(
  targetContainer: EventTarget,
  domEventName: DOMEventName,
  eventSystemFlags: EventSystemFlags,
): Function {
  return dispatchEvent.bind(
    null,
    domEventName,
    eventSystemFlags,
    targetContainer,
  );
}

/** 按事件类别选择离散、连续或普通 dispatch wrapper，再绑定 listener 的固定参数。 */
export function createEventListenerWrapperWithPriority(
  targetContainer: EventTarget,
  domEventName: DOMEventName,
  eventSystemFlags: EventSystemFlags,
): Function {
  const eventPriority = getEventPriority(domEventName);
  let listenerWrapper;
  switch (eventPriority) {
    case DiscreteEventPriority:
      listenerWrapper = dispatchDiscreteEvent;
      break;
    case ContinuousEventPriority:
      listenerWrapper = dispatchContinuousEvent;
      break;
    case DefaultEventPriority:
    default:
      listenerWrapper = dispatchEvent;
      break;
  }
  return listenerWrapper.bind(
    null,
    domEventName,
    eventSystemFlags,
    targetContainer,
  );
}

/** 暂时清空 Transition 并设置离散更新优先级；dispatch 后在 finally 还原上下文。 */
function dispatchDiscreteEvent(
  domEventName: DOMEventName,
  eventSystemFlags: EventSystemFlags,
  container: EventTarget,
  nativeEvent: AnyNativeEvent,
) {
  const prevTransition = ReactSharedInternals.T;
  ReactSharedInternals.T = null;
  const previousPriority = getCurrentUpdatePriority();
  try {
    setCurrentUpdatePriority(DiscreteEventPriority);
    dispatchEvent(domEventName, eventSystemFlags, container, nativeEvent);
  } finally {
    setCurrentUpdatePriority(previousPriority);
    ReactSharedInternals.T = prevTransition;
  }
}

/** 暂时清空 Transition 并设置连续更新优先级；dispatch 后在 finally 还原上下文。 */
function dispatchContinuousEvent(
  domEventName: DOMEventName,
  eventSystemFlags: EventSystemFlags,
  container: EventTarget,
  nativeEvent: AnyNativeEvent,
) {
  const prevTransition = ReactSharedInternals.T;
  ReactSharedInternals.T = null;
  const previousPriority = getCurrentUpdatePriority();
  try {
    setCurrentUpdatePriority(ContinuousEventPriority);
    dispatchEvent(domEventName, eventSystemFlags, container, nativeEvent);
  } finally {
    setCurrentUpdatePriority(previousPriority);
    ReactSharedInternals.T = prevTransition;
  }
}

/**
 * 原生监听器的公共派发入口：先定位尚未水合的根或 Suspense/Activity 标记。
 * 无阻塞时按当前 Fiber 提取插件事件，并清掉对应连续事件的旧记录。可重放的连续
 * 类别保存最新原生事件并停止传播；这个分类与更新优先级不是同一张表。
 * 需要水合的离散事件仅在 capture 阶段同步尝试：每次重新查 blocker，允许依次
 * 解开嵌套边界；同一 blocker 未前进则退出并停止传播，成功则派发原始事件。
 * 其余受阻事件以 null Fiber 进入插件系统，不在这里建立离散事件队列。
 * @param eventSystemFlags 当前原生监听器的 capture、非委托等派发方式。
 * @param targetContainer 安装该监听器的根、Portal 容器或 EventTarget。
 */
export function dispatchEvent(
  domEventName: DOMEventName,
  eventSystemFlags: EventSystemFlags,
  targetContainer: EventTarget,
  nativeEvent: AnyNativeEvent,
): void {
  if (!_enabled) {
    return;
  }

  let blockedOn = findInstanceBlockingEvent(nativeEvent);
  if (blockedOn === null) {
    dispatchEventForPluginEventSystem(
      domEventName,
      eventSystemFlags,
      nativeEvent,
      return_targetInst,
      targetContainer,
    );
    clearIfContinuousEvent(domEventName, nativeEvent);
    return;
  }

  if (
    queueIfContinuousEvent(
      blockedOn,
      domEventName,
      eventSystemFlags,
      targetContainer,
      nativeEvent,
    )
  ) {
    nativeEvent.stopPropagation();
    return;
  }
  // 只有事件未入队时才能清空，因为
  // 队列采用累积语义。
  clearIfContinuousEvent(domEventName, nativeEvent);

  if (
    eventSystemFlags & IS_CAPTURE_PHASE &&
    isDiscreteEventThatRequiresHydration(domEventName)
  ) {
    while (blockedOn !== null) {
      const fiber = getInstanceFromNode(blockedOn);
      if (fiber !== null) {
        attemptSynchronousHydration(fiber);
      }
      const nextBlockedOn = findInstanceBlockingEvent(nativeEvent);
      if (nextBlockedOn === null) {
        dispatchEventForPluginEventSystem(
          domEventName,
          eventSystemFlags,
          nativeEvent,
          return_targetInst,
          targetContainer,
        );
      }
      if (nextBlockedOn === blockedOn) {
        break;
      }
      blockedOn = nextBlockedOn;
    }
    if (blockedOn !== null) {
      nativeEvent.stopPropagation();
    }
    return;
  }

  // 该事件不可重放，因此仍会调用事件系统，但不提供 target，
  // 以便事件系统在需要时记录追踪信息。
  dispatchEventForPluginEventSystem(
    domEventName,
    eventSystemFlags,
    nativeEvent,
    null,
    targetContainer,
  );
}

/** 归一化原生 target，再返回阻塞 DOM 对象；可派发 Fiber 另写入 return_targetInst。 */
export function findInstanceBlockingEvent(
  nativeEvent: AnyNativeEvent,
): null | Container | SuspenseInstance | ActivityInstance {
  const nativeEventTarget = getEventTarget(nativeEvent);
  return findInstanceBlockingTarget(nativeEventTarget);
}

/** blocker 查询的伴随返回值；每次查询先清空，仅无阻塞且已提交的目标才能写入 Fiber。 */
export let return_targetInst: null | Fiber = null;

// 若事件受阻，返回 SuspenseInstance、ActivityInstance 或 Container。
// 上方 return_targetInst 字段在概念上也是返回值的一部分。
/** 清空 return_targetInst，检查最近 mounted Fiber；返回脱水根/边界 blocker，否则写入可派发的 target Fiber。 */
export function findInstanceBlockingTarget(
  targetNode: Node,
): null | Container | SuspenseInstance | ActivityInstance {
  // TODO：当 _enabled 为 false 时发出警告。

  return_targetInst = null;

  let targetInst = getClosestInstanceFromNode(targetNode);

  if (targetInst !== null) {
    const nearestMounted = getNearestMountedFiber(targetInst);
    if (nearestMounted === null) {
      // 该树已经卸载；不带 target 继续分发。
      targetInst = null;
    } else {
      const tag = nearestMounted.tag;
      if (tag === SuspenseComponent) {
        const instance = getSuspenseInstanceFromFiber(nearestMounted);
        if (instance !== null) {
          // 只返回 blocker；dispatchEvent 再按事件类别决定同步 hydration 或排队。
          return instance;
        }
        // 最近 mounted Fiber 是边界，但没有可用的脱水标记；不带 target 继续分发。
        // TODO：补充警告。
        targetInst = null;
      } else if (tag === ActivityComponent) {
        const instance = getActivityInstanceFromFiber(nearestMounted);
        if (instance !== null) {
          // 只返回 blocker；dispatchEvent 再按事件类别决定同步 hydration 或排队。
          return instance;
        }
        // 最近 mounted Fiber 是边界，但没有可用的脱水标记；不带 target 继续分发。
        // TODO：补充警告。
        targetInst = null;
      } else if (tag === HostRoot) {
        const root: FiberRoot = nearestMounted.stateNode;
        if (isRootDehydrated(root)) {
          // 根尚未完成 hydration，容器本身是需要等待的 blocker。
          return getContainerFromFiber(nearestMounted);
        }
        targetInst = null;
      } else if (nearestMounted !== targetInst) {
        // 若组件挂载提交前收到事件（例如 img onload），
        // 暂时忽略，即把它视作
        // 非 React 树上的事件。未来也可考虑把事件入队，
        // 待挂载后再分发。
        targetInst = null;
      }
    }
  }
  return_targetInst = targetInst;
  // 当前没有任何阻塞目标。
  return null;
}

/** 把原生事件映射为更新优先级；message 根据当前 Scheduler 上下文映射，其余未列出的事件取 Default。 */
export function getEventPriority(domEventName: DOMEventName): EventPriority {
  switch (domEventName) {
    // 以下事件由 SimpleEventPlugin 使用：
    case 'beforetoggle':
    case 'cancel':
    case 'click':
    case 'close':
    case 'contextmenu':
    case 'copy':
    case 'cut':
    case 'auxclick':
    case 'dblclick':
    case 'dragend':
    case 'dragstart':
    case 'drop':
    case 'focusin':
    case 'focusout':
    case 'input':
    case 'invalid':
    case 'keydown':
    case 'keypress':
    case 'keyup':
    case 'mousedown':
    case 'mouseup':
    case 'paste':
    case 'pause':
    case 'play':
    case 'pointercancel':
    case 'pointerdown':
    case 'pointerup':
    case 'ratechange':
    case 'reset':
    case 'seeked':
    case 'submit':
    case 'toggle':
    case 'touchcancel':
    case 'touchend':
    case 'touchstart':
    case 'volumechange':
    // 以下事件供 polyfill 使用，继续落入下一分支：
    case 'change':
    case 'selectionchange':
    case 'textInput':
    case 'compositionstart':
    case 'compositionend':
    case 'compositionupdate':
    // 仅 createEventHandle API 使用，继续落入下一分支：
    case 'beforeblur':
    case 'afterblur':
    // React 自身不使用，但用户代码可能使用；继续落入下一分支：
    case 'beforeinput':
    case 'blur':
    case 'fullscreenchange':
    case 'fullscreenerror':
    case 'focus':
    case 'hashchange':
    case 'popstate':
    case 'select':
    case 'selectstart':
      return DiscreteEventPriority;
    case 'drag':
    case 'dragenter':
    case 'dragexit':
    case 'dragleave':
    case 'dragover':
    case 'mousemove':
    case 'mouseout':
    case 'mouseover':
    case 'pointermove':
    case 'pointerout':
    case 'pointerover':
    case 'resize':
    case 'scroll':
    case 'touchmove':
    case 'wheel':
    // React 自身不使用，但用户代码可能使用；继续落入下一分支：
    case 'mouseenter':
    case 'mouseleave':
    case 'pointerenter':
    case 'pointerleave':
      return ContinuousEventPriority;
    case 'message': {
      // 当前可能位于 Scheduler callback 中。
      // 最终会改为检查
      // 原生 scheduler 的当前优先级。
      const schedulerPriority = getCurrentSchedulerPriorityLevel();
      switch (schedulerPriority) {
        case ImmediateSchedulerPriority:
          return DiscreteEventPriority;
        case UserBlockingSchedulerPriority:
          return ContinuousEventPriority;
        case NormalSchedulerPriority:
        case LowSchedulerPriority:
          // TODO：处理 LowSchedulerPriority，或许复用 hydration 的 lane。
          return DefaultEventPriority;
        case IdleSchedulerPriority:
          return IdleEventPriority;
        default:
          return DefaultEventPriority;
      }
    }
    default:
      return DefaultEventPriority;
  }
}
