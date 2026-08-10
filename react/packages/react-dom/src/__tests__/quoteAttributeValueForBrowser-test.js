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

describe('quoteAttributeValueForBrowser', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMServer = require('react-dom/server');
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「ampersand is escaped inside attributes」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('ampersand is escaped inside attributes', () => {
    const response = ReactDOMServer.renderToString(<img data-attr="&" />);
    expect(response).toMatch('<img data-attr="&amp;"/>');
  });

  /** 测试场景：验证「double quote is escaped inside attributes」描述的渲染、交互或错误处理结果。 */
  it('double quote is escaped inside attributes', () => {
    const response = ReactDOMServer.renderToString(<img data-attr={'"'} />);
    expect(response).toMatch('<img data-attr="&quot;"/>');
  });

  /** 测试场景：验证「single quote is escaped inside attributes」描述的渲染、交互或错误处理结果。 */
  it('single quote is escaped inside attributes', () => {
    const response = ReactDOMServer.renderToString(<img data-attr="'" />);
    expect(response).toMatch('<img data-attr="&#x27;"/>');
  });

  /** 测试场景：验证「greater than entity is escaped inside attributes」描述的渲染、交互或错误处理结果。 */
  it('greater than entity is escaped inside attributes', () => {
    const response = ReactDOMServer.renderToString(<img data-attr=">" />);
    expect(response).toMatch('<img data-attr="&gt;"/>');
  });

  /** 测试场景：验证「lower than entity is escaped inside attributes」描述的渲染、交互或错误处理结果。 */
  it('lower than entity is escaped inside attributes', () => {
    const response = ReactDOMServer.renderToString(<img data-attr="<" />);
    expect(response).toMatch('<img data-attr="&lt;"/>');
  });

  /** 测试场景：验证「number is escaped to string inside attributes」描述的渲染、交互或错误处理结果。 */
  it('number is escaped to string inside attributes', () => {
    const response = ReactDOMServer.renderToString(<img data-attr={42} />);
    expect(response).toMatch('<img data-attr="42"/>');
  });

  /** 测试场景：验证「object is passed to a string inside attributes」描述的渲染、交互或错误处理结果。 */
  it('object is passed to a string inside attributes', () => {
    const sampleObject = {
      /** `toString`：封装当前用例复用的操作、回调或断言步骤。 */
      toString: function () {
        return 'ponys';
      },
    };

    const response = ReactDOMServer.renderToString(
      <img data-attr={sampleObject} />,
    );
    expect(response).toMatch('<img data-attr="ponys"/>');
  });

  /** 测试场景：验证「script tag is escaped inside attributes」描述的渲染、交互或错误处理结果。 */
  it('script tag is escaped inside attributes', () => {
    const response = ReactDOMServer.renderToString(
      <img data-attr={'<script type=\'\' src=""></script>'} />,
    );
    expect(response).toMatch(
      '<img data-attr="&lt;script type=&#x27;&#x27; ' +
        'src=&quot;&quot;&gt;&lt;/script&gt;"/>',
    );
  });
});
