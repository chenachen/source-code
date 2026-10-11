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
let ReactDOM;
let ReactDOMClient;
let ReactDOMServer;
let PropTypes;
let act;
let useMemo;
let useState;
let useReducer;
let assertConsoleErrorDev;
let assertConsoleWarnDev;

describe('ReactStrictMode', () => {
  beforeEach(() => {
    // 每例重置React/DOM/server及断言工具；其余describe另重新加载并初始化自己的日志/spy，隔离严格诊断类型缓存。
    jest.resetModules();
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    ({
      act,
      assertConsoleErrorDev,
      assertConsoleWarnDev,
    } = require('internal-test-utils'));
    useMemo = React.useMemo;
    useState = React.useState;
    useReducer = React.useReducer;
  });

  /** StrictMode 包 Foo，Foo 输出非法 ariaTypo div，客户端 act 挂载要求诊断栈为 div/Foo；期望中没有 StrictMode 帧，验证透明边界下真实组件定位。 */
  it('should appear in the client component stack', async () => {
    /** 返回带非法 ariaTypo 的 div，在 client/SSR 路径触发宿主属性诊断，供 StrictMode 透明栈帧检查。 */
    function Foo() {
      return <div ariaTypo="" />;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <React.StrictMode>
          <Foo />
        </React.StrictMode>,
      );
    });
    assertConsoleErrorDev([
      'Invalid ARIA attribute `ariaTypo`. ' +
        'ARIA attributes follow the pattern aria-* and must be lowercase.\n' +
        '    in div (at **)\n' +
        '    in Foo (at **)',
    ]);
  });

  /** StrictMode 包同样非法 ariaTypo 的 Foo，以 renderToString 同步 SSR；诊断栈为 div/Foo，没有 StrictMode 帧，验证服务端同一定位。 */
  it('should appear in the SSR component stack', () => {
    /** 返回带非法 ariaTypo 的 div，在 client/SSR 路径触发宿主属性诊断，供 StrictMode 透明栈帧检查。 */
    function Foo() {
      return <div ariaTypo="" />;
    }

    ReactDOMServer.renderToString(
      <React.StrictMode>
        <Foo />
      </React.StrictMode>,
    );
    assertConsoleErrorDev([
      'Invalid ARIA attribute `ariaTypo`. ' +
        'ARIA attributes follow the pattern aria-* and must be lowercase.\n' +
        '    in div (at **)\n' +
        '    in Foo (at **)',
    ]);
  });

  // @gate __DEV__
  // @gate !disableLegacyMode
  /** 仅 DEV且旧根开启时运行：旧 ReactDOM.render 挂 Strict class，挂载构造/派生/render双调用而 didMount一次；SCU=true更新双派生/SCU/render、didUpdate一次，SCU=false仅双派生/SCU，验证提交前检查与提交钩子区分。 */
  it('should invoke only precommit lifecycle methods twice in legacy roots', async () => {
    let log = [];
    let shouldComponentUpdate = false;
    /** 记录构造、派生、SCU、render及提交钩子的 class；外部 shouldComponentUpdate 控制更新允许/跳过，供旧根双试算对照。 */
    class ClassComponent extends React.Component {
      /** 空对象初值，避免派生状态形状告警，让日志只反映 Strict 检查。 */
      state = {};
      /** 记录派生调用并返回 null 不改状态；存在该API使旧不安全生命周期不参与。 */
      static getDerivedStateFromProps() {
        log.push('getDerivedStateFromProps');
        return null;
      }
      /** 把 props 交给基类并记录 constructor，供DEV两次构造与生产单次比较。 */
      constructor(props) {
        super(props);
        log.push('constructor');
      }
      /** 记录挂载提交阶段；旧根的 Strict 双试算后本例期望仅一次此钩子。 */
      componentDidMount() {
        log.push('componentDidMount');
      }
      /** 记录成功更新的提交阶段，供与双派生/SCU/render试算区分。 */
      componentDidUpdate() {
        log.push('componentDidUpdate');
      }
      /** 记录卸载提交阶段；本例主断言没有主动卸载此实例，保留fixture完整性。 */
      componentWillUnmount() {
        log.push('componentWillUnmount');
      }
      /** 记录SCU并返回外部开关，控制同树更新是否执行render/提交更新钩子。 */
      shouldComponentUpdate() {
        log.push('shouldComponentUpdate');
        return shouldComponentUpdate;
      }
      /** 记录render后返回null，不输出宿主；供允许更新与SCU跳过的日志对照。 */
      render() {
        log.push('render');
        return null;
      }
    }

    const container = document.createElement('div');
    ReactDOM.render(
      <React.StrictMode>
        <ClassComponent />
      </React.StrictMode>,
      container,
    );

    expect(log).toEqual([
      'constructor',
      'constructor',
      'getDerivedStateFromProps',
      'getDerivedStateFromProps',
      'render',
      'render',
      'componentDidMount',
    ]);

    log = [];
    shouldComponentUpdate = true;

    ReactDOM.render(
      <React.StrictMode>
        <ClassComponent />
      </React.StrictMode>,
      container,
    );
    expect(log).toEqual([
      'getDerivedStateFromProps',
      'getDerivedStateFromProps',
      'shouldComponentUpdate',
      'shouldComponentUpdate',
      'render',
      'render',
      'componentDidUpdate',
    ]);

    log = [];
    shouldComponentUpdate = false;

    ReactDOM.render(
      <React.StrictMode>
        <ClassComponent />
      </React.StrictMode>,
      container,
    );

    expect(log).toEqual([
      'getDerivedStateFromProps',
      'getDerivedStateFromProps',
      'shouldComponentUpdate',
      'shouldComponentUpdate',
    ]);
  });

  /** 初始 class state.count=1，Strict root 中调用函数式 setState并统计 updater；DEV两次、生产一次，但提交 count=2，验证重复计算不叠加状态。题名 callback 实际是 updater，无提交 callback 参数。 */
  it('should invoke setState callbacks twice', async () => {
    let instance;
    /** 初始count=1且render暴露实例的class，供函数式setState重复检查后最终只加一的断言。 */
    class ClassComponent extends React.Component {
      /** 初始count=1，两个updater试算都应基于该先前值，而提交结果为2。 */
      state = {
        count: 1,
      };
      /** 保存this到instance后返回null，便于用例直接调用setState和读提交state。 */
      render() {
        instance = this;
        return null;
      }
    }

    let setStateCount = 0;

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <React.StrictMode>
          <ClassComponent />
        </React.StrictMode>,
      );
    });
    await act(() => {
      instance.setState(state => {
        setStateCount++;
        return {
          count: state.count + 1,
        };
      });
    });

    // DEV StrictMode 会调用 setState updater 两次以暴露非幂等逻辑。
    expect(setStateCount).toBe(__DEV__ ? 2 : 1);
    // 两次调用都必须接收同一个先前 state，不能把第一次试运行结果泄漏给第二次。
    expect(instance.state.count).toBe(2);
  });

  // @gate __DEV__
  /** 仅 DEV：Strict App 的 useState惰性初值1、useReducer第三参数初值2各记日志两次，宿主最终文本3，验证初始化器重复检查。 */
  it('double invokes useState and useReducer initializers functions', async () => {
    const log = [];

    /** 调用useState/reducer惰性初始函数记录1/2两种计算，再返回3；不使用返回state驱动文本，仅观察初始化次数。 */
    function App() {
      React.useState(() => {
        log.push('Compute initial state count: 1');
        return 1;
      });
      React.useReducer(
        s => s,
        2,
        s => {
          log.push('Compute initial reducer count: 2');
          return s;
        },
      );

      return 3;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <React.StrictMode>
          <App />
        </React.StrictMode>,
      );
    });
    expect(container.textContent).toBe('3');

    expect(log).toEqual([
      'Compute initial state count: 1',
      'Compute initial state count: 1',
      'Compute initial reducer count: 2',
      'Compute initial reducer count: 2',
    ]);
  });

  // @gate !disableLegacyMode
  /** 旧根开启：Root 返回 Strict class，挂载及 SCU=true/false两更新比较 DEV双提交前调用、生产单次，提交钩子均一次，验证构建差异。 */
  it('should invoke only precommit lifecycle methods twice in DEV legacy roots', async () => {
    const {StrictMode} = React;

    let log = [];
    let shouldComponentUpdate = false;

    /** 返回StrictMode包ClassComponent，为旧根DEV/生产生命周期比较提供函数祖先。 */
    function Root() {
      return (
        <StrictMode>
          <ClassComponent />
        </StrictMode>
      );
    }

    /** 记录构造、派生、SCU、render及提交钩子的 class；外部 shouldComponentUpdate 控制更新允许/跳过，供旧根双试算对照。 */
    class ClassComponent extends React.Component {
      /** 空对象初值，避免派生状态形状告警，让日志只反映 Strict 检查。 */
      state = {};
      /** 记录派生调用并返回 null 不改状态；存在该API使旧不安全生命周期不参与。 */
      static getDerivedStateFromProps() {
        log.push('getDerivedStateFromProps');
        return null;
      }
      /** 把 props 交给基类并记录 constructor，供DEV两次构造与生产单次比较。 */
      constructor(props) {
        super(props);
        log.push('constructor');
      }
      /** 记录挂载提交阶段；旧根的 Strict 双试算后本例期望仅一次此钩子。 */
      componentDidMount() {
        log.push('componentDidMount');
      }
      /** 记录成功更新的提交阶段，供与双派生/SCU/render试算区分。 */
      componentDidUpdate() {
        log.push('componentDidUpdate');
      }
      /** 记录卸载提交阶段；本例主断言没有主动卸载此实例，保留fixture完整性。 */
      componentWillUnmount() {
        log.push('componentWillUnmount');
      }
      /** 记录SCU并返回外部开关，控制同树更新是否执行render/提交更新钩子。 */
      shouldComponentUpdate() {
        log.push('shouldComponentUpdate');
        return shouldComponentUpdate;
      }
      /** 记录render后返回null，不输出宿主；供允许更新与SCU跳过的日志对照。 */
      render() {
        log.push('render');
        return null;
      }
    }

    const container = document.createElement('div');
    ReactDOM.render(<Root />, container);

    if (__DEV__) {
      expect(log).toEqual([
        'constructor',
        'constructor',
        'getDerivedStateFromProps',
        'getDerivedStateFromProps',
        'render',
        'render',
        'componentDidMount',
      ]);
    } else {
      expect(log).toEqual([
        'constructor',
        'getDerivedStateFromProps',
        'render',
        'componentDidMount',
      ]);
    }

    log = [];
    shouldComponentUpdate = true;

    ReactDOM.render(<Root />, container);
    if (__DEV__) {
      expect(log).toEqual([
        'getDerivedStateFromProps',
        'getDerivedStateFromProps',
        'shouldComponentUpdate',
        'shouldComponentUpdate',
        'render',
        'render',
        'componentDidUpdate',
      ]);
    } else {
      expect(log).toEqual([
        'getDerivedStateFromProps',
        'shouldComponentUpdate',
        'render',
        'componentDidUpdate',
      ]);
    }

    log = [];
    shouldComponentUpdate = false;

    ReactDOM.render(<Root />, container);
    if (__DEV__) {
      expect(log).toEqual([
        'getDerivedStateFromProps',
        'getDerivedStateFromProps',
        'shouldComponentUpdate',
        'shouldComponentUpdate',
      ]);
    } else {
      expect(log).toEqual([
        'getDerivedStateFromProps',
        'shouldComponentUpdate',
      ]);
    }
  });

  /** 解构 StrictMode 后重复 class 函数式 setState场景，updater次数DEV2/生产1且state.count=2，验证两次试算同基准。实际仍未传提交callback。 */
  it('should invoke setState callbacks twice in DEV', async () => {
    const {StrictMode} = React;

    let instance;
    /** 初始count=1且render暴露实例的class，供函数式setState重复检查后最终只加一的断言。 */
    class ClassComponent extends React.Component {
      /** 初始count=1，两个updater试算都应基于该先前值，而提交结果为2。 */
      state = {
        count: 1,
      };
      /** 保存this到instance后返回null，便于用例直接调用setState和读提交state。 */
      render() {
        instance = this;
        return null;
      }
    }

    let setStateCount = 0;

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <StrictMode>
          <ClassComponent />
        </StrictMode>,
      );
    });
    await act(() => {
      instance.setState(state => {
        setStateCount++;
        return {
          count: state.count + 1,
        };
      });
    });

    // DEV StrictMode 会调用 setState updater 两次以暴露非幂等逻辑。
    expect(setStateCount).toBe(__DEV__ ? 2 : 1);
    // 两次调用都必须接收同一个先前 state，不能把第一次试运行结果泄漏给第二次。
    expect(instance.state.count).toBe(2);
  });

  // @gate __DEV__
  /** 仅 DEV：useMemo把text变大写，hello初挂与goodbye更新分别计算两次，宿主HELLO/GOODBYE，验证依赖变化的计算重复检查。 */
  it('double invokes useMemo functions', async () => {
    let log = [];

    /** 以text作useMemo依赖，计算大写字符串并记日志，返回该字符串；供挂载与依赖变更两阶段双计算检查。 */
    function Uppercased({text}) {
      return useMemo(() => {
        const uppercased = text.toUpperCase();
        log.push('Compute toUpperCase: ' + uppercased);
        return uppercased;
      }, [text]);
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    // 挂载阶段：验证初始化函数的双调用行为。
    await act(() => {
      root.render(
        <React.StrictMode>
          <Uppercased text="hello" />
        </React.StrictMode>,
      );
    });
    expect(container.textContent).toBe('HELLO');
    expect(log).toEqual([
      'Compute toUpperCase: HELLO',
      'Compute toUpperCase: HELLO',
    ]);

    log = [];

    // 更新阶段：验证后续计算仍遵循 StrictMode 调用契约。
    await act(() => {
      root.render(
        <React.StrictMode>
          <Uppercased text="goodbye" />
        </React.StrictMode>,
      );
    });
    expect(container.textContent).toBe('GOODBYE');
    expect(log).toEqual([
      'Compute toUpperCase: GOODBYE',
      'Compute toUpperCase: GOODBYE',
    ]);
  });

  // @gate __DEV__
  /** 仅 DEV：useMemo返回新对象，hello初挂及goodbye更新各计算两次、两个render结果对象严格同引用，验证丢弃第二次试算值并复用第一次记忆化结果。 */
  it('double invokes useMemo functions with first result', async () => {
    let log = [];
    /** memo计算返回{uppercased}，render再将实际记忆结果对象记入log并输出字段；供两个render严格引用比较。 */
    function Uppercased({text}) {
      const memoizedResult = useMemo(() => {
        const uppercased = text.toUpperCase();
        log.push('Compute toUpperCase: ' + uppercased);
        return {uppercased};
      }, [text]);

      // 记录 memo 结果引用，用于确认两次调用复用同一个记忆化结果。
      log.push(memoizedResult);

      return memoizedResult.uppercased;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    // 挂载阶段：收集两次 memo 计算与渲染结果。
    await act(() => {
      root.render(
        <React.StrictMode>
          <Uppercased text="hello" />
        </React.StrictMode>,
      );
    });
    expect(container.textContent).toBe('HELLO');
    expect(log).toEqual([
      'Compute toUpperCase: HELLO',
      'Compute toUpperCase: HELLO',
      {uppercased: 'HELLO'},
      {uppercased: 'HELLO'},
    ]);

    // 虽然 memo 计算函数执行两次，两次渲染必须得到同一对象引用。
    expect(log[2]).toBe(log[3]);

    log = [];

    // 更新阶段：依赖变化后重新计算，同时保持两次调用间的结果复用。
    await act(() => {
      root.render(
        <React.StrictMode>
          <Uppercased text="goodbye" />
        </React.StrictMode>,
      );
    });
    expect(container.textContent).toBe('GOODBYE');
    expect(log).toEqual([
      'Compute toUpperCase: GOODBYE',
      'Compute toUpperCase: GOODBYE',
      {uppercased: 'GOODBYE'},
      {uppercased: 'GOODBYE'},
    ]);

    // 虽然 memo 计算函数执行两次，两次渲染必须得到同一对象引用。
    expect(log[2]).toBe(log[3]);
  });

  // @gate __DEV__
  /** 仅 DEV：Hook初值0，外部setCount函数式返回1并记日志；输出变1而计算日志两次，验证Hook updater重复检查。 */
  it('double invokes setState updater functions', async () => {
    const log = [];

    let setCount;
    /** useState(0)并把setter暴露给外部setCount，返回count文本，供函数式Hook updater次数检查。 */
    function App() {
      const [count, _setCount] = useState(0);
      setCount = _setCount;
      return count;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(
        <React.StrictMode>
          <App />
        </React.StrictMode>,
      );
    });
    expect(container.textContent).toBe('0');

    await act(() => {
      setCount(() => {
        log.push('Compute count: 1');
        return 1;
      });
    });
    expect(container.textContent).toBe('1');
    expect(log).toEqual(['Compute count: 1', 'Compute count: 1']);
  });

  // @gate __DEV__
  /** 仅 DEV：useReducer初值0，外部dispatch(1)；reducer日志两次且宿主1，验证动作计算重复而状态不累积。 */
  it('double invokes reducer functions', async () => {
    const log = [];

    /** 记录action并原样返回为下一state；prevState未用，供同动作两次试算而输出只更新一次的检查。 */
    function reducer(prevState, action) {
      log.push('Compute new state: ' + action);
      return action;
    }

    let dispatch;
    /** useReducer(reducer,0)并把dispatch暴露外部，返回count文本，供动作计算次数检查。 */
    function App() {
      const [count, _dispatch] = useReducer(reducer, 0);
      dispatch = _dispatch;
      return count;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(
        <React.StrictMode>
          <App />
        </React.StrictMode>,
      );
    });
    expect(container.textContent).toBe('0');

    await act(() => {
      dispatch(1);
    });
    expect(container.textContent).toBe('1');
    expect(log).toEqual(['Compute new state: 1', 'Compute new state: 1']);
  });
});

