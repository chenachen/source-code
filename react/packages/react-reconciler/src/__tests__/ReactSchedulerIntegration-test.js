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
let ReactNoop;
let Scheduler;
let act;
let NormalPriority;
let IdlePriority;
let runWithPriority;
let startTransition;
let waitForAll;
let waitForPaint;
let assertLog;
let waitFor;

/** 覆盖 React 提交与 Scheduler 的 passive、paint、idle 优先级交互。 */
describe('ReactSchedulerIntegration', () => {
  /** 重置模块并绑定真实 mock Scheduler 的优先级、paint 与分片冲刷工具。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    NormalPriority = Scheduler.unstable_NormalPriority;
    IdlePriority = Scheduler.unstable_IdlePriority;
    runWithPriority = Scheduler.unstable_runWithPriority;
    startTransition = React.startTransition;

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    waitForPaint = InternalTestUtils.waitForPaint;
    assertLog = InternalTestUtils.assertLog;
    waitFor = InternalTestUtils.waitFor;
  });

  // 此组件源自 www 中的同类包装；
  // 待额外 div 包装不再需要时可删除。
  /** 用真实 div 包裹 LegacyHidden，将 hidden 模式映射为仅延后不隐藏的内部模式以复现 www 结构。 */
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

  /** Given–When–Then：Given layout/cleanup layout effect 都安排 NormalPriority 回调，同时新树产生被动 effect；When替换组件并由 act 耗尽任务；Then布局阶段结束后先执行 Passive Effect，再执行两个 Scheduler 回调。通过完整日志验证 React 在提交后安排被动任务的相对顺序。 */
  it('passive effects are called before Normal-pri scheduled in layout effects', async () => {
    const {useEffect, useLayoutEffect} = React;
    /** 布局阶段安排 NormalPriority 回调，同时注册被动日志，用于比较两类任务先后。 */
    function Effects({step}) {
      useLayoutEffect(() => {
        Scheduler.log('Layout Effect');
        Scheduler.unstable_scheduleCallback(NormalPriority, () =>
          Scheduler.log('Scheduled Normal Callback from Layout Effect'),
        );
      });
      useEffect(() => {
        Scheduler.log('Passive Effect');
      });
      return null;
    }
    /** 卸载布局清理时安排 NormalPriority 回调，覆盖 cleanup 产生调度工作的路径。 */
    function CleanupEffect() {
      useLayoutEffect(() => () => {
        Scheduler.log('Cleanup Layout Effect');
        Scheduler.unstable_scheduleCallback(NormalPriority, () =>
          Scheduler.log('Scheduled Normal Callback from Cleanup Layout Effect'),
        );
      });
      return null;
    }
    await act(() => {
      ReactNoop.render(<CleanupEffect />);
    });
    assertLog([]);
    await act(() => {
      ReactNoop.render(<Effects />);
    });
    assertLog([
      'Cleanup Layout Effect',
      'Layout Effect',
      'Passive Effect',
      // 这些 NormalPriority 回调必须排在被动 effect 之后。
      'Scheduled Normal Callback from Cleanup Layout Effect',
      'Scheduled Normal Callback from Layout Effect',
    ]);
  });

  /** Given–When–Then：Given A/B/C 已排在 React transition 任务前，D/E 在 React 开始后才插入；When 只冲刷到下一次 paint；Then React 提交 Update 后主动请求 paint，D/E 留到 paint 之后。通过分段 Scheduler 日志和根输出验证 requestPaint 集成。 */
  it('requests a paint after committing', async () => {
    const scheduleCallback = Scheduler.unstable_scheduleCallback;

    const root = ReactNoop.createRoot();
    root.render('Initial');
    await waitForAll([]);
    expect(root).toMatchRenderedOutput('Initial');

    scheduleCallback(NormalPriority, () => Scheduler.log('A'));
    scheduleCallback(NormalPriority, () => Scheduler.log('B'));
    scheduleCallback(NormalPriority, () => Scheduler.log('C'));

    // 安排 React render；提交完成后 React 会主动请求一次 paint。
    React.startTransition(() => {
      root.render('Update');
    });

    // 只推进少量工作；此时 React 任务已经排入队列，
    // 位于 A、B、C 之后。
    await waitFor(['A']);

    // 再追加 D、E；它们应等 React
    // 更新完成后才运行。
    scheduleCallback(NormalPriority, () => Scheduler.log('D'));
    scheduleCallback(NormalPriority, () => Scheduler.log('E'));

    // 冲刷至下一次 paint；React
    // 提交后应在此让出。
    await waitForPaint(['B', 'C']);
    expect(root).toMatchRenderedOutput('Update');

    // paint 之后再冲刷剩余 D、E。
    await waitForAll(['D', 'E']);
  });

  /** Given–When–Then：Given LegacyHidden 隐藏子树仍有待处理工作；When 在隐藏内容完成前插入 IdlePriority 的可见更新 B；Then可见 B 先提交，隐藏 B 后补齐。通过两次 paint 与最终隐藏 div 验证 offscreen 工作不会阻塞 idle 根更新。 */
  // @gate enableLegacyHidden
  it('idle updates are not blocked by offscreen work', async () => {
    /** 记录可见/隐藏标签并返回文本，连接 offscreen 调度与宿主输出。 */
    function Text({text}) {
      Scheduler.log(text);
      return text;
    }

    /** 同时渲染可见和 LegacyHidden 文本，用 label 更新观察两条调度路径。 */
    function App({label}) {
      return (
        <>
          <Text text={`Visible: ` + label} />
          <LegacyHiddenDiv mode="hidden">
            <Text text={`Hidden: ` + label} />
          </LegacyHiddenDiv>
        </>
      );
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<App label="A" />);

      // 先提交可见内容。
      await waitForPaint(['Visible: A']);
      expect(root).toMatchRenderedOutput(
        <>
          Visible: A
          <div hidden={true} />
        </>,
      );

      // 在隐藏内容获得渲染机会前安排
      // 一次 idle 更新。
      runWithPriority(IdlePriority, () => {
        root.render(<App label="B" />);
      });

      // 下一次提交应仍只包含可见内容。
      await waitForPaint(['Visible: B']);
      expect(root).toMatchRenderedOutput(
        <>
          Visible: B
          <div hidden={true} />
        </>,
      );
    });

    // 隐藏内容随后独立提交。
    assertLog(['Hidden: B']);
    expect(root).toMatchRenderedOutput(
      <>
        Visible: B<div hidden={true}>Hidden: B</div>
      </>,
    );
  });
});

