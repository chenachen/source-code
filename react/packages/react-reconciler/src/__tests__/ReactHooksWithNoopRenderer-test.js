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
let textCache;
let readText;
let resolveText;
let ReactNoop;
let Scheduler;
let Suspense;
let Activity;
let useState;
let useReducer;
let useEffect;
let useInsertionEffect;
let useLayoutEffect;
let useCallback;
let useMemo;
let useRef;
let useImperativeHandle;
let useTransition;
let useDeferredValue;
let forwardRef;
let memo;
let act;
let ContinuousEventPriority;
let SuspenseList;
let waitForAll;
let waitFor;
let waitForThrow;
let waitForPaint;
let assertLog;
let assertConsoleErrorDev;

/** 通过 Noop 渲染器验证 Hooks 状态队列、Effect 提交顺序、并发中断与历史回归。 */
describe('ReactHooksWithNoopRenderer', () => {
  /** 每个用例重置模块与警告状态，并重新绑定 React、Noop 渲染器、调度日志及内部断言工具。 */
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
    useState = React.useState;
    useReducer = React.useReducer;
    useEffect = React.useEffect;
    useInsertionEffect = React.useInsertionEffect;
    useLayoutEffect = React.useLayoutEffect;
    useCallback = React.useCallback;
    useMemo = React.useMemo;
    useRef = React.useRef;
    useImperativeHandle = React.useImperativeHandle;
    forwardRef = React.forwardRef;
    memo = React.memo;
    useTransition = React.useTransition;
    useDeferredValue = React.useDeferredValue;
    Suspense = React.Suspense;
    Activity = React.Activity;
    ContinuousEventPriority =
      require('react-reconciler/constants').ContinuousEventPriority;
    if (gate(flags => flags.enableSuspenseList)) {
      SuspenseList = React.unstable_SuspenseList;
    }

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    waitFor = InternalTestUtils.waitFor;
    waitForThrow = InternalTestUtils.waitForThrow;
    waitForPaint = InternalTestUtils.waitForPaint;
    assertLog = InternalTestUtils.assertLog;

    textCache = new Map();

    readText = text => {
      const record = textCache.get(text);
      if (record !== undefined) {
        switch (record.status) {
          case 'pending':
            throw record.promise;
          case 'rejected':
            throw Error('Failed to load: ' + text);
          case 'resolved':
            return text;
        }
      } else {
        let ping;
        const promise = new Promise(resolve => (ping = resolve));
        const newRecord = {
          status: 'pending',
          ping: ping,
          promise,
        };
        textCache.set(text, newRecord);
        throw promise;
      }
    };

    resolveText = text => {
      const record = textCache.get(text);
      if (record !== undefined) {
        if (record.status === 'pending') {
          Scheduler.log(`Promise resolved [${text}]`);
          record.ping();
          record.ping = null;
          record.status = 'resolved';
          clearTimeout(record.promise._timer);
          record.promise = null;
        }
      } else {
        const newRecord = {
          ping: null,
          status: 'resolved',
          promise: null,
        };
        textCache.set(text, newRecord);
      }
    };
  });

  /** 把输入同步到调度日志与宿主输出；服务于“通过 Noop 渲染器验证 Hooks 状态队列、Effect 提交顺序、并发中断与历史回归”场景。 */
  function Text(props) {
    Scheduler.log(props.text);
    return <span prop={props.text} />;
  }

  /** 把输入同步到调度日志与宿主输出；服务于“通过 Noop 渲染器验证 Hooks 状态队列、Effect 提交顺序、并发中断与历史回归”场景。 */
  function AsyncText(props) {
    const text = props.text;
    try {
      readText(text);
      Scheduler.log(text);
      return <span prop={text} />;
    } catch (promise) {
      if (typeof promise.then === 'function') {
        Scheduler.log(`Suspend! [${text}]`);
        if (typeof props.ms === 'number' && promise._timer === undefined) {
          promise._timer = setTimeout(() => {
            resolveText(text);
          }, props.ms);
        }
      } else {
        Scheduler.log(`Error! [${text}]`);
      }
      throw promise;
    }
  }

  /** 推进 Jest 虚拟时间并等待当前 tick 结束，隔离调度器时间与测试时间；服务于“通过 Noop 渲染器验证 Hooks 状态队列、Effect 提交顺序、并发中断与历史回归”场景。 */
  function advanceTimers(ms) {
    // 注意：这里只推进 Jest 虚拟时间，不推进 React 时间；后者应使用 `ReactNoop.expire`。
    if (typeof ms !== 'number') {
      throw new Error('Must specify ms');
    }
    jest.advanceTimersByTime(ms);
    // 等待当前 tick 结束；由于定时器已被模拟，不能用 timer 实现该等待。
    return Promise.resolve().then(() => {});
  }

  /**
   * Given：并发根已挂载，低优先级工作、thenable 与日志检查点均已准备。
   * When：启动并发渲染，再制造挂起或高优先级中断并恢复。
   * Then：低优先级 Hook 渲染被同步更新打断后恢复，确认工作进度与更新队列保持一致。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
   * 对应源码：`renderWithHooks()` 与当前 Hook 的 mount/update dispatcher。
   */
  it('resumes after an interruption', async () => {
    /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“低优先级 Hook 渲染被同步更新打断后恢复，确认工作进度与更新队列保持一致”场景。 */
    function Counter(props, ref) {
      const [count, updateCount] = useState(0);
      useImperativeHandle(ref, () => ({updateCount}));
      return <Text text={props.label + ': ' + count} />;
    }
    Counter = forwardRef(Counter);

    // 执行首次挂载。
    const counter = React.createRef(null);
    ReactNoop.render(<Counter label="Count" ref={counter} />);
    await waitForAll(['Count: 0']);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);

    // 安排若干更新。
    await act(async () => {
      React.startTransition(() => {
        counter.current.updateCount(1);
        counter.current.updateCount(count => count + 10);
      });

      // 只冲刷部分工作，暂不提交。
      await waitFor(['Count: 11']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);

      // 用高优先级更新打断当前工作。
      ReactNoop.flushSync(() => {
        ReactNoop.render(<Counter label="Total" />);
      });
      assertLog(['Total: 0']);

      // 恢复渲染。
      await waitForAll(['Total: 11']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Total: 11" />);
    });
  });

  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：在无有效函数组件 dispatcher 的位置调用 Hook，确认立即抛出非法调用错误。
   *
   * 验证机制：显式断言联合检查状态、输出和副作用。
   * 对应源码：`renderWithHooks()` 与当前 Hook 的 mount/update dispatcher。
   */
  it('throws inside class components', async () => {
    /** 定义 BadCounter 类 fixture，在“在无有效函数组件 dispatcher 的位置调用 Hook，确认立即抛出非法调用错误”场景中暴露类生命周期、实例 ref 或错误边界。 */
    class BadCounter extends React.Component {
      /** 渲染 BadCounter.render 对应的类 fixture，并把本轮状态或子树交给宿主输出断言。 */
      render() {
        const [count] = useState(0);
        return <Text text={this.props.label + ': ' + count} />;
      }
    }
    ReactNoop.render(<BadCounter />);

    await waitForThrow(
      'Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for' +
        ' one of the following reasons:\n' +
        '1. You might have mismatching versions of React and the renderer (such as React DOM)\n' +
        '2. You might be breaking the Rules of Hooks\n' +
        '3. You might have more than one copy of React in the same app\n' +
        'See https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem.',
    );

    // 确认后续 Hook 仍能正常工作。
    /** 作为 GoodCounter fixture 承载当前测试职责；服务于“在无有效函数组件 dispatcher 的位置调用 Hook，确认立即抛出非法调用错误”场景。 */
    function GoodCounter(props, ref) {
      const [count] = useState(props.initialCount);
      return <Text text={count} />;
    }
    ReactNoop.render(<GoodCounter initialCount={10} />);
    await waitForAll([10]);
  });

  /**
   * Given：目标组件已进入可触发开发态保护的最小运行环境。
   * When：执行用例中的非法 Hook、参数或阶段调用。
   * Then：在无有效函数组件 dispatcher 的位置调用 Hook，确认立即抛出非法调用错误。
   *
   * 验证机制：开发态控制台断言限定诊断内容与去重，异常断言保留原始错误与阶段边界。
   * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `renderWithHooksAgain()`。
   */
  it('throws when called outside the render phase', async () => {
    expect(() => useState(0)).toThrow(
      "Cannot read property 'useState' of null",
    );
    assertConsoleErrorDev([
      'Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for' +
        ' one of the following reasons:\n' +
        '1. You might have mismatching versions of React and the renderer (such as React DOM)\n' +
        '2. You might be breaking the Rules of Hooks\n' +
        '3. You might have more than one copy of React in the same app\n' +
        'See https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem.',
    ]);
  });

  /** 通过 Noop 渲染器验证 Hooks 状态队列、Effect 提交顺序、并发中断与历史回归。 */
  describe('useState', () => {
    /**
     * Given：挂载后更新 Hook 状态，确认初值、更新函数与宿主输出按序变化所需的初始状态、更新入口与观测日志均已建立。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：挂载后更新 Hook 状态，确认初值、更新函数与宿主输出按序变化。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`renderWithHooks()` 与当前 Hook 的 mount/update dispatcher。
     */
    it('simple mount and update', async () => {
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“挂载后更新 Hook 状态，确认初值、更新函数与宿主输出按序变化”场景。 */
      function Counter(props, ref) {
        const [count, updateCount] = useState(0);
        useImperativeHandle(ref, () => ({updateCount}));
        return <Text text={'Count: ' + count} />;
      }
      Counter = forwardRef(Counter);
      const counter = React.createRef(null);
      ReactNoop.render(<Counter ref={counter} />);
      await waitForAll(['Count: 0']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);

      await act(() => counter.current.updateCount(1));
      assertLog(['Count: 1']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 1" />);

      await act(() => counter.current.updateCount(count => count + 10));
      assertLog(['Count: 11']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 11" />);
    });

    /**
     * Given：以惰性初始化函数挂载 state 或 reducer，确认初始化只在挂载路径执行所需的初始状态、更新入口与观测日志均已建立。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：以惰性初始化函数挂载 state 或 reducer，确认初始化只在挂载路径执行。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `renderWithHooksAgain()`。
     */
    it('lazy state initializer', async () => {
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“以惰性初始化函数挂载 state 或 reducer，确认初始化只在挂载路径执行”场景。 */
      function Counter(props, ref) {
        const [count, updateCount] = useState(() => {
          Scheduler.log('getInitialState');
          return props.initialState;
        });
        useImperativeHandle(ref, () => ({updateCount}));
        return <Text text={'Count: ' + count} />;
      }
      Counter = forwardRef(Counter);
      const counter = React.createRef(null);
      ReactNoop.render(<Counter initialState={42} ref={counter} />);
      await waitForAll(['getInitialState', 'Count: 42']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 42" />);

      await act(() => counter.current.updateCount(7));
      assertLog(['Count: 7']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 7" />);
    });

    /**
     * Given：同一组件声明多个 state Hook，确认各 Hook 槽位独立更新所需的初始状态、更新入口与观测日志均已建立。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：同一组件声明多个 state Hook，确认各 Hook 槽位独立更新。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `renderWithHooksAgain()`。
     */
    it('multiple states', async () => {
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“同一组件声明多个 state Hook，确认各 Hook 槽位独立更新”场景。 */
      function Counter(props, ref) {
        const [count, updateCount] = useState(0);
        const [label, updateLabel] = useState('Count');
        useImperativeHandle(ref, () => ({updateCount, updateLabel}));
        return <Text text={label + ': ' + count} />;
      }
      Counter = forwardRef(Counter);
      const counter = React.createRef(null);
      ReactNoop.render(<Counter ref={counter} />);
      await waitForAll(['Count: 0']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);

      await act(() => counter.current.updateCount(7));
      assertLog(['Count: 7']);

      await act(() => counter.current.updateLabel('Total'));
      assertLog(['Total: 7']);
    });

    /**
     * Given：跨多次渲染比较 dispatch 身份，确认更新函数引用保持稳定所需的初始状态、更新入口与观测日志均已建立。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：跨多次渲染比较 dispatch 身份，确认更新函数引用保持稳定。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`renderWithHooks()` 与当前 Hook 的 mount/update dispatcher。
     */
    it('returns the same updater function every time', async () => {
      let updater = null;
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“跨多次渲染比较 dispatch 身份，确认更新函数引用保持稳定”场景。 */
      function Counter() {
        const [count, updateCount] = useState(0);
        updater = updateCount;
        return <Text text={'Count: ' + count} />;
      }
      ReactNoop.render(<Counter />);
      await waitForAll(['Count: 0']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);

      const firstUpdater = updater;

      await act(() => firstUpdater(1));
      assertLog(['Count: 1']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 1" />);

      const secondUpdater = updater;

      await act(() => firstUpdater(count => count + 10));
      assertLog(['Count: 11']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 11" />);

      expect(firstUpdater).toBe(secondUpdater);
    });

    /**
     * Given：目标组件已进入可触发开发态保护的最小运行环境。
     * When：执行用例中的非法 Hook、参数或阶段调用。
     * Then：组件卸载前后安排 state 更新，确认清理窗口不会产生过期告警。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('does not warn on set after unmount', async () => {
      let _updateCount;
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“组件卸载前后安排 state 更新，确认清理窗口不会产生过期告警”场景。 */
      function Counter(props, ref) {
        const [, updateCount] = useState(0);
        _updateCount = updateCount;
        return null;
      }

      ReactNoop.render(<Counter />);
      await waitForAll([]);
      ReactNoop.render(null);
      await waitForAll([]);
      await act(() => _updateCount(1));
    });

    /**
     * Given：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果所需的初始状态、更新入口与观测日志均已建立。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`updateMemo()`、`updateCallback()` 与 `areHookInputsEqual()`。
     */
    it('works with memo', async () => {
      let _updateCount;
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果”场景。 */
      function Counter(props) {
        const [count, updateCount] = useState(0);
        _updateCount = updateCount;
        return <Text text={'Count: ' + count} />;
      }
      Counter = memo(Counter);

      ReactNoop.render(<Counter />);
      await waitForAll(['Count: 0']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);

      ReactNoop.render(<Counter />);
      await waitForAll([]);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);

      await act(() => _updateCount(1));
      assertLog(['Count: 1']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 1" />);
    });
  });

  /** 通过 Noop 渲染器验证 Hooks 状态队列、Effect 提交顺序、并发中断与历史回归。 */
  describe('updates during the render phase', () => {
    /**
     * Given：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果所需的初始状态、更新入口与观测日志均已建立。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果。
     *
     * 验证机制：宿主输出断言确认实际提交结果。
     * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `renderWithHooksAgain()`。
     */
    it('restarts the render function and applies the new updates on top', async () => {
      /** 作为 ScrollView fixture 承载当前测试职责；服务于“执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果”场景。 */
      function ScrollView({row: newRow}) {
        const [isScrollingDown, setIsScrollingDown] = useState(false);
        const [row, setRow] = useState(null);

        if (row !== newRow) {
          // Row 自上次渲染后发生变化，更新 `isScrollingDown`。
          setIsScrollingDown(row !== null && newRow > row);
          setRow(newRow);
        }

        return <Text text={`Scrolling down: ${isScrollingDown}`} />;
      }

      ReactNoop.render(<ScrollView row={1} />);
      await waitForAll(['Scrolling down: false']);
      expect(ReactNoop).toMatchRenderedOutput(
        <span prop="Scrolling down: false" />,
      );

      ReactNoop.render(<ScrollView row={5} />);
      await waitForAll(['Scrolling down: true']);
      expect(ReactNoop).toMatchRenderedOutput(
        <span prop="Scrolling down: true" />,
      );

      ReactNoop.render(<ScrollView row={5} />);
      await waitForAll(['Scrolling down: true']);
      expect(ReactNoop).toMatchRenderedOutput(
        <span prop="Scrolling down: true" />,
      );

      ReactNoop.render(<ScrollView row={10} />);
      await waitForAll(['Scrolling down: true']);
      expect(ReactNoop).toMatchRenderedOutput(
        <span prop="Scrolling down: true" />,
      );

      ReactNoop.render(<ScrollView row={2} />);
      await waitForAll(['Scrolling down: false']);
      expect(ReactNoop).toMatchRenderedOutput(
        <span prop="Scrolling down: false" />,
      );

      ReactNoop.render(<ScrollView row={2} />);
      await waitForAll(['Scrolling down: false']);
      expect(ReactNoop).toMatchRenderedOutput(
        <span prop="Scrolling down: false" />,
      );
    });

    /**
     * Given：目标组件已进入可触发开发态保护的最小运行环境。
     * When：执行用例中的非法 Hook、参数或阶段调用。
     * Then：渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，开发态控制台断言限定诊断内容与去重。
     * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `renderWithHooksAgain()`。
     */
    it('warns about render phase update on a different component', async () => {
      let setStep;
      /** 作为 Foo fixture 承载当前测试职责；服务于“渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断”场景。 */
      function Foo() {
        const [step, _setStep] = useState(0);
        setStep = _setStep;
        return <Text text={`Foo [${step}]`} />;
      }

      /** 作为 Bar fixture 承载当前测试职责；服务于“渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断”场景。 */
      function Bar({triggerUpdate}) {
        if (triggerUpdate) {
          setStep(x => x + 1);
        }
        return <Text text="Bar" />;
      }

      const root = ReactNoop.createRoot();

      await act(() => {
        root.render(
          <>
            <Foo />
            <Bar />
          </>,
        );
      });
      assertLog(['Foo [0]', 'Bar']);

      // Bar 会在自身渲染期间更新 Foo，React 应产生告警。
      root.render(
        <>
          <Foo />
          <Bar triggerUpdate={true} />
        </>,
      );
      await waitForAll(['Foo [0]', 'Bar', 'Foo [1]']);
      assertConsoleErrorDev([
        'Cannot update a component (`Foo`) while rendering a different component (`Bar`). ' +
          'To locate the bad setState() call inside `Bar`, ' +
          'follow the stack trace as described in https://react.dev/link/setstate-in-render\n' +
          '    in Bar (at **)',
      ]);

      // 相同诊断不应再次告警，以验证去重。
      await act(async () => {
        root.render(
          <>
            <Foo />
            <Bar triggerUpdate={true} />
          </>,
        );
        await waitForAll(['Foo [1]', 'Bar', 'Foo [2]']);
      });
    });

    /**
     * Given：渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断所需的初始状态、更新入口与观测日志均已建立。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断。
     *
     * 验证机制：宿主输出断言确认实际提交结果。
     * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `renderWithHooksAgain()`。
     */
    it('keeps restarting until there are no more new updates', async () => {
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断”场景。 */
      function Counter({row: newRow}) {
        const [count, setCount] = useState(0);
        if (count < 3) {
          setCount(count + 1);
        }
        Scheduler.log('Render: ' + count);
        return <Text text={count} />;
      }

      ReactNoop.render(<Counter />);
      await waitForAll(['Render: 0', 'Render: 1', 'Render: 2', 'Render: 3', 3]);
      expect(ReactNoop).toMatchRenderedOutput(<span prop={3} />);
    });

    /**
     * Given：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果所需的初始状态、更新入口与观测日志均已建立。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果。
     *
     * 验证机制：宿主输出断言确认实际提交结果。
     * 对应源码：`renderWithHooks()` 与当前 Hook 的 mount/update dispatcher。
     */
    it('updates multiple times within same render function', async () => {
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果”场景。 */
      function Counter({row: newRow}) {
        const [count, setCount] = useState(0);
        if (count < 12) {
          setCount(c => c + 1);
          setCount(c => c + 1);
          setCount(c => c + 1);
        }
        Scheduler.log('Render: ' + count);
        return <Text text={count} />;
      }

      ReactNoop.render(<Counter />);
      await waitForAll([
        // 每次应增加三。
        'Render: 0',
        'Render: 3',
        'Render: 6',
        'Render: 9',
        'Render: 12',
        12,
      ]);
      expect(ReactNoop).toMatchRenderedOutput(<span prop={12} />);
    });

    /**
     * Given：目标组件已进入可触发开发态保护的最小运行环境。
     * When：执行用例中的非法 Hook、参数或阶段调用。
     * Then：渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`renderWithHooks()` 与当前 Hook 的 mount/update dispatcher。
     */
    it('throws after too many iterations', async () => {
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断”场景。 */
      function Counter({row: newRow}) {
        const [count, setCount] = useState(0);
        setCount(count + 1);
        Scheduler.log('Render: ' + count);
        return <Text text={count} />;
      }
      ReactNoop.render(<Counter />);
      await waitForThrow(
        'Too many re-renders. React limits the number of renders to prevent ' +
          'an infinite loop.',
      );
    });

    /**
     * Given：驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action所需的初始状态、更新入口与观测日志均已建立。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action。
     *
     * 验证机制：宿主输出断言确认实际提交结果。
     * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `renderWithHooksAgain()`。
     */
    it('works with useReducer', async () => {
      /** 根据 action 与当前状态计算 reducer 的下一状态；服务于“驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action”场景。 */
      function reducer(state, action) {
        return action === 'increment' ? state + 1 : state;
      }
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action”场景。 */
      function Counter({row: newRow}) {
        const [count, dispatch] = useReducer(reducer, 0);
        if (count < 3) {
          dispatch('increment');
        }
        Scheduler.log('Render: ' + count);
        return <Text text={count} />;
      }

      ReactNoop.render(<Counter />);
      await waitForAll(['Render: 0', 'Render: 1', 'Render: 2', 'Render: 3', 3]);
      expect(ReactNoop).toMatchRenderedOutput(<span prop={3} />);
    });

    /**
     * Given：驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action所需的初始状态、更新入口与观测日志均已建立。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `renderWithHooksAgain()`。
     */
    it('uses reducer passed at time of render, not time of dispatch', async () => {
      // 该构造虽不常见，但用于展示一个细微边界。

      // Reducer A 每次加 1，Reducer B 每次加 10。
      /** 根据 action 与当前状态计算 reducer 的下一状态；服务于“驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action”场景。 */
      function reducerA(state, action) {
        switch (action) {
          case 'increment':
            return state + 1;
          case 'reset':
            return 0;
        }
      }
      /** 根据 action 与当前状态计算 reducer 的下一状态；服务于“驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action”场景。 */
      function reducerB(state, action) {
        switch (action) {
          case 'increment':
            return state + 10;
          case 'reset':
            return 0;
        }
      }

      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action”场景。 */
      function Counter({row: newRow}, ref) {
        const [reducer, setReducer] = useState(() => reducerA);
        const [count, dispatch] = useReducer(reducer, 0);
        useImperativeHandle(ref, () => ({dispatch}));
        if (count < 20) {
          dispatch('increment');
          // 每次递增时交换 reducer。
          if (reducer === reducerA) {
            setReducer(() => reducerB);
          } else {
            setReducer(() => reducerA);
          }
        }
        Scheduler.log('Render: ' + count);
        return <Text text={count} />;
      }
      Counter = forwardRef(Counter);
      const counter = React.createRef(null);
      ReactNoop.render(<Counter ref={counter} />);
      await waitForAll([
        // 计数应交替增加 10 和 1，直至达到 21。
        'Render: 0',
        'Render: 10',
        'Render: 11',
        'Render: 21',
        21,
      ]);
      expect(ReactNoop).toMatchRenderedOutput(<span prop={21} />);

      // 继续验证更新路径；这次从 reducerB 而非 reducerA 开始，因此日志略有不同。
      await act(() => {
        counter.current.dispatch('reset');
      });
      ReactNoop.render(<Counter ref={counter} />);
      assertLog([
        'Render: 0',
        'Render: 1',
        'Render: 11',
        'Render: 12',
        'Render: 22',
        22,
      ]);
      expect(ReactNoop).toMatchRenderedOutput(<span prop={22} />);
    });

    /**
     * Given：并发根已挂载，低优先级工作、thenable 与日志检查点均已准备。
     * When：启动并发渲染，再制造挂起或高优先级中断并恢复。
     * Then：渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断。
     *
     * 验证机制：宿主输出断言确认实际提交结果。
     * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `renderWithHooksAgain()`。
     */
    it('discards render phase updates if something suspends', async () => {
      /** then 模拟 thenable 订阅入口，保存或立即调度渲染唤醒回调。 */
      const thenable = {/** 挂起协议入口；该 fixture 永不主动唤醒渲染。 */ then() {}};
      /** 作为 Foo fixture 承载当前测试职责；服务于“渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断”场景。 */
      function Foo({signal}) {
        return (
          <Suspense fallback="Loading...">
            <Bar signal={signal} />
          </Suspense>
        );
      }

      /** 作为 Bar fixture 承载当前测试职责；服务于“渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断”场景。 */
      function Bar({signal: newSignal}) {
        const [counter, setCounter] = useState(0);
        const [signal, setSignal] = useState(true);

        // 每次 signal 变化时递增计数。
        if (signal !== newSignal) {
          setCounter(c => c + 1);
          setSignal(newSignal);
          if (counter === 0) {
            // 当前渲染既包含渲染阶段更新又发生挂起；这些更新不应泄漏到下一次渲染。
            Scheduler.log('Suspend!');
            throw thenable;
          }
        }

        return <Text text={counter} />;
      }

      const root = ReactNoop.createRoot();
      root.render(<Foo signal={true} />);

      await waitForAll([0]);
      expect(root).toMatchRenderedOutput(<span prop={0} />);

      React.startTransition(() => {
        root.render(<Foo signal={false} />);
      });
      await waitForAll(['Suspend!']);
      expect(root).toMatchRenderedOutput(<span prop={0} />);

      // 再次渲染应再次挂起。
      React.startTransition(() => {
        root.render(<Foo signal={false} />);
      });
      await waitForAll(['Suspend!']);
    });

    /**
     * Given：并发根已挂载，低优先级工作、thenable 与日志检查点均已准备。
     * When：启动并发渲染，再制造挂起或高优先级中断并恢复。
     * Then：渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断。
     *
     * 验证机制：宿主输出断言确认实际提交结果。
     * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `renderWithHooksAgain()`。
     */
    it('discards render phase updates if something suspends, but not other updates in the same component', async () => {
      /** then 模拟 thenable 订阅入口，保存或立即调度渲染唤醒回调。 */
      const thenable = {/** 挂起协议入口；该 fixture 永不主动唤醒渲染。 */ then() {}};
      /** 作为 Foo fixture 承载当前测试职责；服务于“渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断”场景。 */
      function Foo({signal}) {
        return (
          <Suspense fallback="Loading...">
            <Bar signal={signal} />
          </Suspense>
        );
      }

      let setLabel;
      /** 作为 Bar fixture 承载当前测试职责；服务于“渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断”场景。 */
      function Bar({signal: newSignal}) {
        const [counter, setCounter] = useState(0);

        if (counter === 1) {
          // 当前渲染既包含渲染阶段更新又发生挂起；这些更新不应泄漏到下一次渲染。
          Scheduler.log('Suspend!');
          throw thenable;
        }

        const [signal, setSignal] = useState(true);

        // 每次 signal 变化时递增计数。
        if (signal !== newSignal) {
          setCounter(c => c + 1);
          setSignal(newSignal);
        }

        const [label, _setLabel] = useState('A');
        setLabel = _setLabel;

        return <Text text={`${label}:${counter}`} />;
      }

      const root = ReactNoop.createRoot();
      root.render(<Foo signal={true} />);

      await waitForAll(['A:0']);
      expect(root).toMatchRenderedOutput(<span prop="A:0" />);

      await act(async () => {
        React.startTransition(() => {
          root.render(<Foo signal={false} />);
          setLabel('B');
        });

        await waitForAll(['Suspend!']);
        expect(root).toMatchRenderedOutput(<span prop="A:0" />);

        // 再次渲染应再次挂起。
        React.startTransition(() => {
          root.render(<Foo signal={false} />);
        });
        await waitForAll(['Suspend!']);

        // 把 signal 改回原值以“取消”该更新，但 label 更新仍应继续，不能被丢弃。
        React.startTransition(() => {
          root.render(<Foo signal={true} />);
        });
        await waitForAll(['B:0']);
        expect(root).toMatchRenderedOutput(<span prop="B:0" />);
      });
    });

    /**
     * Given：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果所需的初始状态、更新入口与观测日志均已建立。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果。
     *
     * 验证机制：宿主输出断言确认实际提交结果。
     * 对应源码：`renderWithHooks()` 与当前 Hook 的 mount/update dispatcher。
     */
    it(
      'preserves pending updates on later hooks that were not processed ' +
        'before unwind',
      async () => {
        /** then 模拟 thenable 订阅入口，保存或立即调度渲染唤醒回调。 */
        const thenable = {/** 挂起协议入口；该 fixture 永不主动唤醒渲染。 */ then() {}};

        let setLabel;
        /** 作为 Foo fixture 承载当前测试职责；服务于“执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果”场景。 */
        function Foo({suspend}) {
          return (
            <Suspense fallback="Loading...">
              <Bar suspend={suspend} />
            </Suspense>
          );
        }

        /** 作为 Bar fixture 承载当前测试职责；服务于“执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果”场景。 */
        function Bar({suspend}) {
          const [counter, setCounter] = useState(0);

          if (suspend) {
            setCounter(c => c + 1);
            Scheduler.log('Suspend!');
            throw thenable;
          }

          const [label, _setLabel] = useState('A');
          setLabel = _setLabel;

          return <Text text={`${label}:${counter}`} />;
        }

        const root = ReactNoop.createRoot();
        root.render(<Foo suspend={false} />);

        await waitForAll(['A:0']);
        expect(root).toMatchRenderedOutput(<span prop="A:0" />);

        await act(async () => {
          React.startTransition(() => {
            root.render(<Foo suspend={true} />);
            setLabel('B');
          });

          await waitForAll(['Suspend!']);
          expect(root).toMatchRenderedOutput(<span prop="A:0" />);

          React.startTransition(() => {
            root.render(<Foo suspend={false} />);
          });

          await waitForAll(['B:0']);
          expect(root).toMatchRenderedOutput(<span prop="B:0" />);
        });
      },
    );

    /**
     * Given：渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断所需的初始状态、更新入口与观测日志均已建立。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `renderWithHooksAgain()`。
     */
    it('regression: render phase updates cause lower pri work to be dropped', async () => {
      let setRow;
      /** 作为 ScrollView fixture 承载当前测试职责；服务于“渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断”场景。 */
      function ScrollView() {
        const [row, _setRow] = useState(10);
        setRow = _setRow;

        const [scrollDirection, setScrollDirection] = useState('Up');
        const [prevRow, setPrevRow] = useState(null);

        if (prevRow !== row) {
          setScrollDirection(prevRow !== null && row > prevRow ? 'Down' : 'Up');
          setPrevRow(row);
        }

        return <Text text={scrollDirection} />;
      }

      const root = ReactNoop.createRoot();

      await act(() => {
        root.render(<ScrollView row={10} />);
      });
      assertLog(['Up']);
      expect(root).toMatchRenderedOutput(<span prop="Up" />);

      await act(() => {
        ReactNoop.discreteUpdates(() => {
          setRow(5);
        });
        React.startTransition(() => {
          setRow(20);
        });
      });
      assertLog(['Up', 'Down']);
      expect(root).toMatchRenderedOutput(<span prop="Down" />);
    });

    // TODO：这里可能应产生告警。
    /**
     * Given：渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断所需的初始状态、更新入口与观测日志均已建立。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断。
     *
     * 验证机制：宿主输出断言确认实际提交结果。
     * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `renderWithHooksAgain()`。
     */
    it('calling startTransition inside render phase', async () => {
      /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断”场景。 */
      function App() {
        const [counter, setCounter] = useState(0);

        if (counter === 0) {
          React.startTransition(() => {
            setCounter(c => c + 1);
          });
        }

        return <Text text={counter} />;
      }

      const root = ReactNoop.createRoot();
      root.render(<App />);
      await waitForAll([1]);
      expect(root).toMatchRenderedOutput(<span prop={1} />);
    });
  });

  /** 通过 Noop 渲染器验证 Hooks 状态队列、Effect 提交顺序、并发中断与历史回归。 */
  describe('useReducer', () => {
    /**
     * Given：挂载后更新 Hook 状态，确认初值、更新函数与宿主输出按序变化所需的初始状态、更新入口与观测日志均已建立。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：挂载后更新 Hook 状态，确认初值、更新函数与宿主输出按序变化。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`renderWithHooks()` 与当前 Hook 的 mount/update dispatcher。
     */
    it('simple mount and update', async () => {
      const INCREMENT = 'INCREMENT';
      const DECREMENT = 'DECREMENT';

      /** 根据 action 与当前状态计算 reducer 的下一状态；服务于“挂载后更新 Hook 状态，确认初值、更新函数与宿主输出按序变化”场景。 */
      function reducer(state, action) {
        switch (action) {
          case 'INCREMENT':
            return state + 1;
          case 'DECREMENT':
            return state - 1;
          default:
            return state;
        }
      }

      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“挂载后更新 Hook 状态，确认初值、更新函数与宿主输出按序变化”场景。 */
      function Counter(props, ref) {
        const [count, dispatch] = useReducer(reducer, 0);
        useImperativeHandle(ref, () => ({dispatch}));
        return <Text text={'Count: ' + count} />;
      }
      Counter = forwardRef(Counter);
      const counter = React.createRef(null);
      ReactNoop.render(<Counter ref={counter} />);
      await waitForAll(['Count: 0']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);

      await act(() => counter.current.dispatch(INCREMENT));
      assertLog(['Count: 1']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 1" />);
      await act(() => {
        counter.current.dispatch(DECREMENT);
        counter.current.dispatch(DECREMENT);
        counter.current.dispatch(DECREMENT);
      });

      assertLog(['Count: -2']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: -2" />);
    });

    /**
     * Given：以惰性初始化函数挂载 state 或 reducer，确认初始化只在挂载路径执行所需的初始状态、更新入口与观测日志均已建立。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：以惰性初始化函数挂载 state 或 reducer，确认初始化只在挂载路径执行。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`renderWithHooks()` 与当前 Hook 的 mount/update dispatcher。
     */
    it('lazy init', async () => {
      const INCREMENT = 'INCREMENT';
      const DECREMENT = 'DECREMENT';

      /** 根据 action 与当前状态计算 reducer 的下一状态；服务于“以惰性初始化函数挂载 state 或 reducer，确认初始化只在挂载路径执行”场景。 */
      function reducer(state, action) {
        switch (action) {
          case 'INCREMENT':
            return state + 1;
          case 'DECREMENT':
            return state - 1;
          default:
            return state;
        }
      }

      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“以惰性初始化函数挂载 state 或 reducer，确认初始化只在挂载路径执行”场景。 */
      function Counter(props, ref) {
        const [count, dispatch] = useReducer(reducer, props, p => {
          Scheduler.log('Init');
          return p.initialCount;
        });
        useImperativeHandle(ref, () => ({dispatch}));
        return <Text text={'Count: ' + count} />;
      }
      Counter = forwardRef(Counter);
      const counter = React.createRef(null);
      ReactNoop.render(<Counter initialCount={10} ref={counter} />);
      await waitForAll(['Init', 'Count: 10']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 10" />);

      await act(() => counter.current.dispatch(INCREMENT));
      assertLog(['Count: 11']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 11" />);

      await act(() => {
        counter.current.dispatch(DECREMENT);
        counter.current.dispatch(DECREMENT);
        counter.current.dispatch(DECREMENT);
      });

      assertLog(['Count: 8']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 8" />);
    });

    // 回归场景：https://github.com/facebook/react/issues/14360
    /**
     * Given：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果所需的初始状态、更新入口与观测日志均已建立。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`renderWithHooks()` 与当前 Hook 的 mount/update dispatcher。
     */
    it('handles dispatches with mixed priorities', async () => {
      const INCREMENT = 'INCREMENT';

      /** 根据 action 与当前状态计算 reducer 的下一状态；服务于“执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果”场景。 */
      function reducer(state, action) {
        return action === INCREMENT ? state + 1 : state;
      }

      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果”场景。 */
      function Counter(props, ref) {
        const [count, dispatch] = useReducer(reducer, 0);
        useImperativeHandle(ref, () => ({dispatch}));
        return <Text text={'Count: ' + count} />;
      }

      Counter = forwardRef(Counter);
      const counter = React.createRef(null);
      ReactNoop.render(<Counter ref={counter} />);

      await waitForAll(['Count: 0']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);

      ReactNoop.batchedUpdates(() => {
        counter.current.dispatch(INCREMENT);
        counter.current.dispatch(INCREMENT);
        counter.current.dispatch(INCREMENT);
      });

      ReactNoop.flushSync(() => {
        counter.current.dispatch(INCREMENT);
      });
      assertLog(['Count: 4']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 4" />);
    });
  });

  /** 通过 Noop 渲染器验证 Hooks 状态队列、Effect 提交顺序、并发中断与历史回归。 */
  describe('useEffect', () => {
    /**
     * Given：挂载后更新 Hook 状态，确认初值、更新函数与宿主输出按序变化所需的初始状态、更新入口与观测日志均已建立。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：挂载后更新 Hook 状态，确认初值、更新函数与宿主输出按序变化。
     *
     * 验证机制：宿主输出断言确认实际提交结果。
     * 对应源码：`renderWithHooks()` 与当前 Hook 的 mount/update dispatcher。
     */
    it('simple mount and update', async () => {
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“挂载后更新 Hook 状态，确认初值、更新函数与宿主输出按序变化”场景。 */
      function Counter(props) {
        useEffect(() => {
          Scheduler.log(`Passive effect [${props.count}]`);
        });
        return <Text text={'Count: ' + props.count} />;
      }
      await act(async () => {
        ReactNoop.render(<Counter count={0} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Count: 0', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);
        // Effect 延迟到提交后执行。
        await waitForAll(['Passive effect [0]']);
      });

      await act(async () => {
        ReactNoop.render(<Counter count={1} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Count: 1', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 1" />);
        // Effect 延迟到提交后执行。
        await waitForAll(['Passive effect [1]']);
      });
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：删除目标子树并冲刷对应提交阶段。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('flushes passive effects even with sibling deletions', async () => {
      /** 作为 LayoutEffect fixture 承载当前测试职责；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function LayoutEffect(props) {
        useLayoutEffect(() => {
          Scheduler.log(`Layout effect`);
        });
        return <Text text="Layout" />;
      }
      /** 作为 PassiveEffect fixture 承载当前测试职责；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function PassiveEffect(props) {
        useEffect(() => {
          Scheduler.log(`Passive effect`);
        }, []);
        return <Text text="Passive" />;
      }
      const passive = <PassiveEffect key="p" />;
      await act(async () => {
        ReactNoop.render([<LayoutEffect key="l" />, passive]);
        await waitFor(['Layout', 'Passive', 'Layout effect']);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="Layout" />
            <span prop="Passive" />
          </>,
        );
        // 销毁第一个子节点不应阻止兄弟节点的 Passive Effect 执行。
        ReactNoop.render([passive]);
        await waitForAll(['Passive effect']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Passive" />);
      });
      // 退出 `act` 会调用 `flushPassiveEffects()`，但此时已无剩余 Effect。
      assertLog([]);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：宿主输出断言确认实际提交结果。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('flushes passive effects even if siblings schedule an update', async () => {
      /** 作为 PassiveEffect fixture 承载当前测试职责；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function PassiveEffect(props) {
        useEffect(() => {
          Scheduler.log('Passive effect');
        });
        return <Text text="Passive" />;
      }
      /** 作为 LayoutEffect fixture 承载当前测试职责；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function LayoutEffect(props) {
        const [count, setCount] = useState(0);
        useLayoutEffect(() => {
          // 安排新工作不应干扰已入队的 Passive Effect。
          if (count === 0) {
            setCount(1);
          }
          Scheduler.log('Layout effect ' + count);
        });
        return <Text text="Layout" />;
      }

      ReactNoop.render([<PassiveEffect key="p" />, <LayoutEffect key="l" />]);

      await act(async () => {
        await waitForAll([
          'Passive',
          'Layout',
          'Layout effect 0',
          'Passive effect',
          'Layout',
          'Layout effect 1',
        ]);
      });

      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Passive" />
          <span prop="Layout" />
        </>,
      );
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：宿主输出断言确认实际提交结果。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('flushes passive effects even if siblings schedule a new root', async () => {
      /** 作为 PassiveEffect fixture 承载当前测试职责；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function PassiveEffect(props) {
        useEffect(() => {
          Scheduler.log('Passive effect');
        }, []);
        return <Text text="Passive" />;
      }
      /** 作为 LayoutEffect fixture 承载当前测试职责；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function LayoutEffect(props) {
        useLayoutEffect(() => {
          Scheduler.log('Layout effect');
          // 安排新工作不应干扰已入队的 Passive Effect。
          ReactNoop.renderToRootWithID(<Text text="New Root" />, 'root2');
        });
        return <Text text="Layout" />;
      }
      await act(async () => {
        ReactNoop.render([<PassiveEffect key="p" />, <LayoutEffect key="l" />]);
        await waitForAll([
          'Passive',
          'Layout',
          'Layout effect',
          'Passive effect',
          'New Root',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="Passive" />
            <span prop="Layout" />
          </>,
        );
      });
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it(
      'flushes effects serially by flushing old effects before flushing ' +
        "new ones, if they haven't already fired",
      async () => {
        /** 从已提交宿主节点读取文本，供 Effect 阶段检查突变可见性；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
        function getCommittedText() {
          const children = ReactNoop.getChildrenAsJSX();
          if (children === null) {
            return null;
          }
          return children.props.prop;
        }

        /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
        function Counter(props) {
          useEffect(() => {
            Scheduler.log(
              `Committed state when effect was fired: ${getCommittedText()}`,
            );
          });
          return <Text text={props.count} />;
        }
        await act(async () => {
          ReactNoop.render(<Counter count={0} />, () =>
            Scheduler.log('Sync effect'),
          );
          await waitFor([0, 'Sync effect']);
          expect(ReactNoop).toMatchRenderedOutput(<span prop={0} />);
          // 在 Effect 获得冲刷机会前再安排一次更新。
          ReactNoop.render(<Counter count={1} />, () =>
            Scheduler.log('Sync effect'),
          );
          await waitFor([
            // 前一次 Effect 在本轮 reconciliation 前先被冲刷。
            'Committed state when effect was fired: 0',
            1,
            'Sync effect',
          ]);
          expect(ReactNoop).toMatchRenderedOutput(<span prop={1} />);
        });

        assertLog(['Committed state when effect was fired: 1']);
      },
    );

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：删除目标子树并冲刷对应提交阶段。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('defers passive effect destroy functions during unmount', async () => {
      /** 作为子级函数组件暴露 Hook 状态和提交日志；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function Child({bar, foo}) {
        React.useEffect(() => {
          Scheduler.log('passive bar create');
          return () => {
            Scheduler.log('passive bar destroy');
          };
        }, [bar]);
        React.useLayoutEffect(() => {
          Scheduler.log('layout bar create');
          return () => {
            Scheduler.log('layout bar destroy');
          };
        }, [bar]);
        React.useEffect(() => {
          Scheduler.log('passive foo create');
          return () => {
            Scheduler.log('passive foo destroy');
          };
        }, [foo]);
        React.useLayoutEffect(() => {
          Scheduler.log('layout foo create');
          return () => {
            Scheduler.log('layout foo destroy');
          };
        }, [foo]);
        Scheduler.log('render');
        return null;
      }

      await act(async () => {
        ReactNoop.render(<Child bar={1} foo={1} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor([
          'render',
          'layout bar create',
          'layout foo create',
          'Sync effect',
        ]);
        // Effect 延迟到提交后执行。
        await waitForAll(['passive bar create', 'passive foo create']);
      });

      // 该更新用于验证内部细节：依赖未更新的 Effect 会在更新期间失去 layout/passive 标记。
      await act(async () => {
        ReactNoop.render(<Child bar={1} foo={2} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor([
          'render',
          'layout foo destroy',
          'layout foo create',
          'Sync effect',
        ]);
        // Effect 延迟到提交后执行。
        await waitForAll(['passive foo destroy', 'passive foo create']);
      });

      // 卸载组件，并确认 Passive Effect 清理函数延迟到提交后执行。
      await act(async () => {
        ReactNoop.render(null, () => Scheduler.log('Sync effect'));
        await waitFor([
          'layout bar destroy',
          'layout foo destroy',
          'Sync effect',
        ]);
        // Effect 延迟到提交后执行。
        await waitForAll(['passive bar destroy', 'passive foo destroy']);
      });
    });

    /**
     * Given：目标组件已进入可触发开发态保护的最小运行环境。
     * When：执行用例中的非法 Hook、参数或阶段调用。
     * Then：组件卸载前后安排 state 更新，确认清理窗口不会产生过期告警。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('does not warn about state updates for unmounted components with pending passive unmounts', async () => {
      let completePendingRequest = null;
      /** 作为 Component fixture 承载当前测试职责；服务于“组件卸载前后安排 state 更新，确认清理窗口不会产生过期告警”场景。 */
      function Component() {
        Scheduler.log('Component');
        const [didLoad, setDidLoad] = React.useState(false);
        React.useLayoutEffect(() => {
          Scheduler.log('layout create');
          return () => {
            Scheduler.log('layout destroy');
          };
        }, []);
        React.useEffect(() => {
          Scheduler.log('passive create');
          // 模拟带完成回调的 XHR 请求，回调会更新 state。
          completePendingRequest = () => setDidLoad(true);
          return () => {
            Scheduler.log('passive destroy');
          };
        }, []);
        return didLoad;
      }

      await act(async () => {
        ReactNoop.renderToRootWithID(<Component />, 'root', () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Component', 'layout create', 'Sync effect']);
        ReactNoop.flushPassiveEffects();
        assertLog(['passive create']);

        // 卸载组件，但暂不处理待执行的 Passive Effect 清理。
        ReactNoop.unmountRootWithID('root');
        await waitFor(['layout destroy']);

        // 模拟 XHR 完成并触发 state 更新，但不应记录告警。
        completePendingRequest();

        ReactNoop.flushPassiveEffects();
        assertLog(['passive destroy']);
      });
    });

    /**
     * Given：目标组件已进入可触发开发态保护的最小运行环境。
     * When：执行用例中的非法 Hook、参数或阶段调用。
     * Then：组件卸载前后安排 state 更新，确认清理窗口不会产生过期告警。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('does not warn about state updates for unmounted components with pending passive unmounts for alternates', async () => {
      let setParentState = null;
      const setChildStates = [];

      /** 作为父级 fixture 持有状态、Context 或子树边界；服务于“组件卸载前后安排 state 更新，确认清理窗口不会产生过期告警”场景。 */
      function Parent() {
        const [state, setState] = useState(true);
        setParentState = setState;
        Scheduler.log(`Parent ${state} render`);
        useLayoutEffect(() => {
          Scheduler.log(`Parent ${state} commit`);
        });
        if (state) {
          return (
            <>
              <Child label="one" />
              <Child label="two" />
            </>
          );
        } else {
          return null;
        }
      }

      /** 作为子级函数组件暴露 Hook 状态和提交日志；服务于“组件卸载前后安排 state 更新，确认清理窗口不会产生过期告警”场景。 */
      function Child({label}) {
        const [state, setState] = useState(0);
        useLayoutEffect(() => {
          Scheduler.log(`Child ${label} commit`);
        });
        useEffect(() => {
          setChildStates.push(setState);
          Scheduler.log(`Child ${label} passive create`);
          return () => {
            Scheduler.log(`Child ${label} passive destroy`);
          };
        }, []);
        Scheduler.log(`Child ${label} render`);
        return state;
      }

      // 为子组件安排防抖 state 更新；在本用例中很可能是无操作。
      // 下一 tick：安排卸载父组件。
      // 开始处理卸载，但不冲刷 Passive Effect。
      // 更新子组件 state。
      await act(async () => {
        ReactNoop.render(<Parent />);
        await waitFor([
          'Parent true render',
          'Child one render',
          'Child two render',
          'Child one commit',
          'Child two commit',
          'Parent true commit',
          'Child one passive create',
          'Child two passive create',
        ]);

        // 更新子组件。
        setChildStates.forEach(setChildState => setChildState(1));
        await waitFor([
          'Child one render',
          'Child two render',
          'Child one commit',
          'Child two commit',
        ]);

        // 为子组件再安排一次更新，并只处理其中一部分。
        React.startTransition(() => {
          setChildStates.forEach(setChildState => setChildState(2));
        });
        await waitFor(['Child one render']);

        // 安排卸载父组件，从而删除仍有待处理更新的子组件。
        ReactNoop.unstable_runWithPriority(ContinuousEventPriority, () => {
          setParentState(false);
        });
        await waitForPaint(['Parent false render', 'Parent false commit']);

        // 同时为子组件安排更新；这些更新应被忽略。
        setChildStates.forEach(setChildState => setChildState(2));
        await waitForAll([
          'Child one passive destroy',
          'Child two passive destroy',
        ]);
      });
    });

    /**
     * Given：目标组件已进入可触发开发态保护的最小运行环境。
     * When：执行用例中的非法 Hook、参数或阶段调用。
     * Then：组件卸载前后安排 state 更新，确认清理窗口不会产生过期告警。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('does not warn about state updates for unmounted components with no pending passive unmounts', async () => {
      let completePendingRequest = null;
      /** 作为 Component fixture 承载当前测试职责；服务于“组件卸载前后安排 state 更新，确认清理窗口不会产生过期告警”场景。 */
      function Component() {
        Scheduler.log('Component');
        const [didLoad, setDidLoad] = React.useState(false);
        React.useLayoutEffect(() => {
          Scheduler.log('layout create');
          // 模拟带完成回调的 XHR 请求，回调会更新 state。
          completePendingRequest = () => setDidLoad(true);
          return () => {
            Scheduler.log('layout destroy');
          };
        }, []);
        return didLoad;
      }

      await act(async () => {
        ReactNoop.renderToRootWithID(<Component />, 'root', () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Component', 'layout create', 'Sync effect']);

        // 卸载组件，但暂不处理待执行的 Passive Effect 清理。
        ReactNoop.unmountRootWithID('root');
        await waitFor(['layout destroy']);

        // 模拟 XHR 完成。
        completePendingRequest();
      });
    });

    /**
     * Given：目标组件已进入可触发开发态保护的最小运行环境。
     * When：执行用例中的非法 Hook、参数或阶段调用。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('does not warn if there are pending passive unmount effects but not for the current fiber', async () => {
      let completePendingRequest = null;
      /** 作为 ComponentWithXHR fixture 承载当前测试职责；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function ComponentWithXHR() {
        Scheduler.log('Component');
        const [didLoad, setDidLoad] = React.useState(false);
        React.useLayoutEffect(() => {
          Scheduler.log('a:layout create');
          return () => {
            Scheduler.log('a:layout destroy');
          };
        }, []);
        React.useEffect(() => {
          Scheduler.log('a:passive create');
          // 模拟带完成回调的 XHR 请求，回调会更新 state。
          completePendingRequest = () => setDidLoad(true);
        }, []);
        return didLoad;
      }

      /** 作为 ComponentWithPendingPassiveUnmount fixture 承载当前测试职责；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function ComponentWithPendingPassiveUnmount() {
        React.useEffect(() => {
          Scheduler.log('b:passive create');
          return () => {
            Scheduler.log('b:passive destroy');
          };
        }, []);
        return null;
      }

      await act(async () => {
        ReactNoop.renderToRootWithID(
          <>
            <ComponentWithXHR />
            <ComponentWithPendingPassiveUnmount />
          </>,
          'root',
          () => Scheduler.log('Sync effect'),
        );
        await waitFor(['Component', 'a:layout create', 'Sync effect']);
        ReactNoop.flushPassiveEffects();
        assertLog(['a:passive create', 'b:passive create']);

        // 卸载组件，但暂不处理待执行的 Passive Effect 清理。
        ReactNoop.unmountRootWithID('root');
        await waitFor(['a:layout destroy']);

        // 在没有待处理 Passive Effect 的组件中模拟 XHR 完成。
        completePendingRequest();
      });
    });

    /**
     * Given：目标组件已进入可触发开发态保护的最小运行环境。
     * When：执行用例中的非法 Hook、参数或阶段调用。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('does not warn if there are updates after pending passive unmount effects have been flushed', async () => {
      let updaterFunction;

      /** 作为 Component fixture 承载当前测试职责；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function Component() {
        Scheduler.log('Component');
        const [state, setState] = React.useState(false);
        updaterFunction = setState;
        React.useEffect(() => {
          Scheduler.log('passive create');
          return () => {
            Scheduler.log('passive destroy');
          };
        }, []);
        return state;
      }

      await act(() => {
        ReactNoop.renderToRootWithID(<Component />, 'root', () =>
          Scheduler.log('Sync effect'),
        );
      });
      assertLog(['Component', 'Sync effect', 'passive create']);

      ReactNoop.unmountRootWithID('root');
      await waitForAll(['passive destroy']);

      await act(() => {
        updaterFunction(true);
      });
    });

    /**
     * Given：目标组件已进入可触发开发态保护的最小运行环境。
     * When：执行用例中的非法 Hook、参数或阶段调用。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('does not show a warning when a component updates its own state from within passive unmount function', async () => {
      /** 作为 Component fixture 承载当前测试职责；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function Component() {
        Scheduler.log('Component');
        const [didLoad, setDidLoad] = React.useState(false);
        React.useEffect(() => {
          Scheduler.log('passive create');
          return () => {
            setDidLoad(true);
            Scheduler.log('passive destroy');
          };
        }, []);
        return didLoad;
      }

      await act(async () => {
        ReactNoop.renderToRootWithID(<Component />, 'root', () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Component', 'Sync effect', 'passive create']);

        // 卸载组件，但暂不处理待执行的 Passive Effect 清理。
        ReactNoop.unmountRootWithID('root');
        await waitForAll(['passive destroy']);
      });
    });

    /**
     * Given：目标组件已进入可触发开发态保护的最小运行环境。
     * When：执行用例中的非法 Hook、参数或阶段调用。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('does not show a warning when a component updates a child state from within passive unmount function', async () => {
      /** 作为父级 fixture 持有状态、Context 或子树边界；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function Parent() {
        Scheduler.log('Parent');
        const updaterRef = useRef(null);
        React.useEffect(() => {
          Scheduler.log('Parent passive create');
          return () => {
            updaterRef.current(true);
            Scheduler.log('Parent passive destroy');
          };
        }, []);
        return <Child updaterRef={updaterRef} />;
      }

      /** 作为子级函数组件暴露 Hook 状态和提交日志；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function Child({updaterRef}) {
        Scheduler.log('Child');
        const [state, setState] = React.useState(false);
        React.useEffect(() => {
          Scheduler.log('Child passive create');
          updaterRef.current = setState;
        }, []);
        return state;
      }

      await act(async () => {
        ReactNoop.renderToRootWithID(<Parent />, 'root');
        await waitFor([
          'Parent',
          'Child',
          'Child passive create',
          'Parent passive create',
        ]);

        // 卸载组件，但暂不处理待执行的 Passive Effect 清理。
        ReactNoop.unmountRootWithID('root');
        await waitForAll(['Parent passive destroy']);
      });
    });

    /**
     * Given：目标组件已进入可触发开发态保护的最小运行环境。
     * When：执行用例中的非法 Hook、参数或阶段调用。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('does not show a warning when a component updates a parents state from within passive unmount function', async () => {
      /** 作为父级 fixture 持有状态、Context 或子树边界；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function Parent() {
        const [state, setState] = React.useState(false);
        Scheduler.log('Parent');
        return <Child setState={setState} state={state} />;
      }

      /** 作为子级函数组件暴露 Hook 状态和提交日志；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function Child({setState, state}) {
        Scheduler.log('Child');
        React.useEffect(() => {
          Scheduler.log('Child passive create');
          return () => {
            Scheduler.log('Child passive destroy');
            setState(true);
          };
        }, []);
        return state;
      }

      await act(async () => {
        ReactNoop.renderToRootWithID(<Parent />, 'root');
        await waitFor(['Parent', 'Child', 'Child passive create']);

        // 卸载组件，但暂不处理待执行的 Passive Effect 清理。
        ReactNoop.unmountRootWithID('root');
        await waitForAll(['Child passive destroy']);
      });
    });

    /**
     * Given：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果所需的初始状态、更新入口与观测日志均已建立。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`renderWithHooks()` 与当前 Hook 的 mount/update dispatcher。
     */
    it('updates have async priority', async () => {
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果”场景。 */
      function Counter(props) {
        const [count, updateCount] = useState('(empty)');
        useEffect(() => {
          Scheduler.log(`Schedule update [${props.count}]`);
          updateCount(props.count);
        }, [props.count]);
        return <Text text={'Count: ' + count} />;
      }
      await act(async () => {
        ReactNoop.render(<Counter count={0} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Count: (empty)', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: (empty)" />);
        ReactNoop.flushPassiveEffects();
        assertLog(['Schedule update [0]']);
        await waitForAll(['Count: 0']);
      });

      await act(async () => {
        ReactNoop.render(<Counter count={1} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Count: 0', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);
        ReactNoop.flushPassiveEffects();
        assertLog(['Schedule update [1]']);
        await waitForAll(['Count: 1']);
      });
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：宿主输出断言确认实际提交结果。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('updates have async priority even if effects are flushed early', async () => {
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function Counter(props) {
        const [count, updateCount] = useState('(empty)');
        useEffect(() => {
          Scheduler.log(`Schedule update [${props.count}]`);
          updateCount(props.count);
        }, [props.count]);
        return <Text text={'Count: ' + count} />;
      }
      await act(async () => {
        ReactNoop.render(<Counter count={0} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Count: (empty)', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: (empty)" />);

        // 再次渲染应先冲刷前一次提交的 Effect。
        React.startTransition(() => {
          ReactNoop.render(<Counter count={1} />, () =>
            Scheduler.log('Sync effect'),
          );
        });

        await waitFor(['Schedule update [0]', 'Count: 0']);

        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);
        await waitFor([
          'Count: 0',
          'Sync effect',
          'Schedule update [1]',
          'Count: 1',
        ]);

        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 1" />);
      });
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('does not flush non-discrete passive effects when flushing sync', async () => {
      let _updateCount;
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function Counter(props) {
        const [count, updateCount] = useState(0);
        _updateCount = updateCount;
        useEffect(() => {
          Scheduler.log(`Will set count to 1`);
          updateCount(1);
        }, []);
        return <Text text={'Count: ' + count} />;
      }

      ReactNoop.render(<Counter count={0} />, () =>
        Scheduler.log('Sync effect'),
      );
      await waitFor(['Count: 0', 'Sync effect']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);
      // 同步冲刷不会执行 Passive Effect，因此另一项更新尚未加入。
      await act(() => {
        ReactNoop.flushSync(() => {
          _updateCount(2);
        });
      });

      // 因此两项工作会以相反顺序提交。非离散工作本就不保证顺序，其中一项稍晚发生也会产生同样结果，所以这是允许的。
      assertLog(['Will set count to 1', 'Count: 1']);

      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 1" />);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    // @gate !disableLegacyMode
    it(
      'in legacy mode, useEffect is deferred and updates finish synchronously ' +
        '(in a single batch)',
      async () => {
        /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
        function Counter(props) {
          const [count, updateCount] = useState('(empty)');
          useEffect(() => {
            // 连续更新多次；它们应合并到一次渲染中。
            updateCount(props.count);
            updateCount(props.count);
            updateCount(props.count);
            updateCount(props.count);
            updateCount(props.count);
            updateCount(props.count);
          }, [props.count]);
          return <Text text={'Count: ' + count} />;
        }
        await act(() => {
          ReactNoop.flushSync(() => {
            ReactNoop.renderLegacySyncRoot(<Counter count={0} />);
          });

          // 即使在 legacy 模式，Effect 也延迟到绘制后执行。
          assertLog(['Count: (empty)']);
          expect(ReactNoop).toMatchRenderedOutput(
            <span prop="Count: (empty)" />,
          );
        });

        // 退出 `act()` 时会强制冲刷 Effect。
        // 虽然安排了多次更新，但只应发生一次渲染。
        assertLog(['Count: 0']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);
      },
    );

    /**
     * Given：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果所需的初始状态、更新入口与观测日志均已建立。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果，开发态控制台断言限定诊断内容与去重。
     * 对应源码：`renderWithHooks()` 与当前 Hook 的 mount/update dispatcher。
     */
    it('flushSync is not allowed', async () => {
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果”场景。 */
      function Counter(props) {
        const [count, updateCount] = useState('(empty)');
        useEffect(() => {
          Scheduler.log(`Schedule update [${props.count}]`);
          ReactNoop.flushSync(() => {
            updateCount(props.count);
          });
          assertLog([`Schedule update [${props.count}]`]);
          assertConsoleErrorDev([
            'flushSync was called from inside a lifecycle method. ' +
              'React cannot flush when React is already rendering. ' +
              'Consider moving this call to a scheduler task or micro task.\n' +
              '    in Counter (at **)',
          ]);
          // 这里不应同步冲刷。
          expect(ReactNoop).not.toMatchRenderedOutput(
            <span prop={`Count: ${props.count}`} />,
          );
        }, [props.count]);
        return <Text text={'Count: ' + count} />;
      }
      await act(async () => {
        ReactNoop.render(<Counter count={0} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Count: (empty)', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: (empty)" />);
      });

      assertLog([`Count: 0`]);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：删除目标子树并冲刷对应提交阶段。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('unmounts previous effect', async () => {
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function Counter(props) {
        useEffect(() => {
          Scheduler.log(`Did create [${props.count}]`);
          return () => {
            Scheduler.log(`Did destroy [${props.count}]`);
          };
        });
        return <Text text={'Count: ' + props.count} />;
      }
      await act(async () => {
        ReactNoop.render(<Counter count={0} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Count: 0', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);
      });

      assertLog(['Did create [0]']);

      await act(async () => {
        ReactNoop.render(<Counter count={1} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Count: 1', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 1" />);
      });

      assertLog(['Did destroy [0]', 'Did create [1]']);
    });

    /**
     * Given：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序所需的初始状态、更新入口与观测日志均已建立。
     * When：删除目标子树并冲刷对应提交阶段。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('unmounts on deletion', async () => {
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function Counter(props) {
        useEffect(() => {
          Scheduler.log(`Did create [${props.count}]`);
          return () => {
            Scheduler.log(`Did destroy [${props.count}]`);
          };
        });
        return <Text text={'Count: ' + props.count} />;
      }
      await act(async () => {
        ReactNoop.render(<Counter count={0} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Count: 0', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);
      });

      assertLog(['Did create [0]']);

      ReactNoop.render(null);
      await waitForAll(['Did destroy [0]']);
      expect(ReactNoop).toMatchRenderedOutput(null);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：删除目标子树并冲刷对应提交阶段。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('unmounts on deletion after skipped effect', async () => {
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function Counter(props) {
        useEffect(() => {
          Scheduler.log(`Did create [${props.count}]`);
          return () => {
            Scheduler.log(`Did destroy [${props.count}]`);
          };
        }, []);
        return <Text text={'Count: ' + props.count} />;
      }
      await act(async () => {
        ReactNoop.render(<Counter count={0} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Count: 0', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);
      });

      assertLog(['Did create [0]']);

      await act(async () => {
        ReactNoop.render(<Counter count={1} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Count: 1', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 1" />);
      });

      assertLog([]);

      ReactNoop.render(null);
      await waitForAll(['Did destroy [0]']);
      expect(ReactNoop).toMatchRenderedOutput(null);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('always fires effects if no dependencies are provided', async () => {
      /** 作为 effect fixture 承载当前测试职责；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function effect() {
        Scheduler.log(`Did create`);
        return () => {
          Scheduler.log(`Did destroy`);
        };
      }
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function Counter(props) {
        useEffect(effect);
        return <Text text={'Count: ' + props.count} />;
      }
      await act(async () => {
        ReactNoop.render(<Counter count={0} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Count: 0', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);
      });

      assertLog(['Did create']);

      await act(async () => {
        ReactNoop.render(<Counter count={1} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Count: 1', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 1" />);
      });

      assertLog(['Did destroy', 'Did create']);

      ReactNoop.render(null);
      await waitForAll(['Did destroy']);
      expect(ReactNoop).toMatchRenderedOutput(null);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('skips effect if inputs have not changed', async () => {
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function Counter(props) {
        const text = `${props.label}: ${props.count}`;
        useEffect(() => {
          Scheduler.log(`Did create [${text}]`);
          return () => {
            Scheduler.log(`Did destroy [${text}]`);
          };
        }, [props.label, props.count]);
        return <Text text={text} />;
      }
      await act(async () => {
        ReactNoop.render(<Counter label="Count" count={0} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Count: 0', 'Sync effect']);
      });

      assertLog(['Did create [Count: 0]']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);

      await act(async () => {
        ReactNoop.render(<Counter label="Count" count={1} />, () =>
          Scheduler.log('Sync effect'),
        );
        // 计数发生变化。
        await waitFor(['Count: 1', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 1" />);
      });

      assertLog(['Did destroy [Count: 0]', 'Did create [Count: 1]']);

      await act(async () => {
        ReactNoop.render(<Counter label="Count" count={1} />, () =>
          Scheduler.log('Sync effect'),
        );
        // 依赖均未变化，因此不应执行 Effect。
        await waitFor(['Count: 1', 'Sync effect']);
      });

      assertLog([]);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 1" />);

      await act(async () => {
        ReactNoop.render(<Counter label="Total" count={1} />, () =>
          Scheduler.log('Sync effect'),
        );
        // label 发生变化。
        await waitFor(['Total: 1', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Total: 1" />);
      });

      assertLog(['Did destroy [Count: 1]', 'Did create [Total: 1]']);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('multiple effects', async () => {
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function Counter(props) {
        useEffect(() => {
          Scheduler.log(`Did commit 1 [${props.count}]`);
        });
        useEffect(() => {
          Scheduler.log(`Did commit 2 [${props.count}]`);
        });
        return <Text text={'Count: ' + props.count} />;
      }
      await act(async () => {
        ReactNoop.render(<Counter count={0} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Count: 0', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);
      });

      assertLog(['Did commit 1 [0]', 'Did commit 2 [0]']);

      await act(async () => {
        ReactNoop.render(<Counter count={1} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Count: 1', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 1" />);
      });
      assertLog(['Did commit 1 [1]', 'Did commit 2 [1]']);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：删除目标子树并冲刷对应提交阶段。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('unmounts all previous effects before creating any new ones', async () => {
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function Counter(props) {
        useEffect(() => {
          Scheduler.log(`Mount A [${props.count}]`);
          return () => {
            Scheduler.log(`Unmount A [${props.count}]`);
          };
        });
        useEffect(() => {
          Scheduler.log(`Mount B [${props.count}]`);
          return () => {
            Scheduler.log(`Unmount B [${props.count}]`);
          };
        });
        return <Text text={'Count: ' + props.count} />;
      }
      await act(async () => {
        ReactNoop.render(<Counter count={0} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Count: 0', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);
      });

      assertLog(['Mount A [0]', 'Mount B [0]']);

      await act(async () => {
        ReactNoop.render(<Counter count={1} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Count: 1', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 1" />);
      });
      assertLog([
        'Unmount A [0]',
        'Unmount B [0]',
        'Mount A [1]',
        'Mount B [1]',
      ]);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：删除目标子树并冲刷对应提交阶段。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('unmounts all previous effects between siblings before creating any new ones', async () => {
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function Counter({count, label}) {
        useEffect(() => {
          Scheduler.log(`Mount ${label} [${count}]`);
          return () => {
            Scheduler.log(`Unmount ${label} [${count}]`);
          };
        });
        return <Text text={`${label} ${count}`} />;
      }
      await act(async () => {
        ReactNoop.render(
          <>
            <Counter label="A" count={0} />
            <Counter label="B" count={0} />
          </>,
          () => Scheduler.log('Sync effect'),
        );
        await waitFor(['A 0', 'B 0', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="A 0" />
            <span prop="B 0" />
          </>,
        );
      });

      assertLog(['Mount A [0]', 'Mount B [0]']);

      await act(async () => {
        ReactNoop.render(
          <>
            <Counter label="A" count={1} />
            <Counter label="B" count={1} />
          </>,
          () => Scheduler.log('Sync effect'),
        );
        await waitFor(['A 1', 'B 1', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="A 1" />
            <span prop="B 1" />
          </>,
        );
      });
      assertLog([
        'Unmount A [0]',
        'Unmount B [0]',
        'Mount A [1]',
        'Mount B [1]',
      ]);

      await act(async () => {
        ReactNoop.render(
          <>
            <Counter label="B" count={2} />
            <Counter label="C" count={0} />
          </>,
          () => Scheduler.log('Sync effect'),
        );
        await waitFor(['B 2', 'C 0', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="B 2" />
            <span prop="C 0" />
          </>,
        );
      });
      assertLog([
        'Unmount A [1]',
        'Unmount B [1]',
        'Mount B [2]',
        'Mount C [0]',
      ]);
    });

    /**
     * Given：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果所需的初始状态、更新入口与观测日志均已建立。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果，异常断言保留原始错误与阶段边界。
     * 对应源码：`renderWithHooks()` 与当前 Hook 的 mount/update dispatcher。
     */
    it('handles errors in create on mount', async () => {
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果”场景。 */
      function Counter(props) {
        useEffect(() => {
          Scheduler.log(`Mount A [${props.count}]`);
          return () => {
            Scheduler.log(`Unmount A [${props.count}]`);
          };
        });
        useEffect(() => {
          Scheduler.log('Oops!');
          throw new Error('Oops!');
          // eslint-disable-next-line no-unreachable
          Scheduler.log(`Mount B [${props.count}]`);
          return () => {
            Scheduler.log(`Unmount B [${props.count}]`);
          };
        });
        return <Text text={'Count: ' + props.count} />;
      }
      await expect(async () => {
        await act(async () => {
          ReactNoop.render(<Counter count={0} />, () =>
            Scheduler.log('Sync effect'),
          );
          await waitFor(['Count: 0', 'Sync effect']);
          expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);
        });
      }).rejects.toThrow('Oops');

      assertLog([
        'Mount A [0]',
        'Oops!',
        // 清理 Effect A；Effect B 从未挂载，因此没有对应清理。
        'Unmount A [0]',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(null);
    });

    /**
     * Given：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果所需的初始状态、更新入口与观测日志均已建立。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果，异常断言保留原始错误与阶段边界。
     * 对应源码：`renderWithHooks()` 与当前 Hook 的 mount/update dispatcher。
     */
    it('handles errors in create on update', async () => {
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果”场景。 */
      function Counter(props) {
        useEffect(() => {
          Scheduler.log(`Mount A [${props.count}]`);
          return () => {
            Scheduler.log(`Unmount A [${props.count}]`);
          };
        });
        useEffect(() => {
          if (props.count === 1) {
            Scheduler.log('Oops!');
            throw new Error('Oops error!');
          }
          Scheduler.log(`Mount B [${props.count}]`);
          return () => {
            Scheduler.log(`Unmount B [${props.count}]`);
          };
        });
        return <Text text={'Count: ' + props.count} />;
      }
      await act(async () => {
        ReactNoop.render(<Counter count={0} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Count: 0', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);
        ReactNoop.flushPassiveEffects();
        assertLog(['Mount A [0]', 'Mount B [0]']);
      });

      await expect(async () => {
        await act(async () => {
          // 该更新会触发错误。
          ReactNoop.render(<Counter count={1} />, () =>
            Scheduler.log('Sync effect'),
          );
          await waitFor(['Count: 1', 'Sync effect']);
          expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 1" />);
          ReactNoop.flushPassiveEffects();
          assertLog([
            'Unmount A [0]',
            'Unmount B [0]',
            'Mount A [1]',
            'Oops!',
            // 卸载时被动执行 Effect A 的清理；Effect B 从未挂载，因此无需清理。
            'Unmount A [1]',
          ]);
          expect(ReactNoop).toMatchRenderedOutput(null);
        });
      }).rejects.toThrow('Oops error!');
    });

    /**
     * Given：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果所需的初始状态、更新入口与观测日志均已建立。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果，异常断言保留原始错误与阶段边界。
     * 对应源码：`renderWithHooks()` 与当前 Hook 的 mount/update dispatcher。
     */
    it('handles errors in destroy on update', async () => {
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果”场景。 */
      function Counter(props) {
        useEffect(() => {
          Scheduler.log(`Mount A [${props.count}]`);
          return () => {
            Scheduler.log('Oops!');
            if (props.count === 0) {
              throw new Error('Oops error!');
            }
          };
        });
        useEffect(() => {
          Scheduler.log(`Mount B [${props.count}]`);
          return () => {
            Scheduler.log(`Unmount B [${props.count}]`);
          };
        });
        return <Text text={'Count: ' + props.count} />;
      }

      await act(async () => {
        ReactNoop.render(<Counter count={0} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Count: 0', 'Sync effect']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);
        ReactNoop.flushPassiveEffects();
        assertLog(['Mount A [0]', 'Mount B [0]']);
      });

      await expect(async () => {
        await act(async () => {
          // 该更新会在 Passive Effect 卸载期间触发错误。
          ReactNoop.render(<Counter count={1} />, () =>
            Scheduler.log('Sync effect'),
          );
          await waitFor(['Count: 1', 'Sync effect']);
          expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 1" />);
          ReactNoop.flushPassiveEffects();

          // 该分支启用两阶段冲刷开关：先独立执行全部 Passive 清理，再执行任何 Passive 创建；因此卸载清理抛错不会阻止后续创建函数运行。
          assertLog([
            'Oops!',
            'Unmount B [0]',
            'Mount A [1]',
            'Mount B [1]',
            // 上方抛错导致 `<Counter>` 卸载；其余 Passive 清理稍后在卸载阶段执行，其中一个会因本用例构造再次抛错。
            'Oops!',
            'Unmount B [1]',
          ]);
        });
      }).rejects.toThrow('Oops error!');

      expect(ReactNoop).toMatchRenderedOutput(null);
    });

    /**
     * Given：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果所需的初始状态、更新入口与观测日志均已建立。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果。
     *
     * 验证机制：宿主输出断言确认实际提交结果。
     * 对应源码：`updateMemo()`、`updateCallback()` 与 `areHookInputsEqual()`。
     */
    it('works with memo', async () => {
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果”场景。 */
      function Counter({count}) {
        useLayoutEffect(() => {
          Scheduler.log('Mount: ' + count);
          return () => Scheduler.log('Unmount: ' + count);
        });
        return <Text text={'Count: ' + count} />;
      }
      Counter = memo(Counter);

      ReactNoop.render(<Counter count={0} />, () =>
        Scheduler.log('Sync effect'),
      );
      await waitFor(['Count: 0', 'Mount: 0', 'Sync effect']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);

      ReactNoop.render(<Counter count={1} />, () =>
        Scheduler.log('Sync effect'),
      );
      await waitFor(['Count: 1', 'Unmount: 0', 'Mount: 1', 'Sync effect']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 1" />);

      ReactNoop.render(null);
      await waitFor(['Unmount: 1']);
      expect(ReactNoop).toMatchRenderedOutput(null);
    });

    /** 通过 Noop 渲染器验证 Hooks 状态队列、Effect 提交顺序、并发中断与历史回归。 */
    describe('errors thrown in passive destroy function within unmounted trees', () => {
      let BrokenUseEffectCleanup;
      let ErrorBoundary;
      let LogOnlyErrorBoundary;

      /** 每个用例重置模块与警告状态，并重新绑定 React、Noop 渲染器、调度日志及内部断言工具。 */
      beforeEach(() => {
        BrokenUseEffectCleanup = function () {
          useEffect(() => {
            Scheduler.log('BrokenUseEffectCleanup useEffect');
            return () => {
              Scheduler.log('BrokenUseEffectCleanup useEffect destroy');
              throw new Error('Expected error');
            };
          }, []);

          return 'inner child';
        };

        ErrorBoundary = class extends React.Component {
          /** 保存 state 的实例状态，作为错误恢复或生命周期断言的跨提交标记。 */
          state = {error: null};
          /** getDerivedStateFromError 把捕获错误转换为稳定的边界回退状态。 */
          static getDerivedStateFromError(error) {
            Scheduler.log(`ErrorBoundary static getDerivedStateFromError`);
            return {error};
          }
          /** componentDidCatch 接收已提交错误；fixture 仅用其证明最近仍挂载边界被选中。 */
          componentDidCatch(error, info) {
            Scheduler.log(`ErrorBoundary componentDidCatch`);
          }
          /** 渲染 render 对应的类 fixture，并把本轮状态或子树交给宿主输出断言。 */
          render() {
            if (this.state.error) {
              Scheduler.log('ErrorBoundary render error');
              return <span prop="ErrorBoundary fallback" />;
            }
            Scheduler.log('ErrorBoundary render success');
            return this.props.children || null;
          }
        };

        LogOnlyErrorBoundary = class extends React.Component {
          /** componentDidCatch 接收已提交错误；fixture 仅用其证明最近仍挂载边界被选中。 */
          componentDidCatch(error, info) {
            Scheduler.log(`LogOnlyErrorBoundary componentDidCatch`);
          }
          /** 渲染 render 对应的类 fixture，并把本轮状态或子树交给宿主输出断言。 */
          render() {
            Scheduler.log(`LogOnlyErrorBoundary render`);
            return this.props.children || null;
          }
        };
      });

      /**
       * Given：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序所需的初始状态、更新入口与观测日志均已建立。
       * When：删除目标子树并冲刷对应提交阶段。
       * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
       *
       * 验证机制：调度日志精确约束执行次数与先后顺序。
       * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
       */
      it('should use the nearest still-mounted boundary if there are no unmounted boundaries', async () => {
        await act(() => {
          ReactNoop.render(
            <LogOnlyErrorBoundary>
              <BrokenUseEffectCleanup />
            </LogOnlyErrorBoundary>,
          );
        });

        assertLog([
          'LogOnlyErrorBoundary render',
          'BrokenUseEffectCleanup useEffect',
        ]);

        await act(() => {
          ReactNoop.render(<LogOnlyErrorBoundary />);
        });

        assertLog([
          'LogOnlyErrorBoundary render',
          'BrokenUseEffectCleanup useEffect destroy',
          'LogOnlyErrorBoundary componentDidCatch',
        ]);
      });

      /**
       * Given：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序所需的初始状态、更新入口与观测日志均已建立。
       * When：删除目标子树并冲刷对应提交阶段。
       * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
       *
       * 验证机制：调度日志精确约束执行次数与先后顺序。
       * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
       */
      it('should skip unmounted boundaries and use the nearest still-mounted boundary', async () => {
        /** 作为 Conditional fixture 承载当前测试职责；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
        function Conditional({showChildren}) {
          if (showChildren) {
            return (
              <ErrorBoundary>
                <BrokenUseEffectCleanup />
              </ErrorBoundary>
            );
          } else {
            return null;
          }
        }

        await act(() => {
          ReactNoop.render(
            <LogOnlyErrorBoundary>
              <Conditional showChildren={true} />
            </LogOnlyErrorBoundary>,
          );
        });

        assertLog([
          'LogOnlyErrorBoundary render',
          'ErrorBoundary render success',
          'BrokenUseEffectCleanup useEffect',
        ]);

        await act(() => {
          ReactNoop.render(
            <LogOnlyErrorBoundary>
              <Conditional showChildren={false} />
            </LogOnlyErrorBoundary>,
          );
        });

        assertLog([
          'LogOnlyErrorBoundary render',
          'BrokenUseEffectCleanup useEffect destroy',
          'LogOnlyErrorBoundary componentDidCatch',
        ]);
      });

      /**
       * Given：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果所需的初始状态、更新入口与观测日志均已建立。
       * When：安排用例指定的状态、属性、Context 或依赖更新。
       * Then：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果。
       *
       * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
       * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `renderWithHooksAgain()`。
       */
      it('should call getDerivedStateFromError in the nearest still-mounted boundary', async () => {
        /** 作为 Conditional fixture 承载当前测试职责；服务于“执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果”场景。 */
        function Conditional({showChildren}) {
          if (showChildren) {
            return <BrokenUseEffectCleanup />;
          } else {
            return null;
          }
        }

        await act(() => {
          ReactNoop.render(
            <ErrorBoundary>
              <Conditional showChildren={true} />
            </ErrorBoundary>,
          );
        });

        assertLog([
          'ErrorBoundary render success',
          'BrokenUseEffectCleanup useEffect',
        ]);

        await act(() => {
          ReactNoop.render(
            <ErrorBoundary>
              <Conditional showChildren={false} />
            </ErrorBoundary>,
          );
        });

        assertLog([
          'ErrorBoundary render success',
          'BrokenUseEffectCleanup useEffect destroy',
          'ErrorBoundary static getDerivedStateFromError',
          'ErrorBoundary render error',
          'ErrorBoundary componentDidCatch',
        ]);

        expect(ReactNoop).toMatchRenderedOutput(
          <span prop="ErrorBoundary fallback" />,
        );
      });

      /**
       * Given：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果所需的初始状态、更新入口与观测日志均已建立。
       * When：完成挂载以及用例指定的后续渲染或提交步骤。
       * Then：执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果。
       *
       * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
       * 对应源码：`renderWithHooks()` 与当前 Hook 的 mount/update dispatcher。
       */
      it('should rethrow error if there are no still-mounted boundaries', async () => {
        /** 作为 Conditional fixture 承载当前测试职责；服务于“执行 Noop 渲染器下的 Hook 场景，并以调度日志和宿主输出验证结果”场景。 */
        function Conditional({showChildren}) {
          if (showChildren) {
            return (
              <ErrorBoundary>
                <BrokenUseEffectCleanup />
              </ErrorBoundary>
            );
          } else {
            return null;
          }
        }

        await act(() => {
          ReactNoop.render(<Conditional showChildren={true} />);
        });

        assertLog([
          'ErrorBoundary render success',
          'BrokenUseEffectCleanup useEffect',
        ]);

        await act(async () => {
          ReactNoop.render(<Conditional showChildren={false} />);
          await waitForThrow('Expected error');
        });

        assertLog(['BrokenUseEffectCleanup useEffect destroy']);

        expect(ReactNoop).toMatchRenderedOutput(null);
      });
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('calls passive effect destroy functions for memoized components', async () => {
      /** Wrapper 保存可由测试步骤调用的函数入口，跨渲染驱动当前场景。 */
      const Wrapper = ({children}) => children;
      /** 作为子级函数组件暴露 Hook 状态和提交日志；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function Child() {
        React.useEffect(() => {
          Scheduler.log('passive create');
          return () => {
            Scheduler.log('passive destroy');
          };
        }, []);
        React.useLayoutEffect(() => {
          Scheduler.log('layout create');
          return () => {
            Scheduler.log('layout destroy');
          };
        }, []);
        Scheduler.log('render');
        return null;
      }

      /** isEqual 作为 memo 比较器记录输入并决定是否跳过子树渲染。 */
      const isEqual = (prevProps, nextProps) =>
        prevProps.prop === nextProps.prop;
      const MemoizedChild = React.memo(Child, isEqual);

      await act(() => {
        ReactNoop.render(
          <Wrapper>
            <MemoizedChild key={1} />
          </Wrapper>,
        );
      });
      assertLog(['render', 'layout create', 'passive create']);

      // 至少加入一次 memo 命中的无操作更新，以触发原始缺陷。
      await act(() => {
        ReactNoop.render(
          <Wrapper>
            <MemoizedChild key={1} />
          </Wrapper>,
        );
      });
      assertLog([]);

      await act(() => {
        ReactNoop.render(
          <Wrapper>
            <MemoizedChild key={2} />
          </Wrapper>,
        );
      });
      assertLog([
        'render',
        'layout destroy',
        'layout create',
        'passive destroy',
        'passive create',
      ]);

      await act(() => {
        ReactNoop.render(null);
      });
      assertLog(['layout destroy', 'passive destroy']);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('calls passive effect destroy functions for descendants of memoized components', async () => {
      /** Wrapper 保存可由测试步骤调用的函数入口，跨渲染驱动当前场景。 */
      const Wrapper = ({children}) => children;
      /** 作为子级函数组件暴露 Hook 状态和提交日志；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function Child() {
        return <Grandchild />;
      }

      /** 作为 Grandchild fixture 承载当前测试职责；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function Grandchild() {
        React.useEffect(() => {
          Scheduler.log('passive create');
          return () => {
            Scheduler.log('passive destroy');
          };
        }, []);
        React.useLayoutEffect(() => {
          Scheduler.log('layout create');
          return () => {
            Scheduler.log('layout destroy');
          };
        }, []);
        Scheduler.log('render');
        return null;
      }

      /** isEqual 作为 memo 比较器记录输入并决定是否跳过子树渲染。 */
      const isEqual = (prevProps, nextProps) =>
        prevProps.prop === nextProps.prop;
      const MemoizedChild = React.memo(Child, isEqual);

      await act(() => {
        ReactNoop.render(
          <Wrapper>
            <MemoizedChild key={1} />
          </Wrapper>,
        );
      });
      assertLog(['render', 'layout create', 'passive create']);

      // 至少加入一次 memo 命中的无操作更新，以触发原始缺陷。
      await act(() => {
        ReactNoop.render(
          <Wrapper>
            <MemoizedChild key={1} />
          </Wrapper>,
        );
      });
      assertLog([]);

      await act(() => {
        ReactNoop.render(
          <Wrapper>
            <MemoizedChild key={2} />
          </Wrapper>,
        );
      });
      assertLog([
        'render',
        'layout destroy',
        'layout create',
        'passive destroy',
        'passive create',
      ]);

      await act(() => {
        ReactNoop.render(null);
      });
      assertLog(['layout destroy', 'passive destroy']);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：开发态控制台断言限定诊断内容与去重。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('assumes passive effect destroy function is either a function or undefined', async () => {
      /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function App(props) {
        useEffect(() => {
          return props.return;
        });
        return null;
      }

      const root1 = ReactNoop.createRoot();
      await act(() => {
        root1.render(<App return={17} />);
      });
      assertConsoleErrorDev([
        'useEffect must not return anything besides a function, ' +
          'which is used for clean-up. You returned: 17\n' +
          '    in App (at **)',
      ]);

      const root2 = ReactNoop.createRoot();
      await act(() => {
        root2.render(<App return={null} />);
      });
      assertConsoleErrorDev([
        'useEffect must not return anything besides a function, ' +
          'which is used for clean-up. You returned null. ' +
          'If your effect does not require clean up, return undefined (or nothing).\n' +
          '    in App (at **)',
      ]);

      const root3 = ReactNoop.createRoot();
      await act(() => {
        root3.render(<App return={Promise.resolve()} />);
      });
      assertConsoleErrorDev([
        'useEffect must not return anything besides a function, which is used for clean-up.\n' +
          '\n' +
          'It looks like you wrote useEffect(async () => ...) or returned a Promise. ' +
          'Instead, write the async function inside your effect and call it immediately:\n' +
          '\n' +
          'useEffect(() => {\n' +
          '  async function fetchData() {\n' +
          '    // You can await here\n' +
          '    const response = await MyAPI.getData(someId);\n' +
          '    // ...\n' +
          '  }\n' +
          '  fetchData();\n' +
          "}, [someId]); // Or [] if effect doesn't need props or state\n" +
          '\n' +
          'Learn more about data fetching with Hooks: https://react.dev/link/hooks-data-fetching\n' +
          '    in App (at **)',
      ]);

      // 卸载时报错，因为 React 按协议把该值视为函数。
      await act(async () => {
        root3.render(null);
        await waitForThrow('is not a function');
      });
    });
  });

  /** 通过 Noop 渲染器验证 Hooks 状态队列、Effect 提交顺序、并发中断与历史回归。 */
  describe('useInsertionEffect', () => {
    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：提交 Insertion Effect 与其他阶段交错的树，确认清理、创建及更新限制。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`commitHookEffectListMount()` 与 Insertion Effect 提交路径。
     */
    it('fires insertion effects after snapshots on update', async () => {
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“提交 Insertion Effect 与其他阶段交错的树，确认清理、创建及更新限制”场景。 */
      function CounterA(props) {
        useInsertionEffect(() => {
          Scheduler.log(`Create insertion`);
          return () => {
            Scheduler.log(`Destroy insertion`);
          };
        });
        return null;
      }

      /** 定义 CounterB 类 fixture，在“提交 Insertion Effect 与其他阶段交错的树，确认清理、创建及更新限制”场景中暴露类生命周期、实例 ref 或错误边界。 */
      class CounterB extends React.Component {
        /** CounterB.getSnapshotBeforeUpdate 在宿主突变前记录快照，用于与 Insertion/Layout Effect 排序比较。 */
        getSnapshotBeforeUpdate(prevProps, prevState) {
          Scheduler.log(`Get Snapshot`);
          return null;
        }

        /** CounterB.componentDidUpdate 记录更新提交及前后状态，区分更新生命周期与挂载重放。 */
        componentDidUpdate() {}

        /** 渲染 CounterB.render 对应的类 fixture，并把本轮状态或子树交给宿主输出断言。 */
        render() {
          return null;
        }
      }

      await act(async () => {
        ReactNoop.render(
          <>
            <CounterA />
            <CounterB />
          </>,
        );

        await waitForAll(['Create insertion']);
      });

      // 执行更新。
      await act(async () => {
        ReactNoop.render(
          <>
            <CounterA />
            <CounterB />
          </>,
        );

        await waitForAll([
          'Get Snapshot',
          'Destroy insertion',
          'Create insertion',
        ]);
      });

      // 卸载全部内容。
      await act(async () => {
        ReactNoop.render(null);

        await waitForAll(['Destroy insertion']);
      });
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：提交 Insertion Effect 与其他阶段交错的树，确认清理、创建及更新限制。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序。
     * 对应源码：`commitHookEffectListMount()` 与 Insertion Effect 提交路径。
     */
    it('fires insertion effects before layout effects', async () => {
      let committedText = '(empty)';

      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“提交 Insertion Effect 与其他阶段交错的树，确认清理、创建及更新限制”场景。 */
      function Counter(props) {
        useInsertionEffect(() => {
          Scheduler.log(`Create insertion [current: ${committedText}]`);
          committedText = String(props.count);
          return () => {
            Scheduler.log(`Destroy insertion [current: ${committedText}]`);
          };
        });
        useLayoutEffect(() => {
          Scheduler.log(`Create layout [current: ${committedText}]`);
          return () => {
            Scheduler.log(`Destroy layout [current: ${committedText}]`);
          };
        });
        useEffect(() => {
          Scheduler.log(`Create passive [current: ${committedText}]`);
          return () => {
            Scheduler.log(`Destroy passive [current: ${committedText}]`);
          };
        });
        return null;
      }
      await act(async () => {
        ReactNoop.render(<Counter count={0} />);

        await waitForPaint([
          'Create insertion [current: (empty)]',
          'Create layout [current: 0]',
        ]);
        expect(committedText).toEqual('0');
      });

      assertLog(['Create passive [current: 0]']);

      // 卸载全部内容。
      await act(async () => {
        ReactNoop.render(null);

        await waitForPaint([
          'Destroy insertion [current: 0]',
          'Destroy layout [current: 0]',
        ]);
      });

      assertLog(['Destroy passive [current: 0]']);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：提交 Insertion Effect 与其他阶段交错的树，确认清理、创建及更新限制。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序。
     * 对应源码：`commitHookEffectListMount()` 与 Insertion Effect 提交路径。
     */
    it('force flushes passive effects before firing new insertion effects', async () => {
      let committedText = '(empty)';

      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“提交 Insertion Effect 与其他阶段交错的树，确认清理、创建及更新限制”场景。 */
      function Counter(props) {
        useInsertionEffect(() => {
          Scheduler.log(`Create insertion [current: ${committedText}]`);
          committedText = String(props.count);
          return () => {
            Scheduler.log(`Destroy insertion [current: ${committedText}]`);
          };
        });
        useLayoutEffect(() => {
          Scheduler.log(`Create layout [current: ${committedText}]`);
          committedText = String(props.count);
          return () => {
            Scheduler.log(`Destroy layout [current: ${committedText}]`);
          };
        });
        useEffect(() => {
          Scheduler.log(`Create passive [current: ${committedText}]`);
          return () => {
            Scheduler.log(`Destroy passive [current: ${committedText}]`);
          };
        });
        return null;
      }

      await act(async () => {
        React.startTransition(() => {
          ReactNoop.render(<Counter count={0} />);
        });
        await waitForPaint([
          'Create insertion [current: (empty)]',
          'Create layout [current: 0]',
        ]);
        expect(committedText).toEqual('0');

        React.startTransition(() => {
          ReactNoop.render(<Counter count={1} />);
        });
        if (gate(flags => flags.enableYieldingBeforePassive)) {
          await waitForPaint(['Create passive [current: 0]']);
          await waitForPaint([
            'Destroy insertion [current: 0]',
            'Create insertion [current: 0]',
            'Destroy layout [current: 1]',
            'Create layout [current: 1]',
          ]);
        } else {
          await waitForPaint([
            'Create passive [current: 0]',
            'Destroy insertion [current: 0]',
            'Create insertion [current: 0]',
            'Destroy layout [current: 1]',
            'Create layout [current: 1]',
          ]);
        }
        expect(committedText).toEqual('1');
      });
      assertLog([
        'Destroy passive [current: 1]',
        'Create passive [current: 1]',
      ]);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：提交 Insertion Effect 与其他阶段交错的树，确认清理、创建及更新限制。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`commitHookEffectListMount()` 与 Insertion Effect 提交路径。
     */
    it('fires all insertion effects (interleaved) before firing any layout effects', async () => {
      let committedA = '(empty)';
      let committedB = '(empty)';

      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“提交 Insertion Effect 与其他阶段交错的树，确认清理、创建及更新限制”场景。 */
      function CounterA(props) {
        useInsertionEffect(() => {
          Scheduler.log(
            `Create Insertion 1 for Component A [A: ${committedA}, B: ${committedB}]`,
          );
          committedA = String(props.count);
          return () => {
            Scheduler.log(
              `Destroy Insertion 1 for Component A [A: ${committedA}, B: ${committedB}]`,
            );
          };
        });
        useInsertionEffect(() => {
          Scheduler.log(
            `Create Insertion 2 for Component A [A: ${committedA}, B: ${committedB}]`,
          );
          committedA = String(props.count);
          return () => {
            Scheduler.log(
              `Destroy Insertion 2 for Component A [A: ${committedA}, B: ${committedB}]`,
            );
          };
        });

        useLayoutEffect(() => {
          Scheduler.log(
            `Create Layout 1 for Component A [A: ${committedA}, B: ${committedB}]`,
          );
          return () => {
            Scheduler.log(
              `Destroy Layout 1 for Component A [A: ${committedA}, B: ${committedB}]`,
            );
          };
        });

        useLayoutEffect(() => {
          Scheduler.log(
            `Create Layout 2 for Component A [A: ${committedA}, B: ${committedB}]`,
          );
          return () => {
            Scheduler.log(
              `Destroy Layout 2 for Component A [A: ${committedA}, B: ${committedB}]`,
            );
          };
        });
        return null;
      }

      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“提交 Insertion Effect 与其他阶段交错的树，确认清理、创建及更新限制”场景。 */
      function CounterB(props) {
        useInsertionEffect(() => {
          Scheduler.log(
            `Create Insertion 1 for Component B [A: ${committedA}, B: ${committedB}]`,
          );
          committedB = String(props.count);
          return () => {
            Scheduler.log(
              `Destroy Insertion 1 for Component B [A: ${committedA}, B: ${committedB}]`,
            );
          };
        });
        useInsertionEffect(() => {
          Scheduler.log(
            `Create Insertion 2 for Component B [A: ${committedA}, B: ${committedB}]`,
          );
          committedB = String(props.count);
          return () => {
            Scheduler.log(
              `Destroy Insertion 2 for Component B [A: ${committedA}, B: ${committedB}]`,
            );
          };
        });

        useLayoutEffect(() => {
          Scheduler.log(
            `Create Layout 1 for Component B [A: ${committedA}, B: ${committedB}]`,
          );
          return () => {
            Scheduler.log(
              `Destroy Layout 1 for Component B [A: ${committedA}, B: ${committedB}]`,
            );
          };
        });

        useLayoutEffect(() => {
          Scheduler.log(
            `Create Layout 2 for Component B [A: ${committedA}, B: ${committedB}]`,
          );
          return () => {
            Scheduler.log(
              `Destroy Layout 2 for Component B [A: ${committedA}, B: ${committedB}]`,
            );
          };
        });
        return null;
      }

      await act(async () => {
        ReactNoop.render(
          <React.Fragment>
            <CounterA count={0} />
            <CounterB count={0} />
          </React.Fragment>,
        );
        await waitForAll([
          // 所有 Insertion Effect 均先于任何 Layout Effect 执行。
          'Create Insertion 1 for Component A [A: (empty), B: (empty)]',
          'Create Insertion 2 for Component A [A: 0, B: (empty)]',
          'Create Insertion 1 for Component B [A: 0, B: (empty)]',
          'Create Insertion 2 for Component B [A: 0, B: 0]',
          'Create Layout 1 for Component A [A: 0, B: 0]',
          'Create Layout 2 for Component A [A: 0, B: 0]',
          'Create Layout 1 for Component B [A: 0, B: 0]',
          'Create Layout 2 for Component B [A: 0, B: 0]',
        ]);
        expect([committedA, committedB]).toEqual(['0', '0']);
      });

      await act(async () => {
        ReactNoop.render(
          <React.Fragment>
            <CounterA count={1} />
            <CounterB count={1} />
          </React.Fragment>,
        );
        await waitForAll([
          'Destroy Insertion 1 for Component A [A: 0, B: 0]',
          'Destroy Insertion 2 for Component A [A: 0, B: 0]',
          'Create Insertion 1 for Component A [A: 0, B: 0]',
          'Create Insertion 2 for Component A [A: 1, B: 0]',
          'Destroy Layout 1 for Component A [A: 1, B: 0]',
          'Destroy Layout 2 for Component A [A: 1, B: 0]',
          'Destroy Insertion 1 for Component B [A: 1, B: 0]',
          'Destroy Insertion 2 for Component B [A: 1, B: 0]',
          'Create Insertion 1 for Component B [A: 1, B: 0]',
          'Create Insertion 2 for Component B [A: 1, B: 1]',
          'Destroy Layout 1 for Component B [A: 1, B: 1]',
          'Destroy Layout 2 for Component B [A: 1, B: 1]',
          'Create Layout 1 for Component A [A: 1, B: 1]',
          'Create Layout 2 for Component A [A: 1, B: 1]',
          'Create Layout 1 for Component B [A: 1, B: 1]',
          'Create Layout 2 for Component B [A: 1, B: 1]',
        ]);
        expect([committedA, committedB]).toEqual(['1', '1']);

        // 卸载全部内容。
        await act(async () => {
          ReactNoop.render(null);

          await waitForAll([
            'Destroy Insertion 1 for Component A [A: 1, B: 1]',
            'Destroy Insertion 2 for Component A [A: 1, B: 1]',
            'Destroy Layout 1 for Component A [A: 1, B: 1]',
            'Destroy Layout 2 for Component A [A: 1, B: 1]',
            'Destroy Insertion 1 for Component B [A: 1, B: 1]',
            'Destroy Insertion 2 for Component B [A: 1, B: 1]',
            'Destroy Layout 1 for Component B [A: 1, B: 1]',
            'Destroy Layout 2 for Component B [A: 1, B: 1]',
          ]);
        });
      });
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：提交 Insertion Effect 与其他阶段交错的树，确认清理、创建及更新限制。
     *
     * 验证机制：开发态控制台断言限定诊断内容与去重。
     * 对应源码：`commitHookEffectListMount()` 与 Insertion Effect 提交路径。
     */
    it('assumes insertion effect destroy function is either a function or undefined', async () => {
      /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“提交 Insertion Effect 与其他阶段交错的树，确认清理、创建及更新限制”场景。 */
      function App(props) {
        useInsertionEffect(() => {
          return props.return;
        });
        return null;
      }

      const root1 = ReactNoop.createRoot();
      await act(() => {
        root1.render(<App return={17} />);
      });
      assertConsoleErrorDev([
        'useInsertionEffect must not return anything besides a function, ' +
          'which is used for clean-up. You returned: 17\n' +
          '    in App (at **)',
      ]);

      const root2 = ReactNoop.createRoot();
      await act(() => {
        root2.render(<App return={null} />);
      });
      assertConsoleErrorDev([
        'useInsertionEffect must not return anything besides a function, ' +
          'which is used for clean-up. You returned null. ' +
          'If your effect does not require clean up, return undefined (or nothing).\n' +
          '    in App (at **)',
      ]);

      const root3 = ReactNoop.createRoot();
      await act(() => {
        root3.render(<App return={Promise.resolve()} />);
      });
      assertConsoleErrorDev([
        'useInsertionEffect must not return anything besides a ' +
          'function, which is used for clean-up.\n' +
          '\n' +
          'It looks like you wrote useInsertionEffect(async () => ...) or returned a Promise. ' +
          'Instead, write the async function inside your effect and call it immediately:\n' +
          '\n' +
          'useInsertionEffect(() => {\n' +
          '  async function fetchData() {\n' +
          '    // You can await here\n' +
          '    const response = await MyAPI.getData(someId);\n' +
          '    // ...\n' +
          '  }\n' +
          '  fetchData();\n' +
          "}, [someId]); // Or [] if effect doesn't need props or state\n" +
          '\n' +
          'Learn more about data fetching with Hooks: https://react.dev/link/hooks-data-fetching\n' +
          '    in App (at **)',
      ]);

      // 卸载时报错，因为 React 按协议把该值视为函数。
      await act(async () => {
        root3.render(null);
        await waitForThrow('is not a function');
      });
    });

    /**
     * Given：目标组件已进入可触发开发态保护的最小运行环境。
     * When：执行用例中的非法 Hook、参数或阶段调用。
     * Then：提交 Insertion Effect 与其他阶段交错的树，确认清理、创建及更新限制。
     *
     * 验证机制：开发态控制台断言限定诊断内容与去重。
     * 对应源码：`commitHookEffectListMount()` 与 Insertion Effect 提交路径。
     */
    it('warns when setState is called from insertion effect setup', async () => {
      /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“提交 Insertion Effect 与其他阶段交错的树，确认清理、创建及更新限制”场景。 */
      function App(props) {
        const [, setX] = useState(0);
        useInsertionEffect(() => {
          setX(1);
          if (props.throw) {
            throw Error('No');
          }
        }, [props.throw]);
        return null;
      }

      const root = ReactNoop.createRoot();
      await act(() => {
        root.render(<App />);
      });
      assertConsoleErrorDev([
        'useInsertionEffect must not schedule updates.\n' +
          '    in App (at **)',
      ]);

      await act(async () => {
        root.render(<App throw={true} />);
        await waitForThrow('No');
      });

      // 抛错后执行普通 Effect 不应产生同类告警。
      /** 作为 NotInsertion fixture 承载当前测试职责；服务于“提交 Insertion Effect 与其他阶段交错的树，确认清理、创建及更新限制”场景。 */
      function NotInsertion() {
        const [, setX] = useState(0);
        useEffect(() => {
          setX(1);
        }, []);
        return null;
      }
      await act(() => {
        root.render(<NotInsertion />);
      });
    });

    /**
     * Given：目标组件已进入可触发开发态保护的最小运行环境。
     * When：执行用例中的非法 Hook、参数或阶段调用。
     * Then：提交 Insertion Effect 与其他阶段交错的树，确认清理、创建及更新限制。
     *
     * 验证机制：开发态控制台断言限定诊断内容与去重。
     * 对应源码：`commitHookEffectListMount()` 与 Insertion Effect 提交路径。
     */
    it('warns when setState is called from insertion effect cleanup', async () => {
      /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“提交 Insertion Effect 与其他阶段交错的树，确认清理、创建及更新限制”场景。 */
      function App(props) {
        const [, setX] = useState(0);
        useInsertionEffect(() => {
          if (props.throw) {
            throw Error('No');
          }
          return () => {
            setX(1);
          };
        }, [props.throw, props.foo]);
        return null;
      }

      const root = ReactNoop.createRoot();
      await act(() => {
        root.render(<App foo="hello" />);
      });
      await act(() => {
        root.render(<App foo="goodbye" />);
      });
      assertConsoleErrorDev([
        'useInsertionEffect must not schedule updates.\n' +
          '    in App (at **)',
      ]);

      await act(async () => {
        root.render(<App throw={true} />);
        await waitForThrow('No');
      });

      // 抛错后执行普通 Effect 不应产生同类告警。
      /** 作为 NotInsertion fixture 承载当前测试职责；服务于“提交 Insertion Effect 与其他阶段交错的树，确认清理、创建及更新限制”场景。 */
      function NotInsertion() {
        const [, setX] = useState(0);
        useEffect(() => {
          setX(1);
        }, []);
        return null;
      }
      await act(() => {
        root.render(<NotInsertion />);
      });
    });

    /**
     * Given：目标组件已进入可触发开发态保护的最小运行环境。
     * When：执行用例中的非法 Hook、参数或阶段调用。
     * Then：提交 Insertion Effect 与其他阶段交错的树，确认清理、创建及更新限制。
     *
     * 验证机制：开发态控制台断言限定诊断内容与去重。
     * 对应源码：`commitHookEffectListMount()` 与 Insertion Effect 提交路径。
     */
    it('warns when setState is called from offscreen deleted insertion effect cleanup', async () => {
      /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“提交 Insertion Effect 与其他阶段交错的树，确认清理、创建及更新限制”场景。 */
      function App(props) {
        const [, setX] = useState(0);
        useInsertionEffect(() => {
          if (props.throw) {
            throw Error('No');
          }
          return () => {
            setX(1);
          };
        }, [props.throw, props.foo]);
        return null;
      }

      const root = ReactNoop.createRoot();
      await act(() => {
        root.render(
          <Activity mode="hidden">
            <App foo="hello" />
          </Activity>,
        );
      });

      await act(() => {
        root.render(<Activity mode="hidden" />);
      });
      assertConsoleErrorDev([
        'useInsertionEffect must not schedule updates.\n' +
          '    in App (at **)',
      ]);

      // 抛错后执行普通 Effect 不应产生同类告警。
      /** 作为 NotInsertion fixture 承载当前测试职责；服务于“提交 Insertion Effect 与其他阶段交错的树，确认清理、创建及更新限制”场景。 */
      function NotInsertion() {
        const [, setX] = useState(0);
        useEffect(() => {
          setX(1);
        }, []);
        return null;
      }
      await act(() => {
        root.render(<NotInsertion />);
      });
    });
  });

  /** 通过 Noop 渲染器验证 Hooks 状态队列、Effect 提交顺序、并发中断与历史回归。 */
  describe('useLayoutEffect', () => {
    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：在宿主突变后执行 Layout Effect，确认阶段顺序、强制冲刷和错误边界。
     *
     * 验证机制：宿主输出断言确认实际提交结果。
     * 对应源码：`commitHookLayoutEffects()` 与 `commitHookLayoutUnmountEffects()`。
     */
    it('fires layout effects after the host has been mutated', async () => {
      /** 从已提交宿主节点读取文本，供 Effect 阶段检查突变可见性；服务于“在宿主突变后执行 Layout Effect，确认阶段顺序、强制冲刷和错误边界”场景。 */
      function getCommittedText() {
        const yields = Scheduler.unstable_clearLog();
        const children = ReactNoop.getChildrenAsJSX();
        Scheduler.log(yields);
        if (children === null) {
          return null;
        }
        return children.props.prop;
      }

      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“在宿主突变后执行 Layout Effect，确认阶段顺序、强制冲刷和错误边界”场景。 */
      function Counter(props) {
        useLayoutEffect(() => {
          Scheduler.log(`Current: ${getCommittedText()}`);
        });
        return <Text text={props.count} />;
      }

      ReactNoop.render(<Counter count={0} />, () =>
        Scheduler.log('Sync effect'),
      );
      await waitFor([[0], 'Current: 0', 'Sync effect']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop={0} />);

      ReactNoop.render(<Counter count={1} />, () =>
        Scheduler.log('Sync effect'),
      );
      await waitFor([[1], 'Current: 1', 'Sync effect']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop={1} />);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：在宿主突变后执行 Layout Effect，确认阶段顺序、强制冲刷和错误边界。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序。
     * 对应源码：`commitHookLayoutEffects()` 与 `commitHookLayoutUnmountEffects()`。
     */
    it('force flushes passive effects before firing new layout effects', async () => {
      let committedText = '(empty)';

      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“在宿主突变后执行 Layout Effect，确认阶段顺序、强制冲刷和错误边界”场景。 */
      function Counter(props) {
        useLayoutEffect(() => {
          // 通常该写入会放在 mutation Effect 中，但本用例刻意省略 mutation Effect。
          committedText = String(props.count);

          Scheduler.log(`Mount layout [current: ${committedText}]`);
          return () => {
            Scheduler.log(`Unmount layout [current: ${committedText}]`);
          };
        });
        useEffect(() => {
          Scheduler.log(`Mount normal [current: ${committedText}]`);
          return () => {
            Scheduler.log(`Unmount normal [current: ${committedText}]`);
          };
        });
        return null;
      }

      await act(async () => {
        ReactNoop.render(<Counter count={0} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Mount layout [current: 0]', 'Sync effect']);
        expect(committedText).toEqual('0');
        ReactNoop.render(<Counter count={1} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor([
          'Mount normal [current: 0]',
          'Unmount layout [current: 0]',
          'Mount layout [current: 1]',
          'Sync effect',
        ]);
        expect(committedText).toEqual('1');
      });

      assertLog(['Unmount normal [current: 1]', 'Mount normal [current: 1]']);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：在宿主突变后执行 Layout Effect，确认阶段顺序、强制冲刷和错误边界。
     *
     * 验证机制：宿主输出断言确认实际提交结果。
     * 对应源码：`commitHookLayoutEffects()` 与 `commitHookLayoutUnmountEffects()`。
     */
    it('catches errors thrown in useLayoutEffect', async () => {
      /** 定义 ErrorBoundary 类 fixture，在“在宿主突变后执行 Layout Effect，确认阶段顺序、强制冲刷和错误边界”场景中暴露类生命周期、实例 ref 或错误边界。 */
      class ErrorBoundary extends React.Component {
        /** 保存 ErrorBoundary.state 的实例状态，作为错误恢复或生命周期断言的跨提交标记。 */
        state = {error: null};
        /** ErrorBoundary.getDerivedStateFromError 把捕获错误转换为稳定的边界回退状态。 */
        static getDerivedStateFromError(error) {
          Scheduler.log(`ErrorBoundary static getDerivedStateFromError`);
          return {error};
        }
        /** 渲染 ErrorBoundary.render 对应的类 fixture，并把本轮状态或子树交给宿主输出断言。 */
        render() {
          const {children, id, fallbackID} = this.props;
          const {error} = this.state;
          if (error) {
            Scheduler.log(`${id} render error`);
            return <Component id={fallbackID} />;
          }
          Scheduler.log(`${id} render success`);
          return children || null;
        }
      }

      /** 作为 Component fixture 承载当前测试职责；服务于“在宿主突变后执行 Layout Effect，确认阶段顺序、强制冲刷和错误边界”场景。 */
      function Component({id}) {
        Scheduler.log('Component render ' + id);
        return <span prop={id} />;
      }

      /** 作为 BrokenLayoutEffectDestroy fixture 承载当前测试职责；服务于“在宿主突变后执行 Layout Effect，确认阶段顺序、强制冲刷和错误边界”场景。 */
      function BrokenLayoutEffectDestroy() {
        useLayoutEffect(() => {
          return () => {
            Scheduler.log('BrokenLayoutEffectDestroy useLayoutEffect destroy');
            throw Error('Expected');
          };
        }, []);

        Scheduler.log('BrokenLayoutEffectDestroy render');
        return <span prop="broken" />;
      }

      ReactNoop.render(
        <ErrorBoundary id="OuterBoundary" fallbackID="OuterFallback">
          <Component id="sibling" />
          <ErrorBoundary id="InnerBoundary" fallbackID="InnerFallback">
            <BrokenLayoutEffectDestroy />
          </ErrorBoundary>
        </ErrorBoundary>,
      );

      await waitForAll([
        'OuterBoundary render success',
        'Component render sibling',
        'InnerBoundary render success',
        'BrokenLayoutEffectDestroy render',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="sibling" />
          <span prop="broken" />
        </>,
      );

      ReactNoop.render(
        <ErrorBoundary id="OuterBoundary" fallbackID="OuterFallback">
          <Component id="sibling" />
        </ErrorBoundary>,
      );

      // React 应跳过正在卸载的错误边界，选择最近且仍已挂载的边界。
      await waitForAll([
        'OuterBoundary render success',
        'Component render sibling',
        'BrokenLayoutEffectDestroy useLayoutEffect destroy',
        'ErrorBoundary static getDerivedStateFromError',
        'OuterBoundary render error',
        'Component render OuterFallback',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="OuterFallback" />);
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：在宿主突变后执行 Layout Effect，确认阶段顺序、强制冲刷和错误边界。
     *
     * 验证机制：开发态控制台断言限定诊断内容与去重。
     * 对应源码：`commitHookLayoutEffects()` 与 `commitHookLayoutUnmountEffects()`。
     */
    it('assumes layout effect destroy function is either a function or undefined', async () => {
      /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“在宿主突变后执行 Layout Effect，确认阶段顺序、强制冲刷和错误边界”场景。 */
      function App(props) {
        useLayoutEffect(() => {
          return props.return;
        });
        return null;
      }

      const root1 = ReactNoop.createRoot();
      await act(() => {
        root1.render(<App return={17} />);
      });
      assertConsoleErrorDev([
        'useLayoutEffect must not return anything besides a ' +
          'function, which is used for clean-up. You returned: 17\n' +
          '    in App (at **)',
      ]);

      const root2 = ReactNoop.createRoot();
      await act(() => {
        root2.render(<App return={null} />);
      });
      assertConsoleErrorDev([
        'useLayoutEffect must not return anything besides a ' +
          'function, which is used for clean-up. You returned null. If your ' +
          'effect does not require clean up, return undefined (or nothing).\n' +
          '    in App (at **)',
      ]);

      const root3 = ReactNoop.createRoot();
      await act(() => {
        root3.render(<App return={Promise.resolve()} />);
      });
      assertConsoleErrorDev([
        'useLayoutEffect must not return anything besides a ' +
          'function, which is used for clean-up.\n\n' +
          'It looks like you wrote useLayoutEffect(async () => ...) or returned a Promise. ' +
          'Instead, write the async function inside your effect and call it immediately:\n' +
          '\n' +
          'useLayoutEffect(() => {\n' +
          '  async function fetchData() {\n' +
          '    // You can await here\n' +
          '    const response = await MyAPI.getData(someId);\n' +
          '    // ...\n' +
          '  }\n' +
          '  fetchData();\n' +
          "}, [someId]); // Or [] if effect doesn't need props or state\n" +
          '\n' +
          'Learn more about data fetching with Hooks: https://react.dev/link/hooks-data-fetching\n' +
          '    in App (at **)',
      ]);

      // 卸载时报错，因为 React 按协议把该值视为函数。
      await act(async () => {
        root3.render(null);
        await waitForThrow('is not a function');
      });
    });
  });

  /** 通过 Noop 渲染器验证 Hooks 状态队列、Effect 提交顺序、并发中断与历史回归。 */
  describe('useCallback', () => {
    /**
     * Given：改变或保持 memo 输入，确认回调与值只在依赖变化时重新计算所需的初始状态、更新入口与观测日志均已建立。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：改变或保持 memo 输入，确认回调与值只在依赖变化时重新计算。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`updateMemo()`、`updateCallback()` 与 `areHookInputsEqual()`。
     */
    it('memoizes callback by comparing inputs', async () => {
      /** 定义 IncrementButton 类 fixture，在“改变或保持 memo 输入，确认回调与值只在依赖变化时重新计算”场景中暴露类生命周期、实例 ref 或错误边界。 */
      class IncrementButton extends React.PureComponent {
        /** IncrementButton.increment 调用当前提交版本的 Effect Event，并把领域参数转交事件闭包。 */
        increment = () => {
          this.props.increment();
        };
        /** 渲染 IncrementButton.render 对应的类 fixture，并把本轮状态或子树交给宿主输出断言。 */
        render() {
          return <Text text="Increment" />;
        }
      }

      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“改变或保持 memo 输入，确认回调与值只在依赖变化时重新计算”场景。 */
      function Counter({incrementBy}) {
        const [count, updateCount] = useState(0);
        const increment = useCallback(
          () => updateCount(c => c + incrementBy),
          [incrementBy],
        );
        return (
          <>
            <IncrementButton increment={increment} ref={button} />
            <Text text={'Count: ' + count} />
          </>
        );
      }

      const button = React.createRef(null);
      ReactNoop.render(<Counter incrementBy={1} />);
      await waitForAll(['Increment', 'Count: 0']);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Increment" />
          <span prop="Count: 0" />
        </>,
      );

      await act(() => button.current.increment());
      assertLog([
        // 按钮 props 未变化，因此不应重新渲染。
        // 'Increment',
        'Count: 1',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Increment" />
          <span prop="Count: 1" />
        </>,
      );

      // 增大每次递增量。
      ReactNoop.render(<Counter incrementBy={10} />);
      await waitForAll([
        // 这次输入确实发生变化。
        'Increment',
        'Count: 1',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Increment" />
          <span prop="Count: 1" />
        </>,
      );

      // 回调应已更新。
      await act(() => button.current.increment());
      assertLog(['Count: 11']);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Increment" />
          <span prop="Count: 11" />
        </>,
      );
    });
  });

  /** 通过 Noop 渲染器验证 Hooks 状态队列、Effect 提交顺序、并发中断与历史回归。 */
  describe('useMemo', () => {
    /**
     * Given：改变或保持 memo 输入，确认回调与值只在依赖变化时重新计算所需的初始状态、更新入口与观测日志均已建立。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：改变或保持 memo 输入，确认回调与值只在依赖变化时重新计算。
     *
     * 验证机制：宿主输出断言确认实际提交结果。
     * 对应源码：`updateMemo()`、`updateCallback()` 与 `areHookInputsEqual()`。
     */
    it('memoizes value by comparing to previous inputs', async () => {
      /** 作为 CapitalizedText fixture 承载当前测试职责；服务于“改变或保持 memo 输入，确认回调与值只在依赖变化时重新计算”场景。 */
      function CapitalizedText(props) {
        const text = props.text;
        const capitalizedText = useMemo(() => {
          Scheduler.log(`Capitalize '${text}'`);
          return text.toUpperCase();
        }, [text]);
        return <Text text={capitalizedText} />;
      }

      ReactNoop.render(<CapitalizedText text="hello" />);
      await waitForAll(["Capitalize 'hello'", 'HELLO']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="HELLO" />);

      ReactNoop.render(<CapitalizedText text="hi" />);
      await waitForAll(["Capitalize 'hi'", 'HI']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="HI" />);

      ReactNoop.render(<CapitalizedText text="hi" />);
      await waitForAll(['HI']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="HI" />);

      ReactNoop.render(<CapitalizedText text="goodbye" />);
      await waitForAll(["Capitalize 'goodbye'", 'GOODBYE']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="GOODBYE" />);
    });

    /**
     * Given：改变或保持 memo 输入，确认回调与值只在依赖变化时重新计算所需的初始状态、更新入口与观测日志均已建立。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：改变或保持 memo 输入，确认回调与值只在依赖变化时重新计算。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`renderWithHooks()` 与当前 Hook 的 mount/update dispatcher。
     */
    it('always re-computes if no inputs are provided', async () => {
      /** 作为 LazyCompute fixture 承载当前测试职责；服务于“改变或保持 memo 输入，确认回调与值只在依赖变化时重新计算”场景。 */
      function LazyCompute(props) {
        const computed = useMemo(props.compute);
        return <Text text={computed} />;
      }

      /** 作为 computeA fixture 承载当前测试职责；服务于“改变或保持 memo 输入，确认回调与值只在依赖变化时重新计算”场景。 */
      function computeA() {
        Scheduler.log('compute A');
        return 'A';
      }

      /** 作为 computeB fixture 承载当前测试职责；服务于“改变或保持 memo 输入，确认回调与值只在依赖变化时重新计算”场景。 */
      function computeB() {
        Scheduler.log('compute B');
        return 'B';
      }

      ReactNoop.render(<LazyCompute compute={computeA} />);
      await waitForAll(['compute A', 'A']);

      ReactNoop.render(<LazyCompute compute={computeA} />);
      await waitForAll(['compute A', 'A']);

      ReactNoop.render(<LazyCompute compute={computeA} />);
      await waitForAll(['compute A', 'A']);

      ReactNoop.render(<LazyCompute compute={computeB} />);
      await waitForAll(['compute B', 'B']);
    });

    /**
     * Given：改变或保持 memo 输入，确认回调与值只在依赖变化时重新计算所需的初始状态、更新入口与观测日志均已建立。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：改变或保持 memo 输入，确认回调与值只在依赖变化时重新计算。
     *
     * 验证机制：显式断言联合检查状态、输出和副作用。
     * 对应源码：`updateMemo()`、`updateCallback()` 与 `areHookInputsEqual()`。
     */
    it('should not invoke memoized function during re-renders unless inputs change', async () => {
      /** 作为 LazyCompute fixture 承载当前测试职责；服务于“改变或保持 memo 输入，确认回调与值只在依赖变化时重新计算”场景。 */
      function LazyCompute(props) {
        const computed = useMemo(
          () => props.compute(props.input),
          [props.input],
        );
        const [count, setCount] = useState(0);
        if (count < 3) {
          setCount(count + 1);
        }
        return <Text text={computed} />;
      }

      /** 作为 compute fixture 承载当前测试职责；服务于“改变或保持 memo 输入，确认回调与值只在依赖变化时重新计算”场景。 */
      function compute(val) {
        Scheduler.log('compute ' + val);
        return val;
      }

      ReactNoop.render(<LazyCompute compute={compute} input="A" />);
      await waitForAll(['compute A', 'A']);

      ReactNoop.render(<LazyCompute compute={compute} input="A" />);
      await waitForAll(['A']);

      ReactNoop.render(<LazyCompute compute={compute} input="B" />);
      await waitForAll(['compute B', 'B']);
    });
  });

  /** 通过 Noop 渲染器验证 Hooks 状态队列、Effect 提交顺序、并发中断与历史回归。 */
  describe('useImperativeHandle', () => {
    /**
     * Given：改变 Hook 依赖数组，确认相等依赖跳过、缺省依赖重跑、差异依赖更新所需的初始状态、更新入口与观测日志均已建立。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：改变 Hook 依赖数组，确认相等依赖跳过、缺省依赖重跑、差异依赖更新。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`updateMemo()`、`updateCallback()` 与 `areHookInputsEqual()`。
     */
    it('does not update when deps are the same', async () => {
      const INCREMENT = 'INCREMENT';

      /** 根据 action 与当前状态计算 reducer 的下一状态；服务于“改变 Hook 依赖数组，确认相等依赖跳过、缺省依赖重跑、差异依赖更新”场景。 */
      function reducer(state, action) {
        return action === INCREMENT ? state + 1 : state;
      }

      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“改变 Hook 依赖数组，确认相等依赖跳过、缺省依赖重跑、差异依赖更新”场景。 */
      function Counter(props, ref) {
        const [count, dispatch] = useReducer(reducer, 0);
        useImperativeHandle(ref, () => ({count, dispatch}), []);
        return <Text text={'Count: ' + count} />;
      }

      Counter = forwardRef(Counter);
      const counter = React.createRef(null);
      ReactNoop.render(<Counter ref={counter} />);
      await waitForAll(['Count: 0']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);
      expect(counter.current.count).toBe(0);

      await act(() => {
        counter.current.dispatch(INCREMENT);
      });
      assertLog(['Count: 1']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 1" />);
      // 依赖为 `[]`，因此刻意不更新：
      expect(counter.current.count).toBe(0);
    });

    // 回归场景：https://github.com/facebook/react/issues/14782
    /**
     * Given：改变 Hook 依赖数组，确认相等依赖跳过、缺省依赖重跑、差异依赖更新所需的初始状态、更新入口与观测日志均已建立。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：改变 Hook 依赖数组，确认相等依赖跳过、缺省依赖重跑、差异依赖更新。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`updateMemo()`、`updateCallback()` 与 `areHookInputsEqual()`。
     */
    it('automatically updates when deps are not specified', async () => {
      const INCREMENT = 'INCREMENT';

      /** 根据 action 与当前状态计算 reducer 的下一状态；服务于“改变 Hook 依赖数组，确认相等依赖跳过、缺省依赖重跑、差异依赖更新”场景。 */
      function reducer(state, action) {
        return action === INCREMENT ? state + 1 : state;
      }

      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“改变 Hook 依赖数组，确认相等依赖跳过、缺省依赖重跑、差异依赖更新”场景。 */
      function Counter(props, ref) {
        const [count, dispatch] = useReducer(reducer, 0);
        useImperativeHandle(ref, () => ({count, dispatch}));
        return <Text text={'Count: ' + count} />;
      }

      Counter = forwardRef(Counter);
      const counter = React.createRef(null);
      ReactNoop.render(<Counter ref={counter} />);
      await waitForAll(['Count: 0']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);
      expect(counter.current.count).toBe(0);

      await act(() => {
        counter.current.dispatch(INCREMENT);
      });
      assertLog(['Count: 1']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 1" />);
      expect(counter.current.count).toBe(1);
    });

    /**
     * Given：改变 Hook 依赖数组，确认相等依赖跳过、缺省依赖重跑、差异依赖更新所需的初始状态、更新入口与观测日志均已建立。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：改变 Hook 依赖数组，确认相等依赖跳过、缺省依赖重跑、差异依赖更新。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`updateMemo()`、`updateCallback()` 与 `areHookInputsEqual()`。
     */
    it('updates when deps are different', async () => {
      const INCREMENT = 'INCREMENT';

      /** 根据 action 与当前状态计算 reducer 的下一状态；服务于“改变 Hook 依赖数组，确认相等依赖跳过、缺省依赖重跑、差异依赖更新”场景。 */
      function reducer(state, action) {
        return action === INCREMENT ? state + 1 : state;
      }

      let totalRefUpdates = 0;
      /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“改变 Hook 依赖数组，确认相等依赖跳过、缺省依赖重跑、差异依赖更新”场景。 */
      function Counter(props, ref) {
        const [count, dispatch] = useReducer(reducer, 0);
        useImperativeHandle(ref, () => {
          totalRefUpdates++;
          return {count, dispatch};
        }, [count]);
        return <Text text={'Count: ' + count} />;
      }

      Counter = forwardRef(Counter);
      const counter = React.createRef(null);
      ReactNoop.render(<Counter ref={counter} />);
      await waitForAll(['Count: 0']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);
      expect(counter.current.count).toBe(0);
      expect(totalRefUpdates).toBe(1);

      await act(() => {
        counter.current.dispatch(INCREMENT);
      });
      assertLog(['Count: 1']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 1" />);
      expect(counter.current.count).toBe(1);
      expect(totalRefUpdates).toBe(2);

      // 执行不改变 ref 依赖的更新。
      ReactNoop.render(<Counter ref={counter} />);
      await waitForAll(['Count: 1']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 1" />);
      expect(counter.current.count).toBe(1);
      expect(totalRefUpdates).toBe(2); // 相较上次不应继续增加。
    });
  });

  /** 通过 Noop 渲染器验证 Hooks 状态队列、Effect 提交顺序、并发中断与历史回归。 */
  describe('useTransition', () => {
    /**
     * Given：安排 transition 或 deferred value 更新，确认高低优先级输出与回退时机所需的初始状态、更新入口与观测日志均已建立。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：安排 transition 或 deferred value 更新，确认高低优先级输出与回退时机。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `renderWithHooksAgain()`。
     */
    it('delays showing loading state until after timeout', async () => {
      let transition;
      /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“安排 transition 或 deferred value 更新，确认高低优先级输出与回退时机”场景。 */
      function App() {
        const [show, setShow] = useState(false);
        const [isPending, startTransition] = useTransition();
        transition = () => {
          startTransition(() => {
            setShow(true);
          });
        };
        return (
          <Suspense
            fallback={<Text text={`Loading... Pending: ${isPending}`} />}>
            {show ? (
              <AsyncText text={`After... Pending: ${isPending}`} />
            ) : (
              <Text text={`Before... Pending: ${isPending}`} />
            )}
          </Suspense>
        );
      }
      ReactNoop.render(<App />);
      await waitForAll(['Before... Pending: false']);
      expect(ReactNoop).toMatchRenderedOutput(
        <span prop="Before... Pending: false" />,
      );

      await act(async () => {
        transition();

        await waitForAll([
          'Before... Pending: true',
          'Suspend! [After... Pending: false]',
          'Loading... Pending: false',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(
          <span prop="Before... Pending: true" />,
        );
        Scheduler.unstable_advanceTime(500);
        await advanceTimers(500);

        // 即使经过很长时间，仍不显示 placeholder。
        Scheduler.unstable_advanceTime(100000);
        await advanceTimers(100000);
        expect(ReactNoop).toMatchRenderedOutput(
          <span prop="Before... Pending: true" />,
        );

        await resolveText('After... Pending: false');
        assertLog(['Promise resolved [After... Pending: false]']);
        await waitForAll(['After... Pending: false']);
        expect(ReactNoop).toMatchRenderedOutput(
          <span prop="After... Pending: false" />,
        );
      });
    });
  });

  /** 通过 Noop 渲染器验证 Hooks 状态队列、Effect 提交顺序、并发中断与历史回归。 */
  describe('useDeferredValue', () => {
    /**
     * Given：安排 transition 或 deferred value 更新，确认高低优先级输出与回退时机所需的初始状态、更新入口与观测日志均已建立。
     * When：完成挂载以及用例指定的后续渲染或提交步骤。
     * Then：安排 transition 或 deferred value 更新，确认高低优先级输出与回退时机。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`mountTransition()` 与 `updateDeferredValueImpl()`。
     */
    it('defers text value', async () => {
      /** 作为 TextBox fixture 承载当前测试职责；服务于“安排 transition 或 deferred value 更新，确认高低优先级输出与回退时机”场景。 */
      function TextBox({text}) {
        return <AsyncText text={text} />;
      }

      let _setText;
      /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“安排 transition 或 deferred value 更新，确认高低优先级输出与回退时机”场景。 */
      function App() {
        const [text, setText] = useState('A');
        const deferredText = useDeferredValue(text);
        _setText = setText;
        return (
          <>
            <Text text={text} />
            <Suspense fallback={<Text text={'Loading'} />}>
              <TextBox text={deferredText} />
            </Suspense>
          </>
        );
      }

      await act(() => {
        ReactNoop.render(<App />);
      });

      assertLog([
        'A',
        'Suspend! [A]',
        'Loading',
        // 预热渲染。
        'Suspend! [A]',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="A" />
          <span prop="Loading" />
        </>,
      );

      await act(() => resolveText('A'));
      assertLog(['Promise resolved [A]', 'A']);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="A" />
          <span prop="A" />
        </>,
      );

      await act(async () => {
        _setText('B');
        await waitForAll(['B', 'A', 'B', 'Suspend! [B]', 'Loading']);
        await waitForAll([]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="B" />
            <span prop="A" />
          </>,
        );
      });

      await act(async () => {
        Scheduler.unstable_advanceTime(250);
        await advanceTimers(250);
      });
      assertLog([]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="B" />
          <span prop="A" />
        </>,
      );

      // 即使经过很长时间，也不显示 fallback。
      Scheduler.unstable_advanceTime(100000);
      await advanceTimers(100000);
      await waitForAll([]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="B" />
          <span prop="A" />
        </>,
      );

      await act(async () => {
        await resolveText('B');
      });
      assertLog(['Promise resolved [B]', 'B', 'B']);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="B" />
          <span prop="B" />
        </>,
      );
    });
  });

  /** 通过 Noop 渲染器验证 Hooks 状态队列、Effect 提交顺序、并发中断与历史回归。 */
  describe('progressive enhancement (not supported)', () => {
    /**
     * Given：改变 Hook 列表长度的历史场景，确认受控路径的状态槽行为所需的初始状态、更新入口与观测日志均已建立。
     * When：安排用例指定的状态、属性、Context 或依赖更新。
     * Then：改变 Hook 列表长度的历史场景，确认受控路径的状态槽行为。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果，开发态控制台断言限定诊断内容与去重。
     * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `renderWithHooksAgain()`。
     */
    it('mount additional state', async () => {
      let updateA;
      let updateB;
      // let updateC;

      /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“改变 Hook 列表长度的历史场景，确认受控路径的状态槽行为”场景。 */
      function App(props) {
        const [A, _updateA] = useState(0);
        const [B, _updateB] = useState(0);
        updateA = _updateA;
        updateB = _updateB;

        let C;
        if (props.loadC) {
          useState(0);
        } else {
          C = '[not loaded]';
        }

        return <Text text={`A: ${A}, B: ${B}, C: ${C}`} />;
      }

      ReactNoop.render(<App loadC={false} />);
      await waitForAll(['A: 0, B: 0, C: [not loaded]']);
      expect(ReactNoop).toMatchRenderedOutput(
        <span prop="A: 0, B: 0, C: [not loaded]" />,
      );

      await act(() => {
        updateA(2);
        updateB(3);
      });

      assertLog(['A: 2, B: 3, C: [not loaded]']);
      expect(ReactNoop).toMatchRenderedOutput(
        <span prop="A: 2, B: 3, C: [not loaded]" />,
      );

      ReactNoop.render(<App loadC={true} />);
      await waitForThrow(
        'Rendered more hooks than during the previous render.',
      );
      assertLog([]);
      assertConsoleErrorDev([
        'React has detected a change in the order of Hooks called by App. ' +
          'This will lead to bugs and errors if not fixed. For more information, ' +
          'read the Rules of Hooks: https://react.dev/link/rules-of-hooks\n' +
          '\n' +
          '   Previous render            Next render\n' +
          '   ------------------------------------------------------\n' +
          '1. useState                   useState\n' +
          '2. useState                   useState\n' +
          '3. undefined                  useState\n' +
          '   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n' +
          '\n' +
          '    in App (at **)',
      ]);

      // 若将来重新支持该行为，再取消下方代码注释。
      // expect(ReactNoop).toMatchRenderedOutput(<span prop="A: 2, B: 3, C: 0" />]);

      // updateC(4);
      // expect(Scheduler).toFlushAndYield(['A: 2, B: 3, C: 4']);
      // expect(ReactNoop).toMatchRenderedOutput(<span prop="A: 2, B: 3, C: 4" />]);
    });

    /**
     * Given：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序所需的初始状态、更新入口与观测日志均已建立。
     * When：删除目标子树并冲刷对应提交阶段。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('unmount state', async () => {
      let updateA;
      let updateB;
      let updateC;

      /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function App(props) {
        const [A, _updateA] = useState(0);
        const [B, _updateB] = useState(0);
        updateA = _updateA;
        updateB = _updateB;

        let C;
        if (props.loadC) {
          const [_C, _updateC] = useState(0);
          C = _C;
          updateC = _updateC;
        } else {
          C = '[not loaded]';
        }

        return <Text text={`A: ${A}, B: ${B}, C: ${C}`} />;
      }

      ReactNoop.render(<App loadC={true} />);
      await waitForAll(['A: 0, B: 0, C: 0']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="A: 0, B: 0, C: 0" />);
      await act(() => {
        updateA(2);
        updateB(3);
        updateC(4);
      });
      assertLog(['A: 2, B: 3, C: 4']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="A: 2, B: 3, C: 4" />);
      ReactNoop.render(<App loadC={false} />);
      await waitForThrow(
        'Rendered fewer hooks than expected. This may be caused by an ' +
          'accidental early return statement.',
      );
    });

    /**
     * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
     * When：删除目标子树并冲刷对应提交阶段。
     * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
     *
     * 验证机制：调度日志精确约束执行次数与先后顺序，开发态控制台断言限定诊断内容与去重，异常断言保留原始错误与阶段边界。
     * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
     */
    it('unmount effects', async () => {
      /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
      function App(props) {
        useEffect(() => {
          Scheduler.log('Mount A');
          return () => {
            Scheduler.log('Unmount A');
          };
        }, []);

        if (props.showMore) {
          useEffect(() => {
            Scheduler.log('Mount B');
            return () => {
              Scheduler.log('Unmount B');
            };
          }, []);
        }

        return null;
      }

      await act(async () => {
        ReactNoop.render(<App showMore={false} />, () =>
          Scheduler.log('Sync effect'),
        );
        await waitFor(['Sync effect']);
      });

      assertLog(['Mount A']);

      await act(async () => {
        ReactNoop.render(<App showMore={true} />);
        await waitForThrow(
          'Rendered more hooks than during the previous render.',
        );
        assertLog(['Unmount A']);
        assertConsoleErrorDev([
          'React has detected a change in the order of Hooks called by App. ' +
            'This will lead to bugs and errors if not fixed. For more information, ' +
            'read the Rules of Hooks: https://react.dev/link/rules-of-hooks\n' +
            '\n' +
            '   Previous render            Next render\n' +
            '   ------------------------------------------------------\n' +
            '1. useEffect                  useEffect\n' +
            '2. undefined                  useEffect\n' +
            '   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n' +
            '\n' +
            '    in App (at **)',
        ]);
      });

      // 若将来重新支持该行为，再取消下方代码注释。
      // ReactNoop.flushPassiveEffects();
      // expect(Scheduler).toHaveYielded(['Mount B']);

      // ReactNoop.render(<App showMore={false} />);
      // expect(Scheduler).toFlushAndThrow(
      //   'Rendered fewer hooks than expected. This may be caused by an ' +
      //     'accidental early return statement.',
      // );
    });
  });

  /**
   * Given：驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action所需的初始状态、更新入口与观测日志均已建立。
   * When：安排用例指定的状态、属性、Context 或依赖更新。
   * Then：驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
   * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `renderWithHooksAgain()`。
   */
  it('useReducer does not eagerly bail out of state updates', async () => {
    // 根据缺陷报告构造的边界场景。
    let setCounter;
    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action”场景。 */
    function App() {
      const [counter, _setCounter] = useState(1);
      setCounter = _setCounter;
      return <Component count={counter} />;
    }

    /** 作为 Component fixture 承载当前测试职责；服务于“驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action”场景。 */
    function Component({count}) {
      const [state, dispatch] = useReducer(() => {
        // 该 reducer 闭包捕获 props 值；若本轮未正确更新 reducer，急切计算会与旧值比较并错误提前退出。
        Scheduler.log('Reducer: ' + count);
        return count;
      }, -1);
      useEffect(() => {
        Scheduler.log('Effect: ' + count);
        dispatch();
      }, [count]);
      Scheduler.log('Render: ' + state);
      return count;
    }

    await act(async () => {
      ReactNoop.render(<App />);
      await waitForAll(['Render: -1', 'Effect: 1', 'Reducer: 1', 'Render: 1']);
      expect(ReactNoop).toMatchRenderedOutput('1');
    });

    await act(() => {
      setCounter(2);
    });
    assertLog(['Render: 1', 'Effect: 2', 'Reducer: 2', 'Render: 2']);
    expect(ReactNoop).toMatchRenderedOutput('2');
  });

  /**
   * Given：驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action所需的初始状态、更新入口与观测日志均已建立。
   * When：安排用例指定的状态、属性、Context 或依赖更新。
   * Then：驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
   * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `renderWithHooksAgain()`。
   */
  it('useReducer does not replay previous no-op actions when other state changes', async () => {
    let increment;
    let setDisabled;

    /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action”场景。 */
    function Counter() {
      const [disabled, _setDisabled] = useState(true);
      const [count, dispatch] = useReducer((state, action) => {
        if (disabled) {
          return state;
        }
        if (action.type === 'increment') {
          return state + 1;
        }
        return state;
      }, 0);

      increment = () => dispatch({type: 'increment'});
      setDisabled = _setDisabled;

      Scheduler.log('Render disabled: ' + disabled);
      Scheduler.log('Render count: ' + count);
      return count;
    }

    ReactNoop.render(<Counter />);
    await waitForAll(['Render disabled: true', 'Render count: 0']);
    expect(ReactNoop).toMatchRenderedOutput('0');

    await act(() => {
      // `disabled=true`，因此这些递增 action 不应生效。
      increment();
      increment();
      increment();
    });
    assertLog(['Render disabled: true', 'Render count: 0']);
    expect(ReactNoop).toMatchRenderedOutput('0');

    await act(() => {
      // 启用 updater 不应重放此前的 `increment()` action。
      setDisabled(false);
    });
    assertLog(['Render disabled: false', 'Render count: 0']);
    expect(ReactNoop).toMatchRenderedOutput('0');
  });

  /**
   * Given：驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action所需的初始状态、更新入口与观测日志均已建立。
   * When：安排用例指定的状态、属性、Context 或依赖更新。
   * Then：驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
   * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `renderWithHooksAgain()`。
   */
  it('useReducer does not replay previous no-op actions when props change', async () => {
    let setDisabled;
    let increment;

    /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action”场景。 */
    function Counter({disabled}) {
      const [count, dispatch] = useReducer((state, action) => {
        if (disabled) {
          return state;
        }
        if (action.type === 'increment') {
          return state + 1;
        }
        return state;
      }, 0);

      increment = () => dispatch({type: 'increment'});

      Scheduler.log('Render count: ' + count);
      return count;
    }

    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action”场景。 */
    function App() {
      const [disabled, _setDisabled] = useState(true);
      setDisabled = _setDisabled;
      Scheduler.log('Render disabled: ' + disabled);
      return <Counter disabled={disabled} />;
    }

    ReactNoop.render(<App />);
    await waitForAll(['Render disabled: true', 'Render count: 0']);
    expect(ReactNoop).toMatchRenderedOutput('0');

    await act(() => {
      // `disabled=true`，因此这些递增 action 不应生效。
      increment();
      increment();
      increment();
    });
    assertLog(['Render count: 0']);
    expect(ReactNoop).toMatchRenderedOutput('0');

    await act(() => {
      // 启用 updater 不应重放此前的 `increment()` action。
      setDisabled(false);
    });
    assertLog(['Render disabled: false', 'Render count: 0']);
    expect(ReactNoop).toMatchRenderedOutput('0');
  });

  /**
   * Given：驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action所需的初始状态、更新入口与观测日志均已建立。
   * When：安排用例指定的状态、属性、Context 或依赖更新。
   * Then：驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
   * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `renderWithHooksAgain()`。
   */
  it('useReducer applies potential no-op changes if made relevant by other updates in the batch', async () => {
    let setDisabled;
    let increment;

    /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action”场景。 */
    function Counter({disabled}) {
      const [count, dispatch] = useReducer((state, action) => {
        if (disabled) {
          return state;
        }
        if (action.type === 'increment') {
          return state + 1;
        }
        return state;
      }, 0);

      increment = () => dispatch({type: 'increment'});

      Scheduler.log('Render count: ' + count);
      return count;
    }

    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“驱动 reducer 队列与不同优先级更新，确认使用本轮 reducer 并按批次顺序处理 action”场景。 */
    function App() {
      const [disabled, _setDisabled] = useState(true);
      setDisabled = _setDisabled;
      Scheduler.log('Render disabled: ' + disabled);
      return <Counter disabled={disabled} />;
    }

    ReactNoop.render(<App />);
    await waitForAll(['Render disabled: true', 'Render count: 0']);
    expect(ReactNoop).toMatchRenderedOutput('0');

    await act(() => {
      // 虽然 increment 先调用且在 `disabled=true` 时看似无效，但同一批次会先处理父更新；子组件以 `disabled=false` 重渲染后再处理该 action，使计数与输出变化。
      increment();
      setDisabled(false);
    });
    assertLog(['Render disabled: false', 'Render count: 1']);
    expect(ReactNoop).toMatchRenderedOutput('1');
  });

  // 回归场景：内部状态变量 `didReceiveUpdate` 未正确复位。
  /**
   * Given：复现既有 Hook 队列或 Effect 标记回归，确认更新与卸载标记不会丢失所需的初始状态、更新入口与观测日志均已建立。
   * When：安排用例指定的状态、属性、Context 或依赖更新。
   * Then：复现既有 Hook 队列或 Effect 标记回归，确认更新与卸载标记不会丢失。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序。
   * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `renderWithHooksAgain()`。
   */
  it('state bail out edge case (#16359)', async () => {
    let setCounterA;
    let setCounterB;

    /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“复现既有 Hook 队列或 Effect 标记回归，确认更新与卸载标记不会丢失”场景。 */
    function CounterA() {
      const [counter, setCounter] = useState(0);
      setCounterA = setCounter;
      Scheduler.log('Render A: ' + counter);
      useEffect(() => {
        Scheduler.log('Commit A: ' + counter);
      });
      return counter;
    }

    /** 作为计数 fixture 驱动状态队列并输出每次渲染或 Effect；服务于“复现既有 Hook 队列或 Effect 标记回归，确认更新与卸载标记不会丢失”场景。 */
    function CounterB() {
      const [counter, setCounter] = useState(0);
      setCounterB = setCounter;
      Scheduler.log('Render B: ' + counter);
      useEffect(() => {
        Scheduler.log('Commit B: ' + counter);
      });
      return counter;
    }

    const root = ReactNoop.createRoot(null);
    await act(() => {
      root.render(
        <>
          <CounterA />
          <CounterB />
        </>,
      );
    });
    assertLog(['Render A: 0', 'Render B: 0', 'Commit A: 0', 'Commit B: 0']);

    await act(() => {
      setCounterA(1);

      // 在同一批次中更新 B 两次；第一次更新用于绕过提前退出优化，从而进入目标分支。
      setCounterB(1);
      setCounterB(0);
    });
    assertLog([
      'Render A: 1',
      'Render B: 0',
      'Commit A: 1',
      // B 的更新已提前退出，因此不应执行 Effect。
      // 'Commit B: 0',
    ]);
  });

  /**
   * Given：渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断所需的初始状态、更新入口与观测日志均已建立。
   * When：安排用例指定的状态、属性、Context 或依赖更新。
   * Then：渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序，宿主输出断言确认实际提交结果。
   * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `renderWithHooksAgain()`。
   */
  it('should update latest rendered reducer when a preceding state receives a render phase update', async () => {
    // 与上一用例类似，但改用前置渲染阶段更新，而非新 props。
    let dispatch;
    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断”场景。 */
    function App() {
      const [step, setStep] = useState(0);
      const [shadow, _dispatch] = useReducer(() => step, step);
      dispatch = _dispatch;

      if (step < 5) {
        setStep(step + 1);
      }

      Scheduler.log(`Step: ${step}, Shadow: ${shadow}`);
      return shadow;
    }

    ReactNoop.render(<App />);
    await waitForAll([
      'Step: 0, Shadow: 0',
      'Step: 1, Shadow: 0',
      'Step: 2, Shadow: 0',
      'Step: 3, Shadow: 0',
      'Step: 4, Shadow: 0',
      'Step: 5, Shadow: 0',
    ]);
    expect(ReactNoop).toMatchRenderedOutput('0');

    await act(() => dispatch());
    assertLog(['Step: 5, Shadow: 5']);
    expect(ReactNoop).toMatchRenderedOutput('5');
  });

  /**
   * Given：渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断所需的初始状态、更新入口与观测日志均已建立。
   * When：安排用例指定的状态、属性、Context 或依赖更新。
   * Then：渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断。
   *
   * 验证机制：宿主输出断言确认实际提交结果。
   * 对应源码：`updateReducerImpl()`、`dispatchSetStateInternal()` 与 `renderWithHooksAgain()`。
   */
  it('should process the rest pending updates after a render phase update', async () => {
    // 与上一用例类似，但改用前置渲染阶段更新，而非新 props。
    let updateA;
    let updateC;
    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断”场景。 */
    function App() {
      const [a, setA] = useState(false);
      const [b, setB] = useState(false);
      if (a !== b) {
        setB(a);
      }
      // 即使上方调用了 `setB`，本轮渲染仍应应用 C 的变化。
      const [c, setC] = useState(false);
      updateA = setA;
      updateC = setC;
      return `${a ? 'A' : 'a'}${b ? 'B' : 'b'}${c ? 'C' : 'c'}`;
    }

    await act(() => ReactNoop.render(<App />));
    expect(ReactNoop).toMatchRenderedOutput('abc');

    await act(() => {
      updateA(true);
      // 该更新不得丢失。
      updateC(true);
    });
    expect(ReactNoop).toMatchRenderedOutput('ABC');
  });

  /**
   * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
   * When：删除目标子树并冲刷对应提交阶段。
   * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序。
   * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
   */
  it("regression test: don't unmount effects on siblings of deleted nodes", async () => {
    const root = ReactNoop.createRoot();

    /** 作为子级函数组件暴露 Hook 状态和提交日志；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
    function Child({label}) {
      useLayoutEffect(() => {
        Scheduler.log('Mount layout ' + label);
        return () => {
          Scheduler.log('Unmount layout ' + label);
        };
      }, [label]);
      useEffect(() => {
        Scheduler.log('Mount passive ' + label);
        return () => {
          Scheduler.log('Unmount passive ' + label);
        };
      }, [label]);
      return label;
    }

    await act(() => {
      root.render(
        <>
          <Child key="A" label="A" />
          <Child key="B" label="B" />
        </>,
      );
    });
    assertLog([
      'Mount layout A',
      'Mount layout B',
      'Mount passive A',
      'Mount passive B',
    ]);

    // 删除 A 时只应卸载 A 的 Effect；原回归中 B 的 Effect 也会被错误卸载。
    await act(() => {
      root.render(
        <>
          <Child key="B" label="B" />
        </>,
      );
    });
    assertLog(['Unmount layout A', 'Unmount passive A']);

    // 现在删除并卸载 B。
    await act(() => {
      root.render(null);
    });
    assertLog(['Unmount layout B', 'Unmount passive B']);
  });

  /**
   * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
   * When：删除目标子树并冲刷对应提交阶段。
   * Then：挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序。
   * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
   */
  it('regression: deleting a tree and unmounting its effects after a reorder', async () => {
    const root = ReactNoop.createRoot();

    /** 作为子级函数组件暴露 Hook 状态和提交日志；服务于“挂载、更新或删除含 Passive Effect 的组件树，确认创建、清理、错误与兄弟顺序”场景。 */
    function Child({label}) {
      useEffect(() => {
        Scheduler.log('Mount ' + label);
        return () => {
          Scheduler.log('Unmount ' + label);
        };
      }, [label]);
      return label;
    }

    await act(() => {
      root.render(
        <>
          <Child key="A" label="A" />
          <Child key="B" label="B" />
        </>,
      );
    });
    assertLog(['Mount A', 'Mount B']);

    await act(() => {
      root.render(
        <>
          <Child key="B" label="B" />
          <Child key="A" label="A" />
        </>,
      );
    });
    assertLog([]);

    await act(() => {
      root.render(null);
    });

    assertLog([
      'Unmount B',
      // 原回归中，重排会让 Child A“忘记”自身包含 Passive Effect，随后删除树时 A 的卸载 Effect 不会执行。
      'Unmount A',
    ]);
  });

  /**
   * Given：Hook 更新参与的并发渲染发生挂起或恢复，确认未提交尝试不会污染后续队列与 Effect所需的初始状态、更新入口与观测日志均已建立。
   * When：删除目标子树并冲刷对应提交阶段。
   * Then：Hook 更新参与的并发渲染发生挂起或恢复，确认未提交尝试不会污染后续队列与 Effect。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序。
   * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
   */
  // @gate enableSuspenseList
  it('regression: SuspenseList causes unmounts to be dropped on deletion', async () => {
    /** 作为 Row fixture 承载当前测试职责；服务于“Hook 更新参与的并发渲染发生挂起或恢复，确认未提交尝试不会污染后续队列与 Effect”场景。 */
    function Row({label}) {
      useEffect(() => {
        Scheduler.log('Mount ' + label);
        return () => {
          Scheduler.log('Unmount ' + label);
        };
      }, [label]);
      return (
        <Suspense fallback="Loading...">
          <AsyncText text={label} />
        </Suspense>
      );
    }

    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“Hook 更新参与的并发渲染发生挂起或恢复，确认未提交尝试不会污染后续队列与 Effect”场景。 */
    function App() {
      return (
        <SuspenseList revealOrder="together">
          <Row label="A" />
          <Row label="B" />
        </SuspenseList>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });
    assertLog(['Suspend! [A]', 'Suspend! [B]', 'Mount A', 'Mount B']);

    await act(async () => {
      await resolveText('A');
    });
    assertLog(['Promise resolved [A]', 'A', 'Suspend! [B]']);

    await act(() => {
      root.render(null);
    });
    // 原回归中，SuspenseList 会让子节点“忘记”包含 Passive Effect，随后删除树时这些卸载 Effect 不会执行。
    assertLog(['Unmount A', 'Unmount B']);
  });

  /**
   * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
   * When：安排用例指定的状态、属性、Context 或依赖更新。
   * Then：渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断。
   *
   * 验证机制：调度日志精确约束执行次数与先后顺序。
   * 对应源码：`commitHookPassiveMountEffects()` 与 `commitHookPassiveUnmountEffects()`。
   */
  it('effect dependencies are persisted after a render phase update', async () => {
    let handleClick;
    /** 作为 Test fixture 承载当前测试职责；服务于“渲染期间安排 Hook 更新，确认重渲染合并、收敛上限及跨组件诊断”场景。 */
    function Test() {
      const [count, setCount] = useState(0);

      useEffect(() => {
        Scheduler.log(`Effect: ${count}`);
      }, [count]);

      if (count > 0) {
        setCount(0);
      }

      handleClick = () => setCount(2);

      return <Text text={`Render: ${count}`} />;
    }

    await act(() => {
      ReactNoop.render(<Test />);
    });

    assertLog(['Render: 0', 'Effect: 0']);

    await act(() => {
      handleClick();
    });

    assertLog(['Render: 0']);

    await act(() => {
      handleClick();
    });

    assertLog(['Render: 0']);

    await act(() => {
      handleClick();
    });

    assertLog(['Render: 0']);
  });
});
