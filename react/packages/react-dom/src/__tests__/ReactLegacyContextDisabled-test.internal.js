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
let ReactDOMClient;
let ReactDOMServer;
let ReactFeatureFlags;
let act;
let assertConsoleErrorDev;

describe('ReactLegacyContextDisabled', () => {
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    ReactFeatureFlags = require('shared/ReactFeatureFlags');
    ReactFeatureFlags.disableLegacyContext = true;
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
  });

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

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「warns for legacy context」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('warns for legacy context', async () => {
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

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <LegacyProvider>
          <span>
            <LegacyClsConsumer />
            <LegacyFnConsumer />
            <RegularFn />
          </span>
        </LegacyProvider>,
      );
    });
    assertConsoleErrorDev([
      'LegacyProvider uses the legacy childContextTypes API which was removed in React 19. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in LegacyProvider (at **)',
      'LegacyClsConsumer uses the legacy contextTypes API which was removed in React 19. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in LegacyClsConsumer (at **)',
      'LegacyFnConsumer uses the legacy contextTypes API which was removed in React 19. ' +
        'Use React.createContext() with React.useContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in LegacyFnConsumer (at **)',
    ]);
    expect(container.textContent).toBe('{}undefinedundefined');
    expect(lifecycleContextLog).toEqual([]);

    // 测试更新路径。
    await act(() => {
      root.render(
        <LegacyProvider>
          <span>
            <LegacyClsConsumer />
            <LegacyFnConsumer />
            <RegularFn />
          </span>
        </LegacyProvider>,
      );
    });
    expect(container.textContent).toBe('{}undefinedundefined');
    expect(lifecycleContextLog).toEqual([{}, {}, {}]);
    root.unmount();

    // 测试服务器路径。
    const text = ReactDOMServer.renderToString(
      <LegacyProvider>
        <span>
          <LegacyClsConsumer />
          <LegacyFnConsumer />
          <RegularFn />
        </span>
      </LegacyProvider>,
      container,
    );
    assertConsoleErrorDev([
      'LegacyProvider uses the legacy childContextTypes API which was removed in React 19. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in LegacyProvider (at **)',
      'LegacyClsConsumer uses the legacy contextTypes API which was removed in React 19. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in LegacyClsConsumer (at **)',
      'LegacyFnConsumer uses the legacy contextTypes API which was removed in React 19. ' +
        'Use React.createContext() with React.useContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in LegacyFnConsumer (at **)',
    ]);
    expect(text).toBe('<span>{}<!-- -->undefined<!-- -->undefined</span>');
    expect(lifecycleContextLog).toEqual([{}, {}, {}]);
  });

  /** 测试场景：验证「renders a tree with modern context」描述的渲染、交互或错误处理结果。 */
  it('renders a tree with modern context', async () => {
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

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <Provider value="a">
          <span>
            <RenderPropConsumer />
            <ContextTypeConsumer />
            <FnConsumer />
          </span>
        </Provider>,
      );
    });
    expect(container.textContent).toBe('aaa');
    expect(lifecycleContextLog).toEqual([]);

    // 测试更新路径
    await act(() => {
      root.render(
        <Provider value="a">
          <span>
            <RenderPropConsumer />
            <ContextTypeConsumer />
            <FnConsumer />
          </span>
        </Provider>,
      );
    });
    expect(container.textContent).toBe('aaa');
    expect(lifecycleContextLog).toEqual(['a', 'a', 'a']);
    lifecycleContextLog.length = 0;

    await act(() => {
      root.render(
        <Provider value="b">
          <span>
            <RenderPropConsumer />
            <ContextTypeConsumer />
            <FnConsumer />
          </span>
        </Provider>,
      );
    });
    expect(container.textContent).toBe('bbb');
    expect(lifecycleContextLog).toEqual(['b', 'b', 'b']);
    root.unmount();
  });
});
