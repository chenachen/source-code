/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

'use strict';

let React;
let ReactFeatureFlags;
let ReactNoop;
let Scheduler;
let act;
let AdvanceTime;
let assertLog;
let waitFor;
let waitForAll;
let waitForThrow;

/** 按当前特性开关重新加载 React、测试 renderer 与调度器，隔离模块状态。 */
function loadModules({
  enableProfilerTimer = true,
  enableProfilerCommitHooks = true,
  enableProfilerNestedUpdatePhase = true,
} = {}) {
  ReactFeatureFlags = require('shared/ReactFeatureFlags');

  ReactFeatureFlags.enableProfilerTimer = enableProfilerTimer;
  ReactFeatureFlags.enableProfilerCommitHooks = enableProfilerCommitHooks;
  ReactFeatureFlags.enableProfilerNestedUpdatePhase =
    enableProfilerNestedUpdatePhase;

  React = require('react');
  Scheduler = require('scheduler');
  ReactNoop = require('react-noop-renderer');
  const InternalTestUtils = require('internal-test-utils');
  act = InternalTestUtils.act;
  assertLog = InternalTestUtils.assertLog;
  waitFor = InternalTestUtils.waitFor;
  waitForAll = InternalTestUtils.waitForAll;
  waitForThrow = InternalTestUtils.waitForThrow;

  AdvanceTime = class extends React.Component {
    /** 提供当前测试场景验证默认属性解析所需的默认值。 */
    static defaultProps = {
      byAmount: 10,
      shouldComponentUpdate: true,
    };
    /** 决定当前测试场景是否继续协调，并让测试验证跳过更新的边界。 */
    shouldComponentUpdate(nextProps) {
      return nextProps.shouldComponentUpdate;
    }
    /** 渲染当前测试场景所需的元素树，使断言能够观察协调与提交结果。 */
    render() {
      // 渲染组件时推进模拟时钟，让 Profiler 获得确定性耗时。
      Scheduler.unstable_advanceTime(this.props.byAmount);
      return this.props.children || null;
    }
  };
}

