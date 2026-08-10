/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let act;

let React;
let ReactDOMClient;
let assertConsoleErrorDev;
let assertConsoleWarnDev;

/** `clone`：封装当前用例复用的操作、回调或断言步骤。 */
const clone = function (o) {
  return JSON.parse(JSON.stringify(o));
};

/** `GET_INIT_STATE_RETURN_VAL`：保存当前测试场景复用的夹具、状态或回调。 */
const GET_INIT_STATE_RETURN_VAL = {
  hasWillMountCompleted: false,
  hasRenderCompleted: false,
  hasDidMountCompleted: false,
  hasWillUnmountCompleted: false,
};

/** `INIT_RENDER_STATE`：保存当前测试场景复用的夹具、状态或回调。 */
const INIT_RENDER_STATE = {
  hasWillMountCompleted: true,
  hasRenderCompleted: false,
  hasDidMountCompleted: false,
  hasWillUnmountCompleted: false,
};

/** `DID_MOUNT_STATE`：保存当前测试场景复用的夹具、状态或回调。 */
const DID_MOUNT_STATE = {
  hasWillMountCompleted: true,
  hasRenderCompleted: true,
  hasDidMountCompleted: false,
  hasWillUnmountCompleted: false,
};

/** `NEXT_RENDER_STATE`：保存当前测试场景复用的夹具、状态或回调。 */
const NEXT_RENDER_STATE = {
  hasWillMountCompleted: true,
  hasRenderCompleted: true,
  hasDidMountCompleted: true,
  hasWillUnmountCompleted: false,
};

/** `WILL_UNMOUNT_STATE`：保存当前测试场景复用的夹具、状态或回调。 */
const WILL_UNMOUNT_STATE = {
  hasWillMountCompleted: true,
  hasDidMountCompleted: true,
  hasRenderCompleted: true,
  hasWillUnmountCompleted: false,
};

/** `POST_WILL_UNMOUNT_STATE`：保存当前测试场景复用的夹具、状态或回调。 */
const POST_WILL_UNMOUNT_STATE = {
  hasWillMountCompleted: true,
  hasDidMountCompleted: true,
  hasRenderCompleted: true,
  hasWillUnmountCompleted: true,
};

/**
 * TODO：应禁止在 `getInitialState` 与 `componentWillMount` 中调用 `setState`。
 * 这些调用通常会因 `this._renderedComponent` 为空而失败；但如果组件实例被复用，该前提便不成立，
 * 某些场景甚至会表现得像是更新成功。最稳妥的规则是在初始化阶段统一阻止全部更新。
 */
