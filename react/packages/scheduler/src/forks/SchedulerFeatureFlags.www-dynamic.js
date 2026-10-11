/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// WWW 中这些标志由 GK 控制。多数 GK 同时存在启用和禁用人群，因此测试也必须覆盖两种模式。
// `__VARIANT__` 用来模拟 GK；测试会分别以 `true` 和 `false` 执行一次。

/** 控制 paint 请求是否强制当前 Scheduler 时间片尽快让出。 */
export const enableRequestPaint = __VARIANT__;
