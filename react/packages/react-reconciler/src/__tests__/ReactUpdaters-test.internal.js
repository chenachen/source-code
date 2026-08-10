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
let ReactFeatureFlags;
let ReactDOM;
let ReactDOMClient;
let Scheduler;
let mockDevToolsHook;
let allSchedulerTags;
let allSchedulerTypes;
let onCommitRootShouldYield;
let act;
let waitFor;
let waitForAll;
let assertLog;

/** 验证 enableUpdaterTracking 向 DevTools 报告 HostRoot、Hook、class、级联、Suspense、错误与交错更新的真实调度 Fiber。 */
describe('updaters', () => {
  /** 开启 updater tracking，安装最小 DevTools Hook，并重置每次提交收集的 tag/type 序列。 */
  beforeEach(() => {
    jest.resetModules();

    allSchedulerTags = [];
    allSchedulerTypes = [];

    onCommitRootShouldYield = true;

    ReactFeatureFlags = require('shared/ReactFeatureFlags');
    ReactFeatureFlags.enableUpdaterTracking = true;

    /** DevTools 协议替身；onCommitRoot 读取 FiberRoot.memoizedUpdaters，其余回调只满足注入接口。 */
    mockDevToolsHook = {
      injectInternals: jest.fn(() => {}),
      isDevToolsPresent: true,
      /** 在每次提交中快照 updater Fiber 的 tag/elementType，并可记录提交边界日志。 */
      onCommitRoot: jest.fn(fiberRoot => {
        if (onCommitRootShouldYield) {
          Scheduler.log('onCommitRoot');
        }
        const schedulerTags = [];
        const schedulerTypes = [];
        fiberRoot.memoizedUpdaters.forEach(fiber => {
          schedulerTags.push(fiber.tag);
          schedulerTypes.push(fiber.elementType);
        });
        allSchedulerTags.push(schedulerTags);
        allSchedulerTypes.push(schedulerTypes);
      }),
      onCommitUnmount: jest.fn(() => {}),
      onPostCommitRoot: jest.fn(() => {}),
      onScheduleRoot: jest.fn(() => {}),

      // DevTools Profiling API 的空实现，仅满足注入协议。
      markCommitStarted: jest.fn(() => {}),
      markCommitStopped: jest.fn(() => {}),
      markComponentRenderStarted: jest.fn(() => {}),
      markComponentRenderStopped: jest.fn(() => {}),
      markComponentPassiveEffectMountStarted: jest.fn(() => {}),
      markComponentPassiveEffectMountStopped: jest.fn(() => {}),
      markComponentPassiveEffectUnmountStarted: jest.fn(() => {}),
      markComponentPassiveEffectUnmountStopped: jest.fn(() => {}),
      markComponentLayoutEffectMountStarted: jest.fn(() => {}),
      markComponentLayoutEffectMountStopped: jest.fn(() => {}),
      markComponentLayoutEffectUnmountStarted: jest.fn(() => {}),
      markComponentLayoutEffectUnmountStopped: jest.fn(() => {}),
      markComponentErrored: jest.fn(() => {}),
      markComponentSuspended: jest.fn(() => {}),
      markLayoutEffectsStarted: jest.fn(() => {}),
      markLayoutEffectsStopped: jest.fn(() => {}),
      markPassiveEffectsStarted: jest.fn(() => {}),
      markPassiveEffectsStopped: jest.fn(() => {}),
      markRenderStarted: jest.fn(() => {}),
      markRenderYielded: jest.fn(() => {}),
      markRenderStopped: jest.fn(() => {}),
      markRenderScheduled: jest.fn(() => {}),
      markForceUpdateScheduled: jest.fn(() => {}),
      markStateUpdateScheduled: jest.fn(() => {}),
    };

    jest.mock(
      'react-reconciler/src/ReactFiberDevToolsHook',
      () => mockDevToolsHook,
    );

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    Scheduler = require('scheduler');

    act = require('internal-test-utils').act;

    const InternalTestUtils = require('internal-test-utils');
    waitFor = InternalTestUtils.waitFor;
    waitForAll = InternalTestUtils.waitForAll;
    assertLog = InternalTestUtils.assertLog;
  });

  /** Given–When–Then：Given root.render 由 Parent/Child 组成且无组件内更新；When初挂载并再次顶层 render；Then两次 memoizedUpdaters 都只含 HostRoot。通过 DevTools onCommitRoot 收集的 tag 验证根级调度来源。 */
  it('should report the (host) root as the scheduler for root-level render', async () => {
    const {HostRoot} = require('react-reconciler/src/ReactWorkTags');

    /** 仅委托 Child 的顶层组件；没有自身更新，因此 scheduler 应保持 HostRoot。 */
    const Parent = () => <Child />;
    /** 无输出叶节点，使类 setState 的唯一 updater 保持 SchedulingComponent。 */
    const Child = () => null;
    const root = ReactDOMClient.createRoot(document.createElement('div'));

    await act(() => {
      root.render(<Parent />);
    });
    expect(allSchedulerTags).toEqual([[HostRoot]]);
    assertLog(['onCommitRoot']);

    await act(() => {
      root.render(<Parent />);
    });
    expect(allSchedulerTags).toEqual([[HostRoot], [HostRoot]]);
    assertLog(['onCommitRoot']);
  });

  /** Given–When–Then：Given A/B 两个函数组件各暴露 Hook setter；When先后更新 A、B；Then每次提交的 updater 类型分别是 SchedulingComponentA/B。通过 memoizedUpdaters.elementType 验证 Hook 更新归属实际函数 Fiber。 */
  it('should report a function component as the scheduler for a hooks update', async () => {
    let scheduleForA = null;
    let scheduleForB = null;

    /** 并列两个可独立更新的函数组件，允许逐个验证 updater 类型。 */
    const Parent = () => (
      <React.Fragment>
        <SchedulingComponentA />
        <SchedulingComponentB />
      </React.Fragment>
    );
    /** 持有独立 Hook state 并暴露 scheduleForA；更新应归属自身函数 Fiber。 */
    const SchedulingComponentA = () => {
      const [count, setCount] = React.useState(0);
      scheduleForA = () => setCount(prevCount => prevCount + 1);
      return <Child count={count} />;
    };
    /** 持有独立 Hook state 并暴露 scheduleForB；作为 A 的对照 updater。 */
    const SchedulingComponentB = () => {
      const [count, setCount] = React.useState(0);
      scheduleForB = () => setCount(prevCount => prevCount + 1);
      return <Child count={count} />;
    };
    /** 无输出叶节点，仅承接 A/B 的 count prop 而不产生额外 updater。 */
    const Child = () => null;

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Parent />);
    });
    expect(scheduleForA).not.toBeNull();
    expect(scheduleForB).not.toBeNull();
    expect(allSchedulerTypes).toEqual([[null]]);
    assertLog(['onCommitRoot']);

    await act(() => {
      scheduleForA();
    });
    expect(allSchedulerTypes).toEqual([[null], [SchedulingComponentA]]);
    assertLog(['onCommitRoot']);
    await act(() => {
      scheduleForB();
    });
    expect(allSchedulerTypes).toEqual([
      [null],
      [SchedulingComponentA],
      [SchedulingComponentB],
    ]);
    assertLog(['onCommitRoot']);
  });

  /** Given–When–Then：Given类 SchedulingComponent 暴露实例；When调用 instance.setState；Then提交将该类组件记录为 updater。通过初次 HostRoot 对照和类型数组验证 class queue 来源。 */
  it('should report a class component as the scheduler for a setState update', async () => {
    /** 包装类 SchedulingComponent，顶层挂载仍由 HostRoot 发起。 */
    const Parent = () => <SchedulingComponent />;
    /** 保存实例并持有类更新队列，用于将 setState 来源映射到类 Fiber。 */
    class SchedulingComponent extends React.Component {
      /** 空对象状态足以触发类 setState 更新而不改变输出。 */
      state = {};
      /** 暴露实例并返回 Child，使提交来源可由 class updater 单独识别。 */
      render() {
        instance = this;
        return <Child />;
      }
    }
    /** 无输出叶节点，使类 setState 的唯一 updater 保持 SchedulingComponent。 */
    const Child = () => null;
    let instance;
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Parent />);
    });
    expect(allSchedulerTypes).toEqual([[null]]);
    assertLog(['onCommitRoot']);
    expect(instance).not.toBeNull();
    await act(() => {
      instance.setState({});
    });
    expect(allSchedulerTypes).toEqual([[null], [SchedulingComponent]]);
  });

  /** Given–When–Then：Given父 SchedulingComponent 的更新分别触发布局 effect 或被动 effect 中的 Child setState；When执行 active/passive cascade；Then每次先记录父 updater，再在级联提交记录 CascadingChild。通过提交序列验证 commit-phase 级联更新归属。 */
  it('should cover cascading updates', async () => {
    let triggerActiveCascade = null;
    let triggerPassiveCascade = null;

    /** 渲染 SchedulingComponent，后者再通过 effect 级联更新子组件。 */
    const Parent = () => <SchedulingComponent />;
    /** 持有 cascade 模式并暴露 active/passive 触发器，父更新后驱动 Child effect。 */
    const SchedulingComponent = () => {
      const [cascade, setCascade] = React.useState(null);
      triggerActiveCascade = () => setCascade('active');
      triggerPassiveCascade = () => setCascade('passive');
      return <CascadingChild cascade={cascade} />;
    };
    /** 根据 cascade 在 layout 或 passive effect 中自增，制造提交阶段级联更新。 */
    const CascadingChild = ({cascade}) => {
      const [count, setCount] = React.useState(0);
      Scheduler.log(`CascadingChild ${count}`);
      React.useLayoutEffect(() => {
        if (cascade === 'active') {
          setCount(prevCount => prevCount + 1);
        }
        return () => {};
      }, [cascade]);
      React.useEffect(() => {
        if (cascade === 'passive') {
          setCount(prevCount => prevCount + 1);
        }
        return () => {};
      }, [cascade]);
      return count;
    };

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(async () => {
      root.render(<Parent />);
      await waitFor(['CascadingChild 0', 'onCommitRoot']);
    });
    expect(triggerActiveCascade).not.toBeNull();
    expect(triggerPassiveCascade).not.toBeNull();
    expect(allSchedulerTypes).toEqual([[null]]);

    await act(async () => {
      triggerActiveCascade();
      await waitFor([
        'CascadingChild 0',
        'onCommitRoot',
        'CascadingChild 1',
        'onCommitRoot',
      ]);
    });
    expect(allSchedulerTypes).toEqual([
      [null],
      [SchedulingComponent],
      [CascadingChild],
    ]);

    await act(async () => {
      triggerPassiveCascade();
      await waitFor([
        'CascadingChild 1',
        'onCommitRoot',
        'CascadingChild 2',
        'onCommitRoot',
      ]);
    });
    expect(allSchedulerTypes).toEqual([
      [null],
      [SchedulingComponent],
      [CascadingChild],
      [SchedulingComponent],
      [CascadingChild],
    ]);

    // 确认没有遗留的调度工作。
    await waitForAll([]);
  });

  // 理论上可迁移到 createRoot，但 updater 类型断言会改变；
  // 暂时保留 legacy root，并在禁用 legacy 模式时跳过。
  /** Given–When–Then：Given legacy Suspender 由 state 进入挂起，随后手动解决 promise；When先提交 fallback 再处理 ping；Then挂起与 ping 提交都把 Suspender 记录为 updater。通过三次类型数组验证 retry 来源继承被挂起 Fiber。 */
  // @gate !disableLegacyMode
  it('should cover suspense pings', async () => {
    let data = null;
    let resolver = null;
    let promise = null;
    /** 未解析时创建并抛出 promise，resolver 调用后返回数据，模拟最小 Suspense cache。 */
    const fakeCacheRead = () => {
      if (data === null) {
        promise = new Promise(resolve => {
          resolver = resolvedData => {
            data = resolvedData;
            resolve(resolvedData);
          };
        });
        throw promise;
      } else {
        return data;
      }
    };
    /** 用 Suspense 包裹可挂起组件，建立 fallback 与 ping 提交。 */
    const Parent = () => (
      <React.Suspense fallback={<Fallback />}>
        <Suspender />
      </React.Suspense>
    );
    /** 无输出回退；提交只用于触发 DevTools updater 快照。 */
    const Fallback = () => null;
    let setShouldSuspend = null;
    /** 暴露 suspend setter；为 true 时读取 fake cache 并抛 promise。 */
    const Suspender = ({suspend}) => {
      const tuple = React.useState(false);
      setShouldSuspend = tuple[1];
      if (tuple[0] === true) {
        return fakeCacheRead();
      } else {
        return null;
      }
    };

    await act(() => {
      ReactDOM.render(<Parent />, document.createElement('div'));
      assertLog(['onCommitRoot']);
    });
    expect(setShouldSuspend).not.toBeNull();
    expect(allSchedulerTypes).toEqual([[null]]);

    await act(() => {
      setShouldSuspend(true);
    });
    assertLog(['onCommitRoot']);
    expect(allSchedulerTypes).toEqual([[null], [Suspender]]);

    expect(resolver).not.toBeNull();
    await act(() => {
      resolver('abc');
      return promise;
    });
    assertLog(['onCommitRoot']);
    expect(allSchedulerTypes).toEqual([[null], [Suspender], [Suspender]]);

    // 确认没有遗留的调度工作。
    await waitForAll([]);
  });

  /** Given–When–Then：Given Parent 更新后 BrokenRender 抛错，ErrorBoundary componentDidCatch 再 setState；When恢复为 error 输出；Then第一次提交 updater 为 Parent，恢复提交 updater 为 ErrorBoundary。通过两次 onCommitRoot 与日志验证错误级联来源。 */
  it('should cover error handling', async () => {
    let triggerError = null;

    /** 根据 shouldError 在正常 Yield 与 BrokenRender 间切换，由 ErrorBoundary 捕获。 */
    const Parent = () => {
      const [shouldError, setShouldError] = React.useState(false);
      triggerError = () => setShouldError(true);
      return shouldError ? (
        <ErrorBoundary>
          <BrokenRender />
        </ErrorBoundary>
      ) : (
        <ErrorBoundary>
          <Yield value="initial" />
        </ErrorBoundary>
      );
    };
    /** 捕获 BrokenRender，并通过自身 setState 发起独立恢复提交。 */
    class ErrorBoundary extends React.Component {
      /** 捕获到的错误；非空时切换为 error Yield。 */
      state = {error: null};
      /** 保存捕获错误，调度 ErrorBoundary 作为 updater 的恢复更新。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** 有错误时输出 error 标记，否则返回原 children。 */
      render() {
        if (this.state.error) {
          return <Yield value="error" />;
        }
        return this.props.children;
      }
    }
    /** 记录 normal/error 标记，验证错误恢复的两次提交。 */
    const Yield = ({value}) => {
      Scheduler.log(value);
      return null;
    };
    /** 无条件抛出 Hello，触发 ErrorBoundary 恢复路径。 */
    const BrokenRender = () => {
      throw new Error('Hello');
    };

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Parent shouldError={false} />);
    });
    assertLog(['initial', 'onCommitRoot']);
    expect(triggerError).not.toBeNull();

    allSchedulerTypes.splice(0);
    onCommitRootShouldYield = true;

    await act(() => {
      triggerError();
    });
    assertLog(['onCommitRoot', 'error', 'onCommitRoot']);
    expect(allSchedulerTypes).toEqual([[Parent], [ErrorBoundary]]);

    // 确认没有遗留的调度工作。
    await waitForAll([]);
  });

  /** Given–When–Then：Given LowPriorityUpdater transition 渲染中被 SyncPriorityUpdater 同步更新打断；When先同步提交高优先级，再恢复并追加低优先级更新；Then三次提交依次记录 HostRoot、Sync、Low updater。通过 tag/type 数组验证交错 work-in-progress 不混淆来源。 */
  it('should distinguish between updaters in the case of interleaved work', async () => {
    const {
      FunctionComponent,
      HostRoot,
    } = require('react-reconciler/src/ReactWorkTags');

    let triggerLowPriorityUpdate = null;
    let triggerSyncPriorityUpdate = null;

    /** 暴露同步 Hook setter并记录 count，作为抢占 transition 的高优先级来源。 */
    const SyncPriorityUpdater = () => {
      const [count, setCount] = React.useState(0);
      triggerSyncPriorityUpdate = () => setCount(prevCount => prevCount + 1);
      Scheduler.log(`SyncPriorityUpdater ${count}`);
      return <Yield value={`HighPriority ${count}`} />;
    };
    /** 将 Hook setter 包入 startTransition，制造可被打断的低优先级来源。 */
    const LowPriorityUpdater = () => {
      const [count, setCount] = React.useState(0);
      triggerLowPriorityUpdate = () => {
        React.startTransition(() => {
          setCount(prevCount => prevCount + 1);
        });
      };
      Scheduler.log(`LowPriorityUpdater ${count}`);
      return <Yield value={`LowPriority ${count}`} />;
    };
    /** 记录高/低优先级叶值，标记并发 render 的精确暂停点。 */
    const Yield = ({value}) => {
      Scheduler.log(`Yield ${value}`);
      return null;
    };

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    root.render(
      <React.Fragment>
        <SyncPriorityUpdater />
        <LowPriorityUpdater />
      </React.Fragment>,
    );

    // 完成初次全量渲染。
    await waitForAll([
      'SyncPriorityUpdater 0',
      'Yield HighPriority 0',
      'LowPriorityUpdater 0',
      'Yield LowPriority 0',
      'onCommitRoot',
    ]);
    expect(triggerLowPriorityUpdate).not.toBeNull();
    expect(triggerSyncPriorityUpdate).not.toBeNull();
    expect(allSchedulerTags).toEqual([[HostRoot]]);

    // 只渲染低优先级更新的一部分，暂不完成。
    await act(async () => {
      triggerLowPriorityUpdate();
      await waitFor(['LowPriorityUpdater 1']);
      expect(allSchedulerTags).toEqual([[HostRoot]]);

      // 用更高优先级同步工作打断。
      ReactDOM.flushSync(triggerSyncPriorityUpdate);
      assertLog([
        'SyncPriorityUpdater 1',
        'Yield HighPriority 1',
        'onCommitRoot',
      ]);
      expect(allSchedulerTypes).toEqual([[null], [SyncPriorityUpdater]]);

      // 恢复并完成原低优先级工作。
      triggerLowPriorityUpdate();
      await waitForAll([
        'LowPriorityUpdater 2',
        'Yield LowPriority 2',
        'onCommitRoot',
      ]);
    });
    expect(allSchedulerTags).toEqual([
      [HostRoot],
      [FunctionComponent],
      [FunctionComponent],
    ]);
    expect(allSchedulerTypes).toEqual([
      [null],
      [SyncPriorityUpdater],
      [LowPriorityUpdater],
    ]);

    // 确认没有遗留的调度工作。
    await waitForAll([]);
  });
});
