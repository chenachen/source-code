/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {checkFormFieldValueStringCoercion} from 'shared/CheckStringCoercion';

/** 已经通过表单值检查、允许执行字符串连接的值品牌类型。 */
export opaque type ToStringValue =
  | boolean
  | number
  | bigint
  | Object
  | string
  | null
  | void;

// 不透明类型要求值先经 getToStringValue 检查，再允许字符串连接。
/** 将 getToStringValue 处理后的值通过字符串连接转为 DOM 表单文本。 */
export function toString(value: ToStringValue): string {
  //强制安全检查在 getToStringValue() 中执行。
  // eslint-disable-next-line react-internal/safe-string-coercion
  return '' + (value as any);
}

/** 保留允许的基本值与对象，开发期检查对象转换；function/symbol 回退为空字符串。 */
export function getToStringValue(value: mixed): ToStringValue {
  switch (typeof value) {
    case 'bigint':
    case 'boolean':
    case 'number':
    case 'string':
    case 'undefined':
      return value;
    case 'object':
      if (__DEV__) {
        checkFormFieldValueStringCoercion(value);
      }
      return value;
    default:
      //function，symbol 被赋值为空字符串
      return '';
  }
}
