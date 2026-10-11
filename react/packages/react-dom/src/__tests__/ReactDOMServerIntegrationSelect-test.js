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

/** 提供统一跨SSR/客户端/hydration测试展开器及错误入口包装，render返回可断言的DOM节点。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

let React;
let ReactDOMClient;
let ReactDOMServer;

/** 重置模块及警告缓存，重载React/client/server后把入口交给集成工具；每次模式切换隔离模块级状态。 */
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

/** 取模式重置器、五模式DOM场景展开器与三入口错误包装，分别断言正常选择和互斥输入抛错。 */
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

  /** selected可为单值或数组，先统一数组再检查select不含值attribute，并逐foo/bar/baz的id比较option.selected，验证精确选中集合。 */
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
   * Given `itRenders` 覆盖服务端字符串、服务端流、全新客户端、正确标记水合及错误标记恢复；
   * When 渲染带 value 与 onChange 的受控 select；
   * Then 断言 option 选中态而非 select 属性承载最终值。
   *
   * 验证机制：集成工具串联 server 适配器、`ReactDOMRoot.js` 与表单属性提交。
   */
  /** 经 itRenders 的五种 SSR/客户端/hydration 模式执行；options含foo/bar/baz，受控value=bar且有onChange；仅bar应selected且select无value/defaultValue attribute，验证值由option状态表达。 */
  itRenders('a select with a value and an onChange', async render => {
    const e = await render(
      <select value="bar" onChange={() => {}}>
        {options}
      </select>,
    );
    expectSelectValue(e, 'bar');
  });

  /** 经 itRenders 的五种 SSR/客户端/hydration 模式执行；value=bar且readOnly；仅bar选中而select无值属性，验证只读允许固定受控选择。 */
  itRenders('a select with a value and readOnly', async render => {
    const e = await render(
      <select value="bar" readOnly={true}>
        {options}
      </select>,
    );
    expectSelectValue(e, 'bar');
  });

  /** 经 itRenders 的五种 SSR/客户端/hydration 模式执行；multiple=true、value数组为bar/baz且有onChange；两者选中、foo不选，验证多值匹配集合。 */
  itRenders('a select with a multiple values and an onChange', async render => {
    const e = await render(
      <select value={['bar', 'baz']} multiple={true} onChange={() => {}}>
        {options}
      </select>,
    );
    expectSelectValue(e, ['bar', 'baz']);
  });

  /** 经 itRenders 的五种 SSR/客户端/hydration 模式执行；multiple=true配bar/baz数组且只读；同样两个option选中，验证多选只读受控输入。 */
  itRenders('a select with a multiple values and readOnly', async render => {
    const e = await render(
      <select value={['bar', 'baz']} multiple={true} readOnly={true}>
        {options}
      </select>,
    );
    expectSelectValue(e, ['bar', 'baz']);
  });

  /** 经 itRenders 的五种 SSR/客户端/hydration 模式执行；仅value=bar无处理器/只读；预期一次诊断且bar仍选中，验证警告不改变初值。 */
  itRenders('a select with a value and no onChange/readOnly', async render => {
    // 这应该引发一个开发警告，指出没有 onChange 或 readOnly 的值是一个错误。
    const e = await render(<select value="bar">{options}</select>, 1);
    expectSelectValue(e, 'bar');
  });

  /** 经 itRenders 的五种 SSR/客户端/hydration 模式执行；仅defaultValue=bar；bar选中且select不输出defaultValue属性，验证非受控默认选择。 */
  itRenders('a select with a defaultValue', async render => {
    const e = await render(<select defaultValue="bar">{options}</select>);
    expectSelectValue(e, 'bar');
  });

  /** 经 itRenders 的五种 SSR/客户端/hydration 模式执行；value=bar、defaultValue=baz且只读；预期一次冲突诊断，bar优先选中，验证受控值压过默认值。 */
  itRenders('a select value overriding defaultValue', async render => {
    const e = await render(
      <select value="bar" defaultValue="baz" readOnly={true}>
        {options}
      </select>,
      1,
    );
    expectSelectValue(e, 'bar');
  });

  /** 经 itRenders 的五种 SSR/客户端/hydration 模式执行；option使用innerHTML，foo/bar含undefined/null child而baz无value；预期两次诊断，仍仅bar选中，验证空child允许HTML且缺option值会诊断。 */
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

  /** 经itThrowsWhenRendering三条错误入口渲染innerHTML option并给child=0；均应拒绝且消息指出children与innerHTML互斥，验证数字零虽falsy仍是有效children。 */
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

  /** 经itThrowsWhenRendering三条错误入口给innerHTML option与空字符串child；均应拒绝同一互斥消息，验证只排除null/undefined而不排除空字符串。 */
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

  /** 经 itRenders 的五种 SSR/客户端/hydration 模式执行；把defaultValue=baz写在value=bar之前；仍一次冲突诊断且只bar选中，验证优先关系不依赖prop顺序。 */
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

  /** 经 itRenders 的五种 SSR/客户端/hydration 模式执行；value=bar的select中option显式value=bar、children为A/B/bigint5；textContent为A B 5、value为bar且selected，验证文本扁平化与显式值独立。 */
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

  /** 经 itRenders 的五种 SSR/客户端/hydration 模式执行；select.value为A B、option只有A/B文本无value；option文本与隐式value均A B且选中，验证文字内容回退为值。 */
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

  /** 经 itRenders 的五种 SSR/客户端/hydration 模式执行；select.value=true且options为first/true；仅字符串true的option选中，验证受控值先字符串化匹配。 */
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

  /** 经 itRenders 的五种 SSR/客户端/hydration 模式执行；select缺value且options为first/undefined字符串；首项选中而undefined项不选，验证缺值不被强转成undefined文本。 */
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
