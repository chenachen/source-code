/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

let React;
let ReactNoop;
let Scheduler;
let act;
let Profiler;
let Suspense;
let SuspenseList;
let waitForAll;
let assertLog;
let waitFor;
let assertConsoleErrorDev;

/** 验证 SuspenseList 的 revealOrder、tail 截断、嵌套协调、恢复与异步 iterable 边界。 */
describe('ReactSuspenseList', () => {
  /** 重置模块并绑定 SuspenseList、Noop 渲染器、调度日志及控制台断言；开关关闭时不读取实验 API。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    Profiler = React.Profiler;
    Suspense = React.Suspense;
    if (gate(flags => flags.enableSuspenseList)) {
      SuspenseList = React.unstable_SuspenseList;
    }

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    assertLog = InternalTestUtils.assertLog;
    waitFor = InternalTestUtils.waitFor;
    act = InternalTestUtils.act;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;
  });

  /** Text 同步记录并输出文本，区分 render 访问顺序与宿主最终内容。 */
  function Text(props) {
    Scheduler.log(props.text);
    return <span>{props.text}</span>;
  }

  /** createAsyncText 创建拥有独立 resolved 状态和 Promise 的行组件，并暴露显式 resolve 入口。 */
  function createAsyncText(text) {
    let resolved = false;
    /** 资源未解决时抛出同一个 Promise，解决后输出对应行；重复调用 resolve 由 Promise 的终态规则忽略。 */
    const Component = function () {
      if (!resolved) {
        Scheduler.log('Suspend! [' + text + ']');
        throw promise;
      }
      return <Text text={text} />;
    };
    const promise = new Promise(resolve => {
      /** 先标记资源完成再兑现 Promise，使 ping 后的重试可同步读取该行。 */
      Component.resolve = function () {
        resolved = true;
        return resolve();
      };
    });
    return Component;
  }

  /** revealOrder=something 的单个边界在开发态报告四种可用取值；断言完整警告及 Foo 栈，覆盖未知配置诊断。 */
  // @gate enableSuspenseList
  it('warns if an unsupported revealOrder option is used', async () => {
    /** 提供未知 revealOrder 的单边界，触发取值诊断。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="something">
          <Suspense fallback="Loading">Content</Suspense>
        </SuspenseList>
      );
    }

    await act(() => {
      ReactNoop.render(<Foo />);
    });
    assertConsoleErrorDev([
      '"something" is not a supported revealOrder on ' +
        '<SuspenseList />. Did you mean "independent", "together", "forwards" or "backwards"?' +
        '\n    in SuspenseList (at **)' +
        '\n    in Foo (at **)',
    ]);
  });

  /** 输入大写 TOGETHER；渲染后开发态建议小写 together，断言精确字符串及组件栈。 */
  // @gate enableSuspenseList
  it('warns if a upper case revealOrder option is used', async () => {
    /** 提供大写 TOGETHER，触发大小写修正建议。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="TOGETHER">
          <Suspense fallback="Loading">Content</Suspense>
        </SuspenseList>
      );
    }

    await act(() => {
      ReactNoop.render(<Foo />);
    });
    assertConsoleErrorDev([
      '"TOGETHER" is not a valid value for revealOrder on ' +
        '<SuspenseList />. Use lowercase "together" instead.' +
        '\n    in SuspenseList (at **)' +
        '\n    in Foo (at **)',
    ]);
  });

  /** 输入 forward；开发态指出缺少 -s 并建议 forwards，验证拼写纠错而非一般未知配置。 */
  // @gate enableSuspenseList
  it('warns if a misspelled revealOrder option is used', async () => {
    /** 提供缺少 s 后缀的 forward，触发拼写诊断。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="forward">
          <Suspense fallback="Loading">Content</Suspense>
        </SuspenseList>
      );
    }

    await act(() => {
      ReactNoop.render(<Foo />);
    });
    assertConsoleErrorDev([
      '"forward" is not a valid value for revealOrder on ' +
        '<SuspenseList />. React uses the -s suffix in the spelling. ' +
        'Use "forwards" instead.' +
        '\n    in SuspenseList (at **)' +
        '\n    in Foo (at **)',
    ]);
  });

  /** forwards/visible 先依次接收 undefined、null、false，均无警告；再接收单个 Suspense 元素时警告缺少多行，验证空 children 与单行的区别。 */
  // @gate enableSuspenseList
  it('warns if a single element is passed to a "forwards" list', async () => {
    /** 把 children 原样放入 forwards/visible 列表，区分空值和单个元素。 */
    function Foo({children}) {
      return (
        <SuspenseList revealOrder="forwards" tail="visible">
          {children}
        </SuspenseList>
      );
    }

    ReactNoop.render(<Foo />);
    // 该步骤不应产生开发态告警。
    await waitForAll([]);

    ReactNoop.render(<Foo>{null}</Foo>);
    // 该步骤不应产生开发态告警。
    await waitForAll([]);

    ReactNoop.render(<Foo>{false}</Foo>);
    // 该步骤不应产生开发态告警。
    await waitForAll([]);

    await act(() => {
      ReactNoop.render(
        <Foo>
          <Suspense fallback="Loading">Child</Suspense>
        </Foo>,
      );
    });
    assertConsoleErrorDev([
      'A single row was passed to a <SuspenseList revealOrder="forwards" />. ' +
        'This is not useful since it needs multiple rows. ' +
        'Did you mean to pass multiple children or an array?' +
        '\n    in SuspenseList (at **)' +
        '\n    in Foo (at **)',
    ]);
  });

  /** unstable_legacy-backwards/visible 收到一个内部为空数组的 Fragment；仍按单行形状警告，验证 Fragment 不自动成为多行输入。 */
  // @gate enableSuspenseList
  it('warns if a single fragment is passed to a "backwards" list', async () => {
    /** 以一个含空数组的 Fragment 作为 legacy-backwards 列表唯一行。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="unstable_legacy-backwards" tail="visible">
          <>{[]}</>
        </SuspenseList>
      );
    }

    await act(() => {
      ReactNoop.render(<Foo />);
    });
    assertConsoleErrorDev([
      'A single row was passed to a <SuspenseList revealOrder="unstable_legacy-backwards" />. ' +
        'This is not useful since it needs multiple rows. ' +
        'Did you mean to pass multiple children or an array?' +
        '\n    in SuspenseList (at **)' +
        '\n    in Foo (at **)',
    ]);
  });

  /** forwards/visible 的第一行是 items.map 得到的 A/B 数组，第二行是 div Tail；开发态指出 row #0 的嵌套数组并建议再包一层 SuspenseList。 */
  // @gate enableSuspenseList
  it('warns if a nested array is passed to a "forwards" list', async () => {
    /** 把 A/B 的 map 数组与 Tail 同时作为直接 children，制造嵌套数组行。 */
    function Foo({items}) {
      return (
        <SuspenseList revealOrder="forwards" tail="visible">
          {items.map(name => (
            <Suspense key={name} fallback="Loading">
              {name}
            </Suspense>
          ))}
          <div>Tail</div>
        </SuspenseList>
      );
    }

    await act(() => {
      ReactNoop.render(<Foo items={['A', 'B']} />);
    });
    assertConsoleErrorDev([
      'A nested array was passed to row #0 in <SuspenseList />. ' +
        'Wrap it in an additional SuspenseList to configure its revealOrder: ' +
        '<SuspenseList revealOrder=...> ... ' +
        '<SuspenseList revealOrder=...>{array}</SuspenseList> ... ' +
        '</SuspenseList>' +
        '\n    in SuspenseList (at **)' +
        '\n    in Foo (at **)',
    ]);
  });

  /** 省略 revealOrder 和 tail，A/B/C 初始待决；按 A→B→C 解析并推进 500ms 后依次显示 A、AB、ABC，初始为 null。验证默认 forwards 配合默认 hidden tail，不提交加载占位。 */
  // @gate enableSuspenseList
  it('behaves as revealOrder=forwards by default', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 省略列表配置，放置 A/B/C 三个可挂起行以验证两个默认值。 */
    function Foo() {
      return (
        <SuspenseList>
          <Suspense fallback={<Text text="Loading A" />}>
            <A />
          </Suspense>
          <Suspense fallback={<Text text="Loading B" />}>
            <B />
          </Suspense>
          <Suspense fallback={<Text text="Loading C" />}>
            <C />
          </Suspense>
        </SuspenseList>
      );
    }

    ReactNoop.render(<Foo />);

    await waitForAll(['Suspend! [A]', 'Loading A']);

    expect(ReactNoop).toMatchRenderedOutput(null);

    await A.resolve();

    await waitForAll(['A', 'Suspend! [B]', 'Loading B']);

    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(<span>A</span>);

    await act(() => B.resolve());
    assertLog(['B', 'Suspend! [C]', 'Loading C']);

    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
      </>,
    );

    await act(() => C.resolve());
    assertLog(['C']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** independent 三行先预解 A，再解析 C、B；输出依次 A/Loading B/Loading C、A/Loading B/C、ABC。alwaysThrottleRetries 改变重试日志，已完成 C 不等待 B。 */
  // @gate enableSuspenseList
  it('shows content independently with revealOrder="independent"', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 把 A/B/C 放入 independent 列表，各行使用自己的加载占位。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="independent">
          <Suspense fallback={<Text text="Loading A" />}>
            <A />
          </Suspense>
          <Suspense fallback={<Text text="Loading B" />}>
            <B />
          </Suspense>
          <Suspense fallback={<Text text="Loading C" />}>
            <C />
          </Suspense>
        </SuspenseList>
      );
    }

    await A.resolve();

    ReactNoop.render(<Foo />);

    await waitForAll([
      'A',
      'Suspend! [B]',
      'Loading B',
      'Suspend! [C]',
      'Loading C',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [B]',
      'Suspend! [C]',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </>,
    );

    await act(() => C.resolve());
    assertLog(
      gate('alwaysThrottleRetries')
        ? ['Suspend! [B]', 'C', 'Suspend! [B]']
        : ['C'],
    );

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading B</span>
        <span>C</span>
      </>,
    );

    await act(() => B.resolve());
    assertLog(['B']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** legacy 同步根虽指定 together，预解 A 后仍显示 B/C 各自 fallback；先解析 C 再 B，可分别揭示。验证旧模式不采用并发 together 协调。 */
  // @gate enableSuspenseList && !disableLegacyMode
  it('shows content independently in legacy mode regardless of option', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 在 together 列表中放置三行，由旧同步根检查独立揭示行为。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="together">
          <Suspense fallback={<Text text="Loading A" />}>
            <A />
          </Suspense>
          <Suspense fallback={<Text text="Loading B" />}>
            <B />
          </Suspense>
          <Suspense fallback={<Text text="Loading C" />}>
            <C />
          </Suspense>
        </SuspenseList>
      );
    }

    await A.resolve();

    ReactNoop.renderLegacySyncRoot(<Foo />);

    assertLog(['A', 'Suspend! [B]', 'Loading B', 'Suspend! [C]', 'Loading C']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </>,
    );

    await act(() => {
      C.resolve();
    });

    assertLog(['C']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading B</span>
        <span>C</span>
      </>,
    );

    await act(() => {
      B.resolve();
    });

    assertLog(['B']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** together 三行仅 A 预先完成；初始全显示 fallback，B 完成也保持三个 fallback，C 完成后输出 ABC，验证完成行也受组内待决行约束。 */
  // @gate enableSuspenseList
  it('displays all "together"', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 在 together 列表中放置 A/B/C，观察整组 fallback 与最终内容。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="together">
          <Suspense fallback={<Text text="Loading A" />}>
            <A />
          </Suspense>
          <Suspense fallback={<Text text="Loading B" />}>
            <B />
          </Suspense>
          <Suspense fallback={<Text text="Loading C" />}>
            <C />
          </Suspense>
        </SuspenseList>
      );
    }

    await A.resolve();

    ReactNoop.render(<Foo />);

    await waitForAll([
      'A',
      'Suspend! [B]',
      'Loading B',
      'Suspend! [C]',
      'Loading C',
      'Loading A',
      'Loading B',
      'Loading C',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>Loading A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </>,
    );

    await act(() => B.resolve());
    assertLog(['A', 'B', 'Suspend! [C]']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>Loading A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </>,
    );

    await act(() => C.resolve());
    assertLog(['A', 'B', 'C']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** together 的两个直接 div 行分别包含 A/B 和 C 的边界；仅 A 预解时三个 fallback 都显示，B 完成仍保持，C 完成后在原 div 结构中输出 ABC。验证 findFirstSuspended 穿透宿主后代。 */
  // @gate enableSuspenseList
  it('displays all "together" even when nested as siblings', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 用两个 div 将 A/B 与 C 分成直接行，检查宿主后代边界的协调。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="together">
          <div>
            <Suspense fallback={<Text text="Loading A" />}>
              <A />
            </Suspense>
            <Suspense fallback={<Text text="Loading B" />}>
              <B />
            </Suspense>
          </div>
          <div>
            <Suspense fallback={<Text text="Loading C" />}>
              <C />
            </Suspense>
          </div>
        </SuspenseList>
      );
    }

    await A.resolve();

    ReactNoop.render(<Foo />);

    await waitForAll([
      'A',
      'Suspend! [B]',
      'Loading B',
      'Suspend! [C]',
      'Loading C',
      'Loading A',
      'Loading B',
      'Loading C',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <div>
          <span>Loading A</span>
          <span>Loading B</span>
        </div>
        <div>
          <span>Loading C</span>
        </div>
      </>,
    );

    await act(() => B.resolve());
    assertLog(['A', 'B', 'Suspend! [C]']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <div>
          <span>Loading A</span>
          <span>Loading B</span>
        </div>
        <div>
          <span>Loading C</span>
        </div>
      </>,
    );

    await act(() => C.resolve());
    assertLog(['A', 'B', 'C']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <div>
          <span>A</span>
          <span>B</span>
        </div>
        <div>
          <span>C</span>
        </div>
      </>,
    );
  });

  /** 外层 together 包含 A 行和内层 together 的 B/C；预解 A/B 而 C 待决时仍显示三份 fallback，解析 C 后显示 ABC，验证嵌套列表的挂起状态向外汇总。 */
  // @gate enableSuspenseList
  it('displays all "together" in nested SuspenseLists', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 把 B/C together 列表作为外层 together 的第二行，第一行为 A。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="together">
          <Suspense fallback={<Text text="Loading A" />}>
            <A />
          </Suspense>
          <SuspenseList revealOrder="together">
            <Suspense fallback={<Text text="Loading B" />}>
              <B />
            </Suspense>
            <Suspense fallback={<Text text="Loading C" />}>
              <C />
            </Suspense>
          </SuspenseList>
        </SuspenseList>
      );
    }

    await A.resolve();
    await B.resolve();

    ReactNoop.render(<Foo />);

    await waitForAll([
      'A',
      'B',
      'Suspend! [C]',
      'Loading C',
      'Loading B',
      'Loading C',
      'Loading A',
      'Loading B',
      'Loading C',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>Loading A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </>,
    );

    await act(() => C.resolve());
    assertLog(['A', 'B', 'C']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** 外层 together 的第二行是 independent 的 B/C；A/B 已完成而 C 待决时三行仍被外层强制 fallback，解析 C 后显示 ABC。验证内层 independent 不消除外层组约束。 */
  // @gate enableSuspenseList
  it('displays all "together" in nested SuspenseLists where the inner is "independent"', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 让外层 together 包含 A 与 B/C independent 列表。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="together">
          <Suspense fallback={<Text text="Loading A" />}>
            <A />
          </Suspense>
          <SuspenseList revealOrder="independent">
            <Suspense fallback={<Text text="Loading B" />}>
              <B />
            </Suspense>
            <Suspense fallback={<Text text="Loading C" />}>
              <C />
            </Suspense>
          </SuspenseList>
        </SuspenseList>
      );
    }

    await A.resolve();
    await B.resolve();

    ReactNoop.render(<Foo />);

    await waitForAll([
      'A',
      'B',
      'Suspend! [C]',
      'Loading C',
      'Loading A',
      'Loading B',
      'Loading C',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>Loading A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </>,
    );

    await act(() => C.resolve());
    assertLog(['A', 'B', 'C']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** step=0 先显示 A/B 的 fallback，再解析 B 得到 AB；step=1 换成 C/D，其中 C 预解，仍显示两份新 fallback，解析 D 得到 CD。验证 together 在替换行时重新协调新组。 */
  // @gate enableSuspenseList
  it('displays all "together" during an update', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');
    const D = createAsyncText('D');

    /** 依据 step 在 A/B 与 C/D 两组边界之间切换。 */
    function Foo({step}) {
      return (
        <SuspenseList revealOrder="together">
          {step === 0 && (
            <Suspense fallback={<Text text="Loading A" />}>
              <A />
            </Suspense>
          )}
          {step === 0 && (
            <Suspense fallback={<Text text="Loading B" />}>
              <B />
            </Suspense>
          )}
          {step === 1 && (
            <Suspense fallback={<Text text="Loading C" />}>
              <C />
            </Suspense>
          )}
          {step === 1 && (
            <Suspense fallback={<Text text="Loading D" />}>
              <D />
            </Suspense>
          )}
        </SuspenseList>
      );
    }

    await A.resolve();
    ReactNoop.render(<Foo step={0} />);
    await waitForAll([
      'A',
      'Suspend! [B]',
      'Loading B',
      'Loading A',
      'Loading B',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>Loading A</span>
        <span>Loading B</span>
      </>,
    );
    await act(() => B.resolve());
    assertLog(['A', 'B']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
      </>,
    );

    await C.resolve();
    ReactNoop.render(<Foo step={1} />);
    await waitForAll([
      'C',
      'Suspend! [D]',
      'Loading D',
      'Loading C',
      'Loading D',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>Loading C</span>
        <span>Loading D</span>
      </>,
    );
    await act(() => D.resolve());
    assertLog(['C', 'D']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>C</span>
        <span>D</span>
      </>,
    );
  });

  /** A/B/C 均标记 avoidThisFallback：初挂 A 待决时显示外层 Loading；A 完成后追加 B/C 时保留 A 并使用其加载占位，B 单独完成仍等待 C。验证避让标记受当前可见 shell 条件约束。 */
  // @gate enableSuspenseList && enableSuspenseAvoidThisFallback
  it('avoided boundaries can be coordinate with SuspenseList', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 外包 Loading 边界，内层 together 各行标记 avoidThisFallback，并可追加 B/C。 */
    function Foo({showMore}) {
      return (
        <Suspense fallback={<Text text="Loading" />}>
          <SuspenseList revealOrder="together">
            <Suspense
              unstable_avoidThisFallback={true}
              fallback={<Text text="Loading A" />}>
              <A />
            </Suspense>
            {showMore ? (
              <>
                <Suspense
                  unstable_avoidThisFallback={true}
                  fallback={<Text text="Loading B" />}>
                  <B />
                </Suspense>
                <Suspense
                  unstable_avoidThisFallback={true}
                  fallback={<Text text="Loading C" />}>
                  <C />
                </Suspense>
              </>
            ) : null}
          </SuspenseList>
        </Suspense>
      );
    }

    ReactNoop.render(<Foo />);

    await waitForAll([
      'Suspend! [A]',
      'Loading',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(<span>Loading</span>);

    await act(() => A.resolve());
    assertLog(['A']);

    expect(ReactNoop).toMatchRenderedOutput(<span>A</span>);

    ReactNoop.render(<Foo showMore={true} />);

    await waitForAll([
      'A',
      'Suspend! [B]',
      'Loading B',
      'Suspend! [C]',
      'Loading C',
      'A',
      'Loading B',
      'Loading C',
    ]);

    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </>,
    );

    await act(() => B.resolve());
    assertLog(['B', 'Suspend! [C]']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </>,
    );

    await act(() => C.resolve());
    assertLog(['B', 'C']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** together 各边界没有 fallback：A 初挂待决时输出 null，A 完成后追加 B/C 保留 A，B 完成不单独出现，C 完成后输出 ABC。验证省略 fallback 的行仍参与组协调。 */
  // @gate enableSuspenseList
  it('boundaries without fallbacks can be coordinate with SuspenseList', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 外包 Loading 边界，内层 together 行省略 fallback 并可追加 B/C。 */
    function Foo({showMore}) {
      return (
        <Suspense fallback={<Text text="Loading" />}>
          <SuspenseList revealOrder="together">
            <Suspense>
              <A />
            </Suspense>
            {showMore ? (
              <>
                <Suspense>
                  <B />
                </Suspense>
                <Suspense>
                  <C />
                </Suspense>
              </>
            ) : null}
          </SuspenseList>
        </Suspense>
      );
    }

    ReactNoop.render(<Foo />);

    await waitForAll([
      'Suspend! [A]',
      // 该检查点预期为空值，不应提交可见行。
    ]);

    expect(ReactNoop).toMatchRenderedOutput(null);

    await act(() => A.resolve());
    assertLog(['A']);

    expect(ReactNoop).toMatchRenderedOutput(<span>A</span>);

    ReactNoop.render(<Foo showMore={true} />);

    await waitForAll([
      'A',
      'Suspend! [B]',
      // 该检查点预期为空值，不应提交可见行。
      'Suspend! [C]',
      // 该检查点预期为空值，不应提交可见行。
      'A',
      // 该检查点预期为空值，不应提交可见行。
    ]);

    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(<span>A</span>);

    await act(() => B.resolve());
    assertLog(['B', 'Suspend! [C]']);

    expect(ReactNoop).toMatchRenderedOutput(<span>A</span>);

    await act(() => C.resolve());
    assertLog(['B', 'C']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** forwards/visible 三行先预解 C；初始仍全为 fallback，A 完成显示 A 和 B/C fallback，B 完成才同时显示 B/C。验证后方已完成 C 不能越过待决 B。 */
  // @gate enableSuspenseList
  it('displays each items in "forwards" order', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 用 forwards/visible 的 A/B/C 检查后方预解 C 是否被前行阻塞。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="forwards" tail="visible">
          <Suspense fallback={<Text text="Loading A" />}>
            <A />
          </Suspense>
          <Suspense fallback={<Text text="Loading B" />}>
            <B />
          </Suspense>
          <Suspense fallback={<Text text="Loading C" />}>
            <C />
          </Suspense>
        </SuspenseList>
      );
    }

    await C.resolve();

    ReactNoop.render(<Foo />);

    await waitForAll([
      'Suspend! [A]',
      'Loading A',
      'Loading B',
      'Loading C',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>Loading A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </>,
    );

    await act(() => A.resolve());
    assertLog(['A', 'Suspend! [B]', 'Suspend! [B]']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </>,
    );

    await act(() => B.resolve());
    assertLog(['B', 'C']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** backwards/visible 输入行序为 C/B/A，预解 A；初始全 fallback，解析 C 后仅 C 可见，解析 B 后宿主输出 ABC。验证此新 backwards 选项反转呈现行序，与 legacy 选项区分。 */
  // @gate enableSuspenseList
  it('displays each items in "backwards" order', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 按 C/B/A 输入给 backwards/visible，检查渲染与宿主排列的反向关系。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="backwards" tail="visible">
          <Suspense fallback={<Text text="Loading C" />}>
            <C />
          </Suspense>
          <Suspense fallback={<Text text="Loading B" />}>
            <B />
          </Suspense>
          <Suspense fallback={<Text text="Loading A" />}>
            <A />
          </Suspense>
        </SuspenseList>
      );
    }

    await A.resolve();

    ReactNoop.render(<Foo />);

    await waitForAll([
      'Suspend! [C]',
      'Loading C',
      'Loading B',
      'Loading A',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [C]',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>Loading A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </>,
    );

    await act(() => C.resolve());
    assertLog([
      'C',
      'Suspend! [B]',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [B]',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>Loading A</span>
        <span>Loading B</span>
        <span>C</span>
      </>,
    );

    await act(() => B.resolve());
    assertLog(['B', 'A']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** unstable_legacy-backwards 输入 A/B/C，预解 A；从 C 向前协调，C 完成先显示 C，B 完成后输出 ABC。验证旧选项保留输入宿主顺序，仅反向处理 tail。 */
  // @gate enableSuspenseList
  it('displays each items in "backwards" order (legacy)', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 按 A/B/C 输入 legacy-backwards/visible，检查从尾部揭示而保留宿主次序。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="unstable_legacy-backwards" tail="visible">
          <Suspense fallback={<Text text="Loading A" />}>
            <A />
          </Suspense>
          <Suspense fallback={<Text text="Loading B" />}>
            <B />
          </Suspense>
          <Suspense fallback={<Text text="Loading C" />}>
            <C />
          </Suspense>
        </SuspenseList>
      );
    }

    await A.resolve();

    ReactNoop.render(<Foo />);

    await waitForAll([
      'Suspend! [C]',
      'Loading C',
      'Loading B',
      'Loading A',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [C]',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>Loading A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </>,
    );

    await act(() => C.resolve());
    assertLog([
      'C',
      'Suspend! [B]',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [B]',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>Loading A</span>
        <span>Loading B</span>
        <span>C</span>
      </>,
    );

    await act(() => B.resolve());
    assertLog(['B', 'A']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** 已显示 B/D 后插入 A/C/E/F；A 单独完成仍等待 head 内 C，C 完成后揭示 ABCD，再逐行揭示 E/F；最后删成 DEF。验证最后已显示行前的 head 成组处理，之后 tail 按 forwards 推进。 */
  // @gate enableSuspenseList
  it('displays added row at the top "together" and the bottom in "forwards" order', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');
    const D = createAsyncText('D');
    const E = createAsyncText('E');
    const F = createAsyncText('F');

    /** 按 items 的稳定 key 生成 forwards/visible 行，支持 head 插入、tail 追加和删除。 */
    function Foo({items}) {
      return (
        <SuspenseList revealOrder="forwards" tail="visible">
          {items.map(([key, Component]) => (
            <Suspense key={key} fallback={<Text text={'Loading ' + key} />}>
              <Component />
            </Suspense>
          ))}
        </SuspenseList>
      );
    }

    await B.resolve();
    await D.resolve();

    ReactNoop.render(
      <Foo
        items={[
          ['B', B],
          ['D', D],
        ]}
      />,
    );

    await waitForAll(['B', 'D']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>B</span>
        <span>D</span>
      </>,
    );

    // 在列表的指定位置插入新行，观察已提交区与 tail 的协调。
    ReactNoop.render(
      <Foo
        items={[
          ['A', A],
          ['B', B],
          ['C', C],
          ['D', D],
          ['E', E],
          ['F', F],
        ]}
      />,
    );

    await waitForAll([
      'Suspend! [A]',
      'Loading A',
      'B',
      'Suspend! [C]',
      'Loading C',
      'D',
      'Loading A',
      'B',
      'Loading C',
      'D',
      'Loading E',
      'Loading F',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>Loading A</span>
        <span>B</span>
        <span>Loading C</span>
        <span>D</span>
        <span>Loading E</span>
        <span>Loading F</span>
      </>,
    );

    await act(() => A.resolve());
    assertLog(['A', 'Suspend! [C]']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>Loading A</span>
        <span>B</span>
        <span>Loading C</span>
        <span>D</span>
        <span>Loading E</span>
        <span>Loading F</span>
      </>,
    );

    await act(() => C.resolve());
    assertLog([
      'A',
      'C',
      'Suspend! [E]',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [E]',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
        <span>D</span>
        <span>Loading E</span>
        <span>Loading F</span>
      </>,
    );

    await act(() => E.resolve());
    assertLog([
      'E',
      'Suspend! [F]',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [F]',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
        <span>D</span>
        <span>E</span>
        <span>Loading F</span>
      </>,
    );

    await act(() => F.resolve());
    assertLog(['F']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
        <span>D</span>
        <span>E</span>
        <span>F</span>
      </>,
    );

    ReactNoop.render(
      <Foo
        items={[
          ['D', D],
          ['E', E],
          ['F', F],
        ]}
      />,
    );

    await waitForAll(['D', 'E', 'F']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>D</span>
        <span>E</span>
        <span>F</span>
      </>,
    );
  });

  /** legacy-backwards 先显示六个同步行，再把 A/B/D/F 换成待决组件；F 完成仍等待 head 内 D，D 完成才揭示 DEF，之后 B、A 反向推进。验证反向 head 与 tail 分割而非所有行逐项独立提交。 */
  // @gate enableSuspenseList
  it('displays added row at the top "together" and the bottom in "backwards" order', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const D = createAsyncText('D');
    const F = createAsyncText('F');

    /** 返回同步文本行组件，作为异步行重排时的已就绪对照。 */
    function createSyncText(text) {
      return function () {
        return <Text text={text} />;
      };
    }

    const As = createSyncText('A');
    const Bs = createSyncText('B');
    const Cs = createSyncText('C');
    const Ds = createSyncText('D');
    const Es = createSyncText('E');
    const Fs = createSyncText('F');

    /** 按 items 生成 legacy-backwards/visible 行，并以同步与异步组件替换同 key 内容。 */
    function Foo({items}) {
      return (
        <SuspenseList revealOrder="unstable_legacy-backwards" tail="visible">
          {items.map(([key, Component]) => (
            <Suspense key={key} fallback={<Text text={'Loading ' + key} />}>
              <Component />
            </Suspense>
          ))}
        </SuspenseList>
      );
    }

    ReactNoop.render(
      <Foo
        items={[
          ['A', As],
          ['B', Bs],
          ['C', Cs],
          ['D', Ds],
          ['E', Es],
          ['F', Fs],
        ]}
      />,
    );
    await waitForAll(['F', 'E', 'D', 'C', 'B', 'A']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
        <span>D</span>
        <span>E</span>
        <span>F</span>
      </>,
    );

    ReactNoop.render(
      <Foo
        items={[
          ['A', A],
          ['B', B],
          ['C', Cs],
          ['D', D],
          ['E', Es],
          ['F', F],
        ]}
      />,
    );

    await waitForAll([
      'Suspend! [A]',
      'Loading A',
      'Suspend! [B]',
      'Loading B',
      'C',
      'Suspend! [D]',
      'Loading D',
      'E',
      'Suspend! [F]',
      'Loading F',
      'Suspend! [A]',
      'Loading A',
      'Suspend! [B]',
      'Loading B',
      'C',
      'Suspend! [D]',
      'Loading D',
      'E',
      'Suspend! [F]',
      'Loading F',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [D]',
      'Suspend! [F]',
    ]);

    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span hidden={true}>A</span>
        <span>Loading A</span>
        <span hidden={true}>B</span>
        <span>Loading B</span>
        <span>C</span>
        <span hidden={true}>D</span>
        <span>Loading D</span>
        <span>E</span>
        <span hidden={true}>F</span>
        <span>Loading F</span>
      </>,
    );

    await F.resolve();

    await waitForAll(['Suspend! [D]', 'F']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span hidden={true}>A</span>
        <span>Loading A</span>
        <span hidden={true}>B</span>
        <span>Loading B</span>
        <span>C</span>
        <span hidden={true}>D</span>
        <span>Loading D</span>
        <span>E</span>
        <span hidden={true}>F</span>
        <span>Loading F</span>
      </>,
    );

    await act(() => D.resolve());
    assertLog([
      'D',
      'F',
      'Suspend! [B]',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [B]',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span hidden={true}>A</span>
        <span>Loading A</span>
        <span hidden={true}>B</span>
        <span>Loading B</span>
        <span>C</span>
        <span>D</span>
        <span>E</span>
        <span>F</span>
      </>,
    );

    await act(() => B.resolve());
    assertLog([
      'B',
      'Suspend! [A]',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span hidden={true}>A</span>
        <span>Loading A</span>
        <span>B</span>
        <span>C</span>
        <span>D</span>
        <span>E</span>
        <span>F</span>
      </>,
    );

    await act(() => A.resolve());
    assertLog(['A']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
        <span>D</span>
        <span>E</span>
        <span>F</span>
      </>,
    );
  });

  /** 三行均同步：transition 渲染 A 后推进 200ms、B 后再推进 300ms；此时仍未提交，随后先提交 AB/Loading C，再完成 ABC。验证 CPU 预算也能触发 tail fallback，不需要 Promise 挂起。 */
  // @gate enableSuspenseList
  it('switches to rendering fallbacks if the tail takes long CPU time', async () => {
    /** 在 forwards/visible 列表中放置三个同步 Text，预算由测试在让出点推进。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="forwards" tail="visible">
          <Suspense fallback={<Text text="Loading A" />}>
            <Text text="A" />
          </Suspense>
          <Suspense fallback={<Text text="Loading B" />}>
            <Text text="B" />
          </Suspense>
          <Suspense fallback={<Text text="Loading C" />}>
            <Text text="C" />
          </Suspense>
        </SuspenseList>
      );
    }

    await act(async () => {
      React.startTransition(() => {
        ReactNoop.render(<Foo />);
      });

      await waitFor(['A']);

      Scheduler.unstable_advanceTime(200);
      jest.advanceTimersByTime(200);

      await waitFor(['B']);

      Scheduler.unstable_advanceTime(300);
      jest.advanceTimersByTime(300);

      // 尽管已投入渲染时间，当前仍没有可安全提交的内容。
      expect(ReactNoop).toMatchRenderedOutput(null);

      await waitFor([
        'Loading C',
        'C', // 分段冲刷或让出调度工作，以锁定当前渲染检查点。
      ]);

      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span>A</span>
          <span>B</span>
          <span>Loading C</span>
        </>,
      );
    });
    assertLog([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** collapsed 三个待决新行按 A→B→C 解析；可见结果依次 Loading A、A/Loading B、AB/Loading C、ABC，验证新 tail 同时只保留一份占位。 */
  // @gate enableSuspenseList
  it('only shows one loading state at a time for "collapsed" tail insertions', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 把三个新异步行置于 forwards/collapsed，检查占位随进度向后移动。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="forwards" tail="collapsed">
          <Suspense fallback={<Text text="Loading A" />}>
            <A />
          </Suspense>
          <Suspense fallback={<Text text="Loading B" />}>
            <B />
          </Suspense>
          <Suspense fallback={<Text text="Loading C" />}>
            <C />
          </Suspense>
        </SuspenseList>
      );
    }

    ReactNoop.render(<Foo />);

    await waitForAll([
      'Suspend! [A]',
      'Loading A',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(<span>Loading A</span>);

    await A.resolve();

    await waitForAll(['A', 'Suspend! [B]', 'Loading B']);

    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading B</span>
      </>,
    );

    await B.resolve();

    await waitForAll(['B', 'Suspend! [C]', 'Loading C']);

    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>Loading C</span>
      </>,
    );

    await act(() => C.resolve());
    await assertLog(['C']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** forwards 省略 tail：初始 A 待决输出 null，解析 A/B 后分别只显示 A/AB，最后 ABC。验证省略 tail 等于 hidden，而非 visible 或 collapsed。 */
  // @gate enableSuspenseList
  it('behaves as tail=hidden if no tail option is specified', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 仅设置 forwards，三行各有 fallback 以验证默认 tail 会裁剪占位。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="forwards">
          <Suspense fallback={<Text text="Loading A" />}>
            <A />
          </Suspense>
          <Suspense fallback={<Text text="Loading B" />}>
            <B />
          </Suspense>
          <Suspense fallback={<Text text="Loading C" />}>
            <C />
          </Suspense>
        </SuspenseList>
      );
    }

    ReactNoop.render(<Foo />);

    await waitForAll(['Suspend! [A]', 'Loading A']);

    expect(ReactNoop).toMatchRenderedOutput(null);

    await A.resolve();

    await waitForAll(['A', 'Suspend! [B]', 'Loading B']);

    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(<span>A</span>);

    await act(() => B.resolve());
    assertLog(['B', 'Suspend! [C]', 'Loading C']);

    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
      </>,
    );

    await act(() => C.resolve());
    assertLog(['C']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** 输入 forwards 配合 tail=collapse；开发态警告并列出 visible/collapsed/hidden，检查非法 tail 的精确建议。 */
  // @gate enableSuspenseList
  it('warns if an unsupported tail option is used', async () => {
    /** 为 forwards 两行设置拼错的 collapse，触发 tail 诊断。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="forwards" tail="collapse">
          <Suspense fallback="Loading">A</Suspense>
          <Suspense fallback="Loading">B</Suspense>
        </SuspenseList>
      );
    }

    await act(() => {
      ReactNoop.render(<Foo />);
    });
    assertConsoleErrorDev([
      '"collapse" is not a supported value for tail on ' +
        '<SuspenseList />. Did you mean "visible", "collapsed" or "hidden"?' +
        '\n    in SuspenseList (at **)' +
        '\n    in Foo (at **)',
    ]);
  });

  /** 输入 together 配合 collapsed；开发态警告 tail 仅适用于有序选项，并建议 forwards。只验证配置告警，不断言渲染被拒绝。 */
  // @gate enableSuspenseList
  it('warns if a tail option is used with "together"', async () => {
    /** 为 together 单行配置 collapsed，触发不适用组合的警告。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="together" tail="collapsed">
          <Suspense fallback="Loading">Content</Suspense>
        </SuspenseList>
      );
    }

    await act(() => {
      ReactNoop.render(<Foo />);
    });
    assertConsoleErrorDev([
      '<SuspenseList tail="collapsed" /> is only valid if ' +
        'revealOrder is "forwards" (default) or "backwards". ' +
        'Did you mean to specify revealOrder="forwards"?' +
        '\n    in SuspenseList (at **)' +
        '\n    in Foo (at **)',
    ]);
  });

  /** 四行同步 Text 放在 collapsed 中；A 后推进 200ms、B 后推进 300ms，先得到 AB/Loading C，随后完成 ABCD。验证 CPU 预算结束时仍保留一份新 tail 占位。 */
  // @gate enableSuspenseList
  it('renders one "collapsed" fallback even if CPU time elapsed', async () => {
    /** 在 forwards/collapsed 列表放置四个同步行，比较预算 fallback 与下一轮内容。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="forwards" tail="collapsed">
          <Suspense fallback={<Text text="Loading A" />}>
            <Text text="A" />
          </Suspense>
          <Suspense fallback={<Text text="Loading B" />}>
            <Text text="B" />
          </Suspense>
          <Suspense fallback={<Text text="Loading C" />}>
            <Text text="C" />
          </Suspense>
          <Suspense fallback={<Text text="Loading D" />}>
            <Text text="D" />
          </Suspense>
        </SuspenseList>
      );
    }

    await act(async () => {
      React.startTransition(() => {
        ReactNoop.render(<Foo />);
      });

      await waitFor(['A']);

      Scheduler.unstable_advanceTime(200);
      jest.advanceTimersByTime(200);

      await waitFor(['B']);

      Scheduler.unstable_advanceTime(300);
      jest.advanceTimersByTime(300);

      // 尽管已投入渲染时间，当前仍没有可安全提交的内容。
      expect(ReactNoop).toMatchRenderedOutput(null);

      await waitFor([
        'Loading C',
        'C', // 分段冲刷或让出调度工作，以锁定当前渲染检查点。
      ]);

      expect(ReactNoop).toMatchRenderedOutput(
        <>
          <span>A</span>
          <span>B</span>
          <span>Loading C</span>
        </>,
      );
    });
    assertLog(['D']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
        <span>D</span>
      </>,
    );
  });

  /** collapsed 已显示 A/D 后插入 B/C/E/F；head 中 B/C 的两份占位同时保留，tail 仅显示 Loading E。B 完成仍等 C，之后揭示 BCE 并把唯一 tail 占位移到 F。验证 collapsed 不裁剪已显示区间内插入行。 */
  // @gate enableSuspenseList
  it('adding to the middle does not collapse insertions (forwards)', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');
    const D = createAsyncText('D');
    const E = createAsyncText('E');
    const F = createAsyncText('F');

    /** 按 key 生成 forwards/collapsed 行，A/D 之间插入 B/C、末尾追加 E/F。 */
    function Foo({items}) {
      return (
        <SuspenseList revealOrder="forwards" tail="collapsed">
          {items.map(([key, Component]) => (
            <Suspense key={key} fallback={<Text text={'Loading ' + key} />}>
              <Component />
            </Suspense>
          ))}
        </SuspenseList>
      );
    }

    ReactNoop.render(
      <Foo
        items={[
          ['A', A],
          ['D', D],
        ]}
      />,
    );

    await A.resolve();
    await D.resolve();

    await waitForAll(['A', 'D']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>D</span>
      </>,
    );

    // 在列表的指定位置插入新行，观察已提交区与 tail 的协调。
    ReactNoop.render(
      <Foo
        items={[
          ['A', A],
          ['B', B],
          ['C', C],
          ['D', D],
          ['E', E],
          ['F', F],
        ]}
      />,
    );

    await waitForAll([
      'A',
      'Suspend! [B]',
      'Loading B',
      'Suspend! [C]',
      'Loading C',
      'D',
      'A',
      'Loading B',
      'Loading C',
      'D',
      'Loading E',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading B</span>
        <span>Loading C</span>
        <span>D</span>
        <span>Loading E</span>
      </>,
    );

    await B.resolve();

    await waitForAll(['B', 'Suspend! [C]']);

    jest.advanceTimersByTime(500);

    // 该行仍被后续未就绪行阻塞，不能提前揭示。
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading B</span>
        <span>Loading C</span>
        <span>D</span>
        <span>Loading E</span>
      </>,
    );

    await C.resolve();
    await E.resolve();

    await waitForAll(['B', 'C', 'E', 'Suspend! [F]', 'Loading F']);

    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
        <span>D</span>
        <span>E</span>
        <span>Loading F</span>
      </>,
    );

    await F.resolve();

    await waitForAll(['F']);

    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
        <span>D</span>
        <span>E</span>
        <span>F</span>
      </>,
    );
  });

  /** legacy-backwards/collapsed 已显示 C/F 后插入 A/B/D/E；head 的 D/E 占位均保留，反向 tail 只显示 Loading B。D 完成仍等 E，随后推进到 Loading A，最后 ABCDEF。验证反向中部插入不被 collapsed 合并掉。 */
  // @gate enableSuspenseList
  it('adding to the middle does not collapse insertions (backwards)', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');
    const D = createAsyncText('D');
    const E = createAsyncText('E');
    const F = createAsyncText('F');

    /** 按 key 生成 legacy-backwards/collapsed 行，C/F 之间插入 D/E、前面追加 A/B。 */
    function Foo({items}) {
      return (
        <SuspenseList revealOrder="unstable_legacy-backwards" tail="collapsed">
          {items.map(([key, Component]) => (
            <Suspense key={key} fallback={<Text text={'Loading ' + key} />}>
              <Component />
            </Suspense>
          ))}
        </SuspenseList>
      );
    }

    ReactNoop.render(
      <Foo
        items={[
          ['C', C],
          ['F', F],
        ]}
      />,
    );

    await C.resolve();
    await F.resolve();

    await waitForAll(['F', 'C']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>C</span>
        <span>F</span>
      </>,
    );

    // 在列表的指定位置插入新行，观察已提交区与 tail 的协调。
    ReactNoop.render(
      <Foo
        items={[
          ['A', A],
          ['B', B],
          ['C', C],
          ['D', D],
          ['E', E],
          ['F', F],
        ]}
      />,
    );

    await waitForAll([
      'C',
      'Suspend! [D]',
      'Loading D',
      'Suspend! [E]',
      'Loading E',
      'F',
      'C',
      'Loading D',
      'Loading E',
      'F',
      'Loading B',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>Loading B</span>
        <span>C</span>
        <span>Loading D</span>
        <span>Loading E</span>
        <span>F</span>
      </>,
    );

    await D.resolve();

    await waitForAll(['D', 'Suspend! [E]']);

    jest.advanceTimersByTime(500);

    // 该行仍被后续未就绪行阻塞，不能提前揭示。
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>Loading B</span>
        <span>C</span>
        <span>Loading D</span>
        <span>Loading E</span>
        <span>F</span>
      </>,
    );

    await C.resolve();
    await E.resolve();

    await B.resolve();
    await C.resolve();
    await D.resolve();
    await E.resolve();

    await waitForAll(['D', 'E', 'B', 'Suspend! [A]', 'Loading A']);

    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>Loading A</span>
        <span>B</span>
        <span>C</span>
        <span>D</span>
        <span>E</span>
        <span>F</span>
      </>,
    );

    await A.resolve();

    await waitForAll(['A']);

    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
        <span>D</span>
        <span>E</span>
        <span>F</span>
      </>,
    );
  });

  /** collapsed 先显示 A 与同步 D；插入 B/C/E/F 并把 D 改成异步后，D 的旧宿主节点隐藏但保留，B 完成可先出现。验证已提交行转入 fallback 后仍界定 tail，和未挂载 head 插入的成组等待不同。 */
  // @gate enableSuspenseList
  it('adding to the middle of committed tail does not collapse insertions', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');
    const D = createAsyncText('D');
    const E = createAsyncText('E');
    const F = createAsyncText('F');

    /** 固定输出同步 D，作为稍后同 key 改用异步 D 时保留的旧主树。 */
    function SyncD() {
      return <Text text="D" />;
    }

    /** 按 key 生成 forwards/collapsed 行，允许把已显示同步 D 替换为异步 D。 */
    function Foo({items}) {
      return (
        <SuspenseList revealOrder="forwards" tail="collapsed">
          {items.map(([key, Component]) => (
            <Suspense key={key} fallback={<Text text={'Loading ' + key} />}>
              <Component />
            </Suspense>
          ))}
        </SuspenseList>
      );
    }

    ReactNoop.render(
      <Foo
        items={[
          ['A', A],
          ['D', SyncD],
        ]}
      />,
    );

    await A.resolve();

    await waitForAll(['A', 'D']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>D</span>
      </>,
    );

    // 在列表的指定位置插入新行，观察已提交区与 tail 的协调。
    ReactNoop.render(
      <Foo
        items={[
          ['A', A],
          ['B', B],
          ['C', C],
          ['D', D],
          ['E', E],
          ['F', F],
        ]}
      />,
    );

    await waitForAll([
      'A',
      'Suspend! [B]',
      'Loading B',
      'Suspend! [C]',
      'Loading C',
      'Suspend! [D]',
      'Loading D',
      'A',
      'Loading B',
      'Loading C',
      'Suspend! [D]',
      'Loading D',
      'Loading E',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [B]',
    ]);

    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading B</span>
        <span>Loading C</span>
        <span hidden={true}>D</span>
        <span>Loading D</span>
        <span>Loading E</span>
      </>,
    );

    await B.resolve();

    await waitForAll([
      'B',
      'Suspend! [C]',
      ...(!gate('alwaysThrottleRetries') ? ['Suspend! [C]'] : []),
    ]);

    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>Loading C</span>
        <span hidden={true}>D</span>
        <span>Loading D</span>
        <span>Loading E</span>
      </>,
    );

    await C.resolve();
    await D.resolve();
    await E.resolve();

    await waitForAll(['C', 'D', 'E', 'Suspend! [F]', 'Loading F']);

    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
        <span>D</span>
        <span>E</span>
        <span>Loading F</span>
      </>,
    );

    await F.resolve();

    await waitForAll(['F']);

    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
        <span>D</span>
        <span>E</span>
        <span>F</span>
      </>,
    );
  });

  /** 显式 hidden 的 A/B/C 都待决；逐一解析得到 null→A→AB→ABC，加载 Text 虽被渲染却不成为可见输出。验证初挂 tail 的 fallback 被裁剪。 */
  // @gate enableSuspenseList
  it('only shows no initial loading state "hidden" tail insertions', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 显式设置 forwards/hidden，三行自带 fallback 用于观察渲染与提交差别。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="forwards" tail="hidden">
          <Suspense fallback={<Text text="Loading A" />}>
            <A />
          </Suspense>
          <Suspense fallback={<Text text="Loading B" />}>
            <B />
          </Suspense>
          <Suspense fallback={<Text text="Loading C" />}>
            <C />
          </Suspense>
        </SuspenseList>
      );
    }

    ReactNoop.render(<Foo />);

    await waitForAll(['Suspend! [A]', 'Loading A']);

    expect(ReactNoop).toMatchRenderedOutput(null);

    await A.resolve();

    await waitForAll(['A', 'Suspend! [B]', 'Loading B']);

    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(<span>A</span>);

    await act(() => B.resolve());
    assertLog(['B', 'Suspend! [C]', 'Loading C']);

    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
      </>,
    );

    await act(() => C.resolve());
    assertLog(['C']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** hidden 的直接行是 div/A、B、C，没有逐行边界，外包 Loading root；初始输出 null，解析 A/B/C 后逐项出现，外层 fallback 不阻止已完成前缀的揭示。 */
  // @gate enableSuspenseList
  it('reveals "hidden" rows one by one without suspense boundaries', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 让 hidden 列表直接包含异步行，A 额外包在 div 下以检查宿主结构。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="forwards" tail="hidden">
          <div>
            <A />
          </div>
          <B />
          <C />
        </SuspenseList>
      );
    }

    ReactNoop.render(
      <Suspense fallback="Loading root">
        <Foo />
      </Suspense>,
    );

    await waitForAll(['Suspend! [A]']);

    expect(ReactNoop).toMatchRenderedOutput(null);

    await act(() => A.resolve());
    assertLog(['A', 'Suspend! [B]']);

    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span>A</span>
      </div>,
    );

    await act(() => B.resolve());
    assertLog(['B', 'Suspend! [C]']);

    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <div>
          <span>A</span>
        </div>
        <span>B</span>
      </>,
    );

    await act(() => C.resolve());
    assertLog(['C']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <div>
          <span>A</span>
        </div>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** visible 先挂载 A 和仍显示 fallback 的 C，MountCount=1；换成 hidden 并在 C 前插入待决 B 时 C fallback 仍保留，解析 B/C 后为 ABC且 count 仍为1。验证已挂载 tail 行不被裁剪重挂载。 */
  // @gate enableSuspenseList
  it('preserves already mounted rows when a new hidden on is inserted in the tail', async () => {
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    let count = 0;
    /** 在 layout mount 增加计数，检测 tail 行是否错误重挂载。 */
    function MountCount({children}) {
      React.useLayoutEffect(() => {
        count++;
      }, []);
      return children;
    }

    /** 随 insert 从 visible 切到 hidden，并在 MountCount 包装的 C 前插入 B。 */
    function Foo({insert}) {
      return (
        <SuspenseList
          revealOrder="forwards"
          tail={insert ? 'hidden' : 'visible'}>
          <Text text="A" />
          {insert ? <B /> : null}
          <MountCount>
            <Suspense fallback={<Text text="Loading C" />}>
              <C />
            </Suspense>
          </MountCount>
        </SuspenseList>
      );
    }

    await act(() => {
      ReactNoop.render(<Foo insert={false} />);
    });
    assertLog(['A', 'Suspend! [C]', 'Loading C', 'Suspend! [C]']);

    expect(count).toBe(1);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading C</span>
      </>,
    );

    await act(() => {
      ReactNoop.render(<Foo insert={true} />);
    });

    assertLog(['A', 'Suspend! [B]', 'A', 'Suspend! [B]']);

    expect(count).toBe(1);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading C</span>
      </>,
    );

    await act(async () => {
      await B.resolve();
      await C.resolve();
    });

    assertLog(['A', 'B', 'C']);

    expect(count).toBe(1);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** collapsed 直接 A/C 没有边界，只有 B 自带 fallback，外包 Loading root；A 待决显示 root fallback，A 完成显示 A/Loading B，B 完成仍被 C 阻塞，C 完成才显示 ABC。验证无边界行的挂起向外传播。 */
  // @gate enableSuspenseList
  it('reveals "collapsed" rows one by one after the first without boundaries', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 将直接异步 A、带边界 B、直接异步 C 混合在 collapsed 列表中。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="forwards" tail="collapsed">
          <A />
          <Suspense fallback={<Text text="Loading B" />}>
            <B />
          </Suspense>
          <C />
        </SuspenseList>
      );
    }

    await act(async () => {
      ReactNoop.render(
        <Suspense fallback="Loading root">
          <Foo />
        </Suspense>,
      );
      await waitForAll(['Suspend! [A]', 'Suspend! [A]']);
    });

    expect(ReactNoop).toMatchRenderedOutput('Loading root');

    await A.resolve();

    await waitForAll(['A', 'Suspend! [B]', 'Loading B']);

    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading B</span>
      </>,
    );

    await act(() => B.resolve());
    assertLog(['B', 'Suspend! [C]', 'B', 'Suspend! [C]']);

    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading B</span>
      </>,
    );

    await act(() => C.resolve());
    assertLog(['B', 'C']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** 外层 together 包含 inner forwards/visible 的 ABC 与 D；B 待决时所有四行显示 fallback，解析 B 后输出 ABCD，验证内层列表的挂起标记在 retry 中清除。 */
  // @gate enableSuspenseList
  it('eventually resolves a nested forwards suspense list', async () => {
    const B = createAsyncText('B');

    /** 用 outer together 组合内层 ABC forwards/visible 与独立 D 行。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="together">
          <SuspenseList revealOrder="forwards" tail="visible">
            <Suspense fallback={<Text text="Loading A" />}>
              <Text text="A" />
            </Suspense>
            <Suspense fallback={<Text text="Loading B" />}>
              <B />
            </Suspense>
            <Suspense fallback={<Text text="Loading C" />}>
              <Text text="C" />
            </Suspense>
          </SuspenseList>
          <Suspense fallback={<Text text="Loading D" />}>
            <Text text="D" />
          </Suspense>
        </SuspenseList>
      );
    }

    ReactNoop.render(<Foo />);

    await waitForAll([
      'A',
      'Suspend! [B]',
      'Loading B',
      'Loading C',
      'D',
      'Loading A',
      'Loading B',
      'Loading C',
      'Loading D',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>Loading A</span>
        <span>Loading B</span>
        <span>Loading C</span>
        <span>Loading D</span>
      </>,
    );

    await act(() => B.resolve());
    assertLog(['A', 'B', 'C', 'D']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
        <span>D</span>
      </>,
    );
  });

  /** outer together 含 inner forwards/hidden 的 A/B 及 C；B 待决时 hidden 内层裁剪自身内容，外层只留下 Loading C，解析 B 后输出 ABC。验证嵌套 hidden tail 能最终恢复。 */
  // @gate enableSuspenseList
  it('eventually resolves a nested forwards suspense list with a hidden tail', async () => {
    const B = createAsyncText('B');

    /** 用 outer together 组合 A/B hidden 列表与同步 C 边界。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="together">
          <SuspenseList revealOrder="forwards" tail="hidden">
            <Suspense fallback={<Text text="Loading A" />}>
              <Text text="A" />
            </Suspense>
            <Suspense fallback={<Text text="Loading B" />}>
              <B />
            </Suspense>
          </SuspenseList>
          <Suspense fallback={<Text text="Loading C" />}>
            <Text text="C" />
          </Suspense>
        </SuspenseList>
      );
    }

    ReactNoop.render(<Foo />);

    await waitForAll(['A', 'Suspend! [B]', 'Loading B', 'C', 'Loading C']);

    expect(ReactNoop).toMatchRenderedOutput(<span>Loading C</span>);

    await act(() => B.resolve());
    assertLog(['A', 'B', 'C']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** 两层 forwards：内层 hidden 原先只有 A，外层还有 C；追加待决 B 时保持 AC，B 完成后为 ABC。验证已显示 A/C 不受新增 hidden tail 阻塞。 */
  // @gate enableSuspenseList
  it('eventually resolves two nested forwards suspense lists with a hidden tail', async () => {
    const B = createAsyncText('B');

    /** 内层 hidden 依据 showB 追加 B，外层 forwards/visible 保留 C。 */
    function Foo({showB}) {
      return (
        <SuspenseList revealOrder="forwards" tail="visible">
          <SuspenseList revealOrder="forwards" tail="hidden">
            <Suspense fallback={<Text text="Loading A" />}>
              <Text text="A" />
            </Suspense>
            {showB ? (
              <Suspense fallback={<Text text="Loading B" />}>
                <B />
              </Suspense>
            ) : null}
          </SuspenseList>
          <Suspense fallback={<Text text="Loading C" />}>
            <Text text="C" />
          </Suspense>
        </SuspenseList>
      );
    }

    ReactNoop.render(<Foo showB={false} />);

    await waitForAll(['A', 'C']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>C</span>
      </>,
    );

    ReactNoop.render(<Foo showB={true} />);

    await waitForAll(['A', 'Suspend! [B]', 'Loading B', 'C', 'A', 'C']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>C</span>
      </>,
    );

    await act(() => B.resolve());
    assertLog(['B']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** 列表 A/B 已显示且相邻 state 为 -；只将相邻 state 改成 C，日志只有 C、列表输出保持 A/B。验证无关子树更新可通过列表 bailout。 */
  // @gate enableSuspenseList
  it('can do unrelated adjacent updates', async () => {
    let updateAdjacent;
    /** 暴露列表相邻文本的更新器，检查 SuspenseList 不阻塞这条独立更新。 */
    function Adjacent() {
      const [text, setText] = React.useState('-');
      updateAdjacent = setText;
      return <Text text={text} />;
    }

    /** 在 div 中并排放置静态 A/B 列表和有状态 Adjacent。 */
    function Foo() {
      return (
        <div>
          <SuspenseList revealOrder="forwards" tail="visible">
            <Text text="A" />
            <Text text="B" />
          </SuspenseList>
          <Adjacent />
        </div>
      );
    }

    ReactNoop.render(<Foo />);

    await waitForAll(['A', 'B', '-']);

    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span>A</span>
        <span>B</span>
        <span>-</span>
      </div>,
    );

    await act(() => updateAdjacent('C'));

    assertLog(['C']);

    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </div>,
    );
  });

  /** hidden 列表已显示 A/Sync B；B 自身 state 切到异步后显示 Loading B，父列表更新仍保留它，解析资源后显示 AB 且 setter 身份不变。验证 hidden 只裁剪新行，不删除已挂载行状态。 */
  // @gate enableSuspenseList
  it('is able to re-suspend the last rows during an update with hidden', async () => {
    const AsyncB = createAsyncText('B');

    let setAsyncB;

    /** 暴露 setAsyncB，在同步文本与含 AsyncB 的边界之间切换。 */
    function B() {
      const [shouldBeAsync, setAsync] = React.useState(false);
      setAsyncB = setAsync;

      return shouldBeAsync ? (
        <Suspense fallback={<Text text="Loading B" />}>
          <AsyncB />
        </Suspense>
      ) : (
        <Text text="Sync B" />
      );
    }

    /** 让 B 在同步文本和异步边界之间切换，并把父更新 prop 传入同一 key。 */
    function Foo({updateList}) {
      return (
        <SuspenseList revealOrder="forwards" tail="hidden">
          <Suspense key="A" fallback={<Text text="Loading A" />}>
            <Text text="A" />
          </Suspense>
          <B key="B" updateList={updateList} />
        </SuspenseList>
      );
    }

    ReactNoop.render(<Foo />);

    await waitForAll(['A', 'Sync B']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Sync B</span>
      </>,
    );

    const previousInst = setAsyncB;

    await act(() => setAsyncB(true));

    assertLog([
      'Suspend! [B]',
      'Loading B',
      'Loading B',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading B</span>
      </>,
    );

    await act(() => ReactNoop.render(<Foo updateList={true} />));

    assertLog([
      'A',
      'Suspend! [B]',
      'Loading B',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [B]',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading B</span>
      </>,
    );

    await act(() => AsyncB.resolve());
    assertLog(['B']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
      </>,
    );

    expect(previousInst).toBe(setAsyncB);
  });

  /** transition 追加 B/C/D 后在 B/C 日志处暂停；flushSync 使首行读取待决 A并显示 Loading A，低优先级重试保持该输出；A 解析后出现 ABCD。验证打断后更新队列和列表 render state 能重建完成。 */
  // @gate enableSuspenseList
  it('is able to interrupt a partially rendered tree and continue later', async () => {
    const AsyncA = createAsyncText('A');

    let updateLowPri;
    let updateHighPri;

    /** 保存高优先级开关，打开后读取 AsyncA；独立于父 Foo 的低优先级追加更新。 */
    function Bar() {
      const [highPriState, setHighPriState] = React.useState(false);
      updateHighPri = setHighPriState;
      return highPriState ? <AsyncA /> : null;
    }

    /** Foo 的 state 追加 B/C/D，Bar 的独立 state 切换首行是否读取 AsyncA。 */
    function Foo() {
      const [lowPriState, setLowPriState] = React.useState(false);
      updateLowPri = setLowPriState;
      return (
        <SuspenseList revealOrder="forwards" tail="hidden">
          <Suspense key="A" fallback={<Text text="Loading A" />}>
            <Bar />
          </Suspense>
          {lowPriState ? <Text text="B" /> : null}
          {lowPriState ? <Text text="C" /> : null}
          {lowPriState ? <Text text="D" /> : null}
        </SuspenseList>
      );
    }

    ReactNoop.render(<Foo />);

    await waitForAll([]);

    expect(ReactNoop).toMatchRenderedOutput(null);

    await act(async () => {
      // 在列表的指定位置插入新行，观察已提交区与 tail 的协调。
      React.startTransition(() => {
        updateLowPri(true);
      });

      // 分段冲刷或让出调度工作，以锁定当前渲染检查点。
      await waitFor(['B', 'C']);

      ReactNoop.flushSync(() => updateHighPri(true));

      assertLog([
        'Suspend! [A]',
        'Loading A',
        'Suspend! [A]',
        'Loading A',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(<span>Loading A</span>);

      // 以低优先级再次重试。
      await waitForAll([
        'Suspend! [A]',
        'Loading A',
        // 执行预热渲染，不把该遍结果作为最终提交。
        'Suspend! [A]',
      ]);
      expect(ReactNoop).toMatchRenderedOutput(<span>Loading A</span>);
    });

    await act(() => AsyncA.resolve());
    assertLog(['A', 'B', 'C', 'D']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
        <span>D</span>
      </>,
    );
  });

  /** together 两行各经过一个只透传 children 的类；预解 A 而 B 待决时两份 fallback，解析 B并重渲染后输出 AB。验证第二遍协调可恢复类后代，不测试实例 state 或生命周期。 */
  // @gate enableSuspenseList
  it('can resume class components when revealed together', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');

    /** 只透传 children 的类行包装器，验证列表第二遍协调可恢复类后代。 */
    class ClassComponent extends React.Component {
      /** 直接返回同一 props.children，不定义 state 或生命周期日志。 */
      render() {
        return this.props.children;
      }
    }

    /** 外层 Suspense 内的 together 两行分别经由透传 ClassComponent 包装。 */
    function Foo() {
      return (
        <Suspense fallback={<Text text="Loading" />}>
          <SuspenseList revealOrder="together">
            <ClassComponent>
              <Suspense fallback={<Text text="Loading A" />}>
                <A />
              </Suspense>
            </ClassComponent>
            <ClassComponent>
              <Suspense fallback={<Text text="Loading B" />}>
                <B />
              </Suspense>
            </ClassComponent>
          </SuspenseList>
        </Suspense>
      );
    }

    await A.resolve();

    ReactNoop.render(<Foo />);

    await waitForAll([
      'A',
      'Suspend! [B]',
      'Loading B',
      'Loading A',
      'Loading B',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>Loading A</span>
        <span>Loading B</span>
      </>,
    );

    await B.resolve();

    ReactNoop.render(<Foo />);

    await waitForAll(['A', 'B']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
      </>,
    );
  });

  /** hidden 三行各模拟 600ms CPU，其中 A/B 首次 layout 把 pass 从0改成1；检查点依次 A、AB、ABC。验证预算分段揭示与 layout 发出的更新能够在 tail 协调中继续完成。 */
  // @gate enableSuspenseList
  it('should be able to progressively show CPU expensive rows with two pass rendering', async () => {
    /** 初次 render 输出 First Pass；只有 layout 提交后才 setPass(1)，下一轮输出 text。 */
    function TwoPass({text}) {
      const [pass, setPass] = React.useState(0);
      React.useLayoutEffect(() => {
        Scheduler.log('Mount ' + text);
        setPass(1);
      }, []);
      return <Text text={pass === 0 ? 'First Pass ' + text : text} />;
    }

    /** Sleep 消耗指定 CPU 时间，迫使 SuspenseList 跨越渲染预算并进入第二遍协调。 */
    function Sleep({time, children}) {
      Scheduler.unstable_advanceTime(time);
      return children;
    }

    /** 以三个 600ms Sleep 包装行，A/B 还经过 layout 二次渲染组件，tail 为 hidden。 */
    function App() {
      Scheduler.log('App');
      return (
        <SuspenseList revealOrder="forwards" tail="hidden">
          <Suspense fallback={<Text text="Loading A" />}>
            <Sleep time={600}>
              <TwoPass text="A" />
            </Sleep>
          </Suspense>
          <Suspense fallback={<Text text="Loading B" />}>
            <Sleep time={600}>
              <TwoPass text="B" />
            </Sleep>
          </Suspense>
          <Sleep time={600}>
            <Text text="C" />
          </Sleep>
        </SuspenseList>
      );
    }

    React.startTransition(() => {
      ReactNoop.render(<App />);
    });

    await waitFor(['App', 'First Pass A', 'Mount A', 'A']);
    expect(ReactNoop).toMatchRenderedOutput(<span>A</span>);

    await waitFor(['First Pass B', 'Mount B', 'B']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
      </>,
    );

    await waitForAll(['C']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** visible 三行各模拟 600ms CPU且 A/B 在 layout 中改 pass；第一阶段显示 A/Loading B/Loading C，再 AB/Loading C，最后 ABC。验证渐进提交保留可见 tail fallback。 */
  // @gate enableSuspenseList
  it('should be able to progressively show rows with two pass rendering and visible', async () => {
    /** 初次 render 输出 First Pass；只有 layout 提交后才 setPass(1)，下一轮输出 text。 */
    function TwoPass({text}) {
      const [pass, setPass] = React.useState(0);
      React.useLayoutEffect(() => {
        Scheduler.log('Mount ' + text);
        setPass(1);
      }, []);
      return <Text text={pass === 0 ? 'First Pass ' + text : text} />;
    }

    /** Sleep 消耗指定 CPU 时间，迫使 SuspenseList 跨越渲染预算并进入第二遍协调。 */
    function Sleep({time, children}) {
      Scheduler.unstable_advanceTime(time);
      return children;
    }

    /** 以三个 600ms Sleep 包装边界，A/B 经过 layout 二次渲染组件，tail 为 visible。 */
    function App() {
      Scheduler.log('App');
      return (
        <SuspenseList revealOrder="forwards" tail="visible">
          <Suspense fallback={<Text text="Loading A" />}>
            <Sleep time={600}>
              <TwoPass text="A" />
            </Sleep>
          </Suspense>
          <Suspense fallback={<Text text="Loading B" />}>
            <Sleep time={600}>
              <TwoPass text="B" />
            </Sleep>
          </Suspense>
          <Suspense fallback={<Text text="Loading C" />}>
            <Sleep time={600}>
              <Text text="C" />
            </Sleep>
          </Suspense>
        </SuspenseList>
      );
    }

    React.startTransition(() => {
      ReactNoop.render(<App />);
    });

    await waitFor([
      'App',
      'First Pass A',
      'Loading B',
      'Loading C',
      'Mount A',
      'A',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </>,
    );

    await waitFor(['First Pass B', 'Mount B', 'B']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>Loading C</span>
      </>,
    );

    await waitForAll(['C']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** Profiler 包住 Sleep=1/4/5/12ms 的行及3ms fallback；先挂 C、改同步 C、追加待决 D再解析 C。精确核对每阶段 callback 次数及 actual/base duration 的 alwaysThrottleRetries 分支，避免把丢弃或后台工作算成固定一次提交。 */
  // @gate enableProfilerTimer
  // @gate enableSuspenseList
  it('counts the actual duration when profiling a SuspenseList', async () => {
    // Profiler 回调参数顺序为 id、phase、actualDuration、treeBaseDuration。
    const onRender = jest.fn();

    /** 记录 Fallback并模拟3ms渲染耗时，作为Profiler的可见占位与耗时对照。 */
    const Fallback = () => {
      Scheduler.log('Fallback');
      Scheduler.unstable_advanceTime(3);
      return <span>Loading...</span>;
    };

    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');
    const D = createAsyncText('D');
    await A.resolve();
    await B.resolve();

    /** 按 time 推进模拟时钟，再返回 children；Profiler 用各行的不同耗时核对 actualDuration 与 treeBaseDuration。 */
    function Sleep({time, children}) {
      Scheduler.unstable_advanceTime(time);
      return children;
    }

    /** Profiler 内按 addRow/suspendTail 添加 D或切换 C 的挂起状态，各行模拟不同耗时。 */
    function App({addRow, suspendTail}) {
      Scheduler.log('App');
      return (
        <Profiler id="root" onRender={onRender}>
          <SuspenseList revealOrder="forwards" tail="visible">
            <Suspense fallback={<Fallback />}>
              <Sleep time={1}>
                <A />
              </Sleep>
            </Suspense>
            <Suspense fallback={<Fallback />}>
              <Sleep time={4}>
                <B />
              </Sleep>
            </Suspense>
            <Suspense fallback={<Fallback />}>
              <Sleep time={5}>{suspendTail ? <C /> : <Text text="C" />}</Sleep>
            </Suspense>
            {addRow ? (
              <Suspense fallback={<Fallback />}>
                <Sleep time={12}>
                  <D />
                </Sleep>
              </Suspense>
            ) : null}
          </SuspenseList>
        </Profiler>
      );
    }

    ReactNoop.render(<App suspendTail={true} />);

    await waitForAll([
      'App',
      'A',
      'B',
      'Suspend! [C]',
      'Fallback',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [C]',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>Loading...</span>
      </>,
    );
    expect(onRender).toHaveBeenCalledTimes(
      gate('alwaysThrottleRetries') ? 1 : 2,
    );


    // `actualDuration`：本次提交的render 尝试中累计到该提交的耗时（ms），包含被挂起的读取前工作。
    expect(onRender.mock.calls[0][2]).toBe(1 + 4 + 5 + 3);
    // `treeBaseDuration`：已提交子树保存的各节点最近一次基础耗时总和（ms）；不是所有尝试的耗时总和。
    expect(onRender.mock.calls[0][3]).toBe(1 + 4 + 3);

    ReactNoop.render(<App suspendTail={false} />);

    await waitForAll(['App', 'A', 'B', 'C']);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
    expect(onRender).toHaveBeenCalledTimes(
      gate('alwaysThrottleRetries') ? 2 : 3,
    );

    // `actualDuration`：本次提交的render 尝试中累计到该提交的耗时（ms），包含被挂起的读取前工作。
    expect(onRender.mock.calls[1][2]).toBe(
      gate('alwaysThrottleRetries') ? 1 + 4 + 5 : 5,
    );
    // `treeBaseDuration`：已提交子树保存的各节点最近一次基础耗时总和（ms）；不是所有尝试的耗时总和。
    expect(onRender.mock.calls[1][3]).toBe(
      gate('alwaysThrottleRetries') ? 1 + 4 + 5 : 8,
    );

    ReactNoop.render(<App addRow={true} suspendTail={true} />);

    await waitForAll([
      'App',
      'A',
      'B',
      'Suspend! [C]',
      'Fallback',
      'A',
      'B',
      'Suspend! [C]',
      'Fallback',
      'Fallback',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [C]',
    ]);

    jest.advanceTimersByTime(1000);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span hidden={true}>C</span>
        <span>Loading...</span>
        <span>Loading...</span>
      </>,
    );
    expect(onRender).toHaveBeenCalledTimes(
      gate('alwaysThrottleRetries') ? 4 : 5,
    );


    // `actualDuration`：本次提交的render 尝试中累计到该提交的耗时（ms），包含被挂起的读取前工作。
    expect(onRender.mock.calls[2][2]).toBe(
      gate('alwaysThrottleRetries') ? (1 + 4 + 5 + 3) * 2 + 3 : 10,
    );
    // `treeBaseDuration`：已提交子树保存的各节点最近一次基础耗时总和（ms）；不是所有尝试的耗时总和。
    expect(onRender.mock.calls[2][3]).toBe(
      gate('alwaysThrottleRetries') ? 1 + 4 + 3 + 3 : 10,
    );

    await act(() => C.resolve());
    assertLog([
      'C',
      'Suspend! [D]',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [D]',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
        <span>Loading...</span>
      </>,
    );

    expect(onRender).toHaveBeenCalledTimes(
      gate('alwaysThrottleRetries') ? 6 : 7,
    );

    // `actualDuration`：本次提交的render 尝试中累计到该提交的耗时（ms），包含被挂起的读取前工作。
    expect(onRender.mock.calls[5][2]).toBe(
      gate('alwaysThrottleRetries') ? 12 : 17,
    );
    // `treeBaseDuration`：已提交子树保存的各节点最近一次基础耗时总和（ms）；不是所有尝试的耗时总和。
    expect(onRender.mock.calls[5][3]).toBe(1 + 4 + 5 + 3);
  });

  /** forwards/visible 每个边界上包四层 memo透传；预解 C仍全 fallback，解析 A得到 A与B/C占位，解析 B得到 ABC。验证列表强制 fallback 的传播不会被多层 memo bailout 截断。 */
  // @gate enableSuspenseList
  it('propagates despite a memo bailout', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 透传 children 的 memo 包装器；retry 时 props 不变，验证列表上下文仍可传播到边界。 */
    const Bailout = React.memo(({children}) => {
      return children;
    });

    /** 每行边界外加四层 Bailout，检查 SuspenseList 上下文传播跨越 memo 层。 */
    function Foo() {
      // 必须在 Suspense 父级之上提前退出，才能复现该传播边界。
      return (
        <SuspenseList revealOrder="forwards" tail="visible">
          <Bailout>
            <Bailout>
              <Bailout>
                <Bailout>
                  <Suspense fallback={<Text text="Loading A" />}>
                    <A />
                  </Suspense>
                </Bailout>
              </Bailout>
            </Bailout>
          </Bailout>
          <Bailout>
            <Bailout>
              <Bailout>
                <Bailout>
                  <Suspense fallback={<Text text="Loading B" />}>
                    <B />
                  </Suspense>
                </Bailout>
              </Bailout>
            </Bailout>
          </Bailout>
          <Bailout>
            <Bailout>
              <Bailout>
                <Bailout>
                  <Suspense fallback={<Text text="Loading C" />}>
                    <C />
                  </Suspense>
                </Bailout>
              </Bailout>
            </Bailout>
          </Bailout>
        </SuspenseList>
      );
    }

    await C.resolve();

    ReactNoop.render(<Foo />);

    await waitForAll([
      'Suspend! [A]',
      'Loading A',
      'Loading B',
      'Loading C',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>Loading A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </>,
    );

    await act(() => A.resolve());
    assertLog(['A', 'Suspend! [B]', 'Suspend! [B]']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </>,
    );

    await act(() => B.resolve());
    assertLog(['B', 'C']);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /** 初始显示 B1/C；更新插入待决 A和新 D，同时将 B 换成含同步 B2 的内层边界。输出 Loading A/B2/C/Loading D，解析 A后为 A/B2/C/D；内层抛错 fallback 从未执行。验证强制 fallback 只作用于目标边界层。 */
  // @gate enableSuspenseList
  it(
    'regression test: SuspenseList should never force boundaries deeper than ' +
      'a single level into fallback mode',
    async () => {
      const A = createAsyncText('A');

      /** 一旦执行立即抛错，作为不应被列表强制到达的内层 fallback 哨兵。 */
      function UnreachableFallback() {
        throw new Error('Should never be thrown!');
      }

      /** 按 update 插入 A/D并将 B1 换成嵌套同步 B2，内层 fallback 是抛错哨兵。 */
      function Repro({update}) {
        return (
          <SuspenseList revealOrder="forwards" tail="visible">
            {update && (
              <Suspense fallback={<Text text="Loading A..." />}>
                <A />
              </Suspense>
            )}
            <Suspense fallback={<Text text="Loading B..." />}>
              {update ? (
                <Suspense fallback={<UnreachableFallback />}>
                  <Text text="B2" />
                </Suspense>
              ) : (
                <Text text="B1" />
              )}
            </Suspense>
            <Suspense fallback={<Text text="Loading C..." />}>
              <Text text="C" />
            </Suspense>
            {update && (
              <Suspense fallback={<Text text="Loading D..." />}>
                <Text text="D" />
              </Suspense>
            )}
          </SuspenseList>
        );
      }

      const root = ReactNoop.createRoot();
      await act(() => root.render(<Repro update={false} />));
      assertLog(['B1', 'C']);
      expect(root).toMatchRenderedOutput(
        <>
          <span>B1</span>
          <span>C</span>
        </>,
      );

      await act(() => root.render(<Repro update={true} />));
      assertLog([
        'Suspend! [A]',
        'Loading A...',
        'B2',
        'C',

        //
        //
        'Loading A...',
        'B2',
        'C',

        'Loading D...',
      ]);
      expect(root).toMatchRenderedOutput(
        <>
          <span>Loading A...</span>
          <span>B2</span>
          <span>C</span>
          <span>Loading D...</span>
        </>,
      );

      await act(() => A.resolve());
      assertLog(['A', 'D']);
      expect(root).toMatchRenderedOutput(
        <>
          <span>A</span>
          <span>B2</span>
          <span>C</span>
          <span>D</span>
        </>,
      );
    },
  );

  /** forwards 直接收到 yield A/B 的 async generator 组件；transition 渲染后断言 generator列表诊断、async客户端组件诊断和未缓存Promise诊断，不断言最终输出。 */
  // @gate enableSuspenseList && enableAsyncIterableChildren
  it('warns for async generator components in "forwards" order', async () => {
    /** 生成 A/B 的 async generator 组件，用于检查 SuspenseList 对 generator 组件的开发诊断。 */
    async function* Generator() {
      yield 'A';
      yield 'B';
    }
    /** 将 async generator 组件作为 forwards 的唯一直接行，触发结构及async诊断。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="forwards" tail="visible">
          <Generator />
        </SuspenseList>
      );
    }

    await act(() => {
      React.startTransition(() => {
        ReactNoop.render(<Foo />);
      });
    });
    assertConsoleErrorDev([
      'A generator Component was passed to a <SuspenseList revealOrder="forwards" />. ' +
        'This is not supported as a way to generate lists. Instead, pass an ' +
        'iterable as the children.' +
        '\n    in SuspenseList (at **)' +
        '\n    in Foo (at **)',
      '<Generator> is an async Client Component. ' +
        'Only Server Components can be async at the moment. ' +
        "This error is often caused by accidentally adding `'use client'` " +
        'to a module that was originally written for the server.\n' +
        '    in Foo (at **)',
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in Foo (at **)',
    ]);
  });

  /** forwards/visible 直接消费 yield ASlot/BSlot 的 async iterable；A待决时两份占位，解析A后 A/Loading B，解析B后 AB，每阶段断言迭代 Promise 未缓存告警。验证异步迭代产生的行遵守有序协调。 */
  // @gate enableSuspenseList && enableAsyncIterableChildren
  it('can display async iterable in "forwards" order', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');

    const ASlot = (
      <Suspense key="A" fallback={<Text text="Loading A" />}>
        <A />
      </Suspense>
    );

    const BSlot = (
      <Suspense key="B" fallback={<Text text="Loading B" />}>
        <B />
      </Suspense>
    );

    const iterable = {
      /** 每次调用创建异步生成器，依次产出下面两个列表项。 */
      async *[Symbol.asyncIterator]() {
        yield ASlot;
        yield BSlot;
      },
    };

    /** 把异步 iterable 作为全部 children，依次产出稳定 keyed A/B边界元素。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="forwards" tail="visible">
          {iterable}
        </SuspenseList>
      );
    }

    await act(() => {
      React.startTransition(() => {
        ReactNoop.render(<Foo />);
      });
    });

    assertLog([
      'Suspend! [A]',
      'Loading A',
      'Loading B',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [A]',
    ]);

    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in SuspenseList (at **)\n' +
        '    in Foo (at **)',
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in SuspenseList (at **)\n' +
        '    in Foo (at **)',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>Loading A</span>
        <span>Loading B</span>
      </>,
    );

    await act(() => A.resolve());
    assertLog(['A', 'Suspend! [B]', 'Suspend! [B]']);

    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in SuspenseList (at **)\n' +
        '    in Foo (at **)',
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in SuspenseList (at **)\n' +
        '    in Foo (at **)',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading B</span>
      </>,
    );

    await act(() => B.resolve());
    assertLog(['B']);

    assertConsoleErrorDev([
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in SuspenseList (at **)\n' +
        '    in Foo (at **)',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
      </>,
    );
  });

  /** forwards/visible 的 row #0是 yield A/B边界的 async iterable，后面还有 div Tail；transition 后警告嵌套async iterable并建议包额外SuspenseList，同时报告未缓存Promise。 */
  // @gate enableSuspenseList && enableAsyncIterableChildren
  it('warns if a nested async iterable is passed to a "forwards" list', async () => {
    /** 把 items async iterable 与 Tail 并列，制造嵌套迭代行而非顶层全部children。 */
    function Foo({items}) {
      return (
        <SuspenseList revealOrder="forwards" tail="visible">
          {items}
          <div>Tail</div>
        </SuspenseList>
      );
    }

    const iterable = {
      /** 每次调用创建异步生成器，依次产出下面两个列表项。 */
      async *[Symbol.asyncIterator]() {
        yield (
          <Suspense key={'A'} fallback="Loading">
            A
          </Suspense>
        );
        yield (
          <Suspense key={'B'} fallback="Loading">
            B
          </Suspense>
        );
      },
    };

    await act(() => {
      React.startTransition(() => {
        ReactNoop.render(<Foo items={iterable} />);
      });
    });
    assertConsoleErrorDev([
      'A nested async iterable was passed to row #0 in <SuspenseList />. ' +
        'Wrap it in an additional SuspenseList to configure its revealOrder: ' +
        '<SuspenseList revealOrder=...> ... ' +
        '<SuspenseList revealOrder=...>{async iterable}</SuspenseList> ... ' +
        '</SuspenseList>' +
        '\n    in SuspenseList (at **)' +
        '\n    in Foo (at **)',
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in Foo (at **)',
    ]);
  });
});