describe('ReactComponentLifeCycle', () => {
  beforeEach(() => {
    jest.resetModules();

    ({
      act,
      assertConsoleErrorDev,
      assertConsoleWarnDev,
    } = require('internal-test-utils'));

    React = require('react');
    ReactDOMClient = require('react-dom/client');
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should not reuse an instance when it has been unmounted」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should not reuse an instance when it has been unmounted', async () => {
    const container = document.createElement('div');

    /** `StatefulComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class StatefulComponent extends React.Component {
      /** `StatefulComponent.state`：记录测试夹具在当前场景中的状态。 */
      state = {};

      /** `StatefulComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    const element = <StatefulComponent />;
    let root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(element);
    });

    const firstInstance = container.firstChild;
    await act(() => {
      root.unmount();
    });
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(element);
    });

    const secondInstance = container.firstChild;
    expect(firstInstance).not.toBe(secondInstance);
  });

  /**
   * 如果状态更新触发重渲染，而重渲染又触发一次 `onDOMReady`，
   * 则第二次 `onDOMReady` 不应失败。
   */
  /** 测试场景：验证「should fire onDOMReady when already in onDOMReady」描述的渲染、交互或错误处理结果。 */
  it('should fire onDOMReady when already in onDOMReady', async () => {
    const _testJournal = [];

    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        _testJournal.push('Child:onDOMReady');
      }

      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    /** `SwitcherParent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class SwitcherParent extends React.Component {
      /** `SwitcherParent.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        _testJournal.push('SwitcherParent:getInitialState');
        this.state = {showHasOnDOMReadyComponent: false};
      }

      /** `SwitcherParent.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        _testJournal.push('SwitcherParent:onDOMReady');
        this.switchIt();
      }

      /** `SwitcherParent.switchIt`：封装当前用例复用的操作、回调或断言步骤。 */
      switchIt = () => {
        this.setState({showHasOnDOMReadyComponent: true});
      };

      /** `SwitcherParent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            {this.state.showHasOnDOMReadyComponent ? <Child /> : <div />}
          </div>
        );
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<SwitcherParent />);
    });

    expect(_testJournal).toEqual([
      'SwitcherParent:getInitialState',
      'SwitcherParent:onDOMReady',
      'Child:onDOMReady',
    ]);
  });

        // 这里可以给 state 赋值，但不能访问其成员，除非已提供 getInitialState 方法。
  /** 测试场景：验证「throws when accessing state in componentWillMount」描述的渲染、交互或错误处理结果。 */
  it('throws when accessing state in componentWillMount', async () => {
    /** `StatefulComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class StatefulComponent extends React.Component {
      /** `StatefulComponent.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        void this.state.yada;
      }

      /** `StatefulComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(<StatefulComponent />);
      }),
    ).rejects.toThrow();
  });

  /** 测试场景：验证「should allow update state inside of componentWillMount」描述的渲染、交互或错误处理结果。 */
  it('should allow update state inside of componentWillMount', () => {
    /** `StatefulComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class StatefulComponent extends React.Component {
      /** `StatefulComponent.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        this.setState({stateField: 'something'});
      }

      /** `StatefulComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    expect(async function () {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<StatefulComponent />);
      });
    }).not.toThrow();
  });

  /** 测试场景：验证「warns if setting 'this.state = props'」描述的渲染、交互或错误处理结果。 */
  it("warns if setting 'this.state = props'", async () => {
    /** `StatefulComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class StatefulComponent extends React.Component {
      /** `StatefulComponent.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props, context) {
        super(props, context);
        this.state = props;
      }
      /** `StatefulComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<StatefulComponent />);
    });
    assertConsoleErrorDev([
      'StatefulComponent: It is not recommended to assign props directly to state ' +
        "because updates to props won't be reflected in state. " +
        'In most cases, it is better to use props directly.\n' +
        '    in StatefulComponent (at **)',
    ]);
  });

  /** 测试场景：验证「should not allow update state inside of getInitialState」描述的渲染、交互或错误处理结果。 */
  it('should not allow update state inside of getInitialState', async () => {
    /** `StatefulComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class StatefulComponent extends React.Component {
      /** `StatefulComponent.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props, context) {
        super(props, context);
        this.setState({stateField: 'something'});

        this.state = {stateField: 'somethingelse'};
      }

      /** `StatefulComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    let container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<StatefulComponent />);
    });
    assertConsoleErrorDev([
      "Can't call setState on a component that is not yet mounted. " +
        'This is a no-op, but it might indicate a bug in your application. ' +
        'Instead, assign to `this.state` directly or define a `state = {};` ' +
        'class property with the desired state in the StatefulComponent component.\n' +
        '    in StatefulComponent (at **)',
    ]);

    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<StatefulComponent />);
    });
  });

  /** 测试场景：验证「should carry through each of the phases of setup」描述的渲染、交互或错误处理结果。 */
  it('should carry through each of the phases of setup', async () => {
    /** `LifeCycleComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class LifeCycleComponent extends React.Component {
      /** `LifeCycleComponent.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props, context) {
        super(props, context);
        this._testJournal = {};
        const initState = {
          hasWillMountCompleted: false,
          hasDidMountCompleted: false,
          hasRenderCompleted: false,
          hasWillUnmountCompleted: false,
        };
        this._testJournal.returnedFromGetInitialState = clone(initState);
        this.state = initState;
      }

      /** `LifeCycleComponent.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        this._testJournal.stateAtStartOfWillMount = clone(this.state);
        this.state.hasWillMountCompleted = true;
      }

      /** `LifeCycleComponent.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        this._testJournal.stateAtStartOfDidMount = clone(this.state);
        this.setState({hasDidMountCompleted: true});
      }

      /** `LifeCycleComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        const isInitialRender = !this.state.hasRenderCompleted;
        if (isInitialRender) {
          this._testJournal.stateInInitialRender = clone(this.state);
        } else {
          this._testJournal.stateInLaterRender = clone(this.state);
        }
        // 你永远不应该在真实代码中这样做！
        this.state.hasRenderCompleted = true;
        return <div ref={React.createRef()}>I am the inner DIV</div>;
      }

      /** `LifeCycleComponent.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        this._testJournal.stateAtStartOfWillUnmount = clone(this.state);
        this.state.hasWillUnmountCompleted = true;
      }
    }

    // 此时组件只完成了 constructor，尚未初始化或渲染。
    const root = ReactDOMClient.createRoot(document.createElement('div'));

    const instanceRef = React.createRef();
    await act(() => {
      root.render(<LifeCycleComponent ref={instanceRef} />);
    });
    const instance = instanceRef.current;

    // getInitialState
    expect(instance._testJournal.returnedFromGetInitialState).toEqual(
      GET_INIT_STATE_RETURN_VAL,
    );

    // componentWillMount
    expect(instance._testJournal.stateAtStartOfWillMount).toEqual(
      instance._testJournal.returnedFromGetInitialState,
    );

    // componentDidMount
    expect(instance._testJournal.stateAtStartOfDidMount).toEqual(
      DID_MOUNT_STATE,
    );

    // 初始渲染
    expect(instance._testJournal.stateInInitialRender).toEqual(
      INIT_RENDER_STATE,
    );

    // 现在更新组件
    instance.forceUpdate();

    // 第二次渲染
    expect(instance._testJournal.stateInLaterRender).toEqual(NEXT_RENDER_STATE);

    await act(() => {
      root.unmount();
    });

    expect(instance._testJournal.stateAtStartOfWillUnmount).toEqual(
      WILL_UNMOUNT_STATE,
    );
      // componentWillUnmount 会在卸载前调用。

      // 但组件此时的生命周期状态已是 unmounted。
    expect(instance.state).toEqual(POST_WILL_UNMOUNT_STATE);
  });

  /** 测试场景：验证「should not throw when updating an auxiliary component」描述的渲染、交互或错误处理结果。 */
  it('should not throw when updating an auxiliary component', async () => {
    /** `Tooltip`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Tooltip extends React.Component {
      /** `Tooltip.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.props.children}</div>;
      }

      /** `Tooltip.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        const container = document.createElement('div');
        this.root = ReactDOMClient.createRoot(container);
        this.updateTooltip();
      }

      /** `Tooltip.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        this.updateTooltip();
      }

      /** `Tooltip.updateTooltip`：封装当前用例复用的操作、回调或断言步骤。 */
      updateTooltip = () => {
        // 尽管 this.props.tooltip 有 owner，但它作为根组件挂载，因此在这里更新不应抛错。
        this.root.render(this.props.tooltip, this.container);
      };
    }

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <Tooltip
            ref={React.createRef()}
            tooltip={<div>{this.props.tooltipText}</div>}>
            {this.props.text}
          </Tooltip>
        );
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Component text="uno" tooltipText="one" />);
    });

    // 由于 `instance` 是根组件，我们可以更新其 props。这也会让 Tooltip 重新渲染
    // tooltip 组件，且不应抛错。
    await act(() => {
      root.render(<Component text="dos" tooltipText="two" />);
    });
  });

  /** 测试场景：验证「should allow state updates in componentDidMount」描述的渲染、交互或错误处理结果。 */
  it('should allow state updates in componentDidMount', async () => {
    /**
     * 在 componentDidMount 中调用 setState。
     */
    class SetStateInComponentDidMount extends React.Component {
      /** `SetStateInComponentDidMount.state`：记录测试夹具在当前场景中的状态。 */
      state = {
        stateField: this.props.valueToUseInitially,
      };

      /** `SetStateInComponentDidMount.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        this.setState({stateField: this.props.valueToUseInOnDOMReady});
      }

      /** `SetStateInComponentDidMount.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    let instance;
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <SetStateInComponentDidMount
          ref={current => (instance = current)}
          valueToUseInitially="hello"
          valueToUseInOnDOMReady="goodbye"
        />,
      );
    });

    expect(instance.state.stateField).toBe('goodbye');
  });

  /** 测试场景：验证「should call nested legacy lifecycle methods in the right order」描述的渲染、交互或错误处理结果。 */
  it('should call nested legacy lifecycle methods in the right order', async () => {
    let log;
    /** `logger`：封装当前用例复用的操作、回调或断言步骤。 */
    const logger = function (msg) {
      return function () {
        // 从 shouldComponentUpdate 返回 true。
        log.push(msg);
        return true;
      };
    };
    /** `Outer`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Outer extends React.Component {
      /** `Outer.UNSAFE_componentWillMount`：记录测试夹具在当前场景中的状态。 */
      UNSAFE_componentWillMount = logger('outer componentWillMount');
      /** `Outer.componentDidMount`：记录测试夹具在当前场景中的状态。 */
      componentDidMount = logger('outer componentDidMount');
      /** `Outer.UNSAFE_componentWillReceiveProps`：记录测试夹具在当前场景中的状态。 */
      UNSAFE_componentWillReceiveProps = logger(
        'outer componentWillReceiveProps',
      );
      /** `Outer.shouldComponentUpdate`：记录测试夹具在当前场景中的状态。 */
      shouldComponentUpdate = logger('outer shouldComponentUpdate');
      /** `Outer.UNSAFE_componentWillUpdate`：记录测试夹具在当前场景中的状态。 */
      UNSAFE_componentWillUpdate = logger('outer componentWillUpdate');
      /** `Outer.componentDidUpdate`：记录测试夹具在当前场景中的状态。 */
      componentDidUpdate = logger('outer componentDidUpdate');
      /** `Outer.componentWillUnmount`：记录测试夹具在当前场景中的状态。 */
      componentWillUnmount = logger('outer componentWillUnmount');
      /** `Outer.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            <Inner x={this.props.x} />
          </div>
        );
      }
    }

    /** `Inner`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Inner extends React.Component {
      /** `Inner.UNSAFE_componentWillMount`：记录测试夹具在当前场景中的状态。 */
      UNSAFE_componentWillMount = logger('inner componentWillMount');
      /** `Inner.componentDidMount`：记录测试夹具在当前场景中的状态。 */
      componentDidMount = logger('inner componentDidMount');
      /** `Inner.UNSAFE_componentWillReceiveProps`：记录测试夹具在当前场景中的状态。 */
      UNSAFE_componentWillReceiveProps = logger(
        'inner componentWillReceiveProps',
      );
      /** `Inner.shouldComponentUpdate`：记录测试夹具在当前场景中的状态。 */
      shouldComponentUpdate = logger('inner shouldComponentUpdate');
      /** `Inner.UNSAFE_componentWillUpdate`：记录测试夹具在当前场景中的状态。 */
      UNSAFE_componentWillUpdate = logger('inner componentWillUpdate');
      /** `Inner.componentDidUpdate`：记录测试夹具在当前场景中的状态。 */
      componentDidUpdate = logger('inner componentDidUpdate');
      /** `Inner.componentWillUnmount`：记录测试夹具在当前场景中的状态。 */
      componentWillUnmount = logger('inner componentWillUnmount');
      /** `Inner.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <span>{this.props.x}</span>;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    log = [];
    await act(() => {
      root.render(<Outer x={1} />);
    });
    expect(log).toEqual([
      'outer componentWillMount',
      'inner componentWillMount',
      'inner componentDidMount',
      'outer componentDidMount',
    ]);

    // 对警告去重。
    log = [];
    await act(() => {
      root.render(<Outer x={2} />);
    });
    expect(log).toEqual([
      'outer componentWillReceiveProps',
      'outer shouldComponentUpdate',
      'outer componentWillUpdate',
      'inner componentWillReceiveProps',
      'inner shouldComponentUpdate',
      'inner componentWillUpdate',
      'inner componentDidUpdate',
      'outer componentDidUpdate',
    ]);

    log = [];
    await act(() => {
      root.unmount();
    });
    expect(log).toEqual([
      'outer componentWillUnmount',
      'inner componentWillUnmount',
    ]);
  });

  /** 测试场景：验证「should call nested new lifecycle methods in the right order」描述的渲染、交互或错误处理结果。 */
  it('should call nested new lifecycle methods in the right order', async () => {
    let log;
    /** `logger`：封装当前用例复用的操作、回调或断言步骤。 */
    const logger = function (msg) {
      return function () {
        // 从 shouldComponentUpdate 返回 true。
        log.push(msg);
        return true;
      };
    };
    /** `Outer`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Outer extends React.Component {
      /** `Outer.state`：记录测试夹具在当前场景中的状态。 */
      state = {};
      /** `Outer.getDerivedStateFromProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromProps(props, prevState) {
        log.push('outer getDerivedStateFromProps');
        return null;
      }
      /** `Outer.componentDidMount`：记录测试夹具在当前场景中的状态。 */
      componentDidMount = logger('outer componentDidMount');
      /** `Outer.shouldComponentUpdate`：记录测试夹具在当前场景中的状态。 */
      shouldComponentUpdate = logger('outer shouldComponentUpdate');
      /** `Outer.getSnapshotBeforeUpdate`：记录测试夹具在当前场景中的状态。 */
      getSnapshotBeforeUpdate = logger('outer getSnapshotBeforeUpdate');
      /** `Outer.componentDidUpdate`：记录测试夹具在当前场景中的状态。 */
      componentDidUpdate = logger('outer componentDidUpdate');
      /** `Outer.componentWillUnmount`：记录测试夹具在当前场景中的状态。 */
      componentWillUnmount = logger('outer componentWillUnmount');
      /** `Outer.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            <Inner x={this.props.x} />
          </div>
        );
      }
    }

    /** `Inner`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Inner extends React.Component {
      /** `Inner.state`：记录测试夹具在当前场景中的状态。 */
      state = {};
      /** `Inner.getDerivedStateFromProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromProps(props, prevState) {
        log.push('inner getDerivedStateFromProps');
        return null;
      }
      /** `Inner.componentDidMount`：记录测试夹具在当前场景中的状态。 */
      componentDidMount = logger('inner componentDidMount');
      /** `Inner.shouldComponentUpdate`：记录测试夹具在当前场景中的状态。 */
      shouldComponentUpdate = logger('inner shouldComponentUpdate');
      /** `Inner.getSnapshotBeforeUpdate`：记录测试夹具在当前场景中的状态。 */
      getSnapshotBeforeUpdate = logger('inner getSnapshotBeforeUpdate');
      /** `Inner.componentDidUpdate`：记录测试夹具在当前场景中的状态。 */
      componentDidUpdate = logger('inner componentDidUpdate');
      /** `Inner.componentWillUnmount`：记录测试夹具在当前场景中的状态。 */
      componentWillUnmount = logger('inner componentWillUnmount');
      /** `Inner.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <span>{this.props.x}</span>;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));

    log = [];
    await act(() => {
      root.render(<Outer x={1} />);
    });
    expect(log).toEqual([
      'outer getDerivedStateFromProps',
      'inner getDerivedStateFromProps',
      'inner componentDidMount',
      'outer componentDidMount',
    ]);

    // 对警告去重。
    log = [];
    await act(() => {
      root.render(<Outer x={2} />);
    });
    expect(log).toEqual([
      'outer getDerivedStateFromProps',
      'outer shouldComponentUpdate',
      'inner getDerivedStateFromProps',
      'inner shouldComponentUpdate',
      'inner getSnapshotBeforeUpdate',
      'outer getSnapshotBeforeUpdate',
      'inner componentDidUpdate',
      'outer componentDidUpdate',
    ]);

    log = [];
    await act(() => {
      root.unmount();
    });
    expect(log).toEqual([
      'outer componentWillUnmount',
      'inner componentWillUnmount',
    ]);
  });

  /** 测试场景：验证「should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new static gDSFP is present」描述的渲染、交互或错误处理结果。 */
  it('should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new static gDSFP is present', async () => {
    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.state`：记录测试夹具在当前场景中的状态。 */
      state = {};
      /** `Component.getDerivedStateFromProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromProps() {
        return null;
      }
      /** `Component.componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillMount() {
        throw Error('unexpected');
      }
      /** `Component.componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillReceiveProps() {
        throw Error('unexpected');
      }
      /** `Component.componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUpdate() {
        throw Error('unexpected');
      }
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Component />);
    });
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
        'Component uses getDerivedStateFromProps() but also contains the following legacy lifecycles:\n' +
        '  componentWillMount\n' +
        '  componentWillReceiveProps\n' +
        '  componentWillUpdate\n\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in Component (at **)',
    ]);
    assertConsoleWarnDev([
      'componentWillMount has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move code with side effects to componentDidMount, and set initial state in the constructor.\n' +
        '* Rename componentWillMount to UNSAFE_componentWillMount to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: Component',
      'componentWillReceiveProps has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        "* If you're updating state whenever props change, refactor your code to use " +
        'memoization techniques or move it to static getDerivedStateFromProps. ' +
        'Learn more at: https://react.dev/link/derived-state\n' +
        '* Rename componentWillReceiveProps to UNSAFE_componentWillReceiveProps to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: Component',
      'componentWillUpdate has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        '* Rename componentWillUpdate to UNSAFE_componentWillUpdate to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: Component',
    ]);
  });

  /** 测试场景：验证「should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new getSnapshotBeforeUpdate is present」描述的渲染、交互或错误处理结果。 */
  it('should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new getSnapshotBeforeUpdate is present', async () => {
    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.state`：记录测试夹具在当前场景中的状态。 */
      state = {};
      /** `Component.getSnapshotBeforeUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getSnapshotBeforeUpdate() {
        return null;
      }
      /** `Component.componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillMount() {
        throw Error('unexpected');
      }
      /** `Component.componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillReceiveProps() {
        throw Error('unexpected');
      }
      /** `Component.componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUpdate() {
        throw Error('unexpected');
      }
      /** `Component.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {}
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Component value={1} />);
    });
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
        'Component uses getSnapshotBeforeUpdate() but also contains the following legacy lifecycles:\n' +
        '  componentWillMount\n' +
        '  componentWillReceiveProps\n' +
        '  componentWillUpdate\n\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in Component (at **)',
    ]);
    assertConsoleWarnDev([
      'componentWillMount has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move code with side effects to componentDidMount, and set initial state in the constructor.\n' +
        '* Rename componentWillMount to UNSAFE_componentWillMount to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: Component',
      'componentWillReceiveProps has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        "* If you're updating state whenever props change, refactor your code to use " +
        'memoization techniques or move it to static getDerivedStateFromProps. ' +
        'Learn more at: https://react.dev/link/derived-state\n' +
        '* Rename componentWillReceiveProps to UNSAFE_componentWillReceiveProps to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: Component',
      'componentWillUpdate has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        '* Rename componentWillUpdate to UNSAFE_componentWillUpdate to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: Component',
    ]);

    await act(() => {
      root.render(<Component value={2} />);
    });
  });

  /** 测试场景：验证「should not invoke new unsafe lifecycles (cWM/cWRP/cWU) if static gDSFP is present」描述的渲染、交互或错误处理结果。 */
  it('should not invoke new unsafe lifecycles (cWM/cWRP/cWU) if static gDSFP is present', async () => {
    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.state`：记录测试夹具在当前场景中的状态。 */
      state = {};
      /** `Component.getDerivedStateFromProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromProps() {
        return null;
      }
      /** `Component.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        throw Error('unexpected');
      }
      /** `Component.UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        throw Error('unexpected');
      }
      /** `Component.UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        throw Error('unexpected');
      }
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Component value={1} />);
    });
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
        'Component uses getDerivedStateFromProps() but also contains the following legacy lifecycles:\n' +
        '  UNSAFE_componentWillMount\n' +
        '  UNSAFE_componentWillReceiveProps\n' +
        '  UNSAFE_componentWillUpdate\n\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in Component (at **)',
    ]);
    await act(() => {
      root.render(<Component value={2} />);
    });
  });

  /** 测试场景：验证「should warn about deprecated lifecycles (cWM/cWRP/cWU) if new static gDSFP is present」描述的渲染、交互或错误处理结果。 */
  it('should warn about deprecated lifecycles (cWM/cWRP/cWU) if new static gDSFP is present', async () => {
    /** `AllLegacyLifecycles`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class AllLegacyLifecycles extends React.Component {
      /** `AllLegacyLifecycles.state`：记录测试夹具在当前场景中的状态。 */
      state = {};
      /** `AllLegacyLifecycles.getDerivedStateFromProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromProps() {
        return null;
      }
      /** `AllLegacyLifecycles.componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillMount() {}
      /** `AllLegacyLifecycles.UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {}
      /** `AllLegacyLifecycles.componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUpdate() {}
      /** `AllLegacyLifecycles.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<AllLegacyLifecycles />);
    });
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
        'AllLegacyLifecycles uses getDerivedStateFromProps() but also contains the following legacy lifecycles:\n' +
        '  componentWillMount\n' +
        '  UNSAFE_componentWillReceiveProps\n' +
        '  componentWillUpdate\n\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in AllLegacyLifecycles (at **)',
    ]);
    assertConsoleWarnDev([
      'componentWillMount has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move code with side effects to componentDidMount, and set initial state in the constructor.\n' +
        '* Rename componentWillMount to UNSAFE_componentWillMount to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: AllLegacyLifecycles',
      'componentWillUpdate has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        '* Rename componentWillUpdate to UNSAFE_componentWillUpdate to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: AllLegacyLifecycles',
    ]);

    /** `WillMount`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class WillMount extends React.Component {
      /** `WillMount.state`：记录测试夹具在当前场景中的状态。 */
      state = {};
      /** `WillMount.getDerivedStateFromProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromProps() {
        return null;
      }
      /** `WillMount.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {}
      /** `WillMount.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    await act(() => {
      root.render(<WillMount />);
    });
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
        'WillMount uses getDerivedStateFromProps() but also contains the following legacy lifecycles:\n' +
        '  UNSAFE_componentWillMount\n\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in WillMount (at **)',
    ]);

    /** `WillMountAndUpdate`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class WillMountAndUpdate extends React.Component {
      /** `WillMountAndUpdate.state`：记录测试夹具在当前场景中的状态。 */
      state = {};
      /** `WillMountAndUpdate.getDerivedStateFromProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromProps() {
        return null;
      }
      /** `WillMountAndUpdate.componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillMount() {}
      /** `WillMountAndUpdate.UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {}
      /** `WillMountAndUpdate.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    await act(() => {
      root.render(<WillMountAndUpdate />);
    });
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
        'WillMountAndUpdate uses getDerivedStateFromProps() but also contains the following legacy lifecycles:\n' +
        '  componentWillMount\n' +
        '  UNSAFE_componentWillUpdate\n\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in WillMountAndUpdate (at **)',
    ]);
    assertConsoleWarnDev([
      'componentWillMount has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move code with side effects to componentDidMount, and set initial state in the constructor.\n' +
        '* Rename componentWillMount to UNSAFE_componentWillMount to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: WillMountAndUpdate',
    ]);

    /** `WillReceiveProps`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class WillReceiveProps extends React.Component {
      /** `WillReceiveProps.state`：记录测试夹具在当前场景中的状态。 */
      state = {};
      /** `WillReceiveProps.getDerivedStateFromProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromProps() {
        return null;
      }
      /** `WillReceiveProps.componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillReceiveProps() {}
      /** `WillReceiveProps.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    await act(() => {
      root.render(<WillReceiveProps />);
    });
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
        'WillReceiveProps uses getDerivedStateFromProps() but also contains the following legacy lifecycles:\n' +
        '  componentWillReceiveProps\n\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in WillReceiveProps (at **)',
    ]);
    assertConsoleWarnDev([
      'componentWillReceiveProps has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        "* If you're updating state whenever props change, refactor your code to use " +
        'memoization techniques or move it to static getDerivedStateFromProps. ' +
        'Learn more at: https://react.dev/link/derived-state\n' +
        '* Rename componentWillReceiveProps to UNSAFE_componentWillReceiveProps to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: WillReceiveProps',
    ]);
  });

  /** 测试场景：验证「should warn about deprecated lifecycles (cWM/cWRP/cWU) if new getSnapshotBeforeUpdate is present」描述的渲染、交互或错误处理结果。 */
  it('should warn about deprecated lifecycles (cWM/cWRP/cWU) if new getSnapshotBeforeUpdate is present', async () => {
    /** `AllLegacyLifecycles`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class AllLegacyLifecycles extends React.Component {
      /** `AllLegacyLifecycles.state`：记录测试夹具在当前场景中的状态。 */
      state = {};
      /** `AllLegacyLifecycles.getSnapshotBeforeUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getSnapshotBeforeUpdate() {}
      /** `AllLegacyLifecycles.componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillMount() {}
      /** `AllLegacyLifecycles.UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {}
      /** `AllLegacyLifecycles.componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUpdate() {}
      /** `AllLegacyLifecycles.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {}
      /** `AllLegacyLifecycles.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<AllLegacyLifecycles />);
    });
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
        'AllLegacyLifecycles uses getSnapshotBeforeUpdate() but also contains the following legacy lifecycles:\n' +
        '  componentWillMount\n' +
        '  UNSAFE_componentWillReceiveProps\n' +
        '  componentWillUpdate\n\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in AllLegacyLifecycles (at **)',
    ]);
    assertConsoleWarnDev([
      'componentWillMount has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move code with side effects to componentDidMount, and set initial state in the constructor.\n' +
        '* Rename componentWillMount to UNSAFE_componentWillMount to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: AllLegacyLifecycles',
      'componentWillUpdate has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        '* Rename componentWillUpdate to UNSAFE_componentWillUpdate to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: AllLegacyLifecycles',
    ]);

    /** `WillMount`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class WillMount extends React.Component {
      /** `WillMount.state`：记录测试夹具在当前场景中的状态。 */
      state = {};
      /** `WillMount.getSnapshotBeforeUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getSnapshotBeforeUpdate() {}
      /** `WillMount.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {}
      /** `WillMount.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {}
      /** `WillMount.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    await act(() => {
      root.render(<WillMount />);
    });
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
        'WillMount uses getSnapshotBeforeUpdate() but also contains the following legacy lifecycles:\n' +
        '  UNSAFE_componentWillMount\n\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in WillMount (at **)',
    ]);

    /** `WillMountAndUpdate`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class WillMountAndUpdate extends React.Component {
      /** `WillMountAndUpdate.state`：记录测试夹具在当前场景中的状态。 */
      state = {};
      /** `WillMountAndUpdate.getSnapshotBeforeUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getSnapshotBeforeUpdate() {}
      /** `WillMountAndUpdate.componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillMount() {}
      /** `WillMountAndUpdate.UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {}
      /** `WillMountAndUpdate.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {}
      /** `WillMountAndUpdate.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    await act(() => {
      root.render(<WillMountAndUpdate />);
    });
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
        'WillMountAndUpdate uses getSnapshotBeforeUpdate() but also contains the following legacy lifecycles:\n' +
        '  componentWillMount\n' +
        '  UNSAFE_componentWillUpdate\n\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in WillMountAndUpdate (at **)',
    ]);
    assertConsoleWarnDev([
      'componentWillMount has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move code with side effects to componentDidMount, and set initial state in the constructor.\n' +
        '* Rename componentWillMount to UNSAFE_componentWillMount to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: WillMountAndUpdate',
    ]);

    /** `WillReceiveProps`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class WillReceiveProps extends React.Component {
      /** `WillReceiveProps.state`：记录测试夹具在当前场景中的状态。 */
      state = {};
      /** `WillReceiveProps.getSnapshotBeforeUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getSnapshotBeforeUpdate() {}
      /** `WillReceiveProps.componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillReceiveProps() {}
      /** `WillReceiveProps.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {}
      /** `WillReceiveProps.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    await act(() => {
      root.render(<WillReceiveProps />);
    });
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n' +
        'WillReceiveProps uses getSnapshotBeforeUpdate() but also contains the following legacy lifecycles:\n' +
        '  componentWillReceiveProps\n\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in WillReceiveProps (at **)',
    ]);
    assertConsoleWarnDev([
      'componentWillReceiveProps has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        "* If you're updating state whenever props change, refactor your code to use " +
        'memoization techniques or move it to static getDerivedStateFromProps. ' +
        'Learn more at: https://react.dev/link/derived-state\n' +
        '* Rename componentWillReceiveProps to UNSAFE_componentWillReceiveProps to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: WillReceiveProps',
    ]);
  });

  /** 测试场景：验证「should warn if getDerivedStateFromProps returns undefined」描述的渲染、交互或错误处理结果。 */
  it('should warn if getDerivedStateFromProps returns undefined', async () => {
    /** `MyComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class MyComponent extends React.Component {
      /** `MyComponent.state`：记录测试夹具在当前场景中的状态。 */
      state = {};
      /** `MyComponent.getDerivedStateFromProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromProps() {}
      /** `MyComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<MyComponent />);
    });
    assertConsoleErrorDev([
      'MyComponent.getDerivedStateFromProps(): A valid state object (or null) must ' +
        'be returned. You have returned undefined.\n' +
        '    in MyComponent (at **)',
    ]);

    // 去重
    await act(() => {
      root.render(<MyComponent />);
    });
  });

  /** 测试场景：验证「should warn if state is not initialized before getDerivedStateFromProps」描述的渲染、交互或错误处理结果。 */
  it('should warn if state is not initialized before getDerivedStateFromProps', async () => {
    /** `MyComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class MyComponent extends React.Component {
      /** `MyComponent.getDerivedStateFromProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromProps() {
        return null;
      }
      /** `MyComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<MyComponent />);
    });
    assertConsoleErrorDev([
      '`MyComponent` uses `getDerivedStateFromProps` but its initial state is ' +
        'undefined. This is not recommended. Instead, define the initial state by ' +
        'assigning an object to `this.state` in the constructor of `MyComponent`. ' +
        'This ensures that `getDerivedStateFromProps` arguments have a consistent shape.\n' +
        '    in MyComponent (at **)',
    ]);

    // 去重
    await act(() => {
      root.render(<MyComponent />);
    });
  });

  /** 测试场景：验证「should invoke both deprecated and new lifecycles if both are present」描述的渲染、交互或错误处理结果。 */
  it('should invoke both deprecated and new lifecycles if both are present', async () => {
    const log = [];

    /** `MyComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class MyComponent extends React.Component {
      /** `MyComponent.componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillMount() {
        log.push('componentWillMount');
      }
      /** `MyComponent.componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillReceiveProps() {
        log.push('componentWillReceiveProps');
      }
      /** `MyComponent.componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUpdate() {
        log.push('componentWillUpdate');
      }
      /** `MyComponent.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        log.push('UNSAFE_componentWillMount');
      }
      /** `MyComponent.UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        log.push('UNSAFE_componentWillReceiveProps');
      }
      /** `MyComponent.UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        log.push('UNSAFE_componentWillUpdate');
      }
      /** `MyComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<MyComponent foo="bar" />);
    });
    assertConsoleWarnDev([
      'componentWillMount has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move code with side effects to componentDidMount, and set initial state in the constructor.\n' +
        '* Rename componentWillMount to UNSAFE_componentWillMount to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: MyComponent',
      'componentWillReceiveProps has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        "* If you're updating state whenever props change, refactor your code to use " +
        'memoization techniques or move it to static getDerivedStateFromProps. ' +
        'Learn more at: https://react.dev/link/derived-state\n' +
        '* Rename componentWillReceiveProps to UNSAFE_componentWillReceiveProps to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: MyComponent',
      'componentWillUpdate has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        '* Rename componentWillUpdate to UNSAFE_componentWillUpdate to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n\n' +
        'Please update the following components: MyComponent',
    ]);
    expect(log).toEqual(['componentWillMount', 'UNSAFE_componentWillMount']);

    log.length = 0;

    await act(() => {
      root.render(<MyComponent foo="baz" />);
    });
    expect(log).toEqual([
      'componentWillReceiveProps',
      'UNSAFE_componentWillReceiveProps',
      'componentWillUpdate',
      'UNSAFE_componentWillUpdate',
    ]);
  });

  /** 测试场景：验证「should not override state with stale values if prevState is spread within getDerivedStateFromProps」描述的渲染、交互或错误处理结果。 */
  it('should not override state with stale values if prevState is spread within getDerivedStateFromProps', async () => {
    const divRef = React.createRef();
    let childInstance;

    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.state`：记录测试夹具在当前场景中的状态。 */
      state = {local: 0};
      /** `Child.getDerivedStateFromProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromProps(nextProps, prevState) {
        return {...prevState, remote: nextProps.remote};
      }
      /** `Child.updateState`：封装当前用例复用的操作、回调或断言步骤。 */
      updateState = () => {
        this.setState(state => ({local: state.local + 1}));
        this.props.onChange(this.state.remote + 1);
      };
      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        childInstance = this;
        return (
          <div
            onClick={this.updateState}
            ref={
              divRef
            }>{`remote:${this.state.remote}, local:${this.state.local}`}</div>
        );
      }
    }

    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.state`：记录测试夹具在当前场景中的状态。 */
      state = {value: 0};
      /** `Parent.handleChange`：封装当前用例复用的操作、回调或断言步骤。 */
      handleChange = value => {
        this.setState({value});
      };
      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <Child remote={this.state.value} onChange={this.handleChange} />;
      }
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<Parent />);
    });
    expect(divRef.current.textContent).toBe('remote:0, local:0');

    // 触发 setState() 调用
    await act(() => {
      childInstance.updateState();
    });
    expect(divRef.current.textContent).toBe('remote:1, local:1');

    // 触发批量 setState() 调用。
    await act(() => {
      divRef.current.click();
    });
    expect(divRef.current.textContent).toBe('remote:2, local:2');
    document.body.removeChild(container);
  });

  /** 测试场景：验证「should pass the return value from getSnapshotBeforeUpdate to componentDidUpdate」描述的渲染、交互或错误处理结果。 */
  it('should pass the return value from getSnapshotBeforeUpdate to componentDidUpdate', async () => {
    const log = [];

    /** `MyComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class MyComponent extends React.Component {
      /** `MyComponent.state`：记录测试夹具在当前场景中的状态。 */
      state = {
        value: 0,
      };
      /** `MyComponent.getDerivedStateFromProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromProps(nextProps, prevState) {
        return {
          value: prevState.value + 1,
        };
      }
      /** `MyComponent.getSnapshotBeforeUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getSnapshotBeforeUpdate(prevProps, prevState) {
        log.push(
          `getSnapshotBeforeUpdate() prevProps:${prevProps.value} prevState:${prevState.value}`,
        );
        return 'abc';
      }
      /** `MyComponent.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate(prevProps, prevState, snapshot) {
        log.push(
          `componentDidUpdate() prevProps:${prevProps.value} prevState:${prevState.value} snapshot:${snapshot}`,
        );
      }
      /** `MyComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        log.push('render');
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(
        <div>
          <MyComponent value="foo" />
        </div>,
      );
    });
    expect(log).toEqual(['render']);
    log.length = 0;

    await act(() => {
      root.render(
        <div>
          <MyComponent value="bar" />
        </div>,
      );
    });
    expect(log).toEqual([
      'render',
      'getSnapshotBeforeUpdate() prevProps:foo prevState:1',
      'componentDidUpdate() prevProps:foo prevState:1 snapshot:abc',
    ]);
    log.length = 0;

    await act(() => {
      root.render(
        <div>
          <MyComponent value="baz" />
        </div>,
      );
    });
    expect(log).toEqual([
      'render',
      'getSnapshotBeforeUpdate() prevProps:bar prevState:2',
      'componentDidUpdate() prevProps:bar prevState:2 snapshot:abc',
    ]);
    log.length = 0;

    await act(() => {
      root.render(<div />);
    });
    expect(log).toEqual([]);
  });

  /** 测试场景：验证「should pass previous state to shouldComponentUpdate even with getDerivedStateFromProps」描述的渲染、交互或错误处理结果。 */
  it('should pass previous state to shouldComponentUpdate even with getDerivedStateFromProps', async () => {
    const divRef = React.createRef();
    /** `SimpleComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class SimpleComponent extends React.Component {
      /** `SimpleComponent.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        this.state = {
          value: props.value,
        };
      }

      /** `SimpleComponent.getDerivedStateFromProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromProps(nextProps, prevState) {
        if (nextProps.value === prevState.value) {
          return null;
        }
        return {value: nextProps.value};
      }

      /** `SimpleComponent.shouldComponentUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      shouldComponentUpdate(nextProps, nextState) {
        return nextState.value !== this.state.value;
      }

      /** `SimpleComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div ref={divRef}>value: {this.state.value}</div>;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<SimpleComponent value="initial" />);
    });
    expect(divRef.current.textContent).toBe('value: initial');
    await act(() => {
      root.render(<SimpleComponent value="updated" />);
    });
    expect(divRef.current.textContent).toBe('value: updated');
  });

  /** 测试场景：验证「should call getSnapshotBeforeUpdate before mutations are committed」描述的渲染、交互或错误处理结果。 */
  it('should call getSnapshotBeforeUpdate before mutations are committed', async () => {
    const log = [];

    /** `MyComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class MyComponent extends React.Component {
      /** `MyComponent.divRef`：记录测试夹具在当前场景中的状态。 */
      divRef = React.createRef();
      /** `MyComponent.getSnapshotBeforeUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getSnapshotBeforeUpdate(prevProps, prevState) {
        log.push('getSnapshotBeforeUpdate');
        expect(this.divRef.current.textContent).toBe(
          `value:${prevProps.value}`,
        );
        return 'foobar';
      }
      /** `MyComponent.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate(prevProps, prevState, snapshot) {
        log.push('componentDidUpdate');
        expect(this.divRef.current.textContent).toBe(
          `value:${this.props.value}`,
        );
        expect(snapshot).toBe('foobar');
      }
      /** `MyComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        log.push('render');
        return <div ref={this.divRef}>{`value:${this.props.value}`}</div>;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<MyComponent value="foo" />);
    });
    expect(log).toEqual(['render']);
    log.length = 0;

    await act(() => {
      root.render(<MyComponent value="bar" />);
    });
    expect(log).toEqual([
      'render',
      'getSnapshotBeforeUpdate',
      'componentDidUpdate',
    ]);
    log.length = 0;
  });

  /** 测试场景：验证「should warn if getSnapshotBeforeUpdate returns undefined」描述的渲染、交互或错误处理结果。 */
  it('should warn if getSnapshotBeforeUpdate returns undefined', async () => {
    /** `MyComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class MyComponent extends React.Component {
      /** `MyComponent.getSnapshotBeforeUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getSnapshotBeforeUpdate() {}
      /** `MyComponent.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {}
      /** `MyComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<MyComponent value="foo" />);
    });

    await act(() => {
      root.render(<MyComponent value="bar" />);
    });
    assertConsoleErrorDev([
      'MyComponent.getSnapshotBeforeUpdate(): A snapshot value (or null) must ' +
        'be returned. You have returned undefined.\n' +
        '    in MyComponent (at **)',
    ]);

    // 去重
    await act(() => {
      root.render(<MyComponent value="baz" />);
    });
  });

  /** 测试场景：验证「should warn if getSnapshotBeforeUpdate is defined with no componentDidUpdate」描述的渲染、交互或错误处理结果。 */
  it('should warn if getSnapshotBeforeUpdate is defined with no componentDidUpdate', async () => {
    /** `MyComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class MyComponent extends React.Component {
      /** `MyComponent.getSnapshotBeforeUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getSnapshotBeforeUpdate() {
        return null;
      }
      /** `MyComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<MyComponent />);
    });
    assertConsoleErrorDev([
      'MyComponent: getSnapshotBeforeUpdate() should be used with componentDidUpdate(). ' +
        'This component defines getSnapshotBeforeUpdate() only.\n' +
        '    in MyComponent (at **)',
    ]);

    // 去重
    await act(() => {
      root.render(<MyComponent />);
    });
  });

  /** 测试场景：验证「warns about deprecated unsafe lifecycles」描述的渲染、交互或错误处理结果。 */
  it('warns about deprecated unsafe lifecycles', async () => {
    /** `MyComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class MyComponent extends React.Component {
      /** `MyComponent.componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillMount() {}
      /** `MyComponent.componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillReceiveProps() {}
      /** `MyComponent.componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUpdate() {}
      /** `MyComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));

    await act(() => {
      root.render(<MyComponent x={1} />);
    });
    assertConsoleWarnDev([
      `componentWillMount has been renamed, and is not recommended for use. See https://react.dev/link/unsafe-component-lifecycles for details.

* Move code with side effects to componentDidMount, and set initial state in the constructor.
* Rename componentWillMount to UNSAFE_componentWillMount to suppress this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, you can run \`npx react-codemod rename-unsafe-lifecycles\` in your project source folder.

Please update the following components: MyComponent`,
      `componentWillReceiveProps has been renamed, and is not recommended for use. See https://react.dev/link/unsafe-component-lifecycles for details.

* Move data fetching code or side effects to componentDidUpdate.
* If you're updating state whenever props change, refactor your code to use memoization techniques or move it to static getDerivedStateFromProps. Learn more at: https://react.dev/link/derived-state
* Rename componentWillReceiveProps to UNSAFE_componentWillReceiveProps to suppress this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, you can run \`npx react-codemod rename-unsafe-lifecycles\` in your project source folder.

Please update the following components: MyComponent`,
      `componentWillUpdate has been renamed, and is not recommended for use. See https://react.dev/link/unsafe-component-lifecycles for details.

* Move data fetching code or side effects to componentDidUpdate.
* Rename componentWillUpdate to UNSAFE_componentWillUpdate to suppress this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. To rename all deprecated lifecycles to their new names, you can run \`npx react-codemod rename-unsafe-lifecycles\` in your project source folder.

Please update the following components: MyComponent`,
    ]);

    // 去重检查（更新现有组件并实例化新组件）。
    await act(() => {
      root.render(<MyComponent x={2} />);
    });
    await act(() => {
      root.render(<MyComponent key="new" x={1} />);
    });
  });

  describe('react-lifecycles-compat', () => {
    const {polyfill} = require('react-lifecycles-compat');

    /** 测试场景：验证「should not warn for components with polyfilled getDerivedStateFromProps」描述的渲染、交互或错误处理结果。 */
    it('should not warn for components with polyfilled getDerivedStateFromProps', async () => {
      /** `PolyfilledComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class PolyfilledComponent extends React.Component {
        /** `PolyfilledComponent.state`：记录测试夹具在当前场景中的状态。 */
        state = {};
        /** `PolyfilledComponent.getDerivedStateFromProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
        static getDerivedStateFromProps() {
          return null;
        }
        /** `PolyfilledComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return null;
        }
      }

      polyfill(PolyfilledComponent);

      const root = ReactDOMClient.createRoot(document.createElement('div'));
      await act(() => {
        root.render(
          <React.StrictMode>
            <PolyfilledComponent />
          </React.StrictMode>,
        );
      });
    });

    /** 测试场景：验证「should not warn for components with polyfilled getSnapshotBeforeUpdate」描述的渲染、交互或错误处理结果。 */
    it('should not warn for components with polyfilled getSnapshotBeforeUpdate', async () => {
      /** `PolyfilledComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class PolyfilledComponent extends React.Component {
        /** `PolyfilledComponent.getSnapshotBeforeUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
        getSnapshotBeforeUpdate() {
          return null;
        }
        /** `PolyfilledComponent.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
        componentDidUpdate() {}
        /** `PolyfilledComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return null;
        }
      }

      polyfill(PolyfilledComponent);

      const root = ReactDOMClient.createRoot(document.createElement('div'));
      await act(() => {
        root.render(
          <React.StrictMode>
            <PolyfilledComponent />
          </React.StrictMode>,
        );
      });
    });
  });
});
