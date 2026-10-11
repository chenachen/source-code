/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

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
  optimisticKey,
  Activity,
  unstable_getCacheForType,
  unstable_SuspenseList,
  ViewTransition,
  unstable_startGestureTransition,
  addTransitionType,
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
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  useActionState,
  version,
  act, // 仅开发环境提供测试冲刷能力。
  captureOwnerStack, // 仅开发环境提供 owner 栈诊断。
} from './src/ReactClient';

import {useOptimistic} from './src/ReactClient';

/**
 * 保留旧实验名称，并把调用转发给已进入 canary 渠道的 `useOptimistic`。
 *
 * @remarks 此开发入口始终保留迁移提示；别名本身不改变 reducer 或派发语义。
 * @param passthrough - 本次 render 提供的基础状态，乐观 action 在其上计算临时状态。
 * @param reducer - 可选的状态合并规则，原样交给当前 renderer dispatcher。
 * @returns 当前乐观状态与派发函数；存储、回放和 transition 生命周期由 useOptimistic 实现。
 */
export function experimental_useOptimistic<S, A>(
  passthrough: S,
  reducer: ?(S, A) => S,
): [S, (A) => void] {
  if (__DEV__) {
    console.error(
      'useOptimistic is now in canary. Remove the experimental_ prefix. ' +
        'The prefixed alias will be removed in an upcoming release.',
    );
  }
  return useOptimistic(passthrough, reducer);
}
