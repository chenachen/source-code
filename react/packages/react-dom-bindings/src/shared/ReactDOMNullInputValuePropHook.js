/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/** 进程内是否已报告过 value=null，避免同类警告刷屏。 */
let didWarnValueNull = false;

/**
 * 检查 input/textarea/select 是否错误地传入 `value={null}`。
 * 多选 select 建议空数组，其余控件建议空字符串；未受影响的标签直接跳过。
 */
export function validateProperties(type, props) {
  if (__DEV__) {
    if (type !== 'input' && type !== 'textarea' && type !== 'select') {
      return;
    }

    if (props != null && props.value === null && !didWarnValueNull) {
      didWarnValueNull = true;
      if (type === 'select' && props.multiple) {
        console.error(
          '`value` prop on `%s` should not be null. ' +
            'Consider using an empty array when `multiple` is set to `true` ' +
            'to clear the component or `undefined` for uncontrolled components.',
          type,
        );
      } else {
        console.error(
          '`value` prop on `%s` should not be null. ' +
            'Consider using an empty string to clear the component or `undefined` ' +
            'for uncontrolled components.',
          type,
        );
      }
    }
  }
}
