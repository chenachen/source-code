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
let ReactDOMClient;
let act;
let Scheduler;
let waitForAll;
let waitFor;
let assertLog;
let assertConsoleErrorDev;

/** `normalizeCodeLocInfo`：封装当前用例复用的操作、回调或断言步骤。 */
function normalizeCodeLocInfo(str) {
  return (
    str &&
    str.replace(/^ +(?:at|in) ([\S]+)[^\n]*/gm, function (m, name) {
      const dot = name.lastIndexOf('.');
      if (dot !== -1) {
        name = name.slice(dot + 1);
      }
      return '    in ' + name + (/\d/.test(m) ? ' (at **)' : '');
    })
  );
}

describe('ReactUpdates', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    findDOMNode =
      ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
        .findDOMNode;
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
    Scheduler = require('scheduler');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    waitFor = InternalTestUtils.waitFor;
    assertLog = InternalTestUtils.assertLog;
  });

  // 注意：这基于 www 中使用的同类组件；额外的 div wrapper 不再必要后即可删除本组件。
  /** `LegacyHiddenDiv`：封装当前用例复用的操作、回调或断言步骤。 */
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
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should batch state when updating state twice」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should batch state when updating state twice', async () => {
    let componentState;
    let setState;

    /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
    function Component() {
      const [state, _setState] = React.useState(0);
      componentState = state;
      setState = _setState;
      React.useLayoutEffect(() => {
        Scheduler.log('Commit');
      });

      return <div>{state}</div>;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component />);
    });

    assertLog(['Commit']);
    expect(container.firstChild.textContent).toBe('0');

    await act(() => {
      setState(1);
      setState(2);
      expect(componentState).toBe(0);
      expect(container.firstChild.textContent).toBe('0');
      assertLog([]);
    });

    expect(componentState).toBe(2);
    assertLog(['Commit']);
    expect(container.firstChild.textContent).toBe('2');
  });

  /** 测试场景：验证「should batch state when updating two different states」描述的渲染、交互或错误处理结果。 */
  it('should batch state when updating two different states', async () => {
    let componentStateA;
    let componentStateB;
    let setStateA;
    let setStateB;

    /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
    function Component() {
      const [stateA, _setStateA] = React.useState(0);
      const [stateB, _setStateB] = React.useState(0);
      componentStateA = stateA;
      componentStateB = stateB;
      setStateA = _setStateA;
      setStateB = _setStateB;

      React.useLayoutEffect(() => {
        Scheduler.log('Commit');
      });

      return (
        <div>
          {stateA} {stateB}
        </div>
      );
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component />);
    });

    assertLog(['Commit']);
    expect(container.firstChild.textContent).toBe('0 0');

    await act(() => {
      setStateA(1);
      setStateB(2);
      expect(componentStateA).toBe(0);
      expect(componentStateB).toBe(0);
      expect(container.firstChild.textContent).toBe('0 0');
      assertLog([]);
    });

    expect(componentStateA).toBe(1);
    expect(componentStateB).toBe(2);
    assertLog(['Commit']);
    expect(container.firstChild.textContent).toBe('1 2');
  });

  /** 测试场景：验证「should batch state and props together」描述的渲染、交互或错误处理结果。 */
  it('should batch state and props together', async () => {
    let setState;
    let componentProp;
    let componentState;

    /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
    function Component({prop}) {
      const [state, _setState] = React.useState(0);
      componentProp = prop;
      componentState = state;
      setState = _setState;

      React.useLayoutEffect(() => {
        Scheduler.log('Commit');
      });

      return (
        <div>
          {prop} {state}
        </div>
      );
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component prop={0} />);
    });

    assertLog(['Commit']);
    expect(container.firstChild.textContent).toBe('0 0');

    await act(() => {
      root.render(<Component prop={1} />);
      setState(2);
      expect(componentProp).toBe(0);
      expect(componentState).toBe(0);
      expect(container.firstChild.textContent).toBe('0 0');
      assertLog([]);
    });

    expect(componentProp).toBe(1);
    expect(componentState).toBe(2);
    assertLog(['Commit']);
    expect(container.firstChild.textContent).toBe('1 2');
  });

  /** 测试场景：验证「should batch parent/child state updates together」描述的渲染、交互或错误处理结果。 */
  it('should batch parent/child state updates together', async () => {
    let childRef;
    let parentState;
    let childState;
    let setParentState;
    let setChildState;

    /** `Parent`：封装当前用例复用的操作、回调或断言步骤。 */
    function Parent() {
      const [state, _setState] = React.useState(0);
      parentState = state;
      setParentState = _setState;

      React.useLayoutEffect(() => {
        Scheduler.log('Parent Commit');
      });

      return (
        <div>
          <Child prop={state} />
        </div>
      );
    }

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({prop}) {
      const [state, _setState] = React.useState(0);
      childState = state;
      setChildState = _setState;

      React.useLayoutEffect(() => {
        Scheduler.log('Child Commit');
      });

      return (
        <div
          ref={ref => {
            childRef = ref;
          }}>
          {prop} {state}
        </div>
      );
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent />);
    });

    assertLog(['Child Commit', 'Parent Commit']);
    expect(childRef.textContent).toBe('0 0');

    await act(() => {
      // 先更新父组件。
      setParentState(1);
      setChildState(2);
      expect(parentState).toBe(0);
      expect(childState).toBe(0);
      expect(childRef.textContent).toBe('0 0');
      assertLog([]);
    });

    expect(parentState).toBe(1);
    expect(childState).toBe(2);
    expect(childRef.textContent).toBe('1 2');
    assertLog(['Child Commit', 'Parent Commit']);
  });

  /** 测试场景：验证「should batch child/parent state updates together」描述的渲染、交互或错误处理结果。 */
  it('should batch child/parent state updates together', async () => {
    let childRef;
    let parentState;
    let childState;
    let setParentState;
    let setChildState;

    /** `Parent`：封装当前用例复用的操作、回调或断言步骤。 */
    function Parent() {
      const [state, _setState] = React.useState(0);
      parentState = state;
      setParentState = _setState;

      React.useLayoutEffect(() => {
        Scheduler.log('Parent Commit');
      });

      return (
        <div>
          <Child prop={state} />
        </div>
      );
    }

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({prop}) {
      const [state, _setState] = React.useState(0);
      childState = state;
      setChildState = _setState;

      React.useLayoutEffect(() => {
        Scheduler.log('Child Commit');
      });

      return (
        <div
          ref={ref => {
            childRef = ref;
          }}>
          {prop} {state}
        </div>
      );
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent />);
    });

    assertLog(['Child Commit', 'Parent Commit']);
    expect(childRef.textContent).toBe('0 0');

    await act(() => {
      // 子组件先更新。
      setChildState(2);
      setParentState(1);
      expect(parentState).toBe(0);
      expect(childState).toBe(0);
      expect(childRef.textContent).toBe('0 0');
      assertLog([]);
    });

    expect(parentState).toBe(1);
    expect(childState).toBe(2);
    expect(childRef.textContent).toBe('1 2');
    assertLog(['Child Commit', 'Parent Commit']);
  });

  /** 测试场景：验证「should support chained state updates」描述的渲染、交互或错误处理结果。 */
  it('should support chained state updates', async () => {
    let instance;
    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.state`：记录测试夹具在当前场景中的状态。 */
      state = {x: 0};
      /** `Component.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        instance = this;
      }

      /** `Component.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        Scheduler.log('Update');
      }

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.state.x}</div>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component />);
    });

    expect(instance.state.x).toBe(0);
    expect(container.firstChild.textContent).toBe('0');

    let innerCallbackRun = false;
    await act(() => {
      instance.setState({x: 1}, function () {
        instance.setState({x: 2}, function () {
          innerCallbackRun = true;
          expect(instance.state.x).toBe(2);
          expect(container.firstChild.textContent).toBe('2');
          assertLog(['Update']);
        });
        expect(instance.state.x).toBe(1);
        expect(container.firstChild.textContent).toBe('1');
        assertLog(['Update']);
      });
      expect(instance.state.x).toBe(0);
      expect(container.firstChild.textContent).toBe('0');
      assertLog([]);
    });

    assertLog([]);
    expect(instance.state.x).toBe(2);
    expect(innerCallbackRun).toBeTruthy();
    expect(container.firstChild.textContent).toBe('2');
  });

  /** 测试场景：验证「should batch forceUpdate together」描述的渲染、交互或错误处理结果。 */
  it('should batch forceUpdate together', async () => {
    let instance;
    let shouldUpdateCount = 0;
    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.state`：记录测试夹具在当前场景中的状态。 */
      state = {x: 0};

      /** `Component.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        instance = this;
      }
      /** `Component.shouldComponentUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      shouldComponentUpdate() {
        shouldUpdateCount++;
      }

      /** `Component.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        Scheduler.log('Update');
      }

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.state.x}</div>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component />);
    });

    assertLog([]);
    expect(instance.state.x).toBe(0);

    await act(() => {
      instance.setState({x: 1}, function () {
        Scheduler.log('callback');
      });
      instance.forceUpdate(function () {
        Scheduler.log('forceUpdate');
      });
      assertLog([]);
      expect(instance.state.x).toBe(0);
      expect(container.firstChild.textContent).toBe('0');
    });

    // shouldComponentUpdate 不应被调用，因为我们强制执行了。
    expect(shouldUpdateCount).toBe(0);
    assertLog(['Update', 'callback', 'forceUpdate']);
    expect(instance.state.x).toBe(1);
    expect(container.firstChild.textContent).toBe('1');
  });

  /** 测试场景：验证「should update children even if parent blocks updates」描述的渲染、交互或错误处理结果。 */
  it('should update children even if parent blocks updates', async () => {
    let instance;
    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.childRef`：记录测试夹具在当前场景中的状态。 */
      childRef = React.createRef();

      /** `Parent.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        instance = this;
      }
      /** `Parent.shouldComponentUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      shouldComponentUpdate() {
        return false;
      }

      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        Scheduler.log('Parent render');
        return <Child ref={this.childRef} />;
      }
    }

    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        Scheduler.log('Child render');
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent />);
    });

    assertLog(['Parent render', 'Child render']);

    await act(() => {
      instance.setState({x: 1});
    });

    assertLog([]);

    await act(() => {
      instance.childRef.current.setState({x: 1});
    });

    assertLog(['Child render']);
  });

  /** 测试场景：验证「should not reconcile children passed via props」描述的渲染、交互或错误处理结果。 */
  it('should not reconcile children passed via props', async () => {
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
        Scheduler.log('Middle');
        return React.Children.only(this.props.children);
      }
    }

    /** `Bottom`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Bottom extends React.Component {
      /** `Bottom.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        Scheduler.log('Bottom');
        return null;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Top />);
    });

    assertLog(['Middle', 'Bottom', 'Middle']);
  });

  /** 测试场景：验证「should flow updates correctly」描述的渲染、交互或错误处理结果。 */
  it('should flow updates correctly', async () => {
    let willUpdates = [];
    let didUpdates = [];
    let instance;

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
      /** `App.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        instance = this;
      }
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
    await act(() => {
      ReactDOMClient.createRoot(container).render(<App />);
    });

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
    async function testUpdates(
      components,
      desiredWillUpdates,
      desiredDidUpdates,
    ) {
      let i;

      await act(() => {
        for (i = 0; i < components.length; i++) {
          triggerUpdate(components[i]);
        }
      });

      expectUpdates(desiredWillUpdates, desiredDidUpdates);

      // 尝试从后向前排列它们。

      await act(() => {
        for (i = components.length - 1; i >= 0; i--) {
          triggerUpdate(components[i]);
        }
      });

      expectUpdates(desiredWillUpdates, desiredDidUpdates);
    }
    await testUpdates(
      [
        instance.switcherRef.current.boxRef.current,
        instance.switcherRef.current,
      ],
      // 在 owner-child 关系中，will 与 did 生命周期的执行顺序相反。
      ['Switcher', 'Box'],
      ['Box', 'Switcher'],
    );

    await testUpdates(
      [instance.childRef.current, instance.switcherRef.current.boxRef.current],
      // 二者不是 owner-child 关系，因此分别进行 reconcile。
      ['Box', 'Child'],
      ['Box', 'Child'],
    );

    await testUpdates(
      [instance.childRef.current, instance.switcherRef.current],
      // Switcher 拥有 Box 与 Child；Box 不拥有 Child。
      ['Switcher', 'Box', 'Child'],
      ['Box', 'Switcher', 'Child'],
    );
  });

  /** 测试场景：验证「should queue mount-ready handlers across different roots」描述的渲染、交互或错误处理结果。 */
  it('should queue mount-ready handlers across different roots', async () => {
    // 定义 A、B 两个组件并同时更新；调用 A 的 componentDidUpdate 时，B 的 DOM 应已完成更新。

    const bContainer = document.createElement('div');
    let a;
    let b;

    let aUpdated = false;

    /** `A`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class A extends React.Component {
      /** `A.state`：记录测试夹具在当前场景中的状态。 */
      state = {x: 0};
      /** `A.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        a = this;
      }
      /** `A.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        expect(findDOMNode(b).textContent).toBe('B1');
        aUpdated = true;
      }

      /** `A.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        let portal = null;
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
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<A />);
    });

    await act(() => {
      a.setState({x: 1});
      b.setState({x: 1});
    });

    expect(aUpdated).toBe(true);
  });

  /** 测试场景：验证「should flush updates in the correct order」描述的渲染、交互或错误处理结果。 */
  it('should flush updates in the correct order', async () => {
    const updates = [];
    let instance;
    /** `Outer`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Outer extends React.Component {
      /** `Outer.state`：记录测试夹具在当前场景中的状态。 */
      state = {x: 0};
      /** `Outer.innerRef`：记录测试夹具在当前场景中的状态。 */
      innerRef = React.createRef();
      /** `Outer.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        instance = this;
      }
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
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Outer />);
    });

    await act(() => {
      updates.push('Outer-setState-1');
      instance.setState({x: 1}, function () {
        updates.push('Outer-callback-1');
        updates.push('Outer-setState-2');
        instance.setState({x: 2}, function () {
          updates.push('Outer-callback-2');
        });
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

  /** 测试场景：验证「should flush updates in the correct order across roots」描述的渲染、交互或错误处理结果。 */
  it('should flush updates in the correct order across roots', async () => {
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
          const root = ReactDOMClient.createRoot(findDOMNode(this));
          root.render(
            <MockComponent
              depth={this.props.depth + 1}
              count={this.props.count}
            />,
          );
        }
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<MockComponent depth={0} count={2} />);
    });

    expect(updates).toEqual([0, 1, 2]);

    await act(() => {
      // 从上到下依次模拟每个组件的更新。
      instances.forEach(function (instance) {
        instance.forceUpdate();
      });
    });

    expect(updates).toEqual([0, 1, 2, 0, 1, 2]);
  });

  /** 测试场景：验证「should queue nested updates」描述的渲染、交互或错误处理结果。 */
  it('should queue nested updates', async () => {
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
    let root = ReactDOMClient.createRoot(container);
    let x;
    await act(() => {
      root.render(<X ref={current => (x = current)} />);
    });

    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    let y;
    await act(() => {
      root.render(<Y ref={current => (y = current)} />);
    });

    expect(findDOMNode(x).textContent).toBe('0');

    await act(() => {
      y.forceUpdate();
    });
    expect(findDOMNode(x).textContent).toBe('1');
  });

  /** 测试场景：验证「should queue updates from during mount」描述的渲染、交互或错误处理结果。 */
  it('should queue updates from during mount', async () => {
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

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(
        <div>
          <A />
          <B />
        </div>,
      );
    });

    expect(container.firstChild.textContent).toBe('A1');
  });

  /** 测试场景：验证「calls componentWillReceiveProps setState callback properly」描述的渲染、交互或错误处理结果。 */
  it('calls componentWillReceiveProps setState callback properly', async () => {
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
          Scheduler.log('Callback');
        });
      }

      /** `A.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.state.x}</div>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<A x={1} />);
    });
    assertLog([]);

    // 必须放在单独的 act 中，否则会被批处理。
    await act(() => {
      root.render(<A x={2} />);
    });

    assertLog(['Callback']);
  });

  /** 测试场景：验证「does not call render after a component as been deleted」描述的渲染、交互或错误处理结果。 */
  it('does not call render after a component as been deleted', async () => {
    let componentA = null;
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
        Scheduler.log('B');
        return <div />;
      }
    }

    /** `A`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class A extends React.Component {
      /** `A.state`：记录测试夹具在当前场景中的状态。 */
      state = {showB: true};

      /** `A.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        componentA = this;
      }
      /** `A.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return this.state.showB ? <B /> : <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<A />);
    });
    assertLog(['B']);

    await act(() => {
      // B 将会安排一个更新，但批处理应该确保其更新永远不会触发。
      componentB.setState({updates: 1});
      componentA.setState({showB: false});
    });

    assertLog([]);
  });

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
    let root = ReactDOMClient.createRoot(container);
    let component;
    await act(() => {
      root.render(<A ref={current => (component = current)} />);
    });

    await expect(async () => {
      await act(() => {
        component.setState({}, 'no');
      });
    }).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: no',
    );
    assertConsoleErrorDev([
      'Expected the last optional `callback` argument to be ' +
        'a function. Instead received: no.',
    ]);
    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<A ref={current => (component = current)} />);
    });

    await expect(async () => {
      await act(() => {
        component.setState({}, {foo: 'bar'});
      });
    }).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: [object Object]',
    );
    assertConsoleErrorDev([
      'Expected the last optional `callback` argument to be ' +
        "a function. Instead received: { foo: 'bar' }.",
    ]);
    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<A ref={current => (component = current)} />);
    });

    await expect(
      act(() => {
        component.setState({}, new Foo());
      }),
    ).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: [object Object]',
    );
  });

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
    let root = ReactDOMClient.createRoot(container);
    let component;
    await act(() => {
      root.render(<A ref={current => (component = current)} />);
    });

    await expect(async () => {
      await act(() => {
        component.forceUpdate('no');
      });
    }).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: no',
    );
    assertConsoleErrorDev([
      'Expected the last optional `callback` argument to be ' +
        'a function. Instead received: no.',
    ]);
    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<A ref={current => (component = current)} />);
    });

    await expect(async () => {
      await act(() => {
        component.forceUpdate({foo: 'bar'});
      });
    }).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: [object Object]',
    );
    assertConsoleErrorDev([
      'Expected the last optional `callback` argument to be ' +
        "a function. Instead received: { foo: 'bar' }.",
    ]);
    // 确保警告被去重，并且不再重复触发
    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<A ref={current => (component = current)} />);
    });

    await expect(
      act(() => {
        component.forceUpdate(new Foo());
      }),
    ).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: [object Object]',
    );
  });

  /** 测试场景：验证「does not update one component twice in a batch (#2410)」描述的渲染、交互或错误处理结果。 */
  it('does not update one component twice in a batch (#2410)', async () => {
    let parent;
    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.childRef`：记录测试夹具在当前场景中的状态。 */
      childRef = React.createRef();

      /** `Parent.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        parent = this;
      }
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
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent />);
    });

    const child = parent.getChild();
    await act(() => {
      parent.forceUpdate();
      child.forceUpdate();
    });

    expect.assertions(6);
  });

  /** 测试场景：验证「does not update one component twice in a batch (#6371)」描述的渲染、交互或错误处理结果。 */
  it('does not update one component twice in a batch (#6371)', async () => {
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

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<App />);
    });

    // 不应抛出错误。
    expect(true).toBe(true);
  });

  /** 测试场景：验证「handles reentrant mounting in synchronous mode」描述的渲染、交互或错误处理结果。 */
  it('handles reentrant mounting in synchronous mode', async () => {
    let onChangeCalled = false;
    /** `Editor`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Editor extends React.Component {
      /** `Editor.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.props.text}</div>;
      }
      /** `Editor.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        Scheduler.log('Mount');
        // 这里只应调用一次，但仍加上保护以防万一。
        if (!this.props.rendered) {
          this.props.onChange({rendered: true});
        }
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    /** `render`：封装当前用例复用的操作、回调或断言步骤。 */
    function render() {
      root.render(
        <Editor
          onChange={newProps => {
            onChangeCalled = true;
            props = {...props, ...newProps};
            render();
          }}
          {...props}
        />,
      );
    }

    let props = {text: 'hello', rendered: false};
    await act(() => {
      render();
    });
    assertLog(['Mount']);
    props = {...props, text: 'goodbye'};
    await act(() => {
      render();
    });

    assertLog([]);
    expect(container.textContent).toBe('goodbye');
    expect(onChangeCalled).toBeTruthy();
  });

  /** 测试场景：验证「mounts and unmounts are batched」描述的渲染、交互或错误处理结果。 */
  it('mounts and unmounts are batched', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<div>Hello</div>);
      expect(container.textContent).toBe('');
      root.unmount(container);
      expect(container.textContent).toBe('');
    });

    expect(container.textContent).toBe('');
  });

  /** 测试场景：验证「uses correct base state for setState inside render phase」描述的渲染、交互或错误处理结果。 */
  it('uses correct base state for setState inside render phase', async () => {
    /** `Foo`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Foo extends React.Component {
      /** `Foo.state`：记录测试夹具在当前场景中的状态。 */
      state = {step: 0};
      /** `Foo.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        const memoizedStep = this.state.step;
        this.setState(baseState => {
          const baseStep = baseState.step;
          Scheduler.log(`base: ${baseStep}, memoized: ${memoizedStep}`);
          return baseStep === 0 ? {step: 1} : null;
        });
        return null;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Foo />);
    });
    assertConsoleErrorDev([
      'Cannot update during an existing state transition (such as within `render`). ' +
        'Render methods should be a pure function of props and state.\n' +
        '    in Foo (at **)',
    ]);

    assertLog(['base: 0, memoized: 0', 'base: 1, memoized: 1']);
  });

  /** 测试场景：验证「does not re-render if state update is null」描述的渲染、交互或错误处理结果。 */
  it('does not re-render if state update is null', async () => {
    const container = document.createElement('div');

    let instance;
    /** `Foo`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Foo extends React.Component {
      /** `Foo.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        instance = this;
        Scheduler.log('render');
        return <div />;
      }
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Foo />);
    });

    assertLog(['render']);
    await act(() => {
      instance.setState(() => null);
    });
    assertLog([]);
  });

  /** 测试场景：验证「synchronously renders hidden subtrees」描述的渲染、交互或错误处理结果。 */
  it('synchronously renders hidden subtrees', async () => {
    const container = document.createElement('div');

    /** `Baz`：封装当前用例复用的操作、回调或断言步骤。 */
    function Baz() {
      Scheduler.log('Baz');
      return null;
    }

    /** `Bar`：封装当前用例复用的操作、回调或断言步骤。 */
    function Bar() {
      Scheduler.log('Bar');
      return null;
    }

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      Scheduler.log('Foo');
      return (
        <div>
          <div hidden={true}>
            <Bar />
          </div>
          <Baz />
        </div>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      // 挂载。
      root.render(<Foo />);
    });
    assertLog(['Foo', 'Bar', 'Baz']);

    await act(() => {
      // 更新。
      root.render(<Foo />);
    });
    assertLog(['Foo', 'Bar', 'Baz']);
  });

  // @gate www
  /** 测试场景：验证「delays sync updates inside hidden subtrees in Concurrent Mode」描述的渲染、交互或错误处理结果。 */
  it('delays sync updates inside hidden subtrees in Concurrent Mode', async () => {
    const container = document.createElement('div');

    /** `Baz`：封装当前用例复用的操作、回调或断言步骤。 */
    function Baz() {
      Scheduler.log('Baz');
      return <p>baz</p>;
    }

    let setCounter;
    /** `Bar`：封装当前用例复用的操作、回调或断言步骤。 */
    function Bar() {
      const [counter, _setCounter] = React.useState(0);
      setCounter = _setCounter;
      Scheduler.log('Bar');
      return <p>bar {counter}</p>;
    }

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      Scheduler.log('Foo');
      React.useEffect(() => {
        Scheduler.log('Foo#effect');
      });
      return (
        <div>
          <LegacyHiddenDiv mode="hidden">
            <Bar />
          </LegacyHiddenDiv>
          <Baz />
        </div>
      );
    }

    const root = ReactDOMClient.createRoot(container);
    let hiddenDiv;
    await act(async () => {
      root.render(<Foo />);
      await waitFor(['Foo', 'Baz', 'Foo#effect']);
      hiddenDiv = container.firstChild.firstChild;
      expect(hiddenDiv.hidden).toBe(true);
      expect(hiddenDiv.innerHTML).toBe('');
      // 运行 Offscreen 更新。
      await waitForAll(['Bar']);
      expect(hiddenDiv.hidden).toBe(true);
      expect(hiddenDiv.innerHTML).toBe('<p>bar 0</p>');
    });

    ReactDOM.flushSync(() => {
      setCounter(1);
    });
    // 此时不应冲刷。
    expect(hiddenDiv.innerHTML).toBe('<p>bar 0</p>');

    // 运行 Offscreen 更新。
    await waitForAll(['Bar']);
    expect(hiddenDiv.innerHTML).toBe('<p>bar 1</p>');
  });

  /** 测试场景：验证「can render ridiculously large number of roots without triggering infinite update loop error」描述的渲染、交互或错误处理结果。 */
  it('can render ridiculously large number of roots without triggering infinite update loop error', async () => {
    /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
    function Component({trigger}) {
      const [state, setState] = React.useState(0);

      React.useEffect(() => {
        if (trigger) {
          Scheduler.log('Trigger');
          setState(c => c + 1);
        }
      }, [trigger]);

      return <div>{state}</div>;
    }

    /** `Foo`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Foo extends React.Component {
      /** `Foo.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        const limit = 1200;
        for (let i = 0; i < limit; i++) {
          if (i < limit - 1) {
            ReactDOMClient.createRoot(document.createElement('div')).render(
              <Component />,
            );
          } else {
            // 直到调用 setState 时，才会抛出“nested update limit”错误。
            ReactDOMClient.createRoot(document.createElement('div')).render(
              <Component trigger={true} />,
            );
          }
        }
      }
      /** `Foo.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Foo />);
    });

    // 确保触发 setState 的路径确实执行。
    assertLog(['Trigger']);
  });

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
    const root = ReactDOMClient.createRoot(container);
    await expect(async () => {
      await act(() => {
        root.render(<EventuallyTerminating ref={ref} />);
      });
    }).rejects.toThrow('Maximum');

    // 确保我们不会超过限制，即使这些更新是无关的。
    limit -= 10;
    await act(() => {
      root.render(<EventuallyTerminating ref={ref} />);
    });
    expect(container.textContent).toBe(limit.toString());

    await act(() => {
      ref.current.setState({step: 0});
    });
    expect(container.textContent).toBe(limit.toString());

    await act(() => {
      ref.current.setState({step: 0});
    });
    expect(container.textContent).toBe(limit.toString());

    limit += 10;
    await expect(async () => {
      await act(() => {
        ref.current.setState({step: 0});
      });
    }).rejects.toThrow('Maximum');
    expect(ref.current).toBe(null);
  });

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

      /** `NonTerminating.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
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
    const root = ReactDOMClient.createRoot(container);

    await expect(async () => {
      await act(() => {
        root.render(<NonTerminating />);
      });
    }).rejects.toThrow('Maximum');
  });

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
    const root = ReactDOMClient.createRoot(container);
    await expect(async () => {
      await act(() => {
        root.render(<NonTerminating />);
      });
    }).rejects.toThrow('Maximum');
  });

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
    const root = ReactDOMClient.createRoot(container);
    await expect(async () => {
      await act(() => {
        root.render(<NonTerminating />);
      });
    }).rejects.toThrow('Maximum');

    await act(() => {
      root.render(<Terminating />);
    });
    expect(container.textContent).toBe('1');

    await expect(async () => {
      await act(() => {
        root.render(<NonTerminating />);
      });
    }).rejects.toThrow('Maximum');
    await act(() => {
      root.render(<Terminating />);
    });
    expect(container.textContent).toBe('1');
  });

  /** 测试场景：验证「does not fall into mutually recursive infinite update loop with same container」描述的渲染、交互或错误处理结果。 */
  it('does not fall into mutually recursive infinite update loop with same container', async () => {
    // 注意： 如果有两个或多个不同的根,这个测试会失败.
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    /** `A`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class A extends React.Component {
      /** `A.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        root.render(<B />);
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
        root.render(<A />);
      }
      /** `B.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    await expect(async () => {
      await act(() => {
        root.render(<A />);
      });
    }).rejects.toThrow('Maximum');
  });

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
    const root = ReactDOMClient.createRoot(container);
    await expect(async () => {
      await act(() => {
        root.render(<NonTerminating />);
      });
    }).rejects.toThrow('Maximum');
  });

  /** 测试场景：验证「can schedule ridiculously many updates within the same batch without triggering a maximum update error」描述的渲染、交互或错误处理结果。 */
  it('can schedule ridiculously many updates within the same batch without triggering a maximum update error', async () => {
    const subscribers = [];
    const limit = 1200;
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
        for (let i = 0; i < limit; i++) {
          children.push(<Child key={i} />);
        }
        return children;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App />);
    });

    await act(() => {
      subscribers.forEach(s => {
        s.setState({value: 'update'});
      });
    });

    expect(subscribers.length).toBe(limit);
  });

  /** 测试场景：验证「warns about potential infinite loop if there's a synchronous render phase update on another component」描述的渲染、交互或错误处理结果。 */
  it("warns about potential infinite loop if there's a synchronous render phase update on another component", async () => {
    if (
      !__DEV__ ||
      gate(
        flags =>
          !flags.enableInfiniteRenderLoopDetection ||
          flags.enableInfiniteRenderLoopDetectionForceThrow,
      )
    ) {
      return;
    }
    let setState;
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [, _setState] = React.useState(0);
      setState = _setState;
      return <Child />;
    }

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child(step) {
      // 这将导致无限更新循环，并在开发时引发警告。
      setState(n => n + 1);
      return null;
    }

    const originalConsoleError = console.error;
    console.error = e => {
      if (
        typeof e === 'string' &&
        e.startsWith(
          'Maximum update depth exceeded. This could be an infinite loop.',
        )
      ) {
        Scheduler.log('stop');
      }
    };
    try {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      root.render(<App />);
      await waitFor(['stop']);
    } finally {
      console.error = originalConsoleError;
    }
  });

  /** 测试场景：验证「warns about potential infinite loop if there's an async render phase update on another component」描述的渲染、交互或错误处理结果。 */
  it("warns about potential infinite loop if there's an async render phase update on another component", async () => {
    if (
      !__DEV__ ||
      gate(
        flags =>
          !flags.enableInfiniteRenderLoopDetection ||
          flags.enableInfiniteRenderLoopDetectionForceThrow,
      )
    ) {
      return;
    }
    let setState;
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [, _setState] = React.useState(0);
      setState = _setState;
      return <Child />;
    }

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child(step) {
      // 这将导致无限更新循环，并在开发时引发警告。
      setState(n => n + 1);
      return null;
    }

    const originalConsoleError = console.error;
    console.error = e => {
      if (
        typeof e === 'string' &&
        e.startsWith(
          'Maximum update depth exceeded. This could be an infinite loop.',
        )
      ) {
        Scheduler.log('stop');
      }
    };
    try {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      React.startTransition(() => root.render(<App />));
      await waitFor(['stop']);
    } finally {
      console.error = originalConsoleError;
    }
  });

  // TODO：用 @gate pragma 替换此分支。
  if (__DEV__) {
    /** 测试场景：验证「warns about a deferred infinite update loop with useEffect」描述的渲染、交互或错误处理结果。 */
    it('warns about a deferred infinite update loop with useEffect', async () => {
      /** `NonTerminating`：封装当前用例复用的操作、回调或断言步骤。 */
      function NonTerminating() {
        const [step, setStep] = React.useState(0);
        React.useEffect(function myEffect() {
          setStep(x => x + 1);
        });
        return step;
      }

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App() {
        return <NonTerminating />;
      }

      let error = null;
      let ownerStack = null;
      let debugStack = null;
      const originalConsoleError = console.error;
      console.error = e => {
        error = e;
        ownerStack = React.captureOwnerStack();
        debugStack = new Error().stack;
        Scheduler.log('stop');
      };
      try {
        const container = document.createElement('div');
        const root = ReactDOMClient.createRoot(container);
        root.render(<App />);
        await waitFor(['stop']);
      } finally {
        console.error = originalConsoleError;
      }

      expect(error).toContain('Maximum update depth exceeded');
      // 当前正在执行的 effect 应位于原生调用栈中。
      expect(debugStack).toContain('at myEffect');
      expect(ownerStack).toContain('at App');
    });

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
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Terminating />);
      });

      assertLog(Array.from({length: LIMIT + 1}, (_, k) => k));
      expect(container.textContent).toBe('50');
      await act(() => {
        _setStep(0);
      });
      expect(container.textContent).toBe('50');
    });

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
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Terminating />);
      });

      assertLog(['Done']);
      expect(container.textContent).toBe('1000');
    });
  }

  /** 测试场景：验证「prevents infinite update loop triggered by synchronous updates in useEffect」描述的渲染、交互或错误处理结果。 */
  it('prevents infinite update loop triggered by synchronous updates in useEffect', async () => {
    // 忽略 flushSync 警告。
    spyOnDev(console, 'error').mockImplementation(() => {});

    /** `NonTerminating`：封装当前用例复用的操作、回调或断言步骤。 */
    function NonTerminating() {
      const [step, setStep] = React.useState(0);
      React.useEffect(() => {
        // useEffect 中其他同步更新示例还包括 `el.focus` 这类命令式事件派发，以及 useSyncExternalStore；
        // 后者若发现 store 自初始渲染后已变更，可能在订阅时调度同步更新。
        // 本测试最初使用 `el.focus`，但错误会在 JSDOM 事件中派发，无法可靠捕获以免测试失败。
        ReactDOM.flushSync(() => {
          setStep(step + 1);
        });
      }, [step]);
      return step;
    }

    const container = document.createElement('div');
    const errors = [];
    const root = ReactDOMClient.createRoot(container, {
      /** `onUncaughtError`：封装当前用例复用的操作、回调或断言步骤。 */
      onUncaughtError: (error, errorInfo) => {
        errors.push(
          `${error.message}${normalizeCodeLocInfo(errorInfo.componentStack)}`,
        );
      },
    });
    await act(() => {
      ReactDOM.flushSync(() => {
        root.render(<NonTerminating />);
      });
    });

    expect(errors).toEqual([
      'Maximum update depth exceeded. ' +
        'This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate. ' +
        'React limits the number of nested updates to prevent infinite loops.' +
        '\n    in NonTerminating (at **)',
    ]);
  });

  /** 测试场景：验证「warns instead of throwing when infinite Suspense ping loop is detected via enableInfiniteRenderLoopDetection during commit phase」描述的渲染、交互或错误处理结果。 */
  it('warns instead of throwing when infinite Suspense ping loop is detected via enableInfiniteRenderLoopDetection during commit phase', async () => {
    if (
      !__DEV__ ||
      gate(
        flags =>
          !flags.enableInfiniteRenderLoopDetection ||
          flags.enableInfiniteRenderLoopDetectionForceThrow,
      )
    ) {
      return;
    }

    // 当 Suspense 子节点抛出 thenable 时，React 注册两条监听路径：1）渲染阶段 attachPingListener
    // 的 ping，经 pingSuspendedRoot 到 markRootPinged；2）提交阶段 attachSuspenseRetryListeners 的
    // retry，到 resolveRetryWakeable。ping 路径会由 markRootPinged 调用
    // throwIfInfiniteUpdateLoopDetected(true)，此前没有 getRootForUpdatedFiber(false) 检查。当它在
    // CommitContext 而非 RenderContext 中触发时，
    // isFromInfiniteRenderLoopDetectionInstrumentation=true 保证只警告而不抛错。若仍传 false，条件
    // 在 CommitContext 中会计算为 false 并错误地抛出。
    let currentResolve = null;
    let shouldStop = false;

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [, setState] = React.useState(0);

      React.useLayoutEffect(() => {
        if (shouldStop) {
          return;
        }
        // 在提交阶段（CommitContext）兑现挂起的 thenable。渲染期间先注册的 ping 回调会先触发，进而调用 markRootPinged → throwIfInfiniteUpdateLoopDetected(true)。
        if (currentResolve !== null) {
          const resolve = currentResolve;
          currentResolve = null;
          resolve();
        }
        // 调度同步更新，确保 commitRootImpl 收尾阶段的 nestedUpdateKind 为 NESTED_UPDATE_SYNC_LANE。
        setState(n => n + 1);
      });

      return (
        <React.Suspense fallback="loading">
          <SuspendingChild />
        </React.Suspense>
      );
    }

    /** `SuspendingChild`：封装当前用例复用的操作、回调或断言步骤。 */
    function SuspendingChild() {
      if (shouldStop) {
        return null;
      }
      // 每次渲染都会抛出新的 thenable。React 会调用两次 then()：渲染期间触发 ping，
      // 提交期间触发重试。这里收集所有回调，让 resolve() 按注册顺序执行，因而 ping 最先触发。
      const callbacks = [];
      const thenable = {
        /** `SuspendingChild.then`：实现测试夹具的生命周期、渲染或交互步骤。 */
        then(onFulfilled) {
          callbacks.push(onFulfilled);
          currentResolve = () => {
            for (let i = 0; i < callbacks.length; i++) {
              callbacks[i]();
            }
          };
        },
      };

      throw thenable;
    }

    const container = document.createElement('div');
    const errors = [];
    const root = ReactDOMClient.createRoot(container, {
      /** `onUncaughtError`：封装当前用例复用的操作、回调或断言步骤。 */
      onUncaughtError: error => {
        errors.push(error.message);
      },
    });

    const originalConsoleError = console.error;
    console.error = e => {
      if (
        typeof e === 'string' &&
        e.startsWith(
          'Maximum update depth exceeded. This could be an infinite loop.',
        )
      ) {
        // 首次警告后停止循环，让 act() 能够结束。
        shouldStop = true;
      }
    };

    try {
      await act(() => {
        root.render(<App />);
      });
    } finally {
      console.error = originalConsoleError;
    }

    // 修复后，markRootPinged 中的 throwIfInfiniteUpdateLoopDetected(true) 会通过 enableInfiniteRenderLoopDetection 插桩发现循环并产生警告。未修复而传入 false 时，同一检查会因 executionContext 是 CommitContext 而不是 RenderContext 直接抛错。
    expect(shouldStop).toBe(true);
    expect(errors).toEqual([]);
  });

  // @gate enableInfiniteRenderLoopDetection && enableInfiniteRenderLoopDetectionForceThrow
  /** 测试场景：验证「throws when sync render-phase update loop is detected with force-throw enabled」描述的渲染、交互或错误处理结果。 */
  it('throws when sync render-phase update loop is detected with force-throw enabled', async () => {
    // 在另一个组件的钩子上进行渲染阶段的setState会产生同步递归更新。 启用 ForceThrow 时，应该通过
    // throwForcedInfiniteRenderLoopError 来抛出错误，而不是仅在 DEV 模式下发出警告。
    let setState;
    let shouldStop = false;
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [, _setState] = React.useState(0);
      setState = _setState;
      return <Child />;
    }

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      if (shouldStop) {
        return null;
      }
      setState(n => n + 1);
      return null;
    }

    const container = document.createElement('div');
    const errors = [];
    /** `captureError`：封装当前用例复用的操作、回调或断言步骤。 */
    const captureError = error => {
      errors.push(error.message);
      // 停止调度新更新，让测试以及 gate 关闭、legacy 错误路径可恢复的变体都能正常结束，
      // 且不会触发 Babel 无限循环保护器。
      shouldStop = true;
    };
    const root = ReactDOMClient.createRoot(container, {
      onUncaughtError: captureError,
      onRecoverableError: captureError,
      onCaughtError: captureError,
    });

    // 渲染阶段在另一组件上调用 setState，还会在每次递归时产生仅 DEV 环境出现的“Cannot update a component while rendering a different component” console.error。这里吞掉这些错误，避免测试框架要求逐条断言。
    const originalConsoleError = console.error;
    console.error = msg => {
      if (
        typeof msg === 'string' &&
        msg.startsWith('Cannot update a component')
      ) {
        return;
      }
      originalConsoleError(msg);
    };
    try {
      await act(() => {
        root.render(<App />);
      });
    } finally {
      console.error = originalConsoleError;
    }

    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]).toContain(
      'Maximum update depth exceeded. This could be an infinite loop.',
    );
  });

  // @gate enableInfiniteRenderLoopDetection && enableInfiniteRenderLoopDetectionForceThrow
  /** 测试场景：验证「throws when phase-spawn update loop is detected with force-throw enabled」描述的渲染、交互或错误处理结果。 */
  it('throws when phase-spawn update loop is detected with force-throw enabled', async () => {
    // 把初始渲染包在 startTransition 中，会让渲染阶段的 setState 继承非同步 transition lane。
    // 提交后下一次渲染仍非同步，因此循环检测器会把递归归类为 NESTED_UPDATE_PHASE_SPAWN，而非
    // SYNC_LANE。启用 ForceThrow 后，此分支应通过 throwForcedInfiniteRenderLoopError 抛错，
    // 而不是只在 DEV 中警告。
    let setState;
    let shouldStop = false;
    // 硬性限制 Child 的渲染次数。未启用无限渲染循环检测时，PHASE_SPAWN 分支完全关闭，不会抛错，
    // 循环会一直执行到 Babel 的无限循环保护器介入。
    let renderCount = 0;
    const RENDER_CAP = 100;
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [, _setState] = React.useState(0);
      setState = _setState;
      return <Child />;
    }

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      if (shouldStop || renderCount >= RENDER_CAP) {
        return null;
      }
      renderCount++;
      setState(n => n + 1);
      return null;
    }

    const container = document.createElement('div');
    const errors = [];
    const root = ReactDOMClient.createRoot(container, {
      /** `onUncaughtError`：封装当前用例复用的操作、回调或断言步骤。 */
      onUncaughtError: error => {
        errors.push(error.message);
        shouldStop = true;
      },
    });

    const originalConsoleError = console.error;
    console.error = msg => {
      if (
        typeof msg === 'string' &&
        msg.startsWith('Cannot update a component')
      ) {
        return;
      }
      originalConsoleError(msg);
    };
    try {
      await act(() => {
        React.startTransition(() => root.render(<App />));
      });
    } finally {
      console.error = originalConsoleError;
    }

    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]).toContain(
      'Maximum update depth exceeded. This could be an infinite loop.',
    );
  });

  /** 测试场景：验证「prevents infinite update loop triggered by too many updates in ref callbacks」描述的渲染、交互或错误处理结果。 */
  it('prevents infinite update loop triggered by too many updates in ref callbacks', async () => {
    let scheduleUpdate;
    /** `TooManyRefUpdates`：封装当前用例复用的操作、回调或断言步骤。 */
    function TooManyRefUpdates() {
      const [count, _scheduleUpdate] = React.useReducer(c => c + 1, 0);
      scheduleUpdate = _scheduleUpdate;

      return (
        <div
          ref={() => {
            for (let i = 0; i < 50; i++) {
              scheduleUpdate(1);
            }
          }}>
          {count}
        </div>
      );
    }

    const container = document.createElement('div');
    const errors = [];
    const root = ReactDOMClient.createRoot(container, {
      /** `onUncaughtError`：封装当前用例复用的操作、回调或断言步骤。 */
      onUncaughtError: (error, errorInfo) => {
        errors.push(
          `${error.message}${normalizeCodeLocInfo(errorInfo.componentStack)}`,
        );
      },
    });
    await act(() => {
      root.render(<TooManyRefUpdates />);
    });

    expect(errors).toEqual([
      'Maximum update depth exceeded. ' +
        'This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate. ' +
        'React limits the number of nested updates to prevent infinite loops.' +
        '\n    in div' +
        '\n    in TooManyRefUpdates (at **)',
    ]);
  });
});
