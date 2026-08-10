/**
 * Copyright (c) Meta Platforms, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import ReactSharedInternals from 'shared/ReactSharedInternals';

let lastResetTime = 0;

let getCurrentTime: () => number | DOMHighResTimeStamp;
/** 当前环境是否提供不受系统时钟回拨影响的高精度时间源。 */
const hasPerformanceNow =
  // $FlowFixMe[method-unbinding]
  typeof performance === 'object' && typeof performance.now === 'function';

if (hasPerformanceNow) {
  const localPerformance = performance;
  getCurrentTime = () => localPerformance.now();
} else {
  const localDate = Date;
  getCurrentTime = () => localDate.now();
}

/**
 * 每秒重置开发期 owner stack 创建配额。
 *
 * @remarks 调用频率可高于一秒，但计数只在间隔超过 1000ms 时清零；生产构建调用属于
 * React 内部错误并立即抛出。
 */
export function resetOwnerStackLimit() {
  if (__DEV__) {
    const now = getCurrentTime();
    const timeSinceLastReset = now - lastResetTime;
    if (timeSinceLastReset > 1000) {
      ReactSharedInternals.recentlyCreatedOwnerStacks = 0;
      lastResetTime = now;
    }
  } else {
    // 该错误不应进入生产构建，因此无需收录进 codes.json。
    // eslint-disable-next-line react-internal/prod-error-codes
    throw new Error(
      'resetOwnerStackLimit should never be called in production mode. This is a bug in React.',
    );
  }
}
