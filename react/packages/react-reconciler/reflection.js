/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

'use strict';

// 反射入口只暴露不触发 render/commit 的 Fiber 树查询工具。
export * from './src/ReactFiberTreeReflection';
