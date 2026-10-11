/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactNodeList, ReactFormState} from 'shared/ReactTypes';
import type {
  FiberRoot,
  SuspenseHydrationCallbacks,
  TransitionTracingCallbacks,
} from './ReactInternalTypes';
import type {RootTag} from './ReactRootTags';
import type {Cache} from './ReactFiberCacheComponent';
import type {Container} from './ReactFiberConfig';

import {noTimeout} from './ReactFiberConfig';
import {createHostRootFiber} from './ReactFiber';
import {
  NoLane,
  NoLanes,
  NoTimestamp,
  TotalLanes,
  createLaneMap,
} from './ReactFiberLane';
import {
  enableSuspenseCallback,
  enableProfilerCommitHooks,
  enableProfilerTimer,
  enableUpdaterTracking,
  enableTransitionTracing,
  disableLegacyMode,
  enableViewTransition,
  enableGestureTransition,
  enableDefaultTransitionIndicator,
} from 'shared/ReactFeatureFlags';
import {initializeUpdateQueue} from './ReactFiberClassUpdateQueue';
import {LegacyRoot, ConcurrentRoot} from './ReactRootTags';
import {createCache, retainCache} from './ReactFiberCacheComponent';

/** HostRoot Fiber 的 memoizedState；current 保存已提交基线，WIP 保存本轮候选元素、hydration 状态与主 cache。 */
export type RootState = {
  /** 该版 HostRoot 的 React children；处理根队列后，WIP 会写入本轮候选 element。 */
  element: any,
  /** root 是否仍以服务端宿主树作为 hydration 起点。 */
  isDehydrated: boolean,
  /** 该版 HostRoot 向后代 cache 边界与 `use` 提供的根 cache。 */
  cache: Cache,
};

/**
 * 初始化 FiberRoot 的跨 render 状态容器。
 *
 * 它持有宿主容器、current Fiber、Lane 集合/过期表、Scheduler callback、错误回调、cache、
 * hydration/transition/gesture/profiling 等可选状态；具体 HostRoot Fiber 在 createFiberRoot 中循环绑定。
 */
function FiberRootNode(
  this: $FlowFixMe,
  containerInfo: any,
  // $FlowFixMe[missing-local-annot]
  tag,
  hydrate: any,
  identifierPrefix: any,
  onUncaughtError: any,
  onCaughtError: any,
  onRecoverableError: any,
  onDefaultTransitionIndicator: any,
  formState: ReactFormState<any, any> | null,
) {
  this.tag = disableLegacyMode ? ConcurrentRoot : tag;
  this.containerInfo = containerInfo;
  this.pendingChildren = null;
  this.current = null;
  this.pingCache = null;
  this.timeoutHandle = noTimeout;
  this.cancelPendingCommit = null;
  this.context = null;
  this.pendingContext = null;
  this.next = null;
  this.callbackNode = null;
  this.callbackPriority = NoLane;
  // 每个 Lane 的绝对过期时间；NoTimestamp 表示尚未开始饥饿计时。
  this.expirationTimes = createLaneMap(NoTimestamp);

  // 根级 Lane 状态机：待处理、挂起、被 ping、预热、过期与禁止错误恢复分别独立追踪。
  this.pendingLanes = NoLanes;
  this.suspendedLanes = NoLanes;
  this.pingedLanes = NoLanes;
  this.warmLanes = NoLanes;
  this.expiredLanes = NoLanes;
  if (enableDefaultTransitionIndicator) {
    this.indicatorLanes = NoLanes;
  }
  this.errorRecoveryDisabledLanes = NoLanes;
  this.shellSuspendCounter = 0;

  // 被 entangle 的 Lanes 必须在同一批次一起选择，避免相关 transition 被部分提交。
  this.entangledLanes = NoLanes;
  this.entanglements = createLaneMap(NoLanes);

  // 按原 Lane 登记 hidden subtree 的 update 引用；更新仍在组件队列中，Lane 完成时清除其 Offscreen 标记。
  this.hiddenUpdates = createLaneMap(null);

  this.identifierPrefix = identifierPrefix;
  this.onUncaughtError = onUncaughtError;
  this.onCaughtError = onCaughtError;
  this.onRecoverableError = onRecoverableError;

  if (enableDefaultTransitionIndicator) {
    this.onDefaultTransitionIndicator = onDefaultTransitionIndicator;
    this.pendingIndicator = null;
  }

  // render 间临时复用的新边界 cache；pooledCacheLanes 记录仍依赖它的工作。
  this.pooledCache = null;
  this.pooledCacheLanes = NoLanes;

  if (enableSuspenseCallback) {
    this.hydrationCallbacks = null;
  }

  this.formState = formState;

  if (enableViewTransition) {
    this.transitionTypes = null;
  }

  if (enableGestureTransition) {
    this.pendingGestures = null;
    this.gestureClone = null;
  }

  // 所有构建都创建 Map，以便追踪尚未完成的 transition 及其开始/结束元数据。
  this.incompleteTransitions = new Map();
  if (enableTransitionTracing) {
    this.transitionCallbacks = null;
    this.transitionLanes = createLaneMap(null);
  }

  if (enableProfilerTimer && enableProfilerCommitHooks) {
    this.effectDuration = -0;
    this.passiveEffectDuration = -0;
  }

  if (enableUpdaterTracking) {
    this.memoizedUpdaters = new Set();
    const pendingUpdatersLaneMap = (this.pendingUpdatersLaneMap = []);
    for (let i = 0; i < TotalLanes; i++) {
      pendingUpdatersLaneMap.push(new Set());
    }
  }

  if (__DEV__) {
    if (disableLegacyMode) {
      // TODO：该调试名称当前按 DOM 风格 API 推导，不同 renderer 可能需要自行提供。
      this._debugRootType = hydrate ? 'hydrateRoot()' : 'createRoot()';
    } else {
      switch (tag) {
        case ConcurrentRoot:
          this._debugRootType = hydrate ? 'hydrateRoot()' : 'createRoot()';
          break;
        case LegacyRoot:
          this._debugRootType = hydrate ? 'hydrate()' : 'render()';
          break;
      }
    }
  }
}

