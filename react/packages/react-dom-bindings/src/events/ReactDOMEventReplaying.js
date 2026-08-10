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
/** PointerEventType 定义 Flow 数据形状，用于按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放；类型边界阻止插件、原生事件与 Fiber 状态混用。 */
type PointerEventType = Event & {
  /** PointerEventType.pointerId 描述按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  pointerId: number,
  /** PointerEventType.relatedTarget 描述按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  relatedTarget: EventTarget | null,
  ...
};

/** QueuedReplayableEvent 定义 Flow 数据形状，用于按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放；类型边界阻止插件、原生事件与 Fiber 状态混用。 */
type QueuedReplayableEvent = {
  /** QueuedReplayableEvent.blockedOn 描述按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  blockedOn: null | Container | ActivityInstance | SuspenseInstance,
  /** QueuedReplayableEvent.domEventName 描述按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  domEventName: DOMEventName,
  /** QueuedReplayableEvent.eventSystemFlags 描述按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  eventSystemFlags: EventSystemFlags,
  /** QueuedReplayableEvent.nativeEvent 描述按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  nativeEvent: AnyNativeEvent,
  /** QueuedReplayableEvent.targetContainers 描述按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  targetContainers: Array<EventTarget>,
};

let hasScheduledReplayAttempt = false;

// 每种连续事件只保留最后一个；只有最后 target 曾被 dehydration 阻塞时
// 才需要重放该事件。
let queuedFocus: null | QueuedReplayableEvent = null;
let queuedDrag: null | QueuedReplayableEvent = null;
let queuedMouse: null | QueuedReplayableEvent = null;
// pointer 事件按 pointerId 各保留一个最新事件。
/** queuedPointers 保存按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const queuedPointers: Map<number, QueuedReplayableEvent> = new Map();
/** queuedPointerCaptures 保存按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const queuedPointerCaptures: Map<number, QueuedReplayableEvent> = new Map();
// 未来也可考虑重放 selectionchange 与 touchmove。

/** queuedChangeEventTargets 保存按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const queuedChangeEventTargets: Array<EventTarget> = [];

/** QueuedHydrationTarget 定义 Flow 数据形状，用于按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放；类型边界阻止插件、原生事件与 Fiber 状态混用。 */
type QueuedHydrationTarget = {
  /** QueuedHydrationTarget.blockedOn 描述按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  blockedOn: null | Container | ActivityInstance | SuspenseInstance,
  /** QueuedHydrationTarget.target 描述按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  target: Node,
  /** QueuedHydrationTarget.priority 描述按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
  priority: EventPriority,
};
/** queuedExplicitHydrationTargets 保存按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const queuedExplicitHydrationTargets: Array<QueuedHydrationTarget> = [];

/** discreteReplayableEvents 保存按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
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
  // 'submit', // stopPropagation blocks the replay mechanism
];

/** isDiscreteEventThatRequiresHydration 判断按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的前置条件；返回值用于在热路径提前跳过不适用分支。 */
export function isDiscreteEventThatRequiresHydration(
  eventType: DOMEventName,
): boolean {
  return discreteReplayableEvents.indexOf(eventType) > -1;
}

/** createQueuedReplayableEvent 为按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放创建封装对象；生成值保留原生事件身份并携带必要调度上下文。 */
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
/** clearIfContinuousEvent 更新按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的模块状态或 DOM 状态；重复调用需保持队列顺序与恢复幂等性。 */
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

/** accumulateOrCreateContinuousQueuedReplayableEvent 从原生事件和 Fiber 路径收集按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放所需数据；只生成满足插件条件的 listener/event。 */
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

/** queueIfContinuousEvent 更新按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的模块状态或 DOM 状态；重复调用需保持队列顺序与恢复幂等性。 */
export function queueIfContinuousEvent(
  blockedOn: null | Container | ActivityInstance | SuspenseInstance,
  domEventName: DOMEventName,
  eventSystemFlags: EventSystemFlags,
  targetContainer: EventTarget,
  nativeEvent: AnyNativeEvent,
): boolean {
  // 这些事件会把 relatedTarget 设为 null，使重放行为等同于
  // hydration 完成后从窗口外（无 target）移入目标。
  // 未来可考虑克隆事件，避免直接修改。
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

// 检查 target 是否解除阻塞；解除时返回 true。
/** attemptExplicitHydrationTarget 推进按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的分发或重放状态机；阻塞时保留事件，解除后按原优先级继续。 */
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
          // 当前无法提高
          // root 的优先级，只能同步 hydration。
          return;
        }
      }
    }
  }
  queuedTarget.blockedOn = null;
}

