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
let use;

/** 通过 React.use(promise) 验证 Activity 与 LegacyHidden 的 Suspense 隔离及隐藏树并发更新语义。 */
describe('Activity Suspense', () => {
  /** 每例重置 renderer、Hooks 和带状态 Promise cache，避免 use() 结算状态跨测试泄漏。 */
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
    use = React.use;

    const InternalTestUtils = require('internal-test-utils');
    waitFor = InternalTestUtils.waitFor;
    waitForPaint = InternalTestUtils.waitForPaint;
    assertLog = InternalTestUtils.assertLog;

    textCache = new Map();
  });

  /** 创建 fulfilled Promise 记录，或把 pending Promise 标记为 fulfilled 并调用其原始 resolve。 */
  function resolveText(text) {
    const record = textCache.get(text);
    if (record === undefined) {
      const promise = Promise.resolve(text);
      promise.status = 'fulfilled';
      promise.value = text;
      const newRecord = {
        promise,
      };
      textCache.set(text, newRecord);
    } else if (record.promise.status === 'pending') {
      const resolve = record.resolve;
      record.promise.status = 'fulfilled';
      record.promise.value = text;
      resolve(text);
    }
  }

  /** 获取或创建带 status/value 的文本 Promise；pending 时记录挂起，并交给 use() 解包或抛出。 */
  function readText(text) {
    let record = textCache.get(text);
    if (record === undefined) {
      let resolve;
      const promise = new Promise(_resolve => {
        resolve = _resolve;
      });
      promise.status = 'pending';
      record = {
        promise,
        resolve,
      };
      textCache.set(text, record);
    }
    if (record.promise.status === 'pending') {
      Scheduler.log(`Suspend! [${text}]`);
    }
    return use(record.promise);
  }

  /** 记录并同步输出文本，作为可见内容和 fallback 标记。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** 通过 use() 读取可能挂起的文本 Promise，成功后记录并返回文本。 */
  function AsyncText({text}) {
    readText(text);
    Scheduler.log(text);
    return text;
  }

  /**
   * Given 外层 Suspense 含可见内容和 hidden Activity 的 use(promise) 子树；When Promise pending 后 resolve；
   * Then 可见内容立即提交且不显示 fallback，hidden 子树随后完成预渲染。
   * 验证机制：use() 挂起日志与 Noop hidden 输出；对应 Activity 隐藏捕获和 ReactFiberThenable。
   */
  it('basic example of suspending inside hidden tree', async () => {
    const root = ReactNoop.createRoot();

    /** 组合同步可见文本与 hidden Activity 内的 use(promise) 文本。 */
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

    // hidden 子树尚未加载，但周围内容仍可显示；外层 Suspense 不受影响。
    await act(() => {
      root.render(<App />);
    });
    assertLog(['Visible', 'Suspend! [Hidden]']);
    expect(root).toMatchRenderedOutput(<span>Visible</span>);

    // Promise resolve 后应完成 hidden 子树预渲染。
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
   * Given 同一 Promise 子树改用 LegacyHidden；When use() 挂起；Then LegacyHidden 不隔离，最近 Suspense 显示 fallback。
   * 验证 Activity 与旧实现处理 thenable 的差异；对应 LegacyHidden/Offscreen beginWork。
   */
  // @gate enableLegacyHidden
  test('LegacyHidden does not handle suspense', async () => {
    const root = ReactNoop.createRoot();

    /** 用 LegacyHidden 替代 Activity 的 thenable 挂起对照树。 */
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

    // 与 Activity 不同，LegacyHidden 不会捕获内部挂起。
    await act(() => {
      root.render(<App />);
    });
    assertLog(['Visible', 'Suspend! [Hidden]', 'Loading...']);
    // 即使挂起内容隐藏，最近 Suspense 仍切换到 fallback。
    expect(root).toMatchRenderedOutput(
      <>
        <span hidden={true}>Visible</span>
        Loading...
      </>,
    );
  });

  /**
   * Given public act 下 visible Activity 的 Promise 先挂起后完成；When 隐藏导致 effect 删除 cache 并再次挂起；
   * Then 更新稳定结束为空输出，不出现 use() ping 与 effect 清理互相触发的无限循环。
   * 验证机制：清理/挂起日志；对应 Activity 隐藏 effects 与 ReactFiberThenable ping。
   */
  // @gate __DEV__
  test('Regression: Suspending on hide should not infinite loop.', async () => {
    // 此回归只在公开 React.act 中复现。
    global.IS_REACT_ACT_ENVIRONMENT = true;
    const root = ReactNoop.createRoot();

    let setMode;
    /** 管理 Activity mode；effect 清理删除 Promise cache，用于复现隐藏时重新挂起。 */
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

    await React.act(() => {
      setMode('hidden');
    });
    assertLog(['Clear [hello]', 'Suspend! [hello]']);
    expect(root).toMatchRenderedOutput('');
  });

  /**
   * Given hidden Activity 内 use(promise) 尚未完成；When Transition 揭示边界；
   * Then 挂起冒泡但旧 Closed 屏保留，Promise resolve 后提交 Open 与 Async。
   * 验证机制：预热日志和树输出；对应 Activity 揭示、Suspense 延迟 fallback 与 retry。
   */
  test("suspending inside currently hidden tree that's switching to visible", async () => {
    const root = ReactNoop.createRoot();

    /** 用 open 共同驱动标签与 Activity mode，形成 hidden→visible 路径。 */
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

    // hidden 子树未完成仍不阻塞周围内容；未完成部分不可见，因此无需展示 fallback。
    await act(() => {
      root.render(
        <Details open={false}>
          <AsyncText text="Async" />
        </Details>,
      );
    });
    assertLog(['Closed', 'Suspend! [Async]']);
    expect(root).toMatchRenderedOutput(<span>Closed</span>);

    // 切到 visible 后，use() 挂起必须冒泡到最近 Suspense。
    await act(() => {
      startTransition(() => {
        root.render(
          <Details open={true}>
            <AsyncText text="Async" />
          </Details>,
        );
      });
    });
    assertLog([
      'Open',
      'Suspend! [Async]',
      // fallback 被求值但尚未提交，旧 Closed/Open 内容仍保留。
      'Loading...',
    ]);
    // 延迟挂起防止已可见 Suspense 立即切换 fallback。
    expect(root).toMatchRenderedOutput(<span>Closed</span>);

    // resolve Promise 并完成揭示 render。
    await act(async () => {
      await resolveText('Async');
    });
    assertLog([
      // 资源完成后重试揭示，先重新求值可见标签。
      'Open',
      // 异步文本本次读取成功；提交由随后宿主输出断言验证。
      'Async',
    ]);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Open</span>
        <span>Async</span>
      </>,
    );
  });

  /**
   * Given visible Activity 已提交旧 child，更新 Promise 时挂起；When 后续 Transition 把 Activity 隐藏；
   * Then 可见 Closed 部分先提交，挂起子树后台完成，resolve 后只更新 hidden 输出。
   * 验证机制：use() 日志与 Noop 树；对应 Activity 隐藏优先级和 Suspense 隔离。
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

    // 更新当前可见树并通过 use() 挂起。
    await act(() => {
      startTransition(() => {
        root.render(
          <Details open={true}>
            <AsyncText text="Async" />
          </Details>,
        );
      });
    });
    assertLog([
      'Open',
      'Suspend! [Async]',
      // fallback 被求值但尚未提交，旧 Closed/Open 内容仍保留。
      'Loading...',
    ]);
    // 延迟挂起避免已可见 Suspense 切换 fallback。
    expect(root).toMatchRenderedOutput(
      <>
        <span>Open</span>
        <span>(empty)</span>
      </>,
    );

    // 再更新，将正在挂起的树隐藏。
    await act(() => {
      startTransition(() => {
        root.render(
          <Details open={false}>
            <AsyncText text="Async" />
          </Details>,
        );
      });
    });
    // 挂起内容隐藏后，可见部分可不受阻塞地提交。
    assertLog(['Closed', 'Suspend! [Async]']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Closed</span>
        <span hidden={true}>(empty)</span>
      </>,
    );

    // resolve Promise 并完成后台 render。
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
   * Given hidden Activity 已提交 Promise 文本 A；When Transition 把内部 state 更新为未解析 B；
   * Then act 调用能完成而不抛错；更新之后没有日志/宿主快照或 lane 位断言，本例不直接验证 Offscreen lane 数值。
   */
  test('update that suspends inside hidden tree', async () => {
    let setText;
    /** 暴露文本 setter，精确触发 hidden 子树的 Promise 更新。 */
    function Child() {
      const [text, _setText] = useState('A');
      setText = _setText;
      return <AsyncText text={text} />;
    }

    /** 用 show 控制 Activity mode，并保留 Child state。 */
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
   * Given hidden 子树为 A0；When transition step 与 sync text 更新交错，B0/B1 Promise 均 pending；
   * Then 两条 lane 都被尝试但保留 A0，B1 resolve 后提交最新组合。
   * 验证机制：挂起日志和 hidden 输出；对应 lane rebasing、OffscreenLane 与 ReactFiberThenable。
   */
  test('updates at multiple priorities that suspend inside hidden tree', async () => {
    let setText;
    let setStep;
    /** 分别维护 text/step，使不同优先级更新组合成可区分的 Promise key。 */
    function Child() {
      const [text, _setText] = useState('A');
      setText = _setText;

      const [step, _setStep] = useState(0);
      setStep = _setStep;

      return <AsyncText text={text + step} />;
    }

    /** 把多 lane Child 固定在可切换 Activity 内。 */
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
      // 另一 lane 仍有 pending work，因此也应尝试。
      'Suspend! [B1]',
    ]);
    expect(root).toMatchRenderedOutput(<span hidden={true}>A0</span>);

    // resolve 最新 Promise 并完成 render。
    await act(() => {
      resolveText('B1');
    });
    assertLog(['B1']);
    expect(root).toMatchRenderedOutput(<span hidden={true}>B1</span>);
  });

  /**
   * Given visible 树正在并发切到 hidden 且 inner/outer 必须成对更新；When commit 前又发生第二组 transition 更新；
   * Then 内部更新在 render 后原子入队，揭示不产生 tearing，最终收敛到第二组值。
   * 验证机制：分片调度、effect 一致性日志与树输出；对应 hidden 祖先检测及 concurrent update queue 转移。
   */
  test('detect updates to a hidden tree during a concurrent event', async () => {
    // hidden 更新通过沿 Fiber return 链查找 Activity 来判定；并发 render 正切换可见性时会有竞态，
    // 因此必须等当前 render 结束后再原子转移更新。

    let setInner;
    /** 维护 inner state，并在 effect 中验证它与 outer 一致。 */
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
    /** 同时暴露 Activity 内部、外部和 Suspense 兄弟输出，观察并发提交切片。 */
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

    // 初始提交可见树，建立一致性基线。
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
      // 同时更新边界内外的值；二者必须一致。
      startTransition(() => {
        setOuter(1);
        setInner(1);
        // 同一次 render 还会隐藏 Activity。
        root.render(<App show={false} />);
      });

      await waitFor([
        // outer 更新可提交，inner 更新延迟到后续 render。
        'Outer: 1',
      ]);

      // 此时尚未 commit。
      expect(root).toMatchRenderedOutput(
        <>
          <span>Inner: 0</span>
          <span>Outer: 0</span>
          <span>Sibling: 0</span>
        </>,
      );

      // 树提交前安排并发事件；inner 目标正要隐藏。
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
        // Inner 有两组 pending transition 更新，但此处只能处理第一个；错误处理第二个会与 Outer 不一致。
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
