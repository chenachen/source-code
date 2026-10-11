/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import getVendorPrefixedEventName from './getVendorPrefixedEventName';

/** React DOM 事件系统接受的原生事件名联合。 */
export type DOMEventName =
  | 'abort'
  | 'afterblur' // 这不是真实原生事件，仅供事件实验使用。
  // 这些事件存在厂商前缀，调用方应改用导出的标准常量：
  // 'animationiteration' |
  // 'animationend |
  // 'animationstart' |
  | 'beforeblur' // 这不是真实原生事件，仅供事件实验使用。
  | 'beforeinput'
  | 'beforetoggle'
  | 'blur'
  | 'canplay'
  | 'canplaythrough'
  | 'cancel'
  | 'change'
  | 'click'
  | 'close'
  | 'compositionend'
  | 'compositionstart'
  | 'compositionupdate'
  | 'contextmenu'
  | 'copy'
  | 'cut'
  | 'dblclick'
  | 'auxclick'
  | 'drag'
  | 'dragend'
  | 'dragenter'
  | 'dragexit'
  | 'dragleave'
  | 'dragover'
  | 'dragstart'
  | 'drop'
  | 'durationchange'
  | 'emptied'
  | 'encrypted'
  | 'ended'
  | 'error'
  | 'focus'
  | 'focusin'
  | 'focusout'
  | 'fullscreenchange'
  | 'fullscreenerror'
  | 'gotpointercapture'
  | 'hashchange'
  | 'input'
  | 'invalid'
  | 'keydown'
  | 'keypress'
  | 'keyup'
  | 'load'
  | 'loadstart'
  | 'loadeddata'
  | 'loadedmetadata'
  | 'lostpointercapture'
  | 'message'
  | 'mousedown'
  | 'mouseenter'
  | 'mouseleave'
  | 'mousemove'
  | 'mouseout'
  | 'mouseover'
  | 'mouseup'
  | 'paste'
  | 'pause'
  | 'play'
  | 'playing'
  | 'pointercancel'
  | 'pointerdown'
  | 'pointerenter'
  | 'pointerleave'
  | 'pointermove'
  | 'pointerout'
  | 'pointerover'
  | 'pointerup'
  | 'popstate'
  | 'progress'
  | 'ratechange'
  | 'reset'
  | 'resize'
  | 'scroll'
  | 'scrollend'
  | 'seeked'
  | 'seeking'
  | 'select'
  | 'selectstart'
  | 'selectionchange'
  | 'stalled'
  | 'submit'
  | 'suspend'
  | 'textInput' // 这里刻意使用 camelCase，属于非标准事件名。
  | 'timeupdate'
  | 'toggle'
  | 'touchcancel'
  | 'touchend'
  | 'touchmove'
  | 'touchstart'
  // 这些事件存在厂商前缀，调用方应改用导出的标准常量：
  // 'transitionrun' |
  // 'transitionstart' |
  // 'transitioncancel' |
  // 'transitionend' |
  | 'volumechange'
  | 'waiting'
  | 'wheel';

/** 按浏览器能力解析的 animationend 原生名称。 */
export const ANIMATION_END: DOMEventName =
  getVendorPrefixedEventName('animationend');
/** 按浏览器能力解析的 animationiteration 原生名称。 */
export const ANIMATION_ITERATION: DOMEventName =
  getVendorPrefixedEventName('animationiteration');
/** 按浏览器能力解析的 animationstart 原生名称。 */
export const ANIMATION_START: DOMEventName =
  getVendorPrefixedEventName('animationstart');

/** 按浏览器能力解析的 transitionrun 原生名称。 */
export const TRANSITION_RUN: DOMEventName =
  getVendorPrefixedEventName('transitionrun');
/** 按浏览器能力解析的 transitionstart 原生名称。 */
export const TRANSITION_START: DOMEventName =
  getVendorPrefixedEventName('transitionstart');
/** 按浏览器能力解析的 transitioncancel 原生名称。 */
export const TRANSITION_CANCEL: DOMEventName =
  getVendorPrefixedEventName('transitioncancel');
/** 按浏览器能力解析的 transitionend 原生名称。 */
export const TRANSITION_END: DOMEventName =
  getVendorPrefixedEventName('transitionend');
