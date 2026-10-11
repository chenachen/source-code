/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */
'use strict';

let formatProdErrorMessage;

describe('ReactErrorProd', () => {
  // 每例重新加载纯 formatter，避免模块缓存把不同构建配置混进同一测试状态。
  beforeEach(() => {
    jest.resetModules();
    formatProdErrorMessage = require('shared/formatProdErrorMessage').default;
  });

  /**
   * Given：错误码分别带多个、零个及含保留字符的插值参数。
   * When：调用 `formatProdErrorMessage`。
   * Then：URL 的 `args[]` 数量、顺序与 percent-encoding 精确对应输入。
   *
   * 验证机制：逐项比较完整返回字符串，核对无 query、多参数及保留字符的编码。
   */
  it('should throw with the correct number of `%s`s in the URL', () => {
    expect(formatProdErrorMessage(124, 'foo', 'bar')).toEqual(
      'Minified React error #124; visit ' +
        'https://react.dev/errors/124?args[]=foo&args[]=bar' +
        ' for the full message or use the non-minified dev environment' +
        ' for full errors and additional helpful warnings.',
    );

    expect(formatProdErrorMessage(20)).toEqual(
      'Minified React error #20; visit ' +
        'https://react.dev/errors/20' +
        ' for the full message or use the non-minified dev environment' +
        ' for full errors and additional helpful warnings.',
    );

    expect(formatProdErrorMessage(77, '<div>', '&?bar')).toEqual(
      'Minified React error #77; visit ' +
        'https://react.dev/errors/77?args[]=%3Cdiv%3E&args[]=%26%3Fbar' +
        ' for the full message or use the non-minified dev environment' +
        ' for full errors and additional helpful warnings.',
    );
  });
});
