/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 无条件环境解析时默认采用 Node 静态预渲染适配器；条件导出会为浏览器/Edge 改道。
export * from './static.node';
