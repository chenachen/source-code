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

    /** 提交 render/layout/passive 错误时展示错误消息的边界，供区别 caught 与 window error 报告。 */
    ErrorBoundary = class extends React.Component {

      /** 保存已捕获错误；null 时允许正常 children 渲染。 */
      state = {error: null};

      /** 把错误映射进边界状态，让下一次 render 选择错误 UI。 */
      static getDerivedStateFromError(error) {
        return {error};
      }

      /** 错误时输出 Caught 标题，否则透传子树。 */
      render() {
        if (this.state.error) {
          return <h1>Caught: {this.state.error.message}</h1>;
        }
        return this.props.children;
      }
    };
    /** 提供 OK 标题，用于每例错误后验证根还能正常更新。 */
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

    /** legacy 根按钮 onClick 抛 Boom，act 拒绝且 window 收到一次 error；开发 console.error 仅含旧 API 警告，随后渲染 OK 验证错误未污染下次更新。 */
    it('logs errors during event handlers', async () => {

      /** 返回点击处理器会抛 Boom 的按钮，触发浏览器事件报告路径。 */
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

    /** legacy 根无边界的 Foo 在 render 抛 Boom，act 拒绝并触发 window error；开发 console.warn 提供边界建议、console.error 仅旧 API 警告，后续 OK 更新成功。 */
    it('logs render errors without an error boundary', async () => {

      /** 在 render 立即抛 Boom，验证无边界的 legacy 根错误报告。 */
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

    /** legacy 根 ErrorBoundary 捕获 Foo 的 render 错误，无 window error 或 warn；console.error 报被捕获错误（开发另有旧 API 提示），替换成 OK 后恢复。 */
    it('logs render errors with an error boundary', async () => {

      /** 在边界子 render 抛 Boom，验证错误被边界捕获的报告路径。 */
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

      // 错误由 ErrorBoundary 捕获并走 caught error 报告，不触发 window error。
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

    /** 无边界 Foo 的 layout effect 抛 Boom，挂载 act 拒绝并报告 window error；开发 warn 建议加边界，随后 OK 挂载不再报告该错误。 */
    it('logs layout effect errors without an error boundary', async () => {

      /** 在 layout effect 抛 Boom，覆盖无边界提交阶段错误。 */
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

    /** ErrorBoundary 包住 layout effect 抛 Boom 的 Foo，提交错误进入边界而不触发 window error；开发/生产分别验证带栈或原错误的 console.error，并确认 OK 更新可恢复。 */
    it('logs layout effect errors with an error boundary', async () => {

      /** 在 layout effect 抛 Boom，覆盖边界捕获提交错误。 */
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

      // 错误由 ErrorBoundary 捕获并走 caught error 报告，不触发 window error。
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

    /** 无边界 Foo 的 passive effect 抛 Boom，等待后台错误再检查 window error；开发 warn 有边界建议，清空 spy 后 OK 更新无残留错误，覆盖被动提交的报告路径。 */
    it('logs passive effect errors without an error boundary', async () => {

      /** 在 passive effect 抛 Boom，让 waitForThrow 观察后台错误报告。 */
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

      // 无边界 passive 错误走 uncaught 报告，下面应收到一次 window error。
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

    /** ErrorBoundary 包住 passive effect 抛 Boom 的 Foo，act 完成边界恢复且无 window error/warn；console.error 包含被捕获错误，随后用 OK 替换并检查恢复。 */
    it('logs passive effect errors with an error boundary', async () => {

      /** 在 passive effect 抛 Boom，由父错误边界恢复子树。 */
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

      // 错误由 ErrorBoundary 捕获并走 caught error 报告，不触发 window error。
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
