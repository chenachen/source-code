/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Dispatcher} from 'react-reconciler/src/ReactInternalTypes';
import type {AsyncDispatcher} from 'react-reconciler/src/ReactInternalTypes';

import type {
  Reference,
  TaintEntry,
  RequestCleanupQueue,
} from './ReactTaintRegistry';

import {
  TaintRegistryObjects,
  TaintRegistryValues,
  TaintRegistryByteLengths,
  TaintRegistryPendingRequests,
} from './ReactTaintRegistry';

import {enableTaint} from 'shared/ReactFeatureFlags';

/**
 * React 服务端入口与服务端 renderer 共享的可变槽位。
 *
 * 它保留 Hooks/Cache dispatcher，并在特性开启时把 taint 注册表暴露给请求生命周期。
 */
export type SharedStateServer = {
  /** Hooks 当前 dispatcher（旧名 ReactCurrentDispatcher）。 */
  H: null | Dispatcher,
  /** Cache 当前异步 dispatcher（旧名 ReactCurrentCache）。 */
  A: null | AsyncDispatcher,

  // 以下注册表仅在 `enableTaint` 开启时挂载。
  /** 以对象引用为键的污染消息表。 */
  TaintRegistryObjects: WeakMap<Reference, string>,
  /** 以原始值为键、带引用计数的污染记录表。 */
  TaintRegistryValues: Map<string | bigint, TaintEntry>,
  /** 曾被污染的二进制长度集合，用作快速候选筛选。 */
  TaintRegistryByteLengths: Set<number>,
  /** 仍持有污染值的在途请求清理队列集合。 */
  TaintRegistryPendingRequests: Set<RequestCleanupQueue>,

  // 以下槽位仅在开发环境初始化，用于诊断。

  /** 当前 renderer 注入的组件栈读取器（旧名 ReactDebugCurrentFrame）。 */
  getCurrentStack: null | (() => string),

  /** 最近创建 owner 栈的重置代数，供开发态去重/失效。 */
  recentlyCreatedOwnerStacks: 0,
};

/** renderer 队列任务：返回后续任务可形成链，为 `null` 时链结束。 */
export type RendererTask = boolean => RendererTask | null;

/** 服务端单例共享状态；由公共 React API 与 renderer 共同读写。 */
const ReactSharedInternals: SharedStateServer = {
  H: null,
  A: null,
} as any;

if (enableTaint) {
  ReactSharedInternals.TaintRegistryObjects = TaintRegistryObjects;
  ReactSharedInternals.TaintRegistryValues = TaintRegistryValues;
  ReactSharedInternals.TaintRegistryByteLengths = TaintRegistryByteLengths;
  ReactSharedInternals.TaintRegistryPendingRequests =
    TaintRegistryPendingRequests;
}

if (__DEV__) {
  // 栈实现由当前 renderer 注入；React 核心本身不依赖具体 Fiber 表示。
  ReactSharedInternals.getCurrentStack = null as null | (() => string);
  ReactSharedInternals.recentlyCreatedOwnerStacks = 0;
}

export default ReactSharedInternals;
