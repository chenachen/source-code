/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 浏览器稳定聚合入口显式限制公开表面，避免实验导出随 `export *` 泄漏。
export {
  renderToReadableStream,
  resume,
  version,
} from './ReactDOMFizzServerBrowser.js';
export {prerender, resumeAndPrerender} from './ReactDOMFizzStaticBrowser.js';
