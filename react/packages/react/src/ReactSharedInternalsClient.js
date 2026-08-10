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
import type {Transition} from './ReactStartTransition';
import type {GestureProvider, GestureOptions} from 'shared/ReactTypes';

import {enableGestureTransition} from 'shared/ReactFeatureFlags';

/** renderer 在普通 transition 回调结束后接收结果的钩子签名。 */
type onStartTransitionFinish = (Transition, mixed) => void;
/** renderer 在手势 transition 启动后返回清理函数的钩子签名。 */
type onStartGestureTransitionFinish = (
  Transition,
  GestureProvider,
  ?GestureOptions,
) => () => void;

/**
 * React 客户端入口与 renderer 之间共享的可变槽位。
 *
 * 短字段名属于发布产物协议；renderer 在进入/退出渲染阶段时成对安装并恢复这些值。
 */
export type SharedStateClient = {
  /** Hooks 当前 dispatcher（旧名 ReactCurrentDispatcher）。 */
  H: null | Dispatcher,
  /** Cache 当前异步 dispatcher（旧名 ReactCurrentCache）。 */
  A: null | AsyncDispatcher,
  /** 当前 transition（旧名 ReactCurrentBatchConfig）。 */
  T: null | Transition,
  /** 普通 transition 完成后的 renderer 回调。 */
  S: null | onStartTransitionFinish,
  /** 手势 transition 完成后的 renderer 回调。 */
  G: null | onStartGestureTransitionFinish,

  // 以下槽位仅在开发环境初始化，用于 `act` 与诊断。

  /** `act` 拦截的 renderer 工作队列（旧名 ReactCurrentActQueue）。 */
  actQueue: null | Array<RendererTask>,

  /** 异步 `startTransition` 嵌套计数；为零表示当前不在异步间隙中。 */
  asyncTransitions: number,

  /** 是否正在模拟旧模式 `batchedUpdates` 的批处理边界。 */
  isBatchingLegacy: boolean,
  /** 当前旧模式批次是否调度过更新，供 `act` 判断是否立即冲刷。 */
  didScheduleLegacyUpdate: boolean,

  /**
   * 当前工作批次是否调用过 `use`；为真时 `act` 会让出到微任务，先解包已经兑现的 Promise，
   * 从而避免把可同步继续的工作误判为挂起。
   */
  didUsePromise: boolean,

  /** 当前 `act` 作用域收集到的未捕获错误。 */
  thrownErrors: Array<mixed>,

  /** 当前 renderer 注入的组件栈读取器（旧名 ReactDebugCurrentFrame）。 */
  getCurrentStack: null | (() => string),

  /** 最近创建 owner 栈的重置代数，供开发态去重/失效。 */
  recentlyCreatedOwnerStacks: 0,
};

/** renderer 队列任务：返回后续任务可形成链，为 `null` 时链结束。 */
export type RendererTask = boolean => RendererTask | null;

/** 客户端单例共享状态；所有 React 副本内的公共 API 都通过它与 renderer 协作。 */
const ReactSharedInternals: SharedStateClient = {
  H: null,
  A: null,
  T: null,
  S: null,
} as any;
if (enableGestureTransition) {
  ReactSharedInternals.G = null;
}

if (__DEV__) {
  ReactSharedInternals.actQueue = null;
  ReactSharedInternals.asyncTransitions = 0;
  ReactSharedInternals.isBatchingLegacy = false;
  ReactSharedInternals.didScheduleLegacyUpdate = false;
  ReactSharedInternals.didUsePromise = false;
  ReactSharedInternals.thrownErrors = [];
  // 栈实现由当前 renderer 注入；React 核心本身不依赖具体 Fiber 表示。
  ReactSharedInternals.getCurrentStack = null as null | (() => string);
  ReactSharedInternals.recentlyCreatedOwnerStacks = 0;
}

export default ReactSharedInternals;
