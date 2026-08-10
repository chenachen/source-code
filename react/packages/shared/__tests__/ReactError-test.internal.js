/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */
'use strict';

let React;
let ReactDOMClient;
let act;

describe('ReactError', () => {
  let globalErrorMock;

  beforeEach(() => {
    if (!__DEV__) {
      // 生产 Jest 环境会覆盖全局 Error 以自动解码消息；本组测试必须观察原始压缩错误，
      // 因此暂时恢复 OriginalError，并在 afterEach 中还原 mock。
      globalErrorMock = global.Error;
      global.Error = globalErrorMock.OriginalError;
      expect(typeof global.Error).toBe('function');
    }
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
  });

  afterEach(() => {
    if (!__DEV__) {
      global.Error = globalErrorMock;
    }
  });

  // @gate build === "production"
  // @gate !source
  /**
   * Given：生产构建且使用真实未解码 Error。
   * When：以非法 `null` container 创建 root。
   * Then：抛出稳定错误码 200 及 react.dev 解码 URL。
   *
   * 验证机制：断言完整字符串，证明入口使用生产 error-code 替换而非开发消息。
   */
  it('should error with minified error code', () => {
    expect(() => {
      ReactDOMClient.createRoot(null);
    }).toThrowError(
      'Minified React error #200; visit ' +
        'https://react.dev/errors/200' +
        ' for the full message or use the non-minified dev environment' +
        ' for full errors and additional helpful warnings.',
    );
  });

  // @gate build === "production"
  // @gate !source
  /**
   * Given：组件显示名包含 URL 需编码的 `#`。
   * When：生产 render 因组件返回普通对象而失败。
   * Then：错误码 URL 把插值参数编码为 `%23wtf`。
   *
   * 验证机制：等待 act rejection，并断言错误码、参数和帮助文本形成闭环。
   */
  it('should serialize arguments', async () => {
    /** 返回无效 React child，触发生产错误码 152。 */
    function Oops() {
      return {};
    }
    Oops.displayName = '#wtf';

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(async () => {
      await act(async () => {
        root.render(<Oops />);
      });
    }).rejects.toThrow(
      'Minified React error #152; visit ' +
        'https://reactjs.org/docs/error-decoder.html?invariant=152&args[]=%23wtf' +
        ' for the full message or use the non-minified dev environment' +
        ' for full errors and additional helpful warnings.',
    );
  });
});
