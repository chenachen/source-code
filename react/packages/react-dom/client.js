/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 客户端子路径只重导出并发根创建、水合与版本；真实根生命周期由 `ReactDOMRoot` 管理。
export {createRoot, hydrateRoot, version} from './src/client/ReactDOMClient';
