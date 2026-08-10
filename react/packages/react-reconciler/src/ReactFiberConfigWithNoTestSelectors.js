/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 不支持测试选择器的 renderer 可整体重导出本模块。

/** 不支持测试选择器时的防御性占位；被调用表示 capability 分支存在内部错误。 */
function shim(...args: any): empty {
  throw new Error(
    'The current renderer does not support test selectors. ' +
      'This error is likely caused by a bug in React. ' +
      'Please file an issue.',
  );
}

/** 声明当前 renderer 不暴露内部测试选择器能力。 */
export const supportsTestSelectors = false;
/** 从宿主根查找 FiberRoot 的占位。 */
export const findFiberRoot = shim;
/** 读取宿主实例边界矩形的占位。 */
export const getBoundingRect = shim;
/** 读取宿主实例文本内容的占位。 */
export const getTextContent = shim;
/** 判断宿主子树是否隐藏的占位。 */
export const isHiddenSubtree = shim;
/** 按 accessibility role 匹配宿主实例的占位。 */
export const matchAccessibilityRole = shim;
/** 在实例可聚焦时设置焦点的占位。 */
export const setFocusIfFocusable = shim;
/** 建立测试用可见性观察器的占位。 */
export const setupIntersectionObserver = shim;
