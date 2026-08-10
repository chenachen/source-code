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

  // 让 helper 可以访问这些模块。
  return {
    ReactDOMClient,
    ReactDOMServer,
  };
}

/** `{resetModules, itRenders}`：保存当前测试场景复用的夹具、状态或回调。 */
const {resetModules, itRenders} = ReactDOMServerIntegrationUtils(initModules);

// TODO：确定 SSR 行为后，在 React Fire 模式下运行此套件。
const desc = disableInputAttributeSyncing ? xdescribe : describe;
desc('ReactDOMServerIntegrationInput', () => {
  beforeEach(() => {
    resetModules();
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given `itRenders` 覆盖服务端字符串、客户端全新渲染及 hydration；
   * When 渲染带 value 与 onChange 的受控 input；
   * Then 断言 DOM value 与受控表单语义在各入口路径中一致。
   *
   * 验证机制：集成工具串联 server 适配器、`ReactDOMRoot.js` 和表单属性提交；完整 Fizz 状态机位于
   * 范围外的 `packages/react-server`。
   */
  itRenders('an input with a value and an onChange', async render => {
    const e = await render(<input value="foo" onChange={() => {}} />);
    expect(e.value).toBe('foo');
  });

  itRenders('an input with a bigint value and an onChange', async render => {
    const e = await render(<input value={5n} onChange={() => {}} />);
    expect(e.value).toBe('5');
  });

  itRenders('an input with a value and readOnly', async render => {
    const e = await render(<input value="foo" readOnly={true} />);
    expect(e.value).toBe('foo');
  });

  itRenders('an input with a value and no onChange/readOnly', async render => {
    // 这应该引发一个开发警告，指出没有 onChange 或 readOnly 的值是一个错误。
    const e = await render(<input value="foo" />, 1);
    expect(e.value).toBe('foo');
    expect(e.getAttribute('value')).toBe('foo');
  });

  itRenders('an input with a defaultValue', async render => {
    const e = await render(<input defaultValue="foo" />);
    expect(e.value).toBe('foo');
    expect(e.getAttribute('value')).toBe('foo');
    expect(e.getAttribute('defaultValue')).toBe(null);
  });

  itRenders('an input value overriding defaultValue', async render => {
    const e = await render(
      <input value="foo" defaultValue="bar" readOnly={true} />,
      1,
    );
    expect(e.value).toBe('foo');
    expect(e.getAttribute('value')).toBe('foo');
    expect(e.getAttribute('defaultValue')).toBe(null);
  });

  itRenders(
    'an input value overriding defaultValue no matter the prop order',
    async render => {
      const e = await render(
        <input defaultValue="bar" value="foo" readOnly={true} />,
        1,
      );
      expect(e.value).toBe('foo');
      expect(e.getAttribute('value')).toBe('foo');
      expect(e.getAttribute('defaultValue')).toBe(null);
    },
  );
});
