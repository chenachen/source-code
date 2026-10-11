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
let Scheduler;
let act;
let waitFor;
let waitForAll;
let waitForPaint;

/** 验证默认 Strict Effects 开关下新根、legacy 根及新增子树的双调用边界。 */
describe('StrictEffectsMode defaults', () => {
  /** 每个用例重置模块，并重新绑定 React、Noop 渲染器、调度日志与 `act`。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;

    const InternalTestUtils = require('internal-test-utils');
    waitFor = InternalTestUtils.waitFor;
    waitForAll = InternalTestUtils.waitForAll;
    waitForPaint = InternalTestUtils.waitForPaint;
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

    await act(() => {
      ReactNoop.renderLegacySyncRoot(
        <React.StrictMode>
          <App text={'mount'} />
        </React.StrictMode>,
      );
    });

    expect(log).toEqual(['useLayoutEffect mount', 'useEffect mount']);
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

    await act(() => {
      ReactNoop.renderLegacySyncRoot(
        <React.StrictMode>
          <App text={'mount'} />
        </React.StrictMode>,
      );
    });

    expect(log).toEqual(['componentDidMount']);
  });

  if (__DEV__) {
    /**
     * ComponentWithEffects 只注册 layout effect；先挂载 one，再加入 two，用 waitForPaint 停在当前帧提交后。
     * 每次 waitForPaint 返回时，新组件的额外 cleanup/create 已完成；既有 one 只普通更新一次。
     * 对应源码：无 pending passive 工作时，flushSpawnedWork 在当前提交末调用 commitDoubleInvokeEffectsInDEV(root, false)。
     */
    it('should flush double-invoked effects within the same frame as layout effects if there are no passive effects', async () => {
      const log = [];
      /** 只注册 layout effect，按 label 同时写普通日志与 Scheduler 日志。 */
      function ComponentWithEffects({label}) {
        React.useLayoutEffect(() => {
          Scheduler.log(`useLayoutEffect mount "${label}"`);
          log.push(`useLayoutEffect mount "${label}"`);
          return () => {
            Scheduler.log(`useLayoutEffect unmount "${label}"`);
            log.push(`useLayoutEffect unmount "${label}"`);
          };
        });

        return label;
      }

      await act(async () => {
        ReactNoop.render(
          <React.StrictMode>
            <ComponentWithEffects label={'one'} />
          </React.StrictMode>,
        );

        await waitForPaint(['useLayoutEffect mount "one"']);
        expect(log).toEqual([
          'useLayoutEffect mount "one"',
          'useLayoutEffect unmount "one"',
          'useLayoutEffect mount "one"',
        ]);
      });

      log.length = 0;
      await act(async () => {
        ReactNoop.render(
          <React.StrictMode>
            <ComponentWithEffects label={'one'} />
            <ComponentWithEffects label={'two'} />
          </React.StrictMode>,
        );

        expect(log).toEqual([]);
        await waitForPaint([
          // "one" 未提供依赖数组，本轮正常清理并重建；"two" 此时首次创建。
          'useLayoutEffect unmount "one"',
          'useLayoutEffect mount "one"',
          'useLayoutEffect mount "two"',
        ]);
        expect(log).toEqual([
          // "one" 未提供依赖数组，本轮正常清理并重建；"two" 此时首次创建。
          'useLayoutEffect unmount "one"',
          'useLayoutEffect mount "one"',
          'useLayoutEffect mount "two"',

          // "two" 是新挂载的 Effect，因此应被双调用。
          'useLayoutEffect unmount "two"',
          'useLayoutEffect mount "two"',
        ]);
      });
    });

    // 有 passive effect 时，开发态重放随同 passive flush 执行。
    /**
     * one 注册两类 effect，初挂后加入 two；用 waitFor 检查 layout，再用 waitForAll 冲刷 passive。
     * layout 检查点尚无 two 重放；passive 冲刷后只为新 two 额外拆装，两类重放在该次 flush 中连续完成。
     * 对应源码：有 pending passive 工作时，flushPassiveEffectsImpl 在 passive mount 后执行 Strict Effects 重放。
     */
    it('should double invoke effects only for newly mounted components', async () => {
      const log = [];
      /** 按 label 记录两类 effect，使 layout 检查点与 passive flush 可分别观察。 */
      function ComponentWithEffects({label}) {
        React.useEffect(() => {
          log.push(`useEffect mount "${label}"`);
          Scheduler.log(`useEffect mount "${label}"`);
          return () => {
            log.push(`useEffect unmount "${label}"`);
            Scheduler.log(`useEffect unmount "${label}"`);
          };
        });

        React.useLayoutEffect(() => {
          log.push(`useLayoutEffect mount "${label}"`);
          Scheduler.log(`useLayoutEffect mount "${label}"`);
          return () => {
            log.push(`useLayoutEffect unmount "${label}"`);
            Scheduler.log(`useLayoutEffect unmount "${label}"`);
          };
        });

        return label;
      }

      await act(async () => {
        ReactNoop.render(
          <React.StrictMode>
            <ComponentWithEffects label={'one'} />
          </React.StrictMode>,
        );

        await waitForAll([
          'useLayoutEffect mount "one"',
          'useEffect mount "one"',
        ]);
        expect(log).toEqual([
          'useLayoutEffect mount "one"',
          'useEffect mount "one"',
          'useLayoutEffect unmount "one"',
          'useEffect unmount "one"',
          'useLayoutEffect mount "one"',
          'useEffect mount "one"',
        ]);
      });

      log.length = 0;
      await act(async () => {
        ReactNoop.render(
          <React.StrictMode>
            <ComponentWithEffects label={'one'} />
            <ComponentWithEffects label={'two'} />
          </React.StrictMode>,
        );

        await waitFor([
          // "one" 未提供依赖数组，本轮正常清理并重建；"two" 此时首次创建。
          'useLayoutEffect unmount "one"',
          'useLayoutEffect mount "one"',
          'useLayoutEffect mount "two"',
        ]);
        expect(log).toEqual([
          // "one" 未提供依赖数组，本轮正常清理并重建；"two" 此时首次创建。
          'useLayoutEffect unmount "one"',
          'useLayoutEffect mount "one"',
          'useLayoutEffect mount "two"',
        ]);
        log.length = 0;
        await waitForAll([
          'useEffect unmount "one"',
          'useEffect mount "one"',
          'useEffect mount "two"',
        ]);
        expect(log).toEqual([
          'useEffect unmount "one"',
          'useEffect mount "one"',
          'useEffect mount "two"',

          // "two" 是新挂载的 Effect，因此应被双调用。
          'useLayoutEffect unmount "two"',
          'useEffect unmount "two"',
          'useLayoutEffect mount "two"',
          'useEffect mount "two"',
        ]);
      });
    });

    /**
     * 在现代根的 StrictMode 中挂载、改变 text、再删除同时注册两类 effect 的 App。
     * 初挂 create 后额外 cleanup/create 一轮；普通更新只拆装一次，删除只清理一次。
     * 对应源码：doubleInvokeEffectsOnFiber 与普通 layout/passive 提交；整个用例仅在 DEV 执行。
     */
    it('double invoking for effects for modern roots', async () => {
      const log = [];
      /** 注册未传依赖数组的两类 effect，使现代根更新与初挂重放可分别观察。 */
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
        ReactNoop.render(
          <React.StrictMode>
            <App text={'mount'} />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual([
        'useLayoutEffect mount',
        'useEffect mount',
        'useLayoutEffect unmount',
        'useEffect unmount',
        'useLayoutEffect mount',
        'useEffect mount',
      ]);

      log.length = 0;
      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App text={'update'} />
          </React.StrictMode>,
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
        ReactNoop.render(null);
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
        ReactNoop.render(
          <React.StrictMode>
            <App text={'mount'} />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual([
        'useEffect One mount',
        'useEffect Two mount',
        'useEffect One unmount',
        'useEffect Two unmount',
        'useEffect One mount',
        'useEffect Two mount',
      ]);

      log.length = 0;
      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App text={'update'} />
          </React.StrictMode>,
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
        ReactNoop.render(null);
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
        ReactNoop.render(
          <React.StrictMode>
            <App text={'mount'} />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual([
        'useLayoutEffect One mount',
        'useLayoutEffect Two mount',
        'useLayoutEffect One unmount',
        'useLayoutEffect Two unmount',
        'useLayoutEffect One mount',
        'useLayoutEffect Two mount',
      ]);

      log.length = 0;
      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App text={'update'} />
          </React.StrictMode>,
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
        ReactNoop.render(null);
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
        ReactNoop.render(
          <React.StrictMode>
            <App text={'mount'} />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual([
        'useLayoutEffect mount',
        'useEffect mount',
        'useLayoutEffect mount',
        'useEffect mount',
      ]);

      log.length = 0;
      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App text={'update'} />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual(['useLayoutEffect mount', 'useEffect mount']);

      log.length = 0;
      await act(() => {
        ReactNoop.render(null);
      });

      expect(log).toEqual([]);
    });

    /**
     * 在现代根 StrictMode 中首次挂载 span，函数 ref 把每次入参交给 onRefMock。
     * DEV 三次调用依次收到实例、null、实例；额外拆装也覆盖宿主 ref。
     * 对应源码：doubleInvokeEffectsOnFiber 调用 disappearLayoutEffects 的 detach 与 reappearLayoutEffects 的 attach。
     */
    it('disconnects refs during double invoking', async () => {
      const onRefMock = jest.fn();
      /** 返回带函数 ref 的 span，将挂载/null/重挂载入参交给 mock。 */
      function App({text}) {
        return (
          <span
            ref={ref => {
              onRefMock(ref);
            }}>
            text
          </span>
        );
      }

      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App text={'mount'} />
          </React.StrictMode>,
        );
      });

      expect(onRefMock.mock.calls.length).toBe(3);
      expect(onRefMock.mock.calls[0][0]).not.toBeNull();
      expect(onRefMock.mock.calls[1][0]).toBe(null);
      expect(onRefMock.mock.calls[2][0]).not.toBeNull();
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
        ReactNoop.render(
          <React.StrictMode>
            <App />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual([
        'componentDidMount',
        'componentWillUnmount',
        'componentDidMount',
      ]);
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
        ReactNoop.render(
          <React.StrictMode>
            <App text={'mount'} />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual([
        'componentDidMount',
        'componentWillUnmount',
        'componentDidMount',
      ]);

      log.length = 0;
      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App text={'update'} />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual(['componentDidUpdate']);

      log.length = 0;
      await act(() => {
        ReactNoop.render(null);
      });

      expect(log).toEqual(['componentWillUnmount']);
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

      log.length = 0;
      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App text={'mount'} />
          </React.StrictMode>,
        );
      });

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
    });

    /**
     * 先仅挂载 App，再用 setShowChild(true) 插入 Child；App/Child 均未传 effect 依赖数组。
     * App 正常更新拆装一次；新 Child 在 DEV create 后额外 cleanup/create。日志区分普通更新与初挂重放。
     * 对应源码：doubleInvokeEffectsInDEVIfNecessary 的 PlacementDEV 分支。
     */
    it('newly mounted components after initial mount get double invoked', async () => {
      let _setShowChild;
      const log = [];
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
        ReactNoop.render(
          <React.StrictMode>
            <App />
          </React.StrictMode>,
        );
      });

      expect(log).toEqual([
        'App useLayoutEffect mount',
        'App useEffect mount',
        'App useLayoutEffect unmount',
        'App useEffect unmount',
        'App useLayoutEffect mount',
        'App useEffect mount',
      ]);

      log.length = 0;
      await act(() => {
        _setShowChild(true);
      });

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
          <React.StrictMode>
            <ClassChild text={text} />
            <FunctionChild text={text} />
          </React.StrictMode>
        );
      }

      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App text={'mount'} />
          </React.StrictMode>,
        );
      });

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

      log.length = 0;
      await act(() => {
        ReactNoop.render(
          <React.StrictMode>
            <App text={'mount'} />
          </React.StrictMode>,
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
        ReactNoop.render(null);
      });

      expect(log).toEqual([
        'componentWillUnmount',
        'useLayoutEffect unmount',
        'useEffect unmount',
      ]);
    });
  }
});
