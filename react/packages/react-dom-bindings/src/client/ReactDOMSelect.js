/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

//待办：像 some-package/src/* 这样的直接导入是不好的。请修复我。
import {getCurrentFiberOwnerNameInDevOrNull} from 'react-reconciler/src/ReactCurrentFiber';

import {getToStringValue, toString} from './ToStringValue';
import isArray from 'shared/isArray';
import {queueChangeEvent} from '../events/ReactDOMEventReplaying';

let didWarnValueDefaultValue;

if (__DEV__) {
  didWarnValueDefaultValue = false;
}

/** 开发期取得当前组件名，附加到 select prop 警告。 */
function getDeclarationErrorAddendum() {
  const ownerName = getCurrentFiberOwnerNameInDevOrNull();
  if (ownerName) {
    return '\n\nCheck the render method of `' + ownerName + '`.';
  }
  return '';
}

/** 需要按 multiple 校验标量/数组形态的两个 select props。 */
const valuePropNames = ['value', 'defaultValue'];

/**
 * 开发期检查 value/defaultValue 与 multiple 的形态约定：多选要求数组，单选要求标量。
 */
function checkSelectPropTypes(props: any) {
  if (__DEV__) {
    for (let i = 0; i < valuePropNames.length; i++) {
      const propName = valuePropNames[i];
      if (props[propName] == null) {
        continue;
      }
      const propNameIsArray = isArray(props[propName]);
      if (props.multiple && !propNameIsArray) {
        console.error(
          'The `%s` prop supplied to <select> must be an array if ' +
            '`multiple` is true.%s',
          propName,
          getDeclarationErrorAddendum(),
        );
      } else if (!props.multiple && propNameIsArray) {
        console.error(
          'The `%s` prop supplied to <select> must be a scalar ' +
            'value if `multiple` is false.%s',
          propName,
          getDeclarationErrorAddendum(),
        );
      }
    }
  }
}

/**
 * 根据 select 的最终 value 更新 option.selected；多选先建字符串键集合，避免每个 option 重扫值数组。
 * 单选找到相等项立即返回，找不到时选第一个未禁用项；全部禁用时不写选择。
 *
 * @param setDefaultSelected - 初始化 defaultValue 时同时标记选中项的默认状态，供原生 form reset 使用。
 */
function updateOptions(
  node: HTMLSelectElement,
  multiple: boolean,
  propValue: any,
  setDefaultSelected: boolean,
) {
  const options: HTMLOptionsCollection = node.options;

  if (multiple) {
    const selectedValues = propValue as Array<string>;
    const selectedValue: {
      /** option 字符串值到选中态的索引；键加前缀以避开对象特殊属性。 */
      [string]: boolean
    } = {};
    for (let i = 0; i < selectedValues.length; i++) {
      //前缀以避免特殊键的混乱。
      selectedValue['$' + selectedValues[i]] = true;
    }
    for (let i = 0; i < options.length; i++) {
      const selected = selectedValue.hasOwnProperty('$' + options[i].value);
      if (options[i].selected !== selected) {
        options[i].selected = selected;
      }
      if (selected && setDefaultSelected) {
        options[i].defaultSelected = true;
      }
    }
  } else {
    // 逐项设置 option.selected，兼容各浏览器对 select.value 的差异。
    const selectedValue = toString(getToStringValue(propValue));
    let defaultSelected = null;
    for (let i = 0; i < options.length; i++) {
      if (options[i].value === selectedValue) {
        options[i].selected = true;
        if (setDefaultSelected) {
          options[i].defaultSelected = true;
        }
        return;
      }
      if (defaultSelected === null && !options[i].disabled) {
        defaultSelected = options[i];
      }
    }
    if (defaultSelected !== null) {
      defaultSelected.selected = true;
    }
  }
}

/**
 * select 的 value 非 null 时由 React 控制，用户选择后由事件恢复路径重新应用最终 props。
 * 非受控模式保留用户选择；defaultValue 用于初始化，以及 multiple 模式切换时的重置。
 * multiple=true 时 value/defaultValue 应为值数组，否则应为可转换成字符串的标量。
 */

