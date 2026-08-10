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
let act;

/** 验证显式 StrictMode 下函数 Effect 与类生命周期的开发态双调用语义。 */
describe('StrictEffectsMode', () => {
  /** 每个用例重置模块，并重新绑定 React、Noop 渲染器、调度日志与 `act`。 */
  beforeEach(() => {
    jest.resetModules();
    act = require('internal-test-utils').act;

    React = require('react');
    ReactNoop = require('react-noop-renderer');
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

    const root = ReactNoop.createLegacyRoot();
    await act(() => {
      root.render(
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
   * Then：挂载 StrictMode 组件并检查开发态 Effect 的挂载、模拟卸载与重挂载序列。
   *
   * 验证机制：显式断言联合检查状态、输出和副作用。
   * 对应源码：`commitDoubleInvokeEffectsInDEV()`、`recursivelyTraverseAndDoubleInvokeEffectsInDEV()` 与 `doubleInvokeEffectsOnFiber()`。
   */
  it('double invoking for effects works properly', async () => {
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
      ReactNoop.renderToRootWithID(
        <React.StrictMode>
          <App text={'mount'} />
        </React.StrictMode>,
        'root',
      );
    });

    if (__DEV__) {
      expect(log).toEqual([
        'useLayoutEffect mount',
        'useEffect mount',
        'useLayoutEffect unmount',
        'useEffect unmount',
        'useLayoutEffect mount',
        'useEffect mount',
      ]);
    } else {
      expect(log).toEqual(['useLayoutEffect mount', 'useEffect mount']);
    }

    log.length = 0;
    await act(() => {
      ReactNoop.renderToRootWithID(
        <React.StrictMode>
          <App text={'update'} />
        </React.StrictMode>,
        'root',
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
      ReactNoop.unmountRootWithID('root');
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
      ReactNoop.renderToRootWithID(
        <React.StrictMode>
          <App text={'mount'} />
        </React.StrictMode>,
        'root',
      );
    });

    if (__DEV__) {
      expect(log).toEqual([
        'useEffect One mount',
        'useEffect Two mount',
        'useEffect One unmount',
        'useEffect Two unmount',
        'useEffect One mount',
        'useEffect Two mount',
      ]);
    } else {
      expect(log).toEqual(['useEffect One mount', 'useEffect Two mount']);
    }

    log.length = 0;
    await act(() => {
      ReactNoop.renderToRootWithID(
        <React.StrictMode>
          <App text={'update'} />
        </React.StrictMode>,
        'root',
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
      ReactNoop.unmountRootWithID('root');
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
      ReactNoop.renderToRootWithID(
        <React.StrictMode>
          <App text={'mount'} />
        </React.StrictMode>,
        'root',
      );
    });

    if (__DEV__) {
      expect(log).toEqual([
        'useLayoutEffect One mount',
        'useLayoutEffect Two mount',
        'useLayoutEffect One unmount',
        'useLayoutEffect Two unmount',
        'useLayoutEffect One mount',
        'useLayoutEffect Two mount',
      ]);
    } else {
      expect(log).toEqual([
        'useLayoutEffect One mount',
        'useLayoutEffect Two mount',
      ]);
    }

    log.length = 0;
    await act(() => {
      ReactNoop.renderToRootWithID(
        <React.StrictMode>
          <App text={'update'} />
        </React.StrictMode>,
        'root',
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
      ReactNoop.unmountRootWithID('root');
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
      ReactNoop.renderToRootWithID(
        <React.StrictMode>
          <App text={'mount'} />
        </React.StrictMode>,
      );
    });

    if (__DEV__) {
      expect(log).toEqual([
        'useLayoutEffect mount',
        'useEffect mount',
        'useLayoutEffect mount',
        'useEffect mount',
      ]);
    } else {
      expect(log).toEqual(['useLayoutEffect mount', 'useEffect mount']);
    }

    log.length = 0;
    await act(() => {
      ReactNoop.renderToRootWithID(
        <React.StrictMode>
          <App text={'update'} />
        </React.StrictMode>,
      );
    });

    expect(log).toEqual(['useLayoutEffect mount', 'useEffect mount']);

    log.length = 0;
    await act(() => {
      ReactNoop.unmountRootWithID('root');
    });

    expect(log).toEqual([]);
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
      ReactNoop.renderToRootWithID(
        <React.StrictMode>
          <App />
        </React.StrictMode>,
      );
    });

    if (__DEV__) {
      expect(log).toEqual([
        'componentDidMount',
        'componentWillUnmount',
        'componentDidMount',
      ]);
    } else {
      expect(log).toEqual(['componentDidMount']);
    }
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
      ReactNoop.renderToRootWithID(
        <React.StrictMode>
          <App text={'mount'} />
        </React.StrictMode>,
        'root',
      );
    });

    if (__DEV__) {
      expect(log).toEqual([
        'componentDidMount',
        'componentWillUnmount',
        'componentDidMount',
      ]);
    } else {
      expect(log).toEqual(['componentDidMount']);
    }

    log.length = 0;
    await act(() => {
      ReactNoop.renderToRootWithID(
        <React.StrictMode>
          <App text={'update'} />
        </React.StrictMode>,
        'root',
      );
    });

    expect(log).toEqual(['componentDidUpdate']);

    log.length = 0;
    await act(() => {
      ReactNoop.unmountRootWithID('root');
    });

    expect(log).toEqual(['componentWillUnmount']);
  });

  /**
   * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
   * When：删除目标子树并冲刷对应提交阶段。
   * Then：让缺少 componentDidMount 的类参与重放，确认非对称生命周期仍会正确清理。
   *
   * 验证机制：显式断言联合检查状态、输出和副作用。
   * 对应源码：`commitDoubleInvokeEffectsInDEV()`、`recursivelyTraverseAndDoubleInvokeEffectsInDEV()` 与 `doubleInvokeEffectsOnFiber()`。
   */
  it('invokes componentWillUnmount for class components without componentDidMount', async () => {
    const log = [];
    /** 定义 App 类 fixture，在“让缺少 componentDidMount 的类参与重放，确认非对称生命周期仍会正确清理”场景中暴露类生命周期、实例 ref 或错误边界。 */
    class App extends React.PureComponent {
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
      ReactNoop.renderToRootWithID(
        <React.StrictMode>
          <App text={'mount'} />
        </React.StrictMode>,
        'root',
      );
    });

    if (__DEV__) {
      expect(log).toEqual(['componentWillUnmount']);
    } else {
      expect(log).toEqual([]);
    }

    log.length = 0;
    await act(() => {
      ReactNoop.renderToRootWithID(
        <React.StrictMode>
          <App text={'update'} />
        </React.StrictMode>,
        'root',
      );
    });

    expect(log).toEqual(['componentDidUpdate']);

    log.length = 0;
    await act(() => {
      ReactNoop.unmountRootWithID('root');
    });

    expect(log).toEqual(['componentWillUnmount']);
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

    const root = ReactNoop.createLegacyRoot();
    await act(() => {
      root.render(
        <React.StrictMode>
          <App text={'mount'} />
        </React.StrictMode>,
      );
    });

    expect(log).toEqual(['componentDidMount']);
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

    await act(() => {
      ReactNoop.renderToRootWithID(
        <React.StrictMode>
          <App text={'mount'} />
        </React.StrictMode>,
      );
    });

    if (__DEV__) {
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
    } else {
      expect(log).toEqual([
        'mount',
        'useLayoutEffect mount',
        'useEffect mount',
        'mount',
        'useLayoutEffect unmount',
        'useLayoutEffect mount',
        'useEffect unmount',
        'useEffect mount',
      ]);
    }
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
    const log = [];
    let _setShowChild;
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
      ReactNoop.renderToRootWithID(
        <React.StrictMode>
          <App />
        </React.StrictMode>,
        'root',
      );
    });

    if (__DEV__) {
      expect(log).toEqual([
        'App useLayoutEffect mount',
        'App useEffect mount',
        'App useLayoutEffect unmount',
        'App useEffect unmount',
        'App useLayoutEffect mount',
        'App useEffect mount',
      ]);
    } else {
      expect(log).toEqual(['App useLayoutEffect mount', 'App useEffect mount']);
    }

    log.length = 0;
    await act(() => {
      _setShowChild(true);
    });

    if (__DEV__) {
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
    } else {
      expect(log).toEqual([
        'App useLayoutEffect unmount',
        'Child useLayoutEffect mount',
        'App useLayoutEffect mount',
        'App useEffect unmount',
        'Child useEffect mount',
        'App useEffect mount',
      ]);
    }
  });

  /**
   * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：只重排稳定 key 的既有子节点，确认未卸载且依赖未变的 Effect 不会重跑。
   *
   * 验证机制：显式断言联合检查状态、输出和副作用。
   * 对应源码：`commitDoubleInvokeEffectsInDEV()`、`recursivelyTraverseAndDoubleInvokeEffectsInDEV()` 与 `doubleInvokeEffectsOnFiber()`。
   */
  it('reordering keyed children does not re-run effects', async () => {
    const log = [];
    /** 作为子级函数组件暴露 Hook 状态和提交日志；服务于“只重排稳定 key 的既有子节点，确认未卸载且依赖未变的 Effect 不会重跑”场景。 */
    function Child({label}) {
      React.useEffect(() => {
        log.push(`${label} useEffect mount`);
        return () => log.push(`${label} useEffect unmount`);
      }, []);
      React.useLayoutEffect(() => {
        log.push(`${label} useLayoutEffect mount`);
        return () => log.push(`${label} useLayoutEffect unmount`);
      }, []);

      return null;
    }

    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“只重排稳定 key 的既有子节点，确认未卸载且依赖未变的 Effect 不会重跑”场景。 */
    function App({keys}) {
      return keys.map(key => <Child key={key} label={key} />);
    }

    await act(() => {
      ReactNoop.render(
        <React.StrictMode>
          <App keys={['a', 'b']} />
        </React.StrictMode>,
      );
    });

    if (__DEV__) {
      expect(log).toEqual([
        'a useLayoutEffect mount',
        'b useLayoutEffect mount',
        'a useEffect mount',
        'b useEffect mount',
        'a useLayoutEffect unmount',
        'b useLayoutEffect unmount',
        'a useEffect unmount',
        'b useEffect unmount',
        'a useLayoutEffect mount',
        'b useLayoutEffect mount',
        'a useEffect mount',
        'b useEffect mount',
      ]);
    } else {
      expect(log).toEqual([
        'a useLayoutEffect mount',
        'b useLayoutEffect mount',
        'a useEffect mount',
        'b useEffect mount',
      ]);
    }

    // 重排既有子节点不得重新执行 Effect：组件既未卸载也未重新挂载，依赖也没有变化。
    log.length = 0;
    await act(() => {
      ReactNoop.render(
        <React.StrictMode>
          <App keys={['b', 'a']} />
        </React.StrictMode>,
      );
    });

    expect(log).toEqual([]);
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
        <>
          <ClassChild text={text} />
          <FunctionChild text={text} />
        </>
      );
    }

    await act(() => {
      ReactNoop.renderToRootWithID(
        <React.StrictMode>
          <App text={'mount'} />
        </React.StrictMode>,
        'root',
      );
    });

    if (__DEV__) {
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
    } else {
      expect(log).toEqual([
        'componentDidMount',
        'useLayoutEffect mount',
        'useEffect mount',
      ]);
    }

    log.length = 0;
    await act(() => {
      ReactNoop.renderToRootWithID(
        <React.StrictMode>
          <App text={'mount'} />
        </React.StrictMode>,
        'root',
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
      ReactNoop.unmountRootWithID('root');
    });

    expect(log).toEqual([
      'componentWillUnmount',
      'useLayoutEffect unmount',
      'useEffect unmount',
    ]);
  });

  /**
   * Given：带目标 Effect 或生命周期的组件树已完成必要的首次挂载。
   * When：完成挂载以及用例指定的后续渲染或提交步骤。
   * Then：让缺少 componentDidMount 的类参与重放，确认非对称生命周期仍会正确清理。
   *
   * 验证机制：显式断言联合检查状态、输出和副作用。
   * 对应源码：`commitDoubleInvokeEffectsInDEV()`、`recursivelyTraverseAndDoubleInvokeEffectsInDEV()` 与 `doubleInvokeEffectsOnFiber()`。
   */
  it('classes without componentDidMount and functions are double invoked together correctly', async () => {
    const log = [];
    /** 定义 ClassChild 类 fixture，在“让缺少 componentDidMount 的类参与重放，确认非对称生命周期仍会正确清理”场景中暴露类生命周期、实例 ref 或错误边界。 */
    class ClassChild extends React.PureComponent {
      /** ClassChild.componentWillUnmount 在真实卸载或模拟卸载时记录清理顺序。 */
      componentWillUnmount() {
        log.push('componentWillUnmount');
      }

      /** 渲染 ClassChild.render 对应的类 fixture，并把本轮状态或子树交给宿主输出断言。 */
      render() {
        return this.props.text;
      }
    }

    /** 作为子级函数组件暴露 Hook 状态和提交日志；服务于“让缺少 componentDidMount 的类参与重放，确认非对称生命周期仍会正确清理”场景。 */
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

    /** 组织当前用例的根组件、更新入口与受测 Hook；服务于“让缺少 componentDidMount 的类参与重放，确认非对称生命周期仍会正确清理”场景。 */
    function App({text}) {
      return (
        <>
          <ClassChild text={text} />
          <FunctionChild text={text} />
        </>
      );
    }

    await act(() => {
      ReactNoop.renderToRootWithID(
        <React.StrictMode>
          <App text={'mount'} />
        </React.StrictMode>,
        'root',
      );
    });

    if (__DEV__) {
      expect(log).toEqual([
        'useLayoutEffect mount',
        'useEffect mount',
        'componentWillUnmount',
        'useLayoutEffect unmount',
        'useEffect unmount',
        'useLayoutEffect mount',
        'useEffect mount',
      ]);
    } else {
      expect(log).toEqual(['useLayoutEffect mount', 'useEffect mount']);
    }

    log.length = 0;
    await act(() => {
      ReactNoop.renderToRootWithID(
        <React.StrictMode>
          <App text={'mount'} />
        </React.StrictMode>,
        'root',
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
      ReactNoop.unmountRootWithID('root');
    });

    expect(log).toEqual([
      'componentWillUnmount',
      'useLayoutEffect unmount',
      'useEffect unmount',
    ]);
  });

  /**
   * Given：并发根已挂载，低优先级工作、thenable 与日志检查点均已准备。
   * When：启动并发渲染，再制造挂起或高优先级中断并恢复。
   * Then：已提交 Suspense 子树再次挂起并恢复，确认恢复提交后的 Effect 会被双调用。
   *
   * 验证机制：显式断言联合检查状态、输出和副作用。
   * 对应源码：`commitDoubleInvokeEffectsInDEV()`、`recursivelyTraverseAndDoubleInvokeEffectsInDEV()` 与 `doubleInvokeEffectsOnFiber()`。
   */
  // @gate __DEV__
  it('should double invoke effects after a re-suspend', async () => {
    // 此处不使用 `log.push`，因为它会屏蔽双渲染日志。
    let log = [];
    let shouldSuspend = true;
    let resolve;
    const suspensePromise = new Promise(_resolve => {
      resolve = _resolve;
    });
    /** 在 Suspense 挂起期间输出可识别回退内容；服务于“已提交 Suspense 子树再次挂起并恢复，确认恢复提交后的 Effect 会被双调用”场景。 */
    function Fallback() {
      log.push('Fallback');
      return 'Loading';
    }

    /** 作为父级 fixture 持有状态、Context 或子树边界；服务于“已提交 Suspense 子树再次挂起并恢复，确认恢复提交后的 Effect 会被双调用”场景。 */
    function Parent({prop}) {
      log.push('Parent rendered');

      React.useEffect(() => {
        log.push('Parent create');
        return () => {
          log.push('Parent destroy');
        };
      }, []);

      React.useEffect(() => {
        log.push('Parent dep create');
        return () => {
          log.push('Parent dep destroy');
        };
      }, [prop]);

      return (
        <React.Suspense fallback={<Fallback />}>
          <Child prop={prop} />
        </React.Suspense>
      );
    }

    /** 作为子级函数组件暴露 Hook 状态和提交日志；服务于“已提交 Suspense 子树再次挂起并恢复，确认恢复提交后的 Effect 会被双调用”场景。 */
    function Child({prop}) {
      const [count, forceUpdate] = React.useState(0);
      const ref = React.useRef(null);
      log.push('Child rendered');
      React.useEffect(() => {
        log.push('Child create');
        return () => {
          log.push('Child destroy');
          ref.current = true;
        };
      }, []);
      const key = `${prop}-${count}`;
      React.useEffect(() => {
        log.push('Child dep create');
        if (ref.current === true) {
          ref.current = false;
          forceUpdate(c => c + 1);
          log.push('-----------------------after setState');
          return;
        }

        return () => {
          log.push('Child dep destroy');
        };
      }, [key]);

      if (shouldSuspend) {
        log.push('Child suspended');
        throw suspensePromise;
      }
      return null;
    }

    // 首次挂载。
    shouldSuspend = false;
    await act(() => {
      ReactNoop.render(
        <React.StrictMode>
          <Parent />
        </React.StrictMode>,
      );
    });

    // 现在让子树再次挂起。
    shouldSuspend = true;
    log = [];
    await act(() => {
      ReactNoop.render(
        <React.StrictMode>
          <Parent />
        </React.StrictMode>,
      );
    });

    expect(log).toEqual([
      'Parent rendered',
      'Parent rendered',
      'Child rendered',
      'Child suspended',
      'Fallback',
      'Fallback',
    // 预热渲染。
      'Child rendered',
      'Child suspended',
    ]);

    log = [];
    // 在挂起期间安排更新。
    await act(() => {
      ReactNoop.render(
        <React.StrictMode>
          <Parent prop={'bar'} />
        </React.StrictMode>,
      );
    });

    expect(log).toEqual([
      'Parent rendered',
      'Parent rendered',
      'Child rendered',
      'Child suspended',
      'Fallback',
      'Fallback',
      'Parent dep destroy',
      'Parent dep create',
    // 预热渲染。
      'Child rendered',
      'Child suspended',
    ]);

    log = [];
    // 现在解决 thenable 并提交。
    await act(() => {
      resolve();
      shouldSuspend = false;
    });

    expect(log).toEqual([
      'Child rendered',
      'Child rendered',
    // 已提交：销毁并重新创建依赖变化的 Effect；另一 Effect 的依赖未变，因此不执行清理和创建。
      'Child dep destroy',
      'Child dep create',

    // 对两个 Effect 执行开发态双调用。
      'Child destroy',
      'Child dep destroy',
      'Child create',
      'Child dep create',
    // 触发 setState。
      '-----------------------after setState',
      'Child rendered',
      'Child rendered',
      'Child dep create',
    ]);
  });
});
