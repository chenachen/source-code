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

/** 保留错误消息首个句号以前及句号，无句号则原样，用于稳定hydration恢复日志首句。 */
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

  /** 执行callback并等一次setImmediate，把PassThrough本轮buffer整体解析到JSDOM；遇流error抛原原因。SCRIPT仅复制textContent后新建执行、不复制其属性；不是通用增量HTML parser或任意异步完成等待。 */
  async function act(callback) {
    await callback();
    // 等一次setImmediate处理本例流工作；这里依赖得到可完整解析的片段，不等待任意异步任务。
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

  /** 递归创建断言用React树，过滤script/template和具有hidden/aria-hidden属性的节点、冒号id；不计算CSS，0/1/多children分别undefined/单项/数组。 */
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

  /** SSR两suppress span为Server Text/1，客户端Client Text/2；水合无恢复日志且仍服务器文字，验证抑制同层文本诊断并不修补文本。 */
  it('suppresses but does not fix text mismatches with suppressHydrationWarning', async () => {
    /** 两个同层suppress span切换文字/数字，隔离直接文本属性快路。 */
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
      /** 记录错误及可选cause的首句到Scheduler，waitForAll的预期列表决定该case是否允许恢复错误；回调本身不抛或手动修改DOM。 */
      onRecoverableError(error) {
        // 不要漏掉 hydration 错误；这里应当没有任何错误。
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll([]);
    // suppressHydrationWarning 抑制这次文本差异报告，并保留服务端文本；生产环境也不会在 hydration 时修补它。
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Server Text</span>
        <span>1</span>
      </div>,
    );
  });

  /** SSR同suppress span内两个独立Server1/2 Text，客户端Client1/2；无恢复日志且两个服务器节点内容保留，验证多直接Text差异抑制。 */
  it('suppresses but does not fix multiple text node mismatches with suppressHydrationWarning', async () => {
    /** 同span下两个独立字符串子级分别切换，测试HostText多节点。 */
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
      /** 记录错误及可选cause的首句到Scheduler，waitForAll的预期列表决定该case是否允许恢复错误；回调本身不抛或手动修改DOM。 */
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

  /** SSR Hello/Server/!文本，客户端中间变span/Client，父suppress；报告HTML错配并恢复出客户端span，验证文本→元素结构不能抑制。 */
  it('errors on text-to-element mismatches with suppressHydrationWarning', async () => {
    /** 在多个children中把中间Server文字换Client span，制造结构变化。 */
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
      /** 记录错误及可选cause的首句到Scheduler，waitForAll的预期列表决定该case是否允许恢复错误；回调本身不抛或手动修改DOM。 */
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

  /** SSR suppress span无text，客户端Client单文本；水合无日志且仍空，随后root.render Client 2才写文字，验证textContent快路的新增文字抑制与后续正常更新。 */
  it('suppresses but does not fix client-only single text node mismatches with suppressHydrationWarning', async () => {
    /** text prop可从null变Client及Client 2，展示水合抑制与后续正常更新不同。 */
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
      /** 记录错误及可选cause的首句到Scheduler，waitForAll的预期列表决定该case是否允许恢复错误；回调本身不抛或手动修改DOM。 */
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

  /** SSR suppress span单Server文本，客户端null；报告HTML错配并变空，验证服务端多余单Text仍算结构，不对称于客户端单text快路。 */
  it('errors on server-only single text node mismatches with suppressHydrationWarning', async () => {
    /** isClient时删掉唯一Server Text，测试服务器多余文本结构。 */
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
      /** 记录错误及可选cause的首句到Scheduler，waitForAll的预期列表决定该case是否允许恢复错误；回调本身不抛或手动修改DOM。 */
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

  /** SSR suppress span内已有Shared子span，客户端另加Client Text；报告HTML错配并恢复Shared+Client，验证真实子级额外Text不能抑制。 */
  it('errors on client-only extra text node mismatches with suppressHydrationWarning', async () => {
    /** 已有Shared span后仅客户端增加Text，迫使走多子级认领。 */
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
      /** 记录错误及可选cause的首句到Scheduler，waitForAll的预期列表决定该case是否允许恢复错误；回调本身不抛或手动修改DOM。 */
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

  /** SSR Shared子span加Server Text，客户端只Shared；报告并删除Server，验证真实子级额外服务器Text结构差异。 */
  it('errors on server-only extra text node mismatches with suppressHydrationWarning', async () => {
    /** 已有Shared span后仅服务端含Server Text，测试服务器多余子节点。 */
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
      /** 记录错误及可选cause的首句到Scheduler，waitForAll的预期列表决定该case是否允许恢复错误；回调本身不抛或手动修改DOM。 */
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

  /** SSR Hello/span Server/!，客户端中间文字Client；报告并恢复三个文本片段，验证元素→文本结构变化不能抑制。 */
  it('errors on element-to-text mismatches with suppressHydrationWarning', async () => {
    /** 多个children中把服务器span换客户端文字，验证结构不能豁免。 */
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
      /** 记录错误及可选cause的首句到Scheduler，waitForAll的预期列表决定该case是否允许恢复错误；回调本身不抛或手动修改DOM。 */
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

  /** SSR suppress span有server class、opacity0、server-only data，客户端另一组属性；无恢复日志且所有服务器属性保留，验证仅抑制告警而不补属性。 */
  it('suppresses but does not fix attribute mismatches with suppressHydrationWarning', async () => {
    /** 切换class/style及data属性，hydration抑制后仍不主动修补。 */
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
      /** 记录错误及可选cause的首句到Scheduler，waitForAll的预期列表决定该case是否允许恢复错误；回调本身不抛或手动修改DOM。 */
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

  /** SSR suppress p rawHTML为Server HTML，客户端Client HTML；无恢复日志且原服务器HTML保持，验证innerHTML差异抑制。 */
  it('suppresses and does not fix html mismatches with suppressHydrationWarning', async () => {
    /** 切换rawHTML Server/Client，测试dangerouslySetInnerHTML差异。 */
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
      /** 记录错误及可选cause的首句到Scheduler，waitForAll的预期列表决定该case是否允许恢复错误；回调本身不抛或手动修改DOM。 */
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

  /** SSR suppress父div只有Shared p，客户端新增Client only p；报告并恢复两p，验证元素插入不是可抑制属性/文字差异。 */
  it('errors on insertions with suppressHydrationWarning', async () => {
    /** 客户端增加第二p元素，suppress只在父层，结构须恢复。 */
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
      /** 记录错误及可选cause的首句到Scheduler，waitForAll的预期列表决定该case是否允许恢复错误；回调本身不抛或手动修改DOM。 */
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

  /** SSR suppress父div有Shared及Server only p，客户端删后者；报告并恢复单p，验证元素删除不能抑制。 */
  it('errors on deletions with suppressHydrationWarning', async () => {
    /** 服务器多第二p元素，客户端删掉，验证结构恢复。 */
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
      /** 记录错误及可选cause的首句到Scheduler，waitForAll的预期列表决定该case是否允许恢复错误；回调本身不抛或手动修改DOM。 */
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
