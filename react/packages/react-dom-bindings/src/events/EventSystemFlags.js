/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** EventSystemFlags 定义 Flow 数据形状，用于定义事件分发上下文的位标志并组合 capture、non-managed 与 replay 路径；类型边界阻止插件、原生事件与 Fiber 状态混用。 */
export type EventSystemFlags = number;

/** IS_EVENT_HANDLE_NON_MANAGED_NODE 保存定义事件分发上下文的位标志并组合 capture、non-managed 与 replay 路径所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const IS_EVENT_HANDLE_NON_MANAGED_NODE = 1;
/** IS_NON_DELEGATED 是定义事件分发上下文的位标志并组合 capture、non-managed 与 replay 路径使用的稳定常量，避免在热路径重复分配或推导。 */
export const IS_NON_DELEGATED = 1 << 1;
/** IS_CAPTURE_PHASE 保存定义事件分发上下文的位标志并组合 capture、non-managed 与 replay 路径所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const IS_CAPTURE_PHASE = 1 << 2;
/** IS_PASSIVE 是定义事件分发上下文的位标志并组合 capture、non-managed 与 replay 路径使用的稳定常量，避免在热路径重复分配或推导。 */
export const IS_PASSIVE = 1 << 3;
/** IS_LEGACY_FB_SUPPORT_MODE 是定义事件分发上下文的位标志并组合 capture、non-managed 与 replay 路径使用的稳定常量，避免在热路径重复分配或推导。 */
export const IS_LEGACY_FB_SUPPORT_MODE = 1 << 4;

/** SHOULD_NOT_DEFER_CLICK_FOR_FB_SUPPORT_MODE 是定义事件分发上下文的位标志并组合 capture、non-managed 与 replay 路径使用的稳定常量，避免在热路径重复分配或推导。 */
export const SHOULD_NOT_DEFER_CLICK_FOR_FB_SUPPORT_MODE =
  IS_LEGACY_FB_SUPPORT_MODE | IS_CAPTURE_PHASE;

// 若事件系统已经设置
// LEGACY_FB_SUPPORT，则不能再次延迟。该标志只会在
// willDeferLaterForLegacyFBSupport 调用时设置；若此处不提前退出，
// 会形成类似无限循环的反复延迟。
// 事件重放期间同样不能延迟。
/** SHOULD_NOT_PROCESS_POLYFILL_EVENT_PLUGINS 保存定义事件分发上下文的位标志并组合 capture、non-managed 与 replay 路径所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。 */
export const SHOULD_NOT_PROCESS_POLYFILL_EVENT_PLUGINS =
  IS_EVENT_HANDLE_NON_MANAGED_NODE | IS_NON_DELEGATED | IS_CAPTURE_PHASE;
