/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

describe('ReactDOM.browser', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  // @gate enableBrowserAPI
  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「can create browser-only content before the browser renderer is initialized」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('can create browser-only content before the browser renderer is initialized', async () => {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const browserOnly = ReactDOM.browser();
    const ReactDOMClient = require('react-dom/client');
    const {act} = require('internal-test-utils');

    /** `BrowserOnly`：封装当前用例复用的操作、回调或断言步骤。 */
    function BrowserOnly() {
      React.use(browserOnly);
      return <span>Browser</span>;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <React.Suspense fallback={<span>Fallback</span>}>
          <BrowserOnly />
        </React.Suspense>,
      );
    });
    expect(container.innerHTML).toBe('<span>Browser</span>');
  });
});
