/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @jest-environment node
 */

// act() 的基础健全性测试。

let React;
let ReactNoop;
let act;
let use;
let Suspense;
let DiscreteEventPriority;
let startTransition;
let waitForMicrotasks;
let Scheduler;
let assertLog;

/** 覆盖 isomorphic act 在生产导出、微任务、嵌套返回值、legacy 批处理与 Suspense thenable 中的契约。 */
describe('isomorphic act()', () => {
  /** 绑定 ReactNoop、Scheduler、act/use/Suspense 与微任务断言工具。 */
  beforeEach(() => {
    React = require('react');
    Scheduler = require('scheduler');

    ReactNoop = require('react-noop-renderer');
    DiscreteEventPriority =
      require('react-reconciler/constants').DiscreteEventPriority;
    act = React.act;
    use = React.use;
    Suspense = React.Suspense;
    startTransition = React.startTransition;

    waitForMicrotasks = require('internal-test-utils').waitForMicrotasks;
    assertLog = require('internal-test-utils').assertLog;
  });

  /** 为每个用例显式启用 React act 环境标志。 */
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
  });

  /** 恢复 console 等 spy，防止警告捕获跨用例泄漏。 */
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** 记录并返回文本，用于观察 legacy async act 的批次边界。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** Given–When–Then：Given生产构建；When检查 React.act；Then fb 构建调用会抛“不支持”，其他生产构建不导出 act。通过条件导出与错误字符串验证 production 边界。 */
  it('behavior in production', () => {
    if (!__DEV__) {
      if (gate('fb')) {
        expect(() => act(() => {})).toThrow(
          'act(...) is not supported in production builds of React',
        );
      } else {
        expect(React).not.toHaveProperty('act');
      }
    }
  });

  /** Given–When–Then：Given离散优先级更新通常进入 microtask；When先在 act 外渲染 A，再在 act 内渲染 B；Then A 需显式等待微任务，B 在 act 返回前同步可见。通过根输出验证 act 使用内部队列绕过宿主 queueMicrotask。 */
  // @gate __DEV__
  it('bypasses queueMicrotask', async () => {
    const root = ReactNoop.createRoot();

    // 先验证 act 外行为：该离散更新通常
    // 被放入 microtask。
    global.IS_REACT_ACT_ENVIRONMENT = false;
    ReactNoop.unstable_runWithPriority(DiscreteEventPriority, () => {
      root.render('A');
    });
    // microtask 冲刷前尚无输出。
    expect(root).toMatchRenderedOutput(null);
    // 显式等待并冲刷 microtasks。
    await waitForMicrotasks();
    expect(root).toMatchRenderedOutput('A');

    // 再把相同更新包入 act；
    // 无需额外等待宿主 microtask。
    global.IS_REACT_ACT_ENVIRONMENT = true;
    act(() => {
      ReactNoop.unstable_runWithPriority(DiscreteEventPriority, () => {
        root.render('B');
      });
    });
    expect(root).toMatchRenderedOutput('B');
  });

  /** Given–When–Then：Given act scope 同步返回 hi；When await act 结果；Then返回值透传为 hi。验证同步 scope 的 thenable 适配。 */
  // @gate __DEV__
  it('return value – sync callback', async () => {
    expect(await act(() => 'hi')).toEqual('hi');
  });

  /** Given–When–Then：Given外层 act 返回内层同步 act；When等待最外层；Then嵌套返回值 hi 不丢失。验证 act scope 合并。 */
  // @gate __DEV__
  it('return value – sync callback, nested', async () => {
    const returnValue = await act(() => {
      return act(() => 'hi');
    });
    expect(returnValue).toEqual('hi');
  });

  /** Given–When–Then：Given异步 scope 等待 Promise.resolve 后返回 hi；When await act；Then异步返回值透传且队列已耗尽。 */
  // @gate __DEV__
  it('return value – async callback', async () => {
    const returnValue = await act(async () => {
      return await Promise.resolve('hi');
    });
    expect(returnValue).toEqual('hi');
  });

  /** Given–When–Then：Given异步 act 内再等待异步 act；When等待外层；Then嵌套异步返回值 hi 正确传播，且只在最外层完成后退出。 */
  // @gate __DEV__
  it('return value – async callback, nested', async () => {
    const returnValue = await act(async () => {
      return await act(async () => {
        return await Promise.resolve('hi');
      });
    });
    expect(returnValue).toEqual('hi');
  });

  /** Given–When–Then：Given legacy root 在 act 外同步提交 A；When act 内依次 render B、嵌套 batchedUpdates render C；Then scope 内仍为 A，退出后单批提交 C。通过中间/最终输出验证 legacy act 批处理。 */
  // @gate __DEV__ && !disableLegacyMode
  it('in legacy mode, updates are batched', () => {
    const root = ReactNoop.createLegacyRoot();

    // act 外的 legacy 更新完全同步冲刷。
    root.render('A');
    expect(root).toMatchRenderedOutput('A');

    // act 会聚合更新，并在 scope 结束时冲刷。
    act(() => {
      root.render('B');
      // scope 内尚未冲刷。
      expect(root).toMatchRenderedOutput('A');

      // 嵌套 batchedUpdates 不应让更新
      // 提前冲刷。
      ReactNoop.batchedUpdates(() => {
        root.render('C');
      });

      // 此时仍未冲刷。
      expect(root).toMatchRenderedOutput('A');
    });

    // scope 退出后一次性提交最后值 C。
    expect(root).toMatchRenderedOutput('C');
  });

  /** Given–When–Then：Given legacy async act 在首个 await 前安排 A/B，并在 microtask 中安排 C；When越过首次 await 后再安排 D/E；Then B 在微任务前单批提交，C/D/E 各自提交。通过日志验证 legacy 兼容批处理只持续到首次 await。 */
  // @gate __DEV__ && !disableLegacyMode
  it('in legacy mode, in an async scope, updates are batched until the first `await`', async () => {
    const root = ReactNoop.createLegacyRoot();

    await act(async () => {
      queueMicrotask(() => {
        Scheduler.log('Current tree in microtask: ' + root.getChildrenAsJSX());
        root.render(<Text text="C" />);
      });
      root.render(<Text text="A" />);
      root.render(<Text text="B" />);

      await null;
      assertLog([
        // A/B 应在 microtask 队列运行前
        // 单批提交；这是为兼容原始 act
        // 实现而保留的行为。
        'B',
        'Current tree in microtask: B',

        // C 到 microtask 才入队，因此独立渲染。
        'C',
      ]);

      // 首次 await 后的更新也分别提交。
      root.render(<Text text="D" />);
      root.render(<Text text="E" />);
      assertLog(['D', 'E']);
    });
  });

  /** Given–When–Then：Given A/B 额外包在 batchedUpdates 中，C 仍位于 microtask；When async act 到达首次 await；Then A/B 仍必须在微任务前提交为 B，不能被 batchedUpdates 延后。通过日志回归验证 legacy act 的边界优先于嵌套批处理。 */
  // @gate __DEV__ && !disableLegacyMode
  it('in legacy mode, in an async scope, updates are batched until the first `await` (regression test: batchedUpdates)', async () => {
    const root = ReactNoop.createLegacyRoot();

    await act(async () => {
      queueMicrotask(() => {
        Scheduler.log('Current tree in microtask: ' + root.getChildrenAsJSX());
        root.render(<Text text="C" />);
      });

      // 回归缺陷中，batchedUpdates 曾让
      // 这些更新延后到 microtask；正确行为要求
      // 无论是否包在 batchedUpdates 中，
      // 都在 microtask 队列前冲刷。
      ReactNoop.batchedUpdates(() => {
        root.render(<Text text="A" />);
        root.render(<Text text="B" />);
      });

      await null;
      assertLog([
        // A/B 应在 microtask 队列运行前
        // 单批提交；这是为兼容原始 act
        // 实现而保留的行为。
        'B',
        'Current tree in microtask: B',

        // C 到 microtask 才入队，因此独立渲染。
        'C',
      ]);

      // 首次 await 后的更新也分别提交。
      root.render(<Text text="D" />);
      root.render(<Text text="E" />);
      assertLog(['D', 'E']);
    });
  });

  /** Given–When–Then：Given App 通过 use 读取已解决 promise；When async act 内以 transition 渲染 Suspense；Then act 让出微任务并直接提交 Async，Fallback 从未渲染。通过最终输出验证 use thenable 解包。 */
  // @gate __DEV__
  it('unwraps promises by yielding to microtasks (async act scope)', async () => {
    const promise = Promise.resolve('Async');

    /** 若被渲染就抛错；已解决 promise 应由 act 在提交 fallback 前解包。 */
    function Fallback() {
      throw new Error('Fallback should never be rendered');
    }

    /** 通过 use 读取 promise，让 act 负责推进微任务或报告未 await。 */
    function App() {
      return use(promise);
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      startTransition(() => {
        root.render(
          <Suspense fallback={<Fallback />}>
            <App />
          </Suspense>,
        );
      });
    });
    expect(root).toMatchRenderedOutput('Async');
  });

  /** Given–When–Then：Given scope 本身不是 async，但 App use 已解决 promise；When await act 返回的 thenable；Then act 仍推进微任务并提交 Async。通过不触发 Fallback 验证同步 scope 的异步队列检测。 */
  // @gate __DEV__
  it('unwraps promises by yielding to microtasks (non-async act scope)', async () => {
    const promise = Promise.resolve('Async');

    /** 若被渲染就抛错；已解决 promise 应由 act 在提交 fallback 前解包。 */
    function Fallback() {
      throw new Error('Fallback should never be rendered');
    }

    /** 通过 use 读取 promise，让 act 负责推进微任务或报告未 await。 */
    function App() {
      return use(promise);
    }

    const root = ReactNoop.createRoot();

    // 注意 scope 函数本身并非 async。
    await act(() => {
      startTransition(() => {
        root.render(
          <Suspense fallback={<Fallback />}>
            <App />
          </Suspense>,
        );
      });
    });
    expect(root).toMatchRenderedOutput('Async');
  });

  /** Given–When–Then：Given App 在未 await 的 act scope 中 use 永不解决的 promise；When冲刷若干微任务；Then开发模式报告“组件挂起但 act 未等待”。通过一次控制台调用验证异步 act 使用契约。 */
  // @gate __DEV__
  it('warns if a promise is used in a non-awaited `act` scope', async () => {
    const promise = new Promise(() => {});

    /** 若被渲染就抛错；已解决 promise 应由 act 在提交 fallback 前解包。 */
    function Fallback() {
      throw new Error('Fallback should never be rendered');
    }

    /** 通过 use 读取 promise，让 act 负责推进微任务或报告未 await。 */
    function App() {
      return use(promise);
    }

    spyOnDev(console, 'error').mockImplementation(() => {});
    const root = ReactNoop.createRoot();
    act(() => {
      startTransition(() => {
        root.render(
          <Suspense fallback={<Fallback />}>
            <App />
          </Suspense>,
        );
      });
    });

    // act 在若干 microtask 后而非 macrotask 后警告，
    // 使警告更可能归属正确用例。
    //
    // 具体 microtask 数量属于实现细节；只需保证
    // 冲刷 microtask 队列时已经发出。
    await waitForMicrotasks();

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error.mock.calls[0][0]).toContain(
      'A component suspended inside an `act` scope, but the `act` ' +
        'call was not awaited. When testing React components that ' +
        'depend on asynchronous data, you must await the result:\n\n' +
        'await act(() => ...)',
    );
  });

  /** Given–When–Then：Given App 使用 legacy throw promise 而非 use；When未 await 的 act 提交 Loading 并冲刷微任务；Then不发 use 专属警告，随后 await act 解决并提交 Async。通过控制台次数与输出验证兼容边界。 */
  // @gate __DEV__
  it('does not warn when suspending via legacy `throw` API  in non-awaited `act` scope', async () => {
    let didResolve = false;
    let resolvePromise;
    const promise = new Promise(r => {
      resolvePromise = () => {
        didResolve = true;
        r();
      };
    });

    /** legacy throw 路径的可见 Loading 回退，用于证明边界确实提交。 */
    function Fallback() {
      return 'Loading...';
    }

    /** 未解决时按 legacy 方式直接 throw promise，解决后返回 Async。 */
    function App() {
      if (!didResolve) {
        throw promise;
      }
      return 'Async';
    }

    spyOnDev(console, 'error').mockImplementation(() => {});
    const root = ReactNoop.createRoot();
    act(() => {
      startTransition(() => {
        root.render(
          <Suspense fallback={<Fallback />}>
            <App />
          </Suspense>,
        );
      });
    });
    expect(root).toMatchRenderedOutput('Loading...');

    // act 在若干 microtask 后而非 macrotask 后警告，
    // 使警告更可能归属正确用例。
    //
    // 具体 microtask 数量属于实现细节；只需保证
    // 冲刷 microtask 队列时已经发出。
    await waitForMicrotasks();

    expect(console.error).toHaveBeenCalledTimes(0);

    // 解决资源并完成主树重试。
    await act(async () => {
      resolvePromise();
    });
    expect(root).toMatchRenderedOutput('Async');
  });
});
