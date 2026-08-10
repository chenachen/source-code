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
  let ReactDOMClient;

  let ErrorBoundary;
  let NoError;
  let container;
  let windowOnError;
  let Scheduler;

  beforeEach(() => {
    jest.resetModules();
    act = require('internal-test-utils').act;
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    Scheduler = require('scheduler');

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
    spyOnDevAndProd(console, 'error').mockImplementation(() => {});
    spyOnDevAndProd(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.removeChild(container);
    window.removeEventListener('error', windowOnError);
    jest.restoreAllMocks();
  });

  /** `fakeAct`：封装当前用例复用的操作、回调或断言步骤。 */
  async function fakeAct(cb) {
    // 我们在这里不使用 act/waitForThrow，因为我们要观察错误是如何被实际报告的。
    await cb();
    Scheduler.unstable_flushAll();
  }

  describe('ReactDOMClient.createRoot', () => {
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

      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Foo />);
      });

      container.firstChild.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
        }),
      );

      expect(windowOnError.mock.calls).toEqual([
        [
          // 因为我们在浏览器点击事件中报告：
          expect.objectContaining({
            message: 'Boom',
          }),
        ],
      ]);
      expect(console.error.mock.calls).toEqual([
        [
          // 因为我们在浏览器点击事件中报告：
          expect.objectContaining({
            message: 'Boom',
          }),
        ],
      ]);

      // 确认下一次渲染不会抛错。
      windowOnError.mockReset();
      console.error.mockReset();
      await act(() => {
        root.render(<NoError />);
      });
      expect(container.textContent).toBe('OK');
      expect(windowOnError.mock.calls).toEqual([]);
      expect(console.error.mock.calls).toEqual([]);
    });

    /** 测试场景：验证「logs render errors without an error boundary」描述的渲染、交互或错误处理结果。 */
    it('logs render errors without an error boundary', async () => {
      /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
      function Foo() {
        throw Error('Boom');
      }

      const root = ReactDOMClient.createRoot(container);
      await fakeAct(() => {
        root.render(<Foo />);
      });

      if (__DEV__) {
        expect(windowOnError.mock.calls).toEqual([
          [
            expect.objectContaining({
              message: 'Boom',
            }),
          ],
        ]);
        expect(console.error.mock.calls).toEqual([
          [
            expect.objectContaining({
              message: 'Boom',
            }),
          ],
        ]);
        expect(console.warn.mock.calls).toEqual([
          [
            // 附加信息由 React 添加。
            expect.stringContaining('%s'),
            expect.stringContaining('An error occurred in the <Foo> component'),
            expect.stringContaining('Consider adding an error boundary'),
            // 没有 polyfill/DevTools 时不会附加组件栈。
            // expect.stringContaining('Foo'),
          ],
        ]);
      } else {
        expect(windowOnError.mock.calls).toEqual([
          [
            expect.objectContaining({
              message: 'Boom',
            }),
          ],
        ]);
        expect(console.error.mock.calls).toEqual([
          [
            // 由 React 报告，没有附加消息：
            expect.objectContaining({
              message: 'Boom',
            }),
          ],
        ]);
        expect(console.warn.mock.calls).toEqual([]);
      }

      // 确认下一次渲染不会抛错。
      windowOnError.mockReset();
      console.error.mockReset();
      await act(() => {
        root.render(<NoError />);
      });
      expect(container.textContent).toBe('OK');
      expect(windowOnError.mock.calls).toEqual([]);
      if (__DEV__) {
        expect(console.error.mock.calls).toEqual([]);
      }
    });

    /** 测试场景：验证「logs render errors with an error boundary」描述的渲染、交互或错误处理结果。 */
    it('logs render errors with an error boundary', async () => {
      spyOnDevAndProd(console, 'error');

      /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
      function Foo() {
        throw Error('Boom');
      }

      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <ErrorBoundary>
            <Foo />
          </ErrorBoundary>,
        );
      });

      if (__DEV__) {
        expect(windowOnError.mock.calls).toEqual([]);
        expect(console.error.mock.calls).toEqual([
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
            // 没有 polyfill/DevTools 时不会附加组件栈。
            // expect.stringContaining('Foo'),
          ],
        ]);
      } else {
        // 顶层错误已被 `try/catch` 捕获，因此生产环境中不会看到 error event。
        expect(windowOnError.mock.calls).toEqual([]);
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
      await act(() => {
        root.render(<NoError />);
      });
      expect(container.textContent).toBe('OK');
      expect(windowOnError.mock.calls).toEqual([]);
      if (__DEV__) {
        expect(console.error.mock.calls).toEqual([]);
      }
    });

    /** 测试场景：验证「logs layout effect errors without an error boundary」描述的渲染、交互或错误处理结果。 */
    it('logs layout effect errors without an error boundary', async () => {
      spyOnDevAndProd(console, 'error');

      /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
      function Foo() {
        React.useLayoutEffect(() => {
          throw Error('Boom');
        }, []);
        return null;
      }

      const root = ReactDOMClient.createRoot(container);
      await fakeAct(() => {
        root.render(<Foo />);
      });

      if (__DEV__) {
        expect(windowOnError.mock.calls).toEqual([
          [
            expect.objectContaining({
              message: 'Boom',
            }),
          ],
        ]);
        expect(console.error.mock.calls).toEqual([
          [
            expect.objectContaining({
              message: 'Boom',
            }),
          ],
        ]);
        expect(console.warn.mock.calls).toEqual([
          [
            // 附加信息由 React 添加。
            expect.stringContaining('%s'),
            expect.stringContaining('An error occurred in the <Foo> component'),
            expect.stringContaining('Consider adding an error boundary'),
            // 没有 polyfill/DevTools 时不会附加组件栈。
            // expect.stringContaining('Foo'),
          ],
        ]);
      } else {
        // 顶层错误已被 `try/catch` 捕获，因此生产环境中不会看到 error event。
        expect(windowOnError.mock.calls).toEqual([
          [
            expect.objectContaining({
              message: 'Boom',
            }),
          ],
        ]);
        expect(console.error.mock.calls).toEqual([
          [
            // 由 React 报告，没有附加消息：
            expect.objectContaining({
              message: 'Boom',
            }),
          ],
        ]);
        expect(console.warn.mock.calls).toEqual([]);
      }

      // 确认下一次渲染不会抛错。
      windowOnError.mockReset();
      console.error.mockReset();
      await act(() => {
        root.render(<NoError />);
      });
      expect(container.textContent).toBe('OK');
      expect(windowOnError.mock.calls).toEqual([]);
      if (__DEV__) {
        expect(console.error.mock.calls).toEqual([]);
      }
    });

    /** 测试场景：验证「logs layout effect errors with an error boundary」描述的渲染、交互或错误处理结果。 */
    it('logs layout effect errors with an error boundary', async () => {
      spyOnDevAndProd(console, 'error');

      /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
      function Foo() {
        React.useLayoutEffect(() => {
          throw Error('Boom');
        }, []);
        return null;
      }

      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <ErrorBoundary>
            <Foo />
          </ErrorBoundary>,
        );
      });

      if (__DEV__) {
        expect(windowOnError.mock.calls).toEqual([]);
        expect(console.error.mock.calls).toEqual([
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
            // 没有 polyfill/DevTools 时不会附加组件栈。
            // expect.stringContaining('Foo'),
          ],
        ]);
      } else {
        // 顶层错误已被 `try/catch` 捕获，因此生产环境中不会看到 error event。
        expect(windowOnError.mock.calls).toEqual([]);
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
      await act(() => {
        root.render(<NoError />);
      });
      expect(container.textContent).toBe('OK');
      expect(windowOnError.mock.calls).toEqual([]);
      if (__DEV__) {
        expect(console.error.mock.calls).toEqual([]);
      }
    });

    /** 测试场景：验证「logs passive effect errors without an error boundary」描述的渲染、交互或错误处理结果。 */
    it('logs passive effect errors without an error boundary', async () => {
      spyOnDevAndProd(console, 'error');

      /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
      function Foo() {
        React.useEffect(() => {
          throw Error('Boom');
        }, []);
        return null;
      }

      const root = ReactDOMClient.createRoot(container);
      await fakeAct(() => {
        root.render(<Foo />);
      });

      if (__DEV__) {
        expect(windowOnError.mock.calls).toEqual([
          [
            expect.objectContaining({
              message: 'Boom',
            }),
          ],
        ]);
        expect(console.error.mock.calls).toEqual([
          [
            expect.objectContaining({
              message: 'Boom',
            }),
          ],
        ]);
        expect(console.warn.mock.calls).toEqual([
          [
            // 附加信息由 React 添加。
            expect.stringContaining('%s'),
            expect.stringContaining('An error occurred in the <Foo> component'),
            expect.stringContaining('Consider adding an error boundary'),
            // 没有 polyfill/DevTools 时不会附加组件栈。
            // expect.stringContaining('Foo'),
          ],
        ]);
      } else {
        expect(windowOnError.mock.calls).toEqual([
          [
            expect.objectContaining({
              message: 'Boom',
            }),
          ],
        ]);
        expect(console.error.mock.calls).toEqual([
          [
            // 由 React 报告，没有附加消息：
            expect.objectContaining({
              message: 'Boom',
            }),
          ],
        ]);
        expect(console.warn.mock.calls).toEqual([]);
      }

      // 确认下一次渲染不会抛错。
      windowOnError.mockReset();
      console.error.mockReset();
      await act(() => {
        root.render(<NoError />);
      });
      expect(container.textContent).toBe('OK');
      expect(windowOnError.mock.calls).toEqual([]);
      if (__DEV__) {
        expect(console.error.mock.calls).toEqual([]);
      }
    });

    /** 测试场景：验证「logs passive effect errors with an error boundary」描述的渲染、交互或错误处理结果。 */
    it('logs passive effect errors with an error boundary', async () => {
      spyOnDevAndProd(console, 'error');

      /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
      function Foo() {
        React.useEffect(() => {
          throw Error('Boom');
        }, []);
        return null;
      }

      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <ErrorBoundary>
            <Foo />
          </ErrorBoundary>,
        );
      });

      if (__DEV__) {
        expect(windowOnError.mock.calls).toEqual([]);
        expect(console.error.mock.calls).toEqual([
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
            // 没有 polyfill/DevTools 时不会附加组件栈。
            // expect.stringContaining('Foo'),
          ],
        ]);
      } else {
        // 顶层错误已被 `try/catch` 捕获，因此生产环境中不会看到 error event。
        expect(windowOnError.mock.calls).toEqual([]);
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
      await act(() => {
        root.render(<NoError />);
      });
      expect(container.textContent).toBe('OK');
      expect(windowOnError.mock.calls).toEqual([]);
      if (__DEV__) {
        expect(console.error.mock.calls).toEqual([]);
      }
    });
  });
});
