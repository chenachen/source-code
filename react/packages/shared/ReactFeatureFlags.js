/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

// -----------------------------------------------------------------------------
// 可直接落地或删除（零成本）
//
// 这些开关通常可以直接永久启用或删除，不会带来额外迁移成本。
// -----------------------------------------------------------------------------

// 当前没有此类开关。

// -----------------------------------------------------------------------------
// 紧急熔断开关
//
// 这些开关只用于在变更上线后出现回归时快速关闭新行为；稳定后应尽快删除。
// -----------------------------------------------------------------------------

// 控制 react-dom 是否导出 browser() API。
/** 是否导出 react-dom 的 browser() API；true 启用该能力，false 保持关闭；默认实现固定为 true。 */
export const enableBrowserAPI: boolean = true;

// -----------------------------------------------------------------------------
// 可落地或删除（中等成本）
//
// 这些开关大概率可以永久启用或删除，但可能需要迁移内部调用方或补做性能测试。
// -----------------------------------------------------------------------------

// 永久启用前，必须先删除 Scheduler 的 didTimeout 参数。
/** 是否禁用 work loop 对 Scheduler didTimeout 的依赖；true 执行禁用，false 保留兼容行为；默认实现固定为 false。 */
export const disableSchedulerTimeoutInWorkLoop: boolean = false;

// -----------------------------------------------------------------------------
// 计划未来删除（成本较高）
//
// 这些实验没有达到预期且从未正式发布；内部调用方完成迁移前仍不能移除。
// -----------------------------------------------------------------------------

// 为 Suspense 增加回调属性，报告当前更新队列中的 Promise，便于追踪用户为何看到加载态。
// 同时允许脱水边界完成 hydration 或被删除时触发 hydration 回调。
// 该能力最终会由 Transition Tracing 提案取代。
/** 是否让 Suspense 报告待处理 Promise 与 hydration 结果；true 启用该能力，false 保持关闭；默认实现固定为 false。 */
export const enableSuspenseCallback: boolean = false;

// 实验性的 Scope 支持。
/** 是否提供实验性的 Scope API；true 启用该能力，false 保持关闭；默认实现固定为 false。 */
export const enableScopeAPI: boolean = false;

// 实验性的 Create Event Handle API。
/** 是否提供实验性的 Create Event Handle API；true 启用该能力，false 保持关闭；默认实现固定为 false。 */
export const enableCreateEventHandleAPI: boolean = false;

// 支持 Meta 内部 WWW 使用的旧版 Primer 集成。
/** 是否保留 Meta WWW 的旧 Primer 兼容路径；true 启用该能力，false 保持关闭；默认实现固定为 false。 */
export const enableLegacyFBSupport: boolean = false;

// -----------------------------------------------------------------------------
// 持续进行的实验
//
// 这些能力仍在积极探索，或较有可能进入后续版本。
// -----------------------------------------------------------------------------

// passive effects 前同时让出浏览器事件循环，而不只让出 Scheduler 事件循环。
// 再次启用前，需先修复打开该开关后失败的门控测试。
/** 是否在 passive effects 前让出浏览器事件循环；true 启用该能力，false 保持关闭；默认实现固定为 false。 */
export const enableYieldingBeforePassive: boolean = false;

// 实验性地减少让出执行权，以阻塞高帧率动画并观察调度收益。
/** 是否减少主动让出执行权以限制高帧率动画；true 启用该能力，false 保持关闭；默认实现固定为 false。 */
export const enableThrottledScheduling: boolean = false;

/** 是否保留旧 Cache 实现；true 启用该能力，false 保持关闭；默认实现随 __EXPERIMENTAL__：实验构建为 true，稳定构建为 false。 */
export const enableLegacyCache = __EXPERIMENTAL__;

/** 是否允许 AsyncIterable 作为 children 被消费；true 启用该能力，false 保持关闭；默认实现随 __EXPERIMENTAL__：实验构建为 true，稳定构建为 false。 */
export const enableAsyncIterableChildren = __EXPERIMENTAL__;

