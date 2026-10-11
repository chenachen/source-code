/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

// 在 WWW 中，这些开关由 GK 控制。多数 GK 都同时覆盖开启与关闭人群，测试也应覆盖两种模式。
//
// 使用 __VARIANT__ 模拟 GK：测试执行两次，分别令 __VARIANT__ 为 `true` 与 `false`。

/** 是否把仅 retry 的提交统一纳入 fallback 节流；关闭时只对 RootSuspended 结果节流。 */
export const alwaysThrottleRetries: boolean = __VARIANT__;
/** 是否只在函数组件中禁用旧 Context。 */
export const disableLegacyContextForFunctionComponents: boolean = __VARIANT__;
/** 是否禁用 work loop 对 Scheduler didTimeout 的依赖。 */
export const disableSchedulerTimeoutInWorkLoop: boolean = __VARIANT__;
/** 是否复用 memo cache，避免渲染时克隆。 */
export const enableNoCloningMemoCache: boolean = __VARIANT__;
/** 是否用普通对象而非构造器创建 Fiber。 */
export const enableObjectFiber: boolean = __VARIANT__;
/** 是否为 retry lanes 设置过期时间以避免饥饿。 */
export const enableRetryLaneExpiration: boolean = __VARIANT__;
/** 是否追踪 Transition 与导致加载态的异步工作。 */
export const enableTransitionTracing: boolean = __VARIANT__;
/** retry lane 的等待预算，单位毫秒；仅在 enableRetryLaneExpiration 开启时用于计算期限。 */
export const retryLaneExpirationMs = 5000;
/** Sync、InputContinuous、Gesture 及对应 hydration lane 的等待预算，单位毫秒。 */
export const syncLaneExpirationMs = 250;
/** Default、Transition 及对应 hydration lane 的等待预算，单位毫秒。 */
export const transitionLaneExpirationMs = 5000;

/** 是否记录调度 User Timing 标记。 */
export const enableSchedulingProfiler: boolean = __VARIANT__;

/** 是否在 root 更新与 ping 路径增加 render/commit 递归更新检测。 */
export const enableInfiniteRenderLoopDetection: boolean = __VARIANT__;
/** 是否将额外递归更新检测的警告提升为抛错。 */
export const enableInfiniteRenderLoopDetectionForceThrow: boolean = __VARIANT__;
/** 是否警告初次挂载因 use 挂起、重试完成后同一位置却不再调用 use 的情况。 */
export const enableConditionalUseWarning: boolean = __VARIANT__;

/** 是否在属性 diff 中使用快速属性添加路径。 */
export const enableFastAddPropertiesInDiffing: boolean = __VARIANT__;
/** 是否让图片资源参与 Suspense。 */
export const enableSuspenseyImages: boolean = __VARIANT__;
/** 是否启用 View Transition 集成。 */
export const enableViewTransition: boolean = __VARIANT__;
/** 是否让 View Transition 处理父级 enter/exit。 */
export const enableViewTransitionParentEnterExit: boolean = __VARIANT__;
/** 是否在原生 scrollend 不可用时启用 polyfill。 */
export const enableScrollEndPolyfill: boolean = __VARIANT__;
/** 是否暴露 Fragment ref 能力。 */
export const enableFragmentRefs: boolean = __VARIANT__;
/** 是否让 Fragment ref 支持 scrollIntoView。 */
export const enableFragmentRefsScrollIntoView: boolean = __VARIANT__;
/** 是否让 Fragment ref 纳入文本节点。 */
export const enableFragmentRefsTextNodes: boolean = __VARIANT__;
/** 是否维护宿主实例到内部 React 实例的映射。 */
export const enableInternalInstanceMap: boolean = __VARIANT__;
/** 是否允许多个 Transition 并行推进。 */
export const enableParallelTransitions: boolean = __VARIANT__;

// TODO：下方开关硬编码为开源构建默认值。应先让测试在两种模式都通过，再改为 __VARIANT__。
// 不应继续增加硬编码项；新动态开关应优先加入上方并使用 __VARIANT__。
