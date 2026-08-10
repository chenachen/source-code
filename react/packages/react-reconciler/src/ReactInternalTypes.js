/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  RefObject,
  ReactContext,
  StartTransitionOptions,
  Wakeable,
  Usable,
  ReactFormState,
  Awaited,
  ReactComponentInfo,
  ReactDebugInfo,
  ReactKey,
} from 'shared/ReactTypes';
import type {TransitionTypes} from 'react/src/ReactTransitionType';
import type {WorkTag} from './ReactWorkTags';
import type {TypeOfMode} from './ReactTypeOfMode';
import type {Flags} from './ReactFiberFlags';
import type {Lane, Lanes, LaneMap} from './ReactFiberLane';
import type {RootTag} from './ReactRootTags';
import type {
  Container,
  Instance,
  TimeoutHandle,
  NoTimeout,
  ActivityInstance,
  SuspenseInstance,
  TransitionStatus,
} from './ReactFiberConfig';
import type {Cache} from './ReactFiberCacheComponent';
import type {Transition} from 'react/src/ReactStartTransition';
import type {TracingMarkerInstance} from './ReactFiberTracingMarkerComponent';
import type {ConcurrentUpdate} from './ReactFiberConcurrentUpdates';
import type {ComponentStackNode} from 'react-server/src/ReactFizzComponentStack';
import type {ThenableState} from './ReactFiberThenable';
import type {ScheduledGesture} from './ReactFiberGestureScheduler';

// 为打破 ReactFiberHooks 的循环类型依赖移到本文件。
/** 开发构建记录的 Hook 调用种类，用于跨 render 校验顺序稳定。 */
export type HookType =
  | 'useState'
  | 'useReducer'
  | 'useContext'
  | 'useRef'
  | 'useEffect'
  | 'useEffectEvent'
  | 'useInsertionEffect'
  | 'useLayoutEffect'
  | 'useCallback'
  | 'useMemo'
  | 'useImperativeHandle'
  | 'useDebugValue'
  | 'useDeferredValue'
  | 'useTransition'
  | 'useSyncExternalStore'
  | 'useId'
  | 'useCacheRefresh'
  | 'useOptimistic'
  | 'useFormState'
  | 'useActionState';

/** Fiber 对单个 Context 的订阅节点；同一 Fiber 的订阅组成单链表。 */
export type ContextDependency<T> = {
  /** 被读取的 Context 对象。 */
  context: ReactContext<T>,
  /** 该 Fiber 的下一个 Context 依赖。 */
  next: ContextDependency<mixed> | null,
  /** 上次 render 读取的值，用于传播阶段判断是否真正变化。 */
  memoizedValue: T,
  ...
};

/** Fiber 在 render 中登记的 Context/thenable 等外部依赖。 */
export type Dependencies = {
  /** 因依赖变化而需要重新 render 的 Lane 集合。 */
  lanes: Lanes,
  /** Context 依赖单链表头。 */
  firstContext: ContextDependency<mixed> | null,
  /** 开发期保存 `use` 消费 thenable 的诊断状态。 */
  _debugThenableState?: null | ThenableState,
  ...
};

/** React Compiler 生成的 memo 槽缓存及本轮读取游标。 */
export type MemoCache = {
  /** 按调用位置保存的一组 memo 槽数组。 */
  data: Array<Array<any>>,
  /** 当前 render 下一组 memo 槽的顺序索引。 */
  index: number,
};

/**
 * 一个组件“待做或已完成工作”的持久节点。
 *
 * 同一逻辑组件通常有 current 与 work-in-progress 两枚 Fiber；字段同时承载实例身份、树结构、
 * render 输入/状态、Lane 与 commit effect，alternate 在两版之间建立双缓冲。
 */
