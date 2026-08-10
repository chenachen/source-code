/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// 该源码入口仅供测试；延迟 require 可等测试先安装正确 host config，再解析实现模块。

import ReactVersion from 'shared/ReactVersion';
export {ReactVersion as version};

/** 延迟转发浏览器旧式同步字符串渲染；该 API 不支持 Suspense 流式能力。 */
export function renderToString() {
  return require('./src/server/ReactDOMLegacyServerBrowser').renderToString.apply(
    this,
    arguments,
  );
}
/** 延迟转发浏览器旧式静态标记渲染，不生成可水合元数据。 */
export function renderToStaticMarkup() {
  return require('./src/server/ReactDOMLegacyServerBrowser').renderToStaticMarkup.apply(
    this,
    arguments,
  );
}

/** 延迟转发浏览器 Web Streams 服务端适配器；完整 Fizz 工作循环位于 `react-server`。 */
export function renderToReadableStream() {
  return require('./src/server/react-dom-server.browser').renderToReadableStream.apply(
    this,
    arguments,
  );
}

/** 延迟转发浏览器 Web Streams 恢复入口，继续已有可恢复状态。 */
export function resume() {
  return require('./src/server/react-dom-server.browser').resume.apply(
    this,
    arguments,
  );
}
