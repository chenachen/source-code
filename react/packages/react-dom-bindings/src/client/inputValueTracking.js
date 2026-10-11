/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {checkFormFieldValueStringCoercion} from 'shared/CheckStringCoercion';

/** 记录 input 的 value 或 checked 的已观察字符串，并提供解除属性拦截能力。 */
type ValueTracker = {
  /** 读取已观察值，不重新读 DOM。 */
  getValue(): string,
  /** 更新已观察值基线。 */
  setValue(value: string): void,
  /** 解除节点与 tracker 关联，并移除节点自有的属性拦截。 */
  stopTracking(): void,
};
/** 附有 React 值跟踪器的 input/textarea DOM 节点。 */
interface ElementWithValueTracker extends HTMLInputElement {
  /** 节点当前的值跟踪器；停止跟踪后置 null。 */
  _valueTracker?: ?ValueTracker;
}

/** checkbox/radio 跟踪 checked，其他控件跟踪 value。 */
function isCheckable(elem: HTMLInputElement) {
  const type = elem.type;
  const nodeName = elem.nodeName;
  return (
    nodeName &&
    nodeName.toLowerCase() === 'input' &&
    (type === 'checkbox' || type === 'radio')
  );
}

/** 读取节点已经安装的值跟踪器。 */
function getTracker(node: ElementWithValueTracker) {
  return node._valueTracker;
}

/** 清空节点的 tracker 引用。 */
function detachTracker(node: ElementWithValueTracker) {
  node._valueTracker = null;
}

/** checkbox/radio 返回 checked 的 true/false 字符串；其他节点返回 value。 */
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

/**
 * 包装节点原型的 value/checked getter 和 setter，使脚本赋值更新已观察基线，浏览器用户编辑留待事件检测。
 * 已有同名自有属性或缺少原型访问器时不安装，避免覆盖外部拦截；调用者仍可比较 DOM，但 change 可能多报。
 * tracker 持有闭包字符串，stopTracking 删除自有属性恢复原型访问器；不改原型本身。
 *
 * @param currentValue - 普通挂载取当前 DOM 值，hydration 取初始 props 期望值。
 */
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
    /** 透传原生 property getter。 */
    get: function () {
      return get.call(this);
    },
    // $FlowFixMe[missing-local-annot]
    // $FlowFixMe[missing-this-annot]
    /** 先记录脚本赋值的字符串基线，再调用原生 setter。 */
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
    /** 读取闭包保存的已观察字符串。 */
    getValue() {
      return currentValue;
    },
    /** 仅更新 tracker 基线，不写 DOM property。 */
    setValue(value: string) {
      if (__DEV__) {
        checkFormFieldValueStringCoercion(value);
      }
      currentValue = '' + value;
    },
    /** 清空 tracker 引用并删除自有 property，让节点恢复原型 getter/setter。 */
    stopTracking() {
      detachTracker(node);
      delete node[valueField];
    },
  };
  return tracker;
}

/** 尚无 tracker 时，以当前 DOM value/checked 作为基线安装属性拦截。 */
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

/**
 * 以初始 props 值安装 tracker，并比较已保留的 DOM 值，供 hydration-change 路径识别 hydration 前的编辑。
 * 已有 tracker 时不重复安装并返回 false；返回的差异比较不依赖拦截是否成功安装。
 */
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

/** 比较 DOM 与 tracker 基线，变化时更新基线并返回 true；无 tracker 时保守返回 true。 */
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

/** 有 tracker 时解除节点的属性拦截和 tracker 引用。 */
export function stopTracking(node: ElementWithValueTracker) {
  const tracker = getTracker(node);
  if (tracker) {
    tracker.stopTracking();
  }
}
