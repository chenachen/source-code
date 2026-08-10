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
/** setEnabled 更新创建带优先级的原生 listener wrapper，解析阻塞 Fiber 并选择 dispatch/hydration 路径的模块状态或 DOM 状态；重复调用需保持队列顺序与恢复幂等性。 */
export function setEnabled(enabled: ?boolean): void {
  _enabled = !!enabled;
}

/** isEnabled 判断创建带优先级的原生 listener wrapper，解析阻塞 Fiber 并选择 dispatch/hydration 路径的前置条件；返回值用于在热路径提前跳过不适用分支。 */
export function isEnabled(): boolean {
  return _enabled;
}

/** createEventListenerWrapper 为创建带优先级的原生 listener wrapper，解析阻塞 Fiber 并选择 dispatch/hydration 路径创建封装对象；生成值保留原生事件身份并携带必要调度上下文。 */
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

/** createEventListenerWrapperWithPriority 为创建带优先级的原生 listener wrapper，解析阻塞 Fiber 并选择 dispatch/hydration 路径创建封装对象；生成值保留原生事件身份并携带必要调度上下文。 */
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

/** dispatchDiscreteEvent 推进创建带优先级的原生 listener wrapper，解析阻塞 Fiber 并选择 dispatch/hydration 路径的分发或重放状态机；阻塞时保留事件，解除后按原优先级继续。 */
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

/** dispatchContinuousEvent 推进创建带优先级的原生 listener wrapper，解析阻塞 Fiber 并选择 dispatch/hydration 路径的分发或重放状态机；阻塞时保留事件，解除后按原优先级继续。 */
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

/** dispatchEvent 推进创建带优先级的原生 listener wrapper，解析阻塞 Fiber 并选择 dispatch/hydration 路径的分发或重放状态机；阻塞时保留事件，解除后按原优先级继续。 */
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

/** findInstanceBlockingEvent 查询并返回创建带优先级的原生 listener wrapper，解析阻塞 Fiber 并选择 dispatch/hydration 路径所需状态；无匹配时使用 null/默认值而不修改事件队列。 */
export function findInstanceBlockingEvent(
  nativeEvent: AnyNativeEvent,
): null | Container | SuspenseInstance | ActivityInstance {
  const nativeEventTarget = getEventTarget(nativeEvent);
  return findInstanceBlockingTarget(nativeEventTarget);
}

export let return_targetInst: null | Fiber = null;

// 若事件受阻，返回 SuspenseInstance、ActivityInstance 或 Container。
// 上方 return_targetInst 字段在概念上也是返回值的一部分。
/** findInstanceBlockingTarget 查询并返回创建带优先级的原生 listener wrapper，解析阻塞 Fiber 并选择 dispatch/hydration 路径所需状态；无匹配时使用 null/默认值而不修改事件队列。 */
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
          // 把事件加入稍后重放的队列，并中止本轮分发，避免
          // 同一事件经过事件系统分发两次。
          // TODO：若这是队列中的首个离散事件，应为该边界调度更高
          // 优先级。
          return instance;
        }
        // 理论上不应进入此分支；虽然内部状态异常，但为避免阻塞
        // 整个系统，仍不带 target 分发事件。
        // TODO：补充警告。
        targetInst = null;
      } else if (tag === ActivityComponent) {
        const instance = getActivityInstanceFromFiber(nearestMounted);
        if (instance !== null) {
          // 把事件加入稍后重放的队列，并中止本轮分发，避免
          // 同一事件经过事件系统分发两次。
          // TODO：若这是队列中的首个离散事件，应为该边界调度更高
          // 优先级。
          return instance;
        }
        // 理论上不应进入此分支；虽然内部状态异常，但为避免阻塞
        // 整个系统，仍不带 target 分发事件。
        // TODO：补充警告。
        targetInst = null;
      } else if (tag === HostRoot) {
        const root: FiberRoot = nearestMounted.stateNode;
        if (isRootDehydrated(root)) {
          // 若重放期间发生此情况，说明状态异常，并可能阻塞
          // 整个系统。
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

/** getEventPriority 查询并返回创建带优先级的原生 listener wrapper，解析阻塞 Fiber 并选择 dispatch/hydration 路径所需状态；无匹配时使用 null/默认值而不修改事件队列。 */
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
