/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** EventListenerWWW 保存为 www fork 转接 EventListener 实现并保持相同监听契约所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
const EventListenerWWW = require('EventListener');

import typeof * as EventListenerType from '../EventListener';
import typeof * as EventListenerShimType from './EventListener-www';

/** addEventBubbleListener 管理为 www fork 转接 EventListener 实现并保持相同监听契约的注册/监听边界；避免同一容器重复安装或遗漏 capture 配置。 */
export function addEventBubbleListener(
  target: EventTarget,
  eventType: string,
  listener: Function,
): mixed {
  return EventListenerWWW.listen(target, eventType, listener);
}

/** addEventCaptureListener 管理为 www fork 转接 EventListener 实现并保持相同监听契约的注册/监听边界；避免同一容器重复安装或遗漏 capture 配置。 */
export function addEventCaptureListener(
  target: EventTarget,
  eventType: string,
  listener: Function,
): mixed {
  return EventListenerWWW.capture(target, eventType, listener);
}

/** addEventCaptureListenerWithPassiveFlag 管理为 www fork 转接 EventListener 实现并保持相同监听契约的注册/监听边界；避免同一容器重复安装或遗漏 capture 配置。 */
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

/** addEventBubbleListenerWithPassiveFlag 管理为 www fork 转接 EventListener 实现并保持相同监听契约的注册/监听边界；避免同一容器重复安装或遗漏 capture 配置。 */
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

/** removeEventListener 管理为 www fork 转接 EventListener 实现并保持相同监听契约的注册/监听边界；避免同一容器重复安装或遗漏 capture 配置。 */
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
