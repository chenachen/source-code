/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * 保存 composition 开始时的目标与文本；结束时从同一目标读取新文本，
 * 剔除共同前缀/后缀得到插入字符。
 */

let root = null;
let startText = null;
let fallbackText = null;

/** 保存本轮输入法目标与输入前文本，作为 composition 字符差异的基线。 */
export function initialize(nativeEventTarget) {
  root = nativeEventTarget;
  startText = getText();
  return true;
}

/** 清空本轮目标、初始文本和已计算的组合文本。 */
export function reset() {
  root = null;
  startText = null;
  fallbackText = null;
}

/**
 * composition 结束时比较 UTF-16 文本，剔除共同前缀和不越过前缀的共同后缀，提取本轮插入的中间文本。
 * 非空结果缓存到 fallbackText；空结果由于 truthy 检查会在下次调用时重新计算，reset 结束本轮基线。
 */
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

/** 读取已登记目标的 value；没有 value 字段时读取 textContent。 */
export function getText() {
  if ('value' in root) {
    return root.value;
  }
  return root.textContent;
}
