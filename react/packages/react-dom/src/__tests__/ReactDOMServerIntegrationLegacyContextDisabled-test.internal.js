/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment ./scripts/jest/ReactDOMServerIntegrationEnvironment
 */

'use strict';

/** 提供跨 SSR、客户端渲染与 hydration 的统一场景展开器；每个 render 入口返回可断言的 DOM 节点。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

let React;
let ReactDOMClient;
let ReactFeatureFlags;
let ReactDOMServer;

/** 重置并加载 React/client/server 后把 disableLegacyContext 设 true；工具每次切换入口均重复该设置，使旧上下文协议保持禁用。 */
function initModules() {
  // 重置警告缓存。
  jest.resetModules();
  React = require('react');
  ReactDOMClient = require('react-dom/client');
  ReactDOMServer = require('react-dom/server');

  ReactFeatureFlags = require('shared/ReactFeatureFlags');
  ReactFeatureFlags.disableLegacyContext = true;

  // 让他们可以帮助.
  return {
    ReactDOMClient,
    ReactDOMServer,
  };
}

/** 从集成工具取模式重置器和五模式测试展开器；itRenders 的每个定义复用同一场景回调。 */
const {resetModules, itRenders} = ReactDOMServerIntegrationUtils(initModules);

/** 把 null/undefined 单独格式化为可断言文本，字符串原样输出，其余用 JSON 表示，便于区分空上下文对象与缺失值。 */
function formatValue(val) {
  if (val === null) {
    return 'null';
  }
  if (val === undefined) {
    return 'undefined';
  }
  if (typeof val === 'string') {
    return val;
  }
  return JSON.stringify(val);
}

