/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactFiber';

import ReactSharedInternals from 'shared/ReactSharedInternals';

import {warnsIfNotActing} from './ReactFiberConfig';

/**
 * 判断当前调用是否位于 React 17 兼容的 legacy act 环境。
 * Jest 全局默认视为 act 环境，但显式 `IS_REACT_ACT_ENVIRONMENT=false` 可关闭误报。
 */
export function isLegacyActEnvironment(fiber: Fiber): boolean {
  if (__DEV__) {
    // 保留 React 17 legacy act 判断：jest 存在即默认开启，显式全局 false 优先关闭。

    const isReactActEnvironmentGlobal =
      // $FlowFixMe[cannot-resolve-name] Flow doesn't know about IS_REACT_ACT_ENVIRONMENT global
      typeof IS_REACT_ACT_ENVIRONMENT !== 'undefined'
        ? // $FlowFixMe[cannot-resolve-name]
          IS_REACT_ACT_ENVIRONMENT
        : undefined;

    // $FlowFixMe[cannot-resolve-name] - Flow doesn't know about jest
    const jestIsDefined = typeof jest !== 'undefined';
    return (
      // $FlowFixMe[constant-condition]
      warnsIfNotActing && jestIsDefined && isReactActEnvironmentGlobal !== false
    );
  }
  return false;
}

/**
 * 读取并校验并发 act 环境开关。
 * actQueue 已存在但全局未启用时输出配置错误，避免测试误以为并发工作已被 act 完整 flush。
 */
export function isConcurrentActEnvironment(): void | boolean {
  if (__DEV__) {
    const isReactActEnvironmentGlobal =
      // $FlowFixMe[cannot-resolve-name] Flow doesn't know about IS_REACT_ACT_ENVIRONMENT global
      typeof IS_REACT_ACT_ENVIRONMENT !== 'undefined'
        ? // $FlowFixMe[cannot-resolve-name]
          IS_REACT_ACT_ENVIRONMENT
        : undefined;

    if (
      !isReactActEnvironmentGlobal &&
      ReactSharedInternals.actQueue !== null
    ) {
      // TODO：在错误消息中加入对应测试环境配置文档链接。
      console.error(
        'The current testing environment is not configured to support ' +
          'act(...)',
      );
    }
    return isReactActEnvironmentGlobal;
  }
  return false;
}
