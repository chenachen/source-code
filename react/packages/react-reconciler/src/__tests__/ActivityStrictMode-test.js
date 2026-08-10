let React;
let Activity;
let ReactNoop;
let act;
let log;

/** 验证 StrictMode 的双 render/双 effect 语义与 Activity visible/hidden、Suspense 恢复之间的组合边界。 */
describe('Activity StrictMode', () => {
  /** 每例清空模块和顺序日志，重新取得 Activity 与 Noop renderer，确保 effect 生命周期从未挂载状态开始。 */
  beforeEach(() => {
    jest.resetModules();
    log = [];

    React = require('react');
    Activity = React.Activity;
    ReactNoop = require('react-noop-renderer');
    act = require('internal-test-utils').act;
  });

  /** 同时记录 render、layout effect 与 passive effect 挂载/卸载顺序的通用夹具。 */
  function Component({label}) {
    React.useEffect(() => {
      log.push(`${label}: useEffect mount`);
      return () => log.push(`${label}: useEffect unmount`);
    });

    React.useLayoutEffect(() => {
      log.push(`${label}: useLayoutEffect mount`);
      return () => log.push(`${label}: useLayoutEffect unmount`);
    });

    log.push(`${label}: render`);

    return <span>label</span>;
  }

  /**
   * Given DEV StrictMode 包裹 visible Activity；When 首次挂载带两类 effect 的组件；
   * Then render 执行两次，effects 经 mount→unmount→mount 严格重放。
   * 验证机制：顺序日志；对应 ReactFiberWorkLoop 的 StrictEffectsMode 与 ReactFiberCommitEffects。
   */
  // @gate __DEV__
  it('should trigger strict effects when offscreen is visible', async () => {
    await act(() => {
      ReactNoop.render(
        <React.StrictMode>
          <Activity mode="visible">
            <Component label="A" />
          </Activity>
        </React.StrictMode>,
      );
    });

    expect(log).toEqual([
      'A: render',
      'A: render',
      'A: useLayoutEffect mount',
      'A: useEffect mount',
      'A: useLayoutEffect unmount',
      'A: useEffect unmount',
      'A: useLayoutEffect mount',
      'A: useEffect mount',
    ]);
  });

  /**
   * Given DEV StrictMode 下 hidden Activity；When 隐藏预渲染、插入子节点、揭示后再隐藏；
   * Then hidden 阶段只双 render，揭示时才严格重放 effects，再隐藏时卸载 effects。
   * 验证机制：跨四次提交的日志序列；对应 Activity 可见性提交与 StrictEffectsMode。
   */
  // @gate __DEV__
  it('should not trigger strict effects when offscreen is hidden', async () => {
    await act(() => {
      ReactNoop.render(
        <React.StrictMode>
          <Activity mode="hidden">
            <Component label="A" />
          </Activity>
        </React.StrictMode>,
      );
    });

    expect(log).toEqual(['A: render', 'A: render']);

    log = [];

    await act(() => {
      ReactNoop.render(
        <React.StrictMode>
          <Activity mode="hidden">
            <Component label="A" />
            <Component label="B" />
          </Activity>
        </React.StrictMode>,
      );
    });

    expect(log).toEqual(['A: render', 'A: render', 'B: render', 'B: render']);

    log = [];

    await act(() => {
      ReactNoop.render(
        <React.StrictMode>
          <Activity mode="visible">
            <Component label="A" />
          </Activity>
        </React.StrictMode>,
      );
    });

    expect(log).toEqual([
      'A: render',
      'A: render',
      'A: useLayoutEffect mount',
      'A: useEffect mount',
      'A: useLayoutEffect unmount',
      'A: useEffect unmount',
      'A: useLayoutEffect mount',
      'A: useEffect mount',
    ]);

    log = [];

    await act(() => {
      ReactNoop.render(
        <React.StrictMode>
          <Activity mode="hidden">
            <Component label="A" />
          </Activity>
        </React.StrictMode>,
      );
    });

    expect(log).toEqual([
      'A: useLayoutEffect unmount',
      'A: useEffect unmount',
      'A: render',
      'A: render',
    ]);
  });

  /**
   * Given StrictMode+Suspense 中 layout effect 同步 setState，另有空 passive effect；When 首次提交；
   * Then 更新收敛且 act 返回，不发生严格 effect 重放导致的无限循环。
   * 验证机制：用例能完成；对应 ReactFiberHooks 的 effect 调度与 StrictEffectsMode 重放边界。
   */
  it('should not cause infinite render loop when StrictMode is used with Suspense and synchronous set states', async () => {
    // 回归测试背景见 https://github.com/facebook/react/pull/25179。
    /** layout effect 触发一次同步状态更新，并保留触发旧回归所需的空 passive effect。 */
    function App() {
      const [state, setState] = React.useState(false);

      React.useLayoutEffect(() => {
        setState(true);
      }, []);

      React.useEffect(() => {
        // 空依赖 useEffect 是复现旧无限渲染循环的必要条件。
      }, []);

      return state;
    }

    await act(() => {
      ReactNoop.render(
        <React.StrictMode>
          <React.Suspense>
            <App />
          </React.Suspense>
        </React.StrictMode>,
      );
    });
  });

  /**
   * Given visible Activity 内的 Parent 已提交，而 Child 首次挂起；When thenable resolve 使 Child 首次可提交；
   * Then Parent 只遵循既有严格重放，刚解除挂起的 Child 独立执行 effect mount→unmount→mount。
   * 验证机制：预热、恢复与 effect 日志；对应 Suspense retry、Activity 与 StrictEffectsMode。
   */
  // @gate __DEV__
  it('should double invoke effects on unsuspended child', async () => {
    let shouldSuspend = true;
    let resolve;
    const suspensePromise = new Promise(_resolve => {
      resolve = _resolve;
    });

    /** 提供 Suspense 边界并记录自身 passive effect 生命周期。 */
    function Parent() {
      log.push('Parent rendered');
      React.useEffect(() => {
        log.push('Parent mount');
        return () => {
          log.push('Parent unmount');
        };
      });

      return (
        <React.Suspense fallback="fallback">
          <Child />
        </React.Suspense>
      );
    }

    /** resolve 前抛可控 Promise，resolve 后记录首次提交及严格 effect 重放。 */
    function Child() {
      log.push('Child rendered');
      React.useEffect(() => {
        log.push('Child mount');
        return () => {
          log.push('Child unmount');
        };
      });
      if (shouldSuspend) {
        log.push('Child suspended');
        throw suspensePromise;
      }
      return null;
    }

    await act(() => {
      ReactNoop.render(
        <React.StrictMode>
          <Activity mode="visible">
            <Parent />
          </Activity>
        </React.StrictMode>,
      );
    });

    log.push('------------------------------');

    await act(() => {
      resolve();
      shouldSuspend = false;
    });

    expect(log).toEqual([
      'Parent rendered',
      'Parent rendered',
      'Child rendered',
      'Child suspended',
      'Parent mount',
      'Parent unmount',
      'Parent mount',
      // Suspense 预热 render。
      'Child rendered',
      'Child suspended',
      // Suspense 预热结束。
      '------------------------------',
      'Child rendered',
      'Child rendered',
      'Child mount',
      'Child unmount',
      'Child mount',
    ]);
  });

  /**
   * Given hidden Activity 先预渲染无子节点 Parent；When 揭示时插入 Child one，随后普通更新并再插入 Child two；
   * Then 仅每个“首次提交”的新 Child 执行 StrictMode 双 effect，既有组件更新只执行单轮 effect。
   * 验证机制：分阶段生命周期日志；对应 Activity visibility effects 与 commitDoubleInvokeEffectsInDEV。
   */
  // @gate __DEV__
  it('should double invoke effects on newly inserted children while Activity becomes visible', async () => {
    /** 记录父级 render 与 passive effect，承载动态插入的 children。 */
    function Parent({children}) {
      log.push('Parent rendered');
      React.useEffect(() => {
        log.push('Parent mount');
        return () => {
          log.push('Parent unmount');
        };
      });

      return <div>{children}</div>;
    }

    /** 用 name 区分既有与新插入子节点的 render/effect 生命周期。 */
    function Child({name}) {
      log.push(`Child ${name} rendered`);
      React.useEffect(() => {
        log.push(`Child ${name} mount`);
        return () => {
          log.push(`Child ${name} unmount`);
        };
      });

      return null;
    }

    await act(() => {
      ReactNoop.render(
        <React.StrictMode>
          <Activity mode="hidden">
            <Parent />
          </Activity>
        </React.StrictMode>,
      );
    });

    expect(log).toEqual(['Parent rendered', 'Parent rendered']);

    log.length = 0;
    await act(() => {
      ReactNoop.render(
        <React.StrictMode>
          <Activity mode="visible">
            <Parent>
              <Child name="one" />
            </Parent>
          </Activity>
        </React.StrictMode>,
      );
    });

    expect(log).toEqual([
      'Parent rendered',
      'Parent rendered',
      'Child one rendered',
      'Child one rendered',
      'Child one mount',
      'Parent mount',
      // 首次可见提交触发 StrictMode 双 effect。
      'Parent unmount',
      'Child one unmount',
      'Child one mount',
      'Parent mount',
    ]);

    log.length = 0;
    await act(() => {
      ReactNoop.render(
        <React.StrictMode>
          <Activity mode="visible">
            <Parent>
              <Child name="one" />
            </Parent>
          </Activity>
        </React.StrictMode>,
      );
    });

    expect(log).toEqual([
      'Parent rendered',
      'Parent rendered',
      'Child one rendered',
      'Child one rendered',
      // 普通更新只执行单轮 effect，不再双重调用。
      'Child one unmount',
      'Parent unmount',
      'Child one mount',
      'Parent mount',
    ]);

    log.length = 0;
    await act(() => {
      ReactNoop.render(
        <React.StrictMode>
          <Activity mode="visible">
            <Parent>
              <Child name="one" />
              <Child name="two" />
            </Parent>
          </Activity>
        </React.StrictMode>,
      );
    });

    expect(log).toEqual([
      'Parent rendered',
      'Parent rendered',
      'Child one rendered',
      'Child one rendered',
      'Child two rendered',
      'Child two rendered',
      // 既有组件只执行单轮 effect。
      'Child one unmount',
      'Parent unmount',
      'Child one mount',
      'Child two mount',
      'Parent mount',
      // 新组件 "two" 首次提交，单独执行双 effect。
      'Child two unmount',
      'Child two mount',
    ]);
  });
});
