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

  // @gate !disableLegacyMode && classic
  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should batch state when updating state twice」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should batch state when updating state twice', () => {
    let updateCount = 0;

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.state`：记录测试夹具在当前场景中的状态。 */
      state = {x: 0};

      /** `Component.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        updateCount++;
      }

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode && classic
  /** 测试场景：验证「should batch state when updating two different state keys」描述的渲染、交互或错误处理结果。 */
  it('should batch state when updating two different state keys', () => {
    let updateCount = 0;

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.state`：记录测试夹具在当前场景中的状态。 */
      state = {x: 0, y: 0};

      /** `Component.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        updateCount++;
      }

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode && classic
  /** 测试场景：验证「should batch state and props together」描述的渲染、交互或错误处理结果。 */
  it('should batch state and props together', () => {
    let updateCount = 0;

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.state`：记录测试夹具在当前场景中的状态。 */
      state = {y: 0};

      /** `Component.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        updateCount++;
      }

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode && classic
  /** 测试场景：验证「should batch parent/child state updates together」描述的渲染、交互或错误处理结果。 */
  it('should batch parent/child state updates together', () => {
    let parentUpdateCount = 0;

    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.state`：记录测试夹具在当前场景中的状态。 */
      state = {x: 0};
      /** `Parent.childRef`：记录测试夹具在当前场景中的状态。 */
      childRef = React.createRef();

      /** `Parent.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        parentUpdateCount++;
      }

      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            <Child ref={this.childRef} x={this.state.x} />
          </div>
        );
      }
    }

    let childUpdateCount = 0;

    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.state`：记录测试夹具在当前场景中的状态。 */
      state = {y: 0};

      /** `Child.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        childUpdateCount++;
      }

      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode && classic
  /** 测试场景：验证「should batch child/parent state updates together」描述的渲染、交互或错误处理结果。 */
  it('should batch child/parent state updates together', () => {
    let parentUpdateCount = 0;

    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.state`：记录测试夹具在当前场景中的状态。 */
      state = {x: 0};
      /** `Parent.childRef`：记录测试夹具在当前场景中的状态。 */
      childRef = React.createRef();

      /** `Parent.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        parentUpdateCount++;
      }

      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            <Child ref={this.childRef} x={this.state.x} />
          </div>
        );
      }
    }

    let childUpdateCount = 0;

    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.state`：记录测试夹具在当前场景中的状态。 */
      state = {y: 0};

      /** `Child.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        childUpdateCount++;
      }

      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode && classic
  /** 测试场景：验证「should support chained state updates」描述的渲染、交互或错误处理结果。 */
  it('should support chained state updates', () => {
    let updateCount = 0;

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.state`：记录测试夹具在当前场景中的状态。 */
      state = {x: 0};

      /** `Component.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        updateCount++;
      }

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode && classic
  /** 测试场景：验证「should batch forceUpdate together」描述的渲染、交互或错误处理结果。 */
  it('should batch forceUpdate together', () => {
    let shouldUpdateCount = 0;
    let updateCount = 0;

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.state`：记录测试夹具在当前场景中的状态。 */
      state = {x: 0};

      /** `Component.shouldComponentUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      shouldComponentUpdate() {
        shouldUpdateCount++;
      }

      /** `Component.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        updateCount++;
      }

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「should update children even if parent blocks updates」描述的渲染、交互或错误处理结果。 */
  it('should update children even if parent blocks updates', () => {
    let parentRenderCount = 0;
    let childRenderCount = 0;

    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.childRef`：记录测试夹具在当前场景中的状态。 */
      childRef = React.createRef();

      /** `Parent.shouldComponentUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      shouldComponentUpdate() {
        return false;
      }

      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        parentRenderCount++;
        return <Child ref={this.childRef} />;
      }
    }

    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「should not reconcile children passed via props」描述的渲染、交互或错误处理结果。 */
  it('should not reconcile children passed via props', () => {
    let numMiddleRenders = 0;
    let numBottomRenders = 0;

    /** `Top`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Top extends React.Component {
      /** `Top.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <Middle>
            <Bottom />
          </Middle>
        );
      }
    }

    /** `Middle`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Middle extends React.Component {
      /** `Middle.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        this.forceUpdate();
      }

      /** `Middle.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        numMiddleRenders++;
        return React.Children.only(this.props.children);
      }
    }

    /** `Bottom`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Bottom extends React.Component {
      /** `Bottom.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「should flow updates correctly」描述的渲染、交互或错误处理结果。 */
  it('should flow updates correctly', () => {
    let willUpdates = [];
    let didUpdates = [];

    const UpdateLoggingMixin = {
      /** `UNSAFE_componentWillUpdate`：封装当前用例复用的操作、回调或断言步骤。 */
      UNSAFE_componentWillUpdate: function () {
        willUpdates.push(this.constructor.displayName);
      },
      /** `componentDidUpdate`：封装当前用例复用的操作、回调或断言步骤。 */
      componentDidUpdate: function () {
        didUpdates.push(this.constructor.displayName);
      },
    };

    /** `Box`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Box extends React.Component {
      /** `Box.boxDivRef`：记录测试夹具在当前场景中的状态。 */
      boxDivRef = React.createRef();

      /** `Box.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div ref={this.boxDivRef}>{this.props.children}</div>;
      }
    }
    Object.assign(Box.prototype, UpdateLoggingMixin);

    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.spanRef`：记录测试夹具在当前场景中的状态。 */
      spanRef = React.createRef();

      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <span ref={this.spanRef}>child</span>;
      }
    }
    Object.assign(Child.prototype, UpdateLoggingMixin);

    /** `Switcher`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Switcher extends React.Component {
      /** `Switcher.state`：记录测试夹具在当前场景中的状态。 */
      state = {tabKey: 'hello'};
      /** `Switcher.boxRef`：记录测试夹具在当前场景中的状态。 */
      boxRef = React.createRef();
      /** `Switcher.switcherDivRef`：记录测试夹具在当前场景中的状态。 */
      switcherDivRef = React.createRef();
      /** `Switcher.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

    /** `App`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class App extends React.Component {
      /** `App.switcherRef`：记录测试夹具在当前场景中的状态。 */
      switcherRef = React.createRef();
      /** `App.childRef`：记录测试夹具在当前场景中的状态。 */
      childRef = React.createRef();

      /** `App.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

    /** `expectUpdates`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** `triggerUpdate`：封装当前用例复用的操作、回调或断言步骤。 */
    function triggerUpdate(c) {
      c.setState({x: 1});
    }

    /** `testUpdates`：封装当前用例复用的操作、回调或断言步骤。 */
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
      // 在 owner-child 关系中，will 与 did 生命周期的执行顺序相反。
      ['Switcher', 'Box'],
      ['Box', 'Switcher'],
    );

    testUpdates(
      [root.childRef.current, root.switcherRef.current.boxRef.current],
      // 二者不是 owner-child 关系，因此分别进行 reconcile。
      ['Box', 'Child'],
      ['Box', 'Child'],
    );

    testUpdates(
      [root.childRef.current, root.switcherRef.current],
      // Switcher 拥有 Box 与 Child；Box 不拥有 Child。
      ['Switcher', 'Box', 'Child'],
      ['Box', 'Switcher', 'Child'],
    );
  });

  // @gate !disableLegacyMode && classic
  /** 测试场景：验证「should queue mount-ready handlers across different roots」描述的渲染、交互或错误处理结果。 */
  it('should queue mount-ready handlers across different roots', () => {
    // 定义 A、B 两个组件并同时更新；调用 A 的 componentDidUpdate 时，B 的 DOM 应已完成更新。

    const bContainer = document.createElement('div');

    let b;

    let aUpdated = false;

    /** `A`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class A extends React.Component {
      /** `A.state`：记录测试夹具在当前场景中的状态。 */
      state = {x: 0};

      /** `A.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        expect(findDOMNode(b).textContent).toBe('B1');
        aUpdated = true;
      }

      /** `A.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        let portal = null;
        // 如果使用 Fiber，我们使用 Portals 来实现这一点。
        portal = ReactDOM.createPortal(<B ref={n => (b = n)} />, bContainer);
        return (
          <div>
            A{this.state.x}
            {portal}
          </div>
        );
      }
    }

    /** `B`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class B extends React.Component {
      /** `B.state`：记录测试夹具在当前场景中的状态。 */
      state = {x: 0};

      /** `B.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「should flush updates in the correct order」描述的渲染、交互或错误处理结果。 */
  it('should flush updates in the correct order', () => {
    const updates = [];

    /** `Outer`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Outer extends React.Component {
      /** `Outer.state`：记录测试夹具在当前场景中的状态。 */
      state = {x: 0};
      /** `Outer.innerRef`：记录测试夹具在当前场景中的状态。 */
      innerRef = React.createRef();

      /** `Outer.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        updates.push('Outer-render-' + this.state.x);
        return (
          <div>
            <Inner x={this.state.x} ref={this.innerRef} />
          </div>
        );
      }

      /** `Outer.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        const x = this.state.x;
        updates.push('Outer-didUpdate-' + x);
        updates.push('Inner-setState-' + x);
        this.innerRef.current.setState({x: x}, function () {
          updates.push('Inner-callback-' + x);
        });
      }
    }

    /** `Inner`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Inner extends React.Component {
      /** `Inner.state`：记录测试夹具在当前场景中的状态。 */
      state = {x: 0};

      /** `Inner.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        updates.push('Inner-render-' + this.props.x + '-' + this.state.x);
        return <div />;
      }

      /** `Inner.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

    // 一次性冲刷全部批量更新。
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「should flush updates in the correct order across roots」描述的渲染、交互或错误处理结果。 */
  it('should flush updates in the correct order across roots', () => {
    const instances = [];
    const updates = [];

    /** `MockComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class MockComponent extends React.Component {
      /** `MockComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        updates.push(this.props.depth);
        return <div />;
      }

      /** `MockComponent.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「should queue nested updates」描述的渲染、交互或错误处理结果。 */
  it('should queue nested updates', () => {
  // 参见 https://github.com/facebook/react/issues/1147 。

    /** `X`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class X extends React.Component {
      /** `X.state`：记录测试夹具在当前场景中的状态。 */
      state = {s: 0};

      /** `X.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

      /** `X.go`：封装当前用例复用的操作、回调或断言步骤。 */
      go = () => {
        this.setState({s: 1});
        this.setState({s: 0});
        this.setState({s: 1});
      };
    }

    /** `Y`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Y extends React.Component {
      /** `Y.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            <Z />
          </div>
        );
      }
    }

    /** `Z`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Z extends React.Component {
      /** `Z.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }

      /** `Z.UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「should queue updates from during mount」描述的渲染、交互或错误处理结果。 */
  it('should queue updates from during mount', () => {
  // 参见 https://github.com/facebook/react/issues/1353 。
    let a;

    /** `A`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class A extends React.Component {
      /** `A.state`：记录测试夹具在当前场景中的状态。 */
      state = {x: 0};

      /** `A.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        a = this;
      }

      /** `A.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>A{this.state.x}</div>;
      }
    }

    /** `B`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class B extends React.Component {
      /** `B.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        a.setState({x: 1});
      }

      /** `B.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「calls componentWillReceiveProps setState callback properly」描述的渲染、交互或错误处理结果。 */
  it('calls componentWillReceiveProps setState callback properly', () => {
    let callbackCount = 0;

    /** `A`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class A extends React.Component {
      /** `A.state`：记录测试夹具在当前场景中的状态。 */
      state = {x: this.props.x};

      /** `A.UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps(nextProps) {
        const newX = nextProps.x;
        this.setState({x: newX}, function () {
          // 调用此回调时，state 应已完成更新。
          expect(this.state.x).toBe(newX);
          callbackCount++;
        });
      }

      /** `A.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.state.x}</div>;
      }
    }

    const container = document.createElement('div');
    ReactDOM.render(<A x={1} />, container);
    ReactDOM.render(<A x={2} />, container);
    expect(callbackCount).toBe(1);
  });

  // @gate !disableLegacyMode && classic
  /** 测试场景：验证「does not call render after a component as been deleted」描述的渲染、交互或错误处理结果。 */
  it('does not call render after a component as been deleted', () => {
    let renderCount = 0;
    let componentB = null;

    /** `B`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class B extends React.Component {
      /** `B.state`：记录测试夹具在当前场景中的状态。 */
      state = {updates: 0};

      /** `B.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        componentB = this;
      }

      /** `B.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        renderCount++;
        return <div />;
      }
    }

    /** `A`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class A extends React.Component {
      /** `A.state`：记录测试夹具在当前场景中的状态。 */
      state = {showB: true};

      /** `A.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「throws in setState if the update callback is not a function」描述的渲染、交互或错误处理结果。 */
  it('throws in setState if the update callback is not a function', async () => {
    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      this.a = 1;
      this.b = 2;
    }

    /** `A`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class A extends React.Component {
      /** `A.state`：记录测试夹具在当前场景中的状态。 */
      state = {};

      /** `A.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「throws in forceUpdate if the update callback is not a function」描述的渲染、交互或错误处理结果。 */
  it('throws in forceUpdate if the update callback is not a function', async () => {
    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      this.a = 1;
      this.b = 2;
    }

    /** `A`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class A extends React.Component {
      /** `A.state`：记录测试夹具在当前场景中的状态。 */
      state = {};

      /** `A.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「does not update one component twice in a batch (#2410)」描述的渲染、交互或错误处理结果。 */
  it('does not update one component twice in a batch (#2410)', () => {
    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.childRef`：记录测试夹具在当前场景中的状态。 */
      childRef = React.createRef();

      /** `Parent.getChild`：封装当前用例复用的操作、回调或断言步骤。 */
      getChild = () => {
        return this.childRef.current;
      };

      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <Child ref={this.childRef} />;
      }
    }

    let renderCount = 0;
    let postRenderCount = 0;
    let once = false;

    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.state`：记录测试夹具在当前场景中的状态。 */
      state = {updated: false};

      /** `Child.UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        if (!once) {
          once = true;
          this.setState({updated: true});
        }
      }

      /** `Child.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        expect(renderCount).toBe(postRenderCount + 1);
        postRenderCount++;
      }

      /** `Child.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        expect(renderCount).toBe(postRenderCount + 1);
        postRenderCount++;
      }

      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「does not update one component twice in a batch (#6371)」描述的渲染、交互或错误处理结果。 */
  it('does not update one component twice in a batch (#6371)', () => {
    let callbacks = [];
    /** `emitChange`：封装当前用例复用的操作、回调或断言步骤。 */
    function emitChange() {
      callbacks.forEach(c => c());
    }

    /** `App`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class App extends React.Component {
      /** `App.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        this.state = {showChild: true};
      }
      /** `App.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        this.setState({showChild: false});
      }
      /** `App.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            <ForceUpdatesOnChange />
            {this.state.showChild && <EmitsChangeOnUnmount />}
          </div>
        );
      }
    }

    /** `EmitsChangeOnUnmount`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class EmitsChangeOnUnmount extends React.Component {
      /** `EmitsChangeOnUnmount.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        emitChange();
      }
      /** `EmitsChangeOnUnmount.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    /** `ForceUpdatesOnChange`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ForceUpdatesOnChange extends React.Component {
      /** `ForceUpdatesOnChange.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        this.onChange = () => this.forceUpdate();
        this.onChange();
        callbacks.push(this.onChange);
      }
      /** `ForceUpdatesOnChange.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        callbacks = callbacks.filter(c => c !== this.onChange);
      }
      /** `ForceUpdatesOnChange.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div key={Math.random()} onClick={function () {}} />;
      }
    }

    ReactDOM.render(<App />, document.createElement('div'));
  });

  /** 测试场景：验证「unstable_batchedUpdates should return value from a callback」描述的渲染、交互或错误处理结果。 */
  it('unstable_batchedUpdates should return value from a callback', () => {
    const result = ReactDOM.unstable_batchedUpdates(function () {
      return 42;
    });
    expect(result).toEqual(42);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「unmounts and remounts a root in the same batch」描述的渲染、交互或错误处理结果。 */
  it('unmounts and remounts a root in the same batch', () => {
    const container = document.createElement('div');
    ReactDOM.render(<span>a</span>, container);
    ReactDOM.unstable_batchedUpdates(function () {
      ReactDOM.unmountComponentAtNode(container);
      ReactDOM.render(<span>b</span>, container);
    });
    expect(container.textContent).toBe('b');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「handles reentrant mounting in synchronous mode」描述的渲染、交互或错误处理结果。 */
  it('handles reentrant mounting in synchronous mode', () => {
    let mounts = 0;
    /** `Editor`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Editor extends React.Component {
      /** `Editor.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.props.text}</div>;
      }
      /** `Editor.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        mounts++;
        // 这里只应调用一次，但仍加上保护以防万一。
        if (!this.props.rendered) {
          this.props.onChange({rendered: true});
        }
      }
    }

    const container = document.createElement('div');
    /** `render`：封装当前用例复用的操作、回调或断言步骤。 */
    function render() {
      ReactDOM.render(
        <Editor
          onChange={newProps => {
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「mounts and unmounts are sync even in a batch」描述的渲染、交互或错误处理结果。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
  it(
    'in legacy mode, updates in componentWillUpdate and componentDidUpdate ' +
      'should both flush in the immediately subsequent commit',
    () => {
      const ops = [];
      /** `Foo`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Foo extends React.Component {
        /** `Foo.state`：记录测试夹具在当前场景中的状态。 */
        state = {a: false, b: false};
        /** `Foo.UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
        UNSAFE_componentWillUpdate(_, nextState) {
          if (!nextState.a) {
            this.setState({a: true});
          }
        }
        /** `Foo.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
        componentDidUpdate() {
          ops.push('Foo updated');
          if (!this.state.b) {
            this.setState({b: true});
          }
        }
        /** `Foo.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
  it(
    'in legacy mode, updates in componentWillUpdate and componentDidUpdate ' +
      '(on a sibling) should both flush in the immediately subsequent commit',
    () => {
      const ops = [];
      /** `Foo`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Foo extends React.Component {
        /** `Foo.state`：记录测试夹具在当前场景中的状态。 */
        state = {a: false};
        /** `Foo.UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
        UNSAFE_componentWillUpdate(_, nextState) {
          if (!nextState.a) {
            this.setState({a: true});
          }
        }
        /** `Foo.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
        componentDidUpdate() {
          ops.push('Foo updated');
        }
        /** `Foo.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          ops.push(`a: ${this.state.a}`);
          return null;
        }
      }

      /** `Bar`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Bar extends React.Component {
        /** `Bar.state`：记录测试夹具在当前场景中的状态。 */
        state = {b: false};
        /** `Bar.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
        componentDidUpdate() {
          ops.push('Bar updated');
          if (!this.state.b) {
            this.setState({b: true});
          }
        }
        /** `Bar.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「uses correct base state for setState inside render phase」描述的渲染、交互或错误处理结果。 */
  it('uses correct base state for setState inside render phase', () => {
    const ops = [];

    /** `Foo`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Foo extends React.Component {
      /** `Foo.state`：记录测试夹具在当前场景中的状态。 */
      state = {step: 0};
      /** `Foo.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「does not re-render if state update is null」描述的渲染、交互或错误处理结果。 */
  it('does not re-render if state update is null', () => {
    const container = document.createElement('div');

    let instance;
    let ops = [];
    /** `Foo`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Foo extends React.Component {
      /** `Foo.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // 这将随着我们默认使用异步而改变。
  // @gate !disableLegacyMode
  /** 测试场景：验证「synchronously renders hidden subtrees」描述的渲染、交互或错误处理结果。 */
  it('synchronously renders hidden subtrees', () => {
    const container = document.createElement('div');
    let ops = [];

    /** `Baz`：封装当前用例复用的操作、回调或断言步骤。 */
    function Baz() {
      ops.push('Baz');
      return null;
    }

    /** `Bar`：封装当前用例复用的操作、回调或断言步骤。 */
    function Bar() {
      ops.push('Bar');
      return null;
    }

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「can render ridiculously large number of roots without triggering infinite update loop error」描述的渲染、交互或错误处理结果。 */
  it('can render ridiculously large number of roots without triggering infinite update loop error', () => {
    /** `Foo`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Foo extends React.Component {
      /** `Foo.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        const limit = 1200;
        for (let i = 0; i < limit; i++) {
          if (i < limit - 1) {
            ReactDOM.render(<div />, document.createElement('div'));
          } else {
            ReactDOM.render(<div />, document.createElement('div'), () => {
              // 直到调用 setState 时，才会抛出“nested update limit”错误。
              this.setState({});
            });
          }
        }
      }
      /** `Foo.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    const container = document.createElement('div');
    ReactDOM.render(<Foo />, container);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「resets the update counter for unrelated updates」描述的渲染、交互或错误处理结果。 */
  it('resets the update counter for unrelated updates', async () => {
    const container = document.createElement('div');
    const ref = React.createRef();

    /** `EventuallyTerminating`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class EventuallyTerminating extends React.Component {
      /** `EventuallyTerminating.state`：记录测试夹具在当前场景中的状态。 */
      state = {step: 0};
      /** `EventuallyTerminating.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        this.setState({step: 1});
      }
      /** `EventuallyTerminating.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        if (this.state.step < limit) {
          this.setState({step: this.state.step + 1});
        }
      }
      /** `EventuallyTerminating.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

    // 确保我们不会超过限制，即使这些更新是无关的。
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「does not fall into an infinite update loop」描述的渲染、交互或错误处理结果。 */
  it('does not fall into an infinite update loop', async () => {
    /** `NonTerminating`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class NonTerminating extends React.Component {
      /** `NonTerminating.state`：记录测试夹具在当前场景中的状态。 */
      state = {step: 0};
      /** `NonTerminating.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        this.setState({step: 1});
      }
      /** `NonTerminating.UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        this.setState({step: 2});
      }
      /** `NonTerminating.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「does not fall into an infinite update loop with useLayoutEffect」描述的渲染、交互或错误处理结果。 */
  it('does not fall into an infinite update loop with useLayoutEffect', async () => {
    /** `NonTerminating`：封装当前用例复用的操作、回调或断言步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「can recover after falling into an infinite update loop」描述的渲染、交互或错误处理结果。 */
  it('can recover after falling into an infinite update loop', async () => {
    /** `NonTerminating`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class NonTerminating extends React.Component {
      /** `NonTerminating.state`：记录测试夹具在当前场景中的状态。 */
      state = {step: 0};
      /** `NonTerminating.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        this.setState({step: 1});
      }
      /** `NonTerminating.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        this.setState({step: 2});
      }
      /** `NonTerminating.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return this.state.step;
      }
    }

    /** `Terminating`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Terminating extends React.Component {
      /** `Terminating.state`：记录测试夹具在当前场景中的状态。 */
      state = {step: 0};
      /** `Terminating.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        this.setState({step: 1});
      }
      /** `Terminating.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「does not fall into mutually recursive infinite update loop with same container」描述的渲染、交互或错误处理结果。 */
  it('does not fall into mutually recursive infinite update loop with same container', async () => {
    // 注意： 如果有两个或多个不同的根,这个测试会失败.

    /** `A`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class A extends React.Component {
      /** `A.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        ReactDOM.render(<B />, container);
      }
      /** `A.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    /** `B`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class B extends React.Component {
      /** `B.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        ReactDOM.render(<A />, container);
      }
      /** `B.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「does not fall into an infinite error loop」描述的渲染、交互或错误处理结果。 */
  it('does not fall into an infinite error loop', async () => {
    /** `BadRender`：封装当前用例复用的操作、回调或断言步骤。 */
    function BadRender() {
      throw new Error('error');
    }

    /** `ErrorBoundary`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ErrorBoundary extends React.Component {
      /** `ErrorBoundary.componentDidCatch`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidCatch() {
        // 调度一次无操作 state 更新，避免测试在 DEV 中触发警告。
        this.setState({});

        this.props.parent.remount();
      }
      /** `ErrorBoundary.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <BadRender />;
      }
    }

    /** `NonTerminating`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class NonTerminating extends React.Component {
      /** `NonTerminating.state`：记录测试夹具在当前场景中的状态。 */
      state = {step: 0};
      /** `NonTerminating.remount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      remount() {
        this.setState(state => ({step: state.step + 1}));
      }
      /** `NonTerminating.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate !disableLegacyMode
  /** 测试场景：验证「can schedule ridiculously many updates within the same batch without triggering a maximum update error」描述的渲染、交互或错误处理结果。 */
  it('can schedule ridiculously many updates within the same batch without triggering a maximum update error', () => {
    const subscribers = [];

    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.state`：记录测试夹具在当前场景中的状态。 */
      state = {value: 'initial'};
      /** `Child.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        subscribers.push(this);
      }
      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    /** `App`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class App extends React.Component {
      /** `App.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
    // @gate !disableLegacyMode
    /** 测试场景：验证「can have nested updates if they do not cross the limit」描述的渲染、交互或错误处理结果。 */
    it('can have nested updates if they do not cross the limit', async () => {
      let _setStep;
      const LIMIT = 50;

      /** `Terminating`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate !disableLegacyMode
    /** 测试场景：验证「can have many updates inside useEffect without triggering a warning」描述的渲染、交互或错误处理结果。 */
    it('can have many updates inside useEffect without triggering a warning', async () => {
      /** `Terminating`：封装当前用例复用的操作、回调或断言步骤。 */
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
