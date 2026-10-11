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

    /** 读取全用例独立Map：resolved返回text，rejected抛错误，pending抛同一Promise；缺项创建pending并保存兑现入口。 */
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

    /** 兑现已有pending的原生Promise，随后清timer/记录resolved并释放promise引用；ping的微任务在这些同步写入后执行，缺项可预置resolved。 */
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

  /** 把输入同步到调度日志与宿主输出。 */
  function Text(props) {
    Scheduler.log(props.text);
    return <span prop={props.text} />;
  }

  /** 读取资源后输出span；pending记录Suspend并按ms只安装一次Jest timer，非thenable记录Error，均原样重抛。 */
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

  /** 推进 Jest 虚拟时间并等待当前 tick 结束，隔离调度器时间与测试时间。 */
  function advanceTimers(ms) {
    // 注意：这里只推进 Jest 虚拟时间，不推进 React 时间；后者应使用 `ReactNoop.expire`。
    if (typeof ms !== 'number') {
      throw new Error('Must specify ms');
    }
    jest.advanceTimersByTime(ms);
    // 等待当前 tick 结束；由于定时器已被模拟，不能用 timer 实现该等待。
    return Promise.resolve().then(() => {});
  }

  /** count0已挂载；transition排入替换1及+10，日志Count11时仍未提交；flushSync改label为Total先显示Total0，后恢复为Total11。验证Hook base队列跨同步打断重放并保留新props，没有thenable参与。 */
  it('resumes after an interruption', async () => {
    /** 保存count并通过imperative handle暴露setter；label来自props，使同步改label与低优先级state可以分开提交。 */
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

  /** 类BadCounter.render调用useState，waitForThrow匹配非法Hook调用；随后合法GoodCounter初值10正常渲染。验证class dispatcher拒绝Hook且错误后恢复可用环境。 */
  it('throws inside class components', async () => {
    /** 类render直接调用函数组件专用Hook，作为非法dispatcher路径的对照。 */
    class BadCounter extends React.Component {
      /** 在class render中调用useState，理应在得到Text之前立即抛非法Hook错误。 */
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
    /** 用合法函数组件读取初值，确认前一个非法 Hook 用例后仍能正常渲染。 */
    function GoodCounter(props, ref) {
      const [count] = useState(props.initialCount);
      return <Text text={count} />;
    }
    ReactNoop.render(<GoodCounter initialCount={10} />);
    await waitForAll([10]);
  });

  /** 在组件render外直接useState(0)，抛null dispatcher的属性读取错误并在DEV记录非法调用警告。验证公开Hook先解析dispatcher，与reducer更新处理无关。 */
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
    /** ref暴露useState setter，初值0，先替换为1再函数式+10，日志与输出为0→1→11。验证basicStateReducer同时接受值与更新函数。 */
    it('simple mount and update', async () => {
      /** 从count0开始，通过imperative handle暴露setter，输出Count文本以观察值更新和函数式更新。 */
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

    /** 初挂惰性initializer返回props.initialState=42且只记录一次getInitialState；setter改7不再调用initializer。验证初挂求值与后续state更新分离。 */
    it('lazy state initializer', async () => {
      /** 用惰性initializer读取initialState并记录求值，imperative handle只暴露后续setter。 */
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

    /** count和label分别从0/Count开始；先count7再labelTotal，日志Count0→Count7→Total7。验证相邻Hook各自保存状态与队列。 */
    it('multiple states', async () => {
      /** 建立count与label两个独立state槽，通过imperative handle暴露两份setter并拼接输出。 */
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

    /** 保存首次setter，更新1后再用旧setter函数式+10；两次采集的setter引用相同且最终11。验证稳定dispatch仍指向当前队列。 */
    it('returns the same updater function every time', async () => {
      let updater = null;
      /** 每轮把当前count的setter写到updater，供测试比较引用身份并用初次setter继续更新。 */
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

    /** Counter只暴露setter并返回null，根删除且冲刷完后调用旧setter(1)不产生未处理告警。此例没有effect或待passive清理窗口。 */
    it('does not warn on set after unmount', async () => {
      let _updateCount;
      /** 只暴露setter不使用state值，返回null；删除后保留的闭包用于核对忽略更新。 */
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

    /** memo Counter初始Count0；相同空props根重渲染没有日志，内部setter1仍产Count1。验证memo props bailout不会阻止本Fiber的Hook更新。 */
    it('works with memo', async () => {
      let _updateCount;
      /** memo包裹的有状态Counter，内部setter可更新count，props不变时由memo跳过父请求。 */
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
    /** ScrollView在render镜像row并计算方向；row序列1→5→5→10→2→2产生false/true/true/true/false/false。验证本组件render-phase更新先合并再协调Text。 */
    it('restarts the render function and applies the new updates on top', async () => {
      /** 在 render 中镜像 row 并计算滚动方向，检验同轮状态重放。 */
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

    /** Foo保存step，Bar在render触发Foo+1；两轮分别日志Foo0/Bar/Foo1、Foo1/Bar/Foo2，开发跨组件告警只第一轮出现。验证这不是Bar自身的render-phase队列，并检查警告去重。 */
    it('warns about render phase update on a different component', async () => {
      let setStep;
      /** 暴露 Foo 的 step 更新器，供兄弟 Bar 在 render 中派发。 */
      function Foo() {
        const [step, _setStep] = useState(0);
        setStep = _setStep;
        return <Text text={`Foo [${step}]`} />;
      }

      /** 由 triggerUpdate 决定是否在 render 中更新 Foo，制造跨组件更新警告。 */
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

    /** Counter从0开始，每次render若小于3便setCount(count+1)，函数依次render0/1/2/3但Text只输出3。验证renderWithHooksAgain重复到无新更新。 */
    it('keeps restarting until there are no more new updates', async () => {
      /** count小于3时render内加1，逐pass记录count；row形参不参与逻辑。 */
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

    /** Counter每轮render在count<12时排入三次函数式+1，依次render0/3/6/9/12，最终Text12。验证同轮render-phase更新按队列顺序组合。 */
    it('updates multiple times within same render function', async () => {
      /** count小于12时render内排三次函数式加1，逐pass记录；row形参没有使用。 */
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

    /** Counter每次render无条件setCount(count+1)，waitForThrow匹配Too many re-renders。验证单组件render-phase重复次数上限，不是根级嵌套commit检测。 */
    it('throws after too many iterations', async () => {
      /** 每次render无条件加1并记录，故重跑无法收敛，触发单组件重渲染上限。 */
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

    /** useReducer初值0，render内dispatch increment直至3；日志render0/1/2/3且最终Text3。验证re-render dispatcher处理reducer action。 */
    it('works with useReducer', async () => {
      /** increment action加1，其余action原样返回state；由render阶段调用。 */
      function reducer(state, action) {
        return action === 'increment' ? state + 1 : state;
      }
      /** render内向reducer排increment直至count3，记录各pass并返回最终Text。 */
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

    /** reducerA增1、B增10；render每次dispatch后交换reducer，初挂0→10→11→21，reset后0→1→11→12→22。验证action由下一pass当前reducer处理，不固定捕获派发时reducer。 */
    it('uses reducer passed at time of render, not time of dispatch', async () => {
      // 该构造虽不常见，但用于展示一个细微边界。

      // Reducer A 每次加 1，Reducer B 每次加 10。
      /** increment加1、reset归0；本例只派发这两种action，其他值没有返回分支。 */
      function reducerA(state, action) {
        switch (action) {
          case 'increment':
            return state + 1;
          case 'reset':
            return 0;
        }
      }
      /** increment加10、reset归0，与A交替成为当前render使用的reducer。 */
      function reducerB(state, action) {
        switch (action) {
          case 'increment':
            return state + 10;
          case 'reset':
            return 0;
        }
      }

      /** 把reducer函数存在前置state中，每次render派发increment并交换A/B；下一pass以新reducer处理后置队列。 */
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

    /** signal从true改false时Bar先排counter/signal render-phase更新再抛never；两次transition都再次Suspend且可见计数仍0。验证放弃挂起render清除本轮render-phase更新。 */
    it('discards render phase updates if something suspends', async () => {
      /** 永久 pending 的 thenable；空 then 不登记或触发唤醒。 */
      const thenable = {/** 挂起协议入口；该 fixture 永不主动唤醒渲染。 */ then() {}};
      /** 在 Suspense 中包裹 signal 驱动的 Bar，提供可观察的 Loading 回退。 */
      function Foo({signal}) {
        return (
          <Suspense fallback="Loading...">
            <Bar signal={signal} />
          </Suspense>
        );
      }

      /** signal 变化时派发本组件 state 更新并挂起，检查放弃 render 后不会泄漏这些更新。 */
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

    /** signal改false与label B同一transition；render-phase counter1挂起，两次尝试不提交；最后signal改true解除挂起，输出B0。验证普通label队列更新保留，render-phase更新被丢弃。 */
    it('discards render phase updates if something suspends, but not other updates in the same component', async () => {
      /** 永久 pending 的 thenable；空 then 不登记或触发唤醒。 */
      const thenable = {/** 挂起协议入口；该 fixture 永不主动唤醒渲染。 */ then() {}};
      /** 以 Suspense 包裹 Bar，观察 signal 更新被挂起后保留的输出。 */
      function Foo({signal}) {
        return (
          <Suspense fallback="Loading...">
            <Bar signal={signal} />
          </Suspense>
        );
      }

      let setLabel;
      /** 在 render-phase 更新与挂起交错时维护 counter，检查后续 props 更新仍可处理。 */
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

    /** Bar第一个Hook在suspend时排counter更新并抛never，后面的label Hook尚未读取；transition同时label B，随后取消suspend得到B0。验证unwind不能清空尚未处理的普通pending队列。 */
    it(
      'preserves pending updates on later hooks that were not processed ' +
        'before unwind',
      async () => {
        /** 永久 pending 的 thenable；空 then 不登记或触发唤醒。 */
        const thenable = {/** 挂起协议入口；该 fixture 永不主动唤醒渲染。 */ then() {}};

        let setLabel;
        /** 把可挂起的 Bar 放在边界内，检查尚未执行到的后续 Hook 更新能否在重试时保留。 */
        function Foo({suspend}) {
          return (
            <Suspense fallback="Loading...">
              <Bar suspend={suspend} />
            </Suspense>
          );
        }

        /** 按 suspend 控制挂起，并在可继续的 render 中推进 counter。 */
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

    /** row初始10方向Up；同批discrete row5与transition row20，日志Up再Down且最终Down。验证前置state触发render-phase prevRow/方向同步时不丢低优先级row更新。 */
    it('regression: render phase updates cause lower pri work to be dropped', async () => {
      let setRow;
      /** 暴露 row 更新器，触发在 render 中派发第二次状态更新的路径。 */
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
    /** 初挂counter0在render内调用React.startTransition并排+1，最终只输出1；保留TODO说明没有专门警告。验证已有render-phase判定优先于transition lane分配。 */
    it('calling startTransition inside render phase', async () => {
      /** counter0时在render内用startTransition包住本组件+1，仍按render-phase更新重复到1。 */
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
    /** reducer初值0，INCREMENT后为1，再同批三个DECREMENT为-2；ref暴露dispatch，验证action顺序和批处理。 */
    it('simple mount and update', async () => {
      const INCREMENT = 'INCREMENT';
      const DECREMENT = 'DECREMENT';

      /** INCREMENT加1、DECREMENT减1，未识别action保持state，供普通更新和批量dispatch核对。 */
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

      /** 以INCREMENT/DECREMENT reducer维护count，imperative handle暴露dispatch并输出Count。 */
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

    /** reducer第三参数从props.initialCount10初始化，仅初挂日志Init；increment为11再三个decrement为8。验证init只用于建立初值，后续处理reducer action。 */
    it('lazy init', async () => {
      const INCREMENT = 'INCREMENT';
      const DECREMENT = 'DECREMENT';

      /** INCREMENT加1、DECREMENT减1，未识别action保持state，供普通更新和批量dispatch核对。 */
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

      /** reducer init从props.initialCount建立初值并记录Init，后续dispatch不重新执行init。 */
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
    /** 先batchedUpdates三个increment，再flushSync一个increment；本版输出只Count4。验证Sync出现时选择SyncUpdateLanes组，可把已有Default更新一起处理，不能沿旧标题断言先1再4。 */
    it('handles dispatches with mixed priorities', async () => {
      const INCREMENT = 'INCREMENT';

      /** increment action加1，其余action原样返回state；由render阶段调用。 */
      function reducer(state, action) {
        return action === INCREMENT ? state + 1 : state;
      }

      /** ref暴露increment reducer的dispatch，用同一队列观察batched普通更新与flushSync合并。 */
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
    /** Counter只用props.count安装无deps passive，0/1两轮先render及根callback的Sync effect、随后Passive effect。验证effect在提交后冲刷，与state队列无关。 */
    it('simple mount and update', async () => {
      /** 输出props.count并安装无deps passive日志，没有本地state更新；根callback提供提交检查点。 */
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

    /** Layout和稳定元素Passive初挂后删除Layout兄弟；尚未执行的passive create仍先被冲刷，剩余输出Passive。验证兄弟删除不会丢全局待passive任务。 */
    it('flushes passive effects even with sibling deletions', async () => {
      /** 在 layout create 写日志，与兄弟 passive Effect 的待冲刷工作对照。 */
      function LayoutEffect(props) {
        useLayoutEffect(() => {
          Scheduler.log(`Layout effect`);
        });
        return <Text text="Layout" />;
      }
      /** 首次 passive create 写日志，检查删除兄弟不影响已登记的被动工作。 */
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

    /** Layout的layout把count0改1，兄弟Passive待create；日志layout0→Passive effect→layout1，最终两兄弟保留。验证新同步更新前先冲刷上次passive。 */
    it('flushes passive effects even if siblings schedule an update', async () => {
      /** 每次 passive create 写日志，检查 layout 中安排的新更新不会跳过它。 */
      function PassiveEffect(props) {
        useEffect(() => {
          Scheduler.log('Passive effect');
        });
        return <Text text="Passive" />;
      }
      /** layout 中将 count 从 0 更新为 1，制造 passive flush 与同步新工作的交错。 */
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

    /** Layout的layout向root2渲染New Root，当前根Passive尚待create；日志先Passive effect再New Root。验证跨根调度也不丢待passive工作。 */
    it('flushes passive effects even if siblings schedule a new root', async () => {
      /** 只在首次 passive create 写日志，检查另一根的更新不会让它丢失。 */
      function PassiveEffect(props) {
        useEffect(() => {
          Scheduler.log('Passive effect');
        }, []);
        return <Text text="Passive" />;
      }
      /** layout 中更新 root2，核对另一根的新工作与本根 passive 的冲刷顺序。 */
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

    /** count0已提交但passive未执行时排count1；旧effect观察已提交文本0，随后才render/commit1，新effect观察1。验证每次effect读到它对应提交的宿主状态。 */
    it(
      'flushes effects serially by flushing old effects before flushing ' +
        "new ones, if they haven't already fired",
      async () => {
        /** 从已提交宿主节点读取文本，供 Effect 阶段检查突变可见性。 */
        function getCommittedText() {
          const children = ReactNoop.getChildrenAsJSX();
          if (children === null) {
            return null;
          }
          return children.props.prop;
        }

        /** 输出props.count，passive从已提交宿主读取当前文本，观察旧effect冲刷是否先于下一次渲染。 */
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

    /** Child按bar/foo分别安装layout/passive；初值1/1，更新1/2只清理重建foo，删除时全部layout先清理、全部passive随后清理。验证静态effect信息保留及删除阶段分离。 */
    it('defers passive effect destroy functions during unmount', async () => {
      /** 按bar/foo各安装一份layout和passive cleanup，记录同一依赖变化与删除时的阶段顺序。 */
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

      // 本次bar依赖未变，其对应Effect不带HookHasEffect，普通更新提交跳过它；静态标记仍需保留，以便删除时清理。
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

    /** Component在passive登记请求回调并安装layout/passive cleanup；删除根后仅layout已销毁时回调setDidLoad，再flushPassive见destroy且无过期警告。验证删除后pending passive窗口的更新忽略。 */
    it('does not warn about state updates for unmounted components with pending passive unmounts', async () => {
      let completePendingRequest = null;
      /** 用 passive Effect 登记模拟请求回调，并记录 layout/passive 清理，观察删除后的待清理窗口。 */
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
          /** 模拟请求完成，仅派发didLoad=true；删除后调用用于核对忽略更新的窗口。 */
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

    /** Parent有两个Child，先更新1以建立alternate，再transition改2并暂停第一个render；Continuous更新删除两Child，删除commit后旧setter再派发2，只有两个passive destroy。验证current/alternate删除路径均不告警或重挂。 */
    it('does not warn about state updates for unmounted components with pending passive unmounts for alternates', async () => {
      let setParentState = null;
      const setChildStates = [];

      /** 保存是否显示两个Child的state，暴露setter并分别记录render/layout，供Continuous更新删除子树。 */
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

      /** 保存数字state，passive把setter加入setChildStates；layout和passive日志定位alternate更新及删除窗口。 */
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

      // 先普通更新子state=1以建立alternate，再安排state=2的transition并在中途删除；这里没有防抖计时器。
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

    /** Component只有layout登记请求回调与cleanup，没有passive；删除后layout destroy已完成，再回调setDidLoad，不告警。验证无pending passive的已卸载更新也被忽略。 */
    it('does not warn about state updates for unmounted components with no pending passive unmounts', async () => {
      let completePendingRequest = null;
      /** 在 layout 中登记请求回调；组件删除后模拟请求完成，检查 state 更新不会产生过期警告。 */
      function Component() {
        Scheduler.log('Component');
        const [didLoad, setDidLoad] = React.useState(false);
        React.useLayoutEffect(() => {
          Scheduler.log('layout create');
          // 模拟带完成回调的 XHR 请求，回调会更新 state。
          /** 模拟请求完成，仅派发didLoad=true；删除后调用用于核对忽略更新的窗口。 */
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

    /** 带XHR组件的passive只create无cleanup，另一个兄弟有passive destroy；删除后XHR回调更新已删组件，后续只有兄弟清理。验证不能把全局pending passive误认作当前Fiber待清理。 */
    it('does not warn if there are pending passive unmount effects but not for the current fiber', async () => {
      let completePendingRequest = null;
      /** 安装请求回调与两类 Effect，作为已删除且仍可能收到请求结果的组件。 */
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
          /** 模拟请求完成，仅派发didLoad=true；删除后调用用于核对忽略更新的窗口。 */
          completePendingRequest = () => setDidLoad(true);
        }, []);
        return didLoad;
      }

      /** 只登记 passive create/cleanup，作为待被动清理的兄弟组件。 */
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

    /** Component passive已有cleanup，删除根并waitForAll全部清理完，再调用旧setter(true)不告警。验证彻底断开后的state更新仍被忽略。 */
    it('does not warn if there are updates after pending passive unmount effects have been flushed', async () => {
      let updaterFunction;

      /** 暴露 state 更新器并登记 passive cleanup，观察删除后更新与清理的顺序。 */
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

    /** Component passive cleanup中更新自身didLoad；删除根只见passive destroy，没有新Component渲染或未处理告警。验证卸载中更新不会重新挂载自身。 */
    it('does not show a warning when a component updates its own state from within passive unmount function', async () => {
      /** 在 passive cleanup 中更新本组件，确认卸载中的更新不会再次挂载它。 */
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

    /** Parent passive cleanup通过ref调用已删除Child setter，Child的passive只登记setter；删除根仅Parent destroy，验证父清理对已删子队列更新被忽略。 */
    it('does not show a warning when a component updates a child state from within passive unmount function', async () => {
      /** 通过ref保存子setter，自身passive cleanup更新已删除子；本体不持有父state。 */
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

      /** 保存布尔state，在passive将setter写入父ref，无cleanup；返回该布尔值供卸载更新检查。 */
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

    /** Child passive cleanup调用已删除Parent的setter；初挂父子日志后删除根只Child destroy。验证子清理对已删祖先更新也不告警。 */
    it('does not show a warning when a component updates a parents state from within passive unmount function', async () => {
      /** 保存布尔state并将setter传子，供Child清理期间调用已删除父的更新器。 */
      function Parent() {
        const [state, setState] = React.useState(false);
        Scheduler.log('Parent');
        return <Child setState={setState} state={state} />;
      }

      /** 返回父state并安装passive cleanup，在删除时记录后调用父setter(true)。 */
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

    /** Counter passive把props.count写入state；先提交(empty)，显式flushPassive只记录Schedule0，后冲刷才Count0；props1时同样先旧Count0再Count1。验证passive派发的普通更新仍由后续调度执行。 */
    it('updates have async priority', async () => {
      /** 初state为(empty)，passive按props.count派发替换更新并记录Schedule，输出state而非prop。 */
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

    /** 初挂(empty)的passive待执行时排transition props1；先旧effect派发0并渲染Count0，再transition commit和新effect派发1，最终Count1。验证提前冲刷passive不使新state更新进入原transition。 */
    it('updates have async priority even if effects are flushed early', async () => {
      /** 同样从(empty)开始，在passive依赖props.count变化时派发替换，观察提前冲刷与后续transition顺序。 */
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

    /** count0已提交但effect尚待执行，flushSync回调先setter2；act完成只断言Will set count to1及Count1，最终为1。验证较后入队的effect更新覆盖2，不扩大为所有flushSync都不冲刷passive。 */
    it('does not flush non-discrete passive effects when flushing sync', async () => {
      let _updateCount;
      /** 暴露count setter，初state0；一次passive固定写1，与flushSync提前排入的2形成覆盖顺序。 */
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
      // 先在flushSync回调排入2；随后旧passive派发1，本例最终断言1，不由标题推断普遍冲刷规则。
      await act(() => {
        ReactNoop.flushSync(() => {
          _updateCount(2);
        });
      });

      // 因此两项工作会以相反顺序提交。非离散工作本就不保证顺序，其中一项稍晚发生也会产生同样结果，所以这是允许的。
      assertLog(['Will set count to 1', 'Count: 1']);

      expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 1" />);
    });

    /** legacy根flushSync初挂(empty)，回调内尚无passive日志；act结束passive连续六次写count0，日志仅一次Count0。验证legacy passive延迟执行且其更新同批收敛。 */
    // @gate !disableLegacyMode
    it(
      'in legacy mode, useEffect is deferred and updates finish synchronously ' +
        '(in a single batch)',
      async () => {
        /** 初state(empty)，每次props.count变化的passive连续六次写同值，检测legacy批处理渲染次数。 */
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

          // 即使在 legacy 模式，回调内passive尚未执行；Noop检查点没有真实浏览器绘制。
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

    /** Counter passive内部调用flushSync(setter0)；DEV警告已在生命周期中，effect返回前宿主仍不是Count0，随后act完成才Count0。验证CommitContext阻止递归同步冲刷。 */
    it('flushSync is not allowed', async () => {
      /** passive内部调用flushSync更新state，并立即检查告警和宿主尚未更新；随后由外层调度完成。 */
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

    /** 无deps passive初挂count0后更新1；新passive阶段先Did destroy0再Did create1。验证上次cleanup先于同Hook新create。 */
    it('unmounts previous effect', async () => {
      /** 输出props.count，无deps passive记录create和闭包count的cleanup，每次提交重新安装。 */
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

    /** 无deps passive初挂count0后根render(null)，Did destroy0且最终null。验证删除执行已安装cleanup。 */
    it('unmounts on deletion', async () => {
      /** 输出props.count并安装无deps passive create/cleanup，供初挂后整树删除的清理验证。 */
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

    /** [] passive初挂count0，props更新1时无effect日志；删除仍Did destroy0，说明跳过更新不能抹掉原cleanup。 */
    it('unmounts on deletion after skipped effect', async () => {
      /** passive []保留初挂count闭包，后续props变化只更新Text，删除仍清理初次effect。 */
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

    /** 同一effect函数不传deps，两次render即使函数身份相同也destroy/create，删除再destroy。验证缺省deps每次提交都执行。 */
    it('always fires effects if no dependencies are provided', async () => {
      /** 记录 Effect 的 create 与 destroy，观察无依赖更新时的重复执行。 */
      function effect() {
        Scheduler.log(`Did create`);
        return () => {
          Scheduler.log(`Did destroy`);
        };
      }
      /** 把同一effect函数交给无deps useEffect，props.count仅用于宿主文本，函数身份不作为跳过条件。 */
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

    /** 依赖[label,count]初挂Count0，count1重建；相同Count1无effect，label改Total1再次重建。验证逐项Object.is比较而非渲染函数是否执行。 */
    it('skips effect if inputs have not changed', async () => {
      /** 拼接label/count输出，以[label,count]控制passive create/cleanup及相同依赖跳过。 */
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

    /** Counter连续注册两份无deps passive，count0/1各轮按Hook顺序Did commit1再2。验证单Fiber effect环的登记顺序。 */
    it('multiple effects', async () => {
      /** 按Hook顺序登记两份无deps passive日志，输出props.count以比较render与create阶段。 */
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

    /** 单Counter含A/B两份passive，更新0→1时先Unmount A0/B0，再Mount A1/B1。验证passive全清理遍先于全创建遍。 */
    it('unmounts all previous effects before creating any new ones', async () => {
      /** 按顺序登记A/B两份passive cleanup，count闭包记录旧清理与新创建，核对两阶段遍历。 */
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

    /** 两兄弟无key的Counter先A0/B0再A1/B1，后按位置换为B2/C0；各轮全部旧cleanup先于新create。最后只是同类型按slot更新label，不能因文本变化声称key删除/新挂载。 */
    it('unmounts all previous effects between siblings before creating any new ones', async () => {
      /** 每个slot输出label/count并安装无deps passive，测试按位置换label时旧闭包清理与新闭包创建。 */
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

    /** passive A成功安装、B create初挂即抛Oops，错误后根删除且只清理已安装A；最终null。验证未成功返回cleanup的B不会执行cleanup。 */
    it('handles errors in create on mount', async () => {
      /** A passive成功安装cleanup，B create记录Oops后必抛错，后面的B create/cleanup代码不可到达。 */
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

    /** count0的A/B都安装；更新count1时旧A/B cleanup、新A create后B create抛错；错误删除只清理新A，act拒绝Oops且根null。验证create错误恢复的已安装集合。 */
    it('handles errors in create on update', async () => {
      /** A/B passive正常初挂，B在新props.count1的create抛错，A先返回有效cleanup供错误删除使用。 */
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

    /** 更新count0→1时旧A cleanup抛错，仍清理旧B并create新A/B；错误导致根删除后清理新A/B，最终null。新A的Oops日志不会再抛（其闭包count1），验证cleanup错误不截断其他effect遍历。 */
    it('handles errors in destroy on update', async () => {
      /** A cleanup总记录Oops但只有闭包count0会抛错，B cleanup正常，观察捕获错误后遍历仍继续。 */
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

          // 被动阶段先遍历全部旧cleanup，再遍历新create；这里没有额外两阶段开关，cleanup错误也被捕获后继续遍历。
          assertLog([
            'Oops!',
            'Unmount B [0]',
            'Mount A [1]',
            'Mount B [1]',
            // 上方抛错导致 `<Counter>` 卸载；其余 Passive 清理稍后在卸载阶段执行，A再次记录Oops，但其新闭包count=1，不会再次抛错。
            'Oops!',
            'Unmount B [1]',
          ]);
        });
      }).rejects.toThrow('Oops error!');

      expect(ReactNoop).toMatchRenderedOutput(null);
    });

    /** 本例虽在useEffect组内，Counter实际安装useLayoutEffect并被memo包装；props count0→1清理重建layout，删除再cleanup。验证memo不会丢layout清理，不写成passive。 */
    it('works with memo', async () => {
      /** memo Counter实际安装无deps layout create/cleanup，props.count变化时记录更新与删除。 */
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
        /** 返回inner child并安装一次passive；cleanup记录后必抛Expected error，以检查最近仍挂载祖先。 */
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

        /** 保存cleanup错误并显示固定fallback，记录派生state/render/DidCatch的恢复顺序。 */
        ErrorBoundary = class extends React.Component {
          /** 保存cleanup错误；null表示正常透传children，非null进入固定fallback。 */
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
          /** 记录成功或错误分支；有error时固定fallback，否则透传children。 */
          render() {
            if (this.state.error) {
              Scheduler.log('ErrorBoundary render error');
              return <span prop="ErrorBoundary fallback" />;
            }
            Scheduler.log('ErrorBoundary render success');
            return this.props.children || null;
          }
        };

        /** 只记录DidCatch，不更新state；透传children，核对删除后仍挂载的外层捕获者。 */
        LogOnlyErrorBoundary = class extends React.Component {
          /** componentDidCatch 接收已提交错误；fixture 仅用其证明最近仍挂载边界被选中。 */
          componentDidCatch(error, info) {
            Scheduler.log(`LogOnlyErrorBoundary componentDidCatch`);
          }
          /** 只记录LogOnlyErrorBoundary render并透传children；DidCatch不改变渲染状态。 */
          render() {
            Scheduler.log(`LogOnlyErrorBoundary render`);
            return this.props.children || null;
          }
        };
      });

      /** LogOnlyErrorBoundary保留自身但删除Broken子，passive cleanup抛错后由仍挂载外边界DidCatch记录。无派生statefallback，验证nearestMountedAncestor。 */
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

      /** 删除Conditional下ErrorBoundary与Broken子，同时外LogOnly保留；cleanup错误跳过已删除内边界，日志仅外DidCatch。验证删除树的return不能选中已卸载边界。 */
      it('should skip unmounted boundaries and use the nearest still-mounted boundary', async () => {
        /** 按 showChildren 删除包含 cleanup 错误的边界子树，检查错误应交给仍挂载的祖先。 */
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

      /** ErrorBoundary保留且Conditional只删除Broken子；cleanup错误触发其getDerivedStateFromError、错误render和DidCatch，最终ErrorBoundary fallback。验证最近仍挂载边界可更新state恢复。 */
      it('should call getDerivedStateFromError in the nearest still-mounted boundary', async () => {
        /** 按 showChildren 删除会在 passive cleanup 中抛错的子组件。 */
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

      /** Conditional连同内部ErrorBoundary一起删除Broken，外部无边界；waitForThrow匹配Expected error，输出null且只cleanup日志。验证已删边界不能吞错，错误上报根。 */
      it('should rethrow error if there are no still-mounted boundaries', async () => {
        /** 删除内层 ErrorBoundary 与抛错 cleanup，检查不能由已删除边界接住错误。 */
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

    /** MemoizedChild有layout/passive []：key1相同props先bailout，换key2才旧cleanup和新create，删除根再次清理。验证memo跳过之后静态effect标记仍保留。 */
    it('calls passive effect destroy functions for memoized components', async () => {
      /** 只透传children，提供memo组件外的稳定包装层，不持有更新器。 */
      const Wrapper = ({children}) => children;
      /** 本节点同时安装layout/passive []并记录render，供memo bailout后key替换与删除清理。 */
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

      /** 仅比较prop字段相等；本体不记录日志，两次未传prop均undefined故可bailout。 */
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

    /** 同上但effects在MemoizedChild的Grandchild后代；key1 bailout、key2替换、删除均有完整后代cleanup。验证静态子树标记穿透memo复用。 */
    it('calls passive effect destroy functions for descendants of memoized components', async () => {
      /** 只透传children，提供memo组件外的稳定包装层，不持有更新器。 */
      const Wrapper = ({children}) => children;
      /** 只返回Grandchild，没有本节点effects；memo包装在这一层，清理探针在后代。 */
      function Child() {
        return <Grandchild />;
      }

      /** 记录 layout/passive 创建与清理，检查 memo bailout 后静态清理信息仍保留。 */
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

      /** 仅比较prop字段相等；本体不记录日志，两次未传prop均undefined故可bailout。 */
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

    /** 三个根passive分别返回17/null/Promise，开发态给不同协议警告；删除Promise根时waitForThrow匹配is not a function。验证create返回值是cleanup协议，不自动等待Promise。 */
    it('assumes passive effect destroy function is either a function or undefined', async () => {
      /** passive create原样返回props.return，制造数字/null/Promise等违反cleanup协议的值。 */
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
    /** Insertion的CounterA与有snapshot的类CounterB并列；更新日志Get Snapshot→Destroy insertion→Create insertion，删除仅destroy。验证snapshot的before-mutation顺序先于insertion mutation。 */
    it('fires insertion effects after snapshots on update', async () => {
      /** 只安装无deps insertion create/cleanup并返回null，与类兄弟的snapshot比较顺序。 */
      function CounterA(props) {
        useInsertionEffect(() => {
          Scheduler.log(`Create insertion`);
          return () => {
            Scheduler.log(`Destroy insertion`);
          };
        });
        return null;
      }

      /** 空输出的class兄弟，只通过getSnapshotBeforeUpdate标记before-mutation检查点。 */
      class CounterB extends React.Component {
        /** CounterB.getSnapshotBeforeUpdate 在宿主突变前记录快照，用于与 Insertion/Layout Effect 排序比较。 */
        getSnapshotBeforeUpdate(prevProps, prevState) {
          Scheduler.log(`Get Snapshot`);
          return null;
        }

        /** 配合getSnapshotBeforeUpdate提供所需更新生命周期，本体空实现且不记录日志。 */
        componentDidUpdate() {}

        /** 固定返回null，没有宿主输出，以snapshot日志作为唯一类阶段观察。 */
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

    /** insertion先写共享committedText0，layout和passive随后均看到0；删除时insertion/layout先清理，passive在act余下阶段清理。验证layout create读取insertion产物。 */
    it('fires insertion effects before layout effects', async () => {
      let committedText = '(empty)';

      /** insertion写共享committedText，layout/passive只读取日志；没有宿主节点或本地state。 */
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

    /** transition count0已commit insertion/layout但passive未执行时排count1；先旧passive create0，再新insertion/layout，最后passive destroy/create均观察共享值1。enableYieldingBeforePassive只改变paint检查点，不能改变此顺序。 */
    it('force flushes passive effects before firing new insertion effects', async () => {
      let committedText = '(empty)';

      /** insertion与layout都写共享committedText，passive只读取，供旧passive与下一次insertion的顺序核对。 */
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

    /** A/B各两份insertion和layout，初挂所有insertion create先于layout create；更新按Fiber交错旧insertion cleanup/newcreate/layoutcleanup，全部完成后才layoutcreate；删除也按Fiber清理。验证insertion不是全树先清理再创建。 */
    it('fires all insertion effects (interleaved) before firing any layout effects', async () => {
      let committedA = '(empty)';
      let committedB = '(empty)';

      /** A节点登记两份insertion并写committedA，两份layout读取A/B，观察每Fiber mutation遍历交错。 */
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

      /** B节点登记两份insertion并写committedB，两份layout读取A/B，观察全树layout创建前的状态。 */
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

    /** 三个根insertion分别返回17/null/Promise，有具体DEV警告；删除Promise根报is not a function。验证insertion cleanup协议与passive一致但发生于mutation。 */
    it('assumes insertion effect destroy function is either a function or undefined', async () => {
      /** insertion create原样返回props.return，制造错误cleanup协议值并在mutation阶段观察诊断。 */
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

    /** insertion setup先setX1产生DEV禁更新警告，再props.throw使setup抛No；随后普通passive的NotInsertion setX1无同类告警。验证insertion执行标记在异常后复位。 */
    it('warns when setState is called from insertion effect setup', async () => {
      /** insertion setup先setX1，throw prop可使同一setup抛No，用于检查异常后insertion标记清理。 */
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
      /** 在普通 passive Effect 中更新 state，确认此前 insertion Effect 抛错没有残留阶段标记。 */
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

    /** insertion依赖foo/throw，foo hello→goodbye触发旧cleanup setX1并警告；随后setup抛No，再普通passive更新无残留insertion告警。错误发生在setup，cleanup自身只更新state。 */
    it('warns when setState is called from insertion effect cleanup', async () => {
      /** insertion setup可依throw抛No；正常返回的cleanup调用setX1，依foo变化触发禁更新诊断。 */
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
      /** 在普通 passive Effect 中更新 state，确认此前 insertion cleanup 抛错后阶段标记已恢复。 */
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

    /** Activity hidden下App安装insertion，随后删除该子时cleanup setX1产生DEV禁更新警告；再普通passive更新无此警告。没有props.throw=true，本例没有cleanup抛错。 */
    it('warns when setState is called from offscreen deleted insertion effect cleanup', async () => {
      /** 隐藏Activity下仍安装insertion cleanup，删除此节点时调用setX1；throw分支本例没有触发。 */
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

      // 隐藏子删除后执行普通Effect不应产生同类告警。
      /** 在普通passive中setX1，检查隐藏子删除后insertion执行标记没有残留。 */
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
    /** layout读取ReactNoop已提交span文本，props count0→1分别Current0/Current1且根callback在后。验证宿主mutation完成后才运行layout。 */
    it('fires layout effects after the host has been mutated', async () => {
      /** 从已提交宿主节点读取文本，供 Effect 阶段检查突变可见性。 */
      function getCommittedText() {
        const yields = Scheduler.unstable_clearLog();
        const children = ReactNoop.getChildrenAsJSX();
        Scheduler.log(yields);
        if (children === null) {
          return null;
        }
        return children.props.prop;
      }

      /** 输出props.count，在layout中读取已提交宿主文本；读取器还把之前render日志封装为数组。 */
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

    /** layout写共享committedText；count0已layout提交后立刻排1，先旧passive Mount normal0，再layoutcleanup0/create1；最后passivecleanup/create都观察共享1。验证旧passive先于下一次layout。 */
    it('force flushes passive effects before firing new layout effects', async () => {
      let committedText = '(empty)';

      /** layout将props.count写入共享committedText并记录cleanup，passive观察共享值，比较前后两次提交。 */
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

    /** 外/内错误边界下layout cleanup会抛Expected；更新删除内边界及Broken但保留外边界/兄弟，错误由外getDerived捕获并输出OuterFallback。验证跳过正在删除的layout错误边界。 */
    it('catches errors thrown in useLayoutEffect', async () => {
      /** 以派生error state接住layout删除错误，按id/fallbackID区分仍挂载的外边界与已删内边界。 */
      class ErrorBoundary extends React.Component {
        /** 保存捕获错误；error非null时显示由fallbackID指定的Component。 */
        state = {error: null};
        /** ErrorBoundary.getDerivedStateFromError 把捕获错误转换为稳定的边界回退状态。 */
        static getDerivedStateFromError(error) {
          Scheduler.log(`ErrorBoundary static getDerivedStateFromError`);
          return {error};
        }
        /** 根据error选择fallbackID组件或children，用id区分内外边界的成功/错误日志。 */
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

      /** 记录组件 render 并输出 id，观察错误恢复后的宿主内容。 */
      function Component({id}) {
        Scheduler.log('Component render ' + id);
        return <span prop={id} />;
      }

      /** 登记必定抛错的 layout cleanup，检查删除时向最近仍挂载边界报告。 */
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

    /** 三个根layout分别返回17/null/Promise，有不同DEV协议警告；删除Promise根时is not a function。验证layout create必须同步返回可调用cleanup或undefined。 */
    it('assumes layout effect destroy function is either a function or undefined', async () => {
      /** layout create原样返回props.return，覆盖不同非法cleanup值及删除调用错误。 */
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
    /** useCallback依赖incrementBy，Pure按钮初挂渲染；state递增0→1时回调相同所以按钮跳过，incrementBy改10使按钮重渲染，旧ref方法调用新props回调后count11。验证闭包与依赖更新。 */
    it('memoizes callback by comparing inputs', async () => {
      /** PureComponent按钮，props.increment的函数身份决定是否重复输出Increment。 */
      class IncrementButton extends React.PureComponent {
        /** 调用当前props.increment，通过实例方法观察useCallback更新后的闭包。 */
        increment = () => {
          this.props.increment();
        };
        /** 固定输出Increment日志文本；PureComponent是否调用此方法暴露useCallback引用变化。 */
        render() {
          return <Text text="Increment" />;
        }
      }

      /** count state配合依赖incrementBy的useCallback，把稳定函数交Pure按钮；函数式更新读取最新state。 */
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
    /** useMemo依赖text，hello→hi计算大写，重复hi只输出HI不再Capitalize，goodbye重新计算。验证同deps缓存计算结果但Text仍可render。 */
    it('memoizes value by comparing to previous inputs', async () => {
      /** 按 text 缓存大写转换，记录计算次数以检查 useMemo 命中与失效。 */
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

    /** LazyCompute不传deps，同computeA连续三次都执行并输出A，换computeB执行B。验证缓存依赖缺省时不按函数引用bailout。 */
    it('always re-computes if no inputs are provided', async () => {
      /** 不传依赖数组，每次 render 调用 props.compute。 */
      function LazyCompute(props) {
        const computed = useMemo(props.compute);
        return <Text text={computed} />;
      }

      /** 记录 compute A 并返回 A，供计算函数切换测试使用。 */
      function computeA() {
        Scheduler.log('compute A');
        return 'A';
      }

      /** 记录 compute B 并返回 B，供计算函数切换测试使用。 */
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

    /** LazyCompute在render-phase count0→3循环中memo[input]；初挂A计算一次，重复A不计算，换B计算一次。验证re-render复用memo槽位而非每个pass重复调用。 */
    it('should not invoke memoized function during re-renders unless inputs change', async () => {
      /** 按 input 缓存计算值，同时用 render-phase state 更新重跑组件，检查 memo 值复用。 */
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

      /** 记录输入并原样返回，暴露 useMemo 计算次数。 */
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
    /** useImperativeHandle []暴露count/dispatch，内部reducer0→1后宿主Count1但ref.current.count仍0。验证固定deps保留初次闭包，不随state自动更新。 */
    it('does not update when deps are the same', async () => {
      const INCREMENT = 'INCREMENT';

      /** increment action加1，其余action原样返回state；由render阶段调用。 */
      function reducer(state, action) {
        return action === INCREMENT ? state + 1 : state;
      }

      /** reducer维护count，imperative handle []暴露初次count与稳定dispatch，后续state不会刷新对象。 */
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
    /** useImperativeHandle省略deps，reducer0→1后宿主与ref.current.count都1。验证每次提交重建命令对象。 */
    it('automatically updates when deps are not specified', async () => {
      const INCREMENT = 'INCREMENT';

      /** increment action加1，其余action原样返回state；由render阶段调用。 */
      function reducer(state, action) {
        return action === INCREMENT ? state + 1 : state;
      }

      /** reducer维护count，imperative handle省略deps，每次layout提交更新命令对象的count快照。 */
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

    /** useImperativeHandle [count]的create计数初挂1、递增后2；再相同ref/props根渲染Count1也不增。验证依赖变化与ref身份都参与layout effect条件。 */
    it('updates when deps are different', async () => {
      const INCREMENT = 'INCREMENT';

      /** increment action加1，其余action原样返回state；由render阶段调用。 */
      function reducer(state, action) {
        return action === INCREMENT ? state + 1 : state;
      }

      let totalRefUpdates = 0;
      /** imperative handle依赖[count]，每次create增加totalRefUpdates并返回count/dispatch，供命中条件核对。 */
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
    /** 已有Before/Pending false，本地transition打开待决After；先Before/Pending true，推进500再100000ms仍保持它，解析After后After/Pending false。标题的timeout不表示当前实现会超时显示Loading。 */
    it('delays showing loading state until after timeout', async () => {
      let transition;
      /** 本地transition切show为true，isPending拼入旧主内容、新资源键和fallback，用各分支日志区分紧急与延后工作。 */
      function App() {
        const [show, setShow] = useState(false);
        const [isPending, startTransition] = useTransition();
        /** 用本地transition打开show，紧急pending更新与挂起主内容分别推进。 */
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
    /** 外text A与deferredText异步A先Loading再AA；普通setterB先显示B/A，后台B挂起即使250和100000ms也不显示Loading，B解析后BB。验证非紧急deferred重试保留旧值，不固定超时时长。 */
    it('defers text value', async () => {
      /** 把 text 交给 AsyncText，作为 deferred value 的可挂起输出。 */
      function TextBox({text}) {
        return <AsyncText text={text} />;
      }

      let _setText;
      /** 保存text并暴露setter，同步Text显示最新值，边界内Async TextBox读取useDeferredValue的旧/新值。 */
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
    /** App已有A/B两个state并更新为2/3；loadC=true动态多读一个useState，抛Rendered more hooks并有DEV次序表。验证不支持动态追加Hook，注释掉的未来输出不执行。 */
    it('mount additional state', async () => {
      let updateA;
      let updateB;
      // let updateC;

      /** A/B固定state，loadC为真额外调用第三useState但不保存其结果，故制造非法Hook列表增长。 */
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

    /** App已有A/B/C三个state并更新2/3/4；loadC=false省略第三Hook，抛Rendered fewer hooks。验证不支持动态删除state槽，不当作合法卸载。 */
    it('unmount state', async () => {
      let updateA;
      let updateB;
      let updateC;

      /** A/B固定state，loadC控制是否读取并暴露第三C槽，故从true到false制造非法Hook列表缩短。 */
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

    /** App先仅passive A挂载，showMore=true多注册B，抛Rendered more hooks、DEV次序表，错误删除原A导致Unmount A。验证不是合法按条件新增effect，后半注释代码未执行。 */
    it('unmount effects', async () => {
      /** 固定passive A，showMore控制额外注册B的条件Hook，刻意触发more-hooks错误及原树清理。 */
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

  /** Component reducer捕获当前props.count，passive dispatch；初挂state-1→1，父state改2时先旧Render1再Effect2/Reducer2/Render2，输出按props为2。验证dispatchReducerAction不预计算旧reducer造成eager bailout。 */
  it('useReducer does not eagerly bail out of state updates', async () => {
    // 根据缺陷报告构造的边界场景。
    let setCounter;
    /** 父counter从1开始并暴露setter，传给Component的reducer闭包，观察非eager reducer处理。 */
    function App() {
      const [counter, _setCounter] = useState(1);
      setCounter = _setCounter;
      return <Component count={counter} />;
    }

    /** 在 Effect 中派发 reducer action；render 使用捕获最新 count 的 reducer。 */
    function Component({count}) {
      const [state, dispatch] = useReducer(() => {
        // reducer 捕获本轮 count；dispatchReducerAction 不预计算状态，render 才调用当前 reducer，避免在旧 props 上把 action 提前当作无变化。
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

  /** disabled是Counter自身state，true时三次increment本轮reducer均no-op且仍render0；随后单独disabled=false不重放旧actions，仍0。验证已处理队列项不会因reducer闭包改变重新生效。 */
  it('useReducer does not replay previous no-op actions when other state changes', async () => {
    let increment;
    let setDisabled;

    /** disabled与count分别用state/reducer保存；reducer捕获当前disabled，true时所有increment返回原state。 */
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

      /** 只排入increment action，disabled是否阻止递增由render时当前reducer决定。 */
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

  /** disabled来自父props，true时三increment触发子render0；之后父独立改false，子仍0。验证已消费no-op action不会因为props捕获变化再重放。 */
  it('useReducer does not replay previous no-op actions when props change', async () => {
    let setDisabled;
    let increment;

    /** reducer捕获props.disabled，只有未禁用的increment才加1，dispatch不预计算该闭包。 */
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

      /** 只排入increment action，disabled是否阻止递增由render时当前reducer决定。 */
      increment = () => dispatch({type: 'increment'});

      Scheduler.log('Render count: ' + count);
      return count;
    }

    /** 父disabled初始true并暴露setter，记录父render，props驱动子reducer闭包切换。 */
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

  /** 父disabled初始true，同一act先increment再setDisabled(false)；父先以false更新子props，子当前reducer处理action为1。验证潜在no-op未被dispatch阶段丢弃，与已消费action分开。 */
  it('useReducer applies potential no-op changes if made relevant by other updates in the batch', async () => {
    let setDisabled;
    let increment;

    /** reducer捕获props.disabled并在render时处理increment，与父同批启用更新组合。 */
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

      /** 只排入increment action，disabled是否阻止递增由render时当前reducer决定。 */
      increment = () => dispatch({type: 'increment'});

      Scheduler.log('Render count: ' + count);
      return count;
    }

    /** 父disabled state与子increment队列分别持有更新，同批父render把false传给子。 */
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
  /** 兄弟A/B初值0；同批A1、B1再B0，两个函数都render但只有A effect commit。验证B最终state相等时清除本Fiber effect执行标记，不继承A的didReceiveUpdate。 */
  it('state bail out edge case (#16359)', async () => {
    let setCounterA;
    let setCounterB;

    /** 保存A的counter和setter，分别记录render与无deps passive，作为真实state变化的兄弟。 */
    function CounterA() {
      const [counter, setCounter] = useState(0);
      setCounterA = setCounter;
      Scheduler.log('Render A: ' + counter);
      useEffect(() => {
        Scheduler.log('Commit A: ' + counter);
      });
      return counter;
    }

    /** 保存B的counter和setter，分别记录render/passive，最终state相等时effect应被bailout跳过。 */
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

  /** 前置step state在render0→5，后置reducer shadow一直0；render结束后dispatch使用最新捕获step5的reducer得到shadow5。验证re-render更新lastRenderedReducer即使当时无action。 */
  it('should update latest rendered reducer when a preceding state receives a render phase update', async () => {
    // 与上一用例类似，但改用前置渲染阶段更新，而非新 props。
    let dispatch;
    /** 前置step render-phase递增到5，后置reducer每次捕获当前step并暴露dispatch，shadow仅由action更新。 */
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

  /** A/B/C初始false；同批普通A/C=true，render中setB(A)镜像前置变化，最终ABC。验证render-phase重跑仍处理后置C的普通pending更新。 */
  it('should process the rest pending updates after a render phase update', async () => {
    // 与上一用例类似，但改用前置渲染阶段更新，而非新 props。
    let updateA;
    let updateC;
    /** 三个state槽中B在render镜像A，C位于其后且有独立pending更新，输出大小写反映最终状态。 */
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

  /** keyed A/B各有layout/passive [label]，删除A只清理A，后删除根才清理B。验证删除遍历不越过deleted子树到其保留兄弟。 */
  it("regression test: don't unmount effects on siblings of deleted nodes", async () => {
    const root = ReactNoop.createRoot();

    /** 输出label并安装[label]的layout/passive cleanup，供只删除A而保留B的边界核对。 */
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

  /** keyed A/B先挂载passive，重排B/A无effect日志，删除根依新树顺序Unmount B/A。验证重排复用后静态passive标记仍存在。 */
  it('regression: deleting a tree and unmounting its effects after a reorder', async () => {
    const root = ReactNoop.createRoot();

    /** 输出label并安装[label]的passive cleanup，供keyed重排后整树删除的顺序验证。 */
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

  /** SuspenseList together两Row均异步挂起但Row的passive已挂载；只解析A会retry A/B，随后删除根两份cleanup都执行。验证列表第二遍协调不丢Row的静态effect信息。 */
  // @gate enableSuspenseList
  it('regression: SuspenseList causes unmounts to be dropped on deletion', async () => {
    /** 把 label 的 Effect 与异步文本放入一行，检查 SuspenseList 重试后删除仍执行 cleanup。 */
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

    /** 用together列表组合Row A/B，Row自己安装effect且后代边界读资源，retry不能丢Row的清理标记。 */
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

  /** count0 effect依赖[count]已执行；handleClick设2后render-phase立刻归0，连续三轮都只Render0、无Effect0重跑。验证re-render保存最终deps与上次已提交deps比较，不沿中间count2误标执行。 */
  it('effect dependencies are persisted after a render phase update', async () => {
    let handleClick;
    /** 在 Effect 与 render-phase 更新交错时维护 count，检查提交后状态不会被前一 pass 覆盖。 */
    function Test() {
      const [count, setCount] = useState(0);

      useEffect(() => {
        Scheduler.log(`Effect: ${count}`);
      }, [count]);

      if (count > 0) {
        setCount(0);
      }

      /** 普通事件更新先把count设2，下一次render内部再归0，以检查最终effect依赖。 */
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
