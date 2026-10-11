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

  // 生产分支暂存 Error mock 并恢复原构造器，确保后续断言观察构建输出的原始错误文本。
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

  // 无论测试断言是否成功都归还全局 Error，避免本文件影响其他错误测试。
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
   * 历史参数编码用例：组件显示名含 `#`，旧预期使用错误码 152 和 reactjs.org URL。
   * 初始创建有效 DOM root；act 中渲染返回普通对象的 Oops，断言 Promise 拒绝文本携带
   * %23wtf 编码参数。目的是覆盖压缩错误参数编码，实际预期仍保留下面的历史字符串。
   * 当前对象 child 路径对应错误码 31，formatProdErrorMessage 使用 react.dev URL，
   * 因此下面的旧断言不能作为当前编码行为的证据；现行编码由 ReactErrorProd 测试覆盖。
   */
  it('should serialize arguments', async () => {
    /** 返回普通对象，触发当前 reconciler 的无效 child 错误路径。 */
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