describe(`onRender`, () => {
  beforeEach(() => {
    jest.resetModules();
    loadModules();
  });

  /**
   * Given：已建立该文件所需的 renderer、容器与测试夹具。
   * When：执行“should handle errors thrown”场景的唯一关键操作。
   * Then：断言 Profiler 的时长累计、提交回调与错误恢复契约 的可观察结果。
   *
   * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
   */
  it('should handle errors thrown', async () => {
    const callback = jest.fn(id => {
      if (id === 'throw') {
        throw Error('expected');
      }
    });

    let didMount = false;
    /** 作为“should handle errors thrown”场景的组件夹具，隔离待验证的 React 行为。 */
    class ClassComponent extends React.Component {
      /** 记录“should handle errors thrown”场景的挂载提交，并执行仅在挂载后有效的观测。 */
      componentDidMount() {
        didMount = true;
      }
      /** 渲染“should handle errors thrown”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return this.props.children;
      }
    }

    // `onRender` 抛错不能中断提交阶段，也不能阻止其他生命周期继续执行。
    await expect(
      act(() => {
        ReactNoop.render(
          <ClassComponent>
            <React.Profiler id="do-not-throw" onRender={callback}>
              <React.Profiler id="throw" onRender={callback}>
                <div />
              </React.Profiler>
            </React.Profiler>
          </ClassComponent>,
        );
      }),
    ).rejects.toThrow('expected');
    expect(didMount).toBe(true);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  /**
   * 场景：“is not invoked until the commit phase”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('is not invoked until the commit phase', async () => {
    const callback = jest.fn();

    /** 作为“is not invoked until the commit phase”场景的函数夹具，返回待协调内容或触发目标行为。 */
    const Yield = ({value}) => {
      Scheduler.log(value);
      return null;
    };

    React.startTransition(() => {
      ReactNoop.render(
        <React.Profiler id="test" onRender={callback}>
          <Yield value="first" />
          <Yield value="last" />
        </React.Profiler>,
      );
    });

    // render 提交前持续累计计时读取；提交后才固定本轮测量值。
    await waitFor(['first']);
    expect(callback).toHaveBeenCalledTimes(0);
    await waitForAll(['last']);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  // @gate !__DEV__
  /**
   * 场景：“does not record times for components outside of Profiler tree”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('does not record times for components outside of Profiler tree', async () => {
    // mock Scheduler，以记录 React 读取当前时间的次数。
    jest.mock('scheduler', obj => {
      const ActualScheduler = jest.requireActual('scheduler/unstable_mock');
      return {
        ...ActualScheduler,
        /** 记录 React 读取当前时间的次数，再转发到真实 mock Scheduler 时钟。 */
        unstable_now: function mockUnstableNow() {
          ActualScheduler.log('read current time');
          return ActualScheduler.unstable_now();
        },
      };
    });

    jest.resetModules();

    loadModules();

      // 清空初始化阶段可能因读取当前时间产生的 yield，避免污染目标断言。
    Scheduler.unstable_clearLog();

    await act(() => {
      ReactNoop.render(
        <div>
          <AdvanceTime />
          <AdvanceTime />
          <AdvanceTime />
          <AdvanceTime />
          <AdvanceTime />
        </div>,
      );
    });

      // 恢复原始 Scheduler mock，防止影响后续用例。
    jest.mock('scheduler', () => jest.requireActual('scheduler/unstable_mock'));

    if (gate(flags => flags.enableComponentPerformanceTrack)) {
      assertLog([
        'read current time',
        'read current time',
        'read current time',
        'read current time',
        'read current time',
        'read current time',
        'read current time',
        'read current time',
        'read current time',
        'read current time',
        'read current time',
        'read current time',
        'read current time',
        'read current time',
        'read current time',
        'read current time',
      ]);
    } else {
      assertLog([
        'read current time',
        'read current time',
        'read current time',
        'read current time',
        'read current time',
        'read current time',
        'read current time',
        'read current time',
        'read current time',
        'read current time',
        'read current time',
      ]);
    }
  });

  /**
   * 场景：“does not report work done on a sibling”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('does not report work done on a sibling', async () => {
    const callback = jest.fn();

    const DoesNotUpdate = React.memo(
      function DoesNotUpdateInner() {
        Scheduler.unstable_advanceTime(10);
        return null;
      },
      () => true,
    );

    let updateProfilerSibling;

    /** 实现“does not report work done on a sibling”场景所需的“ProfilerSibling”测试夹具行为。 */
    function ProfilerSibling() {
      const [count, setCount] = React.useState(0);
      updateProfilerSibling = () => setCount(count + 1);
      return null;
    }

    /** 作为“does not report work done on a sibling”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function App() {
      return (
        <React.Fragment>
          <React.Profiler id="test" onRender={callback}>
            <DoesNotUpdate />
          </React.Profiler>
          <ProfilerSibling />
        </React.Fragment>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });

    expect(callback).toHaveBeenCalledTimes(1);

    let call = callback.mock.calls[0];

    expect(call).toHaveLength(6);
    expect(call[0]).toBe('test');
    expect(call[1]).toBe('mount');
    expect(call[2]).toBe(10); // 实际渲染耗时（actual time）
    expect(call[3]).toBe(10); // 基准渲染耗时（base time）
    expect(call[4]).toBe(0); // 渲染开始时间（start time）
    expect(call[5]).toBe(10); // 提交时间（commit time）

    callback.mockReset();

    Scheduler.unstable_advanceTime(20); // 10 -> 30

    await act(() => {
      root.render(<App />);
    });

    if (gate(flags => flags.enableUseJSStackToTrackPassiveDurations)) {
      // App 在进入 Profiler 前已 bailout，Profiler 子树没有任何渲染工作，故 `onRender` 不应调用。
      expect(callback).not.toHaveBeenCalled();
    } else {
      // 更新父节点仍会报告一次重渲染，因为 React 在 Profiler 与 bailout 子树之间执行了少量工作。
      // 这并非最优行为，但它锁定旧 reconciler fork 的现有语义。
      expect(callback).toHaveBeenCalledTimes(1);

      call = callback.mock.calls[0];

      expect(call).toHaveLength(6);
      expect(call[0]).toBe('test');
      expect(call[1]).toBe('update');
      expect(call[2]).toBe(0); // 实际渲染耗时（actual time）
      expect(call[3]).toBe(10); // 基准渲染耗时（base time）
      expect(call[4]).toBe(30); // 渲染开始时间（start time）
      expect(call[5]).toBe(30); // 提交时间（commit time）

      callback.mockReset();
    }

    Scheduler.unstable_advanceTime(20); // 30 -> 50

      // 更新 Profiler 的兄弟节点不经过其子树，因此不能报告重渲染。
    await act(() => updateProfilerSibling());

    expect(callback).not.toHaveBeenCalled();
  });

  /**
   * 场景：“logs render times for both mount and update”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('logs render times for both mount and update', async () => {
    const callback = jest.fn();

    Scheduler.unstable_advanceTime(5); // 0 -> 5

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <React.Profiler id="test" onRender={callback}>
          <AdvanceTime />
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(1);

    let [call] = callback.mock.calls;

    expect(call).toHaveLength(6);
    expect(call[0]).toBe('test');
    expect(call[1]).toBe('mount');
    expect(call[2]).toBe(10); // 实际渲染耗时（actual time）
    expect(call[3]).toBe(10); // 基准渲染耗时（base time）
    expect(call[4]).toBe(5); // 渲染开始时间（start time）
    expect(call[5]).toBe(15); // 提交时间（commit time）

    callback.mockReset();

    Scheduler.unstable_advanceTime(20); // 15 -> 35

    await act(() => {
      root.render(
        <React.Profiler id="test" onRender={callback}>
          <AdvanceTime />
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(1);

    [call] = callback.mock.calls;

    expect(call).toHaveLength(6);
    expect(call[0]).toBe('test');
    expect(call[1]).toBe('update');
    expect(call[2]).toBe(10); // 实际渲染耗时（actual time）
    expect(call[3]).toBe(10); // 基准渲染耗时（base time）
    expect(call[4]).toBe(35); // 渲染开始时间（start time）
    expect(call[5]).toBe(45); // 提交时间（commit time）

    callback.mockReset();

    Scheduler.unstable_advanceTime(20); // 45 -> 65

    await act(() => {
      root.render(
        <React.Profiler id="test" onRender={callback}>
          <AdvanceTime byAmount={4} />
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(1);

    [call] = callback.mock.calls;

    expect(call).toHaveLength(6);
    expect(call[0]).toBe('test');
    expect(call[1]).toBe('update');
    expect(call[2]).toBe(4); // 实际渲染耗时（actual time）
    expect(call[3]).toBe(4); // 基准渲染耗时（base time）
    expect(call[4]).toBe(65); // 渲染开始时间（start time）
    expect(call[5]).toBe(69); // 提交时间（commit time）
  });

  /**
   * 场景：“includes render times of nested Profilers in their parent times”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('includes render times of nested Profilers in their parent times', async () => {
    const callback = jest.fn();

    Scheduler.unstable_advanceTime(5); // 0 -> 5

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <React.Fragment>
          <React.Profiler id="parent" onRender={callback}>
            <AdvanceTime byAmount={10}>
              <React.Profiler id="child" onRender={callback}>
                <AdvanceTime byAmount={20} />
              </React.Profiler>
            </AdvanceTime>
          </React.Profiler>
        </React.Fragment>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(2);

    // Profiler 回调按冒泡方向执行，即从内到外逆序触发。
    const [childCall, parentCall] = callback.mock.calls;
    expect(childCall[0]).toBe('child');
    expect(parentCall[0]).toBe('parent');

    // 父 Profiler 的耗时必须包含其子 Profiler 的工作量。
    expect(childCall[2]).toBe(20); // 实际渲染耗时（actual time）
    expect(childCall[3]).toBe(20); // 基准渲染耗时（base time）
    expect(childCall[4]).toBe(15); // 渲染开始时间（start time）
    expect(childCall[5]).toBe(35); // 提交时间（commit time）
    expect(parentCall[2]).toBe(30); // 实际渲染耗时（actual time）
    expect(parentCall[3]).toBe(30); // 基准渲染耗时（base time）
    expect(parentCall[4]).toBe(5); // 渲染开始时间（start time）
    expect(parentCall[5]).toBe(35); // 提交时间（commit time）
  });

  /**
   * 场景：“traces sibling Profilers separately”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('traces sibling Profilers separately', async () => {
    const callback = jest.fn();

    Scheduler.unstable_advanceTime(5); // 0 -> 5

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <React.Fragment>
          <React.Profiler id="first" onRender={callback}>
            <AdvanceTime byAmount={20} />
          </React.Profiler>
          <React.Profiler id="second" onRender={callback}>
            <AdvanceTime byAmount={5} />
          </React.Profiler>
        </React.Fragment>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(2);

    const [firstCall, secondCall] = callback.mock.calls;
    expect(firstCall[0]).toBe('first');
    expect(secondCall[0]).toBe('second');

    // 父 Profiler 的耗时必须包含其子 Profiler 的工作量。
    expect(firstCall[2]).toBe(20); // 实际渲染耗时（actual time）
    expect(firstCall[3]).toBe(20); // 基准渲染耗时（base time）
    expect(firstCall[4]).toBe(5); // 渲染开始时间（start time）
    expect(firstCall[5]).toBe(30); // 提交时间（commit time）
    expect(secondCall[2]).toBe(5); // 实际渲染耗时（actual time）
    expect(secondCall[3]).toBe(5); // 基准渲染耗时（base time）
    expect(secondCall[4]).toBe(25); // 渲染开始时间（start time）
    expect(secondCall[5]).toBe(30); // 提交时间（commit time）
  });

  /**
   * 场景：“does not include time spent outside of profile root”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('does not include time spent outside of profile root', async () => {
    const callback = jest.fn();

    Scheduler.unstable_advanceTime(5); // 0 -> 5

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <React.Fragment>
          <AdvanceTime byAmount={20} />
          <React.Profiler id="test" onRender={callback}>
            <AdvanceTime byAmount={5} />
          </React.Profiler>
          <AdvanceTime byAmount={20} />
        </React.Fragment>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(1);

    const [call] = callback.mock.calls;
    expect(call[0]).toBe('test');
    expect(call[2]).toBe(5); // 实际渲染耗时（actual time）
    expect(call[3]).toBe(5); // 基准渲染耗时（base time）
    expect(call[4]).toBe(25); // 渲染开始时间（start time）
    expect(call[5]).toBe(50); // 提交时间（commit time）
  });

  /**
   * 场景：“is not called when blocked by sCU false”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('is not called when blocked by sCU false', async () => {
    const callback = jest.fn();

    let instance;
    /** 作为“is not called when blocked by sCU false”场景的组件夹具，隔离待验证的 React 行为。 */
    class Updater extends React.Component {
      /** 保存“is not called when blocked by sCU false”场景用于驱动更新或错误回退的组件状态。 */
      state = {};
      /** 渲染“is not called when blocked by sCU false”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        instance = this;
        return this.props.children;
      }
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <React.Profiler id="outer" onRender={callback}>
          <Updater>
            <React.Profiler id="inner" onRender={callback}>
              <div />
            </React.Profiler>
          </Updater>
        </React.Profiler>,
      );
    });
    // 首次渲染覆盖整棵树，因此所有 Profiler 回调都应触发。
    expect(callback).toHaveBeenCalledTimes(2);

    callback.mockReset();

    ReactNoop.flushSync(() => {
      instance.setState({
        count: 1,
      });
    });

    // `onRender` 只为实际重渲染的路径调用。Updater 的 props 未变化，
    // React 会 bailout 并跳过其子节点，所以该路径不能产生回调。
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0]).toBe('outer');
  });

  /**
   * 场景：“decreases actual time but not base time when sCU prevents an update”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('decreases actual time but not base time when sCU prevents an update', async () => {
    const callback = jest.fn();

    Scheduler.unstable_advanceTime(5); // 0 -> 5

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <React.Profiler id="test" onRender={callback}>
          <AdvanceTime byAmount={10}>
            <AdvanceTime byAmount={13} shouldComponentUpdate={false} />
          </AdvanceTime>
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(1);

    Scheduler.unstable_advanceTime(30); // 28 -> 58

    await act(() => {
      root.render(
        <React.Profiler id="test" onRender={callback}>
          <AdvanceTime byAmount={4}>
            <AdvanceTime byAmount={7} shouldComponentUpdate={false} />
          </AdvanceTime>
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(2);

    const [mountCall, updateCall] = callback.mock.calls;

    expect(mountCall[1]).toBe('mount');
    expect(mountCall[2]).toBe(23); // 实际渲染耗时（actual time）
    expect(mountCall[3]).toBe(23); // 基准渲染耗时（base time）
    expect(mountCall[4]).toBe(5); // 渲染开始时间（start time）
    expect(mountCall[5]).toBe(28); // 提交时间（commit time）

    expect(updateCall[1]).toBe('update');
    expect(updateCall[2]).toBe(4); // 实际渲染耗时（actual time）
    expect(updateCall[3]).toBe(17); // 基准渲染耗时（base time）
    expect(updateCall[4]).toBe(58); // 渲染开始时间（start time）
    expect(updateCall[5]).toBe(62); // 提交时间（commit time）
  });

  /**
   * 场景：“includes time spent in render phase lifecycles”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('includes time spent in render phase lifecycles', async () => {
    /** 作为“includes time spent in render phase lifecycles”场景的组件夹具，隔离待验证的 React 行为。 */
    class WithLifecycles extends React.Component {
      /** 保存“includes time spent in render phase lifecycles”场景用于驱动更新或错误回退的组件状态。 */
      state = {};
      /** 根据新属性派生“includes time spent in render phase lifecycles”场景的状态，用于验证静态生命周期语义。 */
      static getDerivedStateFromProps() {
        Scheduler.unstable_advanceTime(3);
        return null;
      }
      /** 决定“includes time spent in render phase lifecycles”场景是否继续协调，并让测试验证跳过更新的边界。 */
      shouldComponentUpdate() {
        Scheduler.unstable_advanceTime(7);
        return true;
      }
      /** 渲染“includes time spent in render phase lifecycles”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        Scheduler.unstable_advanceTime(5);
        return null;
      }
    }

    const callback = jest.fn();

    Scheduler.unstable_advanceTime(5); // 0 -> 5

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <React.Profiler id="test" onRender={callback}>
          <WithLifecycles />
        </React.Profiler>,
      );
    });

    Scheduler.unstable_advanceTime(15); // 13 -> 28

    await act(() => {
      root.render(
        <React.Profiler id="test" onRender={callback}>
          <WithLifecycles />
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(2);

    const [mountCall, updateCall] = callback.mock.calls;

    expect(mountCall[1]).toBe('mount');
    expect(mountCall[2]).toBe(8); // 实际渲染耗时（actual time）
    expect(mountCall[3]).toBe(8); // 基准渲染耗时（base time）
    expect(mountCall[4]).toBe(5); // 渲染开始时间（start time）
    expect(mountCall[5]).toBe(13); // 提交时间（commit time）

    expect(updateCall[1]).toBe('update');
    expect(updateCall[2]).toBe(15); // 实际渲染耗时（actual time）
    expect(updateCall[3]).toBe(15); // 基准渲染耗时（base time）
    expect(updateCall[4]).toBe(28); // 渲染开始时间（start time）
    expect(updateCall[5]).toBe(43); // 提交时间（commit time）
  });

  /**
   * 场景：“should clear nested-update flag when multiple cascading renders are scheduled”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('should clear nested-update flag when multiple cascading renders are scheduled', async () => {
    jest.resetModules();
    loadModules();

    /** 作为“should clear nested-update flag when multiple cascading renders are scheduled”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function Component() {
      const [didMount, setDidMount] = React.useState(false);
      const [didMountAndUpdate, setDidMountAndUpdate] = React.useState(false);

      React.useLayoutEffect(() => {
        setDidMount(true);
      }, []);

      React.useEffect(() => {
        if (didMount && !didMountAndUpdate) {
          setDidMountAndUpdate(true);
        }
      }, [didMount, didMountAndUpdate]);

      Scheduler.log(`${didMount}:${didMountAndUpdate}`);

      return null;
    }

    const onRender = jest.fn();

    await act(() => {
      ReactNoop.render(
        <React.Profiler id="root" onRender={onRender}>
          <Component />
        </React.Profiler>,
      );
    });
    assertLog(['false:false', 'true:false', 'true:true']);

    expect(onRender).toHaveBeenCalledTimes(3);
    expect(onRender.mock.calls[0][1]).toBe('mount');
    expect(onRender.mock.calls[1][1]).toBe('nested-update');
    expect(onRender.mock.calls[2][1]).toBe('update');
  });

  /**
   * 场景：“is properly distinguish updates and nested-updates when there is more than sync remaining work”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('is properly distinguish updates and nested-updates when there is more than sync remaining work', () => {
    jest.resetModules();
    loadModules();

    /** 触发含剩余同步工作的嵌套更新，供 Profiler 区分提交类型。 */
    function Component() {
      const [didMount, setDidMount] = React.useState(false);

      React.useLayoutEffect(() => {
        setDidMount(true);
      }, []);
      Scheduler.log(didMount);
      return didMount;
    }

    const onRender = jest.fn();

    // 安排低优先级工作，建立可被同步更新打断的在途任务。
    React.startTransition(() =>
      ReactNoop.render(
        <React.Profiler id="root" onRender={onRender}>
          <Component />
        </React.Profiler>,
      ),
    );

    // 同步 flush，并在该工作内部再安排嵌套更新。
    ReactNoop.flushSync(() => {
      ReactNoop.render(
        <React.Profiler id="root" onRender={onRender}>
          <Component />
        </React.Profiler>,
      );
    });
    assertLog([false, true]);

    // 断言同步工作内部的嵌套更新继承正确的提交标记。
    expect(onRender).toHaveBeenCalledTimes(2);
    expect(onRender.mock.calls[0][1]).toBe('mount');
    expect(onRender.mock.calls[1][1]).toBe('nested-update');
  });

  describe('with regard to interruptions', () => {
    /**
     * 场景：“should accumulate actual time after a scheduling interruptions”。
     * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
     */
    it('should accumulate actual time after a scheduling interruptions', async () => {
      const callback = jest.fn();

      /** 作为“should accumulate actual time after a scheduling interruptions”场景的函数夹具，返回待协调内容或触发目标行为。 */
      const Yield = ({renderTime}) => {
        Scheduler.unstable_advanceTime(renderTime);
        Scheduler.log('Yield:' + renderTime);
        return null;
      };

      Scheduler.unstable_advanceTime(5); // 0 -> 5

      const root = ReactNoop.createRoot();
    // 只渲染部分节点并耗尽时间片，保留可恢复的未完成工作。
      React.startTransition(() => {
        root.render(
          <React.Profiler id="test" onRender={callback}>
            <Yield renderTime={2} />
            <Yield renderTime={3} />
          </React.Profiler>,
        );
      });

      await waitFor(['Yield:2']);
      expect(callback).toHaveBeenCalledTimes(0);

    // 恢复渲染剩余子节点。
      await waitForAll(['Yield:3']);

    // 记录的实际耗时必须包含暂停前后两段渲染工作。
      expect(callback).toHaveBeenCalledTimes(1);
      const [call] = callback.mock.calls;
      expect(call[2]).toBe(5); // 实际渲染耗时（actual time）
      expect(call[3]).toBe(5); // 基准渲染耗时（base time）
      expect(call[4]).toBe(5); // 渲染开始时间（start time）
      expect(call[5]).toBe(10); // 提交时间（commit time）
    });

    /**
     * 场景：“should not include time between frames”。
     * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
     */
    it('should not include time between frames', async () => {
      const callback = jest.fn();

      /** 作为“should not include time between frames”场景的函数夹具，返回待协调内容或触发目标行为。 */
      const Yield = ({renderTime}) => {
        Scheduler.unstable_advanceTime(renderTime);
        Scheduler.log('Yield:' + renderTime);
        return null;
      };

      Scheduler.unstable_advanceTime(5); // 0 -> 5

      const root = ReactNoop.createRoot();
    // 执行耗时 5ms 的部分渲染，但不完成整棵树。
      React.startTransition(() => {
        root.render(
          <React.Profiler id="outer" onRender={callback}>
            <Yield renderTime={5} />
            <Yield renderTime={10} />
            <React.Profiler id="inner" onRender={callback}>
              <Yield renderTime={17} />
            </React.Profiler>
          </React.Profiler>,
        );
      });

      await waitFor(['Yield:5']);
      expect(callback).toHaveBeenCalledTimes(0);

    // 在帧暂停期间推进时钟；该空闲时间不应计入渲染耗时。
      Scheduler.unstable_advanceTime(50); // 10 -> 60

    // flush 剩余工作，并额外消耗 10ms 模拟渲染时间。
      await waitForAll(['Yield:10', 'Yield:17']);
      expect(callback).toHaveBeenCalledTimes(2);

      const [innerCall, outerCall] = callback.mock.calls;

    // actual time 应包含两段实际工作时间，但排除帧间暂停流逝的时间。
      expect(innerCall[0]).toBe('inner');
      expect(innerCall[2]).toBe(17); // 实际渲染耗时（actual time）
      expect(innerCall[3]).toBe(17); // 基准渲染耗时（base time）
      expect(innerCall[4]).toBe(70); // 渲染开始时间（start time）
      expect(innerCall[5]).toBe(87); // 提交时间（commit time）
      expect(outerCall[0]).toBe('outer');
      expect(outerCall[2]).toBe(32); // 实际渲染耗时（actual time）
      expect(outerCall[3]).toBe(32); // 基准渲染耗时（base time）
      expect(outerCall[4]).toBe(5); // 渲染开始时间（start time）
      expect(outerCall[5]).toBe(87); // 提交时间（commit time）
    });

    /**
     * 场景：“should report the expected times when a high-pri update replaces a mount in-progress”。
     * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
     */
    it('should report the expected times when a high-pri update replaces a mount in-progress', async () => {
      const callback = jest.fn();

      /** 作为“should report the expected times when a high-pri update replaces a mount in-progress”场景的函数夹具，返回待协调内容或触发目标行为。 */
      const Yield = ({renderTime}) => {
        Scheduler.unstable_advanceTime(renderTime);
        Scheduler.log('Yield:' + renderTime);
        return null;
      };

      Scheduler.unstable_advanceTime(5); // 0 -> 5

      const root = ReactNoop.createRoot();
    // 执行耗时 10ms 的部分更新，但在完成前让出时间片。
      React.startTransition(() => {
        root.render(
          <React.Profiler id="test" onRender={callback}>
            <Yield renderTime={10} />
            <Yield renderTime={20} />
          </React.Profiler>,
        );
      });

      await waitFor(['Yield:10']);
      expect(callback).toHaveBeenCalledTimes(0);

    // 在暂停期间推进时钟；这段空闲时间不能计入 render duration。
      Scheduler.unstable_advanceTime(100); // 15 -> 115

    // 用高优先级工作打断在途更新；本次替代渲染额外消耗 5ms。
      ReactNoop.flushSync(() => {
        root.render(
          <React.Profiler id="test" onRender={callback}>
            <Yield renderTime={5} />
          </React.Profiler>,
        );
      });
      assertLog(['Yield:5']);

    // 首次在途工作被丢弃，actual 与 base time 都只能包含最终提交树的耗时。
      expect(callback).toHaveBeenCalledTimes(1);
      const call = callback.mock.calls[0];
      expect(call[2]).toBe(5); // 实际渲染耗时（actual time）
      expect(call[3]).toBe(5); // 基准渲染耗时（base time）
      expect(call[4]).toBe(115); // 渲染开始时间（start time）
      expect(call[5]).toBe(120); // 提交时间（commit time）

      callback.mockReset();

    // 低优先级废弃工作不得再产生额外回调。
      await waitForAll([]);
      expect(callback).toHaveBeenCalledTimes(0);
    });

    /**
     * 场景：“should report the expected times when a high-priority update replaces a low-priority update”。
     * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
     */
    it('should report the expected times when a high-priority update replaces a low-priority update', async () => {
      const callback = jest.fn();

      /** 构造高优先级更新替换低优先级更新的计时夹具。 */
      const Yield = ({renderTime}) => {
        Scheduler.unstable_advanceTime(renderTime);
        Scheduler.log('Yield:' + renderTime);
        return null;
      };

      Scheduler.unstable_advanceTime(5); // 0 -> 5
      const root = ReactNoop.createRoot();
      root.render(
        <React.Profiler id="test" onRender={callback}>
          <Yield renderTime={6} />
          <Yield renderTime={15} />
        </React.Profiler>,
      );

    // 首次完整渲染消耗 21 秒，actual 与 base time 均以此为基线。
      await waitForAll(['Yield:6', 'Yield:15']);
      expect(callback).toHaveBeenCalledTimes(1);
      let call = callback.mock.calls[0];
      expect(call[2]).toBe(21); // 实际渲染耗时（actual time）
      expect(call[3]).toBe(21); // 基准渲染耗时（base time）
      expect(call[4]).toBe(5); // 渲染开始时间（start time）
      expect(call[5]).toBe(26); // 提交时间（commit time）

      callback.mockReset();

      Scheduler.unstable_advanceTime(30); // 26 -> 56

    // 执行耗时 3ms 的部分更新，但不完成提交。
      React.startTransition(() => {
        root.render(
          <React.Profiler id="test" onRender={callback}>
            <Yield renderTime={3} />
            <Yield renderTime={5} />
            <Yield renderTime={9} />
          </React.Profiler>,
        );
      });

      await waitFor(['Yield:3']);
      expect(callback).toHaveBeenCalledTimes(0);

    // 在帧暂停期间推进时钟，不把空闲时间计入渲染耗时。
      Scheduler.unstable_advanceTime(100); // 59 -> 159

    // 继续执行 5ms 的模拟渲染工作。
      await waitFor(['Yield:5']);
      expect(callback).toHaveBeenCalledTimes(0);

    // 再次暂停并推进时钟，验证多次空闲间隔均被排除。
      Scheduler.unstable_advanceTime(100); // 164 -> 264

    // 高优先级工作打断原更新，并执行额外 11ms 的替代渲染。
      ReactNoop.flushSync(() => {
        root.render(
          <React.Profiler id="test" onRender={callback}>
            <Yield renderTime={11} />
          </React.Profiler>,
        );
      });
      assertLog(['Yield:11']);

    // actual time 只包含最近一次渲染，以避免提交阶段复杂的计时复位；
    // base time 同样只反映最终提交树。
      expect(callback).toHaveBeenCalledTimes(1);
      call = callback.mock.calls[0];
      expect(call[2]).toBe(11); // 实际渲染耗时（actual time）
      expect(call[3]).toBe(11); // 基准渲染耗时（base time）
      expect(call[4]).toBe(264); // 渲染开始时间（start time）
      expect(call[5]).toBe(275); // 提交时间（commit time）

    // 被丢弃的低优先级工作不得再触发回调。
      await waitForAll([]);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    /**
     * 场景：“should report the expected times when a high-priority update interrupts a low-priority update”。
     * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
     */
    it('should report the expected times when a high-priority update interrupts a low-priority update', async () => {
      const callback = jest.fn();

      /** 构造高优先级更新打断低优先级更新的计时夹具。 */
      const Yield = ({renderTime}) => {
        Scheduler.unstable_advanceTime(renderTime);
        Scheduler.log('Yield:' + renderTime);
        return null;
      };

      let first;
      /** 作为“should report the expected times when a high-priority update interrupts a low-priority upd”场景的组件夹具，隔离待验证的 React 行为。 */
      class FirstComponent extends React.Component {
        /** 保存“should report the expected times when a high-priority update interrupts a low-priority upd”场景用于驱动更新或错误回退的组件状态。 */
        state = {renderTime: 1};
        /** 渲染首次子树，保存可与中断后耗时组合的 base time。 */
        render() {
          first = this;
          Scheduler.unstable_advanceTime(this.state.renderTime);
          Scheduler.log('FirstComponent:' + this.state.renderTime);
          return <Yield renderTime={4} />;
        }
      }
      let second;
      /** 作为“should report the expected times when a high-priority update interrupts a low-priority upd”场景的组件夹具，隔离待验证的 React 行为。 */
      class SecondComponent extends React.Component {
        /** 保存“should report the expected times when a high-priority update interrupts a low-priority upd”场景用于驱动更新或错误回退的组件状态。 */
        state = {renderTime: 2};
        /** 渲染可被高优先级工作替换的第二棵子树。 */
        render() {
          second = this;
          Scheduler.unstable_advanceTime(this.state.renderTime);
          Scheduler.log('SecondComponent:' + this.state.renderTime);
          return <Yield renderTime={7} />;
        }
      }

      Scheduler.unstable_advanceTime(5); // 0 -> 5

      const root = ReactNoop.createRoot();
      root.render(
        <React.Profiler id="test" onRender={callback}>
          <FirstComponent />
          <SecondComponent />
        </React.Profiler>,
      );

    // 首次完整渲染的 actual 与 base render time 都是 14ms。
      await waitForAll([
        'FirstComponent:1',
        'Yield:4',
        'SecondComponent:2',
        'Yield:7',
      ]);
      expect(callback).toHaveBeenCalledTimes(1);
      let call = callback.mock.calls[0];
      expect(call[2]).toBe(14); // 实际渲染耗时（actual time）
      expect(call[3]).toBe(14); // 基准渲染耗时（base time）
      expect(call[4]).toBe(5); // 渲染开始时间（start time）
      expect(call[5]).toBe(19); // 提交时间（commit time）

      callback.mockClear();

      Scheduler.unstable_advanceTime(100); // 19 -> 119

    // 执行 10ms 的部分更新，但在提交前暂停。
      React.startTransition(() => {
        first.setState({renderTime: 10});
      });

      await waitFor(['FirstComponent:10']);
      expect(callback).toHaveBeenCalledTimes(0);

    // 暂停期间推进时钟；该间隔不属于 React 实际工作。
      Scheduler.unstable_advanceTime(100); // 129 -> 229

    // 高优先级更新打断在途工作，本轮实际渲染总计 37ms。
      ReactNoop.flushSync(() => second.setState({renderTime: 30}));
      assertLog(['SecondComponent:30', 'Yield:7']);

    // actual time 只包含最近一次 37ms 渲染，以简化提交阶段逻辑。
    // base time 组合 SecondComponent 子树的最新耗时与 FirstComponent 子树的原始耗时。
      expect(callback).toHaveBeenCalledTimes(1);
      call = callback.mock.calls[0];
      expect(call[2]).toBe(37); // 实际渲染耗时（actual time）
      expect(call[3]).toBe(42); // 基准渲染耗时（base time）
      expect(call[4]).toBe(229); // 渲染开始时间（start time）
      expect(call[5]).toBe(266); // 提交时间（commit time）

      callback.mockClear();

    // 暂停期间继续推进时钟，验证恢复时不会把间隔计入耗时。
      Scheduler.unstable_advanceTime(100); // 266 -> 366

    // 用 rebase 后的状态恢复原低优先级更新，本轮 actual time 为 14ms，
    // 不包含最初被打断的 10ms；树的 base time 为 42ms，反映各子树最近且更长的耗时。
    // TODO：Scheduler 支持真正续跑后，actual time 应再减少 10ms。
      await waitForAll(['FirstComponent:10', 'Yield:4']);
      expect(callback).toHaveBeenCalledTimes(1);
      call = callback.mock.calls[0];
      expect(call[2]).toBe(14); // 实际渲染耗时（actual time）
      expect(call[3]).toBe(51); // 基准渲染耗时（base time）
      expect(call[4]).toBe(366); // 渲染开始时间（start time）
      expect(call[5]).toBe(380); // 提交时间（commit time）
    });

    /**
     * 场景：“should accumulate actual time after an error handled by componentDidCatch()”。
     * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
     */
    it('should accumulate actual time after an error handled by componentDidCatch()', async () => {
      const callback = jest.fn();

      /** 作为“should accumulate actual time after an error handled by componentDidCatch()”场景的函数夹具，返回待协调内容或触发目标行为。 */
      const ThrowsError = ({unused}) => {
        Scheduler.unstable_advanceTime(3);
        throw Error('expected error');
      };

      /** 作为“should accumulate actual time after an error handled by componentDidCatch()”场景的组件夹具，隔离待验证的 React 行为。 */
      class ErrorBoundary extends React.Component {
        /** 保存“should accumulate actual time after an error handled by componentDidCatch()”场景用于驱动更新或错误回退的组件状态。 */
        state = {error: null};
        /** 记录“should accumulate actual time after an error handled by componentDidCatch()”场景捕获的渲染错误与组件栈。 */
        componentDidCatch(error) {
          this.setState({error});
        }
        /** 渲染“should accumulate actual time after an error handled by componentDidCatch()”场景所需的元素树，使断言能够观察协调与提交结果。 */
        render() {
          Scheduler.unstable_advanceTime(2);
          return this.state.error === null ? (
            this.props.children
          ) : (
            <AdvanceTime byAmount={20} />
          );
        }
      }

      Scheduler.unstable_advanceTime(5); // 0 -> 5

      const root = ReactNoop.createRoot();
      await act(() => {
        root.render(
          <React.Profiler id="test" onRender={callback}>
            <ErrorBoundary>
              <AdvanceTime byAmount={9} />
              <ThrowsError />
            </ErrorBoundary>
          </React.Profiler>,
        );
      });

      expect(callback).toHaveBeenCalledTimes(2);

    // Profiler 回调按冒泡方向从内到外逆序执行。
      const [mountCall, updateCall] = callback.mock.calls;

    // 首次提交树只包含耗时 2ms 的 ErrorBoundary，但 actual time 还包括失败子树的渲染工作。
      expect(mountCall[1]).toBe('mount');
    // actual time = 2（ErrorBoundary）+ 9（AdvanceTime）+ 3（ThrowsError）；失败单元的重放耗时不重复计算。
      expect(mountCall[2]).toBe(14);
    // 初次提交的子树为空，因此 base time 只包含 ErrorBoundary 的 2ms。
      expect(mountCall[3]).toBe(2);

    // start time = 初始 5ms + 14ms 工作；若重放失败单元，再加 ThrowsError 的 3ms。
      expect(mountCall[4]).toBe(19);
    // commit time = 初始 19ms + 14ms 工作；若重放失败单元，再加两次 ThrowsError 的 6ms。
      expect(mountCall[5]).toBe(33);

    // 后续更新提交 ErrorBoundary 与其回退子节点。
      expect(updateCall[1]).toBe('nested-update');
    // actual time 包含 ErrorBoundary 的 2ms 与回退内容的 20ms。
      expect(updateCall[2]).toBe(22);
    // base time 同样记录最终树中 ErrorBoundary 2ms 与回退内容 20ms。
      expect(updateCall[3]).toBe(22);
    // 断言本次回退更新的开始时间。
      expect(updateCall[4]).toBe(33);
    // commit time = 19（startTime）+ 2（ErrorBoundary）+ 20（AdvanceTime）；若重放失败工作再加 3ms。
      expect(updateCall[5]).toBe(55);
    });

    /**
     * 场景：“should accumulate actual time after an error handled by getDerivedStateFromError()”。
     * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
     */
    it('should accumulate actual time after an error handled by getDerivedStateFromError()', async () => {
      const callback = jest.fn();

      /** 作为“should accumulate actual time after an error handled by getDerivedStateFromError()”场景的函数夹具，返回待协调内容或触发目标行为。 */
      const ThrowsError = ({unused}) => {
        Scheduler.unstable_advanceTime(10);
        throw Error('expected error');
      };

      /** 作为“should accumulate actual time after an error handled by getDerivedStateFromError()”场景的组件夹具，隔离待验证的 React 行为。 */
      class ErrorBoundary extends React.Component {
        /** 保存“should accumulate actual time after an error handled by getDerivedStateFromError()”场景用于驱动更新或错误回退的组件状态。 */
        state = {error: null};
        /** 把渲染错误转换为“should accumulate actual time after an error handled by getDerivedStateFromError()”场景的回退状态。 */
        static getDerivedStateFromError(error) {
          return {error};
        }
        /** 渲染错误边界状态对应的正常子树或回退子树。 */
        render() {
          Scheduler.unstable_advanceTime(2);
          return this.state.error === null ? (
            this.props.children
          ) : (
            <AdvanceTime byAmount={20} />
          );
        }
      }

      Scheduler.unstable_advanceTime(5); // 0 -> 5

      await act(() => {
        const root = ReactNoop.createRoot();
        root.render(
          <React.Profiler id="test" onRender={callback}>
            <ErrorBoundary>
              <AdvanceTime byAmount={5} />
              <ThrowsError />
            </ErrorBoundary>
          </React.Profiler>,
        );
      });

      expect(callback).toHaveBeenCalledTimes(1);

    // Profiler 回调按冒泡方向从内到外逆序执行。
      const [mountCall] = callback.mock.calls;

    // 首次挂载提交 ErrorBoundary 的错误状态，但 actual time 还包含未进入最终树的失败 UI 工作。
      expect(mountCall[1]).toBe('mount');
    // actual time 先包含 2 + 5 + 10ms 的失败渲染，再包含 2 + 20ms 的回退重渲染；
    // 失败单元的重放耗时不重复计算。
      expect(mountCall[2]).toBe(39);
    // base time 只反映最终树：ErrorBoundary 2ms 与回退内容 20ms。
      expect(mountCall[3]).toBe(22);
    // 断言错误恢复提交的开始时间。
      expect(mountCall[4]).toBe(44);
    // 断言错误恢复完成后的提交时间。
      expect(mountCall[5]).toBe(83);
    });

    /**
     * 场景：“当前测试”。
     * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
     */
    it('should reset the fiber stack correct after a "complete" phase error', async () => {
      jest.resetModules();

      loadModules({
        useNoopRenderer: true,
      });

    // 在 complete 阶段模拟 renderer 错误，对应 React Native View/Text 嵌套校验一类失败。
      ReactNoop.render(
        <React.Profiler id="profiler" onRender={jest.fn()}>
          <errorInCompletePhase>hi</errorInCompletePhase>
        </React.Profiler>,
      );
      await waitForThrow('Error in host config.');

    // ReactDOM invariant 曾触发类似场景；子树中缺少 host component 时无法复现。
      ReactNoop.render(
        <React.Profiler id="profiler" onRender={jest.fn()}>
          <errorInCompletePhase>
            <span>hi</span>
          </errorInCompletePhase>
        </React.Profiler>,
      );
      await waitForThrow('Error in host config.');

    // 只要错误后正确复位 profiler timer 的 Fiber 栈，后续渲染就不应继续报错。
      ReactNoop.render(
        <React.Profiler id="profiler" onRender={jest.fn()}>
          <span>hi</span>
        </React.Profiler>,
      );
      await waitForAll([]);
    });
  });

  /**
   * 场景：“reflects the most recently rendered id value”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('reflects the most recently rendered id value', async () => {
    const callback = jest.fn();

    Scheduler.unstable_advanceTime(5); // 0 -> 5

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <React.Profiler id="one" onRender={callback}>
          <AdvanceTime byAmount={2} />
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(1);

    Scheduler.unstable_advanceTime(20); // 7 -> 27

    await act(() => {
      root.render(
        <React.Profiler id="two" onRender={callback}>
          <AdvanceTime byAmount={1} />
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(2);

    const [mountCall, updateCall] = callback.mock.calls;

    expect(mountCall[0]).toBe('one');
    expect(mountCall[1]).toBe('mount');
    expect(mountCall[2]).toBe(2); // 实际渲染耗时（actual time）
    expect(mountCall[3]).toBe(2); // 基准渲染耗时（base time）
    expect(mountCall[4]).toBe(5); // 渲染开始时间（start time）

    expect(updateCall[0]).toBe('two');
    expect(updateCall[1]).toBe('update');
    expect(updateCall[2]).toBe(1); // 实际渲染耗时（actual time）
    expect(updateCall[3]).toBe(1); // 基准渲染耗时（base time）
    expect(updateCall[4]).toBe(27); // 渲染开始时间（start time）
  });

  /**
   * 场景：“should not be called until after mutations”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('should not be called until after mutations', async () => {
    let classComponentMounted = false;
    const callback = jest.fn(
      (id, phase, actualDuration, baseDuration, startTime, commitTime) => {
    // 该 hook 必须等 DOM/host 变更完成后才调用。
        expect(classComponentMounted).toBe(true);
    // 但 commit time 必须记录 mutation 前确定的提交起点。
        expect(commitTime).toBe(2);
      },
    );

    /** 作为“should not be called until after mutations”场景的组件夹具，隔离待验证的 React 行为。 */
    class ClassComponent extends React.Component {
      /** 记录“should not be called until after mutations”场景的挂载提交，并执行仅在挂载后有效的观测。 */
      componentDidMount() {
        Scheduler.unstable_advanceTime(5);
        classComponentMounted = true;
      }
      /** 渲染“should not be called until after mutations”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        Scheduler.unstable_advanceTime(2);
        return null;
      }
    }
    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <React.Profiler id="test" onRender={callback}>
          <ClassComponent />
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe(`onCommit`, () => {
  beforeEach(() => {
    jest.resetModules();

    loadModules();
  });

  /**
   * 场景：“should report time spent in layout effects and commit lifecycles”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('should report time spent in layout effects and commit lifecycles', async () => {
    const callback = jest.fn();

    /** 作为“should report time spent in layout effects and commit lifecycles”场景的函数夹具，返回待协调内容或触发目标行为。 */
    const ComponentWithEffects = () => {
      React.useLayoutEffect(() => {
        Scheduler.unstable_advanceTime(10);
        return () => {
          Scheduler.unstable_advanceTime(100);
        };
      }, []);
      React.useLayoutEffect(() => {
        Scheduler.unstable_advanceTime(1000);
        return () => {
          Scheduler.unstable_advanceTime(10000);
        };
      });
      React.useEffect(() => {
        // 此 passive effect 用于证明其执行时间不会计入当前 Profiler 提交回调。
        Scheduler.unstable_advanceTime(5);
        return () => {
          Scheduler.unstable_advanceTime(7);
        };
      });
      return null;
    };

    /** 作为“should report time spent in layout effects and commit lifecycles”场景的组件夹具，隔离待验证的 React 行为。 */
    class ComponentWithCommitHooks extends React.Component {
      /** 记录“should report time spent in layout effects and commit lifecycles”场景的挂载提交，并执行仅在挂载后有效的观测。 */
      componentDidMount() {
        Scheduler.unstable_advanceTime(100000);
      }
      /** 记录“should report time spent in layout effects and commit lifecycles”场景的更新提交，供生命周期顺序断言使用。 */
      componentDidUpdate() {
        Scheduler.unstable_advanceTime(1000000);
      }
      /** 渲染“should report time spent in layout effects and commit lifecycles”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return null;
      }
    }

    Scheduler.unstable_advanceTime(1);
    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <React.Profiler id="mount-test" onCommit={callback}>
          <ComponentWithEffects />
          <ComponentWithCommitHooks />
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(1);

    let call = callback.mock.calls[0];

    expect(call).toHaveLength(4);
    expect(call[0]).toBe('mount-test');
    expect(call[1]).toBe('mount');
    expect(call[2]).toBe(101010); // 各阶段耗时（durations）
    expect(call[3]).toBe(1); // 提交开始时间（mutation 与 effect 之前）

    Scheduler.unstable_advanceTime(1);

    await act(() => {
      root.render(
        <React.Profiler id="update-test" onCommit={callback}>
          <ComponentWithEffects />
          <ComponentWithCommitHooks />
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(2);

    call = callback.mock.calls[1];

    expect(call).toHaveLength(4);
    expect(call[0]).toBe('update-test');
    expect(call[1]).toBe('update');
    expect(call[2]).toBe(1011000); // 各阶段耗时（durations）
    expect(call[3]).toBe(101017); // 提交开始时间（mutation 与 effect 之前）

    Scheduler.unstable_advanceTime(1);

    await act(() => {
      root.render(<React.Profiler id="unmount-test" onCommit={callback} />);
    });

    expect(callback).toHaveBeenCalledTimes(3);

    call = callback.mock.calls[2];

    expect(call).toHaveLength(4);
    expect(call[0]).toBe('unmount-test');
    expect(call[1]).toBe('update');
    expect(call[2]).toBe(10100); // 各阶段耗时（durations）
    expect(call[3]).toBe(1112030); // 提交开始时间（mutation 与 effect 之前）
  });

  /**
   * 场景：“should report time spent in layout effects and commit lifecycles with cascading renders”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('should report time spent in layout effects and commit lifecycles with cascading renders', async () => {
    const callback = jest.fn();

    /** 作为“should report time spent in layout effects and commit lifecycles with cascading renders”场景的函数夹具，返回待协调内容或触发目标行为。 */
    const ComponentWithEffects = ({shouldCascade}) => {
      const [didCascade, setDidCascade] = React.useState(false);
      Scheduler.unstable_advanceTime(100000000);
      React.useLayoutEffect(() => {
        if (shouldCascade && !didCascade) {
          setDidCascade(true);
        }
        Scheduler.unstable_advanceTime(didCascade ? 30 : 10);
        return () => {
          Scheduler.unstable_advanceTime(100);
        };
      }, [didCascade, shouldCascade]);
      return null;
    };

    /** 作为“should report time spent in layout effects and commit lifecycles with cascading renders”场景的组件夹具，隔离待验证的 React 行为。 */
    class ComponentWithCommitHooks extends React.Component {
      /** 保存“should report time spent in layout effects and commit lifecycles with cascading renders”场景用于驱动更新或错误回退的组件状态。 */
      state = {
        didCascade: false,
      };
      /** 记录“should report time spent in layout effects and commit lifecycles with cascading renders”场景的挂载提交，并执行仅在挂载后有效的观测。 */
      componentDidMount() {
        Scheduler.unstable_advanceTime(1000);
      }
      /** 记录“should report time spent in layout effects and commit lifecycles with cascading renders”场景的更新提交，供生命周期顺序断言使用。 */
      componentDidUpdate() {
        Scheduler.unstable_advanceTime(10000);
        if (this.props.shouldCascade && !this.state.didCascade) {
          this.setState({didCascade: true});
        }
      }
      /** 渲染含提交生命周期与级联更新的计时子树。 */
      render() {
        Scheduler.unstable_advanceTime(1000000000);
        return null;
      }
    }

    Scheduler.unstable_advanceTime(1);
    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <React.Profiler id="mount-test" onCommit={callback}>
          <ComponentWithEffects shouldCascade={true} />
          <ComponentWithCommitHooks />
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(2);

    let call = callback.mock.calls[0];

    expect(call).toHaveLength(4);
    expect(call[0]).toBe('mount-test');
    expect(call[1]).toBe('mount');
    expect(call[2]).toBe(1010); // 各阶段耗时（durations）
    expect(call[3]).toBe(1100000001); // 提交开始时间（mutation 与 effect 之前）

    call = callback.mock.calls[1];

    expect(call).toHaveLength(4);
    expect(call[0]).toBe('mount-test');
    expect(call[1]).toBe('nested-update');
    expect(call[2]).toBe(130); // 各阶段耗时（durations）
    expect(call[3]).toBe(1200001011); // 提交开始时间（mutation 与 effect 之前）

    Scheduler.unstable_advanceTime(1);

    await act(() => {
      root.render(
        <React.Profiler id="update-test" onCommit={callback}>
          <ComponentWithEffects />
          <ComponentWithCommitHooks shouldCascade={true} />
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(4);

    call = callback.mock.calls[2];

    expect(call).toHaveLength(4);
    expect(call[0]).toBe('update-test');
    expect(call[1]).toBe('update');
    expect(call[2]).toBe(10130); // 各阶段耗时（durations）
    expect(call[3]).toBe(2300001142); // 提交开始时间（mutation 与 effect 之前）

    call = callback.mock.calls[3];

    expect(call).toHaveLength(4);
    expect(call[0]).toBe('update-test');
    expect(call[1]).toBe('nested-update');
    expect(call[2]).toBe(10000); // 各阶段耗时（durations）
    expect(call[3]).toBe(3300011272); // 提交开始时间（mutation 与 effect 之前）
  });

  /**
   * 场景：“should include time spent in ref callbacks”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('should include time spent in ref callbacks', async () => {
    const callback = jest.fn();

    /** 实现“should include time spent in ref callbacks”场景所需的“refSetter”测试夹具行为。 */
    const refSetter = ref => {
      if (ref !== null) {
        Scheduler.unstable_advanceTime(10);
      } else {
        Scheduler.unstable_advanceTime(100);
      }
    };

    /** 作为“should include time spent in ref callbacks”场景的组件夹具，隔离待验证的 React 行为。 */
    class ClassComponent extends React.Component {
      /** 渲染“should include time spent in ref callbacks”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return null;
      }
    }

    /** 作为“should include time spent in ref callbacks”场景的函数夹具，返回待协调内容或触发目标行为。 */
    const Component = () => {
      Scheduler.unstable_advanceTime(1000);
      return <ClassComponent ref={refSetter} />;
    };

    Scheduler.unstable_advanceTime(1);

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <React.Profiler id="root" onCommit={callback}>
          <Component />
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(1);

    let call = callback.mock.calls[0];

    expect(call).toHaveLength(4);
    expect(call[0]).toBe('root');
    expect(call[1]).toBe('mount');
    expect(call[2]).toBe(10); // 各阶段耗时（durations）
    expect(call[3]).toBe(1001); // 提交开始时间（mutation 与 effect 之前）

    callback.mockClear();

    await act(() => {
      root.render(<React.Profiler id="root" onCommit={callback} />);
    });

    expect(callback).toHaveBeenCalledTimes(1);

    call = callback.mock.calls[0];

    expect(call).toHaveLength(4);
    expect(call[0]).toBe('root');
    expect(call[1]).toBe('update');
    expect(call[2]).toBe(100); // 各阶段耗时（durations）
    expect(call[3]).toBe(1011); // 提交开始时间（mutation 与 effect 之前）
  });

  /**
   * 场景：“should bubble time spent in layout effects to higher profilers”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('should bubble time spent in layout effects to higher profilers', async () => {
    const callback = jest.fn();

    /** 作为“should bubble time spent in layout effects to higher profilers”场景的函数夹具，返回待协调内容或触发目标行为。 */
    const ComponentWithEffects = ({cleanupDuration, duration, setCountRef}) => {
      const setCount = React.useState(0)[1];
      if (setCountRef != null) {
        setCountRef.current = setCount;
      }
      React.useLayoutEffect(() => {
        Scheduler.unstable_advanceTime(duration);
        return () => {
          Scheduler.unstable_advanceTime(cleanupDuration);
        };
      });
      Scheduler.unstable_advanceTime(1);
      return null;
    };

    const setCountRef = React.createRef(null);

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <React.Profiler id="root-mount" onCommit={callback}>
          <React.Profiler id="a">
            <ComponentWithEffects
              duration={10}
              cleanupDuration={100}
              setCountRef={setCountRef}
            />
          </React.Profiler>
          <React.Profiler id="b">
            <ComponentWithEffects duration={1000} cleanupDuration={10000} />
          </React.Profiler>
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(1);

    let call = callback.mock.calls[0];

    expect(call).toHaveLength(4);
    expect(call[0]).toBe('root-mount');
    expect(call[1]).toBe('mount');
    expect(call[2]).toBe(1010); // 各阶段耗时（durations）
    expect(call[3]).toBe(2); // 提交开始时间（mutation 与 effect 之前）

    await act(() => setCountRef.current(count => count + 1));

    expect(callback).toHaveBeenCalledTimes(2);

    call = callback.mock.calls[1];

    expect(call).toHaveLength(4);
    expect(call[0]).toBe('root-mount');
    expect(call[1]).toBe('update');
    expect(call[2]).toBe(110); // 各阶段耗时（durations）
    expect(call[3]).toBe(1013); // 提交开始时间（mutation 与 effect 之前）

    await act(() => {
      root.render(
        <React.Profiler id="root-update" onCommit={callback}>
          <React.Profiler id="b">
            <ComponentWithEffects duration={1000} cleanupDuration={10000} />
          </React.Profiler>
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(3);

    call = callback.mock.calls[2];

    expect(call).toHaveLength(4);
    expect(call[0]).toBe('root-update');
    expect(call[1]).toBe('update');
    expect(call[2]).toBe(11100); // 各阶段耗时（durations）
    expect(call[3]).toBe(1124); // 提交开始时间（mutation 与 effect 之前）
  });

  /**
   * 场景：“should properly report time in layout effects even when there are errors”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('should properly report time in layout effects even when there are errors', async () => {
    const callback = jest.fn();

    /** 作为“should properly report time in layout effects even when there are errors”场景的组件夹具，隔离待验证的 React 行为。 */
    class ErrorBoundary extends React.Component {
      /** 保存“should properly report time in layout effects even when there are errors”场景用于驱动更新或错误回退的组件状态。 */
      state = {error: null};
      /** 把渲染错误转换为“should properly report time in layout effects even when there are errors”场景的回退状态。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 渲染“should properly report time in layout effects even when there are errors”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return this.state.error === null
          ? this.props.children
          : this.props.fallback;
      }
    }

    /** 作为“should properly report time in layout effects even when there are errors”场景的函数夹具，返回待协调内容或触发目标行为。 */
    const ComponentWithEffects = ({
      cleanupDuration,
      duration,
      effectDuration,
      shouldThrow,
    }) => {
      React.useLayoutEffect(() => {
        Scheduler.unstable_advanceTime(effectDuration);
        if (shouldThrow) {
          throw Error('expected');
        }
        return () => {
          Scheduler.unstable_advanceTime(cleanupDuration);
        };
      });
      Scheduler.unstable_advanceTime(duration);
      return null;
    };

    Scheduler.unstable_advanceTime(1);

      // 触发 layout effect 执行期间的错误。

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <React.Profiler id="root" onCommit={callback}>
          <ErrorBoundary
            fallback={
              <ComponentWithEffects
                duration={10000000}
                effectDuration={100000000}
                cleanupDuration={1000000000}
              />
            }>
            <ComponentWithEffects
              duration={10}
              effectDuration={100}
              cleanupDuration={1000}
              shouldThrow={true}
            />
          </ErrorBoundary>
          <ComponentWithEffects
            duration={10000}
            effectDuration={100000}
            cleanupDuration={1000000}
          />
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(2);

    let call = callback.mock.calls[0];

    // 首次渲染在提交 effect 时发生错误。
    expect(call).toHaveLength(4);
    expect(call[0]).toBe('root');
    expect(call[1]).toBe('mount');
    expect(call[2]).toBe(100100); // 各阶段耗时（durations）
    expect(call[3]).toBe(10011); // 提交开始时间（mutation 与 effect 之前）

    call = callback.mock.calls[1];

    // 错误边界提交回退 UI，并清理失败子树。
    expect(call).toHaveLength(4);
    expect(call[0]).toBe('root');
    expect(call[1]).toBe('nested-update');
    expect(call[2]).toBe(100000000); // 各阶段耗时（durations）
    expect(call[3]).toBe(10110111); // 提交开始时间（mutation 与 effect 之前）
  });

  /**
   * 场景：“should properly report time in layout effect cleanup functions even when there are errors”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('should properly report time in layout effect cleanup functions even when there are errors', async () => {
    const callback = jest.fn();

    /** 作为“should properly report time in layout effect cleanup functions even when there are errors”场景的组件夹具，隔离待验证的 React 行为。 */
    class ErrorBoundary extends React.Component {
      /** 保存“should properly report time in layout effect cleanup functions even when there are errors”场景用于驱动更新或错误回退的组件状态。 */
      state = {error: null};
      /** 把渲染错误转换为“should properly report time in layout effect cleanup functions even when there are errors”场景的回退状态。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 渲染会在 layout effect cleanup 抛错的子树。 */
      render() {
        return this.state.error === null
          ? this.props.children
          : this.props.fallback;
      }
    }

    /** 用错误边界承接 layout effect cleanup 错误并提交回退 UI。 */
    const ComponentWithEffects = ({
      cleanupDuration,
      duration,
      effectDuration,
      shouldThrow = false,
    }) => {
      React.useLayoutEffect(() => {
        Scheduler.unstable_advanceTime(effectDuration);
        return () => {
          Scheduler.unstable_advanceTime(cleanupDuration);
          if (shouldThrow) {
            throw Error('expected');
          }
        };
      });
      Scheduler.unstable_advanceTime(duration);
      return null;
    };

    Scheduler.unstable_advanceTime(1);

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <React.Profiler id="root" onCommit={callback}>
          <ErrorBoundary
            fallback={
              <ComponentWithEffects
                duration={10000000}
                effectDuration={100000000}
                cleanupDuration={1000000000}
              />
            }>
            <ComponentWithEffects
              duration={10}
              effectDuration={100}
              cleanupDuration={1000}
              shouldThrow={true}
            />
          </ErrorBoundary>
          <ComponentWithEffects
            duration={10000}
            effectDuration={100000}
            cleanupDuration={1000000}
          />
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(1);

    let call = callback.mock.calls[0];

    // 首次渲染建立 effect 与 cleanup。
    expect(call).toHaveLength(4);
    expect(call[0]).toBe('root');
    expect(call[1]).toBe('mount');
    expect(call[2]).toBe(100100); // 各阶段耗时（durations）
    expect(call[3]).toBe(10011); // 提交开始时间（mutation 与 effect 之前）

    callback.mockClear();

      // 在 layout effect cleanup 中触发错误。

    await act(() => {
      root.render(
        <React.Profiler id="root" onCommit={callback}>
          <ErrorBoundary
            fallback={
              <ComponentWithEffects
                duration={10000000}
                effectDuration={100000000}
                cleanupDuration={1000000000}
              />
            }>
            <ComponentWithEffects
              duration={10}
              effectDuration={100}
              cleanupDuration={1000}
              shouldThrow={false}
            />
          </ErrorBoundary>
          <ComponentWithEffects
            duration={10000}
            effectDuration={100000}
            cleanupDuration={1000000}
          />
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(2);

    call = callback.mock.calls[0];

    // 更新触发会抛错的 cleanup。
    expect(call).toHaveLength(4);
    expect(call[0]).toBe('root');
    expect(call[1]).toBe('update');
    expect(call[2]).toBe(1101100); // 各阶段耗时（durations）
    expect(call[3]).toBe(120121); // 提交开始时间（mutation 与 effect 之前）

    call = callback.mock.calls[1];

    // 错误边界提交回退 UI，并完成失败子树清理。
    expect(call).toHaveLength(4);
    expect(call[0]).toBe('root');
    expect(call[1]).toBe('nested-update');
    expect(call[2]).toBe(100001000); // 各阶段耗时（durations）
    expect(call[3]).toBe(11221221); // 提交开始时间（mutation 与 effect 之前）
  });
});

describe(`onPostCommit`, () => {
  beforeEach(() => {
    jest.resetModules();

    loadModules();
  });

  /**
   * 场景：“should report time spent in passive effects”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('should report time spent in passive effects', async () => {
    const callback = jest.fn();

    /** 作为“should report time spent in passive effects”场景的函数夹具，返回待协调内容或触发目标行为。 */
    const ComponentWithEffects = () => {
      React.useLayoutEffect(() => {
        // 此 layout effect 用于证明 effect 耗时不会计入 render duration。
        Scheduler.unstable_advanceTime(5);
        return () => {
          Scheduler.unstable_advanceTime(7);
        };
      });
      React.useEffect(() => {
        Scheduler.unstable_advanceTime(10);
        return () => {
          Scheduler.unstable_advanceTime(100);
        };
      }, []);
      React.useEffect(() => {
        Scheduler.unstable_advanceTime(1000);
        return () => {
          Scheduler.unstable_advanceTime(10000);
        };
      });
      return null;
    };

    Scheduler.unstable_advanceTime(1);

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <React.Profiler id="mount-test" onPostCommit={callback}>
          <ComponentWithEffects />
        </React.Profiler>,
      );
    });
    await waitForAll([]);

    expect(callback).toHaveBeenCalledTimes(1);

    let call = callback.mock.calls[0];

    expect(call).toHaveLength(4);
    expect(call[0]).toBe('mount-test');
    expect(call[1]).toBe('mount');
    expect(call[2]).toBe(1010); // 各阶段耗时（durations）
    expect(call[3]).toBe(1); // 提交开始时间（mutation 与 effect 之前）

    Scheduler.unstable_advanceTime(1);

    await act(() => {
      root.render(
        <React.Profiler id="update-test" onPostCommit={callback}>
          <ComponentWithEffects />
        </React.Profiler>,
      );
    });
    await waitForAll([]);

    expect(callback).toHaveBeenCalledTimes(2);

    call = callback.mock.calls[1];

    expect(call).toHaveLength(4);
    expect(call[0]).toBe('update-test');
    expect(call[1]).toBe('update');
    expect(call[2]).toBe(11000); // 各阶段耗时（durations）
    expect(call[3]).toBe(1017); // 提交开始时间（mutation 与 effect 之前）

    Scheduler.unstable_advanceTime(1);

    await act(() => {
      root.render(<React.Profiler id="unmount-test" onPostCommit={callback} />);
    });
    await waitForAll([]);

    expect(callback).toHaveBeenCalledTimes(3);

    call = callback.mock.calls[2];

    expect(call).toHaveLength(4);
    expect(call[0]).toBe('unmount-test');
    expect(call[1]).toBe('update');
    expect(call[2]).toBe(10100); // 各阶段耗时（durations）
    expect(call[3]).toBe(12030); // 提交开始时间（mutation 与 effect 之前）
  });

  /**
   * 场景：“should report time spent in passive effects with cascading renders”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('should report time spent in passive effects with cascading renders', async () => {
    const callback = jest.fn();

    /** 作为“should report time spent in passive effects with cascading renders”场景的函数夹具，返回待协调内容或触发目标行为。 */
    const ComponentWithEffects = () => {
      const [didMount, setDidMount] = React.useState(false);
      Scheduler.unstable_advanceTime(1000);
      React.useEffect(() => {
        if (!didMount) {
          setDidMount(true);
        }
        Scheduler.unstable_advanceTime(didMount ? 30 : 10);
        return () => {
          Scheduler.unstable_advanceTime(100);
        };
      }, [didMount]);
      return null;
    };

    Scheduler.unstable_advanceTime(1);

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <React.Profiler id="mount-test" onPostCommit={callback}>
          <ComponentWithEffects />
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(2);

    let call = callback.mock.calls[0];

    expect(call).toHaveLength(4);
    expect(call[0]).toBe('mount-test');
    expect(call[1]).toBe('mount');
    expect(call[2]).toBe(10); // 各阶段耗时（durations）
    expect(call[3]).toBe(1001); // 提交开始时间（mutation 与 effect 之前）

    call = callback.mock.calls[1];

    expect(call).toHaveLength(4);
    expect(call[0]).toBe('mount-test');
    expect(call[1]).toBe('update');
    expect(call[2]).toBe(130); // 各阶段耗时（durations）
    expect(call[3]).toBe(2011); // 提交开始时间（mutation 与 effect 之前）
  });

  /**
   * 场景：“should bubble time spent in effects to higher profilers”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('should bubble time spent in effects to higher profilers', async () => {
    const callback = jest.fn();

    /** 作为“should bubble time spent in effects to higher profilers”场景的函数夹具，返回待协调内容或触发目标行为。 */
    const ComponentWithEffects = ({cleanupDuration, duration, setCountRef}) => {
      const setCount = React.useState(0)[1];
      if (setCountRef != null) {
        setCountRef.current = setCount;
      }
      React.useEffect(() => {
        Scheduler.unstable_advanceTime(duration);
        return () => {
          Scheduler.unstable_advanceTime(cleanupDuration);
        };
      });
      Scheduler.unstable_advanceTime(1);
      return null;
    };

    const setCountRef = React.createRef(null);

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <React.Profiler id="root-mount" onPostCommit={callback}>
          <React.Profiler id="a">
            <ComponentWithEffects
              duration={10}
              cleanupDuration={100}
              setCountRef={setCountRef}
            />
          </React.Profiler>
          <React.Profiler id="b">
            <ComponentWithEffects duration={1000} cleanupDuration={10000} />
          </React.Profiler>
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(1);

    let call = callback.mock.calls[0];

    expect(call).toHaveLength(4);
    expect(call[0]).toBe('root-mount');
    expect(call[1]).toBe('mount');
    expect(call[2]).toBe(1010); // 各阶段耗时（durations）
    expect(call[3]).toBe(2); // 提交开始时间（mutation 与 effect 之前）

    await act(() => setCountRef.current(count => count + 1));

    expect(callback).toHaveBeenCalledTimes(2);

    call = callback.mock.calls[1];

    expect(call).toHaveLength(4);
    expect(call[0]).toBe('root-mount');
    expect(call[1]).toBe('update');
    expect(call[2]).toBe(110); // 各阶段耗时（durations）
    expect(call[3]).toBe(1013); // 提交开始时间（mutation 与 effect 之前）

    await act(() => {
      root.render(
        <React.Profiler id="root-update" onPostCommit={callback}>
          <React.Profiler id="b">
            <ComponentWithEffects duration={1000} cleanupDuration={10000} />
          </React.Profiler>
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(3);

    call = callback.mock.calls[2];

    expect(call).toHaveLength(4);
    expect(call[0]).toBe('root-update');
    expect(call[1]).toBe('update');
    expect(call[2]).toBe(11100); // 各阶段耗时（durations）
    expect(call[3]).toBe(1124); // 提交开始时间（mutation 与 effect 之前）
  });

  /**
   * 场景：“should properly report time in passive effects even when there are errors”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('should properly report time in passive effects even when there are errors', async () => {
    const callback = jest.fn();

    /** 作为“should properly report time in passive effects even when there are errors”场景的组件夹具，隔离待验证的 React 行为。 */
    class ErrorBoundary extends React.Component {
      /** 保存“should properly report time in passive effects even when there are errors”场景用于驱动更新或错误回退的组件状态。 */
      state = {error: null};
      /** 把渲染错误转换为“should properly report time in passive effects even when there are errors”场景的回退状态。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 渲染“should properly report time in passive effects even when there are errors”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return this.state.error === null
          ? this.props.children
          : this.props.fallback;
      }
    }

    /** 作为“should properly report time in passive effects even when there are errors”场景的函数夹具，返回待协调内容或触发目标行为。 */
    const ComponentWithEffects = ({
      cleanupDuration,
      duration,
      effectDuration,
      shouldThrow,
    }) => {
      React.useEffect(() => {
        Scheduler.unstable_advanceTime(effectDuration);
        if (shouldThrow) {
          throw Error('expected');
        }
        return () => {
          Scheduler.unstable_advanceTime(cleanupDuration);
        };
      });
      Scheduler.unstable_advanceTime(duration);
      return null;
    };

    Scheduler.unstable_advanceTime(1);

      // 在 passive effect 执行期间触发错误。
    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <React.Profiler id="root" onPostCommit={callback}>
          <ErrorBoundary
            fallback={
              <ComponentWithEffects
                duration={10000000}
                effectDuration={100000000}
                cleanupDuration={1000000000}
              />
            }>
            <ComponentWithEffects
              duration={10}
              effectDuration={100}
              cleanupDuration={1000}
              shouldThrow={true}
            />
          </ErrorBoundary>
          <ComponentWithEffects
            duration={10000}
            effectDuration={100000}
            cleanupDuration={1000000}
          />
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(2);

    let call = callback.mock.calls[0];

    // 首次渲染在 flush passive effect 时发生错误。
    expect(call).toHaveLength(4);
    expect(call[0]).toBe('root');
    expect(call[1]).toBe('mount');
    expect(call[2]).toBe(100100); // 各阶段耗时（durations）
    expect(call[3]).toBe(10011); // 提交开始时间（mutation 与 effect 之前）

    call = callback.mock.calls[1];

    // 错误边界提交回退 UI，并清理失败子树。
    expect(call).toHaveLength(4);
    expect(call[0]).toBe('root');
    expect(call[1]).toBe('update');
    expect(call[2]).toBe(100000000); // 各阶段耗时（durations）
    expect(call[3]).toBe(10110111); // 提交开始时间（mutation 与 effect 之前）
  });

  /**
   * 场景：“should properly report time in passive effect cleanup functions even when there are errors”。
   * 机制：验证Profiler 的时长累计、提交回调与错误恢复契约，锁定可观察结果与失败边界。
   */
  it('should properly report time in passive effect cleanup functions even when there are errors', async () => {
    const callback = jest.fn();

    /** 作为“should properly report time in passive effect cleanup functions even when there are errors”场景的组件夹具，隔离待验证的 React 行为。 */
    class ErrorBoundary extends React.Component {
      /** 保存“should properly report time in passive effect cleanup functions even when there are errors”场景用于驱动更新或错误回退的组件状态。 */
      state = {error: null};
      /** 把渲染错误转换为“should properly report time in passive effect cleanup functions even when there are errors”场景的回退状态。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 渲染会在 passive effect cleanup 抛错的子树。 */
      render() {
        return this.state.error === null
          ? this.props.children
          : this.props.fallback;
      }
    }

    /** 用错误边界承接 passive effect cleanup 错误并提交回退 UI。 */
    const ComponentWithEffects = ({
      cleanupDuration,
      duration,
      effectDuration,
      shouldThrow = false,
      id,
    }) => {
      React.useEffect(() => {
        Scheduler.unstable_advanceTime(effectDuration);
        return () => {
          Scheduler.unstable_advanceTime(cleanupDuration);
          if (shouldThrow) {
            throw Error('expected');
          }
        };
      });
      Scheduler.unstable_advanceTime(duration);
      return null;
    };

    Scheduler.unstable_advanceTime(1);

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <React.Profiler id="root" onPostCommit={callback}>
          <ErrorBoundary
            fallback={
              <ComponentWithEffects
                duration={10000000}
                effectDuration={100000000}
                cleanupDuration={1000000000}
              />
            }>
            <ComponentWithEffects
              duration={10}
              effectDuration={100}
              cleanupDuration={1000}
              shouldThrow={true}
            />
          </ErrorBoundary>
          <ComponentWithEffects
            duration={10000}
            effectDuration={100000}
            cleanupDuration={1000000}
          />
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(1);

    let call = callback.mock.calls[0];

    // 首次渲染建立 passive effect 与 cleanup。
    expect(call).toHaveLength(4);
    expect(call[0]).toBe('root');
    expect(call[1]).toBe('mount');
    expect(call[2]).toBe(100100); // 各阶段耗时（durations）
    expect(call[3]).toBe(10011); // 提交开始时间（mutation 与 effect 之前）

    callback.mockClear();

      // 在 passive effect cleanup 中触发错误。

    await act(() => {
      root.render(
        <React.Profiler id="root" onPostCommit={callback}>
          <ErrorBoundary
            fallback={
              <ComponentWithEffects
                duration={10000000}
                effectDuration={100000000}
                cleanupDuration={1000000000}
              />
            }>
            <ComponentWithEffects
              duration={10}
              effectDuration={100}
              cleanupDuration={1000}
              shouldThrow={false}
            />
          </ErrorBoundary>
          <ComponentWithEffects
            duration={10000}
            effectDuration={100000}
            cleanupDuration={1000000}
          />
        </React.Profiler>,
      );
    });

    expect(callback).toHaveBeenCalledTimes(2);

    call = callback.mock.calls[0];

    // 更新触发会抛错的 passive cleanup。
    expect(call).toHaveLength(4);
    expect(call[0]).toBe('root');
    expect(call[1]).toBe('update');
    // 即使某个 effect 抛错，仍必须继续 flush 其余待处理 effect。
    expect(call[2]).toBe(1101100); // 各阶段耗时（durations）
    expect(call[3]).toBe(120121); // 提交开始时间（mutation 与 effect 之前）

    call = callback.mock.calls[1];

    // 错误边界提交回退 UI，并完成失败子树清理。
    expect(call).toHaveLength(4);
    expect(call[0]).toBe('root');
    expect(call[1]).toBe('update');
    expect(call[2]).toBe(100001000); // 各阶段耗时（durations）
    // 上方模拟 duration 会变化，因此对应 commit time 也随之变化。
    expect(call[3]).toBe(11221221); // 提交开始时间（mutation 与 effect 之前）
  });
});
