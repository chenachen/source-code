/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {AnyNativeEvent} from '../events/PluginModuleType';
import type {
  Container,
  ActivityInstance,
  SuspenseInstance,
} from '../client/ReactFiberConfigDOM';
import type {DOMEventName} from '../events/DOMEventNames';
import type {EventSystemFlags} from './EventSystemFlags';
import type {FiberRoot} from 'react-reconciler/src/ReactInternalTypes';
import type {EventPriority} from 'react-reconciler/src/ReactEventPriorities';

import {
  unstable_scheduleCallback as scheduleCallback,
  unstable_NormalPriority as NormalPriority,
} from 'scheduler';
import {
  getNearestMountedFiber,
  getContainerFromFiber,
  getActivityInstanceFromFiber,
  getSuspenseInstanceFromFiber,
} from 'react-reconciler/src/ReactFiberTreeReflection';
import {
  findInstanceBlockingEvent,
  findInstanceBlockingTarget,
} from './ReactDOMEventListener';
import {setReplayingEvent, resetReplayingEvent} from './CurrentReplayingEvent';
import {
  getInstanceFromNode,
  getClosestInstanceFromNode,
  getFiberCurrentPropsFromNode,
} from '../client/ReactDOMComponentTree';
import {
  HostRoot,
  ActivityComponent,
  SuspenseComponent,
} from 'react-reconciler/src/ReactWorkTags';
import {isHigherEventPriority} from 'react-reconciler/src/ReactEventPriorities';
import {isRootDehydrated} from 'react-reconciler/src/ReactFiberShellHydration';
import {dispatchReplayedFormAction} from './plugins/FormActionEventPlugin';
import {
  resolveUpdatePriority,
  runWithPriority as attemptHydrationAtPriority,
} from '../client/ReactDOMUpdatePriority';

import {
  attemptContinuousHydration,
  attemptHydrationAtCurrentPriority,
} from 'react-reconciler/src/ReactFiberReconciler';

import {enableHydrationChangeEvent} from 'shared/ReactFeatureFlags';

// TODO：升级 Flow 后改用
// 其内建的该类型定义。
/** 重放需要的 PointerEvent 扩展字段。 */
type PointerEventType = Event & {
  /** 指针身份，用于按指针分别保存 over/capture 重放槽。 */
  pointerId: number,
  /** 原生指针进入/离开时关联的目标。 */
  relatedTarget: EventTarget | null,
  ...
};

/** 一条可合并的连续事件记录；保留原事件、阻塞对象和剩余容器。 */
type QueuedReplayableEvent = {
  /** 当前阻塞的根容器或边界注释；null 表示可重新查询并尝试重放。 */
  blockedOn: null | Container | ActivityInstance | SuspenseInstance,
  /** 原生事件名，用于类别判断与清槽。 */
  domEventName: DOMEventName,
  /** 同一原事件在多个 listener 上观察到的 flags 的按位合并。 */
  eventSystemFlags: EventSystemFlags,
  /** 被阻塞的原生事件对象；重放时用其 constructor 和字段创建克隆。 */
  nativeEvent: AnyNativeEvent,
  /** 观察到此原事件、尚未消费的容器；每轮成功重放后移除首项。 */
  targetContainers: Array<EventTarget>,
};

let hasScheduledReplayAttempt = false;

// 每种连续事件只保留最后一个；只有最后 target 曾被 dehydration 阻塞时
// 才需要重放该事件。
let queuedFocus: null | QueuedReplayableEvent = null;
let queuedDrag: null | QueuedReplayableEvent = null;
let queuedMouse: null | QueuedReplayableEvent = null;
// pointer 事件按 pointerId 各保留一个最新事件。
/** 每个 pointerId 最近一次被阻塞的 pointerover。 */
const queuedPointers: Map<number, QueuedReplayableEvent> = new Map();
/** 每个 pointerId 最近一次被阻塞的 gotpointercapture。 */
const queuedPointerCaptures: Map<number, QueuedReplayableEvent> = new Map();
// 未来也可考虑重放 selectionchange 与 touchmove。

