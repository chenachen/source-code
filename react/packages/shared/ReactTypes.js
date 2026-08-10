/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactOptimisticKey} from './ReactSymbols';

export type {ReactOptimisticKey};

/** React 元素 key 的内部规范化形态；`null` 表示未显式指定身份。 */
export type ReactKey = null | string | ReactOptimisticKey;

/** renderer 可接收的非空 React 子节点集合。 */
export type ReactNode =
  | React$Element<any>
  | ReactPortal
  | ReactText
  | ReactFragment
  | ReactProvider<any>
  | ReactConsumer<any>;

/** 在 children 位置不产生 Fiber 的空值。 */
export type ReactEmpty = null | void | boolean;

/** 空 children 或一个可迭代的 React 节点序列。 */
export type ReactFragment = ReactEmpty | Iterable<React$Node>;

/** 单个 children 插槽接受的空值或 React 节点。 */
export type ReactNodeList = ReactEmpty | React$Node;

/** 会被 renderer 转为文本节点的原始值。 */
export type ReactText = string | number;

/** `Context.Provider` 创建的元素记录，携带本次提供的值与子树。 */
export type ReactProvider<T> = {
  /** Provider 元素的 React 身份标记。 */
  $$typeof: symbol | number,
  /** 同时充当 Provider 类型的 Context 本体。 */
  type: ReactContext<T>,
  /** 在同级 Provider 间维持身份的 key。 */
  key: ReactKey,
  /** Provider 不接受 ref。 */
  ref: null,
  /** Provider 的值与可选 children。 */
  props: {
    /** 压入 context 栈、供后代读取的值。 */
    value: T,
    /** 被该值覆盖的后代节点。 */
    children?: ReactNodeList,
  },
};

/** `Context.Consumer` 的类型描述对象，反向指向其 Context。 */
export type ReactConsumerType<T> = {
  /** 让 reconciler 选择 ContextConsumer 分支的身份标记。 */
  $$typeof: symbol | number,
  /** Consumer 实际读取的 Context 本体。 */
  _context: ReactContext<T>,
};

/** Consumer 元素记录，通过 render prop 消费当前 Context 值。 */
export type ReactConsumer<T> = {
  /** Consumer 元素的 React 身份标记。 */
  $$typeof: symbol | number,
  /** 持有 Context 引用的 Consumer 类型对象。 */
  type: ReactConsumerType<T>,
  /** 在同级 Consumer 间维持身份的 key。 */
  key: ReactKey,
  /** Consumer 不接受 ref。 */
  ref: null,
  /** Consumer 的 render prop 容器。 */
  props: {
    /**
     * 用当前 Context 值计算 Consumer 子树。
     *
     * @param value - reconciler 从对应 Context 栈读取的当前值。
     */
    children: (value: T) => ReactNodeList,
  },
};

/**
 * 跨 renderer 共享的 Context 状态容器。
 *
 * @remarks
 * 两组 current value/renderer 槽允许主 renderer 与次 renderer 并存；render 期间由
 * reconciler 按栈保存与恢复，不能把它们当作普通应用状态直接修改。
 */
export type ReactContext<T> = {
  /** 标识 Context 类型对象。 */
  $$typeof: symbol | number,
  /** 读取该 Context 的 Consumer 类型包装。 */
  Consumer: ReactConsumerType<T>,
  /** Provider 入口；当前实现由 Context 本体自引用。 */
  Provider: ReactContext<T>,
  /** 主 renderer 当前生效的值。 */
  _currentValue: T,
  /** 次 renderer 当前生效的值。 */
  _currentValue2: T,
  /** 并发 server renderer 为该 Context 分配的线程槽计数。 */
  _threadCount: number,
  /** 开发期记录占用主值槽的 renderer，用于检测不支持的并发 renderer。 */
  _currentRenderer?: Object | null,
  /** 开发期记录占用次值槽的 renderer。 */
  _currentRenderer2?: Object | null,
  /** 应用可选的开发期显示名，供 DevTools 和诊断信息使用。 */
  displayName?: string,
};

/** 把 React 子树定向到 renderer 特定外部容器的 Portal 记录。 */
export type ReactPortal = {
  /** 让 reconciler 把记录识别为 Portal 而非普通元素。 */
  $$typeof: symbol | number,
  /** 在同级 Portal 间维持身份的 key。 */
  key: ReactKey,
  /** HostConfig 理解的目标容器句柄。 */
  containerInfo: any,
  /** 要在目标容器中协调的节点。 */
  children: ReactNodeList,
  /** TODO：跨 renderer Portal 尚未形成公开契约，当前保留实现句柄。 */
  implementation: any,
};

