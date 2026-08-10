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
let ReactDOM;
let findDOMNode;
let ReactDOMClient;
let ReactDOMServer;
let assertConsoleErrorDev;
let act;

describe('ReactDOM', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    findDOMNode =
      ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
        .findDOMNode;

    ({act, assertConsoleErrorDev} = require('internal-test-utils'));
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should bubble onSubmit」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should bubble onSubmit', async () => {
    const container = document.createElement('div');

    let count = 0;
    let buttonRef;

    /** `Parent`：封装当前用例复用的操作、回调或断言步骤。 */
    function Parent() {
      return (
        <div
          onSubmit={event => {
            event.preventDefault();
            count++;
          }}>
          <Child />
        </div>
      );
    }

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      return (
        <form>
          <input type="submit" ref={button => (buttonRef = button)} />
        </form>
      );
    }

    document.body.appendChild(container);
    const root = ReactDOMClient.createRoot(container);
    try {
      await act(() => {
        root.render(<Parent />);
      });
      buttonRef.click();
      expect(count).toBe(1);
    } finally {
      document.body.removeChild(container);
    }
  });

  /** 测试场景：验证「allows a DOM element to be used with a string」描述的渲染、交互或错误处理结果。 */
  it('allows a DOM element to be used with a string', async () => {
    const element = React.createElement('div', {className: 'foo'});
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(element);
    });

    const node = container.firstChild;
    expect(node.tagName).toBe('DIV');
  });

  /** 测试场景：验证「should allow children to be passed as an argument」描述的渲染、交互或错误处理结果。 */
  it('should allow children to be passed as an argument', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(React.createElement('div', null, 'child'));
    });

    const argNode = container.firstChild;
    expect(argNode.innerHTML).toBe('child');
  });

  /** 测试场景：验证「should overwrite props.children with children argument」描述的渲染、交互或错误处理结果。 */
  it('should overwrite props.children with children argument', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(React.createElement('div', {children: 'fakechild'}, 'child'));
    });

    const conflictNode = container.firstChild;
    expect(conflictNode.innerHTML).toBe('child');
  });

  /**
   * 我们还需要确保更新发生在实际存在于 DOM 的节点上。 没有一个老旧的缓存.
   */
  /** 测试场景：验证「should purge the DOM cache when removing nodes」描述的渲染、交互或错误处理结果。 */
  it('should purge the DOM cache when removing nodes', async () => {
    let container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <div>
          <div key="theDog" className="dog" />,
          <div key="theBird" className="bird" />
        </div>,
      );
    });
    // 使用 theDog 预热缓存。
    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <div>
          <div key="theDog" className="dogbeforedelete" />,
          <div key="theBird" className="bird" />,
        </div>,
      );
    });
    // 移除 theDog，这应清除缓存。
    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <div>
          <div key="theBird" className="bird" />,
        </div>,
      );
    });
    // 现在放回 theDog；它已是另一个 DOM 节点。
    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <div>
          <div key="theDog" className="dog" />,
          <div key="theBird" className="bird" />,
        </div>,
      );
    });
    // 更改 theDog 的 className；它仍会使用同一元素。
    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <div>
          <div key="theDog" className="bigdog" />,
          <div key="theBird" className="bird" />,
        </div>,
      );
    });

    const myDiv = container.firstChild;
    const dog = myDiv.childNodes[0];
    expect(dog.className).toBe('bigdog');
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「throws in render() if the mount callback in legacy roots is not a function」描述的渲染、交互或错误处理结果。 */
  it('throws in render() if the mount callback in legacy roots is not a function', async () => {
    spyOnDev(console, 'warn');
    spyOnDev(console, 'error');

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      this.a = 1;
      this.b = 2;
    }

    /** `A`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class A extends React.Component {
      /** `A.state`：记录测试夹具在当前场景中的状态。 */
      state = {};

      /** `A.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    const myDiv = document.createElement('div');
    await expect(async () => {
      await act(() => {
        ReactDOM.render(<A />, myDiv, 'no');
      });
    }).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: no',
    );
    assertConsoleErrorDev([
      'Expected the last optional `callback` argument to be a function. Instead received: no.',
      'Expected the last optional `callback` argument to be a function. Instead received: no.',
    ]);

    await expect(async () => {
      await act(() => {
        ReactDOM.render(<A />, myDiv, {foo: 'bar'});
      });
    }).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: [object Object]',
    );
    assertConsoleErrorDev([
      "Expected the last optional `callback` argument to be a function. Instead received: { foo: 'bar' }",
      "Expected the last optional `callback` argument to be a function. Instead received: { foo: 'bar' }.",
    ]);

    await expect(async () => {
      await act(() => {
        ReactDOM.render(<A />, myDiv, new Foo());
      });
    }).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: [object Object]',
    );
    assertConsoleErrorDev([
      'Expected the last optional `callback` argument to be a function. Instead received: Foo { a: 1, b: 2 }.',
      'Expected the last optional `callback` argument to be a function. Instead received: Foo { a: 1, b: 2 }.',
    ]);
  });

  // @gate !disableLegacyMode
  /** 测试场景：验证「throws in render() if the update callback in legacy roots is not a function」描述的渲染、交互或错误处理结果。 */
  it('throws in render() if the update callback in legacy roots is not a function', async () => {
    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      this.a = 1;
      this.b = 2;
    }

    /** `A`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class A extends React.Component {
      /** `A.state`：记录测试夹具在当前场景中的状态。 */
      state = {};

      /** `A.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    const myDiv = document.createElement('div');
    ReactDOM.render(<A />, myDiv);
    await expect(async () => {
      await act(() => {
        ReactDOM.render(<A />, myDiv, 'no');
      });
    }).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: no',
    );
    assertConsoleErrorDev([
      'Expected the last optional `callback` argument to be a function. Instead received: no.',
      'Expected the last optional `callback` argument to be a function. Instead received: no.',
    ]);

    ReactDOM.render(<A />, myDiv); // 重新挂载
    await expect(async () => {
      await act(() => {
        ReactDOM.render(<A />, myDiv, {foo: 'bar'});
      });
    }).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: [object Object]',
    );
    assertConsoleErrorDev([
      "Expected the last optional `callback` argument to be a function. Instead received: { foo: 'bar' }.",
      "Expected the last optional `callback` argument to be a function. Instead received: { foo: 'bar' }.",
    ]);

    ReactDOM.render(<A />, myDiv); // 重新挂载
    await expect(async () => {
      await act(() => {
        ReactDOM.render(<A />, myDiv, new Foo());
      });
    }).rejects.toThrowError(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: [object Object]',
    );
    assertConsoleErrorDev([
      'Expected the last optional `callback` argument to be a function. Instead received: Foo { a: 1, b: 2 }.',
      'Expected the last optional `callback` argument to be a function. Instead received: Foo { a: 1, b: 2 }.',
    ]);
  });

  /** 测试场景：验证「preserves focus」描述的渲染、交互或错误处理结果。 */
  it('preserves focus', async () => {
    let input;
    let input2;
    /** `A`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class A extends React.Component {
      /** `A.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            <input id="one" ref={r => (input = input || r)} />
            {this.props.showTwo && (
              <input id="two" ref={r => (input2 = input2 || r)} />
            )}
          </div>
        );
      }

      /** `A.componentDidUpdate`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidUpdate() {
        // 焦点应该恢复到原始输入
        expect(document.activeElement.id).toBe('one');
        input2.focus();
        expect(document.activeElement.id).toBe('two');
        log.push('input2 focused');
      }
    }

    const log = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOMClient.createRoot(container);
    try {
      await act(() => {
        root.render(<A showTwo={false} />);
      });
      input.focus();

      // 添加第二个 input 时，模拟一次焦点丢失；操作 DOM 节点时可能发生这种情况，但若不深度依赖 React DOM 实现细节，很难稳定地强制复现。
      const div = container.firstChild;
      ['appendChild', 'insertBefore'].forEach(name => {
        const mutator = div[name];
        div[name] = function () {
          if (input) {
            input.blur();
            expect(document.activeElement.tagName).toBe('BODY');
            log.push('input2 inserted');
          }
          return mutator.apply(this, arguments);
        };
      });

      expect(document.activeElement.id).toBe('one');
      await act(() => {
        root.render(<A showTwo={true} />);
      });
      // 添加 input2 会使 input 失焦；随后 componentDidUpdate 聚焦 input2。该焦点应保持到这里，不应被焦点恢复逻辑覆盖。
      expect(document.activeElement.id).toBe('two');
      expect(log).toEqual(['input2 inserted', 'input2 focused']);
    } finally {
      document.body.removeChild(container);
    }
  });

  /** 测试场景：验证「calls focus() on autoFocus elements after they have been mounted to the DOM」描述的渲染、交互或错误处理结果。 */
  it('calls focus() on autoFocus elements after they have been mounted to the DOM', async () => {
    const originalFocus = HTMLElement.prototype.focus;

    try {
      let focusedElement;
      let inputFocusedAfterMount = false;

      // 本测试需确认 focus 在挂载后调用。不能检查 document.activeElement，因为 PhantomJS 过于宽松，
      // 即使元素不在 DOM 中也允许它获得焦点。
      HTMLElement.prototype.focus = function () {
        focusedElement = this;
        inputFocusedAfterMount = !!this.parentNode;
      };

      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(
          <div>
            <h1>Auto-focus Test</h1>
            <input autoFocus={true} />
            <p>The above input should be focused after mount.</p>
          </div>,
        );
      });

      expect(inputFocusedAfterMount).toBe(true);
      expect(focusedElement.tagName).toBe('INPUT');
    } finally {
      HTMLElement.prototype.focus = originalFocus;
    }
  });

  /** 测试场景：验证「shouldn't fire duplicate event handler while handling other nested dispatch」描述的渲染、交互或错误处理结果。 */
  it("shouldn't fire duplicate event handler while handling other nested dispatch", async () => {
    const actual = [];

    /** `Wrapper`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Wrapper extends React.Component {
      /** `Wrapper.componentDidMount`：实现测试夹具的生命周期、渲染或交互步骤。 */
      componentDidMount() {
        this.ref1.click();
      }

      /** `Wrapper.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return (
          <div>
            <div
              onClick={() => {
                actual.push('1st node clicked');
                this.ref2.click();
              }}
              ref={ref => (this.ref1 = ref)}
            />
            <div
              onClick={ref => {
                actual.push("2nd node clicked imperatively from 1st's handler");
              }}
              ref={ref => (this.ref2 = ref)}
            />
          </div>
        );
      }
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOMClient.createRoot(container);
    try {
      await act(() => {
        root.render(<Wrapper />);
      });

      const expected = [
        '1st node clicked',
        "2nd node clicked imperatively from 1st's handler",
      ];

      expect(actual).toEqual(expected);
    } finally {
      document.body.removeChild(container);
    }
  });

  /** 测试场景：验证「should not crash with devtools installed」描述的渲染、交互或错误处理结果。 */
  it('should not crash with devtools installed', async () => {
    try {
      global.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        /** `inject`：封装当前用例复用的操作、回调或断言步骤。 */
        inject: function () {},
        /** `onCommitFiberRoot`：封装当前用例复用的操作、回调或断言步骤。 */
        onCommitFiberRoot: function () {},
        /** `onCommitFiberUnmount`：封装当前用例复用的操作、回调或断言步骤。 */
        onCommitFiberUnmount: function () {},
        supportsFiber: true,
      };
      jest.resetModules();
      React = require('react');
      ReactDOM = require('react-dom');
      /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class Component extends React.Component {
        /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          return <div />;
        }
      }
      const root = ReactDOMClient.createRoot(document.createElement('div'));
      await act(() => {
        root.render(<Component />);
      });
    } finally {
      delete global.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    }
  });

  /** 测试场景：验证「should not crash calling findDOMNode inside a function component」描述的渲染、交互或错误处理结果。 */
  it('should not crash calling findDOMNode inside a function component', async () => {
    /** `Component`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class Component extends React.Component {
      /** `Component.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <div />;
      }
    }

    const container = document.createElement('div');
    let root = ReactDOMClient.createRoot(container);
    let instance;
    await act(() => {
      root.render(<Component ref={current => (instance = current)} />);
    });

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    const App = () => {
      findDOMNode(instance);
      return <div />;
    };

    if (__DEV__) {
      root = ReactDOMClient.createRoot(document.createElement('div'));
      await act(() => {
        root.render(<App />);
      });
    }
  });

  /** 测试场景：验证「reports stacks with re-entrant renderToString() calls on the client」描述的渲染、交互或错误处理结果。 */
  it('reports stacks with re-entrant renderToString() calls on the client', async () => {
    /** `Child2`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child2(props) {
      return <span ariaTypo3="no">{props.children}</span>;
    }

    /** `App2`：封装当前用例复用的操作、回调或断言步骤。 */
    function App2() {
      return (
        <Child2>
          {ReactDOMServer.renderToString(<blink ariaTypo2="no" />)}
        </Child2>
      );
    }

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      return (
        <span ariaTypo4="no">{ReactDOMServer.renderToString(<App2 />)}</span>
      );
    }

    /** `ServerEntry`：封装当前用例复用的操作、回调或断言步骤。 */
    function ServerEntry() {
      return ReactDOMServer.renderToString(<Child />);
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div>
          <span ariaTypo="no" />
          <ServerEntry />
          <font ariaTypo5="no" />
        </div>
      );
    }

    const root = ReactDOMClient.createRoot(document.createElement('div'));
    await act(() => {
      root.render(<App />);
    });
    assertConsoleErrorDev([
      // ReactDOM(App > div > span)
      'Invalid ARIA attribute `ariaTypo`. ARIA attributes follow the pattern aria-* and must be lowercase.\n' +
        '    in span (at **)\n' +
        '    in App (at **)',
      // ReactDOM(App > div > ServerEntry) >>> ReactDOMServer(Child) >>> ReactDOMServer(App2) >>> ReactDOMServer(blink)
      'Invalid ARIA attribute `ariaTypo2`. ARIA attributes follow the pattern aria-* and must be lowercase.\n' +
        '    in blink (at **)\n' +
        '    in App2 (at **)\n' +
        '    in Child (at **)\n' +
        '    in ServerEntry (at **)',
      // ReactDOM(App > div > ServerEntry) >>> ReactDOMServer(Child) >>> ReactDOMServer(App2 > Child2 > span)
      'Invalid ARIA attribute `ariaTypo3`. ARIA attributes follow the pattern aria-* and must be lowercase.\n' +
        '    in span (at **)\n' +
        '    in Child2 (at **)\n' +
        '    in App2 (at **)\n' +
        '    in Child (at **)\n' +
        '    in ServerEntry (at **)',
      // ReactDOM(App > div > ServerEntry) >>> ReactDOMServer(Child > span)
      'Invalid ARIA attribute `ariaTypo4`. ARIA attributes follow the pattern aria-* and must be lowercase.\n' +
        '    in span (at **)\n' +
        '    in Child (at **)\n' +
        '    in ServerEntry (at **)',

      // ReactDOM(App > div > font)
      'Invalid ARIA attribute `ariaTypo5`. ARIA attributes follow the pattern aria-* and must be lowercase.\n' +
        '    in font (at **)\n' +
        '    in App (at **)',
    ]);
  });

  /** 测试场景：验证「should render root host components into body scope when the container is a Document」描述的渲染、交互或错误处理结果。 */
  it('should render root host components into body scope when the container is a Document', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({phase}) {
      return (
        <>
          {phase < 1 ? null : <div>..before</div>}
          {phase < 3 ? <div>before</div> : null}
          {phase < 2 ? null : <div>before..</div>}
          <html lang="en">
            <head data-h="">
              {phase < 1 ? null : <meta itemProp="" content="..head" />}
              {phase < 3 ? <meta itemProp="" content="head" /> : null}
              {phase < 2 ? null : <meta itemProp="" content="head.." />}
            </head>
            <body data-b="">
              {phase < 1 ? null : <div>..inside</div>}
              {phase < 3 ? <div>inside</div> : null}
              {phase < 2 ? null : <div>inside..</div>}
            </body>
          </html>
          {phase < 1 ? null : <div>..after</div>}
          {phase < 3 ? <div>after</div> : null}
          {phase < 2 ? null : <div>after..</div>}
        </>
      );
    }

    const root = ReactDOMClient.createRoot(document);
    await act(() => {
      root.render(<App phase={0} />);
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html lang="en"><head data-h=""><meta itemprop="" content="head"></head><body data-b=""><div>before</div><div>inside</div><div>after</div></body></html>',
    );

    await act(() => {
      root.render(<App phase={1} />);
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html lang="en"><head data-h=""><meta itemprop="" content="..head"><meta itemprop="" content="head"></head><body data-b=""><div>..before</div><div>before</div><div>..inside</div><div>inside</div><div>..after</div><div>after</div></body></html>',
    );

    await act(() => {
      root.render(<App phase={2} />);
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html lang="en"><head data-h=""><meta itemprop="" content="..head"><meta itemprop="" content="head"><meta itemprop="" content="head.."></head><body data-b=""><div>..before</div><div>before</div><div>before..</div><div>..inside</div><div>inside</div><div>inside..</div><div>..after</div><div>after</div><div>after..</div></body></html>',
    );

    await act(() => {
      root.render(<App phase={3} />);
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html lang="en"><head data-h=""><meta itemprop="" content="..head"><meta itemprop="" content="head.."></head><body data-b=""><div>..before</div><div>before..</div><div>..inside</div><div>inside..</div><div>..after</div><div>after..</div></body></html>',
    );

    await act(() => {
      root.unmount();
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html><head></head><body></body></html>',
    );
  });

  /** 测试场景：验证「should render root host components into body scope when the container is a the <html> tag」描述的渲染、交互或错误处理结果。 */
  it('should render root host components into body scope when the container is a the <html> tag', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({phase}) {
      return (
        <>
          {phase < 1 ? null : <div>..before</div>}
          {phase < 3 ? <div>before</div> : null}
          {phase < 2 ? null : <div>before..</div>}
          <head data-h="">
            {phase < 1 ? null : <meta itemProp="" content="..head" />}
            {phase < 3 ? <meta itemProp="" content="head" /> : null}
            {phase < 2 ? null : <meta itemProp="" content="head.." />}
          </head>
          <body data-b="">
            {phase < 1 ? null : <div>..inside</div>}
            {phase < 3 ? <div>inside</div> : null}
            {phase < 2 ? null : <div>inside..</div>}
          </body>
          {phase < 1 ? null : <div>..after</div>}
          {phase < 3 ? <div>after</div> : null}
          {phase < 2 ? null : <div>after..</div>}
        </>
      );
    }

    const root = ReactDOMClient.createRoot(document.documentElement);
    await act(() => {
      root.render(<App phase={0} />);
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html><head data-h=""><meta itemprop="" content="head"></head><body data-b=""><div>before</div><div>inside</div><div>after</div></body></html>',
    );

    await act(() => {
      root.render(<App phase={1} />);
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html><head data-h=""><meta itemprop="" content="..head"><meta itemprop="" content="head"></head><body data-b=""><div>..before</div><div>before</div><div>..inside</div><div>inside</div><div>..after</div><div>after</div></body></html>',
    );

    await act(() => {
      root.render(<App phase={2} />);
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html><head data-h=""><meta itemprop="" content="..head"><meta itemprop="" content="head"><meta itemprop="" content="head.."></head><body data-b=""><div>..before</div><div>before</div><div>before..</div><div>..inside</div><div>inside</div><div>inside..</div><div>..after</div><div>after</div><div>after..</div></body></html>',
    );

    await act(() => {
      root.render(<App phase={3} />);
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html><head data-h=""><meta itemprop="" content="..head"><meta itemprop="" content="head.."></head><body data-b=""><div>..before</div><div>before..</div><div>..inside</div><div>inside..</div><div>..after</div><div>after..</div></body></html>',
    );

    await act(() => {
      root.unmount();
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html><head></head><body></body></html>',
    );
  });

  /** 测试场景：验证「should render root host components into body scope when the container is a the <body> tag」描述的渲染、交互或错误处理结果。 */
  it('should render root host components into body scope when the container is a the <body> tag', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({phase}) {
      return (
        <>
          {phase < 1 ? null : <div>..before</div>}
          {phase < 3 ? <div>before</div> : null}
          {phase < 2 ? null : <div>before..</div>}
          <head data-h="">
            {phase < 1 ? null : <meta itemProp="" content="..head" />}
            {phase < 3 ? <meta itemProp="" content="head" /> : null}
            {phase < 2 ? null : <meta itemProp="" content="head.." />}
          </head>
          {phase < 1 ? null : <div>..inside</div>}
          {phase < 3 ? <div>inside</div> : null}
          {phase < 2 ? null : <div>inside..</div>}
          {phase < 1 ? null : <div>..after</div>}
          {phase < 3 ? <div>after</div> : null}
          {phase < 2 ? null : <div>after..</div>}
        </>
      );
    }

    const root = ReactDOMClient.createRoot(document.body);
    await act(() => {
      root.render(<App phase={0} />);
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html><head data-h=""><meta itemprop="" content="head"></head><body><div>before</div><div>inside</div><div>after</div></body></html>',
    );

    await act(() => {
      root.render(<App phase={1} />);
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html><head data-h=""><meta itemprop="" content="..head"><meta itemprop="" content="head"></head><body><div>..before</div><div>before</div><div>..inside</div><div>inside</div><div>..after</div><div>after</div></body></html>',
    );

    await act(() => {
      root.render(<App phase={2} />);
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html><head data-h=""><meta itemprop="" content="..head"><meta itemprop="" content="head"><meta itemprop="" content="head.."></head><body><div>..before</div><div>before</div><div>before..</div><div>..inside</div><div>inside</div><div>inside..</div><div>..after</div><div>after</div><div>after..</div></body></html>',
    );

    await act(() => {
      root.render(<App phase={3} />);
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html><head data-h=""><meta itemprop="" content="..head"><meta itemprop="" content="head.."></head><body><div>..before</div><div>before..</div><div>..inside</div><div>inside..</div><div>..after</div><div>after..</div></body></html>',
    );

    await act(() => {
      root.unmount();
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html><head></head><body></body></html>',
    );
  });

  /** 测试场景：验证「should render children of <head> into the document head even when the container is inside the document body」描述的渲染、交互或错误处理结果。 */
  it('should render children of <head> into the document head even when the container is inside the document body', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({phase}) {
      return (
        <>
          <div>before</div>
          <head data-h="">
            {phase < 1 ? null : <meta itemProp="" content="..head" />}
            {phase < 3 ? <meta itemProp="" content="head" /> : null}
            {phase < 2 ? null : <meta itemProp="" content="head.." />}
          </head>
          <div>after</div>
        </>
      );
    }

    const container = document.createElement('main');
    document.body.append(container);
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<App phase={0} />);
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html><head data-h=""><meta itemprop="" content="head"></head><body><main><div>before</div><div>after</div></main></body></html>',
    );

    // @TODO 放宽标签嵌套限制、允许应用 root 使用任意标签后，移除此警告检查。
    assertConsoleErrorDev([
      'In HTML, <head> cannot be a child of <main>.\nThis will cause a hydration error.\n' +
        '    in head (at **)\n' +
        '    in App (at **)',
    ]);

    await act(() => {
      root.render(<App phase={1} />);
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html><head data-h=""><meta itemprop="" content="..head"><meta itemprop="" content="head"></head><body><main><div>before</div><div>after</div></main></body></html>',
    );

    await act(() => {
      root.render(<App phase={2} />);
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html><head data-h=""><meta itemprop="" content="..head"><meta itemprop="" content="head"><meta itemprop="" content="head.."></head><body><main><div>before</div><div>after</div></main></body></html>',
    );

    await act(() => {
      root.render(<App phase={3} />);
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html><head data-h=""><meta itemprop="" content="..head"><meta itemprop="" content="head.."></head><body><main><div>before</div><div>after</div></main></body></html>',
    );

    await act(() => {
      root.unmount();
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html><head></head><body><main></main></body></html>',
    );
  });

  /** 测试场景：验证「can render a Suspense boundary above the <html> tag」描述的渲染、交互或错误处理结果。 */
  it('can render a Suspense boundary above the <html> tag', async () => {
    let suspendOnNewPromise;
    let resolveCurrentPromise;
    let currentPromise;
    /** `createNewPromise`：封装当前用例复用的操作、回调或断言步骤。 */
    function createNewPromise() {
      currentPromise = new Promise(r => {
        resolveCurrentPromise = r;
      });
      return currentPromise;
    }
    createNewPromise();
    /** `Comp`：封装当前用例复用的操作、回调或断言步骤。 */
    function Comp() {
      const [promise, setPromise] = React.useState(currentPromise);
      suspendOnNewPromise = () => {
        setPromise(createNewPromise());
      };
      React.use(promise);
      return null;
    }

    const fallback = (
      <html data-fallback="">
        <body data-fallback="">
          <div>fallback</div>
        </body>
      </html>
    );

    const main = (
      <html lang="en">
        <head>
          <meta itemProp="" content="primary" />
        </head>
        <body>
          <div>
            <Message />
          </div>
        </body>
      </html>
    );

    let suspendOnNewMessage;
    let currentMessage;
    let resolveCurrentMessage;
    /** `createNewMessage`：封装当前用例复用的操作、回调或断言步骤。 */
    function createNewMessage() {
      currentMessage = new Promise(r => {
        resolveCurrentMessage = r;
      });
      return currentMessage;
    }
    createNewMessage();
    resolveCurrentMessage('hello world');
    /** `Message`：封装当前用例复用的操作、回调或断言步骤。 */
    function Message() {
      const [pendingMessage, setPendingMessage] =
        React.useState(currentMessage);
      suspendOnNewMessage = () => {
        setPendingMessage(createNewMessage());
      };
      return React.use(pendingMessage);
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <React.Suspense fallback={fallback}>
          <Comp />
          {main}
        </React.Suspense>
      );
    }

    const root = ReactDOMClient.createRoot(document);
    await act(() => {
      root.render(<App />);
    });
    // promiseA 阻塞初始渲染，因此此时显示 fallback Document。
    expect(document.documentElement.outerHTML).toBe(
      '<html data-fallback=""><head></head><body data-fallback=""><div>fallback</div></body></html>',
    );

    await act(() => {
      resolveCurrentPromise();
    });
    // promiseA 兑现后显示 primary Document。
    expect(document.documentElement.outerHTML).toBe(
      '<html lang="en"><head><meta itemprop="" content="primary"></head><body><div>hello world</div></body></html>',
    );

    await act(() => {
      suspendOnNewPromise();
    });
    // 同步切换为渲染 ComponentB 时，Document 必须重新进入 fallback；primary 内容会保持隐藏，直至 promiseB 兑现。
    expect(document.documentElement.outerHTML).toBe(
      '<html data-fallback=""><head><meta itemprop="" content="primary" style="display: none;"></head><body data-fallback=""><div style="display: none;">hello world</div><div>fallback</div></body></html>',
    );

    await act(() => {
      resolveCurrentPromise();
    });
    // promiseB 兑现后，primary Document 会显示新的 primary 内容；Suspense 边界取消隐藏后，style 属性仍会保留。
    expect(document.documentElement.outerHTML).toBe(
      '<html lang="en"><head><meta itemprop="" content="primary" style=""></head><body><div style="">hello world</div></body></html>',
    );

    await act(() => {
      React.startTransition(() => {
        suspendOnNewPromise();
      });
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html lang="en"><head><meta itemprop="" content="primary" style=""></head><body><div style="">hello world</div></body></html>',
    );

    await act(() => {
      resolveCurrentPromise();
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html lang="en"><head><meta itemprop="" content="primary" style=""></head><body><div style="">hello world</div></body></html>',
    );

    await act(() => {
      suspendOnNewMessage();
    });
    // 更新消息本身会更新 Suspense 边界的主内容。这里也覆盖这一分支，
    // 以确认 layout effect 消失再出现时不会重复获取 document singleton。
    expect(document.documentElement.outerHTML).toBe(
      '<html data-fallback=""><head><meta itemprop="" content="primary" style="display: none;"></head><body data-fallback=""><div style="display: none;">hello world</div><div>fallback</div></body></html>',
    );

    await act(() => {
      resolveCurrentMessage('hello you!');
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html lang="en"><head><meta itemprop="" content="primary" style=""></head><body><div style="">hello you!</div></body></html>',
    );

    await act(() => {
      React.startTransition(() => {
        suspendOnNewMessage();
      });
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html lang="en"><head><meta itemprop="" content="primary" style=""></head><body><div style="">hello you!</div></body></html>',
    );

    await act(() => {
      resolveCurrentMessage('goodbye!');
    });
    expect(document.documentElement.outerHTML).toBe(
      '<html lang="en"><head><meta itemprop="" content="primary" style=""></head><body><div style="">goodbye!</div></body></html>',
    );
  });
});
