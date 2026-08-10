/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

//在将用户输入传入 querySelector(All) 时，嵌入的字符串不能被修改
//查询的语义。当我们知道...时，这个转义函数是安全使用的
//提供的值将作为属性选择器的一部分被用双引号括起来
//不要在其他地方使用它
//我们转义双引号和反斜杠
const escapeSelectorAttributeValueInsideDoubleQuotesRegex = /[\n\"\\]/g;
/** `escapeSelectorAttributeValueInsideDoubleQuotes` 执行该模块的单一职责，并把副作用限制在当前 DOM/Fiber 边界；用于把属性值转义为双引号 CSS 选择器片段。 */
export default function escapeSelectorAttributeValueInsideDoubleQuotes(
  value: string,
): string {
  return value.replace(
    escapeSelectorAttributeValueInsideDoubleQuotesRegex,
    ch => '\\' + ch.charCodeAt(0).toString(16) + ' ',
  );
}