/** 由 `createRef` 返回、由 renderer 在 commit 阶段写入的可变容器。 */
export type RefObject = {
  /** 当前宿主实例/组件实例；卸载时会恢复为 `null`。 */
  current: any,
};

/** 实验性 Scope 元素的类型标记记录。 */
export type ReactScope = {
  /** 让 renderer 选择 Scope 处理分支的身份标记。 */
  $$typeof: symbol | number,
};

/** 判断某个宿主实例是否满足 Scope 查询条件。 */
export type ReactScopeQuery = (
  type: string,
  props: {
    /** 查询只读的宿主 props 键值。 */
    [string]: mixed
  },
  instance: mixed,
) => boolean;

/** renderer 为已挂载 Scope 暴露的受限查询接口。 */
export type ReactScopeInstance = {
  /** 返回所有满足查询的后代宿主节点；Scope 不可用时返回 `null`。 */
  DO_NOT_USE_queryAllNodes(ReactScopeQuery): null | Array<Object>,
  /** 返回首个满足查询的后代宿主节点。 */
  DO_NOT_USE_queryFirstNode(ReactScopeQuery): null | Object,
  /** 判断宿主节点是否属于该 Scope 子树。 */
  containsNode(Object): boolean,
  /** 读取 Scope 后代中指定 Context 的所有可见值。 */
  getChildContextValues: <T>(context: ReactContext<T>) => Array<T>,
};

/**
 * Suspense 允许抛出的最小 Thenable 子集。
 *
 * @remarks fulfillment/rejection 回调都不要求接收值，只承担“可重试”通知。
 */
export interface Wakeable {
  /** 注册完成或失败后的重试通知；返回同类 Wakeable 也被接受。 */
  then(onFulfill: () => mixed, onReject: () => mixed): void | Wakeable;
}

/**
 * React API 消费的 Promise 最小契约。
 *
 * @remarks 与 Wakeable 不同，此接口会把已解析值传给成功回调；回调及 `then` 本身均
 * 不要求返回可链式结果。
 */
interface ThenableImpl<T> {
  /** 注册值解析或失败回调。 */
  then(
    onFulfill: (value: T) => mixed,
    onReject: (error: mixed) => mixed,
  ): void | Wakeable;
  /** 可选诊断名，用于开发期显示异步来源。 */
  displayName?: string;
}
/** 尚未被 React 加装状态字段的原始 Thenable。 */
interface UntrackedThenable<T> extends ThenableImpl<T> {
  /** 未跟踪阶段没有可观察的状态字面量。 */
  status?: void;
  /** 可选开发期异步调试链。 */
  _debugInfo?: null | ReactDebugInfo;
}

/** 已被 React 跟踪、仍等待完成的 Thenable。 */
export interface PendingThenable<T> extends ThenableImpl<T> {
  /** 表示当前读取必须挂起。 */
  status: 'pending';
  /** 可选开发期异步调试链。 */
  _debugInfo?: null | ReactDebugInfo;
}

/** 弱等待状态的 Thenable；允许不因等待关系强持有异步资源。 */
export interface WeakPendingThenable<T> extends ThenableImpl<T> {
  /** 区分普通 pending 与弱引用等待。 */
  status: 'pending_weak';
  /** 可选开发期异步调试链。 */
  _debugInfo?: null | ReactDebugInfo;
}

/** 已成功完成并缓存解析值的 Thenable。 */
export interface FulfilledThenable<T> extends ThenableImpl<T> {
  /** 表示读取可以同步返回 `value`。 */
  status: 'fulfilled';
  /** 首次 fulfillment 保存的解析结果。 */
  value: T;
  /** 可选开发期异步调试链。 */
  _debugInfo?: null | ReactDebugInfo;
}

/** 已失败并缓存拒绝原因的 Thenable。 */
export interface RejectedThenable<T> extends ThenableImpl<T> {
  /** 表示读取必须同步抛出 `reason`。 */
  status: 'rejected';
  /** 首次 rejection 保存的失败原因。 */
  reason: mixed;
  /** 可选开发期异步调试链。 */
  _debugInfo?: null | ReactDebugInfo;
}

/** React 可消费的原始或已跟踪 Thenable 状态联合。 */
export type Thenable<T> =
  | UntrackedThenable<T>
  | PendingThenable<T>
  | WeakPendingThenable<T>
  | FulfilledThenable<T>
  | RejectedThenable<T>;

