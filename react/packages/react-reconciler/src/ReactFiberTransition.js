/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */
import type {Fiber, FiberRoot} from './ReactInternalTypes';
import type {
  Thenable,
  GestureProvider,
  GestureOptions,
} from 'shared/ReactTypes';
import {NoLane, type Lanes} from './ReactFiberLane';
import type {StackCursor} from './ReactFiberStack';
import type {Cache, SpawnedCachePool} from './ReactFiberCacheComponent';
import type {Transition} from 'react/src/ReactStartTransition';
import type {ScheduledGesture} from './ReactFiberGestureScheduler';

import {
  enableTransitionTracing,
  enableViewTransition,
  enableGestureTransition,
} from 'shared/ReactFeatureFlags';
import {isPrimaryRenderer} from './ReactFiberConfig';
import {createCursor, push, pop} from './ReactFiberStack';
import {
  getWorkInProgressRoot,
  getWorkInProgressTransitions,
  markTransitionStarted,
} from './ReactFiberWorkLoop';
import {
  createCache,
  retainCache,
  CacheContext,
} from './ReactFiberCacheComponent';
import {
  queueTransitionTypes,
  entangleAsyncTransitionTypes,
  entangledTransitionTypes,
} from './ReactFiberTransitionTypes';

import ReactSharedInternals from 'shared/ReactSharedInternals';
import {
  entangleAsyncAction,
  peekEntangledActionLane,
} from './ReactFiberAsyncAction';
import {startAsyncTransitionTimer} from './ReactProfilerTimer';
import {firstScheduledRoot} from './ReactFiberRootScheduler';
import {
  startScheduledGesture,
  cancelScheduledGesture,
} from './ReactFiberGestureScheduler';

/** 表示当前不处于任何 `startTransition` 作用域。 */
export const NoTransition = null;

// 把本 reconciler 的 onStartTransitionFinish 实现挂到共享 internals，使同构层的
// startTransition 能把多个 renderer 的结束处理组合起来。
//
//   function startTransition(fn) {
//     return startTransitionDOM(() => {
//       return startTransitionART(() => {
//         return startTransitionThreeFiber(() => {
//           // 还可以继续嵌套其他 renderer……
//           return fn();
//         });
//       });
//     });
//   }
//
/** 保存安装本 renderer 完成通知前的共享 startTransition 回调；新的 S 处理完当前 Transition 后继续调用它，以组合多个 renderer 的完成逻辑。 */
const prevOnStartTransitionFinish = ReactSharedInternals.S;
/**
 * 将同构 startTransition 的完成通知接到 reconciler：记录开始时间，并把返回的
 * thenable 加入共享异步 Action 范围。同步返回值不进入该范围。
 * 当前 Transition 的视图类型传给已调度根；最后接续之前 renderer 注册的通知。
 * @param transition 刚结束同步作用域的 Transition，其 types 会参与视图过渡类型合并。
 * @param returnValue scope 的返回值；只有对象 thenable 会延长 Action 的待完成时间。
 */
ReactSharedInternals.S = function onStartTransitionFinishForReconciler(
  transition: Transition,
  returnValue: mixed,
) {
  markTransitionStarted();
  if (
    typeof returnValue === 'object' &&
    returnValue !== null &&
    typeof returnValue.then === 'function'
  ) {
    // Action 会先等待异步工作再调度更新；记录起点以统计被 Action 阻塞的时长。
    // 理想上还应包含同步部分，但它从同构层开始，跨层传递 performance.now() 又要
    // 兼容 polyfill，目前暂不纳入。
    startAsyncTransitionTimer();

    // 返回 Thenable 表示这是异步 Action。
    const thenable: Thenable<mixed> = returnValue as any;
    entangleAsyncAction(transition, thenable);
  }
  if (enableViewTransition) {
    if (entangledTransitionTypes !== null) {
      // 新根若在本轮得到工作，也必须继承已纠缠的异步 Transition 类型。
      let root = firstScheduledRoot;
      while (root !== null) {
        queueTransitionTypes(root, entangledTransitionTypes);
        root = root.next;
      }
    }
    const transitionTypes = transition.types;
    if (transitionTypes !== null) {
      // 到这里，本 Transition 涉及更新的根都应已排入调度；没有更新的根不会应用
      // 该 Transition 类型。
      let root = firstScheduledRoot;
      while (root !== null) {
        queueTransitionTypes(root, transitionTypes);
        root = root.next;
      }
      if (peekEntangledActionLane() !== NoLane) {
        // 存在纠缠异步 Action 时，关联更新可能稍后才出现，先保存这些类型供后续根使用。
        entangleAsyncTransitionTypes(transitionTypes);
      }
    }
  }
  if (prevOnStartTransitionFinish !== null) {
    prevOnStartTransitionFinish(transition, returnValue);
  }
};