// 在 Flight 中支持状态为 'pending_weak' 的 thenable。弱等待 thenable 不会独自维持流；
// 若它在流因其他原因关闭前完成，则发送其值，否则保留未兑现引用。
/** 是否让 Flight 支持不会独自维持流的 pending_weak thenable；true 启用该能力，false 保持关闭；默认实现随 __EXPERIMENTAL__：实验构建为 true，稳定构建为 false。 */
export const enableFlightWeakThenables = __EXPERIMENTAL__;

/** 是否启用 Server Components 的 taint 跟踪 API；true 启用该能力，false 保持关闭；默认实现随 __EXPERIMENTAL__：实验构建为 true，稳定构建为 false。 */
export const enableTaint = __EXPERIMENTAL__;

/** 是否启用 View Transition 集成；true 启用该能力，false 保持关闭；默认实现固定为 true。 */
export const enableViewTransition: boolean = true;

/** 是否让 View Transition 处理父级 enter/exit；true 启用该能力，false 保持关闭；默认实现随 __EXPERIMENTAL__：实验构建为 true，稳定构建为 false。 */
export const enableViewTransitionParentEnterExit = __EXPERIMENTAL__;

/** 是否在 Persistence renderer 中启用 View Transition；true 启用该能力，false 保持关闭；默认实现固定为 false。 */
export const enableViewTransitionForPersistenceMode: boolean = false;

/** 是否启用由手势驱动的 Transition；true 启用该能力，false 保持关闭；默认实现随 __EXPERIMENTAL__：实验构建为 true，稳定构建为 false。 */
export const enableGestureTransition = __EXPERIMENTAL__;

/** 是否在原生 scrollend 不可用时启用 polyfill；true 启用该能力，false 保持关闭；默认实现随 __EXPERIMENTAL__：实验构建为 true，稳定构建为 false。 */
export const enableScrollEndPolyfill = __EXPERIMENTAL__;

/** 是否让图片资源参与 Suspense；true 启用该能力，false 保持关闭；默认实现固定为 false。 */
export const enableSuspenseyImages: boolean = false;

/** 是否让 Fizz 识别会阻塞渲染的资源；true 启用该能力，false 保持关闭；默认实现随 __EXPERIMENTAL__：实验构建为 true，稳定构建为 false。 */
export const enableFizzBlockingRender = __EXPERIMENTAL__; // 对应 rel="expect"

/** 是否支持把 srcObject 作为宿主属性写入；true 启用该能力，false 保持关闭；默认实现随 __EXPERIMENTAL__：实验构建为 true，稳定构建为 false。 */
export const enableSrcObject = __EXPERIMENTAL__;

/** 是否在 hydration 中恢复 change 事件处理；true 启用该能力，false 保持关闭；默认实现随 __EXPERIMENTAL__：实验构建为 true，稳定构建为 false。 */
export const enableHydrationChangeEvent = __EXPERIMENTAL__;

/** 是否提供默认 Transition 进度指示器；true 启用该能力，false 保持关闭；默认实现随 __EXPERIMENTAL__：实验构建为 true，稳定构建为 false。 */
export const enableDefaultTransitionIndicator = __EXPERIMENTAL__;

/** 是否为乐观更新路径启用稳定 key；true 启用该能力，false 保持关闭；默认实现随 __EXPERIMENTAL__：实验构建为 true，稳定构建为 false。 */
export const enableOptimisticKey = __EXPERIMENTAL__;

/**
 * 是否改用普通对象创建 Fiber；true 避开构造器，false 保留构造器路径；默认 fork 固定为 false。
 */
export const enableObjectFiber: boolean = false;

/** 是否追踪 Transition 与导致加载态的异步工作；true 启用该能力，false 保持关闭；默认实现固定为 false。 */
export const enableTransitionTracing: boolean = false;

// 仅供 Meta 内部使用；新 API 的语义与旧实现不同。
/** 是否保留语义不同的内部 LegacyHidden API；true 启用该能力，false 保持关闭；默认实现固定为 false。 */
export const enableLegacyHidden: boolean = false;

