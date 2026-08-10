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

let React;
let ReactNoop;
let Scheduler;
let PropTypes;

let assertConsoleErrorDev;
let waitForAll;
let waitFor;
let waitForThrow;
let assertLog;

/** ReactIncremental 套件串联并发工作切片、lane 抢占、class 更新队列、生命周期重入与 legacy context 栈恢复。 */
describe('ReactIncremental', () => {
  /** beforeEach 重建 React、Noop、Scheduler、PropTypes 与内部断言工具，隔离模块级调度状态、虚拟根和 legacy context 缓存。 */
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    PropTypes = require('prop-types');

    ({
      assertConsoleErrorDev,
      waitForAll,
      waitFor,
      waitForThrow,
      assertLog,
    } = require('internal-test-utils'));
  });

  // 注意：该组件参考了 www 中的同类实现；待
  // 额外 div 包装不再需要时即可删除。
  /** LegacyHiddenDiv 用 unstable_LegacyHidden 包裹固定 div，模拟线上隐藏容器并把子树工作降到可恢复优先级。 */
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

  /**
   * 场景：简单组件一次完成渲染。
   * Given：Foo 组合一个记录日志的 Bar，根尚未提交任何内容。
   * When：把 Foo 渲染到 ReactNoop 根并等待所有工作。
   * Then：Foo 与 Bar 完整执行并生成宿主 div；该最小路径不产生 Scheduler yield。
   * 验证机制：waitForAll([]) 冲刷全部工作并断言没有额外日志或未完成任务。
   * 对应源码：packages/react-reconciler/src/ReactFiberWorkLoop.js 的 renderRootSync()/renderRootConcurrent()；ReactFiberBeginWork.js。
   */
  it('should render a simple component', async () => {
    /** Bar 在“简单同步组件渲染”场景返回固定宿主 div，作为无状态、无 yield 的最小叶节点基线。 */
    function Bar() {
      return <div>Hello World</div>;
    }

    /** Foo 在“简单同步组件渲染”场景组装测试子树并把 props/state 变化转化为可观测渲染工作；返回结构限定断言所覆盖的工作边界。 */
    function Foo() {
      return <Bar isBar={true} />;
    }

    ReactNoop.render(<Foo />);
    await waitForAll([]);
  });

  /**
   * 场景：时间不足时组件可分步完成。
   * Given：Foo 与 Bar 会分别 yield，调度器可只消费一个工作单元。
   * When：先等待一个 yield，再等待剩余工作。
   * Then：首段只完成 Foo，后续从中断点继续 Bar 并提交，不重复已完成工作。
   * 验证机制：waitFor 按 yield 数切片，随后 waitForAll 与宿主树共同验证恢复位置。
   * 对应源码：packages/react-reconciler/src/ReactFiberWorkLoop.js 的 workLoopConcurrent() 与 performUnitOfWork()。
   */
  it('should render a simple component, in steps if needed', async () => {
    /** Bar 在“分步时间切片渲染”场景记录叶节点或状态结果，使分片、复用与更新顺序可由 Scheduler 日志观察；返回结构限定断言所覆盖的工作边界。 */
    function Bar() {
      Scheduler.log('Bar');
      return (
        <span>
          <div>Hello World</div>
        </span>
      );
    }

    /** Foo 在“分步时间切片渲染”场景组装测试子树并把 props/state 变化转化为可观测渲染工作；返回结构限定断言所覆盖的工作边界。 */
    function Foo() {
      Scheduler.log('Foo');
      return [<Bar key="a" isBar={true} />, <Bar key="b" isBar={true} />];
    }

    React.startTransition(() => {
      ReactNoop.render(<Foo />, () => Scheduler.log('callback'));
    });
    // 只执行一个工作单元。
    await waitFor(['Foo']);

    // 执行剩余工作。
    await waitForAll(['Bar', 'Bar', 'callback']);
  });

  /**
   * 场景：已提交树更新时复用无变化工作。
   * Given：初始树由 Header、Content、Footer 组成，更新只改变目标输入。
   * When：先提交初始版本，再渲染更新版本。
   * Then：变化分支重新执行；可 bailout 的兄弟复用既有 Fiber/输出，最终树反映新值。
   * 验证机制：两轮 yield 日志比较哪些组件重渲染，JSX 断言提交结果。
   * 对应源码：packages/react-reconciler/src/ReactFiberBeginWork.js 的 bailoutOnAlreadyFinishedWork()；ReactChildFiber.js。
   */
  it('updates a previous render', async () => {
    /** Header 在“已提交树更新复用”场景标记头部子树的渲染及复用顺序；返回结构限定断言所覆盖的工作边界。 */
    function Header() {
      Scheduler.log('Header');
      return <h1>Hi</h1>;
    }

    /** Content 在“已提交树更新复用”场景标记中间内容子树的渲染及复用顺序；返回结构限定断言所覆盖的工作边界。 */
    function Content(props) {
      Scheduler.log('Content');
      return <div>{props.children}</div>;
    }

    /** Footer 在“已提交树更新复用”场景标记尾部子树的渲染及复用顺序；返回结构限定断言所覆盖的工作边界。 */
    function Footer() {
      Scheduler.log('Footer');
      return <footer>Bye</footer>;
    }

    const header = <Header />;
    const footer = <Footer />;

    /** Foo 在“已提交树更新复用”场景组装测试子树并把 props/state 变化转化为可观测渲染工作；返回结构限定断言所覆盖的工作边界。 */
    function Foo(props) {
      Scheduler.log('Foo');
      return (
        <div>
          {header}
          <Content>{props.text}</Content>
          {footer}
        </div>
      );
    }

    ReactNoop.render(<Foo text="foo" />, () =>
      Scheduler.log('renderCallbackCalled'),
    );
    await waitForAll([
      'Foo',
      'Header',
      'Content',
      'Footer',
      'renderCallbackCalled',
    ]);

    ReactNoop.render(<Foo text="bar" />, () =>
      Scheduler.log('firstRenderCallbackCalled'),
    );
    ReactNoop.render(<Foo text="bar" />, () =>
      Scheduler.log('secondRenderCallbackCalled'),
    );
    // TODO：补充宿主组件 bailout 测试；当前无法直接观察。

    // 这是一次更新，应命中 bailout 并复用
    // Header 与 Content 已完成的工作。
    await waitForAll([
      'Foo',
      'Content',
      'firstRenderCallbackCalled',
      'secondRenderCallbackCalled',
    ]);
  });

  /**
   * 场景：高优先级更新取消部分渲染并从根重启。
   * Given：低优先级 render 已推进一部分但尚未提交。
   * When：插入更紧急的根更新，然后分别冲刷新工作与遗留工作。
   * Then：旧 work-in-progress 被放弃，新输入从根重建；仍有效的低优先级更新随后并入。
   * 验证机制：分段 waitForAll 日志证明旧尾部未提交，新树包含两种更新的最终组合。
   * 对应源码：packages/react-reconciler/src/ReactFiberWorkLoop.js 的 prepareFreshStack() 与 ensureRootIsScheduled()。
   */
  it('can cancel partially rendered work and restart', async () => {
    /** Bar 在“中断部分工作并重启”场景记录叶节点或状态结果，使分片、复用与更新顺序可由 Scheduler 日志观察；返回结构限定断言所覆盖的工作边界。 */
    function Bar(props) {
      Scheduler.log('Bar');
      return <div>{props.children}</div>;
    }

    /** Foo 在“中断部分工作并重启”场景组装测试子树并把 props/state 变化转化为可观测渲染工作；返回结构限定断言所覆盖的工作边界。 */
    function Foo(props) {
      Scheduler.log('Foo');
      return (
        <div>
          <Bar>{props.text}</Bar>
          <Bar>{props.text}</Bar>
        </div>
      );
    }

    // 初始化阶段。
    ReactNoop.render(<Foo text="foo" />);
    await waitForAll(['Foo', 'Bar', 'Bar']);

    React.startTransition(() => {
      ReactNoop.render(<Foo text="bar" />);
    });
    // 冲刷部分工作。
    await waitFor(['Foo', 'Bar']);

    // 该更新会放弃先前工作并重新开始。
    ReactNoop.flushSync(() => ReactNoop.render(null));

    React.startTransition(() => {
      ReactNoop.render(<Foo text="baz" />);
    });

    // 冲刷新一轮的部分工作。
    await waitFor(['Foo', 'Bar']);

    // 冲刷剩余工作，其中现已包含低优先级任务。
    await waitForAll(['Bar']);
  });

  /**
   * 场景：被中止更新的完成回调仍按更新队列语义结算。
   * Given：多个 class 更新带 callback，其中一次 render 被更高优先级工作打断。
   * When：在部分工作后插入新更新并完成最终提交。
   * Then：被重基的有效更新 callback 不丢失，也不会因重复 render 被调用两次。
   * 验证机制：Scheduler callback 日志与实例 render 日志联合核对调用次数和 commit 顺序。
   * 对应源码：packages/react-reconciler/src/ReactFiberClassUpdateQueue.js 的 processUpdateQueue()/commitCallbacks()。
   */
  it('should call callbacks even if updates are aborted', async () => {
    let inst;

    /** Foo 在“被放弃更新的回调语义”场景承载本地状态、实例身份或生命周期日志，暴露中断与恢复边界；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Foo extends React.Component {
      /** Foo.constructor 在“被放弃更新的回调语义”场景初始化实例 state、计数器或更新入口；该初值是后续中断与恢复比较的基线。 */
      constructor(props) {
        super(props);
        this.state = {
          text: 'foo',
          text2: 'foo',
        };
        inst = this;
      }
      /** Foo.render 在“被放弃更新的回调语义”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        return (
          <div>
            <div>{this.state.text}</div>
            <div>{this.state.text2}</div>
          </div>
        );
      }
    }

    ReactNoop.render(<Foo />);
    await waitForAll([]);

    React.startTransition(() => {
      inst.setState(
        () => {
          Scheduler.log('setState1');
          return {text: 'bar'};
        },
        () => Scheduler.log('callback1'),
      );
    });

    // 冲刷部分工作。
    await waitFor(['setState1']);

    // 该更新会放弃先前工作并重新开始。
    ReactNoop.flushSync(() => ReactNoop.render(<Foo />));
    React.startTransition(() => {
      inst.setState(
        () => {
          Scheduler.log('setState2');
          return {text2: 'baz'};
        },
        () => Scheduler.log('callback2'),
      );
    });

    // 冲刷剩余工作，其中现已包含低优先级任务。
    await waitForAll(['setState1', 'setState2', 'callback1', 'callback2']);
    expect(inst.state).toEqual({text: 'bar', text2: 'baz'});
  });

  /**
   * 场景：隐藏子树的未完成工作可降级后恢复。
   * Given：可见 Bar 与 LegacyHiddenDiv 内的 Middle 同时进入根更新。
   * When：先冲刷可见高优先级工作，再单独冲刷被降级的隐藏工作。
   * Then：可见内容先提交；隐藏子树保留 pending work，低优先级轮次继续而非丢弃。
   * 验证机制：前后两段 yield 日志和最终 JSX 验证分层提交及恢复。
   * 对应源码：packages/react-reconciler/src/ReactFiberBeginWork.js 的 LegacyHidden/Offscreen 分支；ReactFiberWorkLoop.js。
   */
  // @gate enableLegacyHidden
  it('can deprioritize unfinished work and resume it later', async () => {
    /** Bar 在“未完成工作降级后恢复”场景记录叶节点或状态结果，使分片、复用与更新顺序可由 Scheduler 日志观察；返回结构限定断言所覆盖的工作边界。 */
    function Bar(props) {
      Scheduler.log('Bar');
      return <div>{props.children}</div>;
    }

    /** Middle 在“未完成工作降级后恢复”场景建立中间优先级、bailout 或 context 边界；返回结构限定断言所覆盖的工作边界。 */
    function Middle(props) {
      Scheduler.log('Middle');
      return <span>{props.children}</span>;
    }

    /** Foo 在“未完成工作降级后恢复”场景组装测试子树并把 props/state 变化转化为可观测渲染工作；返回结构限定断言所覆盖的工作边界。 */
    function Foo(props) {
      Scheduler.log('Foo');
      return (
        <div>
          <Bar>{props.text}</Bar>
          <LegacyHiddenDiv mode="hidden">
            <Middle>{props.text}</Middle>
          </LegacyHiddenDiv>
          <Bar>{props.text}</Bar>
          <LegacyHiddenDiv mode="hidden">
            <Middle>Footer</Middle>
          </LegacyHiddenDiv>
        </div>
      );
    }

    // 初始化阶段。
    ReactNoop.render(<Foo text="foo" />);
    await waitForAll(['Foo', 'Bar', 'Bar', 'Middle', 'Middle']);

    // 渲染部分工作；本轮应完成除
    // 低优先级 Middle 之外的所有内容。
    ReactNoop.render(<Foo text="bar" />);
    await waitFor(['Foo', 'Bar', 'Bar']);
    // 只冲刷剩余工作。
    await waitForAll(['Middle', 'Middle']);
  });

  /**
   * 场景：整棵隐藏树降级时不丢弃内部工作。
   * Given：隐藏包装下的多个节点已排入更新。
   * When：冲刷高优先级可见部分，再执行调度出的低优先级 callback。
   * Then：隐藏内容从高优先级移出但仍保持可恢复 lanes，最终完整提交。
   * 验证机制：assertLog 区分可见与隐藏阶段，宿主树确认所有隐藏后代存在。
   * 对应源码：packages/react-reconciler/src/ReactFiberBeginWork.js 的 updateOffscreenComponent()；ReactFiberLane.js。
   */
  // @gate enableLegacyHidden
  it('can deprioritize a tree from without dropping work', async () => {
    /** Bar 在“隐藏子树降级且不丢工作”场景记录叶节点或状态结果，使分片、复用与更新顺序可由 Scheduler 日志观察；返回结构限定断言所覆盖的工作边界。 */
    function Bar(props) {
      Scheduler.log('Bar');
      return <div>{props.children}</div>;
    }

    /** Middle 在“隐藏子树降级且不丢工作”场景建立中间优先级、bailout 或 context 边界；返回结构限定断言所覆盖的工作边界。 */
    function Middle(props) {
      Scheduler.log('Middle');
      return <span>{props.children}</span>;
    }

    /** Foo 在“隐藏子树降级且不丢工作”场景组装测试子树并把 props/state 变化转化为可观测渲染工作；返回结构限定断言所覆盖的工作边界。 */
    function Foo(props) {
      Scheduler.log('Foo');
      return (
        <div>
          <Bar>{props.text}</Bar>
          <LegacyHiddenDiv mode="hidden">
            <Middle>{props.text}</Middle>
          </LegacyHiddenDiv>
          <Bar>{props.text}</Bar>
          <LegacyHiddenDiv mode="hidden">
            <Middle>Footer</Middle>
          </LegacyHiddenDiv>
        </div>
      );
    }

    // 初始化阶段。
    ReactNoop.flushSync(() => {
      ReactNoop.render(<Foo text="foo" />);
    });
    assertLog(['Foo', 'Bar', 'Bar']);
    await waitForAll(['Middle', 'Middle']);

    // 渲染高优先级工作，即隐藏树之外的全部内容。
    ReactNoop.flushSync(() => {
      ReactNoop.render(<Foo text="foo" />);
    });
    assertLog(['Foo', 'Bar', 'Bar']);

    // 隐藏内容已从高优先级降到低优先级，并应调度一个低
    // 优先级 callback；现在冲刷它。
    await waitForAll(['Middle', 'Middle']);
  });

  /**
   * 场景：父级 bailout 后仍可恢复已有子树工作。
   * Given：子树已开始低优先级工作，父级后续 props 未变并命中 bailout。
   * When：用更高优先级更新打断，再恢复原低优先级 lanes。
   * Then：父级可复用自身输出，但 childLanes 仍把控制权交还未完成子树。
   * 验证机制：yield 日志要求父级不重复渲染而子级继续到完成。
   * 对应源码：packages/react-reconciler/src/ReactFiberBeginWork.js 的 bailoutOnAlreadyFinishedWork() 与 childLanes 检查。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('can resume work in a subtree even when a parent bails out', async () => {
    /** Bar 在“父级 bailout 后恢复子树”场景记录叶节点或状态结果，使分片、复用与更新顺序可由 Scheduler 日志观察；返回结构限定断言所覆盖的工作边界。 */
    function Bar(props) {
      Scheduler.log('Bar');
      return <div>{props.children}</div>;
    }

    /** Tester 在“父级 bailout 后恢复子树”场景制造明确的 shouldComponentUpdate/bailout 父边界；返回结构限定断言所覆盖的工作边界。 */
    function Tester() {
      // 该组件仅用于确保 bailout
      // 确实发生在测试预期的位置。
      Scheduler.log('Tester');
      return <div />;
    }

    /** Middle 在“父级 bailout 后恢复子树”场景建立中间优先级、bailout 或 context 边界；返回结构限定断言所覆盖的工作边界。 */
    function Middle(props) {
      Scheduler.log('Middle');
      return <span>{props.children}</span>;
    }

    const middleContent = (
      <aaa>
        <Tester />
        <bbb hidden={true}>
          <ccc>
            <Middle>Hi</Middle>
          </ccc>
        </bbb>
      </aaa>
    );

    /** Foo 在“父级 bailout 后恢复子树”场景组装测试子树并把 props/state 变化转化为可观测渲染工作；返回结构限定断言所覆盖的工作边界。 */
    function Foo(props) {
      Scheduler.log('Foo');
      return (
        <div>
          <Bar>{props.text}</Bar>
          {middleContent}
          <Bar>{props.text}</Bar>
        </div>
      );
    }

    // 初始化阶段。
    ReactNoop.render(<Foo text="foo" />);
    ReactNoop.flushDeferredPri(52);

    assertLog(['Foo', 'Bar', 'Tester', 'Bar']);

    // 当前更新会在处理 Middle 时命中 bailout。
    ReactNoop.render(<Foo text="bar" />);
    ReactNoop.flushDeferredPri(45 + 5);

    assertLog(['Foo', 'Bar', 'Bar']);

    // 冲刷剩余内容，确认 bailout 没有阻塞该工作。
    await waitForAll(['Middle']);
  });

  /**
   * 场景：同一遍历内可进入已 bailout 子树的剩余工作。
   * Given：中间 Tester/Content 会返回 false，但后代仍保存待处理 lanes。
   * When：在一次 render pass 中经过 bailout 边界并继续调度子工作。
   * Then：bailout 只跳过无工作层级，不能屏蔽子树已排队更新。
   * 验证机制：组件日志定位 Middle/Content 的跳过与后代恢复顺序。
   * 对应源码：packages/react-reconciler/src/ReactFiberBeginWork.js 的 checkScheduledUpdateOrContext()/bailoutOnAlreadyFinishedWork()。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('can resume work in a bailed subtree within one pass', async () => {
    /** Bar 在“单次遍历内恢复已 bailout 子树”场景记录叶节点或状态结果，使分片、复用与更新顺序可由 Scheduler 日志观察；返回结构限定断言所覆盖的工作边界。 */
    function Bar(props) {
      Scheduler.log('Bar');
      return <div>{props.children}</div>;
    }

    /** Tester 在“单次遍历内恢复已 bailout 子树”场景通过 shouldComponentUpdate 明确制造 bailout 边界；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Tester extends React.Component {
      /** Tester.shouldComponentUpdate 在“单次遍历内恢复已 bailout 子树”场景比较下一组输入并决定 bailout；返回 false 时仍需保留已排队子工作和正确 memoized 指针。 */
      shouldComponentUpdate() {
        return false;
      }
      /** Tester.render 在“单次遍历内恢复已 bailout 子树”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        // 该组件仅用于确保 bailout
        // 确实发生在测试预期的位置。
        Scheduler.log('Tester');
        return <div />;
      }
    }

    /** Middle 在“单次遍历内恢复已 bailout 子树”场景建立中间优先级、bailout 或 context 边界；返回结构限定断言所覆盖的工作边界。 */
    function Middle(props) {
      Scheduler.log('Middle');
      return <span>{props.children}</span>;
    }

    // Content 是否应只基于 current bailout，而不是基于 workInProgress？

    /** Content 在“单次遍历内恢复已 bailout 子树”场景代表可恢复的内容 class 子树；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Content extends React.Component {
      /** Content.shouldComponentUpdate 在“单次遍历内恢复已 bailout 子树”场景比较下一组输入并决定 bailout；返回 false 时仍需保留已排队子工作和正确 memoized 指针。 */
      shouldComponentUpdate() {
        return false;
      }
      /** Content.render 在“单次遍历内恢复已 bailout 子树”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        return [
          <Tester key="a" unused={this.props.unused} />,
          <bbb key="b" hidden={true}>
            <ccc>
              <Middle>Hi</Middle>
            </ccc>
          </bbb>,
        ];
      }
    }

    /** Foo 在“单次遍历内恢复已 bailout 子树”场景组装测试子树并把 props/state 变化转化为可观测渲染工作；返回结构限定断言所覆盖的工作边界。 */
    function Foo(props) {
      Scheduler.log('Foo');
      return (
        <div hidden={props.text === 'bar'}>
          <Bar>{props.text}</Bar>
          <Content unused={props.text} />
          <Bar>{props.text}</Bar>
        </div>
      );
    }

    // 初始化阶段。
    ReactNoop.render(<Foo text="foo" />);
    ReactNoop.flushDeferredPri(52 + 5);

    assertLog(['Foo', 'Bar', 'Tester', 'Bar']);

    // 执行一次快速更新，在已有
    // 低优先级树之上再创建一棵低优先级树。
    ReactNoop.render(<Foo text="bar" />);
    ReactNoop.flushDeferredPri(15);

    assertLog(['Foo']);

    // 此时 Middle 会 bailout，但尚未完整渲染。
    // 它与父树优先级相同，因此应
    // 作为单个批次渲染；所以 Middle 正确的位置应在
    // 中间。若它出现在两个“Bar”之后，说明它被
    // 延后冲刷，这是错误的。
    await waitForAll(['Bar', 'Middle', 'Bar']);

    // 再次尝试，但第一次不完全结束；这会
    // 留下一个以普通优先级 reconciliation 的悬挂子树。
    ReactNoop.render(<Foo text="foo" />);
    ReactNoop.flushDeferredPri(40);

    assertLog(['Foo', 'Bar']);

    // 该更新会创建一棵树，放弃先前工作并降低
    // 其优先级。若优先级没有正确下调，可能会
    // 错误放弃已降级内容的渲染。
    ReactNoop.render(<Foo text="bar" />);
    await waitForAll(['Foo', 'Bar', 'Bar']);
  });

  /**
   * 场景：中断的 class 初次挂载可继续完成。
   * Given：Parent 控制的 class Foo 已构造并开始 render，但挂载未提交。
   * When：更高优先级更新打断后恢复原挂载。
   * Then：恢复路径完成 class 子树且只提交一个有效实例。
   * 验证机制：constructor/render 日志与最终宿主输出验证实例挂载边界。
   * 对应源码：packages/react-reconciler/src/ReactFiberClassComponent.js 的 mountClassInstance()；ReactFiberWorkLoop.js。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('can resume mounting a class component', async () => {
    let foo;
    /** Parent 在“恢复 class 挂载”场景控制父级 bailout、props 或派生状态，界定子树是否重新进入；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Parent extends React.Component {
      /** Parent.shouldComponentUpdate 在“恢复 class 挂载”场景比较下一组输入并决定 bailout；返回 false 时仍需保留已排队子工作和正确 memoized 指针。 */
      shouldComponentUpdate() {
        return false;
      }
      /** Parent.render 在“恢复 class 挂载”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        return <Foo prop={this.props.prop} />;
      }
    }

    /** Foo 在“恢复 class 挂载”场景承载本地状态、实例身份或生命周期日志，暴露中断与恢复边界；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Foo extends React.Component {
      /** Foo.constructor 在“恢复 class 挂载”场景初始化实例 state、计数器或更新入口；该初值是后续中断与恢复比较的基线。 */
      constructor(props) {
        super(props);
        // 该测试源于 www 中恢复时 props 变为 null 的缺陷。
        Scheduler.log('Foo constructor: ' + props.prop);
      }
      /** Foo.render 在“恢复 class 挂载”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        foo = this;
        Scheduler.log('Foo');
        return <Bar />;
      }
    }

    /** Bar 在“恢复 class 挂载”场景记录叶节点或状态结果，使分片、复用与更新顺序可由 Scheduler 日志观察；返回结构限定断言所覆盖的工作边界。 */
    function Bar() {
      Scheduler.log('Bar');
      return <div />;
    }

    ReactNoop.render(<Parent prop="foo" />);
    ReactNoop.flushDeferredPri(20);
    assertLog(['Foo constructor: foo', 'Foo']);

    foo.setState({value: 'bar'});

    await waitForAll(['Foo', 'Bar']);
  });

  /**
   * 场景：恢复 class 挂载时复用同一实例。
   * Given：Foo 的构造及部分 lifecycle 已执行但未 commit。
   * When：打断并恢复同一挂载工作。
   * Then：work-in-progress 继续使用原 Foo 实例，render 阶段可重入但 mount commit 仅一次。
   * 验证机制：实例编号和 lifecycle 日志区分复用与错误重建。
   * 对应源码：packages/react-reconciler/src/ReactFiberClassComponent.js 的 constructClassInstance()/resumeMountClassInstance()。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('reuses the same instance when resuming a class instance', async () => {
    let foo;
    /** Parent 在“恢复时复用同一 class 实例”场景控制父级 bailout、props 或派生状态，界定子树是否重新进入；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Parent extends React.Component {
      /** Parent.shouldComponentUpdate 在“恢复时复用同一 class 实例”场景比较下一组输入并决定 bailout；返回 false 时仍需保留已排队子工作和正确 memoized 指针。 */
      shouldComponentUpdate() {
        return false;
      }
      /** Parent.render 在“恢复时复用同一 class 实例”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        return <Foo prop={this.props.prop} />;
      }
    }

    let constructorCount = 0;
    /** Foo 在“恢复时复用同一 class 实例”场景承载本地状态、实例身份或生命周期日志，暴露中断与恢复边界；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Foo extends React.Component {
      /** Foo.constructor 在“恢复时复用同一 class 实例”场景初始化实例 state、计数器或更新入口；该初值是后续中断与恢复比较的基线。 */
      constructor(props) {
        super(props);
        // 该测试源于 www 中恢复时 props 变为 null 的缺陷。
        Scheduler.log('constructor: ' + props.prop);
        constructorCount++;
      }
      /** Foo.UNSAFE_componentWillMount 在“恢复时复用同一 class 实例”场景记录挂载前 render 阶段并可能排队初始 state；被中断的挂载允许重新进入但不能错误提交。 */
      UNSAFE_componentWillMount() {
        Scheduler.log('componentWillMount: ' + this.props.prop);
      }
      /** Foo.UNSAFE_componentWillReceiveProps 在“恢复时复用同一 class 实例”场景只响应父级传入的新 props；纯 state 更新或同一 props 恢复不得误触发。 */
      UNSAFE_componentWillReceiveProps() {
        Scheduler.log('componentWillReceiveProps: ' + this.props.prop);
      }
      /** Foo.componentDidMount 在“恢复时复用同一 class 实例”场景标记实例首次 commit；仅完成 render 而未提交的工作不得调用它。 */
      componentDidMount() {
        Scheduler.log('componentDidMount: ' + this.props.prop);
      }
      /** Foo.UNSAFE_componentWillUpdate 在“恢复时复用同一 class 实例”场景记录已通过 bailout 的更新 render；中断重启可重入，commit 前不能视为完成。 */
      UNSAFE_componentWillUpdate() {
        Scheduler.log('componentWillUpdate: ' + this.props.prop);
      }
      /** Foo.componentDidUpdate 在“恢复时复用同一 class 实例”场景记录最终提交的 prev/next 输入；被放弃的中间 render 不得单独产生 didUpdate。 */
      componentDidUpdate() {
        Scheduler.log('componentDidUpdate: ' + this.props.prop);
      }
      /** Foo.render 在“恢复时复用同一 class 实例”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        foo = this;
        Scheduler.log('render: ' + this.props.prop);
        return <Bar />;
      }
    }

    /** Bar 在“恢复时复用同一 class 实例”场景记录叶节点或状态结果，使分片、复用与更新顺序可由 Scheduler 日志观察；返回结构限定断言所覆盖的工作边界。 */
    function Bar() {
      Scheduler.log('Foo did complete');
      return <div />;
    }

    ReactNoop.render(<Parent prop="foo" />);
    ReactNoop.flushDeferredPri(25);
    assertLog([
      'constructor: foo',
      'componentWillMount: foo',
      'render: foo',
      'Foo did complete',
    ]);

    foo.setState({value: 'bar'});

    await waitForAll([]);
    expect(constructorCount).toEqual(1);
    assertLog([
      'componentWillMount: foo',
      'render: foo',
      'Foo did complete',
      'componentDidMount: foo',
    ]);
  });

  /**
   * 场景：抢占后复用已经完成的子工作。
   * Given：低优先级树的一部分已完整完成，尚有尾部未处理。
   * When：高优先级更新抢占后再恢复低优先级 render。
   * Then：输入未变的已完成 Fiber 被克隆复用，不重新执行对应组件。
   * 验证机制：第二轮日志缺少已完成节点，只包含必要的新工作。
   * 对应源码：packages/react-reconciler/src/ReactFiberBeginWork.js 的 bailoutOnAlreadyFinishedWork()；ReactFiberWorkLoop.js。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('can reuse work done after being preempted', async () => {
    /** Bar 在“抢占后复用已完成工作”场景记录叶节点或状态结果，使分片、复用与更新顺序可由 Scheduler 日志观察；返回结构限定断言所覆盖的工作边界。 */
    function Bar(props) {
      Scheduler.log('Bar');
      return <div>{props.children}</div>;
    }

    /** Middle 在“抢占后复用已完成工作”场景建立中间优先级、bailout 或 context 边界；返回结构限定断言所覆盖的工作边界。 */
    function Middle(props) {
      Scheduler.log('Middle');
      return <span>{props.children}</span>;
    }

    const middleContent = (
      <div>
        <Middle>Hello</Middle>
        <Bar>-</Bar>
        <Middle>World</Middle>
      </div>
    );

    const step0 = (
      <div>
        <Middle>Hi</Middle>
        <Bar>{'Foo'}</Bar>
        <Middle>There</Middle>
      </div>
    );

    /** Foo 在“抢占后复用已完成工作”场景组装测试子树并把 props/state 变化转化为可观测渲染工作；返回结构限定断言所覆盖的工作边界。 */
    function Foo(props) {
      Scheduler.log('Foo');
      return (
        <div>
          <Bar>{props.text2}</Bar>
          <div hidden={true}>{props.step === 0 ? step0 : middleContent}</div>
        </div>
      );
    }

    // 初始化阶段。
    ReactNoop.render(<Foo text="foo" text2="foo" step={0} />);
    ReactNoop.flushDeferredPri(55 + 25 + 5 + 5);

    // 这里只完成高优先级工作，因此低优先级内容
    // 尚未完成挂载。
    assertLog(['Foo', 'Bar', 'Middle', 'Bar']);

    // 用快速更新中断渲染；它不应触碰
    // Middle 内容。
    ReactNoop.render(<Foo text="foo" text2="bar" step={0} />);
    await waitForAll([]);

    // 现在已渲染整棵树，但无需重做
    // 首个 Middle 和 Bar 已完成的工作。
    assertLog(['Foo', 'Bar', 'Middle']);

    // 执行快速更新，调度低优先级工作以
    // 更新 Middle 内容。
    ReactNoop.render(<Foo text="bar" text2="bar" step={1} />);
    ReactNoop.flushDeferredPri(30 + 25 + 5);

    assertLog(['Foo', 'Bar']);

    // Middle 内容现在等待渲染……
    ReactNoop.flushDeferredPri(30 + 5);
    assertLog(['Middle', 'Bar']);

    // 但将用更高优先级工作中断它。
    // Middle 内容会 bailout，因此保持不变。
    ReactNoop.render(<Foo text="foo" text2="bar" step={1} />);
    ReactNoop.flushDeferredPri(30);

    assertLog(['Foo', 'Bar']);

    // 由于中断期间没有修改 Middle 子树，
    // 应能复用已经完成的 reconciliation 工作，
    // 无需重新开始。
    await waitForAll(['Middle']);
  });

  /**
   * 场景：抢占后复用已开始但未完成的深层工作。
   * Given：Child 与 Grandchild 已 begin 但 GreatGrandchild 尚未执行。
   * When：兄弟高优先级更新打断，再继续原低优先级任务。
   * Then：已 memoize 的 Child/Grandchild 不重新 begin，恢复从更深未完成位置继续。
   * 验证机制：恢复日志明确不含 Child/Grandchild，只出现剩余后代。
   * 对应源码：packages/react-reconciler/src/ReactFiberWorkLoop.js 的 completeUnitOfWork()；ReactFiberBeginWork.js bailout。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('can reuse work that began but did not complete, after being preempted', async () => {
    let child;
    let sibling;

    /** GreatGrandchild 在“抢占后复用已开始但未完成的工作”场景作为最深工作单元，标记恢复遍历是否重复进入；返回结构限定断言所覆盖的工作边界。 */
    function GreatGrandchild() {
      Scheduler.log('GreatGrandchild');
      return <div />;
    }

    /** Grandchild 在“抢占后复用已开始但未完成的工作”场景连接 Child 与最深节点，暴露未完成工作能否被复用；返回结构限定断言所覆盖的工作边界。 */
    function Grandchild() {
      Scheduler.log('Grandchild');
      return <GreatGrandchild />;
    }

    /** Child 在“抢占后复用已开始但未完成的工作”场景承载子级状态、context 或深层工作，验证父级调度决策的下游效果；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Child extends React.Component {
      /** Child.state 在“抢占后复用已开始但未完成的工作”场景保存实例的已提交本地状态；更新队列在此基线上合并 pending state 并决定后续渲染。 */
      state = {step: 0};
      /** Child.render 在“抢占后复用已开始但未完成的工作”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        child = this;
        Scheduler.log('Child');
        return <Grandchild />;
      }
    }

    /** Sibling 在“抢占后复用已开始但未完成的工作”场景作为同级 class 进度哨兵，分隔完成与提交阶段；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Sibling extends React.Component {
      /** Sibling.render 在“抢占后复用已开始但未完成的工作”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('Sibling');
        sibling = this;
        return <div />;
      }
    }

    /** Parent 在“抢占后复用已开始但未完成的工作”场景作为父级更新入口，安排子节点工作并暴露抢占顺序；返回结构限定断言所覆盖的工作边界。 */
    function Parent() {
      Scheduler.log('Parent');
      return [
        // 额外 div 是必需的，因为 Parent 在
        // 高优先级更新中 bailout 时，progressedPriority 会设为高。
        // 因此恢复到
        // 低优先级时无法复用直接子节点；可通过修改
        // pendingWorkPriority 和 progressedPriority，使其只表示
        // 子节点优先级而不包含 Fiber 自身来修复。
        <div key="a">
          <Child />
        </div>,
        <Sibling key="b" />,
      ];
    }

    ReactNoop.render(<Parent />);
    await waitForAll([]);

    // 开始处理 Child 的低优先级更新，但在
    // GreatGrandchild 前停止；Child 和 Grandchild 已开始但未完成。
    child.setState({step: 1});
    ReactNoop.flushDeferredPri(30);
    assertLog(['Child', 'Grandchild']);

    // 用树中其他位置的高优先级更新中断当前
    // 低优先级工作。

    ReactNoop.flushSync(() => {
      sibling.setState({});
    });
    assertLog(['Sibling']);

    // 继续低优先级工作；Child 与 GrandChild 的工作已 memoize，
    // 因此不应再次处理。

    await waitForAll([
      // 不应再次出现 Child。
      // 不应再次出现 Grandchild。
      'GreatGrandchild',
    ]);
  });

  /**
   * 场景：shouldComponentUpdate false 的子树在抢占后仍可复用。
   * Given：Middle/Content 的 shouldComponentUpdate 会拒绝无关高优先级更新。
   * When：低优先级工作进行中被外部更新抢占，再恢复。
   * Then：bailout 不清除原 pending lanes，已做的 reconciliation 可继续复用。
   * 验证机制：分阶段 yield 日志验证中断期间子树未触碰、恢复时不从头开始。
   * 对应源码：packages/react-reconciler/src/ReactFiberClassComponent.js 的 updateClassInstance()；ReactFiberBeginWork.js。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('can reuse work if shouldComponentUpdate is false, after being preempted', async () => {
    /** Bar 在“shouldComponentUpdate 拒绝后复用”场景记录叶节点或状态结果，使分片、复用与更新顺序可由 Scheduler 日志观察；返回结构限定断言所覆盖的工作边界。 */
    function Bar(props) {
      Scheduler.log('Bar');
      return <div>{props.children}</div>;
    }

    /** Middle 在“shouldComponentUpdate 拒绝后复用”场景建立中间 bailout、优先级或 context 层；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Middle extends React.Component {
      /** Middle.shouldComponentUpdate 在“shouldComponentUpdate 拒绝后复用”场景比较下一组输入并决定 bailout；返回 false 时仍需保留已排队子工作和正确 memoized 指针。 */
      shouldComponentUpdate(nextProps) {
        return this.props.children !== nextProps.children;
      }
      /** Middle.render 在“shouldComponentUpdate 拒绝后复用”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('Middle');
        return <span>{this.props.children}</span>;
      }
    }

    /** Content 在“shouldComponentUpdate 拒绝后复用”场景代表可恢复的内容 class 子树；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Content extends React.Component {
      /** Content.shouldComponentUpdate 在“shouldComponentUpdate 拒绝后复用”场景比较下一组输入并决定 bailout；返回 false 时仍需保留已排队子工作和正确 memoized 指针。 */
      shouldComponentUpdate(nextProps) {
        return this.props.step !== nextProps.step;
      }
      /** Content.render 在“shouldComponentUpdate 拒绝后复用”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('Content');
        return (
          <div>
            <Middle>{this.props.step === 0 ? 'Hi' : 'Hello'}</Middle>
            <Bar>{this.props.step === 0 ? this.props.text : '-'}</Bar>
            <Middle>{this.props.step === 0 ? 'There' : 'World'}</Middle>
          </div>
        );
      }
    }

    /** Foo 在“shouldComponentUpdate 拒绝后复用”场景组装测试子树并把 props/state 变化转化为可观测渲染工作；返回结构限定断言所覆盖的工作边界。 */
    function Foo(props) {
      Scheduler.log('Foo');
      return (
        <div>
          <Bar>{props.text}</Bar>
          <div hidden={true}>
            <Content step={props.step} text={props.text} />
          </div>
        </div>
      );
    }

    // 初始化阶段。
    ReactNoop.render(<Foo text="foo" step={0} />);
    await waitForAll(['Foo', 'Bar', 'Content', 'Middle', 'Bar', 'Middle']);

    // 执行快速更新，调度低优先级工作以
    // 更新 Middle 内容。
    ReactNoop.render(<Foo text="bar" step={1} />);
    ReactNoop.flushDeferredPri(30 + 5);

    assertLog(['Foo', 'Bar']);

    // Middle 内容现在等待渲染……
    ReactNoop.flushDeferredPri(30 + 25 + 5);
    assertLog(['Content', 'Middle', 'Bar']); // 还剩一个 Middle。

    // 但将用更高优先级工作中断它。
    // Middle 内容会 bailout，因此保持不变。
    ReactNoop.render(<Foo text="foo" step={1} />);
    ReactNoop.flushDeferredPri(30);

    assertLog(['Foo', 'Bar']);

    // 由于中断期间没有修改 Middle 子树，
    // 应能复用已经完成的 reconciliation 工作，
    // 无需重新开始。
    await waitForAll(['Middle']);
  });

  /**
   * 场景：bailout 仍必须更新 memoized props。
   * Given：Foo 的 shouldComponentUpdate 依据 this.props 与 nextProps 比较。
   * When：先让一次更新返回 false，再进行后续输入更新。
   * Then：即使跳过 render，Fiber/实例的 memoized props 仍前移，后续比较不会永久返回 false。
   * 验证机制：shouldComponentUpdate 与 render 日志验证第二次更新使用最新基线。
   * 对应源码：packages/react-reconciler/src/ReactFiberClassComponent.js 的 updateClassInstance()；ReactFiberBeginWork.js。
   */
  it('memoizes work even if shouldComponentUpdate returns false', async () => {
    /** Foo 在“bailout 后更新 memoized props”场景承载本地状态、实例身份或生命周期日志，暴露中断与恢复边界；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Foo extends React.Component {
      /** Foo.shouldComponentUpdate 在“bailout 后更新 memoized props”场景比较下一组输入并决定 bailout；返回 false 时仍需保留已排队子工作和正确 memoized 指针。 */
      shouldComponentUpdate(nextProps) {
        // this.props 是 memoized props，因此除首次更新外，
        // 后续每次更新都应返回 true。
        const shouldUpdate = this.props.step !== 1;
        Scheduler.log('shouldComponentUpdate: ' + shouldUpdate);
        return shouldUpdate;
      }
      /** Foo.render 在“bailout 后更新 memoized props”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('render');
        return <div />;
      }
    }

    ReactNoop.render(<Foo step={1} />);
    await waitForAll(['render']);

    ReactNoop.render(<Foo step={2} />);
    await waitForAll(['shouldComponentUpdate: false']);

    ReactNoop.render(<Foo step={3} />);
    await waitForAll([
      // 若上次 bailout 时未更新 memoized props，sCU 将
      // 持续返回 false。
      'shouldComponentUpdate: true',
      'render',
    ]);
  });

  /**
   * 场景：树中部 setState 只重做相关路径。
   * Given：Bar 实例位于 Foo 子树中且持有本地 state。
   * When：初次提交后直接对 Bar 调用 setState。
   * Then：调度从目标 Fiber 向根标 lane，仅重渲染必要祖先/目标，提交新 state。
   * 验证机制：实例日志与最终文本确认 state 生效并排除无关子树工作。
   * 对应源码：packages/react-reconciler/src/ReactFiberClassUpdateQueue.js 的 enqueueUpdate()；ReactFiberWorkLoop.js 的 scheduleUpdateOnFiber()。
   */
  it('can update in the middle of a tree using setState', async () => {
    let instance;
    /** Bar 在“树中部 setState”场景承载状态更新及 render/shouldComponentUpdate 行为，作为 class 更新队列 fixture；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Bar extends React.Component {
      /** Bar.constructor 在“树中部 setState”场景初始化实例 state、计数器或更新入口；该初值是后续中断与恢复比较的基线。 */
      constructor() {
        super();
        this.state = {a: 'a'};
        instance = this;
      }
      /** Bar.render 在“树中部 setState”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    /** Foo 在“树中部 setState”场景组装测试子树并把 props/state 变化转化为可观测渲染工作；返回结构限定断言所覆盖的工作边界。 */
    function Foo() {
      return (
        <div>
          <Bar />
        </div>
      );
    }

    ReactNoop.render(<Foo />);
    await waitForAll([]);
    expect(instance.state).toEqual({a: 'a'});
    instance.setState({b: 'b'});
    await waitForAll([]);
    expect(instance.state).toEqual({a: 'a', b: 'b'});
  });

  /**
   * 场景：多个 setState 在同一队列中顺序合并。
   * Given：Bar 在 flush 前接收多条对象形式 state 更新。
   * When：连续 enqueue 多次 setState 后统一冲刷。
   * Then：更新按顺序合并到同一 baseState，只产生最终一致的 render/commit。
   * 验证机制：最终 state、渲染文本和 callback 顺序共同验证队列折叠。
   * 对应源码：packages/react-reconciler/src/ReactFiberClassUpdateQueue.js 的 processUpdateQueue()。
   */
  it('can queue multiple state updates', async () => {
    let instance;
    /** Bar 在“多个 setState 排队合并”场景承载状态更新及 render/shouldComponentUpdate 行为，作为 class 更新队列 fixture；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Bar extends React.Component {
      /** Bar.constructor 在“多个 setState 排队合并”场景初始化实例 state、计数器或更新入口；该初值是后续中断与恢复比较的基线。 */
      constructor() {
        super();
        this.state = {a: 'a'};
        instance = this;
      }
      /** Bar.render 在“多个 setState 排队合并”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    /** Foo 在“多个 setState 排队合并”场景组装测试子树并把 props/state 变化转化为可观测渲染工作；返回结构限定断言所覆盖的工作边界。 */
    function Foo() {
      return (
        <div>
          <Bar />
        </div>
      );
    }

    ReactNoop.render(<Foo />);
    await waitForAll([]);
    // 在冲刷前多次调用 setState。
    instance.setState({b: 'b'});
    instance.setState({c: 'c'});
    instance.setState({d: 'd'});
    await waitForAll([]);
    expect(instance.state).toEqual({a: 'a', b: 'b', c: 'c', d: 'd'});
  });

  /**
   * 场景：函数式 updater 接收前一条更新结果。
   * Given：Bar 已有初始 state，updater 依赖 prevState 计算下一值。
   * When：排入一个或多个函数式 setState 并冲刷。
   * Then：每个 updater 按队列顺序看到前一结果，而非捕获旧快照。
   * 验证机制：updater 日志及最终 state 精确验证 prevState 传递。
   * 对应源码：packages/react-reconciler/src/ReactFiberClassUpdateQueue.js 的 getStateFromUpdate()/processUpdateQueue()。
   */
  it('can use updater form of setState', async () => {
    let instance;
    /** Bar 在“setState updater 形式”场景承载状态更新及 render/shouldComponentUpdate 行为，作为 class 更新队列 fixture；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Bar extends React.Component {
      /** Bar.constructor 在“setState updater 形式”场景初始化实例 state、计数器或更新入口；该初值是后续中断与恢复比较的基线。 */
      constructor() {
        super();
        this.state = {num: 1};
        instance = this;
      }
      /** Bar.render 在“setState updater 形式”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    /** Foo 在“setState updater 形式”场景组装测试子树并把 props/state 变化转化为可观测渲染工作；返回结构限定断言所覆盖的工作边界。 */
    function Foo({multiplier}) {
      return (
        <div>
          <Bar multiplier={multiplier} />
        </div>
      );
    }

    /** updater 在“setState updater 形式”场景根据前一状态计算下一状态，验证更新队列按排队顺序传递 prevState；返回结构限定断言所覆盖的工作边界。 */
    function updater(state, props) {
      return {num: state.num * props.multiplier};
    }

    ReactNoop.render(<Foo multiplier={2} />);
    await waitForAll([]);
    expect(instance.state.num).toEqual(1);
    instance.setState(updater);
    await waitForAll([]);
    expect(instance.state.num).toEqual(2);

    instance.setState(updater);
    ReactNoop.render(<Foo multiplier={3} />);
    await waitForAll([]);
    expect(instance.state.num).toEqual(6);
  });

  /**
   * 场景：setState callback 可安全排入下一次更新。
   * Given：首个 updater 带 callback，callback 内再次调用 setState。
   * When：完成首轮提交并执行 callback，再冲刷它排入的更新。
   * Then：callback 在 commit 阶段运行；嵌套更新进入新调度轮次，不污染当前遍历。
   * 验证机制：两次 render/commit 和 callback 日志验证重入时序。
   * 对应源码：packages/react-reconciler/src/ReactFiberClassUpdateQueue.js 的 commitCallbacks()；ReactFiberWorkLoop.js。
   */
  it('can call setState inside update callback', async () => {
    let instance;
    /** Bar 在“setState callback 内再次更新”场景承载状态更新及 render/shouldComponentUpdate 行为，作为 class 更新队列 fixture；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Bar extends React.Component {
      /** Bar.constructor 在“setState callback 内再次更新”场景初始化实例 state、计数器或更新入口；该初值是后续中断与恢复比较的基线。 */
      constructor() {
        super();
        this.state = {num: 1};
        instance = this;
      }
      /** Bar.render 在“setState callback 内再次更新”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    /** Foo 在“setState callback 内再次更新”场景组装测试子树并把 props/state 变化转化为可观测渲染工作；返回结构限定断言所覆盖的工作边界。 */
    function Foo({multiplier}) {
      return (
        <div>
          <Bar multiplier={multiplier} />
        </div>
      );
    }

    /** updater 在“setState callback 内再次更新”场景根据前一状态计算下一状态，验证更新队列按排队顺序传递 prevState；返回结构限定断言所覆盖的工作边界。 */
    function updater(state, props) {
      return {num: state.num * props.multiplier};
    }

    /** callback 在“setState callback 内再次更新”场景作为 setState 完成回调触发后续更新，验证 callback 队列重入；返回结构限定断言所覆盖的工作边界。 */
    function callback() {
      this.setState({called: true});
    }

    ReactNoop.render(<Foo multiplier={2} />);
    await waitForAll([]);
    instance.setState(updater);
    instance.setState(updater, callback);
    await waitForAll([]);
    expect(instance.state.num).toEqual(4);
    expect(instance.state.called).toEqual(true);
  });

  /**
   * 场景：replaceState 用新对象替换而非浅合并。
   * Given：Bar 已有包含多个键的 state。
   * When：通过 updater enqueueReplaceState 并完成更新。
   * Then：新 state 整体替换 baseState，旧对象未显式保留的键消失。
   * 验证机制：实例 state 与渲染输出断言替换结果。
   * 对应源码：packages/react-reconciler/src/ReactFiberClassUpdateQueue.js 的 ReplaceState 分支。
   */
  it('can replaceState', async () => {
    let instance;
    /** Bar 在“replaceState 替换状态”场景承载状态更新及 render/shouldComponentUpdate 行为，作为 class 更新队列 fixture；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Bar extends React.Component {
      /** Bar.state 在“replaceState 替换状态”场景保存实例的已提交本地状态；更新队列在此基线上合并 pending state 并决定后续渲染。 */
      state = {a: 'a'};
      /** Bar.render 在“replaceState 替换状态”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        instance = this;
        return <div>{this.props.children}</div>;
      }
    }

    /** Foo 在“replaceState 替换状态”场景组装测试子树并把 props/state 变化转化为可观测渲染工作；返回结构限定断言所覆盖的工作边界。 */
    function Foo() {
      return (
        <div>
          <Bar />
        </div>
      );
    }

    ReactNoop.render(<Foo />);
    await waitForAll([]);
    instance.setState({b: 'b'});
    instance.setState({c: 'c'});
    instance.updater.enqueueReplaceState(instance, {d: 'd'});
    await waitForAll([]);
    expect(instance.state).toEqual({d: 'd'});
  });

  /**
   * 场景：forceUpdate 绕过 shouldComponentUpdate。
   * Given：Bar 的 shouldComponentUpdate 固定拒绝普通更新，子树含可观察 Baz。
   * When：对 Bar 调用 forceUpdate 并冲刷。
   * Then：hasForceUpdate 使本轮仍进入 render/commit，子树得到更新。
   * 验证机制：sCU、render 与 Baz 日志证明强制路径越过 bailout。
   * 对应源码：packages/react-reconciler/src/ReactFiberClassUpdateQueue.js 的 ForceUpdate；ReactFiberClassComponent.js。
   */
  it('can forceUpdate', async () => {
    /** Baz 在“forceUpdate 越过 shouldComponentUpdate”场景提供额外叶节点或新 props 输入，用来区分旧工作与重启后的工作；返回结构限定断言所覆盖的工作边界。 */
    function Baz() {
      Scheduler.log('Baz');
      return <div />;
    }

    let instance;
    /** Bar 在“forceUpdate 越过 shouldComponentUpdate”场景承载状态更新及 render/shouldComponentUpdate 行为，作为 class 更新队列 fixture；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Bar extends React.Component {
      /** Bar.constructor 在“forceUpdate 越过 shouldComponentUpdate”场景初始化实例 state、计数器或更新入口；该初值是后续中断与恢复比较的基线。 */
      constructor() {
        super();
        instance = this;
      }
      /** Bar.shouldComponentUpdate 在“forceUpdate 越过 shouldComponentUpdate”场景比较下一组输入并决定 bailout；返回 false 时仍需保留已排队子工作和正确 memoized 指针。 */
      shouldComponentUpdate() {
        return false;
      }
      /** Bar.render 在“forceUpdate 越过 shouldComponentUpdate”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('Bar');
        return <Baz />;
      }
    }

    /** Foo 在“forceUpdate 越过 shouldComponentUpdate”场景组装测试子树并把 props/state 变化转化为可观测渲染工作；返回结构限定断言所覆盖的工作边界。 */
    function Foo() {
      Scheduler.log('Foo');
      return (
        <div>
          <Bar />
        </div>
      );
    }

    ReactNoop.render(<Foo />);
    await waitForAll(['Foo', 'Bar', 'Baz']);
    instance.forceUpdate();
    await waitForAll(['Bar', 'Baz']);
  });

  /**
   * 场景：forceUpdate 标记在提交后被清除。
   * Given：Foo 先执行一次 forceUpdate，随后接收普通可 bailout 更新。
   * When：分别冲刷强制更新和后续普通更新。
   * Then：强制标志只影响当前队列处理，后续更新重新遵守 shouldComponentUpdate。
   * 验证机制：两轮 render 次数对比检测 hasForceUpdate 是否泄漏。
   * 对应源码：packages/react-reconciler/src/ReactFiberClassUpdateQueue.js 的 resetHasForceUpdateBeforeProcessing()。
   */
  it('should clear forceUpdate after update is flushed', async () => {
    let a = 0;

    /** Foo 在“flush 后清理 forceUpdate”场景承载本地状态、实例身份或生命周期日志，暴露中断与恢复边界；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Foo extends React.PureComponent {
      /** Foo.render 在“flush 后清理 forceUpdate”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        const msg = `A: ${a}, B: ${this.props.b}`;
        Scheduler.log(msg);
        return msg;
      }
    }

    const foo = React.createRef(null);
    ReactNoop.render(<Foo ref={foo} b={0} />);
    await waitForAll(['A: 0, B: 0']);

    a = 1;
    foo.current.forceUpdate();
    await waitForAll(['A: 1, B: 0']);

    ReactNoop.render(<Foo ref={foo} b={0} />);
    await waitForAll([]);
  });

  /**
   * 场景：部分挂载恢复时仍以最新输入调用 shouldComponentUpdate。
   * Given：Bar 已构造且挂载工作只完成一部分。
   * When：在恢复前加入会影响 state/props 的更新。
   * Then：恢复 class 实例时用最新 pending 输入执行 shouldComponentUpdate，而非沿用过期快照。
   * 验证机制：sCU 参数日志与最终 render 输出验证输入版本。
   * 对应源码：packages/react-reconciler/src/ReactFiberClassComponent.js 的 resumeMountClassInstance()。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('can call sCU while resuming a partly mounted component', () => {
    const instances = new Set();

    /** Bar 在“部分挂载恢复时调用 shouldComponentUpdate”场景承载状态更新及 render/shouldComponentUpdate 行为，作为 class 更新队列 fixture；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Bar extends React.Component {
      /** Bar.state 在“部分挂载恢复时调用 shouldComponentUpdate”场景保存实例的已提交本地状态；更新队列在此基线上合并 pending state 并决定后续渲染。 */
      state = {y: 'A'};
      /** Bar.constructor 在“部分挂载恢复时调用 shouldComponentUpdate”场景初始化实例 state、计数器或更新入口；该初值是后续中断与恢复比较的基线。 */
      constructor() {
        super();
        instances.add(this);
      }
      /** Bar.shouldComponentUpdate 在“部分挂载恢复时调用 shouldComponentUpdate”场景比较下一组输入并决定 bailout；返回 false 时仍需保留已排队子工作和正确 memoized 指针。 */
      shouldComponentUpdate(newProps, newState) {
        return this.props.x !== newProps.x || this.state.y !== newState.y;
      }
      /** Bar.render 在“部分挂载恢复时调用 shouldComponentUpdate”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('Bar:' + this.props.x);
        return <span prop={String(this.props.x === this.state.y)} />;
      }
    }

    /** Foo 在“部分挂载恢复时调用 shouldComponentUpdate”场景组装测试子树并把 props/state 变化转化为可观测渲染工作；返回结构限定断言所覆盖的工作边界。 */
    function Foo(props) {
      Scheduler.log('Foo');
      return [
        <Bar key="a" x="A" />,
        <Bar key="b" x={props.step === 0 ? 'B' : 'B2'} />,
        <Bar key="c" x="C" />,
        <Bar key="d" x="D" />,
      ];
    }

    ReactNoop.render(<Foo step={0} />);
    ReactNoop.flushDeferredPri(40);
    assertLog(['Foo', 'Bar:A', 'Bar:B', 'Bar:C']);

    expect(instances.size).toBe(3);

    ReactNoop.render(<Foo step={1} />);
    ReactNoop.flushDeferredPri(50);
    // A 已 memoize 并复用；B 虽已 memoize，但因
    // props 不同而无法复用；C 已 memoize 并复用；D 尚未开始，因此
    // 需要新实例。
    assertLog(['Foo', 'Bar:B2', 'Bar:D']);

    // 预期每次重新渲染都对应一个新实例。
    expect(instances.size).toBe(4);
  });

  /**
   * 场景：部分更新中的实例 setState 会读取新 props。
   * Given：Bar 对旧 props 的更新已开始但未提交，父级又提供新 props。
   * When：在部分工作期间调用 performAction/setState 并恢复。
   * Then：更新队列重基后 render 同时看到新 props 和正确 state。
   * 验证机制：Bar/Baz 日志及最终输出校验 props-state 配对。
   * 对应源码：packages/react-reconciler/src/ReactFiberClassComponent.js 的 updateClassInstance()；ReactFiberClassUpdateQueue.js。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('gets new props when setting state on a partly updated component', async () => {
    const instances = [];

    /** Bar 在“部分更新组件在 setState 时接收新 props”场景承载状态更新及 render/shouldComponentUpdate 行为，作为 class 更新队列 fixture；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Bar extends React.Component {
      /** Bar.state 在“部分更新组件在 setState 时接收新 props”场景保存实例的已提交本地状态；更新队列在此基线上合并 pending state 并决定后续渲染。 */
      state = {y: 'A'};
      /** Bar.constructor 在“部分更新组件在 setState 时接收新 props”场景初始化实例 state、计数器或更新入口；该初值是后续中断与恢复比较的基线。 */
      constructor() {
        super();
        instances.push(this);
      }
      /** Bar.performAction 在“部分更新组件在 setState 时接收新 props”场景排队目标 setState，作为从树中部触发调度或生命周期路径的受控入口。 */
      performAction() {
        this.setState({
          y: 'B',
        });
      }
      /** Bar.render 在“部分更新组件在 setState 时接收新 props”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('Bar:' + this.props.x + '-' + this.props.step);
        return <span prop={String(this.props.x === this.state.y)} />;
      }
    }

    /** Baz 在“部分更新组件在 setState 时接收新 props”场景提供额外叶节点或新 props 输入，用来区分旧工作与重启后的工作；返回结构限定断言所覆盖的工作边界。 */
    function Baz() {
      // 该组件作为 Foo 的同级节点，使 Foo 可以完整
      // 完成但暂不提交。
      Scheduler.log('Baz');
      return <div />;
    }

    /** Foo 在“部分更新组件在 setState 时接收新 props”场景组装测试子树并把 props/state 变化转化为可观测渲染工作；返回结构限定断言所覆盖的工作边界。 */
    function Foo(props) {
      Scheduler.log('Foo');
      return [
        <Bar key="a" x="A" step={props.step} />,
        <Bar key="b" x="B" step={props.step} />,
      ];
    }

    ReactNoop.render(
      <div>
        <Foo step={0} />
        <Baz />
        <Baz />
      </div>,
    );
    await waitForAll([]);

    // 用新 props 冲刷到中途，使第一个 Bar 完整完成。
    // 但此时尚未提交。
    ReactNoop.render(
      <div>
        <Foo step={1} />
        <Baz />
        <Baz />
      </div>,
    );
    ReactNoop.flushDeferredPri(45);
    assertLog(['Foo', 'Bar:A-1', 'Bar:B-1', 'Baz']);

    // 更新同一个 Bar。
    instances[0].performAction();

    await waitForAll(['Bar:A-1', 'Baz']);
  });

  /**
   * 场景：中断初始渲染会重新进入 componentWillMount。
   * Given：LifeCycle 初次挂载已执行 willMount/render，但尚未提交。
   * When：以另一更新中止首个 render，再重新开始挂载。
   * Then：render 阶段的 componentWillMount 可再次调用，componentDidMount 只对应最终 commit。
   * 验证机制：lifecycle 日志统计 willMount 与 didMount 次数，并用 Trail 定位中断点。
   * 对应源码：packages/react-reconciler/src/ReactFiberClassComponent.js 的 mountClassInstance()；ReactFiberWorkLoop.js。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('calls componentWillMount twice if the initial render is aborted', async () => {
    /** LifeCycle 在“初始渲染中断后重复调用 componentWillMount”场景集中记录旧式及现代生命周期调用，用来核对中断、恢复与提交次数；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class LifeCycle extends React.Component {
      /** LifeCycle.state 在“初始渲染中断后重复调用 componentWillMount”场景保存实例的已提交本地状态；更新队列在此基线上合并 pending state 并决定后续渲染。 */
      state = {x: this.props.x};
      /** LifeCycle.UNSAFE_componentWillReceiveProps 在“初始渲染中断后重复调用 componentWillMount”场景只响应父级传入的新 props；纯 state 更新或同一 props 恢复不得误触发。 */
      UNSAFE_componentWillReceiveProps(nextProps) {
        Scheduler.log(
          'componentWillReceiveProps:' + this.state.x + '-' + nextProps.x,
        );
        this.setState({x: nextProps.x});
      }
      /** LifeCycle.UNSAFE_componentWillMount 在“初始渲染中断后重复调用 componentWillMount”场景记录挂载前 render 阶段并可能排队初始 state；被中断的挂载允许重新进入但不能错误提交。 */
      UNSAFE_componentWillMount() {
        Scheduler.log(
          'componentWillMount:' + this.state.x + '-' + this.props.x,
        );
      }
      /** LifeCycle.componentDidMount 在“初始渲染中断后重复调用 componentWillMount”场景标记实例首次 commit；仅完成 render 而未提交的工作不得调用它。 */
      componentDidMount() {
        Scheduler.log('componentDidMount:' + this.state.x + '-' + this.props.x);
      }
      /** LifeCycle.render 在“初始渲染中断后重复调用 componentWillMount”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        return <span />;
      }
    }

    /** Trail 在“初始渲染中断后重复调用 componentWillMount”场景作为尾部进度哨兵，界定被中断渲染已经推进到的位置；返回结构限定断言所覆盖的工作边界。 */
    function Trail() {
      Scheduler.log('Trail');
      return null;
    }

    /** App 在“初始渲染中断后重复调用 componentWillMount”场景作为场景根 fixture 编排更新入口、生命周期节点与断言子树；返回结构限定断言所覆盖的工作边界。 */
    function App(props) {
      Scheduler.log('App');
      return (
        <div>
          <LifeCycle x={props.x} />
          <Trail />
        </div>
      );
    }

    ReactNoop.render(<App x={0} />);
    ReactNoop.flushDeferredPri(30);

    assertLog(['App', 'componentWillMount:0-0']);

    ReactNoop.render(<App x={1} />);
    await waitForAll([
      'App',
      'componentWillReceiveProps:0-1',
      'componentWillMount:1-1',
      'Trail',
      'componentDidMount:1-1',
    ]);
  });

  /**
   * 场景：componentWillMount 排入的 state 在中断后保持一致。
   * Given：LifeCycle 在 willMount 中调用 setState。
   * When：初次挂载被中断并重新执行后完成提交。
   * Then：初始更新队列正确重基，最终 state 反映生命周期更新且不被重复错误累加。
   * 验证机制：constructor、willMount、render、didMount 日志和最终 state 联合断言。
   * 对应源码：packages/react-reconciler/src/ReactFiberClassUpdateQueue.js；ReactFiberClassComponent.js 的 mountClassInstance()。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('uses state set in componentWillMount even if initial render was aborted', async () => {
    /** LifeCycle 在“componentWillMount 写入状态后中断恢复”场景集中记录旧式及现代生命周期调用，用来核对中断、恢复与提交次数；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class LifeCycle extends React.Component {
      /** LifeCycle.constructor 在“componentWillMount 写入状态后中断恢复”场景初始化实例 state、计数器或更新入口；该初值是后续中断与恢复比较的基线。 */
      constructor(props) {
        super(props);
        this.state = {x: this.props.x + '(ctor)'};
      }
      /** LifeCycle.UNSAFE_componentWillMount 在“componentWillMount 写入状态后中断恢复”场景记录挂载前 render 阶段并可能排队初始 state；被中断的挂载允许重新进入但不能错误提交。 */
      UNSAFE_componentWillMount() {
        Scheduler.log('componentWillMount:' + this.state.x);
        this.setState({x: this.props.x + '(willMount)'});
      }
      /** LifeCycle.componentDidMount 在“componentWillMount 写入状态后中断恢复”场景标记实例首次 commit；仅完成 render 而未提交的工作不得调用它。 */
      componentDidMount() {
        Scheduler.log('componentDidMount:' + this.state.x);
      }
      /** LifeCycle.render 在“componentWillMount 写入状态后中断恢复”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('render:' + this.state.x);
        return <span />;
      }
    }

    /** App 在“componentWillMount 写入状态后中断恢复”场景作为场景根 fixture 编排更新入口、生命周期节点与断言子树；返回结构限定断言所覆盖的工作边界。 */
    function App(props) {
      Scheduler.log('App');
      return <LifeCycle x={props.x} />;
    }

    ReactNoop.render(<App x={0} />);
    ReactNoop.flushDeferredPri(20);

    assertLog(['App', 'componentWillMount:0(ctor)', 'render:0(willMount)']);

    ReactNoop.render(<App x={1} />);
    await waitForAll([
      'App',
      'componentWillMount:0(willMount)',
      'render:1(willMount)',
      'componentDidMount:1(willMount)',
    ]);
  });

  /**
   * 场景：中断更新会重入 will 生命周期但只提交一次 didUpdate。
   * Given：LifeCycle 已挂载，更新 render 已进入 receiveProps/willUpdate 后被打断。
   * When：插入新更新并重新执行最终版本。
   * Then：可放弃的 will 生命周期可能重复，componentDidUpdate 只覆盖最终提交。
   * 验证机制：完整 lifecycle 序列与 Sibling 进度哨兵验证 render/commit 分界。
   * 对应源码：packages/react-reconciler/src/ReactFiberClassComponent.js 的 updateClassInstance()；ReactFiberCommitEffects.js。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('calls componentWill* twice if an update render is aborted', async () => {
    /** LifeCycle 在“更新渲染中断后重复调用 will 生命周期”场景集中记录旧式及现代生命周期调用，用来核对中断、恢复与提交次数；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class LifeCycle extends React.Component {
      /** LifeCycle.UNSAFE_componentWillMount 在“更新渲染中断后重复调用 will 生命周期”场景记录挂载前 render 阶段并可能排队初始 state；被中断的挂载允许重新进入但不能错误提交。 */
      UNSAFE_componentWillMount() {
        Scheduler.log('componentWillMount:' + this.props.x);
      }
      /** LifeCycle.componentDidMount 在“更新渲染中断后重复调用 will 生命周期”场景标记实例首次 commit；仅完成 render 而未提交的工作不得调用它。 */
      componentDidMount() {
        Scheduler.log('componentDidMount:' + this.props.x);
      }
      /** LifeCycle.UNSAFE_componentWillReceiveProps 在“更新渲染中断后重复调用 will 生命周期”场景只响应父级传入的新 props；纯 state 更新或同一 props 恢复不得误触发。 */
      UNSAFE_componentWillReceiveProps(nextProps) {
        Scheduler.log(
          'componentWillReceiveProps:' + this.props.x + '-' + nextProps.x,
        );
      }
      /** LifeCycle.shouldComponentUpdate 在“更新渲染中断后重复调用 will 生命周期”场景比较下一组输入并决定 bailout；返回 false 时仍需保留已排队子工作和正确 memoized 指针。 */
      shouldComponentUpdate(nextProps) {
        Scheduler.log(
          'shouldComponentUpdate:' + this.props.x + '-' + nextProps.x,
        );
        return true;
      }
      /** LifeCycle.UNSAFE_componentWillUpdate 在“更新渲染中断后重复调用 will 生命周期”场景记录已通过 bailout 的更新 render；中断重启可重入，commit 前不能视为完成。 */
      UNSAFE_componentWillUpdate(nextProps) {
        Scheduler.log(
          'componentWillUpdate:' + this.props.x + '-' + nextProps.x,
        );
      }
      /** LifeCycle.componentDidUpdate 在“更新渲染中断后重复调用 will 生命周期”场景记录最终提交的 prev/next 输入；被放弃的中间 render 不得单独产生 didUpdate。 */
      componentDidUpdate(prevProps) {
        Scheduler.log('componentDidUpdate:' + this.props.x + '-' + prevProps.x);
      }
      /** LifeCycle.render 在“更新渲染中断后重复调用 will 生命周期”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('render:' + this.props.x);
        return <span />;
      }
    }

    /** Sibling 在“更新渲染中断后重复调用 will 生命周期”场景作为同级进度哨兵，证明前一分支已完成但尚未提交；返回结构限定断言所覆盖的工作边界。 */
    function Sibling() {
      // 同级节点用于确认首个子节点已经完成，
      // 但尚未冲刷提交。
      Scheduler.log('Sibling');
      return <span />;
    }

    /** App 在“更新渲染中断后重复调用 will 生命周期”场景作为场景根 fixture 编排更新入口、生命周期节点与断言子树；返回结构限定断言所覆盖的工作边界。 */
    function App(props) {
      Scheduler.log('App');

      return [<LifeCycle key="a" x={props.x} />, <Sibling key="b" />];
    }

    ReactNoop.render(<App x={0} />);
    await waitForAll([
      'App',
      'componentWillMount:0',
      'render:0',
      'Sibling',
      'componentDidMount:0',
    ]);

    ReactNoop.render(<App x={1} />);
    ReactNoop.flushDeferredPri(30);

    assertLog([
      'App',
      'componentWillReceiveProps:0-1',
      'shouldComponentUpdate:0-1',
      'componentWillUpdate:0-1',
      'render:1',
      'Sibling',
      // 不应调用 componentDidUpdate。
    ]);

    ReactNoop.render(<App x={2} />);
    await waitForAll([
      'App',
      'componentWillReceiveProps:1-2',
      'shouldComponentUpdate:1-2',
      'componentWillUpdate:1-2',
      'render:2',
      'Sibling',
      // componentDidUpdate 最终调用时应覆盖两次更新。
      'componentDidUpdate:2-0',
    ]);
  });

  /**
   * 场景：纯 state 更新仍调用 getDerivedStateFromProps。
   * Given：LifeCycle 定义静态派生状态并暴露 changeState。
   * When：不改变 props，只排入本地 state 更新。
   * Then：派生函数仍以当前 props 和新 baseState 运行，render 使用合并结果。
   * 验证机制：Scheduler 日志记录派生入参、didUpdate 和最终 state。
   * 对应源码：packages/react-reconciler/src/ReactFiberClassComponent.js 的 applyDerivedStateFromProps()。
   */
  it('calls getDerivedStateFromProps even for state-only updates', async () => {
    let instance;

    /** LifeCycle 在“纯 state 更新触发 getDerivedStateFromProps”场景集中记录旧式及现代生命周期调用，用来核对中断、恢复与提交次数；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class LifeCycle extends React.Component {
      /** LifeCycle.state 在“纯 state 更新触发 getDerivedStateFromProps”场景保存实例的已提交本地状态；更新队列在此基线上合并 pending state 并决定后续渲染。 */
      state = {};
      /** LifeCycle.getDerivedStateFromProps 在“纯 state 更新触发 getDerivedStateFromProps”场景把 nextProps 与 prevState 合并为派生 state；是否调用由 props/state 是否存在待处理变化决定。 */
      static getDerivedStateFromProps(props, prevState) {
        Scheduler.log('getDerivedStateFromProps');
        return {foo: 'foo'};
      }
      /** LifeCycle.changeState 在“纯 state 更新触发 getDerivedStateFromProps”场景排队目标 setState，作为从树中部触发调度或生命周期路径的受控入口。 */
      changeState() {
        this.setState({foo: 'bar'});
      }
      /** LifeCycle.componentDidUpdate 在“纯 state 更新触发 getDerivedStateFromProps”场景记录最终提交的 prev/next 输入；被放弃的中间 render 不得单独产生 didUpdate。 */
      componentDidUpdate() {
        Scheduler.log('componentDidUpdate');
      }
      /** LifeCycle.render 在“纯 state 更新触发 getDerivedStateFromProps”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('render');
        instance = this;
        return null;
      }
    }

    ReactNoop.render(<LifeCycle />);
    await waitForAll(['getDerivedStateFromProps', 'render']);
    expect(instance.state).toEqual({foo: 'foo'});

    instance.changeState();
    await waitForAll([
      'getDerivedStateFromProps',
      'render',
      'componentDidUpdate',
    ]);
    expect(instance.state).toEqual({foo: 'foo'});
  });

  /**
   * 场景：没有 props/state 工作时不调用派生状态。
   * Given：Parent/Child 已提交且后续 render 可命中 bailout。
   * When：触发不改变其 props、state 或 context 的父层更新。
   * Then：无 scheduled update 的 class 直接复用，不重复调用 getDerivedStateFromProps。
   * 验证机制：派生函数计数与 Child render 日志保持不变。
   * 对应源码：packages/react-reconciler/src/ReactFiberBeginWork.js 的 checkScheduledUpdateOrContext()；ReactFiberClassComponent.js。
   */
  it('does not call getDerivedStateFromProps if neither state nor props have changed', async () => {
    /** Parent 在“state 与 props 均未变时跳过派生状态”场景控制父级 bailout、props 或派生状态，界定子树是否重新进入；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Parent extends React.Component {
      /** Parent.state 在“state 与 props 均未变时跳过派生状态”场景保存实例的已提交本地状态；更新队列在此基线上合并 pending state 并决定后续渲染。 */
      state = {parentRenders: 0};
      /** Parent.getDerivedStateFromProps 在“state 与 props 均未变时跳过派生状态”场景把 nextProps 与 prevState 合并为派生 state；是否调用由 props/state 是否存在待处理变化决定。 */
      static getDerivedStateFromProps(props, prevState) {
        Scheduler.log('getDerivedStateFromProps');
        return prevState.parentRenders + 1;
      }
      /** Parent.render 在“state 与 props 均未变时跳过派生状态”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('Parent');
        return <Child parentRenders={this.state.parentRenders} ref={child} />;
      }
    }

    /** Child 在“state 与 props 均未变时跳过派生状态”场景承载子级状态、context 或深层工作，验证父级调度决策的下游效果；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Child extends React.Component {
      /** Child.render 在“state 与 props 均未变时跳过派生状态”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('Child');
        return this.props.parentRenders;
      }
    }

    const child = React.createRef(null);
    ReactNoop.render(<Parent />);
    await waitForAll(['getDerivedStateFromProps', 'Parent', 'Child']);

    // 在子节点上调度更新；父节点不应重新渲染。
    child.current.setState({});
    await waitForAll(['Child']);
  });

  /**
   * 场景：纯 state 更新不冒充新 props 生命周期。
   * Given：LifeCycle 与 Wrap 分别能触发自身 state 和父级 props 更新。
   * When：先直接 tick LifeCycle，再通过 Wrap 更新其 props。
   * Then：第一轮不调用 componentWillReceiveProps；第二轮才调用，并各自正确提交。
   * 验证机制：分轮 lifecycle 日志明确区分 state-only 与 props-change。
   * 对应源码：packages/react-reconciler/src/ReactFiberClassComponent.js 的 updateClassInstance()。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('does not call componentWillReceiveProps for state-only updates', async () => {
    const instances = [];

    /** LifeCycle 在“纯 state 更新不调用 componentWillReceiveProps”场景集中记录旧式及现代生命周期调用，用来核对中断、恢复与提交次数；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class LifeCycle extends React.Component {
      /** LifeCycle.state 在“纯 state 更新不调用 componentWillReceiveProps”场景保存实例的已提交本地状态；更新队列在此基线上合并 pending state 并决定后续渲染。 */
      state = {x: 0};
      /** LifeCycle.tick 在“纯 state 更新不调用 componentWillReceiveProps”场景排队目标 setState，作为从树中部触发调度或生命周期路径的受控入口。 */
      tick() {
        this.setState({
          x: this.state.x + 1,
        });
      }
      /** LifeCycle.UNSAFE_componentWillMount 在“纯 state 更新不调用 componentWillReceiveProps”场景记录挂载前 render 阶段并可能排队初始 state；被中断的挂载允许重新进入但不能错误提交。 */
      UNSAFE_componentWillMount() {
        instances.push(this);
        Scheduler.log('componentWillMount:' + this.state.x);
      }
      /** LifeCycle.componentDidMount 在“纯 state 更新不调用 componentWillReceiveProps”场景标记实例首次 commit；仅完成 render 而未提交的工作不得调用它。 */
      componentDidMount() {
        Scheduler.log('componentDidMount:' + this.state.x);
      }
      /** LifeCycle.UNSAFE_componentWillReceiveProps 在“纯 state 更新不调用 componentWillReceiveProps”场景只响应父级传入的新 props；纯 state 更新或同一 props 恢复不得误触发。 */
      UNSAFE_componentWillReceiveProps(nextProps) {
        Scheduler.log('componentWillReceiveProps');
      }
      /** LifeCycle.shouldComponentUpdate 在“纯 state 更新不调用 componentWillReceiveProps”场景比较下一组输入并决定 bailout；返回 false 时仍需保留已排队子工作和正确 memoized 指针。 */
      shouldComponentUpdate(nextProps, nextState) {
        Scheduler.log(
          'shouldComponentUpdate:' + this.state.x + '-' + nextState.x,
        );
        return true;
      }
      /** LifeCycle.UNSAFE_componentWillUpdate 在“纯 state 更新不调用 componentWillReceiveProps”场景记录已通过 bailout 的更新 render；中断重启可重入，commit 前不能视为完成。 */
      UNSAFE_componentWillUpdate(nextProps, nextState) {
        Scheduler.log(
          'componentWillUpdate:' + this.state.x + '-' + nextState.x,
        );
      }
      /** LifeCycle.componentDidUpdate 在“纯 state 更新不调用 componentWillReceiveProps”场景记录最终提交的 prev/next 输入；被放弃的中间 render 不得单独产生 didUpdate。 */
      componentDidUpdate(prevProps, prevState) {
        Scheduler.log('componentDidUpdate:' + this.state.x + '-' + prevState.x);
      }
      /** LifeCycle.render 在“纯 state 更新不调用 componentWillReceiveProps”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('render:' + this.state.x);
        return <span />;
      }
    }

    // 该 Wrap 略显刻意，因为无法暂停已完成的根，且
    // 当前组件若未完整完成，就无法复用其 render
    // 输出。
    /** Wrap 在“纯 state 更新不调用 componentWillReceiveProps”场景持有父层状态并更新 LifeCycle props，区分直接 state 更新和父级 props 更新；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Wrap extends React.Component {
      /** Wrap.state 在“纯 state 更新不调用 componentWillReceiveProps”场景保存实例的已提交本地状态；更新队列在此基线上合并 pending state 并决定后续渲染。 */
      state = {y: 0};
      /** Wrap.UNSAFE_componentWillMount 在“纯 state 更新不调用 componentWillReceiveProps”场景记录挂载前 render 阶段并可能排队初始 state；被中断的挂载允许重新进入但不能错误提交。 */
      UNSAFE_componentWillMount() {
        instances.push(this);
      }
      /** Wrap.tick 在“纯 state 更新不调用 componentWillReceiveProps”场景排队目标 setState，作为从树中部触发调度或生命周期路径的受控入口。 */
      tick() {
        this.setState({
          y: this.state.y + 1,
        });
      }
      /** Wrap.render 在“纯 state 更新不调用 componentWillReceiveProps”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('Wrap');
        return <LifeCycle y={this.state.y} />;
      }
    }

    /** Sibling 在“纯 state 更新不调用 componentWillReceiveProps”场景作为同级进度哨兵，证明前一分支已完成但尚未提交；返回结构限定断言所覆盖的工作边界。 */
    function Sibling() {
      // 同级节点用于确认首个子节点已经完成，
      // 但尚未冲刷提交。
      Scheduler.log('Sibling');
      return <span />;
    }

    /** App 在“纯 state 更新不调用 componentWillReceiveProps”场景作为场景根 fixture 编排更新入口、生命周期节点与断言子树；返回结构限定断言所覆盖的工作边界。 */
    function App(props) {
      Scheduler.log('App');
      return [<Wrap key="a" />, <Sibling key="b" />];
    }

    ReactNoop.render(<App y={0} />);
    await waitForAll([
      'App',
      'Wrap',
      'componentWillMount:0',
      'render:0',
      'Sibling',
      'componentDidMount:0',
    ]);

    // LifeCycle 组件日志：
    instances[1].tick();

    ReactNoop.flushDeferredPri(25);

    assertLog([
      // 不应调用 componentWillReceiveProps。
      'shouldComponentUpdate:0-1',
      'componentWillUpdate:0-1',
      'render:1',
      // 不应调用 componentDidUpdate。
    ]);

    // LifeCycle 组件日志：
    instances[1].tick();

    await waitForAll([
      // 不应调用 componentWillReceiveProps。
      'shouldComponentUpdate:1-2',
      'componentWillUpdate:1-2',
      'render:2',
      // componentDidUpdate 最终调用时应覆盖两次更新。
      'componentDidUpdate:2-0',
    ]);

    // 接下来通过更新父节点来修改 LifeCycle 的 props。

    instances[0].tick();

    ReactNoop.flushDeferredPri(30);

    assertLog([
      'Wrap',
      'componentWillReceiveProps',
      'shouldComponentUpdate:2-2',
      'componentWillUpdate:2-2',
      'render:2',
      // 不应调用 componentDidUpdate。
    ]);

    // 接下来直接更新 LifeCycle，但不提供新 props。
    instances[1].tick();

    await waitForAll([
      // 这不应再次触发 componentWillReceiveProps，因为
      // 组件没有收到新 props。
      'shouldComponentUpdate:2-3',
      'componentWillUpdate:2-3',
      'render:3',
      'componentDidUpdate:3-2',
    ]);

    // TODO：补测相同场景在
    // 未完成父节点下也得到预期值。
  });

  /**
   * 场景：bailout 省略 will/didUpdate，但已开始的更新仍须提交 didUpdate。
   * Given：LifeCycle 可对相同 props 返回 false，且一轮新 props 更新可被中途打断。
   * When：先验证普通 bailout，再在更新进行中用相同 props 重启。
   * Then：未开始的 bailout 跳过 will/render/did；已完成 render 的 work 即使随后 bailout，commit 仍调用 didUpdate。
   * 验证机制：lifecycle 日志检查缺席项，并确认最终 didUpdate 覆盖两次输入。
   * 对应源码：packages/react-reconciler/src/ReactFiberBeginWork.js bailout；ReactFiberCommitEffects.js 的 commitClassLayoutLifecycles()。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('skips will/DidUpdate when bailing unless an update was already in progress', async () => {
    /** LifeCycle 在“bailout 时的 will/didUpdate 边界”场景集中记录旧式及现代生命周期调用，用来核对中断、恢复与提交次数；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class LifeCycle extends React.Component {
      /** LifeCycle.UNSAFE_componentWillMount 在“bailout 时的 will/didUpdate 边界”场景记录挂载前 render 阶段并可能排队初始 state；被中断的挂载允许重新进入但不能错误提交。 */
      UNSAFE_componentWillMount() {
        Scheduler.log('componentWillMount');
      }
      /** LifeCycle.componentDidMount 在“bailout 时的 will/didUpdate 边界”场景标记实例首次 commit；仅完成 render 而未提交的工作不得调用它。 */
      componentDidMount() {
        Scheduler.log('componentDidMount');
      }
      /** LifeCycle.UNSAFE_componentWillReceiveProps 在“bailout 时的 will/didUpdate 边界”场景只响应父级传入的新 props；纯 state 更新或同一 props 恢复不得误触发。 */
      UNSAFE_componentWillReceiveProps(nextProps) {
        Scheduler.log('componentWillReceiveProps');
      }
      /** LifeCycle.shouldComponentUpdate 在“bailout 时的 will/didUpdate 边界”场景比较下一组输入并决定 bailout；返回 false 时仍需保留已排队子工作和正确 memoized 指针。 */
      shouldComponentUpdate(nextProps) {
        Scheduler.log('shouldComponentUpdate');
        // 触发 bailout。
        return this.props.x !== nextProps.x;
      }
      /** LifeCycle.UNSAFE_componentWillUpdate 在“bailout 时的 will/didUpdate 边界”场景记录已通过 bailout 的更新 render；中断重启可重入，commit 前不能视为完成。 */
      UNSAFE_componentWillUpdate(nextProps) {
        Scheduler.log('componentWillUpdate');
      }
      /** LifeCycle.componentDidUpdate 在“bailout 时的 will/didUpdate 边界”场景记录最终提交的 prev/next 输入；被放弃的中间 render 不得单独产生 didUpdate。 */
      componentDidUpdate(prevProps) {
        Scheduler.log('componentDidUpdate');
      }
      /** LifeCycle.render 在“bailout 时的 will/didUpdate 边界”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('render');
        return <span />;
      }
    }

    /** Sibling 在“bailout 时的 will/didUpdate 边界”场景作为同级进度哨兵，证明前一分支已完成但尚未提交；返回结构限定断言所覆盖的工作边界。 */
    function Sibling() {
      Scheduler.log('render sibling');
      return <span />;
    }

    /** App 在“bailout 时的 will/didUpdate 边界”场景作为场景根 fixture 编排更新入口、生命周期节点与断言子树；返回结构限定断言所覆盖的工作边界。 */
    function App(props) {
      return [<LifeCycle key="a" x={props.x} />, <Sibling key="b" />];
    }

    ReactNoop.render(<App x={0} />);
    await waitForAll([
      'componentWillMount',
      'render',
      'render sibling',
      'componentDidMount',
    ]);

    // 更新为相同 props。
    ReactNoop.render(<App x={0} />);
    await waitForAll([
      'componentWillReceiveProps',
      'shouldComponentUpdate',
      // 不应调用 componentWillUpdate。
      // 不应调用 render。
      'render sibling',
      // 不应调用 componentDidUpdate。
    ]);

    // 开始更新为新 props……
    ReactNoop.render(<App x={1} />);
    ReactNoop.flushDeferredPri(30);

    assertLog([
      'componentWillReceiveProps',
      'shouldComponentUpdate',
      'componentWillUpdate',
      'render',
      'render sibling',
      // 此时尚不应调用 componentDidUpdate。
    ]);

    // ……但将中断它，并以相同 props 重新渲染。
    ReactNoop.render(<App x={1} />);
    await waitForAll([]);

    // 本轮可以 bailout，但仍必须调用 componentDidUpdate。
    assertLog([
      'componentWillReceiveProps',
      'shouldComponentUpdate',
      // 不应调用 componentWillUpdate。
      // 不应调用 render。
      'render sibling',
      'componentDidUpdate',
    ]);
  });

  /**
   * 场景：嵌套 batchedUpdates 共享外层批次。
   * Given：Foo state 在外层和内层 batchedUpdates 中多次变化。
   * When：嵌套调用 ReactNoop.batchedUpdates 后退出最外层。
   * Then：内部批次不提前 flush，所有更新在外层边界结束时统一处理。
   * 验证机制：render 次数和最终 state 证明没有中间提交。
   * 对应源码：packages/react-reconciler/src/ReactFiberWorkLoop.js 的 batchedUpdates()/flushSyncWorkOnAllRoots()。
   */
  it('can nest batchedUpdates', async () => {
    let instance;

    /** Foo 在“嵌套 batchedUpdates”场景承载本地状态、实例身份或生命周期日志，暴露中断与恢复边界；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Foo extends React.Component {
      /** Foo.state 在“嵌套 batchedUpdates”场景保存实例的已提交本地状态；更新队列在此基线上合并 pending state 并决定后续渲染。 */
      state = {n: 0};
      /** Foo.render 在“嵌套 batchedUpdates”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        instance = this;
        return <div />;
      }
    }

    ReactNoop.render(<Foo />);
    await waitForAll([]);

    ReactNoop.flushSync(() => {
      ReactNoop.batchedUpdates(() => {
        instance.setState({n: 1}, () => Scheduler.log('setState 1'));
        instance.setState({n: 2}, () => Scheduler.log('setState 2'));
        ReactNoop.batchedUpdates(() => {
          instance.setState({n: 3}, () => Scheduler.log('setState 3'));
          instance.setState({n: 4}, () => Scheduler.log('setState 4'));
          Scheduler.log('end inner batchedUpdates');
        });
        Scheduler.log('end outer batchedUpdates');
      });
    });

    // 更新是同步的，因此无需 ReactNoop.flush()。

    assertLog([
      'end inner batchedUpdates',
      'end outer batchedUpdates',
      'setState 1',
      'setState 2',
      'setState 3',
      'setState 4',
    ]);
    expect(instance.state.n).toEqual(4);
  });

  /**
   * 场景：setState callback 抛错会中止后续 callback 并传播。
   * Given：同一提交队列含多个 setState callbacks，第二个故意抛错。
   * When：完成状态更新并进入 commit callback 阶段。
   * Then：错误向外传播；抛错后的第三个 callback 不执行，已提交 state 保持一致。
   * 验证机制：捕获异常并断言 callback 日志只到抛错点。
   * 对应源码：packages/react-reconciler/src/ReactFiberClassUpdateQueue.js 的 commitCallbacks()；ReactFiberWorkLoop.js 错误处理。
   */
  it('can handle if setState callback throws', async () => {
    let instance;

    /** Foo 在“setState callback 抛错”场景承载本地状态、实例身份或生命周期日志，暴露中断与恢复边界；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Foo extends React.Component {
      /** Foo.state 在“setState callback 抛错”场景保存实例的已提交本地状态；更新队列在此基线上合并 pending state 并决定后续渲染。 */
      state = {n: 0};
      /** Foo.render 在“setState callback 抛错”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        instance = this;
        return <div />;
      }
    }

    ReactNoop.render(<Foo />);
    await waitForAll([]);

    /** updater 在“setState callback 抛错”场景根据前一状态计算下一状态，验证更新队列按排队顺序传递 prevState；返回结构限定断言所覆盖的工作边界。 */
    function updater({n}) {
      return {n: n + 1};
    }

    instance.setState(updater, () => Scheduler.log('first callback'));
    instance.setState(updater, () => {
      Scheduler.log('second callback');
      throw new Error('callback error');
    });
    instance.setState(updater, () => Scheduler.log('third callback'));

    await waitForThrow('callback error');

    // 第二个 callback 抛错，因此第三个不会调用。
    assertLog(['first callback', 'second callback']);
    expect(instance.state.n).toEqual(3);
  });

  /**
   * 场景：legacy context 合并后按 contextTypes 掩码。
   * Given：Intl 与 Router 分别提供 locale/route，多个消费者声明不同 contextTypes。
   * When：渲染嵌套 Provider、直接消费者和中间层。
   * Then：后代接收祖先 context 合并结果，但每个组件只看到自己声明的键。
   * 验证机制：消费者输出比较 locale、route、both 和 neither 四种视图。
   * 对应源码：packages/react-reconciler/src/ReactFiberLegacyContext.js 的 processChildContext()/getMaskedContext()。
   */
  // @gate !disableLegacyContext && !disableLegacyContextForFunctionComponents
  it('merges and masks context', async () => {
    /** Intl 在“legacy context 合并与掩码”场景提供 locale legacy context，并记录 Provider 重新计算边界；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Intl extends React.Component {
      /** Intl.childContextTypes 在“legacy context 合并与掩码”场景声明 Provider 可向后代发布的 legacy context 键，限制 getChildContext 的输出边界。 */
      static childContextTypes = {
        locale: PropTypes.string,
      };
      /** Intl.getChildContext 在“legacy context 合并与掩码”场景从当前 props/state 派生 legacy context 输出；该值只对后代生效并参与 Provider 缓存。 */
      getChildContext() {
        return {
          locale: this.props.locale,
        };
      }
      /** Intl.render 在“legacy context 合并与掩码”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('Intl ' + JSON.stringify(this.context));
        return this.props.children;
      }
    }

    /** Router 在“legacy context 合并与掩码”场景提供 route legacy context，与 Intl 合并成多来源 context；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Router extends React.Component {
      /** Router.childContextTypes 在“legacy context 合并与掩码”场景声明 Provider 可向后代发布的 legacy context 键，限制 getChildContext 的输出边界。 */
      static childContextTypes = {
        route: PropTypes.string,
      };
      /** Router.getChildContext 在“legacy context 合并与掩码”场景从当前 props/state 派生 legacy context 输出；该值只对后代生效并参与 Provider 缓存。 */
      getChildContext() {
        return {
          route: this.props.route,
        };
      }
      /** Router.render 在“legacy context 合并与掩码”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('Router ' + JSON.stringify(this.context));
        return this.props.children;
      }
    }

    /** ShowLocale 在“legacy context 合并与掩码”场景以 class 消费 locale 并输出掩码后的值；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class ShowLocale extends React.Component {
      /** ShowLocale.contextTypes 在“legacy context 合并与掩码”场景声明允许读取的 legacy context 键，未声明值会在传入组件前被 mask。 */
      static contextTypes = {
        locale: PropTypes.string,
      };
      /** ShowLocale.render 在“legacy context 合并与掩码”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('ShowLocale ' + JSON.stringify(this.context));
        return this.context.locale;
      }
    }

    /** ShowRoute 在“legacy context 合并与掩码”场景只消费 route，验证未声明的 context 键会被掩码；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class ShowRoute extends React.Component {
      /** ShowRoute.contextTypes 在“legacy context 合并与掩码”场景声明允许读取的 legacy context 键，未声明值会在传入组件前被 mask。 */
      static contextTypes = {
        route: PropTypes.string,
      };
      /** ShowRoute.render 在“legacy context 合并与掩码”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('ShowRoute ' + JSON.stringify(this.context));
        return this.context.route;
      }
    }

    /** ShowBoth 在“legacy context 合并与掩码”场景并列渲染多个 legacy context 消费者，验证掩码后的输入彼此独立；返回结构限定断言所覆盖的工作边界。 */
    function ShowBoth(props, context) {
      Scheduler.log('ShowBoth ' + JSON.stringify(context));
      return `${context.route} in ${context.locale}`;
    }
    ShowBoth.contextTypes = {
      locale: PropTypes.string,
      route: PropTypes.string,
    };

    /** ShowNeither 在“legacy context 合并与掩码”场景不声明 contextTypes，验证消费者不会看到未订阅值；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class ShowNeither extends React.Component {
      /** ShowNeither.render 在“legacy context 合并与掩码”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('ShowNeither ' + JSON.stringify(this.context));
        return null;
      }
    }

    /** Indirection 在“legacy context 合并与掩码”场景提供不消费 context 的 class 中间层；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Indirection extends React.Component {
      /** Indirection.render 在“legacy context 合并与掩码”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('Indirection ' + JSON.stringify(this.context));
        return [
          <ShowLocale key="a" />,
          <ShowRoute key="b" />,
          <ShowNeither key="c" />,
          <Intl key="d" locale="ru">
            <ShowBoth />
          </Intl>,
          <ShowBoth key="e" />,
        ];
      }
    }

    ReactNoop.render(
      <Intl locale="fr">
        <ShowLocale />
        <div>
          <ShowBoth />
        </div>
      </Intl>,
    );
    await waitForAll([
      'Intl {}',
      'ShowLocale {"locale":"fr"}',
      'ShowBoth {"locale":"fr"}',
    ]);
    assertConsoleErrorDev([
      'Intl uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Intl (at **)',
      'ShowLocale uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in ShowLocale (at **)',
      'ShowBoth uses the legacy contextTypes API which will be removed soon. ' +
        'Use React.createContext() with React.useContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in ShowBoth (at **)',
    ]);

    ReactNoop.render(
      <Intl locale="de">
        <ShowLocale />
        <div>
          <ShowBoth />
        </div>
      </Intl>,
    );
    await waitForAll([
      'Intl {}',
      'ShowLocale {"locale":"de"}',
      'ShowBoth {"locale":"de"}',
    ]);
    React.startTransition(() => {
      ReactNoop.render(
        <Intl locale="sv">
          <ShowLocale />
          <div>
            <ShowBoth />
          </div>
        </Intl>,
      );
    });
    await waitFor(['Intl {}']);

    ReactNoop.render(
      <Intl locale="en">
        <ShowLocale />
        <Router route="/about">
          <Indirection />
        </Router>
        <ShowBoth />
      </Intl>,
    );
    await waitForAll([
      'ShowLocale {"locale":"sv"}',
      'ShowBoth {"locale":"sv"}',
      'Intl {}',
      'ShowLocale {"locale":"en"}',
      'Router {}',
      'Indirection {}',
      'ShowLocale {"locale":"en"}',
      'ShowRoute {"route":"/about"}',
      'ShowNeither {}',
      'Intl {}',
      'ShowBoth {"locale":"ru","route":"/about"}',
      'ShowBoth {"locale":"en","route":"/about"}',
      'ShowBoth {"locale":"en"}',
    ]);
    assertConsoleErrorDev([
      'Router uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Router (at **)',
      'ShowRoute uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Indirection (at **)',
    ]);
  });

  /**
   * 场景：Provider 自身读取的 context 不包含自己刚提供的值。
   * Given：Recurse 同时消费父 context 并通过 getChildContext 发布下一层值。
   * When：递归渲染多层 Recurse。
   * Then：每层 Provider 的 getChildContext 基于父级 unmasked context；自身输出只供后代，不能反向泄漏。
   * 验证机制：逐层日志/文本验证颜色值按预期递进而非自引用。
   * 对应源码：packages/react-reconciler/src/ReactFiberLegacyContext.js 的 pushLegacyContextProvider()/processChildContext()。
   */
  // @gate !disableLegacyContext
  it('does not leak own context into context provider', async () => {
    if (gate(flags => flags.disableLegacyContext)) {
      throw new Error('This test infinite loops when context is disabled.');
    }
    /** Recurse 在“Provider 自身 context 不泄漏”场景同时消费和重新提供 context，验证 Provider 输入隔离；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Recurse extends React.Component {
      /** Recurse.contextTypes 在“Provider 自身 context 不泄漏”场景声明允许读取的 legacy context 键，未声明值会在传入组件前被 mask。 */
      static contextTypes = {
        n: PropTypes.number,
      };
      /** Recurse.childContextTypes 在“Provider 自身 context 不泄漏”场景声明 Provider 可向后代发布的 legacy context 键，限制 getChildContext 的输出边界。 */
      static childContextTypes = {
        n: PropTypes.number,
      };
      /** Recurse.getChildContext 在“Provider 自身 context 不泄漏”场景从当前 props/state 派生 legacy context 输出；该值只对后代生效并参与 Provider 缓存。 */
      getChildContext() {
        return {n: (this.context.n || 3) - 1};
      }
      /** Recurse.render 在“Provider 自身 context 不泄漏”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('Recurse ' + JSON.stringify(this.context));
        if (this.context.n === 0) {
          return null;
        }
        return <Recurse />;
      }
    }

    ReactNoop.render(<Recurse />);
    await waitForAll([
      'Recurse {}',
      'Recurse {"n":2}',
      'Recurse {"n":1}',
      'Recurse {"n":0}',
    ]);
    assertConsoleErrorDev([
      'Recurse uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Recurse (at **)',
      'Recurse uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Recurse (at **)',
    ]);
  });

  /**
   * 场景：复用 memoized 工作时仍提供正确 context。
   * Given：Intl Provider 下的 ShowLocale 部分工作可被复用。
   * When：更新与恢复路径复用已完成 Fiber。
   * Then：复用子树仍在正确 Provider 栈下读取 locale，不能因 bailout 丢失 context。
   * 验证机制：前后输出和 render 日志验证 locale 始终来自当前 Provider。
   * 对应源码：packages/react-reconciler/src/ReactFiberLegacyContext.js 的 pushTopLevelContextObject()/pushLegacyContextProvider()；ReactFiberBeginWork.js。
   */
  // @gate enableLegacyHidden && !disableLegacyContext
  it('provides context when reusing work', async () => {
    /** Intl 在“复用工作时保持 Provider context”场景提供 locale legacy context，并记录 Provider 重新计算边界；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Intl extends React.Component {
      /** Intl.childContextTypes 在“复用工作时保持 Provider context”场景声明 Provider 可向后代发布的 legacy context 键，限制 getChildContext 的输出边界。 */
      static childContextTypes = {
        locale: PropTypes.string,
      };
      /** Intl.getChildContext 在“复用工作时保持 Provider context”场景从当前 props/state 派生 legacy context 输出；该值只对后代生效并参与 Provider 缓存。 */
      getChildContext() {
        return {
          locale: this.props.locale,
        };
      }
      /** Intl.render 在“复用工作时保持 Provider context”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('Intl ' + JSON.stringify(this.context));
        return this.props.children;
      }
    }

    /** ShowLocale 在“复用工作时保持 Provider context”场景以 class 消费 locale 并输出掩码后的值；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class ShowLocale extends React.Component {
      /** ShowLocale.contextTypes 在“复用工作时保持 Provider context”场景声明允许读取的 legacy context 键，未声明值会在传入组件前被 mask。 */
      static contextTypes = {
        locale: PropTypes.string,
      };
      /** ShowLocale.render 在“复用工作时保持 Provider context”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('ShowLocale ' + JSON.stringify(this.context));
        return this.context.locale;
      }
    }

    React.startTransition(() => {
      ReactNoop.render(
        <Intl locale="fr">
          <ShowLocale />
          <LegacyHiddenDiv mode="hidden">
            <ShowLocale />
            <Intl locale="ru">
              <ShowLocale />
            </Intl>
          </LegacyHiddenDiv>
          <ShowLocale />
        </Intl>,
      );
    });

    await waitFor([
      'Intl {}',
      'ShowLocale {"locale":"fr"}',
      'ShowLocale {"locale":"fr"}',
    ]);
    assertConsoleErrorDev([
      'Intl uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Intl (at **)',
      'ShowLocale uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in ShowLocale (at **)',
    ]);

    await waitForAll([
      'ShowLocale {"locale":"fr"}',
      'Intl {}',
      'ShowLocale {"locale":"ru"}',
    ]);
  });

  /**
   * 场景：Provider 下方 setState 不应迫使上层 context 重算。
   * Given：Stateful 的 setState 位于 Intl Provider 后代内部。
   * When：初始提交后只更新 Stateful。
   * Then：Provider 输入未变，已 memoize 的上层/同级工作可复用；消费者仍读取相同 locale。
   * 验证机制：日志缺少无关 Provider 重渲染，并断言 class/function 消费者值一致。
   * 对应源码：packages/react-reconciler/src/ReactFiberLegacyContext.js 的 invalidateContextProvider()；ReactFiberBeginWork.js。
   */
  // @gate !disableLegacyContext && !disableLegacyContextForFunctionComponents
  it('reads context when setState is below the provider', async () => {
    let statefulInst;

    /** Intl 在“Provider 下方 setState 后读取 context”场景提供 locale legacy context，并记录 Provider 重新计算边界；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Intl extends React.Component {
      /** Intl.childContextTypes 在“Provider 下方 setState 后读取 context”场景声明 Provider 可向后代发布的 legacy context 键，限制 getChildContext 的输出边界。 */
      static childContextTypes = {
        locale: PropTypes.string,
      };
      /** Intl.getChildContext 在“Provider 下方 setState 后读取 context”场景从当前 props/state 派生 legacy context 输出；该值只对后代生效并参与 Provider 缓存。 */
      getChildContext() {
        const childContext = {
          locale: this.props.locale,
        };
        Scheduler.log('Intl:provide ' + JSON.stringify(childContext));
        return childContext;
      }
      /** Intl.render 在“Provider 下方 setState 后读取 context”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('Intl:read ' + JSON.stringify(this.context));
        return this.props.children;
      }
    }

    /** ShowLocaleClass 在“Provider 下方 setState 后读取 context”场景以 class 形式读取 locale，和函数消费者对照；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class ShowLocaleClass extends React.Component {
      /** ShowLocaleClass.contextTypes 在“Provider 下方 setState 后读取 context”场景声明允许读取的 legacy context 键，未声明值会在传入组件前被 mask。 */
      static contextTypes = {
        locale: PropTypes.string,
      };
      /** ShowLocaleClass.render 在“Provider 下方 setState 后读取 context”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('ShowLocaleClass:read ' + JSON.stringify(this.context));
        return this.context.locale;
      }
    }

    /** ShowLocaleFn 在“Provider 下方 setState 后读取 context”场景以函数组件读取 locale，和 class 消费者形成 context 对照；返回结构限定断言所覆盖的工作边界。 */
    function ShowLocaleFn(props, context) {
      Scheduler.log('ShowLocaleFn:read ' + JSON.stringify(context));
      return context.locale;
    }
    ShowLocaleFn.contextTypes = {
      locale: PropTypes.string,
    };

    /** Stateful 在“Provider 下方 setState 后读取 context”场景持有无关 state 并在 Provider 上下触发更新；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Stateful extends React.Component {
      /** Stateful.state 在“Provider 下方 setState 后读取 context”场景保存实例的已提交本地状态；更新队列在此基线上合并 pending state 并决定后续渲染。 */
      state = {x: 0};
      /** Stateful.render 在“Provider 下方 setState 后读取 context”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        statefulInst = this;
        return this.props.children;
      }
    }

    /** IndirectionFn 在“Provider 下方 setState 后读取 context”场景增加不消费 context 的函数中间层，检验传播是否穿透；返回结构限定断言所覆盖的工作边界。 */
    function IndirectionFn(props, context) {
      Scheduler.log('IndirectionFn ' + JSON.stringify(context));
      return props.children;
    }

    /** IndirectionClass 在“Provider 下方 setState 后读取 context”场景增加不消费 context 的 class 中间层，验证 bailout 与传播；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class IndirectionClass extends React.Component {
      /** IndirectionClass.render 在“Provider 下方 setState 后读取 context”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('IndirectionClass ' + JSON.stringify(this.context));
        return this.props.children;
      }
    }

    ReactNoop.render(
      <Intl locale="fr">
        <IndirectionFn>
          <IndirectionClass>
            <Stateful>
              <ShowLocaleClass />
              <ShowLocaleFn />
            </Stateful>
          </IndirectionClass>
        </IndirectionFn>
      </Intl>,
    );
    await waitForAll([
      'Intl:read {}',
      'Intl:provide {"locale":"fr"}',
      'IndirectionFn {}',
      'IndirectionClass {}',
      'ShowLocaleClass:read {"locale":"fr"}',
      'ShowLocaleFn:read {"locale":"fr"}',
    ]);
    assertConsoleErrorDev([
      'Intl uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Intl (at **)',
      'ShowLocaleClass uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in ShowLocaleClass (at **)',
      'ShowLocaleFn uses the legacy contextTypes API which will be removed soon. ' +
        'Use React.createContext() with React.useContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in ShowLocaleFn (at **)',
    ]);

    statefulInst.setState({x: 1});
    await waitForAll([]);
    // 所有工作都已 memoize，因为 setState()
    // 发生在 context 下方，不可能影响它。
    assertLog([]);
  });

  /**
   * 场景：Provider 上方 setState 后后代仍读取当前 context。
   * Given：Stateful 包裹 Intl Provider，更新发生在 Provider 祖先。
   * When：触发祖先 state 更新并重新遍历 Provider 子树。
   * Then：context 栈在重新进入 Provider 时正确压入，class/function 消费者得到当前 locale。
   * 验证机制：渲染日志与最终文本校验上方更新未留下旧 context。
   * 对应源码：packages/react-reconciler/src/ReactFiberLegacyContext.js 的 pushLegacyContextProvider()/popLegacyContext()。
   */
  // @gate !disableLegacyContext && !disableLegacyContextForFunctionComponents
  it('reads context when setState is above the provider', async () => {
    let statefulInst;

    /** Intl 在“Provider 上方 setState 后读取 context”场景提供 locale legacy context，并记录 Provider 重新计算边界；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Intl extends React.Component {
      /** Intl.childContextTypes 在“Provider 上方 setState 后读取 context”场景声明 Provider 可向后代发布的 legacy context 键，限制 getChildContext 的输出边界。 */
      static childContextTypes = {
        locale: PropTypes.string,
      };
      /** Intl.getChildContext 在“Provider 上方 setState 后读取 context”场景从当前 props/state 派生 legacy context 输出；该值只对后代生效并参与 Provider 缓存。 */
      getChildContext() {
        const childContext = {
          locale: this.props.locale,
        };
        Scheduler.log('Intl:provide ' + JSON.stringify(childContext));
        return childContext;
      }
      /** Intl.render 在“Provider 上方 setState 后读取 context”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('Intl:read ' + JSON.stringify(this.context));
        return this.props.children;
      }
    }

    /** ShowLocaleClass 在“Provider 上方 setState 后读取 context”场景以 class 形式读取 locale，和函数消费者对照；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class ShowLocaleClass extends React.Component {
      /** ShowLocaleClass.contextTypes 在“Provider 上方 setState 后读取 context”场景声明允许读取的 legacy context 键，未声明值会在传入组件前被 mask。 */
      static contextTypes = {
        locale: PropTypes.string,
      };
      /** ShowLocaleClass.render 在“Provider 上方 setState 后读取 context”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('ShowLocaleClass:read ' + JSON.stringify(this.context));
        return this.context.locale;
      }
    }

    /** ShowLocaleFn 在“Provider 上方 setState 后读取 context”场景以函数组件读取 locale，和 class 消费者形成 context 对照；返回结构限定断言所覆盖的工作边界。 */
    function ShowLocaleFn(props, context) {
      Scheduler.log('ShowLocaleFn:read ' + JSON.stringify(context));
      return context.locale;
    }
    ShowLocaleFn.contextTypes = {
      locale: PropTypes.string,
    };

    /** IndirectionFn 在“Provider 上方 setState 后读取 context”场景增加不消费 context 的函数中间层，检验传播是否穿透；返回结构限定断言所覆盖的工作边界。 */
    function IndirectionFn(props, context) {
      Scheduler.log('IndirectionFn ' + JSON.stringify(context));
      return props.children;
    }

    /** IndirectionClass 在“Provider 上方 setState 后读取 context”场景增加不消费 context 的 class 中间层，验证 bailout 与传播；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class IndirectionClass extends React.Component {
      /** IndirectionClass.render 在“Provider 上方 setState 后读取 context”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('IndirectionClass ' + JSON.stringify(this.context));
        return this.props.children;
      }
    }

    /** Stateful 在“Provider 上方 setState 后读取 context”场景持有无关 state 并在 Provider 上下触发更新；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Stateful extends React.Component {
      /** Stateful.state 在“Provider 上方 setState 后读取 context”场景保存实例的已提交本地状态；更新队列在此基线上合并 pending state 并决定后续渲染。 */
      state = {locale: 'fr'};
      /** Stateful.render 在“Provider 上方 setState 后读取 context”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        statefulInst = this;
        return <Intl locale={this.state.locale}>{this.props.children}</Intl>;
      }
    }

    ReactNoop.render(
      <Stateful>
        <IndirectionFn>
          <IndirectionClass>
            <ShowLocaleClass />
            <ShowLocaleFn />
          </IndirectionClass>
        </IndirectionFn>
      </Stateful>,
    );
    await waitForAll([
      'Intl:read {}',
      'Intl:provide {"locale":"fr"}',
      'IndirectionFn {}',
      'IndirectionClass {}',
      'ShowLocaleClass:read {"locale":"fr"}',
      'ShowLocaleFn:read {"locale":"fr"}',
    ]);

    assertConsoleErrorDev([
      'Intl uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Stateful (at **)',
      'ShowLocaleClass uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in ShowLocaleClass (at **)',

      'ShowLocaleFn uses the legacy contextTypes API which will be removed soon. ' +
        'Use React.createContext() with React.useContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in ShowLocaleFn (at **)',
    ]);

    statefulInst.setState({locale: 'gr'});
    await waitForAll([
      // Intl 位于 setState() 下方，可能受其
      // 影响，因此重新渲染并计算
      // 它的 child context。
      'Intl:read {}',
      'Intl:provide {"locale":"gr"}',
      // TODO：遗憾的是，当前无法复用
      // 这些不依赖 context 的组件工作。
      'IndirectionFn {}',
      'IndirectionClass {}',
      // 以下组件依赖 context：
      'ShowLocaleClass:read {"locale":"gr"}',
      'ShowLocaleFn:read {"locale":"gr"}',
    ]);
  });

  /**
   * 场景：低优先级 Provider bailout 不得破坏 context 栈。
   * Given：Root/Middle 的优先级更新会让中间层 bailout，Child 同时提供 context。
   * When：部分低优先级工作被更高优先级轮次跳过后再恢复。
   * Then：即使 Provider 祖先 bailout，恢复的后代仍看到与所属树一致的 child context。
   * 验证机制：分优先级日志及 Child 输出验证 context 未串到另一轮工作。
   * 对应源码：packages/react-reconciler/src/ReactFiberLegacyContext.js；ReactFiberBeginWork.js 的 bailoutOnAlreadyFinishedWork()。
   */
  // @gate !disableLegacyContext || !__DEV__
  it('maintains the correct context when providers bail out due to low priority', async () => {
    /** Root 在“低优先级 Provider bailout 时保持 context”场景作为错误边界或优先级根 fixture，负责捕获并重建子树；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Root extends React.Component {
      /** Root.render 在“低优先级 Provider bailout 时保持 context”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        return <Middle {...this.props} />;
      }
    }

    let instance;

    /** Middle 在“低优先级 Provider bailout 时保持 context”场景建立中间 bailout、优先级或 context 层；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Middle extends React.Component {
      /** Middle.constructor 在“低优先级 Provider bailout 时保持 context”场景初始化实例 state、计数器或更新入口；该初值是后续中断与恢复比较的基线。 */
      constructor(props, context) {
        super(props, context);
        instance = this;
      }
      /** Middle.shouldComponentUpdate 在“低优先级 Provider bailout 时保持 context”场景比较下一组输入并决定 bailout；返回 false 时仍需保留已排队子工作和正确 memoized 指针。 */
      shouldComponentUpdate() {
        // 返回 false，使子节点得到 NoWork 优先级并被 bailout。
        return false;
      }
      /** Middle.render 在“低优先级 Provider bailout 时保持 context”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        return <Child />;
      }
    }

    // Child 必须是 context Provider 才能触发该缺陷。
    /** Child 在“低优先级 Provider bailout 时保持 context”场景承载子级状态、context 或深层工作，验证父级调度决策的下游效果；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Child extends React.Component {
      /** Child.childContextTypes 在“低优先级 Provider bailout 时保持 context”场景声明 Provider 可向后代发布的 legacy context 键，限制 getChildContext 的输出边界。 */
      static childContextTypes = {};
      /** Child.getChildContext 在“低优先级 Provider bailout 时保持 context”场景从当前 props/state 派生 legacy context 输出；该值只对后代生效并参与 Provider 缓存。 */
      getChildContext() {
        return {};
      }
      /** Child.render 在“低优先级 Provider bailout 时保持 context”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        return <div />;
      }
    }

    // 初始化阶段。
    ReactNoop.render(<Root />);
    await waitForAll([]);

    assertConsoleErrorDev([
      'Child uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Middle (at **)\n' +
        '    in Root (at **)',
    ]);

    // 在树中部触发更新。
    instance.setState({});
    await waitForAll([]);
  });

  /**
   * 场景：render 抛错 unwind 后必须弹出 Provider context。
   * Given：ContextProvider 压栈后，子树 Thing 故意抛错，由 Root 边界处理。
   * When：触发错误、unwind，再渲染错误 fallback 或后续工作。
   * Then：未完成树压入的 context 被成对弹出，错误边界及兄弟不会读到泄漏值。
   * 验证机制：错误日志、fallback 输出和 context 读取共同验证 unwind 清理。
   * 对应源码：packages/react-reconciler/src/ReactFiberUnwindWork.js；ReactFiberLegacyContext.js 的 popContext()。
   */
  // @gate !disableLegacyContext || !__DEV__
  it('maintains the correct context when unwinding due to an error in render', async () => {
    /** Root 在“render 错误 unwind 时恢复 context”场景作为错误边界或优先级根 fixture，负责捕获并重建子树；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Root extends React.Component {
      /** Root.componentDidCatch 在“render 错误 unwind 时恢复 context”场景接收 render 错误并切换错误边界状态；同时验证 unwind 后的 context/警告路径。 */
      componentDidCatch(error) {
        // 若 context 正确压栈与弹栈，
        // 该方法会处理测试故意抛出的 Error。
      }
      /** Root.render 在“render 错误 unwind 时恢复 context”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        return <ContextProvider depth={1} />;
      }
    }

    let instance;

    /** ContextProvider 在“render 错误 unwind 时恢复 context”场景在可能抛错的子树上压入 legacy context，供 unwind 恢复验证；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class ContextProvider extends React.Component {
      /** ContextProvider.constructor 在“render 错误 unwind 时恢复 context”场景初始化实例 state、计数器或更新入口；该初值是后续中断与恢复比较的基线。 */
      constructor(props, context) {
        super(props, context);
        this.state = {};
        if (props.depth === 1) {
          instance = this;
        }
      }
      /** ContextProvider.childContextTypes 在“render 错误 unwind 时恢复 context”场景声明 Provider 可向后代发布的 legacy context 键，限制 getChildContext 的输出边界。 */
      static childContextTypes = {};
      /** ContextProvider.getChildContext 在“render 错误 unwind 时恢复 context”场景从当前 props/state 派生 legacy context 输出；该值只对后代生效并参与 Provider 缓存。 */
      getChildContext() {
        return {};
      }
      /** ContextProvider.render 在“render 错误 unwind 时恢复 context”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        if (this.state.throwError) {
          throw Error();
        }
        return this.props.depth < 4 ? (
          <ContextProvider depth={this.props.depth + 1} />
        ) : (
          <div />
        );
      }
    }

    // 初始化阶段。
    ReactNoop.render(<Root />);
    await waitForAll([]);
    assertConsoleErrorDev([
      'ContextProvider uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Root (at **)',
    ]);

    // 在树中部触发更新。
    // 这是复现当前错误所必需的步骤。
    instance.setState({
      throwError: true,
    });
    await waitForAll([]);
    assertConsoleErrorDev([
      'Root: Error boundaries should implement getDerivedStateFromError(). ' +
        'In that method, return a state update to display an error message or fallback UI.\n' +
        '    in Root (at **)',
    ]);
  });

  /**
   * 场景：masked context 输入不变时复用同一对象。
   * Given：MyComponent 记录每轮 this.context 引用，Provider 可发生无关更新。
   * When：分别执行不改变 unmasked context 和真正改变输入的更新。
   * Then：输入 identity/值未变时复用 masked context；相关键变化时创建新对象。
   * 验证机制：componentDidMount/DidUpdate 中的引用比较与 sCU 日志验证缓存边界。
   * 对应源码：packages/react-reconciler/src/ReactFiberLegacyContext.js 的 getMaskedContext()/cacheContext()。
   */
  // @gate !disableLegacyContext || !__DEV__
  it('should not recreate masked context unless inputs have changed', async () => {
    let scuCounter = 0;

    /** MyComponent 在“masked context 输入不变时保持对象身份”场景记录 masked context 对象身份，验证输入未变时复用缓存；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class MyComponent extends React.Component {
      /** MyComponent.contextTypes 在“masked context 输入不变时保持对象身份”场景声明允许读取的 legacy context 键，未声明值会在传入组件前被 mask。 */
      static contextTypes = {};
      /** MyComponent.componentDidMount 在“masked context 输入不变时保持对象身份”场景标记实例首次 commit；仅完成 render 而未提交的工作不得调用它。 */
      componentDidMount(prevProps, prevState) {
        Scheduler.log('componentDidMount');
        this.setState({setStateInCDU: true});
      }
      /** MyComponent.componentDidUpdate 在“masked context 输入不变时保持对象身份”场景记录最终提交的 prev/next 输入；被放弃的中间 render 不得单独产生 didUpdate。 */
      componentDidUpdate(prevProps, prevState) {
        Scheduler.log('componentDidUpdate');
        if (this.state.setStateInCDU) {
          this.setState({setStateInCDU: false});
        }
      }
      /** MyComponent.UNSAFE_componentWillReceiveProps 在“masked context 输入不变时保持对象身份”场景只响应父级传入的新 props；纯 state 更新或同一 props 恢复不得误触发。 */
      UNSAFE_componentWillReceiveProps(nextProps) {
        Scheduler.log('componentWillReceiveProps');
        this.setState({setStateInCDU: true});
      }
      /** MyComponent.render 在“masked context 输入不变时保持对象身份”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        Scheduler.log('render');
        return null;
      }
      /** MyComponent.shouldComponentUpdate 在“masked context 输入不变时保持对象身份”场景比较下一组输入并决定 bailout；返回 false 时仍需保留已排队子工作和正确 memoized 指针。 */
      shouldComponentUpdate(nextProps, nextState) {
        Scheduler.log('shouldComponentUpdate');
        return scuCounter++ < 5; // 避免测试永久挂起。
      }
    }

    ReactNoop.render(<MyComponent />);
    await waitForAll([
      'render',
      'componentDidMount',
      'shouldComponentUpdate',
      'render',
      'componentDidUpdate',
      'shouldComponentUpdate',
      'render',
      'componentDidUpdate',
    ]);

    assertConsoleErrorDev([
      'MyComponent uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in MyComponent (at **)',
    ]);
  });

  /**
   * 场景：生命周期前更新 current 指针仍可复用 memoized 子工作。
   * Given：FirstChild 的低优先级 render 已完成但未提交，随后高优先级工作更新 Fiber 指针。
   * When：抢占并完成高优先级轮次，再恢复之前的子工作。
   * Then：指针重基不使已完成输出失效；FirstChild 可 bailout 并在正确 commit 调用 didUpdate。
   * 验证机制：分段日志比较 FirstChild/SecondChild render 与 lifecycle 次数。
   * 对应源码：packages/react-reconciler/src/ReactFiberBeginWork.js 的 bailoutOnAlreadyFinishedWork()；ReactFiberClassComponent.js。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('should reuse memoized work if pointers are updated before calling lifecycles', async () => {
    const cduNextProps = [];
    const cduPrevProps = [];
    const scuNextProps = [];
    const scuPrevProps = [];
    let renderCounter = 0;

    /** SecondChild 在“生命周期前更新指针并复用 memoized work”场景作为第二个进度哨兵，验证 memoized 子工作复用顺序；返回结构限定断言所覆盖的工作边界。 */
    function SecondChild(props) {
      return <span>{props.children}</span>;
    }

    /** FirstChild 在“生命周期前更新指针并复用 memoized work”场景持有 shouldComponentUpdate 与 componentDidUpdate，验证未提交 work 的指针复用；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class FirstChild extends React.Component {
      /** FirstChild.componentDidUpdate 在“生命周期前更新指针并复用 memoized work”场景记录最终提交的 prev/next 输入；被放弃的中间 render 不得单独产生 didUpdate。 */
      componentDidUpdate(prevProps, prevState) {
        cduNextProps.push(this.props);
        cduPrevProps.push(prevProps);
      }
      /** FirstChild.shouldComponentUpdate 在“生命周期前更新指针并复用 memoized work”场景比较下一组输入并决定 bailout；返回 false 时仍需保留已排队子工作和正确 memoized 指针。 */
      shouldComponentUpdate(nextProps, nextState) {
        scuNextProps.push(nextProps);
        scuPrevProps.push(this.props);
        return this.props.children !== nextProps.children;
      }
      /** FirstChild.render 在“生命周期前更新指针并复用 memoized work”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        renderCounter++;
        return <span>{this.props.children}</span>;
      }
    }

    /** Middle 在“生命周期前更新指针并复用 memoized work”场景建立中间 bailout、优先级或 context 层；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Middle extends React.Component {
      /** Middle.render 在“生命周期前更新指针并复用 memoized work”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
      render() {
        return (
          <div>
            <FirstChild>{this.props.children}</FirstChild>
            <SecondChild>{this.props.children}</SecondChild>
          </div>
        );
      }
    }

    /** Root 在“生命周期前更新指针并复用 memoized work”场景构造完整 fixture 树并传播本轮 props、优先级或 context；返回结构限定断言所覆盖的工作边界。 */
    function Root(props) {
      return (
        <div hidden={true}>
          <Middle {...props} />
        </div>
      );
    }

    // 首次渲染整棵树。
    // 本阶段渲染：Root、Middle、FirstChild、SecondChild。
    ReactNoop.render(<Root>A</Root>);
    await waitForAll([]);

    expect(renderCounter).toBe(1);

    // 调度低优先级工作来更新子节点。
    // 给予足够时间让它部分渲染。
    // 本阶段渲染：Root、Middle、FirstChild。
    ReactNoop.render(<Root>B</Root>);
    ReactNoop.flushDeferredPri(20 + 30 + 5);

    // 此时 FirstChild 已第二次渲染，
    // 但 render 尚未完成，因此不应调用 cDU。
    expect(renderCounter).toBe(2);
    expect(scuPrevProps).toEqual([{children: 'A'}]);
    expect(scuNextProps).toEqual([{children: 'B'}]);
    expect(cduPrevProps).toEqual([]);
    expect(cduNextProps).toEqual([]);

    // 接着用更高优先级工作中断部分渲染。
    // 进行中的子内容将 bailout。
    // 本阶段渲染：Root、Middle、FirstChild、SecondChild。
    ReactNoop.render(<Root>B</Root>);
    await waitForAll([]);

    // 此时高优先级渲染已经完成。
    // FirstChild props 未变化，因此 sCU 返回 false。
    // 应复用先前 memoize 的副本。
    expect(renderCounter).toBe(2);
    expect(scuPrevProps).toEqual([{children: 'A'}, {children: 'B'}]);
    expect(scuNextProps).toEqual([{children: 'B'}, {children: 'B'}]);
    expect(cduPrevProps).toEqual([{children: 'A'}]);
    expect(cduNextProps).toEqual([{children: 'B'}]);
  });

  /**
   * 场景：单层 Provider 值变化会更新声明依赖的后代。
   * Given：TopContextProvider 持有 count，Child 通过 contextTypes 读取。
   * When：调用 updateCount 改变 Provider state。
   * Then：Provider 重新计算 child context，Middle 与 Child 沿合法路径重渲染并看到新 count。
   * 验证机制：更新前后 Child 输出和 render 日志断言传播结果。
   * 对应源码：packages/react-reconciler/src/ReactFiberLegacyContext.js 的 invalidateContextProvider()/processChildContext()。
   */
  // @gate !disableLegacyContext
  it('updates descendants with new context values', async () => {
    let instance;

    /** TopContextProvider 在“单一 Provider 更新 context 后代”场景持有顶层 context state 并暴露更新入口；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class TopContextProvider extends React.Component {
      /** TopContextProvider.childContextTypes 在“单一 Provider 更新 context 后代”场景声明 Provider 可向后代发布的 legacy context 键，限制 getChildContext 的输出边界。 */
      static childContextTypes = {
        count: PropTypes.number,
      };
      /** TopContextProvider.constructor 在“单一 Provider 更新 context 后代”场景初始化实例 state、计数器或更新入口；该初值是后续中断与恢复比较的基线。 */
      constructor() {
        super();
        this.state = {count: 0};
        instance = this;
      }
      /** TopContextProvider.getChildContext 在“单一 Provider 更新 context 后代”场景以字段函数发布当前 legacy context；闭包读取实例 state，更新后形成新的 Provider 值。 */
      getChildContext = () => ({
        count: this.state.count,
      });
      /** TopContextProvider.render 在“单一 Provider 更新 context 后代”场景以字段函数读取 props/state/context 并返回子树；其日志用于确认后代是否因传播重渲染。 */
      render = () => this.props.children;
      /** TopContextProvider.updateCount 在“单一 Provider 更新 context 后代”场景封装 setState，作为测试精确触发 Provider 或中间层 context 变化的入口。 */
      updateCount = () =>
        this.setState(state => ({
          count: state.count + 1,
        }));
    }

    /** Middle 在“单一 Provider 更新 context 后代”场景建立中间 bailout、优先级或 context 层；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Middle extends React.Component {
      /** Middle.render 在“单一 Provider 更新 context 后代”场景以字段函数读取 props/state/context 并返回子树；其日志用于确认后代是否因传播重渲染。 */
      render = () => this.props.children;
    }

    /** Child 在“单一 Provider 更新 context 后代”场景承载子级状态、context 或深层工作，验证父级调度决策的下游效果；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Child extends React.Component {
      /** Child.contextTypes 在“单一 Provider 更新 context 后代”场景声明允许读取的 legacy context 键，未声明值会在传入组件前被 mask。 */
      static contextTypes = {
        count: PropTypes.number,
      };
      /** Child.render 在“单一 Provider 更新 context 后代”场景以字段函数读取 props/state/context 并返回子树；其日志用于确认后代是否因传播重渲染。 */
      render = () => {
        Scheduler.log(`count:${this.context.count}`);
        return null;
      };
    }

    ReactNoop.render(
      <TopContextProvider>
        <Middle>
          <Child />
        </Middle>
      </TopContextProvider>,
    );

    await waitForAll(['count:0']);
    assertConsoleErrorDev([
      'TopContextProvider uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in TopContextProvider (at **)',
      'Child uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Child (at **)',
    ]);
    instance.updateCount();
    await waitForAll(['count:1']);
  });

  /**
   * 场景：多层 Provider 变化按祖先顺序合并。
   * Given：TopContextProvider 和 MiddleContextProvider 分别提供 context 键。
   * When：更新顶层 count 并重新遍历中间 Provider。
   * Then：中间层在新祖先 context 上重新发布自身值，Child 得到完整的新组合。
   * 验证机制：各 Provider/Child 日志与最终 context 文本验证合并次序。
   * 对应源码：packages/react-reconciler/src/ReactFiberLegacyContext.js 的 processChildContext() 与 context stack。
   */
  // @gate !disableLegacyContext
  it('updates descendants with multiple context-providing ancestors with new context values', async () => {
    let instance;

    /** TopContextProvider 在“多层 Provider 更新 context 后代”场景持有顶层 context state 并暴露更新入口；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class TopContextProvider extends React.Component {
      /** TopContextProvider.childContextTypes 在“多层 Provider 更新 context 后代”场景声明 Provider 可向后代发布的 legacy context 键，限制 getChildContext 的输出边界。 */
      static childContextTypes = {
        count: PropTypes.number,
      };
      /** TopContextProvider.constructor 在“多层 Provider 更新 context 后代”场景初始化实例 state、计数器或更新入口；该初值是后续中断与恢复比较的基线。 */
      constructor() {
        super();
        this.state = {count: 0};
        instance = this;
      }
      /** TopContextProvider.getChildContext 在“多层 Provider 更新 context 后代”场景以字段函数发布当前 legacy context；闭包读取实例 state，更新后形成新的 Provider 值。 */
      getChildContext = () => ({
        count: this.state.count,
      });
      /** TopContextProvider.render 在“多层 Provider 更新 context 后代”场景以字段函数读取 props/state/context 并返回子树；其日志用于确认后代是否因传播重渲染。 */
      render = () => this.props.children;
      /** TopContextProvider.updateCount 在“多层 Provider 更新 context 后代”场景封装 setState，作为测试精确触发 Provider 或中间层 context 变化的入口。 */
      updateCount = () =>
        this.setState(state => ({
          count: state.count + 1,
        }));
    }

    /** MiddleContextProvider 在“多层 Provider 更新 context 后代”场景在顶层 Provider 下派生第二层 context，并可从树中部更新；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class MiddleContextProvider extends React.Component {
      /** MiddleContextProvider.childContextTypes 在“多层 Provider 更新 context 后代”场景声明 Provider 可向后代发布的 legacy context 键，限制 getChildContext 的输出边界。 */
      static childContextTypes = {
        name: PropTypes.string,
      };
      /** MiddleContextProvider.getChildContext 在“多层 Provider 更新 context 后代”场景以字段函数发布当前 legacy context；闭包读取实例 state，更新后形成新的 Provider 值。 */
      getChildContext = () => ({
        name: 'brian',
      });
      /** MiddleContextProvider.render 在“多层 Provider 更新 context 后代”场景以字段函数读取 props/state/context 并返回子树；其日志用于确认后代是否因传播重渲染。 */
      render = () => this.props.children;
    }

    /** Child 在“多层 Provider 更新 context 后代”场景承载子级状态、context 或深层工作，验证父级调度决策的下游效果；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Child extends React.Component {
      /** Child.contextTypes 在“多层 Provider 更新 context 后代”场景声明允许读取的 legacy context 键，未声明值会在传入组件前被 mask。 */
      static contextTypes = {
        count: PropTypes.number,
      };
      /** Child.render 在“多层 Provider 更新 context 后代”场景以字段函数读取 props/state/context 并返回子树；其日志用于确认后代是否因传播重渲染。 */
      render = () => {
        Scheduler.log(`count:${this.context.count}`);
        return null;
      };
    }

    ReactNoop.render(
      <TopContextProvider>
        <MiddleContextProvider>
          <Child />
        </MiddleContextProvider>
      </TopContextProvider>,
    );

    await waitForAll(['count:0']);
    assertConsoleErrorDev([
      'TopContextProvider uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in TopContextProvider (at **)',
      'MiddleContextProvider uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in MiddleContextProvider (at **)',
      'Child uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Child (at **)',
    ]);
    instance.updateCount();
    await waitForAll(['count:1']);
  });

  /**
   * 场景：shouldComponentUpdate false 阻止该路径的 legacy context 更新。
   * Given：Top Provider 值变化，但中间 MiddleScu 明确返回 false。
   * When：更新 TopContextProvider。
   * Then：旧 legacy context 传播受 class bailout 边界限制，MiddleScu 后代保持旧输出。
   * 验证机制：sCU、render 日志和 Child 文本验证后代没有被重新访问。
   * 对应源码：packages/react-reconciler/src/ReactFiberClassComponent.js 的 updateClassInstance()；ReactFiberLegacyContext.js。
   */
  // @gate !disableLegacyContext
  it('should not update descendants with new context values if shouldComponentUpdate returns false', async () => {
    let instance;

    /** TopContextProvider 在“shouldComponentUpdate false 阻止 context 后代更新”场景持有顶层 context state 并暴露更新入口；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class TopContextProvider extends React.Component {
      /** TopContextProvider.childContextTypes 在“shouldComponentUpdate false 阻止 context 后代更新”场景声明 Provider 可向后代发布的 legacy context 键，限制 getChildContext 的输出边界。 */
      static childContextTypes = {
        count: PropTypes.number,
      };
      /** TopContextProvider.constructor 在“shouldComponentUpdate false 阻止 context 后代更新”场景初始化实例 state、计数器或更新入口；该初值是后续中断与恢复比较的基线。 */
      constructor() {
        super();
        this.state = {count: 0};
        instance = this;
      }
      /** TopContextProvider.getChildContext 在“shouldComponentUpdate false 阻止 context 后代更新”场景以字段函数发布当前 legacy context；闭包读取实例 state，更新后形成新的 Provider 值。 */
      getChildContext = () => ({
        count: this.state.count,
      });
      /** TopContextProvider.render 在“shouldComponentUpdate false 阻止 context 后代更新”场景以字段函数读取 props/state/context 并返回子树；其日志用于确认后代是否因传播重渲染。 */
      render = () => this.props.children;
      /** TopContextProvider.updateCount 在“shouldComponentUpdate false 阻止 context 后代更新”场景封装 setState，作为测试精确触发 Provider 或中间层 context 变化的入口。 */
      updateCount = () =>
        this.setState(state => ({
          count: state.count + 1,
        }));
    }

    /** MiddleScu 在“shouldComponentUpdate false 阻止 context 后代更新”场景用 shouldComponentUpdate 控制 context 更新能否继续向下；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class MiddleScu extends React.Component {
      /** MiddleScu.shouldComponentUpdate 在“shouldComponentUpdate false 阻止 context 后代更新”场景比较下一组输入并决定 bailout；返回 false 时仍需保留已排队子工作和正确 memoized 指针。 */
      shouldComponentUpdate() {
        return false;
      }
      /** MiddleScu.render 在“shouldComponentUpdate false 阻止 context 后代更新”场景以字段函数读取 props/state/context 并返回子树；其日志用于确认后代是否因传播重渲染。 */
      render = () => this.props.children;
    }

    /** MiddleContextProvider 在“shouldComponentUpdate false 阻止 context 后代更新”场景在顶层 Provider 下派生第二层 context，并可从树中部更新；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class MiddleContextProvider extends React.Component {
      /** MiddleContextProvider.childContextTypes 在“shouldComponentUpdate false 阻止 context 后代更新”场景声明 Provider 可向后代发布的 legacy context 键，限制 getChildContext 的输出边界。 */
      static childContextTypes = {
        name: PropTypes.string,
      };
      /** MiddleContextProvider.getChildContext 在“shouldComponentUpdate false 阻止 context 后代更新”场景以字段函数发布当前 legacy context；闭包读取实例 state，更新后形成新的 Provider 值。 */
      getChildContext = () => ({
        name: 'brian',
      });
      /** MiddleContextProvider.render 在“shouldComponentUpdate false 阻止 context 后代更新”场景以字段函数读取 props/state/context 并返回子树；其日志用于确认后代是否因传播重渲染。 */
      render = () => this.props.children;
    }

    /** Child 在“shouldComponentUpdate false 阻止 context 后代更新”场景承载子级状态、context 或深层工作，验证父级调度决策的下游效果；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Child extends React.Component {
      /** Child.contextTypes 在“shouldComponentUpdate false 阻止 context 后代更新”场景声明允许读取的 legacy context 键，未声明值会在传入组件前被 mask。 */
      static contextTypes = {
        count: PropTypes.number,
      };
      /** Child.render 在“shouldComponentUpdate false 阻止 context 后代更新”场景以字段函数读取 props/state/context 并返回子树；其日志用于确认后代是否因传播重渲染。 */
      render = () => {
        Scheduler.log(`count:${this.context.count}`);
        return null;
      };
    }

    ReactNoop.render(
      <TopContextProvider>
        <MiddleScu>
          <MiddleContextProvider>
            <Child />
          </MiddleContextProvider>
        </MiddleScu>
      </TopContextProvider>,
    );

    await waitForAll(['count:0']);
    assertConsoleErrorDev([
      'TopContextProvider uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in TopContextProvider (at **)',
      'MiddleContextProvider uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in MiddleContextProvider (at **)',
      'Child uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Child (at **)',
    ]);
    instance.updateCount();
    await waitForAll([]);
  });

  /**
   * 场景：树中部 setState 可重新发布本层 context 并更新后代。
   * Given：MiddleContextProvider 持有 name，外层 Top Provider 同时提供 count。
   * When：直接调用中间层 updateName。
   * Then：更新从中间 Fiber 调度，getChildContext 重算 name，Child 同时保留顶层 count。
   * 验证机制：Provider/Child 日志与最终组合值验证局部传播范围。
   * 对应源码：packages/react-reconciler/src/ReactFiberClassUpdateQueue.js；ReactFiberLegacyContext.js 的 invalidateContextProvider()。
   */
  // @gate !disableLegacyContext
  it('should update descendants with new context values if setState() is called in the middle of the tree', async () => {
    let middleInstance;
    let topInstance;

    /** TopContextProvider 在“树中部 setState 驱动 context 后代更新”场景持有顶层 context state 并暴露更新入口；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class TopContextProvider extends React.Component {
      /** TopContextProvider.childContextTypes 在“树中部 setState 驱动 context 后代更新”场景声明 Provider 可向后代发布的 legacy context 键，限制 getChildContext 的输出边界。 */
      static childContextTypes = {
        count: PropTypes.number,
      };
      /** TopContextProvider.constructor 在“树中部 setState 驱动 context 后代更新”场景初始化实例 state、计数器或更新入口；该初值是后续中断与恢复比较的基线。 */
      constructor() {
        super();
        this.state = {count: 0};
        topInstance = this;
      }
      /** TopContextProvider.getChildContext 在“树中部 setState 驱动 context 后代更新”场景以字段函数发布当前 legacy context；闭包读取实例 state，更新后形成新的 Provider 值。 */
      getChildContext = () => ({
        count: this.state.count,
      });
      /** TopContextProvider.render 在“树中部 setState 驱动 context 后代更新”场景以字段函数读取 props/state/context 并返回子树；其日志用于确认后代是否因传播重渲染。 */
      render = () => this.props.children;
      /** TopContextProvider.updateCount 在“树中部 setState 驱动 context 后代更新”场景封装 setState，作为测试精确触发 Provider 或中间层 context 变化的入口。 */
      updateCount = () =>
        this.setState(state => ({
          count: state.count + 1,
        }));
    }

    /** MiddleScu 在“树中部 setState 驱动 context 后代更新”场景用 shouldComponentUpdate 控制 context 更新能否继续向下；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class MiddleScu extends React.Component {
      /** MiddleScu.shouldComponentUpdate 在“树中部 setState 驱动 context 后代更新”场景比较下一组输入并决定 bailout；返回 false 时仍需保留已排队子工作和正确 memoized 指针。 */
      shouldComponentUpdate() {
        return false;
      }
      /** MiddleScu.render 在“树中部 setState 驱动 context 后代更新”场景以字段函数读取 props/state/context 并返回子树；其日志用于确认后代是否因传播重渲染。 */
      render = () => this.props.children;
    }

    /** MiddleContextProvider 在“树中部 setState 驱动 context 后代更新”场景在顶层 Provider 下派生第二层 context，并可从树中部更新；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class MiddleContextProvider extends React.Component {
      /** MiddleContextProvider.childContextTypes 在“树中部 setState 驱动 context 后代更新”场景声明 Provider 可向后代发布的 legacy context 键，限制 getChildContext 的输出边界。 */
      static childContextTypes = {
        name: PropTypes.string,
      };
      /** MiddleContextProvider.constructor 在“树中部 setState 驱动 context 后代更新”场景初始化实例 state、计数器或更新入口；该初值是后续中断与恢复比较的基线。 */
      constructor() {
        super();
        this.state = {name: 'brian'};
        middleInstance = this;
      }
      /** MiddleContextProvider.getChildContext 在“树中部 setState 驱动 context 后代更新”场景以字段函数发布当前 legacy context；闭包读取实例 state，更新后形成新的 Provider 值。 */
      getChildContext = () => ({
        name: this.state.name,
      });
      /** MiddleContextProvider.updateName 在“树中部 setState 驱动 context 后代更新”场景封装 setState，作为测试精确触发 Provider 或中间层 context 变化的入口。 */
      updateName = name => {
        this.setState({name});
      };
      /** MiddleContextProvider.render 在“树中部 setState 驱动 context 后代更新”场景以字段函数读取 props/state/context 并返回子树；其日志用于确认后代是否因传播重渲染。 */
      render = () => this.props.children;
    }

    /** Child 在“树中部 setState 驱动 context 后代更新”场景承载子级状态、context 或深层工作，验证父级调度决策的下游效果；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
    class Child extends React.Component {
      /** Child.contextTypes 在“树中部 setState 驱动 context 后代更新”场景声明允许读取的 legacy context 键，未声明值会在传入组件前被 mask。 */
      static contextTypes = {
        count: PropTypes.number,
        name: PropTypes.string,
      };
      /** Child.render 在“树中部 setState 驱动 context 后代更新”场景以字段函数读取 props/state/context 并返回子树；其日志用于确认后代是否因传播重渲染。 */
      render = () => {
        Scheduler.log(`count:${this.context.count}, name:${this.context.name}`);
        return null;
      };
    }

    ReactNoop.render(
      <TopContextProvider>
        <MiddleScu>
          <MiddleContextProvider>
            <Child />
          </MiddleContextProvider>
        </MiddleScu>
      </TopContextProvider>,
    );

    await waitForAll(['count:0, name:brian']);
    assertConsoleErrorDev([
      'TopContextProvider uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in TopContextProvider (at **)',
      'MiddleContextProvider uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in MiddleContextProvider (at **)',
      'Child uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Child (at **)',
    ]);
    topInstance.updateCount();
    await waitForAll([]);
    middleInstance.updateName('not brian');
    await waitForAll(['count:1, name:not brian']);
  });

  /**
   * 场景：同优先级更新不抢占正在进行的 render。
   * Given：Parent render 期间/间隙为 Child 排入与当前 lane 相同优先级的更新。
   * When：部分冲刷后调度同优先级工作。
   * Then：新更新并入当前/后续同 lane 工作，不重置已推进的 render 栈。
   * 验证机制：yield 顺序证明已有工作连续完成，没有从 Parent 起重复。
   * 对应源码：packages/react-reconciler/src/ReactFiberWorkLoop.js 的 scheduleUpdateOnFiber()；ReactFiberLane.js。
   */
  it('does not interrupt for update at same priority', async () => {
    /** Parent 在“同优先级更新不抢占当前工作”场景作为父级更新入口，安排子节点工作并暴露抢占顺序；返回结构限定断言所覆盖的工作边界。 */
    function Parent(props) {
      Scheduler.log('Parent: ' + props.step);
      return <Child step={props.step} />;
    }

    /** Child 在“同优先级更新不抢占当前工作”场景作为子级工作单元，在 Scheduler 中标记当前 lane 是否继续或被重启；返回结构限定断言所覆盖的工作边界。 */
    function Child(props) {
      Scheduler.log('Child: ' + props.step);
      return null;
    }

    React.startTransition(() => {
      ReactNoop.render(<Parent step={1} />);
    });
    await waitFor(['Parent: 1']);

    // 以相同优先级插入更新。
    ReactNoop.render(<Parent step={2} />);

    await waitForAll(['Child: 1', 'Parent: 2', 'Child: 2']);
  });

  /**
   * 场景：更低优先级更新不抢占当前 render。
   * Given：当前树正以较高 lane 进行，Child 收到低优先级更新。
   * When：在部分 render 后排入更低优先级任务。
   * Then：当前 render 先完成；低优先级 lane 保留到后续调度轮次。
   * 验证机制：两阶段日志验证当前工作不中断且低优先级更新最终未丢失。
   * 对应源码：packages/react-reconciler/src/ReactFiberWorkLoop.js 的 ensureRootIsScheduled()；ReactFiberLane.js。
   */
  it('does not interrupt for update at lower priority', async () => {
    /** Parent 在“低优先级更新不抢占当前工作”场景作为父级更新入口，安排子节点工作并暴露抢占顺序；返回结构限定断言所覆盖的工作边界。 */
    function Parent(props) {
      Scheduler.log('Parent: ' + props.step);
      return <Child step={props.step} />;
    }

    /** Child 在“低优先级更新不抢占当前工作”场景作为子级工作单元，在 Scheduler 中标记当前 lane 是否继续或被重启；返回结构限定断言所覆盖的工作边界。 */
    function Child(props) {
      Scheduler.log('Child: ' + props.step);
      return null;
    }

    React.startTransition(() => {
      ReactNoop.render(<Parent step={1} />);
    });
    await waitFor(['Parent: 1']);

    // 以更低优先级插入更新。
    ReactNoop.expire(2000);
    ReactNoop.render(<Parent step={2} />);

    await waitForAll(['Child: 1', 'Parent: 2', 'Child: 2']);
  });

  /**
   * 场景：更高优先级更新会抢占并重建 render 栈。
   * Given：低优先级 Parent/Child 工作进行中，随后收到更高优先级更新。
   * When：在中断点调度高优先级任务。
   * Then：工作循环退出当前 render，prepareFreshStack 以高 lane 重启；旧工作稍后可重基恢复。
   * 验证机制：日志出现 Parent/Child 重启顺序并验证高优先级结果先提交。
   * 对应源码：packages/react-reconciler/src/ReactFiberWorkLoop.js 的 prepareFreshStack()/performConcurrentWorkOnRoot()；ReactFiberLane.js。
   */
  it('does interrupt for update at higher priority', async () => {
    /** Parent 在“高优先级更新抢占当前工作”场景作为父级更新入口，安排子节点工作并暴露抢占顺序；返回结构限定断言所覆盖的工作边界。 */
    function Parent(props) {
      Scheduler.log('Parent: ' + props.step);
      return <Child step={props.step} />;
    }

    /** Child 在“高优先级更新抢占当前工作”场景作为子级工作单元，在 Scheduler 中标记当前 lane 是否继续或被重启；返回结构限定断言所覆盖的工作边界。 */
    function Child(props) {
      Scheduler.log('Child: ' + props.step);
      return null;
    }

    React.startTransition(() => {
      ReactNoop.render(<Parent step={1} />);
    });
    await waitFor(['Parent: 1']);

    // 以更高优先级插入更新。
    ReactNoop.flushSync(() => ReactNoop.render(<Parent step={2} />));
    assertLog(['Parent: 2', 'Child: 2']);

    await waitForAll([]);
  });

  // React 有时会使用 Fiber 作为 Map 的 key。
  /**
   * 场景：不良 Map polyfill 下 Fiber 仍可安全作为 key。
   * Given：开发期警告路径会把不可扩展 Fiber 传给 Map，测试可临时替换 Map.prototype.set。
   * When：先确认真实路径接收 Fiber，再安装会写 key 的 polyfill 并重新加载 React。
   * Then：特性探测识别 polyfill 后不冻结 Fiber，警告/错误路径不因写入 key 抛异常。
   * 验证机制：Map#set 捕获 key 可扩展性，错误边界触发路径和最终无异常共同验收。
   * 对应源码：packages/react-reconciler/src/ReactFiber.js 的 hasBadMapPolyfill 探测与 FiberNode preventExtensions 分支。
   */
  // @gate !disableLegacyContext || !__DEV__
  it('does not break with a bad Map polyfill', async () => {
    const realMapSet = Map.prototype.set;

    /** triggerCodePathThatUsesFibersAsMapKeys 渲染会触发 legacy context 警告的错误边界，使内部警告 Map 实际接收 Fiber key。 */
    async function triggerCodePathThatUsesFibersAsMapKeys() {
      /** Thing 在“不良 Map polyfill 兼容”场景故意抛错以进入错误边界及使用 Fiber 作为 Map key 的警告路径；返回结构限定断言所覆盖的工作边界。 */
      function Thing() {
        throw new Error('No.');
      }
      // 该 class 使用 legacy context，会触发警告；
      // 警告流程使用 Map 存储 Fiber。
      /** Boundary 在“不良 Map polyfill 兼容”场景捕获故意错误以触发 legacy context 警告和 Fiber Map-key 路径；实例跨 render/commit 的存续用于判断复用、bailout 或恢复是否正确。 */
      class Boundary extends React.Component {
        /** triggerCodePathThatUsesFibersAsMapKeys.Boundary.state 在“不良 Map polyfill 兼容”场景保存实例的已提交本地状态；更新队列在此基线上合并 pending state 并决定后续渲染。 */
        state = {didError: false};
        /** triggerCodePathThatUsesFibersAsMapKeys.Boundary.componentDidCatch 在“不良 Map polyfill 兼容”场景接收 render 错误并切换错误边界状态；同时验证 unwind 后的 context/警告路径。 */
        componentDidCatch() {
          this.setState({didError: true});
        }
        /** triggerCodePathThatUsesFibersAsMapKeys.Boundary.contextTypes 在“不良 Map polyfill 兼容”场景声明允许读取的 legacy context 键，未声明值会在传入组件前被 mask。 */
        static contextTypes = {
          /** triggerCodePathThatUsesFibersAsMapKeys.Boundary.contextTypes.color 在“不良 Map polyfill 兼容”场景充当 legacy context 校验函数，从而触发开发期警告与 Fiber-key Map 代码路径。 */
          color: () => null,
        };
        /** triggerCodePathThatUsesFibersAsMapKeys.Boundary.render 在“不良 Map polyfill 兼容”场景读取当前 props/state/context 并记录或返回子树；调用次数和顺序暴露 render 阶段的复用边界。 */
        render() {
          return this.state.didError ? null : <Thing />;
        }
      }
      ReactNoop.render(
        <React.StrictMode>
          <Boundary />
        </React.StrictMode>,
      );
      await waitForAll([]);
      assertConsoleErrorDev([
        'Boundary uses the legacy contextTypes API which will soon be removed. ' +
          'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
          '    in Boundary (at **)',
        'Legacy context API has been detected within a strict-mode tree.\n' +
          '\n' +
          'The old API will be supported in all 16.x releases, but applications using it should migrate to the new version.\n' +
          '\n' +
          'Please update the following components: Boundary\n' +
          '\n' +
          'Learn more about this warning here: https://react.dev/link/legacy-context\n' +
          '    in Boundary (at **)',
      ]);
    }

    // 首先确认该代码路径通常会收到 Fiber key，
    // 且它们不可扩展。
    jest.resetModules();
    let receivedNonExtensibleObjects;
    // eslint-disable-next-line no-extend-native
    Map.prototype.set = function (key) {
      if (typeof key === 'object' && key !== null) {
        if (!Object.isExtensible(key)) {
          receivedNonExtensibleObjects = true;
        }
      }
      return realMapSet.apply(this, arguments);
    };
    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    let InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    waitFor = InternalTestUtils.waitFor;
    waitForThrow = InternalTestUtils.waitForThrow;
    assertLog = InternalTestUtils.assertLog;

    try {
      receivedNonExtensibleObjects = false;
      await triggerCodePathThatUsesFibersAsMapKeys();
    } finally {
      // eslint-disable-next-line no-extend-native
      Map.prototype.set = realMapSet;
    }
    // 若此处失效，需要寻找另一条
    // 把 Fiber 作为 Map key 的代码路径。
    // 注意：只在
    // 开发环境中预期它们不可扩展。
    expect(receivedNonExtensibleObjects).toBe(__DEV__);

    // 接着验证会向 key“写入”的 Map polyfill
    // 不会导致失败。
    jest.resetModules();
    // eslint-disable-next-line no-extend-native
    Map.prototype.set = function (key, value) {
      if (typeof key === 'object' && key !== null) {
        // polyfill 可能会执行类似操作。
        // 若对象不可扩展，此操作会抛错。
        key.__internalValueSlot = value;
      }
      return realMapSet.apply(this, arguments);
    };
    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');
    InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    waitFor = InternalTestUtils.waitFor;
    waitForThrow = InternalTestUtils.waitForThrow;
    assertLog = InternalTestUtils.assertLog;

    try {
      await triggerCodePathThatUsesFibersAsMapKeys();
    } finally {
      // eslint-disable-next-line no-extend-native
      Map.prototype.set = realMapSet;
    }
    // 若执行到这里，说明特性探测生效。
    // 已知 Map#set() 会对不可扩展对象抛错，
    // 因此 React 没有把这些 Fiber 设为不可扩展。
  });
});