/**
 * 创建 FiberRoot、HostRoot Fiber、初始 cache/state 与 update queue，并建立双向绑定。
 *
 * `hydrate` 只设置初始认领状态；真正 hydration 由 begin/complete/HostConfig 路径执行。
 * 两次 retain 同一 initialCache，分别代表已提交 RootState 与 render 临时 pooledCache 的独立所有权。
 */
export function createFiberRoot(
  containerInfo: Container,
  tag: RootTag,
  hydrate: boolean,
  initialChildren: ReactNodeList,
  hydrationCallbacks: null | SuspenseHydrationCallbacks,
  isStrictMode: boolean,
  // TODO：若干参数概念上属于 HostConfig，但值在运行时提供，只能逐层传入 root 构造器；
  // 可考虑由 renderer 定义单一 DynamicHostConfig 类型统一承载。
  identifierPrefix: string,
  formState: ReactFormState<any, any> | null,
  onUncaughtError: (
    error: mixed,
    errorInfo: {
      /** 未被错误边界捕获的错误发生时可用的组件栈。 */
      +componentStack?: ?string
    },
  ) => void,
  onCaughtError: (
    error: mixed,
    errorInfo: {
      /** 被错误边界捕获时的组件栈。 */
      +componentStack?: ?string,
      /** 实际捕获该错误的 class error boundary 实例。 */
      +errorBoundary?: ?component(...props: any),
    },
  ) => void,
  onRecoverableError: (
    error: mixed,
    errorInfo: {
      /** React 已恢复的错误对应组件栈。 */
      +componentStack?: ?string
    },
  ) => void,
  onDefaultTransitionIndicator: () => void | (() => void),
  transitionCallbacks: null | TransitionTracingCallbacks,
): FiberRoot {
  // $FlowFixMe[invalid-constructor] Flow no longer supports calling new on functions
  const root: FiberRoot = new FiberRootNode(
    containerInfo,
    tag,
    hydrate,
    identifierPrefix,
    onUncaughtError,
    onCaughtError,
    onRecoverableError,
    onDefaultTransitionIndicator,
    formState,
  ) as any;
  if (enableSuspenseCallback) {
    root.hydrationCallbacks = hydrationCallbacks;
  }

  if (enableTransitionTracing) {
    root.transitionCallbacks = transitionCallbacks;
  }

  // 循环构造：root.current 指向 HostRoot Fiber，HostRoot.stateNode 再指回 root；stateNode 为 any，
  // 因而当前 Flow 类型无法静态证明这组双向不变量。
  const uninitializedFiber = createHostRootFiber(tag, isStrictMode);
  root.current = uninitializedFiber;
  uninitializedFiber.stateNode = root;

  const initialCache = createCache();
  retainCache(initialCache);

  // pooledCache 在 render 中临时提供给新挂载边界；render 结束时要么在 commit 后释放，
  // 要么因挂起转移给 Offscreen。它与 memoizedState.cache 生命周期不同，必须单独 retain。
  root.pooledCache = initialCache;
  retainCache(initialCache);
  const initialState: RootState = {
    element: initialChildren,
    isDehydrated: hydrate,
    cache: initialCache,
  };
  uninitializedFiber.memoizedState = initialState;

  initializeUpdateQueue(uninitializedFiber);

  return root;
}
