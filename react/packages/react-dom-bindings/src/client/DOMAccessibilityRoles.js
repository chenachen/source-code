/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

//下面的代码来源于 dom-accessibility-api

/** `tagToRoleMappings` 保存按宿主标签和属性推导可访问性角色所需的共享索引、配置或模块级状态；生命周期覆盖当前 renderer。 */
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
  //警告：仅限具有可访问名称
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
  //警告：仅在特定情况下
  OPTION: 'option',
  OUTPUT: 'status',
  PROGRESS: 'progressbar',
  //警告：仅限具有可访问名称的情况
  SECTION: 'region',
  SUMMARY: 'button',
  TABLE: 'table',
  TBODY: 'rowgroup',
  TEXTAREA: 'textbox',
  TFOOT: 'rowgroup',
  //警告：仅在特定情况下
  TD: 'cell',
  TH: 'columnheader',
  THEAD: 'rowgroup',
  TR: 'row',
  UL: 'list',
};

/** `getImplicitRole` 查询所需宿主值；无匹配时走显式回退；用于按宿主标签和属性推导可访问性角色。 */
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

/** `getExplicitRoles` 查询所需宿主值；无匹配时走显式回退；用于按宿主标签和属性推导可访问性角色。 */
function getExplicitRoles(element: Element): Array<string> | null {
  const role = element.getAttribute('role');
  if (role) {
    return role.trim().split(' ');
  }

  return null;
}

//https://w3c.github.io/html-aria/#document-conformance-requirements-for-use-of-aria-attributes-in-html
/** `hasRole` 判断适用条件并返回只读结果；用于按宿主标签和属性推导可访问性角色。 */
export function hasRole(element: Element, role: string): boolean {
  const explicitRoles = getExplicitRoles(element);
  if (explicitRoles !== null && explicitRoles.indexOf(role) >= 0) {
    return true;
  }

  return role === getImplicitRole(element);
}
