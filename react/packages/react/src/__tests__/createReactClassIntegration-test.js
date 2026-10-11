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
  // 每例重置模块，用 React.Component/isValidElement/noop updater 注入第三方 create-react-class 工厂，随后 renderer 给实例安装实际 updater。
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

  /** 传空 spec 给 createReactClass，创建同步抛必须实现 render 的错误，验证 class 工厂入口约束。 */
  it('should throw when `render` is not specified', () => {
    expect(function () {
      createReactClass({});
    }).toThrowError('Class specification must implement a `render` method.');
  });

  /** spec.propTypes.value 为 spy，创建后 constructor.propTypes 存在且该字段仍同 spy，验证静态元数据复制。 */
  it('should copy prop types onto the Constructor', () => {
    const propValidator = jest.fn();
    const TestComponent = createReactClass({
      propTypes: {
        value: propValidator,
      },
      /** 返回最小 div；本例只创建 class 并检查 propTypes 元数据，不挂载 render。 */
      render: function () {
        return <div />;
      },
    });

    expect(TestComponent.propTypes).toBeDefined();
    expect(TestComponent.propTypes.value).toBe(propValidator);
  });

  /** spec.propTypes.prop=null 且 displayName=Component，仅创建便要求校验器必须函数的诊断，验证创建期元数据检查。 */
  it('should warn on invalid prop types', () => {
    createReactClass({
      displayName: 'Component',
      propTypes: {
        prop: null,
      },
      /** 返回 props.prop 的 span；本例只创建非法 propTypes spec，不执行 render。 */
      render: function () {
        return <span>{this.props.prop}</span>;
      },
    });
    assertConsoleErrorDev([
      'Warning: Component: prop type `prop` is invalid; ' +
        'it must be a function, usually from React.PropTypes.',
    ]);
  });

  /** spec.contextTypes.prop=null，仅创建要求上下文校验器必须函数的诊断，验证旧 Context 声明检查。 */
  it('should warn on invalid context types', () => {
    createReactClass({
      displayName: 'Component',
      contextTypes: {
        prop: null,
      },
      /** 返回 props.prop 的 span；本例只创建非法 contextTypes spec，不执行 render。 */
      render: function () {
        return <span>{this.props.prop}</span>;
      },
    });
    assertConsoleErrorDev([
      'Warning: Component: context type `prop` is invalid; ' +
        'it must be a function, usually from React.PropTypes.',
    ]);
  });

  /** spec.childContextTypes.prop=null，仅创建要求子上下文校验器诊断；本体没有抛错断言，与题名 should throw 不同，验证当前观察到的警告。 */
  it('should throw on invalid child context types', () => {
    createReactClass({
      displayName: 'Component',
      childContextTypes: {
        prop: null,
      },
      /** 返回 props.prop 的 span；本例只创建非法 childContextTypes spec，不执行 render。 */
      render: function () {
        return <span>{this.props.prop}</span>;
      },
    });
    assertConsoleErrorDev([
      'Warning: Component: child context type `prop` is invalid; it must be a function, usually from React.PropTypes.',
    ]);
  });

  /** 无 displayName 与 NamedComponent 两 spec 都错拼 componentShouldUpdate，各创建后要求不同组件名的正确 SCU 建议，验证名字兜底与诊断。 */
  it('should warn when misspelling shouldComponentUpdate', () => {
    createReactClass({
      /** 故意使用拼错的更新判定方法名，验证 createReactClass 给出纠正建议。 */
      componentShouldUpdate: function () {
        return false;
      },
      /** 返回最小 div，补足无名错拼 SCU spec 的必需 render。 */
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
      /** 返回最小 div，补足 NamedComponent 错拼 SCU spec 的必需 render。 */
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

  /** 错拼 componentWillRecieveProps，创建后要求正确 Receive 名称，验证旧接收生命周期拼写诊断。 */
  it('should warn when misspelling componentWillReceiveProps', () => {
    createReactClass({
      /** 故意使用拼错的旧版接收属性生命周期名，验证对应诊断。 */
      componentWillRecieveProps: function () {
        return false;
      },
      /** 返回最小 div，补足错拼接收属性钩子 spec 的必需 render。 */
      render: function () {
        return <div />;
      },
    });
    assertConsoleErrorDev([
      'Warning: A component has a method called componentWillRecieveProps(). Did you ' +
        'mean componentWillReceiveProps()?',
    ]);
  });

  /** 错拼 UNSAFE_componentWillRecieveProps，创建后要求正确 Receive 名称，验证 UNSAFE 变体拼写诊断。 */
  it('should warn when misspelling UNSAFE_componentWillReceiveProps', () => {
    createReactClass({
      /** 故意拼错 UNSAFE 接收属性生命周期名，验证对应诊断。 */
      UNSAFE_componentWillRecieveProps: function () {
        return false;
      },
      /** 返回最小 div，补足错拼 UNSAFE 接收属性钩子 spec 的必需 render。 */
      render: function () {
        return <div />;
      },
    });
    assertConsoleErrorDev([
      'Warning: A component has a method called UNSAFE_componentWillRecieveProps(). ' +
        'Did you mean UNSAFE_componentWillReceiveProps()?',
    ]);
  });

  /** 把保留 getDefaultProps 放入 spec.statics，创建要求保留键不能放 statics 的抛错，验证 spec 分类约束。 */
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

        /** 返回 span，补足保留 statics 键错误 spec 的必需 render；创建即抛错，不挂载。 */
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
  /** it.skip 保留未执行的历史场景：四旧元数据键放非 statics，原期望四迁移诊断；当前不会运行，不能作为现行 API 或验证通过证据。 */
  // eslint-disable-next-line jest/no-disabled-tests
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
      /** 返回 div，供已跳过的历史元数据迁移场景；当前不会执行。 */
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

  /** spec.statics 包字符串/0/null 和返回 this 的 pqr，挂载 ref 后分别从 Component 和 instance.constructor 读取；值/接收者一致，验证静态复制与调用路径，不验证方法裸调用绑定。 */
  it('should support statics', async () => {
    const Component = createReactClass({
      statics: {
        abc: 'def',
        def: 0,
        ghi: null,
        jkl: 'mno',
        /** 返回调用接收者 this；通过 Component/instance.constructor 属性调用均得到生成类，未验证裸调用自动绑定。 */
        pqr: function () {
          return this;
        },
      },

      /** 返回 span，使带 statics 的 class 正常挂载并提交实例 ref。 */
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

  /** getInitialState 返回 occupation=clown，挂载后 ref 实例 state 该字段等 clown，验证对象初始状态。 */
  it('should work with object getInitialState() return values', async () => {
    const Component = createReactClass({
      /** 返回 occupation=clown 的新对象，供挂载初始 state 断言。 */
      getInitialState: function () {
        return {
          occupation: 'clown',
        };
      },
      /** 返回 span，使 occupation 对象初始 state 的实例 ref 提交。 */
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

  /** getInitialState 返回空对象，再向生成构造器挂静态派生方法返回 occupation=clown；挂载实例 state 得该值，验证第三方 class 与 renderer 派生 API 集成。 */
  it('should work with getDerivedStateFromProps() return values', async () => {
    const Component = createReactClass({
      /** 返回空初始对象，供构造器后挂静态 gDSFP 合入 occupation。 */
      getInitialState() {
        return {};
      },
      /** 返回 span，使构造器后挂 gDSFP 的 class 提交实例 ref。 */
      render: function () {
        return <span />;
      },
    });
    /** 静态方法返回 occupation=clown 补丁，供空初始 state 的首次派生断言。 */
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
  /** 仅旧版 Context 开启：Outer 提供 className=foo，Foo 在 getInitialState 读取 this.context；挂载输出 SPAN/foo 并要求迁移诊断，验证旧初始化时机。 */
  it('renders based on context getInitialState', async () => {
    const Foo = createReactClass({
      contextTypes: {
        className: PropTypes.string,
      },
      /** 读取已安装的 this.context.className 建初始 state，供旧 Context 时机检查。 */
      getInitialState() {
        return {className: this.context.className};
      },
      /** 将 getInitialState 捕获的 state.className 输出 span，观察旧 Context 初始化。 */
      render() {
        return <span className={this.state.className} />;
      },
    });

    const Outer = createReactClass({
      childContextTypes: {
        className: PropTypes.string,
      },
      /** 返回固定 className=foo，与 childContextTypes 配合提供给初始化期消费者。 */
      getChildContext() {
        return {className: 'foo'};
      },
      /** 返回旧 Context 消费者 Foo，形成 Outer→Foo 提供链。 */
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

  /** 循环用数组、字符串、数字作为 getInitialState 返回值，每轮新 class/root 的 act 挂载都拒绝对象/null错误，验证第三方工厂对非法初始化的强制失败。 */
  it('should throw with non-object getInitialState() return values', async () => {
    // eslint-disable-next-line no-for-of-loops/no-for-of-loops
    for (const state of [['an array'], 'a string', 1234]) {
      const Component = createReactClass({
        /** 返回当前循环输入 state（数组、字符串、数字），故意触发工厂初始化错误。 */
        getInitialState: function () {
          return state;
        },
        /** 返回 span，供循环非法 getInitialState 场景；工厂初始化会先失败，此 render 不应到达。 */
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

  /** getInitialState 返回 null，act 挂载 resolves.not.toThrow，验证允许的空初始状态。 */
  it('should work with a null getInitialState() return value', async () => {
    const Component = createReactClass({
      /** 返回 null，供工厂合法空初始状态边界。 */
      getInitialState: function () {
        return null;
      },
      /** 返回 span，证明 null 初始 state 正常挂载。 */
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

  /** 先生成有 render 的 Component 后把它当普通函数裸调用，要求抛错和旧 factory 诊断，验证构造器直接调用被拒绝。 */
  it('should throw when using legacy factories', () => {
    const Component = createReactClass({
      /** 返回 div；本例只调用生成构造器作为函数而失败，不通过 renderer 挂载。 */
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

  /** 初始 step=0，挂载后实例 replaceState(step=1) 带 callback；日志 Render0→Render1→Callback1，验证替换更新提交后回调读到新 state。 */
  it('replaceState and callback works', async () => {
    const ops = [];
    const Component = createReactClass({
      /** 返回 step=0 初始对象，供 replaceState 更新日志。 */
      getInitialState() {
        return {step: 0};
      },
      /** 记录当前 state.step 的 Render 日志并返回 div，供 replaceState 与 callback 顺序比较。 */
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

  /** 初始 count=1，静态派生方法把 prevState.count 加 incrementBy；props 0→2 时宿主文本 count1→count3，验证更新期派生读旧 state。 */
  it('getDerivedStateFromProps updates state when props change', async () => {
    const Component = createReactClass({
      /** 返回 count=1 初始对象，供每轮 gDSFP 累加 incrementBy。 */
      getInitialState() {
        return {
          count: 1,
        };
      },
      /** 把 state.count 输出文本 div，观察更新期 gDSFP 的累加补丁。 */
      render() {
        return <div>count:{this.state.count}</div>;
      },
    });
    /** 按 prevState.count 加 nextProps.incrementBy 返回补丁，每次 renderer 派生都会累加当前输入。 */
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

  /** 通过 spec.statics 提供 gDSFP 返回 foo=bar，初始空对象且 render 捕获实例；挂载 state.foo=bar，验证 spec 静态声明与 renderer 互通。 */
  it('should support the new static getDerivedStateFromProps method', async () => {
    let instance;
    const Component = createReactClass({
      statics: {
        /** 返回 foo=bar 的静态补丁，供 spec.statics 与 renderer 派生状态集成。 */
        getDerivedStateFromProps: function () {
          return {foo: 'bar'};
        },
      },

      /** 返回空对象，供 spec.statics 的 gDSFP 合入 foo。 */
      getInitialState() {
        return {};
      },

      /** 保存实例到 instance 并返回 null，供静态 gDSFP 补丁断言。 */
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

  /** spec 将 gDSFP 定为实例方法，挂载要求被忽略并建议静态，验证派生 API 位置检查。 */
  it('warns if getDerivedStateFromProps is not static', async () => {
    const Foo = createReactClass({
      displayName: 'Foo',
      /** 故意定义为实例方法并返回空对象；renderer 应忽略并提示放到静态位置。 */
      getDerivedStateFromProps() {
        return {};
      },
      /** 返回 div，使实例 gDSFP 声明诊断可在挂载后检查。 */
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

  /** spec 将 gDSFE 定为实例方法，挂载要求被忽略并建议静态，验证错误派生 API 位置检查。 */
  it('warns if getDerivedStateFromError is not static', async () => {
    const Foo = createReactClass({
      displayName: 'Foo',
      /** 故意定义为实例方法并返回空对象；renderer 应忽略并提示放到静态位置。 */
      getDerivedStateFromError() {
        return {};
      },
      /** 返回 div，使实例 gDSFE 声明诊断可在挂载后检查。 */
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

  /** spec.statics 中提供 snapshot 方法，挂载要求被忽略并建议实例声明，验证快照 API 位置检查。 */
  it('warns if getSnapshotBeforeUpdate is static', async () => {
    const Foo = createReactClass({
      displayName: 'Foo',
      statics: {
        /** 故意放入 statics，返回 null；renderer 应忽略并提示实例方法。 */
        getSnapshotBeforeUpdate: function () {
          return null;
        },
      },
      /** 返回 div，使静态 snapshot 声明诊断可在挂载后检查。 */
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

  /** 缺少 getInitialState 而静态 gDSFP 返回 null，挂载要求初始 state=null 的形状提醒，验证只诊断可继续的边界。 */
  it('should warn if state is not properly initialized before getDerivedStateFromProps', async () => {
    const Component = createReactClass({
      displayName: 'Component',
      statics: {
        /** 返回 null 的静态派生方法，不提供 state 补丁；故意与缺少初始对象组合触发形状提醒。 */
        getDerivedStateFromProps: function () {
          return null;
        },
      },
      /** 返回 null，供未初始化 state 的静态 gDSFP 形状提醒。 */
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

  /** 静态 gDSFP 存在，三个旧生命周期都一调用就抛 unexpected；初挂及同 root props 更新完成并要求新旧 API 冲突/改名诊断，验证旧钩子不被执行。 */
  it('should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new static gDSFP is present', async () => {
    const Component = createReactClass({
      statics: {
        /** 返回 null 的静态派生方法，存在本身就应关闭旧不安全钩子的调用。 */
        getDerivedStateFromProps: function () {
          return null;
        },
      },
      /** 任何调用都抛 unexpected，作为有 gDSFP 或 snapshot 时旧钩子必须禁用的失败探针。 */
      componentWillMount: function () {
        throw Error('unexpected');
      },
      /** 任何调用都抛 unexpected，作为有 gDSFP 或 snapshot 时旧钩子必须禁用的失败探针。 */
      componentWillReceiveProps: function () {
        throw Error('unexpected');
      },
      /** 任何调用都抛 unexpected，作为有 gDSFP 或 snapshot 时旧钩子必须禁用的失败探针。 */
      componentWillUpdate: function () {
        throw Error('unexpected');
      },
      /** 返回空对象，给静态 gDSFP 提供稳定状态而避免额外初始化形状告警。 */
      getInitialState: function () {
        return {};
      },
      /** 返回 null，使静态 gDSFP 与旧抛错钩子共存场景完成提交。 */
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

  /** 实例 snapshot 存在，三个旧钩子都一调用就抛 unexpected；初挂后诊断，再创建第二 root 挂新实例而非更新首实例，验证初挂抑制旧 willMount；未覆盖更新 snapshot/willReceive/willUpdate 执行。 */
  it('should not invoke deprecated lifecycles (cWM/cWRP/cWU) if new getSnapshotBeforeUpdate is present', async () => {
    const Component = createReactClass({
      /** 实例 snapshot 返回 null，存在本身关闭旧不安全钩子；本体只初挂两个独立根，不执行更新快照。 */
      getSnapshotBeforeUpdate: function () {
        return null;
      },
      /** 任何调用都抛 unexpected，作为有 gDSFP 或 snapshot 时旧钩子必须禁用的失败探针。 */
      componentWillMount: function () {
        throw Error('unexpected');
      },
      /** 任何调用都抛 unexpected，作为有 gDSFP 或 snapshot 时旧钩子必须禁用的失败探针。 */
      componentWillReceiveProps: function () {
        throw Error('unexpected');
      },
      /** 任何调用都抛 unexpected，作为有 gDSFP 或 snapshot 时旧钩子必须禁用的失败探针。 */
      componentWillUpdate: function () {
        throw Error('unexpected');
      },
      /** 空提交钩子配套实例 snapshot，避免缺少 didUpdate 诊断；本体没有同实例更新。 */
      componentDidUpdate: function () {},
      /** 返回 null，使实例 snapshot 与旧抛错钩子共存的两次初挂完成。 */
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

  /** mixin 定义旧钩子，spec 定义对应 UNSAFE 钩子且无 gDSFP/snapshot；初挂及 props bar→baz 更新日志每阶段旧名称先、新名称后，验证混入钩子组合与改名诊断。 */
  it('should invoke both deprecated and new lifecycles if both are present', async () => {
    const log = [];

    const Component = createReactClass({
      mixins: [
        {
          /** 把旧 componentWillMount 名称写入 log，与 spec 的 UNSAFE 钩子共同验证 mixin 合并顺序。 */
          componentWillMount: function () {
            log.push('componentWillMount');
          },
          /** 把旧 componentWillReceiveProps 名称写入 log，与 spec 的 UNSAFE 钩子共同验证 mixin 合并顺序。 */
          componentWillReceiveProps: function () {
            log.push('componentWillReceiveProps');
          },
          /** 把旧 componentWillUpdate 名称写入 log，与 spec 的 UNSAFE 钩子共同验证 mixin 合并顺序。 */
          componentWillUpdate: function () {
            log.push('componentWillUpdate');
          },
        },
      ],
      /** 把 UNSAFE_componentWillMount 名称写入 log，供旧钩子之后追加调用的顺序断言。 */
      UNSAFE_componentWillMount: function () {
        log.push('UNSAFE_componentWillMount');
      },
      /** 把 UNSAFE_componentWillReceiveProps 名称写入 log，供旧钩子之后追加调用的顺序断言。 */
      UNSAFE_componentWillReceiveProps: function () {
        log.push('UNSAFE_componentWillReceiveProps');
      },
      /** 把 UNSAFE_componentWillUpdate 名称写入 log，供旧钩子之后追加调用的顺序断言。 */
      UNSAFE_componentWillUpdate: function () {
        log.push('UNSAFE_componentWillUpdate');
      },
      /** 返回 null，日志仅记录混入旧/UNSAFE 生命周期，供组合次序断言。 */
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

  /** mixin/spec 在各生命周期调用兼容 isMounted 并记录；初建/初render false，didMount及更新/卸载钩子true，卸载后false，诊断一次附栈，验证实例挂载状态和混入顺序。 */
  it('isMounted works', async () => {
    const ops = [];
    let instance;
    const Component = createReactClass({
      displayName: 'MyComponent',
      mixins: [
        {
          /** mixin 在 UNSAFE_componentWillMount 阶段调用 this.log，供自身与 spec 钩子的挂载状态和顺序对照。 */
          UNSAFE_componentWillMount() {
            this.log('mixin.componentWillMount');
          },
          /** mixin 在 componentDidMount 阶段调用 this.log，供自身与 spec 钩子的挂载状态和顺序对照。 */
          componentDidMount() {
            this.log('mixin.componentDidMount');
          },
          /** mixin 在 UNSAFE_componentWillUpdate 阶段调用 this.log，供自身与 spec 钩子的挂载状态和顺序对照。 */
          UNSAFE_componentWillUpdate() {
            this.log('mixin.componentWillUpdate');
          },
          /** mixin 在 componentDidUpdate 阶段调用 this.log，供自身与 spec 钩子的挂载状态和顺序对照。 */
          componentDidUpdate() {
            this.log('mixin.componentDidUpdate');
          },
          /** mixin 在 componentWillUnmount 阶段调用 this.log，供自身与 spec 钩子的挂载状态和顺序对照。 */
          componentWillUnmount() {
            this.log('mixin.componentWillUnmount');
          },
        },
      ],
      /** 以 name 标记当前阶段，再调用库提供的 this.isMounted 写入 ops；卸载后仍可对保存实例调用，初次 DEV 访问触发弃用诊断。 */
      log(name) {
        ops.push(`${name}: ${this.isMounted()}`);
      },
      /** 先记录 getInitialState 阶段 isMounted=false，再返回空对象，供挂载状态日志。 */
      getInitialState() {
        this.log('getInitialState');
        return {};
      },
      /** spec 在 UNSAFE_componentWillMount 阶段调用 this.log，记录此时兼容 isMounted 的值，接在 mixin 钩子之后。 */
      UNSAFE_componentWillMount() {
        this.log('componentWillMount');
      },
      /** spec 在 componentDidMount 阶段调用 this.log，记录此时兼容 isMounted 的值，接在 mixin 钩子之后。 */
      componentDidMount() {
        this.log('componentDidMount');
      },
      /** spec 在 UNSAFE_componentWillUpdate 阶段调用 this.log，记录此时兼容 isMounted 的值，接在 mixin 钩子之后。 */
      UNSAFE_componentWillUpdate() {
        this.log('componentWillUpdate');
      },
      /** spec 在 componentDidUpdate 阶段调用 this.log，记录此时兼容 isMounted 的值，接在 mixin 钩子之后。 */
      componentDidUpdate() {
        this.log('componentDidUpdate');
      },
      /** spec 在 componentWillUnmount 阶段调用 this.log，记录此时兼容 isMounted 的值，接在 mixin 钩子之后。 */
      componentWillUnmount() {
        this.log('componentWillUnmount');
      },
      /** 保存实例、记录 render 时的 isMounted，再返回 div，供初建/更新/卸载挂载状态比较。 */
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

    // 此类型的 isMounted 警告已输出，随后同实例更新不再要求重复告警。

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
