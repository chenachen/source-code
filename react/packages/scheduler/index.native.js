/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

'use strict';

// React Native 源码入口；优先接入原生 Runtime Scheduler，缺失时回退 JavaScript 实现。
export * from './src/forks/SchedulerNative';
