/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use strict';

describe('ReactDOMConsoleErrorReporting', () => {
  let act;
  let React;
  let ReactDOM;

  let ErrorBoundary;
  let NoError;
  let container;
  let windowOnError;
  let waitForThrow;

  beforeEach(() => {
    jest.resetModules();
    act = require('internal-test-utils').act;
    React = require('react');
    ReactDOM = require('react-dom');

    const InternalTestUtils = require('internal-test-utils');
    waitForThrow = InternalTestUtils.waitForThrow;

    ErrorBoundary = class extends React.Component {
      /** `state`：记录测试夹具在当前场景中的状态。 */
      state = {error: null};
      /** `getDerivedStateFromError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error) {
          return <h1>Caught: {this.state.error.message}</h1>;
        }
        return this.props.children;
      }
    };
    NoError = function () {
      return <h1>OK</h1>;
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    windowOnError = jest.fn();
    window.addEventListener('error', windowOnError);
    spyOnDevAndProd(console, 'error');
    spyOnDevAndProd(console, 'warn');
  });

  afterEach(() => {
    document.body.removeChild(container);
    window.removeEventListener('error', windowOnError);
    jest.restoreAllMocks();
  });

  describe('ReactDOM.render', () => {
    // @gate !disableLegacyMode
    /**
     * 代表场景（Given–When–Then）：
     * Given 当前文件已建立所需 DOM、React 根与测试夹具；
     * When 执行「logs errors during event handlers」描述的渲染或交互；
     * Then 通过本用例的 DOM、日志或调度断言确认行为。
     *
     * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
     */
    it('logs errors during event handlers', async () => {
      /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
      function Foo() {
        return (
          <button
            onClick={() => {
              throw Error('Boom');
            }}>
            click me
          </button>
        );
      }

      await act(() => {
        ReactDOM.render(<Foo />, container);
      });

      await expect(async () => {
        await act(() => {
          container.firstChild.dispatchEvent(
            new MouseEvent('click', {
              bubbles: true,
            }),
          );
        });
      }).rejects.toThrow(
        expect.objectContaining({
          message: 'Boom',
        }),
      );

      // 因为我们在浏览器点击事件中报告：
      expect(windowOnError.mock.calls).toEqual([
        [
          expect.objectContaining({
            message: 'Boom',
          }),
        ],
      ]);
      expect(console.warn).not.toBeCalled();

      if (__DEV__) {
        expect(console.error.mock.calls).toEqual([
          [
            expect.stringContaining(
              'ReactDOM.render has not been supported since React 18',
            ),
          ],
        ]);
      } else {
        expect(console.error).not.toBeCalled();
      }

      // 确认下一次渲染不会抛错。
      windowOnError.mockReset();
      console.warn.mockReset();
      console.error.mockReset();
      await act(() => {
        ReactDOM.render(<NoError />, container);
      });
      expect(container.textContent).toBe('OK');
      expect(windowOnError).not.toBeCalled();
      expect(console.warn).not.toBeCalled();
      if (__DEV__) {
        expect(console.error.mock.calls).toEqual([
          [
            expect.stringContaining(
              'ReactDOM.render has not been supported since React 18',
            ),
          ],
        ]);
      } else {
        expect(console.error).not.toBeCalled();
      }
    });

    // @gate !disableLegacyMode
    /** 测试场景：验证「logs render errors without an error boundary」描述的渲染、交互或错误处理结果。 */
    it('logs render errors without an error boundary', async () => {
      /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
      function Foo() {
        throw Error('Boom');
      }

      await expect(async () => {
        await act(() => {
          ReactDOM.render(<Foo />, container);
        });
      }).rejects.toThrow('Boom');

      // 无错误边界时，错误会报告给 window，因此这里会记录一次。
      expect(windowOnError.mock.calls).toEqual([
        [
          expect.objectContaining({
            message: 'Boom',
          }),
        ],
      ]);

      if (__DEV__) {
        expect(console.warn.mock.calls).toEqual([
          [
            // 格式化
            expect.stringContaining('%s'),
            // 附加信息由 React 添加。
            expect.stringContaining('An error occurred in the <Foo> component'),
            expect.stringContaining('Consider adding an error boundary'),
            // 组件栈在没有 polyfill/devtools 的情况下不会添加。
            // expect.stringContaining('Foo'),
          ],
        ]);

        expect(console.error.mock.calls).toEqual([
          [
            expect.stringContaining(
              'ReactDOM.render has not been supported since React 18',
            ),
          ],
        ]);
      } else {
        expect(console.warn).not.toBeCalled();
        expect(console.error).not.toBeCalled();
      }

      // 确认下一次渲染不会抛错。
      windowOnError.mockReset();
      console.warn.mockReset();
      console.error.mockReset();
      await act(() => {
        ReactDOM.render(<NoError />, container);
      });
      expect(container.textContent).toBe('OK');
      expect(console.warn).not.toBeCalled();
      expect(windowOnError).not.toBeCalled();
      if (__DEV__) {
        expect(console.error.mock.calls).toEqual([
          [
            expect.stringContaining(
              'ReactDOM.render has not been supported since React 18',
            ),
          ],
        ]);
      } else {
        expect(console.error).not.toBeCalled();
      }
    });

    // @gate !disableLegacyMode
    /** 测试场景：验证「logs render errors with an error boundary」描述的渲染、交互或错误处理结果。 */
    it('logs render errors with an error boundary', async () => {
      /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
      function Foo() {
        throw Error('Boom');
      }

      await act(() => {
        ReactDOM.render(
          <ErrorBoundary>
            <Foo />
          </ErrorBoundary>,
          container,
        );
      });

      // 顶层错误已被 `try/catch` 捕获，因此不会看到 error event。
      expect(windowOnError).not.toBeCalled();
      expect(console.warn).not.toBeCalled();

      if (__DEV__) {
        expect(console.error.mock.calls).toEqual([
          [
            expect.stringContaining(
              'ReactDOM.render has not been supported since React 18',
            ),
          ],
          [
            // 格式化
            expect.stringContaining('%o'),
            expect.objectContaining({
              message: 'Boom',
            }),
            // 附加信息由 React 添加。
            expect.stringContaining(
              'The above error occurred in the <Foo> component',
            ),
            expect.stringContaining('ErrorBoundary'),
            // 组件栈在没有 polyfill/devtools 的情况下不会添加。
            // expect.stringContaining('Foo'),
          ],
        ]);
      } else {
        expect(console.error.mock.calls).toEqual([
          [
            // 由 React 报告，没有附加消息：
            expect.objectContaining({
              message: 'Boom',
            }),
          ],
        ]);
      }

      // 确认下一次渲染不会抛错。
      windowOnError.mockReset();
      console.error.mockReset();
      console.warn.mockReset();
      await act(() => {
        ReactDOM.render(<NoError />, container);
      });
      expect(container.textContent).toBe('OK');
      expect(windowOnError).not.toBeCalled();
      expect(console.warn).not.toBeCalled();
      if (__DEV__) {
        expect(console.error.mock.calls).toEqual([
          [
            expect.stringContaining(
              'ReactDOM.render has not been supported since React 18',
            ),
          ],
        ]);
      } else {
        expect(console.error).not.toBeCalled();
      }
    });

    // @gate !disableLegacyMode
    /** 测试场景：验证「logs layout effect errors without an error boundary」描述的渲染、交互或错误处理结果。 */
    it('logs layout effect errors without an error boundary', async () => {
      /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
      function Foo() {
        React.useLayoutEffect(() => {
          throw Error('Boom');
        }, []);
        return null;
      }

      await expect(async () => {
        await act(() => {
          ReactDOM.render(<Foo />, container);
        });
      }).rejects.toThrow('Boom');

      // 无错误边界时，错误会报告给 window，因此这里会记录一次。
      expect(windowOnError.mock.calls).toEqual([
        [
          expect.objectContaining({
            message: 'Boom',
          }),
        ],
      ]);

      if (__DEV__) {
        expect(console.warn.mock.calls).toEqual([
          [
            // 格式化
            expect.stringContaining('%s'),

            // 附加信息由 React 添加。
            expect.stringContaining('An error occurred in the <Foo> component'),
            expect.stringContaining('Consider adding an error boundary'),
            // 组件栈在没有 polyfill/devtools 的情况下不会添加。
            // expect.stringContaining('Foo'),
          ],
        ]);

        expect(console.error.mock.calls).toEqual([
          [
            expect.stringContaining(
              'ReactDOM.render has not been supported since React 18',
            ),
          ],
        ]);
      } else {
        expect(console.warn).not.toBeCalled();
        expect(console.error).not.toBeCalled();
      }

      // 确认下一次渲染不会抛错。
      windowOnError.mockReset();
      console.warn.mockReset();
      console.error.mockReset();
      await act(() => {
        ReactDOM.render(<NoError />, container);
      });
      expect(container.textContent).toBe('OK');
      expect(console.warn).not.toBeCalled();
      expect(windowOnError).not.toBeCalled();

      if (__DEV__) {
        expect(console.error.mock.calls).toEqual([
          [
            expect.stringContaining(
              'ReactDOM.render has not been supported since React 18',
            ),
          ],
        ]);
      } else {
        expect(console.error).not.toBeCalled();
      }
    });

    // @gate !disableLegacyMode
    /** 测试场景：验证「logs layout effect errors with an error boundary」描述的渲染、交互或错误处理结果。 */
    it('logs layout effect errors with an error boundary', async () => {
      /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
      function Foo() {
        React.useLayoutEffect(() => {
          throw Error('Boom');
        }, []);
        return null;
      }

      await act(() => {
        ReactDOM.render(
          <ErrorBoundary>
            <Foo />
          </ErrorBoundary>,
          container,
        );
      });

      // 顶层错误已被 `try/catch` 捕获，因此不会看到 error event。
      expect(windowOnError).not.toBeCalled();
      expect(console.warn).not.toBeCalled();

      if (__DEV__) {
        expect(console.error.mock.calls).toEqual([
          [
            expect.stringContaining(
              'ReactDOM.render has not been supported since React 18',
            ),
          ],
          [
            // 格式化
            expect.stringContaining('%o'),
            expect.objectContaining({
              message: 'Boom',
            }),
            // 附加信息由 React 添加。
            expect.stringContaining(
              'The above error occurred in the <Foo> component',
            ),
            expect.stringContaining('ErrorBoundary'),
            // 组件栈在没有 polyfill/devtools 的情况下不会添加。
            // expect.stringContaining('Foo'),
          ],
        ]);
      } else {
        expect(console.error.mock.calls).toEqual([
          [
            // 由 React 报告，没有附加消息：
            expect.objectContaining({
              message: 'Boom',
            }),
          ],
        ]);
      }

      // 确认下一次渲染不会抛错。
      windowOnError.mockReset();
      console.warn.mockReset();
      console.error.mockReset();
      await act(() => {
        ReactDOM.render(<NoError />, container);
      });
      expect(container.textContent).toBe('OK');
      expect(windowOnError).not.toBeCalled();
      expect(console.warn).not.toBeCalled();
      if (__DEV__) {
        expect(console.error.mock.calls).toEqual([
          [
            expect.stringContaining(
              'ReactDOM.render has not been supported since React 18',
            ),
          ],
        ]);
      } else {
        expect(console.error).not.toBeCalled();
      }
    });

    // @gate !disableLegacyMode
    /** 测试场景：验证「logs passive effect errors without an error boundary」描述的渲染、交互或错误处理结果。 */
    it('logs passive effect errors without an error boundary', async () => {
      /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
      function Foo() {
        React.useEffect(() => {
          throw Error('Boom');
        }, []);
        return null;
      }

      await act(async () => {
        ReactDOM.render(<Foo />, container);
        await waitForThrow('Boom');
      });

      // 顶层错误已被 `try/catch` 捕获，因此不会看到 error event。
      expect(windowOnError.mock.calls).toEqual([
        [
          expect.objectContaining({
            message: 'Boom',
          }),
        ],
      ]);

      if (__DEV__) {
        expect(console.warn.mock.calls).toEqual([
          [
            // 格式化
            expect.stringContaining('%s'),

            // 附加信息由 React 添加。
            expect.stringContaining('An error occurred in the <Foo> component'),
            expect.stringContaining('Consider adding an error boundary'),
            // 组件栈在没有 polyfill/devtools 的情况下不会添加。
            // expect.stringContaining('Foo'),
          ],
        ]);

        expect(console.error.mock.calls).toEqual([
          [
            expect.stringContaining(
              'ReactDOM.render has not been supported since React 18',
            ),
          ],
        ]);
      } else {
        expect(console.warn).not.toBeCalled();
        expect(console.error).not.toBeCalled();
      }

      // 确认下一次渲染不会抛错。
      windowOnError.mockReset();
      console.warn.mockReset();
      console.error.mockReset();
      await act(() => {
        ReactDOM.render(<NoError />, container);
      });
      expect(container.textContent).toBe('OK');
      expect(windowOnError).not.toBeCalled();
      expect(console.warn).not.toBeCalled();
      if (__DEV__) {
        expect(console.error.mock.calls).toEqual([
          [
            expect.stringContaining(
              'ReactDOM.render has not been supported since React 18',
            ),
          ],
        ]);
      } else {
        expect(console.error).not.toBeCalled();
      }
    });

    // @gate !disableLegacyMode
    /** 测试场景：验证「logs passive effect errors with an error boundary」描述的渲染、交互或错误处理结果。 */
    it('logs passive effect errors with an error boundary', async () => {
      /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
      function Foo() {
        React.useEffect(() => {
          throw Error('Boom');
        }, []);
        return null;
      }

      await act(() => {
        ReactDOM.render(
          <ErrorBoundary>
            <Foo />
          </ErrorBoundary>,
          container,
        );
      });

      // 顶层错误已被 `try/catch` 捕获，因此不会看到 error event。
      expect(windowOnError).not.toBeCalled();
      expect(console.warn).not.toBeCalled();

      if (__DEV__) {
        expect(console.error.mock.calls).toEqual([
          [
            expect.stringContaining(
              'ReactDOM.render has not been supported since React 18',
            ),
          ],
          [
            // 格式化
            expect.stringContaining('%o'),
            expect.objectContaining({
              message: 'Boom',
            }),
            // 附加信息由 React 添加。
            expect.stringContaining(
              'The above error occurred in the <Foo> component',
            ),
            expect.stringContaining('ErrorBoundary'),
            // 组件栈在没有 polyfill/devtools 的情况下不会添加。
            // expect.stringContaining('Foo'),
          ],
        ]);
      } else {
        expect(console.error.mock.calls).toEqual([
          [
            // 由 React 报告，没有附加消息：
            expect.objectContaining({
              message: 'Boom',
            }),
          ],
        ]);
      }

      // 确认下一次渲染不会抛错。
      windowOnError.mockReset();
      console.warn.mockReset();
      console.error.mockReset();
      await act(() => {
        ReactDOM.render(<NoError />, container);
      });
      expect(container.textContent).toBe('OK');
      expect(windowOnError).not.toBeCalled();
      expect(console.warn).not.toBeCalled();
      if (__DEV__) {
        expect(console.error.mock.calls).toEqual([
          [
            expect.stringContaining(
              'ReactDOM.render has not been supported since React 18',
            ),
          ],
        ]);
      } else {
        expect(console.warn).not.toBeCalled();
      }
    });
  });
});
