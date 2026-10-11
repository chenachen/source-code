/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

export {default as __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE} from './ReactSharedInternalsServer';

import {forEach, map, count, toArray, only} from './ReactChildren';
import {captureOwnerStack as captureOwnerStackImpl} from './ReactOwnerStack';
import {
  REACT_ACTIVITY_TYPE,
  REACT_FRAGMENT_TYPE,
  REACT_PROFILER_TYPE,
  REACT_STRICT_MODE_TYPE,
  REACT_SUSPENSE_TYPE,
  REACT_SUSPENSE_LIST_TYPE,
  REACT_VIEW_TRANSITION_TYPE,
} from 'shared/ReactSymbols';
import {
  cloneElement,
  createElement,
  isValidElement,
} from './jsx/ReactJSXElement';
import {createRef} from './ReactCreateRef';
import {use, useId, useCallback, useDebugValue, useMemo} from './ReactHooks';
import {forwardRef} from './ReactForwardRef';
import {lazy} from './ReactLazy';
import {memo} from './ReactMemo';
import {cache, cacheSignal} from './ReactCacheServer';
import version from 'shared/ReactVersion';

/** FB 服务端 `React.Children` 门面；算法复用公共实现，导出集合遵循内部构建边界。 */
const Children = {
  map,
  forEach,
  count,
  toArray,
  only,
};

/** FB 服务端 DEV 才安装的 owner 栈读取函数；生产保持 undefined，避免公开可调用诊断入口。 */
let captureOwnerStack: ?() => null | string;
if (__DEV__) {
  captureOwnerStack = captureOwnerStackImpl;
}

export {
  Children,
  REACT_ACTIVITY_TYPE as Activity,
  REACT_FRAGMENT_TYPE as Fragment,
  REACT_PROFILER_TYPE as Profiler,
  REACT_STRICT_MODE_TYPE as StrictMode,
  REACT_SUSPENSE_TYPE as Suspense,
  REACT_VIEW_TRANSITION_TYPE as ViewTransition,
  REACT_VIEW_TRANSITION_TYPE as unstable_ViewTransition,
  cloneElement,
  createElement,
  createRef,
  use,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  cache,
  cacheSignal,
  useId,
  useCallback,
  useDebugValue,
  useMemo,
  version,
captureOwnerStack, // 仅开发环境提供 owner 栈诊断。
// 实验能力入口。
  REACT_SUSPENSE_LIST_TYPE as unstable_SuspenseList,
};
