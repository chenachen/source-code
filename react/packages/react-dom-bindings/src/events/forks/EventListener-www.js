/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** WWW 宿主提供的监听实现，安装方法返回带 remove 的订阅对象。 */
const EventListenerWWW = require('EventListener');

import typeof * as EventListenerType from '../EventListener';
import typeof * as EventListenerShimType from './EventListener-www';

/** 在目标安装原生 bubble listener 并返回WWW 可移除的订阅对象。 */
export function addEventBubbleListener(
  target: EventTarget,
  eventType: string,
  listener: Function,
): mixed {
  return EventListenerWWW.listen(target, eventType, listener);
}

/** 在目标安装原生 capture listener 并返回WWW 可移除的订阅对象。 */
export function addEventCaptureListener(
  target: EventTarget,
  eventType: string,
  listener: Function,
): mixed {
  return EventListenerWWW.capture(target, eventType, listener);
}

/** 按指定 passive 值安装 capture listener；返回WWW 订阅对象。 */
export function addEventCaptureListenerWithPassiveFlag(
  target: EventTarget,
  eventType: string,
  listener: Function,
  passive: boolean,
): mixed {
  return EventListenerWWW.captureWithPassiveFlag(
    target,
    eventType,
    listener,
    passive,
  );
}

/** 按指定 passive 值安装 bubble listener；返回WWW 订阅对象。 */
export function addEventBubbleListenerWithPassiveFlag(
  target: EventTarget,
  eventType: string,
  listener: Function,
  passive: boolean,
): mixed {
  return EventListenerWWW.bubbleWithPassiveFlag(
    target,
    eventType,
    listener,
    passive,
  );
}

/** 调用 WWW 订阅对象的 remove 解除监听；其余参数保持公共签名。 */
export function removeEventListener(
  target: EventTarget,
  eventType: string,
  listener: Function,
  capture: boolean,
) {
  listener.remove();
}

// 利用 Flow 校验该 fork 的导出与原始版本完全一致。
null as any as EventListenerType as EventListenerShimType as EventListenerType;
