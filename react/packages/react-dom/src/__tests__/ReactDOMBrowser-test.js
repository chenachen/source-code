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

  /** 先加载 react-dom 并取得 browser() 值，随后才初始化 client renderer；组件在 Suspense 内 use 该值，提交结果应直接是 Browser，验证浏览器环境承诺可在 renderer 初始化前创建并在之后消费。 */
  it('can create browser-only content before the browser renderer is initialized', async () => {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const browserOnly = ReactDOM.browser();
    const ReactDOMClient = require('react-dom/client');
    const {act} = require('internal-test-utils');

    /** 消费在 client renderer 初始化前创建的 browser() 值，成功时输出 Browser；外层 Suspense 用于暴露错误的待定状态。 */
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
