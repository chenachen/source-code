/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 无条件环境解析时默认采用 Node server 适配器；package exports/browser 字段会为其他宿主改道。
export * from './server.node';
