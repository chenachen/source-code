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

/** 用当前计时器安排 promise 在 period 毫秒后解决 true；真实与 fake timers 用例分别负责推进时间。 */
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

  /** 为传入 dom 新建并保存根，开发用 act 包住 render；生产直接调度，用于复用同一套测试入口。 */
  const renderConcurrent = (el, dom) => {
    root = ReactDOMClient.createRoot(dom);
    if (__DEV__) {
      act(() => root.render(el));
    } else {
      root.render(el);
    }
  };

  /** 卸载当前保存的根后清 null；开发以 act 刷清理，参数 dom 不用于选择根。 */
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

  /** 对已保存根在 act 内更新，不另建根；可能被外层 act 嵌套。 */
  const rerenderConcurrent = el => {
    act(() => root.render(el));
  };

  runActTests(renderConcurrent, unmountConcurrent, rerenderConcurrent);

  describe('unacted effects', () => {

    /** 挂载一个空 passive effect，检验合法 act scope 不触发测试警告。 */
    function App() {
      React.useEffect(() => {}, []);
      return null;
    }

    // @gate __DEV__

    /** 开发环境创建根并在同步 act 内渲染含空 effect 的 App；没有额外警告断言，框架的 console 检查约束该合法作用域不报警。 */
    it('does not warn', () => {
      root = ReactDOMClient.createRoot(document.createElement('div'));
      act(() => root.render(<App />));
    });
  });
});

