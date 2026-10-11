/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

// 不要直接导入本模块；源码应直接构造带完整消息的 Error。构建阶段会把完整消息
// 替换为错误码，再由这里生成文档 URL。

/**
 * 把构建替换后的生产错误码与插值参数编码成消息，供调用方构造 Error。
 * @param code - error-codes 构建插件选择的稳定错误编号，不在此校验编号是否存在。
 * @returns 包含 react.dev/errors 解码链接的字符串；本函数不抛出所描述的 React 错误。
 * @remarks arguments[1..] 按原顺序逐项 encodeURIComponent 写入 args[]；无额外参数
 * 时不带 query。参数字符串化或非法代理字符串编码失败仍会抛错，调用方传入的通常是
 * 构建从原错误消息中提取的插值值。
 */
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