describe('Concurrent Mode', () => {
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
  });

  /** StrictRoot 内App有不安全mount/update，深层Foo重复及Bar有receive；首次按钩子名聚合类型且Bar/Foo排序去重，之后换到非Strict App完成无新预期诊断，验证范围和类型去重。 */
  it('should warn about unsafe legacy lifecycle methods anywhere in a StrictMode tree', async () => {
    /** 把App整个复杂后代树放进StrictMode，供深层UNSAFE钩子聚合。 */
    function StrictRoot() {
      return (
        <React.StrictMode>
          <App />
        </React.StrictMode>
      );
    }
    /** 包含UNSAFE mount/update并渲染Wrapper→Foo及Bar/Foo兄弟，构造不同深度与重复类型诊断。 */
    class App extends React.Component {
      /** 空不安全钩子仅靠方法存在触发Strict诊断；无状态/日志副作用。 */
      UNSAFE_componentWillMount() {}
      /** 空不安全钩子仅靠方法存在触发Strict诊断；无状态/日志副作用。 */
      UNSAFE_componentWillUpdate() {}
      /** 构造Wrapper中的Foo和兄弟Bar/Foo，验证Strict深层扫描及同类型警告去重。 */
      render() {
        return (
          <div>
            <Wrapper>
              <Foo />
            </Wrapper>
            <div>
              <Bar />
              <Foo />
            </div>
          </div>
        );
      }
    }
    /** 把children包div，给Foo增加普通函数/宿主层级，检查严格标记仍传播。 */
    function Wrapper({children}) {
      return <div>{children}</div>;
    }
    /** 带空UNSAFE接收props方法的叶class，供Strict警告按方法名合并并按类型去重。 */
    class Foo extends React.Component {
      /** 空UNSAFE接收钩子，以存在性触发Strict诊断，本体不读nextProps或修改state。 */
      UNSAFE_componentWillReceiveProps() {}
      /** 返回null，让不安全生命周期名称诊断不受宿主输出或其它错误干扰。 */
      render() {
        return null;
      }
    }
    /** 带空UNSAFE接收props方法的叶class，供Strict警告按方法名合并并按类型去重。 */
    class Bar extends React.Component {
      /** 空UNSAFE接收钩子，以存在性触发Strict诊断，本体不读nextProps或修改state。 */
      UNSAFE_componentWillReceiveProps() {}
      /** 返回null，让不安全生命周期名称诊断不受宿主输出或其它错误干扰。 */
      render() {
        return null;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<StrictRoot />));
    assertConsoleErrorDev([
      `Using UNSAFE_componentWillMount in strict mode is not recommended and may indicate bugs in your code. See https://react.dev/link/unsafe-component-lifecycles for details.

* Move code with side effects to componentDidMount, and set initial state in the constructor.

Please update the following components: App`,
      `Using UNSAFE_componentWillReceiveProps in strict mode is not recommended and may indicate bugs in your code. See https://react.dev/link/unsafe-component-lifecycles for details.

* Move data fetching code or side effects to componentDidUpdate.
* If you're updating state whenever props change, refactor your code to use memoization techniques or move it to static getDerivedStateFromProps. Learn more at: https://react.dev/link/derived-state

Please update the following components: Bar, Foo`,
      `Using UNSAFE_componentWillUpdate in strict mode is not recommended and may indicate bugs in your code. See https://react.dev/link/unsafe-component-lifecycles for details.

* Move data fetching code or side effects to componentDidUpdate.

Please update the following components: App`,
    ]);

    // 同一组件类型的重复诊断必须去重。
    await act(() => root.render(<App />));
  });

  /** Strict App的UNSAFE钩子、Parent旧名三钩子及Child UNSAFE receive并存；首次分别error聚合UNSAFE、warn聚合旧名，重复渲染无新预期诊断，验证诊断通道分开。 */
  it('should coalesce warnings by lifecycle name', async () => {
    /** 将App→Parent→Child放进Strict，供UNSAFE error与旧名warn两通道聚合。 */
    function StrictRoot() {
      return (
        <React.StrictMode>
          <App />
        </React.StrictMode>
      );
    }
    /** 带UNSAFE mount/update并返回Parent，供不安全钩子与旧名钩子的聚合区分。 */
    class App extends React.Component {
      /** 空不安全钩子仅靠方法存在触发Strict诊断；无状态/日志副作用。 */
      UNSAFE_componentWillMount() {}
      /** 空不安全钩子仅靠方法存在触发Strict诊断；无状态/日志副作用。 */
      UNSAFE_componentWillUpdate() {}
      /** 返回旧名生命周期Parent，再由它渲染UNSAFE Child，形成诊断链。 */
      render() {
        return <Parent />;
      }
    }
    /** 带三个旧名生命周期的中间类，供console.warn改名建议，与UNSAFE error分开。 */
    class Parent extends React.Component {
      /** 空旧名钩子，以方法存在触发改名建议；无初始化、更新或订阅副作用。 */
      componentWillMount() {}
      /** 空旧名钩子，以方法存在触发改名建议；无初始化、更新或订阅副作用。 */
      componentWillUpdate() {}
      /** 空旧名钩子，以方法存在触发改名建议；无初始化、更新或订阅副作用。 */
      componentWillReceiveProps() {}
      /** 返回UNSAFE接收props的Child，构造同时存在旧名与新前缀的诊断树。 */
      render() {
        return <Child />;
      }
    }
    /** 带UNSAFE接收props的叶类，位于旧名Parent下，供Strict error聚合。 */
    class Child extends React.Component {
      /** 空UNSAFE接收钩子，作为Child类型的Strict诊断输入。 */
      UNSAFE_componentWillReceiveProps() {}
      /** 返回null，让不安全生命周期名称诊断不受宿主输出或其它错误干扰。 */
      render() {
        return null;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => root.render(<StrictRoot />));
    assertConsoleErrorDev([
      `Using UNSAFE_componentWillMount in strict mode is not recommended and may indicate bugs in your code. See https://react.dev/link/unsafe-component-lifecycles for details.

* Move code with side effects to componentDidMount, and set initial state in the constructor.

Please update the following components: App`,
      `Using UNSAFE_componentWillReceiveProps in strict mode is not recommended and may indicate bugs in your code. See https://react.dev/link/unsafe-component-lifecycles for details.

* Move data fetching code or side effects to componentDidUpdate.
* If you're updating state whenever props change, refactor your code to use memoization techniques or move it to static getDerivedStateFromProps. Learn more at: https://react.dev/link/derived-state

Please update the following components: Child`,
      `Using UNSAFE_componentWillUpdate in strict mode is not recommended and may indicate bugs in your code. See https://react.dev/link/unsafe-component-lifecycles for details.

* Move data fetching code or side effects to componentDidUpdate.

Please update the following components: App`,
    ]);
    assertConsoleWarnDev([
      `componentWillMount has been renamed, and is not recommended for use. See https://react.dev/link/unsafe-component-lifecycles for details.

* Move code with side effects to componentDidMount, and set initial state in the constructor.
* Rename componentWillMount to UNSAFE_componentWillMount to suppress this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, you can run \`npx react-codemod rename-unsafe-lifecycles\` in your project source folder.

Please update the following components: Parent`,
      `componentWillReceiveProps has been renamed, and is not recommended for use. See https://react.dev/link/unsafe-component-lifecycles for details.

* Move data fetching code or side effects to componentDidUpdate.
* If you're updating state whenever props change, refactor your code to use memoization techniques or move it to static getDerivedStateFromProps. Learn more at: https://react.dev/link/derived-state
* Rename componentWillReceiveProps to UNSAFE_componentWillReceiveProps to suppress this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, you can run \`npx react-codemod rename-unsafe-lifecycles\` in your project source folder.

Please update the following components: Parent`,
      `componentWillUpdate has been renamed, and is not recommended for use. See https://react.dev/link/unsafe-component-lifecycles for details.

* Move data fetching code or side effects to componentDidUpdate.
* Rename componentWillUpdate to UNSAFE_componentWillUpdate to suppress this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, you can run \`npx react-codemod rename-unsafe-lifecycles\` in your project source folder.

Please update the following components: Parent`,
    ]);
    // 同一组件类型的重复诊断必须去重。
    await act(() => root.render(<StrictRoot />));
  });

  /** StrictRoot 首先只挂Foo、再切Bar，各首次报UNSAFE mount诊断，随后来回切不重复；验证后出现的新类型仍会检查且按类型缓存。 */
  it('should warn about components not present during the initial render', async () => {
    /** 按foo prop切换StrictMode内的Foo/Bar类型，让后出现类型也进入初挂诊断。 */
    function StrictRoot({foo}) {
      return <React.StrictMode>{foo ? <Foo /> : <Bar />}</React.StrictMode>;
    }
    /** 带空UNSAFE mount的互斥叶类，供来回切换类型时首次诊断与缓存去重。 */
    class Foo extends React.Component {
      /** 空UNSAFE初挂方法，以存在性触发首次类型诊断。 */
      UNSAFE_componentWillMount() {}
      /** 返回null，让不安全生命周期名称诊断不受宿主输出或其它错误干扰。 */
      render() {
        return null;
      }
    }
    /** 带空UNSAFE mount的互斥叶类，供来回切换类型时首次诊断与缓存去重。 */
    class Bar extends React.Component {
      /** 空UNSAFE初挂方法，以存在性触发首次类型诊断。 */
      UNSAFE_componentWillMount() {}
      /** 返回null，让不安全生命周期名称诊断不受宿主输出或其它错误干扰。 */
      render() {
        return null;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => root.render(<StrictRoot foo={true} />));
    assertConsoleErrorDev([
      'Using UNSAFE_componentWillMount in strict mode is not recommended and may indicate bugs in your code. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move code with side effects to componentDidMount, and set initial state in the constructor.\n\n' +
        'Please update the following components: Foo',
    ]);

    await act(() => root.render(<StrictRoot foo={false} />));
    assertConsoleErrorDev([
      'Using UNSAFE_componentWillMount in strict mode is not recommended and may indicate bugs in your code. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move code with side effects to componentDidMount, and set initial state in the constructor.\n\n' +
        'Please update the following components: Bar',
    ]);

    // 同一组件类型的重复诊断必须去重。
    await act(() => root.render(<StrictRoot foo={true} />));
    await act(() => root.render(<StrictRoot foo={false} />));
  });

  /** 非Strict SyncRoot 自身有三UNSAFE钩子，内部Strict边界下Wrapper的Foo/Bar只有receive；诊断仅列Bar/Foo，重复渲染无新预期诊断，验证严格范围不向祖先扩散。 */
  it('should also warn inside of "strict" mode trees', async () => {
    const {StrictMode} = React;

    /** 非Strict祖先自身声明三UNSAFE钩子，仅后代Wrapper放入Strict，供范围不向祖先传播的检查。 */
    class SyncRoot extends React.Component {
      /** 空UNSAFE钩子位于严格边界之外，本例Strict error期望不包含SyncRoot。 */
      UNSAFE_componentWillMount() {}
      /** 空UNSAFE钩子位于严格边界之外，本例Strict error期望不包含SyncRoot。 */
      UNSAFE_componentWillUpdate() {}
      /** 空UNSAFE钩子位于严格边界之外，本例Strict error期望不包含SyncRoot。 */
      UNSAFE_componentWillReceiveProps() {}
      /** 仅把Wrapper放入StrictMode，保留SyncRoot自身为普通模式祖先。 */
      render() {
        return (
          <StrictMode>
            <Wrapper />
          </StrictMode>
        );
      }
    }
    /** 渲染Bar/Foo两叶到div；children形参未用，供内部Strict范围诊断。 */
    function Wrapper({children}) {
      return (
        <div>
          <Bar />
          <Foo />
        </div>
      );
    }
    /** 在SyncRoot内部Strict边界下的UNSAFE接收props叶类，供只警告后代类型。 */
    class Foo extends React.Component {
      /** 空UNSAFE接收钩子，以存在性触发Strict诊断，本体不读nextProps或修改state。 */
      UNSAFE_componentWillReceiveProps() {}
      /** 返回null，让不安全生命周期名称诊断不受宿主输出或其它错误干扰。 */
      render() {
        return null;
      }
    }
    /** 在SyncRoot内部Strict边界下的UNSAFE接收props叶类，供只警告后代类型。 */
    class Bar extends React.Component {
      /** 空UNSAFE接收钩子，以存在性触发Strict诊断，本体不读nextProps或修改state。 */
      UNSAFE_componentWillReceiveProps() {}
      /** 返回null，让不安全生命周期名称诊断不受宿主输出或其它错误干扰。 */
      render() {
        return null;
      }
    }

    const container = document.createElement('div');

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<SyncRoot />);
    });
    assertConsoleErrorDev([
      'Using UNSAFE_componentWillReceiveProps in strict mode is not recommended ' +
        'and may indicate bugs in your code. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        "* If you're updating state whenever props change, " +
        'refactor your code to use memoization techniques or move it to ' +
        'static getDerivedStateFromProps. Learn more at: https://react.dev/link/derived-state\n\n' +
        'Please update the following components: Bar, Foo',
    ]);

    // 同一组件类型的重复诊断必须去重。
    await act(() => {
      root.render(<SyncRoot />);
    });
  });
});

