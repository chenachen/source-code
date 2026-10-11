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
  /** 每个用例重置模块与警告状态，并重新绑定 React、Test Renderer、调度日志及内部断言工具。 */
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
    /** DEV 中类 render 调用 useDebugValue(abc)；act 拒绝并包含 Invalid hook call，验证 ContextOnlyDispatcher 不能用于类 Hook 调用。 */
    it('useDebugValue throws when used in a class component', async () => {
      /** 类render非法useDebugValue，供函数Hook调用边界测试。 */
      class Example extends React.Component {
        /** 调用useDebugValue后原本返回null；非法Hook调用先抛错。 */
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

  /** 两个 state 从0/0到1/1；相同状态或多次往返最终不变时只记录 Parent，不重渲染 Child/不运行 layout。再以 NaN与负零验证 Object.is：负零→正零仍更新。 */
  it('bails out in the render phase if all of the state is the same', async () => {
    const {useState, useLayoutEffect} = React;

    /** 仅在render记录Child:text并返回文本；不注册effect，缺少Child日志可观察父render后bailout。 */
    function Child({text}) {
      Scheduler.log('Child: ' + text);
      return text;
    }

    let setCounter1;
    let setCounter2;
    /** 暴露两份计数setter，render记录组合值，layout记录真正提交，Child日志区分render后bailout。 */
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

  /** memo Parent 有两份 state 与 theme；相同state时跳过 Child，但 light→dark 的 props 变化仍渲染 Child；state/props都同值时仅Parent日志。 */
  it('bails out in render phase if all the state is the same and props bail out with memo', async () => {
    const {useState, memo} = React;

    /** 仅在render记录Child:text并返回文本；不注册effect，缺少Child日志可观察父render后bailout。 */
    function Child({text}) {
      Scheduler.log('Child: ' + text);
      return text;
    }

    let setCounter1;
    let setCounter2;
    /** 暴露两份计数并消费theme prop，作为memo组件区分state不变与props变化。 */
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

  /** useState计数0→1，第二参数回调若执行会抛错；日志/输出均为1，DEV警告不支持回调，证明回调被忽略。 */
  it('warns about setState second argument', async () => {
    const {useState} = React;

    let setCounter;
    /** 暴露useState计数setter，记录counter并返回值，第二参数非法回调不应执行。 */
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

  /** useReducer用 action 直接替换计数0→1，dispatch第二参数回调若执行会抛错；警告与输出1验证其被忽略。 */
  it('warns about dispatch second argument', async () => {
    const {useReducer} = React;

    let dispatch;
    /** 暴露把action直接作为新计数的reducer dispatch，记录并输出counter。 */
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

  /** Provider初值light、counter更新到1；同counter再设1仅Parent日志，同时theme变dark则Child/layout仍执行，验证Context变化阻止render后bailout。 */
  it('never bails out if context has changed', async () => {
    const {useState, useLayoutEffect, useContext} = React;

    const ThemeContext = React.createContext('light');

    let setTheme;
    /** 用 state 驱动 ThemeContext，并暴露 theme 更新器，区分状态 bailout 与 Context 传播。 */
    function ThemeProvider({children}) {
      const [theme, _setTheme] = useState('light');
      Scheduler.log('Theme: ' + theme);
      setTheme = _setTheme;
      return (
        <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
      );
    }

    /** 仅在render记录Child:text并返回文本；不注册effect，缺少Child日志可观察父render后bailout。 */
    function Child({text}) {
      Scheduler.log('Child: ' + text);
      return text;
    }

    let setCounter;
    /** 暴露counter并读取ThemeContext，两者共同生成Text与layout日志。 */
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

  /** 计数0→1后首个同值更新仍进入Parent，下一次同值无render日志；再重复0与正零→负零，验证两侧Fiber lanes清空后的eager bailout及Object.is。 */
  it('can bail out without calling render phase (as an optimization) if queue is known to be empty', async () => {
    const {useState, useLayoutEffect} = React;

    /** 仅在render记录Child:text并返回文本；不注册effect，缺少Child日志可观察父render后bailout。 */
    function Child({text}) {
      Scheduler.log('Child: ' + text);
      return text;
    }

    let setCounter;
    /** 暴露counter并记录Parent/layout，区分一次render后bailout与后续eager bailout。 */
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

  /** 计数0连续派发0/0/0/1/2/3；前四项同步计算，1使Fiber标记工作后2/3留待render，最终3。日志区分eager结果复用与后续计算。 */
  it('bails out multiple times in a row without entering render phase', async () => {
    const {useState} = React;

    /** 仅在render记录Child:text并返回文本；不注册effect，缺少Child日志可观察父render后bailout。 */
    function Child({text}) {
      Scheduler.log('Child: ' + text);
      return text;
    }

    let setCounter;
    /** 暴露counter，仅记录Parent/Child render，函数updater日志用于检测eager计算。 */
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

  /** 初值1，transition ×100先eager计算100；flushSync +5跳过transition提交6，后台复用100并重放+5得到105，验证首次跳过后的baseQueue顺序。 */
  it('can rebase on top of a previously skipped update', async () => {
    const {useState} = React;

    /** 仅在render记录Child:text并返回文本；不注册effect，缺少Child日志可观察父render后bailout。 */
    function Child({text}) {
      Scheduler.log('Child: ' + text);
      return text;
    }

    let setCounter;
    /** 初值1的计数队列，函数更新交错乘100与加5，记录Parent/Child观察baseQueue重放。 */
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

  /** layout依赖从[A]改为[A,B]，初挂记录Did commit A，更新DEV警告依赖长度变化；本例未用新effect日志证明更新create。 */
  it('warns about variable number of dependencies', async () => {
    const {useLayoutEffect} = React;
    /** 把props.dependencies直接传给layout effect，记录effect版本并返回同一数组内容。 */
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

  /** hasDeps=true实际传null，false实际传[text]；相同Hello更新从无依赖改为数组，DEV警告新增最终参数。测试标题方向与实际表达式不同，按本体说明。 */
  it('warns if switching from dependencies to no dependencies', async () => {
    const {useMemo} = React;
    /** 按hasDeps传null或[text]给useMemo，计算大写文本；变量名不代表实际依赖存在与否。 */
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

  /** 四类Hook分别接收string/number/object依赖，逐类逐类型DEV警告；空数组/null/undefined为无警告对照。非数组检测来自DEV dispatcher，不是仅areHookInputsEqual。 */
  it('warns if deps is not an array', async () => {
    const {useEffect, useLayoutEffect, useMemo, useCallback} = React;

    /** 把props.deps同时传给四类Hook，以逐Hook非数组诊断与合法空值作对照。 */
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

  /** forwardRef内useImperativeHandle deps=hello触发非数组警告；null/[]/undefined对照不警告，未传ref且create不会执行。 */
  it('warns if deps is not an array for useImperativeHandle', async () => {
    const {useImperativeHandle} = React;

    /** 把本例 deps/create 参数交给 useImperativeHandle；没有 ref 时仅DEV参数检查，handle effect 不调用create。 */
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

  /** count0时render阶段加一两次，首次passive再加一两次；act后输出4，验证render阶段队列不会被effect更新覆盖。 */
  it('does not forget render phase useState updates inside an effect', async () => {
    const {useState, useEffect} = React;

    /** 初值0在render中加一两次，空依赖passive再加一两次，最终输出4。 */
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

  /** 提升到组件外的reducer固定+1，render阶段dispatch两次，passive再两次；输出4，验证重放与外部reducer队列。 */
  it('does not forget render phase useReducer updates inside an effect with hoisted reducer', async () => {
    const {useReducer, useEffect} = React;

    /** reducer 根据 action 与闭包参数计算下一状态，用于检验 reducer 队列的选择和 rebase。 */
    const reducer = x => x + 1;
    /** 使用提升reducer固定加一，render阶段两次加一后passive再次两次加一。 */
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

  /** 每轮内联reducer固定+1，render阶段dispatch两次，passive再两次；输出4，验证reducer身份变化不丢render阶段更新。 */
  it('does not forget render phase useReducer updates inside an effect with inline reducer', async () => {
    const {useReducer, useEffect} = React;

    /** 使用每轮内联reducer固定加一，render阶段与首次passive分别派发两次。 */
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

  /** useImperativeHandle只传含focus的对象，create缺失；DEV分别警告两实参，layout调用create时报create is not a function。空focus方法未调用。 */
  it('warns for bad useImperativeHandle first arg', async () => {
    const {useImperativeHandle} = React;
    /** 只给useImperativeHandle传含空focus对象，刻意同时缺少create并使用非法ref对象。 */
    function App() {
      useImperativeHandle({
        /** 空focus方法只构成非法ref对象的key，不会调用。 */
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

  /** forwardRef内把含focus对象传为create，ref未提供；DEV警告第二参数object，无ref所以本例没有调用create或异常断言。 */
  it('warns for bad useImperativeHandle second arg', async () => {
    const {useImperativeHandle} = React;
    /** 把本例 deps/create 参数交给 useImperativeHandle；没有 ref 时仅DEV参数检查，handle effect 不调用create。 */
    const App = React.forwardRef((props, ref) => {
      useImperativeHandle(ref, {
        /** 空focus方法只构成非法create对象的key，不会调用。 */
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
  /** 函数render先renderToString hello、renderToStaticMarkup bye，再useState(0)；JSON快照验证嵌套服务端renderer恢复外层Hook dispatcher。 */
  it('works with ReactDOMServer calls inside a component', async () => {
    const {useState} = React;
    /** 先嵌套两种服务端render，再读取state=0并拼接标记，检查外层dispatcher恢复。 */
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

  /** memo比较器非法useState；首次挂载不调用compare，第一次update抛Invalid hook call；错误后重新挂载成功，再update又失败，验证compare没有函数组件dispatcher。 */
  it("throws when calling hooks inside .memo's compare function", async () => {
    const {useState} = React;
    /** 合法顶层useState作为memo被包组件；compare中的非法Hook与此合法调用分开。 */
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

  /** useMemo计算中非法useState(0)；初挂DEV记录嵌套Hook警告，未断言抛错。 */
  it('warns when calling hooks inside useMemo', async () => {
    const {useMemo, useState} = React;
    /** 在memo计算里调用state Hook，制造DEV InvalidNestedHooksDispatcher诊断。 */
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

  /** useMemo计算中通过shared dispatcher readContext(light)；DEV记录不允许在Hook回调读取Context的警告。 */
  it('warns when reading context inside useMemo', async () => {
    const {useMemo, createContext} = React;
    const ReactSharedInternals =
      React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

    const ThemeContext = createContext('light');
    /** 在memo计算里从shared dispatcher读ThemeContext，覆盖非法Context读取。 */
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

  /** 在useMemo外读取Context两次，中间插入合法useMemo；最后在另一个memo计算内读Context触发警告，外部firstRead/secondRead均为light。 */
  it('warns when reading context inside useMemo after reading outside it', async () => {
    const {useMemo, createContext} = React;
    const ReactSharedInternals =
      React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

    const ThemeContext = createContext('light');
    let firstRead, secondRead;
    /** 在memo外记录两次Context读取值，再在memo内违规读取，检查dispatcher复位与警告。 */
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
  /** passive create通过shared dispatcher读取Context；waitForThrow验证提交后的读取不在render作用域而抛错。 */
  it('throws when reading context inside useEffect', async () => {
    const {useEffect, createContext} = React;
    const ReactSharedInternals =
      React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

    const ThemeContext = createContext('light');
    /** 注册在passive create里读取Context的effect，render自身不读Context。 */
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
  /** layout create读取Context；act拒绝并包含只能render中读取的错误，验证布局提交不能沿用render上下文。 */
  it('throws when reading context inside useLayoutEffect', async () => {
    const {useLayoutEffect, createContext} = React;
    const ReactSharedInternals =
      React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

    const ThemeContext = createContext('light');
    /** 注册在layout create里读取Context的effect，提交阶段触发读取错误。 */
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

  /** reducer回调内部readContext，初值0在render中dispatch(1)触发该回调；DEV警告非法Context读取，不是effect阶段调用。 */
  it('warns when reading context inside useReducer', async () => {
    const {useReducer, createContext} = React;
    const ReactSharedInternals =
      React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

    const ThemeContext = createContext('light');
    /** render初值0时dispatch1，reducer内非法读取Context并返回action。 */
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
  /** Fn暴露useState setter，Cls render调用函数updater在eager计算中readContext；DEV既警告非法读取，也警告Cls渲染时更新Fn。没有调用useReducer。 */
  it('warns when reading context inside eager useReducer', async () => {
    const {useState, createContext} = React;
    const ThemeContext = createContext('light');

    const ReactSharedInternals =
      React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

    let _setState;
    /** 暴露 Fn 的 setState，供另一个组件在 updater 中违规读取 Context。 */
    function Fn() {
      const [, setState] = useState(0);
      _setState = setState;
      return null;
    }

    /** render调用Fn的函数updater，制造eager Context违规读取与跨组件更新。 */
    class Cls extends React.Component {
      /** 调用Fn setter，让函数updater读取Context，随后返回null。 */
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

  /** reducer在render阶段dispatch后非法useRef，外层仍调用useState；DEV记录嵌套与useState→useRef顺序错配，最终抛initial render的update Hook错误。 */
  it('warns when calling hooks inside useReducer', async () => {
    const {useReducer, useState, useRef} = React;

    /** render初值0时dispatch，reducer非法调用ref；外层随后state造成Hook类型错配。 */
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

  /** useState惰性initializer中非法useRef(0)；DEV警告嵌套Hook，未断言抛错。 */
  it("warns when calling hooks inside useState's initialize function", async () => {
    const {useState, useRef} = React;
    /** 在state initializer中调用ref并返回0，制造非法嵌套Hook调用。 */
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

  /** memo计算先非法Context/useRef再抛No，Boundary恢复Oops；合法Valid随后无警告，再挂载错误App仍出现两类警告，验证异常后DEV dispatcher状态恢复。 */
  it('resets warning internal state when interrupted by an error', async () => {
    const ReactSharedInternals =
      React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

    const ThemeContext = React.createContext('light');
    /** memo计算内违规读Context和ref后抛No；Boundary负责恢复，后续Valid检查警告状态。 */
    function App() {
      React.useMemo(() => {
        // 触发开发态告警。
        ReactSharedInternals.H.readContext(ThemeContext);
        React.useRef();
        // 以异常中断并退出 Hook。
        throw new Error('No.');
      }, []);
    }

    /** 以err state切换Oops与children，隔离memo计算的异常后继续测试dispatcher。 */
    class Boundary extends React.Component {
      /** 保存 Boundary.state 的实例状态，作为错误恢复或生命周期断言的跨提交标记。 */
      state = {};
      /** Boundary.getDerivedStateFromError 把捕获错误转换为稳定的边界回退状态。 */
      static getDerivedStateFromError(error) {
        return {err: true};
      }
      /** err为真返回Oops，否则渲染children。 */
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

    /** 按合法位置调用各类 Hook，确认前一次抛错后 dispatcher 与警告状态已恢复。 */
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

  /** 普通函数/forwardRef/memo各有无state两组，普通模式render一次；StrictMode下DEV初挂和更新两次、生产一次，memo更新通过arg变化触发。 */
  it('double-invokes components with Hooks in Strict Mode', async () => {
    const {useState, StrictMode} = React;
    let renderCount = 0;

    /** 不调用 Hook，只累计组件执行次数，与含 Hook 的 StrictMode 用例对照。 */
    function NoHooks() {
      renderCount++;
      return <div />;
    }

    /** 调用一个 useState 并累计执行次数，核对 StrictMode 的额外组件求值。 */
    function HasHooks() {
      useState(0);
      renderCount++;
      return <div />;
    }

    /** 不使用Hook的forwardRef渲染函数，计数与含Hook版本作StrictMode对照；props/ref不参与。 */
    const FwdRef = React.forwardRef((props, ref) => {
      renderCount++;
      return <div />;
    });

    /** 建立state Hook并计数forwardRef执行，核对StrictMode求值次数。 */
    const FwdRefHasHooks = React.forwardRef((props, ref) => {
      useState(0);
      renderCount++;
      return <div />;
    });

    /** 不含Hook的memo函数，arg变化保证更新进入render；计数StrictMode求值次数。 */
    const Memo = React.memo(props => {
      renderCount++;
      return <div />;
    });

    /** 含state Hook的memo函数，arg变化驱动更新并累计执行次数。 */
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

  /** StrictMode首挂空依赖useMemo累计计算；DEV为2、生产为1，验证首遍用户计算额外调用而第二次组件求值复用memo结果。 */
  it('double-invokes useMemo in DEV StrictMode despite []', async () => {
    const {useMemo, StrictMode} = React;

    let useMemoCount = 0;
    /** 以空依赖 useMemo 累计计算次数，核对 DEV StrictMode 首遍的用户函数双调用。 */
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
    /** 创建默认值undefined的Context并读取；DEV记录Hook名称，但不占用memoizedState Hook链槽位。 */
    const useContextHelper = () => React.useContext(React.createContext());
    /** 调用useDebugValue(abc)；DEV记录Hook名称，不占用Hook链槽位。 */
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
    /** useReducerHelper 调用 useReducer，供参数化 Hook 顺序错配测试使用。 */
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
    /** 调用useDeferredValue(0,对象初始值)，供顺序错配测试；第二参数是initialValue，不是timeout配置。 */
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

      /** orderedHooks循环取当前helper与前一个（首项环绕末项），mount A/B、update B/A，再调用ref；DEV只报告首个位置错配，重复组件警告去重，允许类型交换引起的运行时错误。 */
      it(`warns on using differently ordered hooks (${hookNameA}, ${hookNameB}) on subsequent renders`, async () => {
        /** 按props.update把参数化A/B顺序交换，末尾ref使告警仅定位首个错配。 */
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

      /** orderedHooks同一helper对，mount仅A、update A/B；DEV在第二位置报告undefined→B，允许不同Hook内部结构引起异常。 */
      it(`warns when more hooks (${hookNameA}, ${hookNameB}) are used during update than mount`, async () => {
        /** 按props.update从只A增加为A/B，制造第二Hook位置未定义的DEV诊断。 */
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

      /** hooksInList循环取helper对，mount A/B、update仅A；act必须抛Rendered fewer hooks。Context/DebugValue不建Hook链故排除，未以控制台顺序警告作为断言。 */
      it(`warns when fewer hooks (${hookNameA}, ${hookNameB}) are used during update than mount`, async () => {
        /** 按props.update从A/B减少为A，触发Hook链未完全消费错误。 */
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

    /** 单独交换ImperativeHandle/Memo顺序，末尾ref保持；DEV报告第一处错配，忽略交换导致的错误，再改回不重复警告。此例不是非法ref/create参数测试。 */
    it(
      'warns on using differently ordered hooks ' +
        '(useImperativeHandleHelper, useMemoHelper) on subsequent renders',
      async () => {
        /** 交换ImperativeHandle与Memo，两者后追加ref；忽略类型交换运行时错误仅检查首个错配。 */
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

    /** mount reducer→customState，update customState→reducer并主动抛custom error；既保留原始异常，又记录首位置reducer→state错配。 */
    it('detects a bad hook order even if the component throws', async () => {
      const {useState, useReducer} = React;
      /** 通过自定义 Hook 增加一个 useState 槽位，检测交换 Hook 调用顺序时的诊断。 */
      function useCustomHook() {
        useState(0);
      }
      /** 更新时先customState再reducer并抛custom error；初挂顺序相反。 */
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
  /** A暴露setter，B render调用updater抛Hello；act拒绝保留Hello，同时DEV警告跨组件render更新，验证规则诊断不吞业务错误。 */
  it('does not swallow original error when updating another component in render phase', async () => {
    const {useState} = React;

    let _setState;
    /** 暴露 A 的 setState，作为跨组件 render 更新的目标。 */
    function A() {
      const [, setState] = useState(0);
      _setState = setState;
      return null;
    }

    /** 在 B 渲染中更新 A，updater 抛出 Hello；检验规则诊断不会吞掉原错误。 */
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
  /** C effect保存listener，更新时cleanup先标记stale再调用父hideMe删除B/C；连续两次listener调用的act不抛错，覆盖旧effect清理触发删除后的更新边界。 */
  it('does not fire a false positive warning when previous effect unmounts the component', async () => {
    const {useState, useEffect} = React;
    let globalListener;

    /** 用 show 控制 B/C 存活，向后代传入触发删除的 hideMe。 */
    function A() {
      const [show, setShow] = useState(true);
      /** 将 show 设为 false，删除 B/C 子树。 */
      function hideMe() {
        setShow(false);
      }
      return show ? <B hideMe={hideMe} /> : null;
    }

    /** 透传 hideMe 到 C，增加一层 Fiber 返回路径。 */
    function B(props) {
      return <C {...props} />;
    }

    /** 安装外部 listener；cleanup 先标记 listener 过期，再调用 hideMe 删除祖先子树。 */
    function C({hideMe}) {
      const [, setState] = useState();

      useEffect(() => {
        let isStale = false;

        /** 外部listener只在本轮effect未标stale时更新C；cleanup删除树后旧listener不再派发。 */
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
  /** memo Child先useState再挂起，显示loading；resolve先清挂起标志再resolve Promise，输出hello，验证恢复不误报Hook顺序。 */
  it('does not fire a false positive warning when suspending memo', async () => {
    const {Suspense, useState} = React;

    let isSuspended = true;
    let resolve;
    /** 按测试信号抛出 thenable，制造可恢复的 Suspense 挂起。 */
    function trySuspend() {
      if (isSuspended) {
        throw new Promise(res => {
          /** 先关闭isSuspended再resolve原生Promise，恢复render时输出hello。 */
          resolve = () => {
            isSuspended = false;
            res();
          };
        });
      }
    }

    /** 建立state Hook后尝试挂起，恢复时返回hello；不注册effect。 */
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
  /** forwardRef render先useState再挂起，loading→resolve→hello；ref未使用，恢复不得误报Hook顺序。 */
  it('does not fire a false positive warning when suspending forwardRef', async () => {
    const {Suspense, useState} = React;

    let isSuspended = true;
    let resolve;
    /** 按测试信号抛出 thenable，制造可恢复的 Suspense 挂起。 */
    function trySuspend() {
      if (isSuspended) {
        throw new Promise(res => {
          /** 先关闭isSuspended再resolve原生Promise，恢复render时输出hello。 */
          resolve = () => {
            isSuspended = false;
            res();
          };
        });
      }
    }

    /** forwardRef 的渲染函数：建立 state Hook 后尝试挂起，恢复时输出 hello。 */
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
  /** memo包forwardRef的render先useState再挂起，loading→resolve→hello；双包装恢复不得误报Hook顺序。 */
  it('does not fire a false positive warning when suspending memo(forwardRef)', async () => {
    const {Suspense, useState} = React;

    let isSuspended = true;
    let resolve;
    /** 按测试信号抛出 thenable，制造可恢复的 Suspense 挂起。 */
    function trySuspend() {
      if (isSuspended) {
        throw new Promise(res => {
          /** 先关闭isSuspended再resolve原生Promise，恢复render时输出hello。 */
          resolve = () => {
            isSuspended = false;
            res();
          };
        });
      }
    }

    /** memo/forwardRef 的渲染函数：建立 state Hook 后挂起，检验包装层恢复时不误报 Hook 顺序。 */
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
  /** Thrower初挂state后effect输出Throw；setShouldThrow(true)在state与effect间抛错，ErrorBoundary输出Error，经Wrapper透传，验证异常中途Hook游标清理。 */
  it('resets hooks when an error is thrown in the middle of a list of hooks', async () => {
    const {useEffect, useState} = React;

    /** 捕获Thrower错误并经Wrapper输出Error，使Hook链中途抛错后的恢复可见。 */
    class ErrorBoundary extends React.Component {
      /** 保存 ErrorBoundary.state 的实例状态，作为错误恢复或生命周期断言的跨提交标记。 */
      state = {hasError: false};

      /** ErrorBoundary.getDerivedStateFromError 把捕获错误转换为稳定的边界回退状态。 */
      static getDerivedStateFromError() {
        return {hasError: true};
      }

      /** 经Wrapper透传Error或正常children，观察错误恢复不会沿用中断的Hook游标。 */
      render() {
        return (
          <Wrapper>
            {this.state.hasError ? 'Error!' : this.props.children}
          </Wrapper>
        );
      }
    }

    /** 原样返回children，错误恢复时由上游边界把Error文本透传；本函数没有边界或Hook。 */
    function Wrapper({children}) {
      return children;
    }

    let setShouldThrow;
    /** 暴露 shouldThrow 更新器，在 state Hook 与 Effect Hook 之间抛错，检查下一次尝试的 Hook 游标。 */
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
