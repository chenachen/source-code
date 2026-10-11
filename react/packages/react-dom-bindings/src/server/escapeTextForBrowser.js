/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Based on the escape-html library, which is used under the MIT License below:
 *
 * Copyright (c) 2012-2013 TJ Holowaychuk
 * Copyright (c) 2015 Andreas Lubbe
 * Copyright (c) 2015 Tiancheng "Timothy" Gu
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * 'Software'), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
 * CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 * TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * @flow
 */

// 以下算法复制并修改自 escape-html。

import {checkHtmlStringCoercion} from 'shared/CheckStringCoercion';

/** 定位 HTML 文本中首个必须实体转义的字符。 */
const matchHtmlRegExp = /["'&<>]/;

/**
 * 将给定 HTML 文本中的引号、与号及尖括号转换为实体。
 * 先以字符串连接转换输入；DEV额外检查转换错误，不捕获或替换原异常。
 * 从首个特殊字符开始扫描，lastIndex保存未复制片段起点，只拼接间隔片段与实体；
 * 找不到特殊字符时返回转换后的字符串，避免实体结果的额外分配。
 */
function escapeHtml(string: string) {
  if (__DEV__) {
    checkHtmlStringCoercion(string);
  }
  const str = '' + string;
  const match = matchHtmlRegExp.exec(str);

  if (!match) {
    return str;
  }

  let escape;
  let html = '';
  let index;
  let lastIndex = 0;

  for (index = match.index; index < str.length; index++) {
    switch (str.charCodeAt(index)) {
      case 34: // "
        escape = '&quot;';
        break;
      case 38: // &
        escape = '&amp;';
        break;
      case 39: // '
        escape = '&#x27;'; // 相比 escape-html 从 '&#39' 改为十六进制实体。
        break;
      case 60: // <
        escape = '&lt;';
        break;
      case 62: // >
        escape = '&gt;';
        break;
      default:
        continue;
    }

    if (lastIndex !== index) {
      html += str.slice(lastIndex, index);
    }

    lastIndex = index + 1;
    html += escape;
  }

  return lastIndex !== index ? html + str.slice(lastIndex, index) : html;
}
// escape-html 派生算法到此结束。

/**
 * 为普通HTML文本和由调用方包上引号的属性值转义五类特殊字符。
 * 不负责script/style原始文本或URL协议检查，这些上下文由各自编码器处理。
 * boolean/number/bigint 不可能含 HTML 特殊字符，走直接字符串化的热路径。
 */
function escapeTextForBrowser(text: string | number | boolean): string {
  if (
    typeof text === 'boolean' ||
    typeof text === 'number' ||
    typeof text === 'bigint'
  ) {
    // 已知这些类型不含特殊字符；短路路径对频繁出现的数字 DOM id 尤其重要。
    return '' + (text as any);
  }
  return escapeHtml(text);
}

export default escapeTextForBrowser;
