/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

'use strict';

let PropTypes;
let React;
let ReactNoop;
let Scheduler;
let act;
let assertLog;
let waitForAll;
let waitFor;
let waitForThrow;
let assertConsoleErrorDev;

/** 覆盖并发 reconciler 从 render、commit、删除、Context、ref 到嵌套边界的错误捕获、unwind 与恢复。 */
describe('ReactIncrementalErrorHandling', () => {
  /** 每例重置 renderer、Scheduler 与错误断言工具，避免 Fiber 根、日志及边界状态跨测试复用。 */
  beforeEach(() => {
    jest.resetModules();
    PropTypes = require('prop-types');
    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;
    waitForAll = InternalTestUtils.waitForAll;
    waitFor = InternalTestUtils.waitFor;
    waitForThrow = InternalTestUtils.waitForThrow;
  });

  /** 恢复每例安装的 console 等 jest spy；模块重置由下一例 beforeEach 执行。 */
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** 规范化组件栈中的源码位置，只保留稳定组件名，避免行号扰动错误断言。 */
  function normalizeCodeLocInfo(str) {
    return (
      str &&
      str.replace(/\n +(?:at|in) ([\S]+)[^\n]*/g, function (m, name) {
        return '\n    in ' + name + ' (at **)';
      })
    );
  }

  // 注意：该夹具源自 WWW 中的类似组件；额外 div 包装不再需要后即可删除
  // 本兼容层。
  /** 用 LegacyHidden 包裹 div 的兼容夹具，验证隐藏树中的错误传播与宿主可见性。 */
  function LegacyHiddenDiv({children, mode}) {
    return (
      <div hidden={mode === 'hidden'}>
        <React.unstable_LegacyHidden
          mode={mode === 'hidden' ? 'unstable-defer-without-hiding' : mode}>
          {children}
        </React.unstable_LegacyHidden>
      </div>
    );
  }

  /** 场景：初始空根在 transition 中挂载静态派生错误边界、三层 Indirection 与故障 child；逐 yield 看到首遍 fallback 仍未提交，随后一次 flushNextYield 重跑全根并提交 oops!。日志与中间 null 验证异步尝试之后的同步错误恢复。 */
  it('recovers from errors asynchronously', async () => {
    /** 静态派生状态错误边界：并发首遍与同步恢复都能直接生成 ErrorMessage，观察两遍恢复尚未提交时的日志。 */
    class ErrorBoundary extends React.Component {
      /** 已捕获的原始错误；null 时尝试子树，非 null 时显示其 message。 */
      state = {error: null};
      /** ErrorBoundary.getDerivedStateFromError：把 render 错误折叠为恢复 state，使下一分支渲染 fallback。 */
      static getDerivedStateFromError(error) {
        Scheduler.log('getDerivedStateFromError');
        return {error};
      }
      /** 记录 try/catch 分支，恢复分支改为 ErrorMessage，供逐 yield 检查是否仅 render 或已提交。 */
      render() {
        if (this.state.error) {
          Scheduler.log('ErrorBoundary (catch)');
          return <ErrorMessage error={this.state.error} />;
        }
        Scheduler.log('ErrorBoundary (try)');
        return this.props.children;
      }
    }

    /** 记录 fallback 的 render 日志，并返回可断言的错误文本。 */
    function ErrorMessage({error}) {
      Scheduler.log('ErrorMessage');
      return <span prop={`Caught an error: ${error.message}`} />;
    }

    /** Indirection 记录经过中间组件的 render 日志，并透传 children。 */
    function Indirection({children}) {
      Scheduler.log('Indirection');
      return children || null;
    }

    /** “recovers from errors asynchronously”中的失败函数夹具 BadRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BadRender({unused}) {
      Scheduler.log('throw');
      throw new Error('oops!');
    }

    React.startTransition(() => {
      ReactNoop.render(
        <>
          <ErrorBoundary>
            <Indirection>
              <Indirection>
                <Indirection>
                  <BadRender />
                </Indirection>
              </Indirection>
            </Indirection>
          </ErrorBoundary>
          <Indirection />
          <Indirection />
        </>,
      );
    });

    // 开始异步 render。
    await waitFor([
      'ErrorBoundary (try)',
      'Indirection',
      'Indirection',
      'Indirection',
      // 发生错误后，React 仍继续异步 render。
      'throw',

      // 调用 getDerivedStateFromError 并重新 render 错误边界，
      // 此次输出错误消息。
      'getDerivedStateFromError',
      'ErrorBoundary (catch)',
      'ErrorMessage',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(null);

    // work loop 已 unwind 到最近错误边界，随后继续
    // 异步 render。
    await waitFor(['Indirection']);

    // 错误发生于异步 render，React 暂不提交结果。整棵树 render 完成后，
    // React 会再同步尝试一次，以防错误来自
    // 可通过重试消除的数据竞争。这里只 flush 一个 work unit，
    // 用于证明该重试是同步的。
    // 证明恢复 render 为同步模式。
    expect(ReactNoop.flushNextYield()).toEqual([
      'Indirection',

      'ErrorBoundary (try)',
      'Indirection',
      'Indirection',
      'Indirection',

      // 重试再次抛错；这次 React 会实际提交
      // 错误边界恢复结果。
      'throw',
      'getDerivedStateFromError',
      'ErrorBoundary (catch)',
      'ErrorMessage',
      'Indirection',
      'Indirection',
    ]);

    expect(ReactNoop).toMatchRenderedOutput(
      <span prop="Caught an error: oops!" />,
    );
  });

  /** 场景：初始空根在 transition 中挂载只定义 cDC 的边界和故障 child；让出后完成根并同步重试，提交才执行 cDC 并 setState；最终显示 oops!。区别旧式提交通知恢复与静态派生恢复。 */
  it('recovers from errors asynchronously (legacy, no getDerivedStateFromError)', async () => {
    /** 仅 componentDidCatch 的旧式边界：首遍先丢弃故障子树，提交回调再 setState 显示错误，区别于 render 阶段派生状态。 */
    class ErrorBoundary extends React.Component {
      /** 提交回调写入的捕获值，初始 null 保留正常 children。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch：在 componentDidCatch 中将捕获值写入 state，排入恢复更新。 */
      componentDidCatch(error) {
        Scheduler.log('componentDidCatch');
        this.setState({error});
      }
      /** 按提交恢复 state 选择 children 或 ErrorMessage，并记录分支用于辨认额外恢复 render。 */
      render() {
        if (this.state.error) {
          Scheduler.log('ErrorBoundary (catch)');
          return <ErrorMessage error={this.state.error} />;
        }
        Scheduler.log('ErrorBoundary (try)');
        return this.props.children;
      }
    }

    /** 记录 fallback 的 render 日志，并返回可断言的错误文本。 */
    function ErrorMessage({error}) {
      Scheduler.log('ErrorMessage');
      return <span prop={`Caught an error: ${error.message}`} />;
    }

    /** Indirection 记录经过中间组件的 render 日志，并透传 children。 */
    function Indirection({children}) {
      Scheduler.log('Indirection');
      return children || null;
    }

    /** “recovers from errors asynchronously (legacy, no getDerivedStateFromError)”中的失败函数夹具 BadRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BadRender({unused}) {
      Scheduler.log('throw');
      throw new Error('oops!');
    }

    React.startTransition(() => {
      ReactNoop.render(
        <>
          <ErrorBoundary>
            <Indirection>
              <Indirection>
                <Indirection>
                  <BadRender />
                </Indirection>
              </Indirection>
            </Indirection>
          </ErrorBoundary>
          <Indirection />
          <Indirection />
        </>,
      );
    });

    // 开始异步 render。
    await waitFor([
      'ErrorBoundary (try)',
      'Indirection',
      'Indirection',
      'Indirection',
      // 发生错误后，React 仍继续异步 render。
      'throw',
    ]);

    // 此时仍在异步 render。
    await waitFor(['Indirection']);

    await waitFor([
      'Indirection',
      // 整棵树已完成且没有剩余 work，React
      // 在处理错误前切到同步模式再重试一次。

      'ErrorBoundary (try)',
      'Indirection',
      'Indirection',
      'Indirection',

      // 重试仍抛错，现在进入正式错误处理。
      'throw',
      'Indirection',
      'Indirection',
      'componentDidCatch',
      'ErrorBoundary (catch)',
      'ErrorMessage',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <span prop="Caught an error: oops!" />,
    );
  });

  /** 场景：先让 isBroken=true 的 transition 抛 Oops!，再入队另一 transition 的正常 Root 输入；只冲刷一个 mock yield 即同步恢复为 Everything is fine。两个 commit 日志是两项 Root Update 的回调，不能据此断言两次宿主提交；另检查可恢复并发错误诊断。 */
  it("retries at a lower priority if there's additional pending work", async () => {
    /** 根据 isBroken 抛 Oops! 或输出固定成功 span，后入队的正常 Root 更新可在同步恢复中取代失败输入。 */
    function App(props) {
      if (props.isBroken) {
        Scheduler.log('error');
        throw new Error('Oops!');
      }
      Scheduler.log('success');
      return <span prop="Everything is fine." />;
    }

    /** Root Update 的提交通知：每项被处理的 Root 更新都各自调用 callback；两条 commit 日志不等于两次独立宿主提交。 */
    function onCommit() {
      Scheduler.log('commit');
    }

    React.startTransition(() => {
      ReactNoop.render(<App isBroken={true} />, onCommit);
    });
    await waitFor(['error']);

    React.startTransition(() => {
      // 此更新属于独立 batch。
      ReactNoop.render(<App isBroken={false} />, onCommit);
    });

    // 同步恢复合并当前可重试的 pending lanes（排除 OffscreenLane）；
    // 新更新移除抛错节点，因此本次能够成功。
    //
    // 这里只要求 Scheduler render 一个 work unit；错误恢复 render
    // 是同步的，因此一个 unit 足以
    // 完成本次同步恢复中可重试的工作。
    Scheduler.unstable_flushNumberOfYields(1);
    assertLog([
      'success',
      // 第二个更新完成前不提交任何内容。
      'commit',
      'commit',
    ]);
    assertConsoleErrorDev([
      'Error: There was an error during concurrent rendering but React was able to recover by instead synchronously rendering the entire root.' +
        '\n    in <stack>',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <span prop="Everything is fine." />,
    );
  });

  /** 场景：开启 LegacyHidden 时，失败 transition 后追加正常输入，正常树带隐藏子内容；同步恢复先显示文本与空隐藏 div，随后后台工作补入 Offscreen content。两次宿主快照验证恢复 lanes 排除 OffscreenLane。 */
  // @gate enableLegacyHidden
  it('does not include offscreen work when retrying after an error', async () => {
    /** 故障输入抛 Oops!，正常输入含隐藏 LegacyHiddenDiv；观察可见恢复先提交、Offscreen 内容随后填充。 */
    function App(props) {
      if (props.isBroken) {
        Scheduler.log('error');
        throw new Error('Oops!');
      }
      Scheduler.log('success');
      return (
        <>
          Everything is fine
          <LegacyHiddenDiv mode="hidden">
            <div>Offscreen content</div>
          </LegacyHiddenDiv>
        </>
      );
    }

    /** Root Update 的提交通知：即使恢复合并两项输入，两项 callback 仍可在同一次提交逐一运行。 */
    function onCommit() {
      Scheduler.log('commit');
    }

    React.startTransition(() => {
      ReactNoop.render(<App isBroken={true} />, onCommit);
    });
    await waitFor(['error']);

    expect(ReactNoop).toMatchRenderedOutput(null);

    React.startTransition(() => {
      // 此更新属于独立 batch。
      ReactNoop.render(<App isBroken={false} />, onCommit);
    });

    // 同步恢复合并当前可重试的 pending lanes（排除 OffscreenLane）；
    // 新更新移除抛错节点，因此本次能够成功。
    //
    // 这里只要求 Scheduler render 一个 work unit；错误恢复 render
    // 是同步的，因此一个 unit 足以
    // 完成本次同步恢复中可重试的工作。
    Scheduler.unstable_flushNumberOfYields(1);
    assertLog([
      'success',
      // 第二个更新完成前不提交任何内容。
      'commit',
      'commit',
    ]);
    assertConsoleErrorDev([
      'Error: There was an error during concurrent rendering but React was able to recover by instead synchronously rendering the entire root.' +
        '\n    in <stack>',
    ]);
    // 此提交不应包含 Offscreen 内容。
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        Everything is fine
        <div hidden={true} />
      </>,
    );

    // Offscreen 内容在后续 render 中完成。
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <>
        Everything is fine
        <div hidden={true}>
          <div>Offscreen content</div>
        </div>
      </>,
    );
  });

  /** 场景：transition 的 Parent 首个 child 抛 oops，后面另有正常 Sibling；首遍让出后只冲刷一个 yield，即从 Parent 同步再尝试并清空根。日志无 Sibling，验证根错误处理前有一次整根重试。 */
  it('retries one more time before handling error', async () => {
    /** “retries one more time before handling error”中的失败函数夹具 BadRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BadRender({unused}) {
      Scheduler.log('BadRender');
      throw new Error('oops');
    }

    /** 不会失败的 sibling：证明一个子树出错时，同批兄弟工作仍按预期处理。 */
    function Sibling({unused}) {
      Scheduler.log('Sibling');
      return <span prop="Sibling" />;
    }

    /** 记录 Parent 后依次返回失败 child 与成功 sibling；子树失败时后一个 sibling 的日志没有出现。 */
    function Parent({unused}) {
      Scheduler.log('Parent');
      return (
        <>
          <BadRender />
          <Sibling />
        </>
      );
    }

    React.startTransition(() => {
      ReactNoop.render(<Parent />, () => Scheduler.log('commit'));
    });

    // 异步 render 失败组件。
    await waitFor(['Parent', 'BadRender']);

    // work loop unwind 到最近错误边界后，React 会
    // 再同步 render 一次；这里只 flush 一个 work unit，
    // 证明恢复 render 为同步模式。
    Scheduler.unstable_flushNumberOfYields(1);
    assertLog(['Parent', 'BadRender', 'commit']);
    expect(ReactNoop).toMatchRenderedOutput(null);
  });

  /** 场景：transition 已渲染 A/B 后将 mock 时钟推进 10000ms 并冲刷过期工作；先续到 Oops，再从 A/B/Oops 重试，C/D 未运行且根为空。验证中途过期不会抹掉已完成进度，但错误恢复仍重开根。 */
  it('retries one more time if an error occurs during a render that expires midway through the tree', async () => {
    /** “retries one more time if an error occurs during a render that expires midway through the tree”中的失败函数夹具 Oops：在 render 时抛出固定错误，触发目标恢复分支。 */
    function Oops({unused}) {
      Scheduler.log('Oops');
      throw new Error('Oops');
    }

    /** 记录并返回文本，作为“retries one more time if an error occurs during a render that expires midway through the tree”中 render/commit 顺序的稳定标记。 */
    function Text({text}) {
      Scheduler.log(text);
      return text;
    }

    /** 把 Oops 放在 A/B 与 C/D 之间，令模拟时钟在前两项后过期，检查错误同步恢复从根重跑。 */
    function App({unused}) {
      return (
        <>
          <Text text="A" />
          <Text text="B" />
          <Oops />
          <Text text="C" />
          <Text text="D" />
        </>
      );
    }

    React.startTransition(() => {
      ReactNoop.render(<App />);
    });

    // 只 render 树的一部分。
    await waitFor(['A', 'B']);

    // 在 render 中途令工作过期。
    Scheduler.unstable_advanceTime(10000);

    Scheduler.unstable_flushExpired();
    ReactNoop.flushSync();

    assertLog([
      // render 已过期，但不应丢弃部分完成的工作。
      // 完成当前层级。
      'Oops',

      // 错误发生在部分并发 render 中，因此应
      // 再同步重试一次。
      'A',
      'B',
      'Oops',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(null);
  });

  /** 场景：一个旧式边界内挂三个只在 didMount 抛错的 BadMount；冲刷后按 id=1/2/3 分别调用 cDC，三个函数 updater 累计到错误计数 3。验证提交错误不会按边界去重丢失独立通知。 */
  it('calls componentDidCatch multiple times for multiple errors', async () => {
    let id = 0;
    /** “calls componentDidCatch multiple times for multiple errors”中的失败类夹具 BadMount：在指定生命周期制造错误，定位 commit/unwind 边界。 */
    class BadMount extends React.Component {
      /** 每次挂载抛带递增 id 的 Error，三个实例提供可区分的三项提交错误。 */
      componentDidMount() {
        throw new Error(`Error ${++id}`);
      }
      /** 只记录 BadMount 并返回 null；错误发生在 componentDidMount，不是 render。 */
      render() {
        Scheduler.log('BadMount');
        return null;
      }
    }

    /** 统计多个挂载错误的旧式边界，componentDidCatch 每次都入队一次函数 state 增量，最终显示计数 3。 */
    class ErrorBoundary extends React.Component {
      /** 捕获错误次数从 0 开始；函数 updater 保证三项累加不互相覆盖。 */
      state = {errorCount: 0};
      /** ErrorBoundary.componentDidCatch：在 componentDidCatch 中将捕获值写入 state，排入恢复更新。 */
      componentDidCatch(error) {
        Scheduler.log(`componentDidCatch: ${error.message}`);
        this.setState(state => ({errorCount: state.errorCount + 1}));
      }
      /** 计数为零时透传三个 BadMount，捕获后输出错误总数且移除故障 children。 */
      render() {
        if (this.state.errorCount > 0) {
          return <span prop={`Number of errors: ${this.state.errorCount}`} />;
        }
        Scheduler.log('ErrorBoundary');
        return this.props.children;
      }
    }

    ReactNoop.render(
      <ErrorBoundary>
        <BadMount />
        <BadMount />
        <BadMount />
      </ErrorBoundary>,
    );

    await waitForAll([
      'ErrorBoundary',
      'BadMount',
      'BadMount',
      'BadMount',
      'componentDidCatch: Error 1',
      'componentDidCatch: Error 2',
      'componentDidCatch: Error 3',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <span prop="Number of errors: 3" />,
    );
  });

  /** 场景：普通 Root render 从空根挂载旧式边界与抛 Hello 的子函数；耗尽调度后显示 Caught an error: Hello.。验证完整挂载失败可经 cDC 的 state 更新恢复。 */
  it('catches render error in a boundary during full deferred mounting', async () => {
    /** 普通 Root render 的旧式边界，cDC 保存 Hello 后显示带句点的恢复文本。 */
    class ErrorBoundary extends React.Component {
      /** 初始未捕获，cDC 写入 Error 后切换 fallback。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch：在 componentDidCatch 中将捕获值写入 state，排入恢复更新。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** 正常透传 children，恢复时从原始 error.message 生成 span，不保留故障子树。 */
      render() {
        if (this.state.error) {
          return (
            <span prop={`Caught an error: ${this.state.error.message}.`} />
          );
        }
        return this.props.children;
      }
    }

    /** “catches render error in a boundary during full deferred mounting”中的失败函数夹具 BrokenRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BrokenRender(props) {
      throw new Error('Hello');
    }

    ReactNoop.render(
      <ErrorBoundary>
        <BrokenRender />
      </ErrorBoundary>,
    );
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <span prop="Caught an error: Hello." />,
    );
  });

  /** 场景：transition 先只推进旧式边界的正常 render，此时输出仍 null；继续工作后 child 抛 Hello，同步重试再失败，cDC 后切 fallback。日志与快照验证部分挂载没有提前提交未完成 children。 */
  it('catches render error in a boundary during partial deferred mounting', async () => {
    /** transition 部分挂载的旧式边界，用分支/cDC 日志定位首次让出、同步重试和提交恢复。 */
    class ErrorBoundary extends React.Component {
      /** null 是正常尝试状态；捕获 Hello 后用于 fallback 文本。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch：在 componentDidCatch 中将捕获值写入 state，排入恢复更新。 */
      componentDidCatch(error) {
        Scheduler.log('ErrorBoundary componentDidCatch');
        this.setState({error});
      }
      /** 记录正常与错误分支，正常时还可能让出而没有宿主输出，错误分支生成恢复 span。 */
      render() {
        if (this.state.error) {
          Scheduler.log('ErrorBoundary render error');
          return (
            <span prop={`Caught an error: ${this.state.error.message}.`} />
          );
        }
        Scheduler.log('ErrorBoundary render success');
        return this.props.children;
      }
    }

    /** “catches render error in a boundary during partial deferred mounting”中的失败函数夹具 BrokenRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BrokenRender({unused}) {
      Scheduler.log('BrokenRender');
      throw new Error('Hello');
    }

    React.startTransition(() => {
      ReactNoop.render(
        <ErrorBoundary>
          <BrokenRender />
        </ErrorBoundary>,
      );
    });

    await waitFor(['ErrorBoundary render success']);
    expect(ReactNoop).toMatchRenderedOutput(null);

    await waitForAll([
      'BrokenRender',
      // React 再重试一次。
      'ErrorBoundary render success',

      // 重试再次出错，现在正式处理。
      'BrokenRender',
      'ErrorBoundary componentDidCatch',
      'ErrorBoundary render error',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <span prop="Caught an error: Hello." />,
    );
  });

  /** 场景：flushSync 从空根挂载旧式边界与抛 Hello 的 child；日志包含两次失败尝试、一次 cDC 和 fallback render，返回后错误文本已可见。验证同步范围耗尽 cDC 安排的恢复更新。 */
  it('catches render error in a boundary during synchronous mounting', () => {
    /** flushSync 挂载的旧式边界，观察失败重试之后 cDC 的恢复 state 更新仍被同步耗尽。 */
    class ErrorBoundary extends React.Component {
      /** 捕获 Hello 后替换原 children，首次为 null。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch：在 componentDidCatch 中将捕获值写入 state，排入恢复更新。 */
      componentDidCatch(error) {
        Scheduler.log('ErrorBoundary componentDidCatch');
        this.setState({error});
      }
      /** 记录 try/fallback，输出错误文本用于 flushSync 返回后的最终宿主断言。 */
      render() {
        if (this.state.error) {
          Scheduler.log('ErrorBoundary render error');
          return (
            <span prop={`Caught an error: ${this.state.error.message}.`} />
          );
        }
        Scheduler.log('ErrorBoundary render success');
        return this.props.children;
      }
    }

    /** “catches render error in a boundary during synchronous mounting”中的失败函数夹具 BrokenRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BrokenRender({unused}) {
      Scheduler.log('BrokenRender');
      throw new Error('Hello');
    }

    ReactNoop.flushSync(() => {
      ReactNoop.render(
        <ErrorBoundary>
          <BrokenRender />
        </ErrorBoundary>,
      );
    });

    assertLog([
      'ErrorBoundary render success',
      'BrokenRender',

      // React 再重试一次。
      'ErrorBoundary render success',
      'BrokenRender',

      // 重试再次出错，现在正式处理。
      'ErrorBoundary componentDidCatch',
      'ErrorBoundary render error',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <span prop="Caught an error: Hello." />,
    );
  });

  /** 场景：同一 flushSync 先入队 Before the storm.、再入队同一边界的失败 child；日志只见最后输入的失败尝试与恢复，最终 Hello fallback。验证同批 Root 输入替换不要求逐项宿主提交。 */
  it('catches render error in a boundary during batched mounting', () => {
    /** 同一 flushSync 里连续两个 Root element 输入的旧式边界；最后输入含故障 child，前一文本不会单独提交。 */
    class ErrorBoundary extends React.Component {
      /** 旧式提交通知保存的故障值，驱动恢复分支。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch：在 componentDidCatch 中将捕获值写入 state，排入恢复更新。 */
      componentDidCatch(error) {
        Scheduler.log('ErrorBoundary componentDidCatch');
        this.setState({error});
      }
      /** 记录当前尝试分支；捕获后生成 Hello fallback，正常时透传本轮 Root 提供的 children。 */
      render() {
        if (this.state.error) {
          Scheduler.log('ErrorBoundary render error');
          return (
            <span prop={`Caught an error: ${this.state.error.message}.`} />
          );
        }
        Scheduler.log('ErrorBoundary render success');
        return this.props.children;
      }
    }

    /** “catches render error in a boundary during batched mounting”中的失败函数夹具 BrokenRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BrokenRender({unused}) {
      Scheduler.log('BrokenRender');
      throw new Error('Hello');
    }

    ReactNoop.flushSync(() => {
      ReactNoop.render(<ErrorBoundary>Before the storm.</ErrorBoundary>);
      ReactNoop.render(
        <ErrorBoundary>
          <BrokenRender />
        </ErrorBoundary>,
      );
    });

    assertLog([
      'ErrorBoundary render success',
      'BrokenRender',

      // React 再重试一次。
      'ErrorBoundary render success',
      'BrokenRender',

      // 重试再次出错，现在正式处理。
      'ErrorBoundary componentDidCatch',
      'ErrorBoundary render error',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <span prop="Caught an error: Hello." />,
    );
  });

  /** 场景：普通 Root 挂载 cDC 会重抛原错误的边界与 BrokenRender；waitForThrow 收到 Hello，日志含两次失败 render 与一次 cDC，宿主树为空。验证边界提交通知自身的错误继续到根。 */
  it('propagates an error from a noop error boundary during full deferred mounting', async () => {
    /** “propagates an error from a noop error boundary during full deferred mounting”中的重抛错误边界：捕获后再次抛出，验证更外层恢复与错误保真。 */
    class RethrowErrorBoundary extends React.Component {
      /** RethrowErrorBoundary.componentDidCatch 记录日志后重抛原错误，让错误继续向外传播。 */
      componentDidCatch(error) {
        Scheduler.log('RethrowErrorBoundary componentDidCatch');
        throw error;
      }
      /** 记录重抛边界的正常尝试并透传 children；自身无恢复 state，cDC 重抛后根被清空。 */
      render() {
        Scheduler.log('RethrowErrorBoundary render');
        return this.props.children;
      }
    }

    /** “propagates an error from a noop error boundary during full deferred mounting”中的失败函数夹具 BrokenRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BrokenRender({unused}) {
      Scheduler.log('BrokenRender');
      throw new Error('Hello');
    }

    ReactNoop.render(
      <RethrowErrorBoundary>
        <BrokenRender />
      </RethrowErrorBoundary>,
    );

    await waitForThrow('Hello');
    assertLog([
      'RethrowErrorBoundary render',
      'BrokenRender',

      // React 再重试一次。
      'RethrowErrorBoundary render',
      'BrokenRender',

      // 重试再次出错，现在正式处理。
      'RethrowErrorBoundary componentDidCatch',
    ]);
    expect(ReactNoop.getChildrenAsJSX()).toEqual(null);
  });

  /** 场景：transition 先停在重抛边界 render，后继续到故障 child；waitForThrow 收到 Hello，后续日志含同步重试与 cDC，最终根为空。验证部分挂载的重抛边界不会保留失败树。 */
  it('propagates an error from a noop error boundary during partial deferred mounting', async () => {
    /** “propagates an error from a noop error boundary during partial deferred mounting”中的重抛错误边界：捕获后再次抛出，验证更外层恢复与错误保真。 */
    class RethrowErrorBoundary extends React.Component {
      /** RethrowErrorBoundary.componentDidCatch 记录日志后重抛原错误，让错误继续向外传播。 */
      componentDidCatch(error) {
        Scheduler.log('RethrowErrorBoundary componentDidCatch');
        throw error;
      }
      /** 记录 transition 让出前的边界尝试并透传故障 child，供后续同步恢复日志比较。 */
      render() {
        Scheduler.log('RethrowErrorBoundary render');
        return this.props.children;
      }
    }

    /** “propagates an error from a noop error boundary during partial deferred mounting”中的失败函数夹具 BrokenRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BrokenRender({unused}) {
      Scheduler.log('BrokenRender');
      throw new Error('Hello');
    }

    React.startTransition(() => {
      ReactNoop.render(
        <RethrowErrorBoundary>
          <BrokenRender />
        </RethrowErrorBoundary>,
      );
    });

    await waitFor(['RethrowErrorBoundary render']);

    await waitForThrow('Hello');
    assertLog([
      'BrokenRender',

      // React 再重试一次。
      'RethrowErrorBoundary render',
      'BrokenRender',

      // 重试再次出错，现在正式处理。
      'RethrowErrorBoundary componentDidCatch',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(null);
  });

  /** 场景：flushSync 挂载重抛 cDC 的边界与 Hello child；日志检查两次失败尝试和一次重抛回调，最终根为空。本例没有 toThrow 断言，验证目标是同步清空及回调顺序。 */
  it('propagates an error from a noop error boundary during synchronous mounting', () => {
    /** “propagates an error from a noop error boundary during synchronous mounting”中的重抛错误边界：捕获后再次抛出，验证更外层恢复与错误保真。 */
    class RethrowErrorBoundary extends React.Component {
      /** RethrowErrorBoundary.componentDidCatch 记录日志后重抛原错误，让错误继续向外传播。 */
      componentDidCatch(error) {
        Scheduler.log('RethrowErrorBoundary componentDidCatch');
        throw error;
      }
      /** 记录同步挂载的边界尝试；同一故障 child 在恢复重试中再次运行。 */
      render() {
        Scheduler.log('RethrowErrorBoundary render');
        return this.props.children;
      }
    }

    /** “propagates an error from a noop error boundary during synchronous mounting”中的失败函数夹具 BrokenRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BrokenRender({unused}) {
      Scheduler.log('BrokenRender');
      throw new Error('Hello');
    }

    ReactNoop.flushSync(() => {
      ReactNoop.render(
        <RethrowErrorBoundary>
          <BrokenRender />
        </RethrowErrorBoundary>,
      );
    });

    assertLog([
      'RethrowErrorBoundary render',
      'BrokenRender',

      // React 再重试一次。
      'RethrowErrorBoundary render',
      'BrokenRender',

      // 重试再次出错，现在正式处理。
      'RethrowErrorBoundary componentDidCatch',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(null);
  });

  /** 场景：同一 flushSync 先排正常文本，再排重抛边界中的 Hello child；日志只见失败树两次尝试及 cDC，根为空。验证同批替换后错误提交通知的处理，不单独断言调用栈抛错。 */
  it('propagates an error from a noop error boundary during batched mounting', () => {
    /** “propagates an error from a noop error boundary during batched mounting”中的重抛错误边界：捕获后再次抛出，验证更外层恢复与错误保真。 */
    class RethrowErrorBoundary extends React.Component {
      /** RethrowErrorBoundary.componentDidCatch 记录日志后重抛原错误，让错误继续向外传播。 */
      componentDidCatch(error) {
        Scheduler.log('RethrowErrorBoundary componentDidCatch');
        throw error;
      }
      /** 透传同批最后 Root 输入并记录边界 render，区分前一正常文本是否曾单独渲染。 */
      render() {
        Scheduler.log('RethrowErrorBoundary render');
        return this.props.children;
      }
    }

    /** “propagates an error from a noop error boundary during batched mounting”中的失败函数夹具 BrokenRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BrokenRender({unused}) {
      Scheduler.log('BrokenRender');
      throw new Error('Hello');
    }

    ReactNoop.flushSync(() => {
      ReactNoop.render(
        <RethrowErrorBoundary>Before the storm.</RethrowErrorBoundary>,
      );
      ReactNoop.render(
        <RethrowErrorBoundary>
          <BrokenRender />
        </RethrowErrorBoundary>,
      );
    });

    assertLog([
      'RethrowErrorBoundary render',
      'BrokenRender',

      // React 再重试一次。
      'RethrowErrorBoundary render',
      'BrokenRender',

      // 重试再次出错，现在正式处理。
      'RethrowErrorBoundary componentDidCatch',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(null);
  });

  /** 场景：先排 a:1，在 batchedUpdates 排 a:2/a:3 后由调用者直接抛 Hello；外层 toThrow 检查原错误，后续调度仍提交 a:3。验证调度范围异常不撤销已入队 Root 更新。 */
  it('applies batched updates regardless despite errors in scheduling', async () => {
    ReactNoop.render(<span prop="a:1" />);
    expect(() => {
      ReactNoop.batchedUpdates(() => {
        ReactNoop.render(<span prop="a:2" />);
        ReactNoop.render(<span prop="a:3" />);
        throw new Error('Hello');
      });
    }).toThrow('Hello');
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="a:3" />);
  });

  /** 场景：外层批次排 a:2/a:3，内层再排 a:4/a:5 后抛 Hello；异常穿过两层范围，随后最终为 a:5。验证嵌套执行上下文恢复且入队更新保留。 */
  it('applies nested batched updates despite errors in scheduling', async () => {
    ReactNoop.render(<span prop="a:1" />);
    expect(() => {
      ReactNoop.batchedUpdates(() => {
        ReactNoop.render(<span prop="a:2" />);
        ReactNoop.render(<span prop="a:3" />);
        ReactNoop.batchedUpdates(() => {
          ReactNoop.render(<span prop="a:4" />);
          ReactNoop.render(<span prop="a:5" />);
          throw new Error('Hello');
        });
      });
    }).toThrow('Hello');
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="a:5" />);
  });

  // TODO：这是否属于破坏性变更？
  /** 场景：flushSync 中嵌 batchedUpdates，入队 a:2/a:3 后直接抛 Hello；断言错误继续外抛，后续耗尽工作显示 a:3。此例没有同步返回后的中间宿主检查，不能单独证明标题所称“另一个事件”。 */
  it('defers additional sync work to a separate event after an error', async () => {
    ReactNoop.render(<span prop="a:1" />);
    expect(() => {
      ReactNoop.flushSync(() => {
        ReactNoop.batchedUpdates(() => {
          ReactNoop.render(<span prop="a:2" />);
          ReactNoop.render(<span prop="a:3" />);
          throw new Error('Hello');
        });
      });
    }).toThrow('Hello');
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="a:3" />);
  });

  /** 场景：初始根挂载 BrokenRender 连续两次抛 Hello 后由 waitForThrow 接收；随后替换 Foo 并看到日志。验证根初次失败后仍能接受后续正常更新。 */
  it('can schedule updates after uncaught error in render on mount', async () => {
    /** “can schedule updates after uncaught error in render on mount”中的失败函数夹具 BrokenRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BrokenRender({unused}) {
      Scheduler.log('BrokenRender');
      throw new Error('Hello');
    }

    /** 故障根清空后记录 Foo 并返回 null，验证同一 renderer 还能接受新的正常更新。 */
    function Foo({unused}) {
      Scheduler.log('Foo');
      return null;
    }

    ReactNoop.render(<BrokenRender />);
    await waitForThrow('Hello');
    ReactNoop.render(<Foo />);
    assertLog([
      'BrokenRender',
      // React 再重试一次。
      'BrokenRender',
      // 重试再次出错。
    ]);
    await waitForAll(['Foo']);
  });

  /** 场景：先让 BrokenRender 正常挂载，再用 shouldThrow=true 更新触发两次 Hello 尝试；waitForThrow 后替换 Foo 成功。验证已有根的 render 失败不会永久阻断调度。 */
  it('can schedule updates after uncaught error in render on update', async () => {
    /** “can schedule updates after uncaught error in render on update”中的失败函数夹具 BrokenRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BrokenRender({shouldThrow}) {
      Scheduler.log('BrokenRender');
      if (shouldThrow) {
        throw new Error('Hello');
      }
      return null;
    }

    /** 记录恢复后的正常替换组件，证明更新期根错误没有永久阻止后续调度。 */
    function Foo({unused}) {
      Scheduler.log('Foo');
      return null;
    }

    ReactNoop.render(<BrokenRender shouldThrow={false} />);
    await waitForAll(['BrokenRender']);

    ReactNoop.render(<BrokenRender shouldThrow={true} />);
    await waitForThrow('Hello');
    assertLog([
      'BrokenRender',
      // React 再重试一次。
      'BrokenRender',
      // 重试再次出错。
    ]);

    ReactNoop.render(<Foo />);
    await waitForAll(['Foo']);
  });

  /** 场景：先挂载卸载回调会抛 Hello 的类，替换 div 触发删除错误；waitForThrow 后再 render Foo 并看到日志。验证删除阶段未捕获错误后 renderer 仍可复用。 */
  it('can schedule updates after uncaught error during unmounting', async () => {
    /** “can schedule updates after uncaught error during unmounting”中的失败类夹具 BrokenComponentWillUnmount：在指定生命周期制造错误，定位 commit/unwind 边界。 */
    class BrokenComponentWillUnmount extends React.Component {
      /** 挂载普通 div，卸载生命周期才抛错，隔离删除阶段错误来源。 */
      render() {
        return <div />;
      }
      /** BrokenComponentWillUnmount.componentWillUnmount：在删除阶段故意抛错，验证其余卸载工作和外层边界仍能继续。 */
      componentWillUnmount() {
        throw new Error('Hello');
      }
    }

    /** 卸载抛错后再次渲染的正常探针，仅记录 Foo，无自身宿主输出。 */
    function Foo() {
      Scheduler.log('Foo');
      return null;
    }

    ReactNoop.render(<BrokenComponentWillUnmount />);
    await waitForAll([]);

    ReactNoop.render(<div />);
    await waitForThrow('Hello');

    ReactNoop.render(<Foo />);
    await waitForAll(['Foo']);
  });

  /** 场景：Parent 包含也将卸载的 Boundary 和 ThrowsOnUnmount；render(null) 时日志为父卸载、故障子卸载，waitForThrow 收到 unmount error，没有 cDC 捕获日志。验证删除中的边界不是存活恢复目标。 */
  it('should not attempt to recover an unmounting error boundary', async () => {
    /** 整个 Parent 子树将被删除，包含也在删除的 Boundary；卸载日志用于确认其错误不会由被删边界接住。 */
    class Parent extends React.Component {
      /** Parent.componentWillUnmount：记录父子删除顺序，并确认错误 unwind 不重复或遗漏清理。 */
      componentWillUnmount() {
        Scheduler.log('Parent componentWillUnmount');
      }
      /** 固定返回 Boundary，建立根到待删除错误边界的祖先关系。 */
      render() {
        return <Boundary />;
      }
    }

    /** 只记录 cDC 的边界，随 Parent 一起删除；应被捕获搜索排除，不能在删除树里恢复。 */
    class Boundary extends React.Component {
      /** 只记录捕获日志；本例检查删除中的 Boundary 是否会被错误选作恢复目标。 */
      componentDidCatch(e) {
        Scheduler.log(`Caught error: ${e.message}`);
      }
      /** 返回会在卸载时抛错的后代，自身没有 fallback 状态。 */
      render() {
        return <ThrowsOnUnmount />;
      }
    }

    /** “should not attempt to recover an unmounting error boundary”中的失败类夹具 ThrowsOnUnmount：在指定生命周期制造错误，定位 commit/unwind 边界。 */
    class ThrowsOnUnmount extends React.Component {
      /** ThrowsOnUnmount.componentWillUnmount：在删除阶段故意抛错，验证其余卸载工作和外层边界仍能继续。 */
      componentWillUnmount() {
        Scheduler.log('ThrowsOnUnmount componentWillUnmount');
        throw new Error('unmount error');
      }
      /** 渲染 null，不在 render 抛错；唯一故障点是其卸载回调。 */
      render() {
        return null;
      }
    }

    ReactNoop.render(<Parent />);
    await waitForAll([]);

    // 错误边界自身也在卸载，
    // 因此 ThrowsOnUnmount 的错误必须继续上抛。
    ReactNoop.render(null);
    await waitForThrow('unmount error');
    await assertLog([
      'Parent componentWillUnmount',
      'ThrowsOnUnmount componentWillUnmount',
    ]);

    ReactNoop.render(<Parent />);
  });

  /** 场景：Parent.step=0 挂载空 cDC 边界和 Child；再次同步 render 触发 Child.didUpdate，先把 Parent.step 设 1、再抛 update error；冲刷结束未抛到测试。本例没有输出断言，回归目标是边界先被父更新移除时能完成处理。 */
  it('can unmount an error boundary before it is handled', async () => {
    let parent;

    /** 保存 parent 实例的控制层，step=1 时移除 Boundary，使已入队的边界错误恢复失去目标。 */
    class Parent extends React.Component {
      /** 0 保留 Boundary，Child 更新回调切到 1 后删除它。 */
      state = {step: 0};
      /** 暴露 this 给 Child 的提交回调，按 step 决定是否还保留错误边界。 */
      render() {
        parent = this;
        return this.state.step === 0 ? <Boundary /> : null;
      }
    }

    /** 空 cDC 使它成为可捕获边界；同次提交由 Child 先安排父更新将它删除，不生成 fallback。 */
    class Boundary extends React.Component {
      /** 空捕获回调使 Boundary 成为错误边界；Child 的提交更新会先将它从树中移除。 */
      componentDidCatch() {}
      /** 固定返回 Child，建立被移除边界与更新期错误源的关系。 */
      render() {
        return <Child />;
      }
    }

    /** 更新提交探针：先要求 Parent 移除边界，再抛 update error，检验捕获更新与父删除交错。 */
    class Child extends React.Component {
      /** 先入队 parent.step=1，再抛出固定错误；顺序是该回归场景的关键，挂载时不会执行。 */
      componentDidUpdate() {
        parent.setState({step: 1});
        throw new Error('update error');
      }
      /** 渲染 null，故障与父更新只发生在 didUpdate。 */
      render() {
        return null;
      }
    }

    ReactNoop.render(<Parent />);
    await waitForAll([]);

    ReactNoop.flushSync(() => {
      ReactNoop.render(<Parent />);
    });
  });

  /** 场景：根 a 挂边界与 Hello child，独立根 b 挂 b:1；耗尽后 a 显示恢复文本，b 仍提交 b:1。验证一个根捕获错误不取消其它根工作。 */
  it('continues work on other roots despite caught errors', async () => {
    /** 根 a 的旧式恢复边界，捕获 Hello 后显示 fallback，与独立根 b 的正常提交并列检查。 */
    class ErrorBoundary extends React.Component {
      /** a 根捕获值，初始 null，恢复后移除失败 child。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch：在 componentDidCatch 中将捕获值写入 state，排入恢复更新。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** 正常透传 a 的 child，捕获后显示带句点的 Hello 文本，不依赖 b 的 state。 */
      render() {
        if (this.state.error) {
          return (
            <span prop={`Caught an error: ${this.state.error.message}.`} />
          );
        }
        return this.props.children;
      }
    }

    /** “continues work on other roots despite caught errors”中的失败函数夹具 BrokenRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BrokenRender(props) {
      throw new Error('Hello');
    }

    ReactNoop.renderToRootWithID(
      <ErrorBoundary>
        <BrokenRender />
      </ErrorBoundary>,
      'a',
    );
    ReactNoop.renderToRootWithID(<span prop="b:1" />, 'b');
    await waitForAll([]);
    expect(ReactNoop.getChildrenAsJSX('a')).toEqual(
      <span prop="Caught an error: Hello." />,
    );
    await waitForAll([]);
    expect(ReactNoop.getChildrenAsJSX('b')).toEqual(<span prop="b:1" />);
  });

  /** 场景：依次在 a/b/e 等根制造未捕获 label 错误，交错给其它根入队正常 span；每次 waitForThrow 后失败根为 null，其它根保留/推进相应版本，最后逐根卸载皆为空。验证多根队列在反复根故障之后仍可继续调度与清理。 */
  it('continues work on other roots despite uncaught errors', async () => {
    /** “continues work on other roots despite uncaught errors”中的失败函数夹具 BrokenRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BrokenRender(props) {
      throw new Error(props.label);
    }

    ReactNoop.renderToRootWithID(<BrokenRender label="a" />, 'a');
    await waitForThrow('a');
    expect(ReactNoop.getChildrenAsJSX('a')).toEqual(null);

    ReactNoop.renderToRootWithID(<BrokenRender label="a" />, 'a');
    ReactNoop.renderToRootWithID(<span prop="b:2" />, 'b');
    await waitForThrow('a');

    await waitForAll([]);
    expect(ReactNoop.getChildrenAsJSX('a')).toEqual(null);
    expect(ReactNoop.getChildrenAsJSX('b')).toEqual(<span prop="b:2" />);

    ReactNoop.renderToRootWithID(<span prop="a:3" />, 'a');
    ReactNoop.renderToRootWithID(<BrokenRender label="b" />, 'b');
    await waitForThrow('b');
    expect(ReactNoop.getChildrenAsJSX('a')).toEqual(<span prop="a:3" />);
    expect(ReactNoop.getChildrenAsJSX('b')).toEqual(null);

    ReactNoop.renderToRootWithID(<span prop="a:4" />, 'a');
    ReactNoop.renderToRootWithID(<BrokenRender label="b" />, 'b');
    ReactNoop.renderToRootWithID(<span prop="c:4" />, 'c');
    await waitForThrow('b');
    await waitForAll([]);
    expect(ReactNoop.getChildrenAsJSX('a')).toEqual(<span prop="a:4" />);
    expect(ReactNoop.getChildrenAsJSX('b')).toEqual(null);
    expect(ReactNoop.getChildrenAsJSX('c')).toEqual(<span prop="c:4" />);

    ReactNoop.renderToRootWithID(<span prop="a:5" />, 'a');
    ReactNoop.renderToRootWithID(<span prop="b:5" />, 'b');
    ReactNoop.renderToRootWithID(<span prop="c:5" />, 'c');
    ReactNoop.renderToRootWithID(<span prop="d:5" />, 'd');
    ReactNoop.renderToRootWithID(<BrokenRender label="e" />, 'e');
    await waitForThrow('e');
    await waitForAll([]);
    expect(ReactNoop.getChildrenAsJSX('a')).toEqual(<span prop="a:5" />);
    expect(ReactNoop.getChildrenAsJSX('b')).toEqual(<span prop="b:5" />);
    expect(ReactNoop.getChildrenAsJSX('c')).toEqual(<span prop="c:5" />);
    expect(ReactNoop.getChildrenAsJSX('d')).toEqual(<span prop="d:5" />);
    expect(ReactNoop.getChildrenAsJSX('e')).toEqual(null);

    ReactNoop.renderToRootWithID(<BrokenRender label="a" />, 'a');
    await waitForThrow('a');

    ReactNoop.renderToRootWithID(<span prop="b:6" />, 'b');
    ReactNoop.renderToRootWithID(<BrokenRender label="c" />, 'c');
    await waitForThrow('c');

    ReactNoop.renderToRootWithID(<span prop="d:6" />, 'd');
    ReactNoop.renderToRootWithID(<BrokenRender label="e" />, 'e');
    ReactNoop.renderToRootWithID(<span prop="f:6" />, 'f');
    await waitForThrow('e');

    await waitForAll([]);
    expect(ReactNoop.getChildrenAsJSX('a')).toEqual(null);
    expect(ReactNoop.getChildrenAsJSX('b')).toEqual(<span prop="b:6" />);
    expect(ReactNoop.getChildrenAsJSX('c')).toEqual(null);
    expect(ReactNoop.getChildrenAsJSX('d')).toEqual(<span prop="d:6" />);
    expect(ReactNoop.getChildrenAsJSX('e')).toEqual(null);
    expect(ReactNoop.getChildrenAsJSX('f')).toEqual(<span prop="f:6" />);

    ReactNoop.unmountRootWithID('a');
    ReactNoop.unmountRootWithID('b');
    ReactNoop.unmountRootWithID('c');
    ReactNoop.unmountRootWithID('d');
    ReactNoop.unmountRootWithID('e');
    ReactNoop.unmountRootWithID('f');
    await waitForAll([]);
    expect(ReactNoop.getChildrenAsJSX('a')).toEqual(null);
    expect(ReactNoop.getChildrenAsJSX('b')).toEqual(null);
    expect(ReactNoop.getChildrenAsJSX('c')).toEqual(null);
    expect(ReactNoop.getChildrenAsJSX('d')).toEqual(null);
    expect(ReactNoop.getChildrenAsJSX('e')).toEqual(null);
    expect(ReactNoop.getChildrenAsJSX('f')).toEqual(null);
  });

  // 注意：移除 legacy context 后可直接删除
  // 此测试。通用栈 unwind 已由 new context、Suspense
  // 及其他能力充分覆盖；
  // 各能力仍需独立测试自己的栈行为。因此本例虽然
  // 表面通用，实际只针对 legacy context。
  /** 场景：启用 legacy Context 时，外层 a 中的边界含 b/c/d/e 嵌套 Provider 和 BadRender，旁边有 Connector；捕获后移除 BadRender，Connector 输出只能为 a，而不是 abcde。验证 unwind 恢复 Provider 栈，并核对弃用诊断。 */
  // @gate !disableLegacyContext && !disableLegacyContextForFunctionComponents
  it('unwinds the context stack correctly on error', async () => {
    /** “unwinds the context stack correctly on error”中的旧 Context Provider：建立 legacy context 栈，验证错误 unwind 后栈恢复。 */
    class Provider extends React.Component {
      /** Provider.childContextTypes：声明旧 Context 向下提供的字段形状，供 unwind 栈测试使用。 */
      static childContextTypes = {message: PropTypes.string};
      /** Provider.contextTypes：声明 Provider 自身消费的旧 Context，验证嵌套上下文恢复。 */
      static contextTypes = {message: PropTypes.string};
      /** Provider.getChildContext 将父级 message 与本层 props.message 拼接，便于从完整路径检查 context 栈恢复。 */
      getChildContext() {
        return {
          message: (this.context.message || '') + this.props.message,
        };
      }
      /** 透传 children，在 Fiber legacy Provider 栈中增加一层，而不新增宿主节点。 */
      render() {
        return this.props.children;
      }
    }

    /** Connector 将接收到的 legacy context.message 写入宿主 prop，作为栈恢复的断言值。 */
    function Connector(props, context) {
      return <span prop={context.message} />;
    }

    Connector.contextTypes = {
      message: PropTypes.string,
    };

    /** “unwinds the context stack correctly on error”中的失败函数夹具 BadRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BadRender() {
      throw new Error('render error');
    }

    /** 在 legacy a 下建立 b/c/d/e 链，捕获后移除最深 BadRender；旁边 Connector 必须只读外层 a。 */
    class Boundary extends React.Component {
      /** 捕获值仅用于阻止最深 BadRender 再次挂载，Provider 嵌套结构保留。 */
      state = {error: null};
      /** Boundary.componentDidCatch：在 componentDidCatch 中将捕获值写入 state，排入恢复更新。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** 构造 b/c/d/e Provider 路径，仅正常分支包含 BadRender，便于检查错误 unwind 是否泄漏深层 Context。 */
      render() {
        return (
          <Provider message="b">
            <Provider message="c">
              <Provider message="d">
                <Provider message="e">
                  {!this.state.error && <BadRender />}
                </Provider>
              </Provider>
            </Provider>
          </Provider>
        );
      }
    }

    ReactNoop.render(
      <Provider message="a">
        <Boundary />
        <Connector />
      </Provider>,
    );

    await waitForAll([]);
    assertConsoleErrorDev([
      'Provider uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Provider (at **)',
      'Provider uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Provider (at **)',
      'Connector uses the legacy contextTypes API which will be removed soon. ' +
        'Use React.createContext() with React.useContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Connector (at **)',
    ]);

    // 若 context 栈未正确 unwind，span 将收到 'abcde'。
    expect(ReactNoop).toMatchRenderedOutput(<span prop="a" />);
  });

  /** 场景：边界子函数返回 undefined 的 InvalidType，错误由协调器生成；普通挂载完成恢复后 span 为完整 invalid-type 消息，DEV 还含 BrokenRender 提示。验证内部 JSX 类型错误也可被用户边界捕获。 */
  it('catches reconciler errors in a boundary during mounting', async () => {
    /** 捕获无效 element type 所触发的 reconciler 错误，旧式 cDC 保存该内部 Error 用于宿主断言。 */
    class ErrorBoundary extends React.Component {
      /** 初始正常，捕获后保存完整 invalid-type Error。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch：在 componentDidCatch 中将捕获值写入 state，排入恢复更新。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** 从 error.message 显示 reconciler 生成的诊断，未捕获时透传 BrokenRender。 */
      render() {
        if (this.state.error) {
          return <span prop={this.state.error.message} />;
        }
        return this.props.children;
      }
    }
    const InvalidType = undefined;
    /** 返回 type=undefined 的元素；组件函数不自己抛错，child 协调生成标准 invalid-type Error。 */
    function BrokenRender(props) {
      return <InvalidType />;
    }

    ReactNoop.render(
      <ErrorBoundary>
        <BrokenRender />
      </ErrorBoundary>,
    );
    await waitForAll([]);

    expect(ReactNoop).toMatchRenderedOutput(
      <span
        prop={
          'Element type is invalid: expected a string (for built-in components) or ' +
          'a class/function (for composite components) but got: undefined.' +
          (__DEV__
            ? " You likely forgot to export your component from the file it's " +
              'defined in, or you might have mixed up default and named imports.' +
              '\n\nCheck the render method of `BrokenRender`.'
            : '')
        }
      />,
    );
  });

  /** 场景：先以 fail=false 挂载正常 span，再让同一 child 返回 undefined type；边界恢复后输出完整 invalid-type 消息及 DEV 附加说明。验证更新协调异常沿已挂载边界捕获。 */
  it('catches reconciler errors in a boundary during update', async () => {
    /** 先正常挂载、后 fail=true 返回无效 type 的错误边界，验证内部协调错误也走已有边界恢复。 */
    class ErrorBoundary extends React.Component {
      /** 更新期捕获的内部 Error，null 表示未失败。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch：在 componentDidCatch 中将捕获值写入 state，排入恢复更新。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** 正常显示 child，失败后用内部 Error 的完整消息替换输出，包含 DEV 附加信息。 */
      render() {
        if (this.state.error) {
          return <span prop={this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    const InvalidType = undefined;
    /** fail=false 返回合法 span；fail=true 返回 undefined type，由 child 协调触发内部错误。 */
    function BrokenRender(props) {
      return props.fail ? <InvalidType /> : <span />;
    }

    ReactNoop.render(
      <ErrorBoundary>
        <BrokenRender fail={false} />
      </ErrorBoundary>,
    );
    await waitForAll([]);

    ReactNoop.render(
      <ErrorBoundary>
        <BrokenRender fail={true} />
      </ErrorBoundary>,
    );
    await waitForAll([]);

    expect(ReactNoop).toMatchRenderedOutput(
      <span
        prop={
          'Element type is invalid: expected a string (for built-in components) or ' +
          'a class/function (for composite components) but got: undefined.' +
          (__DEV__
            ? " You likely forgot to export your component from the file it's " +
              'defined in, or you might have mixed up default and named imports.' +
              '\n\nCheck the render method of `BrokenRender`.'
            : '')
        }
      />,
    );
  });

  /** 场景：空根直接 render undefined type，无用户边界；waitForThrow 检查标准消息，随后 render hi span 能成功提交。验证根内部协调错误后的复用。 */
  it('recovers from uncaught reconciler errors', async () => {
    const InvalidType = undefined;
    ReactNoop.render(<InvalidType />);

    await waitForThrow(
      'Element type is invalid: expected a string (for built-in components) or ' +
        'a class/function (for composite components) but got: undefined.' +
        (__DEV__
          ? " You likely forgot to export your component from the file it's " +
            'defined in, or you might have mixed up default and named imports.'
          : ''),
    );

    ReactNoop.render(<span prop="hi" />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="hi" />);
  });

  /** 场景：两层 Parent 包含正常 BrokenRenderAndUnmount，保存实例后在 act/flushSync 切 fail=true；最深 render 抛 Hello.，两个父卸载各抛清理错误，子卸载仍记录且根为空。internal act 收集三项错误并按顺序提供 errors 数组，验证删除清理继续与错误保留。 */
  it('unmounts components with uncaught errors', async () => {
    let inst;

    /** “unmounts components with uncaught errors”中的失败类夹具 BrokenRenderAndUnmount：在指定生命周期制造错误，定位 commit/unwind 边界。 */
    class BrokenRenderAndUnmount extends React.Component {
      /** fail=false 成功挂载，外部保留实例后同步切 true 触发 render 错误。 */
      state = {fail: false};
      /** 只记录最深组件卸载，不抛错；前面两层 Parent 的清理错误不应阻止此日志。 */
      componentWillUnmount() {
        Scheduler.log('BrokenRenderAndUnmount componentWillUnmount');
      }
      /** 暴露实例并在 fail=true 抛 Hello.；其卸载方法只记录清理，不额外抛错。 */
      render() {
        inst = this;
        if (this.state.fail) {
          throw new Error('Hello.');
        }
        return null;
      }
    }

    /** 两层同类父节点均在卸载时抛固定错误，验证父清理失败仍会继续遍历后代。 */
    class Parent extends React.Component {
      /** Parent.componentWillUnmount：记录父子删除顺序，并确认错误 unwind 不重复或遗漏清理。 */
      componentWillUnmount() {
        Scheduler.log('Parent componentWillUnmount [!]');
        throw new Error('One does not simply unmount me.');
      }
      /** 只透传 children，两个卸载错误与最深 render 错误分别定位。 */
      render() {
        return this.props.children;
      }
    }

    ReactNoop.render(
      <Parent>
        <Parent>
          <BrokenRenderAndUnmount />
        </Parent>
      </Parent>,
    );
    await waitForAll([]);

    let aggregateError;
    try {
      await act(() => {
        ReactNoop.flushSync(() => {
          inst.setState({fail: true});
        });
      });
    } catch (e) {
      aggregateError = e;
    }

    assertLog([
      // 尝试执行清理。
      // 父级清理错误不应阻止子级卸载。
      'Parent componentWillUnmount [!]',
      'Parent componentWillUnmount [!]',
      'BrokenRenderAndUnmount componentWillUnmount',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(null);

    // internal act 聚合三项错误：原 render 错误及两个 Parent 的卸载错误。
    const errors = aggregateError.errors;
    expect(errors.length).toBe(3);
    expect(errors[0].message).toBe('Hello.');
    expect(errors[1].message).toBe('One does not simply unmount me.');
    expect(errors[2].message).toBe('One does not simply unmount me.');
  });

  /** 场景：已挂载 Bar 的 callback ref 在 detach 时抛 Detach error；更新 Foo.hide=true 后仍记录 Bar unmount，根最终为空。验证 ref 断开失败不截断该类的卸载清理。 */
  it('does not interrupt unmounting if detaching a ref throws', async () => {
    /** “does not interrupt unmounting if detaching a ref throws”中的类夹具 Bar：用可观察生命周期限定当前错误恢复边界。 */
    class Bar extends React.Component {
      /** Bar.componentWillUnmount：记录父子删除顺序，并确认错误 unwind 不重复或遗漏清理。 */
      componentWillUnmount() {
        Scheduler.log('Bar unmount');
      }
      /** 返回 Bar span；callback ref 的 attach/detach 与卸载日志可对照宿主存在性。 */
      render() {
        return <span prop="Bar" />;
      }
    }

    /** Bar 的 callback ref：记录 attach/detach，并验证 ref 回调抛错后的删除清理。 */
    function barRef(inst) {
      if (inst === null) {
        Scheduler.log('barRef detach');
        throw new Error('Detach error');
      }
      Scheduler.log('barRef attach');
    }

    /** hide=false 保留带 callback ref 的 Bar，hide=true 删除它，触发 ref detach 错误而非 render 错误。 */
    function Foo(props) {
      return <div>{props.hide ? null : <Bar ref={barRef} />}</div>;
    }

    ReactNoop.render(<Foo />);
    await waitForAll(['barRef attach']);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span prop="Bar" />
      </div>,
    );

    // 执行卸载。
    ReactNoop.render(<Foo hide={true} />);
    await waitForThrow('Detach error');
    assertLog([
      'barRef detach',
      // 即使 Bar 的 ref 在 detach 时抛错，Bar 仍必须卸载。
      'Bar unmount',
    ]);
    // 因发生错误，整棵树应卸载。
    expect(ReactNoop).toMatchRenderedOutput(null);
  });

  /** 场景：空根 render 特殊 errorInBeginPhase 宿主类型；waitForThrow 接收到 Error in host config.，验证宿主 begin 错误能结束失败根的处理。 */
  it('handles error thrown by host config while working on failed root', async () => {
    ReactNoop.render(<errorInBeginPhase />);
    await waitForThrow('Error in host config.');
  });

  /** 场景：正常 div 的 Root Update 提交 callback 直接抛 Error!；waitForThrow 收到同一消息，验证根提交回调错误进入统一提交错误路径。 */
  it('handles error thrown by top-level callback', async () => {
    ReactNoop.render(<div />, () => {
      throw new Error('Error!');
    });
    await waitForThrow('Error!');
  });

  /** 场景：用普通对象 notAnError 作抛出值，经旧式边界 cDC 保存；fallback 使用 nonStandardMessage 为 oops，console.error 只调用一次且相应参数仍是原对象。验证任意抛出值身份与开发栈附加。 */
  it('error boundaries capture non-errors', async () => {
    spyOnProd(console, 'error').mockImplementation(() => {});
    spyOnDev(console, 'error').mockImplementation(() => {});

    /** 捕获普通对象的旧式边界，使用 nonStandardMessage 展示并保留原始抛出值身份供日志检查。 */
    class ErrorBoundary extends React.Component {
      /** null 为正常分支，捕获的对象并非 Error 实例。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch：在 componentDidCatch 中将捕获值写入 state，排入恢复更新。 */
      componentDidCatch(error) {
        // 普通对象也按原始值传给 cDC，随后以其 nonStandardMessage 恢复。
        Scheduler.log('componentDidCatch');
        this.setState({error});
      }
      /** 按任意捕获值的 nonStandardMessage 显示 fallback，不要求 Error.message。 */
      render() {
        if (this.state.error) {
          Scheduler.log('ErrorBoundary (catch)');
          return (
            <span
              prop={`Caught an error: ${this.state.error.nonStandardMessage}`}
            />
          );
        }
        Scheduler.log('ErrorBoundary (try)');
        return this.props.children;
      }
    }

    /** Indirection 记录经过中间组件的 render 日志，并透传 children。 */
    function Indirection({children}) {
      Scheduler.log('Indirection');
      return children;
    }

    const notAnError = {nonStandardMessage: 'oops'};
    /** BadRender 抛出普通对象 notAnError，验证边界可捕获任意抛出值。 */
    function BadRender({unused}) {
      Scheduler.log('BadRender');
      throw notAnError;
    }

    ReactNoop.render(
      <ErrorBoundary>
        <Indirection>
          <BadRender />
        </Indirection>
      </ErrorBoundary>,
    );

    await waitForAll([
      'ErrorBoundary (try)',
      'Indirection',
      'BadRender',

      // React 再重试一次。
      'ErrorBoundary (try)',
      'Indirection',
      'BadRender',

      // 重试再次出错，现在正式处理。
      'componentDidCatch',
      'ErrorBoundary (catch)',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <span prop="Caught an error: oops" />,
    );

    if (__DEV__) {
      expect(console.error).toHaveBeenCalledTimes(1);
      expect(console.error.mock.calls[0][1]).toBe(notAnError);
      expect(console.error.mock.calls[0][2]).toContain(
        'The above error occurred in the <BadRender> component',
      );
    } else {
      expect(console.error).toHaveBeenCalledTimes(1);
      expect(console.error.mock.calls[0][0]).toBe(notAnError);
    }
  });

  // TODO：错误边界不会捕获 Promise。

  /** 场景：旧式边界内先放抛 oops! 的 BadRender，再放两个只记录日志的正常 sibling；两次失败尝试后 cDC 驱动 ErrorMessage，最终 fallback 可见。日志没有两个 sibling 的记录，实际验证错误后放弃边界子树，标题所称继续 sibling 没有由本例证明。 */
  it('continues working on siblings of a component that throws', async () => {
    /** 故障子树旁带两个成功 sibling 的旧式边界；日志检查当前实现实际放弃整个边界子树并进入 fallback。 */
    class ErrorBoundary extends React.Component {
      /** 保存 oops! 后只渲染 ErrorMessage，不再访问原 sibling。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch：在 componentDidCatch 中将捕获值写入 state，排入恢复更新。 */
      componentDidCatch(error) {
        Scheduler.log('componentDidCatch');
        this.setState({error});
      }
      /** 记录 try/catch 并切换整棵 children；错误日志中没有 BadRenderSibling，因此不证明继续渲染这两个 sibling。 */
      render() {
        if (this.state.error) {
          Scheduler.log('ErrorBoundary (catch)');
          return <ErrorMessage error={this.state.error} />;
        }
        Scheduler.log('ErrorBoundary (try)');
        return this.props.children;
      }
    }

    /** 记录 fallback 的 render 日志，并返回可断言的错误文本。 */
    function ErrorMessage({error}) {
      Scheduler.log('ErrorMessage');
      return <span prop={`Caught an error: ${error.message}`} />;
    }

    /** 不抛错的 sibling，只记日志并返回 null；本例实际没有访问到它，不能按名称视为失败夹具。 */
    function BadRenderSibling({unused}) {
      Scheduler.log('BadRenderSibling');
      return null;
    }

    /** “continues working on siblings of a component that throws”中的失败函数夹具 BadRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BadRender({unused}) {
      Scheduler.log('throw');
      throw new Error('oops!');
    }

    ReactNoop.render(
      <ErrorBoundary>
        <BadRender />
        <BadRenderSibling />
        <BadRenderSibling />
      </ErrorBoundary>,
    );

    await waitForAll([
      'ErrorBoundary (try)',
      'throw',
      // 此处没有 BadRenderSibling 日志：本次失败跳过边界剩余 children。

      // React 再重试一次。
      'ErrorBoundary (try)',
      'throw',

      // 重试再次出错，现在正式处理。
      'componentDidCatch',
      'ErrorBoundary (catch)',
      'ErrorMessage',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <span prop="Caught an error: oops!" />,
    );
  });

  /** 场景：Parent 只有 didUpdate 与 cDC，没有 didMount；初次挂载 BadRender 两次失败后捕获并更新 fallback，日志末尾为 did update。验证恢复更新选正确生命周期，不按 didUpdate 存在误调用 didMount。 */
  it('calls the correct lifecycles on the error boundary after catching an error (mixed)', async () => {
    // 此例看似刻意，但来自真实回归：
    // 实现错误检查 didUpdate 是否存在，而非 didMount；
    // 同时 didMount 未定义。
    /** “calls the correct lifecycles on the error boundary after catching an error (mixed)”中的失败函数夹具 BadRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BadRender({unused}) {
      Scheduler.log('throw');
      throw new Error('oops!');
    }

    /** 只定义 didUpdate、不定义 didMount 的旧式边界，检查挂载故障恢复不会误调用不存在的挂载回调。 */
    class Parent extends React.Component {
      /** error 控制 fallback，other=false 是本例不变的附加 state 字段。 */
      state = {error: null, other: false};
      /** Parent.componentDidCatch：在 componentDidCatch 中将捕获值写入 state，排入恢复更新。 */
      componentDidCatch(error) {
        Scheduler.log('did catch');
        this.setState({error});
      }
      /** 记录 did update，捕获提交后 setState 产生的恢复更新应执行它。 */
      componentDidUpdate() {
        Scheduler.log('did update');
      }
      /** 记录普通与错误文本分支，初次子树故障两次尝试后由 cDC 驱动 fallback 更新。 */
      render() {
        if (this.state.error) {
          Scheduler.log('render error message');
          return <span prop={`Caught an error: ${this.state.error.message}`} />;
        }
        Scheduler.log('render');
        return <BadRender />;
      }
    }

    ReactNoop.render(<Parent step={1} />);
    await waitFor([
      'render',
      'throw',
      'render',
      'throw',
      'did catch',
      'render error message',
      'did update',
    ]);
    expect(ReactNoop).toMatchRenderedOutput(
      <span prop="Caught an error: oops!" />,
    );
  });

  /** 场景：旧式边界 cDC 接收 errorInfo 并存入 state；Hello child 失败后，宿主输出规范化的 BrokenRender→ErrorBoundary componentStack。验证栈是 cDC 第二实参而非 Error.message。 */
  it('provides component stack to the error boundary with componentDidCatch', async () => {
    /** 同时保存 error 与 errorInfo 的旧式边界，以输出验证 cDC 收到故障组件到边界的 componentStack。 */
    class ErrorBoundary extends React.Component {
      /** 原始 Error 与提交通知提供的 errorInfo 分开保存，后者用于格式化栈。 */
      state = {error: null, errorInfo: null};
      /** ErrorBoundary.componentDidCatch：在 componentDidCatch 中将捕获值写入 state，排入恢复更新。 */
      componentDidCatch(error, errorInfo) {
        this.setState({error, errorInfo});
      }
      /** errorInfo 存在时格式化 componentStack，并把源码位置规范化为 **，否则透传 children。 */
      render() {
        if (this.state.errorInfo) {
          Scheduler.log('render error message');
          return (
            <span
              prop={`Caught an error:${normalizeCodeLocInfo(
                this.state.errorInfo.componentStack,
              )}.`}
            />
          );
        }
        return this.props.children;
      }
    }

    /** “provides component stack to the error boundary with componentDidCatch”中的失败函数夹具 BrokenRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BrokenRender(props) {
      throw new Error('Hello');
    }

    ReactNoop.render(
      <ErrorBoundary>
        <BrokenRender />
      </ErrorBoundary>,
    );
    await waitForAll(['render error message']);
    expect(ReactNoop).toMatchRenderedOutput(
      <span
        prop={
          'Caught an error:\n' +
          '    in BrokenRender (at **)\n' +
          '    in ErrorBoundary (at **).'
        }
      />,
    );
  });

  /** 场景：静态 getDerivedStateFromError 的第二形参名为 errorInfo；Hello child 失败时方法断言该参数 undefined，仍返回 Error 并显示 fallback。验证静态错误 API 仅接收原始抛出值。 */
  it('does not provide component stack to the error boundary with getDerivedStateFromError', async () => {
    /** 静态派生错误边界，方法内部断言第二实参未提供；与有 errorInfo 的 cDC 区分。 */
    class ErrorBoundary extends React.Component {
      /** 静态错误 API 返回的恢复值，驱动无 componentStack 的 fallback。 */
      state = {error: null};
      /** ErrorBoundary.getDerivedStateFromError：把 render 错误折叠为恢复 state，使下一分支渲染 fallback。 */
      static getDerivedStateFromError(error, errorInfo) {
        expect(errorInfo).toBeUndefined();
        return {error};
      }
      /** 按 Error.message 显示 Hello，不要求第二 errorInfo 参数。 */
      render() {
        if (this.state.error) {
          return <span prop={`Caught an error: ${this.state.error.message}`} />;
        }
        return this.props.children;
      }
    }

    /** “does not provide component stack to the error boundary with getDerivedStateFromError”中的失败函数夹具 BrokenRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BrokenRender(props) {
      throw new Error('Hello');
    }

    ReactNoop.render(
      <ErrorBoundary>
        <BrokenRender />
      </ErrorBoundary>,
    );
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <span prop="Caught an error: Hello" />,
    );
  });

  /** 场景：先覆盖全局 Error.prepareStackTrace 为自定义格式，再挂 cDC 边界与 Hello child；冲刷后还原该钩子，输出仍是规范化 BrokenRender→ErrorBoundary 栈。验证 React 组件栈不依赖用户 Error.stack 格式。 */
  it('provides component stack even if overriding prepareStackTrace', async () => {
    /** 覆盖 V8 的 Error.stack 格式化钩子，按 callsite 输出自定义字段；测试 React 独立 componentStack 仍能保留组件名。冲刷后手动清除此全局钩子。 */
    Error.prepareStackTrace = function (error, callsites) {
      const stack = ['An error occurred:', error.message];
      for (let i = 0; i < callsites.length; i++) {
        const callsite = callsites[i];
        stack.push(
          '\t' + callsite.getFunctionName(),
          '\t\tat ' + callsite.getFileName(),
          '\t\ton line ' + callsite.getLineNumber(),
        );
      }

      return stack.join('\n');
    };

    /** 全局 prepareStackTrace 被改写时仍保存 cDC 的独立 componentStack，用稳定组件名校验诊断不受用户格式化影响。 */
    class ErrorBoundary extends React.Component {
      /** 原始故障与单独的 componentStack 信息；初始均未设置。 */
      state = {error: null, errorInfo: null};
      /** ErrorBoundary.componentDidCatch：在 componentDidCatch 中将捕获值写入 state，排入恢复更新。 */
      componentDidCatch(error, errorInfo) {
        this.setState({error, errorInfo});
      }
      /** 输出规范化的 componentStack，允许底层 Error.stack 使用自定义格式。 */
      render() {
        if (this.state.errorInfo) {
          Scheduler.log('render error message');
          return (
            <span
              prop={`Caught an error:${normalizeCodeLocInfo(
                this.state.errorInfo.componentStack,
              )}.`}
            />
          );
        }
        return this.props.children;
      }
    }

    /** “provides component stack even if overriding prepareStackTrace”中的失败函数夹具 BrokenRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BrokenRender(props) {
      throw new Error('Hello');
    }

    ReactNoop.render(
      <ErrorBoundary>
        <BrokenRender />
      </ErrorBoundary>,
    );
    await waitForAll(['render error message']);
    Error.prepareStackTrace = undefined;

    expect(ReactNoop).toMatchRenderedOutput(
      <span
        prop={
          'Caught an error:\n' +
          '    in BrokenRender (at **)\n' +
          '    in ErrorBoundary (at **).'
        }
      />,
    );
  });

  /** 场景：transition 的 Oops 已抛错并让出，输出仍为空；另一 transition 用正常文本替换根输入；act 最终成功显示文本，同时报告一次已恢复并发错误。验证被后续输入替代的故障不再作为未捕获错误终止根。 */
  it('uncaught errors should be discarded if the render is aborted', async () => {
    const root = ReactNoop.createRoot();

    /** “uncaught errors should be discarded if the render is aborted”中的失败函数夹具 Oops：在 render 时抛出固定错误，触发目标恢复分支。 */
    function Oops({unused}) {
      Scheduler.log('Oops');
      throw Error('Oops');
    }

    await act(async () => {
      React.startTransition(() => {
        root.render(<Oops />);
      });

      // render 越过抛错组件后让出执行权。
      await waitFor(['Oops']);
      expect(root).toMatchRenderedOutput(null);
      // 插入交错更新。根完成时不应直接抛出
      // 错误，而应重新 render；该更新会使它
      // 成功恢复。
      React.startTransition(() => {
        root.render('Everything is fine.');
      });
    });

    // 应无错误完成。
    assertConsoleErrorDev([
      'Error: There was an error during concurrent rendering but React was able to recover by instead synchronously rendering the entire root.' +
        '\n    in <stack>',
    ]);
    expect(root).toMatchRenderedOutput('Everything is fine.');
  });

  /** 场景：先挂载 Oops 保存 setter，随后普通 Root 输入仍为 Oops、transition 输入换 AllGood；等 AllGood render 日志出现但尚未提交，再对当前 Oops 入队离散抛错更新。最终同步恢复采用待处理 Root 替换，显示 Everything is fine 并仅报告可恢复错误。 */
  it('uncaught errors are discarded if the render is aborted, case 2', async () => {
    const {useState} = React;
    const root = ReactNoop.createRoot();

    let setShouldThrow;
    /** “uncaught errors are discarded if the render is aborted, case 2”中的失败函数夹具 Oops：在 render 时抛出固定错误，触发目标恢复分支。 */
    function Oops() {
      const [shouldThrow, _setShouldThrow] = useState(false);
      setShouldThrow = _setShouldThrow;
      if (shouldThrow) {
        throw Error('Oops');
      }
      return null;
    }

    /** 替换整个 Root 输入的正常组件，记录并输出 Everything is fine；它不是 Oops 的 sibling。 */
    function AllGood() {
      Scheduler.log('Everything is fine.');
      return 'Everything is fine.';
    }

    await act(() => {
      root.render(<Oops />);
    });

    await act(async () => {
      // 在根上安排 default 与 low priority 更新。
      root.render(<Oops />);
      React.startTransition(() => {
        root.render(<AllGood />);
      });

      // default 输入已处理；transition 的 AllGood 已开始 render，并在提交前让出，
      // 因而当前已提交树仍包含可接收下面 setter 更新的 Oops。
      await waitFor(['Everything is fine.']);

      // 在 child 上安排会触发错误的 discrete 更新。
      // 根应捕获该错误；但因根仍有 pending
      // 更新，错误应暂时抑制。
      ReactNoop.discreteUpdates(() => {
        setShouldThrow(true);
      });
    });
    // 应渲染最终状态且不抛出错误。
    assertLog(['Everything is fine.']);
    assertConsoleErrorDev([
      'Error: There was an error during concurrent rendering but React was able to recover by instead synchronously rendering the entire root.' +
        '\n    in <stack>',
    ]);
    expect(root).toMatchRenderedOutput('Everything is fine.');
  });

  /** 场景：先正常挂载 App/Child 并保存 Child setter；App.shouldThrow=true 的 render 先跨组件更新、后计数并抛 Oops!；act 捕获 Oops! 且次数小于 100，DEV 检查一次跨组件更新错误和一次未捕获错误警告。验证恢复能终止，不要求固定重试次数。 */
  it("does not infinite loop if there's a render phase update in the same render as an error", async () => {
    // App 在 render 中调用先前保存的 Child setter，随后自身抛出 Oops。
    // 这个组合会触发 render 阶段跨组件更新警告和错误恢复；
    // 断言最终抛出 Oops 且抛错次数小于 100，验证恢复能终止。

    spyOnDev(console, 'error').mockImplementation(() => {});
    spyOnDev(console, 'warn').mockImplementation(() => {});

    let numberOfThrows = 0;

    let setStateInRenderPhase;
    /** 初始挂载保存 Child setter；App 后续在自身 render 中调用它，制造跨组件 render 更新但不由 Child 抛错。 */
    function Child() {
      const [, setState] = React.useState(0);
      setStateInRenderPhase = setState;
      return 'All good';
    }

    /** 正常返回 Child；shouldThrow=true 时先跨组件更新、累计次数，再抛 Oops!，用次数上限检查错误恢复能终止。 */
    function App({shouldThrow}) {
      if (shouldThrow) {
        setStateInRenderPhase();
        numberOfThrows++;
        throw new Error('Oops!');
      }
      return <Child />;
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(<App shouldThrow={false} />);
    });
    expect(root).toMatchRenderedOutput('All good');

    let error;
    try {
      await act(() => {
        root.render(<App shouldThrow={true} />);
      });
    } catch (e) {
      error = e;
    }

    expect(error.message).toBe('Oops!');
    expect(numberOfThrows < 100).toBe(true);

    if (__DEV__) {
      expect(console.error).toHaveBeenCalledTimes(1);
      expect(console.error.mock.calls[0][0]).toContain(
        'Cannot update a component (`%s`) while rendering a different component',
      );
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.warn.mock.calls[0][1]).toContain(
        'An error occurred in the <App> component',
      );
    }
  });

  if (global.__PERSISTENT__) {
    /** 场景：仅 persistent renderer 分支定义：空根 render 特殊文本 Error when completing root，使根完成阶段直接失败；waitForThrow 接收消息。其它构建不定义本例，验证根自身错误能触发致命结束而不寻找自身边界。 */
    it('regression test: should fatal if error is thrown at the root', async () => {
      const root = ReactNoop.createRoot();
      root.render('Error when completing root');
      await waitForThrow('Error when completing root');
    });
  }
});
