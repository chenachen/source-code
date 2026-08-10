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

let JSDOM;
let Stream;
let Scheduler;
let React;
let ReactDOMClient;
let ReactDOMFizzServer;
let document;
let writable;
let container;
let buffer = '';
let hasErrored = false;
let fatalError = undefined;
let waitForAll;

/** `normalizeError`：封装当前用例复用的操作、回调或断言步骤。 */
function normalizeError(msg) {
  // 将第一个句子作为基础，以便更容易地进行断言。
  const idx = msg.indexOf('.');
  if (idx > -1) {
    return msg.slice(0, idx + 1);
  }
  return msg;
}

describe('ReactDOMFizzServerHydrationWarning', () => {
  beforeEach(() => {
    jest.resetModules();
    JSDOM = require('jsdom').JSDOM;
    Scheduler = require('scheduler');
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ReactDOMFizzServer = require('react-dom/server');
    Stream = require('stream');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;

    // 测试环境
    const jsdom = new JSDOM(
      '<!DOCTYPE html><html><head></head><body><div id="container">',
      {
        runScripts: 'dangerously',
      },
    );
    document = jsdom.window.document;
    container = document.getElementById('container');

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

  /** `act`：封装当前用例复用的操作、回调或断言步骤。 */
  async function act(callback) {
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
    const fakeBody = document.createElement('body');
    fakeBody.innerHTML = bufferedContent;
    while (fakeBody.firstChild) {
      const node = fakeBody.firstChild;
      if (node.nodeName === 'SCRIPT') {
        const script = document.createElement('script');
        script.textContent = node.textContent;
        fakeBody.removeChild(node);
        container.appendChild(script);
      } else {
        container.appendChild(node);
      }
    }
  }

  /** `getVisibleChildren`：封装当前用例复用的操作、回调或断言步骤。 */
  function getVisibleChildren(element) {
    const children = [];
    let node = element.firstChild;
    while (node) {
      if (node.nodeType === 1) {
        if (
          node.tagName !== 'SCRIPT' &&
          node.tagName !== 'TEMPLATE' &&
          node.tagName !== 'template' &&
          !node.hasAttribute('hidden') &&
          !node.hasAttribute('aria-hidden')
        ) {
          const props = {};
          const attributes = node.attributes;
          for (let i = 0; i < attributes.length; i++) {
            if (
              attributes[i].name === 'id' &&
              attributes[i].value.includes(':')
            ) {
              // 我们假设这是一个 React 的唯一标识符，是一个非视觉实现细节。
              continue;
            }
            props[attributes[i].name] = attributes[i].value;
          }
          props.children = getVisibleChildren(node);
          children.push(React.createElement(node.tagName.toLowerCase(), props));
        }
      } else if (node.nodeType === 3) {
        children.push(node.data);
      }
      node = node.nextSibling;
    }
    return children.length === 0
      ? undefined
      : children.length === 1
        ? children[0]
        : children;
  }

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「suppresses but does not fix text mismatches with suppressHydrationWarning」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言对应 ReactDOMRoot.hydrateRoot 的容器认领与事件重放路径。
   */
  it('suppresses but does not fix text mismatches with suppressHydrationWarning', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({isClient}) {
      return (
        <div>
          <span suppressHydrationWarning={true}>
            {isClient ? 'Client Text' : 'Server Text'}
          </span>
          <span suppressHydrationWarning={true}>{isClient ? 2 : 1}</span>
        </div>
      );
    }
    await act(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <App isClient={false} />,
      );
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Server Text</span>
        <span>1</span>
      </div>,
    );
    ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        // 不要漏掉 hydration 错误；这里应当没有任何错误。
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll([]);
    // 文本不匹配应被静默修复，生产环境也一样。
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Server Text</span>
        <span>1</span>
      </div>,
    );
  });

  /** 测试场景：验证「suppresses but does not fix multiple text node mismatches with suppressHydrationWarning」描述的渲染、交互或错误处理结果。 */
  it('suppresses but does not fix multiple text node mismatches with suppressHydrationWarning', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({isClient}) {
      return (
        <div>
          <span suppressHydrationWarning={true}>
            {isClient ? 'Client1' : 'Server1'}
            {isClient ? 'Client2' : 'Server2'}
          </span>
        </div>
      );
    }
    await act(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <App isClient={false} />,
      );
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>
          {'Server1'}
          {'Server2'}
        </span>
      </div>,
    );
    ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>
          {'Server1'}
          {'Server2'}
        </span>
      </div>,
    );
  });

  /** 测试场景：验证「errors on text-to-element mismatches with suppressHydrationWarning」描述的渲染、交互或错误处理结果。 */
  it('errors on text-to-element mismatches with suppressHydrationWarning', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({isClient}) {
      return (
        <div>
          <span suppressHydrationWarning={true}>
            Hello, {isClient ? <span>Client</span> : 'Server'}!
          </span>
        </div>
      );
    }
    await act(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <App isClient={false} />,
      );
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>
          {'Hello, '}
          {'Server'}
          {'!'}
        </span>
      </div>,
    );
    ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll([
      "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
    ]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>
          Hello, <span>Client</span>!
        </span>
      </div>,
    );
  });

  /** 测试场景：验证「suppresses but does not fix client-only single text node mismatches with suppressHydrationWarning」描述的渲染、交互或错误处理结果。 */
  it('suppresses but does not fix client-only single text node mismatches with suppressHydrationWarning', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({text}) {
      return (
        <div>
          <span suppressHydrationWarning={true}>{text}</span>
        </div>
      );
    }
    await act(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <App text={null} />,
      );
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span />
      </div>,
    );
    const root = ReactDOMClient.hydrateRoot(container, <App text="Client" />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span />
      </div>,
    );
    // 不过，后续更新会修复它。
    root.render(<App text="Client 2" />);
    await waitForAll([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Client 2</span>
      </div>,
    );
  });

  // TODO：该行为与仅客户端渲染的单文本节点不一致。

  /** 测试场景：验证「errors on server-only single text node mismatches with suppressHydrationWarning」描述的渲染、交互或错误处理结果。 */
  it('errors on server-only single text node mismatches with suppressHydrationWarning', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({isClient}) {
      return (
        <div>
          <span suppressHydrationWarning={true}>
            {isClient ? null : 'Server'}
          </span>
        </div>
      );
    }
    await act(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <App isClient={false} />,
      );
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Server</span>
      </div>,
    );
    ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll([
      "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
    ]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span />
      </div>,
    );
  });

  /** 测试场景：验证「errors on client-only extra text node mismatches with suppressHydrationWarning」描述的渲染、交互或错误处理结果。 */
  it('errors on client-only extra text node mismatches with suppressHydrationWarning', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({isClient}) {
      return (
        <div>
          <span suppressHydrationWarning={true}>
            <span>Shared</span>
            {isClient ? 'Client' : null}
          </span>
        </div>
      );
    }
    await act(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <App isClient={false} />,
      );
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>
          <span>Shared</span>
        </span>
      </div>,
    );
    ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll([
      "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
    ]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>
          <span>Shared</span>
          {'Client'}
        </span>
      </div>,
    );
  });

  /** 测试场景：验证「errors on server-only extra text node mismatches with suppressHydrationWarning」描述的渲染、交互或错误处理结果。 */
  it('errors on server-only extra text node mismatches with suppressHydrationWarning', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({isClient}) {
      return (
        <div>
          <span suppressHydrationWarning={true}>
            <span>Shared</span>
            {isClient ? null : 'Server'}
          </span>
        </div>
      );
    }
    await act(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <App isClient={false} />,
      );
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>
          <span>Shared</span>Server
        </span>
      </div>,
    );
    ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll([
      "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
    ]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>
          <span>Shared</span>
        </span>
      </div>,
    );
  });

  /** 测试场景：验证「errors on element-to-text mismatches with suppressHydrationWarning」描述的渲染、交互或错误处理结果。 */
  it('errors on element-to-text mismatches with suppressHydrationWarning', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({isClient}) {
      return (
        <div>
          <span suppressHydrationWarning={true}>
            Hello, {isClient ? 'Client' : <span>Server</span>}!
          </span>
        </div>
      );
    }
    await act(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <App isClient={false} />,
      );
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>
          Hello, <span>Server</span>!
        </span>
      </div>,
    );
    ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll([
      "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
    ]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>
          {'Hello, '}
          {'Client'}
          {'!'}
        </span>
      </div>,
    );
  });

  /** 测试场景：验证「suppresses but does not fix attribute mismatches with suppressHydrationWarning」描述的渲染、交互或错误处理结果。 */
  it('suppresses but does not fix attribute mismatches with suppressHydrationWarning', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({isClient}) {
      return (
        <div>
          <span
            suppressHydrationWarning={true}
            className={isClient ? 'client' : 'server'}
            style={{opacity: isClient ? 1 : 0}}
            data-serveronly={isClient ? null : 'server-only'}
            data-clientonly={isClient ? 'client-only' : null}
          />
        </div>
      );
    }
    await act(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <App isClient={false} />,
      );
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span class="server" style="opacity:0" data-serveronly="server-only" />
      </div>,
    );
    ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span class="server" style="opacity:0" data-serveronly="server-only" />
      </div>,
    );
  });

  /** 测试场景：验证「suppresses and does not fix html mismatches with suppressHydrationWarning」描述的渲染、交互或错误处理结果。 */
  it('suppresses and does not fix html mismatches with suppressHydrationWarning', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({isClient}) {
      return (
        <div>
          <p
            suppressHydrationWarning={true}
            dangerouslySetInnerHTML={{
              __html: isClient ? 'Client HTML' : 'Server HTML',
            }}
          />
        </div>
      );
    }
    await act(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <App isClient={false} />,
      );
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>Server HTML</p>
      </div>,
    );
    ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>Server HTML</p>
      </div>,
    );
  });

  /** 测试场景：验证「errors on insertions with suppressHydrationWarning」描述的渲染、交互或错误处理结果。 */
  it('errors on insertions with suppressHydrationWarning', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({isClient}) {
      return (
        <div suppressHydrationWarning={true}>
          <p>Client and server</p>
          {isClient && <p>Client only</p>}
        </div>
      );
    }
    await act(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <App isClient={false} />,
      );
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>Client and server</p>
      </div>,
    );
    ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll([
      "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
    ]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>Client and server</p>
        <p>Client only</p>
      </div>,
    );
  });

  /** 测试场景：验证「errors on deletions with suppressHydrationWarning」描述的渲染、交互或错误处理结果。 */
  it('errors on deletions with suppressHydrationWarning', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({isClient}) {
      return (
        <div suppressHydrationWarning={true}>
          <p>Client and server</p>
          {!isClient && <p>Server only</p>}
        </div>
      );
    }
    await act(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <App isClient={false} />,
      );
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>Client and server</p>
        <p>Server only</p>
      </div>,
    );
    ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll([
      "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
    ]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>Client and server</p>
      </div>,
    );
  });
});
