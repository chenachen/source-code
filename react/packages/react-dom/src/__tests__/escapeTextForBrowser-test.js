/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let React;
let ReactDOMServer;

describe('escapeTextForBrowser', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMServer = require('react-dom/server');
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「ampersand is escaped when passed as text content」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('ampersand is escaped when passed as text content', () => {
    const response = ReactDOMServer.renderToString(<span>{'&'}</span>);
    expect(response).toMatch('<span>&amp;</span>');
  });

  /** 测试场景：验证「double quote is escaped when passed as text content」描述的渲染、交互或错误处理结果。 */
  it('double quote is escaped when passed as text content', () => {
    const response = ReactDOMServer.renderToString(<span>{'"'}</span>);
    expect(response).toMatch('<span>&quot;</span>');
  });

  /** 测试场景：验证「single quote is escaped when passed as text content」描述的渲染、交互或错误处理结果。 */
  it('single quote is escaped when passed as text content', () => {
    const response = ReactDOMServer.renderToString(<span>{"'"}</span>);
    expect(response).toMatch('<span>&#x27;</span>');
  });

  /** 测试场景：验证「greater than entity is escaped when passed as text content」描述的渲染、交互或错误处理结果。 */
  it('greater than entity is escaped when passed as text content', () => {
    const response = ReactDOMServer.renderToString(<span>{'>'}</span>);
    expect(response).toMatch('<span>&gt;</span>');
  });

  /** 测试场景：验证「lower than entity is escaped when passed as text content」描述的渲染、交互或错误处理结果。 */
  it('lower than entity is escaped when passed as text content', () => {
    const response = ReactDOMServer.renderToString(<span>{'<'}</span>);
    expect(response).toMatch('<span>&lt;</span>');
  });

  /** 测试场景：验证「number is correctly passed as text content」描述的渲染、交互或错误处理结果。 */
  it('number is correctly passed as text content', () => {
    const response = ReactDOMServer.renderToString(<span>{42}</span>);
    expect(response).toMatch('<span>42</span>');
  });

  /** 测试场景：验证「number is escaped to string when passed as text content」描述的渲染、交互或错误处理结果。 */
  it('number is escaped to string when passed as text content', () => {
    const response = ReactDOMServer.renderToString(<img data-attr={42} />);
    expect(response).toMatch('<img data-attr="42"/>');
  });

  /** 测试场景：验证「escape text content representing a script tag」描述的渲染、交互或错误处理结果。 */
  it('escape text content representing a script tag', () => {
    const response = ReactDOMServer.renderToString(
      <span>{'<script type=\'\' src=""></script>'}</span>,
    );
    expect(response).toMatch(
      '<span>&lt;script type=&#x27;&#x27; ' +
        'src=&quot;&quot;&gt;&lt;/script&gt;</span>',
    );
  });
});