/**
 * 把一个根上的手势释放操作链接到已有取消链。
 *
 * 返回的函数先减少当前 ScheduledGesture 引用，再调用上一 renderer 的取消函数，
 * 使同构 `startGestureTransition` 能以一次清理释放全部 renderer。
 */
function chainGestureCancellation(
  root: FiberRoot,
  scheduledGesture: ScheduledGesture,
  prevCancel: null | (() => void),
): () => void {
  return /** 释放当前根对手势的调度引用，再接续此前 renderer 的取消链；异常向调用者传播。 */ function cancelGesture(): void {
    // $FlowFixMe[invalid-compare]
    if (scheduledGesture !== null) {
      cancelScheduledGesture(root, scheduledGesture);
    }
    if (prevCancel !== null) {
      prevCancel();
    }
  };
}

if (enableGestureTransition) {
  const prevOnStartGestureTransitionFinish = ReactSharedInternals.G;
  /**
   * 把同构手势作用域提交给每个已调度根，并组合跨 renderer 的取消函数。
   * @param transition 本次作用域的 Transition；types 决定相应视图过渡的类型集合。
   * @param provider renderer 用于订阅进度、创建手势动画的时间线提供者。
   * @param options 手势起点与方向范围等配置，由宿主手势调度解释。
   * @returns 释放各根手势引用的取消链；没有任何 renderer 参与时返回空操作。
   */
  ReactSharedInternals.G = function onStartGestureTransitionFinishForReconciler(
    transition: Transition,
    provider: GestureProvider,
    options: ?GestureOptions,
  ): () => void {
    let cancel = null;
    if (prevOnStartGestureTransitionFinish !== null) {
      cancel = prevOnStartGestureTransitionFinish(
        transition,
        provider,
        options,
      );
    }
    // 遍历所有已调度根，查找同 provider 的 ScheduledGesture 并增加引用计数，使
    // 当前取消回调持有它。即使某根没有在本回调中更新，只要共享 provider，也会
    // 刷新选项并保留到取消，因为概念上这个手势是全局启动的。
    let root = firstScheduledRoot;
    while (root !== null) {
      const scheduledGesture = startScheduledGesture(
        root,
        provider,
        options,
        transition.types,
      );
      if (scheduledGesture !== null) {
        cancel = chainGestureCancellation(root, scheduledGesture, cancel);
      }
      root = root.next;
    }
    if (cancel !== null) {
      return cancel;
    }
    return /** 没有 renderer 安排手势工作时，提供可直接调用的空取消函数。 */ function cancelGesture(): void {
      // 本 renderer 没有手势工作，但其他 renderer 可能已经安排。
    };
  };
}

/** 返回当前同构 `startTransition` 作用域中的 Transition，作用域外为空。 */
export function requestCurrentTransition(): Transition | null {
  return ReactSharedInternals.T;
}

/** 恢复 Suspense/Offscreen 边界曾保留的 Cache 池；子树重试优先复用该池，出栈后恢复外层池。 */
const resumedCache: StackCursor<Cache | null> = createCursor(null);

/**
 * 保存 render 中关联当前子树的 Transition 数组，并在边界 push/pop 时恢复外层数组。
 * 合并时允许重复项，实际完成/进度通知由 passive 阶段处理，避免每次压栈都去重。
 */
const transitionStack: StackCursor<Array<Transition> | null> =
  createCursor(null);

/**
 * 查看本轮渲染可复用的 Cache，优先选择恢复边界的旧池，否则读取根级 pooledCache。
 */
function peekCacheFromPool(): Cache | null {
  // 先检查边界恢复栈是否已有可用 Cache。

  // 在当前隐藏的 Suspense 边界内渲染时，应复用上次渲染的 Cache（若存在）。
  const cacheResumedFromPreviousRender = resumedCache.current;
  if (cacheResumedFromPreviousRender !== null) {
    return cacheResumedFromPreviousRender;
  }

  // 否则回退到根的缓存池。
  const root = getWorkInProgressRoot() as any;
  const cacheFromRootCachePool = root.pooledCache;

  return cacheFromRootCachePool;
}

/**
 * 为指定 render lanes 请求一个 Cache；池为空时在当前根新建并由根立即持有。
 *
 * 新 Cache 同时可被根池、HostRoot、Cache 边界或 Suspense Fiber 持有，后几类所有权
 * 会在 commit 阶段分别增加或释放引用。
 */
