/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 不支持 persistence 的 renderer 可整体重导出本模块，改由 mutation 模式提交。

/** 不支持 persistence 时的防御性占位；被调用表示 capability 分支存在内部错误。 */
function shim(...args: any): empty {
  throw new Error(
    'The current renderer does not support persistence. ' +
      'This error is likely caused by a bug in React. ' +
      'Please file an issue.',
  );
}

/** 声明当前 renderer 不通过克隆整棵宿主子树完成提交。 */
export const supportsPersistence = false;
/** 按新 props 克隆既有宿主实例的占位。 */
export const cloneInstance = shim;
/** 为根创建待提交 child set 的占位。 */
export const createContainerChildSet = shim;
/** 向待提交 child set 追加实例的占位。 */
export const appendChildToContainerChildSet = shim;
/** 在替换根 children 前完成 child set 的占位。 */
export const finalizeContainerChildren = shim;
/** 原子替换根容器 children 的占位。 */
export const replaceContainerChildren = shim;
/** 克隆为隐藏状态宿主实例的占位。 */
export const cloneHiddenInstance = shim;
/** 克隆为隐藏状态文本实例的占位。 */
export const cloneHiddenTextInstance = shim;
