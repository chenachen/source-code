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
let PropTypes;

let act;
let assertConsoleErrorDev;

describe('ReactLegacyCompositeComponent', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    findDOMNode =
      ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
        .findDOMNode;
    PropTypes = require('prop-types');
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));
  });

  // @gate !disableLegacyMode
  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should warn about `setState` in render in legacy mode」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should warn about `setState` in render in legacy mode', () => {
    const container = document.createElement('div');

    let renderedState = -1;
    let renderPasses = 0;

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.state`：记录测试夹具在当前场景中的状态。 */
      state = {value: 0};

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        renderPasses++;
        renderedState = this.state.value;
        if (this.state.value === 0) {
          this.setState({value: 1});
        }
        return <div />;
      }
    }
    const instance = ReactDOM.render(<Component />, container);
    assertConsoleErrorDev([
      'Cannot update during an existing state transition (such as within ' +
        '`render`). Render methods should be a pure function of props and state.\n' +
        '    in Component (at **)',
    ]);

    // 设置状态调用是排队,然后作为第二次传递执行. 这种行为是undefined 虽然所以我们可以自由地改变它,
    // 以适应实现细节.
    expect(renderPasses).toBe(2);
    expect(renderedState).toBe(1);
    expect(instance.state.value).toBe(1);

    // 强制任何地方重渲染都会导致更新发生。
    const instance2 = ReactDOM.render(<Component prop={123} />, container);
    expect(instance).toBe(instance2);
    expect(renderedState).toBe(1);
    expect(instance2.state.value).toBe(1);

    // 测试去重；（不期望出现额外警告）。
    ReactDOM.unmountComponentAtNode(container);
    ReactDOM.render(<Component prop={123} />, container);
  });

  // @gate !disableLegacyContext
  /** 测试场景：验证「should pass context to children when not owner」描述的渲染、交互或错误处理结果。 */
  it('should pass context to children when not owner', async () => {
    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <Child>
            <Grandchild />
          </Child>
        );
      }
    }

    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.childContextTypes`：记录测试夹具在当前场景中的状态。 */
      static childContextTypes = {
        foo: PropTypes.string,
      };

      /** `Child.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getChildContext() {
        return {
          foo: 'bar',
        };
      }

      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return React.Children.only(this.props.children);
      }
    }

    /** `Grandchild`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Grandchild extends React.Component {
      /** `Grandchild.contextTypes`：记录测试夹具在当前场景中的状态。 */
      static contextTypes = {
        foo: PropTypes.string,
      };

      /** `Grandchild.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.context.foo}</div>;
      }
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let component;
    await act(() => {
      root.render(<Parent ref={current => (component = current)} />);
    });
    assertConsoleErrorDev([
      'Child uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
      'Grandchild uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
    ]);
    expect(findDOMNode(component).innerHTML).toBe('bar');
  });

  // @gate !disableLegacyContext
  /** 测试场景：验证「should pass context when re-rendered for static child」描述的渲染、交互或错误处理结果。 */
  it('should pass context when re-rendered for static child', async () => {
    let parentInstance = null;
    let childInstance = null;

    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.childContextTypes`：记录测试夹具在当前场景中的状态。 */
      static childContextTypes = {
        foo: PropTypes.string,
        flag: PropTypes.bool,
      };

      /** `Parent.state`：记录测试夹具在当前场景中的状态。 */
      state = {
        flag: false,
      };

      /** `Parent.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getChildContext() {
        return {
          foo: 'bar',
          flag: this.state.flag,
        };
      }

      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return React.Children.only(this.props.children);
      }
    }

    /** `Middle`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Middle extends React.Component {
      /** `Middle.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return this.props.children;
      }
    }

    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.contextTypes`：记录测试夹具在当前场景中的状态。 */
      static contextTypes = {
        foo: PropTypes.string,
        flag: PropTypes.bool,
      };

      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        childInstance = this;
        return <span>Child</span>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(
        <Parent ref={current => (parentInstance = current)}>
          <Middle>
            <Child />
          </Middle>
        </Parent>,
      );
    });

    expect(parentInstance.state.flag).toBe(false);
    expect(childInstance.context).toEqual({foo: 'bar', flag: false});

    assertConsoleErrorDev([
      'Parent uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
      'Child uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Child (at **)',
    ]);

    await act(() => {
      parentInstance.setState({flag: true});
    });
    expect(parentInstance.state.flag).toBe(true);
    expect(childInstance.context).toEqual({foo: 'bar', flag: true});
  });

  // @gate !disableLegacyContext
  /** 测试场景：验证「should pass context when re-rendered for static child within a composite component」描述的渲染、交互或错误处理结果。 */
  it('should pass context when re-rendered for static child within a composite component', async () => {
    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.childContextTypes`：记录测试夹具在当前场景中的状态。 */
      static childContextTypes = {
        flag: PropTypes.bool,
      };

      /** `Parent.state`：记录测试夹具在当前场景中的状态。 */
      state = {
        flag: true,
      };

      /** `Parent.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getChildContext() {
        return {
          flag: this.state.flag,
        };
      }

      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.contextTypes`：记录测试夹具在当前场景中的状态。 */
      static contextTypes = {
        flag: PropTypes.bool,
      };

      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    /** `Wrapper`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Wrapper extends React.Component {
      /** `Wrapper.parentRef`：记录测试夹具在当前场景中的状态。 */
      parentRef = React.createRef();
      /** `Wrapper.childRef`：记录测试夹具在当前场景中的状态。 */
      childRef = React.createRef();

      /** `Wrapper.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <Parent ref={this.parentRef}>
            <Child ref={this.childRef} />
          </Parent>
        );
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let wrapper;
    await act(() => {
      root.render(<Wrapper ref={current => (wrapper = current)} />);
    });

    assertConsoleErrorDev([
      'Parent uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Wrapper (at **)',
      'Child uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Wrapper (at **)',
    ]);

    expect(wrapper.parentRef.current.state.flag).toEqual(true);
    expect(wrapper.childRef.current.context).toEqual({flag: true});

    // 更新 <Parent />；相对于这次更新，<Child /> 仍是未变化的静态 prop。
    await act(() => {
      wrapper.parentRef.current.setState({flag: false});
    });

    expect(wrapper.parentRef.current.state.flag).toEqual(false);
    expect(wrapper.childRef.current.context).toEqual({flag: false});
  });

  // @gate !disableLegacyContext
  /** 测试场景：验证「should pass context transitively」描述的渲染、交互或错误处理结果。 */
  it('should pass context transitively', async () => {
    let childInstance = null;
    let grandchildInstance = null;

    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.childContextTypes`：记录测试夹具在当前场景中的状态。 */
      static childContextTypes = {
        foo: PropTypes.string,
        depth: PropTypes.number,
      };

      /** `Parent.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getChildContext() {
        return {
          foo: 'bar',
          depth: 0,
        };
      }

      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <Child />;
      }
    }

    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.contextTypes`：记录测试夹具在当前场景中的状态。 */
      static contextTypes = {
        foo: PropTypes.string,
        depth: PropTypes.number,
      };

      /** `Child.childContextTypes`：记录测试夹具在当前场景中的状态。 */
      static childContextTypes = {
        depth: PropTypes.number,
      };

      /** `Child.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getChildContext() {
        return {
          depth: this.context.depth + 1,
        };
      }

      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        childInstance = this;
        return <Grandchild />;
      }
    }

    /** `Grandchild`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Grandchild extends React.Component {
      /** `Grandchild.contextTypes`：记录测试夹具在当前场景中的状态。 */
      static contextTypes = {
        foo: PropTypes.string,
        depth: PropTypes.number,
      };

      /** `Grandchild.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        grandchildInstance = this;
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent />);
    });

    assertConsoleErrorDev([
      'Parent uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
      'Child uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
      'Child uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
      'Grandchild uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Child (at **)\n' +
        '    in Parent (at **)',
    ]);

    expect(childInstance.context).toEqual({foo: 'bar', depth: 0});
    expect(grandchildInstance.context).toEqual({foo: 'bar', depth: 1});
  });

  // @gate !disableLegacyContext
  /** 测试场景：验证「should pass context when re-rendered」描述的渲染、交互或错误处理结果。 */
  it('should pass context when re-rendered', async () => {
    let parentInstance = null;
    let childInstance = null;

    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.childContextTypes`：记录测试夹具在当前场景中的状态。 */
      static childContextTypes = {
        foo: PropTypes.string,
        depth: PropTypes.number,
      };

      /** `Parent.state`：记录测试夹具在当前场景中的状态。 */
      state = {
        flag: false,
      };

      /** `Parent.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getChildContext() {
        return {
          foo: 'bar',
          depth: 0,
        };
      }

      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        let output = <Child />;
        if (!this.state.flag) {
          output = <span>Child</span>;
        }
        return output;
      }
    }

    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.contextTypes`：记录测试夹具在当前场景中的状态。 */
      static contextTypes = {
        foo: PropTypes.string,
        depth: PropTypes.number,
      };

      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        childInstance = this;
        return <span>Child</span>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent ref={current => (parentInstance = current)} />);
    });
    assertConsoleErrorDev([
      'Parent uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
    ]);

    expect(childInstance).toBeNull();

    expect(parentInstance.state.flag).toBe(false);
    await act(() => {
      parentInstance.setState({flag: true});
    });
    assertConsoleErrorDev([
      'Child uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
    ]);

    expect(parentInstance.state.flag).toBe(true);

    expect(childInstance.context).toEqual({foo: 'bar', depth: 0});
  });

  // @gate !disableLegacyContext
  // @gate !disableLegacyMode
  /** 测试场景：验证「unmasked context propagates through updates」描述的渲染、交互或错误处理结果。 */
  it('unmasked context propagates through updates', () => {
    /** `Leaf`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Leaf extends React.Component {
      /** `Leaf.contextTypes`：记录测试夹具在当前场景中的状态。 */
      static contextTypes = {
        foo: PropTypes.string.isRequired,
      };

      /** `Leaf.UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps(nextProps, nextContext) {
        expect('foo' in nextContext).toBe(true);
      }

      /** `Leaf.shouldComponentUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      shouldComponentUpdate(nextProps, nextState, nextContext) {
        expect('foo' in nextContext).toBe(true);
        return true;
      }

      /** `Leaf.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <span>{this.context.foo}</span>;
      }
    }

    /** `Intermediary`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Intermediary extends React.Component {
      /** `Intermediary.UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps(nextProps, nextContext) {
        expect('foo' in nextContext).toBe(false);
      }

      /** `Intermediary.shouldComponentUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      shouldComponentUpdate(nextProps, nextState, nextContext) {
        expect('foo' in nextContext).toBe(false);
        return true;
      }

      /** `Intermediary.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <Leaf />;
      }
    }

    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.childContextTypes`：记录测试夹具在当前场景中的状态。 */
      static childContextTypes = {
        foo: PropTypes.string,
      };

      /** `Parent.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getChildContext() {
        return {
          foo: this.props.cntxt,
        };
      }

      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <Intermediary />;
      }
    }

    const div = document.createElement('div');
    ReactDOM.render(<Parent cntxt="noise" />, div);
    assertConsoleErrorDev([
      'Parent uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
      'Leaf uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Intermediary (at **)\n' +
        '    in Parent (at **)',
    ]);
    expect(div.children[0].innerHTML).toBe('noise');
    div.children[0].innerHTML = 'aliens';
    div.children[0].id = 'aliens';
    expect(div.children[0].innerHTML).toBe('aliens');
    expect(div.children[0].id).toBe('aliens');
    ReactDOM.render(<Parent cntxt="bar" />, div);
    expect(div.children[0].innerHTML).toBe('bar');
    expect(div.children[0].id).toBe('aliens');
  });

  // @gate !disableLegacyContext
  // @gate !disableLegacyMode
  /** 测试场景：验证「should trigger componentWillReceiveProps for context changes」描述的渲染、交互或错误处理结果。 */
  it('should trigger componentWillReceiveProps for context changes', () => {
    let contextChanges = 0;
    let propChanges = 0;

    /** `GrandChild`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class GrandChild extends React.Component {
      /** `GrandChild.contextTypes`：记录测试夹具在当前场景中的状态。 */
      static contextTypes = {
        foo: PropTypes.string.isRequired,
      };

      /** `GrandChild.UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps(nextProps, nextContext) {
        expect('foo' in nextContext).toBe(true);

        if (nextProps !== this.props) {
          propChanges++;
        }

        if (nextContext !== this.context) {
          contextChanges++;
        }
      }

      /** `GrandChild.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <span className="grand-child">{this.props.children}</span>;
      }
    }

    /** `ChildWithContext`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ChildWithContext extends React.Component {
      /** `ChildWithContext.contextTypes`：记录测试夹具在当前场景中的状态。 */
      static contextTypes = {
        foo: PropTypes.string.isRequired,
      };

      /** `ChildWithContext.UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps(nextProps, nextContext) {
        expect('foo' in nextContext).toBe(true);

        if (nextProps !== this.props) {
          propChanges++;
        }

        if (nextContext !== this.context) {
          contextChanges++;
        }
      }

      /** `ChildWithContext.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div className="child-with">{this.props.children}</div>;
      }
    }

    /** `ChildWithoutContext`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ChildWithoutContext extends React.Component {
      /** `ChildWithoutContext.UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps(nextProps, nextContext) {
        expect('foo' in nextContext).toBe(false);

        if (nextProps !== this.props) {
          propChanges++;
        }

        if (nextContext !== this.context) {
          contextChanges++;
        }
      }

      /** `ChildWithoutContext.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div className="child-without">{this.props.children}</div>;
      }
    }

    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.childContextTypes`：记录测试夹具在当前场景中的状态。 */
      static childContextTypes = {
        foo: PropTypes.string,
      };

      /** `Parent.state`：记录测试夹具在当前场景中的状态。 */
      state = {
        foo: 'abc',
      };

      /** `Parent.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getChildContext() {
        return {
          foo: this.state.foo,
        };
      }

      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div className="parent">{this.props.children}</div>;
      }
    }

    const div = document.createElement('div');

    let parentInstance = null;
    ReactDOM.render(
      <Parent ref={inst => (parentInstance = inst)}>
        <ChildWithoutContext>
          A1
          <GrandChild>A2</GrandChild>
        </ChildWithoutContext>

        <ChildWithContext>
          B1
          <GrandChild>B2</GrandChild>
        </ChildWithContext>
      </Parent>,
      div,
    );
    assertConsoleErrorDev([
      'Parent uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
      'GrandChild uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in GrandChild (at **)',
      'ChildWithContext uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in ChildWithContext (at **)',
    ]);

    parentInstance.setState({
      foo: 'def',
    });

    expect(propChanges).toBe(0);
    expect(contextChanges).toBe(3); // ChildWithContext 一次，GrandChild 两次。
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「only renders once if updated in componentWillReceiveProps in legacy mode」描述的渲染、交互或错误处理结果。 */
  it('only renders once if updated in componentWillReceiveProps in legacy mode', () => {
    let renders = 0;

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.state`：记录测试夹具在当前场景中的状态。 */
      state = {updated: false};

      /** `Component.UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps(props) {
        expect(props.update).toBe(1);
        expect(renders).toBe(1);
        this.setState({updated: true});
        expect(renders).toBe(1);
      }

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        renders++;
        return <div />;
      }
    }

    const container = document.createElement('div');
    const instance = ReactDOM.render(<Component update={0} />, container);
    expect(renders).toBe(1);
    expect(instance.state.updated).toBe(false);
    ReactDOM.render(<Component update={1} />, container);
    expect(renders).toBe(2);
    expect(instance.state.updated).toBe(true);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「only renders once if updated in componentWillReceiveProps when batching in legacy mode」描述的渲染、交互或错误处理结果。 */
  it('only renders once if updated in componentWillReceiveProps when batching in legacy mode', () => {
    let renders = 0;

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.state`：记录测试夹具在当前场景中的状态。 */
      state = {updated: false};

      /** `Component.UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps(props) {
        expect(props.update).toBe(1);
        expect(renders).toBe(1);
        this.setState({updated: true});
        expect(renders).toBe(1);
      }

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        renders++;
        return <div />;
      }
    }

    const container = document.createElement('div');
    const instance = ReactDOM.render(<Component update={0} />, container);
    expect(renders).toBe(1);
    expect(instance.state.updated).toBe(false);
    ReactDOM.unstable_batchedUpdates(() => {
      ReactDOM.render(<Component update={1} />, container);
    });
    expect(renders).toBe(2);
    expect(instance.state.updated).toBe(true);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should update refs if shouldComponentUpdate gives false in legacy mode」描述的渲染、交互或错误处理结果。 */
  it('should update refs if shouldComponentUpdate gives false in legacy mode', () => {
    /** `Static`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Static extends React.Component {
      /** `Static.shouldComponentUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      shouldComponentUpdate() {
        return false;
      }

      /** `Static.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.static0Ref`：记录测试夹具在当前场景中的状态。 */
      static0Ref = React.createRef();
      /** `Component.static1Ref`：记录测试夹具在当前场景中的状态。 */
      static1Ref = React.createRef();

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.props.flipped) {
          return (
            <div>
              <Static ref={this.static0Ref} key="B">
                B (ignored)
              </Static>
              <Static ref={this.static1Ref} key="A">
                A (ignored)
              </Static>
            </div>
          );
        } else {
          return (
            <div>
              <Static ref={this.static0Ref} key="A">
                A
              </Static>
              <Static ref={this.static1Ref} key="B">
                B
              </Static>
            </div>
          );
        }
      }
    }

    const container = document.createElement('div');
    const comp = ReactDOM.render(<Component flipped={false} />, container);
    expect(findDOMNode(comp.static0Ref.current).textContent).toBe('A');
    expect(findDOMNode(comp.static1Ref.current).textContent).toBe('B');

      // 翻转顺序时，即使实际内容未变，refs 也应更新。
    ReactDOM.render(<Component flipped={true} />, container);
    expect(findDOMNode(comp.static0Ref.current).textContent).toBe('B');
    expect(findDOMNode(comp.static1Ref.current).textContent).toBe('A');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should allow access to findDOMNode in componentWillUnmount in legacy mode」描述的渲染、交互或错误处理结果。 */
  it('should allow access to findDOMNode in componentWillUnmount in legacy mode', () => {
    let a = null;
    let b = null;

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        a = findDOMNode(this);
        expect(a).not.toBe(null);
      }

      /** `Component.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        b = findDOMNode(this);
        expect(b).not.toBe(null);
      }

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    const container = document.createElement('div');
    expect(a).toBe(container.firstChild);
    ReactDOM.render(<Component />, container);
    ReactDOM.unmountComponentAtNode(container);
    expect(a).toBe(b);
  });

  // @gate !disableLegacyContext || !__DEV__
  // @gate !disableLegacyMode
  /** 测试场景：验证「context should be passed down from the parent」描述的渲染、交互或错误处理结果。 */
  it('context should be passed down from the parent', () => {
    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.childContextTypes`：记录测试夹具在当前场景中的状态。 */
      static childContextTypes = {
        foo: PropTypes.string,
      };

      /** `Parent.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getChildContext() {
        return {
          foo: 'bar',
        };
      }

      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.contextTypes`：记录测试夹具在当前场景中的状态。 */
      static contextTypes = {
        foo: PropTypes.string.isRequired,
      };

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    const div = document.createElement('div');
    ReactDOM.render(
      <Parent>
        <Component />
      </Parent>,
      div,
    );
    assertConsoleErrorDev([
      'Parent uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
      'Component uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Component (at **)',
    ]);
  });

  /** 测试场景：验证「should replace state in legacy mode」描述的渲染、交互或错误处理结果。 */
  it('should replace state in legacy mode', async () => {
    /** `Moo`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Moo extends React.Component {
      /** `Moo.state`：记录测试夹具在当前场景中的状态。 */
      state = {x: 1};
      /** `Moo.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let moo;
    await act(() => {
      root.render(<Moo ref={current => (moo = current)} />);
    });

    // 不再是一个公开的 API。 但我们可以通过进入更新器来检测它是否内部工作.
    await act(() => {
      moo.updater.enqueueReplaceState(moo, {y: 2});
    });
    expect('x' in moo.state).toBe(false);
    expect(moo.state.y).toBe(2);
  });

  /** 测试场景：验证「should support objects with prototypes as state in legacy mode」描述的渲染、交互或错误处理结果。 */
  it('should support objects with prototypes as state in legacy mode', async () => {
    /** `NotActuallyImmutable`：封装当前用例复用的操作、回调或断言步骤。 */
    const NotActuallyImmutable = function (str) {
      this.str = str;
    };
    NotActuallyImmutable.prototype.amIImmutable = function () {
      return true;
    };
    /** `Moo`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Moo extends React.Component {
      /** `Moo.state`：记录测试夹具在当前场景中的状态。 */
      state = new NotActuallyImmutable('first');
      // 不再是一个公开的 API。 但我们可以通过进入更新器来检测它是否内部工作.
      /** `Moo._replaceState`：封装当前用例复用的操作、回调或断言步骤。 */
      _replaceState = update => this.updater.enqueueReplaceState(this, update);
      /** `Moo.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let moo;
    await act(() => {
      root.render(<Moo ref={current => (moo = current)} />);
    });

    expect(moo.state.str).toBe('first');
    expect(moo.state.amIImmutable()).toBe(true);

    const secondState = new NotActuallyImmutable('second');
    await act(() => {
      moo._replaceState(secondState);
    });
    expect(moo.state.str).toBe('second');
    expect(moo.state.amIImmutable()).toBe(true);
    expect(moo.state).toBe(secondState);

    await act(() => {
      moo.setState({str: 'third'});
    });
    expect(moo.state.str).toBe('third');
    // 我们失去了原型。
    expect(moo.state.amIImmutable).toBe(undefined);

    // 当多个状态更新被排队时， 我们有相同的实现。
    const fifthState = new NotActuallyImmutable('fifth');
    await act(() => {
      moo.setState({str: 'fourth'});
      moo._replaceState(fifthState);
    });
    expect(moo.state).toBe(fifthState);

    // 当多个状态更新被排队时， 我们有相同的实现。
    const sixthState = new NotActuallyImmutable('sixth');
    await act(() => {
      moo._replaceState(sixthState);
      moo.setState({str: 'seventh'});
    });
    expect(moo.state.str).toBe('seventh');
    expect(moo.state.amIImmutable).toBe(undefined);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「should not warn about unmounting during unmounting in legacy mode」描述的渲染、交互或错误处理结果。 */
  it('should not warn about unmounting during unmounting in legacy mode', () => {
    const container = document.createElement('div');
    const layer = document.createElement('div');

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        ReactDOM.render(<div />, layer);
      }

      /** `Component.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        ReactDOM.unmountComponentAtNode(layer);
      }

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    /** `Outer`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Outer extends React.Component {
      /** `Outer.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    ReactDOM.render(
      <Outer>
        <Component />
      </Outer>,
      container,
    );
    ReactDOM.render(<Outer />, container);
  });
});
