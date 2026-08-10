/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/**
 * 按宿主语义报告未捕获错误：优先 `reportError`，再模拟浏览器 error event 或 Node
 * `uncaughtException`，最后退回 console.error。
 */
const reportGlobalError: (error: mixed) => void =
  typeof reportError === 'function'
    ? // 现代浏览器的 reportError 会分发 error event，等价模拟未捕获 JavaScript 错误。
      reportError
    : error => {
        if (
          typeof window === 'object' &&
          typeof window.ErrorEvent === 'function'
        ) {
          // 浏览器 fallback：显式创建可取消的全局 ErrorEvent。
          const message =
            typeof error === 'object' &&
            error !== null &&
            typeof error.message === 'string'
              ? // eslint-disable-next-line react-internal/safe-string-coercion
                String(error.message)
              : // eslint-disable-next-line react-internal/safe-string-coercion
                String(error);
          const event = new window.ErrorEvent('error', {
            bubbles: true,
            cancelable: true,
            message: message,
            error: error,
          });
          const shouldLog = window.dispatchEvent(event);
          if (!shouldLog) {
            return;
          }
        } else if (
          typeof process === 'object' &&
          // $FlowFixMe[method-unbinding]
          typeof process.emit === 'function'
        ) {
          // Node fallback：交给进程级未捕获异常处理器。
          process.emit('uncaughtException', error);
          return;
        }
        console['error'](error);
      };

export default reportGlobalError;
