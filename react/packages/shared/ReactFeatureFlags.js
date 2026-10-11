/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

// 默认构建的功能契约。不同平台/发布通道会选择 forks 下的同名模块，因此这里的值
// 不能代替 WWW、Native 或 test-renderer 的实际开关。消费者在实现分支中读取这些常量，
// 它们不是 createRoot 可传入的运行时配置；__EXPERIMENTAL__ 与 __PROFILE__ 由构建注入。
// 开关为 true 也不保证某 API 在所有入口导出：入口还会选择稳定/实验/server 的导出集合，
// 性能轨道等能力还要同时满足 enableProfilerTimer 等组合门控。

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
/** 是否导出 react-dom 的 browser() API。 */
export const enableBrowserAPI: boolean = true;

// -----------------------------------------------------------------------------
// 可落地或删除（中等成本）
//
// 这些开关大概率可以永久启用或删除，但可能需要迁移内部调用方或补做性能测试。
// -----------------------------------------------------------------------------

// 永久启用前，必须先删除 Scheduler 的 didTimeout 参数。
/** 是否禁用 work loop 对 Scheduler didTimeout 的依赖。 */
export const disableSchedulerTimeoutInWorkLoop: boolean = false;

// -----------------------------------------------------------------------------
// 计划未来删除（成本较高）
//
// 这些实验没有达到预期且从未正式发布；内部调用方完成迁移前仍不能移除。
// -----------------------------------------------------------------------------

// 为 Suspense 增加回调属性，报告当前更新队列中的 Promise，便于追踪用户为何看到加载态。
// 同时允许脱水边界完成 hydration 或被删除时触发 hydration 回调。
// 该能力最终会由 Transition Tracing 提案取代。
/** 是否让 Suspense 报告待处理 Promise 与 hydration 结果。 */
export const enableSuspenseCallback: boolean = false;

// 实验性的 Scope 支持。
/** 是否提供实验性的 Scope API。 */
export const enableScopeAPI: boolean = false;

// 实验性的 Create Event Handle API。
/** 是否提供实验性的 Create Event Handle API。 */
export const enableCreateEventHandleAPI: boolean = false;

// 支持 Meta 内部 WWW 使用的旧版 Primer 集成。
/** 是否保留 Meta WWW 的旧 Primer 兼容路径。 */
export const enableLegacyFBSupport: boolean = false;

// -----------------------------------------------------------------------------
// 持续进行的实验
//
// 这些能力仍在积极探索，或较有可能进入后续版本。
// -----------------------------------------------------------------------------

// passive effects 前同时让出浏览器事件循环，而不只让出 Scheduler 事件循环。
// 再次启用前，需先修复打开该开关后失败的门控测试。
/** 是否在 passive effects 前让出浏览器事件循环。 */
export const enableYieldingBeforePassive: boolean = false;

// 实验性地减少让出执行权，以阻塞高帧率动画并观察调度收益。
/** 是否减少主动让出执行权以限制高帧率动画。 */
export const enableThrottledScheduling: boolean = false;

/** 是否保留旧 Cache 实现。 */
export const enableLegacyCache = __EXPERIMENTAL__;

/** 是否允许 AsyncIterable 作为 children 被消费。 */
export const enableAsyncIterableChildren = __EXPERIMENTAL__;

// 在 Flight 中支持状态为 'pending_weak' 的 thenable。弱等待 thenable 不会独自维持流；
// 若它在流因其他原因关闭前完成，则发送其值，否则保留未兑现引用。
/** 是否让 Flight 支持不会独自维持流的 pending_weak thenable。 */
export const enableFlightWeakThenables = __EXPERIMENTAL__;

/** 是否启用 Server Components 的 taint 跟踪 API。 */
export const enableTaint = __EXPERIMENTAL__;

/** 是否启用 View Transition 集成。 */
export const enableViewTransition: boolean = true;

/** 是否让 View Transition 处理父级 enter/exit。 */
export const enableViewTransitionParentEnterExit = __EXPERIMENTAL__;

/** 是否在 Persistence renderer 中启用 View Transition。 */
export const enableViewTransitionForPersistenceMode: boolean = false;

/** 是否启用由手势驱动的 Transition。 */
export const enableGestureTransition = __EXPERIMENTAL__;

/** 是否在原生 scrollend 不可用时启用 polyfill。 */
export const enableScrollEndPolyfill = __EXPERIMENTAL__;

/** 是否让图片资源参与 Suspense。 */
export const enableSuspenseyImages: boolean = false;

/** 是否让 Fizz 识别会阻塞渲染的资源。 */
export const enableFizzBlockingRender = __EXPERIMENTAL__; // 对应 rel="expect"

/** 是否支持把 srcObject 作为宿主属性写入。 */
export const enableSrcObject = __EXPERIMENTAL__;