describe('symbol checks', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
  });

  /** Parent先Strict再Fragment，子state从0且每轮gDSFP+1；两次输出均count1，验证边界类型替换导致子重挂重置state。 */
  it('should switch from StrictMode to a Fragment and reset state', async () => {
    const {Fragment, StrictMode} = React;

    /** 按useFragment选择Fragment或StrictMode包同一ChildComponent；改变包装type检查子state重置。 */
    function ParentComponent({useFragment}) {
      return useFragment ? (
        <Fragment>
          <ChildComponent />
        </Fragment>
      ) : (
        <StrictMode>
          <ChildComponent />
        </StrictMode>
      );
    }

    /** 初始count=0，每轮派生+1并输出文本的类，供包装类型替换与稳定更新的state身份检查。 */
    class ChildComponent extends React.Component {
      /** count=0初始值；重挂重新从0开始，复用实例更新则从已有计数继续。 */
      state = {
        count: 0,
      };
      /** 返回prevState.count+1的补丁，nextProps未用；重复试算不应把第一次结果作为第二次输入。 */
      static getDerivedStateFromProps(nextProps, prevState) {
        return {
          count: prevState.count + 1,
        };
      }
      /** 返回count:<当前state>文本，作为重挂重置或更新保留的可观察证据。 */
      render() {
        return `count:${this.state.count}`;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<ParentComponent useFragment={false} />);
    });
    expect(container.textContent).toBe('count:1');
    await act(() => {
      root.render(<ParentComponent useFragment={true} />);
    });
    expect(container.textContent).toBe('count:1');
  });

  /** Parent先Fragment再Strict，子每轮gDSFP+1；两次均count1，验证反向边界替换同样重置state。 */
  it('should switch from a Fragment to StrictMode and reset state', async () => {
    const {Fragment, StrictMode} = React;

    /** 按useFragment选择Fragment或StrictMode包同一ChildComponent；改变包装type检查子state重置。 */
    function ParentComponent({useFragment}) {
      return useFragment ? (
        <Fragment>
          <ChildComponent />
        </Fragment>
      ) : (
        <StrictMode>
          <ChildComponent />
        </StrictMode>
      );
    }

    /** 初始count=0，每轮派生+1并输出文本的类，供包装类型替换与稳定更新的state身份检查。 */
    class ChildComponent extends React.Component {
      /** count=0初始值；重挂重新从0开始，复用实例更新则从已有计数继续。 */
      state = {
        count: 0,
      };
      /** 返回prevState.count+1的补丁，nextProps未用；重复试算不应把第一次结果作为第二次输入。 */
      static getDerivedStateFromProps(nextProps, prevState) {
        return {
          count: prevState.count + 1,
        };
      }
      /** 返回count:<当前state>文本，作为重挂重置或更新保留的可观察证据。 */
      render() {
        return `count:${this.state.count}`;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<ParentComponent useFragment={true} />);
    });
    expect(container.textContent).toBe('count:1');
    await act(() => {
      root.render(<ParentComponent useFragment={false} />);
    });
    expect(container.textContent).toBe('count:1');
  });

  /** 两次均保持Strict边界与子类型，子gDSFP每轮+1，输出count1→count2，验证稳定边界保留子state。 */
  it('should update with StrictMode without losing state', async () => {
    const {StrictMode} = React;

    /** 每次保持StrictMode包同一ChildComponent类型，供稳定边界state保留对照。 */
    function ParentComponent() {
      return (
        <StrictMode>
          <ChildComponent />
        </StrictMode>
      );
    }

    /** 初始count=0，每轮派生+1并输出文本的类，供包装类型替换与稳定更新的state身份检查。 */
    class ChildComponent extends React.Component {
      /** count=0初始值；重挂重新从0开始，复用实例更新则从已有计数继续。 */
      state = {
        count: 0,
      };
      /** 返回prevState.count+1的补丁，nextProps未用；重复试算不应把第一次结果作为第二次输入。 */
      static getDerivedStateFromProps(nextProps, prevState) {
        return {
          count: prevState.count + 1,
        };
      }
      /** 返回count:<当前state>文本，作为重挂重置或更新保留的可观察证据。 */
      render() {
        return `count:${this.state.count}`;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<ParentComponent />);
    });
    expect(container.textContent).toBe('count:1');
    await act(() => {
      root.render(<ParentComponent />);
    });
    expect(container.textContent).toBe('count:2');
  });
});

