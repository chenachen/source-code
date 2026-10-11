/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/**
 * Fiber 节点的运行时种类编码。
 *
 * begin/complete/commit 阶段以该标签分派实现；联合中保留未导出的历史空位，避免因重排数字
 * 破坏 DevTools、profiling 或已序列化的内部诊断数据。
 */
export type WorkTag =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21
  | 22
  | 23
  | 24
  | 25
  | 26
  | 27
  | 28
  | 29
  | 30
  | 31;

/** 使用 hooks/函数调用完成 render 的函数组件。 */
export const FunctionComponent = 0;
/** 由可变实例、生命周期和 class update queue 驱动的组件。 */
export const ClassComponent = 1;
/** 宿主树根节点；嵌入式 renderer 的根也可能位于另一棵宿主树中。 */
export const HostRoot = 3;
/** 把子树提交到另一宿主容器的 Portal 入口。 */
export const HostPortal = 4;
/** 由 HostConfig 创建的宿主元素，例如 DOM renderer 的 `<div>`。 */
export const HostComponent = 5;
/** 只承载文本内容的宿主节点。 */
export const HostText = 6;
/** 不创建宿主实例、只组织一组 children 的 Fragment。 */
export const Fragment = 7;
/** StrictMode 等只改变后代 mode 位的边界节点。 */
export const Mode = 8;
/** 读取 Context 当前值并以 render prop 产生 children 的 Consumer。 */
export const ContextConsumer = 9;
/** 向后代压入新 Context 值的 Provider。 */
export const ContextProvider = 10;
/** 把 ref 作为第二参数传给 render 函数的 forwardRef 组件。 */
export const ForwardRef = 11;
/** 收集子树 render/commit 时长并在 commit 回调的 Profiler。 */
export const Profiler = 12;
/** 捕获 thenable、在 primary 与 fallback 子树之间切换的 Suspense 边界。 */
export const SuspenseComponent = 13;
/** 带自定义或浅比较器的 memo 包装组件。 */
export const MemoComponent = 14;
/** 已解析为普通函数且可走快速 props 比较路径的 memo 组件。 */
export const SimpleMemoComponent = 15;
/** 尚需运行初始化器解析真实类型的 lazy 组件。 */
export const LazyComponent = 16;
/** Legacy Suspense 中首次挂载的 class 挂起后使用的临时标签，恢复时按重新 mount 处理。 */
export const IncompleteClassComponent = 17;
/** 对应服务端已存在 DOM、等待 hydration 的不透明片段。 */
export const DehydratedFragment = 18;
/** 按 revealOrder/tail 协调多个 Suspense 行的 SuspenseList。 */
export const SuspenseListComponent = 19;
/** 实验性 Scope 查询边界，不额外创建宿主节点。 */
export const ScopeComponent = 21;
/** 可隐藏/显示子树并管理缓存与 effects 的 Offscreen 边界。 */
export const OffscreenComponent = 22;
/** 旧版隐藏子树兼容标签。 */
export const LegacyHiddenComponent = 23;
/** 为后代提供并持有 React cache 的边界。 */
export const CacheComponent = 24;
/** 收集 transition tracing 完成/阻塞信息的 marker。 */
export const TracingMarkerComponent = 25;
/** 可提升到 document head 等稳定位置的资源宿主节点。 */
export const HostHoistable = 26;
/** renderer 保证每个宿主范围唯一并复用的节点，例如 html/head/body。 */
export const HostSingleton = 27;
/** Legacy Suspense 中首次挂载的函数组件挂起后使用的临时标签，恢复时重新执行 mount。 */
export const IncompleteFunctionComponent = 28;
/** 把一个值表示成 Fiber，并在 beginWork 中重新抛出的错误节点。 */
export const Throw = 29;
/** 协调浏览器 View Transition 捕获、命名与生命周期的边界。 */
export const ViewTransitionComponent = 30;
/** 可在 active/hidden 状态间切换并承载相关 effects 语义的 Activity 边界。 */
export const ActivityComponent = 31;
