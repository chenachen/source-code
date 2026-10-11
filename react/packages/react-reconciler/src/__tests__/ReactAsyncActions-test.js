let React;
let ReactNoop;
let Scheduler;
let act;
let assertLog;
let useTransition;
let useState;
let useOptimistic;
let textCache;
let assertConsoleErrorDev;

/** 覆盖异步 action scope 的 pending、更新纠缠、乐观状态、卸载边界与错误传播。 */
describe('ReactAsyncActions', () => {
  /** 重建 React/Noop 环境、错误上报探针与共享文本 thenable 缓存。 */
  beforeEach(() => {
    jest.resetModules();

    /** 将全局 startTransition 捕获的错误转成 reportError 日志，区分 Hook 错误边界与非 Hook 上报路径。 */
    global.reportError = error => {
      Scheduler.log('reportError: ' + error.message);
    };

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    assertLog = require('internal-test-utils').assertLog;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
    useTransition = React.useTransition;
    useState = React.useState;
    useOptimistic = React.useOptimistic;

    textCache = new Map();
  });

  /** 将文本资源推进为 resolved，并唤醒全部订阅该 thenable 的 action/retry。 */
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

  /**
   * 在 render 中读取文本；pending/rejected 时抛出，resolved 时返回值。
   * 首次读取创建共享 thenable，用于测试 Suspense 与 action scope 的协调。
   */
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
        /** pending 时登记 React retry，完成后以微任务回放。 */
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

  /**
   * 以 Promise 风格取得文本，供 async action 的 `await` 制造可控间隙。
   * 与 `readText` 共享状态记录，但不向 React 抛出 pending thenable。
   */
  function getText(text) {
    const record = textCache.get(text);
    if (record === undefined) {
      const thenable = {
        pings: [],
        /** 登记 await continuation；资源若已完成则异步回放。 */
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
      return thenable;
    } else {
      switch (record.status) {
        case 'pending':
          return record.value;
        case 'rejected':
          return Promise.reject(record.value);
        case 'resolved':
          return Promise.resolve(record.value);
      }
    }
  }

  /** 记录同步文本渲染并返回同名输出。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** 读取可能挂起的文本，成功后记录并输出。 */
  function AsyncText({text}) {
    readText(text);
    Scheduler.log(text);
    return text;
  }

  /**
   * 场景（Given–When–Then）：给定 useTransition 启动一个等待 `Wait` 的 async action；当 action
   * 开始与结束；那么 isPending 从 false→true，并只在 Promise 完成后恢复 false。
   * 对应机制：action scope completion 计数驱动 hook pending 队列。
   */
  it('isPending remains true until async action finishes', async () => {
    let startTransition;
    /** 暴露 transition 启动器并输出 pending 标记。 */
    function App() {
      const [isPending, _start] = useTransition();
      startTransition = _start;
      return <Text text={'Pending: ' + isPending} />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });
    assertLog(['Pending: false']);
    expect(root).toMatchRenderedOutput('Pending: false');

    // async action 开始时 isPending 变为 true。
    await act(() => {
      startTransition(async () => {
        Scheduler.log('Async action started');
        await getText('Wait');
        Scheduler.log('Async action ended');
      });
    });
    assertLog(['Async action started', 'Pending: true']);
    expect(root).toMatchRenderedOutput('Pending: true');

    // action 完成后 isPending 才恢复 false。
    await act(() => resolveText('Wait'));
    assertLog(['Async action ended', 'Pending: false']);
    expect(root).toMatchRenderedOutput('Pending: false');
  });

  /**
   * 场景（Given–When–Then）：给定 async action await 后嵌套 transition 更新根 A→B；当 await
   * 完成；那么 pending 复位与 B 在同一纠缠批次提交，不暴露中间状态。
   * 对应机制：action scope 收集异步间隙后的 transition updates。
   */
  it('multiple updates in an async action scope are entangled together', async () => {
    let startTransition;
    /** 同时展示 action pending 与外部传入文本。 */
    function App({text}) {
      const [isPending, _start] = useTransition();
      startTransition = _start;
      return (
        <>
          <span>
            <Text text={'Pending: ' + isPending} />
          </span>
          <span>
            <Text text={text} />
          </span>
        </>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App text="A" />);
    });
    assertLog(['Pending: false', 'A']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Pending: false</span>
        <span>A</span>
      </>,
    );

    await act(() => {
      startTransition(async () => {
        Scheduler.log('Async action started');
        await getText('Yield before updating');
        Scheduler.log('Async action ended');
        startTransition(() => root.render(<App text="B" />));
      });
    });
    assertLog(['Async action started', 'Pending: true', 'A']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Pending: true</span>
        <span>A</span>
      </>,
    );

    await act(() => resolveText('Yield before updating'));
    assertLog(['Async action ended', 'Pending: false', 'B']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Pending: false</span>
        <span>B</span>
      </>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定同一 async action 在两个 await 间依次更新 A/B/C；当 action
   * 结束且资源 A1/B1/C1 逐个完成；那么三条队列保持纠缠，只在全部解除阻塞后一起提交。
   * 对应机制：action scope 的 entangled lane 集合与 Suspense retry。
   */
  it('multiple async action updates in the same scope are entangled together', async () => {
    let setStepA;
    /** 暴露 A 的状态更新器，并从异步文本资源读取当前版本。 */
    function A() {
      const [step, setStep] = useState(0);
      setStepA = setStep;
      return <AsyncText text={'A' + step} />;
    }

    let setStepB;
    /** 暴露 B 的状态更新器，并从异步文本资源读取当前版本。 */
    function B() {
      const [step, setStep] = useState(0);
      setStepB = setStep;
      return <AsyncText text={'B' + step} />;
    }

    let setStepC;
    /** 暴露 C 的状态更新器，并从异步文本资源读取当前版本。 */
    function C() {
      const [step, setStep] = useState(0);
      setStepC = setStep;
      return <AsyncText text={'C' + step} />;
    }

    let startTransition;
    /** 提供 action 启动器，并并列渲染三个独立更新队列。 */
    function App() {
      const [isPending, _start] = useTransition();
      startTransition = _start;
      return (
        <>
          <span>
            <Text text={'Pending: ' + isPending} />
          </span>
          <span>
            <A />, <B />, <C />
          </span>
        </>
      );
    }

    const root = ReactNoop.createRoot();
    resolveText('A0');
    resolveText('B0');
    resolveText('C0');
    await act(() => {
      root.render(<App text="A" />);
    });
    assertLog(['Pending: false', 'A0', 'B0', 'C0']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Pending: false</span>
        <span>A0, B0, C0</span>
      </>,
    );

    await act(() => {
      startTransition(async () => {
        Scheduler.log('Async action started');
        setStepA(1);
        await getText('Wait before updating B');
        startTransition(() => setStepB(1));
        await getText('Wait before updating C');
        startTransition(() => setStepC(1));
        Scheduler.log('Async action ended');
      });
    });
    assertLog(['Async action started', 'Pending: true', 'A0', 'B0', 'C0']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Pending: true</span>
        <span>A0, B0, C0</span>
      </>,
    );

    // 这里安排 B 更新，但 action scope 尚未结束；队列读取共享 action thenable 后挂起，组件不会输出 B1。
    await act(() => resolveText('Wait before updating B'));
    assertLog([]);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Pending: true</span>
        <span>A0, B0, C0</span>
      </>,
    );

    // 安排 C 更新并结束 action scope，此时 React 才能尝试整组更新。
    await act(() => resolveText('Wait before updating C'));
    assertLog([
      'Async action ended',
      'Pending: false',
      'Suspend! [A1]',
      // 后台预热其余纠缠分支。
      'Suspend! [B1]',
      'Suspend! [C1]',
    ]);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Pending: true</span>
        <span>A0, B0, C0</span>
      </>,
    );

    // 逐步完成数据；A/B/C 纠缠，只有全部解除阻塞才允许提交。
    await act(() => resolveText('A1'));
    assertLog([
      'Pending: false',
      'A1',
      'Suspend! [B1]',
      // 后台预热 C。
      'Suspend! [C1]',
    ]);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Pending: true</span>
        <span>A0, B0, C0</span>
      </>,
    );
    await act(() => resolveText('B1'));
    assertLog(['Pending: false', 'A1', 'B1', 'Suspend! [C1]']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Pending: true</span>
        <span>A0, B0, C0</span>
      </>,
    );

    // 全部资源就绪后，transition 才完整提交。
    await act(() => resolveText('C1'));
    assertLog(['Pending: false', 'A1', 'B1', 'C1']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Pending: false</span>
        <span>A1, B1, C1</span>
      </>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定 A 的 transition action 正在等待，B 发生 urgent 更新；当 B1
   * 提交后再结束 action；那么 B 不被阻塞，A1 最后与当前 B1 一起收敛。
   * 对应机制：urgent lane 不加入 async action 的纠缠集合。
   */
  it('urgent updates are not blocked during an async action', async () => {
    let setStepA;
    /** 暴露由 async action 更新的 A 状态。 */
    function A() {
      const [step, setStep] = useState(0);
      setStepA = setStep;
      return <Text text={'A' + step} />;
    }

    let setStepB;
    /** 暴露由 urgent lane 更新的 B 状态。 */
    function B() {
      const [step, setStep] = useState(0);
      setStepB = setStep;
      return <Text text={'B' + step} />;
    }

    let startTransition;
    /** 展示 pending 标记与 A/B 两个不同优先级队列。 */
    function App() {
      const [isPending, _start] = useTransition();
      startTransition = _start;
      return (
        <>
          <span>
            <Text text={'Pending: ' + isPending} />
          </span>
          <span>
            <A />, <B />
          </span>
        </>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App text="A" />);
    });
    assertLog(['Pending: false', 'A0', 'B0']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Pending: false</span>
        <span>A0, B0</span>
      </>,
    );

    await act(() => {
      startTransition(async () => {
        Scheduler.log('Async action started');
        startTransition(() => setStepA(1));
        await getText('Wait');
        Scheduler.log('Async action ended');
      });
    });
    assertLog(['Async action started', 'Pending: true', 'A0', 'B0']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Pending: true</span>
        <span>A0, B0</span>
      </>,
    );

    // 以 urgent 优先级更新 B，允许立即完成。
    await act(() => setStepB(1));
    assertLog(['B1']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Pending: true</span>
        <span>A0, B1</span>
      </>,
    );

    // 结束 async action 并提交 A。
    await act(() => resolveText('Wait'));
    assertLog(['Async action ended', 'Pending: false', 'A1', 'B1']);
    expect(root).toMatchRenderedOutput(
      <>
        <span>Pending: false</span>
        <span>A1, B1</span>
      </>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定同步 action 在 useTransition 回调内抛出 Oops；当 action 调度；
   * 那么错误通过 hook 的 rejected thenable 路径重新抛给最近 ErrorBoundary。
   * 对应机制：transition action 错误转为可由 render 捕获的状态更新。
   */
  it("if a sync action throws, it's rethrown from the `useTransition`", async () => {
    /** 捕获 action 重抛错误并显示消息。 */
    class ErrorBoundary extends React.Component {
      /** null 表示正常子树，非空表示 action 错误。 */
      state = {error: null};
      /** 把 render 阶段重抛的 action 错误写入 state。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 在错误消息与原始 action UI 之间切换。 */
      render() {
        if (this.state.error) {
          return <Text text={this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    let startTransition;
    /** 暴露 transition 启动器并显示 pending。 */
    function App() {
      const [isPending, _start] = useTransition();
      startTransition = _start;
      return <Text text={'Pending: ' + isPending} />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <ErrorBoundary>
          <App />
        </ErrorBoundary>,
      );
    });
    assertLog(['Pending: false']);
    expect(root).toMatchRenderedOutput('Pending: false');

    await act(() => {
      startTransition(() => {
        throw new Error('Oops!');
      });
    });
    assertLog(['Pending: true', 'Oops!', 'Oops!']);
    expect(root).toMatchRenderedOutput('Oops!');
  });

  /**
   * 场景（Given–When–Then）：给定 async action await 后抛出 Oops；当等待资源完成；那么 pending
   * 期间保持旧 UI，Promise rejection 随后由 useTransition 重抛给 ErrorBoundary。
   * 对应机制：异步 action rejection 在 scope 结束时调度错误更新。
   */
  it("if an async action throws, it's rethrown from the `useTransition`", async () => {
    /** 捕获异步 action 重抛错误并显示消息。 */
    class ErrorBoundary extends React.Component {
      /** null 表示正常子树，非空表示 action 错误。 */
      state = {error: null};
      /** 把 action rejection 的 render 重抛写入 state。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 在错误消息与原始 action UI 之间切换。 */
      render() {
        if (this.state.error) {
          return <Text text={this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    let startTransition;
    /** 暴露 transition 启动器并显示 pending。 */
    function App() {
      const [isPending, _start] = useTransition();
      startTransition = _start;
      return <Text text={'Pending: ' + isPending} />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <ErrorBoundary>
          <App />
        </ErrorBoundary>,
      );
    });
    assertLog(['Pending: false']);
    expect(root).toMatchRenderedOutput('Pending: false');

    await act(() => {
      startTransition(async () => {
        Scheduler.log('Async action started');
        await getText('Wait');
        throw new Error('Oops!');
      });
    });
    assertLog(['Async action started', 'Pending: true']);
    expect(root).toMatchRenderedOutput('Pending: true');

    await act(() => resolveText('Wait'));
    assertLog(['Oops!', 'Oops!']);
    expect(root).toMatchRenderedOutput('Oops!');
  });

  /**
   * 场景（Given–When–Then）：给定 A/B/C 三个嵌套纠缠 action，其中 A/C 失败、B 成功；当最后
   * C 完成使整组可提交；那么各 ErrorBoundary 只隔离自身错误，B 正常清除 pending。
   * 对应机制：共享 action scope 控制提交时机，但错误结果仍归属各 useTransition hook。
   */
  it('if there are multiple entangled actions, and one of them errors, it only affects that action', async () => {
    /** 为每个 action 单独捕获错误，证明纠缠不合并错误边界。 */
    class ErrorBoundary extends React.Component {
      /** 保存当前边界捕获的 action 错误。 */
      state = {error: null};
      /** 把本分支的 action 错误写入 state。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 显示错误消息或原始 pending 探针。 */
      render() {
        if (this.state.error) {
          return <Text text={this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    let startTransitionA;
    /** 暴露 action A 启动器并显示 A pending。 */
    function ActionA() {
      const [isPendingA, start] = useTransition();
      startTransitionA = start;
      return <Text text={'Pending A: ' + isPendingA} />;
    }

    let startTransitionB;
    /** 暴露 action B 启动器并显示 B pending。 */
    function ActionB() {
      const [isPending, start] = useTransition();
      startTransitionB = start;
      return <Text text={'Pending B: ' + isPending} />;
    }

    let startTransitionC;
    /** 暴露 action C 启动器并显示 C pending。 */
    function ActionC() {
      const [isPending, start] = useTransition();
      startTransitionC = start;
      return <Text text={'Pending C: ' + isPending} />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <>
          <div>
            <ErrorBoundary>
              <ActionA />
            </ErrorBoundary>
          </div>
          <div>
            <ErrorBoundary>
              <ActionB />
            </ErrorBoundary>
          </div>
          <div>
            <ErrorBoundary>
              <ActionC />
            </ErrorBoundary>
          </div>
        </>,
      );
    });
    assertLog(['Pending A: false', 'Pending B: false', 'Pending C: false']);
    expect(root).toMatchRenderedOutput(
      <>
        <div>Pending A: false</div>
        <div>Pending B: false</div>
        <div>Pending C: false</div>
      </>,
    );

    // 启动一组嵌套纠缠 action：A/C 抛错，B 应成功完成，各错误只进入自己的边界。
    await act(() => {
      startTransitionC(async () => {
        startTransitionB(async () => {
          startTransitionA(async () => {
            await getText('Wait for A');
            throw new Error('Oops A!');
          });
          await getText('Wait for B');
        });
        await getText('Wait for C');
        throw new Error('Oops C!');
      });
    });
    assertLog(['Pending A: true', 'Pending B: true', 'Pending C: true']);

    // 完成 A；因仍与 B/C 纠缠，暂不能提交结果。
    await act(() => resolveText('Wait for A'));
    assertLog([]);

    // 完成 B；同样等待最后的 C。
    await act(() => resolveText('Wait for B'));
    assertLog([]);

    // 完成纠缠集合中的最后一个 C，此时允许渲染。
    await act(() => resolveText('Wait for C'));
    assertLog([
      // A/C 分别产生错误，B 不受影响。
      'Oops A!',
      'Pending B: false',
      'Oops C!',

      // 出现错误后 React 会再尝试一次错误边界渲染。
      'Oops A!',
      'Pending B: false',
      'Oops C!',
    ]);
    expect(root).toMatchRenderedOutput(
      <>
        <div>Oops A!</div>
        <div>Pending B: false</div>
        <div>Oops C!</div>
      </>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定 canonical A 与 optimistic pending=false；当 transition 乐观设为
   * true 并渲染挂起 B；那么立即显示 true+A，transition render 自动回退 optimistic 值，B 完成后
   * 提交 false+B。对应机制：useOptimistic update 绑定 transition 生命周期。
   */
  it('useOptimistic can be used to implement a pending state', async () => {
    const startTransition = React.startTransition;

    let setIsPending;
    /** 用乐观布尔值显示 pending，同时读取由 props 控制的异步文本。 */
    function App({text}) {
      const [isPending, _setIsPending] = useOptimistic(false);
      setIsPending = _setIsPending;
      return (
        <>
          <Text text={'Pending: ' + isPending} />
          <AsyncText text={text} />
        </>
      );
    }

    // 初次渲染 canonical A。
    const root = ReactNoop.createRoot();
    resolveText('A');
    await act(() => root.render(<App text="A" />));
    assertLog(['Pending: false', 'A']);
    expect(root).toMatchRenderedOutput('Pending: falseA');

    // 启动 transition 并立即加入乐观 pending 更新。
    await act(() =>
      startTransition(() => {
        setIsPending(true);
        root.render(<App text="B" />);
      }),
    );
    assertLog([
      // 立即渲染乐观 pending 状态。
      'Pending: true',
      'A',

      // 随后尝试 transition；其 render 会自动回退乐观状态。
      'Pending: false',
      'Suspend! [B]',
    ]);

    // 完成 transition 的异步文本。
    await act(() => resolveText('B'));
    assertLog([
      // canonical 结果携带已回退的 pending=false。
      'Pending: false',
      'B',
    ]);
  });

  /**
   * 场景（Given–When–Then）：给定购物车 canonical 长度 1、B 的乐观加一尚未完成；当外部同步
   * 插入 C 使 passthrough 变 2；那么 pending update 重放在新基线上得到 3，B 完成后 canonical
   * 仍为 3。对应机制：useOptimistic base queue rebase。
   */
  it('useOptimistic rebases pending updates on top of passthrough value', async () => {
    let serverCart = ['A'];

    /** 等待服务器确认后更新 canonical cart，并在 transition 中重新渲染根。 */
    async function submitNewItem(item) {
      await getText('Adding item ' + item);
      serverCart = [...serverCart, item];
      React.startTransition(() => {
        root.render(<App cart={serverCart} />);
      });
    }

    let addItemToCart;
    /** 展示 canonical items，并在其长度上叠加未完成的乐观加一。 */
    function App({cart}) {
      const [isPending, startTransition] = useTransition();

      const savedCartSize = cart.length;
      const [optimisticCartSize, setOptimisticCartSize] =
        useOptimistic(savedCartSize);

      /** 开始等待服务器确认的 action；先写乐观长度，再由 submitNewItem 更新 canonical cart。 */
      addItemToCart = item => {
        startTransition(async () => {
          setOptimisticCartSize(n => n + 1);
          await submitNewItem(item);
        });
      };

      return (
        <>
          <div>
            <Text text={'Pending: ' + isPending} />
          </div>
          <div>
            <Text text={'Items in cart: ' + optimisticCartSize} />
          </div>
          <ul>
            {cart.map(item => (
              <li key={item}>
                <Text text={'Item ' + item} />
              </li>
            ))}
          </ul>
        </>
      );
    }

    // 初次渲染只有 A。
    const root = ReactNoop.createRoot();
    await act(() => root.render(<App cart={serverCart} />));
    assertLog(['Pending: false', 'Items in cart: 1', 'Item A']);
    expect(root).toMatchRenderedOutput(
      <>
        <div>Pending: false</div>
        <div>Items in cart: 1</div>
        <ul>
          <li>Item A</li>
        </ul>
      </>,
    );

    // B 尚未写入 canonical cart，乐观长度已先加一。
    await act(() => addItemToCart('B'));
    assertLog(['Pending: true', 'Items in cart: 2', 'Item A']);
    expect(root).toMatchRenderedOutput(
      <>
        <div>Pending: true</div>
        <div>Items in cart: 2</div>
        <ul>
          <li>Item A</li>
        </ul>
      </>,
    );

    // B 仍 pending 时，C 通过 action 外渠道加入 canonical cart。
    serverCart = [...serverCart, 'C'];
    // C 用 flushSync 进入独立紧急 lane，保证 B 的 async action 尚未结束时就更新 passthrough；transition 更新会受到当前 action scope 的纠缠约束。
    ReactNoop.flushSync(() => root.render(<App cart={serverCart} />));
    assertLog([
      'Pending: true',
      // pending 乐观更新已在新 passthrough 上重放，所以长度仍正确。
      'Items in cart: 3',
      'Item A',
      'Item C',
    ]);
    expect(root).toMatchRenderedOutput(
      <>
        <div>Pending: true</div>
        <div>Items in cart: 3</div>
        <ul>
          <li>Item A</li>
          <li>Item C</li>
        </ul>
      </>,
    );

    // 完成 B；乐观状态回退并由 canonical cart 接管。
    await act(() => resolveText('Adding item B'));
    assertLog([
      'Pending: false',
      'Items in cart: 3',
      'Item A',
      'Item C',
      'Item B',
    ]);
    expect(root).toMatchRenderedOutput(
      <>
        <div>Pending: false</div>
        <div>Items in cart: 3</div>
        <ul>
          <li>Item A</li>
          <li>Item C</li>
          <li>Item B</li>
        </ul>
      </>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定没有 pending transition、也未调用 optimistic setter；当 canonical
   * 从 0 更新为 1；那么 optimistic 返回值同步变 1。对应机制：空 base queue 始终透传最新输入。
   */
  it(
    'regression: when there are no pending transitions, useOptimistic should ' +
      'always return the passthrough value',
    async () => {
      let setCanonicalState;
      /** 并列输出 canonical 与无 pending update 的 optimistic 透传值。 */
      function App() {
        const [canonicalState, _setCanonicalState] = useState(0);
        const [optimisticState] = useOptimistic(canonicalState);
        setCanonicalState = _setCanonicalState;

        return (
          <>
            <div>
              <Text text={'Canonical: ' + canonicalState} />
            </div>
            <div>
              <Text text={'Optimistic: ' + optimisticState} />
            </div>
          </>
        );
      }

      const root = ReactNoop.createRoot();
      await act(() => root.render(<App />));
      assertLog(['Canonical: 0', 'Optimistic: 0']);
      expect(root).toMatchRenderedOutput(
        <>
          <div>Canonical: 0</div>
          <div>Optimistic: 0</div>
        </>,
      );

      // 即使没有 transition 或 optimistic setter，canonical 更新也必须同步透传。
      await act(() => setCanonicalState(1));
      assertLog(['Canonical: 1', 'Optimistic: 1']);
      expect(root).toMatchRenderedOutput(
        <>
          <div>Canonical: 1</div>
          <div>Optimistic: 1</div>
        </>,
      );
    },
  );

  /**
   * 场景（Given–When–Then）：给定 useOptimistic 是首个 hook 且已有 pending update，后续 state
   * 在 render 中镜像它；当乐观值变 1；那么重渲染循环稳定输出 1，不破坏 hook 队列。
   * 对应机制：render-phase update 重放时保留 optimistic base/pending queues。
   */
  it('regression: useOptimistic during setState-in-render', async () => {
    // 首个 Hook 已有 pending optimistic update，后续 state Hook 又触发 render-phase 更新；
    // rerender 必须在新 passthrough 上重放乐观队列，而不是忽略这个首槽。

    let setOptimisticState;
    let startTransition;
    /** 先读取 optimistic 队列，再以 render-phase state 镜像其结果。 */
    function App() {
      const [optimisticState, _setOptimisticState] = useOptimistic(0);
      setOptimisticState = _setOptimisticState;
      const [, _startTransition] = useTransition();
      startTransition = _startTransition;

      const [derivedState, setDerivedState] = useState(0);
      if (derivedState !== optimisticState) {
        setDerivedState(optimisticState);
      }

      return <Text text={optimisticState} />;
    }

    const root = ReactNoop.createRoot();
    await act(() => root.render(<App />));
    assertLog([0]);
    expect(root).toMatchRenderedOutput('0');

    await act(() => {
      startTransition(async () => {
        setOptimisticState(1);
        await getText('Wait');
      });
    });
    assertLog([1]);
    expect(root).toMatchRenderedOutput('1');
  });

  /**
   * 场景（Given–When–Then）：给定自定义 reducer 以 item 名称记录并把购物车长度加一；当 B pending
   * 期间 canonical 又加入 C；那么 reducer 在新基线上重放并保持长度 3，B 完成后 canonical 接管。
   * 对应机制：乐观 action payload 与 reducer 在每次 rebase 时重新计算。
   */
  it('useOptimistic accepts a custom reducer', async () => {
    let serverCart = ['A'];

    /** 等待服务器确认后写入 canonical cart 并 transition 重渲染。 */
    async function submitNewItem(item) {
      await getText('Adding item ' + item);
      serverCart = [...serverCart, item];
      React.startTransition(() => {
        root.render(<App cart={serverCart} />);
      });
    }

    let addItemToCart;
    /** 用自定义 optimistic reducer 维护预测长度，同时展示 canonical items。 */
    function App({cart}) {
      const [isPending, startTransition] = useTransition();

      const savedCartSize = cart.length;
      const [optimisticCartSize, addToOptimisticCart] = useOptimistic(
        savedCartSize,
        (prevSize, newItem) => {
          Scheduler.log('Increment optimistic cart size for ' + newItem);
          return prevSize + 1;
        },
      );

      /** 开始等待服务器确认的 action；先写乐观长度，再由 submitNewItem 更新 canonical cart。 */
      addItemToCart = item => {
        startTransition(async () => {
          addToOptimisticCart(item);
          await submitNewItem(item);
        });
      };

      return (
        <>
          <div>
            <Text text={'Pending: ' + isPending} />
          </div>
          <div>
            <Text text={'Items in cart: ' + optimisticCartSize} />
          </div>
          <ul>
            {cart.map(item => (
              <li key={item}>
                <Text text={'Item ' + item} />
              </li>
            ))}
          </ul>
        </>
      );
    }

    // 初次渲染只有 A。
    const root = ReactNoop.createRoot();
    await act(() => root.render(<App cart={serverCart} />));
    assertLog(['Pending: false', 'Items in cart: 1', 'Item A']);
    expect(root).toMatchRenderedOutput(
      <>
        <div>Pending: false</div>
        <div>Items in cart: 1</div>
        <ul>
          <li>Item A</li>
        </ul>
      </>,
    );

    // B 尚未写入 canonical cart，自定义 reducer 已先把乐观长度加一。
    await act(() => addItemToCart('B'));
    assertLog([
      'Increment optimistic cart size for B',
      'Pending: true',
      'Items in cart: 2',
      'Item A',
    ]);
    expect(root).toMatchRenderedOutput(
      <>
        <div>Pending: true</div>
        <div>Items in cart: 2</div>
        <ul>
          <li>Item A</li>
        </ul>
      </>,
    );

    // B 仍 pending 时，C 通过 action 外渠道加入 canonical cart。
    serverCart = [...serverCart, 'C'];
    // C 用 flushSync 进入独立紧急 lane，保证 B 的 async action 尚未结束时就更新 passthrough；transition 更新会受到当前 action scope 的纠缠约束。
    ReactNoop.flushSync(() => root.render(<App cart={serverCart} />));
    assertLog([
      'Increment optimistic cart size for B',
      'Pending: true',
      // reducer 在新 passthrough 上重放 pending update，所以长度仍正确。
      'Items in cart: 3',
      'Item A',
      'Item C',
    ]);
    expect(root).toMatchRenderedOutput(
      <>
        <div>Pending: true</div>
        <div>Items in cart: 3</div>
        <ul>
          <li>Item A</li>
          <li>Item C</li>
        </ul>
      </>,
    );

    // 完成 B；乐观状态回退并由 canonical cart 接管。
    await act(() => resolveText('Adding item B'));
    assertLog([
      'Pending: false',
      'Items in cart: 3',
      'Item A',
      'Item C',
      'Item B',
    ]);
    expect(root).toMatchRenderedOutput(
      <>
        <div>Pending: false</div>
        <div>Items in cart: 3</div>
        <ul>
          <li>Item A</li>
          <li>Item C</li>
          <li>Item B</li>
        </ul>
      </>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定 count=0 上有乐观 +1，外部更新 count=1 又在 render 中推进到 2；
   * 当重渲染；那么 pending update 重放在最终 passthrough 2 上得到 3，action 完成后 canonical 为 3。
   * 对应机制：render-phase update 后重建 optimistic base state。
   */
  it('useOptimistic rebases if the passthrough is updated during a render phase update', async () => {
    // 这是较少见、难以对应真实产品的组合，但 hook 队列仍应保持一致。
    let increment;
    let setCount;
    /** 在 render-phase 纠正 count=1→2，并把乐观 +1 重放到纠正后的值。 */
    function App() {
      const [isPending, startTransition] = useTransition(2);
      const [count, _setCount] = useState(0);
      setCount = _setCount;

      const [optimisticCount, setOptimisticCount] = useOptimistic(
        count,
        prev => {
          Scheduler.log('Increment optimistic count');
          return prev + 1;
        },
      );

      if (count === 1) {
        Scheduler.log('Render phase update count from 1 to 2');
        setCount(2);
      }

      /** action 先乐观加一，等待资源后用独立 transition 提交 canonical 加一；render-phase 校正会重放乐观 reducer。 */
      increment = () =>
        startTransition(async () => {
          setOptimisticCount(n => n + 1);
          await getText('Wait to increment');
          React.startTransition(() => setCount(n => n + 1));
        });

      return (
        <>
          <div>
            <Text text={'Count: ' + count} />
          </div>
          {isPending ? (
            <div>
              <Text text={'Optimistic count: ' + optimisticCount} />
            </div>
          ) : null}
        </>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => root.render(<App />));
    assertLog(['Count: 0']);
    expect(root).toMatchRenderedOutput(<div>Count: 0</div>);

    await act(() => increment());
    assertLog([
      'Increment optimistic count',
      'Count: 0',
      'Optimistic count: 1',
    ]);
    expect(root).toMatchRenderedOutput(
      <>
        <div>Count: 0</div>
        <div>Optimistic count: 1</div>
      </>,
    );

    await act(() => setCount(1));
    assertLog([
      'Increment optimistic count',
      'Render phase update count from 1 to 2',
      // 乐观更新在新的 passthrough 值上重新计算。
      'Increment optimistic count',
      'Count: 2',
      'Optimistic count: 3',
    ]);
    expect(root).toMatchRenderedOutput(
      <>
        <div>Count: 2</div>
        <div>Optimistic count: 3</div>
      </>,
    );

    // 完成 action，使 canonical 更新接管。
    await act(() => resolveText('Wait to increment'));
    assertLog(['Count: 3']);
    expect(root).toMatchRenderedOutput(<div>Count: 3</div>);
  });

  /**
   * 场景（Given–When–Then）：给定初次挂载 count=0 且 render-phase 立即设为 1；当 useOptimistic
   * 与该状态同轮重放；那么 canonical/optimistic 都为 1。对应机制：mount rerender dispatcher
   * 必须更新 optimistic passthrough。
   */
  it('useOptimistic rebases if the passthrough is updated during a render phase update (initial mount)', async () => {
    // 这是少见的初次挂载 render-phase 更新组合，但两个 hook 的值仍需一致。
    /** 首挂时把 count 由 0 修正为 1，并并列输出 passthrough 与 optimistic 值。 */
    function App() {
      const [count, setCount] = useState(0);
      const [optimisticCount] = useOptimistic(count);

      if (count === 0) {
        Scheduler.log('Render phase update count from 1 to 2');
        setCount(1);
      }

      return (
        <>
          <div>
            <Text text={'Count: ' + count} />
          </div>
          <div>
            <Text text={'Optimistic count: ' + optimisticCount} />
          </div>
        </>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => root.render(<App />));
    assertLog([
      'Render phase update count from 1 to 2',
      'Count: 1',
      'Optimistic count: 1',
    ]);
    expect(root).toMatchRenderedOutput(
      <>
        <div>Count: 1</div>
        <div>Optimistic count: 1</div>
      </>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定同一 async action 在两个 await 前后把乐观进度从 25% 更新到 75%；
   * 当每个间隙完成；那么进度可多次即时提交，action 结束后乐观 UI 消失并显示 canonical B。
   * 对应机制：同一 action scope 允许多条 optimistic update 逐次可见。
   */
  it('useOptimistic can update repeatedly in the same async action', async () => {
    let startTransition;
    let setLoadingProgress;
    let setText;
    /** 显示可重复更新的乐观进度和 canonical 文本。 */
    function App() {
      const [, _startTransition] = useTransition();
      const [text, _setText] = useState('A');
      const [loadingProgress, _setLoadingProgress] = useOptimistic(0);
      startTransition = _startTransition;
      setText = _setText;
      setLoadingProgress = _setLoadingProgress;

      return (
        <>
          {loadingProgress !== 0 ? (
            <div key="progress">
              <Text text={`Loading... (${loadingProgress})`} />
            </div>
          ) : null}
          <div key="real">
            <Text text={text} />
          </div>
        </>
      );
    }

    // 初次渲染 canonical A。
    const root = ReactNoop.createRoot();
    await act(() => root.render(<App />));
    assertLog(['A']);
    expect(root).toMatchRenderedOutput(<div>A</div>);

    await act(async () => {
      startTransition(async () => {
        setLoadingProgress('25%');
        await getText('Wait 1');
        setLoadingProgress('75%');
        await getText('Wait 2');
        startTransition(() => setText('B'));
      });
    });
    assertLog(['Loading... (25%)', 'A']);
    expect(root).toMatchRenderedOutput(
      <>
        <div>Loading... (25%)</div>
        <div>A</div>
      </>,
    );

    await act(() => resolveText('Wait 1'));
    assertLog(['Loading... (75%)', 'A']);
    expect(root).toMatchRenderedOutput(
      <>
        <div>Loading... (75%)</div>
        <div>A</div>
      </>,
    );

    await act(() => resolveText('Wait 2'));
    assertLog(['B']);
    expect(root).toMatchRenderedOutput(<div>B</div>);
  });

  /**
   * 场景（Given–When–Then）：给定 optimistic setter 在任何 action/transition 外调用；当随后另有
   * transition 更新文本；那么开发环境发出固定警告，乐观状态短暂渲染后由 B 覆盖。
   * 对应机制：dispatchOptimisticSetState 检查当前 transition 上下文。
   */
  it('useOptimistic warns if outside of a transition', async () => {
    let startTransition;
    let setLoadingProgress;
    let setText;
    /** 显示乐观进度和 canonical 文本，并暴露两类更新器。 */
    function App() {
      const [, _startTransition] = useTransition();
      const [text, _setText] = useState('A');
      const [loadingProgress, _setLoadingProgress] = useOptimistic(0);
      startTransition = _startTransition;
      setText = _setText;
      setLoadingProgress = _setLoadingProgress;

      return (
        <>
          {loadingProgress !== 0 ? (
            <div key="progress">
              <Text text={`Loading... (${loadingProgress})`} />
            </div>
          ) : null}
          <div key="real">
            <Text text={text} />
          </div>
        </>
      );
    }

    // 初次渲染 canonical A。
    const root = ReactNoop.createRoot();
    await act(() => root.render(<App />));
    assertLog(['A']);
    expect(root).toMatchRenderedOutput(<div>A</div>);

    await act(() => {
      setLoadingProgress('25%');
      startTransition(() => setText('B'));
    });
    assertConsoleErrorDev([
      'An optimistic state update occurred outside a transition or ' +
        'action. To fix, move the update to an action, or wrap ' +
        'with startTransition.',
    ]);
    assertLog(['Loading... (25%)', 'A', 'B']);
    expect(root).toMatchRenderedOutput(<div>B</div>);
  });

  /**
   * 场景（Given–When–Then）：给定 Updater 启动 action，Sibling 显示 C 的乐观值且 canonical B/C
   * 更新被纠缠；当 action 尚未结束就卸载 Updater；那么乐观 C 不提前回退，action 完成后才切 canonical C。
   * 对应机制：optimistic revert 绑定 action scope，而非 useTransition Fiber 生命周期。
   */
  it(
    'optimistic state is not reverted until async action finishes, even if ' +
      'useTransition hook is unmounted',
    async () => {
      let startTransition;
      /** 持有 useTransition hook 并显示 pending；测试中会在 action 期间卸载。 */
      function Updater() {
        const [isPending, _start] = useTransition();
        startTransition = _start;
        return (
          <span>
            <Text text={'Pending: ' + isPending} />
          </span>
        );
      }

      let setText;
      let setOptimisticText;
      /** 在独立 Fiber 中维护 canonical/optimistic 文本，跨 Updater 卸载继续存在。 */
      function Sibling() {
        const [canonicalText, _setText] = useState('A');
        setText = _setText;

        const [text, _setOptimisticText] = useOptimistic(
          canonicalText,
          (_, optimisticText) => `${optimisticText} (loading...)`,
        );
        setOptimisticText = _setOptimisticText;

        return (
          <span>
            <Text text={text} />
          </span>
        );
      }

      /** 可删除 action 发起者，同时始终保留状态消费者 Sibling。 */
      function App({showUpdater}) {
        return (
          <>
            {showUpdater ? <Updater /> : null}
            <Sibling />
          </>
        );
      }

      const root = ReactNoop.createRoot();
      await act(() => {
        root.render(<App showUpdater={true} />);
      });
      assertLog(['Pending: false', 'A']);
      expect(root).toMatchRenderedOutput(
        <>
          <span>Pending: false</span>
          <span>A</span>
        </>,
      );

      // 启动含多个更新和异步间隙的 action。
      await act(() => {
        startTransition(async () => {
          Scheduler.log('Async action started');

          setOptimisticText('C');

          startTransition(() => setText('B'));

          await getText('Wait before updating to C');

          Scheduler.log('Async action ended');
          startTransition(() => setText('C'));
        });
      });
      assertLog([
        'Async action started',
        'Pending: true',
        // 立即渲染乐观值。
        'C (loading...)',
      ]);
      expect(root).toMatchRenderedOutput(
        <>
          <span>Pending: true</span>
          <span>C (loading...)</span>
        </>,
      );

      // 删除 useTransition 所在组件；它不再阻塞 transition，但 action 未结束，乐观状态仍保留。
      await act(() => {
        root.render(<App showUpdater={false} />);
      });
      assertLog(['C (loading...)']);
      expect(root).toMatchRenderedOutput(<span>C (loading...)</span>);

      // 结束 action；此时回退乐观状态并切换 canonical 值。
      await act(() => resolveText('Wait before updating to C'));
      assertLog(['Async action ended', 'C']);
      expect(root).toMatchRenderedOutput(<span>C</span>);
    },
  );

  /**
   * 场景（Given–When–Then）：给定 Updater 发起 action，Sibling 的 B/C 函数组件 state 更新属于同一
   * scope；当 action 中途卸载 Updater；那么 B 仍不能先提交，结束后直接 A→C。
   * 对应机制：action 更新纠缠保存在根/队列上，不依赖发起 hook 存活。
   */
  it(
    'updates in an async action are entangled even if useTransition hook ' +
      'is unmounted before it finishes',
    async () => {
      let startTransition;
      /** 持有即将被卸载的 useTransition hook。 */
      function Updater() {
        const [isPending, _start] = useTransition();
        startTransition = _start;
        return (
          <span>
            <Text text={'Pending: ' + isPending} />
          </span>
        );
      }

      let setText;
      /** 维护 action 要更新的函数组件 state。 */
      function Sibling() {
        const [text, _setText] = useState('A');
        setText = _setText;
        return (
          <span>
            <Text text={text} />
          </span>
        );
      }

      /** 可卸载 Updater，但保持 Sibling 更新队列挂载。 */
      function App({showUpdater}) {
        return (
          <>
            {showUpdater ? <Updater /> : null}
            <Sibling />
          </>
        );
      }

      const root = ReactNoop.createRoot();
      await act(() => {
        root.render(<App showUpdater={true} />);
      });
      assertLog(['Pending: false', 'A']);
      expect(root).toMatchRenderedOutput(
        <>
          <span>Pending: false</span>
          <span>A</span>
        </>,
      );

      // 启动含 B/C 更新和异步间隙的 action。
      await act(() => {
        startTransition(async () => {
          Scheduler.log('Async action started');
          startTransition(() => setText('B'));

          await getText('Wait before updating to C');

          Scheduler.log('Async action ended');
          startTransition(() => setText('C'));
        });
      });
      assertLog(['Async action started', 'Pending: true']);
      expect(root).toMatchRenderedOutput(
        <>
          <span>Pending: true</span>
          <span>A</span>
        </>,
      );

      // 删除 useTransition 所在组件；Sibling 的 pending B 仍属于 action，不得提前提交。
      await act(() => {
        root.render(<App showUpdater={false} />);
      });
      assertLog(['A']);
      expect(root).toMatchRenderedOutput(<span>A</span>);

      // 结束 action；B 与后续 C 批处理，因此从未显示中间 B。
      await act(() => resolveText('Wait before updating to C'));
      assertLog(['Async action ended', 'C']);
      expect(root).toMatchRenderedOutput(<span>C</span>);
    },
  );

  /**
   * 场景（Given–When–Then）：给定与上一用例相同流程，但 Sibling 使用类 setState；当发起 hook
   * 卸载后 action 完成；那么同样跳过 B、提交 C，随后独立 D 更新仍正常。
   * 对应机制：类 update queue 与 hooks queue 共享 action entanglement 规则。
   */
  it(
    'updates in an async action are entangled even if useTransition hook ' +
      'is unmounted before it finishes (class component)',
    async () => {
      let startTransition;
      /** 持有即将被卸载的 useTransition hook。 */
      function Updater() {
        const [isPending, _start] = useTransition();
        startTransition = _start;
        return (
          <span>
            <Text text={'Pending: ' + isPending} />
          </span>
        );
      }

      let setText;
      /** 用类 update queue 接收 action 内 B/C 与之后的 D 更新。 */
      class Sibling extends React.Component {
        /** 当前 canonical 文本。 */
        state = {text: 'A'};
        /** 暴露 setState 适配器并显示当前文本。 */
        render() {
          /** 把文本值适配为类 setState payload，供同一 action 的 B/C 与之后普通 D 更新使用。 */
          setText = text => this.setState({text});
          return (
            <span>
              <Text text={this.state.text} />
            </span>
          );
        }
      }

      /** 可卸载 Updater，但保持类 Sibling 队列挂载。 */
      function App({showUpdater}) {
        return (
          <>
            {showUpdater ? <Updater /> : null}
            <Sibling />
          </>
        );
      }

      const root = ReactNoop.createRoot();
      await act(() => {
        root.render(<App showUpdater={true} />);
      });
      assertLog(['Pending: false', 'A']);
      expect(root).toMatchRenderedOutput(
        <>
          <span>Pending: false</span>
          <span>A</span>
        </>,
      );

      // 启动含 B/C 类更新和异步间隙的 action。
      await act(() => {
        startTransition(async () => {
          Scheduler.log('Async action started');
          startTransition(() => setText('B'));

          await getText('Wait before updating to C');

          Scheduler.log('Async action ended');
          startTransition(() => setText('C'));
        });
      });
      assertLog(['Async action started', 'Pending: true']);
      expect(root).toMatchRenderedOutput(
        <>
          <span>Pending: true</span>
          <span>A</span>
        </>,
      );

      // 删除 useTransition 所在组件；类 Sibling 的 pending B 仍不得提前提交。
      await act(() => {
        root.render(<App showUpdater={false} />);
      });
      assertLog(['A']);
      expect(root).toMatchRenderedOutput(<span>A</span>);

      // 结束 action；B 与后续 C 批处理，因此从未显示中间 B。
      await act(() => resolveText('Wait before updating to C'));
      assertLog(['Async action ended', 'C']);
      expect(root).toMatchRenderedOutput(<span>C</span>);

      // action 结束后的普通 D 更新不受残留纠缠影响。
      await act(() => setText('D'));
      assertLog(['D']);
      expect(root).toMatchRenderedOutput(<span>D</span>);
    },
  );

  /**
   * 场景（Given–When–Then）：给定 action 内两次 `root.render` 到 B/C，Updater 自己由 App state
   * 中途卸载；当 action 完成；那么根更新仍纠缠、跳过 B 直接提交 C，之后 D 可独立提交。
   * 对应机制：HostRoot update queue 的 action lane 不依赖发起 hook。
   */
  it(
    'updates in an async action are entangled even if useTransition hook ' +
      'is unmounted before it finishes (root update)',
    async () => {
      let startTransition;
      /** 持有即将被 App state 卸载的 useTransition hook。 */
      function Updater() {
        const [isPending, _start] = useTransition();
        startTransition = _start;
        return (
          <span>
            <Text text={'Pending: ' + isPending} />
          </span>
        );
      }

      let setShowUpdater;
      /** 内部控制 Updater 存活，并显示由根 props 驱动的文本。 */
      function App({text}) {
        const [showUpdater, _setShowUpdater] = useState(true);
        setShowUpdater = _setShowUpdater;
        return (
          <>
            {showUpdater ? <Updater /> : null}
            <span>
              <Text text={text} />
            </span>
          </>
        );
      }

      const root = ReactNoop.createRoot();
      await act(() => {
        root.render(<App text="A" />);
      });
      assertLog(['Pending: false', 'A']);
      expect(root).toMatchRenderedOutput(
        <>
          <span>Pending: false</span>
          <span>A</span>
        </>,
      );

      // 启动含 B/C 根更新和异步间隙的 action。
      await act(() => {
        startTransition(async () => {
          Scheduler.log('Async action started');
          startTransition(() => root.render(<App text="B" />));

          await getText('Wait before updating to C');

          Scheduler.log('Async action ended');
          startTransition(() => root.render(<App text="C" />));
        });
      });
      assertLog(['Async action started', 'Pending: true']);
      expect(root).toMatchRenderedOutput(
        <>
          <span>Pending: true</span>
          <span>A</span>
        </>,
      );

      // 卸载 useTransition 所在组件；pending 根更新仍属于 action，不得提前提交。
      await act(() => setShowUpdater(false));
      assertLog(['A']);
      expect(root).toMatchRenderedOutput(<span>A</span>);

      // 结束 action；B 与后续 C 批处理，因此从未显示中间 B。
      await act(() => resolveText('Wait before updating to C'));
      assertLog(['Async action ended', 'C']);
      expect(root).toMatchRenderedOutput(<span>C</span>);

      // action 结束后的普通根更新 D 不受残留纠缠影响。
      await act(() => root.render(<App text="D" />));
      assertLog(['D']);
      expect(root).toMatchRenderedOutput(<span>D</span>);
    },
  );

  /**
   * 场景（Given–When–Then）：给定非 hook `React.startTransition` action 在 await 前更新 B、后更新 C；
   * 当 action 未完成；那么等待期间 B 被阻塞，结束后只观察到 C。await 后的 root.render(C) 未再包 startTransition，本例不证明其请求 lane 仍是 transition。
   * 对应机制：全局 startTransition 也创建 async action scope 并纠缠其更新。
   */
  it('React.startTransition supports async actions', async () => {
    const startTransition = React.startTransition;

    /** 显示根传入文本，暴露 B/C 是否出现中间提交。 */
    function App({text}) {
      return <Text text={text} />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App text="A" />);
    });
    assertLog(['A']);

    await act(() => {
      startTransition(async () => {
        // 先更新到 B。
        root.render(<App text="B" />);

        // 更新 C 前制造异步间隙。
        await getText('Wait before updating to C');
        root.render(<App text="C" />);

        Scheduler.log('Async action ended');
      });
    });
    // action 尚未完成，B 更新被阻塞。
    assertLog([]);
    expect(root).toMatchRenderedOutput('A');

    // 完成 async action。
    await act(() => resolveText('Wait before updating to C'));

    // B/C 此时在同一批次完成，只显示最新 C。
    assertLog(['Async action ended', 'C']);
    expect(root).toMatchRenderedOutput('C');
  });

  /**
   * 场景（Given–When–Then）：给定 React.startTransition action 发出 Updated 乐观值，await 后提交
   * 同名 canonical；当等待期间与完成后；那么先显示 loading 乐观 UI，再回退为 canonical Updated。
   * 对应机制：useOptimistic 能读取全局 startTransition 建立的 action 上下文。
   */
  it('useOptimistic works with async actions passed to React.startTransition', async () => {
    const startTransition = React.startTransition;

    let setOptimisticText;
    /** 在 canonical props 上叠加带 loading 后缀的乐观文本。 */
    function App({text: canonicalText}) {
      const [text, _setOptimisticText] = useOptimistic(
        canonicalText,
        (_, optimisticText) => `${optimisticText} (loading...)`,
      );
      setOptimisticText = _setOptimisticText;
      return (
        <span>
          <Text text={text} />
        </span>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App text="Initial" />);
    });
    assertLog(['Initial']);
    expect(root).toMatchRenderedOutput(<span>Initial</span>);

    // 用非 hook startTransition 启动含乐观更新的 async action。
    await act(() => {
      startTransition(async () => {
        Scheduler.log('Async action started');
        setOptimisticText('Updated');
        await getText('Yield before updating');
        Scheduler.log('Async action ended');
        startTransition(() => root.render(<App text="Updated" />));
      });
    });
    // action 尚未完成，显示乐观 UI。
    assertLog(['Async action started', 'Updated (loading...)']);
    expect(root).toMatchRenderedOutput(<span>Updated (loading...)</span>);

    // 完成 action，回退乐观状态并由 canonical 值替换。
    await act(() => resolveText('Yield before updating'));
    assertLog(['Async action ended', 'Updated']);
    expect(root).toMatchRenderedOutput(<span>Updated</span>);
  });

  /**
   * 场景（Given–When–Then）：给定 React.startTransition action 在首个 await 之前没有任何更新，
   * await 后才发出乐观 Updated；当 action 继续等待；那么该更新仍归属外层 scope、不被立即回退，
   * 最终 canonical 到达后正常替换。对应机制：首个 await 后仍有全局 pending action scope，乐观派发从中取得 revertLane。
   */
  it(
    'regression: updates in an action passed to React.startTransition are batched ' +
      'even if there were no updates before the first await',
    async () => {
      // 同构 startTransition 调用 shared.onStartTransition，把回调结果交给 renderer 的 async action 纠缠逻辑；即使首个 await 前没有更新，pending scope 也必须存在。
      const startTransition = React.startTransition;

      let setOptimisticText;
      /** 在 canonical props 上叠加带 loading 后缀的乐观文本。 */
      function App({text: canonicalText}) {
        const [text, _setOptimisticText] = useOptimistic(
          canonicalText,
          (_, optimisticText) => `${optimisticText} (loading...)`,
        );
        setOptimisticText = _setOptimisticText;
        return (
          <span>
            <Text text={text} />
          </span>
        );
      }

      const root = ReactNoop.createRoot();
      await act(() => {
        root.render(<App text="Initial" />);
      });
      assertLog(['Initial']);
      expect(root).toMatchRenderedOutput(<span>Initial</span>);

      // 用非 hook startTransition 启动 action，但首个 await 前没有更新。
      await act(() => {
        startTransition(async () => {
          Scheduler.log('Async action started');

          // 在任何更新发生前先让出到异步任务。
          await getText('Yield before optimistic update');

          // 乐观更新发生在异步间隙后；回归实现未把它关联到外层 action，导致立即回退。
          setOptimisticText('Updated');

          await getText('Yield before updating');
          Scheduler.log('Async action ended');
          startTransition(() => root.render(<App text="Updated" />));
        });
      });
      assertLog(['Async action started']);

      // 完成第一段异步间隙并安排乐观更新。
      await act(() => resolveText('Yield before optimistic update'));

      // action 尚未完成，乐观 UI 应保持可见。
      assertLog(['Updated (loading...)']);
      expect(root).toMatchRenderedOutput(<span>Updated (loading...)</span>);

      // 完成 action，回退乐观状态并由 canonical 值替换。
      await act(() => resolveText('Yield before updating'));
      assertLog(['Async action ended', 'Updated']);
      expect(root).toMatchRenderedOutput(<span>Updated</span>);
    },
  );

  /**
   * 场景（Given–When–Then）：给定全局 startTransition 的 async 回调立即 reject Oops；当 action
   * 被 act 刷新；那么错误不抛给调用栈，而经全局 `reportError` 上报一次。
   * 对应机制：非 hook API 捕获 Promise rejection。
   */
  it('React.startTransition captures async errors and passes them to reportError', async () => {
    await act(() => {
      React.startTransition(async () => {
        throw new Error('Oops');
      });
    });
    assertLog(['reportError: Oops']);
  });

  /**
   * 场景（Given–When–Then）：给定全局 startTransition 回调同步抛出 Oops；当调用包在 try/catch；
   * 那么 catch 不可达，错误统一经 `reportError` 上报。对应机制：非 hook API 同步错误捕获。
   */
  it('React.startTransition captures sync errors and passes them to reportError', async () => {
    await act(() => {
      try {
        React.startTransition(() => {
          throw new Error('Oops');
        });
      } catch (e) {
        throw new Error('Should not be reachable.');
      }
    });
    assertLog(['reportError: Oops']);
  });

  /**
   * 场景（Given–When–Then）：给定 optimisticKey 创建临时 b 行，Item state 记住首挂文本；当 canonical
   * B 到达；那么临时 Fiber 与新行协调为同一实例，输出从 b-b 变 b-B 而非 B-B。
   * 对应机制：optimisticKey 在乐观/规范数组间转移 row identity。
   */
  // @gate enableOptimisticKey
  it('reconciles against new items when optimisticKey is used', async () => {
    const startTransition = React.startTransition;

    /** 记录首挂 text 并同时显示初始/当前文本，以检测行是否被复用。 */
    function Item({text}) {
      const [initialText] = React.useState(text);
      return <span>{initialText + '-' + text}</span>;
    }

    let addOptimisticItem;
    /** 在 canonical items 末尾追加带 `React.optimisticKey` 的临时行。 */
    function App({items}) {
      const [optimisticItems, _addOptimisticItem] = useOptimistic(
        items,
        (canonicalItems, optimisticText) =>
          canonicalItems.concat({
            id: React.optimisticKey,
            text: optimisticText,
          }),
      );
      addOptimisticItem = _addOptimisticItem;
      return (
        <div>
          {optimisticItems.map(item => (
            <Item key={item.id} text={item.text} />
          ))}
        </div>
      );
    }

    const A = {
      id: 'a',
      text: 'A',
    };

    const B = {
      id: 'b',
      text: 'B',
    };

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App items={[A]} />);
    });
    expect(root).toMatchRenderedOutput(
      <div>
        <span>A-A</span>
      </div>,
    );

    // 用非 hook startTransition 启动含临时行的 async action。
    await act(() => {
      startTransition(async () => {
        addOptimisticItem('b');
        await getText('Yield before updating');
        startTransition(() => root.render(<App items={[A, B]} />));
      });
    });
    // action 尚未完成，显示 optimistic b 行。
    expect(root).toMatchRenderedOutput(
      <div>
        <span>A-A</span>
        <span>b-b</span>
      </div>,
    );

    // 完成 action，canonical B 替换乐观行，同时把已有 Item state 转移到新行。
    await act(() => {
      resolveText('Yield before updating');
    });
    expect(root).toMatchRenderedOutput(
      <div>
        <span>A-A</span>
        <span>b-B</span>
      </div>,
    );
  });
});
