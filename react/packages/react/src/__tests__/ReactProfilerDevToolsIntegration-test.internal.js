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
      // 在 renderer 加载前安装 DevTools hook，commit root 为计数 spy；每例重置模块并开启 timer，建立确定性模拟时钟 fixture。
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

    /** 模拟耗时的 class，每次允许的 render 推进 Scheduler 时钟；SCU 可跳过叶子更新，保留旧 base duration。 */
    AdvanceTime = class extends React.Component {
      /** 默认 byAmount=10ms 且允许更新；每例可覆盖确定性耗时和 bailout。 */
      static defaultProps = {
        /** 模拟耗时的共享 class：可由 SCU 跳过更新，每例重新定义类型和默认值。 */
        byAmount: 10,
        shouldComponentUpdate: true,
      };
      /** 返回 nextProps.shouldComponentUpdate，供第二叶更新跳过 render 并保留初始 base duration。 */
      shouldComponentUpdate(nextProps) {
        return nextProps.shouldComponentUpdate;
      }
      /** 按 props.byAmount 推进 Scheduler 模拟时钟，再透传 children 或 null；不使用真实墙钟。 */
      render() {
    // 渲染时推进模拟时钟，使 Profiler 能观测确定性的耗时。
        Scheduler.unstable_advanceTime(this.props.byAmount);
        return this.props.children || null;
      }
    };
  });

  /** 安装支持 Fiber 的 DevTools hook，App 自耗 2ms、两叶初耗 3/7ms；乘数 1→2 更新时第二叶 SCU=false，Profiler 回调 actual/base=6/13，App treeBase=15，验证自动计时、祖先耗时和 bailout 保留基准值。 */
  it('should auto-Profile all fibers if the DevTools hook is detected', async () => {
    /** 按 multiplier 给两叶 3/7 倍耗时，自身先耗 2ms，第二叶 SCU=false，供 Profiler 与 App Fiber 基准差异断言。 */
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

      // DevTools 的 base time 保留跳过更新叶子初始的 7ms，加上 App 当前 2ms，
      // 再采用已重渲染叶子最新 6ms，总计 15ms。
    expect(rendered.root.findByType(App)._currentFiber().treeBaseDuration).toBe(
      15,
    );
  });

  /** 先成功挂 2ms 叶，空闲后更新 Throws 并要求 Oops 拒绝，再空闲后成功挂 7ms 叶；宿主 Fiber treeBaseDuration=7，验证错误恢复清理计时栈且不计失败或空闲时间。 */
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

    /** 每次 render 抛 Oops，阻止 children 执行，供计时栈异常恢复检查。 */
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

  /** 并发 test renderer 先提交文本 A，模拟空闲 10000ms 后 transition 更新 B；waitFor([]) 后再完整等待 B，最终输出 B，验证新更新不因历史空闲时间立即过期。 */
  it('regression test: #17159', async () => {
    /** 把 text 写入 Scheduler 日志并原样返回，供异步更新是否在预定等待边界执行的断言。 */
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