/** 启用 hydration change 特性时，在 hydration 中发现值变动的控件。 */
const queuedChangeEventTargets: Array<EventTarget> = [];

/** 用户显式要求优先 hydration 的 DOM 目标记录。 */
type QueuedHydrationTarget = {
  /** 该显式目标当前等待的脱水根或边界。 */
  blockedOn: null | Container | ActivityInstance | SuspenseInstance,
  /** unstable_scheduleHydration 指定的 DOM 目标。 */
  target: Node,
  /** 入队时捕获的更新优先级，用于安排边界 hydration。 */
  priority: EventPriority,
};
/** 显式目标的优先级队列；只尝试队首，解除 blocker 后继续消费。 */
const queuedExplicitHydrationTargets: Array<QueuedHydrationTarget> = [];

/** capture 阶段允许同步尝试 hydration 的离散事件名；此列表不代表通用 FIFO 重放队列。 */
const discreteReplayableEvents: Array<DOMEventName> = [
  'mousedown',
  'mouseup',
  'touchcancel',
  'touchend',
  'touchstart',
  'auxclick',
  'dblclick',
  'pointercancel',
  'pointerdown',
  'pointerup',
  'dragend',
  'dragstart',
  'drop',
  'compositionend',
  'compositionstart',
  'keydown',
  'keypress',
  'keyup',
  'input',
  'textInput', // 这里刻意使用 camelCase。
  'copy',
  'cut',
  'paste',
  'click',
  'change',
  'contextmenu',
  'reset',
  // 'submit', // 停止传播会阻止 Fizz 表单提交的独立重放机制。
];

/** 检查原生事件是否属于捕获阶段需要同步尝试 hydration 的离散类别。 */
export function isDiscreteEventThatRequiresHydration(
  eventType: DOMEventName,
): boolean {
  return discreteReplayableEvents.indexOf(eventType) > -1;
}

/** 保存原事件、blocker、flags 和首个目标容器，供后续合并与重放。 */
function createQueuedReplayableEvent(
  blockedOn: null | Container | ActivityInstance | SuspenseInstance,
  domEventName: DOMEventName,
  eventSystemFlags: EventSystemFlags,
  targetContainer: EventTarget,
  nativeEvent: AnyNativeEvent,
): QueuedReplayableEvent {
  return {
    blockedOn,
    domEventName,
    eventSystemFlags,
    nativeEvent,
    targetContainers: [targetContainer],
  };
}

// 把该连续事件类型的 replay 状态重置为空。
/** 进入/退出事件使对应连续重放槽失效；pointer 槽按 pointerId 清除。 */
export function clearIfContinuousEvent(
  domEventName: DOMEventName,
  nativeEvent: AnyNativeEvent,
): void {
  switch (domEventName) {
    case 'focusin':
    case 'focusout':
      queuedFocus = null;
      break;
    case 'dragenter':
    case 'dragleave':
      queuedDrag = null;
      break;
    case 'mouseover':
    case 'mouseout':
      queuedMouse = null;
      break;
    case 'pointerover':
    case 'pointerout': {
      const pointerId = (nativeEvent as any as PointerEventType).pointerId;
      queuedPointers.delete(pointerId);
      break;
    }
    case 'gotpointercapture':
    case 'lostpointercapture': {
      const pointerId = (nativeEvent as any as PointerEventType).pointerId;
      queuedPointerCaptures.delete(pointerId);
      break;
    }
  }
}

