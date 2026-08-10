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
  /** 全局缓存和在途请求仍可能持有该值的引用数。 */
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
 * 值从全局缓存移除后，新请求无法再取得它，但既有请求仍可能持有引用；只有这些队列全部
 * 清理完毕，注册表计数才能归零并删除污染记录。
 */
export type RequestCleanupQueue = Array<string | bigint>;
/** 所有在途请求的清理队列，用于跨请求正确维护污染值引用计数。 */
export const TaintRegistryPendingRequests: Set<RequestCleanupQueue> = new Set();