// 控制 Fiber 的 unstable_avoidThisFallback 能力。
/** 是否支持 Fiber 的 unstable_avoidThisFallback；true 启用该能力，false 保持关闭；默认实现固定为 false。 */
export const enableSuspenseAvoidThisFallback: boolean = false;

/** 是否允许 CPU 工作通过 Suspense 挂起；true 启用该能力，false 保持关闭；默认实现随 __EXPERIMENTAL__：实验构建为 true，稳定构建为 false。 */
export const enableCPUSuspense = __EXPERIMENTAL__;

// 启用前需先在 Meta 内部验证。
/** 是否复用 memo cache，避免渲染时克隆；true 启用该能力，false 保持关闭；默认实现固定为 false。 */
export const enableNoCloningMemoCache: boolean = false;

// 开源构建启用前需先在 WWW 验证。
// 让 DOM 服务端通过 data attributes 流式发送指令集，并由 MutationObserver 处理，
// 而不是生成内联脚本。
/** 是否让 Fizz 以 data attributes 配合外部运行时发送指令；true 启用该能力，false 保持关闭；默认实现随 __EXPERIMENTAL__：实验构建为 true，稳定构建为 false。 */
export const enableFizzExternalRuntime = __EXPERIMENTAL__;

/** 是否始终对 retry 进行节流，避免重试连续抢占主线程；true 所有 retry 都节流，false 仅按普通调度条件节流；默认实现固定为 true。 */
export const alwaysThrottleRetries: boolean = true;

// 控制 useEffectEvent 更新事件函数引用的阶段：true 使用 mutation 阶段，
// false 使用 before-mutation 阶段。
/** 是否在 mutation 阶段更新 useEffectEvent 函数引用；true 在 mutation 阶段更新，false 在 before-mutation 阶段更新；默认实现固定为 true。 */
export const enableEffectEventMutationPhase: boolean = true;

/** 是否克隆持久化宿主节点时传递 children；true 传递 children，false 只克隆节点数据；默认实现固定为 false。 */
export const passChildrenWhenCloningPersistedNodes: boolean = false;

/**
 * 是否为 retry lanes 设置过期时间；true 允许超时晋升以避免饥饿，false 不设置；默认 fork 为 false。
 */
export const enableRetryLaneExpiration: boolean = false;
/** 定义 retry lane 饥饿前的过期阈值，单位毫秒；默认实现固定为 5000，达到边界后触发过期策略。 */
export const retryLaneExpirationMs = 5000;
/** 定义 sync lane 的过期阈值，单位毫秒；默认实现固定为 250，达到边界后触发过期策略。 */
export const syncLaneExpirationMs = 250;
/** 定义 transition lane 的过期阈值，单位毫秒；默认实现固定为 5000，达到边界后触发过期策略。 */
export const transitionLaneExpirationMs = 5000;

/**
 * 是否检测由状态所有者组件之外的 setState 等更新触发的无限渲染循环；
 * true 启用检测，false 保留旧行为；默认 fork 为 false。
 */
export const enableInfiniteRenderLoopDetection: boolean = false;
/**
 * 当 `enableInfiniteRenderLoopDetection` 开启时，是否强制抛出检测错误；
 * true 抛错，false 在可降级场景只警告；默认 fork 为 false。
 */
export const enableInfiniteRenderLoopDetectionForceThrow: boolean = false;

/** 是否在 Hook 条件调用场景发出 use 警告；true 启用该能力，false 保持关闭；默认实现随 __EXPERIMENTAL__：实验构建为 true，稳定构建为 false。 */
export const enableConditionalUseWarning: boolean = __EXPERIMENTAL__;

/** 是否暴露 Fragment ref 能力；true 启用该能力，false 保持关闭；默认实现固定为 true。 */
export const enableFragmentRefs: boolean = true;
/** 是否让 Fragment ref 支持 scrollIntoView；true 启用该能力，false 保持关闭；默认实现固定为 true。 */
export const enableFragmentRefsScrollIntoView: boolean = true;
/** 是否让 Fragment ref 返回实例句柄；true 启用该能力，false 保持关闭；默认实现固定为 true。 */
export const enableFragmentRefsInstanceHandles: boolean = true;
/** 是否让 Fragment ref 纳入文本节点；true 启用该能力，false 保持关闭；默认实现固定为 true。 */
export const enableFragmentRefsTextNodes: boolean = true;