/** 新原事件替换同类旧槽并提高 blocker 的 hydration 优先级；同一原事件则合并 flags 和容器。 */
function accumulateOrCreateContinuousQueuedReplayableEvent(
  existingQueuedEvent: null | QueuedReplayableEvent,
  blockedOn: null | Container | ActivityInstance | SuspenseInstance,
  domEventName: DOMEventName,
  eventSystemFlags: EventSystemFlags,
  targetContainer: EventTarget,
  nativeEvent: AnyNativeEvent,
): QueuedReplayableEvent {
  if (
    existingQueuedEvent === null ||
    existingQueuedEvent.nativeEvent !== nativeEvent
  ) {
    const queuedEvent = createQueuedReplayableEvent(
      blockedOn,
      domEventName,
      eventSystemFlags,
      targetContainer,
      nativeEvent,
    );
    if (blockedOn !== null) {
      const fiber = getInstanceFromNode(blockedOn);
      if (fiber !== null) {
        // 尝试提高该阻塞 target 的 hydration 优先级。
        attemptContinuousHydration(fiber);
      }
    }
    return queuedEvent;
  }
  // 若完全相同的事件已入队，说明
  // 不同事件系统各自安装了 DOM listener。
  // 此时合并 flags 与 targetContainers，
  // 只保存一个待重放事件。
  existingQueuedEvent.eventSystemFlags |= eventSystemFlags;
  const targetContainers = existingQueuedEvent.targetContainers;
  if (
    // $FlowFixMe[invalid-compare]
    targetContainer !== null &&
    targetContainers.indexOf(targetContainer) === -1
  ) {
    targetContainers.push(targetContainer);
  }
  return existingQueuedEvent;
}

/** 仅将 focusin、dragenter、mouseover、pointerover、gotpointercapture 放入可合并重放槽；其他类型返回 false。 */
export function queueIfContinuousEvent(
  blockedOn: null | Container | ActivityInstance | SuspenseInstance,
  domEventName: DOMEventName,
  eventSystemFlags: EventSystemFlags,
  targetContainer: EventTarget,
  nativeEvent: AnyNativeEvent,
): boolean {
  // 保存原生事件，不修改 relatedTarget。EnterLeaveEventPlugin 对 replay 的 over
  // 从窗口外开始计算进入路径，补发 hydration 前被阻塞的 enter。
  switch (domEventName) {
    case 'focusin': {
      const focusEvent = nativeEvent as any as FocusEvent;
      queuedFocus = accumulateOrCreateContinuousQueuedReplayableEvent(
        queuedFocus,
        blockedOn,
        domEventName,
        eventSystemFlags,
        targetContainer,
        focusEvent,
      );
      return true;
    }
    case 'dragenter': {
      const dragEvent = nativeEvent as any as DragEvent;
      queuedDrag = accumulateOrCreateContinuousQueuedReplayableEvent(
        queuedDrag,
        blockedOn,
        domEventName,
        eventSystemFlags,
        targetContainer,
        dragEvent,
      );
      return true;
    }
    case 'mouseover': {
      const mouseEvent = nativeEvent as any as MouseEvent;
      queuedMouse = accumulateOrCreateContinuousQueuedReplayableEvent(
        queuedMouse,
        blockedOn,
        domEventName,
        eventSystemFlags,
        targetContainer,
        mouseEvent,
      );
      return true;
    }
    case 'pointerover': {
      const pointerEvent = nativeEvent as any as PointerEventType;
      const pointerId = pointerEvent.pointerId;
      queuedPointers.set(
        pointerId,
        accumulateOrCreateContinuousQueuedReplayableEvent(
          queuedPointers.get(pointerId) || null,
          blockedOn,
          domEventName,
          eventSystemFlags,
          targetContainer,
          pointerEvent,
        ),
      );
      return true;
    }
    case 'gotpointercapture': {
      const pointerEvent = nativeEvent as any as PointerEventType;
      const pointerId = pointerEvent.pointerId;
      queuedPointerCaptures.set(
        pointerId,
        accumulateOrCreateContinuousQueuedReplayableEvent(
          queuedPointerCaptures.get(pointerId) || null,
          blockedOn,
          domEventName,
          eventSystemFlags,
          targetContainer,
          pointerEvent,
        ),
      );
      return true;
    }
  }
  return false;
}

