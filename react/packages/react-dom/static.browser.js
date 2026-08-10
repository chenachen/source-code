/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 浏览器静态入口仅转发流式预渲染协议；完整实现位于 `react-server`，本文件只是宿主适配层。
export {
  prerender,
  resumeAndPrerender,
  version,
} from './src/server/react-dom-server.browser';
