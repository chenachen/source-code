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

  /** img 的 data-attr 输入 &，同步 SSR 应输出双引号包裹的 &amp;，验证属性值实体起始符转义。 */
  it('ampersand is escaped inside attributes', () => {
    const response = ReactDOMServer.renderToString(<img data-attr="&" />);
    expect(response).toMatch('<img data-attr="&amp;"/>');
  });

  /** img 的 data-attr 输入双引号，同步 SSR 应输出 &quot;，验证用户值不能闭合属性边界。 */
  it('double quote is escaped inside attributes', () => {
    const response = ReactDOMServer.renderToString(<img data-attr={'"'} />);
    expect(response).toMatch('<img data-attr="&quot;"/>');
  });

  /** img 的 data-attr 输入单引号，同步 SSR 应输出 &#x27;，验证属性序列化的统一引号转义规则。 */
  it('single quote is escaped inside attributes', () => {
    const response = ReactDOMServer.renderToString(<img data-attr="'" />);
    expect(response).toMatch('<img data-attr="&#x27;"/>');
  });

  /** img 的 data-attr 输入 >，同步 SSR 应输出 &gt;，验证属性值中的尖括号编码。 */
  it('greater than entity is escaped inside attributes', () => {
    const response = ReactDOMServer.renderToString(<img data-attr=">" />);
    expect(response).toMatch('<img data-attr="&gt;"/>');
  });

  /** img 的 data-attr 输入 <，同步 SSR 应输出 &lt;，验证属性内容不能被解释为新标签。 */
  it('lower than entity is escaped inside attributes', () => {
    const response = ReactDOMServer.renderToString(<img data-attr="<" />);
    expect(response).toMatch('<img data-attr="&lt;"/>');
  });

  /** img 的 data-attr 输入数字 42，同步 SSR 应输出字符串属性值 "42"，验证数值属性转换。 */
  it('number is escaped to string inside attributes', () => {
    const response = ReactDOMServer.renderToString(<img data-attr={42} />);
    expect(response).toMatch('<img data-attr="42"/>');
  });

  /** img 的 data-attr 输入自定义 toString 返回 ponys 的对象；同步 SSR 应写 ponys，验证属性值先执行字符串转换再编码。 */
  it('object is passed to a string inside attributes', () => {
    const sampleObject = {

      /** 为非字符串属性值提供固定转换结果 ponys，检查 SSR 是否调用对象转换并输出该文本。 */
      toString: function () {
        return 'ponys';
      },
    };

    const response = ReactDOMServer.renderToString(
      <img data-attr={sampleObject} />,
    );
    expect(response).toMatch('<img data-attr="ponys"/>');
  });

  /** img 的 data-attr 输入含单双引号的完整 script 字符串；输出中所有引号与尖括号必须编码，验证该字符串留在单一属性值内。 */
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
