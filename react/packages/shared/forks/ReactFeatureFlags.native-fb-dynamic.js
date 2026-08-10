/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

// 在 xplat 中，这些开关由 GK 控制。多数 GK 都同时覆盖开启与关闭人群，测试也应覆盖两种模式。
//
// 使用 __VARIANT__ 模拟 GK：测试理论上执行两次，分别令 __VARIANT__ 为 `true` 与 `false`。
//
// TODO：React Native 开关尚不支持 __VARIANT__。此处可以声明，但当前测试不会令其为 `true`；
// 仍需新增 React Native 测试配置。

/** 是否始终对 retry 进行节流，避免重试连续抢占主线程；true 所有 retry 都节流，false 仅按普通调度条件节流；RN 内部动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const alwaysThrottleRetries = __VARIANT__;
/** 是否用普通对象而非构造器创建 Fiber；true 启用该能力，false 保持关闭；RN 内部动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableObjectFiber = __VARIANT__;
/** 是否克隆持久化宿主节点时传递 children；true 传递 children，false 只克隆节点数据；RN 内部动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const passChildrenWhenCloningPersistedNodes = __VARIANT__;
/** 是否暴露 Fragment ref 能力；true 启用该能力，false 保持关闭；RN 内部动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableFragmentRefs = __VARIANT__;
/** 是否让 Fragment ref 支持 scrollIntoView；true 启用该能力，false 保持关闭；RN 内部动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableFragmentRefsScrollIntoView = __VARIANT__;
/** 是否让 Fragment ref 返回实例句柄；true 启用该能力，false 保持关闭；RN 内部动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableFragmentRefsInstanceHandles = __VARIANT__;
/** 是否让 Fragment ref 纳入文本节点；true 启用该能力，false 保持关闭；RN 内部动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableFragmentRefsTextNodes = __VARIANT__;
/** 是否在 Persistence renderer 中启用 View Transition；true 启用该能力，false 保持关闭；RN 内部动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableViewTransitionForPersistenceMode = __VARIANT__;
/** 是否在 Hook 条件调用场景发出 use 警告；true 启用该能力，false 保持关闭；RN 内部动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableConditionalUseWarning = __VARIANT__;
