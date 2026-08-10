/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 不支持原地 mutation 的 renderer 可整体重导出本模块，改由 persistence 模式提交。

/** 不支持 mutation 时的防御性占位；被调用表示 reconciler 选错了 capability 路径。 */
function shim(...args: any): empty {
  throw new Error(
    'The current renderer does not support mutation. ' +
      'This error is likely caused by a bug in React. ' +
      'Please file an issue.',
  );
}

/** 声明当前 renderer 不会原地修改已提交的宿主树。 */
export const supportsMutation = false;
/** mutation 模式的可变实例克隆占位。 */
export const cloneMutableInstance = shim;
/** mutation 模式的可变文本克隆占位。 */
export const cloneMutableTextInstance = shim;
/** 向宿主父实例尾部追加 child 的占位。 */
export const appendChild = shim;
/** 向根容器尾部追加 child 的占位。 */
export const appendChildToContainer = shim;
/** 提交宿主文本更新的占位。 */
export const commitTextUpdate = shim;
/** 宿主实例首次挂载后执行额外工作的占位。 */
export const commitMount = shim;
/** 把新 props 提交到既有宿主实例的占位。 */
export const commitUpdate = shim;
/** 在宿主父实例的指定 sibling 前插入 child 的占位。 */
export const insertBefore = shim;
/** 在根容器的指定 sibling 前插入 child 的占位。 */
export const insertInContainerBefore = shim;
/** 从宿主父实例移除 child 的占位。 */
export const removeChild = shim;
/** 从根容器移除 child 的占位。 */
export const removeChildFromContainer = shim;
/** 清空宿主实例直接文本内容的占位。 */
export const resetTextContent = shim;
/** 隐藏宿主实例但保留其挂载状态的占位。 */
export const hideInstance = shim;
/** 隐藏宿主文本实例的占位。 */
export const hideTextInstance = shim;
/** 恢复宿主实例可见性的占位。 */
export const unhideInstance = shim;
/** 恢复宿主文本实例可见性的占位。 */
export const unhideTextInstance = shim;
/** 清空整个根容器内容的占位。 */
export const clearContainer = shim;
/** 不支持 gesture transition 时使用的时间轴占位类型。 */
export type GestureTimeline = any;
/** 读取当前 gesture 时间轴偏移的占位。 */
export const getCurrentGestureOffset = shim;
