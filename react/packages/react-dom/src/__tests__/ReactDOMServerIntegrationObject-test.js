/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @jest-environment ./scripts/jest/ReactDOMServerIntegrationEnvironment
 */

'use strict';

/** `ReactDOMServerIntegrationUtils`：保存当前测试场景复用的夹具、状态或回调。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

let React;
let ReactDOMClient;
let ReactDOMServer;

/** `initModules`：封装当前用例复用的操作、回调或断言步骤。 */
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

/** `{resetModules, itRenders}`：保存当前测试场景复用的夹具、状态或回调。 */
const {resetModules, itRenders} = ReactDOMServerIntegrationUtils(initModules);

describe('ReactDOMServerIntegrationObject', () => {
  beforeEach(() => {
    resetModules();
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given `itRenders` 覆盖服务端字符串、客户端全新渲染及 hydration；
   * When 尝试渲染带 children 的普通对象；
   * Then 断言各入口路径都遵守相同的不可渲染对象诊断约定。
   *
   * 验证机制：集成工具通过 server/client 适配边界统一收集错误与 DOM；完整 Fizz 状态机位于范围外的
   * `packages/react-server`。
   */
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

  itRenders('an object with empty data', async render => {
    const e = await render(<object data="" />, 1);
    expect(e.outerHTML).toBe('<object></object>');
  });
});
