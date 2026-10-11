/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

'use strict';

let React;
let ReactDOMServer;
let ReactDOMServerBrowser;

describe('ReactServerRenderingBrowser', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMServer = require('react-dom/server');
// 为 npm 中原本会成为两个独立 bundle 的代码提供额外隔离。
    jest.resetModules();
    ReactDOMServerBrowser = require('react-dom/server.browser');
  });

  /** 分别隔离加载 server 与 server.browser bundle，对含函数组件和类组件的同一 Greeting 树执行 renderToString 与 renderToStaticMarkup；两种入口的对应字符串必须相等，验证浏览器同步 SSR 编码与通用入口一致。 */
  it('returns the same results as react-dom/server', () => {
    /** 提供 Greeting 内部的类组件叶节点，使两个 SSR 入口同时覆盖类组件渲染。 */
    class Nice extends React.Component {
      /** 输出固定 h2 文本，作为跨 bundle SSR 字符串相等比较的一部分。 */
      render() {
        return <h2>I am feeling very good today, thanks, how are you?</h2>;
      }
    }
    /** 组合 h1 与 Nice 类组件，向两个同步 SSR 编码入口提供完全相同的树。 */
    function Greeting() {
      return (
        <div>
          <h1>How are you?</h1>
          <Nice />
        </div>
      );
    }
    expect(ReactDOMServerBrowser.renderToString(<Greeting />)).toEqual(
      ReactDOMServer.renderToString(<Greeting />),
    );
    expect(ReactDOMServerBrowser.renderToStaticMarkup(<Greeting />)).toEqual(
      ReactDOMServer.renderToStaticMarkup(<Greeting />),
    );
  });
});
