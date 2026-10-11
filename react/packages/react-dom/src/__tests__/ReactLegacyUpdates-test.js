/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let React;
let ReactDOM;
let findDOMNode;
let act;
let Scheduler;
let assertLog;
let assertConsoleErrorDev;

// 这是使用 ReactDOM.render 和 ReactDOM.unstable_batchedUpdates 的 ReactUpdates 副本；移除这两个 API 后即可删除此文件。
describe('ReactLegacyUpdates', () => {
  /** 每例清空模块缓存，重新加载 legacy ReactDOM、诊断断言及模拟 Scheduler，避免实例、警告去重与更新计数跨例共享。 */
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOM = require('react-dom');
    findDOMNode =
      ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
        .findDOMNode;
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
    Scheduler = require('scheduler');

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;
  });

  /** x 初值 0；同一 unstable_batchedUpdates 内依次 setState 到 1、2，期间实例 state 和 didUpdate 计数仍为 0。批次结束后 x=2、didUpdate=1，验证同一字段的覆盖更新合并到一次 legacy 提交。仅在支持 legacy 且 classic 的配置执行。 */
  // @gate !disableLegacyMode && classic
  it('should batch state when updating state twice', () => {
    let updateCount = 0;

    /** 维护 x 并累计 didUpdate 次数，用同一字段的两个更新检验批次只提交一次。 */
    class Component extends React.Component {
      /** 被两次对象更新覆盖的 x，初值为 0。 */
      state = {x: 0};

      /** 每次更新提交后加一，区分入队次数与提交次数。 */
      componentDidUpdate() {
        updateCount++;
      }

      /** 把已处理的 x 输出到 div，供实例 state 断言对应渲染结果。 */
      render() {
        return <div>{this.state.x}</div>;
      }
    }

    const container = document.createElement('div');
    const instance = ReactDOM.render(<Component />, container);
    expect(instance.state.x).toBe(0);

    ReactDOM.unstable_batchedUpdates(function () {
      instance.setState({x: 1});
      instance.setState({x: 2});
      expect(instance.state.x).toBe(0);
      expect(updateCount).toBe(0);
    });

    expect(instance.state.x).toBe(2);
    expect(updateCount).toBe(1);
  });

  /** x/y 均从 0 开始，同一批次分别更新 x=1、y=2；批次内两值与更新计数不变，结束后两个字段均保留、只调用一次 didUpdate，验证对象 payload 的浅合并。受 legacy/classic gate 限定。 */
  // @gate !disableLegacyMode && classic
  it('should batch state when updating two different state keys', () => {
    let updateCount = 0;

    /** 用独立的 x/y 字段观察同一批次对象 payload 的浅合并。 */
    class Component extends React.Component {
      /** 两个独立 state 字段都从 0 开始。 */
      state = {x: 0, y: 0};

      /** 累计 x/y 合并后的更新提交次数。 */
      componentDidUpdate() {
        updateCount++;
      }

      /** 同时显示 x 和 y，保留两个对象更新的可见结果。 */
      render() {
        return <div>{`(${this.state.x}, ${this.state.y})`}</div>;
      }
    }

    const container = document.createElement('div');
    const instance = ReactDOM.render(<Component />, container);
    expect(instance.state.x).toBe(0);
    expect(instance.state.y).toBe(0);

    ReactDOM.unstable_batchedUpdates(function () {
      instance.setState({x: 1});
      instance.setState({y: 2});
      expect(instance.state.x).toBe(0);
      expect(instance.state.y).toBe(0);
      expect(updateCount).toBe(0);
    });

    expect(instance.state.x).toBe(1);
    expect(instance.state.y).toBe(2);
    expect(updateCount).toBe(1);
  });

  /** 首次 props.x=0、state.y=0；在同一批次重渲染根传入 x=1 并给实例更新 y=2，批次内仍看到旧 props/state，结束后两个新值一起生效且 didUpdate=1。受 legacy/classic gate 限定。 */
  // @gate !disableLegacyMode && classic
  it('should batch state and props together', () => {
    let updateCount = 0;

    /** 同时接收根传入的 x 与本地 y，观察 props/state 能否合并提交。 */
    class Component extends React.Component {
      /** 本地 y 初始为 0，x 来自 props。 */
      state = {y: 0};

      /** 记录 props 与 state 批次完成后的提交数。 */
      componentDidUpdate() {
        updateCount++;
      }

      /** 输出 props.x 与 state.y，区分父输入和本地队列。 */
      render() {
        return <div>{`(${this.props.x}, ${this.state.y})`}</div>;
      }
    }

    const container = document.createElement('div');
    const instance = ReactDOM.render(<Component x={0} />, container);
    expect(instance.props.x).toBe(0);
    expect(instance.state.y).toBe(0);

    ReactDOM.unstable_batchedUpdates(function () {
      ReactDOM.render(<Component x={1} />, container);
      instance.setState({y: 2});
      expect(instance.props.x).toBe(0);
      expect(instance.state.y).toBe(0);
      expect(updateCount).toBe(0);
    });

    expect(instance.props.x).toBe(1);
    expect(instance.state.y).toBe(2);
    expect(updateCount).toBe(1);
  });

  /** Parent.x/Child.y 初值均 0；先更新父 x=1，再更新子 y=2。批次内两实例仍是旧值，结束后父子各 didUpdate 一次且各自 state 正确，验证父新 props 与子队列更新合并处理。受 legacy/classic gate 限定。 */
  // @gate !disableLegacyMode && classic
  it('should batch parent/child state updates together', () => {
    let parentUpdateCount = 0;

    /** 持有 Child 引用并维护 x，先入队父更新再入队子更新。 */
    class Parent extends React.Component {
      /** 传给 Child 的 x，初始为 0。 */
      state = {x: 0};
      /** 指向 Child 实例，允许同一批次直接更新它的 y。 */
      childRef = React.createRef();

      /** 累计父组件更新提交次数。 */
      componentDidUpdate() {
        parentUpdateCount++;
      }

      /** 把父 x 作为 props 传下，并保持用于直接 setState 的 childRef。 */
      render() {
        return (
          <div>
            <Child ref={this.childRef} x={this.state.x} />
          </div>
        );
      }
    }

    let childUpdateCount = 0;

    /** 同时读取父 props.x 和自身 state.y，观察父先入队的联合批次。 */
    class Child extends React.Component {
      /** 独立于父组件的 y 队列，初始为 0。 */
      state = {y: 0};

      /** 累计子组件更新提交次数，检验合并父 props 与子 state 后只更新一次。 */
      componentDidUpdate() {
        childUpdateCount++;
      }

      /** 把父 x 与本地 y 相加后输出。 */
      render() {
        return <div>{this.props.x + this.state.y}</div>;
      }
    }

    const container = document.createElement('div');
    const instance = ReactDOM.render(<Parent />, container);
    const child = instance.childRef.current;
    expect(instance.state.x).toBe(0);
    expect(child.state.y).toBe(0);

    ReactDOM.unstable_batchedUpdates(function () {
      instance.setState({x: 1});
      child.setState({y: 2});
      expect(instance.state.x).toBe(0);
      expect(child.state.y).toBe(0);
      expect(parentUpdateCount).toBe(0);
      expect(childUpdateCount).toBe(0);
    });

    expect(instance.state.x).toBe(1);
    expect(child.state.y).toBe(2);
    expect(parentUpdateCount).toBe(1);
    expect(childUpdateCount).toBe(1);
  });

  /** 和前例使用同样父子初值，但先排入子 y=2、再排入父 x=1；结束后仍父子各提交一次。通过两实例 state 与 didUpdate 计数检验入队顺序不会让子重复更新。受 legacy/classic gate 限定。 */
  // @gate !disableLegacyMode && classic
  it('should batch child/parent state updates together', () => {
    let parentUpdateCount = 0;

    /** 维护 x 并暴露 Child 引用，检验子先入队时父子仍只各提交一次。 */
    class Parent extends React.Component {
      /** 父队列的 x，从 0 更新到 1。 */
      state = {x: 0};
      /** 取得子实例，用于在父更新之前入队 y。 */
      childRef = React.createRef();

      /** 累计逆序入队后的父更新提交数。 */
      componentDidUpdate() {
        parentUpdateCount++;
      }

      /** 把处理后的 x 下传给 Child，同时保留子实例引用。 */
      render() {
        return (
          <div>
            <Child ref={this.childRef} x={this.state.x} />
          </div>
        );
      }
    }

    let childUpdateCount = 0;

    /** 本地 y 先入队，随后接收父 x；用于检测一次批次是否重复提交子组件。 */
    class Child extends React.Component {
      /** 子队列 y 的初值为 0。 */
      state = {y: 0};

      /** 累计子提交数，断言该次父子批次只有一次更新。 */
      componentDidUpdate() {
        childUpdateCount++;
      }

      /** 显示 props.x 与 state.y 的和。 */
      render() {
        return <div>{this.props.x + this.state.y}</div>;
      }
    }

    const container = document.createElement('div');
    const instance = ReactDOM.render(<Parent />, container);
    const child = instance.childRef.current;
    expect(instance.state.x).toBe(0);
    expect(child.state.y).toBe(0);

    ReactDOM.unstable_batchedUpdates(function () {
      child.setState({y: 2});
      instance.setState({x: 1});
      expect(instance.state.x).toBe(0);
      expect(child.state.y).toBe(0);
      expect(parentUpdateCount).toBe(0);
      expect(childUpdateCount).toBe(0);
    });

    expect(instance.state.x).toBe(1);
    expect(child.state.y).toBe(2);
    expect(parentUpdateCount).toBe(1);

    // 批量减少了此处的更新次数到1次。
    expect(childUpdateCount).toBe(1);
  });

  /** 从 x=0 入队 x=1；其提交回调再入队 x=2，内层回调检查 this 为原实例、x=2、didUpdate=2。批次内仍 x=0，结束后内层回调已执行，验证回调更新形成后续提交而非并入已完成的第一次提交。受 legacy/classic gate 限定。 */
  // @gate !disableLegacyMode && classic
  it('should support chained state updates', () => {
    let updateCount = 0;

    /** 在提交回调里继续更新 x，用 didUpdate 次数区分两个级联提交。 */
    class Component extends React.Component {
      /** 级联更新起点 x=0。 */
      state = {x: 0};

      /** 分别计入 x=1 和 x=2 的更新提交。 */
      componentDidUpdate() {
        updateCount++;
      }

      /** 输出当前 x，供每一层 setState 回调观察已提交 state。 */
      render() {
        return <div>{this.state.x}</div>;
      }
    }

    const container = document.createElement('div');
    const instance = ReactDOM.render(<Component />, container);
    expect(instance.state.x).toBe(0);

    let innerCallbackRun = false;
    ReactDOM.unstable_batchedUpdates(function () {
      instance.setState({x: 1}, function () {
        instance.setState({x: 2}, function () {
          expect(this).toBe(instance);
          innerCallbackRun = true;
          expect(instance.state.x).toBe(2);
          expect(updateCount).toBe(2);
        });
        expect(instance.state.x).toBe(1);
        expect(updateCount).toBe(1);
      });
      expect(instance.state.x).toBe(0);
      expect(updateCount).toBe(0);
    });

    expect(innerCallbackRun).toBeTruthy();
    expect(instance.state.x).toBe(2);
    expect(updateCount).toBe(2);
  });

  /** 同批 setState x=1 与 forceUpdate，各带回调；期间仍 x=0，结束后两个回调都执行、didUpdate=1、SCU 调用数为 0。验证 ForceUpdate 绕过 SCU 但与 state 更新合并提交。受 legacy/classic gate 限定。 */
  // @gate !disableLegacyMode && classic
  it('should batch forceUpdate together', () => {
    let shouldUpdateCount = 0;
    let updateCount = 0;

    /** 将普通 state 更新和 forceUpdate 放入同一批次，统计 SCU 与 didUpdate。 */
    class Component extends React.Component {
      /** 普通更新把 x 从 0 改为 1。 */
      state = {x: 0};

      /** 只记录是否被询问；本例 ForceUpdate 应跳过该方法，因此没有返回更新判定。 */
      shouldComponentUpdate() {
        shouldUpdateCount++;
      }

      /** 记录合并 state 与 forceUpdate 后的一次提交。 */
      componentDidUpdate() {
        updateCount++;
      }

      /** 输出 x，供批次内旧值与批次后新值比较。 */
      render() {
        return <div>{this.state.x}</div>;
      }
    }

    const container = document.createElement('div');
    const instance = ReactDOM.render(<Component />, container);
    expect(instance.state.x).toBe(0);

    let callbacksRun = 0;
    ReactDOM.unstable_batchedUpdates(function () {
      instance.setState({x: 1}, function () {
        callbacksRun++;
      });
      instance.forceUpdate(function () {
        callbacksRun++;
      });
      expect(instance.state.x).toBe(0);
      expect(updateCount).toBe(0);
    });

    expect(callbacksRun).toBe(2);
    // shouldComponentUpdate 不应被调用，因为我们强制执行了。
    expect(shouldUpdateCount).toBe(0);
    expect(instance.state.x).toBe(1);
    expect(updateCount).toBe(1);
  });

  /** 父 SCU 固定 false，初次父子各 render 一次；父 setState 后计数不变，随后直接更新 childRef 的子实例，只有子 render 变为两次。验证父拒绝自身 render 不阻止子处理其队列。 */
  // @gate !disableLegacyMode
  it('should update children even if parent blocks updates', () => {
    let parentRenderCount = 0;
    let childRenderCount = 0;

    /** 始终以 SCU 拒绝自己的重渲染，子实例仍可处理自己的 state 更新。 */
    class Parent extends React.Component {
      /** 取得 Child 实例，单独触发子队列。 */
      childRef = React.createRef();

      /** 固定返回 false，使父 setState 不进入父 render。 */
      shouldComponentUpdate() {
        return false;
      }

      /** 累计父 render 并提供可直接更新的 Child；后续父拒绝不清除子队列。 */
      render() {
        parentRenderCount++;
        return <Child ref={this.childRef} />;
      }
    }

    /** 通过 render 次数检验自己的更新不会被父 SCU 拦截。 */
    class Child extends React.Component {
      /** 增加 childRenderCount 后返回空 div，验证只重渲染子组件。 */
      render() {
        childRenderCount++;
        return <div />;
      }
    }

    expect(parentRenderCount).toBe(0);
    expect(childRenderCount).toBe(0);

    const container = document.createElement('div');
    const instance = ReactDOM.render(<Parent />, container);

    expect(parentRenderCount).toBe(1);
    expect(childRenderCount).toBe(1);

    ReactDOM.unstable_batchedUpdates(function () {
      instance.setState({x: 1});
    });

    expect(parentRenderCount).toBe(1);
    expect(childRenderCount).toBe(1);

    ReactDOM.unstable_batchedUpdates(function () {
      instance.childRef.current.setState({x: 1});
    });

    expect(parentRenderCount).toBe(1);
    expect(childRenderCount).toBe(2);
  });

  /** Top 首次创建 Bottom 元素并传给 Middle；Middle didMount 中 forceUpdate，自身 render 两次，但每次返回同一 props.children 元素。Bottom render 保持一次，验证元素身份复用的子树 bailout。 */
  // @gate !disableLegacyMode
  it('should not reconcile children passed via props', () => {
    let numMiddleRenders = 0;
    let numBottomRenders = 0;

    /** 一次创建 Middle 的 children 元素，后续 Middle forceUpdate 继续使用同一 Bottom 元素。 */
    class Top extends React.Component {
      /** 构造 Middle→Bottom 结构，让 Bottom 元素只在 Top render 中创建。 */
      render() {
        return (
          <Middle>
            <Bottom />
          </Middle>
        );
      }
    }

    /** 挂载后强制更新自身，render 继续返回原 props.children。 */
    class Middle extends React.Component {
      /** 在 mount 提交中 forceUpdate，触发第二次 Middle render。 */
      componentDidMount() {
        this.forceUpdate();
      }

      /** 累计 Middle render 并返回唯一的原 children 元素，保留 Bottom 的元素身份。 */
      render() {
        numMiddleRenders++;
        return React.Children.only(this.props.children);
      }
    }

    /** 作为复用 children 的观察点，不输出宿主节点。 */
    class Bottom extends React.Component {
      /** 累计 Bottom render 后返回 null；其次数应保持 1。 */
      render() {
        numBottomRenders++;
        return null;
      }
    }

    const container = document.createElement('div');
    ReactDOM.render(<Top />, container);
    expect(numMiddleRenders).toBe(2);
    expect(numBottomRenders).toBe(1);
  });

  /** 分别把 Switcher/Box/Child 的组合正序、逆序批量更新，意图比较生命周期传播。当前 expectUpdates 用名称数组直接作循环上界，循环均不执行且 fixture 没设 displayName；本例只运行这些批次并清空日志，没有验证成员或生命周期顺序。 */
  // @gate !disableLegacyMode
  it('should flow updates correctly', () => {
    let willUpdates = [];
    let didUpdates = [];

    const UpdateLoggingMixin = {
      /** 将当前类的 displayName 写入 willUpdates；这些 fixture 未设置 displayName，所以记录值是 undefined。 */
      UNSAFE_componentWillUpdate: function () {
        willUpdates.push(this.constructor.displayName);
      },
      /** 将当前类的 displayName 写入 didUpdates；这里只收集日志，实际检查由 expectUpdates 决定。 */
      componentDidUpdate: function () {
        didUpdates.push(this.constructor.displayName);
      },
    };

    /** 用宿主 div 包装原 children，并混入生命周期日志。 */
    class Box extends React.Component {
      /** 保存 Box 的宿主 div 引用。 */
      boxDivRef = React.createRef();

      /** 把 children 原样放入带 ref 的 div，不另行创建其 React 元素。 */
      render() {
        return <div ref={this.boxDivRef}>{this.props.children}</div>;
      }
    }
    Object.assign(Box.prototype, UpdateLoggingMixin);

    /** 输出固定 child 文本，并通过混入生命周期收集是否被更新。 */
    class Child extends React.Component {
      /** 保存固定 span 宿主节点。 */
      spanRef = React.createRef();

      /** 创建带 ref 的 span，文字恒为 child。 */
      render() {
        return <span ref={this.spanRef}>child</span>;
      }
    }
    Object.assign(Child.prototype, UpdateLoggingMixin);

    /** 按 tabKey 与 children.key 决定 CSS display，持有 Box 和内部 div 引用。 */
    class Switcher extends React.Component {
      /** 当前页签 key 初始为 hello，用于可见性比较。 */
      state = {tabKey: 'hello'};
      /** 用于直接给包装组件 Box 入队 state 更新。 */
      boxRef = React.createRef();
      /** 保存控制 display 的内部 div。 */
      switcherDivRef = React.createRef();
      /** 把同一个 child 元素传给 Box，再按 tabKey 设置其宿主包装的 display。 */
      render() {
        const child = this.props.children;

        return (
          <Box ref={this.boxRef}>
            <div
              ref={this.switcherDivRef}
              style={{
                display: this.state.tabKey === child.key ? '' : 'none',
              }}>
              {child}
            </div>
          </Box>
        );
      }
    }
    Object.assign(Switcher.prototype, UpdateLoggingMixin);

    /** 建立 Switcher 与 Child 的引用，供三组组件排列分别入队更新。 */
    class App extends React.Component {
      /** 取得 Switcher 及其内部 Box。 */
      switcherRef = React.createRef();
      /** 直接取得 Child，绕过从宿主节点反查组件。 */
      childRef = React.createRef();

      /** 创建 key=hello 的 Child 并交给 Switcher；之后测试只给已有实例更新 state。 */
      render() {
        return (
          <Switcher ref={this.switcherRef}>
            <Child key="hello" ref={this.childRef} />
          </Switcher>
        );
      }
    }
    Object.assign(App.prototype, UpdateLoggingMixin);

    const container = document.createElement('div');
    const root = ReactDOM.render(<App />, container);

    /** 接收两组期望名称并清空收集日志。当前循环把数组直接作为比较上界，名称数组转数字得到 NaN，循环不会执行；因此既未检查成员，也未验证生命周期顺序。不得将调用它视为有效顺序断言。 */
    function expectUpdates(desiredWillUpdates, desiredDidUpdates) {
      let i;
      for (i = 0; i < desiredWillUpdates; i++) {
        expect(willUpdates).toContain(desiredWillUpdates[i]);
      }
      for (i = 0; i < desiredDidUpdates; i++) {
        expect(didUpdates).toContain(desiredDidUpdates[i]);
      }
      willUpdates = [];
      didUpdates = [];
    }

    /** 给指定组件 c 合并 x=1，即使 render 不读取 x 也触发其类更新流程。 */
    function triggerUpdate(c) {
      c.setState({x: 1});
    }

    /** 对 components 正序、逆序各安排一批 x=1 更新，再调用 expectUpdates 清理日志；后者当前没有执行有效断言，desiredWillUpdates/desiredDidUpdates 仅表达作者意图。 */
    function testUpdates(components, desiredWillUpdates, desiredDidUpdates) {
      let i;

      ReactDOM.unstable_batchedUpdates(function () {
        for (i = 0; i < components.length; i++) {
          triggerUpdate(components[i]);
        }
      });

      expectUpdates(desiredWillUpdates, desiredDidUpdates);

      // 尝试从后向前排列它们。

      ReactDOM.unstable_batchedUpdates(function () {
        for (i = components.length - 1; i >= 0; i--) {
          triggerUpdate(components[i]);
        }
      });

      expectUpdates(desiredWillUpdates, desiredDidUpdates);
    }
    testUpdates(
      [root.switcherRef.current.boxRef.current, root.switcherRef.current],
      // 数组表达作者预期；当前 expectUpdates 的循环未执行，不能作为执行顺序证据。
      ['Switcher', 'Box'],
      ['Box', 'Switcher'],
    );

    testUpdates(
      [root.childRef.current, root.switcherRef.current.boxRef.current],
      // Box 与 Child 是可独立更新的实例；这里的期望数组没有被有效断言。
      ['Box', 'Child'],
      ['Box', 'Child'],
    );

    testUpdates(
      [root.childRef.current, root.switcherRef.current],
      // Switcher 是 Box/Child 的树上祖先；Child 元素由 App 创建后经 props 透传，而非由 Box 创建。
      ['Switcher', 'Box', 'Child'],
      ['Box', 'Switcher', 'Child'],
    );
  });

  /** A 初始 A0，通过 portal 把 B0 放进另一 DOM 容器；同批各改 x=1。A didUpdate 读取 B 的 DOM 必须为 B1，结束后 aUpdated=true，验证全树 mutation 完成后才运行 layout 生命周期。两个宿主容器仍在同一 Fiber 根，受 legacy/classic gate 限定。 */
  // @gate !disableLegacyMode && classic
  it('should queue mount-ready handlers across different roots', () => {
    // 定义 A、B 两个组件并同时更新；调用 A 的 componentDidUpdate 时，B 的 DOM 应已完成更新。

    const bContainer = document.createElement('div');

    let b;

    let aUpdated = false;

    /** 把 B portal 到另一宿主容器，A 的 didUpdate 读取 B 文本以检查 mutation 已完成。 */
    class A extends React.Component {
      /** A 的可见计数 x，初始为 0。 */
      state = {x: 0};

      /** 检查 portal 容器中 B 已是 B1，再标记 A 更新提交完成。 */
      componentDidUpdate() {
        expect(findDOMNode(b).textContent).toBe('B1');
        aUpdated = true;
      }

      /** 返回 A 的文本及 B portal；两个宿主容器仍属于同一 Fiber 根。 */
      render() {
        let portal = null;
        // 用 portal 让 B 使用第二个宿主容器；它仍是当前 Fiber 根中的子树。
        portal = ReactDOM.createPortal(<B ref={/** 保存或清空 portal 中的 B 实例，供批次内更新和 A 提交后读取。 */ n => (b = n)} />, bContainer);
        return (
          <div>
            A{this.state.x}
            {portal}
          </div>
        );
      }
    }

    /** portal 中维护独立 x，并输出 B 加计数。 */
    class B extends React.Component {
      /** B 的本地计数 x，初始为 0。 */
      state = {x: 0};

      /** 输出 B0/B1，作为 A layout 生命周期读取的宿主更新证据。 */
      render() {
        return <div>B{this.state.x}</div>;
      }
    }

    const container = document.createElement('div');
    const a = ReactDOM.render(<A />, container);
    ReactDOM.unstable_batchedUpdates(function () {
      a.setState({x: 1});
      b.setState({x: 1});
    });

    expect(aUpdated).toBe(true);
  });

  /** Outer/Inner 都从 x=0 开始；Outer 的 x=1 提交回调继续排入 x=2，每次 didUpdate 又给 Inner 排入本轮 x。精确比较完整日志：父 props 更新先出现，子 state=1 与父 x=2 合并，最后子 state=2 单独提交，验证提交回调中级联更新的顺序。 */
  // @gate !disableLegacyMode
  it('should flush updates in the correct order', () => {
    const updates = [];

    /** 在 didUpdate 中继续更新 Inner，并用日志追踪父回调与子级联更新的交错。 */
    class Outer extends React.Component {
      /** 父计数从 0 依次变为 1、2。 */
      state = {x: 0};
      /** 指向 Inner，用于父提交期间更新子 state。 */
      innerRef = React.createRef();

      /** 记录 Outer-render-x 并把 x 作为 props 传给 Inner。 */
      render() {
        updates.push('Outer-render-' + this.state.x);
        return (
          <div>
            <Inner x={this.state.x} ref={this.innerRef} />
          </div>
        );
      }

      /** 记录父提交后给 Inner 入队同值 x；子提交回调记录闭包中的该轮 x，不在这里立即重渲染子组件。 */
      componentDidUpdate() {
        const x = this.state.x;
        updates.push('Outer-didUpdate-' + x);
        updates.push('Inner-setState-' + x);
        this.innerRef.current.setState({x: x}, function () {
          updates.push('Inner-callback-' + x);
        });
      }
    }

    /** 分别记录 props.x 与 state.x，暴露父输入和延后子更新的不同阶段。 */
    class Inner extends React.Component {
      /** 子 x 初始为 0，随后由父 didUpdate 安排到 1、2。 */
      state = {x: 0};

      /** 记录 props/state 二元组，不输出用于断言的文本。 */
      render() {
        updates.push('Inner-render-' + this.props.x + '-' + this.state.x);
        return <div />;
      }

      /** 记录子组件已经提交的 props/state 二元组。 */
      componentDidUpdate() {
        updates.push('Inner-didUpdate-' + this.props.x + '-' + this.state.x);
      }
    }

    const container = document.createElement('div');
    const instance = ReactDOM.render(<Outer />, container);

    updates.push('Outer-setState-1');
    instance.setState({x: 1}, function () {
      updates.push('Outer-callback-1');
      updates.push('Outer-setState-2');
      instance.setState({x: 2}, function () {
        updates.push('Outer-callback-2');
      });
    });

    expect(updates).toEqual([
      'Outer-render-0',
      'Inner-render-0-0',

      'Outer-setState-1',
      'Outer-render-1',
      'Inner-render-1-0',
      'Inner-didUpdate-1-0',
      'Outer-didUpdate-1',
      // 发生在批处理中，所以不要立即重新渲染。
      'Inner-setState-1',
      'Outer-callback-1',

      // 在批次中发生
      'Outer-setState-2',

      // 先合并父 x=2 与此前子 x=1，之后再处理父 didUpdate 新入队的子 x=2。
      'Outer-render-2',
      'Inner-render-2-1',
      'Inner-didUpdate-2-1',
      'Inner-callback-1',
      'Outer-didUpdate-2',
      'Inner-setState-2',
      'Outer-callback-2',
      'Inner-render-2-2',
      'Inner-didUpdate-2-2',
      'Inner-callback-2',
    ]);
  });

  /** MockComponent depth=0 的 didMount 在自身 div 内再建 depth=1、2 的独立根；初次日志为 0/1/2。随后按实例收集顺序同批 forceUpdate，日志再追加 0/1/2，验证这里的跨根批次处理次序。 */
  // @gate !disableLegacyMode
  it('should flush updates in the correct order across roots', () => {
    const instances = [];
    const updates = [];

    /** 每次 mount 在自己的宿主 div 内再建一个 legacy 根，形成 depth=0/1/2 的独立根链。 */
    class MockComponent extends React.Component {
      /** 将当前 depth 追加到 updates，再提供下一根的宿主容器。 */
      render() {
        updates.push(this.props.depth);
        return <div />;
      }

      /** 按挂载次序收集实例；depth 小于 count 时在当前 div 中同步挂载 depth+1 的新根。 */
      componentDidMount() {
        instances.push(this);
        if (this.props.depth < this.props.count) {
          ReactDOM.render(
            <MockComponent
              depth={this.props.depth + 1}
              count={this.props.count}
            />,
            findDOMNode(this),
          );
        }
      }
    }

    const container = document.createElement('div');
    ReactDOM.render(<MockComponent depth={0} count={2} />, container);

    expect(updates).toEqual([0, 1, 2]);

    ReactDOM.unstable_batchedUpdates(function () {
      // 从上到下依次模拟每个组件的更新。
      instances.forEach(function (instance) {
        instance.forceUpdate();
      });
    });

    expect(updates).toEqual([0, 1, 2, 0, 1, 2]);
  });

  /** 先挂载另一根 X(s=0)，再挂载包装 Z 的 Y；Y forceUpdate 进入 Z willUpdate，Z 调 X.go 连排 1/0/1。最终 X DOM 从 0 到 1，验证跨根嵌套更新完成宿主结构替换；不单独断言三次中间提交。 */
  // @gate !disableLegacyMode
  it('should queue nested updates', () => {
  // 参见 https://github.com/facebook/react/issues/1147 。

    /** 维护 s 并在三次连续更新间切换 span/文本结构，检测跨根嵌套更新后的宿主结果。 */
    class X extends React.Component {
      /** 初始 s=0，对应包含 span 的结构。 */
      state = {s: 0};

      /** s=0 返回 span 0，其他值返回直接文本 1，使多次更新涉及宿主子结构替换。 */
      render() {
        if (this.state.s === 0) {
          return (
            <div>
              <span>0</span>
            </div>
          );
        } else {
          return <div>1</div>;
        }
      }

      /** 连续入队 s=1、0、1，让 Z 的更新生命周期触发另一根的三次更新。 */
      go = () => {
        this.setState({s: 1});
        this.setState({s: 0});
        this.setState({s: 1});
      };
    }

    /** 包装 Z，forceUpdate 用于进入 Z 的更新生命周期。 */
    class Y extends React.Component {
      /** 返回新的 Z 元素，使 Y 更新时遍历该子组件。 */
      render() {
        return (
          <div>
            <Z />
          </div>
        );
      }
    }

    /** 在更新生命周期调用另一根 X 的 go，模拟 render 期间跨根入队。 */
    class Z extends React.Component {
      /** 提供空 div，不自行维护 state。 */
      render() {
        return <div />;
      }

      /** 调用已挂载 X 实例的 go，把三次 state 更新交给另一根。 */
      UNSAFE_componentWillUpdate() {
        x.go();
      }
    }

    let container = document.createElement('div');
    const x = ReactDOM.render(<X />, container);
    container = document.createElement('div');
    const y = ReactDOM.render(<Y />, container);
    expect(findDOMNode(x).textContent).toBe('0');

    y.forceUpdate();
    expect(findDOMNode(x).textContent).toBe('1');
  });

  /** A willMount 暴露实例并先 render A0，后面的兄弟 B willMount 给 A 排入 x=1；批量挂载结束后检查实例 x=1 与 DOM A1，验证挂载过程中后来收到的更新仍被处理。 */
  // @gate !disableLegacyMode
  it('should queue updates from during mount', () => {
  // 参见 https://github.com/facebook/react/issues/1353 。
    let a;

    /** 在 willMount 暴露实例 a，让稍后挂载的兄弟 B 能更新它。 */
    class A extends React.Component {
      /** A 的 x 初始为 0，B 挂载期间改为 1。 */
      state = {x: 0};

      /** 将当前实例保存到 a，先于兄弟 B 的 willMount。 */
      UNSAFE_componentWillMount() {
        a = this;
      }

      /** 输出 Ax，供批次结束后检查 A1。 */
      render() {
        return <div>A{this.state.x}</div>;
      }
    }

    /** 在自己的 willMount 更新已进入挂载过程的兄弟 A。 */
    class B extends React.Component {
      /** 给 a 排入 x=1；A 虽已 render，后续同步工作仍应应用这个更新。 */
      UNSAFE_componentWillMount() {
        a.setState({x: 1});
      }

      /** 返回空 div，作为触发 A 更新的兄弟节点。 */
      render() {
        return <div />;
      }
    }

    ReactDOM.unstable_batchedUpdates(function () {
      const container = document.createElement('div');

      ReactDOM.render(
        <div>
          <A />
          <B />
        </div>,
        container,
      );
    });

    expect(a.state.x).toBe(1);
    expect(findDOMNode(a).textContent).toBe('A1');
  });

  /** 先以 x=1 挂载 A，再传入 x=2；willReceiveProps 把新 x 排入 state，并在 callback 中检查实例值等于闭包 newX。callbackCount 最终为 1，验证该生命周期发起更新的回调在 state 生效后运行。 */
  // @gate !disableLegacyMode
  it('calls componentWillReceiveProps setState callback properly', () => {
    let callbackCount = 0;

    /** 把收到的 props.x 同步到本地 x，回调验证处理队列后的实例 state。 */
    class A extends React.Component {
      /** 初始 x 取首次 props.x，而不是后续 props 的自动镜像。 */
      state = {x: this.props.x};

      /** 读取 nextProps.x 后 setState，并在提交回调检查 this.state 与该轮 newX 相等及累计回调次数。 */
      UNSAFE_componentWillReceiveProps(nextProps) {
        const newX = nextProps.x;
        this.setState({x: newX}, function () {
          // 调用此回调时，state 应已完成更新。
          expect(this.state.x).toBe(newX);
          callbackCount++;
        });
      }

      /** 输出本地 x，验证依赖的是队列更新而不是直接显示 props。 */
      render() {
        return <div>{this.state.x}</div>;
      }
    }

    const container = document.createElement('div');
    ReactDOM.render(<A x={1} />, container);
    ReactDOM.render(<A x={2} />, container);
    expect(callbackCount).toBe(1);
  });

  /** 初次 A 保留 B，B 只 render 一次；同一批次先给 B 入队 updates=1，再让父 showB=false。批次结束 B renderCount 仍为 1，验证父删除使待处理的子更新不再渲染。受 legacy/classic gate 限定。 */
  // @gate !disableLegacyMode && classic
  it('does not call render after a component as been deleted', () => {
    let renderCount = 0;
    let componentB = null;

    /** 暴露已挂载 B，并统计 render 次数以检测同批删除是否丢弃其待更新工作。 */
    class B extends React.Component {
      /** 供删除前 setState 入队的 updates 字段。 */
      state = {updates: 0};

      /** 保存 B 实例，供父和子更新进入同一批次。 */
      componentDidMount() {
        componentB = this;
      }

      /** 累计 B render 并返回 div；同批父删除后不应再次调用。 */
      render() {
        renderCount++;
        return <div />;
      }
    }

    /** 用 showB 控制是否保留 B，和 B 的 state 更新共同进入批次。 */
    class A extends React.Component {
      /** 初始保留 B，父更新后改为 false。 */
      state = {showB: true};

      /** 根据 showB 在 B 与空 div 之间切换，触发 B 删除。 */
      render() {
        return this.state.showB ? <B /> : <div />;
      }
    }

    const container = document.createElement('div');
    const component = ReactDOM.render(<A />, container);

    ReactDOM.unstable_batchedUpdates(function () {
      // B 将会安排一个更新，但批处理应该确保其更新永远不会触发。
      componentB.setState({updates: 1});
      component.setState({showB: false});
    });

    expect(renderCount).toBe(1);
  });

  /** 每轮重新挂载 A，分别把字符串、普通对象、Foo 实例作为 setState callback；act 拒绝并报非法 callback，前两轮另检查 DEV 警告。普通对象和 Foo 都转换为 [object Object]，第三轮警告被去重，但提交时的类型错误仍抛出。 */
  // @gate !disableLegacyMode
  it('throws in setState if the update callback is not a function', async () => {
    /** 创建带 a/b 字段的非函数回调对象；其字符串仍是 [object Object]，用于警告去重。 */
    function Foo() {
      this.a = 1;
      this.b = 2;
    }

    /** 提供可 setState 的挂载类实例，payload 为空，仅考察非法 callback 的提交错误。 */
    class A extends React.Component {
      /** 空 state，避免数据变化干扰 callback 校验。 */
      state = {};

      /** 返回固定 div，让错误来自 callback 而不是 render。 */
      render() {
        return <div />;
      }
    }

    let container = document.createElement('div');
    let component = ReactDOM.render(<A />, container);

    await expect(async () => {
      await act(() => {
        component.setState({}, 'no');
      });
    }).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. ' +
        'Instead received: no',
    );
    assertConsoleErrorDev([
      'Expected the last optional `callback` argument to be ' +
        'a function. Instead received: no.',
    ]);

    container = document.createElement('div');
    component = ReactDOM.render(<A />, container);
    await expect(async () => {
      await act(() => {
        component.setState({}, {foo: 'bar'});
      });
    }).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: [object Object]',
    );
    assertConsoleErrorDev([
      'Expected the last optional `callback` argument to be a function. ' +
        "Instead received: { foo: 'bar' }.",
    ]);
    // 确保警告被去重，并且不再重复触发
    container = document.createElement('div');
    component = ReactDOM.render(<A />, container);
    await expect(async () => {
      await act(() => {
        component.setState({}, new Foo());
      });
    }).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: [object Object]',
    );
  });

  /** 对新挂载的 A 分别 forceUpdate 并传字符串、普通对象、Foo 实例；每次 act 都拒绝非法 callback，前两轮检查 DEV 警告，第三轮共享对象字符串去重键。验证强制更新也会在提交调用 callback 时检查其类型。 */
  // @gate !disableLegacyMode
  it('throws in forceUpdate if the update callback is not a function', async () => {
    /** 创建普通实例作为非法 forceUpdate callback，和普通对象具有相同字符串去重键。 */
    function Foo() {
      this.a = 1;
      this.b = 2;
    }

    /** 提供可 forceUpdate 的挂载实例，验证 callback 类型检查。 */
    class A extends React.Component {
      /** 固定空 state，forceUpdate 不依赖 state 变化。 */
      state = {};

      /** 输出固定 div，隔离强制更新的 callback 错误。 */
      render() {
        return <div />;
      }
    }

    let container = document.createElement('div');
    let component = ReactDOM.render(<A />, container);

    await expect(async () => {
      await act(() => {
        component.forceUpdate('no');
      });
    }).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: no',
    );
    assertConsoleErrorDev([
      'Expected the last optional `callback` argument to be a function. ' +
        'Instead received: no.',
    ]);
    container = document.createElement('div');
    component = ReactDOM.render(<A />, container);
    await expect(async () => {
      await act(() => {
        component.forceUpdate({foo: 'bar'});
      });
    }).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: [object Object]',
    );
    assertConsoleErrorDev([
      'Expected the last optional `callback` argument to be a function. ' +
        "Instead received: { foo: 'bar' }.",
    ]);
    // 确保警告被去重，并且不再重复触发
    container = document.createElement('div');
    component = ReactDOM.render(<A />, container);
    await expect(async () => {
      await act(() => {
        component.forceUpdate(new Foo());
      });
    }).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: [object Object]',
    );
  });

  /** 父子同批 forceUpdate，Child willUpdate 只在第一次再排入 updated=true。render 检查此前 render 已完成，didMount/didUpdate 检查仅多出一次 render 后增加完成计数，验证重入更新不造成未配对的重复 render；没有最终总次数断言。 */
  // @gate !disableLegacyMode
  it('does not update one component twice in a batch (#2410)', () => {
    /** 持有 Child 实例，与子 forceUpdate 同批入队以检查 render/提交配对。 */
    class Parent extends React.Component {
      /** 保存用于直接 forceUpdate 的子实例。 */
      childRef = React.createRef();

      /** 返回 childRef.current，让测试取得已挂载 Child。 */
      getChild = () => {
        return this.childRef.current;
      };

      /** 返回带 ref 的 Child，父强制更新会重新创建该子元素。 */
      render() {
        return <Child ref={this.childRef} />;
      }
    }

    let renderCount = 0;
    let postRenderCount = 0;
    let once = false;

    /** 在 willUpdate 一次追加 updated=true，并对每次 render 和 mount/update 完成做计数配对。 */
    class Child extends React.Component {
      /** 一次性生命周期更新把 updated 从 false 改为 true。 */
      state = {updated: false};

      /** 通过共享 once 只安排一次 state 更新，避免该 fixture 自己形成无限循环。 */
      UNSAFE_componentWillUpdate() {
        if (!once) {
          once = true;
          this.setState({updated: true});
        }
      }

      /** 要求 mount 对应一次尚未配对的 render，然后增加 postRenderCount。 */
      componentDidMount() {
        expect(renderCount).toBe(postRenderCount + 1);
        postRenderCount++;
      }

      /** 要求当前 update 对应一次尚未配对的 render，再增加完成计数。 */
      componentDidUpdate() {
        expect(renderCount).toBe(postRenderCount + 1);
        postRenderCount++;
      }

      /** 检查之前 render 已有提交配对，再增加 renderCount；这比仅按标题断言“一次更新”更精确。 */
      render() {
        expect(renderCount).toBe(postRenderCount);
        renderCount++;
        return <div />;
      }
    }

    const container = document.createElement('div');
    const parent = ReactDOM.render(<Parent />, container);
    const child = parent.getChild();
    ReactDOM.unstable_batchedUpdates(function () {
      parent.forceUpdate();
      child.forceUpdate();
    });
  });

  /** App didMount 删除 EmitsChangeOnUnmount，后者删除时发 store 通知；存活 ForceUpdatesOnChange mount 时已订阅并自行 forceUpdate，通知又安排更新。测试要求整段 legacy render 能完成，没有断言更新次数或宿主输出。 */
  // @gate !disableLegacyMode
  it('does not update one component twice in a batch (#6371)', () => {
    let callbacks = [];
    /** 调用当前 callbacks 中的订阅函数，模拟同步外部 store 变更通知。 */
    function emitChange() {
      callbacks.forEach(c => c());
    }

    /** 首次 mount 后删除 EmitsChangeOnUnmount，让它的删除回调通知仍保留的订阅组件。 */
    class App extends React.Component {
      /** 初始化 showChild=true，先挂载通知源与订阅者。 */
      constructor(props) {
        super(props);
        this.state = {showChild: true};
      }
      /** 安排 showChild=false，触发删除阶段的 emitChange。 */
      componentDidMount() {
        this.setState({showChild: false});
      }
      /** 总是保留 ForceUpdatesOnChange，并按 state 控制通知源子组件。 */
      render() {
        return (
          <div>
            <ForceUpdatesOnChange />
            {this.state.showChild && <EmitsChangeOnUnmount />}
          </div>
        );
      }
    }

    /** 作为删除时发出同步 store 通知的组件，不产生宿主节点。 */
    class EmitsChangeOnUnmount extends React.Component {
      /** 调用 emitChange，给存活订阅者触发 forceUpdate。 */
      componentWillUnmount() {
        emitChange();
      }
      /** 返回 null，删除通知由生命周期承担。 */
      render() {
        return null;
      }
    }

    /** mount 时订阅 forceUpdate，unmount 时移除自身回调，模拟同步 store 订阅生命周期。 */
    class ForceUpdatesOnChange extends React.Component {
      /** 创建并立即调用 onChange，再保存订阅；删除兄弟时 emitChange 会再次调用它。 */
      componentDidMount() {
        /** 将 store 通知转成当前已挂载订阅者的一次 forceUpdate；同一函数身份用于订阅和卸载过滤。 */
        this.onChange = () => this.forceUpdate();
        this.onChange();
        callbacks.push(this.onChange);
      }
      /** 按函数身份过滤 callbacks，防止已卸载订阅者继续接收通知。 */
      componentWillUnmount() {
        callbacks = callbacks.filter(c => c !== this.onChange);
      }
      /** 返回随机 key 的 div 及空事件函数；本例只验证复杂嵌套更新能结束，没有 DOM 或提交次数断言。 */
      render() {
        return <div key={Math.random()} onClick={/** 空事件处理器，仅保留带监听属性的宿主 fixture。 */ function () {}} />;
      }
    }

    ReactDOM.render(<App />, document.createElement('div'));
  });

  /** unstable_batchedUpdates 的回调只返回 42；检查外层调用也返回 42，验证批处理包装保留回调返回值，不涉及渲染或更新次数。 */
  it('unstable_batchedUpdates should return value from a callback', () => {
    const result = ReactDOM.unstable_batchedUpdates(function () {
      return 42;
    });
    expect(result).toEqual(42);
  });

  /** 容器先挂载 span a；同批卸载旧根并在原容器 render span b。最终 textContent=b，验证卸载后可在同一批次建立新根。 */
  // @gate !disableLegacyMode
  it('unmounts and remounts a root in the same batch', () => {
    const container = document.createElement('div');
    ReactDOM.render(<span>a</span>, container);
    ReactDOM.unstable_batchedUpdates(function () {
      ReactDOM.unmountComponentAtNode(container);
      ReactDOM.render(<span>b</span>, container);
    });
    expect(container.textContent).toBe('b');
  });

  /** Editor 初次 mount 通过 onChange 令外部 props.rendered=true 并重入同容器 render；随后把 text 改为 goodbye。检查最终文字 goodbye、mounts=1，验证 mount 生命周期内的重入更新没有重挂载原实例。 */
  // @gate !disableLegacyMode
  it('handles reentrant mounting in synchronous mode', () => {
    let mounts = 0;
    /** mount 中通过 onChange 请求重入 render，用 rendered 标记观察是否错误地重新挂载。 */
    class Editor extends React.Component {
      /** 显示当前 props.text，最终应从 hello 变为 goodbye。 */
      render() {
        return <div>{this.props.text}</div>;
      }
      /** 增加 mount 次数；首次 rendered=false 时通知外部改为 true，后续 props 更新不应再挂载。 */
      componentDidMount() {
        mounts++;
        // 首次 mount 请求 rendered=true；重入的是 props 更新，不应重新 mount。
        if (!this.props.rendered) {
          this.props.onChange({rendered: true});
        }
      }
    }

    const container = document.createElement('div');
    /** 把当前可变 props 渲染到同一容器；onChange 浅合并新属性后递归调用此函数，检验 mount 提交中的重入根更新。 */
    function render() {
      ReactDOM.render(
        <Editor
          onChange={/** 浅合并 Editor 请求的新属性，再更新同一 legacy 根。 */ newProps => {
            props = {...props, ...newProps};
            render();
          }}
          {...props}
        />,
        container,
      );
    }

    let props = {text: 'hello', rendered: false};
    render();
    props = {...props, text: 'goodbye'};
    render();
    expect(container.textContent).toBe('goodbye');
    expect(mounts).toBe(1);
  });

  /** 在 unstable_batchedUpdates 回调内首次 legacy render Hello 后立即读 DOM，再卸载并再次读；ops 必须为 Hello、空串，验证首次挂载和卸载在这些调用返回前已完成。 */
  // @gate !disableLegacyMode
  it('mounts and unmounts are sync even in a batch', () => {
    const ops = [];
    const container = document.createElement('div');
    ReactDOM.unstable_batchedUpdates(() => {
      ReactDOM.render(<div>Hello</div>, container);
      ops.push(container.textContent);
      ReactDOM.unmountComponentAtNode(container);
      ops.push(container.textContent);
    });
    expect(ops).toEqual(['Hello', '']);
  });

  /** Foo 的 a/b 初值 false；根更新时 willUpdate 追加 a=true，didUpdate 追加 b=true。日志先记录 false/false 的当前提交，再一次记录 true/true 和 didUpdate，无额外提交，验证两个生命周期更新进入紧接的同一提交。 */
  // @gate !disableLegacyMode
  it(
    'in legacy mode, updates in componentWillUpdate and componentDidUpdate ' +
      'should both flush in the immediately subsequent commit',
    () => {
      const ops = [];
      /** 在 willUpdate 安排 a=true、didUpdate 安排 b=true，日志检测两者进入紧接的一次提交。 */
      class Foo extends React.Component {
        /** a/b 都为 false，以两个生命周期分别改变。 */
        state = {a: false, b: false};
        /** nextState.a 尚未变为 true 时追加 a=true，供后续队列处理而非改写当前渲染状态。 */
        UNSAFE_componentWillUpdate(_, nextState) {
          if (!nextState.a) {
            this.setState({a: true});
          }
        }
        /** 记录 Foo updated；b 仍为 false 时追加 b=true，与 willUpdate 的 a 更新在下一提交合并。 */
        componentDidUpdate() {
          ops.push('Foo updated');
          if (!this.state.b) {
            this.setState({b: true});
          }
        }
        /** 记录当前 a/b，不输出宿主节点，让 ops 表明每一遍渲染与提交。 */
        render() {
          ops.push(`a: ${this.state.a}, b: ${this.state.b}`);
          return null;
        }
      }

      const container = document.createElement('div');
      // 挂载。
      ReactDOM.render(<Foo />, container);
      // 根更新
      ReactDOM.render(<Foo />, container);
      expect(ops).toEqual([
        // 挂载。
        'a: false, b: false',
        // 根更新
        'a: false, b: false',
        'Foo updated',
        // 后续更新（a 和 b 都应该已经冲刷）
        'a: true, b: true',
        'Foo updated',
        // 没有任何额外的更新
      ]);
    },
  );

  /** Foo willUpdate 追加 a=true，兄弟 Bar didUpdate 追加 b=true；初次与根更新均记录 false，之后同一遍记录两者 true。精确比较 render/didUpdate 日志，验证这两种生命周期更新跨兄弟合并到下一提交。 */
  // @gate !disableLegacyMode
  it(
    'in legacy mode, updates in componentWillUpdate and componentDidUpdate ' +
      '(on a sibling) should both flush in the immediately subsequent commit',
    () => {
      const ops = [];
      /** 负责 willUpdate 中的 a 更新，与兄弟 Bar 的 didUpdate 更新一起被下次提交处理。 */
      class Foo extends React.Component {
        /** a 初始为 false。 */
        state = {a: false};
        /** nextState.a 为 false 时给当前 Foo 入队 a=true。 */
        UNSAFE_componentWillUpdate(_, nextState) {
          if (!nextState.a) {
            this.setState({a: true});
          }
        }
        /** 只记录 Foo 的更新提交，不再追加 state。 */
        componentDidUpdate() {
          ops.push('Foo updated');
        }
        /** 将当前 a 追加到日志。 */
        render() {
          ops.push(`a: ${this.state.a}`);
          return null;
        }
      }

      /** 在 didUpdate 追加 b=true，和兄弟 Foo 的 render 阶段更新合并到随后提交。 */
      class Bar extends React.Component {
        /** b 初始为 false，首次更新提交后才安排 true。 */
        state = {b: false};
        /** 记录 Bar updated，b 为 false 时入队一次 b=true。 */
        componentDidUpdate() {
          ops.push('Bar updated');
          if (!this.state.b) {
            this.setState({b: true});
          }
        }
        /** 把当前 b 写入日志，与 Foo 的 a 日志对齐。 */
        render() {
          ops.push(`b: ${this.state.b}`);
          return null;
        }
      }

      const container = document.createElement('div');
      // 挂载。
      ReactDOM.render(
        <div>
          <Foo />
          <Bar />
        </div>,
        container,
      );
      // 根更新
      ReactDOM.render(
        <div>
          <Foo />
          <Bar />
        </div>,
        container,
      );
      expect(ops).toEqual([
        // 挂载。
        'a: false',
        'b: false',
        // 根更新
        'a: false',
        'b: false',
        'Foo updated',
        'Bar updated',
        // 后续更新（a 和 b 都应该已经冲刷）
        'a: true',
        'b: true',
        'Foo updated',
        'Bar updated',
        // 没有任何额外的更新
      ]);
    },
  );

  /** Foo render 捕获当前 step 并排入函数式更新：baseStep=0 时返回 step=1，之后返回 null。检查 DEV render 更新警告以及两条 base/memoized=0/0、1/1，验证 updater 使用真实队列 baseState 且第二轮正确终止。 */
  // @gate !disableLegacyMode
  it('uses correct base state for setState inside render phase', () => {
    const ops = [];

    /** 在 render 安排函数式更新，比较该次 render 闭包中的 memoizedStep 与队列给 updater 的 baseState。 */
    class Foo extends React.Component {
      /** step 初始为 0，只允许 updater 首次返回 step=1。 */
      state = {step: 0};
      /** 捕获本次 state.step 后排入函数式更新；updater 记录 base/memoized，baseStep 已为 1 时返回 null 停止循环。 */
      render() {
        const memoizedStep = this.state.step;
        this.setState(baseState => {
          const baseStep = baseState.step;
          ops.push(`base: ${baseStep}, memoized: ${memoizedStep}`);
          return baseStep === 0 ? {step: 1} : null;
        });
        return null;
      }
    }

    const container = document.createElement('div');
    ReactDOM.render(<Foo />, container);
    assertConsoleErrorDev([
      'Cannot update during an existing state transition (such as within `render`). ' +
        'Render methods should be a pure function of props and state.\n' +
        '    in Foo (at **)',
    ]);
    expect(ops).toEqual(['base: 0, memoized: 0', 'base: 1, memoized: 1']);
  });

  /** 挂载 Foo 后清空 render 日志，给实例 setState 一个返回 null 的 updater；日志仍为空，验证该次没有 state/props 变化时类更新跳过 render。 */
  // @gate !disableLegacyMode
  it('does not re-render if state update is null', () => {
    const container = document.createElement('div');

    let instance;
    let ops = [];
    /** 保存实例并记录 render，观察返回 null 的 updater 是否被当作无状态变化。 */
    class Foo extends React.Component {
      /** 设置 instance 后记录 render；清空初次日志后，null updater 不应再次执行这里。 */
      render() {
        instance = this;
        ops.push('render');
        return <div />;
      }
    }
    ReactDOM.render(<Foo />, container);

    ops = [];
    instance.setState(() => null);
    expect(ops).toEqual([]);
  });

  // 该用例使用 legacy root，隐藏子树仍同步渲染；行为受 !disableLegacyMode 限定。
  /** Foo 下先放 hidden div 内的 Bar，再放可见 Baz；legacy 首次挂载与后续根更新日志都为 Foo/Bar/Baz。验证普通 hidden 宿主属性不把这段 legacy 子树延后调度。 */
  // @gate !disableLegacyMode
  it('synchronously renders hidden subtrees', () => {
    const container = document.createElement('div');
    let ops = [];

    /** 记录可见兄弟 Baz 的 render，作为隐藏 Bar 的执行次序对照。 */
    function Baz() {
      ops.push('Baz');
      return null;
    }

    /** 记录 hidden 宿主 div 内的 Bar；legacy 根仍在当前同步遍历中渲染它。 */
    function Bar() {
      ops.push('Bar');
      return null;
    }

    /** 先创建 hidden div 内的 Bar，再创建可见 Baz，按树序检查同步渲染日志。 */
    function Foo() {
      ops.push('Foo');
      return (
        <div>
          <div hidden={true}>
            <Bar />
          </div>
          <Baz />
        </div>
      );
    }

    // 挂载。
    ReactDOM.render(<Foo />, container);
    expect(ops).toEqual(['Foo', 'Bar', 'Baz']);
    ops = [];

    // 更新。
    ReactDOM.render(<Foo />, container);
    expect(ops).toEqual(['Foo', 'Bar', 'Baz']);
  });

  /** Foo didMount 在 1200 个新容器各建 legacy 根，最后一根的回调再给 Foo setState；整个 render 应完成，没有显式错误断言。检验许多独立根工作不会按同根持续嵌套更新误判为过限。 */
  // @gate !disableLegacyMode
  it('can render ridiculously large number of roots without triggering infinite update loop error', () => {
    /** mount 中建立 1200 个独立容器根，最后一根的回调再更新原 Foo，检测计数不应误判为同根无限循环。 */
    class Foo extends React.Component {
      /** 依次在新 div 上 legacy render；最后一次提交回调给当前实例 setState，而非持续更新同一个根。 */
      componentDidMount() {
        const limit = 1200;
        for (let i = 0; i < limit; i++) {
          if (i < limit - 1) {
            ReactDOM.render(<div />, document.createElement('div'));
          } else {
            ReactDOM.render(<div />, document.createElement('div'), () => {
              // 最后一根的提交回调更新原 Foo；本例要求整个过程正常结束。
              this.setState({});
            });
          }
        }
      }
      /** 返回 null，让本例只检查大批独立根挂载能完成。 */
      render() {
        return null;
      }
    }

    const container = document.createElement('div');
    ReactDOM.render(<Foo />, container);
  });

  /** EventuallyTerminating 从 0 递增到 limit；55 时 act 抛 Maximum，改为 45 后重新挂载及两次重置 step=0 都能结束于文本 45。再改回 55、重置则再次抛错并令 ref=null，验证独立循环重新计数且错误能卸载根。 */
  // @gate !disableLegacyMode
  it('resets the update counter for unrelated updates', async () => {
    const container = document.createElement('div');
    const ref = React.createRef();

    /** 从 0 逐步加到可变 limit，先触发过限错误，再检验后续独立更新可重新计数。 */
    class EventuallyTerminating extends React.Component {
      /** 每轮递增的 step 从 0 开始。 */
      state = {step: 0};
      /** 挂载后把 step 改为 1，启动 didUpdate 递增链。 */
      componentDidMount() {
        this.setState({step: 1});
      }
      /** 仅在 step 小于外部 limit 时追加下一步，limit=45 可结束、55 用于触发过限。 */
      componentDidUpdate() {
        if (this.state.step < limit) {
          this.setState({step: this.state.step + 1});
        }
      }
      /** 把 step 作为宿主文本，供结束于 limit 的断言检查。 */
      render() {
        return this.state.step;
      }
    }

    let limit = 55;
    await expect(async () => {
      await act(() => {
        ReactDOM.render(<EventuallyTerminating ref={ref} />, container);
      });
    }).rejects.toThrow('Maximum');

    // 每轮 limit=45 都应正常结束，嵌套计数不能累计此前已经结束的独立更新。
    limit -= 10;
    ReactDOM.render(<EventuallyTerminating ref={ref} />, container);
    expect(container.textContent).toBe(limit.toString());
    ref.current.setState({step: 0});
    expect(container.textContent).toBe(limit.toString());
    ref.current.setState({step: 0});
    expect(container.textContent).toBe(limit.toString());

    limit += 10;
    await expect(async () => {
      await act(() => {
        ref.current.setState({step: 0});
      });
    }).rejects.toThrow('Maximum');
    expect(ref.current).toBe(null);
  });

  /** NonTerminating mount 设置 step=1，每次 willUpdate 无条件再设置 step=2，没有终止条件。act 必须拒绝 Maximum，验证 legacy render 生命周期中的持续更新被根级保护终止。 */
  // @gate !disableLegacyMode
  it('does not fall into an infinite update loop', async () => {
    /** mount 后启动更新，每次 willUpdate 又安排 step=2，即使值相同也继续安排类更新。 */
    class NonTerminating extends React.Component {
      /** 初始 step=0。 */
      state = {step: 0};
      /** 设置 step=1，进入首次更新生命周期。 */
      componentDidMount() {
        this.setState({step: 1});
      }
      /** 每次 update 都再次 setState step=2，没有终止条件，触发嵌套更新保护。 */
      UNSAFE_componentWillUpdate() {
        this.setState({step: 2});
      }
      /** 输出 Hello、name 与 step；本例关注后续无限更新错误，不检查这段文本。 */
      render() {
        return (
          <div>
            Hello {this.props.name}
            {this.state.step}
          </div>
        );
      }
    }

    const container = document.createElement('div');
    await expect(async () => {
      await act(() => {
        ReactDOM.render(<NonTerminating />, container);
      });
    }).rejects.toThrow('Maximum');
  });

  /** 函数组件每次 layout effect 都给 step 函数式加一，无依赖也无终止条件；legacy act 拒绝 Maximum，验证提交阶段同步级联更新达到根级上限。 */
  // @gate !disableLegacyMode
  it('does not fall into an infinite update loop with useLayoutEffect', async () => {
    /** 每次 layout effect 都函数式递增 step，形成无终止条件的同步提交级联。 */
    function NonTerminating() {
      const [step, setStep] = React.useState(0);
      React.useLayoutEffect(() => {
        setStep(x => x + 1);
      });
      return step;
    }

    const container = document.createElement('div');
    await expect(async () => {
      await act(() => {
        ReactDOM.render(<NonTerminating />, container);
      });
    }).rejects.toThrow('Maximum');
  });

  /** 无限 didUpdate 组件在同一容器 render 后抛 Maximum，再换一次性 mount 更新到 1 的组件并检查文本 1；重复该错误/恢复过程，验证过限后的容器仍能渲染新的有限组件。 */
  // @gate !disableLegacyMode
  it('can recover after falling into an infinite update loop', async () => {
    /** mount 与每次 didUpdate 都安排新更新，用于反复触发根级无限更新错误。 */
    class NonTerminating extends React.Component {
      /** 循环从 step=0 开始。 */
      state = {step: 0};
      /** 设置 step=1，启动更新提交链。 */
      componentDidMount() {
        this.setState({step: 1});
      }
      /** 无条件设置 step=2，使相同值的对象更新仍持续产生更新。 */
      componentDidUpdate() {
        this.setState({step: 2});
      }
      /** 返回当前 step，让容器在错误恢复时可被另一个组件替换。 */
      render() {
        return this.state.step;
      }
    }

    /** 只在 mount 更新一次到 step=1，作为过限错误后的根恢复对照。 */
    class Terminating extends React.Component {
      /** 初始 step=0。 */
      state = {step: 0};
      /** 一次性设置 step=1，没有 didUpdate 继续更新。 */
      componentDidMount() {
        this.setState({step: 1});
      }
      /** 输出 step，恢复后容器应为文本 1。 */
      render() {
        return this.state.step;
      }
    }

    const container = document.createElement('div');
    await expect(async () => {
      await act(() => {
        ReactDOM.render(<NonTerminating />, container);
      });
    }).rejects.toThrow('Maximum');

    ReactDOM.render(<Terminating />, container);
    expect(container.textContent).toBe('1');

    await expect(async () => {
      await act(() => {
        ReactDOM.render(<NonTerminating />, container);
      });
    }).rejects.toThrow('Maximum');

    ReactDOM.render(<Terminating />, container);
    expect(container.textContent).toBe('1');
  });

  /** A/B 的 didMount 交替在同一个 container render 对方，产生反复类型替换与挂载；act 抛 Maximum。这里只验证共享一个根的互递归，不以它推断不同根间的保护行为。 */
  // @gate !disableLegacyMode
  it('does not fall into mutually recursive infinite update loop with same container', async () => {
    // A/B 共享同一个根；此用例没有验证不同根之间的互递归。

    /** mount 中在同一容器 render B，和 B 互相替换引起持续挂载。 */
    class A extends React.Component {
      /** 在共享 container 上 render B，导致当前 A 被另一类型替换。 */
      componentDidMount() {
        ReactDOM.render(<B />, container);
      }
      /** 返回 null，循环来自 mount 重入而非宿主变化。 */
      render() {
        return null;
      }
    }

    /** mount 中在同一容器 render A，完成 A/B 相互重挂载的另一半。 */
    class B extends React.Component {
      /** 在共享 container 上 render A，重启 A 的 mount 生命周期。 */
      componentDidMount() {
        ReactDOM.render(<A />, container);
      }
      /** 返回 null，仅以生命周期创建互递归更新。 */
      render() {
        return null;
      }
    }

    const container = document.createElement('div');
    await expect(async () => {
      await act(() => {
        ReactDOM.render(<A />, container);
      });
    }).rejects.toThrow('Maximum');
  });

  /** BadRender 持续抛 error；边界 didCatch 排入自身空更新并调用父 remount，父递增 key 建新边界，错误继续。act 最终拒绝 Maximum，验证错误恢复本身造成的持续更新也受到保护。 */
  // @gate !disableLegacyMode
  it('does not fall into an infinite error loop', async () => {
    /** 每次 render 直接抛 error，触发相邻 ErrorBoundary 的 didCatch。 */
    function BadRender() {
      throw new Error('error');
    }

    /** 捕获后既排入自身空更新，又通知父组件换 key 重挂载边界，构造持续错误循环。 */
    class ErrorBoundary extends React.Component {
      /** 先 setState 空对象避免缺少恢复更新的 DEV 诊断，再调用 parent.remount；不是吞掉错误后结束渲染。 */
      componentDidCatch() {
        // 调度一次无操作 state 更新，避免测试在 DEV 中触发警告。
        this.setState({});

        this.props.parent.remount();
      }
      /** 始终返回会抛错的 BadRender，父改 key 后新边界仍会出错。 */
      render() {
        return <BadRender />;
      }
    }

    /** 通过递增 step 作为 ErrorBoundary key，使每次捕获都挂载新的错误边界。 */
    class NonTerminating extends React.Component {
      /** 初始边界 key 为 0。 */
      state = {step: 0};
      /** 函数式递增 step，使用队列最新 state 而非当前实例的旧值来生成下一 key。 */
      remount() {
        this.setState(state => ({step: state.step + 1}));
      }
      /** 返回带当前 step key 的边界，并把自身传作 remount 接收者。 */
      render() {
        return <ErrorBoundary key={this.state.step} parent={this} />;
      }
    }

    const container = document.createElement('div');
    await expect(async () => {
      await act(() => {
        ReactDOM.render(<NonTerminating />, container);
      });
    }).rejects.toThrow('Maximum');
  });

  /** App 挂载 1200 个带稳定 key 的 Child 并收集实例；同一批次给每个 Child 更新 value。测试要求批次正常结束，没有最终值/次数断言，验证大量同批入队不等于持续嵌套提交。 */
  // @gate !disableLegacyMode
  it('can schedule ridiculously many updates within the same batch without triggering a maximum update error', () => {
    const subscribers = [];

    /** 收集 1200 个已挂载实例，每个只在同一批次收到一次值更新。 */
    class Child extends React.Component {
      /** 被批量更新的 value 初始为 initial。 */
      state = {value: 'initial'};
      /** 把实例加入 subscribers，便于一次批次遍历全部孩子。 */
      componentDidMount() {
        subscribers.push(this);
      }
      /** 返回 null，更新压力来自队列数量，不来自宿主树大小。 */
      render() {
        return null;
      }
    }

    /** 创建 1200 个不同 key 的 Child，供一次批次入队 1200 个更新。 */
    class App extends React.Component {
      /** 按 0..1199 构造 children 数组，每个 key 固定为其索引。 */
      render() {
        const children = [];
        for (let i = 0; i < 1200; i++) {
          children.push(<Child key={i} />);
        }
        return children;
      }
    }

    const container = document.createElement('div');
    ReactDOM.render(<App />, container);

    ReactDOM.unstable_batchedUpdates(() => {
      subscribers.forEach(s => {
        s.setState({value: 'update'});
      });
    });
  });

  // TODO：用 @gate pragma 替换此分支。
  if (__DEV__) {
    /** 仅 DEV 分支执行；passive effect 在 step<50 时逐次加一，到 50 停止。首次 act 比较完整 0..50 日志及文本 50，再用外部 setter 重置 0 后仍达到 50，验证限内级联与独立后续更新可完成。 */
    // @gate !disableLegacyMode
    it('can have nested updates if they do not cross the limit', async () => {
      let _setStep;
      const LIMIT = 50;

      /** DEV 用例中 passive effect 在 step<50 时递增，达到 50 后停止；公开 setter 用于再启动独立的一轮。 */
      function Terminating() {
        const [step, setStep] = React.useState(0);
        _setStep = setStep;
        React.useEffect(() => {
          if (step < LIMIT) {
            setStep(x => x + 1);
          }
        });
        Scheduler.log(step);
        return step;
      }

      const container = document.createElement('div');
      await act(() => {
        ReactDOM.render(<Terminating />, container);
      });
      assertLog(Array.from({length: LIMIT + 1}, (_, k) => k));
      expect(container.textContent).toBe('50');
      await act(() => {
        _setStep(0);
      });
      expect(container.textContent).toBe('50');
    });

    /** 仅 DEV 分支执行；首次 passive effect 内循环排入 1000 个函数式加一更新并记 Done。act 后日志只含 Done、文本为 1000，验证同一 effect 的大量入队可合并处理且不触发嵌套更新警告。 */
    // @gate !disableLegacyMode
    it('can have many updates inside useEffect without triggering a warning', async () => {
      /** 仅在首次 passive effect 内连续排入 1000 个函数式加一更新，验证单批数量不会被当成嵌套提交次数。 */
      function Terminating() {
        const [step, setStep] = React.useState(0);
        React.useEffect(() => {
          for (let i = 0; i < 1000; i++) {
            setStep(x => x + 1);
          }
          Scheduler.log('Done');
        }, []);
        return step;
      }

      const container = document.createElement('div');
      await act(() => {
        ReactDOM.render(<Terminating />, container);
      });

      assertLog(['Done']);
      expect(container.textContent).toBe('1000');
    });
  }
});
