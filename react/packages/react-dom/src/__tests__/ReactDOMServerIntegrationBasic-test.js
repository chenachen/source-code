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

/** DOM Text 的 nodeType 常量 3，用于区分数字 0 的实际文本节点与不产生节点的空子值。 */
const TEXT_NODE_TYPE = 3;

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

  describe('basic rendering', function () {
    /**
     * 代表场景（Given–When–Then）：
     * Given `itRenders` 把同一 fixture 展开为服务端字符串、服务端流、全新客户端、正确标记水合及错误标记恢复五种模式；
     * When 渲染一个空 div；
     * Then 断言各模式都得到相同宿主节点结构。
     *
     * 验证机制：`ReactDOMServerIntegrationTestUtils.js` 驱动 `ReactDOMFizzServerNode.js` 与
     * `ReactDOMRoot.js` 的适配边界。
     */
    /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；渲染空 div，返回 tagName 应为 DIV，验证基本宿主创建。 */
    itRenders('a blank div', async render => {
      const e = await render(<div />);
      expect(e.tagName).toBe('DIV');
    });

    /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；渲染独立 br，tagName 应为 BR，验证 void 标签输出。 */
    itRenders('a self-closing tag', async render => {
      const e = await render(<br />);
      expect(e.tagName).toBe('BR');
    });

    /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；div 内含 br；只有一个子级且为 BR，验证 void 标签的嵌套解析。 */
    itRenders('a self-closing tag as a child', async render => {
      const e = await render(
        <div>
          <br />
        </div>,
      );
      expect(e.childNodes.length).toBe(1);
      expect(e.firstChild.tagName).toBe('BR');
    });

    /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；直接渲染 Hello 字符串；返回 Text 节点且 nodeValue 含 Hello，验证根文本输出。 */
    itRenders('a string', async render => {
      const e = await render('Hello');
      expect(e.nodeType).toBe(3);
      expect(e.nodeValue).toMatch('Hello');
    });

    /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；直接渲染数字 42；返回 Text 节点且 nodeValue 含 42，验证数字转根文本。 */
    itRenders('a number', async render => {
      const e = await render(42);
      expect(e.nodeType).toBe(3);
      expect(e.nodeValue).toMatch('42');
    });

    /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；直接渲染 bigint 42n；返回 Text 节点且 nodeValue 含 42，验证 bigint 根文本支持。 */
    itRenders('a bigint', async render => {
      const e = await render(42n);
      expect(e.nodeType).toBe(3);
      expect(e.nodeValue).toMatch('42');
    });

    /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；根输入为仅含 key=1 div 的数组；父容器首子级 DIV，验证数组本身不增加包装。 */
    itRenders('an array with one child', async render => {
      const e = await render([<div key={1}>text1</div>]);
      const parent = e.parentNode;
      expect(parent.childNodes[0].tagName).toBe('DIV');
    });

    /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；数组含 div/span/Header/返回数组的 Footer；父容器按 DIV/SPAN/P/H2/H3 排列，验证多返回节点与组件结果展开。 */
    itRenders('an array with several children', async render => {

      /** 返回单个 header 文本的 p，为父级展开后的第三个宿主子级提供组件边界。 */
      const Header = props => {
        return <p>header</p>;
      };

      /** 返回 footer 的 h2 与 about 的 h3 两个宿主节点，检测包装组件结果是否保持相邻顺序。 */
      const Footer = props => {
        return [<h2 key={1}>footer</h2>, <h3 key={2}>about</h3>];
      };
      const e = await render([
        <div key={1}>text1</div>,
        <span key={2}>text2</span>,
        <Header key={3} />,
        <Footer key={4} />,
      ]);
      const parent = e.parentNode;
      expect(parent.childNodes[0].tagName).toBe('DIV');
      expect(parent.childNodes[1].tagName).toBe('SPAN');
      expect(parent.childNodes[2].tagName).toBe('P');
      expect(parent.childNodes[3].tagName).toBe('H2');
      expect(parent.childNodes[4].tagName).toBe('H3');
    });

    /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；多层数组混有 null/false/undefined 与 div/span/p；父容器只含 DIV/SPAN/P，验证嵌套展开和空值剔除。 */
    itRenders('a nested array', async render => {
      const e = await render([
        [<div key={1}>text1</div>],
        <span key={1}>text2</span>,
        [[[null, <p key={1} />], false]],
      ]);
      const parent = e.parentNode;
      expect(parent.childNodes[0].tagName).toBe('DIV');
      expect(parent.childNodes[1].tagName).toBe('SPAN');
      expect(parent.childNodes[2].tagName).toBe('P');
    });

    /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；对象 @@iterator 按次产生三个 keyed div 后 done=true；容器恰有三个 DIV，验证通用 iterable 的迭代终止与宿主展开。 */
    itRenders('an iterable', async render => {
      const threeDivIterable = {

        /** 每次调用从 i=0 新建迭代器；使用旧式 @@iterator 协议提供三个带 key 的 div。 */
        '@@iterator': function () {
          let i = 0;
          return {

            /** 先递增 i并在前三次返回 done=false 的 keyed div，第四次起返回 done=true，验证 renderer 遵循迭代结束标志。 */
            next: function () {
              if (i++ < 3) {
                return {value: <div key={i} />, done: false};
              } else {
                return {value: undefined, done: true};
              }
            },
          };
        },
      };
      const e = await render(threeDivIterable);
      const parent = e.parentNode;
      expect(parent.childNodes.length).toBe(3);
      expect(parent.childNodes[0].tagName).toBe('DIV');
      expect(parent.childNodes[1].tagName).toBe('DIV');
      expect(parent.childNodes[2].tagName).toBe('DIV');
    });

    /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；比较 0、空字符串、空数组、布尔和嵌套空值；0 是 Text，空字符串所在 div 文本空，其余不创建节点；undefined 传入预期一个诊断，覆盖 hydrateRoot 缺初始 children 的 DEV 检查。 */
    itRenders('emptyish values', async render => {
      const e = await render(0);
      expect(e.nodeType).toBe(TEXT_NODE_TYPE);
      expect(e.nodeValue).toMatch('0');

      // 空字符串不创建文本节点；这里把它放在 div 内，比较父节点的空 textContent。
      expect((await render(<div>{''}</div>)).textContent).toBe('');

      expect(await render([])).toBe(null);
      expect(await render(false)).toBe(null);
      expect(await render(true)).toBe(null);
      expect(await render([[[false]], undefined])).toBe(null);

      // 在 undefined 子元素上发生 hydrateRoot 错误。
      expect(await render(undefined, 1)).toBe(null);
    });
  });
});
