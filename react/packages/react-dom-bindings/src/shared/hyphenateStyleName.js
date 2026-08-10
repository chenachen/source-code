/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** 捕获 camelCase CSS 名称中的每个大写字母，以便插入连字符。 */
const uppercasePattern = /([A-Z])/g;
/** 识别转小写后位于开头的微软厂商前缀。 */
const msPattern = /^ms-/;

/**
 * 将 camelCase CSS 属性名转换为连字符形式，例如：
 *
 *   > hyphenateStyleName('backgroundColor')
 *   < "background-color"
 *   > hyphenateStyleName('MozTransition')
 *   < "-moz-transition"
 *   > hyphenateStyleName('msTransition')
 *   < "-ms-transition"
 *
 * 按 Modernizr 的约定（http://modernizr.com/docs/#prefixed），`ms` 前缀需转换为 `-ms-`。
 */
export default function hyphenateStyleName(name: string): string {
  return name
    .replace(uppercasePattern, '-$1')
    .toLowerCase()
    .replace(msPattern, '-ms-');
}
