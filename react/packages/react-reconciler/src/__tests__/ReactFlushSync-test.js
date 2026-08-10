let React;
let ReactDOM;
let ReactDOMClient;
let Scheduler;
let act;
let useState;
let useEffect;
let startTransition;
let assertLog;
let assertConsoleErrorDev;
let waitForPaint;

// TODO: 将仍依赖 React Noop 的测试迁移到 React DOM。

/** 验证 flushSync 的 lane 上下文、被动 effect 边界、legacy 差异与多根异常冲刷保证。 */
describe('ReactFlushSync', () => {
  /** 重置 DOM/调度模块并绑定 effect、transition 及可见 DOM 断言工具，隔离同步队列。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    useState = React.useState;
    useEffect = React.useEffect;
    startTransition = React.startTransition;

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;
    waitForPaint = InternalTestUtils.waitForPaint;
  });

  /** 记录并返回文本，把渲染顺序与 DOM 提交值关联起来。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** 递归提取可见 DOM 为 React 节点：排除隐藏/template/普通 script 与 React 生成 id，保留文本和有意义属性。 */
  function getVisibleChildren(element: Element): React$Node {
    const children = [];
    let node: any = element.firstChild;
    // WHY：按真实兄弟链遍历，可同时处理元素节点与文本节点，且跳过不可见节点而不改变 DOM。
    while (node) {
      if (node.nodeType === 1) {
        if (
          ((node.tagName !== 'SCRIPT' && node.tagName !== 'script') ||
            node.hasAttribute('data-meaningful')) &&
          node.tagName !== 'TEMPLATE' &&
          node.tagName !== 'template' &&
          !node.hasAttribute('hidden') &&
          !node.hasAttribute('aria-hidden')
        ) {
          const props: any = {};
          const attributes = node.attributes;
          for (let i = 0; i < attributes.length; i++) {
            if (
              attributes[i].name === 'id' &&
              attributes[i].value.includes(':')
            ) {
              // 含冒号的 id 视为 React 注入的非可视实现细节，不纳入快照。
              continue;
            }
            props[attributes[i].name] = attributes[i].value;
          }
          props.children = getVisibleChildren(node);
          children.push(
            require('react').createElement(node.tagName.toLowerCase(), props),
          );
        }
      } else if (node.nodeType === 3) {
        children.push(node.data);
      }
      node = node.nextSibling;
    }
    return children.length === 0
      ? undefined
      : children.length === 1
        ? children[0]
        : children;
  }

  /** Given–When–Then：Given transition 提交后，useEffect 同时安排普通 state 与 flushSync 的 syncState；When 按 paint 边界推进并在 effect 内触发 flushSync 警告；Then同步更新优先提交，普通更新留到后续轮次。通过日志、警告和可见 DOM 验证 effect 中 flushSync 的优先级与调用限制。 */
  it('changes priority of updates in useEffect', async () => {
    /** 在 effect 中交错普通更新与 flushSync 更新，制造两个不同 lane 的提交批次。 */
    function App() {
      const [syncState, setSyncState] = useState(0);
      const [state, setState] = useState(0);
      useEffect(() => {
        if (syncState !== 1) {
          setState(1);
          ReactDOM.flushSync(() => setSyncState(1));
        }
      }, [syncState, state]);
      return <Text text={`${syncState}, ${state}`} />;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      React.startTransition(() => {
        root.render(<App />);
      });
      // 在被动 effect 触发前的 paint 边界暂停。
      await waitForPaint(['0, 0']);

      // 被动 effect 同时安排同步更新和普通更新；
      // 两者应分属两个批次，先提交同步更新。
      await waitForPaint(['1, 1']);

      // 剩余普通更新不是同步工作，空 flushSync 不会冲刷它。
      ReactDOM.flushSync();
      assertLog([]);
      assertConsoleErrorDev([
        'flushSync was called from inside a lifecycle method. React ' +
          'cannot flush when React is already rendering. Consider moving this ' +
          'call to a scheduler task or micro task.' +
          '\n    in App',
      ]);

      await waitForPaint([]);
    });
    expect(getVisibleChildren(container)).toEqual('1, 1');
  });

  /** Given–When–Then：Given flushSync 内嵌 startTransition，transition 内又嵌 flushSync；When 两个 setter 分别位于最近的作用域；Then syncState 先提交为 1,0，transition state 后提交为 1,1。通过分段日志验证最近的优先级上下文决定 lane。 */
  it('supports nested flushSync with startTransition', async () => {
    let setSyncState;
    let setState;
    /** 暴露两个 setter，并把 syncState/state 组合成日志以观察嵌套优先级上下文。 */
    function App() {
      const [syncState, _setSyncState] = useState(0);
      const [state, _setState] = useState(0);
      setSyncState = _setSyncState;
      setState = _setState;
      return <Text text={`${syncState}, ${state}`} />;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App />);
    });
    assertLog(['0, 0']);
    expect(getVisibleChildren(container)).toEqual('0, 0');

    await act(() => {
      ReactDOM.flushSync(() => {
        startTransition(() => {
          // 虽然调用栈仍在 flushSync 内，但最近的上下文是 startTransition，
          // 因此该更新保持异步。
          setState(1);
          ReactDOM.flushSync(() => {
            // 虽然外层仍有 startTransition，但最近上下文已切回 flushSync，
            // 因此该更新应为同步。
            setSyncState(1);
          });
        });
      });
      // 此时只应冲刷最近 flushSync 产生的同步更新。
      assertLog(['1, 0']);
      expect(getVisibleChildren(container)).toEqual('1, 0');
    });
    // act 后续阶段再冲刷 transition 更新。
    assertLog(['1, 1']);
    expect(getVisibleChildren(container)).toEqual('1, 1');
  });

  /** Given–When–Then：Given App 由 flushSync 同步挂载并产生被动 effect；When 同步范围结束；Then Child 与 Effect 在返回前都已冲刷。通过同一 assertLog 验证同步提交所产生的 pending passive effects。 */
  it('flushes passive effects synchronously when they are the result of a sync render', async () => {
    /** 挂载时注册一次 Effect，用同步 render 验证被动队列随 flushSync 一并耗尽。 */
    function App() {
      useEffect(() => {
        Scheduler.log('Effect');
      }, []);
      return <Text text="Child" />;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      ReactDOM.flushSync(() => {
        root.render(<App />);
      });
      assertLog([
        'Child',
        // pending effect 来自同步更新，
        // 因此 flushSync 返回前也必须冲刷它。
        'Effect',
      ]);
      expect(getVisibleChildren(container)).toEqual('Child');
    });
  });

  /** Given–When–Then：Given legacy render 位于 flushSync；When同步宿主 Child 已提交；Then被动 Effect 仍延后到 paint 后。通过分段日志验证 legacy 模式的特殊 effect 时序。 */
  // @gate !disableLegacyMode
  it('does not flush passive effects synchronously after render in legacy mode', async () => {
    /** 在 legacy 根注册一次 Effect，用日志区分宿主提交与 paint 后被动阶段。 */
    function App() {
      useEffect(() => {
        Scheduler.log('Effect');
      }, []);
      return <Text text="Child" />;
    }

    const container = document.createElement('div');
    await act(() => {
      ReactDOM.flushSync(() => {
        ReactDOM.render(<App />, container);
      });
      assertLog([
        'Child',
        // legacy 模式在 render 后不会同步冲刷
        // 被动 effect。
      ]);
      expect(getVisibleChildren(container)).toEqual('Child');
    });
    // Effect 在 paint 后冲刷。
    assertLog(['Effect']);
  });

  /** Given–When–Then：Given legacy 第一次同步提交留下 step=1 的 pending effect；When 再进入 flushSync scope；Then旧 effect 先把 currentStep 设为 1，scope 才据此渲染 step=2。通过日志顺序验证 flushSync 入口先清空 legacy passive effects。 */
  // @gate !disableLegacyMode
  it('flushes pending passive effects before scope is called in legacy mode', async () => {
    let currentStep = 0;

    /** effect 把已提交 step 写入 currentStep，为下一次 flushSync scope 提供可观察前置状态。 */
    function App({step}) {
      useEffect(() => {
        currentStep = step;
        Scheduler.log('Effect: ' + step);
      }, [step]);
      return <Text text={step} />;
    }

    const container = document.createElement('div');
    await act(() => {
      ReactDOM.flushSync(() => {
        ReactDOM.render(<App step={1} />, container);
      });
      assertLog([
        1,
        // legacy 模式在 render 后不会同步冲刷
        // 被动 effect。
      ]);
      expect(getVisibleChildren(container)).toEqual('1');

      ReactDOM.flushSync(() => {
        // 进入 scope 前旧被动 effect 已把 currentStep 更新为 1，
        // 因此这里应渲染 step=2。
        ReactDOM.render(<App step={currentStep + 1} />, container);
      });
      assertLog(['Effect: 1', 2]);
      expect(getVisibleChildren(container)).toEqual('2');
    });
    assertLog(['Effect: 2']);
  });

  /** Given–When–Then：Given App 由普通并发更新挂载；When 推进到首次 paint；Then Child 已提交但 Effect 尚未运行，随后 act 才冲刷它。通过 paint 前后日志验证非同步来源的 effect 不被 flushSync 语义提前。 */
  it("does not flush passive effects synchronously when they aren't the result of a sync render", async () => {
    /** 普通并发挂载产生 Effect，作为非同步来源的被动队列样本。 */
    function App() {
      useEffect(() => {
        Scheduler.log('Effect');
      }, []);
      return <Text text="Child" />;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<App />);
      await waitForPaint([
        'Child',
        // 此被动 effect 并非由同步更新产生，
        // 因而不能在 paint 前冲刷。
      ]);
      expect(getVisibleChildren(container)).toEqual('Child');
    });
    // Effect 在 paint 后冲刷。
    assertLog(['Effect']);
  });

  /** Given–When–Then：Given普通根提交后留有 pending passive effect；When 空调用 ReactDOM.flushSync；Then该 effect 不受影响，直到 act 后续阶段才执行。通过三段日志验证 flushSync 不会无条件清空既有被动队列。 */
  it('does not flush pending passive effects', async () => {
    /** 创建 pending Effect，用空 flushSync 探测既有被动队列是否被误冲刷。 */
    function App() {
      useEffect(() => {
        Scheduler.log('Effect');
      }, []);
      return <Text text="Child" />;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<App />);
      await waitForPaint(['Child']);
      expect(getVisibleChildren(container)).toEqual('Child');

      // 当前有 pending passive effects；空 flushSync 不应影响它们。
      ReactDOM.flushSync();
      // Effect 此时仍未执行。
      assertLog([]);
    });
    // 离开内部阶段后，act 最终冲刷 Effect。
    assertLog(['Effect']);
  });

  /** Given–When–Then：Given 三个根进入同一 flushSync，其中前两根抛错、第三根更新为 aww；When 同步队列冲刷；Then第三根仍完成、错误根卸载，并聚合抛出两个原始错误。通过三根 DOM 与 AggregateError 顺序验证同步工作队列的异常隔离。 */
  it('completely exhausts synchronous work queue even if something throws', async () => {
    /** 无条件抛出传入错误，用于在多个同步根中制造可辨认的失败。 */
    function Throws({error}) {
      throw error;
    }

    const container1 = document.createElement('div');
    const root1 = ReactDOMClient.createRoot(container1);

    const container2 = document.createElement('div');
    const root2 = ReactDOMClient.createRoot(container2);

    const container3 = document.createElement('div');
    const root3 = ReactDOMClient.createRoot(container3);

    await act(async () => {
      root1.render(<Text text="Hi" />);
      root2.render(<Text text="Andrew" />);
      root3.render(<Text text="!" />);
    });
    assertLog(['Hi', 'Andrew', '!']);

    const aahh = new Error('AAHH!');
    const nooo = new Error('Noooooooooo!');

    let error;
    try {
      await act(() => {
        ReactDOM.flushSync(() => {
          root1.render(<Throws error={aahh} />);
          root2.render(<Throws error={nooo} />);
          root3.render(<Text text="aww" />);
        });
      });
    } catch (e) {
      error = e;
    }

    // 即使前两根抛错，第三根更新也必须
    // 完整地同步提交。
    assertLog(['aww']);
    // 根 1、2 在不可恢复错误后被卸载。
    expect(getVisibleChildren(container1)).toEqual(undefined);
    expect(getVisibleChildren(container2)).toEqual(undefined);
    expect(getVisibleChildren(container3)).toEqual('aww');

    // 多个同步错误按发生顺序封装进 AggregateError。
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors.length).toBe(2);
    expect(error.errors[0]).toBe(aahh);
    expect(error.errors[1]).toBe(nooo);
  });
});
