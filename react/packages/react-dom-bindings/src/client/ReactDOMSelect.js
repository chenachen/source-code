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

/** `getDeclarationErrorAddendum` 查询并返回所需值；缺失或不适用时走显式回退；用于同步 select 的单选、多选与默认选项状态。 */
function getDeclarationErrorAddendum() {
  const ownerName = getCurrentFiberOwnerNameInDevOrNull();
  if (ownerName) {
    return '\n\nCheck the render method of `' + ownerName + '`.';
  }
  return '';
}

/** `valuePropNames` 保存同步 select 的单选、多选与默认选项状态所需的稳定配置、索引或模块级状态；调用方共享其身份。 */
const valuePropNames = ['value', 'defaultValue'];

/**
 * 用于 `value` 和 `defaultValue` 的验证函数。
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

/** `updateOptions` 更新对应关联或宿主状态，并保持后续读取看到一致快照；用于同步 select 的单选、多选与默认选项状态。 */
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
    //不要将 `select.value` 设置为精确，因为不同环境下的行为不一致
    //适用于所有情况的浏览器。
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
 * 实现一个 <select> 主机组件，该组件允许可选设置 props `value` 和 `defaultValue`。如果 `multiple` 为 false，则该 prop 必须是可转为字符串的值。如果 `multiple` 为 true，则该 prop 必须是可转为字符串值的数组。
 *
 * 如果未提供 `value`（或为 null/undefined），用户更改所选选项的操作将触发渲染选项的更新。
 *
 * 如果提供了该 prop（且不为 null/undefined），渲染的选项将不会响应用户操作进行更新。相反，渲染选项的更新必须通过 `value` prop 的更改来触发。
 *
 * 如果提供了 `defaultValue`，则任何具有提供值的选项将被选中。
 */

/** `validateSelectProps` 校验输入并在开发环境报告不满足的不变量；用于同步 select 的单选、多选与默认选项状态。 */
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

/** `initSelect` 执行该模块的单一职责，并把副作用限制在当前 DOM/Fiber 边界；用于同步 select 的单选、多选与默认选项状态。 */
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

/** `hydrateSelect` 执行该模块的单一职责，并把副作用限制在当前 DOM/Fiber 边界；用于同步 select 的单选、多选与默认选项状态。 */
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

/** `updateSelect` 更新对应关联或宿主状态，并保持后续读取看到一致快照；用于同步 select 的单选、多选与默认选项状态。 */
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

/** `restoreControlledSelectState` 更新对应关联或宿主状态，并保持后续读取看到一致快照；用于同步 select 的单选、多选与默认选项状态。 */
export function restoreControlledSelectState(element: Element, props: Object) {
  const node: HTMLSelectElement = element as any;
  const value = props.value;

  if (value != null) {
    updateOptions(node, !!props.multiple, value, false);
  }
}
