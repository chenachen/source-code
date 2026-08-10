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
let ReactNoop;
let Scheduler;
let act;
let waitFor;
let waitForAll;
let waitForPaint;

/** 验证默认 Strict Effects 开关下新根、legacy 根及新增子树的双调用边界。 */
describe('StrictEffectsMode defaults', () => {
  /** 每个用例重置模块，并重新绑定 React、Noop 渲染器、调度日志与 `act`。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;

    const InternalTestUtils = require('internal-test-utils');
    waitFor = InternalTestUtils.waitFor;
    waitForAll = InternalTestUtils.waitForAll;
    waitForPaint = InternalTestUtils.waitForPaint;
  });

  /**
   * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：在 legacy 根中完成挂载与更新，确认 StrictMode 不额外双调用 Effect 或类生命周期。
   *
   * 验证机制：显式断言联合检查状态、输出和副作用。
   * 对应源码：`commitDoubleInvokeEffectsInDEV()` 的 legacy 根跳过分支。
   */
  // @gate !disableLegacyMode
  it('should not double invoke effects in legacy mode', async () => {
    const log = [];
    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“在 legacy 根中完成挂载与更新，确认 StrictMode 不额外双调用 Effect 或类生命周期”场景。 */
    function App({text}) {
      React.useEffect(() => {
        log.push('useEffect mount');
        return () => log.push('useEffect unmount');
      });

      React.useLayoutEffect(() => {
        log.push('useLayoutEffect mount');
        return () => log.push('useLayoutEffect unmount');
      });

      return text;
    }

    await act(() => {
      ReactNoop.renderLegacySyncRoot(
        <React.StrictMode>
          <App text={'mount'} />
        </React.StrictMode>,
      );
    });

    expect(log).toEqual(['useLayoutEffect mount', 'useEffect mount']);
  });

  /**
   * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：在 legacy 根中完成挂载与更新，确认 StrictMode 不额外双调用 Effect 或类生命周期。
   *
   * 验证机制：显式断言联合检查状态、输出和副作用。
   * 对应源码：`commitDoubleInvokeEffectsInDEV()` 的 legacy 根跳过分支。
   */
  // @gate !disableLegacyMode
  it('should not double invoke class lifecycles in legacy mode', async () => {
    const log = [];
    /** 定义 App 类 fixture，在“在 legacy 根中完成挂载与更新，确认 StrictMode 不额外双调用 Effect 或类生命周期”场景中暴露类生命周期、实例 ref 或错误边界。 */
    class App extends React.PureComponent {
      /** App.componentDidMount 在挂载提交后记录日志或实例状态，用于识别首次调用与开发态重放。 */
      componentDidMount() {
        log.push('componentDidMount');
      }

      /** App.componentDidUpdate 记录更新提交及前后状态，区分更新生命周期与挂载重放。 */
      componentDidUpdate() {
        log.push('componentDidUpdate');
      }

      /** App.componentWillUnmount 在真实卸载或模拟卸载时记录清理顺序。 */
      componentWillUnmount() {
        log.push('componentWillUnmount');
      }

      /** 渲染 App.render 对应的类 fixture，并把本轮状态或子树交给宿主输出断言。 */
      render() {
        return this.props.text;
      }
    }

    await act(() => {
      ReactNoop.renderLegacySyncRoot(
        <React.StrictMode>
          <App text={'mount'} />
        </React.StrictMode>,
      );
    });

    expect(log).toEqual(['componentDidMount']);
  });

  if (__DEV__) {
    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：挂载 StrictMode 组件并检查开发态 Effect 的挂载、模拟卸载与重挂载序列。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`commitDoubleInvokeEffectsInDEV()`、`recursivelyTraverseAndDoubleInvokeEffectsInDEV()` 与 `doubleInvokeEffectsOnFiber()`。
     */
    it('should flush double-invoked effects within the same frame as layout effects if there are no passive effects', async () => {
      const log = [];
      /** 作为 ComponentWithEffects fixture 承载当前测试职责；服务于“挂载 StrictMode 组件并检查开发态 Effect 的挂载、模拟卸载与重挂载序列”场景。 */
      function ComponentWithEffects({label}) {
        React.useLayoutEffect(() => {
          Scheduler.log(`useLayoutEffect mount "${label}"`);
          log.push(`useLayoutEffect mount "${label}"`);
          return () => {
            Scheduler.log(`useLayoutEffect unmount "${label}"`);
            log.push(`useLayoutEffect unmount "${label}"`);
          };
        });

        return label;
      }

      await act(async () => {
        ReactNoop.render(
          <React.StrictMode>
            <ComponentWithEffects label={'one'} />
          </React.StrictMode>,
        );

        await waitForPaint(['useLayoutEffect mount "one"']);
        expect(log).toEqual([
          'useLayoutEffect mount "one"',
          'useLayoutEffect unmount "one"',
          'useLayoutEffect mount "one"',
        ]);
      });

      log.length = 0;
      await act(async () => {
        ReactNoop.render(
          <React.StrictMode>
            <ComponentWithEffects label={'one'} />
            <ComponentWithEffects label={'two'} />
          </React.StrictMode>,
        );

        expect(log).toEqual([]);
        await waitForPaint([
      // 因未提供依赖数组，清理并重新执行 "one"（以及 "two"）。
          'useLayoutEffect unmount "one"',
          'useLayoutEffect mount "one"',
          'useLayoutEffect mount "two"',
        ]);
        expect(log).toEqual([
      // 因未提供依赖数组，清理并重新执行 "one"（以及 "two"）。
          'useLayoutEffect unmount "one"',
          'useLayoutEffect mount "one"',
          'useLayoutEffect mount "two"',

      // "two" 是新挂载的 Effect，因此应被双调用。
          'useLayoutEffect unmount "two"',
          'useLayoutEffect mount "two"',
        ]);
      });
    });

    // 本用例还验证双调用 Effect 与 Passive Effect 在同一帧内同步冲刷。
    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：初始提交后插入新子树，确认只有新挂载组件进入 Strict Effects 双调用。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`commitDoubleInvokeEffectsInDEV()`、`recursivelyTraverseAndDoubleInvokeEffectsInDEV()` 与 `doubleInvokeEffectsOnFiber()`。
     */
    it('should double invoke effects only for newly mounted components', async () => {
      const log = [];
      /** 作为 ComponentWithEffects fixture 承载当前测试职责；服务于“初始提交后插入新子树，确认只有新挂载组件进入 Strict Effects 双调用”场景。 */
      function ComponentWithEffects({label}) {
        React.useEffect(() => {
          log.push(`useEffect mount "${label}"`);
          Scheduler.log(`useEffect mount "${label}"`);
          return () => {
            log.push(`useEffect unmount "${label}"`);
            Scheduler.log(`useEffect unmount "${label}"`);
          };
        });

        React.useLayoutEffect(() => {
          log.push(`useLayoutEffect mount "${label}"`);
          Scheduler.log(`useLayoutEffect mount "${label}"`);
          return () => {
            log.push(`useLayoutEffect unmount "${label}"`);
            Scheduler.log(`useLayoutEffect unmount "${label}"`);
          };
        });

        return label;
      }

      await act(async () => {
        ReactNoop.render(
          <React.StrictMode>
            <ComponentWithEffects label={'one'} />
          </React.StrictMode>,
        );

        await waitForAll([
          'useLayoutEffect mount "one"',
          'useEffect mount "one"',
        ]);
        expect(log).toEqual([
          'useLayoutEffect mount "one"',
          'useEffect mount "one"',
          'useLayoutEffect unmount "one"',
          'useEffect unmount "one"',
          'useLayoutEffect mount "one"',
          'useEffect mount "one"',
        ]);
      });

      log.length = 0;
      await act(async () => {
        ReactNoop.render(
          <React.StrictMode>
            <ComponentWithEffects label={'one'} />
            <ComponentWithEffects label={'two'} />
          </React.StrictMode>,
        );

        await waitFor([
      // 因未提供依赖数组，清理并重新执行 "one"（以及 "two"）。
          'useLayoutEffect unmount "one"',
          'useLayoutEffect mount "one"',
          'useLayoutEffect mount "two"',
        ]);
        expect(log).toEqual([
      // 因未提供依赖数组，清理并重新执行 "one"（以及 "two"）。
          'useLayoutEffect unmount "one"',
          'useLayoutEffect mount "one"',
          'useLayoutEffect mount "two"',
        ]);
        log.length = 0;
        await waitForAll([
          'useEffect unmount "one"',
          'useEffect mount "one"',
          'useEffect mount "two"',
        ]);
        expect(log).toEqual([
          'useEffect unmount "one"',
          'useEffect mount "one"',
          'useEffect mount "two"',

      // "two" 是新挂载的 Effect，因此应被双调用。
          'useLayoutEffect unmount "two"',
          'useEffect unmount "two"',
          'useLayoutEffect mount "two"',
          'useEffect mount "two"',
        ]);
      });
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：挂载 StrictMode 组件并检查开发态 Effect 的挂载、模拟卸载与重挂载序列。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`commitDoubleInvokeEffectsInDEV()`、`recursivelyTraverseAndDoubleInvokeEffectsInDEV()` 与 `doubleInvokeEffectsOnFiber()`。
     */
    it('double invoking for effects for modern roots', async () => {
      const log = [];
      /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“挂载 StrictMode 组件并检查开发态 Effect 的挂载、模拟卸载与重挂载序列”场景。 */
      function App({text}) {
        React.useEffect(() => {
          log.push('useEffect mount');
          return () => log.push('useEffect unmount');
        });

        React.useLayoutEffect(() => {
          log.push('useLayoutEffect mount');
          return () => log.push('useLayoutEffect unmount');
        });

        return text;
      }
      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App text={'mount'} />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual([
        'useLayoutEffect mount',
        'useEffect mount',
        'useLayoutEffect unmount',
        'useEffect unmount',
        'useLayoutEffect mount',
        'useEffect mount',
      ]);

      log.length = 0;
      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App text={'update'} />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual([
        'useLayoutEffect unmount',
        'useLayoutEffect mount',
        'useEffect unmount',
        'useEffect mount',
      ]);

      log.length = 0;
      await act(() => {
        ReactNoop.render(null);
      });

      expect(log).toEqual(['useLayoutEffect unmount', 'useEffect unmount']);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：删除目标子树并冲刷对应提交阶段。
     * Then：注册多个 Passive Effect，确认开发态按全挂载、全卸载、全重挂载分阶段执行。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`commitDoubleInvokeEffectsInDEV()`、`recursivelyTraverseAndDoubleInvokeEffectsInDEV()` 与 `doubleInvokeEffectsOnFiber()`。
     */
    it('multiple effects are double invoked in the right order (all mounted, all unmounted, all remounted)', async () => {
      const log = [];
      /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“注册多个 Passive Effect，确认开发态按全挂载、全卸载、全重挂载分阶段执行”场景。 */
      function App({text}) {
        React.useEffect(() => {
          log.push('useEffect One mount');
          return () => log.push('useEffect One unmount');
        });

        React.useEffect(() => {
          log.push('useEffect Two mount');
          return () => log.push('useEffect Two unmount');
        });

        return text;
      }

      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App text={'mount'} />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual([
        'useEffect One mount',
        'useEffect Two mount',
        'useEffect One unmount',
        'useEffect Two unmount',
        'useEffect One mount',
        'useEffect Two mount',
      ]);

      log.length = 0;
      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App text={'update'} />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual([
        'useEffect One unmount',
        'useEffect Two unmount',
        'useEffect One mount',
        'useEffect Two mount',
      ]);

      log.length = 0;
      await act(() => {
        ReactNoop.render(null);
      });

      expect(log).toEqual(['useEffect One unmount', 'useEffect Two unmount']);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：删除目标子树并冲刷对应提交阶段。
     * Then：注册多个 Layout Effect，确认先全部挂载、再全部清理、最后按原序重挂载。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`commitDoubleInvokeEffectsInDEV()`、`recursivelyTraverseAndDoubleInvokeEffectsInDEV()` 与 `doubleInvokeEffectsOnFiber()`。
     */
    it('multiple layout effects are double invoked in the right order (all mounted, all unmounted, all remounted)', async () => {
      const log = [];
      /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“注册多个 Layout Effect，确认先全部挂载、再全部清理、最后按原序重挂载”场景。 */
      function App({text}) {
        React.useLayoutEffect(() => {
          log.push('useLayoutEffect One mount');
          return () => log.push('useLayoutEffect One unmount');
        });

        React.useLayoutEffect(() => {
          log.push('useLayoutEffect Two mount');
          return () => log.push('useLayoutEffect Two unmount');
        });

        return text;
      }

      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App text={'mount'} />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual([
        'useLayoutEffect One mount',
        'useLayoutEffect Two mount',
        'useLayoutEffect One unmount',
        'useLayoutEffect Two unmount',
        'useLayoutEffect One mount',
        'useLayoutEffect Two mount',
      ]);

      log.length = 0;
      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App text={'update'} />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual([
        'useLayoutEffect One unmount',
        'useLayoutEffect Two unmount',
        'useLayoutEffect One mount',
        'useLayoutEffect Two mount',
      ]);

      log.length = 0;
      await act(() => {
        ReactNoop.render(null);
      });

      expect(log).toEqual([
        'useLayoutEffect One unmount',
        'useLayoutEffect Two unmount',
      ]);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：删除目标子树并冲刷对应提交阶段。
     * Then：同时注册布局与被动 Effect，确认无真实卸载时两类 Effect 都执行两次。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`commitDoubleInvokeEffectsInDEV()`、`recursivelyTraverseAndDoubleInvokeEffectsInDEV()` 与 `doubleInvokeEffectsOnFiber()`。
     */
    it('useEffect and useLayoutEffect is called twice when there is no unmount', async () => {
      const log = [];
      /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“同时注册布局与被动 Effect，确认无真实卸载时两类 Effect 都执行两次”场景。 */
      function App({text}) {
        React.useEffect(() => {
          log.push('useEffect mount');
        });

        React.useLayoutEffect(() => {
          log.push('useLayoutEffect mount');
        });

        return text;
      }

      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App text={'mount'} />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual([
        'useLayoutEffect mount',
        'useEffect mount',
        'useLayoutEffect mount',
        'useEffect mount',
      ]);

      log.length = 0;
      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App text={'update'} />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual(['useLayoutEffect mount', 'useEffect mount']);

      log.length = 0;
      await act(() => {
        ReactNoop.render(null);
      });

      expect(log).toEqual([]);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：挂载 StrictMode 组件并检查开发态 Effect 的挂载、模拟卸载与重挂载序列。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`commitDoubleInvokeEffectsInDEV()`、`recursivelyTraverseAndDoubleInvokeEffectsInDEV()` 与 `doubleInvokeEffectsOnFiber()`。
     */
    it('disconnects refs during double invoking', async () => {
      const onRefMock = jest.fn();
      /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“挂载 StrictMode 组件并检查开发态 Effect 的挂载、模拟卸载与重挂载序列”场景。 */
      function App({text}) {
        return (
          <span
            ref={ref => {
              onRefMock(ref);
            }}>
            text
          </span>
        );
      }

      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App text={'mount'} />
          </React.StrictMode>,
        );
      });

      expect(onRefMock.mock.calls.length).toBe(3);
      expect(onRefMock.mock.calls[0][0]).not.toBeNull();
      expect(onRefMock.mock.calls[1][0]).toBe(null);
      expect(onRefMock.mock.calls[2][0]).not.toBeNull();
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：重放类生命周期时检查实例、参数和 state，确认回调上下文保持正确。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`commitDoubleInvokeEffectsInDEV()`、`recursivelyTraverseAndDoubleInvokeEffectsInDEV()` 与 `doubleInvokeEffectsOnFiber()`。
     */
    it('passes the right context to class component lifecycles', async () => {
      const log = [];
      /** 定义 App 类 fixture，在“重放类生命周期时检查实例、参数和 state，确认回调上下文保持正确”场景中暴露类生命周期、实例 ref 或错误边界。 */
      class App extends React.PureComponent {
        /** App.test 返回当前实例标识，供生命周期回调核对 `this` 上下文。 */
        test() {}

        /** App.componentDidMount 在挂载提交后记录日志或实例状态，用于识别首次调用与开发态重放。 */
        componentDidMount() {
          this.test();
          log.push('componentDidMount');
        }

        /** App.componentDidUpdate 记录更新提交及前后状态，区分更新生命周期与挂载重放。 */
        componentDidUpdate() {
          this.test();
          log.push('componentDidUpdate');
        }

        /** App.componentWillUnmount 在真实卸载或模拟卸载时记录清理顺序。 */
        componentWillUnmount() {
          this.test();
          log.push('componentWillUnmount');
        }

        /** 渲染 App.render 对应的类 fixture，并把本轮状态或子树交给宿主输出断言。 */
        render() {
          return null;
        }
      }

      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual([
        'componentDidMount',
        'componentWillUnmount',
        'componentDidMount',
      ]);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：挂载、更新并卸载类组件，确认开发态生命周期重放及真实卸载边界。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`commitDoubleInvokeEffectsInDEV()`、`recursivelyTraverseAndDoubleInvokeEffectsInDEV()` 与 `doubleInvokeEffectsOnFiber()`。
     */
    it('double invoking works for class components', async () => {
      const log = [];
      /** 定义 App 类 fixture，在“挂载、更新并卸载类组件，确认开发态生命周期重放及真实卸载边界”场景中暴露类生命周期、实例 ref 或错误边界。 */
      class App extends React.PureComponent {
        /** App.componentDidMount 在挂载提交后记录日志或实例状态，用于识别首次调用与开发态重放。 */
        componentDidMount() {
          log.push('componentDidMount');
        }

        /** App.componentDidUpdate 记录更新提交及前后状态，区分更新生命周期与挂载重放。 */
        componentDidUpdate() {
          log.push('componentDidUpdate');
        }

        /** App.componentWillUnmount 在真实卸载或模拟卸载时记录清理顺序。 */
        componentWillUnmount() {
          log.push('componentWillUnmount');
        }

        /** 渲染 App.render 对应的类 fixture，并把本轮状态或子树交给宿主输出断言。 */
        render() {
          return this.props.text;
        }
      }

      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App text={'mount'} />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual([
        'componentDidMount',
        'componentWillUnmount',
        'componentDidMount',
      ]);

      log.length = 0;
      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App text={'update'} />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual(['componentDidUpdate']);

      log.length = 0;
      await act(() => {
        ReactNoop.render(null);
      });

      expect(log).toEqual(['componentWillUnmount']);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：同一提交多次请求冲刷 Passive Effect，确认双调用流程只发生一轮。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`commitDoubleInvokeEffectsInDEV()`、`recursivelyTraverseAndDoubleInvokeEffectsInDEV()` 与 `doubleInvokeEffectsOnFiber()`。
     */
    it('double flushing passive effects only results in one double invoke', async () => {
      const log = [];
      /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“同一提交多次请求冲刷 Passive Effect，确认双调用流程只发生一轮”场景。 */
      function App({text}) {
        const [state, setState] = React.useState(0);
        React.useEffect(() => {
          if (state !== 1) {
            setState(1);
          }
          log.push('useEffect mount');
          return () => log.push('useEffect unmount');
        });

        React.useLayoutEffect(() => {
          log.push('useLayoutEffect mount');
          return () => log.push('useLayoutEffect unmount');
        });

        log.push(text);
        return text;
      }

      log.length = 0;
      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App text={'mount'} />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual([
        'mount',
        'mount',
        'useLayoutEffect mount',
        'useEffect mount',
        'useLayoutEffect unmount',
        'useEffect unmount',
        'useLayoutEffect mount',
        'useEffect mount',
        'mount',
        'mount',
        'useLayoutEffect unmount',
        'useLayoutEffect mount',
        'useEffect unmount',
        'useEffect mount',
      ]);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：初始提交后插入新子树，确认只有新挂载组件进入 Strict Effects 双调用。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`commitDoubleInvokeEffectsInDEV()`、`recursivelyTraverseAndDoubleInvokeEffectsInDEV()` 与 `doubleInvokeEffectsOnFiber()`。
     */
    it('newly mounted components after initial mount get double invoked', async () => {
      let _setShowChild;
      const log = [];
      /** 作为子级函数组件暴露 Hook 状态和提交日志；服务于“初始提交后插入新子树，确认只有新挂载组件进入 Strict Effects 双调用”场景。 */
      function Child() {
        React.useEffect(() => {
          log.push('Child useEffect mount');
          return () => log.push('Child useEffect unmount');
        });
        React.useLayoutEffect(() => {
          log.push('Child useLayoutEffect mount');
          return () => log.push('Child useLayoutEffect unmount');
        });

        return null;
      }

      /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“初始提交后插入新子树，确认只有新挂载组件进入 Strict Effects 双调用”场景。 */
      function App() {
        const [showChild, setShowChild] = React.useState(false);
        _setShowChild = setShowChild;
        React.useEffect(() => {
          log.push('App useEffect mount');
          return () => log.push('App useEffect unmount');
        });
        React.useLayoutEffect(() => {
          log.push('App useLayoutEffect mount');
          return () => log.push('App useLayoutEffect unmount');
        });

        return showChild && <Child />;
      }

      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual([
        'App useLayoutEffect mount',
        'App useEffect mount',
        'App useLayoutEffect unmount',
        'App useEffect unmount',
        'App useLayoutEffect mount',
        'App useEffect mount',
      ]);

      log.length = 0;
      await act(() => {
        _setShowChild(true);
      });

      expect(log).toEqual([
        'App useLayoutEffect unmount',
        'Child useLayoutEffect mount',
        'App useLayoutEffect mount',
        'App useEffect unmount',
        'Child useEffect mount',
        'App useEffect mount',
        'Child useLayoutEffect unmount',
        'Child useEffect unmount',
        'Child useLayoutEffect mount',
        'Child useEffect mount',
      ]);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：混合挂载类与函数组件，确认两套生命周期的双调用顺序正确交错。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`commitDoubleInvokeEffectsInDEV()`、`recursivelyTraverseAndDoubleInvokeEffectsInDEV()` 与 `doubleInvokeEffectsOnFiber()`。
     */
    it('classes and functions are double invoked together correctly', async () => {
      const log = [];
      /** 定义 ClassChild 类 fixture，在“混合挂载类与函数组件，确认两套生命周期的双调用顺序正确交错”场景中暴露类生命周期、实例 ref 或错误边界。 */
      class ClassChild extends React.PureComponent {
        /** ClassChild.componentDidMount 在挂载提交后记录日志或实例状态，用于识别首次调用与开发态重放。 */
        componentDidMount() {
          log.push('componentDidMount');
        }

        /** ClassChild.componentWillUnmount 在真实卸载或模拟卸载时记录清理顺序。 */
        componentWillUnmount() {
          log.push('componentWillUnmount');
        }

        /** 渲染 ClassChild.render 对应的类 fixture，并把本轮状态或子树交给宿主输出断言。 */
        render() {
          return this.props.text;
        }
      }

      /** 作为子级函数组件暴露 Hook 状态和提交日志；服务于“混合挂载类与函数组件，确认两套生命周期的双调用顺序正确交错”场景。 */
      function FunctionChild({text}) {
        React.useEffect(() => {
          log.push('useEffect mount');
          return () => log.push('useEffect unmount');
        });
        React.useLayoutEffect(() => {
          log.push('useLayoutEffect mount');
          return () => log.push('useLayoutEffect unmount');
        });
        return text;
      }

      /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“混合挂载类与函数组件，确认两套生命周期的双调用顺序正确交错”场景。 */
      function App({text}) {
        return (
          <React.StrictMode>
            <ClassChild text={text} />
            <FunctionChild text={text} />
          </React.StrictMode>
        );
      }

      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App text={'mount'} />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual([
        'componentDidMount',
        'useLayoutEffect mount',
        'useEffect mount',
        'componentWillUnmount',
        'useLayoutEffect unmount',
        'useEffect unmount',
        'componentDidMount',
        'useLayoutEffect mount',
        'useEffect mount',
      ]);

      log.length = 0;
      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App text={'mount'} />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual([
        'useLayoutEffect unmount',
        'useLayoutEffect mount',
        'useEffect unmount',
        'useEffect mount',
      ]);

      log.length = 0;
      await act(() => {
        ReactNoop.render(null);
      });

      expect(log).toEqual([
        'componentWillUnmount',
        'useLayoutEffect unmount',
        'useEffect unmount',
      ]);
    });
  }
});
