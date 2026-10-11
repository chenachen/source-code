/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** RN 内部开发构建开启 profiling；生产构建中的 `__DEV__` 会被折叠为 false。 */
export const enableProfiling = __DEV__;
/** JavaScript fallback 的 shouldYield 时间门限为 5 毫秒；检查由 work loop 或 callback 主动发起。 */
export const frameYieldMs = 5;

/** RN UserBlocking 任务的过期预算，单位为毫秒。 */
export const userBlockingPriorityTimeout = 250;
/** RN Normal 任务的过期预算，单位为毫秒。 */
export const normalPriorityTimeout = 5000;
/** RN Low 任务的过期预算，单位为毫秒。 */
export const lowPriorityTimeout = 10000;
/** RN renderer 可以通过 `requestPaint` 请求尽快 yield。 */
export const enableRequestPaint = true;

/** RN 当前不启用“每轮总是 yield”的实验调度策略。 */
export const enableAlwaysYieldScheduler = false;
