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

    /** 保存捕获错误的父类边界，返回明确Caught标题；用于区分根未捕获和边界捕获报告。 */
    ErrorBoundary = class extends React.Component {
      /** 初error=null时透传children，捕获后改为错误对象。 */
      state = {error: null};
      /** 把原错误存到state.error，让render选择fallback；不另向window上报。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** error真值时显示Caught及message，否则透传子树，故下一次替换NoError可检查根继续使用。 */
      render() {
        if (this.state.error) {
          return <h1>Caught: {this.state.error.message}</h1>;
        }
        return this.props.children;
      }
    };
    /** 固定OK标题的正常组件，错误后替换整棵树验证报告状态不会残留。 */
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

  /** 先await回调再同步flush Scheduler队列，绕开act的测试错误捕获，让window/console真实报告通道可观察；不专门等待任意外部异步工作。 */
  async function fakeAct(cb) {
    // 我们在这里不使用 act/waitForThrow，因为我们要观察错误是如何被实际报告的。
    await cb();
    Scheduler.unstable_flushAll();
  }

  describe('ReactDOMClient.createRoot', () => {
    /** Foo按钮onClick抛Boom，挂载用act但原生dispatch在act外；window error和console.error各收一份Boom，再渲染NoError显示OK且无新报告，验证事件错误不破坏根。 */
    it('logs errors during event handlers', async () => {
      /** 输出按钮，其onClick抛Boom，render自身成功；区分事件处理与渲染错误。 */
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

    /** Foo.render抛Boom且无边界，fakeAct让真实错误通道处理；DEV/PROD均window/console.error报告一次，DEV另warn组件/建议边界、PROD无warn；随后正常渲染OK，验证未捕获渲染错误报告与恢复。 */
    it('logs render errors without an error boundary', async () => {
      /** render立即抛Boom，无边界时进入根未捕获错误报告。 */
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

    /** ErrorBoundary包渲染即抛Boom的Foo；window error零次，DEV console含格式/组件及边界说明，PROD只有原Error；之后OK，验证已捕获错误不全局上报。 */
    it('logs render errors with an error boundary', async () => {
      spyOnDevAndProd(console, 'error');

      /** render立即抛Boom，由外部ErrorBoundary捕获，检查console与全局通道区别。 */
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
        // 错误由父ErrorBoundary捕获，走caught报告而非全局error event；生产仍记录原Error。
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

    /** Foo布局effect抛Boom且无边界；fakeAct后DEV/PROD均window/console.error一次、DEV另warn，下一次NoError成功，验证提交布局错误全局报告。 */
    it('logs layout effect errors without an error boundary', async () => {
      spyOnDevAndProd(console, 'error');

      /** 挂一次useLayoutEffect抛Boom、render返回null，制造布局提交期未捕获错误。 */
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
        // 未捕获的 layout effect 错误经全局报告触发 error event；生产环境也会收到 Boom。
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

    /** 边界包Foo布局effect抛Boom；window零次、DEV含边界说明/PROD原Error，下一次OK，验证布局提交错误可由父边界捕获。 */
    it('logs layout effect errors with an error boundary', async () => {
      spyOnDevAndProd(console, 'error');

      /** 布局effect抛Boom但位于父边界内，验证提交错误恢复路径。 */
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
        // 错误由父ErrorBoundary捕获，走caught报告而非全局error event；生产仍记录原Error。
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

    /** Foo passive effect抛Boom且无边界；fakeAct后window/console.error一次，DEV附warn、PROD无warn，下一次OK，验证被动effect未捕获报告。 */
    it('logs passive effect errors without an error boundary', async () => {
      spyOnDevAndProd(console, 'error');

      /** 一次useEffect抛Boom，定位被动提交错误而非render/layout阶段。 */
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

    /** 父边界包Foo passive effect抛Boom；window零次、console按DEV/PROD格式报告一次，下一次OK，验证被动effect的捕获报告与根可继续使用。 */
    it('logs passive effect errors with an error boundary', async () => {
      spyOnDevAndProd(console, 'error');

      /** 被动effect抛Boom，父边界应捕获，render本身返回null。 */
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
        // 错误由父ErrorBoundary捕获，走caught报告而非全局error event；生产仍记录原Error。
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
