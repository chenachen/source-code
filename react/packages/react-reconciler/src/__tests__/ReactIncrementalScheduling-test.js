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
let waitForAll;
let waitFor;
let assertLog;
let waitForPaint;

/** 覆盖跨根、跨 lane 与生命周期更新的增量调度顺序，以及时间片边界上的 同步工作保证。 */
describe('ReactIncrementalScheduling', () => {
  /** 重置模块和多根调度状态，并绑定按工作单元、paint 或全量冲刷的测试工具。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    waitFor = InternalTestUtils.waitFor;
    assertLog = InternalTestUtils.assertLog;
    waitForPaint = InternalTestUtils.waitForPaint;
  });

  /** Given–When–Then：Given 根接收默认异步更新；When 当前调用栈内先读输出再耗尽调度工作；Then提交前为空、冲刷后出现 span。通过宿主树验证顶层更新会被调度而非立即提交。 */
  it('schedules and flushes deferred work', async () => {
    ReactNoop.render(<span prop="1" />);
    expect(ReactNoop).toMatchRenderedOutput(null);

    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="1" />);
  });

  /** Given–When–Then：Given 三个 root 依次收到更新；When 调度器耗尽全部工作；Then每个根都提交各自内容。通过三个 rootID 的宿主树验证完成当前根后会继续搜索其他待处理根。 */
  it('searches for work on other roots once the current root completes', async () => {
    ReactNoop.renderToRootWithID(<span prop="a:1" />, 'a');
    ReactNoop.renderToRootWithID(<span prop="b:1" />, 'b');
    ReactNoop.renderToRootWithID(<span prop="c:1" />, 'c');

    await waitForAll([]);

    expect(ReactNoop.getChildrenAsJSX('a')).toEqual(<span prop="a:1" />);
    expect(ReactNoop.getChildrenAsJSX('b')).toEqual(<span prop="b:1" />);
    expect(ReactNoop.getChildrenAsJSX('c')).toEqual(<span prop="c:1" />);
  });

  /** Given–When–Then：Given 已提交 prop=1，批处理先入队 DefaultLane 的 5，再在 flushSync 内入队 SyncLane 的 2/3/4；When 同步冲刷及后续耗尽调度工作；Then两次读取均为 4。本版存在 SyncLane 时将 DefaultLane 纳入 SyncUpdateLanes 同批处理，队列最后一项 4 决定结果；本例没有观察到先提交 4、再重放 5 的两个独立批次。 */
  it('schedules top-level updates in order of priority', async () => {
    // 建立初始已提交基线。
    ReactNoop.render(<span prop={1} />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop={1} />);

    ReactNoop.batchedUpdates(() => {
      ReactNoop.render(<span prop={5} />);
      ReactNoop.flushSync(() => {
        ReactNoop.render(<span prop={2} />);
        ReactNoop.render(<span prop={3} />);
        ReactNoop.render(<span prop={4} />);
      });
    });
    // Default 的 5 与 Sync 的 2/3/4 同批按入队顺序处理，结果为 4。
    expect(ReactNoop).toMatchRenderedOutput(<span prop={4} />);

    // 最终值由队列中最后一个实际生效的更新决定，
    // 不能只按优先级覆盖；此处为最后一个同步更新 4。
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop={4} />);
  });

  /** Given–When–Then：Given 同一根连续收到四个等优先级更新；When 一次耗尽队列；Then最后插入的 prop=5 胜出。通过宿主输出验证相同 lane 的 FIFO 处理。 */
  it('schedules top-level updates with same priority in order of insertion', async () => {
    // 建立初始已提交基线。
    ReactNoop.render(<span prop={1} />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop={1} />);

    ReactNoop.render(<span prop={2} />);
    ReactNoop.render(<span prop={3} />);
    ReactNoop.render(<span prop={4} />);
    ReactNoop.render(<span prop={5} />);

    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop={5} />);
  });

  /** Given–When–Then：Given a/b/c 三个根已挂载，transition 先安排 c、b，c 提交后才追加 a；When 每次推进至一个根的 effect 日志；Then输出依次更新 c、b、a。逐根快照验证后来插入的 a 不越过已等待的 b。 */
  it('works on deferred roots in the order they were scheduled', async () => {
    const {useEffect} = React;
    /** 在被动 effect 中记录提交文本，用于观察不同 root 的实际提交先后。 */
    function Text({text}) {
      useEffect(() => {
        Scheduler.log(text);
      }, [text]);
      return text;
    }

    await act(() => {
      ReactNoop.renderToRootWithID(<Text text="a:1" />, 'a');
      ReactNoop.renderToRootWithID(<Text text="b:1" />, 'b');
      ReactNoop.renderToRootWithID(<Text text="c:1" />, 'c');
    });
    assertLog(['a:1', 'b:1', 'c:1']);

    expect(ReactNoop.getChildrenAsJSX('a')).toEqual('a:1');
    expect(ReactNoop.getChildrenAsJSX('b')).toEqual('b:1');
    expect(ReactNoop.getChildrenAsJSX('c')).toEqual('c:1');

    // 以 c、b 的反向根顺序安排延后工作。
    await act(async () => {
      React.startTransition(() => {
        ReactNoop.renderToRootWithID(<Text text="c:2" />, 'c');
        ReactNoop.renderToRootWithID(<Text text="b:2" />, 'b');
      });
      // 确认调度器先处理最早插入的 c。
      await waitFor(['c:2']);

      expect(ReactNoop.getChildrenAsJSX('a')).toEqual('a:1');
      expect(ReactNoop.getChildrenAsJSX('b')).toEqual('b:1');
      expect(ReactNoop.getChildrenAsJSX('c')).toEqual('c:2');
      // 最后插入 a，因此它也应最后处理。

      React.startTransition(() => {
        ReactNoop.renderToRootWithID(<Text text="a:2" />, 'a');
      });

      // 继续按插入顺序处理 b，再处理 a。
      await waitFor(['b:2']);
      expect(ReactNoop.getChildrenAsJSX('a')).toEqual('a:1');
      expect(ReactNoop.getChildrenAsJSX('b')).toEqual('b:2');
      expect(ReactNoop.getChildrenAsJSX('c')).toEqual('c:2');

      await waitFor(['a:2']);
      expect(ReactNoop.getChildrenAsJSX('a')).toEqual('a:2');
      expect(ReactNoop.getChildrenAsJSX('b')).toEqual('b:2');
      expect(ReactNoop.getChildrenAsJSX('c')).toEqual('c:2');
    });
  });

  /** Given–When–Then：Given transition 挂载 Foo，挂载/更新生命周期内部直接 setState；When 渲染停在提交前后逐单元推进；Then生命周期更新获得 SyncLane并在同一任务中连续冲刷至 tick=1/3。通过完整生命周期日志验证 commit 阶段同步更新规则。 */
  it('schedules sync updates when inside componentDidMount/Update', async () => {
    let instance;

    /** 在挂载和更新生命周期中直接 setState，验证提交阶段更新默认升级为 同步工作。 */
    class Foo extends React.Component {
      /** 生命周期驱动的 tick；0/2 为外部输入，1/3 为对应生命周期内更新。 */
      state = {tick: 0};

      /** 直接安排 tick=1，并记录调用前后 this.state，证明提交批次内状态仍为旧值。 */
      componentDidMount() {
        Scheduler.log(
          'componentDidMount (before setState): ' + this.state.tick,
        );
        this.setState({tick: 1});
        // 生命周期位于提交批次中；setState 尚未即时改写 this.state。
        Scheduler.log('componentDidMount (after setState): ' + this.state.tick);
      }

      /** 记录每次提交；tick=2 时直接安排 tick=3，验证同一同步冲刷中继续冲刷。 */
      componentDidUpdate() {
        Scheduler.log('componentDidUpdate: ' + this.state.tick);
        if (this.state.tick === 2) {
          Scheduler.log(
            'componentDidUpdate (before setState): ' + this.state.tick,
          );
          this.setState({tick: 3});
          Scheduler.log(
            'componentDidUpdate (after setState): ' + this.state.tick,
          );
          // 生命周期位于提交批次中；setState 尚未即时改写 this.state。
        }
      }

      /** 记录 tick、保存实例并输出宿主 prop，连接调度日志与已提交状态。 */
      render() {
        Scheduler.log('render: ' + this.state.tick);
        instance = this;
        return <span prop={this.state.tick} />;
      }
    }

    React.startTransition(() => {
      ReactNoop.render(<Foo />);
    });
    // 只完成 render，刻意停在提交前。
    await waitFor(['render: 0']);

    // 再推进一个工作单元进入提交阶段。
    expect(ReactNoop.flushNextYield()).toEqual([
      'componentDidMount (before setState): 0',
      'componentDidMount (after setState): 0',
      // 若 componentDidMount 内的 setState 被延后，这里不会再有日志；
      // 实际它获得 SyncLane，因此同一任务还会完成以下更新。
      'render: 1',
      'componentDidUpdate: 1',
    ]);

    React.startTransition(() => {
      instance.setState({tick: 2});
    });
    await waitFor(['render: 2']);
    expect(ReactNoop.flushNextYield()).toEqual([
      'componentDidUpdate: 2',
      'componentDidUpdate (before setState): 2',
      'componentDidUpdate (after setState): 2',
      // 若 componentDidUpdate 内的 setState 被延后，这里不会再有日志；
      // 实际它获得 SyncLane，因此同一任务还会完成以下更新。
      'render: 3',
      'componentDidUpdate: 3',
    ]);
  });

  /** Given–When–Then：Given 生命周期将 setState 显式包进 startTransition；When 同步挂载后分阶段冲刷；Then tick=1/3 都延后到后续异步轮次。通过每次 paint 的状态和日志验证 transition 能覆盖生命周期默认 SyncLane。 */
  it('can opt-in to async scheduling inside componentDidMount/Update', async () => {
    let instance;
    /** 把生命周期 setState 包入 transition，验证显式异步优先级覆盖默认提交阶段优先级。 */
    class Foo extends React.Component {
      /** 生命周期驱动的 tick；0/2 为外部输入，1/3 为对应生命周期内更新。 */
      state = {tick: 0};

      /** 将 tick=1 放进 transition，要求它在同步挂载提交后另起异步轮次。 */
      componentDidMount() {
        React.startTransition(() => {
          Scheduler.log(
            'componentDidMount (before setState): ' + this.state.tick,
          );
          this.setState({tick: 1});
          Scheduler.log(
            'componentDidMount (after setState): ' + this.state.tick,
          );
        });
      }

      /** 在 transition 内记录提交，并于 tick=2 时异步安排 tick=3。 */
      componentDidUpdate() {
        React.startTransition(() => {
          Scheduler.log('componentDidUpdate: ' + this.state.tick);
          if (this.state.tick === 2) {
            Scheduler.log(
              'componentDidUpdate (before setState): ' + this.state.tick,
            );
            this.setState({tick: 3});
            Scheduler.log(
              'componentDidUpdate (after setState): ' + this.state.tick,
            );
          }
        });
      }

      /** 记录 tick、保存实例并输出宿主 prop，连接调度日志与已提交状态。 */
      render() {
        Scheduler.log('render: ' + this.state.tick);
        instance = this;
        return <span prop={this.state.tick} />;
      }
    }

    ReactNoop.flushSync(() => {
      ReactNoop.render(<Foo />);
    });
    // cDM 更新显式进入 transition，具有异步优先级，此时不应冲刷。
    assertLog([
      'render: 0',
      'componentDidMount (before setState): 0',
      'componentDidMount (after setState): 0',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop={0} />);

    // 现在冲刷 cDM 安排的异步更新。
    await waitForAll(['render: 1', 'componentDidUpdate: 1']);
    expect(ReactNoop).toMatchRenderedOutput(<span prop={1} />);

    React.startTransition(() => {
      instance.setState({tick: 2});
    });

    await waitForPaint([
      'render: 2',
      'componentDidUpdate: 2',
      'componentDidUpdate (before setState): 2',
      'componentDidUpdate (after setState): 2',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop={2} />);

    // 最后冲刷 cDU 安排的异步更新。
    await waitForAll(['render: 3', 'componentDidUpdate: 3']);
    expect(ReactNoop).toMatchRenderedOutput(<span prop={3} />);
  });

  /** Given–When–Then：Given transition 挂载的 Foo 在 componentDidMount 回调链中连续安排 step=2..5；When waitFor 收到一次 Foo 日志后让出，再调用 flushNextYield；Then首次检查尚未提交，第二次已提交 step=5。测试使用 mock yield 数量控制暂停点，没有推进模拟时钟；最终输出验证提交触发的同步更新链不会因继续收到 render 日志而中断。 */
  it('performs Task work even after time runs out', async () => {
    /** 在挂载回调中串联四次 setState，观察 mock 让出点之后的同步队列连续性。 */
    class Foo extends React.Component {
      /** 回调链推进的步骤值，最终必须连续到 5。 */
      state = {step: 1};
      /** 通过完成回调逐级安排后续更新，确保每一项只在上一项提交后入队。 */
      componentDidMount() {
        this.setState({step: 2}, () => {
          this.setState({step: 3}, () => {
            this.setState({step: 4}, () => {
              this.setState({step: 5});
            });
          });
        });
      }
      /** 每次 render 记录 Foo 并输出当前 step，以暂停点和最终值共同断言任务链。 */
      render() {
        Scheduler.log('Foo');
        return <span prop={this.state.step} />;
      }
    }
    React.startTransition(() => {
      ReactNoop.render(<Foo />);
    });

    // 这一步刚好完成 render 工作，但不足以
    // 进入提交阶段。
    await waitFor(['Foo']);
    expect(ReactNoop).toMatchRenderedOutput(null);

    // 再推进一个工作单元触发提交。
    ReactNoop.flushNextYield();
    // 回调链中的更新都应以 SyncLane冲刷完成。
    expect(ReactNoop).toMatchRenderedOutput(<span prop={5} />);
  });
});
