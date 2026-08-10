/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 注意：新增标记时，也要检查
// `react-devtools-shared/src/backend/ReactSymbols` 是否需要同步，
// 否则 DevTools 可能无法识别新的 React 类型。

/** 标记旧版 ReactElement 形状，只用于识别兼容输入。 */
export const REACT_LEGACY_ELEMENT_TYPE: symbol = Symbol.for('react.element');
/** 标记当前过渡期 ReactElement；renderer 依靠它区分普通对象。 */
export const REACT_ELEMENT_TYPE: symbol = Symbol.for(
  'react.transitional.element',
);
/** 标记把子树渲染到外部容器的 Portal 记录。 */
export const REACT_PORTAL_TYPE: symbol = Symbol.for('react.portal');
/** 标记不额外创建宿主节点的 Fragment 类型。 */
export const REACT_FRAGMENT_TYPE: symbol = Symbol.for('react.fragment');
/** 标记启用额外开发期检查的 StrictMode 边界。 */
export const REACT_STRICT_MODE_TYPE: symbol = Symbol.for('react.strict_mode');
/** 标记收集 render/commit 时长的 Profiler 边界。 */
export const REACT_PROFILER_TYPE: symbol = Symbol.for('react.profiler');
/** 标记读取 Context 值的 Consumer 包装对象。 */
export const REACT_CONSUMER_TYPE: symbol = Symbol.for('react.consumer');
/** 标记 Context 本体以及作为 Provider 使用的类型对象。 */
export const REACT_CONTEXT_TYPE: symbol = Symbol.for('react.context');
/** 标记把 ref 参数转交给 render 函数的 forwardRef 描述对象。 */
export const REACT_FORWARD_REF_TYPE: symbol = Symbol.for('react.forward_ref');
/** 标记可在子树挂起时切换到 fallback 的 Suspense 边界。 */
export const REACT_SUSPENSE_TYPE: symbol = Symbol.for('react.suspense');
/** 标记协调多个 Suspense 行显示顺序的 SuspenseList。 */
export const REACT_SUSPENSE_LIST_TYPE: symbol = Symbol.for(
  'react.suspense_list',
);
/** 标记带可选 props 比较器的 memo 类型描述对象。 */
export const REACT_MEMO_TYPE: symbol = Symbol.for('react.memo');
/** 标记通过惰性初始化器解析实际组件类型的 lazy 对象。 */
export const REACT_LAZY_TYPE: symbol = Symbol.for('react.lazy');
/** 标记实验性的宿主查询 Scope 类型。 */
export const REACT_SCOPE_TYPE: symbol = Symbol.for('react.scope');
/** 标记可在 visible/hidden 模式间切换的 Activity 边界。 */
export const REACT_ACTIVITY_TYPE: symbol = Symbol.for('react.activity');
/** 标记旧版隐藏子树类型，供兼容路径识别。 */
export const REACT_LEGACY_HIDDEN_TYPE: symbol = Symbol.for(
  'react.legacy_hidden',
);
/** 标记性能追踪中的命名 marker 边界。 */
export const REACT_TRACING_MARKER_TYPE: symbol = Symbol.for(
  'react.tracing_marker',
);

/** 标记 compiler memo cache 中尚未写入用户值的槽位。 */
export const REACT_MEMO_CACHE_SENTINEL: symbol = Symbol.for(
  'react.memo_cache_sentinel',
);

/** 标记协调浏览器 View Transition 的实验性边界。 */
export const REACT_VIEW_TRANSITION_TYPE: symbol = Symbol.for(
  'react.view_transition',
);

/** 标记允许下游 renderer 接管子树的 recoverable 错误对象。 */
export const REACT_RECOVERABLE_TYPE: symbol = Symbol.for('react.recoverable');

/** 当前运行时支持时使用的标准同步 iterator 键。 */
const MAYBE_ITERATOR_SYMBOL = Symbol.iterator;
/** 兼容早期 iterable 实现使用的字符串 iterator 键。 */
const FAUX_ITERATOR_SYMBOL = '@@iterator';

/**
 * 从候选对象读取同步 iterator 工厂。
 *
 * @returns 标准或兼容 iterator 方法；非对象或不可迭代值返回 `null`。
 */
export function getIteratorFn(maybeIterable: ?any): ?() => ?Iterator<any> {
  if (maybeIterable === null || typeof maybeIterable !== 'object') {
    return null;
  }
  const maybeIterator =
    (MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL]) ||
    maybeIterable[FAUX_ITERATOR_SYMBOL];
  if (typeof maybeIterator === 'function') {
    return maybeIterator;
  }
  return null;
}

/** 标准异步 iterator 键，供异步 children/SuspenseList 路径共享。 */
export const ASYNC_ITERATOR = Symbol.asyncIterator;

/** 在 children key 中占位的内部乐观键；运行时值实际是全局 Symbol。 */
export const REACT_OPTIMISTIC_KEY: ReactOptimisticKey = Symbol.for(
  'react.optimistic_key',
) as any;

/**
 * 乐观 key 的 Flow 伪类型。
 *
 * @remarks
 * 运行时值实际是 Symbol；Flow 无法通过 Symbol 比较完成 refinement。伪装成布尔字面量
 * 能迫使通常只处理字符串 key 或数字索引的分支显式面对该额外情况。
 */
export type ReactOptimisticKey = true;
