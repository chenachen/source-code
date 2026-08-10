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
    // 斯运行时间假设动画框架存在,所以我们需要填充它.
    global.requestAnimationFrame = global.window.requestAnimationFrame = cb =>
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

  /** `serverAct`：封装当前用例复用的操作、回调或断言步骤。 */
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
  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「emits annotations for view transitions」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言覆盖 react-dom 的服务端流适配层；完整 Fizz 状态机位于 react-server。
   */
  it('emits annotations for view transitions', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
  /** 测试场景：验证「emits enter/exit annotations for view transitions inside Suspense」描述的渲染、交互或错误处理结果。 */
  it('emits enter/exit annotations for view transitions inside Suspense', async () => {
    let resolve;
    const promise = new Promise(r => (resolve = r));
    /** `Suspend`：封装当前用例复用的操作、回调或断言步骤。 */
    function Suspend() {
      return React.use(promise);
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
  /** 测试场景：验证「can emit both enter and exit on the same node」描述的渲染、交互或错误处理结果。 */
  it('can emit both enter and exit on the same node', async () => {
    let resolve;
    const promise = new Promise(r => (resolve = r));
    /** `Suspend`：封装当前用例复用的操作、回调或断言步骤。 */
    function Suspend() {
      return React.use(promise);
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
  /** 测试场景：验证「emits annotations for view transitions outside Suspense」描述的渲染、交互或错误处理结果。 */
  it('emits annotations for view transitions outside Suspense', async () => {
    let resolve;
    const promise = new Promise(r => (resolve = r));
    /** `Suspend`：封装当前用例复用的操作、回调或断言步骤。 */
    function Suspend() {
      return React.use(promise);
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
  /** 测试场景：验证「stops the parentExit relay when an intermediate class is "none"」描述的渲染、交互或错误处理结果。 */
  it('stops the parentExit relay when an intermediate class is "none"', async () => {
    const promise = new Promise(() => {});
    /** `Suspend`：封装当前用例复用的操作、回调或断言步骤。 */
    function Suspend() {
      return React.use(promise);
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
  /** 测试场景：验证「stops the parentEnter relay when an intermediate class is "none"」描述的渲染、交互或错误处理结果。 */
  it('stops the parentEnter relay when an intermediate class is "none"', async () => {
    let resolve;
    const promise = new Promise(r => (resolve = r));
    /** `Suspend`：封装当前用例复用的操作、回调或断言步骤。 */
    function Suspend() {
      return React.use(promise);
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
  /** 测试场景：验证「breaks the parentExit relay through a ViewTransition without parentExit」描述的渲染、交互或错误处理结果。 */
  it('breaks the parentExit relay through a ViewTransition without parentExit', async () => {
    const promise = new Promise(() => {});
    /** `Suspend`：封装当前用例复用的操作、回调或断言步骤。 */
    function Suspend() {
      return React.use(promise);
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
  /** 测试场景：验证「relays the parentExit chain through an "auto" parentExit」描述的渲染、交互或错误处理结果。 */
  it('relays the parentExit chain through an "auto" parentExit', async () => {
    const promise = new Promise(() => {});
    /** `Suspend`：封装当前用例复用的操作、回调或断言步骤。 */
    function Suspend() {
      return React.use(promise);
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // 一个 "auto" 父子退出事件不发出自己的注解，但仍传递给子组件。 因此，深层子元素（C）已注释。
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
  /** 测试场景：验证「relays the parentExit chain through a handler-only ViewTransition」描述的渲染、交互或错误处理结果。 */
  it('relays the parentExit chain through a handler-only ViewTransition', async () => {
    const promise = new Promise(() => {});
    /** `Suspend`：封装当前用例复用的操作、回调或断言步骤。 */
    function Suspend() {
      return React.use(promise);
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
  /** 测试场景：验证「relays the parentEnter chain through a handler-only ViewTransition」描述的渲染、交互或错误处理结果。 */
  it('relays the parentEnter chain through a handler-only ViewTransition', async () => {
    let resolve;
    const promise = new Promise(r => (resolve = r));
    /** `Suspend`：封装当前用例复用的操作、回调或断言步骤。 */
    function Suspend() {
      return React.use(promise);
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
  /** 测试场景：验证「applies view-transition-name to nested parentEnter/parentExit on streaming reveal」描述的渲染、交互或错误处理结果。 */
  it('applies view-transition-name to nested parentEnter/parentExit on streaming reveal', async () => {
    // reveal 启动 View Transition 的瞬间，记录每个元素所应用的 transition class；过渡一开始名称就会还原，
    // 因此必须在这里同步读取。
    const applied = new Map();
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
        /** `skipTransition`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
    global.window.Element.prototype.getBoundingClientRect = function () {
      return {left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20};
    };

    let resolve;
    const promise = new Promise(r => (resolve = r));
    /** `Suspend`：封装当前用例复用的操作、回调或断言步骤。 */
    function Suspend() {
      return React.use(promise);
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
