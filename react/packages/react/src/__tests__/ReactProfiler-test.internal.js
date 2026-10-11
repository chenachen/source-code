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

/** 在require React/调度器/noop renderer前设置三项Profiler开关，并取得act、日志等待器和计时夹具；模块隔离由调用方jest.resetModules完成。
 * @param options 三项开关默认true；其他额外字段不读取。
 * @returns 无返回值，写入本文件的模块与工具变量。 */
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

  /** 按props推进虚拟render时间的class夹具；SCU=false保留旧基准成本，children用于构建嵌套边界。 */
  AdvanceTime = class extends React.Component {
    /** 计时夹具默认每次render推进10ms，并允许SCU继续；单例测试可用props覆盖两项。 */
    static defaultProps = {
      byAmount: 10,
      shouldComponentUpdate: true,
    };
    /** 按下一组props直接决定是否跳过此计时组件，不比较children或其他字段。
     * @param nextProps 下一轮计时输入；shouldComponentUpdate=false跳过render。
     * @returns 调用方提供的SCU结果。 */
    shouldComponentUpdate(nextProps) {
      return nextProps.shouldComponentUpdate;
    }
    /** 在render阶段推进byAmount毫秒，再返回children或null；此夹具用可控虚拟成本验证actual/base，不使用真实耗时。
     * @returns 当前children；假值children折为null。 */
    render() {
      // 渲染组件时推进模拟时钟，让 Profiler 获得确定性耗时。
      Scheduler.unstable_advanceTime(this.props.byAmount);
      return this.props.children || null;
    }
  };
}