/**
 * 允许中间 renderer 把子树延后交给下游 renderer 的特殊错误。
 *
 * @remarks 它不产生值：renderer 要么继续穿过该对象，要么中断当前 render，让后续
 * renderer 恢复这棵子树。
 */
export type ReactRecoverable = Error & {
  /** 把普通 Error 与可跨 renderer 恢复的控制信号区分开。 */
  $$typeof: symbol,
};

/** `startTransition` 的可选诊断配置。 */
export type StartTransitionOptions = {
  /** 供性能追踪与开发工具显示的 transition 名称。 */
  name?: string,
};

/** `use` 可读取的 Thenable、Context 或跨 renderer 恢复信号。 */
export type Usable<T> = Thenable<T> | ReactContext<T> | ReactRecoverable;

/** renderer 将函数式表单 action 编码为宿主表单属性后的结果。 */
export type ReactCustomFormAction = {
  /** 提交字段名。 */
  name?: string,
  /** 提交目标 URL。 */
  action?: string,
  /** 表单数据编码类型。 */
  encType?: string,
  /** HTTP 提交方法。 */
  method?: string,
  /** 浏览上下文 target。 */
  target?: string,
  /** action 绑定参数生成的附加 FormData。 */
  data?: null | FormData,
};

/**
 * 服务端 `decodeFormState` 返回、客户端也要识别的表单状态元组。
 *
 * @remarks 服务端把它当作 opaque 结果；契约放在 shared 是因为 React 客户端会读取同一
 * 元组，而不是因为客户端能构造任意等价数组。
 */
export type ReactFormState<S, ReferenceId> = [
  S /* 实际状态值 */,
  string /* key 路径 */,
  ReferenceId /* 服务端引用 ID */,
  number /* 已绑定参数数量 */,
];

/**
 * renderer 环境提供的内建手势 timeline。
 *
 * @remarks 具体类型和支持能力由宿主环境决定，shared 只能保留不透明边界。
 */
export type GestureProvider = any;

/** 手势驱动 View Transition 时可选的归一化区间。 */
export type GestureOptions = {
  /** timeline 映射区间的起点。 */
  rangeStart?: number,
  /** timeline 映射区间的终点。 */
  rangeEnd?: number,
};

/** 递归解包 PromiseLike 值，同时保留 null/undefined 与非 thenable。 */
export type Awaited<T> = T extends null | void
  ? T // 非 strictNullChecks 模式下也单独保留 `null | undefined`。
  : T extends Object // `await` 只解包具有可调用 then 的对象，原始值保持不变。
    ? T extends {then(onfulfilled: infer F): any} // 从 thenable 的首个回调提取类型。
      ? F extends (value: infer V) => any // 只有回调可调用时才能提取 fulfillment 值。
        ? Awaited<V> // 对 fulfillment 值继续递归解包。
        : empty // `then` 的首个参数不可调用，契约无效。
      : T // 对象不是 thenable。
    : T; // 非对象也不是 thenable。

/** 控制台协议使用的紧凑调用点元组。 */
export type ReactCallSite = [
  string, // 函数名。
  string, // 文件名；TODO：把嵌套 eval 位置建模为嵌套数组。
  number, // 行号。
  number, // 列号。
  number, // 外层函数起始行号。
  number, // 外层函数起始列号。
  boolean, // 是否由异步恢复点进入。
];

/** 按调用顺序排列的 React 调试栈。 */
export type ReactStackTrace = Array<ReactCallSite>;

/** 只保留函数及其外层源码位置的紧凑元组。 */
export type ReactFunctionLocation = [
  string, // 函数名。
  string, // 文件名；TODO：把嵌套 eval 位置建模为嵌套数组。
  number, // 外层函数起始行号。
  number, // 外层函数起始列号。
];

/** Server Component/开发工具传输的组件归属与调用位置信息。 */
export type ReactComponentInfo = {
  /** 组件或宿主类型的可读名称。 */
  +name: string,
  /** 创建该条目的执行环境名称。 */
  +env?: string,
  /** 对应元素的 key。 */
  +key?: ReactKey,
  /** 创建当前条目的 owner 信息，形成只读 owner 链。 */
  +owner?: null | ReactComponentInfo,
  /** 可序列化的组件调用栈。 */
  +stack?: null | ReactStackTrace,
  /** 诊断所需的 props 快照；`null` 表示未采集。 */
  +props?: null | {
    /** props 名称到诊断值的映射。 */
    [name: string]: mixed
  },
  /** 当前执行环境暂存的原生 Error，不属于传输协议。 */
  +debugStack?: null | Error,
  /** 当前执行环境暂存的 console task，不属于传输协议。 */
  +debugTask?: null | ConsoleTask,
  /** 指向定义/创建位置的开发期 Error。 */
  debugLocation?: null | Error,
};

