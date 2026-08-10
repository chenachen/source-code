/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// 该源码入口仅供测试；延迟 require 可等测试先安装 Node host config，再解析静态实现。

import ReactVersion from 'shared/ReactVersion';
export {ReactVersion as version};

/** 延迟转发 Node Stream 静态预渲染入口。 */
export function prerenderToNodeStream() {
  return require('./src/server/react-dom-server.node').prerenderToNodeStream.apply(
    this,
    arguments,
  );
}

/** 延迟转发 Node 环境可用的 Web Streams 静态预渲染入口。 */
export function prerender() {
  return require('./src/server/react-dom-server.node').prerender.apply(
    this,
    arguments,
  );
}

/** 延迟转发从可恢复状态继续生成 Node Stream 静态输出的入口。 */
export function resumeAndPrerenderToNodeStream() {
  return require('./src/server/react-dom-server.node').resumeAndPrerenderToNodeStream.apply(
    this,
    arguments,
  );
}

/** 延迟转发从可恢复状态继续生成 Web Stream 静态输出的入口。 */
export function resumeAndPrerender() {
  return require('./src/server/react-dom-server.node').resumeAndPrerender.apply(
    this,
    arguments,
  );
}
