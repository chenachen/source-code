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
import {
  insertNodesAndExecuteScripts,
  getVisibleChildren,
} from '../test-utils/FizzTestUtils';

let JSDOM;
let React;
let Suspense;
let ViewTransition;
let ReactDOMClient;
let clientAct;
let ReactDOMFizzServer;
let Stream;
let document;
let writable;
let container;
let buffer = '';
let hasErrored = false;
let fatalError = undefined;

describe('ReactDOMFizzViewTransition', () => {
  beforeEach(() => {
    jest.resetModules();
    JSDOM = require('jsdom').JSDOM;
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    clientAct = require('internal-test-utils').act;
    ReactDOMFizzServer = require('react-dom/server');
    Stream = require('stream');

    Suspense = React.Suspense;
    ViewTransition = React.ViewTransition;

    // 测试环境
    const jsdom = new JSDOM(
      '<!DOCTYPE html><html><head></head><body><div id="container">',
      {
        runScripts: 'dangerously',
      },
    );
    document = jsdom.window.document;
    container = document.getElementById('container');
    global.window = jsdom.window;
    // Fizz runtime 使用 requestAnimationFrame，因此为 JSDOM 补上替身。
    global.requestAnimationFrame =
      /** 用 setTimeout 模拟 rAF，供 Fizz reveal runtime 调度；不模拟真实浏览器动画帧与绘制。 */
      global.window.requestAnimationFrame = cb =>
      setTimeout(cb);

    buffer = '';
    hasErrored = false;

    writable = new Stream.PassThrough();
    writable.setEncoding('utf8');
    writable.on('data', chunk => {
      buffer += chunk;
    });
    writable.on('error', error => {
      hasErrored = true;
      fatalError = error;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** 等待服务器一轮工作并处理完整缓冲片段，调用共享 helper 插节点并执行脚本，再运行定时器使流 reveal 指令落到 DOM。 */
  async function serverAct(callback) {
    await callback();
    // 等待一次事件循环的轮询。 这假设我们已经将所有东西都冲刷了。
    await new Promise(resolve => {
      setImmediate(resolve);
    });
    if (hasErrored) {
      throw fatalError;
    }
    // JSDOM 不支持流式 HTML 解析器，因此必须交给它完整片段；同时还要执行其中嵌入的脚本。到这里可假
    // 定已收到一个完整可解析的 HTML 片段。
    const bufferedContent = buffer;
    buffer = '';
    const temp = document.createElement('body');
    temp.innerHTML = bufferedContent;
    await insertNodesAndExecuteScripts(temp, container, null);
    jest.runAllTimers();
  }

  // @gate enableViewTransition
  /** SSR 渲染默认、显式 name/class、对象 default class 与嵌套 ViewTransition；可见 DOM 精确带 vt-update/name/share 注解，再同树水合，验证服务端作用域注解。 */
  it('emits annotations for view transitions', async () => {
    /** 组合默认/显式/对象类配置与嵌套 VT，比较叶主机节点的服务端注解。 */
    function App() {
      return (
        <div>
          <ViewTransition>
            <div />
          </ViewTransition>
          <ViewTransition name="foo" update="bar">
            <div />
          </ViewTransition>
          <ViewTransition update={{something: 'a', default: 'baz'}}>
            <div />
          </ViewTransition>
          <ViewTransition name="outer" update="bar" share="pair">
            <ViewTransition>
              <div />
            </ViewTransition>
          </ViewTransition>
        </div>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div vt-update="auto" />
        <div vt-name="foo" vt-update="bar" vt-share="auto" />
        <div vt-update="baz" />
        <div vt-name="outer" vt-update="auto" vt-share="pair" />
      </div>,
    );

    // 水合不应产生任何错误。
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
  });

  // @gate enableViewTransition
  /** Suspense 主内容挂起，fallback 顶层 VT 带 exit、内层仅 update；解决为 Content 后顶层改为 enter，最后水合，验证替换双方注解方向。 */
  it('emits enter/exit annotations for view transitions inside Suspense', async () => {
    let resolve;
    const promise = new Promise(r => (resolve = r));
    /** use 当前 promise，未解决时挂起、解决后返回提供的 React 内容；供控制流揭示时机。 */
    function Suspend() {
      return React.use(promise);
    }
    /** fallback 与主内容各自位于 VT 内，制造旧节点退出、新节点进入。 */
    function App() {
      const fallback = (
        <ViewTransition>
          <div>
            <ViewTransition>
              <span>Loading</span>
            </ViewTransition>
          </div>
        </ViewTransition>
      );
      return (
        <div>
          <Suspense fallback={fallback}>
            <ViewTransition>
              <Suspend />
            </ViewTransition>
          </Suspense>
        </div>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div vt-update="auto" vt-exit="auto">
          <span vt-update="auto">Loading</span>
        </div>
      </div>,
    );

    await serverAct(async () => {
      await resolve(
        <div>
          <ViewTransition>
            <span>Content</span>
          </ViewTransition>
        </div>,
      );
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div vt-update="auto" vt-enter="auto">
          <span vt-update="auto">Content</span>
        </div>
      </div>,
    );

    // 水合不应产生任何错误。
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
  });

  // @gate enableViewTransition
  /** fallback 内再嵌完整 Suspense，节点同时处于 enter 和 exit 作用域；初始有 hello/goodbye 两类，解决主内容后只 hi enter，验证同节点双方向可并存。 */
  it('can emit both enter and exit on the same node', async () => {
    let resolve;
    const promise = new Promise(r => (resolve = r));
    /** use 当前 promise，未解决时挂起、解决后返回提供的 React 内容；供控制流揭示时机。 */
    function Suspend() {
      return React.use(promise);
    }
    /** fallback 还处于一个已完成的内层边界，令其节点同时继承 enter 和 exit；主内容配置另一 enter 类。 */
    function App() {
      const fallback = (
        <Suspense fallback={null}>
          <ViewTransition enter="hello" exit="goodbye">
            <div>
              <ViewTransition>
                <span>Loading</span>
              </ViewTransition>
            </div>
          </ViewTransition>
        </Suspense>
      );
      return (
        <div>
          <Suspense fallback={fallback}>
            <ViewTransition enter="hi">
              <Suspend />
            </ViewTransition>
          </Suspense>
        </div>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div vt-update="auto" vt-enter="hello" vt-exit="goodbye">
          <span vt-update="auto">Loading</span>
        </div>
      </div>,
    );

    await serverAct(async () => {
      await resolve(
        <div>
          <ViewTransition>
            <span>Content</span>
          </ViewTransition>
        </div>,
      );
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div vt-update="auto" vt-enter="hi">
          <span vt-update="auto">Content</span>
        </div>
      </div>,
    );

    // 水合不应产生任何错误。
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
  });

  // @gate enableViewTransition
  /** ViewTransition 放在 Suspense 外，fallback 与完成内容都继承同一自动 vt-name/share；流揭示后名称保持 R_0，验证外层作用域跨替换延续。 */
  it('emits annotations for view transitions outside Suspense', async () => {
    let resolve;
    const promise = new Promise(r => (resolve = r));
    /** use 当前 promise，未解决时挂起、解决后返回提供的 React 内容；供控制流揭示时机。 */
    function Suspend() {
      return React.use(promise);
    }
    /** 将 VT 放在 Suspense 外，使 fallback 和完成树共用自动作用域名称。 */
    function App() {
      const fallback = (
        <div>
          <ViewTransition>
            <span>Loading</span>
          </ViewTransition>
        </div>
      );
      return (
        <div>
          <ViewTransition>
            <Suspense fallback={fallback}>
              <Suspend />
            </Suspense>
          </ViewTransition>
        </div>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div vt-name="_R_0_" vt-update="auto" vt-share="auto">
          <span vt-update="auto">Loading</span>
        </div>
      </div>,
    );

    await serverAct(async () => {
      await resolve(
        <div>
          <ViewTransition>
            <span>Content</span>
          </ViewTransition>
        </div>,
      );
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div vt-name="_R_0_" vt-update="auto" vt-share="auto">
          <span vt-update="auto">Content</span>
        </div>
      </div>,
    );

    // 水合不应产生任何错误。
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
  });

  // @gate enableViewTransition && enableViewTransitionParentEnterExit
  /** fallback 的退出链 A→B→C 中 B parentExit=none，另有兄弟 D opt-in；SSR 仅 D 带 nested-exit、C 无标记，验证 none 截断该分支中继。 */
  it('stops the parentExit relay when an intermediate class is "none"', async () => {
    const promise = new Promise(() => {});
    /** use 当前 promise，未解决时挂起、解决后返回提供的 React 内容；供控制流揭示时机。 */
    function Suspend() {
      return React.use(promise);
    }
    /** 构造退出中继的 none 阻断分支和不受阻兄弟分支。 */
    function App() {
      const fallback = (
        <ViewTransition exit="page-exit">
          <div id="A">
            <ViewTransition parentExit="none">
              <div id="B">
                <ViewTransition parentExit="nested-exit">
                  <div id="C">Deep</div>
                </ViewTransition>
              </div>
            </ViewTransition>
            <ViewTransition parentExit="nested-exit">
              <span id="D">Shallow</span>
            </ViewTransition>
          </div>
        </ViewTransition>
      );
      return (
        <div>
          <Suspense fallback={fallback}>
            <Suspend />
          </Suspense>
        </div>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });

    // 在包裹上存在的 "none" 停止了转发。 因此，深层子节点（C）永远不会获得 vt-parent-exit 标注。
    // 兄弟节点 (D) 没有 "none" 边界的, 仍然转发。
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div id="A" vt-update="auto" vt-exit="page-exit">
          <div id="B" vt-update="auto">
            <div id="C" vt-update="auto">
              Deep
            </div>
          </div>
          <span id="D" vt-update="auto" vt-parent-exit="nested-exit">
            Shallow
          </span>
        </div>
      </div>,
    );
  });

  // @gate enableViewTransition && enableViewTransitionParentEnterExit
  /** 异步内容入场链 B parentEnter=none、兄弟 D opt-in；流揭示后 A有 enter、D有 parent-enter、C无，再水合，验证入场中继截断。 */
  it('stops the parentEnter relay when an intermediate class is "none"', async () => {
    let resolve;
    const promise = new Promise(r => (resolve = r));
    /** use 当前 promise，未解决时挂起、解决后返回提供的 React 内容；供控制流揭示时机。 */
    function Suspend() {
      return React.use(promise);
    }
    /** 主内容完成后返回入场中继的 none 阻断与正常兄弟分支。 */
    function App() {
      return (
        <div>
          <Suspense fallback={<div>loading</div>}>
            <ViewTransition enter="page-enter">
              <Suspend />
            </ViewTransition>
          </Suspense>
        </div>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    await serverAct(async () => {
      await resolve(
        <div id="A">
          <ViewTransition parentEnter="none">
            <div id="B">
              <ViewTransition parentEnter="nested-enter">
                <div id="C">Deep</div>
              </ViewTransition>
            </div>
          </ViewTransition>
          <ViewTransition parentEnter="nested-enter">
            <span id="D">Shallow</span>
          </ViewTransition>
        </div>,
      );
    });

    // wrapper 上的 `none` 会截断传递，因此深层子节点 C 永远不会获得 `vt-parent-enter` 标注；
    // sibling D 仍会继续传递。
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div id="A" vt-update="auto" vt-enter="page-enter">
          <div id="B" vt-update="auto">
            <div id="C" vt-update="auto">
              Deep
            </div>
          </div>
          <span id="D" vt-update="auto" vt-parent-enter="nested-enter">
            Shallow
          </span>
        </div>
      </div>,
    );

    // 水合不应产生任何错误。
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
  });

  // @gate enableViewTransition
  /** 退出链中间 B 的 ViewTransition 未配置 parentExit/handler；C 即使 opt-in 也无 parent-exit，验证中间未加入中继会断链。 */
  it('breaks the parentExit relay through a ViewTransition without parentExit', async () => {
    const promise = new Promise(() => {});
    /** use 当前 promise，未解决时挂起、解决后返回提供的 React 内容；供控制流揭示时机。 */
    function Suspend() {
      return React.use(promise);
    }
    /** 在退出链中插未 opt-in 的 VT，验证深层 parentExit 不跨它继承。 */
    function App() {
      const fallback = (
        <ViewTransition exit="page-exit">
          <div id="A">
            <ViewTransition>
              <div id="B">
                <ViewTransition parentExit="nested-exit">
                  <div id="C">Deep</div>
                </ViewTransition>
              </div>
            </ViewTransition>
          </div>
        </ViewTransition>
      );
      return (
        <div>
          <Suspense fallback={fallback}>
            <Suspend />
          </Suspense>
        </div>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });

    // 与客户端运行时一致，未选择加入 parentExit 的 ViewTransition 会中断中继，因此不会标注 C。
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div id="A" vt-update="auto" vt-exit="page-exit">
          <div id="B" vt-update="auto">
            <div id="C" vt-update="auto">
              Deep
            </div>
          </div>
        </div>
      </div>,
    );
  });

  // @gate enableViewTransition && enableViewTransitionParentEnterExit
  /** 退出链 B parentExit=auto、C nested-exit；B 自身不写 parent-exit class而 C 有标记，验证 auto 仍传递中继。 */
  it('relays the parentExit chain through an "auto" parentExit', async () => {
    const promise = new Promise(() => {});
    /** use 当前 promise，未解决时挂起、解决后返回提供的 React 内容；供控制流揭示时机。 */
    function Suspend() {
      return React.use(promise);
    }
    /** 用 parentExit=auto 作为中间继承节点，保留传递但不指定自身 parent-exit class。 */
    function App() {
      const fallback = (
        <ViewTransition exit="page-exit">
          <div id="A">
            <ViewTransition parentExit="auto">
              <div id="B">
                <ViewTransition parentExit="nested-exit">
                  <div id="C">Deep</div>
                </ViewTransition>
              </div>
            </ViewTransition>
          </div>
        </ViewTransition>
      );
      return (
        <div>
          <Suspense fallback={fallback}>
            <Suspend />
          </Suspense>
        </div>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });

    // parentExit="auto" 不给自身设置 transition class，但仍向后代传递退出标记，因此 C 获得标注。
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div id="A" vt-update="auto" vt-exit="page-exit">
          <div id="B" vt-update="auto">
            <div id="C" vt-update="auto" vt-parent-exit="nested-exit">
              Deep
            </div>
          </div>
        </div>
      </div>,
    );
  });

  // @gate enableViewTransition && enableViewTransitionParentEnterExit
  /** 退出链 B 仅有 onParentExit，C 有 nested-exit；SSR B无自身 parent-exit class、C有标记，验证 handler 足以加入中继，本例不执行客户端 handler。 */
  it('relays the parentExit chain through a handler-only ViewTransition', async () => {
    const promise = new Promise(() => {});
    /** use 当前 promise，未解决时挂起、解决后返回提供的 React 内容；供控制流揭示时机。 */
    function Suspend() {
      return React.use(promise);
    }
    /** 只给中间 VT 注册 onParentExit，以 handler 的存在加入退出中继。 */
    function App() {
      const fallback = (
        <ViewTransition exit="page-exit">
          <div id="A">
            <ViewTransition onParentExit={() => {}}>
              <div id="B">
                <ViewTransition parentExit="nested-exit">
                  <div id="C">Deep</div>
                </ViewTransition>
              </div>
            </ViewTransition>
          </div>
        </ViewTransition>
      );
      return (
        <div>
          <Suspense fallback={fallback}>
            <Suspend />
          </Suspense>
        </div>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });

    // 一个仅包含 onParentExit 处理程序（无类）的视图过渡不发出注解，但仍传递。 就像客户端运行时一
    // 样， 因此，深层子元素（C）已注释。
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div id="A" vt-update="auto" vt-exit="page-exit">
          <div id="B" vt-update="auto">
            <div id="C" vt-update="auto" vt-parent-exit="nested-exit">
              Deep
            </div>
          </div>
        </div>
      </div>,
    );
  });

  // @gate enableViewTransition && enableViewTransitionParentEnterExit
  /** 入场链 B 仅有 onParentEnter，C 有 nested-enter；解决流后 C有 parent-enter，验证 handler-only 中继，不直接断言 handler 调用。 */
  it('relays the parentEnter chain through a handler-only ViewTransition', async () => {
    let resolve;
    const promise = new Promise(r => (resolve = r));
    /** use 当前 promise，未解决时挂起、解决后返回提供的 React 内容；供控制流揭示时机。 */
    function Suspend() {
      return React.use(promise);
    }
    /** 只给中间 VT 注册 onParentEnter，让完成内容的深层 class 继续继承。 */
    function App() {
      return (
        <div>
          <Suspense fallback={<div>loading</div>}>
            <ViewTransition enter="page-enter">
              <Suspend />
            </ViewTransition>
          </Suspense>
        </div>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    await serverAct(async () => {
      await resolve(
        <div id="A">
          <ViewTransition onParentEnter={() => {}}>
            <div id="B">
              <ViewTransition parentEnter="nested-enter">
                <div id="C">Deep</div>
              </ViewTransition>
            </div>
          </ViewTransition>
        </div>,
      );
    });

    // 一个只有 onParentEnter 处理器的 ViewTransition 仍然会传递。 因此，深层子元素（C）已注释。
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div id="A" vt-update="auto" vt-enter="page-enter">
          <div id="B" vt-update="auto">
            <div id="C" vt-update="auto" vt-parent-enter="nested-enter">
              Deep
            </div>
          </div>
        </div>
      </div>,
    );
  });

  // @gate enableViewTransition && enableViewTransitionParentEnterExit
  /** 模拟 startViewTransition 在调用瞬间记录具名节点 class，提供非零尺寸与已就绪 fonts；流替换时分别捕获 A/C/D 的入场与 fbA/fbC/fbD 的退出类，验证多层 parent 中继在 reveal 时应用。 */
  it('applies view-transition-name to nested parentEnter/parentExit on streaming reveal', async () => {
    // reveal 启动 View Transition 的瞬间，记录每个元素所应用的 transition class；过渡一开始名称就会还原，
    // 因此必须在这里同步读取。
    const applied = new Map();
    /** 浏览器 API 替身在 update 前扫描有 viewTransitionName 的节点并记录 class，然后同步 update；ready/finished 都已解决，不测试真实异步动画生命周期。 */
    document.startViewTransition = function (arg) {
      const update = typeof arg === 'function' ? arg : arg.update;
      container.querySelectorAll('*').forEach(el => {
        if (el.id && el.style && el.style.viewTransitionName) {
          applied.set(el.id, el.style.viewTransitionClass);
        }
      });
      if (update) {
        update();
      }
      return {
        ready: Promise.resolve(),
        finished: Promise.resolve(),
        /** 提供空 skipTransition 方法，满足 reveal runtime 的返回对象协议。 */
        skipTransition() {},
        types: [],
      };
    };
    if (!global.window.CSS) {
      global.window.CSS = {
        /** 测试环境使用恒等转义，避免缺失 CSS.escape 阻断选择器路径。 */
        escape: s => s
      };
    }
    Object.defineProperty(document, 'fonts', {
      value: {status: 'loaded', ready: Promise.resolve()},
      configurable: true,
    });
    // reveal 跳过其父元素测量为空的边界。 所以为元素提供非零的矩形。
    /** 全局几何替身返回非零矩形，使 Fizz runtime 不把待 reveal 边界视为不可见。 */
    global.window.Element.prototype.getBoundingClientRect = function () {
      return {left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20};
    };

    let resolve;
    const promise = new Promise(r => (resolve = r));
    /** use 当前 promise，未解决时挂起、解决后返回提供的 React 内容；供控制流揭示时机。 */
    function Suspend() {
      return React.use(promise);
    }
    /** 构造三层退出 fallback 与三层进入内容，验证 reveal 时跨多层应用各自 class。 */
    function App() {
      const fallback = (
        <ViewTransition exit="page-exit">
          <div id="fbA">
            <ViewTransition parentExit="skeleton-exit">
              <div id="fbC">
                <ViewTransition parentExit="skeleton-exit-deep">
                  <div id="fbD">Loading</div>
                </ViewTransition>
              </div>
            </ViewTransition>
          </div>
        </ViewTransition>
      );
      return (
        <div>
          <Suspense fallback={fallback}>
            <ViewTransition enter="page-enter">
              <Suspend />
            </ViewTransition>
          </Suspense>
        </div>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    await serverAct(async () => {
      await resolve(
        <div id="A">
          <ViewTransition parentEnter="nested-enter">
            <div id="C">
              <ViewTransition parentEnter="nested-enter-deep">
                <div id="D">Deep</div>
              </ViewTransition>
            </div>
          </ViewTransition>
        </div>,
      );
    });

    // 顶层 enter/exit 已在 reveal 时应用。新增行为是嵌套父级中继，并且可以跨越多层：中继穿过带非
    // none 类名的 C/fbC 继续到 D/fbD，与客户端运行时的 commitParentEnter/ExitViewTransitions 一致。
    expect(applied.get('A')).toBe('page-enter');
    expect(applied.get('C')).toBe('nested-enter');
    expect(applied.get('D')).toBe('nested-enter-deep');
    expect(applied.get('fbA')).toBe('page-exit');
    expect(applied.get('fbC')).toBe('skeleton-exit');
    expect(applied.get('fbD')).toBe('skeleton-exit-deep');
  });
});
