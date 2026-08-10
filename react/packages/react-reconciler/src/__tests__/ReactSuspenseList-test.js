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

  /** Text 同步记录并输出文本，作为提交顺序与宿主内容的稳定观测点。 */
  function Text(props) {
    Scheduler.log(props.text);
    return <span>{props.text}</span>;
  }

  /** createAsyncText 创建拥有独立 resolved 状态和 Promise 的行组件，并暴露显式 resolve 入口。 */
  function createAsyncText(text) {
    let resolved = false;
    /** 异步文本组件在资源未解决时抛出共享 Promise，解决后输出对应行；`resolve` 只允许推进一次。 */
    const Component = function () {
      if (!resolved) {
        Scheduler.log('Suspend! [' + text + ']');
        throw promise;
      }
      return <Text text={text} />;
    };
    const promise = new Promise(resolve => {
      Component.resolve = function () {
        resolved = true;
        return resolve();
      };
    });
    return Component;
  }

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于传入非法、大小写错误或拼写错误的 revealOrder，确认开发态给出精确修正建议。
   * When：渲染包含该非法配置或 children 形状的列表。
   * Then：传入非法、大小写错误或拼写错误的 revealOrder，确认开发态给出精确修正建议。
   *
   * 验证机制：控制台断言限定开发态诊断。
   * 对应源码：`validateRevealOrder()`、`validateTailOptions()` 与 children 结构校验。
   */
  // @gate enableSuspenseList
  it('warns if an unsupported revealOrder option is used', async () => {
    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“传入非法、大小写错误或拼写错误的 revealOrder，确认开发态给出精确修正建议”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于传入非法、大小写错误或拼写错误的 revealOrder，确认开发态给出精确修正建议。
   * When：渲染包含该非法配置或 children 形状的列表。
   * Then：传入非法、大小写错误或拼写错误的 revealOrder，确认开发态给出精确修正建议。
   *
   * 验证机制：控制台断言限定开发态诊断。
   * 对应源码：`validateRevealOrder()`、`validateTailOptions()` 与 children 结构校验。
   */
  // @gate enableSuspenseList
  it('warns if a upper case revealOrder option is used', async () => {
    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“传入非法、大小写错误或拼写错误的 revealOrder，确认开发态给出精确修正建议”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于传入非法、大小写错误或拼写错误的 revealOrder，确认开发态给出精确修正建议。
   * When：渲染包含该非法配置或 children 形状的列表。
   * Then：传入非法、大小写错误或拼写错误的 revealOrder，确认开发态给出精确修正建议。
   *
   * 验证机制：控制台断言限定开发态诊断。
   * 对应源码：`validateRevealOrder()`、`validateTailOptions()` 与 children 结构校验。
   */
  // @gate enableSuspenseList
  it('warns if a misspelled revealOrder option is used', async () => {
    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“传入非法、大小写错误或拼写错误的 revealOrder，确认开发态给出精确修正建议”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于向有序 SuspenseList 传入无法形成多行协调的 children 形状，确认结构诊断。
   * When：渲染包含该非法配置或 children 形状的列表。
   * Then：向有序 SuspenseList 传入无法形成多行协调的 children 形状，确认结构诊断。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，控制台断言限定开发态诊断。
   * 对应源码：`validateRevealOrder()`、`validateTailOptions()` 与 children 结构校验。
   */
  // @gate enableSuspenseList
  it('warns if a single element is passed to a "forwards" list', async () => {
    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“向有序 SuspenseList 传入无法形成多行协调的 children 形状，确认结构诊断”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于向有序 SuspenseList 传入无法形成多行协调的 children 形状，确认结构诊断。
   * When：渲染包含该非法配置或 children 形状的列表。
   * Then：向有序 SuspenseList 传入无法形成多行协调的 children 形状，确认结构诊断。
   *
   * 验证机制：控制台断言限定开发态诊断。
   * 对应源码：`validateRevealOrder()`、`validateTailOptions()` 与 children 结构校验。
   */
  // @gate enableSuspenseList
  it('warns if a single fragment is passed to a "backwards" list', async () => {
    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“向有序 SuspenseList 传入无法形成多行协调的 children 形状，确认结构诊断”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于向有序 SuspenseList 传入无法形成多行协调的 children 形状，确认结构诊断。
   * When：渲染包含该非法配置或 children 形状的列表。
   * Then：向有序 SuspenseList 传入无法形成多行协调的 children 形状，确认结构诊断。
   *
   * 验证机制：控制台断言限定开发态诊断。
   * 对应源码：`validateRevealOrder()`、`validateTailOptions()` 与 children 结构校验。
   */
  // @gate enableSuspenseList
  it('warns if a nested array is passed to a "forwards" list', async () => {
    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“向有序 SuspenseList 传入无法形成多行协调的 children 形状，确认结构诊断”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于按不同解决顺序唤醒行，确认 forwards 只从头部连续揭示已就绪内容。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：按不同解决顺序唤醒行，确认 forwards 只从头部连续揭示已就绪内容。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList
  it('behaves as revealOrder=forwards by default', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“按不同解决顺序唤醒行，确认 forwards 只从头部连续揭示已就绪内容”场景。 */
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

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(<span>A</span>);

    await act(() => B.resolve());
    assertLog(['B', 'Suspend! [C]', 'Loading C']);

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于让多行分别挂起和解决，确认 independent 模式不互相阻塞。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：让多行分别挂起和解决，确认 independent 模式不互相阻塞。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList
  it('shows content independently with revealOrder="independent"', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“让多行分别挂起和解决，确认 independent 模式不互相阻塞”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于让多行分别挂起和解决，确认 independent 模式不互相阻塞。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：让多行分别挂起和解决，确认 independent 模式不互相阻塞。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList && !disableLegacyMode
  it('shows content independently in legacy mode regardless of option', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“让多行分别挂起和解决，确认 independent 模式不互相阻塞”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示。
   * When：按用例顺序解决资源并冲刷 ping 触发的重试。
   * Then：让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList
  it('displays all "together"', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示。
   * When：按用例顺序解决资源并冲刷 ping 触发的重试。
   * Then：让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList
  it('displays all "together" even when nested as siblings', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示。
   * When：按用例顺序解决资源并冲刷 ping 触发的重试。
   * Then：让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList
  it('displays all "together" in nested SuspenseLists', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示。
   * When：按用例顺序解决资源并冲刷 ping 触发的重试。
   * Then：让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList
  it('displays all "together" in nested SuspenseLists where the inner is "independent"', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示。
   * When：按用例顺序解决资源并冲刷 ping 触发的重试。
   * Then：让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList
  it('displays all "together" during an update', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');
    const D = createAsyncText('D');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示”场景。 */
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

    // 检查挂载、生命周期或 Effect 只在对应提交阶段执行。
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

    // 安排目标状态更新，并检查它在挂起、重试和提交之间不会丢失。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于驱动 SuspenseList 行的挂起、解决与提交，确认列表协调策略。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：驱动 SuspenseList 行的挂起、解决与提交，确认列表协调策略。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList && enableSuspenseAvoidThisFallback
  it('avoided boundaries can be coordinate with SuspenseList', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“驱动 SuspenseList 行的挂起、解决与提交，确认列表协调策略”场景。 */
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

    // 安排目标状态更新，并检查它在挂起、重试和提交之间不会丢失。
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

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
    jest.advanceTimersByTime(500);

    // 检查当前时刻应显示或保留的 fallback，避免主内容与占位错误切换。
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </>,
    );

    await act(() => B.resolve());
    assertLog(['B', 'Suspend! [C]']);

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于驱动 SuspenseList 行的挂起、解决与提交，确认列表协调策略。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：驱动 SuspenseList 行的挂起、解决与提交，确认列表协调策略。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList
  it('boundaries without fallbacks can be coordinate with SuspenseList', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“驱动 SuspenseList 行的挂起、解决与提交，确认列表协调策略”场景。 */
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

    // 安排目标状态更新，并检查它在挂起、重试和提交之间不会丢失。
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

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
    jest.advanceTimersByTime(500);

    // 检查当前时刻应显示或保留的 fallback，避免主内容与占位错误切换。
    expect(ReactNoop).toMatchRenderedOutput(<span>A</span>);

    await act(() => B.resolve());
    assertLog(['B', 'Suspend! [C]']);

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于按不同解决顺序唤醒行，确认 forwards 只从头部连续揭示已就绪内容。
   * When：按用例顺序解决资源并冲刷 ping 触发的重试。
   * Then：按不同解决顺序唤醒行，确认 forwards 只从头部连续揭示已就绪内容。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList
  it('displays each items in "forwards" order', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“按不同解决顺序唤醒行，确认 forwards 只从头部连续揭示已就绪内容”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于按不同解决顺序唤醒行，确认 backwards 从尾部向前连续揭示。
   * When：按用例顺序解决资源并冲刷 ping 触发的重试。
   * Then：按不同解决顺序唤醒行，确认 backwards 从尾部向前连续揭示。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList
  it('displays each items in "backwards" order', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“按不同解决顺序唤醒行，确认 backwards 从尾部向前连续揭示”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于按不同解决顺序唤醒行，确认 backwards 从尾部向前连续揭示。
   * When：按用例顺序解决资源并冲刷 ping 触发的重试。
   * Then：按不同解决顺序唤醒行，确认 backwards 从尾部向前连续揭示。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList
  it('displays each items in "backwards" order (legacy)', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“按不同解决顺序唤醒行，确认 backwards 从尾部向前连续揭示”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示。
   * When：按用例顺序解决资源并冲刷 ping 触发的重试。
   * Then：让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList
  it('displays added row at the top "together" and the bottom in "forwards" order', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');
    const D = createAsyncText('D');
    const E = createAsyncText('E');
    const F = createAsyncText('F');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示”场景。 */
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

    // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
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

    // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
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

    // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
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

    // 删除目标子树并检查真实卸载清理；隐藏或未提交工作不得误触发。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示。
   * When：按用例顺序解决资源并冲刷 ping 触发的重试。
   * Then：让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList
  it('displays added row at the top "together" and the bottom in "backwards" order', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const D = createAsyncText('D');
    const F = createAsyncText('F');

    /** createSyncText 作为“让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示”场景的测试 fixture，暴露对应渲染、资源或调度行为。 */
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

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示”场景。 */
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

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
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

    // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
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

    // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
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

    // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于制造高 CPU 行和两阶段渲染，确认超时后切换 fallback 并逐步提交昂贵内容。
   * When：推进虚拟时间、消耗 CPU 预算并继续冲刷渲染。
   * Then：制造高 CPU 行和两阶段渲染，确认超时后切换 fallback 并逐步提交昂贵内容。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`completeWork()` 与 `cutOffTailIfNeeded()`。
   */
  // @gate enableSuspenseList
  it('switches to rendering fallbacks if the tail takes long CPU time', async () => {
    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“制造高 CPU 行和两阶段渲染，确认超时后切换 fallback 并逐步提交昂贵内容”场景。 */
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

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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

      // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
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
    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
    assertLog([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </>,
    );
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于向 collapsed tail 插入或逐步解决多行，确认同一时刻最多保留一个加载占位。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：向 collapsed tail 插入或逐步解决多行，确认同一时刻最多保留一个加载占位。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`completeWork()` 与 `cutOffTailIfNeeded()`。
   */
  // @gate enableSuspenseList
  it('only shows one loading state at a time for "collapsed" tail insertions', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“向 collapsed tail 插入或逐步解决多行，确认同一时刻最多保留一个加载占位”场景。 */
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

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading B</span>
      </>,
    );

    await B.resolve();

    await waitForAll(['B', 'Suspend! [C]', 'Loading C']);

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于在 hidden tail 中插入、解决或重新挂起行，确认未就绪尾部被裁剪且已提交行保持。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：在 hidden tail 中插入、解决或重新挂起行，确认未就绪尾部被裁剪且已提交行保持。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`completeWork()` 与 `cutOffTailIfNeeded()`。
   */
  // @gate enableSuspenseList
  it('behaves as tail=hidden if no tail option is specified', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“在 hidden tail 中插入、解决或重新挂起行，确认未就绪尾部被裁剪且已提交行保持”场景。 */
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

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(<span>A</span>);

    await act(() => B.resolve());
    assertLog(['B', 'Suspend! [C]', 'Loading C']);

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于把非法 tail 或不适用的 tail 与 revealOrder 组合，确认开发态拒绝配置。
   * When：渲染包含该非法配置或 children 形状的列表。
   * Then：把非法 tail 或不适用的 tail 与 revealOrder 组合，确认开发态拒绝配置。
   *
   * 验证机制：控制台断言限定开发态诊断。
   * 对应源码：`updateSuspenseListComponent()`、`completeWork()` 与 `cutOffTailIfNeeded()`。
   */
  // @gate enableSuspenseList
  it('warns if an unsupported tail option is used', async () => {
    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“把非法 tail 或不适用的 tail 与 revealOrder 组合，确认开发态拒绝配置”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于把非法 tail 或不适用的 tail 与 revealOrder 组合，确认开发态拒绝配置。
   * When：渲染包含该非法配置或 children 形状的列表。
   * Then：把非法 tail 或不适用的 tail 与 revealOrder 组合，确认开发态拒绝配置。
   *
   * 验证机制：控制台断言限定开发态诊断。
   * 对应源码：`updateSuspenseListComponent()`、`completeWork()` 与 `cutOffTailIfNeeded()`。
   */
  // @gate enableSuspenseList
  it('warns if a tail option is used with "together"', async () => {
    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“把非法 tail 或不适用的 tail 与 revealOrder 组合，确认开发态拒绝配置”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于制造高 CPU 行和两阶段渲染，确认超时后切换 fallback 并逐步提交昂贵内容。
   * When：推进虚拟时间、消耗 CPU 预算并继续冲刷渲染。
   * Then：制造高 CPU 行和两阶段渲染，确认超时后切换 fallback 并逐步提交昂贵内容。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`completeWork()` 与 `cutOffTailIfNeeded()`。
   */
  // @gate enableSuspenseList
  it('renders one "collapsed" fallback even if CPU time elapsed', async () => {
    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“制造高 CPU 行和两阶段渲染，确认超时后切换 fallback 并逐步提交昂贵内容”场景。 */
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

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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

      // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
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
    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于驱动 SuspenseList 行的挂起、解决与提交，确认列表协调策略。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：驱动 SuspenseList 行的挂起、解决与提交，确认列表协调策略。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList
  it('adding to the middle does not collapse insertions (forwards)', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');
    const D = createAsyncText('D');
    const E = createAsyncText('E');
    const F = createAsyncText('F');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“驱动 SuspenseList 行的挂起、解决与提交，确认列表协调策略”场景。 */
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

    // 完成或检查本轮提交，区分已完成工作与仅渲染未提交的内容。
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

    // 检查 SuspenseList 当前行、揭示顺序与 tail 裁剪状态。
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

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于驱动 SuspenseList 行的挂起、解决与提交，确认列表协调策略。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：驱动 SuspenseList 行的挂起、解决与提交，确认列表协调策略。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList
  it('adding to the middle does not collapse insertions (backwards)', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');
    const D = createAsyncText('D');
    const E = createAsyncText('E');
    const F = createAsyncText('F');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“驱动 SuspenseList 行的挂起、解决与提交，确认列表协调策略”场景。 */
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

    // 完成或检查本轮提交，区分已完成工作与仅渲染未提交的内容。
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

    // 检查 SuspenseList 当前行、揭示顺序与 tail 裁剪状态。
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

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于驱动 SuspenseList 行的挂起、解决与提交，确认列表协调策略。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：驱动 SuspenseList 行的挂起、解决与提交，确认列表协调策略。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`completeWork()` 与 `cutOffTailIfNeeded()`。
   */
  // @gate enableSuspenseList
  it('adding to the middle of committed tail does not collapse insertions', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');
    const D = createAsyncText('D');
    const E = createAsyncText('E');
    const F = createAsyncText('F');

    /** SyncD 构造可挂起、可更新或高成本的内容行，并把执行进度写入调度日志。 */
    function SyncD() {
      return <Text text="D" />;
    }

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“驱动 SuspenseList 行的挂起、解决与提交，确认列表协调策略”场景。 */
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

    // 完成或检查本轮提交，区分已完成工作与仅渲染未提交的内容。
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

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
    jest.advanceTimersByTime(500);

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
    jest.advanceTimersByTime(500);

    // 检查 SuspenseList 当前行、揭示顺序与 tail 裁剪状态。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于在 hidden tail 中插入、解决或重新挂起行，确认未就绪尾部被裁剪且已提交行保持。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：在 hidden tail 中插入、解决或重新挂起行，确认未就绪尾部被裁剪且已提交行保持。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`completeWork()` 与 `cutOffTailIfNeeded()`。
   */
  // @gate enableSuspenseList
  it('only shows no initial loading state "hidden" tail insertions', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“在 hidden tail 中插入、解决或重新挂起行，确认未就绪尾部被裁剪且已提交行保持”场景。 */
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

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
    jest.advanceTimersByTime(500);

    expect(ReactNoop).toMatchRenderedOutput(<span>A</span>);

    await act(() => B.resolve());
    assertLog(['B', 'Suspend! [C]', 'Loading C']);

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于在 hidden tail 中插入、解决或重新挂起行，确认未就绪尾部被裁剪且已提交行保持。
   * When：按用例顺序解决资源并冲刷 ping 触发的重试。
   * Then：在 hidden tail 中插入、解决或重新挂起行，确认未就绪尾部被裁剪且已提交行保持。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`completeWork()` 与 `cutOffTailIfNeeded()`。
   */
  // @gate enableSuspenseList
  it('reveals "hidden" rows one by one without suspense boundaries', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“在 hidden tail 中插入、解决或重新挂起行，确认未就绪尾部被裁剪且已提交行保持”场景。 */
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

    // 检查 SuspenseList 当前行、揭示顺序与 tail 裁剪状态。
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

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于在 hidden tail 中插入、解决或重新挂起行，确认未就绪尾部被裁剪且已提交行保持。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：在 hidden tail 中插入、解决或重新挂起行，确认未就绪尾部被裁剪且已提交行保持。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`completeWork()` 与 `cutOffTailIfNeeded()`。
   */
  // @gate enableSuspenseList
  it('preserves already mounted rows when a new hidden on is inserted in the tail', async () => {
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    let count = 0;
    /** MountCount 作为“在 hidden tail 中插入、解决或重新挂起行，确认未就绪尾部被裁剪且已提交行保持”场景的测试 fixture，暴露对应渲染、资源或调度行为。 */
    function MountCount({children}) {
      // 检查挂载、生命周期或 Effect 只在对应提交阶段执行。
      React.useLayoutEffect(() => {
        count++;
      }, []);
      return children;
    }

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“在 hidden tail 中插入、解决或重新挂起行，确认未就绪尾部被裁剪且已提交行保持”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于向 collapsed tail 插入或逐步解决多行，确认同一时刻最多保留一个加载占位。
   * When：按用例顺序解决资源并冲刷 ping 触发的重试。
   * Then：向 collapsed tail 插入或逐步解决多行，确认同一时刻最多保留一个加载占位。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`completeWork()` 与 `cutOffTailIfNeeded()`。
   */
  // @gate enableSuspenseList
  it('reveals "collapsed" rows one by one after the first without boundaries', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“向 collapsed tail 插入或逐步解决多行，确认同一时刻最多保留一个加载占位”场景。 */
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

    // 检查 SuspenseList 当前行、揭示顺序与 tail 裁剪状态。
    expect(ReactNoop).toMatchRenderedOutput('Loading root');

    await A.resolve();

    await waitForAll(['A', 'Suspend! [B]', 'Loading B']);

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
    jest.advanceTimersByTime(500);

    // 检查当前时刻应显示或保留的 fallback，避免主内容与占位错误切换。
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading B</span>
      </>,
    );

    await act(() => B.resolve());
    assertLog(['B', 'Suspend! [C]', 'B', 'Suspend! [C]']);

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
    jest.advanceTimersByTime(500);

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于逐层解决嵌套 forwards 列表，确认内外列表最终都能完成恢复。
   * When：按用例顺序解决资源并冲刷 ping 触发的重试。
   * Then：逐层解决嵌套 forwards 列表，确认内外列表最终都能完成恢复。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList
  it('eventually resolves a nested forwards suspense list', async () => {
    const B = createAsyncText('B');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“逐层解决嵌套 forwards 列表，确认内外列表最终都能完成恢复”场景。 */
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
      // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于在 hidden tail 中插入、解决或重新挂起行，确认未就绪尾部被裁剪且已提交行保持。
   * When：按用例顺序解决资源并冲刷 ping 触发的重试。
   * Then：在 hidden tail 中插入、解决或重新挂起行，确认未就绪尾部被裁剪且已提交行保持。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`completeWork()` 与 `cutOffTailIfNeeded()`。
   */
  // @gate enableSuspenseList
  it('eventually resolves a nested forwards suspense list with a hidden tail', async () => {
    const B = createAsyncText('B');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“在 hidden tail 中插入、解决或重新挂起行，确认未就绪尾部被裁剪且已提交行保持”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于在 hidden tail 中插入、解决或重新挂起行，确认未就绪尾部被裁剪且已提交行保持。
   * When：按用例顺序解决资源并冲刷 ping 触发的重试。
   * Then：在 hidden tail 中插入、解决或重新挂起行，确认未就绪尾部被裁剪且已提交行保持。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`completeWork()` 与 `cutOffTailIfNeeded()`。
   */
  // @gate enableSuspenseList
  it('eventually resolves two nested forwards suspense lists with a hidden tail', async () => {
    const B = createAsyncText('B');

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“在 hidden tail 中插入、解决或重新挂起行，确认未就绪尾部被裁剪且已提交行保持”场景。 */
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

    // 检查 SuspenseList 当前行、揭示顺序与 tail 裁剪状态。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于列表相邻区域发生无关更新，确认 SuspenseList 协调不会阻塞普通兄弟工作。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：列表相邻区域发生无关更新，确认 SuspenseList 协调不会阻塞普通兄弟工作。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList
  it('can do unrelated adjacent updates', async () => {
    let updateAdjacent;
    /** Adjacent 作为“列表相邻区域发生无关更新，确认 SuspenseList 协调不会阻塞普通兄弟工作”场景的测试 fixture，暴露对应渲染、资源或调度行为。 */
    function Adjacent() {
      const [text, setText] = React.useState('-');
      updateAdjacent = setText;
      return <Text text={text} />;
    }

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“列表相邻区域发生无关更新，确认 SuspenseList 协调不会阻塞普通兄弟工作”场景。 */
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

    // 检查 SuspenseList 当前行、揭示顺序与 tail 裁剪状态。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于在 hidden tail 中插入、解决或重新挂起行，确认未就绪尾部被裁剪且已提交行保持。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：在 hidden tail 中插入、解决或重新挂起行，确认未就绪尾部被裁剪且已提交行保持。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`completeWork()` 与 `cutOffTailIfNeeded()`。
   */
  // @gate enableSuspenseList
  it('is able to re-suspend the last rows during an update with hidden', async () => {
    const AsyncB = createAsyncText('B');

    let setAsyncB;

    /** B 作为“在 hidden tail 中插入、解决或重新挂起行，确认未就绪尾部被裁剪且已提交行保持”场景的测试 fixture，暴露对应渲染、资源或调度行为。 */
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

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“在 hidden tail 中插入、解决或重新挂起行，确认未就绪尾部被裁剪且已提交行保持”场景。 */
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

    // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
    await act(() => setAsyncB(true));

    assertLog([
      'Suspend! [B]',
      'Loading B',
      // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
      'Loading B',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <>
        <span>A</span>
        <span>Loading B</span>
      </>,
    );

    // 推进 thenable 资源状态并触发 ping，随后观察边界重试与已提交内容。
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

    // 检查挂载、生命周期或 Effect 只在对应提交阶段执行。
    expect(previousInst).toBe(setAsyncB);
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于以更高优先级更新打断部分完成的列表，再恢复原工作，确认渲染进度可续接。
   * When：启动低优先级渲染，再以更高优先级工作或 ping 打断。
   * Then：以更高优先级更新打断部分完成的列表，再恢复原工作，确认渲染进度可续接。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList
  it('is able to interrupt a partially rendered tree and continue later', async () => {
    const AsyncA = createAsyncText('A');

    let updateLowPri;
    let updateHighPri;

    /** Bar 作为层级 fixture 暴露 unwind、兄弟遍历或边界传播顺序，服务于“以更高优先级更新打断部分完成的列表，再恢复原工作，确认渲染进度可续接”场景。 */
    function Bar() {
      const [highPriState, setHighPriState] = React.useState(false);
      updateHighPri = setHighPriState;
      return highPriState ? <AsyncA /> : null;
    }

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“以更高优先级更新打断部分完成的列表，再恢复原工作，确认渲染进度可续接”场景。 */
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

      // 安排不同优先级或 transition 工作，检查中断、续接与队列保留。
      ReactNoop.flushSync(() => updateHighPri(true));

      // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
      assertLog([
        'Suspend! [A]',
        'Loading A',
        // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList
  it('can resume class components when revealed together', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');

    /** 定义 ClassComponent 类 fixture，在“让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示”场景中暴露实例 state 与提交生命周期。 */
    class ClassComponent extends React.Component {
      /** 渲染 ClassComponent.render 的当前实例状态；若资源未就绪，抛出 thenable 让最近 Suspense 接管。 */
      render() {
        return this.props.children;
      }
    }

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“让多行或嵌套列表分批解决，确认 together 模式只在全部就绪后一次揭示”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于制造高 CPU 行和两阶段渲染，确认超时后切换 fallback 并逐步提交昂贵内容。
   * When：推进虚拟时间、消耗 CPU 预算并继续冲刷渲染。
   * Then：制造高 CPU 行和两阶段渲染，确认超时后切换 fallback 并逐步提交昂贵内容。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`completeWork()` 与 `cutOffTailIfNeeded()`。
   */
  // @gate enableSuspenseList
  it('should be able to progressively show CPU expensive rows with two pass rendering', async () => {
    /** TwoPass 首遍安排状态更新、次遍输出稳定内容，用于验证 SuspenseList 两阶段渲染。 */
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

    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“制造高 CPU 行和两阶段渲染，确认超时后切换 fallback 并逐步提交昂贵内容”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于制造高 CPU 行和两阶段渲染，确认超时后切换 fallback 并逐步提交昂贵内容。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：制造高 CPU 行和两阶段渲染，确认超时后切换 fallback 并逐步提交昂贵内容。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList
  it('should be able to progressively show rows with two pass rendering and visible', async () => {
    /** TwoPass 首遍安排状态更新、次遍输出稳定内容，用于验证 SuspenseList 两阶段渲染。 */
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

    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“制造高 CPU 行和两阶段渲染，确认超时后切换 fallback 并逐步提交昂贵内容”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于在 Profiler 中挂起并恢复列表，确认 actualDuration 只累计真实执行时间。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：在 Profiler 中挂起并恢复列表，确认 actualDuration 只累计真实执行时间。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback，Profiler 时长断言验证实际执行成本。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableProfilerTimer
  // @gate enableSuspenseList
  it('counts the actual duration when profiling a SuspenseList', async () => {
    // Profiler 回调参数顺序为 id、phase、actualDuration、treeBaseDuration。
    const onRender = jest.fn();

    /** Fallback 保存当前场景跨步骤调用的函数入口。 */
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

    /** Sleep 消耗指定 CPU 时间，迫使 SuspenseList 跨越渲染预算并进入第二遍协调。 */
    function Sleep({time, children}) {
      Scheduler.unstable_advanceTime(time);
      return children;
    }

    /** App 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“在 Profiler 中挂起并恢复列表，确认 actualDuration 只累计真实执行时间”场景。 */
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

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。

    // `actualDuration`：本次提交的实际渲染耗时。
    expect(onRender.mock.calls[0][2]).toBe(1 + 4 + 5 + 3);
    // `treeBaseDuration`：不使用 memo 时整棵树的基准耗时。
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

    // `actualDuration`：本次提交的实际渲染耗时。
    expect(onRender.mock.calls[1][2]).toBe(
      gate('alwaysThrottleRetries') ? 1 + 4 + 5 : 5,
    );
    // `treeBaseDuration`：不使用 memo 时整棵树的基准耗时。
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
      // 检查 SuspenseList 当前行、揭示顺序与 tail 裁剪状态。
      'A',
      'B',
      'Suspend! [C]',
      'Fallback',
      // 检查 SuspenseList 当前行、揭示顺序与 tail 裁剪状态。
      'Fallback',
      // 执行预热渲染，不把该遍结果作为最终提交。
      'Suspend! [C]',
    ]);

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
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

    // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。

    // `actualDuration`：本次提交的实际渲染耗时。
    expect(onRender.mock.calls[2][2]).toBe(
      gate('alwaysThrottleRetries') ? (1 + 4 + 5 + 3) * 2 + 3 : 10,
    );
    // `treeBaseDuration`：不使用 memo 时整棵树的基准耗时。
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

    // `actualDuration`：本次提交的实际渲染耗时。
    expect(onRender.mock.calls[5][2]).toBe(
      gate('alwaysThrottleRetries') ? 12 : 17,
    );
    // `treeBaseDuration`：不使用 memo 时整棵树的基准耗时。
    expect(onRender.mock.calls[5][3]).toBe(1 + 4 + 5 + 3);
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于父层 memo 提前退出时更新列表内部状态，确认 Suspense 更新仍向外传播。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：父层 memo 提前退出时更新列表内部状态，确认 Suspense 更新仍向外传播。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList
  it('propagates despite a memo bailout', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    const Bailout = React.memo(({children}) => {
      return children;
    });

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“父层 memo 提前退出时更新列表内部状态，确认 Suspense 更新仍向外传播”场景。 */
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于构造嵌套边界回归，确认 SuspenseList 只强制直接子层进入 fallback。
   * When：执行挂起、fallback 提交以及用例指定的更新或恢复步骤。
   * Then：构造嵌套边界回归，确认 SuspenseList 只强制直接子层进入 fallback。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList
  it(
    'regression test: SuspenseList should never force boundaries deeper than ' +
      'a single level into fallback mode',
    async () => {
      const A = createAsyncText('A');

      /** UnreachableFallback 输出可识别 fallback，并记录其挂载或意外到达情况。 */
      function UnreachableFallback() {
        throw new Error('Should never be thrown!');
      }

      /** Repro 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“构造嵌套边界回归，确认 SuspenseList 只强制直接子层进入 fallback”场景。 */
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

      // 检查 SuspenseList 当前行、揭示顺序与 tail 裁剪状态。
      const root = ReactNoop.createRoot();
      await act(() => root.render(<Repro update={false} />));
      assertLog(['B1', 'C']);
      expect(root).toMatchRenderedOutput(
        <>
          <span>B1</span>
          <span>C</span>
        </>,
      );

      // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
      await act(() => root.render(<Repro update={true} />));
      assertLog([
        // 该步骤让目标内容挂起，用于检查 unwind、fallback 选择和后续重试。
        'Suspend! [A]',
        'Loading A...',
        'B2',
        'C',

        // 推进或等待指定时间窗口，观察 Suspense 的节流、超时与恢复时机。
        //
        // 检查当前时刻应显示或保留的 fallback，避免主内容与占位错误切换。
        //
        // 回归场景：复现历史缺陷并锁定修复后的 Suspense 调度或提交不变量。
        'Loading A...',
        'B2',
        'C',

        // 检查当前时刻应显示或保留的 fallback，避免主内容与占位错误切换。
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

      // 检查当前时刻应显示或保留的 fallback，避免主内容与占位错误切换。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于按不同解决顺序唤醒行，确认 forwards 只从头部连续揭示已就绪内容。
   * When：渲染包含该非法配置或 children 形状的列表。
   * Then：按不同解决顺序唤醒行，确认 forwards 只从头部连续揭示已就绪内容。
   *
   * 验证机制：控制台断言限定开发态诊断。
   * 对应源码：`validateRevealOrder()`、`validateTailOptions()` 与 children 结构校验。
   */
  // @gate enableSuspenseList && enableAsyncIterableChildren
  it('warns for async generator components in "forwards" order', async () => {
    /** Generator 作为“按不同解决顺序唤醒行，确认 forwards 只从头部连续揭示已就绪内容”场景的测试 fixture，暴露对应渲染、资源或调度行为。 */
    async function* Generator() {
      yield 'A';
      yield 'B';
    }
    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“按不同解决顺序唤醒行，确认 forwards 只从头部连续揭示已就绪内容”场景。 */
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
      // 该步骤应产生并校验对应的开发态告警。
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in Foo (at **)',
    ]);
  });

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于按不同解决顺序唤醒行，确认 forwards 只从头部连续揭示已就绪内容。
   * When：按用例顺序解决资源并冲刷 ping 触发的重试。
   * Then：按不同解决顺序唤醒行，确认 forwards 只从头部连续揭示已就绪内容。
   *
   * 验证机制：调度日志和分段等待锁定 yield、ping 与重试顺序，宿主输出断言区分主内容、隐藏内容和 fallback，控制台断言限定开发态诊断。
   * 对应源码：`updateSuspenseListComponent()`、`findFirstSuspended()` 与列表第二遍完成逻辑。
   */
  // @gate enableSuspenseList && enableAsyncIterableChildren
  it('can display async iterable in "forwards" order', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');

    // 执行并检查当前渲染步骤，区分主树、兄弟预热与 fallback 路径。
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
      /** Symbol.asyncIterator 返回异步 iterable 自身，供 SuspenseList 逐项拉取并保持迭代身份。 */
      async *[Symbol.asyncIterator]() {
        yield ASlot;
        yield BSlot;
      },
    };

    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“按不同解决顺序唤醒行，确认 forwards 只从头部连续揭示已就绪内容”场景。 */
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
      // 该步骤应产生并校验对应的开发态告警。
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
      // 该步骤应产生并校验对应的开发态告警。
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
      // 该步骤应产生并校验对应的开发态告警。
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

  /**
   * Given：已构造边界树、资源状态和调度检查点，用于流式消费 async iterable 行，确认 forwards 顺序提交并拒绝嵌套 iterable。
   * When：渲染包含该非法配置或 children 形状的列表。
   * Then：流式消费 async iterable 行，确认 forwards 顺序提交并拒绝嵌套 iterable。
   *
   * 验证机制：控制台断言限定开发态诊断。
   * 对应源码：`validateRevealOrder()`、`validateTailOptions()` 与 children 结构校验。
   */
  // @gate enableSuspenseList && enableAsyncIterableChildren
  it('warns if a nested async iterable is passed to a "forwards" list', async () => {
    /** Foo 组织当前 Suspense/SuspenseList 边界、资源行与更新入口，服务于“流式消费 async iterable 行，确认 forwards 顺序提交并拒绝嵌套 iterable”场景。 */
    function Foo({items}) {
      return (
        <SuspenseList revealOrder="forwards" tail="visible">
          {items}
          <div>Tail</div>
        </SuspenseList>
      );
    }

    const iterable = {
      /** Symbol.asyncIterator 返回异步 iterable 自身，供 SuspenseList 逐项拉取并保持迭代身份。 */
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
      // 该步骤应产生并校验对应的开发态告警。
      'A component was suspended by an uncached promise. ' +
        'Creating promises inside a Client Component or hook is not yet supported, ' +
        'except via a Suspense-compatible library or framework.\n' +
        '    in Foo (at **)',
    ]);
  });
});
