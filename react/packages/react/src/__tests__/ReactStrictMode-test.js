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

  /**
   * Given：已建立该文件所需的 renderer、容器与测试夹具。
   * When：执行“should appear in the client component stack”场景的唯一关键操作。
   * Then：断言 StrictMode 的重复调用、生命周期与日志诊断契约 的可观察结果。
   *
   * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
   */
  it('should appear in the client component stack', async () => {
    /** 实现“should appear in the client component stack”场景所需的“Foo”测试夹具行为。 */
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

  /**
   * 场景：“should appear in the SSR component stack”。
   * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
   */
  it('should appear in the SSR component stack', () => {
    /** 实现“should appear in the SSR component stack”场景所需的“Foo”测试夹具行为。 */
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
  /**
   * 场景：“should invoke only precommit lifecycle methods twice in legacy roots”。
   * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
   */
  it('should invoke only precommit lifecycle methods twice in legacy roots', async () => {
    let log = [];
    let shouldComponentUpdate = false;
    /** 作为“should invoke only precommit lifecycle methods twice in legacy roots”场景的组件夹具，隔离待验证的 React 行为。 */
    class ClassComponent extends React.Component {
      /** 保存“should invoke only precommit lifecycle methods twice in legacy roots”场景用于驱动更新或错误回退的组件状态。 */
      state = {};
      /** 根据新属性派生“should invoke only precommit lifecycle methods twice in legacy roots”场景的状态，用于验证静态生命周期语义。 */
      static getDerivedStateFromProps() {
        log.push('getDerivedStateFromProps');
        return null;
      }
      /** 初始化“should invoke only precommit lifecycle methods twice in legacy roots”场景所需的实例状态与观测记录。 */
      constructor(props) {
        super(props);
        log.push('constructor');
      }
      /** 记录“should invoke only precommit lifecycle methods twice in legacy roots”场景的挂载提交，并执行仅在挂载后有效的观测。 */
      componentDidMount() {
        log.push('componentDidMount');
      }
      /** 记录“should invoke only precommit lifecycle methods twice in legacy roots”场景的更新提交，供生命周期顺序断言使用。 */
      componentDidUpdate() {
        log.push('componentDidUpdate');
      }
      /** 记录并清理“should invoke only precommit lifecycle methods twice in legacy roots”场景的卸载副作用。 */
      componentWillUnmount() {
        log.push('componentWillUnmount');
      }
      /** 决定“should invoke only precommit lifecycle methods twice in legacy roots”场景是否继续协调，并让测试验证跳过更新的边界。 */
      shouldComponentUpdate() {
        log.push('shouldComponentUpdate');
        return shouldComponentUpdate;
      }
      /** 渲染“should invoke only precommit lifecycle methods twice in legacy roots”场景所需的元素树，使断言能够观察协调与提交结果。 */
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

  /**
   * 场景：“should invoke setState callbacks twice”。
   * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
   */
  it('should invoke setState callbacks twice', async () => {
    let instance;
    /** 作为“should invoke setState callbacks twice”场景的组件夹具，隔离待验证的 React 行为。 */
    class ClassComponent extends React.Component {
      /** 保存“should invoke setState callbacks twice”场景用于驱动更新或错误回退的组件状态。 */
      state = {
        count: 1,
      };
      /** 渲染“should invoke setState callbacks twice”场景所需的元素树，使断言能够观察协调与提交结果。 */
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
  /**
   * 场景：“double invokes useState and useReducer initializers functions”。
   * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
   */
  it('double invokes useState and useReducer initializers functions', async () => {
    const log = [];

    /** 作为“double invokes useState and useReducer initializers functions”场景的函数夹具，返回待协调内容或触发目标行为。 */
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
  /**
   * 场景：“should invoke only precommit lifecycle methods twice in DEV legacy roots”。
   * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
   */
  it('should invoke only precommit lifecycle methods twice in DEV legacy roots', async () => {
    const {StrictMode} = React;

    let log = [];
    let shouldComponentUpdate = false;

    /** 作为“should invoke only precommit lifecycle methods twice in DEV legacy roots”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function Root() {
      return (
        <StrictMode>
          <ClassComponent />
        </StrictMode>
      );
    }

    /** 作为“should invoke only precommit lifecycle methods twice in DEV legacy roots”场景的组件夹具，隔离待验证的 React 行为。 */
    class ClassComponent extends React.Component {
      /** 保存“should invoke only precommit lifecycle methods twice in DEV legacy roots”场景用于驱动更新或错误回退的组件状态。 */
      state = {};
      /** 根据新属性派生“should invoke only precommit lifecycle methods twice in DEV legacy roots”场景的状态，用于验证静态生命周期语义。 */
      static getDerivedStateFromProps() {
        log.push('getDerivedStateFromProps');
        return null;
      }
      /** 初始化“should invoke only precommit lifecycle methods twice in DEV legacy roots”场景所需的实例状态与观测记录。 */
      constructor(props) {
        super(props);
        log.push('constructor');
      }
      /** 记录“should invoke only precommit lifecycle methods twice in DEV legacy roots”场景的挂载提交，并执行仅在挂载后有效的观测。 */
      componentDidMount() {
        log.push('componentDidMount');
      }
      /** 记录“should invoke only precommit lifecycle methods twice in DEV legacy roots”场景的更新提交，供生命周期顺序断言使用。 */
      componentDidUpdate() {
        log.push('componentDidUpdate');
      }
      /** 记录并清理“should invoke only precommit lifecycle methods twice in DEV legacy roots”场景的卸载副作用。 */
      componentWillUnmount() {
        log.push('componentWillUnmount');
      }
      /** 决定“should invoke only precommit lifecycle methods twice in DEV legacy roots”场景是否继续协调，并让测试验证跳过更新的边界。 */
      shouldComponentUpdate() {
        log.push('shouldComponentUpdate');
        return shouldComponentUpdate;
      }
      /** 渲染“should invoke only precommit lifecycle methods twice in DEV legacy roots”场景所需的元素树，使断言能够观察协调与提交结果。 */
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

  /**
   * 场景：“should invoke setState callbacks twice in DEV”。
   * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
   */
  it('should invoke setState callbacks twice in DEV', async () => {
    const {StrictMode} = React;

    let instance;
    /** 作为“should invoke setState callbacks twice in DEV”场景的组件夹具，隔离待验证的 React 行为。 */
    class ClassComponent extends React.Component {
      /** 保存“should invoke setState callbacks twice in DEV”场景用于驱动更新或错误回退的组件状态。 */
      state = {
        count: 1,
      };
      /** 渲染“should invoke setState callbacks twice in DEV”场景所需的元素树，使断言能够观察协调与提交结果。 */
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
  /**
   * 场景：“double invokes useMemo functions”。
   * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
   */
  it('double invokes useMemo functions', async () => {
    let log = [];

    /** 作为“double invokes useMemo functions”场景的函数夹具，返回待协调内容或触发目标行为。 */
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
  /**
   * 场景：“double invokes useMemo functions with first result”。
   * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
   */
  it('double invokes useMemo functions with first result', async () => {
    let log = [];
    /** 作为“double invokes useMemo functions with first result”场景的函数夹具，返回待协调内容或触发目标行为。 */
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
  /**
   * 场景：“double invokes setState updater functions”。
   * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
   */
  it('double invokes setState updater functions', async () => {
    const log = [];

    let setCount;
    /** 作为“double invokes setState updater functions”场景的函数夹具，返回待协调内容或触发目标行为。 */
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
  /**
   * 场景：“double invokes reducer functions”。
   * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
   */
  it('double invokes reducer functions', async () => {
    const log = [];

    /** 根据测试动作计算下一状态，用于验证 StrictMode 下 reducer 调用语义。 */
    function reducer(prevState, action) {
      log.push('Compute new state: ' + action);
      return action;
    }

    let dispatch;
    /** 作为“double invokes reducer functions”场景的函数夹具，返回待协调内容或触发目标行为。 */
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

  /**
   * 场景：“should warn about unsafe legacy lifecycle methods anywhere in a StrictMode tree”。
   * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
   */
  it('should warn about unsafe legacy lifecycle methods anywhere in a StrictMode tree', async () => {
    /** 作为“should warn about unsafe legacy lifecycle methods anywhere in a StrictMode tree”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function StrictRoot() {
      return (
        <React.StrictMode>
          <App />
        </React.StrictMode>
      );
    }
    /** 作为“should warn about unsafe legacy lifecycle methods anywhere in a StrictMode tree”场景的组件夹具，隔离待验证的 React 行为。 */
    class App extends React.Component {
      /** 记录“should warn about unsafe legacy lifecycle methods anywhere in a StrictMode tree”场景的旧版挂载前生命周期调用。 */
      UNSAFE_componentWillMount() {}
      /** 记录“should warn about unsafe legacy lifecycle methods anywhere in a StrictMode tree”场景的旧版更新前生命周期调用。 */
      UNSAFE_componentWillUpdate() {}
      /** 渲染“should warn about unsafe legacy lifecycle methods anywhere in a StrictMode tree”场景所需的元素树，使断言能够观察协调与提交结果。 */
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
    /** 作为“should warn about unsafe legacy lifecycle methods anywhere in a StrictMode tree”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function Wrapper({children}) {
      return <div>{children}</div>;
    }
    /** 作为“should warn about unsafe legacy lifecycle methods anywhere in a StrictMode tree”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 记录“should warn about unsafe legacy lifecycle methods anywhere in a StrictMode tree”场景接收新属性时的旧版生命周期调用。 */
      UNSAFE_componentWillReceiveProps() {}
      /** 渲染“should warn about unsafe legacy lifecycle methods anywhere in a StrictMode tree”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return null;
      }
    }
    /** 作为“should warn about unsafe legacy lifecycle methods anywhere in a StrictMode tree”场景的组件夹具，隔离待验证的 React 行为。 */
    class Bar extends React.Component {
      /** 记录“should warn about unsafe legacy lifecycle methods anywhere in a StrictMode tree”场景接收新属性时的旧版生命周期调用。 */
      UNSAFE_componentWillReceiveProps() {}
      /** 渲染“should warn about unsafe legacy lifecycle methods anywhere in a StrictMode tree”场景所需的元素树，使断言能够观察协调与提交结果。 */
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

  /**
   * 场景：“should coalesce warnings by lifecycle name”。
   * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
   */
  it('should coalesce warnings by lifecycle name', async () => {
    /** 作为“should coalesce warnings by lifecycle name”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function StrictRoot() {
      return (
        <React.StrictMode>
          <App />
        </React.StrictMode>
      );
    }
    /** 作为“should coalesce warnings by lifecycle name”场景的组件夹具，隔离待验证的 React 行为。 */
    class App extends React.Component {
      /** 记录“should coalesce warnings by lifecycle name”场景的旧版挂载前生命周期调用。 */
      UNSAFE_componentWillMount() {}
      /** 记录“should coalesce warnings by lifecycle name”场景的旧版更新前生命周期调用。 */
      UNSAFE_componentWillUpdate() {}
      /** 渲染“should coalesce warnings by lifecycle name”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <Parent />;
      }
    }
    /** 作为“should coalesce warnings by lifecycle name”场景的组件夹具，隔离待验证的 React 行为。 */
    class Parent extends React.Component {
      /** 实现“should coalesce warnings by lifecycle name”场景所需的“componentWillMount”测试夹具行为。 */
      componentWillMount() {}
      /** 实现“should coalesce warnings by lifecycle name”场景所需的“componentWillUpdate”测试夹具行为。 */
      componentWillUpdate() {}
      /** 实现“should coalesce warnings by lifecycle name”场景所需的“componentWillReceiveProps”测试夹具行为。 */
      componentWillReceiveProps() {}
      /** 渲染“should coalesce warnings by lifecycle name”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <Child />;
      }
    }
    /** 作为“should coalesce warnings by lifecycle name”场景的组件夹具，隔离待验证的 React 行为。 */
    class Child extends React.Component {
      /** 记录“should coalesce warnings by lifecycle name”场景接收新属性时的旧版生命周期调用。 */
      UNSAFE_componentWillReceiveProps() {}
      /** 渲染“should coalesce warnings by lifecycle name”场景所需的元素树，使断言能够观察协调与提交结果。 */
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

  /**
   * 场景：“should warn about components not present during the initial render”。
   * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
   */
  it('should warn about components not present during the initial render', async () => {
    /** 作为“should warn about components not present during the initial render”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function StrictRoot({foo}) {
      return <React.StrictMode>{foo ? <Foo /> : <Bar />}</React.StrictMode>;
    }
    /** 作为“should warn about components not present during the initial render”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 记录“should warn about components not present during the initial render”场景的旧版挂载前生命周期调用。 */
      UNSAFE_componentWillMount() {}
      /** 渲染“should warn about components not present during the initial render”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return null;
      }
    }
    /** 作为“should warn about components not present during the initial render”场景的组件夹具，隔离待验证的 React 行为。 */
    class Bar extends React.Component {
      /** 记录“should warn about components not present during the initial render”场景的旧版挂载前生命周期调用。 */
      UNSAFE_componentWillMount() {}
      /** 渲染“should warn about components not present during the initial render”场景所需的元素树，使断言能够观察协调与提交结果。 */
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

  /**
   * 场景：“当前测试”。
   * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
   */
  it('should also warn inside of "strict" mode trees', async () => {
    const {StrictMode} = React;

    /** 作为“should warn about components not present during the initial render”场景的组件夹具，隔离待验证的 React 行为。 */
    class SyncRoot extends React.Component {
      /** 记录“should warn about components not present during the initial render”场景的旧版挂载前生命周期调用。 */
      UNSAFE_componentWillMount() {}
      /** 记录“should warn about components not present during the initial render”场景的旧版更新前生命周期调用。 */
      UNSAFE_componentWillUpdate() {}
      /** 记录“should warn about components not present during the initial render”场景接收新属性时的旧版生命周期调用。 */
      UNSAFE_componentWillReceiveProps() {}
      /** 渲染“should warn about components not present during the initial render”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return (
          <StrictMode>
            <Wrapper />
          </StrictMode>
        );
      }
    }
    /** 作为“should warn about components not present during the initial render”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function Wrapper({children}) {
      return (
        <div>
          <Bar />
          <Foo />
        </div>
      );
    }
    /** 作为“should warn about components not present during the initial render”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 记录“should warn about components not present during the initial render”场景接收新属性时的旧版生命周期调用。 */
      UNSAFE_componentWillReceiveProps() {}
      /** 渲染“should warn about components not present during the initial render”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return null;
      }
    }
    /** 作为“should warn about components not present during the initial render”场景的组件夹具，隔离待验证的 React 行为。 */
    class Bar extends React.Component {
      /** 记录“should warn about components not present during the initial render”场景接收新属性时的旧版生命周期调用。 */
      UNSAFE_componentWillReceiveProps() {}
      /** 渲染“should warn about components not present during the initial render”场景所需的元素树，使断言能够观察协调与提交结果。 */
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

  /**
   * 场景：“should switch from StrictMode to a Fragment and reset state”。
   * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
   */
  it('should switch from StrictMode to a Fragment and reset state', async () => {
    const {Fragment, StrictMode} = React;

    /** 实现“should switch from StrictMode to a Fragment and reset state”场景所需的“ParentComponent”测试夹具行为。 */
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

    /** 作为“should switch from StrictMode to a Fragment and reset state”场景的组件夹具，隔离待验证的 React 行为。 */
    class ChildComponent extends React.Component {
      /** 保存“should switch from StrictMode to a Fragment and reset state”场景用于驱动更新或错误回退的组件状态。 */
      state = {
        count: 0,
      };
      /** 根据新属性派生“should switch from StrictMode to a Fragment and reset state”场景的状态，用于验证静态生命周期语义。 */
      static getDerivedStateFromProps(nextProps, prevState) {
        return {
          count: prevState.count + 1,
        };
      }
      /** 渲染“should switch from StrictMode to a Fragment and reset state”场景所需的元素树，使断言能够观察协调与提交结果。 */
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

  /**
   * 场景：“should switch from a Fragment to StrictMode and reset state”。
   * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
   */
  it('should switch from a Fragment to StrictMode and reset state', async () => {
    const {Fragment, StrictMode} = React;

    /** 实现“should switch from a Fragment to StrictMode and reset state”场景所需的“ParentComponent”测试夹具行为。 */
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

    /** 作为“should switch from a Fragment to StrictMode and reset state”场景的组件夹具，隔离待验证的 React 行为。 */
    class ChildComponent extends React.Component {
      /** 保存“should switch from a Fragment to StrictMode and reset state”场景用于驱动更新或错误回退的组件状态。 */
      state = {
        count: 0,
      };
      /** 根据新属性派生“should switch from a Fragment to StrictMode and reset state”场景的状态，用于验证静态生命周期语义。 */
      static getDerivedStateFromProps(nextProps, prevState) {
        return {
          count: prevState.count + 1,
        };
      }
      /** 渲染“should switch from a Fragment to StrictMode and reset state”场景所需的元素树，使断言能够观察协调与提交结果。 */
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

  /**
   * 场景：“should update with StrictMode without losing state”。
   * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
   */
  it('should update with StrictMode without losing state', async () => {
    const {StrictMode} = React;

    /** 实现“should update with StrictMode without losing state”场景所需的“ParentComponent”测试夹具行为。 */
    function ParentComponent() {
      return (
        <StrictMode>
          <ChildComponent />
        </StrictMode>
      );
    }

    /** 作为“should update with StrictMode without losing state”场景的组件夹具，隔离待验证的 React 行为。 */
    class ChildComponent extends React.Component {
      /** 保存“should update with StrictMode without losing state”场景用于驱动更新或错误回退的组件状态。 */
      state = {
        count: 0,
      };
      /** 根据新属性派生“should update with StrictMode without losing state”场景的状态，用于验证静态生命周期语义。 */
      static getDerivedStateFromProps(nextProps, prevState) {
        return {
          count: prevState.count + 1,
        };
      }
      /** 渲染“should update with StrictMode without losing state”场景所需的元素树，使断言能够观察协调与提交结果。 */
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
  /**
   * 场景：“should warn if the legacy context API have been used in strict mode”。
   * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
   */
  it('should warn if the legacy context API have been used in strict mode', async () => {
    /** 作为“should warn if the legacy context API have been used in strict mode”场景的组件夹具，隔离待验证的 React 行为。 */
    class LegacyContextProvider extends React.Component {
      /** 向后代提供“should warn if the legacy context API have been used in strict mode”场景使用的旧版上下文值。 */
      getChildContext() {
        return {color: 'purple'};
      }

      /** 渲染“should warn if the legacy context API have been used in strict mode”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return (
          <div>
            <LegacyContextConsumer />
            <FunctionalLegacyContextConsumer />
          </div>
        );
      }
    }

    /** 实现“should warn if the legacy context API have been used in strict mode”场景所需的“FunctionalLegacyContextConsumer”测试夹具行为。 */
    function FunctionalLegacyContextConsumer() {
      return null;
    }

    LegacyContextProvider.childContextTypes = {
      color: PropTypes.string,
    };

    /** 作为“should warn if the legacy context API have been used in strict mode”场景的组件夹具，隔离待验证的 React 行为。 */
    class LegacyContextConsumer extends React.Component {
      /** 渲染“should warn if the legacy context API have been used in strict mode”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return null;
      }
    }

    const {StrictMode} = React;

    /** 作为“should warn if the legacy context API have been used in strict mode”场景的组件夹具，隔离待验证的 React 行为。 */
    class Root extends React.Component {
      /** 渲染“should warn if the legacy context API have been used in strict mode”场景所需的元素树，使断言能够观察协调与提交结果。 */
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

    // 以下用例专门验证 `console.log` 的 StrictMode 转发与去重行为。
      spyOnDevAndProd(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      console.log.mockRestore();
    });

    /**
     * 场景：“does not disable logs for class double render”。
     * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
     */
    it('does not disable logs for class double render', async () => {
      let count = 0;
      /** 作为“does not disable logs for class double render”场景的组件夹具，隔离待验证的 React 行为。 */
      class Foo extends React.Component {
        /** 渲染“does not disable logs for class double render”场景所需的元素树，使断言能够观察协调与提交结果。 */
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

    /**
     * 场景：“does not disable logs for class double ctor”。
     * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
     */
    it('does not disable logs for class double ctor', async () => {
      let count = 0;
      /** 作为“does not disable logs for class double ctor”场景的组件夹具，隔离待验证的 React 行为。 */
      class Foo extends React.Component {
        /** 初始化“does not disable logs for class double ctor”场景所需的实例状态与观测记录。 */
        constructor(props) {
          super(props);
          count++;
          console.log('foo ' + count);
        }
        /** 渲染“does not disable logs for class double ctor”场景所需的元素树，使断言能够观察协调与提交结果。 */
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

    /**
     * 场景：“does not disable logs for class double getDerivedStateFromProps”。
     * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
     */
    it('does not disable logs for class double getDerivedStateFromProps', async () => {
      let count = 0;
      /** 作为“does not disable logs for class double getDerivedStateFromProps”场景的组件夹具，隔离待验证的 React 行为。 */
      class Foo extends React.Component {
        /** 保存“does not disable logs for class double getDerivedStateFromProps”场景用于驱动更新或错误回退的组件状态。 */
        state = {};
        /** 根据新属性派生“does not disable logs for class double getDerivedStateFromProps”场景的状态，用于验证静态生命周期语义。 */
        static getDerivedStateFromProps() {
          count++;
          console.log('foo ' + count);
          return {};
        }
        /** 渲染“does not disable logs for class double getDerivedStateFromProps”场景所需的元素树，使断言能够观察协调与提交结果。 */
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

    /**
     * 场景：“does not disable logs for class double shouldComponentUpdate”。
     * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
     */
    it('does not disable logs for class double shouldComponentUpdate', async () => {
      let count = 0;
      /** 作为“does not disable logs for class double shouldComponentUpdate”场景的组件夹具，隔离待验证的 React 行为。 */
      class Foo extends React.Component {
        /** 保存“does not disable logs for class double shouldComponentUpdate”场景用于驱动更新或错误回退的组件状态。 */
        state = {};
        /** 决定“does not disable logs for class double shouldComponentUpdate”场景是否继续协调，并让测试验证跳过更新的边界。 */
        shouldComponentUpdate() {
          count++;
          console.log('foo ' + count);
          return {};
        }
        /** 渲染“does not disable logs for class double shouldComponentUpdate”场景所需的元素树，使断言能够观察协调与提交结果。 */
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

    /**
     * 场景：“does not disable logs for class state updaters”。
     * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
     */
    it('does not disable logs for class state updaters', async () => {
      let inst;
      let count = 0;
      /** 作为“does not disable logs for class state updaters”场景的组件夹具，隔离待验证的 React 行为。 */
      class Foo extends React.Component {
        /** 保存“does not disable logs for class state updaters”场景用于驱动更新或错误回退的组件状态。 */
        state = {};
        /** 渲染“does not disable logs for class state updaters”场景所需的元素树，使断言能够观察协调与提交结果。 */
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

    /**
     * 场景：“does not disable logs for function double render”。
     * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
     */
    it('does not disable logs for function double render', async () => {
      let count = 0;
      /** 实现“does not disable logs for function double render”场景所需的“Foo”测试夹具行为。 */
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

    /**
     * 场景：“does not disable logs for effect double invoke”。
     * 机制：验证StrictMode 的重复调用、生命周期与日志诊断契约，锁定可观察结果与失败边界。
     */
    it('does not disable logs for effect double invoke', async () => {
      let create = 0;
      let cleanup = 0;
      /** 实现“does not disable logs for effect double invoke”场景所需的“Foo”测试夹具行为。 */
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
