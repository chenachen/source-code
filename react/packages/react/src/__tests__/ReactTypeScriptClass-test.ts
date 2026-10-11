/// <reference path="./testDefinitions/PropTypes.d.ts" />
/// <reference path="./testDefinitions/React.d.ts" />
/// <reference path="./testDefinitions/ReactDOM.d.ts" />
/// <reference path="./testDefinitions/ReactDOMClient.d.ts" />
/// <reference path="./testDefinitions/ReactInternalAct.d.ts" />

/*!
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React = require('react');
import ReactDOM = require('react-dom');
import ReactDOMClient = require('react-dom/client');
import PropTypes = require('prop-types');
import ReactFeatureFlags = require('shared/ReactFeatureFlags');
import TestUtils = require('internal-test-utils');

// 断言助手在模块加载时从测试工具绑定；beforeEach 不重新绑定这些常量。
/** 校验开发态 `console.error` 输出的测试助手。 */
const assertConsoleErrorDev = TestUtils.assertConsoleErrorDev;
/** 校验开发态 `console.warn` 输出的测试助手。 */
const assertConsoleWarnDev = TestUtils.assertConsoleWarnDev;
/** 当前用例挂载 React 根的 DOM 容器。 */
let container;
/** 当前用例创建的客户端根。 */
let root;
/** `Inner` 最近暴露的点击监听器，用于模拟宿主事件。 */
let attachedListener = null;
/** `Inner` 最近渲染的名称，用于验证组件实例读取到的 props/state。 */
let renderedName = null;

/** 测试叶子组件：记录收到的名称与监听器，并渲染对应 className。 */
class Inner extends React.Component {
  /** 返回当前名称属性，供 ref/实例相关断言读取。 */
  getName() {
    return this.props.name;
  }
  /** 捕获测试观测值并生成宿主 div。 */
  render() {
    attachedListener = this.props.onClick;
    renderedName = this.props.name;
    return React.createElement('div', {className: this.props.name});
  }
}

/**
 * 同步渲染元素，并验证首个宿主节点的标签与 className。
 *
 * Given：调用方构造待测类组件元素与期望宿主形状。
 * When：通过 `flushSync` 提交到当前根。
 * Then：容器必须包含匹配标签和类名的首节点。
 */
function test(element, expectedTag, expectedClassName) {
  ReactDOM.flushSync(() => root.render(element));
  expect(container.firstChild).not.toBeNull();
  expect(container.firstChild.tagName).toBe(expectedTag);
  expect(container.firstChild.className).toBe(expectedClassName);
}

// 共享类 fixture 集中在顶层，保留历史测试组织；下方也有内联类，顶层不是当前语法要求。
// TODO：可改用模块隔离，让类名能够重复，并把声明与对应测试放在一起。

/** 验证缺少 `render` 的类仍保留构造器名，以便错误消息指出真实组件。 */
class Empty extends React.Component {}

/** 仅根据 props 渲染的无状态类组件。 */
class SimpleStateless extends React.Component {
  /** 测试故意使用宽松 props，以聚焦 React 类运行时行为。 */
  props: any;
  /** 把 `bar` 映射为 `Inner.name`。 */
  render() {
    return React.createElement(Inner, {name: this.props.bar});
  }
}

/** 用字段初始化器从 props 建立初始 state 的组件。 */
class InitialState extends React.Component {
  /** 由 `initialValue` 捕获的初始类名状态。 */
  state = {
    bar: this.props.initialValue,
  };
  /** 以当前状态渲染 span。 */
  render() {
    return React.createElement('span', {className: this.state.bar});
  }
}

/** 在构造器中根据 props 建立 state，并验证后续 setState 分支。 */
class StateBasedOnProps extends React.Component {
  /** 调用基类后把 `initialValue` 写入状态。 */
  constructor(props) {
    super(props);
    this.state = {bar: props.initialValue};
  }
  /** 把状态切换为 `bar`，驱动宿主类型和类名更新。 */
  changeState() {
    this.setState({bar: 'bar'});
  }
  /** 初始 `foo` 渲染 div，其余状态渲染 span。 */
  render() {
    if (this.state.bar === 'foo') {
      return React.createElement('div', {className: 'foo'});
    }
    return React.createElement('span', {className: this.state.bar});
  }
}

