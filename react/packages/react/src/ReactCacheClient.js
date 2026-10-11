/**
 * Copyright (c) Meta Platforms, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {disableClientCache} from 'shared/ReactFeatureFlags';
import {
  cache as cacheImpl,
  cacheSignal as cacheSignalImpl,
} from './ReactCacheImpl';

/**
 * 在关闭客户端缓存时返回不记忆结果的调用包装器。
 *
 * @remarks `disableClientCache` 开启时，每次调用都执行原函数；关闭时改用 `ReactCacheImpl`，
 * 由 renderer 的 dispatcher 提供缓存域。两端保留同一个 API，便于共享模块导入。
 * 包装器仍与服务端版本一样产生新函数引用，不保留 `displayName` 等额外属性，且函数长度为 0，
 * 这些包装器形状与服务端实现一致。
 */
function noopCache<A: Iterable<mixed>, T>(fn: (...A) => T): (...A) => T {
  return function () {
    // $FlowFixMe[incompatible-type]: We don't want to use rest arguments since we transpile the code.
    return fn.apply(null, arguments);
  };
}

/** 根据特性开关选择无缓存包装或共享缓存实现。 */
export const cache: typeof noopCache = disableClientCache
  ? noopCache
  : cacheImpl;

/** 关闭客户端缓存时没有可绑定到缓存生命周期的中止信号。 */
function noopCacheSignal(): null | AbortSignal {
  return null;
}

/** 与 `cache` 选择保持一致的缓存生命周期信号入口。 */
export const cacheSignal: () => null | AbortSignal = disableClientCache
  ? noopCacheSignal
  : cacheSignalImpl;