describe(`onRender`, () => {
  // 每例先resetModules，再开启三项Profiler开关并取新noop根工具，避免前例spy与模块状态串入。
  beforeEach(() => {
    jest.resetModules();
    loadModules();
  });

  /** 内层 Profiler 的 onRender 按 id 抛出 expected，外层回调与祖先 componentDidMount 仍执行；act 拒绝且回调共两次，验证提交错误不会跳过这两个后续任务。 */
  it('should handle errors thrown', async () => {
    const callback = jest.fn(id => {
      if (id === 'throw') {
        throw Error('expected');
      }
    });

    let didMount = false;
    /** 包住两层Profiler，借didMount标志确认内层onRender抛错后祖先布局生命周期仍执行。 */
    class ClassComponent extends React.Component {
      /** 提交布局阶段置didMount=true，供act拒绝后的断言观察。 */
      componentDidMount() {
        didMount = true;
      }
      /** 透传props.children建立祖先生命周期与Profiler回调的提交顺序。
       * @returns 两层Profiler子树。 */
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

  /** transition 挂载 first、last 两个日志组件；只推进到 first 时回调零次，完成 last 并提交后一次，区分可中断 render 与提交回调。 */
  it('is not invoked until the commit phase', async () => {
    const callback = jest.fn();

    /** 记录value并返回null；waitFor用首个日志作为暂停点，不推进模拟时钟。
     * @param props value为本轮调度日志。
     * @returns null，不产生宿主节点。 */
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

    // 只完成第一个子节点时尚未提交，onRender 不调用；整棵树完成并提交后才回调一次。
    await waitFor(['first']);
    expect(callback).toHaveBeenCalledTimes(0);
    await waitForAll(['last']);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  // @gate !__DEV__
  /** 生产配置下替换 Scheduler.unstable_now 为记录器，清空初始化日志后挂载五个未包在 Profiler 内的计时组件；performance track 开时仍读取16次，关时11次，断言具体读钟日志而非所有计时调用为零。 */
  it('does not record times for components outside of Profiler tree', async () => {
    // mock Scheduler，以记录 React 读取当前时间的次数。
    jest.mock('scheduler', obj => {
      const ActualScheduler = jest.requireActual('scheduler/unstable_mock');
      return {
        ...ActualScheduler,
        /** 记录 React 读取当前时间的次数，再转发到真实 mock Scheduler 时钟。 */
        unstable_now:
          /** 记录一次读钟日志，再返回Scheduler mock的当前时间；不主动推进时间。
           * @returns mock时钟毫秒。 */
          function mockUnstableNow() {
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

  /** Profiler 内 memo 子组件首次耗时10ms且比较器始终跳过后续 render；重新渲染 App 时按测试 gate 分别断言无回调或 actual=0/base=10，随后仅更新外部兄弟的 Hook 状态始终无回调，验证边界外工作不归入此 Profiler。 */
  it('does not report work done on a sibling', async () => {
    const callback = jest.fn();

    const DoesNotUpdate = React.memo(
      /** 首次render耗10ms并返回null；外部恒真memo比较器令后续父更新复用这份基准。
       * @returns null。 */
      function DoesNotUpdateInner() {
        Scheduler.unstable_advanceTime(10);
        return null;
      },
      () => true,
    );

    let updateProfilerSibling;

    /** 将count+1的更新闭包暴露到外部变量；自身位于Profiler外，用它隔离兄弟状态更新的计时归属。
     * @returns null。 */
    function ProfilerSibling() {
      const [count, setCount] = React.useState(0);
      /** 用本轮闭包的count排兄弟状态更新，作为仅影响Profiler外分支的触发入口。 */
      updateProfilerSibling = () => setCount(count + 1);
      return null;
    }

    /** 并排放置含恒定memo比较器的Profiler子树和可更新的兄弟；重建App元素与仅更新兄弟形成两个触发路径。
     * @returns 这两个兄弟元素。 */
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
      // 此gate分支断言本轮无回调；内层memo跳过render。该flag在当前实现无定义，不能由此推断App先bailout。
      expect(callback).not.toHaveBeenCalled();
    } else {
      // 未启用该特性时，本轮仍进入 Profiler 的提交路径；actualDuration 为 0，baseDuration 保留 10ms。
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

  /** 时钟从5开始，挂载耗时10ms，空闲20ms后更新仍10ms，再空闲20ms后更新4ms；逐次核对 mount/update、actual/base 和5→15、35→45、65→69的起止时间。 */
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

  /** 外层组件耗时10ms，内层20ms，从5开始挂载；内层先回调且计20，外层计30，两者共享commitTime=35，验证嵌套 render 时间向父边界累加。 */
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

  /** 两个兄弟 Profiler 分别耗时20和5ms，从5开始挂载；各自 actual/base 为20、5，startTime 为5、25，共享commitTime=30，验证兄弟计时互不相加。 */
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

    // 两个 Profiler 互为兄弟，分别记录各自的 20ms/5ms 工作；它们共享同一次提交时刻。
    expect(firstCall[2]).toBe(20); // 实际渲染耗时（actual time）
    expect(firstCall[3]).toBe(20); // 基准渲染耗时（base time）
    expect(firstCall[4]).toBe(5); // 渲染开始时间（start time）
    expect(firstCall[5]).toBe(30); // 提交时间（commit time）
    expect(secondCall[2]).toBe(5); // 实际渲染耗时（actual time）
    expect(secondCall[3]).toBe(5); // 基准渲染耗时（base time）
    expect(secondCall[4]).toBe(25); // 渲染开始时间（start time）
    expect(secondCall[5]).toBe(30); // 提交时间（commit time）
  });

  /** Profiler 前后各有20ms组件，内部仅5ms；从5开始挂载，回调 actual/base=5、start=25、commit=50，边界外工作影响全局时间但不计入内部 duration。 */
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

  /** Updater 初次返回固定 props.children，随后仅更新自身 state；外层回调次数从挂载后一次变成两次，内层仍一次。此夹具未实现 shouldComponentUpdate，实际验证相同 children 元素复用时内层没有新增回调。 */
  it('is not called when blocked by sCU false', async () => {
    const callback = jest.fn();

    let instance;
    /** 接收固定children元素，暴露实例以仅改state；render透传同一children，从而观测内层Profiler是否重新报告。此类没有SCU。 */
    class Updater extends React.Component {
      /** 空初始state，后续count更新仅用来触发Updater自身render。 */
      state = {};
      /** 捕获本实例并返回相同props.children，避免为内层树创建新元素。
       * @returns 从父层接收的原children引用。 */
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

  /** 挂载父10ms、子13ms，随后父更新为4ms且子 SCU=false；更新 actual=4，base=17仍含子的旧13ms，核对 start=58、commit=62，区分跳过 render 与保留基准成本。 */
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

  /** 静态派生状态耗3ms、SCU耗7ms、render耗5ms；挂载不走SCU而计8ms，更新计15ms，断言两个阶段的 actual/base 与起止时间。 */
  it('includes time spent in render phase lifecycles', async () => {
    /** 以派生状态、SCU、render的3/7/5ms分开验证render阶段生命周期计入Profiler；挂载不执行SCU。 */
    class WithLifecycles extends React.Component {
      /** 空状态使静态派生状态方法可以正常参与挂载和更新。 */
      state = {};
      /** 每次调用推进3ms而返回null，不修改state；只贡献派生生命周期成本。
       * @returns null，保留状态。 */
      static getDerivedStateFromProps() {
        Scheduler.unstable_advanceTime(3);
        return null;
      }
      /** 推进7ms并允许更新，确保本轮render继续耗5ms。
       * @returns true。 */
      shouldComponentUpdate() {
        Scheduler.unstable_advanceTime(7);
        return true;
      }
      /** 推进5ms并返回null，构成最终render成本。
       * @returns null。 */
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

  /** 初次 layout effect 将 didMount 置真，后续 passive effect 再更新另一标志；日志 false:false、true:false、true:true 对应 mount、nested-update、update，验证布局级联标记不延续到被动更新。 */
  it('should clear nested-update flag when multiple cascading renders are scheduled', async () => {
    jest.resetModules();
    loadModules();

    /** 通过layout首次setDidMount与passive后续setDidMountAndUpdate制造两种级联；每轮记录两个状态，供phase与日志一一对应。
     * @returns null；只产生Hook和调度日志。 */
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

  /** 先排 transition 挂载，再 flushSync 同一 Profiler 树；layout effect 立即更新状态，日志 false、true 对应 mount 和 nested-update，共两次回调，剩余低优先级工作不改变本次同步级联分类。 */
  it('is properly distinguish updates and nested-updates when there is more than sync remaining work', () => {
    jest.resetModules();
    loadModules();

    /** 首次layout置didMount=true并记录每轮布尔状态；同步挂载和紧接的布局级联对应两次Profiler phase。
     * @returns didMount布尔值。 */
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
    /** transition 下两个 Yield 分别耗2、3ms；暂停在第一个日志时无回调，恢复并提交后 actual/base=5、start=5、commit=10，验证一次渲染的分段工作累加。 */
    it('should accumulate actual time after a scheduling interruptions', async () => {
      const callback = jest.fn();

      /** 推进renderTime并记录Yield日志；分段等待后累计2+3ms成本。
       * @param props renderTime为虚拟毫秒，也作为Yield日志的数值。
       * @returns null。 */
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

    /** 外层5、10ms与内层17ms分段渲染，在首段后额外推进50ms空闲；提交时内层17ms、外层32ms，commit=87，空闲只改变时间戳而不进入 duration。 */
    it('should not include time between frames', async () => {
      const callback = jest.fn();

      /** 推进renderTime再记录Yield日志，配合外部空闲推进验证等待时间不计入actual/base。
       * @param props renderTime为render成本和分段日志数值。
       * @returns null。 */
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

    // 完成剩余10ms外层与17ms内层工作，总钟从60推进到87。
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

    /** 低优先级挂载在10ms首段后暂停，空闲100ms，再以同步5ms新树替换；唯一 mount 回调 actual/base=5、start=115、commit=120，废弃的旧10ms不进入最终树成本。 */
    it('should report the expected times when a high-pri update replaces a mount in-progress', async () => {
      const callback = jest.fn();

      /** 推进renderTime并记录Yield日志，用高优先级新树替换尚未完成的低优先级挂载。
       * @param props renderTime为虚拟成本和日志数值。
       * @returns null。 */
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

    /** 初始6+15ms挂载后，低优先级3、5、9ms更新分两次暂停并各空闲100ms；同步11ms树替换后仅新增一次 update，actual/base=11、start=264、commit=275，余下旧工作不再回调。 */
    it('should report the expected times when a high-priority update replaces a low-priority update', async () => {
      const callback = jest.fn();

      /** 推进renderTime并记Yield日志，区分废弃的3/5ms低优先级片段与最终11ms替代树。
       * @param props renderTime为虚拟render成本。
       * @returns null。 */
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

      // 首次完整渲染消耗 21ms，actual 与 base time 均以此为基线。
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

    /** 两分支初始成本5与9ms，低优先级把第一分支改为14ms并暂停；同步第二分支改为37ms，先报actual=37/base=42，之后续跑第一分支报actual=14/base=51，验证恢复工作与已提交兄弟的基准成本合并。 */
    it('should report the expected times when a high-priority update interrupts a low-priority update', async () => {
      const callback = jest.fn();

      /** 推进renderTime并记Yield日志，分别给两个独立state分支增加4/7ms叶子成本。
       * @param props renderTime为叶子虚拟render成本。
       * @returns null。 */
      const Yield = ({renderTime}) => {
        Scheduler.unstable_advanceTime(renderTime);
        Scheduler.log('Yield:' + renderTime);
        return null;
      };

      let first;
      /** 第一分支保留可单独更新的renderTime；低优先级更新后可被另一分支同步更新中断，再恢复。 */
      class FirstComponent extends React.Component {
        /** 初次render成本1ms；测试后续将其改为10ms。 */
        state = {renderTime: 1};
        /** 捕获first实例，按state.renderTime推进并记日志，再返回固定4ms叶子；恢复后基准替换成最新10+4。
         * @returns 4ms的Yield叶子。 */
        render() {
          first = this;
          Scheduler.unstable_advanceTime(this.state.renderTime);
          Scheduler.log('FirstComponent:' + this.state.renderTime);
          return <Yield renderTime={4} />;
        }
      }
      let second;
      /** 第二分支有独立renderTime与setState入口；同步更新将成本从2改30ms，用来中断第一分支。 */
      class SecondComponent extends React.Component {
        /** 初次render成本2ms，与固定7ms叶子共同形成9ms基准。 */
        state = {renderTime: 2};
        /** 捕获second实例，按state.renderTime推进并记日志，再返回7ms叶子；同步setState后成本为30+7。
         * @returns 7ms的Yield叶子。 */
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
    // 不重复累加最初被打断的10ms；base为第一分支14+已提交第二分支37=51ms。
    // TODO：Scheduler 支持真正续跑后，actual time 应再减少 10ms。
      await waitForAll(['FirstComponent:10', 'Yield:4']);
      expect(callback).toHaveBeenCalledTimes(1);
      call = callback.mock.calls[0];
      expect(call[2]).toBe(14); // 实际渲染耗时（actual time）
      expect(call[3]).toBe(51); // 基准渲染耗时（base time）
      expect(call[4]).toBe(366); // 渲染开始时间（start time）
      expect(call[5]).toBe(380); // 提交时间（commit time）
    });

    /** 子树9ms后在3ms组件中抛错，边界render耗2ms并在didCatch中setState；mount回调actual=14/base=2、start=19/commit=33，随后22ms回退以nested-update提交到55，区分失败尝试与提交级联。 */
    it('should accumulate actual time after an error handled by componentDidCatch()', async () => {
      const callback = jest.fn();

      /** 推进3ms后抛expected，给didCatch恢复路径提供确定的失败render成本。
       * @throws expected错误；不返回UI。 */
      const ThrowsError = ({unused}) => {
        Scheduler.unstable_advanceTime(3);
        throw Error('expected error');
      };

      /** 失败render先提交didCatch，再用setState触发22ms回退的布局级联；用于区分mount与nested-update成本。 */
      class ErrorBoundary extends React.Component {
        /** error初值null保留正常children，didCatch写入错误后选择回退。 */
        state = {error: null};
        /** 把提交阶段收到的错误存入state，触发回退的下一次提交。
         * @param error 捕获的expected错误。 */
        componentDidCatch(error) {
          this.setState({error});
        }
        /** 自身每次耗2ms；无错返回原children，有错返回20ms计时组件。
         * @returns 正常子树或可量化成本的回退。 */
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

    // 此处是同一Profiler的提交回调，按本例实际提交顺序读取。
      const [mountCall, updateCall] = callback.mock.calls;

    // 首次提交树只包含耗时 2ms 的 ErrorBoundary，但 actual time 还包括失败子树的渲染工作。
      expect(mountCall[1]).toBe('mount');
    // actual time = 2（ErrorBoundary）+ 9（AdvanceTime）+ 3（ThrowsError）；失败单元的重放耗时不重复计算。
      expect(mountCall[2]).toBe(14);
    // 初次提交的子树为空，因此 base time 只包含 ErrorBoundary 的 2ms。
      expect(mountCall[3]).toBe(2);

    // 本例mount回调记录重试起点19ms，即初始5+此前14ms尝试。
      expect(mountCall[4]).toBe(19);
    // mount提交时间为重试起点19+本轮14=33ms。
      expect(mountCall[5]).toBe(33);

    // 后续更新提交 ErrorBoundary 与其回退子节点。
      expect(updateCall[1]).toBe('nested-update');
    // actual time 包含 ErrorBoundary 的 2ms 与回退内容的 20ms。
      expect(updateCall[2]).toBe(22);
    // base time 同样记录最终树中 ErrorBoundary 2ms 与回退内容 20ms。
      expect(updateCall[3]).toBe(22);
    // 断言本次回退更新的开始时间。
      expect(updateCall[4]).toBe(33);
    // 回退从33开始，边界2+回退20ms后提交到55。
      expect(updateCall[5]).toBe(55);
    });

    /** 子树5ms后在10ms组件中抛错，边界派生错误状态并改渲染20ms回退；一次mount回调actual=39/base=22、start=44/commit=83，实际成本含失败子树而最终基准只含边界2ms与回退20ms。 */
    it('should accumulate actual time after an error handled by getDerivedStateFromError()', async () => {
      const callback = jest.fn();

      /** 推进10ms后抛expected，为派生错误状态恢复提供失败子树成本。
       * @throws expected错误。 */
      const ThrowsError = ({unused}) => {
        Scheduler.unstable_advanceTime(10);
        throw Error('expected error');
      };

      /** 用静态派生错误状态在render路径选择20ms回退，不依赖didCatch再排提交更新。 */
      class ErrorBoundary extends React.Component {
        /** error初值null，派生错误状态将它置为捕获的异常。 */
        state = {error: null};
        /** 返回error补丁使下一次render选择回退。
         * @param error render子树抛出的错误。
         * @returns 合并进state的error字段。 */
        static getDerivedStateFromError(error) {
          return {error};
        }
        /** 自身推进2ms，再按error选择原children或20ms回退；最终base成本为2+20。
         * @returns 正常子树或计时回退。 */
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

    // 此处是同一Profiler的提交回调，按本例实际提交顺序读取。
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

    /** 连续两次渲染会令noop宿主在complete阶段抛错的树，均等待到错误；第三次有效span渲染可以完成且无日志，验证错误后栈可恢复。loadModules的useNoopRenderer额外字段未被读取，本文件一直使用noop。 */
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

  /** 同一Profiler先以one挂载2ms子树，再以two更新1ms子树；回调分别使用最新id、mount/update和2/1ms成本，验证id无需卸载重建即可更新。 */
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

  /** ClassComponent render耗2ms、didMount耗5ms并置标志；onRender中已能观察didMount=true，但commitTime仍为布局任务前捕获的2，验证回调可见提交结果与时间戳含义。 */
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

    /** render耗2ms、didMount耗5ms并置标志，用于对比提交开始时间和回调观察到的布局结果。 */
    class ClassComponent extends React.Component {
      /** 推进5ms后置classComponentMounted=true，onRender回调需已看到此结果。 */
      componentDidMount() {
        Scheduler.unstable_advanceTime(5);
        classComponentMounted = true;
      }
      /** 推进2ms并返回null；commitTime在后续didMount耗时之前捕获。
       * @returns null。 */
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
  // 每例先resetModules，再开启三项Profiler开关并取新noop根工具，避免前例spy与模块状态串入。
  beforeEach(() => {
    jest.resetModules();

    loadModules();
  });

  /** 挂载两个layout setup与class didMount共101010ms，更新每轮layout cleanup/setup与didUpdate共1011000ms，移除子树cleanup共10100ms；逐次核对onCommit，passive的5/7ms只推进全局钟而不进入这些duration。 */
  it('should report time spent in layout effects and commit lifecycles', async () => {
    const callback = jest.fn();

    /** 安装10ms的一次性layout和1000ms每轮layout，以及5ms每轮passive；对应cleanup分别100、10000、7ms，供onCommit排除passive成本。
     * @returns null。 */
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

    /** 通过didMount/didUpdate的100000/1000000ms验证class布局生命周期进入onCommit，render无额外成本。 */
    class ComponentWithCommitHooks extends React.Component {
      /** 首次提交推进100000ms，作为挂载布局成本。 */
      componentDidMount() {
        Scheduler.unstable_advanceTime(100000);
      }
      /** 每次更新推进1000000ms，供更新onCommit累加。 */
      componentDidUpdate() {
        Scheduler.unstable_advanceTime(1000000);
      }
      /** 返回null，只让提交生命周期贡献此夹具的虚拟成本。
       * @returns null。 */
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

  /** 函数layout先触发一次Hook级联，随后一次根更新令class didUpdate再触发级联；四次onCommit按mount/nested-update/update/nested-update报告1010、130、10130、10000ms，巨大的render耗时只影响commit起点。 */
  it('should report time spent in layout effects and commit lifecycles with cascading renders', async () => {
    const callback = jest.fn();

    /** 每次render耗100000000ms；layout按didCascade耗10或30ms并返回100ms cleanup，首次shouldCascade可触发一次Hook更新。
     * @param props shouldCascade决定layout是否排一次setState。
     * @returns null。 */
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

    /** 每轮render耗1000000000ms；didMount耗1000ms、didUpdate耗10000ms且可级联一次setState，隔离render与提交成本。 */
    class ComponentWithCommitHooks extends React.Component {
      /** didCascade初值false，阻止didUpdate在shouldCascade=true时重复排更新。 */
      state = {
        didCascade: false,
      };
      /** 推进1000ms，不触发class级联更新。 */
      componentDidMount() {
        Scheduler.unstable_advanceTime(1000);
      }
      /** 推进10000ms；仅当shouldCascade且尚未级联时置didCascade=true，形成一次nested-update。 */
      componentDidUpdate() {
        Scheduler.unstable_advanceTime(10000);
        if (this.props.shouldCascade && !this.state.didCascade) {
          this.setState({didCascade: true});
        }
      }
      /** 每次render推进1000000000ms并返回null；这项成本仅推进提交起点，layout duration由生命周期单独贡献。
       * @returns null。 */
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

  /** 函数render耗1000ms，class ref挂载耗10ms、置空耗100ms；Profiler挂载回调duration=10，移除class但保留Profiler时phase=update且duration=100，验证ref任务归入提交计时。 */
  it('should include time spent in ref callbacks', async () => {
    const callback = jest.fn();

    /** 非空class实例传入时推进10ms，解绑时null推进100ms；用于测ref附加/清理的提交成本。
     * @param ref 当前class实例或解绑标记null。 */
    const refSetter = ref => {
      if (ref !== null) {
        Scheduler.unstable_advanceTime(10);
      } else {
        Scheduler.unstable_advanceTime(100);
      }
    };

    /** 无UI的class ref目标，让ref回调收到实例而非宿主节点。 */
    class ClassComponent extends React.Component {
      /** 返回null，class本身不贡献render时间。
       * @returns null。 */
      render() {
        return null;
      }
    }

    /** render推进1000ms后返回带refSetter的class；render成本影响commitTime，ref成本才进入onCommit duration。
     * @returns class ref目标。 */
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

  /** a/b内层无回调，layout setup分别10/1000ms、cleanup为100/10000；外层先计1010，单独更新a计110，最后重排为一个未带key的b槽位计11100，验证更新和删除的布局成本向外层汇总。 */
  it('should bubble time spent in layout effects to higher profilers', async () => {
    const callback = jest.fn();

    /** 将Hook setter存入可选ref，render耗1ms，layout每轮setup/cleanup按props推进时间；支持只更新其中一分支及删除兄弟。
     * @param props duration为setup毫秒、cleanupDuration为清理毫秒，setCountRef用于暴露更新入口。
     * @returns null。 */
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

  /** 首个layout setup耗100ms后抛错，其兄弟仍耗100000ms；外层mount计100100，错误边界级联回退setup计100000000且phase=nested-update，抛错setup没有返回cleanup。 */
  it('should properly report time in layout effects even when there are errors', async () => {
    const callback = jest.fn();

    /** 捕获layout setup错误后保存error，并用props.fallback替换正常children；计时断言观察回退提交。 */
    class ErrorBoundary extends React.Component {
      /** error初值null选择正常子树，派生错误状态改变后选择回退。 */
      state = {error: null};
      /** 把layout setup捕获的错误转换为状态补丁。
       * @param error 捕获的expected异常。
       * @returns error字段补丁。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 按error是否为null返回children或fallback；自身不推进模拟时钟。
       * @returns 正常子树或调用方指定的回退组件。 */
      render() {
        return this.state.error === null
          ? this.props.children
          : this.props.fallback;
      }
    }

    /** render推进duration，layout setup推进effectDuration后可抛错；仅成功setup返回推进cleanupDuration的清理。
     * @param props 三项毫秒成本与shouldThrow错误开关。
     * @returns null；layout错误在提交后发生。 */
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

  /** 先挂载成功setup，旧cleanup保留shouldThrow=true；更新时该旧cleanup耗1000ms并抛错，兄弟cleanup/setup仍运行，首回调计1101100；边界回退又清理更新后的1000ms并安装100000000ms effect，nested-update计100001000。 */
  it('should properly report time in layout effect cleanup functions even when there are errors', async () => {
    const callback = jest.fn();

    /** 捕获layout cleanup错误后保存error，并用props.fallback替换正常children；计时断言观察回退提交。 */
    class ErrorBoundary extends React.Component {
      /** error初值null选择正常子树，派生错误状态改变后选择回退。 */
      state = {error: null};
      /** 把layout cleanup捕获的错误转换为状态补丁。
       * @param error 捕获的expected异常。
       * @returns error字段补丁。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 按error是否为null透传children或选择fallback，自身不计时；错误来自子组件旧layout cleanup。
       * @returns 正常子树或回退。 */
      render() {
        return this.state.error === null
          ? this.props.children
          : this.props.fallback;
      }
    }

    /** render推进duration，layout setup推进effectDuration并返回cleanup；cleanup推进cleanupDuration后按创建时shouldThrow决定抛错。
     * @param props 三项毫秒成本，shouldThrow默认false并由旧cleanup闭包保留。
     * @returns null。 */
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
  // 每例先resetModules，再开启三项Profiler开关并取新noop根工具，避免前例spy与模块状态串入。
  beforeEach(() => {
    jest.resetModules();

    loadModules();
  });

  /** 两个passive setup分别10/1000ms，首个仅挂载、另一个每轮执行；onPostCommit挂载计1010，更新计10000+1000，移除子树计100+10000，layout的5/7ms不进入passive duration但影响后续commitTime。 */
  it('should report time spent in passive effects', async () => {
    const callback = jest.fn();

    /** 安装两个passive effect：10ms仅挂载、1000ms每轮；cleanup为100和10000ms，同时安装5/7ms layout作为被动计时的排除项。
     * @returns null。 */
    const ComponentWithEffects = () => {
      React.useLayoutEffect(() => {
        // 这组5/7ms布局成本是passive计时的排除项；本例未注册onRender回调。
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

  /** 组件render每次耗1000ms，首次passive setup耗10ms并setState，下一轮cleanup100+setup30；onPostCommit两次分别mount/10与update/130，commit起点1001和2011，passive级联不标成nested-update。 */
  it('should report time spent in passive effects with cascading renders', async () => {
    const callback = jest.fn();

    /** render耗1000ms；首次passive耗10ms并置didMount，后续清理100ms、setup30ms，制造一次被动级联。
     * @returns null。 */
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

  /** 内层a/b的passive setup为10/1000、cleanup为100/10000；外层初次1010，单独更新a计110，缩成一个无key子槽位后计11100，验证被动更新与删除清理向祖先汇总。 */
  it('should bubble time spent in effects to higher profilers', async () => {
    const callback = jest.fn();

    /** 暴露可选Hook setter，render耗1ms，passive每轮按duration与cleanupDuration推进时钟，用于向外层汇总更新与删除成本。
     * @param props setup/cleanup虚拟毫秒与可选setCountRef。
     * @returns null。 */
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

  /** passive setup先耗100ms抛错，兄弟仍耗100000ms；onPostCommit先以mount报告100100，边界回退随后以update报告100000000，不把被动阶段触发的更新标成nested-update。 */
  it('should properly report time in passive effects even when there are errors', async () => {
    const callback = jest.fn();

    /** 捕获passive setup错误后保存error，并用props.fallback替换正常children；计时断言观察回退提交。 */
    class ErrorBoundary extends React.Component {
      /** error初值null选择正常子树，派生错误状态改变后选择回退。 */
      state = {error: null};
      /** 把passive setup捕获的错误转换为状态补丁。
       * @param error 捕获的expected异常。
       * @returns error字段补丁。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 按error是否为null返回children或fallback；自身不推进模拟时钟。
       * @returns 正常子树或调用方指定的回退组件。 */
      render() {
        return this.state.error === null
          ? this.props.children
          : this.props.fallback;
      }
    }

    /** render推进duration，passive setup推进effectDuration后可抛错；抛错路径没有返回cleanup，成功路径返回cleanupDuration计时清理。
     * @param props render/setup/cleanup三项毫秒成本和shouldThrow开关。
     * @returns null。 */
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

  /** 先建立含shouldThrow=true闭包的passive cleanup，再以false新props更新；旧cleanup耗1000ms后抛错，余下任务仍执行而首回调计1101100，回退提交清理新effect并安装回退计100001000，两次phase都为update。 */
  it('should properly report time in passive effect cleanup functions even when there are errors', async () => {
    const callback = jest.fn();

    /** 捕获passive cleanup错误后保存error，并用props.fallback替换正常children；计时断言观察回退提交。 */
    class ErrorBoundary extends React.Component {
      /** error初值null选择正常子树，派生错误状态改变后选择回退。 */
      state = {error: null};
      /** 把passive cleanup捕获的错误转换为状态补丁。
       * @param error 捕获的expected异常。
       * @returns error字段补丁。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 无错透传children，有错改为fallback；被动cleanup错误由后续阶段传入派生状态。
       * @returns 正常子树或回退。 */
      render() {
        return this.state.error === null
          ? this.props.children
          : this.props.fallback;
      }
    }

    /** render推进duration，passive setup推进effectDuration并返回cleanup；cleanup按旧shouldThrow闭包决定是否在计时后抛错。
     * @param props 三项毫秒成本和shouldThrow开关；解构的id未读取。
     * @returns null。 */
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