/** 是否维护宿主实例到内部 React 实例的映射；true 启用该能力，false 保持关闭；默认实现固定为 false。 */
export const enableInternalInstanceMap: boolean = false;

// -----------------------------------------------------------------------------
// 为下一个主版本准备
//
// 阅读时可把 __NEXT_MAJOR__ 视为 __EXPERIMENTAL__ 的别名。
// -----------------------------------------------------------------------------

// TODO：本节中设为 `true` 的开关，若已在所有构建（含 Meta 与 RN）启用，应完成清理；
// 否则应移动到本文件更合适的分组。

// const __NEXT_MAJOR__ = __EXPERIMENTAL__;

/**
 * 是否移除由静态 `contextTypes` 定义并由静态 `childContextTypes` 消费的旧 Context；
 * true 移除，false 保留兼容路径；默认 fork 为 true。
 */
export const disableLegacyContext: boolean = true;
/**
 * 是否只在函数组件中移除旧 Context；true 禁用该兼容能力，false 保留；默认 fork 为 true。
 */
export const disableLegacyContextForFunctionComponents: boolean = true;

// 控制是否用 moveBefore() 替代 insertBefore()；前者可在移动节点时保留状态。
/** 是否使用 moveBefore() 移动节点并保留状态；true 启用该能力，false 保持关闭；默认实现固定为 false。 */
export const enableMoveBefore: boolean = false;

// 控制是否禁用客户端运行时中的 `react/cache` 缓存行为。
/** 是否禁用客户端运行时的 `react/cache` 缓存；true 执行禁用，false 保留兼容行为；默认实现固定为 true。 */
export const disableClientCache: boolean = true;

// 控制是否在使用 ReactTestRenderer 时发出警告。
/** 是否在使用 ReactTestRenderer 时发出弃用警告；true 启用该能力，false 保持关闭；默认实现固定为 true。 */
export const enableReactTestRendererWarning: boolean = true;

// 控制是否禁用 Legacy Mode；借此可先在实验构建落地移除旧 API 的破坏性变更，
// 再于下一个主版本从稳定构建中删除。
/** 是否禁用 Legacy Mode 与其旧 API；true 执行禁用，false 保留兼容行为；默认实现固定为 true。 */
export const disableLegacyMode: boolean = true;

// -----------------------------------------------------------------------------
// 待淘汰能力
//
// 计划中的功能废弃与破坏性变更，大致按预计启用顺序排列。
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// React DOM 待淘汰能力
//
// 与上节相同，但只收纳 React DOM 开关；这些变更很可能在同一主版本集中发布。
// -----------------------------------------------------------------------------

// 控制是否禁止注释节点作为 React DOM 容器。开源构建已禁用，但 WWW 仍依赖，需先迁移。
/** 是否禁止把注释节点作为 React DOM 容器；true 执行禁用，false 保留兼容行为；默认实现固定为 true。 */
export const disableCommentsAsDOMContainers: boolean = true;

/** 是否与浏览器 Trusted Types 集成；true 启用该能力，false 保持关闭；默认实现固定为 true。 */
export const enableTrustedTypesIntegration: boolean = true;

// 控制是否阻止 value、checked attributes 与对应 DOM properties 同步。
/** 是否禁止 value、checked attributes 与对应 DOM properties 同步；true 执行禁用，false 保留兼容行为；默认实现固定为 false。 */
export const disableInputAttributeSyncing: boolean = false;

// 控制是否禁止 <textarea> 元素使用 children。
/** 是否禁止 <textarea> 通过 children 提供初始内容；true 执行禁用，false 保留兼容行为；默认实现固定为 false。 */
export const disableTextareaChildren: boolean = false;

