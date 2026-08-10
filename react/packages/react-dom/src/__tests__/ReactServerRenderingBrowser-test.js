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

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「returns the same results as react-dom/server」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言覆盖 react-dom 的服务端流适配层；完整 Fizz 状态机位于 react-server。
   */
  it('returns the same results as react-dom/server', () => {
    /** `Nice`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Nice extends React.Component {
      /** `Nice.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <h2>I am feeling very good today, thanks, how are you?</h2>;
      }
    }
    /** `Greeting`：封装当前用例复用的操作、回调或断言步骤。 */
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
