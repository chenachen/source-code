/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @jest-environment node
 */

'use strict';

let React;
let ReactNoop;
let Scheduler;
let act;
let readText;
let resolveText;
let startTransition;
let useState;
let useEffect;
let assertLog;
let waitFor;
let waitForAll;
let unstable_waitForExpired;

/** 验证 lane 过期时间的事件基准、CPU/IO 饥饿、idle 边界及过期工作与同步/被动阶段的交互。 */
describe('ReactExpiration', () => {
  /** 重置模块、虚拟时钟与文本资源缓存，并绑定分片、全量和仅过期工作三类冲刷工具。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    startTransition = React.startTransition;
    useState = React.useState;
    useEffect = React.useEffect;

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;
    waitFor = InternalTestUtils.waitFor;
    waitForAll = InternalTestUtils.waitForAll;
    unstable_waitForExpired = InternalTestUtils.unstable_waitForExpired;

    const textCache = new Map();

    /** 读取文本资源状态：resolved 返回，pending 抛 thenable，rejected 抛错误，缺失则创建 pending 记录。 */
    readText = text => {
      const record = textCache.get(text);
      if (record !== undefined) {
        // 状态机边界：pending/rejected 必须通过抛出向 Suspense/错误边界传递，只有 resolved 可返回值。
        switch (record.status) {
          case 'pending':
            throw record.promise;
          case 'rejected':
            throw Error('Failed to load: ' + text);
          case 'resolved':
            return text;
        }
      } else {
        let ping;
        const promise = new Promise(resolve => (ping = resolve));
        const newRecord = {
          status: 'pending',
          ping: ping,
          promise,
        };
        textCache.set(text, newRecord);
        throw promise;
      }
    };

    /** 先 resolve 原生 Promise，再写入 resolved 并清理 timer/promise；Promise 回调在微任务中读取已更新记录。未读取过的文本直接写入已解决记录。 */
    resolveText = text => {
      const record = textCache.get(text);
      if (record !== undefined) {
        if (record.status === 'pending') {
          Scheduler.log(`Promise resolved [${text}]`);
          record.ping();
          record.ping = null;
          record.status = 'resolved';
          clearTimeout(record.promise._timer);
          record.promise = null;
        }
      } else {
        const newRecord = {
          ping: null,
          status: 'resolved',
          promise: null,
        };
        textCache.set(text, newRecord);
      }
    };
  });

  /** 记录并返回同步文本，作为 render 分片与最终宿主输出的探针。 */
  function Text(props) {
    Scheduler.log(props.text);
    return props.text;
  }

  /** 读取可挂起文本；首次挂起时可安装定时解决器，并原样重抛 thenable 交给 Suspense。 */
  function AsyncText(props) {
    const text = props.text;
    // WHY：readText 通过抛出 thenable 表达 IO 等待；捕获只用于记录/安装 timer，必须继续抛出。
    try {
      readText(text);
      Scheduler.log(text);
      return text;
    } catch (promise) {
      if (typeof promise.then === 'function') {
        Scheduler.log(`Suspend! [${text}]`);
        if (typeof props.ms === 'number' && promise._timer === undefined) {
          promise._timer = setTimeout(() => {
            resolveText(text);
          }, props.ms);
        }
      } else {
        Scheduler.log(`Error! [${text}]`);
      }
      throw promise;
    }
  }

  /** Given–When–Then：Given低优先级 Step 2 排在已提交 Step 1 后；When先不推进时间、再推进 4500ms、最后补到 5000ms；Then前两次不冲刷，达到阈值后 Step 2 过期并同步完成。通过 unstable_waitForExpired 与输出验证 lane 随时间升级。 */
  it('increases priority of updates as time progresses', async () => {
    ReactNoop.render(<Text text="Step 1" />);
    React.startTransition(() => {
      ReactNoop.render(<Text text="Step 2" />);
    });
    await waitFor(['Step 1']);

    expect(ReactNoop).toMatchRenderedOutput('Step 1');

    // 时间尚未推进，任何更新都不应过期。
    await unstable_waitForExpired([]);
    expect(ReactNoop).toMatchRenderedOutput('Step 1');

    // 推进 4500ms，仍不足以让低优先级更新过期。
    ReactNoop.expire(4500);
    await unstable_waitForExpired([]);
    expect(ReactNoop).toMatchRenderedOutput('Step 1');

    // 再推进 500ms 达到阈值，更新应过期并冲刷。
    ReactNoop.expire(500);
    await unstable_waitForExpired(['Step 2']);
    expect(ReactNoop).toMatchRenderedOutput('Step 2');
  });

  /** Given–When–Then：Given 第一轮先以 transition 渲染 A 并被另一根的同步工作打断，再普通更新为 B；第二轮连续普通更新 A/B；When 冲刷两轮；Then 都只提交 B，第一轮已有 A 的 render 日志，第二轮没有。 */
  it('two updates of like priority in the same event always flush within the same batch', async () => {
    /** 以 render/commit 双日志标记更新是否只是计算、还是已经提交到宿主根。 */
    class TextClass extends React.Component {
      /** 记录本次文本的挂载提交，区分 render 与 commit。 */
      componentDidMount() {
        Scheduler.log(`${this.props.text} [commit]`);
      }
      /** 记录更新提交的 text/label，确认批次最终只提交目标值。 */
      componentDidUpdate() {
        Scheduler.log(`${this.props.text} [commit]`);
      }
      /** 记录文本的 render 阶段并输出对应 span，允许在提交前暂停。 */
      render() {
        Scheduler.log(`${this.props.text} [render]`);
        return <span prop={this.props.text} />;
      }
    }

    /** 在独立的 other-root 同步渲染 null，中断被测根的并发 render；同步写入发生在另一根。 */
    function interrupt() {
      ReactNoop.flushSync(() => {
        ReactNoop.renderToRootWithID(null, 'other-root');
      });
    }

    // 先建立两个独立事件中的对照行为。
    // 安排第一条更新。
    React.startTransition(() => {
      ReactNoop.render(<TextClass text="A" />);
    });
    // 推进虚拟计时器。
    Scheduler.unstable_advanceTime(2000);
    // 只渲染第一条更新的一部分，随后用同步根中断。
    await waitFor(['A [render]']);
    interrupt();

    // 不再推进到过期阈值，第一条更新保持未提交。
    assertLog([]);
    expect(ReactNoop).toMatchRenderedOutput(null);

    // 安排普通 B 更新；第二轮的 A/B 都采用普通更新入口。
    ReactNoop.render(<TextClass text="B" />);
    // 两条更新被同一批次处理。
    await waitForAll(['B [render]', 'B [commit]']);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="B" />);

    // 再重复一次，但两次更新之间
    // 不执行任何可让调度器观察到的工作。
    ReactNoop.render(<TextClass text="A" />);
    Scheduler.unstable_advanceTime(2000);
    assertLog([]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="B" />);
    // 安排普通 B 更新；第二轮的 A/B 都采用普通更新入口。
    ReactNoop.render(<TextClass text="B" />);
    // 从调度器视角，两条更新可能发生在同一事件中，
    // 因此必须在同一批次冲刷。
    await waitForAll(['B [render]', 'B [commit]']);
  });

  /** Given–When–Then：Given 第一轮 transition A 已 render，第二轮普通 A 尚未 render；When 两轮都插入 other-root 的同步 null 更新后普通更新为 B；Then 两轮都只提交 B，验证另一根的同步更新不会迫使被测根先提交 A。 */
  it(
    'two updates of like priority in the same event always flush within the ' +
      "same batch, even if there's a sync update in between",
    async () => {
    /** 以 render/commit 双日志标记更新是否只是计算、还是已经提交到宿主根。 */
      class TextClass extends React.Component {
        /** 记录本次文本的挂载提交，区分 render 与 commit。 */
        componentDidMount() {
          Scheduler.log(`${this.props.text} [commit]`);
        }
        /** 记录更新提交的 text/label，确认批次最终只提交目标值。 */
        componentDidUpdate() {
          Scheduler.log(`${this.props.text} [commit]`);
        }
        /** 记录文本的 render 阶段并输出对应 span，允许在提交前暂停。 */
        render() {
          Scheduler.log(`${this.props.text} [render]`);
          return <span prop={this.props.text} />;
        }
      }

    /** 在独立的 other-root 同步渲染 null，中断被测根的并发 render；同步写入发生在另一根。 */
      function interrupt() {
        ReactNoop.flushSync(() => {
          ReactNoop.renderToRootWithID(null, 'other-root');
        });
      }

      // 先建立两个独立事件中的对照行为。
      // 安排第一条更新。
      React.startTransition(() => {
        ReactNoop.render(<TextClass text="A" />);
      });

      // 推进虚拟计时器。
      Scheduler.unstable_advanceTime(2000);
      // 部分渲染第一条更新，再同步中断。
      await waitFor(['A [render]']);
      interrupt();

      // 不推进到过期阈值。
      assertLog([]);
      expect(ReactNoop).toMatchRenderedOutput(null);

      // 安排普通 B 更新；第二轮的 A/B 都采用普通更新入口。
      ReactNoop.render(<TextClass text="B" />);
      // 两条更新仍归入同一批次。
      await waitForAll(['B [render]', 'B [commit]']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="B" />);

      // 再重复一次，但两次更新之间
      // 不冲刷任何工作。
      ReactNoop.render(<TextClass text="A" />);
      Scheduler.unstable_advanceTime(2000);
      assertLog([]);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="B" />);

      // 执行其他同步工作；调度器仍必须假定
      // 当前处于同一事件。
      interrupt();

      // 安排普通 B 更新；第二轮的 A/B 都采用普通更新入口。
      ReactNoop.render(<TextClass text="B" />);
      // 从调度器视角，两条更新可能来自同一事件，
      // 因此仍应同批冲刷。
      await waitForAll(['B [render]', 'B [commit]']);
    },
  );

  /** Given–When–Then：Given四个 Connected 的 text=1 transition 只渲染 A/B；When未推进时间又安排 text=2；Then新更新获得不同 lane，当前轮 C/D 继续使用 1。通过分片日志验证后到的 transition 更新不会改变正在进行的渲染所使用的状态。 */
  it('cannot update at the same expiration time that is already rendering', async () => {
    const store = {text: 'initial'};
    const subscribers = [];
    /** 订阅共享 store 的类实例；四个副本用于在同一 transition 中制造可暂停的批量 setState。 */
    class Connected extends React.Component {
      /** 从共享 store 捕获初始文本；后续由 subscribers 列表统一推进到 1/2。 */
      state = {text: store.text};
      /** 注册实例并记录初次提交的 text/label。 */
      componentDidMount() {
        subscribers.push(this);
        Scheduler.log(`${this.state.text} [${this.props.label}] [commit]`);
      }
      /** 记录更新提交的 text/label，确认批次最终只提交目标值。 */
      componentDidUpdate() {
        Scheduler.log(`${this.state.text} [${this.props.label}] [commit]`);
      }
      /** 记录每个订阅者本轮 text/label，并输出 text 供分片检查。 */
      render() {
        Scheduler.log(`${this.state.text} [${this.props.label}] [render]`);
        return <span prop={this.state.text} />;
      }
    }

    /** 渲染四个带标签的 Connected，提供足够工作单元以在 B 后暂停。 */
    function App() {
      return (
        <>
          <Connected label="A" />
          <Connected label="B" />
          <Connected label="C" />
          <Connected label="D" />
        </>
      );
    }

    // 初次挂载四个订阅者。
    React.startTransition(() => {
      ReactNoop.render(<App />);
    });

    await waitForAll([
      'initial [A] [render]',
      'initial [B] [render]',
      'initial [C] [render]',
      'initial [D] [render]',
      'initial [A] [commit]',
      'initial [B] [commit]',
      'initial [C] [commit]',
      'initial [D] [commit]',
    ]);

    // 只完成第一轮更新的前两个订阅者。
    React.startTransition(() => {
      subscribers.forEach(s => s.setState({text: '1'}));
    });

    await waitFor(['1 [A] [render]', '1 [B] [render]']);

    // 第一轮尚未完成就再次更新。即使时间没有推进，
    // 本例后到更新位于另一 transition lane，并暂存到并发队列；
    // 因此 C/D 继续渲染 1，而不是吸收 2。
    React.startTransition(() => {
      subscribers.forEach(s => s.setState({text: '2'}));
    });
    await waitFor(['1 [C] [render]', '1 [D] [render]']);
  });

  /** Given–When–Then：Given A-E transition 已分片完成 A/B/C；When CPU 时间推进 10 秒；Then D/E 作为过期工作不再让出并一次完成。通过 expired 日志与根输出验证 CPU 饥饿保护。 */
  it('stops yielding if CPU-bound update takes too long to finish', async () => {
    const root = ReactNoop.createRoot();
    /** 渲染 A-E 五个文本单元，用逐项日志观察时间片让出与过期后连续完成。 */
    function App() {
      return (
        <>
          <Text text="A" />
          <Text text="B" />
          <Text text="C" />
          <Text text="D" />
          <Text text="E" />
        </>
      );
    }

    React.startTransition(() => {
      root.render(<App />);
    });

    await waitFor(['A']);
    await waitFor(['B']);
    await waitFor(['C']);

    Scheduler.unstable_advanceTime(10000);

    await unstable_waitForExpired(['D', 'E']);
    expect(root).toMatchRenderedOutput('ABCDE');
  });

  /** Given–When–Then：Given模块启动后先推进 10 秒，再创建根并开始 A-E transition；When从该更新起再推进 10 秒；Then只在第二段时间后判定过期并完成 D/E。通过分片日志验证根过期基准是首个更新时间而非进程启动时间。 */
  it('root expiration is measured from the time of the first update', async () => {
    Scheduler.unstable_advanceTime(10000);

    const root = ReactNoop.createRoot();
    /** 渲染 A-E 五个文本单元，用逐项日志观察时间片让出与过期后连续完成。 */
    function App() {
      return (
        <>
          <Text text="A" />
          <Text text="B" />
          <Text text="C" />
          <Text text="D" />
          <Text text="E" />
        </>
      );
    }
    React.startTransition(() => {
      root.render(<App />);
    });

    await waitFor(['A']);
    await waitFor(['B']);
    await waitFor(['C']);

    Scheduler.unstable_advanceTime(10000);

    await unstable_waitForExpired(['D', 'E']);
    expect(root).toMatchRenderedOutput('ABCDE');
  });

  /** Given–When–Then：Given在导入 renderer 前把 Scheduler 时间推进到超过 31 位位运算范围；When模块初始化后安排 Step 2 并继续推进 10 秒；Then初始大时间不导致溢出式立即过期，后续相对时间仍正确。通过两次 expired 检查验证大时间戳下仍保留正常的过期窗口。 */
  it('should measure expiration times relative to module initialization', async () => {
    // 保留旧 expiration time 位运算溢出的回归输入；当前 lane 过期表保存数值时间戳。

    jest.resetModules();
    Scheduler = require('scheduler');

    const InternalTestUtils = require('internal-test-utils');
    waitFor = InternalTestUtils.waitFor;
    assertLog = InternalTestUtils.assertLog;
    unstable_waitForExpired = InternalTestUtils.unstable_waitForExpired;

    // 导入 renderer 前，把当前时间推进到
    // 超过位运算允许的最大值。
    const maxSigned31BitInt = 1073741823;
    Scheduler.unstable_advanceTime(maxSigned31BitInt * 100);

    // 在大时间戳下导入 renderer，再安排更新，检查它不会立即过期。
    ReactNoop = require('react-noop-renderer');
    React = require('react');

    ReactNoop.render(<Text text="Step 1" />);
    React.startTransition(() => {
      ReactNoop.render(<Text text="Step 2" />);
    });
    await waitFor(['Step 1']);

    // 更新此时不应过期。
    await unstable_waitForExpired([]);

    expect(ReactNoop).toMatchRenderedOutput('Step 1');

    // 再推进时间，使更新达到过期阈值。
    Scheduler.unstable_advanceTime(10000);
    await unstable_waitForExpired(['Step 2']);
    expect(ReactNoop).toMatchRenderedOutput('Step 2');
  });

  /** Given–When–Then：Given调度更新前先推进当前时间 10 秒；When再推进约 6 秒达到 transition 超时；Then任务按调度时刻计算 timeout 并提交 Hi。通过前后 expired 检查验证 Scheduler callback 的相对超时。 */
  it('should measure callback timeout relative to current time, not start-up time', async () => {
    // 对应修复：https://github.com/facebook/react/pull/15479
    // 其他用例未发现该缺陷，因为虚拟时间默认从 0 开始，
    // 且多数用例不主动推进时间。

    // 安排更新前先推进当前时间。
    Scheduler.unstable_advanceTime(10000);

    React.startTransition(() => {
      ReactNoop.render('Hi');
    });

    await unstable_waitForExpired([]);
    expect(ReactNoop).toMatchRenderedOutput(null);

    // 再推进约 5 秒应足以让更新过期；
    // 这里使用略大的 6 秒以容纳舍入。
    Scheduler.unstable_advanceTime(6000);
    await unstable_waitForExpired([]);
    expect(ReactNoop).toMatchRenderedOutput('Hi');
  });

  /** Given–When–Then：Given normal transition 被 sync 更新抢占；When分别在未过期与推进 10 秒饥饿后恢复；Then未过期轮仍可分片，饥饿轮则关闭 time slicing 一次完成。通过 additionalLogsAfterAttemptingToYield 验证 markStarvedLanesAsExpired。 */
  it('prevents starvation by sync updates by disabling time slicing if too much time has elapsed', async () => {
    let updateSyncPri;
    let updateNormalPri;
    /** 同时维护 sync/normal 计数并暴露两种更新入口，构造抢占与饥饿。 */
    function App() {
      const [highPri, setHighPri] = useState(0);
      const [normalPri, setNormalPri] = useState(0);
      /** 以 flushSync 增加高优先级计数，抢占正在进行的 normal transition。 */
      updateSyncPri = () => {
        ReactNoop.flushSync(() => {
          setHighPri(n => n + 1);
        });
      };
      /** 增加 normal 计数；调用者用 startTransition 为这一更新选择 transition lane。 */
      updateNormalPri = () => setNormalPri(n => n + 1);
      return (
        <>
          <Text text={'Sync pri: ' + highPri} />
          {', '}
          <Text text={'Normal pri: ' + normalPri} />
        </>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });
    assertLog(['Sync pri: 0', 'Normal pri: 0']);
    expect(root).toMatchRenderedOutput('Sync pri: 0, Normal pri: 0');

    // 先演示没有饥饿时的分片行为。
    await act(async () => {
      React.startTransition(() => {
        updateNormalPri();
      });
      await waitFor(['Sync pri: 0']);
      updateSyncPri();
      assertLog(['Sync pri: 1', 'Normal pri: 0']);

      // 剩余工作未过期，render 阶段仍采用 time slicing。
      // 因此可以只冲刷第一个子节点，
      // 而不连带完成剩余节点。
      //
      // 在第一个子节点后让出。
      await waitFor(['Sync pri: 1']);
      // 随后完成剩余工作。
      await waitForAll(['Normal pri: 1']);
    });
    expect(root).toMatchRenderedOutput('Sync pri: 1, Normal pri: 1');

    // 再重复一次，但让第一条更新发生饥饿。
    await act(async () => {
      React.startTransition(() => {
        updateNormalPri();
      });
      await waitFor(['Sync pri: 1']);

      // 此次 normal 更新开始渲染后已经过去很久；
      // 推进量必须明确大于
      // 检测 normal 优先级饥饿的
      // 启发式常量。
      Scheduler.unstable_advanceTime(10000);

      updateSyncPri();
      assertLog(['Sync pri: 2', 'Normal pri: 1']);

      // 剩余工作已经过期，因此 render 阶段不再
      // time slice；尝试只冲刷首个子节点也会完成全部。
      await waitFor(['Sync pri: 2'], {
        additionalLogsAfterAttemptingToYield: ['Normal pri: 2'],
      });
    });
    expect(root).toMatchRenderedOutput('Sync pri: 2, Normal pri: 2');
  });

  /** Given–When–Then：Given idle 更新两次被 sync 更新抢占；When第二次甚至推进 100000ms；Then两次都先提交 sync、后分片恢复 idle，idle lane 永不升级为 expired。通过相同日志结构验证 IdleLane 边界。 */
  it('idle work never expires', async () => {
    let updateSyncPri;
    let updateIdlePri;
    /** 同时维护 sync/idle 计数并暴露更新入口，验证 idle 即使长时间等待也不升级。 */
    function App() {
      const [syncPri, setSyncPri] = useState(0);
      const [highPri, setIdlePri] = useState(0);
      /** 同步增加计数，打断尚未完成的 idle render。 */
      updateSyncPri = () => ReactNoop.flushSync(() => setSyncPri(n => n + 1));
      /** 在 idleUpdates 上下文中增加计数，观察长时间等待仍不转为 expired。 */
      updateIdlePri = () =>
        ReactNoop.idleUpdates(() => {
          setIdlePri(n => n + 1);
        });
      return (
        <>
          <Text text={'Sync pri: ' + syncPri} />
          {', '}
          <Text text={'Idle pri: ' + highPri} />
        </>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });
    assertLog(['Sync pri: 0', 'Idle pri: 0']);
    expect(root).toMatchRenderedOutput('Sync pri: 0, Idle pri: 0');

    // 先演示没有饥饿时的分片行为。
    await act(async () => {
      updateIdlePri();
      await waitFor(['Sync pri: 0']);
      updateSyncPri();
    });
    // 行为应与未饥饿的 normal 对照相同。
    assertLog([
      // 中断 idle 更新，先渲染 sync 更新。
      'Sync pri: 1',
      'Idle pri: 0',
      // 随后恢复 idle 更新。
      'Sync pri: 1',
      'Idle pri: 1',
    ]);
    expect(root).toMatchRenderedOutput('Sync pri: 1, Idle pri: 1');

    // 再重复一次，但让第一条更新发生饥饿。
    await act(async () => {
      updateIdlePri();
      await waitFor(['Sync pri: 1']);

      // 推进极大的时间量，证明
      // idle 工作永不过期。
      Scheduler.unstable_advanceTime(100000);

      updateSyncPri();
    });
    assertLog([
      // 中断 idle 更新，先渲染 sync 更新。
      'Sync pri: 2',
      'Idle pri: 1',
      // 随后恢复 idle 更新。
      'Sync pri: 2',
      'Idle pri: 2',
    ]);
    expect(root).toMatchRenderedOutput('Sync pri: 2, Idle pri: 2');
  });

  /** Given–When–Then：Given不纠缠的 transition A 与 B 先后开始并同时过期；When先完成当前 A lane，再处理 B lane；Then第一次提交 A1B0，第二次才 A1B1。通过两轮无让出日志验证 expired lanes 仍按在途 render 集合隔离。 */
  it('when multiple lanes expire, we can finish the in-progress one without including the others', async () => {
    let setA;
    let setB;
    /** 暴露独立 a/b setter，并渲染 A/B/C 三个工作单元以分离两条 transition。 */
    function App() {
      const [a, _setA] = useState(0);
      const [b, _setB] = useState(0);
      setA = _setA;
      setB = _setB;
      return (
        <>
          <Text text={'A' + a} />
          <Text text={'B' + b} />
          <Text text="C" />
        </>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });
    assertLog(['A0', 'B0', 'C']);
    expect(root).toMatchRenderedOutput('A0B0C');

    await act(async () => {
      startTransition(() => {
        setA(1);
      });
      await waitFor(['A1']);
      startTransition(() => {
        setB(1);
      });
      await waitFor(['B0']);

      // 同时让两条 transition 过期。
      Scheduler.unstable_advanceTime(10000);
      // 两条 transition 虽都已过期，但它们没有
      // 纠缠关系，因此应只完成当前在途 transition，
      // 不夹带下一条。
      await waitFor([], {
        additionalLogsAfterAttemptingToYield: ['C'],
      });
      expect(root).toMatchRenderedOutput('A1B0C');

      // 下一条 transition 随后也无让出完成。
      await waitFor(['A1'], {
        additionalLogsAfterAttemptingToYield: ['B1', 'C'],
      });
      expect(root).toMatchRenderedOutput('A1B1C');
    });
  });

  /** Given–When–Then：Given transition 的 A1 因 thenable 挂起并等待 10 秒；When promise 解决后先恢复到 A1，再让 CPU 工作继续等待 10 秒；Then IO 等待不计入过期，恢复后的 CPU 饥饿才使 B/C 无让出完成。通过 Suspense 日志验证挂起等待期间不按 CPU 饥饿冲刷；恢复后的工作仍可按新过期窗口完成。 */
  it('updates do not expire while they are IO-bound', async () => {
    const {Suspense} = React;

    /** 在 Suspense 中组合可挂起 A 与同步 B/C，区分 IO 等待和恢复后的 CPU 工作。 */
    function App({step}) {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <AsyncText text={'A' + step} />
          <Text text="B" />
          <Text text="C" />
        </Suspense>
      );
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      await resolveText('A0');
      root.render(<App step={0} />);
    });
    assertLog(['A0', 'B', 'C']);
    expect(root).toMatchRenderedOutput('A0BC');

    await act(async () => {
      React.startTransition(() => {
        root.render(<App step={1} />);
      });
      await waitForAll([
        'Suspend! [A1]',
        // 预热主树中未挂起的兄弟。
        'B',
        'C',
        // 结束预热。
        'Loading...',
      ]);

      // promise 解决前经过很长 IO 等待。
      Scheduler.unstable_advanceTime(10000);
      await resolveText('A1');
      assertLog(['Promise resolved [A1]']);

      await waitFor(['A1']);
      expect(root).toMatchRenderedOutput('A0BC');

      // 恢复后又经过很长 CPU 时间，此时应按
      // 饥饿处理。
      Scheduler.unstable_advanceTime(10000);

      // 剩余更新不再让出并一次完成。
      await waitFor([], {
        additionalLogsAfterAttemptingToYield: ['B', 'C'],
      });
    });
  });

  /** Given–When–Then：Given transition A1 已开始并被推进到过期；When flushSync 单独提交 B1；Then同步提交仍使用旧 A0，而恢复原更新时 A1/B1 无让出完成。通过两轮日志验证 flushSync 不会清除或合并既有 expired lane。 */
  it('flushSync should not affect expired work', async () => {
    let setA;
    let setB;
    /** 暴露独立 A/B setter，分别承载已过期 transition 与插入的同步更新。 */
    function App() {
      const [a, _setA] = useState(0);
      const [b, _setB] = useState(0);
      setA = _setA;
      setB = _setB;
      return (
        <>
          <Text text={'A' + a} />
          <Text text={'B' + b} />
        </>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });
    assertLog(['A0', 'B0']);

    await act(async () => {
      startTransition(() => {
        setA(1);
      });
      await waitFor(['A1']);

      // 让正在进行的更新过期。
      Scheduler.unstable_advanceTime(10000);

      ReactNoop.flushSync(() => {
        setB(1);
      });
      assertLog(['A0', 'B1']);

      // 恢复原更新；它已经过期，
      // 因此应无让出完成。
      await waitFor(['A1'], {
        additionalLogsAfterAttemptingToYield: ['B1'],
      });
    });
  });

  /** Given–When–Then：Given step=1 transition 渲染 A 后被推进到过期；When无让出完成 B/C；Then宿主提交可同步完成，但 passive Effect 仍遵守 feature flag 对应的 paint 后边界。通过 gated 日志验证过期只改变 render slicing，不改变被动阶段语义。 */
  it('passive effects of expired update flush after paint', async () => {
    /** 按 step 渲染 A/B/C 并注册被动 effect，观察过期 render 与 passive flush 的边界。 */
    function App({step}) {
      useEffect(() => {
        Scheduler.log('Effect: ' + step);
      }, [step]);
      return (
        <>
          <Text text={'A' + step} />
          <Text text={'B' + step} />
          <Text text={'C' + step} />
        </>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App step={0} />);
    });
    assertLog(['A0', 'B0', 'C0', 'Effect: 0']);
    expect(root).toMatchRenderedOutput('A0B0C0');

    await act(async () => {
      startTransition(() => {
        root.render(<App step={1} />);
      });
      await waitFor(['A1']);

      // 让 transition 更新过期。
      Scheduler.unstable_advanceTime(10000);

      // 更新无让出完成，但不会因此提前冲刷被动 effect。
      await waitFor(['B1'], {
        additionalLogsAfterAttemptingToYield: gate(
          flags => flags.enableYieldingBeforePassive,
        )
          ? ['C1', 'Effect: 1']
          : ['C1'],
      });
    });
    if (!gate(flags => flags.enableYieldingBeforePassive)) {
      // 被动 effect 在 paint 后冲刷。
      assertLog(['Effect: 1']);
    }
  });
});
