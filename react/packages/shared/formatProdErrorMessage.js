/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

// 不要直接导入本模块；源码应使用带模板字符串的普通 `invariant`。构建阶段会把完整消息
// 替换为错误码，再由这里生成文档 URL。

/** 把生产错误码与插值参数编码成可查阅完整消息的精简 React Error。 */
function formatProdErrorMessage(code) {
  let url = 'https://react.dev/errors/' + code;
  if (arguments.length > 1) {
    url += '?args[]=' + encodeURIComponent(arguments[1]);
    for (let i = 2; i < arguments.length; i++) {
      url += '&args[]=' + encodeURIComponent(arguments[i]);
    }
  }

  return (
    `Minified React error #${code}; visit ${url} for the full message or ` +
    'use the non-minified dev environment for full errors and additional ' +
    'helpful warnings.'
  );
}

export default formatProdErrorMessage;
