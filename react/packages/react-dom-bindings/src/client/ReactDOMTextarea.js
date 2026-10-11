/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import isArray from 'shared/isArray';

import {getCurrentFiberOwnerNameInDevOrNull} from 'react-reconciler/src/ReactCurrentFiber';
import {getToStringValue, toString} from './ToStringValue';
import {disableTextareaChildren} from 'shared/ReactFeatureFlags';

import {track, trackHydrated} from './inputValueTracking';
import {queueChangeEvent} from '../events/ReactDOMEventReplaying';

let didWarnValDefaultVal = false;

/**
 * textarea 使用 value/defaultValue，而非把文本作为独立子 Fiber 管理。
 * value 非 null 时为受控模式，浏览器编辑在事件结束后按最终 props 恢复。
 * 初值按 value、defaultValue、旧 children、空字符串的优先级决定；children 用法已不推荐。
 */

/** 开发期警告 value/defaultValue 冲突，以及直接 children 的旧用法。 */
export function validateTextareaProps(element: Element, props: Object) {
  if (__DEV__) {
    if (
      props.value !== undefined &&
      props.defaultValue !== undefined &&
      !didWarnValDefaultVal
    ) {
      console.error(
        '%s contains a textarea with both value and defaultValue props. ' +
          'Textarea elements must be either controlled or uncontrolled ' +
          '(specify either the value prop, or the defaultValue prop, but not ' +
          'both). Decide between using a controlled or uncontrolled textarea ' +
          'and remove one of these props. More info: ' +
          'https://react.dev/link/controlled-components',
        getCurrentFiberOwnerNameInDevOrNull() || 'A component',
      );
      didWarnValDefaultVal = true;
    }
    if (props.children != null && props.value == null) {
      console.error(
        'Use the `defaultValue` or `value` props instead of setting ' +
          'children on <textarea>.',
      );
    }
  }
}

/** 受控 value 转字符串后仅在变化时写入，避免丢失选区；随后同步 defaultValue。 */
export function updateTextarea(
  element: Element,
  value: ?string,
  defaultValue: ?string,
) {
  const node: HTMLTextAreaElement = element as any;
  if (value != null) {
    //将 `value` 强制转换为字符串以确保值设置正确。虽然
    //浏览器通常会在必要时这样做，但 jsdom 不会。
    const newValue = toString(getToStringValue(value));
    //为了避免副作用（例如丢失文本选择），只有在值改变时才设置值
    if (newValue !== node.value) {
      node.value = newValue;
    }
    //TOOO：这应该遵守 disableInputAttributeSyncing 标志。
    if (defaultValue == null) {
      if (node.defaultValue !== newValue) {
        node.defaultValue = newValue;
      }
      return;
    }
  }
  if (defaultValue != null) {
    node.defaultValue = toString(getToStringValue(defaultValue));
  } else {
    node.defaultValue = '';
  }
}

/** 按 value、defaultValue、旧 children、空字符串优先级确定初值，写 defaultValue 并从有效 textContent 初始化 value。 */
export function initTextarea(
  element: Element,
  value: ?string,
  defaultValue: ?string,
  children: ?string,
) {
  const node: HTMLTextAreaElement = element as any;

  let initialValue = value;

  //只有在我们打算使用默认值时才去获取它
  if (initialValue == null) {
    if (children != null) {
      if (!disableTextareaChildren) {
        if (defaultValue != null) {
          throw new Error(
            'If you supply `defaultValue` on a <textarea>, do not pass children.',
          );
        }

        if (isArray(children)) {
          if (children.length > 1) {
            throw new Error('<textarea> can only have at most one child.');
          }

          children = children[0];
        }

        defaultValue = children;
      }
    }
    if (defaultValue == null) {
      defaultValue = '';
    }
    initialValue = defaultValue;
  }

  const stringValue = getToStringValue(initialValue);
  node.defaultValue = stringValue as any; //这将被转换为字符串。

  // 初始属性写入已提供 DOM 节点；读取 textContent 时仍处于离线组树阶段。
  const textContent = node.textContent;

  //只有当 textContent 等于预期时才设置 node.value
  //初始值。在 IE10/IE11 中存在一个占位符属性的错误
  //也将填充 textContent。
  //https://developer.microsoft.com/microsoft-edge/platform/issues/101525/
  // $FlowFixMe[invalid-compare]
  if (textContent === stringValue) {
    // $FlowFixMe[invalid-compare]
    if (textContent !== '' && textContent !== null) {
      node.value = textContent;
    }
  }

  track(element as any);
}

/** 保留当前 DOM value，用初始 props 建立 tracker 基线，检测到编辑则排队 hydration change。 */
export function hydrateTextarea(
  element: Element,
  value: ?string,
  defaultValue: ?string,
): void {
  const node: HTMLTextAreaElement = element as any;
  let initialValue = value;
  if (initialValue == null) {
    if (defaultValue == null) {
      defaultValue = '';
    }
    initialValue = defaultValue;
  }
  // 以初始 props 建立 tracker 基线，再与保留的 DOM 用户输入比较。
  const stringValue = toString(getToStringValue(initialValue));
  const changed = trackHydrated(node as any, stringValue, false);
  if (changed) {
    //如果当前值不同，这表明用户
    //在水合之前更改了它。排队重放更改事件。
    queueChangeEvent(node);
  }
}

/** 按最新 props 调用 updateTextarea，恢复受控 value。 */
export function restoreControlledTextareaState(
  element: Element,
  props: Object,
) {
  //DOM 组件仍然已挂载；更新
  updateTextarea(element, props.value, props.defaultValue);
}
