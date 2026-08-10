/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/**
 * 调整 console format 占位符数量，使其与剩余参数精确匹配。
 *
 * @remarks 缺少参数的占位符会转义为字面量，多余参数按 string/object 补 `%s`/`%o`；
 * 归一化后调用方才能安全地在 format 前后拼接诊断文本。
 */
export default function normalizeConsoleFormat(
  formatString: string,
  args: $ReadOnlyArray<mixed>,
  firstArg: number,
): string {
  let j = firstArg;
  let normalizedString = '';
  let last = 0;
  for (let i = 0; i < formatString.length - 1; i++) {
    if (formatString.charCodeAt(i) !== 37 /* "%" */) {
      continue;
    }
    switch (formatString.charCodeAt(++i)) {
      case 79 /* "O" */:
      case 99 /* "c" */:
      case 100 /* "d" */:
      case 102 /* "f" */:
      case 105 /* "i" */:
      case 111 /* "o" */:
      case 115 /* "s" */: {
        if (j < args.length) {
          // 当前占位符有对应参数。
          j++;
        } else {
          // 占位符多于参数，额外加 `%` 让 console 按字面量打印。
          normalizedString += formatString.slice(last, (last = i)) + '%';
        }
      }
    }
  }
  normalizedString += formatString.slice(last, formatString.length);
  // 为尚未消费的参数补占位符。
  while (j < args.length) {
    if (normalizedString !== '') {
      normalizedString += ' ';
    }
    // 各环境默认格式不同；这里采用 Chrome DevTools 的 string/object 规则。
    normalizedString += typeof args[j] === 'string' ? '%s' : '%o';
    j++;
  }
  return normalizedString;
}
