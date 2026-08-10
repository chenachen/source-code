/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** 为 Flow 提供能保留输入联合类型的 Array refinement 签名。 */
declare function isArray<T>(
  v: T,
  // eslint-disable-next-line
): v is T extends $ReadOnlyArray<mixed> ? T : empty;

/** 捕获原生 `Array.isArray`，避免实现函数递归调用自己。 */
const isArrayImpl = Array.isArray;

/** 使用原生跨 realm 语义判断输入是否为数组。 */
function isArray(a: mixed): boolean {
  return isArrayImpl(a);
}

export default isArray;
