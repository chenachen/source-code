/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let React = require('react');
let ReactDOM = require('react-dom');
let ReactDOMClient = require('react-dom/client');
let ReactDOMServer = require('react-dom/server');
let Scheduler = require('scheduler');
let act;
let useEffect;
let assertLog;
let waitForAll;
let assertConsoleErrorDev;

describe('ReactDOMRoot', () => {
  let container;

  beforeEach(() => {
    jest.resetModules();
    container = document.createElement('div');
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;
    useEffect = React.useEffect;

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;
    waitForAll = InternalTestUtils.waitForAll;
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「renders children」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('renders children', async () => {
    const root = ReactDOMClient.createRoot(container);
    root.render(<div>Hi</div>);
    await waitForAll([]);
    expect(container.textContent).toEqual('Hi');
  });

  /** 测试场景：验证「warns if a callback parameter is provided to render」描述的渲染、交互或错误处理结果。 */
  it('warns if a callback parameter is provided to render', async () => {
    const callback = jest.fn();
    const root = ReactDOMClient.createRoot(container);
    root.render(<div>Hi</div>, callback);
    assertConsoleErrorDev([
      'does not support the second callback argument. ' +
        'To execute a side effect after rendering, declare it in a component body with useEffect().',
    ]);
    await waitForAll([]);
    expect(callback).not.toHaveBeenCalled();
  });

  /** 测试场景：验证「warn if a object is passed to root.render(...)」描述的渲染、交互或错误处理结果。 */
  it('warn if a object is passed to root.render(...)', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return 'Child';
    }

    const root = ReactDOMClient.createRoot(container);
    root.render(<App />, {});
    assertConsoleErrorDev([
      'You passed a second argument to root.render(...) but it only accepts ' +
        'one argument.',
    ]);
  });

  /** 测试场景：验证「warn if a container is passed to root.render(...)」描述的渲染、交互或错误处理结果。 */
  it('warn if a container is passed to root.render(...)', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return 'Child';
    }

    const root = ReactDOMClient.createRoot(container);
    root.render(<App />, container);
    assertConsoleErrorDev([
      'You passed a container to the second argument of root.render(...). ' +
        "You don't need to pass it again since you already passed it to create " +
        'the root.',
    ]);
  });

  /** 测试场景：验证「warns if a callback parameter is provided to unmount」描述的渲染、交互或错误处理结果。 */
  it('warns if a callback parameter is provided to unmount', async () => {
    const callback = jest.fn();
    const root = ReactDOMClient.createRoot(container);
    root.render(<div>Hi</div>);
    root.unmount(callback);
    assertConsoleErrorDev([
      'does not support a callback argument. ' +
        'To execute a side effect after rendering, declare it in a component body with useEffect().',
    ]);
    await waitForAll([]);
    expect(callback).not.toHaveBeenCalled();
  });

  /** 测试场景：验证「unmounts children」描述的渲染、交互或错误处理结果。 */
  it('unmounts children', async () => {
    const root = ReactDOMClient.createRoot(container);
    root.render(<div>Hi</div>);
    await waitForAll([]);
    expect(container.textContent).toEqual('Hi');
    root.unmount();
    await waitForAll([]);
    expect(container.textContent).toEqual('');
  });

  /** 测试场景：验证「can be immediately unmounted」描述的渲染、交互或错误处理结果。 */
  it('can be immediately unmounted', async () => {
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.unmount();
    });
  });

  /** 测试场景：验证「supports hydration」描述的渲染、交互或错误处理结果。 */
  it('supports hydration', async () => {
    const markup = await new Promise(resolve =>
      resolve(
        ReactDOMServer.renderToString(
          <div>
            <span className="extra" />
          </div>,
        ),
      ),
    );

    // 默认不会执行 hydration。
    const container1 = document.createElement('div');
    container1.innerHTML = markup;
    const root1 = ReactDOMClient.createRoot(container1);
    root1.render(
      <div>
        <span />
      </div>,
    );
    await waitForAll([]);

    const container2 = document.createElement('div');
    container2.innerHTML = markup;
    ReactDOMClient.hydrateRoot(
      container2,
      <div>
        <span />
      </div>,
    );
    await waitForAll([]);
    assertConsoleErrorDev([
      "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. " +
        "This won't be patched up. This can happen if a SSR-ed Client Component used:\n" +
        '\n' +
        "- A server/client branch `if (typeof window !== 'undefined')`.\n" +
        "- Variable input such as `Date.now()` or `Math.random()` which changes each time it's called.\n" +
        "- Date formatting in a user's locale which doesn't match the server.\n" +
        '- External changing data without sending a snapshot of it along with the HTML.\n' +
        '- Invalid HTML tag nesting.\n' +
        '\n' +
        'It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.\n' +
        '\n' +
        'https://react.dev/link/hydration-mismatch\n' +
        '\n' +
        '  <div>\n' +
        '    <span\n' +
        '-     className="extra"\n' +
        '    >\n' +
        '\n    in span (at **)',
    ]);
  });

  /** 测试场景：验证「clears existing children」描述的渲染、交互或错误处理结果。 */
  it('clears existing children', async () => {
    container.innerHTML = '<div>a</div><div>b</div>';
    const root = ReactDOMClient.createRoot(container);
    root.render(
      <div>
        <span>c</span>
        <span>d</span>
      </div>,
    );
    await waitForAll([]);
    expect(container.textContent).toEqual('cd');
    root.render(
      <div>
        <span>d</span>
        <span>c</span>
      </div>,
    );
    await waitForAll([]);
    expect(container.textContent).toEqual('dc');
  });

  /** 测试场景：验证「throws a good message on invalid containers」描述的渲染、交互或错误处理结果。 */
  it('throws a good message on invalid containers', () => {
    expect(() => {
      ReactDOMClient.createRoot(<div>Hi</div>);
    }).toThrow('Target container is not a DOM element.');
  });

  /** 测试场景：验证「warns when creating two roots managing the same container」描述的渲染、交互或错误处理结果。 */
  it('warns when creating two roots managing the same container', () => {
    ReactDOMClient.createRoot(container);
    ReactDOMClient.createRoot(container);
    assertConsoleErrorDev([
      'You are calling ReactDOMClient.createRoot() on a container that ' +
        'has already been passed to createRoot() before. Instead, call ' +
        'root.render() on the existing root instead if you want to update it.',
    ]);
  });

  /** 测试场景：验证「does not warn when creating second root after first one is unmounted」描述的渲染、交互或错误处理结果。 */
  it('does not warn when creating second root after first one is unmounted', async () => {
    const root = ReactDOMClient.createRoot(container);
    root.unmount();
    await waitForAll([]);
    ReactDOMClient.createRoot(container); // 无警告
  });

  /** 测试场景：验证「warns if creating a root on the document.body」描述的渲染、交互或错误处理结果。 */
  it('warns if creating a root on the document.body', async () => {
    // 我们不再期望在浮点数启用时出现错误。
    ReactDOMClient.createRoot(document.body);
  });

  /** 测试场景：验证「warns if updating a root that has had its contents removed」描述的渲染、交互或错误处理结果。 */
  it('warns if updating a root that has had its contents removed', async () => {
    const root = ReactDOMClient.createRoot(container);
    root.render(<div>Hi</div>);
    await waitForAll([]);
    container.innerHTML = '';

    // 任一标志开启都会关闭此验证，因此这里预期没有警告。
    root.render(<div>Hi</div>);
  });

  /** 测试场景：验证「should render different components in same root」描述的渲染、交互或错误处理结果。 */
  it('should render different components in same root', async () => {
    document.body.appendChild(container);
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<div />);
    });
    expect(container.firstChild.nodeName).toBe('DIV');

    await act(() => {
      root.render(<span />);
    });
    expect(container.firstChild.nodeName).toBe('SPAN');
  });

  /** 测试场景：验证「should not warn if mounting into non-empty node」描述的渲染、交互或错误处理结果。 */
  it('should not warn if mounting into non-empty node', async () => {
    container.innerHTML = '<div></div>';
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<div />);
    });

    expect(true).toBe(true);
  });

  /** 测试场景：验证「should reuse markup if rendering to the same target twice」描述的渲染、交互或错误处理结果。 */
  it('should reuse markup if rendering to the same target twice', async () => {
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<div />);
    });
    const firstElm = container.firstChild;
    await act(() => {
      root.render(<div />);
    });

    expect(firstElm).toBe(container.firstChild);
  });

  /** 测试场景：验证「should unmount and remount if the key changes」描述的渲染、交互或错误处理结果。 */
  it('should unmount and remount if the key changes', async () => {
    /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
    function Component({text}) {
      useEffect(() => {
        Scheduler.log('Mount');

        return () => {
          Scheduler.log('Unmount');
        };
      }, []);

      return <span>{text}</span>;
    }

    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<Component text="orange" key="A" />);
    });
    expect(container.firstChild.innerHTML).toBe('orange');
    assertLog(['Mount']);

    // 改变 key 会使组件先卸载再重新挂载。
    await act(() => {
      root.render(<Component text="green" key="B" />);
    });
    expect(container.firstChild.innerHTML).toBe('green');
    assertLog(['Unmount', 'Mount']);

    // 但是如果我们不改变键,组件实例会重复使用
    await act(() => {
      root.render(<Component text="blue" key="B" />);
    });
    expect(container.firstChild.innerHTML).toBe('blue');
    assertLog([]);
  });

  /** 测试场景：验证「throws if unmounting a root that has had its contents removed」描述的渲染、交互或错误处理结果。 */
  it('throws if unmounting a root that has had its contents removed', async () => {
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<div>Hi</div>);
    });
    container.innerHTML = '';

    await expect(async () => {
      await act(() => {
        root.unmount();
      });
    }).rejects.toThrow('The node to be removed is not a child of this node.');
  });

  /** 测试场景：验证「unmount is synchronous」描述的渲染、交互或错误处理结果。 */
  it('unmount is synchronous', async () => {
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render('Hi');
    });
    expect(container.textContent).toEqual('Hi');

    await act(() => {
      root.unmount();
      // 应该已经卸载了.
      expect(container.textContent).toEqual('');
    });
  });

  /** 测试场景：验证「throws if an unmounted root is updated」描述的渲染、交互或错误处理结果。 */
  it('throws if an unmounted root is updated', async () => {
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render('Hi');
    });
    expect(container.textContent).toEqual('Hi');

    root.unmount();

    expect(() => root.render("I'm back")).toThrow(
      'Cannot update an unmounted root.',
    );
  });

  /** 测试场景：验证「warns if root is unmounted inside an effect」描述的渲染、交互或错误处理结果。 */
  it('warns if root is unmounted inside an effect', async () => {
    const container1 = document.createElement('div');
    const root1 = ReactDOMClient.createRoot(container1);
    const container2 = document.createElement('div');
    const root2 = ReactDOMClient.createRoot(container2);

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({step}) {
      useEffect(() => {
        if (step === 2) {
          root2.unmount();
        }
      }, [step]);
      return 'Hi';
    }

    await act(() => {
      root1.render(<App step={1} />);
    });
    expect(container1.textContent).toEqual('Hi');

    ReactDOM.flushSync(() => {
      root1.render(<App step={2} />);
    });
    assertConsoleErrorDev([
      'Attempted to synchronously unmount a root while React was already rendering. ' +
        'React cannot finish unmounting the root until the current render has completed, ' +
        'which may lead to a race condition.\n' +
        '    in App (at **)',
    ]);
  });

  // @gate disableCommentsAsDOMContainers
  /** 测试场景：验证「errors if container is a comment node」描述的渲染、交互或错误处理结果。 */
  it('errors if container is a comment node', () => {
    // 这是一个老功能, 在开源构建中被禁用.
    const div = document.createElement('div');
    div.innerHTML = '<!-- react-mount-point-unstable -->';
    const commentNode = div.childNodes[0];

    expect(() => ReactDOMClient.createRoot(commentNode)).toThrow(
      'Target container is not a DOM element.',
    );
    expect(() => ReactDOMClient.hydrateRoot(commentNode)).toThrow(
      'Target container is not a DOM element.',
    );
  });

  /** 测试场景：验证「warn if no children passed to hydrateRoot」描述的渲染、交互或错误处理结果。 */
  it('warn if no children passed to hydrateRoot', async () => {
    ReactDOMClient.hydrateRoot(container);
    assertConsoleErrorDev([
      'Must provide initial children as second argument to hydrateRoot. ' +
        'Example usage: hydrateRoot(domContainer, <App />)',
    ]);
  });

  /** 测试场景：验证「warn if JSX passed to createRoot」描述的渲染、交互或错误处理结果。 */
  it('warn if JSX passed to createRoot', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return 'Child';
    }

    ReactDOMClient.createRoot(container, <App />);
    assertConsoleErrorDev([
      'You passed a JSX element to createRoot. You probably meant to call root.render instead. ' +
        'Example usage:\n' +
        '\n' +
        '  let root = createRoot(domContainer);\n' +
        '  root.render(<App />);',
    ]);
  });

  /** 测试场景：验证「warns when given a function」描述的渲染、交互或错误处理结果。 */
  it('warns when given a function', () => {
    /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
    function Component() {
      return <div />;
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));

    ReactDOM.flushSync(() => {
      root.render(Component);
    });
    assertConsoleErrorDev([
      'Functions are not valid as a React child. ' +
        'This may happen if you return Component instead of <Component /> from render. ' +
        'Or maybe you meant to call this function rather than return it.\n' +
        '  root.render(Component)',
    ]);
  });

  /** 测试场景：验证「warns when given a symbol」描述的渲染、交互或错误处理结果。 */
  it('warns when given a symbol', () => {
    const root = ReactDOMClient.createRoot(document.createElement('div'));

    ReactDOM.flushSync(() => {
      root.render(Symbol('foo'));
    });
    assertConsoleErrorDev([
      'Symbols are not valid as a React child.\n' +
        '  root.render(Symbol(foo))',
    ]);
  });
});
