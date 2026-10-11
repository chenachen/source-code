/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {AsyncDispatcher, Fiber} from './ReactInternalTypes';
import type {Cache} from './ReactFiberCacheComponent';

import {readContext} from './ReactFiberNewContext';
import {CacheContext} from './ReactFiberCacheComponent';

import {current as currentOwner} from './ReactCurrentFiber';

/**
 * 从当前 render 的 CacheContext 按资源工厂身份读取或创建资源。
 *
 * React.cache 的 dispatcher 以 resourceType 函数本身为 key；不同 Cache Provider 隔离 data Map。
 * undefined 同时表示未命中，因此工厂返回 undefined 会在下次读取时再次执行；工厂抛错则不写入 Map，
 * 错误继续交给当前 render 的异常路径，当前实现不会在这里缓存失败结果。
 */
function getCacheForType<T>(resourceType: () => T): T {
  const cache: Cache = readContext(CacheContext);
  let cacheForType: T | void = cache.data.get(resourceType) as any;
  if (cacheForType === undefined) {
    cacheForType = resourceType();
    cache.data.set(resourceType, cacheForType);
  }
  return cacheForType;
}

/**
 * 返回当前 Cache Provider 的 AbortSignal，供资源主动订阅释放通知。
 * cache 的引用计数归零后由 releaseCache 安排 abort；读取 signal 本身不取消请求，也不增加引用计数。
 */
function cacheSignal(): null | AbortSignal {
  const cache: Cache = readContext(CacheContext);
  return cache.controller.signal;
}

/** React.cache/cacheSignal 默认委托对象；开发期另注入当前 owner 查询。 */
export const DefaultAsyncDispatcher: AsyncDispatcher = {
  getCacheForType,
  cacheSignal,
} as any;

if (__DEV__) {
  /** 向开发期 React.cache 调用返回当前诊断 owner，不创建或延长 Fiber 生命周期。 */
  DefaultAsyncDispatcher.getOwner = (): null | Fiber => {
    return currentOwner;
  };
}
