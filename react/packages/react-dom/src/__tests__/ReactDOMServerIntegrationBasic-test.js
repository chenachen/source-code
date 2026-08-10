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

/** `TEXT_NODE_TYPE`：保存当前测试场景复用的夹具、状态或回调。 */
const TEXT_NODE_TYPE = 3;

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

describe('ReactDOMServerIntegration', () => {
  beforeEach(() => {
    resetModules();
  });

  describe('basic rendering', function () {
    /**
     * 代表场景（Given–When–Then）：
     * Given `itRenders` 把同一基础 fixture 展开为服务端字符串、客户端全新渲染及 hydration 场景；
     * When 渲染一个空 div；
     * Then 断言各模式都得到相同宿主节点结构。
     *
     * 验证机制：`ReactDOMServerIntegrationTestUtils.js` 驱动 `ReactDOMFizzServerNode.js` 与
     * `ReactDOMRoot.js` 的适配边界；完整 Fizz 状态机位于范围外的 `packages/react-server`。
     */
    itRenders('a blank div', async render => {
      const e = await render(<div />);
      expect(e.tagName).toBe('DIV');
    });

    itRenders('a self-closing tag', async render => {
      const e = await render(<br />);
      expect(e.tagName).toBe('BR');
    });

    itRenders('a self-closing tag as a child', async render => {
      const e = await render(
        <div>
          <br />
        </div>,
      );
      expect(e.childNodes.length).toBe(1);
      expect(e.firstChild.tagName).toBe('BR');
    });

    itRenders('a string', async render => {
      const e = await render('Hello');
      expect(e.nodeType).toBe(3);
      expect(e.nodeValue).toMatch('Hello');
    });

    itRenders('a number', async render => {
      const e = await render(42);
      expect(e.nodeType).toBe(3);
      expect(e.nodeValue).toMatch('42');
    });

    itRenders('a bigint', async render => {
      const e = await render(42n);
      expect(e.nodeType).toBe(3);
      expect(e.nodeValue).toMatch('42');
    });

    itRenders('an array with one child', async render => {
      const e = await render([<div key={1}>text1</div>]);
      const parent = e.parentNode;
      expect(parent.childNodes[0].tagName).toBe('DIV');
    });

    itRenders('an array with several children', async render => {
      /** `Header`：封装当前用例复用的操作、回调或断言步骤。 */
      const Header = props => {
        return <p>header</p>;
      };
      /** `Footer`：封装当前用例复用的操作、回调或断言步骤。 */
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

    itRenders('an iterable', async render => {
      const threeDivIterable = {
        /** `@@iterator`：封装当前用例复用的操作、回调或断言步骤。 */
        '@@iterator': function () {
          let i = 0;
          return {
            /** `@@iterator.next`：封装当前用例复用的操作、回调或断言步骤。 */
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

    itRenders('emptyish values', async render => {
      const e = await render(0);
      expect(e.nodeType).toBe(TEXT_NODE_TYPE);
      expect(e.nodeValue).toMatch('0');

      // 空字符串较特殊：客户端会渲染节点，而服务器返回空 HTML，因此这里比较父节点文本。
      // 的文字.
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
