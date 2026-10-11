/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import typeof * as FeatureFlagsType from 'shared/ReactFeatureFlags';
import typeof * as ExportsType from './ReactFeatureFlags.www';
import typeof * as DynamicFeatureFlags from './ReactFeatureFlags.www-dynamic';

// 从 WWW Haste 模块重新导出动态开关。
/** 承接 WWW Haste 模块注入的动态 Feature Flags，并为静态 fork 提供类型约束；WWW 静态 fork 通过 require('ReactFeatureFlags') 注入 WWW GK 值。 */
const dynamicFeatureFlags: DynamicFeatureFlags = require('ReactFeatureFlags');

/** WWW 静态 fork 的动态开关导出集合；解构一次可避免每次读取时动态查找，逐项门控见各绑定。 */
export const {
  /** 是否把仅 retry 的提交统一纳入 fallback 节流；关闭时只对 RootSuspended 结果节流。 */
  alwaysThrottleRetries,
  /** 是否只在函数组件中禁用旧 Context。 */
  disableLegacyContextForFunctionComponents,
  /** 是否禁用 work loop 对 Scheduler didTimeout 的依赖。 */
  disableSchedulerTimeoutInWorkLoop,
  /** 是否在 root 更新与 ping 路径增加 render/commit 递归更新检测。 */
  enableInfiniteRenderLoopDetection,
  /** 是否将额外递归更新检测的警告提升为抛错。 */
  enableInfiniteRenderLoopDetectionForceThrow,
  /** 是否警告初次挂载因 use 挂起、重试完成后同一位置却不再调用 use 的情况。 */
  enableConditionalUseWarning,
  /** 是否复用 memo cache，避免渲染时克隆。 */
  enableNoCloningMemoCache,
  /** 是否用普通对象而非构造器创建 Fiber。 */
  enableObjectFiber,
  /** 是否为 retry lanes 设置过期时间以避免饥饿。 */
  enableRetryLaneExpiration,
  /** 是否追踪 Transition 与导致加载态的异步工作。 */
  enableTransitionTracing,
  /** retry lane 的等待预算，单位毫秒；仅在 enableRetryLaneExpiration 开启时用于计算期限。 */
  retryLaneExpirationMs,
  /** Sync、InputContinuous、Gesture 及对应 hydration lane 的等待预算，单位毫秒。 */
  syncLaneExpirationMs,
  /** Default、Transition 及对应 hydration lane 的等待预算，单位毫秒。 */
  transitionLaneExpirationMs,
  /** 是否让图片资源参与 Suspense。 */
  enableSuspenseyImages,
  /** 是否启用 View Transition 集成。 */
  enableViewTransition,
  /** 是否在原生 scrollend 不可用时启用 polyfill。 */
  enableScrollEndPolyfill,
  /** 是否暴露 Fragment ref 能力。 */
  enableFragmentRefs,
  /** 是否让 Fragment ref 支持 scrollIntoView。 */
  enableFragmentRefsScrollIntoView,
  /** 是否让 Fragment ref 纳入文本节点。 */
  enableFragmentRefsTextNodes,
  /** 是否维护宿主实例到内部 React 实例的映射。 */
  enableInternalInstanceMap,
  /** 是否允许多个 Transition 并行推进。 */
  enableParallelTransitions,
  /** 是否让 View Transition 处理父级 enter/exit。 */
  enableViewTransitionParentEnterExit,
} = dynamicFeatureFlags;

// 在 WWW 中，__EXPERIMENTAL__ 用于新的现代构建；目前尚未投入任何生产路径。

/** 是否收集 Profiler 子树的高级耗时指标。 */
export const enableProfilerTimer = __PROFILE__;
/** 是否记录 commit 与 passive effects 阶段耗时。 */
export const enableProfilerCommitHooks = __PROFILE__;
/** 是否将提交 effect 引发的嵌套更新报告为 Profiler onRender 的 nested-update 阶段。 */
export const enableProfilerNestedUpdatePhase = __PROFILE__;
/** 是否记录安排渲染工作的 Fiber。 */
export const enableUpdaterTracking = __PROFILE__;
/** 是否与浏览器 Trusted Types 集成。 */
export const enableTrustedTypesIntegration: boolean = true;
/** 是否支持 Fiber 的 unstable_avoidThisFallback。 */
export const enableSuspenseAvoidThisFallback: boolean = true;

/** 是否记录异步任务与 thenable 的调试信息。 */
export const enableAsyncDebugInfo: boolean = true;
/** 是否允许 CPU 工作通过 Suspense 挂起。 */
export const enableCPUSuspense: boolean = true;
/** 是否使用 moveBefore() 移动节点并保留状态。 */
export const enableMoveBefore: boolean = false;
/** 是否禁止 value、checked attributes 与对应 DOM properties 同步。 */
export const disableInputAttributeSyncing: boolean = false;
/** 是否保留 Meta WWW 的旧 Primer 兼容路径。 */
export const enableLegacyFBSupport: boolean = true;

