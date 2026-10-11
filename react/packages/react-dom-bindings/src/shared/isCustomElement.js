/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/**
 * 根据连字符规则识别自定义元素，同时排除规范保留的 SVG/MathML 标签。
 * `props` 保留在签名中以匹配调用约定，当前判定仅依赖标签名。
 */
function isCustomElement(tagName: string, props: Object): boolean {
  if (tagName.indexOf('-') === -1) {
    return false;
  }
  switch (tagName) {
    // 排除由 SVG 与 MathML 保留、同样包含连字符的内建标签名。
    // https://html.spec.whatwg.org/multipage/custom-elements.html#custom-elements-core-concepts
    case 'annotation-xml':
    case 'color-profile':
    case 'font-face':
    case 'font-face-src':
    case 'font-face-uri':
    case 'font-face-format':
    case 'font-face-name':
    case 'missing-glyph':
      return false;
    default:
      return true;
  }
}

export default isCustomElement;