export type Fiber = {
  // 前五项概念上属于 current/alternate 共享的 Instance 身份；受 Flow 交叉类型问题与首屏对象数
  // 权衡影响，当前仍与每版 Fiber 放在同一对象中。
  /** 决定 begin/complete/commit 分派分支的 WorkTag。 */
  tag: WorkTag,

  /** 同一父级 children 中用于跨 render 匹配身份的 key。 */
  key: ReactKey,

  /** 原始 element.type；即使热更新/lazy 改写 resolved type，也用于保持协调身份。 */
  elementType: any,

  /** 已解析的函数、class、宿主字符串或特殊类型；lazy 未解析时可为空。 */
  type: any,

  /** 与该 Fiber 绑定的宿主实例、class 实例、FiberRoot 或边界状态对象。 */
  stateNode: any,

  /** 当前这版树中的父 Fiber，也是完成该节点后控制流返回的“栈返回地址”。 */
  return: Fiber | null,

  /** 单链树的第一个 child。 */
  child: Fiber | null,
  /** 同一父级下一个 sibling。 */
  sibling: Fiber | null,
  /** 本 Fiber 在当前 sibling 序列中的位置，用于移动/复用判断。 */
  index: number,

  /** 最近一次 render 解析出的 callback/object ref；字符串 ref 兼容信息附在函数上。 */
  ref:
    | null
    | (((handle: mixed) => void) & {
        /** 旧版字符串 ref 转换后保留的原始名称。 */
        _stringRef: ?string,
        ...
      })
    | RefObject,

  /** callback ref 上次返回的 cleanup；新 ref 或卸载时在 detach 路径执行。 */
  refCleanup: null | (() => void),

  /** 本轮 render 尚待处理的输入 props；未来可按 WorkTag 收窄类型。 */
  pendingProps: any,
  /** 生成当前已提交输出时使用的 props。 */
  memoizedProps: any,

  /** class/root update queue、Hook effect 链或宿主更新负载等按标签解释的队列。 */
  updateQueue: mixed,

  /** 生成当前输出时使用的状态；按标签可能是 Hook 链、RootState、SuspenseState 等。 */
  memoizedState: any,

  /** 该 Fiber 已读取的 Context、thenable 等依赖；无依赖时为 null。 */
  dependencies: Dependencies | null,

  /**
   * 从父级继承的运行模式位；描述 Strict/Concurrent/Profile 等整棵子树性质。
   * 创建时可追加位，children 创建后不得再变，避免父子对模式理解不一致。
   */
  mode: TypeOfMode,

  /** 本节点在本次 render 产生、需要后续阶段消费的 flags。 */
  flags: Flags,
  /** 后代 flags 的按位聚合，让 commit 阶段可跳过无 effect 子树。 */
  subtreeFlags: Flags,
  /** child reconciliation 记录的待删除旧 Fiber 列表。 */
  deletions: Array<Fiber> | null,

  /** 直接作用于本 Fiber 的待处理更新 Lanes。 */
  lanes: Lanes,
  /** 后代待处理 Lanes 的聚合。 */
  childLanes: Lanes,

  /** current/work-in-progress 的另一面；惰性创建并可在内存压力路径断开回收。 */
  alternate: Fiber | null,

  /** 本次更新中渲染该 Fiber 及后代的实际耗时；bailout 不增加，仅 profiling 构建存在。 */
  actualDuration?: number,

  /** 该 Fiber 当前 render 工作开始时间；仅 profiling 构建存在。 */
  actualStartTime?: number,

  /** 最近一次真正 render 本 Fiber 的基准自耗时；memo bailout 时不更新。 */
  selfBaseDuration?: number,

  /** 本 Fiber 与全部后代基准耗时之和，在 complete 阶段向上聚合。 */
  treeBaseDuration?: number,

  // 以下字段只存在于开发构建，用于组件栈、热更新与 Hooks 顺序诊断。
  /** Server Component 等来源注入的附加调试 frame。 */
  _debugInfo?: ReactDebugInfo | null,
  /** 创建该元素的客户端 Fiber 或 Server Component info。 */
  _debugOwner?: ReactComponentInfo | Fiber | null,
  /** JSX 创建现场的 JavaScript Error stack。 */
  _debugStack?: Error | null,
  /** 浏览器 console task，用于把用户回调归因到对应组件。 */
  _debugTask?: ConsoleTask | null,
  /** 热更新要求丢弃现有状态并重新挂载该 Fiber。 */
  _debugNeedsRemount?: boolean,

  /** 上次 render 的 Hook 种类顺序，用于检测条件 Hook 或顺序变化。 */
  _debugHookTypes?: Array<HookType> | null,
};

