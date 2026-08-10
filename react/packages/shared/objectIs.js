/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/**
 * 内联 `Object.is` polyfill，避免要求消费者额外提供实现。
 *
 * @remarks 与 `===` 相比，它区分 `+0/-0` 并让 `NaN` 等于自身。
 *
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/is
 */
function is(x: any, y: any) {
  return (
    (x === y && (x !== 0 || 1 / x === 1 / y)) || (x !== x && y !== y) // eslint-disable-line no-self-compare
  );
}

/** 当前环境的原生 `Object.is`，不可用时退回语义等价的内联实现。 */
const objectIs: (x: any, y: any) => boolean =
  // $FlowFixMe[method-unbinding]
  typeof Object.is === 'function' ? Object.is : is;

export default objectIs;
