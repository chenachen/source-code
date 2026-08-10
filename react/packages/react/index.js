/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 此处公开类型必须与 Flow 的内建 React 声明保持同步：
// https://github.com/facebook/flow/blob/main/lib/react.js
/** React 元素允许使用的宿主标签或组件类型。 */
export type ElementType = React$ElementType;
/** 由指定组件类型 `C` 创建的 React 元素记录。 */
export type Element<+C> = React$Element<C>;
/** 组件类型尚未具体化时使用的通用 React 元素。 */
export type MixedElement = React$Element<ElementType>;
/** React 在同级子节点之间维持身份所使用的键。 */
export type Key = React$Key;
/** React 可以遍历或交给 renderer 处理的节点联合类型。 */
export type Node = React$Node;
/** 保存当前值并提供 Provider/Consumer 描述对象的上下文。 */
// eslint-disable-next-line no-undef
export type Context<T> = React.Context<T>;
/** 把子树渲染到另一个宿主容器的 Portal 记录。 */
export type Portal = React$Portal;
/** 接收宿主实例或 `null` 的回调 ref。 */
// eslint-disable-next-line no-undef
export type RefSetter<-I> = React.RefSetter<I>;
/** 组件 `C` 经 JSX 属性规则归一化后的可传入属性。 */
export type ElementProps<C> = React$ElementConfig<C>;
/** `ElementProps` 的兼容别名，供既有 Flow 调用方使用。 */
export type ElementConfig<C> = React$ElementConfig<C>;
/** 从组件类型 `C` 推导出的 ref 实例类型。 */
// eslint-disable-next-line no-undef
export type ElementRef<C> = React.ElementRef<C>;
/** 允许任意层数组嵌套的 children 输入结构。 */
export type ChildrenArray<+T> = $ReadOnlyArray<ChildrenArray<T>> | T;

export {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
  __COMPILER_RUNTIME,
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  cloneElement,
  createContext,
  createElement,
  createRef,
  use,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  cache,
  cacheSignal,
  startTransition,
  unstable_LegacyHidden,
  Activity,
  unstable_Scope,
  unstable_SuspenseList,
  unstable_TracingMarker,
  ViewTransition,
  addTransitionType,
  unstable_getCacheForType,
  unstable_useCacheRefresh,
  useId,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useSyncExternalStore,
  useReducer,
  useRef,
  useState,
  useTransition,
  useActionState,
  version,
} from './src/ReactClient';
