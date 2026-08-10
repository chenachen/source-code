/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {AnyNativeEvent} from '../PluginModuleType';
import type {DOMEventName} from '../DOMEventNames';
import type {DispatchQueue} from '../DOMPluginEventSystem';
import type {EventSystemFlags} from '../EventSystemFlags';
import type {Fiber} from 'react-reconciler/src/ReactInternalTypes';
import type {KnownReactSyntheticEvent} from '../ReactSyntheticEventType';

import {registerDirectEvent} from '../EventRegistry';
import {isReplayingEvent} from '../CurrentReplayingEvent';
import {SyntheticMouseEvent, SyntheticPointerEvent} from '../SyntheticEvent';
import {
  getClosestInstanceFromNode,
  getNodeFromInstance,
  isContainerMarkedAsRoot,
} from '../../client/ReactDOMComponentTree';
import {accumulateEnterLeaveTwoPhaseListeners} from '../DOMPluginEventSystem';

import {
  HostComponent,
  HostSingleton,
  HostText,
} from 'react-reconciler/src/ReactWorkTags';
import {getNearestMountedFiber} from 'react-reconciler/src/ReactFiberTreeReflection';

/** registerEvents 管理从 mouse/pointer over/out 推导不冒泡的 enter/leave 配对事件的注册/监听边界；避免同一容器重复安装或遗漏 capture 配置。 */
function registerEvents() {
  registerDirectEvent('onMouseEnter', ['mouseout', 'mouseover']);
  registerDirectEvent('onMouseLeave', ['mouseout', 'mouseover']);
  registerDirectEvent('onPointerEnter', ['pointerout', 'pointerover']);
  registerDirectEvent('onPointerLeave', ['pointerout', 'pointerover']);
}

/**
 * 绝大多数交互会同时产生顶层 `mouseover` 和 `mouseout`。通常只处理 `mouseout`，
 * 避免提取重复事件；但指针从浏览器外进入时不会触发 `mouseout`，
 * 此时必须改用顶层 `mouseover`。
 */
/** extractEvents 从原生事件和 Fiber 路径收集从 mouse/pointer over/out 推导不冒泡的 enter/leave 配对事件所需数据；只生成满足插件条件的 listener/event。 */
function extractEvents(
  dispatchQueue: DispatchQueue,
  domEventName: DOMEventName,
  targetInst: null | Fiber,
  nativeEvent: AnyNativeEvent,
  nativeEventTarget: null | EventTarget,
  eventSystemFlags: EventSystemFlags,
  targetContainer: EventTarget,
) {
  const isOverEvent =
    domEventName === 'mouseover' || domEventName === 'pointerover';
  const isOutEvent =
    domEventName === 'mouseout' || domEventName === 'pointerout';

  if (isOverEvent && !isReplayingEvent(nativeEvent)) {
    // 若这是带 target 的 over 事件，可能已经在另一目标的
    // out 事件中完成分发。若当前事件来自 replay，
    // 说明先前因该 target 被阻塞而无法分发，
    // 因此现在必须补充分发。
    const related =
      (nativeEvent as any).relatedTarget || (nativeEvent as any).fromElement;
    if (related) {
      // 若 related node 由 React 管理，可认为对应事件
      // 已经在它的 mouseout 阶段分发。
      if (
        getClosestInstanceFromNode(related) ||
        isContainerMarkedAsRoot(related)
      ) {
        return;
      }
    }
  }

  if (!isOutEvent && !isOverEvent) {
    // 该事件不是 mouse/pointer 的 in/out 类型，直接忽略。
    return;
  }

  let win;
  // TODO：类型为何允许 null，而这里又直接读取？
  if ((nativeEventTarget as any).window === nativeEventTarget) {
    // `nativeEventTarget` 很可能是 window 对象。
    win = nativeEventTarget;
  } else {
    // TODO：确认 IE8 中 `ownerDocument` 有时为 undefined 的原因。
    const doc = (nativeEventTarget as any).ownerDocument;
    if (doc) {
      win = doc.defaultView || doc.parentWindow;
    } else {
      win = window;
    }
  }

  let from;
  let to;
  if (isOutEvent) {
    const related = nativeEvent.relatedTarget || (nativeEvent as any).toElement;
    from = targetInst;
    to = related ? getClosestInstanceFromNode(related as any) : null;
    if (to !== null) {
      const nearestMounted = getNearestMountedFiber(to);
      const tag = to.tag;
      if (
        to !== nearestMounted ||
        (tag !== HostComponent && tag !== HostSingleton && tag !== HostText)
      ) {
        to = null;
      }
    }
  } else {
    // 指针从窗口外移入某节点。
    from = null;
    to = targetInst;
  }

  if (from === to) {
    // from/to 均与 React 管理的组件无关。
    return;
  }

  let SyntheticEventCtor = SyntheticMouseEvent;
  let leaveEventType = 'onMouseLeave';
  let enterEventType = 'onMouseEnter';
  let eventTypePrefix = 'mouse';
  if (domEventName === 'pointerout' || domEventName === 'pointerover') {
    SyntheticEventCtor = SyntheticPointerEvent;
    leaveEventType = 'onPointerLeave';
    enterEventType = 'onPointerEnter';
    eventTypePrefix = 'pointer';
  }

  const fromNode = from == null ? win : getNodeFromInstance(from);
  const toNode = to == null ? win : getNodeFromInstance(to);

  const leave: KnownReactSyntheticEvent = new SyntheticEventCtor(
    leaveEventType,
    eventTypePrefix + 'leave',
    from,
    nativeEvent,
    nativeEventTarget,
  );
  leave.target = fromNode;
  leave.relatedTarget = toNode;

  let enter: KnownReactSyntheticEvent | null = null;

  // 只有处理该原生事件的
  // 第一个祖先时才执行；后续祖先会忽略同一事件。
  const nativeTargetInst = getClosestInstanceFromNode(nativeEventTarget as any);
  if (nativeTargetInst === targetInst) {
    const enterEvent: KnownReactSyntheticEvent = new SyntheticEventCtor(
      enterEventType,
      eventTypePrefix + 'enter',
      to,
      nativeEvent,
      nativeEventTarget,
    );
    enterEvent.target = toNode;
    enterEvent.relatedTarget = fromNode;
    enter = enterEvent;
  }

  accumulateEnterLeaveTwoPhaseListeners(dispatchQueue, leave, enter, from, to);
}

export {registerEvents, extractEvents};
