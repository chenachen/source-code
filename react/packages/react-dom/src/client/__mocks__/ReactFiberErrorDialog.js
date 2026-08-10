/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** 测试替身始终允许 React 继续执行默认错误日志路径。 */
export function showErrorDialog(): boolean {
  return true;
}
