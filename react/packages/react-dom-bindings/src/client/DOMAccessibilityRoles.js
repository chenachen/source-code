/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

//下面的代码来源于 dom-accessibility-api

/** HTML 标签到默认 ARIA role 的静态映射；getImplicitRole 另处理 input、select 等分支，表内标签直接返回映射值。 */
const tagToRoleMappings = {
  ARTICLE: 'article',
  ASIDE: 'complementary',
  BODY: 'document',
  BUTTON: 'button',
  DATALIST: 'listbox',
  DD: 'definition',
  DETAILS: 'group',
  DIALOG: 'dialog',
  DT: 'term',
  FIELDSET: 'group',
  FIGURE: 'figure',
  // 规范要求具有可访问名称；当前映射不检查名称
  FORM: 'form',
  FOOTER: 'contentinfo',
  H1: 'heading',
  H2: 'heading',
  H3: 'heading',
  H4: 'heading',
  H5: 'heading',
  H6: 'heading',
  HEADER: 'banner',
  HR: 'separator',
  LEGEND: 'legend',
  LI: 'listitem',
  MATH: 'math',
  MAIN: 'main',
  MENU: 'list',
  NAV: 'navigation',
  OL: 'list',
  OPTGROUP: 'group',
  // 此处按标签直接匹配，未细分完整可访问性语境
  OPTION: 'option',
  OUTPUT: 'status',
  PROGRESS: 'progressbar',
  // 规范要求具有可访问名称；当前映射不检查名称的情况
  SECTION: 'region',
  SUMMARY: 'button',
  TABLE: 'table',
  TBODY: 'rowgroup',
  TEXTAREA: 'textbox',
  TFOOT: 'rowgroup',
  // 此处按标签直接匹配，未细分完整可访问性语境
  TD: 'cell',
  TH: 'columnheader',
  THEAD: 'rowgroup',
  TR: 'row',
  UL: 'list',
};

/** 结合标签及 input、a、img 等元素属性推导隐式 role；未识别时返回 null。 */
function getImplicitRole(element: Element): string | null {
  // $FlowFixMe[invalid-computed-prop]
  const mappedByTag = tagToRoleMappings[element.tagName];
  if (mappedByTag !== undefined) {
    return mappedByTag;
  }

  switch (element.tagName) {
    case 'A':
    case 'AREA':
    case 'LINK':
      if (element.hasAttribute('href')) {
        return 'link';
      }
      break;
    case 'IMG':
      if ((element.getAttribute('alt') || '').length > 0) {
        return 'img';
      }
      break;
    case 'INPUT': {
      const type = (element as any).type;
      switch (type) {
        case 'button':
        case 'image':
        case 'reset':
        case 'submit':
          return 'button';
        case 'checkbox':
        case 'radio':
          return type;
        case 'range':
          return 'slider';
        case 'email':
        case 'tel':
        case 'text':
        case 'url':
          if (element.hasAttribute('list')) {
            return 'combobox';
          }
          return 'textbox';
        case 'search':
          if (element.hasAttribute('list')) {
            return 'combobox';
          }
          return 'searchbox';
        default:
          return null;
      }
    }

    case 'SELECT':
      if (element.hasAttribute('multiple') || (element as any).size > 1) {
        return 'listbox';
      }
      return 'combobox';
  }

  return null;
}

/** 读取 role attribute，以空格拆成显式 role 列表；未提供时返回 null。 */
function getExplicitRoles(element: Element): Array<string> | null {
  const role = element.getAttribute('role');
  if (role) {
    return role.trim().split(' ');
  }

  return null;
}

//https://w3c.github.io/html-aria/#document-conformance-requirements-for-use-of-aria-attributes-in-html
/** 显式 role 列表命中则返回 true；未命中仍回退隐式 role，此实现不是完整 ARIA 优先级计算。 */
export function hasRole(element: Element, role: string): boolean {
  const explicitRoles = getExplicitRoles(element);
  if (explicitRoles !== null && explicitRoles.indexOf(role) >= 0) {
    return true;
  }

  return role === getImplicitRole(element);
}
