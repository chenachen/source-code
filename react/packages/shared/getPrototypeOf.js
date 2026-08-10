/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** 共享原生 `Object.getPrototypeOf` 引用，供跨 realm/序列化检查复用。 */
const getPrototypeOf = Object.getPrototypeOf;

export default getPrototypeOf;
