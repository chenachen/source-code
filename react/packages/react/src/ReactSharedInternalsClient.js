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

/**
 * renderer 在普通 transition scope 返回后接收 transition 记录和返回值的钩子。
 * 返回值可能是 thenable，renderer 据此纠缠 action；此钩子本身不返回公共 start 的结果。
 */
type onStartTransitionFinish = (Transition, mixed) => void;
/**
 * renderer 接收当前 transition、宿主 gesture provider 与可选区间后启动手势工作。
 * 返回清理函数交给 startGestureTransition 调用方，用于结束该 provider 驱动的工作。
 */
type onStartGestureTransitionFinish = (
  Transition,
  GestureProvider,
  ?GestureOptions,
) => () => void;

/**
 * React 客户端入口与 renderer 之间共享的可变槽位。
 *
 * 短字段名属于发布产物协议。H/A 随渲染切换；T 随 transition 回调切换；
 * S/G 由 renderer 安装，用来接收 scope 返回值或启动手势工作。
 */
export type SharedStateClient = {
  /** Hooks 当前 dispatcher（旧名 ReactCurrentDispatcher）。 */
  H: null | Dispatcher,
  /** Cache 当前异步 dispatcher（旧名 ReactCurrentCache）。 */
  A: null | AsyncDispatcher,
  /** 当前 transition（旧名 ReactCurrentBatchConfig）。 */
  T: null | Transition,
  /** 普通 transition 的 scope 返回后调用，renderer 据返回值登记异步 action。 */
  S: null | onStartTransitionFinish,
  /** 手势 transition 的 scope 返回后调用，renderer 启动手势工作并返回清理函数。 */
  G: null | onStartGestureTransitionFinish,

  // 以下槽位仅在开发环境初始化，用于 `act` 与诊断。

  /** `act` 拦截的 renderer 工作队列（旧名 ReactCurrentActQueue）。 */
  actQueue: null | Array<RendererTask>,

  /** 已登记且尚未落定的异步 transition 数量；供 DEV 诊断，不标识当前调用的来源。 */
  asyncTransitions: number,

  /** 是否正在模拟旧模式 `batchedUpdates` 的批处理边界。 */
  isBatchingLegacy: boolean,
  /** 当前旧模式批次是否调度过更新，供 `act` 判断是否立即冲刷。 */
  didScheduleLegacyUpdate: boolean,

  /**
   * 当前 renderer 任务是否读取过 thenable。`act` 每次执行任务前复位；
   * 任务返回 continuation 且此标记为真时先让出给微任务，使已经兑现的 Promise 有机会 ping。
   */
  didUsePromise: boolean,

  /** 当前 `act` 作用域收集到的未捕获错误。 */
  thrownErrors: Array<mixed>,

  /** 当前 renderer 注入的组件栈读取器（旧名 ReactDebugCurrentFrame）。 */
  getCurrentStack: null | (() => string),

  /** 当前采样窗口的元素创建计数；超过 ownerStackLimit 后复用未知栈，重置器周期归零。 */
  recentlyCreatedOwnerStacks: 0,
};

/**
 * renderer 队列任务：布尔参数是 Scheduler 的 didTimeout，act 冲刷固定传 false。
 * 返回后续任务可形成链，为 null 时结束；任务/链的保存与错误处理归调用方队列。
 */
export type RendererTask = boolean => RendererTask | null;

/** 当前 React 模块实例的共享状态；公共 API 与对应 renderer 必须使用同一份对象。 */
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
