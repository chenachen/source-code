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
 * @param view - 指定底层 buffer 区间的 ArrayBuffer view，包括 TypedArray 或 DataView。
 * @returns 每个字节对应一个 UTF-16 code unit 的字符串，相同字节序列可作为同一 Map 键。
 * @remarks 不复制或修改底层 buffer；apply 的参数个数由 byteLength 决定，宿主参数长度
 * 限制导致的异常直接传播。调用方应在 buffer 内容变化前完成身份查找。
 */
export default function binaryToComparableString(
  view: $ArrayBufferView,
): string {
  return String.fromCharCode.apply(
    String,
    new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
  );
}
