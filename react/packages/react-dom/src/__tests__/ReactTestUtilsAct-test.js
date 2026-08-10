/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

let React;
let ReactDOMClient;
let Scheduler;
let act;
let container;
let assertLog;
let assertConsoleErrorDev;

jest.useRealTimers();

global.IS_REACT_ACT_ENVIRONMENT = true;

/** `sleep`：封装当前用例复用的操作、回调或断言步骤。 */
function sleep(period) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(true);
    }, period);
  });
}

describe('React.act()', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  let root = null;
  /** `renderConcurrent`：封装当前用例复用的操作、回调或断言步骤。 */
  const renderConcurrent = (el, dom) => {
    root = ReactDOMClient.createRoot(dom);
    if (__DEV__) {
      act(() => root.render(el));
    } else {
      root.render(el);
    }
  };

  /** `unmountConcurrent`：封装当前用例复用的操作、回调或断言步骤。 */
  const unmountConcurrent = _dom => {
    if (__DEV__) {
      act(() => {
        if (root !== null) {
          root.unmount();
          root = null;
        }
      });
    } else {
      if (root !== null) {
        root.unmount();
        root = null;
      }
    }
  };

  /** `rerenderConcurrent`：封装当前用例复用的操作、回调或断言步骤。 */
  const rerenderConcurrent = el => {
    act(() => root.render(el));
  };

  runActTests(renderConcurrent, unmountConcurrent, rerenderConcurrent);

  describe('unacted effects', () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      React.useEffect(() => {}, []);
      return null;
    }

    // @gate __DEV__
    /**
     * 代表场景（Given–When–Then）：
     * Given 当前文件已建立所需 DOM、React 根与测试夹具；
     * When 执行「does not warn」描述的渲染或交互；
     * Then 通过本用例的 DOM、日志或调度断言确认行为。
     *
     * 验证机制：断言覆盖 ReactTestUtils.act 到 React.act 的兼容转发与调度冲刷。
     */
    it('does not warn', () => {
      root = ReactDOMClient.createRoot(document.createElement('div'));
      act(() => root.render(<App />));
    });
  });
});

