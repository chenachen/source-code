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
/** 读取test-fire配置的输入属性同步开关；true时下面用xdescribe跳过整组，当前用例断言依赖value property与attribute的同步。 */
const {disableInputAttributeSyncing} = require('shared/ReactFeatureFlags');

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

  // 让 helper 可以访问这些模块。
  return {
    ReactDOMClient,
    ReactDOMServer,
  };
}

/** 从集成工具取模式重置器和五模式测试展开器；itRenders 的每个定义复用同一场景回调。 */
const {resetModules, itRenders} = ReactDOMServerIntegrationUtils(initModules);

// TODO：确定 SSR 行为后，在 React Fire 模式下运行此套件。
/** 当 disableInputAttributeSyncing 为 true 时以 xdescribe 跳过整组，本轮不执行其场景；其余配置正常定义 describe，等待 SSR 属性同步语义确认。 */
const desc = disableInputAttributeSyncing ? xdescribe : describe;
desc('ReactDOMServerIntegrationInput', () => {
  beforeEach(() => {
    resetModules();
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given `itRenders` 覆盖服务端字符串、服务端流、全新客户端、正确标记水合及错误标记恢复；
   * When 渲染带 value 与 onChange 的受控 input；
   * Then 断言 DOM value 与受控表单语义在各入口路径中一致。
   *
   * 验证机制：集成工具串联 server 适配器、`ReactDOMRoot.js` 和表单属性提交。
   */
  /** disableInputAttributeSyncing=true 时整组跳过而不执行；通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；value=foo 且 onChange 为空处理器；DOM value 应为 foo，验证受控文本初值。 */
  itRenders('an input with a value and an onChange', async render => {
    const e = await render(<input value="foo" onChange={() => {}} />);
    expect(e.value).toBe('foo');
  });

  /** disableInputAttributeSyncing=true 时整组跳过而不执行；通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；value 为 bigint 5n 且有 onChange；DOM value 应为字符串 5，验证表单值的 bigint 字符串化。 */
  itRenders('an input with a bigint value and an onChange', async render => {
    const e = await render(<input value={5n} onChange={() => {}} />);
    expect(e.value).toBe('5');
  });

  /** disableInputAttributeSyncing=true 时整组跳过而不执行；通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；value=foo 且 readOnly；value 应为 foo且无受控缺处理器诊断，验证只读输入允许固定值。 */
  itRenders('an input with a value and readOnly', async render => {
    const e = await render(<input value="foo" readOnly={true} />);
    expect(e.value).toBe('foo');
  });

  /** disableInputAttributeSyncing=true 时整组跳过而不执行；通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；仅提供 value=foo，预期一次缺处理器诊断；value property 和 value attribute 均为 foo，验证诊断不改变初值输出。 */
  itRenders('an input with a value and no onChange/readOnly', async render => {
    // 这应该引发一个开发警告，指出没有 onChange 或 readOnly 的值是一个错误。
    const e = await render(<input value="foo" />, 1);
    expect(e.value).toBe('foo');
    expect(e.getAttribute('value')).toBe('foo');
  });

  /** disableInputAttributeSyncing=true 时整组跳过而不执行；通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；仅提供 defaultValue=foo；value property/attribute 为 foo而不存在 defaultValue attribute，验证非受控默认值写入 value。 */
  itRenders('an input with a defaultValue', async render => {
    const e = await render(<input defaultValue="foo" />);
    expect(e.value).toBe('foo');
    expect(e.getAttribute('value')).toBe('foo');
    expect(e.getAttribute('defaultValue')).toBe(null);
  });

  /** disableInputAttributeSyncing=true 时整组跳过而不执行；通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；value=foo 与 defaultValue=bar 同时存在且 readOnly；预期一次冲突诊断，value property/attribute 取 foo，验证受控初值优先。 */
  itRenders('an input value overriding defaultValue', async render => {
    const e = await render(
      <input value="foo" defaultValue="bar" readOnly={true} />,
      1,
    );
    expect(e.value).toBe('foo');
    expect(e.getAttribute('value')).toBe('foo');
    expect(e.getAttribute('defaultValue')).toBe(null);
  });

  /** disableInputAttributeSyncing=true 时整组跳过而不执行；通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；交换 defaultValue/value 的 JSX 顺序；仍应诊断一次并取 foo，不输出 defaultValue attribute，验证属性处理不依赖声明顺序。 */
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
