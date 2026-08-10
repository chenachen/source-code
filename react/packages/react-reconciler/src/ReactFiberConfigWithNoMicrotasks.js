/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 不支持 microtask 的 renderer 可整体重导出本模块，保持 HostConfig 导出形状完整。

/** 不支持路径的防御性占位；若 reconciler 仍调用它，说明 capability 分支存在内部错误。 */
function shim(...args: any): empty {
  throw new Error(
    'The current renderer does not support microtasks. ' +
      'This error is likely caused by a bug in React. ' +
      'Please file an issue.',
  );
}

/** 声明当前 HostConfig 不能用 microtask 安排同步队列 flush。 */
export const supportsMicrotasks = false;
/** 非支持 renderer 的 microtask 占位；正常 capability 分支不得调用。 */
export const scheduleMicrotask = shim;
