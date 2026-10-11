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
 * 对象依次选择 url、href、src、currentSrc、command、request.url、response.url、id、name；
 * 前面的字段一旦匹配便遮住后面的字段。5～500 字符限制只用于字符串输入和最后的
 * 自定义 `toString`，URL、名称和 Error.message 不受此长度限制。函数只取 name，
 * 数字和 bigint 直接转为文本，其余原始值返回空串；生产构建一律返回空串。
 * 访问 getter 或执行字符串化可能产生用户副作用，任何异常都被吞掉并返回空串。
 *
 * @param value - I/O 记录关联的资源、参数或结果；这里提取显示标签，不序列化对象。
 * @returns 开发工具可显示的描述；无法识别、过长或读取失败时为空串。
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
