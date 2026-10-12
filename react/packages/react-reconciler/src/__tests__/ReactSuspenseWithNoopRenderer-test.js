let React;
let Fragment;
let ReactNoop;
let Scheduler;
let act;
let waitFor;
let waitForAll;
let waitForMicrotasks;
let assertLog;
let waitForPaint;
let Suspense;
let startTransition;
let getCacheForType;

let caches;
let seededCache;

/** 通过 Noop 调度日志验证 Suspense 的优先级、ping、fallback、隐藏子树、错误和更新队列。 */
describe('ReactSuspenseWithNoopRenderer', () => {
  /** 重置模块和 cache 池，重新绑定 Noop 渲染器、Suspense、调度等待器及实验 cache API。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    Fragment = React.Fragment;
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    Suspense = React.Suspense;
    startTransition = React.startTransition;
    const InternalTestUtils = require('internal-test-utils');
    waitFor = InternalTestUtils.waitFor;
    waitForAll = InternalTestUtils.waitForAll;
    waitForPaint = InternalTestUtils.waitForPaint;
    waitForMicrotasks = InternalTestUtils.waitForMicrotasks;
    assertLog = InternalTestUtils.assertLog;

    getCacheForType = React.unstable_getCacheForType;

    caches = [];
    seededCache = null;
  });

  /** createTextCache 创建带版本号的请求级文本 cache；resolve/reject 只允许 pending 向终态单向迁移。 */
  function createTextCache() {
    if (seededCache !== null) {
      // 在 cache 尚未创建前预置下一份 cache；预置值只能被首次请求消费。
      // TODO：需要内建 API 在首次渲染前预置数据；此时尚未挂载，所以不能用 refresh。
      const cache = seededCache;
      seededCache = null;
      return cache;
    }

    const data = new Map();
    const version = caches.length + 1;
    const cache = {
      version,
      data,
      /** createTextCache.resolve 把资源从 pending 转为 resolved，并唤醒所有已登记 ping；重复解决保持终态。 */
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
      /** createTextCache.reject 把资源从 pending 转为 rejected 并广播错误重试；不存在记录时直接建立 rejected 终态。 */
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

  /** readText 读取三态资源：resolved 返回，pending 抛 thenable，rejected 抛错误；首次读取原子创建 pending 记录。 */
  function readText(text) {
    const textCache = getCacheForType(createTextCache);
    const record = textCache.data.get(text);
    if (record !== undefined) {
      /** 状态机边界：`pending` 抛 thenable 交给 Suspense，`rejected` 抛业务错误，`resolved` 返回已缓存值。 */
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
        /** readText.then 在 pending 时登记 ping；若资源已结束，改用微任务通知订阅者。 */
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

  /** Text 同步记录并输出文本，区分render访问与已提交宿主内容。 */
  function Text({text}) {
    Scheduler.log(text);
    return <span prop={text} />;
  }

  /** AsyncText 先读取异步资源；未就绪时挂起，成功后才记录并输出文本。 */
  function AsyncText({text, showVersion}) {
    const version = readText(text);
    const fullText = showVersion ? `${text} [v${version}]` : text;
    Scheduler.log(fullText);
    return <span prop={fullText} />;
  }

  /** seedNextTextCache 在下一次 cache 创建前预置 resolved 数据；预置值只消费一次。 */
  function seedNextTextCache(text) {
    if (seededCache === null) {
      seededCache = createTextCache();
    }
    seededCache.resolve(text);
  }

  /** resolveMostRecentTextCache 将目标文本资源推进到 resolved，并广播所有 ping 以安排 Suspense retry。 */
  function resolveMostRecentTextCache(text) {
    if (caches.length === 0) {
      throw Error('Cache does not exist.');
    } else {
      caches[caches.length - 1].resolve(text);
    }
  }

  const resolveText = resolveMostRecentTextCache;

  /** rejectMostRecentTextCache 将最近 cache 的目标资源推进到 rejected，广播 ping 后由错误边界处理。 */
  function rejectMostRecentTextCache(text, error) {
    if (caches.length === 0) {
      throw Error('Cache does not exist.');
    } else {
      caches[caches.length - 1].reject(text, error);
    }
  }

  const rejectText = rejectMostRecentTextCache;

  /** advanceTimers 只推进 Jest 虚拟时间并等待当前 tick；React 调度时间仍由 Noop API 控制。 */
  function advanceTimers(ms) {
    if (typeof ms !== 'number') {
      throw new Error('Must specify ms');
    }
    jest.advanceTimersByTime(ms);
    return Promise.resolve().then(() => {});
  }

  /** LegacyHiddenDiv 用宿主 hidden 属性包裹 LegacyHidden，模拟隐藏但保留主树的旧版结构。 */
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

  /** 首次 transition 在 Foo/Bar 的 A挂起、fallback和C已渲染后暂停；此时解析A，先只继续D并提交fallback/C/D，之后retry为ABCD。验证进行中的fallback遍不会因ping直接从根重启。 */
  // @gate enableLegacyCache
  it("does not restart if there's a ping during initial render", async () => {
    /** 记录Bar后透传children，以判断ping或重启是否重复执行此层。 */
    function Bar(props) {
      Scheduler.log('Bar');
      return props.children;
    }

    /** 记录Foo，包裹Bar的A/B主树与Loading，边界外C/D提供暂停与续接检查点。 */
    function Foo() {
      Scheduler.log('Foo');
      return (
        <>
          <Suspense fallback={<Text text="Loading..." />}>
            <Bar>
              <AsyncText text="A" />
              <Text text="B" />
            </Bar>
          </Suspense>
          <Text text="C" />
          <Text text="D" />
        </>
      );
    }

    React.startTransition(() => {
      ReactNoop.render(<Foo />);
    });
    await waitFor([
      'Foo',
      'Bar',
      'Suspend! [A]',
      'Loading...',
      'C',
      // 分段冲刷或让出调度工作，以锁定当前渲染检查点。
    ]);
    expect(ReactNoop).toMatchRenderedOutput(null);

    await act(async () => {
      await resolveText('A');
      await waitForPaint(['D']);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Loading..." />
          <span prop="C" />
          <span prop="D" />
        </>,
      );
      // 分段冲刷或让出调度工作，以锁定当前渲染检查点。
      await waitForAll(['Bar', 'A', 'B']);
    });

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="B" />
        <span prop="C" />
        <span prop="D" />
      </>,
    );
  });

  /** 先挂载不含Bar的空边界，再transition加入A/B；A挂起时B预热、Loading虽被渲染但当前仍null，解析A后输出AB。验证已有可见shell上的transition保留旧内容直至主树完成。 */
  // @gate enableLegacyCache
  it('suspends rendering and continues later', async () => {
    /** 记录Bar后透传children，以判断ping或重启是否重复执行此层。 */
    function Bar(props) {
      Scheduler.log('Bar');
      return props.children;
    }

    /** 依据renderBar在空边界和Bar的A/B主树间切换，供transition保留空shell。 */
    function Foo({renderBar}) {
      Scheduler.log('Foo');
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          {renderBar ? (
            <Bar>
              <AsyncText text="A" />
              <Text text="B" />
            </Bar>
          ) : null}
        </Suspense>
      );
    }

    ReactNoop.render(<Foo />);
    await waitForAll(['Foo']);

    React.startTransition(() => {
      ReactNoop.render(<Foo renderBar={true} />);
    });
    await waitForAll([
      'Foo',
      'Bar',
      'Suspend! [A]',

      // 执行预热渲染，不把该遍结果作为最终提交。
      'B',
      // 结束预热渲染。

      'Loading...',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(null);

    await resolveText('A');
    await waitForAll(['Foo', 'Bar', 'A', 'B']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="B" />
      </>,
    );
  });

  /** 两个独立边界分别读取A/B，初始两份fallback；依次解析A、B，输出A/Loading B再AB，alwaysThrottleRetries仅影响额外B重试日志。 */
  // @gate enableLegacyCache
  it('suspends siblings and later recovers each independently', async () => {
    ReactNoop.render(
      <Fragment>
        <Suspense fallback={<Text text="Loading A..." />}>
          <AsyncText text="A" />
        </Suspense>
        <Suspense fallback={<Text text="Loading B..." />}>
          <AsyncText text="B" />
        </Suspense>
      </Fragment>,
    );
    await waitForAll([
      'Suspend! [A]',
      'Loading A...',
      'Suspend! [B]',
      'Loading B...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
      'Suspend! [B]',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Loading A..." />
        <span prop="Loading B..." />
      </>,
    );

    // 切回并检查主内容视图。
    await act(() => resolveText('A'));
    assertLog([
      'A',
      ...(gate('alwaysThrottleRetries')
        ? ['Suspend! [B]', 'Suspend! [B]']
        : []),
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="Loading B..." />
      </>,
    );

    // 切回并检查主内容视图。
    await act(() => resolveText('B'));
    assertLog(['B']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="B" />
      </>,
    );
  });

  /** 已有空边界内transition加入同步A、异步B、同步C/D；B挂起后C/D在预热路径仍被访问，输出保持null；解析B后为ABCD。验证当前版本含兄弟预热，不把标题的立即unwind理解为完全不渲染兄弟。 */
  // @gate enableLegacyCache
  it('when something suspends, unwinds immediately without rendering siblings', async () => {
    ReactNoop.render(<Suspense fallback={<Text text="Loading..." />} />);
    await waitForAll([]);
    React.startTransition(() => {
      ReactNoop.render(
        <Suspense fallback={<Text text="Loading..." />}>
          <Text text="A" />
          <AsyncText text="B" />
          <Text text="C" />
          <Text text="D" />
        </Suspense>,
      );
    });

    await waitForAll([
      'A',
      'Suspend! [B]',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'C',
      'D',
      // 结束预热渲染。
      'Loading...',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(null);

    await resolveText('B');
    await waitForAll(['A', 'B', 'C', 'D']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="B" />
        <span prop="C" />
        <span prop="D" />
      </>,
    );
  });

  /** 空shell中transition加入错误边界与Result请求；pending保持null，拒绝Result后两次错误读取并显示Caught error。验证尚未显示Suspense fallback也能进入错误恢复。 */
  // @gate enableLegacyCache
  it('retries on error', async () => {
    /** componentDidCatch保存错误并显示捕获消息，reset可清空状态（本例没有调用reset）。 */
    class ErrorBoundary extends React.Component {
      /** null表示正常children，捕获错误后保存Error并显示消息。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch 把资源 rejection 后的业务错误交给错误边界状态与日志。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** ErrorBoundary.reset 清除错误边界状态，使同一 fixture 可验证后续 retry。 */
      reset() {
        this.setState({error: null});
      }
      /** 错误非null时显示捕获消息，否则透传children。 */
      render() {
        if (this.state.error !== null) {
          return <Text text={'Caught error: ' + this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    const errorBoundary = React.createRef();
    /** 依据renderContent在空shell和带ref的错误边界/Result资源之间切换。 */
    function App({renderContent}) {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          {renderContent ? (
            <ErrorBoundary ref={errorBoundary}>
              <AsyncText text="Result" />
            </ErrorBoundary>
          ) : null}
        </Suspense>
      );
    }

    ReactNoop.render(<App />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(null);

    React.startTransition(() => {
      ReactNoop.render(<App renderContent={true} />);
    });
    await waitForAll(['Suspend! [Result]', 'Loading...']);
    expect(ReactNoop).toMatchRenderedOutput(null);

    await rejectText('Result', new Error('Failed to load: Result'));

    await waitForAll([
      'Error! [Result]',

      'Error! [Result]',

      'Caught error: Failed to load: Result',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <span prop="Caught error: Failed to load: Result" />,
    );
  });

  /** Result初挂已经显示Loading后再拒绝请求；两次错误读取后错误边界显示Caught error。验证已提交fallback的retry也把业务错误交给class边界。 */
  // @gate enableLegacyCache
  it('retries on error after falling back to a placeholder', async () => {
    /** componentDidCatch保存错误并显示捕获消息，reset可清空状态（本例没有调用reset）。 */
    class ErrorBoundary extends React.Component {
      /** null表示正常children，捕获错误后保存Error并显示消息。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch 把资源 rejection 后的业务错误交给错误边界状态与日志。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** ErrorBoundary.reset 清除错误边界状态，使同一 fixture 可验证后续 retry。 */
      reset() {
        this.setState({error: null});
      }
      /** 错误非null时显示捕获消息，否则透传children。 */
      render() {
        if (this.state.error !== null) {
          return <Text text={'Caught error: ' + this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    const errorBoundary = React.createRef();
    /** 在Suspense下初挂带ref的错误边界与Result资源。 */
    function App() {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <ErrorBoundary ref={errorBoundary}>
            <AsyncText text="Result" />
          </ErrorBoundary>
        </Suspense>
      );
    }

    ReactNoop.render(<App />);
    await waitForAll([
      'Suspend! [Result]',
      'Loading...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [Result]',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);

    await act(() => rejectText('Result', new Error('Failed to load: Result')));
    assertLog([
      'Error! [Result]',

      'Error! [Result]',

      'Caught error: Failed to load: Result',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <span prop="Caught error: Failed to load: Result" />,
    );
  });

  /** 先显示A/1，再transition把LowPri改成待决2；flushSync将独立HighPri改成B可先提交B/1，解析2后为B/2。验证挂起transition不阻塞同步兄弟更新。 */
  // @gate enableLegacyCache
  it('can update at a higher priority while in a suspended state', async () => {
    let setHighPri;
    /** 暴露高优先级同步文本更新器，与低优先级可挂起子树对照。 */
    function HighPri() {
      const [text, setText] = React.useState('A');
      setHighPri = setText;
      return <Text text={text} />;
    }

    let setLowPri;
    /** 暴露低优先级文本更新器，交给 AsyncText 制造挂起。 */
    function LowPri() {
      const [text, setText] = React.useState('1');
      setLowPri = setText;
      return <AsyncText text={text} />;
    }

    /** 并列同步HighPri与含LowPri的边界，两份独立state允许跨优先级观察。 */
    function App() {
      return (
        <>
          <HighPri />
          <Suspense fallback={<Text text="Loading..." />}>
            <LowPri />
          </Suspense>
        </>
      );
    }

    await act(() => ReactNoop.render(<App />));
    assertLog([
      'A',
      'Suspend! [1]',
      'Loading...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [1]',
    ]);

    await act(() => resolveText('1'));
    assertLog(['1']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="1" />
      </>,
    );

    await act(() => startTransition(() => setLowPri('2')));
    assertLog(['Suspend! [2]', 'Loading...']);

    ReactNoop.flushSync(() => {
      setHighPri('B');
    });
    assertLog(['B']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="B" />
        <span prop="1" />
      </>,
    );

    await act(() => resolveText('2'));
    assertLog(['2']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="B" />
        <span prop="2" />
      </>,
    );
  });

  /** 空shell先transition加入待决A，随后另一次transition还追加B；资源未解时保持null但B被预热，解析A后为AB。两次都是transition，此处不证明固定两个不同优先级。 */
  // @gate enableLegacyCache
  it('keeps working on lower priority work after being pinged', async () => {
    /** 由showA/showB选择是否追加AsyncA和同步B，供连续transition重放。 */
    function App(props) {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          {props.showA && <AsyncText text="A" />}
          {props.showB && <Text text="B" />}
        </Suspense>
      );
    }

    ReactNoop.render(<App showA={false} showB={false} />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(null);

    React.startTransition(() => {
      ReactNoop.render(<App showA={true} showB={false} />);
    });
    await waitForAll(['Suspend! [A]', 'Loading...']);
    expect(ReactNoop).toMatchRenderedOutput(null);

    React.startTransition(() => {
      ReactNoop.render(<App showA={true} showB={true} />);
    });
    await waitForAll([
      'Suspend! [A]',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'B',
      // 结束预热渲染。
      'Loading...',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(null);

    await resolveText('A');
    await waitForAll(['A', 'B']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="B" />
      </>,
    );
  });

  /** 普通root更新读取待决Async，与transition排入hide=true同时存在；先日志Suspend Async，再低优先级更新输出(empty)。验证挂起较高优先级工作仍可尝试有可能解除阻塞的更新。 */
  // @gate enableLegacyCache
  it('tries rendering a lower priority pending update even if a higher priority one suspends', async () => {
    /** hide为真直接返回(empty)，否则新边界读Async，制造解除挂起的后入队更新。 */
    function App(props) {
      if (props.hide) {
        return <Text text="(empty)" />;
      }
      return (
        <Suspense fallback="Loading...">
          <AsyncText text="Async" />
        </Suspense>
      );
    }

    // 默认优先级检查点。
    ReactNoop.render(<App />);
    // 低优先级检查点。
    React.startTransition(() => {
      ReactNoop.render(<App hide={true} />);
    });

    await waitForAll([
      'Suspend! [Async]',
      '(empty)',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="(empty)" />);
  });

  // 注意：本用例最初针对 expiration-times 启发式；新模型下可能已不再适用。
  // TODO：本用例已无法覆盖最初目标，应重写或删除。
  /** 已显示Step0后依次transition排入Step1/2/3，每次只等待Sibling便用另一根flushSync(null)打断，最后普通更新Step4完成。断言仅Sibling/Step4；旧expiration-times目标未由此本体覆盖，不宣称逐层挂起已发生。 */
  it('tries each subsequent level after suspending', async () => {
    const root = ReactNoop.createRoot();

    /** 输出Sibling与对应Step资源，shouldSuspend区分异步步骤和最终同步步骤。 */
    function App({step, shouldSuspend}) {
      return (
        <Suspense fallback="Loading...">
          <Text text="Sibling" />
          {shouldSuspend ? (
            <AsyncText text={'Step ' + step} />
          ) : (
            <Text text={'Step ' + step} />
          )}
        </Suspense>
      );
    }

    /** 在另一根flushSync提交null，打断当前根进行中的transition；不是解析任何资源。 */
    function interrupt() {
      ReactNoop.flushSync(() => {
        ReactNoop.renderToRootWithID(null, 'other-root');
      });
    }

    await act(() => {
      root.render(<App step={0} shouldSuspend={false} />);
    });
    await advanceTimers(1000);
    assertLog(['Sibling', 'Step 0']);

    await act(async () => {
      React.startTransition(() => {
        root.render(<App step={1} shouldSuspend={true} />);
      });
      Scheduler.unstable_advanceTime(1000);
      await waitFor(['Sibling']);
      interrupt();

      React.startTransition(() => {
        root.render(<App step={2} shouldSuspend={true} />);
      });
      Scheduler.unstable_advanceTime(1000);
      await waitFor(['Sibling']);
      interrupt();

      React.startTransition(() => {
        root.render(<App step={3} shouldSuspend={true} />);
      });
      Scheduler.unstable_advanceTime(1000);
      await waitFor(['Sibling']);
      interrupt();

      root.render(<App step={4} shouldSuspend={false} />);
    });

    assertLog(['Sibling', 'Step 4']);
  });

  /** 外层先显示Loading outer，解析Outer content后内层B仍挂起，保持外fallback；推进500ms后显示Outer content/Loading inner，最后解析内资源。验证从已有fallback进入另一fallback的retry节流。 */
  // @gate enableLegacyCache
  it('switches to an inner fallback after suspending for a while', async () => {
    ReactNoop.expire(200);

    ReactNoop.render(
      <Fragment>
        <Text text="Sync" />
        <Suspense fallback={<Text text="Loading outer..." />}>
          <AsyncText text="Outer content" />
          <Suspense fallback={<Text text="Loading inner..." />}>
            <AsyncText text="Inner content" />
          </Suspense>
        </Suspense>
      </Fragment>,
    );

    await waitForAll([
      'Sync',
      'Suspend! [Outer content]',
      'Loading outer...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [Outer content]',
      'Suspend! [Inner content]',
      'Loading inner...',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Sync" />
        <span prop="Loading outer..." />
      </>,
    );

    await resolveText('Outer content');
    await waitForAll([
      'Outer content',
      'Suspend! [Inner content]',
      'Loading inner...',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Sync" />
        <span prop="Loading outer..." />
      </>,
    );

    ReactNoop.expire(500);
    await advanceTimers(500);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Sync" />
        <span prop="Outer content" />
        <span prop="Loading inner..." />
      </>,
    );

    await act(() => resolveText('Inner content'));
    assertLog(['Inner content']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Sync" />
        <span prop="Outer content" />
        <span prop="Inner content" />
      </>,
    );
  });

  /** flushSync初挂异步Async和同步兄弟Sync，立刻输出Loading/Sync；解析Async后输出Async/Sync。验证有边界的同步挂起可提交fallback并继续外部兄弟。 */
  // @gate enableLegacyCache
  it('renders an Suspense boundary synchronously', async () => {
    spyOnDev(console, 'error');
    ReactNoop.flushSync(() =>
      ReactNoop.render(
        <Fragment>
          <Suspense fallback={<Text text="Loading..." />}>
            <AsyncText text="Async" />
          </Suspense>
          <Text text="Sync" />
        </Fragment>,
      ),
    );
    assertLog([
      'Suspend! [Async]',
      'Loading...',
      // 继续处理同层兄弟节点。
      'Sync',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Loading..." />
        <span prop="Sync" />
      </>,
    );

    await act(() => resolveText('Async'));
    assertLog(['Async']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Async" />
        <span prop="Sync" />
      </>,
    );
  });

  /** flushSync时主Async挂起且内fallback自己也读取待决资源；挂起向外边界冒泡，输出Loading outer。此例没有推进到期计时，只验证fallback抛thenable的处理。 */
  // @gate enableLegacyCache
  it('suspending inside an expired expiration boundary will bubble to the next one', async () => {
    ReactNoop.flushSync(() =>
      ReactNoop.render(
        <Fragment>
          <Suspense fallback={<Text text="Loading (outer)..." />}>
            <Suspense fallback={<AsyncText text="Loading (inner)..." />}>
              <AsyncText text="Async" />
            </Suspense>
            <Text text="Sync" />
          </Suspense>
        </Fragment>,
      ),
    );
    assertLog([
      'Suspend! [Async]',
      'Suspend! [Loading (inner)...]',
      'Loading (outer)...',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading (outer)..." />);
  });

  /** 先挂载空边界，再transition加Async和Sibling；仅等待首次Suspend便解析Async，随后日志Async/Sibling且没有Loading，输出主内容。验证fallback遍尚未完成时ping可直接恢复主树。 */
  // @gate enableLegacyCache
  it('resolves successfully even if fallback render is pending', async () => {
    const root = ReactNoop.createRoot();
    root.render(
      <>
        <Suspense fallback={<Text text="Loading..." />} />
      </>,
    );
    await waitForAll([]);
    expect(root).toMatchRenderedOutput(null);
    React.startTransition(() => {
      root.render(
        <>
          <Suspense fallback={<Text text="Loading..." />}>
            <AsyncText text="Async" />
            <Text text="Sibling" />
          </Suspense>
        </>,
      );
    });
    await waitFor(['Suspend! [Async]']);

    await resolveText('Async');

    await waitForAll(['Async', 'Sibling']);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="Async" />
        <span prop="Sibling" />
      </>,
    );
  });

  /** 并发根在无Suspense边界下flushSync渲染待决Async；仅断言不抛错，没有资源解析或最终输出断言。验证并发根可等待无边界thenable。 */
  // @gate enableLegacyCache
  it('in concurrent mode, does not error when an update suspends without a Suspense boundary during a sync update', () => {
    expect(() => {
      ReactNoop.flushSync(() => {
        ReactNoop.render(<AsyncText text="Async" />);
      });
    }).not.toThrow();
  });

  /** legacy根无Suspense边界初挂待决Async；act拒绝并匹配同步输入挂起错误。验证旧同步根与并发无边界路径的区别。 */
  // @gate enableLegacyCache && !disableLegacyMode
  it('in legacy mode, errors when an update suspends without a Suspense boundary during a sync update', async () => {
    const root = ReactNoop.createLegacyRoot();
    await expect(async () => {
      await act(() => root.render(<AsyncText text="Async" />));
    }).rejects.toThrow(
      'A component suspended while responding to synchronous input.',
    );
  });

  /** 同一边界初挂A/B均待决：显示Loading，预热读取二者；同一act解析A/B后输出AB，验证两处ping都可恢复同一主树。 */
  // @gate enableLegacyCache
  it('a Suspense component correctly handles more than one suspended child', async () => {
    ReactNoop.render(
      <Suspense fallback={<Text text="Loading..." />}>
        <AsyncText text="A" />
        <AsyncText text="B" />
      </Suspense>,
    );
    await waitForAll([
      'Suspend! [A]',
      'Loading...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
      'Suspend! [B]',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);

    await act(() => {
      resolveText('A');
      resolveText('B');
    });
    assertLog(['A', 'B']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="B" />
      </>,
    );
  });

  /** 已有空shelltransition加入Async，Loading被渲染但未显示；未推进任何超时便解析资源，输出Async。验证数据先完成时可保持旧shell直到主内容提交。 */
  // @gate enableLegacyCache
  it('can resume rendering earlier than a timeout', async () => {
    ReactNoop.render(<Suspense fallback={<Text text="Loading..." />} />);
    await waitForAll([]);

    React.startTransition(() => {
      ReactNoop.render(
        <Suspense fallback={<Text text="Loading..." />}>
          <AsyncText text="Async" />
        </Suspense>,
      );
    });
    await waitForAll(['Suspend! [Async]', 'Loading...']);
    expect(ReactNoop).toMatchRenderedOutput(null);

    await resolveText('Async');
    await waitForAll(['Async']);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="Async" />);
  });

  /** 先显示S，依次transition请求A/B并在中间推进4999ms；普通root更新同步文本C先提交，之后解析A/B没有新日志或旧内容回滚。验证更晚已完成root更新在队列重放后仍获保留，不推断旧expiration层级。 */
  // @gate enableLegacyCache
  it('starts working on an update even if its priority falls between two suspended levels', async () => {
    /** text为S/C时返回同步Text，其余读AsyncText；用后入队C解除A/B挂起。 */
    function App(props) {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          {props.text === 'C' || props.text === 'S' ? (
            <Text text={props.text} />
          ) : (
            <AsyncText text={props.text} />
          )}
        </Suspense>
      );
    }

    ReactNoop.render(<App text="S" />);
    await waitForAll(['S']);

    React.startTransition(() => ReactNoop.render(<App text="A" />));
    await waitForAll(['Suspend! [A]', 'Loading...']);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="S" />);

    await advanceTimers(4999);
    ReactNoop.expire(4999);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="S" />);

    // 低优先级检查点。
    React.startTransition(() => ReactNoop.render(<App text="B" />));
    await waitForAll(['Suspend! [B]', 'Loading...']);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="S" />);

    ReactNoop.render(<App text="C" />);
    await waitForAll(['C']);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="C" />);

    // 分段冲刷或让出调度工作，以锁定当前渲染检查点。
    await resolveText('A');
    await resolveText('B');
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="C" />);
  });

  /** 每个ExpensiveText先推进10000ms再读A/B/C，初始Loading、预热读取全部待决资源；解析三者后输出ABC。验证已耗费大量CPU的挂起工作仍可retry完成，未单独断言每条lane到期。 */
  // @gate enableLegacyCache
  it('a suspended update that expires', async () => {
    /** 在读取异步资源前推进10000ms调度时间，让尝试耗费CPU后仍可挂起。 */
    function ExpensiveText({text}) {
      Scheduler.unstable_advanceTime(10000);
      return <AsyncText text={text} />;
    }

    /** 边界内三个ExpensiveText每个先消耗CPU再读取各自资源。 */
    function App() {
      return (
        <Suspense fallback="Loading...">
          <ExpensiveText text="A" />
          <ExpensiveText text="B" />
          <ExpensiveText text="C" />
        </Suspense>
      );
    }

    ReactNoop.render(<App />);
    await waitForAll([
      'Suspend! [A]',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
      'Suspend! [B]',
      'Suspend! [C]',
    ]);
    expect(ReactNoop).toMatchRenderedOutput('Loading...');

    await resolveText('A');
    await resolveText('B');
    await resolveText('C');

    await waitForAll(['A', 'B', 'C']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="B" />
        <span prop="C" />
      </>,
    );
  });

  /** 通过 Noop 调度日志验证 Suspense 的优先级、ping、fallback、隐藏子树、错误和更新队列。 */
  describe('legacy mode mode', () => {
    /** legacy同步根初挂Result待决时立即显示Loading，解析后输出Result；没有并发fallback延迟或后台预热日志。 */
    // @gate enableLegacyCache && !disableLegacyMode
    it('times out immediately', async () => {
      /** 在legacy根中初挂单个Result资源与Loading占位。 */
      function App() {
        return (
          <Suspense fallback={<Text text="Loading..." />}>
            <AsyncText text="Result" />
          </Suspense>
        );
      }

      ReactNoop.renderLegacySyncRoot(<App />);
      assertLog(['Suspend! [Result]', 'Loading...']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);

      await act(() => {
        resolveText('Result');
      });

      assertLog(['Result']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Result" />);
    });

    /** legacy类state预置Step1并显示Sibling；setState到Step2挂起，旧宿主节点隐藏并显示三个Spinner文本，setState callback仍记录Update did commit；解析Step2后补上文本。验证类更新可随legacy fallback提交。 */
    // @gate enableLegacyCache && !disableLegacyMode
    it('times out immediately when Suspense is in legacy mode', async () => {
      /** 保存step state并输出对应AsyncText，ref供外部更新类实例。 */
      class UpdatingText extends React.Component {
        /** 从step=1开始，更新到2读取新的资源键。 */
        state = {step: 1};
        /** 把state.step组成Step资源键，交给AsyncText读取。 */
        render() {
          return <AsyncText text={`Step: ${this.state.step}`} />;
        }
      }

      /** 返回三个同步Loading文本，覆盖legacy边界fallback的全部宿主输出。 */
      function Spinner() {
        return (
          <Fragment>
            <Text text="Loading (1)" />
            <Text text="Loading (2)" />
            <Text text="Loading (3)" />
          </Fragment>
        );
      }

      const text = React.createRef(null);
      /** 类UpdatingText读取state中的Step，边界还含Sibling和三文本Spinner。 */
      function App() {
        return (
          <Suspense fallback={<Spinner />}>
            <UpdatingText ref={text} />
            <Text text="Sibling" />
          </Suspense>
        );
      }

      await seedNextTextCache('Step: 1');
      ReactNoop.renderLegacySyncRoot(<App />);
      assertLog(['Step: 1', 'Sibling']);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Step: 1" />
          <span prop="Sibling" />
        </>,
      );

      text.current.setState({step: 2}, () =>
        Scheduler.log('Update did commit'),
      );

      expect(ReactNoop.flushNextYield()).toEqual([
        'Suspend! [Step: 2]',
        'Loading (1)',
        'Loading (2)',
        'Loading (3)',
        'Update did commit',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span hidden={true} prop="Step: 1" />
          <span hidden={true} prop="Sibling" />
          <span prop="Loading (1)" />
          <span prop="Loading (2)" />
          <span prop="Loading (3)" />
        </>,
      );

      await act(() => {
        resolveText('Step: 2');
      });
      assertLog(['Step: 2']);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Step: 2" />
          <span prop="Sibling" />
        </>,
      );
    });

    /** legacy A/B/C中B的子组件挂起，但包装B的类本身render返回元素，故A/B/C和fallback类都记录Mount；解析B仅日志B，不重渲染A/C或调用Update。验证挂起发生在后代与类自身render中的差别。 */
    // @gate enableLegacyCache && !disableLegacyMode
    it('does not re-render siblings in loose mode', async () => {
      /** 把文本render和类提交生命周期分开记录，便于观察legacy隐藏与retry。 */
      class TextWithLifecycle extends React.Component {
        /** TextWithLifecycle.componentDidMount 记录真实挂载提交，未提交的挂起尝试不得调用。 */
        componentDidMount() {
          Scheduler.log(`Mount [${this.props.text}]`);
        }
        /** TextWithLifecycle.componentDidUpdate 记录已提交更新，用于区分恢复复用与重新挂载。 */
        componentDidUpdate() {
          Scheduler.log(`Update [${this.props.text}]`);
        }
        /** 只返回Text元素，类render自身不会读取待决资源。 */
        render() {
          return <Text {...this.props} />;
        }
      }

      /** 类render只返回AsyncText元素，挂起在后代，因此legacy初挂可执行本类DidMount。 */
      class AsyncTextWithLifecycle extends React.Component {
        /** AsyncTextWithLifecycle.componentDidMount 记录真实挂载提交，未提交的挂起尝试不得调用。 */
        componentDidMount() {
          Scheduler.log(`Mount [${this.props.text}]`);
        }
        /** AsyncTextWithLifecycle.componentDidUpdate 记录已提交更新，用于区分恢复复用与重新挂载。 */
        componentDidUpdate() {
          Scheduler.log(`Update [${this.props.text}]`);
        }
        /** 返回AsyncText元素，类自身render没有读取资源。 */
        render() {
          return <AsyncText {...this.props} />;
        }
      }

      /** A/C同步类与子树挂起的B类并列，fallback也用带生命周期的类包装。 */
      function App() {
        return (
          <Suspense fallback={<TextWithLifecycle text="Loading..." />}>
            <TextWithLifecycle text="A" />
            <AsyncTextWithLifecycle text="B" />
            <TextWithLifecycle text="C" />
          </Suspense>
        );
      }

      ReactNoop.renderLegacySyncRoot(<App />, () =>
        Scheduler.log('Commit root'),
      );
      assertLog([
        'A',
        'Suspend! [B]',
        'C',

        'Loading...',
        'Mount [A]',
        'Mount [B]',
        'Mount [C]',
        'Mount [Loading...]',
        'Commit root',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span hidden={true} prop="A" />
          <span hidden={true} prop="C" />

          <span prop="Loading..." />
        </>,
      );

      await act(() => {
        resolveText('B');
      });

      assertLog(['B']);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="A" />
          <span prop="B" />
          <span prop="C" />
        </>,
      );
    });

    /** legacy类constructor读取Hi而挂起，第一次只见constructor/Suspend/Loading；解析Hi后重新constructor、render Hi和DidMount。验证失败构造不留下可提交的实例。 */
    // @gate enableLegacyCache && !disableLegacyMode
    it('suspends inside constructor', async () => {
      /** 在构造尚未结束时读取资源，核对重试重新构造与成功挂载。 */
      class AsyncTextInConstructor extends React.Component {
        /** 初始化 AsyncTextInConstructor.constructor 的 props 与实例状态；构造未完成时抛出的 thenable 不得提交半初始化实例。 */
        constructor(props) {
          super(props);
          const text = props.text;
          Scheduler.log('constructor');
          readText(text);
          this.state = {text};
        }
        /** AsyncTextInConstructor.componentDidMount 记录真实挂载提交，未提交的挂起尝试不得调用。 */
        componentDidMount() {
          Scheduler.log('componentDidMount');
        }
        /** 输出构造成功后保存在state.text的宿主span并记录文本。 */
        render() {
          Scheduler.log(this.state.text);
          return <span prop={this.state.text} />;
        }
      }

      ReactNoop.renderLegacySyncRoot(
        <Suspense fallback={<Text text="Loading..." />}>
          <AsyncTextInConstructor text="Hi" />
        </Suspense>,
      );

      assertLog(['constructor', 'Suspend! [Hi]', 'Loading...']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);

      await act(() => {
        resolveText('Hi');
      });

      assertLog(['constructor', 'Hi', 'componentDidMount']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Hi" />);
    });

    /** legacy fallback类DidMount把name从foo改bar，虽然render仍固定Loading，也应只多渲染一次并收敛；解析Hi后输出Hi。验证fallback生命周期的state更新不造成无限重试。 */
    // @gate enableLegacyCache && !disableLegacyMode
    it('does not infinite loop if fallback contains lifecycle method', async () => {
      /** 挂载后把name改为bar，但UI固定Loading，检测fallback更新是否收敛。 */
      class Fallback extends React.Component {
        /** name从foo改bar仅触发重渲染，不参与宿主文本计算。 */
        state = {
          name: 'foo',
        };
        /** 把name从foo改bar，刻意让fallback在挂载后再渲染一次；这里没有日志。 */
        componentDidMount() {
          this.setState({
            name: 'bar',
          });
        }
        /** 固定返回Loading文本，不根据state.name改变UI。 */
        render() {
          return <Text text="Loading..." />;
        }
      }

      /** 只包裹Hi资源与会在挂载后更新自己的Fallback。 */
      class Demo extends React.Component {
        /** 返回包裹Hi资源和Fallback类的边界。 */
        render() {
          return (
            <Suspense fallback={<Fallback />}>
              <AsyncText text="Hi" />
            </Suspense>
          );
        }
      }

      ReactNoop.renderLegacySyncRoot(<Demo />);

      assertLog([
        'Suspend! [Hi]',
        'Loading...',
        'Loading...',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);
      await act(() => {
        resolveText('Hi');
      });
      assertLog(['Hi']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Hi" />);
    });

    if (global.__PERSISTENT__) {
      /** persistent模式legacy主树span下Hi初挂待决；Parent layout读取pending children，已看到hidden span及Loading；解析Hi只日志Hi。验证持久化宿主的隐藏结果在layout前已准备，不断言新的Parent layout日志。 */
      // @gate enableLegacyCache && !disableLegacyMode
      it('hides/unhides suspended children before layout effects fire (persistent)', async () => {
        const {useRef, useLayoutEffect} = React;

        /** 在主树span下读Hi，layout中观察该宿主隐藏状态（persistent读取pending children，mutation读取ref）。 */
        function Parent() {
          const child = useRef(null);

          useLayoutEffect(() => {
            Scheduler.log(ReactNoop.getPendingChildrenAsJSX());
          });

          return (
            <span ref={child} hidden={false}>
              <AsyncText text="Hi" />
            </span>
          );
        }

        /** 包裹Parent的span/Hi，检查持久化宿主隐藏在layout前完成。 */
        function App(props) {
          return (
            <Suspense fallback={<Text text="Loading..." />}>
              <Parent />
            </Suspense>
          );
        }

        ReactNoop.renderLegacySyncRoot(<App middleText="B" />);

        assertLog([
          'Suspend! [Hi]',
          'Loading...',
          <>
            <span hidden={true} />
            <span prop="Loading..." />
          </>,
        ]);

        await act(() => {
          resolveText('Hi');
        });
        assertLog(['Hi']);
      });
    } else {
      /** mutation模式legacy主树span下Hi初挂待决；Parent layout通过ref读取hidden=true，解析Hi只日志Hi。验证mutation隐藏先于layout观察。 */
      // @gate enableLegacyCache && !disableLegacyMode
      it('hides/unhides suspended children before layout effects fire (mutation)', async () => {
        const {useRef, useLayoutEffect} = React;

        /** 在主树span下读Hi，layout中观察该宿主隐藏状态（persistent读取pending children，mutation读取ref）。 */
        function Parent() {
          const child = useRef(null);

          useLayoutEffect(() => {
            Scheduler.log('Child is hidden: ' + child.current.hidden);
          });

          return (
            <span ref={child} hidden={false}>
              <AsyncText text="Hi" />
            </span>
          );
        }

        /** 包裹Parent的span/Hi，检查mutation宿主ref.hidden在layout前更新。 */
        function App(props) {
          return (
            <Suspense fallback={<Text text="Loading..." />}>
              <Parent />
            </Suspense>
          );
        }

        ReactNoop.renderLegacySyncRoot(<App middleText="B" />);

        assertLog([
          'Suspend! [Hi]',
          'Loading...',
          'Child is hidden: true',
        ]);

        await act(() => {
          resolveText('Hi');
        });

        assertLog(['Hi']);
      });
    }

    /** legacy树中Async挂起后，其祖先errorInCompletePhase宿主在complete阶段抛宿主配置错误；错误边界显示Caught an error，验证返回路径的错误可取代Suspense挂起处理。 */
    // @gate enableLegacyCache && !disableLegacyMode
    it('handles errors in the return path of a component that suspends', async () => {
      /** 用getDerivedStateFromError保存complete阶段宿主错误，再输出捕获消息。 */
      class ErrorBoundary extends React.Component {
        /** null表示正常children，捕获错误后保存Error并显示消息。 */
        state = {error: null};
        /** ErrorBoundary.getDerivedStateFromError 把资源 rejection 后的业务错误交给错误边界状态与日志。 */
        static getDerivedStateFromError(error, errorInfo) {
          return {error};
        }
        /** 错误非null时显示捕获消息，否则透传children。 */
        render() {
          if (this.state.error) {
            return `Caught an error: ${this.state.error.message}`;
          }
          return this.props.children;
        }
      }

      ReactNoop.renderLegacySyncRoot(
        <ErrorBoundary>
          <Suspense fallback="Loading...">
            <errorInCompletePhase>
              <AsyncText text="Async" />
            </errorInCompletePhase>
          </Suspense>
        </ErrorBoundary>,
      );

      assertLog(['Suspend! [Async]']);
      expect(ReactNoop).toMatchRenderedOutput(
        'Caught an error: Error in host config.',
      );
    });

    /** legacy Child首次已安装passive effect，随后改为在调用Hook前抛never并显示Loading；删除根时仍记录Unmount。验证挂起尝试不会丢失上次已挂载的effect链。 */
    // @gate !disableLegacyMode
    it('does not drop mounted effects', async () => {
      /** then 实现 thenable 订阅：pending 时登记 ping，已结束时用微任务通知。 */
      const never = {/** 永不主动 ping 的 thenable 协议入口。 */ then() {}};

      let setShouldSuspend;
      /** 保存shouldSuspend状态并传入Child，使其已安装effect后再在Hook前挂起。 */
      function App() {
        const [shouldSuspend, _setShouldSuspend] = React.useState(0);
        setShouldSuspend = _setShouldSuspend;
        return (
          <Suspense fallback="Loading...">
            <Child shouldSuspend={shouldSuspend} />
          </Suspense>
        );
      }

      /** 若shouldSuspend为真，在Hook前抛never；正常时安装passive create/cleanup并返回Child。 */
      function Child({shouldSuspend}) {
        if (shouldSuspend) {
          throw never;
        }

        React.useEffect(() => {
          Scheduler.log('Mount');
          return () => {
            Scheduler.log('Unmount');
          };
        }, []);

        return 'Child';
      }

      const root = ReactNoop.createLegacyRoot(null);
      await act(() => {
        root.render(<App />);
      });
      assertLog(['Mount']);
      expect(root).toMatchRenderedOutput('Child');

      await act(() => {
        setShouldSuspend(true);
      });
      expect(root).toMatchRenderedOutput('Loading...');

      await act(() => {
        root.render(null);
      });
      assertLog(['Unmount']);
    });
  });

  /** legacy A/B/C中B类自身render先readText并挂起；初始仅A/C/fallback的Mount，没有Mount B，输出隐藏A/C与Loading。验证真正抛thenable的类不执行未完成挂载生命周期。 */
  // @gate enableLegacyCache && !disableLegacyMode
  it('does not call lifecycles of a suspended component', async () => {
    /** 把文本render和类提交生命周期分开记录，便于观察legacy隐藏与retry。 */
    class TextWithLifecycle extends React.Component {
      /** TextWithLifecycle.componentDidMount 记录真实挂载提交，未提交的挂起尝试不得调用。 */
      componentDidMount() {
        Scheduler.log(`Mount [${this.props.text}]`);
      }
      /** TextWithLifecycle.componentDidUpdate 记录已提交更新，用于区分恢复复用与重新挂载。 */
      componentDidUpdate() {
        Scheduler.log(`Update [${this.props.text}]`);
      }
      /** TextWithLifecycle.componentWillUnmount 记录卸载生命周期；并发 Offscreen 隐藏已可见树也会调用此方法，未挂载节点不会调用。 */
      componentWillUnmount() {
        Scheduler.log(`Unmount [${this.props.text}]`);
      }
      /** 只返回Text元素，类render自身不会读取待决资源。 */
      render() {
        return <Text {...this.props} />;
      }
    }

    /** 类render自己读取资源并可能挂起，用Mount日志验证未完成render不执行DidMount。 */
    class AsyncTextWithLifecycle extends React.Component {
      /** AsyncTextWithLifecycle.componentDidMount 记录真实挂载提交，未提交的挂起尝试不得调用。 */
      componentDidMount() {
        Scheduler.log(`Mount [${this.props.text}]`);
      }
      /** AsyncTextWithLifecycle.componentDidUpdate 记录已提交更新，用于区分恢复复用与重新挂载。 */
      componentDidUpdate() {
        Scheduler.log(`Update [${this.props.text}]`);
      }
      /** AsyncTextWithLifecycle.componentWillUnmount 记录卸载生命周期；并发 Offscreen 隐藏已可见树也会调用此方法，未挂载节点不会调用。 */
      componentWillUnmount() {
        Scheduler.log(`Unmount [${this.props.text}]`);
      }
      /** 先readText读取props.text，成功后才记录并返回span；pending时类render本身抛thenable。 */
      render() {
        const text = this.props.text;
        readText(text);
        Scheduler.log(text);
        return <span prop={text} />;
      }
    }

    /** A/C同步类与render自身挂起的B类并列，fallback记录挂载。 */
    function App() {
      return (
        <Suspense fallback={<TextWithLifecycle text="Loading..." />}>
          <TextWithLifecycle text="A" />
          <AsyncTextWithLifecycle text="B" />
          <TextWithLifecycle text="C" />
        </Suspense>
      );
    }

    ReactNoop.renderLegacySyncRoot(<App />, () => Scheduler.log('Commit root'));
    assertLog([
      'A',
      'Suspend! [B]',
      'C',
      'Loading...',

      'Mount [A]',
      // 'Mount [B]',
      'Mount [C]',
      'Mount [Loading...]',
      'Commit root',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span hidden={true} prop="A" />
        <span hidden={true} prop="C" />
        <span prop="Loading..." />
      </>,
    );
  });

  /** legacy Hook组件在readText前注册layout/passive；B初挂挂起时只A/C/fallback生效，B完成后安装B；改为B2挂起时旧B effects保留，B2完成才依赖变化清理B并安装B2。验证注册不等于提交。 */
  // @gate enableLegacyCache && !disableLegacyMode
  it('does not call lifecycles of a suspended component (hooks)', async () => {
    /** 记录 text 对应的 layout/passive create 与 cleanup，观察挂起后尚未提交的 Effect。 */
    function TextWithLifecycle(props) {
      React.useLayoutEffect(() => {
        Scheduler.log(`Layout Effect [${props.text}]`);
        return () => {
          Scheduler.log(`Destroy Layout Effect [${props.text}]`);
        };
      }, [props.text]);
      React.useEffect(() => {
        Scheduler.log(`Effect [${props.text}]`);
        return () => {
          Scheduler.log(`Destroy Effect [${props.text}]`);
        };
      }, [props.text]);
      return <Text {...props} />;
    }

    /** 先注册依赖text的layout/passive effect，再读取资源；挂起时新effect不得提交。 */
    function AsyncTextWithLifecycle(props) {
      React.useLayoutEffect(() => {
        Scheduler.log(`Layout Effect [${props.text}]`);
        return () => {
          Scheduler.log(`Destroy Layout Effect [${props.text}]`);
        };
      }, [props.text]);
      React.useEffect(() => {
        Scheduler.log(`Effect [${props.text}]`);
        return () => {
          Scheduler.log(`Destroy Effect [${props.text}]`);
        };
      }, [props.text]);
      const text = props.text;
      readText(text);
      Scheduler.log(text);
      return <span prop={text} />;
    }

    /** 参数text控制异步Hook组件，固定A/C提供已连接effect对照。 */
    function App({text}) {
      return (
        <Suspense fallback={<TextWithLifecycle text="Loading..." />}>
          <TextWithLifecycle text="A" />
          <AsyncTextWithLifecycle text={text} />
          <TextWithLifecycle text="C" />
        </Suspense>
      );
    }

    ReactNoop.renderLegacySyncRoot(<App text="B" />, () =>
      Scheduler.log('Commit root'),
    );
    assertLog([
      'A',
      'Suspend! [B]',
      'C',
      'Loading...',

      'Layout Effect [A]',
      // 'Layout Effect [B]',
      'Layout Effect [C]',
      'Layout Effect [Loading...]',
      'Commit root',
    ]);

    // 分段冲刷或让出调度工作，以锁定当前渲染检查点。
    await waitForAll([
      'Effect [A]',
      // 'Effect [B]',
      'Effect [C]',
      'Effect [Loading...]',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span hidden={true} prop="A" />
        <span hidden={true} prop="C" />
        <span prop="Loading..." />
      </>,
    );

    await act(() => {
      resolveText('B');
    });

    assertLog([
      'B',
      'Destroy Layout Effect [Loading...]',
      'Layout Effect [B]',
      'Destroy Effect [Loading...]',
      'Effect [B]',
    ]);

    ReactNoop.renderLegacySyncRoot(<App text="B2" />, () =>
      Scheduler.log('Commit root'),
    );

    assertLog([
      'A',
      'Suspend! [B2]',
      'C',
      'Loading...',

      // 'Layout Effect [B2]',
      'Layout Effect [Loading...]',
      'Commit root',
    ]);

    // 分段冲刷或让出调度工作，以锁定当前渲染检查点。
    await waitForAll([
      // 'Effect [B2]',
      'Effect [Loading...]',
    ]);

    await act(() => {
      resolveText('B2');
    });

    assertLog([
      'B2',
      'Destroy Layout Effect [Loading...]',
      'Destroy Layout Effect [B]',
      'Layout Effect [B2]',
      'Destroy Effect [Loading...]',
      'Destroy Effect [B]',
      'Effect [B2]',
    ]);
  });

  /** 外fallback已显示并推进5000ms，解析A后可立刻显示A/Loading more，随后B完成为AB。验证超过最近fallback节流窗口后可进入内层fallback。 */
  // @gate enableLegacyCache
  it('does not suspends if a fallback has been shown for a long time', async () => {
    /** 外边界含AsyncA及内边界AsyncB，比较长期fallback后的揭示。 */
    function Foo() {
      Scheduler.log('Foo');
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <AsyncText text="A" />
          <Suspense fallback={<Text text="Loading more..." />}>
            <AsyncText text="B" />
          </Suspense>
        </Suspense>
      );
    }

    ReactNoop.render(<Foo />);
    await waitForAll([
      'Foo',
      'Suspend! [A]',
      'Loading...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
      'Suspend! [B]',
      'Loading more...',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);

    Scheduler.unstable_advanceTime(5000);
    await advanceTimers(5000);

    // 使用新内容执行 Suspense retry。
    await resolveText('A');
    await waitForAll([
      'A',
      'Suspend! [B]',
      'Loading more...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [B]',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="Loading more..." />
      </>,
    );

    await act(() => resolveText('B'));
    assertLog(['B']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="B" />
      </>,
    );
  });

  /** 外fallback刚显示就解析A，仍保持Loading；再解析B，全树已完成时alwaysThrottleRetries=true仍保持一段fallback，false分支可直接显示AB，act结束均为AB。验证retry节流开关差异。 */
  // @gate enableLegacyCache
  it('throttles content from appearing if a fallback was shown recently', async () => {
    /** 外边界含AsyncA及内边界AsyncB，比较最近fallback的节流。 */
    function Foo() {
      Scheduler.log('Foo');
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <AsyncText text="A" />
          <Suspense fallback={<Text text="Loading more..." />}>
            <AsyncText text="B" />
          </Suspense>
        </Suspense>
      );
    }

    ReactNoop.render(<Foo />);
    await waitForAll([
      'Foo',
      'Suspend! [A]',
      'Loading...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
      'Suspend! [B]',
      'Loading more...',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);

    await act(async () => {
      await resolveText('A');

      // 使用新内容执行 Suspense retry。
      await waitForAll([
        'A',
        'Suspend! [B]',
        'Loading more...',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);

      await resolveText('B');
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);

      await waitForAll(['A', 'B']);

      if (gate(flags => flags.alwaysThrottleRetries)) {
        // 以下断言描述当前正确行为。
        //
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);
      } else {
        // 以下分支保留尚未完成灰度时的旧行为。
        //
        // TODO：该 render 来自 retry，且 fallback 最近显示过，本应继续保持 fallback 一小段时间。
        // 当前仅树中仍有其他 fallback 时才节流；理想上所有 retry 都应如此。
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="A" />
            <span prop="B" />
          </>,
        );
      }
    });
    assertLog([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="B" />
      </>,
    );
  });

  /** 两独立fallback显示后先解析A并推进10000ms使其提交；再200ms后解析B，alwaysThrottleRetries开启时仍保留Loading B，再推进100ms才为AB。验证最近一次内容填充也更新300ms节流时间。 */
  // @gate enableLegacyCache
  it('throttles content from appearing if a fallback was filled in recently', async () => {
    /** 把A/B放在两个独立边界中，观察最近一次内容填充后的retry节流。 */
    function Foo() {
      Scheduler.log('Foo');
      return (
        <>
          <Suspense fallback={<Text text="Loading A..." />}>
            <AsyncText text="A" />
          </Suspense>
          <Suspense fallback={<Text text="Loading B..." />}>
            <AsyncText text="B" />
          </Suspense>
        </>
      );
    }

    ReactNoop.render(<Foo />);
    await waitForAll([
      'Foo',
      'Suspend! [A]',
      'Loading A...',
      'Suspend! [B]',
      'Loading B...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
      'Suspend! [B]',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Loading A..." />
        <span prop="Loading B..." />
      </>,
    );

    await act(async () => {
      await resolveText('A');

      Scheduler.unstable_advanceTime(10000);
      jest.advanceTimersByTime(10000);
      if (gate(flags => flags.enableYieldingBeforePassive)) {
        await waitForPaint([]);
      }
      await waitForPaint(['A']);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="A" />
          <span prop="Loading B..." />
        </>,
      );
    });

    Scheduler.unstable_advanceTime(200);
    jest.advanceTimersByTime(200);

    await act(async () => {
      await resolveText('B');
      await waitForPaint(['B']);

      if (gate(flags => flags.alwaysThrottleRetries)) {
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="A" />
            <span prop="Loading B..." />
          </>,
        );

        Scheduler.unstable_advanceTime(100);
        jest.advanceTimersByTime(100);
        await waitForAll([]);
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="A" />
            <span prop="B" />
          </>,
        );
      } else {
        // 以下分支保留尚未完成灰度时的旧行为。
        //
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="A" />
            <span prop="B" />
          </>,
        );
      }
    });
  });

  // TODO：该行为重新实现后，把用例名从 “does not warn” 改为 “warns”。
  /** 函数state初始show=false；flushSync打开后读取待决A。当前仅要求整个act不出现未断言告警，TODO说明尚无专门优先级诊断断言；不把标题解释成实际低优先级state更新。 */
  // @gate enableLegacyCache
  it('does not warn when a low priority update suspends inside a high priority update for functional components', async () => {
    let _setShow;
    /** 保存show Hook状态，打开后在已有边界内读待决A。 */
    function App() {
      const [show, setShow] = React.useState(false);
      _setShow = setShow;
      return (
        <Suspense fallback="Loading...">
          {show && <AsyncText text="A" />}
        </Suspense>
      );
    }

    await act(() => {
      ReactNoop.render(<App />);
    });

    // TODO：告警重新实现后，在此补回 `assertConsoleErrorDev()` 断言。
    await act(() => {
      ReactNoop.flushSync(() => _setShow(true));
    });
  });

  // TODO：该行为重新实现后，把用例名从 “does not warn” 改为 “warns”。
  /** 类state初始show=false；render暴露show闭包，flushSync调用使A挂起。当前无专门console断言和输出断言，验证该同步更新路径完成，保留未来恢复诊断的TODO。 */
  // @gate enableLegacyCache
  it('does not warn when a low priority update suspends inside a high priority update for class components', async () => {
    let show;
    /** 通过类实例 state 决定是否挂载新的 AsyncText，供指定优先级的更新触发挂起。 */
    class App extends React.Component {
      /** 保存本例show/page开关，初始尚不显示异步资源。 */
      state = {show: false};

      /** 暴露当前实例更新入口，再按state的show/page分支返回资源边界或空shell。 */
      render() {
        /** 使当前类实例显示A资源；调用方决定更新优先级，参数不会被消费。 */
        show = () => this.setState({show: true});
        return (
          <Suspense fallback="Loading...">
            {this.state.show && <AsyncText text="A" />}
          </Suspense>
        );
      }
    }

    await act(() => {
      ReactNoop.render(<App />);
    });

    // TODO：告警重新实现后，在此补回 `assertConsoleErrorDev()` 断言。
    await act(() => {
      ReactNoop.flushSync(() => show());
    });
  });

  /** 类边界初始A待决已显示Loading；flushSync打开showB后预热同时读取A/B，仍没有新的外fallback。断言具体挂起日志，验证已有fallback中的新挂起工作可继续。 */
  // @gate enableLegacyCache
  it('does not warn about wrong Suspense priority if no new fallbacks are shown', async () => {
    let showB;
    /** 通过类实例 state 决定是否挂载新的 AsyncText，供指定优先级的更新触发挂起。 */
    class App extends React.Component {
      /** 保存本例show/page开关，初始尚不显示异步资源。 */
      state = {showB: false};

      /** 暴露当前实例更新入口，再按state的show/page分支返回资源边界或空shell。 */
      render() {
        /** 在已因A挂起的主树中追加B资源，由flushSync驱动该实例更新。 */
        showB = () => this.setState({showB: true});
        return (
          <Suspense fallback="Loading...">
            {<AsyncText text="A" />}
            {this.state.showB && <AsyncText text="B" />}
          </Suspense>
        );
      }
    }

    await act(() => {
      ReactNoop.render(<App />);
    });

    assertLog([
      'Suspend! [A]',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
    ]);
    expect(ReactNoop).toMatchRenderedOutput('Loading...');

    await act(() => {
      ReactNoop.flushSync(() => showB());
    });

    assertLog([
      'Suspend! [A]',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
      'Suspend! [B]',
    ]);
  });

  // TODO：该行为重新实现后，把用例名从 “does not warn” 改为 “warns”。
  /** 在Suspense与AsyncText之间的函数A持有show state；flushSync打开它触发资源挂起。当前无专门诊断或输出断言，覆盖更新来源位于边界后代的路径。 */
  // @gate enableLegacyCache
  it(
    'does not warn when component that triggered user-blocking update is between Suspense boundary ' +
      'and component that suspended',
    async () => {
      let _setShow;
      /** 暴露 setShow，在边界与 AsyncText 之间发起更新并触发资源读取。 */
      function A() {
        const [show, setShow] = React.useState(false);
        _setShow = setShow;
        return show && <AsyncText text="A" />;
      }
      /** 在边界内通过有状态A发起更新，挂起源AsyncText再位于它的后代。 */
      function App() {
        return (
          <Suspense fallback="Loading...">
            <A />
          </Suspense>
        );
      }
      await act(() => {
        ReactNoop.render(<App />);
      });

      // TODO：告警重新实现后，在此补回 `assertConsoleErrorDev()` 断言。
      await act(() => {
        ReactNoop.flushSync(() => _setShow(true));
      });
    },
  );

  /** 类show=false先挂载，普通act内调用show闭包使A挂起并预热；解析A后尚未冲刷工作，输出仍Loading。验证普通更新挂起日志和未冲刷ping时输出，不宣称恢复已完成。 */
  // @gate enableLegacyCache
  it('normal priority updates suspending do not warn for class components', async () => {
    let show;
    /** 通过类实例 state 决定是否挂载新的 AsyncText，供指定优先级的更新触发挂起。 */
    class App extends React.Component {
      /** 保存本例show/page开关，初始尚不显示异步资源。 */
      state = {show: false};

      /** 暴露当前实例更新入口，再按state的show/page分支返回资源边界或空shell。 */
      render() {
        /** 使当前类实例显示A资源；调用方决定更新优先级，参数不会被消费。 */
        show = () => this.setState({show: true});
        return (
          <Suspense fallback="Loading...">
            {this.state.show && <AsyncText text="A" />}
          </Suspense>
        );
      }
    }

    await act(() => {
      ReactNoop.render(<App />);
    });

    await act(() => show(true));

    assertLog([
      'Suspend! [A]',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
    ]);
    await resolveText('A');

    expect(ReactNoop).toMatchRenderedOutput('Loading...');
  });

  /** 函数show=false先挂载，普通state更新使A挂起并预热；解析A但尚未冲刷时仍Loading。与上一例区分类与Hook更新来源，不添加同步优先级结论。 */
  // @gate enableLegacyCache
  it('normal priority updates suspending do not warn for functional components', async () => {
    let _setShow;
    /** 保存show Hook状态，普通更新打开后在已有边界内读取A。 */
    function App() {
      const [show, setShow] = React.useState(false);
      _setShow = setShow;
      return (
        <Suspense fallback="Loading...">
          {show && <AsyncText text="A" />}
        </Suspense>
      );
    }

    await act(() => {
      ReactNoop.render(<App />);
    });

    await act(() => _setShow(true));

    assertLog([
      'Suspend! [A]',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
    ]);
    await resolveText('A');

    expect(ReactNoop).toMatchRenderedOutput('Loading...');
  });

  /** 内层avoidThisFallback读A初挂时选择外Initial load；A完成后普通更新追加C，推进600ms后使用内Updating并隐藏旧A，B继续可见，C完成后为ACB。验证已有可见shell可允许内fallback。 */
  // @gate enableLegacyCache && enableSuspenseAvoidThisFallback
  it('shows the parent fallback if the inner fallback should be avoided', async () => {
    /** 外Initial load下内避让边界读取A并可追加C，B位于内边界外。 */
    function Foo({showC}) {
      Scheduler.log('Foo');
      return (
        <Suspense fallback={<Text text="Initial load..." />}>
          <Suspense
            unstable_avoidThisFallback={true}
            fallback={<Text text="Updating..." />}>
            <AsyncText text="A" />
            {showC ? <AsyncText text="C" /> : null}
          </Suspense>
          <Text text="B" />
        </Suspense>
      );
    }

    ReactNoop.render(<Foo />);
    await waitForAll([
      'Foo',
      'Suspend! [A]',
      'Initial load...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
      'B',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="Initial load..." />);

    await act(() => resolveText('A'));
    assertLog(['A', 'B']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="B" />
      </>,
    );

    ReactNoop.render(<Foo showC={true} />);
    await waitForAll([
      'Foo',
      'A',
      'Suspend! [C]',
      'Updating...',
      'B',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'A',
      'Suspend! [C]',
    ]);
    Scheduler.unstable_advanceTime(600);
    await advanceTimers(600);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" hidden={true} />
        <span prop="Updating..." />
        <span prop="B" />
      </>,
    );

    // 随后解决数据资源并观察主内容恢复。
    await act(() => resolveText('C'));
    assertLog(['A', 'C']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="C" />
        <span prop="B" />
      </>,
    );
  });

  /** 内层没有fallback且外层有Initial load：初挂A待决只显示兄弟B；A完成后追加C，推进600ms时仅隐藏旧A而B保留，C完成为ACB。验证undefined fallback由内边界捕获，不必冒泡。 */
  // @gate enableLegacyCache
  it('does not show the parent fallback if the inner fallback is not defined', async () => {
    /** 内边界省略fallback，读A并可追加C；外边界保留Initial load和同步B。 */
    function Foo({showC}) {
      Scheduler.log('Foo');
      return (
        <Suspense fallback={<Text text="Initial load..." />}>
          <Suspense>
            <AsyncText text="A" />
            {showC ? <AsyncText text="C" /> : null}
          </Suspense>
          <Text text="B" />
        </Suspense>
      );
    }

    ReactNoop.render(<Foo />);
    await waitForAll([
      'Foo',
      'Suspend! [A]',
      'B',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="B" />);

    await act(() => resolveText('A'));
    assertLog(['A']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="B" />
      </>,
    );

    ReactNoop.render(<Foo showC={true} />);
    await waitForAll([
      'Foo',
      'A',
      'Suspend! [C]',
      // 该检查点预期为空值，不应提交可见行。
      'B',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'A',
      'Suspend! [C]',
    ]);
    Scheduler.unstable_advanceTime(600);
    await advanceTimers(600);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" hidden={true} />
        <span prop="B" />
      </>,
    );

    // 随后解决数据资源并观察主内容恢复。
    await act(() => resolveText('C'));
    assertLog(['A', 'C']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="C" />
        <span prop="B" />
      </>,
    );
  });

  /** 内外两个顶层边界都标avoidThisFallback且外有同步A、内读待决B；推进600ms后显示A/Loading B，不使用外Loading A。验证不存在可避让的父shell时使用内层边界。 */
  // @gate enableLegacyCache
  it('favors showing the inner fallback for nested top level avoided fallback', async () => {
    /** 内外都标避让，外含同步A，内始终读取AsyncB；showB形参没有被使用。 */
    function Foo({showB}) {
      Scheduler.log('Foo');
      return (
        <Suspense
          unstable_avoidThisFallback={true}
          fallback={<Text text="Loading A..." />}>
          <Text text="A" />
          <Suspense
            unstable_avoidThisFallback={true}
            fallback={<Text text="Loading B..." />}>
            <AsyncText text="B" />
          </Suspense>
        </Suspense>
      );
    }

    ReactNoop.render(<Foo />);
    await waitForAll([
      'Foo',
      'A',
      'Suspend! [B]',
      'Loading B...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [B]',
    ]);
    Scheduler.unstable_advanceTime(600);
    await advanceTimers(600);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="Loading B..." />
      </>,
    );
  });

  /** 已有A的可见shell后transition追加内层避让边界B；日志会渲染Loading B，但最终仍A。标题提及parent fallback，本体实际上从A主内容开始，验证transition保持已显示内容。 */
  // @gate enableLegacyCache && enableSuspenseAvoidThisFallback
  it('keeps showing an avoided parent fallback if it is already showing', async () => {
    /** Initial load下嵌套两层避让边界，showB控制新B边界挂载。 */
    function Foo({showB}) {
      Scheduler.log('Foo');
      return (
        <Suspense fallback={<Text text="Initial load..." />}>
          <Suspense
            unstable_avoidThisFallback={true}
            fallback={<Text text="Loading A..." />}>
            <Text text="A" />
            {showB ? (
              <Suspense
                unstable_avoidThisFallback={true}
                fallback={<Text text="Loading B..." />}>
                <AsyncText text="B" />
              </Suspense>
            ) : null}
          </Suspense>
        </Suspense>
      );
    }

    ReactNoop.render(<Foo />);
    await waitForAll(['Foo', 'A']);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);

    React.startTransition(() => {
      ReactNoop.render(<Foo showB={true} />);
    });

    await waitForAll(['Foo', 'A', 'Suspend! [B]', 'Loading B...']);

    expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);
  });

  /** 已有A后transition追加fallback=undefined的内边界B；推进600ms仍显示A。验证transition不能仅因时间推进替换已显示shell为嵌套空fallback。 */
  // @gate enableLegacyCache
  it('keeps showing an undefined fallback if it is already showing', async () => {
    /** Initial load下嵌套两个undefined fallback边界，showB控制新B资源挂载。 */
    function Foo({showB}) {
      Scheduler.log('Foo');
      return (
        <Suspense fallback={<Text text="Initial load..." />}>
          <Suspense fallback={undefined}>
            <Text text="A" />
            {showB ? (
              <Suspense fallback={undefined}>
                <AsyncText text="B" />
              </Suspense>
            ) : null}
          </Suspense>
        </Suspense>
      );
    }

    ReactNoop.render(<Foo />);
    await waitForAll(['Foo', 'A']);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);

    React.startTransition(() => {
      ReactNoop.render(<Foo showB={true} />);
    });

    await waitForAll([
      'Foo',
      'A',
      'Suspend! [B]',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [B]',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);

    Scheduler.unstable_advanceTime(600);
    await advanceTimers(600);

    expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);
  });

  /** 通过 Noop 调度日志验证 Suspense 的优先级、ping、fallback、隐藏子树、错误和更新队列。 */
  describe('startTransition', () => {
    /** root.render在transition内初挂page A，400ms后可见Loading，再解析A；transition切page B并推进100000ms仍保留A，B完成后为B。验证新边界初挂与已显示边界更新的差别。 */
    // @gate enableLegacyCache
    it('top level render', async () => {
      /** 以page prop作为AsyncText资源键，区分新边界初挂与已有页面更新。 */
      function App({page}) {
        return (
          <Suspense fallback={<Text text="Loading..." />}>
            <AsyncText text={page} />
          </Suspense>
        );
      }

      React.startTransition(() => ReactNoop.render(<App page="A" />));

      await waitForAll([
        'Suspend! [A]',
        'Loading...',
        // 执行预热渲染，不把该遍结果作为最终提交。
        'Suspend! [A]',
      ]);
      Scheduler.unstable_advanceTime(400);
      await advanceTimers(400);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);

      // 随后解决数据资源并观察主内容恢复。
      await act(() => resolveText('A'));
      assertLog(['A']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);

      React.startTransition(() => ReactNoop.render(<App page="B" />));

      await waitForAll(['Suspend! [B]', 'Loading...']);
      Scheduler.unstable_advanceTime(100000);
      await advanceTimers(100000);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);
      // 随后解决数据资源并观察主内容恢复。
      await act(() => resolveText('B'));
      assertLog(['B']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="B" />);
    });

    /** Hook page从none开始，transition setter到A时创建新边界并显示Loading，A完成后再transition到B，100000ms仍A直至B完成。验证Hook队列更新保留可见shell。 */
    // @gate enableLegacyCache
    it('hooks', async () => {
      let transitionToPage;
      /** 保存page Hook state并暴露setter；none返回null，其他值进入同一边界。 */
      function App() {
        const [page, setPage] = React.useState('none');
        transitionToPage = setPage;
        if (page === 'none') {
          return null;
        }
        return (
          <Suspense fallback={<Text text="Loading..." />}>
            <AsyncText text={page} />
          </Suspense>
        );
      }

      ReactNoop.render(<App />);
      await waitForAll([]);

      await act(async () => {
        React.startTransition(() => transitionToPage('A'));

        await waitForAll([
          'Suspend! [A]',
          'Loading...',
          // 执行预热渲染，不把该遍结果作为最终提交。
          'Suspend! [A]',
        ]);
        Scheduler.unstable_advanceTime(400);
        await advanceTimers(400);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);
      });

      // 随后解决数据资源并观察主内容恢复。
      await act(() => resolveText('A'));
      assertLog(['A']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);

      await act(async () => {
        React.startTransition(() => transitionToPage('B'));

        await waitForAll(['Suspend! [B]', 'Loading...']);
        Scheduler.unstable_advanceTime(100000);
        await advanceTimers(100000);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);
      });
      // 随后解决数据资源并观察主内容恢复。
      await act(() => resolveText('B'));
      assertLog(['B']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="B" />);
    });

    /** 类page从none开始，transition调用setState闭包到A创建新边界，再到B时100000ms仍保留A，解析B后显示B。验证class队列具有相同shell保留语义。 */
    // @gate enableLegacyCache
    it('classes', async () => {
      let transitionToPage;
      /** 保存show或page状态，render暴露实例setState入口，外部控制其优先级。 */
      class App extends React.Component {
        /** 保存本例show/page开关，初始尚不显示异步资源。 */
        state = {page: 'none'};
        /** 暴露当前实例更新入口，再按state的show/page分支返回资源边界或空shell。 */
        render() {
          /** 将page写入当前类队列，transition语境由外部调用方提供。 */
          transitionToPage = page => this.setState({page});
          const page = this.state.page;
          if (page === 'none') {
            return null;
          }
          return (
            <Suspense fallback={<Text text="Loading..." />}>
              <AsyncText text={page} />
            </Suspense>
          );
        }
      }

      ReactNoop.render(<App />);
      await waitForAll([]);

      await act(async () => {
        React.startTransition(() => transitionToPage('A'));

        await waitForAll([
          'Suspend! [A]',
          'Loading...',
          // 执行预热渲染，不把该遍结果作为最终提交。
          'Suspend! [A]',
        ]);
        Scheduler.unstable_advanceTime(400);
        await advanceTimers(400);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);
      });

      // 随后解决数据资源并观察主内容恢复。
      await act(() => resolveText('A'));
      assertLog(['A']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);

      await act(async () => {
        React.startTransition(() => transitionToPage('B'));

        await waitForAll(['Suspend! [B]', 'Loading...']);
        Scheduler.unstable_advanceTime(100000);
        await advanceTimers(100000);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);
      });
      // 随后解决数据资源并观察主内容恢复。
      await act(() => resolveText('B'));
      assertLog(['B']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="B" />);
    });
  });

  /** 通过 Noop 调度日志验证 Suspense 的优先级、ping、fallback、隐藏子树、错误和更新队列。 */
  describe('delays transitions when using React.startTransition', () => {
    /** root transition初挂A先Loading再A；更新B待决2999ms仍A，B完成后再更新C待决100000ms仍B。验证transition延迟没有在此变成固定超时强制fallback。 */
    // @gate enableLegacyCache
    it('top level render', async () => {
      /** 以page prop作为资源键，观察连续transition保留已提交页面。 */
      function App({page}) {
        return (
          <Suspense fallback={<Text text="Loading..." />}>
            <AsyncText text={page} />
          </Suspense>
        );
      }

      React.startTransition(() => ReactNoop.render(<App page="A" />));

      await waitForAll([
        'Suspend! [A]',
        'Loading...',
        // 执行预热渲染，不把该遍结果作为最终提交。
        'Suspend! [A]',
      ]);
      Scheduler.unstable_advanceTime(400);
      await advanceTimers(400);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);

      // 随后解决数据资源并观察主内容恢复。
      await act(() => resolveText('A'));
      assertLog(['A']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);

      React.startTransition(() => ReactNoop.render(<App page="B" />));

      await waitForAll(['Suspend! [B]', 'Loading...']);
      Scheduler.unstable_advanceTime(2999);
      await advanceTimers(2999);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);

      // 随后解决数据资源并观察主内容恢复。
      await act(() => resolveText('B'));
      assertLog(['B']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="B" />);

      React.startTransition(() => ReactNoop.render(<App page="C" />));
      await waitForAll(['Suspend! [C]', 'Loading...']);

      Scheduler.unstable_advanceTime(100000);
      await advanceTimers(100000);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="B" />);
    });

    /** Hook page none→A初挂边界可显示Loading；A→B待决2999ms仍A，解析B后B→C待决100000ms仍B。验证连续Hook transitions保留上次已提交页面。 */
    // @gate enableLegacyCache
    it('hooks', async () => {
      let transitionToPage;
      /** 保存page Hook state并暴露setter；none为空shell，其余page由AsyncText读取。 */
      function App() {
        const [page, setPage] = React.useState('none');
        transitionToPage = setPage;
        if (page === 'none') {
          return null;
        }
        return (
          <Suspense fallback={<Text text="Loading..." />}>
            <AsyncText text={page} />
          </Suspense>
        );
      }

      ReactNoop.render(<App />);
      await waitForAll([]);

      await act(async () => {
        React.startTransition(() => transitionToPage('A'));

        await waitForAll([
          'Suspend! [A]',
          'Loading...',
          // 执行预热渲染，不把该遍结果作为最终提交。
          'Suspend! [A]',
        ]);
        Scheduler.unstable_advanceTime(400);
        await advanceTimers(400);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);
      });

      // 随后解决数据资源并观察主内容恢复。
      await act(() => resolveText('A'));
      assertLog(['A']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);

      await act(async () => {
        React.startTransition(() => transitionToPage('B'));

        await waitForAll(['Suspend! [B]', 'Loading...']);

        Scheduler.unstable_advanceTime(2999);
        await advanceTimers(2999);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);
      });

      // 随后解决数据资源并观察主内容恢复。
      await act(() => resolveText('B'));
      assertLog(['B']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="B" />);

      await act(async () => {
        React.startTransition(() => transitionToPage('C'));

        await waitForAll(['Suspend! [C]', 'Loading...']);

        Scheduler.unstable_advanceTime(100000);
        await advanceTimers(100000);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="B" />);
      });
    });

    /** 类page none→A初挂显示Loading；A→B待决2999ms仍A，解析B后B→C待决100000ms仍B。与Hook例区分更新载体而保持相同页面结果。 */
    // @gate enableLegacyCache
    it('classes', async () => {
      let transitionToPage;
      /** 保存show或page状态，render暴露实例setState入口，外部控制其优先级。 */
      class App extends React.Component {
        /** 保存本例show/page开关，初始尚不显示异步资源。 */
        state = {page: 'none'};
        /** 暴露当前实例更新入口，再按state的show/page分支返回资源边界或空shell。 */
        render() {
          /** 将page写入当前类队列，transition语境由外部调用方提供。 */
          transitionToPage = page => this.setState({page});
          const page = this.state.page;
          if (page === 'none') {
            return null;
          }
          return (
            <Suspense fallback={<Text text="Loading..." />}>
              <AsyncText text={page} />
            </Suspense>
          );
        }
      }

      ReactNoop.render(<App />);
      await waitForAll([]);

      await act(async () => {
        React.startTransition(() => transitionToPage('A'));

        await waitForAll([
          'Suspend! [A]',
          'Loading...',
          // 执行预热渲染，不把该遍结果作为最终提交。
          'Suspend! [A]',
        ]);
        Scheduler.unstable_advanceTime(400);
        await advanceTimers(400);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);
      });

      // 随后解决数据资源并观察主内容恢复。
      await act(() => resolveText('A'));
      assertLog(['A']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);

      await act(async () => {
        React.startTransition(() => transitionToPage('B'));

        await waitForAll(['Suspend! [B]', 'Loading...']);
        Scheduler.unstable_advanceTime(2999);
        await advanceTimers(2999);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);
      });

      // 随后解决数据资源并观察主内容恢复。
      await act(() => resolveText('B'));
      assertLog(['B']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="B" />);

      await act(async () => {
        React.startTransition(() => transitionToPage('C'));

        await waitForAll(['Suspend! [C]', 'Loading...']);

        Scheduler.unstable_advanceTime(100000);
        await advanceTimers(100000);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="B" />);
      });
    });
  });

  /** Hi/A已经显示的避让边界transition更新到B；Loading B虽被渲染，推进1800ms仍Hi/A，B完成才Hi/B。验证更新已有避让边界不会用新占位替换旧shell。 */
  // @gate enableLegacyCache && enableSuspenseAvoidThisFallback
  it('do not show placeholder when updating an avoided boundary with startTransition', async () => {
    /** 外边界有Hi，内避让边界按page读资源；更新保留原页面。 */
    function App({page}) {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <Text text="Hi!" />
          <Suspense
            fallback={<Text text={'Loading ' + page + '...'} />}
            unstable_avoidThisFallback={true}>
            <AsyncText text={page} />
          </Suspense>
        </Suspense>
      );
    }

    ReactNoop.render(<App page="A" />);
    await waitForAll([
      'Hi!',
      'Suspend! [A]',
      'Loading...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Hi!',
      'Suspend! [A]',
    ]);
    await act(() => resolveText('A'));
    assertLog(['Hi!', 'A']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Hi!" />
        <span prop="A" />
      </>,
    );

    React.startTransition(() => ReactNoop.render(<App page="B" />));

    await waitForAll(['Hi!', 'Suspend! [B]', 'Loading B...']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Hi!" />
        <span prop="A" />
      </>,
    );
    Scheduler.unstable_advanceTime(1800);
    await advanceTimers(1800);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Hi!" />
        <span prop="A" />
      </>,
    );
    await resolveText('B');
    await waitForAll(['Hi!', 'B']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Hi!" />
        <span prop="B" />
      </>,
    );
  });

  /** Hi/A同步内容已显示，transition把A位置换成新的避让边界B；推进1800ms仍Hi/A，B完成为Hi/B。验证新避让边界挂载也可由已有父shell延迟。 */
  // @gate enableLegacyCache && enableSuspenseAvoidThisFallback
  it('do not show placeholder when mounting an avoided boundary with startTransition', async () => {
    /** 外边界有Hi，page A为同步文本，其余page创建新的避让边界。 */
    function App({page}) {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <Text text="Hi!" />
          {page === 'A' ? (
            <Text text="A" />
          ) : (
            <Suspense
              fallback={<Text text={'Loading ' + page + '...'} />}
              unstable_avoidThisFallback={true}>
              <AsyncText text={page} />
            </Suspense>
          )}
        </Suspense>
      );
    }

    ReactNoop.render(<App page="A" />);
    await waitForAll(['Hi!', 'A']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Hi!" />
        <span prop="A" />
      </>,
    );

    React.startTransition(() => ReactNoop.render(<App page="B" />));

    await waitForAll(['Hi!', 'Suspend! [B]', 'Loading B...']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Hi!" />
        <span prop="A" />
      </>,
    );
    Scheduler.unstable_advanceTime(1800);
    await advanceTimers(1800);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Hi!" />
        <span prop="A" />
      </>,
    );
    await resolveText('B');
    await waitForAll(['Hi!', 'B']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Hi!" />
        <span prop="B" />
      </>,
    );
  });

  /** 类Foo初始正常显示，state改suspend=true并等待Suspend日志后，进行中再改false；最终仅Foo日志和输出。验证挂起后清理调试阶段，不误报后续setState为render-phase更新。 */
  it('regression test: resets current "debug phase" after suspending', async () => {
    /** 固定挂载Foo类和Loading边界，真正是否挂起由Foo自己的state决定。 */
    function App() {
      return (
        <Suspense fallback="Loading...">
          <Foo suspend={false} />
        </Suspense>
      );
    }

    /** 无操作then永不主动ping；Foo恢复由另一条state更新触发。 */
    const thenable = {/** 永不主动 ping 的 thenable 协议入口。 */ then() {}};

    let foo;
    /** 保存suspend开关，render可直接抛never，再以state恢复。 */
    class Foo extends React.Component {
      /** false时正常显示Foo，true时在render抛thenable。 */
      state = {suspend: false};
      /** 暴露this，state.suspend为真记录Suspend并抛never，否则显示Foo。 */
      render() {
        foo = this;

        if (this.state.suspend) {
          Scheduler.log('Suspend!');
          throw thenable;
        }

        return <Text text="Foo" />;
      }
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });

    assertLog(['Foo']);

    await act(async () => {
      foo.setState({suspend: true});

      await waitFor(['Suspend!']);

      foo.setState({suspend: false});
    });

    assertLog([
      'Foo',
    ]);
    expect(root).toMatchRenderedOutput(<span prop="Foo" />);
  });

  /** LegacyHidden有未渲染的Offscreen，App首次只提交空hidden div；transition加入可见待决A后隐藏工作不前进，A完成先提交div/A，再后台填入Offscreen。验证可见挂起工作先于隐藏lane。 */
  // @gate enableLegacyCache && enableLegacyHidden
  it('should not render hidden content while suspended on higher pri', async () => {
    /** 记录并输出同步 Offscreen 文本，与 LegacyHidden 的异步子树对照。 */
    function Offscreen() {
      Scheduler.log('Offscreen');
      return 'Offscreen';
    }
    /** 并列LegacyHidden的Offscreen与可选AsyncA，layout记录可见提交。 */
    function App({showContent}) {
      React.useLayoutEffect(() => {
        Scheduler.log('Commit');
      });
      return (
        <>
          <LegacyHiddenDiv mode="hidden">
            <Offscreen />
          </LegacyHiddenDiv>
          <Suspense fallback={<Text text="Loading..." />}>
            {showContent ? <AsyncText text="A" /> : null}
          </Suspense>
        </>
      );
    }

    ReactNoop.render(<App showContent={false} />);
    await waitFor(['Commit']);
    expect(ReactNoop).toMatchRenderedOutput(<div hidden={true} />);

    React.startTransition(() => {
      ReactNoop.render(<App showContent={true} />);
    });

    await waitForAll(['Suspend! [A]', 'Loading...']);
    await resolveText('A');
    await waitFor(['A', 'Commit']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <div hidden={true} />
        <span prop="A" />
      </>,
    );
    await waitForAll(['Offscreen']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <div hidden={true}>Offscreen</div>
        <span prop="A" />
      </>,
    );
  });

  /** LegacyHidden下A已经开始挂起，随后transition在可见区也读A；资源完成先提交可见A与空hidden div，再补隐藏A/Offscreen。验证共享资源ping可先解除较高优先级可见阻塞。 */
  // @gate enableLegacyCache && enableLegacyHidden
  it('should be able to unblock higher pri content before suspended hidden', async () => {
    /** 记录隐藏子树中同步兄弟的 render，与读取未就绪资源的 AsyncText 对照。 */
    function Offscreen() {
      Scheduler.log('Offscreen');
      return 'Offscreen';
    }
    /** 一个边界包含隐藏A/Offscreen及可选可见A，layout区分前景与后台提交。 */
    function App({showContent}) {
      React.useLayoutEffect(() => {
        Scheduler.log('Commit');
      });
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <LegacyHiddenDiv mode="hidden">
            <AsyncText text="A" />
            <Offscreen />
          </LegacyHiddenDiv>
          {showContent ? <AsyncText text="A" /> : null}
        </Suspense>
      );
    }

    ReactNoop.render(<App showContent={false} />);
    await waitFor(['Commit']);
    expect(ReactNoop).toMatchRenderedOutput(<div hidden={true} />);

    await waitFor(['Suspend! [A]']);

    React.startTransition(() => {
      ReactNoop.render(<App showContent={true} />);
    });

    await waitForAll(['Suspend! [A]', 'Loading...']);
    await resolveText('A');
    await waitFor(['A', 'Commit']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <div hidden={true} />
        <span prop="A" />
      </>,
    );
    await waitForAll(['A', 'Offscreen']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <div hidden={true}>
          <span prop="A" />
          Offscreen
        </div>
        <span prop="A" />
      </>,
    );
  });

  /** 同一Child队列先discrete设置B，再transition设置C，解析C；日志先B挂起/Loading再C且最终为C。验证跳过与重放保存后入队更新，不把同队列更新丢掉。 */
  // @gate enableLegacyCache
  it(
    'multiple updates originating inside a Suspense boundary at different ' +
      'priority levels are not dropped',
    async () => {
      const {useState} = React;
      const root = ReactNoop.createRoot();

      /** 为有状态Child提供Loading边界；该包装层本身没有state或更新器。 */
      function Parent() {
        return (
          <>
            <Suspense fallback={<Text text="Loading..." />}>
              <Child />
            </Suspense>
          </>
        );
      }

      let setText;
      /** 维护A起始的text状态并暴露setter，将资源键交给AsyncText，测试其队列跳过/重放。 */
      function Child() {
        const [text, _setText] = useState('A');
        setText = _setText;
        return <AsyncText text={text} />;
      }

      await seedNextTextCache('A');
      await act(() => {
        root.render(<Parent />);
      });
      assertLog(['A']);
      expect(root).toMatchRenderedOutput(<span prop="A" />);

      await act(async () => {
        ReactNoop.discreteUpdates(() => {
          setText('B');
        });
        startTransition(() => {
          setText('C');
        });
        // 低优先级检查点。
        assertLog([]);

        await resolveText('C');
      });
      assertLog([
        'Suspend! [B]',
        'Loading...',
        // 低优先级检查点。
        'C',
      ]);
      expect(root).toMatchRenderedOutput(<span prop="C" />);
    },
  );

  /** 主state A→B挂起并显示fallback后，普通更新主state到C，同时transition更新fallback自身到Still loading；最终旧A隐藏且新fallback文本可提交。验证主树挂起不阻塞fallback子树自己的更新。 */
  // @gate enableLegacyCache
  it(
    'fallback component can update itself even after a high pri update to ' +
      'the primary tree suspends',
    async () => {
      const {useState} = React;
      const root = ReactNoop.createRoot();

      let setAppText;
      /** 保存主text并暴露setAppText，fallback有自己的state与更新器。 */
      function App() {
        const [text, _setText] = useState('A');
        setAppText = _setText;
        return (
          <>
            <Suspense fallback={<Fallback />}>
              <AsyncText text={text} />
            </Suspense>
          </>
        );
      }

      let setFallbackText;
      /** Fallback 输出可识别 fallback，并记录其挂载或意外到达情况。 */
      function Fallback() {
        const [text, _setText] = useState('Loading...');
        setFallbackText = _setText;
        return <Text text={text} />;
      }

      await seedNextTextCache('A');
      await act(() => {
        root.render(<App />);
      });
      assertLog(['A']);
      expect(root).toMatchRenderedOutput(<span prop="A" />);

      await act(async () => {
        setAppText('B');
        await waitForAll([
          'Suspend! [B]',
          'Loading...',
          // 执行预热渲染，不把该遍结果作为最终提交。
          'Suspend! [B]',
        ]);
      });

      expect(root).toMatchRenderedOutput(
        <>
          <span hidden={true} prop="A" />
          <span prop="Loading..." />
        </>,
      );

      // 默认优先级检查点。
      await act(() => {
        setAppText('C');
        React.startTransition(() => {
          setFallbackText('Still loading...');
        });
      });

      assertLog([
        'Suspend! [C]',
        'Loading...',

        // expiration-times 模型无法确认低优先级工作能否解除阻塞；fallback 更新说明可能存在，所以额外尝试一次。
        // TODO：lanes 模型可精确知道每棵树的待处理 lanes，理论上不应需要这次额外尝试。
        'Suspend! [C]',

        'Still loading...',
        'Suspend! [C]',
      ]);
      expect(root).toMatchRenderedOutput(
        <>
          <span hidden={true} prop="A" />
          <span prop="Still loading..." />
        </>,
      );
    },
  );

  /** Child初始A，预解B后更新为B，再更新待决C显示Loading并隐藏B；预解D再setState到D可直接揭示D。验证primary子树return路径变化不丢新更新。 */
  // @gate enableLegacyCache
  it(
    'regression: primary fragment fiber is not always part of setState ' +
      'return path',
    async () => {
      const {useState} = React;
      const root = ReactNoop.createRoot();

      /** 为有状态Child提供Loading边界；该包装层本身没有state或更新器。 */
      function Parent() {
        return (
          <>
            <Suspense fallback={<Text text="Loading..." />}>
              <Child />
            </Suspense>
          </>
        );
      }

      let setText;
      /** 维护A起始的text状态并暴露setter，将资源键交给AsyncText，测试其队列跳过/重放。 */
      function Child() {
        const [text, _setText] = useState('A');
        setText = _setText;
        return <AsyncText text={text} />;
      }

      await seedNextTextCache('A');
      await act(() => {
        root.render(<Parent />);
      });
      assertLog(['A']);
      expect(root).toMatchRenderedOutput(<span prop="A" />);

      await resolveText('B');
      await act(() => {
        setText('B');
      });
      assertLog(['B']);
      expect(root).toMatchRenderedOutput(<span prop="B" />);

      await act(() => {
        setText('C');
      });
      assertLog(['Suspend! [C]', 'Loading...', 'Suspend! [C]']);

      await act(async () => {
        await advanceTimers(250);
      });
      expect(root).toMatchRenderedOutput(
        <>
          <span hidden={true} prop="B" />
          <span prop="Loading..." />
        </>,
      );

      await resolveText('D');
      await act(() => {
        setText('D');
      });
      assertLog(['D']);
      expect(root).toMatchRenderedOutput(<span prop="D" />);
    },
  );

  /** 前半同A→B→待决C；随后普通更新D仍挂起，同时idle排入已解E，最终显示E。验证当较高优先级挂起时仍能处理后续可解除阻塞的低优先级队列项。 */
  // @gate enableLegacyCache
  it(
    'regression: primary fragment fiber is not always part of setState ' +
      'return path (another case)',
    async () => {
      const {useState} = React;
      const root = ReactNoop.createRoot();

      /** 为有状态Child提供Loading边界；该包装层本身没有state或更新器。 */
      function Parent() {
        return (
          <Suspense fallback={<Text text="Loading..." />}>
            <Child />
          </Suspense>
        );
      }

      let setText;
      /** 维护A起始的text状态并暴露setter，将资源键交给AsyncText，测试其队列跳过/重放。 */
      function Child() {
        const [text, _setText] = useState('A');
        setText = _setText;
        return <AsyncText text={text} />;
      }

      await seedNextTextCache('A');
      await act(() => {
        root.render(<Parent />);
      });
      assertLog(['A']);
      expect(root).toMatchRenderedOutput(<span prop="A" />);

      await resolveText('B');
      await act(() => {
        setText('B');
      });
      assertLog(['B']);
      expect(root).toMatchRenderedOutput(<span prop="B" />);

      await act(() => {
        setText('C');
      });
      assertLog([
        'Suspend! [C]',
        'Loading...',
        // 执行预热渲染，不把该遍结果作为最终提交。
        'Suspend! [C]',
      ]);

      await act(async () => {
        await advanceTimers(250);
      });
      expect(root).toMatchRenderedOutput(
        <>
          <span hidden={true} prop="B" />
          <span prop="Loading..." />
        </>,
      );

      await act(async () => {
        setText('D');

        await resolveText('E');
        ReactNoop.idleUpdates(() => {
          setText('E');
        });
      });
      assertLog([
        'Suspend! [D]',
        // 执行预热渲染，不把该遍结果作为最终提交。
        'Suspend! [D]',
        // 结束预热渲染。
        'E',
      ]);
      expect(root).toMatchRenderedOutput(<span prop="E" />);
    },
  );

  /** 父子text一起A→B，内B待决导致旧内A隐藏；discrete仅把step变1不能揭示旧text A，最后内B完成输出B/step1且effect记录一致。验证新props不得越过未完成state更新造成tearing。 */
  // @gate enableLegacyCache
  it(
    'after showing fallback, should not flip back to primary content until ' +
      'the update that suspended finishes',
    async () => {
      const {useState, useEffect} = React;
      const root = ReactNoop.createRoot();

      let setOuterText;
      /** 保存外text并显示外text/step，把相同值传给边界内Child，供effect检查父子一致。 */
      function Parent({step}) {
        const [text, _setText] = useState('A');
        setOuterText = _setText;
        return (
          <>
            <Text text={'Outer text: ' + text} />
            <Text text={'Outer step: ' + step} />
            <Suspense fallback={<Text text="Loading..." />}>
              <Child step={step} outerText={text} />
            </Suspense>
          </>
        );
      }

      let setInnerText;
      /** 保存内text、暴露setter并在passive检查内外一致，宿主资源键包含text和本例step。 */
      function Child({step, outerText}) {
        const [text, _setText] = useState('A');
        setInnerText = _setText;

        useEffect(() => {
          if (text === outerText) {
            Scheduler.log('Commit Child');
          } else {
            Scheduler.log('FIXME: Texts are inconsistent (tearing)');
          }
        }, [text, outerText]);

        return (
          <>
            <AsyncText text={'Inner text: ' + text} />
            <Text text={'Inner step: ' + step} />
          </>
        );
      }

      /** 同一调用分别更新父、子两条text队列；不合并成同一个队列，effect检查二者提交一致。 */
      function setText(text) {
        setOuterText(text);
        setInnerText(text);
      }

      await seedNextTextCache('Inner text: A');
      await act(() => {
        root.render(<Parent step={0} />);
      });
      assertLog([
        'Outer text: A',
        'Outer step: 0',
        'Inner text: A',
        'Inner step: 0',
        'Commit Child',
      ]);
      expect(root).toMatchRenderedOutput(
        <>
          <span prop="Outer text: A" />
          <span prop="Outer step: 0" />
          <span prop="Inner text: A" />
          <span prop="Inner step: 0" />
        </>,
      );

      await act(() => {
        setText('B');
      });
      assertLog([
        'Outer text: B',
        'Outer step: 0',
        'Suspend! [Inner text: B]',
        'Loading...',
        // 执行预热渲染，不把该遍结果作为最终提交。
        'Suspend! [Inner text: B]',
        'Inner step: 0',
      ]);
      await advanceTimers(250);
      expect(root).toMatchRenderedOutput(
        <>
          <span prop="Outer text: B" />
          <span prop="Outer step: 0" />
          <span hidden={true} prop="Inner text: A" />
          <span hidden={true} prop="Inner step: 0" />
          <span prop="Loading..." />
        </>,
      );

      await act(() => {
        ReactNoop.discreteUpdates(() => {
          root.render(<Parent step={1} />);
        });
      });

      assertLog([
        'Outer text: B',
        'Outer step: 1',
        'Suspend! [Inner text: B]',
        'Loading...',
        // 执行预热渲染，不把该遍结果作为最终提交。
        'Suspend! [Inner text: B]',
        'Inner step: 1',
      ]);
      expect(root).toMatchRenderedOutput(
        <>
          <span prop="Outer text: B" />
          <span prop="Outer step: 1" />
          <span hidden={true} prop="Inner text: A" />
          <span hidden={true} prop="Inner step: 0" />
          <span prop="Loading..." />
        </>,
      );

      // 随后解决数据资源并观察主内容恢复。
      await act(async () => {
        await resolveText('Inner text: B');
      });
      assertLog(['Inner text: B', 'Inner step: 1', 'Commit Child']);
      expect(root).toMatchRenderedOutput(
        <>
          <span prop="Outer text: B" />
          <span prop="Outer step: 1" />
          <span prop="Inner text: B" />
          <span prop="Inner step: 1" />
        </>,
      );
    },
  );

  /** 父子text A→B且Inner B0待决，先隐藏内A0；预解Inner B1后discrete把step变1，直接揭示B1并记录父子text一致。验证更高优先级更新可改变资源键并解除旧挂起阻塞。 */
  // @gate enableLegacyCache
  it('a high pri update can unhide a boundary that suspended at a different level', async () => {
    const {useState, useEffect} = React;
    const root = ReactNoop.createRoot();

    let setOuterText;
    /** 保存外text并显示外text/step，把相同值传给边界内Child，供effect检查父子一致。 */
    function Parent({step}) {
      const [text, _setText] = useState('A');
      setOuterText = _setText;
      return (
        <>
          <Text text={'Outer: ' + text + step} />
          <Suspense fallback={<Text text="Loading..." />}>
            <Child step={step} outerText={text} />
          </Suspense>
        </>
      );
    }

    let setInnerText;
    /** 保存内text、暴露setter并在passive检查内外一致，宿主资源键包含text和本例step。 */
    function Child({step, outerText}) {
      const [text, _setText] = useState('A');
      setInnerText = _setText;

      useEffect(() => {
        if (text === outerText) {
          Scheduler.log('Commit Child');
        } else {
          Scheduler.log('FIXME: Texts are inconsistent (tearing)');
        }
      }, [text, outerText]);

      return (
        <>
          <AsyncText text={'Inner: ' + text + step} />
        </>
      );
    }

    /** 同一调用分别更新父、子两条text队列；不合并成同一个队列，effect检查二者提交一致。 */
    function setText(text) {
      setOuterText(text);
      setInnerText(text);
    }

    await seedNextTextCache('Inner: A0');
    await act(() => {
      root.render(<Parent step={0} />);
    });
    assertLog(['Outer: A0', 'Inner: A0', 'Commit Child']);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="Outer: A0" />
        <span prop="Inner: A0" />
      </>,
    );

    await act(() => {
      setText('B');
    });
    assertLog([
      'Outer: B0',
      'Suspend! [Inner: B0]',
      'Loading...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [Inner: B0]',
    ]);
    await advanceTimers(250);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="Outer: B0" />
        <span hidden={true} prop="Inner: A0" />
        <span prop="Loading..." />
      </>,
    );

    await resolveText('Inner: B1');
    await act(() => {
      ReactNoop.discreteUpdates(() => {
        root.render(<Parent step={1} />);
      });
    });

    assertLog(['Outer: B1', 'Inner: B1', 'Commit Child']);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="Outer: B1" />
        <span prop="Inner: B1" />
      </>,
    );
  });

  /** A普通state到待决A1，B的useTransition同时排入A2/B2；A1解析可先显示A1/B，但A2/B2队列仍待处理，二者解析后最终A2/B2。验证较高优先级ping不丢较晚transition更新。 */
  // @gate enableLegacyCache
  it('regression: ping at high priority causes update to be dropped', async () => {
    const {useState, useTransition} = React;

    let setTextA;
    /** 在独立 Suspense 边界内维护 A 的文本 state，暴露更新器供不同优先级交错。 */
    function A() {
      const [textA, _setTextA] = useState('A');
      setTextA = _setTextA;
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <AsyncText text={textA} />
        </Suspense>
      );
    }

    let setTextB;
    let startTransitionFromB;
    /** 维护 B 的文本 state 与 transition 启动器，驱动边界内外的交错更新。 */
    function B() {
      const [textB, _setTextB] = useState('B');
      // eslint-disable-next-line no-unused-vars
      const [_, _startTransition] = useTransition();
      startTransitionFromB = _startTransition;
      setTextB = _setTextB;
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <AsyncText text={textB} />
        </Suspense>
      );
    }

    /** 并列各自带边界的A/B，B还拥有用来安排两份state更新的transition。 */
    function App() {
      return (
        <>
          <A />
          <B />
        </>
      );
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      await seedNextTextCache('A');
      await seedNextTextCache('B');
      root.render(<App />);
    });
    assertLog(['A', 'B']);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="B" />
      </>,
    );

    await act(async () => {
      setTextA('A1');
      startTransitionFromB(() => {
        setTextA('A2');
        setTextB('B2');
      });

      await waitFor([
        'Suspend! [A1]',
        'Loading...',
        'B',
        'Suspend! [A2]',
        'Loading...',
        'Suspend! [B2]',
        'Loading...',
      ]);
      expect(root).toMatchRenderedOutput(
        <>
          <span hidden={true} prop="A" />
          <span prop="Loading..." />
          <span prop="B" />
        </>,
      );

      await resolveText('A1');
      await waitFor(['A1']);
    });
    assertLog(['Suspend! [A2]', 'Loading...', 'Suspend! [B2]', 'Loading...']);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="A1" />
        <span prop="B" />
      </>,
    );

    await act(async () => {
      await resolveText('A2');
      await resolveText('B2');
    });
    assertLog(['A2', 'B2']);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="A2" />
        <span prop="B2" />
      </>,
    );
  });

  // 回归场景：复现历史缺陷并锁定修复后的 Suspense 调度或提交不变量；参考 https://github.com/facebook/react/issues/18486。
  /** 两个本地transition都更新同一text，render中mirror跟随text；先a再b保持Pending与空文本，解析a仍等待b，b完成只显示b并清除Pending。验证render-phase更新与队列重放不会卡住transition状态。 */
  // @gate enableLegacyCache
  it('does not get stuck in pending state with render phase updates', async () => {
    let setTextWithShortTransition;
    let setTextWithLongTransition;

    /** 两个useTransition共享text state，render中让mirror追上text并以合并pending显示提示。 */
    function App() {
      const [isPending1, startShortTransition] = React.useTransition();
      const [isPending2, startLongTransition] = React.useTransition();
      const isPending = isPending1 || isPending2;
      const [text, setText] = React.useState('');
      const [mirror, setMirror] = React.useState('');

      if (text !== mirror) {
        setMirror(text);
      }

      /** 在第一份本地transition中更新共享text，render-phase mirror随后追上。 */
      setTextWithShortTransition = value => {
        startShortTransition(() => {
          setText(value);
        });
      };
      /** 在第二份本地transition中更新同一text队列，不声明固定超时时长。 */
      setTextWithLongTransition = value => {
        startLongTransition(() => {
          setText(value);
        });
      };

      return (
        <>
          {isPending ? <Text text="Pending..." /> : null}
          {text !== '' ? <AsyncText text={text} /> : <Text text={text} />}
        </>
      );
    }

    /** 以 Suspense 包裹会触发 render-phase 更新的 App，观察挂起重试是否收敛。 */
    function Root() {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <App />
        </Suspense>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<Root />);
    });
    assertLog(['']);
    expect(root).toMatchRenderedOutput(<span prop="" />);

    await act(async () => {
      setTextWithShortTransition('a');
      await waitForAll(['Pending...', '', 'Suspend! [a]', 'Loading...']);
    });
    assertLog([]);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="Pending..." />
        <span prop="" />
      </>,
    );

    await act(async () => {
      setTextWithLongTransition('b');
      await waitForAll([
        'Pending...',
        '',
        'Suspend! [b]',
        'Loading...',
      ]);
    });
    assertLog([]);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="Pending..." />
        <span prop="" />
      </>,
    );

    await act(async () => {
      await resolveText('a');

      await waitForAll(['Suspend! [b]', 'Loading...']);
      expect(root).toMatchRenderedOutput(
        <>
          <span prop="Pending..." />
          <span prop="" />
        </>,
      );

      await act(async () => {
        await resolveText('b');
      });
      assertLog(['b']);
      expect(root).toMatchRenderedOutput(<span prop="b" />);
    });
  });

  /** 初始A/Loading，解析Async后立即普通setter到B；waitForPaint先看到B/Loading，act继续才Async。验证已提交fallback的retry lane低于普通更新。 */
  // @gate enableLegacyCache
  it('retries have lower priority than normal updates', async () => {
    const {useState} = React;

    let setText;
    /** 维护同步text并暴露setter，作为Suspense retry之外的普通优先级兄弟更新。 */
    function UpdatingText() {
      const [text, _setText] = useState('A');
      setText = _setText;
      return <Text text={text} />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <>
          <UpdatingText />
          <Suspense fallback={<Text text="Loading..." />}>
            <AsyncText text="Async" />
          </Suspense>
        </>,
      );
    });
    assertLog([
      'A',
      'Suspend! [Async]',
      'Loading...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [Async]',
    ]);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="Loading..." />
      </>,
    );

    await act(async () => {
      await resolveText('Async');
      setText('B');

      await waitForPaint(['B']);
      expect(root).toMatchRenderedOutput(
        <>
          <span prop="B" />
          <span prop="Loading..." />
        </>,
      );
    });
    // 使用新内容执行 Suspense retry。
    assertLog(['Async']);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="B" />
        <span prop="Async" />
      </>,
    );
  });

  /** 并发Child已安装passive，新增Async使旧Child隐藏而effect保持；root.render(null)记录Unmount Child。验证真正删除隐藏树时仍执行passive cleanup。 */
  // @gate enableLegacyCache
  it('should fire effect clean-up when deleting suspended tree', async () => {
    const {useEffect} = React;

    /** 边界中固定Child与可选Async，供已安装passive在隐藏后删除。 */
    function App({show}) {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <Child />
          {show && <AsyncText text="Async" />}
        </Suspense>
      );
    }

    /** 输出Child宿主span并安装一次passive create/cleanup，用日志核对隐藏后的真实删除。 */
    function Child() {
      useEffect(() => {
        Scheduler.log('Mount Child');
        return () => {
          Scheduler.log('Unmount Child');
        };
      }, []);
      return <span prop="Child" />;
    }

    const root = ReactNoop.createRoot();

    await act(() => {
      root.render(<App show={false} />);
    });
    assertLog(['Mount Child']);
    expect(root).toMatchRenderedOutput(<span prop="Child" />);

    await act(() => {
      root.render(<App show={true} />);
    });
    assertLog([
      'Suspend! [Async]',
      'Loading...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [Async]',
    ]);
    expect(root).toMatchRenderedOutput(
      <>
        <span hidden={true} prop="Child" />
        <span prop="Loading..." />
      </>,
    );

    await act(() => {
      root.render(null);
    });
    assertLog(['Unmount Child']);
  });

  /** legacy Child已有passive，新增Async后隐藏旧Child并显示Loading；删除根仍记录Unmount Child。与并发例区分没有后台预热的旧同步路径。 */
  // @gate enableLegacyCache && !disableLegacyMode
  it('should fire effect clean-up when deleting suspended tree (legacy)', async () => {
    const {useEffect} = React;

    /** 边界中固定Child与可选Async，供legacy隐藏后删除的passive清理。 */
    function App({show}) {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <Child />
          {show && <AsyncText text="Async" />}
        </Suspense>
      );
    }

    /** 输出Child宿主span并安装一次passive create/cleanup，用日志核对隐藏后的真实删除。 */
    function Child() {
      useEffect(() => {
        Scheduler.log('Mount Child');
        return () => {
          Scheduler.log('Unmount Child');
        };
      }, []);
      return <span prop="Child" />;
    }

    const root = ReactNoop.createLegacyRoot();

    await act(() => {
      root.render(<App show={false} />);
    });
    assertLog(['Mount Child']);
    expect(root).toMatchRenderedOutput(<span prop="Child" />);

    await act(() => {
      root.render(<App show={true} />);
    });
    assertLog(['Suspend! [Async]', 'Loading...']);
    expect(root).toMatchRenderedOutput(
      <>
        <span hidden={true} prop="Child" />
        <span prop="Loading..." />
      </>,
    );

    await act(() => {
      root.render(null);
    });
    assertLog(['Unmount Child']);
  });

  /** 已有空div后transition追加两个边界，A普通挂起，B的thenable在then中同步resolve且组件提前标fulfilled；日志两遍A及最终B，但输出保留旧div。验证同步ping不在render内prepareFreshStack破坏栈。 */
  // @gate enableLegacyCache
  it(
    'regression test: pinging synchronously within the render phase ' +
      'does not unwind the stack',
    async () => {
      const thenable = {
        /** 同步调用resolve(B)，故注册ping的当前render内便收到通知；不排微任务。 */
        then(resolve) {
          resolve('B');
        },
        status: 'pending',
      };

      /** 首轮先把 thenable 标为 fulfilled 再抛出，制造同步 ping；下一轮输出 B。 */
      function ImmediatelyPings() {
        if (thenable.status === 'pending') {
          thenable.status = 'fulfilled';
          throw thenable;
        }
        return <Text text="B" />;
      }

      /** showMore从空div切换到A与同步ping的B两个边界。 */
      function App({showMore}) {
        return (
          <div>
            <Suspense fallback={<Text text="Loading A..." />}>
              {showMore ? (
                <>
                  <AsyncText text="A" />
                </>
              ) : null}
            </Suspense>
            {showMore ? (
              <Suspense fallback={<Text text="Loading B..." />}>
                <ImmediatelyPings />
              </Suspense>
            ) : null}
          </div>
        );
      }

      const root = ReactNoop.createRoot();
      await act(() => {
        root.render(<App showMore={false} />);
      });
      assertLog([]);
      expect(root).toMatchRenderedOutput(<div />);

      //
      //
      // 该回归防止同步 ping 错误调用 `prepareFreshStack` 并展开进行中的工作栈。
      await act(() => {
        startTransition(() => root.render(<App showMore={true} />));
      });
      assertLog([
        'Suspend! [A]',
        'Loading A...',
        'Loading B...',
        'Suspend! [A]',
        'Loading A...',
        'B',
      ]);
      expect(root).toMatchRenderedOutput(<div />);
    },
  );

  /** RetryLaneExpiration开启：Async完成后昂贵A/B部分渲染，推进100000ms使retry到期，再普通兄弟更新2先提交；冲刷一个yield仍能完成整个到期Async/ABC。验证到期retry以同步工作避免持续高优先级打断造成饥饿。 */
  // @gate enableLegacyCache && enableRetryLaneExpiration
  it('recurring updates in siblings should not block expensive content in suspense boundary from committing', async () => {
    const {useState} = React;

    let setText;
    /** 维护同步text并暴露setter，作为Suspense retry之外的普通优先级兄弟更新。 */
    function UpdatingText() {
      const [text, _setText] = useState('1');
      setText = _setText;
      return <Text text={text} />;
    }

    /** 记录text并推进ms毫秒调度时间，模拟可被yield打断的同步CPU工作。 */
    function ExpensiveText({text, ms}) {
      Scheduler.log(text);
      Scheduler.unstable_advanceTime(ms);
      return <span prop={text} />;
    }

    /** 并列可更新普通兄弟与含Async、三段昂贵CPU文本的边界。 */
    function App() {
      return (
        <>
          <UpdatingText />
          <Suspense fallback={<Text text="Loading..." />}>
            <AsyncText text="Async" />
            <ExpensiveText text="A" ms={1000} />
            <ExpensiveText text="B" ms={3999} />
            <ExpensiveText text="C" ms={100000} />
          </Suspense>
        </>
      );
    }

    const root = ReactNoop.createRoot();
    root.render(<App />);
    await waitForAll([
      '1',
      'Suspend! [Async]',
      'Loading...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [Async]',
      'A',
      'B',
      'C',
    ]);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="1" />
        <span prop="Loading..." />
      </>,
    );

    await resolveText('Async');
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="1" />
        <span prop="Loading..." />
      </>,
    );

    await waitFor(['Async', 'A', 'B']);
    ReactNoop.expire(100000);
    await advanceTimers(100000);
    setText('2');
    await waitForPaint(['2']);

    await waitForMicrotasks();
    Scheduler.unstable_flushNumberOfYields(1);
    assertLog(['Async', 'A', 'B', 'C']);

    expect(root).toMatchRenderedOutput(
      <>
        <span prop="2" />
        <span prop="Async" />
        <span prop="A" />
        <span prop="B" />
        <span prop="C" />
      </>,
    );
  });

  /** transition先将Promise.resolve(null)作为无fallback边界child，输出null；随后transition改为div可完成act且无额外日志。本体未断言第二次宿主输出，验证promise解包后的边界还能接受更新。 */
  it('can rerender after resolving a promise', async () => {
    const promise = Promise.resolve(null);
    const root = ReactNoop.createRoot();

    await act(() => {
      startTransition(() => {
        root.render(<Suspense>{promise}</Suspense>);
      });
    });

    assertLog([]);
    expect(root).toMatchRenderedOutput(null);

    await act(() => {
      startTransition(() => {
        root.render(
          <Suspense>
            <div />
          </Suspense>,
        );
      });
    });
  });
});
