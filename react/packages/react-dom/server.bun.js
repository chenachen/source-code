/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// 该源码入口仅供测试；延迟 require 可等测试先安装 Bun host config，再解析实现模块。

import ReactVersion from 'shared/ReactVersion';
export {ReactVersion as version};

/** 延迟转发 Bun 的 Web Streams 渲染入口。 */
export function renderToReadableStream() {
  return require('./src/server/react-dom-server.bun').renderToReadableStream.apply(
    this,
    arguments,
  );
}

/** 转发兼容浏览器宿主的旧式同步字符串渲染。 */
export function renderToString() {
  return require('./src/server/ReactDOMLegacyServerBrowser').renderToString.apply(
    this,
    arguments,
  );
}

/** 转发兼容浏览器宿主的旧式静态标记渲染。 */
export function renderToStaticMarkup() {
  return require('./src/server/ReactDOMLegacyServerBrowser').renderToStaticMarkup.apply(
    this,
    arguments,
  );
}

/** 延迟转发 Bun 的 Web Streams 恢复入口。 */
export function resume() {
  return require('./src/server/react-dom-server.bun').resume.apply(
    this,
    arguments,
  );
}

/** 延迟转发 Bun 的可管道流渲染入口。 */
export function renderToPipeableStream() {
  return require('./src/server/react-dom-server.bun').renderToPipeableStream.apply(
    this,
    arguments,
  );
}

/** 延迟转发 Bun 的可管道流恢复入口。 */
export function resumeToPipeableStream() {
  return require('./src/server/react-dom-server.bun').resumeToPipeableStream.apply(
    this,
    arguments,
  );
}
