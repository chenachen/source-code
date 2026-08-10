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

/** 是否始终对 retry 进行节流，避免重试连续抢占主线程；true 所有 retry 都节流，false 仅按普通调度条件节流；WWW 动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const alwaysThrottleRetries: boolean = __VARIANT__;
/** 是否只在函数组件中禁用旧 Context；true 执行禁用，false 保留兼容行为；WWW 动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const disableLegacyContextForFunctionComponents: boolean = __VARIANT__;
/** 是否禁用 work loop 对 Scheduler didTimeout 的依赖；true 执行禁用，false 保留兼容行为；WWW 动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const disableSchedulerTimeoutInWorkLoop: boolean = __VARIANT__;
/** 是否复用 memo cache，避免渲染时克隆；true 启用该能力，false 保持关闭；WWW 动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableNoCloningMemoCache: boolean = __VARIANT__;
/** 是否用普通对象而非构造器创建 Fiber；true 启用该能力，false 保持关闭；WWW 动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableObjectFiber: boolean = __VARIANT__;
/** 是否为 retry lanes 设置过期时间以避免饥饿；true 启用该能力，false 保持关闭；WWW 动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableRetryLaneExpiration: boolean = __VARIANT__;
/** 是否追踪 Transition 与导致加载态的异步工作；true 启用该能力，false 保持关闭；WWW 动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableTransitionTracing: boolean = __VARIANT__;
/** 定义 retry lane 饥饿前的过期阈值，单位毫秒；WWW 动态 fork 固定为 5000，达到阈值后触发 lane 过期策略。 */
export const retryLaneExpirationMs = 5000;
/** 定义 sync lane 的过期阈值，单位毫秒；WWW 动态 fork 固定为 250，达到阈值后触发 lane 过期策略。 */
export const syncLaneExpirationMs = 250;
/** 定义 transition lane 的过期阈值，单位毫秒；WWW 动态 fork 固定为 5000，达到阈值后触发 lane 过期策略。 */
export const transitionLaneExpirationMs = 5000;

/** 是否记录调度 User Timing 标记；true 记录标记，false 不增加测量开销；WWW 动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableSchedulingProfiler: boolean = __VARIANT__;

/** 是否检测跨组件更新造成的无限渲染循环；true 启用该能力，false 保持关闭；WWW 动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableInfiniteRenderLoopDetection: boolean = __VARIANT__;
/** 是否把无限渲染循环检测从警告提升为抛错；true 抛错，false 在可降级场景只警告；WWW 动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableInfiniteRenderLoopDetectionForceThrow: boolean = __VARIANT__;
/** 是否在 Hook 条件调用场景发出 use 警告；true 启用该能力，false 保持关闭；WWW 动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableConditionalUseWarning: boolean = __VARIANT__;

/** 是否在属性 diff 中使用快速属性添加路径；true 启用该能力，false 保持关闭；WWW 动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableFastAddPropertiesInDiffing: boolean = __VARIANT__;
/** 是否让图片资源参与 Suspense；true 启用该能力，false 保持关闭；WWW 动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableSuspenseyImages: boolean = __VARIANT__;
/** 是否启用 View Transition 集成；true 启用该能力，false 保持关闭；WWW 动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableViewTransition: boolean = __VARIANT__;
/** 是否让 View Transition 处理父级 enter/exit；true 启用该能力，false 保持关闭；WWW 动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableViewTransitionParentEnterExit: boolean = __VARIANT__;
/** 是否在原生 scrollend 不可用时启用 polyfill；true 启用该能力，false 保持关闭；WWW 动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableScrollEndPolyfill: boolean = __VARIANT__;
/** 是否暴露 Fragment ref 能力；true 启用该能力，false 保持关闭；WWW 动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableFragmentRefs: boolean = __VARIANT__;
/** 是否让 Fragment ref 支持 scrollIntoView；true 启用该能力，false 保持关闭；WWW 动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableFragmentRefsScrollIntoView: boolean = __VARIANT__;
/** 是否让 Fragment ref 纳入文本节点；true 启用该能力，false 保持关闭；WWW 动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableFragmentRefsTextNodes: boolean = __VARIANT__;
/** 是否维护宿主实例到内部 React 实例的映射；true 启用该能力，false 保持关闭；WWW 动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableInternalInstanceMap: boolean = __VARIANT__;
/** 是否允许多个 Transition 并行推进；true 启用该能力，false 保持关闭；WWW 动态 fork 随 __VARIANT__：GK 开启组为 true，关闭组为 false。 */
export const enableParallelTransitions: boolean = __VARIANT__;

// TODO：下方开关硬编码为开源构建默认值。应先让测试在两种模式都通过，再改为 __VARIANT__。
// 不应继续增加硬编码项；新动态开关应优先加入上方并使用 __VARIANT__。
