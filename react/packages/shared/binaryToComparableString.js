/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/**
 * 把 ArrayBuffer view 的原始字节编码成可作为 Map key 比较的字符串。
 *
 * @remarks 使用当前 view 的 byteOffset/byteLength，不会把同一底层 buffer 的其他区段
 * 纳入比较；字符串只用于逐字节身份，不代表文本编码。
 */
export default function binaryToComparableString(
  view: $ArrayBufferView,
): string {
  return String.fromCharCode.apply(
    String,
    new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
  );
}
