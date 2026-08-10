/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let PropTypes;
let React;
let ReactDOM;
let ReactDOMClient;
let assertConsoleErrorDev;
let assertConsoleWarnDev;

describe('ReactES6Class', () => {
  let container;
  let root;
  /** 冻结测试值，模拟不可变输入并暴露意外写入。 */
  const freeze = function (expectation) {
    Object.freeze(expectation);
    return expectation;
  };
  let Inner;
  let attachedListener = null;
  let renderedName = null;

  beforeEach(() => {
    PropTypes = require('prop-types');
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ({
      assertConsoleErrorDev,
      assertConsoleWarnDev,
    } = require('internal-test-utils'));
    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    attachedListener = null;
    renderedName = null;
    Inner = class extends React.Component {
      /** 实现“ReactES6Class”场景所需的“getName”测试夹具行为。 */
      getName() {
        return this.props.name;
      }
      /** 渲染“ReactES6Class”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        attachedListener = this.props.onClick;
        renderedName = this.props.name;
        return <div className={this.props.name} />;
      }
    };
  });

  /** 执行“ReactES6Class”场景的最小渲染流程，并把错误交给测试断言。 */
  function runTest(element, expectedTag, expectedClassName) {
    ReactDOM.flushSync(() => root.render(element));
    expect(container.firstChild).not.toBeNull();
    expect(container.firstChild.tagName).toBe(expectedTag);
    expect(container.firstChild.className).toBe(expectedClassName);
  }

  /**
   * Given：已建立该文件所需的 renderer、容器与测试夹具。
   * When：执行“preserves the name of the class for use in error messages”场景的唯一关键操作。
   * Then：断言 ES6 class 组件的状态与生命周期契约 的可观察结果。
   *
   * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
   */
  it('preserves the name of the class for use in error messages', () => {
    /** 作为“preserves the name of the class for use in error messages”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {}
    expect(Foo.name).toBe('Foo');
  });

  /**
   * 场景：“throws if no render function is defined”。
   * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
   */
  it('throws if no render function is defined', () => {
    /** 作为“throws if no render function is defined”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {}
    const caughtErrors = [];
    /** 收集“throws if no render function is defined”场景的未捕获错误，避免错误输出干扰断言。 */
    function errorHandler(event) {
      event.preventDefault();
      caughtErrors.push(event.error);
    }
    window.addEventListener('error', errorHandler);
    try {
      ReactDOM.flushSync(() => root.render(<Foo />));
      assertConsoleErrorDev([
      // DEV 并发模式会重试失败组件，因此该组件总计渲染两次。
        'No `render` method found on the Foo instance: ' +
          'you may have forgotten to define `render`.\n' +
          '    in Foo (at **)',
        'No `render` method found on the Foo instance: ' +
          'you may have forgotten to define `render`.\n' +
          '    in Foo (at **)',
      ]);
    } finally {
      window.removeEventListener('error', errorHandler);
    }
    expect(caughtErrors).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('is not a function'),
      }),
    ]);
  });

  /**
   * 场景：“renders a simple stateless component with prop”。
   * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
   */
  it('renders a simple stateless component with prop', () => {
    /** 作为“renders a simple stateless component with prop”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 渲染“renders a simple stateless component with prop”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <Inner name={this.props.bar} />;
      }
    }
    runTest(<Foo bar="foo" />, 'DIV', 'foo');
    runTest(<Foo bar="bar" />, 'DIV', 'bar');
  });

  /**
   * 场景：“renders based on state using initial values in this.props”。
   * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
   */
  it('renders based on state using initial values in this.props', () => {
    /** 作为“renders based on state using initial values in this.props”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 初始化“renders based on state using initial values in this.props”场景所需的实例状态与观测记录。 */
      constructor(props) {
        super(props);
        this.state = {bar: this.props.initialValue};
      }
      /** 渲染“renders based on state using initial values in this.props”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <span className={this.state.bar} />;
      }
    }
    runTest(<Foo initialValue="foo" />, 'SPAN', 'foo');
  });

  /**
   * 场景：“renders based on state using props in the constructor”。
   * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
   */
  it('renders based on state using props in the constructor', () => {
    /** 作为“renders based on state using props in the constructor”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 初始化“renders based on state using props in the constructor”场景所需的实例状态与观测记录。 */
      constructor(props) {
        super(props);
        this.state = {bar: props.initialValue};
      }
      /** 触发“renders based on state using props in the constructor”场景的状态更新，作为测试唯一更新动作。 */
      changeState() {
        this.setState({bar: 'bar'});
      }
      /** 渲染“renders based on state using props in the constructor”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        if (this.state.bar === 'foo') {
          return <div className="foo" />;
        }
        return <span className={this.state.bar} />;
      }
    }
    const ref = React.createRef();
    runTest(<Foo initialValue="foo" ref={ref} />, 'DIV', 'foo');
    ReactDOM.flushSync(() => ref.current.changeState());
    runTest(<Foo />, 'SPAN', 'bar');
  });

  /**
   * 场景：“sets initial state with value returned by static getDerivedStateFromProps”。
   * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
   */
  it('sets initial state with value returned by static getDerivedStateFromProps', () => {
    /** 作为“sets initial state with value returned by static getDerivedStateFromProps”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 保存“sets initial state with value returned by static getDerivedStateFromProps”场景用于驱动更新或错误回退的组件状态。 */
      state = {};
      /** 根据新属性派生“sets initial state with value returned by static getDerivedStateFromProps”场景的状态，用于验证静态生命周期语义。 */
      static getDerivedStateFromProps(nextProps, prevState) {
        return {
          foo: nextProps.foo,
          bar: 'bar',
        };
      }
      /** 渲染“sets initial state with value returned by static getDerivedStateFromProps”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div className={`${this.state.foo} ${this.state.bar}`} />;
      }
    }
    runTest(<Foo foo="foo" />, 'DIV', 'foo bar');
  });

  /**
   * 场景：“warns if getDerivedStateFromProps is not static”。
   * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
   */
  it('warns if getDerivedStateFromProps is not static', () => {
    /** 作为“warns if getDerivedStateFromProps is not static”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 根据新属性派生“warns if getDerivedStateFromProps is not static”场景的状态，用于验证静态生命周期语义。 */
      getDerivedStateFromProps() {
        return {};
      }
      /** 渲染“warns if getDerivedStateFromProps is not static”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div />;
      }
    }
    ReactDOM.flushSync(() => root.render(<Foo foo="foo" />));
    assertConsoleErrorDev([
      'Foo: getDerivedStateFromProps() is defined as an instance method ' +
        'and will be ignored. Instead, declare it as a static method.\n' +
        '    in Foo (at **)',
    ]);
  });

  /**
   * 场景：“warns if getDerivedStateFromError is not static”。
   * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
   */
  it('warns if getDerivedStateFromError is not static', () => {
    /** 作为“warns if getDerivedStateFromError is not static”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 把渲染错误转换为“warns if getDerivedStateFromError is not static”场景的回退状态。 */
      getDerivedStateFromError() {
        return {};
      }
      /** 渲染“warns if getDerivedStateFromError is not static”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div />;
      }
    }
    ReactDOM.flushSync(() => root.render(<Foo foo="foo" />));
    assertConsoleErrorDev([
      'Foo: getDerivedStateFromError() is defined as an instance method ' +
        'and will be ignored. Instead, declare it as a static method.\n' +
        '    in Foo (at **)',
    ]);
  });

  /**
   * 场景：“warns if getSnapshotBeforeUpdate is static”。
   * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
   */
  it('warns if getSnapshotBeforeUpdate is static', () => {
    /** 作为“warns if getSnapshotBeforeUpdate is static”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 在提交变更前捕获“warns if getSnapshotBeforeUpdate is static”场景需要交给更新后生命周期的快照。 */
      static getSnapshotBeforeUpdate() {}
      /** 渲染“warns if getSnapshotBeforeUpdate is static”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div />;
      }
    }
    ReactDOM.flushSync(() => root.render(<Foo foo="foo" />));
    assertConsoleErrorDev([
      'Foo: getSnapshotBeforeUpdate() is defined as a static method ' +
        'and will be ignored. Instead, declare it as an instance method.\n' +
        '    in Foo (at **)',
    ]);
  });

  /**
   * 场景：“warns if state not initialized before static getDerivedStateFromProps”。
   * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
   */
  it('warns if state not initialized before static getDerivedStateFromProps', () => {
    /** 作为“warns if state not initialized before static getDerivedStateFromProps”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 根据新属性派生“warns if state not initialized before static getDerivedStateFromProps”场景的状态，用于验证静态生命周期语义。 */
      static getDerivedStateFromProps(nextProps, prevState) {
        return {
          foo: nextProps.foo,
          bar: 'bar',
        };
      }
      /** 渲染“warns if state not initialized before static getDerivedStateFromProps”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div className={`${this.state.foo} ${this.state.bar}`} />;
      }
    }
    ReactDOM.flushSync(() => root.render(<Foo foo="foo" />));
    assertConsoleErrorDev([
      '`Foo` uses `getDerivedStateFromProps` but its initial state is ' +
        'undefined. This is not recommended. Instead, define the initial state by ' +
        'assigning an object to `this.state` in the constructor of `Foo`. ' +
        'This ensures that `getDerivedStateFromProps` arguments have a consistent shape.\n' +
        '    in Foo (at **)',
    ]);
  });

  /**
   * 场景：“updates initial state with values returned by static getDerivedStateFromProps”。
   * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
   */
  it('updates initial state with values returned by static getDerivedStateFromProps', () => {
    /** 作为“updates initial state with values returned by static getDerivedStateFromProps”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 保存“updates initial state with values returned by static getDerivedStateFromProps”场景用于驱动更新或错误回退的组件状态。 */
      state = {
        foo: 'foo',
        bar: 'bar',
      };
      /** 根据新属性派生“updates initial state with values returned by static getDerivedStateFromProps”场景的状态，用于验证静态生命周期语义。 */
      static getDerivedStateFromProps(nextProps, prevState) {
        return {
          foo: `not-${prevState.foo}`,
        };
      }
      /** 渲染“updates initial state with values returned by static getDerivedStateFromProps”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div className={`${this.state.foo} ${this.state.bar}`} />;
      }
    }
    runTest(<Foo />, 'DIV', 'not-foo bar');
  });

  /**
   * 场景：“renders updated state with values returned by static getDerivedStateFromProps”。
   * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
   */
  it('renders updated state with values returned by static getDerivedStateFromProps', () => {
    /** 作为“renders updated state with values returned by static getDerivedStateFromProps”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 保存“renders updated state with values returned by static getDerivedStateFromProps”场景用于驱动更新或错误回退的组件状态。 */
      state = {
        value: 'initial',
      };
      /** 根据新属性派生“renders updated state with values returned by static getDerivedStateFromProps”场景的状态，用于验证静态生命周期语义。 */
      static getDerivedStateFromProps(nextProps, prevState) {
        if (nextProps.update) {
          return {
            value: 'updated',
          };
        }
        return null;
      }
      /** 渲染“renders updated state with values returned by static getDerivedStateFromProps”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div className={this.state.value} />;
      }
    }
    runTest(<Foo update={false} />, 'DIV', 'initial');
    runTest(<Foo update={true} />, 'DIV', 'updated');
  });

  if (!require('shared/ReactFeatureFlags').disableLegacyContext) {
    /**
     * 场景：“renders based on context in the constructor”。
     * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
     */
    it('renders based on context in the constructor', () => {
      /** 作为“renders based on context in the constructor”场景的组件夹具，隔离待验证的 React 行为。 */
      class Foo extends React.Component {
        /** 初始化“renders based on context in the constructor”场景所需的实例状态与观测记录。 */
        constructor(props, context) {
          super(props, context);
          this.state = {tag: context.tag, className: this.context.className};
        }

        /** 渲染“renders based on context in the constructor”场景所需的元素树，使断言能够观察协调与提交结果。 */
        render() {
          const Tag = this.state.tag;
          return <Tag className={this.state.className} />;
        }
      }

      Foo.contextTypes = {
        tag: PropTypes.string,
        className: PropTypes.string,
      };

      /** 作为“renders based on context in the constructor”场景的组件夹具，隔离待验证的 React 行为。 */
      class Outer extends React.Component {
        /** 向后代提供“renders based on context in the constructor”场景使用的旧版上下文值。 */
        getChildContext() {
          return {tag: 'span', className: 'foo'};
        }

        /** 渲染“renders based on context in the constructor”场景所需的元素树，使断言能够观察协调与提交结果。 */
        render() {
          return <Foo />;
        }
      }

      Outer.childContextTypes = {
        tag: PropTypes.string,
        className: PropTypes.string,
      };
      runTest(<Outer />, 'SPAN', 'foo');

      assertConsoleErrorDev([
        'Outer uses the legacy childContextTypes API which will soon be removed. ' +
          'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
          '    in Outer (at **)',
        'Foo uses the legacy contextTypes API which will soon be removed. ' +
          'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
          '    in Outer (at **)',
      ]);
    });
  }

  /**
   * 场景：“renders only once when setting state in componentWillMount”。
   * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
   */
  it('renders only once when setting state in componentWillMount', () => {
    let renderCount = 0;
    /** 作为“renders only once when setting state in componentWillMount”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 初始化“renders only once when setting state in componentWillMount”场景所需的实例状态与观测记录。 */
      constructor(props) {
        super(props);
        this.state = {bar: props.initialValue};
      }
      /** 记录“renders only once when setting state in componentWillMount”场景的旧版挂载前生命周期调用。 */
      UNSAFE_componentWillMount() {
        this.setState({bar: 'bar'});
      }
      /** 渲染“renders only once when setting state in componentWillMount”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        renderCount++;
        return <span className={this.state.bar} />;
      }
    }
    runTest(<Foo initialValue="foo" />, 'SPAN', 'bar');
    expect(renderCount).toBe(1);
  });

  /**
   * 场景：“should warn with non-object in the initial state property”。
   * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
   */
  it('should warn with non-object in the initial state property', () => {
    [['an array'], 'a string', 1234].forEach(function (state) {
      /** 作为“should warn with non-object in the initial state property”场景的组件夹具，隔离待验证的 React 行为。 */
      class Foo extends React.Component {
        /** 初始化“should warn with non-object in the initial state property”场景所需的实例状态与观测记录。 */
        constructor() {
          super();
          this.state = state;
        }
        /** 渲染“should warn with non-object in the initial state property”场景所需的元素树，使断言能够观察协调与提交结果。 */
        render() {
          return <span />;
        }
      }
      runTest(<Foo />, 'SPAN', '');
      assertConsoleErrorDev([
        'Foo.state: must be set to an object or null\n    in Foo (at **)',
      ]);
    });
  });

  /**
   * 场景：“should render with null in the initial state property”。
   * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
   */
  it('should render with null in the initial state property', () => {
    /** 作为“should render with null in the initial state property”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 初始化“should render with null in the initial state property”场景所需的实例状态与观测记录。 */
      constructor() {
        super();
        this.state = null;
      }
      /** 渲染“should render with null in the initial state property”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <span />;
      }
    }
    runTest(<Foo />, 'SPAN', '');
  });

  /**
   * 场景：“setState through an event handler”。
   * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
   */
  it('setState through an event handler', () => {
    /** 作为“setState through an event handler”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 初始化“setState through an event handler”场景所需的实例状态与观测记录。 */
      constructor(props) {
        super(props);
        this.state = {bar: props.initialValue};
      }
      /** 实现“setState through an event handler”场景所需的“handleClick”测试夹具行为。 */
      handleClick() {
        this.setState({bar: 'bar'});
      }
      /** 渲染“setState through an event handler”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return (
          <Inner name={this.state.bar} onClick={this.handleClick.bind(this)} />
        );
      }
    }
    runTest(<Foo initialValue="foo" />, 'DIV', 'foo');

    ReactDOM.flushSync(() => attachedListener());
    expect(renderedName).toBe('bar');
  });

  /**
   * 场景：“should not implicitly bind event handlers”。
   * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
   */
  it('should not implicitly bind event handlers', () => {
    /** 作为“should not implicitly bind event handlers”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 初始化“should not implicitly bind event handlers”场景所需的实例状态与观测记录。 */
      constructor(props) {
        super(props);
        this.state = {bar: props.initialValue};
      }
      /** 实现“should not implicitly bind event handlers”场景所需的“handleClick”测试夹具行为。 */
      handleClick() {
        this.setState({bar: 'bar'});
      }
      /** 渲染“should not implicitly bind event handlers”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <Inner name={this.state.bar} onClick={this.handleClick} />;
      }
    }
    runTest(<Foo initialValue="foo" />, 'DIV', 'foo');
    expect(attachedListener).toThrow();
  });

  /**
   * 场景：“renders using forceUpdate even when there is no state”。
   * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
   */
  it('renders using forceUpdate even when there is no state', () => {
    /** 作为“renders using forceUpdate even when there is no state”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 初始化“renders using forceUpdate even when there is no state”场景所需的实例状态与观测记录。 */
      constructor(props) {
        super(props);
        this.mutativeValue = props.initialValue;
      }
      /** 实现“renders using forceUpdate even when there is no state”场景所需的“handleClick”测试夹具行为。 */
      handleClick() {
        this.mutativeValue = 'bar';
        this.forceUpdate();
      }
      /** 渲染“renders using forceUpdate even when there is no state”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return (
          <Inner
            name={this.mutativeValue}
            onClick={this.handleClick.bind(this)}
          />
        );
      }
    }
    runTest(<Foo initialValue="foo" />, 'DIV', 'foo');
    ReactDOM.flushSync(() => attachedListener());
    expect(renderedName).toBe('bar');
  });

  /**
   * 场景：“will call all the normal life cycle methods”。
   * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
   */
  it('will call all the normal life cycle methods', () => {
    let lifeCycles = [];
    /** 作为“will call all the normal life cycle methods”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 初始化“will call all the normal life cycle methods”场景所需的实例状态与观测记录。 */
      constructor() {
        super();
        this.state = {};
      }
      /** 记录“will call all the normal life cycle methods”场景的旧版挂载前生命周期调用。 */
      UNSAFE_componentWillMount() {
        lifeCycles.push('will-mount');
      }
      /** 记录“will call all the normal life cycle methods”场景的挂载提交，并执行仅在挂载后有效的观测。 */
      componentDidMount() {
        lifeCycles.push('did-mount');
      }
      /** 记录“will call all the normal life cycle methods”场景接收新属性时的旧版生命周期调用。 */
      UNSAFE_componentWillReceiveProps(nextProps) {
        lifeCycles.push('receive-props', nextProps);
      }
      /** 决定“will call all the normal life cycle methods”场景是否继续协调，并让测试验证跳过更新的边界。 */
      shouldComponentUpdate(nextProps, nextState) {
        lifeCycles.push('should-update', nextProps, nextState);
        return true;
      }
      /** 记录“will call all the normal life cycle methods”场景的旧版更新前生命周期调用。 */
      UNSAFE_componentWillUpdate(nextProps, nextState) {
        lifeCycles.push('will-update', nextProps, nextState);
      }
      /** 记录“will call all the normal life cycle methods”场景的更新提交，供生命周期顺序断言使用。 */
      componentDidUpdate(prevProps, prevState) {
        lifeCycles.push('did-update', prevProps, prevState);
      }
      /** 记录并清理“will call all the normal life cycle methods”场景的卸载副作用。 */
      componentWillUnmount() {
        lifeCycles.push('will-unmount');
      }
      /** 渲染“will call all the normal life cycle methods”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <span className={this.props.value} />;
      }
    }
    runTest(<Foo value="foo" />, 'SPAN', 'foo');
    expect(lifeCycles).toEqual(['will-mount', 'did-mount']);
    lifeCycles = []; // 重置生命周期记录，隔离下一次提交。
    runTest(<Foo value="bar" />, 'SPAN', 'bar');
    // prettier-ignore
    expect(lifeCycles).toEqual([
      'receive-props', freeze({value: 'bar'}),
      'should-update', freeze({value: 'bar'}), {},
      'will-update', freeze({value: 'bar'}), {},
      'did-update', freeze({value: 'foo'}), {},
    ]);
    lifeCycles = []; // 重置生命周期记录，隔离下一次提交。
    ReactDOM.flushSync(() => root.unmount());
    expect(lifeCycles).toEqual(['will-unmount']);
  });

  if (!require('shared/ReactFeatureFlags').disableLegacyContext) {
    /**
     * 场景：“warns when classic properties are defined on the instance, but does not invoke them.”。
     * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
     */
    it('warns when classic properties are defined on the instance, but does not invoke them.', () => {
      let getDefaultPropsWasCalled = false;
      let getInitialStateWasCalled = false;
      /** 作为“warns when classic properties are defined on the instance, but does not invoke them.”场景的组件夹具，隔离待验证的 React 行为。 */
      class Foo extends React.Component {
        /** 初始化“warns when classic properties are defined on the instance, but does not invoke them.”场景所需的实例状态与观测记录。 */
        constructor() {
          super();
          this.contextTypes = {};
          this.contextType = {};
        }
        /** 返回“warns when classic properties are defined on the instance, but does not invoke them.”场景的初始状态，供后续更新断言比较。 */
        getInitialState() {
          getInitialStateWasCalled = true;
          return {};
        }
        /** 实现“warns when classic properties are defined on the instance, but does not invoke them.”场景所需的“getDefaultProps”测试夹具行为。 */
        getDefaultProps() {
          getDefaultPropsWasCalled = true;
          return {};
        }
        /** 渲染实例经典属性场景所需的元素树，供断言观察提交结果。 */
        render() {
          return <span className="foo" />;
        }
      }

      runTest(<Foo />, 'SPAN', 'foo');
      assertConsoleErrorDev([
        'getInitialState was defined on Foo, a plain JavaScript class. ' +
          'This is only supported for classes created using React.createClass. ' +
          'Did you mean to define a state property instead?\n' +
          '    in Foo (at **)',
        'getDefaultProps was defined on Foo, a plain JavaScript class. ' +
          'This is only supported for classes created using React.createClass. ' +
          'Use a static property to define defaultProps instead.\n' +
          '    in Foo (at **)',
        'contextType was defined as an instance property on Foo. ' +
          'Use a static property to define contextType instead.\n' +
          '    in Foo (at **)',
        'contextTypes was defined as an instance property on Foo. ' +
          'Use a static property to define contextTypes instead.\n' +
          '    in Foo (at **)',
      ]);
      expect(getInitialStateWasCalled).toBe(false);
      expect(getDefaultPropsWasCalled).toBe(false);
    });
  }

  /**
   * 场景：“does not warn about getInitialState() on class components if state is also defined.”。
   * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
   */
  it('does not warn about getInitialState() on class components if state is also defined.', () => {
    /** 作为“does not warn about getInitialState() on class components if state is also defined.”场景的组件夹具，隔离待验证的 React 行为。 */
    class Foo extends React.Component {
      /** 保存“does not warn about getInitialState() on class components if state is also defined.”场景用于驱动更新或错误回退的组件状态。 */
      state = this.getInitialState();
      /** 返回“does not warn about getInitialState() on class components if state is also defined.”场景的初始状态，供后续更新断言比较。 */
      getInitialState() {
        return {};
      }
      /** 渲染“does not warn about getInitialState() on class components if state is also defined.”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <span className="foo" />;
      }
    }
    runTest(<Foo />, 'SPAN', 'foo');
  });

  /**
   * 场景：“should warn when misspelling shouldComponentUpdate”。
   * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
   */
  it('should warn when misspelling shouldComponentUpdate', () => {
    /** 作为“should warn when misspelling shouldComponentUpdate”场景的组件夹具，隔离待验证的 React 行为。 */
    class NamedComponent extends React.Component {
      /** 实现“should warn when misspelling shouldComponentUpdate”场景所需的“componentShouldUpdate”测试夹具行为。 */
      componentShouldUpdate() {
        return false;
      }
      /** 渲染“should warn when misspelling shouldComponentUpdate”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <span className="foo" />;
      }
    }

    runTest(<NamedComponent />, 'SPAN', 'foo');
    assertConsoleErrorDev([
      'NamedComponent has a method called componentShouldUpdate(). Did you ' +
        'mean shouldComponentUpdate()? The name is phrased as a question ' +
        'because the function is expected to return a value.\n' +
        '    in NamedComponent (at **)',
    ]);
  });

  /**
   * 场景：“should warn when misspelling componentWillReceiveProps”。
   * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
   */
  it('should warn when misspelling componentWillReceiveProps', () => {
    /** 作为“should warn when misspelling componentWillReceiveProps”场景的组件夹具，隔离待验证的 React 行为。 */
    class NamedComponent extends React.Component {
      /** 实现“should warn when misspelling componentWillReceiveProps”场景所需的“componentWillRecieveProps”测试夹具行为。 */
      componentWillRecieveProps() {
        return false;
      }
      /** 渲染“should warn when misspelling componentWillReceiveProps”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <span className="foo" />;
      }
    }

    runTest(<NamedComponent />, 'SPAN', 'foo');
    assertConsoleErrorDev([
      'NamedComponent has a method called componentWillRecieveProps(). Did ' +
        'you mean componentWillReceiveProps()?\n' +
        '     in NamedComponent (at **)',
    ]);
  });

  /**
   * 场景：“should warn when misspelling UNSAFE_componentWillReceiveProps”。
   * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
   */
  it('should warn when misspelling UNSAFE_componentWillReceiveProps', () => {
    /** 作为“should warn when misspelling UNSAFE_componentWillReceiveProps”场景的组件夹具，隔离待验证的 React 行为。 */
    class NamedComponent extends React.Component {
      /** 实现“should warn when misspelling UNSAFE_componentWillReceiveProps”场景所需的“UNSAFE_componentWillRecieveProps”测试夹具行为。 */
      UNSAFE_componentWillRecieveProps() {
        return false;
      }
      /** 渲染“should warn when misspelling UNSAFE_componentWillReceiveProps”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <span className="foo" />;
      }
    }

    runTest(<NamedComponent />, 'SPAN', 'foo');
    assertConsoleErrorDev([
      'NamedComponent has a method called UNSAFE_componentWillRecieveProps(). ' +
        'Did you mean UNSAFE_componentWillReceiveProps()?\n' +
        '    in NamedComponent (at **)',
    ]);
  });

  /**
   * 场景：“should throw AND warn when trying to access classic APIs”。
   * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
   */
  it('should throw AND warn when trying to access classic APIs', () => {
    const ref = React.createRef();
    runTest(<Inner name="foo" ref={ref} />, 'DIV', 'foo');

    expect(() => ref.current.replaceState({})).toThrow();
    assertConsoleWarnDev([
      'replaceState(...) is deprecated in plain JavaScript React classes. ' +
        'Refactor your code to use setState instead (see https://github.com/facebook/react/issues/3236).',
    ]);
    expect(() => ref.current.isMounted()).toThrow();
    assertConsoleWarnDev([
      'isMounted(...) is deprecated in plain JavaScript React classes. ' +
        'Instead, make sure to clean up subscriptions and pending requests in ' +
        'componentWillUnmount to prevent memory leaks.',
    ]);
  });

  if (!require('shared/ReactFeatureFlags').disableLegacyContext) {
    /**
     * 场景：“supports this.context passed via getChildContext”。
     * 机制：验证ES6 class 组件的状态与生命周期契约，锁定可观察结果与失败边界。
     */
    it('supports this.context passed via getChildContext', () => {
      /** 作为“supports this.context passed via getChildContext”场景的组件夹具，隔离待验证的 React 行为。 */
      class Bar extends React.Component {
        /** 渲染“supports this.context passed via getChildContext”场景所需的元素树，使断言能够观察协调与提交结果。 */
        render() {
          return <div className={this.context.bar} />;
        }
      }

      Bar.contextTypes = {bar: PropTypes.string};

      /** 作为“supports this.context passed via getChildContext”场景的组件夹具，隔离待验证的 React 行为。 */
      class Foo extends React.Component {
        /** 向后代提供“supports this.context passed via getChildContext”场景使用的旧版上下文值。 */
        getChildContext() {
          return {bar: 'bar-through-context'};
        }

        /** 渲染“supports this.context passed via getChildContext”场景所需的元素树，使断言能够观察协调与提交结果。 */
        render() {
          return <Bar />;
        }
      }

      Foo.childContextTypes = {bar: PropTypes.string};
      runTest(<Foo />, 'DIV', 'bar-through-context');
      assertConsoleErrorDev([
        'Foo uses the legacy childContextTypes API which will soon be removed. ' +
          'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
          '    in Foo (at **)',
        'Bar uses the legacy contextTypes API which will soon be removed. ' +
          'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
          '    in Foo (at **)',
      ]);
    });
  }
});
