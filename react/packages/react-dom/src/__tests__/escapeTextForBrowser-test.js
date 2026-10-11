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

  /** 把单个 & 作为 span 文本执行同步 SSR；输出必须含 &amp;，验证实体起始符不能以原样文本进入 HTML。 */
  it('ampersand is escaped when passed as text content', () => {
    const response = ReactDOMServer.renderToString(<span>{'&'}</span>);
    expect(response).toMatch('<span>&amp;</span>');
  });

  /** 把双引号作为 span 文本执行同步 SSR；输出必须含 &quot;，验证文本编码统一转义引号。 */
  it('double quote is escaped when passed as text content', () => {
    const response = ReactDOMServer.renderToString(<span>{'"'}</span>);
    expect(response).toMatch('<span>&quot;</span>');
  });

  /** 把单引号作为 span 文本执行同步 SSR；输出必须含 &#x27;，验证引号字符被编码而不改变其文本含义。 */
  it('single quote is escaped when passed as text content', () => {
    const response = ReactDOMServer.renderToString(<span>{"'"}</span>);
    expect(response).toMatch('<span>&#x27;</span>');
  });

  /** 把 > 作为 span 文本执行同步 SSR；输出必须含 &gt;，验证闭合尖括号走 HTML 文本转义。 */
  it('greater than entity is escaped when passed as text content', () => {
    const response = ReactDOMServer.renderToString(<span>{'>'}</span>);
    expect(response).toMatch('<span>&gt;</span>');
  });

  /** 把 < 作为 span 文本执行同步 SSR；输出必须含 &lt;，验证文本不能开启新的 HTML 标签。 */
  it('lower than entity is escaped when passed as text content', () => {
    const response = ReactDOMServer.renderToString(<span>{'<'}</span>);
    expect(response).toMatch('<span>&lt;</span>');
  });

  /** 把数字 42 作为 span children 执行同步 SSR；输出文本应是 42，验证数值 children 的字符串化结果。 */
  it('number is correctly passed as text content', () => {
    const response = ReactDOMServer.renderToString(<span>{42}</span>);
    expect(response).toMatch('<span>42</span>');
  });

  /** 把数字 42 作为 img 的 data-attr 执行同步 SSR；结果应是带双引号的属性值 42，验证数字属性序列化。 */
  it('number is escaped to string when passed as text content', () => {
    const response = ReactDOMServer.renderToString(<img data-attr={42} />);
    expect(response).toMatch('<img data-attr="42"/>');
  });

  /** 把完整 script 标签字符串作为 span children 执行同步 SSR；尖括号及单双引号均应编码为实体，验证危险形状仍作为文本而非可执行标签输出。 */
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
