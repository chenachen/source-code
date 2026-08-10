let React;
let ReactTestRenderer;
let Scheduler;
let Suspense;
let lazy;
let waitFor;
let waitForAll;
let waitForThrow;
let assertLog;
let assertConsoleErrorDev;
let act;

let fakeModuleCache;

/** normalizeCodeLocInfo 抹平组件栈中的真实文件位置，只保留组件名与 `(at **)`，使错误栈断言跨环境稳定。 */
function normalizeCodeLocInfo(str) {
  return (
    str &&
    str.replace(/\n +(?:at|in) ([\S]+)[^\n]*/g, function (m, name) {
      return '\n    in ' + name + ' (at **)';
    })
  );
}

/** 覆盖 React.lazy payload 状态机、Suspense retry、resolved type 分发、defaultProps、组件栈与 keyed reconcile。 */
describe('ReactLazy', () => {
  /** 每个用例前重置模块并重新绑定 React、TestRenderer、Scheduler 与内部等待/断言工具，同时清空 fake module cache。 */
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    Suspense = React.Suspense;
    lazy = React.lazy;
    ReactTestRenderer = require('react-test-renderer');
    Scheduler = require('scheduler');

    const InternalTestUtils = require('internal-test-utils');
    waitFor = InternalTestUtils.waitFor;
    waitForAll = InternalTestUtils.waitForAll;
    waitForThrow = InternalTestUtils.waitForThrow;
    assertLog = InternalTestUtils.assertLog;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;
    act = InternalTestUtils.act;

    fakeModuleCache = new Map();
  });

  /** Text 将渲染值写入 Scheduler 并返回文本，用于区分 fallback、primary render 与最终提交。 */
  function Text(props) {
    Scheduler.log(props.text);
    return props.text;
  }

  /** fakeImport 为组件/元素建立可控 module 记录；首次为 pending，重复请求复用同一记录，模拟动态 import cache。 */
  async function fakeImport(Component) {
    const record = fakeModuleCache.get(Component);
    if (record === undefined) {
      const newRecord = {
        status: 'pending',
        value: {default: Component},
        pings: [],
        /** fakeImport.then 根据 module 状态处理订阅：pending 保存 ping，resolved 立即回放 module，rejected 重新抛错。 */
        then(ping) {
          switch (newRecord.status) {
            case 'pending': {
              newRecord.pings.push(ping);
              return;
            }
            case 'resolved': {
              ping(newRecord.value);
              return;
            }
            case 'rejected': {
              throw newRecord.value;
            }
          }
        },
      };
      fakeModuleCache.set(Component, newRecord);
      return newRecord;
    }
    return record;
  }

  /** resolveFakeImport 只允许 pending→resolved，随后向全部订阅者发送 module object；缺失或重复完成直接报错。 */
  function resolveFakeImport(moduleName) {
    const record = fakeModuleCache.get(moduleName);
    if (record === undefined) {
      throw new Error('Module not found');
    }
    if (record.status !== 'pending') {
      throw new Error('Module already resolved');
    }
    record.status = 'resolved';
    record.pings.forEach(ping => ping(record.value));
  }

  /**
   * Given：LazyText payload 初始为 Uninitialized，initializer 返回 fakeImport 的 pending thenable。
   * When：首次 render 抛出 thenable 并提交 fallback；resolveFakeImport 把记录置为 resolved 并触发 ping。
   * Then：retry 从 module.default 得到 Text 并提交 Hi；后续 prop 更新复用 Resolved payload，不再挂起。
   *
   * 验证机制：fallback、Hi、Hi again 三阶段日志及宿主输出验证 payload 状态只初始化一次。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()`，以及 `ReactFiberThrow.js` 的 ping/retry 路径。
   */
  it('suspends until module has loaded', async () => {
    const LazyText = lazy(() => fakeImport(Text));

    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyText text="Hi" />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);
    expect(root).not.toMatchRenderedOutput('Hi');

    await act(() => resolveFakeImport(Text));
    assertLog(['Hi']);
    expect(root).toMatchRenderedOutput('Hi');

    // payload 已 resolved；更新时不应再次挂起。
    root.update(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyText text="Hi again" />
      </Suspense>,
    );
    await waitForAll(['Hi again']);
    expect(root).toMatchRenderedOutput('Hi again');
  });

  /**
   * Given：Context.Provider 与 Context 本体同一引用，LazyProvider 的 module.default 直接指向该 Context。
   * When：首次渲染挂起，解决 Context module 后再把 provider value 从 Hi 更新为 Hi again。
   * Then：lazy 解析结果按 Context Provider Fiber 处理，Consumer 两次读取最新值，更新不再挂起。
   *
   * 验证机制：Loading、Hi、Hi again 日志与输出同时验证 lazy 解析和 Provider 传播。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()`、`ReactFiber.js` 的 lazy tag 解析与 `ReactFiberBeginWork.js` 的 `updateContextProvider()`。
   */
  it('renders a lazy context provider', async () => {
    const Context = React.createContext('default');
    /** ConsumerText 读取当前 Context 并交给 Text，验证 Lazy Context Provider 的解析和更新。 */
    function ConsumerText() {
      return <Text text={React.useContext(Context)} />;
    }
    // Context.Provider 与 Context 本体相同，因此可直接 lazy-load Context。
    const LazyProvider = lazy(() => fakeImport(Context));

    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyProvider value="Hi">
          <ConsumerText />
        </LazyProvider>
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);
    expect(root).not.toMatchRenderedOutput('Hi');

    await act(() => resolveFakeImport(Context));
    assertLog(['Hi']);
    expect(root).toMatchRenderedOutput('Hi');

    // payload 已 resolved；更新时不应再次挂起。
    root.update(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyProvider value="Hi again">
          <ConsumerText />
        </LazyProvider>
      </Suspense>,
    );
    await waitForAll(['Hi again']);
    expect(root).toMatchRenderedOutput('Hi again');
  });

  /**
   * Given：initializer 返回一个 thenable，其 then 在订阅时立即以 `{default: Text}` 回调。
   * When：lazyInitializer 首次执行并同步收到 fulfilled module。
   * Then：payload 在检查前已进入 Resolved，直接返回 Text，不抛 thenable也不显示 fallback。
   *
   * 验证机制：日志仅有 Hi，宿主直接提交 Hi。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()`。
   */
  it('can resolve synchronously without suspending', async () => {
    const LazyText = lazy(() => ({
      /** then 实现本场景的同步 fulfilled/rejected thenable 协议，用于“同步 fulfilled thenable 不经过 Suspense fallback”。 */
      then(cb) {
        cb({default: Text});
      },
    }));

    let root;
    await act(() => {
      root = ReactTestRenderer.create(
        <Suspense fallback={<Text text="Loading..." />}>
          <LazyText text="Hi" />
        </Suspense>,
        {unstable_isConcurrent: true},
      );
    });

    assertLog(['Hi']);
    expect(root).toMatchRenderedOutput('Hi');
  });

  /**
   * Given：initializer thenable 在订阅时同步调用 reject，并由 ErrorBoundary 包围 LazyText。
   * When：lazyInitializer 首次执行并同步进入 Rejected。
   * Then：错误直接交给 ErrorBoundary，Suspense 不把 rejection 当作 pending fallback。
   *
   * 验证机制：日志为空且宿主输出 `Error: oh no`，证明错误边界而非 fallback 接管。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()` 与 `ReactFiberThrow.js` 的错误边界捕获。
   */
  it('can reject synchronously without suspending', async () => {
    const LazyText = lazy(() => ({
      /** then 实现本场景的同步 fulfilled/rejected thenable 协议，用于“同步 rejected thenable 直接抛给 ErrorBoundary”。 */
      then(resolve, reject) {
        reject(new Error('oh no'));
      },
    }));

    /** 定义 ErrorBoundary 类 fixture，暴露实例身份、defaultProps、错误边界或生命周期，用于“同步 rejected thenable 直接抛给 ErrorBoundary”。 */
    class ErrorBoundary extends React.Component {
      /** ErrorBoundary.state 保存实例或错误边界状态，区分 Lazy retry、普通更新与 bailout。 */
      state = {};
      /** ErrorBoundary.getDerivedStateFromError 把 Lazy initializer 的同步 rejection 转成可渲染错误状态。 */
      static getDerivedStateFromError(error) {
        return {message: error.message};
      }
      /** ErrorBoundary.render 渲染当前 props/state 并暴露日志或宿主输出，用于“同步 rejected thenable 直接抛给 ErrorBoundary”。 */
      render() {
        return this.state.message
          ? `Error: ${this.state.message}`
          : this.props.children;
      }
    }

    let root;
    await act(() => {
      root = ReactTestRenderer.create(
        <ErrorBoundary>
          <Suspense fallback={<Text text="Loading..." />}>
            <LazyText text="Hi" />
          </Suspense>
        </ErrorBoundary>,
        {unstable_isConcurrent: true},
      );
    });
    assertLog([]);
    expect(root).toMatchRenderedOutput('Error: oh no');
  });

  /**
   * Given：同一 Suspense 内 LazyFoo、LazyBar 各有独立 lazy payload 和 module 记录。
   * When：先解决 Foo，再解决 Bar。
   * Then：只解决 Foo 时边界仍不能提交 primary；两个 payload 都 Resolved 后原子提交 FooBar。
   *
   * 验证机制：中间日志 Foo 但宿主仍非 FooBar，最终 Foo/Bar 日志与输出验证边界一致提交。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()` 与 `ReactFiberBeginWork.js` 的 Suspense primary/fallback 路径。
   */
  it('multiple lazy components', async () => {
    /** Foo 作为可解析 module 的真实组件，提供独立日志、类型或 ref 行为，用于“同一边界等待多个独立 Lazy payload 全部完成”。 */
    function Foo() {
      return <Text text="Foo" />;
    }

    /** Bar 作为可解析 module 的真实组件，提供独立日志、类型或 ref 行为，用于“同一边界等待多个独立 Lazy payload 全部完成”。 */
    function Bar() {
      return <Text text="Bar" />;
    }

    const LazyFoo = lazy(() => fakeImport(Foo));
    const LazyBar = lazy(() => fakeImport(Bar));

    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyFoo />
        <LazyBar />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);
    expect(root).not.toMatchRenderedOutput('FooBar');

    await resolveFakeImport(Foo);

    await waitForAll(['Foo']);
    expect(root).not.toMatchRenderedOutput('FooBar');

    await act(() => resolveFakeImport(Bar));
    assertLog(['Foo', 'Bar']);
    expect(root).toMatchRenderedOutput('FooBar');
  });

  /**
   * Given：initializer 的 async 函数直接返回 Text 组件，而非带 default 字段的 module object。
   * When：promise fulfilled 后 LazyText retry。
   * Then：lazyInitializer 无法从结果读取合法 module.default，reconciler 报 invalid element type。
   *
   * 验证机制：捕获错误、两条开发态 lazy 用法告警与未提交 Hi 的断言共同验证。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()` 与 `ReactFiber.js` 的 `createFiberFromTypeAndProps()`。
   */
  it('does not support arbitrary promises, only module objects', async () => {
    const LazyText = lazy(async () => Text);

    const root = ReactTestRenderer.create(null, {
      unstable_isConcurrent: true,
    });

    /** App 组织 Lazy、Suspense 与错误捕获层级，用于“React.lazy 只接受动态 import 风格 module object”。 */
    function App() {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <LazyText text="Hi" />
        </Suspense>
      );
    }

    let error;
    try {
      await act(() => {
        root.update(<App />);
      });
    } catch (e) {
      error = e;
    }

    expect(error.message).toMatch('Element type is invalid');
    assertLog(['Loading...']);
    assertConsoleErrorDev([
      'lazy: Expected the result of a dynamic import() call. ' +
        'Instead received: function Text(props) {\n' +
        '    Scheduler.log(props.text);\n' +
        '    return props.text;\n' +
        '  }\n\n' +
        'Your code should look like: \n  ' +
        "const MyComponent = lazy(() => import('./MyComponent'))\n" +
        '    in App (at **)',
      'lazy: Expected the result of a dynamic import() call. ' +
        'Instead received: function Text(props) {\n' +
        '    Scheduler.log(props.text);\n' +
        '    return props.text;\n' +
        '  }\n\n' +
        'Your code should look like: \n  ' +
        "const MyComponent = lazy(() => import('./MyComponent'))\n" +
        '    in App (at **)',
    ]);
    expect(root).not.toMatchRenderedOutput('Hi');
  });

  /**
   * Given：LazyText initializer 的 async promise 抛出预先创建的 networkError。
   * When：render 挂起后 promise 进入 Rejected 并触发 retry。
   * Then：lazyInitializer 重新抛出 payload._result，保持原始错误对象身份。
   *
   * 验证机制：expect(error).toBe(networkError)、fallback 日志与未提交 Hi 的输出共同验证。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()`。
   */
  it('throws if promise rejects', async () => {
    const networkError = new Error('Bad network');
    const LazyText = lazy(async () => {
      throw networkError;
    });

    const root = ReactTestRenderer.create(null, {
      unstable_isConcurrent: true,
    });

    let error;
    try {
      await act(() => {
        root.update(
          <Suspense fallback={<Text text="Loading..." />}>
            <LazyText text="Hi" />
          </Suspense>,
        );
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBe(networkError);
    assertLog(['Loading...']);
    expect(root).not.toMatchRenderedOutput('Hi');
  });

  /**
   * Given：LazyChildA/B 是两个 lazy payload，但共享同一 Child module cache；列表用稳定 A/B key。
   * When：首次依次初始化并解决 module，随后把顺序 AB 交换为 BA。
   * Then：每个 lazy payload独立完成初始化；重排按 key 复用 Child 实例，只触发 update 而非 remount。
   *
   * 验证机制：预热/resolve 日志、Did mount 与交换后的 Did update 顺序及 AB→BA 输出验证。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()` 与 `ReactChildFiber.js` 的 keyed reconciliation。
   */
  it('mount and reorder', async () => {
    /** 定义 Child 类 fixture，暴露实例身份、defaultProps、错误边界或生命周期，用于“共享 module 的多个 Lazy payload 初始化后按 key 重排并保留实例”。 */
    class Child extends React.Component {
      /** Child.componentDidMount 记录首次提交及实例 label/defaultProps，用于“共享 module 的多个 Lazy payload 初始化后按 key 重排并保留实例”。 */
      componentDidMount() {
        Scheduler.log('Did mount: ' + this.props.label);
      }
      /** Child.componentDidUpdate 记录复用实例的更新提交，用于区分 keyed reorder 与 remount。 */
      componentDidUpdate() {
        Scheduler.log('Did update: ' + this.props.label);
      }
      /** Child.render 渲染当前 props/state 并暴露日志或宿主输出，用于“共享 module 的多个 Lazy payload 初始化后按 key 重排并保留实例”。 */
      render() {
        return <Text text={this.props.label} />;
      }
    }

    const LazyChildA = lazy(() => {
      Scheduler.log('Suspend! [LazyChildA]');
      return fakeImport(Child);
    });
    const LazyChildB = lazy(() => {
      Scheduler.log('Suspend! [LazyChildB]');
      return fakeImport(Child);
    });

    /** Parent 根据 swap 选择 Lazy children 顺序和类型，驱动“共享 module 的多个 Lazy payload 初始化后按 key 重排并保留实例”。 */
    function Parent({swap}) {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          {swap
            ? [
                <LazyChildB key="B" label="B" />,
                <LazyChildA key="A" label="A" />,
              ]
            : [
                <LazyChildA key="A" label="A" />,
                <LazyChildB key="B" label="B" />,
              ]}
        </Suspense>
      );
    }

    const root = ReactTestRenderer.create(<Parent swap={false} />, {
      unstable_isConcurrent: true,
    });

    await waitForAll([
      'Suspend! [LazyChildA]',
      'Loading...',
      // 执行预热渲染；该遍只初始化后续 Lazy 节点，不作为最终提交。
      'Suspend! [LazyChildB]',
    ]);
    expect(root).not.toMatchRenderedOutput('AB');

    await act(async () => {
      await resolveFakeImport(Child);

      // 即使 B 与 A 共享同一 import，B 的独立 Lazy payload 仍会先进入挂起路径。
      // TODO：React.lazy 应实现 `status` 与 `value` 字段，
      // 使已加载结果可像 `use` 一样被同步解包。
      await waitFor([
        'A',
        // 预热阶段已初始化 LazyChildB；因此上方 resolveFakeImport
        // 同时解决了它，本次不会再次挂起。
        'B',
      ]);
    });
    assertLog(['Did mount: A', 'Did mount: B']);
    expect(root).toMatchRenderedOutput('AB');

    // 交换 A 与 B 的位置。
    root.update(<Parent swap={true} />);
    await waitForAll(['B', 'A', 'Did update: B', 'Did update: A']);
    expect(root).toMatchRenderedOutput('BA');
  });

  /**
   * Given：class T 的 defaultProps 初始 text=Hi，LazyText 首次尚未解析。
   * When：解决 module 后挂载，再修改 T.defaultProps 为 Hi again 并更新同一 LazyText。
   * Then：lazy 解析后的真实类型负责补默认 props，挂载和更新都读取当前默认值。
   *
   * 验证机制：Loading→Hi→Hi again 日志与宿主输出验证默认值解析时机。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()` 与 `ReactFiberClassComponent.js` 的 `resolveClassComponentProps()`。
   */
  it('resolves defaultProps, on mount and update', async () => {
    /** 定义 T 类 fixture，暴露实例身份、defaultProps、错误边界或生命周期，用于“Lazy class 在挂载和更新时解析真实类型的 defaultProps”。 */
    class T extends React.Component {
      /** T.render 渲染当前 props/state 并暴露日志或宿主输出，用于“Lazy class 在挂载和更新时解析真实类型的 defaultProps”。 */
      render() {
        return <Text {...this.props} />;
      }
    }
    T.defaultProps = {text: 'Hi'};
    const LazyText = lazy(() => fakeImport(T));

    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyText />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);
    expect(root).not.toMatchRenderedOutput('Hi');

    await act(() => resolveFakeImport(T));
    assertLog(['Hi']);

    expect(root).toMatchRenderedOutput('Hi');

    T.defaultProps = {text: 'Hi again'};
    root.update(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyText />
      </Suspense>,
    );
    await waitForAll(['Hi again']);
    expect(root).toMatchRenderedOutput('Hi again');
  });

  /**
   * Given：LazyImpl 有默认 siblingText，children 是带本地 state 的 Stateful。
   * When：解决 LazyImpl 后仅调用 Stateful.setState A→B。
   * Then：子组件更新不重新执行外层 LazyImpl，默认 props 解析不破坏 children memoization。
   *
   * 验证机制：更新日志只有 B、没有 Lazy/Sibling，输出由 SiblingA 变为 SiblingB。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()` 与 `ReactFiberBeginWork.js` 的 lazy component bailout。
   */
  it('resolves defaultProps without breaking memoization', async () => {
    /** 定义 LazyImpl 类 fixture，暴露实例身份、defaultProps、错误边界或生命周期，用于“defaultProps 解析不破坏 Lazy 父组件对子更新的 memoization”。 */
    class LazyImpl extends React.Component {
      /** LazyImpl.render 渲染当前 props/state 并暴露日志或宿主输出，用于“defaultProps 解析不破坏 Lazy 父组件对子更新的 memoization”。 */
      render() {
        Scheduler.log('Lazy');
        return (
          <>
            <Text text={this.props.siblingText} />
            {this.props.children}
          </>
        );
      }
    }
    LazyImpl.defaultProps = {siblingText: 'Sibling'};
    const Lazy = lazy(() => fakeImport(LazyImpl));

    /** 定义 Stateful 类 fixture，暴露实例身份、defaultProps、错误边界或生命周期，用于“defaultProps 解析不破坏 Lazy 父组件对子更新的 memoization”。 */
    class Stateful extends React.Component {
      /** Stateful.state 保存实例或错误边界状态，区分 Lazy retry、普通更新与 bailout。 */
      state = {text: 'A'};
      /** Stateful.render 渲染当前 props/state 并暴露日志或宿主输出，用于“defaultProps 解析不破坏 Lazy 父组件对子更新的 memoization”。 */
      render() {
        return <Text text={this.state.text} />;
      }
    }

    const stateful = React.createRef(null);

    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <Lazy>
          <Stateful ref={stateful} />
        </Lazy>
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );
    await waitForAll(['Loading...']);
    expect(root).not.toMatchRenderedOutput('SiblingA');

    await act(() => resolveFakeImport(LazyImpl));
    assertLog(['Lazy', 'Sibling', 'A']);

    expect(root).toMatchRenderedOutput('SiblingA');

    // 仅更新后代；LazyImpl 不应重新渲染。
    stateful.current.setState({text: 'B'});
    await waitForAll(['B']);
    expect(root).toMatchRenderedOutput('SiblingB');
  });

  /**
   * Given：同一 LazyImpl 同时直接挂载和经 Lazy 包装挂载，defaultProps 都补 value=0。
   * When：分别对两个实例调用 setState(null)，props/state 都不变。
   * Then：lazy 默认 props 解析不会制造新的有效更新，两条 class 路径都 bailout。
   *
   * 验证机制：两次 waitForAll([]) 与稳定输出证明 direct/lazy 行为一致。
   * 对应源码：`ReactFiberClassComponent.js` 的 `resolveClassComponentProps()`、`checkShouldComponentUpdate()` 与 lazy mount 路径。
   */
  it('resolves defaultProps without breaking bailout due to unchanged props and state, #17151', async () => {
    /** 定义 LazyImpl 类 fixture，暴露实例身份、defaultProps、错误边界或生命周期，用于“Lazy class 的 defaultProps 不破坏 props/state 不变时的 bailout”。 */
    class LazyImpl extends React.Component {
      /** LazyImpl.defaultProps 声明缺省 props，验证 Lazy 解包后由真实组件类型负责补值。 */
      static defaultProps = {value: 0};

      /** LazyImpl.render 渲染当前 props/state 并暴露日志或宿主输出，用于“Lazy class 的 defaultProps 不破坏 props/state 不变时的 bailout”。 */
      render() {
        const text = `${this.props.label}: ${this.props.value}`;
        return <Text text={text} />;
      }
    }

    const Lazy = lazy(() => fakeImport(LazyImpl));

    const instance1 = React.createRef(null);
    const instance2 = React.createRef(null);

    const root = ReactTestRenderer.create(
      <>
        <LazyImpl ref={instance1} label="Not lazy" />
        <Suspense fallback={<Text text="Loading..." />}>
          <Lazy ref={instance2} label="Lazy" />
        </Suspense>
      </>,
      {
        unstable_isConcurrent: true,
      },
    );
    await waitForAll(['Not lazy: 0', 'Loading...']);
    expect(root).not.toMatchRenderedOutput('Not lazy: 0Lazy: 0');

    await act(() => resolveFakeImport(LazyImpl));
    assertLog(['Lazy: 0']);
    expect(root).toMatchRenderedOutput('Not lazy: 0Lazy: 0');

    // props 与 state 均未变化，应当 bailout。
    instance1.current.setState(null);
    await waitForAll([]);
    expect(root).toMatchRenderedOutput('Not lazy: 0Lazy: 0');

    // props 与 state 均未变化，应当 bailout。
    instance2.current.setState(null);
    await waitForAll([]);
    expect(root).toMatchRenderedOutput('Not lazy: 0Lazy: 0');
  });

  /**
   * Given：直接与 Lazy 两个 PureComponent 实例都由 defaultProps 补 value=0，state 初始为空对象。
   * When：分别 setState({}) 产生浅相等 props/state。
   * Then：Lazy 路径保持与直接 PureComponent 相同的 shallow-equal bailout。
   *
   * 验证机制：两次空日志与稳定输出验证没有额外 render。
   * 对应源码：`ReactFiberClassComponent.js` 的 defaultProps 解析与 PureComponent shallow compare。
   */
  it('resolves defaultProps without breaking bailout in PureComponent, #17151', async () => {
    /** 定义 LazyImpl 类 fixture，暴露实例身份、defaultProps、错误边界或生命周期，用于“Lazy PureComponent 的 defaultProps 不破坏浅比较 bailout”。 */
    class LazyImpl extends React.PureComponent {
      /** LazyImpl.defaultProps 声明缺省 props，验证 Lazy 解包后由真实组件类型负责补值。 */
      static defaultProps = {value: 0};
      /** LazyImpl.state 保存实例或错误边界状态，区分 Lazy retry、普通更新与 bailout。 */
      state = {};

      /** LazyImpl.render 渲染当前 props/state 并暴露日志或宿主输出，用于“Lazy PureComponent 的 defaultProps 不破坏浅比较 bailout”。 */
      render() {
        const text = `${this.props.label}: ${this.props.value}`;
        return <Text text={text} />;
      }
    }

    const Lazy = lazy(() => fakeImport(LazyImpl));

    const instance1 = React.createRef(null);
    const instance2 = React.createRef(null);

    const root = ReactTestRenderer.create(
      <>
        <LazyImpl ref={instance1} label="Not lazy" />
        <Suspense fallback={<Text text="Loading..." />}>
          <Lazy ref={instance2} label="Lazy" />
        </Suspense>
      </>,
      {
        unstable_isConcurrent: true,
      },
    );
    await waitForAll(['Not lazy: 0', 'Loading...']);
    expect(root).not.toMatchRenderedOutput('Not lazy: 0Lazy: 0');

    await act(() => resolveFakeImport(LazyImpl));
    assertLog(['Lazy: 0']);
    expect(root).toMatchRenderedOutput('Not lazy: 0Lazy: 0');

    // props 与 state 浅比较相等，应当 bailout。
    instance1.current.setState({});
    await waitForAll([]);
    expect(root).toMatchRenderedOutput('Not lazy: 0Lazy: 0');

    // props 与 state 浅比较相等，应当 bailout。
    instance2.current.setState({});
    await waitForAll([]);
    expect(root).toMatchRenderedOutput('Not lazy: 0Lazy: 0');
  });

  /**
   * Given：Lazy class C 的 defaultProps.text=A，并实现 constructor、派生 state、SCU、snapshot 与提交生命周期。
   * When：解决 module 完成挂载，再仅更新 num 1→2→3。
   * Then：每个现代生命周期都收到解析后的 text=A，prev/next props 顺序保持一致。
   *
   * 验证机制：完整 Scheduler 序列锁定 render 前、snapshot 和 commit 阶段的默认 props。
   * 对应源码：`ReactFiberClassComponent.js` 的 `constructClassInstance()`、`updateClassInstance()` 与 defaultProps 解析。
   */
  it('sets defaultProps for modern lifecycles', async () => {
    /** 定义 C 类 fixture，暴露实例身份、defaultProps、错误边界或生命周期，用于“Lazy class 的现代生命周期收到完整 defaultProps”。 */
    class C extends React.Component {
      /** C.defaultProps 声明缺省 props，验证 Lazy 解包后由真实组件类型负责补值。 */
      static defaultProps = {text: 'A'};
      /** C.state 保存实例或错误边界状态，区分 Lazy retry、普通更新与 bailout。 */
      state = {};

      /** C.getDerivedStateFromProps 记录 render 前收到的 defaultProps，验证现代生命周期输入。 */
      static getDerivedStateFromProps(props) {
        Scheduler.log(`getDerivedStateFromProps: ${props.text}`);
        return null;
      }

      /** C.constructor 在实例创建时记录已解析的 defaultProps，验证 Lazy mount 的 props 准备顺序。 */
      constructor(props) {
        super(props);
        Scheduler.log(`constructor: ${this.props.text}`);
      }

      /** C.componentDidMount 记录首次提交及实例 label/defaultProps，用于“Lazy class 的现代生命周期收到完整 defaultProps”。 */
      componentDidMount() {
        Scheduler.log(`componentDidMount: ${this.props.text}`);
      }

      /** C.componentDidUpdate 记录更新前后的默认属性，验证 Lazy class 在提交阶段仍使用解析后的值。 */
      componentDidUpdate(prevProps) {
        Scheduler.log(
          `componentDidUpdate: ${prevProps.text} -> ${this.props.text}`,
        );
      }

      /** C.componentWillUnmount 记录卸载时的最终默认属性，补齐现代生命周期的输入边界。 */
      componentWillUnmount() {
        Scheduler.log(`componentWillUnmount: ${this.props.text}`);
      }

      /** C.shouldComponentUpdate 记录 nextProps 并允许更新，用于核对 defaultProps 在 SCU 前已解析。 */
      shouldComponentUpdate(nextProps) {
        Scheduler.log(
          `shouldComponentUpdate: ${this.props.text} -> ${nextProps.text}`,
        );
        return true;
      }

      /** C.getSnapshotBeforeUpdate 在 commit 前记录 prev/current props，验证 Lazy class 更新顺序。 */
      getSnapshotBeforeUpdate(prevProps) {
        Scheduler.log(
          `getSnapshotBeforeUpdate: ${prevProps.text} -> ${this.props.text}`,
        );
        return null;
      }

      /** C.render 渲染当前 props/state 并暴露日志或宿主输出，用于“Lazy class 的现代生命周期收到完整 defaultProps”。 */
      render() {
        return <Text text={this.props.text + this.props.num} />;
      }
    }

    const LazyClass = lazy(() => fakeImport(C));

    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyClass num={1} />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);
    expect(root).not.toMatchRenderedOutput('A1');

    await act(() => resolveFakeImport(C));
    assertLog([
      'constructor: A',
      'getDerivedStateFromProps: A',
      'A1',
      'componentDidMount: A',
    ]);

    root.update(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyClass num={2} />
      </Suspense>,
    );
    await waitForAll([
      'getDerivedStateFromProps: A',
      'shouldComponentUpdate: A -> A',
      'A2',
      'getSnapshotBeforeUpdate: A -> A',
      'componentDidUpdate: A -> A',
    ]);
    expect(root).toMatchRenderedOutput('A2');

    root.update(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyClass num={3} />
      </Suspense>,
    );
    await waitForAll([
      'getDerivedStateFromProps: A',
      'shouldComponentUpdate: A -> A',
      'A3',
      'getSnapshotBeforeUpdate: A -> A',
      'componentDidUpdate: A -> A',
    ]);
    expect(root).toMatchRenderedOutput('A3');
  });

  /**
   * Given：Lazy class C 的 defaultProps.text=A，并实现三个 UNSAFE legacy lifecycle。
   * When：module 解决后通过下一次 update 挂载，再更新 num 2→3。
   * Then：mount/update legacy lifecycle 均观察 text=A，解析不会因 lazy retry 错位。
   *
   * 验证机制：UNSAFE lifecycle 与 A2/A3 日志顺序验证挂载和更新阶段。
   * 对应源码：`ReactFiberClassComponent.js` 的 legacy lifecycle 调用与 defaultProps 解析。
   */
  it('sets defaultProps for legacy lifecycles', async () => {
    /** 定义 C 类 fixture，暴露实例身份、defaultProps、错误边界或生命周期，用于“Lazy class 的 legacy 生命周期收到完整 defaultProps”。 */
    class C extends React.Component {
      /** C.defaultProps 声明缺省 props，验证 Lazy 解包后由真实组件类型负责补值。 */
      static defaultProps = {text: 'A'};
      /** C.state 保存实例或错误边界状态，区分 Lazy retry、普通更新与 bailout。 */
      state = {};

      /** C.UNSAFE_componentWillMount 验证 legacy mount lifecycle 收到解析后的 defaultProps。 */
      UNSAFE_componentWillMount() {
        Scheduler.log(`UNSAFE_componentWillMount: ${this.props.text}`);
      }

      /** C.UNSAFE_componentWillUpdate 验证 legacy update lifecycle 的 current/next defaultProps。 */
      UNSAFE_componentWillUpdate(nextProps) {
        Scheduler.log(
          `UNSAFE_componentWillUpdate: ${this.props.text} -> ${nextProps.text}`,
        );
      }

      /** C.UNSAFE_componentWillReceiveProps 验证 legacy 接收 props 阶段已完成 Lazy defaultProps 解析。 */
      UNSAFE_componentWillReceiveProps(nextProps) {
        Scheduler.log(
          `UNSAFE_componentWillReceiveProps: ${this.props.text} -> ${nextProps.text}`,
        );
      }

      /** C.render 渲染当前 props/state 并暴露日志或宿主输出，用于“Lazy class 的 legacy 生命周期收到完整 defaultProps”。 */
      render() {
        return <Text text={this.props.text + this.props.num} />;
      }
    }

    const LazyClass = lazy(() => fakeImport(C));

    let root;
    await act(() => {
      root = ReactTestRenderer.create(
        <Suspense fallback={<Text text="Loading..." />}>
          <LazyClass num={1} />
        </Suspense>,
        {unstable_isConcurrent: true},
      );
    });

    assertLog(['Loading...']);
    await waitForAll([]);
    expect(root).toMatchRenderedOutput('Loading...');

    await resolveFakeImport(C);

    assertLog([]);

    await act(() => {
      root.update(
        <Suspense fallback={<Text text="Loading..." />}>
          <LazyClass num={2} />
        </Suspense>,
      );
    });

    assertLog(['UNSAFE_componentWillMount: A', 'A2']);
    expect(root).toMatchRenderedOutput('A2');

    await act(() => {
      root.update(
        <Suspense fallback={<Text text="Loading..." />}>
          <LazyClass num={3} />
        </Suspense>,
      );
    });
    assertLog([
      'UNSAFE_componentWillReceiveProps: A -> A',
      'UNSAFE_componentWillUpdate: A -> A',
      'A3',
    ]);
    await waitForAll([]);
    expect(root).toMatchRenderedOutput('A3');
  });

  /**
   * Given：lazy initializer 最终把 module.default 解析为 invalid type，该值不是此 Lazy 路径允许的 class/function 类型。
   * When：先提交 fallback，再解决 fakeImport 并触发一次更新。
   * Then：lazy payload 可以 Resolved，但 Fiber 类型创建拒绝 invalid type，并报告包含可读类型名的错误。
   *
   * 验证机制：waitForThrow 精确匹配 resolved value 描述与“必须解析为 class/function”边界。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()`、`ReactFiber.js` 的 `createFiberFromTypeAndProps()` 与类型命名 helper。
   */
  it('throws with a useful error when wrapping invalid type with lazy()', async () => {
    const BadLazy = lazy(() => fakeImport(42));

    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <BadLazy />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);

    await resolveFakeImport(42);
    root.update(
      <Suspense fallback={<Text text="Loading..." />}>
        <BadLazy />
      </Suspense>,
    );
    await waitForThrow(
      'Element type is invalid. Received a promise that resolves to: 42. ' +
        'Lazy element type must resolve to a class or function.',
    );
  });

  /**
   * Given：lazy initializer 最终把 module.default 解析为 Fragment，该值不是此 Lazy 路径允许的 class/function 类型。
   * When：先提交 fallback，再解决 fakeImport 并触发一次更新。
   * Then：lazy payload 可以 Resolved，但 Fiber 类型创建拒绝 Fragment，并报告包含可读类型名的错误。
   *
   * 验证机制：waitForThrow 精确匹配 resolved value 描述与“必须解析为 class/function”边界。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()`、`ReactFiber.js` 的 `createFiberFromTypeAndProps()` 与类型命名 helper。
   */
  it('throws with a useful error when wrapping Fragment with lazy()', async () => {
    const BadLazy = lazy(() => fakeImport(React.Fragment));

    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <BadLazy />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);

    await resolveFakeImport(React.Fragment);
    root.update(
      <Suspense fallback={<Text text="Loading..." />}>
        <BadLazy />
      </Suspense>,
    );
    await waitForThrow(
      'Element type is invalid. Received a promise that resolves to: Fragment. ' +
        'Lazy element type must resolve to a class or function.',
    );
  });

  /**
   * Given：lazy initializer 最终把 module.default 解析为 createPortal，该值不是此 Lazy 路径允许的 class/function 类型。
   * When：先提交 fallback，再解决 fakeImport 并触发一次更新。
   * Then：lazy payload 可以 Resolved，但 Fiber 类型创建拒绝 createPortal，并报告包含可读类型名的错误。
   *
   * 验证机制：waitForThrow 精确匹配 resolved value 描述与“必须解析为 class/function”边界。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()`、`ReactFiber.js` 的 `createFiberFromTypeAndProps()` 与类型命名 helper。
   */
  // @gate !fb
  it('throws with a useful error when wrapping createPortal with lazy()', async () => {
    const ReactDOM = require('react-dom');
    const container = document.createElement('div');
    const portal = ReactDOM.createPortal(<div />, container);
    const BadLazy = lazy(() => fakeImport(portal));

    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <BadLazy />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);

    await resolveFakeImport(portal);
    root.update(
      <Suspense fallback={<Text text="Loading..." />}>
        <BadLazy />
      </Suspense>,
    );
    await waitForThrow(
      'Element type is invalid. Received a promise that resolves to: Portal. ' +
        'Lazy element type must resolve to a class or function.',
    );
  });

  /**
   * Given：lazy initializer 最终把 module.default 解析为 Profiler，该值不是此 Lazy 路径允许的 class/function 类型。
   * When：先提交 fallback，再解决 fakeImport 并触发一次更新。
   * Then：lazy payload 可以 Resolved，但 Fiber 类型创建拒绝 Profiler，并报告包含可读类型名的错误。
   *
   * 验证机制：waitForThrow 精确匹配 resolved value 描述与“必须解析为 class/function”边界。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()`、`ReactFiber.js` 的 `createFiberFromTypeAndProps()` 与类型命名 helper。
   */
  it('throws with a useful error when wrapping Profiler with lazy()', async () => {
    const BadLazy = lazy(() => fakeImport(React.Profiler));

    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <BadLazy />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);

    await resolveFakeImport(React.Profiler);
    root.update(
      <Suspense fallback={<Text text="Loading..." />}>
        <BadLazy />
      </Suspense>,
    );
    await waitForThrow(
      'Element type is invalid. Received a promise that resolves to: Profiler. ' +
        'Lazy element type must resolve to a class or function.',
    );
  });

  /**
   * Given：lazy initializer 最终把 module.default 解析为 StrictMode，该值不是此 Lazy 路径允许的 class/function 类型。
   * When：先提交 fallback，再解决 fakeImport 并触发一次更新。
   * Then：lazy payload 可以 Resolved，但 Fiber 类型创建拒绝 StrictMode，并报告包含可读类型名的错误。
   *
   * 验证机制：waitForThrow 精确匹配 resolved value 描述与“必须解析为 class/function”边界。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()`、`ReactFiber.js` 的 `createFiberFromTypeAndProps()` 与类型命名 helper。
   */
  it('throws with a useful error when wrapping StrictMode with lazy()', async () => {
    const BadLazy = lazy(() => fakeImport(React.StrictMode));

    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <BadLazy />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);

    await resolveFakeImport(React.StrictMode);
    root.update(
      <Suspense fallback={<Text text="Loading..." />}>
        <BadLazy />
      </Suspense>,
    );
    await waitForThrow(
      'Element type is invalid. Received a promise that resolves to: StrictMode. ' +
        'Lazy element type must resolve to a class or function.',
    );
  });

  /**
   * Given：lazy initializer 最终把 module.default 解析为 Suspense，该值不是此 Lazy 路径允许的 class/function 类型。
   * When：先提交 fallback，再解决 fakeImport 并触发一次更新。
   * Then：lazy payload 可以 Resolved，但 Fiber 类型创建拒绝 Suspense，并报告包含可读类型名的错误。
   *
   * 验证机制：waitForThrow 精确匹配 resolved value 描述与“必须解析为 class/function”边界。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()`、`ReactFiber.js` 的 `createFiberFromTypeAndProps()` 与类型命名 helper。
   */
  it('throws with a useful error when wrapping Suspense with lazy()', async () => {
    const BadLazy = lazy(() => fakeImport(React.Suspense));

    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <BadLazy />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);

    await resolveFakeImport(React.Suspense);
    root.update(
      <Suspense fallback={<Text text="Loading..." />}>
        <BadLazy />
      </Suspense>,
    );
    await waitForThrow(
      'Element type is invalid. Received a promise that resolves to: Suspense. ' +
        'Lazy element type must resolve to a class or function.',
    );
  });

  /**
   * Given：LazyProvider 的 module.default 是 Context 本体，ConsumerText 读取该 Context。
   * When：首次 fallback 后解决 Context module。
   * Then：解析后的 Lazy 类型按 Context Provider 分支处理并向 Consumer 提供 provided。
   *
   * 验证机制：Loading 后只记录 provided，宿主输出相同值。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()` 与 `ReactFiberBeginWork.js` 的 `updateContextProvider()`。
   */
  it('renders a lazy context provider without value prop', async () => {
    // Context Provider 被 lazy() 包装后仍应正常工作。
    const Context = React.createContext('default');
    const LazyProvider = lazy(() => fakeImport(Context));

    /** ConsumerText 读取当前 Context 并交给 Text，验证 Lazy Context Provider 的解析和更新。 */
    function ConsumerText() {
      return <Text text={React.useContext(Context)} />;
    }

    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyProvider value="provided">
          <ConsumerText />
        </LazyProvider>
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);

    await act(() => resolveFakeImport(Context));
    assertLog(['provided']);
    expect(root).toMatchRenderedOutput('provided');
  });

  /**
   * Given：lazy initializer 最终把 module.default 解析为 Context.Consumer，该值不是此 Lazy 路径允许的 class/function 类型。
   * When：先提交 fallback，再解决 fakeImport 并触发一次更新。
   * Then：lazy payload 可以 Resolved，但 Fiber 类型创建拒绝 Context.Consumer，并报告包含可读类型名的错误。
   *
   * 验证机制：waitForThrow 精确匹配 resolved value 描述与“必须解析为 class/function”边界。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()`、`ReactFiber.js` 的 `createFiberFromTypeAndProps()` 与类型命名 helper。
   */
  it('throws with a useful error when wrapping Context.Consumer with lazy()', async () => {
    const Context = React.createContext(null);
    const BadLazy = lazy(() => fakeImport(Context.Consumer));

    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <BadLazy />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);

    await resolveFakeImport(Context.Consumer);
    root.update(
      <Suspense fallback={<Text text="Loading..." />}>
        <BadLazy />
      </Suspense>,
    );
    await waitForThrow(
      'Element type is invalid. Received a promise that resolves to: Context.Consumer. ' +
        'Lazy element type must resolve to a class or function.',
    );
  });

  /**
   * Given：lazy initializer 最终把 module.default 解析为 SuspenseList，该值不是此 Lazy 路径允许的 class/function 类型。
   * When：先提交 fallback，再解决 fakeImport 并触发一次更新。
   * Then：lazy payload 可以 Resolved，但 Fiber 类型创建拒绝 SuspenseList，并报告包含可读类型名的错误。
   *
   * 验证机制：waitForThrow 精确匹配 resolved value 描述与“必须解析为 class/function”边界。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()`、`ReactFiber.js` 的 `createFiberFromTypeAndProps()` 与类型命名 helper。
   */
  // @gate enableSuspenseList
  it('throws with a useful error when wrapping SuspenseList with lazy()', async () => {
    const BadLazy = lazy(() => fakeImport(React.unstable_SuspenseList));

    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <BadLazy />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);

    await resolveFakeImport(React.unstable_SuspenseList);
    root.update(
      <Suspense fallback={<Text text="Loading..." />}>
        <BadLazy />
      </Suspense>,
    );
    await waitForThrow(
      'Element type is invalid. Received a promise that resolves to: SuspenseList. ' +
        'Lazy element type must resolve to a class or function.',
    );
  });

  /**
   * Given：lazy initializer 最终把 module.default 解析为 ViewTransition，该值不是此 Lazy 路径允许的 class/function 类型。
   * When：先提交 fallback，再解决 fakeImport 并触发一次更新。
   * Then：lazy payload 可以 Resolved，但 Fiber 类型创建拒绝 ViewTransition，并报告包含可读类型名的错误。
   *
   * 验证机制：waitForThrow 精确匹配 resolved value 描述与“必须解析为 class/function”边界。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()`、`ReactFiber.js` 的 `createFiberFromTypeAndProps()` 与类型命名 helper。
   */
  // @gate enableViewTransition
  it('throws with a useful error when wrapping ViewTransition with lazy()', async () => {
    const BadLazy = lazy(() => fakeImport(React.ViewTransition));

    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <BadLazy />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);

    await resolveFakeImport(React.ViewTransition);
    root.update(
      <Suspense fallback={<Text text="Loading..." />}>
        <BadLazy />
      </Suspense>,
    );
    await waitForThrow(
      'Element type is invalid. Received a promise that resolves to: ViewTransition. ' +
        'Lazy element type must resolve to a class or function.',
    );
  });

  /**
   * Given：lazy initializer 最终把 module.default 解析为 Activity，该值不是此 Lazy 路径允许的 class/function 类型。
   * When：先提交 fallback，再解决 fakeImport 并触发一次更新。
   * Then：lazy payload 可以 Resolved，但 Fiber 类型创建拒绝 Activity，并报告包含可读类型名的错误。
   *
   * 验证机制：waitForThrow 精确匹配 resolved value 描述与“必须解析为 class/function”边界。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()`、`ReactFiber.js` 的 `createFiberFromTypeAndProps()` 与类型命名 helper。
   */
  it('throws with a useful error when wrapping Activity with lazy()', async () => {
    const BadLazy = lazy(() => fakeImport(React.Activity));

    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <BadLazy />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);

    await resolveFakeImport(React.Activity);
    root.update(
      <Suspense fallback={<Text text="Loading..." />}>
        <BadLazy />
      </Suspense>,
    );
    await waitForThrow(
      'Element type is invalid. Received a promise that resolves to: Activity. ' +
        'Lazy element type must resolve to a class or function.',
    );
  });

  /**
   * Given：lazy initializer 最终把 module.default 解析为 TracingMarker，该值不是此 Lazy 路径允许的 class/function 类型。
   * When：先提交 fallback，再解决 fakeImport 并触发一次更新。
   * Then：lazy payload 可以 Resolved，但 Fiber 类型创建拒绝 TracingMarker，并报告包含可读类型名的错误。
   *
   * 验证机制：waitForThrow 精确匹配 resolved value 描述与“必须解析为 class/function”边界。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()`、`ReactFiber.js` 的 `createFiberFromTypeAndProps()` 与类型命名 helper。
   */
  // @gate enableTransitionTracing
  it('throws with a useful error when wrapping TracingMarker with lazy()', async () => {
    const BadLazy = lazy(() => fakeImport(React.unstable_TracingMarker));

    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <BadLazy />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);

    await resolveFakeImport(React.unstable_TracingMarker);
    root.update(
      <Suspense fallback={<Text text="Loading..." />}>
        <BadLazy />
      </Suspense>,
    );
    await waitForThrow(
      'Element type is invalid. Received a promise that resolves to: TracingMarker. ' +
        'Lazy element type must resolve to a class or function.',
    );
  });

  /**
   * Given：lazy initializer 最终把 module.default 解析为 不受支持类型，该值不是此 Lazy 路径允许的 class/function 类型。
   * When：先提交 fallback，再解决 fakeImport 并触发一次更新。
   * Then：lazy payload 可以 Resolved，但 Fiber 类型创建拒绝 不受支持类型，并报告包含可读类型名的错误。
   *
   * 验证机制：waitForThrow 精确匹配 resolved value 描述与“必须解析为 class/function”边界。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()`、`ReactFiber.js` 的 `createFiberFromTypeAndProps()` 与类型命名 helper。
   */
  it('throws with a useful error when wrapping lazy() multiple times', async () => {
    const Lazy1 = lazy(() => fakeImport(Text));
    const Lazy2 = lazy(() => fakeImport(Lazy1));

    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <Lazy2 text="Hello" />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);
    expect(root).not.toMatchRenderedOutput('Hello');

    await resolveFakeImport(Lazy1);
    root.update(
      <Suspense fallback={<Text text="Loading..." />}>
        <Lazy2 text="Hello" />
      </Suspense>,
    );
    await waitForThrow(
      'Element type is invalid. Received a promise that resolves to: [object Object]. ' +
        'Lazy element type must resolve to a class or function.' +
        (__DEV__
          ? ' Did you wrap a component in React.lazy() more than once?'
          : ''),
    );
  });

  /**
   * Given：function Add 经 Lazy 包装，首次 props 为字符串 2/2，更新 props 为显式 false/false。
   * When：解决 module 完成挂载，再更新同一 LazyAdd。
   * Then：lazy 解包后按 function 的真实类型解析 props；显式 false 不被默认值或 wrapper 丢弃。
   *
   * 验证机制：宿主输出从 22 变为 0；带 defaultProps 用例另断言仅缺失字段补为 42。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()` 与 `ReactFiberBeginWork.js` 的 lazy tag/props 解析。
   */
  it('resolves props for function component without defaultProps', async () => {
    /** Add 合并 inner/outer props，验证 Lazy 解包后的 props 保真与 defaultProps 规则。 */
    function Add(props) {
      return props.inner + props.outer;
    }
    const LazyAdd = lazy(() => fakeImport(Add));
    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyAdd inner="2" outer="2" />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);
    expect(root).not.toMatchRenderedOutput('22');

    // 完成 Lazy module 并挂载真实组件。
    await act(() => resolveFakeImport(Add));

    expect(root).toMatchRenderedOutput('22');

    // 更新已解析的真实组件。
    root.update(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyAdd inner={false} outer={false} />
      </Suspense>,
    );
    await waitForAll([]);
    expect(root).toMatchRenderedOutput('0');
  });

  /**
   * Given：带 defaultProps 的 class Add 经 Lazy 包装，首次 props 为字符串 2/2，更新 props 为显式 false/false。
   * When：解决 module 完成挂载，再更新同一 LazyAdd。
   * Then：lazy 解包后按 带 defaultProps 的 class 的真实类型解析 props；显式 false 不被默认值或 wrapper 丢弃。
   *
   * 验证机制：宿主输出从 22 变为 0；带 defaultProps 用例另断言仅缺失字段补为 42。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()` 与 `ReactFiberBeginWork.js` 的 lazy tag/props 解析。
   */
  it('resolves props for class component with defaultProps', async () => {
    /** 定义 Add 类 fixture，暴露实例身份、defaultProps、错误边界或生命周期，用于“带 defaultProps 的 class 经 Lazy 解包后的 props 与 defaultProps 语义”。 */
    class Add extends React.Component {
      /** Add.render 渲染当前 props/state 并暴露日志或宿主输出，用于“带 defaultProps 的 class 经 Lazy 解包后的 props 与 defaultProps 语义”。 */
      render() {
        expect(this.props.innerWithDefault).toBe(42);
        return this.props.inner + this.props.outer;
      }
    }
    Add.defaultProps = {
      innerWithDefault: 42,
    };
    const LazyAdd = lazy(() => fakeImport(Add));
    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyAdd inner="2" outer="2" />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);
    expect(root).not.toMatchRenderedOutput('22');

    // 完成 Lazy module 并挂载真实组件。
    await act(() => resolveFakeImport(Add));

    expect(root).toMatchRenderedOutput('22');

    // 更新已解析的真实组件。
    root.update(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyAdd inner={false} outer={false} />
      </Suspense>,
    );
    await waitForAll([]);
    expect(root).toMatchRenderedOutput('0');
  });

  /**
   * Given：带 defaultProps 的 class Add 经 Lazy 包装，首次 props 为字符串 2/2，更新 props 为显式 false/false。
   * When：解决 module 完成挂载，再更新同一 LazyAdd。
   * Then：lazy 解包后按 带 defaultProps 的 class 的真实类型解析 props；显式 false 不被默认值或 wrapper 丢弃。
   *
   * 验证机制：宿主输出从 22 变为 0；带 defaultProps 用例另断言仅缺失字段补为 42。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()` 与 `ReactFiberBeginWork.js` 的 lazy tag/props 解析。
   */
  it('resolves props for class component without defaultProps', async () => {
    /** 定义 Add 类 fixture，暴露实例身份、defaultProps、错误边界或生命周期，用于“带 defaultProps 的 class 经 Lazy 解包后的 props 与 defaultProps 语义”。 */
    class Add extends React.Component {
      /** Add.render 渲染当前 props/state 并暴露日志或宿主输出，用于“带 defaultProps 的 class 经 Lazy 解包后的 props 与 defaultProps 语义”。 */
      render() {
        return this.props.inner + this.props.outer;
      }
    }
    const LazyAdd = lazy(() => fakeImport(Add));
    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyAdd inner="2" outer="2" />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);
    expect(root).not.toMatchRenderedOutput('22');

    // 完成 Lazy module 并挂载真实组件。
    await act(() => resolveFakeImport(Add));

    expect(root).toMatchRenderedOutput('22');

    // 更新已解析的真实组件。
    root.update(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyAdd inner={false} outer={false} />
      </Suspense>,
    );
    await waitForAll([]);
    expect(root).toMatchRenderedOutput('0');
  });

  /**
   * Given：forwardRef Add 经 Lazy 包装，首次 props 为字符串 2/2，更新 props 为显式 false/false。
   * When：解决 module 完成挂载，再更新同一 LazyAdd。
   * Then：lazy 解包后按 forwardRef 的真实类型解析 props；显式 false 不被默认值或 wrapper 丢弃。
   *
   * 验证机制：宿主输出从 22 变为 0；带 defaultProps 用例另断言仅缺失字段补为 42。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()` 与 `ReactFiberBeginWork.js` 的 lazy tag/props 解析。
   */
  it('resolves props for forwardRef component without defaultProps', async () => {
    const Add = React.forwardRef((props, ref) => {
      return props.inner + props.outer;
    });
    Add.displayName = 'Add';

    const LazyAdd = lazy(() => fakeImport(Add));
    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyAdd inner="2" outer="2" />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);
    expect(root).not.toMatchRenderedOutput('22');

    // 完成 Lazy module 并挂载真实组件。
    await act(() => resolveFakeImport(Add));

    expect(root).toMatchRenderedOutput('22');

    // 更新已解析的真实组件。
    root.update(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyAdd inner={false} outer={false} />
      </Suspense>,
    );
    await waitForAll([]);
    expect(root).toMatchRenderedOutput('0');
  });

  /**
   * Given：外层 memo Add 经 Lazy 包装，首次 props 为字符串 2/2，更新 props 为显式 false/false。
   * When：解决 module 完成挂载，再更新同一 LazyAdd。
   * Then：lazy 解包后按 外层 memo 的真实类型解析 props；显式 false 不被默认值或 wrapper 丢弃。
   *
   * 验证机制：宿主输出从 22 变为 0；带 defaultProps 用例另断言仅缺失字段补为 42。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()` 与 `ReactFiberBeginWork.js` 的 lazy tag/props 解析。
   */
  it('resolves props for outer memo component without defaultProps', async () => {
    /** Add 以函数变量形式提供 resolved component，并暴露 props/告警栈行为，用于“外层 memo 经 Lazy 解包后的 props 与 defaultProps 语义”。 */
    let Add = props => {
      return props.inner + props.outer;
    };
    Add = React.memo(Add);
    const LazyAdd = lazy(() => fakeImport(Add));
    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyAdd inner="2" outer="2" />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);
    expect(root).not.toMatchRenderedOutput('22');

    // 完成 Lazy module 并挂载真实组件。
    await act(() => resolveFakeImport(Add));

    expect(root).toMatchRenderedOutput('22');

    // 更新已解析的真实组件。
    root.update(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyAdd inner={false} outer={false} />
      </Suspense>,
    );
    await waitForAll([]);
    expect(root).toMatchRenderedOutput('0');
  });

  /**
   * Given：内部实现 Add 经 Lazy 包装，首次 props 为字符串 2/2，更新 props 为显式 false/false。
   * When：解决 module 完成挂载，再更新同一 LazyAdd。
   * Then：lazy 解包后按 内部实现 的真实类型解析 props；显式 false 不被默认值或 wrapper 丢弃。
   *
   * 验证机制：宿主输出从 22 变为 0；带 defaultProps 用例另断言仅缺失字段补为 42。
   * 对应源码：`packages/react/src/ReactLazy.js` 的 `lazyInitializer()` 与 `packages/react-reconciler/src/ReactFiberBeginWork.js` 的 `mountLazyComponent()` 与 `ReactFiberBeginWork.js` 的 lazy tag/props 解析。
   */
  it('resolves props for inner memo component without defaultProps', async () => {
    /** Add 以函数变量形式提供 resolved component，并暴露 props/告警栈行为，用于“内部实现 经 Lazy 解包后的 props 与 defaultProps 语义”。 */
    const Add = props => {
      return props.inner + props.outer;
    };
    Add.displayName = 'Add';
    const LazyAdd = lazy(() => fakeImport(Add));
    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyAdd inner="2" outer="2" />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);
    expect(root).not.toMatchRenderedOutput('22');

    // 完成 Lazy module 并挂载真实组件。
    await act(() => resolveFakeImport(Add));

    expect(root).toMatchRenderedOutput('22');

    // 更新已解析的真实组件。
    root.update(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyAdd inner={false} outer={false} />
      </Suspense>,
    );
    await waitForAll([]);
    expect(root).toMatchRenderedOutput('0');
  });

  /**
   * Given：LazyFoo 解析出的 Foo 返回缺少 key 的元素数组，首次阶段只显示 fallback。
   * When：解决 Foo module 并提交真实组件。
   * Then：开发态 key warning 的组件栈使用已解析名称 Foo，而非匿名 Lazy 占位。
   *
   * 验证机制：Started loading/A/B 日志、warning 文本与最终 div 输出共同验证。
   * 对应源码：`ReactLazy.js` 的解析、`getComponentNameFromType()` 与 Fiber component stack 生成。
   */
  it('includes lazy-loaded component in warning stack', async () => {
    /** Foo 以函数变量形式提供 resolved component，并暴露 props/告警栈行为，用于“Lazy 已解析组件在开发态 warning stack 中显示真实名称”。 */
    const Foo = props => <div>{[<Text text="A" />, <Text text="B" />]}</div>;
    const LazyFoo = lazy(() => {
      Scheduler.log('Started loading');
      return fakeImport(Foo);
    });

    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyFoo />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Started loading', 'Loading...']);
    expect(root).not.toMatchRenderedOutput(<div>AB</div>);

    await act(() => resolveFakeImport(Foo));
    assertLog(['A', 'B']);
    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.\n' +
        '\n' +
        'Check the render method of `Foo`. ' +
        'See https://react.dev/link/warning-keys for more information.\n' +
        '    in Foo (at **)',
    ]);
    expect(root).toMatchRenderedOutput(<div>AB</div>);
  });

  /**
   * Given：同一 Suspense 内分别 lazy-load class Foo 与包装 Bar 的 ForwardRefBar，并传入 ref。
   * When：先解决 class module，再解决 forwardRef module。
   * Then：两类 exotic/ordinary 类型都被正确分类；forwardRef 最终把 ref 指向 Bar 实例。
   *
   * 验证机制：分阶段 Foo、forwardRef、Bar 日志及 ref null→实例断言验证。
   * 对应源码：`ReactFiber.js` 的 `resolveLazyComponentTag()` 与 `ReactFiberBeginWork.js` 的 lazy/forwardRef 分发。
   */
  it('supports class and forwardRef components', async () => {
    /** 定义 Foo 类 fixture，暴露实例身份、defaultProps、错误边界或生命周期，用于“Lazy 支持 class 与 forwardRef 解析结果并保持 ref”。 */
    class Foo extends React.Component {
      /** Foo.render 渲染当前 props/state 并暴露日志或宿主输出，用于“Lazy 支持 class 与 forwardRef 解析结果并保持 ref”。 */
      render() {
        return <Text text="Foo" />;
      }
    }
    const LazyClass = lazy(() => {
      return fakeImport(Foo);
    });

    /** 定义 Bar 类 fixture，暴露实例身份、defaultProps、错误边界或生命周期，用于“Lazy 支持 class 与 forwardRef 解析结果并保持 ref”。 */
    class Bar extends React.Component {
      /** Bar.render 渲染当前 props/state 并暴露日志或宿主输出，用于“Lazy 支持 class 与 forwardRef 解析结果并保持 ref”。 */
      render() {
        return <Text text="Bar" />;
      }
    }
    const ForwardRefBar = React.forwardRef((props, ref) => {
      Scheduler.log('forwardRef');
      return <Bar ref={ref} />;
    });

    const LazyForwardRef = lazy(() => {
      return fakeImport(ForwardRefBar);
    });

    const ref = React.createRef();
    const root = ReactTestRenderer.create(
      <Suspense fallback={<Text text="Loading..." />}>
        <LazyClass />
        <LazyForwardRef ref={ref} />
      </Suspense>,
      {
        unstable_isConcurrent: true,
      },
    );

    await waitForAll(['Loading...']);
    expect(root).not.toMatchRenderedOutput('FooBar');
    expect(ref.current).toBe(null);

    await act(() => resolveFakeImport(Foo));
    assertLog(['Foo']);

    await act(() => resolveFakeImport(ForwardRefBar));
    assertLog(['Foo', 'forwardRef', 'Bar']);
    expect(root).toMatchRenderedOutput('FooBar');
    expect(ref.current).not.toBe(null);
  });

  /**
   * Given：LazyText 解析到会抛错的 ResolvedText，并由 ErrorBoundary 记录规范化 componentStack。
   * When：先显示 fallback，再解决 module，让真实组件 render 抛错。
   * Then：错误栈命名 ResolvedText，说明解析后的 Fiber 类型已替换 Lazy 占位。
   *
   * 验证机制：componentStack 包含 `in ResolvedText` 的断言验证。
   * 对应源码：`ReactFiberComponentStack.js` 与 lazy resolved type 的 Fiber 标记。
   */
  it('should error with a component stack naming the resolved component', async () => {
    let componentStackMessage;

    /** ResolvedText 在真实 Lazy 类型解析后主动抛错，用于验证组件栈采用 resolved component 名称。 */
    function ResolvedText() {
      throw new Error('oh no');
    }
    const LazyText = lazy(() => fakeImport(ResolvedText));

    /** 定义 ErrorBoundary 类 fixture，暴露实例身份、defaultProps、错误边界或生命周期，用于“已解析 Lazy 错误栈使用真实组件名”。 */
    class ErrorBoundary extends React.Component {
      /** ErrorBoundary.state 保存实例或错误边界状态，区分 Lazy retry、普通更新与 bailout。 */
      state = {error: null};

      /** ErrorBoundary.componentDidCatch 捕获 resolved/unresolved Lazy 抛错并保存规范化 componentStack。 */
      componentDidCatch(error, errMessage) {
        componentStackMessage = normalizeCodeLocInfo(errMessage.componentStack);
        this.setState({
          error,
        });
      }

      /** ErrorBoundary.render 渲染当前 props/state 并暴露日志或宿主输出，用于“已解析 Lazy 错误栈使用真实组件名”。 */
      render() {
        return this.state.error ? null : this.props.children;
      }
    }

    ReactTestRenderer.create(
      <ErrorBoundary>
        <Suspense fallback={<Text text="Loading..." />}>
          <LazyText text="Hi" />
        </Suspense>
      </ErrorBoundary>,
      {unstable_isConcurrent: true},
    );

    await waitForAll(['Loading...']);

    await act(() => resolveFakeImport(ResolvedText));
    assertLog([]);

    expect(componentStackMessage).toContain('in ResolvedText');
  });

  /**
   * Given：LazyText 的 thenable 在解析出具体类型前同步 reject，并由 ErrorBoundary 捕获。
   * When：首次 lazyInitializer 执行即进入 Rejected。
   * Then：由于真实类型从未可用，错误栈保留 Lazy 名称作为边界位置。
   *
   * 验证机制：componentStack 包含 `in Lazy` 的断言验证 unresolved 分支。
   * 对应源码：`ReactFiberComponentStack.js` 与 `ReactLazy.js` 的 Rejected payload 路径。
   */
  it('should error with a component stack containing Lazy if unresolved', async () => {
    let componentStackMessage;

    const LazyText = lazy(() => ({
      /** then 实现本场景的同步 fulfilled/rejected thenable 协议，用于“未解析 Lazy 错误栈保留 Lazy 占位名”。 */
      then(resolve, reject) {
        reject(new Error('oh no'));
      },
    }));

    /** 定义 ErrorBoundary 类 fixture，暴露实例身份、defaultProps、错误边界或生命周期，用于“未解析 Lazy 错误栈保留 Lazy 占位名”。 */
    class ErrorBoundary extends React.Component {
      /** ErrorBoundary.state 保存实例或错误边界状态，区分 Lazy retry、普通更新与 bailout。 */
      state = {error: null};

      /** ErrorBoundary.componentDidCatch 捕获 resolved/unresolved Lazy 抛错并保存规范化 componentStack。 */
      componentDidCatch(error, errMessage) {
        componentStackMessage = normalizeCodeLocInfo(errMessage.componentStack);
        this.setState({
          error,
        });
      }

      /** ErrorBoundary.render 渲染当前 props/state 并暴露日志或宿主输出，用于“未解析 Lazy 错误栈保留 Lazy 占位名”。 */
      render() {
        return this.state.error ? null : this.props.children;
      }
    }

    await act(() => {
      ReactTestRenderer.create(
        <ErrorBoundary>
          <Suspense fallback={<Text text="Loading..." />}>
            <LazyText text="Hi" />
          </Suspense>
        </ErrorBoundary>,
        {unstable_isConcurrent: true},
      );
    });

    assertLog([]);

    expect(componentStackMessage).toContain('in Lazy');
  });

  /**
   * Given：并发 root 初始使用 LazyChildA/B 类型和稳定 key，交换后改用新的 LazyChildB2/A2 类型。
   * When：依次解决初始 modules 并提交 AB，再交换顺序和 lazy type，按用例节奏解决或冲刷第二组。
   * Then：key 相同但 element type 改变会替换旧实例；新类型完成后按 BA 顺序提交，并呈现对应 mount/update 边界。
   *
   * 验证机制：Init、fallback、unmount/mount 或 update 日志与 AB→ba 输出锁定 reconcile 决策。
   * 对应源码：`ReactChildFiber.js` 的 lazy type 解析与 keyed element type 比较，以及 `ReactLazy.js`。
   */
  it('mount and reorder lazy types', async () => {
    /** 定义 Child 类 fixture，暴露实例身份、defaultProps、错误边界或生命周期，用于“并发模式下 Lazy type 更换与 keyed 重排”。 */
    class Child extends React.Component {
      /** Child.componentWillUnmount 记录旧 Lazy type 被替换时的卸载边界。 */
      componentWillUnmount() {
        Scheduler.log('Did unmount: ' + this.props.label);
      }
      /** Child.componentDidMount 记录首次提交及实例 label/defaultProps，用于“并发模式下 Lazy type 更换与 keyed 重排”。 */
      componentDidMount() {
        Scheduler.log('Did mount: ' + this.props.label);
      }
      /** Child.componentDidUpdate 记录复用实例的更新提交，用于区分 keyed reorder 与 remount。 */
      componentDidUpdate() {
        Scheduler.log('Did update: ' + this.props.label);
      }
      /** Child.render 渲染当前 props/state 并暴露日志或宿主输出，用于“并发模式下 Lazy type 更换与 keyed 重排”。 */
      render() {
        return <Text text={this.props.label} />;
      }
    }

    /** ChildA 把大小写状态映射为稳定 Child label，区分 type 解析与 keyed 复用。 */
    function ChildA({lowerCase}) {
      return <Child label={lowerCase ? 'a' : 'A'} />;
    }

    /** ChildB 把大小写状态映射为稳定 Child label，区分 type 解析与 keyed 复用。 */
    function ChildB({lowerCase}) {
      return <Child label={lowerCase ? 'b' : 'B'} />;
    }

    const LazyChildA = lazy(() => {
      Scheduler.log('Init A');
      return fakeImport(ChildA);
    });
    const LazyChildB = lazy(() => {
      Scheduler.log('Init B');
      return fakeImport(ChildB);
    });
    const LazyChildA2 = lazy(() => {
      Scheduler.log('Init A2');
      return fakeImport(ChildA);
    });
    let resolveB2;
    const LazyChildB2 = lazy(() => {
      Scheduler.log('Init B2');
      return new Promise(r => {
        resolveB2 = r;
      });
    });

    /** Parent 根据 swap 选择 Lazy children 顺序和类型，驱动“并发模式下 Lazy type 更换与 keyed 重排”。 */
    function Parent({swap}) {
      return (
        <Suspense fallback={<Text text="Outer..." />}>
          <Suspense fallback={<Text text="Loading..." />}>
            {swap
              ? [
                  <LazyChildB2 key="B" lowerCase={true} />,
                  <LazyChildA2 key="A" lowerCase={true} />,
                ]
              : [<LazyChildA key="A" />, <LazyChildB key="B" />]}
          </Suspense>
        </Suspense>
      );
    }

    const root = ReactTestRenderer.create(<Parent swap={false} />, {
      unstable_isConcurrent: true,
    });

    await waitForAll([
      'Init A',
      'Loading...',
      // 执行预热渲染；该遍只初始化后续 Lazy 节点，不作为最终提交。
      'Init B',
    ]);
    expect(root).not.toMatchRenderedOutput('AB');

    await act(() => resolveFakeImport(ChildA));
    assertLog(['A']);

    await act(() => resolveFakeImport(ChildB));
    assertLog(['A', 'B', 'Did mount: A', 'Did mount: B']);
    expect(root).toMatchRenderedOutput('AB');

    // 交换 A 与 B 的位置。
    root.update(<Parent swap={true} />);
    await waitForAll([
      'Init B2',
      'Loading...',
      'Did unmount: A',
      'Did unmount: B',
    ]);

    // 此时 Suspense 边界应已切换到 fallback。
    expect(root).toMatchRenderedOutput('Loading...');
    await act(() => resolveB2({default: ChildB}));

    // 需要继续 flush，才能触发第二个 Lazy initializer 开始加载。
    assertLog(['Init A2', 'b', 'a', 'Did mount: b', 'Did mount: a']);
    expect(root).toMatchRenderedOutput('ba');
  });

  /**
   * Given：并发 root 把 lazy object 直接作为 children；每个 initializer 解析为带稳定 key 的 React element。
   * When：先逐个解决 A/B element 得到 AB，再交换为 b/a lazy elements 并依序完成。
   * Then：ChildFiber 在 lazy node 解析后按 element key 复用 Child 实例，顺序变为 ba 且触发 update。
   *
   * 验证机制：Init/fallback、Did mount/Did update 日志与 AB→ba 输出验证。
   * 对应源码：`ReactChildFiber.js` 的 `resolveLazy()`/children reconciliation 与 `ReactLazy.js`。
   */
  it('mount and reorder lazy elements', async () => {
    /** 定义 Child 类 fixture，暴露实例身份、defaultProps、错误边界或生命周期，用于“并发模式下 Lazy element 解析、key 复用与重排”。 */
    class Child extends React.Component {
      /** Child.componentDidMount 记录首次提交及实例 label/defaultProps，用于“并发模式下 Lazy element 解析、key 复用与重排”。 */
      componentDidMount() {
        Scheduler.log('Did mount: ' + this.props.label);
      }
      /** Child.componentDidUpdate 记录复用实例的更新提交，用于区分 keyed reorder 与 remount。 */
      componentDidUpdate() {
        Scheduler.log('Did update: ' + this.props.label);
      }
      /** Child.render 渲染当前 props/state 并暴露日志或宿主输出，用于“并发模式下 Lazy element 解析、key 复用与重排”。 */
      render() {
        return <Text text={this.props.label} />;
      }
    }

    const ChildA = <Child key="A" label="A" />;
    const lazyChildA = lazy(() => {
      Scheduler.log('Init A');
      return fakeImport(ChildA);
    });
    const ChildB = <Child key="B" label="B" />;
    const lazyChildB = lazy(() => {
      Scheduler.log('Init B');
      return fakeImport(ChildB);
    });
    const ChildA2 = <Child key="A" label="a" />;
    const lazyChildA2 = lazy(() => {
      Scheduler.log('Init A2');
      return fakeImport(ChildA2);
    });
    const ChildB2 = <Child key="B" label="b" />;
    const lazyChildB2 = lazy(() => {
      Scheduler.log('Init B2');
      return fakeImport(ChildB2);
    });

    /** Parent 根据 swap 选择 Lazy children 顺序和类型，驱动“并发模式下 Lazy element 解析、key 复用与重排”。 */
    function Parent({swap}) {
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          {swap ? [lazyChildB2, lazyChildA2] : [lazyChildA, lazyChildB]}
        </Suspense>
      );
    }

    const root = ReactTestRenderer.create(<Parent swap={false} />, {
      unstable_isConcurrent: true,
    });

    await waitForAll(['Init A', 'Loading...']);
    expect(root).not.toMatchRenderedOutput('AB');

    await act(() => resolveFakeImport(ChildA));
    // 需要继续 flush，才能触发 B 的 Lazy initializer 开始加载。
    await assertLog(['Init B']);
    await act(() => resolveFakeImport(ChildB));
    assertLog(['A', 'B', 'Did mount: A', 'Did mount: B']);
    expect(root).toMatchRenderedOutput('AB');

    // 交换 A 与 B 的位置。
    React.startTransition(() => {
      root.update(<Parent swap={true} />);
    });
    await waitForAll(['Init B2', 'Loading...']);
    await act(() => resolveFakeImport(ChildB2));
    // 需要继续 flush，才能触发第二个 Lazy initializer 开始加载。
    assertLog(['Init A2', 'Loading...']);
    await act(() => resolveFakeImport(ChildA2));
    assertLog(['b', 'a', 'Did update: b', 'Did update: a']);
    expect(root).toMatchRenderedOutput('ba');
  });

  /** 在 legacy root 下复核 Lazy element/type 的初始化顺序、fallback 与 keyed reorder。 */
  describe('legacy mode', () => {
    /**
     * Given：legacy root 把 lazy object 直接作为 children；每个 initializer 解析为带稳定 key 的 React element。
     * When：先逐个解决 A/B element 得到 AB，再交换为 b/a lazy elements 并依序完成。
     * Then：ChildFiber 在 lazy node 解析后按 element key 复用 Child 实例，顺序变为 ba 且触发 update。
     *
     * 验证机制：Init/fallback、Did mount/Did update 日志与 AB→ba 输出验证。
     * 对应源码：`ReactChildFiber.js` 的 `resolveLazy()`/children reconciliation 与 `ReactLazy.js`。
     */
    // @gate !disableLegacyMode
    it('mount and reorder lazy elements (legacy mode)', async () => {
      /** 定义 Child 类 fixture，暴露实例身份、defaultProps、错误边界或生命周期，用于“legacy模式下 Lazy element 解析、key 复用与重排”。 */
      class Child extends React.Component {
        /** Child.componentDidMount 记录首次提交及实例 label/defaultProps，用于“legacy模式下 Lazy element 解析、key 复用与重排”。 */
        componentDidMount() {
          Scheduler.log('Did mount: ' + this.props.label);
        }
        /** Child.componentDidUpdate 记录复用实例的更新提交，用于区分 keyed reorder 与 remount。 */
        componentDidUpdate() {
          Scheduler.log('Did update: ' + this.props.label);
        }
        /** Child.render 渲染当前 props/state 并暴露日志或宿主输出，用于“legacy模式下 Lazy element 解析、key 复用与重排”。 */
        render() {
          return <Text text={this.props.label} />;
        }
      }

      const ChildA = <Child key="A" label="A" />;
      const lazyChildA = lazy(() => {
        Scheduler.log('Init A');
        return fakeImport(ChildA);
      });
      const ChildB = <Child key="B" label="B" />;
      const lazyChildB = lazy(() => {
        Scheduler.log('Init B');
        return fakeImport(ChildB);
      });
      const ChildA2 = <Child key="A" label="a" />;
      const lazyChildA2 = lazy(() => {
        Scheduler.log('Init A2');
        return fakeImport(ChildA2);
      });
      const ChildB2 = <Child key="B" label="b" />;
      const lazyChildB2 = lazy(() => {
        Scheduler.log('Init B2');
        return fakeImport(ChildB2);
      });

      /** Parent 根据 swap 选择 Lazy children 顺序和类型，驱动“legacy模式下 Lazy element 解析、key 复用与重排”。 */
      function Parent({swap}) {
        return (
          <Suspense fallback={<Text text="Loading..." />}>
            {swap ? [lazyChildB2, lazyChildA2] : [lazyChildA, lazyChildB]}
          </Suspense>
        );
      }

      const root = ReactTestRenderer.create(<Parent swap={false} />, {
        unstable_isConcurrent: false,
      });

      assertLog(['Init A', 'Loading...']);
      expect(root).not.toMatchRenderedOutput('AB');

      await resolveFakeImport(ChildA);
      // 需要继续 flush，才能触发 B 的 Lazy initializer 开始加载。
      await waitForAll(['Init B']);
      await resolveFakeImport(ChildB);

      await waitForAll(['A', 'B', 'Did mount: A', 'Did mount: B']);
      expect(root).toMatchRenderedOutput('AB');

      // 交换 A 与 B 的位置。
      root.update(<Parent swap={true} />);
      assertLog(['Init B2', 'Loading...']);
      await resolveFakeImport(ChildB2);
      // 需要继续 flush，才能触发第二个 Lazy initializer 开始加载。
      await waitForAll(['Init A2']);
      await resolveFakeImport(ChildA2);

      await waitForAll(['b', 'a', 'Did update: b', 'Did update: a']);
      expect(root).toMatchRenderedOutput('ba');
    });

    /**
     * Given：legacy root 初始使用 LazyChildA/B 类型和稳定 key，交换后改用新的 LazyChildB2/A2 类型。
     * When：依次解决初始 modules 并提交 AB，再交换顺序和 lazy type，按用例节奏解决或冲刷第二组。
     * Then：key 相同但 element type 改变会替换旧实例；新类型完成后按 BA 顺序提交，并呈现对应 mount/update 边界。
     *
     * 验证机制：Init、fallback、unmount/mount 或 update 日志与 AB→ba 输出锁定 reconcile 决策。
     * 对应源码：`ReactChildFiber.js` 的 lazy type 解析与 keyed element type 比较，以及 `ReactLazy.js`。
     */
    // @gate !disableLegacyMode
    it('mount and reorder lazy types (legacy mode)', async () => {
      /** 定义 Child 类 fixture，暴露实例身份、defaultProps、错误边界或生命周期，用于“legacy模式下 Lazy type 更换与 keyed 重排”。 */
      class Child extends React.Component {
        /** Child.componentDidMount 记录首次提交及实例 label/defaultProps，用于“legacy模式下 Lazy type 更换与 keyed 重排”。 */
        componentDidMount() {
          Scheduler.log('Did mount: ' + this.props.label);
        }
        /** Child.componentDidUpdate 记录复用实例的更新提交，用于区分 keyed reorder 与 remount。 */
        componentDidUpdate() {
          Scheduler.log('Did update: ' + this.props.label);
        }
        /** Child.render 渲染当前 props/state 并暴露日志或宿主输出，用于“legacy模式下 Lazy type 更换与 keyed 重排”。 */
        render() {
          return <Text text={this.props.label} />;
        }
      }

      /** ChildA 把大小写状态映射为稳定 Child label，区分 type 解析与 keyed 复用。 */
      function ChildA({lowerCase}) {
        return <Child label={lowerCase ? 'a' : 'A'} />;
      }

      /** ChildB 把大小写状态映射为稳定 Child label，区分 type 解析与 keyed 复用。 */
      function ChildB({lowerCase}) {
        return <Child label={lowerCase ? 'b' : 'B'} />;
      }

      const LazyChildA = lazy(() => {
        Scheduler.log('Init A');
        return fakeImport(ChildA);
      });
      const LazyChildB = lazy(() => {
        Scheduler.log('Init B');
        return fakeImport(ChildB);
      });
      const LazyChildA2 = lazy(() => {
        Scheduler.log('Init A2');
        return fakeImport(ChildA);
      });
      const LazyChildB2 = lazy(() => {
        Scheduler.log('Init B2');
        return fakeImport(ChildB);
      });

      /** Parent 根据 swap 选择 Lazy children 顺序和类型，驱动“legacy模式下 Lazy type 更换与 keyed 重排”。 */
      function Parent({swap}) {
        return (
          <Suspense fallback={<Text text="Outer..." />}>
            <Suspense fallback={<Text text="Loading..." />}>
              {swap
                ? [
                    <LazyChildB2 key="B" lowerCase={true} />,
                    <LazyChildA2 key="A" lowerCase={true} />,
                  ]
                : [<LazyChildA key="A" />, <LazyChildB key="B" />]}
            </Suspense>
          </Suspense>
        );
      }

      const root = ReactTestRenderer.create(<Parent swap={false} />, {
        unstable_isConcurrent: false,
      });

      assertLog(['Init A', 'Init B', 'Loading...']);
      expect(root).not.toMatchRenderedOutput('AB');

      await resolveFakeImport(ChildA);
      await resolveFakeImport(ChildB);

      await waitForAll(['A', 'B', 'Did mount: A', 'Did mount: B']);
      expect(root).toMatchRenderedOutput('AB');

      // 交换 A 与 B 的位置。
      root.update(<Parent swap={true} />);
      assertLog(['Init B2', 'Loading...']);
      await waitForAll(['Init A2', 'b', 'a', 'Did update: b', 'Did update: a']);
      expect(root).toMatchRenderedOutput('ba');
    });
  });
});
