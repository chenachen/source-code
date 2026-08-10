/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {DOMEventName} from '../../events/DOMEventNames';
import type {Fiber} from 'react-reconciler/src/ReactInternalTypes';
import type {AnyNativeEvent} from '../../events/PluginModuleType';
import type {DispatchQueue} from '../DOMPluginEventSystem';
import type {EventSystemFlags} from '../EventSystemFlags';
import type {ReactSyntheticEvent} from '../ReactSyntheticEventType';

import {
  SyntheticEvent,
  SyntheticKeyboardEvent,
  SyntheticFocusEvent,
  SyntheticMouseEvent,
  SyntheticDragEvent,
  SyntheticTouchEvent,
  SyntheticAnimationEvent,
  SyntheticTransitionEvent,
  SyntheticUIEvent,
  SyntheticWheelEvent,
  SyntheticClipboardEvent,
  SyntheticPointerEvent,
  SyntheticSubmitEvent,
  SyntheticToggleEvent,
} from '../../events/SyntheticEvent';

import {
  ANIMATION_END,
  ANIMATION_ITERATION,
  ANIMATION_START,
  TRANSITION_END,
} from '../DOMEventNames';
import {
  topLevelEventsToReactNames,
  registerSimpleEvents,
} from '../DOMEventProperties';
import {
  accumulateSinglePhaseListeners,
  accumulateEventHandleNonManagedNodeListeners,
} from '../DOMPluginEventSystem';
import {
  IS_EVENT_HANDLE_NON_MANAGED_NODE,
  IS_CAPTURE_PHASE,
} from '../EventSystemFlags';

import getEventCharCode from '../getEventCharCode';

import {enableCreateEventHandleAPI} from 'shared/ReactFeatureFlags';

