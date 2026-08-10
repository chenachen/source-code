/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** 共享原生 `Object.assign` 引用，避免各包重复捕获或包装。 */
const assign = Object.assign;

export default assign;