/** FiberRoot 在所有构建中都存在的宿主、Lane、调度、cache 与错误处理状态。 */
type BaseFiberRootProperties = {
  /** root 的调度模式标签。 */
  tag: RootTag,

  /** HostConfig 提供的目标根容器。 */
  containerInfo: Container,
  /** persistence renderer 准备原子替换的 child set。 */
  pendingChildren: any,
  /** 当前已提交 HostRoot Fiber；commit 原子切换该指针。 */
  current: Fiber,

  /** thenable 到等待它的 Lanes/线程集合缓存，供 ping 去重。 */
  pingCache: WeakMap<Wakeable, Set<mixed>> | Map<Wakeable, Set<mixed>> | null,

  /** 延迟 fallback/commit 的 host timeout 句柄，可被更近更新取消。 */
  timeoutHandle: TimeoutHandle | NoTimeout,
  /** 取消已排队但尚未执行 commit 的函数；TODO：评估与 timeoutHandle 合并。 */
  cancelPendingCommit: null | (() => void),
  /** renderSubtreeIntoContainer 使用的已提交顶层旧 Context。 */
  context: Object | null,
  /** 下一次 root render 要采用、commit 后转正的顶层 Context。 */
  pendingContext: Object | null,

  /** 带待调度工作的 roots 单链表下一项。 */
  next: FiberRoot | null,

  /** Scheduler.scheduleCallback 返回的当前根级 Task；同步队列可使用非标准节点。 */
  callbackNode: any,
  /** callbackNode 已覆盖的最高 Lane 优先级，用于判断复用或取消重排。 */
  callbackPriority: Lane,
  /** 每个 Lane 的饥饿过期时间。 */
  expirationTimes: LaneMap<number>,
  /** hidden subtree 按 Lane 暂存的并发 update 集合。 */
  hiddenUpdates: LaneMap<Array<ConcurrentUpdate> | null>,

  /** root 尚未提交的全部 Lanes。 */
  pendingLanes: Lanes,
  /** 因等待 thenable/资源而暂停、尚未 ping 的 Lanes。 */
  suspendedLanes: Lanes,
  /** 已收到 thenable/资源可重试信号的 Lanes。 */
  pingedLanes: Lanes,
  /** 为避免重复预渲染而暂时视为已尝试的 Lanes。 */
  warmLanes: Lanes,
  /** 已超过饥饿期限、选择时必须同步推进的 Lanes。 */
  expiredLanes: Lanes,
  /** 正在触发默认 transition indicator 的 Lanes；仅对应开关开启时存在。 */
  indicatorLanes: Lanes,
  /** 已尝试错误恢复但仍失败、后续不得重复恢复的 Lanes。 */
  errorRecoveryDisabledLanes: Lanes,
  /** shell 连续挂起次数，用于防止无进展重试循环。 */
  shellSuspendCounter: number,

  /** 必须作为一组共同选择的 entangled Lanes。 */
  entangledLanes: Lanes,
  /** 每个 Lane 与之互相纠缠的 Lane 集合。 */
  entanglements: LaneMap<Lanes>,

  /** render 期间提供给新 cache 边界的临时共享 cache。 */
  pooledCache: Cache | null,
  /** 仍引用 pooledCache 的 Lanes；归零后可释放根持有。 */
  pooledCacheLanes: Lanes,

  /**
   * useId/hydration 标识前缀，避免同页多个 roots 冲突。
   * TODO：Fizz 按 server config 生成；Fiber 侧是否也下沉到 renderer 尚未决定，目前 tree 只能在 root 保存。
   */
  identifierPrefix: string,

  /** 未被 error boundary 捕获的 root 错误回调。 */
  onUncaughtError: (
    error: mixed,
    errorInfo: {
      /** 错误组件栈。 */
      +componentStack?: ?string
    },
  ) => void,
  /** 被 class error boundary 捕获的错误回调。 */
  onCaughtError: (
    error: mixed,
    errorInfo: {
      /** 错误组件栈。 */
      +componentStack?: ?string,
      /** 捕获该错误的 boundary 实例。 */
      +errorBoundary?: ?component(...props: any),
    },
  ) => void,
  /** React 已自动恢复但仍需报告的错误回调。 */
  onRecoverableError: (
    error: mixed,
    errorInfo: {
      /** 恢复事件对应组件栈。 */
      +componentStack?: ?string
    },
  ) => void,

  /** 请求 renderer 展示默认 transition indicator，并可返回清理函数。 */
  onDefaultTransitionIndicator: () => void | (() => void),
  /** 当前 indicator 的清理函数；仅开关开启时存在。 */
  pendingIndicator: null | (() => void),

  /** hydration 时从服务端复用的初始 form action 状态。 */
  formState: ReactFormState<any, any> | null,

  /** 本轮 root ViewTransition 类型集合；TODO：按 Lane 拆成 LaneMap。 */
  transitionTypes: null | TransitionTypes,
  /** 等待安排到 root 的手势 transition；仅对应开关开启时存在。 */
  pendingGestures: null | ScheduledGesture,
  /** 手势 transition 开始前保存的宿主根克隆。 */
  gestureClone: null | Instance,
};

