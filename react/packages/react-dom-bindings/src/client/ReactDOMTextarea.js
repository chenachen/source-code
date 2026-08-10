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
 * 实现一个 <textarea> 主机组件，该组件允许设置 `value` 和 `defaultValue`。这不同于传统的 DOM API，因为 value 通常是以 PCDATA 子元素的形式设置的。
 *
 * 如果未提供 `value`（或为 null/undefined），用户对 value 的操作将触发对该元素的更新。
 *
 * 如果提供了 `value`（且不为 null/undefined），渲染的元素将不会触发元素的更新。相反，必须更改 `value` 属性，渲染的元素才会被更新。
 *
 * 渲染的元素将初始化为空值，或者使用指定的 `defaultValue` 属性，或者使用子内容（已弃用）进行初始化。
 */

/** `validateTextareaProps` 校验输入并在开发环境报告不满足的不变量；用于初始化并同步 textarea 的受控值和默认内容。 */
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

/** `updateTextarea` 更新对应关联或宿主状态，并保持后续读取看到一致快照；用于初始化并同步 textarea 的受控值和默认内容。 */
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

/** `initTextarea` 执行该模块的单一职责，并把副作用限制在当前 DOM/Fiber 边界；用于初始化并同步 textarea 的受控值和默认内容。 */
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

  //这是在 postMount 中，因为我们需要访问 DOM 节点，而这是不可以的
  //可在组件挂载后使用。
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

/** `hydrateTextarea` 执行该模块的单一职责，并把副作用限制在当前 DOM/Fiber 边界；用于初始化并同步 textarea 的受控值和默认内容。 */
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
  //跟踪我们最后观察到的值，也就是已水合的值，所以
  //任何触发的更改事件都会在实际对象上触发 onChange
  //当前值。
  const stringValue = toString(getToStringValue(initialValue));
  const changed = trackHydrated(node as any, stringValue, false);
  if (changed) {
    //如果当前值不同，这表明用户
    //在水合之前更改了它。排队重放更改事件。
    queueChangeEvent(node);
  }
}

/** `restoreControlledTextareaState` 更新对应关联或宿主状态，并保持后续读取看到一致快照；用于初始化并同步 textarea 的受控值和默认内容。 */
export function restoreControlledTextareaState(
  element: Element,
  props: Object,
) {
  //DOM 组件仍然已挂载；更新
  updateTextarea(element, props.value, props.defaultValue);
}
