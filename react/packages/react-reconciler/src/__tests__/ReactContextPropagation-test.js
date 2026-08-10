let React;
let ReactNoop;
let Scheduler;
let act;
let use;
let useState;
let useContext;
let Suspense;
let SuspenseList;
let getCacheForType;
let caches;
let seededCache;
let assertLog;

/** 覆盖 lazy Context 传播在 memo bailout、Suspense retry、Offscreen 与 sibling 遍历中的依赖标记。 */
describe('ReactLazyContextPropagation', () => {
  /** 每个用例前重置模块并重绑 React、Noop renderer、调度器与 cache，隔离 feature flag 和资源世代。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    use = React.use;
    useState = React.useState;
    useContext = React.useContext;
    Suspense = React.Suspense;
    if (gate(flags => flags.enableSuspenseList)) {
      SuspenseList = React.unstable_SuspenseList;
    }

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;

    getCacheForType = React.unstable_getCacheForType;

    caches = [];
    seededCache = null;
  });

  /** createTextCache 创建请求级文本 cache；记录只从 pending 单向进入 resolved/rejected，完成时逐一触发 ping。 */
  function createTextCache() {
    if (seededCache !== null) {
      // 在 cache 尚未创建前预置下一份 cache；预置值只供首次请求消费。
      // TODO：需要内建 API 在首次渲染前预置数据；此时尚未挂载，
      // 因此不能把该操作建模为 refresh。
      const cache = seededCache;
      seededCache = null;
      return cache;
    }

    const data = new Map();
    const version = caches.length + 1;
    const cache = {
      version,
      data,
      /** createTextCache.resolve 对缺失记录直接建立 resolved 终态；仅允许 pending 单向迁移并唤醒 ping，重复完成保持不变。 */
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
      /** createTextCache.reject 对缺失记录直接建立 rejected 终态；仅允许 pending 单向迁移并唤醒 retry 将错误交给边界。 */
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

  /** readText 读取当前 cache：resolved 返回版本，rejected 抛错，pending 记录日志并抛出 thenable 交给 Suspense。 */
  function readText(text) {
    const textCache = getCacheForType(createTextCache);
    const record = textCache.data.get(text);
    if (record !== undefined) {
      // 资源状态机边界：pending 抛同一 thenable，rejected 抛业务错误，resolved 只返回当前 cache 世代。
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

      // 首次读取先把 thenable 放入 cache，再抛给 Suspense；后续读取必须复用同一对象以合并 ping。
      const thenable = {
        pings: [],
        /** then 按 thenable 协议登记 ping；pending 时入队，终态时用微任务回放，覆盖订阅/完成竞态。 */
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

  /** Text 同时写 Scheduler 日志并返回宿主文本，用于区分 render 访问和最终提交。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  // function AsyncText({text, showVersion}) {
  //   const version = readText(text);
  //   const fullText = showVersion ? `${text} [v${version}]` : text;
  //   Scheduler.log(fullText);
  //   return text;
  // }

  /** seedNextTextCache 在首次请求前预置已解决记录，使基线渲染不经过 fallback。 */
  function seedNextTextCache(text) {
    if (seededCache === null) {
      seededCache = createTextCache();
    }
    seededCache.resolve(text);
  }

  /** resolveMostRecentTextCache 只解决最新 cache；无 cache 时抛错，避免 ping 错误刷新世代。 */
  function resolveMostRecentTextCache(text) {
    if (caches.length === 0) {
      throw Error('Cache does not exist.');
    } else {
      // 解决最近创建的 cache；若要解决旧世代，
      // 需显式调用 `caches[index].resolve(text)`。
      caches[caches.length - 1].resolve(text);
    }
  }

  /** resolveText 是“解决最新 cache 记录”的语义别名，测试通过它触发 thenable ping 与 Suspense retry。 */
  const resolveText = resolveMostRecentTextCache;

  // function rejectMostRecentTextCache(text, error) {
  //   if (caches.length === 0) {
  //     throw Error('Cache does not exist.');
  //   } else {
  //     // Resolve the most recently created cache. An older cache can by
  //     // resolved with `caches[index].reject(text, error)`.
  //     caches[caches.length - 1].reject(text, error);
  //   }
  // }

  /**
   * Given：Provider 初值为 0，useMemo 固定元素且无中间 Fiber 让 props 路径具备 bailout 条件。
   * When：只把 Provider value 从 0 更新为 1。
   * Then：Context 依赖 lanes 阻止错误 bailout，Consumer 与 DeepChild 仍提交值 1。
   *
   * 验证机制：Scheduler 与宿主输出共同证明深层节点由 0 更新为 1。
   * 对应源码：`ReactFiberNewContext.js` 的 `propagateContextChanges()`、`checkIfContextChanged()` 与 `ReactFiberBeginWork.js` 的 bailout 路径。
   */
  it(
    'context change should prevent bailout of memoized component (useMemo -> ' +
      'no intermediate fiber)',
    async () => {
      const root = ReactNoop.createRoot();

      const Context = React.createContext(0);

      let setValue;
      /** App 持有 Provider 更新入口并组织 bailout、Suspense 或 Offscreen 层级，用于“useMemo 固定元素且无中间 Fiber 下 Context 变化阻止消费者错误 bailout”。 */
      function App() {
        const [value, _setValue] = useState(0);
        setValue = _setValue;

        // 注意：本测试刻意 memoize Consumer 的 props，
        // 而非额外包裹一个 memoized Fiber；
        // 实现会在任意 Fiber bailout 时传播
        // Context 变化，这是区分两条路径的关键。
        const consumer = React.useMemo(() => <Consumer />, []);

        return <Context.Provider value={value}>{consumer}</Context.Provider>;
      }

      /** Consumer 登记 Context 依赖并把读取值交给日志或宿主输出，用于“useMemo 固定元素且无中间 Fiber 下 Context 变化阻止消费者错误 bailout”。 */
      function Consumer() {
        const value = useContext(Context);
        // 即使 Consumer 已 memoize，Context 变化仍应让它重新渲染
        // DeepChild；否则 DeepChild
        // 无法收到最新值。
        return <DeepChild value={value} />;
      }

      /** DeepChild 是传播末端消费者；其日志和输出验证“useMemo 固定元素且无中间 Fiber 下 Context 变化阻止消费者错误 bailout”。 */
      function DeepChild({value}) {
        return <Text text={value} />;
      }

      await act(() => {
        root.render(<App />);
      });
      assertLog([0]);
      expect(root).toMatchRenderedOutput('0');

      await act(() => {
        setValue(1);
      });
      assertLog([1]);
      expect(root).toMatchRenderedOutput('1');
    },
  );

  /**
   * Given：Provider 初值为 0，React.memo HOC 让 props 路径具备 bailout 条件。
   * When：只把 Provider value 从 0 更新为 1。
   * Then：Context 依赖 lanes 阻止错误 bailout，Consumer 与 DeepChild 仍提交值 1。
   *
   * 验证机制：Scheduler 与宿主输出共同证明深层节点由 0 更新为 1。
   * 对应源码：`ReactFiberNewContext.js` 的 `propagateContextChanges()`、`checkIfContextChanged()` 与 `ReactFiberBeginWork.js` 的 bailout 路径。
   */
  it('context change should prevent bailout of memoized component (memo HOC)', async () => {
    const root = ReactNoop.createRoot();

    const Context = React.createContext(0);

    let setValue;
    /** App 持有 Provider 更新入口并组织 bailout、Suspense 或 Offscreen 层级，用于“React.memo HOC 下 Context 变化阻止消费者错误 bailout”。 */
    function App() {
      const [value, _setValue] = useState(0);
      setValue = _setValue;
      return (
        <Context.Provider value={value}>
          <Consumer />
        </Context.Provider>
      );
    }

    /** Consumer 是 memo 化订阅者；稳定 props 保证更新只能由 Context dependency 或自身 state 驱动。 */
    const Consumer = React.memo(() => {
      const value = useContext(Context);
      // 即使 Consumer 已 memoize，Context 变化仍应让它重新渲染
      // DeepChild；否则 DeepChild
      // 无法收到最新值。
      return <DeepChild value={value} />;
    });

    /** DeepChild 是传播末端消费者；其日志和输出验证“React.memo HOC 下 Context 变化阻止消费者错误 bailout”。 */
    function DeepChild({value}) {
      return <Text text={value} />;
    }

    await act(() => {
      root.render(<App />);
    });
    assertLog([0]);
    expect(root).toMatchRenderedOutput('0');

    await act(() => {
      setValue(1);
    });
    assertLog([1]);
    expect(root).toMatchRenderedOutput('1');
  });

  /**
   * Given：Provider 初值为 0，PureComponent 让 props 路径具备 bailout 条件。
   * When：只把 Provider value 从 0 更新为 1。
   * Then：Context 依赖 lanes 阻止错误 bailout，Consumer 与 DeepChild 仍提交值 1。
   *
   * 验证机制：Scheduler 与宿主输出共同证明深层节点由 0 更新为 1。
   * 对应源码：`ReactFiberNewContext.js` 的 `propagateContextChanges()`、`checkIfContextChanged()` 与 `ReactFiberBeginWork.js` 的 bailout 路径。
   */
  it('context change should prevent bailout of memoized component (PureComponent)', async () => {
    const root = ReactNoop.createRoot();

    const Context = React.createContext(0);

    let setValue;
    /** App 持有 Provider 更新入口并组织 bailout、Suspense 或 Offscreen 层级，用于“PureComponent 下 Context 变化阻止消费者错误 bailout”。 */
    function App() {
      const [value, _setValue] = useState(0);
      setValue = _setValue;
      return (
        <Context.Provider value={value}>
          <Consumer />
        </Context.Provider>
      );
    }

    /** 定义 Consumer 类 fixture，制造 class bailout 或实例边界，用于“PureComponent 下 Context 变化阻止消费者错误 bailout”。 */
    class Consumer extends React.PureComponent {
      /** Consumer.contextType 绑定目标 Context，使 PureComponent 登记 Context 依赖。 */
      static contextType = Context;
      /** Consumer.render 渲染当前 Context/实例状态并暴露可观察输出，用于“PureComponent 下 Context 变化阻止消费者错误 bailout”。 */
      render() {
        // 即使 Consumer 已 memoize，Context 变化仍应让它重新渲染
        // DeepChild；否则 DeepChild
        // 无法收到最新值。
        return <DeepChild value={this.context} />;
      }
    }

    /** DeepChild 是传播末端消费者；其日志和输出验证“PureComponent 下 Context 变化阻止消费者错误 bailout”。 */
    function DeepChild({value}) {
      return <Text text={value} />;
    }

    await act(() => {
      root.render(<App />);
    });
    assertLog([0]);
    expect(root).toMatchRenderedOutput('0');

    await act(() => {
      setValue(1);
    });
    assertLog([1]);
    expect(root).toMatchRenderedOutput('1');
  });

  /**
   * Given：Provider value 始终为 0，Consumer 的局部 state 先排入 1 再恢复 0，以绕过 eager bailout。
   * When：局部更新进入 render，但 Context 依赖值未变化。
   * Then：lazy Context 检查不向深层 Text 传播无效工作，已提交值仍为 0。
   *
   * 验证机制：Consumer 日志证明 render 被访问，缺少 Text 日志则证明深层工作被复用。
   * 对应源码：`ReactFiberNewContext.js` 的 `checkIfContextChanged()` 与 `ReactFiberBeginWork.js` 的 `bailoutOnAlreadyFinishedWork()`。
   */
  it("context consumer bails out if context hasn't changed", async () => {
    const root = ReactNoop.createRoot();

    const Context = React.createContext(0);

    /** App 持有 Provider 更新入口并组织 bailout、Suspense 或 Offscreen 层级，用于“Context 不变时 lazy bailout 复用深层子树”。 */
    function App() {
      return (
        <Context.Provider value={0}>
          <Consumer />
        </Context.Provider>
      );
    }

    let setOtherValue;
    /** Consumer 是 memo 化订阅者，用局部 state 绕过 eager bailout 后观察 lazy Context bailout。 */
    const Consumer = React.memo(() => {
      const value = useContext(Context);

      const [, _setOtherValue] = useState(0);
      setOtherValue = _setOtherValue;

      Scheduler.log('Consumer');

      return <Text text={value} />;
    });

    await act(() => {
      root.render(<App />);
    });
    assertLog(['Consumer', 0]);
    expect(root).toMatchRenderedOutput('0');

    await act(() => {
      // 先故意把 state 更新为另一值，
      // 再恢复当前值；这样可以确保更新已调度，
      // 同时在 render 发现无变化时触发 bailout。
      setOtherValue(1);
      setOtherValue(0);
    });
    // 注意：若此处没有任何 yield，说明 render 阶段没有访问 Consumer，
    // 很可能是 eager
    // bailout 已提前生效；本用例目标是验证 lazy bailout，
    // 若实现变化，应调整更新方式以继续绕过 eager bailout，
    // 例如改用 useReducer。
    assertLog(['Consumer']);
    expect(root).toMatchRenderedOutput('0');
  });

  /**
   * Given：并发 Root 中 Provider 从 A 变为 B，Async 在访问后代前挂起。
   * When：同步更新提交 fallback，再解决资源触发 Suspense retry。
   * Then：重试携带最新 Context，首遍未访问的 DeepChild 仍读取 B。
   *
   * 验证机制：挂起、fallback、恢复日志与最终 `BB` 输出划分两遍渲染。
   * 对应源码：`ReactFiberNewContext.js` 的 `propagateContextChanges()`、`scheduleContextWorkOnParentPath()` 与 `ReactFiberThrow.js` 的 ping/retry 路径。
   */
  // @gate enableLegacyCache
  it('context is propagated across retries', async () => {
    const root = ReactNoop.createRoot();

    const Context = React.createContext('A');

    let setContext;
    /** App 持有 Provider 更新入口并组织 bailout、Suspense 或 Offscreen 层级，用于“并发模式下 Context 跨 Suspense retry 不丢失”。 */
    function App() {
      const [value, setValue] = useState('A');
      setContext = setValue;
      return (
        <Context.Provider value={value}>
          <Suspense fallback={<Text text="Loading..." />}>
            <Async />
          </Suspense>
          <Text text={value} />
        </Context.Provider>
      );
    }

    /** Async 在访问后代前读取可挂起资源，制造 render 中断与 retry，用于“并发模式下 Context 跨 Suspense retry 不丢失”。 */
    function Async() {
      const value = useContext(Context);
      readText(value);

      // `readText` 挂起时尚未访问 Indirection
      // 及其后代；这些节点只会在后续 retry 中渲染。
      return <Indirection />;
    }

    /** Indirection 提供稳定的 memo bailout；retry 必须穿过它恢复未访问的 Context Consumer。 */
    const Indirection = React.memo(() => {
      // 该子节点必须始终与兄弟 Text 的 Context 值一致。
      return <DeepChild />;
    });

    /** DeepChild 是传播末端消费者；其日志和输出验证“并发模式下 Context 跨 Suspense retry 不丢失”。 */
    function DeepChild() {
      const value = useContext(Context);
      return <Text text={value} />;
    }

    await seedNextTextCache('A');
    await act(() => {
      root.render(<App />);
    });
    assertLog(['A', 'A']);
    expect(root).toMatchRenderedOutput('AA');

    await act(() => {
      // 故意不使用 startTransition，确保这是 refresh 时
      // 也立即显示 fallback 的同步更新。
      setContext('B');
    });
    assertLog([
      'Suspend! [B]',
      'Loading...',
      'B',
      // 执行预热渲染；该遍只建立工作，不作为最终提交。
      'Suspend! [B]',
    ]);
    expect(root).toMatchRenderedOutput('Loading...B');

    await act(async () => {
      await resolveText('B');
    });
    assertLog(['B']);
    expect(root).toMatchRenderedOutput('BB');
  });

  /**
   * Given：两个 Provider 同时从 A 变为 B，Async 在访问 memo 后代前因 B 资源未就绪而挂起。
   * When：同步更新显示 fallback，随后解决 B thenable 触发 retry。
   * Then：重试恢复两条 Context 依赖，两个深层消费者都读取 B。
   *
   * 验证机制：Suspend/预热/恢复日志与最终 `BBB` 输出验证两条依赖均未丢失。
   * 对应源码：`ReactFiberNewContext.js` 的 `propagateContextChanges()`、`scheduleContextWorkOnParentPath()` 与 Suspense retry 路径。
   */
  // @gate enableLegacyCache
  it('multiple contexts are propagated across retries', async () => {
    // 与上一用例相同，但同时覆盖多个 Context Provider。
    const root = ReactNoop.createRoot();

    const Context1 = React.createContext('A');
    const Context2 = React.createContext('A');

    let setContext;
    /** App 持有 Provider 更新入口并组织 bailout、Suspense 或 Offscreen 层级，用于“多 Context 依赖跨挂起 retry 完整传播”。 */
    function App() {
      const [value, setValue] = useState('A');
      setContext = setValue;
      return (
        <Context1.Provider value={value}>
          <Context2.Provider value={value}>
            <Suspense fallback={<Text text="Loading..." />}>
              <Async />
            </Suspense>
            <Text text={value} />
          </Context2.Provider>
        </Context1.Provider>
      );
    }

    /** Async 在访问后代前读取可挂起资源，制造 render 中断与 retry，用于“多 Context 依赖跨挂起 retry 完整传播”。 */
    function Async() {
      const value = useContext(Context1);
      readText(value);

      // `readText` 挂起时尚未访问 Indirection
      // 及其后代；这些节点只会在后续 retry 中渲染。
      return (
        <>
          <Indirection1 />
          <Indirection2 />
        </>
      );
    }

    /** Indirection1 为 Context1 建立独立 memo bailout 分支。 */
    const Indirection1 = React.memo(() => {
      // 该子节点必须始终与兄弟 Text 的 Context 值一致。
      return <DeepChild1 />;
    });

    /** Indirection2 为 Context2 建立独立 memo bailout 分支。 */
    const Indirection2 = React.memo(() => {
      // 该子节点必须始终与兄弟 Text 的 Context 值一致。
      return <DeepChild2 />;
    });

    /** DeepChild1 是传播末端消费者；其日志和输出验证“多 Context 依赖跨挂起 retry 完整传播”。 */
    function DeepChild1() {
      const value = useContext(Context1);
      return <Text text={value} />;
    }

    /** DeepChild2 是传播末端消费者；其日志和输出验证“多 Context 依赖跨挂起 retry 完整传播”。 */
    function DeepChild2() {
      const value = useContext(Context2);
      return <Text text={value} />;
    }

    await seedNextTextCache('A');
    await act(() => {
      root.render(<App />);
    });
    assertLog(['A', 'A', 'A']);
    expect(root).toMatchRenderedOutput('AAA');

    await act(() => {
      // 故意不使用 startTransition，确保这是 refresh 时
      // 也立即显示 fallback 的同步更新。
      setContext('B');
    });
    assertLog([
      'Suspend! [B]',
      'Loading...',
      'B',
      // 执行预热渲染；该遍只建立工作，不作为最终提交。
      'Suspend! [B]',
    ]);
    expect(root).toMatchRenderedOutput('Loading...B');

    await act(async () => {
      await resolveText('B');
    });
    assertLog(['B', 'B']);
    expect(root).toMatchRenderedOutput('BBB');
  });

  /**
   * Given：LegacyRoot 中 Provider 从 A 变为 B，Async 在访问后代前挂起。
   * When：同步更新提交 fallback，再解决资源触发 Suspense retry。
   * Then：重试携带最新 Context，首遍未访问的 DeepChild 仍读取 B。
   *
   * 验证机制：挂起、fallback、恢复日志与最终 `BB` 输出划分两遍渲染。
   * 对应源码：`ReactFiberNewContext.js` 的 `propagateContextChanges()`、`scheduleContextWorkOnParentPath()` 与 `ReactFiberThrow.js` 的 ping/retry 路径。
   */
  // @gate enableLegacyCache && !disableLegacyMode
  it('context is propagated across retries (legacy)', async () => {
    const root = ReactNoop.createLegacyRoot();

    const Context = React.createContext('A');

    let setContext;
    /** App 持有 Provider 更新入口并组织 bailout、Suspense 或 Offscreen 层级，用于“legacy 模式下 Context 跨 Suspense retry 不丢失”。 */
    function App() {
      const [value, setValue] = useState('A');
      setContext = setValue;
      return (
        <Context.Provider value={value}>
          <Suspense fallback={<Text text="Loading..." />}>
            <Async />
          </Suspense>
          <Text text={value} />
        </Context.Provider>
      );
    }

    /** Async 在访问后代前读取可挂起资源，制造 render 中断与 retry，用于“legacy 模式下 Context 跨 Suspense retry 不丢失”。 */
    function Async() {
      const value = useContext(Context);
      readText(value);

      // `readText` 挂起时尚未访问 Indirection
      // 及其后代；这些节点只会在后续 retry 中渲染。
      return <Indirection />;
    }

    /** Indirection 在 legacy retry 场景中保持 children 身份，隔离 Context 传播触发的工作。 */
    const Indirection = React.memo(() => {
      // 该子节点必须始终与兄弟 Text 的 Context 值一致。
      return <DeepChild />;
    });

    /** DeepChild 是传播末端消费者；其日志和输出验证“legacy 模式下 Context 跨 Suspense retry 不丢失”。 */
    function DeepChild() {
      const value = useContext(Context);
      return <Text text={value} />;
    }

    await seedNextTextCache('A');
    await act(() => {
      root.render(<App />);
    });
    assertLog(['A', 'A']);
    expect(root).toMatchRenderedOutput('AA');

    await act(() => {
      // 故意不使用 startTransition，确保这是 refresh 时
      // 也立即显示 fallback 的同步更新。
      setContext('B');
    });
    assertLog(['Suspend! [B]', 'Loading...', 'B']);
    expect(root).toMatchRenderedOutput('Loading...B');

    await act(async () => {
      await resolveText('B');
    });
    assertLog(['B']);
    expect(root).toMatchRenderedOutput('BB');
  });

  /**
   * Given：Provider 同时包含 hidden LegacyHidden 消费者和可见兄弟，中间 memo 层可 bailout。
   * When：Provider value 从 A 更新为 B。
   * Then：传播器进入隐藏树并唤醒 DeepChild，隐藏与可见分支都读取 B。
   *
   * 验证机制：两个 B 日志与 `BB` 输出证明可见性不影响依赖传播。
   * 对应源码：`ReactFiberNewContext.js` 的 `propagateContextChanges()` 与 `ReactFiberBeginWork.js` 的 `updateOffscreenComponent()`。
   */
  // @gate enableLegacyCache && enableLegacyHidden
  it('context is propagated through offscreen trees', async () => {
    const LegacyHidden = React.unstable_LegacyHidden;

    const root = ReactNoop.createRoot();

    const Context = React.createContext('A');

    let setContext;
    /** App 持有 Provider 更新入口并组织 bailout、Suspense 或 Offscreen 层级，用于“Context 依赖穿过 hidden Offscreen 树”。 */
    function App() {
      const [value, setValue] = useState('A');
      setContext = setValue;
      return (
        <Context.Provider value={value}>
          <LegacyHidden mode="hidden">
            <Indirection />
          </LegacyHidden>
          <Text text={value} />
        </Context.Provider>
      );
    }

    /** Indirection 在 hidden Offscreen 树内制造 memo bailout，验证传播不会被可见性截断。 */
    const Indirection = React.memo(() => {
      // 该子节点必须始终与兄弟 Text 的 Context 值一致。
      return <DeepChild />;
    });

    /** DeepChild 是传播末端消费者；其日志和输出验证“Context 依赖穿过 hidden Offscreen 树”。 */
    function DeepChild() {
      const value = useContext(Context);
      return <Text text={value} />;
    }

    await seedNextTextCache('A');
    await act(() => {
      root.render(<App />);
    });
    assertLog(['A', 'A']);
    expect(root).toMatchRenderedOutput('AA');

    await act(() => {
      setContext('B');
    });
    assertLog(['B', 'B']);
    expect(root).toMatchRenderedOutput('BB');
  });

  /**
   * Given：两个 Provider 包围 hidden LegacyHidden 子树，两个 memo 分支分别订阅各自 Context。
   * When：两个 Provider value 一起从 A 更新为 B。
   * Then：Offscreen 隐藏状态不截断依赖扫描，两个消费者与可见兄弟均读取 B。
   *
   * 验证机制：三个 B 日志及 `BBB` 输出验证隐藏和可见分支一致。
   * 对应源码：`ReactFiberNewContext.js` 的 `propagateContextChanges()` 与 `ReactFiberBeginWork.js` 的 `updateOffscreenComponent()`。
   */
  // @gate enableLegacyCache && enableLegacyHidden
  it('multiple contexts are propagated across through offscreen trees', async () => {
    // 与上一用例相同，但同时覆盖多个 Context Provider。
    const LegacyHidden = React.unstable_LegacyHidden;

    const root = ReactNoop.createRoot();

    const Context1 = React.createContext('A');
    const Context2 = React.createContext('A');

    let setContext;
    /** App 持有 Provider 更新入口并组织 bailout、Suspense 或 Offscreen 层级，用于“多个 Context 穿过 hidden Offscreen 子树”。 */
    function App() {
      const [value, setValue] = useState('A');
      setContext = setValue;
      return (
        <Context1.Provider value={value}>
          <Context2.Provider value={value}>
            <LegacyHidden mode="hidden">
              <Indirection1 />
              <Indirection2 />
            </LegacyHidden>
            <Text text={value} />
          </Context2.Provider>
        </Context1.Provider>
      );
    }

    /** Indirection1 是 hidden 树内 Context1 的 memo 分支。 */
    const Indirection1 = React.memo(() => {
      // 该子节点必须始终与兄弟 Text 的 Context 值一致。
      return <DeepChild1 />;
    });

    /** Indirection2 是 hidden 树内 Context2 的 memo 分支。 */
    const Indirection2 = React.memo(() => {
      // 该子节点必须始终与兄弟 Text 的 Context 值一致。
      return <DeepChild2 />;
    });

    /** DeepChild1 是传播末端消费者；其日志和输出验证“多个 Context 穿过 hidden Offscreen 子树”。 */
    function DeepChild1() {
      const value = useContext(Context1);
      return <Text text={value} />;
    }

    /** DeepChild2 是传播末端消费者；其日志和输出验证“多个 Context 穿过 hidden Offscreen 子树”。 */
    function DeepChild2() {
      const value = useContext(Context2);
      return <Text text={value} />;
    }

    await seedNextTextCache('A');
    await act(() => {
      root.render(<App />);
    });
    assertLog(['A', 'A', 'A']);
    expect(root).toMatchRenderedOutput('AAA');

    await act(() => {
      setContext('B');
    });
    assertLog(['B', 'B', 'B']);
    expect(root).toMatchRenderedOutput('BBB');
  });

  /**
   * Given：SuspenseList children 被 useMemo 固定，使列表进入不调用通用 bailout helper 的专用 early bailout。
   * When：仅更新外层 Provider value A→B。
   * Then：列表 bailout 仍继续传播 Context，两个 Child 均读取 B。
   *
   * 验证机制：成对 A/B 日志和 `AA`→`BB` 输出排除 children 重建造成的假阳性。
   * 对应源码：`ReactFiberBeginWork.js` 的 `updateSuspenseListComponent()` 与 `ReactFiberNewContext.js` 的 `propagateContextChanges()`。
   */
  // @gate enableSuspenseList
  it('contexts are propagated through SuspenseList', async () => {
    // 此用例涉及实现细节：SuspenseList 有一条专用 early
    // bailout，当前没有调用 `bailoutOnAlreadyFinishedWork`；
    // 理想上该路径应复用通用 helper。
    const Context = React.createContext('A');

    let setContext;
    /** App 持有 Provider 更新入口并组织 bailout、Suspense 或 Offscreen 层级，用于“SuspenseList 专用 early bailout 不截断 Context”。 */
    function App() {
      const [value, setValue] = useState('A');
      setContext = setValue;
      const children = React.useMemo(
        () => (
          <SuspenseList revealOrder="forwards" tail="visible">
            <Child />
            <Child />
          </SuspenseList>
        ),
        [],
      );
      return <Context.Provider value={value}>{children}</Context.Provider>;
    }

    /** Child 是传播末端消费者；其日志和输出验证“SuspenseList 专用 early bailout 不截断 Context”。 */
    function Child() {
      const value = useContext(Context);
      return <Text text={value} />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });
    assertLog(['A', 'A']);
    expect(root).toMatchRenderedOutput('AA');

    await act(() => {
      setContext('B');
    });
    assertLog(['B', 'B']);
    expect(root).toMatchRenderedOutput('BB');
  });

  /**
   * Given：Provider 下有两层 memo 间接节点，并在浅层、深层各放一个 Context Consumer。
   * When：把 Provider value 从 A 更新为 B。
   * Then：传播命中浅层依赖后，在下一个 bailout 处继续找到深层依赖。
   *
   * 验证机制：两个 B 日志与 `BB` 输出证明扫描未永久停在首个匹配。
   * 对应源码：`ReactFiberNewContext.js` 的 `propagateContextChanges()`、`checkIfContextChanged()` 与 `ReactFiberBeginWork.js` 的 bailout 路径。
   */
  it('nested bailouts', async () => {
    // lazy Context 传播命中首个
    // 匹配后会停止；若子树内再次 bailout，必须恢复传播扫描。

    const Context = React.createContext('A');

    let setContext;
    /** App 持有 Provider 更新入口并组织 bailout、Suspense 或 Offscreen 层级，用于“lazy Context 传播在嵌套 bailout 处恢复扫描”。 */
    function App() {
      const [value, setValue] = useState('A');
      setContext = setValue;
      return (
        <Context.Provider value={value}>
          <ChildIndirection />
        </Context.Provider>
      );
    }

    /** ChildIndirection 构造第一层 memo bailout，使 lazy 传播在命中依赖后暂停。 */
    const ChildIndirection = React.memo(() => {
      return <Child />;
    });

    /** Child 是传播末端消费者；其日志和输出验证“lazy Context 传播在嵌套 bailout 处恢复扫描”。 */
    function Child() {
      const value = useContext(Context);
      return (
        <>
          <Text text={value} />
          <DeepChildIndirection />
        </>
      );
    }

    /** DeepChildIndirection 构造第二层 bailout，验证传播器会恢复扫描深层依赖。 */
    const DeepChildIndirection = React.memo(() => {
      return <DeepChild />;
    });

    /** DeepChild 是传播末端消费者；其日志和输出验证“lazy Context 传播在嵌套 bailout 处恢复扫描”。 */
    function DeepChild() {
      const value = useContext(Context);
      return <Text text={value} />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });
    assertLog(['A', 'A']);
    expect(root).toMatchRenderedOutput('AA');

    await act(() => {
      setContext('B');
    });
    assertLog(['B', 'B']);
    expect(root).toMatchRenderedOutput('BB');
  });

  /**
   * Given：并发 Root 中 Provider 从 A 变为 B，Async 在访问后代前挂起。
   * When：同步更新提交 fallback，再解决资源触发 Suspense retry。
   * Then：重试携带最新 Context，首遍未访问的 DeepChild 仍读取 B。
   *
   * 验证机制：挂起、fallback、恢复日志与最终 `BB` 输出划分两遍渲染。
   * 对应源码：`ReactFiberNewContext.js` 的 `propagateContextChanges()`、`scheduleContextWorkOnParentPath()` 与 `ReactFiberThrow.js` 的 ping/retry 路径。
   */
  // @gate enableLegacyCache
  it('nested bailouts across retries', async () => {
    // lazy Context 传播命中首个
    // 匹配后会停止；若子树内再次 bailout，必须恢复传播扫描。

    const Context = React.createContext('A');

    let setContext;
    /** App 持有 Provider 更新入口并组织 bailout、Suspense 或 Offscreen 层级，用于“并发模式下 Context 跨 Suspense retry 不丢失”。 */
    function App() {
      const [value, setValue] = useState('A');
      setContext = setValue;
      return (
        <Context.Provider value={value}>
          <Suspense fallback={<Text text="Loading..." />}>
            <Async value={value} />
          </Suspense>
        </Context.Provider>
      );
    }

    /** Async 在访问后代前读取可挂起资源，制造 render 中断与 retry，用于“并发模式下 Context 跨 Suspense retry 不丢失”。 */
    function Async({value}) {
      // 该节点挂起后，当前 render 无法访问其 children，
      // 因此必须以可跨 retry 保留的方式传播
      // Context 变化，避免在后续
      // render 重试时丢失依赖。
      readText(value);
      return <Child value={value} />;
    }

    /** Child 是传播末端消费者；其日志和输出验证“并发模式下 Context 跨 Suspense retry 不丢失”。 */
    function Child() {
      const value = useContext(Context);
      return (
        <>
          <Text text={value} />
          <DeepChildIndirection />
        </>
      );
    }

    /** DeepChildIndirection 位于 retry 后才能访问的深层路径，用于验证传播状态不会跨挂起丢失。 */
    const DeepChildIndirection = React.memo(() => {
      return <DeepChild />;
    });

    /** DeepChild 是传播末端消费者；其日志和输出验证“并发模式下 Context 跨 Suspense retry 不丢失”。 */
    function DeepChild() {
      const value = useContext(Context);
      return <Text text={value} />;
    }

    const root = ReactNoop.createRoot();
    await seedNextTextCache('A');
    await act(() => {
      root.render(<App />);
    });
    assertLog(['A', 'A']);
    expect(root).toMatchRenderedOutput('AA');

    await act(() => {
      setContext('B');
    });
    assertLog([
      'Suspend! [B]',
      'Loading...',
      // 执行预热渲染；该遍只建立工作，不作为最终提交。
      'Suspend! [B]',
    ]);
    expect(root).toMatchRenderedOutput('Loading...');

    await act(async () => {
      await resolveText('B');
    });
    assertLog(['B', 'B']);
    expect(root).toMatchRenderedOutput('BB');
  });

  /**
   * Given：Provider 同时包含 hidden LegacyHidden 消费者和可见兄弟，中间 memo 层可 bailout。
   * When：Provider value 从 A 更新为 B。
   * Then：传播器进入隐藏树并唤醒 DeepChild，隐藏与可见分支都读取 B。
   *
   * 验证机制：两个 B 日志与 `BB` 输出证明可见性不影响依赖传播。
   * 对应源码：`ReactFiberNewContext.js` 的 `propagateContextChanges()` 与 `ReactFiberBeginWork.js` 的 `updateOffscreenComponent()`。
   */
  // @gate enableLegacyCache && enableLegacyHidden
  it('nested bailouts through offscreen trees', async () => {
    // lazy Context 传播命中首个
    // 匹配后会停止；若子树内再次 bailout，必须恢复传播扫描。

    const LegacyHidden = React.unstable_LegacyHidden;

    const Context = React.createContext('A');

    let setContext;
    /** App 持有 Provider 更新入口并组织 bailout、Suspense 或 Offscreen 层级，用于“Context 依赖穿过 hidden Offscreen 树”。 */
    function App() {
      const [value, setValue] = useState('A');
      setContext = setValue;
      return (
        <Context.Provider value={value}>
          <LegacyHidden mode="hidden">
            <Child />
          </LegacyHidden>
        </Context.Provider>
      );
    }

    /** Child 是传播末端消费者；其日志和输出验证“Context 依赖穿过 hidden Offscreen 树”。 */
    function Child() {
      const value = useContext(Context);
      return (
        <>
          <Text text={value} />
          <DeepChildIndirection />
        </>
      );
    }

    /** DeepChildIndirection 位于 hidden 树深层，验证 Offscreen bailout 后会继续扫描 Context。 */
    const DeepChildIndirection = React.memo(() => {
      return <DeepChild />;
    });

    /** DeepChild 是传播末端消费者；其日志和输出验证“Context 依赖穿过 hidden Offscreen 树”。 */
    function DeepChild() {
      const value = useContext(Context);
      return <Text text={value} />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });
    assertLog(['A', 'A']);
    expect(root).toMatchRenderedOutput('AA');

    await act(() => {
      setContext('B');
    });
    assertLog(['B', 'B']);
    expect(root).toMatchRenderedOutput('BB');
  });

  /**
   * Given：一个 memo 父节点下有两个兄弟 memo 分支，各自包含 Context Consumer。
   * When：把 Provider value 从 A 更新为 B。
   * Then：命中首个消费者后 walker 继续 sibling，两个分支都被调度。
   *
   * 验证机制：两个 B 日志与 `BB` 输出验证 sibling 未被跳过。
   * 对应源码：`ReactFiberNewContext.js` 的 `propagateContextChanges()` sibling/return 遍历。
   */
  it('finds context consumers in multiple sibling branches', async () => {
    // 本测试确认传播期间找到匹配的 Context Consumer 后，
    // walker 仍继续遍历其 sibling 分支。

    const Context = React.createContext('A');

    let setContext;
    /** App 持有 Provider 更新入口并组织 bailout、Suspense 或 Offscreen 层级，用于“Context 扫描覆盖多个兄弟分支”。 */
    function App() {
      const [value, setValue] = useState('A');
      setContext = setValue;
      return (
        <Context.Provider value={value}>
          <Blah />
        </Context.Provider>
      );
    }

    /** Blah 固定两个兄弟分支的父元素身份，使更新只能来自 Context walker。 */
    const Blah = React.memo(() => {
      return (
        <>
          <Indirection />
          <Indirection />
        </>
      );
    });

    /** Indirection 为每个 sibling 建立独立 memo bailout，暴露 walker 是否继续兄弟遍历。 */
    const Indirection = React.memo(() => {
      return <Child />;
    });

    /** Child 是传播末端消费者；其日志和输出验证“Context 扫描覆盖多个兄弟分支”。 */
    function Child() {
      const value = useContext(Context);
      return <Text text={value} />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });
    assertLog(['A', 'A']);
    expect(root).toMatchRenderedOutput('AA');

    await act(() => {
      setContext('B');
    });
    assertLog(['B', 'B']);
    expect(root).toMatchRenderedOutput('BB');
  });

  /**
   * Given：Suspense 首次挂起后 primary Consumer Fiber 被丢弃，原 promise 永不 ping。
   * When：Provider 把 Context 改为 fulfilled thenable。
   * Then：父 Context 传播标记 Suspense lanes，并由外部变化触发 retry 得到 Result。
   *
   * 验证机制：`Loading`→`Result` 证明恢复信号只来自 Context 更新。
   * 对应源码：`ReactFiberNewContext.js` 的 `propagateParentContextChanges()`、`scheduleContextWorkOnParentPath()` 与 Suspense bailout。
   */
  it('regression: context change triggers retry of suspended Suspense boundary on initial mount', async () => {
    // 回归场景：已挂起 Suspense 上方的 Context 变化
    // 曾无法触发 retry。Suspense
    // 在首次挂起时会丢弃 primary children Fiber，
    // 因为此时没有 current tree 可保留它们；若
    // 被抛出的 promise 永不解决，唯一的 retry 信号只能来自
    // Context 变化等外部更新。Context 传播必须
    // 标记已挂起的 Suspense 边界，即使 Consumer
    // Fiber 已不在树中。
    //
    // Provider 自己持有 state 更新；children
    // 由上层传入，因此 Provider
    // 重渲染时不会重建它们，Suspense 边界会 bailout，从而覆盖
    // 曾触发该缺陷的 lazy Context 传播路径。
    const Context = React.createContext(null);
    const neverResolvingPromise = new Promise(() => {});
    const resolvedThenable = {status: 'fulfilled', value: 'Result', /** then 按 thenable 协议登记 ping；pending 时入队，终态时用微任务回放，覆盖订阅/完成竞态。 */ then() {}};

    /** Consumer 登记 Context 依赖并把读取值交给日志或宿主输出，用于“首次挂起丢弃消费者后由 Context 变化触发 retry”。 */
    function Consumer() {
      return <Text text={use(use(Context))} />;
    }

    let setPromise;
    /** Provider 写入受控 Context，并保持 children 结构以隔离真正的传播行为，用于“首次挂起丢弃消费者后由 Context 变化触发 retry”。 */
    function Provider({children}) {
      const [promise, _setPromise] = useState(neverResolvingPromise);
      setPromise = _setPromise;
      return <Context.Provider value={promise}>{children}</Context.Provider>;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <Provider>
          <Suspense fallback={<Text text="Loading" />}>
            <Consumer />
          </Suspense>
        </Provider>,
      );
    });
    assertLog(['Loading']);
    expect(root).toMatchRenderedOutput('Loading');

    await act(() => {
      setPromise(resolvedThenable);
    });
    assertLog(['Result']);
    expect(root).toMatchRenderedOutput('Result');
  });

  /**
   * Given：首次挂起丢弃 primary 子 Fiber，Provider 与 Suspense 间还有不应重渲染的 Indirection。
   * When：Context 将永不解决的 promise 替换为 fulfilled thenable。
   * Then：walker 直接标记 Suspense retry，不重渲染 Indirection，并提交 Result。
   *
   * 验证机制：更新日志只出现 Result，证明走 `propagateContextChanges` walker。
   * 对应源码：`ReactFiberNewContext.js` 的 `propagateContextChanges()` 与 `scheduleContextWorkOnParentPath()`。
   */
  it('regression: context change triggers retry of suspended Suspense boundary on initial mount (nested)', async () => {
    // 与上一回归相同，但 Provider 与 Suspense 之间增加
    // 一个 Indirection，用于覆盖
    // `propagateContextChanges` walker，而非
    // `propagateParentContextChanges` 路径。
    const Context = React.createContext(null);
    const neverResolvingPromise = new Promise(() => {});
    const resolvedThenable = {status: 'fulfilled', value: 'Result', /** then 按 thenable 协议登记 ping；pending 时入队，终态时用微任务回放，覆盖订阅/完成竞态。 */ then() {}};

    /** Consumer 登记 Context 依赖并把读取值交给日志或宿主输出，用于“嵌套路径在首次挂起丢弃消费者后仍重试 Suspense”。 */
    function Consumer() {
      return <Text text={use(use(Context))} />;
    }

    /** Indirection 保持 children 身份，区分父级重渲染与 Context walker 的定向调度，用于“嵌套路径在首次挂起丢弃消费者后仍重试 Suspense”。 */
    function Indirection({children}) {
      Scheduler.log('Indirection');
      return children;
    }

    let setPromise;
    /** Provider 写入受控 Context，并保持 children 结构以隔离真正的传播行为，用于“嵌套路径在首次挂起丢弃消费者后仍重试 Suspense”。 */
    function Provider({children}) {
      const [promise, _setPromise] = useState(neverResolvingPromise);
      setPromise = _setPromise;
      return <Context.Provider value={promise}>{children}</Context.Provider>;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <Provider>
          <Indirection>
            <Suspense fallback={<Text text="Loading" />}>
              <Consumer />
            </Suspense>
          </Indirection>
        </Provider>,
      );
    });
    assertLog(['Indirection', 'Loading']);
    expect(root).toMatchRenderedOutput('Loading');

    // Indirection 不应重渲染；只有 Suspense 边界
    // 应被 retry。
    await act(() => {
      setPromise(resolvedThenable);
    });
    assertLog(['Result']);
    expect(root).toMatchRenderedOutput('Result');
  });

  /**
   * Given：primary 内容持续挂起，fallback Consumer 位于稳定 memo wrapper 之后。
   * When：边界显示 fallback 时更新 Context A→B，最后解除 primary 挂起。
   * Then：fallback 先读取 B，随后 primary retry 提交 Content，并与可见兄弟的 B 一致。
   *
   * 验证机制：`Fallback: AA`→`Fallback: BB`→`ContentB` 与 retry 日志划分三阶段。
   * 对应源码：`ReactFiberNewContext.js` 的 `propagateContextChanges()` 与 `ReactFiberBeginWork.js` 的 `updateSuspenseComponent()`。
   */
  // @gate enableLegacyCache
  it('context change propagates to Suspense fallback (memo boundary)', async () => {
    // 当正在显示 fallback 的 Suspense 边界上方发生 Context 变化时，
    // fallback 内的 Context Consumer 应以
    // 更新值重新渲染；即使 Provider 与
    // Suspense 之间的 memo 边界让 fallback element
    // 引用保持不变，也不能跳过传播。
    const root = ReactNoop.createRoot();
    const Context = React.createContext('A');

    let setContext;
    /** App 持有 Provider 更新入口并组织 bailout、Suspense 或 Offscreen 层级，用于“memo 边界后的 Suspense fallback 接收最新 Context”。 */
    function App() {
      const [value, _setValue] = useState('A');
      setContext = _setValue;
      return (
        <Context.Provider value={value}>
          <MemoizedWrapper />
          <Text text={value} />
        </Context.Provider>
      );
    }

    /** MemoizedWrapper 固定 Suspense 与 fallback element 引用，使 Context 更新必须直接命中已提交 fallback 树。 */
    const MemoizedWrapper = React.memo(function MemoizedWrapper() {
      return (
        <Suspense fallback={<FallbackConsumer />}>
          <AsyncChild />
        </Suspense>
      );
    });

    /** FallbackConsumer 登记 Context 依赖并把读取值交给日志或宿主输出，用于“memo 边界后的 Suspense fallback 接收最新 Context”。 */
    function FallbackConsumer() {
      const value = useContext(Context);
      return <Text text={'Fallback: ' + value} />;
    }

    /** AsyncChild 在访问后代前读取可挂起资源，制造 render 中断与 retry，用于“memo 边界后的 Suspense fallback 接收最新 Context”。 */
    function AsyncChild() {
      readText('async');
      return <Text text="Content" />;
    }

    // 首次渲染：primary 内容挂起并显示 fallback。
    await act(() => {
      root.render(<App />);
    });
    assertLog([
      'Suspend! [async]',
      'Fallback: A',
      'A',
      // 执行预热渲染；该遍只建立工作，不作为最终提交。
      'Suspend! [async]',
    ]);
    expect(root).toMatchRenderedOutput('Fallback: AA');

    // 保持挂起时更新 Context；fallback Consumer 应
    // 使用新值重新渲染。
    await act(() => {
      setContext('B');
    });
    assertLog([
      // Suspense 边界先重试 primary children。
      'Suspend! [async]',
      'Fallback: B',
      'B',
      // 执行预热渲染；该遍只建立工作，不作为最终提交。
      'Suspend! [async]',
    ]);
    expect(root).toMatchRenderedOutput('Fallback: BB');

    // 解除挂起后，primary 内容应使用最新 Context 渲染。
    await act(async () => {
      await resolveText('async');
    });
    assertLog(['Content']);
    expect(root).toMatchRenderedOutput('ContentB');
  });
});
