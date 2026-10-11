let React;
let ReactNoop;
let Scheduler;
let act;
let Suspense;
let getCacheForType;
let startTransition;
let assertLog;

let caches;
let seededCache;

/** 验证 Transition 同时遇到 Suspense 与错误时，旧界面、fallback 和 ErrorBoundary 的提交原子性。 */
describe('ReactConcurrentErrorRecovery', () => {
  /** 每例重建 Noop/Scheduler，并清空 cache 版本和预置 cache，隔离 thenable ping 与错误状态。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    Suspense = React.Suspense;
    startTransition = React.startTransition;

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;

    getCacheForType = React.unstable_getCacheForType;

    caches = [];
    seededCache = null;
  });

  /**
   * 创建带版本号的可控文本 cache；缺失记录直接创建 resolved/rejected，或从 pending 转到相应终态；终态不再改写，通知前先写状态和值。
   * 若 seededCache 存在则先消费它，用于首次 render 前预置数据。
   */
  function createTextCache() {
    if (seededCache !== null) {
      // 在 cache 正式请求前预置实例的测试技巧。
      // TODO：需要内建 API 支持首次 render 前预置数据；此时尚未挂载，因此不属于 refresh。
      const cache = seededCache;
      seededCache = null;
      return cache;
    }

    const data = new Map();
    const version = caches.length + 1;
    const cache = {
      version,
      data,
      /** 写入成功文本；若记录正在 pending，则更新状态并逐个触发订阅的 ping。 */
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
      /** 写入失败错误；若记录正在 pending，则转为 rejected 并唤醒等待的 render。 */
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

  /**
   * 从当前 React cache 读取文本：resolved 返回版本；pending/rejected 分别抛 thenable/error；
   * 首次缺失时创建带 ping 队列的 thenable 并挂起。
   */
  function readText(text) {
    const textCache = getCacheForType(createTextCache);
    const record = textCache.data.get(text);
    if (record !== undefined) {
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
        /** 注册 Suspense ping；若记录已结算，则用 microtask 异步通知以保持 thenable 契约。 */
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

  /** 记录同步文本 render，并输出同一字符串作为 fallback/error boundary 的可见标记。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** 读取可挂起文本；可选附加 cache 版本，帮助识别 refresh 是否切换了 cache。 */
  function AsyncText({text, showVersion}) {
    const version = readText(text);
    const fullText = showVersion ? `${text} [v${version}]` : text;
    Scheduler.log(fullText);
    return fullText;
  }

  /** 在下一次 getCacheForType 前创建并 resolve cache，使初始内容无需挂起即可提交。 */
  function seedNextTextCache(text) {
    if (seededCache === null) {
      seededCache = createTextCache();
    }
    seededCache.resolve(text);
  }

  /** resolve 最新 cache 中的指定文本；无 cache 时抛错，避免测试静默操作错误实例。 */
  function resolveMostRecentTextCache(text) {
    if (caches.length === 0) {
      throw Error('Cache does not exist.');
    } else {
      // 默认 resolve 最近创建的 cache；旧 cache 可通过 `caches[index].resolve(text)` 精确操作。
      caches[caches.length - 1].resolve(text);
    }
  }

  // 测试用短别名始终指向“最新 cache”解析器。
  const resolveText = resolveMostRecentTextCache;

  /** reject 最新 cache 中的文本；无 cache 时立即失败，守住夹具初始化边界。 */
  function rejectMostRecentTextCache(text, error) {
    if (caches.length === 0) {
      throw Error('Cache does not exist.');
    } else {
      // 默认 reject 最近创建的 cache；旧 cache 可通过 `caches[index].reject(text, error)` 操作。
      caches[caches.length - 1].reject(text, error);
    }
  }

  // 测试用短别名始终拒绝最新 cache 记录。
  const rejectText = rejectMostRecentTextCache;

  /**
   * Given 已提交 A1/B1，refresh Transition 中 A2、B2 都挂起；When B2 先失败而 A2 后成功；
   * Then 期间继续显示旧界面，不闪 fallback；A2 可用后原子提交 A2 与 B 的错误边界。
   * 验证机制：cache 日志与根输出；对应 ReactFiberThrow、ReactFiberSuspenseComponent 与 transition retry lanes。
   */
  // @gate enableLegacyCache
  it('errors during a refresh transition should not force fallbacks to display (suspend then error)', async () => {
    /** 把 B refresh 错误转换为文本，同时允许 A 的挂起阻止整次 Transition 提交。 */
    class ErrorBoundary extends React.Component {
      /** 保存最近错误；null 表示继续渲染异步 child。 */
      state = {error: null};
      /** 将失败 cache 抛出的错误写入恢复状态。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 出错后显示消息，否则透明返回 children。 */
      render() {
        if (this.state.error !== null) {
          return <Text text={this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    /** 渲染 A/B 两个独立 Suspense+ErrorBoundary 分支，step 选择 refresh 版本。 */
    function App({step}) {
      return (
        <>
          <Suspense fallback={<Text text="Loading..." />}>
            <ErrorBoundary>
              <AsyncText text={'A' + step} />
            </ErrorBoundary>
          </Suspense>
          <Suspense fallback={<Text text="Loading..." />}>
            <ErrorBoundary>
              <AsyncText text={'B' + step} />
            </ErrorBoundary>
          </Suspense>
        </>
      );
    }

    // 初始 render 预置 A1/B1，直接提交完整界面。
    const root = ReactNoop.createRoot();
    seedNextTextCache('A1');
    seedNextTextCache('B1');
    await act(() => {
      root.render(<App step={1} />);
    });
    assertLog(['A1', 'B1']);
    expect(root).toMatchRenderedOutput('A1B1');

    // 启动 refresh Transition，A2/B2 均进入挂起。
    await act(() => {
      startTransition(() => {
        root.render(<App step={2} />);
      });
    });
    assertLog(['Suspend! [A2]', 'Loading...', 'Suspend! [B2]', 'Loading...']);
    // 因为是 refresh，挂起期间保留旧界面而不切换 fallback。
    expect(root).toMatchRenderedOutput('A1B1');

    // B2 加载失败。
    await act(() => {
      rejectText('B2', new Error('Oops!'));
    });

    // A2 仍挂起，整次 Transition 尚不可提交，因此不能只显示 B 的错误边界；应等待 A2。
    assertLog(['Suspend! [A2]', 'Loading...', 'Error! [B2]', 'Oops!']);
    // 继续显示上一屏。
    expect(root).toMatchRenderedOutput('A1B1');

    // A2 完成加载。
    await act(() => {
      resolveText('A2');
    });
    assertLog(['A2', 'Error! [B2]', 'Oops!', 'A2', 'Error! [B2]', 'Oops!']);
    // 所有非错误分支就绪后，才能提交包裹 B 的错误边界。
    expect(root).toMatchRenderedOutput('A2Oops!');
  });

  /**
   * Given refresh 中 A2/B2 同时挂起；When A2 先失败、B2 后成功；Then 旧屏保持到 B2 resolve，
   * 随后原子提交 A 的错误 fallback 与 B2。验证错误先于剩余挂起发生时仍不强制显示 Suspense fallback。
   */
  // @gate enableLegacyCache
  it('errors during a refresh transition should not force fallbacks to display (error then suspend)', async () => {
    /** 把 A 分支错误转为可见消息，并等待兄弟 B 的挂起解除后共同提交。 */
    class ErrorBoundary extends React.Component {
      /** 记录 refresh 期间捕获的 cache 错误。 */
      state = {error: null};
      /** 将渲染错误折叠进边界状态。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 错误态输出消息，正常态继续异步读取。 */
      render() {
        if (this.state.error !== null) {
          return <Text text={this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    /** 用 step 同步推进两个异步分支，制造 error-then-suspend 顺序。 */
    function App({step}) {
      return (
        <>
          <Suspense fallback={<Text text="Loading..." />}>
            <ErrorBoundary>
              <AsyncText text={'A' + step} />
            </ErrorBoundary>
          </Suspense>
          <Suspense fallback={<Text text="Loading..." />}>
            <ErrorBoundary>
              <AsyncText text={'B' + step} />
            </ErrorBoundary>
          </Suspense>
        </>
      );
    }

    // 初始 render 直接提交 A1/B1。
    const root = ReactNoop.createRoot();
    seedNextTextCache('A1');
    seedNextTextCache('B1');
    await act(() => {
      root.render(<App step={1} />);
    });
    assertLog(['A1', 'B1']);
    expect(root).toMatchRenderedOutput('A1B1');

    // refresh Transition 请求 A2/B2。
    await act(() => {
      startTransition(() => {
        root.render(<App step={2} />);
      });
    });
    assertLog(['Suspend! [A2]', 'Loading...', 'Suspend! [B2]', 'Loading...']);
    // refresh 挂起不替换已提交内容。
    expect(root).toMatchRenderedOutput('A1B1');

    // A2 先失败。
    await act(() => {
      rejectText('A2', new Error('Oops!'));
    });

    // B2 仍挂起，A 的错误边界不能单独提交；继续等待 B2。
    assertLog(['Error! [A2]', 'Oops!', 'Suspend! [B2]', 'Loading...']);
    // 保留上一屏。
    expect(root).toMatchRenderedOutput('A1B1');

    // B2 完成加载。
    await act(() => {
      resolveText('B2');
    });
    assertLog(['Error! [A2]', 'Oops!', 'B2', 'Error! [A2]', 'Oops!', 'B2']);
    // 现在可原子提交 A 的错误消息与 B2。
    expect(root).toMatchRenderedOutput('Oops!B2');
  });

  /**
   * Given shell 外没有 Suspense 边界；When startTransition 中首次 render AsyncText 并稍后 resolve；
   * Then 挂起既不抛错也不触发 ErrorBoundary，数据就绪后正常提交。
   * 验证机制：Suspend/resolve 日志与空输出；对应 ReactFiberThrow 对 transition shell suspension 的特殊处理。
   */
  // @gate enableLegacyCache
  it('suspending in the shell (outside a Suspense boundary) should not throw, warn, or log during a transition', async () => {
    /** 包裹 shell suspension，证明 Transition 挂起不会被误分类为可捕获错误。 */
    class ErrorBoundary extends React.Component {
      /** 仅真实错误才会写入该状态。 */
      state = {error: null};
      /** 将真实错误转换为状态；thenable suspension 不应调用。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 错误时显示消息，正常时透传异步 children。 */
      render() {
        if (this.state.error !== null) {
          return <Text text={this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    // 初次 render 在没有 Suspense 边界时挂起；因位于 startTransition 内，它会等待而不是报错。
    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(<AsyncText text="Async" />);
      });
    });
    assertLog(['Suspend! [Async]']);
    expect(root).toMatchRenderedOutput(null);

    // 外包 ErrorBoundary 后仍等待该 thenable；挂起不调用错误边界，资源解决后才提交 Async。
    await act(() => {
      startTransition(() => {
        root.render(
          <ErrorBoundary>
            <AsyncText text="Async" />
          </ErrorBoundary>,
        );
      });
    });
    assertLog(['Suspend! [Async]']);
    expect(root).toMatchRenderedOutput(null);

    // 数据 resolve 后继续并完成 render。
    await act(() => {
      resolveText('Async');
    });
    assertLog(['Async']);
    expect(root).toMatchRenderedOutput('Async');
  });

  /**
   * Given shell Transition 同时含无边界挂起与边界内抛错；When 连续两次以相同 AsyncText→ErrorBoundary 顺序 render 后再 resolve；
   * Then 两次都保持空旧屏，不提前提交错误；异步数据就绪后同步恢复并显示错误 fallback。
   * 验证机制：预热/恢复日志与根输出；对应 shell suspension、错误边界恢复和 retry 提交原子性。
   */
  // @gate enableLegacyCache
  it(
    'errors during a suspended transition at the shell should not force ' +
      'fallbacks to display (error then suspend)',
    async () => {
      // 此例与前面的 refresh 错误相似：shell 挂起在概念上等同保留旧屏，
      // 但两者经过不同实现路径，因此需要独立覆盖。

      /** 暂存同步错误，等待同次 shell Transition 的挂起工作一并完成后再展示。 */
      class ErrorBoundary extends React.Component {
        /** null 表示尚无错误；非 null 保存待提交错误。 */
        state = {error: null};
        /** 把 Throws 的错误转换为 fallback 状态。 */
        static getDerivedStateFromError(error) {
          return {error};
        }
        /** 错误态显示带前缀消息，正常态透传 children。 */
        render() {
          if (this.state.error !== null) {
            return (
              <Text text={'Caught an error: ' + this.state.error.message} />
            );
          }
          return this.props.children;
        }
      }

      /** 始终抛出 Oops，和 AsyncText 挂起组成同一 Transition 的双失败源。 */
      function Throws() {
        throw new Error('Oops!');
      }

      // 在同一 Transition 中同时挂起并抛错。
      const root = ReactNoop.createRoot();
      await act(() => {
        startTransition(() => {
          root.render(
            <>
              <AsyncText text="Async" />
              <ErrorBoundary>
                <Throws />
              </ErrorBoundary>
            </>,
          );
        });
      });
      assertLog([
        'Suspend! [Async]',
        // 预热 render。
        'Caught an error: Oops!',
      ]);
      // render 已挂起，因此错误状态尚未提交。
      expect(root).toMatchRenderedOutput(null);

      // 再用同样的子节点顺序排入第二次转换；本体仍是先 AsyncText 后错误分支，没有反转遍历顺序。
      await act(() => {
        startTransition(() => {
          root.render(
            <>
              <AsyncText text="Async" />
              <ErrorBoundary>
                <Throws />
              </ErrorBoundary>
            </>,
          );
        });
      });
      assertLog(['Suspend! [Async]', 'Caught an error: Oops!']);
      expect(root).toMatchRenderedOutput(null);

      await act(async () => {
        await resolveText('Async');
      });

      assertLog([
        'Async',
        'Caught an error: Oops!',

        // 通过再次同步 render 验证错误恢复。
        'Async',
        'Caught an error: Oops!',
      ]);

      expect(root).toMatchRenderedOutput('AsyncCaught an error: Oops!');
    },
  );
});
