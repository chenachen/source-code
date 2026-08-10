let React;
let ReactNoop;
let Scheduler;
let act;
let LegacyHidden;
let Activity;
let useState;
let useLayoutEffect;
let useEffect;
let useInsertionEffect;
let useMemo;
let startTransition;
let waitForPaint;
let waitFor;
let assertLog;
let assertConsoleErrorDev;
let Suspense;

/** 系统覆盖 Activity/LegacyHidden 的可见性、调度优先级、宿主隐藏、effects 与类生命周期语义。 */
describe('Activity', () => {
  /** 每例重建 Noop/Scheduler 与 Hooks 引用，确保隐藏状态、effect 链和 lane 队列从空根开始。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    LegacyHidden = React.unstable_LegacyHidden;
    Activity = React.Activity;
    Suspense = React.Suspense;
    useState = React.useState;
    useInsertionEffect = React.useInsertionEffect;
    useLayoutEffect = React.useLayoutEffect;
    useEffect = React.useEffect;
    useMemo = React.useMemo;
    startTransition = React.startTransition;

    const InternalTestUtils = require('internal-test-utils');
    waitForPaint = InternalTestUtils.waitForPaint;
    waitFor = InternalTestUtils.waitFor;
    assertLog = InternalTestUtils.assertLog;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;
  });

  /** 记录文本 render，并输出带 prop 标记的 span，供调度日志与宿主可见性双重断言。 */
  function Text(props) {
    Scheduler.log(props.text);
    return <span prop={props.text}>{props.children}</span>;
  }

  /**
   * Given LegacyHidden 使用 unstable-defer-without-hiding；When 首次挂载及 visible 往返更新；
   * Then 子树可降优先级 render，但宿主可见性从不切换。验证 LegacyHidden begin/completeWork 的不隐藏分支。
   */
  // @gate enableLegacyHidden
  it('unstable-defer-without-hiding should never toggle the visibility of its children', async () => {
    /** 用 mode 参数切换 LegacyHidden，同时保持 Normal/Deferred 两个可观察 sibling。 */
    function App({mode}) {
      return (
        <>
          <Text text="Normal" />
          <LegacyHidden mode={mode}>
            <Text text="Deferred" />
          </LegacyHidden>
        </>
      );
    }

    // 验证首次挂载。
    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<App mode="unstable-defer-without-hiding" />);
      await waitForPaint(['Normal']);
      expect(root).toMatchRenderedOutput(<span prop="Normal" />);
    });
    assertLog(['Deferred']);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="Normal" />
        <span prop="Deferred" />
      </>,
    );

    // 再验证更新后的行为。
    await act(() => {
      root.render(<App mode="visible" />);
    });
    assertLog(['Normal', 'Deferred']);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="Normal" />
        <span prop="Deferred" />
      </>,
    );

    await act(async () => {
      root.render(<App mode="unstable-defer-without-hiding" />);
      await waitForPaint(['Normal']);
      expect(root).toMatchRenderedOutput(
        <>
          <span prop="Normal" />
          <span prop="Deferred" />
        </>,
      );
    });
    assertLog(['Deferred']);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="Normal" />
        <span prop="Deferred" />
      </>,
    );
  });

  /**
   * Given Legacy Root 中的 hidden LegacyHidden；When 首次 render 与内部 state 更新；
   * Then hidden 工作不延迟且同步提交。验证 Legacy 模式不启用 Offscreen 并发降优先级。
   */
  // @gate enableLegacyHidden && !disableLegacyMode
  it('does not defer in legacy mode', async () => {
    let setState;
    /** 暴露 state setter 并记录当前值，验证 Legacy Root 中 hidden child 仍同步工作。 */
    function Foo() {
      const [state, _setState] = useState('A');
      setState = _setState;
      return <Text text={state} />;
    }

    const root = ReactNoop.createLegacyRoot();
    await act(() => {
      root.render(
        <>
          <LegacyHidden mode="hidden">
            <Foo />
          </LegacyHidden>
          <Text text="Outside" />
        </>,
      );

      ReactNoop.flushSync();

      // hidden 树不应被延迟。
      assertLog(['A', 'Outside']);
    });
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="Outside" />
      </>,
    );

    // 验证 children 后续仍可更新。
    await act(() => {
      setState('B');
    });
    assertLog(['B']);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="B" />
        <span prop="Outside" />
      </>,
    );
  });

  /**
   * Given Concurrent Root 中的 hidden LegacyHidden；When 同时 render 外部与隐藏内容；
   * Then 外部先 paint、隐藏树低优先级完成且后续可更新。验证 OffscreenLane 调度。
   */
  // @gate enableLegacyHidden
  it('does defer in concurrent mode', async () => {
    let setState;
    /** 暴露 hidden child 更新，并用 Text 日志区分外部 paint 与后台完成。 */
    function Foo() {
      const [state, _setState] = useState('A');
      setState = _setState;
      return <Text text={state} />;
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(
        <>
          <LegacyHidden mode="hidden">
            <Foo />
          </LegacyHidden>
          <Text text="Outside" />
        </>,
      );
      // hidden 树应被延迟。
      await waitForPaint(['Outside']);
    });

    // hidden 树随后以较低优先级完成 render。
    assertLog(['A']);

    expect(root).toMatchRenderedOutput(
      <>
        <span prop="A" />
        <span prop="Outside" />
      </>,
    );

    // 验证 children 后续仍可更新。
    await act(() => {
      setState('B');
    });
    assertLog(['B']);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="B" />
        <span prop="Outside" />
      </>,
    );
  });

  /**
   * Given Activity 首次以 hidden 挂载；When 后续揭示；Then hidden 期只预渲染，layout effect 到 visible 才 mount。
   * 验证日志与宿主 hidden 属性；对应 ReactFiberCommitEffects 的 visibility 门控。
   */
  it('mounts without layout effects when hidden', async () => {
    /** 带 layout effect 的最小子组件，用 mount 日志验证首次 hidden 预渲染不连接 effect。 */
    function Child({text}) {
      useLayoutEffect(() => {
        Scheduler.log('Mount layout');
        return () => {
          Scheduler.log('Unmount layout');
        };
      }, []);
      return <Text text="Child" />;
    }

    const root = ReactNoop.createRoot();

    // 挂载 hidden 树。
    await act(() => {
      root.render(
        <Activity mode="hidden">
          <Child />
        </Activity>,
      );
    });
    // hidden 期不执行 layout effect。
    assertLog(['Child']);
    expect(root).toMatchRenderedOutput(<span hidden={true} prop="Child" />);

    // 揭示树后挂载 layout effect。
    await act(() => {
      root.render(
        <Activity mode="visible">
          <Child />
        </Activity>,
      );
    });
    assertLog(['Child', 'Mount layout']);
    expect(root).toMatchRenderedOutput(<span prop="Child" />);
  });

  /**
   * Given Activity 从 visible 开始；When visible→hidden→visible；Then layout effect 按 mount→unmount→mount 重连。
   * 验证 Activity visibility commit 与 layout effect disconnect/reconnect。
   */
  it('mounts/unmounts layout effects when visibility changes (starting visible)', async () => {
    /** 记录 layout effect 连接与清理，覆盖 visible 起始的可见性往返。 */
    function Child({text}) {
      useLayoutEffect(() => {
        Scheduler.log('Mount layout');
        return () => {
          Scheduler.log('Unmount layout');
        };
      }, []);
      return <Text text="Child" />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <Activity mode="visible">
          <Child />
        </Activity>,
      );
    });
    assertLog(['Child', 'Mount layout']);
    expect(root).toMatchRenderedOutput(<span prop="Child" />);

    // 隐藏树并清理 layout effect。
    await act(() => {
      root.render(
        <Activity mode="hidden">
          <Child />
        </Activity>,
      );
    });
    assertLog(['Unmount layout', 'Child']);
    expect(root).toMatchRenderedOutput(<span hidden={true} prop="Child" />);

    // 再次揭示并重新挂载 layout effect。
    await act(() => {
      root.render(
        <Activity mode="visible">
          <Child />
        </Activity>,
      );
    });
    assertLog(['Child', 'Mount layout']);
    expect(root).toMatchRenderedOutput(<span prop="Child" />);
  });

  /**
   * Given 嵌套 Activity 以多种内外 visible/hidden 组合更新；When 同步切换内层可见性；
   * Then 类实例只断开可见 effects，不调用真正删除语义的 componentWillUnmount。验证嵌套 Offscreen unwind 边界。
   */
  it('nested offscreen does not call componentWillUnmount when hidden', async () => {
    // 该问题来自 <Activity /> 生产验证期间发现的回归。
    // 场景涉及嵌套 Offscreen：内层 Offscreen 在同步更新中
    // 从 visible 切到 hidden。
    /** 记录真实 mount/unmount 生命周期，防止嵌套 Activity 隐藏被误当成删除。 */
    class ClassComponent extends React.Component {
      /** 输出稳定 child，隔离生命周期观察。 */
      render() {
        return <Text text="child" />;
      }

      /** 真实删除时记录；单纯 hidden 切换不应调用。 */
      componentWillUnmount() {
        Scheduler.log('componentWillUnmount');
      }

      /** 首次可见提交时记录真实 mount。 */
      componentDidMount() {
        Scheduler.log('componentDidMount');
      }
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      // 外层与内层 Offscreen 都为 hidden。
      root.render(
        <Activity mode={'hidden'}>
          <Activity mode={'hidden'}>
            <ClassComponent />
          </Activity>
        </Activity>,
      );
    });

    assertLog(['child']);
    expect(root).toMatchRenderedOutput(<span hidden={true} prop="child" />);

    await act(() => {
      // 内层 Offscreen 为 visible。
      root.render(
        <Activity mode={'hidden'}>
          <Activity mode={'visible'}>
            <ClassComponent />
          </Activity>
        </Activity>,
      );
    });

    assertLog(['child']);
    expect(root).toMatchRenderedOutput(<span hidden={true} prop="child" />);

    await act(() => {
      // 内层 Offscreen 为 hidden。
      root.render(
        <Activity mode={'hidden'}>
          <Activity mode={'hidden'}>
            <ClassComponent />
          </Activity>
        </Activity>,
      );
    });

    assertLog(['child']);
    expect(root).toMatchRenderedOutput(<span hidden={true} prop="child" />);

    await act(() => {
      // 内层 Offscreen 为 visible。
      root.render(
        <Activity mode={'hidden'}>
          <Activity mode={'visible'}>
            <ClassComponent />
          </Activity>
        </Activity>,
      );
    });

    Scheduler.unstable_clearLog();

    await act(() => {
      // 外层 Offscreen 为 visible。
      // 内层 Offscreen 为 hidden。
      root.render(
        <Activity mode={'visible'}>
          <Activity mode={'hidden'}>
            <ClassComponent />
          </Activity>
        </Activity>,
      );
    });

    assertLog(['child']);

    await act(() => {
      // 外层 Offscreen 为 hidden。
      // 内层 Offscreen 为 visible。
      root.render(
        <Activity mode={'hidden'}>
          <Activity mode={'visible'}>
            <ClassComponent />
          </Activity>
        </Activity>,
      );
    });

    assertLog(['child']);
  });

  /**
   * Given Activity 从 hidden 开始；When hidden→visible→hidden；Then layout effect 只在可见窗口连接并在再隐藏时清理。
   * 验证首次预渲染与后续 visibility effects 共用正确状态机。
   */
  it('mounts/unmounts layout effects when visibility changes (starting hidden)', async () => {
    /** 记录从 hidden 初始状态开始的 layout effect 连接窗口。 */
    function Child({text}) {
      useLayoutEffect(() => {
        Scheduler.log('Mount layout');
        return () => {
          Scheduler.log('Unmount layout');
        };
      }, []);
      return <Text text="Child" />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      // 树以 hidden 开始，layout effect 尚未挂载。
      root.render(
        <Activity mode="hidden">
          <Child />
        </Activity>,
      );
    });
    assertLog(['Child']);
    expect(root).toMatchRenderedOutput(<span hidden={true} prop="Child" />);

    // 揭示树并挂载 layout effect。
    await act(() => {
      root.render(
        <Activity mode="visible">
          <Child />
        </Activity>,
      );
    });
    assertLog(['Child', 'Mount layout']);
    expect(root).toMatchRenderedOutput(<span prop="Child" />);

    // 再次隐藏树并清理 layout effect。
    await act(() => {
      root.render(
        <Activity mode="hidden">
          <Child />
        </Activity>,
      );
    });
    assertLog(['Unmount layout', 'Child']);
    expect(root).toMatchRenderedOutput(<span hidden={true} prop="Child" />);
  });

  /**
   * Given visible Activity 的 layout cleanup 会读取宿主树；When 切到 hidden；
   * Then cleanup 观察到尚可见节点，随后宿主才隐藏。验证 commit 阶段先断 layout effect、后 hide instance 的顺序。
   */
  it('hides children of offscreen after layout effects are destroyed', async () => {
    const root = ReactNoop.createRoot();
    /** cleanup 中读取 root 输出，证明宿主隐藏发生在 layout effect 销毁之后。 */
    function Child({text}) {
      useLayoutEffect(() => {
        Scheduler.log('Mount layout');
        return () => {
          // cleanup 执行时 child 尚不应隐藏。
          expect(root).toMatchRenderedOutput(<span prop="Child" />);
          Scheduler.log('Unmount layout');
        };
      }, []);
      return <Text text="Child" />;
    }

    await act(() => {
      root.render(
        <Activity mode="visible">
          <Child />
        </Activity>,
      );
    });
    assertLog(['Child', 'Mount layout']);
    expect(root).toMatchRenderedOutput(<span prop="Child" />);

    // 隐藏树并清理 layout effect。
    await act(() => {
      root.render(
        <Activity mode="hidden">
          <Child />
        </Activity>,
      );
    });
    assertLog(['Unmount layout', 'Child']);

    // layout effect 清理后才隐藏 child。
    expect(root).toMatchRenderedOutput(<span hidden={true} prop="Child" />);
  });

  /**
   * Given LegacyHidden 包含 layout effect；When visible/hidden 往返；Then effect 不随可见性断开，只在真实删除时 unmount。
   * 验证 LegacyHidden 与 Activity effect 语义的迁移差异。
   */
  // @gate enableLegacyHidden
  it('does not toggle effects for LegacyHidden component', async () => {
    // LegacyHidden 设计上接近 Offscreen，但不会
    // 操作 effects；它只作为 WWW 的临时迁移步骤。
    /** 记录 LegacyHidden visibility 往返中 layout effect 是否保持连接。 */
    function Child({text}) {
      useLayoutEffect(() => {
        Scheduler.log('Mount layout');
        return () => {
          Scheduler.log('Unmount layout');
        };
      }, []);
      return <Text text="Child" />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <LegacyHidden mode="visible">
          <Child />
        </LegacyHidden>,
      );
    });
    assertLog(['Child', 'Mount layout']);

    await act(() => {
      root.render(
        <LegacyHidden mode="hidden">
          <Child />
        </LegacyHidden>,
      );
    });
    assertLog(['Child']);

    await act(() => {
      root.render(
        <LegacyHidden mode="visible">
          <Child />
        </LegacyHidden>,
      );
    });
    assertLog(['Child']);

    await act(() => {
      root.render(null);
    });
    assertLog(['Unmount layout']);
  });

  /**
   * Given Activity 已 hidden；When 向其中插入新宿主 sibling；Then 新旧节点都带 hidden。
   * 验证 completeWork/commitPlacement 会继承隐藏祖先状态。
   */
  it('hides new insertions into an already hidden tree', async () => {
    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <Activity mode="hidden">
          <span>Hi</span>
        </Activity>,
      );
    });
    expect(root).toMatchRenderedOutput(<span hidden={true}>Hi</span>);

    // 向 hidden 树插入新节点。
    await act(() => {
      root.render(
        <Activity mode="hidden">
          <span>Hi</span>
          <span>Something new</span>
        </Activity>,
      );
    });
    expect(root).toMatchRenderedOutput(
      <>
        <span hidden={true}>Hi</span>
        {/* 新节点也必须被隐藏。 */}
        <span hidden={true}>Something new</span>
      </>,
    );
  });

  /**
   * Given 宿主节点位于 hidden Activity；When 更新自身 hidden prop、揭示边界再移除 prop；
   * Then Activity 隐藏优先于 prop，揭示后节点自身 prop 继续生效。验证 host visibility 两层来源。
   */
  it('hides updated nodes inside an already hidden tree', async () => {
    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <Activity mode="hidden">
          <span>Hi</span>
        </Activity>,
      );
    });
    expect(root).toMatchRenderedOutput(<span hidden={true}>Hi</span>);

    // 在已被 Activity 隐藏的节点上显式设置 `hidden` prop。
    await act(() => {
      root.render(
        <Activity mode="hidden">
          <span hidden={false}>Hi</span>
        </Activity>,
      );
    });
    // Activity 容器优先级更高，因此节点仍保持 hidden。
    expect(root).toMatchRenderedOutput(<span hidden={true}>Hi</span>);

    // 揭示 Activity 边界。
    await act(() => {
      root.render(
        <Activity mode="visible">
          <span hidden={true}>Hi</span>
        </Activity>,
      );
    });
    // 节点自身 prop 仍要求 hidden，因此继续隐藏。
    expect(root).toMatchRenderedOutput(<span hidden={true}>Hi</span>);

    // 移除节点自身的 `hidden` prop。
    await act(() => {
      root.render(
        <Activity mode="visible">
          <span>Hi</span>
        </Activity>,
      );
    });
    // 此时节点恢复可见。
    expect(root).toMatchRenderedOutput(<span>Hi</span>);
  });

  /**
   * Given hidden 树内外成对 state 更新跨多个 lane；When 新 transition 尚 pending 时同步揭示；
   * Then 只合并与已提交 outer 匹配的 inner 更新，始终无 tearing，稍后再共同收敛。
   * 验证 effect 读值与分片日志；对应 lane entanglement、Offscreen update rebasing。
   */
  it('revealing a hidden tree at high priority does not cause tearing', async () => {
    // 揭示 Offscreen 树时，需要纳入先前因隐藏而延迟的更新，
    // 即使它们比当前 render 优先级更低；但不能纳入与隐藏树外更新
    // 纠缠的低优先级更新，否则可能造成 tearing。
    // 该边界要求只提升可安全独立处理的隐藏更新。
    // 外部纠缠更新仍应留在原 lane 中。
    //
    // 本例覆盖隐藏树内多个更新共享同一 lane，
    // 却因调度时点不同而分批处理的场景。
    // 关键是揭示时不能越过已提交 outer 版本。

    // 此辅助函数检查输出中的 outer/inner state
    // 是否一致。
    let currentOuter = null;
    let currentInner = null;
    /** 当任一 effect 尚未连接时视为无 tearing；两者都有值时要求版本严格相等。 */
    function areOuterAndInnerConsistent() {
      return (
        currentOuter === null ||
        currentInner === null ||
        currentOuter === currentInner
      );
    }

    let setInner;
    /** 维护 hidden inner state，并用 passive effect 暴露已提交版本。 */
    function Child() {
      const [inner, _setInner] = useState(0);
      setInner = _setInner;

      useEffect(() => {
        currentInner = inner;
        return () => {
          currentInner = null;
        };
      }, [inner]);

      return <Text text={'Inner: ' + inner} />;
    }

    let setOuter;
    /** 维护 outer state，并把 Child 放入可同步揭示的 Activity。 */
    function App({show}) {
      const [outer, _setOuter] = useState(0);
      setOuter = _setOuter;

      useEffect(() => {
        currentOuter = outer;
        return () => {
          currentOuter = null;
        };
      }, [outer]);

      return (
        <>
          <Text text={'Outer: ' + outer} />
          <Activity mode={show ? 'visible' : 'hidden'}>
            <Child />
          </Activity>
        </>
      );
    }

    // 初始 render hidden 树。
    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App show={false} />);
    });
    assertLog(['Outer: 0', 'Inner: 0']);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="Outer: 0" />
        <span hidden={true} prop="Inner: 0" />
      </>,
    );
    expect(areOuterAndInnerConsistent()).toBe(true);

    await act(async () => {
      // 同时更新 hidden 树内外的值；两者
      // 必须始终一致。
      setOuter(1);
      setInner(1);
      // 因 inner 位于 hidden 树，只有 outer 更新先完成；
      // inner 更新被延迟到后续 render。
      await waitForPaint(['Outer: 1']);
      expect(root).toMatchRenderedOutput(
        <>
          <span prop="Outer: 1" />
          <span hidden={true} prop="Inner: 0" />
        </>,
      );

      // inner 更新完成前，又收到一组成对更新。
      React.startTransition(() => {
        setOuter(2);
        setInner(2);
      });

      // 新更新尚未处理时，hidden 树又被
      // 高优先级揭示。
      ReactNoop.flushSync(() => {
        root.render(<App show={true} />);
      });

      assertLog([
        'Outer: 1',

        // Inner 有两个 pending 更新，但这里只处理第一个；
        // 即使它们共享同一 lane，也不能越过 outer 的已提交版本。若误处理第二个，
        // Inner 将与 Outer 不一致，
        // 造成 tearing。
        'Inner: 1',
      ]);
      expect(root).toMatchRenderedOutput(
        <>
          <span prop="Outer: 1" />
          <span prop="Inner: 1" />
        </>,
      );
      expect(areOuterAndInnerConsistent()).toBe(true);
    });
    assertLog(['Outer: 2', 'Inner: 2']);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="Outer: 2" />
        <span prop="Inner: 2" />
      </>,
    );
    expect(areOuterAndInnerConsistent()).toBe(true);
  });

  /**
   * Given Activity 子树只完成部分 render 就被同步删除；When 从未挂载 Child 随后 setState；
   * Then hidden 祖先检测安全处理 stateNode=null，不崩溃。验证并发更新队列与未提交 Offscreen Fiber 边界。
   */
  it('regression: Activity instance is sometimes null during setState', async () => {
    let setState;
    /** 在部分 render 时暴露 setter，模拟从未 mount Fiber 删除后的迟到更新。 */
    function Child() {
      const [state, _setState] = useState('Initial');
      setState = _setState;
      return <Text text={state} />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<Activity />);
    });
    assertLog([]);
    expect(root).toMatchRenderedOutput(null);

    await act(async () => {
      // 只完成组件的部分 render。
      startTransition(() => {
        root.render(
          <Activity>
            <Child />
            <Text text="Sibling" />
          </Activity>,
        );
      });
      await waitFor(['Initial']);

      // render 完成前同步删除整棵树。
      ReactNoop.flushSync(() => {
        root.render(null);
      });

      // 随后尝试更新从未挂载的组件。该回归曾沿 return 链
      // 走到已卸载 Activity Fiber；其 `stateNode`
      // 在删除时已被置空，但访问前
      // 缺少 null 检查。虽然边界罕见，
      // 调度更新时仍必须安全处理。
      // 此断言防止再次解引用空 Activity 实例。
      setState('Updated');
      assertConsoleErrorDev([
        "Can't perform a React state update on a component that hasn't mounted yet. " +
          'This indicates that you have a side-effect in your render function that ' +
          'asynchronously tries to update the component. ' +
          'Move this work to useEffect instead.\n' +
          '    in Child (at **)',
      ]);
    });
    expect(root).toMatchRenderedOutput(null);
  });

  /**
   * Given hidden Activity 内类组件安排带 callback 的 setState；When 后台更新完成后再揭示；
   * Then callback 在 hidden 期不执行，只在可见提交时触发。验证类 update callback 的 visibility 门控。
   */
  it('class component setState callbacks do not fire until tree is visible', async () => {
    const root = ReactNoop.createRoot();

    let child;
    /** 隐藏期间接收更新并保存 callback 的类组件夹具。 */
    class Child extends React.Component {
      /** 文本状态从 A 开始，后续 B/C 更新带 callback。 */
      state = {text: 'A'};
      /** 暴露实例并输出当前文本。 */
      render() {
        child = this;
        return <Text text={this.state.text} />;
      }
    }

    // 初始 render。
    await act(() => {
      root.render(
        <Activity mode="hidden">
          <Child />
        </Activity>,
      );
    });
    assertLog(['A']);
    expect(root).toMatchRenderedOutput(<span hidden={true} prop="A" />);

    // 给 hidden 类组件安排更新；它会在后台完成 render，
    // 但组件尚不可见，因此 callback
    // 暂不能执行。
    await act(() => {
      child.setState({text: 'B'}, () => {
        Scheduler.log('B update finished');
      });
    });
    assertLog(['B']);
    expect(root).toMatchRenderedOutput(<span hidden={true} prop="B" />);

    // 揭示 hidden 组件时，同时再安排一个
    // 带 callback 的更新；组件可见后，B 与 C callback
    // 应按安排顺序执行。
    await act(() => {
      root.render(
        <Activity mode="visible">
          <Child />
        </Activity>,
      );
      child.setState({text: 'C'}, () => {
        Scheduler.log('C update finished');
      });
    });
    assertLog(['C', 'B update finished', 'C update finished']);
    expect(root).toMatchRenderedOutput(<span prop="C" />);
  });

  /**
   * Given 类组件先 visible、再 hidden、再 visible；When 揭示已预渲染实例；
   * Then 视为 effect 重连而非普通 update，不调用 componentDidUpdate。验证 Activity 重现的生命周期分类。
   */
  it('does not call componentDidUpdate when reappearing a hidden class component', async () => {
    /** 记录 mount/update/unmount 三类生命周期，区分 reappear 与普通 update。 */
    class Child extends React.Component {
      /** 可见提交或重新连接时记录 mount。 */
      componentDidMount() {
        Scheduler.log('componentDidMount');
      }
      /** 普通更新时记录；单纯重新出现不应调用。 */
      componentDidUpdate() {
        Scheduler.log('componentDidUpdate');
      }
      /** 隐藏导致 layout 生命周期断连时记录。 */
      componentWillUnmount() {
        Scheduler.log('componentWillUnmount');
      }
      /** 返回稳定文本，避免 props/state 更新混入。 */
      render() {
        return 'Child';
      }
    }

    // 初始挂载。
    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(
        <Activity mode="visible">
          <Child />
        </Activity>,
      );
    });
    assertLog(['componentDidMount']);

    // 隐藏类组件。
    await act(() => {
      root.render(
        <Activity mode="hidden">
          <Child />
        </Activity>,
      );
    });
    assertLog(['componentWillUnmount']);

    // 类组件重新出现时应调用 componentDidMount，而非
    // componentDidUpdate。
    await act(() => {
      root.render(
        <Activity mode="visible">
          <Child />
        </Activity>,
      );
    });
    assertLog(['componentDidMount']);
  });

  /**
   * Given 旧函数组件从 hidden 被复用并与新 siblings 一同出现；When Activity 揭示；
   * Then 其 layout effect 按树顺序夹在新 sibling effects 之间，等同全新挂载。验证 reappear traversal 顺序。
   */
  it(
    'when reusing old components (hidden -> visible), layout effects fire ' +
      'with same timing as if it were brand new',
    async () => {
      /** 以 label 标识 sibling，并记录 layout effect 在 reappear traversal 中的位置。 */
      function Child({label}) {
        useLayoutEffect(() => {
          Scheduler.log('Mount ' + label);
          return () => {
            Scheduler.log('Unmount ' + label);
          };
        }, [label]);
        return label;
      }

      // 初始挂载。
      const root = ReactNoop.createRoot();
      await act(() => {
        root.render(
          <Activity mode="visible">
            <Child key="B" label="B" />
          </Activity>,
        );
      });
      assertLog(['Mount B']);

      // 隐藏组件。
      await act(() => {
        root.render(
          <Activity mode="hidden">
            <Child key="B" label="B" />
          </Activity>,
        );
      });
      assertLog(['Unmount B']);

      // 让组件重新出现，同时插入新 siblings。
      await act(() => {
        root.render(
          <Activity mode="visible">
            <Child key="A" label="A" />
            <Child key="B" label="B" />
            <Child key="C" label="C" />
          </Activity>,
        );
      });
      // 即使 B 来自旧 render 的复用，其 effect 仍应在 A 与 C 之间执行，
      // 顺序等同三个 siblings
      // 全部首次挂载。
      assertLog(['Mount A', 'Mount B', 'Mount C']);
    },
  );

  /**
   * Given hidden 类组件保存 setState callback，揭示时同时插入新 siblings；When visible commit；
   * Then 复用组件的 mount effect 与 callback 按新树位置执行。验证 class callback 与 reappear layout 顺序。
   */
  it(
    'when reusing old components (hidden -> visible), layout effects fire ' +
      'with same timing as if it were brand new (includes setState callback)',
    async () => {
      /** 记录类 layout 生命周期，并允许通过保留实例安排 setState callback。 */
      class Child extends React.Component {
        /** 可见连接时按 label 记录 mount。 */
        componentDidMount() {
          Scheduler.log('Mount ' + this.props.label);
        }
        /** hidden 断连时记录 unmount。 */
        componentWillUnmount() {
          Scheduler.log('Unmount ' + this.props.label);
        }
        /** 输出 label，维持 sibling 顺序可见。 */
        render() {
          return this.props.label;
        }
      }

      // 初始挂载。
      const bRef = React.createRef();
      const root = ReactNoop.createRoot();
      await act(() => {
        root.render(
          <Activity mode="visible">
            <Child key="B" ref={bRef} label="B" />
          </Activity>,
        );
      });
      assertLog(['Mount B']);

      // 即将更新 hidden 组件，因此在 ref detach 前保存
      // 它的 setState 引用。
      const setStateB = bRef.current.setState.bind(bRef.current);

      // 隐藏组件。
      await act(() => {
        root.render(
          <Activity mode="hidden">
            <Child key="B" ref={bRef} label="B" />
          </Activity>,
        );
      });
      assertLog(['Unmount B']);

      // 让组件重新出现，同时插入新 siblings。
      await act(() => {
        setStateB(null, () => {
          Scheduler.log('setState callback B');
        });
        root.render(
          <Activity mode="visible">
            <Child key="A" label="A" />
            <Child key="B" ref={bRef} label="B" />
            <Child key="C" label="C" />
          </Activity>,
        );
      });
      // 即使 B 来自旧 render 的复用，其 effect 仍应在 A 与 C 之间执行，
      // 顺序等同三个 siblings
      // 全部首次挂载。
      assertLog(['Mount A', 'Mount B', 'setState callback B', 'Mount C']);
    },
  );

  /**
   * Given 新 Activity 内容以 hidden 预渲染；When shell 和 hidden 子树先后完成；Then shell passive effect 立即执行，
   * hidden effect 延迟到揭示。验证 passive effect disconnect 与 Offscreen 后台 render。
   */
  it('defer passive effects when prerendering a new Activity tree', async () => {
    /** 记录 Shell/More 的 passive effect，区分可见挂载与 hidden 预渲染。 */
    function Child({label}) {
      useEffect(() => {
        Scheduler.log('Mount ' + label);
        return () => {
          Scheduler.log('Unmount ' + label);
        };
      }, [label]);
      return <Text text={label} />;
    }

    /** 始终显示 Shell，并用 showMore 控制额外 Activity 内容。 */
    function App({showMore}) {
      return (
        <>
          <Child label="Shell" />
          <Activity mode={showMore ? 'visible' : 'hidden'}>
            <Child label="More" />
          </Activity>
        </>
      );
    }

    const root = ReactNoop.createRoot();

    // 挂载应用但不揭示额外内容。
    await act(() => {
      root.render(<App showMore={false} />);
    });
    assertLog([
      // 先挂载外层可见 shell。
      'Shell',
      'Mount Shell',

      // 再预渲染 hidden 额外内容；其中 passive effects
      // 不应执行。
      'More',
      // 不会执行：
      // 'Mount More',
    ]);
    // hidden 内容已完成预渲染。
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="Shell" />
        <span hidden={true} prop="More" />
      </>,
    );

    // 揭示已预渲染树。
    await act(() => {
      root.render(<App showMore={true} />);
    });
    assertLog([
      'Shell',
      'More',

      // 挂载新揭示树中预渲染期间
      // 被跳过的 passive effects。
      'Mount More',
    ]);
  });

  /**
   * Given LegacyHidden 以 defer-without-hiding 预渲染；When 额外内容完成；Then passive effect 不延迟并立即 mount。
   * 验证 LegacyHidden 不采用 Activity effect 断连语义。
   */
  // @gate enableLegacyHidden
  it('do not defer passive effects when prerendering a new LegacyHidden tree', async () => {
    /** 记录 LegacyHidden 子树 passive effect，作为 Activity 延迟行为的对照。 */
    function Child({label}) {
      useEffect(() => {
        Scheduler.log('Mount ' + label);
        return () => {
          Scheduler.log('Unmount ' + label);
        };
      }, [label]);
      return <Text text={label} />;
    }

    /** 以 LegacyHidden defer-without-hiding 预渲染 More 内容。 */
    function App({showMore}) {
      return (
        <>
          <Child label="Shell" />
          <LegacyHidden
            mode={showMore ? 'visible' : 'unstable-defer-without-hiding'}>
            <Child label="More" />
          </LegacyHidden>
        </>
      );
    }

    const root = ReactNoop.createRoot();

    // 挂载应用但不揭示额外内容。
    await act(() => {
      root.render(<App showMore={false} />);
    });
    assertLog([
      // 先挂载外层可见 shell。
      'Shell',
      'Mount Shell',

      // 再预渲染额外内容；与 Activity 不同，LegacyHidden 中 passive
      // effects 应立即执行。
      'More',
      'Mount More',
    ]);

    // hidden 内容已完成预渲染。
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="Shell" />
        <span prop="More" />
      </>,
    );

    // 揭示已预渲染树。
    await act(() => {
      root.render(<App showMore={true} />);
    });
    assertLog(['Shell', 'More']);
  });

  /**
   * Given visible Activity 已连接 step1 passive effect；When 隐藏、后台更新 step2、再揭示；
   * Then hide 清理 step1，后台不触发 effect，reveal 直接连接 step2 而不重渲染。验证 passive connectivity 状态机。
   */
  it('passive effects are connected and disconnected when the visibility changes', async () => {
    /** 用 step 标识 effect 版本，观察 hidden 后台更新是否触发连接。 */
    function Child({step}) {
      useEffect(() => {
        Scheduler.log(`Commit mount [${step}]`);
        return () => {
          Scheduler.log(`Commit unmount [${step}]`);
        };
      }, [step]);
      return <Text text={step} />;
    }

    /** memoize Child，使揭示已预渲染 step 时无需再次 render。 */
    function App({show, step}) {
      return (
        <Activity mode={show ? 'visible' : 'hidden'}>
          {useMemo(
            () => (
              <Child step={step} />
            ),
            [step],
          )}
        </Activity>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App show={true} step={1} />);
    });
    assertLog([1, 'Commit mount [1]']);
    expect(root).toMatchRenderedOutput(<span prop={1} />);

    // 隐藏树并清理 effect。
    await act(() => {
      root.render(<App show={false} step={1} />);
    });
    assertLog(['Commit unmount [1]']);
    expect(root).toMatchRenderedOutput(<span hidden={true} prop={1} />);

    // 执行更新。
    await act(() => {
      root.render(<App show={false} step={2} />);
    });
    // 更新在后台预渲染，但不触发 effects。
    assertLog([2]);
    expect(root).toMatchRenderedOutput(<span hidden={true} prop={2} />);

    // 揭示树。
    await act(() => {
      root.render(<App show={true} step={2} />);
    });
    // 更新已预渲染，因此揭示时不再 render，
    // 但会连接 effect。
    assertLog(['Commit mount [2]']);
    expect(root).toMatchRenderedOutput(<span prop={2} />);
  });

  /**
   * Given Parent/Child 都有 passive effect；When 先真实删除、再用 hide 重做；
   * Then 两种路径都按 Parent→Child 清理。验证 disconnectPassiveEffect 与 deletion traversal 顺序一致。
   */
  it('passive effects are unmounted on hide in the same order as during a deletion: parent before child', async () => {
    /** 记录子级 passive effect，用于和父级 cleanup 顺序比较。 */
    function Child({label}) {
      useEffect(() => {
        Scheduler.log('Mount Child');
        return () => {
          Scheduler.log('Unmount Child');
        };
      }, []);
      return <div>Hi</div>;
    }
    /** 包裹 Child 并记录父级 passive effect。 */
    function Parent() {
      useEffect(() => {
        Scheduler.log('Mount Parent');
        return () => {
          Scheduler.log('Unmount Parent');
        };
      }, []);
      return <Child />;
    }

    /** 用 Activity 可见性在 hide 与真实 deletion 间建立相同树结构。 */
    function App({show}) {
      return (
        <Activity mode={show ? 'visible' : 'hidden'}>
          <Parent />
        </Activity>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App show={true} />);
    });
    assertLog(['Mount Child', 'Mount Parent']);

    // 先展示普通 deletion 的清理顺序。
    await act(() => {
      root.render(null);
    });
    assertLog(['Unmount Parent', 'Unmount Child']);

    // 再用 hide 代替 deletion 重做。
    await act(() => {
      root.render(<App show={true} />);
    });
    assertLog(['Mount Child', 'Mount Parent']);
    await act(() => {
      root.render(<App show={false} />);
    });
    // 顺序与 deletion 相同：父级先于子级。
    assertLog(['Unmount Parent', 'Unmount Child']);
  });

  // TODO：当前无法在隐藏树时保持其
  // effects 继续连接；Suspense 例外且有独立测试。
  // 支持该能力后应重新启用本测试；可能通过 option 或 heuristic，
  // 在延迟后挂载 hidden 树中的 passive effects，
  // 同时保持树不可见。
  /**
   * Given effects 已连接的 Activity 同时更新并隐藏；When 未来支持隐藏但保持 effects 连接；
   * Then 更新不应延迟 effect。当前缺少该模式，因此用例保持 skip，作为预期语义规格。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip("don't defer passive effects when prerendering in a tree whose effects are already connected", async () => {
    /** 记录 effects 已连接后隐藏更新时的理想生命周期。 */
    function Child({label}) {
      useEffect(() => {
        Scheduler.log('Mount ' + label);
        return () => {
          Scheduler.log('Unmount ' + label);
        };
      }, [label]);
      return <Text text={label} />;
    }

    /** 同时推进 shell/extra 版本，并控制 Activity visibility。 */
    function App({showMore, step}) {
      return (
        <>
          <Child label={'Shell ' + step} />
          <Activity mode={showMore ? 'visible' : 'hidden'}>
            <Child label={'More ' + step} />
          </Activity>
        </>
      );
    }

    const root = ReactNoop.createRoot();

    // 挂载应用及额外内容。
    await act(() => {
      root.render(<App showMore={true} step={1} />);
    });
    assertLog(['Shell 1', 'More 1', 'Mount Shell 1', 'Mount More 1']);
    expect(root).toMatchRenderedOutput(
      <>
        <span prop="Shell 1" />
        <span prop="More 1" />
      </>,
    );

    // 隐藏额外内容，同时更新其 prop。
    await act(() => {
      root.render(<App showMore={false} step={2} />);
    });
    assertLog([
      // 先更新外部可见 shell。
      'Shell 2',
      'Unmount Shell 1',
      'Mount Shell 2',

      // 再预渲染 hidden 内容更新；因内部 effects
      // 已连接，不延迟它们的
      // 更新。
      'More 2',
      'Unmount More 1',
      'Mount More 2',
    ]);
  });

  /**
   * Given outer Activity hidden 且随后插入 visible inner Activity；When 两层都仅预渲染；
   * Then 内外 effects 均不 mount，outer 揭示时一次按树序连接。验证隐藏祖先覆盖内层 visible。
   */
  it('does not mount effects when prerendering a nested Activity boundary', async () => {
    /** 以 label 区分 outer/inner passive effect 是否提前 mount。 */
    function Child({label}) {
      useEffect(() => {
        Scheduler.log('Mount ' + label);
        return () => {
          Scheduler.log('Unmount ' + label);
        };
      }, [label]);
      return <Text text={label} />;
    }

    /** 在 hidden outer 中按 showInner 动态插入 visible inner Activity。 */
    function App({showOuter, showInner}) {
      return (
        <Activity mode={showOuter ? 'visible' : 'hidden'}>
          {useMemo(
            () => (
              <div>
                <Child label="Outer" />
                {showInner ? (
                  <Activity mode="visible">
                    <div>
                      <Child label="Inner" />
                    </div>
                  </Activity>
                ) : null}
              </div>
            ),
            [showInner],
          )}
        </Activity>
      );
    }

    const root = ReactNoop.createRoot();

    // 预渲染 outer 内容，不应挂载 effects。
    await act(() => {
      root.render(<App showOuter={false} showInner={false} />);
    });
    assertLog(['Outer']);
    expect(root).toMatchRenderedOutput(
      <div hidden={true}>
        <span prop="Outer" />
      </div>,
    );

    // 预渲染 inner 内容，同样不应挂载 effects。
    await act(() => {
      root.render(<App showOuter={false} showInner={true} />);
    });
    assertLog(['Outer', 'Inner']);
    expect(root).toMatchRenderedOutput(
      <div hidden={true}>
        <span prop="Outer" />
        <div>
          <span prop="Inner" />
        </div>
      </div>,
    );

    // 揭示已预渲染树。
    await act(() => {
      root.render(<App showOuter={true} showInner={true} />);
    });
    // 揭示时连接 effects，但树已预渲染，
    // 因此不重新 render。
    assertLog(['Mount Outer', 'Mount Inner']);
    expect(root).toMatchRenderedOutput(
      <div>
        <span prop="Outer" />
        <div>
          <span prop="Inner" />
        </div>
      </div>,
    );
  });

  /**
   * Given outer/inner Activity 都 hidden 且已预渲染；When 只揭示 outer；Then outer effect 连接，inner 继续 hidden 且不连接。
   * 验证 visibility traversal 可跳过独立隐藏子边界。
   */
  it('reveal an outer Activity boundary without revealing an inner one', async () => {
    /** 记录 outer 与 inner effect，证明只连接被揭示层级。 */
    function Child({label}) {
      useEffect(() => {
        Scheduler.log('Mount ' + label);
        return () => {
          Scheduler.log('Unmount ' + label);
        };
      }, [label]);
      return <Text text={label} />;
    }

    /** 分别控制嵌套 Activity visibility，并 memoize 内部树。 */
    function App({showOuter, showInner}) {
      return (
        <Activity mode={showOuter ? 'visible' : 'hidden'}>
          {useMemo(
            () => (
              <div>
                <Child label="Outer" />
                <Activity mode={showInner ? 'visible' : 'hidden'}>
                  <div>
                    <Child label="Inner" />
                  </div>
                </Activity>
              </div>
            ),
            [showInner],
          )}
        </Activity>
      );
    }

    const root = ReactNoop.createRoot();

    // 预渲染整棵树。
    await act(() => {
      root.render(<App showOuter={false} showInner={false} />);
    });
    assertLog(['Outer', 'Inner']);
    // inner 与 outer 都应 hidden。重复隐藏 inner 看似多余，
    // 但能在揭示 outer 时
    // 无需检查 inner 子树。
    expect(root).toMatchRenderedOutput(
      <div hidden={true}>
        <span prop="Outer" />
        <div hidden={true}>
          <span prop="Inner" />
        </div>
      </div>,
    );

    // 揭示 outer 内容，inner 继续 hidden。
    await act(() => {
      root.render(<App showOuter={true} showInner={false} />);
    });
    assertLog(['Mount Outer']);
    expect(root).toMatchRenderedOutput(
      <div>
        <span prop="Outer" />
        <div hidden={true}>
          <span prop="Inner" />
        </div>
      </div>,
    );
  });

  /**
   * Given 同一 memoized host child 同时受 outer/inner Activity 隐藏；When 只揭示 inner；
   * Then outer 在向上完成时仍保持宿主 hidden。验证无 host update 时父隐藏状态不会被内层揭示覆盖。
   */
  it('reveal an inner Activity boundary without revealing an outer one on the same host child', async () => {
    // 复用同一元素可确保不安排 host update；否则父级向上完成时重新隐藏 child，
    // 可能掩盖该错误。
    const memoizedElement = <div />;
    /** 让两个 Activity 共享 memoized host child，隔离纯 visibility 更新。 */
    function App({showOuter, showInner}) {
      return (
        <Activity mode={showOuter ? 'visible' : 'hidden'} name="Outer">
          <Activity mode={showInner ? 'visible' : 'hidden'} name="Inner">
            {memoizedElement}
          </Activity>
        </Activity>
      );
    }

    const root = ReactNoop.createRoot();

    // 预渲染整棵树。
    await act(() => {
      root.render(<App showOuter={false} showInner={false} />);
    });
    expect(root).toMatchRenderedOutput(<div hidden={true} />);

    await act(() => {
      root.render(<App showOuter={false} showInner={true} />);
    });
    expect(root).toMatchRenderedOutput(<div hidden={true} />);
  });

  /**
   * Given outer Activity hidden、内层 Suspense 在同一 memoized host child 上挂起/恢复；When 内层反复 resuspend/reveal；
   * Then 宿主始终受 outer 隐藏。验证 Suspense visibility 更新不会穿透 Activity 祖先。
   */
  it('reveal an inner Suspense boundary without revealing an outer Activity on the same host child', async () => {
    // 复用同一元素可确保不安排 host update；否则父级向上完成时重新隐藏 child，
    // 可能掩盖该错误。
    const memoizedElement = <div />;
    const promise = new Promise(() => {});
    /** 在 hidden Activity 内控制 Suspense thenable 是否出现，共享同一 host child。 */
    function App({showOuter, showInner}) {
      return (
        <Activity mode={showOuter ? 'visible' : 'hidden'} name="Outer">
          <Suspense name="Inner">
            {memoizedElement}
            {showInner ? null : promise}
          </Suspense>
        </Activity>
      );
    }

    const root = ReactNoop.createRoot();

    // 预渲染整棵树。
    await act(() => {
      root.render(<App showOuter={false} showInner={true} />);
    });
    expect(root).toMatchRenderedOutput(<div hidden={true} />);

    // 让 inner 再次挂起。
    await act(() => {
      root.render(<App showOuter={false} showInner={false} />);
    });
    expect(root).toMatchRenderedOutput(<div hidden={true} />);

    await act(() => {
      root.render(<App showOuter={false} showInner={true} />);
    });
    expect(root).toMatchRenderedOutput(<div hidden={true} />);
  });

  /**
   * Given Activity 内 useInsertionEffect 已 mount；When hide、后台更新、reveal；
   * Then hide/reveal 不断连 insertion effect，依赖变化仍正常 unmount/mount。验证 insertion effect 不受可见性连接状态控制。
   */
  it('insertion effects are not disconnected when the visibility changes', async () => {
    /** 用 step 标识 insertion effect 依赖更新及 cleanup/mount。 */
    function Child({step}) {
      useInsertionEffect(() => {
        Scheduler.log(`Commit mount [${step}]`);
        return () => {
          Scheduler.log(`Commit unmount [${step}]`);
        };
      }, [step]);
      return <Text text={step} />;
    }

    /** memoize Child，使 visibility 切换与依赖更新可独立观察。 */
    function App({show, step}) {
      return (
        <Activity mode={show ? 'visible' : 'hidden'}>
          {useMemo(
            () => (
              <Child step={step} />
            ),
            [step],
          )}
        </Activity>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App show={true} step={1} />);
    });
    assertLog([1, 'Commit mount [1]']);
    expect(root).toMatchRenderedOutput(<span prop={1} />);

    // 隐藏树，但不清理 insertion effects。
    await act(() => {
      root.render(<App show={false} step={1} />);
    });
    assertLog([]);
    expect(root).toMatchRenderedOutput(<span hidden={true} prop={1} />);

    // 执行更新。
    await act(() => {
      root.render(<App show={false} step={2} />);
    });
    // 更新在后台预渲染，因此依赖变化仍触发 insertion effects。
    assertLog([2, 'Commit unmount [1]', 'Commit mount [2]']);
    expect(root).toMatchRenderedOutput(<span hidden={true} prop={2} />);

    // 揭示树。
    await act(() => {
      root.render(<App show={true} step={2} />);
    });
    // 更新已预渲染且 insertion effect 已执行，
    // 揭示时无需任何工作。
    assertLog([]);
    expect(root).toMatchRenderedOutput(<span prop={2} />);
  });

  /**
   * Given 带 snapshot/update 生命周期的类组件位于 Activity；When hide、hidden setState、再 reveal；
   * Then hidden 与重现路径不应读取 snapshot，而只按 mount 语义恢复。验证 before-mutation visibility 门控。
   */
  it('getSnapshotBeforeUpdate does not run in hidden trees', async () => {
    let setState;

    /** 记录 snapshot、update、mount、unmount 的类组件，用于 hidden before-mutation 门控。 */
    class Child extends React.Component {
      /** 根据前后 value 构造 snapshot，并记录调用。 */
      getSnapshotBeforeUpdate(prevProps) {
        const snapshot = `snapshot-${prevProps.value}-to-${this.props.value}`;
        Scheduler.log(`getSnapshotBeforeUpdate: ${snapshot}`);
        return snapshot;
      }
      /** 记录 update 收到的 snapshot；hidden/reappear 路径不应调用。 */
      componentDidUpdate(prevProps, prevState, snapshot) {
        Scheduler.log(`componentDidUpdate: ${snapshot}`);
      }
      /** 首次可见或 reappear mount 时记录。 */
      componentDidMount() {
        Scheduler.log('componentDidMount');
      }
      /** 隐藏断连 layout 生命周期时记录。 */
      componentWillUnmount() {
        Scheduler.log('componentWillUnmount');
      }
      /** 记录当前 value 并输出宿主 span。 */
      render() {
        Scheduler.log(`render: ${this.props.value}`);
        return <span prop={this.props.value} />;
      }
    }

    /** 管理 Child value，并用 show 控制 Activity visibility。 */
    function Wrapper({show}) {
      const [value, _setState] = useState(1);
      setState = _setState;
      return (
        <Activity mode={show ? 'visible' : 'hidden'}>
          <Child value={value} />
        </Activity>
      );
    }

    const root = ReactNoop.createRoot();

    // 初始 render。
    await act(() => {
      root.render(<Wrapper show={true} />);
    });
    assertLog(['render: 1', 'componentDidMount']);

    // 隐藏 Activity。
    await act(() => {
      root.render(<Wrapper show={false} />);
    });
    assertLog([
      'componentWillUnmount',
      'render: 1',
      // 回归保护：hidden 树无需读取 snapshot。
      ...(gate('enableViewTransition')
        ? []
        : ['getSnapshotBeforeUpdate: snapshot-1-to-1']),
    ]);

    // 在 hidden 期间调用 setState 触发更新。
    await act(() => {
      setState(2);
    });
    assertLog([
      'render: 2',
      ...(gate('enableViewTransition')
        ? []
        : ['getSnapshotBeforeUpdate: snapshot-1-to-2']),
    ]);

    // 重新出现按新 mount 处理，因此同样不应读取 snapshot。
    await act(() => {
      root.render(<Wrapper show={true} />);
    });
    assertLog([
      'render: 2',
      ...(gate('enableViewTransition')
        ? []
        : ['getSnapshotBeforeUpdate: snapshot-2-to-2']),
      'componentDidMount',
    ]);
  });

  /**
   * Given 调用方错误向 Activity 传 hidden prop；When DEV render；Then 输出迁移到 mode="hidden" 的精确警告。
   * 验证 ReactFiberActivityComponent 的 props 校验与组件栈。
   */
  it('warns if you pass a hidden prop', async () => {
    /** 故意传入不支持的 hidden prop，触发 DEV 迁移警告。 */
    function App() {
      return (
        // eslint-disable-next-line react/jsx-boolean-value
        <Activity hidden>
          <div />
        </Activity>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App show={true} step={1} />);
    });
    assertConsoleErrorDev([
      '<Activity> doesn\'t accept a hidden prop. Use mode="hidden" instead.\n' +
        '- <Activity hidden>\n' +
        '+ <Activity mode="hidden">\n' +
        '    in Activity (at **)\n' +
        '    in App (at **)',
    ]);
  });
});
