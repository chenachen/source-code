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

describe('ReactDOMServerIntegration', () => {
  beforeEach(() => {
    resetModules();
  });

  describe('React.Fragment', () => {
    /**
     * 代表场景（Given–When–Then）：
     * Given `itRenders` 以四类服务端/客户端组合执行 Fragment fixture；
     * When Fragment 只包含一个子节点；
     * Then 断言 Fragment 不引入额外 DOM 包装且 hydration 能复用标记。
     *
     * 验证机制：集成工具串联 react-dom server/client 适配边界并核对 DOM 身份；完整 Fizz 状态机位于
     * 范围外的 `packages/react-server`。
     */
    itRenders('a fragment with one child', async render => {
      const e = await render(
        <>
          <div>text1</div>
        </>,
      );
      const parent = e.parentNode;
      expect(parent.childNodes[0].tagName).toBe('DIV');
    });

    itRenders('a fragment with several children', async render => {
      /** `Header`：封装当前用例复用的操作、回调或断言步骤。 */
      const Header = props => {
        return <p>header</p>;
      };
      /** `Footer`：封装当前用例复用的操作、回调或断言步骤。 */
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
