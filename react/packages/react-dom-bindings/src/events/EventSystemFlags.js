/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** 原生 listener 的来源、阶段及兼容路径位标志。 */
export type EventSystemFlags = number;

/** listener 安装在非 React 管理的 EventTarget 上，跳过 Fiber 根匹配和兼容插件。 */
export const IS_EVENT_HANDLE_NON_MANAGED_NODE = 1;
/** listener 直接安装在目标节点上；跳过根边界匹配和兼容插件。 */
export const IS_NON_DELEGATED = 1 << 1;
/** 当前原生 listener 处于 capture 阶段。 */
export const IS_CAPTURE_PHASE = 1 << 2;
/** 保留的 passive 路径标志；实际安装选项由 addTrappedEventListener 决定。 */
export const IS_PASSIVE = 1 << 3;
/** 本轮已使用 legacy FB 延迟 listener，不再把 click 延迟一次。 */
export const IS_LEGACY_FB_SUPPORT_MODE = 1 << 4;

/** capture 或已延迟的 legacy listener 禁止再次向 document 延迟 click。 */
export const SHOULD_NOT_DEFER_CLICK_FOR_FB_SUPPORT_MODE =
  IS_LEGACY_FB_SUPPORT_MODE | IS_CAPTURE_PHASE;

// 非受管目标、目标本地监听和原生 capture 路径跳过依赖共享状态的兼容插件。
/** 非 React 目标、non-delegated 或原生 capture 路径只运行基础插件，避免重复改变兼容插件状态。 */
export const SHOULD_NOT_PROCESS_POLYFILL_EVENT_PLUGINS =
  IS_EVENT_HANDLE_NON_MANAGED_NODE | IS_NON_DELEGATED | IS_CAPTURE_PHASE;
