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

// 每例建立新 root/container 并清空叶子探针，避免上例输出或监听器影响断言。

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
    /** 共享叶子类把监听器/名称写入外部探针，每例重新创建；ref 可取得实例，事件测试则直接调用保存的监听器。 */
    Inner = class extends React.Component {
      /** 返回当前 props.name，供类实例相关断言读取；不缓存旧名称。 */
      getName() {
        return this.props.name;
      }
      /** 把 props.onClick/name 写入外部探针并输出对应 className 的 div，供事件调用和渲染结果断言。 */
      render() {
        attachedListener = this.props.onClick;
        renderedName = this.props.name;
        return <div className={this.props.name} />;
      }
    };
  });

  /** 同步把 element 提交到本例 root，再检查首宿主节点存在、标签等于大写 expectedTag、className 等于 expectedClassName；只检查首节点。 */
  function runTest(element, expectedTag, expectedClassName) {
    ReactDOM.flushSync(() => root.render(element));
    expect(container.firstChild).not.toBeNull();
    expect(container.firstChild.tagName).toBe(expectedTag);
    expect(container.firstChild.className).toBe(expectedClassName);
  }

  /** 声明名为 Foo 的 ES class 类后读取构造器 name，仍为 Foo；验证JavaScript保留 React 诊断需要的组件名称。 */
  it('preserves the name of the class for use in error messages', () => {
    /** 空 Foo 类，供构造器 name 保留断言。 */
    class Foo extends React.Component {}
    expect(Foo.name).toBe('Foo');
  });

  /** Foo 无 render，同步挂载时捕获 window error 并 preventDefault；断言两次缺 render 诊断和一次方法非函数错误，再移除监听器，验证错误报告路径。 */
  it('throws if no render function is defined', () => {
    /** 故意没有 render 的类，触发 renderer 的诊断与宿主错误报告。 */
    class Foo extends React.Component {}
    const caughtErrors = [];
    /** 把浏览器 ErrorEvent 的默认报告阻止并保存 event.error，供缺 render 的错误通道断言；监听器由 finally 移除。 */
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

  /** 无 state 的 Foo 把 bar prop 传给叶子，先 foo 再 bar 同步渲染；宿主 className 随 props 改变，验证同类实例更新。 */
  it('renders a simple stateless component with prop', () => {
    /** 无 state 的 props 透传类，把 bar 交给共享 Inner。 */
    class Foo extends React.Component {
      /** 把 props.bar 传给 Inner，输出随父 props 更新。 */
      render() {
        return <Inner name={this.props.bar} />;
      }
    }
    runTest(<Foo bar="foo" />, 'DIV', 'foo');
    runTest(<Foo bar="bar" />, 'DIV', 'bar');
  });

  /** 构造器先 super 再从 this.props.initialValue 初始化 state.bar；初挂 foo 输出 SPAN/foo，验证基类 props 初始化可供构造期读取。 */
  it('renders based on state using initial values in this.props', () => {
    /** 从基类 this.props 初始化 state 的类，检查构造期 props 可用。 */
    class Foo extends React.Component {
      /** super(props) 后从 this.props.initialValue 建 state.bar，验证基类挂载 props。 */
      constructor(props) {
        super(props);
        this.state = {bar: this.props.initialValue};
      }
      /** 把 state.bar 渲染为 span 的 className。 */
      render() {
        return <span className={this.state.bar} />;
      }
    }
    runTest(<Foo initialValue="foo" />, 'SPAN', 'foo');
  });

  /** 构造器从参数 initialValue 建 state，ref 调 changeState 后同步提交；DIV/foo 变 SPAN/bar，再同类重渲染仍保留 bar，验证状态更新与宿主替换。 */
  it('renders based on state using props in the constructor', () => {
    /** 从构造参数建 state 并通过实例方法切换宿主类型的类。 */
    class Foo extends React.Component {
      /** super(props) 后从参数 initialValue 建 state.bar，供 changeState 更新。 */
      constructor(props) {
        super(props);
        this.state = {bar: props.initialValue};
      }
      /** 安排 state.bar=bar 的合并更新，由测试在 flushSync 内通过 ref 调用。 */
      changeState() {
        this.setState({bar: 'bar'});
      }
      /** state.bar=foo 时输出 DIV/foo，更新为 bar 后输出 SPAN/bar，供宿主替换断言。 */
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

  /** 初始 state.foo=null，静态派生方法返回 foo prop 与 bar 常量；初挂得到 DIV/foo bar，验证派生补丁在首次 render 前合并。 */
  it('sets initial state with value returned by static getDerivedStateFromProps', () => {
    /** 初始空 state 加静态派生方法的类，检查首次状态补丁。 */
    class Foo extends React.Component {
      /** 初始空对象，供静态派生方法首次合入 foo/bar。 */
      state = {};
      /** 静态方法以 nextProps.foo 和固定 bar 返回初始状态补丁；prevState 未使用。 */
      static getDerivedStateFromProps(nextProps, prevState) {
        return {
          foo: nextProps.foo,
          bar: 'bar',
        };
      }
      /** 将派生后的 state.foo/bar 拼成宿主 className。 */
      render() {
        return <div className={`${this.state.foo} ${this.state.bar}`} />;
      }
    }
    runTest(<Foo foo="foo" />, 'DIV', 'foo bar');
  });

  /** 把 getDerivedStateFromProps 定为实例方法并挂载；诊断要求静态方法且将其忽略，验证错误 API 形状识别。 */
  it('warns if getDerivedStateFromProps is not static', () => {
    /** 把派生 props API 错定为实例方法的类，检查静态方法诊断。 */
    class Foo extends React.Component {
      /** 故意定义实例版派生方法并返回空对象；renderer 应忽略它并提示静态声明。 */
      getDerivedStateFromProps() {
        return {};
      }
      /** 返回空 div，使诊断只聚焦于错误的派生 API 声明。 */
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

  /** 把 getDerivedStateFromError 定为实例方法并挂载；诊断要求静态方法且将其忽略，验证错误派生 API 形状识别。 */
  it('warns if getDerivedStateFromError is not static', () => {
    /** 把派生错误 API 错定为实例方法的类，检查静态方法诊断。 */
    class Foo extends React.Component {
      /** 故意定义实例版派生错误方法并返回空对象；renderer 应忽略它并提示静态声明。 */
      getDerivedStateFromError() {
        return {};
      }
      /** 返回空 div，使诊断只聚焦于错误的派生错误 API 声明。 */
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

  /** 把 getSnapshotBeforeUpdate 挂在构造器而非实例，初挂后要求被忽略并建议实例方法；验证快照 API 静态声明诊断。 */
  it('warns if getSnapshotBeforeUpdate is static', () => {
    /** 把快照 API 错定为静态方法的类，检查实例方法诊断。 */
    class Foo extends React.Component {
      /** 故意定义静态快照方法；renderer 应忽略此位置，提示实例方法。 */
      static getSnapshotBeforeUpdate() {}
      /** 返回空 div，使诊断只聚焦于错误的静态快照 API 声明。 */
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

  /** 未初始化 state 却声明静态派生状态，挂载后要求初始化形状诊断；验证派生参数形状提醒，不把可继续渲染误说成拒绝挂载。 */
  it('warns if state not initialized before static getDerivedStateFromProps', () => {
    /** 没有初始 state 却声明静态派生方法的类，检查形状提醒。 */
    class Foo extends React.Component {
      /** 虽未初始化 state，仍按 nextProps.foo 返回 foo/bar 补丁；prevState 未使用，测试只期望形状提醒。 */
      static getDerivedStateFromProps(nextProps, prevState) {
        return {
          foo: nextProps.foo,
          bar: 'bar',
        };
      }
      /** 读取派生后的 foo/bar 输出 div；未设初始 state 的诊断不阻止本例继续渲染。 */
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

  /** 初始 state={foo:foo,bar:bar}，派生方法仅返回 not-foo；输出 not-foo bar，验证补丁覆盖 foo 而保留 bar。 */
  it('updates initial state with values returned by static getDerivedStateFromProps', () => {
    /** 初始 foo/bar 加局部派生补丁的类，检查未返回字段保留。 */
    class Foo extends React.Component {
      /** 初始化 foo/bar 两字段，供局部派生补丁仅替换 foo。 */
      state = {
        foo: 'foo',
        bar: 'bar',
      };
      /** 以 prevState.foo 加 not- 前缀，仅返回 foo 补丁；nextProps 未使用，bar 应被状态合并保留。 */
      static getDerivedStateFromProps(nextProps, prevState) {
        return {
          foo: `not-${prevState.foo}`,
        };
      }
      /** 输出合并后的 foo/bar，供局部派生补丁保留 bar 的断言。 */
      render() {
        return <div className={`${this.state.foo} ${this.state.bar}`} />;
      }
    }
    runTest(<Foo />, 'DIV', 'not-foo bar');
  });

  /** 初始 value=initial，update=false 的派生方法返回 null，再改 update=true 返回 updated；两次宿主 className 分别对应旧/新值，验证 null 保持与补丁更新。 */
  it('renders updated state with values returned by static getDerivedStateFromProps', () => {
    /** 用 update prop 控制派生方法返回 null 或补丁的类。 */
    class Foo extends React.Component {
      /** 初始化 value=initial，供 update prop 决定是否派生更新。 */
      state = {
        value: 'initial',
      };
      /** nextProps.update 为真时返回 value=updated 补丁，否则返回 null 保留状态；prevState 未使用。 */
      static getDerivedStateFromProps(nextProps, prevState) {
        if (nextProps.update) {
          return {
            value: 'updated',
          };
        }
        return null;
      }
      /** 以 state.value 作为 className，观察派生方法返回 null 与更新补丁。 */
      render() {
        return <div className={this.state.value} />;
      }
    }
    runTest(<Foo update={false} />, 'DIV', 'initial');
    runTest(<Foo update={true} />, 'DIV', 'updated');
  });

  if (!require('shared/ReactFeatureFlags').disableLegacyContext) {
    /** 仅旧版 Context 开启时定义此例：Outer 提供 span/foo，消费者构造器从 context 参数和 this.context 建 state；输出 SPAN/foo 并断言迁移告警，验证构造期 context 初始化。 */
    it('renders based on context in the constructor', () => {
      /** 从旧版 context 构造初始 state 的类，仅旧版 Context 开启时使用。 */
      class Foo extends React.Component {
        /** super(props,context) 后分别读取参数 context.tag 和 this.context.className，捕获旧版上下文初始状态。 */
        constructor(props, context) {
          super(props, context);
          this.state = {tag: context.tag, className: this.context.className};
        }

        /** 从 state.tag 选宿主类型、state.className 选类名，观察构造期 context 捕获。 */
        render() {
          const Tag = this.state.tag;
          return <Tag className={this.state.className} />;
        }
      }

      Foo.contextTypes = {
        tag: PropTypes.string,
        className: PropTypes.string,
      };

      /** 旧版 Context 提供者，输出 span/foo 给构造期消费者。 */
      class Outer extends React.Component {
        /** 返回固定 tag=span/className=foo，配合 childContextTypes 传播旧版 Context。 */
        getChildContext() {
          return {tag: 'span', className: 'foo'};
        }

        /** 返回 Foo 消费者，由其构造器捕获旧版 Context。 */
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

  /** 初始 bar=foo，UNSAFE_componentWillMount 调 setState(bar)；同步初挂输出 SPAN/bar 且 renderCount=1，验证挂载前状态合入首次 render。 */
  it('renders only once when setting state in componentWillMount', () => {
    let renderCount = 0;
    /** 挂载前 setState 的类，统计 render 次数检查初挂合并。 */
    class Foo extends React.Component {
      /** super(props) 后建立 bar 初值，随后挂载前钩子把它改为 bar。 */
      constructor(props) {
        super(props);
        this.state = {bar: props.initialValue};
      }
      /** 在首次 render 前合并 bar=bar 的状态更新，测试断言不增加 render 次数。 */
      UNSAFE_componentWillMount() {
        this.setState({bar: 'bar'});
      }
      /** 累加 renderCount 并输出 state.bar，观察挂载前 setState 合并。 */
      render() {
        renderCount++;
        return <span className={this.state.bar} />;
      }
    }
    runTest(<Foo initialValue="foo" />, 'SPAN', 'bar');
    expect(renderCount).toBe(1);
  });

  /** 循环把数组、字符串、数字作为初始 state，每种独立类仍渲染 SPAN；各要求对象或 null 的诊断，验证三类非法状态提醒。 */
  it('should warn with non-object in the initial state property', () => {
    [['an array'], 'a string', 1234].forEach(function (state) {
      /** 循环内每种非法 state 输入独立建类，检查状态形状诊断。 */
      class Foo extends React.Component {
        /** 无参数 super 后把当前循环输入 state 原样安装，故意覆盖数组、字符串、数字三种非法形状。 */
        constructor() {
          super();
          this.state = state;
        }
        /** 输出最小 span，使非法初始 state 的诊断可单独观察。 */
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

  /** 显式 state=null 的类初挂渲染 SPAN/空类名；验证 null 是允许的空状态，区别于非法原始值或数组。 */
  it('should render with null in the initial state property', () => {
    /** 显式 state=null 的类，检查允许的空状态。 */
    class Foo extends React.Component {
      /** 无参数 super 后显式 state=null，构造合法空状态。 */
      constructor() {
        super();
        this.state = null;
      }
      /** 输出最小 span，证明 null 初始 state 可正常挂载。 */
      render() {
        return <span />;
      }
    }
    runTest(<Foo />, 'SPAN', '');
  });

  /** 用 render 中显式 bind(this) 绑定 handleClick，初挂 foo 后调用叶子记录的监听器并同步提交；renderedName 变 bar，验证显式绑定后的实例 setState。 */
  it('setState through an event handler', () => {
    /** 显式 bind 点击方法后传给 Inner 的类，检查事件驱动 setState。 */
    class Foo extends React.Component {
      /** super(props) 后捕获 initialValue，供已绑定点击方法 setState 更新。 */
      constructor(props) {
        super(props);
        this.state = {bar: props.initialValue};
      }
      /** 将 state.bar 更新为 bar；render 中显式 bind(this) 后传给 Inner，支持脱离对象调用。 */
      handleClick() {
        this.setState({bar: 'bar'});
      }
      /** 把 state.bar 与显式 bind(this) 的监听器传给 Inner，供脱离实例调用。 */
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

  /** 用 ES class 原型方法定义 handleClick 并原样传给叶子，脱离实例调用监听器要求抛错；验证 React 不自动绑定语言类方法。 */
  it('should not implicitly bind event handlers', () => {
    /** 将未绑定点击方法传给 Inner 的类，检查脱离实例调用失败。 */
    class Foo extends React.Component {
      /** super(props) 后捕获 initialValue，供未绑定点击方法失败场景。 */
      constructor(props) {
        super(props);
        this.state = {bar: props.initialValue};
      }
      /** 调用 this.setState；本例故意原样传递该方法，脱离对象执行时 this 不可用而抛错。 */
      handleClick() {
        this.setState({bar: 'bar'});
      }
      /** 把 state.bar 与未绑定方法传给 Inner，供脱离实例调用要求抛错。 */
      render() {
        return <Inner name={this.state.bar} onClick={this.handleClick} />;
      }
    }
    runTest(<Foo initialValue="foo" />, 'DIV', 'foo');
    expect(attachedListener).toThrow();
  });

  /** 不用 state，仅保存 mutativeValue；显式绑定的监听器改字段后 forceUpdate，同步提交使 renderedName 从 foo 变 bar，验证强制更新读取可变字段。 */
  it('renders using forceUpdate even when there is no state', () => {
    /** 可变字段加 forceUpdate 的类，检查不经 state 的重渲染。 */
    class Foo extends React.Component {
      /** super(props) 后建立 mutativeValue，更新方法通过 forceUpdate 重读此字段。 */
      constructor(props) {
        super(props);
        this.mutativeValue = props.initialValue;
      }
      /** 先把可变字段改为 bar，再 forceUpdate 安排重渲染；需要 render 中的显式绑定。 */
      handleClick() {
        this.mutativeValue = 'bar';
        this.forceUpdate();
      }
      /** 把可变字段与已绑定 forceUpdate 监听器传给 Inner，观察强制更新输出。 */
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

  /** 类记录旧式生命周期，初挂、props foo→bar 更新、卸载分段清空日志；断言阶段顺序和更新前后 props/state 参数，验证语言类生命周期合同。 */
  it('will call all the normal life cycle methods', () => {
    let lifeCycles = [];
    /** 记录完整旧式生命周期与参数的类，检查挂载、更新、卸载顺序。 */
    class Foo extends React.Component {
      /** 无参数 super 后初始化空 state，给生命周期日志的 nextState/prevState 稳定形状。 */
      constructor() {
        super();
        this.state = {};
      }
      /** 把对应挂载前、挂载提交或卸载阶段名称追加到 lifeCycles，供分段日志检查。 */
      UNSAFE_componentWillMount() {
        lifeCycles.push('will-mount');
      }
      /** 把对应挂载前、挂载提交或卸载阶段名称追加到 lifeCycles，供分段日志检查。 */
      componentDidMount() {
        lifeCycles.push('did-mount');
      }
      /** 追加 receive-props 与 nextProps，供更新时新属性参数检查。 */
      UNSAFE_componentWillReceiveProps(nextProps) {
        lifeCycles.push('receive-props', nextProps);
      }
      /** 记录 nextProps/nextState 并返回 true 允许更新，供参数和阶段顺序断言。 */
      shouldComponentUpdate(nextProps, nextState) {
        lifeCycles.push('should-update', nextProps, nextState);
        return true;
      }
      /** 记录更新前的新 props/state 参数，供与提交后旧参数比较。 */
      UNSAFE_componentWillUpdate(nextProps, nextState) {
        lifeCycles.push('will-update', nextProps, nextState);
      }
      /** 记录 prevProps/prevState，证明提交后的钩子接收更新前数据。 */
      componentDidUpdate(prevProps, prevState) {
        lifeCycles.push('did-update', prevProps, prevState);
      }
      /** 把对应挂载前、挂载提交或卸载阶段名称追加到 lifeCycles，供分段日志检查。 */
      componentWillUnmount() {
        lifeCycles.push('will-unmount');
      }
      /** 输出 props.value 的 span，生命周期日志只记录钩子而不记录 render。 */
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
    /** 仅旧版 Context 开启时定义此例：类声明旧 getInitialState/getDefaultProps 和实例 contextTypes/contextType；挂载告警且两旧方法探针仍 false，验证只诊断、不调用。 */
    it('warns when classic properties are defined on the instance, but does not invoke them.', () => {
      let getDefaultPropsWasCalled = false;
      let getInitialStateWasCalled = false;
      /** 错误使用旧方法和实例 Context 静态声明的类，以探针证明旧方法未被调用。 */
      class Foo extends React.Component {
        /** 无参数 super 后错误地把 contextTypes/contextType 安到实例，触发静态声明建议。 */
        constructor() {
          super();
          this.contextTypes = {};
          this.contextType = {};
        }
        /** 若被 renderer 错误调用就翻转探针；普通类且无显式 state 场景应只告警，不调用。 */
        getInitialState() {
          getInitialStateWasCalled = true;
          return {};
        }
        /** 若被 renderer 错误调用就翻转探针；普通类应只提示静态 defaultProps，不调用此旧方法。 */
        getDefaultProps() {
          getDefaultPropsWasCalled = true;
          return {};
        }
        /** 返回 SPAN/foo，给旧方法及错误实例 Context 声明的诊断提供稳定宿主输出。 */
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

  /** 类字段 state=this.getInitialState() 显式调用旧方法建状态；同步挂载输出 SPAN/foo 且本例没有预期告警，验证用户调用与 renderer 自动调用的边界。 */
  it('does not warn about getInitialState() on class components if state is also defined.', () => {
    /** 通过字段初始化显式调用 getInitialState 的类；区别于 renderer 自动调用旧 API。 */
    class Foo extends React.Component {
      /** 由类字段初始化显式调用 this.getInitialState；调用来自用户代码，renderer 无需调用旧 API。 */
      state = this.getInitialState();
      /** 返回空对象供 state 字段显式初始化；本例用户代码确实调用它，renderer 无需另调用。 */
      getInitialState() {
        return {};
      }
      /** 返回 SPAN/foo，验证显式字段初始化 getInitialState 后无迁移诊断。 */
      render() {
        return <span className="foo" />;
      }
    }
    runTest(<Foo />, 'SPAN', 'foo');
  });

  /** 类错拼 componentShouldUpdate，挂载输出 SPAN/foo 并要求 shouldComponentUpdate 建议；验证名称诊断。 */
  it('should warn when misspelling shouldComponentUpdate', () => {
    /** 以错拼方法 componentShouldUpdate 构造诊断场景，正常 render 使错误聚焦于 API 名称。 */
    class NamedComponent extends React.Component {
      /** 故意错拼的生命周期/更新判定方法，返回 false；renderer 应给正确名称建议，不按该名称调用。 */
      componentShouldUpdate() {
        return false;
      }
      /** 输出稳定 SPAN/foo，使拼写诊断可在成功挂载后断言。 */
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

  /** 类错拼 componentWillRecieveProps，挂载输出 SPAN/foo 并要求正确 Receive 名称；验证旧生命周期拼写诊断。 */
  it('should warn when misspelling componentWillReceiveProps', () => {
    /** 以错拼方法 componentWillRecieveProps 构造诊断场景，正常 render 使错误聚焦于 API 名称。 */
    class NamedComponent extends React.Component {
      /** 故意错拼的生命周期/更新判定方法，返回 false；renderer 应给正确名称建议，不按该名称调用。 */
      componentWillRecieveProps() {
        return false;
      }
      /** 输出稳定 SPAN/foo，使拼写诊断可在成功挂载后断言。 */
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

  /** 类错拼 UNSAFE_componentWillRecieveProps，挂载输出 SPAN/foo 并要求正确 Receive 名称；验证 UNSAFE 变体拼写诊断。 */
  it('should warn when misspelling UNSAFE_componentWillReceiveProps', () => {
    /** 以错拼方法 UNSAFE_componentWillRecieveProps 构造诊断场景，正常 render 使错误聚焦于 API 名称。 */
    class NamedComponent extends React.Component {
      /** 故意错拼的生命周期/更新判定方法，返回 false；renderer 应给正确名称建议，不按该名称调用。 */
      UNSAFE_componentWillRecieveProps() {
        return false;
      }
      /** 输出稳定 SPAN/foo，使拼写诊断可在成功挂载后断言。 */
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

  /** 先用 ref 取得语言类实例，再调用 replaceState 与 isMounted；各要求抛错并给弃用告警，验证普通类上的旧 API 访问边界。 */
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
    /** 仅旧版 Context 开启时定义此例：Foo 的 getChildContext 返回 bar-through-context，Bar 读取 this.context.bar；输出 DIV/该值并要求双方迁移诊断，验证旧上下文传播。 */
    it('supports this.context passed via getChildContext', () => {
      /** 声明旧版 contextTypes.bar 的消费者，观察 Foo.getChildContext 传播值。 */
      class Bar extends React.Component {
        /** 以 this.context.bar 作为 div className，供旧版上下文传播断言。 */
        render() {
          return <div className={this.context.bar} />;
        }
      }

      Bar.contextTypes = {bar: PropTypes.string};

      /** 旧版上下文提供类，为 Bar 返回固定 bar 字符串。 */
      class Foo extends React.Component {
        /** 返回 bar-through-context 字符串，供 Bar 消费者读取。 */
        getChildContext() {
          return {bar: 'bar-through-context'};
        }

        /** 渲染旧版消费者 Bar，构造 getChildContext 传播链。 */
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