export function requestCacheFromPool(renderLanes: Lanes): Cache {
  // 与 peek 类似，但池中没有实例时会分配新 Cache。
  const cacheFromPool = peekCacheFromPool();
  if (cacheFromPool !== null) {
    return cacheFromPool;
  }

  // 新建 Cache 并放入根池。它可有多个所有者：
  // - FiberRoot 上的池是所有新 Cache 的创建点（refresh 暂为例外），创建后立即取得
  //   所有权。可把 root.pooledCache 理解为 owned Option<Arc<Cache>>，返回值则是借用。
  // - HostRoot、Cache 边界、Suspense 等 Fiber 在 commit 阶段 retain/release。

  const root = getWorkInProgressRoot() as any;
  const freshCache = createCache();
  root.pooledCache = freshCache;
  retainCache(freshCache);
  // $FlowFixMe[invalid-compare]
  if (freshCache !== null) {
    root.pooledCacheLanes |= renderLanes;
  }
  return freshCache;
}

/** 为根渲染压入本轮 Transition 列表，供 tracing 子树继承。 */
export function pushRootTransition(
  workInProgress: Fiber,
  root: FiberRoot,
  renderLanes: Lanes,
) {
  if (enableTransitionTracing) {
    const rootTransitions = getWorkInProgressTransitions();
    push(transitionStack, rootTransitions, workInProgress);
  }
}

/** 在根完成或退栈时恢复进入根之前的 Transition 栈。 */
export function popRootTransition(
  workInProgress: Fiber,
  root: FiberRoot,
  renderLanes: Lanes,
) {
  if (enableTransitionTracing) {
    pop(transitionStack, workInProgress);
  }
}

/**
 * 进入 Offscreen/Suspense 子树时压入恢复 Cache 与 Transition。
 *
 * Cache 选择前次池或继承当前值；Transition 在 tracing 开启时与父栈延迟拼接。
 */
export function pushTransition(
  offscreenWorkInProgress: Fiber,
  prevCachePool: SpawnedCachePool | null,
  newTransitions: Array<Transition> | null,
): void {
  if (prevCachePool === null) {
    push(resumedCache, resumedCache.current, offscreenWorkInProgress);
  } else {
    push(resumedCache, prevCachePool.pool, offscreenWorkInProgress);
  }

  if (enableTransitionTracing) {
    if (transitionStack.current === null) {
      push(transitionStack, newTransitions, offscreenWorkInProgress);
    } else if (newTransitions === null) {
      push(transitionStack, transitionStack.current, offscreenWorkInProgress);
    } else {
      push(
        transitionStack,
        transitionStack.current.concat(newTransitions),
        offscreenWorkInProgress,
      );
    }
  }
}

/** 在已有 current 的 Offscreen 工作完成时弹出 Transition 与恢复 Cache 栈。 */
export function popTransition(workInProgress: Fiber, current: Fiber | null) {
  if (current !== null) {
    if (enableTransitionTracing) {
      pop(transitionStack, workInProgress);
    }

    pop(resumedCache, workInProgress);
  }
}

/** 返回当前子树尚待 passive 阶段处理的 Transition 列表。 */
export function getPendingTransitions(): Array<Transition> | null {
  if (!enableTransitionTracing) {
    return null;
  }

  return transitionStack.current;
}

/**
 * 在 Suspense 边界挂起时捕获本轮 Cache 池快照。
 *
 * 同时保存父 Cache，恢复渲染时可判断期间是否发生 refresh，并继续用同一池读取
 * 新鲜数据。
 */
export function getSuspendedCache(): SpawnedCachePool | null {
  // 返回本轮原本用于渲染新鲜数据的 Cache，以便数据到达后用同一实例恢复。
  const cacheFromPool = peekCacheFromPool();
  if (cacheFromPool === null) {
    return null;
  }

  return {
    // 还要保存父 Cache，恢复时据此识别 refresh。
    // $FlowFixMe[constant-condition]
    parent: isPrimaryRenderer
      ? CacheContext._currentValue
      : CacheContext._currentValue2,
    pool: cacheFromPool,
  };
}

/** 为 Offscreen 延迟子树捕获 Cache 池及父 Cache，语义与 Suspense 快照相同。 */
export function getOffscreenDeferredCache(): SpawnedCachePool | null {
  const cacheFromPool = peekCacheFromPool();
  if (cacheFromPool === null) {
    return null;
  }

  return {
    // 保存父 Cache，恢复时据此识别 refresh。
    // $FlowFixMe[constant-condition]
    parent: isPrimaryRenderer
      ? CacheContext._currentValue
      : CacheContext._currentValue2,
    pool: cacheFromPool,
  };
}
