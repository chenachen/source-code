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

  /** 同步 SSR 输出包含 head/script/meta/title 的完整 html；结果中 charset 与 title 可在 head 内调整顺序，但全部资源仍位于 html/head 之内，验证 legacy 字符串输出不会把提升资源放到 html 外。 */
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
