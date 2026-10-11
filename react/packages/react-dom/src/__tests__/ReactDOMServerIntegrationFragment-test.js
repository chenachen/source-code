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

  describe('React.Fragment', () => {
    /**
     * 代表场景（Given–When–Then）：
     * Given `itRenders` 以服务端字符串、服务端流、全新客户端、正确标记水合及错误标记恢复五种模式执行 Fragment fixture；
     * When Fragment 只包含一个子节点；
     * Then 断言 Fragment 不引入额外 DOM 包装且 hydration 能复用标记。
     *
     * 验证机制：正确服务端标记的水合模式检查节点身份，错误标记模式检查客户端恢复后的内容。
     */
    /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；Fragment 只含一个 div；容器首子级应为 DIV，验证 Fragment 不创建宿主包装。 */
    itRenders('a fragment with one child', async render => {
      const e = await render(
        <>
          <div>text1</div>
        </>,
      );
      const parent = e.parentNode;
      expect(parent.childNodes[0].tagName).toBe('DIV');
    });

    /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；Fragment 含 div/span、返回 p 的 Header 和返回 h2/h3 的 Footer；父容器应按 DIV/SPAN/P/H2/H3 顺序含五个子级，验证组件与 Fragment 混合展开。 */
    itRenders('a fragment with several children', async render => {

      /** 返回单个 header 文本的 p，为父级展开后的第三个宿主子级提供组件边界。 */
      const Header = props => {
        return <p>header</p>;
      };

      /** 返回 footer 的 h2 与 about 的 h3 两个宿主节点，检测包装组件结果是否保持相邻顺序。 */
      const Footer = props => {
        return (
          <>
            <h2>footer</h2>
            <h3>about</h3>
          </>
        );
      };
      const e = await render(
        <>
          <div>text1</div>
          <span>text2</span>
          <Header />
          <Footer />
        </>,
      );
      const parent = e.parentNode;
      expect(parent.childNodes[0].tagName).toBe('DIV');
      expect(parent.childNodes[1].tagName).toBe('SPAN');
      expect(parent.childNodes[2].tagName).toBe('P');
      expect(parent.childNodes[3].tagName).toBe('H2');
      expect(parent.childNodes[4].tagName).toBe('H3');
    });

    /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；多层 Fragment 混有 null/false 与 div/span/p；宿主子级应只留下 DIV/SPAN/P，验证嵌套包装和空子级均不占 DOM 节点。 */
    itRenders('a nested fragment', async render => {
      const e = await render(
        <>
          <>
            <div>text1</div>
          </>
          <span>text2</span>
          <>
            <>
              <>
                {null}
                <p />
              </>
              {false}
            </>
          </>
        </>,
      );
      const parent = e.parentNode;
      expect(parent.childNodes[0].tagName).toBe('DIV');
      expect(parent.childNodes[1].tagName).toBe('SPAN');
      expect(parent.childNodes[2].tagName).toBe('P');
    });

    /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；div 内仅含空 Fragment；firstChild 应为 null，验证空 Fragment 不留下占位宿主节点。 */
    itRenders('an empty fragment', async render => {
      expect(
        (
          await render(
            <div>
              <React.Fragment />
            </div>,
          )
        ).firstChild,
      ).toBe(null);
    });
  });
});