describe('context legacy', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
    PropTypes = require('prop-types');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // @gate !disableLegacyContext || !__DEV__
  /** 门控允许旧Context时，Strict树包含旧提供者和类/函数消费者；首次要求三个迁移诊断及按名称聚合的Strict诊断，重复挂同树无新预期诊断，验证接口迁移提醒与去重。 */
  it('should warn if the legacy context API have been used in strict mode', async () => {
    /** 旧Context提供者输出color并渲染类/函数两消费者，供Strict迁移诊断聚合。 */
    class LegacyContextProvider extends React.Component {
      /** 返回color=purple，配合childContextTypes声明提供旧上下文。 */
      getChildContext() {
        return {color: 'purple'};
      }

      /** 输出两种旧Context消费者到div，诊断应分别建议类/函数迁移API。 */
      render() {
        return (
          <div>
            <LegacyContextConsumer />
            <FunctionalLegacyContextConsumer />
          </div>
        );
      }
    }

    /** 返回null的函数消费者，随后挂contextTypes.color，供函数旧Context迁移诊断。 */
    function FunctionalLegacyContextConsumer() {
      return null;
    }

    LegacyContextProvider.childContextTypes = {
      color: PropTypes.string,
    };

    /** 返回null的类消费者，随后挂contextTypes.color，供类旧Context迁移诊断。 */
    class LegacyContextConsumer extends React.Component {
      /** 返回null，不消费color数值，本例只观察旧Context声明诊断。 */
      render() {
        return null;
      }
    }

    const {StrictMode} = React;

    /** 普通外层class把提供者放进StrictMode，供所有迁移诊断owner栈归属。 */
    class Root extends React.Component {
      /** 返回div→StrictMode→LegacyContextProvider，建立提供者与消费者诊断链。 */
      render() {
        return (
          <div>
            <StrictMode>
              <LegacyContextProvider />
            </StrictMode>
          </div>
        );
      }
    }

    LegacyContextConsumer.contextTypes = {
      color: PropTypes.string,
    };

    FunctionalLegacyContextConsumer.contextTypes = {
      color: PropTypes.string,
    };

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Root />);
    });

    assertConsoleErrorDev([
      'LegacyContextProvider uses the legacy childContextTypes API ' +
        'which will soon be removed. Use React.createContext() instead. ' +
        '(https://react.dev/link/legacy-context)' +
        '\n    in Root (at **)',
      'LegacyContextConsumer uses the legacy contextTypes API which ' +
        'will soon be removed. Use React.createContext() with static ' +
        'contextType instead. (https://react.dev/link/legacy-context)' +
        '\n    in LegacyContextProvider (at **)' +
        '\n    in Root (at **)',
      'FunctionalLegacyContextConsumer uses the legacy contextTypes ' +
        'API which will be removed soon. Use React.createContext() ' +
        'with React.useContext() instead. (https://react.dev/link/legacy-context)' +
        '\n    in LegacyContextProvider (at **)' +
        '\n    in Root (at **)',
      'Legacy context API has been detected within a strict-mode tree.' +
        '\n\nThe old API will be supported in all 16.x releases, but applications ' +
        'using it should migrate to the new version.' +
        '\n\nPlease update the following components: ' +
        'FunctionalLegacyContextConsumer, LegacyContextConsumer, LegacyContextProvider' +
        '\n\nLearn more about this warning here: ' +
        'https://react.dev/link/legacy-context' +
        '\n    in Root (at **)',
    ]);

    // 同一组件类型的重复诊断必须去重。
    await act(() => {
      root.render(<Root />);
    });
  });

  describe('console logs logging', () => {
    beforeEach(() => {
      jest.resetModules();
      React = require('react');
      ReactDOMClient = require('react-dom/client');
      act = require('internal-test-utils').act;

    // 以下spy专门统计Strict双调用日志不被屏蔽；每条实际log都保留，不对用户日志去重。
      spyOnDevAndProd(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      console.log.mockRestore();
    });

    /** Strict Foo class render计数并console.log，初挂DEV2/生产1且spy捕获foo1，验证重复render日志不会屏蔽。 */
    it('does not disable logs for class double render', async () => {
      let count = 0;
      /** 每次render计数并log的class，供Strict重复render日志不被屏蔽。 */
      class Foo extends React.Component {
        /** 每次计数并输出foo <次数>日志，返回null，供render次数与spy次数一致性。 */
        render() {
          count++;
          console.log('foo ' + count);
          return null;
        }
      }

      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <React.StrictMode>
            <Foo />
          </React.StrictMode>,
        );
      });
      expect(count).toBe(__DEV__ ? 2 : 1);
      expect(console.log).toBeCalledTimes(__DEV__ ? 2 : 1);
    // 必须显示第一次日志；否则警告首次出现时可能被吞掉，并在下次渲染中因去重而永久丢失。
      expect(console.log).toBeCalledWith('foo 1');
    });

    /** Strict Foo constructor计数并console.log、render为null，初挂DEV2/生产1且保留foo1，验证重复构造日志不会屏蔽。 */
    it('does not disable logs for class double ctor', async () => {
      let count = 0;
      /** 构造器计数并log的class，供Strict重复构造日志不被屏蔽。 */
      class Foo extends React.Component {
        /** super(props)后计数/log构造次数，供DEV重复构造日志检查。 */
        constructor(props) {
          super(props);
          count++;
          console.log('foo ' + count);
        }
        /** 返回null，不写日志，让spy次数仅来自构造、gDSFP或SCU目标阶段。 */
        render() {
          return null;
        }
      }

      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <React.StrictMode>
            <Foo />
          </React.StrictMode>,
        );
      });
      expect(count).toBe(__DEV__ ? 2 : 1);
      expect(console.log).toBeCalledTimes(__DEV__ ? 2 : 1);
    // 必须显示第一次日志；否则警告首次出现时可能被吞掉，并在下次渲染中因去重而永久丢失。
      expect(console.log).toBeCalledWith('foo 1');
    });

    /** Strict Foo初始空state，静态gDSFP计数/log并返回空补丁，DEV2/生产1且保留foo1，验证派生检查日志不会屏蔽。 */
    it('does not disable logs for class double getDerivedStateFromProps', async () => {
      let count = 0;
      /** 静态gDSFP计数并log的class，供Strict重复派生日志不被屏蔽。 */
      class Foo extends React.Component {
        /** 空初始state，给派生、更新判定或函数式setState场景稳定对象形状。 */
        state = {};
        /** 计数/log并返回空补丁，供派生函数重复检查；不实际改变任何state字段。 */
        static getDerivedStateFromProps() {
          count++;
          console.log('foo ' + count);
          return {};
        }
        /** 返回null，不写日志，让spy次数仅来自构造、gDSFP或SCU目标阶段。 */
        render() {
          return null;
        }
      }

      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <React.StrictMode>
            <Foo />
          </React.StrictMode>,
        );
      });
      expect(count).toBe(__DEV__ ? 2 : 1);
      expect(console.log).toBeCalledTimes(__DEV__ ? 2 : 1);
    // 必须显示第一次日志；否则警告首次出现时可能被吞掉，并在下次渲染中因去重而永久丢失。
      expect(console.log).toBeCalledWith('foo 1');
    });

    /** Strict Foo初挂后同树更新，SCU计数/log返回truthy空对象，DEV2/生产1且foo1可见；验证SCU重复检查日志，不是boolean返回类型检查。 */
    it('does not disable logs for class double shouldComponentUpdate', async () => {
      let count = 0;
      /** SCU计数并log的class，供Strict同树更新检查日志不被屏蔽。 */
      class Foo extends React.Component {
        /** 空初始state，给派生、更新判定或函数式setState场景稳定对象形状。 */
        state = {};
        /** 计数/log并返回truthy空对象，使更新继续；本例检查日志次数，没有boolean返回类型断言。 */
        shouldComponentUpdate() {
          count++;
          console.log('foo ' + count);
          return {};
        }
        /** 返回null，不写日志，让spy次数仅来自构造、gDSFP或SCU目标阶段。 */
        render() {
          return null;
        }
      }

      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <React.StrictMode>
            <Foo />
          </React.StrictMode>,
        );
      });
      await act(() => {
        root.render(
          <React.StrictMode>
            <Foo />
          </React.StrictMode>,
        );
      });

      expect(count).toBe(__DEV__ ? 2 : 1);
      expect(console.log).toBeCalledTimes(__DEV__ ? 2 : 1);
    // 必须显示第一次日志；否则警告首次出现时可能被吞掉，并在下次渲染中因去重而永久丢失。
      expect(console.log).toBeCalledWith('foo 1');
    });

    /** Strict class ref探针取得实例后函数式setState计数/log返回空补丁，DEV2/生产1且foo1可见，验证updater日志不会屏蔽。 */
    it('does not disable logs for class state updaters', async () => {
      let inst;
      let count = 0;
      /** render暴露inst的class，供外部函数式setState计算时日志检查。 */
      class Foo extends React.Component {
        /** 空初始state，给派生、更新判定或函数式setState场景稳定对象形状。 */
        state = {};
        /** 保存this到inst后返回null，供用例在flush作用域调用函数式setState。 */
        render() {
          inst = this;
          return null;
        }
      }

      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <React.StrictMode>
            <Foo />
          </React.StrictMode>,
        );
      });
      await act(() => {
        inst.setState(() => {
          count++;
          console.log('foo ' + count);
          return {};
        });
      });

      expect(count).toBe(__DEV__ ? 2 : 1);
      expect(console.log).toBeCalledTimes(__DEV__ ? 2 : 1);
    // 必须显示第一次日志；否则警告首次出现时可能被吞掉，并在下次渲染中因去重而永久丢失。
      expect(console.log).toBeCalledWith('foo 1');
    });

    /** Strict函数Foo render计数/log返回null，DEV2/生产1且foo1可见，验证函数重复render日志不会屏蔽。 */
    it('does not disable logs for function double render', async () => {
      let count = 0;
      /** 每次函数render计数/log并返回null，供DEV重复render与生产单render对照。 */
      function Foo() {
        count++;
        console.log('foo ' + count);
        return null;
      }

      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <React.StrictMode>
            <Foo />
          </React.StrictMode>,
        );
      });
      expect(count).toBe(__DEV__ ? 2 : 1);
      expect(console.log).toBeCalledTimes(__DEV__ ? 2 : 1);
    // 必须显示第一次日志；否则警告首次出现时可能被吞掉，并在下次渲染中因去重而永久丢失。
      expect(console.log).toBeCalledWith('foo 1');
    });

    /** Strict函数effect setup/cleanup分别计数/log，初挂DEV setup2/cleanup1/总log3、生产setup1/cleanup0/log1；首setup及DEV cleanup均可见，验证严格effect重放保留日志。 */
    it('does not disable logs for effect double invoke', async () => {
      let create = 0;
      let cleanup = 0;
      /** useEffect setup/返回cleanup分别计数/log，输出null；供Strict初挂setup→cleanup→setup重放日志。 */
      function Foo() {
        React.useEffect(() => {
          create++;
          console.log('foo create ' + create);
          return () => {
            cleanup++;
            console.log('foo cleanup ' + cleanup);
          };
        });
        return null;
      }

      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <React.StrictMode>
            <Foo />
          </React.StrictMode>,
        );
      });
      expect(create).toBe(__DEV__ ? 2 : 1);
      expect(cleanup).toBe(__DEV__ ? 1 : 0);
      expect(console.log).toBeCalledTimes(__DEV__ ? 3 : 1);
    // 必须显示第一次日志；否则警告首次出现时可能被吞掉，并在下次渲染中因去重而永久丢失。
      expect(console.log).toBeCalledWith('foo create 1');
      if (__DEV__) {
        expect(console.log).toBeCalledWith('foo cleanup 1');
      }
    });
  });
});
