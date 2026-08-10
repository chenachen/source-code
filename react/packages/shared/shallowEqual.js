/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import is from './objectIs';
import hasOwnProperty from './hasOwnProperty';

/**
 * 比较两个值的第一层自有可枚举字段。
 *
 * @returns 两值由 `Object.is` 直接相等，或拥有相同 key 且每个字段都由 `Object.is`
 * 相等时返回 true；不递归比较嵌套对象。
 */
function shallowEqual(objA: mixed, objB: mixed): boolean {
  if (is(objA, objB)) {
    return true;
  }

  if (
    typeof objA !== 'object' ||
    objA === null ||
    typeof objB !== 'object' ||
    objB === null
  ) {
    return false;
  }

  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);

  if (keysA.length !== keysB.length) {
    return false;
  }

  // 同时验证 B 拥有 A 的每个 key，防止原型链字段伪装成相同结构。
  for (let i = 0; i < keysA.length; i++) {
    const currentKey = keysA[i];
    if (
      !hasOwnProperty.call(objB, currentKey) ||
      // $FlowFixMe[incompatible-use] lost refinement of `objB`
      !is(objA[currentKey], objB[currentKey])
    ) {
      return false;
    }
  }

  return true;
}

export default shallowEqual;
