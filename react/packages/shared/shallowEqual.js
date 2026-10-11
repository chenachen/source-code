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
 * 比较两个值的第一层自有可枚举字符串字段；Symbol key 不在 Object.keys 的结果中。
 *
 * @returns 两值由 `Object.is` 直接相等，或拥有相同 key 且每个字段都由 `Object.is`
 * 相等时返回 true；不递归比较嵌套对象。
 * @param objA - PureComponent 或 memo 等调用方提供的旧 props/state 候选值。
 * @param objB - 本次候选值；引用相同时立即通过，嵌套引用改变则浅比较失败。
 * @remarks 不检查原型身份，不枚举 Symbol/非枚举键；字段读取可触发 getter，异常不被吞掉。
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
