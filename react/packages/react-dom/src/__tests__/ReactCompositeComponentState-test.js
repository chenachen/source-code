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
let ReactDOMClient;
let act;
let Scheduler;
let assertLog;
let TestComponent;
let testComponentInstance;
let assertConsoleErrorDev;

describe('ReactCompositeComponent-state', () => {
  beforeEach(() => {
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));
    Scheduler = require('scheduler');

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;

    /** `LogAfterCommit`：封装当前用例复用的操作、回调或断言步骤。 */
    function LogAfterCommit({children, color}) {
      React.useEffect(() => {
        Scheduler.log(`commit ${color}`);
      });
      return children;
    }

    TestComponent = class extends React.Component {
      /** `constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        this.peekAtState('getInitialState', undefined, props);
        this.state = {color: 'red'};
        testComponentInstance = this;
      }

      /** `peekAtState`：封装当前用例复用的操作、回调或断言步骤。 */
      peekAtState = (from, state = this.state, props = this.props) => {
        Scheduler.log(`${from} ${state && state.color}`);
      };

      /** `peekAtCallback`：封装当前用例复用的操作、回调或断言步骤。 */
      peekAtCallback = from => {
        return () => this.peekAtState(from);
      };

      /** `setFavoriteColor`：实现测试夹具的生命周期、渲染或交互步骤。 */
      setFavoriteColor(nextColor) {
        this.setState(
          {color: nextColor},
          this.peekAtCallback('setFavoriteColor'),
        );
      }

      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        this.peekAtState('render');
        return (
          <LogAfterCommit color={this.state.color}>
            <div>{this.state.color}</div>
          </LogAfterCommit>
        );
      }

      /** `UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        this.peekAtState('componentWillMount-start');
        this.setState(function (state) {
          this.peekAtState('before-setState-sunrise', state);
        });
        this.setState(
          {color: 'sunrise'},
          this.peekAtCallback('setState-sunrise'),
        );
        this.setState(function (state) {
          this.peekAtState('after-setState-sunrise', state);
        });
        this.peekAtState('componentWillMount-after-sunrise');
        this.setState(
          {color: 'orange'},
          this.peekAtCallback('setState-orange'),
        );
        this.setState(function (state) {
          this.peekAtState('after-setState-orange', state);
        });
        this.peekAtState('componentWillMount-end');
      }

      /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        this.peekAtState('componentDidMount-start');
        this.setState(
          {color: 'yellow'},
          this.peekAtCallback('setState-yellow'),
        );
        this.peekAtState('componentDidMount-end');
      }

      /** `UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps(newProps) {
        this.peekAtState('componentWillReceiveProps-start');
        if (newProps.nextColor) {
          this.setState(function (state) {
            this.peekAtState('before-setState-receiveProps', state);
            return {color: newProps.nextColor};
          });
          // 不再是一个公开的 API。 但我们可以通过进入更新器来检测它是否内部工作.
          this.updater.enqueueReplaceState(this, {color: undefined});
          this.setState(function (state) {
            this.peekAtState('before-setState-again-receiveProps', state);
            return {color: newProps.nextColor};
          }, this.peekAtCallback('setState-receiveProps'));
          this.setState(function (state) {
            this.peekAtState('after-setState-receiveProps', state);
          });
        }
        this.peekAtState('componentWillReceiveProps-end');
      }

      /** `shouldComponentUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      shouldComponentUpdate(nextProps, nextState) {
        this.peekAtState('shouldComponentUpdate-currentState');
        this.peekAtState('shouldComponentUpdate-nextState', nextState);
        return true;
      }

      /** `UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate(nextProps, nextState) {
        this.peekAtState('componentWillUpdate-currentState');
        this.peekAtState('componentWillUpdate-nextState', nextState);
      }

      /** `componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate(prevProps, prevState) {
        this.peekAtState('componentDidUpdate-currentState');
        this.peekAtState('componentDidUpdate-prevState', prevState);
      }

      /** `componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        this.peekAtState('componentWillUnmount');
      }
    };
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should support setting state」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should support setting state', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<TestComponent />);
    });

    assertLog([
      // 当 getInitialState() 被调用时，没有状态。
      'getInitialState undefined',
      'componentWillMount-start red',
      // setState() 只会把待处理状态入队。
      'componentWillMount-after-sunrise red',
      'componentWillMount-end red',
      // 待定状态排队处理
      'before-setState-sunrise red',
      'after-setState-sunrise sunrise',
      'after-setState-orange orange',
      // 待处理状态已应用。
      'render orange',
      'componentDidMount-start orange',
      // setState-sunrise 与 setState-orange 应在这里触发；这是修复 #1740 后的顺序。
      // componentDidMount() 调用的 setState({color: 'yellow'}) 是异步更新，要到下一次冲刷才会生效。
      'componentDidMount-end orange',
      'setState-sunrise orange',
      'setState-orange orange',
      'commit orange',
      'shouldComponentUpdate-currentState orange',
      'shouldComponentUpdate-nextState yellow',
      'componentWillUpdate-currentState orange',
      'componentWillUpdate-nextState yellow',
      'render yellow',
      'componentDidUpdate-currentState yellow',
      'componentDidUpdate-prevState orange',
      'setState-yellow yellow',
      'commit yellow',
    ]);

    await act(() => {
      root.render(<TestComponent nextColor="green" />);
    });

    assertLog([
      'componentWillReceiveProps-start yellow',
      // setState({color:'green'}) 只会把待处理状态入队。
      'componentWillReceiveProps-end yellow',
      // 待定状态排队处理 我们将更新在排队中支持 replaceState(prevState => newState).
      'before-setState-receiveProps yellow',
      'before-setState-again-receiveProps undefined',
      'after-setState-receiveProps green',
      'shouldComponentUpdate-currentState yellow',
      'shouldComponentUpdate-nextState green',
      'componentWillUpdate-currentState yellow',
      'componentWillUpdate-nextState green',
      'render green',
      'componentDidUpdate-currentState green',
      'componentDidUpdate-prevState yellow',
      'setState-receiveProps green',
      'commit green',
    ]);

    await act(() => {
      testComponentInstance.setFavoriteColor('blue');
    });

    assertLog([
      // setFavoriteColor('blue')
      'shouldComponentUpdate-currentState green',
      'shouldComponentUpdate-nextState blue',
      'componentWillUpdate-currentState green',
      'componentWillUpdate-nextState blue',
      'render blue',
      'componentDidUpdate-currentState blue',
      'componentDidUpdate-prevState green',
      'setFavoriteColor blue',
      'commit blue',
    ]);
    await act(() => {
      testComponentInstance.forceUpdate(
        testComponentInstance.peekAtCallback('forceUpdate'),
      );
    });
    assertLog([
      // forceUpdate()
      'componentWillUpdate-currentState blue',
      'componentWillUpdate-nextState blue',
      'render blue',
      'componentDidUpdate-currentState blue',
      'componentDidUpdate-prevState blue',
      'forceUpdate blue',
      'commit blue',
    ]);

    root.unmount();

    assertLog([
      // unmount()
      // `componentWillUnmount()` 内仍可读取 state。
      'componentWillUnmount blue',
    ]);
  });

  /** 测试场景：验证「should call componentDidUpdate of children first」描述的渲染、交互或错误处理结果。 */
  it('should call componentDidUpdate of children first', async () => {
    const container = document.createElement('div');

    let child = null;
    let parent = null;

    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.state`：记录测试夹具在当前场景中的状态。 */
      state = {bar: false};
      /** `Child.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        child = this;
      }
      /** `Child.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        Scheduler.log('child did update');
      }
      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    let shouldUpdate = true;

    /** `Intermediate`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Intermediate extends React.Component {
      /** `Intermediate.shouldComponentUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      shouldComponentUpdate() {
        return shouldUpdate;
      }
      /** `Intermediate.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <Child />;
      }
    }

    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.state`：记录测试夹具在当前场景中的状态。 */
      state = {foo: false};
      /** `Parent.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        parent = this;
      }
      /** `Parent.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        Scheduler.log('parent did update');
      }
      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <Intermediate />;
      }
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent />);
    });

    await act(() => {
      parent.setState({foo: true});
      child.setState({bar: true});
    });

    // 当我们按部就班地在批处理中渲染更改时， 子组件的 componentDidUpdate 在父组件之前。
    assertLog(['child did update', 'parent did update']);

    shouldUpdate = false;

    await act(() => {
      parent.setState({foo: false});
      child.setState({bar: false});
    });

    // 即使在中途提前退出，也应发生相同结果。
    assertLog(['child did update', 'parent did update']);
  });

  /** 测试场景：验证「should batch unmounts」描述的渲染、交互或错误处理结果。 */
  it('should batch unmounts', async () => {
    let outer;
    /** `Inner`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Inner extends React.Component {
      /** `Inner.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }

      /** `Inner.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        // 这次调用应被静默忽略（也可能发出警告），但不能破坏 React。
        outer.setState({showInner: false});
      }
    }

    /** `Outer`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Outer extends React.Component {
      /** `Outer.state`：记录测试夹具在当前场景中的状态。 */
      state = {showInner: true};
      /** `Outer.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        outer = this;
      }

      /** `Outer.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.state.showInner && <Inner />}</div>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Outer />);
    });

    expect(() => {
      root.unmount();
    }).not.toThrow();
  });

  /** 测试场景：验证「should update state when called from child cWRP」描述的渲染、交互或错误处理结果。 */
  it('should update state when called from child cWRP', async () => {
    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.state`：记录测试夹具在当前场景中的状态。 */
      state = {value: 'one'};
      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        Scheduler.log('parent render ' + this.state.value);
        return <Child parent={this} value={this.state.value} />;
      }
    }
    let updated = false;
    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        if (updated) {
          return;
        }
        Scheduler.log('child componentWillReceiveProps ' + this.props.value);
        this.props.parent.setState({value: 'two'});
        Scheduler.log(
          'child componentWillReceiveProps done ' + this.props.value,
        );
        updated = true;
      }
      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        Scheduler.log('child render ' + this.props.value);
        return <div>{this.props.value}</div>;
      }
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent />);
    });

    assertLog(['parent render one', 'child render one']);
    await act(() => {
      root.render(<Parent />);
    });

    assertLog([
      'parent render one',
      'child componentWillReceiveProps one',
      'child componentWillReceiveProps done one',
      'child render one',
      'parent render two',
      'child render two',
    ]);
  });

  /** 测试场景：验证「should merge state when sCU returns false」描述的渲染、交互或错误处理结果。 */
  it('should merge state when sCU returns false', async () => {
    let test;
    /** `Test`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Test extends React.Component {
      /** `Test.state`：记录测试夹具在当前场景中的状态。 */
      state = {a: 0};
      /** `Test.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        test = this;
      }

      /** `Test.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
      /** `Test.shouldComponentUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      shouldComponentUpdate(nextProps, nextState) {
        Scheduler.log(
          'scu from ' +
            Object.keys(this.state) +
            ' to ' +
            Object.keys(nextState),
        );
        return false;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Test />);
    });
    await act(() => {
      test.setState({b: 0});
    });

    assertLog(['scu from a to a,b']);
    await act(() => {
      test.setState({c: 0});
    });
    assertLog(['scu from a,b to a,b,c']);
  });

  /** 测试场景：验证「should treat assigning to this.state inside cWRP as a replaceState, with a warning」描述的渲染、交互或错误处理结果。 */
  it('should treat assigning to this.state inside cWRP as a replaceState, with a warning', async () => {
    /** `Test`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Test extends React.Component {
      /** `Test.state`：记录测试夹具在当前场景中的状态。 */
      state = {step: 1, extra: true};
      /** `Test.UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        this.setState({step: 2}, () => {
          // 测试早期的 setState 回调不会被丢弃
          Scheduler.log(
            `callback -- step: ${this.state.step}, extra: ${!!this.state
              .extra}`,
          );
        });
        // 像 replaceState
        this.state = {step: 3};
      }
      /** `Test.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        Scheduler.log(
          `render -- step: ${this.state.step}, extra: ${!!this.state.extra}`,
        );
        return null;
      }
    }

    // 挂载。
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Test />);
    });
    // 更新。
    ReactDOM.flushSync(() => {
      root.render(<Test />);
    });
    assertConsoleErrorDev([
      'Test.componentWillReceiveProps(): Assigning directly to ' +
        "this.state is deprecated (except inside a component's constructor). " +
        'Use setState instead.\n' +
        '    in Test (at **)',
    ]);

    assertLog([
      'render -- step: 1, extra: true',
      'render -- step: 3, extra: false',
      'callback -- step: 3, extra: false',
    ]);

    // 检查去重；（预期不会有额外的警告）
    expect(() => {
      ReactDOM.flushSync(() => {
        root.render(<Test />);
      });
    }).not.toThrow();
  });

  /** 测试场景：验证「should treat assigning to this.state inside cWM as a replaceState, with a warning」描述的渲染、交互或错误处理结果。 */
  it('should treat assigning to this.state inside cWM as a replaceState, with a warning', () => {
    /** `Test`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Test extends React.Component {
      /** `Test.state`：记录测试夹具在当前场景中的状态。 */
      state = {step: 1, extra: true};
      /** `Test.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        this.setState({step: 2}, () => {
          // 测试早期的 setState 回调不会被丢弃
          Scheduler.log(
            `callback -- step: ${this.state.step}, extra: ${!!this.state
              .extra}`,
          );
        });
        // 像 replaceState
        this.state = {step: 3};
      }
      /** `Test.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        Scheduler.log(
          `render -- step: ${this.state.step}, extra: ${!!this.state.extra}`,
        );
        return null;
      }
    }

    // 挂载。
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    ReactDOM.flushSync(() => {
      root.render(<Test />);
    });
    assertConsoleErrorDev([
      'Test.componentWillMount(): Assigning directly to ' +
        "this.state is deprecated (except inside a component's constructor). " +
        'Use setState instead.\n' +
        '    in Test (at **)',
    ]);

    assertLog([
      'render -- step: 3, extra: false',
      'callback -- step: 3, extra: false',

      // 重试时再执行一次。
      'render -- step: 3, extra: false',
      'callback -- step: 3, extra: false',
    ]);
  });

  /** 测试场景：验证「should not support setState in componentWillUnmount」描述的渲染、交互或错误处理结果。 */
  it('should not support setState in componentWillUnmount', async () => {
    let subscription;
    /** `A`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class A extends React.Component {
      /** `A.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        subscription();
      }
      /** `A.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return 'A';
      }
    }

    /** `B`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class B extends React.Component {
      /** `B.state`：记录测试夹具在当前场景中的状态。 */
      state = {siblingUnmounted: false};
      /** `B.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        subscription = () => this.setState({siblingUnmounted: true});
      }
      /** `B.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return 'B' + (this.state.siblingUnmounted ? ' No Sibling' : '');
      }
    }

    const el = document.createElement('div');
    const root = ReactDOMClient.createRoot(el);
    await act(() => {
      root.render(<A />);
    });
    expect(el.textContent).toBe('A');

    ReactDOM.flushSync(() => {
      root.render(<B />);
    });
    assertConsoleErrorDev([
      "Can't perform a React state update on a component that hasn't mounted yet. " +
        'This indicates that you have a side-effect in your render function that ' +
        'asynchronously tries to update the component. ' +
        'Move this work to useEffect instead.\n' +
        '    in B (at **)',
    ]);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「Legacy mode should support setState in componentWillUnmount (#18851)」描述的渲染、交互或错误处理结果。 */
  it('Legacy mode should support setState in componentWillUnmount (#18851)', () => {
    let subscription;
    /** `A`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class A extends React.Component {
      /** `A.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        subscription();
      }
      /** `A.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return 'A';
      }
    }

    /** `B`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class B extends React.Component {
      /** `B.state`：记录测试夹具在当前场景中的状态。 */
      state = {siblingUnmounted: false};
      /** `B.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        subscription = () => this.setState({siblingUnmounted: true});
      }
      /** `B.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return 'B' + (this.state.siblingUnmounted ? ' No Sibling' : '');
      }
    }

    const el = document.createElement('div');
    ReactDOM.render(<A />, el);
    expect(el.textContent).toBe('A');

    ReactDOM.render(<B />, el);
    expect(el.textContent).toBe('B No Sibling');
  });
});
