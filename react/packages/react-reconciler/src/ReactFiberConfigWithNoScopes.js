/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 不支持 React Scope 的 renderer 可整体重导出本模块。

/** 不支持 Scope 时的防御性占位；被调用表示 capability 分支存在内部错误。 */
function shim(...args: any): empty {
  throw new Error(
    'The current renderer does not support React Scopes. ' +
      'This error is likely caused by a bug in React. ' +
      'Please file an issue.',
  );
}

/** 提交后更新 Scope 查询集合的占位。 */
export const prepareScopeUpdate = shim;
/** 从 Scope 实例解析 renderer 对象的占位。 */
export const getInstanceFromScope = shim;