// 通过 queuedTarget.blockedOn 写回阻塞结果；此函数不返回布尔值。
/** 把显式目标的 blocker 写回记录；Suspense/Activity 在记录的优先级下尝试 hydration，脱水根只记录等待。 */
function attemptExplicitHydrationTarget(
  queuedTarget: QueuedHydrationTarget,
): void {
  // TODO：该函数与 findInstanceBlockingEvent 有大量重复逻辑，
  // 应尝试合并；难点是需要同时返回两个
  // 值。
  const targetInst = getClosestInstanceFromNode(queuedTarget.target);
  if (targetInst !== null) {
    const nearestMounted = getNearestMountedFiber(targetInst);
    if (nearestMounted !== null) {
      const tag = nearestMounted.tag;
      if (tag === SuspenseComponent) {
        const instance = getSuspenseInstanceFromFiber(nearestMounted);
        if (instance !== null) {
          // 当前被该 boundary 的 hydration 阻塞。
          // 提高它的 hydration 优先级。
          queuedTarget.blockedOn = instance;
          attemptHydrationAtPriority(queuedTarget.priority, () => {
            attemptHydrationAtCurrentPriority(nearestMounted);
          });

          return;
        }
      } else if (tag === ActivityComponent) {
        const instance = getActivityInstanceFromFiber(nearestMounted);
        if (instance !== null) {
          // 当前被该 boundary 的 hydration 阻塞。
          // 提高它的 hydration 优先级。
          queuedTarget.blockedOn = instance;
          attemptHydrationAtPriority(queuedTarget.priority, () => {
            attemptHydrationAtCurrentPriority(nearestMounted);
          });

          return;
        }
      } else if (tag === HostRoot) {
        const root: FiberRoot = nearestMounted.stateNode;
        if (isRootDehydrated(root)) {
          queuedTarget.blockedOn = getContainerFromFiber(nearestMounted);
          // 该路径不主动提升 HostRoot；记录容器，等待根提交后 retry。
          return;
        }
      }
    }
  }
  queuedTarget.blockedOn = null;
}

/**
 * 捕获当前更新优先级，为 unstable_scheduleHydration 保存目标；仅新记录成为队首时
 * 立即尝试 hydration。插入循环在“新优先级不高于当前项”时停止，因此当前实现会
 * 把较低或相等优先级插在该项之前；不要把这里解释为高优先级总在队首的排序。
 * 已受阻的旧记录保留，后续 retryIfBlockedOn 解开 blocker 后逐个重查队首。
 */
export function queueExplicitHydrationTarget(target: Node): void {
  const updatePriority = resolveUpdatePriority();
  const queuedTarget: QueuedHydrationTarget = {
    blockedOn: null,
    target: target,
    priority: updatePriority,
  };
  let i = 0;
  for (; i < queuedExplicitHydrationTargets.length; i++) {
    // 按 isHigherEventPriority 比较结果确定插入位置。
    if (
      !isHigherEventPriority(
        updatePriority,
        queuedExplicitHydrationTargets[i].priority,
      )
    ) {
      break;
    }
  }
  queuedExplicitHydrationTargets.splice(i, 0, queuedTarget);
  if (i === 0) {
    attemptExplicitHydrationTarget(queuedTarget);
  }
}

/** 重新检查 blocker；可交互时克隆原事件经 DOM.dispatchEvent 派发，再消费容器；新 blocker 则保存并提高 hydration 优先级。 */
function attemptReplayContinuousQueuedEvent(
  queuedEvent: QueuedReplayableEvent,
): boolean {
  if (queuedEvent.blockedOn !== null) {
    return false;
  }
  const targetContainers = queuedEvent.targetContainers;
  while (targetContainers.length > 0) {
    const nextBlockedOn = findInstanceBlockingEvent(queuedEvent.nativeEvent);
    if (nextBlockedOn === null) {
      const nativeEvent = queuedEvent.nativeEvent;
      const nativeEventClone = new nativeEvent.constructor(
        nativeEvent.type,
        nativeEvent as any,
      );
      setReplayingEvent(nativeEventClone);
      nativeEvent.target.dispatchEvent(nativeEventClone);
      resetReplayingEvent();
    } else {
      // 仍受阻，稍后重试。
      const fiber = getInstanceFromNode(nextBlockedOn);
      if (fiber !== null) {
        attemptContinuousHydration(fiber);
      }
      queuedEvent.blockedOn = nextBlockedOn;
      return false;
    }
    // 该 target container 已成功分发，继续处理下一个。
    targetContainers.shift();
  }
  return true;
}

