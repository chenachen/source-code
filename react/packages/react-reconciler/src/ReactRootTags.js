/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** FiberRoot 的运行模式标签；决定是否启用并发调度语义。 */
export type RootTag = 0 | 1;

/** 兼容旧 render API 的同步根。 */
export const LegacyRoot = 0;
/** createRoot/hydrateRoot 创建、可使用并发特性的根。 */
export const ConcurrentRoot = 1;
