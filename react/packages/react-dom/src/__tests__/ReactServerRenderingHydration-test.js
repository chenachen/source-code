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

let React;
let ReactDOM;
let ReactDOMClient;
let ReactDOMServer;
let ReactDOMServerBrowser;
let waitForAll;
let act;
let assertConsoleErrorDev;
let assertConsoleWarnDev;

// 这些测试依赖于ReactDOMServer和ReactDOM. 如果测试只需要ReactDOMServer， 将它移到
// ReactServerRendering-test 中。
describe('ReactDOMServerHydration', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    ReactDOMServerBrowser = require('react-dom/server.browser');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    act = InternalTestUtils.act;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;
    assertConsoleWarnDev = InternalTestUtils.assertConsoleWarnDev;
  });

  /** Given：记录mountCount与click数的类；When：首次创建根、更新name、卸载重建、匹配SSR hydration，再以name=y制造文本不匹配；Then：mountCount依次1/2/3/4，更新不重挂；匹配标记保持原HTML且事件可点击，不匹配有非空新HTML且事件仍可点击。目的：更新复用实例、hydration建立客户端生命周期与事件，恢复后也可交互；finally只移除容器。 */
  it('should have the correct mounting behavior', async () => {
    let mountCount = 0;
    let numClicks = 0;

    /** 记录真实客户端mount及点击的类fixture；SSR只产生文字，不执行componentDidMount。 */
    class TestComponent extends React.Component {

      /** 实例持有的宿主span引用，用于hydration提交后直接click；由ref协议在挂载/卸载时写入/清空。 */
      spanRef = React.createRef();

      /**
       * 每次真正客户端挂载把mountCount加1，更新复用实例时不调用。
       * @returns 无返回值。
       */
      componentDidMount() {
        mountCount++;
      }

      /**
       * 记录span原生click经过React onClick后的调用次数。
       * @returns 无返回值。
       */
      click = () => {
        numClicks++;
      };

      /**
       * 按props.name输出两段文本，并把spanRef及click处理器传给宿主。
       * @returns Name前缀的span。
       */
      render() {
        return (
          <span ref={this.spanRef} onClick={this.click}>
            Name: {this.props.name}
          </span>
        );
      }
    }

    const element = document.createElement('div');
    document.body.appendChild(element);
    try {
      let root = ReactDOMClient.createRoot(element);
      await act(() => {
        root.render(<TestComponent />);
      });

      let lastMarkup = element.innerHTML;

      // 更新 name 改变文本，但复用实例，不再次调用 componentDidMount。
      await act(() => {
        root.render(<TestComponent name="x" />);
      });
      expect(mountCount).toEqual(1);

      // 卸载后创建新 root，componentDidMount 再运行一次。与上次记录的初始 HTML 相比，
      // 这里包含 name="x" 对应的文本，因此标记不同；fixture 没有生成 ID。
      root.unmount();
      expect(element.innerHTML).toEqual('');
      root = ReactDOMClient.createRoot(element);
      await act(() => {
        root.render(<TestComponent name="x" />);
      });

      expect(mountCount).toEqual(2);
      expect(element.innerHTML).not.toEqual(lastMarkup);

      // 现在卸载节点，再像使用服务端渲染一样，在服务端生成的标记上重新渲染。组件应再次挂载，
      // 但标记必须保持不变；在 innerHTML 末尾追加 sentinel，以确认 innerHTML 未被改写。
      await act(() => {
        root.unmount();
      });
      expect(element.innerHTML).toEqual('');

      lastMarkup = ReactDOMServer.renderToString(<TestComponent name="x" />);
      element.innerHTML = lastMarkup;

      let instance;

      root = await act(() => {
        return ReactDOMClient.hydrateRoot(
          element,
          <TestComponent name="x" ref={current => (instance = current)} />,
        );
      });
      expect(mountCount).toEqual(3);
      expect(element.innerHTML).toBe(lastMarkup);

      // 确保在服务器标记上挂载后事件系统正常工作
      expect(numClicks).toEqual(0);
      instance.spanRef.current.click();
      expect(numClicks).toEqual(1);

      await act(() => {
        root.unmount();
      });
      expect(element.innerHTML).toEqual('');

      // 现在模拟一个应用程序不是幂等的情况。 应该警告,但做正确的事情.
      element.innerHTML = lastMarkup;
      root = await act(() => {
        return ReactDOMClient.hydrateRoot(
          element,
          <TestComponent
            name="y"
            ref={current => {
              instance = current;
            }}
          />,
          {

            /**
             * 忽略本例name不匹配的预期可恢复错误；主断言检查新HTML、mount次数与可点击性，不收集错误数组。
             * @param error - hydration恢复报告的Error。
             * @returns undefined。
             */
            onRecoverableError: error => {},
          },
        );
      });

      expect(mountCount).toEqual(4);
      expect(element.innerHTML.length > 0).toBe(true);
      expect(element.innerHTML).not.toEqual(lastMarkup);

      // 确保事件系统在标记不匹配后正常工作。
      expect(numClicks).toEqual(1);
      instance.spanRef.current.click();
      expect(numClicks).toEqual(2);
    } finally {
      document.body.removeChild(element);
    }
  });

  // 我们有一个客户端的自动聚焦 polyfill。 但我们故意不希望在hydrate时调用focus()，因为这可能会在
  // JS加载之前影响现有的聚焦。

  /** Given：SSR input autoFocus=true且其focus替换成mock；When：hydrate后再root.render同配置；Then：autofocus属性为真，focus两次均未调用。目的：hydration不打断JS加载前已有焦点，普通更新也不重复聚焦。 */
  it('should emit autofocus on the server but not focus() when hydrating', async () => {
    const element = document.createElement('div');
    element.innerHTML = ReactDOMServer.renderToString(
      <input autoFocus={true} />,
    );
    expect(element.firstChild.autofocus).toBe(true);

    // 挂载时不应调用 focus()。
    element.firstChild.focus = jest.fn();
    const root = await act(() =>
      ReactDOMClient.hydrateRoot(element, <input autoFocus={true} />),
    );
    expect(element.firstChild.focus).not.toHaveBeenCalled();

    // 或是在更新期间.
    await act(() => {
      root.render(<input autoFocus={true} />);
    });
    expect(element.firstChild.focus).not.toHaveBeenCalled();
  });

  /** Given：SSR input autoFocus=false且focus为mock；When：hydrate再更新；Then：autofocus为假、focus始终不调用。目的：禁用autoFocus不会触发客户端焦点副作用。 */
  it('should not focus on either server or client with autofocus={false}', async () => {
    const element = document.createElement('div');
    element.innerHTML = ReactDOMServer.renderToString(
      <input autoFocus={false} />,
    );
    expect(element.firstChild.autofocus).toBe(false);

    element.firstChild.focus = jest.fn();
    const root = await act(() =>
      ReactDOMClient.hydrateRoot(element, <input autoFocus={false} />),
    );

    expect(element.firstChild.focus).not.toHaveBeenCalled();

    await act(() => {
      root.render(<input autoFocus={false} />);
    });
    expect(element.firstChild.focus).not.toHaveBeenCalled();
  });

  // 针对 https://github.com/facebook/react/issues/11726 的回归测试。

  /** Given：SSR button文本server、autoFocus=false，旧focus和客户端onFocus各为mock；When：hydrate文本client并消费预期恢复错误；Then：两mock均未调用。目的：文本恢复不绕过autoFocus=false；不是DOM复用或错误数量断言。 */
  it('should not focus on either server or client with autofocus={false} even if there is a markup mismatch', async () => {
    const element = document.createElement('div');
    element.innerHTML = ReactDOMServer.renderToString(
      <button autoFocus={false}>server</button>,
    );
    expect(element.firstChild.autofocus).toBe(false);
    const onFocusBeforeHydration = jest.fn();
    const onFocusAfterHydration = jest.fn();
    element.firstChild.focus = onFocusBeforeHydration;

    await act(() => {
      ReactDOMClient.hydrateRoot(
        element,
        <button autoFocus={false} onFocus={onFocusAfterHydration}>
          client
        </button>,
        {
          /**
           * 消费autoFocus=false文本不匹配场景的恢复报告，避免预期错误污染控制台；本例只比较两种focus回调是否调用。
           * @param error - 预期hydration恢复错误。
           * @returns undefined。
           */
          onRecoverableError: error => {}
        },
      );
    });

    expect(onFocusBeforeHydration).not.toHaveBeenCalled();
    expect(onFocusAfterHydration).not.toHaveBeenCalled();
  });

  /** Given：SSR style为none/black/10px，初始color断言black；When：hydrate时color改white；Then：消费属性差异警告，diff列出black→white及CSS名称差异。目的：核对诊断文本；没有额外断言hydration后的style值。 */
  it('should warn when the style property differs', async () => {
    const element = document.createElement('div');
    element.innerHTML = ReactDOMServer.renderToString(
      <div style={{textDecoration: 'none', color: 'black', height: '10px'}} />,
    );
    expect(element.firstChild.style.textDecoration).toBe('none');
    expect(element.firstChild.style.color).toBe('black');

    await act(() => {
      ReactDOMClient.hydrateRoot(
        element,
        <div
          style={{textDecoration: 'none', color: 'white', height: '10px'}}
        />,
      );
    });
    assertConsoleErrorDev([
      "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. " +
        "This won't be patched up. This can happen if a SSR-ed Client Component used:\n" +
        '\n' +
        "- A server/client branch `if (typeof window !== 'undefined')`.\n" +
        "- Variable input such as `Date.now()` or `Math.random()` which changes each time it's called.\n" +
        "- Date formatting in a user's locale which doesn't match the server.\n" +
        '- External changing data without sending a snapshot of it along with the HTML.\n' +
        '- Invalid HTML tag nesting.\n\nIt can also happen if the client has a browser extension ' +
        'installed which messes with the HTML before React loaded.\n' +
        '\n' +
        'https://react.dev/link/hydration-mismatch\n' +
        '\n' +
        '  <div\n    style={{\n+     textDecoration: "none"\n' +
        '+     color: "white"\n' +
        '-     color: "black"\n' +
        '+     height: "10px"\n' +
        '-     height: "10px"\n' +
        '-     text-decoration: "none"\n' +
        '    }}\n' +
        '  >\n' +
        '\n    in div (at **)',
    ]);
  });

  /** Given：documentMode=11并重装模块，手写style与客户端等价但顺序/空白不同；When：hydrate；Then：完成且不登记预期style警告，finally删除documentMode。目的：IE样式规范化分支避免格式误报。 */
  it('should not warn when the style property differs on whitespace or order in IE', async () => {
    document.documentMode = 11;
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    try {
      const element = document.createElement('div');

      // 模拟IE正常化style属性。 IE 等同于 `node.style.cssText` 下提供的功能。
      element.innerHTML =
        '<div style="height: 10px; color: black; text-decoration: none;"></div>';

      await act(() => {
        ReactDOMClient.hydrateRoot(
          element,
          <div
            style={{textDecoration: 'none', color: 'black', height: '10px'}}
          />,
        );
      });
    } finally {
      delete document.documentMode;
    }
  });

  /** Given：非IE的手写style含多余空白，客户端对象值相同；When：hydrate；Then：消费属性差异警告并核对style diff。目的：字符串样式格式差异在非IE分支被报告。 */
  it('should warn when the style property differs on whitespace in non-IE browsers', async () => {
    const element = document.createElement('div');

    element.innerHTML =
      '<div style="text-decoration: none; color: black; height: 10px;"></div>';

    await act(() => {
      ReactDOMClient.hydrateRoot(
        element,
        <div
          style={{textDecoration: 'none', color: 'black', height: '10px'}}
        />,
      );
    });
    assertConsoleErrorDev([
      "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. " +
        "This won't be patched up. This can happen if a SSR-ed Client Component used:\n" +
        '\n' +
        "- A server/client branch `if (typeof window !== 'undefined')`.\n" +
        "- Variable input such as `Date.now()` or `Math.random()` which changes each time it's called.\n" +
        "- Date formatting in a user's locale which doesn't match the server.\n" +
        '- External changing data without sending a snapshot of it along with the HTML.\n' +
        '- Invalid HTML tag nesting.\n\nIt can also happen if the client has a browser extension ' +
        'installed which messes with the HTML before React loaded.\n' +
        '\n' +
        'https://react.dev/link/hydration-mismatch\n' +
        '\n' +
        '  <div\n' +
        '    style={{\n' +
        '+     textDecoration: "none"\n' +
        '+     color: "black"\n' +
        '-     color: "black"\n' +
        '+     height: "10px"\n' +
        '-     height: "10px"\n' +
        '-     text-decoration: "none"\n' +
        '    }}\n' +
        '  >\n' +
        '\n    in div (at **)',
    ]);
  });

  /** Given：DOM portal的目标为独立div；When：把portal嵌入服务器树并renderToString；Then：抛服务器不支持Portal、应条件地只在客户端渲染的错误。目的：禁止把外部DOM挂载点当SSR child。 */
  it('should throw rendering portals on the server', () => {
    const div = document.createElement('div');
    expect(() => {
      ReactDOMServer.renderToString(
        <div>{ReactDOM.createPortal(<div />, div)}</div>,
      );
    }).toThrow(
      'Portals are not currently supported by the server renderer. ' +
        'Render them conditionally so that they only appear on the client render.',
    );
  });

  /** Given：StrictMode包裹含旧componentWillMount的类，返回Hi；When：字符串SSR后hydrate；Then：两端都显示Hi，分别消费服务器与Strict客户端的生命周期重命名警告。目的：Mode不改变输出，但两端诊断适用说明不同。 */
  it('should be able to render and hydrate Mode components', async () => {

    /** 保留旧componentWillMount名称以触发SSR与StrictMode客户端各自诊断的类fixture。 */
    class ComponentWithWarning extends React.Component {

      /**
       * 空旧生命周期方法；仅其定义就使相关阶段输出迁移警告。
       * @returns 无返回值。
       */
      componentWillMount() {
        // 预期的警告
      }

      /**
       * 保持Mode两端稳定的输出。
       * @returns Hi字符串。
       */
      render() {
        return 'Hi';
      }
    }

    const markup = (
      <React.StrictMode>
        <ComponentWithWarning />
      </React.StrictMode>
    );

    const element = document.createElement('div');
    element.innerHTML = ReactDOMServer.renderToString(markup);
    assertConsoleWarnDev([
      'componentWillMount has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n' +
        '\n' +
        '* Move code from componentWillMount to componentDidMount (preferred in most cases) or the constructor.\n' +
        '\n' +
        'Please update the following components: ComponentWithWarning\n' +
        '    in ComponentWithWarning (at **)',
    ]);
    expect(element.textContent).toBe('Hi');

    await act(() => {
      ReactDOMClient.hydrateRoot(element, markup);
    });
    assertConsoleWarnDev([
      'componentWillMount has been renamed, and is not recommended for use. ' +
        'See https://react.dev/link/unsafe-component-lifecycles for details.\n' +
        '\n' +
        '* Move code with side effects to componentDidMount, and set initial state in the constructor.\n' +
        '* Rename componentWillMount to UNSAFE_componentWillMount to suppress this warning in non-strict mode. ' +
        'In React 18.x, only the UNSAFE_ name will work. ' +
        'To rename all deprecated lifecycles to their new names, ' +
        'you can run `npx react-codemod rename-unsafe-lifecycles` in your project source folder.\n' +
        '\n' +
        'Please update the following components: ComponentWithWarning',
    ]);
    expect(element.textContent).toBe('Hi');
  });

  /** Given：StrictMode内Child分别注册layout/passive mount及cleanup日志；When：SSR后hydrate；Then：DEV日志为两mount、两cleanup、再两mount；production只有两mount。目的：hydration提交后的DEV effect重放顺序，SSR阶段不执行这些create。 */
  it('replays effects when hydrating a StrictMode subtree', async () => {
    const log = [];

    /**
     * 注册layout/passive create和各自cleanup，记录hydration后StrictMode重放顺序。
     * @returns Hello span。
     */
    function Child() {
      React.useLayoutEffect(() => {
        log.push('layout mount');
        return () => log.push('layout unmount');
      }, []);
      React.useEffect(() => {
        log.push('effect mount');
        return () => log.push('effect unmount');
      }, []);
      return <span>Hello</span>;
    }

    /**
     * 用div包住effect Child，作为StrictMode子树入口。
     * @returns 含Child的div。
     */
    function App() {
      return (
        <div>
          <Child />
        </div>
      );
    }

    const markup = (
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );

    const element = document.createElement('div');
    element.innerHTML = ReactDOMServer.renderToString(markup);
    expect(element.textContent).toBe('Hello');

    await act(() => {
      ReactDOMClient.hydrateRoot(element, markup);
    });

    if (__DEV__) {
      expect(log).toEqual([
        'layout mount',
        'effect mount',
        'layout unmount',
        'effect unmount',
        'layout mount',
        'effect mount',
      ]);
    } else {
      expect(log).toEqual(['layout mount', 'effect mount']);
    }
  });

  /** Given：forwardRef组件接label=Hi及空createRef；When：SSR后hydrate；Then：两端文字Hi，SSR ref.current=null，客户端绑定到DIV。目的：服务器不挂载宿主ref，hydration commit会转发并安装引用。 */
  it('should be able to render and hydrate forwardRef components', async () => {

    /**
     * 把外部转发引用安装到DIV而不把ref作为普通字符串属性。
     * @param label - 展示文本Hi。
     * @param forwardedRef - WrappedFunctionComponent传入的createRef。
     * @returns 带引用与label的div。
     */
    const FunctionComponent = ({label, forwardedRef}) => (
      <div ref={forwardedRef}>{label}</div>
    );
    /** forwardRef把外部ref作为第二参数接收，再以forwardedRef传给宿主fixture；返回FunctionComponent元素。 */
    const WrappedFunctionComponent = React.forwardRef((props, ref) => (
      <FunctionComponent {...props} forwardedRef={ref} />
    ));

    const ref = React.createRef();
    const markup = <WrappedFunctionComponent ref={ref} label="Hi" />;

    const element = document.createElement('div');
    element.innerHTML = ReactDOMServer.renderToString(markup);
    expect(element.textContent).toBe('Hi');
    expect(ref.current).toBe(null);

    await act(() => {
      ReactDOMClient.hydrateRoot(element, markup);
    });
    expect(element.textContent).toBe('Hi');
    expect(ref.current.tagName).toBe('DIV');
  });

  /** Given：Profiler id=profiler，onRender为mock且children是Hi div；When：SSR后hydrate；Then：SSR未调用；DEV客户端恰一次参数id=profiler/phase=mount，production零次，文本Hi。目的：Profiler回调属于客户端提交且受构建条件限制。 */
  it('should be able to render and hydrate Profiler components', async () => {
    const callback = jest.fn();
    const markup = (
      <React.Profiler id="profiler" onRender={callback}>
        <div>Hi</div>
      </React.Profiler>
    );

    const element = document.createElement('div');
    element.innerHTML = ReactDOMServer.renderToString(markup);
    expect(element.textContent).toBe('Hi');
    expect(callback).not.toHaveBeenCalled();

    await act(() => {
      ReactDOMClient.hydrateRoot(element, markup);
    });
    expect(element.textContent).toBe('Hi');
    if (__DEV__) {
      expect(callback).toHaveBeenCalledTimes(1);
      const [id, phase] = callback.mock.calls[0];
      expect(id).toBe('profiler');
      expect(phase).toBe('mount');
    } else {
      expect(callback).toHaveBeenCalledTimes(0);
    }
  });

  // 针对 https://github.com/facebook/react/issues/11423 的回归测试。

  /** Given：noscript内TestComponent渲染时调用mock；When：SSR后hydrate同树；Then：调用次数仍为1，textContent始终是原始div标记字串。目的：启用脚本的客户端忽略noscript children，不重新执行内部组件。 */
  it('should ignore noscript content on the client and not warn about mismatches', async () => {
    const callback = jest.fn();

    /**
     * 在render时调用onRender，用计数区分SSR运行与客户端noscript忽略。
     * @param onRender - 用例的jest.fn计数器。
     * @returns 启用JavaScript说明div。
     */
    const TestComponent = ({onRender}) => {
      onRender();
      return <div>Enable JavaScript to run this app.</div>;
    };
    const markup = (
      <noscript>
        <TestComponent onRender={callback} />
      </noscript>
    );

    const element = document.createElement('div');
    element.innerHTML = ReactDOMServer.renderToString(markup);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(element.textContent).toBe(
      '<div>Enable JavaScript to run this app.</div>',
    );

    await act(() => {
      ReactDOMClient.hydrateRoot(element, markup);
    });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(element.textContent).toBe(
      '<div>Enable JavaScript to run this app.</div>',
    );
  });

  /** Given：HelloWorld初始isClient=false，lazy Promise由resolveLazy手动兑现；When：SSR、hydrate后的componentDidMount置true、再act兑现；Then：文本Hello空格→Hello loading→Hello world。目的：首次认领后普通更新可挂起并恢复lazy组件。 */
  it('should be able to use lazy components after hydrating', async () => {
    let resolveLazy;
    const Lazy = React.lazy(
      () =>
        new Promise(resolve => {
          /**
           * 手动兑现lazy加载器创建的Promise，交付默认World；由act调用以冲刷边界恢复。
           * @returns 无返回值，resolve使Promise进入兑现状态。
           */
          resolveLazy = () => {
            resolve({

              /**
               * lazy模块的默认组件函数属性。
               * @returns world文本。
               */
              default: /** World是lazy Promise兑现后的默认组件；不接参数，返回world文本。 */ function World() {
                return 'world';
              },
            });
          };
        }),
    );

    /** 初始只SSR Hello空格；客户端mount后打开含lazy的Suspense分支。 */
    class HelloWorld extends React.Component {

      /** isClient初始false保证SSR不启动lazy加载；mount改true后走普通客户端挂起更新。 */
      state = {isClient: false};

      /**
       * 把isClient置true，引起已hydrate根上的客户端更新。
       * @returns 无返回值。
       */
      componentDidMount() {
        this.setState({
          isClient: true,
        });
      }

      /**
       * 按isClient是否开启lazy决定只输出Hello还是附加Suspense。
       * @returns Hello与可选lazy边界的div。
       */
      render() {
        return (
          <div>
            Hello{' '}
            {this.state.isClient && (
              <React.Suspense fallback="loading">
                <Lazy />
              </React.Suspense>
            )}
          </div>
        );
      }
    }

    const element = document.createElement('div');
    element.innerHTML = ReactDOMServer.renderToString(<HelloWorld />);
    expect(element.textContent).toBe('Hello ');

    await act(() => {
      ReactDOMClient.hydrateRoot(element, <HelloWorld />);
    });
    expect(element.textContent).toBe('Hello loading');

    // 解析懒加载组件
    await act(() => resolveLazy());
    expect(element.textContent).toBe('Hello world');
  });

  /** Given：匹配的SSR空div已hydrate提交；When：root.render(null)后再次render div；Then：三个act完成且没有预期hydration警告，未显式断言节点身份。目的：初次提交后更新不重新进入hydration。 */
  it('does not re-enter hydration after committing the first one', async () => {
    const finalHTML = ReactDOMServer.renderToString(<div />);
    const container = document.createElement('div');
    container.innerHTML = finalHTML;
    const root = await act(() =>
      ReactDOMClient.hydrateRoot(container, <div />),
    );
    await act(() => root.render(null));
    // 这里不应重新进入 hydration 状态，因此也不应触发 hydration 警告。
    await act(() => root.render(<div />));
  });

  // 针对 https://github.com/facebook/react/issues/17170 的回归测试。

  /** Given：dangerouslySetInnerHTML=undefined并有p(Hello, World!) children；When：静态SSR后hydrate同输入；Then：innerHTML严格等于初始markup。目的：undefined等同未提供HTML注入，合法children仍可认领。 */
  it('should not warn if dangerouslySetInnerHtml=undefined', async () => {
    const domElement = document.createElement('div');
    const reactElement = (
      <div dangerouslySetInnerHTML={undefined}>
        <p>Hello, World!</p>
      </div>
    );
    const markup = ReactDOMServer.renderToStaticMarkup(reactElement);
    domElement.innerHTML = markup;

    await act(() => {
      ReactDOMClient.hydrateRoot(domElement, reactElement);
    });

    expect(domElement.innerHTML).toEqual(markup);
  });

  /** Given：服务器以HTML注入生成p(server)，客户端注入undefined并显式p(client)；When：hydrate并消费恢复错误；Then：innerHTML不同于SSR。目的：真正children不匹配会恢复，undefined不抑制恢复；不按标题声称额外检查了console警告。 */
  it('should warn if innerHTML mismatches with dangerouslySetInnerHTML=undefined and children on the client', async () => {
    const domElement = document.createElement('div');
    const markup = ReactDOMServer.renderToStaticMarkup(
      <div dangerouslySetInnerHTML={{__html: '<p>server</p>'}} />,
    );
    domElement.innerHTML = markup;

    await act(() => {
      ReactDOMClient.hydrateRoot(
        domElement,
        <div dangerouslySetInnerHTML={undefined}>
          <p>client</p>
        </div>,
        {
          /**
           * 消费HTML注入改为显式children导致的预期hydration错误；不改变恢复算法也不收集错误数量。
           * @param error - 预期的可恢复Error。
           * @returns undefined。
           */
          onRecoverableError: error => {}
        },
      );
    });

    expect(domElement.innerHTML).not.toEqual(markup);
  });

  /** Given：服务器以HTML注入生成p(server)，客户端HTML注入undefined且无children；When：hydrate并消费恢复错误；Then：innerHTML不同于SSR。目的：服务器多出的HTML需要客户端恢复，未断言具体错误列表。 */
  it('should warn if innerHTML mismatches with dangerouslySetInnerHTML=undefined on the client', async () => {
    const domElement = document.createElement('div');
    const markup = ReactDOMServer.renderToStaticMarkup(
      <div dangerouslySetInnerHTML={{__html: '<p>server</p>'}} />,
    );
    domElement.innerHTML = markup;

    await act(() => {
      ReactDOMClient.hydrateRoot(
        domElement,
        <div dangerouslySetInnerHTML={undefined} />,
        {
          /**
           * 消费服务器注入HTML但客户端无children时的预期恢复错误。
           * @param error - hydration恢复报告。
           * @returns undefined。
           */
          onRecoverableError: error => {}
        },
      );
    });

    expect(domElement.innerHTML).not.toEqual(markup);
  });

  /** Given：逐个为自定义元素传offsetParent/offsetTop/offsetLeft/offsetWidth/offsetHeight/isContentEditable/outerText/outerHTML=hello；When：各自SSR后hydrate；Then：每个都消费对应只读属性赋值no-op警告。目的：只读宿主property检查覆盖8个真实输入。 */
  it('should warn when hydrating read-only properties', async () => {
    const readOnlyProperties = [
      'offsetParent',
      'offsetTop',
      'offsetLeft',
      'offsetWidth',
      'offsetHeight',
      'isContentEditable',
      'outerText',
      'outerHTML',
    ];
    // eslint-disable-next-line no-for-of-loops/no-for-of-loops
    for (const readOnlyProperty of readOnlyProperties) {
      const props = {};
      props[readOnlyProperty] = 'hello';
      const jsx = React.createElement('my-custom-element', props);
      const element = document.createElement('div');
      element.innerHTML = ReactDOMServer.renderToString(jsx);
      await act(() => {
        ReactDOMClient.hydrateRoot(element, jsx);
      });
      assertConsoleErrorDev([
        `Assignment to read-only property will result in a no-op: \`${readOnlyProperty}\`
            in my-custom-element (at **)`,
      ]);
    }
  });

  /** Given：SSR自定义元素str=string、obj为对象，之后安装保存到_str/_obj的setter/getter；When：hydrate同props；Then：str属性仍string、obj属性缺失，两个property都undefined。目的：hydration不重新给自定义属性赋值，SSR非序列化对象也不被补写。 */
  it('should not re-assign properties on hydration', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const jsx = React.createElement('my-custom-element', {
      str: 'string',
      obj: {foo: 'bar'},
    });

    container.innerHTML = ReactDOMServer.renderToString(jsx);
    const customElement = container.querySelector('my-custom-element');

    // 安装设置以激活 `in` 检查
    Object.defineProperty(customElement, 'str', {

      /**
       * 自定义元素str属性存在性探测fixture的setter；若hydration赋值会在_str留下证据。
       * @param x - 被赋给str的值。
       * @returns 无返回值。
       */
      set: function (x) {
        this._str = x;
      },

      /**
       * 读取_str以检测setter是否曾被调用。
       * @returns 尚未赋值时为undefined。
       */
      get: function () {
        return this._str;
      },
    });
    Object.defineProperty(customElement, 'obj', {

      /**
       * 对象property的setter，记录实际赋值到_obj；用于证明SSR省略对象后hydration也不补赋。
       * @param x - 传给obj的对象值。
       * @returns 无返回值。
       */
      set: function (x) {
        this._obj = x;
      },

      /**
       * 读取_obj以判断对象property赋值是否发生。
       * @returns 本例未赋值时为undefined。
       */
      get: function () {
        return this._obj;
      },
    });

    await act(() => {
      ReactDOMClient.hydrateRoot(container, jsx);
    });

    expect(customElement.getAttribute('str')).toBe('string');
    expect(customElement.getAttribute('obj')).toBe(null);
    expect(customElement.str).toBe(undefined);
    expect(customElement.obj).toBe(undefined);
  });

  /** Given：Node字符串SSR中的Suspender抛永不兑现Promise，客户端App改为resolved；When：hydrate并waitForAll，收集onRecoverableError.message；Then：恰1错误，DEV要求切换客户端并建议renderToPipeableStream，production为通用未完成边界消息。目的：同步Node API不等待Suspense；未额外断言最终DOM。 */
  it('refers users to apis that support Suspense when something suspends', async () => {
    const theInfinitePromise = new Promise(() => {});

    /**
     * 抛永不兑现Promise，使同步Node SSR无法完成当前Suspense边界。
     * @returns 不返回。
     */
    function InfiniteSuspend() {
      throw theInfinitePromise;
    }

    /**
     * 服务器使用挂起组件，客户端切为已解析文字，触发服务器未完成边界的恢复报告。
     * @param isClient - false为SSR挂起；true为客户端resolved文本。
     * @returns 含fallback边界的div。
     */
    function App({isClient}) {
      return (
        <div>
          <React.Suspense fallback={'fallback'}>
            {isClient ? 'resolved' : <InfiniteSuspend />}
          </React.Suspense>
        </div>
      );
    }
    const container = document.createElement('div');
    container.innerHTML = ReactDOMServer.renderToString(
      <App isClient={false} />,
    );

    const errors = [];
    ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {

      /**
       * 把Node恢复错误的message追加errors，供数量与平台建议消息断言。
       * @param error - 恢复Error。
       * @param errorInfo - 本例未读取的额外诊断信息。
       * @returns 无返回值。
       */
      onRecoverableError(error, errorInfo) {
        errors.push(error.message);
      },
    });

    await waitForAll([]);
    expect(errors.length).toBe(1);
    if (__DEV__) {
      expect(errors[0]).toBe(
        'Switched to client rendering because the server rendering aborted due to:\n\n' +
          'The server used "renderToString" ' +
          'which does not support Suspense. If you intended for this Suspense boundary to render ' +
          'the fallback content on the server consider throwing an Error somewhere within the ' +
          'Suspense boundary. If you intended to have the server wait for the suspended component ' +
          'please switch to "renderToPipeableStream" which supports Suspense on the server',
      );
    } else {
      expect(errors[0]).toBe(
        'The server could not finish this Suspense boundary, likely due to ' +
          'an error during server rendering. Switched to client rendering.',
      );
    }
  });

  /** Given：browser字符串SSR的同样永挂起边界，客户端输入resolved；When：hydrate并收集恢复错误后waitForAll；Then：恰1错误，DEV建议renderToReadableStream，production同通用未完成消息。目的：浏览器服务器入口给出匹配平台的异步API建议。 */
  it('refers users to apis that support Suspense when something suspends (browser)', async () => {
    const theInfinitePromise = new Promise(() => {});

    /**
     * 抛同一个永不兑现Promise，使browser同步SSR留下未完成边界。
     * @returns 不返回。
     */
    function InfiniteSuspend() {
      throw theInfinitePromise;
    }

    /**
     * 用isClient区分browser SSR挂起输入与客户端resolved输入。
     * @param isClient - false服务器、true客户端。
     * @returns div中的Suspense边界。
     */
    function App({isClient}) {
      return (
        <div>
          <React.Suspense fallback={'fallback'}>
            {isClient ? 'resolved' : <InfiniteSuspend />}
          </React.Suspense>
        </div>
      );
    }
    const container = document.createElement('div');
    container.innerHTML = ReactDOMServerBrowser.renderToString(
      <App isClient={false} />,
    );

    const errors = [];
    ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {

      /**
       * 收集browser恢复错误的message，不吞掉断言要检查的内容。
       * @param error - 服务器未完成边界对应的恢复Error。
       * @param errorInfo - 本例未使用。
       * @returns 无返回值。
       */
      onRecoverableError(error, errorInfo) {
        errors.push(error.message);
      },
    });

    await waitForAll([]);
    expect(errors.length).toBe(1);
    if (__DEV__) {
      expect(errors[0]).toBe(
        'Switched to client rendering because the server rendering aborted due to:\n\n' +
          'The server used "renderToString" ' +
          'which does not support Suspense. If you intended for this Suspense boundary to render ' +
          'the fallback content on the server consider throwing an Error somewhere within the ' +
          'Suspense boundary. If you intended to have the server wait for the suspended component ' +
          'please switch to "renderToReadableStream" which supports Suspense on the server',
      );
    } else {
      expect(errors[0]).toBe(
        'The server could not finish this Suspense boundary, likely due to ' +
          'an error during server rendering. Switched to client rendering.',
      );
    }
  });

  /** Given：form中在a/b/c前后穿插额外hidden inputs；When：hydrate只声明a hidden、b submit及c button；Then：form ref与原form同一节点，a/b/c的name和value各为a/A、b/B、c/C。目的：跳过多余hidden输入仍认领原form，不整根重建。 */
  it('allows rendering extra hidden inputs in a form', async () => {
    const element = document.createElement('div');
    element.innerHTML =
      '<form>' +
      '<input type="hidden" /><input type="hidden" name="a" value="A" />' +
      '<input type="hidden" /><input type="submit" name="b" value="B" />' +
      '<input type="hidden" /><button name="c" value="C"></button>' +
      '<input type="hidden" />' +
      '</form>';
    const form = element.firstChild;
    const ref = React.createRef();
    const a = React.createRef();
    const b = React.createRef();
    const c = React.createRef();
    await act(async () => {
      ReactDOMClient.hydrateRoot(
        element,
        <form ref={ref}>
          <input type="hidden" name="a" value="A" ref={a} />
          <input type="submit" name="b" value="B" ref={b} />
          <button name="c" value="C" ref={c} />
        </form>,
      );
    });

    // 内容不应被客户端渲染。
    expect(ref.current).toBe(form);

    expect(a.current.name).toBe('a');
    expect(a.current.value).toBe('A');
    expect(b.current.name).toBe('b');
    expect(b.current.value).toBe('B');
    expect(c.current.name).toBe('c');
    expect(c.current.value).toBe('C');
  });

  /** Given：原button内hidden input后紧跟Click与分隔注释及me；When：hydrate只声明Click/me文本并绑定ref；Then：ref.current与原button严格同一节点。目的：文本认领前可跳过额外hidden输入。 */
  it('allows rendering extra hidden inputs immediately before a text instance', async () => {
    const element = document.createElement('div');
    element.innerHTML =
      '<button><input name="a" value="A" type="hidden" />Click <!-- -->me</button>';
    const button = element.firstChild;
    const ref = React.createRef();
    const extraText = 'me';

    await act(() => {
      ReactDOMClient.hydrateRoot(
        element,
        <button ref={ref}>Click {extraText}</button>,
      );
    });

    expect(ref.current).toBe(button);
  });
});
