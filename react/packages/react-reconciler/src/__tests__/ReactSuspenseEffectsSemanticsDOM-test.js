/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let React;
let ReactDOM;
let ReactDOMClient;
let Scheduler;
let act;
let container;
let waitForAll;
let assertLog;
let fakeModuleCache;

/** 验证 DOM 渲染器隐藏 Suspense 主树时，ref、生命周期和布局副作用只清理一次。 */
describe('ReactSuspenseEffectsSemanticsDOM', () => {
  /** 重建 DOM 根、调度日志和惰性模块缓存，为每个副作用场景提供独立宿主容器。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    assertLog = InternalTestUtils.assertLog;

    container = document.createElement('div');
    document.body.appendChild(container);

    fakeModuleCache = new Map();
  });

  /** 从 document 移除本用例容器，避免 DOM 与事件状态泄漏到下一场景。 */
  afterEach(() => {
    document.body.removeChild(container);
  });

  /**
   * 返回由测试显式完成的惰性模块 thenable；同一组件身份共享一条缓存记录。
   * 状态从 pending 单向进入 resolved，保留所有 React retry ping。
   */
  async function fakeImport(Component) {
    const record = fakeModuleCache.get(Component);
    if (record === undefined) {
      const newRecord = {
        status: 'pending',
        value: {default: Component},
        pings: [],
        /** pending 时登记 ping，resolved 时同步回放模块，rejected 时抛出缓存错误。 */
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

  /**
   * 将指定组件的伪模块推进为 resolved，并逐个唤醒 React.lazy 重试。
   * 边界：缺失或重复完成都会抛出固定错误，防止测试悄悄进入无效状态。
   */
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

  /** 记录渲染顺序并返回文本，用作 DOM 内容和副作用时序探针。 */
  function Text(props) {
    Scheduler.log(props.text);
    return props.text;
  }

  /**
   * 场景（Given–When–Then）：给定组件在 render phase 镜像 prop 并使用回调 ref，兄弟在更新时
   * 永久挂起；当调度该更新；那么渲染能退出而不会形成 render/ref 更新循环。
   * 对应机制：Suspense unwind 与 render-phase update 队列重放。
   */
  it('should not cause a cycle when combined with a render phase update', async () => {
    let scheduleSuspendingUpdate;

    /** 暴露一次会同时触发镜像状态更新和兄弟挂起的根更新。 */
    function App() {
      const [value, setValue] = React.useState(true);

      /** 取反当前 value，同时改变镜像 prop 与兄弟的挂起条件；lane 由调用上下文决定。 */
      scheduleSuspendingUpdate = () => setValue(!value);

      return (
        <>
          <React.Suspense fallback="Loading...">
            <ComponentThatCausesBug value={value} />
            <ComponentThatSuspendsOnUpdate shouldSuspend={!value} />
          </React.Suspense>
        </>
      );
    }

    /** 在 render phase 同步镜像输入，并安装函数式 ref 以复现历史循环条件。 */
    function ComponentThatCausesBug({value}) {
      const [mirroredValue, setMirroredValue] = React.useState(value);
      if (mirroredValue !== value) {
        setMirroredValue(value);
      }

      // eslint-disable-next-line no-unused-vars
      const [_, setRef] = React.useState(null);

      return <div ref={setRef} />;
    }

    const neverResolves = {
      /** 永不调用回调，使挂起状态保持到测试结束。 */
      then() {}
    };

    /** 在 `shouldSuspend` 为真时抛出永久 pending 的 thenable。 */
    function ComponentThatSuspendsOnUpdate({shouldSuspend}) {
      if (shouldSuspend) {
        // 模拟一次不会恢复的挂起。
        throw neverResolves;
      }
      return null;
    }

    await act(() => {
      const root = ReactDOMClient.createRoot(container);
      root.render(<App />);
    });

    await act(() => {
      scheduleSuspendingUpdate();
    });
  });

  /**
   * 场景（Given–When–Then）：给定 A 的回调 ref 已挂载，紧急切换到未加载 B 先隐藏 A，B 完成后再删除 A；
   * 当 B 完成；那么 A 的 ref cleanup 只执行一次，B 只挂载一次。
   * 对应机制：隐藏 Offscreen 子树删除时的 ref detach 去重。
   */
  it('does not destroy ref cleanup twice when hidden child is removed', async () => {
    /** 用回调 ref 记录 A 宿主节点的 attach/detach。 */
    function ChildA({label}) {
      return (
        <span
          ref={node => {
            if (node) {
              Scheduler.log('Ref mount: ' + label);
            } else {
              Scheduler.log('Ref unmount: ' + label);
            }
          }}>
          <Text text={label} />
        </span>
      );
    }

    /** 用回调 ref 记录替换节点 B 的 attach/detach。 */
    function ChildB({label}) {
      return (
        <span
          ref={node => {
            if (node) {
              Scheduler.log('Ref mount: ' + label);
            } else {
              Scheduler.log('Ref unmount: ' + label);
            }
          }}>
          <Text text={label} />
        </span>
      );
    }

    const LazyChildA = React.lazy(() => fakeImport(ChildA));
    const LazyChildB = React.lazy(() => fakeImport(ChildB));

    /** 在同一 Suspense 位置按 `swap` 切换两个惰性组件。 */
    function Parent({swap}) {
      return (
        <React.Suspense fallback={<Text text="Loading..." />}>
          {swap ? <LazyChildB label="B" /> : <LazyChildA label="A" />}
        </React.Suspense>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent swap={false} />);
    });
    assertLog(['Loading...']);

    await act(() => resolveFakeImport(ChildA));
    assertLog(['A', 'Ref mount: A']);
    expect(container.innerHTML).toBe('<span>A</span>');

    // 把同一位置从 A 切换为尚未加载的 B。
    ReactDOM.flushSync(() => {
      root.render(<Parent swap={true} />);
    });
    assertLog(['Loading...', 'Ref unmount: A']);
    expect(container.innerHTML).toBe(
      '<span style="display: none;">A</span>Loading...',
    );

    await act(() => resolveFakeImport(ChildB));
    assertLog(['B', 'Ref mount: B']);
    expect(container.innerHTML).toBe('<span>B</span>');
  });

  /**
   * 场景（Given–When–Then）：给定类组件 A 已挂载，切换到惰性 B 时 A 进入隐藏删除路径；
   * 当 B 完成；那么 A 的 componentWillUnmount 只调用一次，B 的 didMount 只调用一次。
   * 对应机制：Suspense 隐藏树删除与类生命周期清理去重。
   */
  it('does not call componentWillUnmount twice when hidden child is removed', async () => {
    /** 记录 A 的挂载、卸载与渲染生命周期。 */
    class ChildA extends React.Component {
      /** 记录 A 首次提交。 */
      componentDidMount() {
        Scheduler.log('Did mount: ' + this.props.label);
      }
      /** 记录 A 的唯一卸载。 */
      componentWillUnmount() {
        Scheduler.log('Will unmount: ' + this.props.label);
      }
      /** 输出 A 的标签文本。 */
      render() {
        return <Text text={this.props.label} />;
      }
    }

    /** 记录替换组件 B 的挂载、卸载与渲染生命周期。 */
    class ChildB extends React.Component {
      /** 记录 B 首次提交。 */
      componentDidMount() {
        Scheduler.log('Did mount: ' + this.props.label);
      }
      /** 记录 B 的唯一卸载。 */
      componentWillUnmount() {
        Scheduler.log('Will unmount: ' + this.props.label);
      }
      /** 输出 B 的标签文本。 */
      render() {
        return <Text text={this.props.label} />;
      }
    }

    const LazyChildA = React.lazy(() => fakeImport(ChildA));
    const LazyChildB = React.lazy(() => fakeImport(ChildB));

    /** 在同一边界位置按 `swap` 选择惰性类组件 A 或 B。 */
    function Parent({swap}) {
      return (
        <React.Suspense fallback={<Text text="Loading..." />}>
          {swap ? <LazyChildB label="B" /> : <LazyChildA label="A" />}
        </React.Suspense>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent swap={false} />);
    });
    assertLog(['Loading...']);

    await act(() => resolveFakeImport(ChildA));
    assertLog(['A', 'Did mount: A']);
    expect(container.innerHTML).toBe('A');

    // 把同一位置从 A 切换为尚未加载的 B。
    ReactDOM.flushSync(() => {
      root.render(<Parent swap={true} />);
    });
    assertLog(['Loading...', 'Will unmount: A']);
    expect(container.innerHTML).toBe('Loading...');

    await act(() => resolveFakeImport(ChildB));
    assertLog(['B', 'Did mount: B']);
    expect(container.innerHTML).toBe('B');
  });

  /**
   * 场景（Given–When–Then）：给定 A 的布局副作用已挂载，切换到未加载 B 时先隐藏 A；
   * 当随后删除整个 Suspense 父树；那么 A 的布局 cleanup 不会再次执行。
   * 对应机制：Offscreen 隐藏阶段已断开的 layout effect 在删除阶段跳过去重。
   */
  it('does not destroy layout effects twice when parent suspense is removed', async () => {
    /** 用 layout effect 记录 A 的挂载与清理。 */
    function ChildA({label}) {
      React.useLayoutEffect(() => {
        Scheduler.log('Did mount: ' + label);
        return () => {
          Scheduler.log('Will unmount: ' + label);
        };
      }, []);
      return <Text text={label} />;
    }
    /** 用 layout effect 记录替换组件 B 的挂载与清理。 */
    function ChildB({label}) {
      React.useLayoutEffect(() => {
        Scheduler.log('Did mount: ' + label);
        return () => {
          Scheduler.log('Will unmount: ' + label);
        };
      }, []);
      return <Text text={label} />;
    }
    const LazyChildA = React.lazy(() => fakeImport(ChildA));
    const LazyChildB = React.lazy(() => fakeImport(ChildB));

    /** 在同一边界位置按 `swap` 切换两个带布局副作用的惰性组件。 */
    function Parent({swap}) {
      return (
        <React.Suspense fallback={<Text text="Loading..." />}>
          {swap ? <LazyChildB label="B" /> : <LazyChildA label="A" />}
        </React.Suspense>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent swap={false} />);
    });
    assertLog(['Loading...']);

    await act(() => resolveFakeImport(ChildA));
    assertLog(['A', 'Did mount: A']);
    expect(container.innerHTML).toBe('A');

    // 把同一位置从 A 切换为尚未加载的 B。
    ReactDOM.flushSync(() => {
      root.render(<Parent swap={true} />);
    });
    assertLog(['Loading...', 'Will unmount: A']);
    expect(container.innerHTML).toBe('Loading...');

    // 删除包括隐藏 A 在内的整棵树，验证 cleanup 不会重复。
    ReactDOM.flushSync(() => {
      root.render(<h1>Hello</h1>);
    });
    await waitForAll([]);
    expect(container.innerHTML).toBe('<h1>Hello</h1>');
  });

  /**
   * 场景（Given–When–Then）：给定 A 的回调 ref 已因切换到 B 而 detach、A 仍作为隐藏宿主树保留；
   * 当删除整个父边界；那么不会第二次调用 A 的 ref cleanup。
   * 对应机制：隐藏树的 Ref flag 清理与父级 deletion 协作。
   */
  it('does not destroy ref cleanup twice when parent suspense is removed', async () => {
    /** 用回调 ref 记录 A 宿主节点的 attach/detach。 */
    function ChildA({label}) {
      return (
        <span
          ref={node => {
            if (node) {
              Scheduler.log('Ref mount: ' + label);
            } else {
              Scheduler.log('Ref unmount: ' + label);
            }
          }}>
          <Text text={label} />
        </span>
      );
    }

    /** 用回调 ref 记录替换节点 B 的 attach/detach。 */
    function ChildB({label}) {
      return (
        <span
          ref={node => {
            if (node) {
              Scheduler.log('Ref mount: ' + label);
            } else {
              Scheduler.log('Ref unmount: ' + label);
            }
          }}>
          <Text text={label} />
        </span>
      );
    }

    const LazyChildA = React.lazy(() => fakeImport(ChildA));
    const LazyChildB = React.lazy(() => fakeImport(ChildB));

    /** 在同一边界位置按 `swap` 选择带 ref 的惰性组件。 */
    function Parent({swap}) {
      return (
        <React.Suspense fallback={<Text text="Loading..." />}>
          {swap ? <LazyChildB label="B" /> : <LazyChildA label="A" />}
        </React.Suspense>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent swap={false} />);
    });
    assertLog(['Loading...']);

    await act(() => resolveFakeImport(ChildA));
    assertLog(['A', 'Ref mount: A']);
    expect(container.innerHTML).toBe('<span>A</span>');

    // 把同一位置从 A 切换为尚未加载的 B。
    ReactDOM.flushSync(() => {
      root.render(<Parent swap={true} />);
    });
    assertLog(['Loading...', 'Ref unmount: A']);
    expect(container.innerHTML).toBe(
      '<span style="display: none;">A</span>Loading...',
    );

    // 删除包括隐藏 A 在内的整棵树，验证 ref cleanup 不会重复。
    ReactDOM.flushSync(() => {
      root.render(<h1>Hello</h1>);
    });
    await waitForAll([]);
    expect(container.innerHTML).toBe('<h1>Hello</h1>');
  });

  /**
   * 场景（Given–When–Then）：给定类组件 A 已因切换到 B 而执行卸载生命周期；当 B 尚未
   * 完成时删除父 Suspense；那么隐藏 A 不会再次调用 componentWillUnmount。
   * 对应机制：隐藏树类实例的 deletion 标记去重。
   */
  it('does not call componentWillUnmount twice when parent suspense is removed', async () => {
    /** 记录 A 的挂载、卸载与渲染生命周期。 */
    class ChildA extends React.Component {
      /** 记录 A 首次提交。 */
      componentDidMount() {
        Scheduler.log('Did mount: ' + this.props.label);
      }
      /** 记录 A 的唯一卸载。 */
      componentWillUnmount() {
        Scheduler.log('Will unmount: ' + this.props.label);
      }
      /** 输出 A 的标签文本。 */
      render() {
        return <Text text={this.props.label} />;
      }
    }

    /** 记录替换组件 B 的挂载、卸载与渲染生命周期。 */
    class ChildB extends React.Component {
      /** 记录 B 首次提交。 */
      componentDidMount() {
        Scheduler.log('Did mount: ' + this.props.label);
      }
      /** 记录 B 的唯一卸载。 */
      componentWillUnmount() {
        Scheduler.log('Will unmount: ' + this.props.label);
      }
      /** 输出 B 的标签文本。 */
      render() {
        return <Text text={this.props.label} />;
      }
    }

    const LazyChildA = React.lazy(() => fakeImport(ChildA));
    const LazyChildB = React.lazy(() => fakeImport(ChildB));

    /** 在同一边界位置按 `swap` 选择惰性类组件。 */
    function Parent({swap}) {
      return (
        <React.Suspense fallback={<Text text="Loading..." />}>
          {swap ? <LazyChildB label="B" /> : <LazyChildA label="A" />}
        </React.Suspense>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent swap={false} />);
    });
    assertLog(['Loading...']);

    await act(() => resolveFakeImport(ChildA));
    assertLog(['A', 'Did mount: A']);
    expect(container.innerHTML).toBe('A');

    // 把同一位置从 A 切换为尚未加载的 B。
    ReactDOM.flushSync(() => {
      root.render(<Parent swap={true} />);
    });
    assertLog(['Loading...', 'Will unmount: A']);
    expect(container.innerHTML).toBe('Loading...');

    // 删除包括隐藏 A 在内的整棵树，验证卸载生命周期不重复。
    ReactDOM.flushSync(() => {
      root.render(<h1>Hello</h1>);
    });
    await waitForAll([]);
    expect(container.innerHTML).toBe('<h1>Hello</h1>');
  });

  /**
   * 场景（Given–When–Then）：给定 legacy 根的 Child effect 在切换 fallback 时不会断开；
   * 当随后删除整棵树；那么 effect cleanup 恰好执行一次。
   * 对应机制：旧模式 fallback 不隐藏副作用，deletion 阶段负责最终清理。
   */
  // @gate !disableLegacyMode
  it('regression: unmount hidden tree, in legacy mode', async () => {
    // 旧模式树挂起并切换到 fallback 时不会卸载 effect，因此必须在后续删除阶段清理。

    /** 安装一个记录 mount/unmount 的布局副作用。 */
    function Child() {
      React.useLayoutEffect(() => {
        Scheduler.log('Mount');
        return () => {
          Scheduler.log('Unmount');
        };
      }, []);
      return <Text text="Child" />;
    }

    /** 作为惰性兄弟，在出现时使边界挂起。 */
    function Sibling() {
      return <Text text="Sibling" />;
    }
    const LazySibling = React.lazy(() => fakeImport(Sibling));

    /** 通过 `showMore` 决定是否加入尚未加载的惰性兄弟。 */
    function App({showMore}) {
      return (
        <React.Suspense fallback={<Text text="Loading..." />}>
          <Child />
          {showMore ? <LazySibling /> : null}
        </React.Suspense>
      );
    }

    // 初次渲染只挂载 Child。
    ReactDOM.render(<App showMore={false} />, container);
    assertLog(['Child', 'Mount']);

    // 更新加入惰性兄弟并挂起，使现有树切换到 fallback。
    ReactDOM.render(<App showMore={true} />, container);
    assertLog([
      'Child',
      'Loading...',

      // 并发根会在此卸载 effect；旧模式不会。
      // Unmount
    ]);

    // 删除整棵树并最终卸载 effect。
    ReactDOM.render(null, container);
    assertLog(['Unmount']);
  });

  /**
   * 场景（Given–When–Then）：给定 Child 经多次 state bailout 后被 Suspense 隐藏并恢复为新字母；
   * 当最终卸载根；那么每代 layout cleanup 仅释放自己的 id 一次。
   * 验证机制：`freed` 集合检测 double free，并核对卸载日志。
   */
  it('does not call cleanup effects twice after a bailout', async () => {
    const never = new Promise(resolve => {});
    /** 永久抛出 pending Promise，使父 Suspense 进入 fallback。 */
    function Never() {
      throw never;
    }

    let setSuspended;
    let setLetter;

    /** 暴露挂起和字母更新器，并把可跟踪 Child 放在同一 Suspense 内。 */
    function App() {
      const [suspended, _setSuspended] = React.useState(false);
      setSuspended = _setSuspended;
      const [letter, _setLetter] = React.useState('A');
      setLetter = _setLetter;

      return (
        <React.Suspense fallback="Loading...">
          <Child letter={letter} />
          {suspended && <Never />}
        </React.Suspense>
      );
    }

    let nextId = 0;
    const freed = new Set();
    let setStep;

    /**
     * 为每次 layout effect 实例分配唯一 id；cleanup 若再次释放同一 id 则立即报错。
     * 内部 step 只用于制造可 bailout 的状态更新，不影响宿主输出。
     */
    function Child({letter}) {
      const [, _setStep] = React.useState(0);
      setStep = _setStep;

      React.useLayoutEffect(() => {
        const localId = nextId++;
        Scheduler.log('Did mount: ' + letter + localId);
        return () => {
          if (freed.has(localId)) {
            throw Error('Double free: ' + letter + localId);
          }
          freed.add(localId);
          Scheduler.log('Will unmount: ' + letter + localId);
        };
      }, [letter]);
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App />);
    });
    assertLog(['Did mount: A0']);

    await act(() => {
      setStep(1);
      setSuspended(false);
    });
    assertLog([]);

    await act(() => {
      setStep(1);
    });
    assertLog([]);

    await act(() => {
      setSuspended(true);
    });
    assertLog(['Will unmount: A0']);

    await act(() => {
      setSuspended(false);
      setLetter('B');
    });
    assertLog(['Did mount: B1']);

    await act(() => {
      root.unmount();
    });
    assertLog(['Will unmount: B1']);
  });
});
