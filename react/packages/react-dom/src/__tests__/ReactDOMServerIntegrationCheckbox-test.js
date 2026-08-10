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
// 由 `yarn test-fire` 设置。
const {disableInputAttributeSyncing} = require('shared/ReactFeatureFlags');

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

  // 将这些方法暴露给测试辅助函数。
  return {
    ReactDOMClient,
    ReactDOMServer,
  };
}

/** `{resetModules, itRenders}`：保存当前测试场景复用的夹具、状态或回调。 */
const {resetModules, itRenders} = ReactDOMServerIntegrationUtils(initModules);

// TODO：确定 SSR 行为后，在 React Fire 模式下运行此测试。
const desc = disableInputAttributeSyncing ? xdescribe : describe;
desc('ReactDOMServerIntegrationCheckbox', () => {
  beforeEach(() => {
    resetModules();
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given `itRenders` 覆盖服务端字符串、客户端全新渲染及 hydration；
   * When 渲染带 checked 与 onChange 的受控 checkbox；
   * Then 断言 checked 状态与事件属性不会因入口模式不同而漂移。
   *
   * 验证机制：集成工具串联 server 适配器、`ReactDOMRoot.js` 和表单宿主属性提交；完整 Fizz 状态机
   * 位于范围外的 `packages/react-server`。
   */
  itRenders('a checkbox that is checked with an onChange', async render => {
    const e = await render(
      <input type="checkbox" checked={true} onChange={() => {}} />,
    );
    expect(e.checked).toBe(true);
  });

  itRenders('a checkbox that is checked with readOnly', async render => {
    const e = await render(
      <input type="checkbox" checked={true} readOnly={true} />,
    );
    expect(e.checked).toBe(true);
  });

  itRenders(
    'a checkbox that is checked and no onChange/readOnly',
    async render => {
      // 该配置应在开发环境警告：设置 checked 却未提供 onChange 或 readOnly 是错误用法。
      const e = await render(<input type="checkbox" checked={true} />, 1);
      expect(e.checked).toBe(true);
    },
  );

  itRenders('a checkbox with defaultChecked', async render => {
    const e = await render(<input type="checkbox" defaultChecked={true} />);
    expect(e.checked).toBe(true);
    expect(e.getAttribute('defaultChecked')).toBe(null);
  });

  itRenders('a checkbox checked overriding defaultChecked', async render => {
    const e = await render(
      <input
        type="checkbox"
        checked={true}
        defaultChecked={false}
        readOnly={true}
      />,
      1,
    );
    expect(e.checked).toBe(true);
    expect(e.getAttribute('defaultChecked')).toBe(null);
  });

  itRenders(
    'a checkbox checked overriding defaultChecked no matter the prop order',
    async render => {
      const e = await render(
        <input
          type="checkbox"
          defaultChecked={false}
          checked={true}
          readOnly={true}
        />,
        1,
      );
      expect(e.checked).toBe(true);
      expect(e.getAttribute('defaultChecked')).toBe(null);
    },
  );
});
