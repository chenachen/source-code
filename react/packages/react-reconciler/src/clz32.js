/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// TODO：现代浏览器已普遍支持 Math.clz32，可评估移除兼容实现。

/** 计算 32 位无符号整数的前导零个数；原生不可用时使用对数回退。 */
export const clz32: (x: number) => number = Math.clz32
  ? Math.clz32
  : clz32Fallback;

// 前导零兼容算法，依据：
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/clz32
/** 缓存 Math.log，避免回退热路径反复读取全局属性。 */
const log = Math.log;
/** 缓存 ln(2)，用于把自然对数换算成以 2 为底的数量级。 */
const LN2 = Math.LN2;
/**
 * 用最高有效位位置推导 32 位前导零数量。
 *
 * 输入先经 `>>> 0` 归一化；零单独返回 32，非零结果等价于 `31 - floor(log2(x))`。
 */
function clz32Fallback(x: number): number {
  const asUint = x >>> 0;
  if (asUint === 0) {
    return 32;
  }
  return (31 - ((log(asUint) / LN2) | 0)) | 0;
}
