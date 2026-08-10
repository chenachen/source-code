/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {checkFormFieldValueStringCoercion} from 'shared/CheckStringCoercion';

/** `ValueTracker` 定义跟踪表单控件值并识别用户态变化使用的数据契约；字段共同限定所有权、生命周期与跨模块传递边界。 */
type ValueTracker = {
  /** `ValueTracker.getValue` 约定跟踪表单控件值并识别用户态变化的可调用能力；实现必须保持参数所有权与宿主副作用边界。 */
  getValue(): string,
  /** `ValueTracker.setValue` 约定跟踪表单控件值并识别用户态变化的可调用能力；实现必须保持参数所有权与宿主副作用边界。 */
  setValue(value: string): void,
  /** `ValueTracker.stopTracking` 约定跟踪表单控件值并识别用户态变化的可调用能力；实现必须保持参数所有权与宿主副作用边界。 */
  stopTracking(): void,
};
/** `ElementWithValueTracker` 定义跟踪表单控件值并识别用户态变化使用的数据契约；字段共同限定所有权、生命周期与跨模块传递边界。 */
interface ElementWithValueTracker extends HTMLInputElement {
  /** `ElementWithValueTracker._valueTracker` 表示受控表单值及其默认值边界；仅用于跟踪表单控件值并识别用户态变化。 */
  _valueTracker?: ?ValueTracker;
}

/** `isCheckable` 判断适用条件并返回布尔结果，不写入宿主状态；用于跟踪表单控件值并识别用户态变化。 */
function isCheckable(elem: HTMLInputElement) {
  const type = elem.type;
  const nodeName = elem.nodeName;
  return (
    nodeName &&
    nodeName.toLowerCase() === 'input' &&
    (type === 'checkbox' || type === 'radio')
  );
}

/** `getTracker` 查询并返回所需值；缺失或不适用时走显式回退；用于跟踪表单控件值并识别用户态变化。 */
function getTracker(node: ElementWithValueTracker) {
  return node._valueTracker;
}

/** `detachTracker` 更新对应关联或宿主状态，并保持后续读取看到一致快照；用于跟踪表单控件值并识别用户态变化。 */
function detachTracker(node: ElementWithValueTracker) {
  node._valueTracker = null;
}

/** `getValueFromNode` 查询并返回所需值；缺失或不适用时走显式回退；用于跟踪表单控件值并识别用户态变化。 */
function getValueFromNode(node: HTMLInputElement): string {
  let value = '';
  if (!node) {
    return value;
  }

  if (isCheckable(node)) {
    value = node.checked ? 'true' : 'false';
  } else {
    value = node.value;
  }

  return value;
}

/** `trackValueOnNode` 更新对应关联或宿主状态，并保持后续读取看到一致快照；用于跟踪表单控件值并识别用户态变化。 */
function trackValueOnNode(
  node: any,
  valueField: 'checked' | 'value',
  currentValue: string,
): ?ValueTracker {
  const descriptor = Object.getOwnPropertyDescriptor(
    node.constructor.prototype,
    valueField,
  );

  //如果有人已经定义了一个值或 Safari，则退出
  //并且不跟踪数值将导致变化被过度报告，
  //但这比彻底失败要好
  //(某些测试需要，用于 spyOn 输入值和 Safari)
  if (
    node.hasOwnProperty(valueField) ||
    typeof descriptor === 'undefined' ||
    typeof descriptor.get !== 'function' ||
    typeof descriptor.set !== 'function'
  ) {
    return;
  }
  const {get, set} = descriptor;
  Object.defineProperty(node, valueField, {
    configurable: true,
    // $FlowFixMe[missing-this-annot]
    /** `trackValueOnNode.get` 查询并返回所需值；缺失或不适用时走显式回退；用于跟踪表单控件值并识别用户态变化。 */
    get: function () {
      return get.call(this);
    },
    // $FlowFixMe[missing-local-annot]
    // $FlowFixMe[missing-this-annot]
    /** `trackValueOnNode.set` 更新对应关联或宿主状态，并保持后续读取看到一致快照；用于跟踪表单控件值并识别用户态变化。 */
    set: function (value) {
      if (__DEV__) {
        checkFormFieldValueStringCoercion(value);
      }
      currentValue = '' + value;
      set.call(this, value);
    },
  });
  //我们第一次就本可以通过这个
  //但它会在 IE11 和 Edge 14/15 中触发一个错误。
  //再次调用 defineProperty() 应该是等效的。
  //https://github.com/facebook/react/issues/11768
  Object.defineProperty(node, valueField, {
    enumerable: descriptor.enumerable,
  });

  const tracker = {
    /** `trackValueOnNode.getValue` 查询并返回所需值；缺失或不适用时走显式回退；用于跟踪表单控件值并识别用户态变化。 */
    getValue() {
      return currentValue;
    },
    /** `trackValueOnNode.setValue` 更新对应关联或宿主状态，并保持后续读取看到一致快照；用于跟踪表单控件值并识别用户态变化。 */
    setValue(value: string) {
      if (__DEV__) {
        checkFormFieldValueStringCoercion(value);
      }
      currentValue = '' + value;
    },
    /** `trackValueOnNode.stopTracking` 清理对应状态或关联，重复清理保持安全；用于跟踪表单控件值并识别用户态变化。 */
    stopTracking() {
      detachTracker(node);
      delete node[valueField];
    },
  };
  return tracker;
}

