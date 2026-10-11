/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

jest.mock('react-dom-bindings/src/events/isEventSupported');

describe('InvalidEventListeners', () => {
  let React;
  let ReactDOMClient;
  let act;
  let assertConsoleErrorDev;
  let container;

  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));

    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    container = null;
  });

  /** 先把 onClick 设为字符串并核对 DEV 渲染警告，再派发冒泡 click，同时捕获 window.error；应有一次未捕获错误与一次 JSDOM 控制台报告，验证真值非函数 handler 在派发阶段仍被拒绝并进入全局错误报告。 */
  it('should prevent non-function listeners, at dispatch', async () => {
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<div onClick="not a function" />);
    });
    assertConsoleErrorDev([
      'Expected `onClick` listener to be a function, instead got a value of `string` type.\n' +
        '    in div (at **)',
    ]);
    const node = container.firstChild;

    console.error = jest.fn();

    const uncaughtErrors = [];
    /** 保存浏览器 error 事件的原始 Error 对象，供派发后的数量与类型消息断言；try/finally 移除监听避免污染其它 case。 */
    function handleWindowError(e) {
      uncaughtErrors.push(e.error);
    }
    window.addEventListener('error', handleWindowError);
    try {
      node.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
        }),
      );
    } finally {
      window.removeEventListener('error', handleWindowError);
    }
    expect(uncaughtErrors.length).toBe(1);
    expect(uncaughtErrors[0]).toEqual(
      expect.objectContaining({
        message:
          'Expected `onClick` listener to be a function, ' +
          'instead got a value of `string` type.',
      }),
    );

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        detail: expect.objectContaining({
          message:
            'Expected `onClick` listener to be a function, instead got a value of `string` type.',
        }),
        type: 'unhandled exception',
      }),
    );
  });

  /** 把 onClick 设为 null，提交后派发冒泡 click；act 应正常完成，验证空 listener 被当作未注册而不触发函数类型异常。 */
  it('should not prevent null listeners, at dispatch', async () => {
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<div onClick={null} />);
    });

    const node = container.firstChild;
    await act(() => {
      node.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
        }),
      );
    });
  });
});
