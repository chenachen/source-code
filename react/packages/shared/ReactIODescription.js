/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/**
 * 为开发期异步 I/O 记录提取短而稳定的可读描述。
 *
 * @remarks
 * 优先读取 URL、命令、id 或 name；自定义 `toString` 只有长度适中且不像默认对象标签时
 * 才采用。任何 getter 或字符串化异常都被吞掉，诊断代码不能影响应用执行。
 */
export function getIODescription(value: mixed): string {
  if (!__DEV__) {
    return '';
  }
  try {
    switch (typeof value) {
      case 'function':
        return value.name || '';
      case 'object':
        // 依次尝试常见标识字段。这里虽然只能看到返回值，目标仍是找到能描述请求参数
        // 或目标资源的名称，而不是序列化整个对象。
        if (value === null) {
          return '';
        } else if (value instanceof Error) {
          // eslint-disable-next-line react-internal/safe-string-coercion
          return String(value.message);
        } else if (typeof value.url === 'string') {
          return value.url;
        } else if (typeof value.href === 'string') {
          return value.href;
        } else if (typeof value.src === 'string') {
          return value.src;
        } else if (typeof value.currentSrc === 'string') {
          return value.currentSrc;
        } else if (typeof value.command === 'string') {
          return value.command;
        } else if (
          typeof value.request === 'object' &&
          value.request !== null &&
          typeof value.request.url === 'string'
        ) {
          return value.request.url;
        } else if (
          typeof value.response === 'object' &&
          value.response !== null &&
          typeof value.response.url === 'string'
        ) {
          return value.response.url;
        } else if (
          typeof value.id === 'string' ||
          typeof value.id === 'number' ||
          typeof value.id === 'bigint'
        ) {
          // eslint-disable-next-line react-internal/safe-string-coercion
          return String(value.id);
        } else if (typeof value.name === 'string') {
          return value.name;
        } else {
          const str = value.toString();
          if (
            str.startsWith('[object ') ||
            str.length < 5 ||
            str.length > 500
          ) {
            // 默认对象标签或过短/过长文本都不能提供有用描述。
            return '';
          }
          return str;
        }
      case 'string':
        if (value.length < 5 || value.length > 500) {
          return '';
        }
        return value;
      case 'number':
      case 'bigint':
        // eslint-disable-next-line react-internal/safe-string-coercion
        return String(value);
      default:
        // 布尔值、undefined 和 symbol 等值缺少可辨识的 I/O 语义。
        return '';
    }
  } catch (x) {
    return '';
  }
}