/** 仅开发构建的 updater 归因，让 DevTools Profiler 显示谁安排了 commit。 */
type UpdaterTrackingOnlyFiberRootProperties = {
  /** 最近提交中涉及的 updater Fibers。 */
  memoizedUpdaters: Set<Fiber>,
  /** 按 Lane 暂存尚未归入提交的 updater Fibers。 */
  pendingUpdatersLaneMap: LaneMap<Set<Fiber>>,
};

/** renderer 可接收的 Suspense/Activity hydration 生命周期回调。 */
export type SuspenseHydrationCallbacks = {
  /** 某个服务端边界完成认领后调用。 */
  +onHydrated?: (
    hydrationBoundary: SuspenseInstance | ActivityInstance,
  ) => void,
  /** 某个服务端边界放弃 hydration 并删除后调用。 */
  +onDeleted?: (hydrationBoundary: SuspenseInstance | ActivityInstance) => void,
  ...
};

/** 仅 enableSuspenseCallback 开启时存在的 root hydration 回调状态。 */
type SuspenseCallbackOnlyFiberRootProperties = {
  /** root 入口传入的 hydration 回调；未提供时为 null。 */
  hydrationCallbacks: null | SuspenseHydrationCallbacks,
};

/** Profile 构建向宿主/DevTools 报告 transition 与 marker 生命周期的回调集合。 */
export type TransitionTracingCallbacks = {
  /** transition 第一次进入 root 工作时调用。 */
  onTransitionStart?: (transitionName: string, startTime: number) => void,
  /** transition 仍被 Suspense 边界阻塞时报告当前进度。 */
  onTransitionProgress?: (
    transitionName: string,
    startTime: number,
    currentTime: number,
    pending: Array<{
      /** 尚未完成的 Suspense 边界名称；匿名边界为 null。 */
      name: null | string
    }>,
  ) => void,
  /** transition 因边界删除等原因无法正常完成时报告终止项。 */
  onTransitionIncomplete?: (
    transitionName: string,
    startTime: number,
    deletions: Array<{
      /** 造成 transition 不完整的删除/中止类型。 */
      type: string,
      /** 相关 marker 或边界名称。 */
      name?: string | null,
      /** 该项结束或被删除的时间。 */
      endTime: number,
    }>,
  ) => void,
  /** transition 的全部 pending 边界清空时调用。 */
  onTransitionComplete?: (
    transitionName: string,
    startTime: number,
    endTime: number,
  ) => void,
  /** 某个 tracing marker 仍有 pending 边界时报告进度。 */
  onMarkerProgress?: (
    transitionName: string,
    marker: string,
    startTime: number,
    currentTime: number,
    pending: Array<{
      /** 该 marker 下尚未完成的边界名称。 */
      name: null | string
    }>,
  ) => void,
  /** marker 因边界删除等原因无法完整结束时报告终止项。 */
  onMarkerIncomplete?: (
    transitionName: string,
    marker: string,
    startTime: number,
    deletions: Array<{
      /** 造成 marker 不完整的删除/中止类型。 */
      type: string,
      /** 相关子 marker 或边界名称。 */
      name?: string | null,
      /** 该项结束或被删除的时间。 */
      endTime: number,
    }>,
  ) => void,
  /** marker 的全部 pending 边界清空时调用。 */
  onMarkerComplete?: (
    transitionName: string,
    marker: string,
    startTime: number,
    endTime: number,
  ) => void,
};

