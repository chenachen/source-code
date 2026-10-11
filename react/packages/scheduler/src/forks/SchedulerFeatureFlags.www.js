/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// $FlowFixMe[cannot-resolve-module]
/** WWW 注入的动态 Feature Flag 模块；Rollup 构建时由内部实现提供。 */ const dynamicFeatureFlags = require('SchedulerFeatureFlags');

/** 从 WWW 动态配置中解构一次，避免每次读取标志都经过 exports 对象动态查找。 */
export const {enableRequestPaint} = dynamicFeatureFlags;

/** WWW 仅在开发构建记录 profiling 事件。 */
export const enableProfiling = __DEV__;
/** WWW host 使用 10 毫秒时间片，单位为毫秒。 */
export const frameYieldMs = 10;

/** WWW UserBlocking 任务的过期预算，单位为毫秒。 */
export const userBlockingPriorityTimeout = 250;
/** WWW Normal 任务的过期预算，单位为毫秒。 */
export const normalPriorityTimeout = 5000;
/** WWW Low 任务的过期预算，单位为毫秒。 */
export const lowPriorityTimeout = 10000;

/** WWW 当前可连续处理未过期工作，直到时间片或绘制请求要求 yield。 */
export const enableAlwaysYieldScheduler = false;