/** `track` 更新对应关联或宿主状态，并保持后续读取看到一致快照；用于跟踪表单控件值并识别用户态变化。 */
export function track(node: ElementWithValueTracker) {
  if (getTracker(node)) {
    return;
  }

  const valueField = isCheckable(node) ? 'checked' : 'value';
  //这是从 DOM 中读取的，所以强制转换总是安全的。我们真的不应该
  //根本没有被强制转换为字符串。这只是历史原因。
  // eslint-disable-next-line react-internal/safe-string-coercion
  const initialValue = '' + (node[valueField] as any);
  node._valueTracker = trackValueOnNode(node, valueField, initialValue);
}

/** `trackHydrated` 更新对应关联或宿主状态，并保持后续读取看到一致快照；用于跟踪表单控件值并识别用户态变化。 */
export function trackHydrated(
  node: ElementWithValueTracker,
  initialValue: string,
  initialChecked: boolean,
): boolean {
  //对于水合，初始值不是当前值而是该值
  //这是我们最后观察到的，也是最初服务器渲染时的情况。
  if (getTracker(node)) {
    return false;
  }

  let valueField: 'checked' | 'value';
  let expectedValue;
  if (isCheckable(node)) {
    valueField = 'checked';
    // eslint-disable-next-line react-internal/safe-string-coercion
    expectedValue = '' + (initialChecked as any);
  } else {
    valueField = 'value';
    expectedValue = initialValue;
  }
  const currentValue =
    // eslint-disable-next-line react-internal/safe-string-coercion
    '' + // $FlowFixMe[prop-missing]
    (node[valueField] as any);
  node._valueTracker = trackValueOnNode(node, valueField, expectedValue);
  return currentValue !== expectedValue;
}

/** `updateValueIfChanged` 更新对应关联或宿主状态，并保持后续读取看到一致快照；用于跟踪表单控件值并识别用户态变化。 */
export function updateValueIfChanged(node: ElementWithValueTracker): boolean {
  if (!node) {
    return false;
  }

  const tracker = getTracker(node);
  //如果此时没有追踪器，那就不太可能
  //再次尝试将会成功
  if (!tracker) {
    return true;
  }

  const lastValue = tracker.getValue();
  const nextValue = getValueFromNode(node);
  if (nextValue !== lastValue) {
    tracker.setValue(nextValue);
    return true;
  }
  return false;
}

/** `stopTracking` 清理对应状态或关联，重复清理保持安全；用于跟踪表单控件值并识别用户态变化。 */
export function stopTracking(node: ElementWithValueTracker) {
  const tracker = getTracker(node);
  if (tracker) {
    tracker.stopTracking();
  }
}