/** queueExplicitHydrationTarget 更新按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的模块状态或 DOM 状态；重复调用需保持队列顺序与恢复幂等性。 */
export function queueExplicitHydrationTarget(target: Node): void {
  const updatePriority = resolveUpdatePriority();
  const queuedTarget: QueuedHydrationTarget = {
    blockedOn: null,
    target: target,
    priority: updatePriority,
  };
  let i = 0;
  for (; i < queuedExplicitHydrationTargets.length; i++) {
    // 遇到第一个优先级低于
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

/** attemptReplayContinuousQueuedEvent 推进按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的分发或重放状态机；阻塞时保留事件，解除后按原优先级继续。 */
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

/** attemptReplayContinuousQueuedEventInMap 推进按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的分发或重放状态机；阻塞时保留事件，解除后按原优先级继续。 */
function attemptReplayContinuousQueuedEventInMap(
  queuedEvent: QueuedReplayableEvent,
  key: number,
  map: Map<number, QueuedReplayableEvent>,
): void {
  if (attemptReplayContinuousQueuedEvent(queuedEvent)) {
    map.delete(key);
  }
}

/** replayChangeEvent 推进按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的分发或重放状态机；阻塞时保留事件，解除后按原优先级继续。 */
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

/** replayUnblockedEvents 推进按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的分发或重放状态机；阻塞时保留事件，解除后按原优先级继续。 */
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

/** flushEventReplaying 执行按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
export function flushEventReplaying(): void {
  // 同步冲刷事件重放，确保它在
  // 任何新更新应用之前可被观察。
  if (hasScheduledReplayAttempt) {
    replayUnblockedEvents();
  }
}

/** queueChangeEvent 更新按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的模块状态或 DOM 状态；重复调用需保持队列顺序与恢复幂等性。 */
export function queueChangeEvent(target: EventTarget): void {
  if (enableHydrationChangeEvent) {
    queuedChangeEventTargets.push(target);
    if (!hasScheduledReplayAttempt) {
      hasScheduledReplayAttempt = true;
    }
  }
}

/** scheduleCallbackIfUnblocked 执行按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
function scheduleCallbackIfUnblocked(
  queuedEvent: QueuedReplayableEvent,
  unblocked: Container | SuspenseInstance | ActivityInstance,
) {
  if (queuedEvent.blockedOn === unblocked) {
    queuedEvent.blockedOn = null;
    if (!hasScheduledReplayAttempt) {
      hasScheduledReplayAttempt = true;
      if (!enableHydrationChangeEvent) {
        // 调度 callback，尝试重放尽可能多的
        // 已解除阻塞事件；传入的首个目标此刻可能仍未解除。
        // 可以提前检查，避免调度无用 callback。
        scheduleCallback(NormalPriority, replayUnblockedEvents);
      }
    }
  }
}

/** FormAction 定义 Flow 数据形状，用于按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放；类型边界阻止插件、原生事件与 Fiber 状态混用。 */
type FormAction = FormData => void | Promise<void>;

/** FormReplayingQueue 定义 Flow 数据形状，用于按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放；类型边界阻止插件、原生事件与 Fiber 状态混用。 */
type FormReplayingQueue = Array<any>; // 队列布局：[form、submitter 或 action、formData……]

let lastScheduledReplayQueue: null | FormReplayingQueue = null;

/** replayUnblockedFormActions 推进按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的分发或重放状态机；阻塞时保留事件，解除后按原优先级继续。 */
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

/** scheduleReplayQueueIfNeeded 执行按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
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

/** retryIfBlockedOn 推进按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的分发或重放状态机；阻塞时保留事件，解除后按原优先级继续。 */
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
  /** unblock 以闭包保存按离散/连续类别排队被 hydration 阻塞的事件，并在边界解除后克隆重放的可替换实现，调用方只依赖稳定函数边界。 */
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
