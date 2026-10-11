/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** 可作为 WeakMap 键的对象或函数引用品牌。 */
export interface Reference {}

/** 原始污染值的消息与活跃持有计数。 */
export type TaintEntry = {
  /** 泄漏该值时应报告的诊断消息。 */
  message: string,
  /** 尚未清理的生命周期注册次数，加上在途请求为该值保留的计数。 */
  count: number,
};

/** 对象引用到污染消息的弱映射；对象回收时记录随之消失。 */
export const TaintRegistryObjects: WeakMap<Reference, string> = new WeakMap();
/** 字符串/大整数污染值的强映射，并用引用计数控制清理时机。 */
export const TaintRegistryValues: Map<string | bigint, TaintEntry> = new Map();
/**
 * 曾见过的二进制污染值长度。预期只有令牌长度等少量候选，因此无需为长度维护引用计数；
 * 它只用于快速排除不可能匹配的二进制值。
 */
export const TaintRegistryByteLengths: Set<number> = new Set();

/**
 * 单个请求结束时需要释放的原始污染值列表。
 *
 * 生命周期对象被回收时，ReactTaint.cleanup 把值复制到所有在途请求的队列并增加计数。
 * 请求结束逐项减少计数；只要注册生命周期或在途请求仍有计数，污染记录就继续保留。
 */
export type RequestCleanupQueue = Array<string | bigint>;
/** 所有在途请求的清理队列，用于跨请求正确维护污染值引用计数。 */
export const TaintRegistryPendingRequests: Set<RequestCleanupQueue> = new Set();