/** `runActTests`：封装当前用例复用的操作、回调或断言步骤。 */
function runActTests(render, unmount, rerender) {
  describe('concurrent render', () => {
    beforeEach(() => {
      jest.resetModules();
      React = require('react');
      ReactDOMClient = require('react-dom/client');
      Scheduler = require('scheduler');
      act = React.act;

      const InternalTestUtils = require('internal-test-utils');
      assertLog = InternalTestUtils.assertLog;
      assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;

      container = document.createElement('div');
      document.body.appendChild(container);
    });

    afterEach(() => {
      unmount(container);
      document.body.removeChild(container);
    });

    describe('sync', () => {
      // @gate __DEV__
      /** 测试场景：验证「can use act to flush effects」描述的渲染、交互或错误处理结果。 */
      it('can use act to flush effects', () => {
        /** `runActTests.App`：封装当前用例复用的操作、回调或断言步骤。 */
        function App() {
          React.useEffect(() => {
            Scheduler.log(100);
          });
          return null;
        }

        act(() => {
          render(<App />, container);
        });

        assertLog([100]);
      });

      // @gate __DEV__
      /** 测试场景：验证「flushes effects on every call」描述的渲染、交互或错误处理结果。 */
      it('flushes effects on every call', async () => {
        /** `runActTests.App`：封装当前用例复用的操作、回调或断言步骤。 */
        function App() {
          const [ctr, setCtr] = React.useState(0);
          React.useEffect(() => {
            Scheduler.log(ctr);
          });
          return (
            <button id="button" onClick={() => setCtr(x => x + 1)}>
              {ctr}
            </button>
          );
        }

        act(() => {
          render(<App />, container);
        });
        assertLog([0]);
        const button = container.querySelector('#button');
        /** `runActTests.click`：封装当前用例复用的操作、回调或断言步骤。 */
        function click() {
          button.dispatchEvent(new MouseEvent('click', {bubbles: true}));
        }

        await act(async () => {
          click();
          click();
          click();
        });
        // 合并 3 次更新后，再触发 effect。
        assertLog([3]);
        await act(async () => click());
        assertLog([4]);
        await act(async () => click());
        assertLog([5]);
        expect(button.innerHTML).toBe('5');
      });

      // @gate __DEV__
      /** 测试场景：验证「should keep flushing effects until they're done」描述的渲染、交互或错误处理结果。 */
      it("should keep flushing effects until they're done", () => {
        /** `runActTests.App`：封装当前用例复用的操作、回调或断言步骤。 */
        function App() {
          const [ctr, setCtr] = React.useState(0);
          React.useEffect(() => {
            if (ctr < 5) {
              setCtr(x => x + 1);
            }
          });
          return ctr;
        }

        act(() => {
          render(<App />, container);
        });

        expect(container.innerHTML).toBe('5');
      });

      // @gate __DEV__
      /** 测试场景：验证「should flush effects only on exiting the outermost act」描述的渲染、交互或错误处理结果。 */
      it('should flush effects only on exiting the outermost act', () => {
        /** `runActTests.App`：封装当前用例复用的操作、回调或断言步骤。 */
        function App() {
          React.useEffect(() => {
            Scheduler.log(0);
          });
          return null;
        }
        // 嵌套几层 act() 调用。
        act(() => {
          act(() => {
            render(<App />, container);
          });
          // 此时仍在 act() 作用域内，因此 effect 尚未 yield。
          assertLog([]);
        });
        // 退出最外层 act() 后，effects 才会被冲刷。
        assertLog([0]);
      });

      // @gate __DEV__
      /** 测试场景：验证「warns if a setState is called outside of act(...)」描述的渲染、交互或错误处理结果。 */
      it('warns if a setState is called outside of act(...)', () => {
        let setValue = null;
        /** `runActTests.App`：封装当前用例复用的操作、回调或断言步骤。 */
        function App() {
          const [value, _setValue] = React.useState(0);
          setValue = _setValue;
          return value;
        }

        act(() => {
          render(<App />, container);
        });

        setValue(1);
        assertConsoleErrorDev([
          'An update to App inside a test was not wrapped in act(...).\n' +
            '\n' +
            'When testing, code that causes React state updates should be wrapped into act(...):\n' +
            '\n' +
            'act(() => {\n' +
            '  /* fire events that update state */\n' +
            '});\n' +
            '/* assert on the output */\n' +
            '\n' +
            "This ensures that you're testing the behavior the user would see in the browser. " +
            'Learn more at https://react.dev/link/wrap-tests-with-act\n' +
            '    in App (at **)',
        ]);
      });

      // @gate __DEV__
      /** 测试场景：验证「warns if a setState is called outside of act(...) after a component threw」描述的渲染、交互或错误处理结果。 */
      it('warns if a setState is called outside of act(...) after a component threw', () => {
        let setValue = null;
        /** `runActTests.App`：封装当前用例复用的操作、回调或断言步骤。 */
        function App({defaultValue}) {
          if (defaultValue === undefined) {
            throw new Error('some error');
          }
          const [value, _setValue] = React.useState(defaultValue);
          setValue = _setValue;
          return value;
        }

        expect(() => {
          act(() => {
            render(<App defaultValue={undefined} />, container);
          });
        }).toThrow('some error');

        act(() => {
          rerender(<App defaultValue={0} />, container);
        });

        setValue(1);
        assertConsoleErrorDev([
          'An update to App inside a test was not wrapped in act(...).\n' +
            '\n' +
            'When testing, code that causes React state updates should be wrapped into act(...):\n' +
            '\n' +
            'act(() => {\n' +
            '  /* fire events that update state */\n' +
            '});\n' +
            '/* assert on the output */\n' +
            '\n' +
            "This ensures that you're testing the behavior the user would see in the browser. " +
            'Learn more at https://react.dev/link/wrap-tests-with-act\n' +
            '    in App (at **)',
        ]);
      });

      // @gate __DEV__
      /** 测试场景：验证「does not warn if IS_REACT_ACT_ENVIRONMENT is set to false」描述的渲染、交互或错误处理结果。 */
      it('does not warn if IS_REACT_ACT_ENVIRONMENT is set to false', () => {
        let setState;
        /** `runActTests.App`：封装当前用例复用的操作、回调或断言步骤。 */
        function App() {
          const [state, _setState] = React.useState(0);
          setState = _setState;
          return state;
        }

        act(() => {
          render(<App />, container);
        });

        // 首先显示它会警告。
        setState(1);
        assertConsoleErrorDev([
          'An update to App inside a test was not wrapped in act(...).\n' +
            '\n' +
            'When testing, code that causes React state updates should be wrapped into act(...):\n' +
            '\n' +
            'act(() => {\n' +
            '  /* fire events that update state */\n' +
            '});\n' +
            '/* assert on the output */\n' +
            '\n' +
            "This ensures that you're testing the behavior the user would see in the browser. " +
            'Learn more at https://react.dev/link/wrap-tests-with-act\n' +
            '    in App (at **)',
        ]);

        // 再执行一次相同步骤，但通过环境标志禁用 act 环境。
        const prevIsActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
        global.IS_REACT_ACT_ENVIRONMENT = false;
        try {
          setState(2);
        } finally {
          global.IS_REACT_ACT_ENVIRONMENT = prevIsActEnvironment;
        }

        // flag 恢复原值后应再次开始警告，这证明 React 每次都会读取该 flag。
        setState(3);
        assertConsoleErrorDev([
          'An update to App inside a test was not wrapped in act(...).\n' +
            '\n' +
            'When testing, code that causes React state updates should be wrapped into act(...):\n' +
            '\n' +
            'act(() => {\n' +
            '  /* fire events that update state */\n' +
            '});\n' +
            '/* assert on the output */\n' +
            '\n' +
            "This ensures that you're testing the behavior the user would see in the browser. " +
            'Learn more at https://react.dev/link/wrap-tests-with-act\n' +
            '    in App (at **)',
        ]);
      });

      describe('fake timers', () => {
        beforeEach(() => {
          jest.useFakeTimers();
        });

        afterEach(() => {
          jest.useRealTimers();
        });

        // @gate __DEV__
        /** 测试场景：验证「lets a ticker update」描述的渲染、交互或错误处理结果。 */
        it('lets a ticker update', () => {
          /** `runActTests.App`：封装当前用例复用的操作、回调或断言步骤。 */
          function App() {
            const [toggle, setToggle] = React.useState(0);
            React.useEffect(() => {
              const timeout = setTimeout(() => {
                setToggle(1);
              }, 200);
              return () => clearTimeout(timeout);
            }, []);
            return toggle;
          }

          act(() => {
            render(<App />, container);
          });
          act(() => {
            jest.runAllTimers();
          });

          expect(container.innerHTML).toBe('1');
        });

        // @gate __DEV__
        /** 测试场景：验证「can use the async version to catch microtasks」描述的渲染、交互或错误处理结果。 */
        it('can use the async version to catch microtasks', async () => {
          /** `runActTests.App`：封装当前用例复用的操作、回调或断言步骤。 */
          function App() {
            const [toggle, setToggle] = React.useState(0);
            React.useEffect(() => {
              // 与前一个测试相同，但这里使用 Promise，并在它兑现后调度更新。
              sleep(200).then(() => setToggle(1));
            }, []);
            return toggle;
          }

          act(() => {
            render(<App />, container);
          });
          await act(async () => {
            jest.runAllTimers();
          });

          expect(container.innerHTML).toBe('1');
        });

        // @gate __DEV__
        /** 测试场景：验证「can handle cascading promises with fake timers」描述的渲染、交互或错误处理结果。 */
        it('can handle cascading promises with fake timers', async () => {
          // 此组件触发一个 effect；effect 等待一个 tick 后设置 state，并重复 5 次。
          /** `runActTests.App`：封装当前用例复用的操作、回调或断言步骤。 */
          function App() {
            const [state, setState] = React.useState(0);
            /** `App.ticker`：封装当前用例复用的操作、回调或断言步骤。 */
            async function ticker() {
              await null;
              setState(x => x + 1);
            }
            React.useEffect(() => {
              ticker();
            }, [Math.min(state, 4)]);
            return state;
          }

          await act(async () => {
            render(<App />, container);
          });

          // 所有五次 tick 都存在并已计入。
          expect(container.innerHTML).toBe('5');
        });

        // @gate __DEV__
        /** 测试场景：验证「flushes immediate re-renders with act」描述的渲染、交互或错误处理结果。 */
        it('flushes immediate re-renders with act', () => {
          /** `runActTests.App`：封装当前用例复用的操作、回调或断言步骤。 */
          function App() {
            const [ctr, setCtr] = React.useState(0);
            React.useEffect(() => {
              if (ctr === 0) {
                setCtr(1);
              }
              const timeout = setTimeout(() => setCtr(2), 1000);
              return () => clearTimeout(timeout);
            });
            return ctr;
          }

          act(() => {
            render(<App />, container);
            // effects 尚未冲刷，因此这里不会推进计时器。
            jest.runAllTimers();
          });

          expect(container.innerHTML).toBe('1');

          act(() => {
            jest.runAllTimers();
          });

          expect(container.innerHTML).toBe('2');
        });
      });
    });

    describe('asynchronous tests', () => {
      // @gate __DEV__
      /** 测试场景：验证「works with timeouts」描述的渲染、交互或错误处理结果。 */
      it('works with timeouts', async () => {
        /** `runActTests.App`：封装当前用例复用的操作、回调或断言步骤。 */
        function App() {
          const [ctr, setCtr] = React.useState(0);
          /** `App.doSomething`：封装当前用例复用的操作、回调或断言步骤。 */
          function doSomething() {
            setTimeout(() => {
              setCtr(1);
            }, 50);
          }

          React.useEffect(() => {
            doSomething();
          }, []);
          return ctr;
        }

        await act(async () => {
          render(<App />, container);
        });
        expect(container.innerHTML).toBe('0');
        // 冲刷待处理的定时器。
        await act(async () => {
          await sleep(100);
        });
        expect(container.innerHTML).toBe('1');
      });

      // @gate __DEV__
      /** 测试场景：验证「flushes microtasks before exiting (async function)」描述的渲染、交互或错误处理结果。 */
      it('flushes microtasks before exiting (async function)', async () => {
        /** `runActTests.App`：封装当前用例复用的操作、回调或断言步骤。 */
        function App() {
          const [ctr, setCtr] = React.useState(0);
          /** `App.someAsyncFunction`：封装当前用例复用的操作、回调或断言步骤。 */
          async function someAsyncFunction() {
            // 队列一系列 Promise，确保它们全部执行完毕。
            await null;
            await null;
            await null;
            setCtr(1);
          }
          React.useEffect(() => {
            someAsyncFunction();
          }, []);
          return ctr;
        }

        await act(async () => {
          render(<App />, container);
        });
        expect(container.innerHTML).toEqual('1');
      });

      // @gate __DEV__
      /** 测试场景：验证「flushes microtasks before exiting (sync function)」描述的渲染、交互或错误处理结果。 */
      it('flushes microtasks before exiting (sync function)', async () => {
        // 如上一次测试一样。 但是传递给 `act` 的回调函数不是异步函数。
        /** `runActTests.App`：封装当前用例复用的操作、回调或断言步骤。 */
        function App() {
          const [ctr, setCtr] = React.useState(0);
          /** `App.someAsyncFunction`：封装当前用例复用的操作、回调或断言步骤。 */
          async function someAsyncFunction() {
            // 队列一系列 Promise，确保它们全部执行完毕。
            await null;
            await null;
            await null;
            setCtr(1);
          }
          React.useEffect(() => {
            someAsyncFunction();
          }, []);
          return ctr;
        }

        await act(() => {
          render(<App />, container);
        });
        expect(container.innerHTML).toEqual('1');
      });

      // @gate __DEV__
      /** 测试场景：验证「warns if you do not await an act call」描述的渲染、交互或错误处理结果。 */
      it('warns if you do not await an act call', async () => {
        spyOnDevAndProd(console, 'error').mockImplementation(() => {});
        act(async () => {});
        // 这个警告要等一个 tick 才出现，虽然麻烦，但这里必须等待。
        await sleep(0);
        if (__DEV__) {
          expect(console.error).toHaveBeenCalledTimes(1);
          expect(console.error.mock.calls[0][0]).toMatch(
            'You called act(async () => ...) without await.',
          );
        }
      });

      // @gate __DEV__
      /** 测试场景：验证「warns if you try to interleave multiple act calls」描述的渲染、交互或错误处理结果。 */
      it('warns if you try to interleave multiple act calls', async () => {
        spyOnDevAndProd(console, 'error').mockImplementation(() => {});

        await Promise.all([
          act(async () => {
            await sleep(50);
          }),
          act(async () => {
            await sleep(100);
          }),
        ]);

        await sleep(150);
        if (__DEV__) {
          expect(console.error).toHaveBeenCalledTimes(2);
          expect(console.error.mock.calls[0][0]).toMatch(
            'You seem to have overlapping act() calls',
          );
          expect(console.error.mock.calls[1][0]).toMatch(
            'You seem to have overlapping act() calls',
          );
        }
      });

      // @gate __DEV__
      /** 测试场景：验证「async commits and effects are guaranteed to be flushed」描述的渲染、交互或错误处理结果。 */
      it('async commits and effects are guaranteed to be flushed', async () => {
        /** `runActTests.App`：封装当前用例复用的操作、回调或断言步骤。 */
        function App() {
          const [state, setState] = React.useState(0);
          /** `App.something`：封装当前用例复用的操作、回调或断言步骤。 */
          async function something() {
            await null;
            setState(1);
          }
          React.useEffect(() => {
            something();
          }, []);
          React.useEffect(() => {
            Scheduler.log(state);
          });
          return state;
        }

        await act(async () => {
          render(<App />, container);
        });
        // 退出 act() 会冲刷 effects 和微任务。

        assertLog([0, 1]);
        expect(container.innerHTML).toBe('1');
      });

      // @gate __DEV__
      /** 测试场景：验证「can handle cascading promises」描述的渲染、交互或错误处理结果。 */
      it('can handle cascading promises', async () => {
        // 此组件触发一个 effect；effect 等待一个 tick 后设置 state，并重复 5 次。
        /** `runActTests.App`：封装当前用例复用的操作、回调或断言步骤。 */
        function App() {
          const [state, setState] = React.useState(0);
          /** `App.ticker`：封装当前用例复用的操作、回调或断言步骤。 */
          async function ticker() {
            await null;
            setState(x => x + 1);
          }
          React.useEffect(() => {
            Scheduler.log(state);
            ticker();
          }, [Math.min(state, 4)]);
          return state;
        }

        await act(async () => {
          render(<App />, container);
        });
        // 所有五次 tick 都存在并已计入。
        assertLog([0, 1, 2, 3, 4]);
        expect(container.innerHTML).toBe('5');
      });
    });

    describe('error propagation', () => {
      // @gate __DEV__
      /** 测试场景：验证「propagates errors - sync」描述的渲染、交互或错误处理结果。 */
      it('propagates errors - sync', () => {
        let err;
        try {
          act(() => {
            throw new Error('some error');
          });
        } catch (_err) {
          err = _err;
        } finally {
          expect(err instanceof Error).toBe(true);
          expect(err.message).toBe('some error');
        }
      });

      // @gate __DEV__
      /** 测试场景：验证「should propagate errors from effects - sync」描述的渲染、交互或错误处理结果。 */
      it('should propagate errors from effects - sync', () => {
        /** `runActTests.App`：封装当前用例复用的操作、回调或断言步骤。 */
        function App() {
          React.useEffect(() => {
            throw new Error('oh no');
          });
          return null;
        }
        let error;

        try {
          act(() => {
            render(<App />, container);
          });
        } catch (_error) {
          error = _error;
        } finally {
          expect(error instanceof Error).toBe(true);
          expect(error.message).toBe('oh no');
        }
      });

      // @gate __DEV__
      /** 测试场景：验证「propagates errors - async」描述的渲染、交互或错误处理结果。 */
      it('propagates errors - async', async () => {
        let err;
        try {
          await act(async () => {
            await sleep(100);
            throw new Error('some error');
          });
        } catch (_err) {
          err = _err;
        } finally {
          expect(err instanceof Error).toBe(true);
          expect(err.message).toBe('some error');
        }
      });

      // @gate __DEV__
      /** 测试场景：验证「should cleanup after errors - sync」描述的渲染、交互或错误处理结果。 */
      it('should cleanup after errors - sync', () => {
        /** `runActTests.App`：封装当前用例复用的操作、回调或断言步骤。 */
        function App() {
          React.useEffect(() => {
            Scheduler.log('oh yes');
          });
          return null;
        }
        let error;
        try {
          act(() => {
            throw new Error('oh no');
          });
        } catch (_error) {
          error = _error;
        } finally {
          expect(error instanceof Error).toBe(true);
          expect(error.message).toBe('oh no');
          // 此后仍应可以渲染组件。
          act(() => {
            render(<App />, container);
          });
          assertLog(['oh yes']);
        }
      });

      // @gate __DEV__
      /** 测试场景：验证「should cleanup after errors - async」描述的渲染、交互或错误处理结果。 */
      it('should cleanup after errors - async', async () => {
        /** `runActTests.App`：封装当前用例复用的操作、回调或断言步骤。 */
        function App() {
          /** `App.somethingAsync`：封装当前用例复用的操作、回调或断言步骤。 */
          async function somethingAsync() {
            await null;
            Scheduler.log('oh yes');
          }
          React.useEffect(() => {
            somethingAsync();
          });
          return null;
        }
        let error;
        try {
          await act(async () => {
            await sleep(100);
            throw new Error('oh no');
          });
        } catch (_error) {
          error = _error;
        } finally {
          expect(error instanceof Error).toBe(true);
          expect(error.message).toBe('oh no');
          // 此后仍应可以渲染组件。
          await act(async () => {
            render(<App />, container);
          });
          assertLog(['oh yes']);
        }
      });
    });

    describe('suspense', () => {
      if (__DEV__ && __EXPERIMENTAL__) {
        // TODO：开始使用 testing build 后移除 __DEV__ 检查。

        // @gate __DEV__
        /** 测试场景：验证「triggers fallbacks if available」描述的渲染、交互或错误处理结果。 */
        it('triggers fallbacks if available', async () => {
          let resolved = false;
          let resolve;
          const promise = new Promise(_resolve => {
            resolve = _resolve;
          });

          /** `runActTests.Suspends`：封装当前用例复用的操作、回调或断言步骤。 */
          function Suspends() {
            if (resolved) {
              return 'was suspended';
            }
            throw promise;
          }

          /** `runActTests.App`：封装当前用例复用的操作、回调或断言步骤。 */
          function App(props) {
            return (
              <React.Suspense
                fallback={<span data-test-id="spinner">loading...</span>}>
                {props.suspend ? <Suspends /> : 'content'}
              </React.Suspense>
            );
          }

          // 渲染一些内容，确保页面中有内容。
          act(() => {
            render(<App suspend={false} />, container);
          });

          // 触发一个会挂起的更新。
          act(() => {
            rerender(<App suspend={true} />);
          });
          expect(
            document.querySelector('[data-test-id=spinner]'),
          ).not.toBeNull();

          // 现在再次渲染常规内容。
          act(() => {
            rerender(<App suspend={false} />);
          });
          expect(document.querySelector('[data-test-id=spinner]')).toBeNull();

          // 触发一个带延迟的挂起更新。
          React.startTransition(() => {
            act(() => {
              rerender(<App suspend={true} />);
            });
          });

          // 在并发模式下，刷新过渡将无限期延迟。
          expect(document.querySelector('[data-test-id=spinner]')).toBeNull();

          // 兑现 Promise。
          await act(async () => {
            resolved = true;
            resolve();
          });

          // spinner 已消失，内容显示
          expect(document.querySelector('[data-test-id=spinner]')).toBeNull();
          expect(container.textContent).toBe('was suspended');
        });
      }
    });
  });
}
