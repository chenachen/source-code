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
  /** 返回模块选定的高精度毫秒时钟；保留对象接收者，供 owner stack 配额窗口比较。 */
  getCurrentTime = () => localPerformance.now();
} else {
  const localDate = Date;
  /** 返回系统毫秒时间作为回退；系统时钟回拨可能延后下一次配额重置。 */
  getCurrentTime = () => localDate.now();
}

/**
 * 按需重置开发期 owner stack 创建计数，让后续 JSX 创建重新获得捕获配额。
 *
 * @remarks 没有定时器；只有调用时发现距上次重置严格超过 1000ms，才清零
 * recentlyCreatedOwnerStacks 并推进 lastResetTime。等于 1000ms 不重置，长时间无人
 * 调用也不会主动清理。生产构建调用属于 React 内部错误并立即抛出。
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