/** 是否在 hydration 中恢复 change 事件处理。 */
export const enableHydrationChangeEvent = __EXPERIMENTAL__;

/** 是否提供默认 Transition 进度指示器。 */
export const enableDefaultTransitionIndicator = __EXPERIMENTAL__;

/** 是否启用区别于字符串 key 的内部乐观 key。 */
export const enableOptimisticKey = __EXPERIMENTAL__;

/**
 * 是否改用普通对象创建 Fiber；关闭时保留构造器路径。
 */
export const enableObjectFiber: boolean = false;

/** 是否追踪 Transition 与导致加载态的异步工作。 */
export const enableTransitionTracing: boolean = false;

// 仅供 Meta 内部使用；新 API 的语义与旧实现不同。
/** 是否保留语义不同的内部 LegacyHidden API。 */
export const enableLegacyHidden: boolean = false;

// 控制 Fiber 的 unstable_avoidThisFallback 能力。
/** 是否支持 Fiber 的 unstable_avoidThisFallback。 */
export const enableSuspenseAvoidThisFallback: boolean = false;

/** 是否允许 CPU 工作通过 Suspense 挂起。 */
export const enableCPUSuspense = __EXPERIMENTAL__;

// 启用前需先在 Meta 内部验证。
/** 是否复用 memo cache，避免渲染时克隆。 */
export const enableNoCloningMemoCache: boolean = false;

// 开源构建启用前需先在 WWW 验证。
// 让 DOM 服务端通过 data attributes 流式发送指令集，并由 MutationObserver 处理，
// 而不是生成内联脚本。
/** 是否让 Fizz 以 data attributes 配合外部运行时发送指令。 */
export const enableFizzExternalRuntime = __EXPERIMENTAL__;

/** 是否把仅 retry 的提交统一纳入 fallback 节流；关闭时只对 RootSuspended 结果节流。 */
export const alwaysThrottleRetries: boolean = true;

// 控制 useEffectEvent 更新事件函数引用的阶段：true 使用 mutation 阶段，
// false 使用 before-mutation 阶段。
/** 是否在 mutation 阶段更新 useEffectEvent 函数引用。 */
export const enableEffectEventMutationPhase: boolean = true;

/** 是否在持久化节点需要重建 children 时将 ChildSet 直接传给 cloneInstance；关闭时在克隆后追加 children。 */
export const passChildrenWhenCloningPersistedNodes: boolean = false;

/**
 * 是否为 retry lanes 设置过期时间，使长期等待的 retry 进入过期工作处理路径。
 */
export const enableRetryLaneExpiration: boolean = false;
/** retry lane 的等待预算，单位毫秒；仅在 enableRetryLaneExpiration 开启时用于计算期限。 */
export const retryLaneExpirationMs = 5000;
/** Sync、InputContinuous、Gesture 及对应 hydration lane 的等待预算，单位毫秒。 */
export const syncLaneExpirationMs = 250;
/** Default、Transition 及对应 hydration lane 的等待预算，单位毫秒。 */
export const transitionLaneExpirationMs = 5000;

/**
 * 是否在 root 更新与 ping 路径增加 render/commit 递归更新检测。
 */
export const enableInfiniteRenderLoopDetection: boolean = false;
/**
 * 当 `enableInfiniteRenderLoopDetection` 开启时，是否强制抛出检测错误；
 * 关闭时，这些额外检测在开发构建中只警告；原有必须抛错的路径不受影响。
 */
export const enableInfiniteRenderLoopDetectionForceThrow: boolean = false;

/** 是否警告初次挂载因 use 挂起、重试完成后同一位置却不再调用 use 的情况。 */
export const enableConditionalUseWarning: boolean = __EXPERIMENTAL__;

/** 是否暴露 Fragment ref 能力。 */
export const enableFragmentRefs: boolean = true;
/** 是否让 Fragment ref 支持 scrollIntoView。 */
export const enableFragmentRefsScrollIntoView: boolean = true;
/** 是否让 Fragment ref 返回实例句柄。 */
export const enableFragmentRefsInstanceHandles: boolean = true;
/** 是否让 Fragment ref 纳入文本节点。 */
export const enableFragmentRefsTextNodes: boolean = true;

/** 是否维护宿主实例到内部 React 实例的映射。 */
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
 * 是否移除旧 Context；提供方用 childContextTypes 声明 getChildContext 的字段，
 * 消费方用 contextTypes 声明要读取的字段。
 */
export const disableLegacyContext: boolean = true;
/**
 * 是否在函数组件中移除旧 Context；仅在 disableLegacyContext 关闭时还有独立作用。
 */
export const disableLegacyContextForFunctionComponents: boolean = true;

