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

/** 识别 button、input、select、textarea 四类原生交互元素。 */
function isInteractive(tag: string): boolean {
  return (
    tag === 'button' ||
    tag === 'input' ||
    tag === 'select' ||
    tag === 'textarea'
  );
}

/** 仅对指定鼠标 handler 过滤 disabled 的原生交互元素。 */
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
/**
 * 从 Fiber.stateNode 的最新 props 缓存读取 handler，不读可能正在构建的 Fiber.memoizedProps。
 * 无 DOM/props 关联或禁用控件的指定鼠标事件返回 null；truthy 的非函数值抛错，falsy 值由监听累积路径跳过。
 */
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
