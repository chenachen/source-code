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
let ContinuousEventPriority;
let act;
let waitForAll;
let waitFor;
let assertLog;
let assertConsoleErrorDev;

/** 验证类/Hook 更新队列在优先级跳过、重基线、replaceState、回调与过期时间中的确定性语义。 */
describe('ReactIncrementalUpdates', () => {
  /** 重置根和调度器，绑定 lane 优先级、分片冲刷及控制台断言工具。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    ContinuousEventPriority =
      require('react-reconciler/constants').ContinuousEventPriority;

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    waitFor = InternalTestUtils.waitFor;
    assertLog = InternalTestUtils.assertLog;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;
  });

  /** 记录并返回文本，作为 render 分片和提交输出的统一探针。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** Given–When–Then：Given componentDidMount 同时安排 transition 的 b/c 与 SyncLane 的 a；When 先暂停在 commit 日志再耗尽工作；Then state 先只有 a，重基线后成为 a/b/c。通过中间与最终 state 验证类更新队列按 lane 跳过并重放。 */
  it('applies updates in order of priority', async () => {
    let state;
    /** 空 state 的类队列探针；挂载时把 Transition b/c 与 Sync a 交错，观察两轮累积。 */
    class Foo extends React.Component {
      /** 初始空对象，让每条合并更新对应新增的 a/b/c 字段。 */
      state = {};
      /** 同时安排 transition b/c 与同步 a 更新，形成可观察的优先级跳过。 */
      componentDidMount() {
        Scheduler.log('commit');
        React.startTransition(() => {
          // transition 中的 b/c 使用低优先级 lane。
          this.setState({b: 'b'});
          this.setState({c: 'c'});
        });
        // 提交生命周期中的 a 使用 SyncLane。
        this.setState({a: 'a'});
      }
      /** 保存本轮候选 state 给测试；中间同步结果只有 a，恢复后包含 a/b/c。 */
      render() {
        state = this.state;
        return <div />;
      }
    }

    ReactNoop.render(<Foo />);
    await waitFor(['commit']);

    expect(state).toEqual({a: 'a'});
    await waitForAll([]);
    expect(state).toEqual({a: 'a', b: 'b', c: 'c'});
  });

  /** Given–When–Then：Given 初始空 state；When 挂载生命周期按 a/b/c 顺序安排三个同步对象更新并耗尽工作；Then 最终 state 保留 a/b/c 三个字段。该断言检查合并结果，三条更新字段不同，因此没有直接区分 FIFO 与其他处理次序。 */
  it('applies updates with equal priority in insertion order', async () => {
    let state;
    /** 挂载生命周期连续安排 a/b/c 的同优先级合并更新，最终检查三个字段均保留。 */
    class Foo extends React.Component {
      /** 初始空对象作为三条对象更新的累积起点。 */
      state = {};
      /** 按 a/b/c 插入三个等优先级更新，验证 FIFO 合并。 */
      componentDidMount() {
        // 三个更新都继承提交阶段的 SyncLane。
        this.setState({a: 'a'});
        this.setState({b: 'b'});
        this.setState({c: 'c'});
      }
      /** 把处理后的 state 交给断言，不产生字段相关宿主内容。 */
      render() {
        state = this.state;
        return <div />;
      }
    }

    ReactNoop.render(<Foo />);
    await waitForAll([]);
    expect(state).toEqual({a: 'a', b: 'b', c: 'c'});
  });

  /** Given–When–Then：Given 队列按 transition x/y、sync a/b、transition replace c/d 入队；When 先完成 sync 提交再冲刷 transition；Then 中间 state 为 a/b，后续重放到 replace c 时整体替换此前累积，最终只保留 c/d。通过两轮提交日志与 state 验证跳过的 ReplaceState 在自己的处理轮中生效。 */
  it('only drops updates with equal or lesser priority when replaceState is called', async () => {
    let instance;
    /** 保存实例与空初始 state，记录提交轮次以区分 Sync 与 Transition replaceState 的处理。 */
    class Foo extends React.Component {
      /** 空初始 state，便于辨认同步 a/b 与稍后替换后的 c/d。 */
      state = {};
      /** 记录初次提交，建立 replaceState 场景的生命周期边界。 */
      componentDidMount() {
        Scheduler.log('componentDidMount');
      }
      /** 记录更新提交，区分同步队列与稍后恢复的 transition 队列。 */
      componentDidUpdate() {
        Scheduler.log('componentDidUpdate');
      }
      /** 记录每次 render 并暴露实例，所有字段结果由 instance.state 断言。 */
      render() {
        Scheduler.log('render');
        instance = this;
        return <div />;
      }
    }

    ReactNoop.render(<Foo />);
    await waitForAll(['render', 'componentDidMount']);

    ReactNoop.flushSync(() => {
      React.startTransition(() => {
        instance.setState({x: 'x'});
        instance.setState({y: 'y'});
      });
      instance.setState({a: 'a'});
      instance.setState({b: 'b'});
      React.startTransition(() => {
        instance.updater.enqueueReplaceState(instance, {c: 'c'});
        instance.setState({d: 'd'});
      });
    });

    // replaceState 虽已入队，但它属于异步 lane，
    // 当前同步提交尚不会处理它。
    expect(instance.state).toEqual({a: 'a', b: 'b'});
    assertLog(['render', 'componentDidUpdate']);

    await waitForAll(['render', 'componentDidUpdate']);
    // 随后冲刷其余异步更新，其中包括 replaceState。
    expect(instance.state).toEqual({c: 'c', d: 'd'});
  });

  /** Given–When–Then：Given transition a/b/c 已计算但未提交；When插入默认 d、同步 e/f 与 transition g 后恢复；Then同步轮先提交 def，最终重放 a..g 得到 abcdefg。通过 updater 日志和宿主 prop 验证中断后的 base queue 克隆与确定性重基线。 */
  it('can abort an update, schedule additional updates, and resume', async () => {
    let instance;
    /** 候选状态的字段名编码成文本，验证挂起 Transition 与新 Sync 更新的中断/重基线。 */
    class Foo extends React.Component {
      /** 从空对象积累 a..g 字段，各函数 updater 的日志追踪重放次序。 */
      state = {};
      /** 保存实例，并将候选字段排序后编码进 span，断言只读取已提交宿主输出。 */
      render() {
        instance = this;
        return <span prop={Object.keys(this.state).sort().join('')} />;
      }
    }

    ReactNoop.render(<Foo />);
    await waitForAll([]);

    /** 创建带日志的函数式更新；返回以 letter 为键的片段，精确显示每次重放次序。 */
    function createUpdate(letter) {
      return () => {
        Scheduler.log(letter);
        return {
          [letter]: letter,
        };
      };
    }

    // 安排一组 transition 异步更新。
    React.startTransition(() => {
      instance.setState(createUpdate('a'));
      instance.setState(createUpdate('b'));
      instance.setState(createUpdate('c'));
    });

    // 开始计算这些更新，但刻意停在提交前。
    await waitFor(['a', 'b', 'c']);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="" />);

    // 再插入不同优先级的更新。
    instance.setState(createUpdate('d'));
    ReactNoop.flushSync(() => {
      instance.setState(createUpdate('e'));
      instance.setState(createUpdate('f'));
    });
    React.startTransition(() => {
      instance.setState(createUpdate('g'));
    });

    // 同步更新已经提交，异步更新仍在 base queue 中。
    assertLog(['d', 'e', 'f']);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="def" />);

    // 冲刷剩余工作。e/f 虽已在同步轮处理，
    // 重基线时仍必须重新执行，确保最终状态
    // 与中断位置无关且确定。
    await waitForAll([
      // 为处理 g，队列会从 base state 重放所有相关更新。
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="abcdefg" />);
  });

  /** Given–When–Then：Given transition a/b/c 被中断；When插入 d/e、同步 replace f 与 transition g；Then同步轮只剩 f，最终重放得到 fg。通过日志和宿主 prop 验证 ReplaceState 在重基线中的截断语义。 */
  it('can abort an update, schedule a replaceState, and resume', async () => {
    let instance;
    /** 在中断队列恢复时加入同步 replace f，检查其对重放累积状态的整体替换。 */
    class Foo extends React.Component {
      /** 初始空对象；replaceState 的 f 返回值会成为新的整个 state。 */
      state = {};
      /** 保存实例并输出排序字段名，区别中间 f 与最终 fg 提交。 */
      render() {
        instance = this;
        return <span prop={Object.keys(this.state).sort().join('')} />;
      }
    }

    ReactNoop.render(<Foo />);
    await waitForAll([]);

    /** 创建带日志的函数式更新；返回以 letter 为键的片段，精确显示每次重放次序。 */
    function createUpdate(letter) {
      return () => {
        Scheduler.log(letter);
        return {
          [letter]: letter,
        };
      };
    }

    // 安排一组 transition 异步更新。
    React.startTransition(() => {
      instance.setState(createUpdate('a'));
      instance.setState(createUpdate('b'));
      instance.setState(createUpdate('c'));
    });

    // 开始计算这些更新，但刻意停在提交前。
    await waitFor(['a', 'b', 'c']);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="" />);

    // 再插入不同优先级的更新。
    instance.setState(createUpdate('d'));

    ReactNoop.flushSync(() => {
      instance.setState(createUpdate('e'));
      // replaceState 已不再是公共 API；这里通过 updater
      // 直接覆盖其内部队列语义。
      instance.updater.enqueueReplaceState(instance, createUpdate('f'));
    });
    React.startTransition(() => {
      instance.setState(createUpdate('g'));
    });

    // 同步更新已经提交，异步更新仍在 base queue 中。
    assertLog(['d', 'e', 'f']);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="f" />);

    // 冲刷剩余工作。e/f 虽已在同步轮处理，
    // 重基线时仍必须重新执行，确保最终状态
    // 与中断位置无关且确定。
    await waitForAll([
      // 为处理 g，队列会从 base state 重放所有相关更新。
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="fg" />);
  });

  /** Given–When–Then：Given a/b setState 排在函数式 replaceState 前；When耗尽同一更新队列；Then replace updater 的 previousState 同时含 a/b，并以其返回值完全替换。通过实例 state 验证 updater 入参是此前累积结果。 */
  it('passes accumulation of previous updates to replaceState updater function', async () => {
    let instance;
    /** 保存类实例，验证函数式 ReplaceState 接收到 a/b 的此前累积 state。 */
    class Foo extends React.Component {
      /** 空初始 state，用 a/b 两次合并构造 replace updater 的输入。 */
      state = {};
      /** 暴露实例并返回固定 span；本用例以 instance.state 检查 replace 函数参数。 */
      render() {
        instance = this;
        return <span />;
      }
    }
    ReactNoop.render(<Foo />);
    await waitForAll([]);

    instance.setState({a: 'a'});
    instance.setState({b: 'b'});
    // replaceState 已不再是公共 API；这里通过 updater
    // 直接覆盖其内部队列语义。
    instance.updater.enqueueReplaceState(instance, previousState => ({
      previousState,
    }));
    await waitForAll([]);
    expect(instance.state).toEqual({previousState: {a: 'a', b: 'b'}});
  });

  /** Given–When–Then：Given挂载后更新 a 的完成回调再安排更新 b 与回调；When耗尽所有工作；Then callback a、callback b 各自位于对应后续提交之后。通过 render/commit/callback 日志验证提交开始后新增回调不会并入当前 callback 列表。 */
  it('does not call callbacks that are scheduled by another callback until a later commit', async () => {
    /** 在 a 的完成回调中安排 b 与新回调，验证 callback 批次不会并入当前提交。 */
    class Foo extends React.Component {
      /** 初始空对象，分别以 a/b 字段驱动后续两个提交。 */
      state = {};
      /** 挂载后安排 a，并在其提交回调中再安排 b，制造跨提交 callback 链。 */
      componentDidMount() {
        Scheduler.log('did mount');
        this.setState({a: 'a'}, () => {
          Scheduler.log('callback a');
          this.setState({b: 'b'}, () => {
            Scheduler.log('callback b');
          });
        });
      }
      /** 记录 render 次数，与 did mount/callback a/callback b 对齐提交顺序。 */
      render() {
        Scheduler.log('render');
        return <div />;
      }
    }

    ReactNoop.render(<Foo />);
    await waitForAll([
      'render',
      'did mount',
      'render',
      'callback a',
      'render',
      'callback b',
    ]);
  });

  /** Given–When–Then：Given同步根更新触发 UNSAFE_componentWillReceiveProps，生命周期内再 setState b；When外层 flushSync 同时提交 a；Then a/b 同轮生效。通过 state 与日志验证 render-phase 类更新继承当前正在协调的 lane。 */
  it('gives setState during reconciliation the same priority as whatever level is currently reconciling', async () => {
    let instance;

    /** 新 props 触发旧 receiveProps 生命周期，在协调期间追加 b，与外部同步 a 同轮合并。 */
    class Foo extends React.Component {
      /** 初始空对象，使 a/b 两条更新结果可直接检查。 */
      state = {};
      /** 协调新 props 时安排 b，验证生命周期更新继承当前 sync lane。 */
      UNSAFE_componentWillReceiveProps() {
        Scheduler.log('componentWillReceiveProps');
        this.setState({b: 'b'});
      }
      /** 记录 render 并保存实例，测试以 state 检查 receiveProps 内追加的 b。 */
      render() {
        Scheduler.log('render');
        instance = this;
        return <div />;
      }
    }
    ReactNoop.render(<Foo />);
    await waitForAll(['render']);

    ReactNoop.flushSync(() => {
      instance.setState({a: 'a'});

      ReactNoop.render(<Foo />); // 触发 componentWillReceiveProps。
    });

    expect(instance.state).toEqual({a: 'a', b: 'b'});

    assertLog(['componentWillReceiveProps', 'render']);
  });

  /** Given–When–Then：Given函数式 updater a 内部再次 setState b；When执行更新并重复一次；Then嵌套更新继承当前 render lane、同轮提交，且纯函数警告只报告一次。通过 state、渲染日志和控制台去重断言验证。 */
  it('updates triggered from inside a class setState updater', async () => {
    let instance;
    /** 类 updater 内再次 setState 的违规 fixture，验证队列仍处理更新且 DEV 警告去重。 */
    class Foo extends React.Component {
      /** 空初始 state，让外层 updater a 与内层 b 的合并结果可见。 */
      state = {};
      /** 记录 render 并保存实例，状态变化由实例断言，宿主输出固定。 */
      render() {
        Scheduler.log('render');
        instance = this;
        return <div />;
      }
    }

    ReactNoop.render(<Foo />);
    await waitForAll([
      // 初次渲染。
      'render',
    ]);

    instance.setState(/** 记录外层 updater，嵌套提交 b 后返回 a 字段，刻意违反 updater 纯函数约束。 */ function a() {
      Scheduler.log('setState updater');
      this.setState({b: 'b'});
      return {a: 'a'};
    });

    await waitForAll([
      'setState updater',
      // render 阶段产生的更新继承当前正在渲染的
      // lane，因此会在同一轮 render 立即冲刷。
      'render',
    ]);
    assertConsoleErrorDev([
      'An update (setState, replaceState, or forceUpdate) was scheduled ' +
        'from inside an update function. Update functions should be pure, ' +
        'with zero side-effects. Consider using componentDidUpdate or a ' +
        'callback.\n' +
        '\n' +
        'Please update the following component: Foo\n' +
        '    in Foo (at **)',
    ]);
    expect(instance.state).toEqual({a: 'a', b: 'b'});

    // 再触发同类违规以验证警告去重，不应新增控制台输出。
    instance.setState(/** 再次在 updater 内提交 a 并返回 b，验证同类纯函数警告已被去重。 */ function a() {
      this.setState({a: 'a'});
      return {b: 'b'};
    });
    await waitForAll(
      gate(flags =>
        // render 阶段产生的更新继承当前正在渲染的
        // lane，因此会在同一轮 render 立即冲刷。
        ['render'],
      ),
    );
  });

  /** Given–When–Then：Given getDerivedStateFromProps 始终返回 derived state，且队列中含 noop callback；When父 Foo 再渲染后由兄弟 Bar 触发独立更新；Then Foo 仍保持 derived state。通过宿主 prop 验证派生状态已同步写回 updateQueue.baseState。 */
  it('getDerivedStateFromProps should update base state of updateQueue (based on product bug)', () => {
    // 源自真实产品缺陷的回归场景。

    let foo;
    /** 固定派生 value 的父类组件；Bar 的独立更新用来检查 updateQueue.baseState 保留派生结果。 */
    class Foo extends React.Component {
      /** 首次 value 为 initial state；getDerivedStateFromProps 每轮替换为 derived state。 */
      state = {value: 'initial state'};
      /** 固定返回 derived state，并要求该结果同步成为 updateQueue 的新 baseState。 */
      static getDerivedStateFromProps() {
        return {value: 'derived state'};
      }
      /** 保存 Foo 实例并渲染派生值与 Bar，连接两条更新队列。 */
      render() {
        foo = this;
        return (
          <>
            <span prop={this.state.value} />
            <Bar />
          </>
        );
      }
    }

    let bar;
    /** 独立兄弟更新触发器；用于在 Foo 未直接更新时检验其派生 baseState 是否稳定。 */
    class Bar extends React.Component {
      /** 保存 Bar 实例但不产生宿主输出，使其更新只负责触发根重新协调。 */
      render() {
        bar = this;
        return null;
      }
    }

    ReactNoop.flushSync(() => {
      ReactNoop.render(<Foo />);
    });
    expect(ReactNoop).toMatchRenderedOutput(<span prop="derived state" />);

    ReactNoop.flushSync(() => {
      // 再次触发 getDerivedStateFromProps。
      ReactNoop.render(<Foo />);
      // noop callback 用于进入曾触发缺陷的特定内部路径；
      // 删除它会让用例“偶然”通过。
      // noop 仅用于让完成回调列表非空，从而覆盖历史缺陷的内部分支。
      foo.setState({value: 'update state'}, /** 空完成回调使 callback 列表非空，进入派生 baseState 的历史回归路径。 */ function noop() {});
    });
    expect(ReactNoop).toMatchRenderedOutput(<span prop="derived state" />);

    ReactNoop.flushSync(() => {
      bar.setState({});
    });
    expect(ReactNoop).toMatchRenderedOutput(<span prop="derived state" />);
  });

  /** Given–When–Then：Given上一批 transition 的 layout effect 同步派生 count=1；When推进 10 秒后开启 count=2 的新 transition；Then新任务仍可在 Render:2 后让出。通过分片日志验证上批提交时间不会污染新 lane 的过期时间。 */
  it('regression: does not expire soon due to layout effects in the last batch', async () => {
    const {useState, useLayoutEffect} = React;

    let setCount;
    /** layout effect 在首次提交中派生 count=1，并暴露 setter 以启动独立的新 transition。 */
    function App() {
      const [count, _setCount] = useState(0);
      setCount = _setCount;
      Scheduler.log('Render: ' + count);
      useLayoutEffect(() => {
        setCount(1);
        Scheduler.log('Commit: ' + count);
      }, []);
      return <Text text="Child" />;
    }

    await act(async () => {
      React.startTransition(() => {
        ReactNoop.render(<App />);
      });
      assertLog([]);
      await waitForAll([
        'Render: 0',
        'Child',
        'Commit: 0',
        'Render: 1',
        'Child',
      ]);

      Scheduler.unstable_advanceTime(10000);
      React.startTransition(() => {
        setCount(2);
      });
      // 新 transition 不应提前过期，
      // 因此可以在中途让出。
      await waitFor(['Render: 2']);
      // 再完成剩余工作。
      await waitForAll(['Child']);
    });
  });

  /** Given–When–Then：Given先完成一次 flushSync，再推进 10 秒；When开启含 A-D 的新 transition；Then仍能在 A/B 后分片让出。通过逐次 waitFor 验证同步批次时间不会让新 transition 提前过期。 */
  it('regression: does not expire soon due to previous flushSync', async () => {
    ReactNoop.flushSync(() => {
      ReactNoop.render(<Text text="A" />);
    });
    assertLog(['A']);

    Scheduler.unstable_advanceTime(10000);

    React.startTransition(() => {
      ReactNoop.render(
        <>
          <Text text="A" />
          <Text text="B" />
          <Text text="C" />
          <Text text="D" />
        </>,
      );
    });
    // 新 transition 不应提前过期，
    // 因此可以分片渲染。
    await waitFor(['A']);
    await waitFor(['B']);
    await waitForAll(['C', 'D']);
  });

  /** Given–When–Then：Given第一轮 transition 中途推进时间使其过期并同步完成；When再次推进时间后开启第二轮 transition；Then第二轮重新获得完整超时窗口并可逐项让出。通过 A/B/C/D 分段日志验证过期状态不跨 lane 泄漏。 */
  it('regression: does not expire soon due to previous expired work', async () => {
    React.startTransition(() => {
      ReactNoop.render(
        <>
          <Text text="A" />
          <Text text="B" />
          <Text text="C" />
          <Text text="D" />
        </>,
      );
    });

    await waitFor(['A']);
    // 推进虚拟时间，使本轮剩余工作过期。
    Scheduler.unstable_advanceTime(10000);
    await waitFor(['B'], {
      additionalLogsAfterAttemptingToYield: ['C', 'D'],
    });

    Scheduler.unstable_advanceTime(10000);

    // 新建另一条 transition；它应拥有独立的过期窗口。
    React.startTransition(() => {
      ReactNoop.render(
        <>
          <Text text="A" />
          <Text text="B" />
          <Text text="C" />
          <Text text="D" />
        </>,
      );
    });

    // 新 transition 不应提前过期，
    // 因此可以分片渲染。
    await waitFor(['A']);
    await waitFor(['B']);
    await waitForAll(['C', 'D']);
  });

  /** Given–When–Then：Given transition A 被连续事件 B 抢占，B 提交后 layout effect 再安排 C/D；When低优先级队列重基线；Then提交序列 B、BCD、ABCD 且已提交 B/C/D 不丢失。通过函数组件日志验证 NoLane 克隆更新会参与最终重放。 */
  it('when rebasing, does not exclude updates that were already committed, regardless of priority', async () => {
    const {useState, useLayoutEffect} = React;

    let pushToLog;
    /** Hook 版重基线探针：pushToLog 追加字符，layout effect 在 B 提交后插入 C/D。 */
    function App() {
      const [log, setLog] = useState('');
      /** 以函数式 setState 追加字符，保证重放顺序直接反映在最终 log。 */
      pushToLog = msg => {
        setLog(prevLog => prevLog + msg);
      };

      useLayoutEffect(() => {
        Scheduler.log('Committed: ' + log);
        if (log === 'B') {
          // B 提交后立刻安排 C/D，制造提交期间插队。
          ReactNoop.unstable_runWithPriority(ContinuousEventPriority, () =>
            pushToLog('C'),
          );
          setLog(prevLog => prevLog + 'D');
        }
      }, [log]);

      return log;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });
    assertLog(['Committed: ']);
    expect(root).toMatchRenderedOutput(null);

    await act(() => {
      React.startTransition(() => {
        pushToLog('A');
      });

      ReactNoop.unstable_runWithPriority(ContinuousEventPriority, () =>
        pushToLog('B'),
      );
    });
    assertLog(['Committed: B', 'Committed: BCD', 'Committed: ABCD']);
    expect(root).toMatchRenderedOutput('ABCD');
  });

  /** Given–When–Then：Given类组件队列中 transition A 被连续事件 B 抢占，componentDidUpdate 再安排 C/D；When低优先级更新恢复；Then最终同样得到 ABCD。通过三次提交日志验证类 UpdateQueue 对已提交更新的 NoLane 克隆。 */
  it('when rebasing, does not exclude updates that were already committed, regardless of priority (classes)', async () => {
    let pushToLog;
    /** 类组件版重基线探针，以 componentDidUpdate 在 B 提交后插入 C/D。 */
    class App extends React.Component {
      /** 拼接更新标记的已提交日志；用于验证重基线不会漏掉高优先级结果。 */
      state = {log: ''};
      /** 以函数式 setState 追加字符，保证重放顺序直接反映在最终 log。 */
      pushToLog = msg => {
        this.setState(prevState => ({log: prevState.log + msg}));
      };
      /** 记录每次已提交 log；在 B 状态下插入连续事件 C 与继承提交优先级的同步 D。 */
      componentDidUpdate() {
        Scheduler.log('Committed: ' + this.state.log);
        if (this.state.log === 'B') {
          // B 提交后立刻安排 C/D，制造提交期间插队。
          ReactNoop.unstable_runWithPriority(ContinuousEventPriority, () =>
            this.pushToLog('C'),
          );
          this.pushToLog('D');
        }
      }
      /** 暴露 pushToLog 或返回当前 log，使外部能安排 A/B 并观察最终字符串。 */
      render() {
        pushToLog = this.pushToLog;
        return this.state.log;
      }
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });
    assertLog([]);
    expect(root).toMatchRenderedOutput(null);

    await act(() => {
      React.startTransition(() => {
        pushToLog('A');
      });
      ReactNoop.unstable_runWithPriority(ContinuousEventPriority, () =>
        pushToLog('B'),
      );
    });
    assertLog(['Committed: B', 'Committed: BCD', 'Committed: ABCD']);
    expect(root).toMatchRenderedOutput('ABCD');
  });

  /** Given–When–Then：Given派生状态在 prop 改变时加 100，随后同批次将 prop 改回并 setState 加 1；When队列从当前 Fiber 的 memoizedState 建立 baseState；Then两次 prop 变化加一次自增得到 201。通过最终输出排除误用 alternate Fiber 状态。 */
  it("base state of update queue is initialized to its fiber's memoized state", async () => {
    // 此用例通过公共 API 间接验证内部实现细节。
    // 最初的失败原因是 update queue 错误地使用了
    // alternate Fiber 的状态
    // 作为初始 baseState。
    let app;
    /** 以派生状态记录前一个 prop 和累计 count，暴露 updateQueue 初始 baseState 的来源。 */
    class App extends React.Component {
      /** prevProp 追踪上次派生输入，count 累积 prop 变化与普通 state 更新。 */
      state = {prevProp: 'A', count: 0};
      /** prop 改变时从 baseState 累加 100，并更新 prevProp；相同 prop 返回 null。 */
      static getDerivedStateFromProps(props, state) {
        // label 每变化一次就加 100；上一 label 存在 state 中。
        // 若队列错误丢失该状态，后续就无法识别
        // prop 变化。
        if (props.prop !== state.prevProp) {
          return {
            prevProp: props.prop,
            count: state.count + 100,
          };
        }
        return null;
      }
      /** 保存实例并返回 count，供后续同批 prop/state 更新使用。 */
      render() {
        app = this;
        return this.state.count;
      }
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App prop="A" />);
    });
    expect(root).toMatchRenderedOutput('0');

    // 第一次改变 prop，使 count 增加 100。
    await act(() => {
      root.render(<App prop="B" />);
    });
    expect(root).toMatchRenderedOutput('100');

    // 随后同一批次既用 state 更新加 1，
    // 又把 prop 改回初始值。
    await act(() => {
      root.render(<App prop="A" />);
      app.setState(state => ({count: state.count + 1}));
    });
    // 两次 prop 变化共加 200，再加一次自增得到 201。
    expect(root).toMatchRenderedOutput('201');
  });
});