describe('ReactDOMServerIntegrationLegacyContextDisabled', () => {
  beforeEach(() => {
    resetModules();
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given legacy context 已禁用且 `itRenders` 覆盖服务端/客户端组合；
   * When 组件读取未定义的旧上下文；
   * Then 断言输出值与兼容性警告在各模式下符合约定。
   *
   * 验证机制：集成工具通过 react-dom server/client 适配边界比较 DOM 与诊断。
   */
  /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；禁用 legacy context，旧 Provider 提供 foo=10，类/旧函数/普通函数消费；预期三个诊断、文本 {}undefinedundefined 且更新生命周期日志空，验证旧协议失效及初次挂载不调用更新钩子。 */
  itRenders('undefined legacy context with warning', async render => {

    /** 声明旧 childContextTypes并提供 foo=10；禁用旧协议时仍渲染 children，但不应向消费者传值。 */
    class LegacyProvider extends React.Component {

      /** 旧上下文的 foo 验证器映射，用来触发移除旧协议的诊断。 */
      static childContextTypes = {

        /** 空旧类型验证器，只声明 foo 键，不额外返回校验错误。 */
        foo() {},
      };

      /** 返回旧协议载荷 foo=10；此配置应被禁用逻辑忽略。 */
      getChildContext() {
        return {foo: 10};
      }

      /** 透传 children，使各消费者处于相同旧 Provider 范围。 */
      render() {
        return this.props.children;
      }
    }

    const lifecycleContextLog = [];

    /** 声明旧 contextTypes的类消费者，格式化 this.context，并收集只应在更新时触发的上下文钩子。 */
    class LegacyClsConsumer extends React.Component {

      /** 声明消费旧 foo 的验证器映射；禁用协议后仍触发诊断但不提供值。 */
      static contextTypes = {

        /** 声明消费 foo 的空验证器，不产生额外诊断。 */
        foo() {},
      };

      /** 若发生更新则记录 nextContext并允许继续；初次渲染预期不进入。 */
      shouldComponentUpdate(nextProps, nextState, nextContext) {
        lifecycleContextLog.push(nextContext);
        return true;
      }

      /** 若接收新 props 则记录 nextContext；用空日志验证此场景仅发生初次挂载。 */
      UNSAFE_componentWillReceiveProps(nextProps, nextContext) {
        lifecycleContextLog.push(nextContext);
      }

      /** 在更新前记录 nextContext；首次挂载不应调用。 */
      UNSAFE_componentWillUpdate(nextProps, nextState, nextContext) {
        lifecycleContextLog.push(nextContext);
      }

      /** 格式化禁用协议下的 this.context，预期输出空对象文本。 */
      render() {
        return formatValue(this.context);
      }
    }

    /** 格式化旧函数组件第二参数 context，禁用 legacy 后预期 undefined。 */
    function LegacyFnConsumer(props, context) {
      return formatValue(context);
    }
    LegacyFnConsumer.contextTypes = {
      /** 模拟 legacy contextTypes 验证器。 */
      foo() {}
    };

    /** 不声明上下文类型但读取第二参数，验证普通函数该参数同样为 undefined。 */
    function RegularFn(props, context) {
      return formatValue(context);
    }

    const e = await render(
      <LegacyProvider>
        <span>
          <LegacyClsConsumer />
          <LegacyFnConsumer />
          <RegularFn />
        </span>
      </LegacyProvider>,
      3,
    );
    expect(e.textContent).toBe('{}undefinedundefined');
    expect(lifecycleContextLog).toEqual([]);
  });

  /** 通过 itRenders 展开到字符串 SSR、Node 流 SSR、新客户端、正确标记 hydration 和错误标记恢复；禁用 legacy 后用新 Context value=a，render-prop/contextType/useContext 三种消费者；文本应为 aaa且更新生命周期日志空，验证现代上下文仍在所有入口生效。 */
  itRenders('modern context', async render => {
    const Ctx = React.createContext();

    /** 使用现代 Ctx.Provider传 value并透传 children，作为禁用 legacy 后仍有效的提供者。 */
    class Provider extends React.Component {

      /** 输出 value来自props的现代上下文 Provider，不建立宿主包装。 */
      render() {
        return (
          <Ctx.Provider value={this.props.value}>
            {this.props.children}
          </Ctx.Provider>
        );
      }
    }

    /** 通过现代 Consumer 的 render prop 读取上下文并输出格式化文本。 */
    class RenderPropConsumer extends React.Component {

      /** 把 Consumer 接收的 value 转可比较文本，预期为 a。 */
      render() {
        return <Ctx.Consumer>{value => formatValue(value)}</Ctx.Consumer>;
      }
    }

    const lifecycleContextLog = [];

    /** 通过静态 contextType 读取现代上下文，另记录更新钩子是否被调用。 */
    class ContextTypeConsumer extends React.Component {

      /** 将类的 this.context 绑定到现代 Ctx，独立于旧 contextTypes。 */
      static contextType = Ctx;

      /** 更新时记录 nextContext并允许继续，初次构建日志应保持空。 */
      shouldComponentUpdate(nextProps, nextState, nextContext) {
        lifecycleContextLog.push(nextContext);
        return true;
      }

      /** 仅接收更新 props 时记录 nextContext，不参与本次初始值输出。 */
      UNSAFE_componentWillReceiveProps(nextProps, nextContext) {
        lifecycleContextLog.push(nextContext);
      }

      /** 记录更新前 nextContext，初次挂载不执行。 */
      UNSAFE_componentWillUpdate(nextProps, nextState, nextContext) {
        lifecycleContextLog.push(nextContext);
      }

      /** 格式化现代 this.context，验证 contextType 已读取 a。 */
      render() {
        return formatValue(this.context);
      }
    }

    /** 通过 useContext读取同一现代 Ctx并输出 a，与 render prop和类消费者结果对照。 */
    function FnConsumer() {
      return formatValue(React.useContext(Ctx));
    }

    const e = await render(
      <Provider value="a">
        <span>
          <RenderPropConsumer />
          <ContextTypeConsumer />
          <FnConsumer />
        </span>
      </Provider>,
    );
    expect(e.textContent).toBe('aaa');
    expect(lifecycleContextLog).toEqual([]);
  });
});
