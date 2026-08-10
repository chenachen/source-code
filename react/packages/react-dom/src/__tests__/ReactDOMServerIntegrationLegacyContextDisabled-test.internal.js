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

/** `ReactDOMServerIntegrationUtils`：保存当前测试场景复用的夹具、状态或回调。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

let React;
let ReactDOMClient;
let ReactFeatureFlags;
let ReactDOMServer;

/** `initModules`：封装当前用例复用的操作、回调或断言步骤。 */
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

/** `{resetModules, itRenders}`：保存当前测试场景复用的夹具、状态或回调。 */
const {resetModules, itRenders} = ReactDOMServerIntegrationUtils(initModules);

/** `formatValue`：封装当前用例复用的操作、回调或断言步骤。 */
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
   * 验证机制：集成工具通过 react-dom server/client 适配边界比较 DOM 与诊断；完整 Fizz 状态机位于
   * 范围外的 `packages/react-server`。
   */
  itRenders('undefined legacy context with warning', async render => {
    /** `LegacyProvider`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class LegacyProvider extends React.Component {
      /** `LegacyProvider.childContextTypes`：记录测试夹具在当前场景中的状态。 */
      static childContextTypes = {
        /** `LegacyProvider.foo`：实现测试夹具的生命周期、渲染或交互步骤。 */
        foo() {},
      };
      /** `LegacyProvider.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getChildContext() {
        return {foo: 10};
      }
      /** `LegacyProvider.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return this.props.children;
      }
    }

    const lifecycleContextLog = [];
    /** `LegacyClsConsumer`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class LegacyClsConsumer extends React.Component {
      /** `LegacyClsConsumer.contextTypes`：记录测试夹具在当前场景中的状态。 */
      static contextTypes = {
        /** `LegacyClsConsumer.foo`：实现测试夹具的生命周期、渲染或交互步骤。 */
        foo() {},
      };
      /** `LegacyClsConsumer.shouldComponentUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      shouldComponentUpdate(nextProps, nextState, nextContext) {
        lifecycleContextLog.push(nextContext);
        return true;
      }
      /** `LegacyClsConsumer.UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps(nextProps, nextContext) {
        lifecycleContextLog.push(nextContext);
      }
      /** `LegacyClsConsumer.UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate(nextProps, nextState, nextContext) {
        lifecycleContextLog.push(nextContext);
      }
      /** `LegacyClsConsumer.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return formatValue(this.context);
      }
    }

    /** `LegacyFnConsumer`：封装当前用例复用的操作、回调或断言步骤。 */
    function LegacyFnConsumer(props, context) {
      return formatValue(context);
    }
    LegacyFnConsumer.contextTypes = {
      /** 模拟 legacy contextTypes 验证器。 */
      foo() {}
    };

    /** `RegularFn`：封装当前用例复用的操作、回调或断言步骤。 */
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

  itRenders('modern context', async render => {
    const Ctx = React.createContext();

    /** `Provider`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Provider extends React.Component {
      /** `Provider.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <Ctx.Provider value={this.props.value}>
            {this.props.children}
          </Ctx.Provider>
        );
      }
    }

    /** `RenderPropConsumer`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class RenderPropConsumer extends React.Component {
      /** `RenderPropConsumer.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <Ctx.Consumer>{value => formatValue(value)}</Ctx.Consumer>;
      }
    }

    const lifecycleContextLog = [];
    /** `ContextTypeConsumer`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ContextTypeConsumer extends React.Component {
      /** `ContextTypeConsumer.contextType`：记录测试夹具在当前场景中的状态。 */
      static contextType = Ctx;
      /** `ContextTypeConsumer.shouldComponentUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      shouldComponentUpdate(nextProps, nextState, nextContext) {
        lifecycleContextLog.push(nextContext);
        return true;
      }
      /** `ContextTypeConsumer.UNSAFE_componentWillReceiveProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillReceiveProps(nextProps, nextContext) {
        lifecycleContextLog.push(nextContext);
      }
      /** `ContextTypeConsumer.UNSAFE_componentWillUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      UNSAFE_componentWillUpdate(nextProps, nextState, nextContext) {
        lifecycleContextLog.push(nextContext);
      }
      /** `ContextTypeConsumer.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return formatValue(this.context);
      }
    }

    /** `FnConsumer`：封装当前用例复用的操作、回调或断言步骤。 */
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
