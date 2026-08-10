/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// Edge/Node server 构建用本文件替换 `DefaultPrepareStackTrace` 占位模块。

/** 按 V8 默认布局把结构化 CallSite 数组格式化为错误栈字符串。 */
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