/** 仅 Profile 构建 transition tracing 使用的 root 状态。 */
type TransitionTracingOnlyFiberRootProperties = {
  /** root 入口传入的 tracing 回调。 */
  transitionCallbacks: null | TransitionTracingCallbacks,
  /** 按 Lane 记录参与该批更新的 transitions。 */
  transitionLanes: LaneMap<Set<Transition> | null>,
  /**
   * transition 到 tracing marker 状态的映射。
   * 每组 entangled transitions 可视为 marker；其 pending Suspense 集合清空时才算完成。
   */
  incompleteTransitions: Map<Transition, TracingMarkerInstance>,
};

/** 仅 profiler commit hooks 开启时累计的 root effect 耗时。 */
type ProfilerCommitHooksOnlyFiberRootProperties = {
  /** 本次 commit 同步 effects 总耗时。 */
  effectDuration: number,
  /** 本次 commit passive effects 总耗时。 */
  passiveEffectDuration: number,
};

/**
 * FiberRoot 的完整内部形状。
 *
 * 即使部分字段受构建开关控制，导出类型仍合并全部能力，避免消费点散落易错的 any cast；
 * 各能力子类型集中在本文件以保持字段同步。
 */
export type FiberRoot = {
  ...BaseFiberRootProperties,
  ...SuspenseCallbackOnlyFiberRootProperties,
  ...UpdaterTrackingOnlyFiberRootProperties,
  ...TransitionTracingOnlyFiberRootProperties,
  ...ProfilerCommitHooksOnlyFiberRootProperties,
};

/** useState/useOptimistic 等接受的直接状态或基于旧状态的函数 action。 */
type BasicStateAction<S> = (S => S) | S;
/** Hook queue 向外暴露的单参数 dispatch 函数。 */
type Dispatch<A> = A => void;

