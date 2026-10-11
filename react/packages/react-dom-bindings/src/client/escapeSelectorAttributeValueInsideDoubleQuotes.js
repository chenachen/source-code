/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** 匹配双引号CSS属性选择器值中的换行、双引号和反斜杠，替换为带终止空格的十六进制转义，防止值改变选择器结构；不用于完整CSS标识符。 */
const escapeSelectorAttributeValueInsideDoubleQuotesRegex = /[\n\"\\]/g;
/** 转义反斜杠、双引号与换行，只可嵌入双引号包裹的 CSS 属性选择器值。 */
export default function escapeSelectorAttributeValueInsideDoubleQuotes(
  value: string,
): string {
  return value.replace(
    escapeSelectorAttributeValueInsideDoubleQuotesRegex,
    ch => '\\' + ch.charCodeAt(0).toString(16) + ' ',
  );
}
