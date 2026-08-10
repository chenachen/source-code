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
/** supportedInputTypes 保存判断元素是否具备可编辑文本选择语义所需的稳定常量、注册表或模块级状态；其身份和值在一次页面生命周期内共享。；key 描述判断元素是否具备可编辑文本选择语义的数据字段；该字段限定跨插件、队列或原生事件传递的状态边界。 */
const supportedInputTypes: {
  /** key 是 Flow 索引签名的键名，仅描述任意宿主属性，不会在运行时生成字段。 */
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

/** isTextInputElement 判断判断元素是否具备可编辑文本选择语义的前置条件；返回值用于在热路径提前跳过不适用分支。 */
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
