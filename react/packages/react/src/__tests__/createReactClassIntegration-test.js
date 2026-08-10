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
let assertConsoleErrorDev;
let assertConsoleWarnDev;

let PropTypes;
let React;
let ReactDOMClient;
let createReactClass;

describe('create-react-class-integration', () => {
  beforeEach(() => {
    jest.resetModules();
    ({
      act,
      assertConsoleErrorDev,
      assertConsoleWarnDev,
    } = require('internal-test-utils'));
    PropTypes = require('prop-types');
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    createReactClass = require('create-react-class/factory')(
      React.Component,
      React.isValidElement,
      new React.Component().updater,
    );
  });

  /**
   * Given：已建立该文件所需的 renderer、容器与测试夹具。
   * When：执行“当前测试”场景的唯一关键操作。
   * Then：断言 createReactClass 的旧版 spec、状态与生命周期兼容契约 的可观察结果。
   *
   * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
   */
  it('should throw when `render` is not specified', () => {
    expect(function () {
      createReactClass({});
    }).toThrowError('Class specification must implement a `render` method.');
  });

  /**
   * 场景：“should copy prop types onto the Constructor”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('should copy prop types onto the Constructor', () => {
    const propValidator = jest.fn();
    const TestComponent = createReactClass({
      propTypes: {
        value: propValidator,
      },
      /** 渲染“should copy prop types onto the Constructor”场景所需的元素树，使断言能够观察兼容层的输出或诊断。 */
      render: function () {
        return <div />;
      },
    });

    expect(TestComponent.propTypes).toBeDefined();
    expect(TestComponent.propTypes.value).toBe(propValidator);
  });

  /**
   * 场景：“should warn on invalid prop types”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('should warn on invalid prop types', () => {
    createReactClass({
      displayName: 'Component',
      propTypes: {
        prop: null,
      },
      /** 渲染“should warn on invalid prop types”场景所需的元素树，使断言能够观察兼容层的输出或诊断。 */
      render: function () {
        return <span>{this.props.prop}</span>;
      },
    });
    assertConsoleErrorDev([
      'Warning: Component: prop type `prop` is invalid; ' +
        'it must be a function, usually from React.PropTypes.',
    ]);
  });

  /**
   * 场景：“should warn on invalid context types”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('should warn on invalid context types', () => {
    createReactClass({
      displayName: 'Component',
      contextTypes: {
        prop: null,
      },
      /** 渲染“should warn on invalid context types”场景所需的元素树，使断言能够观察兼容层的输出或诊断。 */
      render: function () {
        return <span>{this.props.prop}</span>;
      },
    });
    assertConsoleErrorDev([
      'Warning: Component: context type `prop` is invalid; ' +
        'it must be a function, usually from React.PropTypes.',
    ]);
  });

  /**
   * 场景：“should throw on invalid child context types”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('should throw on invalid child context types', () => {
    createReactClass({
      displayName: 'Component',
      childContextTypes: {
        prop: null,
      },
      /** 渲染“should throw on invalid child context types”场景所需的元素树，使断言能够观察兼容层的输出或诊断。 */
      render: function () {
        return <span>{this.props.prop}</span>;
      },
    });
    assertConsoleErrorDev([
      'Warning: Component: child context type `prop` is invalid; it must be a function, usually from React.PropTypes.',
    ]);
  });

  /**
   * 场景：“should warn when misspelling shouldComponentUpdate”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('should warn when misspelling shouldComponentUpdate', () => {
    createReactClass({
      /** 故意使用拼错的更新判定方法名，验证 createReactClass 给出纠正建议。 */
      componentShouldUpdate: function () {
        return false;
      },
      /** 渲染“should warn when misspelling shouldComponentUpdate”场景所需的元素树，使断言能够观察兼容层的输出或诊断。 */
      render: function () {
        return <div />;
      },
    });
    assertConsoleErrorDev([
      'Warning: A component has a method called componentShouldUpdate(). Did you ' +
        'mean shouldComponentUpdate()? The name is phrased as a question ' +
        'because the function is expected to return a value.',
    ]);

    createReactClass({
      displayName: 'NamedComponent',
      /** 故意使用拼错的更新判定方法名，验证 createReactClass 给出纠正建议。 */
      componentShouldUpdate: function () {
        return false;
      },
      /** 渲染“should warn when misspelling shouldComponentUpdate”场景所需的元素树，使断言能够观察兼容层的输出或诊断。 */
      render: function () {
        return <div />;
      },
    });
    assertConsoleErrorDev([
      'Warning: NamedComponent has a method called componentShouldUpdate(). Did you ' +
        'mean shouldComponentUpdate()? The name is phrased as a question ' +
        'because the function is expected to return a value.',
    ]);
  });

  /**
   * 场景：“should warn when misspelling componentWillReceiveProps”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('should warn when misspelling componentWillReceiveProps', () => {
    createReactClass({
      /** 故意使用拼错的旧版接收属性生命周期名，验证对应诊断。 */
      componentWillRecieveProps: function () {
        return false;
      },
      /** 渲染“should warn when misspelling componentWillReceiveProps”场景所需的元素树，使断言能够观察兼容层的输出或诊断。 */
      render: function () {
        return <div />;
      },
    });
    assertConsoleErrorDev([
      'Warning: A component has a method called componentWillRecieveProps(). Did you ' +
        'mean componentWillReceiveProps()?',
    ]);
  });

  /**
   * 场景：“should warn when misspelling UNSAFE_componentWillReceiveProps”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('should warn when misspelling UNSAFE_componentWillReceiveProps', () => {
    createReactClass({
      /** 故意拼错 UNSAFE 接收属性生命周期名，验证对应诊断。 */
      UNSAFE_componentWillRecieveProps: function () {
        return false;
      },
      /** 渲染“should warn when misspelling UNSAFE_componentWillReceiveProps”场景所需的元素树，使断言能够观察兼容层的输出或诊断。 */
      render: function () {
        return <div />;
      },
    });
    assertConsoleErrorDev([
      'Warning: A component has a method called UNSAFE_componentWillRecieveProps(). ' +
        'Did you mean UNSAFE_componentWillReceiveProps()?',
    ]);
  });

  /**
   * 场景：“should throw if a reserved property is in statics”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('should throw if a reserved property is in statics', () => {
    expect(function () {
      createReactClass({
        statics: {
          /** 返回静态默认属性夹具，用于验证保留 spec 键不能放入 statics。 */
          getDefaultProps: function () {
            return {
              foo: 0,
            };
          },
        },

        /** 渲染“should throw if a reserved property is in statics”场景所需的元素树，使断言能够观察兼容层的输出或诊断。 */
        render: function () {
          return <span />;
        },
      });
    }).toThrowError(
      'ReactClass: You are attempting to define a reserved property, ' +
        '`getDefaultProps`, that shouldn\'t be on the "statics" key. Define ' +
        'it as an instance property instead; it will still be accessible on ' +
        'the constructor.',
    );
  });

    // TODO：考虑把这些属性真正迁到 statics，或删除该兼容性单元测试。
  // eslint-disable-next-line jest/no-disabled-tests
  /**
   * 场景：“should warn when using deprecated non-static spec keys”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it.skip('should warn when using deprecated non-static spec keys', () => {
    createReactClass({
      mixins: [{}],
      propTypes: {
        foo: PropTypes.string,
      },
      contextTypes: {
        foo: PropTypes.string,
      },
      childContextTypes: {
        foo: PropTypes.string,
      },
      /** 渲染“should warn when using deprecated non-static spec keys”场景所需的元素树，使断言能够观察兼容层的输出或诊断。 */
      render: function () {
        return <div />;
      },
    });
    assertConsoleErrorDev([
      '`mixins` is now a static property and should ' +
        'be defined inside "statics".',
      '`propTypes` is now a static property and should ' +
        'be defined inside "statics".',
      '`contextTypes` is now a static property and ' +
        'should be defined inside "statics".',
      '`childContextTypes` is now a static property and ' +
        'should be defined inside "statics".',
    ]);
  });

  /**
   * 场景：“should support statics”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('should support statics', async () => {
    const Component = createReactClass({
      statics: {
        abc: 'def',
        def: 0,
        ghi: null,
        jkl: 'mno',
        /** 返回当前构造器，证明 statics 中的函数绑定到生成的组件类。 */
        pqr: function () {
          return this;
        },
      },

      /** 渲染“should support statics”场景所需的元素树，使断言能够观察兼容层的输出或诊断。 */
      render: function () {
        return <span />;
      },
    });
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let instance;
    await act(() => {
      root.render(<Component ref={current => (instance = current)} />);
    });

    expect(instance.constructor.abc).toBe('def');
    expect(Component.abc).toBe('def');
    expect(instance.constructor.def).toBe(0);
    expect(Component.def).toBe(0);
    expect(instance.constructor.ghi).toBe(null);
    expect(Component.ghi).toBe(null);
    expect(instance.constructor.jkl).toBe('mno');
    expect(Component.jkl).toBe('mno');
    expect(instance.constructor.pqr()).toBe(Component);
    expect(Component.pqr()).toBe(Component);
  });

  /**
   * 场景：“should work with object getInitialState() return values”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('should work with object getInitialState() return values', async () => {
    const Component = createReactClass({
      /** 返回“should work with object getInitialState() return values”场景的初始状态，供状态形状与更新语义断言使用。 */
      getInitialState: function () {
        return {
          occupation: 'clown',
        };
      },
      /** 渲染“should work with object getInitialState() return values”场景所需的元素树，使断言能够观察兼容层的输出或诊断。 */
      render: function () {
        return <span />;
      },
    });
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let instance;
    await act(() => {
      root.render(<Component ref={current => (instance = current)} />);
    });

    expect(instance.state.occupation).toEqual('clown');
  });

  /**
   * 场景：“should work with getDerivedStateFromProps() return values”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('should work with getDerivedStateFromProps() return values', async () => {
    const Component = createReactClass({
      /** 返回“should work with getDerivedStateFromProps() return values”场景的初始状态，供后续更新断言比较。 */
      getInitialState() {
        return {};
      },
      /** 渲染“should work with getDerivedStateFromProps() return values”场景所需的元素树，使断言能够观察兼容层的输出或诊断。 */
      render: function () {
        return <span />;
      },
    });
    Component.getDerivedStateFromProps = () => {
      return {occupation: 'clown'};
    };
    let instance;
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Component ref={current => (instance = current)} />);
    });
    expect(instance.state.occupation).toEqual('clown');
  });

  // @gate !disableLegacyContext
  /**
   * 场景：“renders based on context getInitialState”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('renders based on context getInitialState', async () => {
    const Foo = createReactClass({
      contextTypes: {
        className: PropTypes.string,
      },
      /** 返回“renders based on context getInitialState”场景的初始状态，供后续更新断言比较。 */
      getInitialState() {
        return {className: this.context.className};
      },
      /** 渲染“renders based on context getInitialState”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <span className={this.state.className} />;
      },
    });

    const Outer = createReactClass({
      childContextTypes: {
        className: PropTypes.string,
      },
      /** 向后代提供“renders based on context getInitialState”场景使用的旧版上下文值。 */
      getChildContext() {
        return {className: 'foo'};
      },
      /** 渲染“renders based on context getInitialState”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <Foo />;
      },
    });

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Outer />);
    });
    assertConsoleErrorDev([
      'Component uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)',
      'Component uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)' +
        '\n    in ReactClassComponent (at **)',
    ]);
    expect(container.firstChild.className).toBe('foo');
  });

  /**
   * 场景：“should throw with non-object getInitialState() return values”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('should throw with non-object getInitialState() return values', async () => {
    // eslint-disable-next-line no-for-of-loops/no-for-of-loops
    for (const state of [['an array'], 'a string', 1234]) {
      const Component = createReactClass({
        /** 返回“should throw with non-object getInitialState() return values”场景的初始状态，供状态形状与更新语义断言使用。 */
        getInitialState: function () {
          return state;
        },
        /** 渲染“should throw with non-object getInitialState() return values”场景所需的元素树，使断言能够观察兼容层的输出或诊断。 */
        render: function () {
          return <span />;
        },
      });
      const container = document.createElement('div');
      const root = ReactDOMClient.createRoot(container);
      await expect(
        act(() => {
          root.render(<Component />);
        }),
      ).rejects.toThrowError(
        'Component.getInitialState(): must return an object or null',
      );
    }
  });

  /**
   * 场景：“should work with a null getInitialState() return value”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('should work with a null getInitialState() return value', async () => {
    const Component = createReactClass({
      /** 返回“should work with a null getInitialState() return value”场景的初始状态，供状态形状与更新语义断言使用。 */
      getInitialState: function () {
        return null;
      },
      /** 渲染“should work with a null getInitialState() return value”场景所需的元素树，使断言能够观察兼容层的输出或诊断。 */
      render: function () {
        return <span />;
      },
    });
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await expect(
      act(() => {
        root.render(<Component />);
      }),
    ).resolves.not.toThrow();
  });

  /**
   * 场景：“should throw when using legacy factories”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('should throw when using legacy factories', () => {
    const Component = createReactClass({
      /** 渲染“should throw when using legacy factories”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div />;
      },
    });

    expect(() => Component()).toThrow();
    assertConsoleErrorDev([
      'Warning: Something is calling a React component directly. Use a ' +
        'factory or JSX instead. See: https://fb.me/react-legacyfactory',
    ]);
  });

  /**
   * 场景：“replaceState and callback works”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('replaceState and callback works', async () => {
    const ops = [];
    const Component = createReactClass({
      /** 返回“replaceState and callback works”场景的初始状态，供后续更新断言比较。 */
      getInitialState() {
        return {step: 0};
      },
      /** 渲染“replaceState and callback works”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        ops.push('Render: ' + this.state.step);
        return <div />;
      },
    });

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    let instance;
    await act(() => {
      root.render(<Component ref={current => (instance = current)} />);
    });

    await act(() => {
      instance.replaceState({step: 1}, () => {
        ops.push('Callback: ' + instance.state.step);
      });
    });

    expect(ops).toEqual(['Render: 0', 'Render: 1', 'Callback: 1']);
  });

  /**
   * 场景：“getDerivedStateFromProps updates state when props change”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('getDerivedStateFromProps updates state when props change', async () => {
    const Component = createReactClass({
      /** 返回“getDerivedStateFromProps updates state when props change”场景的初始状态，供后续更新断言比较。 */
      getInitialState() {
        return {
          count: 1,
        };
      },
      /** 渲染“getDerivedStateFromProps updates state when props change”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div>count:{this.state.count}</div>;
      },
    });
    Component.getDerivedStateFromProps = (nextProps, prevState) => ({
      count: prevState.count + nextProps.incrementBy,
    });

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <div>
          <Component incrementBy={0} />
        </div>,
      );
    });
    expect(container.firstChild.textContent).toEqual('count:1');
    await act(() => {
      root.render(
        <div>
          <Component incrementBy={2} />
        </div>,
      );
    });
    expect(container.firstChild.textContent).toEqual('count:3');
  });

  /**
   * 场景：“should support the new static getDerivedStateFromProps method”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('should support the new static getDerivedStateFromProps method', async () => {
    let instance;
    const Component = createReactClass({
      statics: {
        /** 根据新属性与旧状态返回“should support the new static getDerivedStateFromProps method”场景的派生状态补丁。 */
        getDerivedStateFromProps: function () {
          return {foo: 'bar'};
        },
      },

      /** 返回“should support the new static getDerivedStateFromProps method”场景的初始状态，供后续更新断言比较。 */
      getInitialState() {
        return {};
      },

      /** 渲染“should support the new static getDerivedStateFromProps method”场景所需的元素树，使断言能够观察兼容层的输出或诊断。 */
      render: function () {
        instance = this;
        return null;
      },
    });
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Component />);
    });
    expect(instance.state.foo).toBe('bar');
  });

  /**
   * 场景：“warns if getDerivedStateFromProps is not static”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('warns if getDerivedStateFromProps is not static', async () => {
    const Foo = createReactClass({
      displayName: 'Foo',
      /** 根据新属性派生“warns if getDerivedStateFromProps is not static”场景的状态，用于验证静态生命周期语义。 */
      getDerivedStateFromProps() {
        return {};
      },
      /** 渲染“warns if getDerivedStateFromProps is not static”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div />;
      },
    });
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Foo foo="foo" />);
    });
    assertConsoleErrorDev([
      'Foo: getDerivedStateFromProps() is defined as an instance method ' +
        'and will be ignored. Instead, declare it as a static method.\n' +
        '    in Foo (at **)',
    ]);
  });

  /**
   * 场景：“warns if getDerivedStateFromError is not static”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('warns if getDerivedStateFromError is not static', async () => {
    const Foo = createReactClass({
      displayName: 'Foo',
      /** 把渲染错误转换为“warns if getDerivedStateFromError is not static”场景的回退状态。 */
      getDerivedStateFromError() {
        return {};
      },
      /** 渲染“warns if getDerivedStateFromError is not static”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div />;
      },
    });
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Foo foo="foo" />);
    });
    assertConsoleErrorDev([
      'Foo: getDerivedStateFromError() is defined as an instance method ' +
        'and will be ignored. Instead, declare it as a static method.\n' +
        '    in Foo (at **)',
    ]);
  });

  /**
   * 场景：“warns if getSnapshotBeforeUpdate is static”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('warns if getSnapshotBeforeUpdate is static', async () => {
    const Foo = createReactClass({
      displayName: 'Foo',
      statics: {
        /** 在“warns if getSnapshotBeforeUpdate is static”场景提交变更前返回快照，供生命周期形状校验使用。 */
        getSnapshotBeforeUpdate: function () {
          return null;
        },
      },
      /** 渲染“warns if getSnapshotBeforeUpdate is static”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        return <div />;
      },
    });
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Foo foo="foo" />);
    });
    assertConsoleErrorDev([
      'Foo: getSnapshotBeforeUpdate() is defined as a static method ' +
        'and will be ignored. Instead, declare it as an instance method.\n' +
        '    in Foo (at **)',
    ]);
  });

  /**
   * 场景：“should warn if state is not properly initialized before getDerivedStateFromProps”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('should warn if state is not properly initialized before getDerivedStateFromProps', async () => {
    const Component = createReactClass({
      displayName: 'Component',
      statics: {
        /** 根据新属性与旧状态返回“should warn if state is not properly initialized before getDerivedStateFromProps”场景的派生状态补丁。 */
        getDerivedStateFromProps: function () {
          return null;
        },
      },
      /** 渲染“should warn if state is not properly initialized before getDerivedStateFromProps”场景所需的元素树，使断言能够观察兼容层的输出或诊断。 */
      render: function () {
        return null;
      },
    });
    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Component />);
    });
    assertConsoleErrorDev([
      '`Component` uses `getDerivedStateFromProps` but its initial state is ' +
        'null. This is not recommended. Instead, define the initial state by ' +
        'assigning an object to `this.state` in the constructor of `Component`. ' +
        'This ensures that `getDerivedStateFromProps` arguments have a consistent shape.\n' +
        '    in Component (at **)',
    ]);
  });

  /**
   * 场景：“should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new static gDSFP is present”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new static gDSFP is present', async () => {
    const Component = createReactClass({
      statics: {
        /** 根据新属性与旧状态返回“should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new static gDSFP is present”场景的派生状态补丁。 */
        getDerivedStateFromProps: function () {
          return null;
        },
      },
      /** 记录“should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new static gDSFP is present”场景的旧版挂载前生命周期调用。 */
      componentWillMount: function () {
        throw Error('unexpected');
      },
      /** 记录“should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new static gDSFP is present”场景接收新属性时的旧版生命周期调用。 */
      componentWillReceiveProps: function () {
        throw Error('unexpected');
      },
      /** 记录“should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new static gDSFP is present”场景的旧版更新前生命周期调用。 */
      componentWillUpdate: function () {
        throw Error('unexpected');
      },
      /** 返回“should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new static gDSFP is present”场景的初始状态，供状态形状与更新语义断言使用。 */
      getInitialState: function () {
        return {};
      },
      /** 渲染“should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new static gDSFP is present”场景所需的元素树，使断言能够观察兼容层的输出或诊断。 */
      render: function () {
        return null;
      },
    });
    Component.displayName = 'Component';

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
        '* Rename componentWillMount to UNSAFE_componentWillMount to suppress ' +
        'this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. ' +
        'To rename all deprecated lifecycles to their new names, you can run ' +
        '`npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n' +
        '\nPlease update the following components: Component',
      'componentWillReceiveProps has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        "* If you're updating state whenever props change, refactor your " +
        'code to use memoization techniques or move it to ' +
        'static getDerivedStateFromProps. Learn more at: https://react.dev/link/derived-state\n' +
        '* Rename componentWillReceiveProps to UNSAFE_componentWillReceiveProps to suppress ' +
        'this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. ' +
        'To rename all deprecated lifecycles to their new names, you can run ' +
        '`npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n' +
        '\nPlease update the following components: Component',
      'componentWillUpdate has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        '* Rename componentWillUpdate to UNSAFE_componentWillUpdate to suppress ' +
        'this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. ' +
        'To rename all deprecated lifecycles to their new names, you can run ' +
        '`npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n' +
        '\nPlease update the following components: Component',
    ]);
    await act(() => {
      root.render(<Component foo={1} />);
    });
  });

  /**
   * 场景：“should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new getSnapshotBeforeUpdate is present”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new getSnapshotBeforeUpdate is present', async () => {
    const Component = createReactClass({
      /** 在“should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new getSnapshotBeforeUpdate is p”场景提交变更前返回快照，供生命周期形状校验使用。 */
      getSnapshotBeforeUpdate: function () {
        return null;
      },
      /** 记录“should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new getSnapshotBeforeUpdate is p”场景的旧版挂载前生命周期调用。 */
      componentWillMount: function () {
        throw Error('unexpected');
      },
      /** 记录“should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new getSnapshotBeforeUpdate is p”场景接收新属性时的旧版生命周期调用。 */
      componentWillReceiveProps: function () {
        throw Error('unexpected');
      },
      /** 记录“should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new getSnapshotBeforeUpdate is p”场景的旧版更新前生命周期调用。 */
      componentWillUpdate: function () {
        throw Error('unexpected');
      },
      /** 记录“should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new getSnapshotBeforeUpdate is p”场景的更新提交，供新旧生命周期组合断言使用。 */
      componentDidUpdate: function () {},
      /** 渲染“should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new getSnapshotBeforeUpdate is p”场景所需的元素树，使断言能够观察兼容层的输出或诊断。 */
      render: function () {
        return null;
      },
    });
    Component.displayName = 'Component';

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<Component />);
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
        '* Rename componentWillMount to UNSAFE_componentWillMount to suppress ' +
        'this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. ' +
        'To rename all deprecated lifecycles to their new names, you can run ' +
        '`npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n' +
        '\nPlease update the following components: Component',
      'componentWillReceiveProps has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        "* If you're updating state whenever props change, refactor your " +
        'code to use memoization techniques or move it to ' +
        'static getDerivedStateFromProps. Learn more at: https://react.dev/link/derived-state\n' +
        '* Rename componentWillReceiveProps to UNSAFE_componentWillReceiveProps to suppress ' +
        'this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. ' +
        'To rename all deprecated lifecycles to their new names, you can run ' +
        '`npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n' +
        '\nPlease update the following components: Component',
      'componentWillUpdate has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        '* Rename componentWillUpdate to UNSAFE_componentWillUpdate to suppress ' +
        'this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. ' +
        'To rename all deprecated lifecycles to their new names, you can run ' +
        '`npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n' +
        '\nPlease update the following components: Component',
    ]);
    await act(() => {
      const root2 = ReactDOMClient.createRoot(document.createElement('div'));
      root2.render(<Component foo={1} />);
    });
  });

  /**
   * 场景：“should invoke both deprecated and new lifecycles if both are present”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('should invoke both deprecated and new lifecycles if both are present', async () => {
    const log = [];

    const Component = createReactClass({
      mixins: [
        {
          /** 记录“should invoke both deprecated and new lifecycles if both are present”场景的旧版挂载前生命周期调用。 */
          componentWillMount: function () {
            log.push('componentWillMount');
          },
          /** 记录“should invoke both deprecated and new lifecycles if both are present”场景接收新属性时的旧版生命周期调用。 */
          componentWillReceiveProps: function () {
            log.push('componentWillReceiveProps');
          },
          /** 记录“should invoke both deprecated and new lifecycles if both are present”场景的旧版更新前生命周期调用。 */
          componentWillUpdate: function () {
            log.push('componentWillUpdate');
          },
        },
      ],
      /** 记录“should invoke both deprecated and new lifecycles if both are present”场景的 UNSAFE 挂载前生命周期调用。 */
      UNSAFE_componentWillMount: function () {
        log.push('UNSAFE_componentWillMount');
      },
      /** 记录“should invoke both deprecated and new lifecycles if both are present”场景的 UNSAFE 接收属性生命周期调用。 */
      UNSAFE_componentWillReceiveProps: function () {
        log.push('UNSAFE_componentWillReceiveProps');
      },
      /** 记录“should invoke both deprecated and new lifecycles if both are present”场景的 UNSAFE 更新前生命周期调用。 */
      UNSAFE_componentWillUpdate: function () {
        log.push('UNSAFE_componentWillUpdate');
      },
      /** 渲染“should invoke both deprecated and new lifecycles if both are present”场景所需的元素树，使断言能够观察兼容层的输出或诊断。 */
      render: function () {
        return null;
      },
    });

    const root = ReactDOMClient.createRoot(document.createElement('div'));

    await act(() => {
      root.render(<Component foo="bar" />);
    });
    assertConsoleWarnDev([
      'componentWillMount has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move code with side effects to componentDidMount, and set initial state in the constructor.\n' +
        '* Rename componentWillMount to UNSAFE_componentWillMount to suppress ' +
        'this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. ' +
        'To rename all deprecated lifecycles to their new names, you can run ' +
        '`npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n' +
        '\nPlease update the following components: Component',
      'componentWillReceiveProps has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        "* If you're updating state whenever props change, refactor your " +
        'code to use memoization techniques or move it to ' +
        'static getDerivedStateFromProps. Learn more at: https://react.dev/link/derived-state\n' +
        '* Rename componentWillReceiveProps to UNSAFE_componentWillReceiveProps to suppress ' +
        'this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. ' +
        'To rename all deprecated lifecycles to their new names, you can run ' +
        '`npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n' +
        '\nPlease update the following components: Component',
      'componentWillUpdate has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n\n' +
        '* Move data fetching code or side effects to componentDidUpdate.\n' +
        '* Rename componentWillUpdate to UNSAFE_componentWillUpdate to suppress ' +
        'this warning in non-strict mode. In React 18.x, only the UNSAFE_ name will work. ' +
        'To rename all deprecated lifecycles to their new names, you can run ' +
        '`npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n' +
        '\nPlease update the following components: Component',
    ]);
    expect(log).toEqual(['componentWillMount', 'UNSAFE_componentWillMount']);

    log.length = 0;

    await act(() => {
      root.render(<Component foo="baz" />);
    });
    expect(log).toEqual([
      'componentWillReceiveProps',
      'UNSAFE_componentWillReceiveProps',
      'componentWillUpdate',
      'UNSAFE_componentWillUpdate',
    ]);
  });

  /**
   * 场景：“isMounted works”。
   * 机制：验证createReactClass 的旧版 spec、状态与生命周期兼容契约，锁定可观察结果与失败边界。
   */
  it('isMounted works', async () => {
    const ops = [];
    let instance;
    const Component = createReactClass({
      displayName: 'MyComponent',
      mixins: [
        {
          /** 记录“isMounted works”场景的旧版挂载前生命周期调用。 */
          UNSAFE_componentWillMount() {
            this.log('mixin.componentWillMount');
          },
          /** 记录“isMounted works”场景的挂载提交，并执行仅在挂载后有效的观测。 */
          componentDidMount() {
            this.log('mixin.componentDidMount');
          },
          /** 记录“isMounted works”场景的旧版更新前生命周期调用。 */
          UNSAFE_componentWillUpdate() {
            this.log('mixin.componentWillUpdate');
          },
          /** 记录“isMounted works”场景的更新提交，供生命周期顺序断言使用。 */
          componentDidUpdate() {
            this.log('mixin.componentDidUpdate');
          },
          /** 记录并清理“isMounted works”场景的卸载副作用。 */
          componentWillUnmount() {
            this.log('mixin.componentWillUnmount');
          },
        },
      ],
      /** 记录“isMounted works”场景的生命周期阶段与当前状态。 */
      log(name) {
        ops.push(`${name}: ${this.isMounted()}`);
      },
      /** 返回“isMounted works”场景的初始状态，供后续更新断言比较。 */
      getInitialState() {
        this.log('getInitialState');
        return {};
      },
      /** 记录“isMounted works”场景的旧版挂载前生命周期调用。 */
      UNSAFE_componentWillMount() {
        this.log('componentWillMount');
      },
      /** 记录“isMounted works”场景的挂载提交，并执行仅在挂载后有效的观测。 */
      componentDidMount() {
        this.log('componentDidMount');
      },
      /** 记录“isMounted works”场景的旧版更新前生命周期调用。 */
      UNSAFE_componentWillUpdate() {
        this.log('componentWillUpdate');
      },
      /** 记录“isMounted works”场景的更新提交，供生命周期顺序断言使用。 */
      componentDidUpdate() {
        this.log('componentDidUpdate');
      },
      /** 记录并清理“isMounted works”场景的卸载副作用。 */
      componentWillUnmount() {
        this.log('componentWillUnmount');
      },
      /** 渲染“isMounted works”场景所需的元素树，使断言能够观察协调与提交结果。 */
      render() {
        instance = this;
        this.log('render');
        return <div />;
      },
    });

    const root = ReactDOMClient.createRoot(document.createElement('div'));

    await act(() => {
      root.render(<Component />);
    });
    assertConsoleErrorDev(
      [
        'Warning: MyComponent: isMounted is deprecated. Instead, make sure to ' +
          'clean up subscriptions and pending requests in componentWillUnmount ' +
          'to prevent memory leaks.\n' +
          '    in MyComponent (at **)',
      ],
    // 即使警告源自第三方库，现在也必须附带组件栈，帮助定位调用方。
    );

    // 同类警告已输出，后续实例必须去重。

    await act(() => {
      root.render(<Component />);
    });

    await act(() => {
      root.unmount();
    });
    instance.log('after unmount');
    expect(ops).toEqual([
      'getInitialState: false',
      'mixin.componentWillMount: false',
      'componentWillMount: false',
      'render: false',
      'mixin.componentDidMount: true',
      'componentDidMount: true',
      'mixin.componentWillUpdate: true',
      'componentWillUpdate: true',
      'render: true',
      'mixin.componentDidUpdate: true',
      'componentDidUpdate: true',
      'mixin.componentWillUnmount: true',
      'componentWillUnmount: true',
      'after unmount: false',
    ]);
  });
});
