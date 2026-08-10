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
let Suspense;
let useState;
let useLayoutEffect;
let useTransition;
let startTransition;
let act;
let getCacheForType;
let waitForAll;
let waitFor;
let waitForPaint;
let assertLog;

let caches;
let seededCache;

/** 覆盖 transition 的 pending 标记、队列纠缠、中断选择、缓存隔离与优先级顺序。 */
describe('ReactTransition', () => {
  /** 重建 Noop 渲染器并清空所有 cache 实例，为每个 lane 交错场景建立独立状态。 */
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    useState = React.useState;
    useLayoutEffect = React.useLayoutEffect;
    useTransition = React.useTransition;
    Suspense = React.Suspense;
    startTransition = React.startTransition;
    getCacheForType = React.unstable_getCacheForType;
    act = require('internal-test-utils').act;

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    waitFor = InternalTestUtils.waitFor;
    waitForPaint = InternalTestUtils.waitForPaint;
    assertLog = InternalTestUtils.assertLog;

    caches = [];
    seededCache = null;
  });

  /**
   * 为当前 React cache 生命周期创建带版本号的文本缓存。
   * 可消费一次 `seededCache` 以在初次 render 前预置数据；新缓存会登记进 `caches`，
   * 供测试按创建顺序完成或拒绝资源。
   */
  function createTextCache() {
    if (seededCache !== null) {
      // 在 cache 真正被请求前注入预置实例。
      // TODO：需要内建 API 支持初次 render 前播种数据；此时尚未挂载，不能称作 refresh。
      const cache = seededCache;
      seededCache = null;
      return cache;
    }

    const data = new Map();
    const version = caches.length + 1;
    const cache = {
      version,
      data,
      /** 将指定文本推进为 resolved，并唤醒该 cache 内的所有 retry ping。 */
      resolve(text) {
        const record = data.get(text);
        if (record === undefined) {
          const newRecord = {
            status: 'resolved',
            value: text,
          };
          data.set(text, newRecord);
        } else if (record.status === 'pending') {
          const thenable = record.value;
          record.status = 'resolved';
          record.value = text;
          thenable.pings.forEach(t => t());
        }
      },
      /** 将指定文本推进为 rejected，并唤醒订阅者以让 React 重新读取并抛错。 */
      reject(text, error) {
        const record = data.get(text);
        if (record === undefined) {
          const newRecord = {
            status: 'rejected',
            value: error,
          };
          data.set(text, newRecord);
        } else if (record.status === 'pending') {
          const thenable = record.value;
          record.status = 'rejected';
          record.value = error;
          thenable.pings.forEach(t => t());
        }
      },
    };
    caches.push(cache);
    return cache;
  }

  /**
   * 从当前 React cache 读取文本；返回 cache 版本以暴露 transition 是否复用了实例。
   * pending/rejected 分别记录并抛出 thenable/错误，首次读取建立共享 pending 记录。
   */
  function readText(text) {
    const textCache = getCacheForType(createTextCache);
    const record = textCache.data.get(text);
    if (record !== undefined) {
      switch (record.status) {
        case 'pending':
          Scheduler.log(`Suspend! [${text}]`);
          throw record.value;
        case 'rejected':
          Scheduler.log(`Error! [${text}]`);
          throw record.value;
        case 'resolved':
          return textCache.version;
      }
    } else {
      Scheduler.log(`Suspend! [${text}]`);

      const thenable = {
        pings: [],
        /** pending 时登记 retry；资源已完成时用微任务回放结果。 */
        then(resolve) {
          if (newRecord.status === 'pending') {
            thenable.pings.push(resolve);
          } else {
            Promise.resolve().then(() => resolve(newRecord.value));
          }
        },
      };

      const newRecord = {
        status: 'pending',
        value: thenable,
      };
      textCache.data.set(text, newRecord);

      throw thenable;
    }
  }

  /** 记录同步文本渲染并返回同名输出。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** 从 cache 读取可能挂起的文本，成功后记录并输出。 */
  function AsyncText({text}) {
    readText(text);
    Scheduler.log(text);
    return text;
  }

  /** 为下一次 `createTextCache` 预置一个已经 resolved 的文本。 */
  function seedNextTextCache(text) {
    if (seededCache === null) {
      seededCache = createTextCache();
    }
    seededCache.resolve(text);
  }

  /**
   * 完成最近创建 cache 中的文本；需要旧实例时由测试直接索引 `caches`。
   * 边界：尚无 cache 时抛出固定错误，避免把完成信号发送到不存在的生命周期。
   */
  function resolveText(text) {
    if (caches.length === 0) {
      throw Error('Cache does not exist.');
    } else {
      // 默认完成最新 cache；旧 cache 可通过 `caches[index].resolve(text)` 精确选择。
      caches[caches.length - 1].resolve(text);
    }
  }

  /**
   * 场景（Given–When–Then）：给定 `useTransition` 的 start 在输入事件外调用；当显示 Async 的
   * transition 挂起；那么先提交 Pending 与旧内容，资源完成后清除 pending 并显示 Async。
   * 对应机制：hook 的 pending 同步队列与 transition lane 不依赖事件上下文。
   */
  // @gate enableLegacyCache
  it('isPending works even if called from outside an input event', async () => {
    let start;
    /** 暴露 transition 启动器，并在 pending 期间保留旧内容。 */
    function App() {
      const [show, setShow] = useState(false);
      const [isPending, _start] = useTransition();
      start = () => _start(() => setShow(true));
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          {isPending ? <Text text="Pending..." /> : null}
          {show ? <AsyncText text="Async" /> : <Text text="(empty)" />}
        </Suspense>
      );
    }

    const root = ReactNoop.createRoot();

    await act(() => {
      root.render(<App />);
    });
    assertLog(['(empty)']);
    expect(root).toMatchRenderedOutput('(empty)');

    await act(async () => {
      start();

      await waitForAll([
        'Pending...',
        '(empty)',
        'Suspend! [Async]',
        'Loading...',
      ]);

      expect(root).toMatchRenderedOutput('Pending...(empty)');

      await resolveText('Async');
    });
    assertLog(['Async']);
    expect(root).toMatchRenderedOutput('Async');
  });

  /**
   * 场景（Given–When–Then）：给定 A/B 各自拥有 update queue 与独立 Suspense 边界；当两个
   * transition 先后挂起、B 再先完成；那么并行模式可先提交 B，传统模式因纠缠等 A 后整体提交。
   * 验证机制：逐次 resolve 后核对 pending 标记和两个边界的可见输出。
   */
  // @gate enableLegacyCache
  it('when multiple transitions update different queues, they entangle', async () => {
    let setA;
    let startTransitionA;
    let setB;
    let startTransitionB;
    /** 管理 A 的状态和 pending 标记，并读取版本化异步文本。 */
    function A() {
      const [a, _setA] = useState(0);
      const [isPending, _startTransitionA] = useTransition();
      setA = _setA;
      startTransitionA = _startTransitionA;

      return (
        <span>
          {isPending && (
            <span>
              <Text text="Pending A..." />
            </span>
          )}
          <AsyncText text={`A: ${a}`} />
        </span>
      );
    }

    /** 管理 B 的状态和 pending 标记，并读取版本化异步文本。 */
    function B() {
      const [b, _setB] = useState(0);
      const [isPending, _startTransitionB] = useTransition();
      setB = _setB;
      startTransitionB = _startTransitionB;

      return (
        <span>
          {isPending && (
            <span>
              <Text text="Pending B..." />
            </span>
          )}
          <AsyncText text={`B: ${b}`} />
        </span>
      );
    }
    /** 将 A/B 放在两个独立边界，以观察并行 transition 是否可独立提交。 */
    function App() {
      return (
        <>
          <Suspense fallback={<span>Loading A</span>}>
            <A />
          </Suspense>
          <Suspense fallback={<span>Loading B</span>}>
            <B />
          </Suspense>
        </>
      );
    }

    // 初次渲染，两个资源都挂起并显示各自 fallback。
    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });
    assertLog([
      'Suspend! [A: 0]',
      'Suspend! [B: 0]',
      'Suspend! [A: 0]',
      'Suspend! [B: 0]',
    ]);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Loading A</span>
        <span>Loading B</span>
      </>,
    );

    // 完成初始 A/B。
    await act(() => {
      resolveText('A: 0');
      resolveText('B: 0');
    });
    assertLog(['A: 0', 'B: 0']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>A: 0</span>
        <span>B: 0</span>
      </>,
    );

    // 启动 A 的 transition。
    await act(() => {
      startTransitionA(() => {
        setA(1);
      });
    });
    assertLog(['Pending A...', 'A: 0', 'Suspend! [A: 1]']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>
          <span>Pending A...</span>A: 0
        </span>
        <span>B: 0</span>
      </>,
    );

    // A 未完成时再启动 B 的 transition。
    await act(() => {
      startTransitionB(() => {
        setB(1);
      });
    });
    assertLog(['Pending B...', 'B: 0', 'Suspend! [A: 1]', 'Suspend! [B: 1]']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>
          <span>Pending A...</span>A: 0
        </span>
        <span>
          <span>Pending B...</span>B: 0
        </span>
      </>,
    );

    // 先完成 B，观察独立边界在不同模式下能否先提交。
    await act(() => {
      resolveText('B: 1');
    });
    assertLog(
      gate('enableParallelTransitions')
        ? ['B: 1', 'Suspend! [A: 1]']
        : ['Suspend! [A: 1]', 'B: 1'],
    );
    expect(root).toMatchRenderedOutput(
      gate('enableParallelTransitions') ? (
        <>
          <span>
            <span>Pending A...</span>A: 0
          </span>
          <span>B: 1</span>
        </>
      ) : (
        <>
          <span>
            <span>Pending A...</span>A: 0
          </span>
          <span>
            <span>Pending B...</span>B: 0
          </span>
        </>
      ),
    );

    // 完成 A，使全部 transition 收敛。
    await act(() => {
      resolveText('A: 1');
    });
    assertLog(gate('enableParallelTransitions') ? ['A: 1'] : ['A: 1', 'B: 1']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>A: 1</span>
        <span>B: 1</span>
      </>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定 A/B 虽有不同 update queue、却共享同一 Suspense 边界；
   * 当 B 先完成而 A 仍挂起；那么边界层面仍受 A 阻塞，最终 A 完成后两者一致提交。
   * 对应机制：共享边界的 retry/可见性约束叠加 transition 纠缠。
   */
  // @gate enableLegacyCache
  it('when multiple transitions update different queues, but suspend the same boundary, they do entangle', async () => {
    let setA;
    let startTransitionA;
    let setB;
    let startTransitionB;
    /** 管理共享边界中 A 的状态与 pending 标记。 */
    function A() {
      const [a, _setA] = useState(0);
      const [isPending, _startTransitionA] = useTransition();
      setA = _setA;
      startTransitionA = _startTransitionA;

      return (
        <span>
          {isPending && (
            <span>
              <Text text="Pending A..." />
            </span>
          )}
          <AsyncText text={`A: ${a}`} />
        </span>
      );
    }

    /** 管理共享边界中 B 的状态与 pending 标记。 */
    function B() {
      const [b, _setB] = useState(0);
      const [isPending, _startTransitionB] = useTransition();
      setB = _setB;
      startTransitionB = _startTransitionB;

      return (
        <span>
          {isPending && (
            <span>
              <Text text="Pending B..." />
            </span>
          )}
          <AsyncText text={`B: ${b}`} />
        </span>
      );
    }
    /** 将 A/B 放入同一 Suspense 边界以施加共同提交门槛。 */
    function App() {
      return (
        <Suspense fallback={<span>Loading...</span>}>
          <A />
          <B />
        </Suspense>
      );
    }

    // 初次渲染，A 首先挂起，随后后台预热 A/B。
    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });
    assertLog([
      'Suspend! [A: 0]',
      // 后台预热共享边界。
      'Suspend! [A: 0]',
      'Suspend! [B: 0]',
    ]);
    expect(root).toMatchRenderedOutput(<span>Loading...</span>);

    // 完成初始 A/B。
    await act(() => {
      resolveText('A: 0');
      resolveText('B: 0');
    });
    assertLog(['A: 0', 'B: 0']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>A: 0</span>
        <span>B: 0</span>
      </>,
    );

    // 启动 A 的 transition。
    await act(() => {
      startTransitionA(() => {
        setA(1);
      });
    });
    assertLog(['Pending A...', 'A: 0', 'Suspend! [A: 1]']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>
          <span>Pending A...</span>A: 0
        </span>
        <span>B: 0</span>
      </>,
    );

    // A 未完成时再启动 B 的 transition。
    await act(() => {
      startTransitionB(() => {
        setB(1);
      });
    });
    assertLog(['Pending B...', 'B: 0', 'Suspend! [A: 1]', 'Suspend! [B: 1]']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>
          <span>Pending A...</span>A: 0
        </span>
        <span>
          <span>Pending B...</span>B: 0
        </span>
      </>,
    );

    // 先完成 B，但共享边界仍受 A 阻塞。
    await act(() => {
      resolveText('B: 1');
    });
    assertLog(
      gate('enableParallelTransitions')
        ? ['B: 1', 'Suspend! [A: 1]']
        : ['Suspend! [A: 1]', 'B: 1'],
    );
    expect(root).toMatchRenderedOutput(
      gate('enableParallelTransitions') ? (
        <>
          <span>
            <span>Pending A...</span>A: 0
          </span>
          <span>B: 1</span>
        </>
      ) : (
        <>
          <span>
            <span>Pending A...</span>A: 0
          </span>
          <span>
            <span>Pending B...</span>B: 0
          </span>
        </>
      ),
    );

    // 完成 A，使共享边界整体收敛。
    await act(() => {
      resolveText('A: 1');
    });
    assertLog(gate('enableParallelTransitions') ? ['A: 1'] : ['A: 1', 'B: 1']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>A: 1</span>
        <span>B: 1</span>
      </>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定同一 hooks update queue 连续 transition 到 B、C，且两者均挂起；
   * 当旧 B 先完成；那么不得提交中间 B，仍保持 pending，直到终端 C 完成后直接 A→C。
   * 对应机制：同一队列的 transition lanes 纠缠，提交必须包含最新状态。
   */
  // @gate enableLegacyCache
  it(
    'when multiple transitions update the same queue, only the most recent ' +
      'one is allowed to finish (no intermediate states)',
    async () => {
      let update;
      /** 用紧急 label 与 transition contents 两个状态展示 pending 旧内容和最新目标。 */
      function App() {
        const [isContentPending, startContentChange] = useTransition();
        const [label, setLabel] = useState('A');
        const [contents, setContents] = useState('A');
        update = value => {
          ReactNoop.discreteUpdates(() => {
            setLabel(value);
            startContentChange(() => {
              setContents(value);
            });
          });
        };
        return (
          <>
            <Text
              text={
                label + ' label' + (isContentPending ? ' (loading...)' : '')
              }
            />
            <div>
              <Suspense fallback={<Text text="Loading..." />}>
                <AsyncText text={contents + ' content'} />
              </Suspense>
            </div>
          </>
        );
      }

      // 初次渲染预置 A content。
      const root = ReactNoop.createRoot();
      await act(() => {
        seedNextTextCache('A content');
        root.render(<App />);
      });
      assertLog(['A label', 'A content']);
      expect(root).toMatchRenderedOutput(
        <>
          A label<div>A content</div>
        </>,
      );

      // 切换到 B。
      await act(() => {
        update('B');
      });
      assertLog([
        // 先提交 pending 状态。
        'B label (loading...)',
        'A content',

        // 尝试渲染 B，但资源挂起。
        'B label',
        'Suspend! [B content]',
        'Loading...',
      ]);
      // 这是 refresh transition，应保留旧内容而非显示 fallback。
      expect(root).toMatchRenderedOutput(
        <>
          B label (loading...)<div>A content</div>
        </>,
      );

      // B 尚未完成时切换到 C。
      await act(() => {
        update('C');
      });
      assertLog([
        // 先提交新的 pending 状态。
        'C label (loading...)',
        'A content',

        // 尝试渲染 C，但资源挂起。
        'C label',
        'Suspend! [C content]',
        'Loading...',
      ]);
      expect(root).toMatchRenderedOutput(
        <>
          C label (loading...)<div>A content</div>
        </>,
      );

      // B 完成但与 C 纠缠，不能提交过期 B，仍保持 pending。
      await act(() => {
        resolveText('B content');
      });
      assertLog([
        // 重试最新 C，但它仍挂起。
        'C label',
        'Suspend! [C content]',
        'Loading...',
      ]);
      expect(root).toMatchRenderedOutput(
        <>
          C label (loading...)<div>A content</div>
        </>,
      );

      // 完成终端更新 C，此时允许提交。
      await act(() => {
        resolveText('C content');
      });
      assertLog(['C label', 'C content']);
      expect(root).toMatchRenderedOutput(
        <>
          C label<div>C content</div>
        </>,
      );
    },
  );

  /**
   * 场景（Given–When–Then）：给定类组件同一 update queue 连续 transition 到 B、C；当 B 先完成；
   * 那么仍跳过中间 B，C 完成后才提交最新状态。对应机制：类 update queue 的 lane 纠缠
   * 与 hooks 队列保持一致。
   */
  // 与上一用例相同，但目标换为类组件 update queue。
  // @gate enableLegacyCache
  it(
    'when multiple transitions update the same queue, only the most recent ' +
      'one is allowed to finish (no intermediate states) (classes)',
    async () => {
      let update;
      /** 用类 state 保存紧急 label 和 transition contents。 */
      class App extends React.Component {
        /** 当前标签与内容目标；二者不等即代表 transition pending。 */
        state = {
          label: 'A',
          contents: 'A',
        };
        /** 暴露离散+transition 组合更新器，并渲染 pending 标签与异步内容。 */
        render() {
          update = value => {
            ReactNoop.discreteUpdates(() => {
              this.setState({label: value});
              startTransition(() => {
                this.setState({contents: value});
              });
            });
          };
          const label = this.state.label;
          const contents = this.state.contents;
          const isContentPending = label !== contents;
          return (
            <>
              <Text
                text={
                  label + ' label' + (isContentPending ? ' (loading...)' : '')
                }
              />
              <div>
                <Suspense fallback={<Text text="Loading..." />}>
                  <AsyncText text={contents + ' content'} />
                </Suspense>
              </div>
            </>
          );
        }
      }

      // 初次渲染预置 A content。
      const root = ReactNoop.createRoot();
      await act(() => {
        seedNextTextCache('A content');
        root.render(<App />);
      });
      assertLog(['A label', 'A content']);
      expect(root).toMatchRenderedOutput(
        <>
          A label<div>A content</div>
        </>,
      );

      // 切换到 B。
      await act(() => {
        update('B');
      });
      assertLog([
        // 先提交 pending 状态。
        'B label (loading...)',
        'A content',

        // 尝试渲染 B，但资源挂起。
        'B label',
        'Suspend! [B content]',
        'Loading...',
      ]);
      // 这是 refresh transition，应保留旧内容而非显示 fallback。
      expect(root).toMatchRenderedOutput(
        <>
          B label (loading...)<div>A content</div>
        </>,
      );

      // B 尚未完成时切换到 C。
      await act(() => {
        update('C');
      });
      assertLog([
        // 先提交新的 pending 状态。
        'C label (loading...)',
        'A content',

        // 尝试渲染 C，但资源挂起。
        'C label',
        'Suspend! [C content]',
        'Loading...',
      ]);
      expect(root).toMatchRenderedOutput(
        <>
          C label (loading...)<div>A content</div>
        </>,
      );

      // B 完成但与 C 纠缠，不能提交过期 B，仍保持 pending。
      await act(() => {
        resolveText('B content');
      });
      assertLog([
        // 重试最新 C，但它仍挂起。
        'C label',
        'Suspend! [C content]',
        'Loading...',
      ]);
      expect(root).toMatchRenderedOutput(
        <>
          C label (loading...)<div>A content</div>
        </>,
      );

      // 完成终端更新 C，此时允许提交。
      await act(() => {
        resolveText('C content');
      });
      assertLog(['C label', 'C content']);
      expect(root).toMatchRenderedOutput(
        <>
          C label<div>C content</div>
        </>,
      );
    },
  );

  /**
   * 场景（Given–When–Then）：给定 A→B 与 B→C 两次 transition 更新分别重叠不同状态队列；
   * 当 A/B 资源乱序完成；那么纠缠沿重叠队列传递，只有最新可见 C 完成后才提交。
   * 对应机制：transition lane 的传递闭包避免互斥 UI 出现中间组合。
   */
  // @gate enableLegacyCache
  it(
    'when multiple transitions update overlapping queues, all the transitions ' +
      'across all the queues are entangled',
    async () => {
      let setShowA;
      let setShowB;
      let setShowC;
      /** 用三个独立布尔队列建模同一时刻只应显示 A/B/C 之一的界面。 */
      function App() {
        const [showA, _setShowA] = useState(false);
        const [showB, _setShowB] = useState(false);
        const [showC, _setShowC] = useState(false);
        setShowA = _setShowA;
        setShowB = _setShowB;
        setShowC = _setShowC;

        // 三个子项理论上同时只显示一个，却由三个同时更新的独立状态建模。这类间接结构常见于
        // 单实例 tooltip 管理器或高亮当前路由的 router，并非纯人为构造。
        return (
          <>
            <Suspense fallback={<Text text="Loading..." />}>
              {showA ? <AsyncText text="A" /> : null}
              {showB ? <AsyncText text="B" /> : null}
              {showC ? <AsyncText text="C" /> : null}
            </Suspense>
          </>
        );
      }

      // 初次渲染，全部子项隐藏。
      const root = ReactNoop.createRoot();
      await act(() => {
        root.render(<App />);
      });
      assertLog([]);
      expect(root).toMatchRenderedOutput(null);

      // 切换到 A。
      await act(() => {
        startTransition(() => {
          setShowA(true);
        });
      });
      assertLog(['Suspend! [A]', 'Loading...']);
      expect(root).toMatchRenderedOutput(null);

      // A 未完成前切到 B，使 A/B 纠缠。
      await act(() => {
        startTransition(() => {
          setShowA(false);
          setShowB(true);
        });
      });
      assertLog(['Suspend! [B]', 'Loading...']);
      expect(root).toMatchRenderedOutput(null);

      // A/B 均未完成时切到 C；C 与 B 纠缠，并传递地与 A 纠缠。
      await act(() => {
        startTransition(() => {
          setShowB(false);
          setShowC(true);
        });
      });
      assertLog(['Suspend! [C]', 'Loading...']);
      expect(root).toMatchRenderedOutput(null);

      // 接下来让数据乱序完成。

      // 先完成 B；因全部纠缠，只会重试最新 C。
      await act(() => {
        startTransition(() => {
          resolveText('B');
        });
      });
      assertLog(['Suspend! [C]', 'Loading...']);
      expect(root).toMatchRenderedOutput(null);

      // 再完成 A；仍因纠缠重试最新 C。
      await act(() => {
        startTransition(() => {
          resolveText('A');
        });
      });
      assertLog(['Suspend! [C]', 'Loading...']);
      expect(root).toMatchRenderedOutput(null);

      // 最后完成 C，此时可以提交。
      await act(() => {
        startTransition(() => {
          resolveText('C');
        });
      });
      assertLog(['C']);
      expect(root).toMatchRenderedOutput('C');
    },
  );

  /**
   * 场景（Given–When–Then）：给定 refresh transition 已在 Async 挂起并部分渲染；当新 transition
   * 更新根为 Updated；那么立即放弃注定挂起的旧工作并提交新树。
   * 对应机制：发现较新 transition lane 后中断 suspended refresh work-in-progress。
   */
  // @gate enableLegacyCache
  it('interrupt a refresh transition if a new transition is scheduled', async () => {
    const root = ReactNoop.createRoot();

    await act(() => {
      root.render(
        <>
          <Suspense fallback={<Text text="Loading..." />} />
          <Text text="Initial" />
        </>,
      );
    });
    assertLog(['Initial']);
    expect(root).toMatchRenderedOutput('Initial');

    await act(async () => {
      // 启动 refresh transition。
      startTransition(() => {
        root.render(
          <>
            <Suspense fallback={<Text text="Loading..." />}>
              <AsyncText text="Async" />
            </Suspense>
            <Text text="After Suspense" />
            <Text text="Sibling" />
          </>,
        );
      });

      // 只部分渲染旧 transition。
      await waitFor([
        // 边界已经挂载，所以更新一旦挂起即可确认这是 refresh transition。
        'Suspend! [Async]',
        'Loading...',
        'After Suspense',
      ]);

      // 安排新的 transition。
      startTransition(async () => {
        root.render(
          <>
            <Suspense fallback={<Text text="Loading..." />} />
            <Text text="Updated" />
          </>,
        );
      });
    });

    // 第一条 transition 已确定会挂起，应立即切换到新 transition。
    assertLog(['Updated']);
    expect(root).toMatchRenderedOutput('Updated');
  });

  /**
   * 场景（Given–When–Then）：给定父队列已处理、其中跳过一个较新 transition 更新，旧 refresh
   * 随后在子边界挂起；当工作循环下次进入；那么丢弃旧工作并应用父级新更新。
   * 对应机制：父 Fiber 的 skipped lanes 标记使 suspended refresh 在时间片边界被中断。
   */
  // @gate enableLegacyCache
  it(
    "interrupt a refresh transition when something suspends and we've " +
      'already bailed out on another transition in a parent',
    async () => {
      let setShouldSuspend;

      /** 控制是否以空文本替换 children，并记录父队列实际采用的状态。 */
      function Parent({children}) {
        const [shouldHideInParent, _setShouldHideInParent] = useState(false);
        setShouldHideInParent = _setShouldHideInParent;
        Scheduler.log('shouldHideInParent: ' + shouldHideInParent);
        if (shouldHideInParent) {
          return <Text text="(empty)" />;
        }
        return children;
      }

      let setShouldHideInParent;
      /** 组合可挂起子边界与可 bailout 的父组件，暴露两条 transition 更新器。 */
      function App() {
        const [shouldSuspend, _setShouldSuspend] = useState(false);
        setShouldSuspend = _setShouldSuspend;
        return (
          <>
            <Text text="A" />
            <Parent>
              <Suspense fallback={<Text text="Loading..." />}>
                {shouldSuspend ? <AsyncText text="Async" /> : null}
              </Suspense>
            </Parent>
            <Text text="B" />
            <Text text="C" />
          </>
        );
      }

      const root = ReactNoop.createRoot();

      await act(async () => {
        root.render(<App />);
        await waitForAll(['A', 'shouldHideInParent: false', 'B', 'C']);
        expect(root).toMatchRenderedOutput('ABC');

        // 安排第一条会挂起的 transition。
        startTransition(() => {
          setShouldSuspend(true);
        });

        // 为让第二条 transition 落到不同 lane，先把第一条部分渲染到进行中状态。
        await waitFor(['A']);

        // 安排第二条 transition；此刻不会立即中断第一条。
        React.startTransition(() => {
          setShouldHideInParent(true);
        });
        // 继续渲染第一条 transition。
        await waitFor([
          'shouldHideInParent: false',
          'Suspend! [Async]',
          'Loading...',
          'B',
        ]);
        // 不应提交 loading 状态。
        expect(root).toMatchRenderedOutput('ABC');

        // 父队列已经处理并记录了本轮跳过的第二条更新；同时子边界渲染过 loading，说明第一条
        // 是 refresh transition。下个时间片重入工作循环时应丢弃已挂起的第一条并尝试第二条。
        await waitForPaint(['shouldHideInParent: true', '(empty)']);
        expect(root).toMatchRenderedOutput('A(empty)BC');

        // 两条 transition 未纠缠，之后仍会回头重试第一条；这里顺带固定最终结果。
        await waitForAll([
          'A',
          'shouldHideInParent: true',
          '(empty)',
          'B',
          'C',
        ]);
        expect(root).toMatchRenderedOutput('A(empty)BC');
      });
    },
  );

  /**
   * 场景（Given–When–Then）：给定旧 refresh 已越过根 begin phase，随后根收到交错的新 transition；
   * 当旧工作在 Async 挂起；那么本时间片结束前放弃旧剩余 C1，并切换提交完整 A2/B2/C2。
   * 对应机制：已完成 beginWork 的父 Fiber 接收 interleaved update 后触发根级中断。
   */
  // @gate enableLegacyCache
  it(
    'interrupt a refresh transition when something suspends and a parent ' +
      'component received an interleaved update after its queue was processed',
    async () => {
      // 与上一场景不同：父级不是在队列中跳过更新，而是在 begin phase 完成后才收到交错更新。

      /** 用 step 标记整棵根树版本，并可选择在中间 Suspense 处挂起。 */
      function App({shouldSuspend, step}) {
        return (
          <>
            <Text text={`A${step}`} />
            <Suspense fallback={<Text text="Loading..." />}>
              {shouldSuspend ? <AsyncText text="Async" /> : null}
            </Suspense>
            <Text text={`B${step}`} />
            <Text text={`C${step}`} />
          </>
        );
      }

      const root = ReactNoop.createRoot();

      await act(() => {
        root.render(<App shouldSuspend={false} step={0} />);
      });
      assertLog(['A0', 'B0', 'C0']);
      expect(root).toMatchRenderedOutput('A0B0C0');

      await act(async () => {
        // 第一条更新会在 Async 挂起。
        startTransition(() => {
          root.render(<App shouldSuspend={true} step={1} />);
        });
        // 越过根 begin phase，但停在异步组件之前。
        await waitFor(['A1']);

        // 在已经完成 begin phase 的根上安排第二条 transition。
        startTransition(() => {
          root.render(<App shouldSuspend={false} step={2} />);
        });
        // 当前时间片暂时继续第一条更新。
        await waitFor([
          // 此时异步组件挂起。
          'Suspend! [Async]',
          'Loading...',
          'B1',
        ]);
        // 不应提交 loading 状态。
        expect(root).toMatchRenderedOutput('A0B0C0');

        // 挂起后应中止第一条并切换第二条，因此日志不出现 C1。
        // TODO：即使 React 不向主线程让出也应生效，可复用 selective hydration 的机制，
        // 在当前工作时间片结束前中断 render。
        await waitForAll(['A2', 'B2', 'C2']);

        expect(root).toMatchRenderedOutput('A2B2C2');
      });
    },
  );

  /**
   * 场景（Given–When–Then）：给定先安排 transition 更新、随后安排 normal 更新；当批次刷新；
   * 那么 normal 先以旧 transition 值提交，transition 再追上并二次提交。
   * 验证机制：layout effect 的 Commit 日志划分两个提交边界。
   */
  it('should render normal pri updates scheduled after transitions before transitions', async () => {
    let updateTransitionPri;
    let updateNormalPri;
    /** 暴露 normal/transition 两种更新器，并在每次提交记录布局副作用。 */
    function App() {
      const [normalPri, setNormalPri] = useState(0);
      const [transitionPri, setTransitionPri] = useState(0);
      updateTransitionPri = () =>
        startTransition(() => setTransitionPri(n => n + 1));
      updateNormalPri = () => setNormalPri(n => n + 1);

      useLayoutEffect(() => {
        Scheduler.log('Commit');
      });

      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <Text text={'Transition pri: ' + transitionPri} />
          {', '}
          <Text text={'Normal pri: ' + normalPri} />
        </Suspense>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });

    // 初次渲染。
    assertLog(['Transition pri: 0', 'Normal pri: 0', 'Commit']);
    expect(root).toMatchRenderedOutput('Transition pri: 0, Normal pri: 0');

    await act(() => {
      updateTransitionPri();
      updateNormalPri();
    });

    assertLog([
      // normal 更新先提交。
      'Transition pri: 0',
      'Normal pri: 1',
      'Commit',

      // transition 更新随后提交。
      'Transition pri: 1',
      'Normal pri: 1',
      'Commit',
    ]);
    expect(root).toMatchRenderedOutput('Transition pri: 1, Normal pri: 1');
  });

  /**
   * 场景（Given–When–Then）：给定 transition 因 Async 挂起并等待 retry，同时安排 normal 更新；
   * 当 Async 完成；那么 normal 更新先提交旧内容，随后 Suspense retry 提交 Async。
   * 对应机制：Default lane 优先于已 ping 的 transition retry lane。
   */
  // @gate enableLegacyCache
  it('should render normal pri updates before transition suspense retries', async () => {
    let updateTransitionPri;
    let updateNormalPri;
    /** 暴露挂起 transition 和 normal 计数更新器，并记录每次 commit。 */
    function App() {
      const [transitionPri, setTransitionPri] = useState(false);
      const [normalPri, setNormalPri] = useState(0);

      updateTransitionPri = () => startTransition(() => setTransitionPri(true));
      updateNormalPri = () => setNormalPri(n => n + 1);

      useLayoutEffect(() => {
        Scheduler.log('Commit');
      });

      return (
        <Suspense fallback={<Text text="Loading..." />}>
          {transitionPri ? <AsyncText text="Async" /> : <Text text="(empty)" />}
          {', '}
          <Text text={'Normal pri: ' + normalPri} />
        </Suspense>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });

    // 初次渲染。
    assertLog(['(empty)', 'Normal pri: 0', 'Commit']);
    expect(root).toMatchRenderedOutput('(empty), Normal pri: 0');

    await act(() => {
      updateTransitionPri();
    });

    assertLog([
      // transition 挂起。
      'Suspend! [Async]',
      // 后台预热主树。
      'Normal pri: 0',
      // 结束后台预热。
      'Loading...',
    ]);
    expect(root).toMatchRenderedOutput('(empty), Normal pri: 0');

    await act(async () => {
      await resolveText('Async');
      updateNormalPri();
    });

    assertLog([
      // normal 优先级更新先提交。
      '(empty)',
      'Normal pri: 1',
      'Commit',

      // Promise 完成后刷新 retry。
      'Async',
      'Normal pri: 1',
      'Commit',
    ]);
    expect(root).toMatchRenderedOutput('Async, Normal pri: 1');
  });

  /**
   * 场景（Given–When–Then）：给定 transition render 已开始但未提交；当中途安排 normal 更新；
   * 那么不抛弃 transition 的已完成工作，先完成其提交，再处理 normal 更新。
   * 对应机制：未挂起 transition 不因普通优先级更新而被同步中断。
   */
  it('should not interrupt transitions with normal pri updates', async () => {
    let updateNormalPri;
    let updateTransitionPri;
    /** 暴露两种优先级更新器，并用 commit 日志区分工作是否被重启。 */
    function App() {
      const [transitionPri, setTransitionPri] = useState(0);
      const [normalPri, setNormalPri] = useState(0);
      updateTransitionPri = () =>
        startTransition(() => setTransitionPri(n => n + 1));
      updateNormalPri = () => setNormalPri(n => n + 1);

      useLayoutEffect(() => {
        Scheduler.log('Commit');
      });
      return (
        <>
          <Text text={'Transition pri: ' + transitionPri} />
          {', '}
          <Text text={'Normal pri: ' + normalPri} />
        </>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });
    assertLog(['Transition pri: 0', 'Normal pri: 0', 'Commit']);
    expect(root).toMatchRenderedOutput('Transition pri: 0, Normal pri: 0');

    await act(async () => {
      updateTransitionPri();

      await waitFor([
        // transition 更新开始渲染。
        'Transition pri: 1',
      ]);

      // transition render 期间安排 normal 更新；不应中断当前工作。
      updateNormalPri();
    });

    assertLog([
      'Normal pri: 0',
      'Commit',

      // 随后提交 normal 更新。
      'Transition pri: 1',
      'Normal pri: 1',
      'Commit',
    ]);

    expect(root).toMatchRenderedOutput('Transition pri: 1, Normal pri: 1');
  });

  /**
   * 场景（Given–When–Then）：给定两个嵌套 `startTransition` 分别来自不同 `useTransition`；
   * 当内层更新状态；那么 A/B pending 同时变 true，并在状态 1 提交时同时复位 false。
   * 对应机制：嵌套作用域各自维护 hook pending 队列，但共享 transition 完成边界。
   */
  it('tracks two pending flags for nested startTransition (#26226)', async () => {
    let update;
    /** 嵌套启动 A/B transition，并同时输出状态与两个 pending 标记。 */
    function App() {
      const [isPendingA, startTransitionA] = useTransition();
      const [isPendingB, startTransitionB] = useTransition();
      const [state, setState] = useState(0);

      update = function () {
        startTransitionA(() => {
          startTransitionB(() => {
            setState(1);
          });
        });
      };

      return (
        <>
          <Text text={state} />
          {', '}
          <Text text={'A ' + isPendingA} />
          {', '}
          <Text text={'B ' + isPendingB} />
        </>
      );
    }
    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<App />);
    });
    assertLog([0, 'A false', 'B false']);
    expect(root).toMatchRenderedOutput('0, A false, B false');

    await act(async () => {
      update();
    });
    assertLog([0, 'A true', 'B true', 1, 'A false', 'B false']);
    expect(root).toMatchRenderedOutput('1, A false, B false');
  });
});
