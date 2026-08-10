/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/** 经 React 规范化、可安全传给 DOM `crossOrigin` 属性的字符串品牌类型。 */
export opaque type CrossOriginString: string = string;

/**
 * 将用户的 crossOrigin 值收敛为浏览器支持的凭据模式。
 * `use-credentials` 原样保留，其他字符串代表匿名模式，非字符串表示未指定。
 */
export function getCrossOriginString(input: ?string): ?CrossOriginString {
  if (typeof input === 'string') {
    return input === 'use-credentials' ? input : '';
  }
  return undefined;
}

/**
 * 根据资源类型规范化 crossOrigin；字体资源按规范始终使用匿名跨域。
 * 边界：除 `font` 外沿用 `getCrossOriginString` 的三态语义。
 */
export function getCrossOriginStringAs(
  as: ?string,
  input: ?string,
): ?CrossOriginString {
  if (as === 'font') {
    return '';
  }
  if (typeof input === 'string') {
    return input === 'use-credentials' ? input : '';
  }
  return undefined;
}
