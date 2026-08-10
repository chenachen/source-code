/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  Thenable,
  FulfilledThenable,
  RejectedThenable,
} from 'shared/ReactTypes';
import type {Lane} from './ReactFiberLane';
import type {Transition} from 'react/src/ReactStartTransition';

import {
  requestTransitionLane,
  ensureScheduleIsScheduled,
} from './ReactFiberRootScheduler';
import {NoLane} from './ReactFiberLane';
import {
  hasScheduledTransitionWork,
  clearAsyncTransitionTimer,
} from './ReactProfilerTimer';
import {
  enableComponentPerformanceTrack,
  enableProfilerTimer,
  enableDefaultTransitionIndicator,
} from 'shared/ReactFeatureFlags';
import {clearEntangledAsyncTransitionTypes} from './ReactFiberTransitionTypes';

import noop from 'shared/noop';
import reportGlobalError from 'shared/reportGlobalError';

// 多个并发异步 Action 会被纠缠；只要该异步作用域尚未完成，期间发生的全部
// Transition 更新都视作同一个 Action 的组成部分。
//
// 理想行为是让每个 async 函数成为独立 Action，但没有 AsyncContext 一类机制时无法
// 判断更新属于哪一个，因此当前把它们全部合并进同一作用域。

// 纠缠作用域完成时需要通知的监听器。
let currentEntangledListeners: Array<() => mixed> | null = null;
// 纠缠作用域内尚未完成的异步 Action 数量。
let currentEntangledPendingCount: number = 0;
// 纠缠作用域内所有更新共享的 Transition Lane。
let currentEntangledLane: Lane = NoLane;
// 整个纠缠作用域完成时才兑现的 Thenable；它只用于让 UI 等待，不携带业务值。
let currentEntangledActionThenable: Thenable<void> | null = null;

// 跨根跟踪默认 Transition 指示器：undefined 表示尚无根登记，null 表示出现多个
// 不同回调而无法确定同构默认实现，此时禁用该能力。
let isomorphicDefaultTransitionIndicator:
  | void
  | null
  | (() => void | (() => void)) = undefined;
// 当前正在显示的默认指示器清理函数。
let pendingIsomorphicIndicator: null | (() => void) = null;
// 仍有待处理 Transition、因而继续持有默认指示器的根数量。
let pendingEntangledRoots: number = 0;
let needsIsomorphicIndicator: boolean = false;

/**
 * 把一个异步 Action 加入当前全局纠缠作用域。
 *
 * 首个 Action 创建共享 Lane 和仅用于挂起的聚合 Thenable；后续 Action 复用它们并
 * 增加待完成计数。原始 Thenable 的成功与失败都会触发同一 ping，因为 React 只需
 * 知道该 Action 已结束，业务结果仍由原 Thenable 保存。
 */
export function entangleAsyncAction<S>(
  transition: Transition,
  thenable: Thenable<S>,
): Thenable<S> {
  // thenable 是异步 Action 作用域函数的返回值；聚合 Thenable 要等全部作用域完成。
  if (currentEntangledListeners === null) {
    // 没有外层异步 Action 作用域，创建一个新纠缠组。
    const entangledListeners = (currentEntangledListeners = []);
    currentEntangledPendingCount = 0;
    currentEntangledLane = requestTransitionLane(transition);
    const entangledThenable: Thenable<void> = {
      status: 'pending',
      value: undefined,
      /** 登记等待整个纠缠作用域完成的 Suspense ping。 */
      then(resolve: void => mixed) {
        entangledListeners.push(resolve);
      },
    };
    currentEntangledActionThenable = entangledThenable;
    if (enableDefaultTransitionIndicator) {
      needsIsomorphicIndicator = true;
      // 在微任务中判断是否需要默认指示器；即使没有根工作也要保证调度器被唤醒。
      ensureScheduleIsScheduled();
    }
  }
  currentEntangledPendingCount++;
  thenable.then(pingEngtangledActionScope, pingEngtangledActionScope);
  return thenable;
}

/**
 * 响应单个异步 Action 完成；最后一个完成时关闭整个纠缠作用域。
 *
 * 它兑现共享 Thenable、通知所有等待者、复位共享 Lane/类型，并在没有根继续持有时
 * 停止默认指示器。没有产生任何 Transition 渲染的 Action 还会清理性能计时。
 */
function pingEngtangledActionScope() {
  if (--currentEntangledPendingCount === 0) {
    if (enableProfilerTimer && enableComponentPerformanceTrack) {
      if (!hasScheduledTransitionWork()) {
        // 纠缠 Action 开始后没有收到更新，说明没有 Transition 被渲染。清掉计时，
        // 防止下一组 Action 看起来从本组起一直被阻塞；当前也不为这种 Action 记轨。
        clearAsyncTransitionTimer();
      }
    }
    clearEntangledAsyncTransitionTypes();
    if (pendingEntangledRoots === 0) {
      stopIsomorphicDefaultIndicator();
    }
    if (currentEntangledListeners !== null) {
      // 全部 Action 已完成，关闭纠缠作用域并通知所有监听器。
      if (currentEntangledActionThenable !== null) {
        const fulfilledThenable: FulfilledThenable<void> =
          currentEntangledActionThenable as any;
        fulfilledThenable.status = 'fulfilled';
      }
      const listeners = currentEntangledListeners;
      currentEntangledListeners = null;
      currentEntangledLane = NoLane;
      currentEntangledActionThenable = null;
      needsIsomorphicIndicator = false;
      for (let i = 0; i < listeners.length; i++) {
        const listener = listeners[i];
        listener();
      }
    }
  }
}

