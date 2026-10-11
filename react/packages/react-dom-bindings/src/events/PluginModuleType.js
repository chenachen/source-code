/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** 插件接受的浏览器 Event 类型。 */
export type AnyNativeEvent = Event | KeyboardEvent | MouseEvent | TouchEvent;

/** 插件注册名称。 */
export type PluginName = string;

/** 插件调用中携带的来源/阶段位标志。 */
export type EventSystemFlags = number;