/** 用旧版 context 字段初始化 state 的消费者组件。 */
class StateBasedOnContext extends React.Component {
  /** 声明旧版上下文中需要的标签与类名。 */
  static contextTypes = {
    tag: PropTypes.string,
    className: PropTypes.string,
  };
  /** 在实例字段初始化阶段从 context 捕获渲染参数。 */
  state = {
    tag: this.context.tag,
    className: this.context.className,
  };
  /** 以 context 派生出的动态标签与 className 渲染。 */
  render() {
    const Tag = this.state.tag;
    return React.createElement(Tag, {className: this.state.className});
  }
}

/** 为 `StateBasedOnContext` 提供旧版子上下文的包装组件。 */
class ProvideChildContextTypes extends React.Component {
  /** 声明提供给后代的旧版上下文字段。 */
  static childContextTypes = {
    tag: PropTypes.string,
    className: PropTypes.string,
  };
  /** 返回固定上下文值，建立可预测测试输入。 */
  getChildContext() {
    return {tag: 'span', className: 'foo'};
  }
  /** 渲染上下文消费者。 */
  render() {
    return React.createElement(StateBasedOnContext);
  }
}

/** 记录 `RenderOnce` 的 render 次数，验证挂载前状态合并不会多提交一次。 */
let renderCount = 0;
/** 在 `UNSAFE_componentWillMount` 调用 setState 的兼容性组件。 */
class RenderOnce extends React.Component {
  /** 初始状态来自 props。 */
  state = {
    bar: this.props.initialValue,
  };
  /** 挂载前把状态更新为 `bar`，应并入首次渲染。 */
  UNSAFE_componentWillMount() {
    this.setState({bar: 'bar'});
  }
  /** 累加渲染次数并输出当前状态。 */
  render() {
    renderCount++;
    return React.createElement('span', {className: this.state.bar});
  }
}

/** 使用数组初始 state，验证类 state 必须为对象或 null。 */
class ArrayState extends React.Component {
  /** 故意非法的数组状态。 */
  state = ['an array'];
  /** 提供最小渲染实现，使失败聚焦于 state 校验。 */
  render() {
    return React.createElement('span');
  }
}
/** 使用字符串初始 state 的非法输入组件。 */
class StringState extends React.Component {
  /** 故意非法的字符串状态。 */
  state = 'a string';
  /** 提供最小渲染实现。 */
  render() {
    return React.createElement('span');
  }
}
/** 使用数值初始 state 的非法输入组件。 */
class NumberState extends React.Component {
  /** 故意非法的数值状态。 */
  state = 1234;
  /** 提供最小渲染实现。 */
  render() {
    return React.createElement('span');
  }
}

/** 使用合法 `null` 初始 state 的边界组件。 */
class NullState extends React.Component {
  /** React 允许的空状态。 */
  state = null;
  /** 渲染最小宿主节点以证明挂载成功。 */
  render() {
    return React.createElement('span');
  }
}

/** 通过箭头函数字段绑定实例并在事件处理器中 setState。 */
class BoundEventHandler extends React.Component {
  /** 事件前后的名称状态。 */
  state = {
    bar: this.props.initialValue,
  };
  /** 已绑定实例的点击处理器，把状态更新为 `bar`。 */
  handleClick = () => {
    this.setState({bar: 'bar'});
  };
  /** 把当前状态与绑定监听器传给测试叶子。 */
  render() {
    return React.createElement(Inner, {
      name: this.state.bar,
      onClick: this.handleClick,
    });
  }
}

/** 使用普通原型方法，验证 React 不会隐式绑定事件处理器。 */
class UnboundEventHandler extends React.Component {
  /** 事件前后的名称状态。 */
  state = {
    bar: this.props.initialValue,
  };
  /** 未绑定实例的点击方法；裸调用时不应获得组件 `this`。 */
  handleClick() {
    this.setState({bar: 'bar'});
  }
  /** 把普通方法原样传给测试叶子。 */
  render() {
    return React.createElement(Inner, {
      name: this.state.bar,
      onClick: this.handleClick,
    });
  }
}

