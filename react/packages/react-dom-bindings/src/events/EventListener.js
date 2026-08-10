/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** addEventBubbleListener 管理封装浏览器 addEventListener/removeEventListener 的 capture、passive 与 once 选项的注册/监听边界；避免同一容器重复安装或遗漏 capture 配置。 */
export function addEventBubbleListener(
  target: EventTarget,
  eventType: string,
  listener: Function,
): Function {
  target.addEventListener(eventType, listener, false);
  return listener;
}

/** addEventCaptureListener 管理封装浏览器 addEventListener/removeEventListener 的 capture、passive 与 once 选项的注册/监听边界；避免同一容器重复安装或遗漏 capture 配置。 */
export function addEventCaptureListener(
  target: EventTarget,
  eventType: string,
  listener: Function,
): Function {
  target.addEventListener(eventType, listener, true);
  return listener;
}

/** addEventCaptureListenerWithPassiveFlag 管理封装浏览器 addEventListener/removeEventListener 的 capture、passive 与 once 选项的注册/监听边界；避免同一容器重复安装或遗漏 capture 配置。 */
export function addEventCaptureListenerWithPassiveFlag(
  target: EventTarget,
  eventType: string,
  listener: Function,
  passive: boolean,
): Function {
  target.addEventListener(eventType, listener, {
    capture: true,
    passive,
  });
  return listener;
}

/** addEventBubbleListenerWithPassiveFlag 管理封装浏览器 addEventListener/removeEventListener 的 capture、passive 与 once 选项的注册/监听边界；避免同一容器重复安装或遗漏 capture 配置。 */
export function addEventBubbleListenerWithPassiveFlag(
  target: EventTarget,
  eventType: string,
  listener: Function,
  passive: boolean,
): Function {
  target.addEventListener(eventType, listener, {
    passive,
  });
  return listener;
}

/** removeEventListener 管理封装浏览器 addEventListener/removeEventListener 的 capture、passive 与 once 选项的注册/监听边界；避免同一容器重复安装或遗漏 capture 配置。 */
export function removeEventListener(
  target: EventTarget,
  eventType: string,
  listener: Function,
  capture: boolean,
): void {
  target.removeEventListener(eventType, listener, capture);
}
