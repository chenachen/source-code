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
 * @param error - startTransition 等入口捕获后需要交给宿主的失败原因，可以不是 Error 实例。
 * @remarks 模块求值时选择原生或 fallback；浏览器监听器 preventDefault 会阻止末尾
 * console.error，Node 分支 emit 后直接返回，即使没有监听器也不再输出控制台。
 * 这不是重新 throw 原错误；字符串化、事件构造及宿主监听器产生的新异常仍可向外传播。
 */
const reportGlobalError: (error: mixed) => void =
  typeof reportError === 'function'
    ? // 现代浏览器的 reportError 会分发 error event，等价模拟未捕获 JavaScript 错误。
      reportError
    : /** 在缺少原生 reportError 时按浏览器/Node 的可用能力同步分发错误。 */
      error => {
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
