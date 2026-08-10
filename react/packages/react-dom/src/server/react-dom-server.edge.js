/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// Edge 实验聚合入口组合 Web Streams 服务适配与静态预渲染；不包含完整 Fizz 工作循环。
export * from './ReactDOMFizzServerEdge.js';
export {prerender, resumeAndPrerender} from './ReactDOMFizzStaticEdge.js';