/** 尝试重放某个 pointer 槽；全部容器消费成功后才从 Map 删除。 */
function attemptReplayContinuousQueuedEventInMap(
  queuedEvent: QueuedReplayableEvent,
  key: number,
  map: Map<number, QueuedReplayableEvent>,
): void {
  if (attemptReplayContinuousQueuedEvent(queuedEvent)) {
    map.delete(key);
  }
}

/** 按控件类型派发模拟 click/input/change，使 hydration 前的用户改动进入正常 ChangeEventPlugin 路径。 */
function replayChangeEvent(target: EventTarget): void {
  // 为 input 分发一个模拟“change”事件。
  const element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =
    target as any;
  if (element.nodeName === 'INPUT') {
    if (element.type === 'checkbox' || element.type === 'radio') {
      // checkbox 无论如何变化都会触发 click。
      const EventCtr =
        typeof PointerEvent === 'function' ? PointerEvent : Event;
      target.dispatchEvent(new EventCtr('click', {bubbles: true}));
      // checkbox 的 input 事件使用 Event constructor，而非 InputEvent。
      target.dispatchEvent(new Event('input', {bubbles: true}));
    } else {
      if (typeof InputEvent === 'function') {
        target.dispatchEvent(new InputEvent('input', {bubbles: true}));
      }
    }
  } else if (element.nodeName === 'TEXTAREA') {
    if (typeof InputEvent === 'function') {
      target.dispatchEvent(new InputEvent('input', {bubbles: true}));
    }
  }
  target.dispatchEvent(new Event('change', {bubbles: true}));
}

/** 清除 replay 调度标记，尝试各连续槽；成功清槽，并处理 hydration change 目标。 */
function replayUnblockedEvents() {
  hasScheduledReplayAttempt = false;
  // 重放所有已解除阻塞的连续事件。
  if (queuedFocus !== null && attemptReplayContinuousQueuedEvent(queuedFocus)) {
    queuedFocus = null;
  }
  if (queuedDrag !== null && attemptReplayContinuousQueuedEvent(queuedDrag)) {
    queuedDrag = null;
  }
  if (queuedMouse !== null && attemptReplayContinuousQueuedEvent(queuedMouse)) {
    queuedMouse = null;
  }
  queuedPointers.forEach(attemptReplayContinuousQueuedEventInMap);
  queuedPointerCaptures.forEach(attemptReplayContinuousQueuedEventInMap);
  if (enableHydrationChangeEvent) {
    for (let i = 0; i < queuedChangeEventTargets.length; i++) {
      replayChangeEvent(queuedChangeEventTargets[i]);
    }
    queuedChangeEventTargets.length = 0;
  }
}

/** 有待重放标记时同步消费可用的连续槽和 change 目标；特性开关控制调用时机而非本函数入口。 */
export function flushEventReplaying(): void {
  // 同步冲刷事件重放，确保它在
  // 任何新更新应用之前可被观察。
  if (hasScheduledReplayAttempt) {
    replayUnblockedEvents();
  }
}

/** 特性开启时登记 hydration 中变化的控件并置待冲刷标记；此函数不调度 callback，由提交路径同步冲刷。 */
export function queueChangeEvent(target: EventTarget): void {
  if (enableHydrationChangeEvent) {
    queuedChangeEventTargets.push(target);
    if (!hasScheduledReplayAttempt) {
      hasScheduledReplayAttempt = true;
    }
  }
}

