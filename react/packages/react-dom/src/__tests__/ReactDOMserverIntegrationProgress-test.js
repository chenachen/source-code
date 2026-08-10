/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
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

describe('ReactDOMServerIntegrationProgress', () => {
  beforeEach(() => {
    resetModules();
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given `itRenders` 覆盖服务端字符串、客户端全新渲染及 hydration；
   * When 渲染不确定状态的 progress；
   * Then 断言缺少 value 时各入口路径都保留不确定态语义。
   *
   * 验证机制：集成工具串联 react-dom server/client 适配边界并检查真实 DOM；完整 Fizz 状态机位于
   * 范围外的 `packages/react-server`。
   */
  itRenders('a progress in an indeterminate state', async render => {
    // 针对 https://github.com/facebook/react/issues/6119 的回归测试。
    const e = await render(<progress value={null} />);
    expect(e.hasAttribute('value')).toBe(false);
    const e2 = await render(<progress value={50} />);
    expect(e2.getAttribute('value')).toBe('50');
  });
});
