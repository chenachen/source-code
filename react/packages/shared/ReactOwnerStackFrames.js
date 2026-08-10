/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import DefaultPrepareStackTrace from 'shared/DefaultPrepareStackTrace';

/**
 * 从捕获的 Error 栈中裁出 JSX 创建点到 React bottom sentinel 之间的用户 owner 栈。
 *
 * @remarks 临时安装构建选择的 `prepareStackTrace`，读取后立即恢复；找不到用户空间
 * 边界时返回空串，避免把内部 frame 暴露为误导性 owner stack。
 */
export function formatOwnerStack(error: Error): string {
  const prevPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = DefaultPrepareStackTrace;
  let stack = error.stack;
  Error.prepareStackTrace = prevPrepareStackTrace;
  if (stack.startsWith('Error: react-stack-top-frame\n')) {
    // V8 默认把错误消息放在首行；owner stack 不需要该内部 sentinel 文本。
    stack = stack.slice(29);
  }
  let idx = stack.indexOf('\n');
  if (idx !== -1) {
    // 丢弃捕获 Error 本身对应的 JSX 辅助 frame。
    stack = stack.slice(idx + 1);
  }
  idx = stack.indexOf('react_stack_bottom_frame');
  if (idx !== -1) {
    idx = stack.lastIndexOf('\n', idx);
  }
  if (idx !== -1) {
    // bottom sentinel 之后全是 React 内部 frame，统一裁掉。
    stack = stack.slice(0, idx);
  } else {
    // 找不到从内部返回用户空间的 callsite，说明调用发生在 owner 外部或 owner 完全由
    // 内部代码构成；为保持诊断简洁，整段 trace 都不返回。
    return '';
  }
  return stack;
}
