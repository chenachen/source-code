/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** 稳定开发渠道的公共 API 聚合，并额外公开仅 DEV 可用的诊断能力。 */
export {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
  __COMPILER_RUNTIME,
  Activity,
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  ViewTransition,
  addTransitionType,
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
  unstable_useCacheRefresh,
  startTransition,
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
  useReducer,
  useOptimistic,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  useActionState,
  version,
  act, // 仅开发环境提供测试冲刷能力。
  captureOwnerStack, // 仅开发环境提供 owner 栈诊断。
} from './src/ReactClient';
