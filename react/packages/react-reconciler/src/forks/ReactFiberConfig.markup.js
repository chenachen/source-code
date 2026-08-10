/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 即使 markup 构建不会使用 reconciler，仓库仍会在全部构建维度检查其类型；这里重导出
// DOM HostConfig 与客户端 console 配置，使该无运行时用途的维度也能完成静态检查。
export * from 'react-dom-bindings/src/client/ReactFiberConfigDOM';
export * from 'react-client/src/ReactClientConsoleConfigBrowser';

// eslint-disable-next-line react-internal/prod-error-codes
throw new Error('Fiber is not used in react-markup');
