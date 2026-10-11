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
 * @param error - JSX 创建时捕获、带有 React 栈边界标记的 Error。
 * @returns 去掉捕获辅助帧和 bottom sentinel 后的用户帧文本；无边界则为空串。
 * @remarks 某些引擎在首次读取 stack 时才格式化，因此读取前临时安装构建选择的
 * `prepareStackTrace`。正常读取后恢复原值；这里没有 try/finally，若 stack getter
 * 抛错则异常继续传播，且恢复语句不会执行。调用方负责诊断路径的异常处理。
 * 已经格式化过的 stack 不一定再采用新 formatter；此函数仍按 sentinel 文本裁切。
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
