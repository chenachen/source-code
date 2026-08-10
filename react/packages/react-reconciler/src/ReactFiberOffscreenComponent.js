/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactNodeList, Wakeable} from 'shared/ReactTypes';
import type {Lanes} from './ReactFiberLane';
import type {SpawnedCachePool} from './ReactFiberCacheComponent';
import type {Transition} from 'react/src/ReactStartTransition';
import type {TracingMarkerInstance} from './ReactFiberTracingMarkerComponent';
import type {RetryQueue} from './ReactFiberSuspenseComponent';

/** Offscreen 子树的可见、隐藏或仅延迟工作模式。 */
type OffscreenMode = 'hidden' | 'unstable-defer-without-hiding' | 'visible';

/** 旧版 LegacyHidden 组件接受的内部属性。 */
export type LegacyHiddenProps = {
  /** 控制子树隐藏或可见的模式；空值按默认可见处理。 */
  mode?: OffscreenMode | null | void,
  /** 被隐藏、延迟或显示的 React 子树。 */
  children?: ReactNodeList,
};

/** Offscreen Fiber 接受的内部属性。 */
export type OffscreenProps = {
  /**
   * 控制子树可见性与延迟策略。
   * TODO: 对外暴露 Offscreen 前确定正式 API；当前枚举为未来“隐藏但保留布局”等变体
   * 留出空间。默认 visible 对名为 Offscreen 的组件略显反直觉，也可考虑 Visibility。
   */
  mode?: OffscreenMode | null | void,
  /** 受 Offscreen 生命周期与可见性控制的 React 子树。 */
  children?: ReactNodeList,
};

/**
 * 隐藏 Offscreen Fiber 的 memoizedState；对象存在本身即表示组件当前隐藏。
 */
export type OffscreenState = {
  /**
   * 重新显示时必须纳入渲染的基础 Lane。
   * TODO: 当前始终为 NoLanes，尚未真正参与恢复调度。
   */
  baseLanes: Lanes,
  /** 挂起或延迟子树继续渲染时要恢复的 Cache 池。 */
  cachePool: SpawnedCachePool | null,
};

/** Offscreen Fiber 在提交与重试阶段积累的异步副作用队列。 */
export type OffscreenQueue = {
  /** 与该隐藏/显示过程关联的 Transition。 */
  transitions: Array<Transition> | null,
  /** Transition tracing 中等待完成的 marker 实例。 */
  markerInstances: Array<TracingMarkerInstance> | null,
  /** 令 Offscreen 子树挂起、需要在解决后重试的 Wakeable 集。 */
  retryQueue: RetryQueue | null,
};

/** OffscreenInstance `_visibility` 字段使用的位标记集合。 */
type OffscreenVisibility = number;

/** Offscreen 子树当前对用户可见。 */
export const OffscreenVisible = /*                     */ 0b001;
/** 隐藏子树的 passive effects 当前仍与外部系统连接。 */
export const OffscreenPassiveEffectsConnected = /*     */ 0b010;

/** 提交阶段挂在 Offscreen Fiber 上的可变宿主状态。 */
export type OffscreenInstance = {
  /** 当前可见性与 passive effect 连接位。 */
  _visibility: OffscreenVisibility,
  /** 隐藏期间等待该边界完成的 tracing markers。 */
  _pendingMarkers: Set<TracingMarkerInstance> | null,
  /** 隐藏或重新显示过程涉及的 Transition 集。 */
  _transitions: Set<Transition> | null,
  /** 已登记过重试监听器的 Wakeable，防止重复挂接。 */
  _retryCache: WeakSet<Wakeable> | Set<Wakeable> | null,
};
