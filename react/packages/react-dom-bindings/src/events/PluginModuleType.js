/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** AnyNativeEvent 定义 Flow 数据形状，用于描述事件插件 extractEvents 的 Flow 调用契约；类型边界阻止插件、原生事件与 Fiber 状态混用。 */
export type AnyNativeEvent = Event | KeyboardEvent | MouseEvent | TouchEvent;

/** PluginName 定义 Flow 数据形状，用于描述事件插件 extractEvents 的 Flow 调用契约；类型边界阻止插件、原生事件与 Fiber 状态混用。 */
export type PluginName = string;

/** EventSystemFlags 定义 Flow 数据形状，用于描述事件插件 extractEvents 的 Flow 调用契约；类型边界阻止插件、原生事件与 Fiber 状态混用。 */
export type EventSystemFlags = number;
