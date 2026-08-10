/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use strict';

let React;
let ReactNoop;
let Scheduler;
let act;
let startTransition;
let useDeferredValue;
let useMemo;
let useState;
let Suspense;
let Activity;
let assertLog;
let waitForPaint;
let textCache;

/** 覆盖 `useDeferredValue` 的优先级、初始预览、挂起恢复及隐藏树揭示语义。 */
describe('ReactDeferredValue', () => {
  /** 重建 React/Noop 调度环境与文本资源缓存，隔离每个 deferred lane 场景。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    startTransition = React.startTransition;
    useDeferredValue = React.useDeferredValue;
    useMemo = React.useMemo;
    useState = React.useState;
    Suspense = React.Suspense;
    Activity = React.Activity;

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;
    waitForPaint = InternalTestUtils.waitForPaint;

    textCache = new Map();
  });

  /**
   * 将文本记录推进为 resolved 并触发全部 React retry ping；未读资源可直接预解析。
   * 状态边界：只处理缺失或 pending 记录，已完成记录保持不变。
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
   * 读取文本缓存；pending 时抛出共享 thenable，resolved 时返回文本，rejected 时抛错。
   * 首次读取建立资源记录，从而让多个原始/延迟任务订阅同一个完成信号。
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
        /** pending 时登记 retry；若已完成则用微任务异步回放解析结果。 */
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

  /** 记录同步文本的渲染顺序，并把文本作为 Noop 宿主输出。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** 读取可能挂起的文本资源，成功后记录并输出文本。 */
  function AsyncText({text}) {
    readText(text);
    Scheduler.log(text);
    return text;
  }

  /**
   * 场景（Given–When–Then）：给定每次 render 都新建的对象值；当 urgent 更新后再执行
   * transition 更新；那么 urgent 分两次提交，transition 同次提交，且不会无限派生任务。
   * 对应机制：`useDeferredValue` 以 lane 状态而非仅靠对象身份判断是否继续延迟。
   */
  it('does not cause an infinite defer loop if the original value isn\t memoized', async () => {
    /** 同时展示原始值与从非 memo 对象中解构出的延迟值。 */
    function App({value}) {
      // 传入对象每次 render 都是新身份；朴素实现会因此不停派生 deferred render。
      const {value: deferredValue} = useDeferredValue({value});

      const child = useMemo(
        () => <Text text={'Original: ' + value} />,
        [value],
      );

      const deferredChild = useMemo(
        () => <Text text={'Deferred: ' + deferredValue} />,
        [deferredValue],
      );

      return (
        <div>
          <div>{child}</div>
          <div>{deferredChild}</div>
        </div>
      );
    }

    const root = ReactNoop.createRoot();

    // 初次渲染原始值与延迟值一致。
    await act(() => {
      root.render(<App value={1} />);
    });
    assertLog(['Original: 1', 'Deferred: 1']);

    // urgent 更新先提交原始值。
    await act(async () => {
      root.render(<App value={2} />);

      await waitForPaint(['Original: 2']);
      // 延迟值在独立 render 中追上。
      await waitForPaint(['Deferred: 2']);
    });
    expect(root).toMatchRenderedOutput(
      <div>
        <div>Original: 2</div>
        <div>Deferred: 2</div>
      </div>,
    );

    // transition 本身已经是非紧急工作，不再额外延迟。
    await act(async () => {
      startTransition(() => {
        root.render(<App value={3} />);
      });
      // 原始值与延迟值在同一 render 更新。
      await waitForPaint(['Original: 3', 'Deferred: 3']);
    });
    expect(root).toMatchRenderedOutput(
      <div>
        <div>Original: 3</div>
        <div>Deferred: 3</div>
      </div>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定稳定标量值；当先 urgent 更新 1→2、再 transition 更新 2→3；
   * 那么前者分原始/延迟两次绘制，后者同次绘制。对应机制：transition lane 直接采用新值。
   */
  it('does not defer during a transition', async () => {
    /** 分别 memo 化原始和延迟文本，以便日志精确显示哪一路发生重渲染。 */
    function App({value}) {
      const deferredValue = useDeferredValue(value);

      const child = useMemo(
        () => <Text text={'Original: ' + value} />,
        [value],
      );

      const deferredChild = useMemo(
        () => <Text text={'Deferred: ' + deferredValue} />,
        [deferredValue],
      );

      return (
        <div>
          <div>{child}</div>
          <div>{deferredChild}</div>
        </div>
      );
    }

    const root = ReactNoop.createRoot();

    // 初次渲染原始值与延迟值一致。
    await act(() => {
      root.render(<App value={1} />);
    });
    assertLog(['Original: 1', 'Deferred: 1']);

    // urgent 更新先提交原始值。
    await act(async () => {
      root.render(<App value={2} />);

      await waitForPaint(['Original: 2']);
      // 延迟值在独立 render 中追上。
      await waitForPaint(['Deferred: 2']);
    });
    expect(root).toMatchRenderedOutput(
      <div>
        <div>Original: 2</div>
        <div>Deferred: 2</div>
      </div>,
    );

    // transition 更新不再额外延迟。
    await act(async () => {
      startTransition(() => {
        root.render(<App value={3} />);
      });
      // 原始值与延迟值在同一 render 更新。
      await waitForPaint(['Original: 3', 'Deferred: 3']);
    });
    expect(root).toMatchRenderedOutput(
      <div>
        <div>Original: 3</div>
        <div>Deferred: 3</div>
      </div>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定 prop 通过 render-phase update 镜像到本地状态；当 urgent
   * 和 transition 依次更新；那么 deferred 值仍按各自优先级追赶且不丢更新。
   * 对应机制：重渲染循环中的 hook update 队列与 deferred lane 合并。
   */
  it("works if there's a render phase update", async () => {
    /** 在 render phase 镜像 prop，再同时展示原始状态与 deferred 状态。 */
    function App({value: propValue}) {
      const [value, setValue] = useState(null);
      if (value !== propValue) {
        setValue(propValue);
      }

      const deferredValue = useDeferredValue(value);

      const child = useMemo(
        () => <Text text={'Original: ' + value} />,
        [value],
      );

      const deferredChild = useMemo(
        () => <Text text={'Deferred: ' + deferredValue} />,
        [deferredValue],
      );

      return (
        <div>
          <div>{child}</div>
          <div>{deferredChild}</div>
        </div>
      );
    }

    const root = ReactNoop.createRoot();

    // 初次渲染原始值与延迟值一致。
    await act(() => {
      root.render(<App value={1} />);
    });
    assertLog(['Original: 1', 'Deferred: 1']);

    // urgent 更新先提交原始值。
    await act(async () => {
      root.render(<App value={2} />);

      await waitForPaint(['Original: 2']);
      // 延迟值在独立 render 中追上。
      await waitForPaint(['Deferred: 2']);
    });
    expect(root).toMatchRenderedOutput(
      <div>
        <div>Original: 2</div>
        <div>Deferred: 2</div>
      </div>,
    );

    // transition 更新不再额外延迟。
    await act(async () => {
      startTransition(() => {
        root.render(<App value={3} />);
      });
      // 原始值与延迟值在同一 render 更新。
      await waitForPaint(['Original: 3', 'Deferred: 3']);
    });
    expect(root).toMatchRenderedOutput(
      <div>
        <div>Original: 3</div>
        <div>Deferred: 3</div>
      </div>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定一次 transition 已把当前 deferred 值推进到 2；当随后
   * urgent 更新到 3；那么首帧复用 2 而非回退到初始 1，后台再追到 3。
   * 对应机制：非紧急提交也必须更新 hook 的 memoized deferred 基线。
   */
  it('regression test: during urgent update, reuse previous value, not initial value', async () => {
    /** 通过 render-phase 镜像状态复现 deferred 基线曾未更新的回归路径。 */
    function App({value: propValue}) {
      const [value, setValue] = useState(null);
      if (value !== propValue) {
        setValue(propValue);
      }

      const deferredValue = useDeferredValue(value);

      const child = useMemo(
        () => <Text text={'Original: ' + value} />,
        [value],
      );

      const deferredChild = useMemo(
        () => <Text text={'Deferred: ' + deferredValue} />,
        [deferredValue],
      );

      return (
        <div>
          <div>{child}</div>
          <div>{deferredChild}</div>
        </div>
      );
    }

    const root = ReactNoop.createRoot();

    // 初次渲染建立 deferred 基线 1。
    await act(async () => {
      root.render(<App value={1} />);
      await waitForPaint(['Original: 1', 'Deferred: 1']);
      expect(root).toMatchRenderedOutput(
        <div>
          <div>Original: 1</div>
          <div>Deferred: 1</div>
        </div>,
      );
    });

    await act(async () => {
      startTransition(() => {
        root.render(<App value={2} />);
      });
      // 回归实现未在非紧急更新中刷新 memoized 值，后续会从当前 2 错误跳回初始 1。
      await waitForPaint(['Original: 2', 'Deferred: 2']);
      expect(root).toMatchRenderedOutput(
        <div>
          <div>Original: 2</div>
          <div>Deferred: 2</div>
        </div>,
      );
    });

    await act(async () => {
      root.render(<App value={3} />);
      await waitForPaint(['Original: 3']);
      expect(root).toMatchRenderedOutput(
        <div>
          <div>Original: 3</div>
          <div>Deferred: 2</div>
        </div>,
      );
      await waitForPaint(['Deferred: 3']);
      expect(root).toMatchRenderedOutput(
        <div>
          <div>Original: 3</div>
          <div>Deferred: 3</div>
        </div>,
      );
    });
  });

  /**
   * 场景（Given–When–Then）：给定最终值 Final 与初始值 Initial；当组件首次挂载；那么先提交
   * Initial，后台 deferred render 再提交 Final。对应机制：`initialValue` 创建首轮预览 lane。
   */
  it('supports initialValue argument', async () => {
    /** 直接展示带 `initialValue` 的 deferred 字符串。 */
    function App() {
      const value = useDeferredValue('Final', 'Initial');
      return <Text text={value} />;
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      root.render(<App />);
      await waitForPaint(['Initial']);
      expect(root).toMatchRenderedOutput('Initial');
    });
    assertLog(['Final']);
    expect(root).toMatchRenderedOutput('Final');
  });

  /**
   * 场景（Given–When–Then）：给定首次挂载本身位于 transition 且提供 Initial；当渲染 Final；
   * 那么仍先提交 Initial，再后台切换 Final。对应机制：首挂 `initialValue` 优先于外层 lane。
   */
  it('defers during initial render when initialValue is provided, even if render is not sync', async () => {
    /** 直接展示带初始预览的最终字符串。 */
    function App() {
      const value = useDeferredValue('Final', 'Initial');
      return <Text text={value} />;
    }

    const root = ReactNoop.createRoot();
    await act(async () => {
      // 虽然初次挂载属于 transition，`initialValue` 仍要求先展示预览。
      startTransition(() => root.render(<App />));
      await waitForPaint(['Initial']);
      expect(root).toMatchRenderedOutput('Initial');
    });
    assertLog(['Final']);
    expect(root).toMatchRenderedOutput('Final');
  });

  /**
   * 场景（Given–When–Then）：给定无边界根中 initial 与 Final 都挂起；当 Final 先完成；那么
   * 直接切换到 deferred 任务并提交 Final，之后 initial 的 ping 被忽略。
   * 对应机制：原始任务无需完成即可由已解除阻塞的 deferred lane 取代。
   */
  it(
    'if a suspended render spawns a deferred task, we can switch to the ' +
      'deferred task without finishing the original one (no Suspense boundary)',
    async () => {
      /** 在无边界根中先读 Loading 预览，再由 deferred 任务尝试 Final。 */
      function App() {
        const text = useDeferredValue('Final', 'Loading...');
        return <AsyncText text={text} />;
      }

      const root = ReactNoop.createRoot();
      await act(() => root.render(<App />));
      assertLog([
        'Suspend! [Loading...]',
        // 初始值挂起后转而尝试最终值，最终值也挂起。
        'Suspend! [Final]',
        ...(gate('enableParallelTransitions')
          ? []
          : [
              // 已知问题：这里发生了不必要的预热。
              'Suspend! [Loading...]',
              'Suspend! [Final]',
            ]),
      ]);
      expect(root).toMatchRenderedOutput(null);

      // 最终值先完成，因此可以完全跳过初始值。
      await act(() => resolveText('Final'));
      assertLog(['Final']);
      expect(root).toMatchRenderedOutput('Final');

      // 初始值随后完成时已不再需要，不触发任何工作。
      await act(() => resolveText('Loading...'));
      assertLog([]);
      expect(root).toMatchRenderedOutput('Final');
    },
  );

  /**
   * 场景（Given–When–Then）：给定原始与 deferred 任务各有文本及对应兄弟资源；当 Final
   * 先完成，随后初始值完成但其兄弟仍挂起；那么等 Final 兄弟完成后直接提交最终分支。
   * 对应机制：并行挂起任务可保留进度，并由先解除阻塞的完整树胜出。
   */
  it(
    'if a suspended render spawns a deferred task that suspends on a sibling, ' +
      'we can finish the original task if the original sibling loads first',
    async () => {
      /** 同时读取 deferred 文本及与该文本绑定的兄弟资源。 */
      function App() {
        const deferredText = useDeferredValue(`Final`, `Loading...`);
        return (
          <>
            <AsyncText text={deferredText} />{' '}
            <AsyncText text={`Sibling: ${deferredText}`} />
          </>
        );
      }

      const root = ReactNoop.createRoot();
      await act(() => root.render(<App text="a" />));
      assertLog([
        'Suspend! [Loading...]',
        // 初始值挂起后尝试最终值，最终值及其兄弟也会挂起。
        'Suspend! [Final]',
        'Suspend! [Sibling: Final]',
        ...(gate('enableParallelTransitions')
          ? [
              // 并行 transition 模式不会继续预热另一条任务。
            ]
          : [
              'Suspend! [Loading...]',
              'Suspend! [Sibling: Loading...]',
              'Suspend! [Final]',
              'Suspend! [Sibling: Final]',
            ]),
      ]);
      expect(root).toMatchRenderedOutput(null);

      // Final 本体完成，但其兄弟仍阻塞提交。
      await act(() => {
        resolveText('Final');
      });
      assertLog(['Final', 'Suspend! [Sibling: Final]']);
      expect(root).toMatchRenderedOutput(null);

      // 初始值随后完成，原始任务也尝试恢复，但其兄弟仍挂起。
      await act(() => resolveText('Loading...'));
      assertLog([
        'Loading...',
        'Suspend! [Sibling: Loading...]',
        'Final',
        'Suspend! [Sibling: Final]',
        ...(gate('enableParallelTransitions')
          ? [
              // 并行 transition 模式不会继续预热另一条任务。
            ]
          : [
              'Loading...',
              'Suspend! [Sibling: Loading...]',
              'Final',
              'Suspend! [Sibling: Final]',
            ]),
      ]);
      expect(root).toMatchRenderedOutput(null);

      // Final 的兄弟完成后最终任务解除阻塞并提交。
      await act(() => {
        resolveText('Sibling: Final');
      });
      assertLog(['Final', 'Sibling: Final']);
      expect(root).toMatchRenderedOutput('Final Sibling: Final');

      // 已提交 Final，过期的初始兄弟完成不会再触发可见变化。
      await act(() => {
        resolveText('Sibling: Loading...');
      });
      assertLog([]);
      expect(root).toMatchRenderedOutput('Final Sibling: Final');
    },
  );

  /**
   * 场景（Given–When–Then）：给定两条任务都只差各自兄弟资源；当初始兄弟先完成；那么先
   * 提交 Loading 分支，Final 兄弟完成后再切换最终分支。
   * 对应机制：原始任务可以在 deferred 任务未完成时先提交，之后 deferred lane 继续追赶。
   */
  it(
    'if a suspended render spawns a deferred task that suspends on a sibling,' +
      ' we can switch to the deferred task without finishing the original one',
    async () => {
      /** 同时读取 deferred 文本与随文本身份变化的兄弟资源。 */
      function App() {
        const deferredText = useDeferredValue(`Final`, `Loading...`);
        return (
          <>
            <AsyncText text={deferredText} />{' '}
            <AsyncText text={`Sibling: ${deferredText}`} />
          </>
        );
      }

      const root = ReactNoop.createRoot();
      await act(() => root.render(<App text="a" />));
      assertLog([
        'Suspend! [Loading...]',
        // 初始值挂起后尝试最终值，最终值及其兄弟也会挂起。
        'Suspend! [Final]',
        'Suspend! [Sibling: Final]',
        ...(gate('enableParallelTransitions')
          ? [
              // 并行 transition 模式不会继续预热另一条任务。
            ]
          : [
              'Suspend! [Loading...]',
              'Suspend! [Sibling: Loading...]',
              'Suspend! [Final]',
              'Suspend! [Sibling: Final]',
            ]),
      ]);
      expect(root).toMatchRenderedOutput(null);

      // Final 本体完成，但其兄弟仍阻塞提交。
      await act(() => {
        resolveText('Final');
      });
      assertLog(['Final', 'Suspend! [Sibling: Final]']);
      expect(root).toMatchRenderedOutput(null);

      // 初始值随后完成，原始任务恢复但仍等待初始兄弟。
      await act(() => resolveText('Loading...'));
      assertLog([
        'Loading...',
        'Suspend! [Sibling: Loading...]',
        'Final',
        'Suspend! [Sibling: Final]',
        ...(gate('enableParallelTransitions')
          ? [
              // 并行 transition 模式不会继续预热另一条任务。
            ]
          : [
              'Loading...',
              'Suspend! [Sibling: Loading...]',
              'Final',
              'Suspend! [Sibling: Final]',
            ]),
      ]);
      expect(root).toMatchRenderedOutput(null);

      // 初始兄弟先完成，原始任务解除阻塞并提交。
      await act(() => {
        resolveText('Sibling: Loading...');
      });
      assertLog([
        'Loading...',
        'Sibling: Loading...',
        'Final',
        'Suspend! [Sibling: Final]',
      ]);
      expect(root).toMatchRenderedOutput('Loading... Sibling: Loading...');

      // 再完成最终兄弟，让 deferred 任务追上。
      await act(() => {
        resolveText('Sibling: Final');
      });
      assertLog(['Final', 'Sibling: Final']);
      expect(root).toMatchRenderedOutput('Final Sibling: Final');
    },
  );

  /**
   * 场景（Given–When–Then）：给定父更新通过 flushSync 同步启动且无 Suspense 边界；当初始值
   * 与 Final 都挂起、Final 先完成；那么仍可切换 deferred 任务并忽略过期初始 ping。
   * 对应机制：同步父 lane 派生的 deferred task 仍由独立 lane 恢复。
   */
  it(
    'if a suspended render spawns a deferred task, we can switch to the ' +
      'deferred task without finishing the original one (no Suspense boundary, ' +
      'synchronous parent update)',
    async () => {
      /** 在无边界根中用初始预览读取异步 Final。 */
      function App() {
        const text = useDeferredValue('Final', 'Loading...');
        return <AsyncText text={text} />;
      }

      const root = ReactNoop.createRoot();
      // TODO：更新若在 `act` 外派生 deferred task 当前不会警告；通常父任务会被 `act` 包裹，
      // 但通过 `flushSync` 刷新的父任务可能绕过这一假设。
      await act(() => {
        ReactNoop.flushSync(() => root.render(<App />));
      });
      assertLog([
        'Suspend! [Loading...]',
        // 初始值挂起后尝试最终值，最终值也挂起。
        'Suspend! [Final]',
        ...(gate('enableParallelTransitions')
          ? [
              // 并行 transition 模式不会继续预热另一条任务。
            ]
          : ['Suspend! [Loading...]', 'Suspend! [Final]']),
      ]);
      expect(root).toMatchRenderedOutput(null);

      // Final 先完成，因此完全跳过初始值。
      await act(() => resolveText('Final'));
      assertLog(['Final']);
      expect(root).toMatchRenderedOutput('Final');

      // 初始值随后完成时已不再需要，不触发任何工作。
      await act(() => resolveText('Loading...'));
      assertLog([]);
      expect(root).toMatchRenderedOutput('Final');
    },
  );

  /**
   * 场景（Given–When–Then）：给定相同 initial/Final 任务位于 Suspense 边界内；当二者都挂起；
   * 那么先显示 Fallback，Final 完成后直接替换，过期 initial 完成无效。
   * 对应机制：边界 fallback 提交与 deferred lane 重试选择。
   */
  it(
    'if a suspended render spawns a deferred task, we can switch to the ' +
      'deferred task without finishing the original one (Suspense boundary)',
    async () => {
      /** 在 Suspense 消费者内部读取带初始预览的异步 Final。 */
      function App() {
        const text = useDeferredValue('Final', 'Loading...');
        return <AsyncText text={text} />;
      }

      const root = ReactNoop.createRoot();
      await act(() =>
        root.render(
          <Suspense fallback={<Text text="Fallback" />}>
            <App />
          </Suspense>,
        ),
      );
      assertLog([
        'Suspend! [Loading...]',
        'Fallback',

        // 初始值挂起后尝试最终值，最终值也挂起。
        'Suspend! [Final]',
        // 后台预热主树。
        'Suspend! [Final]',
      ]);
      expect(root).toMatchRenderedOutput('Fallback');

      // Final 先完成，因此完全跳过初始值。
      await act(() => resolveText('Final'));
      assertLog(['Final']);
      expect(root).toMatchRenderedOutput('Final');

      // 初始值随后完成时已不再需要，不触发任何工作。
      await act(() => resolveText('Loading...'));
      assertLog([]);
      expect(root).toMatchRenderedOutput('Final');
    },
  );

  /**
   * 场景（Given–When–Then）：给定 initial 与 Final 都挂起且 initial 先完成；当原始任务恢复；
   * 那么先提交 Loading，Final 完成后再切换。对应机制：deferred 任务不阻塞已可提交的原始任务。
   */
  it(
    'if a suspended render spawns a deferred task that also suspends, we can ' +
      'finish the original task if that one loads first',
    async () => {
      /** 在无边界根中读取带初始预览的异步 Final。 */
      function App() {
        const text = useDeferredValue('Final', 'Loading...');
        return <AsyncText text={text} />;
      }

      const root = ReactNoop.createRoot();
      await act(() => root.render(<App />));
      assertLog([
        'Suspend! [Loading...]',
        // 初始值挂起后尝试最终值，最终值也挂起。
        'Suspend! [Final]',
        ...(gate('enableParallelTransitions')
          ? [
              // 并行 transition 模式不会继续预热另一条任务。
            ]
          : ['Suspend! [Loading...]', 'Suspend! [Final]']),
      ]);
      expect(root).toMatchRenderedOutput(null);

      // 初始值先完成，因此原始任务可以提交。
      await act(() => resolveText('Loading...'));
      assertLog([
        'Loading...',
        // deferred 任务仍在等待 Final。
        'Suspend! [Final]',
      ]);
      expect(root).toMatchRenderedOutput('Loading...');

      // Final 完成后切换到 deferred 结果。
      await act(() => resolveText('Final'));
      assertLog(['Final']);
      expect(root).toMatchRenderedOutput('Final');
    },
  );

  /**
   * 场景（Given–When–Then）：给定父 App 和子 Content 各有 `initialValue`；当首次挂载；那么只
   * 使用最外层 App Preview，内层直接尝试 Content，避免预览逐层瀑布。
   * 对应机制：同一渲染树中的 deferred depth 标记只允许第一层走初始值。
   */
  it(
    'if there are multiple useDeferredValues in the same tree, only the ' +
      'first level defers; subsequent ones go straight to the final value, to ' +
      'avoid a waterfall',
    async () => {
      /** 用首层 deferred 布尔值在应用预览与真正 Content 之间切换。 */
      function App() {
        const showContent = useDeferredValue(true, false);
        if (!showContent) {
          return <Text text="App Preview" />;
        }
        return <Content />;
      }

      /** 内层也声明 Content Preview，用来验证嵌套预览会被跳过。 */
      function Content() {
        const text = useDeferredValue('Content', 'Content Preview');
        return <AsyncText text={text} />;
      }

      const root = ReactNoop.createRoot();
      resolveText('App Preview');

      await act(() => root.render(<App />));
      assertLog([
        // App 先显示即时预览。
        'App Preview',
        // 随后切到 Content；父级已经显示过预览，因此跳过内层预览并直接尝试最终值。
        //
        // 这刻意不同于嵌套 Suspense：后者总是优先显示最内层 loading 状态。
        'Suspend! [Content]',
      ]);
      // 内层内容挂起，所以仍显示 App Preview。
      expect(root).toMatchRenderedOutput('App Preview');

      // 完成最终内容。
      await act(() => resolveText('Content'));
      // 从未尝试渲染 Content Preview。
      assertLog(['Content']);
      expect(root).toMatchRenderedOutput('Content');
    },
  );

  /**
   * 场景（Given–When–Then）：给定无关 transition A 尚未完成，此时以新 key 挂载 B 的
   * `useDeferredValue`；当 B 初次渲染；那么仍先显示 Preview B，再切最终 B。
   * 对应机制：新 hook 的 initialValue 不应被根上其他 suspended transition 抑制。
   */
  it(
    "regression: useDeferredValue's initial value argument works even if an unrelated " +
      'transition is suspended',
    async () => {
      // 复现历史问题：无关 transition 挂起时新挂载 deferred hook，回归实现会跳过其初始值。

      /** 将每个最终文本映射为独立的 Preview，并通过异步资源观察两阶段渲染。 */
      function Content({text}) {
        return (
          <AsyncText text={useDeferredValue(text, `Preview ${text}...`)} />
        );
      }

      /** 文本改变时用 key 强制挂载新的 Content/hook 实例。 */
      function App({text}) {
        // key 确保每次文本变化都不是更新旧 hook，而是测试真正的首次挂载。
        return <Content key={text} text={text} />;
      }

      const root = ReactNoop.createRoot();

      // 渲染上一屏 deferred UI，并让最终 A 挂起。
      resolveText('Preview A...');
      await act(() => startTransition(() => root.render(<App text="A" />)));
      assertLog(['Preview A...', 'Suspend! [A]']);

      // A 仍挂起时切到具有不同预览的 B；即使旧 transition 未完成，也应显示新预览。
      resolveText('Preview B...');
      await act(() => startTransition(() => root.render(<App text="B" />)));
      assertLog(['Preview B...', 'Suspend! [B]']);

      // 完成 B 的最终值。
      await act(() => resolveText('B'));
      assertLog(['B']);
      expect(root).toMatchRenderedOutput('B');
    },
  );

  /**
   * 场景（Given–When–Then）：给定父级 deferred 预览与内层 Content 之间隔着 Suspense；当
   * 父预览结束、内层最终内容挂起；那么仍跳过 Content Preview 并显示边界 fallback。
   * 对应机制：Suspense 边界不会重置 deferred depth 的防瀑布标记。
   */
  it('avoids a useDeferredValue waterfall when separated by a Suspense boundary', async () => {
    // 与上一防瀑布场景相同，但两个 deferred hook 之间增加 Suspense 边界。
    /** 用首层 deferred 布尔值在 App Preview 和带边界的 Content 之间切换。 */
    function App() {
      const showContent = useDeferredValue(true, false);
      if (!showContent) {
        return <Text text="App Preview" />;
      }
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <Content />
        </Suspense>
      );
    }

    /** 声明一个应被跳过的内层预览，并读取最终异步 Content。 */
    function Content() {
      const text = useDeferredValue('Content', 'Content Preview');
      return <AsyncText text={text} />;
    }

    const root = ReactNoop.createRoot();
    resolveText('App Preview');

    await act(() => root.render(<App />));
    assertLog([
      // App 先显示即时预览。
      'App Preview',
      // 切到 Content 时父级已显示预览，所以跳过内层预览并直接尝试最终值。
      'Suspend! [Content]',
      'Loading...',
      // 后台预热主树。
      'Suspend! [Content]',
    ]);
    // 最终 Content 挂起，因此显示 Suspense fallback。
    expect(root).toMatchRenderedOutput('Loading...');

    // 完成最终内容。
    await act(() => resolveText('Content'));
    // 从未尝试渲染 Content Preview。
    assertLog(['Content']);
    expect(root).toMatchRenderedOutput('Content');
  });

  /**
   * 场景（Given–When–Then）：给定隐藏 Activity 预渲染 Preview 并派生挂起的 Final 任务；当
   * Final 完成后再揭示；那么隐藏树后台更新到 Final，揭示只切可见性且不重渲染内部。
   * 对应机制：隐藏 Offscreen lane 可承载 deferred task，完成树在 reveal 时复用。
   */
  it('useDeferredValue can spawn a deferred task while prerendering a hidden tree', async () => {
    /** 在隐藏树中读取带 Preview 初始值的异步 Final。 */
    function App() {
      const text = useDeferredValue('Final', 'Preview');
      return (
        <div>
          <AsyncText text={text} />
        </div>
      );
    }

    let revealContent;
    /** 持有 Activity 可见性状态，并暴露揭示回调给测试。 */
    function Container({children}) {
      const [shouldShow, setState] = useState(false);
      revealContent = () => setState(true);
      return (
        <Activity mode={shouldShow ? 'visible' : 'hidden'}>{children}</Activity>
      );
    }

    const root = ReactNoop.createRoot();

    // 预渲染隐藏树。
    resolveText('Preview');
    await act(() =>
      root.render(
        <Container>
          <App />
        </Container>,
      ),
    );
    assertLog(['Preview', 'Suspend! [Final]']);
    expect(root).toMatchRenderedOutput(<div hidden={true}>Preview</div>);

    // 在隐藏状态完成最终内容。
    await act(() => resolveText('Final'));
    assertLog(['Final']);
    expect(root).toMatchRenderedOutput(<div hidden={true}>Final</div>);

    // 揭示时只切换可见性，不必重渲染已预渲染树的内部。
    await act(() => revealContent());
    assertLog([]);
    expect(root).toMatchRenderedOutput(<div>Final</div>);
  });

  /**
   * 场景（Given–When–Then）：给定隐藏树从 A 更新到 B 且提供 Preview B；当后台仅预渲染预览时
   * 揭示；那么先无额外工作显示预览，再后台完成 B。对应机制：reveal 视为挂载并保留 initialValue。
   */
  it('useDeferredValue can prerender the initial value inside a hidden tree', async () => {
    /** 为每个文本生成 Preview，并记录隐藏树原始/最终渲染顺序。 */
    function App({text}) {
      const renderedText = useDeferredValue(text, `Preview [${text}]`);
      return (
        <div>
          <Text text={renderedText} />
        </div>
      );
    }

    let revealContent;
    /** 持有 Activity 可见性状态，并暴露揭示回调。 */
    function Container({children}) {
      const [shouldShow, setState] = useState(false);
      revealContent = () => setState(true);
      return (
        <Activity mode={shouldShow ? 'visible' : 'hidden'}>{children}</Activity>
      );
    }

    const root = ReactNoop.createRoot();

    // 预渲染初始隐藏内容。
    await act(() => {
      root.render(
        <Container>
          <App text="A" />
        </Container>,
      );
    });
    assertLog(['Preview [A]', 'A']);
    expect(root).toMatchRenderedOutput(<div hidden={true}>A</div>);

    await act(async () => {
      // 树仍隐藏时更新预渲染内容。
      root.render(
        <Container>
          <App text="B" />
        </Container>,
      );
      // 先转去预渲染新的 Preview B。
      await waitForPaint([]);
      await waitForPaint(['Preview [B]']);
      expect(root).toMatchRenderedOutput(<div hidden={true}>Preview [B]</div>);

      // 预渲染尚未完成时揭示；揭示被视为新挂载，因此不能跳过 preview 状态。
      revealContent();
      // preview 已经预渲染，可不做额外内部工作直接揭示。
      if (gate(flags => flags.enableYieldingBeforePassive)) {
        // 让出一次以刷新 passive effects。
        await waitForPaint([]);
      }
      await waitForPaint([]);
      expect(root).toMatchRenderedOutput(<div>Preview [B]</div>);
    });
    // 最后完成最终值 B 的渲染。
    assertLog(['B']);
    expect(root).toMatchRenderedOutput(<div>B</div>);
  });

  /**
   * 场景（Given–When–Then）：给定隐藏树已完整预渲染最终 A；当以引用相同的 A 揭示；那么
   * 跳过 Preview A，直接复用最终内容。对应机制：reveal 时 final value 的同一性 bailout。
   */
  it(
    'useDeferredValue skips the preview state when revealing a hidden tree ' +
      'if the final value is referentially identical',
    async () => {
      /** 将文本映射为预览值，并输出当前 deferred 选择。 */
      function App({text}) {
        const renderedText = useDeferredValue(text, `Preview [${text}]`);
        return (
          <div>
            <Text text={renderedText} />
          </div>
        );
      }

      /** 用外部 `shouldShow` 控制 Activity，并把文本透传到被预渲染的 App。 */
      function Container({text, shouldShow}) {
        return (
          <Activity mode={shouldShow ? 'visible' : 'hidden'}>
            <App text={text} />
          </Activity>
        );
      }

      const root = ReactNoop.createRoot();

      // 预渲染最终 A 的隐藏树。
      await act(() => root.render(<Container text="A" shouldShow={false} />));
      assertLog(['Preview [A]', 'A']);
      expect(root).toMatchRenderedOutput(<div hidden={true}>A</div>);

      // 揭示时最终值与已预渲染值引用相同，可跳过 preview、直接复用最终树，无需补做揭示工作。
      await act(() => root.render(<Container text="A" shouldShow={true} />));
      assertLog(['A']);
      expect(root).toMatchRenderedOutput(<div>A</div>);
    },
  );

  /**
   * 场景（Given–When–Then）：给定隐藏树预渲染 A，但揭示时输入变为 B；当同步 reveal；那么
   * 不能 bailout，先提交 Preview B，再 deferred 提交 B。对应机制：final value 身份变化使揭示
   * 按新挂载语义采用 `initialValue`。
   */
  it(
    'useDeferredValue does not skip the preview state when revealing a ' +
      'hidden tree if the final value is different from the currently rendered one',
    async () => {
      /** 将文本映射为预览值，并输出当前 deferred 选择。 */
      function App({text}) {
        const renderedText = useDeferredValue(text, `Preview [${text}]`);
        return (
          <div>
            <Text text={renderedText} />
          </div>
        );
      }

      /** 用外部可见性和文本共同驱动隐藏树更新/揭示。 */
      function Container({text, shouldShow}) {
        return (
          <Activity mode={shouldShow ? 'visible' : 'hidden'}>
            <App text={text} />
          </Activity>
        );
      }

      const root = ReactNoop.createRoot();

      // 预渲染 A 的隐藏树。
      await act(() => root.render(<Container text="A" shouldShow={false} />));
      assertLog(['Preview [A]', 'A']);
      expect(root).toMatchRenderedOutput(<div hidden={true}>A</div>);

      // 揭示时最终值已变为 B，不能 bailout；揭示视为新挂载，因此先显示 Preview B。
      await act(async () => {
        root.render(<Container text="B" shouldShow={true} />);
        // 首先提交预览状态。
        await waitForPaint(['Preview [B]']);
        expect(root).toMatchRenderedOutput(<div>Preview [B]</div>);
      });
      // 随后切换最终状态。
      assertLog(['B']);
      expect(root).toMatchRenderedOutput(<div>B</div>);
    },
  );

  /**
   * 场景（Given–When–Then）：给定未提供 initialValue 的隐藏树先预渲染 A；当更新为 B 并同时
   * 揭示；那么直接显示 B 而非把 A 当“上一值”延迟复用。对应机制：reveal 概念上是新树挂载。
   */
  it(
    'useDeferredValue does not show "previous" value when revealing a hidden ' +
      'tree (no initial value)',
    async () => {
      /** 不提供初始预览，直接输出 `useDeferredValue(text)` 当前值。 */
      function App({text}) {
        const renderedText = useDeferredValue(text);
        return (
          <div>
            <Text text={renderedText} />
          </div>
        );
      }

      /** 用外部可见性和文本共同驱动隐藏树更新/揭示。 */
      function Container({text, shouldShow}) {
        return (
          <Activity mode={shouldShow ? 'visible' : 'hidden'}>
            <App text={text} />
          </Activity>
        );
      }

      const root = ReactNoop.createRoot();

      // 预渲染 A 的隐藏树。
      await act(() => root.render(<Container text="A" shouldShow={false} />));
      assertLog(['A']);
      expect(root).toMatchRenderedOutput(<div hidden={true}>A</div>);

      // 同时更新并揭示；即使是同步更新，也应把它视为新树并立即采用 B，而非停留在旧 A。
      await act(() => root.render(<Container text="B" shouldShow={true} />));
      assertLog(['B']);
      expect(root).toMatchRenderedOutput(<div>B</div>);
    },
  );

  /**
   * 场景（Given–When–Then）：给定 deferred render 在 A:updated 处挂起，后续 Sibling 于同一
   * render 中完成该资源；当 React 重试；那么 deferred 值追上 updated 并提交最终树。
   * 对应机制：render-phase ping 标记本轮 suspended lane 重新调度，而不遗失 deferred 更新。
   */
  // 回归测试：https://github.com/facebook/react/issues/35821
  it('deferred value catches up when a suspension is resolved during the same render', async () => {
    let setValue;
    /** 用状态更新触发 deferred render，并把会互相解锁的异步兄弟放在同一边界内。 */
    function App() {
      const [value, _setValue] = useState('initial');
      setValue = _setValue;
      const deferred = useDeferredValue(value);
      return (
        <Suspense fallback={<Text text="Loading..." />}>
          <AsyncText text={'A:' + deferred} />
          <Sibling text={deferred} />
        </Suspense>
      );
    }

    /** 在 updated render 中完成 A，同时读取预先解析的 B，模拟数据在渲染途中到达。 */
    function Sibling({text}) {
      if (text !== 'initial') {
        // 在本次 render 中完成 A，模拟数据于渲染已经进行时到达。
        resolveText('A:' + text);
      }
      readText('B:' + text);
      Scheduler.log('B: ' + text);
      return text;
    }

    const root = ReactNoop.createRoot();

    resolveText('A:initial');
    resolveText('B:initial');
    await act(() => root.render(<App />));
    assertLog(['A:initial', 'B: initial']);

    // 预先完成 B，避免兄弟在 retry 时再次挂起。
    resolveText('B:updated');

    await act(() => setValue('updated'));
    assertLog([
      // 同步 render 延迟新值。
      'A:initial',
      'B: initial',
      // deferred render 中 A 挂起，Sibling 随后在同轮完成 A。
      'Suspend! [A:updated]',
      'B: updated',
      'Loading...',
      // React 重试，deferred 值追上 updated。
      'A:updated',
      'B: updated',
    ]);
    expect(root).toMatchRenderedOutput('A:updatedupdated');
  });
});
