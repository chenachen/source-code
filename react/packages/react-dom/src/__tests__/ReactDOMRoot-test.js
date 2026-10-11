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

  /** 空容器createRoot后render div/Hi，再waitForAll；文字Hi，验证root.render异步工作提交。 */
  it('renders children', async () => {
    const root = ReactDOMClient.createRoot(container);
    root.render(<div>Hi</div>);
    await waitForAll([]);
    expect(container.textContent).toEqual('Hi');
  });

  /** root.render传第二参数jest callback；DEV提示不支持，工作完成后callback零次，验证额外回调被忽略。 */
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

  /** root.render传<App/>和普通对象第二参数；DEV提示只接受一参数，验证参数误用诊断；本例不等待最终DOM。 */
  it('warn if a object is passed to root.render(...)', async () => {

    /** 返回Child文字的组件，仅用于root.render第二参数普通对象诊断。 */
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

  /** root.render传<App/>和已提供容器第二参数；DEV提示不必再次传容器，验证旧render调用形式诊断。 */
  it('warn if a container is passed to root.render(...)', async () => {

    /** 返回Child文字，额外容器参数与组件实现无关。 */
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

  /** root先render再unmount(callback)；DEV提示不支持回调且callback零次，验证卸载参数校验。 */
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

  /** root提交Hi后unmount，再等待；容器文字空，验证根卸载移除子内容。 */
  it('unmounts children', async () => {
    const root = ReactDOMClient.createRoot(container);
    root.render(<div>Hi</div>);
    await waitForAll([]);
    expect(container.textContent).toEqual('Hi');
    root.unmount();
    await waitForAll([]);
    expect(container.textContent).toEqual('');
  });

  /** createRoot后从未render即在act内unmount；成功无异常，验证空根清理。 */
  it('can be immediately unmounted', async () => {
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.unmount();
    });
  });

  /** 服务端span有extra class而客户端无；createRoot模式重建无hydration诊断，hydrateRoot模式DEV给不会修属性的差异消息，验证两入口区别；本例未断言最终class值。 */
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

  /** 容器预置a/b两div，createRoot渲染c/d后更新d/c；文字cd→dc，验证首次清旧内容与后续正常更新。 */
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

  /** 把React JSX元素当createRoot容器；同步抛Target container错误，验证必须DOM节点。 */
  it('throws a good message on invalid containers', () => {
    expect(() => {
      ReactDOMClient.createRoot(<div>Hi</div>);
    }).toThrow('Target container is not a DOM element.');
  });

  /** 同容器连续createRoot两次；DEV提示复用已有root.render，验证容器根标记诊断。 */
  it('warns when creating two roots managing the same container', () => {
    ReactDOMClient.createRoot(container);
    ReactDOMClient.createRoot(container);
    assertConsoleErrorDev([
      'You are calling ReactDOMClient.createRoot() on a container that ' +
        'has already been passed to createRoot() before. Instead, call ' +
        'root.render() on the existing root instead if you want to update it.',
    ]);
  });

  /** 首根unmount后再同容器createRoot；无未消费警告，验证卸载清根标记。 */
  it('does not warn when creating second root after first one is unmounted', async () => {
    const root = ReactDOMClient.createRoot(container);
    root.unmount();
    await waitForAll([]);
    ReactDOMClient.createRoot(container); // 无警告
  });

  /** 当前createRoot(document.body)成功且无诊断，旧标题warns仅历史遗留，验证body容器可用。 */
  it('warns if creating a root on the document.body', async () => {
    // 当前允许 document.body 作为根容器；本例保留历史名称，但不期望告警。
    ReactDOMClient.createRoot(document.body);
  });

  /** 已提交Hi后外部innerHTML清空，再render同形div；当前无旧内容移除诊断。本例不等待或断言DOM修复，验证同步告警行为边界。 */
  it('warns if updating a root that has had its contents removed', async () => {
    const root = ReactDOMClient.createRoot(container);
    root.render(<div>Hi</div>);
    await waitForAll([]);
    container.innerHTML = '';

    // 外部清空 DOM 后再次传入相同元素；当前实现不发出旧的内容移除告警。
    root.render(<div>Hi</div>);
  });

  /** 同根先div后span；各act后nodeName对应，验证可更换宿主类型。 */
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

  /** 非空容器有div，再createRoot并act渲染div；无警告且仅恒真断言，验证可挂到非空容器，不证明原节点身份复用。 */
  it('should not warn if mounting into non-empty node', async () => {
    container.innerHTML = '<div></div>';
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<div />);
    });

    expect(true).toBe(true);
  });

  /** 同根两次render相同div；firstChild对象相同，验证同类型无key变化复用宿主。 */
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

  /** Component effect记录Mount/Unmount，key A orange→B green→B blue；首次Mount、换key Unmount/Mount、同key无effect日志，验证key控制重建。 */
  it('should unmount and remount if the key changes', async () => {

    /** 输出text的span并在一次性effect记Mount/清理记Unmount，通过key变化观察重建、同key更新不重复effect。 */
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

  /** 已提交div后外部清空容器再root.unmount；act拒绝NotFound删除错误，验证React记录与DOM被外部删除后的清理异常。 */
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

  /** root已提交Hi，act callback内unmount之后立即读文字为空，验证卸载同步可见而不必等act结束。 */
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

  /** 卸载root后再次render文字；同步抛Cannot update an unmounted root，验证公开root失效状态。 */
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

  /** root1 App.step1→2，其effect调用另一个空root2.unmount；flushSync触发DEV重入卸载诊断，验证React正在提交/effect期间不能完成嵌套同步卸载。 */
  it('warns if root is unmounted inside an effect', async () => {
    const container1 = document.createElement('div');
    const root1 = ReactDOMClient.createRoot(container1);
    const container2 = document.createElement('div');
    const root2 = ReactDOMClient.createRoot(container2);

    /** 按step effect在2时卸载另一个root，构造React执行effect期间的同步卸载重入。 */
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

  /** 禁用Comment容器功能时，用特定标记comment给createRoot/hydrateRoot；两入口均抛无效容器，验证构建feature对Node类型的限制。 */
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

  /** hydrateRoot只给容器不给初始children；DEV提示必须第二参数，验证显式水合初始化要求。 */
  it('warn if no children passed to hydrateRoot', async () => {
    ReactDOMClient.hydrateRoot(container);
    assertConsoleErrorDev([
      'Must provide initial children as second argument to hydrateRoot. ' +
        'Example usage: hydrateRoot(domContainer, <App />)',
    ]);
  });

  /** createRoot的options位置传<App/> JSX；DEV提示应使用root.render，验证入口职责误用。 */
  it('warn if JSX passed to createRoot', async () => {

    /** 仅返回Child，作为误传createRoot options的JSX元素类型。 */
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

  /** root.render直接传Component函数而非元素；flushSync DEV诊断函数不是合法child，验证函数值不会自动当组件执行。 */
  it('warns when given a function', () => {

    /** 普通函数组件返回div，但测试故意传函数本身给root.render，应被child类型校验拒绝。 */
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

  /** root.render(Symbol(foo))；flushSync DEV诊断symbol不是合法child，验证顶层非法类型。 */
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