/** 不使用 state，通过可变字段与 `forceUpdate` 驱动重新渲染。 */
class ForceUpdateWithNoState extends React.Component {
  /** 不受 React 状态队列管理的测试值。 */
  mutativeValue: string = this.props.initialValue;
  /** 修改字段后强制安排更新。 */
  handleClick() {
    this.mutativeValue = 'bar';
    this.forceUpdate();
  }
  /** 渲染可变值，并显式绑定事件方法。 */
  render() {
    return React.createElement(Inner, {
      name: this.mutativeValue,
      onClick: this.handleClick.bind(this),
    });
  }
}

/** 按发生顺序记录生命周期名称及参数。 */
let lifeCycles = [];
/** 覆盖完整旧式正常生命周期的探针组件。 */
class NormalLifeCycles extends React.Component {
  /** 宽松属性声明，便于记录任意更新输入。 */
  props: any;
  /** 空对象状态，用于生命周期参数断言。 */
  state = {};
  /** 记录挂载前生命周期。 */
  UNSAFE_componentWillMount() {
    lifeCycles.push('will-mount');
  }
  /** 记录挂载提交完成。 */
  componentDidMount() {
    lifeCycles.push('did-mount');
  }
  /** 记录收到的新属性。 */
  UNSAFE_componentWillReceiveProps(nextProps) {
    lifeCycles.push('receive-props', nextProps);
  }
  /** 记录更新判定参数并允许更新继续。 */
  shouldComponentUpdate(nextProps, nextState) {
    lifeCycles.push('should-update', nextProps, nextState);
    return true;
  }
  /** 记录更新前的新属性与状态。 */
  UNSAFE_componentWillUpdate(nextProps, nextState) {
    lifeCycles.push('will-update', nextProps, nextState);
  }
  /** 记录提交后的旧属性与状态。 */
  componentDidUpdate(prevProps, prevState) {
    lifeCycles.push('did-update', prevProps, prevState);
  }
  /** 记录卸载生命周期。 */
  componentWillUnmount() {
    lifeCycles.push('will-unmount');
  }
  /** 以属性值渲染 span，给更新提供可观察输出。 */
  render() {
    return React.createElement('span', {className: this.props.value});
  }
}

/** 是否误调用了实例版 `getInitialState`。 */
let getInitialStateWasCalled = false;
/** 是否误调用了实例版 `getDefaultProps`。 */
let getDefaultPropsWasCalled = false;
/** 定义旧 createClass 属性的普通 ES 类，用于验证只告警而不调用。 */
class ClassicProperties extends React.Component {
  /** 故意错误地声明为实例字段的 contextTypes。 */
  contextTypes = {};
  /** 故意错误地声明为实例字段的 contextType。 */
  contextType = {};
  /** 若被错误调用则翻转探针。 */
  getDefaultProps() {
    getDefaultPropsWasCalled = true;
    return {};
  }
  /** 若被错误调用则翻转探针。 */
  getInitialState() {
    getInitialStateWasCalled = true;
    return {};
  }
  /** 输出稳定宿主节点，让断言聚焦于旧属性告警。 */
  render() {
    return React.createElement('span', {className: 'foo'});
  }
}

/** 故意把 `shouldComponentUpdate` 拼成陈述式名称的组件。 */
class MisspelledComponent1 extends React.Component {
  /** 错拼的方法，React 应识别并给出建议。 */
  componentShouldUpdate() {
    return false;
  }
  /** 输出稳定宿主节点。 */
  render() {
    return React.createElement('span', {className: 'foo'});
  }
}

/** 故意把 `Receive` 拼成 `Recieve` 的旧生命周期组件。 */
class MisspelledComponent2 extends React.Component {
  /** 错拼的旧生命周期，React 应识别并给出建议。 */
  componentWillRecieveProps() {
    return false;
  }
  /** 输出稳定宿主节点。 */
  render() {
    return React.createElement('span', {className: 'foo'});
  }
}

/** 故意错拼 UNSAFE 接收属性生命周期的组件。 */
class MisspelledComponent3 extends React.Component {
  /** 错拼的 UNSAFE 生命周期，React 应识别并给出建议。 */
  UNSAFE_componentWillRecieveProps() {
    return false;
  }
  /** 输出稳定宿主节点。 */
  render() {
    return React.createElement('span', {className: 'foo'});
  }
}