/** 回归验证：任务过期后 React 必须忽略 shouldYield，避免在不完整树上无限让出。 */
describe(
  'regression test: does not infinite loop if `shouldYield` returns ' +
    'true after a partial tree expires',
  () => {
    /** 控制 shouldYield 包装是否写日志，避免准备阶段的内部探测污染断言。 */
    let logDuringShouldYield = false;

    /** 安装会记录 shouldYield 的 Scheduler 包装，并重置过期回归状态。 */
    beforeEach(() => {
      jest.resetModules();

      jest.mock('scheduler', () => {
        const actual = jest.requireActual('scheduler/unstable_mock');
        return {
          ...actual,
          /** 可选记录后委托真实 shouldYield，既保留调度语义又暴露调用时机。 */
          unstable_shouldYield() {
            if (logDuringShouldYield) {
              actual.log('shouldYield');
            }
            return actual.unstable_shouldYield();
          },
        };
      });

      React = require('react');
      ReactNoop = require('react-noop-renderer');
      Scheduler = require('scheduler');
      startTransition = React.startTransition;

      const InternalTestUtils = require('internal-test-utils');
      waitForAll = InternalTestUtils.waitForAll;
      waitForPaint = InternalTestUtils.waitForPaint;
      assertLog = InternalTestUtils.assertLog;
      waitFor = InternalTestUtils.waitFor;
      act = InternalTestUtils.act;
    });

    /** 恢复标准 scheduler/unstable_mock，避免自定义 shouldYield 泄漏到其他用例。 */
    afterEach(() => {
      jest.mock('scheduler', () =>
        jest.requireActual('scheduler/unstable_mock'),
      );
    });

  /** Given–When–Then：Given组件在渲染中推进时间并 requestPaint，复现过期任务上 shouldYield 曾返回 true 的真实条件；When公共 API 连续推进两个 paint；Then渲染能够完成而不在 work loop 与 Scheduler 间死循环。通过 act 正常返回验证修复。 */
    it('using public APIs to trigger real world scenario', async () => {
      // 此用例复现：React 的 Scheduler 任务已经超时，
      // 但 `shouldYield` 仍返回 true；旧缺陷会让 React
      // 进入 work loop 后立即把控制权交回 Scheduler，
      // 从而形成死循环。
      //
      // 下一用例覆盖相同条件；区别在于本用例只使用公共 API，
      // 下一用例则 mock `shouldYield`
      // 以精确观察调用时机。
      /** 透明返回文本；公共 API 回归只关心能否结束，不依赖内部日志。 */
      function Text({text}) {
        return text;
      }

      /** 在文本之间插入两次时间推进触发器，纯公共 API 复现历史 Scheduler 条件。 */
      function App({step}) {
        return (
          <>
            <Text text="A" />
            <TriggerErstwhileSchedulerBug />
            <Text text="B" />
            <TriggerErstwhileSchedulerBug />
            <Text text="C" />
          </>
        );
      }

      /** 推进虚拟时间并请求 paint，制造“任务已过期但 shouldYield 为 true”的旧版 Scheduler 状态。 */
      function TriggerErstwhileSchedulerBug() {
        // 推进时间并请求 paint 会触发 Scheduler 曾有的缺陷：
        // 当前任务虽已过期，`shouldYield` 仍返回 true。
        Scheduler.unstable_advanceTime(10000);
        Scheduler.unstable_requestPaint();
        return null;
      }

      await act(async () => {
        ReactNoop.render(<App />);
        await waitForPaint([]);
        await waitForPaint([]);
      });
    });

  /** Given–When–Then：Given并发树渲染到 A 后，mock shouldYield 开始记录且任务被推进到过期；When 再安排一次更新触发饥饿检查；Then React 直接完成 B/C，不再咨询 shouldYield。通过精确日志验证过期 render 的不可让出分支。 */
    it('mock Scheduler module to check if `shouldYield` is called', async () => {
      // 此用例复现 React Scheduler 任务超时后
      // `shouldYield` 仍返回 true 的缺陷。通常不应 mock 内部方法，
      // 但本用例专门验证 React 对 Scheduler API 异常行为的韧性，
      // 因此这里例外。
      // 若 API 将来变化，可重写或删除
      // 此实现相关测试。
      /** 记录分片文本，使测试能在 A 后暂停并检查过期后是否直接完成 B/C。 */
      function Text({text}) {
        Scheduler.log(text);
        return text;
      }

      /** 返回三段可分片文本，供 shouldYield mock 在 A 后中断。 */
      function App({step}) {
        return (
          <>
            <Text text="A" />
            <Text text="B" />
            <Text text="C" />
          </>
        );
      }

      await act(async () => {
        // 只渲染树的一部分，然后主动让出。
        startTransition(() => {
          ReactNoop.render(<App />);
        });
        await waitFor(['A']);

        // 从此刻起记录每次 shouldYield 调用。
        logDuringShouldYield = true;
        // 先调用一次，确认 mock 确实生效。
        await waitFor(['shouldYield']);

        // 推进时间，使当前任务过期。
        Scheduler.unstable_advanceTime(10000);
        // 再安排一次更新以触发过期/饥饿检查；
        // React 不会在已经开始处理某更新时重复检查它是否饥饿，
        // 因为它本来就在执行。
        // 只会在让回主线程前检查（避免被其他主线程工作饿死），
        // 或收到新更新时检查（避免被持续到来的更新饿死）。
        startTransition(() => {
          ReactNoop.render(<App />);
        });
        // render 已过期，React 应直接完成整棵树，
        // 不再咨询 `shouldYield`。
        await waitFor(['B', 'C']);
      });
    });
  },
);

