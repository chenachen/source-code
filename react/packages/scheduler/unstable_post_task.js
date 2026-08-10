/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use strict';

// 实验性浏览器入口；把 Scheduler 协议适配到原生 `scheduler.postTask`。
export * from './src/forks/SchedulerPostTask';