/** 只描述一次环境切换的调试条目。 */
export type ReactEnvironmentInfo = {
  /** 新的执行环境名称。 */
  +env: string,
};

/** 生产错误对外保留的稳定摘要。 */
export type ReactErrorInfoProd = {
  /** 服务端或 renderer 生成的错误 digest。 */
  +digest: string,
};

/** 可安全放入 React 错误协议的递归 JSON 值。 */
export type JSONValue =
  | string
  | boolean
  | number
  | null
  | {
      /** JSON 对象的字符串键值。 */
      +[key: string]: JSONValue
    }
  | $ReadOnlyArray<JSONValue>;

/** 开发错误协议携带的可读信息与结构化因果链。 */
export type ReactErrorInfoDev = {
  /** 可选服务端/renderer digest。 */
  +digest?: string,
  /** 原始错误类型名称。 */
  +name: string,
  /** 原始错误消息。 */
  +message: string,
  /** 转为传输协议的调用栈。 */
  +stack: ReactStackTrace,
  /** 捕获错误的执行环境。 */
  +env: string,
  /** 可选 owner 名称。 */
  +owner?: null | string,
  /** 序列化后的 `cause`。 */
  cause?: JSONValue,
  /** AggregateError 等错误集合的序列化结果。 */
  errors?: JSONValue,
};

/** 生产或开发错误协议的联合。 */
export type ReactErrorInfo = ReactErrorInfoProd | ReactErrorInfoDev;

/**
 * 一次 I/O 开始与结束时采集的异步信息。
 *
 * @remarks 记录的是 I/O 发起位置；它可能与 Promise 被 `await` 的位置不同。
 */
export type ReactIOInfo = {
  /** 异步函数或资源名称，例如 `fetch`。 */
  +name: string,
  /** I/O 开始时间。 */
  +start: number,
  /** I/O 结束时间；不保证等于 await 被解除阻塞的时间。 */
  +end: number,
  /** 网络资源字节数；只有影响客户端时才应提供。 */
  +byteSize?: number,
  /** 被等待的 Promise；它仍可能处于 rejected 状态。 */
  +value?: null | Promise<mixed>,
  /** 发起 I/O 的执行环境。 */
  +env?: string,
  /** 发起 I/O 的 owner。 */
  +owner?: null | ReactComponentInfo,
  /** 发起 I/O 的可传输调用栈。 */
  +stack?: null | ReactStackTrace,
  /** 执行环境暂存的原生 Error，不属于传输协议。 */
  +debugStack?: null | Error,
  /** 执行环境暂存的 console task，不属于传输协议。 */
  +debugTask?: null | ConsoleTask,
};

/** 把一次 await 位置连接到其源 I/O 的调试条目。 */
export type ReactAsyncInfo = {
  /** 被当前位置等待的 I/O 条目。 */
  +awaited: ReactIOInfo,
  /** 执行 await 的环境；可能与 I/O 发起环境不同。 */
  +env?: string,
  /** 执行 await 的 owner。 */
  +owner?: null | ReactComponentInfo,
  /** 执行 await 的可传输调用栈。 */
  +stack?: null | ReactStackTrace,
  /** 执行环境暂存的原生 Error，不属于传输协议。 */
  +debugStack?: null | Error,
  /** 执行环境暂存的 console task，不属于传输协议。 */
  +debugTask?: null | ConsoleTask,
};

/** 时间线中的单个时间戳调试条目。 */
export type ReactTimeInfo = {
  /** `performance.now()` 时间基准下的毫秒值。 */
  +time: number,
};

/** 调试流中允许出现的组件、环境、异步或时间条目。 */
export type ReactDebugInfoEntry =
  | ReactComponentInfo
  | ReactEnvironmentInfo
  | ReactAsyncInfo
  | ReactTimeInfo;

/** 与元素或 Thenable 关联、按发生顺序排列的调试条目。 */
export type ReactDebugInfo = Array<ReactDebugInfoEntry>;

/**
 * renderer 环境提供的内建 View Transition 实例。
 *
 * @remarks 具体能力由宿主环境决定，shared 不假定 DOM API。
 */
