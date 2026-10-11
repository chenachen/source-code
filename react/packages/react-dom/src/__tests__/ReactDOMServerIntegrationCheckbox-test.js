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
/** 读取test-fire配置的输入属性同步开关；true时下面选择xdescribe跳过整组，避免按checked/value attribute同步语义运行这些集成断言。 */
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

  // 将这些方法暴露给测试辅助函数。
  return {
    ReactDOMClient,
    ReactDOMServer,
  };
}

/** 从集成工具取模式重置器和五模式测试展开器；itRenders 的每个定义复用同一场景回调。 */
const {resetModules, itRenders} = ReactDOMServerIntegrationUtils(initModules);

// TODO：确定 SSR 行为后，在 React Fire 模式下运行此测试。
/** 当 disableInputAttributeSyncing 为 true 时以 xdescribe 跳过整组，本轮不执行其场景；其余配置正常定义 describe，等待 SSR 属性同步语义确认。 */
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
  /** disableInputAttributeSyncing=true 时整组跳过而不执行；通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；checked=true 且 onChange 为空处理器；DOM checked 应为 true，验证受控 checkbox 初值。 */
  itRenders('a checkbox that is checked with an onChange', async render => {
    const e = await render(
      <input type="checkbox" checked={true} onChange={() => {}} />,
    );
    expect(e.checked).toBe(true);
  });

  /** disableInputAttributeSyncing=true 时整组跳过而不执行；通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；checked=true 且 readOnly=true；DOM checked 应为 true且无受控缺处理器诊断，验证只读声明满足受控约束。 */
  itRenders('a checkbox that is checked with readOnly', async render => {
    const e = await render(
      <input type="checkbox" checked={true} readOnly={true} />,
    );
    expect(e.checked).toBe(true);
  });

  /** disableInputAttributeSyncing=true 时整组跳过而不执行；通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；只提供 checked=true，预期一次 DEV 诊断且 checked 仍为 true，验证缺处理器的警告不丢失输入状态。 */
  itRenders(
    'a checkbox that is checked and no onChange/readOnly',
    async render => {
      // 该配置应在开发环境警告：设置 checked 却未提供 onChange 或 readOnly 是错误用法。
      const e = await render(<input type="checkbox" checked={true} />, 1);
      expect(e.checked).toBe(true);
    },
  );

  /** disableInputAttributeSyncing=true 时整组跳过而不执行；通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；仅提供 defaultChecked=true；checked 应为 true且无 defaultChecked attribute，验证非受控默认状态映射到 checked。 */
  itRenders('a checkbox with defaultChecked', async render => {
    const e = await render(<input type="checkbox" defaultChecked={true} />);
    expect(e.checked).toBe(true);
    expect(e.getAttribute('defaultChecked')).toBe(null);
  });

  /** disableInputAttributeSyncing=true 时整组跳过而不执行；通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；checked=true 与 defaultChecked=false 同时存在且 readOnly；预期一次冲突诊断，DOM checked 为 true且无 defaultChecked attribute，验证受控值优先。 */
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

  /** disableInputAttributeSyncing=true 时整组跳过而不执行；通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；把 defaultChecked 写在 checked 前方，仍应诊断一次并输出 checked=true，验证优先级由属性语义决定而非 JSX 顺序。 */
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