/** 开发期校验 value/defaultValue 形态，并警告同时传入两者。 */
export function validateSelectProps(element: Element, props: Object) {
  if (__DEV__) {
    checkSelectPropTypes(props);
    if (
      props.value !== undefined &&
      props.defaultValue !== undefined &&
      !didWarnValueDefaultValue
    ) {
      console.error(
        'Select elements must be either controlled or uncontrolled ' +
          '(specify either the value prop, or the defaultValue prop, but not ' +
          'both). Decide between using a controlled or uncontrolled select ' +
          'element and remove one of these props. More info: ' +
          'https://react.dev/link/controlled-components',
      );
      didWarnValueDefaultValue = true;
    }
  }
}

/** 先设置 multiple，再按 value 或 defaultValue 初始化 option 选择。 */
export function initSelect(
  element: Element,
  value: ?string,
  defaultValue: ?string,
  multiple: ?boolean,
) {
  const node: HTMLSelectElement = element as any;
  node.multiple = !!multiple;
  if (value != null) {
    updateOptions(node, !!multiple, value, false);
  } else if (defaultValue != null) {
    updateOptions(node, !!multiple, defaultValue, true);
  }
}

/** 保留服务端 DOM 的当前选择；与初始 props 期望选择不同则排队 hydration change。 */
export function hydrateSelect(
  element: Element,
  value: ?string,
  defaultValue: ?string,
  multiple: ?boolean,
): void {
  const node: HTMLSelectElement = element as any;
  const options: HTMLOptionsCollection = node.options;

  const propValue: any = value != null ? value : defaultValue;

  let changed = false;

  if (multiple) {
    const selectedValues = propValue as ?Array<string>;
    const selectedValue: {
      /** hydration 期 option 字符串值到期望选中态的索引。 */
      [string]: boolean
    } = {};
    if (selectedValues != null) {
      for (let i = 0; i < selectedValues.length; i++) {
        //前缀以避免特殊键的混乱。
        selectedValue['$' + selectedValues[i]] = true;
      }
    }
    for (let i = 0; i < options.length; i++) {
      const expectedSelected = selectedValue.hasOwnProperty(
        '$' + options[i].value,
      );
      if (options[i].selected !== expectedSelected) {
        changed = true;
        break;
      }
    }
  } else {
    let selectedValue =
      propValue == null ? null : toString(getToStringValue(propValue));
    for (let i = 0; i < options.length; i++) {
      if (selectedValue == null && !options[i].disabled) {
        //如果选中的值为 null，我们期望选择第一个未禁用的选项。
        selectedValue = options[i].value;
      }
      const expectedSelected = options[i].value === selectedValue;
      if (options[i].selected !== expectedSelected) {
        changed = true;
        break;
      }
    }
  }
  if (changed) {
    //如果当前选择与我们最初的选择不同，这表明用户
    //在水化之前更改了它。排队重放更改事件。
    queueChangeEvent(node);
  }
}

/** 受控 select 重应用 value；非受控 select 仅在 multiple 改变时重应用 defaultValue 或清选择。 */
export function updateSelect(
  element: Element,
  value: ?string,
  defaultValue: ?string,
  multiple: ?boolean,
  wasMultiple: ?boolean,
) {
  const node: HTMLSelectElement = element as any;

  if (value != null) {
    updateOptions(node, !!multiple, value, false);
  } else if (!!wasMultiple !== !!multiple) {
    //为简单起见，如果 `multiple` 被切换，请重新应用 `defaultValue`。
    if (defaultValue != null) {
      updateOptions(node, !!multiple, defaultValue, true);
    } else {
      //将选择项恢复到默认的未选中状态。
      updateOptions(node, !!multiple, multiple ? [] : '', false);
    }
  }
}

/** 仅对提供 value 的 select 按最新 props 恢复选择。 */
export function restoreControlledSelectState(element: Element, props: Object) {
  const node: HTMLSelectElement = element as any;
  const value = props.value;

  if (value != null) {
    updateOptions(node, !!props.multiple, value, false);
  }
}
