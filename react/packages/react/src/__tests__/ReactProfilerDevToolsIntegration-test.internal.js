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

describe('ReactProfiler DevTools integration', () => {
  let React;
  let ReactFeatureFlags;
  let ReactTestRenderer;
  let Scheduler;
  let AdvanceTime;
  let hook;
  let waitForAll;
  let waitFor;
  let act;

  beforeEach(() => {
    global.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook = {
      /** 接受 renderer 注入；此夹具无需返回 renderer 标识。 */
      inject: () => {},
      onCommitFiberRoot: jest.fn((rendererId, root) => {}),
      /** 接受 Fiber 卸载通知，保持 DevTools hook 协议完整。 */
      onCommitFiberUnmount: () => {},
      supportsFiber: true,
    };

    jest.resetModules();

    ReactFeatureFlags = require('shared/ReactFeatureFlags');
    ReactFeatureFlags.enableProfilerTimer = true;
    Scheduler = require('scheduler');
    React = require('react');
    ReactTestRenderer = require('react-test-renderer');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    waitFor = InternalTestUtils.waitFor;
    act = InternalTestUtils.act;

    AdvanceTime = class extends React.Component {
      /** 提供“ReactProfiler DevTools integration”场景验证默认属性解析所需的默认值。 */
      static defaultProps = {
        byAmount: 10,
        shouldComponentUpdate: true,
      };
      /** 决定“ReactProfiler DevTools integration”场景是否继续协调，并让测试验证跳过更新的边界。 */
      shouldComponentUpdate(nextProps) {
        return nextProps.shouldComponentUpdate;
      }
      /** 渲染“ReactProfiler DevTools integration”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
    // 渲染时推进模拟时钟，使 Profiler 能观测确定性的耗时。
        Scheduler.unstable_advanceTime(this.props.byAmount);
        return this.props.children || null;
      }
    };
  });

  /**
   * Given：已建立该文件所需的 renderer、容器与测试夹具。
   * When：执行“should auto-Profile all fibers if the DevTools hook is detected”场景的唯一关键操作。
   * Then：断言 Profiler 与 DevTools 计时数据的集成契约 的可观察结果。
   *
   * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
   */
  it('should auto-Profile all fibers if the DevTools hook is detected', async () => {
    /** 作为“should auto-Profile all fibers if the DevTools hook is detected”场景的函数夹具，返回待协调内容或触发目标行为。 */
    const App = ({multiplier}) => {
      Scheduler.unstable_advanceTime(2);
      return (
        <React.Profiler id="Profiler" onRender={onRender}>
          <AdvanceTime byAmount={3 * multiplier} shouldComponentUpdate={true} />
          <AdvanceTime
            byAmount={7 * multiplier}
            shouldComponentUpdate={false}
          />
        </React.Profiler>
      );
    };

    const onRender = jest.fn(() => {});
    let rendered;
    await act(() => {
      rendered = ReactTestRenderer.create(<App multiplier={1} />, {
        unstable_isConcurrent: true,
      });
    });

    expect(hook.onCommitFiberRoot).toHaveBeenCalledTimes(1);

      // 用 Profiler 组件测量可观察耗时。Profiler 上方 App 的耗时不计入 duration，
      // 但仍会推进时钟，因此必须反映在时间偏移中。
    expect(onRender).toHaveBeenCalledTimes(1);
    expect(onRender).toHaveBeenCalledWith('Profiler', 'mount', 10, 10, 2, 12);
    onRender.mockClear();

      // 测量 DevTools profiler 需要但 Profiler 回调不可见的耗时。
      // 此时 base time 同时包含 App 自身 2ms 与 Profiler 子树 10ms。
    expect(rendered.root.findByType(App)._currentFiber().treeBaseDuration).toBe(
      12,
    );

    await act(() => {
      rendered.update(<App multiplier={2} />);
    });

      // 用 Profiler 组件测量可观察耗时。Profiler 上方 App 的耗时不计入 duration，
      // 但仍会推进时钟，因此必须反映在时间偏移中。
    expect(onRender).toHaveBeenCalledTimes(1);
    expect(onRender).toHaveBeenCalledWith('Profiler', 'update', 6, 13, 14, 20);

      // DevTools 的 base time 应保留未重渲染组件初始的 9ms，
      // 并采用已重渲染组件最新的 6ms。
    expect(rendered.root.findByType(App)._currentFiber().treeBaseDuration).toBe(
      15,
    );
  });

  /**
   * 场景：“should reset the fiber stack correctly after an error when profiling host roots”。
   * 机制：验证Profiler 与 DevTools 计时数据的集成契约，锁定可观察结果与失败边界。
   */
  it('should reset the fiber stack correctly after an error when profiling host roots', async () => {
    Scheduler.unstable_advanceTime(20);

    let rendered;
    await act(() => {
      rendered = ReactTestRenderer.create(
        <div>
          <AdvanceTime byAmount={2} />
        </div>,
        {unstable_isConcurrent: true},
      );
    });

    Scheduler.unstable_advanceTime(20);

    /** 作为“should reset the fiber stack correctly after an error when profiling host roots”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function Throws() {
      throw new Error('Oops!');
    }

    await expect(async () => {
      await act(() => {
        rendered.update(
          <Throws>
            <AdvanceTime byAmount={3} />
          </Throws>,
        );
      });
    }).rejects.toThrow('Oops!');

    Scheduler.unstable_advanceTime(20);

    await act(() => {
    // 若 profiler 的 Fiber 栈已在错误后正确复位，后续渲染应正常完成。
      rendered.update(
        <div>
          <AdvanceTime byAmount={7} />
        </div>,
      );
    });

      // DevTools base time 只应包含最近一次成功渲染，
      // 不得包含首次失败渲染的工作量，也不得包含两次渲染之间流逝的空闲时间。
    expect(
      rendered.root.findByType('div')._currentFiber().treeBaseDuration,
    ).toBe(7);
  });

  /**
   * 场景：“regression test: #17159”。
   * 机制：验证Profiler 与 DevTools 计时数据的集成契约，锁定可观察结果与失败边界。
   */
  it('regression test: #17159', async () => {
    /** 作为“regression test: #17159”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function Text({text}) {
      Scheduler.log(text);
      return text;
    }

    let root;
    await act(() => {
      root = ReactTestRenderer.create(null, {unstable_isConcurrent: true});
    });

    // 先提交一次内容，建立 DevTools profiler 的基线时间。
    root.update(<Text text="A" />);
    await waitForAll(['A']);
    expect(root).toMatchRenderedOutput('A');

    // 推进数秒，超过更新默认过期时间，验证空闲时间不会误使新更新立即过期。
    Scheduler.unstable_advanceTime(10000);
    // 安排一次新的异步更新。
    React.startTransition(() => {
      root.update(<Text text="B" />);
    });

    // B 的新更新不应因提交前流逝的时间而立即过期。
    await waitFor([]);

    await waitForAll(['B']);
    expect(root).toMatchRenderedOutput('B');
  });
});
