/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// Edge 稳定聚合入口显式限制公开表面，避免实验导出泄漏。
export {
  renderToReadableStream,
  resume,
  version,
} from './ReactDOMFizzServerEdge.js';
export {prerender, resumeAndPrerender} from './ReactDOMFizzStaticEdge.js';
