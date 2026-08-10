/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 浏览器实验聚合入口组合 Web Streams 服务适配与静态预渲染；完整 Fizz 位于 `react-server`。
export * from './ReactDOMFizzServerBrowser.js';
export {prerender, resumeAndPrerender} from './ReactDOMFizzStaticBrowser.js';
