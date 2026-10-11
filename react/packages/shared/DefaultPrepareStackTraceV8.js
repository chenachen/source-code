/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// Edge/Node server 构建用本文件替换 `DefaultPrepareStackTrace` 占位模块。

/**
 * 为服务端 fork 把 V8 的结构化 CallSite 数组格式化成标准错误栈文本。
 * 首行使用 error.name/message，缺失时退为 Error/空消息；随后保持 frame 顺序逐项追加。
 * 本函数只格式化已取得的 frame，不做 source-map 映射，也不捕获 CallSite.toString 自身的异常。
 * @param structuredStackTrace - V8 提供的调用位置，顺序由引擎确定。
 * @returns 可供错误栈/组件栈处理继续使用的字符串。
 */
function prepareStackTrace(
  error: Error,
  structuredStackTrace: CallSite[],
): string {
  const name = error.name || 'Error';
  const message = error.message || '';
  let stack = name + ': ' + message;
  for (let i = 0; i < structuredStackTrace.length; i++) {
    stack += '\n    at ' + structuredStackTrace[i].toString();
  }
  return stack;
}

export default prepareStackTrace;
