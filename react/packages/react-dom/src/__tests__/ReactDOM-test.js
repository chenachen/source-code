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

  /** 已挂载的父 div 监听 onSubmit、子 form 提供 submit input；调用 input.click 后父回调阻止默认行为且计数为 1，验证提交事件沿 React 父链冒泡；finally 移除容器。 */
  it('should bubble onSubmit', async () => {
    const container = document.createElement('div');

    let count = 0;
    let buttonRef;

    /** 返回监听 submit 的父 div 与 Child；回调 preventDefault 并递增共享 count，供实际 submit input 点击验证冒泡。 */
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

    /** 返回带 submit input 的 form，并将 input DOM 保存到 buttonRef，供父级用例直接触发点击。 */
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

  /** 以字符串 div 创建 ReactElement 并提交到空根；断言首个宿主节点 tagName 为 DIV，验证字符串元素类型创建对应 DOM。 */
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

  /** 给 createElement 传第三参数 child 并提交到空根；断言 div.innerHTML 为 child，验证位置参数进入 children。 */
  it('should allow children to be passed as an argument', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(React.createElement('div', null, 'child'));
    });

    const argNode = container.firstChild;
    expect(argNode.innerHTML).toBe('child');
  });

  /** props.children 为 fakechild、第三参数为 child；提交后只见 child，验证显式 children 参数覆盖 props 中的同名值。 */
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
   * 使用相同 key 创建不同根的 DOM，验证更新不会错误复用先前根中的节点。
   */
  /** 连续在不同新容器创建相同 key 的 dog/bird，并改变是否包含 dog 及其 className；最后断言 dog.className 为 bigdog，验证新根采用本次属性；这些步骤没有在同一根卸载节点。 */
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
    // 在新容器中创建同 key 的 theDog，建立独立的宿主节点。
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
    // 再建一个只有 theBird 的根，覆盖同 key 节点不再出现的场景。
    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <div>
          <div key="theBird" className="bird" />,
        </div>,
      );
    });
    // 再建包含 theDog 的根；同 key 仍应创建该根自己的节点。
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
    // 在另一个新根中给同 key 的 theDog 设置 bigdog，验证实际节点具有本次传入的 className。
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

  /** legacy 根首次 render 的 callback 分别传字符串、普通对象、Foo 实例；每次 act 都拒绝并报告非函数 callback 警告，验证挂载回调参数校验及错误描述。 */
  // @gate !disableLegacyMode
  it('throws in render() if the mount callback in legacy roots is not a function', async () => {
    spyOnDev(console, 'warn');
    spyOnDev(console, 'error');

    /** 构造带 a/b 自有属性的 Foo 实例，作为非法 legacy callback 输入以观察错误中的实例描述。 */
    function Foo() {
      this.a = 1;
      this.b = 2;
    }

    /** legacy 挂载回调校验 fixture；维护空 state 并返回 div，使失败来源限定为 callback 参数。 */
    class A extends React.Component {
      /** 空状态使 A 保持普通类组件形状；用例不触发该 state 的更新。 */
      state = {};

      /** 返回 div 作为合法挂载输出，让非函数 callback 的校验独立于 render 结果。 */
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

  /** 先在 legacy 根挂载 A，再将更新 callback 分别改为字符串、普通对象、Foo 实例；断言每次拒绝与对应警告，验证已有根的回调也必须是函数。 */
  // @gate !disableLegacyMode
  it('throws in render() if the update callback in legacy roots is not a function', async () => {
    /** 构造 a=1、b=2 的实例，作为已有 legacy 根更新时的非法 callback 参数。 */
    function Foo() {
      this.a = 1;
      this.b = 2;
    }

    /** 已挂载的 legacy 更新校验组件；返回 div，后续 render 只改变 callback 参数。 */
    class A extends React.Component {
      /** 初始化空 state；本用例不通过 setState 更新状态。 */
      state = {};

      /** 输出 div，保证已有根更新具有合法宿主结果，错误只来自 callback 类型。 */
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

    ReactDOM.render(<A />, myDiv); // 再次提交同一已挂载组件
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

    ReactDOM.render(<A />, myDiv); // 再次提交同一已挂载组件
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

  /** 先挂载一个 input 并聚焦；更新插入第二 input 时以 DOM mutator 替身使旧 input 失焦；componentDidUpdate 先见旧焦点恢复再主动聚焦新 input，最终焦点为 two、日志顺序固定，验证提交恢复先于 layout 回调且不会覆盖回调的新焦点。 */
  it('preserves focus', async () => {
    let input;
    let input2;
    /** 通过 showTwo 插入第二 input 的焦点 fixture；保存两个 DOM 引用并在更新回调中观察/改变焦点。 */
    class A extends React.Component {
      /** 按 showTwo 返回一个或两个 input；ref 保留首次非空节点，供 DOM 插入替身及 layout 回调观察。 */
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

      /** 更新后先断言旧 input 焦点已恢复，再聚焦第二 input 并记日志，供用例验证恢复逻辑与 layout 顺序。 */
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
        /** 包装 div 的 appendChild/insertBefore：插入前使旧 input blur 并记日志，随后用原 this/arguments 转发，主动制造提交期间焦点丢失。 */
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

  /** 用 focus 替身记录调用目标及其 parentNode，挂载 autoFocus input；断言目标为 INPUT 且调用时已插入 DOM，验证 autoFocus 的挂载时序；finally 恢复原型方法。 */
  it('calls focus() on autoFocus elements after they have been mounted to the DOM', async () => {
    const originalFocus = HTMLElement.prototype.focus;

    try {
      let focusedElement;
      let inputFocusedAfterMount = false;

      // 用 focus 替身记录调用目标及其 parentNode，直接验证 autoFocus 发生在节点插入之后。
      /** 替代 HTMLElement.focus，仅记录 this 与是否已挂在父节点，不执行浏览器聚焦；finally 恢复原方法。 */
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

  /** Wrapper 挂载后点击首个 div，其 onClick 再同步点击第二 div；日志各出现一次且保持先外后内，验证嵌套 dispatch 不重复执行已处理回调；finally 移除容器。 */
  it("shouldn't fire duplicate event handler while handling other nested dispatch", async () => {
    const actual = [];

    /** 提供两个可点击 div；挂载时触发第一节点，第一回调内再触发第二节点以测试同步嵌套分发。 */
    class Wrapper extends React.Component {
      /** 首个 commit 后命令式点击 ref1，让 fixture 的 click 回调同步嵌套触发 ref2。 */
      componentDidMount() {
        this.ref1.click();
      }

      /** 返回两个带 ref/onClick 的 div；首回调先记日志再点击第二节点，第二回调只记一次日志。 */
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

  /** 安装带三个空回调的 DevTools hook，再重载 React 并提交类组件；act 正常完成，验证此 hook 形状兼容提交路径；finally 删除全局 hook，本用例没有检查各回调次数。 */
  it('should not crash with devtools installed', async () => {
    try {
      global.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        /** DevTools 注入替身为空函数，提供 renderer 期望的 hook 方法形状；用例只检查提交不抛错。 */
        inject: function () {},
        /** DevTools 根提交回调替身为空函数，避免观测逻辑影响正常挂载。 */
        onCommitFiberRoot: function () {},
        /** DevTools Fiber 卸载回调替身为空函数；本用例不对卸载调用作断言。 */
        onCommitFiberUnmount: function () {},
        supportsFiber: true,
      };
      jest.resetModules();
      React = require('react');
      ReactDOM = require('react-dom');
      /** DevTools hook 场景的普通类组件，唯一输出为 div。 */
      class Component extends React.Component {
        /** 返回 div，提供最小合法提交树以隔离 DevTools hook 安装场景。 */
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

  /** 先挂载类组件保存实例，再在 DEV 的函数组件 render 内调用 findDOMNode(instance)；act 正常完成，验证该调用场景不会抛出；未断言查找返回值。 */
  it('should not crash calling findDOMNode inside a function component', async () => {
    /** 挂载后保存实例的类 fixture，供另一函数组件在 render 中调用 findDOMNode。 */
    class Component extends React.Component {
      /** 返回 div，为 findDOMNode 提供已提交宿主节点。 */
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

    /** render 时用已保存类实例调用 findDOMNode，再返回 div；DEV 用例只验证完成而不检查返回节点。 */
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

  /** 客户端 App 的 render 递归调用两层 renderToString，各层故意传错 ARIA 属性；断言五条警告的组件栈先包含相应服务端帧，再正确恢复客户端 App 帧，验证重入 renderer 的栈上下文收口。 */
  it('reports stacks with re-entrant renderToString() calls on the client', async () => {
    /** 接收 children 并包在带错误 ariaTypo3 的 span 中，供服务端重入警告定位 Child2 栈帧。 */
    function Child2(props) {
      return <span ariaTypo3="no">{props.children}</span>;
    }

    /** 在 render 内将错误 ARIA 的 blink 序列化，再传给 Child2；建立内层服务端渲染栈。 */
    function App2() {
      return (
        <Child2>
          {ReactDOMServer.renderToString(<blink ariaTypo2="no" />)}
        </Child2>
      );
    }

    /** 返回带错误 ariaTypo4 的 span，其内容来自 App2 的 renderToString，建立嵌套服务端入口。 */
    function Child() {
      return (
        <span ariaTypo4="no">{ReactDOMServer.renderToString(<App2 />)}</span>
      );
    }

    /** 在客户端函数组件执行 Child 的 renderToString，并将 HTML 字符串返回给外层 React 树。 */
    function ServerEntry() {
      return ReactDOMServer.renderToString(<Child />);
    }

    /** 返回错误 ARIA 的前后宿主和 ServerEntry；后方 font 警告验证服务端重入结束后客户端栈恢复。 */
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

  /** 以 Document 为根，phase 从 0 到 3 逐步插入/移除 html 前后与 body 内节点；逐阶段断言完整 HTML 顺序，根级宿主进入 body、meta 进入 head；unmount 清空属性和子节点，验证 singleton 容器作用域与清理。 */
  it('should render root host components into body scope when the container is a Document', async () => {
    /** phase 控制 html/head/body 前后节点的插入与移除，作为 Document 根的 singleton 作用域和顺序 fixture。 */
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

  /** 以 documentElement 为根，phase 0→3 改变 head/body 及其前后兄弟；断言普通根级 div 落入 body 且 meta 留在 head，卸载后保留空 html/head/body，验证 html 容器的宿主作用域。 */
  it('should render root host components into body scope when the container is a the <html> tag', async () => {
    /** phase 控制 head/body 及其兄弟节点，返回 Fragment 供 html 容器根验证节点最终落入 head/body。 */
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

  /** 以 document.body 为根，phase 0→3 同时改 head 的 meta 与 body 的 div；逐阶段断言目标区域和顺序，卸载保留空 head/body，验证 body 根仍可管理 document head singleton。 */
  it('should render root host components into body scope when the container is a the <body> tag', async () => {
    /** phase 控制 head 的 meta 与根级 body div；不返回 html/body 包装，供 body 容器验证 singleton 定位。 */
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

  /** 在 body 内 main 容器提交带 head 的 App，phase 0→3 更新 meta；断言 meta 始终进入 document.head、div 留在 main，并检查非法嵌套警告；unmount 清 head、留空 main，验证 singleton 定位与实际容器清理。 */
  it('should render children of <head> into the document head even when the container is inside the document body', async () => {
    /** 返回 before/after div 与受 phase 控制的 head/meta，供 main 容器验证 head singleton 与容器子节点分别归属。 */
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

  /** 以 Document 为根、Suspense 位于 html 之上；Comp 与 Message 分别持有可更换 Promise。初始 pending 显示 fallback，兑现后显示 primary；普通更新再次隐藏旧主内容，Transition 更新保留上一屏，消息兑现后更新文字；完整 outerHTML 断言验证 document singleton 的隐藏/揭示与属性恢复。 */
  it('can render a Suspense boundary above the <html> tag', async () => {
    let suspendOnNewPromise;
    let resolveCurrentPromise;
    let currentPromise;
    /** 创建新的未兑现 Promise 并保存其 resolver 到 resolveCurrentPromise；返回 Promise 供 Comp state/use 读取。 */
    function createNewPromise() {
      currentPromise = new Promise(r => {
        resolveCurrentPromise = r;
      });
      return currentPromise;
    }
    createNewPromise();
    /** state 保存当前阻塞 Promise，向外暴露切换函数；use 在 pending 时挂起，兑现后返回 null，不产生宿主节点。 */
    function Comp() {
      const [promise, setPromise] = React.useState(currentPromise);
      /** 创建新的 pending Promise 并写入 Comp state，供用例分别在普通更新和 Transition 中再次挂起。 */
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
    /** 创建消息 Promise 并保存 resolver；返回 Promise 供 Message state 持有，兑现值成为显示文本。 */
    function createNewMessage() {
      currentMessage = new Promise(r => {
        resolveCurrentMessage = r;
      });
      return currentMessage;
    }
    createNewMessage();
    resolveCurrentMessage('hello world');
    /** state 持有消息 Promise，暴露替换入口并返回 use 的兑现文本；pending 通过 Suspense 隐藏已有文档主内容。 */
    function Message() {
      const [pendingMessage, setPendingMessage] =
        React.useState(currentMessage);
      /** 创建新的消息 Promise 并更新 Message state，供用例触发普通或 Transition 消息更新。 */
      suspendOnNewMessage = () => {
        setPendingMessage(createNewMessage());
      };
      return React.use(pendingMessage);
    }

    /** 用同一 Suspense 包裹无 DOM 的 Comp 与 html 主文档，pending 时使用另一 html/body 作为 fallback。 */
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
    // Comp 的初始 Promise 阻塞主树，因此此时显示 fallback Document。
    expect(document.documentElement.outerHTML).toBe(
      '<html data-fallback=""><head></head><body data-fallback=""><div>fallback</div></body></html>',
    );

    await act(() => {
      resolveCurrentPromise();
    });
    // Comp 的初始 Promise 兑现后显示 primary Document。
    expect(document.documentElement.outerHTML).toBe(
      '<html lang="en"><head><meta itemprop="" content="primary"></head><body><div>hello world</div></body></html>',
    );

    await act(() => {
      suspendOnNewPromise();
    });
    // 普通更新给同一个 Comp 换成新的 pending Promise，Document 重新显示 fallback；已有 primary 内容暂时隐藏。
    expect(document.documentElement.outerHTML).toBe(
      '<html data-fallback=""><head><meta itemprop="" content="primary" style="display: none;"></head><body data-fallback=""><div style="display: none;">hello world</div><div>fallback</div></body></html>',
    );

    await act(() => {
      resolveCurrentPromise();
    });
    // Comp 的新 Promise 兑现后揭示同一 primary Document；清除隐藏样式后 style 属性保留为空。
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