/** 匹配 unblocked 时清除该事件的 blocker；默认模式下至多安排一个 NormalPriority replay callback。 */
function scheduleCallbackIfUnblocked(
  queuedEvent: QueuedReplayableEvent,
  unblocked: Container | SuspenseInstance | ActivityInstance,
) {
  if (queuedEvent.blockedOn === unblocked) {
    queuedEvent.blockedOn = null;
    if (!hasScheduledReplayAttempt) {
      hasScheduledReplayAttempt = true;
      if (!enableHydrationChangeEvent) {
        // 安排一次 callback 扫描全部连续槽；尚未解除阻塞的槽继续保留。
        scheduleCallback(NormalPriority, replayUnblockedEvents);
      }
    }
  }
}

/** 接收本次 FormData 的表单 action 函数。 */
type FormAction = FormData => void | Promise<void>;

/** document 上共享的扁平三元组队列：[form, submitter/action, formData]。 */
type FormReplayingQueue = Array<any>; // 队列布局：[form、submitter 或 action、formData……]

let lastScheduledReplayQueue: null | FormReplayingQueue = null;

/** 按顺序等待 form/action 可用；当前 React 实例拥有且已解锁的提交先出队，再启动宿主 transition。 */
function replayUnblockedFormActions(formReplayingQueue: FormReplayingQueue) {
  if (lastScheduledReplayQueue === formReplayingQueue) {
    lastScheduledReplayQueue = null;
  }
  for (let i = 0; i < formReplayingQueue.length; i += 3) {
    const form: HTMLFormElement = formReplayingQueue[i];
    const submitterOrAction:
      | null
      | HTMLInputElement
      | HTMLButtonElement
      | FormAction = formReplayingQueue[i + 1];
    const formData: FormData = formReplayingQueue[i + 2];
    if (typeof submitterOrAction !== 'function') {
      // 该 action 尚未 hydration，可能被
      // 另一 React 实例或当前树更高层阻塞。
      const blockedOn = findInstanceBlockingTarget(submitterOrAction || form);
      if (blockedOn === null) {
        // 当前未阻塞但没有 action，说明
        // 它属于另一 React 实例；直接跳过。
        continue;
      } else {
        // 当前 React 实例内仍有阻塞，稍后重试。
        break;
      }
    }
    const formInst = getInstanceFromNode(form);
    if (formInst !== null) {
      // 该节点属于当前 React 实例。
      // 该 action 已可重放，先从队列删除。
      formReplayingQueue.splice(i, 3);
      i -= 3;
      dispatchReplayedFormAction(formInst, form, submitterOrAction, formData);
      // 不递增索引，继续处理当前位置。
      continue;
    }
    // 该 form 必然属于另一 React 实例。
    // 若要维持同一 root 上不同 React 实例之间的顺序，
    // 需要另一实例完成时主动 ping 当前实例。
    // 当前直接跳过，交由所属实例执行。
  }
}

/** 为尚未调度的 form replay 队列安排一次 NormalPriority callback。 */
function scheduleReplayQueueIfNeeded(formReplayingQueue: FormReplayingQueue) {
  // 调度 callback 执行队列中已解除阻塞的 form actions。
  // 这里只跟踪最后一个队列；若多个 React 实例交替
  // commit，可能调度多余 callback，但影响有限，
  // 实际通常只有一个实例。
  if (lastScheduledReplayQueue !== formReplayingQueue) {
    lastScheduledReplayQueue = formReplayingQueue;
    scheduleCallback(NormalPriority, () =>
      replayUnblockedFormActions(formReplayingQueue),
    );
  }
}

