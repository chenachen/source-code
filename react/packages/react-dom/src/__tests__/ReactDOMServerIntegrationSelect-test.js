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

/** `{resetModules, itRenders, itThrowsWhenRendering}`：保存当前测试场景复用的夹具、状态或回调。 */
const {resetModules, itRenders, itThrowsWhenRendering} =
  ReactDOMServerIntegrationUtils(initModules);

describe('ReactDOMServerIntegrationSelect', () => {
  let options;
  beforeEach(() => {
    resetModules();

    options = [
      <option key={1} value="foo" id="foo">
        Foo
      </option>,
      <option key={2} value="bar" id="bar">
        Bar
      </option>,
      <option key={3} value="baz" id="baz">
        Baz
      </option>,
    ];
  });

  // 一个用于测试 `<select>` 元素选中的值的辅助函数。 接收一个 <select> DOM 元素（element）以及应
  // 该被选择的值或值数组（selected）。
  /** `expectSelectValue`：封装当前用例复用的操作、回调或断言步骤。 */
  const expectSelectValue = (element, selected) => {
    if (!Array.isArray(selected)) {
      selected = [selected];
    }
    // select DOM 元素不应带有 value 或 defaultValue 属性；DOM 并不是通过这些属性表达 select 值的。
    expect(element.getAttribute('value')).toBe(null);
    expect(element.getAttribute('defaultValue')).toBe(null);

    ['foo', 'bar', 'baz'].forEach(value => {
      const expectedValue = selected.indexOf(value) !== -1;
      const option = element.querySelector(`#${value}`);
      expect(option.selected).toBe(expectedValue);
    });
  };

  /**
   * 代表场景（Given–When–Then）：
   * Given `itRenders` 覆盖服务端字符串、客户端全新渲染及 hydration；
   * When 渲染带 value 与 onChange 的受控 select；
   * Then 断言 option 选中态而非 select 属性承载最终值。
   *
   * 验证机制：集成工具串联 server 适配器、`ReactDOMRoot.js` 与表单属性提交；完整 Fizz 状态机位于
   * 范围外的 `packages/react-server`。
   */
  itRenders('a select with a value and an onChange', async render => {
    const e = await render(
      <select value="bar" onChange={() => {}}>
        {options}
      </select>,
    );
    expectSelectValue(e, 'bar');
  });

  itRenders('a select with a value and readOnly', async render => {
    const e = await render(
      <select value="bar" readOnly={true}>
        {options}
      </select>,
    );
    expectSelectValue(e, 'bar');
  });

  itRenders('a select with a multiple values and an onChange', async render => {
    const e = await render(
      <select value={['bar', 'baz']} multiple={true} onChange={() => {}}>
        {options}
      </select>,
    );
    expectSelectValue(e, ['bar', 'baz']);
  });

  itRenders('a select with a multiple values and readOnly', async render => {
    const e = await render(
      <select value={['bar', 'baz']} multiple={true} readOnly={true}>
        {options}
      </select>,
    );
    expectSelectValue(e, ['bar', 'baz']);
  });

  itRenders('a select with a value and no onChange/readOnly', async render => {
    // 这应该引发一个开发警告，指出没有 onChange 或 readOnly 的值是一个错误。
    const e = await render(<select value="bar">{options}</select>, 1);
    expectSelectValue(e, 'bar');
  });

  itRenders('a select with a defaultValue', async render => {
    const e = await render(<select defaultValue="bar">{options}</select>);
    expectSelectValue(e, 'bar');
  });

  itRenders('a select value overriding defaultValue', async render => {
    const e = await render(
      <select value="bar" defaultValue="baz" readOnly={true}>
        {options}
      </select>,
      1,
    );
    expectSelectValue(e, 'bar');
  });

  itRenders(
    'a select with options that use dangerouslySetInnerHTML',
    async render => {
      const e = await render(
        <select defaultValue="baz" value="bar" readOnly={true}>
          <option
            id="foo"
            value="foo"
            dangerouslySetInnerHTML={{
              __html: 'Foo',
            }}>
            {undefined}
          </option>
          <option
            id="bar"
            value="bar"
            dangerouslySetInnerHTML={{
              __html: 'Bar',
            }}>
            {null}
          </option>
          <option
            id="baz"
            dangerouslySetInnerHTML={{
              __html: 'Baz', // 这里会警告，因为没有传入 value 属性。
            }}
          />
        </select>,
        2,
      );
      expectSelectValue(e, 'bar');
    },
  );

  itThrowsWhenRendering(
    'a select with option that uses dangerouslySetInnerHTML and 0 as child',
    async render => {
      await render(
        <select defaultValue="baz" value="foo" readOnly={true}>
          <option
            id="foo"
            value="foo"
            dangerouslySetInnerHTML={{
              __html: 'Foo',
            }}>
            {0}
          </option>
        </select>,
        1,
      );
    },
    'Can only set one of `children` or `props.dangerouslySetInnerHTML`.',
  );

  itThrowsWhenRendering(
    'a select with option that uses dangerouslySetInnerHTML and empty string as child',
    async render => {
      await render(
        <select defaultValue="baz" value="foo" readOnly={true}>
          <option
            id="foo"
            value="foo"
            dangerouslySetInnerHTML={{
              __html: 'Foo',
            }}>
            {''}
          </option>
        </select>,
        1,
      );
    },
    'Can only set one of `children` or `props.dangerouslySetInnerHTML`.',
  );

  itRenders(
    'a select value overriding defaultValue no matter the prop order',
    async render => {
      const e = await render(
        <select defaultValue="baz" value="bar" readOnly={true}>
          {options}
        </select>,
        1,
      );
      expectSelectValue(e, 'bar');
    },
  );

  itRenders('a select option with flattened children', async render => {
    const e = await render(
      <select value="bar" readOnly={true}>
        <option value="bar">
          A {'B'} {5n}
        </option>
      </select>,
    );
    const option = e.options[0];
    expect(option.textContent).toBe('A B 5');
    expect(option.value).toBe('bar');
    expect(option.selected).toBe(true);
  });

  itRenders(
    'a select option with flattened children no value',
    async render => {
      const e = await render(
        <select value="A B" readOnly={true}>
          <option>A {'B'}</option>
        </select>,
      );
      const option = e.options[0];
      expect(option.textContent).toBe('A B');
      expect(option.value).toBe('A B');
      expect(option.selected).toBe(true);
    },
  );

  itRenders(
    'a boolean true select value match the string "true"',
    async render => {
      const e = await render(
        <select value={true} readOnly={true}>
          <option value="first">First</option>
          <option value="true">True</option>
        </select>,
      );
      expect(e.firstChild.selected).toBe(false);
      expect(e.lastChild.selected).toBe(true);
    },
  );

  itRenders(
    'a missing select value does not match the string "undefined"',
    async render => {
      const e = await render(
        <select readOnly={true}>
          <option value="first">First</option>
          <option value="undefined">Undefined</option>
        </select>,
      );
      expect(e.firstChild.selected).toBe(true);
      expect(e.lastChild.selected).toBe(false);
    },
  );
});