// 控制是否用 moveBefore() 替代 insertBefore()；前者可在移动节点时保留状态。
/** 是否使用 moveBefore() 移动节点并保留状态。 */
export const enableMoveBefore: boolean = false;

// 控制是否禁用客户端运行时中的 `react/cache` 缓存行为。
/** 是否禁用客户端运行时的 `react/cache` 缓存。 */
export const disableClientCache: boolean = true;

// 控制是否在使用 ReactTestRenderer 时发出警告。
/** 是否在使用 ReactTestRenderer 时发出弃用警告。 */
export const enableReactTestRendererWarning: boolean = true;

// 控制是否禁用 Legacy Mode；借此可先在实验构建落地移除旧 API 的破坏性变更，
// 再于下一个主版本从稳定构建中删除。
/** 是否禁用 Legacy Mode 与其旧 API。 */
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
/** 是否禁止把注释节点作为 React DOM 容器。 */
export const disableCommentsAsDOMContainers: boolean = true;

/** 是否与浏览器 Trusted Types 集成。 */
export const enableTrustedTypesIntegration: boolean = true;

// 控制是否阻止 value、checked attributes 与对应 DOM properties 同步。
/** 是否禁止 value、checked attributes 与对应 DOM properties 同步。 */
export const disableInputAttributeSyncing: boolean = false;

// 控制是否禁止 <textarea> 元素使用 children。
/** 是否禁止 <textarea> 通过 children 提供初始内容。 */
export const disableTextareaChildren: boolean = false;

// 控制是否启用并行 Transition。
/** 是否允许多个 Transition 并行推进。 */
export const enableParallelTransitions: boolean = false;

// -----------------------------------------------------------------------------
// 调试与 DevTools
// -----------------------------------------------------------------------------

// 控制是否为 Profiler 子树收集高级耗时指标。
/** 是否收集 Profiler 子树的高级耗时指标。 */
export const enableProfilerTimer = __PROFILE__;

// 通过 Chrome 扩展添加 performance.measure() 标记，使格式化的组件渲染轨道显示在 Performance 面板。
// Server Component 与 Client Component 轨道共用此开关；所有调用还必须受 enableProfilerTimer 门控。
/** 是否生成组件渲染性能轨道。 */
export const enableComponentPerformanceTrack: boolean = true;

// 控制是否在 React 性能轨道事件上附加 `performanceIssue` 元数据，以更醒目地标出性能问题；
// 最初用于 React Native 实验。
/** 是否给性能轨道事件附加 performanceIssue 元数据。 */
export const enablePerformanceIssueReporting: boolean = false;

// 为状态更新、Suspense、work loop 等添加 User Timing 标记，供实验性时间线工具使用。
/** 是否记录调度 User Timing 标记；默认实现由表达式 !enableComponentPerformanceTrack && __PROFILE__ 计算。 */
export const enableSchedulingProfiler: boolean =
  !enableComponentPerformanceTrack && __PROFILE__;

// 控制是否记录 commit 与 passive effects 阶段耗时。
/** 是否记录 commit 与 passive effects 阶段耗时。 */
export const enableProfilerCommitHooks = __PROFILE__;

// 控制传给 onRender 的 phase 参数是否区分 "update" 与 "nested-update"。
/** 是否将提交 effect 引发的嵌套更新报告为 Profiler onRender 的 nested-update 阶段。 */
export const enableProfilerNestedUpdatePhase = __PROFILE__;

/** 是否记录异步任务与 thenable 的调试信息。 */
export const enableAsyncDebugInfo: boolean = true;

// 控制是否追踪哪些 Fiber 安排了渲染工作。
/** 是否记录安排渲染工作的 Fiber。 */
export const enableUpdaterTracking = __PROFILE__;

/** 限制一个重置窗口内新建 owner stack 的次数；超出配额后不捕获创建栈，resetOwnerStackLimit 在超过 1000ms 后重置计数。 */
export const ownerStackLimit = 1e4;

// -----------------------------------------------------------------------------
// eslint-plugin-react-hooks
// -----------------------------------------------------------------------------
/** 是否让 Hooks 插件检查 useKeyedState 编译器规则。 */
export const eprh_enableUseKeyedStateCompilerLint: boolean = false;
/** 是否让 set-state-in-effect 编译器规则输出详细诊断。 */
export const eprh_enableVerboseNoSetStateInEffectCompilerLint: boolean = false;
/** 选择 exhaustive-deps 编译器 lint 的报告范围；'off' 不报告，'all' 报告全部，'extra-only' 只报多余依赖，'missing-only' 只报缺失依赖。 */
export const eprh_enableExhaustiveEffectDependenciesCompilerLint:
  | 'off'
  | 'all'
  | 'extra-only'
  | 'missing-only' = 'off';