/** extractEvents 从原生事件和 Fiber 路径收集将大多数原生事件按类型映射为对应 SyntheticEvent 并进入两阶段分发所需数据；只生成满足插件条件的 listener/event。 */
function extractEvents(
  dispatchQueue: DispatchQueue,
  domEventName: DOMEventName,
  targetInst: null | Fiber,
  nativeEvent: AnyNativeEvent,
  nativeEventTarget: null | EventTarget,
  eventSystemFlags: EventSystemFlags,
  targetContainer: EventTarget,
): void {
  const reactName = topLevelEventsToReactNames.get(domEventName);
  if (reactName === undefined) {
    return;
  }
  let SyntheticEventCtor = SyntheticEvent;
  let reactEventType: string = domEventName;
  switch (domEventName) {
    case 'keypress':
      // Firefox 也会为功能键创建 keypress；这里过滤
      // 这些无效事件。Enter 同时具备可打印与
      // 不可打印语义；Tab 看似也应如此，但浏览器并非这样实现。
      // TODO：该问题已在 https://bugzilla.mozilla.org/show_bug.cgi?id=968056 修复，
      // 该兼容分支可能可以移除。
      if (getEventCharCode(nativeEvent as any as KeyboardEvent) === 0) {
        return;
      }
    // 继续落入下一分支。
    case 'keydown':
    case 'keyup':
      SyntheticEventCtor = SyntheticKeyboardEvent;
      break;
    case 'focusin':
      reactEventType = 'focus';
      SyntheticEventCtor = SyntheticFocusEvent;
      break;
    case 'focusout':
      reactEventType = 'blur';
      SyntheticEventCtor = SyntheticFocusEvent;
      break;
    case 'beforeblur':
    case 'afterblur':
      SyntheticEventCtor = SyntheticFocusEvent;
      break;
    case 'click':
      // Firefox 会为鼠标右键创建 click；这里过滤
      // 该无效事件。
      // TODO：该问题已在 https://phabricator.services.mozilla.com/D26793 修复，
      // 该兼容分支可能可以移除。
      if (nativeEvent.button === 2) {
        return;
      }
    // 继续落入下一分支。
    case 'auxclick':
    case 'dblclick':
    case 'mousedown':
    case 'mousemove':
    case 'mouseup':
    // TODO：禁用元素不应响应鼠标事件。
    // 继续落入下一分支。
    case 'mouseout':
    case 'mouseover':
    case 'contextmenu':
      SyntheticEventCtor = SyntheticMouseEvent;
      break;
    case 'drag':
    case 'dragend':
    case 'dragenter':
    case 'dragexit':
    case 'dragleave':
    case 'dragover':
    case 'dragstart':
    case 'drop':
      SyntheticEventCtor = SyntheticDragEvent;
      break;
    case 'touchcancel':
    case 'touchend':
    case 'touchmove':
    case 'touchstart':
      SyntheticEventCtor = SyntheticTouchEvent;
      break;
    case ANIMATION_END:
    case ANIMATION_ITERATION:
    case ANIMATION_START:
      SyntheticEventCtor = SyntheticAnimationEvent;
      break;
    case TRANSITION_END:
      SyntheticEventCtor = SyntheticTransitionEvent;
      break;
    case 'scroll':
    case 'scrollend':
      SyntheticEventCtor = SyntheticUIEvent;
      break;
    case 'wheel':
      SyntheticEventCtor = SyntheticWheelEvent;
      break;
    case 'copy':
    case 'cut':
    case 'paste':
      SyntheticEventCtor = SyntheticClipboardEvent;
      break;
    case 'gotpointercapture':
    case 'lostpointercapture':
    case 'pointercancel':
    case 'pointerdown':
    case 'pointermove':
    case 'pointerout':
    case 'pointerover':
    case 'pointerup':
      SyntheticEventCtor = SyntheticPointerEvent;
      break;
    case 'submit':
      SyntheticEventCtor = SyntheticSubmitEvent;
      break;
    case 'toggle':
    case 'beforetoggle':
      // MDN 声称 <details> 不应接收 ToggleEvent，这与规范冲突：https://html.spec.whatwg.org/multipage/indices.html#event-toggle
      SyntheticEventCtor = SyntheticToggleEvent;
      break;
    default:
      // 未知事件，仅供 createEventHandle 使用。
      break;
  }

  const inCapturePhase = (eventSystemFlags & IS_CAPTURE_PHASE) !== 0;
  if (
    enableCreateEventHandleAPI &&
    eventSystemFlags & IS_EVENT_HANDLE_NON_MANAGED_NODE
  ) {
    const listeners = accumulateEventHandleNonManagedNodeListeners(
      // TODO：该类型转换对“focus”等事件可能不合理，
      // 因为 React 实际监听的是“focusin”等对应事件。
      reactEventType as any as DOMEventName,
      targetContainer,
      inCapturePhase,
    );
    if (listeners.length > 0) {
      // 刻意延迟到存在 listener 时再创建事件。
      const event: ReactSyntheticEvent = new SyntheticEventCtor(
        reactName,
        reactEventType,
        null,
        nativeEvent,
        nativeEventTarget,
      );
      dispatchQueue.push({event, listeners});
    }
  } else {
    // 部分事件在浏览器中不冒泡。
    // React 过去始终让它们冒泡，可能产生意外行为。
    // 这里尝试贴近浏览器语义，让 React 也不再对它们
    // 执行冒泡；先从 onScroll 开始，再逐步扩展。
    const accumulateTargetOnly =
      !inCapturePhase &&
      // TODO：理想情况下应把
      // DOMPluginEventSystem.nonDelegatedEvents 中的全部事件加入此处，
      // 之后即可移除该特殊列表。
      // 这是破坏性变更，可推迟到 React 18。
      (domEventName === 'scroll' || domEventName === 'scrollend');

    const listeners = accumulateSinglePhaseListeners(
      targetInst,
      reactName,
      nativeEvent.type,
      inCapturePhase,
      accumulateTargetOnly,
      nativeEvent,
    );
    if (listeners.length > 0) {
      // 刻意延迟到存在 listener 时再创建事件。
      const event: ReactSyntheticEvent = new SyntheticEventCtor(
        reactName,
        reactEventType,
        null,
        nativeEvent,
        nativeEventTarget,
      );
      dispatchQueue.push({event, listeners});
    }
  }
}

export {registerSimpleEvents as registerEvents, extractEvents};
