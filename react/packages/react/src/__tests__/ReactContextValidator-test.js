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
  // 每例重置模块并重新取 act/诊断工具，隔离各组件类型的 Context 告警缓存。
  beforeEach(() => {
    jest.resetModules();

    PropTypes = require('prop-types');
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ({act, assertConsoleErrorDev} = require('internal-test-utils'));
  });

  // TODO：此行为会引入对 propTypes 的运行时依赖；应确认使用 Flow 的 ES6 class 不需要该依赖。

  // @gate !disableLegacyContext
  /** 旧版提供者输出 foo=abc/bar=123，消费者只声明 foo；act 挂载后实例 context 仅含 foo，且两类型各有迁移告警，验证 contextTypes 掩码。 */
  it('should filter out context not in contextTypes', async () => {
    /** 旧版 context 消费者，仅声明 foo；由父组件提供 foo/bar，供实例 context 掩码断言。 */
    class Component extends React.Component {
      /** 返回空 div，使挂载成功且不影响对实例 context 的检查。 */
      render() {
        return <div />;
      }
    }
    Component.contextTypes = {
      foo: PropTypes.string,
    };

    /** 旧版提供者以 childRef 暴露消费者实例；提供 foo 与 bar，验证未声明字段被过滤。 */
    class ComponentInFooBarContext extends React.Component {
      /** 每个父实例独立 ref，提交后取得消费者实例及其已过滤 context。 */
      childRef = React.createRef();

      /** 返回 foo=abc/bar=123，覆盖消费者只订阅 foo 的掩码边界。 */
      getChildContext() {
        return {
          foo: 'abc',
          bar: 123,
        };
      }

      /** 将独立 childRef 传给消费者，供提交后的 context 检查。 */
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
  /** 旧版父 foo 从 abc 更新到 def，子只订阅 foo；挂载阶段全读 abc，接收/SCU/更新前 this.context 仍旧且 nextContext 为新，render/didUpdate 已为 def，验证字段过滤和切换时机。 */
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

    /** 把 props.foo 与固定 bar 作为旧版 context；两次 root.render 驱动消费者生命周期。 */
    class Parent extends React.Component {
      /** 根据当前父 props 返回 foo，并附带消费者未订阅的 bar。 */
      getChildContext() {
        return {
          foo: this.props.foo,
          bar: 'bar',
        };
      }
      /** 返回同一消费者类型，使父 foo 更新复用实例并进入更新生命周期。 */
      render() {
        return <Component />;
      }
    }
    Parent.childContextTypes = {
      foo: PropTypes.string.isRequired,
      bar: PropTypes.string.isRequired,
    };

    /** 逐阶段捕获旧版 context 的探针；区分更新前 this.context 与传入 nextContext。 */
    class Component extends React.Component {
      /** 把 props/context 交给基类，并记录已过滤的挂载 context；不复制该对象。 */
      constructor(props, context) {
        super(props, context);
        constructorContext = context;
      }
      /** 记录旧 this.context 与更新参数 nextContext；nextProps 不使用，返回 true 不参与更新判定。 */
      UNSAFE_componentWillReceiveProps(nextProps, nextContext) {
        componentWillReceivePropsContext = this.context;
        componentWillReceivePropsNextContext = nextContext;
        return true;
      }
      /** 记录旧 context 与第三参数 nextContext，然后返回 true 允许更新；props/state 参数只满足生命周期签名。 */
      shouldComponentUpdate(nextProps, nextState, nextContext) {
        shouldComponentUpdateContext = this.context;
        shouldComponentUpdateNextContext = nextContext;
        return true;
      }
      /** 在 render 前记录旧 context 和第三参数新 context；用于检查切换时机。 */
      UNSAFE_componentWillUpdate(nextProps, nextState, nextContext) {
        componentWillUpdateContext = this.context;
        componentWillUpdateNextContext = nextContext;
      }
      /** 记录本次渲染读取的新 this.context，再返回最小宿主 div。 */
      render() {
        renderContext = this.context;
        return <div />;
      }
      /** 提交挂载后捕获 this.context，供与 constructor/render 阶段比较。 */
      componentDidMount() {
        componentDidMountContext = this.context;
      }
      /** 提交更新后捕获 this.context，证明 commit 已可读取新值。 */
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
  /** A/B 各声明旧版 childContextTypes 却缺少 getChildContext；先挂 A、重渲染 A、再挂 B，act 均完成且诊断各类型一次，验证缺少方法的兼容警告与类型去重。 */
  it('should warn (but not error) if getChildContext method is missing', async () => {
    /** 只声明旧版 childContextTypes 而故意缺少 getChildContext；分别作为两个类型验证告警去重。 */
    class ComponentA extends React.Component {
      /** 声明必需 foo，却不提供实例 getChildContext，触发缺少提供方法的诊断。 */
      static childContextTypes = {
        foo: PropTypes.string.isRequired,
      };
      /** 返回 div，使告警场景可以正常完成挂载，避免另引入 render 错误。 */
      render() {
        return <div />;
      }
    }
    /** 只声明旧版 childContextTypes 而故意缺少 getChildContext；分别作为两个类型验证告警去重。 */
    class ComponentB extends React.Component {
      /** 声明必需 foo，却不提供实例 getChildContext，触发缺少提供方法的诊断。 */
      static childContextTypes = {
        foo: PropTypes.string.isRequired,
      };
      /** 返回 div，使告警场景可以正常完成挂载，避免另引入 render 错误。 */
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
  /** 祖先提供 foo=FOO，中间层声明 bar 却缺少 getChildContext，后代订阅两字段；挂载诊断后 foo 保留、bar 未定义，验证中间错误形状不会丢祖先 context。 */
  it('should pass parent context if getChildContext method is missing', async () => {
    /** 祖先旧版提供者输出 foo=FOO；通过缺少提供方法的中间层检查 context 保留。 */
    class ParentContextProvider extends React.Component {
      /** 声明父提供者可以输出的旧版 foo 字段，供后代继承路径使用。 */
      static childContextTypes = {
        foo: PropTypes.string,
      };
      /** 返回固定 foo=FOO，作为旧版 context 传播与新旧 API 冲突场景的输入。 */
      getChildContext() {
        return {
          foo: 'FOO',
        };
      }
      /** 渲染缺少 getChildContext 的中间层，形成祖先→中间→消费者链。 */
      render() {
        return <MiddleMissingContext />;
      }
    }

    /** 声明必需 bar 却没有 getChildContext；检查告警后仍传递祖先 foo 的兼容行为。 */
    class MiddleMissingContext extends React.Component {
      /** 声明 bar 为必需字符串，故意不实现 getChildContext，构造缺失提供者形状。 */
      static childContextTypes = {
        bar: PropTypes.string.isRequired,
      };
      /** 把 ChildContextConsumer 放在中间层下，让其观察祖先 foo 与缺失 bar。 */
      render() {
        return <ChildContextConsumer />;
      }
    }

    let childContext;
    /** 同时订阅 foo/bar 的旧版消费者；把实际 context 写入外部探针供提交后断言。 */
    class ChildContextConsumer extends React.Component {
      /** 保存 this.context 到 childContext 并返回 div；验证 foo 继承与 bar 缺失。 */
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

  /** 现代 Provider 从 firstContext 对象换为 secondContext，类用 contextType 订阅；断言挂载/更新各阶段严格引用身份以及 SCU 被调用，验证更新前旧值和 render/commit 新值的切换。 */
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

    /** 订阅现代 Context 的生命周期探针；父 Provider 替换对象身份，观察旧/新 context 时机与 SCU 调用。 */
    class Component extends React.Component {
      /** 订阅本例现代 Context；renderer 把 Provider 值交给 constructor 和 this.context。 */
      static contextType = Context;
      /** 把 props/context 交给基类并保存挂载 context 引用；供严格身份断言。 */
      constructor(props, context) {
        super(props, context);
        constructorContext = context;
      }
      /** 同时记录旧 this.context 与传入的 nextContext；返回 true 不承担 SCU 决策。 */
      UNSAFE_componentWillReceiveProps(nextProps, nextContext) {
        componentWillReceivePropsContext = this.context;
        componentWillReceivePropsNextContext = nextContext;
        return true;
      }
      /** 把调用探针设为 true 并允许更新；形参不用于计算，测试只断言调用确实发生。 */
      shouldComponentUpdate(nextProps, nextState, nextContext) {
        shouldComponentUpdateWasCalled = true;
        return true;
      }
      /** 在 render 前捕获旧 this.context 与新 nextContext 对象，供严格身份检查。 */
      UNSAFE_componentWillUpdate(nextProps, nextState, nextContext) {
        componentWillUpdateContext = this.context;
        componentWillUpdateNextContext = nextContext;
      }
      /** 保存当前 this.context 引用并输出 div，证明 render 已读到第二个 Provider 对象。 */
      render() {
        renderContext = this.context;
        return <div />;
      }
      /** 保存挂载提交后的 context 引用，与 constructor/render 共同比较 firstContext。 */
      componentDidMount() {
        componentDidMountContext = this.context;
      }
      /** 保存更新提交后的 context 引用，供 secondContext 严格身份断言。 */
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

  /** PureComponent 没有变化的 props/state，只订阅 Context；Provider 换对象后 renderedContext 必须为新引用，验证 Context 更新驱动消费者重渲染。 */
  it('should re-render PureComponents when context Provider updates', async () => {
    let renderedContext;

    const Context = React.createContext();

    /** 无 props/state 变化的 PureComponent 消费者；检查 Context 依赖更新可穿过浅比较优化。 */
    class Component extends React.PureComponent {
      /** 订阅本例现代 Context；renderer 把 Provider 值交给 constructor 和 this.context。 */
      static contextType = Context;
      /** 把 this.context 写到 renderedContext，观察 Provider 换值是否确实重渲染。 */
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
  /** 旧版祖先下 A/B 同时声明新旧 Context API；重复挂 A 再切 B，各类型一次冲突与迁移诊断，验证现代订阅优先和警告去重。 */
  it('should warn if both contextType and contextTypes are defined', async () => {
    const Context = React.createContext();

    /** 旧版祖先提供 foo 并透传 children；用于同时定义 contextType/contextTypes 的冲突告警。 */
    class ParentContextProvider extends React.Component {
      /** 声明父提供者可以输出的旧版 foo 字段，供后代继承路径使用。 */
      static childContextTypes = {
        foo: PropTypes.string,
      };
      /** 返回固定 foo=FOO，作为旧版 context 传播与新旧 API 冲突场景的输入。 */
      getChildContext() {
        return {
          foo: 'FOO',
        };
      }
      /** 透传本例 children，让 A/B 分别在同一旧版提供者下挂载。 */
      render() {
        return this.props.children;
      }
    }

    /** 同时定义现代 contextType 和旧版 contextTypes；两个独立类型检查冲突告警按类型去重。 */
    class ComponentA extends React.Component {
      /** 旧版 foo 订阅声明，与现代 contextType 冲突；本例要求诊断指出旧版声明被忽略。 */
      static contextTypes = {
        foo: PropTypes.string.isRequired,
      };
      /** 现代 Context 订阅，与旧版 contextTypes 同时存在时获得优先选择。 */
      static contextType = Context;
      /** 返回空 div，仅触发组件静态 context 声明校验，不读取 context 值。 */
      render() {
        return <div />;
      }
    }
    /** 同时定义现代 contextType 和旧版 contextTypes；两个独立类型检查冲突告警按类型去重。 */
    class ComponentB extends React.Component {
      /** 旧版 foo 订阅声明，与现代 contextType 冲突；本例要求诊断指出旧版声明被忽略。 */
      static contextTypes = {
        foo: PropTypes.string.isRequired,
      };
      /** 现代 Context 订阅，与旧版 contextTypes 同时存在时获得优先选择。 */
      static contextType = Context;
      /** 返回空 div，仅触发组件静态 context 声明校验，不读取 context 值。 */
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

  /** A 的 contextType 为 Consumer，重复挂载只报一次无效类型建议；再挂 contextType=Provider 的 B 并完成 act，验证当前 Provider 等同 Context 的允许身份，末段没有单独输出断言。 */
  it('should warn if an invalid contextType is defined', async () => {
    const Context = React.createContext();
    /** 把 Context.Consumer 误填为 contextType，触发现代 Context 类型校验与去重。 */
    class ComponentA extends React.Component {
      /** 故意使用 Consumer 包装类型；renderer 应建议使用 createContext 返回的 Context 对象。 */
      static contextType = Context.Consumer;
      /** 返回 div，不额外读取错误 context，使断言只观察类型诊断。 */
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

    /** 把 Context.Provider 填为 contextType；在当前 Provider 与 Context 同一身份的形状下进行挂载。 */
    class ComponentB extends React.Component {
      /** 使用本例 Context.Provider；当前版本 Provider 即 Context 自身，因此此挂载没有对应无效类型告警断言。 */
      static contextType = Context.Provider;
      /** 返回 div，让 Provider 身份作为 contextType 的路径完成挂载。 */
      render() {
        return <div />;
      }
    }
    await act(() => {
      root.render(<ComponentB />);
    });
  });

  /** 类显式 contextType=null 后深读 hello.world，act 拒绝 world 访问错误而没有预期类型诊断；验证 null 可关闭订阅，render 错误仍向外传播。 */
  it('should not warn when class contextType is null', async () => {
    /** 显式 contextType=null 的类；故意深读空 context，以区分 render 失败和类型诊断。 */
    class Foo extends React.Component {
      /** null 表示关闭 Context 订阅；属于允许值，后续深读错误不应误归为静态类型告警。 */
      static contextType = null; // 便于应用按条件启用或禁用 contextType 声明。
      /** 故意读取 this.context.hello.world；空 context 的 hello 未定义，应在 world 访问处抛错。 */
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

  /** 类静态 contextType=undefined 且深读 hello.world；act 拒绝 world 访问错误，同时断言提示 typo/import/cycle 的诊断，区分配置错误和渲染异常。 */
  it('should warn when class contextType is undefined', async () => {
    /** 显式 contextType=undefined 的类；同时检查静态声明诊断和渲染中的深读失败。 */
    class Foo extends React.Component {
      /** 循环依赖常会让组件类型在初始化完成前保持为 `undefined`。 https://github.com/facebook/react/issues/13969 */
      static contextType = undefined;
      /** 故意深读 hello.world，在未提供有效订阅时触发 world 访问错误。 */
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

  /** 类静态 contextType={x:42,y:hello} 后深读；act 拒绝 hello 访问错误且 DEV 诊断列出 x/y，验证普通对象不能充当 Context。 */
  it('should warn when class contextType is an object', async () => {
    /** 把含 x/y 的普通对象误当 Context，检查诊断列出对象键与随后的 render 失败。 */
    class Foo extends React.Component {
      /** 普通对象没有 Context 品牌和值槽；DEV 报告其字段，随后 this.context 读取会失败。 */
      static contextType = {
        x: 42,
        y: 'hello',
      };
      /** 读取无效对象订阅产生的 undefined context，故意在 hello 访问处失败。 */
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

  /** 类静态 contextType=foo 字符串后深读；act 拒绝 world 访问错误，DEV 诊断报告 string，验证原始值静态声明失败路径。 */
  it('should warn when class contextType is a primitive', async () => {
    /** 把字符串 foo 误当 Context，检查原始类型诊断与空 context 深读失败。 */
    class Foo extends React.Component {
      /** 故意使用字符串 foo；应触发 contextType 为 string 的诊断，不构成有效 Context。 */
      static contextType = 'foo';
      /** 故意深读 hello.world，使字符串 contextType 场景同时覆盖 renderer 的异常出口。 */
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

  /** A/B 两函数组件挂同一个 Context 静态属性；重复挂 A 再挂 B，各类型只报一次函数不支持 contextType，验证支持范围和去重。 */
  it('should warn if you define contextType on a function component', async () => {
    const Context = React.createContext();

    /** 返回 div 的普通函数组件，随后挂静态 contextType；两个独立函数用于检查仅类支持该声明以及按类型去重。 */
    function ComponentA() {
      return <div />;
    }
    ComponentA.contextType = Context;

    /** 返回 div 的普通函数组件，随后挂静态 contextType；两个独立函数用于检查仅类支持该声明以及按类型去重。 */
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