/**
 * 创建一个跟随输入 Thenable 状态、但成功值固定为 `result` 的 React Thenable。
 *
 * 等价于 `Promise.resolve(thenable).then(() => result)`，但不要求客户端具备 Promise；
 * 拒绝时直接保存 reason，并用同一个 fulfill ping 唤醒 React 读取状态。
 */
export function chainThenableValue<T>(
  thenable: Thenable<T>,
  result: T,
): Thenable<T> {
  // 语义等价于 Promise.resolve(thenable).then(() => result)，但唯一消费者是 React，
  // 因此可以使用更轻量的状态对象。
  //
  // 客户端目前并不强制具备 Promise 支持，所以不能直接采用上述写法。
  const listeners = [];
  const thenableWithOverride: Thenable<T> = {
    status: 'pending',
    value: null,
    reason: null,
    /** 登记等待包装 Thenable 状态落定的 React ping。 */
    then(resolve: T => mixed) {
      listeners.push(resolve);
    },
  };
  thenable.then(
    (value: T) => {
      const fulfilledThenable: FulfilledThenable<T> =
        thenableWithOverride as any;
      fulfilledThenable.status = 'fulfilled';
      fulfilledThenable.value = result;
      for (let i = 0; i < listeners.length; i++) {
        const listener = listeners[i];
        listener(result);
      }
    },
    error => {
      const rejectedThenable: RejectedThenable<T> = thenableWithOverride as any;
      rejectedThenable.status = 'rejected';
      rejectedThenable.reason = error;
      for (let i = 0; i < listeners.length; i++) {
        const listener = listeners[i];
        // 性能优化：拒绝时也调用 onFulfill ping。React 是唯一消费者，会给成功/失败
        // 传同一监听器，并直接从 `.reason` 读取错误。
        listener(undefined as any);
      }
    },
  );
  return thenableWithOverride;
}

/** 返回当前纠缠异步 Action 共享的 Transition Lane，作用域外为 NoLane。 */
export function peekEntangledActionLane(): Lane {
  return currentEntangledLane;
}

/** 返回随整个纠缠异步 Action 作用域完成的 Thenable，作用域外为空。 */
export function peekEntangledActionThenable(): Thenable<void> | null {
  return currentEntangledActionThenable;
}

/**
 * 登记一个 renderer 的默认 Transition 指示器回调。
 *
 * 所有根提供同一函数时可跨 renderer 复用；发现不同函数时状态变为歧义并立即停止
 * 已运行指示器，此后不再提供同构默认指示器。
 */
export function registerDefaultIndicator(
  onDefaultTransitionIndicator: () => void | (() => void),
): void {
  if (!enableDefaultTransitionIndicator) {
    return;
  }
  if (isomorphicDefaultTransitionIndicator === undefined) {
    isomorphicDefaultTransitionIndicator = onDefaultTransitionIndicator;
  } else if (
    isomorphicDefaultTransitionIndicator !== onDefaultTransitionIndicator
  ) {
    isomorphicDefaultTransitionIndicator = null;
    // 多个实现造成歧义，立即停止正在运行的指示器。
    stopIsomorphicDefaultIndicator();
  }
}

/** 在确有异步 Action 需要且实现唯一时启动同构默认 Transition 指示器。 */
export function startIsomorphicDefaultIndicatorIfNeeded() {
  if (!enableDefaultTransitionIndicator) {
    return;
  }
  if (!needsIsomorphicIndicator) {
    return;
  }
  if (
    isomorphicDefaultTransitionIndicator != null &&
    pendingIsomorphicIndicator === null
  ) {
    try {
      pendingIsomorphicIndicator =
        isomorphicDefaultTransitionIndicator() || noop;
    } catch (x) {
      pendingIsomorphicIndicator = noop;
      reportGlobalError(x);
    }
  }
}

/** 停止当前同构默认指示器，并执行它返回的清理函数。 */
function stopIsomorphicDefaultIndicator() {
  if (!enableDefaultTransitionIndicator) {
    return;
  }
  if (pendingIsomorphicIndicator !== null) {
    const cleanup = pendingIsomorphicIndicator;
    pendingIsomorphicIndicator = null;
    cleanup();
  }
}

/** 释放一个根对默认指示器的持有；最后一个根释放时停止指示器。 */
function releaseIsomorphicIndicator() {
  if (--pendingEntangledRoots === 0) {
    stopIsomorphicDefaultIndicator();
  }
}

/** 判断同构默认 Transition 指示器当前是否正在运行。 */
export function hasOngoingIsomorphicIndicator(): boolean {
  return pendingIsomorphicIndicator !== null;
}

/** 增加一个根对默认指示器的引用，并返回配对释放函数。 */
export function retainIsomorphicIndicator(): () => void {
  pendingEntangledRoots++;
  return releaseIsomorphicIndicator;
}

/** 标记本轮默认指示器需求已被具体根处理，避免重复启动。 */
export function markIsomorphicIndicatorHandled(): void {
  needsIsomorphicIndicator = false;
}
