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

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should prevent non-function listeners, at dispatch」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：事件断言连接 DOMPluginEventSystem 的委托、合成与传播路径。
   */
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
    /** `handleWindowError`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「should not prevent null listeners, at dispatch」描述的渲染、交互或错误处理结果。 */
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