/** 解锁匹配边界的连续槽与显式目标，并解析 document 中等待 hydration 的 form action。 */
export function retryIfBlockedOn(
  unblocked: Container | SuspenseInstance | ActivityInstance,
): void {
  if (queuedFocus !== null) {
    scheduleCallbackIfUnblocked(queuedFocus, unblocked);
  }
  if (queuedDrag !== null) {
    scheduleCallbackIfUnblocked(queuedDrag, unblocked);
  }
  if (queuedMouse !== null) {
    scheduleCallbackIfUnblocked(queuedMouse, unblocked);
  }
  /** 将当前 unblocked 通知应用到 pointer Map 的单个槽。 */
  const unblock = (queuedEvent: QueuedReplayableEvent) =>
    scheduleCallbackIfUnblocked(queuedEvent, unblocked);
  queuedPointers.forEach(unblock);
  queuedPointerCaptures.forEach(unblock);

  for (let i = 0; i < queuedExplicitHydrationTargets.length; i++) {
    const queuedTarget = queuedExplicitHydrationTargets[i];
    if (queuedTarget.blockedOn === unblocked) {
      queuedTarget.blockedOn = null;
    }
  }

  while (queuedExplicitHydrationTargets.length > 0) {
    const nextExplicitTarget = queuedExplicitHydrationTargets[0];
    if (nextExplicitTarget.blockedOn !== null) {
      // 当前仍受阻。
      break;
    } else {
      attemptExplicitHydrationTarget(nextExplicitTarget);
      if (nextExplicitTarget.blockedOn === null) {
        // 当前已解除阻塞。
        queuedExplicitHydrationTargets.shift();
      }
    }
  }

  // 检查 document 中是否存在排队的 form action。
  // 若没有 ownerDocument，当前节点本身就是 document。
  const root = unblocked.ownerDocument || unblocked;
  const formReplayingQueue: void | FormReplayingQueue = (root as any)
    .$$reactFormReplay;
  if (formReplayingQueue != null) {
    for (let i = 0; i < formReplayingQueue.length; i += 3) {
      const form: HTMLFormElement = formReplayingQueue[i];
      const submitterOrAction:
        | null
        | HTMLInputElement
        | HTMLButtonElement
        | FormAction = formReplayingQueue[i + 1];
      const formProps = getFiberCurrentPropsFromNode(form);
      if (typeof submitterOrAction === 'function') {
        // 该 action 已解析，只等待分发。
        if (!formProps) {
          // 该节点不属于当前 React 实例，但可能刚刚
          // 解除事件分发阻塞，因此必须确保调度
          // 重试。
          scheduleReplayQueueIfNeeded(formReplayingQueue);
        }
        continue;
      }
      let target: Node = form;
      if (formProps) {
        // form 属于当前 React 实例，但 submitter
        // 可能尚未完成 hydration。
        let action: null | FormAction = null;
        const submitter = submitterOrAction;
        if (submitter && submitter.hasAttribute('formAction')) {
          // action 由 submitter 提供。
          target = submitter;
          const submitterProps = getFiberCurrentPropsFromNode(submitter);
          if (submitterProps) {
            // submitter 属于当前实例。
            action = (submitterProps as any).formAction;
          } else {
            const blockedOn = findInstanceBlockingTarget(target);
            if (blockedOn !== null) {
              // submitter 尚未 hydration，继续等待。
              continue;
            }
            // submitter 必然属于另一 React 实例。
            // 但 form 属于当前实例；此场景不分发 action。
          }
        } else {
          action = (formProps as any).action;
        }
        if (typeof action === 'function') {
          formReplayingQueue[i + 1] = action;
        } else {
          // 状态异常，删除该 action 以避免队列卡住。
          formReplayingQueue.splice(i, 3);
          i -= 3;
        }
        // 调度 replay，以防该提交解除了其他阻塞。
        scheduleReplayQueueIfNeeded(formReplayingQueue);
        continue;
      }
      // target 上方仍有阻塞，暂时不能继续。
      // 目前无法确认 target 是否属于当前 React 实例；
      // 它可能是子级另一 React，但至少某个父节点属于当前实例。
      // 必须继续检查后续排队 action。
    }
  }
}
