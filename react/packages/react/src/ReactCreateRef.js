/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 * @flow
 */

import type {RefObject} from 'shared/ReactTypes';

/**
 * 创建 current 初始为 null、可由 renderer 写入的独立 ref 容器。
 *
 * @remarks DEV 中 seal 外壳可尽早暴露误加字段，同时保留 `current` 的可写性。
 * 生产路径不 seal。每次调用返回新引用，没有 useRef 的组件内跨 render 复用语义；
 * attach/detach 和清空 current 都由 renderer 的提交路径处理。
 * @returns 当前仅含 current 字段的对象，创建本身不查询或绑定任何宿主实例。
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
