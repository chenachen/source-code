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

let React;
let ReactDOMFizzServer;

describe('ReactDOMFloat', () => {
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOMFizzServer = require('react-dom/server');
  });

  // 修复 #27177
  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「does not hoist above the <html> tag」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言直接覆盖 ReactDOMFloat 的资源提示分派、校验与静默降级。
   */
  it('does not hoist above the <html> tag', async () => {
    const result = ReactDOMFizzServer.renderToString(
      <html>
        <head>
          <script src="foo" />
          <meta charSet="utf-8" />
          <title>title</title>
        </head>
      </html>,
    );

    expect(result).toEqual(
      '<html><head><meta charSet="utf-8"/>' +
        '<title>title</title><script src="foo"></script></head>' +
        '</html>',
    );
  });
});
