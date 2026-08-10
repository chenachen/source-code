/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import hasOwnProperty from 'shared/hasOwnProperty';

/** XML/HTML 属性名首字符允许的 Unicode 范围片段。 */
const ATTRIBUTE_NAME_START_CHAR =
  ':A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD';
/** 属性名后续字符允许的范围，并额外接受连字符、点、数字及组合字符。 */
export const ATTRIBUTE_NAME_CHAR: string =
  ATTRIBUTE_NAME_START_CHAR + '\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040';

/** 对完整属性名执行一次性语法校验的正则。 */
const VALID_ATTRIBUTE_NAME_REGEX: RegExp = new RegExp(
  '^[' + ATTRIBUTE_NAME_START_CHAR + '][' + ATTRIBUTE_NAME_CHAR + ']*$',
);

/** 已确认非法的属性名集合，避免重复正则与重复开发警告。 */
const illegalAttributeNameCache: {
  /** 任意属性名键映射到已判定标记。 */
  [string]: boolean
} = {};
/** 已确认合法的属性名集合，命中后直接放行。 */
const validatedAttributeNameCache: {
  /** 任意属性名键映射到已判定标记。 */
  [string]: boolean
} = {};

/**
 * 判断属性名能否安全写入 DOM，并缓存正反两类结果。
 * WHY：非法名称交给浏览器会抛异常；开发环境只需对每个名称警告一次。
 */
export default function isAttributeNameSafe(attributeName: string): boolean {
  if (hasOwnProperty.call(validatedAttributeNameCache, attributeName)) {
    return true;
  }
  if (hasOwnProperty.call(illegalAttributeNameCache, attributeName)) {
    return false;
  }
  if (VALID_ATTRIBUTE_NAME_REGEX.test(attributeName)) {
    validatedAttributeNameCache[attributeName] = true;
    return true;
  }
  illegalAttributeNameCache[attributeName] = true;
  if (__DEV__) {
    console.error('Invalid attribute name: `%s`', attributeName);
  }
  return false;
}
