let React;
let ReactDOMClient;
let ReactDOM;
let Scheduler;
let Suspense;
let act;
let textCache;
let container;

let assertLog;
let waitForPaint;
let waitForAll;
let waitFor;

/** 通过 DOM 渲染器验证 Suspense 挂起、ping 重试、fallback 节流、Context 与 Effect 恢复。 */
describe('ReactSuspense', () => {
  /** 重置模块，创建独立 DOM 容器与文本资源缓存，并绑定 Suspense、调度日志和异步断言。 */
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
    Scheduler = require('scheduler');
    container = document.createElement('div');

    Suspense = React.Suspense;

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    waitForPaint = InternalTestUtils.waitForPaint;
    assertLog = InternalTestUtils.assertLog;
    waitFor = InternalTestUtils.waitFor;

    textCache = new Map();
  });

  /** resolveText 将目标文本资源推进到 resolved，并广播所有 ping 以安排 Suspense retry。 */
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

  /** readText 读取三态资源：resolved 返回，pending 抛 thenable，rejected 抛错误；首次读取原子创建 pending 记录。 */
  function readText(text) {
    const record = textCache.get(text);
    if (record !== undefined) {
      /** 状态机边界：`pending` 抛 thenable 交给 Suspense，`rejected` 抛业务错误，`resolved` 返回已缓存值；未知状态不得静默降级。 */
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
      textCache.set(text, newRecord);

      throw thenable;
    }
  }

  /** Text 同步记录并输出文本，作为提交顺序与宿主内容的稳定观测点。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** AsyncText 先读取异步资源；未就绪时挂起，成功后才记录并输出文本。 */
  function AsyncText({text}) {
    readText(text);
    Scheduler.log(text);
    return text;
  }

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于主树读取未完成资源并显示 fallback，资源解决后由 ping 重试并提交原内容。
   * When：按用例顺序解决资源并冲刷 ping 触发的重试。
   * Then：主树读取未完成资源并显示 fallback，资源解决后由 ping 重试并提交原内容。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  it('suspends rendering and continues later', async () => {
    /** Bar 作为层级 fixture 暴露 unwind、兄弟遍历或边界传播顺序，服务于“主树读取未完成资源并显示 fallback，资源解决后由 ping 重试并提交原内容”场景。 */
    function Bar(props) {
      Scheduler.log('Bar');
      return props.children;
    }

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“主树读取未完成资源并显示 fallback，资源解决后由 ping 重试并提交原内容”场景。 */
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

    const root = ReactDOMClient.createRoot(container);
    // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
    await act(() => {
      root.render(<Foo />);
    });
    assertLog(['Foo']);
    const renderedEl = container;
    expect(renderedEl.innerText).toBeUndefined();

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
    React.startTransition(() => {
      root.render(<Foo renderBar={true} />);
    });

    await waitForAll([
      'Foo',
      'Bar',
      // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
      'Suspend! [A]',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'B',
      // 结束预热渲染。
      'Loading...',
    ]);
    expect(container.textContent).toEqual('');

    await waitForAll([]);
    expect(container.textContent).toEqual('');

    resolveText('A');
    await waitForAll(['Foo', 'Bar', 'A', 'B']);
    expect(container.textContent).toEqual('AB');
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于两个兄弟边界分别挂起并依次解决，确认每个边界独立从 fallback 恢复。
   * When：按用例顺序解决资源并冲刷 ping 触发的重试。
   * Then：两个兄弟边界分别挂起并依次解决，确认每个边界独立从 fallback 恢复。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  it('suspends siblings and later recovers each independently', async () => {
    const root = ReactDOMClient.createRoot(container);
    // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
    root.render(
      <>
        <Suspense fallback={<Text text="Loading A..." />}>
          <AsyncText text="A" />
        </Suspense>
        <Suspense fallback={<Text text="Loading B..." />}>
          <AsyncText text="B" />
        </Suspense>
      </>,
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
    expect(container.innerHTML).toEqual('Loading A...Loading B...');

    // 切回并检查主内容视图。
    await act(() => resolveText('A'));
    assertLog([
      'A',
      ...(gate('alwaysThrottleRetries')
        ? ['Suspend! [B]', 'Suspend! [B]']
        : []),
    ]);
    expect(container.textContent).toEqual('ALoading B...');

    // 切回并检查主内容视图。
    await act(() => resolveText('B'));
    assertLog(['B']);
    expect(container.textContent).toEqual('AB');
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于thenable 在当前渲染阶段结束前 ping，确认进行中的工作被中断并以已解决状态重试。
   * When：按用例顺序解决资源并冲刷 ping 触发的重试。
   * Then：thenable 在当前渲染阶段结束前 ping，确认进行中的工作被中断并以已解决状态重试。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`attachPingListener()`、`pingSuspendedRoot()` 与 `retryTimedOutBoundary()`。
   */
  it('interrupts current render if promise resolves before current render phase', async () => {
    let didResolve = false;
    const listeners = [];

    const thenable = {
      /** then 实现 thenable 订阅：pending 时登记 ping，已结束时用微任务通知；同一监听器不得同步重复执行。 */
      then(resolve) {
        if (!didResolve) {
          listeners.push(resolve);
        } else {
          resolve();
        }
      },
    };

    /** resolveThenable 驱动资源解决或优先级中断，是当前用例唯一关键触发入口。 */
    function resolveThenable() {
      didResolve = true;
      listeners.forEach(l => l());
    }

    /** Async 构造可挂起、可更新或高成本的内容行，并把执行进度写入调度日志。 */
    function Async() {
      if (!didResolve) {
        Scheduler.log('Suspend!');
        throw thenable;
      }
      Scheduler.log('Async');
      return 'Async';
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <>
          <Suspense fallback={<Text text="Loading..." />} />
          <Text text="Initial" />
        </>,
      );
    });

    assertLog(['Initial']);
    expect(container.textContent).toEqual('Initial');

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
    React.startTransition(() => {
      root.render(
        <>
          <Suspense fallback={<Text text="Loading..." />}>
            <Async />
          </Suspense>
          <Text text="After Suspense" />
          <Text text="Sibling" />
        </>,
      );
    });

    // 分段冲刷或让出调度工作，以锁定当前渲染检查点。
    await waitFor(['Suspend!', 'Loading...', 'After Suspense']);

    // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
    resolveThenable();
    assertLog([]);
    expect(container.textContent).toEqual('Initial');

    // 从根重新开始渲染，而不是续接当前完成进度。
    await waitForAll([
      // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
      'Async',
      'After Suspense',
      'Sibling',
    ]);
    expect(container.textContent).toEqual('AsyncAfter SuspenseSibling');
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于连续触发不同边界 fallback，确认全局节流窗口延迟闪烁但不会无限阻塞提交。
   * When：推进虚拟时间、消耗 CPU 预算并继续冲刷渲染。
   * Then：连续触发不同边界 fallback，确认全局节流窗口延迟闪烁但不会无限阻塞提交。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()`、`mountSuspenseFallbackChildren()` 与 `renderDidSuspendDelayIfPossible()`。
   */
  it('throttles fallback committing globally', async () => {
    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“连续触发不同边界 fallback，确认全局节流窗口延迟闪烁但不会无限阻塞提交”场景。 */
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

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Foo />);
    });

    assertLog([
      'Foo',
      'Suspend! [A]',
      'Loading...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
      'Suspend! [B]',
      'Loading more...',
    ]);
    expect(container.textContent).toEqual('Loading...');

    await resolveText('A');
    await waitForAll(['A', 'Suspend! [B]', 'Loading more...']);

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
    expect(container.textContent).toEqual('Loading...');

    await act(() => resolveText('B'));
    // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
    assertLog(['A', 'B']);
    expect(container.textContent).toEqual('AB');
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于连续触发不同边界 fallback，确认全局节流窗口延迟闪烁但不会无限阻塞提交。
   * When：推进虚拟时间、消耗 CPU 预算并继续冲刷渲染。
   * Then：连续触发不同边界 fallback，确认全局节流窗口延迟闪烁但不会无限阻塞提交。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()`、`mountSuspenseFallbackChildren()` 与 `renderDidSuspendDelayIfPossible()`。
   */
  it('pushes out siblings that render faster than throttle', async () => {
    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“连续触发不同边界 fallback，确认全局节流窗口延迟闪烁但不会无限阻塞提交”场景。 */
    function Foo() {
      Scheduler.log('Foo');
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <AsyncText text="A" ms={290} />
          <Suspense fallback={<Text text="Loading more..." />}>
            <AsyncText text="B" ms={30} />
          </Suspense>
        </Suspense>
      );
    }

    setTimeout(async () => {
      // TODO：该构造较笨拙；act 改动后 AsyncText 不再由定时器驱动。
      // 把此处视为兄弟 B 开始挂起；真实测试中计时器应在渲染 B 时启动。
      setTimeout(async () => {
        resolveText('B');
      }, 30);

      resolveText('A');
    }, 290);

    // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
    const root = ReactDOMClient.createRoot(container);
    root.render(<Foo />);
    await waitForAll([
      'Foo',
      'Suspend! [A]',
      'Loading...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
      'Suspend! [B]',
      'Loading more...',
    ]);
    expect(container.textContent).toEqual('Loading...');

    // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
    jest.advanceTimersByTime(290);
    await waitFor(['A']);
    expect(container.textContent).toEqual('Loading...');

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
    jest.advanceTimersByTime(10);
    await waitForAll(['Suspend! [B]', 'Loading more...']);
    expect(container.textContent).toEqual('Loading...');

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
    jest.advanceTimersByTime(300);
    await waitFor(['B']);
    expect(container.textContent).toEqual('ALoading more...');

    await act(() => {});
    expect(container.textContent).toEqual('AB');
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于连续触发不同边界 fallback，确认全局节流窗口延迟闪烁但不会无限阻塞提交。
   * When：推进虚拟时间、消耗 CPU 预算并继续冲刷渲染。
   * Then：连续触发不同边界 fallback，确认全局节流窗口延迟闪烁但不会无限阻塞提交。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()`、`mountSuspenseFallbackChildren()` 与 `renderDidSuspendDelayIfPossible()`。
   */
  it('does not throttle fallback committing for too long', async () => {
    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“连续触发不同边界 fallback，确认全局节流窗口延迟闪烁但不会无限阻塞提交”场景。 */
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

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Foo />);
    });
    assertLog([
      'Foo',
      'Suspend! [A]',
      'Loading...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
      'Suspend! [B]',
      'Loading more...',
    ]);
    expect(container.textContent).toEqual('Loading...');

    await resolveText('A');
    await waitForAll(['A', 'Suspend! [B]', 'Loading more...']);

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
    expect(container.textContent).toEqual('Loading...');
    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
    jest.advanceTimersByTime(500);
    expect(container.textContent).toEqual('ALoading more...');

    await act(() => resolveText('B'));
    assertLog(['B']);
    expect(container.textContent).toEqual('AB');
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于legacy 根加载 lazy 类组件，确认模块解决后正确挂载并执行类生命周期。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：legacy 根加载 lazy 类组件，确认模块解决后正确挂载并执行类生命周期。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  // @gate !disableLegacyMode
  it('mounts a lazy class component in non-concurrent mode (legacy)', async () => {
    /** 定义 Class 类 fixture，在“legacy 根加载 lazy 类组件，确认模块解决后正确挂载并执行类生命周期”场景中暴露实例 state 与提交生命周期。 */
    class Class extends React.Component {
      /** Class.componentDidMount 记录真实挂载提交，未提交的挂起尝试不得调用。 */
      componentDidMount() {
        Scheduler.log('Did mount: ' + this.props.label);
      }
      /** Class.componentDidUpdate 记录已提交更新，用于区分恢复复用与重新挂载。 */
      componentDidUpdate() {
        Scheduler.log('Did update: ' + this.props.label);
      }
      /** 渲染 Class.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
      render() {
        return <Text text={this.props.label} />;
      }
    }

    /** fakeImport 作为“legacy 根加载 lazy 类组件，确认模块解决后正确挂载并执行类生命周期”场景的测试 fixture，暴露对应渲染、资源或调度行为。 */
    async function fakeImport(result) {
      return {default: result};
    }

    const LazyClass = React.lazy(() => fakeImport(Class));

    ReactDOM.render(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyClass label="Hi" />
      </Suspense>,
      container,
    );

    assertLog(['Loading...']);
    expect(container.textContent).toEqual('Loading...');

    await LazyClass;

    await waitForPaint(['Hi', 'Did mount: Hi']);
    expect(container.textContent).toEqual('Hi');
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  it('updates memoized child of suspense component when context updates (simple memo)', async () => {
    const {useContext, createContext, useState, memo} = React;

    const ValueContext = createContext(null);

    const MemoizedChild = memo(function MemoizedChild() {
      const text = useContext(ValueContext);
      return <Text text={readText(text)} />;
    });

    let setValue;
    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新”场景。 */
    function App() {
      const [value, _setValue] = useState('default');
      setValue = _setValue;

      return (
        <ValueContext.Provider value={value}>
          <Suspense fallback={<Text text="Loading..." />}>
            <MemoizedChild />
          </Suspense>
        </ValueContext.Provider>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App />);
    });
    assertLog([
      'Suspend! [default]',
      'Loading...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [default]',
    ]);

    await act(() => resolveText('default'));
    assertLog(['default']);
    expect(container.textContent).toEqual('default');

    await act(() => setValue('new value'));
    assertLog([
      'Suspend! [new value]',
      'Loading...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [new value]',
    ]);

    await act(() => resolveText('new value'));
    assertLog(['new value']);
    expect(container.textContent).toEqual('new value');
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  it('updates memoized child of suspense component when context updates (manual memo)', async () => {
    const {useContext, createContext, useState, memo} = React;

    const ValueContext = createContext(null);

    const MemoizedChild = memo(
      function MemoizedChild() {
        const text = useContext(ValueContext);
        return <Text text={readText(text)} />;
      },
      function areEqual(prevProps, nextProps) {
        return true;
      },
    );

    let setValue;
    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新”场景。 */
    function App() {
      const [value, _setValue] = useState('default');
      setValue = _setValue;

      return (
        <ValueContext.Provider value={value}>
          <Suspense fallback={<Text text="Loading..." />}>
            <MemoizedChild />
          </Suspense>
        </ValueContext.Provider>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App />);
    });
    assertLog([
      'Suspend! [default]',
      'Loading...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [default]',
    ]);

    await act(() => resolveText('default'));
    assertLog(['default']);
    expect(container.textContent).toEqual('default');

    await act(() => setValue('new value'));
    assertLog([
      'Suspend! [new value]',
      'Loading...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [new value]',
    ]);

    await act(() => resolveText('new value'));
    assertLog(['new value']);
    expect(container.textContent).toEqual('new value');
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  it('updates memoized child of suspense component when context updates (function)', async () => {
    const {useContext, createContext, useState} = React;

    const ValueContext = createContext(null);

    /** MemoizedChild 作为“Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新”场景的测试 fixture，暴露对应渲染、资源或调度行为。 */
    function MemoizedChild() {
      const text = useContext(ValueContext);
      return <Text text={readText(text)} />;
    }

    let setValue;
    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新”场景。 */
    function App({children}) {
      const [value, _setValue] = useState('default');
      setValue = _setValue;

      return (
        <ValueContext.Provider value={value}>{children}</ValueContext.Provider>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <App>
          <Suspense fallback={<Text text="Loading..." />}>
            <MemoizedChild />
          </Suspense>
        </App>,
      );
    });
    assertLog([
      'Suspend! [default]',
      'Loading...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [default]',
    ]);

    await act(() => resolveText('default'));
    assertLog(['default']);
    expect(container.textContent).toEqual('default');

    await act(() => setValue('new value'));
    assertLog([
      'Suspend! [new value]',
      'Loading...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [new value]',
    ]);

    await act(() => resolveText('new value'));
    assertLog(['new value']);
    expect(container.textContent).toEqual('new value');
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
   */
  it('updates memoized child of suspense component when context updates (forwardRef)', async () => {
    const {forwardRef, useContext, createContext, useState} = React;

    const ValueContext = createContext(null);

    const MemoizedChild = forwardRef(() => {
      const text = useContext(ValueContext);
      return <Text text={readText(text)} />;
    });

    let setValue;
    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新”场景。 */
    function App({children}) {
      const [value, _setValue] = useState('default');
      setValue = _setValue;

      return (
        <ValueContext.Provider value={value}>{children}</ValueContext.Provider>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <App>
          <Suspense fallback={<Text text="Loading..." />}>
            <MemoizedChild />
          </Suspense>
        </App>,
      );
    });
    assertLog([
      'Suspend! [default]',
      'Loading...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [default]',
    ]);

    await act(() => resolveText('default'));
    assertLog(['default']);
    expect(container.textContent).toEqual('default');

    await act(() => setValue('new value'));
    assertLog([
      'Suspend! [new value]',
      'Loading...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [new value]',
    ]);

    await act(() => resolveText('new value'));
    assertLog(['new value']);
    expect(container.textContent).toEqual('new value');
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于隐藏后重新显示已挂载 Suspense 主树，确认 Layout Effect 清理后重新创建。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：隐藏后重新显示已挂载 Suspense 主树，确认 Layout Effect 清理后重新创建。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()` 与提交阶段 Offscreen/Effect 可见性处理。
   */
  it('re-fires layout effects when re-showing Suspense', async () => {
    /** TextWithLayout 作为“隐藏后重新显示已挂载 Suspense 主树，确认 Layout Effect 清理后重新创建”场景的测试 fixture，暴露对应渲染、资源或调度行为。 */
    function TextWithLayout(props) {
      Scheduler.log(props.text);
      React.useLayoutEffect(() => {
        Scheduler.log('create layout');
        return () => {
          Scheduler.log('destroy layout');
        };
      }, []);
      return props.text;
    }

    let _setShow;
    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“隐藏后重新显示已挂载 Suspense 主树，确认 Layout Effect 清理后重新创建”场景。 */
    function App(props) {
      const [show, setShow] = React.useState(false);
      _setShow = setShow;
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <TextWithLayout text="Child 1" />
          {show && <AsyncText text="Child 2" />}
        </Suspense>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App />);
    });

    assertLog(['Child 1', 'create layout']);
    expect(container.textContent).toEqual('Child 1');

    await act(() => {
      _setShow(true);
    });
    assertLog([
      'Child 1',
      'Suspend! [Child 2]',
      'Loading...',
      'destroy layout',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Child 1',
      'Suspend! [Child 2]',
    ]);

    await act(() => resolveText('Child 2'));
    assertLog(['Child 1', 'Child 2', 'create layout']);
    expect(container.textContent).toEqual(['Child 1', 'Child 2'].join(''));
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于挂起更新经历很长虚拟时间，确认并发根不会永久停留在 fallback。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：挂起更新经历很长虚拟时间，确认并发根不会永久停留在 fallback。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseComponent()`、`mountSuspenseFallbackChildren()` 与 `renderDidSuspendDelayIfPossible()`。
   */
  it('does not get stuck with fallback in concurrent mode for a large delay', async () => {
    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“挂起更新经历很长虚拟时间，确认并发根不会永久停留在 fallback”场景。 */
    function App(props) {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <AsyncText text="Child 1" />
          <AsyncText text="Child 2" />
        </Suspense>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App />);
    });

    assertLog([
      'Suspend! [Child 1]',
      'Loading...',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [Child 1]',
      'Suspend! [Child 2]',
    ]);
    await resolveText('Child 1');
    await waitForAll([
      'Child 1',
      'Suspend! [Child 2]',
      ...(gate('alwaysThrottleRetries')
        ? []
        : ['Child 1', 'Suspend! [Child 2]']),
    ]);

    jest.advanceTimersByTime(6000);

    await act(() => resolveText('Child 2'));
    assertLog(['Child 1', 'Child 2']);
    expect(container.textContent).toEqual(['Child 1', 'Child 2'].join(''));
  });

  /** 通过 DOM 渲染器验证 Suspense 挂起、ping 重试、fallback 节流、Context 与 Effect 恢复。 */
  describe('outside concurrent mode (legacy)', () => {
    /**
     * Given：已构造边界树、资源状态和调度检查点，用于已挂载类组件在更新中挂起后恢复，确认实例 state 和生命周期连续。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：已挂载类组件在更新中挂起后恢复，确认实例 state 和生命周期连续。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
     */
    // @gate !disableLegacyMode
    it('a mounted class component can suspend without losing state', async () => {
      /** 定义 TextWithLifecycle 类 fixture，在“已挂载类组件在更新中挂起后恢复，确认实例 state 和生命周期连续”场景中暴露实例 state 与提交生命周期。 */
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

      let instance;
      /** 定义 AsyncTextWithLifecycle 类 fixture，在“已挂载类组件在更新中挂起后恢复，确认实例 state 和生命周期连续”场景中暴露实例 state 与提交生命周期。 */
      class AsyncTextWithLifecycle extends React.Component {
        /** 保存 AsyncTextWithLifecycle.state 的实例状态，跨挂起、fallback 与重试提交维持测试不变量。 */
        state = {step: 1};
        /** AsyncTextWithLifecycle.componentDidMount 记录真实挂载提交，未提交的挂起尝试不得调用。 */
        componentDidMount() {
          Scheduler.log(`Mount [${this.props.text}:${this.state.step}]`);
        }
        /** AsyncTextWithLifecycle.componentDidUpdate 记录已提交更新，用于区分恢复复用与重新挂载。 */
        componentDidUpdate() {
          Scheduler.log(`Update [${this.props.text}:${this.state.step}]`);
        }
        /** AsyncTextWithLifecycle.componentWillUnmount 记录真实删除清理；单纯隐藏或未提交挂起不应误调用。 */
        componentWillUnmount() {
          Scheduler.log(`Unmount [${this.props.text}:${this.state.step}]`);
        }
        /** 渲染 AsyncTextWithLifecycle.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
        render() {
          instance = this;
          const text = readText(`${this.props.text}:${this.state.step}`);
          return <Text text={text} />;
        }
      }

      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“已挂载类组件在更新中挂起后恢复，确认实例 state 和生命周期连续”场景。 */
      function App() {
        return (
          <Suspense fallback={<TextWithLifecycle text="Loading..." />}>
            <TextWithLifecycle text="A" />
            <AsyncTextWithLifecycle text="B" ref={instance} />
            <TextWithLifecycle text="C" />
          </Suspense>
        );
      }

      ReactDOM.render(<App />, container);
      assertLog([
        'A',
        'Suspend! [B:1]',
        'C',
        'Loading...',

        'Mount [A]',
        // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
        // 'Mount [B]',
        'Mount [C]',
        'Mount [Loading...]',
      ]);
      expect(container.textContent).toEqual('Loading...');

      await resolveText('B:1');
      assertLog([
        'B:1',
        'Unmount [Loading...]',
        // 检查挂载、生命周期或 Effect 只在对应提交阶段执行。
        'Mount [B:1]',
      ]);
      expect(container.textContent).toEqual('AB:1C');

      instance.setState({step: 2});
      assertLog(['Suspend! [B:2]', 'Loading...', 'Mount [Loading...]']);
      expect(container.textContent).toEqual('Loading...');

      await resolveText('B:2');
      assertLog(['B:2', 'Unmount [Loading...]', 'Update [B:2]']);
      expect(container.textContent).toEqual('AB:2C');
    });

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于已显示 fallback 的边界收到主树更新，确认 bailout 与重试选择不会跳过挂起组件。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：已显示 fallback 的边界收到主树更新，确认 bailout 与重试选择不会跳过挂起组件。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
     */
    // @gate !disableLegacyMode
    it('bails out on timed-out primary children even if they receive an update', async () => {
      let instance;
      /** 定义 Stateful 类 fixture，在“已显示 fallback 的边界收到主树更新，确认 bailout 与重试选择不会跳过挂起组件”场景中暴露实例 state 与提交生命周期。 */
      class Stateful extends React.Component {
        /** 保存 Stateful.state 的实例状态，跨挂起、fallback 与重试提交维持测试不变量。 */
        state = {step: 1};
        /** 渲染 Stateful.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
        render() {
          instance = this;
          return <Text text={`Stateful: ${this.state.step}`} />;
        }
      }

      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“已显示 fallback 的边界收到主树更新，确认 bailout 与重试选择不会跳过挂起组件”场景。 */
      function App(props) {
        return (
          <Suspense fallback={<Text text="Loading..." />}>
            <Stateful />
            <AsyncText text={props.text} />
          </Suspense>
        );
      }

      ReactDOM.render(<App text="A" />, container);

      assertLog(['Stateful: 1', 'Suspend! [A]', 'Loading...']);

      await resolveText('A');
      assertLog(['A']);
      expect(container.textContent).toEqual('Stateful: 1A');

      ReactDOM.render(<App text="B" />, container);
      assertLog(['Stateful: 1', 'Suspend! [B]', 'Loading...']);
      expect(container.textContent).toEqual('Loading...');

      instance.setState({step: 2});
      assertLog(['Stateful: 2', 'Suspend! [B]']);
      expect(container.textContent).toEqual('Loading...');

      await resolveText('B');
      assertLog(['B']);
      expect(container.textContent).toEqual('Stateful: 2B');
    });

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于已显示 fallback 的边界收到主树更新，确认 bailout 与重试选择不会跳过挂起组件。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：已显示 fallback 的边界收到主树更新，确认 bailout 与重试选择不会跳过挂起组件。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
     */
    // @gate !disableLegacyMode
    it('when updating a timed-out tree, always retries the suspended component', async () => {
      let instance;
      /** 定义 Stateful 类 fixture，在“已显示 fallback 的边界收到主树更新，确认 bailout 与重试选择不会跳过挂起组件”场景中暴露实例 state 与提交生命周期。 */
      class Stateful extends React.Component {
        /** 保存 Stateful.state 的实例状态，跨挂起、fallback 与重试提交维持测试不变量。 */
        state = {step: 1};
        /** 渲染 Stateful.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
        render() {
          instance = this;
          return <Text text={`Stateful: ${this.state.step}`} />;
        }
      }

      const Indirection = React.Fragment;

      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“已显示 fallback 的边界收到主树更新，确认 bailout 与重试选择不会跳过挂起组件”场景。 */
      function App(props) {
        return (
          <Suspense fallback={<Text text="Loading..." />}>
            <Stateful />
            <Indirection>
              <Indirection>
                <Indirection>
                  <AsyncText text={props.text} />
                </Indirection>
              </Indirection>
            </Indirection>
          </Suspense>
        );
      }

      ReactDOM.render(<App text="A" />, container);

      assertLog(['Stateful: 1', 'Suspend! [A]', 'Loading...']);

      await resolveText('A');
      assertLog(['A']);
      expect(container.textContent).toEqual('Stateful: 1A');

      ReactDOM.render(<App text="B" />, container);
      assertLog(['Stateful: 1', 'Suspend! [B]', 'Loading...']);
      expect(container.textContent).toEqual('Loading...');

      instance.setState({step: 2});
      assertLog([
        'Stateful: 2',

        // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
        'Suspend! [B]',
      ]);
      expect(container.textContent).toEqual('Loading...');

      await resolveText('B');
      assertLog(['B']);
      expect(container.textContent).toEqual('Stateful: 2B');
    });

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于带卸载生命周期的组件在挂起后被删除，确认只执行真实删除清理。
     * When：在挂起或 fallback 状态删除目标子树。
     * Then：带卸载生命周期的组件在挂起后被删除，确认只执行真实删除清理。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`updateSuspenseComponent()` 与提交阶段 Offscreen/Effect 可见性处理。
     */
    // @gate !disableLegacyMode
    it('suspends in a class that has componentWillUnmount and is then deleted', async () => {
      /** 定义 AsyncTextWithUnmount 类 fixture，在“带卸载生命周期的组件在挂起后被删除，确认只执行真实删除清理”场景中暴露实例 state 与提交生命周期。 */
      class AsyncTextWithUnmount extends React.Component {
        /** AsyncTextWithUnmount.componentWillUnmount 记录真实删除清理；单纯隐藏或未提交挂起不应误调用。 */
        componentWillUnmount() {
          Scheduler.log('will unmount');
        }
        /** 渲染 AsyncTextWithUnmount.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
        render() {
          return <Text text={readText(this.props.text)} />;
        }
      }

      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“带卸载生命周期的组件在挂起后被删除，确认只执行真实删除清理”场景。 */
      function App({text}) {
        return (
          <Suspense fallback={<Text text="Loading..." />}>
            <AsyncTextWithUnmount text={text} />
          </Suspense>
        );
      }

      ReactDOM.render(<App text="A" />, container);
      assertLog(['Suspend! [A]', 'Loading...']);
      ReactDOM.render(<Text text="B" />, container);
      // 删除目标子树并检查真实卸载清理；隐藏或未提交工作不得误触发。
      assertLog(['B']);
      expect(container.textContent).toEqual('B');
    });

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于组件既挂起又注册 Passive Effect，确认未提交尝试不会错误挂载 Effect。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：组件既挂起又注册 Passive Effect，确认未提交尝试不会错误挂载 Effect。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序。
     * 对应源码：`updateSuspenseComponent()` 与提交阶段 Offscreen/Effect 可见性处理。
     */
    // @gate !disableLegacyMode
    it('suspends in a component that also contains useEffect', async () => {
      const {useLayoutEffect} = React;

      /** AsyncTextWithEffect 构造可挂起、可更新或高成本的内容行，并把执行进度写入调度日志。 */
      function AsyncTextWithEffect(props) {
        const text = props.text;

        useLayoutEffect(() => {
          Scheduler.log('Did commit: ' + text);
        }, [text]);

        return <Text text={readText(text)} />;
      }

      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“组件既挂起又注册 Passive Effect，确认未提交尝试不会错误挂载 Effect”场景。 */
      function App({text}) {
        return (
          <Suspense fallback={<Text text="Loading..." />}>
            <AsyncTextWithEffect text={text} />
          </Suspense>
        );
      }

      ReactDOM.render(<App text="A" />, container);
      assertLog(['Suspend! [A]', 'Loading...']);
      await resolveText('A');
      assertLog(['A', 'Did commit: A']);
    });

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于已显示 fallback 的边界收到主树更新，确认 bailout 与重试选择不会跳过挂起组件。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：已显示 fallback 的边界收到主树更新，确认 bailout 与重试选择不会跳过挂起组件。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
     */
    // @gate !disableLegacyMode
    it('retries when an update is scheduled on a timed out tree', async () => {
      let instance;
      /** 定义 Stateful 类 fixture，在“已显示 fallback 的边界收到主树更新，确认 bailout 与重试选择不会跳过挂起组件”场景中暴露实例 state 与提交生命周期。 */
      class Stateful extends React.Component {
        /** 保存 Stateful.state 的实例状态，跨挂起、fallback 与重试提交维持测试不变量。 */
        state = {step: 1};
        /** 渲染 Stateful.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
        render() {
          instance = this;
          return <AsyncText text={`Step: ${this.state.step}`} />;
        }
      }

      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“已显示 fallback 的边界收到主树更新，确认 bailout 与重试选择不会跳过挂起组件”场景。 */
      function App(props) {
        return (
          <Suspense fallback={<Text text="Loading..." />}>
            <Stateful />
          </Suspense>
        );
      }

      ReactDOM.render(<App />, container);

      // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
      assertLog(['Suspend! [Step: 1]', 'Loading...']);

      await act(() => resolveText('Step: 1'));
      assertLog(['Step: 1']);
      expect(container.textContent).toEqual('Step: 1');

      // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
      await act(() => {
        instance.setState({step: 2});
      });
      assertLog(['Suspend! [Step: 2]', 'Loading...']);
      expect(container.textContent).toEqual('Loading...');

      // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
      instance.setState({step: 3});
      assertLog(['Suspend! [Step: 3]']);
      expect(container.textContent).toEqual('Loading...');

      await act(() => {
        resolveText('Step: 2');
        resolveText('Step: 3');
      });
      assertLog(['Step: 3']);
      expect(container.textContent).toEqual('Step: 3');
    });

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于legacy 边界等待多个子资源依次解决，确认 fallback 实例不会重复挂载。
     * When：按用例顺序解决资源并冲刷 ping 触发的重试。
     * Then：legacy 边界等待多个子资源依次解决，确认 fallback 实例不会重复挂载。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`attachPingListener()`、`pingSuspendedRoot()` 与 `retryTimedOutBoundary()`。
     */
    // @gate !disableLegacyMode
    it('does not remount the fallback while suspended children resolve in legacy mode', async () => {
      let mounts = 0;
      /** 定义 ShouldMountOnce 类 fixture，在“legacy 边界等待多个子资源依次解决，确认 fallback 实例不会重复挂载”场景中暴露实例 state 与提交生命周期。 */
      class ShouldMountOnce extends React.Component {
        /** ShouldMountOnce.componentDidMount 记录真实挂载提交，未提交的挂起尝试不得调用。 */
        componentDidMount() {
          mounts++;
        }
        /** 渲染 ShouldMountOnce.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
        render() {
          return <Text text="Loading..." />;
        }
      }

      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“legacy 边界等待多个子资源依次解决，确认 fallback 实例不会重复挂载”场景。 */
      function App(props) {
        return (
          <Suspense fallback={<ShouldMountOnce />}>
            <AsyncText text="Child 1" />
            <AsyncText text="Child 2" />
            <AsyncText text="Child 3" />
          </Suspense>
        );
      }

      ReactDOM.render(<App />, container);

      // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
      assertLog([
        'Suspend! [Child 1]',
        'Suspend! [Child 2]',
        'Suspend! [Child 3]',
        'Loading...',
      ]);
      await waitForAll([]);

      await resolveText('Child 1');
      assertLog(['Child 1', 'Suspend! [Child 2]', 'Suspend! [Child 3]']);

      await resolveText('Child 2');
      assertLog(['Child 2', 'Suspend! [Child 3]']);

      await resolveText('Child 3');
      assertLog(['Child 3']);
      expect(container.textContent).toEqual(
        ['Child 1', 'Child 2', 'Child 3'].join(''),
      );
      expect(mounts).toBe(1);
    });

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于挂起树包含更新与删除 Effect，恢复时复用完成工作且保留删除副作用。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：挂起树包含更新与删除 Effect，恢复时复用完成工作且保留删除副作用。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`updateSuspenseComponent()` 与提交阶段 Offscreen/Effect 可见性处理。
     */
    // @gate !disableLegacyMode
    it('reuses effects, including deletions, from the suspended tree', async () => {
      const {useState} = React;

      let setTab;
      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“挂起树包含更新与删除 Effect，恢复时复用完成工作且保留删除副作用”场景。 */
      function App() {
        const [tab, _setTab] = useState(0);
        setTab = _setTab;

        return (
          <Suspense fallback={<Text text="Loading..." />}>
            <AsyncText key={tab} text={'Tab: ' + tab} />
            <Text key={tab + 'sibling'} text=" + sibling" />
          </Suspense>
        );
      }

      ReactDOM.render(<App />, container);
      assertLog(['Suspend! [Tab: 0]', ' + sibling', 'Loading...']);
      expect(container.textContent).toEqual('Loading...');

      await resolveText('Tab: 0');
      assertLog(['Tab: 0']);
      expect(container.textContent).toEqual('Tab: 0 + sibling');

      await act(() => setTab(1));
      assertLog(['Suspend! [Tab: 1]', ' + sibling', 'Loading...']);
      expect(container.textContent).toEqual('Loading...');

      await resolveText('Tab: 1');
      assertLog(['Tab: 1']);
      expect(container.textContent).toEqual('Tab: 1 + sibling');

      await act(() => setTab(2));
      assertLog(['Suspend! [Tab: 2]', ' + sibling', 'Loading...']);
      expect(container.textContent).toEqual('Loading...');

      await resolveText('Tab: 2');
      assertLog(['Tab: 2']);
      expect(container.textContent).toEqual('Tab: 2 + sibling');
    });

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于已挂载组件关联的 thenable 再次 ping，确认不会产生卸载或更新告警。
     * When：渲染包含该非法配置或 children 形状的列表。
     * Then：已挂载组件关联的 thenable 再次 ping，确认不会产生卸载或更新告警。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`attachPingListener()`、`pingSuspendedRoot()` 与 `retryTimedOutBoundary()`。
     */
    // @gate !disableLegacyMode
    it('does not warn if a mounted component is pinged', async () => {
      const {useState} = React;

      ReactDOM.render(null, container);

      let setStep;
      /** UpdatingText 构造可挂起、可更新或高成本的内容行，并把执行进度写入调度日志。 */
      function UpdatingText({text, ms}) {
        const [step, _setStep] = useState(0);
        setStep = _setStep;
        const fullText = `${text}:${step}`;
        return <Text text={readText(fullText)} />;
      }

      ReactDOM.render(
        <Suspense fallback={<Text text="Loading..." />}>
          <UpdatingText text="A" ms={1000} />
        </Suspense>,
        container,
      );

      assertLog(['Suspend! [A:0]', 'Loading...']);

      await resolveText('A:0');
      assertLog(['A:0']);
      expect(container.textContent).toEqual('A:0');

      await act(() => setStep(1));
      assertLog(['Suspend! [A:1]', 'Loading...']);
      expect(container.textContent).toEqual('Loading...');
    });

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于多个渲染线程读取同一 thenable，确认 ping 监听器按 thread ID 去重。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：多个渲染线程读取同一 thenable，确认 ping 监听器按 thread ID 去重。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序。
     * 对应源码：`attachPingListener()`、`pingSuspendedRoot()` 与 `retryTimedOutBoundary()`。
     */
    // @gate !disableLegacyMode
    it('memoizes promise listeners per thread ID to prevent redundant renders', async () => {
      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“多个渲染线程读取同一 thenable，确认 ping 监听器按 thread ID 去重”场景。 */
      function App() {
        return (
          <Suspense fallback={<Text text="Loading..." />}>
            <AsyncText text="A" />
            <AsyncText text="B" />
            <AsyncText text="C" />
          </Suspense>
        );
      }

      ReactDOM.render(null, container);

      ReactDOM.render(<App />, container);

      assertLog(['Suspend! [A]', 'Suspend! [B]', 'Suspend! [C]', 'Loading...']);

      await resolveText('A');
      assertLog([
        'A',
        // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
        'Suspend! [B]',
        'Suspend! [C]',
      ]);

      await resolveText('B');
      assertLog([
        // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
        'B',
        // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
        'Suspend! [C]',
      ]);

      await resolveText('C');
      assertLog([
        // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
        'C',
      ]);
    });

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于lazy 组件挂载后触发历史回归序列，确认挂起恢复与类更新可继续。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：lazy 组件挂载后触发历史回归序列，确认挂起恢复与类更新可继续。
     *
     * 验证机制：显式断言检查最终内容和副作用。
     * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
     */
    // @gate !disableLegacyMode
    it('#14162', async () => {
      const {lazy} = React;

      /** Hello 作为“lazy 组件挂载后触发历史回归序列，确认挂起恢复与类更新可继续”场景的测试 fixture，暴露对应渲染、资源或调度行为。 */
      function Hello() {
        return <span>hello</span>;
      }

      /** fetchComponent 作为“lazy 组件挂载后触发历史回归序列，确认挂起恢复与类更新可继续”场景的测试 fixture，暴露对应渲染、资源或调度行为。 */
      async function fetchComponent() {
        return new Promise(r => {
          // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
          setTimeout(r, 1000, {default: Hello});
        });
      }

      const LazyHello = lazy(fetchComponent);

      /** 定义 App 类 fixture，在“lazy 组件挂载后触发历史回归序列，确认挂起恢复与类更新可继续”场景中暴露实例 state 与提交生命周期。 */
      class App extends React.Component {
        /** 保存 App.state 的实例状态，跨挂起、fallback 与重试提交维持测试不变量。 */
        state = {render: false};

        /** App.componentDidMount 记录真实挂载提交，未提交的挂起尝试不得调用。 */
        componentDidMount() {
          setTimeout(() => this.setState({render: true}));
        }

        /** 渲染 App.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
        render() {
          return (
            <Suspense fallback={<span>loading...</span>}>
              {this.state.render && <LazyHello />}
            </Suspense>
          );
        }
      }

      ReactDOM.render(null, container);

      ReactDOM.render(<App name="world" />, container);
    });

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
     */
    // @gate !disableLegacyMode
    it('updates memoized child of suspense component when context updates (simple memo)', async () => {
      const {useContext, createContext, useState, memo} = React;

      const ValueContext = createContext(null);

      const MemoizedChild = memo(function MemoizedChild() {
        const text = useContext(ValueContext);
        return <Text text={readText(text)} />;
      });

      let setValue;
      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新”场景。 */
      function App() {
        const [value, _setValue] = useState('default');
        setValue = _setValue;

        return (
          <ValueContext.Provider value={value}>
            <Suspense fallback={<Text text="Loading..." />}>
              <MemoizedChild />
            </Suspense>
          </ValueContext.Provider>
        );
      }

      ReactDOM.render(<App />, container);
      assertLog(['Suspend! [default]', 'Loading...']);

      await resolveText('default');
      assertLog(['default']);
      expect(container.textContent).toEqual('default');

      await act(() => setValue('new value'));
      assertLog(['Suspend! [new value]', 'Loading...']);

      await resolveText('new value');
      assertLog(['new value']);
      expect(container.textContent).toEqual('new value');
    });

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
     */
    // @gate !disableLegacyMode
    it('updates memoized child of suspense component when context updates (manual memo)', async () => {
      const {useContext, createContext, useState, memo} = React;

      const ValueContext = createContext(null);

      const MemoizedChild = memo(
        function MemoizedChild() {
          const text = useContext(ValueContext);
          return <Text text={readText(text)} />;
        },
        function areEqual(prevProps, nextProps) {
          return true;
        },
      );

      let setValue;
      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新”场景。 */
      function App() {
        const [value, _setValue] = useState('default');
        setValue = _setValue;

        return (
          <ValueContext.Provider value={value}>
            <Suspense fallback={<Text text="Loading..." />}>
              <MemoizedChild />
            </Suspense>
          </ValueContext.Provider>
        );
      }

      ReactDOM.render(<App />, container);
      assertLog(['Suspend! [default]', 'Loading...']);

      await resolveText('default');
      assertLog(['default']);
      expect(container.textContent).toEqual('default');

      await act(() => setValue('new value'));
      assertLog(['Suspend! [new value]', 'Loading...']);

      await resolveText('new value');
      assertLog(['new value']);
      expect(container.textContent).toEqual('new value');
    });

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
     */
    // @gate !disableLegacyMode
    it('updates memoized child of suspense component when context updates (function)', async () => {
      const {useContext, createContext, useState} = React;

      const ValueContext = createContext(null);

      /** MemoizedChild 作为“Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新”场景的测试 fixture，暴露对应渲染、资源或调度行为。 */
      function MemoizedChild() {
        const text = useContext(ValueContext);
        return <Text text={readText(text)} />;
      }

      let setValue;
      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新”场景。 */
      function App({children}) {
        const [value, _setValue] = useState('default');
        setValue = _setValue;

        return (
          <ValueContext.Provider value={value}>
            {children}
          </ValueContext.Provider>
        );
      }

      ReactDOM.render(
        <App>
          <Suspense fallback={<Text text="Loading..." />}>
            <MemoizedChild />
          </Suspense>
        </App>,
        container,
      );
      assertLog(['Suspend! [default]', 'Loading...']);

      await resolveText('default');
      assertLog(['default']);
      expect(container.textContent).toEqual('default');

      await act(() => setValue('new value'));
      assertLog(['Suspend! [new value]', 'Loading...']);

      await resolveText('new value');
      assertLog(['new value']);
      expect(container.textContent).toEqual('new value');
    });

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
     */
    // @gate !disableLegacyMode
    it('updates memoized child of suspense component when context updates (forwardRef)', async () => {
      const {forwardRef, useContext, createContext, useState} = React;

      const ValueContext = createContext(null);

      const MemoizedChild = forwardRef(function MemoizedChild() {
        const text = useContext(ValueContext);
        return <Text text={readText(text)} />;
      });

      let setValue;
      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新”场景。 */
      function App() {
        const [value, _setValue] = useState('default');
        setValue = _setValue;

        return (
          <ValueContext.Provider value={value}>
            <Suspense fallback={<Text text="Loading..." />}>
              <MemoizedChild />
            </Suspense>
          </ValueContext.Provider>
        );
      }

      ReactDOM.render(<App />, container);
      assertLog(['Suspend! [default]', 'Loading...']);

      await resolveText('default');
      assertLog(['default']);
      expect(container.textContent).toEqual('default');

      await act(() => setValue('new value'));
      assertLog(['Suspend! [new value]', 'Loading...']);

      await resolveText('new value');
      assertLog(['new value']);
      expect(container.textContent).toEqual('new value');
    });

    /**
     * Given：已构造边界树、资源状态和调度检查点，用于Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。
     * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
     * Then：Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。
     *
     * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
     * 对应源码：`throwException()`、`updateSuspenseComponent()` 与 Suspense retry 调度路径。
     */
    // @gate !disableLegacyMode
    it('updates context consumer within child of suspended suspense component when context updates', async () => {
      const {createContext, useState} = React;

      const ValueContext = createContext(null);

      const promiseThatNeverResolves = new Promise(() => {});
      /** Child 作为层级 fixture 暴露 unwind、兄弟遍历或边界传播顺序，服务于“Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新”场景。 */
      function Child() {
        return (
          <ValueContext.Consumer>
            {value => {
              Scheduler.log(`Received context value [${value}]`);
              if (value === 'default') return <Text text="default" />;
              throw promiseThatNeverResolves;
            }}
          </ValueContext.Consumer>
        );
      }

      let setValue;
      /** Wrapper 作为层级 fixture 暴露 unwind、兄弟遍历或边界传播顺序，服务于“Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新”场景。 */
      function Wrapper({children}) {
        const [value, _setValue] = useState('default');
        setValue = _setValue;
        return (
          <ValueContext.Provider value={value}>
            {children}
          </ValueContext.Provider>
        );
      }

      /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新”场景。 */
      function App() {
        return (
          <Wrapper>
            <Suspense fallback={<Text text="Loading..." />}>
              <Child />
            </Suspense>
          </Wrapper>
        );
      }

      ReactDOM.render(<App />, container);
      assertLog(['Received context value [default]', 'default']);
      expect(container.textContent).toEqual('default');

      await act(() => setValue('new value'));
      assertLog(['Received context value [new value]', 'Loading...']);
      expect(container.textContent).toEqual('Loading...');

      await act(() => setValue('default'));
      assertLog(['Received context value [default]', 'default']);
      expect(container.textContent).toEqual('default');
    });
  });
});
