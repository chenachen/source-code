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

describe('ReactDOMServerIntegration', () => {
  beforeEach(() => {
    resetModules();
  });

  describe('React.StrictMode', () => {
    /**
     * 代表场景（Given–When–Then）：
     * Given `itRenders` 在服务端、客户端与 hydration 模式中执行同一 StrictMode fixture；
     * When StrictMode 包含一个子节点；
     * Then 断言模式包装不会改变最终宿主结构。
     *
     * 验证机制：集成工具串联 react-dom server/client 适配边界并比较 DOM；完整 Fizz 状态机位于范围外
     * 的 `packages/react-server`。
     */
    /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；StrictMode 含一个 div；父容器首子级应为 DIV，验证模式包装无额外 DOM。 */
    itRenders('a strict mode with one child', async render => {
      const e = await render(
        <React.StrictMode>
          <div>text1</div>
        </React.StrictMode>,
      );
      const parent = e.parentNode;
      expect(parent.childNodes[0].tagName).toBe('DIV');
    });

    /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；StrictMode 含 div/span/Header/返回嵌套模式的 Footer；父容器应为 DIV/SPAN/P/H2/H3，验证模式与组件混合展开的顺序。 */
    itRenders('a strict mode with several children', async render => {
      /** 返回单个 header 文本的 p，为父级展开后的第三个宿主子级提供组件边界。 */
      const Header = props => {
        return <p>header</p>;
      };
      /** 返回 footer 的 h2 与 about 的 h3 两个宿主节点，检测包装组件结果是否保持相邻顺序。 */
      const Footer = props => {
        return (
          <React.StrictMode>
            <h2>footer</h2>
            <h3>about</h3>
          </React.StrictMode>
        );
      };
      const e = await render(
        <React.StrictMode>
          <div>text1</div>
          <span>text2</span>
          <Header />
          <Footer />
        </React.StrictMode>,
      );
      const parent = e.parentNode;
      expect(parent.childNodes[0].tagName).toBe('DIV');
      expect(parent.childNodes[1].tagName).toBe('SPAN');
      expect(parent.childNodes[2].tagName).toBe('P');
      expect(parent.childNodes[3].tagName).toBe('H2');
      expect(parent.childNodes[4].tagName).toBe('H3');
    });

    /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；嵌套多层 StrictMode 并混入 null/false；宿主子级仅 DIV/SPAN/P，验证模式节点不占位而空子级被略过。 */
    itRenders('a nested strict mode', async render => {
      const e = await render(
        <React.StrictMode>
          <React.StrictMode>
            <div>text1</div>
          </React.StrictMode>
          <span>text2</span>
          <React.StrictMode>
            <React.StrictMode>
              <React.StrictMode>
                {null}
                <p />
              </React.StrictMode>
              {false}
            </React.StrictMode>
          </React.StrictMode>
        </React.StrictMode>,
      );
      const parent = e.parentNode;
      expect(parent.childNodes[0].tagName).toBe('DIV');
      expect(parent.childNodes[1].tagName).toBe('SPAN');
      expect(parent.childNodes[2].tagName).toBe('P');
    });

    /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；div 内仅含空 StrictMode；firstChild 应为 null，验证空模式无 DOM 输出。 */
    itRenders('an empty strict mode', async render => {
      expect(
        (
          await render(
            <div>
              <React.StrictMode />
            </div>,
          )
        ).firstChild,
      ).toBe(null);
    });
  });
});