/** React 公共 Hook facade 在当前 render 中委托的完整实现契约。 */
export type Dispatcher = {
  /** 消费 Context、Thenable 或其他 Usable，并返回其已解析值。 */
  use: <T>(Usable<T>) => T,
  /** 读取 Context 并把依赖登记到当前 Fiber。 */
  readContext<T>(context: ReactContext<T>): T,
  /** 创建或读取 state Hook，并返回当前状态与稳定 dispatch。 */
  useState<S>(initialState: (() => S) | S): [S, Dispatch<BasicStateAction<S>>],
  /** 创建或读取 reducer Hook，并按可选 init 计算首次状态。 */
  useReducer<S, I, A>(
    reducer: (S, A) => S,
    initialArg: I,
    init?: (I) => S,
  ): [S, Dispatch<A>],
  /** 读取 Context 的 Hook 形式。 */
  useContext<T>(context: ReactContext<T>): T,
  /** 返回跨 render 保持身份的可变 ref 对象。 */
  useRef<T>(initialValue: T): {
    /** 调用方可变写入、跨 render 保持对象身份的当前值。 */
    current: T
  },
  /** 登记在 passive 阶段创建/清理的 effect。 */
  useEffect(
    create: () => (() => void) | void,
    deps: Array<mixed> | void | null,
  ): void,
  /** 返回身份稳定、调用时读取最新实现的 Effect Event 函数。 */
  useEffectEvent: <Args, F: (...Array<Args>) => mixed>(callback: F) => F,
  /** 登记在 mutation 前 insertion 阶段创建/清理的 effect。 */
  useInsertionEffect(
    create: () => (() => void) | void,
    deps: Array<mixed> | void | null,
  ): void,
  /** 登记在 mutation 后 layout 阶段同步创建/清理的 effect。 */
  useLayoutEffect(
    create: () => (() => void) | void,
    deps: Array<mixed> | void | null,
  ): void,
  /** 依赖未变化时复用先前 callback 身份。 */
  useCallback<T>(callback: T, deps: Array<mixed> | void | null): T,
  /** 依赖未变化时复用先前计算值，否则执行 nextCreate。 */
  useMemo<T>(nextCreate: () => T, deps: Array<mixed> | void | null): T,
  /** 在 layout 阶段把 create 结果暴露给 ref，并在变化/卸载时清理。 */
  useImperativeHandle<T>(
    ref:
      {
          /** layout 阶段写入的 imperative handle。 */
          current: T | null
        }
      | ((inst: T | null) => mixed)
      | null
      | void,
    create: () => T,
    deps: Array<mixed> | void | null,
  ): void,
  /** 向 DevTools 暴露自定义 Hook 调试值。 */
  useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void,
  /** 返回可在低优先级 Lane 追上输入的 deferred 值。 */
  useDeferredValue<T>(value: T, initialValue?: T): T,
  /** 返回 transition pending 状态与把更新标成 transition 的启动函数。 */
  useTransition(): [
    boolean,
    (callback: () => void, options?: StartTransitionOptions) => void,
  ],
  /** 订阅外部 store，并用快照一致性检查避免并发撕裂。 */
  useSyncExternalStore<T>(
    subscribe: (() => void) => () => void,
    getSnapshot: () => T,
    getServerSnapshot?: () => T,
  ): T,
  /** 生成对 SSR/hydration 稳定且在多 root 间不冲突的 id。 */
  useId(): string,
  /** 返回使指定资源类型 cache 失效/刷新的函数。 */
  useCacheRefresh: () => <T>(?() => T, ?T) => void,
  /** 为 React Compiler 返回固定大小、按调用顺序复用的 memo 槽。 */
  useMemoCache: (size: number) => Array<any>,
  /** 读取最近宿主 form transition 的 pending/data/method/action 状态。 */
  useHostTransitionStatus: () => TransitionStatus,
  /** 在 transition 中叠加乐观 action，并在权威 passthrough 更新后回退。 */
  useOptimistic: <S, A>(
    passthrough: S,
    reducer: ?(S, A) => S,
  ) => [S, (A) => void],
  /** 旧名称的表单 action state Hook；返回状态、dispatch 与 pending。 */
  useFormState: <S, P>(
    action: (Awaited<S>, P) => S,
    initialState: Awaited<S>,
    permalink?: string,
  ) => [Awaited<S>, (P) => void, boolean],
  /** 把异步 action 串行化并返回状态、dispatch 与 pending。 */
  useActionState: <S, P>(
    action: (Awaited<S>, P) => S,
    initialState: Awaited<S>,
    permalink?: string,
  ) => [Awaited<S>, (P) => void, boolean],
};

/** 非 render 专用的 cache dispatcher，由 React.cache 与 cacheSignal 使用。 */
export type AsyncDispatcher = {
  /** 按资源工厂身份在当前 Cache 中读取或惰性创建值。 */
  getCacheForType: <T>(resourceType: () => T) => T,
  /** 返回当前 Cache 生命周期对应的 AbortSignal；无 cache 上下文时为 null。 */
  cacheSignal: () => null | AbortSignal,
  /** 开发期返回当前 Fiber/Server Component owner，用于创建现场归因。 */
  getOwner: () => null | Fiber | ReactComponentInfo | ComponentStackNode,
};
