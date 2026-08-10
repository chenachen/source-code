/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// Edge 静态入口仅转发 Web Streams 预渲染协议；完整实现位于 `react-server`。
export {
  prerender,
  resumeAndPrerender,
  version,
} from './src/server/react-dom-server.edge';
