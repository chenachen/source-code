/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

/* eslint-disable no-func-assign */

'use strict';

let React;
let ReactTestRenderer;
let Scheduler;
let ReactDOMServer;
let act;
let assertLog;
let assertConsoleErrorDev;
let waitForAll;
let waitForThrow;

/** 验证 Hooks 开发态诊断、提前退出、渲染阶段更新、调用顺序与错误恢复的内部不变量。 */
describe('ReactHooks', () => {
  /** 每个用例重置模块与警告状态，并重新绑定 React、Noop 渲染器、调度日志及内部断言工具。 */
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactTestRenderer = require('react-test-renderer');
    Scheduler = require('scheduler');
    ReactDOMServer = require('react-dom/server');
    act = require('internal-test-utils').act;

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;
    waitForAll = InternalTestUtils.waitForAll;
    waitForThrow = InternalTestUtils.waitForThrow;
  });

  if (__DEV__) {
    // `useDebugValue` 仅在开发态生效。
    /**
     * Given：目标组件已进入可触发开发态保护的最小运行环境。
     * When：执行用例中的非法 Hook、参数或阶段调用。
     * Then：在类组件中调用仅函数组件可用的 Hook，确认无 dispatcher 时立即抛错。
     *
     * 验证机制：异常断言保留原始错误与阶段边界。
     * 对应源码：`renderWithHooks()`、`warnOnHookMismatchInDev()` 与开发态 dispatcher。
     */
    it('useDebugValue throws when used in a class component', async () => {
      /** 定义 Example 类 fixture，在“在类组件中调用仅函数组件可用的 Hook，确认无 dispatcher 时立即抛错”场景中暴露类生命周期、实例 ref 或错误边界。 */
      class Example extends React.Component {
        /** 渲染 Example.render 对应的类 fixture，并把本轮状态或子树交给宿主输出断言。 */
        render() {
          React.useDebugValue('abc');
          return null;
        }
      }
      await expect(async () => {
        await act(() => {
          ReactTestRenderer.create(<Example />, {
            unstable_isConcurrent: true,
          });
        });
      }).rejects.toThrow(
        'Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen' +
          ' for one of the following reasons:\n' +
          '1. You might have mismatching versions of React and the renderer (such as React DOM)\n' +
          '2. You might be breaking the Rules of Hooks\n' +
          '3. You might have more than one copy of React in the same app\n' +
          'See https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem.',
      );
    });
  }

  /**
   * Given：安排相同值与差异值更新，确认状态队列只在满足不变量时提前退出渲染所需的初始状态、更新入口与观测日志均已建立。
   * When：安排用例指定的状态、属性、Context 或依赖更新。
   * Then：安排相同值与差异值更新，确认状态队列只在满足不变量时提前退出渲染。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
   * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `bailoutHooks()`。
   */
  it('bails out in the render phase if all of the state is the same', async () => {
    const {useState, useLayoutEffect} = React;

    /** 作为子级函数组件暴露 Hook 状态和提交日志；服务于“安排相同值与差异值更新，确认状态队列只在满足不变量时提前退出渲染”场景。 */
    function Child({text}) {
      Scheduler.log('Child: ' + text);
      return text;
    }

    let setCounter1;
    let setCounter2;
    /** 作为父级 fixture 持有状态、Context 或子树边界；服务于“安排相同值与差异值更新，确认状态队列只在满足不变量时提前退出渲染”场景。 */
    function Parent() {
      const [counter1, _setCounter1] = useState(0);
      setCounter1 = _setCounter1;
      const [counter2, _setCounter2] = useState(0);
      setCounter2 = _setCounter2;

      const text = `${counter1}, ${counter2}`;
      Scheduler.log(`Parent: ${text}`);
      useLayoutEffect(() => {
        Scheduler.log(`Effect: ${text}`);
      });
      return <Child text={text} />;
    }

    const root = ReactTestRenderer.create(null, {unstable_isConcurrent: true});
    root.update(<Parent />);
    await waitForAll(['Parent: 0, 0', 'Child: 0, 0', 'Effect: 0, 0']);
    expect(root).toMatchRenderedOutput('0, 0');

    // 执行普通更新。
    await act(() => {
      setCounter1(1);
      setCounter2(1);
    });

    assertLog(['Parent: 1, 1', 'Child: 1, 1', 'Effect: 1, 1']);

    // 执行会提前退出的更新。
    await act(() => setCounter1(1));
    assertLog(['Parent: 1, 1']);

    // 这次只有一个 state 更新命中新值，另一个未命中，因此不能提前退出。
    await act(() => {
      setCounter1(1);
      setCounter2(2);
    });

    assertLog(['Parent: 1, 2', 'Child: 1, 2', 'Effect: 1, 2']);

    // 安排多次更新，但最终都归并为当前值。
    await act(() => {
      setCounter1(9);
      setCounter2(3);
      setCounter1(4);
      setCounter2(7);
      setCounter1(1);
      setCounter2(2);
    });

    // 最终值与当前值相同，因此组件提前退出。
    assertLog(['Parent: 1, 2']);

    // 准备检查 SameValue 语义。
    await act(() => {
      setCounter1(0 / -1);
      setCounter2(NaN);
    });

    assertLog(['Parent: 0, NaN', 'Child: 0, NaN', 'Effect: 0, NaN']);

    // 检查再次设为负零或 NaN 时是否仍可提前退出。
    await act(() => {
      setCounter1(0 / -1);
      setCounter2(NaN);
      setCounter2(Infinity);
      setCounter2(NaN);
    });

    assertLog(['Parent: 0, NaN']);

    // 检查从负零改为正零时不会提前退出。
    await act(() => {
      setCounter1(0);
    });
    assertLog(['Parent: 0, NaN', 'Child: 0, NaN', 'Effect: 0, NaN']);
  });

  /**
   * Given：安排相同值与差异值更新，确认状态队列只在满足不变量时提前退出渲染所需的初始状态、更新入口与观测日志均已建立。
   * When：安排用例指定的状态、属性、Context 或依赖更新。
   * Then：安排相同值与差异值更新，确认状态队列只在满足不变量时提前退出渲染。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
   * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `bailoutHooks()`。
   */
  it('bails out in render phase if all the state is the same and props bail out with memo', async () => {
    const {useState, memo} = React;

    /** 作为子级函数组件暴露 Hook 状态和提交日志；服务于“安排相同值与差异值更新，确认状态队列只在满足不变量时提前退出渲染”场景。 */
    function Child({text}) {
      Scheduler.log('Child: ' + text);
      return text;
    }

    let setCounter1;
    let setCounter2;
    /** 作为父级 fixture 持有状态、Context 或子树边界；服务于“安排相同值与差异值更新，确认状态队列只在满足不变量时提前退出渲染”场景。 */
    function Parent({theme}) {
      const [counter1, _setCounter1] = useState(0);
      setCounter1 = _setCounter1;
      const [counter2, _setCounter2] = useState(0);
      setCounter2 = _setCounter2;

      const text = `${counter1}, ${counter2} (${theme})`;
      Scheduler.log(`Parent: ${text}`);
      return <Child text={text} />;
    }

    Parent = memo(Parent);

    const root = ReactTestRenderer.create(null, {unstable_isConcurrent: true});
    root.update(<Parent theme="light" />);
    await waitForAll(['Parent: 0, 0 (light)', 'Child: 0, 0 (light)']);
    expect(root).toMatchRenderedOutput('0, 0 (light)');

    // 执行普通更新。
    await act(() => {
      setCounter1(1);
      setCounter2(1);
    });

    assertLog(['Parent: 1, 1 (light)', 'Child: 1, 1 (light)']);

    // 执行会提前退出的更新。
    await act(() => setCounter1(1));
    assertLog(['Parent: 1, 1 (light)']);

    // 这次只有一个 state 更新命中新值，另一个未命中，因此不能提前退出。
    await act(() => {
      setCounter1(1);
      setCounter2(2);
    });

    assertLog(['Parent: 1, 2 (light)', 'Child: 1, 2 (light)']);

    // 状态更新可提前退出，但 props 已变化，所以组件仍需渲染。
    await act(() => {
      setCounter1(1);
      setCounter2(2);
      root.update(<Parent theme="dark" />);
    });

    assertLog(['Parent: 1, 2 (dark)', 'Child: 1, 2 (dark)']);

    // props 与 state 均满足提前退出条件。
    await act(() => {
      setCounter1(1);
      setCounter2(2);
      root.update(<Parent theme="dark" />);
    });

    assertLog(['Parent: 1, 2 (dark)']);
  });

  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：向 Hook 更新函数传入不受支持的第二参数，确认开发态给出迁移指引。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果，开发态控制台断言限定诊断内容与去重。
   * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `bailoutHooks()`。
   */
  it('warns about setState second argument', async () => {
    const {useState} = React;

    let setCounter;
    /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“向 Hook 更新函数传入不受支持的第二参数，确认开发态给出迁移指引”场景。 */
    function Counter() {
      const [counter, _setCounter] = useState(0);
      setCounter = _setCounter;

      Scheduler.log(`Count: ${counter}`);
      return counter;
    }

    const root = ReactTestRenderer.create(null, {unstable_isConcurrent: true});
    root.update(<Counter />);
    await waitForAll(['Count: 0']);
    expect(root).toMatchRenderedOutput('0');

    await act(() =>
      setCounter(1, () => {
        throw new Error('Expected to ignore the callback.');
      }),
    );
    assertConsoleErrorDev([
      'State updates from the useState() and useReducer() Hooks ' +
        "don't support the second callback argument. " +
        'To execute a side effect after rendering, ' +
        'declare it in the component body with useEffect().',
    ]);
    assertLog(['Count: 1']);
    expect(root).toMatchRenderedOutput('1');
  });

  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：向 Hook 更新函数传入不受支持的第二参数，确认开发态给出迁移指引。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果，开发态控制台断言限定诊断内容与去重。
   * 对应源码：`renderWithHooks()` 与对应 Hook dispatcher 分支。
   */
  it('warns about dispatch second argument', async () => {
    const {useReducer} = React;

    let dispatch;
    /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“向 Hook 更新函数传入不受支持的第二参数，确认开发态给出迁移指引”场景。 */
    function Counter() {
      const [counter, _dispatch] = useReducer((s, a) => a, 0);
      dispatch = _dispatch;

      Scheduler.log(`Count: ${counter}`);
      return counter;
    }

    const root = ReactTestRenderer.create(null, {unstable_isConcurrent: true});
    root.update(<Counter />);
    await waitForAll(['Count: 0']);
    expect(root).toMatchRenderedOutput('0');

    await act(() =>
      dispatch(1, () => {
        throw new Error('Expected to ignore the callback.');
      }),
    );
    assertConsoleErrorDev([
      'State updates from the useState() and useReducer() Hooks ' +
        "don't support the second callback argument. " +
        'To execute a side effect after rendering, ' +
        'declare it in the component body with useEffect().',
    ]);
    assertLog(['Count: 1']);
    expect(root).toMatchRenderedOutput('1');
  });

  /**
   * Given：安排相同值与差异值更新，确认状态队列只在满足不变量时提前退出渲染所需的初始状态、更新入口与观测日志均已建立。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：安排相同值与差异值更新，确认状态队列只在满足不变量时提前退出渲染。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
   * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `bailoutHooks()`。
   */
  it('never bails out if context has changed', async () => {
    const {useState, useLayoutEffect, useContext} = React;

    const ThemeContext = React.createContext('light');

    let setTheme;
    /** 作为 ThemeProvider fixture 承载当前测试职责；服务于“安排相同值与差异值更新，确认状态队列只在满足不变量时提前退出渲染”场景。 */
    function ThemeProvider({children}) {
      const [theme, _setTheme] = useState('light');
      Scheduler.log('Theme: ' + theme);
      setTheme = _setTheme;
      return (
        <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
      );
    }

    /** 作为子级函数组件暴露 Hook 状态和提交日志；服务于“安排相同值与差异值更新，确认状态队列只在满足不变量时提前退出渲染”场景。 */
    function Child({text}) {
      Scheduler.log('Child: ' + text);
      return text;
    }

    let setCounter;
    /** 作为父级 fixture 持有状态、Context 或子树边界；服务于“安排相同值与差异值更新，确认状态队列只在满足不变量时提前退出渲染”场景。 */
    function Parent() {
      const [counter, _setCounter] = useState(0);
      setCounter = _setCounter;

      const theme = useContext(ThemeContext);

      const text = `${counter} (${theme})`;
      Scheduler.log(`Parent: ${text}`);
      useLayoutEffect(() => {
        Scheduler.log(`Effect: ${text}`);
      });
      return <Child text={text} />;
    }
    const root = ReactTestRenderer.create(null, {unstable_isConcurrent: true});
    await act(() => {
      root.update(
        <ThemeProvider>
          <Parent />
        </ThemeProvider>,
      );
    });

    assertLog([
      'Theme: light',
      'Parent: 0 (light)',
      'Child: 0 (light)',
      'Effect: 0 (light)',
    ]);
    expect(root).toMatchRenderedOutput('0 (light)');

    // 把 theme 更新为相同值不会让 Context 消费者重新渲染。
    setTheme('light');
    await waitForAll([]);
    expect(root).toMatchRenderedOutput('0 (light)');

    // 执行普通更新。
    await act(() => setCounter(1));
    assertLog(['Parent: 1 (light)', 'Child: 1 (light)', 'Effect: 1 (light)']);
    expect(root).toMatchRenderedOutput('1 (light)');

    // 更新未改变 state，因此提前退出。
    await act(() => setCounter(1));
    assertLog(['Parent: 1 (light)']);
    expect(root).toMatchRenderedOutput('1 (light)');

    // 更新未改变 state，但 Context 同时变化，因此不能提前退出。
    await act(() => {
      setCounter(1);
      setTheme('dark');
    });

    assertLog([
      'Theme: dark',
      'Parent: 1 (dark)',
      'Child: 1 (dark)',
      'Effect: 1 (dark)',
    ]);
    expect(root).toMatchRenderedOutput('1 (dark)');
  });

  /**
   * Given：安排相同值与差异值更新，确认状态队列只在满足不变量时提前退出渲染所需的初始状态、更新入口与观测日志均已建立。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：安排相同值与差异值更新，确认状态队列只在满足不变量时提前退出渲染。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
   * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `bailoutHooks()`。
   */
  it('can bail out without calling render phase (as an optimization) if queue is known to be empty', async () => {
    const {useState, useLayoutEffect} = React;

    /** 作为子级函数组件暴露 Hook 状态和提交日志；服务于“安排相同值与差异值更新，确认状态队列只在满足不变量时提前退出渲染”场景。 */
    function Child({text}) {
      Scheduler.log('Child: ' + text);
      return text;
    }

    let setCounter;
    /** 作为父级 fixture 持有状态、Context 或子树边界；服务于“安排相同值与差异值更新，确认状态队列只在满足不变量时提前退出渲染”场景。 */
    function Parent() {
      const [counter, _setCounter] = useState(0);
      setCounter = _setCounter;
      Scheduler.log('Parent: ' + counter);
      useLayoutEffect(() => {
        Scheduler.log('Effect: ' + counter);
      });
      return <Child text={counter} />;
    }

    const root = ReactTestRenderer.create(null, {unstable_isConcurrent: true});
    root.update(<Parent />);
    await waitForAll(['Parent: 0', 'Child: 0', 'Effect: 0']);
    expect(root).toMatchRenderedOutput('0');

    // 执行普通更新。
    await act(() => setCounter(1));
    assertLog(['Parent: 1', 'Child: 1', 'Effect: 1']);
    expect(root).toMatchRenderedOutput('1');

    // 更新为相同 state。alternate Fiber 仍带待处理优先级，React 无法确认队列为空，所以必须进入渲染阶段后才能退出；退出发生在子组件渲染前，也不会触发 Effect。
    await act(() => setCounter(1));
    assertLog(['Parent: 1']);
    expect(root).toMatchRenderedOutput('1');

    // 再次更新为相同 state。此时两个 Fiber 都没有待处理优先级，因此可在进入渲染阶段前直接退出。
    await act(() => setCounter(1));
    await waitForAll([]);
    expect(root).toMatchRenderedOutput('1');

    // 该更新把 state 改为不同值，因此正常渲染。
    await act(() => setCounter(2));
    assertLog(['Parent: 2', 'Child: 2', 'Effect: 2']);
    expect(root).toMatchRenderedOutput('2');

    // 准备检查 SameValue 语义。
    await act(() => {
      setCounter(0);
    });
    assertLog(['Parent: 0', 'Child: 0', 'Effect: 0']);
    expect(root).toMatchRenderedOutput('0');

    // 首次更新为相同 state，以冲刷更新队列。
    await act(() => {
      setCounter(0);
    });

    assertLog(['Parent: 0']);
    expect(root).toMatchRenderedOutput('0');

    // 再次更新为相同 state，应提前退出。
    await act(() => {
      setCounter(0);
    });
    await waitForAll([]);
    expect(root).toMatchRenderedOutput('0');

    // 把 state 从正零更新为负零。
    await act(() => {
      setCounter(0 / -1);
    });
    assertLog(['Parent: 0', 'Child: 0', 'Effect: 0']);
    expect(root).toMatchRenderedOutput('0');
  });

  /**
   * Given：安排相同值与差异值更新，确认状态队列只在满足不变量时提前退出渲染所需的初始状态、更新入口与观测日志均已建立。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：安排相同值与差异值更新，确认状态队列只在满足不变量时提前退出渲染。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
   * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `bailoutHooks()`。
   */
  it('bails out multiple times in a row without entering render phase', async () => {
    const {useState} = React;

    /** 作为子级函数组件暴露 Hook 状态和提交日志；服务于“安排相同值与差异值更新，确认状态队列只在满足不变量时提前退出渲染”场景。 */
    function Child({text}) {
      Scheduler.log('Child: ' + text);
      return text;
    }

    let setCounter;
    /** 作为父级 fixture 持有状态、Context 或子树边界；服务于“安排相同值与差异值更新，确认状态队列只在满足不变量时提前退出渲染”场景。 */
    function Parent() {
      const [counter, _setCounter] = useState(0);
      setCounter = _setCounter;
      Scheduler.log('Parent: ' + counter);
      return <Child text={counter} />;
    }

    const root = ReactTestRenderer.create(null, {unstable_isConcurrent: true});
    root.update(<Parent />);
    await waitForAll(['Parent: 0', 'Child: 0']);
    expect(root).toMatchRenderedOutput('0');

    /** update 暴露当前组件的状态更新入口，使测试能在提交外安排指定优先级更新。 */
    const update = value => {
      setCounter(previous => {
        Scheduler.log(`Compute state (${previous} -> ${value})`);
        return value;
      });
    };
    ReactTestRenderer.unstable_batchedUpdates(() => {
      update(0);
      update(0);
      update(0);
      update(1);
      update(2);
      update(3);
    });

    assertLog([
      // 前四个更新进入队列前队列均为空，因此可急切计算下一状态。
      'Compute state (0 -> 0)',
      'Compute state (0 -> 0)',
      'Compute state (0 -> 0)',
      // 第四个更新不能提前退出。
      'Compute state (0 -> 1)',
      // 因此后续更新不能再急切计算。
    ]);

    // 现在进入渲染阶段。
    await waitForAll([
      // 前四个更新已有急切结果，无需重算；只计算最后两个。
      'Compute state (1 -> 2)',
      'Compute state (2 -> 3)',
      'Parent: 3',
      'Child: 3',
    ]);
    expect(root).toMatchRenderedOutput('3');
  });

  /**
   * Given：让低优先级更新被高优先级更新打断，确认跳过更新随后按队列顺序 rebase所需的初始状态、更新入口与观测日志均已建立。
   * When：安排用例指定的状态、属性、Context 或依赖更新。
   * Then：让低优先级更新被高优先级更新打断，确认跳过更新随后按队列顺序 rebase。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
   * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `bailoutHooks()`。
   */
  it('can rebase on top of a previously skipped update', async () => {
    const {useState} = React;

    /** 作为子级函数组件暴露 Hook 状态和提交日志；服务于“让低优先级更新被高优先级更新打断，确认跳过更新随后按队列顺序 rebase”场景。 */
    function Child({text}) {
      Scheduler.log('Child: ' + text);
      return text;
    }

    let setCounter;
    /** 作为父级 fixture 持有状态、Context 或子树边界；服务于“让低优先级更新被高优先级更新打断，确认跳过更新随后按队列顺序 rebase”场景。 */
    function Parent() {
      const [counter, _setCounter] = useState(1);
      setCounter = _setCounter;
      Scheduler.log('Parent: ' + counter);
      return <Child text={counter} />;
    }

    const root = ReactTestRenderer.create(null, {unstable_isConcurrent: true});
    root.update(<Parent />);
    await waitForAll(['Parent: 1', 'Child: 1']);
    expect(root).toMatchRenderedOutput('1');

    /** update 暴露当前组件的状态更新入口，使测试能在提交外安排指定优先级更新。 */
    const update = compute => {
      setCounter(previous => {
        const value = compute(previous);
        Scheduler.log(`Compute state (${previous} -> ${value})`);
        return value;
      });
    };

    // 以 transition 优先级安排更新。
    React.startTransition(() => update(n => n * 100));
    // 急切计算得到新 state。
    assertLog(['Compute state (1 -> 100)']);

    // 但在冲刷前被更高优先级更新打断。
    root.unstable_flushSync(() => {
      update(n => n + 5);
    });
    assertLog([
      // 急切计算的 state 在本轮被完全跳过。
      'Compute state (1 -> 6)',
      'Parent: 6',
      'Child: 6',
    ]);
    expect(root).toMatchRenderedOutput('6');

    // 完成第一个更新时，第二个更新会在其结果上 rebase；尽管第一个更新曾在上一轮被跳过，也无需重新计算。
    await waitForAll([
      'Compute state (100 -> 105)',
      'Parent: 105',
      'Child: 105',
    ]);
    expect(root).toMatchRenderedOutput('105');
  });

  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：改变依赖数组形状或类型，确认 Hook 输入一致性校验产生对应诊断。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，开发态控制台断言限定诊断内容与去重。
   * 对应源码：`areHookInputsEqual()` 的开发态输入校验。
   */
  it('warns about variable number of dependencies', async () => {
    const {useLayoutEffect} = React;
    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“改变依赖数组形状或类型，确认 Hook 输入一致性校验产生对应诊断”场景。 */
    function App(props) {
      useLayoutEffect(() => {
        Scheduler.log('Did commit: ' + props.dependencies.join(', '));
      }, props.dependencies);
      return props.dependencies;
    }
    let root;
    await act(() => {
      root = ReactTestRenderer.create(<App dependencies={['A']} />, {
        unstable_isConcurrent: true,
      });
    });
    assertLog(['Did commit: A']);
    await act(() => {
      root.update(<App dependencies={['A', 'B']} />);
    });
    assertConsoleErrorDev([
      'The final argument passed to useLayoutEffect changed size ' +
        'between renders. The order and size of this array must remain ' +
        'constant.\n' +
        '\n' +
        'Previous: [A]\n' +
        'Incoming: [A, B]\n' +
        '    in App (at **)',
    ]);
  });

  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：改变依赖数组形状或类型，确认 Hook 输入一致性校验产生对应诊断。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果，开发态控制台断言限定诊断内容与去重。
   * 对应源码：`areHookInputsEqual()` 的开发态输入校验。
   */
  it('warns if switching from dependencies to no dependencies', async () => {
    const {useMemo} = React;
    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“改变依赖数组形状或类型，确认 Hook 输入一致性校验产生对应诊断”场景。 */
    function App({text, hasDeps}) {
      const resolvedText = useMemo(
        () => {
          Scheduler.log('Compute');
          return text.toUpperCase();
        },
        hasDeps ? null : [text],
      );
      return resolvedText;
    }

    let root;
    await act(() => {
      root = ReactTestRenderer.create(null, {unstable_isConcurrent: true});
    });
    await act(() => {
      root.update(<App text="Hello" hasDeps={true} />);
    });
    assertLog(['Compute']);
    expect(root).toMatchRenderedOutput('HELLO');

    await act(() => {
      root.update(<App text="Hello" hasDeps={false} />);
    });
    assertConsoleErrorDev([
      'useMemo received a final argument during this render, but ' +
        'not during the previous render. Even though the final argument is ' +
        'optional, its type cannot change between renders.\n' +
        '    in App (at **)',
    ]);
  });

  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：改变依赖数组形状或类型，确认 Hook 输入一致性校验产生对应诊断。
   *
   * 验证机制：开发态控制台断言限定诊断内容与去重。
   * 对应源码：`areHookInputsEqual()` 的开发态输入校验。
   */
  it('warns if deps is not an array', async () => {
    const {useEffect, useLayoutEffect, useMemo, useCallback} = React;

    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“改变依赖数组形状或类型，确认 Hook 输入一致性校验产生对应诊断”场景。 */
    function App(props) {
      useEffect(() => {}, props.deps);
      useLayoutEffect(() => {}, props.deps);
      useMemo(() => {}, props.deps);
      useCallback(() => {}, props.deps);
      return null;
    }

    await act(() => {
      ReactTestRenderer.create(<App deps={'hello'} />, {
        unstable_isConcurrent: true,
      });
    });
    assertConsoleErrorDev([
      'useEffect received a final argument that is not an array (instead, received `string`). ' +
        'When specified, the final argument must be an array.\n' +
        '    in App (at **)',
      'useLayoutEffect received a final argument that is not an array (instead, received `string`). ' +
        'When specified, the final argument must be an array.\n' +
        '    in App (at **)',
      'useMemo received a final argument that is not an array (instead, received `string`). ' +
        'When specified, the final argument must be an array.\n' +
        '    in App (at **)',
      'useCallback received a final argument that is not an array (instead, received `string`). ' +
        'When specified, the final argument must be an array.\n' +
        '    in App (at **)',
    ]);
    await act(() => {
      ReactTestRenderer.create(<App deps={100500} />, {
        unstable_isConcurrent: true,
      });
    });
    assertConsoleErrorDev([
      'useEffect received a final argument that is not an array (instead, received `number`). ' +
        'When specified, the final argument must be an array.\n' +
        '    in App (at **)',
      'useLayoutEffect received a final argument that is not an array (instead, received `number`). ' +
        'When specified, the final argument must be an array.\n' +
        '    in App (at **)',
      'useMemo received a final argument that is not an array (instead, received `number`). ' +
        'When specified, the final argument must be an array.\n' +
        '    in App (at **)',
      'useCallback received a final argument that is not an array (instead, received `number`). ' +
        'When specified, the final argument must be an array.\n' +
        '    in App (at **)',
    ]);
    await act(() => {
      ReactTestRenderer.create(<App deps={{}} />, {
        unstable_isConcurrent: true,
      });
    });
    assertConsoleErrorDev([
      'useEffect received a final argument that is not an array (instead, received `object`). ' +
        'When specified, the final argument must be an array.\n' +
        '    in App (at **)',
      'useLayoutEffect received a final argument that is not an array (instead, received `object`). ' +
        'When specified, the final argument must be an array.\n' +
        '    in App (at **)',
      'useMemo received a final argument that is not an array (instead, received `object`). ' +
        'When specified, the final argument must be an array.\n' +
        '    in App (at **)',
      'useCallback received a final argument that is not an array (instead, received `object`). ' +
        'When specified, the final argument must be an array.\n' +
        '    in App (at **)',
    ]);

    await act(() => {
      ReactTestRenderer.create(<App deps={[]} />, {
        unstable_isConcurrent: true,
      });
      ReactTestRenderer.create(<App deps={null} />, {
        unstable_isConcurrent: true,
      });
      ReactTestRenderer.create(<App deps={undefined} />, {
        unstable_isConcurrent: true,
      });
    });
  });

  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：改变依赖数组形状或类型，确认 Hook 输入一致性校验产生对应诊断。
   *
   * 验证机制：开发态控制台断言限定诊断内容与去重。
   * 对应源码：`areHookInputsEqual()` 的开发态输入校验。
   */
  it('warns if deps is not an array for useImperativeHandle', async () => {
    const {useImperativeHandle} = React;

    const App = React.forwardRef((props, ref) => {
      useImperativeHandle(ref, () => {}, props.deps);
      return null;
    });
    App.displayName = 'App';

    await act(() => {
      ReactTestRenderer.create(<App deps={'hello'} />, {
        unstable_isConcurrent: true,
      });
    });
    assertConsoleErrorDev([
      'useImperativeHandle received a final argument that is not an array (instead, received `string`). ' +
        'When specified, the final argument must be an array.\n' +
        '    in App (at **)',
    ]);
    await act(() => {
      ReactTestRenderer.create(<App deps={null} />, {
        unstable_isConcurrent: true,
      });
    });
    await act(() => {
      ReactTestRenderer.create(<App deps={[]} />, {
        unstable_isConcurrent: true,
      });
    });
    await act(() => {
      ReactTestRenderer.create(<App deps={undefined} />, {
        unstable_isConcurrent: true,
      });
    });
  });

  /**
   * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
   * When：安排用例指定的状态、属性、Context 或依赖更新。
   * Then：Effect 中触发包含渲染阶段 useState 更新的组件，确认更新不会在提交后丢失。
   *
   * 验证机制：宿主输出断言确认实际提交结果。
   * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `bailoutHooks()`。
   */
  it('does not forget render phase useState updates inside an effect', async () => {
    const {useState, useEffect} = React;

    /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“Effect 中触发包含渲染阶段 useState 更新的组件，确认更新不会在提交后丢失”场景。 */
    function Counter() {
      const [counter, setCounter] = useState(0);
      if (counter === 0) {
        setCounter(x => x + 1);
        setCounter(x => x + 1);
      }
      useEffect(() => {
        setCounter(x => x + 1);
        setCounter(x => x + 1);
      }, []);
      return counter;
    }

    const root = ReactTestRenderer.create(null, {unstable_isConcurrent: true});
    await act(() => {
      root.update(<Counter />);
    });
    expect(root).toMatchRenderedOutput('4');
  });

  /**
   * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
   * When：安排用例指定的状态、属性、Context 或依赖更新。
   * Then：Effect 中触发包含渲染阶段 reducer 更新的组件，确认内联或提升 reducer 都不会丢更新。
   *
   * 验证机制：宿主输出断言确认实际提交结果。
   * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `bailoutHooks()`。
   */
  it('does not forget render phase useReducer updates inside an effect with hoisted reducer', async () => {
    const {useReducer, useEffect} = React;

    /** reducer 根据 action 与闭包参数计算下一状态，用于检验 reducer 队列的选择和 rebase。 */
    const reducer = x => x + 1;
    /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“Effect 中触发包含渲染阶段 reducer 更新的组件，确认内联或提升 reducer 都不会丢更新”场景。 */
    function Counter() {
      const [counter, increment] = useReducer(reducer, 0);
      if (counter === 0) {
        increment();
        increment();
      }
      useEffect(() => {
        increment();
        increment();
      }, []);
      return counter;
    }

    const root = ReactTestRenderer.create(null, {unstable_isConcurrent: true});
    await act(() => {
      root.update(<Counter />);
    });
    expect(root).toMatchRenderedOutput('4');
  });

  /**
   * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
   * When：安排用例指定的状态、属性、Context 或依赖更新。
   * Then：Effect 中触发包含渲染阶段 reducer 更新的组件，确认内联或提升 reducer 都不会丢更新。
   *
   * 验证机制：宿主输出断言确认实际提交结果。
   * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `bailoutHooks()`。
   */
  it('does not forget render phase useReducer updates inside an effect with inline reducer', async () => {
    const {useReducer, useEffect} = React;

    /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“Effect 中触发包含渲染阶段 reducer 更新的组件，确认内联或提升 reducer 都不会丢更新”场景。 */
    function Counter() {
      const [counter, increment] = useReducer(x => x + 1, 0);
      if (counter === 0) {
        increment();
        increment();
      }
      useEffect(() => {
        increment();
        increment();
      }, []);
      return counter;
    }

    const root = ReactTestRenderer.create(null, {unstable_isConcurrent: true});
    await act(() => {
      root.update(<Counter />);
    });
    expect(root).toMatchRenderedOutput('4');
  });

  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：向 useImperativeHandle 传入非法 ref 或 create 参数，确认开发态边界诊断。
   *
   * 验证机制：开发态控制台断言限定诊断内容与去重，异常断言保留原始错误与阶段边界。
   * 对应源码：`renderWithHooks()` 与对应 Hook dispatcher 分支。
   */
  it('warns for bad useImperativeHandle first arg', async () => {
    const {useImperativeHandle} = React;
    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“向 useImperativeHandle 传入非法 ref 或 create 参数，确认开发态边界诊断”场景。 */
    function App() {
      useImperativeHandle({
        /** App.focus 暴露 imperative handle 的聚焦行为，供 ref 参数校验场景调用。 */
        focus() {},
      });
      return null;
    }

    await expect(async () => {
      await act(() => {
        ReactTestRenderer.create(<App />, {unstable_isConcurrent: true});
      });
    }).rejects.toThrow('create is not a function');
    assertConsoleErrorDev([
      'Expected useImperativeHandle() second argument to be a function ' +
        'that creates a handle. Instead received: undefined.\n' +
        '    in App (at **)',
      'Expected useImperativeHandle() first argument to either be a ' +
        'ref callback or React.createRef() object. ' +
        'Instead received: an object with keys {focus}.\n' +
        '    in App (at **)',
    ]);
  });

  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：向 useImperativeHandle 传入非法 ref 或 create 参数，确认开发态边界诊断。
   *
   * 验证机制：开发态控制台断言限定诊断内容与去重。
   * 对应源码：`renderWithHooks()` 与对应 Hook dispatcher 分支。
   */
  it('warns for bad useImperativeHandle second arg', async () => {
    const {useImperativeHandle} = React;
    const App = React.forwardRef((props, ref) => {
      useImperativeHandle(ref, {
        /** focus 暴露 imperative handle 的聚焦行为，供 ref 参数校验场景调用。 */
        focus() {},
      });
      return null;
    });
    App.displayName = 'App';

    await act(() => {
      ReactTestRenderer.create(<App />, {unstable_isConcurrent: true});
    });
    assertConsoleErrorDev([
      'Expected useImperativeHandle() second argument to be a function ' +
        'that creates a handle. Instead received: object.\n' +
        '    in App (at **)',
    ]);
  });

  // 相关问题：https://github.com/facebook/react/issues/14022
  /**
   * Given：组件渲染中嵌套服务端渲染调用，确认 Hooks dispatcher 能正确恢复所需的初始状态、更新入口与观测日志均已建立。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：组件渲染中嵌套服务端渲染调用，确认 Hooks dispatcher 能正确恢复。
   *
   * 验证机制：显式断言联合检查状态、输出和副作用。
   * 对应源码：`renderWithHooks()`、`warnOnHookMismatchInDev()` 与开发态 dispatcher。
   */
  it('works with ReactDOMServer calls inside a component', async () => {
    const {useState} = React;
    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“组件渲染中嵌套服务端渲染调用，确认 Hooks dispatcher 能正确恢复”场景。 */
    function App(props) {
      const markup1 = ReactDOMServer.renderToString(<p>hello</p>);
      const markup2 = ReactDOMServer.renderToStaticMarkup(<p>bye</p>);
      const [counter] = useState(0);
      return markup1 + counter + markup2;
    }
    let root;
    await act(() => {
      root = ReactTestRenderer.create(<App />, {unstable_isConcurrent: true});
    });
    expect(root.toJSON()).toMatchSnapshot();
  });

  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：在禁止嵌套 Hook 的回调中调用 Hook，确认非法 dispatcher 记录诊断。
   *
   * 验证机制：异常断言保留原始错误与阶段边界。
   * 对应源码：`renderWithHooks()`、`warnOnHookMismatchInDev()` 与开发态 dispatcher。
   */
  it("throws when calling hooks inside .memo's compare function", async () => {
    const {useState} = React;
    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“在禁止嵌套 Hook 的回调中调用 Hook，确认非法 dispatcher 记录诊断”场景。 */
    function App() {
      useState(0);
      return null;
    }
    const MemoApp = React.memo(App, () => {
      useState(0);
      return false;
    });

    let root;
    await act(() => {
      root = ReactTestRenderer.create(<MemoApp />, {
        unstable_isConcurrent: true,
      });
    });
    // 再次尝试渲染应触发比较并抛错。
    await expect(
      act(() => {
        root.update(<MemoApp />);
      }),
    ).rejects.toThrow(
      'Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for' +
        ' one of the following reasons:\n' +
        '1. You might have mismatching versions of React and the renderer (such as React DOM)\n' +
        '2. You might be breaking the Rules of Hooks\n' +
        '3. You might have more than one copy of React in the same app\n' +
        'See https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem.',
    );
    // 下一轮执行全新挂载，因此应正常渲染。
    await expect(
      act(() => {
        root.update(<MemoApp />);
      }),
    ).resolves.not.toThrow(
      'Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for' +
        ' one of the following reasons:\n' +
        '1. You might have mismatching versions of React and the renderer (such as React DOM)\n' +
        '2. You might be breaking the Rules of Hooks\n' +
        '3. You might have more than one copy of React in the same app\n' +
        'See https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem.',
    );
    // 随后再次更新时应重新失败。
    await expect(
      act(() => {
        root.update(<MemoApp />);
      }),
    ).rejects.toThrow(
      'Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for' +
        ' one of the following reasons:\n' +
        '1. You might have mismatching versions of React and the renderer (such as React DOM)\n' +
        '2. You might be breaking the Rules of Hooks\n' +
        '3. You might have more than one copy of React in the same app\n' +
        'See https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem.',
    );
  });

  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：在禁止嵌套 Hook 的回调中调用 Hook，确认非法 dispatcher 记录诊断。
   *
   * 验证机制：开发态控制台断言限定诊断内容与去重。
   * 对应源码：`renderWithHooks()`、`warnOnHookMismatchInDev()` 与开发态 dispatcher。
   */
  it('warns when calling hooks inside useMemo', async () => {
    const {useMemo, useState} = React;
    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“在禁止嵌套 Hook 的回调中调用 Hook，确认非法 dispatcher 记录诊断”场景。 */
    function App() {
      useMemo(() => {
        useState(0);
      });
      return null;
    }
    await act(() => {
      ReactTestRenderer.create(<App />, {unstable_isConcurrent: true});
    });
    assertConsoleErrorDev([
      'Do not call Hooks inside useEffect(...), useMemo(...), or other built-in Hooks. ' +
        'You can only call Hooks at the top level of your React function. ' +
        'For more information, see https://react.dev/link/rules-of-hooks\n' +
        '    in App (at **)',
    ]);
  });

  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：在禁止嵌套 Hook 的回调中调用 Hook，确认非法 dispatcher 记录诊断。
   *
   * 验证机制：开发态控制台断言限定诊断内容与去重。
   * 对应源码：`readContext()` 与非法嵌套 Hooks dispatcher。
   */
  it('warns when reading context inside useMemo', async () => {
    const {useMemo, createContext} = React;
    const ReactSharedInternals =
      React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

    const ThemeContext = createContext('light');
    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“在禁止嵌套 Hook 的回调中调用 Hook，确认非法 dispatcher 记录诊断”场景。 */
    function App() {
      return useMemo(() => {
        return ReactSharedInternals.H.readContext(ThemeContext);
      }, []);
    }

    await act(() => {
      ReactTestRenderer.create(<App />, {unstable_isConcurrent: true});
    });
    assertConsoleErrorDev([
      'Context can only be read while React is rendering. ' +
        'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
        'In function components, you can read it directly in the function body, ' +
        'but not inside Hooks like useReducer() or useMemo().\n' +
        '    in App (at **)',
    ]);
  });

  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：在禁止嵌套 Hook 的回调中调用 Hook，确认非法 dispatcher 记录诊断。
   *
   * 验证机制：开发态控制台断言限定诊断内容与去重。
   * 对应源码：`readContext()` 与非法嵌套 Hooks dispatcher。
   */
  it('warns when reading context inside useMemo after reading outside it', async () => {
    const {useMemo, createContext} = React;
    const ReactSharedInternals =
      React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

    const ThemeContext = createContext('light');
    let firstRead, secondRead;
    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“在禁止嵌套 Hook 的回调中调用 Hook，确认非法 dispatcher 记录诊断”场景。 */
    function App() {
      firstRead = ReactSharedInternals.H.readContext(ThemeContext);
      useMemo(() => {});
      secondRead = ReactSharedInternals.H.readContext(ThemeContext);
      return useMemo(() => {
        return ReactSharedInternals.H.readContext(ThemeContext);
      }, []);
    }

    await act(() => {
      ReactTestRenderer.create(<App />, {unstable_isConcurrent: true});
    });
    assertConsoleErrorDev([
      'Context can only be read while React is rendering. ' +
        'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
        'In function components, you can read it directly in the function body, ' +
        'but not inside Hooks like useReducer() or useMemo().\n' +
        '    in App (at **)',
    ]);
    expect(firstRead).toBe('light');
    expect(secondRead).toBe('light');
  });

  // 此处严格限制没有额外运行时成本，因此直接抛错。
  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：在受限 Hook 回调或 Effect 创建函数中读取 Context，确认嵌套读取边界被诊断。
   *
   * 验证机制：显式断言联合检查状态、输出和副作用。
   * 对应源码：`readContext()` 与非法嵌套 Hooks dispatcher。
   */
  it('throws when reading context inside useEffect', async () => {
    const {useEffect, createContext} = React;
    const ReactSharedInternals =
      React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

    const ThemeContext = createContext('light');
    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“在受限 Hook 回调或 Effect 创建函数中读取 Context，确认嵌套读取边界被诊断”场景。 */
    function App() {
      useEffect(() => {
        ReactSharedInternals.H.readContext(ThemeContext);
      });
      return null;
    }

    await act(async () => {
      ReactTestRenderer.create(<App />, {unstable_isConcurrent: true});
      // 具体错误文本不重要；只需确认该调用不被允许。
      await waitForThrow('Context can only be read while React is rendering');
    });
  });

  // 此处严格限制没有额外运行时成本，因此直接抛错。
  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：在受限 Hook 回调或 Effect 创建函数中读取 Context，确认嵌套读取边界被诊断。
   *
   * 验证机制：异常断言保留原始错误与阶段边界。
   * 对应源码：`readContext()` 与非法嵌套 Hooks dispatcher。
   */
  it('throws when reading context inside useLayoutEffect', async () => {
    const {useLayoutEffect, createContext} = React;
    const ReactSharedInternals =
      React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

    const ThemeContext = createContext('light');
    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“在受限 Hook 回调或 Effect 创建函数中读取 Context，确认嵌套读取边界被诊断”场景。 */
    function App() {
      useLayoutEffect(() => {
        ReactSharedInternals.H.readContext(ThemeContext);
      });
      return null;
    }

    await expect(
      act(() => {
        ReactTestRenderer.create(<App />, {unstable_isConcurrent: true});
      }),
    ).rejects.toThrow(
      // 具体错误文本不重要；只需确认该调用不被允许。
      'Context can only be read while React is rendering',
    );
  });

  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：在禁止嵌套 Hook 的回调中调用 Hook，确认非法 dispatcher 记录诊断。
   *
   * 验证机制：开发态控制台断言限定诊断内容与去重。
   * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `bailoutHooks()`。
   */
  it('warns when reading context inside useReducer', async () => {
    const {useReducer, createContext} = React;
    const ReactSharedInternals =
      React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

    const ThemeContext = createContext('light');
    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“在禁止嵌套 Hook 的回调中调用 Hook，确认非法 dispatcher 记录诊断”场景。 */
    function App() {
      const [state, dispatch] = useReducer((s, action) => {
        ReactSharedInternals.H.readContext(ThemeContext);
        return action;
      }, 0);
      if (state === 0) {
        dispatch(1);
      }
      return null;
    }

    await act(() => {
      ReactTestRenderer.create(<App />, {unstable_isConcurrent: true});
    });
    assertConsoleErrorDev([
      'Context can only be read while React is rendering. ' +
        'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
        'In function components, you can read it directly in the function body, ' +
        'but not inside Hooks like useReducer() or useMemo().\n' +
        '    in App (at **)',
    ]);
  });

  // 覆盖边界场景。
  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：在受限 Hook 回调或 Effect 创建函数中读取 Context，确认嵌套读取边界被诊断。
   *
   * 验证机制：开发态控制台断言限定诊断内容与去重。
   * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `bailoutHooks()`。
   */
  it('warns when reading context inside eager useReducer', async () => {
    const {useState, createContext} = React;
    const ThemeContext = createContext('light');

    const ReactSharedInternals =
      React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

    let _setState;
    /** 作为 Fn fixture 承载当前测试职责；服务于“在受限 Hook 回调或 Effect 创建函数中读取 Context，确认嵌套读取边界被诊断”场景。 */
    function Fn() {
      const [, setState] = useState(0);
      _setState = setState;
      return null;
    }

    /** 定义 Cls 类 fixture，在“在受限 Hook 回调或 Effect 创建函数中读取 Context，确认嵌套读取边界被诊断”场景中暴露类生命周期、实例 ref 或错误边界。 */
    class Cls extends React.Component {
      /** 渲染 Cls.render 对应的类 fixture，并把本轮状态或子树交给宿主输出断言。 */
      render() {
        _setState(() => ReactSharedInternals.H.readContext(ThemeContext));

        return null;
      }
    }

    await act(() => {
      ReactTestRenderer.create(
        <>
          <Fn />
          <Cls />
        </>,
        {unstable_isConcurrent: true},
      );
    });
    assertConsoleErrorDev([
      'Context can only be read while React is rendering. ' +
        'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
        'In function components, you can read it directly in the function body, ' +
        'but not inside Hooks like useReducer() or useMemo().\n' +
        '    in Cls (at **)',
      'Cannot update a component (`Fn`) while rendering a different component (`Cls`). ' +
        'To locate the bad setState() call inside `Cls`, ' +
        'follow the stack trace as described in https://react.dev/link/setstate-in-render\n' +
        '    in Cls (at **)',
    ]);
  });

  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：在禁止嵌套 Hook 的回调中调用 Hook，确认非法 dispatcher 记录诊断。
   *
   * 验证机制：开发态控制台断言限定诊断内容与去重，异常断言保留原始错误与阶段边界。
   * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `bailoutHooks()`。
   */
  it('warns when calling hooks inside useReducer', async () => {
    const {useReducer, useState, useRef} = React;

    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“在禁止嵌套 Hook 的回调中调用 Hook，确认非法 dispatcher 记录诊断”场景。 */
    function App() {
      const [value, dispatch] = useReducer((state, action) => {
        useRef(0);
        return state + 1;
      }, 0);
      if (value === 0) {
        dispatch('foo');
      }
      useState();
      return value;
    }

    await expect(async () => {
      await act(() => {
        ReactTestRenderer.create(<App />, {unstable_isConcurrent: true});
      });
    }).rejects.toThrow(
      'Update hook called on initial render. This is likely a bug in React. Please file an issue.',
    );
    assertConsoleErrorDev([
      'Do not call Hooks inside useEffect(...), useMemo(...), or other built-in Hooks. ' +
        'You can only call Hooks at the top level of your React function. ' +
        'For more information, see https://react.dev/link/rules-of-hooks\n' +
        '    in App (at **)',
      'React has detected a change in the order of Hooks called by App. ' +
        'This will lead to bugs and errors if not fixed. For more information, ' +
        'read the Rules of Hooks: https://react.dev/link/rules-of-hooks\n' +
        '\n' +
        '   Previous render            Next render\n' +
        '   ------------------------------------------------------\n' +
        '1. useReducer                 useReducer\n' +
        '2. useState                   useRef\n' +
        '   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n' +
        '\n' +
        '    in App (at **)',
      'Do not call Hooks inside useEffect(...), useMemo(...), or other built-in Hooks. ' +
        'You can only call Hooks at the top level of your React function. ' +
        'For more information, see https://react.dev/link/rules-of-hooks\n' +
        '    in App (at **)',
    ]);
  });

  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：在禁止嵌套 Hook 的回调中调用 Hook，确认非法 dispatcher 记录诊断。
   *
   * 验证机制：开发态控制台断言限定诊断内容与去重。
   * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `bailoutHooks()`。
   */
  it("warns when calling hooks inside useState's initialize function", async () => {
    const {useState, useRef} = React;
    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“在禁止嵌套 Hook 的回调中调用 Hook，确认非法 dispatcher 记录诊断”场景。 */
    function App() {
      useState(() => {
        useRef(0);
        return 0;
      });
      return null;
    }
    await act(() => {
      ReactTestRenderer.create(<App />, {unstable_isConcurrent: true});
    });
    assertConsoleErrorDev([
      'Do not call Hooks inside useEffect(...), useMemo(...), or other built-in Hooks. ' +
        'You can only call Hooks at the top level of your React function. ' +
        'For more information, see https://react.dev/link/rules-of-hooks\n' +
        '    in App (at **)',
    ]);
  });

  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：以错误中断 Hook 后再次渲染，确认开发态警告状态被复位而非泄漏。
   *
   * 验证机制：开发态控制台断言限定诊断内容与去重。
   * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `bailoutHooks()`。
   */
  it('resets warning internal state when interrupted by an error', async () => {
    const ReactSharedInternals =
      React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

    const ThemeContext = React.createContext('light');
    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“以错误中断 Hook 后再次渲染，确认开发态警告状态被复位而非泄漏”场景。 */
    function App() {
      React.useMemo(() => {
        // 触发开发态告警。
        ReactSharedInternals.H.readContext(ThemeContext);
        React.useRef();
        // 以异常中断并退出 Hook。
        throw new Error('No.');
      }, []);
    }

    /** 定义 Boundary 类 fixture，在“以错误中断 Hook 后再次渲染，确认开发态警告状态被复位而非泄漏”场景中暴露类生命周期、实例 ref 或错误边界。 */
    class Boundary extends React.Component {
      /** 保存 Boundary.state 的实例状态，作为错误恢复或生命周期断言的跨提交标记。 */
      state = {};
      /** Boundary.getDerivedStateFromError 把捕获错误转换为稳定的边界回退状态。 */
      static getDerivedStateFromError(error) {
        return {err: true};
      }
      /** 渲染 Boundary.render 对应的类 fixture，并把本轮状态或子树交给宿主输出断言。 */
      render() {
        if (this.state.err) {
          return 'Oops';
        }
        return this.props.children;
      }
    }

    await act(() => {
      ReactTestRenderer.create(
        <Boundary>
          <App />
        </Boundary>,
        {unstable_isConcurrent: true},
      );
    });
    assertConsoleErrorDev([
      'Context can only be read while React is rendering. ' +
        'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
        'In function components, you can read it directly in the function body, ' +
        'but not inside Hooks like useReducer() or useMemo().\n' +
        '    in App (at **)',
      'Do not call Hooks inside useEffect(...), useMemo(...), or other built-in Hooks. ' +
        'You can only call Hooks at the top level of your React function. ' +
        'For more information, see https://react.dev/link/rules-of-hooks\n' +
        '    in App (at **)',
      'Context can only be read while React is rendering. ' +
        'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
        'In function components, you can read it directly in the function body, ' +
        'but not inside Hooks like useReducer() or useMemo().\n' +
        '    in App (at **)',
      'Do not call Hooks inside useEffect(...), useMemo(...), or other built-in Hooks. ' +
        'You can only call Hooks at the top level of your React function. ' +
        'For more information, see https://react.dev/link/rules-of-hooks\n' +
        '    in App (at **)',
    ]);

    /** 作为 Valid fixture 承载当前测试职责；服务于“以错误中断 Hook 后再次渲染，确认开发态警告状态被复位而非泄漏”场景。 */
    function Valid() {
      React.useState();
      React.useMemo(() => {});
      React.useReducer(() => {});
      React.useEffect(() => {});
      React.useLayoutEffect(() => {});
      React.useCallback(() => {});
      React.useRef();
      React.useImperativeHandle(
        () => {},
        () => {},
      );
      if (__DEV__) {
        React.useDebugValue();
      }
      return null;
    }
    // 确认内部状态不再把当前执行误判为仍处于 Hook 中；这里不应有告警。
    await act(() => {
      ReactTestRenderer.create(<Valid />, {unstable_isConcurrent: true});
    });

    // 确认告警不会因上次中断而被永久关闭。
    await act(() => {
      ReactTestRenderer.create(
        <Boundary>
          <App />
        </Boundary>,
        {unstable_isConcurrent: true},
      );
    });
    assertConsoleErrorDev([
      'Context can only be read while React is rendering. ' +
        'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
        'In function components, you can read it directly in the function body, ' +
        'but not inside Hooks like useReducer() or useMemo().\n' +
        '    in App (at **)',
      'Do not call Hooks inside useEffect(...), useMemo(...), or other built-in Hooks. ' +
        'You can only call Hooks at the top level of your React function. ' +
        'For more information, see https://react.dev/link/rules-of-hooks\n' +
        '    in App (at **)',
      'Context can only be read while React is rendering. ' +
        'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
        'In function components, you can read it directly in the function body, ' +
        'but not inside Hooks like useReducer() or useMemo().\n' +
        '    in App (at **)',
      'Do not call Hooks inside useEffect(...), useMemo(...), or other built-in Hooks. ' +
        'You can only call Hooks at the top level of your React function. ' +
        'For more information, see https://react.dev/link/rules-of-hooks\n' +
        '    in App (at **)',
    ]);
  });

  /**
   * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：在 StrictMode 开发态挂载 Hook 组件，确认组件与 memo 计算按规则双调用。
   *
   * 验证机制：显式断言联合检查状态、输出和副作用。
   * 对应源码：`renderWithHooks()` 与对应 Hook dispatcher 分支。
   */
  it('double-invokes components with Hooks in Strict Mode', async () => {
    const {useState, StrictMode} = React;
    let renderCount = 0;

    /** 作为 NoHooks fixture 承载当前测试职责；服务于“在 StrictMode 开发态挂载 Hook 组件，确认组件与 memo 计算按规则双调用”场景。 */
    function NoHooks() {
      renderCount++;
      return <div />;
    }

    /** 作为 HasHooks fixture 承载当前测试职责；服务于“在 StrictMode 开发态挂载 Hook 组件，确认组件与 memo 计算按规则双调用”场景。 */
    function HasHooks() {
      useState(0);
      renderCount++;
      return <div />;
    }

    const FwdRef = React.forwardRef((props, ref) => {
      renderCount++;
      return <div />;
    });

    const FwdRefHasHooks = React.forwardRef((props, ref) => {
      useState(0);
      renderCount++;
      return <div />;
    });

    const Memo = React.memo(props => {
      renderCount++;
      return <div />;
    });

    const MemoHasHooks = React.memo(props => {
      useState(0);
      renderCount++;
      return <div />;
    });

    let renderer;
    await act(() => {
      renderer = ReactTestRenderer.create(null, {unstable_isConcurrent: true});
    });

    renderCount = 0;
    await act(() => {
      renderer.update(<NoHooks />);
    });
    expect(renderCount).toBe(1);
    renderCount = 0;
    await act(() => {
      renderer.update(<NoHooks />);
    });
    expect(renderCount).toBe(1);
    renderCount = 0;
    await act(() => {
      renderer.update(
        <StrictMode>
          <NoHooks />
        </StrictMode>,
      );
    });
    expect(renderCount).toBe(__DEV__ ? 2 : 1);
    renderCount = 0;
    await act(() => {
      renderer.update(
        <StrictMode>
          <NoHooks />
        </StrictMode>,
      );
    });
    expect(renderCount).toBe(__DEV__ ? 2 : 1);

    renderCount = 0;
    await act(() => {
      renderer.update(<FwdRef />);
    });
    expect(renderCount).toBe(1);
    renderCount = 0;
    await act(() => {
      renderer.update(<FwdRef />);
    });
    expect(renderCount).toBe(1);
    renderCount = 0;
    await act(() => {
      renderer.update(
        <StrictMode>
          <FwdRef />
        </StrictMode>,
      );
    });
    expect(renderCount).toBe(__DEV__ ? 2 : 1);
    renderCount = 0;
    await act(() => {
      renderer.update(
        <StrictMode>
          <FwdRef />
        </StrictMode>,
      );
    });
    expect(renderCount).toBe(__DEV__ ? 2 : 1);

    renderCount = 0;
    await act(() => {
      renderer.update(<Memo arg={1} />);
    });
    expect(renderCount).toBe(1);
    renderCount = 0;
    await act(() => {
      renderer.update(<Memo arg={2} />);
    });
    expect(renderCount).toBe(1);
    renderCount = 0;
    await act(() => {
      renderer.update(
        <StrictMode>
          <Memo arg={1} />
        </StrictMode>,
      );
    });
    expect(renderCount).toBe(__DEV__ ? 2 : 1);
    renderCount = 0;
    await act(() => {
      renderer.update(
        <StrictMode>
          <Memo arg={2} />
        </StrictMode>,
      );
    });
    expect(renderCount).toBe(__DEV__ ? 2 : 1);

    renderCount = 0;
    await act(() => {
      renderer.update(<HasHooks />);
    });
    expect(renderCount).toBe(1);
    renderCount = 0;
    await act(() => {
      renderer.update(<HasHooks />);
    });
    expect(renderCount).toBe(1);
    renderCount = 0;
    await act(() => {
      renderer.update(
        <StrictMode>
          <HasHooks />
        </StrictMode>,
      );
    });
    expect(renderCount).toBe(__DEV__ ? 2 : 1); // 该组件包含 Hook。
    renderCount = 0;
    await act(() => {
      renderer.update(
        <StrictMode>
          <HasHooks />
        </StrictMode>,
      );
    });
    expect(renderCount).toBe(__DEV__ ? 2 : 1); // 该组件包含 Hook。

    renderCount = 0;
    await act(() => {
      renderer.update(<FwdRefHasHooks />);
    });
    expect(renderCount).toBe(1);
    renderCount = 0;
    await act(() => {
      renderer.update(<FwdRefHasHooks />);
    });
    expect(renderCount).toBe(1);
    renderCount = 0;
    await act(() => {
      renderer.update(
        <StrictMode>
          <FwdRefHasHooks />
        </StrictMode>,
      );
    });
    expect(renderCount).toBe(__DEV__ ? 2 : 1); // 该组件包含 Hook。
    renderCount = 0;
    await act(() => {
      renderer.update(
        <StrictMode>
          <FwdRefHasHooks />
        </StrictMode>,
      );
    });
    expect(renderCount).toBe(__DEV__ ? 2 : 1); // 该组件包含 Hook。

    renderCount = 0;
    await act(() => {
      renderer.update(<MemoHasHooks arg={1} />);
    });
    expect(renderCount).toBe(1);
    renderCount = 0;
    await act(() => {
      renderer.update(<MemoHasHooks arg={2} />);
    });
    expect(renderCount).toBe(1);
    renderCount = 0;
    await act(() => {
      renderer.update(
        <StrictMode>
          <MemoHasHooks arg={1} />
        </StrictMode>,
      );
    });
    expect(renderCount).toBe(__DEV__ ? 2 : 1); // 该组件包含 Hook。
    renderCount = 0;
    await act(() => {
      renderer.update(
        <StrictMode>
          <MemoHasHooks arg={2} />
        </StrictMode>,
      );
    });
    expect(renderCount).toBe(__DEV__ ? 2 : 1); // 该组件包含 Hook。
  });

  /**
   * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：在 StrictMode 开发态挂载 Hook 组件，确认组件与 memo 计算按规则双调用。
   *
   * 验证机制：显式断言联合检查状态、输出和副作用。
   * 对应源码：`renderWithHooks()` 与对应 Hook dispatcher 分支。
   */
  it('double-invokes useMemo in DEV StrictMode despite []', async () => {
    const {useMemo, StrictMode} = React;

    let useMemoCount = 0;
    /** 作为 BadUseMemo fixture 承载当前测试职责；服务于“在 StrictMode 开发态挂载 Hook 组件，确认组件与 memo 计算按规则双调用”场景。 */
    function BadUseMemo() {
      useMemo(() => {
        useMemoCount++;
      }, []);
      return <div />;
    }

    useMemoCount = 0;
    await act(() => {
      ReactTestRenderer.create(
        <StrictMode>
          <BadUseMemo />
        </StrictMode>,
        {unstable_isConcurrent: true},
      );
    });
    expect(useMemoCount).toBe(__DEV__ ? 2 : 1); // 该组件包含 Hook。
  });

  /** 验证 Hooks 开发态诊断、提前退出、渲染阶段更新、调用顺序与错误恢复的内部不变量。 */
  describe('hook ordering', () => {
    /** useCallbackHelper 封装对应 Hook 调用，供参数化顺序错配测试组合使用。 */
    const useCallbackHelper = () => React.useCallback(() => {}, []);
    /** useContextHelper 封装对应 Hook 调用，供参数化顺序错配测试组合使用。 */
    const useContextHelper = () => React.useContext(React.createContext());
    /** useDebugValueHelper 封装对应 Hook 调用，供参数化顺序错配测试组合使用。 */
    const useDebugValueHelper = () => React.useDebugValue('abc');
    /** useEffectHelper 封装对应 Hook 调用，供参数化顺序错配测试组合使用。 */
    const useEffectHelper = () => React.useEffect(() => () => {}, []);
    /** useImperativeHandleHelper 封装对应 Hook 调用，供参数化顺序错配测试组合使用。 */
    const useImperativeHandleHelper = () => {
      React.useImperativeHandle({current: null}, () => ({}), []);
    };
    /** useLayoutEffectHelper 封装对应 Hook 调用，供参数化顺序错配测试组合使用。 */
    const useLayoutEffectHelper = () =>
      React.useLayoutEffect(() => () => {}, []);
    /** useMemoHelper 封装对应 Hook 调用，供参数化顺序错配测试组合使用。 */
    const useMemoHelper = () => React.useMemo(() => 123, []);
    /** useReducerHelper 根据 action 与闭包参数计算下一状态，用于检验 reducer 队列的选择和 rebase。 */
    const useReducerHelper = () => React.useReducer((s, a) => a, 0);
    /** useRefHelper 封装对应 Hook 调用，供参数化顺序错配测试组合使用。 */
    const useRefHelper = () => React.useRef(null);
    /** useStateHelper 封装对应 Hook 调用，供参数化顺序错配测试组合使用。 */
    const useStateHelper = () => React.useState(0);

    // 此集合不包含 `useImperativeHandleHelper`，因为它还会产生输入长度变化告警；下方用独立用例验证。
    const orderedHooks = [
      useCallbackHelper,
      useContextHelper,
      useDebugValueHelper,
      useEffectHelper,
      useLayoutEffectHelper,
      useMemoHelper,
      useReducerHelper,
      useRefHelper,
      useStateHelper,
    ];

    // 此集合不包含 `useContext` 或 `useDebugValue`，因为它们不会加入 Hook 列表，因此不会抛错。
    const hooksInList = [
      useCallbackHelper,
      useEffectHelper,
      useImperativeHandleHelper,
      useLayoutEffectHelper,
      useMemoHelper,
      useReducerHelper,
      useRefHelper,
      useStateHelper,
    ];

    /** useTransitionHelper 封装对应 Hook 调用，供参数化顺序错配测试组合使用。 */
    const useTransitionHelper = () => React.useTransition();
    /** useDeferredValueHelper 封装对应 Hook 调用，供参数化顺序错配测试组合使用。 */
    const useDeferredValueHelper = () =>
      React.useDeferredValue(0, {timeoutMs: 1000});

    orderedHooks.push(useTransitionHelper);
    orderedHooks.push(useDeferredValueHelper);

    hooksInList.push(useTransitionHelper);
    hooksInList.push(useDeferredValueHelper);

    /** formatHookNamesToMatchErrorMessage 规范化 Hook 名称列表，使不同调用组合可复用同一警告断言。 */
    const formatHookNamesToMatchErrorMessage = (hookNameA, hookNameB) => {
      return `use${hookNameA}${' '.repeat(24 - hookNameA.length)}${
        hookNameB ? `use${hookNameB}` : undefined
      }`;
    };

    orderedHooks.forEach((firstHelper, index) => {
      const secondHelper =
        index > 0
          ? orderedHooks[index - 1]
          : orderedHooks[orderedHooks.length - 1];

      const hookNameA = firstHelper.name
        .replace('use', '')
        .replace('Helper', '');
      const hookNameB = secondHelper.name
        .replace('use', '')
        .replace('Helper', '');

      /**
       * Given：改变相邻渲染的 Hook 调用顺序，确认首个不匹配位置稳定产生诊断所需的初始状态、更新入口与观测日志均已建立。
       * When：完成挂载以及用例指定的后续渲染或提交步骤。
       * Then：改变相邻渲染的 Hook 调用顺序，确认首个不匹配位置稳定产生诊断。
       *
       * 验证机制：开发态控制台断言限定诊断内容与去重。
       * 对应源码：`renderWithHooks()`、`warnOnHookMismatchInDev()` 与开发态 dispatcher。
       */
      it(`warns on using differently ordered hooks (${hookNameA}, ${hookNameB}) on subsequent renders`, async () => {
        /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“改变相邻渲染的 Hook 调用顺序，确认首个不匹配位置稳定产生诊断”场景。 */
        function App(props) {
          if (props.update) {
            secondHelper();
            firstHelper();
          } else {
            firstHelper();
            secondHelper();
          }
          // 该调用位于首个不匹配之后，不应出现在告警信息中。
          useRefHelper();
          return null;
        }
        let root;
        await act(() => {
          root = ReactTestRenderer.create(<App update={false} />, {
            unstable_isConcurrent: true,
          });
        });
        try {
          await act(() => {
            root.update(<App update={true} />);
          });
        } catch (error) {
          // 交换某些 Hook 类型会触发运行时错误；本用例允许该错误，只验证每次都记录顺序告警。
        }
        assertConsoleErrorDev([
          'React has detected a change in the order of Hooks called by App. ' +
            'This will lead to bugs and errors if not fixed. For more information, ' +
            'read the Rules of Hooks: https://react.dev/link/rules-of-hooks\n' +
            '\n' +
            '   Previous render            Next render\n' +
            '   ------------------------------------------------------\n' +
            `1. ${formatHookNamesToMatchErrorMessage(hookNameA, hookNameB)}\n` +
            '   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n' +
            '\n' +
            '    in App (at **)',
        ]);

        // 该组件的后续重复告警会被静默去重。
        try {
          await act(() => {
            root.update(<App update={false} />);
          });
        } catch (error) {
          // 交换某些 Hook 类型会触发运行时错误；本用例允许该错误，只验证每次都记录顺序告警。
        }
      });

      /**
       * Given：改变相邻渲染的 Hook 调用顺序，确认首个不匹配位置稳定产生诊断所需的初始状态、更新入口与观测日志均已建立。
       * When：完成挂载以及用例指定的后续渲染或提交步骤。
       * Then：改变相邻渲染的 Hook 调用顺序，确认首个不匹配位置稳定产生诊断。
       *
       * 验证机制：开发态控制台断言限定诊断内容与去重。
       * 对应源码：`renderWithHooks()`、`warnOnHookMismatchInDev()` 与开发态 dispatcher。
       */
      it(`warns when more hooks (${hookNameA}, ${hookNameB}) are used during update than mount`, async () => {
        /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“改变相邻渲染的 Hook 调用顺序，确认首个不匹配位置稳定产生诊断”场景。 */
        function App(props) {
          if (props.update) {
            firstHelper();
            secondHelper();
          } else {
            firstHelper();
          }
          return null;
        }
        let root;
        await act(() => {
          root = ReactTestRenderer.create(<App update={false} />, {
            unstable_isConcurrent: true,
          });
        });

        try {
          await act(() => {
            root.update(<App update={true} />);
          });
        } catch (error) {
          // 交换某些 Hook 类型会触发运行时错误；本用例允许该错误，只验证每次都记录顺序告警。
        }
        assertConsoleErrorDev([
          'React has detected a change in the order of Hooks called by App. ' +
            'This will lead to bugs and errors if not fixed. For more information, ' +
            'read the Rules of Hooks: https://react.dev/link/rules-of-hooks\n' +
            '\n' +
            '   Previous render            Next render\n' +
            '   ------------------------------------------------------\n' +
            `1. ${formatHookNamesToMatchErrorMessage(hookNameA, hookNameA)}\n` +
            `2. undefined                  use${hookNameB}\n` +
            '   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n' +
            '\n' +
            '    in App (at **)',
        ]);
      });
    });

    hooksInList.forEach((firstHelper, index) => {
      const secondHelper =
        index > 0
          ? hooksInList[index - 1]
          : hooksInList[hooksInList.length - 1];

      const hookNameA = firstHelper.name
        .replace('use', '')
        .replace('Helper', '');
      const hookNameB = secondHelper.name
        .replace('use', '')
        .replace('Helper', '');

      /**
       * Given：改变相邻渲染的 Hook 调用顺序，确认首个不匹配位置稳定产生诊断所需的初始状态、更新入口与观测日志均已建立。
       * When：完成挂载以及用例指定的后续渲染或提交步骤。
       * Then：改变相邻渲染的 Hook 调用顺序，确认首个不匹配位置稳定产生诊断。
       *
       * 验证机制：异常断言保留原始错误与阶段边界。
       * 对应源码：`renderWithHooks()`、`warnOnHookMismatchInDev()` 与开发态 dispatcher。
       */
      it(`warns when fewer hooks (${hookNameA}, ${hookNameB}) are used during update than mount`, async () => {
        /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“改变相邻渲染的 Hook 调用顺序，确认首个不匹配位置稳定产生诊断”场景。 */
        function App(props) {
          if (props.update) {
            firstHelper();
          } else {
            firstHelper();
            secondHelper();
          }
          return null;
        }
        let root;
        await act(() => {
          root = ReactTestRenderer.create(<App update={false} />, {
            unstable_isConcurrent: true,
          });
        });

        await expect(async () => {
          await act(() => {
            root.update(<App update={true} />);
          });
        }).rejects.toThrow('Rendered fewer hooks than expected. ');
      });
    });

    /**
     * Given：目标组件已进入可触发开发态保护的最小运行环境。
     * When：执行用例中的非法 Hook、参数或阶段调用。
     * Then：向 useImperativeHandle 传入非法 ref 或 create 参数，确认开发态边界诊断。
     *
     * 验证机制：开发态控制台断言限定诊断内容与去重。
     * 对应源码：`renderWithHooks()`、`warnOnHookMismatchInDev()` 与开发态 dispatcher。
     */
    it(
      'warns on using differently ordered hooks ' +
        '(useImperativeHandleHelper, useMemoHelper) on subsequent renders',
      async () => {
        /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“向 useImperativeHandle 传入非法 ref 或 create 参数，确认开发态边界诊断”场景。 */
        function App(props) {
          if (props.update) {
            useMemoHelper();
            useImperativeHandleHelper();
          } else {
            useImperativeHandleHelper();
            useMemoHelper();
          }
          // 该调用位于首个不匹配之后，不应出现在告警信息中。
          useRefHelper();
          return null;
        }
        let root;
        await act(() => {
          root = ReactTestRenderer.create(<App update={false} />, {
            unstable_isConcurrent: true,
          });
        });
        await act(() => {
          root.update(<App update={true} />);
        }).catch(e => {});
        // 交换某些 Hook 类型会触发运行时错误；本用例允许该错误，只验证每次都记录顺序告警。
        assertConsoleErrorDev([
          'React has detected a change in the order of Hooks called by App. ' +
            'This will lead to bugs and errors if not fixed. For more information, ' +
            'read the Rules of Hooks: https://react.dev/link/rules-of-hooks\n' +
            '\n' +
            '   Previous render            Next render\n' +
            '   ------------------------------------------------------\n' +
            `1. ${formatHookNamesToMatchErrorMessage(
              'ImperativeHandle',
              'Memo',
            )}\n` +
            '   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n' +
            '\n' +
            '    in App (at **)',
        ]);

        // 该组件的后续重复告警会被静默去重。
        await act(() => {
          root.update(<App update={false} />);
        });
      },
    );

    /**
     * Given：目标组件已进入可触发开发态保护的最小运行环境。
     * When：执行用例中的非法 Hook、参数或阶段调用。
     * Then：改变相邻渲染的 Hook 调用顺序，确认首个不匹配位置稳定产生诊断。
     *
     * 验证机制：开发态控制台断言限定诊断内容与去重，异常断言保留原始错误与阶段边界。
     * 对应源码：`renderWithHooks()`、`warnOnHookMismatchInDev()` 与开发态 dispatcher。
     */
    it('detects a bad hook order even if the component throws', async () => {
      const {useState, useReducer} = React;
      /** 作为自定义 Hook 封装当前机制并向调用组件返回稳定入口；服务于“改变相邻渲染的 Hook 调用顺序，确认首个不匹配位置稳定产生诊断”场景。 */
      function useCustomHook() {
        useState(0);
      }
      /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“改变相邻渲染的 Hook 调用顺序，确认首个不匹配位置稳定产生诊断”场景。 */
      function App(props) {
        if (props.update) {
          useCustomHook();
          useReducer((s, a) => a, 0);
          throw new Error('custom error');
        } else {
          useReducer((s, a) => a, 0);
          useCustomHook();
        }
        return null;
      }
      let root;
      await act(() => {
        root = ReactTestRenderer.create(<App update={false} />, {
          unstable_isConcurrent: true,
        });
      });
      await expect(async () => {
        await act(() => {
          root.update(<App update={true} />);
        });
      }).rejects.toThrow('custom error');
      assertConsoleErrorDev([
        'React has detected a change in the order of Hooks called by App. ' +
          'This will lead to bugs and errors if not fixed. For more information, ' +
          'read the Rules of Hooks: https://react.dev/link/rules-of-hooks\n' +
          '\n' +
          '   Previous render            Next render\n' +
          '   ------------------------------------------------------\n' +
          '1. useReducer                 useState\n' +
          '   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n' +
          '\n' +
          '    in App (at **)',
      ]);
    });
  });

  // 回归场景：#14674。
  /**
   * Given：渲染阶段跨组件更新后抛出原始错误，确认诊断不会吞掉业务异常所需的初始状态、更新入口与观测日志均已建立。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：渲染阶段跨组件更新后抛出原始错误，确认诊断不会吞掉业务异常。
   *
   * 验证机制：开发态控制台断言限定诊断内容与去重，异常断言保留原始错误与阶段边界。
   * 对应源码：`resetHooksOnUnwind()` 与渲染错误恢复。
   */
  it('does not swallow original error when updating another component in render phase', async () => {
    const {useState} = React;

    let _setState;
    /** 作为 A fixture 承载当前测试职责；服务于“渲染阶段跨组件更新后抛出原始错误，确认诊断不会吞掉业务异常”场景。 */
    function A() {
      const [, setState] = useState(0);
      _setState = setState;
      return null;
    }

    /** 作为 B fixture 承载当前测试职责；服务于“渲染阶段跨组件更新后抛出原始错误，确认诊断不会吞掉业务异常”场景。 */
    function B() {
      _setState(() => {
        throw new Error('Hello');
      });
      return null;
    }

    await expect(async () => {
      await act(() => {
        ReactTestRenderer.create(
          <>
            <A />
            <B />
          </>,
          {unstable_isConcurrent: true},
        );
      });
    }).rejects.toThrow('Hello');
    assertConsoleErrorDev([
      'Cannot update a component (`A`) while rendering a different component (`B`). ' +
        'To locate the bad setState() call inside `B`, ' +
        'follow the stack trace as described in https://react.dev/link/setstate-in-render\n' +
        '    in B (at **)',
    ]);
  });

  // 回归场景：https://github.com/facebook/react/issues/15057
  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：组合卸载、挂起或 memo 边界，确认 Hook 顺序检测不会误报。
   *
   * 验证机制：异常断言保留原始错误与阶段边界。
   * 对应源码：`renderWithHooks()` 与对应 Hook dispatcher 分支。
   */
  it('does not fire a false positive warning when previous effect unmounts the component', async () => {
    const {useState, useEffect} = React;
    let globalListener;

    /** 作为 A fixture 承载当前测试职责；服务于“组合卸载、挂起或 memo 边界，确认 Hook 顺序检测不会误报”场景。 */
    function A() {
      const [show, setShow] = useState(true);
      /** 作为 hideMe fixture 承载当前测试职责；服务于“组合卸载、挂起或 memo 边界，确认 Hook 顺序检测不会误报”场景。 */
      function hideMe() {
        setShow(false);
      }
      return show ? <B hideMe={hideMe} /> : null;
    }

    /** 作为 B fixture 承载当前测试职责；服务于“组合卸载、挂起或 memo 边界，确认 Hook 顺序检测不会误报”场景。 */
    function B(props) {
      return <C {...props} />;
    }

    /** 作为 C fixture 承载当前测试职责；服务于“组合卸载、挂起或 memo 边界，确认 Hook 顺序检测不会误报”场景。 */
    function C({hideMe}) {
      const [, setState] = useState();

      useEffect(() => {
        let isStale = false;

        globalListener = () => {
          if (!isStale) {
            setState('hello');
          }
        };

        return () => {
          isStale = true;
          hideMe();
        };
      });
      return null;
    }

    await act(() => {
      ReactTestRenderer.create(<A />, {unstable_isConcurrent: true});
    });

    // 注意：这里不应警告卸载后更新，因为组件自身无法得知它已被卸载。
    await expect(
      act(() => {
        globalListener();
        globalListener();
      }),
    ).resolves.not.toThrow();
  });

  // 回归场景：https://github.com/facebook/react/issues/14790
  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：组合卸载、挂起或 memo 边界，确认 Hook 顺序检测不会误报。
   *
   * 验证机制：宿主输出断言确认实际提交结果。
   * 对应源码：`renderWithHooks()` 与对应 Hook dispatcher 分支。
   */
  it('does not fire a false positive warning when suspending memo', async () => {
    const {Suspense, useState} = React;

    let isSuspended = true;
    let resolve;
    /** 按测试信号抛出 thenable，制造可恢复的 Suspense 挂起；服务于“组合卸载、挂起或 memo 边界，确认 Hook 顺序检测不会误报”场景。 */
    function trySuspend() {
      if (isSuspended) {
        throw new Promise(res => {
          resolve = () => {
            isSuspended = false;
            res();
          };
        });
      }
    }

    /** 作为子级函数组件暴露 Hook 状态和提交日志；服务于“组合卸载、挂起或 memo 边界，确认 Hook 顺序检测不会误报”场景。 */
    function Child() {
      useState();
      trySuspend();
      return 'hello';
    }

    const Wrapper = React.memo(Child);
    let root;
    await act(() => {
      root = ReactTestRenderer.create(
        <Suspense fallback="loading">
          <Wrapper />
        </Suspense>,
        {unstable_isConcurrent: true},
      );
    });
    expect(root).toMatchRenderedOutput('loading');
    await act(resolve);
    expect(root).toMatchRenderedOutput('hello');
  });

  // 回归场景：https://github.com/facebook/react/issues/14790
  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：组合卸载、挂起或 memo 边界，确认 Hook 顺序检测不会误报。
   *
   * 验证机制：宿主输出断言确认实际提交结果。
   * 对应源码：`renderWithHooks()` 与对应 Hook dispatcher 分支。
   */
  it('does not fire a false positive warning when suspending forwardRef', async () => {
    const {Suspense, useState} = React;

    let isSuspended = true;
    let resolve;
    /** 按测试信号抛出 thenable，制造可恢复的 Suspense 挂起；服务于“组合卸载、挂起或 memo 边界，确认 Hook 顺序检测不会误报”场景。 */
    function trySuspend() {
      if (isSuspended) {
        throw new Promise(res => {
          resolve = () => {
            isSuspended = false;
            res();
          };
        });
      }
    }

    /** 作为 render fixture 承载当前测试职责；服务于“组合卸载、挂起或 memo 边界，确认 Hook 顺序检测不会误报”场景。 */
    function render(props, ref) {
      useState();
      trySuspend();
      return 'hello';
    }

    const Wrapper = React.forwardRef(render);
    let root;
    await act(() => {
      root = ReactTestRenderer.create(
        <Suspense fallback="loading">
          <Wrapper />
        </Suspense>,
        {unstable_isConcurrent: true},
      );
    });
    expect(root).toMatchRenderedOutput('loading');
    await act(resolve);
    expect(root).toMatchRenderedOutput('hello');
  });

  // 回归场景：https://github.com/facebook/react/issues/14790
  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：组合卸载、挂起或 memo 边界，确认 Hook 顺序检测不会误报。
   *
   * 验证机制：宿主输出断言确认实际提交结果。
   * 对应源码：`renderWithHooks()` 与对应 Hook dispatcher 分支。
   */
  it('does not fire a false positive warning when suspending memo(forwardRef)', async () => {
    const {Suspense, useState} = React;

    let isSuspended = true;
    let resolve;
    /** 按测试信号抛出 thenable，制造可恢复的 Suspense 挂起；服务于“组合卸载、挂起或 memo 边界，确认 Hook 顺序检测不会误报”场景。 */
    function trySuspend() {
      if (isSuspended) {
        throw new Promise(res => {
          resolve = () => {
            isSuspended = false;
            res();
          };
        });
      }
    }

    /** 作为 render fixture 承载当前测试职责；服务于“组合卸载、挂起或 memo 边界，确认 Hook 顺序检测不会误报”场景。 */
    function render(props, ref) {
      useState();
      trySuspend();
      return 'hello';
    }

    const Wrapper = React.memo(React.forwardRef(render));
    let root;
    await act(() => {
      root = ReactTestRenderer.create(
        <Suspense fallback="loading">
          <Wrapper />
        </Suspense>,
        {unstable_isConcurrent: true},
      );
    });
    expect(root).toMatchRenderedOutput('loading');
    await act(resolve);
    expect(root).toMatchRenderedOutput('hello');
  });

  // 回归场景：https://github.com/facebook/react/issues/15732
  /**
   * Given：在 Hook 列表中途抛错后重试，确认 Hook 游标与队列状态完全复位所需的初始状态、更新入口与观测日志均已建立。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：在 Hook 列表中途抛错后重试，确认 Hook 游标与队列状态完全复位。
   *
   * 验证机制：宿主输出断言确认实际提交结果。
   * 对应源码：`resetHooksOnUnwind()` 与渲染错误恢复。
   */
  it('resets hooks when an error is thrown in the middle of a list of hooks', async () => {
    const {useEffect, useState} = React;

    /** 定义 ErrorBoundary 类 fixture，在“在 Hook 列表中途抛错后重试，确认 Hook 游标与队列状态完全复位”场景中暴露类生命周期、实例 ref 或错误边界。 */
    class ErrorBoundary extends React.Component {
      /** 保存 ErrorBoundary.state 的实例状态，作为错误恢复或生命周期断言的跨提交标记。 */
      state = {hasError: false};

      /** ErrorBoundary.getDerivedStateFromError 把捕获错误转换为稳定的边界回退状态。 */
      static getDerivedStateFromError() {
        return {hasError: true};
      }

      /** 渲染 ErrorBoundary.render 对应的类 fixture，并把本轮状态或子树交给宿主输出断言。 */
      render() {
        return (
          <Wrapper>
            {this.state.hasError ? 'Error!' : this.props.children}
          </Wrapper>
        );
      }
    }

    /** 包裹受测子树并控制错误、Suspense 或 memo 边界；服务于“在 Hook 列表中途抛错后重试，确认 Hook 游标与队列状态完全复位”场景。 */
    function Wrapper({children}) {
      return children;
    }

    let setShouldThrow;
    /** 作为 Thrower fixture 承载当前测试职责；服务于“在 Hook 列表中途抛错后重试，确认 Hook 游标与队列状态完全复位”场景。 */
    function Thrower() {
      const [shouldThrow, _setShouldThrow] = useState(false);
      setShouldThrow = _setShouldThrow;

      if (shouldThrow) {
        throw new Error('Throw!');
      }

      useEffect(() => {}, []);

      return 'Throw!';
    }

    let root;
    await act(() => {
      root = ReactTestRenderer.create(
        <ErrorBoundary>
          <Thrower />
        </ErrorBoundary>,
        {unstable_isConcurrent: true},
      );
    });

    expect(root).toMatchRenderedOutput('Throw!');
    await act(() => setShouldThrow(true));
    expect(root).toMatchRenderedOutput('Error!');
  });
});
