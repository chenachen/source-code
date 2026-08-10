/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// profiling 入口必须同时跟随 `/client` 与默认入口，区别由发布构建选择 profiling 产物实现。
export * from './client';
export * from './index';
