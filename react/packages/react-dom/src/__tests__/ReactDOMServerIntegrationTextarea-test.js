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

describe('ReactDOMServerIntegrationTextarea', () => {
  beforeEach(() => {
    resetModules();
  });

  // textarea 用于创建文本区域。
  /**
   * 代表场景（Given–When–Then）：
   * Given `itRenders` 覆盖服务端字符串、客户端全新渲染及 hydration；
   * When 渲染带 value 与 onChange 的受控 textarea；
   * Then 断言文本值与受控表单语义在各入口路径中一致。
   *
   * 验证机制：集成工具串联 server 适配器、`ReactDOMRoot.js` 与表单属性提交；完整 Fizz 状态机位于
   * 范围外的 `packages/react-server`。
   */
  itRenders('a textarea with a value and an onChange', async render => {
    const e = await render(<textarea value="foo" onChange={() => {}} />);
    // 文本区域元素没有值属性。 文本是元素的子元素，并可通过 `.value` **属性** 访问。
    expect(e.getAttribute('value')).toBe(null);
    expect(e.value).toBe('foo');
  });

  itRenders('a textarea with a bigint value and an onChange', async render => {
    const e = await render(<textarea value={5n} onChange={() => {}} />);
    expect(e.getAttribute('value')).toBe(null);
    expect(e.value).toBe('5');
  });

  itRenders('a textarea with a value of undefined', async render => {
    const e = await render(<textarea value={undefined} />);
    expect(e.getAttribute('value')).toBe(null);
    expect(e.value).toBe('');
  });
  itRenders('a textarea with a value and readOnly', async render => {
    const e = await render(<textarea value="foo" readOnly={true} />);
    // 文本区域元素没有值属性。 文本是元素的子元素，并可通过 `.value` **属性** 访问。
    expect(e.getAttribute('value')).toBe(null);
    expect(e.value).toBe('foo');
  });

  itRenders(
    'a textarea with a value and no onChange/readOnly',
    async render => {
      // 这应该引发一个开发警告，指出没有 onChange 或 readOnly 的值是一个错误。
      const e = await render(<textarea value="foo" />, 1);
      expect(e.getAttribute('value')).toBe(null);
      expect(e.value).toBe('foo');
    },
  );

  itRenders('a textarea with a defaultValue', async render => {
    const e = await render(<textarea defaultValue="foo" />);
    expect(e.getAttribute('value')).toBe(null);
    expect(e.getAttribute('defaultValue')).toBe(null);
    expect(e.value).toBe('foo');
  });

  itRenders('a textarea value overriding defaultValue', async render => {
    const e = await render(
      <textarea value="foo" defaultValue="bar" readOnly={true} />,
      1,
    );
    expect(e.getAttribute('value')).toBe(null);
    expect(e.getAttribute('defaultValue')).toBe(null);
    expect(e.value).toBe('foo');
  });

  itRenders(
    'a textarea value overriding defaultValue no matter the prop order',
    async render => {
      const e = await render(
        <textarea defaultValue="bar" value="foo" readOnly={true} />,
        1,
      );
      expect(e.getAttribute('value')).toBe(null);
      expect(e.getAttribute('defaultValue')).toBe(null);
      expect(e.value).toBe('foo');
    },
  );
});
