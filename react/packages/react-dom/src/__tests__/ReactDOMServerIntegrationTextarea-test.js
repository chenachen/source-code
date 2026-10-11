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

describe('ReactDOMServerIntegrationTextarea', () => {
  beforeEach(() => {
    resetModules();
  });

  // textarea 用于创建文本区域。
  /**
   * 代表场景（Given–When–Then）：
   * Given `itRenders` 覆盖服务端字符串、服务端流、全新客户端、正确标记水合及错误标记恢复；
   * When 渲染带 value 与 onChange 的受控 textarea；
   * Then 断言文本值与受控表单语义在各入口路径中一致。
   *
   * 验证机制：集成工具串联 server 适配器、`ReactDOMRoot.js` 与表单属性提交。
   */
  /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；textarea.value=foo 且有 onChange；value property 应为 foo但没有 value attribute，验证 textarea 值由元素文本/属性语义承载。 */
  itRenders('a textarea with a value and an onChange', async render => {
    const e = await render(<textarea value="foo" onChange={() => {}} />);
    // 文本区域元素没有值属性。 文本是元素的子元素，并可通过 `.value` **属性** 访问。
    expect(e.getAttribute('value')).toBe(null);
    expect(e.value).toBe('foo');
  });

  /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；textarea.value 为 5n 且有 onChange；DOM value 应为字符串 5且无 value attribute，验证 bigint 转文本。 */
  itRenders('a textarea with a bigint value and an onChange', async render => {
    const e = await render(<textarea value={5n} onChange={() => {}} />);
    expect(e.getAttribute('value')).toBe(null);
    expect(e.value).toBe('5');
  });

  /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；value=undefined；DOM value 应为空字符串且无 value attribute，验证未提供值不会变成 undefined 文本。 */
  itRenders('a textarea with a value of undefined', async render => {
    const e = await render(<textarea value={undefined} />);
    expect(e.getAttribute('value')).toBe(null);
    expect(e.value).toBe('');
  });
  /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；value=foo 且 readOnly；value property 为 foo且无 value attribute，验证只读受控 textarea 初值。 */
  itRenders('a textarea with a value and readOnly', async render => {
    const e = await render(<textarea value="foo" readOnly={true} />);
    // 文本区域元素没有值属性。 文本是元素的子元素，并可通过 `.value` **属性** 访问。
    expect(e.getAttribute('value')).toBe(null);
    expect(e.value).toBe('foo');
  });

  /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；只传 value=foo，预期一次缺处理器诊断；仍输出 foo 的 value property并无 value attribute，验证诊断与赋值分离。 */
  itRenders(
    'a textarea with a value and no onChange/readOnly',
    async render => {
      // 这应该引发一个开发警告，指出没有 onChange 或 readOnly 的值是一个错误。
      const e = await render(<textarea value="foo" />, 1);
      expect(e.getAttribute('value')).toBe(null);
      expect(e.value).toBe('foo');
    },
  );

  /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；只传 defaultValue=foo；DOM value 为 foo，value/defaultValue attribute 均不存在，验证默认文本不会作为这些 HTML 属性输出。 */
  itRenders('a textarea with a defaultValue', async render => {
    const e = await render(<textarea defaultValue="foo" />);
    expect(e.getAttribute('value')).toBe(null);
    expect(e.getAttribute('defaultValue')).toBe(null);
    expect(e.value).toBe('foo');
  });

  /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；value=foo 与 defaultValue=bar 同时传入且只读；预期一次冲突诊断并取 foo，无对应值属性，验证受控值优先。 */
  itRenders('a textarea value overriding defaultValue', async render => {
    const e = await render(
      <textarea value="foo" defaultValue="bar" readOnly={true} />,
      1,
    );
    expect(e.getAttribute('value')).toBe(null);
    expect(e.getAttribute('defaultValue')).toBe(null);
    expect(e.value).toBe('foo');
  });

  /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；交换 defaultValue/value 的声明顺序；同样诊断一次并取 foo，无 value/defaultValue attribute，验证初始化顺序不改变优先关系。 */
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