export type ViewTransitionInstance = any;

/** 按 transition type 选择宿主 transition class 的映射。 */
export type ViewTransitionClassPerType = {
  /** `default` 或调用方定义的 type 到 class 策略。 */
  [transitionType: 'default' | string]: 'none' | 'auto' | string,
};

/** 单一 class 策略或按 transition type 分派的 class 映射。 */
export type ViewTransitionClass =
  | 'none'
  | 'auto'
  | string
  | ViewTransitionClassPerType;

/** renderer 传给手势回调的已补全 timeline 区间。 */
export type GestureOptionsRequired = {
  /** timeline 映射区间起点。 */
  rangeStart: number,
  /** timeline 映射区间终点。 */
  rangeEnd: number,
};

/** ViewTransition 边界的 class 规则与生命周期回调。 */
export type ViewTransitionProps = {
  /** 用于匹配共享 transition 的可选名称。 */
  name?: string,
  /** 受该 transition 边界管理的子树。 */
  children?: ReactNodeList,
  /** 未命中特定阶段规则时使用的默认 class。 */
  default?: ViewTransitionClass,
  /** 子树进入时使用的 class。 */
  enter?: ViewTransitionClass,
  /** 子树退出时使用的 class。 */
  exit?: ViewTransitionClass,
  /** 同名边界共享元素时使用的 class。 */
  share?: ViewTransitionClass,
  /** 已存在子树更新时使用的 class。 */
  update?: ViewTransitionClass,
  /** 后代进入导致父边界参与时使用的 class。 */
  parentEnter?: ViewTransitionClass,
  /** 后代退出导致父边界参与时使用的 class。 */
  parentExit?: ViewTransitionClass,
  /** 进入 transition 开始时接收宿主实例和激活的 type，并可返回清理函数。 */
  onEnter?: (
    instance: ViewTransitionInstance,
    types: Array<string>,
  ) => void | (() => void),
  /** 退出 transition 开始时接收宿主实例和激活的 type，并可返回清理函数。 */
  onExit?: (
    instance: ViewTransitionInstance,
    types: Array<string>,
  ) => void | (() => void),
  /** 后代进入使父边界参与时触发，并可返回清理函数。 */
  onParentEnter?: (
    instance: ViewTransitionInstance,
    types: Array<string>,
  ) => void | (() => void),
  /** 后代退出使父边界参与时触发，并可返回清理函数。 */
  onParentExit?: (
    instance: ViewTransitionInstance,
    types: Array<string>,
  ) => void | (() => void),
  /** 共享元素 transition 开始时触发，并可返回清理函数。 */
  onShare?: (
    instance: ViewTransitionInstance,
    types: Array<string>,
  ) => void | (() => void),
  /** 更新 transition 开始时触发，并可返回清理函数。 */
  onUpdate?: (
    instance: ViewTransitionInstance,
    types: Array<string>,
  ) => void | (() => void),
  /** 手势驱动的进入 transition 开始时接收 timeline、区间、实例和 type。 */
  onGestureEnter?: (
    timeline: GestureProvider,
    options: GestureOptionsRequired,
    instance: ViewTransitionInstance,
    types: Array<string>,
  ) => void | (() => void),
  /** 手势驱动的退出 transition 开始时接收 timeline、区间、实例和 type。 */
  onGestureExit?: (
    timeline: GestureProvider,
    options: GestureOptionsRequired,
    instance: ViewTransitionInstance,
    types: Array<string>,
  ) => void | (() => void),
  /** 手势驱动后代进入使父边界参与时触发。 */
  onGestureParentEnter?: (
    timeline: GestureProvider,
    options: GestureOptionsRequired,
    instance: ViewTransitionInstance,
    types: Array<string>,
  ) => void | (() => void),
  /** 手势驱动后代退出使父边界参与时触发。 */
  onGestureParentExit?: (
    timeline: GestureProvider,
    options: GestureOptionsRequired,
    instance: ViewTransitionInstance,
    types: Array<string>,
  ) => void | (() => void),
  /** 手势驱动共享元素 transition 时触发。 */
  onGestureShare?: (
    timeline: GestureProvider,
    options: GestureOptionsRequired,
    instance: ViewTransitionInstance,
    types: Array<string>,
  ) => void | (() => void),
  /** 手势驱动已存在子树更新时触发。 */
  onGestureUpdate?: (
    timeline: GestureProvider,
    options: GestureOptionsRequired,
    instance: ViewTransitionInstance,
    types: Array<string>,
  ) => void | (() => void),
};

