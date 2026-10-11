let React;
let ReactNoop;
let Scheduler;
let act;
let assertLog;
let waitFor;
let waitForPaint;
let waitForAll;
let textCache;
let startTransition;
let Suspense;
let Activity;

/** 验证挂起或报错后是否、何时以并发方式预渲染尚未访问的兄弟 Fiber。 */
describe('ReactSiblingPrerendering', () => {
  /** 重建渲染器和文本资源缓存，确保每个场景的 ping 与调度状态独立。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    assertLog = require('internal-test-utils').assertLog;
    waitFor = require('internal-test-utils').waitFor;
    waitForPaint = require('internal-test-utils').waitForPaint;
    waitForAll = require('internal-test-utils').waitForAll;
    startTransition = React.startTransition;
    Suspense = React.Suspense;
    Activity = React.Activity;

    textCache = new Map();
  });

  /**
   * 把文本资源推进到 resolved，并唤醒所有订阅该 thenable 的重试监听器。
   * 若资源尚未读取则直接创建终态记录，后续读取不会挂起。
   */
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
   * 读取文本资源；未命中时建立 pending thenable 并抛出，命中后按状态返回或抛错。
   * 状态机只允许 pending 经 `resolveText` 进入 resolved，本文件不主动构造 rejected 记录。
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
        /**
         * 注册 React 的重试回调；若资源已完成，则放入微任务异步回放以保持 thenable 约定。
         */
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

  // function getText(text) {
  //   const record = textCache.get(text);
  //   if (record === undefined) {
  //     const thenable = {
  //       pings: [],
  //       then(resolve) {
  //         if (newRecord.status === 'pending') {
  //           thenable.pings.push(resolve);
  //         } else {
  //           Promise.resolve().then(() => resolve(newRecord.value));
  //         }
  //       },
  //     };
  //     const newRecord = {
  //       status: 'pending',
  //       value: thenable,
  //     };
  //     textCache.set(text, newRecord);
  //     return thenable;
  //   } else {
  //     switch (record.status) {
  //       case 'pending':
  //         return record.value;
  //       case 'rejected':
  //         return Promise.reject(record.value);
  //       case 'resolved':
  //         return Promise.resolve(record.value);
  //     }
  //   }
  // }

  /** 记录同步文本的渲染顺序，并将文本作为宿主输出返回。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** 先读取可能挂起的文本资源，成功后记录并返回文本。 */
  function AsyncText({text}) {
    readText(text);
    Scheduler.log(text);
    return text;
  }

  /**
   * 场景（Given–When–Then）：给定第一个子树在 A 之前抛错、根的另一分支含 B/C；当并发
   * transition 渲染；那么错误分支跳过 A，但根已无法提交时仍继续预渲染 B 后的 C。
   * 对应机制：错误 unwind 与 Suspense 兄弟预渲染模式的不同入口。
   */
  it("don't prerender siblings when something errors", async () => {
    /** 捕获子树错误并用错误消息替换失败分支。 */
    class ErrorBoundary extends React.Component {
      /** 保存最近捕获的错误；null 表示继续渲染子节点。 */
      state = {error: null};
      /** 将渲染错误写入派生状态，触发回退消息。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 在错误消息和原始子树之间切换。 */
      render() {
        if (this.state.error) {
          return <Text text={this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    /** 在渲染阶段同步抛错，迫使 ErrorBoundary 展开错误路径。 */
    function Oops() {
      throw new Error('Oops!');
    }

    /** 组合一个报错分支与一个含两个异步兄弟的独立分支。 */
    function App() {
      return (
        <>
          <div>
            <ErrorBoundary>
              <Oops />
              <AsyncText text="A" />
            </ErrorBoundary>
          </div>
          <div>
            <AsyncText text="B" />
            <AsyncText text="C" />
          </div>
        </>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => startTransition(() => root.render(<App />)));
    assertLog([
      'Oops!',

      // 错误路径不会预渲染其余兄弟，因此跳过 A。

      'Suspend! [B]',

      // B 挂起后根没有 fallback、已经无法提交，因此可从当前位置继续预渲染 C，无需重头开始。
      'Suspend! [C]',
    ]);
  });

  /**
   * 场景（Given–When–Then）：给定 Activity 隐藏树内的边界包含 B/C；当可见 A 先提交、
   * 隐藏内容随后后台渲染；那么即使 B 挂起也会继续尝试 C。
   * 对应机制：隐藏树预渲染不需要为显示 fallback 而跳过兄弟。
   */
  it("don't skip siblings when rendering inside a hidden tree", async () => {
    /** 将同步 A 放在可见区，并将 B/C 边界放入隐藏 Activity。 */
    function App() {
      return (
        <>
          <Text text="A" />
          <Activity mode="hidden">
            <Suspense fallback={<Text text="Loading..." />}>
              <AsyncText text="B" />
              <AsyncText text="C" />
            </Suspense>
          </Activity>
        </>
      );
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      startTransition(async () => root.render(<App />));

      // 第一轮只渲染可见树，隐藏内容延后处理。
      await waitForPaint(['A']);
      expect(root).toMatchRenderedOutput('A');

      if (gate(flags => flags.enableYieldingBeforePassive)) {
        // 让出一次以刷新 passive effects。
        await waitForPaint([]);
      }
      // 第二轮预渲染隐藏内容。
      await waitForPaint([
        'Suspend! [B]',
        // 若 B/C 可见，本轮会跳过 C 以尽快显示 fallback；隐藏树则无需该取舍。
        'Suspend! [C]',
        'Loading...',
      ]);
      expect(root).toMatchRenderedOutput('A');
    });
  });

  /**
   * 场景（Given–When–Then）：给定同一边界内 A/B 都未完成；当首次 A 挂起并提交 fallback；
   * 那么提交后立即以预渲染模式重试，并在 A 仍挂起时继续发现 B。
   * 对应机制：fallback commit 后安排边界预热重试。
   */
  it('start prerendering retries right after the fallback commits', async () => {
    /** 创建含两个未解析文本兄弟的单一 Suspense 边界。 */
    function App() {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <AsyncText text="A" />
          <AsyncText text="B" />
        </Suspense>
      );
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      startTransition(() => root.render(<App />));

      // 首次 A 挂起后 unwind 并显示 fallback，不尝试 B。
      await waitForPaint(['Suspend! [A]', 'Loading...']);
      expect(root).toMatchRenderedOutput('Loading...');

      // fallback 已提交后立即重试；此时继续到 B 不会阻塞回退显示。
      if (gate(flags => flags.enableYieldingBeforePassive)) {
        // 让出一次以刷新 passive effects。
        await waitForPaint([]);
      }
      await waitForPaint(['Suspend! [A]', 'Suspend! [B]']);
    });
    expect(root).toMatchRenderedOutput('Loading...');
  });

  /**
   * 场景（Given–When–Then）：给定外边界正预渲染兄弟且 B 在本轮中途被 ping；当继续到内边界 C；
   * 那么切回普通渲染并跳过 D，以尽快提交内层 fallback，同时保留已完成工作。
   * 对应机制：render-phase ping 重置 `workInProgressRootIsPrerendering` 模式。
   */
  it('switch back to normal rendering mode if a ping occurs during prerendering', async () => {
    /** 组合外层 B 与内边界 C/D，暴露预渲染模式切换后的兄弟访问顺序。 */
    function App() {
      return (
        <div>
          <Suspense fallback={<Text text="Loading outer..." />}>
            <div>
              <Text text="A" />
              <AsyncText text="B" />
            </div>
            <div>
              <Suspense fallback={<Text text="Loading inner..." />}>
                <AsyncText text="C" />
                <AsyncText text="D" />
              </Suspense>
            </div>
          </Suspense>
        </div>
      );
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      startTransition(() => root.render(<App />));

      // 首次 B 挂起后 unwind 并显示外层 fallback，不尝试其兄弟。
      await waitForPaint(['A', 'Suspend! [B]', 'Loading outer...']);
      expect(root).toMatchRenderedOutput(<div>Loading outer...</div>);

      // fallback 可见后开始预渲染兄弟，再让出以模拟交错事件。
      await waitFor(['A']);

      // 推进超过重试 fallback 节流间隔（本版 300ms），避免 Suspense 节流掩盖模式切换行为。
      Scheduler.unstable_advanceTime(500);

      // 渲染阶段再次访问 B 前完成它：应切回普通模式，但不 unwind 丢弃当前工作。
      await resolveText('B');
      await waitForPaint([
        'B',
        'Suspend! [C]',

        // 若仍处于预渲染模式会继续 D；收到新数据后改为跳过余下兄弟，先解除内层 fallback 阻塞。
        'Loading inner...',
      ]);

      expect(root).toMatchRenderedOutput(
        <div>
          <div>AB</div>
          <div>Loading inner...</div>
        </div>,
      );
    });

    // 内层 fallback 显示后，才可预渲染其余树。
    assertLog([
      // NOTE：C 渲染两次，因为 B 完成被视为 retry update 而非单纯 ping：先普通渲染，
      // 再预渲染。TODO：重试监听器可检测外边界已不再挂起，从而省去这次更新。
      'Suspend! [C]',

      // 此时已进入预渲染模式，所以本轮会包含 D。
      'Suspend! [C]',
      'Suspend! [D]',
    ]);
    expect(root).toMatchRenderedOutput(
      <div>
        <div>AB</div>
        <div>Loading inner...</div>
      </div>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定外 fallback 已提交、A 在内边界预渲染开始前完成；当新树
   * 已可提交但受 fallback 重试节流；那么等待提交而不丢弃已完成工作去预渲染 C。
   * 对应机制：可提交 work-in-progress 优先于兄弟预热。
   */
  it("don't throw out completed work in order to prerender", async () => {
    /** 将外层 A 与内边界 B/C 分开，制造“可提交树”和“可预热兄弟”的竞争。 */
    function App() {
      return (
        <div>
          <Suspense fallback={<Text text="Loading outer..." />}>
            <div>
              <AsyncText text="A" />
            </div>
            <div>
              <Suspense fallback={<Text text="Loading inner..." />}>
                <AsyncText text="B" />
                <AsyncText text="C" />
              </Suspense>
            </div>
          </Suspense>
        </div>
      );
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      startTransition(() => root.render(<App />));

      await waitForPaint(['Suspend! [A]', 'Loading outer...']);
      expect(root).toMatchRenderedOutput(<div>Loading outer...</div>);

      // 内边界开始预渲染前 A 完成，因此先重试 A。
      await resolveText('A');
      // 新树已经可显示，但距离外 fallback 提交不足 fallback 重试节流间隔，提交阶段仍被节流。
      //
      // 等待 fallback 重试节流到期并完成提交，而不是丢弃已完成工作去预渲染 C。
      await waitForAll([
        'A',
        'Suspend! [B]',

        // 已切回普通模式且有新的 fallback 可显示，因此跳过 C。
        'Loading inner...',
      ]);
      expect(root).toMatchRenderedOutput(<div>Loading outer...</div>);

      // 触发节流计时器，提交包含内层 fallback 的新树。
      jest.runAllTimers();
      expect(root).toMatchRenderedOutput(
        <div>
          <div>A</div>
          <div>Loading inner...</div>
        </div>,
      );
    });
    // 内层 fallback 提交后才开始预渲染 C。
    assertLog(['Suspend! [B]', 'Suspend! [C]']);
  });

  /**
   * 场景（Given–When–Then）：给定首次 A 挂起后、渲染阶段结束前收到 A 的 ping；当 fallback
   * 提交并重试；那么重试是普通渲染，B 挂起时跳过 C，待内层回退提交后才预热 C。
   * 对应机制：首次尝试期间的 ping 改变 retry 的渲染模式。
   */
  it(
    "don't skip siblings during the retry if there was a ping since the " +
      'first attempt',
    async () => {
      /** 用根级兄弟 D 延长首次 render phase，并嵌套 A 与 B/C 两层边界。 */
      function App() {
        return (
          <>
            <div>
              <Suspense fallback={<Text text="Loading outer..." />}>
                <div>
                  <AsyncText text="A" />
                </div>
                <div>
                  <Suspense fallback={<Text text="Loading inner..." />}>
                    <AsyncText text="B" />
                    <AsyncText text="C" />
                  </Suspense>
                </div>
              </Suspense>
            </div>
            <div>
              <Text text="D" />
            </div>
          </>
        );
      }

      const root = ReactNoop.createRoot();
      await act(async () => {
        startTransition(() => root.render(<App />));

        // 首次 A 挂起后 unwind 并显示外层 fallback，不尝试 B/C。
        await waitFor([
          'Suspend! [A]',
          'Loading outer...',

          // 让出以模拟交错事件。
        ]);

        // 在 render phase 结束前 ping A，模拟交错到达的网络响应。
        await resolveText('A');

        // 继续处理根的剩余兄弟。
        await waitForPaint(['D']);
        expect(root).toMatchRenderedOutput(
          <>
            <div>Loading outer...</div>
            <div>D</div>
          </>,
        );

        if (gate(flags => flags.enableYieldingBeforePassive)) {
          // 让出一次以刷新 passive effects。
          await waitForPaint([]);
        }
        // fallback 提交后立即重试；A 已完成，所以这是普通渲染而非预渲染。B 挂起时再次
        // unwind 并跳过 C，从而不阻塞内层 fallback 显示。
        await waitForPaint(['A', 'Suspend! [B]', 'Loading inner...']);
        // retry 的提交阶段受计时器节流。
        jest.runAllTimers();
        // 此时内层 fallback 已可见。
        expect(root).toMatchRenderedOutput(
          <>
            <div>
              <div>A</div>
              <div>Loading inner...</div>
            </div>
            <div>D</div>
          </>,
        );

        if (gate(flags => flags.enableYieldingBeforePassive)) {
          // 让出一次以刷新 passive effects。
          await waitForPaint([]);
        }
        // 现在才可继续预渲染 C。
        await waitForPaint(['Suspend! [B]', 'Suspend! [C]']);
      });
      assertLog([]);
    },
  );

  /**
   * 场景（Given–When–Then）：给定同步根在无边界的 Async 处挂起；当继续处理 C/D；那么余下
   * 兄弟改用并发预渲染且从断点续作，Async 完成后同步重启并提交全树。
   * 对应机制：shell suspend 后把兄弟工作降为 concurrent prerender。
   */
  it(
    'when a synchronous update suspends outside a boundary, the resulting' +
      'prerender is concurrent',
    async () => {
      /** 在无 Suspense 边界的同步文本序列中插入一个异步文本。 */
      function App() {
        return (
          <>
            <Text text="A" />
            <Text text="B" />
            <AsyncText text="Async" />
            <Text text="C" />
            <Text text="D" />
          </>
        );
      }

      const root = ReactNoop.createRoot();
      // 同步挂载根。
      ReactNoop.flushSync(() => root.render(<App />));

      // 同步渲染到 shell 中的 Async 挂起为止。
      assertLog(['A', 'B', 'Suspend! [Async]']);

      // 其余兄弟开始并发预渲染；此处不 unwind，而从上方断点继续。
      await waitFor(['C']);
      await waitFor(['D']);

      assertLog([]);
      expect(root).toMatchRenderedOutput(null);

      await resolveText('Async');
      assertLog(['A', 'B', 'Async', 'C', 'D']);
      expect(root).toMatchRenderedOutput('ABAsyncCD');
    },
  );

  /**
   * 场景（Given–When–Then）：给定同步根挂起后正在并发预渲染 C；当 Async 此时完成；那么
   * unwind 预渲染并从根重启，而不是继续旧路径的 D。验证机制：最终日志按 A/B/Async/C/D。
   */
  it('restart a suspended sync render if something suspends while prerendering the siblings', async () => {
    /** 在无边界的同步文本序列中插入 Async，供预渲染途中触发 ping。 */
    function App() {
      return (
        <>
          <Text text="A" />
          <Text text="B" />
          <AsyncText text="Async" />
          <Text text="C" />
          <Text text="D" />
        </>
      );
    }

    const root = ReactNoop.createRoot();
    // 同步挂载根。
    ReactNoop.flushSync(() => root.render(<App />));

    // 同步渲染到 shell 中的 Async 挂起为止。
    assertLog(['A', 'B', 'Suspend! [Async]']);

    // 其余兄弟开始并发预渲染。
    await waitFor(['C']);

    // 预渲染期间 Async 完成；应 unwind 后重头开始，而非沿旧路径继续 D。
    await resolveText('Async');
    assertLog(['A', 'B', 'Async', 'C', 'D']);
    expect(root).toMatchRenderedOutput('ABAsyncCD');
  });
});