/** 验证 act 使用专用队列耗尽策略，不信任 Scheduler.shouldYield 的测试替身。 */
describe('`act` bypasses Scheduler methods completely,', () => {
  /** shouldYield 调用计数上限；若 act 未绕过它，测试会确定性抛错而非永久挂起。 */
  let infiniteLoopGuard;

  /** 安装始终让出的 Scheduler 包装与死循环保护，构造 act 的对抗性环境。 */
  beforeEach(() => {
    jest.resetModules();

    infiniteLoopGuard = 0;

    jest.mock('scheduler', () => {
      const actual = jest.requireActual('scheduler/unstable_mock');
      return {
        ...actual,
        /** 始终返回 true；超过 100 次即抛错，把潜在 act 死循环转换为确定失败。 */
        unstable_shouldYield() {
          // 模拟测试环境中 `shouldYield` 永远返回 true 的缺陷报告。
          // act 会持续工作到队列为空，
          // 若仍遵从该返回值就会死循环。
          // 修复要求 act 内部完全绕过 `shouldYield`，
          // 因为测试替身的实现不一定可信。
          if (infiniteLoopGuard++ > 100) {
            throw new Error('Detected an infinite loop');
          }
          return true;
        },
      };
    });

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    startTransition = React.startTransition;
  });

  /** 恢复标准 scheduler/unstable_mock，避免自定义 shouldYield 泄漏到其他用例。 */
  afterEach(() => {
    jest.mock('scheduler', () => jest.requireActual('scheduler/unstable_mock'));
  });

  /** Given–When–Then：Given mock shouldYield 永远返回 true 且带死循环保护；When public act 内启动 transition 渲染 A/B/C；Then act 绕过 Scheduler.shouldYield 并完整提交。通过未触发保护错误与最终根输出验证测试环境专用工作循环。 */
  // @gate __DEV__
  it('inside `act`, does not call `shouldYield`, even during a concurrent render', async () => {
    /** 返回三个宿主兄弟，验证 act 即使面对永远让出也会完整提交。 */
    function App() {
      return (
        <>
          <div>A</div>
          <div>B</div>
          <div>C</div>
        </>
      );
    }

    const root = ReactNoop.createRoot();
    const publicAct = React.act;
    const prevIsReactActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
    try {
      global.IS_REACT_ACT_ENVIRONMENT = true;
      await publicAct(async () => {
        startTransition(() => root.render(<App />));
      });
    } finally {
      global.IS_REACT_ACT_ENVIRONMENT = prevIsReactActEnvironment;
    }
    expect(root).toMatchRenderedOutput(
      <>
        <div>A</div>
        <div>B</div>
        <div>C</div>
      </>,
    );
  });
});
