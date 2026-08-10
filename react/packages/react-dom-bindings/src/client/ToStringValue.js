/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {checkFormFieldValueStringCoercion} from 'shared/CheckStringCoercion';

/** `ToStringValue` 定义在写入 DOM 前完成受控值的安全字符串强制转换使用的数据契约；字段共同限定所有权、生命周期与跨模块传递边界。 */
export opaque type ToStringValue =
  | boolean
  | number
  | bigint
  | Object
  | string
  | null
  | void;

//Flow 不允许对大多数非字符串类型进行字符串连接。要使用
//针对这个限制，我们使用一种只能通过...获得的不透明类型
//首先通过 getToStringValue 传递该值。
/** `toString` 执行该模块的单一职责，并把副作用限制在当前 DOM/Fiber 边界；用于在写入 DOM 前完成受控值的安全字符串强制转换。 */
export function toString(value: ToStringValue): string {
  //强制安全检查在 getToStringValue() 中执行。
  // eslint-disable-next-line react-internal/safe-string-coercion
  return '' + (value as any);
}

/** `getToStringValue` 查询并返回所需值；缺失或不适用时走显式回退；用于在写入 DOM 前完成受控值的安全字符串强制转换。 */
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
