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
let ReactNoop;
let Suspense;
let Scheduler;
let act;
let waitForAll;
let assertLog;
let assertConsoleErrorDev;

/** 覆盖 memo 的 props/context bailout、Fiber 形态一致性、更新 lane 保留及组件栈命名。 */
describe('memo', () => {
  /** 重置 ReactNoop、Suspense、Scheduler 与控制台断言，隔离 normal/lazy 共享用例。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    ({Suspense} = React);

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    assertLog = InternalTestUtils.assertLog;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;
  });

  /** 记录并渲染 span prop，作为 memo 是否真正重渲染的探针。 */
  function Text(props) {
    Scheduler.log(props.text);
    return <span prop={props.text} />;
  }

  /** 把给定组件包装成 lazy loader 所需的 default module 形状。 */
  async function fakeImport(result) {
    return {default: result};
  }

  // 同一组测试同时覆盖 lazy 与非 lazy 形式的 memo。
  // 为统一两种路径，normal 版本额外包一层
  // lazy 函数组件。
  sharedTests('normal', (...args) => {
    const Memo = React.memo(...args);
    /** normal 组额外包裹 Memo，使其也通过 lazy resolution 进入共享断言。 */
    function Indirection(props) {
      return <Memo {...props} />;
    }
    return React.lazy(() => fakeImport(Indirection));
  });
  sharedTests('lazy', (...args) => {
    const Memo = React.memo(...args);
    return React.lazy(() => fakeImport(Memo));
  });

  /** 为 normal/lazy 两种 memo 工厂注册同一套语义测试，避免实现路径出现漂移。 */
  function sharedTests(label, memo) {
    /** 当前 label 对应一种 memo 构造路径；内部断言会被两种路径各执行一次。 */
    describe(`${label}`, () => {
      /** Given–When–Then：Given memo Counter 初次 count=0；When以相同 props 重渲染，再改为 count=1；Then相同 props 不执行 Text，变化后才更新为 1。通过 Scheduler 日志和输出验证浅比较 bailout。 */
      it('bails out on props equality', async () => {
        /** 把 count 交给 Text，直接暴露 memo props 比较是否执行 render。 */
        function Counter({count}) {
          return <Text text={count} />;
        }
        Counter = memo(Counter);

        await act(() =>
          ReactNoop.render(
            <Suspense fallback={<Text text="Loading..." />}>
              <Counter count={0} />
            </Suspense>,
          ),
        );
        assertLog(['Loading...', 0]);
        expect(ReactNoop).toMatchRenderedOutput(<span prop={0} />);

        // props 未变化，应 bailout。
        ReactNoop.render(
          <Suspense>
            <Counter count={0} />
          </Suspense>,
        );
        await waitForAll([]);
        expect(ReactNoop).toMatchRenderedOutput(<span prop={0} />);

        // count prop 变化，应重新渲染。
        ReactNoop.render(
          <Suspense>
            <Counter count={1} />
          </Suspense>,
        );
        await waitForAll([1]);
        expect(ReactNoop).toMatchRenderedOutput(<span prop={1} />);
      });

      /** Given–When–Then：Given memo Counter 的 label props 不变但 CountContext 从 0 变 1；When Parent setState；Then props 相等也必须重渲染 Count:1。通过日志验证 context dependency 会穿透 memo bailout。 */
      it("does not bail out if there's a context change", async () => {
        const CountContext = React.createContext(0);

        /** 通过当前 dispatcher 读取 context，刻意覆盖 memo Fiber 的底层依赖追踪。 */
        function readContext(Context) {
          const dispatcher =
            React
              .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
              .H;
          return dispatcher.readContext(Context);
        }

        /** 读取 CountContext 并组合稳定 label，验证 context 依赖阻止错误 bailout。 */
        function Counter(props) {
          const count = readContext(CountContext);
          return <Text text={`${props.label}: ${count}`} />;
        }
        Counter = memo(Counter);

        /** 持有 context count，并以固定 Counter props 驱动纯 context 更新。 */
        class Parent extends React.Component {
          /** Provider 当前 count；从 0 更新为 1。 */
          state = {count: 0};
          /** 提供当前 context 值，并保持 Counter label 不变。 */
          render() {
            return (
              <Suspense fallback={<Text text="Loading..." />}>
                <CountContext.Provider value={this.state.count}>
                  <Counter label="Count" />
                </CountContext.Provider>
              </Suspense>
            );
          }
        }

        const parent = React.createRef(null);
        await act(() => ReactNoop.render(<Parent ref={parent} />));
        assertLog(['Loading...', 'Count: 0']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);

        // props 未变化，应 bailout。
        ReactNoop.render(<Parent ref={parent} />);
        await waitForAll([]);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 0" />);

        // context 变化，即使 props 相同也应更新。
        parent.current.setState({count: 1});
        await waitForAll(['Count: 1']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Count: 1" />);
      });

      /** Given–When–Then：Given SimpleMemo、forwardRef Memo 与带 Indirection Memo 接收相同 prop；When依次改变 prop、相同 prop bailout、再与本地 state 同批更新；Then三种 Fiber 布局对 props 对象复用行为一致。通过 useRef 身份日志验证 MemoComponent/SimpleMemoComponent 等价。 */
      it('consistent behavior for reusing props object across different function component types', async () => {
        // 此用例涉及实现细节：当无法 bailout 时，
        // React 并不强保证更新期间 props
        // 对象引用保持相等，例如浅相等 props
        // 与本地 state/context 更新
        // 同批发生的情况。
        //
        // 但不同 memo 包装形式应保持行为一致。
        // 普通函数会形成 SimpleMemoComponent，
        // forwardRef 等类型会形成 MemoComponent；
        // 这是内部 Fiber 布局差异，
        // 不应影响 props 对象在 bailout
        // 与重基线中的复用。
        //
        // 因而本测试不规定唯一的 props 身份策略，
        // 只要求各种 memo 形态
        // 保持一致。

        const {useEffect, useState} = React;

        let setSimpleMemoStep;
        /** 直接 memo 普通函数；记录 props 身份并持有本地 step。 */
        const SimpleMemo = React.memo(props => {
          const [step, setStep] = useState(0);
          setSimpleMemoStep = setStep;

          const prevProps = React.useRef(props);
          useEffect(() => {
            if (props !== prevProps.current) {
              prevProps.current = props;
              Scheduler.log('Props changed [SimpleMemo]');
            }
          }, [props]);

          return <Text text={`SimpleMemo [${props.prop}${step}]`} />;
        });

        let setComplexMemo;
        /** memo(forwardRef) 形成复杂 MemoComponent，用相同探针与 simple 路径对照。 */
        const ComplexMemo = React.memo(
          React.forwardRef((props, ref) => {
            const [step, setStep] = useState(0);
            setComplexMemo = setStep;

            const prevProps = React.useRef(props);
            useEffect(() => {
              if (props !== prevProps.current) {
                prevProps.current = props;
                Scheduler.log('Props changed [ComplexMemo]');
              }
            }, [props]);

            return <Text text={`ComplexMemo [${props.prop}${step}]`} />;
          }),
        );

        let setMemoWithIndirectionStep;
        /** memo 外层仅转交 props 给 Indirection，分离 bailout Fiber 与本地 state Fiber。 */
        const MemoWithIndirection = React.memo(props => {
          return <Indirection props={props} />;
        });
        /** 接收外层原 props 对象并追踪其身份，同时持有独立 step。 */
        function Indirection({props}) {
          const [step, setStep] = useState(0);
          setMemoWithIndirectionStep = setStep;

          const prevProps = React.useRef(props);
          useEffect(() => {
            if (props !== prevProps.current) {
              prevProps.current = props;
              Scheduler.log('Props changed [MemoWithIndirection]');
            }
          }, [props]);

          return <Text text={`MemoWithIndirection [${props.prop}${step}]`} />;
        }

        /** 同步推进三种 memo 形态的本地 state，制造父 props bailout 与 child lane 并存。 */
        function setLocalUpdateOnChildren(step) {
          setSimpleMemoStep(step);
          setMemoWithIndirectionStep(step);
          setComplexMemo(step);
        }

        /** 以同一 prop 值并列渲染三种 memo 形态，保证批次输入完全一致。 */
        function App({prop}) {
          return (
            <>
              <SimpleMemo prop={prop} />
              <ComplexMemo prop={prop} />
              <MemoWithIndirection prop={prop} />
            </>
          );
        }

        const root = ReactNoop.createRoot();
        await act(() => {
          root.render(<App prop="A" />);
        });
        assertLog([
          'SimpleMemo [A0]',
          'ComplexMemo [A0]',
          'MemoWithIndirection [A0]',
        ]);

        // 先改变 prop，三种组件都应观察到新对象。
        await act(() => {
          root.render(<App prop="B" />);
        });
        assertLog([
          'SimpleMemo [B0]',
          'ComplexMemo [B0]',
          'MemoWithIndirection [B0]',
          'Props changed [SimpleMemo]',
          'Props changed [ComplexMemo]',
          'Props changed [MemoWithIndirection]',
        ]);

        // 随后父级创建新 props 对象，但各字段相同，
        // 应因浅比较相等而 bailout。
        await act(() => {
          root.render(<App prop="B" />);
        });
        // 没有组件重新渲染。
        assertLog([]);

        // 再让父级 props 仍浅相等，同时同批加入
        // 本地 state 更新；memo 本身 bailout，
        // 但有 child lane 的组件仍需渲染。
        await act(() => {
          root.render(<App prop="B" />);
          setLocalUpdateOnChildren(1);
        });
        // 三个组件应以新本地 state 渲染，
        // 且 props 对象身份都不应变化。
        assertLog([
          'SimpleMemo [B1]',
          'ComplexMemo [B1]',
          'MemoWithIndirection [B1]',
        ]);

        // 再重复一次，仍应复用 props 对象。
        await act(() => {
          root.render(<App prop="B" />);
          setLocalUpdateOnChildren(2);
        });
        // 三个组件应以新本地 state 渲染，
        // 且 props 对象身份都不应变化。
        assertLog([
          'SimpleMemo [B2]',
          'ComplexMemo [B2]',
          'MemoWithIndirection [B2]',
        ]);
      });

      /** Given–When–Then：Given memo Counter 使用 count 自定义比较器；When相同 count 后再改为 1；Then比较器两次记录 old/new，相同时 bailout、变化时渲染。通过比较日志与输出验证 compare 返回值语义。 */
      it('accepts custom comparison function', async () => {
        /** 把 count 交给 Text，直接暴露 memo props 比较是否执行 render。 */
        function Counter({count}) {
          return <Text text={count} />;
        }
        Counter = memo(Counter, (oldProps, newProps) => {
          Scheduler.log(
            `Old count: ${oldProps.count}, New count: ${newProps.count}`,
          );
          return oldProps.count === newProps.count;
        });

        await act(() =>
          ReactNoop.render(
            <Suspense fallback={<Text text="Loading..." />}>
              <Counter count={0} />
            </Suspense>,
          ),
        );
        assertLog(['Loading...', 0]);
        expect(ReactNoop).toMatchRenderedOutput(<span prop={0} />);

        // props 未变化，应 bailout。
        ReactNoop.render(
          <Suspense>
            <Counter count={0} />
          </Suspense>,
        );
        await waitForAll(['Old count: 0, New count: 0']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop={0} />);

        // count prop 变化，应重新渲染。
        ReactNoop.render(
          <Suspense>
            <Counter count={1} />
          </Suspense>,
        );
        await waitForAll(['Old count: 0, New count: 1', 1]);
        expect(ReactNoop).toMatchRenderedOutput(<span prop={1} />);
      });

      /** Given–When–Then：Given非 PureComponent 的 CounterInner 包装为 memo 且有 defaultProps；When相同 props 后再改变 count；Then memo 仍负责 bailout，并在变化时保留默认 suffix。通过 0!/1! 输出验证类组件支持。 */
      it('supports non-pure class components', async () => {
        /** 非 PureComponent 类，通过外层 memo 获得 props bailout。 */
        class CounterInner extends React.Component {
          /** 缺省 suffix，验证 memo 包装后仍完成 defaultProps 解析。 */
          static defaultProps = {suffix: '!'};
          /** 将 count 与默认 suffix 组合后交给 Text。 */
          render() {
            return <Text text={this.props.count + String(this.props.suffix)} />;
          }
        }
        const Counter = memo(CounterInner);

        await act(() =>
          ReactNoop.render(
            <Suspense fallback={<Text text="Loading..." />}>
              <Counter count={0} />
            </Suspense>,
          ),
        );
        assertLog(['Loading...', '0!']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="0!" />);

        // props 未变化，应 bailout。
        ReactNoop.render(
          <Suspense>
            <Counter count={0} />
          </Suspense>,
        );
        await waitForAll([]);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="0!" />);

        // count prop 变化，应重新渲染。
        ReactNoop.render(
          <Suspense>
            <Counter count={1} />
          </Suspense>,
        );
        await waitForAll(['1!']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="1!" />);
      });

      /** Given–When–Then：Given memo 未传组件；When创建 wrapper；Then开发模式报告收到 undefined。通过精确控制台消息验证输入类型检查。 */
      it('warns if the first argument is undefined', () => {
        memo();
        assertConsoleErrorDev([
          'memo: The first argument must be a component. Instead ' +
            'received: undefined',
        ]);
      });

      /** Given–When–Then：Given memo 传入 null；When创建 wrapper；Then开发模式报告收到 null。通过精确控制台消息验证输入类型检查。 */
      it('warns if the first argument is null', () => {
        memo(null);
        assertConsoleErrorDev([
          'memo: The first argument must be a component. Instead ' +
            'received: null',
        ]);
      });

      /** Given–When–Then：Given memo Hook state 安排普通更新 1，同时高优先级 root render 的 props 相等而 bailout；When同一 act 冲刷；Then低优先级 state 仍提交为 1。通过输出验证 bailout 不会丢弃 child lanes。 */
      it('does not drop lower priority state updates when bailing out at higher pri (simple)', async () => {
        const {useState} = React;

        let setCounter;
        const Counter = memo(() => {
          const [counter, _setCounter] = useState(0);
          setCounter = _setCounter;
          return counter;
        });

        /** 用 Suspense 包裹 Counter；父级重渲染可在高优先级检查 memo bailout。 */
        function App() {
          return (
            <Suspense fallback="Loading...">
              <Counter />
            </Suspense>
          );
        }

        const root = ReactNoop.createRoot();
        await act(() => {
          root.render(<App />);
        });
        expect(root).toMatchRenderedOutput('0');

        await act(() => {
          setCounter(1);
          ReactNoop.discreteUpdates(() => {
            root.render(<App />);
          });
        });
        expect(root).toMatchRenderedOutput('1');
      });

      /** Given–When–Then：Given带自定义 compare 的复杂 memo 安排低优先级 state，同时高优先级父 render compare 为相等；When重基线；Then state 更新仍保留并输出 1。通过复杂 MemoComponent 路径验证 child lanes。 */
      it('does not drop lower priority state updates when bailing out at higher pri (complex)', async () => {
        const {useState} = React;

        let setCounter;
        const Counter = memo(
          () => {
            const [counter, _setCounter] = useState(0);
            setCounter = _setCounter;
            return counter;
          },
          (a, b) => a.complexProp.val === b.complexProp.val,
        );

        /** 用 Suspense 包裹 Counter；父级重渲染可在高优先级检查 memo bailout。 */
        function App() {
          return (
            <Suspense fallback="Loading...">
              <Counter complexProp={{val: 1}} />
            </Suspense>
          );
        }

        const root = ReactNoop.createRoot();
        await act(() => {
          root.render(<App />);
        });
        expect(root).toMatchRenderedOutput('0');

        await act(() => {
          setCounter(1);
          ReactNoop.discreteUpdates(() => {
            root.render(<App />);
          });
        });
        expect(root).toMatchRenderedOutput('1');
      });
    });

      /** Given–When–Then：Given匿名 memo 内返回无 key 数组；When触发 key 警告；Then组件栈跳过无 name/displayName 的 memo 层。通过精确警告栈验证名称回退。 */
    it('should skip memo in the stack if neither displayName nor name are present', async () => {
      /** 构造会触发 key 警告的 memo wrapper，用其 name/displayName 检查组件栈格式。 */
      const MemoComponent = React.memo(props => [<span />]);
      ReactNoop.render(
        <p>
          <MemoComponent />
        </p>,
      );
      await waitForAll([]);
      assertConsoleErrorDev([
        'Each child in a list should have a unique "key" prop. ' +
          'See https://react.dev/link/warning-keys for more information.\n' +
          '    in span (at **)\n' +
          '    in **/ReactMemo-test.js:**:** (at **)',
      ]);
    });

      /** Given–When–Then：Given memo 包装具名 Inner 函数；When触发 key 警告；Then消息和栈均使用 Inner。通过控制台文本验证内层函数名传播。 */
    it('should use the inner function name for the stack', async () => {
      /** 构造会触发 key 警告的 memo wrapper，用其 name/displayName 检查组件栈格式。 */
      const MemoComponent = React.memo(function Inner(props, ref) {
        return [<span />];
      });
      ReactNoop.render(
        <p>
          <MemoComponent />
        </p>,
      );
      await waitForAll([]);
      assertConsoleErrorDev([
        'Each child in a list should have a unique "key" prop.' +
          '\n\nCheck the top-level render call using <Inner>. It was passed a child from Inner. ' +
          'See https://react.dev/link/warning-keys for more information.\n' +
          '    in span (at **)\n' +
          '    in Inner (at **)',
      ]);
    });

      /** Given–When–Then：Given箭头函数的 name 属性显式设为 Inner 后传入 memo；When触发警告；Then栈使用 Inner。通过动态函数 name 验证名称解析。 */
    it('should use the inner name in the stack', async () => {
        /** 返回无 key span 数组的匿名函数；随后动态设置 name 以测试栈名称优先级。 */
      const fn = (props, ref) => {
        return [<span />];
      };
      Object.defineProperty(fn, 'name', {value: 'Inner'});
      /** 构造会触发 key 警告的 memo wrapper，用其 name/displayName 检查组件栈格式。 */
      const MemoComponent = React.memo(fn);
      ReactNoop.render(
        <p>
          <MemoComponent />
        </p>,
      );
      await waitForAll([]);
      assertConsoleErrorDev([
        'Each child in a list should have a unique "key" prop.' +
          '\n\nCheck the top-level render call using <Inner>. It was passed a child from Inner. ' +
          'See https://react.dev/link/warning-keys for more information.\n' +
          '    in span (at **)\n' +
          '    in Inner (at **)',
      ]);
    });

      /** Given–When–Then：Given匿名 memo wrapper 设置 displayName=Outer；When触发 key 警告；Then栈使用 Outer。通过控制台消息验证外层 displayName 回退。 */
    it('can use the outer displayName in the stack', async () => {
      /** 构造会触发 key 警告的 memo wrapper，用其 name/displayName 检查组件栈格式。 */
      const MemoComponent = React.memo((props, ref) => {
        return [<span />];
      });
      MemoComponent.displayName = 'Outer';
      ReactNoop.render(
        <p>
          <MemoComponent />
        </p>,
      );
      await waitForAll([]);
      assertConsoleErrorDev([
        'Each child in a list should have a unique "key" prop.' +
          '\n\nCheck the top-level render call using <Outer>. It was passed a child from Outer. ' +
          'See https://react.dev/link/warning-keys for more information.\n' +
          '    in span (at **)\n' +
          '    in Outer (at **)',
      ]);
    });

      /** Given–When–Then：Given内层函数名为 Inner、memo 外层 displayName 为 Outer；When触发警告；Then栈优先使用 Inner。通过消息验证名称优先级。 */
    it('should prefer the inner to the outer displayName in the stack', async () => {
        /** 返回无 key span 数组的匿名函数；随后动态设置 name 以测试栈名称优先级。 */
      const fn = (props, ref) => {
        return [<span />];
      };
      Object.defineProperty(fn, 'name', {value: 'Inner'});
      /** 构造会触发 key 警告的 memo wrapper，用其 name/displayName 检查组件栈格式。 */
      const MemoComponent = React.memo(fn);
      MemoComponent.displayName = 'Outer';
      ReactNoop.render(
        <p>
          <MemoComponent />
        </p>,
      );
      await waitForAll([]);
      assertConsoleErrorDev([
        'Each child in a list should have a unique "key" prop.' +
          '\n\nCheck the top-level render call using <Inner>. It was passed a child from Inner. ' +
          'See https://react.dev/link/warning-keys for more information.\n' +
          '    in span (at **)\n' +
          '    in Inner (at **)',
      ]);
    });
  }
});
