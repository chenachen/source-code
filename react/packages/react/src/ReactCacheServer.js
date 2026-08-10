/**
 * Copyright (c) Meta Platforms, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** 服务端入口直接公开按请求 dispatcher 隔离的缓存实现与生命周期信号。 */
export {cache, cacheSignal} from './ReactCacheImpl';
