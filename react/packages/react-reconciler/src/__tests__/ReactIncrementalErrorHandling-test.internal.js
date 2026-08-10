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

  /** Given 已挂载错误边界、失败节点与正常 sibling；When 执行“recovers from errors asynchronously”定义的抛错、重试或恢复；Then 边界状态、fallback 和错误身份符合预期。验证机制：渲染树、日志及 console；对应 ReactFiberThrow、ReactFiberUnwindWork、ReactFiberWorkLoop。 */
  it('recovers from errors asynchronously', async () => {
    /** “recovers from errors asynchronously”中的错误边界：保存捕获状态并在 children 与 fallback 间切换，隔离本例失败范围。 */
    class ErrorBoundary extends React.Component {
      /** ErrorBoundary.state：保存本例已捕获错误或更新阶段；初始值代表正常渲染，变化后驱动恢复分支。 */
      state = {error: null};
      /** ErrorBoundary.getDerivedStateFromError：把 render 错误折叠为恢复 state，使下一分支渲染 fallback。 */
      static getDerivedStateFromError(error) {
        Scheduler.log('getDerivedStateFromError');
        return {error};
      }
      /** ErrorBoundary.render：依据错误 state 选择原 children 或 fallback，形成“recovers from errors asynchronously”的恢复输出。 */
      render() {
        if (this.state.error) {
          Scheduler.log('ErrorBoundary (catch)');
          return <ErrorMessage error={this.state.error} />;
        }
        Scheduler.log('ErrorBoundary (try)');
        return this.props.children;
      }
    }

    /** 把捕获错误渲染为可断言文本，并记录恢复提交发生的时点。 */
    function ErrorMessage({error}) {
      Scheduler.log('ErrorMessage');
      return <span prop={`Caught an error: ${error.message}`} />;
    }

    /** Indirection 中间层：增加一层 Fiber/Context 转发，验证错误栈与 unwind 不跳过祖先。 */
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

  /** Given 已挂载错误边界、失败节点与正常 sibling；When 执行“recovers from errors asynchronously (legacy, no getDerivedStateFromError)”定义的抛错、重试或恢复；Then 边界状态、fallback 和错误身份符合预期。验证机制：渲染树、日志及 console；对应 ReactFiberThrow、ReactFiberUnwindWork、ReactFiberWorkLoop。 */
  it('recovers from errors asynchronously (legacy, no getDerivedStateFromError)', async () => {
    /** “recovers from errors asynchronously (legacy, no getDerivedStateFromError)”中的错误边界：保存捕获状态并在 children 与 fallback 间切换，隔离本例失败范围。 */
    class ErrorBoundary extends React.Component {
      /** ErrorBoundary.state：保存本例已捕获错误或更新阶段；初始值代表正常渲染，变化后驱动恢复分支。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch：记录捕获信息并安排恢复，验证边界 commit 阶段错误处理。 */
      componentDidCatch(error) {
        Scheduler.log('componentDidCatch');
        this.setState({error});
      }
      /** ErrorBoundary.render：依据错误 state 选择原 children 或 fallback，形成“recovers from errors asynchronously (legacy, no getDerivedStateFromError)”的恢复输出。 */
      render() {
        if (this.state.error) {
          Scheduler.log('ErrorBoundary (catch)');
          return <ErrorMessage error={this.state.error} />;
        }
        Scheduler.log('ErrorBoundary (try)');
        return this.props.children;
      }
    }

    /** 把捕获错误渲染为可断言文本，并记录恢复提交发生的时点。 */
    function ErrorMessage({error}) {
      Scheduler.log('ErrorMessage');
      return <span prop={`Caught an error: ${error.message}`} />;
    }

    /** Indirection 中间层：增加一层 Fiber/Context 转发，验证错误栈与 unwind 不跳过祖先。 */
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

  /** Given 已初始化本组错误处理夹具；When 执行“retries at a lower priority if there's additional pending work”的 render/update 序列；Then 成功与失败子树按预期提交或回滚。验证机制：Noop 输出、Scheduler 与错误断言；对应 ReactFiberThrow 和 ReactFiberWorkLoop。 */
  it("retries at a lower priority if there's additional pending work", async () => {
    /** App 组合夹具：为“retries at a lower priority if there's additional pending work”装配边界、失败节点与 siblings，控制更新拓扑。 */
    function App(props) {
      if (props.isBroken) {
        Scheduler.log('error');
        throw new Error('Oops!');
      }
      Scheduler.log('success');
      return <span prop="Everything is fine." />;
    }

    /** Profiler onCommit 回调：记录本次提交，用于确认失败或恢复 render 是否真正进入 commit。 */
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

    // React 会把全部 pending 更新合并到一个同步 batch
    // 中恢复；本次能够成功。
    //
    // 这里只要求 Scheduler render 一个 work unit；错误恢复 render
    // 是同步的，因此一个 unit 足以
    // 完成全部剩余工作。
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

  /** Given 失败节点位于 hidden/Offscreen 结构；When 执行“does not include offscreen work when retrying after an error”的更新序列；Then 错误传播与可见树提交互不污染。验证机制：Noop 输出、日志与错误断言；对应 ReactFiberOffscreenComponent、ReactFiberThrow。 */
  // @gate enableLegacyHidden
  it('does not include offscreen work when retrying after an error', async () => {
    /** App 组合夹具：为“does not include offscreen work when retrying after an error”装配边界、失败节点与 siblings，控制更新拓扑。 */
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

    /** Profiler onCommit 回调：记录本次提交，用于确认失败或恢复 render 是否真正进入 commit。 */
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

    // React 会把全部 pending 更新合并到一个同步 batch
    // 中恢复；本次能够成功。
    //
    // 这里只要求 Scheduler render 一个 work unit；错误恢复 render
    // 是同步的，因此一个 unit 足以
    // 完成全部剩余工作。
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

  /** Given 已挂载错误边界、失败节点与正常 sibling；When 执行“retries one more time before handling error”定义的抛错、重试或恢复；Then 边界状态、fallback 和错误身份符合预期。验证机制：渲染树、日志及 console；对应 ReactFiberThrow、ReactFiberUnwindWork、ReactFiberWorkLoop。 */
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

    /** Parent 组合夹具：为“retries one more time before handling error”装配边界、失败节点与 siblings，控制更新拓扑。 */
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

  /** Given 已挂载错误边界、失败节点与正常 sibling；When 执行“retries one more time if an error occurs during a render that expires midway through the tree”定义的抛错、重试或恢复；Then 边界状态、fallback 和错误身份符合预期。验证机制：渲染树、日志及 console；对应 ReactFiberThrow、ReactFiberUnwindWork、ReactFiberWorkLoop。 */
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

    /** App 组合夹具：为“retries one more time if an error occurs during a render that expires midway through the tree”装配边界、失败节点与 siblings，控制更新拓扑。 */
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

  /** Given 已挂载错误边界、失败节点与正常 sibling；When 执行“calls componentDidCatch multiple times for multiple errors”定义的抛错、重试或恢复；Then 边界状态、fallback 和错误身份符合预期。验证机制：渲染树、日志及 console；对应 ReactFiberThrow、ReactFiberUnwindWork、ReactFiberWorkLoop。 */
  it('calls componentDidCatch multiple times for multiple errors', async () => {
    let id = 0;
    /** “calls componentDidCatch multiple times for multiple errors”中的失败类夹具 BadMount：在指定生命周期制造错误，定位 commit/unwind 边界。 */
    class BadMount extends React.Component {
      /** BadMount.componentDidMount：记录或制造 mount commit 行为，定位“calls componentDidCatch multiple times for multiple errors”的提交错误边界。 */
      componentDidMount() {
        throw new Error(`Error ${++id}`);
      }
      /** BadMount.render：在受控条件下制造 render 错误，驱动当前错误恢复路径。 */
      render() {
        Scheduler.log('BadMount');
        return null;
      }
    }

    /** “calls componentDidCatch multiple times for multiple errors”中的错误边界：保存捕获状态并在 children 与 fallback 间切换，隔离本例失败范围。 */
    class ErrorBoundary extends React.Component {
      /** ErrorBoundary.state：保存本例已捕获错误或更新阶段；初始值代表正常渲染，变化后驱动恢复分支。 */
      state = {errorCount: 0};
      /** ErrorBoundary.componentDidCatch：记录捕获信息并安排恢复，验证边界 commit 阶段错误处理。 */
      componentDidCatch(error) {
        Scheduler.log(`componentDidCatch: ${error.message}`);
        this.setState(state => ({errorCount: state.errorCount + 1}));
      }
      /** ErrorBoundary.render：依据错误 state 选择原 children 或 fallback，形成“calls componentDidCatch multiple times for multiple errors”的恢复输出。 */
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

  /** Given 已挂载含可观察生命周期/ref 的树；When 执行“catches render error in a boundary during full deferred mounting”规定的提交失败或删除；Then 其余 commit 工作、清理顺序与错误路由保持正确。验证机制：Scheduler/console/树断言；对应 ReactFiberCommitEffects、ReactFiberWorkLoop 与 ReactFiberErrorLogger。 */
  it('catches render error in a boundary during full deferred mounting', async () => {
    /** “catches render error in a boundary during full deferred mounting”中的错误边界：保存捕获状态并在 children 与 fallback 间切换，隔离本例失败范围。 */
    class ErrorBoundary extends React.Component {
      /** ErrorBoundary.state：保存本例已捕获错误或更新阶段；初始值代表正常渲染，变化后驱动恢复分支。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch：记录捕获信息并安排恢复，验证边界 commit 阶段错误处理。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** ErrorBoundary.render：依据错误 state 选择原 children 或 fallback，形成“catches render error in a boundary during full deferred mounting”的恢复输出。 */
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

  /** Given 已挂载含可观察生命周期/ref 的树；When 执行“catches render error in a boundary during partial deferred mounting”规定的提交失败或删除；Then 其余 commit 工作、清理顺序与错误路由保持正确。验证机制：Scheduler/console/树断言；对应 ReactFiberCommitEffects、ReactFiberWorkLoop 与 ReactFiberErrorLogger。 */
  it('catches render error in a boundary during partial deferred mounting', async () => {
    /** “catches render error in a boundary during partial deferred mounting”中的错误边界：保存捕获状态并在 children 与 fallback 间切换，隔离本例失败范围。 */
    class ErrorBoundary extends React.Component {
      /** ErrorBoundary.state：保存本例已捕获错误或更新阶段；初始值代表正常渲染，变化后驱动恢复分支。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch：记录捕获信息并安排恢复，验证边界 commit 阶段错误处理。 */
      componentDidCatch(error) {
        Scheduler.log('ErrorBoundary componentDidCatch');
        this.setState({error});
      }
      /** ErrorBoundary.render：依据错误 state 选择原 children 或 fallback，形成“catches render error in a boundary during partial deferred mounting”的恢复输出。 */
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

  /** Given 已挂载含可观察生命周期/ref 的树；When 执行“catches render error in a boundary during synchronous mounting”规定的提交失败或删除；Then 其余 commit 工作、清理顺序与错误路由保持正确。验证机制：Scheduler/console/树断言；对应 ReactFiberCommitEffects、ReactFiberWorkLoop 与 ReactFiberErrorLogger。 */
  it('catches render error in a boundary during synchronous mounting', () => {
    /** “catches render error in a boundary during synchronous mounting”中的错误边界：保存捕获状态并在 children 与 fallback 间切换，隔离本例失败范围。 */
    class ErrorBoundary extends React.Component {
      /** ErrorBoundary.state：保存本例已捕获错误或更新阶段；初始值代表正常渲染，变化后驱动恢复分支。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch：记录捕获信息并安排恢复，验证边界 commit 阶段错误处理。 */
      componentDidCatch(error) {
        Scheduler.log('ErrorBoundary componentDidCatch');
        this.setState({error});
      }
      /** ErrorBoundary.render：依据错误 state 选择原 children 或 fallback，形成“catches render error in a boundary during synchronous mounting”的恢复输出。 */
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

  /** Given 已挂载含可观察生命周期/ref 的树；When 执行“catches render error in a boundary during batched mounting”规定的提交失败或删除；Then 其余 commit 工作、清理顺序与错误路由保持正确。验证机制：Scheduler/console/树断言；对应 ReactFiberCommitEffects、ReactFiberWorkLoop 与 ReactFiberErrorLogger。 */
  it('catches render error in a boundary during batched mounting', () => {
    /** “catches render error in a boundary during batched mounting”中的错误边界：保存捕获状态并在 children 与 fallback 间切换，隔离本例失败范围。 */
    class ErrorBoundary extends React.Component {
      /** ErrorBoundary.state：保存本例已捕获错误或更新阶段；初始值代表正常渲染，变化后驱动恢复分支。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch：记录捕获信息并安排恢复，验证边界 commit 阶段错误处理。 */
      componentDidCatch(error) {
        Scheduler.log('ErrorBoundary componentDidCatch');
        this.setState({error});
      }
      /** ErrorBoundary.render：依据错误 state 选择原 children 或 fallback，形成“catches render error in a boundary during batched mounting”的恢复输出。 */
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

  /** Given 已挂载含可观察生命周期/ref 的树；When 执行“propagates an error from a noop error boundary during full deferred mounting”规定的提交失败或删除；Then 其余 commit 工作、清理顺序与错误路由保持正确。验证机制：Scheduler/console/树断言；对应 ReactFiberCommitEffects、ReactFiberWorkLoop 与 ReactFiberErrorLogger。 */
  it('propagates an error from a noop error boundary during full deferred mounting', async () => {
    /** “propagates an error from a noop error boundary during full deferred mounting”中的重抛错误边界：捕获后再次抛出，验证更外层恢复与错误保真。 */
    class RethrowErrorBoundary extends React.Component {
      /** RethrowErrorBoundary.componentDidCatch：记录捕获信息并安排恢复，验证边界 commit 阶段错误处理。 */
      componentDidCatch(error) {
        Scheduler.log('RethrowErrorBoundary componentDidCatch');
        throw error;
      }
      /** RethrowErrorBoundary.render：依据错误 state 选择原 children 或 fallback，形成“propagates an error from a noop error boundary during full deferred mounting”的恢复输出。 */
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

  /** Given 已挂载含可观察生命周期/ref 的树；When 执行“propagates an error from a noop error boundary during partial deferred mounting”规定的提交失败或删除；Then 其余 commit 工作、清理顺序与错误路由保持正确。验证机制：Scheduler/console/树断言；对应 ReactFiberCommitEffects、ReactFiberWorkLoop 与 ReactFiberErrorLogger。 */
  it('propagates an error from a noop error boundary during partial deferred mounting', async () => {
    /** “propagates an error from a noop error boundary during partial deferred mounting”中的重抛错误边界：捕获后再次抛出，验证更外层恢复与错误保真。 */
    class RethrowErrorBoundary extends React.Component {
      /** RethrowErrorBoundary.componentDidCatch：记录捕获信息并安排恢复，验证边界 commit 阶段错误处理。 */
      componentDidCatch(error) {
        Scheduler.log('RethrowErrorBoundary componentDidCatch');
        throw error;
      }
      /** RethrowErrorBoundary.render：依据错误 state 选择原 children 或 fallback，形成“propagates an error from a noop error boundary during partial deferred mounting”的恢复输出。 */
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

  /** Given 已挂载含可观察生命周期/ref 的树；When 执行“propagates an error from a noop error boundary during synchronous mounting”规定的提交失败或删除；Then 其余 commit 工作、清理顺序与错误路由保持正确。验证机制：Scheduler/console/树断言；对应 ReactFiberCommitEffects、ReactFiberWorkLoop 与 ReactFiberErrorLogger。 */
  it('propagates an error from a noop error boundary during synchronous mounting', () => {
    /** “propagates an error from a noop error boundary during synchronous mounting”中的重抛错误边界：捕获后再次抛出，验证更外层恢复与错误保真。 */
    class RethrowErrorBoundary extends React.Component {
      /** RethrowErrorBoundary.componentDidCatch：记录捕获信息并安排恢复，验证边界 commit 阶段错误处理。 */
      componentDidCatch(error) {
        Scheduler.log('RethrowErrorBoundary componentDidCatch');
        throw error;
      }
      /** RethrowErrorBoundary.render：依据错误 state 选择原 children 或 fallback，形成“propagates an error from a noop error boundary during synchronous mounting”的恢复输出。 */
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

  /** Given 已挂载含可观察生命周期/ref 的树；When 执行“propagates an error from a noop error boundary during batched mounting”规定的提交失败或删除；Then 其余 commit 工作、清理顺序与错误路由保持正确。验证机制：Scheduler/console/树断言；对应 ReactFiberCommitEffects、ReactFiberWorkLoop 与 ReactFiberErrorLogger。 */
  it('propagates an error from a noop error boundary during batched mounting', () => {
    /** “propagates an error from a noop error boundary during batched mounting”中的重抛错误边界：捕获后再次抛出，验证更外层恢复与错误保真。 */
    class RethrowErrorBoundary extends React.Component {
      /** RethrowErrorBoundary.componentDidCatch：记录捕获信息并安排恢复，验证边界 commit 阶段错误处理。 */
      componentDidCatch(error) {
        Scheduler.log('RethrowErrorBoundary componentDidCatch');
        throw error;
      }
      /** RethrowErrorBoundary.render：依据错误 state 选择原 children 或 fallback，形成“propagates an error from a noop error boundary during batched mounting”的恢复输出。 */
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

  /** Given 已挂载错误边界、失败节点与正常 sibling；When 执行“applies batched updates regardless despite errors in scheduling”定义的抛错、重试或恢复；Then 边界状态、fallback 和错误身份符合预期。验证机制：渲染树、日志及 console；对应 ReactFiberThrow、ReactFiberUnwindWork、ReactFiberWorkLoop。 */
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

  /** Given 已挂载错误边界、失败节点与正常 sibling；When 执行“applies nested batched updates despite errors in scheduling”定义的抛错、重试或恢复；Then 边界状态、fallback 和错误身份符合预期。验证机制：渲染树、日志及 console；对应 ReactFiberThrow、ReactFiberUnwindWork、ReactFiberWorkLoop。 */
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
  /** Given 失败节点位于 hidden/Offscreen 结构；When 执行“defers additional sync work to a separate event after an error”的更新序列；Then 错误传播与可见树提交互不污染。验证机制：Noop 输出、日志与错误断言；对应 ReactFiberOffscreenComponent、ReactFiberThrow。 */
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

  /** Given 已挂载含可观察生命周期/ref 的树；When 执行“can schedule updates after uncaught error in render on mount”规定的提交失败或删除；Then 其余 commit 工作、清理顺序与错误路由保持正确。验证机制：Scheduler/console/树断言；对应 ReactFiberCommitEffects、ReactFiberWorkLoop 与 ReactFiberErrorLogger。 */
  it('can schedule updates after uncaught error in render on mount', async () => {
    /** “can schedule updates after uncaught error in render on mount”中的失败函数夹具 BrokenRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BrokenRender({unused}) {
      Scheduler.log('BrokenRender');
      throw new Error('Hello');
    }

    /** Foo 组合夹具：为“can schedule updates after uncaught error in render on mount”装配边界、失败节点与 siblings，控制更新拓扑。 */
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

  /** Given 已挂载错误边界、失败节点与正常 sibling；When 执行“can schedule updates after uncaught error in render on update”定义的抛错、重试或恢复；Then 边界状态、fallback 和错误身份符合预期。验证机制：渲染树、日志及 console；对应 ReactFiberThrow、ReactFiberUnwindWork、ReactFiberWorkLoop。 */
  it('can schedule updates after uncaught error in render on update', async () => {
    /** “can schedule updates after uncaught error in render on update”中的失败函数夹具 BrokenRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BrokenRender({shouldThrow}) {
      Scheduler.log('BrokenRender');
      if (shouldThrow) {
        throw new Error('Hello');
      }
      return null;
    }

    /** Foo 组合夹具：为“can schedule updates after uncaught error in render on update”装配边界、失败节点与 siblings，控制更新拓扑。 */
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

  /** Given 已挂载含可观察生命周期/ref 的树；When 执行“can schedule updates after uncaught error during unmounting”规定的提交失败或删除；Then 其余 commit 工作、清理顺序与错误路由保持正确。验证机制：Scheduler/console/树断言；对应 ReactFiberCommitEffects、ReactFiberWorkLoop 与 ReactFiberErrorLogger。 */
  it('can schedule updates after uncaught error during unmounting', async () => {
    /** “can schedule updates after uncaught error during unmounting”中的失败类夹具 BrokenComponentWillUnmount：在指定生命周期制造错误，定位 commit/unwind 边界。 */
    class BrokenComponentWillUnmount extends React.Component {
      /** BrokenComponentWillUnmount.render：在受控条件下制造 render 错误，驱动当前错误恢复路径。 */
      render() {
        return <div />;
      }
      /** BrokenComponentWillUnmount.componentWillUnmount：在删除阶段故意抛错，验证其余卸载工作和外层边界仍能继续。 */
      componentWillUnmount() {
        throw new Error('Hello');
      }
    }

    /** Foo 组合夹具：为“can schedule updates after uncaught error during unmounting”装配边界、失败节点与 siblings，控制更新拓扑。 */
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

  /** Given 已挂载含可观察生命周期/ref 的树；When 执行“should not attempt to recover an unmounting error boundary”规定的提交失败或删除；Then 其余 commit 工作、清理顺序与错误路由保持正确。验证机制：Scheduler/console/树断言；对应 ReactFiberCommitEffects、ReactFiberWorkLoop 与 ReactFiberErrorLogger。 */
  it('should not attempt to recover an unmounting error boundary', async () => {
    /** “should not attempt to recover an unmounting error boundary”中的父级类夹具：承载失败子树并暴露父生命周期或状态恢复顺序。 */
    class Parent extends React.Component {
      /** Parent.componentWillUnmount：记录父子删除顺序，并确认错误 unwind 不重复或遗漏清理。 */
      componentWillUnmount() {
        Scheduler.log('Parent componentWillUnmount');
      }
      /** Parent.render：输出可观察测试树，并把本例状态映射为确定的 reconciliation 输入。 */
      render() {
        return <Boundary />;
      }
    }

    /** “should not attempt to recover an unmounting error boundary”中的错误边界：保存捕获状态并在 children 与 fallback 间切换，隔离本例失败范围。 */
    class Boundary extends React.Component {
      /** Boundary.componentDidCatch：记录捕获信息并安排恢复，验证边界 commit 阶段错误处理。 */
      componentDidCatch(e) {
        Scheduler.log(`Caught error: ${e.message}`);
      }
      /** Boundary.render：依据错误 state 选择原 children 或 fallback，形成“should not attempt to recover an unmounting error boundary”的恢复输出。 */
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
      /** ThrowsOnUnmount.render：输出可观察测试树，并把本例状态映射为确定的 reconciliation 输入。 */
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

  /** Given 已挂载含可观察生命周期/ref 的树；When 执行“can unmount an error boundary before it is handled”规定的提交失败或删除；Then 其余 commit 工作、清理顺序与错误路由保持正确。验证机制：Scheduler/console/树断言；对应 ReactFiberCommitEffects、ReactFiberWorkLoop 与 ReactFiberErrorLogger。 */
  it('can unmount an error boundary before it is handled', async () => {
    let parent;

    /** “can unmount an error boundary before it is handled”中的父级类夹具：承载失败子树并暴露父生命周期或状态恢复顺序。 */
    class Parent extends React.Component {
      /** Parent.state：保存本例已捕获错误或更新阶段；初始值代表正常渲染，变化后驱动恢复分支。 */
      state = {step: 0};
      /** Parent.render：输出可观察测试树，并把本例状态映射为确定的 reconciliation 输入。 */
      render() {
        parent = this;
        return this.state.step === 0 ? <Boundary /> : null;
      }
    }

    /** “can unmount an error boundary before it is handled”中的错误边界：保存捕获状态并在 children 与 fallback 间切换，隔离本例失败范围。 */
    class Boundary extends React.Component {
      /** Boundary.componentDidCatch：记录捕获信息并安排恢复，验证边界 commit 阶段错误处理。 */
      componentDidCatch() {}
      /** Boundary.render：依据错误 state 选择原 children 或 fallback，形成“can unmount an error boundary before it is handled”的恢复输出。 */
      render() {
        return <Child />;
      }
    }

    /** “can unmount an error boundary before it is handled”中的子级类夹具：记录 update/commit 生命周期，暴露错误恢复对实例的影响。 */
    class Child extends React.Component {
      /** Child.componentDidUpdate：观察恢复更新后的实例状态与 callback 顺序。 */
      componentDidUpdate() {
        parent.setState({step: 1});
        throw new Error('update error');
      }
      /** Child.render：输出可观察测试树，并把本例状态映射为确定的 reconciliation 输入。 */
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

  /** Given 已挂载错误边界、失败节点与正常 sibling；When 执行“continues work on other roots despite caught errors”定义的抛错、重试或恢复；Then 边界状态、fallback 和错误身份符合预期。验证机制：渲染树、日志及 console；对应 ReactFiberThrow、ReactFiberUnwindWork、ReactFiberWorkLoop。 */
  it('continues work on other roots despite caught errors', async () => {
    /** “continues work on other roots despite caught errors”中的错误边界：保存捕获状态并在 children 与 fallback 间切换，隔离本例失败范围。 */
    class ErrorBoundary extends React.Component {
      /** ErrorBoundary.state：保存本例已捕获错误或更新阶段；初始值代表正常渲染，变化后驱动恢复分支。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch：记录捕获信息并安排恢复，验证边界 commit 阶段错误处理。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** ErrorBoundary.render：依据错误 state 选择原 children 或 fallback，形成“continues work on other roots despite caught errors”的恢复输出。 */
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

  /** Given 已挂载错误边界、失败节点与正常 sibling；When 执行“continues work on other roots despite uncaught errors”定义的抛错、重试或恢复；Then 边界状态、fallback 和错误身份符合预期。验证机制：渲染树、日志及 console；对应 ReactFiberThrow、ReactFiberUnwindWork、ReactFiberWorkLoop。 */
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
  /** Given 已建立 legacy Context Provider/consumer 与错误边界；When 执行“unwinds the context stack correctly on error”中的失败和恢复；Then Context 栈正确 unwind，后续 render 不读取污染值。验证机制：输出及错误断言；对应 ReactFiberContext、ReactFiberUnwindWork。 */
  // @gate !disableLegacyContext && !disableLegacyContextForFunctionComponents
  it('unwinds the context stack correctly on error', async () => {
    /** “unwinds the context stack correctly on error”中的旧 Context Provider：建立 legacy context 栈，验证错误 unwind 后栈恢复。 */
    class Provider extends React.Component {
      /** Provider.childContextTypes：声明旧 Context 向下提供的字段形状，供 unwind 栈测试使用。 */
      static childContextTypes = {message: PropTypes.string};
      /** Provider.contextTypes：声明 Provider 自身消费的旧 Context，验证嵌套上下文恢复。 */
      static contextTypes = {message: PropTypes.string};
      /** Provider.getChildContext：返回稳定旧 Context 值，用于检查失败 render 后上下文栈是否复位。 */
      getChildContext() {
        return {
          message: (this.context.message || '') + this.props.message,
        };
      }
      /** Provider.render：输出可观察测试树，并把本例状态映射为确定的 reconciliation 输入。 */
      render() {
        return this.props.children;
      }
    }

    /** Connector 中间层：增加一层 Fiber/Context 转发，验证错误栈与 unwind 不跳过祖先。 */
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

    /** “unwinds the context stack correctly on error”中的错误边界：保存捕获状态并在 children 与 fallback 间切换，隔离本例失败范围。 */
    class Boundary extends React.Component {
      /** Boundary.state：保存本例已捕获错误或更新阶段；初始值代表正常渲染，变化后驱动恢复分支。 */
      state = {error: null};
      /** Boundary.componentDidCatch：记录捕获信息并安排恢复，验证边界 commit 阶段错误处理。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** Boundary.render：依据错误 state 选择原 children 或 fallback，形成“unwinds the context stack correctly on error”的恢复输出。 */
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

  /** Given 已挂载含可观察生命周期/ref 的树；When 执行“catches reconciler errors in a boundary during mounting”规定的提交失败或删除；Then 其余 commit 工作、清理顺序与错误路由保持正确。验证机制：Scheduler/console/树断言；对应 ReactFiberCommitEffects、ReactFiberWorkLoop 与 ReactFiberErrorLogger。 */
  it('catches reconciler errors in a boundary during mounting', async () => {
    /** “catches reconciler errors in a boundary during mounting”中的错误边界：保存捕获状态并在 children 与 fallback 间切换，隔离本例失败范围。 */
    class ErrorBoundary extends React.Component {
      /** ErrorBoundary.state：保存本例已捕获错误或更新阶段；初始值代表正常渲染，变化后驱动恢复分支。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch：记录捕获信息并安排恢复，验证边界 commit 阶段错误处理。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** ErrorBoundary.render：依据错误 state 选择原 children 或 fallback，形成“catches reconciler errors in a boundary during mounting”的恢复输出。 */
      render() {
        if (this.state.error) {
          return <span prop={this.state.error.message} />;
        }
        return this.props.children;
      }
    }
    const InvalidType = undefined;
    /** “catches reconciler errors in a boundary during mounting”中的失败函数夹具 BrokenRender：在 render 时抛出固定错误，触发目标恢复分支。 */
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

  /** Given 已挂载错误边界、失败节点与正常 sibling；When 执行“catches reconciler errors in a boundary during update”定义的抛错、重试或恢复；Then 边界状态、fallback 和错误身份符合预期。验证机制：渲染树、日志及 console；对应 ReactFiberThrow、ReactFiberUnwindWork、ReactFiberWorkLoop。 */
  it('catches reconciler errors in a boundary during update', async () => {
    /** “catches reconciler errors in a boundary during update”中的错误边界：保存捕获状态并在 children 与 fallback 间切换，隔离本例失败范围。 */
    class ErrorBoundary extends React.Component {
      /** ErrorBoundary.state：保存本例已捕获错误或更新阶段；初始值代表正常渲染，变化后驱动恢复分支。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch：记录捕获信息并安排恢复，验证边界 commit 阶段错误处理。 */
      componentDidCatch(error) {
        this.setState({error});
      }
      /** ErrorBoundary.render：依据错误 state 选择原 children 或 fallback，形成“catches reconciler errors in a boundary during update”的恢复输出。 */
      render() {
        if (this.state.error) {
          return <span prop={this.state.error.message} />;
        }
        return this.props.children;
      }
    }

    const InvalidType = undefined;
    /** “catches reconciler errors in a boundary during update”中的失败函数夹具 BrokenRender：在 render 时抛出固定错误，触发目标恢复分支。 */
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

  /** Given 已挂载错误边界、失败节点与正常 sibling；When 执行“recovers from uncaught reconciler errors”定义的抛错、重试或恢复；Then 边界状态、fallback 和错误身份符合预期。验证机制：渲染树、日志及 console；对应 ReactFiberThrow、ReactFiberUnwindWork、ReactFiberWorkLoop。 */
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

  /** Given 已挂载含可观察生命周期/ref 的树；When 执行“unmounts components with uncaught errors”规定的提交失败或删除；Then 其余 commit 工作、清理顺序与错误路由保持正确。验证机制：Scheduler/console/树断言；对应 ReactFiberCommitEffects、ReactFiberWorkLoop 与 ReactFiberErrorLogger。 */
  it('unmounts components with uncaught errors', async () => {
    let inst;

    /** “unmounts components with uncaught errors”中的失败类夹具 BrokenRenderAndUnmount：在指定生命周期制造错误，定位 commit/unwind 边界。 */
    class BrokenRenderAndUnmount extends React.Component {
      /** BrokenRenderAndUnmount.state：保存本例已捕获错误或更新阶段；初始值代表正常渲染，变化后驱动恢复分支。 */
      state = {fail: false};
      /** BrokenRenderAndUnmount.componentWillUnmount：在删除阶段故意抛错，验证其余卸载工作和外层边界仍能继续。 */
      componentWillUnmount() {
        Scheduler.log('BrokenRenderAndUnmount componentWillUnmount');
      }
      /** BrokenRenderAndUnmount.render：在受控条件下制造 render 错误，驱动当前错误恢复路径。 */
      render() {
        inst = this;
        if (this.state.fail) {
          throw new Error('Hello.');
        }
        return null;
      }
    }

    /** “unmounts components with uncaught errors”中的父级类夹具：承载失败子树并暴露父生命周期或状态恢复顺序。 */
    class Parent extends React.Component {
      /** Parent.componentWillUnmount：记录父子删除顺序，并确认错误 unwind 不重复或遗漏清理。 */
      componentWillUnmount() {
        Scheduler.log('Parent componentWillUnmount [!]');
        throw new Error('One does not simply unmount me.');
      }
      /** Parent.render：输出可观察测试树，并把本例状态映射为确定的 reconciliation 输入。 */
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

    // React 将两个错误合并为单个 AggregateError。
    const errors = aggregateError.errors;
    expect(errors.length).toBe(3);
    expect(errors[0].message).toBe('Hello.');
    expect(errors[1].message).toBe('One does not simply unmount me.');
    expect(errors[2].message).toBe('One does not simply unmount me.');
  });

  /** Given 已挂载含可观察生命周期/ref 的树；When 执行“does not interrupt unmounting if detaching a ref throws”规定的提交失败或删除；Then 其余 commit 工作、清理顺序与错误路由保持正确。验证机制：Scheduler/console/树断言；对应 ReactFiberCommitEffects、ReactFiberWorkLoop 与 ReactFiberErrorLogger。 */
  it('does not interrupt unmounting if detaching a ref throws', async () => {
    /** “does not interrupt unmounting if detaching a ref throws”中的类夹具 Bar：用可观察生命周期限定当前错误恢复边界。 */
    class Bar extends React.Component {
      /** Bar.componentWillUnmount：记录父子删除顺序，并确认错误 unwind 不重复或遗漏清理。 */
      componentWillUnmount() {
        Scheduler.log('Bar unmount');
      }
      /** Bar.render：输出可观察测试树，并把本例状态映射为确定的 reconciliation 输入。 */
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

    /** Foo 组合夹具：为“does not interrupt unmounting if detaching a ref throws”装配边界、失败节点与 siblings，控制更新拓扑。 */
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

  /** Given 已挂载错误边界、失败节点与正常 sibling；When 执行“handles error thrown by host config while working on failed root”定义的抛错、重试或恢复；Then 边界状态、fallback 和错误身份符合预期。验证机制：渲染树、日志及 console；对应 ReactFiberThrow、ReactFiberUnwindWork、ReactFiberWorkLoop。 */
  it('handles error thrown by host config while working on failed root', async () => {
    ReactNoop.render(<errorInBeginPhase />);
    await waitForThrow('Error in host config.');
  });

  /** Given 已挂载错误边界、失败节点与正常 sibling；When 执行“handles error thrown by top-level callback”定义的抛错、重试或恢复；Then 边界状态、fallback 和错误身份符合预期。验证机制：渲染树、日志及 console；对应 ReactFiberThrow、ReactFiberUnwindWork、ReactFiberWorkLoop。 */
  it('handles error thrown by top-level callback', async () => {
    ReactNoop.render(<div />, () => {
      throw new Error('Error!');
    });
    await waitForThrow('Error!');
  });

  /** Given 已挂载错误边界、失败节点与正常 sibling；When 执行“error boundaries capture non-errors”定义的抛错、重试或恢复；Then 边界状态、fallback 和错误身份符合预期。验证机制：渲染树、日志及 console；对应 ReactFiberThrow、ReactFiberUnwindWork、ReactFiberWorkLoop。 */
  it('error boundaries capture non-errors', async () => {
    spyOnProd(console, 'error').mockImplementation(() => {});
    spyOnDev(console, 'error').mockImplementation(() => {});

    /** “error boundaries capture non-errors”中的错误边界：保存捕获状态并在 children 与 fallback 间切换，隔离本例失败范围。 */
    class ErrorBoundary extends React.Component {
      /** ErrorBoundary.state：保存本例已捕获错误或更新阶段；初始值代表正常渲染，变化后驱动恢复分支。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch：记录捕获信息并安排恢复，验证边界 commit 阶段错误处理。 */
      componentDidCatch(error) {
        // 不应调用。
        Scheduler.log('componentDidCatch');
        this.setState({error});
      }
      /** ErrorBoundary.render：依据错误 state 选择原 children 或 fallback，形成“error boundaries capture non-errors”的恢复输出。 */
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

    /** Indirection 中间层：增加一层 Fiber/Context 转发，验证错误栈与 unwind 不跳过祖先。 */
    function Indirection({children}) {
      Scheduler.log('Indirection');
      return children;
    }

    const notAnError = {nonStandardMessage: 'oops'};
    /** “error boundaries capture non-errors”中的失败函数夹具 BadRender：在 render 时抛出固定错误，触发目标恢复分支。 */
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

  /** Given 已初始化本组错误处理夹具；When 执行“continues working on siblings of a component that throws”的 render/update 序列；Then 成功与失败子树按预期提交或回滚。验证机制：Noop 输出、Scheduler 与错误断言；对应 ReactFiberThrow 和 ReactFiberWorkLoop。 */
  it('continues working on siblings of a component that throws', async () => {
    /** “continues working on siblings of a component that throws”中的错误边界：保存捕获状态并在 children 与 fallback 间切换，隔离本例失败范围。 */
    class ErrorBoundary extends React.Component {
      /** ErrorBoundary.state：保存本例已捕获错误或更新阶段；初始值代表正常渲染，变化后驱动恢复分支。 */
      state = {error: null};
      /** ErrorBoundary.componentDidCatch：记录捕获信息并安排恢复，验证边界 commit 阶段错误处理。 */
      componentDidCatch(error) {
        Scheduler.log('componentDidCatch');
        this.setState({error});
      }
      /** ErrorBoundary.render：依据错误 state 选择原 children 或 fallback，形成“continues working on siblings of a component that throws”的恢复输出。 */
      render() {
        if (this.state.error) {
          Scheduler.log('ErrorBoundary (catch)');
          return <ErrorMessage error={this.state.error} />;
        }
        Scheduler.log('ErrorBoundary (try)');
        return this.props.children;
      }
    }

    /** 把捕获错误渲染为可断言文本，并记录恢复提交发生的时点。 */
    function ErrorMessage({error}) {
      Scheduler.log('ErrorMessage');
      return <span prop={`Caught an error: ${error.message}`} />;
    }

    /** “continues working on siblings of a component that throws”中的失败函数夹具 BadRenderSibling：在 render 时抛出固定错误，触发目标恢复分支。 */
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
      // BadRender 抛错后继续 render siblings。

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

  /** Given 已挂载含可观察生命周期/ref 的树；When 执行“calls the correct lifecycles on the error boundary after catching an error (mixed)”规定的提交失败或删除；Then 其余 commit 工作、清理顺序与错误路由保持正确。验证机制：Scheduler/console/树断言；对应 ReactFiberCommitEffects、ReactFiberWorkLoop 与 ReactFiberErrorLogger。 */
  it('calls the correct lifecycles on the error boundary after catching an error (mixed)', async () => {
    // 此例看似刻意，但来自真实回归：
    // 实现错误检查 didUpdate 是否存在，而非 didMount；
    // 同时 didMount 未定义。
    /** “calls the correct lifecycles on the error boundary after catching an error (mixed)”中的失败函数夹具 BadRender：在 render 时抛出固定错误，触发目标恢复分支。 */
    function BadRender({unused}) {
      Scheduler.log('throw');
      throw new Error('oops!');
    }

    /** “calls the correct lifecycles on the error boundary after catching an error (mixed)”中的父级类夹具：承载失败子树并暴露父生命周期或状态恢复顺序。 */
    class Parent extends React.Component {
      /** Parent.state：保存本例已捕获错误或更新阶段；初始值代表正常渲染，变化后驱动恢复分支。 */
      state = {error: null, other: false};
      /** Parent.componentDidCatch：记录捕获信息并安排恢复，验证边界 commit 阶段错误处理。 */
      componentDidCatch(error) {
        Scheduler.log('did catch');
        this.setState({error});
      }
      /** Parent.componentDidUpdate：观察恢复更新后的实例状态与 callback 顺序。 */
      componentDidUpdate() {
        Scheduler.log('did update');
      }
      /** Parent.render：输出可观察测试树，并把本例状态映射为确定的 reconciliation 输入。 */
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

  /** Given 已挂载错误边界、失败节点与正常 sibling；When 执行“provides component stack to the error boundary with componentDidCatch”定义的抛错、重试或恢复；Then 边界状态、fallback 和错误身份符合预期。验证机制：渲染树、日志及 console；对应 ReactFiberThrow、ReactFiberUnwindWork、ReactFiberWorkLoop。 */
  it('provides component stack to the error boundary with componentDidCatch', async () => {
    /** “provides component stack to the error boundary with componentDidCatch”中的错误边界：保存捕获状态并在 children 与 fallback 间切换，隔离本例失败范围。 */
    class ErrorBoundary extends React.Component {
      /** ErrorBoundary.state：保存本例已捕获错误或更新阶段；初始值代表正常渲染，变化后驱动恢复分支。 */
      state = {error: null, errorInfo: null};
      /** ErrorBoundary.componentDidCatch：记录捕获信息并安排恢复，验证边界 commit 阶段错误处理。 */
      componentDidCatch(error, errorInfo) {
        this.setState({error, errorInfo});
      }
      /** ErrorBoundary.render：依据错误 state 选择原 children 或 fallback，形成“provides component stack to the error boundary with componentDidCatch”的恢复输出。 */
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

  /** Given 已挂载错误边界、失败节点与正常 sibling；When 执行“does not provide component stack to the error boundary with getDerivedStateFromError”定义的抛错、重试或恢复；Then 边界状态、fallback 和错误身份符合预期。验证机制：渲染树、日志及 console；对应 ReactFiberThrow、ReactFiberUnwindWork、ReactFiberWorkLoop。 */
  it('does not provide component stack to the error boundary with getDerivedStateFromError', async () => {
    /** “does not provide component stack to the error boundary with getDerivedStateFromError”中的错误边界：保存捕获状态并在 children 与 fallback 间切换，隔离本例失败范围。 */
    class ErrorBoundary extends React.Component {
      /** ErrorBoundary.state：保存本例已捕获错误或更新阶段；初始值代表正常渲染，变化后驱动恢复分支。 */
      state = {error: null};
      /** ErrorBoundary.getDerivedStateFromError：把 render 错误折叠为恢复 state，使下一分支渲染 fallback。 */
      static getDerivedStateFromError(error, errorInfo) {
        expect(errorInfo).toBeUndefined();
        return {error};
      }
      /** ErrorBoundary.render：依据错误 state 选择原 children 或 fallback，形成“does not provide component stack to the error boundary with getDerivedStateFromError”的恢复输出。 */
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

  /** Given 已初始化本组错误处理夹具；When 执行“provides component stack even if overriding prepareStackTrace”的 render/update 序列；Then 成功与失败子树按预期提交或回滚。验证机制：Noop 输出、Scheduler 与错误断言；对应 ReactFiberThrow 和 ReactFiberWorkLoop。 */
  it('provides component stack even if overriding prepareStackTrace', async () => {
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

    /** “provides component stack even if overriding prepareStackTrace”中的错误边界：保存捕获状态并在 children 与 fallback 间切换，隔离本例失败范围。 */
    class ErrorBoundary extends React.Component {
      /** ErrorBoundary.state：保存本例已捕获错误或更新阶段；初始值代表正常渲染，变化后驱动恢复分支。 */
      state = {error: null, errorInfo: null};
      /** ErrorBoundary.componentDidCatch：记录捕获信息并安排恢复，验证边界 commit 阶段错误处理。 */
      componentDidCatch(error, errorInfo) {
        this.setState({error, errorInfo});
      }
      /** ErrorBoundary.render：依据错误 state 选择原 children 或 fallback，形成“provides component stack even if overriding prepareStackTrace”的恢复输出。 */
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

  /** Given 已挂载错误边界、失败节点与正常 sibling；When 执行“uncaught errors should be discarded if the render is aborted”定义的抛错、重试或恢复；Then 边界状态、fallback 和错误身份符合预期。验证机制：渲染树、日志及 console；对应 ReactFiberThrow、ReactFiberUnwindWork、ReactFiberWorkLoop。 */
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

  /** Given 已挂载错误边界、失败节点与正常 sibling；When 执行“uncaught errors are discarded if the render is aborted, case 2”定义的抛错、重试或恢复；Then 边界状态、fallback 和错误身份符合预期。验证机制：渲染树、日志及 console；对应 ReactFiberThrow、ReactFiberUnwindWork、ReactFiberWorkLoop。 */
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

    /** 始终成功的对照组件：证明错误恢复后正常 sibling 仍可完成提交。 */
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

      // 只完成 default priority 更新；low priority 更新仍留在
      // 队列中。
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

  /** Given 已挂载错误边界、失败节点与正常 sibling；When 执行“does not infinite loop if there's a render phase update in the same render as an error”定义的抛错、重试或恢复；Then 边界状态、fallback 和错误身份符合预期。验证机制：渲染树、日志及 console；对应 ReactFiberThrow、ReactFiberUnwindWork、ReactFiberWorkLoop。 */
  it("does not infinite loop if there's a render phase update in the same render as an error", async () => {
    // 某些 React 能力会把 render phase 更新作为
    // 实现细节。错误若伴随 render phase
    // 更新，React 会假定其来自内部；因为用户态触发
    // render phase 更新不被允许，并会记录
    // 警告。因此 React 会持续恢复，直到 opaque
    // identifier 全部升级；但必须在若干次后
    // 放弃，以防意外存在用户态 render phase
    // 更新时形成无限循环。

    spyOnDev(console, 'error').mockImplementation(() => {});
    spyOnDev(console, 'warn').mockImplementation(() => {});

    let numberOfThrows = 0;

    let setStateInRenderPhase;
    /** “does not infinite loop if there's a render phase update in the same render as an error”中的 Child 夹具：暴露局部更新或生命周期，验证错误恢复对后代的影响。 */
    function Child() {
      const [, setState] = React.useState(0);
      setStateInRenderPhase = setState;
      return 'All good';
    }

    /** App 组合夹具：为“does not infinite loop if there's a render phase update in the same render as an error”装配边界、失败节点与 siblings，控制更新拓扑。 */
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
    /** Given 已挂载错误边界、失败节点与正常 sibling；When 执行“regression test: should fatal if error is thrown at the root”定义的抛错、重试或恢复；Then 边界状态、fallback 和错误身份符合预期。验证机制：渲染树、日志及 console；对应 ReactFiberThrow、ReactFiberUnwindWork、ReactFiberWorkLoop。 */
    it('regression test: should fatal if error is thrown at the root', async () => {
      const root = ReactNoop.createRoot();
      root.render('Error when completing root');
      await waitForThrow('Error when completing root');
    });
  }
});
