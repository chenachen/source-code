/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/* eslint-disable react-internal/prod-error-codes */

// Rollup、Jest 与 Flow 配置必须把本模块替换成目标 renderer 的 HostConfig，或 npm
// 通用工厂 shim。正常构建永远不会解析到此文件；若替换配置断裂，则立即抛错而不是让
// reconciler 带着缺失宿主能力继续运行。

throw new Error('This module must be shimmed by a specific renderer.');
