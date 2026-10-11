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

/** 是否把仅 retry 的提交统一纳入 fallback 节流；关闭时只对 RootSuspended 结果节流。 */
export const alwaysThrottleRetries = __VARIANT__;
/** 是否用普通对象而非构造器创建 Fiber。 */
export const enableObjectFiber = __VARIANT__;
/** 是否在持久化节点需要重建 children 时将 ChildSet 直接传给 cloneInstance；关闭时在克隆后追加 children。 */
export const passChildrenWhenCloningPersistedNodes = __VARIANT__;
/** 是否暴露 Fragment ref 能力。 */
export const enableFragmentRefs = __VARIANT__;
/** 是否让 Fragment ref 支持 scrollIntoView。 */
export const enableFragmentRefsScrollIntoView = __VARIANT__;
/** 是否让 Fragment ref 返回实例句柄。 */
export const enableFragmentRefsInstanceHandles = __VARIANT__;
/** 是否让 Fragment ref 纳入文本节点。 */
export const enableFragmentRefsTextNodes = __VARIANT__;
/** 是否在 Persistence renderer 中启用 View Transition。 */
export const enableViewTransitionForPersistenceMode = __VARIANT__;
/** 是否警告初次挂载因 use 挂起、重试完成后同一位置却不再调用 use 的情况。 */
export const enableConditionalUseWarning = __VARIANT__;