/** 是否在 passive effects 前让出浏览器事件循环。 */
export const enableYieldingBeforePassive: boolean = false;

/** 是否减少主动让出执行权以限制高帧率动画。 */
export const enableThrottledScheduling: boolean = false;

/** 是否生成组件渲染性能轨道。 */
export const enableComponentPerformanceTrack: boolean = true;

/** 是否给性能轨道事件附加 performanceIssue 元数据。 */
export const enablePerformanceIssueReporting: boolean = false;

// 控制是否为实验性性能分析工具记录额外的 User Timing API 标记。
/** 是否记录调度 User Timing 标记；WWW 静态 fork 由表达式 __PROFILE__ && dynamicFeatureFlags.enableSchedulingProfiler 计算。 */
export const enableSchedulingProfiler: boolean =
  __PROFILE__ && dynamicFeatureFlags.enableSchedulingProfiler;

/** 是否禁用静态 contextTypes/childContextTypes 旧 Context。 */
export const disableLegacyContext = __EXPERIMENTAL__;

/** 是否保留旧 Cache 实现。 */
export const enableLegacyCache: boolean = true;

/** 是否允许 AsyncIterable 作为 children 被消费。 */
export const enableAsyncIterableChildren: boolean = false;
/** 是否让 Flight 支持不会独自维持流的 pending_weak thenable。 */
export const enableFlightWeakThenables: boolean = false;

/** 是否启用 Server Components 的 taint 跟踪 API。 */
export const enableTaint: boolean = false;

// TODO：WWW 当前仍依赖此能力，而开源构建已禁用；需先完成迁移再移除。
/** 是否禁止把注释节点作为 React DOM 容器。 */
export const disableCommentsAsDOMContainers: boolean = false;

/** 是否提供实验性的 Create Event Handle API。 */
export const enableCreateEventHandleAPI: boolean = true;

/** 是否导出 react-dom 的 browser() API。 */
export const enableBrowserAPI: boolean = true;

/** 是否在 mutation 阶段更新 useEffectEvent 函数引用。 */
export const enableEffectEventMutationPhase: boolean = true;

/** 是否提供实验性的 Scope API。 */
export const enableScopeAPI: boolean = true;

/** 是否让 Suspense 报告待处理 Promise 与 hydration 结果。 */
export const enableSuspenseCallback: boolean = true;

/** 是否保留语义不同的内部 LegacyHidden API。 */
export const enableLegacyHidden: boolean = true;

/** 是否禁止 <textarea> 通过 children 提供初始内容。 */
export const disableTextareaChildren = __EXPERIMENTAL__;

/** 是否让 Fizz 以 data attributes 配合外部运行时发送指令。 */
export const enableFizzExternalRuntime: boolean = true;

/** 是否在持久化节点需要重建 children 时将 ChildSet 直接传给 cloneInstance；关闭时在克隆后追加 children。 */
export const passChildrenWhenCloningPersistedNodes: boolean = false;

/** 是否禁用客户端运行时的 `react/cache` 缓存。 */
export const disableClientCache: boolean = true;

/** 是否在使用 ReactTestRenderer 时发出弃用警告。 */
export const enableReactTestRendererWarning: boolean = false;

/** 是否禁用 Legacy Mode 与其旧 API。 */
export const disableLegacyMode: boolean = true;

/** 是否在 Persistence renderer 中启用 View Transition。 */
export const enableViewTransitionForPersistenceMode: boolean = false;

/** 是否启用由手势驱动的 Transition。 */
export const enableGestureTransition: boolean = false;

/** 是否让 Fizz 识别会阻塞渲染的资源。 */
export const enableFizzBlockingRender: boolean = true;
/** 是否支持把 srcObject 作为宿主属性写入。 */
export const enableSrcObject: boolean = false;
/** 是否在 hydration 中恢复 change 事件处理。 */
export const enableHydrationChangeEvent: boolean = false;
/** 是否提供默认 Transition 进度指示器。 */
export const enableDefaultTransitionIndicator: boolean = true;

/** 限制一个重置窗口内新建 owner stack 的次数；超出配额后不捕获创建栈，resetOwnerStackLimit 在超过 1000ms 后重置计数。 */
export const ownerStackLimit = 1e4;

/** 是否让 Fragment ref 返回实例句柄。 */
export const enableFragmentRefsInstanceHandles: boolean = true;

/** 是否启用区别于字符串 key 的内部乐观 key。 */
export const enableOptimisticKey: boolean = false;

// 这些开关只供 eslint-plugin-react-hooks 使用；其 WWW 专用值位于独立 fork
// ReactFeatureFlags.eslint-plugin.www.js。修改 WWW lint 行为时应编辑该文件。
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

// 利用 Flow 类型链验证此 fork 与原始模块的导出集合完全一致。
null as any as ExportsType as FeatureFlagsType as ExportsType;