/** 按给定挂载/卸载/更新函数注册并发根 act 测试，setup 每例重载模块和容器，cleanup 卸载后移除容器。 */
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

      /** 同步 act 渲染 App，其 passive effect 记录 100；离开 act 后日志已有 100，验证 effect 刷新。 */
      it('can use act to flush effects', () => {

        /** effect 记录 100，供同步 act 退出时检查被动队列。 */
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

      /** 按钮初始计数 0，单次异步 act 中点三次、之后两次分别 act；effect 日志为 0/3/4/5且 DOM 为 5，验证同 scope 批量更新与每轮 effect。 */
      it('flushes effects on every call', async () => {

        /** 按钮保存计数，点击函数更新累加，effect 记录每次已提交计数。 */
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

        /** 在当前按钮派发冒泡 MouseEvent，不直接调用 React handler。 */
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

      /** effect 在 count<5 时继续加一；同步 act 返回时 DOM 已为 5，验证继续处理 effect 产生的更新直至稳定。 */
      it("should keep flushing effects until they're done", () => {

        /** effect 在 count<5 时继续排加一更新，使 act 必须刷多轮。 */
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

      /** 嵌套 act 内挂载记录 0 的 effect，内层退出时日志为空，最外层退出后为 0；验证只有最外层刷新队列。 */
      it('should flush effects only on exiting the outermost act', () => {

        /** 仅 effect 记录 0，比较嵌套 scope 内与最外 scope 退出后。 */
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

      /** 在 act 内挂载并暴露 setter，scope 外 setValue(1)；开发构建报告 App 更新未包 act，验证测试环境警告。 */
      it('warns if a setState is called outside of act(...)', () => {
        let setValue = null;

        /** 暴露当前 useState setter，让测试从 act 外触发警告。 */
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

      /** 第一次 App render 因缺省值抛错，随后合法值恢复；scope 外 setter 仍报 act 警告，验证错误未关闭环境检查。 */
      it('warns if a setState is called outside of act(...) after a component threw', () => {
        let setValue = null;

        /** 缺 defaultValue 时抛错，否则暴露 setter，检验 act 错误恢复后检查仍有效。 */
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

      /** 先 scope 外更新报错，临时 IS_REACT_ACT_ENVIRONMENT=false 时同类更新不警告，finally 恢复后再次警告；验证每次更新读取当前 flag。 */
      it('does not warn if IS_REACT_ACT_ENVIRONMENT is set to false', () => {
        let setState;

        /** 暴露 setter 给环境 flag 切换，输出当前 state。 */
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

        /** fake timers 下 effect 安排 200ms 更新并带清理，单独 act 中 runAllTimers 后 DOM 为 1；验证定时回调更新刷到提交。 */
        it('lets a ticker update', () => {

          /** effect 安排 200ms 后设 1，卸载清 timer，供 fake timers 手动推进。 */
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

        /** effect 用 sleep(200).then 更新，fake timers 的 runAllTimers 置于异步 act；退出后 DOM 为 1，验证还会处理 timer 后的 promise 微任务。 */
        it('can use the async version to catch microtasks', async () => {

          /** effect 等 sleep promise 再更新，供异步 act 同时刷 timer 与微任务。 */
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

        /** fake timers 环境中 effect 每轮 await null 后加一，依赖 Math.min(state,4) 限制五轮；异步 act 返回时 DOM 为 5，覆盖纯微任务级联。 */
        it('can handle cascading promises with fake timers', async () => {
          // 此组件触发一个 effect；effect 等待一个 tick 后设置 state，并重复 5 次。

          /** 用 min(state,4) 依赖控制五次 effect/ticker 更新，即使 fake timers 也靠微任务推进。 */
          function App() {
            const [state, setState] = React.useState(0);

            /** 等待一个微任务后函数式加一，保留每轮当前 state 的累积。 */
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

        /** effect 首轮立即设置 1并安排到 2的定时器；首次 act 内先 runAllTimers 时 effect 尚未安装，返回仅为 1，下一 act 推进 timer 才为 2。 */
        it('flushes immediate re-renders with act', () => {

          /** 首个 effect 立即从 0改1，每轮设置到2的 timer并清前一个 timer，区分 effect 刷新与时间推进。 */
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

      /** 真实计时器 effect 安排 50ms 更新，先 act 后 DOM 0，再异步 act 等 100ms；DOM 1，验证显式等待 timer 后刷新。 */
      it('works with timeouts', async () => {

        /** 初始 0，在挂载 effect 启动真实 timer，输出当前计数。 */
        function App() {
          const [ctr, setCtr] = React.useState(0);

          /** 安排 50ms 后 setCtr(1)，不自行推进真实时间。 */
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

      /** effect 的 async 函数连续 await null 三次再设置 1；await 异步 callback 的 act 后 DOM 已为 1，验证多级微任务 drain。 */
      it('flushes microtasks before exiting (async function)', async () => {

        /** 挂载 effect 调用三层 await 的更新函数，输出计数。 */
        function App() {
          const [ctr, setCtr] = React.useState(0);

          /** 连续三次 await null 后设置 1，制造多级微任务队列。 */
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

      /** 同样三层微任务更新，但 act callback 为同步函数仍 await 返回 thenable；DOM 为 1，验证等待 act 结果可继续刷异步队列。 */
      it('flushes microtasks before exiting (sync function)', async () => {
        // 如上一次测试一样。 但是传递给 `act` 的回调函数不是异步函数。

        /** 同样三层微任务更新 fixture，区别外层 act callback 的同步形式。 */
        function App() {
          const [ctr, setCtr] = React.useState(0);

          /** 经三次 await 再设置 1，供等待同步 act 返回结果的路径刷新。 */
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

      /** 调用 act(async()=>{}) 却不 await，sleep(0) 后 console.error 一次包含未等待提示；验证延迟检测非 await 异步 scope。 */
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

      /** 同时启动分别等 50/100ms 的两个 act，Promise.all 等待后再等一轮；console.error 两次重叠提示，验证异步 scope 不能交错关闭。 */
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

      /** 挂载 effect await null 后设 state=1，另 effect 记录每次 state；await act 后日志 0/1且 DOM 1，验证异步更新的提交与 effect 都完成。 */
      it('async commits and effects are guaranteed to be flushed', async () => {

        /** 一个 effect 做异步更新，另一个记录已提交 state，联合验证微任务/提交/effect。 */
        function App() {
          const [state, setState] = React.useState(0);

          /** await 一个微任务后设置 state=1。 */
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

      /** effect 日志并 await null 加一，依赖 min(state,4)；act 后日志 0到4、DOM 5，验证第五次更新后依赖不再变化而停止级联。 */
      it('can handle cascading promises', async () => {
        // 此组件触发一个 effect；effect 等待一个 tick 后设置 state，并重复 5 次。

        /** 记录 state 后启动 ticker，以 min(state,4) 依赖停止第六轮 effect。 */
        function App() {
          const [state, setState] = React.useState(0);

          /** 微任务后函数式加一，覆盖跨 effect 的连续更新。 */
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

      /** 同步 act callback 直接抛 some error，外层 catch 得到同类 Error 和 message；验证同步传播。 */
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

      /** App passive effect 抛 oh no，同步 act 刷新时向外抛该错误；验证 effect 错误也从 scope 传播。 */
      it('should propagate errors from effects - sync', () => {

        /** passive effect 抛 oh no，供同步 act 刷新错误传播。 */
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

      /** 异步 act 等 100ms 后 callback 抛 some error，await 在外层捕获 Error；验证异步拒绝传播。 */
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

      /** 同步 act callback 先抛 oh no，finally 再启动合法 act 挂载 App；effect 仍记录 oh yes，验证错误后 scope 清理允许再用。 */
      it('should cleanup after errors - sync', () => {

        /** 在先前 scope 抛错后合法挂载并记录 oh yes，验证新 scope 可用。 */
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

      /** 异步 act 等后抛 oh no，finally 再 await 合法 act；App effect 的微任务日志 oh yes出现，验证异步错误后队列与深度恢复。 */
      it('should cleanup after errors - async', async () => {

        /** effect 启动异步日志，验证前一异步 scope 失败后微任务仍被刷。 */
        function App() {

          /** 经过一个微任务再记录 oh yes。 */
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

        /** 开发实验构建先显示 content，普通更新挂起会显示 spinner，切回后 transition 挂起不显示 spinner；promise 解决输出 was suspended，验证 act 遵循普通与过渡更新的 fallback 策略。 */
        it('triggers fallbacks if available', async () => {
          let resolved = false;
          let resolve;
          const promise = new Promise(_resolve => {
            resolve = _resolve;
          });

          /** resolved 前抛共享 promise，完成后输出 was suspended。 */
          function Suspends() {
            if (resolved) {
              return 'was suspended';
            }
            throw promise;
          }

          /** 按 suspend 选择可能挂起的子组件或 content，固定 spinner fallback用于观察不同优先级策略。 */
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

          // transition 可以保留已提交 content，等待 promise；此处断言没有展示新的 spinner。
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
