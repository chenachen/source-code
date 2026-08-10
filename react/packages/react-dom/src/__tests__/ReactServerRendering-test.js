/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

'use strict';

let React;
let ReactDOMServer;
let PropTypes;
let ReactSharedInternals;
let assertConsoleErrorDev;

describe('ReactDOMServer', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    PropTypes = require('prop-types');
    ReactDOMServer = require('react-dom/server');
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
    ReactSharedInternals =
      React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  });

  describe('renderToString', () => {
    /**
     * 代表场景（Given–When–Then）：
     * Given 当前文件已建立所需 DOM、React 根与测试夹具；
     * When 执行「should generate simple markup」描述的渲染或交互；
     * Then 通过本用例的 DOM、日志或调度断言确认行为。
     *
     * 验证机制：断言覆盖 react-dom 的服务端流适配层；完整 Fizz 状态机位于 react-server。
     */
    it('should generate simple markup', () => {
      const response = ReactDOMServer.renderToString(<span>hello world</span>);
      expect(response).toMatch(new RegExp('<span' + '>hello world</span>'));
    });

    /** 测试场景：验证「should generate simple markup for self-closing tags」描述的渲染、交互或错误处理结果。 */
    it('should generate simple markup for self-closing tags', () => {
      const response = ReactDOMServer.renderToString(<img />);
      expect(response).toMatch(new RegExp('<img' + '/>'));
    });

    /** 测试场景：验证「should generate comment markup for component returns null」描述的渲染、交互或错误处理结果。 */
    it('should generate comment markup for component returns null', () => {
      /** `NullComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class NullComponent extends React.Component {
        /** `NullComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return null;
        }
      }

      const response = ReactDOMServer.renderToString(<NullComponent />);
      expect(response).toBe('');
    });

    // TODO：测试监听器是否注册到任何文档/容器上。

    /** 测试场景：验证「should render composite components」描述的渲染、交互或错误处理结果。 */
    it('should render composite components', () => {
      /** `Parent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Parent extends React.Component {
        /** `Parent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return (
            <div>
              <Child name="child" />
            </div>
          );
        }
      }

      /** `Child`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Child extends React.Component {
        /** `Child.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <span>My name is {this.props.name}</span>;
        }
      }

      const response = ReactDOMServer.renderToString(<Parent />);
      expect(response).toMatch(
        new RegExp(
          '<div>' +
            '<span' +
            '>' +
            'My name is <!-- -->child' +
            '</span>' +
            '</div>',
        ),
      );
    });

    /** 测试场景：验证「should only execute certain lifecycle methods」描述的渲染、交互或错误处理结果。 */
    it('should only execute certain lifecycle methods', () => {
      /** `runTest`：封装当前用例复用的操作、回调或断言步骤。 */
      function runTest() {
        const lifecycle = [];

        /** `runTest.TestComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
        class TestComponent extends React.Component {
          /** `TestComponent.constructor`：初始化测试夹具实例及其状态。 */
          constructor(props) {
            super(props);
            lifecycle.push('getInitialState');
            this.state = {name: 'TestComponent'};
          }

          /** `TestComponent.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
          UNSAFE_componentWillMount() {
            lifecycle.push('componentWillMount');
          }

          /** `TestComponent.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
          componentDidMount() {
            lifecycle.push('componentDidMount');
          }

          /** `TestComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
          render() {
            lifecycle.push('render');
            return <span>Component name: {this.state.name}</span>;
          }

          /** `TestComponent.UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
          UNSAFE_componentWillUpdate() {
            lifecycle.push('componentWillUpdate');
          }

          /** `TestComponent.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
          componentDidUpdate() {
            lifecycle.push('componentDidUpdate');
          }

          /** `TestComponent.shouldComponentUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
          shouldComponentUpdate() {
            lifecycle.push('shouldComponentUpdate');
          }

          /** `TestComponent.UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
          UNSAFE_componentWillReceiveProps() {
            lifecycle.push('componentWillReceiveProps');
          }

          /** `TestComponent.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
          componentWillUnmount() {
            lifecycle.push('componentWillUnmount');
          }
        }

        const response = ReactDOMServer.renderToString(<TestComponent />);

        expect(response).toMatch(
          new RegExp(
            '<span>' + 'Component name: <!-- -->TestComponent' + '</span>',
          ),
        );
        expect(lifecycle).toEqual([
          'getInitialState',
          'componentWillMount',
          'render',
        ]);
      }

      runTest();
    });

    /** 测试场景：验证「should throw with silly args」描述的渲染、交互或错误处理结果。 */
    it('should throw with silly args', () => {
      expect(
        ReactDOMServer.renderToString.bind(ReactDOMServer, {x: 123}),
      ).toThrowError(
        'Objects are not valid as a React child (found: object with keys {x})',
      );
    });

    /** 测试场景：验证「should throw prop mapping error for an <iframe /> with invalid props」描述的渲染、交互或错误处理结果。 */
    it('should throw prop mapping error for an <iframe /> with invalid props', () => {
      expect(() => {
        ReactDOMServer.renderToString(<iframe style="border:none;" />);
      }).toThrowError(
        'The `style` prop expects a mapping from style properties to values, not ' +
          "a string. For example, style={{marginRight: spacing + 'em'}} when using JSX.",
      );
    });

    /** 测试场景：验证「should not crash on poisoned hasOwnProperty」描述的渲染、交互或错误处理结果。 */
    it('should not crash on poisoned hasOwnProperty', () => {
      const html = ReactDOMServer.renderToString(
        <div hasOwnProperty="poison">
          <span unknown="test" />
        </div>,
      );
      assertConsoleErrorDev([
        'React does not recognize the `hasOwnProperty` prop on a DOM element. ' +
          'If you intentionally want it to appear in the DOM as a custom attribute, ' +
          'spell it as lowercase `hasownproperty` instead. ' +
          'If you accidentally passed it from a parent component, remove it from the DOM element.\n' +
          '    in div (at **)',
      ]);
      expect(html).toContain('<span unknown="test">');
    });
  });

  describe('renderToStaticMarkup', () => {
    /** 测试场景：验证「should not put checksum and React ID on components」描述的渲染、交互或错误处理结果。 */
    it('should not put checksum and React ID on components', () => {
      /** `NestedComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class NestedComponent extends React.Component {
        /** `NestedComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <div>inner text</div>;
        }
      }

      /** `TestComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class TestComponent extends React.Component {
        /** `TestComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return (
            <span>
              <NestedComponent />
            </span>
          );
        }
      }

      const response = ReactDOMServer.renderToStaticMarkup(<TestComponent />);

      expect(response).toBe('<span><div>inner text</div></span>');
    });

    /** 测试场景：验证「should not put checksum and React ID on text components」描述的渲染、交互或错误处理结果。 */
    it('should not put checksum and React ID on text components', () => {
      /** `TestComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class TestComponent extends React.Component {
        /** `TestComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return (
            <span>
              {'hello'} {'world'}
            </span>
          );
        }
      }

      const response = ReactDOMServer.renderToStaticMarkup(<TestComponent />);

      expect(response).toBe('<span>hello world</span>');
    });

    /** 测试场景：验证「should not use comments for empty nodes」描述的渲染、交互或错误处理结果。 */
    it('should not use comments for empty nodes', () => {
      /** `TestComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class TestComponent extends React.Component {
        /** `TestComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return null;
        }
      }

      const response = ReactDOMServer.renderToStaticMarkup(<TestComponent />);

      expect(response).toBe('');
    });

    /** 测试场景：验证「should only execute certain lifecycle methods」描述的渲染、交互或错误处理结果。 */
    it('should only execute certain lifecycle methods', () => {
      /** `runTest`：封装当前用例复用的操作、回调或断言步骤。 */
      function runTest() {
        const lifecycle = [];

        /** `runTest.TestComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
        class TestComponent extends React.Component {
          /** `TestComponent.constructor`：初始化测试夹具实例及其状态。 */
          constructor(props) {
            super(props);
            lifecycle.push('getInitialState');
            this.state = {name: 'TestComponent'};
          }

          /** `TestComponent.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
          UNSAFE_componentWillMount() {
            lifecycle.push('componentWillMount');
          }

          /** `TestComponent.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
          componentDidMount() {
            lifecycle.push('componentDidMount');
          }

          /** `TestComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
          render() {
            lifecycle.push('render');
            return <span>Component name: {this.state.name}</span>;
          }

          /** `TestComponent.UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
          UNSAFE_componentWillUpdate() {
            lifecycle.push('componentWillUpdate');
          }

          /** `TestComponent.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
          componentDidUpdate() {
            lifecycle.push('componentDidUpdate');
          }

          /** `TestComponent.shouldComponentUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
          shouldComponentUpdate() {
            lifecycle.push('shouldComponentUpdate');
          }

          /** `TestComponent.UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
          UNSAFE_componentWillReceiveProps() {
            lifecycle.push('componentWillReceiveProps');
          }

          /** `TestComponent.componentWillUnmount`：实现测试夹具的生命周期、渲染或交互步骤。 */
          componentWillUnmount() {
            lifecycle.push('componentWillUnmount');
          }
        }

        const response = ReactDOMServer.renderToStaticMarkup(<TestComponent />);

        expect(response).toBe('<span>Component name: TestComponent</span>');
        expect(lifecycle).toEqual([
          'getInitialState',
          'componentWillMount',
          'render',
        ]);
      }

      runTest();
    });

    /** 测试场景：验证「should throw with silly args」描述的渲染、交互或错误处理结果。 */
    it('should throw with silly args', () => {
      expect(
        ReactDOMServer.renderToStaticMarkup.bind(ReactDOMServer, {x: 123}),
      ).toThrowError(
        'Objects are not valid as a React child (found: object with keys {x})',
      );
    });

    /** 测试场景：验证「allows setState in componentWillMount without using DOM」描述的渲染、交互或错误处理结果。 */
    it('allows setState in componentWillMount without using DOM', () => {
      /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Component extends React.Component {
        /** `Component.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
        UNSAFE_componentWillMount() {
          this.setState({text: 'hello, world'});
        }

        /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <div>{this.state.text}</div>;
        }
      }
      const markup = ReactDOMServer.renderToStaticMarkup(<Component />);
      expect(markup).toContain('hello, world');
    });

    /** 测试场景：验证「allows setState in componentWillMount with custom constructor」描述的渲染、交互或错误处理结果。 */
    it('allows setState in componentWillMount with custom constructor', () => {
      /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Component extends React.Component {
        /** `Component.constructor`：初始化测试夹具实例及其状态。 */
        constructor() {
          super();
          this.state = {text: 'default state'};
        }

        /** `Component.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
        UNSAFE_componentWillMount() {
          this.setState({text: 'hello, world'});
        }

        /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <div>{this.state.text}</div>;
        }
      }
      const markup = ReactDOMServer.renderToStaticMarkup(<Component />);
      expect(markup).toContain('hello, world');
    });

    /** 测试场景：验证「renders with props when using custom constructor」描述的渲染、交互或错误处理结果。 */
    it('renders with props when using custom constructor', () => {
      /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Component extends React.Component {
        /** `Component.constructor`：初始化测试夹具实例及其状态。 */
        constructor() {
          super();
        }

        /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <div>{this.props.text}</div>;
        }
      }

      const markup = ReactDOMServer.renderToStaticMarkup(
        <Component text="hello, world" />,
      );
      expect(markup).toContain('hello, world');
    });

    // @gate !disableLegacyContext
    /** 测试场景：验证「renders with context when using custom constructor」描述的渲染、交互或错误处理结果。 */
    it('renders with context when using custom constructor', () => {
      /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Component extends React.Component {
        /** `Component.constructor`：初始化测试夹具实例及其状态。 */
        constructor() {
          super();
        }

        /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <div>{this.context.text}</div>;
        }
      }

      Component.contextTypes = {
        text: PropTypes.string.isRequired,
      };

      /** `ContextProvider`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class ContextProvider extends React.Component {
        /** `ContextProvider.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
        getChildContext() {
          return {
            text: 'hello, world',
          };
        }

        /** `ContextProvider.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return this.props.children;
        }
      }

      ContextProvider.childContextTypes = {
        text: PropTypes.string,
      };

      const markup = ReactDOMServer.renderToStaticMarkup(
        <ContextProvider>
          <Component />
        </ContextProvider>,
      );
      assertConsoleErrorDev([
        'ContextProvider uses the legacy childContextTypes API which will soon be removed. ' +
          'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
          '    in ContextProvider (at **)',
        'Component uses the legacy contextTypes API which will soon be removed. ' +
          'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
          '    in Component (at **)',
      ]);
      expect(markup).toContain('hello, world');
    });

    /** 测试场景：验证「renders with new context API」描述的渲染、交互或错误处理结果。 */
    it('renders with new context API', () => {
      const Context = React.createContext(0);

      /** `Consumer`：封装当前用例复用的操作、回调或断言步骤。 */
      function Consumer(props) {
        return (
          <Context.Consumer>{value => 'Result: ' + value}</Context.Consumer>
        );
      }

      const Indirection = React.Fragment;

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App(props) {
        return (
          <Context.Provider value={props.value}>
            <Context.Provider value={2}>
              <Consumer />
            </Context.Provider>
            <Indirection>
              <Indirection>
                <Consumer />
                <Context.Provider value={3}>
                  <Consumer />
                </Context.Provider>
              </Indirection>
            </Indirection>
            <Consumer />
          </Context.Provider>
        );
      }

      const markup = ReactDOMServer.renderToStaticMarkup(<App value={1} />);
      // 提取消费者渲染的数字
      const results = markup.match(/\d+/g).map(Number);
      expect(results).toEqual([2, 1, 3, 1]);
    });

    /** 测试场景：验证「renders with dispatcher.readContext mechanism」描述的渲染、交互或错误处理结果。 */
    it('renders with dispatcher.readContext mechanism', () => {
      const Context = React.createContext(0);

      /** `readContext`：封装当前用例复用的操作、回调或断言步骤。 */
      function readContext(context) {
        return ReactSharedInternals.H.readContext(context);
      }

      /** `Consumer`：封装当前用例复用的操作、回调或断言步骤。 */
      function Consumer(props) {
        return 'Result: ' + readContext(Context);
      }

      const Indirection = React.Fragment;

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App(props) {
        return (
          <Context.Provider value={props.value}>
            <Context.Provider value={2}>
              <Consumer />
            </Context.Provider>
            <Indirection>
              <Indirection>
                <Consumer />
                <Context.Provider value={3}>
                  <Consumer />
                </Context.Provider>
              </Indirection>
            </Indirection>
            <Consumer />
          </Context.Provider>
        );
      }

      const markup = ReactDOMServer.renderToStaticMarkup(<App value={1} />);
      // 提取消费者渲染的数字
      const results = markup.match(/\d+/g).map(Number);
      expect(results).toEqual([2, 1, 3, 1]);
    });

    /** 测试场景：验证「renders context API, reentrancy」描述的渲染、交互或错误处理结果。 */
    it('renders context API, reentrancy', () => {
      const Context = React.createContext(0);

      /** `Consumer`：封装当前用例复用的操作、回调或断言步骤。 */
      function Consumer(props) {
        return (
          <Context.Consumer>{value => 'Result: ' + value}</Context.Consumer>
        );
      }

      let reentrantMarkup;
      /** `Reentrant`：封装当前用例复用的操作、回调或断言步骤。 */
      function Reentrant() {
        reentrantMarkup = ReactDOMServer.renderToStaticMarkup(
          <App value={1} reentrant={false} />,
        );
        return null;
      }

      const Indirection = React.Fragment;

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App(props) {
        return (
          <Context.Provider value={props.value}>
            {props.reentrant && <Reentrant />}
            <Context.Provider value={2}>
              <Consumer />
            </Context.Provider>
            <Indirection>
              <Indirection>
                <Consumer />
                <Context.Provider value={3}>
                  <Consumer />
                </Context.Provider>
              </Indirection>
            </Indirection>
            <Consumer />
          </Context.Provider>
        );
      }

      const markup = ReactDOMServer.renderToStaticMarkup(
        <App value={1} reentrant={true} />,
      );
      // 提取消费者渲染的数字
      const results = markup.match(/\d+/g).map(Number);
      const reentrantResults = reentrantMarkup.match(/\d+/g).map(Number);
      expect(results).toEqual([2, 1, 3, 1]);
      expect(reentrantResults).toEqual([2, 1, 3, 1]);
    });

    /** 测试场景：验证「renders components with different batching strategies」描述的渲染、交互或错误处理结果。 */
    it('renders components with different batching strategies', () => {
      /** `StaticComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class StaticComponent extends React.Component {
        /** `StaticComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          const staticContent = ReactDOMServer.renderToStaticMarkup(
            <div>
              <img src="foo-bar.jpg" />
            </div>,
          );
          return <div dangerouslySetInnerHTML={{__html: staticContent}} />;
        }
      }

      /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Component extends React.Component {
        /** `Component.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
        UNSAFE_componentWillMount() {
          this.setState({text: 'hello, world'});
        }

        /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <div>{this.state.text}</div>;
        }
      }

      expect(
        ReactDOMServer.renderToString.bind(
          ReactDOMServer,
          <div>
            <StaticComponent />
            <Component />
          </div>,
        ),
      ).not.toThrow();
    });

    /** 测试场景：验证「renders synchronously resolved lazy component」描述的渲染、交互或错误处理结果。 */
    it('renders synchronously resolved lazy component', () => {
      const LazyFoo = React.lazy(() => ({
        /** `then`：实现测试夹具的生命周期、渲染或交互步骤。 */
        then(resolve) {
          resolve({
            /** `then.default`：封装当前用例复用的操作、回调或断言步骤。 */
            default: function Foo({id}) {
              return <div id={id}>lazy</div>;
            },
          });
        },
      }));

      expect(ReactDOMServer.renderToStaticMarkup(<LazyFoo id="foo" />)).toEqual(
        '<div id="foo">lazy</div>',
      );
    });

    /** 测试场景：验证「throws error from synchronously rejected lazy component」描述的渲染、交互或错误处理结果。 */
    it('throws error from synchronously rejected lazy component', () => {
      const LazyFoo = React.lazy(() => ({
        /** `then`：实现测试夹具的生命周期、渲染或交互步骤。 */
        then(resolve, reject) {
          reject(new Error('Bad lazy'));
        },
      }));

      expect(() => ReactDOMServer.renderToStaticMarkup(<LazyFoo />)).toThrow(
        'Bad lazy',
      );
    });

    /** 测试场景：验证「aborts synchronously any suspended tasks and renders their fallbacks」描述的渲染、交互或错误处理结果。 */
    it('aborts synchronously any suspended tasks and renders their fallbacks', () => {
      const promise = new Promise(res => {});
      /** `Suspender`：封装当前用例复用的操作、回调或断言步骤。 */
      function Suspender() {
        throw promise;
      }
      const response = ReactDOMServer.renderToStaticMarkup(
        <React.Suspense fallback={'fallback'}>
          <Suspender />
        </React.Suspense>,
      );
      expect(response).toEqual('fallback');
    });
  });

  /** 测试场景：验证「warns with a no-op when an async setState is triggered」描述的渲染、交互或错误处理结果。 */
  it('warns with a no-op when an async setState is triggered', () => {
    /** `Foo`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Foo extends React.Component {
      /** `Foo.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        this.setState({text: 'hello'});
        setTimeout(() => {
          this.setState({text: 'error'});
        });
      }
      /** `Foo.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div onClick={() => {}}>{this.state.text}</div>;
      }
    }

    ReactDOMServer.renderToString(<Foo />);
    jest.runOnlyPendingTimers();
    assertConsoleErrorDev([
      'Can only update a mounting component. ' +
        'This usually means you called setState() outside componentWillMount() on the server. ' +
        'This is a no-op.\n' +
        '\n' +
        'Please check the code for the Foo component.',
    ]);

    const markup = ReactDOMServer.renderToStaticMarkup(<Foo />);
    expect(markup).toBe('<div>hello</div>');
    // 无额外警告预期。
    jest.runOnlyPendingTimers();
  });

  /** 测试场景：验证「warns with a no-op when an async forceUpdate is triggered」描述的渲染、交互或错误处理结果。 */
  it('warns with a no-op when an async forceUpdate is triggered', () => {
    /** `Baz`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Baz extends React.Component {
      /** `Baz.UNSAFE_componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillMount() {
        this.forceUpdate();
        setTimeout(() => {
          this.forceUpdate();
        });
      }

      /** `Baz.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div onClick={() => {}} />;
      }
    }

    ReactDOMServer.renderToString(<Baz />);
    jest.runOnlyPendingTimers();
    assertConsoleErrorDev([
      'Can only update a mounting component. ' +
        'This usually means you called forceUpdate() outside componentWillMount() on the server. ' +
        'This is a no-op.\n' +
        '\n' +
        'Please check the code for the Baz component.',
    ]);
    const markup = ReactDOMServer.renderToStaticMarkup(<Baz />);
    expect(markup).toBe('<div></div>');
  });

  /** 测试场景：验证「does not get confused by throwing null」描述的渲染、交互或错误处理结果。 */
  it('does not get confused by throwing null', () => {
    /** `Bad`：封装当前用例复用的操作、回调或断言步骤。 */
    function Bad() {
      // eslint-disable-next-line no-throw-literal
      throw null;
    }

    let didError;
    let error;
    try {
      ReactDOMServer.renderToString(<Bad />);
    } catch (err) {
      didError = true;
      error = err;
    }
    expect(didError).toBe(true);
    expect(error).toBe(null);
  });

  /** 测试场景：验证「does not get confused by throwing undefined」描述的渲染、交互或错误处理结果。 */
  it('does not get confused by throwing undefined', () => {
    /** `Bad`：封装当前用例复用的操作、回调或断言步骤。 */
    function Bad() {
      // eslint-disable-next-line no-throw-literal
      throw undefined;
    }

    let didError;
    let error;
    try {
      ReactDOMServer.renderToString(<Bad />);
    } catch (err) {
      didError = true;
      error = err;
    }
    expect(didError).toBe(true);
    expect(error).toBe(undefined);
  });

  /** 测试场景：验证「does not get confused by throwing a primitive」描述的渲染、交互或错误处理结果。 */
  it('does not get confused by throwing a primitive', () => {
    /** `Bad`：封装当前用例复用的操作、回调或断言步骤。 */
    function Bad() {
      // eslint-disable-next-line no-throw-literal
      throw 'foo';
    }

    let didError;
    let error;
    try {
      ReactDOMServer.renderToString(<Bad />);
    } catch (err) {
      didError = true;
      error = err;
    }
    expect(didError).toBe(true);
    expect(error).toBe('foo');
  });

  /** 测试场景：验证「should throw (in dev) when children are mutated during render」描述的渲染、交互或错误处理结果。 */
  it('should throw (in dev) when children are mutated during render', () => {
    /** `Wrapper`：封装当前用例复用的操作、回调或断言步骤。 */
    function Wrapper(props) {
      props.children[1] = <p key={1} />; // 突变是违法的
      return <div>{props.children}</div>;
    }
    if (__DEV__) {
      expect(() => {
        ReactDOMServer.renderToStaticMarkup(
          <Wrapper>
            <span key={0} />
            <span key={1} />
            <span key={2} />
          </Wrapper>,
        );
      }).toThrowError(/Cannot assign to read only property.*/);
    } else {
      expect(
        ReactDOMServer.renderToStaticMarkup(
          <Wrapper>
            <span key={0} />
            <span key={1} />
            <span key={2} />
          </Wrapper>,
        ),
      ).toContain('<p>');
    }
  });

  /** 测试场景：验证「warns about lowercase html but not in svg tags」描述的渲染、交互或错误处理结果。 */
  it('warns about lowercase html but not in svg tags', () => {
    /** `CompositeG`：封装当前用例复用的操作、回调或断言步骤。 */
    function CompositeG(props) {
      // 确保命名空间通过复合组件传递
      return <g>{props.children}</g>;
    }
    ReactDOMServer.renderToStaticMarkup(
      <div>
        <inPUT />
        <svg>
          <CompositeG>
            <linearGradient />
            <foreignObject>
              {/* 回到 HTML */}
              <iFrame />
            </foreignObject>
          </CompositeG>
        </svg>
      </div>,
    );
    assertConsoleErrorDev([
      '<inPUT /> is using incorrect casing. ' +
        'Use PascalCase for React components, ' +
        'or lowercase for HTML elements.\n' +
        '    in inPUT (at **)',
      // linearGradient 不会警告
      '<iFrame /> is using incorrect casing. ' +
        'Use PascalCase for React components, ' +
        'or lowercase for HTML elements.\n' +
        '    in iFrame (at **)',
    ]);
  });

  /** 测试场景：验证「should warn about contentEditable and children」描述的渲染、交互或错误处理结果。 */
  it('should warn about contentEditable and children', () => {
    ReactDOMServer.renderToString(<div contentEditable={true} children="" />);
    assertConsoleErrorDev([
      'A component is `contentEditable` and contains `children` ' +
        'managed by React. It is now your responsibility to guarantee that ' +
        'none of those nodes are unexpectedly modified or duplicated. This ' +
        'is probably not intentional.\n' +
        '    in div (at **)',
    ]);
  });

  /** 测试场景：验证「should warn when server rendering a class with a render method that does not extend React.Component」描述的渲染、交互或错误处理结果。 */
  it('should warn when server rendering a class with a render method that does not extend React.Component', () => {
    /** `ClassWithRenderNotExtended`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ClassWithRenderNotExtended {
      /** `ClassWithRenderNotExtended.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    expect(() =>
      ReactDOMServer.renderToString(<ClassWithRenderNotExtended />),
    ).toThrow(TypeError);
    assertConsoleErrorDev([
      'The <ClassWithRenderNotExtended /> component appears to have a render method, ' +
        "but doesn't extend React.Component. This is likely to cause errors. " +
        'Change ClassWithRenderNotExtended to extend React.Component instead.\n' +
        '    in ClassWithRenderNotExtended (at **)',
    ]);

    // 测试去重逻辑。
    expect(() => {
      ReactDOMServer.renderToString(<ClassWithRenderNotExtended />);
    }).toThrow(TypeError);
  });

  // 我们只是测试导入，而不是使用它。 这是因为即使是在是模块化组件中，它也可能导入它。
  /** 测试场景：验证「can import react-dom in Node environment」描述的渲染、交互或错误处理结果。 */
  it('can import react-dom in Node environment', () => {
    if (
      typeof requestAnimationFrame !== 'undefined' ||
      global.hasOwnProperty('requestAnimationFrame') ||
      typeof requestIdleCallback !== 'undefined' ||
      global.hasOwnProperty('requestIdleCallback') ||
      typeof window !== 'undefined' ||
      global.hasOwnProperty('window')
    ) {
      // 不要删除此检查：本测试专门验证这些全局变量不存在时的行为，否则测试没有意义。
      throw new Error('Expected this test to run in a Node environment.');
    }
    jest.resetModules();
    expect(() => {
      require('react-dom');
    }).not.toThrow();
  });

  /** 测试场景：验证「includes a useful stack in warnings」描述的渲染、交互或错误处理结果。 */
  it('includes a useful stack in warnings', () => {
    /** `A`：封装当前用例复用的操作、回调或断言步骤。 */
    function A() {
      return null;
    }

    /** `B`：封装当前用例复用的操作、回调或断言步骤。 */
    function B() {
      return (
        <font>
          <C>
            <span ariaTypo="no" />
          </C>
        </font>
      );
    }

    /** `C`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class C extends React.Component {
      /** `C.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <b>{this.props.children}</b>;
      }
    }

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      return [<A key="1" />, <B key="2" />, <span ariaTypo2="no" key="3" />];
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div>
          <section />
          <span>
            <Child />
          </span>
        </div>
      );
    }

    ReactDOMServer.renderToString(<App />);
    assertConsoleErrorDev([
      'Invalid ARIA attribute `ariaTypo`. ARIA attributes follow the pattern aria-* and must be lowercase.\n' +
        '    in span (at **)\n' +
        '    in B (at **)\n' +
        '    in Child (at **)\n' +
        '    in App (at **)',
      'Invalid ARIA attribute `ariaTypo2`. ARIA attributes follow the pattern aria-* and must be lowercase.\n' +
        '    in span (at **)\n' +
        '    in Child (at **)\n' +
        '    in App (at **)',
    ]);
  });

  /** 测试场景：验证「reports stacks with re-entrant renderToString() calls」描述的渲染、交互或错误处理结果。 */
  it('reports stacks with re-entrant renderToString() calls', () => {
    /** `Child2`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child2(props) {
      return <span ariaTypo3="no">{props.children}</span>;
    }

    /** `App2`：封装当前用例复用的操作、回调或断言步骤。 */
    function App2() {
      return (
        <Child2>
          {ReactDOMServer.renderToString(<blink ariaTypo2="no" />)}
        </Child2>
      );
    }

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      return (
        <span ariaTypo4="no">{ReactDOMServer.renderToString(<App2 />)}</span>
      );
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div>
          <span ariaTypo="no" />
          <Child />
          <font ariaTypo5="no" />
        </div>
      );
    }

    ReactDOMServer.renderToString(<App />);
    assertConsoleErrorDev([
      // ReactDOMServer(App > div > span)
      'Invalid ARIA attribute `ariaTypo`. ARIA attributes follow the pattern aria-* and must be lowercase.\n' +
        '    in span (at **)\n' +
        '    in App (at **)',
      // ReactDOMServer(App > div > Child) >>> ReactDOMServer(App2) >>> ReactDOMServer(blink)
      'Invalid ARIA attribute `ariaTypo2`. ARIA attributes follow the pattern aria-* and must be lowercase.\n' +
        '    in blink (at **)\n' +
        '    in App2 (at **)\n' +
        '    in Child (at **)\n' +
        '    in App (at **)',
      // ReactDOMServer(App > div > Child) >>> ReactDOMServer(App2 > Child2 > span)
      'Invalid ARIA attribute `ariaTypo3`. ARIA attributes follow the pattern aria-* and must be lowercase.\n' +
        '    in span (at **)\n' +
        '    in Child2 (at **)\n' +
        '    in App2 (at **)\n' +
        '    in Child (at **)\n' +
        '    in App (at **)',
      // ReactDOMServer(App > div > Child > span)
      'Invalid ARIA attribute `ariaTypo4`. ARIA attributes follow the pattern aria-* and must be lowercase.\n' +
        '    in span (at **)\n' +
        '    in Child (at **)\n' +
        '    in App (at **)',
      // ReactDOMServer(App > div > font)
      'Invalid ARIA attribute `ariaTypo5`. ARIA attributes follow the pattern aria-* and must be lowercase.\n' +
        '    in font (at **)\n' +
        '    in App (at **)',
    ]);
  });

  /** 测试场景：验证「should warn if an invalid contextType is defined」描述的渲染、交互或错误处理结果。 */
  it('should warn if an invalid contextType is defined', () => {
    const Context = React.createContext();
    /** `ComponentA`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ComponentA extends React.Component {
      /** `ComponentA.contextType`：记录测试夹具在当前场景中的状态。 */
      static contextType = Context.Consumer;
      /** `ComponentA.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    ReactDOMServer.renderToString(<ComponentA />);
    assertConsoleErrorDev([
      'ComponentA defines an invalid contextType. ' +
        'contextType should point to the Context object returned by React.createContext(). ' +
        'Did you accidentally pass the Context.Consumer instead?\n' +
        '    in ComponentA (at **)',
    ]);

    // 警告应按组件类型去重
    ReactDOMServer.renderToString(<ComponentA />);

    /** `ComponentB`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ComponentB extends React.Component {
      /** `ComponentB.contextType`：记录测试夹具在当前场景中的状态。 */
      static contextType = Context.Provider;
      /** `ComponentB.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }
    // 不会警告，因为 Context 等于 Context.Provider。
    ReactDOMServer.renderToString(<ComponentB />);
  });

  /** 测试场景：验证「should not warn when class contextType is null」描述的渲染、交互或错误处理结果。 */
  it('should not warn when class contextType is null', () => {
    /** `Foo`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Foo extends React.Component {
      /** `Foo.contextType`：记录测试夹具在当前场景中的状态。 */
      static contextType = null; // 用于条件声明的便捷方法
      /** `Foo.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return this.context.hello.world;
      }
    }

    expect(() => {
      ReactDOMServer.renderToString(<Foo />);
    }).toThrow("Cannot read property 'world' of undefined");
  });

  /** 测试场景：验证「should warn when class contextType is undefined」描述的渲染、交互或错误处理结果。 */
  it('should warn when class contextType is undefined', () => {
    /** `Foo`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Foo extends React.Component {
      // 这通常发生在循环依赖中 https://github.com/facebook/react/issues/13969
      static contextType = undefined;
      /** `Foo.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return this.context.hello.world;
      }
    }

    expect(() => {
      ReactDOMServer.renderToString(<Foo />);
    }).toThrow("Cannot read property 'world' of undefined");
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

  /** 测试场景：验证「should warn when class contextType is an object」描述的渲染、交互或错误处理结果。 */
  it('should warn when class contextType is an object', () => {
    /** `Foo`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Foo extends React.Component {
      // 可能是由于拼写错误引起的。
      static contextType = {
        x: 42,
        y: 'hello',
      };
      /** `Foo.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return this.context.hello.world;
      }
    }

    expect(() => {
      ReactDOMServer.renderToString(<Foo />);
    }).toThrow("Cannot read property 'hello' of undefined");
    assertConsoleErrorDev([
      'Foo defines an invalid contextType. ' +
        'contextType should point to the Context object returned by React.createContext(). ' +
        'However, it is set to an object with keys {x, y}.\n' +
        '    in Foo (at **)',
    ]);
  });

  /** 测试场景：验证「should warn when class contextType is a primitive」描述的渲染、交互或错误处理结果。 */
  it('should warn when class contextType is a primitive', () => {
    /** `Foo`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Foo extends React.Component {
      /** `Foo.contextType`：记录测试夹具在当前场景中的状态。 */
      static contextType = 'foo';
      /** `Foo.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return this.context.hello.world;
      }
    }

    expect(() => {
      ReactDOMServer.renderToString(<Foo />);
    }).toThrow("Cannot read property 'world' of undefined");
    assertConsoleErrorDev([
      'Foo defines an invalid contextType. ' +
        'contextType should point to the Context object returned by React.createContext(). ' +
        'However, it is set to a string.\n' +
        '    in Foo (at **)',
    ]);
  });

  describe('custom element server rendering', () => {
    /** 测试场景：验证「String properties should be server rendered for custom elements」描述的渲染、交互或错误处理结果。 */
    it('String properties should be server rendered for custom elements', () => {
      const output = ReactDOMServer.renderToString(
        <my-custom-element foo="bar" />,
      );
      expect(output).toBe(`<my-custom-element foo="bar"></my-custom-element>`);
    });

    /** 测试场景：验证「Number properties should be server rendered for custom elements」描述的渲染、交互或错误处理结果。 */
    it('Number properties should be server rendered for custom elements', () => {
      const output = ReactDOMServer.renderToString(
        <my-custom-element foo={5} />,
      );
      expect(output).toBe(`<my-custom-element foo="5"></my-custom-element>`);
    });

    /** 测试场景：验证「Object properties should not be server rendered for custom elements」描述的渲染、交互或错误处理结果。 */
    it('Object properties should not be server rendered for custom elements', () => {
      const output = ReactDOMServer.renderToString(
        <my-custom-element foo={{foo: 'bar'}} />,
      );
      expect(output).toBe(`<my-custom-element></my-custom-element>`);
    });

    /** 测试场景：验证「Array properties should not be server rendered for custom elements」描述的渲染、交互或错误处理结果。 */
    it('Array properties should not be server rendered for custom elements', () => {
      const output = ReactDOMServer.renderToString(
        <my-custom-element foo={['foo', 'bar']} />,
      );
      expect(output).toBe(`<my-custom-element></my-custom-element>`);
    });

    /** 测试场景：验证「Function properties should not be server rendered for custom elements」描述的渲染、交互或错误处理结果。 */
    it('Function properties should not be server rendered for custom elements', () => {
      const output = ReactDOMServer.renderToString(
        <my-custom-element foo={() => console.log('bar')} />,
      );
      expect(output).toBe(`<my-custom-element></my-custom-element>`);
    });
  });
});
