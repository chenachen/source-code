/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import getVendorPrefixedEventName from './getVendorPrefixedEventName';

/** DOMEventName 定义 Flow 数据形状，用于限定 React DOM 事件系统接受的原生事件名；类型边界阻止插件、原生事件与 Fiber 状态混用。 */
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

/** ANIMATION_END 是限定 React DOM 事件系统接受的原生事件名使用的稳定常量，避免在热路径重复分配或推导。 */
export const ANIMATION_END: DOMEventName =
  getVendorPrefixedEventName('animationend');
/** ANIMATION_ITERATION 是限定 React DOM 事件系统接受的原生事件名使用的稳定常量，避免在热路径重复分配或推导。 */
export const ANIMATION_ITERATION: DOMEventName =
  getVendorPrefixedEventName('animationiteration');
/** ANIMATION_START 是限定 React DOM 事件系统接受的原生事件名使用的稳定常量，避免在热路径重复分配或推导。 */
export const ANIMATION_START: DOMEventName =
  getVendorPrefixedEventName('animationstart');

/** TRANSITION_RUN 是限定 React DOM 事件系统接受的原生事件名使用的稳定常量，避免在热路径重复分配或推导。 */
export const TRANSITION_RUN: DOMEventName =
  getVendorPrefixedEventName('transitionrun');
/** TRANSITION_START 是限定 React DOM 事件系统接受的原生事件名使用的稳定常量，避免在热路径重复分配或推导。 */
export const TRANSITION_START: DOMEventName =
  getVendorPrefixedEventName('transitionstart');
/** TRANSITION_CANCEL 是限定 React DOM 事件系统接受的原生事件名使用的稳定常量，避免在热路径重复分配或推导。 */
export const TRANSITION_CANCEL: DOMEventName =
  getVendorPrefixedEventName('transitioncancel');
/** TRANSITION_END 是限定 React DOM 事件系统接受的原生事件名使用的稳定常量，避免在热路径重复分配或推导。 */
export const TRANSITION_END: DOMEventName =
  getVendorPrefixedEventName('transitionend');
