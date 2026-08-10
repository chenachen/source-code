let React;
let startTransition;
let ReactNoop;
let resolveSuspenseyThing;
let getSuspenseyThingStatus;
let Suspense;
let Activity;
let SuspenseList;
let useMemo;
let Scheduler;
let act;
let assertLog;
let waitForPaint;

/** 覆盖宿主资源在提交阶段挂起、被打断、预渲染和副作用刷新时的可见性语义。 */
describe('ReactSuspenseyCommitPhase', () => {
  /** 重建渲染器，并取得 suspensey 宿主资源的状态查询与完成控制器。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    Suspense = React.Suspense;
    if (gate(flags => flags.enableSuspenseList)) {
      SuspenseList = React.unstable_SuspenseList;
    }
    Activity = React.Activity;
    useMemo = React.useMemo;
    startTransition = React.startTransition;
    resolveSuspenseyThing = ReactNoop.resolveSuspenseyThing;
    getSuspenseyThingStatus = ReactNoop.getSuspenseyThingStatus;

    const InternalTestUtils = require('internal-test-utils');
    act = InternalTestUtils.act;
    assertLog = InternalTestUtils.assertLog;
    waitForPaint = InternalTestUtils.waitForPaint;
  });

  /** 记录渲染顺序并返回同名文本，作为提交前后可见输出的探针。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** 创建一个提交时可能挂起的宿主图片，并记录 React 何时开始请求资源。 */
  function SuspenseyImage({src}) {
    return (
      <suspensey-thing
        src={src}
        timeout={100}
        onLoadStart={() => Scheduler.log(`Image requested [${src}]`)}
      />
    );
  }

  /**
   * 场景（Given–When–Then）：给定未加载的 A 在 transition 初次挂载且位于 Suspense 内；
   * 当提交等待 A；那么先提交 fallback，A 完成后同步切换为图片。
   * 对应机制：suspensey 宿主实例的提交阶段资源门闩与边界回退。
   */
  // @gate enableSuspenseyImages
  it('suspend commit during initial mount', async () => {
    const root = ReactNoop.createRoot();
    await act(async () => {
      startTransition(() => {
        root.render(
          <Suspense fallback={<Text text="Loading..." />}>
            <SuspenseyImage src="A" />
          </Suspense>,
        );
      });
    });
    assertLog(['Image requested [A]', 'Loading...']);
    expect(getSuspenseyThingStatus('A')).toBe('pending');
    expect(root).toMatchRenderedOutput('Loading...');

    // 完成资源会同步释放提交门闩，无需额外调度一次渲染。
    resolveSuspenseyThing('A');
    expect(root).toMatchRenderedOutput(<suspensey-thing src="A" />);
  });

  /**
   * 场景（Given–When–Then）：给定已显示 A 的边界更新为未加载 B；当 transition 尝试提交；
   * 那么保留 A 而不闪现 fallback，B 完成后同步替换。对应机制：已可见树的延迟提交。
   */
  // @gate enableSuspenseyImages
  it('suspend commit during update', async () => {
    const root = ReactNoop.createRoot();
    await act(() => resolveSuspenseyThing('A'));
    await act(async () => {
      startTransition(() => {
        root.render(
          <Suspense fallback={<Text text="Loading..." />}>
            <SuspenseyImage src="A" />
          </Suspense>,
        );
      });
    });
    expect(root).toMatchRenderedOutput(<suspensey-thing src="A" />);

    // 图片位于已可见树中且新 src 尚未加载，因此 transition 必须暂停提交。
    await act(async () => {
      startTransition(() => {
        root.render(
          <Suspense fallback={<Text text="Loading..." />}>
            <SuspenseyImage src="B" />
          </Suspense>,
        );
      });
    });
    assertLog(['Image requested [B]']);
    expect(getSuspenseyThingStatus('B')).toBe('pending');
    // 挂起期间保留上一屏 A。
    expect(root).toMatchRenderedOutput(<suspensey-thing src="A" />);

    // B 完成后同步提交已准备好的树。
    resolveSuspenseyThing('B');
    expect(root).toMatchRenderedOutput(<suspensey-thing src="B" />);
  });

  /**
   * 场景（Given–When–Then）：给定根节点直接 transition 挂载未加载 A；当没有 Suspense
   * 可承接回退；那么根保持空白，资源完成后才提交 A。对应机制：根级提交阶段挂起。
   */
  // @gate enableSuspenseyImages
  it('suspend commit during initial mount at the root', async () => {
    const root = ReactNoop.createRoot();
    await act(async () => {
      startTransition(() => {
        root.render(<SuspenseyImage src="A" />);
      });
    });
    assertLog(['Image requested [A]']);
    expect(getSuspenseyThingStatus('A')).toBe('pending');
    expect(root).toMatchRenderedOutput(null);

    resolveSuspenseyThing('A');
    expect(getSuspenseyThingStatus('A')).toBe('fulfilled');
    expect(root).toMatchRenderedOutput(<suspensey-thing src="A" />);
  });

  /**
   * 场景（Given–When–Then）：给定根已显示 A 并 transition 更新到未加载 B；当 B 仍 pending；
   * 那么根继续显示 A，B fulfilled 后替换。对应机制：根级更新保留上一提交。
   */
  // @gate enableSuspenseyImages
  it('suspend commit during update at the root', async () => {
    const root = ReactNoop.createRoot();
    await act(() => resolveSuspenseyThing('A'));
    expect(getSuspenseyThingStatus('A')).toBe('fulfilled');
    expect(root).toMatchRenderedOutput(null);
    await act(async () => {
      startTransition(() => {
        root.render(<SuspenseyImage src="A" />);
      });
    });
    expect(root).toMatchRenderedOutput(<suspensey-thing src="A" />);

    await act(async () => {
      startTransition(() => {
        root.render(<SuspenseyImage src="B" />);
      });
    });
    assertLog(['Image requested [B]']);
    expect(getSuspenseyThingStatus('B')).toBe('pending');
    expect(root).toMatchRenderedOutput(<suspensey-thing src="A" />);

    resolveSuspenseyThing('B');
    expect(getSuspenseyThingStatus('B')).toBe('fulfilled');
    expect(root).toMatchRenderedOutput(<suspensey-thing src="B" />);
  });

  /**
   * 场景（Given–When–Then）：给定紧急初次挂载未加载 A 且有 Suspense；当提交被资源阻塞；
   * 那么可先显示 fallback，完成后显示 A。对应机制：同步优先级与边界回退协作。
   */
  // @gate enableSuspenseyImages
  it('suspend commit during urgent initial mount', async () => {
    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(
        <Suspense fallback={<Text text="Loading..." />}>
          <SuspenseyImage src="A" />
        </Suspense>,
      );
    });
    assertLog(['Image requested [A]', 'Loading...']);
    expect(getSuspenseyThingStatus('A')).toBe('pending');
    expect(root).toMatchRenderedOutput('Loading...');

    resolveSuspenseyThing('A');
    expect(getSuspenseyThingStatus('A')).toBe('fulfilled');
    expect(root).toMatchRenderedOutput(<suspensey-thing src="A" />);
  });

  /**
   * 场景（Given–When–Then）：给定紧急更新把边界内 A 换成未加载 B；当 B 挂起提交；
   * 那么旧 A 被隐藏并显示 fallback，B 完成后移除回退。对应机制：紧急更新不保留上一屏。
   */
  // @gate enableSuspenseyImages
  it('suspend commit during urgent update', async () => {
    const root = ReactNoop.createRoot();
    await act(() => resolveSuspenseyThing('A'));
    expect(getSuspenseyThingStatus('A')).toBe('fulfilled');
    await act(async () => {
      root.render(
        <Suspense fallback={<Text text="Loading..." />}>
          <SuspenseyImage src="A" />
        </Suspense>,
      );
    });
    expect(root).toMatchRenderedOutput(<suspensey-thing src="A" />);

    resolveSuspenseyThing('A');
    expect(getSuspenseyThingStatus('A')).toBe('fulfilled');
    expect(root).toMatchRenderedOutput(<suspensey-thing src="A" />);

    await act(async () => {
      root.render(
        <Suspense fallback={<Text text="Loading..." />}>
          <SuspenseyImage src="B" />
        </Suspense>,
      );
    });
    assertLog(['Image requested [B]', 'Loading...']);
    expect(getSuspenseyThingStatus('B')).toBe('pending');
    expect(root).toMatchRenderedOutput(
      <>
        <suspensey-thing src="A" hidden={true} />
        {'Loading...'}
      </>,
    );

    resolveSuspenseyThing('B');
    expect(getSuspenseyThingStatus('B')).toBe('fulfilled');
    expect(root).toMatchRenderedOutput(<suspensey-thing src="B" />);
  });

  /**
   * 场景（Given–When–Then）：给定根上紧急初次挂载未加载 A；当无边界可显示回退；
   * 那么根保持空，资源完成后提交图片。对应机制：无边界的根级提交门闩。
   */
  // @gate enableSuspenseyImages
  it('suspends commit during urgent initial mount at the root', async () => {
    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<SuspenseyImage src="A" />);
    });
    assertLog(['Image requested [A]']);
    expect(getSuspenseyThingStatus('A')).toBe('pending');
    expect(root).toMatchRenderedOutput(null);

    resolveSuspenseyThing('A');
    expect(getSuspenseyThingStatus('A')).toBe('fulfilled');
    expect(root).toMatchRenderedOutput(<suspensey-thing src="A" />);
  });

  /**
   * 场景（Given–When–Then）：给定根已显示 A 并紧急更新为未加载 B；当 B pending；
   * 那么仍显示 A，完成后切换 B。对应机制：根级提交暂停而非清空当前树。
   */
  // @gate enableSuspenseyImages
  it('suspends commit during urgent update at the root', async () => {
    const root = ReactNoop.createRoot();
    await act(() => resolveSuspenseyThing('A'));
    expect(getSuspenseyThingStatus('A')).toBe('fulfilled');
    expect(root).toMatchRenderedOutput(null);
    await act(async () => {
      root.render(<SuspenseyImage src="A" />);
    });
    expect(root).toMatchRenderedOutput(<suspensey-thing src="A" />);

    await act(async () => {
      root.render(<SuspenseyImage src="B" />);
    });
    assertLog(['Image requested [B]']);
    expect(getSuspenseyThingStatus('B')).toBe('pending');
    expect(root).toMatchRenderedOutput(<suspensey-thing src="A" />);

    resolveSuspenseyThing('B');
    expect(getSuspenseyThingStatus('B')).toBe('fulfilled');
    expect(root).toMatchRenderedOutput(<suspensey-thing src="B" />);
  });

  /**
   * 场景（Given–When–Then）：给定 flushSync 初次挂载未加载 A；当同步 render 结束；
   * 那么提交仍可被宿主资源暂停且根为空，A 完成后再显示。对应机制：同步渲染不绕过资源门闩。
   */
  // @gate enableSuspenseyImages
  it('does suspend commit during urgent initial mount at the root when sync rendering', async () => {
    const root = ReactNoop.createRoot();
    await act(async () => {
      ReactNoop.flushSync(() => {
        root.render(<SuspenseyImage src="A" />);
      });
    });
    assertLog(['Image requested [A]']);
    expect(getSuspenseyThingStatus('A')).toBe('pending');
    // 同步渲染完成，但初次提交仍被暂停。
    expect(root).toMatchRenderedOutput(null);

    resolveSuspenseyThing('A');
    expect(getSuspenseyThingStatus('A')).toBe('fulfilled');
    expect(root).toMatchRenderedOutput(<suspensey-thing src="A" />);
  });

  /**
   * 场景（Given–When–Then）：给定根用 flushSync 从已加载 A 更新到未加载 B；当同步工作完成；
   * 那么提交暂停并保留 A，B 完成后替换。对应机制：同步更新和可恢复上一提交。
   */
  // @gate enableSuspenseyImages
  it('does suspend commit during urgent update at the root when sync rendering', async () => {
    const root = ReactNoop.createRoot();
    await act(() => resolveSuspenseyThing('A'));
    expect(getSuspenseyThingStatus('A')).toBe('fulfilled');
    expect(root).toMatchRenderedOutput(null);
    await act(async () => {
      ReactNoop.flushSync(() => {
        root.render(<SuspenseyImage src="A" />);
      });
    });
    expect(root).toMatchRenderedOutput(<suspensey-thing src="A" />);

    await act(async () => {
      ReactNoop.flushSync(() => {
        root.render(<SuspenseyImage src="B" />);
      });
    });
    assertLog(['Image requested [B]']);
    expect(getSuspenseyThingStatus('B')).toBe('pending');
    // 暂停本次提交并保留上一屏 A。
    expect(root).toMatchRenderedOutput(<suspensey-thing src="A" />);

    resolveSuspenseyThing('B');
    expect(getSuspenseyThingStatus('B')).toBe('fulfilled');
    expect(root).toMatchRenderedOutput(<suspensey-thing src="B" />);
  });

  /**
   * 场景（Given–When–Then）：给定根有一个因 A 未加载而暂停的 transition 提交；当紧急更新
   * 改为普通文本；那么废弃等待中的图片树并立即显示新文本。对应机制：更高优先级工作中断提交。
   */
  // @gate enableSuspenseyImages
  it('an urgent update interrupts a suspended commit', async () => {
    const root = ReactNoop.createRoot();

    // 图片不在 Suspense 边界内，因此这次 transition 会在根提交阶段暂停。
    await act(() => {
      startTransition(() => {
        root.render(<SuspenseyImage src="A" />);
      });
    });
    assertLog(['Image requested [A]']);
    // 尚无可提交的内容。
    expect(root).toMatchRenderedOutput(null);

    // 后来的紧急更新应中断等待资源的提交。
    await act(() => {
      root.render(<Text text="Something else" />);
    });
    assertLog(['Something else']);
    expect(root).toMatchRenderedOutput('Something else');
  });

  /**
   * 场景（Given–When–Then）：给定根有等待 A 的暂停提交；当另一个 transition 改渲染普通文本；
   * 那么同优先级的新树也能取代旧提交。对应机制：新 transition 取消过期的资源等待结果。
   */
  // @gate enableSuspenseyImages
  it('a transition update interrupts a suspended commit', async () => {
    const root = ReactNoop.createRoot();

    // 图片不在 Suspense 边界内，因此这次 transition 会在根提交阶段暂停。
    await act(() => {
      startTransition(() => {
        root.render(<SuspenseyImage src="A" />);
      });
    });
    assertLog(['Image requested [A]']);
    // 尚无可提交的内容。
    expect(root).toMatchRenderedOutput(null);

    // 后来的 transition 应中断已经过期的暂停提交。
    await act(() => {
      startTransition(() => {
        root.render(<Text text="Something else" />);
      });
    });
    assertLog(['Something else']);
    expect(root).toMatchRenderedOutput('Something else');
  });

  /**
   * 场景（Given–When–Then）：给定 forwards SuspenseList 的 A/B/C 图片都未加载；当它们
   * 依次完成；那么当前实现直到三者全完成才整体显示主内容。验证机制：每次 resolve 后比较宿主树。
   */
  // @gate enableSuspenseList && enableSuspenseyImages
  it('demonstrate current behavior when used with SuspenseList (not ideal)', async () => {
    /** 用三个连续边界展示 SuspenseList 与提交阶段资源门闩的当前组合行为。 */
    function App() {
      return (
        <SuspenseList revealOrder="forwards" tail="visible">
          <Suspense fallback={<Text text="Loading A" />}>
            <SuspenseyImage src="A" />
          </Suspense>
          <Suspense fallback={<Text text="Loading B" />}>
            <SuspenseyImage src="B" />
          </Suspense>
          <Suspense fallback={<Text text="Loading C" />}>
            <SuspenseyImage src="C" />
          </Suspense>
        </SuspenseList>
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      startTransition(() => {
        root.render(<App />);
      });
    });
    assertLog([
      'Image requested [A]',
      'Loading A',
      'Loading B',
      'Loading C',
      'Image requested [B]',
      'Image requested [C]',
    ]);
    expect(root).toMatchRenderedOutput('Loading ALoading BLoading C');

    // TODO：当前必须等全部条目加载后才显示，行为并不理想；若要逐行提交，需要渲染阶段
    // 同时准备 fallback 与主树，这也与 Activity 的预渲染策略相关。
    resolveSuspenseyThing('A');
    expect(root).toMatchRenderedOutput('Loading ALoading BLoading C');
    resolveSuspenseyThing('B');
    expect(root).toMatchRenderedOutput('Loading ALoading BLoading C');
    resolveSuspenseyThing('C');
    expect(root).toMatchRenderedOutput(
      <>
        <suspensey-thing src="A" />
        <suspensey-thing src="B" />
        <suspensey-thing src="C" />
      </>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定资源分布在父子和兄弟位置，且每次让刚触发的请求立即完成；
   * 当工作循环从挂起点继续；那么从不提交 fallback，最终一次显示完整主树。
   * 对应机制：complete 阶段预加载与 work loop 恢复位置。
   */
  // @gate enableSuspenseyImages
  it('avoid triggering a fallback if resource loads immediately', async () => {
    const root = ReactNoop.createRoot();
    await act(async () => {
      startTransition(() => {
        // 故意把 suspensey 宿主节点放在多种树位置，验证工作循环能从每个挂起点正确恢复。
        root.render(
          <Suspense fallback={<Text text="Loading..." />}>
            <suspensey-thing
              src="A"
              onLoadStart={() => Scheduler.log('Request [A]')}>
              <suspensey-thing
                src="B"
                onLoadStart={() => Scheduler.log('Request [B]')}
              />
            </suspensey-thing>
            <suspensey-thing
              src="C"
              onLoadStart={() => Scheduler.log('Request [C]')}
            />
          </Suspense>,
        );
      });
      // React 会在资源挂起后立即让出。
      // TODO：当前在 complete 阶段预加载，所以子节点先发请求；理想情况应移到 begin 阶段，
      // 但宿主实例目前直到 complete 才创建，仍需确认预加载是否真的依赖该实例。
      await waitForPaint(['Request [B]']);
      // 在立即任务中完成资源，模拟资源早已进入缓存的情况。
      resolveSuspenseyThing('B');
      await waitForPaint(['Request [A]']);
      resolveSuspenseyThing('A');
      await waitForPaint(['Request [C]']);
      resolveSuspenseyThing('C');
    });
    expect(root).toMatchRenderedOutput(
      <>
        <suspensey-thing src="A">
          <suspensey-thing src="B" />
        </suspensey-thing>
        <suspensey-thing src="C" />
      </>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定隐藏 Activity 已预渲染未加载图片；当切换为 visible；
   * 那么隐藏提交不受阻，揭示阶段会保留隐藏树直到图片完成，且 memo 化子组件不重复渲染。
   * 对应机制：Activity 预渲染、揭示提交门闩和 `useMemo` 身份稳定。
   */
  // @gate enableSuspenseyImages
  it("host instances don't suspend during prerendering, but do suspend when they are revealed", async () => {
    /** 记录隐藏子树是否重复执行，并返回一个尚未加载的 suspensey 图片。 */
    function More() {
      Scheduler.log('More');
      return <SuspenseyImage src="More" />;
    }

    /** 保持隐藏内容元素身份稳定，只通过 Activity 模式控制预渲染与揭示。 */
    function Details({showMore}) {
      Scheduler.log('Details');
      const more = useMemo(() => <More />, []);
      return (
        <>
          <div>Main Content</div>
          <Activity mode={showMore ? 'visible' : 'hidden'}>{more}</Activity>
        </>
      );
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<Details showMore={false} />);
      // 首次绘制只处理外层可见内容，隐藏子树随后在后台预渲染。
      await waitForPaint(['Details']);
      expect(root).toMatchRenderedOutput(<div>Main Content</div>);
    });
    // 随后预渲染隐藏内容。
    assertLog(['More', 'Image requested [More]']);
    // 因为内容仍隐藏，即使图片未加载，预渲染也可以提交。
    expect(root).toMatchRenderedOutput(
      <>
        <div>Main Content</div>
        <suspensey-thing hidden={true} src="More" />
      </>,
    );

    // 揭示预渲染内容时图片尚未加载，因此这次可见性更新必须暂停提交。
    await act(() => {
      startTransition(() => {
        root.render(<Details showMore={true} />);
      });
    });
    // More 已预渲染且元素被 memo 化，不应再次执行。
    assertLog(['Details']);
    expect(root).toMatchRenderedOutput(
      <>
        <div>Main Content</div>
        <suspensey-thing hidden={true} src="More" />
      </>,
    );

    // 图片完成后，揭示 transition 才能提交。
    resolveSuspenseyThing('More');
    expect(root).toMatchRenderedOutput(
      <>
        <div>Main Content</div>
        <suspensey-thing src="More" />
      </>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定主树含被暂停提交的图片和 passive effect；当资源完成并
   * 提交主树；那么 effect 只在该提交之后刷新。对应机制：提交门闩与 passive 阶段排序。
   */
  // FIXME：启用 `enableYieldingBeforePassive` 时也应通过。
  // @gate !enableYieldingBeforePassive && enableSuspenseyImages
  it('runs passive effects after suspended commit resolves', async () => {
    /** 在渲染时记录文本，并在 passive 阶段记录一次副作用刷新。 */
    function Effect() {
      React.useEffect(() => {
        Scheduler.log('flush effect');
      });
      return <Text text="render effect" />;
    }

    const root = ReactNoop.createRoot();

    await act(() => {
      root.render(
        <Suspense fallback={<Text text="Loading..." />}>
          <Effect />
          <SuspenseyImage src="A" />
        </Suspense>,
      );
    });

    assertLog([
      'render effect',
      'Image requested [A]',
      'Loading...',
      'render effect',
    ]);
    expect(root).toMatchRenderedOutput('Loading...');

    await act(() => {
      resolveSuspenseyThing('A');
    });

    assertLog(['flush effect']);
    expect(root).toMatchRenderedOutput(
      <>
        {'render effect'}
        <suspensey-thing src="A" />
      </>,
    );
  });
});
