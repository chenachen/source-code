/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @jest-environment ./scripts/jest/ReactDOMServerIntegrationEnvironment
 */

'use strict';

/** 提供跨 SSR、客户端渲染与 hydration 的统一场景展开器；每个 render 入口返回可断言的 DOM 节点。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

let React;
let ReactDOMClient;
let ReactDOMServer;

/** 重置模块及诊断缓存后重新加载 React/client/server，并把客户端和服务端入口交给集成工具；每次模式切换隔离模块级状态。 */
function initModules() {
  // 重置警告缓存。
  jest.resetModules();
  React = require('react');
  ReactDOMClient = require('react-dom/client');
  ReactDOMServer = require('react-dom/server');

  // 让他们可以帮助.
  return {
    ReactDOMClient,
    ReactDOMServer,
  };
}

/** 从集成工具取模式重置器和五模式测试展开器；itRenders 的每个定义复用同一场景回调。 */
const {resetModules, itRenders} = ReactDOMServerIntegrationUtils(initModules);

describe('ReactDOMServerIntegrationObject', () => {
  beforeEach(() => {
    resetModules();
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given `itRenders` 覆盖服务端字符串、客户端全新渲染及 hydration；
   * When 渲染带 data 等属性与预览子级的 HTML object 元素；
   * Then 断言 object 的属性和预览子树保留在宿主 HTML 输出中。
   *
   * 验证机制：集成工具通过 server/client 适配边界统一收集错误与 DOM；完整 Fizz 状态机位于范围外的
   * `packages/react-server`。
   */
  /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；渲染带 type/data/宽高与 div 预览子树的 HTML object 元素；outerHTML 应完整保留属性和预览内容，验证宿主 object 的正常输出。 */
  itRenders('an object with children', async render => {
    const e = await render(
      <object type="video/mp4" data="/example.webm" width={600} height={400}>
        <div>preview</div>
      </object>,
    );

    expect(e.outerHTML).toBe(
      '<object type="video/mp4" data="/example.webm" width="600" height="400"><div>preview</div></object>',
    );
  });

  /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；传 object.data 空字符串并预期一次 DEV 诊断；输出应为无 data 的 object，验证空资源 URL 会被省略。 */
  itRenders('an object with empty data', async render => {
    const e = await render(<object data="" />, 1);
    expect(e.outerHTML).toBe('<object></object>');
  });
});
