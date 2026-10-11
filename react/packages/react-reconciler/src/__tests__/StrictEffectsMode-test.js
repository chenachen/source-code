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
  /** 每个用例重置模块，并重新绑定 React、Noop 渲染器与 `act`。 */
  beforeEach(() => {
    jest.resetModules();
    act = require('internal-test-utils').act;

    React = require('react');
    ReactNoop = require('react-noop-renderer');
  });

  /**
   * 在 legacy 根的 StrictMode 中首次挂载同时注册 layout/passive effect 的 App。
   * 日志只有两类 create 各一次，没有开发态模拟 cleanup/create；该用例只执行首次挂载。
   * 对应源码：LegacyRoot 不给这棵树启用 StrictEffectsMode，因而没有 MountLayoutDev/MountPassiveDev 重放工作。
   */
  // @gate !disableLegacyMode
  it('should not double invoke effects in legacy mode', async () => {
    const log = [];
    /** 注册未传依赖数组的 layout/passive effect，返回 text 供 legacy 根挂载。 */
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
   * 在现代根的 StrictMode 中挂载、改变 text、再卸载同时注册两类 effect 的 App。
   * 初挂在 DEV 额外 cleanup/create 一轮；后续更新因未传依赖数组正常 cleanup/create，真实卸载仅 cleanup。
   * 对应源码：commitDoubleInvokeEffectsInDEV 的初挂重放，以及普通 mutation/layout/passive 更新和删除路径。
   */
  it('double invoking for effects works properly', async () => {
    const log = [];
    /** 注册未传依赖数组的两类 effect，使 text 更新也触发正常拆装。 */
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
   * 同一组件按 One、Two 顺序注册两个 passive effect，并在 StrictMode 中挂载、更新、卸载。
   * 初挂 DEV 日志为 One/Two create、One/Two cleanup、One/Two create；更新先清两项再建两项，删除只清两项。
   * 对应源码：commitHookEffectListMount/Unmount 的环形链顺序与 doubleInvokeEffectsOnFiber 的分阶段重放。
   */
  it('multiple effects are double invoked in the right order (all mounted, all unmounted, all remounted)', async () => {
    const log = [];
    /** 按 One、Two 顺序注册两个 passive effect，各自记录 create 与 cleanup。 */
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
   * 同一组件按 One、Two 顺序注册两个 layout effect，并在 StrictMode 中挂载、更新、卸载。
   * 初挂 DEV 日志为两项 create、两项 cleanup、两项 create；更新的 cleanup 位于 mutation，create 位于 layout。
   * 对应源码：commitHookLayoutUnmountEffects、commitHookLayoutEffects 与 doubleInvokeEffectsOnFiber。
   */
  it('multiple layout effects are double invoked in the right order (all mounted, all unmounted, all remounted)', async () => {
    const log = [];
    /** 按 One、Two 顺序注册两个 layout effect，各自记录 create 与 cleanup。 */
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
   * App 的 layout/passive create 都不返回 cleanup；在 StrictMode 中挂载、更新、卸载。
   * 初挂 DEV 仍有两轮 create；更新只有一轮 create，真实卸载无日志。标题中的 no unmount 指未返回清理函数。
   * 对应源码：effect.inst.destroy 为 undefined 时跳过 cleanup，开发态 reconnect 仍重新执行 create。
   */
  it('useEffect and useLayoutEffect is called twice when there is no unmount', async () => {
    const log = [];
    /** 注册不返回 cleanup 的 layout/passive effect，单独观察 create 次数。 */
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
   * 类的生命周期都通过 this.test() 访问实例方法；在 StrictMode 中首次挂载该类。
   * DEV 的 didMount → willUnmount → didMount 均成功调用实例方法。test 是空方法，不返回实例或状态。
   * 对应源码：commitClassDidMount 与 safelyCallComponentWillUnmount 以 instance 作为生命周期接收者。
   */
  it('passes the right context to class component lifecycles', async () => {
    const log = [];
    /** 用 this.test() 检查重放生命周期的实例接收者，并记录调用顺序。 */
    class App extends React.PureComponent {
      /** 生命周期调用的空实例方法；this 绑定丢失时访问 this.test() 会抛错。 */
      test() {}

      /** 记录 didMount 调用，供初挂与开发态重放顺序断言使用。 */
      componentDidMount() {
        this.test();
        log.push('componentDidMount');
      }

      /** 记录更新生命周期调用，区分普通更新与初挂重放。 */
      componentDidUpdate() {
        this.test();
        log.push('componentDidUpdate');
      }

      /** App.componentWillUnmount 在真实卸载或模拟卸载时记录清理顺序。 */
      componentWillUnmount() {
        this.test();
        log.push('componentWillUnmount');
      }

      /** 返回本例的宿主输出；生命周期日志由对应方法记录。 */
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
   * 在 StrictMode 中挂载、修改 text、再卸载类组件，分别记录三种生命周期。
   * 初挂 DEV 为 didMount → willUnmount → didMount；真正更新只 didUpdate，真正删除只 willUnmount。
   * 对应源码：Strict Effects 的 disappear/reappear，以及 commitClassLayoutLifecycles 和删除提交。
   */
  it('double invoking works for class components', async () => {
    const log = [];
    /** 记录类的挂载、更新与卸载，返回 props.text 使更新产生可观察输出。 */
    class App extends React.PureComponent {
      /** 记录 didMount 调用，供初挂与开发态重放顺序断言使用。 */
      componentDidMount() {
        log.push('componentDidMount');
      }

      /** 记录更新生命周期调用，区分普通更新与初挂重放。 */
      componentDidUpdate() {
        log.push('componentDidUpdate');
      }

      /** App.componentWillUnmount 在真实卸载或模拟卸载时记录清理顺序。 */
      componentWillUnmount() {
        log.push('componentWillUnmount');
      }

      /** 返回本例的宿主输出；生命周期日志由对应方法记录。 */
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
   * 类只实现 didUpdate/willUnmount；在 StrictMode 中挂载、修改 text、再卸载。
   * DEV 初挂仍模拟一次 willUnmount；更新只 didUpdate，真实删除再调用 willUnmount。
   * 对应源码：disappearLayoutEffects 独立检查 componentWillUnmount，不要求存在 componentDidMount。
   */
  it('invokes componentWillUnmount for class components without componentDidMount', async () => {
    const log = [];
    /** 只实现更新与卸载生命周期，检查初挂模拟清理是否独立于 didMount。 */
    class App extends React.PureComponent {
      /** 记录更新生命周期调用，区分普通更新与初挂重放。 */
      componentDidUpdate() {
        log.push('componentDidUpdate');
      }

      /** App.componentWillUnmount 在真实卸载或模拟卸载时记录清理顺序。 */
      componentWillUnmount() {
        log.push('componentWillUnmount');
      }

      /** 返回本例的宿主输出；生命周期日志由对应方法记录。 */
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
   * 在 legacy 根的 StrictMode 中首次挂载带 didMount/didUpdate/willUnmount 的类组件。
   * 只记录 componentDidMount；未触发更新或卸载，也没有开发态生命周期重放。
   * 对应源码：LegacyRoot 的 StrictMode 不启用 StrictEffectsMode。
   */
  // @gate !disableLegacyMode
  it('should not double invoke class lifecycles in legacy mode', async () => {
    const log = [];
    /** 记录三类生命周期，检查 legacy 根首次挂载是否追加模拟卸载。 */
    class App extends React.PureComponent {
      /** 记录 didMount 调用，供初挂与开发态重放顺序断言使用。 */
      componentDidMount() {
        log.push('componentDidMount');
      }

      /** 记录更新生命周期调用，区分普通更新与初挂重放。 */
      componentDidUpdate() {
        log.push('componentDidUpdate');
      }

      /** App.componentWillUnmount 在真实卸载或模拟卸载时记录清理顺序。 */
      componentWillUnmount() {
        log.push('componentWillUnmount');
      }

      /** 返回本例的宿主输出；生命周期日志由对应方法记录。 */
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
   * 首次 passive create 把 state 从 0 改为 1，使 act 继续处理派生更新和新一轮 passive 工作。
   * 初挂 DEV 重放一次；派生更新按普通更新拆装，没有再次追加 Strict Effects 重放。
   * 对应源码：doubleInvokeEffectsInDEVIfNecessary 按新挂载标记选择重放，flushPassiveEffectsImpl 冲刷派生同步工作。
   */
  it('double flushing passive effects only results in one double invoke', async () => {
    const log = [];
    /** 在 passive create 中把 state 改为 1，触发一轮派生更新，并记录 render 与 effect 日志。 */
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
   * 先仅挂载 App，再用 setShowChild(true) 插入 Child；App/Child 均未传 effect 依赖数组。
   * App 正常更新拆装一次；新 Child 在 DEV create 后额外 cleanup/create。日志区分普通更新与初挂重放。
   * 对应源码：doubleInvokeEffectsInDEVIfNecessary 的 PlacementDEV 分支。
   */
  it('newly mounted components after initial mount get double invoked', async () => {
    const log = [];
    let _setShowChild;
    /** 注册未传依赖数组的两类 effect，区分首次创建、DEV 重放与普通更新。 */
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

    /** 暴露 showChild 的 setter，在既有 App 下插入新的 Child。 */
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
   * Child 的两类 effect 依赖均为空数组；初挂后把稳定 key 顺序从 a,b 改成 b,a。
   * 重排没有任何 effect 日志：Placement 移动保留组件身份，也未给 effect 写 HookHasEffect。
   * 对应源码：协调的 key/type 复用、Hook 依赖比较与 PlacementDEV 初挂重放判定。
   */
  it('reordering keyed children does not re-run effects', async () => {
    const log = [];
    /** 两类 effect 均使用空依赖数组，按 label 记录创建与清理。 */
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

    /** 按 keys 数组生成稳定 key 的 Child，以切换兄弟顺序。 */
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
   * ClassChild 与 FunctionChild 同处 StrictMode；随后用同一 text 重渲染，再卸载。
   * DEV 初挂先完成类/layout/passive create，再统一拆装；PureComponent 更新 bailout，函数无依赖数组的 effect 仍更新。
   * 对应源码：disappearLayoutEffects/reappearLayoutEffects 与 disconnectPassiveEffect/reconnectPassiveEffects 的阶段顺序。
   */
  it('classes and functions are double invoked together correctly', async () => {
    const log = [];
    /** 以 PureComponent 的 props 比较跳过相同 text 更新，记录类挂载/卸载。 */
    class ClassChild extends React.PureComponent {
      /** 记录 didMount 调用，供初挂与开发态重放顺序断言使用。 */
      componentDidMount() {
        log.push('componentDidMount');
      }

      /** ClassChild.componentWillUnmount 在真实卸载或模拟卸载时记录清理顺序。 */
      componentWillUnmount() {
        log.push('componentWillUnmount');
      }

      /** 返回本例的宿主输出；生命周期日志由对应方法记录。 */
      render() {
        return this.props.text;
      }
    }

    /** 记录函数组件的 layout/passive 创建与清理。 */
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

    /** 并列返回 ClassChild 与 FunctionChild，比较两种组件的提交和重放顺序。 */
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
   * ClassChild 只有 willUnmount，旁边 FunctionChild 注册两类 effect；挂载、同 props 重渲染、再删除。
   * DEV 重放照样调用类 willUnmount，并拆装函数 effect；普通更新只有函数 effect，真实删除两者均清理。
   * 对应源码：disappearLayoutEffects 的类清理不依赖 didMount，PureComponent bailout 与函数 effect 更新分开处理。
   */
  it('classes without componentDidMount and functions are double invoked together correctly', async () => {
    const log = [];
    /** 只记录 willUnmount，以 PureComponent 跳过相同 text 更新。 */
    class ClassChild extends React.PureComponent {
      /** ClassChild.componentWillUnmount 在真实卸载或模拟卸载时记录清理顺序。 */
      componentWillUnmount() {
        log.push('componentWillUnmount');
      }

      /** 返回本例的宿主输出；生命周期日志由对应方法记录。 */
      render() {
        return this.props.text;
      }
    }

    /** 记录函数组件的 layout/passive 创建与清理。 */
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

    /** 并列返回缺少 didMount 的类与带两类 effect 的函数组件。 */
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
   * 已挂载的 Child 再次挂起；显示 fallback 期间 Parent 的 prop 改为 bar，随后解决 thenable。
   * 恢复先更新 Child 变化的依赖 effect，再 DEV 重放两项 effect；cleanup 写 ref 后，重连 create 触发一次派生 state 更新。
   * 对应源码：可见 Offscreen 的 Visibility 重放分支；Suspense 隐藏时保留 passive 连接，恢复后的开发态重放再断连/重连。
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
    /** 输出 Loading 并记录 fallback 渲染。 */
    function Fallback() {
      log.push('Fallback');
      return 'Loading';
    }

    /** 在 Suspense 外记录固定与 prop 依赖的 passive effect，供隐藏子树日志对照。 */
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

    /** 可抛 thenable 挂起；固定依赖 cleanup 写 ref，变化依赖 create 据此再调度 state 更新。 */
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
