/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 */

/** 用户交互不直接编辑 value 的 input 类型；此豁免不适用于 checked 的警告。 */
const hasReadOnlyValue = {
  button: true,
  checkbox: true,
  image: true,
  hidden: true,
  radio: true,
  reset: true,
  submit: true,
};

/**
 * 在开发环境检查受控表单值是否配有可写入口。
 * value 接受 onChange/onInput 或类型豁免；checked 仅接受 onChange。readOnly/disabled 或未指定值时跳过相应警告。
 */
export function checkControlledValueProps(
  tagName: string,
  props: Object,
): void {
  if (__DEV__) {
    if (
      !(
        hasReadOnlyValue[props.type] ||
        props.onChange ||
        props.onInput ||
        props.readOnly ||
        props.disabled ||
        props.value == null
      )
    ) {
      if (tagName === 'select') {
        console.error(
          'You provided a `value` prop to a form field without an ' +
            '`onChange` handler. This will render a read-only field. If ' +
            'the field should be mutable use `defaultValue`. Otherwise, set `onChange`.',
        );
      } else {
        console.error(
          'You provided a `value` prop to a form field without an ' +
            '`onChange` handler. This will render a read-only field. If ' +
            'the field should be mutable use `defaultValue`. Otherwise, set either `onChange` or `readOnly`.',
        );
      }
    }

    if (
      !(
        props.onChange ||
        props.readOnly ||
        props.disabled ||
        props.checked == null
      )
    ) {
      console.error(
        'You provided a `checked` prop to a form field without an ' +
          '`onChange` handler. This will render a read-only field. If ' +
          'the field should be mutable use `defaultChecked`. Otherwise, ' +
          'set either `onChange` or `readOnly`.',
      );
    }
  }
}
