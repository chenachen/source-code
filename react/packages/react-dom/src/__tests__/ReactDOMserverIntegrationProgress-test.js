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

describe('ReactDOMServerIntegrationProgress', () => {
  beforeEach(() => {
    resetModules();
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given `itRenders` 覆盖服务端字符串、服务端流、全新客户端、正确标记水合及错误标记恢复；
   * When 渲染不确定状态的 progress；
   * Then 断言缺少 value 时各入口路径都保留不确定态语义。
   *
   * 验证机制：集成工具串联 react-dom server/client 适配边界并检查真实 DOM。
   */
  /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；先渲染 value=null 的 progress 再渲染 value=50；前者应没有 value attribute、后者为 50，验证不确定进度不会因 null 被写成数值零。 */
  itRenders('a progress in an indeterminate state', async render => {
    // 针对 https://github.com/facebook/react/issues/6119 的回归测试。
    const e = await render(<progress value={null} />);
    expect(e.hasAttribute('value')).toBe(false);
    const e2 = await render(<progress value={50} />);
    expect(e2.getAttribute('value')).toBe('50');
  });
});
