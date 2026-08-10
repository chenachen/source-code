/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {disableLegacyMode} from 'shared/ReactFeatureFlags';
import {DiscreteEventPriority} from 'react-reconciler/src/ReactEventPriorities';

import ReactSharedInternals from 'shared/ReactSharedInternals';

import ReactDOMSharedInternals from 'shared/ReactDOMSharedInternals';

/** 同步执行可选回调，并以离散事件优先级冲刷其 React 工作。 */
declare function flushSyncImpl<R>(fn: () => R): R;
/** 无回调时只冲刷当前累计的同步工作。 */
declare function flushSyncImpl(void): void;
/**
 * 暂时清除 transition、提升 DOM 更新优先级，并在 `finally` 中恢复上下文后冲刷同步工作。
 * `finally` 保证回调抛错时共享槽也不会泄漏；渲染期重入无法立即冲刷，只在开发态诊断。
 */
function flushSyncImpl<R>(fn: (() => R) | void): R | void {
  const previousTransition = ReactSharedInternals.T;
  const previousUpdatePriority =
    ReactDOMSharedInternals.p; /* ReactDOMCurrentUpdatePriority */

  try {
    ReactSharedInternals.T = null;
    ReactDOMSharedInternals.p /* ReactDOMCurrentUpdatePriority */ =
      DiscreteEventPriority;
    if (fn) {
      return fn();
    } else {
      return undefined;
    }
  } finally {
    ReactSharedInternals.T = previousTransition;
    ReactDOMSharedInternals.p /* ReactDOMCurrentUpdatePriority */ =
      previousUpdatePriority;
    const wasInRender =
      ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */
        .f(); /* flushSyncWork */
    if (__DEV__) {
      if (wasInRender) {
        console.error(
          'flushSync was called from inside a lifecycle method. React cannot ' +
            'flush when React is already rendering. Consider moving this call to ' +
            'a scheduler task or micro task.',
        );
      }
    }
  }
}

/** 旧模式构建中保持与 `flushSyncImpl` 一致的有回调重载。 */
declare function flushSyncErrorInBuildsThatSupportLegacyMode<R>(fn: () => R): R;
/** 旧模式构建中保持与 `flushSyncImpl` 一致的无回调重载。 */
declare function flushSyncErrorInBuildsThatSupportLegacyMode(void): void;
/** 在不应支持旧模式的发布组合出现矛盾时立即报告内部构建错误。 */
function flushSyncErrorInBuildsThatSupportLegacyMode() {
  // eslint-disable-next-line react-internal/prod-error-codes
  throw new Error(
    'Expected this build of React to not support legacy mode but it does. This is a bug in React.',
  );
}

/** 根据构建是否禁用旧模式，选择真实同步冲刷实现或构建不变量错误。 */
export const flushSync: typeof flushSyncImpl = disableLegacyMode
  ? flushSyncImpl
  : flushSyncErrorInBuildsThatSupportLegacyMode;
