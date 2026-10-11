/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @jest-environment node
 */

let React;
let Scheduler;
let waitForAll;
let assertLog;
let ReactNoop;
let useState;
let act;
let Suspense;
let startTransition;
let getCacheForType;
let caches;
let assertConsoleErrorDev;

// 这些用例主要覆盖 concurrent root；legacy root
// 行为由更早的测试套件覆盖，自 React 17 起
// 没有变化。
/** 验证 concurrent 测试环境标志、裸 root/class/sync 更新及 Suspense ping/retry 的 act 开发警告。 */
describe('act warnings', () => {
  /** 重置 React/Noop/cache 与控制台断言工具，确保环境标志和资源代次不跨用例泄漏。 */
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    Scheduler = require('scheduler');
    ReactNoop = require('react-noop-renderer');
    act = React.act;
    useState = React.useState;
    Suspense = React.Suspense;
    startTransition = React.startTransition;
    getCacheForType = React.unstable_getCacheForType;
    caches = [];

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    assertLog = InternalTestUtils.assertLog;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;
  });

  /** 创建版本化文本 cache；pending 终结时先更新记录再同步通知登记的 ping，已 resolved/rejected 的记录不再改写。 */
  function createTextCache() {
    const data = new Map();
    const version = caches.length + 1;
    const cache = {
      version,
      data,
      /** 将文本置为 resolved；已有 pending thenable 时更新记录并唤醒等待者。 */
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
      /** 将文本置为 rejected；已有 pending thenable 时携带错误唤醒重试。 */
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

  /** 从当前 cache 读取文本；pending/rejected 抛出，resolved 返回版本，缺失时创建 thenable。 */
  function readText(text) {
    const textCache = getCacheForType(createTextCache);
    const record = textCache.data.get(text);
    if (record !== undefined) {
      // 状态机边界：pending/rejected 通过抛出进入 Suspense/错误路径，resolved 才返回版本。
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
        /** pending 时登记 ping，状态已结束则用微任务异步通知。 */
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

  /** 记录并返回文本，连接 update/retry 日志与根输出。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** 读取可挂起文本；成功后记录并返回，未就绪时由 readText 抛 thenable。 */
  function AsyncText({text}) {
    readText(text);
    Scheduler.log(text);
    return text;
  }

  /** 解决最新 cache 中的文本，无 cache 时抛错以避免误操作错误资源代。 */
  function resolveText(text) {
    if (caches.length === 0) {
      throw Error('Cache does not exist.');
    } else {
      // 默认解决最新 cache；旧 cache 可通过
      // `caches[index].resolve(text)` 单独解决。
      caches[caches.length - 1].resolve(text);
    }
  }

  /** 临时设置 IS_REACT_ACT_ENVIRONMENT，等待 scope 完成后在 finally 恢复原值。 */
  async function withActEnvironment(value, scope) {
    const prevValue = global.IS_REACT_ACT_ENVIRONMENT;
    global.IS_REACT_ACT_ENVIRONMENT = value;
    try {
      return await scope();
    } finally {
      global.IS_REACT_ACT_ENVIRONMENT = prevValue;
    }
  }

  /** Given–When–Then：Given同一 Hook setter 分别在 act 环境标志 undefined/true/false 下裸调用；When每次冲刷根；Then仅 true 发出未包裹 act 的警告。通过三次输出与控制台断言验证 isConcurrentActEnvironment 的并发测试环境门禁。 */
  it('warns about unwrapped updates only if environment flag is enabled', async () => {
    let setState;
    /** 暴露 Hook setter 并渲染 state，作为不同 act 环境标志下的更新探针。 */
    function App() {
      const [state, _setState] = useState(0);
      setState = _setState;
      return <Text text={state} />;
    }

    const root = ReactNoop.createRoot();
    root.render(<App />);
    await waitForAll([0]);
    expect(root).toMatchRenderedOutput('0');

    // 默认标志为 undefined：裸更新不警告。
    expect(global.IS_REACT_ACT_ENVIRONMENT).toBe(undefined);
    setState(1);
    await waitForAll([1]);
    expect(root).toMatchRenderedOutput('1');

    // 标志为 true：裸更新必须警告。
    await withActEnvironment(true, async () => {
      setState(2);
      assertConsoleErrorDev([
        'An update to App inside a test was not wrapped in act(...).\n' +
          '\n' +
          'When testing, code that causes React state updates should be wrapped into act(...):\n' +
          '\n' +
          'act(() => {\n' +
          '  /* fire events that update state */\n' +
          '});\n' +
          '/* assert on the output */\n' +
          '\n' +
          "This ensures that you're testing the behavior the user would see in the browser. " +
          'Learn more at https://react.dev/link/wrap-tests-with-act\n' +
          '    in App (at **)',
      ]);
      await waitForAll([2]);
      expect(root).toMatchRenderedOutput('2');
    });

    // 标志为 false：裸更新不警告。
    await withActEnvironment(false, async () => {
      setState(3);
      await waitForAll([3]);
      expect(root).toMatchRenderedOutput('3');
    });
  });

  /** Given–When–Then：Given主动调用 act，但环境标志分别为 undefined/true/false；When act 内更新同一根；Then仅 true 被视为已配置，另两种状态发出环境警告。通过日志与控制台验证 act scope 自身的环境检查。 */
  // @gate __DEV__
  it('act warns if the environment flag is not enabled', async () => {
    let setState;
    /** 暴露 Hook setter 并渲染 state，作为不同 act 环境标志下的更新探针。 */
    function App() {
      const [state, _setState] = useState(0);
      setState = _setState;
      return <Text text={state} />;
    }

    const root = ReactNoop.createRoot();
    root.render(<App />);
    await waitForAll([0]);
    expect(root).toMatchRenderedOutput('0');

    // 默认标志为 undefined：调用 act 时警告环境未配置。
    expect(global.IS_REACT_ACT_ENVIRONMENT).toBe(undefined);
    act(() => {
      setState(1);
    });
    assertConsoleErrorDev([
      'The current testing environment is not configured to support act(...)',
    ]);
    assertLog([1]);
    expect(root).toMatchRenderedOutput('1');

    // 标志为 true：act 环境已配置，不警告。
    await withActEnvironment(true, () => {
      act(() => {
        setState(2);
      });
      assertLog([2]);
      expect(root).toMatchRenderedOutput('2');
    });

    // 标志为 false：明确禁用 act 环境，仍需警告。
    await withActEnvironment(false, () => {
      act(() => {
        setState(1);
      });
      assertConsoleErrorDev([
        'The current testing environment is not configured to support act(...)',
      ]);
      assertLog([1]);
      expect(root).toMatchRenderedOutput('1');
    });
  });

  /** Given–When–Then：Given act 环境已启用；When新 concurrent root 直接 render Hi；Then以 Root 为更新来源发出未包裹警告。通过无组件栈的精确消息验证 HostRoot 更新路径。 */
  it('warns if root update is not wrapped', async () => {
    await withActEnvironment(true, () => {
      const root = ReactNoop.createRoot();
      root.render('Hi');
      assertConsoleErrorDev([
        // TODO: 改进错误消息，避免把 “Root” 看起来像
        // 自定义组件名。
        'An update to Root inside a test was not wrapped in act(...).\n' +
          '\n' +
          'When testing, code that causes React state updates should be wrapped into act(...):\n' +
          '\n' +
          'act(() => {\n' +
          '  /* fire events that update state */\n' +
          '});\n' +
          '/* assert on the output */\n' +
          '\n' +
          "This ensures that you're testing the behavior the user would see in the browser. " +
          'Learn more at https://react.dev/link/wrap-tests-with-act',
      ]);
    });
  });

  /** Given–When–Then：Given类 App 先在 act 内挂载；When随后裸调用实例 setState；Then开发模式报告 App 更新未包裹。通过类组件栈警告验证 class updater 路径。 */
  // @gate __DEV__
  it('warns if class update is not wrapped', async () => {
    let app;
    /** 暴露类实例并渲染 count，用于覆盖未包裹 class setState 警告。 */
    class App extends React.Component {
      /** 类更新计数；从 0 裸更新为 1 以触发警告。 */
      state = {count: 0};
      /** 保存实例并通过 Text 输出 count，使外部可调用 setState。 */
      render() {
        app = this;
        return <Text text={this.state.count} />;
      }
    }

    await withActEnvironment(true, () => {
      const root = ReactNoop.createRoot();
      act(() => {
        root.render(<App />);
      });
      app.setState({count: 1});
      assertConsoleErrorDev([
        'An update to App inside a test was not wrapped in act(...).\n' +
          '\n' +
          'When testing, code that causes React state updates should be wrapped into act(...):\n' +
          '\n' +
          'act(() => {\n' +
          '  /* fire events that update state */\n' +
          '});\n' +
          '/* assert on the output */\n' +
          '\n' +
          "This ensures that you're testing the behavior the user would see in the browser. " +
          'Learn more at https://react.dev/link/wrap-tests-with-act\n' +
          '    in App (at **)',
      ]);
    });
  });

  /** Given–When–Then：Given act 环境已启用且 App 已挂载；When在 act 外使用 flushSync 更新 Hook state；Then即使宿主同步提交仍发出未包裹警告。通过日志、输出和警告验证 flushSync 并不豁免 act 环境检查；本例没有额外异步工作断言。 */
  // @gate __DEV__
  it('warns even if update is synchronous', async () => {
    let setState;
    /** 暴露 Hook setter 并渲染 state，作为不同 act 环境标志下的更新探针。 */
    function App() {
      const [state, _setState] = useState(0);
      setState = _setState;
      return <Text text={state} />;
    }

    await withActEnvironment(true, () => {
      const root = ReactNoop.createRoot();
      act(() => root.render(<App />));
      assertLog([0]);
      expect(root).toMatchRenderedOutput('0');

      // 此更新虽同步，也必须警告，
      // 因为它仍可能派生额外异步工作。
      ReactNoop.flushSync(() => setState(1));
      assertConsoleErrorDev([
        'An update to App inside a test was not wrapped in act(...).\n' +
          '\n' +
          'When testing, code that causes React state updates should be wrapped into act(...):\n' +
          '\n' +
          'act(() => {\n' +
          '  /* fire events that update state */\n' +
          '});\n' +
          '/* assert on the output */\n' +
          '\n' +
          "This ensures that you're testing the behavior the user would see in the browser. " +
          'Learn more at https://react.dev/link/wrap-tests-with-act\n' +
          '    in App (at **)',
      ]);

      assertLog([1]);
      expect(root).toMatchRenderedOutput('1');
    });
  });

  /** Given–When–Then：Given act 内初次挂起并已提交 Loading fallback；When act 外解决资源触发 retry；Then报告资源解决未包裹 act，本例预热和已提交边界的注册路径共产生两条警告。通过控制台数组验证已显示 fallback 的 retry 路径。 */
  // @gate __DEV__
  // @gate enableLegacyCache
  it('warns if Suspense retry is not wrapped', async () => {
    /** 直接渲染会挂起的 AsyncText 并提交 Loading，用于测试已显示 fallback 的 retry 警告。 */
    function App() {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <AsyncText text="Async" />
        </Suspense>
      );
    }

    await withActEnvironment(true, () => {
      const root = ReactNoop.createRoot();
      act(() => {
        root.render(<App />);
      });
      assertLog([
        'Suspend! [Async]',
        'Loading...',
        // 预热被挂起的主树。
        'Suspend! [Async]',
      ]);
      expect(root).toMatchRenderedOutput('Loading...');

      // fallback 已显示，因此资源完成触发 retry，而非仅 ping 在途树。
      resolveText('Async');
      assertConsoleErrorDev([
        'A suspended resource finished loading inside a test, but the event was not wrapped in act(...).\n' +
          '\n' +
          'When testing, code that resolves suspended data should be wrapped into act(...):\n' +
          '\n' +
          'act(() => {\n' +
          '  /* finish loading suspended data */\n' +
          '});\n' +
          '/* assert on the output */\n' +
          '\n' +
          "This ensures that you're testing the behavior the user would see in the browser. " +
          'Learn more at https://react.dev/link/wrap-tests-with-act',

        // 预热被挂起的主树。

        'A suspended resource finished loading inside a test, but the event was not wrapped in act(...).\n' +
          '\n' +
          'When testing, code that resolves suspended data should be wrapped into act(...):\n' +
          '\n' +
          'act(() => {\n' +
          '  /* finish loading suspended data */\n' +
          '});\n' +
          '/* assert on the output */\n' +
          '\n' +
          "This ensures that you're testing the behavior the user would see in the browser. " +
          'Learn more at https://react.dev/link/wrap-tests-with-act',
      ]);
    });
  });

  /** Given–When–Then：Given transition 挂起但保留旧的 empty 内容、未提交 fallback；When act 外解决资源触发 ping；Then报告一次资源解决未包裹 act。通过旧宿主输出与警告验证未显示 fallback 的 ping 路径。 */
  // @gate __DEV__
  // @gate enableLegacyCache
  it('warns if Suspense ping is not wrapped', async () => {
    /** 在 empty 与 AsyncText 间切换，transition 挂起时保留旧内容以测试 ping 警告。 */
    function App({showMore}) {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          {showMore ? <AsyncText text="Async" /> : <Text text="(empty)" />}
        </Suspense>
      );
    }

    await withActEnvironment(true, () => {
      const root = ReactNoop.createRoot();
      act(() => {
        root.render(<App showMore={false} />);
      });
      assertLog(['(empty)']);
      expect(root).toMatchRenderedOutput('(empty)');

      act(() => {
        startTransition(() => {
          root.render(<App showMore={true} />);
        });
      });
      assertLog(['Suspend! [Async]', 'Loading...']);
      expect(root).toMatchRenderedOutput('(empty)');

      // fallback 未显示，因此资源完成只 ping 在途树，而非 retry 已提交边界。
      resolveText('Async');
      assertConsoleErrorDev([
        'A suspended resource finished loading inside a test, but the event was not wrapped in act(...).\n' +
          '\n' +
          'When testing, code that resolves suspended data should be wrapped into act(...):\n' +
          '\n' +
          'act(() => {\n' +
          '  /* finish loading suspended data */\n' +
          '});\n' +
          '/* assert on the output */\n' +
          '\n' +
          "This ensures that you're testing the behavior the user would see in the browser. " +
          'Learn more at https://react.dev/link/wrap-tests-with-act',
      ]);
    });
  });
});
