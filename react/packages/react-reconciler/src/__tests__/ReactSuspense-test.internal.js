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
      /** 状态机边界：`pending` 抛 thenable 交给 Suspense，`rejected` 抛业务错误，`resolved` 返回已缓存值。 */
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
        /** readText.then 在 pending 时登记 ping，终态订阅用微任务通知。 */
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

  /** 已挂载空 Suspense，transition 插入 Bar/A/B；A 挂起时虽 render fallback，DOM 仍为空，解决 A 后得到 AB。验证 refresh transition 不提交本轮 fallback。 */
  it('suspends rendering and continues later', async () => {
    /** 记录 Bar 并原样返回 children，使 A 挂起与 B 预热日志有一个可观察的父层级。 */
    function Bar(props) {
      Scheduler.log('Bar');
      return props.children;
    }

    /** 按 renderBar 决定是否插入 Bar/A/B，记录 Foo；空边界先挂载使后续更新属于 refresh。 */
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
    await act(() => {
      root.render(<Foo />);
    });
    assertLog(['Foo']);
    const renderedEl = container;
    expect(renderedEl.innerText).toBeUndefined();

    React.startTransition(() => {
      root.render(<Foo renderBar={true} />);
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
    expect(container.textContent).toEqual('');

    await waitForAll([]);
    expect(container.textContent).toEqual('');

    resolveText('A');
    await waitForAll(['Foo', 'Bar', 'A', 'B']);
    expect(container.textContent).toEqual('AB');
  });

  /** 两个兄弟边界分别挂起并依次解决，确认每个边界独立从 fallback 恢复。 */
  it('suspends siblings and later recovers each independently', async () => {
    const root = ReactDOMClient.createRoot(container);
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

  /** thenable 在当前渲染阶段结束前 ping，确认进行中的工作被中断并以已解决状态重试。 */
  it('interrupts current render if promise resolves before current render phase', async () => {
    let didResolve = false;
    const listeners = [];

    const thenable = {
      /** then 在未解决时登记 listener，已解决时同步调用 resolve，用于覆盖渲染中的即时 ping。 */
      then(resolve) {
        if (!didResolve) {
          listeners.push(resolve);
        } else {
          resolve();
        }
      },
    };

    /** 先置 didResolve=true，再同步通知已登记 listeners，确保 React 重读时不再挂起。 */
    function resolveThenable() {
      didResolve = true;
      listeners.forEach(l => l());
    }

    /** didResolve=false 时抛共享 thenable；变 true 后输出 Async，使时间片之间的 ping 可重开挂起工作。 */
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

    resolveThenable();
    assertLog([]);
    expect(container.textContent).toEqual('Initial');

    // 从根重新开始渲染，而不是续接当前完成进度。
    await waitForAll([
      'Async',
      'After Suspense',
      'Sibling',
    ]);
    expect(container.textContent).toEqual('AsyncAfter SuspenseSibling');
  });

  /** 初挂外层 Loading，解决 A 后内层 B 仍挂起；渲染 Loading more 却暂留旧 Loading，立即解决 B 后直接提交 AB，验证共享 fallback 节流。 */
  it('throttles fallback committing globally', async () => {
    /** 外层边界读取 A，内层边界读取 B，两个 fallback 用于观察全局节流；资源由用例外部完成。 */
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

    expect(container.textContent).toEqual('Loading...');

    await act(() => resolveText('B'));
    assertLog(['A', 'B']);
    expect(container.textContent).toEqual('AB');
  });

  /** A 在外部 timer 290ms 完成，B 再等 30ms；推进290/10/300ms并在 B render 后暂停，此时 DOM 是 ALoading more，最后 act 到 AB。ms props 未被 AsyncText 消费。 */
  it('pushes out siblings that render faster than throttle', async () => {
    /** 外层边界读取 A，内层边界读取 B，两个 fallback 用于观察全局节流；资源由用例外部完成。 */
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

    jest.advanceTimersByTime(290);
    await waitFor(['A']);
    expect(container.textContent).toEqual('Loading...');

    jest.advanceTimersByTime(10);
    await waitForAll(['Suspend! [B]', 'Loading more...']);
    expect(container.textContent).toEqual('Loading...');

    jest.advanceTimersByTime(300);
    await waitFor(['B']);
    expect(container.textContent).toEqual('ALoading more...');

    await act(() => {});
    expect(container.textContent).toEqual('AB');
  });

  /** 初挂 Loading；A 完成后仍暂留 Loading，推进500ms后提交 ALoading more，解决 B 后得到 AB，验证节流窗口终会释放。 */
  it('does not throttle fallback committing for too long', async () => {
    /** 外层边界读取 A，内层边界读取 B，两个 fallback 用于观察全局节流；资源由用例外部完成。 */
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

    expect(container.textContent).toEqual('Loading...');
    jest.advanceTimersByTime(500);
    expect(container.textContent).toEqual('ALoading more...');

    await act(() => resolveText('B'));
    assertLog(['B']);
    expect(container.textContent).toEqual('AB');
  });

  /** legacy 根加载 lazy 类组件，确认模块解决后正确挂载并执行类生命周期。 */
  // @gate !disableLegacyMode
  it('mounts a lazy class component in non-concurrent mode (legacy)', async () => {
    /** 输出 label 并记录 didMount/didUpdate，作为 legacy lazy 模块的类组件。 */
    class Class extends React.Component {
      /** Class.componentDidMount 记录真实挂载提交，未提交的挂起尝试不得调用。 */
      componentDidMount() {
        Scheduler.log('Did mount: ' + this.props.label);
      }
      /** Class.componentDidUpdate 记录已提交更新，用于区分恢复复用与重新挂载。 */
      componentDidUpdate() {
        Scheduler.log('Did update: ' + this.props.label);
      }
      /** 渲染 Class.render 对应的子树；资源读取由实际执行的组件完成。 */
      render() {
        return <Text text={this.props.label} />;
      }
    }

    /** 通过 async 返回含 default 导出的模块对象，供 React.lazy 加载类组件。 */
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

  /** Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。 */
  it('updates memoized child of suspense component when context updates (simple memo)', async () => {
    const {useContext, createContext, useState, memo} = React;

    const ValueContext = createContext(null);

    const MemoizedChild = memo(/** 以 Context 值为资源 key；即使 props 未变，依赖传播也必须重新读取并可挂起。 */ function MemoizedChild() {
      const text = useContext(ValueContext);
      return <Text text={readText(text)} />;
    });

    let setValue;
    /** 持有 default/new value 的 Provider state，边界内放简单 memo 消费者。 */
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

  /** Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。 */
  it('updates memoized child of suspense component when context updates (manual memo)', async () => {
    const {useContext, createContext, useState, memo} = React;

    const ValueContext = createContext(null);

    const MemoizedChild = memo(
      /** 从当前 Context 读取资源，pending 抛出 thenable；供自定义 props 比较器与 Context 依赖互相独立的回归。 */
      function MemoizedChild() {
        const text = useContext(ValueContext);
        return <Text text={readText(text)} />;
      },
      /** 对所有 props 返回 true，刻意制造 props bailout；Context 更新仍应重新渲染消费者。 */ function areEqual(prevProps, nextProps) {
        return true;
      },
    );

    let setValue;
    /** 持有 Provider state，边界内放 props 比较始终 true 的 memo 消费者。 */
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

  /** Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。 */
  it('updates memoized child of suspense component when context updates (function)', async () => {
    const {useContext, createContext, useState} = React;

    const ValueContext = createContext(null);

    /** 普通函数从 ValueContext 读取资源 key；Provider 保持 children 身份，未使用 React.memo。 */
    function MemoizedChild() {
      const text = useContext(ValueContext);
      return <Text text={readText(text)} />;
    }

    let setValue;
    /** 更新 Provider value 并保持传入 children 元素身份，普通函数消费者必须经 Context 传播重读。 */
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

  /** Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。 */
  it('updates memoized child of suspense component when context updates (forwardRef)', async () => {
    const {forwardRef, useContext, createContext, useState} = React;

    const ValueContext = createContext(null);

    /** forwardRef 包装器内消费 Context 资源，未使用 ref。 */
    const MemoizedChild = forwardRef(() => {
      const text = useContext(ValueContext);
      return <Text text={readText(text)} />;
    });

    let setValue;
    /** 更新 Provider value 并保持 children 身份，forwardRef 消费者重读资源；本例没有 ref 操作。 */
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

  /** 隐藏后重新显示已挂载 Suspense 主树，确认 Layout Effect 清理后重新创建。 */
  it('re-fires layout effects when re-showing Suspense', async () => {
    /** 记录空依赖 layout create/cleanup，检查 Suspense 隐藏与揭示时的重连。 */
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
    /** 暴露 show setter，以 Child 2 的挂起隐藏已经挂载且有 layout effect 的 Child 1。 */
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

  /** 挂起更新经历很长虚拟时间，确认并发根不会永久停留在 fallback。 */
  it('does not get stuck with fallback in concurrent mode for a large delay', async () => {
    /** 将 Child 1/2 放同一边界，分次完成资源并在中途推进6000ms。 */
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
    /** 已挂载类组件在更新中挂起后恢复，确认实例 state 和生命周期连续。 */
    // @gate !disableLegacyMode
    it('a mounted class component can suspend without losing state', async () => {
      /** 输出 props.text，记录 mount/update/unmount，用于 A/C 与 fallback 的生命周期对照。 */
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
        /** 渲染 TextWithLifecycle.render 对应的子树；资源读取由实际执行的组件完成。 */
        render() {
          return <Text {...this.props} />;
        }
      }

      let instance;
      /** 保存 step=1 并读取 text:step，实例 state 跨 legacy 挂起恢复保留。 */
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
        /** AsyncTextWithLifecycle.componentWillUnmount 记录卸载生命周期；并发 Offscreen 隐藏已可见树也会调用此方法，未挂载节点不会调用。 */
        componentWillUnmount() {
          Scheduler.log(`Unmount [${this.props.text}:${this.state.step}]`);
        }
        /** 渲染 AsyncTextWithLifecycle.render 对应的子树；资源读取由实际执行的组件完成。 */
        render() {
          instance = this;
          const text = readText(`${this.props.text}:${this.state.step}`);
          return <Text text={text} />;
        }
      }

      /** 将 A/C 已完成类与可挂起 B:step 类放在同一边界，fallback 也是生命周期记录类。 */
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
        // 'Mount [B]',
        'Mount [C]',
        'Mount [Loading...]',
      ]);
      expect(container.textContent).toEqual('Loading...');

      await resolveText('B:1');
      assertLog([
        'B:1',
        'Unmount [Loading...]',
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

    /** 已显示 fallback 的边界收到主树更新，确认 bailout 与重试选择不会跳过挂起组件。 */
    // @gate !disableLegacyMode
    it('bails out on timed-out primary children even if they receive an update', async () => {
      let instance;
      /** 暴露实例并保存 step，受测同步或异步输出由本例 render 决定。 */
      class Stateful extends React.Component {
        /** 保存 Stateful.state 的实例状态，跨挂起、fallback 与重试提交维持测试不变量。 */
        state = {step: 1};
        /** 渲染 Stateful.render 对应的子树；资源读取由实际执行的组件完成。 */
        render() {
          instance = this;
          return <Text text={`Stateful: ${this.state.step}`} />;
        }
      }

      /** 边界内并列同步 Stateful 与异步 props.text，更新前者时必须再次尝试仍挂起的后者。 */
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

    /** 已显示 fallback 的边界收到主树更新，确认 bailout 与重试选择不会跳过挂起组件。 */
    // @gate !disableLegacyMode
    it('when updating a timed-out tree, always retries the suspended component', async () => {
      let instance;
      /** 暴露实例并保存 step，受测同步或异步输出由本例 render 决定。 */
      class Stateful extends React.Component {
        /** 保存 Stateful.state 的实例状态，跨挂起、fallback 与重试提交维持测试不变量。 */
        state = {step: 1};
        /** 渲染 Stateful.render 对应的子树；资源读取由实际执行的组件完成。 */
        render() {
          instance = this;
          return <Text text={`Stateful: ${this.state.step}`} />;
        }
      }

      const Indirection = React.Fragment;

      /** 在 Stateful 的兄弟分支加入三层 Fragment，检查树更新仍遍历到挂起 AsyncText。 */
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

        'Suspend! [B]',
      ]);
      expect(container.textContent).toEqual('Loading...');

      await resolveText('B');
      assertLog(['B']);
      expect(container.textContent).toEqual('Stateful: 2B');
    });

    /** legacy 根首次挂起的类尚未挂载，根随后直接换成 B；日志只含 B，没有 will unmount，验证不能清理未挂载实例。 */
    // @gate !disableLegacyMode
    it('suspends in a class that has componentWillUnmount and is then deleted', async () => {
      /** 读取当前文本资源并记录 willUnmount；首次挂起未挂载，删除时不应调用该清理。 */
      class AsyncTextWithUnmount extends React.Component {
        /** AsyncTextWithUnmount.componentWillUnmount 记录卸载生命周期；并发 Offscreen 隐藏已可见树也会调用此方法，未挂载节点不会调用。 */
        componentWillUnmount() {
          Scheduler.log('will unmount');
        }
        /** 渲染 AsyncTextWithUnmount.render 对应的子树；资源读取由实际执行的组件完成。 */
        render() {
          return <Text text={readText(this.props.text)} />;
        }
      }

      /** 把首次读取即挂起的类放入边界，根随后换成 B，检查未挂载类不调用 willUnmount。 */
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
      assertLog(['B']);
      expect(container.textContent).toEqual('B');
    });

    /** legacy 组件注册 layout effect 后读取 A 并挂起；初次只有 Suspend/Loading，解决 A 后才记录 A/Did commit，验证未完成 render 不运行 layout create。 */
    // @gate !disableLegacyMode
    it('suspends in a component that also contains useEffect', async () => {
      const {useLayoutEffect} = React;

      /** 先注册依赖 text 的 layout effect，再读资源；挂起尝试不执行 create，成功提交记录 Did commit。 */
      function AsyncTextWithEffect(props) {
        const text = props.text;

        useLayoutEffect(() => {
          Scheduler.log('Did commit: ' + text);
        }, [text]);

        return <Text text={readText(text)} />;
      }

      /** 包裹读取资源并注册 layout effect 的函数组件，使成功重试后才记录 Did commit。 */
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

    /** 已显示 fallback 的边界收到主树更新，确认 bailout 与重试选择不会跳过挂起组件。 */
    // @gate !disableLegacyMode
    it('retries when an update is scheduled on a timed out tree', async () => {
      let instance;
      /** 暴露实例并保存 step，受测同步或异步输出由本例 render 决定。 */
      class Stateful extends React.Component {
        /** 保存 Stateful.state 的实例状态，跨挂起、fallback 与重试提交维持测试不变量。 */
        state = {step: 1};
        /** 渲染 Stateful.render 对应的子树；资源读取由实际执行的组件完成。 */
        render() {
          instance = this;
          return <AsyncText text={`Step: ${this.state.step}`} />;
        }
      }

      /** 只包裹 Stateful 的 Step:state 异步内容，观察2挂起后3覆盖以及旧2资源完成无中间提交。 */
      function App(props) {
        return (
          <Suspense fallback={<Text text="Loading..." />}>
            <Stateful />
          </Suspense>
        );
      }

      ReactDOM.render(<App />, container);

      assertLog(['Suspend! [Step: 1]', 'Loading...']);

      await act(() => resolveText('Step: 1'));
      assertLog(['Step: 1']);
      expect(container.textContent).toEqual('Step: 1');

      await act(() => {
        instance.setState({step: 2});
      });
      assertLog(['Suspend! [Step: 2]', 'Loading...']);
      expect(container.textContent).toEqual('Loading...');

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

    /** legacy 边界等待多个子资源依次解决，确认 fallback 实例不会重复挂载。 */
    // @gate !disableLegacyMode
    it('does not remount the fallback while suspended children resolve in legacy mode', async () => {
      let mounts = 0;
      /** fallback 类在 didMount 增加 mounts，三资源的多次 retry 不应重建它。 */
      class ShouldMountOnce extends React.Component {
        /** ShouldMountOnce.componentDidMount 记录真实挂载提交，未提交的挂起尝试不得调用。 */
        componentDidMount() {
          mounts++;
        }
        /** 渲染 ShouldMountOnce.render 对应的子树；资源读取由实际执行的组件完成。 */
        render() {
          return <Text text="Loading..." />;
        }
      }

      /** 以 ShouldMountOnce 作 fallback，三个 Child 分次解决时维持同一 fallback 实例。 */
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

    /** 挂起树包含更新与删除 Effect，恢复时复用完成工作且保留删除副作用。 */
    // @gate !disableLegacyMode
    it('reuses effects, including deletions, from the suspended tree', async () => {
      const {useState} = React;

      let setTab;
      /** 按 tab 同时改变 AsyncText 与同步 sibling 的 key，检查挂起树插入/删除副作用不丢失。 */
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

    /** 已挂载组件关联的 thenable 再次 ping，确认不会产生卸载或更新告警。 */
    // @gate !disableLegacyMode
    it('does not warn if a mounted component is pinged', async () => {
      const {useState} = React;

      ReactDOM.render(null, container);

      let setStep;
      /** 暴露 step setter，以 text:step 为资源键；ms 参数未使用，外部 resolveText 决定完成。 */
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

    /** legacy 根 A/B/C 初次都挂起，依次解决后日志只重渲染新完成项与仍挂起项，没有重复已完成 A/B。当前实现使用 wakeable 的 retryCache 去重，本例未创建多个根或直接断言 listener 数。 */
    // @gate !disableLegacyMode
    it('memoizes promise listeners per thread ID to prevent redundant renders', async () => {
      /** 将 A/B/C 三资源放同一 legacy 边界，完成一个时后续仍挂起但此前完成项不重复 render。 */
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
        'Suspend! [B]',
        'Suspend! [C]',
      ]);

      await resolveText('B');
      assertLog([
        'B',
        'Suspend! [C]',
      ]);

      await resolveText('C');
      assertLog([
        'C',
      ]);
    });

    /** legacy 根首次挂载 render=false 的 App，didMount 安排 timer 打开 lazy 分支；本例只调用 render，不推进timer也无输出断言，覆盖该初始操作不抛错。 */
    // @gate !disableLegacyMode
    it('#14162', async () => {
      const {lazy} = React;

      /** 返回 hello 文本，作为 fakeImport 完成后加载的组件。 */
      function Hello() {
        return <span>hello</span>;
      }

      /** 延迟 1000ms 返回包含 Hello 的模块，驱动 lazy 的挂起与恢复。 */
      async function fetchComponent() {
        return new Promise(r => {
          setTimeout(r, 1000, {default: Hello});
        });
      }

      const LazyHello = lazy(fetchComponent);

      /** 初始 render=false；挂载安排 timer 打开 LazyHello 分支，本例仅检查初始 render 不抛错。 */
      class App extends React.Component {
        /** 保存 App.state 的实例状态，跨挂起、fallback 与重试提交维持测试不变量。 */
        state = {render: false};

        /** 挂载时安排 timer，将 render state 置 true；本例未主动推进 timer。 */
        componentDidMount() {
          setTimeout(() => this.setState({render: true}));
        }

        /** 渲染 App.render 对应的子树；资源读取由实际执行的组件完成。 */
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

    /** Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。 */
    // @gate !disableLegacyMode
    it('updates memoized child of suspense component when context updates (simple memo)', async () => {
      const {useContext, createContext, useState, memo} = React;

      const ValueContext = createContext(null);

      const MemoizedChild = memo(/** 以 Context 值为资源 key；即使 props 未变，依赖传播也必须重新读取并可挂起。 */ function MemoizedChild() {
        const text = useContext(ValueContext);
        return <Text text={readText(text)} />;
      });

      let setValue;
      /** 在 legacy 根更新 Provider value，边界内简单 memo 消费者经 Context 变化重读。 */
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

    /** Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。 */
    // @gate !disableLegacyMode
    it('updates memoized child of suspense component when context updates (manual memo)', async () => {
      const {useContext, createContext, useState, memo} = React;

      const ValueContext = createContext(null);

      const MemoizedChild = memo(
        /** 从当前 Context 读取资源，pending 抛出 thenable；供自定义 props 比较器与 Context 依赖互相独立的回归。 */
      function MemoizedChild() {
          const text = useContext(ValueContext);
          return <Text text={readText(text)} />;
        },
        /** 对所有 props 返回 true，刻意制造 props bailout；Context 更新仍应重新渲染消费者。 */ function areEqual(prevProps, nextProps) {
          return true;
        },
      );

      let setValue;
      /** 在 legacy 根更新 Provider value，memo 比较器虽始终 true，Context 依赖仍驱动重读。 */
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

    /** Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。 */
    // @gate !disableLegacyMode
    it('updates memoized child of suspense component when context updates (function)', async () => {
      const {useContext, createContext, useState} = React;

      const ValueContext = createContext(null);

      /** 普通函数用 Context 值作为资源键；Provider 保持 children 身份，Context 改变时仍须重新读取。 */
      /** 从当前 Context 读取资源，pending 抛出 thenable；供自定义 props 比较器与 Context 依赖互相独立的回归。 */
      function MemoizedChild() {
        const text = useContext(ValueContext);
        return <Text text={readText(text)} />;
      }

      let setValue;
      /** legacy Provider 保持 children 身份，只改变 value；普通函数消费者依赖 Context 更新。 */
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

    /** Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。 */
    // @gate !disableLegacyMode
    it('updates memoized child of suspense component when context updates (forwardRef)', async () => {
      const {forwardRef, useContext, createContext, useState} = React;

      const ValueContext = createContext(null);

      const MemoizedChild = forwardRef(/** 读取 Context 文本资源；本例忽略 ref，恢复与更新由 Context 依赖驱动。 */ function MemoizedChild() {
        const text = useContext(ValueContext);
        return <Text text={readText(text)} />;
      });

      let setValue;
      /** legacy Provider 内使用 forwardRef 消费者；value 改变时重读异步文本，ref 不参与。 */
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

    /** Suspense 子树中的 memo、函数或 forwardRef 消费者接收 Context 更新，确认 memo bailout 不吞更新。 */
    // @gate !disableLegacyMode
    it('updates context consumer within child of suspended suspense component when context updates', async () => {
      const {createContext, useState} = React;

      const ValueContext = createContext(null);

      const promiseThatNeverResolves = new Promise(() => {});
      /** 使用 render-prop Consumer：default 返回文本，其余值抛永不解决的 Promise；Context 改回 default 即可恢复。 */
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
      /** 持有 Provider value setter，同时保留 children 身份，避免重建边界造成 Context 回归假阳性。 */
      function Wrapper({children}) {
        const [value, _setValue] = useState('default');
        setValue = _setValue;
        return (
          <ValueContext.Provider value={value}>
            {children}
          </ValueContext.Provider>
        );
      }

      /** 保持 Wrapper 的 children 元素，以 Consumer 的 Context 分支在 default 内容与永不解决的挂起间切换。 */
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
