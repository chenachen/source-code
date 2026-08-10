/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** `ReactDOMServerIntegrationUtils`：保存当前测试场景复用的夹具、状态或回调。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

let React;
let ReactDOMServer;
let assertConsoleErrorDev;
let assertConsoleWarnDev;

/** `initModules`：封装当前用例复用的操作、回调或断言步骤。 */
function initModules() {
  // 重置警告缓存。
  jest.resetModules();
  React = require('react');
  ReactDOMServer = require('react-dom/server');
  assertConsoleErrorDev = require('internal-test-utils').assertConsoleErrorDev;
  assertConsoleWarnDev = require('internal-test-utils').assertConsoleWarnDev;

  // 让他们可以帮助.
  return {
    ReactDOMServer,
  };
}

/** `{resetModules}`：保存当前测试场景复用的夹具、状态或回调。 */
const {resetModules} = ReactDOMServerIntegrationUtils(initModules);

describe('ReactDOMServerLifecycles', () => {
  beforeEach(() => {
    resetModules();
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should invoke the correct legacy lifecycle hooks」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言覆盖 react-dom 的服务端流适配层；完整 Fizz 状态机位于 react-server。
   */
  it('should invoke the correct legacy lifecycle hooks', () => {
    const log = [];

    /** `Outer`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Outer extends React.Component {
      /** `Outer.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        log.push('outer componentWillMount');
      }
      /** `Outer.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        log.push('outer render');
        return <Inner />;
      }
    }

    /** `Inner`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Inner extends React.Component {
      /** `Inner.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        log.push('inner componentWillMount');
      }
      /** `Inner.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        log.push('inner render');
        return null;
      }
    }

    ReactDOMServer.renderToString(<Outer />);
    expect(log).toEqual([
      'outer componentWillMount',
      'outer render',
      'inner componentWillMount',
      'inner render',
    ]);
  });

  /** 测试场景：验证「should invoke the correct new lifecycle hooks」描述的渲染、交互或错误处理结果。 */
  it('should invoke the correct new lifecycle hooks', () => {
    const log = [];

    /** `Outer`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Outer extends React.Component {
      /** `Outer.state`：记录测试夹具在当前场景中的状态。 */
      state = {};
      /** `Outer.getDerivedStateFromProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromProps() {
        log.push('outer getDerivedStateFromProps');
        return null;
      }
      /** `Outer.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        log.push('outer render');
        return <Inner />;
      }
    }

    /** `Inner`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Inner extends React.Component {
      /** `Inner.state`：记录测试夹具在当前场景中的状态。 */
      state = {};
      /** `Inner.getDerivedStateFromProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromProps() {
        log.push('inner getDerivedStateFromProps');
        return null;
      }
      /** `Inner.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        log.push('inner render');
        return null;
      }
    }

    ReactDOMServer.renderToString(<Outer />);
    expect(log).toEqual([
      'outer getDerivedStateFromProps',
      'outer render',
      'inner getDerivedStateFromProps',
      'inner render',
    ]);
  });

  /** 测试场景：验证「should not invoke unsafe cWM if static gDSFP is present」描述的渲染、交互或错误处理结果。 */
  it('should not invoke unsafe cWM if static gDSFP is present', () => {
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
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    ReactDOMServer.renderToString(<Component />);
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n' +
        '\n' +
        'Component uses getDerivedStateFromProps() but also contains the following legacy lifecycles:\n' +
        '  UNSAFE_componentWillMount\n' +
        '\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in Component (at **)',
    ]);
  });

  /** 测试场景：验证「should update instance.state with value returned from getDerivedStateFromProps」描述的渲染、交互或错误处理结果。 */
  it('should update instance.state with value returned from getDerivedStateFromProps', () => {
    /** `Grandparent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Grandparent extends React.Component {
      /** `Grandparent.state`：记录测试夹具在当前场景中的状态。 */
      state = {
        foo: 'foo',
      };
      /** `Grandparent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            {`Grandparent: ${this.state.foo}`}
            <Parent />
          </div>
        );
      }
    }

    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.state`：记录测试夹具在当前场景中的状态。 */
      state = {
        bar: 'bar',
        baz: 'baz',
      };
      /** `Parent.getDerivedStateFromProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromProps(props, prevState) {
        return {
          bar: `not ${prevState.bar}`,
        };
      }
      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            {`Parent: ${this.state.bar}, ${this.state.baz}`}
            <Child />;
          </div>
        );
      }
    }

    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.state`：记录测试夹具在当前场景中的状态。 */
      state = {};
      /** `Child.getDerivedStateFromProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromProps() {
        return {
          qux: 'qux',
        };
      }
      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return `Child: ${this.state.qux}`;
      }
    }

    const markup = ReactDOMServer.renderToString(<Grandparent />);
    expect(markup).toContain('Grandparent: foo');
    expect(markup).toContain('Parent: not bar, baz');
    expect(markup).toContain('Child: qux');
  });

  /** 测试场景：验证「should warn if getDerivedStateFromProps returns undefined」描述的渲染、交互或错误处理结果。 */
  it('should warn if getDerivedStateFromProps returns undefined', () => {
    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.state`：记录测试夹具在当前场景中的状态。 */
      state = {};
      /** `Component.getDerivedStateFromProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromProps() {}
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    ReactDOMServer.renderToString(<Component />);
    assertConsoleErrorDev([
      'Component.getDerivedStateFromProps(): A valid state object (or null) must ' +
        'be returned. You have returned undefined.\n' +
        '    in Component (at **)',
    ]);

    // 去重
    ReactDOMServer.renderToString(<Component />);
  });

  /** 测试场景：验证「should warn if state is not initialized before getDerivedStateFromProps」描述的渲染、交互或错误处理结果。 */
  it('should warn if state is not initialized before getDerivedStateFromProps', () => {
    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.getDerivedStateFromProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromProps() {
        return null;
      }
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    ReactDOMServer.renderToString(<Component />);
    assertConsoleErrorDev([
      '`Component` uses `getDerivedStateFromProps` but its initial state is ' +
        'undefined. This is not recommended. Instead, define the initial state by ' +
        'assigning an object to `this.state` in the constructor of `Component`. ' +
        'This ensures that `getDerivedStateFromProps` arguments have a consistent shape.\n' +
        '    in Component (at **)',
    ]);

    // 去重
    ReactDOMServer.renderToString(<Component />);
  });

  /** 测试场景：验证「should invoke both deprecated and new lifecycles if both are present」描述的渲染、交互或错误处理结果。 */
  it('should invoke both deprecated and new lifecycles if both are present', () => {
    const log = [];

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillMount() {
        log.push('componentWillMount');
      }
      /** `Component.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        log.push('UNSAFE_componentWillMount');
      }
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    ReactDOMServer.renderToString(<Component />);
    assertConsoleWarnDev([
      'componentWillMount has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n' +
        '\n' +
        '* Move code from componentWillMount to componentDidMount (preferred in most cases) or the constructor.\n' +
        '\n' +
        'Please update the following components: Component\n' +
        '    in Component (at **)',
    ]);
    expect(log).toEqual(['componentWillMount', 'UNSAFE_componentWillMount']);
  });

  /** 测试场景：验证「tracks state updates across components」描述的渲染、交互或错误处理结果。 */
  it('tracks state updates across components', () => {
    /** `Outer`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Outer extends React.Component {
      /** `Outer.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        this.setState({x: 1});
      }
      /** `Outer.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <Inner updateParent={this.updateParent}>{this.state.x}</Inner>;
      }
      /** `Outer.updateParent`：封装当前用例复用的操作、回调或断言步骤。 */
      updateParent = () => {
        this.setState({x: 3});
      };
    }
    /** `Inner`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Inner extends React.Component {
      /** `Inner.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        this.setState({x: 2});
        this.props.updateParent();
      }
      /** `Inner.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.props.children + '-' + this.state.x}</div>;
      }
    }
    // 应该不是1-3,
    expect(ReactDOMServer.renderToStaticMarkup(<Outer />)).toBe(
      '<div>1-2</div>',
    );
    assertConsoleErrorDev([
      'Can only update a mounting component. This ' +
        'usually means you called setState() outside componentWillMount() on ' +
        'the server. This is a no-op.\n\n' +
        'Please check the code for the Outer component.\n' +
        '    in Outer (at **)',
    ]);
  });

  /** 测试场景：验证「should not invoke cWM if static gDSFP is present」描述的渲染、交互或错误处理结果。 */
  it('should not invoke cWM if static gDSFP is present', () => {
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
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    ReactDOMServer.renderToString(<Component />);
    assertConsoleErrorDev([
      'Unsafe legacy lifecycles will not be called for components using new component APIs.\n' +
        '\n' +
        'Component uses getDerivedStateFromProps() but also contains the following legacy lifecycles:\n' +
        '  componentWillMount\n' +
        '\n' +
        'The above lifecycles should be removed. Learn more about this warning here:\n' +
        'https://react.dev/link/unsafe-component-lifecycles\n' +
        '    in Component (at **)',
    ]);
  });

  /** 测试场景：验证「should warn about deprecated lifecycle hooks」描述的渲染、交互或错误处理结果。 */
  it('should warn about deprecated lifecycle hooks', () => {
    /** `MyComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class MyComponent extends React.Component {
      /** `MyComponent.componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillMount() {}
      /** `MyComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }

    ReactDOMServer.renderToString(<MyComponent />);
    assertConsoleWarnDev([
      'componentWillMount has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n' +
        '\n' +
        '* Move code from componentWillMount to componentDidMount (preferred in most cases) or the constructor.\n' +
        '\n' +
        'Please update the following components: MyComponent\n' +
        '    in MyComponent (at **)',
    ]);

    // 去重
    ReactDOMServer.renderToString(<MyComponent />);
  });

  describe('react-lifecycles-compat', () => {
    const {polyfill} = require('react-lifecycles-compat');

    /** 测试场景：验证「should not warn for components with polyfilled getDerivedStateFromProps」描述的渲染、交互或错误处理结果。 */
    it('should not warn for components with polyfilled getDerivedStateFromProps', () => {
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

      const container = document.createElement('div');
      ReactDOMServer.renderToString(
        <React.StrictMode>
          <PolyfilledComponent />
        </React.StrictMode>,
        container,
      );
    });

    /** 测试场景：验证「should not warn for components with polyfilled getSnapshotBeforeUpdate」描述的渲染、交互或错误处理结果。 */
    it('should not warn for components with polyfilled getSnapshotBeforeUpdate', () => {
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

      const container = document.createElement('div');
      ReactDOMServer.renderToString(
        <React.StrictMode>
          <PolyfilledComponent />
        </React.StrictMode>,
        container,
      );
    });
  });
});
