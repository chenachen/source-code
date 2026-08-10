/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** 未绑定的原生 own-property 检查；调用时必须显式提供 receiver。 */
// $FlowFixMe[method-unbinding]
const hasOwnProperty = Object.prototype.hasOwnProperty;

export default hasOwnProperty;
