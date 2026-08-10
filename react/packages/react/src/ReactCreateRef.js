/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 * @flow
 */

import type {RefObject} from 'shared/ReactTypes';

/**
 * 创建外壳不可扩展、但 `current` 值可由 renderer 更新的 ref 对象。
 *
 * @remarks DEV 中 seal 外壳可尽早暴露误加字段，同时保留 `current` 的可写性。
 */
export function createRef(): RefObject {
  const refObject = {
    current: null,
  };
  if (__DEV__) {
    Object.seal(refObject);
  }
  return refObject;
}
