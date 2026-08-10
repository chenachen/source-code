/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactContext} from 'shared/ReactTypes';
import type {Fiber} from 'react-reconciler/src/ReactInternalTypes';

import {REACT_CONTEXT_TYPE} from 'shared/ReactSymbols';

import {pushProvider, popProvider} from './ReactFiberNewContext';
import * as Scheduler from 'scheduler';

// 在没有 AbortController 的环境（例如测试）使用只实现所需能力的轻量 shim。
const AbortControllerLocal: typeof AbortController =
  typeof AbortController !== 'undefined'
    ? AbortController
    : // $FlowFixMe[incompatible-type]
      // $FlowFixMe[missing-this-annot]
      function AbortControllerShim() {
        const listeners = [];
        const signal = (this.signal = {
          aborted: false as boolean,
          /** 登记 abort 时需要逐一调用的监听器。 */
          addEventListener: (type, listener) => {
            listeners.push(listener);
          },
        });

        this.abort = () => {
          signal.aborted = true;
          listeners.forEach(listener => listener());
        };
      };

/** 可被 React Cache 边界共享并按引用计数释放的资源容器。 */
export type Cache = {
  /** 释放缓存时用于通知其中异步资源取消工作的控制器。 */
  controller: AbortController,
  /** 资源工厂到该工厂缓存值的映射。 */
  data: Map<() => mixed, mixed>,
  /** 当前持有此 Cache 的根或 Fiber 数量。 */
  refCount: number,
};

/** CacheComponent memoizedState 保存的父缓存与本边界缓存。 */
export type CacheComponentState = {
  /** 创建本边界时从上层 Context 观察到的缓存，用于识别 refresh。 */
  +parent: Cache,
  /** 本 Cache 边界实际向后代提供的缓存。 */
  +cache: Cache,
};

/** Suspense/Offscreen 挂起时保存、供恢复渲染复用的缓存池快照。 */
export type SpawnedCachePool = {
  /** 生成池时的父缓存，用于判断恢复前是否发生 refresh。 */
  +parent: Cache,
  /** 本次渲染新建或复用的缓存实例。 */
  +pool: Cache,
};

// 刻意不使用命名 import；否则 Rollup 会为 CommonJS 互操作生成动态分派。
const {
  unstable_scheduleCallback: scheduleCallback,
  unstable_NormalPriority: NormalPriority,
} = Scheduler;

/** 在 Fiber Context 栈中向 Cache 边界后代传递当前 Cache 的内部 Context。 */
export const CacheContext: ReactContext<Cache> = {
  $$typeof: REACT_CONTEXT_TYPE,
  // Cache 组件不通过公开 Consumer/Provider 使用该 Context，因此这里保留空占位。
  Consumer: null as any,
  Provider: null as any,
  // 两个 renderer 槽位会在根初始化时写入。
  _currentValue: null as any,
  _currentValue2: null as any,
  _threadCount: 0,
};

if (__DEV__) {
  CacheContext._currentRenderer = null;
  CacheContext._currentRenderer2 = null;
}

/**
 * 创建引用计数为 0 的空 Cache。
 *
 * 调用方在开始持有时必须调用 `retainCache`，不再使用时调用 `releaseCache`；最后一
 * 个引用释放后，AbortController 会异步取消缓存中仍在等待的工作。
 */
export function createCache(): Cache {
  return {
    controller: new AbortControllerLocal(),
    data: new Map(),
    refCount: 0,
  };
}

/** 增加 Cache 引用计数，并在开发环境诊断“释放后重新持有”的内部错误。 */
export function retainCache(cache: Cache) {
  if (__DEV__) {
    if (cache.controller.signal.aborted) {
      console.warn(
        'A cache instance was retained after it was already freed. ' +
          'This likely indicates a bug in React.',
      );
    }
  }
  cache.refCount++;
}

/**
 * 释放一个 Cache 引用；计数归零时以普通优先级异步 abort。
 *
 * 延迟 abort 可避免提交阶段同步执行任意资源清理逻辑，也给同一轮所有权转移留下
 * 时间；开发环境会报告重复释放导致的负引用计数。
 */
export function releaseCache(cache: Cache) {
  cache.refCount--;
  if (__DEV__) {
    if (cache.refCount < 0) {
      console.warn(
        'A cache instance was released after it was already freed. ' +
          'This likely indicates a bug in React.',
      );
    }
  }
  if (cache.refCount === 0) {
    scheduleCallback(NormalPriority, () => {
      cache.controller.abort();
    });
  }
}

/** 把 Cache 压入 Context 栈，使当前 Fiber 子树读取该实例。 */
export function pushCacheProvider(workInProgress: Fiber, cache: Cache) {
  pushProvider(workInProgress, CacheContext, cache);
}

/** 在完成或退栈当前 Fiber 时恢复进入 Cache 边界前的 Context 值。 */
export function popCacheProvider(workInProgress: Fiber, cache: Cache) {
  popProvider(CacheContext, workInProgress);
}
