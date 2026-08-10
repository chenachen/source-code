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
let ReactDOMServer;
let act;
let assertConsoleErrorDev;

describe('ReactComponent', () => {
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
  });

  // @gate !disableLegacyMode
  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should throw on invalid render targets in legacy roots」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should throw on invalid render targets in legacy roots', () => {
    const container = document.createElement('div');
    // jQuery 对象本质上是数组。 人们经常错误地传递它们.
    expect(function () {
      ReactDOM.render(<div />, [container]);
    }).toThrowError(/Target container is not a DOM element./);

    expect(function () {
      ReactDOM.render(<div />, null);
    }).toThrowError(/Target container is not a DOM element./);
  });

  /** 测试场景：验证「should throw (in dev) when children are mutated during render」描述的渲染、交互或错误处理结果。 */
  it('should throw (in dev) when children are mutated during render', async () => {
    /** `Wrapper`：封装当前用例复用的操作、回调或断言步骤。 */
    function Wrapper(props) {
      props.children[1] = <p key={1} />; // 突变是违法的
      return <div>{props.children}</div>;
    }
    if (__DEV__) {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await expect(
        act(() => {
          root.render(
            <Wrapper>
              <span key={0} />
              <span key={1} />
              <span key={2} />
            </Wrapper>,
          );
        }),
      ).rejects.toThrowError(/Cannot assign to read only property.*/);
    } else {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(
          <Wrapper>
            <span key={0} />
            <span key={1} />
            <span key={2} />
          </Wrapper>,
        );
      });
    }
  });

  /** 测试场景：验证「should throw (in dev) when children are mutated during update」描述的渲染、交互或错误处理结果。 */
  it('should throw (in dev) when children are mutated during update', async () => {
    /** `Wrapper`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Wrapper extends React.Component {
      /** `Wrapper.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        this.props.children[1] = <p key={1} />; // 突变是违法的
        this.forceUpdate();
      }

      /** `Wrapper.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    if (__DEV__) {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await expect(
        act(() => {
          root.render(
            <Wrapper>
              <span key={0} />
              <span key={1} />
              <span key={2} />
            </Wrapper>,
          );
        }),
      ).rejects.toThrowError(/Cannot assign to read only property.*/);
    } else {
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(
          <Wrapper>
            <span key={0} />
            <span key={1} />
            <span key={2} />
          </Wrapper>,
        );
      });
    }
  });

  /** 测试场景：验证「should not have string refs on unmounted components」描述的渲染、交互或错误处理结果。 */
  it('should not have string refs on unmounted components', async () => {
    /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Parent extends React.Component {
      /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <Child>
            <div ref="test" />
          </Child>
        );
      }

      /** `Parent.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        expect(this.refs && this.refs.test).toEqual(undefined);
      }
    }

    /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Child extends React.Component {
      /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Parent child={<span />} />);
    });
  });

  /** 测试场景：验证「should support callback-style refs」描述的渲染、交互或错误处理结果。 */
  it('should support callback-style refs', async () => {
    const innerObj = {};
    const outerObj = {};

    /** `Wrapper`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Wrapper extends React.Component {
      /** `Wrapper.getObject`：封装当前用例复用的操作、回调或断言步骤。 */
      getObject = () => {
        return this.props.object;
      };

      /** `Wrapper.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    let mounted = false;

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        const inner = (
          <Wrapper object={innerObj} ref={c => (this.innerRef = c)} />
        );
        const outer = (
          <Wrapper object={outerObj} ref={c => (this.outerRef = c)}>
            {inner}
          </Wrapper>
        );
        return outer;
      }

      /** `Component.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        expect(this.innerRef.getObject()).toEqual(innerObj);
        expect(this.outerRef.getObject()).toEqual(outerObj);
        mounted = true;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component />);
    });

    expect(mounted).toBe(true);
  });

  /** 测试场景：验证「should support object-style refs」描述的渲染、交互或错误处理结果。 */
  it('should support object-style refs', async () => {
    const innerObj = {};
    const outerObj = {};

    /** `Wrapper`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Wrapper extends React.Component {
      /** `Wrapper.getObject`：封装当前用例复用的操作、回调或断言步骤。 */
      getObject = () => {
        return this.props.object;
      };

      /** `Wrapper.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div>{this.props.children}</div>;
      }
    }

    let mounted = false;

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.constructor`：初始化测试夹具实例及其状态。 */
      constructor() {
        super();
        this.innerRef = React.createRef();
        this.outerRef = React.createRef();
      }
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        const inner = <Wrapper object={innerObj} ref={this.innerRef} />;
        const outer = (
          <Wrapper object={outerObj} ref={this.outerRef}>
            {inner}
          </Wrapper>
        );
        return outer;
      }

      /** `Component.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        expect(this.innerRef.current.getObject()).toEqual(innerObj);
        expect(this.outerRef.current.getObject()).toEqual(outerObj);
        mounted = true;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component />);
    });

    expect(mounted).toBe(true);
  });

  /** 测试场景：验证「should support new-style refs with mixed-up owners」描述的渲染、交互或错误处理结果。 */
  it('should support new-style refs with mixed-up owners', async () => {
    /** `Wrapper`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Wrapper extends React.Component {
      /** `Wrapper.getTitle`：封装当前用例复用的操作、回调或断言步骤。 */
      getTitle = () => {
        return this.props.title;
      };

      /** `Wrapper.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return this.props.getContent();
      }
    }

    let mounted = false;

    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.getInner`：封装当前用例复用的操作、回调或断言步骤。 */
      getInner = () => {
        // （使用旧式引用时，） 由于在调用此函数时 Wrapper 是当前所有者，因此无法获取到这个 div 的 ref。
        return <div className="inner" ref={c => (this.innerRef = c)} />;
      };

      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <Wrapper
            title="wrapper"
            ref={c => (this.wrapperRef = c)}
            getContent={this.getInner}
          />
        );
      }

      /** `Component.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        // 检查 props.title 确保我们得到了正确的元素。
        expect(this.wrapperRef.getTitle()).toBe('wrapper');
        expect(this.innerRef.className).toBe('inner');
        mounted = true;
      }
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<Component />);
    });

    expect(mounted).toBe(true);
  });

  /** 测试场景：验证「should call refs at the correct time」描述的渲染、交互或错误处理结果。 */
  it('should call refs at the correct time', async () => {
    const log = [];

    /** `Inner`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Inner extends React.Component {
      /** `Inner.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        log.push(`inner ${this.props.id} render`);
        return <div />;
      }

      /** `Inner.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        log.push(`inner ${this.props.id} componentDidMount`);
      }

      /** `Inner.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        log.push(`inner ${this.props.id} componentDidUpdate`);
      }

      /** `Inner.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        log.push(`inner ${this.props.id} componentWillUnmount`);
      }
    }

    /** `Outer`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Outer extends React.Component {
      /** `Outer.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            <Inner
              id={1}
              ref={c => {
                log.push(`ref 1 got ${c ? `instance ${c.props.id}` : 'null'}`);
              }}
            />
            <Inner
              id={2}
              ref={c => {
                log.push(`ref 2 got ${c ? `instance ${c.props.id}` : 'null'}`);
              }}
            />
          </div>
        );
      }

      /** `Outer.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        log.push('outer componentDidMount');
      }

      /** `Outer.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        log.push('outer componentDidUpdate');
      }

      /** `Outer.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillUnmount() {
        log.push('outer componentWillUnmount');
      }
    }

    // mount: 将组件挂载到 DOM 中。 update: 更新状态和渲染组件。 卸载
    const el = document.createElement('div');
    log.push('start mount');
    const root = ReactDOMClient.createRoot(el);
    await act(() => {
      root.render(<Outer />);
    });
    log.push('start update');
    await act(() => {
      root.render(<Outer />);
    });
    log.push('start unmount');
    await act(() => {
      root.unmount();
    });

    expect(log).toEqual([
      'start mount',
      'inner 1 render',
      'inner 2 render',
      'inner 1 componentDidMount',
      'ref 1 got instance 1',
      'inner 2 componentDidMount',
      'ref 2 got instance 2',
      'outer componentDidMount',
      'start update',
      // 先清除先前的等价 ref。
      // Fiber 先渲染，随后重置 ref。
      'inner 1 render',
      'inner 2 render',
      'ref 1 got null',
      'ref 2 got null',
      'inner 1 componentDidUpdate',
      'ref 1 got instance 1',
      'inner 2 componentDidUpdate',
      'ref 2 got instance 2',
      'outer componentDidUpdate',
      'start unmount',
      'outer componentWillUnmount',
      'ref 1 got null',
      'inner 1 componentWillUnmount',
      'ref 2 got null',
      'inner 2 componentWillUnmount',
    ]);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「fires the callback after a component is rendered in legacy roots」描述的渲染、交互或错误处理结果。 */
  it('fires the callback after a component is rendered in legacy roots', () => {
    const callback = jest.fn();
    const container = document.createElement('div');
    ReactDOM.render(<div />, container, callback);
    expect(callback).toHaveBeenCalledTimes(1);
    ReactDOM.render(<div className="foo" />, container, callback);
    expect(callback).toHaveBeenCalledTimes(2);
    ReactDOM.render(<span />, container, callback);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  /** 测试场景：验证「throws usefully when rendering badly-typed elements」描述的渲染、交互或错误处理结果。 */
  it('throws usefully when rendering badly-typed elements', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    const X = undefined;
    const XElement = <X />;
    await expect(async () => {
      await act(() => {
        root.render(XElement);
      });
    }).rejects.toThrowError(
      'Element type is invalid: expected a string (for built-in components) ' +
        'or a class/function (for composite components) but got: undefined.' +
        (__DEV__
          ? " You likely forgot to export your component from the file it's " +
            'defined in, or you might have mixed up default and named imports.'
          : ''),
    );

    const Y = null;
    const YElement = <Y />;
    await expect(async () => {
      await act(() => {
        root.render(YElement);
      });
    }).rejects.toThrowError(
      'Element type is invalid: expected a string (for built-in components) ' +
        'or a class/function (for composite components) but got: null.',
    );

    const Z = true;
    const ZElement = <Z />;
    await expect(async () => {
      await act(() => {
        root.render(ZElement);
      });
    }).rejects.toThrowError(
      'Element type is invalid: expected a string (for built-in components) ' +
        'or a class/function (for composite components) but got: boolean.',
    );
  });

  /** 测试场景：验证「includes owner name in the error about badly-typed elements」描述的渲染、交互或错误处理结果。 */
  it('includes owner name in the error about badly-typed elements', async () => {
    const X = undefined;

    /** `Indirection`：封装当前用例复用的操作、回调或断言步骤。 */
    function Indirection(props) {
      return <div>{props.children}</div>;
    }

    /** `Bar`：封装当前用例复用的操作、回调或断言步骤。 */
    function Bar() {
      return (
        <Indirection>
          <X />
        </Indirection>
      );
    }

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      return <Bar />;
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(async () => {
      await act(() => {
        root.render(<Foo />);
      });
    }).rejects.toThrowError(
      'Element type is invalid: expected a string (for built-in components) ' +
        'or a class/function (for composite components) but got: undefined.' +
        (__DEV__
          ? " You likely forgot to export your component from the file it's " +
            'defined in, or you might have mixed up default and named imports.' +
            '\n\nCheck the render method of `Bar`.'
          : ''),
    );
  });

  /** 测试场景：验证「throws if a plain object is used as a child」描述的渲染、交互或错误处理结果。 */
  it('throws if a plain object is used as a child', async () => {
    const children = {
      x: <span />,
      y: <span />,
      z: <span />,
    };
    const element = <div>{[children]}</div>;
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(element);
      }),
    ).rejects.toThrowError(
      'Objects are not valid as a React child (found: object with keys {x, y, z}). ' +
        'If you meant to render a collection of children, use an array instead.',
    );
  });

  /** 测试场景：验证「throws if a legacy element is used as a child」描述的渲染、交互或错误处理结果。 */
  it('throws if a legacy element is used as a child', async () => {
    const inlinedElement = {
      $$typeof: Symbol.for('react.element'),
      type: 'div',
      key: null,
      ref: null,
      props: {},
      _owner: null,
    };
    const element = <div>{[inlinedElement]}</div>;
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(element);
      }),
    ).rejects.toThrowError(
      'A React Element from an older version of React was rendered. ' +
        'This is not supported. It can happen if:\n' +
        '- Multiple copies of the "react" package is used.\n' +
        '- A library pre-bundled an old copy of "react" or "react/jsx-runtime".\n' +
        '- A compiler tries to "inline" JSX instead of using the runtime.',
    );
  });

  /** 测试场景：验证「throws if a plain object even if it is in an owner」描述的渲染、交互或错误处理结果。 */
  it('throws if a plain object even if it is in an owner', async () => {
    /** `Foo`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Foo extends React.Component {
      /** `Foo.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        const children = {
          a: <span />,
          b: <span />,
          c: <span />,
        };
        return <div>{[children]}</div>;
      }
    }
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(<Foo />);
      }),
    ).rejects.toThrowError(
      'Objects are not valid as a React child (found: object with keys {a, b, c}).' +
        ' If you meant to render a collection of children, use an array ' +
        'instead.',
    );
  });

  /** 测试场景：验证「throws if a plain object is used as a child when using SSR」描述的渲染、交互或错误处理结果。 */
  it('throws if a plain object is used as a child when using SSR', async () => {
    const children = {
      x: <span />,
      y: <span />,
      z: <span />,
    };
    const element = <div>{[children]}</div>;
    expect(() => {
      ReactDOMServer.renderToString(element);
    }).toThrowError(
      'Objects are not valid as a React child (found: object with keys {x, y, z}). ' +
        'If you meant to render a collection of children, use ' +
        'an array instead.',
    );
  });

  /** 测试场景：验证「throws if a plain object even if it is in an owner when using SSR」描述的渲染、交互或错误处理结果。 */
  it('throws if a plain object even if it is in an owner when using SSR', async () => {
    /** `Foo`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Foo extends React.Component {
      /** `Foo.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        const children = {
          a: <span />,
          b: <span />,
          c: <span />,
        };
        return <div>{[children]}</div>;
      }
    }
    const container = document.createElement('div');
    expect(() => {
      ReactDOMServer.renderToString(<Foo />, container);
    }).toThrowError(
      'Objects are not valid as a React child (found: object with keys {a, b, c}). ' +
        'If you meant to render a collection of children, use ' +
        'an array instead.',
    );
  });

  describe('with new features', () => {
    /** 测试场景：验证「warns on function as a return value from a function」描述的渲染、交互或错误处理结果。 */
    it('warns on function as a return value from a function', async () => {
      /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
      function Foo() {
        return Foo;
      }
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Foo />);
      });
      assertConsoleErrorDev([
        'Functions are not valid as a React child. This may happen if ' +
          'you return Foo instead of <Foo /> from render. ' +
          'Or maybe you meant to call this function rather than return it.\n' +
          '  <Foo>{Foo}</Foo>\n' +
          '    in Foo (at **)',
      ]);
    });

    /** 测试场景：验证「warns on function as a return value from a class」描述的渲染、交互或错误处理结果。 */
    it('warns on function as a return value from a class', async () => {
      /** `Foo`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Foo extends React.Component {
        /** `Foo.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return Foo;
        }
      }
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<Foo />);
      });
      assertConsoleErrorDev([
        'Functions are not valid as a React child. This may happen if ' +
          'you return Foo instead of <Foo /> from render. ' +
          'Or maybe you meant to call this function rather than return it.\n' +
          '  <Foo>{Foo}</Foo>\n' +
          '    in Foo (at **)',
      ]);
    });

    /** 测试场景：验证「warns on function as a child to host component」描述的渲染、交互或错误处理结果。 */
    it('warns on function as a child to host component', async () => {
      /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
      function Foo() {
        return (
          <div>
            <span>{Foo}</span>
          </div>
        );
      }
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Foo />);
      });
      assertConsoleErrorDev([
        'Functions are not valid as a React child. This may happen if ' +
          'you return Foo instead of <Foo /> from render. ' +
          'Or maybe you meant to call this function rather than return it.\n' +
          '  <span>{Foo}</span>\n' +
          '    in span (at **)\n' +
          '    in Foo (at **)',
      ]);
    });

    /** 测试场景：验证「does not warn for function-as-a-child that gets resolved」描述的渲染、交互或错误处理结果。 */
    it('does not warn for function-as-a-child that gets resolved', async () => {
      /** `Bar`：封装当前用例复用的操作、回调或断言步骤。 */
      function Bar(props) {
        return props.children();
      }
      /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
      function Foo() {
        return <Bar>{() => 'Hello'}</Bar>;
      }
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<Foo />);
      });

      expect(container.innerHTML).toBe('Hello');
    });

    /** 测试场景：验证「deduplicates function type warnings based on component type」描述的渲染、交互或错误处理结果。 */
    it('deduplicates function type warnings based on component type', async () => {
      /** `Foo`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Foo extends React.PureComponent {
        /** `Foo.constructor`：初始化测试夹具实例及其状态。 */
        constructor() {
          super();
          this.state = {type: 'mushrooms'};
        }
        /** `Foo.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return (
            <div>
              {Foo}
              {Foo}
              <span>
                {Foo}
                {Foo}
              </span>
            </div>
          );
        }
      }
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      let component;
      await act(() => {
        root.render(<Foo ref={current => (component = current)} />);
      });
      assertConsoleErrorDev([
        'Functions are not valid as a React child. This may happen if ' +
          'you return Foo instead of <Foo /> from render. ' +
          'Or maybe you meant to call this function rather than return it.\n' +
          '  <div>{Foo}</div>\n' +
          '    in div (at **)\n' +
          '    in Foo (at **)',
        'Functions are not valid as a React child. This may happen if ' +
          'you return Foo instead of <Foo /> from render. ' +
          'Or maybe you meant to call this function rather than return it.\n' +
          '  <span>{Foo}</span>\n' +
          '    in span (at **)\n' +
          '    in Foo (at **)',
      ]);
      await act(() => {
        component.setState({type: 'portobello mushrooms'});
      });
    });
  });
});
