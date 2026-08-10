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

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should have the correct mounting behavior」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言对应 ReactDOMRoot.hydrateRoot 的容器认领与事件重放路径。
   */
  it('should have the correct mounting behavior', async () => {
    let mountCount = 0;
    let numClicks = 0;

    /** `TestComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class TestComponent extends React.Component {
      /** `TestComponent.spanRef`：记录测试夹具在当前场景中的状态。 */
      spanRef = React.createRef();

      /** `TestComponent.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        mountCount++;
      }

      /** `TestComponent.click`：封装当前用例复用的操作、回调或断言步骤。 */
      click = () => {
        numClicks++;
      };

      /** `TestComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

      // 测试更新路径。 标记不应改变。 但是，一些生命周期方法需要再次运行。
      await act(() => {
        root.render(<TestComponent name="x" />);
      });
      expect(mountCount).toEqual(1);

      // 卸载并重新挂载。 我们应获取另一个挂载事件，并且应该得到不同的标记。 由于 ID 是唯一的，每次都
      // 会。
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
            /** `onRecoverableError`：封装当前用例复用的操作、回调或断言步骤。 */
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
  /** 测试场景：验证「should emit autofocus on the server but not focus() when hydrating」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should not focus on either server or client with autofocus={false}」描述的渲染、交互或错误处理结果。 */
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
  /** 测试场景：验证「should not focus on either server or client with autofocus={false} even if there is a markup mismatch」描述的渲染、交互或错误处理结果。 */
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
          /** 消费本用例预期的可恢复 hydration 错误。 */
          onRecoverableError: error => {}
        },
      );
    });

    expect(onFocusBeforeHydration).not.toHaveBeenCalled();
    expect(onFocusAfterHydration).not.toHaveBeenCalled();
  });

  /** 测试场景：验证「should warn when the style property differs」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should not warn when the style property differs on whitespace or order in IE」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should warn when the style property differs on whitespace in non-IE browsers」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should throw rendering portals on the server」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should be able to render and hydrate Mode components」描述的渲染、交互或错误处理结果。 */
  it('should be able to render and hydrate Mode components', async () => {
    /** `ComponentWithWarning`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ComponentWithWarning extends React.Component {
      /** `ComponentWithWarning.componentWillMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentWillMount() {
        // 预期的警告
      }
      /** `ComponentWithWarning.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「replays effects when hydrating a StrictMode subtree」描述的渲染、交互或错误处理结果。 */
  it('replays effects when hydrating a StrictMode subtree', async () => {
    const log = [];
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「should be able to render and hydrate forwardRef components」描述的渲染、交互或错误处理结果。 */
  it('should be able to render and hydrate forwardRef components', async () => {
    /** `FunctionComponent`：封装当前用例复用的操作、回调或断言步骤。 */
    const FunctionComponent = ({label, forwardedRef}) => (
      <div ref={forwardedRef}>{label}</div>
    );
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

  /** 测试场景：验证「should be able to render and hydrate Profiler components」描述的渲染、交互或错误处理结果。 */
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
  /** 测试场景：验证「should ignore noscript content on the client and not warn about mismatches」描述的渲染、交互或错误处理结果。 */
  it('should ignore noscript content on the client and not warn about mismatches', async () => {
    const callback = jest.fn();
    /** `TestComponent`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「should be able to use lazy components after hydrating」描述的渲染、交互或错误处理结果。 */
  it('should be able to use lazy components after hydrating', async () => {
    let resolveLazy;
    const Lazy = React.lazy(
      () =>
        new Promise(resolve => {
          resolveLazy = () => {
            resolve({
              /** `default`：封装当前用例复用的操作、回调或断言步骤。 */
              default: function World() {
                return 'world';
              },
            });
          };
        }),
    );
    /** `HelloWorld`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class HelloWorld extends React.Component {
      /** `HelloWorld.state`：记录测试夹具在当前场景中的状态。 */
      state = {isClient: false};
      /** `HelloWorld.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        this.setState({
          isClient: true,
        });
      }
      /** `HelloWorld.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「does not re-enter hydration after committing the first one」描述的渲染、交互或错误处理结果。 */
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
  /** 测试场景：验证「should not warn if dangerouslySetInnerHtml=undefined」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should warn if innerHTML mismatches with dangerouslySetInnerHTML=undefined and children on the client」描述的渲染、交互或错误处理结果。 */
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
          /** 消费本用例预期的可恢复 hydration 错误。 */
          onRecoverableError: error => {}
        },
      );
    });

    expect(domElement.innerHTML).not.toEqual(markup);
  });

  /** 测试场景：验证「should warn if innerHTML mismatches with dangerouslySetInnerHTML=undefined on the client」描述的渲染、交互或错误处理结果。 */
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
          /** 消费本用例预期的可恢复 hydration 错误。 */
          onRecoverableError: error => {}
        },
      );
    });

    expect(domElement.innerHTML).not.toEqual(markup);
  });

  /** 测试场景：验证「should warn when hydrating read-only properties」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should not re-assign properties on hydration」描述的渲染、交互或错误处理结果。 */
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
      /** `set`：封装当前用例复用的操作、回调或断言步骤。 */
      set: function (x) {
        this._str = x;
      },
      /** `get`：封装当前用例复用的操作、回调或断言步骤。 */
      get: function () {
        return this._str;
      },
    });
    Object.defineProperty(customElement, 'obj', {
      /** `set`：封装当前用例复用的操作、回调或断言步骤。 */
      set: function (x) {
        this._obj = x;
      },
      /** `get`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「refers users to apis that support Suspense when something suspends」描述的渲染、交互或错误处理结果。 */
  it('refers users to apis that support Suspense when something suspends', async () => {
    const theInfinitePromise = new Promise(() => {});
    /** `InfiniteSuspend`：封装当前用例复用的操作、回调或断言步骤。 */
    function InfiniteSuspend() {
      throw theInfinitePromise;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「refers users to apis that support Suspense when something suspends (browser)」描述的渲染、交互或错误处理结果。 */
  it('refers users to apis that support Suspense when something suspends (browser)', async () => {
    const theInfinitePromise = new Promise(() => {});
    /** `InfiniteSuspend`：封装当前用例复用的操作、回调或断言步骤。 */
    function InfiniteSuspend() {
      throw theInfinitePromise;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「allows rendering extra hidden inputs in a form」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「allows rendering extra hidden inputs immediately before a text instance」描述的渲染、交互或错误处理结果。 */
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
