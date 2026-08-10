/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 * @flow
 */

import type {Fiber} from 'react-reconciler/src/ReactInternalTypes';
import type {Props} from '../client/ReactFiberConfigDOM';

import {getFiberCurrentPropsFromNode} from '../client/ReactDOMComponentTree';

/** isInteractive 判断从 Fiber 当前 props 读取 registration listener，并按禁用交互元素规则过滤的前置条件；返回值用于在热路径提前跳过不适用分支。 */
function isInteractive(tag: string): boolean {
  return (
    tag === 'button' ||
    tag === 'input' ||
    tag === 'select' ||
    tag === 'textarea'
  );
}

/** shouldPreventMouseEvent 判断从 Fiber 当前 props 读取 registration listener，并按禁用交互元素规则过滤的前置条件；返回值用于在热路径提前跳过不适用分支。 */
function shouldPreventMouseEvent(
  name: string,
  type: string,
  props: Props,
): boolean {
  switch (name) {
    case 'onClick':
    case 'onClickCapture':
    case 'onDoubleClick':
    case 'onDoubleClickCapture':
    case 'onMouseDown':
    case 'onMouseDownCapture':
    case 'onMouseMove':
    case 'onMouseMoveCapture':
    case 'onMouseUp':
    case 'onMouseUpCapture':
    case 'onMouseEnter':
      return !!(props.disabled && isInteractive(type));
    default:
      return false;
  }
}

/**
 * @param {object} inst 作为事件来源的 Fiber 实例。
 * @param {string} registrationName listener 名称，例如 `onClick`。
 * @return {?function} 已存储的 callback。
 */
/** getListener 查询并返回从 Fiber 当前 props 读取 registration listener，并按禁用交互元素规则过滤所需状态；无匹配时使用 null/默认值而不修改事件队列。 */
export default function getListener(
  inst: Fiber,
  registrationName: string,
): Function | null {
  const stateNode = inst.stateNode;
  if (stateNode === null) {
    // Fiber 仍在构建中，例如增量模式下的 onload 事件。
    return null;
  }
  const props = getFiberCurrentPropsFromNode(stateNode);
  if (props === null) {
    // Fiber 仍在构建中。
    return null;
  }
  // $FlowFixMe[invalid-computed-prop]
  const listener = props[registrationName];
  if (shouldPreventMouseEvent(registrationName, inst.type, props)) {
    return null;
  }

  if (listener && typeof listener !== 'function') {
    throw new Error(
      `Expected \`${registrationName}\` listener to be a function, instead got a value of \`${typeof listener}\` type.`,
    );
  }

  return listener;
}
