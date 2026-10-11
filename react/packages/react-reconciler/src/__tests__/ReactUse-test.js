/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** 测试运行期按当前特性开关重新加载的 React、渲染器、调度器与 Hook 引用。 */
let React;
let ReactNoop;
let Scheduler;
let act;
let use;
let useDebugValue;
let useState;
let useTransition;
let useMemo;
let useEffect;
let Suspense;
let startTransition;
let pendingTextRequests;
let waitFor;
let waitForPaint;
let assertLog;
let waitForAll;
let waitForMicrotasks;
let assertConsoleErrorDev;

/**
 * 集中验证 `use` 对 Promise、Context、异步子节点及重放期间 Hook 状态的处理。
 * 边界：每个用例都使用全新的模块实例与请求表，避免 thenable 状态跨用例泄漏。
 */
describe('ReactUse', () => {
  /** 在每个场景前重置模块、测试工具和待决文本请求，建立可重复的调度环境。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    use = React.use;
    useDebugValue = React.useDebugValue;
    useState = React.useState;
    useTransition = React.useTransition;
    useMemo = React.useMemo;
    useEffect = React.useEffect;
    Suspense = React.Suspense;
    startTransition = React.startTransition;

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    assertLog = InternalTestUtils.assertLog;
    waitForPaint = InternalTestUtils.waitForPaint;
    waitFor = InternalTestUtils.waitFor;
    waitForMicrotasks = InternalTestUtils.waitForMicrotasks;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;

    pendingTextRequests = new Map();
  });

  /**
   * 解析指定文本对应的全部模拟请求，并从待决表删除该批请求。
   * 边界：不存在请求时保持静默；同一文本的并发请求会一起完成。
   */
  function resolveTextRequests(text) {
    const requests = pendingTextRequests.get(text);
    if (requests !== undefined) {
      pendingTextRequests.delete(text);
      requests.forEach(resolve => resolve(text));
    }
  }

  /**
   * 创建一次完全不缓存的文本请求，用日志和待决表暴露每次重试是否重新发起 I/O。
   * 状态：同一文本可积累多个 resolve 回调，直至 `resolveTextRequests` 批量唤醒。
   */
  function getAsyncText(text) {
    // `getAsyncText` 完全不缓存：每次调用都会发起新的异步操作；测试据此验证
    // React 在 transition 重试期间仍能正确解包这种不稳定 thenable。
    Scheduler.log(`Async text requested [${text}]`);
    return new Promise(resolve => {
      const requests = pendingTextRequests.get(text);
      if (requests !== undefined) {
        requests.push(resolve);
        pendingTextRequests.set(text, requests);
      } else {
        pendingTextRequests.set(text, [resolve]);
      }
    });
  }

  /**
   * 规范化错误堆栈中的测试文件位置，过滤库内部帧并消除行列号波动。
   * 边界：空值原样返回，只保留属于当前测试文件的组件帧。
   */
  function normalizeCodeLocInfo(str) {
    return (
      str &&
      str.replace(
        /^ +(?:at|in) ([\S]+)([^\n]*)(\n?)/gm,
        function (m, name, location, eol) {
          if (location.indexOf(__filename) === -1) {
            // 库代码帧与本测试断言无关，过滤后可避免实现位置变化造成快照噪声。
            return '';
          }
          return (
            '    in ' +
            name +
            (/:\d+:\d+/.test(m)
              ? ' ' +
                location.replace(__dirname, '~').replace(/:\d+:\d+/, ':*:*')
              : '') +
            eol
          );
        },
      )
    );
  }

  /** 渲染给定文本并记录一次调度日志，供断言同时观察渲染顺序与最终输出。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  // 为降低 `use` 发布风险，这项行为被有意关闭；它会改变 `use` 之前旧版
  // Suspense 实现的表现。未来虽可能恢复，但既有 Suspense 代码计划迁移到
  // `use`，因此额外实现成本目前并不划算。
  // @gate TODO
  /**
   * 场景：微任务在挂起栈展开前 ping 当前 fiber（@gate TODO 保留的未启用期望）。
   * Given 异步组件抛出会在微任务中兑现的 Promise；When transition 首次渲染；
   * Then React 直接重试而不构造 fallback。验证机制：调度日志无 Loading 且根输出为 Async；
   * 对应源码：`ReactFiberThenable` 的 ping 与 work loop 挂起重试路径。
   */
  it('if suspended fiber is pinged in a microtask, retry immediately without unwinding the stack', async () => {
    let fulfilled = false;
    /** 首次调用挂起并安排微任务兑现，重试时返回已完成文本。 */
    function Async() {
      if (fulfilled) {
        return <Text text="Async" />;
      }
      Scheduler.log('Suspend!');
      throw Promise.resolve().then(() => {
        Scheduler.log('Resolve in microtask');
        fulfilled = true;
      });
    }

    /** 用 Suspense 包裹微任务挂起组件，以观察是否错误提交 fallback。 */
    function App() {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <Async />
        </Suspense>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(<App />);
      });
    });

    assertLog([
      // 异步组件挂起时 React 会让出当前工作。
      'Suspend!',
      'Resolve in microtask',

      // 无需展开渲染栈或准备 fallback 即可完成本次渲染。
      'Async',
    ]);
    expect(root).toMatchRenderedOutput('Async');
  });

  /**
   * 场景：transition 中的 Promise 在同一轮微任务兑现。
   * Given 根组件直接返回会短暂挂起的子组件；When transition 渲染完成微任务；
   * Then transition 不被长期阻塞。验证机制：日志按挂起、兑现、完成排序且输出 Async；
   * 对应源码：thenable ping 合并到当前 transition 的重试调度。
   */
  it('if suspended fiber is pinged in a microtask, it does not block a transition from completing', async () => {
    let fulfilled = false;
    /** 首次抛出微任务 Promise，兑现后的重放返回文本。 */
    function Async() {
      if (fulfilled) {
        return <Text text="Async" />;
      }
      Scheduler.log('Suspend!');
      throw Promise.resolve().then(() => {
        Scheduler.log('Resolve in microtask');
        fulfilled = true;
      });
    }

    /** 暴露无额外 Suspense 包装的异步子组件。 */
    function App() {
      return <Async />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(<App />);
      });
    });
    assertLog(['Suspend!', 'Resolve in microtask', 'Async']);
    expect(root).toMatchRenderedOutput('Async');
  });

  /**
   * 场景：用户代码错误地抛出已标记 fulfilled 的 thenable。
   * Given thenable 已完成却被组件反复抛出；When React 尝试渲染 Suspense 树；
   * Then React 停在 fallback 而非无限同步重试。验证机制：循环哨兵未触发且只观察预热重试；
   * 对应源码：work loop 对用户直接 throw thenable 的展开路径；这与 use 解包 fulfilled 值的路径不同。
   */
  it('does not infinite loop if already fulfilled thenable is thrown', async () => {
    // 已兑现 Promise 正常不应再被抛出；继续重试没有意义并可能形成死循环。
    // 该路径只模拟用户态 Suspense 库实现错误时的防御行为。

    // 构造一个已经兑现、但仍会被组件抛出的 thenable。
    const thenable = {
      /** 忽略 ping，确保测试只依赖 fulfilled 状态而非异步回调。 */
      then(ping) {},
      status: 'fulfilled',
      value: null,
    };

    let i = 0;
    /** 持续抛出已兑现 thenable，并以计数器侦测错误的无限重试。 */
    function Async() {
      if (i++ > 50) {
        throw new Error('Infinite loop detected');
      }
      Scheduler.log('Suspend!');
      // 该 thenable 既已兑现，本不应被抛出；这里验证 React 面对错误输入仍能安全退化。
      throw thenable;
    }

    /** 提供 fallback，以观察防循环路径最终提交的稳定 UI。 */
    function App() {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <Async />
        </Suspense>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App />);
    });
    assertLog([
      'Suspend!',
      'Loading...',
      // Suspense 预热隐藏树时会再尝试一次。
      'Suspend!',
    ]);
    expect(root).toMatchRenderedOutput('Loading...');
  });

  /**
   * 场景：组件顺序读取三个已兑现 Promise。
   * Given 三个稳定 Promise；When transition 调用 `use` 解包；Then 输出拼接值 ABC。
   * 验证机制：日志和根输出一致；对应源码：`use` dispatcher 与 thenable 状态跟踪。
   */
  it('basic use(promise)', async () => {
    const promiseA = Promise.resolve('A');
    const promiseB = Promise.resolve('B');
    const promiseC = Promise.resolve('C');

    /** 依声明顺序解包三个 Promise，并把结果交给日志文本组件。 */
    function Async() {
      const text = use(promiseA) + use(promiseB) + use(promiseC);
      return <Text text={text} />;
    }

    /** 用 Suspense 捕获 Promise 读取可能产生的挂起。 */
    function App() {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <Async />
        </Suspense>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(<App />);
      });
    });
    assertLog(['ABC']);
    expect(root).toMatchRenderedOutput('ABC');
  });

  /**
   * 场景：每次渲染都创建全新的已兑现 Promise。
   * Given Promise 身份在重试间不稳定；When `use` 依次解包三项；Then React 完成渲染并发出未缓存告警。
   * 验证机制：开发告警、ABC 日志和最终输出；对应源码：thenable 身份检测与 uncached-promise 警告。
   */
  it("using a promise that's not cached between attempts", async () => {
    /** 每次调用都创建三枚新 Promise，刻意触发未缓存 thenable 检测。 */
    function Async() {
      const text =
        use(Promise.resolve('A')) +
        use(Promise.resolve('B')) +
        use(Promise.resolve('C'));
      return <Text text={text} />;
    }

    /** 为不稳定 Promise 提供挂起边界。 */
    function App() {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <Async />
        </Suspense>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(<App />);
      });
    });
    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. Creating ' +
        'promises inside a Client Component or hook is not yet ' +
        'supported, except via a Suspense-compatible library or framework.\n' +
        '    in App (at **)',
    ]);
    assertLog(['ABC']);
    expect(root).toMatchRenderedOutput('ABC');
  });

  /**
   * 场景：`use` 读取已拒绝 Promise。
   * Given 中间 Promise 以 Oops 拒绝；When 组件依次读取 A/B/C；Then 拒绝原因交给错误边界。
   * 验证机制：边界两次恢复日志均为 Oops；对应源码：thenable rejected 分支与错误捕获流程。
   */
  it('using a rejected promise will throw', async () => {
    /** 捕获被 `use` 重新抛出的拒绝原因，并渲染错误消息。 */
    class ErrorBoundary extends React.Component {
      /** 保存最近一次捕获的错误；null 表示继续渲染子树。 */
      state = {error: null};
      /** 将渲染错误转换为可提交的边界状态。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 有错误时显示消息，否则透传子节点。 */
      render() {
        if (this.state.error) {
          return <Text text={this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    const promiseA = Promise.resolve('A');
    const promiseB = Promise.reject(new Error('Oops!'));
    const promiseC = Promise.resolve('C');

    // Jest/Node 若不显式等待会把它报告为未处理拒绝；浏览器运行时无需这一步。
    await expect(promiseB).rejects.toThrow('Oops!');

    /** 按序读取 Promise，使 B 的拒绝中止后续值组合。 */
    function Async() {
      const text = use(promiseA) + use(promiseB) + use(promiseC);
      return <Text text={text} />;
    }

    /** 把拒绝路径置于错误边界内，验证它不再表现为 Suspense 挂起。 */
    function App() {
      return (
        <ErrorBoundary>
          <Async />
        </ErrorBoundary>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(<App />);
      });
    });
    assertLog(['Oops!', 'Oops!']);
  });

  /**
   * 场景：父子两个组件分别调用多次 `use(promise)`。
   * Given 每个 fiber 各有自己的读取序列；When 父传递 AB、子追加 CD；Then 状态索引不会跨组件串扰。
   * 验证机制：只输出 ABCD；对应源码：每个正在渲染 fiber 的 thenableState 重置逻辑。
   */
  it('use(promise) in multiple components', async () => {
    // 验证用于跟踪 Promise 的状态会按组件重置。
    const promiseA = Promise.resolve('A');
    const promiseB = Promise.resolve('B');
    const promiseC = Promise.resolve('C');
    const promiseD = Promise.resolve('D');

    /** 在独立子 fiber 中读取 C、D，并接在父组件传入的前缀之后。 */
    function Child({prefix}) {
      return <Text text={prefix + use(promiseC) + use(promiseD)} />;
    }

    /** 在父 fiber 中读取 A、B，再把结果传入子组件。 */
    function Parent() {
      return <Child prefix={use(promiseA) + use(promiseB)} />;
    }

    /** 为跨组件 Promise 读取提供统一 Suspense 边界。 */
    function App() {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <Parent />
        </Suspense>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(<App />);
      });
    });
    assertLog(['ABCD']);
    expect(root).toMatchRenderedOutput('ABCD');
  });

  /**
   * 场景：相邻 fiber 使用不同状态的 thenable。
   * Given 首个兄弟读取 pending、第二个读取 fulfilled；When 同一边界渲染二者；Then pending 兄弟使整层显示 fallback。
   * 验证机制：仅记录 Loading；对应源码：thenableState 按 fiber 隔离及 Suspense 边界捕获。
   */
  it('use(promise) in multiple sibling components', async () => {
    // 验证 Promise 跟踪状态也会在兄弟组件之间重置。

    const promiseA = {
      /** 保持挂起且不主动 ping。 */
      then: () => {},
      status: 'pending',
      value: null
    };
    const promiseB = {
      /** 保持挂起且不主动 ping。 */
      then: () => {},
      status: 'pending',
      value: null
    };
    const promiseC = {
      /** 已完成 thenable 无需注册回调。 */
      then: () => {},
      status: 'fulfilled',
      value: 'C'
    };
    const promiseD = {
      /** 已完成 thenable 无需注册回调。 */
      then: () => {},
      status: 'fulfilled',
      value: 'D'
    };

    /** 读取两个永不兑现的 thenable，驱动边界进入 fallback。 */
    function Sibling1({prefix}) {
      return <Text text={use(promiseA) + use(promiseB)} />;
    }

    /** 读取两个已兑现值，用来侦测兄弟间状态索引是否污染。 */
    function Sibling2() {
      return <Text text={use(promiseC) + use(promiseD)} />;
    }

    /** 把两个状态不同的兄弟置于同一 Suspense 边界。 */
    function App() {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <Sibling1 />
          <Sibling2 />
        </Suspense>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(<App />);
      });
    });
    assertLog(['Loading...']);
    expect(root).toMatchRenderedOutput('Loading...');
  });

  /**
   * 场景：同一组件先因未缓存 Promise 挂起，重放后又抛出普通错误。
   * Given 每次渲染创建新 Promise 且完成后抛 Oops；When React 执行同步错误恢复与挂起重试；
   * Then React 禁用会循环的恢复车道并最终提交错误边界。验证机制：完整调度日志及最终错误文本；
   * 对应源码：work loop 的 suspended error recovery 与 lanes 重启策略。
   */
  it('erroring in the same component as an uncached promise does not result in an infinite loop', async () => {
    /** 捕获普通渲染错误，证明挂起恢复最终能稳定到错误 UI。 */
    class ErrorBoundary extends React.Component {
      /** null 表示尚未捕获；非空错误驱动替代 UI。 */
      state = {error: null};
      /** 把捕获的错误存入边界状态。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 根据捕获状态选择错误文本或原子树。 */
      render() {
        if (this.state.error) {
          return <Text text={'Caught an error: ' + this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    let i = 0;
    /** 每次先读取不缓存 Promise，成功越过挂起点后再抛出 Oops。 */
    function Async({
      // 有意在此解构属性，使生产环境的错误堆栈技巧从函数入口触发。
      prop,
    }) {
      if (i++ > 50) {
        throw new Error('Infinite loop detected');
      }
      try {
        use(Promise.resolve('Async'));
      } catch (e) {
        Scheduler.log('Suspend! [Async]');
        throw e;
      }
      throw new Error('Oops!');
    }

    /** 组合 Suspense 与错误边界，覆盖挂起和普通错误的交错恢复。 */
    function App() {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <ErrorBoundary>
            <Async />
          </ErrorBoundary>
        </Suspense>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(<App />);
      });
    });
    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. Creating ' +
        'promises inside a Client Component or hook is not yet ' +
        'supported, except via a Suspense-compatible library or framework.\n' +
        '    in App (at **)',
      'A component was suspended by an uncached promise. Creating ' +
        'promises inside a Client Component or hook is not yet ' +
        'supported, except via a Suspense-compatible library or framework.\n' +
        '    in App (at **)',
    ]);
    assertLog([
      // 首次尝试：未缓存 Promise 使组件挂起。
      'Suspend! [Async]',
      // Promise 已经兑现，因此在微任务中可以立即解包。
      //
      // 随后继续执行组件剩余部分，并抛出普通错误。
      'Caught an error: Oops!',

      // 同步错误恢复阶段无法复用这个新 Promise 的值，所以组件再次挂起。
      'Suspend! [Async]',
      'Loading...',

      // 错误恢复本身挂起后，React 无法判断错误是否真的修复，还是仅被挂起数据遮蔽。
      // 此处错误并未修复；若提交 fallback，便会进入无休止的错误恢复循环。
      //
      // 因此禁用这些 lanes 的错误恢复并从头开始。

      // 最后一轮重新抛错并提交错误边界结果。
      'Suspend! [Async]',
      'Caught an error: Oops!',
    ]);
    expect(root).toMatchRenderedOutput('Caught an error: Oops!');
  });

  /**
   * 场景：`use` 同步读取两个 Context。
   * Given A 由 Provider 覆盖、B 使用默认值；When 子组件调用 `use(Context)`；Then 合并得到 AB。
   * 验证机制：根输出断言；对应源码：`use` 对 Context Usable 的分派与 `readContext`。
   */
  it('basic use(context)', async () => {
    const ContextA = React.createContext('');
    const ContextB = React.createContext('B');

    /** 同步读取 A、B 两个 Context 并拼接当前值。 */
    function Sync() {
      const text = use(ContextA) + use(ContextB);
      return text;
    }

    /** 仅覆盖 ContextA，以同时验证 Provider 值与 ContextB 默认值。 */
    function App() {
      return (
        <ContextA.Provider value="A">
          <Sync />
        </ContextA.Provider>
      );
    }

    const root = ReactNoop.createRoot();
    root.render(<App />);
    await waitForAll([]);
    expect(root).toMatchRenderedOutput('AB');
  });

  /**
   * 场景：Context 栈尚在让出点时被高优更新中断。
   * Given lazy 子节点令首轮 transition 停顿；When flushSync 以新值重启；Then Context 游标被正确复位。
   * 验证机制：日志只读取 world! 且输出 Hello world!；对应源码：Context push/pop 与中断栈展开。
   */
  it('interrupting while yielded should reset contexts', async () => {
    let resolve;
    const promise = new Promise(r => {
      resolve = r;
    });

    const Context = React.createContext();

    const lazy = React.lazy(() => {
      return promise;
    });

    /** 通过 `use(Context)` 显示当前 Provider 值。 */
    function ContextText() {
      return <Text text={use(Context)} />;
    }

    /** 在 lazy 节点与 Context 消费者外建立 Provider，以暴露中断时的栈状态。 */
    function App({text}) {
      return (
        <div>
          <Context.Provider value={text}>
            {lazy}
            <ContextText />
          </Context.Provider>
        </div>
      );
    }

    const root = ReactNoop.createRoot();
    startTransition(() => {
      root.render(<App text="world" />);
    });
    await waitForPaint([]);
    expect(root).toMatchRenderedOutput(null);

    await resolve({default: <Text key="hi" text="Hello " />});

    // 用更高优先级更新中断首轮渲染。
    ReactNoop.flushSync(() => {
      root.render(<App text="world!" />);
    });

    assertLog(['Hello ', 'world!']);

    expect(root).toMatchRenderedOutput(<div>Hello world!</div>);
  });

  /**
   * 场景：用户用 try/catch 包裹会挂起的 `use(promise)`。
   * Given 未缓存 Promise 在组件内部被捕获；When transition 重放；Then React 发出专用误用警告。
   * 验证机制：检查 console.error 次数与文本；对应源码：SuspenseException 捕获检测。
   */
  it('warns if use(promise) is wrapped with try/catch block', async () => {
    /** 错误地捕获 `use` 的内部挂起异常，用来触发开发警告。 */
    function Async() {
      try {
        return <Text text={use(Promise.resolve('Async'))} />;
      } catch (e) {
        return <Text text="Fallback" />;
      }
    }

    spyOnDev(console, 'error').mockImplementation(() => {});
    /** 为 Async 提供正常 Suspense fallback，隔离 try/catch 误用本身。 */
    function App() {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <Async />
        </Suspense>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(<App />);
      });
    });

    if (__DEV__) {
      expect(console.error).toHaveBeenCalledTimes(1);
      expect(console.error.mock.calls[0][0]).toContain(
        '`use` was called from inside a try/catch block. This is not ' +
          'allowed and can lead to unexpected behavior. To handle errors ' +
          'triggered by `use`, wrap your component in a error boundary.',
      );
      console.error.mockRestore();
    }
  });

  // @gate enableSuspendingDuringWorkLoop
  /**
   * 场景：已有内容的边界在 transition 中读取完全未缓存请求。
   * Given 当前 UI 为 empty；When transition 切换到 Async 并解析当前同名请求批次；Then 旧 UI 保留直至重试完成。
   * 验证机制：请求日志、未缓存告警及最终 Async；对应源码：work-loop 挂起延迟与 transition 重试。
   */
  it('during a transition, can unwrap async operations even if nothing is cached', async () => {
    /** 每次渲染发起新的 Async 文本请求，刻意绕过缓存。 */
    function App() {
      return <Text text={use(getAsyncText('Async'))} />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <Suspense fallback={<Text text="Loading..." />}>
          <Text text="(empty)" />
        </Suspense>,
      );
    });
    assertLog(['(empty)']);
    expect(root).toMatchRenderedOutput('(empty)');

    await act(() => {
      startTransition(() => {
        root.render(
          <Suspense fallback={<Text text="Loading..." />}>
            <App />
          </Suspense>,
        );
      });
    });
    assertLog(['Async text requested [Async]']);
    expect(root).toMatchRenderedOutput('(empty)');

    await act(() => {
      resolveTextRequests('Async');
    });
    assertLog(['Async text requested [Async]', 'Async']);
    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '     in App (at **)',
    ]);
    expect(root).toMatchRenderedOutput('Async');
  });

  // @gate enableSuspendingDuringWorkLoop
  /**
   * 场景：新挂载的 Suspense 边界在 transition 首屏即挂起。
   * Given 根上没有可保留的既有内容；When 未缓存请求阻塞初次渲染；Then 仍立即显示 fallback。
   * 验证机制：Loading/两轮请求日志与最终 Async；对应源码：新边界与已显示边界的 fallback 判定。
   */
  it("does not prevent a Suspense fallback from showing if it's a new boundary, even during a transition", async () => {
    /** 发起每次重试都会更新身份的 Async 请求。 */
    function App() {
      return <Text text={use(getAsyncText('Async'))} />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(
          <Suspense fallback={<Text text="Loading..." />}>
            <App />
          </Suspense>,
        );
      });
    });
    // 即使初始渲染属于 transition，新边界仍必须显示 fallback。
    assertLog(['Async text requested [Async]', 'Loading...']);
    expect(root).toMatchRenderedOutput('Loading...');

    // 解析第一轮数据。
    await act(() => {
      resolveTextRequests('Async');
    });
    // 重试会发起新请求，因此还要等第二轮完成。
    // TODO：这种交互并不自然。直觉上 `act` 应等待新请求完成，但若它和本测试一样是
    // 模拟 I/O，且直到当前 `act` 内才创建，开发者又无法在外部命令式推进它；目前没有更好策略。
    assertLog(['Async text requested [Async]']);
    expect(root).toMatchRenderedOutput('Loading...');

    // 推进第二轮请求。
    await act(() => {
      resolveTextRequests('Async');
    });
    // 这一轮发生在重试期间，因此可以完成。
    assertLog(['Async text requested [Async]', 'Async']);
    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '     in App (at **)',
    ]);
    expect(root).toMatchRenderedOutput('Async');
  });

  // @gate enableSuspendingDuringWorkLoop
  /**
   * 场景：等待永不兑现数据时，同一根收到内容完全不同的新更新。
   * Given transition 卡在挂起请求；When 后续更新删除挂起组件；Then React 放弃旧工作并提交新内容。
   * 验证机制：日志出现 Something different；对应源码：挂起根的 fresh stack 重启与 lane 选择。
   */
  it('when waiting for data to resolve, a fresh update will trigger a restart', async () => {
    /** 始终读取永不解析请求，作为必须被新更新丢弃的旧工作。 */
    function App() {
      return <Text text={use(getAsyncText('Will never resolve'))} />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<Suspense fallback={<Text text="Loading..." />} />);
    });

    await act(() => {
      startTransition(() => {
        root.render(
          <Suspense fallback={<Text text="Loading..." />}>
            <App />
          </Suspense>,
        );
      });
    });
    assertLog(['Async text requested [Will never resolve]']);

    await act(() => {
      root.render(
        <Suspense fallback={<Text text="Loading..." />}>
          <Text text="Something different" />
        </Suspense>,
      );
    });
    assertLog(['Something different']);
  });

  // @gate enableSuspendingDuringWorkLoop
  /**
   * 场景：一个根挂起期间，另一个根完成独立更新。
   * Given root1 transition 等待 Hi；When root2 渲染 Do re mi 后解析 Hi；Then root1 工作仍保留并最终提交。
   * 验证机制：分别断言两个根输出；对应源码：并发根调度与挂起 lane 的独立保存。
   */
  it('when waiting for data to resolve, an update on a different root does not cause work to be dropped', async () => {
    const promise = getAsyncText('Hi');

    /** 在 root1 上读取预先创建的稳定 Promise。 */
    function App() {
      return <Text text={use(promise)} />;
    }

    const root1 = ReactNoop.createRoot();
    assertLog(['Async text requested [Hi]']);

    await act(() => {
      root1.render(<Suspense fallback={<Text text="Loading..." />} />);
    });

    // 在 root1 启动会挂起的 transition。
    await act(() => {
      startTransition(() => {
        root1.render(
          <Suspense fallback={<Text text="Loading..." />}>
            <App />
          </Suspense>,
        );
      });
    });
    assertLog([]);

    // root1 等待数据时，root2 独立渲染。
    const root2 = ReactNoop.createRoot();
    await act(() => {
      root2.render('Do re mi');
    });
    expect(root2).toMatchRenderedOutput('Do re mi');

    // root1 数据就绪后，其 transition 仍应继续完成。
    await act(async () => {
      await resolveTextRequests('Hi');
    });
    assertLog(['Hi']);
    expect(root1).toMatchRenderedOutput('Hi');
  });

  // @gate enableSuspendingDuringWorkLoop
  /**
   * 场景：组件因 `use` 挂起后，dispatcher 必须退出组件的 Hook 调用上下文。
   * Given transition 停在永不兑现请求；When 组件外直接调用 useState；Then 抛出 Invalid hook call。
   * 验证机制：异常文本断言；对应源码：renderWithHooks 挂起退出时切到 ContextOnlyDispatcher 的恢复路径。
   */
  it('while suspended, hooks cannot be called (i.e. current dispatcher is unset correctly)', async () => {
    /** 读取永不兑现请求，使 work loop 停留在挂起状态。 */
    function App() {
      return <Text text={use(getAsyncText('Will never resolve'))} />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<Suspense fallback={<Text text="Loading..." />} />);
    });

    await act(() => {
      startTransition(() => {
        root.render(
          <Suspense fallback={<Text text="Loading..." />}>
            <App />
          </Suspense>,
        );
      });
    });
    assertLog(['Async text requested [Will never resolve]']);

    // 此时位于组件外部，调用 Hook 必须报错。
    expect(useState).toThrow(
      'Invalid hook call. Hooks can only be called inside of the body of a ' +
        'function component.',
    );
  });

  /**
   * 场景：自定义 thenable 在 `then` 调用内同步兑现。
   * Given thenable 不等待微任务；When `use` 注册 resolve；Then 同步取得 Hi，绝不抛挂起异常。
   * 验证机制：flushSync 内完成且无 fallback；对应源码：`trackUsedThenable` 注册后再次读取同步状态。
   */
  it('unwraps thenable that fulfills synchronously without suspending', async () => {
    /** 构造同步兑现 thenable，并把任何挂起视为测试失败。 */
    function App() {
      const thenable = {
        /** 注册时立即回传 Hi，模拟同步 thenable。 */
        then(resolve) {
          // 不等待微任务，在 `then` 调用栈内同步完成。
          resolve('Hi');
        },
      };
      try {
        return <Text text={use(thenable)} />;
      } catch {
        throw new Error(
          '`use` should not suspend because the thenable resolved synchronously.',
        );
      }
    }
    // thenable 同步兑现，因此渲染也应同步结束且不出现 fallback。
    const root = ReactNoop.createRoot();
    ReactNoop.flushSync(() => {
      root.render(<App />);
    });
    assertLog(['Hi']);
    expect(root).toMatchRenderedOutput('Hi');
  });

  /**
   * 场景：正在挂起的 transition 之后又插入同优先级更新。
   * Given 首次更新让 Child 挂起；When 交错更新隐藏 Child；Then React 转去处理未尝试更新并最终正确重基。
   * 验证机制：三阶段调度日志及 empty 输出；对应源码：interleaved lanes、跳过更新与 rebase 队列。
   */
  it('does not suspend indefinitely if an interleaved update was skipped', async () => {
    /** 根据开关读取永不兑现请求或同步显示 Child。 */
    function Child({childShouldSuspend}) {
      return (
        <Text
          text={
            childShouldSuspend
              ? use(getAsyncText('Will never resolve'))
              : 'Child'
          }
        />
      );
    }

    let setChildShouldSuspend;
    let setShowChild;
    /** 管理显示与挂起两个独立状态，暴露交错更新的重基结果。 */
    function Parent() {
      const [showChild, _setShowChild] = useState(true);
      setShowChild = _setShowChild;

      const [childShouldSuspend, _setChildShouldSuspend] = useState(false);
      setChildShouldSuspend = _setChildShouldSuspend;

      Scheduler.log(
        `childShouldSuspend: ${childShouldSuspend}, showChild: ${showChild}`,
      );
      return showChild ? (
        <Child childShouldSuspend={childShouldSuspend} />
      ) : (
        <Text text="(empty)" />
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<Parent />);
    });
    assertLog(['childShouldSuspend: false, showChild: true', 'Child']);
    expect(root).toMatchRenderedOutput('Child');

    await act(async () => {
      // 安排一个会使应用挂起的更新。
      startTransition(() => {
        setChildShouldSuspend(true);
      });
      await waitFor(['childShouldSuspend: true, showChild: true']);
      // 前一更新仍在进行时，再安排一个同优先级更新。
      startTransition(() => {
        setShowChild(false);
      });
    });
    assertLog([
      // 交错更新优先级不高于当前工作，所以不会立即中断；首个更新继续并挂起。
      'Async text requested [Will never resolve]',

      // React 不等待 Promise，而是发现另一个尚未尝试的待处理更新并转去渲染它。
      //
      // 新更新隐藏此前挂起的组件，因此可以成功完成。
      'childShouldSuspend: false, showChild: false',
      '(empty)',

      // 最后再次渲染首个更新；它已重基到“隐藏组件”的更新之上，因此也能完成。
      // 注意：这里两次 transition 恰好未纠缠；若纠缠，首个更新会并入上一轮且不会
      // 多一次渲染。纠缠启发式未来可能改变，但语义不应改变；React 通常仍希望尽可能
      // 并行处理 transition，所以本例虽多渲染一次，却证明二者可保持独立。
      'childShouldSuspend: true, showChild: false',
      '(empty)',
    ]);
    expect(root).toMatchRenderedOutput('(empty)');
  });

  // @gate enableSuspendingDuringWorkLoop
  /**
   * 场景：重放在中间 `use` 处挂起的组件时复用前置 useMemo。
   * Given 大写计算位于异步读取前、闪光计算位于其后；When请求完成并重放；Then 前者不重复、后者正常执行。
   * 验证机制：日志缺少第二次 Compute uppercase；对应源码：挂起重放的 Hook 状态复用。
   */
  it('when replaying a suspended component, reuses the hooks computed during the previous attempt (Memo)', async () => {
    /** 串联同步 memo、异步 `use` 与后置 memo，检测重放分界点。 */
    function ExcitingText({text}) {
      // 模拟昂贵的大写转换；挂起重放时应复用这段计算。
      const uppercaseText = useMemo(() => {
        Scheduler.log('Compute uppercase: ' + text);
        return text.toUpperCase();
      }, [text]);

      // 模拟发送到服务端的异步加工，为文本追加感叹号。
      const exclamatoryText = use(getAsyncText(uppercaseText + '!'));

      // 用闪光符号包裹文本，证明 Hook 序列中途挂起不会破坏后续 Hook。
      const sparklingText = useMemo(() => {
        Scheduler.log('Add sparkles: ' + exclamatoryText);
        return `✨ ${exclamatoryText} ✨`;
      }, [exclamatoryText]);

      return <Text text={sparklingText} />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(<ExcitingText text="Hello" />);
      });
    });

    // 等待异步服务响应时挂起。
    assertLog(['Compute uppercase: Hello', 'Async text requested [HELLO!]']);
    expect(root).toMatchRenderedOutput(null);

    // 模拟异步数据到达。
    await act(() => {
      resolveTextRequests('HELLO!');
    });
    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in ExcitingText (at **)',
    ]);

    assertLog([
      // 可复用上一轮结果，不应再次执行大写计算。
      // 'Compute uppercase: Hello',

      'Async text requested [HELLO!]',
      'Add sparkles: HELLO!',
      '✨ HELLO! ✨',
    ]);
  });

  // @gate enableSuspendingDuringWorkLoop
  /**
   * 场景：挂起点前后的两个 useState 在重放与更新中保持槽位。
   * Given fruit 状态位于 `use` 前、vegetable 位于其后；When 分别更新两者并解析请求；Then 未更新状态持续保留。
   * 验证机制：apple/carrot/dill/banana 输出序列；对应源码：replay dispatcher 的 Hook 克隆与状态队列对齐。
   */
  it('when replaying a suspended component, reuses the hooks computed during the previous attempt (State)', async () => {
    let _setFruit;
    let _setVegetable;
    /** 在异步读取前后各放置一个状态 Hook，以验证重放槽位完整性。 */
    function Kitchen() {
      const [fruit, setFruit] = useState('apple');
      _setFruit = setFruit;
      const usedFruit = use(getAsyncText(fruit));
      const [vegetable, setVegetable] = useState('carrot');
      _setVegetable = setVegetable;
      return <Text text={usedFruit + ' ' + vegetable} />;
    }

    // 初次渲染并完成 apple 请求。
    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(<Kitchen />);
      });
    });
    assertLog(['Async text requested [apple]']);
    expect(root).toMatchRenderedOutput(null);
    await act(() => {
      resolveTextRequests('apple');
    });
    assertLog(['Async text requested [apple]', 'apple carrot']);
    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in Kitchen (at **)',
    ]);

    expect(root).toMatchRenderedOutput('apple carrot');

    // 更新位于 `use` 之后的状态变量。
    await act(() => {
      startTransition(() => {
        _setVegetable('dill');
      });
    });
    assertLog(['Async text requested [apple]']);
    expect(root).toMatchRenderedOutput('apple carrot');
    await act(() => {
      resolveTextRequests('apple');
    });
    assertLog(['Async text requested [apple]', 'apple dill']);
    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in Kitchen (at **)',
    ]);

    expect(root).toMatchRenderedOutput('apple dill');

    // 更新位于 `use` 之前的状态变量；后置状态仍必须保留。
    await act(() => {
      startTransition(() => {
        _setFruit('banana');
      });
    });
    assertLog(['Async text requested [banana]']);
    expect(root).toMatchRenderedOutput('apple dill');
    await act(() => {
      resolveTextRequests('banana');
    });
    assertLog(['Async text requested [banana]', 'banana dill']);
    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in Kitchen (at **)',
    ]);
    expect(root).toMatchRenderedOutput('banana dill');
  });

  // @gate enableSuspendingDuringWorkLoop
  /**
   * 场景：非状态 Hook 位于挂起点前时，重放不会误报 Hook 顺序变化。
   * Given useDebugValue、`use`、useState 顺序固定；When更新后置 state 并经历重放；Then无 mismatch 且状态更新生效。
   * 验证机制：西语/法语输出与告警集合；对应源码：Hook 类型追踪及 replay dispatcher。
   */
  it('when replaying a suspended component, reuses the hooks computed during the previous attempt (DebugValue+State)', async () => {
    // 确保 `use` 前存在无状态 Hook 时，更新不会产生 Hook 不匹配警告。
    let _setLawyer;
    /** 组合无状态调试 Hook、异步读取和状态 Hook，验证重放顺序。 */
    function Lexicon() {
      useDebugValue(123);
      const avocado = use(getAsyncText('aguacate'));
      const [lawyer, setLawyer] = useState('abogado');
      _setLawyer = setLawyer;
      return <Text text={avocado + ' ' + lawyer} />;
    }

    // 初次渲染并解析西语请求。
    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(<Lexicon />);
      });
    });
    assertLog(['Async text requested [aguacate]']);
    expect(root).toMatchRenderedOutput(null);
    await act(() => {
      resolveTextRequests('aguacate');
    });
    assertLog(['Async text requested [aguacate]', 'aguacate abogado']);
    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in Lexicon (at **)',
    ]);
    expect(root).toMatchRenderedOutput('aguacate abogado');

    // 随后只更新状态 Hook。
    await act(() => {
      startTransition(() => {
        _setLawyer('avocat');
      });
    });
    assertLog(['Async text requested [aguacate]']);
    expect(root).toMatchRenderedOutput('aguacate abogado');
    await act(() => {
      resolveTextRequests('aguacate');
    });
    assertLog(['Async text requested [aguacate]', 'aguacate avocat']);
    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in Lexicon (at **)',
    ]);
    expect(root).toMatchRenderedOutput('aguacate avocat');
  });

  // @gate enableSuspendingDuringWorkLoop
  /**
   * 场景：用 useMemo 固定异步函数返回的 Promise 身份。
   * Given异步请求由 text 依赖创建；When请求完成后组件重放；Then不重新调用异步函数。
   * 验证机制：日志中请求行只出现一次；对应源码：重放期间 memoizedState 复用。
   */
  it(
    'wrap an async function with useMemo to skip running the function ' +
      'twice when loading new data',
    async () => {
      /** 按 text 缓存异步 Promise，再由 `use` 解包其最终文本。 */
      function App({text}) {
        const promiseForText = useMemo(async () => getAsyncText(text), [text]);
        const asyncText = use(promiseForText);
        return <Text text={asyncText} />;
      }

      const root = ReactNoop.createRoot();
      await act(() => {
        startTransition(() => {
          root.render(<App text="Hello" />);
        });
      });
      assertLog(['Async text requested [Hello]']);
      expect(root).toMatchRenderedOutput(null);

      await act(() => {
        resolveTextRequests('Hello');
      });
      assertLog([
        // 异步函数已被 memo，不应再次请求文本。
        // 'Async text requested [Hello]'

        'Hello',
      ]);
    },
  );

  /**
   * 场景：三层嵌套 Suspense 读取三个预先缓存的 Promise。
   * Given A/B/C 独立待决；When 由外至内依次解析；Then每层按顺序揭示且不阻塞已完成外层。
   * 验证机制：每次根输出从 fallback 递进为 ABC；对应源码：嵌套边界捕获、预热与 retry lanes。
   */
  it('load multiple nested Suspense boundaries', async () => {
    const promiseA = getAsyncText('A');
    const promiseB = getAsyncText('B');
    const promiseC = getAsyncText('C');
    assertLog([
      'Async text requested [A]',
      'Async text requested [B]',
      'Async text requested [C]',
    ]);

    /** 解包传入的稳定 Promise，并记录对应文本。 */
    function AsyncText({promise}) {
      return <Text text={use(promise)} />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <Suspense fallback={<Text text="(Loading A...)" />}>
          <AsyncText promise={promiseA} />
          <Suspense fallback={<Text text="(Loading B...)" />}>
            <AsyncText promise={promiseB} />
            <Suspense fallback={<Text text="(Loading C...)" />}>
              <AsyncText promise={promiseC} />
            </Suspense>
          </Suspense>
        </Suspense>,
      );
    });
    assertLog([
      '(Loading A...)',
      // 隐藏树预热时会访问更深层 fallback。
      '(Loading C...)',
      '(Loading B...)',
    ]);
    expect(root).toMatchRenderedOutput('(Loading A...)');

    await act(() => {
      resolveTextRequests('A');
    });
    assertLog(['A', '(Loading B...)']);
    expect(root).toMatchRenderedOutput('A(Loading B...)');

    await act(() => {
      resolveTextRequests('B');
    });
    assertLog(['B', '(Loading C...)']);
    expect(root).toMatchRenderedOutput('AB(Loading C...)');

    await act(() => {
      resolveTextRequests('C');
    });
    assertLog(['C']);
    expect(root).toMatchRenderedOutput('ABC');
  });

  // @gate enableSuspendingDuringWorkLoop
  /**
   * 场景：三层边界每次重试都重新发起请求。
   * Given A/B/C 均不缓存；When每个文本连续解析两轮；Then边界仍可逐层推进至 ABC。
   * 验证机制：重复请求日志、未缓存告警和阶段输出；对应源码：工作循环内挂起重试与边界渐进揭示。
   */
  it('load multiple nested Suspense boundaries (uncached requests)', async () => {
    // 与上一用例相同，但请求不缓存；即使出现重复请求，整棵树最终仍应完成。
    /** 每次渲染都为相同文本创建新请求，迫使每层经历额外重试。 */
    function AsyncText({text}) {
      // 每次渲染都会发起新请求。
      return <Text text={use(getAsyncText(text))} />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <Suspense fallback={<Text text="(Loading A...)" />}>
          <AsyncText text="A" />
          <Suspense fallback={<Text text="(Loading B...)" />}>
            <AsyncText text="B" />
            <Suspense fallback={<Text text="(Loading C...)" />}>
              <AsyncText text="C" />
            </Suspense>
          </Suspense>
        </Suspense>,
      );
    });
    assertLog(['Async text requested [A]', '(Loading A...)']);
    expect(root).toMatchRenderedOutput('(Loading A...)');

    await act(() => {
      resolveTextRequests('A');
    });
    assertLog(['Async text requested [A]']);
    expect(root).toMatchRenderedOutput('(Loading A...)');

    await act(() => {
      resolveTextRequests('A');
    });
    assertLog([
      // React 持续挂起，直到 A 完成加载。
      'Async text requested [A]',
      'A',

      // 此时 React 可以继续渲染其余子树。

      // 内层请求不会阻止 A 出现，而是由其自身边界显示 fallback。
      'Async text requested [B]',
      '(Loading B...)',
    ]);
    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in AsyncText (at **)',
    ]);
    expect(root).toMatchRenderedOutput('A(Loading B...)');

    await act(() => {
      resolveTextRequests('B');
    });
    assertLog(['Async text requested [B]']);
    expect(root).toMatchRenderedOutput('A(Loading B...)');

    await act(() => {
      resolveTextRequests('B');
    });
    assertLog([
      // React 持续挂起，直到 B 完成加载。
      'Async text requested [B]',
      'B',

      // C 的挂起不会阻止 B 出现，而由最内层 fallback 接管。
      'Async text requested [C]',
      '(Loading C...)',
    ]);
    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in AsyncText (at **)',
    ]);
    expect(root).toMatchRenderedOutput('AB(Loading C...)');

    await act(() => {
      resolveTextRequests('C');
    });
    assertLog(['Async text requested [C]']);
    expect(root).toMatchRenderedOutput('AB(Loading C...)');

    await act(() => {
      resolveTextRequests('C');
    });
    assertLog(['Async text requested [C]', 'C']);
    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in AsyncText (at **)',
    ]);
    expect(root).toMatchRenderedOutput('ABC');
  });

  /**
   * 场景：组件在 `use` 之间触发 render-phase state update。
   * Given首次计数为 0 且渲染中改为 1；When Promise 与状态重渲染交错；Then最终使用最新计数 A1。
   * 验证机制：日志、两条未缓存警告与输出；对应源码：render-phase update 循环及 thenable Hook 索引复位。
   */
  it('use() combined with render phase updates', async () => {
    /** 在两个 `use` 读取之间安排渲染阶段状态更新。 */
    function Async() {
      const a = use(Promise.resolve('A'));
      const [count, setCount] = useState(0);
      if (count === 0) {
        setCount(1);
      }
      const usedCount = use(Promise.resolve(count));
      return <Text text={a + usedCount} />;
    }

    /** 为渲染阶段更新中的 Promise 挂起提供边界。 */
    function App() {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <Async />
        </Suspense>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(<App />);
      });
    });
    assertLog(['A1']);
    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in App (at **)',
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in App (at **)',
    ]);
    expect(root).toMatchRenderedOutput('A1');
  });

  /**
   * 场景：Promise 直接作为根子节点而非传给 `use`。
   * Given Promise 解析为 React 元素；When reconciler 处理根 child；Then透明解包并渲染 Hi。
   * 验证机制：日志与根输出；对应源码：`unwrapThenable` 的 child reconciliation 分支。
   */
  it('basic promise as child', async () => {
    const promise = Promise.resolve(<Text text="Hi" />);
    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(promise);
      });
    });
    assertLog(['Hi']);
    expect(root).toMatchRenderedOutput('Hi');
  });

  // @gate enableSuspendingDuringWorkLoop
  /**
   * 场景：客户端函数组件本身声明为 async。
   * Given组件等待未缓存文本；When transition 渲染并解析 Hi；Then React重放并产生两类开发告警。
   * 验证机制：请求/完成日志、告警和最终输出；对应源码：async client component 检测与返回 thenable 解包。
   */
  it('basic async component', async () => {
    /** 等待模拟请求后返回 Hi，用于触发 async Client Component 路径。 */
    async function App() {
      await getAsyncText('Hi');
      return <Text text="Hi" />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(<App />);
      });
    });
    assertLog(['Async text requested [Hi]']);
    assertConsoleErrorDev([
      '<App> is an async Client Component. ' +
        'Only Server Components can be async at the moment. ' +
        "This error is often caused by accidentally adding `'use client'` " +
        'to a module that was originally written for the server.\n' +
        '    in App (at **)',
    ]);
    await act(() => resolveTextRequests('Hi'));
    assertLog([
      // TODO：理想情况下无需重放函数体，应直接进入 reconciliation。
      'Async text requested [Hi]',
      'Hi',
    ]);
    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in App (at **)',
    ]);
    expect(root).toMatchRenderedOutput('Hi');
  });

  // @gate enableSuspendingDuringWorkLoop
  /**
   * 场景：非函数 fiber（类组件）的 render 返回 Promise。
   * Given异步 render 等待 Hi；When请求解析；Then reconciler 解包结果并提交文本。
   * 验证机制：重复请求日志、未缓存警告和输出；对应源码：非函数组件返回 Usable 的协调路径。
   */
  it('async child of a non-function component (e.g. a class)', async () => {
    /** 通过异步 `render` 返回 React 元素，覆盖类组件 child 的 thenable 处理。 */
    class App extends React.Component {
      /** 等待 Hi 后返回文本元素；重试期间可能再次调用。 */
      async render() {
        const text = await getAsyncText('Hi');
        return <Text text={text} />;
      }
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      startTransition(() => {
        root.render(<App />);
      });
    });
    assertLog(['Async text requested [Hi]']);

    await act(async () => resolveTextRequests('Hi'));
    assertLog([
      // TODO：无需再次执行 render，理论上可直接进入 reconciliation；不过非函数组件
      // fiber 的优化优先级较低，当前可先对其保留特殊路径。
      'Async text requested [Hi]',
      'Hi',
    ]);
    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in App (at **)',
    ]);
    expect(root).toMatchRenderedOutput('Hi');
  });

  /**
   * 场景：作为 child 的 fulfilled Usable 嵌套另一层 fulfilled Usable。
   * Given外层 value 仍是 thenable；When reconciler 处理节点；Then递归解包直至得到 React 元素。
   * 验证机制：最终 Hi 输出；对应源码：child reconciliation 对 Usable 的递归调用。
   */
  it('async children are recursively unwrapped', async () => {
    // 这是 Usable 套 Usable；`use` 一次只解包一层，但作为 child 时，reconciler
    // 会递归解包，直到结果不再是 Usable。
    const thenable = {
      /** 外层已兑现，无需注册异步回调。 */
      then() {},
      status: 'fulfilled',
      value: {
        /** 内层同样已兑现，最终 value 是 React 元素。 */
        then() {},
        status: 'fulfilled',
        value: <Text text="Hi" />,
      },
    };
    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(thenable);
    });
    assertLog(['Hi']);
    expect(root).toMatchRenderedOutput('Hi');
  });

  /**
   * 场景：顶层 async 组件返回的 Promise 在协调前透明解包。
   * Given返回元素身份随 text 更新；When A 更新为 B；Then解包后的 Child 收到新 text，并重新执行依赖 text 的 effect。
   * 验证机制：效果日志和根输出；对应源码：async child 解包后继续 reconcileChildFibers。
   */
  it('async children are transparently unwrapped before being reconciled (top level)', async () => {
    /** 记录每次 text 生效的 effect，用于区分更新与错误的 Promise 节点处理。 */
    function Child({text}) {
      useEffect(() => {
        Scheduler.log(`Mount: ${text}`);
      }, [text]);
      return <Text text={text} />;
    }

    /** 返回 Promise 包装的 Child；reconciler 应协调其结果而非 Promise 对象。 */
    async function App({text}) {
      // async 函数始终返回 Promise；React 应先解包，再协调得到的 Child。
      return <Child text={text} />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(<App text="A" />);
      });
    });
    assertLog(['A', 'Mount: A']);
    assertConsoleErrorDev([
      '<App> is an async Client Component. ' +
        'Only Server Components can be async at the moment. ' +
        "This error is often caused by accidentally adding `'use client'` " +
        'to a module that was originally written for the server.\n' +
        '    in App (at **)',
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in App (at **)',
    ]);
    expect(root).toMatchRenderedOutput('A');

    // 更新 Child 的 text；下方 Mount: B 是依赖变化导致的 effect 执行日志。
    await act(() => {
      startTransition(() => {
        root.render(<App text="B" />);
      });
    });
    assertLog(['B', 'Mount: B']);
    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in App (at **)',
    ]);
    expect(root).toMatchRenderedOutput('B');
  });

  /**
   * 场景：多个 Promise 作为同级 children。
   * Given三枚 Promise 各自解析为 Child；When以相同顺序再次渲染；Then全部复用且 effect 不重挂载。
   * 验证机制：第二轮只有渲染日志；对应源码：解包后的 sibling slot reconciliation。
   */
  it('async children are transparently unwrapped before being reconciled (siblings)', async () => {
    /** 记录渲染与 effect，使兄弟 child 是否重挂载可观察。 */
    function Child({text}) {
      useEffect(() => {
        Scheduler.log(`Mount: ${text}`);
      }, [text]);
      return <Text text={text} />;
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      startTransition(() => {
        root.render(
          <>
            {Promise.resolve(<Child text="A" />)}
            {Promise.resolve(<Child text="B" />)}
            {Promise.resolve(<Child text="C" />)}
          </>,
        );
      });
    });
    assertLog(['A', 'B', 'C', 'Mount: A', 'Mount: B', 'Mount: C']);
    expect(root).toMatchRenderedOutput('ABC');

    await act(() => {
      startTransition(() => {
        root.render(
          <>
            {Promise.resolve(<Child text="A" />)}
            {Promise.resolve(<Child text="B" />)}
            {Promise.resolve(<Child text="C" />)}
          </>,
        );
      });
    });
    // 所有兄弟均应复用，不得重新挂载 effect。
    assertLog(['A', 'B', 'C']);
    expect(root).toMatchRenderedOutput('ABC');
  });

  /**
   * 场景：Promise 包装的 keyed siblings 交换顺序。
   * Given A/B/C 各有稳定 key；When B 与 A 对调；Then按 key 移动既有 fiber，effect 不重挂载。
   * 验证机制：仅出现 B/A/C 渲染日志；对应源码：解包后 keyed array reconciliation。
   */
  it('async children are transparently unwrapped before being reconciled (siblings, reordered)', async () => {
    /** 记录 keyed child 的渲染及挂载效果。 */
    function Child({text}) {
      useEffect(() => {
        Scheduler.log(`Mount: ${text}`);
      }, [text]);
      return <Text text={text} />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(
          <>
            {Promise.resolve(<Child key="A" text="A" />)}
            {Promise.resolve(<Child key="B" text="B" />)}
            {Promise.resolve(<Child key="C" text="C" />)}
          </>,
        );
      });
    });
    assertLog(['A', 'B', 'C', 'Mount: A', 'Mount: B', 'Mount: C']);
    expect(root).toMatchRenderedOutput('ABC');

    await act(() => {
      startTransition(() => {
        root.render(
          <>
            {Promise.resolve(<Child key="B" text="B" />)}
            {Promise.resolve(<Child key="A" text="A" />)}
            {Promise.resolve(<Child key="C" text="C" />)}
          </>,
        );
      });
    });
    // key 允许全部复用，不应重新挂载。
    assertLog(['B', 'A', 'C']);
    expect(root).toMatchRenderedOutput('BAC');
  });

  /**
   * 场景：Context 对象本身作为树节点，并经过 memoized 中间层。
   * Given Provider value 是 Child 元素；When value 更新或更换 key；Then消费节点绕过中间层并按身份更新/重挂载。
   * 验证机制：Indirection、父节点、Mount/Unmount 日志；对应源码：Context child 的读取与传播依赖标记。
   */
  it('basic Context as node', async () => {
    const Context = React.createContext(null);

    /** 记录中间层是否因仅 Context 值变化而重新执行。 */
    function Indirection({children}) {
      Scheduler.log('Indirection');
      return children;
    }

    /** 返回 Context 对象作为 child，并记录其父 fiber 是否重渲染。 */
    function ParentOfContextNode() {
      Scheduler.log('ParentOfContextNode');
      return Context;
    }

    /** 记录 Context value 中元素的挂载与卸载，以区分更新和替换。 */
    function Child({text}) {
      useEffect(() => {
        Scheduler.log('Mount');
        return () => {
          Scheduler.log('Unmount');
        };
      }, []);
      return <Text text={text} />;
    }

    /** 固定中间子树，只通过 Provider value 推送 React 节点更新。 */
    function App({contextValue, children}) {
      const memoizedChildren = useMemo(
        () => (
          <Indirection>
            <ParentOfContextNode />
          </Indirection>
        ),
        [children],
      );
      return (
        <Context.Provider value={contextValue}>
          {memoizedChildren}
        </Context.Provider>
      );
    }

    // 初次渲染 Context 节点。
    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App contextValue={<Child text="A" />} />);
    });
    assertLog(['Indirection', 'ParentOfContextNode', 'A', 'Mount']);
    expect(root).toMatchRenderedOutput('A');

    // 将 Context 中的 Child 更新为新文本但保留类型与 key。
    await act(async () => {
      root.render(<App contextValue={<Child text="B" />} />);
    });
    assertLog([
      // 更新通过 Context 传播，因此 <Indirection /> 没有重新渲染。

      // TODO：Context 节点的父组件本不必重新渲染。当前需要重新协调父级 children，
      // 但理论上可以跳过组件求值，直接进入 reconciliation；一种办法是在 Context
      // 依赖上标记“由 reconciliation 阶段添加”。
      'ParentOfContextNode',

      // 这里是更新而非重新挂载。
      'B',
    ]);
    expect(root).toMatchRenderedOutput('B');

    // 更换 key，删除旧 Child 并挂载新实例。
    await act(async () => {
      root.render(<App contextValue={<Child key="C" text="C" />} />);
    });
    assertLog([
      'ParentOfContextNode',

      // 新实例完成挂载。
      'C',
      'Unmount',
      'Mount',
    ]);
  });

  /**
   * 场景：Context 对象直接作为根节点。
   * Given Context 默认值是一枚 Text 元素；When root.render(Context)；Then reconciler 读取默认值并渲染 Hi。
   * 验证机制：日志和输出；对应源码：根 child 对 Context Usable 的处理。
   */
  it('context as node, at the root', async () => {
    const Context = React.createContext(<Text text="Hi" />);
    const root = ReactNoop.createRoot();
    await act(async () => {
      startTransition(() => {
        root.render(Context);
      });
    });
    assertLog(['Hi']);
    expect(root).toMatchRenderedOutput('Hi');
  });

  /**
   * 场景：Promise 先解析为 Context，再由 Context 解析为 React 节点。
   * Given两层不同类型的 Usable；When Promise 作为根 child；Then递归解包到默认元素 Hi。
   * 验证机制：根输出；对应源码：thenable 与 Context child 的递归协调。
   */
  it('promises that resolves to a context, rendered as a node', async () => {
    const Context = React.createContext(<Text text="Hi" />);
    const promise = Promise.resolve(Context);
    const root = ReactNoop.createRoot();
    await act(async () => {
      startTransition(() => {
        root.render(promise);
      });
    });
    assertLog(['Hi']);
    expect(root).toMatchRenderedOutput('Hi');
  });

  /**
   * 场景：forwardRef 组件内部读取未缓存 Promise。
   * Given组件同时建立 imperative handle 与异步文本；When transition 重放；Then文本和 ref 实例都正确提交。
   * 验证机制：Async 输出、开发告警和 ref.current；对应源码：ForwardRef renderWithHooks 重放与 layout ref 提交。
   */
  it('unwrap uncached promises inside forwardRef', async () => {
    /** 作为 imperative handle 暴露的稳定实例。 */
    const asyncInstance = {};
    /** 在 ForwardRef render 中同时设置 ref 并解包未缓存 Promise。 */
    const Async = React.forwardRef((props, ref) => {
      React.useImperativeHandle(ref, () => asyncInstance);
      const text = use(Promise.resolve('Async'));
      return <Text text={text} />;
    });

    const ref = React.createRef();
    /** 用 Suspense 包裹 ForwardRef，以验证挂起重放不丢失 ref。 */
    function App() {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <Async ref={ref} />
        </Suspense>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(<App />);
      });
    });
    assertLog(['Async']);
    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in App (at **)',
    ]);
    expect(root).toMatchRenderedOutput('Async');
    expect(ref.current).toBe(asyncInstance);
  });

  /**
   * 场景：memo 组件内部读取未缓存 Promise，并由自定义比较器控制 bailout。
   * Given相同 text 后接不同 text；When连续 transition 更新；Then相同值跳过、不同值重放并提交。
   * 验证机制：空日志与 Async! 日志/输出；对应源码：MemoComponent bailout 与 Hook thenable 重放。
   */
  it('unwrap uncached promises inside memo', async () => {
    /** 按 props.text 比较并在实际渲染时解包对应 Promise 的 memo 组件。 */
    const Async = React.memo(
      props => {
        const text = use(Promise.resolve(props.text));
        return <Text text={text} />;
      },
      (a, b) => a.text === b.text,
    );

    /** 为 memo 子组件提供 Suspense，并传递待比较文本。 */
    function App({text}) {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <Async text={text} />
        </Suspense>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(<App text="Async" />);
      });
    });
    assertLog(['Async']);
    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in App (at **)',
    ]);
    expect(root).toMatchRenderedOutput('Async');

    // 更新为相同值。
    await act(() => {
      startTransition(() => {
        root.render(<App text="Async" />);
      });
    });
    // memo 比较命中，不应重新渲染。
    assertLog([]);
    expect(root).toMatchRenderedOutput('Async');

    // 更新为不同值，必须重新渲染。
    await act(() => {
      startTransition(() => {
        root.render(<App text="Async!" />);
      });
    });
    assertLog(['Async!']);
    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in App (at **)',
    ]);
    expect(root).toMatchRenderedOutput('Async!');
  });

  // @gate !disableLegacyContext && !disableLegacyContextForFunctionComponents
  /**
   * 场景：读取 legacy context 的函数组件内部使用未缓存 Promise。
   * Given普通函数组件与 memo 包装组件共享旧 Context；When transition 渲染；Then二者都正确组合 context 与 label。
   * 验证机制：两条输出及 legacy/Promise 警告；对应源码：legacy context 注入、MemoComponent 与 `use` 重放。
   */
  it('unwrap uncached promises in component that accesses legacy context', async () => {
    /** 通过旧 childContextTypes API 向子树提供 legacyContext。 */
    class ContextProvider extends React.Component {
      /** 声明旧 Context 字段及其运行时校验器。 */
      static childContextTypes = {
        /** 接受测试中的 legacyContext 值，不执行额外校验。 */
        legacyContext() {},
      };
      /** 返回供旧 Context 消费者读取的 Async 文本。 */
      getChildContext() {
        return {legacyContext: 'Async'};
      }
      /** Provider 本身不改变子树结构。 */
      render() {
        return this.props.children;
      }
    }

    /** 从第二参数读取旧 Context，并以未缓存 Promise 拼接 label。 */
    function Async({label}, context) {
      const text = use(Promise.resolve(context.legacyContext + ` (${label})`));
      return <Text text={text} />;
    }
    /** 声明函数组件需要的旧 Context 字段。 */
    Async.contextTypes = {
      /** 接受 legacyContext，不执行额外校验。 */
      legacyContext: () => {},
    };

    /** 用 label 比较器包装同一旧 Context 消费组件。 */
    const AsyncMemo = React.memo(Async, (a, b) => a.label === b.label);

    /** 同时渲染普通与 memo 版本，覆盖两类 fiber。 */
    function App() {
      return (
        <ContextProvider>
          <Suspense fallback={<Text text="Loading..." />}>
            <div>
              <Async label="function component" />
            </div>
            <div>
              <AsyncMemo label="memo component" />
            </div>
          </Suspense>
        </ContextProvider>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(<App />);
      });
    });
    assertLog(['Async (function component)', 'Async (memo component)']);
    assertConsoleErrorDev([
      'ContextProvider uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in App (at **)',
      'Async uses the legacy contextTypes API which will be removed soon. ' +
        'Use React.createContext() with React.useContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in App (at **)',
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in App (at **)',
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in App (at **)',
    ]);
    expect(root).toMatchRenderedOutput(
      <>
        <div>Async (function component)</div>
        <div>Async (memo component)</div>
      </>,
    );
  });

  /**
   * 场景：组件挂起期间的新更新不能被误认成 render-phase update。
   * Given状态从已完成 A transition 到待决 B；When同步切换为待决 C；Then C 中断 B 并在解析后提交。
   * 验证机制：最终只输出 C；对应源码：并发更新入队与 render-phase update 判定条件。
   */
  it('regression test: updates while component is suspended should not be mistaken for render phase updates', async () => {
    const promiseA = getAsyncText('A');
    const promiseB = getAsyncText('B');
    const promiseC = getAsyncText('C');
    assertLog([
      'Async text requested [A]',
      'Async text requested [B]',
      'Async text requested [C]',
    ]);

    let setState;
    /** 把 Promise 本身存入状态，并通过 `use` 渲染其完成值。 */
    function App() {
      const [state, _setState] = useState(promiseA);
      setState = _setState;
      return <Text text={use(state)} />;
    }

    // 初次渲染 A。
    const root = ReactNoop.createRoot();
    await act(() => root.render(<App />));
    expect(root).toMatchRenderedOutput(null);
    await act(() => resolveTextRequests('A'));
    assertLog(['A']);
    expect(root).toMatchRenderedOutput('A');

    // 更新到 B，并在其待决期间保留 A。
    await act(() => startTransition(() => setState(promiseB)));
    expect(root).toMatchRenderedOutput('A');

    // B 挂起时同步更新到 C，应立刻中断 B；历史缺陷曾把它误判为渲染阶段更新。
    ReactNoop.flushSync(() => setState(promiseC));

    // 解析 C 并完成渲染。
    await act(() => resolveTextRequests('C'));
    assertLog(['C']);
    expect(root).toMatchRenderedOutput('C');
  });

  /**
   * 场景：Suspense 边界外的 async Client Component 在微任务内完成。
   * Given async 函数立即返回 Promise；When根直接渲染且错误边界捕获；Then反复 shell 挂起超过计数阈值，抛出描述性客户端异步组件错误。
   * 验证机制：告警、错误日志与最终边界文本；对应源码：trackUsedThenable 检查 shellSuspendCounter，随后走错误边界恢复。
   */
  it('an async component outside of a Suspense boundary crashes with an error (resolves in microtask)', async () => {
    /** 捕获无边界异步组件升级的错误，并显示其消息。 */
    class ErrorBoundary extends React.Component {
      /** 保存捕获错误；null 时渲染原子树。 */
      state = {error: null};
      /** 把错误写入边界状态以进入恢复提交。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 显示错误消息或继续渲染 children。 */
      render() {
        if (this.state.error) {
          return <Text text={this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    /** 立即解析为 Hi 元素的非法 async Client Component。 */
    async function AsyncClientComponent() {
      return <Text text="Hi" />;
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <AsyncClientComponent />
        </ErrorBoundary>,
      );
    });
    assertConsoleErrorDev([
      '<AsyncClientComponent> is an async Client Component. ' +
        'Only Server Components can be async at the moment. ' +
        "This error is often caused by accidentally adding `'use client'` " +
        'to a module that was originally written for the server.\n' +
        '    in AsyncClientComponent (at **)',
    ]);
    assertLog([
      'An unknown Component is an async Client Component. ' +
        'Only Server Components can be async at the moment. ' +
        'This error is often caused by accidentally adding ' +
        "`'use client'` to a module that was originally written for " +
        'the server.',
      'An unknown Component is an async Client Component. ' +
        'Only Server Components can be async at the moment. ' +
        'This error is often caused by accidentally adding ' +
        "`'use client'` to a module that was originally written for " +
        'the server.',
    ]);
    expect(root).toMatchRenderedOutput(
      'An unknown Component is an async Client Component. ' +
        'Only Server Components can be async at the moment. ' +
        'This error is often caused by accidentally adding ' +
        "`'use client'` to a module that was originally written for " +
        'the server.',
    );
  });

  /**
   * 场景：Suspense 边界外的 async Client Component 跨宏任务完成。
   * Given组件显式等待微任务工具；When错误边界渲染它；Then重复 shell 挂起同样超过计数阈值，并由错误边界显示描述性错误。
   * 验证机制：告警、重复错误日志和最终文本；对应源码：trackUsedThenable 的 shellSuspendCounter 检查与错误边界恢复。
   */
  it('an async component outside of a Suspense boundary crashes with an error (resolves in macrotask)', async () => {
    /** 捕获跨任务异步组件产生的升级错误。 */
    class ErrorBoundary extends React.Component {
      /** 保存捕获错误；null 表示尚未恢复。 */
      state = {error: null};
      /** 把错误映射为替代 UI 状态。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 根据错误状态选择消息或子节点。 */
      render() {
        if (this.state.error) {
          return <Text text={this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    /** 等待测试微任务后返回 Hi，延长非法 async 客户端渲染。 */
    async function AsyncClientComponent() {
      await waitForMicrotasks();
      return <Text text="Hi" />;
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <AsyncClientComponent />
        </ErrorBoundary>,
      );
    });
    assertConsoleErrorDev([
      '<AsyncClientComponent> is an async Client Component. ' +
        'Only Server Components can be async at the moment. ' +
        "This error is often caused by accidentally adding `'use client'` " +
        'to a module that was originally written for the server.\n' +
        '    in AsyncClientComponent (at **)',
    ]);
    assertLog([
      'An unknown Component is an async Client Component. ' +
        'Only Server Components can be async at the moment. ' +
        'This error is often caused by accidentally adding ' +
        "`'use client'` to a module that was originally written for " +
        'the server.',
      'An unknown Component is an async Client Component. ' +
        'Only Server Components can be async at the moment. ' +
        'This error is often caused by accidentally adding ' +
        "`'use client'` to a module that was originally written for " +
        'the server.',
    ]);
    expect(root).toMatchRenderedOutput(
      'An unknown Component is an async Client Component. ' +
        'Only Server Components can be async at the moment. ' +
        'This error is often caused by accidentally adding ' +
        "`'use client'` to a module that was originally written for " +
        'the server.',
    );
  });

  /**
   * 场景：非同步更新中的 async Client Component 调用 useState。
   * Given async 函数内部执行 Hook；When transition 渲染；Then开发环境报告 async 客户端组件与未缓存 Promise。
   * 验证机制：完整 console.error 数组；对应源码：async component 检测与 Hook dispatcher。
   */
  it(
    'warn if async client component calls a hook (e.g. useState) ' +
      'during a non-sync update',
    async () => {
      /** 在非法 async Client Component 中调用状态 Hook。 */
      async function AsyncClientComponent() {
        useState();
        return <Text text="Hi" />;
      }

      const root = ReactNoop.createRoot();
      await act(() => {
        startTransition(() => {
          root.render(<AsyncClientComponent />);
        });
      });
      assertConsoleErrorDev([
        // 过去这里会像服务端一样警告“async 组件内不能使用 Hook”；后来改为对任何
        // async Client Component 统一告警，不再区分更新是否同步。若未来恢复客户端
        // async 组件支持，应同时恢复专门的 Hook 警告。
        '<AsyncClientComponent> is an async Client Component. ' +
          'Only Server Components can be async at the moment. ' +
          "This error is often caused by accidentally adding `'use client'` " +
          'to a module that was originally written for the server.\n' +
          '    in AsyncClientComponent (at **)',
        'A component was suspended by an uncached promise. ' +
          'Creating promises inside a Client Component or hook is not yet supported, ' +
          'except via a Suspense-compatible library or framework.\n' +
          '    in AsyncClientComponent (at **)',
      ]);
    },
  );

  /**
   * 场景：async Client Component 自身调用 `use(promise)`。
   * Given外层 async 返回 Promise、内层 `use` 又消费 Promise；When transition 渲染；Then统一报告非法 async 客户端组件及挂起告警。
   * 验证机制：三条开发告警；对应源码：async 函数返回值处理与 `use` thenable 跟踪。
   */
  it('warn if async client component calls a hook (e.g. use)', async () => {
    const promise = Promise.resolve();

    /** 在非法 async Client Component 内读取已兑现 Promise。 */
    async function AsyncClientComponent() {
      use(promise);
      return <Text text="Hi" />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(<AsyncClientComponent />);
      });
    });
    assertConsoleErrorDev([
      // 过去这里会像服务端一样警告“async 组件内不能使用 Hook”；后来改为对任何
      // async Client Component 统一告警，不再区分更新是否同步。若未来恢复客户端
      // async 组件支持，应同时恢复专门的 Hook 警告。
      '<AsyncClientComponent> is an async Client Component. ' +
        'Only Server Components can be async at the moment. ' +
        "This error is often caused by accidentally adding `'use client'` " +
        'to a module that was originally written for the server.\n' +
        '    in AsyncClientComponent (at **)',
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in AsyncClientComponent (at **)',
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in AsyncClientComponent (at **)',
    ]);
  });

  // @gate enableAsyncIterableChildren
  /**
   * 场景：异步生成器组件分批 yield 文本节点。
   * Given Hi 与 World 请求按序待决且缓存；When逐个解析；Then请求按顺序启动，最终协调为 Hi World；这里只断言最终结果。
   * 验证机制：请求/输出日志、告警和根结果；对应源码：AsyncIterable child 消费与增量协调。
   */
  it('async generator component', async () => {
    let hi, world;
    /** 依次等待 Hi、yield 空格、再等待 World 的异步生成器组件。 */
    async function* App() {
      // 异步生成器中只能等待缓存 Promise；否则重渲染会再次发请求并阻塞后续项。
      await (hi || (hi = getAsyncText('Hi')));
      yield <Text key="1" text="Hi" />;
      yield ' ';
      await (world || (world = getAsyncText('World')));
      yield <Text key="2" text="World" />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(<App />);
      });
    });
    assertConsoleErrorDev([
      '<App> is an async Client Component. ' +
        'Only Server Components can be async at the moment. ' +
        "This error is often caused by accidentally adding `'use client'` " +
        'to a module that was originally written for the server.\n' +
        '    in App (at **)',
    ]);
    assertLog(['Async text requested [Hi]']);

    await act(() => resolveTextRequests('Hi'));
    assertConsoleErrorDev([
      // 生成器每次迭代返回的 Promise 自身未缓存，因此仍会出现该警告。
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in App (at **)',
    ]);

    assertLog(['Async text requested [World]']);

    await act(() => resolveTextRequests('World'));
    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in App (at **)',
    ]);

    assertLog(['Hi', 'World']);
    expect(root).toMatchRenderedOutput('Hi World');
  });

  // @gate enableAsyncIterableChildren
  /**
   * 场景：普通元素的 children 是自定义 async iterable。
   * Given迭代器按序等待并 yield Hi/空格/World；When两次解析模拟请求；Then请求依次启动，最终 div 内容为 Hi World。
   * 验证机制：请求日志、未缓存警告和 JSX 输出；对应源码：`Symbol.asyncIterator` child 消费路径。
   */
  it('async iterable children', async () => {
    let hi, world;
    /** 提供一次异步迭代序列，模拟流式产生 React children。 */
    const iterable = {
      /** 按 Hi、空格、World 的顺序生成 child；请求身份在重试间缓存。 */
      async *[Symbol.asyncIterator]() {
        // 异步 iterable 中只能等待缓存 Promise；否则重试会取得新迭代器、再次发请求，
        // 从而阻塞下一项。
        await (hi || (hi = getAsyncText('Hi')));
        yield <Text key="1" text="Hi" />;
        yield ' ';
        await (world || (world = getAsyncText('World')));
        yield <Text key="2" text="World" />;
      },
    };

    /** 把任意 children 放入 div，验证 iterable 可出现在普通宿主节点下。 */
    function App({children}) {
      return <div>{children}</div>;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(<App>{iterable}</App>);
      });
    });
    assertLog(['Async text requested [Hi]']);

    await act(() => resolveTextRequests('Hi'));
    assertConsoleErrorDev([
      // 迭代器推进产生的 Promise 自身未缓存，因此出现该警告。
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in div (at **)\n' +
        '    in App (at **)',
    ]);

    assertLog(['Async text requested [World]']);

    await act(() => resolveTextRequests('World'));
    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in div (at **)\n' +
        '    in App (at **)',
    ]);

    assertLog(['Hi', 'World']);
    expect(root).toMatchRenderedOutput(<div>Hi World</div>);
  });

  /**
   * 场景：`use` 位于所有状态 Hook 之前，挂起重放后 transition pending 必须复位。
   * Given初始 Promise 已完成；When本地 transition 切换到待决 Updated 再解析；Then先显示 pending，随后清除。
   * 验证机制：Initial pending/Updated 日志与最终输出；对应源码：re-render dispatcher 切回 update dispatcher。
   */
  it(
    'regression: does not get stuck in pending state after `use` suspends ' +
      '(when `use` comes before all hooks)',
    async () => {
      // 回归原因：`use` 挂起并触发重放后，dispatcher 曾未能从“re-render”切回“update”。
      let update;
      /** 先读取 Promise，再创建本地 transition，并暴露触发更新的闭包。 */
      function App({promise}) {
        const value = use(promise);

        const [isPending, startLocalTransition] = useTransition();
        /** 在本地 transition 中换成 Updated 请求，观察 use 重放后的 pending 复位。 */
        update = () => {
          startLocalTransition(() => {
            root.render(<App promise={getAsyncText('Updated')} />);
          });
        };

        return <Text text={value + (isPending ? ' (pending...)' : '')} />;
      }

      const root = ReactNoop.createRoot();
      await act(() => {
        root.render(<App promise={Promise.resolve('Initial')} />);
      });
      assertLog(['Initial']);
      expect(root).toMatchRenderedOutput('Initial');

      await act(() => update());
      assertLog(['Async text requested [Updated]', 'Initial (pending...)']);

      await act(() => resolveTextRequests('Updated'));
      assertLog(['Updated']);
      expect(root).toMatchRenderedOutput('Updated');
    },
  );

  /**
   * 场景：`use` 位于 Hook 列表中间，挂起重放后 pending 同样必须复位。
   * Given前置 useState、`use`、后置 useTransition；When切换并解析 Updated；Then dispatcher 和 Hook 索引均恢复。
   * 验证机制：pending 日志与最终 Updated；对应源码：replay dispatcher 在混合 Hook 序列中的恢复。
   */
  it(
    'regression: does not get stuck in pending state after `use` suspends ' +
      '(when `use` in in the middle of hook list)',
    async () => {
      // 与上一用例相同，但 `use` 位于两个 Hook 之间。
      let update;
      /** 在 `use` 前放置状态 Hook、后放置 transition Hook，暴露中间挂起恢复。 */
      function App({promise}) {
        // 这个 Hook 仅用于证明：即使 `use` 位于其他 Hook 之间，挂起后也能正确恢复。
        useState(false);

        const value = use(promise);

        const [isPending, startLocalTransition] = useTransition();
        /** 在本地 transition 中换成 Updated 请求，观察 use 重放后的 pending 复位。 */
        update = () => {
          startLocalTransition(() => {
            root.render(<App promise={getAsyncText('Updated')} />);
          });
        };

        return <Text text={value + (isPending ? ' (pending...)' : '')} />;
      }

      const root = ReactNoop.createRoot();
      await act(() => {
        root.render(<App promise={Promise.resolve('Initial')} />);
      });
      assertLog(['Initial']);
      expect(root).toMatchRenderedOutput('Initial');

      await act(() => update());
      assertLog(['Async text requested [Updated]', 'Initial (pending...)']);

      await act(() => resolveTextRequests('Updated'));
      assertLog(['Updated']);
      expect(root).toMatchRenderedOutput('Updated');
    },
  );

  /**
   * 场景：传给 `use` 的 rejected Promise 被错误埋点为没有 `reason`。
   * Given status=rejected 但错误写在 error 字段；When Child 调用 `use`；Then React 生成描述性错误并附调用/组件/owner 栈。
   * 验证机制：规范化后的 uncaughtErrors 精确断言；对应源码：rejected thenable reason 缺失的诊断分支。
   */
  it('throws a descriptive error when a rejected promise without a reason property is passed to use()', async () => {
    const badThenable = Promise.resolve();
    // 模拟错误埋点：status 已是 rejected，但拒绝原因未按约定写入 `reason`。
    badThenable.status = 'rejected';
    badThenable.error = new Error('Something went wrong');

    /** 直接用 `use` 消费缺少 reason 的 rejected thenable。 */
    function Child() {
      return use(badThenable);
    }

    /** 包装 Child，并通过形参解构触发生产堆栈定位技巧。 */
    function App({
      // 有意在此解构属性，使生产环境的错误堆栈技巧从函数入口触发。
      prop,
    }) {
      return <Child />;
    }

    const uncaughtErrors = [];
    const root = ReactNoop.createRoot({
      /** 收集并规范化未捕获错误的三类堆栈，供跨环境稳定断言。 */
      onUncaughtError(error, errorInfo) {
        uncaughtErrors.push({
          callStack: normalizeCodeLocInfo(error.stack),
          ownerStack: React.captureOwnerStack
            ? normalizeCodeLocInfo(React.captureOwnerStack())
            : null,
          componentStack: normalizeCodeLocInfo(errorInfo.componentStack),
        });
      },
    });

    await act(() => {
      root.render(<App />);
    });

    expect(uncaughtErrors).toEqual([
      {
        callStack:
          'Error: A rejected Promise was passed to React without a `reason` property. ' +
          'React threw a generic error from where the Promise was used to assist in identifying the problematic Promise. ' +
          "Make sure that instrumented Promises correctly set the `reason` property when setting `status` to `'rejected'`." +
          '\n    in Child  (~/ReactUse-test.js:*:*)' +
          '\n    in Object.<anonymous>  (~/ReactUse-test.js:*:*)',
        componentStack:
          '\n    in Child  (~/ReactUse-test.js:*:*)' +
          '\n    in App  (~/ReactUse-test.js:*:*)',
        ownerStack: __DEV__ ? '\n    in App  (~/ReactUse-test.js:*:*)' : null,
      },
    ]);
  });

  /**
   * 场景：缺少 `reason` 的 rejected Promise 直接作为 child。
   * Given错误埋点 thenable 嵌在 div；When reconciler 解包 child；Then抛出与 `use` 路径一致的描述性诊断。
   * 验证机制：调用栈、组件栈与 owner 栈精确断言；对应源码：child `unwrapThenable` 的 rejected 分支。
   */
  it('throws a descriptive error when a rejected promise without a reason property is used as a child', async () => {
    const badThenable = Promise.resolve();
    // 模拟错误埋点：status 已是 rejected，但拒绝原因未按约定写入 `reason`。
    badThenable.status = 'rejected';
    badThenable.error = new Error('Something went wrong');

    /** 把错误 thenable 直接放入宿主子节点。 */
    function Child() {
      return <div>{badThenable}</div>;
    }

    /** 包装 Child，并通过形参解构触发生产堆栈定位技巧。 */
    function App({
      // 有意在此解构属性，使生产环境的错误堆栈技巧从函数入口触发。
      prop,
    }) {
      return <Child />;
    }

    const uncaughtErrors = [];
    const root = ReactNoop.createRoot({
      /** 收集 child 协调期间的未捕获错误及规范化堆栈。 */
      onUncaughtError(error, errorInfo) {
        uncaughtErrors.push({
          callStack: normalizeCodeLocInfo(error.stack),
          ownerStack: React.captureOwnerStack
            ? normalizeCodeLocInfo(React.captureOwnerStack())
            : null,
          componentStack: normalizeCodeLocInfo(errorInfo.componentStack),
        });
      },
    });

    await act(() => {
      root.render(<App />);
    });

    expect(uncaughtErrors).toEqual([
      {
        callStack:
          'Error: A rejected Promise was passed to React without a `reason` property. ' +
          'React threw a generic error from where the Promise was used to assist in identifying the problematic Promise. ' +
          "Make sure that instrumented Promises correctly set the `reason` property when setting `status` to `'rejected'`." +
          '\n    in Object.<anonymous>  (~/ReactUse-test.js:*:*)',
        componentStack: '\n    in App  (~/ReactUse-test.js:*:*)',
        ownerStack: __DEV__
          ? // TODO：owner 是 Child，理想栈应从 Child 开始。
            '\n    in App  (~/ReactUse-test.js:*:*)'
          : null,
      },
    ]);
  });
});
