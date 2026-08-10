/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

// 此行为属于旧版 propTypes 系统，但实现位于核心组件协调路径，暂时没有更合适的测试归属。
// 保留在这里可显式标记该跨模块边界，后续应随实现归属调整测试位置。

'use strict';

let PropTypes;
let React;
let ReactDOMClient;
let act;
let assertConsoleErrorDev;

describe('ReactContextValidator', () => {
  beforeEach(() => {
    jest.resetModules();

    PropTypes = require('prop-types');
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));
  });

  // TODO：此行为会引入对 propTypes 的运行时依赖；应确认使用 Flow 的 ES6 class 不需要该依赖。

  // @gate !disableLegacyContext
  /**
   * Given：已建立该文件所需的 renderer、容器与测试夹具。
   * When：执行“should filter out context not in contextTypes”场景的唯一关键操作。
   * Then：断言 旧版与新版 Context 的校验、传播和诊断契约 的可观察结果。
   *
   * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
   */
  it('should filter out context not in contextTypes', async () => {
    /** 作为“should filter out context not in contextTypes”场景的组件夹具，隔离待验证的 React 行为。 */
    class Component extends React.Component {
      /** 渲染“should filter out context not in contextTypes”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div />;
      }
    }
    Component.contextTypes = {
      foo: PropTypes.string,
    };

    /** 作为“should filter out context not in contextTypes”场景的组件夹具，隔离待验证的 React 行为。 */
    class ComponentInFooBarContext extends React.Component {
      /** 保存“should filter out context not in contextTypes”场景需要跨生命周期读取的实例或宿主节点引用。 */
      childRef = React.createRef();

      /** 向后代提供“should filter out context not in contextTypes”场景使用的旧版上下文值。 */
      getChildContext() {
        return {
          foo: 'abc',
          bar: 123,
        };
      }

      /** 渲染“should filter out context not in contextTypes”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <Component ref={this.childRef} />;
      }
    }
    ComponentInFooBarContext.childContextTypes = {
      foo: PropTypes.string,
      bar: PropTypes.number,
    };

    let instance;
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <ComponentInFooBarContext ref={current => (instance = current)} />,
      );
    });
    assertConsoleErrorDev([
      'ComponentInFooBarContext uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in ComponentInFooBarContext (at **)',
      'Component uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in ComponentInFooBarContext (at **)',
    ]);
    expect(instance.childRef.current.context).toEqual({foo: 'abc'});
  });

  // @gate !disableLegacyContext
  /**
   * 场景：“should pass next context to lifecycles”。
   * 机制：验证旧版与新版 Context 的校验、传播和诊断契约，锁定可观察结果与失败边界。
   */
  it('should pass next context to lifecycles', async () => {
    let componentDidMountContext;
    let componentDidUpdateContext;
    let componentWillReceivePropsContext;
    let componentWillReceivePropsNextContext;
    let componentWillUpdateContext;
    let componentWillUpdateNextContext;
    let constructorContext;
    let renderContext;
    let shouldComponentUpdateContext;
    let shouldComponentUpdateNextContext;

    /** 作为“should pass next context to lifecycles”场景的组件夹具，隔离待验证的 React 行为。 */
    class Parent extends React.Component {
      /** 向后代提供“should pass next context to lifecycles”场景使用的旧版上下文值。 */
      getChildContext() {
        return {
          foo: this.props.foo,
          bar: 'bar',
        };
      }
      /** 渲染“should pass next context to lifecycles”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <Component />;
      }
    }
    Parent.childContextTypes = {
      foo: PropTypes.string.isRequired,
      bar: PropTypes.string.isRequired,
    };

    /** 作为“should pass next context to lifecycles”场景的组件夹具，隔离待验证的 React 行为。 */
    class Component extends React.Component {
      /** 初始化“should pass next context to lifecycles”场景所需的实例状态与观测记录。 */
      constructor(props, context) {
        super(props, context);
        constructorContext = context;
      }
      /** 记录“should pass next context to lifecycles”场景接收新属性时的旧版生命周期调用。 */
      UNSAFE_componentWillReceiveProps(nextProps, nextContext) {
        componentWillReceivePropsContext = this.context;
        componentWillReceivePropsNextContext = nextContext;
        return true;
      }
      /** 决定“should pass next context to lifecycles”场景是否继续协调，并让测试验证跳过更新的边界。 */
      shouldComponentUpdate(nextProps, nextState, nextContext) {
        shouldComponentUpdateContext = this.context;
        shouldComponentUpdateNextContext = nextContext;
        return true;
      }
      /** 记录“should pass next context to lifecycles”场景的旧版更新前生命周期调用。 */
      UNSAFE_componentWillUpdate(nextProps, nextState, nextContext) {
        componentWillUpdateContext = this.context;
        componentWillUpdateNextContext = nextContext;
      }
      /** 渲染“should pass next context to lifecycles”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        renderContext = this.context;
        return <div />;
      }
      /** 记录“should pass next context to lifecycles”场景的挂载提交，并执行仅在挂载后有效的观测。 */
      componentDidMount() {
        componentDidMountContext = this.context;
      }
      /** 记录“should pass next context to lifecycles”场景的更新提交，供生命周期顺序断言使用。 */
      componentDidUpdate() {
        componentDidUpdateContext = this.context;
      }
    }
    Component.contextTypes = {
      foo: PropTypes.string,
    };

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent foo="abc" />);
    });
    assertConsoleErrorDev([
      'Parent uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
      'Component uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in Parent (at **)',
    ]);

    expect(constructorContext).toEqual({foo: 'abc'});
    expect(renderContext).toEqual({foo: 'abc'});
    expect(componentDidMountContext).toEqual({foo: 'abc'});
    await act(() => {
      root.render(<Parent foo="def" />);
    });

    expect(componentWillReceivePropsContext).toEqual({foo: 'abc'});
    expect(componentWillReceivePropsNextContext).toEqual({foo: 'def'});
    expect(shouldComponentUpdateContext).toEqual({foo: 'abc'});
    expect(shouldComponentUpdateNextContext).toEqual({foo: 'def'});
    expect(componentWillUpdateContext).toEqual({foo: 'abc'});
    expect(componentWillUpdateNextContext).toEqual({foo: 'def'});
    expect(renderContext).toEqual({foo: 'def'});
    expect(componentDidUpdateContext).toEqual({foo: 'def'});
  });

    // TODO（bvaughn）：未来删除此测试及对应行为；Fiber 仅为兼容 Stack 的非预期行为而保留它。
  // @gate !disableLegacyContext || !__DEV__
  /**
   * 场景：“should warn (but not error) if getChildContext method is missing”。
   * 机制：验证旧版与新版 Context 的校验、传播和诊断契约，锁定可观察结果与失败边界。
   */
  it('should warn (but not error) if getChildContext method is missing', async () => {
    /** 作为“should warn (but not error) if getChildContext method is missing”场景的组件夹具，隔离待验证的 React 行为。 */
    class ComponentA extends React.Component {
      /** 声明“should warn (but not error) if getChildContext method is missing”场景消费或提供的上下文类型，用于验证上下文协议。 */
      static childContextTypes = {
        foo: PropTypes.string.isRequired,
      };
      /** 渲染“should warn (but not error) if getChildContext method is missing”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div />;
      }
    }
    /** 作为“should warn (but not error) if getChildContext method is missing”场景的组件夹具，隔离待验证的 React 行为。 */
    class ComponentB extends React.Component {
      /** 声明“should warn (but not error) if getChildContext method is missing”场景消费或提供的上下文类型，用于验证上下文协议。 */
      static childContextTypes = {
        foo: PropTypes.string.isRequired,
      };
      /** 渲染“should warn (but not error) if getChildContext method is missing”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div />;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<ComponentA />);
    });
    assertConsoleErrorDev([
      'ComponentA uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in ComponentA (at **)',
      'ComponentA.childContextTypes is specified but there is no getChildContext() method on the instance. ' +
        'You can either define getChildContext() on ComponentA or remove childContextTypes from it.\n' +
        '    in ComponentA (at **)',
    ]);

    // 警告按组件类型去重，同一类型的重复实例不能重复输出。
    await act(() => {
      root.render(<ComponentA />);
    });
    await act(() => {
      root.render(<ComponentB />);
    });
    assertConsoleErrorDev([
      'ComponentB uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in ComponentB (at **)',
      'ComponentB.childContextTypes is specified but there is no getChildContext() method on the instance. ' +
        'You can either define getChildContext() on ComponentB or remove childContextTypes from it.\n' +
        '    in ComponentB (at **)',
    ]);
  });

    // TODO（bvaughn）：未来删除此测试及对应行为；Fiber 仅为兼容 Stack 的非预期行为而保留它。
  // @gate !disableLegacyContext
  /**
   * 场景：“should pass parent context if getChildContext method is missing”。
   * 机制：验证旧版与新版 Context 的校验、传播和诊断契约，锁定可观察结果与失败边界。
   */
  it('should pass parent context if getChildContext method is missing', async () => {
    /** 作为“should pass parent context if getChildContext method is missing”场景的组件夹具，隔离待验证的 React 行为。 */
    class ParentContextProvider extends React.Component {
      /** 声明“should pass parent context if getChildContext method is missing”场景消费或提供的上下文类型，用于验证上下文协议。 */
      static childContextTypes = {
        foo: PropTypes.string,
      };
      /** 向后代提供“should pass parent context if getChildContext method is missing”场景使用的旧版上下文值。 */
      getChildContext() {
        return {
          foo: 'FOO',
        };
      }
      /** 渲染“should pass parent context if getChildContext method is missing”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <MiddleMissingContext />;
      }
    }

    /** 作为“should pass parent context if getChildContext method is missing”场景的组件夹具，隔离待验证的 React 行为。 */
    class MiddleMissingContext extends React.Component {
      /** 声明“should pass parent context if getChildContext method is missing”场景消费或提供的上下文类型，用于验证上下文协议。 */
      static childContextTypes = {
        bar: PropTypes.string.isRequired,
      };
      /** 渲染“should pass parent context if getChildContext method is missing”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <ChildContextConsumer />;
      }
    }

    let childContext;
    /** 作为“should pass parent context if getChildContext method is missing”场景的组件夹具，隔离待验证的 React 行为。 */
    class ChildContextConsumer extends React.Component {
      /** 渲染“should pass parent context if getChildContext method is missing”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        childContext = this.context;
        return <div />;
      }
    }
    ChildContextConsumer.contextTypes = {
      bar: PropTypes.string.isRequired,
      foo: PropTypes.string.isRequired,
    };

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<ParentContextProvider />);
    });
    assertConsoleErrorDev([
      'ParentContextProvider uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in ParentContextProvider (at **)',
      'MiddleMissingContext uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in ParentContextProvider (at **)',
      'MiddleMissingContext.childContextTypes is specified but there is no getChildContext() method on the instance. ' +
        'You can either define getChildContext() on MiddleMissingContext or remove childContextTypes from it.\n' +
        '    in ParentContextProvider (at **)',
      'ChildContextConsumer uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in MiddleMissingContext (at **)\n' +
        '    in ParentContextProvider (at **)',
    ]);
    expect(childContext.bar).toBeUndefined();
    expect(childContext.foo).toBe('FOO');
  });

  /**
   * 场景：“should pass next context to lifecycles on update”。
   * 机制：验证旧版与新版 Context 的校验、传播和诊断契约，锁定可观察结果与失败边界。
   */
  it('should pass next context to lifecycles on update', async () => {
    let componentDidMountContext;
    let componentDidUpdateContext;
    let componentWillReceivePropsContext;
    let componentWillReceivePropsNextContext;
    let componentWillUpdateContext;
    let componentWillUpdateNextContext;
    let constructorContext;
    let renderContext;
    let shouldComponentUpdateWasCalled = false;

    const Context = React.createContext();

    /** 作为“should pass next context to lifecycles on update”场景的组件夹具，隔离待验证的 React 行为。 */
    class Component extends React.Component {
      /** 声明“should pass next context to lifecycles on update”场景消费或提供的上下文类型，用于验证上下文协议。 */
      static contextType = Context;
      /** 初始化“should pass next context to lifecycles on update”场景所需的实例状态与观测记录。 */
      constructor(props, context) {
        super(props, context);
        constructorContext = context;
      }
      /** 记录“should pass next context to lifecycles on update”场景接收新属性时的旧版生命周期调用。 */
      UNSAFE_componentWillReceiveProps(nextProps, nextContext) {
        componentWillReceivePropsContext = this.context;
        componentWillReceivePropsNextContext = nextContext;
        return true;
      }
      /** 决定“should pass next context to lifecycles on update”场景是否继续协调，并让测试验证跳过更新的边界。 */
      shouldComponentUpdate(nextProps, nextState, nextContext) {
        shouldComponentUpdateWasCalled = true;
        return true;
      }
      /** 记录“should pass next context to lifecycles on update”场景的旧版更新前生命周期调用。 */
      UNSAFE_componentWillUpdate(nextProps, nextState, nextContext) {
        componentWillUpdateContext = this.context;
        componentWillUpdateNextContext = nextContext;
      }
      /** 渲染“should pass next context to lifecycles on update”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        renderContext = this.context;
        return <div />;
      }
      /** 记录“should pass next context to lifecycles on update”场景的挂载提交，并执行仅在挂载后有效的观测。 */
      componentDidMount() {
        componentDidMountContext = this.context;
      }
      /** 记录“should pass next context to lifecycles on update”场景的更新提交，供生命周期顺序断言使用。 */
      componentDidUpdate() {
        componentDidUpdateContext = this.context;
      }
    }

    const firstContext = {foo: 123};
    const secondContext = {bar: 456};

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <Context.Provider value={firstContext}>
          <Component />
        </Context.Provider>,
      );
    });

    expect(constructorContext).toBe(firstContext);
    expect(renderContext).toBe(firstContext);
    expect(componentDidMountContext).toBe(firstContext);
    await act(() => {
      root.render(
        <Context.Provider value={secondContext}>
          <Component />
        </Context.Provider>,
      );
    });

    expect(componentWillReceivePropsContext).toBe(firstContext);
    expect(componentWillReceivePropsNextContext).toBe(secondContext);
    expect(componentWillUpdateContext).toBe(firstContext);
    expect(componentWillUpdateNextContext).toBe(secondContext);
    expect(renderContext).toBe(secondContext);
    expect(componentDidUpdateContext).toBe(secondContext);
    expect(shouldComponentUpdateWasCalled).toBe(true);
  });

  /**
   * 场景：“should re-render PureComponents when context Provider updates”。
   * 机制：验证旧版与新版 Context 的校验、传播和诊断契约，锁定可观察结果与失败边界。
   */
  it('should re-render PureComponents when context Provider updates', async () => {
    let renderedContext;

    const Context = React.createContext();

    /** 作为“should re-render PureComponents when context Provider updates”场景的组件夹具，隔离待验证的 React 行为。 */
    class Component extends React.PureComponent {
      /** 声明“should re-render PureComponents when context Provider updates”场景消费或提供的上下文类型，用于验证上下文协议。 */
      static contextType = Context;
      /** 渲染“should re-render PureComponents when context Provider updates”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        renderedContext = this.context;
        return <div />;
      }
    }

    const firstContext = {foo: 123};
    const secondContext = {bar: 456};

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <Context.Provider value={firstContext}>
          <Component />
        </Context.Provider>,
      );
    });

    expect(renderedContext).toBe(firstContext);
    await act(() => {
      root.render(
        <Context.Provider value={secondContext}>
          <Component />
        </Context.Provider>,
      );
    });

    expect(renderedContext).toBe(secondContext);
  });

  // @gate !disableLegacyContext || !__DEV__
  /**
   * 场景：“should warn if both contextType and contextTypes are defined”。
   * 机制：验证旧版与新版 Context 的校验、传播和诊断契约，锁定可观察结果与失败边界。
   */
  it('should warn if both contextType and contextTypes are defined', async () => {
    const Context = React.createContext();

    /** 作为“should warn if both contextType and contextTypes are defined”场景的组件夹具，隔离待验证的 React 行为。 */
    class ParentContextProvider extends React.Component {
      /** 声明“should warn if both contextType and contextTypes are defined”场景消费或提供的上下文类型，用于验证上下文协议。 */
      static childContextTypes = {
        foo: PropTypes.string,
      };
      /** 向后代提供“should warn if both contextType and contextTypes are defined”场景使用的旧版上下文值。 */
      getChildContext() {
        return {
          foo: 'FOO',
        };
      }
      /** 渲染“should warn if both contextType and contextTypes are defined”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return this.props.children;
      }
    }

    /** 作为“should warn if both contextType and contextTypes are defined”场景的组件夹具，隔离待验证的 React 行为。 */
    class ComponentA extends React.Component {
      /** 声明“should warn if both contextType and contextTypes are defined”场景消费或提供的上下文类型，用于验证上下文协议。 */
      static contextTypes = {
        foo: PropTypes.string.isRequired,
      };
      /** 声明“should warn if both contextType and contextTypes are defined”场景消费或提供的上下文类型，用于验证上下文协议。 */
      static contextType = Context;
      /** 渲染“should warn if both contextType and contextTypes are defined”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div />;
      }
    }
    /** 作为“should warn if both contextType and contextTypes are defined”场景的组件夹具，隔离待验证的 React 行为。 */
    class ComponentB extends React.Component {
      /** 声明“should warn if both contextType and contextTypes are defined”场景消费或提供的上下文类型，用于验证上下文协议。 */
      static contextTypes = {
        foo: PropTypes.string.isRequired,
      };
      /** 声明“should warn if both contextType and contextTypes are defined”场景消费或提供的上下文类型，用于验证上下文协议。 */
      static contextType = Context;
      /** 渲染“should warn if both contextType and contextTypes are defined”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div />;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(
        <ParentContextProvider>
          <ComponentA />
        </ParentContextProvider>,
      );
    });

    assertConsoleErrorDev([
      'ParentContextProvider uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in ParentContextProvider (at **)',
      'ComponentA declares both contextTypes and contextType static properties. ' +
        'The legacy contextTypes property will be ignored.\n' +
        '    in ComponentA (at **)',
      'ComponentA uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in ComponentA (at **)',
    ]);

    // 警告按组件类型去重，同一类型的重复实例不能重复输出。
    await act(() => {
      root.render(
        <ParentContextProvider>
          <ComponentA />
        </ParentContextProvider>,
      );
    });

    await act(() => {
      root.render(
        <ParentContextProvider>
          <ComponentB />
        </ParentContextProvider>,
      );
    });
    assertConsoleErrorDev([
      'ComponentB declares both contextTypes and contextType static properties. ' +
        'The legacy contextTypes property will be ignored.\n' +
        '    in ComponentB (at **)',
      'ComponentB uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in ComponentB (at **)',
    ]);
  });

  /**
   * 场景：“should warn if an invalid contextType is defined”。
   * 机制：验证旧版与新版 Context 的校验、传播和诊断契约，锁定可观察结果与失败边界。
   */
  it('should warn if an invalid contextType is defined', async () => {
    const Context = React.createContext();
    /** 作为“should warn if an invalid contextType is defined”场景的组件夹具，隔离待验证的 React 行为。 */
    class ComponentA extends React.Component {
      /** 声明“should warn if an invalid contextType is defined”场景消费或提供的上下文类型，用于验证上下文协议。 */
      static contextType = Context.Consumer;
      /** 渲染“should warn if an invalid contextType is defined”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div />;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<ComponentA />);
    });
    assertConsoleErrorDev([
      'ComponentA defines an invalid contextType. ' +
        'contextType should point to the Context object returned by React.createContext(). ' +
        'Did you accidentally pass the Context.Consumer instead?\n' +
        '    in ComponentA (at **)',
    ]);

    await act(() => {
      root.render(<ComponentA />);
    });

    /** 作为“should warn if an invalid contextType is defined”场景的组件夹具，隔离待验证的 React 行为。 */
    class ComponentB extends React.Component {
      /** 声明“should warn if an invalid contextType is defined”场景消费或提供的上下文类型，用于验证上下文协议。 */
      static contextType = Context.Provider;
      /** 渲染“should warn if an invalid contextType is defined”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div />;
      }
    }
    await act(() => {
      root.render(<ComponentB />);
    });
  });

  /**
   * 场景：“should not warn when class contextType is null”。
   * 机制：验证旧版与新版 Context 的校验、传播和诊断契约，锁定可观察结果与失败边界。
   */
  it('should not warn when class contextType is null', async () => {
    /** 作为“should not warn when class contextType is null”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 声明“should not warn when class contextType is null”场景消费或提供的上下文类型，用于验证上下文协议。 */
      static contextType = null; // 便于应用按条件启用或禁用 contextType 声明。
      /** 渲染“should not warn when class contextType is null”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return this.context.hello.world;
      }
    }
    await expect(async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Foo />);
      });
    }).rejects.toThrow("Cannot read properties of undefined (reading 'world')");
  });

  /**
   * 场景：“should warn when class contextType is undefined”。
   * 机制：验证旧版与新版 Context 的校验、传播和诊断契约，锁定可观察结果与失败边界。
   */
  it('should warn when class contextType is undefined', async () => {
    /** 作为“should warn when class contextType is undefined”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
    // 循环依赖常会让组件类型在初始化完成前保持为 `undefined`。
      // https://github.com/facebook/react/issues/13969
      static contextType = undefined;
      /** 渲染“should warn when class contextType is undefined”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return this.context.hello.world;
      }
    }

    await expect(async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Foo />);
      });
    }).rejects.toThrow("Cannot read properties of undefined (reading 'world')");

    assertConsoleErrorDev([
      'Foo defines an invalid contextType. ' +
        'contextType should point to the Context object returned by React.createContext(). ' +
        'However, it is set to undefined. ' +
        'This can be caused by a typo or by mixing up named and default imports. ' +
        'This can also happen due to a circular dependency, ' +
        'so try moving the createContext() call to a separate file.\n' +
        '    in Foo (at **)',
    ]);
  });

  /**
   * 场景：“should warn when class contextType is an object”。
   * 机制：验证旧版与新版 Context 的校验、传播和诊断契约，锁定可观察结果与失败边界。
   */
  it('should warn when class contextType is an object', async () => {
    /** 作为“should warn when class contextType is an object”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
    // 拼写错误可能把预期组件解析为 `undefined`，此处锁定对应诊断。
      static contextType = {
        x: 42,
        y: 'hello',
      };
      /** 渲染“should warn when class contextType is an object”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return this.context.hello.world;
      }
    }

    await expect(async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Foo />);
      });
    }).rejects.toThrow("Cannot read properties of undefined (reading 'hello')");

    assertConsoleErrorDev([
      'Foo defines an invalid contextType. ' +
        'contextType should point to the Context object returned by React.createContext(). ' +
        'However, it is set to an object with keys {x, y}.\n' +
        '    in Foo (at **)',
    ]);
  });

  /**
   * 场景：“should warn when class contextType is a primitive”。
   * 机制：验证旧版与新版 Context 的校验、传播和诊断契约，锁定可观察结果与失败边界。
   */
  it('should warn when class contextType is a primitive', async () => {
    /** 作为“should warn when class contextType is a primitive”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 声明“should warn when class contextType is a primitive”场景消费或提供的上下文类型，用于验证上下文协议。 */
      static contextType = 'foo';
      /** 渲染“should warn when class contextType is a primitive”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return this.context.hello.world;
      }
    }

    await expect(async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Foo />);
      });
    }).rejects.toThrow("Cannot read properties of undefined (reading 'world')");

    assertConsoleErrorDev([
      'Foo defines an invalid contextType. ' +
        'contextType should point to the Context object returned by React.createContext(). ' +
        'However, it is set to a string.\n' +
        '    in Foo (at **)',
    ]);
  });

  /**
   * 场景：“should warn if you define contextType on a function component”。
   * 机制：验证旧版与新版 Context 的校验、传播和诊断契约，锁定可观察结果与失败边界。
   */
  it('should warn if you define contextType on a function component', async () => {
    const Context = React.createContext();

    /** 作为“should warn if you define contextType on a function component”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function ComponentA() {
      return <div />;
    }
    ComponentA.contextType = Context;

    /** 作为“should warn if you define contextType on a function component”场景的函数夹具，返回待协调内容或触发目标行为。 */
    function ComponentB() {
      return <div />;
    }
    ComponentB.contextType = Context;

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<ComponentA />);
    });
    assertConsoleErrorDev([
      'ComponentA: Function components do not support contextType.\n' +
        '    in ComponentA (at **)',
    ]);

    // 警告按组件类型去重，同一类型的重复实例不能重复输出。
    await act(() => {
      root.render(<ComponentA />);
    });

    await act(() => {
      root.render(<ComponentB />);
    });
    assertConsoleErrorDev([
      'ComponentB: Function components do not support contextType.\n' +
        '    in ComponentB (at **)',
    ]);
  });
});