// 控制是否启用并行 Transition；该注释修正了原先误写成 textarea 的说明。
/** 是否允许多个 Transition 并行推进；true 启用该能力，false 保持关闭；默认实现固定为 false。 */
export const enableParallelTransitions: boolean = false;

// -----------------------------------------------------------------------------
// 调试与 DevTools
// -----------------------------------------------------------------------------

// 控制是否为 Profiler 子树收集高级耗时指标。
/** 是否收集 Profiler 子树的高级耗时指标；true 启用该能力，false 保持关闭；默认实现随 __PROFILE__：Profiling 构建为 true，普通构建为 false。 */
export const enableProfilerTimer = __PROFILE__;

// 通过 Chrome 扩展添加 performance.measure() 标记，使格式化的组件渲染轨道显示在 Performance 面板。
// Server Component 与 Client Component 轨道共用此开关；所有调用还必须受 enableProfilerTimer 门控。
/** 是否生成组件渲染性能轨道；true 启用该能力，false 保持关闭；默认实现固定为 true。 */
export const enableComponentPerformanceTrack: boolean = true;

// 控制是否在 React 性能轨道事件上附加 `performanceIssue` 元数据，以更醒目地标出性能问题；
// 最初用于 React Native 实验。
/** 是否给性能轨道事件附加 performanceIssue 元数据；true 启用该能力，false 保持关闭；默认实现固定为 false。 */
export const enablePerformanceIssueReporting: boolean = false;

// 为状态更新、Suspense、work loop 等添加 User Timing 标记，供实验性时间线工具使用。
/** 是否记录调度 User Timing 标记；true 记录标记，false 不增加测量开销；默认实现由表达式 !enableComponentPerformanceTrack && __PROFILE__ 计算。 */
export const enableSchedulingProfiler: boolean =
  !enableComponentPerformanceTrack && __PROFILE__;

// 控制是否记录 commit 与 passive effects 阶段耗时。
/** 是否记录 commit 与 passive effects 阶段耗时；true 启用该能力，false 保持关闭；默认实现随 __PROFILE__：Profiling 构建为 true，普通构建为 false。 */
export const enableProfilerCommitHooks = __PROFILE__;

// 控制传给 onRender 的 phase 参数是否区分 "update" 与 "cascading-update"。
/** 是否让 Profiler onRender 区分 update 与 cascading-update；true 启用该能力，false 保持关闭；默认实现随 __PROFILE__：Profiling 构建为 true，普通构建为 false。 */
export const enableProfilerNestedUpdatePhase = __PROFILE__;

/** 是否记录异步任务与 thenable 的调试信息；true 启用该能力，false 保持关闭；默认实现固定为 true。 */
export const enableAsyncDebugInfo: boolean = true;

// 控制是否追踪哪些 Fiber 安排了渲染工作。
/** 是否记录安排渲染工作的 Fiber；true 启用该能力，false 保持关闭；默认实现随 __PROFILE__：Profiling 构建为 true，普通构建为 false。 */
export const enableUpdaterTracking = __PROFILE__;

/** 限制 owner stack 最多记录的节点数；默认实现固定为 1e4，超过边界时截断剩余节点。 */
export const ownerStackLimit = 1e4;

// -----------------------------------------------------------------------------
// eslint-plugin-react-hooks
// -----------------------------------------------------------------------------
/** 是否让 Hooks 插件检查 useKeyedState 编译器规则；true 执行检查，false 跳过检查；默认实现固定为 false。 */
export const eprh_enableUseKeyedStateCompilerLint: boolean = false;
/** 是否让 set-state-in-effect 编译器规则输出详细诊断；true 执行检查，false 跳过检查；默认实现固定为 false。 */
export const eprh_enableVerboseNoSetStateInEffectCompilerLint: boolean = false;
/** 选择 exhaustive-deps 编译器 lint 的报告范围；'off' 不报告，'all' 报告全部，'extra-only' 只报多余依赖，'missing-only' 只报缺失依赖；默认实现固定为 'off'。 */
export const eprh_enableExhaustiveEffectDependenciesCompilerLint:
  | 'off'
  | 'all'
  | 'extra-only'
  | 'missing-only' = 'off';
