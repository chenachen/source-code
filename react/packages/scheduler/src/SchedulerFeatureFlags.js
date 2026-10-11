/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

/** 默认构建不记录二进制 profiling 事件，避免生产路径承担记录开销。 */
export const enableProfiling = false;
/** shouldYield 的默认时间门限，单位为毫秒；需 callback 协作让出，不能强制中断正在执行的函数。 */
export const frameYieldMs = 5;

/** UserBlocking 任务从开始时间到过期的默认预算，单位为毫秒。 */
export const userBlockingPriorityTimeout = 250;
/** Normal 任务从开始时间到过期的默认预算，单位为毫秒。 */
export const normalPriorityTimeout = 5000;
/** Low 任务从开始时间到过期的默认预算，单位为毫秒。 */
export const lowPriorityTimeout = 10000;
/** 允许 renderer 请求在当前时间片结束前先把执行权交还给浏览器绘制。 */
export const enableRequestPaint = true;

/** 实验构建每轮先处理一个 ready 节点，再连续处理后续已过期节点；下个节点未过期时归还 host task。 */
export const enableAlwaysYieldScheduler = __EXPERIMENTAL__;
