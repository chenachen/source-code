/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/**
 * 可编辑 input type 的规范参考。
 *
 * @see http://www.whatwg.org/specs/web-apps/current-work/multipage/the-input-element.html#input-type-attr-summary
 */
/** ChangeEventPlugin 支持的 input type 集合。 */
const supportedInputTypes: {
  /** input.type 到可使用输入值 change 检测的标记；名单外类型返回 undefined。 */
  [key: string]: true | void, ...} = {
  color: true,
  date: true,
  datetime: true,
  'datetime-local': true,
  email: true,
  month: true,
  number: true,
  password: true,
  range: true,
  search: true,
  tel: true,
  text: true,
  time: true,
  url: true,
  week: true,
};

/** 判断节点是否为受支持的 input 类型或 textarea。 */
function isTextInputElement(elem: ?HTMLElement): boolean {
  const nodeName = elem && elem.nodeName && elem.nodeName.toLowerCase();

  if (nodeName === 'input') {
    return !!supportedInputTypes[(elem as any as HTMLInputElement).type];
  }

  if (nodeName === 'textarea') {
    return true;
  }

  return false;
}

export default isTextInputElement;
