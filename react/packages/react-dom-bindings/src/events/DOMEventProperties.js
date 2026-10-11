/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {DOMEventName} from './DOMEventNames';

import {registerTwoPhaseEvent} from './EventRegistry';
import {
  ANIMATION_END,
  ANIMATION_ITERATION,
  ANIMATION_START,
  TRANSITION_RUN,
  TRANSITION_START,
  TRANSITION_CANCEL,
  TRANSITION_END,
} from './DOMEventNames';

import {
  enableCreateEventHandleAPI,
  enableScrollEndPolyfill,
} from 'shared/ReactFeatureFlags';

/** 原生事件名到 React on* 名称的映射；SimpleEventPlugin 用它选择 handler。 */
export const topLevelEventsToReactNames: Map<DOMEventName, string | null> =
  new Map();

// 注意：该列表中的大小写具有语义。
//
// 例如必须写成“pointerDown”，不能写“pointerdown”。
// 因为同一项同时用于派生 React 名称“onPointerDown”
// 和 DOM 名称“pointerdown”。
//
// 不符合该约定的例外会在后文单独注册。
//
// prettier-ignore
/** 用于派生小写 DOM 名与 onXxx React 名的基础事件列表。 */
const simpleEventPluginEvents = [
  'abort',
  'auxClick',
  'beforeToggle',
  'cancel',
  'canPlay',
  'canPlayThrough',
  'click',
  'close',
  'contextMenu',
  'copy',
  'cut',
  'drag',
  'dragEnd',
  'dragEnter',
  'dragExit',
  'dragLeave',
  'dragOver',
  'dragStart',
  'drop',
  'durationChange',
  'emptied',
  'encrypted',
  'ended',
  'error',
  'fullscreenChange',
  'fullscreenError',
  'gotPointerCapture',
  'input',
  'invalid',
  'keyDown',
  'keyPress',
  'keyUp',
  'load',
  'loadedData',
  'loadedMetadata',
  'loadStart',
  'lostPointerCapture',
  'mouseDown',
  'mouseMove',
  'mouseOut',
  'mouseOver',
  'mouseUp',
  'paste',
  'pause',
  'play',
  'playing',
  'pointerCancel',
  'pointerDown',
  'pointerMove',
  'pointerOut',
  'pointerOver',
  'pointerUp',
  'progress',
  'rateChange',
  'reset',
  'resize',
  'seeked',
  'seeking',
  'stalled',
  'submit',
  'suspend',
  'timeUpdate',
  'touchCancel',
  'touchEnd',
  'touchStart',
  'volumeChange',
  'scroll',
  'toggle',
  'touchMove',
  'waiting',
  'wheel',
];

if (!enableScrollEndPolyfill) {
  simpleEventPluginEvents.push('scrollEnd');
}

if (enableCreateEventHandleAPI) {
  // 特殊情况：这两个事件没有 on* React handler，
  // 只能通过 createEventHandle API 访问。
  topLevelEventsToReactNames.set('beforeblur', null);
  topLevelEventsToReactNames.set('afterblur', null);
}

/** 登记原生名与 React 名的对应关系，并注册 capture/bubble 共用的原生依赖。 */
function registerSimpleEvent(domEventName: DOMEventName, reactName: string) {
  topLevelEventsToReactNames.set(domEventName, reactName);
  registerTwoPhaseEvent(reactName, [domEventName]);
}

/** 注册基础事件及 focus、动画和过渡等特殊名称映射；此处只填注册表，不安装 DOM listener。 */
export function registerSimpleEvents() {
  for (let i = 0; i < simpleEventPluginEvents.length; i++) {
    const eventName = simpleEventPluginEvents[i] as any as string;
    const domEventName = eventName.toLowerCase() as any as DOMEventName;
    const capitalizedEvent = eventName[0].toUpperCase() + eventName.slice(1);
    registerSimpleEvent(domEventName, 'on' + capitalizedEvent);
  }
  // 以下为事件名不遵循通用映射规则的特殊情况。
  registerSimpleEvent(ANIMATION_END, 'onAnimationEnd');
  registerSimpleEvent(ANIMATION_ITERATION, 'onAnimationIteration');
  registerSimpleEvent(ANIMATION_START, 'onAnimationStart');
  registerSimpleEvent('dblclick', 'onDoubleClick');
  registerSimpleEvent('focusin', 'onFocus');
  registerSimpleEvent('focusout', 'onBlur');

  registerSimpleEvent(TRANSITION_RUN, 'onTransitionRun');
  registerSimpleEvent(TRANSITION_START, 'onTransitionStart');
  registerSimpleEvent(TRANSITION_CANCEL, 'onTransitionCancel');
  registerSimpleEvent(TRANSITION_END, 'onTransitionEnd');
}
