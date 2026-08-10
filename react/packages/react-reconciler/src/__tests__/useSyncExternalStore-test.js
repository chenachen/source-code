/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let useSyncExternalStore;
let React;
let ReactNoop;
let Scheduler;
let act;
let useLayoutEffect;
let forwardRef;
let useImperativeHandle;
let useRef;
let useState;
let use;
let startTransition;
let waitFor;
let waitForAll;
let assertLog;
let Suspense;
let useMemo;
let textCache;

// 本文件只验证原生 `useSyncExternalStore` 实现，不验证 shim。原生与 shim 共用的场景应放入
// `useSyncExternalStoreShared-test.js`；两者分离后，共享测试将来可改为针对 vendored React DOM
// 版本（16、17 等）运行，而无需依赖 React Noop。
/** 验证并发读取一致性、Activity 重新订阅补偿，以及原生 external store Hook 的回归边界。 */
describe('useSyncExternalStore', () => {
  /** 每个用例重置模块、异步文本缓存，并重新绑定 Hook、Noop 渲染器与异步断言工具。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    useLayoutEffect = React.useLayoutEffect;
    useImperativeHandle = React.useImperativeHandle;
    forwardRef = React.forwardRef;
    useRef = React.useRef;
    useState = React.useState;
    use = React.use;
    useSyncExternalStore = React.useSyncExternalStore;
    startTransition = React.startTransition;
    Suspense = React.Suspense;
    useMemo = React.useMemo;
    textCache = new Map();
    const InternalTestUtils = require('internal-test-utils');
    waitFor = InternalTestUtils.waitFor;
    waitForAll = InternalTestUtils.waitForAll;
    assertLog = InternalTestUtils.assertLog;

    act = require('internal-test-utils').act;
  });

  /** 把指定异步文本记录切为 resolved，并唤醒此前登记在 thenable 上的所有渲染尝试。 */
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
   * 读取文本缓存；已完成则返回，失败则抛错，未完成或首次读取则抛出 thenable 触发 Suspense。
   * 状态只沿 `pending → resolved` 转移，唤醒回调由 `resolveText()` 统一冲刷。
   */
  function readText(text) {
    const record = textCache.get(text);
    if (record !== undefined) {
      // 按记录终态决定返回或抛出：pending 交给 Suspense，rejected 交给错误边界，resolved 返回文本。
      switch (record.status) {
        case 'pending':
          throw record.value;
        case 'rejected':
          throw record.value;
        case 'resolved':
          return record.value;
      }
    } else {
      const thenable = {
        pings: [],
        /** pending 时登记唤醒回调；若状态已变化，则排入微任务异步通知。 */
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

  /** 通过 `readText()` 读取可挂起文本，并在成功渲染时记录内容。 */
  function AsyncText({text}) {
    const result = readText(text);
    Scheduler.log(text);
    return result;
  }

  /** 把同步文本同时写入调度日志与宿主输出。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** 创建最小 external store，提供批量通知、订阅清理、快照读取和订阅数观测。 */
  function createExternalStore(initialState) {
    const listeners = new Set();
    let currentState = initialState;
    return {
      /** 原子替换当前快照，并在 Noop 批处理中通知所有订阅者。 */
      set(text) {
        currentState = text;
        ReactNoop.batchedUpdates(() => {
          listeners.forEach(listener => listener());
        });
      },
      /** 登记变更监听器并返回幂等删除该监听器的取消订阅函数。 */
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      /** 返回订阅者当前应比较的快照值。 */
      getState() {
        return currentState;
      },
      /** 暴露当前监听器数量，用于断言 Activity 隐藏和显示时的订阅生命周期。 */
      getSubscriberCount() {
        return listeners.size;
      },
    };
  }

  /**
   * Given：并发渲染的三个子节点从同一 store 读取快照，前两个完成后 store 在交错事件中突变。
   * When：继续完成第三个子节点并准备提交 Layout Effect；随后切换到另一 store 重复该序列。
   * Then：React 放弃不一致的完成树、同步重渲染，布局阶段只观察到一致的新快照。
   *
   * 验证机制：分段 `waitFor` 暴露撕裂窗口，再由渲染日志和布局读取日志共同证明提交前检查生效。
   * 对应源码：`updateSyncExternalStore()` 安排一致性检查，提交前的 store consistency 校验触发同步重渲染。
   */
  it(
    'detects interleaved mutations during a concurrent read before ' +
      'layout effects fire',
    async () => {
      const store1 = createExternalStore(0);
      const store2 = createExternalStore(0);

      /** 订阅给定 store，并通过 imperative handle 暴露本次渲染读到的快照。 */
      const Child = forwardRef(({store, label}, ref) => {
        const value = useSyncExternalStore(store.subscribe, store.getState);
        useImperativeHandle(ref, () => {
          return value;
        }, []);
        return <Text text={label + value} />;
      });

      /** 渲染三个订阅者，并在 Layout Effect 中一次性读取它们提交的快照以检测撕裂。 */
      function App({store}) {
        const refA = useRef(null);
        const refB = useRef(null);
        const refC = useRef(null);
        useLayoutEffect(() => {
          // 此布局 Effect 读取依赖 external store 的三个子节点，用来判断布局阶段看到的值是否一致。
          const aText = refA.current;
          const bText = refB.current;
          const cText = refC.current;
          Scheduler.log(
            `Children observed during layout: A${aText}B${bText}C${cText}`,
          );
        });
        return (
          <>
            <Child store={store} ref={refA} label="A" />
            <Child store={store} ref={refB} label="B" />
            <Child store={store} ref={refC} label="C" />
          </>
        );
      }

      const root = ReactNoop.createRoot();
      await act(async () => {
        // 启动读取 store 的并发渲染，并在第三个子节点前让出执行权。
        startTransition(() => {
          root.render(<App store={store1} />);
        });

        await waitFor(['A0', 'B0']);

        // 在交错事件中改变 store。
        store1.set(1);

        // 随后继续渲染。
        await waitForAll([
          // C 读取到比 A、B 更新的值，证明完成树内部出现不一致。
          'C1',

          // React 在提交布局 Effect 前发现 store 已改变，丢弃整棵完成树并以新值重渲染。
          'A1',
          'B1',
          'C1',
          // 布局 Effect 最终只读取到一致的子节点值。
          'Children observed during layout: A1B1C1',
        ]);
      });

      // 接着在更新期间切换 store，复验同一一致性保障。
      await act(async () => {
        startTransition(() => {
          root.render(<App store={store2} />);
        });

        // 启动读取新 store 的并发渲染并让出执行权。
        await waitFor(['A0', 'B0']);

        // 在交错事件中改变新 store。
        store2.set(1);

        // 随后继续渲染。
        await waitForAll([
          // C 读取到比 A、B 更新的值，完成树再次出现不一致。
          'C1',

          // 提交前一致性检查发现突变，丢弃完成树并以新值重渲染。
          'A1',
          'B1',
          'C1',
          // 布局 Effect 最终读取到一致值。
          'Children observed during layout: A1B1C1',
        ]);
      });
    },
  );

  /**
   * Given：组件同时订阅 store，并在快照变化时于渲染阶段把相同值同步进本地 state。
   * When：store 从 initial 改为 changed，再改回 initial。
   * Then：两次变化都各自产生正确输出，旧快照不会因渲染阶段更新而污染缓存。
   *
   * 验证机制：每次 `set` 后只检查唯一快照日志，回切初值专门证明 next value 已更新。
   * 对应源码：`updateSyncExternalStore()` 更新 Hook 快照，渲染阶段 state 重试由 `renderWithHooksAgain()` 处理。
   */
  it('next value is correctly cached when state is dispatched in render phase', async () => {
    const store = createExternalStore('value:initial');

    /** 订阅 store，并用渲染阶段 state 同步制造与快照缓存交错的边界场景。 */
    function App() {
      const value = useSyncExternalStore(store.subscribe, store.getState);
      const [sameValue, setSameValue] = useState(value);
      if (value !== sameValue) setSameValue(value);
      return <Text text={value} />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      // 启动读取 store 并产出初始值的渲染。
      root.render(<App />);
    });
    assertLog(['value:initial']);

    await act(() => {
      store.set('value:changed');
    });
    assertLog(['value:changed']);

    // 若缓存快照已正确更新，切回初值时应再次渲染。
    await act(() => {
      store.set('value:initial');
    });
    assertLog(['value:initial']);
  });

  /**
   * Given：A、B 在并发渲染中订阅同一 store，A 的新快照会读取一个未完成 Promise。
   * When：A 初次渲染后、B 渲染前突变 store，React 以同步检查修补撕裂。
   * Then：同步重渲染中的 A 挂起，根保持未提交；Promise 解决后两者提交相同新值。
   *
   * 验证机制：按顺序断言 B 的新值、A 的挂起日志、空宿主树及恢复后的成对输出。
   * 对应源码：store consistency 同步重渲染与 `useSyncExternalStore` 快照检查、Suspense 抛出路径的组合。
   */
  it(
    'regression: suspending in shell after synchronously patching ' +
      'up store mutation',
    async () => {
      // 覆盖 store 在并发事件中突变，并在一致性同步重渲染期间再次触发同步渲染的场景。

      const store = createExternalStore('Initial');

      let resolve;
      const promise = new Promise(r => {
        resolve = r;
      });

      /** 订阅 store；读到 Updated 时消费未完成 Promise，以便同步修补路径发生挂起。 */
      function A() {
        const value = useSyncExternalStore(store.subscribe, store.getState);

        if (value === 'Updated') {
          try {
            use(promise);
          } catch (x) {
            Scheduler.log('Suspend A');
            throw x;
          }
        }

        return <Text text={'A: ' + value} />;
      }

      /** 订阅同一 store 并同步输出快照，作为 A 挂起时的兄弟节点观测点。 */
      function B() {
        const value = useSyncExternalStore(store.subscribe, store.getState);
        return <Text text={'B: ' + value} />;
      }

      /** 把两个订阅者放入同一根中，形成可分段完成的并发渲染。 */
      function App() {
        return (
          <>
            <span>
              <A />
            </span>
            <span>
              <B />
            </span>
          </>
        );
      }

      const root = ReactNoop.createRoot();
      await act(async () => {
        // A、B 读取同一 store；先只完成 A 的部分渲染。
        startTransition(() => root.render(<App />));
        // A 读取 store 初值。
        await waitFor(['A: Initial']);

        // 在 B 渲染前改变 store。
        store.set('Updated');
      });
      assertLog([
        // B 读取更新后的 store 值。
        'B: Updated',
        // 该不一致触发 A 使用新值同步重渲染；本用例让这次重渲染挂起。
        'Suspend A',
        // 预热渲染。
        'B: Updated',
      ]);
      // A 已挂起且未提供 fallback，因此没有内容提交。
      expect(root).toMatchRenderedOutput(null);

      // 解决数据并完成渲染。
      await act(() => resolve());
      assertLog(['A: Updated', 'B: Updated']);
      expect(root).toMatchRenderedOutput(
        <>
          <span>A: Updated</span>
          <span>B: Updated</span>
        </>,
      );
    },
  );

  // 回归场景：https://github.com/facebook/react/issues/27670
  /**
   * Given：可见 Activity 中的订阅者已订阅 store，Wrapper 会在 reveal 的 Layout Effect 中改写它。
   * When：先隐藏子树解除订阅，再以新 revision 显示子树。
   * Then：订阅者在重新订阅时补查错过的突变，并提交 revision:2。
   *
   * 验证机制：同时断言渲染日志、最终宿主输出及订阅者数量的 `1 → 0 → 1` 转移。
   * 对应源码：`updateStoreInstance()` 在订阅 Effect 中调用 `checkIfSnapshotChanged()` 补偿提交窗口内的突变。
   */
  it('detects store mutations from a layout effect while an Activity subtree is being revealed', async () => {
    const store = createExternalStore('revision:1');

    /** 用 Activity 切换子树可见性，并把 revision 交给会改写 store 的 Wrapper。 */
    function App({mode, revision}) {
      return (
        <React.Activity mode={mode}>
          <Wrapper revision={revision}>
            <Subscriber />
          </Wrapper>
        </React.Activity>
      );
    }

    /** 在 reveal 的布局阶段发布新 revision，刻意落在订阅者渲染与重新订阅之间。 */
    function Wrapper({children, revision}) {
      useLayoutEffect(() => {
        store.set('revision:' + revision);
      }, [revision]);

      return (
        <>
          wrapper:{revision}
          {', '}
          {children}
        </>
      );
    }

    /** 订阅 revision store 并输出当前快照。 */
    function Subscriber() {
      const revision = useSyncExternalStore(store.subscribe, store.getState);
      return <Text text={revision} />;
    }

    const root = ReactNoop.createRoot();

    // 首次挂载应用。
    await act(() => {
      root.render(<App mode="visible" revision="1" />);
    });
    assertLog(['revision:1']);
    expect(root).toMatchRenderedOutput('wrapper:1, revision:1');
    expect(store.getSubscriberCount()).toBe(1);

    // 隐藏子树；React 解除 store 订阅。
    await act(() => {
      root.render(<App mode="hidden" revision="1" />);
    });
    assertLog(['revision:1']);
    expect(store.getSubscriberCount()).toBe(0);

    // 再次显示子树：Layout Effect 在 Subscriber 渲染后、重新订阅前改变 store；订阅恢复时必须
    // 检测到这次错过的突变。
    await act(() => {
      root.render(<App mode="visible" revision="2" />);
    });
    assertLog(['revision:1', 'revision:2']);
    expect(store.getSubscriberCount()).toBe(1);
    expect(root).toMatchRenderedOutput('wrapper:2, revision:2');
  });

  // 回归场景：https://github.com/facebook/react/issues/27670
  /**
   * Given：Activity 中的 memo 订阅者隐藏后错过 store 更新，显示时又因 props 未变而 bailout。
   * When：在隐藏期间改变 store，再显示同一 memo 子树。
   * Then：即使不重新执行订阅者渲染，恢复订阅仍检测到新快照并更新输出。
   *
   * 验证机制：断言隐藏期间无日志、显示后出现 updated，并校验订阅数恢复为一。
   * 对应源码：Activity 重连被动 Effect 时执行 `updateStoreInstance()` 的快照补查路径。
   */
  it(
    'detects store mutations that happened while an Activity subtree was ' +
      'hidden, even if the subtree bails out of rendering when revealed',
    async () => {
      const store = createExternalStore('initial');

      // 使用 memo 保证 Activity reveal 不会重渲染订阅者；这对应 React.memo 或 React Compiler
      // 生成的 memo 组件。
      /** 订阅 store 并按 label 输出快照；memo 用来强制 reveal 时走组件 bailout。 */
      const Subscriber = React.memo(({label}) => {
        const value = useSyncExternalStore(store.subscribe, store.getState);
        return <Text text={label + ':' + value} />;
      });

      /** 用 Activity 模式驱动 memo 订阅者隐藏、显示和 props 更新。 */
      function App({mode, label}) {
        return (
          <React.Activity mode={mode}>
            <Subscriber label={label} />
          </React.Activity>
        );
      }

      const root = ReactNoop.createRoot();
      await act(() => {
        root.render(<App mode="visible" label="a" />);
      });
      assertLog(['a:initial']);
      expect(root).toMatchRenderedOutput('a:initial');
      expect(store.getSubscriberCount()).toBe(1);

      // 在 store 不变时用不同 props 重渲染一次订阅者；其 Effect 列表随后只含订阅 Effect，
      // 不含交错突变检查。
      await act(() => {
        root.render(<App mode="visible" label="b" />);
      });
      assertLog(['b:initial']);
      expect(root).toMatchRenderedOutput('b:initial');

      // 隐藏子树；React 解除 store 订阅。
      await act(() => {
        root.render(<App mode="hidden" label="b" />);
      });
      expect(store.getSubscriberCount()).toBe(0);

      // 子树隐藏期间改变 store；此时没有订阅者，所以不会安排更新。
      await act(() => {
        store.set('updated');
      });
      assertLog([]);

      // 再次显示子树时 memo 组件跳过渲染，因此重新订阅是检测隐藏期间突变的唯一机会。
      await act(() => {
        root.render(<App mode="visible" label="b" />);
      });
      assertLog(['b:updated']);
      expect(store.getSubscriberCount()).toBe(1);
      expect(root).toMatchRenderedOutput('b:updated');
    },
  );

  /**
   * Given：非规范 store 在渲染中的 memo 回调里先只替换快照对象，再异步写入真正的新值。
   * When：首次渲染因异步文本挂起，随后解决文本并重试整棵 Suspense 子树。
   * Then：相等业务值对应的新快照引用不会令同步 store 检查陷入无限重渲染。
   *
   * 验证机制：`act` 必须收敛，有限日志序列兼容节流重试开关，最终宿主输出固定为 `AB`。
   * 对应源码：`mountSyncExternalStore()`、`updateSyncExternalStore()` 与 `updateStoreInstance()` 的快照身份检查。
   */
  it('regression: does not infinite loop for only changing store reference in render', async () => {
    let store = {value: {}};
    let listeners = [];

    const ExternalStore = {
      /** 先仅替换 store 对象身份，延迟后再写业务值并各通知一次订阅者。 */
      set(value) {
        // 先改变 store 引用而不改变业务值。若渲染中调用 set，`getSnapshot` 会返回新对象；
        // store 不应这样实现，但 React 仍须避免因此无限渲染。
        store = {...store};
        setTimeout(() => {
          store = {value};
          emitChange();
        }, 100);
        emitChange();
      },
      /** 以不可变数组登记监听器，并返回按身份移除监听器的清理函数。 */
      subscribe(listener) {
        listeners = [...listeners, listener];
        return () => {
          listeners = listeners.filter(l => l !== listener);
        };
      },
      /** 返回整个 store 对象，以便刻意放大快照引用变化。 */
      getSnapshot() {
        return store;
      },
    };

    /** 同步通知当前监听器列表中的全部订阅者。 */
    function emitChange() {
      listeners.forEach(l => l());
    }

    /** 订阅非规范 store，并在挂载 memo 回调中触发一次渲染阶段外部写入。 */
    function StoreText() {
      const {value} = useSyncExternalStore(
        ExternalStore.subscribe,
        ExternalStore.getSnapshot,
      );

      useMemo(() => {
        // 挂载时写入 store。该模式违反 React 规则，但实现仍应平稳收敛。
        const newValue = {text: 'B'};
        if (value == null || newValue !== value) {
          ExternalStore.set(newValue);
        }
      }, []);

      return <Text text={value.text || '(not set)'} />;
    }

    /** 把异步文本和 external store 订阅者放入同一 Suspense 边界，驱动重试交错。 */
    function App() {
      return (
        <>
          <Suspense fallback={'Loading...'}>
            <AsyncText text={'A'} />
            <StoreText />
          </Suspense>
        </>
      );
    }

    const root = ReactNoop.createRoot();

    // 首次渲染挂起。
    await act(async () => {
      root.render(<App />);
    });

    // 预热渲染。
    assertLog(['(not set)']);

    expect(root).toMatchRenderedOutput('Loading...');

    // 解决数据并完成渲染；恢复期间 store 不得陷入无限循环。
    await act(() => {
      resolveText('A');
    });
    assertLog([
      'A',
      'B',
      'A',
      'B',
      'B',
      ...(gate('alwaysThrottleRetries') ? [] : ['B']),
    ]);

    expect(root).toMatchRenderedOutput('AB');
  });
});
