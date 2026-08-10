/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let ChildUpdates;
let MorphingComponent;
let React;
let ReactDOM;
let ReactDOMClient;
let ReactSharedInternals;
let Scheduler;
let assertLog;
let act;
let assertConsoleErrorDev;

describe('ReactCompositeComponent', () => {
  const hasOwnProperty = Object.prototype.hasOwnProperty;

  /**
   * 通过迭代对象的键并返回 false 来比较两个对象，当任何键的值不严格相等时。 当所有键的值都严格相
   * 等时返回 true。
   */
  function shallowEqual(objA: mixed, objB: mixed): boolean {
    if (Object.is(objA, objB)) {
      return true;
    }
    if (
      typeof objA !== 'object' ||
      objA === null ||
      typeof objB !== 'object' ||
      objB === null
    ) {
      return false;
    }
    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);
    if (keysA.length !== keysB.length) {
      return false;
    }
    for (let i = 0; i < keysA.length; i++) {
      if (
        !hasOwnProperty.call(objB, keysA[i]) ||
        !Object.is(objA[keysA[i]], objB[keysA[i]])
      ) {
        return false;
      }
    }
    return true;
  }

  /** `shallowCompare`：封装当前用例复用的操作、回调或断言步骤。 */
  function shallowCompare(instance, nextProps, nextState) {
    return (
      !shallowEqual(instance.props, nextProps) ||
      !shallowEqual(instance.state, nextState)
    );
  }

  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ReactSharedInternals =
      require('react').__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    Scheduler = require('scheduler');
    assertLog = require('internal-test-utils').assertLog;
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));
  });

  describe('MorphingComponent', () => {
    let instance;
    let childInstance;

    beforeEach(() => {
      MorphingComponent = class extends React.Component {
        /** `state`：记录测试夹具在当前场景中的状态。 */
        state = {activated: false};
        /** `xRef`：记录测试夹具在当前场景中的状态。 */
        xRef = React.createRef();

        /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
        componentDidMount() {
          instance = this;
        }

        /** `_toggleActivatedState`：封装当前用例复用的操作、回调或断言步骤。 */
        _toggleActivatedState = () => {
          this.setState({activated: !this.state.activated});
        };

        /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          const toggleActivatedState = this._toggleActivatedState;
          return !this.state.activated ? (
            <a ref={this.xRef} onClick={toggleActivatedState} />
          ) : (
            <b ref={this.xRef} onClick={toggleActivatedState} />
          );
        }
      };

      /**
       * 我们将使用此功能以确保当它再次分配时，旧版本不会被缓存。
       */
      ChildUpdates = class extends React.Component {
        /** `anchorRef`：记录测试夹具在当前场景中的状态。 */
        anchorRef = React.createRef();

        /** `componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
        componentDidMount() {
          childInstance = this;
        }

        /** `getAnchor`：封装当前用例复用的操作、回调或断言步骤。 */
        getAnchor = () => {
          return this.anchorRef.current;
        };

        /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          const className = this.props.anchorClassOn ? 'anchorClass' : '';
          return this.props.renderAnchor ? (
            <a ref={this.anchorRef} className={className} />
          ) : (
            <b />
          );
        }
      };
    });
    /**
     * 代表场景（Given–When–Then）：
     * Given 当前文件已建立所需 DOM、React 根与测试夹具；
     * When 执行「should support rendering to different child types over time」描述的渲染或交互；
     * Then 通过本用例的 DOM、日志或调度断言确认行为。
     *
     * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
     */
    it('should support rendering to different child types over time', async () => {
      const root = ReactDOMClient.createRoot(document.createElement('div'));
      await act(() => {
        root.render(<MorphingComponent />);
      });
      expect(instance.xRef.current.tagName).toBe('A');

      await act(() => {
        instance._toggleActivatedState();
      });
      expect(instance.xRef.current.tagName).toBe('B');

      await act(() => {
        instance._toggleActivatedState();
      });
      expect(instance.xRef.current.tagName).toBe('A');
    });

    /** 测试场景：验证「should react to state changes from callbacks」描述的渲染、交互或错误处理结果。 */
    it('should react to state changes from callbacks', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      try {
        await act(() => {
          root.render(<MorphingComponent />);
        });
        expect(instance.xRef.current.tagName).toBe('A');
        await act(() => {
          instance.xRef.current.click();
        });
        expect(instance.xRef.current.tagName).toBe('B');
      } finally {
        document.body.removeChild(container);
        root.unmount();
      }
    });

    /** 测试场景：验证「should rewire refs when rendering to different child types」描述的渲染、交互或错误处理结果。 */
    it('should rewire refs when rendering to different child types', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<MorphingComponent />);
      });
      expect(instance.xRef.current.tagName).toBe('A');

      await act(() => {
        instance._toggleActivatedState();
      });
      expect(instance.xRef.current.tagName).toBe('B');

      await act(() => {
        instance._toggleActivatedState();
      });
      expect(instance.xRef.current.tagName).toBe('A');
    });

    /** 测试场景：验证「should not cache old DOM nodes when switching constructors」描述的渲染、交互或错误处理结果。 */
    it('should not cache old DOM nodes when switching constructors', async () => {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<ChildUpdates renderAnchor={true} anchorClassOn={false} />);
      });
      await act(() => {
        root.render(
          // 热任何缓存
          <ChildUpdates renderAnchor={true} anchorClassOn={true} />,
        );
      });
      await act(() => {
        root.render(
          // 清除.
          <ChildUpdates renderAnchor={false} anchorClassOn={true} />,
        );
      });
      await act(() => {
        root.render(
          // 重新渲染
          <ChildUpdates renderAnchor={true} anchorClassOn={false} />,
        );
      });
      expect(childInstance.getAnchor().className).toBe('');
    });
  });

  /** 测试场景：验证「should not support module pattern components」描述的渲染、交互或错误处理结果。 */
  it('should not support module pattern components', async () => {
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({test}) {
      return {
        /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <div>{test}</div>;
        },
      };
    }

    const el = document.createElement('div');
    const root = ReactDOMClient.createRoot(el);
    await expect(async () => {
      await act(() => {
        root.render(<Child test="test" />);
      });
    }).rejects.toThrow(
      'Objects are not valid as a React child (found: object with keys {render}).',
    );

    expect(el.textContent).toBe('');
  });

  /** 测试场景：验证「should use default values for undefined props」描述的渲染、交互或错误处理结果。 */
  it('should use default values for undefined props', async () => {
    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.defaultProps`：记录测试夹具在当前场景中的状态。 */
      static defaultProps = {prop: 'testKey'};

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <span />;
      }
    }

    /** `refFn1`：封装当前用例复用的操作、回调或断言步骤。 */
    function refFn1(ref) {
      instance1 = ref;
    }

    /** `refFn2`：封装当前用例复用的操作、回调或断言步骤。 */
    function refFn2(ref) {
      instance2 = ref;
    }

    /** `refFn3`：封装当前用例复用的操作、回调或断言步骤。 */
    function refFn3(ref) {
      instance3 = ref;
    }

    let instance1;
    let instance2;
    let instance3;
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Component ref={refFn1} />);
    });
    expect(instance1.props).toEqual({prop: 'testKey'});

    await act(() => {
      root.render(<Component ref={refFn2} prop={undefined} />);
    });
    expect(instance2.props).toEqual({prop: 'testKey'});

    await act(() => {
      root.render(<Component ref={refFn3} prop={null} />);
    });
    expect(instance3.props).toEqual({prop: null});
  });

  /** 测试场景：验证「should not mutate passed-in props object」描述的渲染、交互或错误处理结果。 */
  it('should not mutate passed-in props object', async () => {
    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.defaultProps`：记录测试夹具在当前场景中的状态。 */
      static defaultProps = {prop: 'testKey'};

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <span />;
      }
    }

    const inputProps = {};
    let instance1;
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Component {...inputProps} ref={ref => (instance1 = ref)} />);
    });
    expect(instance1.props.prop).toBe('testKey');

    // 我们不对输入进行修改。 为了在使用它来实例化组件后，让调用者做一些事情。
    expect(inputProps.prop).not.toBeDefined();
  });

  /** 测试场景：验证「should warn about `forceUpdate` on not-yet-mounted components」描述的渲染、交互或错误处理结果。 */
  it('should warn about `forceUpdate` on not-yet-mounted components', async () => {
    /** `MyComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class MyComponent extends React.Component {
      /** `MyComponent.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        this.forceUpdate();
      }
      /** `MyComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>foo</div>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    ReactDOM.flushSync(() => {
      root.render(<MyComponent />);
    });
    assertConsoleErrorDev([
      "Can't call forceUpdate on a component that is not yet mounted. " +
        'This is a no-op, but it might indicate a bug in your application. ' +
        'Instead, assign to `this.state` directly or define a `state = {};` ' +
        'class property with the desired state in the MyComponent component.\n' +
        '    in MyComponent (at **)',
    ]);

    // 不应记录任何额外的警告。
    const container2 = document.createElement('div');
    const root2 = ReactDOMClient.createRoot(container2);
    await act(() => {
      root2.render(<MyComponent />);
    });
    expect(container2.firstChild.textContent).toBe('foo');
  });

  /** 测试场景：验证「should warn about `setState` on not-yet-mounted components」描述的渲染、交互或错误处理结果。 */
  it('should warn about `setState` on not-yet-mounted components', async () => {
    /** `MyComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class MyComponent extends React.Component {
      /** `MyComponent.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        this.setState();
      }
      /** `MyComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>foo</div>;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    ReactDOM.flushSync(() => {
      root.render(<MyComponent />);
    });
    assertConsoleErrorDev([
      "Can't call setState on a component that is not yet mounted. " +
        'This is a no-op, but it might indicate a bug in your application. ' +
        'Instead, assign to `this.state` directly or define a `state = {};` ' +
        'class property with the desired state in the MyComponent component.\n' +
        '    in MyComponent (at **)',
    ]);

    // 不应记录任何额外的警告。
    const container2 = document.createElement('div');
    const root2 = ReactDOMClient.createRoot(container2);
    await act(() => {
      root2.render(<MyComponent />);
    });
    expect(container2.firstChild.textContent).toBe('foo');
  });

  /** 测试场景：验证「should not warn about `forceUpdate` on unmounted components」描述的渲染、交互或错误处理结果。 */
  it('should not warn about `forceUpdate` on unmounted components', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    let instance;
    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        instance = this;
      }

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    const component = <Component />;
    expect(component.forceUpdate).not.toBeDefined();
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(component);
    });

    instance.forceUpdate();

    root.unmount(container);

    instance.forceUpdate();
    instance.forceUpdate();
  });

  /** 测试场景：验证「should not warn about `setState` on unmounted components」描述的渲染、交互或错误处理结果。 */
  it('should not warn about `setState` on unmounted components', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.state`：记录测试夹具在当前场景中的状态。 */
      state = {value: 0};

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        Scheduler.log('render ' + this.state.value);
        return <div />;
      }
    }

    let ref;
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <div>
          <span>
            <Component ref={c => (ref = c || ref)} />
          </span>
        </div>,
      );
    });

    assertLog(['render 0']);

    await act(() => {
      ref.setState({value: 1});
    });
    assertLog(['render 1']);

    await act(() => {
      root.render(<div />);
    });

    await act(() => {
      ref.setState({value: 2});
    });
      // 对已经卸载的组件调用 setState 是空操作。
    assertLog([]);
  });

  /** 测试场景：验证「should silently allow `setState`, not call cb on unmounting components」描述的渲染、交互或错误处理结果。 */
  it('should silently allow `setState`, not call cb on unmounting components', async () => {
    let cbCalled = false;
    const container = document.createElement('div');
    document.body.appendChild(container);

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.state`：记录测试夹具在当前场景中的状态。 */
      state = {value: 0};

      /** `Component.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        expect(() => {
          this.setState({value: 2}, function () {
            cbCalled = true;
          });
        }).not.toThrow();
      }

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }
    let instance;
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component ref={c => (instance = c)} />);
    });
    await act(() => {
      instance.setState({value: 1});
    });
    instance.setState({value: 1});

    root.unmount();
    expect(cbCalled).toBe(false);
  });

  /** 测试场景：验证「should warn when rendering a class with a render method that does not extend React.Component」描述的渲染、交互或错误处理结果。 */
  it('should warn when rendering a class with a render method that does not extend React.Component', async () => {
    const container = document.createElement('div');
    /** `ClassWithRenderNotExtended`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ClassWithRenderNotExtended {
      /** `ClassWithRenderNotExtended.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }
    const root = ReactDOMClient.createRoot(container);
    await expect(async () => {
      await act(() => {
        root.render(<ClassWithRenderNotExtended />);
      });
    }).rejects.toThrow(TypeError);
    assertConsoleErrorDev([
      'The <ClassWithRenderNotExtended /> component appears to have a render method, ' +
        "but doesn't extend React.Component. This is likely to cause errors. " +
        'Change ClassWithRenderNotExtended to extend React.Component instead.\n' +
        '    in ClassWithRenderNotExtended (at **)',
    ]);

    // 测试去重逻辑。
    await expect(async () => {
      await act(() => {
        root.render(<ClassWithRenderNotExtended />);
      });
    }).rejects.toThrow(TypeError);
  });

  /** 测试场景：验证「should warn about `setState` in render」描述的渲染、交互或错误处理结果。 */
  it('should warn about `setState` in render', async () => {
    const container = document.createElement('div');

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.state`：记录测试夹具在当前场景中的状态。 */
      state = {value: 0};

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        Scheduler.log('render ' + this.state.value);
        if (this.state.value === 0) {
          this.setState({value: 1});
        }
        return <div>foo {this.state.value}</div>;
      }
    }

    let instance;
    const root = ReactDOMClient.createRoot(container);
    ReactDOM.flushSync(() => {
      root.render(<Component ref={ref => (instance = ref)} />);
    });
    assertConsoleErrorDev([
      'Cannot update during an existing state transition (such as within ' +
        '`render`). Render methods should be a pure function of props and state.\n' +
        '    in Component (at **)',
    ]);

    // 设置状态调用是排队,然后作为第二次传递执行. 这种行为是undefined 虽然所以我们可以自由地改变它,
    // 以适应实现细节.
    assertLog(['render 0', 'render 1']);
    expect(instance.state.value).toBe(1);

    // 强制任何地方重渲染都会导致更新发生。
    await act(() => {
      root.render(<Component prop={123} />);
    });
    assertLog(['render 1']);
  });

  /** 测试场景：验证「should cleanup even if render() fatals」描述的渲染、交互或错误处理结果。 */
  it('should cleanup even if render() fatals', async () => {
    const ownerEnabled = __DEV__;

    let stashedDispatcher;
    /** `BadComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class BadComponent extends React.Component {
      /** `BadComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
    // 保存渲染期间可用的 dispatcher，以便检查其内部状态也已重置。
        stashedDispatcher = ReactSharedInternals.A;
        throw new Error();
      }
    }

    const instance = <BadComponent />;
    expect(ReactSharedInternals.A).toBe(null);

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await expect(async () => {
      await act(() => {
        root.render(instance);
      });
    }).rejects.toThrow();

    expect(ReactSharedInternals.A).toBe(null);
    if (ownerEnabled) {
      expect(stashedDispatcher.getOwner()).toBe(null);
    } else {
      expect(stashedDispatcher.getOwner).toBe(undefined);
    }
  });

  /** 测试场景：验证「should call componentWillUnmount before unmounting」描述的渲染、交互或错误处理结果。 */
  it('should call componentWillUnmount before unmounting', async () => {
    const container = document.createElement('div');
    let innerUnmounted = false;

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            <Inner />
            Text
          </div>
        );
      }
    }

    /** `Inner`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Inner extends React.Component {
      /** `Inner.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        innerUnmounted = true;
      }

      /** `Inner.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component />);
    });
    root.unmount();
    expect(innerUnmounted).toBe(true);
  });

  /** 测试场景：验证「should warn when shouldComponentUpdate() returns undefined」描述的渲染、交互或错误处理结果。 */
  it('should warn when shouldComponentUpdate() returns undefined', async () => {
    /** `ClassComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ClassComponent extends React.Component {
      /** `ClassComponent.state`：记录测试夹具在当前场景中的状态。 */
      state = {bogus: false};

      /** `ClassComponent.shouldComponentUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      shouldComponentUpdate() {
        return undefined;
      }

      /** `ClassComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }
    let instance;
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<ClassComponent ref={ref => (instance = ref)} />);
    });

    ReactDOM.flushSync(() => {
      instance.setState({bogus: true});
    });
    assertConsoleErrorDev([
      'ClassComponent.shouldComponentUpdate(): Returned undefined instead of a ' +
        'boolean value. Make sure to return true or false.\n' +
        '    in ClassComponent (at **)',
    ]);
  });

  /** 测试场景：验证「should warn when componentDidUnmount method is defined」描述的渲染、交互或错误处理结果。 */
  it('should warn when componentDidUnmount method is defined', async () => {
    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.componentDidUnmount`：封装当前用例复用的操作、回调或断言步骤。 */
      componentDidUnmount = () => {};

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    ReactDOM.flushSync(() => {
      root.render(<Component />);
    });
    assertConsoleErrorDev([
      'Component has a method called ' +
        'componentDidUnmount(). But there is no such lifecycle method. ' +
        'Did you mean componentWillUnmount()?\n' +
        '    in Component (at **)',
    ]);
  });

  /** 测试场景：验证「should warn when componentDidReceiveProps method is defined」描述的渲染、交互或错误处理结果。 */
  it('should warn when componentDidReceiveProps method is defined', () => {
    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.componentDidReceiveProps`：封装当前用例复用的操作、回调或断言步骤。 */
      componentDidReceiveProps = () => {};

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));

    ReactDOM.flushSync(() => {
      root.render(<Component />);
    });
    assertConsoleErrorDev([
      'Component has a method called ' +
        'componentDidReceiveProps(). But there is no such lifecycle method. ' +
        'If you meant to update the state in response to changing props, ' +
        'use componentWillReceiveProps(). If you meant to fetch data or ' +
        'run side-effects or mutations after React has updated the UI, use componentDidUpdate().\n' +
        '    in Component (at **)',
    ]);
  });

  /** 测试场景：验证「should warn when defaultProps was defined as an instance property」描述的渲染、交互或错误处理结果。 */
  it('should warn when defaultProps was defined as an instance property', () => {
    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        this.defaultProps = {name: 'Abhay'};
      }

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }
    const root = ReactDOMClient.createRoot(document.createElement('div'));

    ReactDOM.flushSync(() => {
      root.render(<Component />);
    });
    assertConsoleErrorDev([
      'Setting defaultProps as an instance property on Component is not supported ' +
        'and will be ignored. Instead, define defaultProps as a static property on Component.\n' +
        '    in Component (at **)',
    ]);
  });

  /** 测试场景：验证「should skip update when rerendering element in container」描述的渲染、交互或错误处理结果。 */
  it('should skip update when rerendering element in container', async () => {
    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.props.children}</div>;
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
    const child = <Child />;
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent>{child}</Parent>);
    });
    assertLog(['Child render']);

    await act(() => {
      root.render(<Parent>{child}</Parent>);
    });
    assertLog([]);
  });

  /** 测试场景：验证「should disallow nested render calls」描述的渲染、交互或错误处理结果。 */
  it('should disallow nested render calls', () => {
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    /** `Inner`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Inner extends React.Component {
      /** `Inner.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    /** `Outer`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Outer extends React.Component {
      /** `Outer.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        root.render(<Inner />);
        return <div />;
      }
    }

    ReactDOM.flushSync(() => {
      root.render(<Outer />);
    });
    assertConsoleErrorDev([
      'Render methods should be a pure function of props and state; ' +
        'triggering nested component updates from render is not allowed. If ' +
        'necessary, trigger nested updates in componentDidUpdate.\n\n' +
        'Check the render method of Outer.\n' +
        '    in Outer (at **)',
    ]);
  });

  /** 测试场景：验证「only renders once if updated in componentWillReceiveProps」描述的渲染、交互或错误处理结果。 */
  it('only renders once if updated in componentWillReceiveProps', async () => {
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
    const root = ReactDOMClient.createRoot(container);
    let instance;

    await act(() => {
      root.render(<Component update={0} ref={ref => (instance = ref)} />);
    });
    expect(renders).toBe(1);
    expect(instance.state.updated).toBe(false);

    await act(() => {
      root.render(<Component update={1} ref={ref => (instance = ref)} />);
    });
    expect(renders).toBe(2);
    expect(instance.state.updated).toBe(true);
  });

  /** 测试场景：验证「only renders once if updated in componentWillReceiveProps when batching」描述的渲染、交互或错误处理结果。 */
  it('only renders once if updated in componentWillReceiveProps when batching', async () => {
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
    const root = ReactDOMClient.createRoot(container);
    let instance;
    await act(() => {
      root.render(<Component update={0} ref={ref => (instance = ref)} />);
    });
    expect(renders).toBe(1);
    expect(instance.state.updated).toBe(false);
    await act(() => {
      root.render(<Component update={1} ref={ref => (instance = ref)} />);
    });
    expect(renders).toBe(2);
    expect(instance.state.updated).toBe(true);
  });

  /** 测试场景：验证「should warn when mutated props are passed」描述的渲染、交互或错误处理结果。 */
  it('should warn when mutated props are passed', async () => {
    const container = document.createElement('div');

    /** `Foo`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Foo extends React.Component {
      /** `Foo.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        const _props = {idx: props.idx + '!'};
        super(_props);
      }

      /** `Foo.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <span />;
      }
    }

    const root = ReactDOMClient.createRoot(container);
    ReactDOM.flushSync(() => {
      root.render(<Foo idx="qwe" />);
    });
    assertConsoleErrorDev([
      'When calling super() in `Foo`, make sure to pass ' +
        "up the same props that your component's constructor was passed.\n" +
        '    in Foo (at **)',
    ]);
  });

  /** 测试场景：验证「should only call componentWillUnmount once」描述的渲染、交互或错误处理结果。 */
  it('should only call componentWillUnmount once', async () => {
    let app;
    let count = 0;

    /** `App`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class App extends React.Component {
      /** `App.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.props.stage === 1) {
          return <UnunmountableComponent />;
        } else {
          return null;
        }
      }
    }

    /** `UnunmountableComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class UnunmountableComponent extends React.Component {
      /** `UnunmountableComponent.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        app.setState({});
        count++;
        throw Error('always fails');
      }

      /** `UnunmountableComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>Hello {this.props.name}</div>;
      }
    }

    const container = document.createElement('div');

    /** `setRef`：封装当前用例复用的操作、回调或断言步骤。 */
    const setRef = ref => {
      if (ref) {
        app = ref;
      }
    };

    const root = ReactDOMClient.createRoot(container);
    await expect(async () => {
      await act(() => {
        root.render(<App ref={setRef} stage={1} />);
      });
      await act(() => {
        root.render(<App ref={setRef} stage={2} />);
      });
    }).rejects.toThrow();
    expect(count).toBe(1);
  });

  /** 测试场景：验证「prepares new child before unmounting old」描述的渲染、交互或错误处理结果。 */
  it('prepares new child before unmounting old', async () => {
    /** `Spy`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Spy extends React.Component {
      /** `Spy.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        Scheduler.log(this.props.name + ' componentWillMount');
      }
      /** `Spy.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        Scheduler.log(this.props.name + ' render');
        return <div />;
      }
      /** `Spy.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        Scheduler.log(this.props.name + ' componentDidMount');
      }
      /** `Spy.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        Scheduler.log(this.props.name + ' componentWillUnmount');
      }
    }

    /** `Wrapper`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Wrapper extends React.Component {
      /** `Wrapper.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <Spy key={this.props.name} name={this.props.name} />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Wrapper name="A" />);
    });

    assertLog(['A componentWillMount', 'A render', 'A componentDidMount']);
    await act(() => {
      root.render(<Wrapper name="B" />);
    });

    assertLog([
      'B componentWillMount',
      'B render',
      'A componentWillUnmount',
      'B componentDidMount',
    ]);
  });

  /** 测试场景：验证「respects a shallow shouldComponentUpdate implementation」描述的渲染、交互或错误处理结果。 */
  it('respects a shallow shouldComponentUpdate implementation', async () => {
    /** `PlasticWrap`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class PlasticWrap extends React.Component {
      /** `PlasticWrap.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props, context) {
        super(props, context);
        this.state = {
          color: 'green',
        };
        this.appleRef = React.createRef();
      }

      /** `PlasticWrap.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <Apple color={this.state.color} ref={this.appleRef} />;
      }
    }

    /** `Apple`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Apple extends React.Component {
      /** `Apple.state`：记录测试夹具在当前场景中的状态。 */
      state = {
        cut: false,
        slices: 1,
      };

      /** `Apple.shouldComponentUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      shouldComponentUpdate(nextProps, nextState) {
        return shallowCompare(this, nextProps, nextState);
      }

      /** `Apple.cut`：实现测试夹具的生命周期、渲染或交互步骤。 */
      cut() {
        this.setState({
          cut: true,
          slices: 10,
        });
      }

      /** `Apple.eatSlice`：实现测试夹具的生命周期、渲染或交互步骤。 */
      eatSlice() {
        this.setState({
          slices: this.state.slices - 1,
        });
      }

      /** `Apple.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        const {color} = this.props;
        const {cut, slices} = this.state;

        Scheduler.log(`${color} ${cut} ${slices}`);
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let instance;
    await act(() => {
      root.render(<PlasticWrap ref={ref => (instance = ref)} />);
    });
    assertLog(['green false 1']);

    // 不要基于 props 重新渲染
    await act(() => {
      instance.setState({color: 'green'});
    });
    assertLog([]);

    // 基于 props 重新渲染
    await act(() => {
      instance.setState({color: 'red'});
    });
    assertLog(['red false 1']);

    // 基于状态重新渲染
    await act(() => {
      instance.appleRef.current.cut();
    });
    assertLog(['red true 10']);

    // 基于状态不重新渲染
    await act(() => {
      instance.appleRef.current.cut();
    });
    assertLog([]);

    // 重新渲染基于状态
    await act(() => {
      instance.appleRef.current.eatSlice();
    });
    assertLog(['red true 9']);
  });

  /** 测试场景：验证「does not do a deep comparison for a shallow shouldComponentUpdate implementation」描述的渲染、交互或错误处理结果。 */
  it('does not do a deep comparison for a shallow shouldComponentUpdate implementation', async () => {
    /** `getInitialState`：封装当前用例复用的操作、回调或断言步骤。 */
    function getInitialState() {
      return {
        foo: [1, 2, 3],
        bar: {a: 4, b: 5, c: 6},
      };
    }

    const initialSettings = getInitialState();

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.state`：记录测试夹具在当前场景中的状态。 */
      state = initialSettings;

      /** `Component.shouldComponentUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      shouldComponentUpdate(nextProps, nextState) {
        return shallowCompare(this, nextProps, nextState);
      }

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        const {foo, bar} = this.state;
        Scheduler.log(`{foo:[${foo}],bar:{a:${bar.a},b:${bar.b},c:${bar.c}}`);
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let instance;
    await act(() => {
      root.render(<Component ref={ref => (instance = ref)} />);
    });
    assertLog(['{foo:[1,2,3],bar:{a:4,b:5,c:6}']);

    // 不要重新渲染，如果状态相等
    const settings = {
      foo: initialSettings.foo,
      bar: initialSettings.bar,
    };
    await act(() => {
      instance.setState(settings);
    });
    assertLog([]);

    // 重新渲染因为有一个字段发生变化。
    initialSettings.foo = [1, 2, 3];
    await act(() => {
      instance.setState(initialSettings);
    });
    assertLog(['{foo:[1,2,3],bar:{a:4,b:5,c:6}']);

    // 重新渲染因为对象改变了
    await act(() => {
      instance.setState(getInitialState());
    });
    assertLog(['{foo:[1,2,3],bar:{a:4,b:5,c:6}']);
  });

  /** 测试场景：验证「should call setState callback with no arguments」描述的渲染、交互或错误处理结果。 */
  it('should call setState callback with no arguments', async () => {
    let mockArgs;
    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        this.setState({}, (...args) => (mockArgs = args));
      }
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return false;
      }
    }
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Component />);
    });

    expect(mockArgs.length).toEqual(0);
  });

  /** 测试场景：验证「this.state should be updated on setState callback inside componentWillMount」描述的渲染、交互或错误处理结果。 */
  it('this.state should be updated on setState callback inside componentWillMount', async () => {
    const div = document.createElement('div');
    let stateSuccessfullyUpdated = false;

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props, context) {
        super(props, context);
        this.state = {
          hasUpdatedState: false,
        };
      }

      /** `Component.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        this.setState(
          {hasUpdatedState: true},
          () => (stateSuccessfullyUpdated = this.state.hasUpdatedState),
        );
      }

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    const root = ReactDOMClient.createRoot(div);
    await act(() => {
      root.render(<Component />);
    });

    expect(stateSuccessfullyUpdated).toBe(true);
  });

  /** 测试场景：验证「should call the setState callback even if shouldComponentUpdate = false」描述的渲染、交互或错误处理结果。 */
  it('should call the setState callback even if shouldComponentUpdate = false', async () => {
    const mockFn = jest.fn().mockReturnValue(false);
    const div = document.createElement('div');

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props, context) {
        super(props, context);
        this.state = {
          hasUpdatedState: false,
        };
      }

      /** `Component.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        instance = this;
      }

      /** `Component.shouldComponentUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      shouldComponentUpdate() {
        return mockFn();
      }

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.state.hasUpdatedState}</div>;
      }
    }

    const root = ReactDOMClient.createRoot(div);
    let instance;
    await act(() => {
      root.render(<Component ref={ref => (instance = ref)} />);
    });

    expect(instance).toBeDefined();
    expect(mockFn).not.toBeCalled();

    await act(() => {
      instance.setState({hasUpdatedState: true}, () => {
        expect(mockFn).toBeCalled();
        expect(instance.state.hasUpdatedState).toBe(true);
        Scheduler.log('setState callback called');
      });
    });

    assertLog(['setState callback called']);
  });

  /** 测试场景：验证「should return a meaningful warning when constructor is returned」描述的渲染、交互或错误处理结果。 */
  it('should return a meaningful warning when constructor is returned', async () => {
    /** `RenderTextInvalidConstructor`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class RenderTextInvalidConstructor extends React.Component {
      /** `RenderTextInvalidConstructor.constructor`：初始化测试夹具实例及其状态。 */
      constructor(props) {
        super(props);
        return {something: false};
      }

      /** `RenderTextInvalidConstructor.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await expect(async () => {
      await act(() => {
        root.render(<RenderTextInvalidConstructor />);
      });
    }).rejects.toThrow();
    assertConsoleErrorDev([
      'No `render` method found on the RenderTextInvalidConstructor instance: ' +
        'did you accidentally return an object from the constructor?\n' +
        '    in RenderTextInvalidConstructor (at **)',
      'No `render` method found on the RenderTextInvalidConstructor instance: ' +
        'did you accidentally return an object from the constructor?\n' +
        '    in RenderTextInvalidConstructor (at **)',
    ]);
  });

  /** 测试场景：验证「should warn about reassigning this.props while rendering」描述的渲染、交互或错误处理结果。 */
  it('should warn about reassigning this.props while rendering', () => {
    /** `Bad`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Bad extends React.Component {
      /** `Bad.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {}
      /** `Bad.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {}
      /** `Bad.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        this.props = {...this.props};
        return null;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    ReactDOM.flushSync(() => {
      root.render(<Bad />);
    });
    assertConsoleErrorDev([
      'It looks like Bad is reassigning its own `this.props` while rendering. ' +
        'This is not supported and can lead to confusing bugs.\n' +
        '    in Bad (at **)',
    ]);
  });

  /** 测试场景：验证「should return error if render is not defined」描述的渲染、交互或错误处理结果。 */
  it('should return error if render is not defined', async () => {
    /** `RenderTestUndefinedRender`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class RenderTestUndefinedRender extends React.Component {}

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await expect(async () => {
      await act(() => {
        root.render(<RenderTestUndefinedRender />);
      });
    }).rejects.toThrow();
    assertConsoleErrorDev([
      'No `render` method found on the RenderTestUndefinedRender instance: ' +
        'you may have forgotten to define `render`.\n' +
        '    in RenderTestUndefinedRender (at **)',
      'No `render` method found on the RenderTestUndefinedRender instance: ' +
        'you may have forgotten to define `render`.\n' +
        '    in RenderTestUndefinedRender (at **)',
    ]);
  });

  // 回归测试，用于检测意外的破坏性更改 https://github.com/facebook/react/issues/13580
  /** 测试场景：验证「should support classes shadowing isReactComponent」描述的渲染、交互或错误处理结果。 */
  it('should support classes shadowing isReactComponent', async () => {
    /** `Shadow`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Shadow extends React.Component {
      /** `Shadow.isReactComponent`：实现测试夹具的生命周期、渲染或交互步骤。 */
      isReactComponent() {}
      /** `Shadow.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Shadow />);
    });
    expect(container.firstChild.tagName).toBe('DIV');
  });

  /** 测试场景：验证「should not warn on updating function component from componentWillMount」描述的渲染、交互或错误处理结果。 */
  it('should not warn on updating function component from componentWillMount', async () => {
    let setState;
    let ref;
    /** `A`：封装当前用例复用的操作、回调或断言步骤。 */
    function A() {
      const [state, _setState] = React.useState(null);
      setState = _setState;
      return <div ref={r => (ref = r)}>{state}</div>;
    }
    /** `B`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class B extends React.Component {
      /** `B.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        setState(1);
      }
      /** `B.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }
    /** `Parent`：封装当前用例复用的操作、回调或断言步骤。 */
    function Parent() {
      return (
        <div>
          <A />
          <B />
        </div>
      );
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent />);
    });

    expect(ref.textContent).toBe('1');
  });

  /** 测试场景：验证「should not warn on updating function component from componentWillUpdate」描述的渲染、交互或错误处理结果。 */
  it('should not warn on updating function component from componentWillUpdate', async () => {
    let setState;
    let ref;
    /** `A`：封装当前用例复用的操作、回调或断言步骤。 */
    function A() {
      const [state, _setState] = React.useState();
      setState = _setState;
      return <div ref={r => (ref = r)}>{state}</div>;
    }
    /** `B`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class B extends React.Component {
      /** `B.UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate() {
        setState(1);
      }
      /** `B.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }
    /** `Parent`：封装当前用例复用的操作、回调或断言步骤。 */
    function Parent() {
      return (
        <div>
          <A />
          <B />
        </div>
      );
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent />);
    });
    await act(() => {
      root.render(<Parent />);
    });

    expect(ref.textContent).toBe('1');
  });

  /** 测试场景：验证「should not warn on updating function component from componentWillReceiveProps」描述的渲染、交互或错误处理结果。 */
  it('should not warn on updating function component from componentWillReceiveProps', async () => {
    let setState;
    let ref;
    /** `A`：封装当前用例复用的操作、回调或断言步骤。 */
    function A() {
      const [state, _setState] = React.useState();
      setState = _setState;
      return <div ref={r => (ref = r)}>{state}</div>;
    }

    /** `B`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class B extends React.Component {
      /** `B.UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps() {
        setState(1);
      }
      /** `B.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return null;
      }
    }
    /** `Parent`：封装当前用例复用的操作、回调或断言步骤。 */
    function Parent() {
      return (
        <div>
          <A />
          <B />
        </div>
      );
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent />);
    });
    await act(() => {
      root.render(<Parent />);
    });

    expect(ref.textContent).toBe('1');
  });

  /** 测试场景：验证「should warn on updating function component from render」描述的渲染、交互或错误处理结果。 */
  it('should warn on updating function component from render', () => {
    let setState;
    let ref;
    /** `A`：封装当前用例复用的操作、回调或断言步骤。 */
    function A() {
      const [state, _setState] = React.useState(0);
      setState = _setState;
      return <div ref={r => (ref = r)}>{state}</div>;
    }

    /** `B`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class B extends React.Component {
      /** `B.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        setState(c => c + 1);
        return null;
      }
    }
    /** `Parent`：封装当前用例复用的操作、回调或断言步骤。 */
    function Parent() {
      return (
        <div>
          <A />
          <B />
        </div>
      );
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    ReactDOM.flushSync(() => {
      root.render(<Parent />);
    });
    assertConsoleErrorDev([
      'Cannot update a component (`A`) while rendering a different component (`B`). ' +
        'To locate the bad setState() call inside `B`, ' +
        'follow the stack trace as described in https://react.dev/link/setstate-in-render\n' +
        '    in Parent (at **)',
    ]);

    // 我们错误了,但仍然更新了状态.
    expect(ref.textContent).toBe('1');

    // 去重。
    ReactDOM.flushSync(() => {
      root.render(<Parent />);
    });

    // 我们错误了,但仍然更新了状态.
    expect(ref.textContent).toBe('2');
  });
});
