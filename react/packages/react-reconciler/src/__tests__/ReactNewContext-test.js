/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let React = require('react');
let useContext;
let ReactNoop;
let Scheduler;
let gen;
let waitForAll;
let waitFor;
let waitForThrow;
let assertConsoleErrorDev;

/** 覆盖新 Context API 的读取、传播、Provider 栈、bailout、错误恢复与随机并发一致性。 */
describe('ReactNewContext', () => {
  /** 每个用例前重置模块并绑定 React、Noop renderer、Scheduler 与内部等待/告警工具。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    useContext = React.useContext;
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    gen = require('random-seed');

    ({
      waitForAll,
      waitFor,
      waitForThrow,
      assertConsoleErrorDev,
    } = require('internal-test-utils'));
  });

  /** 每个用例后恢复全部 mock，防止 renderer 或控制台状态泄漏。 */
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Text 记录渲染值并返回标准 span fixture，使调度访问和宿主提交可分别断言。 */
  function Text(props) {
    Scheduler.log(props.text);
    return <span prop={props.text} />;
  }

  /** span 构造 Noop renderer 的标准宿主快照，供结构断言复用。 */
  function span(prop) {
    return {type: 'span', children: [], prop, hidden: false};
  }

  /** readContext 直接调用当前 renderer dispatcher，覆盖 Consumer render prop 与 class 内部读取路径。 */
  function readContext(Context) {
    const dispatcher =
      React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H;
    return dispatcher.readContext(Context);
  }

  // 注意：该组件源自 www 中的类似结构；等额外 div wrapper
  // 不再需要后即可删除。
  /** LegacyHiddenDiv 用真实 hidden div 包裹 LegacyHidden，模拟 www 的延迟隐藏结构并暴露宿主可见性。 */
  function LegacyHiddenDiv({children, mode}) {
    return (
      <div hidden={mode === 'hidden'}>
        <React.unstable_LegacyHidden
          mode={mode === 'hidden' ? 'unstable-defer-without-hiding' : mode}>
          {children}
        </React.unstable_LegacyHidden>
      </div>
    );
  }

  // Context 有多种读取方式；sharedContextTests 会针对
  // 每种 Consumer 实现运行同一套行为测试。
  sharedContextTests('Context.Consumer', Context => Context.Consumer);
  sharedContextTests(
    'useContext inside function component',
    Context =>
      /** Consumer 用 useContext 登记函数组件依赖，并把读取值交给共享 render callback。 */
      function Consumer(props) {
        const contextValue = useContext(Context);
        const render = props.children;
        return render(contextValue);
      },
  );
  sharedContextTests('useContext inside forwardRef component', Context =>
    React.forwardRef(/** Consumer 验证 forwardRef render 内 useContext 与普通函数组件使用同一依赖链。 */ function Consumer(props, ref) {
      const contextValue = useContext(Context);
      const render = props.children;
      return render(contextValue);
    }),
  );
  sharedContextTests('useContext inside memoized function component', Context =>
    React.memo(/** Consumer 位于 React.memo 边界内，Context 变化必须覆盖 props bailout。 */ function Consumer(props) {
      const contextValue = useContext(Context);
      const render = props.children;
      return render(contextValue);
    }),
  );
  sharedContextTests(
    'readContext(Context) inside class component',
    Context =>
      /** Consumer 通过 renderer dispatcher 的 readContext 在 class render 中登记依赖。 */
      class Consumer extends React.Component {
        /** Consumer.render 渲染当前 props/state/Context 并暴露可观察输出，用于“Context 读取与传播基础设施”。 */
        render() {
          const contextValue = readContext(Context);
          const render = this.props.children;
          return render(contextValue);
        }
      },
  );
  sharedContextTests(
    'readContext(Context) inside pure class component',
    Context =>
      /** Consumer 组合 PureComponent bailout 与 dispatcher readContext，验证 Context 可单独唤醒 class。 */
      class Consumer extends React.PureComponent {
        /** Consumer.render 渲染当前 props/state/Context 并暴露可观察输出，用于“Context 读取与传播基础设施”。 */
        render() {
          const contextValue = readContext(Context);
          const render = this.props.children;
          return render(contextValue);
        }
      },
  );

  /** sharedContextTests 把同一行为矩阵复用于 Context.Consumer、useContext、forwardRef、memo 与 class readContext 实现。 */
  function sharedContextTests(label, getConsumer) {
    /** 组织“共享 Context 读取矩阵”子场景，共享对应 API 的传播不变量。 */
    describe(`reading context with ${label}`, () => {
      /**
       * Given：同一共享用例由 Consumer render prop、useContext、forwardRef、memo 与 class readContext 等实现复用。
       * When：Provider value 先以 2 挂载，再更新为 3。
       * Then：每种读取入口都登记依赖，并在 Provider 变化时把最新值交给 Consumer。
       *
       * 验证机制：两次宿主输出严格从 `Result: 2` 变为 `Result: 3`。
       * 对应源码：`ReactFiberNewContext.js` 的 `readContextForConsumer()`、`propagateContextChanges()` 与 `ReactFiberBeginWork.js` 的 Context bailout。
       */
      it('simple mount and update', async () => {
        const Context = React.createContext(1);
        const Consumer = getConsumer(Context);

        const Indirection = React.Fragment;

        /** App 组织 Provider、Consumer 与 bailout 层级，并暴露场景更新入口，用于“多种 Context 读取入口的挂载与更新语义一致”。 */
        function App(props) {
          return (
            <Context.Provider value={props.value}>
              <Indirection>
                <Indirection>
                  <Consumer>
                    {value => <span prop={'Result: ' + value} />}
                  </Consumer>
                </Indirection>
              </Indirection>
            </Context.Provider>
          );
        }

        ReactNoop.render(<App value={2} />);
        await waitForAll([]);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Result: 2" />);

        // 执行更新。
        ReactNoop.render(<App value={3} />);
        await waitForAll([]);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Result: 3" />);
      });

      /**
       * Given：两层 Indirection 的 shouldComponentUpdate 固定为 false，Consumer 位于其后。
       * When：Provider value 从 2 更新为 3。
       * Then：普通 props 路径 bailout，但 Context lanes 仍穿过 class 边界唤醒 render prop。
       *
       * 验证机制：更新日志只含 App、Provider 与 Consumer render prop，输出变为 `Result: 3`。
       * 对应源码：`ReactFiberNewContext.js` 的 `propagateContextChanges()` 与 `ReactFiberBeginWork.js` 的 `checkScheduledUpdateOrContext()`。
       */
      it('propagates through shouldComponentUpdate false', async () => {
        const Context = React.createContext(1);
        const ContextConsumer = getConsumer(Context);

        /** Provider 把受控 props 写入 Context，并保持 children 结构以隔离传播行为，用于“Context 穿过 shouldComponentUpdate=false 边界”。 */
        function Provider(props) {
          Scheduler.log('Provider');
          return (
            <Context.Provider value={props.value}>
              {props.children}
            </Context.Provider>
          );
        }

        /** Consumer 通过当前测试指定的 API 登记 Context 依赖，并调用 children render callback。 */
        function Consumer(props) {
          Scheduler.log('Consumer');
          return (
            <ContextConsumer>
              {value => {
                Scheduler.log('Consumer render prop');
                return <span prop={'Result: ' + value} />;
              }}
            </ContextConsumer>
          );
        }

        /** 定义 Indirection 类 fixture，制造 class/PureComponent/legacy 边界，用于“Context 穿过 shouldComponentUpdate=false 边界”。 */
        class Indirection extends React.Component {
          /** sharedContextTests.Indirection.shouldComponentUpdate 固定返回 false，制造 props bailout 以验证 Context 的独立调度能力。 */
          shouldComponentUpdate() {
            return false;
          }
          /** sharedContextTests.Indirection.render 渲染当前 props/state/Context 并暴露可观察输出，用于“Context 穿过 shouldComponentUpdate=false 边界”。 */
          render() {
            Scheduler.log('Indirection');
            return this.props.children;
          }
        }

        /** App 组织 Provider、Consumer 与 bailout 层级，并暴露场景更新入口，用于“Context 穿过 shouldComponentUpdate=false 边界”。 */
        function App(props) {
          Scheduler.log('App');
          return (
            <Provider value={props.value}>
              <Indirection>
                <Indirection>
                  <Consumer />
                </Indirection>
              </Indirection>
            </Provider>
          );
        }

        ReactNoop.render(<App value={2} />);
        await waitForAll([
          'App',
          'Provider',
          'Indirection',
          'Indirection',
          'Consumer',
          'Consumer render prop',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Result: 2" />);

        // 执行更新。
        ReactNoop.render(<App value={3} />);
        await waitForAll(['App', 'Provider', 'Consumer render prop']);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Result: 3" />);
      });

      /**
       * Given：Provider、children 和消费结构保持稳定，Context value 连续为 2。
       * When：再次渲染相同 Provider value。
       * Then：Object.is 判等阻止传播，Consumer render prop 不再执行。
       *
       * 验证机制：更新日志只有 App 与 Provider，宿主输出仍为 `Result: 2`。
       * 对应源码：`ReactFiberBeginWork.js` 的 `updateContextProvider()` 与 `ReactFiberNewContext.js` 的 value 比较。
       */
      it('consumers bail out if context value is the same', async () => {
        const Context = React.createContext(1);
        const ContextConsumer = getConsumer(Context);

        /** Provider 把受控 props 写入 Context，并保持 children 结构以隔离传播行为，用于“相同 Context value 触发消费者 bailout”。 */
        function Provider(props) {
          Scheduler.log('Provider');
          return (
            <Context.Provider value={props.value}>
              {props.children}
            </Context.Provider>
          );
        }

        /** Consumer 通过当前测试指定的 API 登记 Context 依赖，并调用 children render callback。 */
        function Consumer(props) {
          Scheduler.log('Consumer');
          return (
            <ContextConsumer>
              {value => {
                Scheduler.log('Consumer render prop');
                return <span prop={'Result: ' + value} />;
              }}
            </ContextConsumer>
          );
        }

        /** 定义 Indirection 类 fixture，制造 class/PureComponent/legacy 边界，用于“相同 Context value 触发消费者 bailout”。 */
        class Indirection extends React.Component {
          /** sharedContextTests.Indirection.shouldComponentUpdate 固定返回 false，制造 props bailout 以验证 Context 的独立调度能力。 */
          shouldComponentUpdate() {
            return false;
          }
          /** sharedContextTests.Indirection.render 渲染当前 props/state/Context 并暴露可观察输出，用于“相同 Context value 触发消费者 bailout”。 */
          render() {
            Scheduler.log('Indirection');
            return this.props.children;
          }
        }

        /** App 组织 Provider、Consumer 与 bailout 层级，并暴露场景更新入口，用于“相同 Context value 触发消费者 bailout”。 */
        function App(props) {
          Scheduler.log('App');
          return (
            <Provider value={props.value}>
              <Indirection>
                <Indirection>
                  <Consumer />
                </Indirection>
              </Indirection>
            </Provider>
          );
        }

        ReactNoop.render(<App value={2} />);
        await waitForAll([
          'App',
          'Provider',
          'Indirection',
          'Indirection',
          'Consumer',
          'Consumer render prop',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Result: 2" />);

        // 使用相同 Context value 更新。
        ReactNoop.render(<App value={2} />);
        await waitForAll([
          'App',
          'Provider',
          // render prop 不应再次执行。
        ]);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Result: 2" />);
      });

      /**
       * Given：三层同名 Provider 读取父值并在未显式覆盖时乘 2，间隔层拒绝 props 更新。
       * When：最外层 value 从 2 更新为 3。
       * Then：Provider 栈按嵌套顺序 push/pop，最深 Consumer 分别得到 8 与 12。
       *
       * 验证机制：宿主输出 `Result: 8`→`Result: 12` 验证遮蔽与恢复顺序。
       * 对应源码：`ReactFiberNewContext.js` 的 `pushProvider()`、`popProvider()` 与 `readContextForConsumer()`。
       */
      it('nested providers', async () => {
        const Context = React.createContext(1);
        const Consumer = getConsumer(Context);

        /** Provider 把受控 props 写入 Context，并保持 children 结构以隔离传播行为，用于“嵌套 Provider 的遮蔽、派生与栈恢复”。 */
        function Provider(props) {
          return (
            <Consumer>
              {contextValue => (
                // 若 props 未覆盖，则把父级 Context 值乘以 2。
                <Context.Provider value={props.value || contextValue * 2}>
                  {props.children}
                </Context.Provider>
              )}
            </Consumer>
          );
        }

        /** 定义 Indirection 类 fixture，制造 class/PureComponent/legacy 边界，用于“嵌套 Provider 的遮蔽、派生与栈恢复”。 */
        class Indirection extends React.Component {
          /** sharedContextTests.Indirection.shouldComponentUpdate 固定返回 false，制造 props bailout 以验证 Context 的独立调度能力。 */
          shouldComponentUpdate() {
            return false;
          }
          /** sharedContextTests.Indirection.render 渲染当前 props/state/Context 并暴露可观察输出，用于“嵌套 Provider 的遮蔽、派生与栈恢复”。 */
          render() {
            return this.props.children;
          }
        }

        /** App 组织 Provider、Consumer 与 bailout 层级，并暴露场景更新入口，用于“嵌套 Provider 的遮蔽、派生与栈恢复”。 */
        function App(props) {
          return (
            <Provider value={props.value}>
              <Indirection>
                <Provider>
                  <Indirection>
                    <Provider>
                      <Indirection>
                        <Consumer>
                          {value => <span prop={'Result: ' + value} />}
                        </Consumer>
                      </Indirection>
                    </Provider>
                  </Indirection>
                </Provider>
              </Indirection>
            </Provider>
          );
        }

        ReactNoop.render(<App value={2} />);
        await waitForAll([]);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Result: 8" />);

        // 执行更新。
        ReactNoop.render(<App value={3} />);
        await waitForAll([]);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Result: 12" />);
      });

      /**
       * Given：Foo/Bar Context 各有默认对象，树中同时布置 Provider 内外的消费者。
       * When：一次渲染读取已覆盖值与未覆盖默认值。
       * Then：Provider 内消费者读取 updated 值，兄弟树外消费者保持各自 initial 默认值。
       *
       * 验证机制：Verify 直接以引用值断言四个读取结果，不依赖文本格式化。
       * 对应源码：`ReactContext.js` 的 `createContext()` 默认值与 `ReactFiberNewContext.js` 的 Provider 栈。
       */
      it('should provide the correct (default) values to consumers outside of a provider', async () => {
        const FooContext = React.createContext({value: 'foo-initial'});
        const BarContext = React.createContext({value: 'bar-initial'});
        const FooConsumer = getConsumer(FooContext);
        const BarConsumer = getConsumer(BarContext);

        /** Verify 在 render 中直接比较实际与期望 Context 值，覆盖 Provider 内外的默认值解析。 */
        const Verify = ({actual, expected}) => {
          expect(expected).toBe(actual);
          return null;
        };

        ReactNoop.render(
          <>
            <BarContext.Provider value={{value: 'bar-updated'}}>
              <BarConsumer>
                {({value}) => <Verify actual={value} expected="bar-updated" />}
              </BarConsumer>

              <FooContext.Provider value={{value: 'foo-updated'}}>
                <FooConsumer>
                  {({value}) => (
                    <Verify actual={value} expected="foo-updated" />
                  )}
                </FooConsumer>
              </FooContext.Provider>
            </BarContext.Provider>

            <FooConsumer>
              {({value}) => <Verify actual={value} expected="foo-initial" />}
            </FooConsumer>
            <BarConsumer>
              {({value}) => <Verify actual={value} expected="bar-initial" />}
            </BarConsumer>
          </>,
        );
        await waitForAll([]);
      });

      /**
       * Given：同一 Provider 下分成嵌套 Provider 分支和直接 Consumer 分支，并穿过 sCU=false 层。
       * When：外层 value 依次 2→3→4。
       * Then：传播遍历所有 sibling；派生分支得到双倍值，直接分支得到原值。
       *
       * 验证机制：输出依次为 4/2、6/3、8/4，验证每轮两条分支。
       * 对应源码：`ReactFiberNewContext.js` 的 `propagateContextChanges()` sibling/return 遍历。
       */
      it('multiple consumers in different branches', async () => {
        const Context = React.createContext(1);
        const Consumer = getConsumer(Context);

        /** Provider 把受控 props 写入 Context，并保持 children 结构以隔离传播行为，用于“Context 更新覆盖不同兄弟分支”。 */
        function Provider(props) {
          return (
            <Context.Consumer>
              {contextValue => (
                // 若 props 未覆盖，则把父级 Context 值乘以 2。
                <Context.Provider value={props.value || contextValue * 2}>
                  {props.children}
                </Context.Provider>
              )}
            </Context.Consumer>
          );
        }

        /** 定义 Indirection 类 fixture，制造 class/PureComponent/legacy 边界，用于“Context 更新覆盖不同兄弟分支”。 */
        class Indirection extends React.Component {
          /** sharedContextTests.Indirection.shouldComponentUpdate 固定返回 false，制造 props bailout 以验证 Context 的独立调度能力。 */
          shouldComponentUpdate() {
            return false;
          }
          /** sharedContextTests.Indirection.render 渲染当前 props/state/Context 并暴露可观察输出，用于“Context 更新覆盖不同兄弟分支”。 */
          render() {
            return this.props.children;
          }
        }

        /** App 组织 Provider、Consumer 与 bailout 层级，并暴露场景更新入口，用于“Context 更新覆盖不同兄弟分支”。 */
        function App(props) {
          return (
            <Provider value={props.value}>
              <Indirection>
                <Indirection>
                  <Provider>
                    <Consumer>
                      {value => <span prop={'Result: ' + value} />}
                    </Consumer>
                  </Provider>
                </Indirection>
                <Indirection>
                  <Consumer>
                    {value => <span prop={'Result: ' + value} />}
                  </Consumer>
                </Indirection>
              </Indirection>
            </Provider>
          );
        }

        ReactNoop.render(<App value={2} />);
        await waitForAll([]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="Result: 4" />
            <span prop="Result: 2" />
          </>,
        );

        // 执行更新。
        ReactNoop.render(<App value={3} />);
        await waitForAll([]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="Result: 6" />
            <span prop="Result: 3" />
          </>,
        );

        // 再执行一次更新。
        ReactNoop.render(<App value={4} />);
        await waitForAll([]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="Result: 8" />
            <span prop="Result: 4" />
          </>,
        );
      });

      /**
       * Given：Provider value 使用 NaN，Consumer 位于两层 sCU=false 间接节点之后。
       * When：再次用 NaN 更新 Provider。
       * Then：Object.is(NaN, NaN) 为真，因此不传播且 render prop 不重跑。
       *
       * 验证机制：更新日志缺少 Consumer render prop，输出仍为 `Result: NaN`。
       * 对应源码：`shared/objectIs.js` 与 `ReactFiberBeginWork.js` 的 `updateContextProvider()`。
       */
      it('compares context values with Object.is semantics', async () => {
        const Context = React.createContext(1);
        const ContextConsumer = getConsumer(Context);

        /** Provider 把受控 props 写入 Context，并保持 children 结构以隔离传播行为，用于“Context value 按 Object.is 而非 === 比较”。 */
        function Provider(props) {
          Scheduler.log('Provider');
          return (
            <Context.Provider value={props.value}>
              {props.children}
            </Context.Provider>
          );
        }

        /** Consumer 通过当前测试指定的 API 登记 Context 依赖，并调用 children render callback。 */
        function Consumer(props) {
          Scheduler.log('Consumer');
          return (
            <ContextConsumer>
              {value => {
                Scheduler.log('Consumer render prop');
                return <span prop={'Result: ' + value} />;
              }}
            </ContextConsumer>
          );
        }

        /** 定义 Indirection 类 fixture，制造 class/PureComponent/legacy 边界，用于“Context value 按 Object.is 而非 === 比较”。 */
        class Indirection extends React.Component {
          /** sharedContextTests.Indirection.shouldComponentUpdate 固定返回 false，制造 props bailout 以验证 Context 的独立调度能力。 */
          shouldComponentUpdate() {
            return false;
          }
          /** sharedContextTests.Indirection.render 渲染当前 props/state/Context 并暴露可观察输出，用于“Context value 按 Object.is 而非 === 比较”。 */
          render() {
            Scheduler.log('Indirection');
            return this.props.children;
          }
        }

        /** App 组织 Provider、Consumer 与 bailout 层级，并暴露场景更新入口，用于“Context value 按 Object.is 而非 === 比较”。 */
        function App(props) {
          Scheduler.log('App');
          return (
            <Provider value={props.value}>
              <Indirection>
                <Indirection>
                  <Consumer />
                </Indirection>
              </Indirection>
            </Provider>
          );
        }

        ReactNoop.render(<App value={NaN} />);
        await waitForAll([
          'App',
          'Provider',
          'Indirection',
          'Indirection',
          'Consumer',
          'Consumer render prop',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Result: NaN" />);

        // 执行更新。
        ReactNoop.render(<App value={NaN} />);
        await waitForAll([
          'App',
          'Provider',
          // Consumer render prop 不应再次渲染。
          // 'Consumer render prop',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Result: NaN" />);
      });

      /**
       * Given：内层 Provider push 值后 BadRender 抛错，外层兄弟 Consumer 应读取外层值。
       * When：错误边界捕获中断并继续渲染兄弟。
       * Then：unwind 弹出出错 Provider，Context 栈不泄漏 `Unwinds after BadRender throws`。
       *
       * 验证机制：最终输出 `Result: Does not unwind` 直接验证恢复后的栈顶。
       * 对应源码：`ReactFiberUnwindWork.js` 的 Provider unwind 与 `ReactFiberNewContext.js` 的 `popProvider()`。
       */
      it('context unwinds when interrupted', async () => {
        const Context = React.createContext('Default');
        const ContextConsumer = getConsumer(Context);

        /** Consumer 通过当前测试指定的 API 登记 Context 依赖，并调用 children render callback。 */
        function Consumer(props) {
          return (
            <ContextConsumer>
              {value => <span prop={'Result: ' + value} />}
            </ContextConsumer>
          );
        }

        /** BadRender 主动抛错，验证中断时 Provider 栈能从正确位置 unwind。 */
        function BadRender() {
          throw new Error('Bad render');
        }

        /** 定义 ErrorBoundary 类 fixture，制造 class/PureComponent/legacy 边界，用于“渲染中断后正确 unwind Context 栈”。 */
        class ErrorBoundary extends React.Component {
          /** sharedContextTests.ErrorBoundary.state 保存驱动本场景的实例 state，区分组件更新与 Context 传播来源。 */
          state = {error: null};
          /** sharedContextTests.ErrorBoundary.componentDidCatch 捕获渲染错误并写回 state，使兄弟 Consumer 在 Context unwind 后继续渲染。 */
          componentDidCatch(error) {
            this.setState({error});
          }
          /** sharedContextTests.ErrorBoundary.render 渲染当前 props/state/Context 并暴露可观察输出，用于“渲染中断后正确 unwind Context 栈”。 */
          render() {
            if (this.state.error) {
              return null;
            }
            return this.props.children;
          }
        }

        /** App 组织 Provider、Consumer 与 bailout 层级，并暴露场景更新入口，用于“渲染中断后正确 unwind Context 栈”。 */
        function App(props) {
          return (
            <>
              <Context.Provider value="Does not unwind">
                <ErrorBoundary>
                  <Context.Provider value="Unwinds after BadRender throws">
                    <BadRender />
                  </Context.Provider>
                </ErrorBoundary>
                <Consumer />
              </Context.Provider>
            </>
          );
        }

        ReactNoop.render(<App value="A" />);
        await waitForAll([]);
        expect(ReactNoop).toMatchRenderedOutput(
          // 第二个作用域外的 Consumer 应读取正确的外层值。
          <span prop="Result: Does not unwind" />,
        );
      });

      /**
       * Given：Consumer render prop 创建带本地 state 的 Child，并记录二者调用。
       * When：仅调用 Child.setState 把 step 从 0 更新为 1。
       * Then：子更新直接命中 Child，不重新执行未变化的 Context Consumer render prop。
       *
       * 验证机制：更新日志只有 Child，输出保留 Context 1 且 Step 变为 1。
       * 对应源码：`ReactFiberBeginWork.js` 的 Consumer bailout 与 class update 调度。
       */
      it("does not re-render if there's an update in a child", async () => {
        const Context = React.createContext(0);
        const Consumer = getConsumer(Context);

        let child;
        /** 定义 Child 类 fixture，制造 class/PureComponent/legacy 边界，用于“子组件更新不反向重渲染 Context Consumer”。 */
        class Child extends React.Component {
          /** sharedContextTests.Child.state 保存驱动本场景的实例 state，区分组件更新与 Context 传播来源。 */
          state = {step: 0};
          /** sharedContextTests.Child.render 渲染当前 props/state/Context 并暴露可观察输出，用于“子组件更新不反向重渲染 Context Consumer”。 */
          render() {
            Scheduler.log('Child');
            return (
              <span
                prop={`Context: ${this.props.context}, Step: ${this.state.step}`}
              />
            );
          }
        }

        /** App 组织 Provider、Consumer 与 bailout 层级，并暴露场景更新入口，用于“子组件更新不反向重渲染 Context Consumer”。 */
        function App(props) {
          return (
            <Context.Provider value={props.value}>
              <Consumer>
                {value => {
                  Scheduler.log('Consumer render prop');
                  return <Child ref={inst => (child = inst)} context={value} />;
                }}
              </Consumer>
            </Context.Provider>
          );
        }

        // 首次挂载。
        ReactNoop.render(<App value={1} />);
        await waitForAll(['Consumer render prop', 'Child']);
        expect(ReactNoop).toMatchRenderedOutput(
          <span prop="Context: 1, Step: 0" />,
        );

        child.setState({step: 1});
        await waitForAll(['Child']);
        expect(ReactNoop).toMatchRenderedOutput(
          <span prop="Context: 1, Step: 1" />,
        );
      });

      /**
       * Given：相同 Context 下同时使用 inline 与缓存 render callback，并由 PureIndirection 包围。
       * When：先以相同 value 重渲染，再改为新 value。
       * Then：相同值时整层 bailout；新值传播时两个 Consumer 都执行，callback 引用差异不影响语义。
       *
       * 验证机制：三段日志分别验证挂载、相同值 bailout 与新值定向传播。
       * 对应源码：`ReactFiberNewContext.js` 的 `readContextForConsumer()`、`propagateContextChanges()` 与 `ReactFiberBeginWork.js` 的 Context bailout。
       */
      it('consumer bails out if value is unchanged and something above bailed out', async () => {
        const Context = React.createContext(0);
        const Consumer = getConsumer(Context);

        /** renderChildValue 记录 Consumer callback 并返回读取值，比较 inline 与缓存 callback 的 bailout 语义。 */
        function renderChildValue(value) {
          Scheduler.log('Consumer');
          return <span prop={value} />;
        }

        /** ChildWithInlineRenderCallback 封装对应 render callback 引用策略，用于比较 Context bailout 是否依赖函数引用。 */
        function ChildWithInlineRenderCallback() {
          Scheduler.log('ChildWithInlineRenderCallback');
          // 注意：这里刻意传入 inline arrow，用于区分 callback 引用；不要重构。
          return <Consumer>{value => renderChildValue(value)}</Consumer>;
        }

        /** ChildWithCachedRenderCallback 封装对应 render callback 引用策略，用于比较 Context bailout 是否依赖函数引用。 */
        function ChildWithCachedRenderCallback() {
          Scheduler.log('ChildWithCachedRenderCallback');
          return <Consumer>{renderChildValue}</Consumer>;
        }

        /** 定义 PureIndirection 类 fixture，制造 class/PureComponent/legacy 边界，用于“Context 相同值 bailout 不依赖 render callback 引用”。 */
        class PureIndirection extends React.PureComponent {
          /** sharedContextTests.PureIndirection.render 渲染当前 props/state/Context 并暴露可观察输出，用于“Context 相同值 bailout 不依赖 render callback 引用”。 */
          render() {
            Scheduler.log('PureIndirection');
            return (
              <>
                <ChildWithInlineRenderCallback />
                <ChildWithCachedRenderCallback />
              </>
            );
          }
        }

        /** 定义 App 类 fixture，制造 class/PureComponent/legacy 边界，用于“Context 相同值 bailout 不依赖 render callback 引用”。 */
        class App extends React.Component {
          /** sharedContextTests.App.render 渲染当前 props/state/Context 并暴露可观察输出，用于“Context 相同值 bailout 不依赖 render callback 引用”。 */
          render() {
            Scheduler.log('App');
            return (
              <Context.Provider value={this.props.value}>
                <PureIndirection />
              </Context.Provider>
            );
          }
        }

        // 首次挂载。
        ReactNoop.render(<App value={1} />);
        await waitForAll([
          'App',
          'PureIndirection',
          'ChildWithInlineRenderCallback',
          'Consumer',
          'ChildWithCachedRenderCallback',
          'Consumer',
        ]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop={1} />
            <span prop={1} />
          </>,
        );

        // 更新并预期 bailout。
        ReactNoop.render(<App value={1} />);
        await waitForAll(['App']);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop={1} />
            <span prop={1} />
          </>,
        );

        // 更新并预期不 bailout。
        ReactNoop.render(<App value={2} />);
        await waitForAll(['App', 'Consumer', 'Consumer']);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop={2} />
            <span prop={2} />
          </>,
        );
      });

      /**
       * Given：LegacyHiddenDiv 以 hidden 模式包围 Consumer，Provider 初值为 dark。
       * When：Provider theme 更新为 light。
       * Then：隐藏子树不能复用旧 Context，Consumer 仍读取 light，同时宿主节点保持 hidden。
       *
       * 验证机制：调度日志 dark→light，getChildrenAsJSX 同时断言值与 hidden 标志。
       * 对应源码：`ReactFiberBeginWork.js` 的 `updateOffscreenComponent()` 与 `ReactFiberNewContext.js` 的传播。
       */
      // @gate enableLegacyHidden
      it("context consumer doesn't bail out inside hidden subtree", async () => {
        const Context = React.createContext('dark');
        const Consumer = getConsumer(Context);

        /** App 组织 Provider、Consumer 与 bailout 层级，并暴露场景更新入口，用于“hidden Offscreen 子树中的 Context Consumer 不错误 bailout”。 */
        function App({theme}) {
          return (
            <Context.Provider value={theme}>
              <LegacyHiddenDiv mode="hidden">
                <Consumer>{value => <Text text={value} />}</Consumer>
              </LegacyHiddenDiv>
            </Context.Provider>
          );
        }

        ReactNoop.render(<App theme="dark" />);
        await waitForAll(['dark']);
        expect(ReactNoop.getChildrenAsJSX()).toEqual(
          <div hidden={true}>
            <span prop="dark" />
          </div>,
        );

        ReactNoop.render(<App theme="light" />);
        await waitForAll(['light']);
        expect(ReactNoop.getChildrenAsJSX()).toEqual(
          <div hidden={true}>
            <span prop="light" />
          </div>,
        );
      });

      // 回归场景：https://github.com/facebook/react/issues/12389。
      /**
       * Given：Context Consumer 嵌在可反转的 keyed 列表项中，Provider 每次创建新对象。
       * When：列表顺序 false→true→false 连续切换。
       * Then：reconcile 与 Context 传播收敛，不因 consumer/outer sibling 关系形成循环。
       *
       * 验证机制：三次 waitForAll 都能完成即证明 work loop 没有无限重访。
       * 对应源码：`ReactChildFiber.js` 的 keyed reconcile 与 `ReactFiberNewContext.js` 的 sibling 遍历。
       */
      it('does not run into an infinite loop', async () => {
        const Context = React.createContext(null);
        const Consumer = getConsumer(Context);

        /** 定义 App 类 fixture，制造 class/PureComponent/legacy 边界，用于“Context 消费者参与列表重排时 work loop 收敛”。 */
        class App extends React.Component {
          /** sharedContextTests.App.renderItem 构造含 Consumer 与普通 sibling 的 keyed 列表项。 */
          renderItem(id) {
            return (
              <span key={id}>
                <Consumer>{() => <span>inner</span>}</Consumer>
                <span>outer</span>
              </span>
            );
          }
          /** sharedContextTests.App.renderList 生成并按 props 反转 keyed 列表，覆盖 reconcile 与 Context walker 交错。 */
          renderList() {
            const list = [1, 2].map(id => this.renderItem(id));
            if (this.props.reverse) {
              list.reverse();
            }
            return list;
          }
          /** sharedContextTests.App.render 渲染当前 props/state/Context 并暴露可观察输出，用于“Context 消费者参与列表重排时 work loop 收敛”。 */
          render() {
            return (
              <Context.Provider value={{}}>
                {this.renderList()}
              </Context.Provider>
            );
          }
        }

        ReactNoop.render(<App reverse={false} />);
        await waitForAll([]);
        ReactNoop.render(<App reverse={true} />);
        await waitForAll([]);
        ReactNoop.render(<App reverse={false} />);
        await waitForAll([]);
      });

      // 回归场景：https://github.com/facebook/react/issues/12686。
      /**
       * Given：Provider 下先有 PureComponent 静态 Fragment，后续 step>0 才插入 Context Consumer。
       * When：实例 state 从 0→1→2。
       * Then：首次插入与后续 Context 更新都保留静态 siblings，并访问动态 Consumer。
       *
       * 验证机制：输出同时保留 static 1/2 与最新 step，日志每轮包含 App/Consumer。
       * 对应源码：`ReactChildFiber.js` 的 sibling reconcile 与 `ReactFiberNewContext.js` 的传播 walker。
       */
      it('does not skip some siblings', async () => {
        const Context = React.createContext(0);
        const ContextConsumer = getConsumer(Context);

        /** 定义 App 类 fixture，制造 class/PureComponent/legacy 边界，用于“Context 更新不跳过静态与动态兄弟 Fiber”。 */
        class App extends React.Component {
          /** sharedContextTests.App.state 保存驱动本场景的实例 state，区分组件更新与 Context 传播来源。 */
          state = {
            step: 0,
          };

          /** sharedContextTests.App.render 渲染当前 props/state/Context 并暴露可观察输出，用于“Context 更新不跳过静态与动态兄弟 Fiber”。 */
          render() {
            Scheduler.log('App');
            return (
              <Context.Provider value={this.state.step}>
                <StaticContent />
                {this.state.step > 0 && <Indirection />}
              </Context.Provider>
            );
          }
        }

        /** 定义 StaticContent 类 fixture，制造 class/PureComponent/legacy 边界，用于“Context 更新不跳过静态与动态兄弟 Fiber”。 */
        class StaticContent extends React.PureComponent {
          /** sharedContextTests.StaticContent.render 渲染当前 props/state/Context 并暴露可观察输出，用于“Context 更新不跳过静态与动态兄弟 Fiber”。 */
          render() {
            return (
              <>
                <>
                  <span prop="static 1" />
                  <span prop="static 2" />
                </>
              </>
            );
          }
        }

        /** 定义 Indirection 类 fixture，制造 class/PureComponent/legacy 边界，用于“Context 更新不跳过静态与动态兄弟 Fiber”。 */
        class Indirection extends React.PureComponent {
          /** sharedContextTests.Indirection.render 渲染当前 props/state/Context 并暴露可观察输出，用于“Context 更新不跳过静态与动态兄弟 Fiber”。 */
          render() {
            return (
              <ContextConsumer>
                {value => {
                  Scheduler.log('Consumer');
                  return <span prop={value} />;
                }}
              </ContextConsumer>
            );
          }
        }

        // 首次挂载。
        let inst;
        ReactNoop.render(<App ref={ref => (inst = ref)} />);
        await waitForAll(['App']);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="static 1" />
            <span prop="static 2" />
          </>,
        );
        // 执行第一次更新。
        inst.setState({step: 1});
        await waitForAll(['App', 'Consumer']);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="static 1" />
            <span prop="static 2" />
            <span prop={1} />
          </>,
        );
        // 执行第二次更新。
        inst.setState({step: 2});
        await waitForAll(['App', 'Consumer']);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="static 1" />
            <span prop="static 2" />
            <span prop={2} />
          </>,
        );
      });
    });
  }

  /** 组织“Context.Provider”子场景，共享对应 API 的传播不变量。 */
  describe('Context.Provider', () => {
    /**
     * Given：创建 Provider 时故意省略必需的 value prop。
     * When：开发态渲染该 Provider。
     * Then：Provider 使用 undefined 路径并发出精确缺参诊断。
     *
     * 验证机制：assertConsoleErrorDev 锁定完整 warning 文本。
     * 对应源码：`ReactFiberBeginWork.js` 的 `updateContextProvider()` 开发态校验。
     */
    it('warns if no value prop provided', async () => {
      const Context = React.createContext();

      ReactNoop.render(
        <Context.Provider anyPropNameOtherThanValue="value could be anything" />,
      );

      await waitForAll([]);
      assertConsoleErrorDev([
        'The `value` prop is required for the `<Context.Provider>`. Did you misspell it or forget to pass it?',
      ]);
    });

    /**
     * Given：第一份 renderer 已 push 同一 Context Provider 但尚未 commit，随后加载第二份 renderer。
     * When：第二 renderer 在第一 renderer 未退出 Provider 栈时渲染同一 Context。
     * Then：renderer sigil 冲突被检测并报告不支持的并发多 renderer 使用。
     *
     * 验证机制：分段 waitFor 固定重叠窗口，console.error 断言诊断内容。
     * 对应源码：`ReactFiberNewContext.js` 的 `pushProvider()` renderer sigil 检查。
     */
    it('warns if multiple renderers concurrently render the same context', async () => {
      spyOnDev(console, 'error').mockImplementation(() => {});
      const Context = React.createContext(0);

      /** Foo 构造目标非法或告警调用位置，用于“同一 Context 被多个 renderer 并发渲染时告警”。 */
      function Foo(props) {
        Scheduler.log('Foo');
        return null;
      }

      /** App 组织 Provider、Consumer 与 bailout 层级，并暴露场景更新入口，用于“同一 Context 被多个 renderer 并发渲染时告警”。 */
      function App(props) {
        return (
          <Context.Provider value={props.value}>
            <Foo />
            <Foo />
          </Context.Provider>
        );
      }

      React.startTransition(() => {
        ReactNoop.render(<App value={1} />);
      });
      // 渲染越过 Provider，但暂不 commit，以保留 renderer 重叠窗口。
      await waitFor(['Foo']);

      // 重新加载一份 ReactNoop renderer。
      jest.resetModules();
      React = require('react');
      ReactNoop = require('react-noop-renderer');
      Scheduler = require('scheduler');
      const InternalTestUtils = require('internal-test-utils');
      waitForAll = InternalTestUtils.waitForAll;
      waitFor = InternalTestUtils.waitFor;

      // 使用另一份 renderer 再次渲染同一 Provider。
      ReactNoop.render(<App value={1} />);
      await waitForAll(['Foo', 'Foo']);

      if (__DEV__) {
        expect(console.error.mock.calls[0][0]).toContain(
          'Detected multiple renderers concurrently rendering the same ' +
            'context provider. This is currently unsupported',
        );
      }
    });

    /**
     * Given：两个独立 renderer 依次使用同一 Context，第一遍已完整提交并 pop Provider。
     * When：重置模块后由第二 renderer 再次渲染。
     * Then：顺序使用不形成 renderer sigil 冲突，不应产生错误告警。
     *
     * 验证机制：两轮 Foo 日志完成且 console.error 未调用。
     * 对应源码：`ReactFiberNewContext.js` 的 `pushProvider()`/`popProvider()` renderer 状态。
     */
    it('does not warn if multiple renderers use the same context sequentially', async () => {
      spyOnDev(console, 'error');
      const Context = React.createContext(0);

      /** Foo 构造目标非法或告警调用位置，用于“多个 renderer 顺序使用同一 Context 不误告警”。 */
      function Foo(props) {
        Scheduler.log('Foo');
        return null;
      }

      /** App 组织 Provider、Consumer 与 bailout 层级，并暴露场景更新入口，用于“多个 renderer 顺序使用同一 Context 不误告警”。 */
      function App(props) {
        return (
          <Context.Provider value={props.value}>
            <Foo />
            <Foo />
          </Context.Provider>
        );
      }

      React.startTransition(() => {
        ReactNoop.render(<App value={1} />);
      });
      await waitForAll(['Foo', 'Foo']);

      // 重新加载一份 ReactNoop renderer。
      jest.resetModules();
      React = require('react');
      ReactNoop = require('react-noop-renderer');
      Scheduler = require('scheduler');
      const InternalTestUtils = require('internal-test-utils');
      waitForAll = InternalTestUtils.waitForAll;
      waitFor = InternalTestUtils.waitFor;

      // 使用另一份 renderer 再次渲染同一 Provider。
      ReactNoop.render(<App value={1} />);
      await waitForAll(['Foo', 'Foo']);

      if (__DEV__) {
        expect(console.error).not.toHaveBeenCalled();
      }
    });

    /**
     * Given：Provider value 与 children 元素引用均保持不变，Child 记录渲染。
     * When：以相同 value 再次渲染 App。
     * Then：Provider 像 sCU 一样复用 children，Child 不再执行。
     *
     * 验证机制：更新日志只有 App，宿主 Child 输出保持不变。
     * 对应源码：`ReactFiberBeginWork.js` 的 `updateContextProvider()` 与 `bailoutOnAlreadyFinishedWork()`。
     */
    it('provider bails out if children and value are unchanged (like sCU)', async () => {
      const Context = React.createContext(0);

      /** Child 提供可观察叶子/静态 sibling，用于“Provider 在 value 与 children 同时不变时 bailout”。 */
      function Child() {
        Scheduler.log('Child');
        return <span prop="Child" />;
      }

      const children = <Child />;

      /** App 组织 Provider、Consumer 与 bailout 层级，并暴露场景更新入口，用于“Provider 在 value 与 children 同时不变时 bailout”。 */
      function App(props) {
        Scheduler.log('App');
        return (
          <Context.Provider value={props.value}>{children}</Context.Provider>
        );
      }

      // 首次挂载。
      ReactNoop.render(<App value={1} />);
      await waitForAll(['App', 'Child']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Child" />);

      // 执行更新。
      ReactNoop.render(<App value={1} />);
      await waitForAll([
        'App',
        // Child 不应重新渲染。
      ]);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Child" />);
    });

    /**
     * Given：新 Context Provider 的 value/children 不变，但祖先 LegacyProvider 产生 legacy context 更新。
     * When：分别更新 App 相同 state、LegacyProvider，再更新 App。
     * Then：普通相同值更新可 bailout；legacy context 变化会阻止 Provider bailout 并重访 Child。
     *
     * 验证机制：分段日志区分 App-only 与 LegacyProvider/App/Child 路径。
     * 对应源码：`ReactFiberBeginWork.js` 的 `hasLegacyContextChanged()` 与 Context Provider bailout。
     */
    // @gate !disableLegacyContext
    it('provider does not bail out if legacy context changed above', async () => {
      const Context = React.createContext(0);

      /** Child 提供可观察叶子/静态 sibling，用于“祖先 legacy context 变化使新 Provider 放弃 bailout”。 */
      function Child() {
        Scheduler.log('Child');
        return <span prop="Child" />;
      }

      const children = <Child />;

      /** 定义 LegacyProvider 类 fixture，制造 class/PureComponent/legacy 边界，用于“祖先 legacy context 变化使新 Provider 放弃 bailout”。 */
      class LegacyProvider extends React.Component {
        /** LegacyProvider.childContextTypes 声明 legacy context schema，用于触发祖先 legacy context 变化。 */
        static childContextTypes = {
          /** LegacyProvider.legacyValue 定义 legacy context value 的运行时类型校验器。 */
          legacyValue: () => {},
        };
        /** LegacyProvider.state 保存驱动本场景的实例 state，区分组件更新与 Context 传播来源。 */
        state = {legacyValue: 1};
        /** LegacyProvider.getChildContext 从实例 state 发布 legacy context，驱动新 Provider bailout 失效场景。 */
        getChildContext() {
          return {legacyValue: this.state.legacyValue};
        }
        /** LegacyProvider.render 渲染当前 props/state/Context 并暴露可观察输出，用于“祖先 legacy context 变化使新 Provider 放弃 bailout”。 */
        render() {
          Scheduler.log('LegacyProvider');
          return this.props.children;
        }
      }

      /** 定义 App 类 fixture，制造 class/PureComponent/legacy 边界，用于“祖先 legacy context 变化使新 Provider 放弃 bailout”。 */
      class App extends React.Component {
        /** App.state 保存驱动本场景的实例 state，区分组件更新与 Context 传播来源。 */
        state = {value: 1};
        /** App.render 渲染当前 props/state/Context 并暴露可观察输出，用于“祖先 legacy context 变化使新 Provider 放弃 bailout”。 */
        render() {
          Scheduler.log('App');
          return (
            <Context.Provider value={this.state.value}>
              {this.props.children}
            </Context.Provider>
          );
        }
      }

      const legacyProviderRef = React.createRef();
      const appRef = React.createRef();

      // 首次挂载。
      ReactNoop.render(
        <LegacyProvider ref={legacyProviderRef}>
          <App ref={appRef} value={1}>
            {children}
          </App>
        </LegacyProvider>,
      );
      await waitForAll(['LegacyProvider', 'App', 'Child']);
      assertConsoleErrorDev([
        'LegacyProvider uses the legacy childContextTypes API which will soon be removed. ' +
          'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
          '    in LegacyProvider (at **)',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Child" />);

      // 以相同值更新 App，预期 bailout。
      appRef.current.setState({value: 1});
      await waitForAll(['App']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Child" />);

      // 更新 LegacyProvider，预期不 bailout。
      legacyProviderRef.current.setState({value: 1});
      await waitForAll(['LegacyProvider', 'App', 'Child']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Child" />);

      // 以相同值更新 App，预期 bailout。
      appRef.current.setState({value: 1});
      await waitForAll(['App']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Child" />);
    });
  });

  /** 组织“Context.Consumer”子场景，共享对应 API 的传播不变量。 */
  describe('Context.Consumer', () => {
    /**
     * Given：Context.Consumer 没有提供合法的单一函数 child。
     * When：渲染 Consumer 并等待 render prop 调用失败。
     * Then：开发态报告 children 形状错误，运行时抛出 is not a function。
     *
     * 验证机制：waitForThrow 与 console.error 文本共同验证错误和诊断。
     * 对应源码：`ReactFiberBeginWork.js` 的 `updateContextConsumer()`。
     */
    it('warns if child is not a function', async () => {
      spyOnDev(console, 'error').mockImplementation(() => {});
      const Context = React.createContext(0);
      ReactNoop.render(<Context.Consumer />);
      await waitForThrow('is not a function');
      if (__DEV__) {
        expect(console.error.mock.calls[0][0]).toContain(
          'A context consumer was rendered with multiple children, or a child ' +
            "that isn't a function",
        );
      }
    });

    /**
     * Given：Foo Consumer render prop 内通过 dispatcher readContext 读取 Bar，外层有 sCU=false 间接层。
     * When：分别更新 Foo 与 Bar Provider。
     * Then：任一依赖变化都唤醒同一 render prop，并组合最新 Foo/Bar 值。
     *
     * 验证机制：输出依次为 1/1、2/1、2/2，验证依赖链记录两个 Context。
     * 对应源码：`ReactFiberNewContext.js` 的 `prepareToReadContext()` 与 `readContextForConsumer()`。
     */
    it('can read other contexts inside consumer render prop', async () => {
      const FooContext = React.createContext(0);
      const BarContext = React.createContext(0);

      /** FooAndBar 在同一 render 中登记 Foo/Bar Context 依赖，并组合输出最新值。 */
      function FooAndBar() {
        return (
          <FooContext.Consumer>
            {foo => {
              const bar = readContext(BarContext);
              return <Text text={`Foo: ${foo}, Bar: ${bar}`} />;
            }}
          </FooContext.Consumer>
        );
      }

      /** 定义 Indirection 类 fixture，制造 class/PureComponent/legacy 边界，用于“Consumer render prop 内登记其他 Context 依赖”。 */
      class Indirection extends React.Component {
        /** Indirection.shouldComponentUpdate 固定返回 false，制造 props bailout 以验证 Context 的独立调度能力。 */
        shouldComponentUpdate() {
          return false;
        }
        /** Indirection.render 渲染当前 props/state/Context 并暴露可观察输出，用于“Consumer render prop 内登记其他 Context 依赖”。 */
        render() {
          return this.props.children;
        }
      }

      /** App 组织 Provider、Consumer 与 bailout 层级，并暴露场景更新入口，用于“Consumer render prop 内登记其他 Context 依赖”。 */
      function App(props) {
        return (
          <FooContext.Provider value={props.foo}>
            <BarContext.Provider value={props.bar}>
              <Indirection>
                <FooAndBar />
              </Indirection>
            </BarContext.Provider>
          </FooContext.Provider>
        );
      }

      ReactNoop.render(<App foo={1} bar={1} />);
      await waitForAll(['Foo: 1, Bar: 1']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Foo: 1, Bar: 1" />);

      // 只更新 foo。
      ReactNoop.render(<App foo={2} bar={1} />);
      await waitForAll(['Foo: 2, Bar: 1']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Foo: 2, Bar: 1" />);

      // 只更新 bar。
      ReactNoop.render(<App foo={2} bar={2} />);
      await waitForAll(['Foo: 2, Bar: 2']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Foo: 2, Bar: 2" />);
    });

    // 传播 deep update 时，若 `value` 未变化，Context Consumer 可以 bailout。
    // 但若上层组件本就重新渲染，Consumer 不能跳过本轮 render。
    // 若仅按引用相等 bailout，就会出现
    // 调用 this.setState() 却被 autobound render callback 阻断的反直觉行为。
    // 参考回归讨论：https://github.com/facebook/react/pull/12470#issuecomment-376917711。
    /**
     * Given：Context.Consumer Consumer 上方没有 Fiber bailout，实例 state 控制缓存的 render callback 输出。
     * When：只调用 App.setState 把文本 hello 更新为 goodbye。
     * Then：Context value 虽未变化，但正常父重渲染必须继续执行 Consumer/callback。
     *
     * 验证机制：App 与 renderConsumer 日志再次出现，输出更新为 goodbye。
     * 对应源码：`ReactFiberNewContext.js` 的 `readContextForConsumer()`、`propagateContextChanges()` 与 `ReactFiberBeginWork.js` 的 Context bailout。
     */
    it('consumer does not bail out if there were no bailouts above it', async () => {
      const Context = React.createContext(0);
      const Consumer = Context.Consumer;

      /** 定义 App 类 fixture，制造 class/PureComponent/legacy 边界，用于“Context.Consumer 在祖先未 bailout 时不按引用相等跳过自身更新”。 */
      class App extends React.Component {
        /** App.state 保存驱动本场景的实例 state，区分组件更新与 Context 传播来源。 */
        state = {
          text: 'hello',
        };

        /** App.renderConsumer 缓存 Consumer render callback，使实例 state 更新可独立验证 callback 是否执行。 */
        renderConsumer = context => {
          Scheduler.log('App#renderConsumer');
          return <span prop={this.state.text} />;
        };

        /** App.render 渲染当前 props/state/Context 并暴露可观察输出，用于“Context.Consumer 在祖先未 bailout 时不按引用相等跳过自身更新”。 */
        render() {
          Scheduler.log('App');
          return (
            <Context.Provider value={this.props.value}>
              <Consumer>{this.renderConsumer}</Consumer>
            </Context.Provider>
          );
        }
      }

      // 首次挂载。
      let inst;
      ReactNoop.render(<App value={1} ref={ref => (inst = ref)} />);
      await waitForAll(['App', 'App#renderConsumer']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="hello" />);

      // 执行更新。
      inst.setState({text: 'goodbye'});
      await waitForAll(['App', 'App#renderConsumer']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="goodbye" />);
    });
  });

  /** 组织“readContext”子场景，共享对应 API 的传播不变量。 */
  describe('readContext', () => {
    // Unstable changedBits API 已移除；Context selectors
    // 可用后应把此测试迁移过去。
    /**
     * Given：同一函数以不同 observed bits 读取 foo/bar，兄弟 Baz 读取另一 bit；旧 changedBits API 由 gate 保留。
     * When：依次只更新 foo、bar、baz。
     * Then：每轮只调度订阅对应 bit 的消费者，未匹配分支保持输出。
     *
     * 验证机制：Scheduler 与两段宿主数组逐轮验证选择性重渲染。
     * 对应源码：`ReactFiberNewContext.js` 的 Context dependency 链与 changed-bits 兼容路径。
     */
    // @gate FIXME
    it('can read the same context multiple times in the same function', async () => {
      const Context = React.createContext({foo: 0, bar: 0, baz: 0}, (a, b) => {
        let result = 0;
        if (a.foo !== b.foo) {
          result |= 0b001;
        }
        if (a.bar !== b.bar) {
          result |= 0b010;
        }
        if (a.baz !== b.baz) {
          result |= 0b100;
        }
        return result;
      });

      /** Provider 把受控 props 写入 Context，并保持 children 结构以隔离传播行为，用于“同一函数多次读取同一 Context 的依赖合并”。 */
      function Provider(props) {
        return (
          <Context.Provider
            value={{foo: props.foo, bar: props.bar, baz: props.baz}}>
            {props.children}
          </Context.Provider>
        );
      }

      /** FooAndBar 在同一 render 中登记 Foo/Bar Context 依赖，并组合输出最新值。 */
      function FooAndBar() {
        const {foo} = readContext(Context, 0b001);
        const {bar} = readContext(Context, 0b010);
        return <Text text={`Foo: ${foo}, Bar: ${bar}`} />;
      }

      /** Baz 单独登记 baz 依赖，验证同一 Context 的选择性订阅分支。 */
      function Baz() {
        const {baz} = readContext(Context, 0b100);
        return <Text text={'Baz: ' + baz} />;
      }

      /** 定义 Indirection 类 fixture，制造 class/PureComponent/legacy 边界，用于“同一函数多次读取同一 Context 的依赖合并”。 */
      class Indirection extends React.Component {
        /** Indirection.shouldComponentUpdate 固定返回 false，制造 props bailout 以验证 Context 的独立调度能力。 */
        shouldComponentUpdate() {
          return false;
        }
        /** Indirection.render 渲染当前 props/state/Context 并暴露可观察输出，用于“同一函数多次读取同一 Context 的依赖合并”。 */
        render() {
          return this.props.children;
        }
      }

      /** App 组织 Provider、Consumer 与 bailout 层级，并暴露场景更新入口，用于“同一函数多次读取同一 Context 的依赖合并”。 */
      function App(props) {
        return (
          <Provider foo={props.foo} bar={props.bar} baz={props.baz}>
            <Indirection>
              <Indirection>
                <FooAndBar />
              </Indirection>
              <Indirection>
                <Baz />
              </Indirection>
            </Indirection>
          </Provider>
        );
      }

      ReactNoop.render(<App foo={1} bar={1} baz={1} />);
      await waitForAll(['Foo: 1, Bar: 1', 'Baz: 1']);
      expect(ReactNoop).toMatchRenderedOutput([
        <span prop="Foo: 1, Bar: 1" />,
        <span prop="Baz: 1" />,
      ]);

      // 只更新 foo。
      ReactNoop.render(<App foo={2} bar={1} baz={1} />);
      await waitForAll(['Foo: 2, Bar: 1']);
      expect(ReactNoop).toMatchRenderedOutput([
        <span prop="Foo: 2, Bar: 1" />,
        <span prop="Baz: 1" />,
      ]);

      // 只更新 bar。
      ReactNoop.render(<App foo={2} bar={2} baz={1} />);
      await waitForAll(['Foo: 2, Bar: 2']);
      expect(ReactNoop).toMatchRenderedOutput([
        <span prop="Foo: 2, Bar: 2" />,
        <span prop="Baz: 1" />,
      ]);

      // 只更新 baz。
      ReactNoop.render(<App foo={2} bar={2} baz={2} />);
      await waitForAll(['Baz: 2']);
      expect(ReactNoop).toMatchRenderedOutput([
        <span prop="Foo: 2, Bar: 2" />,
        <span prop="Baz: 2" />,
      ]);
    });

    // 传播 deep update 时，若 `value` 未变化，Context Consumer 可以 bailout。
    // 但若上层组件本就重新渲染，Consumer 不能跳过本轮 render。
    // 若仅按引用相等 bailout，就会出现
    // 调用 this.setState() 却被 autobound render callback 阻断的反直觉行为。
    // 参考回归讨论：https://github.com/facebook/react/pull/12470#issuecomment-376917711。
    /**
     * Given：readContext Consumer 上方没有 Fiber bailout，实例 state 控制缓存的 render callback 输出。
     * When：只调用 App.setState 把文本 hello 更新为 goodbye。
     * Then：Context value 虽未变化，但正常父重渲染必须继续执行 Consumer/callback。
     *
     * 验证机制：App 与 renderConsumer 日志再次出现，输出更新为 goodbye。
     * 对应源码：`ReactFiberNewContext.js` 的 `readContextForConsumer()`、`propagateContextChanges()` 与 `ReactFiberBeginWork.js` 的 Context bailout。
     */
    it('does not bail out if there were no bailouts above it', async () => {
      const Context = React.createContext(0);

      /** 定义 Consumer 类 fixture，制造 class/PureComponent/legacy 边界，用于“readContext 在祖先未 bailout 时不按引用相等跳过自身更新”。 */
      class Consumer extends React.Component {
        /** Consumer.render 渲染当前 props/state/Context 并暴露可观察输出，用于“readContext 在祖先未 bailout 时不按引用相等跳过自身更新”。 */
        render() {
          const contextValue = readContext(Context);
          return this.props.children(contextValue);
        }
      }

      /** 定义 App 类 fixture，制造 class/PureComponent/legacy 边界，用于“readContext 在祖先未 bailout 时不按引用相等跳过自身更新”。 */
      class App extends React.Component {
        /** App.state 保存驱动本场景的实例 state，区分组件更新与 Context 传播来源。 */
        state = {
          text: 'hello',
        };

        /** App.renderConsumer 缓存 Consumer render callback，使实例 state 更新可独立验证 callback 是否执行。 */
        renderConsumer = context => {
          Scheduler.log('App#renderConsumer');
          return <span prop={this.state.text} />;
        };

        /** App.render 渲染当前 props/state/Context 并暴露可观察输出，用于“readContext 在祖先未 bailout 时不按引用相等跳过自身更新”。 */
        render() {
          Scheduler.log('App');
          return (
            <Context.Provider value={this.props.value}>
              <Consumer>{this.renderConsumer}</Consumer>
            </Context.Provider>
          );
        }
      }

      // 首次挂载。
      let inst;
      ReactNoop.render(<App value={1} ref={ref => (inst = ref)} />);
      await waitForAll(['App', 'App#renderConsumer']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="hello" />);

      // 执行更新。
      inst.setState({text: 'goodbye'});
      await waitForAll(['App', 'App#renderConsumer']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="goodbye" />);
    });

    /**
     * Given：class render 内调用 setState updater，并在 updater 回调中读取 Context。
     * When：Noop renderer 执行该 render-phase update。
     * Then：React 同时报告 render 中更新与脱离允许读取阶段的 Context 访问。
     *
     * 验证机制：assertConsoleErrorDev 逐条匹配两类诊断及组件栈。
     * 对应源码：`ReactFiberClassComponent.js` 的 render-phase update 校验与 `ReactFiberNewContext.js` 的 `readContextForConsumer()`。
     */
    it('warns when reading context inside render phase class setState updater', async () => {
      const ThemeContext = React.createContext('light');

      /** 定义 Cls 类 fixture，制造 class/PureComponent/legacy 边界，用于“class setState updater 中非法读取 Context 的诊断”。 */
      class Cls extends React.Component {
        /** Cls.state 保存驱动本场景的实例 state，区分组件更新与 Context 传播来源。 */
        state = {};
        /** Cls.render 渲染当前 props/state/Context 并暴露可观察输出，用于“class setState updater 中非法读取 Context 的诊断”。 */
        render() {
          this.setState(() => {
            readContext(ThemeContext);
          });
          return null;
        }
      }

      ReactNoop.render(<Cls />);
      await waitForAll([]);
      assertConsoleErrorDev([
        'Cannot update during an existing state transition (such as within `render`). ' +
          'Render methods should be a pure function of props and state.\n' +
          '    in Cls (at **)',
        'Context can only be read while React is rendering. ' +
          'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
          'In function components, you can read it directly in the function body, ' +
          'but not inside Hooks like useReducer() or useMemo().\n' +
          '    in Cls (at **)',
      ]);
    });
  });

  /** 组织“useContext”子场景，共享对应 API 的传播不变量。 */
  describe('useContext', () => {
    /**
     * Given：class render 直接调用 useContext，违反 Hooks 只能在函数组件调用的约束。
     * When：渲染该 class fixture。
     * Then：dispatcher 拒绝 hook 调用并抛出 Invalid hook call。
     *
     * 验证机制：waitForThrow 匹配完整三类原因与调试链接。
     * 对应源码：`ReactHooks.js` 的 `resolveDispatcher()` 与 `ReactFiberHooks.js` 的 Context hook。
     */
    it('throws when used in a class component', async () => {
      const Context = React.createContext(0);
      /** 定义 Foo 类 fixture，制造 class/PureComponent/legacy 边界，用于“class 组件调用 useContext 时抛错”。 */
      class Foo extends React.Component {
        /** Foo.render 渲染当前 props/state/Context 并暴露可观察输出，用于“class 组件调用 useContext 时抛错”。 */
        render() {
          return useContext(Context);
        }
      }
      ReactNoop.render(<Foo />);
      await waitForThrow(
        'Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen' +
          ' for one of the following reasons:\n' +
          '1. You might have mismatching versions of React and the renderer (such as React DOM)\n' +
          '2. You might be breaking the Rules of Hooks\n' +
          '3. You might have more than one copy of React in the same app\n' +
          'See https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem.',
      );
    });

    /**
     * Given：函数组件把 Context.Consumer 对象而非 Context 本体传给 useContext。
     * When：渲染并读取该错误参数。
     * Then：读取路径发出不支持 Consumer 包装对象的开发态告警。
     *
     * 验证机制：assertConsoleErrorDev 匹配建议改用 useContext(Context) 的诊断。
     * 对应源码：`ReactFiberNewContext.js` 的 `readContextForConsumer()` 开发态类型检查。
     */
    it('warns when passed a consumer', async () => {
      const Context = React.createContext(0);
      /** Foo 构造目标非法或告警调用位置，用于“useContext 接收 Context.Consumer 时告警”。 */
      function Foo() {
        return useContext(Context.Consumer);
      }
      ReactNoop.render(<Foo />);
      await waitForAll([]);
      assertConsoleErrorDev([
        'Calling useContext(Context.Consumer) is not supported and will cause bugs. ' +
          'Did you mean to call useContext(Context) instead?\n' +
          '    in Foo (at **)',
      ]);
    });

    // 传播 deep update 时，若 `value` 未变化，Context Consumer 可以 bailout。
    // 但若上层组件本就重新渲染，Consumer 不能跳过本轮 render。
    // 若仅按引用相等 bailout，就会出现
    // 调用 this.setState() 却被 autobound render callback 阻断的反直觉行为。
    // 参考回归讨论：https://github.com/facebook/react/pull/12470#issuecomment-376917711。
    /**
     * Given：useContext Consumer 上方没有 Fiber bailout，实例 state 控制缓存的 render callback 输出。
     * When：只调用 App.setState 把文本 hello 更新为 goodbye。
     * Then：Context value 虽未变化，但正常父重渲染必须继续执行 Consumer/callback。
     *
     * 验证机制：App 与 renderConsumer 日志再次出现，输出更新为 goodbye。
     * 对应源码：`ReactFiberHooks.js` 的 Context dependency 与正常函数组件更新。
     */
    it('does not bail out if there were no bailouts above it', async () => {
      const Context = React.createContext(0);

      /** Consumer 通过当前测试指定的 API 登记 Context 依赖，并调用 children render callback。 */
      function Consumer({children}) {
        const contextValue = useContext(Context);
        return children(contextValue);
      }

      /** 定义 App 类 fixture，制造 class/PureComponent/legacy 边界，用于“useContext 在祖先未 bailout 时不按引用相等跳过自身更新”。 */
      class App extends React.Component {
        /** App.state 保存驱动本场景的实例 state，区分组件更新与 Context 传播来源。 */
        state = {
          text: 'hello',
        };

        /** App.renderConsumer 缓存 Consumer render callback，使实例 state 更新可独立验证 callback 是否执行。 */
        renderConsumer = context => {
          Scheduler.log('App#renderConsumer');
          return <span prop={this.state.text} />;
        };

        /** App.render 渲染当前 props/state/Context 并暴露可观察输出，用于“useContext 在祖先未 bailout 时不按引用相等跳过自身更新”。 */
        render() {
          Scheduler.log('App');
          return (
            <Context.Provider value={this.props.value}>
              <Consumer>{this.renderConsumer}</Consumer>
            </Context.Provider>
          );
        }
      }

      // 首次挂载。
      let inst;
      ReactNoop.render(<App value={1} ref={ref => (inst = ref)} />);
      await waitForAll(['App', 'App#renderConsumer']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="hello" />);

      // 执行更新。
      inst.setState({text: 'goodbye'});
      await waitForAll(['App', 'App#renderConsumer']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="goodbye" />);
    });
  });

  /**
   * Given：Provider 在 host complete 阶段抛错，可能留下错位的 Context 栈。
   * When：捕获首个 host error 后渲染 value=10 的新 Provider/Consumer 树。
   * Then：complete/unwind 正确 pop 旧值，后续 Consumer 读取 10。
   *
   * 验证机制：waitForThrow 后的宿主输出 10 验证跨 render 栈未污染。
   * 对应源码：`ReactFiberCompleteWork.js`、`ReactFiberUnwindWork.js` 与 `ReactFiberNewContext.js` 的 `popProvider()`。
   */
  it('unwinds after errors in complete phase', async () => {
    const Context = React.createContext(0);

    // 回归场景：错误位置 unwind Context
    // 曾导致栈错位。
    ReactNoop.render(
      <errorInCompletePhase>
        <Context.Provider value={null} />
      </errorInCompletePhase>,
    );
    await waitForThrow('Error in host config.');

    ReactNoop.render(
      <Context.Provider value={10}>
        <Context.Consumer>{value => <span prop={value} />}</Context.Consumer>
      </Context.Provider>,
    );
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop={10} />);
  });

  /** 用可重放 seed 和调度动作随机交错 Context 更新，验证任意提交切片的一致性。 */
  describe('fuzz test', () => {
    const contextKeys = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

    const FLUSH_ALL = 'FLUSH_ALL';
    /** flushAll 构造“冲刷全部工作”动作，供 fuzz 模拟器解释。 */
    function flushAll() {
      return {
        type: FLUSH_ALL,
        /** flushAll.toString 把动作序列化为可复制的 `flushAll()` 重放表达式。 */
        toString() {
          return `flushAll()`;
        },
      };
    }

    const FLUSH = 'FLUSH';
    /** flush 构造限定 unitsOfWork 的分段调度动作。 */
    function flush(unitsOfWork) {
      return {
        type: FLUSH,
        unitsOfWork,
        /** flush.toString 把工作预算序列化为可复制的分段 flush 表达式。 */
        toString() {
          return `flush(${unitsOfWork})`;
        },
      };
    }

    const UPDATE = 'UPDATE';
    /** update 构造指定 Context key/value 的更新动作。 */
    function update(key, value) {
      return {
        type: UPDATE,
        key,
        value,
        /** update.toString 把 Context key/value 序列化为可复制的更新表达式。 */
        toString() {
          return `update('${key}', ${value})`;
        },
      };
    }

    /** randomInteger 生成左闭右开的随机整数，作为 fuzz key、value 与工作预算来源。 */
    function randomInteger(min, max) {
      min = Math.ceil(min);
      max = Math.floor(max);
      return Math.floor(Math.random() * (max - min)) + min;
    }

    /** randomAction 在 flushAll、分段 flush 和 Context update 三类动作间随机选择。 */
    function randomAction() {
      switch (randomInteger(0, 3)) {
        case 0:
          return flushAll();
        case 1:
          return flush(randomInteger(0, 500));
        case 2:
          const key = contextKeys[randomInteger(0, contextKeys.length)];
          const value = randomInteger(1, 10);
          return update(key, value);
        default:
          throw new Error('Switch statement should be exhaustive');
      }
    }

    /** randomActions 生成固定长度的随机动作序列。 */
    function randomActions(n) {
      const actions = [];
      for (let i = 0; i < n; i++) {
        actions.push(randomAction());
      }
      return actions;
    }

    /** ContextSimulator 构建多 Context 随机消费树，并返回可按 seed 重放的 simulate 入口。 */
    function ContextSimulator(maxDepth) {
      const contexts = new Map(
        contextKeys.map(key => {
          const Context = React.createContext(0);
          Context.displayName = 'Context' + key;
          return [key, Context];
        }),
      );

      /** ConsumerTree 递归生成三个随机 Context 分支，并固定 props bailout；只有所选 Context dependency 能重新唤醒对应节点。 */
      class ConsumerTree extends React.Component {
        /** ContextSimulator.ConsumerTree.shouldComponentUpdate 固定返回 false，制造 props bailout 以验证 Context 的独立调度能力。 */
        shouldComponentUpdate() {
          return false;
        }
        /** ConsumerTree.render 在 maxDepth 截止递归，并用 seed 选择 Context key；叶子文本编码 key/value 供一致性扫描。 */
        render() {
          Scheduler.log();
          if (this.props.depth >= this.props.maxDepth) {
            return null;
          }
          const consumers = [0, 1, 2].map(i => {
            const randomKey =
              contextKeys[
                this.props.rand.intBetween(0, contextKeys.length - 1)
              ];
            const Context = contexts.get(randomKey);
            return (
              <Context.Consumer key={i}>
                {value => (
                  <>
                    <span prop={`${randomKey}:${value}`} />
                    <ConsumerTree
                      rand={this.props.rand}
                      depth={this.props.depth + 1}
                      maxDepth={this.props.maxDepth}
                    />
                  </>
                )}
              </Context.Consumer>
            );
          });
          return consumers;
        }
      }

      /** Root 按固定 key 顺序嵌套所有 fuzz Provider，并把当前值传给随机 ConsumerTree。 */
      function Root(props) {
        return contextKeys.reduceRight(
          (children, key) => {
            const Context = contexts.get(key);
            const value = props.values[key];
            return (
              <Context.Provider value={value}>{children}</Context.Provider>
            );
          },
          <ConsumerTree
            rand={props.rand}
            depth={0}
            maxDepth={props.maxDepth}
          />,
        );
      }

      const initialValues = contextKeys.reduce(
        (result, key, i) => ({...result, [key]: i + 1}),
        {},
      );

      /** assertConsistentTree 扫描已提交叶子，确保同一 Context key 在任意切片中只有一个值。 */
      function assertConsistentTree(expectedValues = {}) {
        const jsx = ReactNoop.getChildrenAsJSX();
        const children = jsx === null ? [] : jsx.props.children;
        children.forEach(child => {
          const text = child.props.prop;
          const key = text[0];
          const value = parseInt(text[2], 10);
          const expectedValue = expectedValues[key];
          if (expectedValue === undefined) {
            // 若调用方没有显式传入某个 key 的期望值，
            // 以首次出现的值建立该 key 的本轮基准。
            expectedValues[key] = value;
          } else if (value !== expectedValue) {
            throw new Error(
              `Inconsistent value! Expected: ${key}:${expectedValue}. Actual: ${text}`,
            );
          }
        });
      }

      /** simulate 按 seed 重建随机树并解释动作序列，逐步校验中间提交和最终 Context 一致性。 */
      function simulate(seed, actions) {
        const rand = gen.create(seed);
        let finalExpectedValues = initialValues;
        /** updateRoot 用当前 expected values 重新提交 fuzz Root，形成下一次可中断更新。 */
        function updateRoot() {
          ReactNoop.render(
            <Root
              maxDepth={maxDepth}
              rand={rand}
              values={finalExpectedValues}
            />,
          );
        }
        updateRoot();

        actions.forEach(action => {
          // 每个动作后都检查当前已提交切片：flush 只推进工作，update 先替换期望值再调度新 Root。
          switch (action.type) {
            case FLUSH_ALL:
              Scheduler.unstable_flushAllWithoutAsserting();
              break;
            case FLUSH:
              Scheduler.unstable_flushNumberOfYields(action.unitsOfWork);
              break;
            case UPDATE:
              finalExpectedValues = {
                ...finalExpectedValues,
                [action.key]: action.value,
              };
              updateRoot();
              break;
            default:
              throw new Error('Switch statement should be exhaustive');
          }
          assertConsistentTree();
        });

        Scheduler.unstable_flushAllWithoutAsserting();
        assertConsistentTree(finalExpectedValues);
      }

      return {simulate};
    }

    /**
     * Given：固定 seed 构造深度 5 的随机 Context 消费树，并给出可复现 flush/update 动作。
     * When：先 flush 三个工作单元，再更新 Context A 为 4。
     * Then：任意已提交切片中同一 Context key 的值保持全树一致。
     *
     * 验证机制：assertConsistentTree 扫描所有宿主叶子，并在最终 flush 后核对期望值。
     * 对应源码：`ReactFiberNewContext.js` 的传播 walker 与 Scheduler 分段提交路径。
     */
    it('hard-coded tests', () => {
      const {simulate} = ContextSimulator(5);
      simulate('randomSeed', [flush(3), update('A', 4)]);
    });

    /**
     * Given：每轮生成随机 seed、五个 flush/update 动作和深度 5 的消费树。
     * When：连续执行 100 组分段调度与 Context 更新。
     * Then：任意中间/最终已提交树都不混用同一 Context 的新旧值。
     *
     * 验证机制：一致性扫描失败时打印可复制 seed/actions，随后重新抛错。
     * 对应源码：`ReactFiberNewContext.js` 的传播 walker、lanes 标记与 Scheduler yield 路径。
     */
    it('generated tests', () => {
      const {simulate} = ContextSimulator(5);

      const LIMIT = 100;
      for (let i = 0; i < LIMIT; i++) {
        const seed = Math.random().toString(36).slice(2, 7);
        const actions = randomActions(5);
        try {
          simulate(seed, actions);
        } catch (error) {
          console.error(`
Context fuzz tester error! Copy and paste the following line into the test suite:
  simulate('${seed}', ${actions.join(', ')});
`);
          throw error;
        }
      }
    });
  });

  /**
   * Given：createContext 返回对象的 Provider 属性与 Context 本体应为同一引用。
   * When：使用 `<BarContext value>` 简写提供更新对象。
   * Then：reconciler 把 Context 元素按 Provider 处理，Consumer 读取 bar-updated。
   *
   * 验证机制：引用相等断言与最终宿主文本共同验证 API/运行时语义。
   * 对应源码：`ReactContext.js` 的 `createContext()` 与 `ReactFiberBeginWork.js` 的 `updateContextProvider()`。
   */
  it('should treat Context as Context.Provider', async () => {
    const BarContext = React.createContext({value: 'bar-initial'});
    expect(BarContext.Provider).toBe(BarContext);

    /** Component 使用 Context 本体作为 Provider，并由 Consumer 验证简写读取结果。 */
    function Component() {
      return (
        <BarContext value={{value: 'bar-updated'}}>
          <BarContext.Consumer>
            {({value}) => <span prop={value} />}
          </BarContext.Consumer>
        </BarContext>
      );
    }

    ReactNoop.render(<Component />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="bar-updated" />);
  });
});
