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
let waitForAll;
let waitFor;
let waitForPaint;

/** 覆盖增量协调在插入、移动、删除、抢占与恢复时生成和提交副作用的完整性。 */
describe('ReactIncrementalSideEffects', () => {
  /** 每个场景重建 Noop 渲染器和可逐步推进的调度辅助器。 */
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
    Scheduler = require('scheduler');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    waitFor = InternalTestUtils.waitFor;
    waitForPaint = InternalTestUtils.waitForPaint;
  });

  /**
   * 用宿主 div 包装旧版隐藏树，使测试既能观察 hidden 属性又能降低内部工作的优先级。
   * 来源于 www 的同类组件；当额外 div 不再必要时可删除该兼容层。
   */
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
   * 场景（Given–When–Then）：给定宿主 div 内一个 Bar；当 Hello→World 更新同时新增第二个 Bar；
   * 那么原节点文本更新且新节点按序插入。对应机制：宿主父节点的 Update 与 Placement flags。
   */
  it('can update child nodes of a host instance', async () => {
    /** 把输入文本包装为宿主 span。 */
    function Bar(props) {
      return <span>{props.text}</span>;
    }

    /** 在 World 状态下向宿主 div 追加第二个 Bar。 */
    function Foo(props) {
      return (
        <div>
          <Bar text={props.text} />
          {props.text === 'World' ? <Bar text={props.text} /> : null}
        </div>
      );
    }

    ReactNoop.render(<Foo text="Hello" />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span>Hello</span>
      </div>,
    );

    ReactNoop.render(<Foo text="World" />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span>World</span>
        <span>World</span>
      </div>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定 keyed fragment 兄弟；当 Hello→World 插入数组，再更新为 Hi
   * 并交换 div/Bar 顺序；那么节点按 key 复用、移动且尾部 span 不受影响。
   * 对应机制：数组 reconciliation 的 Placement/移动判定。
   */
  it('can update child nodes of a fragment', async function () {
    /** 把当前文本包装为可 keyed 复用的 span。 */
    function Bar(props) {
      return <span>{props.text}</span>;
    }

    /** 根据文本在 keyed fragment 的缺失、插入和换序三种形态间切换。 */
    function Foo(props) {
      return (
        <div>
          <Bar text={props.text} />
          {props.text === 'World'
            ? [<Bar key="a" text={props.text} />, <div key="b" />]
            : props.text === 'Hi'
              ? [<div key="b" />, <Bar key="a" text={props.text} />]
              : null}
          <span prop="test" />
        </div>
      );
    }

    ReactNoop.render(<Foo text="Hello" />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span>Hello</span>
        <span prop="test" />
      </div>,
    );

    ReactNoop.render(<Foo text="World" />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span>World</span>
        <span>World</span>
        <div />
        <span prop="test" />
      </div>,
    );

    ReactNoop.render(<Foo text="Hi" />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span>Hi</span>
        <div />
        <span>Hi</span>
        <span prop="test" />
      </div>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定组件直接返回宿主文本；当更新到 World 并追加同类文本和感叹号；
   * 那么宿主 div 文本合并为 WorldWorld!。对应机制：HostText 更新与 fragment 插入。
   */
  it('can update child nodes rendering into text nodes', async function () {
    /** 直接返回字符串，生成 HostText Fiber。 */
    function Bar(props) {
      return props.text;
    }

    /** 在 World 状态下组合两个组件文本与一个原生字符串。 */
    function Foo(props) {
      return (
        <div>
          <Bar text={props.text} />
          {props.text === 'World'
            ? [<Bar key="a" text={props.text} />, '!']
            : null}
        </div>
      );
    }

    ReactNoop.render(<Foo text="Hello" />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<div>Hello</div>);

    ReactNoop.render(<Foo text="World" />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<div>WorldWorld!</div>);
  });

  /**
   * 场景（Given–When–Then）：给定 div 下同时存在宿主节点、组件节点和文本节点；当 show 变 false；
   * 那么三类子节点都被删除且父 div 保留。对应机制：deletion list 覆盖不同 Fiber tag。
   */
  it('can deletes children either components, host or text', async function () {
    /** 把 children 映射到 span 的 prop，代表可删除的函数组件分支。 */
    function Bar(props) {
      return <span prop={props.children} />;
    }

    /** 通过 `show` 一次性插入或清空三种类型的子节点。 */
    function Foo(props) {
      return (
        <div>
          {props.show
            ? [<div key="a" />, <Bar key="b">Hello</Bar>, 'World']
            : []}
        </div>
      );
    }

    ReactNoop.render(<Foo show={true} />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <div />
        <span prop="Hello" />
        World
      </div>,
    );

    ReactNoop.render(<Foo show={false} />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<div />);
  });

  /**
   * 场景（Given–When–Then）：给定无显式 key 的同一位置依次渲染类组件、函数组件、文本和空；
   * 当类型变化；那么旧类组件只卸载一次且尾随文本稳定。对应机制：隐式索引 key 下类型不匹配删除。
   */
  it('can delete a child that changes type - implicit keys', async function () {
    let unmounted = false;

    /** 记录类型替换时是否触发卸载，并输出 Class span。 */
    class ClassComponent extends React.Component {
      /** 将类分支已卸载的事实写入测试探针。 */
      componentWillUnmount() {
        unmounted = true;
      }
      /** 输出代表类分支的宿主节点。 */
      render() {
        return <span prop="Class" />;
      }
    }

    /** 输出代表函数分支的宿主节点。 */
    function FunctionComponent(props) {
      return <span prop="Function" />;
    }

    /** 在同一隐式 key 槽位按 props 切换四种子节点形态。 */
    function Foo(props) {
      return (
        <div>
          {props.useClass ? (
            <ClassComponent />
          ) : props.useFunction ? (
            <FunctionComponent />
          ) : props.useText ? (
            'Text'
          ) : null}
          Trail
        </div>
      );
    }

    ReactNoop.render(<Foo useClass={true} />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span prop="Class" />
        Trail
      </div>,
    );

    expect(unmounted).toBe(false);

    ReactNoop.render(<Foo useFunction={true} />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span prop="Function" />
        Trail
      </div>,
    );

    expect(unmounted).toBe(true);

    ReactNoop.render(<Foo useText={true} />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<div>TextTrail</div>);

    ReactNoop.render(<Foo />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<div>Trail</div>);
  });

  /**
   * 场景（Given–When–Then）：给定类组件与函数组件共享显式 key `a`；当类型替换再删除；
   * 那么 key 相同也不能跨类型复用，旧类组件仍卸载一次。
   * 对应机制：key 与 elementType 共同决定 Fiber 身份。
   */
  it('can delete a child that changes type - explicit keys', async function () {
    let unmounted = false;

    /** 记录显式 key 下类型替换时的卸载。 */
    class ClassComponent extends React.Component {
      /** 将类分支已卸载的事实写入测试探针。 */
      componentWillUnmount() {
        unmounted = true;
      }
      /** 输出代表类分支的宿主节点。 */
      render() {
        return <span prop="Class" />;
      }
    }

    /** 输出与类分支同 key、不同类型的函数分支。 */
    function FunctionComponent(props) {
      return <span prop="Function" />;
    }

    /** 在显式 key `a` 的槽位切换类组件、函数组件或空。 */
    function Foo(props) {
      return (
        <div>
          {props.useClass ? (
            <ClassComponent key="a" />
          ) : props.useFunction ? (
            <FunctionComponent key="a" />
          ) : null}
          Trail
        </div>
      );
    }

    ReactNoop.render(<Foo useClass={true} />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span prop="Class" />
        Trail
      </div>,
    );

    expect(unmounted).toBe(false);

    ReactNoop.render(<Foo useFunction={true} />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span prop="Function" />
        Trail
      </div>,
    );

    expect(unmounted).toBe(true);

    ReactNoop.render(<Foo />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<div>Trail</div>);
  });

  /**
   * 场景（Given–When–Then）：给定 Foo 本身保留但 portal 内 children 在有/无之间切换；当多次
   * 更新并最终卸载根；那么 portal 容器插入、清空、重建均正确，主根始终只含外层 div。
   * 对应机制：HostPortal 的独立 container deletion list。
   */
  it('can delete a child when it unmounts inside a portal', async () => {
    /** 生成 portal 中的组件型 span 子节点。 */
    function Bar(props) {
      return <span prop={props.children} />;
    }

    const portalContainer =
      ReactNoop.getOrCreateRootContainer('portalContainer');
    /** 将可选三类子节点渲染进独立 portal 容器。 */
    function Foo(props) {
      return ReactNoop.createPortal(
        props.show ? [<div key="a" />, <Bar key="b">Hello</Bar>, 'World'] : [],
        portalContainer,
        null,
      );
    }

    ReactNoop.render(
      <div>
        <Foo show={true} />
      </div>,
    );
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<div />);
    expect(ReactNoop.getChildrenAsJSX('portalContainer')).toEqual(
      <>
        <div />
        <span prop="Hello" />
        World
      </>,
    );

    ReactNoop.render(
      <div>
        <Foo show={false} />
      </div>,
    );
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<div />);
    expect(ReactNoop.getChildrenAsJSX('portalContainer')).toEqual(null);

    ReactNoop.render(
      <div>
        <Foo show={true} />
      </div>,
    );
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<div />);
    expect(ReactNoop.getChildrenAsJSX('portalContainer')).toEqual(
      <>
        <div />
        <span prop="Hello" />
        World
      </>,
    );

    ReactNoop.render(null);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(null);
    expect(ReactNoop.getChildrenAsJSX('portalContainer')).toEqual(null);

    ReactNoop.render(<Foo show={false} />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(null);
    expect(ReactNoop.getChildrenAsJSX('portalContainer')).toEqual(null);

    ReactNoop.render(<Foo show={true} />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(null);
    expect(ReactNoop.getChildrenAsJSX('portalContainer')).toEqual(
      <>
        <div />
        <span prop="Hello" />
        World
      </>,
    );

    ReactNoop.render(null);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(null);
    expect(ReactNoop.getChildrenAsJSX('portalContainer')).toEqual(null);
  });

  /**
   * 场景（Given–When–Then）：给定 Foo 始终创建固定 portal children；当 Foo 随主树反复挂载/卸载；
   * 那么 portal 容器随 Fiber 删除清空并可重新插入。对应机制：删除 HostPortal 父 Fiber 时遍历后代。
   */
  it('can delete a child when it unmounts with a portal', async () => {
    /** 生成 portal 中的组件型 span 子节点。 */
    function Bar(props) {
      return <span prop={props.children} />;
    }

    const portalContainer =
      ReactNoop.getOrCreateRootContainer('portalContainer');
    /** 始终把固定三类 children 渲染到 portal 容器。 */
    function Foo(props) {
      return ReactNoop.createPortal(
        [<div key="a" />, <Bar key="b">Hello</Bar>, 'World'],
        portalContainer,
        null,
      );
    }

    ReactNoop.render(
      <div>
        <Foo />
      </div>,
    );
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<div />);
    expect(ReactNoop.getChildrenAsJSX('portalContainer')).toEqual(
      <>
        <div />
        <span prop="Hello" />
        World
      </>,
    );

    ReactNoop.render(null);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(null);
    expect(ReactNoop.getChildrenAsJSX('portalContainer')).toEqual(null);

    ReactNoop.render(<Foo />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(null);
    expect(ReactNoop.getChildrenAsJSX('portalContainer')).toEqual(
      <>
        <div />
        <span prop="Hello" />
        World
      </>,
    );

    ReactNoop.render(null);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(null);
    expect(ReactNoop.getChildrenAsJSX('portalContainer')).toEqual(null);
  });

  /**
   * 场景（Given–When–Then）：给定已提交 Hello 树；当 transition 更新 World 只执行 Foo 与首个 Bar
   * 后暂停、尚未 commit；那么宿主输出仍是完整旧树。对应机制：render phase 不提前变更 current 宿主树。
   */
  it('does not update child nodes if a flush is aborted', async () => {
    /** 记录增量 render 单元并输出带文本 prop 的 span。 */
    function Bar(props) {
      Scheduler.log('Bar');
      return <span prop={props.text} />;
    }

    /** 生成可在第二个 Bar 前让出的多层宿主树。 */
    function Foo(props) {
      Scheduler.log('Foo');
      return (
        <div>
          <div>
            <Bar text={props.text} />
            {props.text === 'Hello' ? <Bar text={props.text} /> : null}
          </div>
          <Bar text="Yo" />
        </div>
      );
    }

    ReactNoop.render(<Foo text="Hello" />);
    await waitForAll(['Foo', 'Bar', 'Bar', 'Bar']);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <div>
          <span prop="Hello" />
          <span prop="Hello" />
        </div>
        <span prop="Yo" />
      </div>,
    );

    React.startTransition(() => {
      ReactNoop.render(<Foo text="World" />);
    });

    // 只刷新部分 render 工作，不进入 commit。
    await waitFor(['Foo', 'Bar']);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <div>
          <span prop="Hello" />
          <span prop="Hello" />
        </div>
        <span prop="Yo" />
      </div>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定 LegacyHidden 中已提交 foo；当根更新 bar 时先只完成高优先级
   * 外层并 commit；那么隐藏节点暂时保留 foo，低优先级完成后才变 bar。
   * 对应机制：隐藏子树延后 lane 与 current 节点保留。
   */
  // @gate enableLegacyHidden
  it('preserves a previously rendered node when deprioritized', async () => {
    /** 记录隐藏子树何时真正执行，并输出 children prop。 */
    function Middle(props) {
      Scheduler.log('Middle');
      return <span prop={props.children} />;
    }

    /** 把 Middle 放入 LegacyHidden，以分离根提交和隐藏内容更新。 */
    function Foo(props) {
      Scheduler.log('Foo');
      return (
        <div>
          <LegacyHiddenDiv mode="hidden">
            <Middle>{props.text}</Middle>
          </LegacyHiddenDiv>
        </div>
      );
    }

    ReactNoop.render(<Foo text="foo" />);
    await waitForAll(['Foo', 'Middle']);

    expect(ReactNoop.getChildrenAsJSX()).toEqual(
      <div>
        <div hidden={true}>
          <span prop="foo" />
        </div>
      </div>,
    );

    ReactNoop.render(<Foo text="bar" />, () => Scheduler.log('commit'));
    await waitFor(['Foo', 'commit']);
    expect(ReactNoop.getChildrenAsJSX()).toEqual(
      <div>
        <div hidden={true}>
          <span prop="foo" />
        </div>
      </div>,
    );

    await waitForAll(['Middle']);
    expect(ReactNoop.getChildrenAsJSX()).toEqual(
      <div>
        <div hidden={true}>
          <span prop="bar" />
        </div>
      </div>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定隐藏树从 Hi/foo 更新到静态 Hello/World，且只完成首个 Bar 后
   * 被更高优先级根更新抢占；当恢复低优先级工作；那么复用已完成 Bar 并重放其 Placement/Update。
   * 对应机制：可恢复 work-in-progress 保存未提交副作用链。
   */
  // @gate enableLegacyHidden
  it('can reuse side-effects after being preempted', async () => {
    /** 记录隐藏树中的每个工作单元，并输出 children prop。 */
    function Bar(props) {
      Scheduler.log('Bar');
      return <span prop={props.children} />;
    }

    const middleContent = (
      <div>
        <Bar>Hello</Bar>
        <Bar>World</Bar>
      </div>
    );

    /** 在动态初始树和引用稳定的 `middleContent` 之间切换。 */
    function Foo(props) {
      Scheduler.log('Foo');
      return (
        <LegacyHiddenDiv mode="hidden">
          {props.step === 0 ? (
            <div>
              <Bar>Hi</Bar>
              <Bar>{props.text}</Bar>
            </div>
          ) : (
            middleContent
          )}
        </LegacyHiddenDiv>
      );
    }

    // 建立初始隐藏树。
    ReactNoop.render(<Foo text="foo" step={0} />);
    await waitForAll(['Foo', 'Bar', 'Bar']);

    expect(ReactNoop.getChildrenAsJSX()).toEqual(
      <div hidden={true}>
        <div>
          <span prop="Hi" />
          <span prop="foo" />
        </div>
      </div>,
    );

    // 快速根更新安排低优先级的中间内容替换。
    ReactNoop.render(<Foo text="bar" step={1} />, () =>
      Scheduler.log('commit'),
    );
    await waitFor(['Foo', 'commit', 'Bar']);

    // 未提交隐藏工作前，宿主树保持不变。
    expect(ReactNoop.getChildrenAsJSX()).toEqual(
      <div hidden={true}>
        <div>
          <span prop="Hi" />
          <span prop="foo" />
        </div>
      </div>,
    );

    // 首个 Bar 已完成但尚未提交；用更高优先级更新抢占。middleContent 身份稳定会 bailout，
    // 下次恢复应复用刚才完成的工作。
    ReactNoop.render(<Foo text="foo" step={1} />);
    await waitForAll(['Foo', 'Bar', 'Bar']);

    // 抢占期间未修改中间子树，应从断点复用协调结果并仍然重放副作用，而非重头开始。

    expect(ReactNoop.getChildrenAsJSX()).toEqual(
      <div hidden={true}>
        <div>
          <span prop="Hello" />
          <span prop="World" />
        </div>
      </div>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定 Content/Bar 通过 shouldComponentUpdate 精确 bailout，隐藏更新
   * 在首个 Bar 后被相同 step 的高优先级工作抢占；当恢复；那么已完成副作用仍被复用并提交。
   * 对应机制：SCU bailout 克隆 child lanes 时不丢失可恢复 effect flags。
   */
  // @gate enableLegacyHidden
  it('can reuse side-effects after being preempted, if shouldComponentUpdate is false', async () => {
    /** 仅 children 改变时更新，暴露 Bar bailout 边界。 */
    class Bar extends React.Component {
      /** 比较 children，未变化时跳过本 Bar。 */
      shouldComponentUpdate(nextProps) {
        return this.props.children !== nextProps.children;
      }
      /** 记录实际执行并输出 children prop。 */
      render() {
        Scheduler.log('Bar');
        return <span prop={this.props.children} />;
      }
    }

    /** 根据 step 选择初始或最终两项，并可在 step 不变时整体 bailout。 */
    class Content extends React.Component {
      /** 只有 step 改变才重渲染内容容器。 */
      shouldComponentUpdate(nextProps) {
        return this.props.step !== nextProps.step;
      }
      /** 记录执行并生成两个可独立 bailout 的 Bar。 */
      render() {
        Scheduler.log('Content');
        return (
          <div>
            <Bar>{this.props.step === 0 ? 'Hi' : 'Hello'}</Bar>
            <Bar>{this.props.step === 0 ? this.props.text : 'World'}</Bar>
          </div>
        );
      }
    }

    /** 把 Content 放入 LegacyHidden 并透传 step/text。 */
    function Foo(props) {
      Scheduler.log('Foo');
      return (
        <LegacyHiddenDiv mode="hidden">
          <Content step={props.step} text={props.text} />
        </LegacyHiddenDiv>
      );
    }

    // 建立初始隐藏树。
    ReactNoop.render(<Foo text="foo" step={0} />);
    await waitForAll(['Foo', 'Content', 'Bar', 'Bar']);

    expect(ReactNoop.getChildrenAsJSX()).toEqual(
      <div hidden={true}>
        <div>
          <span prop="Hi" />
          <span prop="foo" />
        </div>
      </div>,
    );

    // 快速根更新安排低优先级中间内容替换。
    ReactNoop.render(<Foo text="bar" step={1} />);
    await waitFor(['Foo', 'Content', 'Bar']);

    // 未提交隐藏工作前，宿主树保持不变。
    expect(ReactNoop.getChildrenAsJSX()).toEqual(
      <div hidden={true}>
        <div>
          <span prop="Hi" />
          <span prop="foo" />
        </div>
      </div>,
    );

    // 首个 Bar 已完成但尚未提交；更高优先级更新保持 step=1，使 Content bailout，
    // 因而恢复时应复用此前结果。
    ReactNoop.render(<Foo text="foo" step={1} />);
    await waitForAll(['Foo', 'Content', 'Bar', 'Bar']);

    // 抢占期间未修改中间子树，应从断点复用协调结果，并仍重放其副作用。

    expect(ReactNoop.getChildrenAsJSX()).toEqual(
      <div hidden={true}>
        <div>
          <span prop="Hello" />
          <span prop="World" />
        </div>
      </div>,
    );
  });

  /**
   * 场景（Given–When–Then）：给定 step 2 的树已完成 render 但尚未 commit；当根又更新到 step 3；
   * 那么先提交已就绪的 2，再继续处理并提交 3，不丢任一更新。
   * 对应机制：finishedWork 与根 pending lanes 在提交前新增更新时分别保留。
   */
  it('can update a completed tree before it has a chance to commit', async () => {
    /** 记录每个 step 的 render，并输出 step prop。 */
    function Foo(props) {
      Scheduler.log('Foo ' + props.step);
      return <span prop={props.step} />;
    }
    React.startTransition(() => {
      ReactNoop.render(<Foo step={1} />);
    });
    // 只完成树，不立即提交。
    await waitFor(['Foo 1']);
    expect(ReactNoop.getChildrenAsJSX()).toEqual(null);
    // 再执行一个工作单元，确认完成树此时提交。
    await waitForPaint([]);
    expect(ReactNoop.getChildrenAsJSX()).toEqual(<span prop={1} />);

    React.startTransition(() => {
      ReactNoop.render(<Foo step={2} />);
    });
    // 再次只完成 step 2 树而不提交。
    await waitFor(['Foo 2']);
    expect(ReactNoop.getChildrenAsJSX()).toEqual(<span prop={1} />);
    // 在提交 step 2 前，把根更新到新 props step 3。

    React.startTransition(() => {
      ReactNoop.render(<Foo step={3} />);
    });
    expect(ReactNoop.getChildrenAsJSX()).toEqual(<span prop={1} />);
    // 先提交此前已经 pending 的 step 2 完成树。
    await waitForPaint([]);
    expect(ReactNoop.getChildrenAsJSX()).toEqual(<span prop={2} />);
    // 刷新余下工作应再提交 step 3；若再次得到 2，则说明新更新被丢失。
    await waitForAll(['Foo 3']);
    expect(ReactNoop.getChildrenAsJSX()).toEqual(<span prop={3} />);
  });

  /**
   * 场景（Given–When–Then）：给定 LegacyHidden 初次挂载、旧 props 基线为空；当协调其 span；
   * 那么仍正确设置 prop=1。对应机制：隐藏树首挂不能因空旧 props 误判为 bailout。
   */
  // @gate enableLegacyHidden
  it('updates a child even though the old props is empty', async () => {
    /** 在隐藏树内首次创建带 prop 的宿主 span。 */
    function Foo(props) {
      return (
        <LegacyHiddenDiv mode="hidden">
          <span prop={1} />
        </LegacyHiddenDiv>
      );
    }

    ReactNoop.render(<Foo />);
    await waitForAll([]);
    expect(ReactNoop.getChildrenAsJSX()).toEqual(
      <div hidden={true}>
        <span prop={1} />
      </div>,
    );
  });

  /**
   * 跳过场景（Given–When–Then）：给定隐藏子树分时更新；当中途高优先级 tick 抢占再恢复；
   * 那么延迟副作用最终提交且宿主实例保持同一对象。该旧调度 API 场景当前禁用。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('can defer side-effects and resume them later on', async () => {
    /** 仅 idx 改变时更新，用于分时隐藏 span 的实例复用验证。 */
    class Bar extends React.Component {
      /** idx 相同则跳过隐藏项更新。 */
      shouldComponentUpdate(nextProps) {
        return this.props.idx !== nextProps.idx;
      }
      /** 输出当前 idx 到宿主 prop。 */
      render() {
        return <span prop={this.props.idx} />;
      }
    }
    /** 组合高优先级 tick 与两个低优先级隐藏 Bar。 */
    function Foo(props) {
      return (
        <div>
          <span prop={props.tick} />
          <div hidden={true}>
            <Bar idx={props.idx} />
            <Bar idx={props.idx + 1} />
          </div>
        </div>
      );
    }
    ReactNoop.render(<Foo tick={0} idx={0} />);
    ReactNoop.flushDeferredPri(40 + 25);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span prop={0} />
        <div />
      </div>,
    );
    ReactNoop.render(<Foo tick={1} idx={0} />);
    ReactNoop.flushDeferredPri(35 + 25);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span prop={1} />
        <div>{/* 仍未完成渲染。 */}</div>
      </div>,
    );
    ReactNoop.flushDeferredPri(30 + 25);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span prop={1} />
        <div>
          {/* 此时预算足够完成 span。 */}
          <span prop={0} />
          <span prop={1} />
        </div>
        ,
      </div>,
    );
    const innerSpanA =
      ReactNoop.dangerouslyGetChildren()[0].children[1].children[1];
    ReactNoop.render(<Foo tick={2} idx={1} />);
    ReactNoop.flushDeferredPri(30 + 25);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span prop={2} />
        <div>
          {/* 仍显示旧数字。 */}
          <span prop={0} />
          <span prop={1} />
        </div>
      </div>,
    );
    ReactNoop.render(<Foo tick={3} idx={1} />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span prop={3} />
        <div>
          {/* 更新后的数字。 */}
          <span prop={1} />
          <span prop={2} />
        </div>
      </div>,
    );

    const innerSpanB =
      ReactNoop.dangerouslyGetChildren()[0].children[1].children[1];
    // 这里应更新现有实例而非重建；通过前后对象身份相同验证。
    expect(innerSpanA).toBe(innerSpanB);
  });

  /**
   * 跳过场景（Given–When–Then）：给定三组 Baz/Bar 隐藏树只完成到不同深度；当相同 idx 更新抢占
   * 后恢复；那么复用完整和半成品工作并重放副作用。该旧调度 API 场景当前禁用。
   */
  // eslint-disable-next-line jest/no-disabled-tests
  it.skip('can defer side-effects and reuse them later - complex', async function () {
    let ops = [];

    /** 记录执行次数并仅在 idx 改变时更新叶子 span。 */
    class Bar extends React.Component {
      /** idx 相同则复用叶子工作。 */
      shouldComponentUpdate(nextProps) {
        return this.props.idx !== nextProps.idx;
      }
      /** 记录 Bar 单元并输出 idx。 */
      render() {
        ops.push('Bar');
        return <span prop={this.props.idx} />;
      }
    }
    /** 每个 Baz 生成两个 keyed Bar，形成可半途暂停的中间层。 */
    class Baz extends React.Component {
      /** idx 相同则复用整个中间层。 */
      shouldComponentUpdate(nextProps) {
        return this.props.idx !== nextProps.idx;
      }
      /** 记录 Baz 单元并生成两个同 idx 叶子。 */
      render() {
        ops.push('Baz');
        return [
          <Bar key="a" idx={this.props.idx} />,
          <Bar key="b" idx={this.props.idx} />,
        ];
      }
    }
    /** 组合高优先级 tick 与三组低优先级 Baz。 */
    function Foo(props) {
      ops.push('Foo');
      return (
        <div>
          <span prop={props.tick} />
          <div hidden={true}>
            <Baz idx={props.idx} />
            <Baz idx={props.idx} />
            <Baz idx={props.idx} />
          </div>
        </div>
      );
    }
    ReactNoop.render(<Foo tick={0} idx={0} />);
    ReactNoop.flushDeferredPri(65 + 5);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span prop={0} />
        {/* span 已降优先级，尚未渲染。 */}
        <div />
      </div>,
    );

    expect(ops).toEqual(['Foo', 'Baz', 'Bar']);
    ops = [];

    ReactNoop.render(<Foo tick={1} idx={0} />);
    ReactNoop.flushDeferredPri(70);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span prop={1} />
        {/* 仍未完成渲染。 */}
        <div />
      </div>,
    );

    expect(ops).toEqual(['Foo']);
    ops = [];

    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput([
      <div>
        <span prop={1} />,
        <div>
          {/* 此时预算足够完成全部 span。 */}
          <span prop={0} />,
          <span prop={0} />,
          <span prop={0} />,
          <span prop={0} />,
          <span prop={0} />,
          <span prop={0} />,
        </div>
      </div>,
    ]);

    expect(ops).toEqual(['Bar', 'Baz', 'Bar', 'Bar', 'Baz', 'Bar', 'Bar']);
    ops = [];

    // 更新 idx，但只允许完成一半工作。
    ReactNoop.render(<Foo tick={2} idx={1} />);
    ReactNoop.flushDeferredPri(95);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span prop={2} />,
        <div>
          {/* 仍显示旧数字。 */}
          <span prop={0} />
          <span prop={0} />
          <span prop={0} />
          <span prop={0} />
          <span prop={0} />
          <span prop={0} />
        </div>
      </div>,
    );

    // 一半预算产生一个完整 Baz、一个半完成 Baz 和一个完全未开始 Baz。
    expect(ops).toEqual(['Foo', 'Baz', 'Bar', 'Bar', 'Baz', 'Bar']);
    ops = [];

    // 再次更新，但仍只给半程预算，不让新 idx 完整提交。
    ReactNoop.render(<Foo tick={3} idx={1} />);
    ReactNoop.flushDeferredPri(50);
    expect(ReactNoop).toMatchRenderedOutput(
      <div>
        <span prop={3} />
        <div>
          {/* 旧数字。 */}
          <span prop={0} />
          <span prop={0} />
          <span prop={0} />
          <span prop={0} />
          <span prop={0} />
          <span prop={0} />
        </div>
      </div>,
    );

    expect(ops).toEqual(['Foo']);
    ops = [];

    // 恢复时应复用已经完成的部分工作，并重放其副作用。
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput([
      <div>
        <span prop={3} />,
        <div>
          {/* 新数字。 */}
          <span prop={1} />
          <span prop={1} />
          <span prop={1} />
          <span prop={1} />
          <span prop={1} />
          <span prop={1} />
        </div>
      </div>,
    ]);

    expect(ops).toEqual(['Bar', 'Baz', 'Bar', 'Bar']);
  });

  /**
   * 场景（Given–When–Then）：给定隐藏树的三个 Bar 正在低优先级更新，其中首个 Bar 又 setState；
   * 当只刷新部分工作；那么局部状态也随隐藏 lane 延后，完整刷新时与其余 props 更新一起提交。
   * 对应机制：隐藏 Offscreen 上下文降低后代 state update 的调度优先级。
   */
  // @gate enableLegacyHidden
  it('deprioritizes setStates that happens within a deprioritized tree', async () => {
    const barInstances = [];

    /** 保存本地 active 状态，并把每个实例暴露给测试触发隐藏树内部更新。 */
    class Bar extends React.Component {
      /** 初始化 inactive 状态。 */
      constructor() {
        super();
        this.state = {active: false};
      }
      /** 在隐藏树内部安排 active=true 的状态更新。 */
      activate() {
        this.setState({active: true});
      }
      /** 记录执行，并在 active 时输出 X、否则输出外部 idx。 */
      render() {
        barInstances.push(this);
        Scheduler.log('Bar');
        return <span prop={this.state.active ? 'X' : this.props.idx} />;
      }
    }
    /** 组合立即更新的 tick 与三个降优先级 Bar。 */
    function Foo(props) {
      Scheduler.log('Foo');
      return (
        <div>
          <span prop={props.tick} />
          <LegacyHiddenDiv mode="hidden">
            <Bar idx={props.idx} />
            <Bar idx={props.idx} />
            <Bar idx={props.idx} />
          </LegacyHiddenDiv>
        </div>
      );
    }
    ReactNoop.render(<Foo tick={0} idx={0} />);
    await waitForAll(['Foo', 'Bar', 'Bar', 'Bar']);
    expect(ReactNoop.getChildrenAsJSX()).toEqual(
      <div>
        <span prop={0} />
        <div hidden={true}>
          <span prop={0} />
          <span prop={0} />
          <span prop={0} />
        </div>
      </div>,
    );

    ReactNoop.render(<Foo tick={1} idx={1} />);
    await waitFor(['Foo', 'Bar', 'Bar']);
    expect(ReactNoop.getChildrenAsJSX()).toEqual(
      <div>
        {/* 高优先级部分已更新。 */}
        <span prop={1} />
        <div hidden={true}>
          <span prop={0} />
          <span prop={0} />
          <span prop={0} />
        </div>
      </div>,
    );

    barInstances[0].activate();

    // 当前预算不足以完成所有隐藏项；隐藏树内的 setState 同样被降优先级。
    // ReactNoop.flushDeferredPri(35);
    await waitFor(['Bar']);
    expect(ReactNoop.getChildrenAsJSX()).toEqual(
      <div>
        {/* 高优先级部分已更新。 */}
        <span prop={1} />
        <div hidden={true}>
          {/* 隐藏项仍未更新。 */}
          <span prop={0} />
          <span prop={0} />
          <span prop={0} />
        </div>
      </div>,
    );

    // 完整刷新时预算足够，一次完成局部状态与其余隐藏项。
    await waitForAll(['Bar', 'Bar']);
    expect(ReactNoop.getChildrenAsJSX()).toEqual(
      <div>
        <span prop={1} />
        <div hidden={true}>
          {/* 此时预算足够完成 span。 */}
          <span prop="X" />
          <span prop={1} />
          <span prop={1} />
        </div>
      </div>,
    );
  });
  // TODO：补测低优先级 work-in-progress 未刷新就变为 current 时副作用不会被截断；
  // 需先确认这种状态是否可能发生，例如子节点因更低优先级而未被处理。

  /**
   * 场景（Given–When–Then）：给定类组件 setState 带回调；当更新被刷新并提交；那么回调执行时
   * 宿主输出已是 bar。对应机制：update callback 位于 commit layout 阶段、晚于 mutation。
   */
  it('calls callback after update is flushed', async () => {
    let instance;
    /** 暴露实例并渲染 state.text，供 setState 回调观察已提交宿主树。 */
    class Foo extends React.Component {
      /** 初始化实例探针和文本状态。 */
      constructor() {
        super();
        instance = this;
        this.state = {text: 'foo'};
      }
      /** 输出当前 state.text。 */
      render() {
        return <span prop={this.state.text} />;
      }
    }

    ReactNoop.render(<Foo />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="foo" />);
    let called = false;
    instance.setState({text: 'bar'}, () => {
      expect(ReactNoop).toMatchRenderedOutput(<span prop="bar" />);
      called = true;
    });
    await waitForAll([]);
    expect(called).toBe(true);
  });

  /**
   * 场景（Given–When–Then）：给定 setState 不改变 state、SCU 因此返回 false；当更新队列提交；
   * 那么回调仍执行。对应机制：Callback flag 独立于组件是否重渲染。
   */
  it('calls setState callback even if component bails out', async () => {
    let instance;
    /** 暴露实例，并用 SCU 演示空更新的 bailout 不吞回调。 */
    class Foo extends React.Component {
      /** 初始化实例探针和文本状态。 */
      constructor() {
        super();
        instance = this;
        this.state = {text: 'foo'};
      }
      /** 仅文本真正变化时允许 render。 */
      shouldComponentUpdate(nextProps, nextState) {
        return this.state.text !== nextState.text;
      }
      /** 输出当前 state.text。 */
      render() {
        return <span prop={this.state.text} />;
      }
    }

    ReactNoop.render(<Foo />);
    await waitForAll([]);
    expect(ReactNoop).toMatchRenderedOutput(<span prop="foo" />);
    let called = false;
    instance.setState({}, () => {
      called = true;
    });
    await waitForAll([]);
    expect(called).toBe(true);
  });

  // TODO：补测更新被抢占后 update callback 仍不会丢失。

  /**
   * 场景（Given–When–Then）：给定多层、数组和宿主嵌套中的 A–G 可删除组件；当 show 变 false；
   * 那么 componentWillUnmount 以深度优先的稳定顺序执行，常驻节点不卸载。
   * 对应机制：commit deletion 递归访问组件与 Wrapper 后代。
   */
  it('calls componentWillUnmount after a deletion, even if nested', async () => {
    const ops = [];

    /** 在卸载时把自身 name 追加到顺序探针。 */
    class Bar extends React.Component {
      /** 记录当前 Bar 的卸载顺序。 */
      componentWillUnmount() {
        ops.push(this.props.name);
      }
      /** 输出无内容 span。 */
      render() {
        return <span />;
      }
    }

    /** 包装一个 Bar，并单独记录 Wrapper 自身卸载。 */
    class Wrapper extends React.Component {
      /** 在后代 Bar 前记录 Wrapper 的卸载生命周期。 */
      componentWillUnmount() {
        ops.push('Wrapper');
      }
      /** 把 name 透传给内部 Bar。 */
      render() {
        return <Bar name={this.props.name} />;
      }
    }

    /** 构造数组、Wrapper、宿主嵌套和常驻 Bar 的混合删除树。 */
    function Foo(props) {
      return (
        <div>
          {props.show
            ? [
                <Bar key="a" name="A" />,
                <Wrapper key="b" name="B" />,
                <div key="cd">
                  <Bar name="C" />
                  <Wrapper name="D" />,
                </div>,
                [<Bar key="e" name="E" />, <Bar key="f" name="F" />],
              ]
            : []}
          <div>{props.show ? <Bar key="g" name="G" /> : null}</div>
          <Bar name="this should not unmount" />
        </div>
      );
    }

    ReactNoop.render(<Foo show={true} />);
    await waitForAll([]);
    expect(ops).toEqual([]);

    ReactNoop.render(<Foo show={false} />);
    await waitForAll([]);
    expect(ops).toEqual([
      'A',
      'Wrapper',
      'B',
      'C',
      'Wrapper',
      'D',
      'E',
      'F',
      'G',
    ]);
  });

  /**
   * 场景（Given–When–Then）：给定相同 keyed 树首次挂载后原样更新；当两次 commit；那么首次
   * didMount、第二次 didUpdate 都按后代先于 Wrapper 的顺序执行。
   * 对应机制：layout effect list 的类生命周期遍历顺序。
   */
  it('calls componentDidMount/Update after insertion/update', async () => {
    let ops = [];

    /** 记录叶子 Bar 的 mount/update。 */
    class Bar extends React.Component {
      /** 记录叶子首次挂载。 */
      componentDidMount() {
        ops.push('mount:' + this.props.name);
      }
      /** 记录叶子更新提交。 */
      componentDidUpdate() {
        ops.push('update:' + this.props.name);
      }
      /** 输出无内容 span。 */
      render() {
        return <span />;
      }
    }

    /** 包装 Bar，并在自己的 layout 生命周期中记录顺序。 */
    class Wrapper extends React.Component {
      /** 记录 Wrapper 首次挂载。 */
      componentDidMount() {
        ops.push('mount:wrapper-' + this.props.name);
      }
      /** 记录 Wrapper 更新提交。 */
      componentDidUpdate() {
        ops.push('update:wrapper-' + this.props.name);
      }
      /** 把 name 透传给内部 Bar。 */
      render() {
        return <Bar name={this.props.name} />;
      }
    }

    /** 构造多层、数组和 Wrapper 混合的稳定 keyed 树。 */
    function Foo(props) {
      return (
        <div>
          <Bar key="a" name="A" />
          <Wrapper key="b" name="B" />
          <div key="cd">
            <Bar name="C" />
            <Wrapper name="D" />
          </div>
          {[<Bar key="e" name="E" />, <Bar key="f" name="F" />]}
          <div>
            <Bar key="g" name="G" />
          </div>
        </div>
      );
    }

    ReactNoop.render(<Foo />);
    await waitForAll([]);
    expect(ops).toEqual([
      'mount:A',
      'mount:B',
      'mount:wrapper-B',
      'mount:C',
      'mount:D',
      'mount:wrapper-D',
      'mount:E',
      'mount:F',
      'mount:G',
    ]);

    ops = [];

    ReactNoop.render(<Foo />);
    await waitForAll([]);
    expect(ops).toEqual([
      'update:A',
      'update:B',
      'update:wrapper-B',
      'update:C',
      'update:D',
      'update:wrapper-D',
      'update:E',
      'update:F',
      'update:G',
    ]);
  });

  /**
   * 场景（Given–When–Then）：给定类、函数和宿主节点都传入 ref callback；当挂载、替换回调、
   * 再卸载；那么函数组件无 ref，变更回调先 detach 后 attach，删除时仅 detach 已附着 ref。
   * 对应机制：Ref flag 的 mutation/layout 两阶段顺序。
   */
  it('invokes ref callbacks after insertion/update/unmount', async () => {
    let classInstance = null;

    let ops = [];

    /** 暴露类实例，供 ref 回调结果与真实实例比对。 */
    class ClassComponent extends React.Component {
      /** 捕获实例并输出宿主 span。 */
      render() {
        classInstance = this;
        return <span />;
      }
    }

    /** 函数组件 ref 不应被调用，只返回宿主 span。 */
    function FunctionComponent(props) {
      return <span />;
    }

    /** 按 `show` 挂载或删除带新 ref 函数身份的混合节点。 */
    function Foo(props) {
      return props.show ? (
        <div>
          <ClassComponent ref={n => ops.push(n)} />
          <FunctionComponent ref={n => ops.push(n)} />
          <div ref={n => ops.push(n)} />
        </div>
      ) : null;
    }

    ReactNoop.render(<Foo show={true} />);

    await waitForAll([]);

    expect(ops).toEqual([
      classInstance,
      // 函数组件不会收到 ref 回调。
      {type: 'div', children: [], prop: undefined, hidden: false},
    ]);

    ops = [];

    // ref 函数身份变化时会重新调用。
    ReactNoop.render(<Foo show={true} />);
    await waitForAll([]);
    expect(ops).toEqual([
      // 先 detach 所有切换处理器的 ref。
      null,
      null,
      // 再在独立阶段 attach 新 ref。
      classInstance,
      {type: 'div', children: [], prop: undefined, hidden: false},
    ]);

    ops = [];

    ReactNoop.render(<Foo show={false} />);
    await waitForAll([]);
    expect(ops).toEqual([
      // 卸载时 detach。
      null,
      null,
    ]);
  });

  // TODO：补测 render 被中止并恢复时，mount、update、ref、unmount 与 deletion 的提交顺序。
});
