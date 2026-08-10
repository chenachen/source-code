/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * 这些变量保存目标节点的文本内容，用于比较事件前后的差异。
 * 
 * 先定位选择区起点节点，再记录其文本和 DOM 位置。浏览器可能在输入法组合期间原生替换目标节点，
 * 因此需要依靠保存的位置找到替代节点。
 */

let root = null;
let startText = null;
let fallbackText = null;

/** initialize 执行在缺少可靠 composition data 时缓存选择区并计算输入前后的文本差异的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
export function initialize(nativeEventTarget) {
  root = nativeEventTarget;
  startText = getText();
  return true;
}

/** reset 更新在缺少可靠 composition data 时缓存选择区并计算输入前后的文本差异的模块状态或 DOM 状态；重复调用需保持队列顺序与恢复幂等性。 */
export function reset() {
  root = null;
  startText = null;
  fallbackText = null;
}

/** getData 查询并返回在缺少可靠 composition data 时缓存选择区并计算输入前后的文本差异所需状态；无匹配时使用 null/默认值而不修改事件队列。 */
export function getData() {
  if (fallbackText) {
    return fallbackText;
  }

  let start;
  const startValue = startText;
  const startLength = startValue.length;
  let end;
  const endValue = getText();
  const endLength = endValue.length;

  for (start = 0; start < startLength; start++) {
    if (startValue[start] !== endValue[start]) {
      break;
    }
  }

  const minEnd = startLength - start;
  for (end = 1; end <= minEnd; end++) {
    if (startValue[startLength - end] !== endValue[endLength - end]) {
      break;
    }
  }

  const sliceTail = end > 1 ? 1 - end : undefined;
  fallbackText = endValue.slice(start, sliceTail);
  return fallbackText;
}

/** getText 查询并返回在缺少可靠 composition data 时缓存选择区并计算输入前后的文本差异所需状态；无匹配时使用 null/默认值而不修改事件队列。 */
export function getText() {
  if ('value' in root) {
    return root.value;
  }
  return root.textContent;
}
