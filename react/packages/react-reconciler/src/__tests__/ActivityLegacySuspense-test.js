let React;
let ReactNoop;
let Scheduler;
let act;
let LegacyHidden;
let Activity;
let Suspense;
let useState;
let useEffect;
let startTransition;
let textCache;
let waitFor;
let waitForPaint;
let assertLog;

/** 对比 Activity 与 LegacyHidden 的 Suspense 隔离，并验证隐藏树在优先级、揭示和并发事件下的更新队列。 */
describe('Activity Suspense', () => {
  /** 每例重置 renderer、Hooks 引用与可控文本 cache，清除所有 pending thenable/ping。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    LegacyHidden = React.unstable_LegacyHidden;
    Activity = React.Activity;
    Suspense = React.Suspense;
    useState = React.useState;
    useEffect = React.useEffect;
    startTransition = React.startTransition;

    const InternalTestUtils = require('internal-test-utils');
    waitFor = InternalTestUtils.waitFor;
    waitForPaint = InternalTestUtils.waitForPaint;
    assertLog = InternalTestUtils.assertLog;

    textCache = new Map();
  });

  /** 将指定文本记录创建或转为 resolved，并唤醒等待该记录的全部 Suspense ping。 */
  function resolveText(text) {
    const record = textCache.get(text);
    if (record === undefined) {
      const newRecord = {
        status: 'resolved',
        value: text,
      };
      textCache.set(text, newRecord);
    } else if (record.status === 'pending') {
      const thenable = record.value;
      record.status = 'resolved';
      record.value = text;
      thenable.pings.forEach(t => t());
    }
  }

  /** 读取可控文本：resolved 返回值，rejected 抛错，pending 或缺失时抛 thenable 挂起。 */
  function readText(text) {
    const record = textCache.get(text);
    if (record !== undefined) {
      switch (record.status) {
        case 'pending':
          Scheduler.log(`Suspend! [${text}]`);
          throw record.value;
        case 'rejected':
          throw record.value;
        case 'resolved':
          return record.value;
      }
    } else {
      Scheduler.log(`Suspend! [${text}]`);
      const thenable = {
        pings: [],
        /** pending 时登记 ping；已结算时用 microtask 异步通知，保持 thenable 行为。 */
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
      textCache.set(text, newRecord);

      throw thenable;
    }
  }

  /** 记录并同步输出文本，作为可见内容、fallback 与阶段标记。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** 先读取可能挂起的 cache，再记录并输出成功文本。 */
  function AsyncText({text}) {
    readText(text);
    Scheduler.log(text);
    return text;
  }

  /**
   * Given 外层 Suspense 内同时有可见文本和 hidden Activity 异步子树；When 隐藏子树挂起再 resolve；
   * Then 外层不显示 fallback，可见内容立即提交，隐藏内容随后完成预渲染。
   * 验证机制：Scheduler 日志与 Noop hidden 输出；对应 Activity 隐藏捕获和 Suspense ping。
   */
  it('basic example of suspending inside hidden tree', async () => {
    const root = ReactNoop.createRoot();

    /** 组合可见同步内容与 hidden Activity 内异步内容，共享一个外层 Suspense。 */
    function App() {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <span>
            <Text text="Visible" />
          </span>
          <Activity mode="hidden">
            <span>
              <AsyncText text="Hidden" />
            </span>
          </Activity>
        </Suspense>
      );
    }

    // hidden 子树尚未加载完成，但周围内容仍可显示；外层 Suspense 不受影响。
    await act(() => {
      root.render(<App />);
    });
    assertLog(['Visible', 'Suspend! [Hidden]']);
    expect(root).toMatchRenderedOutput(<span>Visible</span>);

    // 数据 resolve 后完成 hidden 子树预渲染。
    await act(async () => {
      await resolveText('Hidden');
    });
    assertLog(['Hidden']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Visible</span>
        <span hidden={true}>Hidden</span>
      </>,
    );
  });

  /**
   * Given 相同结构改用 LegacyHidden；When 隐藏子树挂起；Then LegacyHidden 不捕获，最近 Suspense 切换 fallback。
   * 验证 Activity 与旧实现的关键语义差异；对应 LegacyHidden/Offscreen beginWork 分支。
   */
  // @gate enableLegacyHidden
  test('LegacyHidden does not handle suspense', async () => {
    const root = ReactNoop.createRoot();

    /** 用 LegacyHidden 替代 Activity 的对照树。 */
    function App() {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <span>
            <Text text="Visible" />
          </span>
          <LegacyHidden mode="hidden">
            <span>
              <AsyncText text="Hidden" />
            </span>
          </LegacyHidden>
        </Suspense>
      );
    }

    // 与 Activity 不同，LegacyHidden 从不捕获内部挂起。
    await act(() => {
      root.render(<App />);
    });
    assertLog(['Visible', 'Suspend! [Hidden]', 'Loading...']);
    // 即使挂起内容隐藏，最近 Suspense 仍会切换到 fallback。
    expect(root).toMatchRenderedOutput(
      <>
        <span hidden={true}>Visible</span>
        Loading...
      </>,
    );
  });

  /**
   * Given public act 下 visible Activity 的内容先挂起后完成；When 切换 hidden 导致 effect 清 cache 并再次挂起；
   * Then 更新收敛为空 hidden 输出，不进入反复清理/重试的无限循环。
   * 验证机制：清理与挂起日志；对应 Activity 隐藏 effect 卸载及 Suspense retry。
   */
  // @gate __DEV__
  test('Regression: Suspending on hide should not infinite loop.', async () => {
    // 此回归只会在公开 React.act 中复现。
    global.IS_REACT_ACT_ENVIRONMENT = true;
    const root = ReactNoop.createRoot();

    let setMode;
    /** 管理 Activity mode；effect 清理会删除 cache，故隐藏时可重新触发挂起。 */
    function Container({text}) {
      const [mode, _setMode] = React.useState('visible');
      setMode = _setMode;
      useEffect(() => {
        return () => {
          Scheduler.log(`Clear [${text}]`);
          textCache.delete(text);
        };
      });
      return (
        //$FlowFixMe
        <Suspense fallback="Loading">
          <Activity mode={mode}>
            <AsyncText text={text} />
          </Activity>
        </Suspense>
      );
    }

    await React.act(() => {
      root.render(<Container text="hello" />);
    });
    assertLog([
      'Suspend! [hello]',
      // Suspense 预热 render。
      'Suspend! [hello]',
    ]);
    expect(root).toMatchRenderedOutput('Loading');

    await React.act(async () => {
      await resolveText('hello');
    });
    assertLog(['hello']);
    expect(root).toMatchRenderedOutput('hello');

    await React.act(async () => {
      setMode('hidden');
    });
    assertLog(['Clear [hello]', 'Suspend! [hello]']);
    expect(root).toMatchRenderedOutput('');
  });

  /**
   * Given hidden Activity 的异步 child 尚未完成；When Transition 把边界切到 visible；
   * Then 挂起冒泡到 Suspense，但保留已显示的 Closed 屏直到数据就绪，再提交 Open+Async。
   * 验证机制：阶段日志和旧屏输出；对应 Activity 揭示、Suspense 延迟 fallback 与 retry。
   */
  test("suspending inside currently hidden tree that's switching to visible", async () => {
    const root = ReactNoop.createRoot();

    /** 用 open 同时控制可见标签和 Activity mode，形成 hidden→visible 过渡。 */
    function Details({open, children}) {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <span>
            <Text text={open ? 'Open' : 'Closed'} />
          </span>
          <Activity mode={open ? 'visible' : 'hidden'}>
            <span>{children}</span>
          </Activity>
        </Suspense>
      );
    }

    // hidden 子树未加载完成仍不阻塞周围内容；未完成内容不可见，因此无需由 Suspense 展示 fallback。
    await act(() => {
      root.render(
        <Details open={false}>
          <AsyncText text="Async" />
        </Details>,
      );
    });
    assertLog(['Closed', 'Suspend! [Async]']);
    expect(root).toMatchRenderedOutput(<span>Closed</span>);

    // 切到 visible 后，挂起必须冒泡至最近 Suspense。
    await act(() => {
      startTransition(() => {
        root.render(
          <Details open={true}>
            <AsyncText text="Async" />
          </Details>,
        );
      });
    });
    assertLog(['Open', 'Suspend! [Async]', 'Loading...']);
    // 延迟挂起可避免已可见 Suspense 立即切换 fallback。
    expect(root).toMatchRenderedOutput(<span>Closed</span>);

    // resolve 数据并完成揭示 render。
    await act(async () => {
      await resolveText('Async');
    });
    assertLog(['Open', 'Async']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Open</span>
        <span>Async</span>
      </>,
    );
  });

  /**
   * Given visible Activity 已提交旧内容且更新异步 child 时挂起；When 后续 Transition 把它隐藏；
   * Then 可见兄弟提交 Closed，挂起子树转入后台，resolve 后只更新 hidden 内容。
   * 验证机制：Noop 树和日志；对应 Activity 隐藏优先级与 Suspense 隔离。
   */
  test("suspending inside currently visible tree that's switching to hidden", async () => {
    const root = ReactNoop.createRoot();

    /** 控制 visible→hidden 切换并提供外层 Suspense 旧屏。 */
    function Details({open, children}) {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <span>
            <Text text={open ? 'Open' : 'Closed'} />
          </span>
          <Activity mode={open ? 'visible' : 'hidden'}>
            <span>{children}</span>
          </Activity>
        </Suspense>
      );
    }

    // 初始挂载没有挂起。
    await act(() => {
      root.render(
        <Details open={true}>
          <Text text="(empty)" />
        </Details>,
      );
    });
    assertLog(['Open', '(empty)']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Open</span>
        <span>(empty)</span>
      </>,
    );

    // 更新当前可见树并在其中挂起。
    await act(() => {
      startTransition(() => {
        root.render(
          <Details open={true}>
            <AsyncText text="Async" />
          </Details>,
        );
      });
    });
    assertLog(['Open', 'Suspend! [Async]', 'Loading...']);
    // 延迟挂起避免已可见 Suspense 切换 fallback。
    expect(root).toMatchRenderedOutput(
      <>
        <span>Open</span>
        <span>(empty)</span>
      </>,
    );

    // 再次更新，把正在挂起的树隐藏。
    await act(() => {
      startTransition(() => {
        root.render(
          <Details open={false}>
            <AsyncText text="Async" />
          </Details>,
        );
      });
    });
    // 挂起内容已隐藏，可见部分现在可不受阻塞地提交。
    assertLog(['Closed', 'Suspend! [Async]']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Closed</span>
        <span hidden={true}>(empty)</span>
      </>,
    );

    // resolve 数据并完成后台 render。
    await act(async () => {
      await resolveText('Async');
    });
    assertLog(['Async']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Closed</span>
        <span hidden={true}>Async</span>
      </>,
    );
  });

  /**
   * Given hidden Activity 已提交异步文本 A；When Transition 把内部 state 更新到未解析 B；
   * Then act 调用能完成而不抛错；本例没有更新后的日志/宿主快照或 lane 位断言，不能由它单独证明后台状态终态。
   */
  test('update that suspends inside hidden tree', async () => {
    let setText;
    /** 暴露文本 state setter，使测试直接安排 hidden 子树异步更新。 */
    function Child() {
      const [text, _setText] = useState('A');
      setText = _setText;
      return <AsyncText text={text} />;
    }

    /** 用 show 控制 Activity visible/hidden，并承载持久 Child state。 */
    function App({show}) {
      return (
        <Activity mode={show ? 'visible' : 'hidden'}>
          <span>
            <Child />
          </span>
        </Activity>
      );
    }

    const root = ReactNoop.createRoot();
    resolveText('A');
    await act(() => {
      root.render(<App show={false} />);
    });
    assertLog(['A']);

    await act(() => {
      startTransition(() => {
        setText('B');
      });
    });
  });

  /**
   * Given hidden 子树为 A0；When transition lane 更新 step、sync lane 更新 text 且两次组合都挂起；
   * Then reconciler 尝试 B0 与 B1，保留 A0，B1 resolve 后提交最新组合。
   * 验证机制：跨 lane 日志与 hidden 输出；对应 ReactFiberLane、OffscreenLane 与 update queue rebasing。
   */
  test('updates at multiple priorities that suspend inside hidden tree', async () => {
    let setText;
    let setStep;
    /** 维护 text 与 step 两个独立 state，允许不同 lane 交错更新并组合读取 cache。 */
    function Child() {
      const [text, _setText] = useState('A');
      setText = _setText;

      const [step, _setStep] = useState(0);
      setStep = _setStep;

      return <AsyncText text={text + step} />;
    }

    /** 把多优先级 Child 固定在可切换 Activity 中。 */
    function App({show}) {
      return (
        <Activity mode={show ? 'visible' : 'hidden'}>
          <span>
            <Child />
          </span>
        </Activity>
      );
    }

    const root = ReactNoop.createRoot();
    resolveText('A0');
    await act(() => {
      root.render(<App show={false} />);
    });
    assertLog(['A0']);
    expect(root).toMatchRenderedOutput(<span hidden={true}>A0</span>);

    await act(() => {
      React.startTransition(() => {
        setStep(1);
      });
      ReactNoop.flushSync(() => {
        setText('B');
      });
    });
    assertLog([
      // 高优先级 render 再次挂起。
      'Suspend! [B0]',
      // 另一 lane 仍有 pending work，因此也必须尝试。
      'Suspend! [B1]',
    ]);
    expect(root).toMatchRenderedOutput(<span hidden={true}>A0</span>);

    // resolve 最新组合并完成 render。
    await act(() => {
      resolveText('B1');
    });
    assertLog(['B1']);
    expect(root).toMatchRenderedOutput(<span hidden={true}>B1</span>);
  });

  /**
   * Given visible 树正在并发 render 为 hidden，且内外 state 必须成对更新；When render 未提交前又发生第二组 transition 更新；
   * Then 内部更新原子排队，揭示时只处理与已提交 outer 匹配的版本，最终再收敛到第二组值，无 tearing。
   * 验证机制：分片 waitFor/waitForPaint、effect 一致性日志与树输出；对应隐藏祖先检测和并发 update queue 原子转移。
   */
  test('detect updates to a hidden tree during a concurrent event', async () => {
    // 调度 hidden 树更新时会沿 Fiber return 链查找 hidden Activity；若并发 render 正准备把树隐藏，
    // 直接检查当前树会产生数据竞争。因此更新需在当前 render 结束后原子入队。

    let setInner;
    /** 维护 inner state，并在 effect 中验证它始终与外部 outer 版本一致。 */
    function Child({outer}) {
      const [inner, _setInner] = useState(0);
      setInner = _setInner;

      useEffect(() => {
        // inner 与 outer 总是同时更新，任何不一致都表示 tearing。
        if (inner !== outer) {
          Scheduler.log('Tearing! Inner and outer are inconsistent!');
        } else {
          Scheduler.log('Inner and outer are consistent');
        }
      }, [inner, outer]);

      return <Text text={'Inner: ' + inner} />;
    }

    let setOuter;
    /** 同时渲染 Activity 内部 state、外部 state 与 Suspense 兄弟，暴露并发提交切片。 */
    function App({show}) {
      const [outer, _setOuter] = useState(0);
      setOuter = _setOuter;
      return (
        <>
          <Activity mode={show ? 'visible' : 'hidden'}>
            <span>
              <Child outer={outer} />
            </span>
          </Activity>
          <span>
            <Text text={'Outer: ' + outer} />
          </span>
          <Suspense fallback={<Text text="Loading..." />}>
            <span>
              <Text text={'Sibling: ' + outer} />
            </span>
          </Suspense>
        </>
      );
    }

    // 初始提交可见树，建立 inner/outer/sibling 一致基线。
    const root = ReactNoop.createRoot();
    resolveText('Async: 0');
    await act(() => {
      root.render(<App show={true} />);
    });
    assertLog([
      'Inner: 0',
      'Outer: 0',
      'Sibling: 0',
      'Inner and outer are consistent',
    ]);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Inner: 0</span>
        <span>Outer: 0</span>
        <span>Sibling: 0</span>
      </>,
    );

    await act(async () => {
      // 同时更新隐藏边界内外的值；两者必须始终一致。
      startTransition(() => {
        setOuter(1);
        setInner(1);
        // 同一次 render 还会把 Activity 隐藏。
        root.render(<App show={false} />);
      });

      await waitFor([
        // outer 更新可提交，inner 更新被延迟到后续 render。
        'Outer: 1',
      ]);

      // 此时尚未真正 commit。
      expect(root).toMatchRenderedOutput(
        <>
          <span>Inner: 0</span>
          <span>Outer: 0</span>
          <span>Sibling: 0</span>
        </>,
      );

      // 树提交前安排并发事件；inner 更新目标正要变为 hidden。
      startTransition(() => {
        setOuter(2);
        setInner(2);
      });

      // 完成并提交进行中的 render。
      await waitForPaint(['Sibling: 1']);
      expect(root).toMatchRenderedOutput(
        <>
          <span hidden={true}>Inner: 0</span>
          <span>Outer: 1</span>
          <span>Sibling: 1</span>
        </>,
      );

      // 以高优先级揭示 hidden 树。
      ReactNoop.flushSync(() => {
        root.render(<App show={true} />);
      });
      assertLog([
        // Inner 有两组 pending transition 更新，但这里只能处理第一个；若错误处理第二个，Inner 会与 Outer 不一致。
        'Inner: 1',
        'Outer: 1',
        'Sibling: 1',
        'Inner and outer are consistent',
      ]);
    });
    assertLog([
      'Inner: 2',
      'Outer: 2',
      'Sibling: 2',
      'Inner and outer are consistent',
    ]);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Inner: 2</span>
        <span>Outer: 2</span>
        <span>Sibling: 2</span>
      </>,
    );
  });
});
