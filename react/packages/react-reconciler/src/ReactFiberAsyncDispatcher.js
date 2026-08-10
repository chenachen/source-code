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

/** 从当前 CacheContext 按资源工厂身份读取值，首次命中时惰性创建并缓存。 */
function getCacheForType<T>(resourceType: () => T): T {
  const cache: Cache = readContext(CacheContext);
  let cacheForType: T | void = cache.data.get(resourceType) as any;
  if (cacheForType === undefined) {
    cacheForType = resourceType();
    cache.data.set(resourceType, cacheForType);
  }
  return cacheForType;
}

/** 返回当前 Cache 生命周期的 AbortSignal，使资源工作在 cache 释放时可取消。 */
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
  DefaultAsyncDispatcher.getOwner = (): null | Fiber => {
    return currentOwner;
  };
}
