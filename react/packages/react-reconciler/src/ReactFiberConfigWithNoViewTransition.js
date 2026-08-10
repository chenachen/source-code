/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 不支持 View Transition 的 renderer 可整体重导出本模块。

/** 不支持 View Transition 时的防御性占位；被调用表示 capability 分支存在内部错误。 */
function shim(...args: any): empty {
  throw new Error(
    'The current renderer does not support view transitions. ' +
      'This error is likely caused by a bug in React. ' +
      'Please file an issue.',
  );
}

/** 向宿主实例应用临时 view-transition-name 的占位。 */
export const applyViewTransitionName = shim;
/** 恢复宿主实例原 view-transition-name 的占位。 */
export const restoreViewTransitionName = shim;
/** 取消单个实例 transition 名称的占位。 */
export const cancelViewTransitionName = shim;
/** 取消根容器 transition 名称的占位。 */
export const cancelRootViewTransitionName = shim;
/** 恢复根容器 transition 名称的占位。 */
export const restoreRootViewTransitionName = shim;
/** 为根 transition 创建可测量克隆容器的占位。 */
export const cloneRootViewTransitionContainer = shim;
/** 移除根 transition 克隆容器的占位。 */
export const removeRootViewTransitionClone = shim;
/** 不支持该能力时的宿主测量结果占位类型。 */
export type InstanceMeasurement = any;
/** 测量当前宿主实例几何与样式的占位。 */
export const measureInstance = shim;
/** 测量 transition 克隆实例的占位。 */
export const measureClonedInstance = shim;
/** 判断实例在捕获前是否位于 viewport 的占位。 */
export const wasInstanceInViewport = shim;
/** 比较前后测量结果是否改变的占位。 */
export const hasInstanceChanged = shim;
/** 判断实例变化是否影响父级 transition 的占位。 */
export const hasInstanceAffectedParent = shim;
/** 启动根 View Transition 的占位。 */
export const startViewTransition = shim;
/** 正在运行的宿主 View Transition 占位类型。 */
export type RunningViewTransition = any;
/** 启动手势驱动 transition 的占位。 */
export const startGestureTransition = shim;
/** 停止当前宿主 transition 的占位。 */
export const stopViewTransition = shim;
/** 登记 transition finished 回调的占位。 */
export const addViewTransitionFinishedListener = shim;
/** reconciler 持有的单个 transition 实例占位类型。 */
export type ViewTransitionInstance = any;
/** 创建 reconciler transition 实例的占位。 */
export const createViewTransitionInstance = shim;
