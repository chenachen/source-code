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
      /** 状态机边界：`pending` 抛 thenable 交给 Suspense，`rejected` 抛业务错误，`resolved` 返回已缓存值；未知状态不得静默降级。 */
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
        /** readText.then 实现 thenable 订阅：pending 时登记 ping，已结束时用微任务通知；同一监听器不得同步重复执行。 */
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

  /** Text 同步记录并输出文本，作为提交顺序与宿主内容的稳定观测点。 */
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
      // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
      caches[caches.length - 1].resolve(text);
    }
  }

  const resolveText = resolveMostRecentTextCache;

  /** rejectMostRecentTextCache 将最近 cache 的目标资源推进到 rejected，广播 ping 后由错误边界处理。 */
  function rejectMostRecentTextCache(text, error) {
    if (caches.length === 0) {
      throw Error('Cache does not exist.');
    } else {
      // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
      caches[caches.length - 1].reject(text, error);
    }
  }

  const rejectText = rejectMostRecentTextCache;

  /** advanceTimers 只推进 Jest 虚拟时间并等待当前 tick；React 调度时间仍由 Noop API 控制。 */
  function advanceTimers(ms) {
    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
    if (typeof ms !== 'number') {
      throw new Error('Must specify ms');
    }
    jest.advanceTimersByTime(ms);
    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
    return Promise.resolve().then(() => {});
  }

  // 删除目标子树并检查真实卸载清理；隐藏或未提交工作不得误触发。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于初次渲染尚未提交时 thenable ping，确认完成中的 fallback 工作继续而非从根重启。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：初次渲染尚未提交时 thenable ping，确认完成中的 fallback 工作继续而非从根重启。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`attachPingListener()`、`pingSuspendedRoot()` 与 `retryTimedOutBoundary()`。
   */
  // @gate enableLegacyCache
  it("does not restart if there's a ping during initial render", async () => {
    /** Bar 作为层级 fixture 暴露 unwind、兄弟遍历或边界传播顺序，服务于“初次渲染尚未提交时 thenable ping，确认完成中的 fallback 工作继续而非从根重启”场景。 */
    function Bar(props) {
      Scheduler.log('Bar');
      return props.children;
    }

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“初次渲染尚未提交时 thenable ping，确认完成中的 fallback 工作继续而非从根重启”场景。 */
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
      // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
      'Suspend! [A]',
      // 检查当前时刻应显示或保留的 fallback，避免主内容与占位错误切换。
      'Loading...',
      'C',
      // 分段冲刷或让出调度工作，以锁定当前渲染检查点。
    ]);
    expect(ReactNoop).toMatchRenderedOutput(null);

    // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
    await act(async () => {
      await resolveText('A');
      // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
   * When：按用例顺序解决资源并冲刷 ping 触发的重试。
   * Then：主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache
  it('suspends rendering and continues later', async () => {
    /** Bar 作为层级 fixture 暴露 unwind、兄弟遍历或边界传播顺序，服务于“主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试”场景。 */
    function Bar(props) {
      Scheduler.log('Bar');
      return props.children;
    }

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试”场景。 */
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

    // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
    ReactNoop.render(<Foo />);
    await waitForAll(['Foo']);

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
    React.startTransition(() => {
      ReactNoop.render(<Foo renderBar={true} />);
    });
    await waitForAll([
      'Foo',
      'Bar',
      // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
      'Suspend! [A]',

      // 执行预热渲染，不把该遍结果作为最终提交。
      'B',
      // 结束预热渲染。

      // 检查当前时刻应显示或保留的 fallback，避免主内容与占位错误切换。
      'Loading...',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(null);

    // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
    await resolveText('A');
    // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
    await waitForAll(['Foo', 'Bar', 'A', 'B']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="B" />
      </>,
    );
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于兄弟 Suspense 边界分别挂起和解决，确认每个 fallback 独立恢复。
   * When：按用例顺序解决资源并冲刷 ping 触发的重试。
   * Then：兄弟 Suspense 边界分别挂起和解决，确认每个 fallback 独立恢复。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache
  it('suspends siblings and later recovers each independently', async () => {
    // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于主树抛出 thenable 后立即 unwind，确认不继续渲染同边界中无关兄弟。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：主树抛出 thenable 后立即 unwind，确认不继续渲染同边界中无关兄弟。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache
  it('when something suspends, unwinds immediately without rendering siblings', async () => {
    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
    await waitForAll([
      'A',
      'Suspend! [B]',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'C',
      'D',
      // 结束预热渲染。
      'Loading...',
    ]);
    // 完成或检查本轮提交，区分已完成工作与仅渲染未提交的内容。
    expect(ReactNoop).toMatchRenderedOutput(null);

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
    await resolveText('B');
    await waitForAll(['A', 'B', 'C', 'D']);
    // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="B" />
        <span prop="C" />
        <span prop="D" />
      </>,
    );
  });

  // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
  /**
   * Given：已构造边界树、资源状态和调度检查点，用于资源从 pending 转为 rejected，确认 Suspense 重试把错误交给最近错误边界。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：资源从 pending 转为 rejected，确认 Suspense 重试把错误交给最近错误边界。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache
  it('retries on error', async () => {
    /** 定义 ErrorBoundary 类 fixture，在“资源从 pending 转为 rejected，确认 Suspense 重试把错误交给最近错误边界”场景中暴露实例 state 与提交生命周期。 */
    class ErrorBoundary extends React.Component {
      /** 保存 ErrorBoundary.state 的实例状态，跨挂起、fallback 与重试提交维持测试不变量。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch 把资源 rejection 后的业务错误交给错误边界状态与日志。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** ErrorBoundary.reset 清除错误边界状态，使同一 fixture 可验证后续 retry。 */
      reset() {
        this.setState({error: null});
      }
      /** 渲染 ErrorBoundary.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
      render() {
        if (this.state.error !== null) {
          return <Text text={'Caught error: ' + this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    const errorBoundary = React.createRef();
    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“资源从 pending 转为 rejected，确认 Suspense 重试把错误交给最近错误边界”场景。 */
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

      // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
      'Error! [Result]',

      // 让资源或渲染路径进入错误状态，确认错误传播与边界恢复行为。
      'Caught error: Failed to load: Result',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <span prop="Caught error: Failed to load: Result" />,
    );
  });

  // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
  /**
   * Given：已构造边界树、资源状态和调度检查点，用于资源从 pending 转为 rejected，确认 Suspense 重试把错误交给最近错误边界。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：资源从 pending 转为 rejected，确认 Suspense 重试把错误交给最近错误边界。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()`、`mountSuspenseFallbackChildren()` 与 `renderDidSuspendDelayIfPossible()`。
   */
  // @gate enableLegacyCache
  it('retries on error after falling back to a placeholder', async () => {
    /** 定义 ErrorBoundary 类 fixture，在“资源从 pending 转为 rejected，确认 Suspense 重试把错误交给最近错误边界”场景中暴露实例 state 与提交生命周期。 */
    class ErrorBoundary extends React.Component {
      /** 保存 ErrorBoundary.state 的实例状态，跨挂起、fallback 与重试提交维持测试不变量。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch 把资源 rejection 后的业务错误交给错误边界状态与日志。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** ErrorBoundary.reset 清除错误边界状态，使同一 fixture 可验证后续 retry。 */
      reset() {
        this.setState({error: null});
      }
      /** 渲染 ErrorBoundary.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
      render() {
        if (this.state.error !== null) {
          return <Text text={'Caught error: ' + this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    const errorBoundary = React.createRef();
    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“资源从 pending 转为 rejected，确认 Suspense 重试把错误交给最近错误边界”场景。 */
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

      // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
      'Error! [Result]',

      // 让资源或渲染路径进入错误状态，确认错误传播与边界恢复行为。
      'Caught error: Failed to load: Result',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <span prop="Caught error: Failed to load: Result" />,
    );
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于不同优先级更新与挂起层级交错，确认调度器继续处理可运行工作且不丢队列。
   * When：启动低优先级渲染，再以更高优先级工作或 ping 打断。
   * Then：不同优先级更新与挂起层级交错，确认调度器继续处理可运行工作且不丢队列。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache
  it('can update at a higher priority while in a suspended state', async () => {
    let setHighPri;
    /** HighPri 作为“不同优先级更新与挂起层级交错，确认调度器继续处理可运行工作且不丢队列”场景的测试 fixture，暴露对应渲染、资源或调度行为。 */
    function HighPri() {
      const [text, setText] = React.useState('A');
      setHighPri = setText;
      return <Text text={text} />;
    }

    let setLowPri;
    /** LowPri 作为“不同优先级更新与挂起层级交错，确认调度器继续处理可运行工作且不丢队列”场景的测试 fixture，暴露对应渲染、资源或调度行为。 */
    function LowPri() {
      const [text, setText] = React.useState('1');
      setLowPri = setText;
      return <AsyncText text={text} />;
    }

    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“不同优先级更新与挂起层级交错，确认调度器继续处理可运行工作且不丢队列”场景。 */
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

    // 检查挂载、生命周期或 Effect 只在对应提交阶段执行。
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

    // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
    await act(() => startTransition(() => setLowPri('2')));
    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
    assertLog(['Suspend! [2]', 'Loading...']);

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
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

    // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
    await act(() => resolveText('2'));
    assertLog(['2']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="B" />
        <span prop="2" />
      </>,
    );
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于不同优先级更新与挂起层级交错，确认调度器继续处理可运行工作且不丢队列。
   * When：启动低优先级渲染，再以更高优先级工作或 ping 打断。
   * Then：不同优先级更新与挂起层级交错，确认调度器继续处理可运行工作且不丢队列。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`attachPingListener()`、`pingSuspendedRoot()` 与 `retryTimedOutBoundary()`。
   */
  // @gate enableLegacyCache
  it('keeps working on lower priority work after being pinged', async () => {
    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“不同优先级更新与挂起层级交错，确认调度器继续处理可运行工作且不丢队列”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于不同优先级更新与挂起层级交错，确认调度器继续处理可运行工作且不丢队列。
   * When：启动低优先级渲染，再以更高优先级工作或 ping 打断。
   * Then：不同优先级更新与挂起层级交错，确认调度器继续处理可运行工作且不丢队列。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache
  it('tries rendering a lower priority pending update even if a higher priority one suspends', async () => {
    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“不同优先级更新与挂起层级交错，确认调度器继续处理可运行工作且不丢队列”场景。 */
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
      // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
      'Suspend! [Async]',
      // 安排目标状态更新，并检查它在挂起、重试和提交之间不会丢失。
      '(empty)',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="(empty)" />);
  });

  // 注意：本用例最初针对 expiration-times 启发式；新模型下可能已不再适用。
  // TODO：本用例已无法覆盖最初目标，应重写或删除。
  /**
   * Given：已构造边界树、资源状态和调度检查点，用于不同优先级更新与挂起层级交错，确认调度器继续处理可运行工作且不丢队列。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：不同优先级更新与挂起层级交错，确认调度器继续处理可运行工作且不丢队列。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  it('tries each subsequent level after suspending', async () => {
    const root = ReactNoop.createRoot();

    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“不同优先级更新与挂起层级交错，确认调度器继续处理可运行工作且不丢队列”场景。 */
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

    /** interrupt 驱动资源解决或优先级中断，是当前用例唯一关键触发入口。 */
    function interrupt() {
      // 安排目标状态更新，并检查它在挂起、重试和提交之间不会丢失。
      ReactNoop.flushSync(() => {
        ReactNoop.renderToRootWithID(null, 'other-root');
      });
    }

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
    await act(() => {
      root.render(<App step={0} shouldSuspend={false} />);
    });
    await advanceTimers(1000);
    assertLog(['Sibling', 'Step 0']);

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于嵌套边界使用可避免或空 fallback，确认 React 选择最合适且已稳定显示的回退层。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：嵌套边界使用可避免或空 fallback，确认 React 选择最合适且已稳定显示的回退层。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()`、`mountSuspenseFallbackChildren()` 与 `renderDidSuspendDelayIfPossible()`。
   */
  // @gate enableLegacyCache
  it('switches to an inner fallback after suspending for a while', async () => {
    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
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
      // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
      'Suspend! [Outer content]',
      'Loading outer...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [Outer content]',
      'Suspend! [Inner content]',
      'Loading inner...',
    ]);
    // 检查当前时刻应显示或保留的 fallback，避免主内容与占位错误切换。
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Sync" />
        <span prop="Loading outer..." />
      </>,
    );

    // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
    await resolveText('Outer content');
    await waitForAll([
      'Outer content',
      'Suspend! [Inner content]',
      'Loading inner...',
    ]);
    // 检查当前时刻应显示或保留的 fallback，避免主内容与占位错误切换。
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Sync" />
        <span prop="Loading outer..." />
      </>,
    );

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
    ReactNoop.expire(500);
    await advanceTimers(500);
    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Sync" />
        <span prop="Outer content" />
        <span prop="Loading inner..." />
      </>,
    );

    // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于同步或 legacy 更新在边界内外挂起，确认对应同步 fallback 或缺少边界错误语义。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：同步或 legacy 更新在边界内外挂起，确认对应同步 fallback 或缺少边界错误语义。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache
  it('renders an Suspense boundary synchronously', async () => {
    spyOnDev(console, 'error');
    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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
      // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
      'Suspend! [Async]',
      // 检查当前时刻应显示或保留的 fallback，避免主内容与占位错误切换。
      'Loading...',
      // 继续处理同层兄弟节点。
      'Sync',
    ]);
    // 完成或检查本轮提交，区分已完成工作与仅渲染未提交的内容。
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Loading..." />
        <span prop="Sync" />
      </>,
    );

    // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
    await act(() => resolveText('Async'));
    assertLog(['Async']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Async" />
        <span prop="Sync" />
      </>,
    );
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于推进虚拟时间并解决资源，确认 fallback 超时、到期和提前恢复时机。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：推进虚拟时间并解决资源，确认 fallback 超时、到期和提前恢复时机。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
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
    // 完成或检查本轮提交，区分已完成工作与仅渲染未提交的内容。
    expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading (outer)..." />);
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
   * When：按用例顺序解决资源并冲刷 ping 触发的重试。
   * Then：主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`attachPingListener()`、`pingSuspendedRoot()` 与 `retryTimedOutBoundary()`。
   */
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

    // 检查当前时刻应显示或保留的 fallback，避免主内容与占位错误切换。
    await waitForAll(['Async', 'Sibling']);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="Async" />
        <span prop="Sibling" />
      </>,
    );
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于同步或 legacy 更新在边界内外挂起，确认对应同步 fallback 或缺少边界错误语义。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：同步或 legacy 更新在边界内外挂起，确认对应同步 fallback 或缺少边界错误语义。
   *
   * 验证机制：显式断言检查最终内容和副作用。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache
  it('in concurrent mode, does not error when an update suspends without a Suspense boundary during a sync update', () => {
    // 该步骤应产生并校验对应的开发态告警。
    expect(() => {
      ReactNoop.flushSync(() => {
        ReactNoop.render(<AsyncText text="Async" />);
      });
    }).not.toThrow();
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于同步或 legacy 更新在边界内外挂起，确认对应同步 fallback 或缺少边界错误语义。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：同步或 legacy 更新在边界内外挂起，确认对应同步 fallback 或缺少边界错误语义。
   *
   * 验证机制：显式断言检查最终内容和副作用。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache && !disableLegacyMode
  it('in legacy mode, errors when an update suspends without a Suspense boundary during a sync update', async () => {
    const root = ReactNoop.createLegacyRoot();
    await expect(async () => {
      await act(() => root.render(<AsyncText text="Async" />));
    }).rejects.toThrow(
      'A component suspended while responding to synchronous input.',
    );
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于同一边界含多个挂起子节点，确认全部 ping 订阅和恢复均被保留。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：同一边界含多个挂起子节点，确认全部 ping 订阅和恢复均被保留。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于推进虚拟时间并解决资源，确认 fallback 超时、到期和提前恢复时机。
   * When：推进虚拟时间、消耗 CPU 预算并继续冲刷渲染。
   * Then：推进虚拟时间并解决资源，确认 fallback 超时、到期和提前恢复时机。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()`、`mountSuspenseFallbackChildren()` 与 `renderDidSuspendDelayIfPossible()`。
   */
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

    // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
    await resolveText('Async');
    // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
    await waitForAll(['Async']);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="Async" />);
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
   * When：启动低优先级渲染，再以更高优先级工作或 ping 打断。
   * Then：主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache
  it('starts working on an update even if its priority falls between two suspended levels', async () => {
    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试”场景。 */
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

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
    ReactNoop.render(<App text="S" />);
    await waitForAll(['S']);

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
    React.startTransition(() => ReactNoop.render(<App text="A" />));
    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
    await waitForAll(['Suspend! [A]', 'Loading...']);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="S" />);

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
    await advanceTimers(4999);
    ReactNoop.expire(4999);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="S" />);

    // 低优先级检查点。
    React.startTransition(() => ReactNoop.render(<App text="B" />));
    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
    await waitForAll(['Suspend! [B]', 'Loading...']);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="S" />);

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
    ReactNoop.render(<App text="C" />);
    await waitForAll(['C']);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="C" />);

    // 分段冲刷或让出调度工作，以锁定当前渲染检查点。
    await resolveText('A');
    await resolveText('B');
    // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="C" />);
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于推进虚拟时间并解决资源，确认 fallback 超时、到期和提前恢复时机。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：推进虚拟时间并解决资源，确认 fallback 超时、到期和提前恢复时机。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache
  it('a suspended update that expires', async () => {
    // 回归场景：复现历史缺陷并锁定修复后的 Suspense 调度或提交不变量。
    /** ExpensiveText 构造可挂起、可更新或高成本的内容行，并把执行进度写入调度日志。 */
    function ExpensiveText({text}) {
      // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
      Scheduler.unstable_advanceTime(10000);
      // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
      return <AsyncText text={text} />;
    }

    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“推进虚拟时间并解决资源，确认 fallback 超时、到期和提前恢复时机”场景。 */
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
    /**
     * Given：已构造边界树、资源状态和调度检查点，用于主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
     */
    // @gate enableLegacyCache && !disableLegacyMode
    it('times out immediately', async () => {
      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试”场景。 */
      function App() {
        return (
          <Suspense fallback={<Text text="Loading..." />}>
            <AsyncText text="Result" />
          </Suspense>
        );
      }

      // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
      ReactNoop.renderLegacySyncRoot(<App />);
      assertLog(['Suspend! [Result]', 'Loading...']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);

      await act(() => {
        resolveText('Result');
      });

      assertLog(['Result']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Result" />);
    });

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
     */
    // @gate enableLegacyCache && !disableLegacyMode
    it('times out immediately when Suspense is in legacy mode', async () => {
      /** 定义 UpdatingText 类 fixture，在“主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试”场景中暴露实例 state 与提交生命周期。 */
      class UpdatingText extends React.Component {
        /** 保存 UpdatingText.state 的实例状态，跨挂起、fallback 与重试提交维持测试不变量。 */
        state = {step: 1};
        /** 渲染 UpdatingText.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
        render() {
          return <AsyncText text={`Step: ${this.state.step}`} />;
        }
      }

      /** Spinner 输出可识别 fallback，并记录其挂载或意外到达情况。 */
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
      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试”场景。 */
      function App() {
        return (
          <Suspense fallback={<Spinner />}>
            <UpdatingText ref={text} />
            <Text text="Sibling" />
          </Suspense>
        );
      }

      // 检查挂载、生命周期或 Effect 只在对应提交阶段执行。
      await seedNextTextCache('Step: 1');
      ReactNoop.renderLegacySyncRoot(<App />);
      assertLog(['Step: 1', 'Sibling']);
      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span prop="Step: 1" />
          <span prop="Sibling" />
        </>,
      );

      // 安排目标状态更新，并检查它在挂起、重试和提交之间不会丢失。
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

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
     */
    // @gate enableLegacyCache && !disableLegacyMode
    it('does not re-render siblings in loose mode', async () => {
      /** 定义 TextWithLifecycle 类 fixture，在“主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试”场景中暴露实例 state 与提交生命周期。 */
      class TextWithLifecycle extends React.Component {
        /** TextWithLifecycle.componentDidMount 记录真实挂载提交，未提交的挂起尝试不得调用。 */
        componentDidMount() {
          Scheduler.log(`Mount [${this.props.text}]`);
        }
        /** TextWithLifecycle.componentDidUpdate 记录已提交更新，用于区分恢复复用与重新挂载。 */
        componentDidUpdate() {
          Scheduler.log(`Update [${this.props.text}]`);
        }
        /** 渲染 TextWithLifecycle.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
        render() {
          return <Text {...this.props} />;
        }
      }

      /** 定义 AsyncTextWithLifecycle 类 fixture，在“主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试”场景中暴露实例 state 与提交生命周期。 */
      class AsyncTextWithLifecycle extends React.Component {
        /** AsyncTextWithLifecycle.componentDidMount 记录真实挂载提交，未提交的挂起尝试不得调用。 */
        componentDidMount() {
          Scheduler.log(`Mount [${this.props.text}]`);
        }
        /** AsyncTextWithLifecycle.componentDidUpdate 记录已提交更新，用于区分恢复复用与重新挂载。 */
        componentDidUpdate() {
          Scheduler.log(`Update [${this.props.text}]`);
        }
        /** 渲染 AsyncTextWithLifecycle.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
        render() {
          return <AsyncText {...this.props} />;
        }
      }

      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试”场景。 */
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
        // 检查挂载、生命周期或 Effect 只在对应提交阶段执行。
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

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于类构造器读取未完成资源，确认挂起重试不会错误提交半初始化实例。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：类构造器读取未完成资源，确认挂起重试不会错误提交半初始化实例。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
     */
    // @gate enableLegacyCache && !disableLegacyMode
    it('suspends inside constructor', async () => {
      /** 定义 AsyncTextInConstructor 类 fixture，在“类构造器读取未完成资源，确认挂起重试不会错误提交半初始化实例”场景中暴露实例 state 与提交生命周期。 */
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
        /** 渲染 AsyncTextInConstructor.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
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

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于fallback 生命周期安排更新，确认边界不会在回退提交中无限循环。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：fallback 生命周期安排更新，确认边界不会在回退提交中无限循环。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`updateSuspenseComponent()`、`mountSuspenseFallbackChildren()` 与 `renderDidSuspendDelayIfPossible()`。
     */
    // @gate enableLegacyCache && !disableLegacyMode
    it('does not infinite loop if fallback contains lifecycle method', async () => {
      /** 定义 Fallback 类 fixture，在“fallback 生命周期安排更新，确认边界不会在回退提交中无限循环”场景中暴露实例 state 与提交生命周期。 */
      class Fallback extends React.Component {
        /** 保存 Fallback.state 的实例状态，跨挂起、fallback 与重试提交维持测试不变量。 */
        state = {
          name: 'foo',
        };
        /** Fallback.componentDidMount 记录真实挂载提交，未提交的挂起尝试不得调用。 */
        componentDidMount() {
          this.setState({
            name: 'bar',
          });
        }
        /** 渲染 Fallback.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
        render() {
          return <Text text="Loading..." />;
        }
      }

      /** 定义 Demo 类 fixture，在“fallback 生命周期安排更新，确认边界不会在回退提交中无限循环”场景中暴露实例 state 与提交生命周期。 */
      class Demo extends React.Component {
        /** 渲染 Demo.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
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
        // 检查挂载、生命周期或 Effect 只在对应提交阶段执行。
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
      /**
       * Given：已构造边界树、资源状态和调度检查点，用于主树挂起和恢复时切换宿主可见性，确认隐藏发生在 Layout Effect 读取前。
       * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
       * Then：主树挂起和恢复时切换宿主可见性，确认隐藏发生在 Layout Effect 读取前。
       *
       * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序。
       * 对应源码：`updateSuspenseComponent()` 与提交阶段 Offscreen/Effect 可见性处理。
       */
      // @gate enableLegacyCache && !disableLegacyMode
      it('hides/unhides suspended children before layout effects fire (persistent)', async () => {
        const {useRef, useLayoutEffect} = React;

        /** Parent 作为层级 fixture 暴露 unwind、兄弟遍历或边界传播顺序，服务于“主树挂起和恢复时切换宿主可见性，确认隐藏发生在 Layout Effect 读取前”场景。 */
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

        /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“主树挂起和恢复时切换宿主可见性，确认隐藏发生在 Layout Effect 读取前”场景。 */
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
          // 检查 SuspenseList 当前行、揭示顺序与 tail 裁剪状态。
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
      /**
       * Given：已构造边界树、资源状态和调度检查点，用于主树挂起和恢复时切换宿主可见性，确认隐藏发生在 Layout Effect 读取前。
       * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
       * Then：主树挂起和恢复时切换宿主可见性，确认隐藏发生在 Layout Effect 读取前。
       *
       * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序。
       * 对应源码：`updateSuspenseComponent()` 与提交阶段 Offscreen/Effect 可见性处理。
       */
      // @gate enableLegacyCache && !disableLegacyMode
      it('hides/unhides suspended children before layout effects fire (mutation)', async () => {
        const {useRef, useLayoutEffect} = React;

        /** Parent 作为层级 fixture 暴露 unwind、兄弟遍历或边界传播顺序，服务于“主树挂起和恢复时切换宿主可见性，确认隐藏发生在 Layout Effect 读取前”场景。 */
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

        /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“主树挂起和恢复时切换宿主可见性，确认隐藏发生在 Layout Effect 读取前”场景。 */
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
          // 检查 SuspenseList 当前行、揭示顺序与 tail 裁剪状态。
          'Child is hidden: true',
        ]);

        await act(() => {
          resolveText('Hi');
        });

        assertLog(['Hi']);
      });
    }

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于挂起组件的返回路径抛错，确认 unwinding 后由错误边界处理。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：挂起组件的返回路径抛错，确认 unwinding 后由错误边界处理。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
     */
    // @gate enableLegacyCache && !disableLegacyMode
    it('handles errors in the return path of a component that suspends', async () => {
      // 该回归关注 primary Fragment Fiber 是否进入 setState 的 return path。
      /** 定义 ErrorBoundary 类 fixture，在“挂起组件的返回路径抛错，确认 unwinding 后由错误边界处理”场景中暴露实例 state 与提交生命周期。 */
      class ErrorBoundary extends React.Component {
        /** 保存 ErrorBoundary.state 的实例状态，跨挂起、fallback 与重试提交维持测试不变量。 */
        state = {error: null};
        /** ErrorBoundary.getDerivedStateFromError 把资源 rejection 后的业务错误交给错误边界状态与日志。 */
        static getDerivedStateFromError(error, errorInfo) {
          return {error};
        }
        /** 渲染 ErrorBoundary.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
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

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于挂起或删除已挂载子树，确认既有 Effect 不丢失且真实删除执行清理。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：挂起或删除已挂载子树，确认既有 Effect 不丢失且真实删除执行清理。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`updateSuspenseComponent()` 与提交阶段 Offscreen/Effect 可见性处理。
     */
    // @gate !disableLegacyMode
    it('does not drop mounted effects', async () => {
      /** then 实现 thenable 订阅：pending 时登记 ping，已结束时用微任务通知；同一监听器不得同步重复执行。 */
      const never = {/** 永不主动 ping 的 thenable 协议入口。 */ then() {}};

      let setShouldSuspend;
      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“挂起或删除已挂载子树，确认既有 Effect 不丢失且真实删除执行清理”场景。 */
      function App() {
        const [shouldSuspend, _setShouldSuspend] = React.useState(0);
        setShouldSuspend = _setShouldSuspend;
        return (
          <Suspense fallback="Loading...">
            <Child shouldSuspend={shouldSuspend} />
          </Suspense>
        );
      }

      /** Child 作为层级 fixture 暴露 unwind、兄弟遍历或边界传播顺序，服务于“挂起或删除已挂载子树，确认既有 Effect 不丢失且真实删除执行清理”场景。 */
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

      // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
      await act(() => {
        setShouldSuspend(true);
      });
      expect(root).toMatchRenderedOutput('Loading...');

      // 删除目标子树并检查真实卸载清理；隐藏或未提交工作不得误触发。
      await act(() => {
        root.render(null);
      });
      assertLog(['Unmount']);
    });
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于未提交的挂起组件含类或 Hook 生命周期，确认 mount/update Effect 均不执行。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：未提交的挂起组件含类或 Hook 生命周期，确认 mount/update Effect 均不执行。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()` 与提交阶段 Offscreen/Effect 可见性处理。
   */
  // @gate enableLegacyCache && !disableLegacyMode
  it('does not call lifecycles of a suspended component', async () => {
    /** 定义 TextWithLifecycle 类 fixture，在“未提交的挂起组件含类或 Hook 生命周期，确认 mount/update Effect 均不执行”场景中暴露实例 state 与提交生命周期。 */
    class TextWithLifecycle extends React.Component {
      /** TextWithLifecycle.componentDidMount 记录真实挂载提交，未提交的挂起尝试不得调用。 */
      componentDidMount() {
        Scheduler.log(`Mount [${this.props.text}]`);
      }
      /** TextWithLifecycle.componentDidUpdate 记录已提交更新，用于区分恢复复用与重新挂载。 */
      componentDidUpdate() {
        Scheduler.log(`Update [${this.props.text}]`);
      }
      /** TextWithLifecycle.componentWillUnmount 记录真实删除清理；单纯隐藏或未提交挂起不应误调用。 */
      componentWillUnmount() {
        Scheduler.log(`Unmount [${this.props.text}]`);
      }
      /** 渲染 TextWithLifecycle.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
      render() {
        return <Text {...this.props} />;
      }
    }

    /** 定义 AsyncTextWithLifecycle 类 fixture，在“未提交的挂起组件含类或 Hook 生命周期，确认 mount/update Effect 均不执行”场景中暴露实例 state 与提交生命周期。 */
    class AsyncTextWithLifecycle extends React.Component {
      /** AsyncTextWithLifecycle.componentDidMount 记录真实挂载提交，未提交的挂起尝试不得调用。 */
      componentDidMount() {
        Scheduler.log(`Mount [${this.props.text}]`);
      }
      /** AsyncTextWithLifecycle.componentDidUpdate 记录已提交更新，用于区分恢复复用与重新挂载。 */
      componentDidUpdate() {
        Scheduler.log(`Update [${this.props.text}]`);
      }
      /** AsyncTextWithLifecycle.componentWillUnmount 记录真实删除清理；单纯隐藏或未提交挂起不应误调用。 */
      componentWillUnmount() {
        Scheduler.log(`Unmount [${this.props.text}]`);
      }
      /** 渲染 AsyncTextWithLifecycle.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
      render() {
        const text = this.props.text;
        readText(text);
        Scheduler.log(text);
        return <span prop={text} />;
      }
    }

    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“未提交的挂起组件含类或 Hook 生命周期，确认 mount/update Effect 均不执行”场景。 */
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
      // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于未提交的挂起组件含类或 Hook 生命周期，确认 mount/update Effect 均不执行。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：未提交的挂起组件含类或 Hook 生命周期，确认 mount/update Effect 均不执行。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()` 与提交阶段 Offscreen/Effect 可见性处理。
   */
  // @gate enableLegacyCache && !disableLegacyMode
  it('does not call lifecycles of a suspended component (hooks)', async () => {
    /** TextWithLifecycle 作为“未提交的挂起组件含类或 Hook 生命周期，确认 mount/update Effect 均不执行”场景的测试 fixture，暴露对应渲染、资源或调度行为。 */
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

    /** AsyncTextWithLifecycle 构造可挂起、可更新或高成本的内容行，并把执行进度写入调度日志。 */
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

    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“未提交的挂起组件含类或 Hook 生命周期，确认 mount/update Effect 均不执行”场景。 */
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
      // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
      // 'Layout Effect [B]',
      'Layout Effect [C]',
      'Layout Effect [Loading...]',
      'Commit root',
    ]);

    // 分段冲刷或让出调度工作，以锁定当前渲染检查点。
    await waitForAll([
      'Effect [A]',
      // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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

    // 安排目标状态更新，并检查它在挂起、重试和提交之间不会丢失。
    ReactNoop.renderLegacySyncRoot(<App text="B2" />, () =>
      Scheduler.log('Commit root'),
    );

    assertLog([
      'A',
      'Suspend! [B2]',
      'C',
      'Loading...',

      // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
      // 'Layout Effect [B2]',
      'Layout Effect [Loading...]',
      'Commit root',
    ]);

    // 分段冲刷或让出调度工作，以锁定当前渲染检查点。
    await waitForAll([
      // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于fallback 最近提交或被填充后资源解决，确认主内容揭示受节流窗口约束。
   * When：推进虚拟时间、消耗 CPU 预算并继续冲刷渲染。
   * Then：fallback 最近提交或被填充后资源解决，确认主内容揭示受节流窗口约束。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()`、`mountSuspenseFallbackChildren()` 与 `renderDidSuspendDelayIfPossible()`。
   */
  // @gate enableLegacyCache
  it('does not suspends if a fallback has been shown for a long time', async () => {
    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“fallback 最近提交或被填充后资源解决，确认主内容揭示受节流窗口约束”场景。 */
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
    // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
    await waitForAll([
      'Foo',
      // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
      'Suspend! [A]',
      'Loading...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
      'Suspend! [B]',
      'Loading more...',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
    Scheduler.unstable_advanceTime(5000);
    await advanceTimers(5000);

    // 使用新内容执行 Suspense retry。
    await resolveText('A');
    await waitForAll([
      'A',
      // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
      'Suspend! [B]',
      'Loading more...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [B]',
    ]);

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="Loading more..." />
      </>,
    );

    // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
    await act(() => resolveText('B'));
    // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
    assertLog(['B']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="B" />
      </>,
    );
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于fallback 最近提交或被填充后资源解决，确认主内容揭示受节流窗口约束。
   * When：推进虚拟时间、消耗 CPU 预算并继续冲刷渲染。
   * Then：fallback 最近提交或被填充后资源解决，确认主内容揭示受节流窗口约束。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()`、`mountSuspenseFallbackChildren()` 与 `renderDidSuspendDelayIfPossible()`。
   */
  // @gate enableLegacyCache
  it('throttles content from appearing if a fallback was shown recently', async () => {
    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“fallback 最近提交或被填充后资源解决，确认主内容揭示受节流窗口约束”场景。 */
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
    // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
    await waitForAll([
      'Foo',
      // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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
        // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
        'Suspend! [B]',
        'Loading more...',
      ]);
      // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);

      // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
      await resolveText('B');
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);

      // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
      await waitForAll(['A', 'B']);

      if (gate(flags => flags.alwaysThrottleRetries)) {
        // 以下断言描述当前正确行为。
        //
        // 检查当前时刻应显示或保留的 fallback，避免主内容与占位错误切换。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于fallback 最近提交或被填充后资源解决，确认主内容揭示受节流窗口约束。
   * When：推进虚拟时间、消耗 CPU 预算并继续冲刷渲染。
   * Then：fallback 最近提交或被填充后资源解决，确认主内容揭示受节流窗口约束。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()`、`mountSuspenseFallbackChildren()` 与 `renderDidSuspendDelayIfPossible()`。
   */
  // @gate enableLegacyCache
  it('throttles content from appearing if a fallback was filled in recently', async () => {
    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“fallback 最近提交或被填充后资源解决，确认主内容揭示受节流窗口约束”场景。 */
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
    // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
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

    // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
    await act(async () => {
      await resolveText('A');

      // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
      Scheduler.unstable_advanceTime(10000);
      jest.advanceTimersByTime(10000);
      if (gate(flags => flags.enableYieldingBeforePassive)) {
        // 检查挂载、生命周期或 Effect 只在对应提交阶段执行。
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

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
    Scheduler.unstable_advanceTime(200);
    jest.advanceTimersByTime(200);

    // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
    await act(async () => {
      await resolveText('B');
      await waitForPaint(['B']);

      if (gate(flags => flags.alwaysThrottleRetries)) {
        // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
        expect(ReactNoop).toMatchRenderedOutput(
          <>
            <span prop="A" />
            <span prop="Loading B..." />
          </>,
        );

        // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
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
        // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
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
  /**
   * Given：已构造边界树、资源状态和调度检查点，用于高低优先级更新跨边界挂起，确认只在真正不安全的 fallback 场景诊断。
   * When：以同步高优先级入口触发内部低优先级挂起。
   * Then：当前实现不报告该跨优先级挂起；未来恢复诊断时由上方待办切换预期。
   *
   * 验证机制：用例仅验证渲染可完成且当前不产生告警；上方待办记录未来恢复诊断后的断言位置。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache
  it('does not warn when a low priority update suspends inside a high priority update for functional components', async () => {
    let _setShow;
    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“高低优先级更新跨边界挂起，确认只在真正不安全的 fallback 场景诊断”场景。 */
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
  /**
   * Given：已构造边界树、资源状态和调度检查点，用于高低优先级更新跨边界挂起，确认只在真正不安全的 fallback 场景诊断。
   * When：以同步高优先级入口触发内部低优先级挂起。
   * Then：当前实现不报告该跨优先级挂起；未来恢复诊断时由上方待办切换预期。
   *
   * 验证机制：用例仅验证渲染可完成且当前不产生告警；上方待办记录未来恢复诊断后的断言位置。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache
  it('does not warn when a low priority update suspends inside a high priority update for class components', async () => {
    let show;
    /** 定义 App 类 fixture，在“高低优先级更新跨边界挂起，确认只在真正不安全的 fallback 场景诊断”场景中暴露实例 state 与提交生命周期。 */
    class App extends React.Component {
      /** 保存 App.state 的实例状态，跨挂起、fallback 与重试提交维持测试不变量。 */
      state = {show: false};

      /** 渲染 App.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
      render() {
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于高低优先级更新跨边界挂起，确认只在真正不安全的 fallback 场景诊断。
   * When：渲染包含该非法配置或 children 形状的列表。
   * Then：高低优先级更新跨边界挂起，确认只在真正不安全的 fallback 场景诊断。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()`、`mountSuspenseFallbackChildren()` 与 `renderDidSuspendDelayIfPossible()`。
   */
  // @gate enableLegacyCache
  it('does not warn about wrong Suspense priority if no new fallbacks are shown', async () => {
    let showB;
    /** 定义 App 类 fixture，在“高低优先级更新跨边界挂起，确认只在真正不安全的 fallback 场景诊断”场景中暴露实例 state 与提交生命周期。 */
    class App extends React.Component {
      /** 保存 App.state 的实例状态，跨挂起、fallback 与重试提交维持测试不变量。 */
      state = {showB: false};

      /** 渲染 App.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
      render() {
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
  /**
   * Given：已构造边界树、资源状态和调度检查点，用于高低优先级更新跨边界挂起，确认只在真正不安全的 fallback 场景诊断。
   * When：以同步高优先级入口触发内部低优先级挂起。
   * Then：当前实现不报告该跨优先级挂起；未来恢复诊断时由上方待办切换预期。
   *
   * 验证机制：用例仅验证渲染可完成且当前不产生告警；上方待办记录未来恢复诊断后的断言位置。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache
  it(
    'does not warn when component that triggered user-blocking update is between Suspense boundary ' +
      'and component that suspended',
    async () => {
      let _setShow;
      /** A 作为“高低优先级更新跨边界挂起，确认只在真正不安全的 fallback 场景诊断”场景的测试 fixture，暴露对应渲染、资源或调度行为。 */
      function A() {
        const [show, setShow] = React.useState(false);
        _setShow = setShow;
        return show && <AsyncText text="A" />;
      }
      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“高低优先级更新跨边界挂起，确认只在真正不安全的 fallback 场景诊断”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于高低优先级更新跨边界挂起，确认只在真正不安全的 fallback 场景诊断。
   * When：渲染包含该非法配置或 children 形状的列表。
   * Then：高低优先级更新跨边界挂起，确认只在真正不安全的 fallback 场景诊断。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache
  it('normal priority updates suspending do not warn for class components', async () => {
    let show;
    /** 定义 App 类 fixture，在“高低优先级更新跨边界挂起，确认只在真正不安全的 fallback 场景诊断”场景中暴露实例 state 与提交生命周期。 */
    class App extends React.Component {
      /** 保存 App.state 的实例状态，跨挂起、fallback 与重试提交维持测试不变量。 */
      state = {show: false};

      /** 渲染 App.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
      render() {
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

    // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
    await act(() => show(true));

    assertLog([
      'Suspend! [A]',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
    ]);
    await resolveText('A');

    expect(ReactNoop).toMatchRenderedOutput('Loading...');
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于高低优先级更新跨边界挂起，确认只在真正不安全的 fallback 场景诊断。
   * When：渲染包含该非法配置或 children 形状的列表。
   * Then：高低优先级更新跨边界挂起，确认只在真正不安全的 fallback 场景诊断。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache
  it('normal priority updates suspending do not warn for functional components', async () => {
    let _setShow;
    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“高低优先级更新跨边界挂起，确认只在真正不安全的 fallback 场景诊断”场景。 */
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

    // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
    await act(() => _setShow(true));

    assertLog([
      'Suspend! [A]',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
    ]);
    await resolveText('A');

    expect(ReactNoop).toMatchRenderedOutput('Loading...');
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于嵌套边界使用可避免或空 fallback，确认 React 选择最合适且已稳定显示的回退层。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：嵌套边界使用可避免或空 fallback，确认 React 选择最合适且已稳定显示的回退层。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()`、`mountSuspenseFallbackChildren()` 与 `renderDidSuspendDelayIfPossible()`。
   */
  // @gate enableLegacyCache && enableSuspenseAvoidThisFallback
  it('shows the parent fallback if the inner fallback should be avoided', async () => {
    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“嵌套边界使用可避免或空 fallback，确认 React 选择最合适且已稳定显示的回退层”场景。 */
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

    // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
    await act(() => resolveText('A'));
    assertLog(['A', 'B']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="B" />
      </>,
    );

    // 安排目标状态更新，并检查它在挂起、重试和提交之间不会丢失。
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
    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
    Scheduler.unstable_advanceTime(600);
    await advanceTimers(600);
    // 检查当前时刻应显示或保留的 fallback，避免主内容与占位错误切换。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于嵌套边界使用可避免或空 fallback，确认 React 选择最合适且已稳定显示的回退层。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：嵌套边界使用可避免或空 fallback，确认 React 选择最合适且已稳定显示的回退层。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()`、`mountSuspenseFallbackChildren()` 与 `renderDidSuspendDelayIfPossible()`。
   */
  // @gate enableLegacyCache
  it('does not show the parent fallback if the inner fallback is not defined', async () => {
    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“嵌套边界使用可避免或空 fallback，确认 React 选择最合适且已稳定显示的回退层”场景。 */
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

    // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
    await act(() => resolveText('A'));
    assertLog(['A']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="B" />
      </>,
    );

    // 安排目标状态更新，并检查它在挂起、重试和提交之间不会丢失。
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
    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于嵌套边界使用可避免或空 fallback，确认 React 选择最合适且已稳定显示的回退层。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：嵌套边界使用可避免或空 fallback，确认 React 选择最合适且已稳定显示的回退层。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()`、`mountSuspenseFallbackChildren()` 与 `renderDidSuspendDelayIfPossible()`。
   */
  // @gate enableLegacyCache
  it('favors showing the inner fallback for nested top level avoided fallback', async () => {
    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“嵌套边界使用可避免或空 fallback，确认 React 选择最合适且已稳定显示的回退层”场景。 */
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
    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
    Scheduler.unstable_advanceTime(600);
    await advanceTimers(600);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="Loading B..." />
      </>,
    );
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于嵌套边界使用可避免或空 fallback，确认 React 选择最合适且已稳定显示的回退层。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：嵌套边界使用可避免或空 fallback，确认 React 选择最合适且已稳定显示的回退层。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()`、`mountSuspenseFallbackChildren()` 与 `renderDidSuspendDelayIfPossible()`。
   */
  // @gate enableLegacyCache && enableSuspenseAvoidThisFallback
  it('keeps showing an avoided parent fallback if it is already showing', async () => {
    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“嵌套边界使用可避免或空 fallback，确认 React 选择最合适且已稳定显示的回退层”场景。 */
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

    // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
    expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于嵌套边界使用可避免或空 fallback，确认 React 选择最合适且已稳定显示的回退层。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：嵌套边界使用可避免或空 fallback，确认 React 选择最合适且已稳定显示的回退层。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()`、`mountSuspenseFallbackChildren()` 与 `renderDidSuspendDelayIfPossible()`。
   */
  // @gate enableLegacyCache
  it('keeps showing an undefined fallback if it is already showing', async () => {
    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“嵌套边界使用可避免或空 fallback，确认 React 选择最合适且已稳定显示的回退层”场景。 */
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
    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
    expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
    Scheduler.unstable_advanceTime(600);
    await advanceTimers(600);

    expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);
  });

  /** 通过 Noop 调度日志验证 Suspense 的优先级、ping、fallback、隐藏子树、错误和更新队列。 */
  describe('startTransition', () => {
    /**
     * Given：已构造边界树、资源状态和调度检查点，用于主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
     */
    // @gate enableLegacyCache
    it('top level render', async () => {
      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试”场景。 */
      function App({page}) {
        return (
          <Suspense fallback={<Text text="Loading..." />}>
            <AsyncText text={page} />
          </Suspense>
        );
      }

      // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
      React.startTransition(() => ReactNoop.render(<App page="A" />));

      await waitForAll([
        'Suspend! [A]',
        'Loading...',
        // 执行预热渲染，不把该遍结果作为最终提交。
        'Suspend! [A]',
      ]);
      // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
      Scheduler.unstable_advanceTime(400);
      await advanceTimers(400);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);

      // 随后解决数据资源并观察主内容恢复。
      await act(() => resolveText('A'));
      assertLog(['A']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);

      // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
      React.startTransition(() => ReactNoop.render(<App page="B" />));

      await waitForAll(['Suspend! [B]', 'Loading...']);
      Scheduler.unstable_advanceTime(100000);
      await advanceTimers(100000);
      // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
      expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);
      // 随后解决数据资源并观察主内容恢复。
      await act(() => resolveText('B'));
      assertLog(['B']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="B" />);
    });

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
     */
    // @gate enableLegacyCache
    it('hooks', async () => {
      let transitionToPage;
      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试”场景。 */
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

      // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
      await act(async () => {
        React.startTransition(() => transitionToPage('A'));

        await waitForAll([
          'Suspend! [A]',
          'Loading...',
          // 执行预热渲染，不把该遍结果作为最终提交。
          'Suspend! [A]',
        ]);
        // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
        Scheduler.unstable_advanceTime(400);
        await advanceTimers(400);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);
      });

      // 随后解决数据资源并观察主内容恢复。
      await act(() => resolveText('A'));
      assertLog(['A']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);

      // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
      await act(async () => {
        React.startTransition(() => transitionToPage('B'));

        await waitForAll(['Suspend! [B]', 'Loading...']);
        Scheduler.unstable_advanceTime(100000);
        await advanceTimers(100000);
        // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
        expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);
      });
      // 随后解决数据资源并观察主内容恢复。
      await act(() => resolveText('B'));
      assertLog(['B']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="B" />);
    });

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
     */
    // @gate enableLegacyCache
    it('classes', async () => {
      let transitionToPage;
      /** 定义 App 类 fixture，在“主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试”场景中暴露实例 state 与提交生命周期。 */
      class App extends React.Component {
        /** 保存 App.state 的实例状态，跨挂起、fallback 与重试提交维持测试不变量。 */
        state = {page: 'none'};
        /** 渲染 App.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
        render() {
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

      // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
      await act(async () => {
        React.startTransition(() => transitionToPage('A'));

        await waitForAll([
          'Suspend! [A]',
          'Loading...',
          // 执行预热渲染，不把该遍结果作为最终提交。
          'Suspend! [A]',
        ]);
        // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
        Scheduler.unstable_advanceTime(400);
        await advanceTimers(400);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);
      });

      // 随后解决数据资源并观察主内容恢复。
      await act(() => resolveText('A'));
      assertLog(['A']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);

      // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
      await act(async () => {
        React.startTransition(() => transitionToPage('B'));

        await waitForAll(['Suspend! [B]', 'Loading...']);
        Scheduler.unstable_advanceTime(100000);
        await advanceTimers(100000);
        // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
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
    /**
     * Given：已构造边界树、资源状态和调度检查点，用于主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
     */
    // @gate enableLegacyCache
    it('top level render', async () => {
      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试”场景。 */
      function App({page}) {
        return (
          <Suspense fallback={<Text text="Loading..." />}>
            <AsyncText text={page} />
          </Suspense>
        );
      }

      // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
      React.startTransition(() => ReactNoop.render(<App page="A" />));

      await waitForAll([
        'Suspend! [A]',
        'Loading...',
        // 执行预热渲染，不把该遍结果作为最终提交。
        'Suspend! [A]',
      ]);
      // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
      Scheduler.unstable_advanceTime(400);
      await advanceTimers(400);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);

      // 随后解决数据资源并观察主内容恢复。
      await act(() => resolveText('A'));
      assertLog(['A']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);

      // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
      React.startTransition(() => ReactNoop.render(<App page="B" />));

      await waitForAll(['Suspend! [B]', 'Loading...']);
      Scheduler.unstable_advanceTime(2999);
      await advanceTimers(2999);
      // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
      expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);

      // 随后解决数据资源并观察主内容恢复。
      await act(() => resolveText('B'));
      assertLog(['B']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="B" />);

      // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
      React.startTransition(() => ReactNoop.render(<App page="C" />));
      await waitForAll(['Suspend! [C]', 'Loading...']);

      // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
      Scheduler.unstable_advanceTime(100000);
      await advanceTimers(100000);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="B" />);
    });

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
     */
    // @gate enableLegacyCache
    it('hooks', async () => {
      let transitionToPage;
      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试”场景。 */
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

      // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
      await act(async () => {
        React.startTransition(() => transitionToPage('A'));

        await waitForAll([
          'Suspend! [A]',
          'Loading...',
          // 执行预热渲染，不把该遍结果作为最终提交。
          'Suspend! [A]',
        ]);
        // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
        Scheduler.unstable_advanceTime(400);
        await advanceTimers(400);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);
      });

      // 随后解决数据资源并观察主内容恢复。
      await act(() => resolveText('A'));
      assertLog(['A']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);

      // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
      await act(async () => {
        React.startTransition(() => transitionToPage('B'));

        await waitForAll(['Suspend! [B]', 'Loading...']);

        Scheduler.unstable_advanceTime(2999);
        await advanceTimers(2999);
        // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
        expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);
      });

      // 随后解决数据资源并观察主内容恢复。
      await act(() => resolveText('B'));
      assertLog(['B']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="B" />);

      // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
      await act(async () => {
        React.startTransition(() => transitionToPage('C'));

        await waitForAll(['Suspend! [C]', 'Loading...']);

        // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
        Scheduler.unstable_advanceTime(100000);
        await advanceTimers(100000);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="B" />);
      });
    });

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
     */
    // @gate enableLegacyCache
    it('classes', async () => {
      let transitionToPage;
      /** 定义 App 类 fixture，在“主树读取未完成资源并显示 fallback，资源 ping 后按调度优先级重试”场景中暴露实例 state 与提交生命周期。 */
      class App extends React.Component {
        /** 保存 App.state 的实例状态，跨挂起、fallback 与重试提交维持测试不变量。 */
        state = {page: 'none'};
        /** 渲染 App.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
        render() {
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

      // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
      await act(async () => {
        React.startTransition(() => transitionToPage('A'));

        await waitForAll([
          'Suspend! [A]',
          'Loading...',
          // 执行预热渲染，不把该遍结果作为最终提交。
          'Suspend! [A]',
        ]);
        // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
        Scheduler.unstable_advanceTime(400);
        await advanceTimers(400);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="Loading..." />);
      });

      // 随后解决数据资源并观察主内容恢复。
      await act(() => resolveText('A'));
      assertLog(['A']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);

      // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
      await act(async () => {
        React.startTransition(() => transitionToPage('B'));

        await waitForAll(['Suspend! [B]', 'Loading...']);
        Scheduler.unstable_advanceTime(2999);
        await advanceTimers(2999);
        // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
        expect(ReactNoop).toMatchRenderedOutput(<span prop="A" />);
      });

      // 随后解决数据资源并观察主内容恢复。
      await act(() => resolveText('B'));
      assertLog(['B']);
      expect(ReactNoop).toMatchRenderedOutput(<span prop="B" />);

      // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
      await act(async () => {
        React.startTransition(() => transitionToPage('C'));

        await waitForAll(['Suspend! [C]', 'Loading...']);

        // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
        Scheduler.unstable_advanceTime(100000);
        await advanceTimers(100000);
        expect(ReactNoop).toMatchRenderedOutput(<span prop="B" />);
      });
    });
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于嵌套边界使用可避免或空 fallback，确认 React 选择最合适且已稳定显示的回退层。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：嵌套边界使用可避免或空 fallback，确认 React 选择最合适且已稳定显示的回退层。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()`、`mountSuspenseFallbackChildren()` 与 `renderDidSuspendDelayIfPossible()`。
   */
  // @gate enableLegacyCache && enableSuspenseAvoidThisFallback
  it('do not show placeholder when updating an avoided boundary with startTransition', async () => {
    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“嵌套边界使用可避免或空 fallback，确认 React 选择最合适且已稳定显示的回退层”场景。 */
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

    // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
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

    // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
    React.startTransition(() => ReactNoop.render(<App page="B" />));

    await waitForAll(['Hi!', 'Suspend! [B]', 'Loading B...']);

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Hi!" />
        <span prop="A" />
      </>,
    );
    Scheduler.unstable_advanceTime(1800);
    await advanceTimers(1800);
    await waitForAll([]);
    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于嵌套边界使用可避免或空 fallback，确认 React 选择最合适且已稳定显示的回退层。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：嵌套边界使用可避免或空 fallback，确认 React 选择最合适且已稳定显示的回退层。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()`、`mountSuspenseFallbackChildren()` 与 `renderDidSuspendDelayIfPossible()`。
   */
  // @gate enableLegacyCache && enableSuspenseAvoidThisFallback
  it('do not show placeholder when mounting an avoided boundary with startTransition', async () => {
    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“嵌套边界使用可避免或空 fallback，确认 React 选择最合适且已稳定显示的回退层”场景。 */
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

    // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
    ReactNoop.render(<App page="A" />);
    await waitForAll(['Hi!', 'A']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Hi!" />
        <span prop="A" />
      </>,
    );

    // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
    React.startTransition(() => ReactNoop.render(<App page="B" />));

    await waitForAll(['Hi!', 'Suspend! [B]', 'Loading B...']);

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span prop="Hi!" />
        <span prop="A" />
      </>,
    );
    Scheduler.unstable_advanceTime(1800);
    await advanceTimers(1800);
    await waitForAll([]);
    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于挂起后恢复调试阶段状态，确认后续类更新不会继承错误 phase。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：挂起后恢复调试阶段状态，确认后续类更新不会继承错误 phase。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  it('regression test: resets current "debug phase" after suspending', async () => {
    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“挂起后恢复调试阶段状态，确认后续类更新不会继承错误 phase”场景。 */
    function App() {
      return (
        <Suspense fallback="Loading...">
          <Foo suspend={false} />
        </Suspense>
      );
    }

    /** then 实现 thenable 订阅：pending 时登记 ping，已结束时用微任务通知；同一监听器不得同步重复执行。 */
    const thenable = {/** 永不主动 ping 的 thenable 协议入口。 */ then() {}};

    let foo;
    /** 定义 Foo 类 fixture，在“挂起后恢复调试阶段状态，确认后续类更新不会继承错误 phase”场景中暴露实例 state 与提交生命周期。 */
    class Foo extends React.Component {
      /** 保存 Foo.state 的实例状态，跨挂起、fallback 与重试提交维持测试不变量。 */
      state = {suspend: false};
      /** 渲染 Foo.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
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

      // 回归场景：复现历史缺陷并锁定修复后的 Suspense 调度或提交不变量。
      await waitFor(['Suspend!']);

      // 该步骤应产生并校验对应的开发态告警。
      foo.setState({suspend: false});
    });

    assertLog([
      // 安排目标状态更新，并检查它在挂起、重试和提交之间不会丢失。
      'Foo',
    ]);
    expect(root).toMatchRenderedOutput(<span prop="Foo" />);
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于隐藏内容在不同优先级挂起与解除阻塞，确认高优先级可见工作先提交。
   * When：启动低优先级渲染，再以更高优先级工作或 ping 打断。
   * Then：隐藏内容在不同优先级挂起与解除阻塞，确认高优先级可见工作先提交。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache && enableLegacyHidden
  it('should not render hidden content while suspended on higher pri', async () => {
    /** Offscreen 作为“隐藏内容在不同优先级挂起与解除阻塞，确认高优先级可见工作先提交”场景的测试 fixture，暴露对应渲染、资源或调度行为。 */
    function Offscreen() {
      Scheduler.log('Offscreen');
      return 'Offscreen';
    }
    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“隐藏内容在不同优先级挂起与解除阻塞，确认高优先级可见工作先提交”场景。 */
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

    // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
    ReactNoop.render(<App showContent={false} />);
    await waitFor(['Commit']);
    expect(ReactNoop).toMatchRenderedOutput(<div hidden={true} />);

    // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于隐藏内容在不同优先级挂起与解除阻塞，确认高优先级可见工作先提交。
   * When：启动低优先级渲染，再以更高优先级工作或 ping 打断。
   * Then：隐藏内容在不同优先级挂起与解除阻塞，确认高优先级可见工作先提交。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache && enableLegacyHidden
  it('should be able to unblock higher pri content before suspended hidden', async () => {
    /** Offscreen 作为“隐藏内容在不同优先级挂起与解除阻塞，确认高优先级可见工作先提交”场景的测试 fixture，暴露对应渲染、资源或调度行为。 */
    function Offscreen() {
      Scheduler.log('Offscreen');
      return 'Offscreen';
    }
    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“隐藏内容在不同优先级挂起与解除阻塞，确认高优先级可见工作先提交”场景。 */
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

    // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
    ReactNoop.render(<App showContent={false} />);
    await waitFor(['Commit']);
    expect(ReactNoop).toMatchRenderedOutput(<div hidden={true} />);

    // 检查 SuspenseList 当前行、揭示顺序与 tail 裁剪状态。
    await waitFor(['Suspend! [A]']);

    // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于边界内多优先级更新与主 Fragment 返回路径交错，确认 state 更新不被丢弃。
   * When：启动低优先级渲染，再以更高优先级工作或 ping 打断。
   * Then：边界内多优先级更新与主 Fragment 返回路径交错，确认 state 更新不被丢弃。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache
  it(
    'multiple updates originating inside a Suspense boundary at different ' +
      'priority levels are not dropped',
    async () => {
      const {useState} = React;
      const root = ReactNoop.createRoot();

      /** Parent 作为层级 fixture 暴露 unwind、兄弟遍历或边界传播顺序，服务于“边界内多优先级更新与主 Fragment 返回路径交错，确认 state 更新不被丢弃”场景。 */
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
      /** Child 作为层级 fixture 暴露 unwind、兄弟遍历或边界传播顺序，服务于“边界内多优先级更新与主 Fragment 返回路径交错，确认 state 更新不被丢弃”场景。 */
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
        // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
        ReactNoop.discreteUpdates(() => {
          setText('B');
        });
        startTransition(() => {
          setText('C');
        });
        // 低优先级检查点。
        assertLog([]);

        // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
        await resolveText('C');
      });
      assertLog([
        // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
        'Suspend! [B]',
        'Loading...',
        // 低优先级检查点。
        'C',
      ]);
      expect(root).toMatchRenderedOutput(<span prop="C" />);
    },
  );

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于主树高优先级更新挂起后让 fallback 自更新，确认回退子树仍可调度。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：主树高优先级更新挂起后让 fallback 自更新，确认回退子树仍可调度。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()`、`mountSuspenseFallbackChildren()` 与 `renderDidSuspendDelayIfPossible()`。
   */
  // @gate enableLegacyCache
  it(
    'fallback component can update itself even after a high pri update to ' +
      'the primary tree suspends',
    async () => {
      const {useState} = React;
      const root = ReactNoop.createRoot();

      let setAppText;
      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“主树高优先级更新挂起后让 fallback 自更新，确认回退子树仍可调度”场景。 */
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

      // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
      await seedNextTextCache('A');
      await act(() => {
        root.render(<App />);
      });
      assertLog(['A']);
      expect(root).toMatchRenderedOutput(<span prop="A" />);

      await act(async () => {
        // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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
        // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
        'Suspend! [C]',
        'Loading...',

        // expiration-times 模型无法确认低优先级工作能否解除阻塞；fallback 更新说明可能存在，所以额外尝试一次。
        // TODO：lanes 模型可精确知道每棵树的待处理 lanes，理论上不应需要这次额外尝试。
        'Suspend! [C]',

        // 检查当前时刻应显示或保留的 fallback，避免主内容与占位错误切换。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于边界内多优先级更新与主 Fragment 返回路径交错，确认 state 更新不被丢弃。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：边界内多优先级更新与主 Fragment 返回路径交错，确认 state 更新不被丢弃。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache
  it(
    'regression: primary fragment fiber is not always part of setState ' +
      'return path',
    async () => {
      // 该回归关注 primary Fragment Fiber 是否进入 setState 的 return path。
      const {useState} = React;
      const root = ReactNoop.createRoot();

      /** Parent 作为层级 fixture 暴露 unwind、兄弟遍历或边界传播顺序，服务于“边界内多优先级更新与主 Fragment 返回路径交错，确认 state 更新不被丢弃”场景。 */
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
      /** Child 作为层级 fixture 暴露 unwind、兄弟遍历或边界传播顺序，服务于“边界内多优先级更新与主 Fragment 返回路径交错，确认 state 更新不被丢弃”场景。 */
      function Child() {
        const [text, _setText] = useState('A');
        setText = _setText;
        return <AsyncText text={text} />;
      }

      // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
      await seedNextTextCache('A');
      await act(() => {
        root.render(<Parent />);
      });
      assertLog(['A']);
      // 该回归关注 primary Fragment Fiber 是否进入 setState 的 return path。
      expect(root).toMatchRenderedOutput(<span prop="A" />);

      // 安排目标状态更新，并检查它在挂起、重试和提交之间不会丢失。
      await resolveText('B');
      await act(() => {
        setText('B');
      });
      assertLog(['B']);
      // 该回归关注 primary Fragment Fiber 是否进入 setState 的 return path。
      expect(root).toMatchRenderedOutput(<span prop="B" />);

      // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
      await act(() => {
        setText('C');
      });
      assertLog(['Suspend! [C]', 'Loading...', 'Suspend! [C]']);

      // 该回归关注 primary Fragment Fiber 是否进入 setState 的 return path。
      await act(async () => {
        await advanceTimers(250);
      });
      // 该回归关注 primary Fragment Fiber 是否进入 setState 的 return path。
      expect(root).toMatchRenderedOutput(
        <>
          <span hidden={true} prop="B" />
          <span prop="Loading..." />
        </>,
      );

      // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
      await resolveText('D');
      await act(() => {
        setText('D');
      });
      // 该回归关注 primary Fragment Fiber 是否进入 setState 的 return path。
      assertLog(['D']);
      expect(root).toMatchRenderedOutput(<span prop="D" />);
    },
  );

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于边界内多优先级更新与主 Fragment 返回路径交错，确认 state 更新不被丢弃。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：边界内多优先级更新与主 Fragment 返回路径交错，确认 state 更新不被丢弃。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache
  it(
    'regression: primary fragment fiber is not always part of setState ' +
      'return path (another case)',
    async () => {
      // 该回归关注 primary Fragment Fiber 是否进入 setState 的 return path。
      const {useState} = React;
      const root = ReactNoop.createRoot();

      /** Parent 作为层级 fixture 暴露 unwind、兄弟遍历或边界传播顺序，服务于“边界内多优先级更新与主 Fragment 返回路径交错，确认 state 更新不被丢弃”场景。 */
      function Parent() {
        return (
          <Suspense fallback={<Text text="Loading..." />}>
            <Child />
          </Suspense>
        );
      }

      let setText;
      /** Child 作为层级 fixture 暴露 unwind、兄弟遍历或边界传播顺序，服务于“边界内多优先级更新与主 Fragment 返回路径交错，确认 state 更新不被丢弃”场景。 */
      function Child() {
        const [text, _setText] = useState('A');
        setText = _setText;
        return <AsyncText text={text} />;
      }

      // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
      await seedNextTextCache('A');
      await act(() => {
        root.render(<Parent />);
      });
      assertLog(['A']);
      // 该回归关注 primary Fragment Fiber 是否进入 setState 的 return path。
      expect(root).toMatchRenderedOutput(<span prop="A" />);

      // 安排目标状态更新，并检查它在挂起、重试和提交之间不会丢失。
      await resolveText('B');
      await act(() => {
        setText('B');
      });
      assertLog(['B']);
      // 该回归关注 primary Fragment Fiber 是否进入 setState 的 return path。
      expect(root).toMatchRenderedOutput(<span prop="B" />);

      // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
      await act(() => {
        setText('C');
      });
      assertLog([
        'Suspend! [C]',
        'Loading...',
        // 执行预热渲染，不把该遍结果作为最终提交。
        'Suspend! [C]',
      ]);

      // 该回归关注 primary Fragment Fiber 是否进入 setState 的 return path。
      await act(async () => {
        await advanceTimers(250);
      });
      // 该回归关注 primary Fragment Fiber 是否进入 setState 的 return path。
      expect(root).toMatchRenderedOutput(
        <>
          <span hidden={true} prop="B" />
          <span prop="Loading..." />
        </>,
      );

      await act(async () => {
        // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
        setText('D');

        // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
        await resolveText('E');
        ReactNoop.idleUpdates(() => {
          setText('E');
        });
      });
      // 该回归关注 primary Fragment Fiber 是否进入 setState 的 return path。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于fallback 已显示时部分主树更新完成，确认挂起更新结束前不提前切回主内容。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：fallback 已显示时部分主树更新完成，确认挂起更新结束前不提前切回主内容。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()`、`mountSuspenseFallbackChildren()` 与 `renderDidSuspendDelayIfPossible()`。
   */
  // @gate enableLegacyCache
  it(
    'after showing fallback, should not flip back to primary content until ' +
      'the update that suspended finishes',
    async () => {
      const {useState, useEffect} = React;
      const root = ReactNoop.createRoot();

      let setOuterText;
      /** Parent 作为层级 fixture 暴露 unwind、兄弟遍历或边界传播顺序，服务于“fallback 已显示时部分主树更新完成，确认挂起更新结束前不提前切回主内容”场景。 */
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
      /** Child 作为层级 fixture 暴露 unwind、兄弟遍历或边界传播顺序，服务于“fallback 已显示时部分主树更新完成，确认挂起更新结束前不提前切回主内容”场景。 */
      function Child({step, outerText}) {
        const [text, _setText] = useState('A');
        setInnerText = _setText;

        // 完成或检查本轮提交，区分已完成工作与仅渲染未提交的内容。
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

      // 安排目标状态更新，并检查它在挂起、重试和提交之间不会丢失。
      /** setText 驱动资源解决或优先级中断，是当前用例唯一关键触发入口。 */
      function setText(text) {
        setOuterText(text);
        setInnerText(text);
      }

      // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
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

      // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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
      // 检查当前时刻应显示或保留的 fallback，避免主内容与占位错误切换。
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

      // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
      await act(() => {
        ReactNoop.discreteUpdates(() => {
          root.render(<Parent step={1} />);
        });
      });

      // 检查当前时刻应显示或保留的 fallback，避免主内容与占位错误切换。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于不同优先级下已挂起边界被高优先级更新解除隐藏，确认可见性与队列一致。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：不同优先级下已挂起边界被高优先级更新解除隐藏，确认可见性与队列一致。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()` 与提交阶段 Offscreen/Effect 可见性处理。
   */
  // @gate enableLegacyCache
  it('a high pri update can unhide a boundary that suspended at a different level', async () => {
    const {useState, useEffect} = React;
    const root = ReactNoop.createRoot();

    let setOuterText;
    /** Parent 作为层级 fixture 暴露 unwind、兄弟遍历或边界传播顺序，服务于“不同优先级下已挂起边界被高优先级更新解除隐藏，确认可见性与队列一致”场景。 */
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
    /** Child 作为层级 fixture 暴露 unwind、兄弟遍历或边界传播顺序，服务于“不同优先级下已挂起边界被高优先级更新解除隐藏，确认可见性与队列一致”场景。 */
    function Child({step, outerText}) {
      const [text, _setText] = useState('A');
      setInnerText = _setText;

      // 完成或检查本轮提交，区分已完成工作与仅渲染未提交的内容。
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

    // 安排目标状态更新，并检查它在挂起、重试和提交之间不会丢失。
    /** setText 驱动资源解决或优先级中断，是当前用例唯一关键触发入口。 */
    function setText(text) {
      setOuterText(text);
      setInnerText(text);
    }

    // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
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

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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
    // 检查当前时刻应显示或保留的 fallback，避免主内容与占位错误切换。
    await advanceTimers(250);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="Outer: B0" />
        <span hidden={true} prop="Inner: A0" />
        <span prop="Loading..." />
      </>,
    );

    // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于边界内多优先级更新与主 Fragment 返回路径交错，确认 state 更新不被丢弃。
   * When：启动低优先级渲染，再以更高优先级工作或 ping 打断。
   * Then：边界内多优先级更新与主 Fragment 返回路径交错，确认 state 更新不被丢弃。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`attachPingListener()`、`pingSuspendedRoot()` 与 `retryTimedOutBoundary()`。
   */
  // @gate enableLegacyCache
  it('regression: ping at high priority causes update to be dropped', async () => {
    const {useState, useTransition} = React;

    let setTextA;
    /** A 作为“边界内多优先级更新与主 Fragment 返回路径交错，确认 state 更新不被丢弃”场景的测试 fixture，暴露对应渲染、资源或调度行为。 */
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
    /** B 作为“边界内多优先级更新与主 Fragment 返回路径交错，确认 state 更新不被丢弃”场景的测试 fixture，暴露对应渲染、资源或调度行为。 */
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

    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“边界内多优先级更新与主 Fragment 返回路径交错，确认 state 更新不被丢弃”场景。 */
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
      // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
      setTextA('A1');
      // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
      startTransitionFromB(() => {
        // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
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
  /**
   * Given：已构造边界树、资源状态和调度检查点，用于挂起重试包含渲染阶段更新，确认边界 pending 状态最终收敛。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：挂起重试包含渲染阶段更新，确认边界 pending 状态最终收敛。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache
  it('does not get stuck in pending state with render phase updates', async () => {
    let setTextWithShortTransition;
    let setTextWithLongTransition;

    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“挂起重试包含渲染阶段更新，确认边界 pending 状态最终收敛”场景。 */
    function App() {
      const [isPending1, startShortTransition] = React.useTransition();
      const [isPending2, startLongTransition] = React.useTransition();
      const isPending = isPending1 || isPending2;
      const [text, setText] = React.useState('');
      const [mirror, setMirror] = React.useState('');

      if (text !== mirror) {
        // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
        setMirror(text);
      }

      setTextWithShortTransition = value => {
        startShortTransition(() => {
          setText(value);
        });
      };
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

    /** Root 作为“挂起重试包含渲染阶段更新，确认边界 pending 状态最终收敛”场景的测试 fixture，暴露对应渲染、资源或调度行为。 */
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

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
    await act(async () => {
      setTextWithLongTransition('b');
      await waitForAll([
        // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
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

    // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
    await act(async () => {
      await resolveText('a');

      await waitForAll(['Suspend! [b]', 'Loading...']);
      expect(root).toMatchRenderedOutput(
        <>
          <span prop="Pending..." />
          <span prop="" />
        </>,
      );

      // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
      await act(async () => {
        await resolveText('b');
      });
      assertLog(['b']);
      // 安排目标状态更新，并检查它在挂起、重试和提交之间不会丢失。
      expect(root).toMatchRenderedOutput(<span prop="b" />);
    });
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于资源 ping 与普通更新同时到达，确认普通更新优先于 Suspense retry。
   * When：启动低优先级渲染，再以更高优先级工作或 ping 打断。
   * Then：资源 ping 与普通更新同时到达，确认普通更新优先于 Suspense retry。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache
  it('retries have lower priority than normal updates', async () => {
    const {useState} = React;

    let setText;
    /** UpdatingText 构造可挂起、可更新或高成本的内容行，并把执行进度写入调度日志。 */
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
      // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
      await resolveText('Async');
      // 安排目标状态更新，并检查它在挂起、重试和提交之间不会丢失。
      setText('B');

      // 安排目标状态更新，并检查它在挂起、重试和提交之间不会丢失。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于挂起或删除已挂载子树，确认既有 Effect 不丢失且真实删除执行清理。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：挂起或删除已挂载子树，确认既有 Effect 不丢失且真实删除执行清理。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()` 与提交阶段 Offscreen/Effect 可见性处理。
   */
  // @gate enableLegacyCache
  it('should fire effect clean-up when deleting suspended tree', async () => {
    const {useEffect} = React;

    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“挂起或删除已挂载子树，确认既有 Effect 不丢失且真实删除执行清理”场景。 */
    function App({show}) {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <Child />
          {show && <AsyncText text="Async" />}
        </Suspense>
      );
    }

    /** Child 作为层级 fixture 暴露 unwind、兄弟遍历或边界传播顺序，服务于“挂起或删除已挂载子树，确认既有 Effect 不丢失且真实删除执行清理”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于挂起或删除已挂载子树，确认既有 Effect 不丢失且真实删除执行清理。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：挂起或删除已挂载子树，确认既有 Effect 不丢失且真实删除执行清理。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()` 与提交阶段 Offscreen/Effect 可见性处理。
   */
  // @gate enableLegacyCache && !disableLegacyMode
  it('should fire effect clean-up when deleting suspended tree (legacy)', async () => {
    const {useEffect} = React;

    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“挂起或删除已挂载子树，确认既有 Effect 不丢失且真实删除执行清理”场景。 */
    function App({show}) {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <Child />
          {show && <AsyncText text="Async" />}
        </Suspense>
      );
    }

    /** Child 作为层级 fixture 暴露 unwind、兄弟遍历或边界传播顺序，服务于“挂起或删除已挂载子树，确认既有 Effect 不丢失且真实删除执行清理”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于同步或 legacy 更新在边界内外挂起，确认对应同步 fallback 或缺少边界错误语义。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：同步或 legacy 更新在边界内外挂起，确认对应同步 fallback 或缺少边界错误语义。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`attachPingListener()`、`pingSuspendedRoot()` 与 `retryTimedOutBoundary()`。
   */
  // @gate enableLegacyCache
  it(
    'regression test: pinging synchronously within the render phase ' +
      'does not unwind the stack',
    async () => {
      // 回归场景：复现历史缺陷并锁定修复后的 Suspense 调度或提交不变量。
      const thenable = {
        /** then 实现 thenable 订阅：pending 时登记 ping，已结束时用微任务通知；同一监听器不得同步重复执行。 */
        then(resolve) {
          resolve('B');
        },
        status: 'pending',
      };

      /** ImmediatelyPings 作为“同步或 legacy 更新在边界内外挂起，确认对应同步 fallback 或缺少边界错误语义”场景的测试 fixture，暴露对应渲染、资源或调度行为。 */
      function ImmediatelyPings() {
        if (thenable.status === 'pending') {
          thenable.status = 'fulfilled';
          throw thenable;
        }
        return <Text text="B" />;
      }

      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“同步或 legacy 更新在边界内外挂起，确认对应同步 fallback 或缺少边界错误语义”场景。 */
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

      // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
      const root = ReactNoop.createRoot();
      await act(() => {
        root.render(<App showMore={false} />);
      });
      assertLog([]);
      expect(root).toMatchRenderedOutput(<div />);

      // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
      //
      // 回归场景：复现历史缺陷并锁定修复后的 Suspense 调度或提交不变量。
      //
      // 该回归防止同步 ping 错误调用 `prepareFreshStack` 并展开进行中的工作栈。
      await act(() => {
        startTransition(() => root.render(<App showMore={true} />));
      });
      assertLog([
        'Suspend! [A]',
        'Loading A...',
        'Loading B...',
        // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
        'Suspend! [A]',
        'Loading A...',
        'B',
      ]);
      expect(root).toMatchRenderedOutput(<div />);
    },
  );

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于兄弟节点持续更新时主树含昂贵内容，确认 retry 不被饥饿且最终提交。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：兄弟节点持续更新时主树含昂贵内容，确认 retry 不被饥饿且最终提交。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate enableLegacyCache && enableRetryLaneExpiration
  it('recurring updates in siblings should not block expensive content in suspense boundary from committing', async () => {
    const {useState} = React;

    let setText;
    /** UpdatingText 构造可挂起、可更新或高成本的内容行，并把执行进度写入调度日志。 */
    function UpdatingText() {
      const [text, _setText] = useState('1');
      setText = _setText;
      return <Text text={text} />;
    }

    /** ExpensiveText 构造可挂起、可更新或高成本的内容行，并把执行进度写入调度日志。 */
    function ExpensiveText({text, ms}) {
      Scheduler.log(text);
      Scheduler.unstable_advanceTime(ms);
      return <span prop={text} />;
    }

    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“兄弟节点持续更新时主树含昂贵内容，确认 retry 不被饥饿且最终提交”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于资源解决并提交主树后再次更新，确认边界仍可正常重渲染。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：资源解决并提交主树后再次更新，确认边界仍可正常重渲染。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`attachPingListener()`、`pingSuspendedRoot()` 与 `retryTimedOutBoundary()`。
   */
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
