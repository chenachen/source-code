/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// javascript: URL 可带前导 C0 控制符或 \u0020 空格，且换行与制表符在解析时会被过滤，
// 仿佛它们不是 URL 的一部分。
// https://url.spec.whatwg.org/#url-parsing
// 制表或换行字符定义为 \r\n\t：
// https://infra.spec.whatwg.org/#ascii-tab-or-newline
// C0 控制符范围从 \u0000 NULL 到 \u001F INFORMATION SEPARATOR ONE，包含两端：
// https://infra.spec.whatwg.org/#c0-control-or-space

/** 识别经过空白/控制符混淆后仍会被浏览器解释为 javascript: 的 URL。 */
const isJavaScriptProtocol =
  /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*\:/i;

/**
 * 阻断 javascript: URL，其他值保持身份和值不变。
 * WHY：替换 URL 既消除副作用，又在真正访问时给出明确错误。
 */
function sanitizeURL<T>(url: T): T | string {
  // Symbol 已在其他入口过滤，理论上不会到达这里。
  // eslint-disable-next-line react-internal/safe-string-coercion
  if (isJavaScriptProtocol.test('' + (url as any))) {
    // 返回一个没有业务副作用、仅在访问时抛错的替代 javascript: URL。
    // eslint-disable-next-line no-script-url
    return "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')";
  }
  return url;
}

export default sanitizeURL;