/** Activity 边界控制子树可见性与诊断名称的 props。 */
export type ActivityProps = {
  /** `hidden` 保留子树但隐藏宿主效果，`visible` 恢复可见工作。 */
  mode?: 'hidden' | 'visible' | null | void,
  /** Activity 管理的子树。 */
  children?: ReactNodeList,
  /** 供追踪与开发工具使用的可选名称。 */
  name?: string,
};

/** Suspense 边界的主内容、fallback 与实验性协调选项。 */
export type SuspenseProps = {
  /** 正常完成时显示的主子树。 */
  children?: ReactNodeList,
  /** 主子树挂起时可显示的替代内容。 */
  fallback?: ReactNodeList,

  /** TODO：该实验回调是否应增加 `unstable_` 前缀仍未确定。 */
  suspenseCallback?: (Set<Wakeable> | null) => mixed,

  /** 提示协调器优先寻找外层 fallback，属于不稳定选项。 */
  unstable_avoidThisFallback?: boolean,
  /** 请求延后显示该边界的实验性标志。 */
  defer?: boolean,
  /** 供追踪与开发工具使用的可选名称。 */
  name?: string,
};

/** SuspenseList 允许的行揭示顺序。 */
export type SuspenseListRevealOrder =
  | 'forwards'
  | 'backwards'
  | 'unstable_legacy-backwards'
  | 'together'
  | 'independent'
  | void;

/** SuspenseList 未完成尾部行的显示策略。 */
export type SuspenseListTailMode = 'visible' | 'collapsed' | 'hidden' | void;

/**
 * SuspenseList 的单行节点。
 *
 * @remarks 行内禁止嵌套 Array/Iterable，避免调用方误以为其中每项都是独立行；确实需要
 * 把多个 child 组成一行时，应显式使用 Fragment 表达该意图。
 */
type SuspenseListRow = Exclude<
  ReactNodeList,
  Iterable<React$Node> | AsyncIterable<React$Node>,
>;

/** 需要按前后方向逐行揭示的 SuspenseList props。 */
type DirectionalSuspenseListProps = {
  /**
   * 多行 children；方向模式必须由 iterable/多个 JSX 插槽定义，不能只传单个元素。
   * AsyncIterable 支持仍属实验能力。
   */
  children?: Iterable<SuspenseListRow> | AsyncIterable<SuspenseListRow>,
  /** 从前或从后揭示行。 */
  revealOrder: 'forwards' | 'backwards' | 'unstable_legacy-backwards',
  /** 未完成尾部行的显示策略。 */
  tail?: SuspenseListTailMode,
};

/** 不指定前后方向、整体或独立协调行的 SuspenseList props。 */
type NonDirectionalSuspenseListProps = {
  /** 可由非 iterable 单节点或普通节点列表组成。 */
  children?: ReactNodeList,
  /** `together` 等待整组，`independent` 允许各行独立完成。 */
  revealOrder?: 'independent' | 'together' | void,
  /** 非方向模式不接受尾部裁剪策略。 */
  tail?: void,
};

/** 方向模式与非方向模式的互斥 SuspenseList props 联合。 */
export type SuspenseListProps =
  | DirectionalSuspenseListProps
  | NonDirectionalSuspenseListProps;

/** 性能追踪 marker 的名称与受追踪子树。 */
export type TracingMarkerProps = {
  /** 在追踪结果中标识 marker 的名称。 */
  name: string,
  /** 纳入该 marker 的子树。 */
  children?: ReactNodeList,
};

/** Cache 边界持有的子树。 */
export type CacheProps = {
  /** 共享同一 cache 生命周期的子树。 */
  children?: ReactNodeList,
};

/** Profiler 回调区分首次挂载、普通更新与嵌套更新的阶段。 */
export type ProfilerPhase = 'mount' | 'update' | 'nested-update';

/** Profiler 边界的标识、时长回调与被测子树。 */
export type ProfilerProps = {
  /** 传回所有 Profiler 回调的调用方标识。 */
  id?: string,
  /** render 完成时接收实际/基准耗时与时间戳。 */
  onRender?: (
    id: void | string,
    phase: ProfilerPhase,
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number,
  ) => void,
  /** commit 完成时接收 effect 耗时与提交时间。 */
  onCommit?: (
    id: void | string,
    phase: ProfilerPhase,
    effectDuration: number,
    commitTime: number,
  ) => void,
  /** 被 Profiler 测量的子树。 */
  children?: ReactNodeList,
};
