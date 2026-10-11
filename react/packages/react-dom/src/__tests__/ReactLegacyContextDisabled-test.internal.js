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

  /** 把null/undefined转独立文本、字符串透传、其余JSON化，让上下文空对象与缺值在DOM中可辨。 */
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

  /** disableLegacyContext=true时旧Provider/类与函数contextTypes各报移除诊断；首次文本为{}undefinedundefined、更新钩子日志空，再更新得到三个空对象日志；SSR同样诊断并输出带文本分隔标记的空旧上下文，验证禁用协议不供值而保留更新生命周期调用。 */
  it('warns for legacy context', async () => {
    /** 声明旧childContextTypes并提供foo=10；开关禁用旧协议，消费者应仅见空/缺失上下文。 */
    class LegacyProvider extends React.Component {
      /** 旧foo验证器映射，触发被移除协议的诊断。 */
      static childContextTypes = {
        /** 空验证器只声明旧foo键，不产生额外校验错误。 */
        foo() {},
      };
      /** 返回旧载荷foo=10；禁用配置不应把它传给消费者。 */
      getChildContext() {
        return {foo: 10};
      }
      /** 透传children，让旧消费者处在共同Provider范围。 */
      render() {
        return this.props.children;
      }
    }

    const lifecycleContextLog = [];
    /** 旧contextTypes类消费者，记录三个更新钩子的nextContext并格式化this.context。 */
    class LegacyClsConsumer extends React.Component {
      /** 声明旧foo消费协议，用于禁用诊断。 */
      static contextTypes = {
        /** 空foo验证器，不额外报错。 */
        foo() {},
      };
      /** 记录更新nextContext并返回true；禁用旧协议时预期空对象。 */
      shouldComponentUpdate(nextProps, nextState, nextContext) {
        lifecycleContextLog.push(nextContext);
        return true;
      }
      /** 接收新props时记录nextContext，验证禁用协议后的更新参数。 */
      UNSAFE_componentWillReceiveProps(nextProps, nextContext) {
        lifecycleContextLog.push(nextContext);
      }
      /** 更新前记录nextContext，和其它两个钩子组成三条有序日志。 */
      UNSAFE_componentWillUpdate(nextProps, nextState, nextContext) {
        lifecycleContextLog.push(nextContext);
      }
      /** 格式化this.context，旧协议禁用后输出空对象文本。 */
      render() {
        return formatValue(this.context);
      }
    }

    /** 格式化函数第二参数context，旧协议禁用后预期undefined。 */
    function LegacyFnConsumer(props, context) {
      return formatValue(context);
    }
    LegacyFnConsumer.contextTypes = {
      /** 模拟 legacy contextTypes 验证器。 */
      foo() {}
    };

    /** 未声明contextTypes但读取第二参数，验证普通函数同样收到undefined。 */
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

  /** 禁用legacy后以现代Context提供a并用Consumer/contextType/useContext读取；挂载文本aaa、无更新日志，同值重渲染记录三个a，再改为b输出bbb并记录三个b，验证现代传递及更新钩子的nextContext不受legacy开关影响。 */
  it('renders a tree with modern context', async () => {
    const Ctx = React.createContext();

    /** 使用现代Ctx.Provider传props.value，作为legacy禁用后仍有效的Provider。 */
    class Provider extends React.Component {
      /** 把value与children交给现代Provider，供相同/变化值更新对照。 */
      render() {
        return (
          <Ctx.Provider value={this.props.value}>
            {this.props.children}
          </Ctx.Provider>
        );
      }
    }

    /** 通过Ctx.Consumer的render prop读现代上下文。 */
    class RenderPropConsumer extends React.Component {
      /** 格式化Consumer回调value，输出当前a或b。 */
      render() {
        return <Ctx.Consumer>{value => formatValue(value)}</Ctx.Consumer>;
      }
    }

    const lifecycleContextLog = [];
    /** 用静态contextType读取现代值，并记录更新生命周期nextContext。 */
    class ContextTypeConsumer extends React.Component {
      /** 把this.context绑定现代Ctx，避免旧contextTypes路径。 */
      static contextType = Ctx;
      /** 记录nextContext并允许更新，匹配当前a/b值。 */
      shouldComponentUpdate(nextProps, nextState, nextContext) {
        lifecycleContextLog.push(nextContext);
        return true;
      }
      /** 新props到来时记录nextContext，验证同值重渲染也进入钩子。 */
      UNSAFE_componentWillReceiveProps(nextProps, nextContext) {
        lifecycleContextLog.push(nextContext);
      }
      /** 更新前记录nextContext，形成此轮第三条上下文日志。 */
      UNSAFE_componentWillUpdate(nextProps, nextState, nextContext) {
        lifecycleContextLog.push(nextContext);
      }
      /** 输出格式化this.context，与其它消费方式同为a或b。 */
      render() {
        return formatValue(this.context);
      }
    }

    /** 以useContext读取现代Ctx，验证hook路径跟随Provider更新。 */
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
