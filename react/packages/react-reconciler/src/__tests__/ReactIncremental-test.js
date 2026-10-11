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
   * 空根渲染 Foo→Bar→div(Hello World)，两组件均不写 Scheduler 日志；waitForAll([]) 确认工作完成且没有日志，本例没有宿主树断言。
   */
  it('should render a simple component', async () => {
    /** Bar 在“简单同步组件渲染”场景返回固定宿主 div，作为无状态、无 yield 的最小叶节点基线。 */
    function Bar() {
      return <div>Hello World</div>;
    }

    /** 返回 Bar 并传入 isBar，建立无 Scheduler 日志的最小组合组件。 */
    function Foo() {
      return <Bar isBar={true} />;
    }

    ReactNoop.render(<Foo />);
    await waitForAll([]);
  });

  /**
   * transition 渲染 Foo 返回 key a/b 的两个 Bar；waitFor 只消费 Foo 后暂停，再 waitForAll 要求 Bar、Bar、根完成回调依次出现，验证同一工作栈从子节点继续。这里按 mock yield 数量切片，没有推进时间来模拟真实 deadline。
   */
  it('should render a simple component, in steps if needed', async () => {
    /** 每次 render 记录 Bar，再返回 span/div 包装；两个 key 对应的实例形成恢复后的两个叶工作单元。 */
    function Bar() {
      Scheduler.log('Bar');
      return (
        <span>
          <div>Hello World</div>
        </span>
      );
    }

    /** 记录 Foo 并返回 key 为 a/b 的两个 Bar，使 waitFor 可停在父 render 后、子 render 前。 */
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
   * 初始 text=foo 的 Foo 保存 header/footer 元素对象，Content 随 text 创建；连续入队两次 text=bar 根更新后，日志只重复 Foo/Content，并按入队顺序执行两个根回调。Header/Footer 被复用；本例没有 JSX 终态断言。
   */
  it('updates a previous render', async () => {
    /** 记录 Header 并返回固定 h1；外部保存同一个元素对象，后续更新不重复执行。 */
    function Header() {
      Scheduler.log('Header');
      return <h1>Hi</h1>;
    }

    /** 记录 Content 并把变化的 props.children 写入 div，成为两轮中实际重渲染的分支。 */
    function Content(props) {
      Scheduler.log('Content');
      return <div>{props.children}</div>;
    }

    /** 记录 Footer 并返回固定 footer；和 Header 一样使用稳定元素引用。 */
    function Footer() {
      Scheduler.log('Footer');
      return <footer>Bye</footer>;
    }

    const header = <Header />;
    const footer = <Footer />;

    /** 记录 Foo，将稳定 header/footer 元素与随 text 改变的 Content 组合，隔离 bailout 与更新分支。 */
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

    // 更新会复用稳定 Header/Footer 元素；Content 的 text 已变化，所以仍重渲染。
    await waitForAll([
      'Foo',
      'Content',
      'firstRenderCallbackCalled',
      'secondRenderCallbackCalled',
    ]);
  });

  /**
   * 先提交 foo，再将 transition 的 bar 渲染到 Foo/第一个 Bar；flushSync render(null) 清空根，随后另一个 transition 渲染 baz。新轮先 Foo/Bar 再剩余 Bar，验证旧 bar 尾部被放弃，而非两种文本拼成最终树。
   */
  it('can cancel partially rendered work and restart', async () => {
    /** 记录 Bar 并输出 children，作为 transition 部分渲染的进度点。 */
    function Bar(props) {
      Scheduler.log('Bar');
      return <div>{props.children}</div>;
    }

    /** 记录 Foo 并创建两个 Bar，供先 render bar、flushSync 清空、再 render baz 的重开序列使用。 */
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
   * Foo 初始 text/text2 都为 foo；第一个 transition updater 将 text 改 bar，执行到 updater 日志后被同步根更新打断。第二个 transition 改 text2=baz，恢复时 updater1 重放、updater2 执行，提交回调各一次，实例终态为 {bar,baz}。
   */
  it('should call callbacks even if updates are aborted', async () => {
    let inst;

    /** 持有 text/text2 两个状态字段，验证被同步根更新打断的两个 transition updater 仍各执行一次提交回调。 */
    class Foo extends React.Component {
      /** 初始化两字段为 foo 并暴露实例，让测试在 render 切片间直接入队更新。 */
      constructor(props) {
        super(props);
        this.state = {
          text: 'foo',
          text2: 'foo',
        };
        inst = this;
      }
      /** 把 text 和 text2 分别放进两个 div；render 不写日志，进度由 updater 日志观察。 */
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
   * foo 初次工作先记录两个可见 Bar 再两个隐藏 Middle；text=bar 后 waitFor 再次只推进 Foo/两个 Bar，后续 waitForAll 继续两个 Middle，验证隐藏工作不会因分段冲刷被丢弃。只有日志断言，没有可见内容先提交的宿主快照。
   */
  // @gate enableLegacyHidden
  it('can deprioritize unfinished work and resume it later', async () => {
    /** 记录可见 Bar 并输出 children，和隐藏 Middle 的后续工作区分。 */
    function Bar(props) {
      Scheduler.log('Bar');
      return <div>{props.children}</div>;
    }

    /** 记录隐藏子树的 Middle 并输出 children，证明它在可见 Bar 后仍可恢复。 */
    function Middle(props) {
      Scheduler.log('Middle');
      return <span>{props.children}</span>;
    }

    /** 交错组合两个 Bar 与两个 LegacyHiddenDiv；第二个隐藏文本固定为 Footer，第一处随 text 更新。 */
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
   * 两次相同 text=foo 的 flushSync 根更新都只记录 Foo/两个可见 Bar；每次随后 waitForAll 才记录两个隐藏 Middle。此顺序验证隐藏工作从同步部分延后但仍保留，不是宿主树完整性断言。
   */
  // @gate enableLegacyHidden
  it('can deprioritize a tree from without dropping work', async () => {
    /** 记录可见 Bar，用同步冲刷日志定位隐藏内容开始前的边界。 */
    function Bar(props) {
      Scheduler.log('Bar');
      return <div>{props.children}</div>;
    }

    /** 记录隐藏 Middle，供同步部分结束后 waitForAll 验证延后工作仍存在。 */
    function Middle(props) {
      Scheduler.log('Middle');
      return <span>{props.children}</span>;
    }

    /** 把两个可见 Bar 与两个隐藏 Middle 交错放入树，验证两轮相同 foo 输入都不丢隐藏工作。 */
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
   * 未执行：it.skip 保留的历史场景。
   * 历史输入固定 middleContent，包含 Tester 与隐藏深层 Middle；初次只推进到 Foo/Bar/Tester/Bar，再改变 text 为 bar。期望稳定子树不重做 Tester，最终只补 Middle 日志；使用旧 flushDeferredPri 接口，本用例跳过。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('can resume work in a subtree even when a parent bails out', async () => {
    /** 记录 Bar 并返回 children，保留历史跳过用例中的可见工作哨兵。 */
    function Bar(props) {
      Scheduler.log('Bar');
      return <div>{props.children}</div>;
    }

    /** 只记录 Tester 并返回空 div，用来定位稳定 middleContent 首次完成的位置。 */
    function Tester() {
      // 该组件仅用于确保 bailout
      // 确实发生在测试预期的位置。
      Scheduler.log('Tester');
      return <div />;
    }

    /** 记录 Middle 并输出 Hi，作为稳定元素子树中待恢复的深层工作。 */
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

    /** 组合更新 text 的两个 Bar 和固定 middleContent，历史期望是恢复时只继续 Middle。 */
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
   * 未执行：it.skip 保留的历史场景。
   * 历史 Content/Tester 的 SCU 固定 false，Middle 留在隐藏深层；在 text foo→bar 的部分冲刷后，期望同一遍历继续为 Bar/Middle/Bar，后续反向更新再被新 bar 更新中断。日志定位中间恢复位置，本用例跳过，不能视为本版通过的调度规则。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('can resume work in a bailed subtree within one pass', async () => {
    /** 记录两侧 Bar，定位历史用例中间 Middle 是否在同一遍历恢复。 */
    function Bar(props) {
      Scheduler.log('Bar');
      return <div>{props.children}</div>;
    }

    /** 始终拒绝更新的哨兵类；首次 render 后历史更新路径不应再产生 Tester 日志。 */
    class Tester extends React.Component {
      /** 固定返回 false，使 Tester 的更新命中 class bailout。 */
      shouldComponentUpdate() {
        return false;
      }
      /** 记录 Tester 并返回空 div，只在挂载或未被 bailout 的路径可见。 */
      render() {
        // 该组件仅用于确保 bailout
        // 确实发生在测试预期的位置。
        Scheduler.log('Tester');
        return <div />;
      }
    }

    /** 记录并输出 Hi，作为 Content bailout 后仍待完成的历史子工作。 */
    function Middle(props) {
      Scheduler.log('Middle');
      return <span>{props.children}</span>;
    }

    // Content 是否应只基于 current bailout，而不是基于 workInProgress？

    /** 首次构造两个子分支，之后拒绝自身 render，测试其后代剩余工作能否恢复。 */
    class Content extends React.Component {
      /** 固定返回 false，跳过 Content 自身更新 render。 */
      shouldComponentUpdate() {
        return false;
      }
      /** 返回 Tester 与隐藏包装下的 Middle；数组 key 使两个分支身份稳定。 */
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

    /** 记录 Foo，并随 text 改变最外层 hidden、Bar 输入与 Content unused，制造历史 bailout/隐藏工作组合。 */
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
   * 未执行：it.skip 保留的历史场景。
   * 历史 Parent 的 SCU 固定 false，Foo 首次挂载记录构造 prop=foo 和 render 后暂停；随后对暴露的 foo 实例 setState。期望只继续 Foo/Bar，检查恢复时传入 props 可用；无宿主输出和实例计数断言，本用例跳过。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('can resume mounting a class component', async () => {
    let foo;
    /** 历史未执行夹具：拒绝父 render 更新，保留未提交 Foo 挂载的恢复路径。 */
    class Parent extends React.Component {
      /** 固定拒绝 Parent 更新，避免父重新创建 Foo 输入。 */
      shouldComponentUpdate() {
        return false;
      }
      /** 将当前 prop 传入 Foo，建立挂载中的子类实例。 */
      render() {
        return <Foo prop={this.props.prop} />;
      }
    }

    /** 历史未执行夹具：构造日志和外部 foo 引用定位部分挂载中 props 的可用性。 */
    class Foo extends React.Component {
      /** 把 props 传给父构造器并记录 props.prop，复现恢复时 props 错误变为 null 的历史回归。 */
      constructor(props) {
        super(props);
        // 该测试源于 www 中恢复时 props 变为 null 的缺陷。
        Scheduler.log('Foo constructor: ' + props.prop);
      }
      /** 暴露 foo 实例并记录 Foo，返回 Bar 留下后续工作。 */
      render() {
        foo = this;
        Scheduler.log('Foo');
        return <Bar />;
      }
    }

    /** 记录 Bar 并返回空 div，作为 Foo 后的恢复进度点。 */
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
   * 未执行：it.skip 保留的历史场景。
   * 历史 Parent 保持子输入，Foo 记录 ctor/willMount/render 与挂载提交；首次挂载已推进到 Bar 但未提交，再给 foo setState。期望构造计数仍为一，恢复重入 willMount/render，最后仅 didMount；这是实例复用的历史断言，本用例跳过。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('reuses the same instance when resuming a class instance', async () => {
    let foo;
    /** 历史未执行夹具：固定 Parent bailout，验证 Foo 的 constructorCount 在恢复后仍为一。 */
    class Parent extends React.Component {
      /** 拒绝父更新，维持既有 Foo 输入的身份。 */
      shouldComponentUpdate() {
        return false;
      }
      /** 将 Parent.prop 透传给 Foo，建立部分挂载子树。 */
      render() {
        return <Foo prop={this.props.prop} />;
      }
    }

    let constructorCount = 0;
    /** 记录构造和各生命周期，配合 constructorCount 区分恢复同一实例与重新构造。 */
    class Foo extends React.Component {
      /** 记录传入 prop 并增加 constructorCount，供最终实例复用断言。 */
      constructor(props) {
        super(props);
        // 该测试源于 www 中恢复时 props 变为 null 的缺陷。
        Scheduler.log('constructor: ' + props.prop);
        constructorCount++;
      }
      /** 记录挂载 render 阶段的 prop；历史中断恢复预期会重入此方法。 */
      UNSAFE_componentWillMount() {
        Scheduler.log('componentWillMount: ' + this.props.prop);
      }
      /** 记录收到新 props 的生命周期；本例恢复只有 state 更新，预期日志中没有此项。 */
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
      /** 记录更新提交阶段 prop；首次挂载恢复期望调用 didMount 而非此方法。 */
      componentDidUpdate() {
        Scheduler.log('componentDidUpdate: ' + this.props.prop);
      }
      /** 暴露实例并记录 render 的 prop，返回 Bar 供测试暂停在完成/提交之间。 */
      render() {
        foo = this;
        Scheduler.log('render: ' + this.props.prop);
        return <Bar />;
      }
    }

    /** 记录 Foo did complete 并返回 div，以子组件进度区分 Foo render 与挂载提交。 */
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
   * 未执行：it.skip 保留的历史场景。
   * 历史 Foo 的两个稳定 step 元素子树分别输出 Hi/Foo/There 与 Hello/-/World，外部 text2 可独立改变；多次旧时间切片与不改隐藏输入的根更新交错。期望最后只记录未完成的 Middle，验证已做子工作复用；本用例跳过。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('can reuse work done after being preempted', async () => {
    /** 记录 Bar 并输出内容，参与两套稳定 step 子树与外部文本更新。 */
    function Bar(props) {
      Scheduler.log('Bar');
      return <div>{props.children}</div>;
    }

    /** 记录 Middle 并输出 children，历史恢复时只有未完成的最后一个 Middle 应再次出现。 */
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

    /** 依据 step 选择稳定 step0 或 middleContent 元素，同时单独更新可见 text2，制造不改变隐藏输入的抢占。 */
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
   * 未执行：it.skip 保留的历史场景。
   * 历史 Child 的 step 更新停在 Child/Grandchild 之后、GreatGrandchild 之前；另一分支 Sibling 的同步 setState 只记录 Sibling。恢复期望仅记录 GreatGrandchild，不重复前两层 begin；本用例跳过。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('can reuse work that began but did not complete, after being preempted', async () => {
    let child;
    let sibling;

    /** 记录最深层 GreatGrandchild，历史切片停在其前，恢复期望只出现此日志。 */
    function GreatGrandchild() {
      Scheduler.log('GreatGrandchild');
      return <div />;
    }

    /** 记录 Grandchild 并返回 GreatGrandchild，形成已 begin 但尚未 complete 的中间层。 */
    function Grandchild() {
      Scheduler.log('Grandchild');
      return <GreatGrandchild />;
    }

    /** 暴露 child 实例，用 step 状态排入低优先级工作，后代输入保持固定。 */
    class Child extends React.Component {
      /** 初始 step 为零；测试以 step=1 制造 class 更新，不改变 Grandchild 元素结构。 */
      state = {step: 0};
      /** 暴露 child、记录 Child 后返回 Grandchild，作为部分 render 的第一个进度点。 */
      render() {
        child = this;
        Scheduler.log('Child');
        return <Grandchild />;
      }
    }

    /** 暴露另一分支实例，供 flushSync 在 Child 工作中间触发无关同步更新。 */
    class Sibling extends React.Component {
      /** 记录 Sibling 并暴露实例，返回空 div，不改变 Child 分支的输入。 */
      render() {
        Scheduler.log('Sibling');
        sibling = this;
        return <div />;
      }
    }

    /** 记录 Parent，返回 div 包裹的 Child 与独立 Sibling；包装层保留历史 bailout 位置。 */
    function Parent() {
      Scheduler.log('Parent');
      return [
        // 这个历史用例保留额外 div，将 Parent 的 bailout 位置
        // 与更深层子节点的恢复位置分开。旧说明使用的
        // progressedPriority/pendingWorkPriority 已不属于当前 Fiber。
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
   * 未执行：it.skip 保留的历史场景。
   * 历史 Content 仅比较 step，Middle 仅比较 children；step 改一的隐藏工作已完成 Content/Middle/Bar，随后只改外部 text 抢占。期望 Content bailout 保留已做工作，恢复仅补最后 Middle；本用例跳过。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('can reuse work if shouldComponentUpdate is false, after being preempted', async () => {
    /** 记录 Bar，作为可见 text 与 Content 内部工作的共同进度哨兵。 */
    function Bar(props) {
      Scheduler.log('Bar');
      return <div>{props.children}</div>;
    }

    /** 只在 children 改变时更新的类，供历史恢复复用已完成叶节点。 */
    class Middle extends React.Component {
      /** 比较前后 children 引用/值，返回不同才允许 Middle render。 */
      shouldComponentUpdate(nextProps) {
        return this.props.children !== nextProps.children;
      }
      /** 记录 Middle 并把当前 children 输出到 span。 */
      render() {
        Scheduler.log('Middle');
        return <span>{this.props.children}</span>;
      }
    }

    /** 只根据 step 决定是否更新，故 text 改变而 step 相同会跳过此层。 */
    class Content extends React.Component {
      /** 比较前后 step，忽略 text 的变化，制造抢占时 Content bailout。 */
      shouldComponentUpdate(nextProps) {
        return this.props.step !== nextProps.step;
      }
      /** 记录 Content，按 step 选择 Hi/Foo/There 或 Hello/-/World 三个叶节点。 */
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

    /** 记录 Foo，分别创建外侧 Bar 与隐藏 Content，便于在不改变 step 时中断隐藏工作。 */
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
   * Foo 的 SCU 使用旧 this.props.step!==1，首次 step=1，更新到2只记录 false，更新到3应记录 true/render。第二轮的成功说明上一次未 render 仍将实例 props 前移至2，不是永久保留首次 props。
   */
  it('memoizes work even if shouldComponentUpdate returns false', async () => {
    /** 用旧 this.props.step 决定是否更新，验证一次拒绝 render 后实例 props 仍前移。 */
    class Foo extends React.Component {
      /** 记录并返回 this.props.step!==1；nextProps 不参与判断，第二次更新使用旧 step=2 才会返回 true。 */
      shouldComponentUpdate(nextProps) {
        // this.props 是 memoized props，因此除首次更新外，
        // 后续每次更新都应返回 true。
        const shouldUpdate = this.props.step !== 1;
        Scheduler.log('shouldComponentUpdate: ' + shouldUpdate);
        return shouldUpdate;
      }
      /** 记录 render 并返回空 div，不依赖 step 文本，断言只观察是否进入 render。 */
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
   * Bar 初始 {a:a} 位于 Foo/div 内，挂载后直接对子实例 setState({b:b})；冲刷后实例为 {a:a,b:b}。组件没有 render 日志，也没有文本变化断言，本例验证非根实例更新和浅合并。
   */
  it('can update in the middle of a tree using setState', async () => {
    let instance;
    /** 保存对象状态并暴露实例，用来验证树中部 setState 的浅合并。 */
    class Bar extends React.Component {
      /** 初始化 a:a 并设置外部 instance，后续添加 b 不依赖根重新 render。 */
      constructor() {
        super();
        this.state = {a: 'a'};
        instance = this;
      }
      /** 只输出 props.children，状态验证直接读取 instance.state，不靠宿主文本。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    /** 用一个宿主 div 包住 Bar，验证更新可以从非根 class 实例发起。 */
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
   * Bar 初始 {a:a}，冲刷前连续入队对象更新 b:b、c:c、d:d；一次 waitForAll 后 state 精确为 {a,b,c,d}，验证队列逐条浅合并而不丢旧键。
   */
  it('can queue multiple state updates', async () => {
    let instance;
    /** 持有 a:a 状态，连续三个对象 updater 应将 b/c/d 合并到同一实例。 */
    class Bar extends React.Component {
      /** 初始化 a:a 并暴露实例，供统一冲刷前连续入队三个 setState。 */
      constructor() {
        super();
        this.state = {a: 'a'};
        instance = this;
      }
      /** 只输出 children，state 合并结果由实例断言验证。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    /** 包裹 Bar 的固定父组件，不在子状态更新时主动改变 props。 */
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
   * Bar 初始 num=1、multiplier=2，函数 updater 冲刷一次后 num=2；再次入队同一 updater，同时根 props 改 multiplier=3，最终 num=6。验证 updater 使用处理该轮时的 props 与前一 state，而非入队时捕获值。
   */
  it('can use updater form of setState', async () => {
    let instance;
    /** 初始 num=1 的类，接受 multiplier 输入用于函数 updater 的处理时 props。 */
    class Bar extends React.Component {
      /** 初始化 num 并暴露实例，便于在父 props 更新前后排入 updater。 */
      constructor() {
        super();
        this.state = {num: 1};
        instance = this;
      }
      /** 输出 children，num 的 1→2→6 变化由实例状态断言观察。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    /** 把 multiplier 透传给 Bar，使已排队 updater 可读取本次处理的最新 props。 */
    function Foo({multiplier}) {
      return (
        <div>
          <Bar multiplier={multiplier} />
        </div>
      );
    }

    /** 用处理时 state.num 与 props.multiplier 相乘，验证 updater 不捕获入队时旧 props。 */
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
   * num=1、multiplier=2 的 Bar 连续收到两个乘法 updater，第二条带提交回调 callback；回调以实例为 this 入队 called:true。waitForAll 后断言 num=4 且 called=true；本例没有 render/commit 日志计数，状态表明提交回调内更新被继续处理。
   */
  it('can call setState inside update callback', async () => {
    let instance;
    /** 初始 num=1，两个乘法 updater 与提交回调排入的 called 状态共同验证 callback 重入。 */
    class Bar extends React.Component {
      /** 初始化 num 并暴露实例，供同一队列连续加入两次 updater。 */
      constructor() {
        super();
        this.state = {num: 1};
        instance = this;
      }
      /** 只返回 children，不记录 render；最终 num/called 直接由实例验证。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    /** 把 multiplier=2 透传给 Bar，两个 updater 依次产生 num=2、4。 */
    function Foo({multiplier}) {
      return (
        <div>
          <Bar multiplier={multiplier} />
        </div>
      );
    }

    /** 按处理时 state 与 multiplier 计算下一个 num，两个队列项顺序累乘。 */
    function updater(state, props) {
      return {num: state.num * props.multiplier};
    }

    /** 作为 setState 提交回调以实例为 this，再入队 called:true；只在提交回调阶段触发第二轮状态更新。 */
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
   * Bar 初始 {a:a}，依次入队 setState b、setState c、内部 enqueueReplaceState d；冲刷后的精确 state 只有 {d:d}，验证最后一条 ReplaceState 覆盖前面的浅合并结果。
   */
  it('can replaceState', async () => {
    let instance;
    /** 提供初始 a 状态和实例引用，验证两个合并更新后 ReplaceState 丢弃旧键。 */
    class Bar extends React.Component {
      /** 初值为 a:a，替换后不应保留该键，也不保留先前加入的 b/c。 */
      state = {a: 'a'};
      /** 暴露实例并返回 children，替换语义由 instance.state 的精确对象断言确认。 */
      render() {
        instance = this;
        return <div>{this.props.children}</div>;
      }
    }

    /** 返回包装下的 Bar，不主动读取 state，使队列替换验证集中在 class 实例。 */
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
   * Bar 的 SCU 固定 false，首次日志 Foo/Bar/Baz；对子实例 forceUpdate 后仍记录 Bar/Baz 而不重复 Foo。验证 ForceUpdate 绕过该实例 SCU 并进入后代，SCU 本身没有日志。
   */
  it('can forceUpdate', async () => {
    /** 记录 Baz，证明 forceUpdate 不只调用 Bar render，还进入其后代。 */
    function Baz() {
      Scheduler.log('Baz');
      return <div />;
    }

    let instance;
    /** 普通更新始终 bailout 的类，forceUpdate 应跳过其否决。 */
    class Bar extends React.Component {
      /** 仅暴露 instance，没有初始化业务 state。 */
      constructor() {
        super();
        instance = this;
      }
      /** 固定返回 false，制造 forceUpdate 需要绕过的更新判断。 */
      shouldComponentUpdate() {
        return false;
      }
      /** 记录 Bar 并返回 Baz，供强制更新后断言二者均再次执行。 */
      render() {
        Scheduler.log('Bar');
        return <Baz />;
      }
    }

    /** 记录父 Foo 并包裹 Bar；子 forceUpdate 的日志不应再次包含 Foo。 */
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
   * PureComponent Foo 输出外部 a 和 prop b，初始为0/0；只改 a=1 后 forceUpdate 输出1/0，再以相同 b=0 更新根无日志。验证 force 标记只影响一轮，不破坏之后普通 PureComponent bailout。
   */
  it('should clear forceUpdate after update is flushed', async () => {
    let a = 0;

    /** PureComponent 读取外部变量 a 和 prop b，用普通相同 props 更新验证 force 标记已清除。 */
    class Foo extends React.PureComponent {
      /** 记录并返回 A/B 文本；a 仅通过 forceUpdate 使输出更新，之后相同 b 的根更新应 bailout。 */
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
   * 未执行：it.skip 保留的历史场景。
   * 历史 Bar 的初值 y=A，四个 key 的 x 为 A/B/C/D；先构造前三个实例，再把 key b 改成 B2 继续渲染。期望只出现 B2/D，Set 最终四个实例，验证部分挂载复用与新输入判断；本用例跳过。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('can call sCU while resuming a partly mounted component', () => {
    const instances = new Set();

    /** 历史未执行夹具：实例集合统计部分挂载时 A/B/C 的复用与 D 的新增。 */
    class Bar extends React.Component {
      /** 固定 y:A，与各 x 比较生成宿主 prop，便于恢复时计算最新输入。 */
      state = {y: 'A'};
      /** 把每个新实例加入 Set，最终 size=4 表示未错误重建已经开始的实例。 */
      constructor() {
        super();
        instances.add(this);
      }
      /** 比较旧/新 x 和 y，任一变化才允许 render；B→B2 应重新执行。 */
      shouldComponentUpdate(newProps, newState) {
        return this.props.x !== newProps.x || this.state.y !== newState.y;
      }
      /** 记录 Bar:x 并输出 x===y 的字符串，使用恢复时 props/state。 */
      render() {
        Scheduler.log('Bar:' + this.props.x);
        return <span prop={String(this.props.x === this.state.y)} />;
      }
    }

    /** 记录 Foo，step=1 只改变 key b 的 x，保持 a/c 身份并首次开始 d。 */
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
   * 未执行：it.skip 保留的历史场景。
   * 历史 Foo 的两个 Bar 在 step=1 的根更新中已完成但未提交，两个 Baz 作为后续哨兵；对 instances[0] 调用 performAction 把 y 改 B。恢复期望 Bar:A-1 与剩余 Baz，检查子 state 更新仍读 step1；本用例跳过。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('gets new props when setting state on a partly updated component', async () => {
    const instances = [];

    /** 历史未执行夹具：实例数组用于在 props=step1 部分完成后直接更新第一个 Bar 状态。 */
    class Bar extends React.Component {
      /** 初始 y:A，performAction 将它改为 B，验证部分更新中的 props/state 配对。 */
      state = {y: 'A'};
      /** 按构造顺序保存实例，测试通过 instances[0] 精确选择第一个 Bar。 */
      constructor() {
        super();
        instances.push(this);
      }
      /** 将 y 改为 B，仅触发这个实例的 state 更新，不提供新根 props。 */
      performAction() {
        this.setState({
          y: 'B',
        });
      }
      /** 记录当前 x/step，返回 x===y 字符串，定位重渲染仍使用 step1。 */
      render() {
        Scheduler.log('Bar:' + this.props.x + '-' + this.props.step);
        return <span prop={String(this.props.x === this.state.y)} />;
      }
    }

    /** 记录 Baz 并返回 div，两个同级哨兵使 Foo 完成后根仍可暂停未提交。 */
    function Baz() {
      // 该组件作为 Foo 的同级节点，使 Foo 可以完整
      // 完成但暂不提交。
      Scheduler.log('Baz');
      return <div />;
    }

    /** 记录 Foo，将 step 透传给 key a/b 的两个 Bar，保持各实例身份。 */
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
   * 未执行：it.skip 保留的历史场景。
   * 历史 LifeCycle 初始 x=0，挂载推进到 willMount 后停止，再改根 x=1。期望 receiveProps 0-1 将 state 改一，重入 willMount 1-1，Trail 完成后仅 didMount 1-1；本用例跳过。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('calls componentWillMount twice if the initial render is aborted', async () => {
    /** 历史未执行夹具：用 x 派生初始 state，并在 receiveProps 里追随新 x，观察挂载重入。 */
    class LifeCycle extends React.Component {
      /** 从首次 props.x 初始化 x，后续输入由 receiveProps 里的 setState 更新。 */
      state = {x: this.props.x};
      /** 记录旧 state.x 与 nextProps.x，再把 state.x 更新为新输入。 */
      UNSAFE_componentWillReceiveProps(nextProps) {
        Scheduler.log(
          'componentWillReceiveProps:' + this.state.x + '-' + nextProps.x,
        );
        this.setState({x: nextProps.x});
      }
      /** 记录当前 state/props 的 x，历史恢复期望出现 0-0 后再出现 1-1。 */
      UNSAFE_componentWillMount() {
        Scheduler.log(
          'componentWillMount:' + this.state.x + '-' + this.props.x,
        );
      }
      /** LifeCycle.componentDidMount 在“初始渲染中断后重复调用 componentWillMount”场景标记实例首次 commit；仅完成 render 而未提交的工作不得调用它。 */
      componentDidMount() {
        Scheduler.log('componentDidMount:' + this.state.x + '-' + this.props.x);
      }
      /** 返回固定 span；生命周期日志负责观察状态配对，render 本身无日志。 */
      render() {
        return <span />;
      }
    }

    /** 记录 Trail 后返回 null，用来确认 LifeCycle 之后的 render 工作尚未完成。 */
    function Trail() {
      Scheduler.log('Trail');
      return null;
    }

    /** 记录 App 并把 x 透传给 LifeCycle，与 Trail 组成可中断挂载树。 */
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
   * 未执行：it.skip 保留的历史场景。
   * 历史构造将 x=0 拼成 0(ctor)，willMount 改成0(willMount)，render 后暂停；根改 x=1 后同实例重入 willMount，最终 render/didMount 为1(willMount)。日志验证挂载写入状态保存和重算，本例没有 constructor 日志/最终实例 state 断言；本用例跳过。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('uses state set in componentWillMount even if initial render was aborted', async () => {
    /** 历史未执行夹具：用 ctor/willMount 后缀区别构造状态与挂载生命周期写入的状态。 */
    class LifeCycle extends React.Component {
      /** 将首次 x 拼上 (ctor) 初始化 state，恢复时应保留实例而非再次构造。 */
      constructor(props) {
        super(props);
        this.state = {x: this.props.x + '(ctor)'};
      }
      /** 先记录旧 state，再用当前 props.x 拼上 (willMount) 入队状态，历史恢复期望最终为 1(willMount)。 */
      UNSAFE_componentWillMount() {
        Scheduler.log('componentWillMount:' + this.state.x);
        this.setState({x: this.props.x + '(willMount)'});
      }
      /** LifeCycle.componentDidMount 在“componentWillMount 写入状态后中断恢复”场景标记实例首次 commit；仅完成 render 而未提交的工作不得调用它。 */
      componentDidMount() {
        Scheduler.log('componentDidMount:' + this.state.x);
      }
      /** 记录更新后的 state.x 并返回 span，定位 willMount 的 setState 在 render 前处理。 */
      render() {
        Scheduler.log('render:' + this.state.x);
        return <span />;
      }
    }

    /** 记录 App 并传入 x，以根输入从零改为一触发历史挂载中断。 */
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
   * 未执行：it.skip 保留的历史场景。
   * 历史 LifeCycle 先完整挂载 x=0，再将 x=1 的更新推进到 Sibling 但不提交；新根输入x=2重开。期望 receiveProps/SCU/willUpdate/render 重入，最终 didUpdate:2-0 跨过未提交的1，且只出现一次更新提交；本用例跳过。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('calls componentWill* twice if an update render is aborted', async () => {
    /** 历史未执行夹具：记录 will/SCU/render/didUpdate 入参，观察两次更新最终只提交一次 didUpdate。 */
    class LifeCycle extends React.Component {
      /** 记录首次挂载的 props.x，和后续 receive/update 生命周期区分。 */
      UNSAFE_componentWillMount() {
        Scheduler.log('componentWillMount:' + this.props.x);
      }
      /** LifeCycle.componentDidMount 在“更新渲染中断后重复调用 will 生命周期”场景标记实例首次 commit；仅完成 render 而未提交的工作不得调用它。 */
      componentDidMount() {
        Scheduler.log('componentDidMount:' + this.props.x);
      }
      /** 记录实例当前 x 与 nextProps.x，历史中断后第二轮从 1 接收 2。 */
      UNSAFE_componentWillReceiveProps(nextProps) {
        Scheduler.log(
          'componentWillReceiveProps:' + this.props.x + '-' + nextProps.x,
        );
      }
      /** 记录前后 x 并固定允许更新，保证两次 render 都可进入。 */
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
      /** 记录已提交新 x 与 prevProps.x，历史断言要求最终为 2-0，跨越被中止的 x=1。 */
      componentDidUpdate(prevProps) {
        Scheduler.log('componentDidUpdate:' + this.props.x + '-' + prevProps.x);
      }
      /** 记录当前 x 并返回 span，与提交阶段 didUpdate 日志区分。 */
      render() {
        Scheduler.log('render:' + this.props.x);
        return <span />;
      }
    }

    /** 记录 Sibling，表明 LifeCycle 已完成子树但根还没有提交生命周期。 */
    function Sibling() {
      // 同级节点用于确认首个子节点已经完成，
      // 但尚未冲刷提交。
      Scheduler.log('Sibling');
      return <span />;
    }

    /** 记录 App，以稳定 key a/b 返回 LifeCycle 和 Sibling，根更新只改变 x。 */
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
   * LifeCycle 的派生函数固定返回 foo:foo，changeState 仅写 foo:bar；挂载和此 state-only 更新都调用派生函数，更新日志为 derived/render/didUpdate，实例最终仍foo:foo。日志没有派生入参，本例验证调用发生及覆盖结果。
   */
  it('calls getDerivedStateFromProps even for state-only updates', async () => {
    let instance;

    /** 固定派生 foo:foo 的类，验证 state-only 写入 foo:bar 仍会被派生状态覆盖。 */
    class LifeCycle extends React.Component {
      /** 初始为空对象，挂载派生后得到 foo:foo。 */
      state = {};
      /** 记录派生调用并固定返回 foo:foo，不依赖传入 props/prevState，覆盖 changeState 的 bar。 */
      static getDerivedStateFromProps(props, prevState) {
        Scheduler.log('getDerivedStateFromProps');
        return {foo: 'foo'};
      }
      /** 只写 foo:bar，不改变 props，用来触发 state-only 的派生路径。 */
      changeState() {
        this.setState({foo: 'bar'});
      }
      /** 记录更新提交事件，挂载没有此日志。 */
      componentDidUpdate() {
        Scheduler.log('componentDidUpdate');
      }
      /** 记录 render、暴露实例并返回 null，最终派生状态由 instance.state 断言。 */
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
   * Parent 挂载时调用派生函数并返回 Child；此夹具派生返回数字，测试关键是 child ref 的 setState({}) 仅产生 Child 日志、不再进入 Parent/派生函数。没有父 props 更新，也没有调用计数变量或最终文本断言。
   */
  it('does not call getDerivedStateFromProps if neither state nor props have changed', async () => {
    /** 父级派生调用只在挂载出现；子 setState 不应使此父重新进入 class 更新。 */
    class Parent extends React.Component {
      /** 初始 parentRenders 为零，Child 输出该字段。 */
      state = {parentRenders: 0};
      /** 记录调用并返回 prevState.parentRenders+1 这一数字；本夹具没有返回对象补丁，关键断言是子更新时此函数不再调用。 */
      static getDerivedStateFromProps(props, prevState) {
        Scheduler.log('getDerivedStateFromProps');
        return prevState.parentRenders + 1;
      }
      /** 记录 Parent 并把 parentRenders 与 ref 传给 Child，供直接调度子状态更新。 */
      render() {
        Scheduler.log('Parent');
        return <Child parentRenders={this.state.parentRenders} ref={child} />;
      }
    }

    /** 被直接 setState 的子类，父输入不变时应单独重渲染。 */
    class Child extends React.Component {
      /** 记录 Child 并返回 parentRenders，不调用父派生函数。 */
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
   * 未执行：it.skip 保留的历史场景。
   * 历史 LifeCycle.tick 改x、Wrap.tick 改作为子props的y；两次子tick的中断/恢复期望没有 receiveProps，随后父tick出现一次receiveProps，再子tick不重复它。SCU/will/render/did日志核对state-only与新props边界，本用例跳过。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('does not call componentWillReceiveProps for state-only updates', async () => {
    const instances = [];

    /** 历史未执行夹具：自身 tick 改 x，父 Wrap.tick 改 y props，区分 state-only 与 receiveProps。 */
    class LifeCycle extends React.Component {
      /** 初始 x=0，连续两次自身 tick 历史期望最终 x=2。 */
      state = {x: 0};
      /** 按实例当前 x 加一入队对象更新，可能在部分 render 后再次调用。 */
      tick() {
        this.setState({
          x: this.state.x + 1,
        });
      }
      /** 将实例加入数组并记录 x，instances[1] 指向 LifeCycle。 */
      UNSAFE_componentWillMount() {
        instances.push(this);
        Scheduler.log('componentWillMount:' + this.state.x);
      }
      /** LifeCycle.componentDidMount 在“纯 state 更新不调用 componentWillReceiveProps”场景标记实例首次 commit；仅完成 render 而未提交的工作不得调用它。 */
      componentDidMount() {
        Scheduler.log('componentDidMount:' + this.state.x);
      }
      /** 只记录 receiveProps，不更新状态，历史 state-only 日志中不应出现此项。 */
      UNSAFE_componentWillReceiveProps(nextProps) {
        Scheduler.log('componentWillReceiveProps');
      }
      /** 记录当前 x 与 nextState.x 并允许更新，观察每轮 state 变化。 */
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
      /** 记录当前 x 与 prevState.x，历史最后提交可能覆盖两次 render 输入。 */
      componentDidUpdate(prevProps, prevState) {
        Scheduler.log('componentDidUpdate:' + this.state.x + '-' + prevState.x);
      }
      /** 记录当前 x 并返回 span，使 state-only 重渲染可观察。 */
      render() {
        Scheduler.log('render:' + this.state.x);
        return <span />;
      }
    }

    // 该 Wrap 略显刻意，因为无法暂停已完成的根，且
    // 当前组件若未完整完成，就无法复用其 render
    // 输出。
    /** 历史未执行夹具：父状态 y 通过 props 影响 LifeCycle，和子自身 x 更新形成两种入口。 */
    class Wrap extends React.Component {
      /** 初始 y=0，仅 Wrap.tick 改它。 */
      state = {y: 0};
      /** 把父实例先加入数组，instances[0] 用于触发子 props 更新。 */
      UNSAFE_componentWillMount() {
        instances.push(this);
      }
      /** 将当前 y 加一入队，供 receiveProps 正向对照。 */
      tick() {
        this.setState({
          y: this.state.y + 1,
        });
      }
      /** 记录 Wrap 并把 y 传入 LifeCycle，自身状态更新时创建子新 props。 */
      render() {
        Scheduler.log('Wrap');
        return <LifeCycle y={this.state.y} />;
      }
    }

    /** 记录 Sibling 并返回 span，作为根未提交前的工作哨兵。 */
    function Sibling() {
      // 同级节点用于确认首个子节点已经完成，
      // 但尚未冲刷提交。
      Scheduler.log('Sibling');
      return <span />;
    }

    /** 记录 App，以稳定 key 返回 Wrap 与 Sibling；y 输入本身不参与内部状态计算。 */
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
   * 未执行：it.skip 保留的历史场景。
   * 历史 LifeCycle 只在x改变时通过SCU：初次同x=0更新不调用willUpdate/render/didUpdate；x=1先render但未提交，再同x=1重开期望SCU拒绝却保留待提交didUpdate。日志区分未开始与已进行更新，本用例跳过。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('skips will/DidUpdate when bailing unless an update was already in progress', async () => {
    /** 历史未执行夹具：只在 x 改变时 render，比较未开始的 bailout 与已 render 待提交的更新。 */
    class LifeCycle extends React.Component {
      /** 记录挂载 willMount，区分初始化与后续更新日志。 */
      UNSAFE_componentWillMount() {
        Scheduler.log('componentWillMount');
      }
      /** LifeCycle.componentDidMount 在“bailout 时的 will/didUpdate 边界”场景标记实例首次 commit；仅完成 render 而未提交的工作不得调用它。 */
      componentDidMount() {
        Scheduler.log('componentDidMount');
      }
      /** 记录 receiveProps，即使后续 SCU 拒绝更新仍应出现该 render 阶段入口。 */
      UNSAFE_componentWillReceiveProps(nextProps) {
        Scheduler.log('componentWillReceiveProps');
      }
      /** 记录判断并比较旧/新 x；相同 x 返回 false。 */
      shouldComponentUpdate(nextProps) {
        Scheduler.log('shouldComponentUpdate');
        // 触发 bailout。
        return this.props.x !== nextProps.x;
      }
      /** LifeCycle.UNSAFE_componentWillUpdate 在“bailout 时的 will/didUpdate 边界”场景记录已通过 bailout 的更新 render；中断重启可重入，commit 前不能视为完成。 */
      UNSAFE_componentWillUpdate(nextProps) {
        Scheduler.log('componentWillUpdate');
      }
      /** 记录更新提交；历史断言中第一次相同 x 不调用，第二次继承已进行工作时调用。 */
      componentDidUpdate(prevProps) {
        Scheduler.log('componentDidUpdate');
      }
      /** 记录 render 并返回 span，在 SCU 拒绝的路径应缺席。 */
      render() {
        Scheduler.log('render');
        return <span />;
      }
    }

    /** 记录 render sibling 并返回 span，定位 LifeCycle 后尚未 commit 的位置。 */
    function Sibling() {
      Scheduler.log('render sibling');
      return <span />;
    }

    /** 以稳定 key 组合 LifeCycle 和 Sibling，反复传入 x=0/1 制造历史 bailout。 */
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
   * Foo 初始n=0，外层flushSync内嵌套两层batchedUpdates并依次写n=1..4；退出内外batch日志先出现，随后四个回调按入队顺序执行，最终n=4。同步冲刷边界是flushSync，禁用LegacyMode时batchedUpdates本身仅调用fn。
   */
  it('can nest batchedUpdates', async () => {
    let instance;

    /** 记录最终 n 的实例，四个带回调对象更新在外层 flushSync 退出后统一结算。 */
    class Foo extends React.Component {
      /** 初始 n=0，四次更新以 n=4 为最终状态。 */
      state = {n: 0};
      /** 暴露实例并返回 div，无 render 日志，时序由 batch 退出和 callback 日志验证。 */
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
   * Foo 初始n=0，三个函数updater各加一，第二个回调记录后抛 callback error；waitForThrow捕获此错，日志只有第一/第二回调而没有第三，实例已计算为n=3。验证错误中断当前实例剩余回调，不回滚已归并状态。
   */
  it('can handle if setState callback throws', async () => {
    let instance;

    /** 保存递增 n 的实例，用三个 updater 证明 callback 抛错前状态处理已完成。 */
    class Foo extends React.Component {
      /** 初始 n=0，三个函数 updater 顺序产生 n=3。 */
      state = {n: 0};
      /** 暴露实例并返回 div，callback 抛错后仍可断言该实例已计算出的 n。 */
      render() {
        instance = this;
        return <div />;
      }
    }

    ReactNoop.render(<Foo />);
    await waitForAll([]);

    /** 从前一条结果 n 加一，三个更新都在提交回调前完成状态归并。 */
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
   * Intl发布locale，Router发布route，消费者分别声明locale/route/both/无声明；fr→de→部分sv→en更新与内部ru覆盖交错。日志核对masked键及祖先合并：Router下的both读route+ru/en，外侧both仅读en；开发期另断言legacy警告，没有宿主文本断言。
   */
  // @gate !disableLegacyContext && !disableLegacyContextForFunctionComponents
  it('merges and masks context', async () => {
    /** 提供 locale 的 legacy Provider，自身未声明 contextTypes，所以 render 读取空 masked context。 */
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
      /** 记录 Intl 自身 masked context 后透传 children；自身不能消费刚发布的 locale。 */
      render() {
        Scheduler.log('Intl ' + JSON.stringify(this.context));
        return this.props.children;
      }
    }

    /** 提供 route 的嵌套 legacy Provider，与外层 locale 合并给后代。 */
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
      /** 记录 Router 自身空 masked context，再透传 children。 */
      render() {
        Scheduler.log('Router ' + JSON.stringify(this.context));
        return this.props.children;
      }
    }

    /** 仅声明 locale 的 class 消费者，route 在入参中被掩掉。 */
    class ShowLocale extends React.Component {
      /** ShowLocale.contextTypes 在“legacy context 合并与掩码”场景声明允许读取的 legacy context 键，未声明值会在传入组件前被 mask。 */
      static contextTypes = {
        locale: PropTypes.string,
      };
      /** 记录并返回 masked context.locale，供不同祖先 locale 传播日志比较。 */
      render() {
        Scheduler.log('ShowLocale ' + JSON.stringify(this.context));
        return this.context.locale;
      }
    }

    /** 仅声明 route 的 class 消费者，看不到祖先 locale。 */
    class ShowRoute extends React.Component {
      /** ShowRoute.contextTypes 在“legacy context 合并与掩码”场景声明允许读取的 legacy context 键，未声明值会在传入组件前被 mask。 */
      static contextTypes = {
        route: PropTypes.string,
      };
      /** 记录并返回 masked context.route，验证 Router 发布 /about。 */
      render() {
        Scheduler.log('ShowRoute ' + JSON.stringify(this.context));
        return this.context.route;
      }
    }

    /** 通过第二参数读取声明的 route/locale，并返回组合文本；祖先未提供 route 时其值为 undefined。 */
    function ShowBoth(props, context) {
      Scheduler.log('ShowBoth ' + JSON.stringify(context));
      return `${context.route} in ${context.locale}`;
    }
    ShowBoth.contextTypes = {
      locale: PropTypes.string,
      route: PropTypes.string,
    };

    /** 未声明 contextTypes 的 class，masked context 应为空对象。 */
    class ShowNeither extends React.Component {
      /** 记录空 context 并返回 null，作为声明掩码的反向对照。 */
      render() {
        Scheduler.log('ShowNeither ' + JSON.stringify(this.context));
        return null;
      }
    }

    /** 未消费 context 的中间 class，组合多个消费者和覆盖 locale=ru 的内部 Intl。 */
    class Indirection extends React.Component {
      /** 记录中间层空 context，返回 locale-only/route-only/neither/嵌套both/外层both 五个稳定 key 分支。 */
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
   * Recurse同时读取父context.n并发布(n||3)-1，初始无父值；每层日志应依次为{}、2、1、0并在零停止。若Provider错误读自身刚发布的值将改变此序列/终止；开发期还检查两类legacy警告。
   */
  // @gate !disableLegacyContext
  it('does not leak own context into context provider', async () => {
    if (gate(flags => flags.disableLegacyContext)) {
      throw new Error('This test infinite loops when context is disabled.');
    }
    /** 同时消费与提供 n 的递归类，必须读取父值而非自己刚发布的值才能正确终止。 */
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
      /** 记录父级 n；到零返回 null，其余返回下一层 Recurse，得到 {}→2→1→0。 */
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
   * transition挂载Intl locale=fr，两个可见ShowLocale和隐藏分支中的fr/内部ru消费者；首次waitFor停在可见日志，后续waitForAll读取隐藏fr/ru。验证延后恢复重新进入正确Provider栈，本例没有更新输入或最终输出断言。
   */
  // @gate enableLegacyHidden && !disableLegacyContext
  it('provides context when reusing work', async () => {
    /** 提供 locale 并包住可见/隐藏消费者，验证隐藏工作恢复时正确压入 legacy context。 */
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
      /** 记录自身空 context 再透传 children，不直接消费所发布 locale。 */
      render() {
        Scheduler.log('Intl ' + JSON.stringify(this.context));
        return this.props.children;
      }
    }

    /** 声明 locale 的类消费者，在隐藏树中分别读取 fr 和嵌套 Intl 的 ru。 */
    class ShowLocale extends React.Component {
      /** ShowLocale.contextTypes 在“复用工作时保持 Provider context”场景声明允许读取的 legacy context 键，未声明值会在传入组件前被 mask。 */
      static contextTypes = {
        locale: PropTypes.string,
      };
      /** 记录并返回当前 masked locale，作为延后工作恢复的 context 证据。 */
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
   * Intl fr上方保持输入不变，其下Stateful初始x=0且返回稳定children；改x=1后消费者/Provider/中间层均无新日志。初次class/function读fr日志提供读取基线，随后验证局部state更新不会使上层context重算，没有最终文本断言。
   */
  // @gate !disableLegacyContext && !disableLegacyContextForFunctionComponents
  it('reads context when setState is below the provider', async () => {
    let statefulInst;

    /** 把 locale=fr 发布在 Stateful 上方；子 state 更新不应重新执行该 Provider。 */
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
      /** 记录 Intl:read 的空 masked context，并透传 children。 */
      render() {
        Scheduler.log('Intl:read ' + JSON.stringify(this.context));
        return this.props.children;
      }
    }

    /** 声明 locale 的 class 消费者，和 function 消费者对照 legacy 掩码输入。 */
    class ShowLocaleClass extends React.Component {
      /** ShowLocaleClass.contextTypes 在“Provider 下方 setState 后读取 context”场景声明允许读取的 legacy context 键，未声明值会在传入组件前被 mask。 */
      static contextTypes = {
        locale: PropTypes.string,
      };
      /** 记录并返回 locale，初始为 fr；稳定子元素在 Stateful 更新后可复用。 */
      render() {
        Scheduler.log('ShowLocaleClass:read ' + JSON.stringify(this.context));
        return this.context.locale;
      }
    }

    /** 记录第二参数 masked locale 并返回它，和 class 消费者读取路径对照。 */
    function ShowLocaleFn(props, context) {
      Scheduler.log('ShowLocaleFn:read ' + JSON.stringify(context));
      return context.locale;
    }
    ShowLocaleFn.contextTypes = {
      locale: PropTypes.string,
    };

    /** 位于 Provider 下方的状态入口，返回同一个 props.children 保持消费者元素身份。 */
    class Stateful extends React.Component {
      /** 初始 x=0，测试改为一；x 不参与 children 的生成。 */
      state = {x: 0};
      /** 暴露实例并返回原 children，子树没有新增 props/context 输入。 */
      render() {
        statefulInst = this;
        return this.props.children;
      }
    }

    /** 记录空 legacy context 并透传 children，中间函数不声明 contextTypes。 */
    function IndirectionFn(props, context) {
      Scheduler.log('IndirectionFn ' + JSON.stringify(context));
      return props.children;
    }

    /** 不声明 contextTypes 的中间 class，只负责透传元素。 */
    class IndirectionClass extends React.Component {
      /** 记录空 masked context 并返回 children。 */
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
   * Stateful初始locale=fr且在render创建Intl；改locale=gr后日志重做Intl:read/provide、中间function/class及两个消费者，消费者都读gr。验证Provider下的新context传播；无宿主文本断言。
   */
  // @gate !disableLegacyContext && !disableLegacyContextForFunctionComponents
  it('reads context when setState is above the provider', async () => {
    let statefulInst;

    /** 位于 Stateful 下方的 locale Provider，祖先 state 更新后必须重算 child context。 */
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
      /** 记录 Provider 自身空 context，并透传 children。 */
      render() {
        Scheduler.log('Intl:read ' + JSON.stringify(this.context));
        return this.props.children;
      }
    }

    /** 声明 locale 的 class 消费者，祖先 locale 从 fr 变 gr 时重新读取。 */
    class ShowLocaleClass extends React.Component {
      /** ShowLocaleClass.contextTypes 在“Provider 上方 setState 后读取 context”场景声明允许读取的 legacy context 键，未声明值会在传入组件前被 mask。 */
      static contextTypes = {
        locale: PropTypes.string,
      };
      /** 记录并返回当前 locale，作为新的 child context 已传播的证据。 */
      render() {
        Scheduler.log('ShowLocaleClass:read ' + JSON.stringify(this.context));
        return this.context.locale;
      }
    }

    /** 通过第二参数记录并返回 locale，验证 function 消费者与 class 同步得到 gr。 */
    function ShowLocaleFn(props, context) {
      Scheduler.log('ShowLocaleFn:read ' + JSON.stringify(context));
      return context.locale;
    }
    ShowLocaleFn.contextTypes = {
      locale: PropTypes.string,
    };

    /** 记录空 context 并透传 children；本 legacy 路径更新时仍会重新访问中间函数。 */
    function IndirectionFn(props, context) {
      Scheduler.log('IndirectionFn ' + JSON.stringify(context));
      return props.children;
    }

    /** 透传子树的中间 class，未声明 contextTypes。 */
    class IndirectionClass extends React.Component {
      /** 记录空 context 并返回 children；日志不代表此层消费了 locale。 */
      render() {
        Scheduler.log('IndirectionClass ' + JSON.stringify(this.context));
        return this.props.children;
      }
    }

    /** Provider 上方的状态入口，根据自身 locale state 创建新的 Intl 输入。 */
    class Stateful extends React.Component {
      /** 初始 locale=fr，测试更新为 gr。 */
      state = {locale: 'fr'};
      /** 暴露实例，以 state.locale 创建 Intl 并透传原 children，驱动 Provider 重算。 */
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
   * Root→Middle→Child中Child提供空legacycontext，Middle的SCU固定false；挂载后对子Middle setState({})再完成工作无日志，开发期仅Child警告。回归目标是bailout时栈平衡、不发生内部错误，本例没有可比较的context值、低优先级切片或Child输出断言。
   */
  // @gate !disableLegacyContext || !__DEV__
  it('maintains the correct context when providers bail out due to low priority', async () => {
    /** 只包装 Middle 的根类，供树中部 state 更新绕过根自身 render。 */
    class Root extends React.Component {
      /** 把当前 props 透传给 Middle，建立其下空 legacy Provider 的初始树。 */
      render() {
        return <Middle {...this.props} />;
      }
    }

    let instance;

    /** 暴露实例并固定拒绝更新，验证 bailout 后空 Provider 栈仍平衡。 */
    class Middle extends React.Component {
      /** 保存 Middle 实例供直接 setState，不初始化业务 state。 */
      constructor(props, context) {
        super(props, context);
        instance = this;
      }
      /** 固定返回 false，使树中部更新不重新 render Child。 */
      shouldComponentUpdate() {
        // 返回 false，跳过 Middle 自身的 render；本轮后代也没有待处理更新。
        return false;
      }
      /** 返回会提供空 child context 的 Child；本例没有 context 数值读写。 */
      render() {
        return <Child />;
      }
    }

    // Child 必须是 context Provider 才能触发该缺陷。
    /** 空 legacy Provider，用于复现子树 bailout 时 context 栈失配回归。 */
    class Child extends React.Component {
      /** Child.childContextTypes 在“低优先级 Provider bailout 时保持 context”场景声明 Provider 可向后代发布的 legacy context 键，限制 getChildContext 的输出边界。 */
      static childContextTypes = {};
      /** Child.getChildContext 在“低优先级 Provider bailout 时保持 context”场景从当前 props/state 派生 legacy context 输出；该值只对后代生效并参与 Provider 缓存。 */
      getChildContext() {
        return {};
      }
      /** 返回 div；无日志和 context 值断言，测试验证工作能完成且开发警告符合预期。 */
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
   * Root用空componentDidCatch包住四层空ContextProvider，暴露depth1实例；将其throwError置真会在Provider render抛Error，waitForAll仍完成，开发期提示边界缺少getDerivedStateFromError。验证unwind栈可恢复及错误可捕获；没有Thing、fallback文本或读取context数值断言。
   */
  // @gate !disableLegacyContext || !__DEV__
  it('maintains the correct context when unwinding due to an error in render', async () => {
    /** 旧式错误边界，componentDidCatch 为空实现，用来验证 Provider render 错误可被捕获而不发生栈失配。 */
    class Root extends React.Component {
      /** Root.componentDidCatch 接收故意抛出的 render 错误，但方法体没有 setState；开发警告指出该边界未用派生错误状态提供 fallback。 */
      componentDidCatch(error) {
        // 若 context 正确压栈与弹栈，
        // 该方法会处理测试故意抛出的 Error。
      }
      /** 返回 depth=1 的 ContextProvider，创建四层空 child context 栈。 */
      render() {
        return <ContextProvider depth={1} />;
      }
    }

    let instance;

    /** 递归空 Provider；只有 depth=1 实例被暴露并可设 throwError。 */
    class ContextProvider extends React.Component {
      /** 初始化空 state，在 depth=1 时保存外部实例供树中部错误触发。 */
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
      /** throwError 为真时抛 Error，否则递归到 depth4 后返回 div，制造需要 unwind 的 Provider 压栈。 */
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
   * MyComponent声明空contextTypes，didMount写标记true，didUpdate再清成false；若masked context引用错误重建，receiveProps会再置true。预期只有三次render及两次SCU/CDU，无receiveProps日志，SCU计数上限五防测试无限挂起。
   */
  // @gate !disableLegacyContext || !__DEV__
  it('should not recreate masked context unless inputs have changed', async () => {
    let scuCounter = 0;

    /** 声明空 contextTypes 的类；didMount/didUpdate 的有限 state 链用于检测 masked context 引用是否错误变化。 */
    class MyComponent extends React.Component {
      /** MyComponent.contextTypes 在“masked context 输入不变时保持对象身份”场景声明允许读取的 legacy context 键，未声明值会在传入组件前被 mask。 */
      static contextTypes = {};
      /** MyComponent.componentDidMount 在“masked context 输入不变时保持对象身份”场景标记实例首次 commit；仅完成 render 而未提交的工作不得调用它。 */
      componentDidMount(prevProps, prevState) {
        Scheduler.log('componentDidMount');
        this.setState({setStateInCDU: true});
      }
      /** 记录提交并在 setStateInCDU 为真时将其清零，使正常链在第三次 render 后结束。 */
      componentDidUpdate(prevProps, prevState) {
        Scheduler.log('componentDidUpdate');
        if (this.state.setStateInCDU) {
          this.setState({setStateInCDU: false});
        }
      }
      /** 若被调用会记录并重新把标记置真，作为错误 context 身份变化的可观察信号。 */
      UNSAFE_componentWillReceiveProps(nextProps) {
        Scheduler.log('componentWillReceiveProps');
        this.setState({setStateInCDU: true});
      }
      /** 记录 render 并返回 null，预期有限链共三个 render。 */
      render() {
        Scheduler.log('render');
        return null;
      }
      /** 记录并最多允许前五次更新，防止身份回归造成永久循环；正常期望只需两次 SCU。 */
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
   * 未执行：it.skip 保留的历史场景。
   * 历史FirstChild收集SCU/CDU前后props并统计render，A→部分B→B重开；期望renderCounter保持二，SCU观察A→B再B→B，最终CDU只记录A→B一次。数组与计数直接验证复用和提交输入，不是生命周期日志断言；本用例跳过。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('should reuse memoized work if pointers are updated before calling lifecycles', async () => {
    const cduNextProps = [];
    const cduPrevProps = [];
    const scuNextProps = [];
    const scuPrevProps = [];
    let renderCounter = 0;

    /** 返回 children 到 span，作为 FirstChild 后的剩余工作，历史切片停在其前。 */
    function SecondChild(props) {
      return <span>{props.children}</span>;
    }

    /** 历史未执行夹具：收集 SCU/CDU 前后 props 引用并统计 render，核对 memoized B 工作的复用。 */
    class FirstChild extends React.Component {
      /** 把当前 this.props 与 prevProps 分别加入提交数组，最终应为 B/A。 */
      componentDidUpdate(prevProps, prevState) {
        cduNextProps.push(this.props);
        cduPrevProps.push(prevProps);
      }
      /** 收集新旧 props，再比较 children；历史第二次 B→B 返回 false。 */
      shouldComponentUpdate(nextProps, nextState) {
        scuNextProps.push(nextProps);
        scuPrevProps.push(this.props);
        return this.props.children !== nextProps.children;
      }
      /** 递增 renderCounter 并输出 children，复用后计数应保持二。 */
      render() {
        renderCounter++;
        return <span>{this.props.children}</span>;
      }
    }

    /** 把同一 children 分别提供给 FirstChild 与 SecondChild，形成提交前可暂停的两个子组件。 */
    class Middle extends React.Component {
      /** 返回两个子分支，保持次序以便 FirstChild 已完成而 SecondChild 未执行。 */
      render() {
        return (
          <div>
            <FirstChild>{this.props.children}</FirstChild>
            <SecondChild>{this.props.children}</SecondChild>
          </div>
        );
      }
    }

    /** 用 hidden div 包住 Middle，保留历史低优先级工作布局；A→B→B 为输入序列。 */
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
   * TopContextProvider初始count0，Middle透传children，Child声明count并日志；调用updateCount后count:0变count:1，验证单层legacy值传播，Provider/Middle自身没有render日志。
   */
  // @gate !disableLegacyContext
  it('updates descendants with new context values', async () => {
    let instance;

    /** 持有 count 并发布给后代的单层 Provider，外部实例可精确触发 count+1。 */
    class TopContextProvider extends React.Component {
      /** TopContextProvider.childContextTypes 在“单一 Provider 更新 context 后代”场景声明 Provider 可向后代发布的 legacy context 键，限制 getChildContext 的输出边界。 */
      static childContextTypes = {
        count: PropTypes.number,
      };
      /** 初始化 count=0 并保存实例，后续 updateCount 使用函数 updater。 */
      constructor() {
        super();
        this.state = {count: 0};
        instance = this;
      }
      /** TopContextProvider.getChildContext 在“单一 Provider 更新 context 后代”场景以字段函数发布当前 legacy context；闭包读取实例 state，更新后形成新的 Provider 值。 */
      getChildContext = () => ({
        count: this.state.count,
      });
      /** TopContextProvider.render 在“单一 Provider 更新 context 后代”场景以字段函数读取 props/state/context 并返回子树；返回值透传既有子元素；该字段本身未写日志，后代是否执行由 Child 的日志判断。 */
      render = () => this.props.children;
      /** TopContextProvider.updateCount 在“单一 Provider 更新 context 后代”场景封装 setState，作为测试精确触发 Provider 或中间层 context 变化的入口。 */
      updateCount = () =>
        this.setState(state => ({
          count: state.count + 1,
        }));
    }

    /** 仅透传稳定 children 的中间 class，本身不消费 count。 */
    class Middle extends React.Component {
      /** Middle.render 在“单一 Provider 更新 context 后代”场景以字段函数读取 props/state/context 并返回子树；返回值透传既有子元素；该字段本身未写日志，后代是否执行由 Child 的日志判断。 */
      render = () => this.props.children;
    }

    /** 只声明 count 的消费者，render 日志由 count:0 变 count:1。 */
    class Child extends React.Component {
      /** Child.contextTypes 在“单一 Provider 更新 context 后代”场景声明允许读取的 legacy context 键，未声明值会在传入组件前被 mask。 */
      static contextTypes = {
        count: PropTypes.number,
      };
      /** Child.render 在“单一 Provider 更新 context 后代”场景以字段函数读取 props/state/context 并返回子树；返回值透传既有子元素；该字段本身未写日志，后代是否执行由 Child 的日志判断。 */
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
   * 外层Provider发布count0，内层发布固定name=brian，但Child只声明count；外层updateCount后count:1日志验证穿过另一Provider。未读取name、未断言完整组合或宿主文本。
   */
  // @gate !disableLegacyContext
  it('updates descendants with multiple context-providing ancestors with new context values', async () => {
    let instance;

    /** 提供 count 的外层 Provider，内部还有发布 name 的 Provider。 */
    class TopContextProvider extends React.Component {
      /** TopContextProvider.childContextTypes 在“多层 Provider 更新 context 后代”场景声明 Provider 可向后代发布的 legacy context 键，限制 getChildContext 的输出边界。 */
      static childContextTypes = {
        count: PropTypes.number,
      };
      /** 初始化 count=0 并暴露实例，顶层更新后 Child 只观察 count。 */
      constructor() {
        super();
        this.state = {count: 0};
        instance = this;
      }
      /** TopContextProvider.getChildContext 在“多层 Provider 更新 context 后代”场景以字段函数发布当前 legacy context；闭包读取实例 state，更新后形成新的 Provider 值。 */
      getChildContext = () => ({
        count: this.state.count,
      });
      /** TopContextProvider.render 在“多层 Provider 更新 context 后代”场景以字段函数读取 props/state/context 并返回子树；返回值透传既有子元素；该字段本身未写日志，后代是否执行由 Child 的日志判断。 */
      render = () => this.props.children;
      /** TopContextProvider.updateCount 在“多层 Provider 更新 context 后代”场景封装 setState，作为测试精确触发 Provider 或中间层 context 变化的入口。 */
      updateCount = () =>
        this.setState(state => ({
          count: state.count + 1,
        }));
    }

    /** 发布固定 name=brian 的内层 Provider，Child 没有声明该键，不能把它算作消费验证。 */
    class MiddleContextProvider extends React.Component {
      /** MiddleContextProvider.childContextTypes 在“多层 Provider 更新 context 后代”场景声明 Provider 可向后代发布的 legacy context 键，限制 getChildContext 的输出边界。 */
      static childContextTypes = {
        name: PropTypes.string,
      };
      /** MiddleContextProvider.getChildContext 发布固定 name:brian；本类没有 name 状态，Child 也未声明该键。 */
      getChildContext = () => ({
        name: 'brian',
      });
      /** MiddleContextProvider.render 在“多层 Provider 更新 context 后代”场景以字段函数读取 props/state/context 并返回子树；返回值透传既有子元素；该字段本身未写日志，后代是否执行由 Child 的日志判断。 */
      render = () => this.props.children;
    }

    /** 只声明 count 的消费者；日志核对外层更新穿过另一个 Provider。 */
    class Child extends React.Component {
      /** Child.contextTypes 在“多层 Provider 更新 context 后代”场景声明允许读取的 legacy context 键，未声明值会在传入组件前被 mask。 */
      static contextTypes = {
        count: PropTypes.number,
      };
      /** Child.render 在“多层 Provider 更新 context 后代”场景以字段函数读取 props/state/context 并返回子树；返回值透传既有子元素；该字段本身未写日志，后代是否执行由 Child 的日志判断。 */
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
   * 外层countProvider→固定SCU false的MiddleScu→nameProvider→只读count的Child，挂载日志count:0；外层updateCount后waitForAll([])无新消费者日志。验证本轮legacy传播受class bailout限制，不直接断言宿主文本。
   */
  // @gate !disableLegacyContext
  it('should not update descendants with new context values if shouldComponentUpdate returns false', async () => {
    let instance;

    /** 更新 count 的外层 Provider，中间 SCU false 会阻断本轮后代 render。 */
    class TopContextProvider extends React.Component {
      /** TopContextProvider.childContextTypes 在“shouldComponentUpdate false 阻止 context 后代更新”场景声明 Provider 可向后代发布的 legacy context 键，限制 getChildContext 的输出边界。 */
      static childContextTypes = {
        count: PropTypes.number,
      };
      /** 初始化 count=0 并保存实例，供 updateCount 触发传播对照。 */
      constructor() {
        super();
        this.state = {count: 0};
        instance = this;
      }
      /** TopContextProvider.getChildContext 在“shouldComponentUpdate false 阻止 context 后代更新”场景以字段函数发布当前 legacy context；闭包读取实例 state，更新后形成新的 Provider 值。 */
      getChildContext = () => ({
        count: this.state.count,
      });
      /** TopContextProvider.render 在“shouldComponentUpdate false 阻止 context 后代更新”场景以字段函数读取 props/state/context 并返回子树；返回值透传既有子元素；该字段本身未写日志，后代是否执行由 Child 的日志判断。 */
      render = () => this.props.children;
      /** TopContextProvider.updateCount 在“shouldComponentUpdate false 阻止 context 后代更新”场景封装 setState，作为测试精确触发 Provider 或中间层 context 变化的入口。 */
      updateCount = () =>
        this.setState(state => ({
          count: state.count + 1,
        }));
    }

    /** 固定拒绝更新的中间层，验证 legacy context 本轮不会强制穿过它。 */
    class MiddleScu extends React.Component {
      /** 固定返回 false，不进入自身或无待处理工作的后代 render。 */
      shouldComponentUpdate() {
        return false;
      }
      /** MiddleScu.render 在“shouldComponentUpdate false 阻止 context 后代更新”场景以字段函数读取 props/state/context 并返回子树；返回值透传既有子元素；该字段本身未写日志，后代是否执行由 Child 的日志判断。 */
      render = () => this.props.children;
    }

    /** 发布固定 name 的内层 Provider，在上层拒绝更新时本轮不重新访问。 */
    class MiddleContextProvider extends React.Component {
      /** MiddleContextProvider.childContextTypes 在“shouldComponentUpdate false 阻止 context 后代更新”场景声明 Provider 可向后代发布的 legacy context 键，限制 getChildContext 的输出边界。 */
      static childContextTypes = {
        name: PropTypes.string,
      };
      /** MiddleContextProvider.getChildContext 发布固定 name:brian；SCU bailout 的更新轮次不会重新进入本层。 */
      getChildContext = () => ({
        name: 'brian',
      });
      /** MiddleContextProvider.render 在“shouldComponentUpdate false 阻止 context 后代更新”场景以字段函数读取 props/state/context 并返回子树；返回值透传既有子元素；该字段本身未写日志，后代是否执行由 Child 的日志判断。 */
      render = () => this.props.children;
    }

    /** 只观察 count 的后代消费者；本轮 updateCount 后无新日志，不直接验证宿主文本。 */
    class Child extends React.Component {
      /** Child.contextTypes 在“shouldComponentUpdate false 阻止 context 后代更新”场景声明允许读取的 legacy context 键，未声明值会在传入组件前被 mask。 */
      static contextTypes = {
        count: PropTypes.number,
      };
      /** Child.render 在“shouldComponentUpdate false 阻止 context 后代更新”场景以字段函数读取 props/state/context 并返回子树；返回值透传既有子元素；该字段本身未写日志，后代是否执行由 Child 的日志判断。 */
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
   * 顶层count0先更新到1但MiddleScu拒绝自身render，消费者暂时无日志；随后内层Provider自身name改not brian，其childLanes可穿过该bailout路径。Child最后同时读count:1/name:not brian，验证下游更新时仍取最新祖先context。
   */
  // @gate !disableLegacyContext
  it('should update descendants with new context values if setState() is called in the middle of the tree', async () => {
    let middleInstance;
    let topInstance;

    /** 提供 count 的外层 Provider；初次顶层更新被 MiddleScu 挡住，随后中层自身更新需读取最新 count。 */
    class TopContextProvider extends React.Component {
      /** TopContextProvider.childContextTypes 在“树中部 setState 驱动 context 后代更新”场景声明 Provider 可向后代发布的 legacy context 键，限制 getChildContext 的输出边界。 */
      static childContextTypes = {
        count: PropTypes.number,
      };
      /** 初始化 count=0 并暴露 topInstance，作为两步更新中的第一入口。 */
      constructor() {
        super();
        this.state = {count: 0};
        topInstance = this;
      }
      /** TopContextProvider.getChildContext 在“树中部 setState 驱动 context 后代更新”场景以字段函数发布当前 legacy context；闭包读取实例 state，更新后形成新的 Provider 值。 */
      getChildContext = () => ({
        count: this.state.count,
      });
      /** TopContextProvider.render 在“树中部 setState 驱动 context 后代更新”场景以字段函数读取 props/state/context 并返回子树；返回值透传既有子元素；该字段本身未写日志，后代是否执行由 Child 的日志判断。 */
      render = () => this.props.children;
      /** TopContextProvider.updateCount 在“树中部 setState 驱动 context 后代更新”场景封装 setState，作为测试精确触发 Provider 或中间层 context 变化的入口。 */
      updateCount = () =>
        this.setState(state => ({
          count: state.count + 1,
        }));
    }

    /** 固定拒绝由祖先变化触发的自身 render，但后代自身 lane 仍可向下穿过。 */
    class MiddleScu extends React.Component {
      /** 返回 false；不能将此判断解释为永远阻止已有 childLanes 的更新。 */
      shouldComponentUpdate() {
        return false;
      }
      /** MiddleScu.render 在“树中部 setState 驱动 context 后代更新”场景以字段函数读取 props/state/context 并返回子树；返回值透传既有子元素；该字段本身未写日志，后代是否执行由 Child 的日志判断。 */
      render = () => this.props.children;
    }

    /** 持有 name 的内层 Provider，其直接 state 更新应同时合并最新祖先 count。 */
    class MiddleContextProvider extends React.Component {
      /** MiddleContextProvider.childContextTypes 在“树中部 setState 驱动 context 后代更新”场景声明 Provider 可向后代发布的 legacy context 键，限制 getChildContext 的输出边界。 */
      static childContextTypes = {
        name: PropTypes.string,
      };
      /** 初始化 name=brian 并暴露 middleInstance，后续更新为 not brian。 */
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
      /** MiddleContextProvider.render 在“树中部 setState 驱动 context 后代更新”场景以字段函数读取 props/state/context 并返回子树；返回值透传既有子元素；该字段本身未写日志，后代是否执行由 Child 的日志判断。 */
      render = () => this.props.children;
    }

    /** 同时声明 count/name 的消费者，最终日志为 count:1,name:not brian。 */
    class Child extends React.Component {
      /** Child.contextTypes 在“树中部 setState 驱动 context 后代更新”场景声明允许读取的 legacy context 键，未声明值会在传入组件前被 mask。 */
      static contextTypes = {
        count: PropTypes.number,
        name: PropTypes.string,
      };
      /** Child.render 在“树中部 setState 驱动 context 后代更新”场景以字段函数读取 props/state/context 并返回子树；返回值透传既有子元素；该字段本身未写日志，后代是否执行由 Child 的日志判断。 */
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
   * transition渲染step1暂停在Parent之后，再普通root.render(step2)；预期先Child:1，再Parent:2/Child:2，说明本次新更新没有在该暂停位置重开已有render。标题称same priority，但实际入口分别是transition与普通更新，不能据此声称它们获得同一lane。
   */
  it('does not interrupt for update at same priority', async () => {
    /** 记录 step 并返回 Child；初始 transition render 可暂停在父后，以 step2 普通根更新观察是否重开。 */
    function Parent(props) {
      Scheduler.log('Parent: ' + props.step);
      return <Child step={props.step} />;
    }

    /** 记录 step 并返回 null，Child:1 先出现证明当前 transition 被继续。 */
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
   * transition的step1停在Parent后，mock时钟推进2000ms再普通render(step2)；日志仍先完成Child:1再执行step2。没有显式调低新更新lane的入口，此断言只证明该组合未抢占当前render，不能由标题推成普遍低优先级规则。
   */
  it('does not interrupt for update at lower priority', async () => {
    /** 记录 step 并返回 Child；模拟时钟前进2000后再排 step2，观察原工作仍先完成。 */
    function Parent(props) {
      Scheduler.log('Parent: ' + props.step);
      return <Child step={props.step} />;
    }

    /** 记录 step 并返回 null，断言次序为 Child:1 再 Parent/Child:2，不直接验证宿主输出。 */
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
   * transition step1停在Parent后，flushSync render(step2)立即日志Parent:2/Child:2；之后waitForAll([])不再出现Child:1。验证同步根输入抢占旧工作，本例返回null所以没有高优先级宿主结果先提交的断言。
   */
  it('does interrupt for update at higher priority', async () => {
    /** 记录 step 并返回 Child，transition 在 step1 的父后停下，再由 flushSync step2 抢占。 */
    function Parent(props) {
      Scheduler.log('Parent: ' + props.step);
      return <Child step={props.step} />;
    }

    /** 记录 step 并返回 null，同步断言只有 step2，后续无 step1 子日志。 */
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
   * 先包装真实Map#set捕获不可扩展对象key，重载React并用StrictMode legacy Boundary触发Fiber-key警告路径，断言仅DEV收到不可扩展对象；再安装会写key的包装、再次重载React，同路径完成不抛冻结写入错误。两段finally都恢复Map#set，验证初始化特性探测绕过不良polyfill下的preventExtensions。
   */
  // @gate !disableLegacyContext || !__DEV__
  it('does not break with a bad Map polyfill', async () => {
    const realMapSet = Map.prototype.set;

    /** triggerCodePathThatUsesFibersAsMapKeys 渲染会触发 legacy context 警告的错误边界，使内部警告 Map 实际接收 Fiber key。 */
    async function triggerCodePathThatUsesFibersAsMapKeys() {
      /** 固定抛 No.，让 StrictMode Boundary 进入警告和错误处理的 Fiber-key Map 路径。 */
      function Thing() {
        throw new Error('No.');
      }
      // 该 class 使用 legacy context，会触发警告；
      // 警告流程使用 Map 存储 Fiber。
      /** 使用 legacy context 的错误边界，挂载警告会触发 Fiber 作为 Map key 的代码路径。 */
      class Boundary extends React.Component {
        /** 初始 didError=false，componentDidCatch 写 true 后停止返回 Thing。 */
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
        /** 错误前返回 Thing，错误后返回 null，避免持续抛错；输出不是本例的验证目标。 */
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
    /** 包装真实 Map#set，检测接收到的非空对象 key 是否不可扩展，再原样转发全部 arguments；finally 恢复原实现。 */ Map.prototype.set = function (key) {
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
    /** 模拟会写 key.__internalValueSlot 的 Map polyfill，再转发真实 set；重新加载 React 使特性探测在该包装下执行，finally 恢复。 */ Map.prototype.set = function (key, value) {
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
