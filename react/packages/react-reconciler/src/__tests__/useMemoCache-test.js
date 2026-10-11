/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

let React;
let ReactNoop;
let Scheduler;
let act;
let assertConsoleErrorDev;
let assertLog;
let useMemo;
let useState;
let useMemoCache;
let MemoCacheSentinel;
let ErrorBoundary;

/** 验证 React Compiler 运行时 memo cache 的槽位协议、跨渲染复用和中断恢复语义。 */
describe('useMemoCache()', () => {
  /** 每个用例重置模块，重新绑定编译器运行时缓存入口、哨兵值、渲染器和断言工具。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    const InternalTestUtils = require('internal-test-utils');
    act = InternalTestUtils.act;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;
    assertLog = InternalTestUtils.assertLog;
    useMemo = React.useMemo;
    useMemoCache = require('react/compiler-runtime').c;
    useState = React.useState;
    MemoCacheSentinel = Symbol.for('react.memo_cache_sentinel');

    /** 为并发渲染抛错场景提供最小错误边界，允许 React 回退同步重试后继续检查缓存。 */
    class _ErrorBoundary extends React.Component {
      /** 初始化尚未捕获错误的边界状态。 */
      constructor(props) {
        super(props);
        this.state = {hasError: false};
      }

      /** 捕获子树错误后切换到回退界面。 */
      static getDerivedStateFromError(error) {
        // 更新状态，使下一次渲染展示回退界面。
        return {hasError: true};
      }

      /** 消费错误边界生命周期参数；本 fixture 无需额外副作用。 */
      componentDidCatch(error, errorInfo) {}

      /** 错误发生前透传子节点，发生后渲染稳定回退内容。 */
      render() {
        if (this.state.hasError) {
          // 此处分支可替换为任意自定义回退界面。
          return <h1>Something went wrong.</h1>;
        }

        return this.props.children;
      }
    }
    ErrorBoundary = _ErrorBoundary;
  });

  /**
   * Given：组件首次申请一个槽位的 memo cache。
   * When：根节点完成首次挂载。
   * Then：返回长度为一的数组，首槽为全局缓存哨兵，组件正常输出 `Ok`。
   *
   * 验证机制：同时断言数组形状、槽位初值与宿主输出。
   * 对应源码：`useMemoCache()` 创建更新队列中的 `memoCache` 并填充 `REACT_MEMO_CACHE_SENTINEL`。
   */
  it('render component using cache', async () => {
    /** 首次申请缓存并直接检查编译器运行时约定的数组形状与哨兵值。 */
    function Component(props) {
      const cache = useMemoCache(1);
      expect(Array.isArray(cache)).toBe(true);
      expect(cache.length).toBe(1);
      expect(cache[0]).toBe(MemoCacheSentinel);

      return 'Ok';
    }
    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<Component />);
    });
    expect(root).toMatchRenderedOutput('Ok');
  });

  /**
   * Given：五个缓存槽分别保存数据依赖、数据对象、元素依赖与元素结果。
   * When：先改变数据依赖，再执行与数据无关的强制更新。
   * Then：相关更新重建对象，无关更新复用同一对象引用。
   *
   * 验证机制：组合检查子组件调用次数、宿主文本及 `data` 引用身份。
   * 对应源码：`useMemoCache()` 按调用位置返回跨更新持久化的槽位数组。
   */
  it('update component using cache', async () => {
    let setX;
    let forceUpdate;
    /** 模拟编译器产物，以显式槽位比较决定数据对象和子元素是否复用。 */
    function Component(props) {
      const cache = useMemoCache(5);

      // `x` 用于生成传给子组件的 `data` 对象。
      const [x, _setX] = useState(0);
      setX = _setX;

      // `n` 原样传给子组件，作为元素缓存的失效因子。
      const [n, setN] = useState(0);
      /** 只增加无关的 n，重渲染组件而保持编译缓存的 x 输入不变。 */
      forceUpdate = () => setN(a => a + 1);

      const c_0 = x !== cache[0];
      let data;
      if (c_0) {
        data = {text: `Count ${x}`};
        cache[0] = x;
        cache[1] = data;
      } else {
        data = cache[1];
      }
      const c_2 = x !== cache[2];
      const c_3 = n !== cache[3];
      let t0;
      if (c_2 || c_3) {
        t0 = <Text data={data} n={n} />;
        cache[2] = x;
        cache[3] = n;
        cache[4] = t0;
      } else {
        t0 = cache[4];
      }
      return t0;
    }
    let data;
    /** 记录收到的 `data` 引用，并通过 mock 调用次数暴露子组件是否重新执行。 */
    const Text = jest.fn(/** 记录子组件本次接收的 data 身份并返回对应文本，调用次数与缓存身份分开断言。 */ function Text(props) {
      data = props.data;
      return data.text;
    });

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<Component />);
    });
    expect(root).toMatchRenderedOutput('Count 0');
    expect(Text).toBeCalledTimes(1);
    const data0 = data;

    // 改变 `x` 应使缓存的数据对象失效。
    await act(() => {
      setX(1);
    });
    expect(root).toMatchRenderedOutput('Count 1');
    expect(Text).toBeCalledTimes(2);
    expect(data).not.toBe(data0);
    const data1 = data;

    // 与 `data` 无关的强制更新不应重新创建该对象。
    await act(() => {
      forceUpdate();
    });
    expect(root).toMatchRenderedOutput('Count 1');
    expect(Text).toBeCalledTimes(3);
    expect(data).toBe(data1); // 确认缓存跨渲染持续存在。
  });

  /**
   * Given：组件的 `data` 只依赖 `x`，另一个状态 `n` 会在渲染阶段从 1 更新到 2。
   * When：外部把 `n` 设为 1，触发同一轮的渲染阶段重试。
   * Then：输出采用最终 `n=2`，而 `data` 仍沿用挂载时对象。
   *
   * 验证机制：断言最终文本、子组件调用次数以及 `data` 严格引用相等。
   * 对应源码：`renderWithHooksAgain()` 重放渲染阶段更新，`useMemoCache()` 保持本次组件缓存槽位。
   */
  it('update component using cache with setstate during render', async () => {
    let setN;
    /** 模拟含渲染阶段 state 更新的编译器产物，隔离无关依赖对 memo cache 的影响。 */
    function Component(props) {
      const cache = useMemoCache(5);

      // `x` 用于生成传给子组件的 `data` 对象。
      const [x] = useState(0);

      const c_0 = x !== cache[0];
      let data;
      if (c_0) {
        data = {text: `Count ${x}`};
        cache[0] = x;
        cache[1] = data;
      } else {
        data = cache[1];
      }

      // `n` 原样传给子组件，作为元素缓存的失效因子。
      const [n, _setN] = useState(0);
      setN = _setN;

      if (n === 1) {
        setN(2);
        return;
      }

      const c_2 = x !== cache[2];
      const c_3 = n !== cache[3];
      let t0;
      if (c_2 || c_3) {
        t0 = <Text data={data} n={n} />;
        cache[2] = x;
        cache[3] = n;
        cache[4] = t0;
      } else {
        t0 = cache[4];
      }
      return t0;
    }
    let data;
    /** 捕获 `data` 引用并输出最终 `n`，同时观察组件执行次数。 */
    const Text = jest.fn(/** 记录子组件本次接收的 data 身份并返回对应文本，调用次数与缓存身份分开断言。 */ function Text(props) {
      data = props.data;
      return `${data.text} (n=${props.n})`;
    });

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<Component />);
    });
    expect(root).toMatchRenderedOutput('Count 0 (n=0)');
    expect(Text).toBeCalledTimes(1);
    const data0 = data;

    // 此更新会在渲染期间再次调用 setState；`data` 不依赖 `n`，因此应继续命中缓存。
    await act(() => {
      setN(1);
    });
    expect(root).toMatchRenderedOutput('Count 0 (n=2)');
    expect(Text).toBeCalledTimes(2);
    expect(data).toBe(data0);
  });

  /**
   * Given：一次更新会在并发渲染中抛错，React 随后以同步方式恢复整棵根树。
   * When：把 `n` 更新为 1 并触发仅一次的异常。
   * Then：恢复渲染提交正确输出，且与 `n` 无关的 `data` 引用未被重建。
   *
   * 验证机制：同时校验恢复告警、宿主输出、mock 次数和对象身份。
   * 对应源码：并发根错误恢复路径重新进入 `renderWithHooks()`，`useMemoCache()` 从当前 Fiber 更新队列取得缓存。
   */
  it('update component using cache with throw during render', async () => {
    let setN;
    let shouldFail = true;
    /** 在指定更新中抛出一次异常，并通过显式缓存槽验证重试不会丢失无关计算。 */
    function Component(props) {
      const cache = useMemoCache(5);

      // `x` 用于生成传给子组件的 `data` 对象。
      const [x] = useState(0);

      const c_0 = x !== cache[0];
      let data;
      if (c_0) {
        data = {text: `Count ${x}`};
        cache[0] = x;
        cache[1] = data;
      } else {
        data = cache[1];
      }

      // `n` 原样传给子组件，作为元素缓存的失效因子。
      const [n, _setN] = useState(0);
      setN = _setN;

      if (n === 1) {
        if (shouldFail) {
          shouldFail = false;
          throw new Error('failed');
        }
      }

      const c_2 = x !== cache[2];
      const c_3 = n !== cache[3];
      let t0;
      if (c_2 || c_3) {
        t0 = <Text data={data} n={n} />;
        cache[2] = x;
        cache[3] = n;
        cache[4] = t0;
      } else {
        t0 = cache[4];
      }
      return t0;
    }
    let data;
    /** 捕获每次恢复渲染收到的 `data` 引用，并输出当前 `n`。 */
    const Text = jest.fn(/** 记录子组件本次接收的 data 身份并返回对应文本，调用次数与缓存身份分开断言。 */ function Text(props) {
      data = props.data;
      return `${data.text} (n=${props.n})`;
    });

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <ErrorBoundary>
          <Component />
        </ErrorBoundary>,
      );
    });
    expect(root).toMatchRenderedOutput('Count 0 (n=0)');
    expect(Text).toBeCalledTimes(1);
    const data0 = data;

    await act(() => {
      // 此更新触发上方的一次性异常分支。
      setN(1);
    });
    assertConsoleErrorDev([
      'Error: There was an error during concurrent rendering but React was able to recover by instead synchronously rendering the entire root.' +
        '\n    in <stack>',
    ]);
    expect(root).toMatchRenderedOutput('Count 0 (n=1)');
    expect(Text).toBeCalledTimes(2);
    expect(data).toBe(data0);
    const data1 = data;

    // 与 `data` 无关的更新不应重新创建该对象。
    await act(() => {
      setN(2);
    });
    expect(root).toMatchRenderedOutput('Count 0 (n=2)');
    expect(Text).toBeCalledTimes(3);
    expect(data).toBe(data1); // 确认缓存跨渲染持续存在。
  });

  /**
   * Given：组件和自定义 Hook 各持有独立 memo cache，并串联传递同一数据对象。
   * When：先改变数据依赖，再执行无关更新。
   * Then：两层缓存按依赖一起失效，并在无关更新中共同复用结果。
   *
   * 验证机制：检查小写输出、子组件调用次数和最外层 `data` 引用身份。
   * 对应源码：`useMemoCache()` 依照 Hook 调用顺序为组件与自定义 Hook 分配独立槽位段。
   */
  it('update component and custom hook with caches', async () => {
    let setX;
    let forceUpdate;
    /** 使用四个槽位缓存输入、派生数据和子元素，并把数据交给自定义 Hook 二次处理。 */
    function Component(props) {
      const cache = useMemoCache(4);

      // `x` 用于生成传给子组件的 `data` 对象。
      const [x, _setX] = useState(0);
      setX = _setX;
      const c_x = x !== cache[0];
      cache[0] = x;

      // `n` 原样传给子组件，作为元素缓存的失效因子。
      const [n, setN] = useState(0);
      /** 只增加无关的 n，重渲染组件而保持编译缓存的 x 输入不变。 */
      forceUpdate = () => setN(a => a + 1);
      const c_n = n !== cache[1];
      cache[1] = n;

      let _data;
      if (c_x) {
        _data = cache[2] = {text: `Count ${x}`};
      } else {
        _data = cache[2];
      }
      const data = useData(_data);
      if (c_x || c_n) {
        return (cache[3] = <Text data={data} n={n} />);
      } else {
        return cache[3];
      }
    }
    /** 用自有的两个槽位把上游数据转换为小写对象，并在输入未变时复用引用。 */
    function useData(data) {
      const cache = useMemoCache(2);
      const c_data = data !== cache[0];
      cache[0] = data;
      let nextData;
      if (c_data) {
        nextData = cache[1] = {text: data.text.toLowerCase()};
      } else {
        nextData = cache[1];
      }
      return nextData;
    }
    let data;
    /** 记录自定义 Hook 返回的对象引用，并暴露最终文本与调用次数。 */
    const Text = jest.fn(/** 记录子组件本次接收的 data 身份并返回对应文本，调用次数与缓存身份分开断言。 */ function Text(props) {
      data = props.data;
      return data.text;
    });

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<Component />);
    });
    expect(root).toMatchRenderedOutput('count 0');
    expect(Text).toBeCalledTimes(1);
    const data0 = data;

    // 改变 `x` 应使两层缓存中的数据对象失效。
    await act(() => {
      setX(1);
    });
    expect(root).toMatchRenderedOutput('count 1');
    expect(Text).toBeCalledTimes(2);
    expect(data).not.toBe(data0);
    const data1 = data;

    // 无关更新不应重新创建数据对象。
    await act(() => {
      forceUpdate();
    });
    expect(root).toMatchRenderedOutput('count 1');
    expect(Text).toBeCalledTimes(3);
    expect(data).toBe(data1); // 确认缓存跨渲染持续存在。
  });

  /**
   * Given：已挂载组件在 transition 更新中分两段读取数据，第一段包含昂贵计算。
   * When：第二段数据仍挂起时，以输入更新中断当前尝试，再恢复 transition。
   * Then：启用共享缓存时复用第一段计算；关闭时因写时复制而重新计算。
   *
   * 验证机制：按阶段检查昂贵计算和挂起日志，并以 feature gate 分别约束两种实现。
   * 对应源码：`useMemoCache()` 在 `enableNoCloningMemoCache` 下共享当前与工作中 Fiber 的缓存数据。
   */
  it('reuses computations from suspended/interrupted render attempts during an update', async () => {
    // 本用例展示共享 memo cache 的收益。“共享”指同一组件或 Hook 的多个并发渲染尝试使用
    // 同一缓存；feature flag 关闭时则采用写时复制，渲染尝试之间不共享写入。
    //
    // 更新因挂起或另一项更新而中断后，可以复用前一次尝试的 memo 计算。其安全前提是 React
    // Compiler 对缓存执行原子写入：不会只记录 memo 输入而遗漏对应输出。
    //
    // 因而组件与 Hook 内部获得了一种局部“恢复执行”能力。
    //
    // 该能力只适用于更新已挂载组件。首次渲染时 memo cache 存放在 Fiber 上，而 Fiber 本身尚不
    // 支持恢复执行，因此首次渲染无论如何都会取得全新缓存。
    //
    // 即便只覆盖更新阶段也很有价值：Suspense 驱动的应用（如 RSC 或 Relay）在 mutation/action
    // 后用新数据刷新 UI 时会频繁经过此路径，本用例正是模拟这一场景。
    //
    // 因此该开关的实际收益是缩短数据 mutation/action 后的界面刷新耗时。

    /** 代表编译器需要缓存的昂贵派生计算，并把执行次数写入调度日志。 */
    function someExpensiveProcessing(t) {
      Scheduler.log(`Some expensive processing... [${t}]`);
      return t;
    }

    /** 读取 thenable；发生挂起时记录所属数据块后原样抛出，供 React Suspense 捕获。 */
    function useWithLog(t, msg) {
      try {
        return React.use(t);
      } catch (x) {
        Scheduler.log(`Suspend! [${msg}]`);
        throw x;
      }
    }

    // 编译前原始代码如下；作为对照样例的 commented-out code 保持原样。
    //
    //   function Data({chunkA, chunkB}) {
    //     const a = someExpensiveProcessing(useWithLog(chunkA, 'chunkA'));
    //     const b = useWithLog(chunkB, 'chunkB');
    //     return (
    //       <>
    //         {a}
    //         {b}
    //       </>
    //     );
    //   }
    //
    //   function Input() {
    //     const [input, _setText] = useState('');
    //     return input;
    //   }
    //
    //   function App({chunkA, chunkB}) {
    //     return (
    //       <>
    //         <div>
    //           Input: <Input />
    //         </div>
    //         <div>
    //           Data: <Data chunkA={chunkA} chunkB={chunkB} />
    //         </div>
    //       </>
    //     );
    //   }
    /** 模拟编译器生成的数据组件：缓存第一块昂贵计算及两个数据块组合出的元素。 */
    function Data(t0) {
      const $ = useMemoCache(5);
      const {chunkA, chunkB} = t0;
      const t1 = useWithLog(chunkA, 'chunkA');
      let t2;

      if ($[0] !== t1) {
        t2 = someExpensiveProcessing(t1);
        $[0] = t1;
        $[1] = t2;
      } else {
        t2 = $[1];
      }

      const a = t2;
      const b = useWithLog(chunkB, 'chunkB');
      let t3;

      if ($[2] !== a || $[3] !== b) {
        t3 = (
          <>
            {a}
            {b}
          </>
        );
        $[2] = a;
        $[3] = b;
        $[4] = t3;
      } else {
        t3 = $[4];
      }

      return t3;
    }

    let setInput;
    /** 暴露独立的输入状态更新，用高优先级交互中断正在进行的刷新 transition。 */
    function Input() {
      const [input, _set] = useState('');
      setInput = _set;
      return input;
    }

    /** 缓存稳定输入区域，并按数据块身份决定是否重建数据区域元素。 */
    function App(t0) {
      const $ = useMemoCache(4);
      const {chunkA, chunkB} = t0;
      let t1;

      if ($[0] === Symbol.for('react.memo_cache_sentinel')) {
        t1 = (
          <div>
            Input: <Input />
          </div>
        );
        $[0] = t1;
      } else {
        t1 = $[0];
      }

      let t2;

      if ($[1] !== chunkA || $[2] !== chunkB) {
        t2 = (
          <>
            {t1}
            <div>
              Data: <Data chunkA={chunkA} chunkB={chunkB} />
            </div>
          </>
        );
        $[1] = chunkA;
        $[2] = chunkB;
        $[3] = t2;
      } else {
        t2 = $[3];
      }

      return t2;
    }

    /** 创建已 fulfilled 的 thenable，使 `React.use` 同步读取给定值而不挂起。 */
    function createInstrumentedResolvedPromise(value) {
      return {
        /** 已完成 thenable 无需登记唤醒回调。 */
        then() {},
        status: 'fulfilled',
        value,
      };
    }

    /** 创建可由测试步骤显式 resolve 的 Promise，并把解析入口挂到实例上。 */
    function createDeferred() {
      let resolve;
      const p = new Promise(res => {
        resolve = res;
      });
      p.resolve = resolve;
      return p;
    }

    // 首次渲染把数据拆成两个独立“块”，用于模拟 RSC 等流式数据源。
    const root = ReactNoop.createRoot();
    const initialChunkA = createInstrumentedResolvedPromise('A1');
    const initialChunkB = createInstrumentedResolvedPromise('B1');
    await act(() =>
      root.render(<App chunkA={initialChunkA} chunkB={initialChunkB} />),
    );
    assertLog(['Some expensive processing... [A1]']);
    expect(root).toMatchRenderedOutput(
      <>
        <div>Input: </div>
        <div>Data: A1B1</div>
      </>,
    );

    // 在 transition 中更新界面，模拟数据 mutation 后的刷新。
    const updatedChunkA = createDeferred();
    const updatedChunkB = createDeferred();
    await act(() => {
      React.startTransition(() => {
        root.render(<App chunkA={updatedChunkA} chunkB={updatedChunkB} />);
      });
    });
    assertLog(['Suspend! [chunkA]']);

    // 第一块流式数据到达后触发昂贵 UI 计算；后续步骤会判断该计算是否被复用。
    await act(() => updatedChunkA.resolve('A2'));
    assertLog(['Some expensive processing... [A2]', 'Suspend! [chunkB]']);

    // 第二块尚未加载，因此界面仍保持初始已提交内容。
    expect(root).toMatchRenderedOutput(
      <>
        <div>Input: </div>
        <div>Data: A1B1</div>
      </>,
    );

    // 等待剩余数据期间更新界面另一部分，从而中断刷新 transition。
    //
    // 在真实应用中，这可能来自输入或悬停事件。
    await act(() => setInput('hi!'));

    // 输入更新提交后，React 返回并继续渲染 transition。
    if (gate(flags => flags.enableNoCloningMemoCache)) {
      // 无需再次处理第一块；直接复用较早渲染尝试中的计算。
      assertLog(['Suspend! [chunkB]']);
    } else {
      // 每次中止尝试都会克隆或重置 memo cache，因此必须重新处理第一块。
      assertLog(['Some expensive processing... [A2]', 'Suspend! [chunkB]']);
    }

    expect(root).toMatchRenderedOutput(
      <>
        <div>Input: hi!</div>
        <div>Data: A1B1</div>
      </>,
    );

    // 完成剩余数据加载。
    await act(() => updatedChunkB.resolve('B2'));
    if (gate(flags => flags.enableNoCloningMemoCache)) {
      // 第一块计算继续沿用早先尝试的结果，无需重复执行。
      assertLog([]);
    } else {
      // 中止尝试后缓存被克隆或重置，所以第一块需要再次处理。
      //
      // 第一块累计处理三次；启用 `enableNoCloningMemoCache` 时则只需一次。
      assertLog(['Some expensive processing... [A2]']);
    }
    expect(root).toMatchRenderedOutput(
      <>
        <div>Input: hi!</div>
        <div>Data: A2B2</div>
      </>,
    );
  });

  /**
   * Given：memo 结果被写入 state，组件仅在结果引用变化时执行渲染阶段 setState。
   * When：分别用编译器 memo cache 产物和标准 `useMemo` 挂载组件。
   * Then：两种实现都稳定产出结果，不因每轮生成新引用而无限重渲染。
   *
   * 验证机制：`act` 必须正常收敛，并断言两个独立根都输出 `<div>2</div>`。
   * 对应源码：`useMemoCache()` 的槽位持久化与 `renderWithHooksAgain()` 的重渲染上限路径。
   */
  it('(repro) infinite renders when used with setState during render', async () => {
    // `useUserMemo` 经 React Compiler 编译后的产物。
    /** 用两个 memo cache 槽位按输入身份复用数组结果。 */
    function useCompilerMemo(value) {
      let arr;
      const $ = useMemoCache(2);
      if ($[0] !== value) {
        arr = [value];
        $[0] = value;
        $[1] = arr;
      } else {
        arr = $[1];
      }
      return arr;
    }

    // 用作基线的手写源代码。
    /** 用标准 `useMemo` 实现与编译器产物等价的数组引用稳定性。 */
    function useManualMemo(value) {
      return useMemo(() => [value], [value]);
    }

    /** 把指定 memo Hook 包装为会在引用变化时同步 state 的回归测试组件。 */
    function makeComponent(hook) {
      return /** 比较 memo 结果与上一状态，仅在身份变化时安排渲染阶段更新，并输出稳定数组内容。 */ function Component({value}) {
        const state = hook(value);
        const [prevState, setPrevState] = useState(null);
        if (state !== prevState) {
          setPrevState(state);
        }
        return <div>{state.join(',')}</div>;
      };
    }

    /** 使用 `useMemoCache` 编译产物验证渲染能够收敛。 */
    let root = ReactNoop.createRoot();
    const CompilerMemoComponent = makeComponent(useCompilerMemo);
    await act(() => {
      root.render(<CompilerMemoComponent value={2} />);
    });
    expect(root).toMatchRenderedOutput(<div>2</div>);

    /** 使用标准 `useMemo` 基线验证相同场景能够收敛。 */
    root = ReactNoop.createRoot();
    const HookMemoComponent = makeComponent(useManualMemo);
    await act(() => {
      root.render(<HookMemoComponent value={2} />);
    });
    expect(root).toMatchRenderedOutput(<div>2</div>);
  });
});