/** 从旧版 `this.context` 读取值的消费者。 */
class ReadContext extends React.Component {
  /** 声明需要的旧版上下文字段。 */
  static contextTypes = {bar: PropTypes.string};
  /** 把上下文值映射为宿主 className。 */
  render() {
    return React.createElement('div', {className: this.context.bar});
  }
}
/** 通过 `getChildContext` 提供旧版上下文的父组件。 */
class ProvideContext extends React.Component {
  /** 声明向后代提供的旧版上下文字段。 */
  static childContextTypes = {bar: PropTypes.string};
  /** 返回稳定上下文值。 */
  getChildContext() {
    return {bar: 'bar-through-context'};
  }
  /** 渲染旧版上下文消费者。 */
  render() {
    return React.createElement(ReadContext);
  }
}

/** 保留旧字符串 ref 写法的夹具声明；当前测试未挂载它，不能据此推断字符串 ref 仍受支持。 */
class ClassicRefs extends React.Component {
  /** 创建带字符串 ref 的 `Inner`。 */
  render() {
    return React.createElement(Inner, {name: 'foo', ref: 'inner'});
  }
}

// 以下开始定义实际测试用例；上方顶层类由这些用例复用。

describe('ReactTypeScriptClass', function () {
  // 每例创建新 root/container 并清空叶子事件/名称探针；顶层 fixture 类型共享，计数与旧方法探针由对应用例另重置。
  beforeEach(function () {
    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    attachedListener = null;
    renderedName = null;
  });

  /** 顶层 TypeScript 类名 Empty 编译后读取 name 仍为 Empty，验证构造器名称可供 React 诊断使用。 */
  it('preserves the name of the class for use in error messages', function () {
    // Given：顶层声明了名为 Empty 的类组件。
    // When：直接读取 TypeScript 编译后保留的构造器名称。
    // Then：名称仍为 Empty，React 的后续错误消息即可准确指出组件。
    expect(Empty.name).toBe('Empty');
  });

  /** 实际挂载无 render 的 Empty，捕获并阻止 window error 默认报告；断言两条缺 render 诊断且 caughtErrors.length=1，finally 移除监听器，验证错误报告次数。内联 Foo 没有被挂载。 */
  it('throws if no render function is defined', function () {
    /** 给错误事件路径提供另一个无 render 的类名样本。 */
    class Foo extends React.Component {}
    const caughtErrors = [];
    /** 阻止浏览器默认错误传播，并收集 renderer 抛出的错误。 */
    function errorHandler(event) {
      event.preventDefault();
      caughtErrors.push(event.error);
    }
    window.addEventListener('error', errorHandler);
    try {
      ReactDOM.flushSync(() => root.render(React.createElement(Empty)));
      assertConsoleErrorDev([
        // 并发开发模式会把失败组件尝试两次，因此期望两条完全一致的诊断。
        'No `render` method found on the Empty instance: ' +
          'you may have forgotten to define `render`.\n' +
          '    in Empty (at **)',
        'No `render` method found on the Empty instance: ' +
          'you may have forgotten to define `render`.\n' +
          '    in Empty (at **)',
      ]);
    } finally {
      window.removeEventListener('error', errorHandler);
    }
    expect(caughtErrors.length).toBe(1);
  });

  /** 无 state 的 Foo 把 bar prop 传给叶子，先 foo 再 bar 同步渲染；宿主 className 随 props 改变，验证同类实例更新。 */
  it('renders a simple stateless component with prop', function () {
    test(React.createElement(SimpleStateless, {bar: 'foo'}), 'DIV', 'foo');
    test(React.createElement(SimpleStateless, {bar: 'bar'}), 'DIV', 'bar');
  });

  /** InitialState 通过类字段初始化器从 this.props.initialValue 建 state.bar，初挂 foo 输出 SPAN/foo，验证编译后字段初始化能读取基类 props。 */
  it('renders based on state using initial values in this.props', function () {
    test(
      React.createElement(InitialState, {initialValue: 'foo'}),
      'SPAN',
      'foo',
    );
  });

  /** 构造器从参数 initialValue 建 state，ref 调 changeState 后同步提交；DIV/foo 变 SPAN/bar，再同类重渲染仍保留 bar，验证状态更新与宿主替换。 */
  it('renders based on state using props in the constructor', function () {
    const ref = React.createRef();
    test(
      React.createElement(StateBasedOnProps, {initialValue: 'foo', ref: ref}),
      'DIV',
      'foo',
    );
    ReactDOM.flushSync(() => ref.current.changeState());
    test(React.createElement(StateBasedOnProps), 'SPAN', 'bar');
  });

  /** 初始 state.foo=null，静态派生方法返回 foo prop 与 bar 常量；初挂得到 DIV/foo bar，验证派生补丁在首次 render 前合并。 */
  it('sets initial state with value returned by static getDerivedStateFromProps', function () {
    /** 验证派生状态在首次渲染前合并 props 与固定字段。 */
    class Foo extends React.Component {
      /** 为派生状态提供稳定初始形状。 */
      state = {
        foo: null,
        bar: null,
      };
      /** 按 nextProps.foo 和固定 bar 返回首次状态补丁；prevState 未使用。 */
      static getDerivedStateFromProps(nextProps, prevState) {
        return {
          foo: nextProps.foo,
          bar: 'bar',
        };
      }
      /** 输出合并后的两个状态字段。 */
      render() {
        return React.createElement('div', {
          className: `${this.state.foo} ${this.state.bar}`,
        });
      }
    }
    test(React.createElement(Foo, {foo: 'foo'}), 'DIV', 'foo bar');
  });

  /** 把 getDerivedStateFromProps 定为实例方法并挂载；诊断要求静态方法且将其忽略，验证错误 API 形状识别。 */
  it('warns if getDerivedStateFromProps is not static', function () {
    /** 故意把派生状态 API 定义为实例方法。 */
    class Foo extends React.Component {
      /** 应被忽略并触发静态方法建议。 */
      getDerivedStateFromProps() {
        return {};
      }
      /** 输出稳定宿主节点。 */
      render() {
        return React.createElement('div', {});
      }
    }
    ReactDOM.flushSync(() =>
      root.render(React.createElement(Foo, {foo: 'foo'})),
    );
    assertConsoleErrorDev([
      'Foo: getDerivedStateFromProps() is defined as an instance method ' +
        'and will be ignored. Instead, declare it as a static method.\n' +
        '    in Foo (at **)',
    ]);
  });

  /** 把 getDerivedStateFromError 定为实例方法并挂载；诊断要求静态方法且将其忽略，验证错误派生 API 形状识别。 */
  it('warns if getDerivedStateFromError is not static', function () {
    /** 故意把派生错误状态 API 定义为实例方法。 */
    class Foo extends React.Component {
      /** 应被忽略并触发静态方法建议。 */
      getDerivedStateFromError() {
        return {};
      }
      /** 输出稳定宿主节点。 */
      render() {
        return React.createElement('div');
      }
    }
    ReactDOM.flushSync(() =>
      root.render(React.createElement(Foo, {foo: 'foo'})),
    );
    assertConsoleErrorDev([
      'Foo: getDerivedStateFromError() is defined as an instance method ' +
        'and will be ignored. Instead, declare it as a static method.\n' +
        '    in Foo (at **)',
    ]);
  });

  /** 把 getSnapshotBeforeUpdate 挂在构造器而非实例，初挂后要求被忽略并建议实例方法；验证快照 API 静态声明诊断。 */
  it('warns if getSnapshotBeforeUpdate is static', function () {
    /** 故意把更新快照 API 定义为静态方法。 */
    class Foo extends React.Component {
      /** 应被忽略并触发实例方法建议。 */
      static getSnapshotBeforeUpdate() {}
      /** 输出稳定宿主节点。 */
      render() {
        return React.createElement('div', {});
      }
    }
    ReactDOM.flushSync(() =>
      root.render(React.createElement(Foo, {foo: 'foo'})),
    );
    assertConsoleErrorDev([
      'Foo: getSnapshotBeforeUpdate() is defined as a static method ' +
        'and will be ignored. Instead, declare it as an instance method.\n' +
        '    in Foo (at **)',
    ]);
  });

  /** 未初始化 state 却声明静态派生状态，挂载后要求初始化形状诊断；验证派生参数形状提醒，不把可继续渲染误说成拒绝挂载。 */
  it('warns if state not initialized before static getDerivedStateFromProps', function () {
    /** 缺少初始 state 却声明派生状态钩子的错误形状。 */
    class Foo extends React.Component {
      /** 返回对象补丁，但旧状态形状不稳定，React 应告警。 */
      static getDerivedStateFromProps(nextProps, prevState) {
        return {
          foo: nextProps.foo,
          bar: 'bar',
        };
      }
      /** 读取派生后的状态字段。 */
      render() {
        return React.createElement('div', {
          className: `${this.state.foo} ${this.state.bar}`,
        });
      }
    }
    ReactDOM.flushSync(() =>
      root.render(React.createElement(Foo, {foo: 'foo'})),
    );
    assertConsoleErrorDev([
      '`Foo` uses `getDerivedStateFromProps` but its initial state is ' +
        'undefined. This is not recommended. Instead, define the initial state by ' +
        'assigning an object to `this.state` in the constructor of `Foo`. ' +
        'This ensures that `getDerivedStateFromProps` arguments have a consistent shape.\n' +
        '    in Foo (at **)',
    ]);
  });

  /** 初始 state={foo:foo,bar:bar}，派生方法仅返回 not-foo；输出 not-foo bar，验证补丁覆盖 foo 而保留 bar。 */
  it('updates initial state with values returned by static getDerivedStateFromProps', function () {
    /** 验证派生状态可读取并覆盖初始状态，同时保留未返回字段。 */
    class Foo extends React.Component {
      /** 派生前的完整初始状态。 */
      state = {
        foo: 'foo',
        bar: 'bar',
      };
      /** 按 prevState.foo 返回 not-foo，省略 bar 以验证浅合并；nextProps 未使用。 */
      static getDerivedStateFromProps(nextProps, prevState) {
        return {
          foo: `not-${prevState.foo}`,
        };
      }
      /** 输出派生后的 foo 与保留的 bar。 */
      render() {
        return React.createElement('div', {
          className: `${this.state.foo} ${this.state.bar}`,
        });
      }
    }
    test(React.createElement(Foo), 'DIV', 'not-foo bar');
  });

  /** 初始 value=initial，update=false 的派生方法返回 null，再改 update=true 返回 updated；两次宿主 className 分别对应旧/新值，验证 null 保持与补丁更新。 */
  it('renders updated state with values returned by static getDerivedStateFromProps', function () {
    /** 验证更新时派生状态可按 props 条件返回补丁或 null。 */
    class Foo extends React.Component {
      /** 更新前的初始值。 */
      state = {
        value: 'initial',
      };
      /** nextProps.update 为真返回 value=updated 补丁，否则 null 保持原 state；prevState 未使用。 */
      static getDerivedStateFromProps(nextProps, prevState) {
        if (nextProps.update) {
          return {
            value: 'updated',
          };
        }
        return null;
      }
      /** 输出当前派生值。 */
      render() {
        return React.createElement('div', {className: this.state.value});
      }
    }
    test(React.createElement(Foo, {update: false}), 'DIV', 'initial');
    test(React.createElement(Foo, {update: true}), 'DIV', 'updated');
  });

  if (!ReactFeatureFlags.disableLegacyContext) {
    /** 仅旧版 Context 开启时定义：ProvideChildContextTypes 提供 span/foo，StateBasedOnContext 在类字段初始化器读取 this.context 建 state；输出 SPAN/foo并断言双方迁移诊断，实际不是本体显式 constructor 读取。 */
    it('renders based on context in the constructor', function () {
      test(React.createElement(ProvideChildContextTypes), 'SPAN', 'foo');
      assertConsoleErrorDev([
        'ProvideChildContextTypes uses the legacy childContextTypes API which will soon be removed. ' +
          'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
          '    in ProvideChildContextTypes (at **)',
        'StateBasedOnContext uses the legacy contextTypes API which will soon be removed. ' +
          'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
          '    in ProvideChildContextTypes.createElement (at **)',
      ]);
    });
  }

  /** 初始 bar=foo，UNSAFE_componentWillMount 调 setState(bar)；同步初挂输出 SPAN/bar 且 renderCount=1，验证挂载前状态合入首次 render。 */
  it('renders only once when setting state in componentWillMount', function () {
    renderCount = 0;
    test(React.createElement(RenderOnce, {initialValue: 'foo'}), 'SPAN', 'bar');
    expect(renderCount).toBe(1);
  });

  /** 三个顶层类分别以数组、字符串、数字作 state，依次同 root 渲染为 SPAN并各断言对应类型名的对象/null诊断，验证非法初始状态提醒。 */
  it('should warn with non-object in the initial state property', function () {
    test(React.createElement(ArrayState), 'SPAN', '');
    assertConsoleErrorDev([
      'ArrayState.state: must be set to an object or null\n' +
        '    in ArrayState (at **)',
    ]);
    test(React.createElement(StringState), 'SPAN', '');
    assertConsoleErrorDev([
      'StringState.state: must be set to an object or null\n' +
        '    in StringState (at **)',
    ]);
    test(React.createElement(NumberState), 'SPAN', '');
    assertConsoleErrorDev([
      'NumberState.state: must be set to an object or null\n' +
        '    in NumberState (at **)',
    ]);
  });

  /** 显式 state=null 的类初挂渲染 SPAN/空类名；验证 null 是允许的空状态，区别于非法原始值或数组。 */
  it('should render with null in the initial state property', function () {
    test(React.createElement(NullState), 'SPAN', '');
  });

  /** BoundEventHandler 用箭头函数字段绑定 this，初挂 foo 后裸调用叶子监听器并 flushSync；renderedName 变 bar，验证 TS 字段绑定的实例 setState。 */
  it('setState through an event handler', function () {
    test(
      React.createElement(BoundEventHandler, {initialValue: 'foo'}),
      'DIV',
      'foo',
    );
    ReactDOM.flushSync(() => attachedListener());
    expect(renderedName).toBe('bar');
  });

  /** UnboundEventHandler 把原型 handleClick 原样传给 Inner，初挂 foo 后裸调用要求抛错，验证 React 不自动绑定类原型方法。 */
  it('should not implicitly bind event handlers', function () {
    test(
      React.createElement(UnboundEventHandler, {initialValue: 'foo'}),
      'DIV',
      'foo',
    );
    expect(attachedListener).toThrow();
  });

  /** ForceUpdateWithNoState 不用 state，保存 mutativeValue；render 显式 bind 的监听器改为 bar并forceUpdate，同步提交后renderedName=bar，验证可变字段重读。 */
  it('renders using forceUpdate even when there is no state', function () {
    test(
      React.createElement(ForceUpdateWithNoState, {initialValue: 'foo'}),
      'DIV',
      'foo',
    );
    ReactDOM.flushSync(() => attachedListener());
    expect(renderedName).toBe('bar');
  });

  /** NormalLifeCycles 初挂 foo、更新 bar、卸载，三段分别清空 lifeCycles；比较旧式钩子顺序以及新 props/空 state 和 didUpdate 旧 props，验证 TS 类生命周期合同。root.unmount 的多余 container 实参不参与卸载选择。 */
  it('will call all the normal life cycle methods', function () {
    lifeCycles = [];
    test(React.createElement(NormalLifeCycles, {value: 'foo'}), 'SPAN', 'foo');
    expect(lifeCycles).toEqual(['will-mount', 'did-mount']);
    lifeCycles = []; // 清空挂载记录，单独观察更新阶段。
    test(React.createElement(NormalLifeCycles, {value: 'bar'}), 'SPAN', 'bar');
    expect(lifeCycles).toEqual([
      'receive-props',
      {value: 'bar'},
      'should-update',
      {value: 'bar'},
      {},
      'will-update',
      {value: 'bar'},
      {},
      'did-update',
      {value: 'foo'},
      {},
    ]);
    lifeCycles = []; // 清空更新记录，单独观察卸载阶段。
    ReactDOM.flushSync(() => root.unmount(container));
    expect(lifeCycles).toEqual(['will-unmount']);
  });

  if (!ReactFeatureFlags.disableLegacyContext) {
    /** 仅旧版 Context 开启时定义此例：类声明旧 getInitialState/getDefaultProps 和实例 contextTypes/contextType；挂载告警且两旧方法探针仍 false，验证只诊断、不调用。 */
    it(
      'warns when classic properties are defined on the instance, ' +
        'but does not invoke them.',
      function () {
        getInitialStateWasCalled = false;
        getDefaultPropsWasCalled = false;
        test(React.createElement(ClassicProperties), 'SPAN', 'foo');
        assertConsoleErrorDev([
          'getInitialState was defined on ClassicProperties, a plain JavaScript class. ' +
            'This is only supported for classes created using React.createClass. ' +
            'Did you mean to define a state property instead?\n' +
            '    in ClassicProperties (at **)',
          'getDefaultProps was defined on ClassicProperties, a plain JavaScript class. ' +
            'This is only supported for classes created using React.createClass. ' +
            'Use a static property to define defaultProps instead.\n' +
            '    in ClassicProperties (at **)',
          'contextType was defined as an instance property on ClassicProperties. ' +
            'Use a static property to define contextType instead.\n' +
            '    in ClassicProperties (at **)',
          'contextTypes was defined as an instance property on ClassicProperties. ' +
            'Use a static property to define contextTypes instead.\n' +
            '    in ClassicProperties (at **)',
        ]);
        expect(getInitialStateWasCalled).toBe(false);
        expect(getDefaultPropsWasCalled).toBe(false);
      },
    );
  }

  /** 内联 Example 已有 state={} 且定义旧 getInitialState，挂载 SPAN/foo 无预期诊断；未记录该方法调用次数，验证显式 state 的迁移提醒边界。 */
  it(
    'does not warn about getInitialState() on class components ' +
      'if state is also defined.',
    () => {
      /** 同时定义 state 与旧 `getInitialState`，验证已有 state 时不提示。 */
      class Example extends React.Component {
        /** 显式 state 使旧方法不会构成迁移风险。 */
        state = {};
        /** 旧 createClass 风格方法；此处不应被调用或告警。 */
        getInitialState() {
          return {};
        }
        /** 输出稳定宿主节点。 */
        render() {
          return React.createElement('span', {className: 'foo'});
        }
      }

      test(React.createElement(Example), 'SPAN', 'foo');
    },
  );

  /** 类错拼 componentShouldUpdate，挂载输出 SPAN/foo 并要求 shouldComponentUpdate 建议；验证名称诊断。 */
  it('should warn when misspelling shouldComponentUpdate', function () {
    test(React.createElement(MisspelledComponent1), 'SPAN', 'foo');
    assertConsoleErrorDev([
      'MisspelledComponent1 has a method called componentShouldUpdate(). Did ' +
        'you mean shouldComponentUpdate()? The name is phrased as a question ' +
        'because the function is expected to return a value.\n' +
        '    in MisspelledComponent1 (at **)',
    ]);
  });

  /** 类错拼 componentWillRecieveProps，挂载输出 SPAN/foo 并要求正确 Receive 名称；验证旧生命周期拼写诊断。 */
  it('should warn when misspelling componentWillReceiveProps', function () {
    test(React.createElement(MisspelledComponent2), 'SPAN', 'foo');
    assertConsoleErrorDev([
      'MisspelledComponent2 has a method called componentWillRecieveProps(). ' +
        'Did you mean componentWillReceiveProps()?\n' +
        '    in MisspelledComponent2 (at **)',
    ]);
  });

  /** 类错拼 UNSAFE_componentWillRecieveProps，挂载输出 SPAN/foo 并要求正确 Receive 名称；验证 UNSAFE 变体拼写诊断。 */
  it('should warn when misspelling UNSAFE_componentWillReceiveProps', function () {
    test(React.createElement(MisspelledComponent3), 'SPAN', 'foo');
    assertConsoleErrorDev([
      'MisspelledComponent3 has a method called UNSAFE_componentWillRecieveProps(). ' +
        'Did you mean UNSAFE_componentWillReceiveProps()?\n' +
        '    in MisspelledComponent3 (at **)',
    ]);
  });

  /** 先用 ref 取得语言类实例，再调用 replaceState 与 isMounted；各要求抛错并给弃用告警，验证普通类上的旧 API 访问边界。 */
  it('should throw AND warn when trying to access classic APIs', function () {
    const ref = React.createRef();
    test(React.createElement(Inner, {name: 'foo', ref: ref}), 'DIV', 'foo');
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

  if (!ReactFeatureFlags.disableLegacyContext) {
    /** 仅旧版 Context 开启时定义此例：Foo 的 getChildContext 返回 bar-through-context，Bar 读取 this.context.bar；输出 DIV/该值并要求双方迁移诊断，验证旧上下文传播。 */
    it('supports this.context passed via getChildContext', () => {
      test(React.createElement(ProvideContext), 'DIV', 'bar-through-context');
      assertConsoleErrorDev([
        'ProvideContext uses the legacy childContextTypes API which will soon be removed. ' +
          'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
          '    in ProvideContext (at **)',
        'ReadContext uses the legacy contextTypes API which will soon be removed. ' +
          'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
          '    in ProvideContext.createElement (at **)',
      ]);
    });
  }
});
