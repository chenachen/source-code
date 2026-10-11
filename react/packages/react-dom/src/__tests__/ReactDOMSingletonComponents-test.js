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
let React;
let ReactDOM;
let ReactDOMClient;
let ReactDOMFizzServer;
let document;
let writable;
let container;
let buffer = '';
let hasErrored = false;
let fatalError = undefined;
let waitForAll;
let assertConsoleErrorDev;

/**
 * 截取错误消息的首句（含第一个句点）；没有句点时原样返回，屏蔽恢复错误后面的建议段落以稳定具体首句断言。
 * @param msg - 待规范化的错误 message。
 * @returns 首句或原字符串。
 */
function normalizeError(msg) {
  // 将第一个句子作为基础，以便更容易地进行断言。
  const idx = msg.indexOf('.');
  if (idx > -1) {
    return msg.slice(0, idx + 1);
  }
  return msg;
}

describe('ReactDOM HostSingleton', () => {
  beforeEach(() => {
    jest.resetModules();
    JSDOM = require('jsdom').JSDOM;
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ReactDOMFizzServer = require('react-dom/server');
    Stream = require('stream');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;

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

  /**
   * 执行提供的服务端动作并等待一次 setImmediate，使本测试预期已完成的流数据进入 buffer；流错误由 hasErrored/fatalError 转为拒绝。取走并清空 buffer，再以允许脚本执行的新 JSDOM 重建局部 document/container，不负责等待无限挂起的流。
   * @param callback - 启动服务端渲染并 pipe 到 writable 的动作，可返回 Promise。
   * @returns 文档替换完成的 Promise，无结果值；callback 或流失败时拒绝。
   */
  async function actIntoEmptyDocument(callback) {
    await callback();
    // 等待一次事件循环的轮询。 这假设我们已经将所有东西都冲刷了。
    await new Promise(resolve => {
      setImmediate(resolve);
    });
    if (hasErrored) {
      throw fatalError;
    }

    const bufferedContent = buffer;
    buffer = '';

    const jsdom = new JSDOM(bufferedContent, {
      runScripts: 'dangerously',
    });
    document = jsdom.window.document;
    container = document;
  }

  /**
   * 递归把 DOM 转为可见 React 元素/文本，保留属性字符串；过滤脚本、模板、hidden/aria-hidden 与 rel=expect 且 blocking=render 的提示，data-meaningful 可越过过滤。含冒号的 id 作为生成标识省略；这份结构比较不代替另行进行的节点引用断言。
   * @param element - 要遍历子节点的 DOM 节点。
   * @returns 无子节点为 undefined，一个为单值，多个为数组。
   */
  function getVisibleChildren(element) {
    const children = [];
    let node = element.firstChild;
    while (node) {
      if (node.nodeType === 1) {
        const el: Element = (node: any);
        if (
          (el.tagName !== 'SCRIPT' &&
            el.tagName !== 'TEMPLATE' &&
            el.tagName !== 'template' &&
            !el.hasAttribute('hidden') &&
            !el.hasAttribute('aria-hidden') &&
            // 过滤 rel=expect 且 blocking=render 的渲染完成提示。
            (node.getAttribute('rel') !== 'expect' ||
              node.getAttribute('blocking') !== 'render')) ||
          el.hasAttribute('data-meaningful')
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

  /** Given：document 已渲染一个 en head；When：同时渲染 en/es 两个 head，再改成单独 fr 和 en head；Then：DEV 报重复挂载；共用 head 的 lang/data-foo 来自 es，含 Hola/Hello；回到单实例后分别只剩 Bonjour 或 Hello。目的：显示同一文档 singleton 被两个组件争用的结果与告警。 */
  it('warns if you render the same singleton twice at the same time', async () => {
    const root = ReactDOMClient.createRoot(document);
    root.render(
      <html>
        <head lang="en">
          <title>Hello</title>
        </head>
        <body />
      </html>,
    );
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head lang="en">
          <title>Hello</title>
        </head>
        <body />
      </html>,
    );
    root.render(
      <html>
        <head lang="en">
          <title>Hello</title>
        </head>
        <head lang="es" data-foo="foo">
          <title>Hola</title>
        </head>
        <body />
      </html>,
    );
    await waitForAll([]);
    assertConsoleErrorDev([
      'You are mounting a new head component when a previous one has not first unmounted. ' +
        'It is an error to render more than one head component at a time and attributes and ' +
        'children of these components will likely fail in unpredictable ways. ' +
        'Please only render a single instance of <head> and if you need to mount a new one, ' +
        'ensure any previous ones have unmounted first.\n' +
        '    in head (at **)',
    ]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head lang="es" data-foo="foo">
          <title>Hola</title>
          <title>Hello</title>
        </head>
        <body />
      </html>,
    );

    root.render(
      <html>
        {null}
        {null}
        <head lang="fr">
          <title>Bonjour</title>
        </head>
        <body />
      </html>,
    );
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head lang="fr">
          <title>Bonjour</title>
        </head>
        <body />
      </html>,
    );

    root.render(
      <html>
        <head lang="en">
          <title>Hello</title>
        </head>
        <body />
      </html>,
    );
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head lang="en">
          <title>Hello</title>
        </head>
        <body />
      </html>,
    );
  });

  /** Given：body 有 React 属性、红色 style、受管 HTML 与点击属性；第三方另加属性、蓝色背景和 onclick；When：root 改渲染为仅 html；Then：head/body 引用保留；React onclick、属性、红色 style 与 HTML 清掉，第三方 onclick/data-external/蓝背景保留。目的：验证释放 singleton 只移除 React 管理的状态。 */
  it('resets property-backed state when a singleton is released', async () => {
    const root = ReactDOMClient.createRoot(document);
    const head = document.head;
    const body = document.body;

    root.render(
      <html>
        <head onClick={() => {}} />
        <body
          data-react-owned="true"
          onClick={() => {}}
          style={{color: 'red'}}
          dangerouslySetInnerHTML={{__html: '<div>managed content</div>'}}
        />
      </html>,
    );
    await waitForAll([]);

    expect(document.body).toBe(body);
    expect(head.onclick).not.toBe(null);
    expect(body.onclick).not.toBe(null);
    expect(body.textContent).toBe('managed content');
    expect(body.getAttribute('data-react-owned')).toBe('true');
    expect(body.style.color).toBe('red');

    // 模拟内联脚本或第三方代码在 React 管理该 singleton 时添加自己的属性、样式和点击监听器。
    const externalClickHandler = jest.fn();
    body.setAttribute('data-external', 'true');
    body.style.backgroundColor = 'blue';
    body.onclick = externalClickHandler;

    root.render(<html />);
    await waitForAll([]);

    expect(document.head).toBe(head);
    expect(document.body).toBe(body);
    expect(head.onclick).toBe(null);
    expect(body.onclick).toBe(externalClickHandler);
    expect(body.textContent).toBe('');
    expect(body.hasAttribute('data-react-owned')).toBe(false);
    expect(body.getAttribute('data-external')).toBe('true');
    expect(body.style.color).toBe('');
    expect(body.style.backgroundColor).toBe('blue');
  });
  /** Given：TODO 门控当前为 false；定义中 body 已有受管 HTML；When：把整个 dangerouslySetInnerHTML prop 改为 undefined；Then：定义的预期为 body.textContent 变空；当前门控不执行该用例。目的：记录待实现的 HTML prop 清理行为。 */

  // @gate TODO

  it('clears dangerouslySetInnerHTML when it becomes undefined', async () => {
    const root = ReactDOMClient.createRoot(document);
    const body = document.body;
    const undefinedHTML = undefined;

    root.render(
      <html>
        <head />
        <body
          dangerouslySetInnerHTML={{__html: '<div>managed content</div>'}}
        />
      </html>,
    );
    await waitForAll([]);
    expect(body.textContent).toBe('managed content');

    root.render(
      <html>
        <head />
        <body dangerouslySetInnerHTML={undefinedHTML} />
      </html>,
    );
    await waitForAll([]);

    expect(body.textContent).toBe('');
  });
  /** Given：TODO 门控当前为 false；body 已有受管 HTML；When：保留 dangerouslySetInnerHTML 对象但把 __html 改为 undefined；Then：定义的预期为正文清空；当前门控不执行。目的：记录待实现的内部 HTML 值清理行为。 */

  // @gate TODO

  it('clears dangerouslySetInnerHTML when __html becomes undefined', async () => {
    const root = ReactDOMClient.createRoot(document);
    const body = document.body;

    root.render(
      <html>
        <head />
        <body
          dangerouslySetInnerHTML={{__html: '<div>managed content</div>'}}
        />
      </html>,
    );
    await waitForAll([]);
    expect(body.textContent).toBe('managed content');

    root.render(
      <html>
        <head />
        <body dangerouslySetInnerHTML={{__html: undefined}} />
      </html>,
    );
    await waitForAll([]);

    expect(body.textContent).toBe('');
  });

  /** Given：body 已渲染 <div>first</div>；When：把 HTML prop 改为 <span>second</span>；Then：body.innerHTML 精确替换为第二段 HTML。目的：验证 singleton 的受管 HTML 可更新。 */
  it('updates dangerouslySetInnerHTML on a singleton', async () => {
    const root = ReactDOMClient.createRoot(document);
    const body = document.body;

    root.render(
      <html>
        <head />
        <body dangerouslySetInnerHTML={{__html: '<div>first</div>'}} />
      </html>,
    );
    await waitForAll([]);
    expect(body.innerHTML).toBe('<div>first</div>');

    root.render(
      <html>
        <head />
        <body dangerouslySetInnerHTML={{__html: '<span>second</span>'}} />
      </html>,
    );
    await waitForAll([]);

    expect(body.innerHTML).toBe('<span>second</span>');
  });

  /** Given：body 先渲染普通 div 子节点；When：改用 dangerouslySetInnerHTML 的 span managed HTML；Then：innerHTML 从 div managed child 变为 span managed HTML。目的：验证普通子节点可以切换为受管 HTML。 */
  it('replaces singleton children with dangerouslySetInnerHTML', async () => {
    const root = ReactDOMClient.createRoot(document);
    const body = document.body;

    root.render(
      <html>
        <head />
        <body>
          <div>managed child</div>
        </body>
      </html>,
    );
    await waitForAll([]);
    expect(body.innerHTML).toBe('<div>managed child</div>');

    root.render(
      <html>
        <head />
        <body dangerouslySetInnerHTML={{__html: '<span>managed HTML</span>'}} />
      </html>,
    );
    await waitForAll([]);

    expect(body.innerHTML).toBe('<span>managed HTML</span>');
  });
  /** Given：TODO 门控当前为 false；body 先有受管 div HTML；When：改为普通 span 子节点；Then：定义预期为仅 <span>managed child</span>；当前门控不执行。目的：记录从受管 HTML 切换回普通子节点的目标。 */

  // @gate TODO

  it('replaces dangerouslySetInnerHTML with singleton children', async () => {
    const root = ReactDOMClient.createRoot(document);
    const body = document.body;

    root.render(
      <html>
        <head />
        <body
          dangerouslySetInnerHTML={{__html: '<div>managed content</div>'}}
        />
      </html>,
    );
    await waitForAll([]);
    expect(body.innerHTML).toBe('<div>managed content</div>');

    root.render(
      <html>
        <head />
        <body>
          <span>managed child</span>
        </body>
      </html>,
    );
    await waitForAll([]);

    expect(body.innerHTML).toBe('<span>managed child</span>');
  });
  /** Given：TODO 门控当前为 false；第三方已在 body 设置 data-external；When：createRoot(document) 获取并渲染空 body；Then：定义预期为 body 引用和外部属性保留；当前门控不执行。目的：记录获取 singleton 时保留第三方属性的目标。 */

  // @gate TODO

  it('preserves imperative attributes when acquiring a singleton', async () => {
    const body = document.body;
    body.setAttribute('data-external', 'true');

    const root = ReactDOMClient.createRoot(document);
    root.render(
      <html>
        <head />
        <body />
      </html>,
    );
    await waitForAll([]);

    expect(document.body).toBe(body);
    expect(body.getAttribute('data-external')).toBe('true');
  });
  /** Given：TODO 门控当前为 false；body 已有外部属性和已完成边界的 body contribution 标记；When：hydrateRoot 用 span client 替换边界内 server div，并忽略恢复错误；Then：定义预期为正文 client 且 data-external 保留；当前门控不执行。目的：记录清除 preamble contribution 时保留外部属性的目标。 */

  // @gate TODO

  it('preserves imperative attributes when clearing a preamble contribution', async () => {
    const body = document.body;
    body.setAttribute('data-react-owned', 'true');
    body.setAttribute('data-external', 'true');
    // 这是已完成的 Suspense boundary 向 body singleton 提供属性时 Fizz 输出的结构。
    body.innerHTML = '<!--$--><!--body--><div>server</div><!--/$-->';

    ReactDOMClient.hydrateRoot(
      document,
      <html>
        <head />
        <body data-react-owned="true" suppressHydrationWarning={true}>
          <React.Suspense fallback={null}>
            <span>client</span>
          </React.Suspense>
        </body>
      </html>,
      {

        /**
         * 忽略 preamble contribution 不匹配时的预期恢复错误；该 TODO 门控用例只定义正文和外部属性断言，未记录错误数组。
         * @returns undefined。
         */
        onRecoverableError() {},
      },
    );
    await waitForAll([]);

    expect(body.textContent).toBe('client');
    expect(body.getAttribute('data-external')).toBe('true');
  });

  /** Given：同一个 body 的 onScroll mock 已挂载；When：依次派发 scroll、移除 body 组件再派发、重新获取 body 再派发；Then：累计调用次数为 1、1、2，重新获取后 document.body 仍为原 body。目的：验证释放与重新获取不会复制原生监听器。 */
  it('does not duplicate native listeners when a singleton is reacquired', async () => {
    const root = ReactDOMClient.createRoot(document);
    const body = document.body;
    const onScroll = jest.fn();

    root.render(
      <html>
        <head />
        <body onScroll={onScroll} />
      </html>,
    );
    await waitForAll([]);

    body.dispatchEvent(new document.defaultView.Event('scroll'));
    expect(onScroll).toHaveBeenCalledTimes(1);

    root.render(
      <html>
        <head />
      </html>,
    );
    await waitForAll([]);

    body.dispatchEvent(new document.defaultView.Event('scroll'));
    expect(onScroll).toHaveBeenCalledTimes(1);

    root.render(
      <html>
        <head />
        <body onScroll={onScroll} />
      </html>,
    );
    await waitForAll([]);

    expect(document.body).toBe(body);
    body.dispatchEvent(new document.defaultView.Event('scroll'));
    expect(onScroll).toHaveBeenCalledTimes(2);
  });
  /** Given：DEV 门控，Fizz 输出匹配 head meta 和 body 的受管 managed 元素；When：StrictMode hydrateRoot 挂载带 layout effect 的 Effect；Then：effectLog 为 mount/unmount/mount，managed 元素与服务端节点为同一对象。目的：验证 effect 重放执行时不会释放 singleton 导致受管节点丢失。 */

  // @gate __DEV__

  it('does not release or reacquire singletons when double invoking effects during hydration', async () => {
    const effectLog = [];
    const html = '<span id="managed">managed content</span>';

    /**
     * 注册 layout effect，把挂载和清理写入 effectLog，并返回与服务端匹配的 meta；StrictMode 用其 mount/unmount/mount 日志确认 effect 重放确实发生。
     * @returns strict-effect meta 元素；effect 返回记录 unmount 的清理函数。
     */
    function Effect() {
      React.useLayoutEffect(() => {
        effectLog.push('mount');
        return () => {
          effectLog.push('unmount');
        };
      }, []);
      return <meta name="strict-effect" />;
    }

    await actIntoEmptyDocument(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <html>
          <head>
            <meta name="strict-effect" />
          </head>
          <body dangerouslySetInnerHTML={{__html: html}} />
        </html>,
      );
      pipe(writable);
    });
    const serverBodyHTML = document.body.innerHTML;
    const managedElement = document.getElementById('managed');

    ReactDOMClient.hydrateRoot(
      document,
      <React.StrictMode>
        <html>
          <head>
            <Effect />
          </head>
          <body dangerouslySetInnerHTML={{__html: serverBodyHTML}} />
        </html>
      </React.StrictMode>,
    );
    await waitForAll([]);

    // Strict Mode 下的 Effect 仍会执行两轮挂载检查。
    expect(effectLog).toEqual(['mount', 'unmount', 'mount']);
    // 对匹配的树进行 hydration 时，应保留服务器渲染的节点。
    expect(document.getElementById('managed')).toBe(managedElement);
  });

  /** Given：Fizz 文档含三个样式表、内嵌 style 与正文，保存 html/head/body 引用；When：客户端替换、增删子节点、移除 body、卸载，再分别对不匹配和内容匹配的树 hydration；Then：每阶段三节点数组保持相等；外部样式留存；不匹配 hydrationErrors 精确含一个首句及 at div；后轮属性差异发 DEV 告警、link/style 引用保留，最终卸载已匹配样式内容后 head/body 为空。目的：区分持久节点身份、非受管资源保留与已被 hydration 接管资源的清理；后轮空错误数组检查发生在 flush 前。 */
  it('renders into html, head, and body persistently so the node identities never change and extraneous styles are retained', async () => {
    // 服务器渲染一些 HTML，这些 HTML 将被客户端渲染替换。
    await actIntoEmptyDocument(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <html data-foo="foo">
          <head data-bar="bar">
            <link rel="stylesheet" href="resource" />
            <title>a server title</title>
            <link rel="stylesheet" href="3rdparty" />
            <link rel="stylesheet" href="3rdparty2" />
          </head>
          <body data-baz="baz">
            <div>hello world</div>
            <style>
              {`
                body: {
                  background-color: red;
                }`}
            </style>
            <div>goodbye</div>
          </body>
        </html>,
      );
      pipe(writable);
    });
    expect(getVisibleChildren(document)).toEqual(
      <html data-foo="foo">
        <head data-bar="bar">
          <title>a server title</title>
          <link rel="stylesheet" href="resource" />
          <link rel="stylesheet" href="3rdparty" />
          <link rel="stylesheet" href="3rdparty2" />
        </head>
        <body data-baz="baz">
          <div>hello world</div>
          <style>
            {`
                body: {
                  background-color: red;
                }`}
          </style>
          <div>goodbye</div>
        </body>
      </html>,
    );
    const {documentElement, head, body} = document;
    const persistentElements = [documentElement, head, body];

    // 向 document 渲染完全不同的 HTML。样式以及 html、head、body 的引用身份都应保留。由于原内容
    // 来自服务端且这里没有进行 hydration，原 head 内容的语义位置会丢失，所有内容都会被前置。以后可
    // 考虑让服务端发出插入边界，使客户端渲染能够稳健处理穿插放置的节点。
    const root = ReactDOMClient.createRoot(document);
    root.render(
      <html data-client-foo="foo">
        <head>
          <title>a client title</title>
        </head>
        <body data-client-baz="baz">
          <div>hello client</div>
        </body>
      </html>,
    );
    await waitForAll([]);
    expect(persistentElements).toEqual([
      document.documentElement,
      document.head,
      document.body,
    ]);
    // 类似于Hydration，我们不会在每次渲染时重置实例本身的属性。
    expect(getVisibleChildren(document)).toEqual(
      <html data-client-foo="foo">
        <head>
          <link rel="stylesheet" href="resource" />
          <link rel="stylesheet" href="3rdparty" />
          <link rel="stylesheet" href="3rdparty2" />
          <title>a client title</title>
        </head>
        <body data-client-baz="baz">
          <style>
            {`
                body: {
                  background-color: red;
                }`}
          </style>
          <div>hello client</div>
        </body>
      </html>,
    );

    // 渲染新的子节点，并确保它们正确地附着在指定的位置。
    root.render(
      <html data-client-foo="foo">
        <head>
          <title>a client title</title>
          <meta />
        </head>
        <body data-client-baz="baz">
          <p>hello client again</p>
          <div>hello client</div>
        </body>
      </html>,
    );
    await waitForAll([]);
    expect(persistentElements).toEqual([
      document.documentElement,
      document.head,
      document.body,
    ]);
    expect(getVisibleChildren(document)).toEqual(
      <html data-client-foo="foo">
        <head>
          <link rel="stylesheet" href="resource" />
          <link rel="stylesheet" href="3rdparty" />
          <link rel="stylesheet" href="3rdparty2" />
          <title>a client title</title>
          <meta />
        </head>
        <body data-client-baz="baz">
          <style>
            {`
                body: {
                  background-color: red;
                }`}
          </style>
          <p>hello client again</p>
          <div>hello client</div>
        </body>
      </html>,
    );

    // 移除一些子节点
    root.render(
      <html data-client-foo="foo">
        <head>
          <title>a client title</title>
        </head>
        <body data-client-baz="baz">
          <p>hello client again</p>
        </body>
      </html>,
    );
    await waitForAll([]);
    expect(persistentElements).toEqual([
      document.documentElement,
      document.head,
      document.body,
    ]);
    expect(getVisibleChildren(document)).toEqual(
      <html data-client-foo="foo">
        <head>
          <link rel="stylesheet" href="resource" />
          <link rel="stylesheet" href="3rdparty" />
          <link rel="stylesheet" href="3rdparty2" />
          <title>a client title</title>
        </head>
        <body data-client-baz="baz">
          <style>
            {`
                body: {
                  background-color: red;
                }`}
          </style>
          <p>hello client again</p>
        </body>
      </html>,
    );

    // 移除持久组件。@TODO：确认是否应清理属性；清理后很可能无法恢复。
    root.render(
      <html data-client-foo="foo">
        <head>
          <title>a client title</title>
        </head>
      </html>,
    );
    await waitForAll([]);
    expect(persistentElements).toEqual([
      document.documentElement,
      document.head,
      document.body,
    ]);
    expect(getVisibleChildren(document)).toEqual(
      <html data-client-foo="foo">
        <head>
          <link rel="stylesheet" href="resource" />
          <link rel="stylesheet" href="3rdparty" />
          <link rel="stylesheet" href="3rdparty2" />
          <title>a client title</title>
        </head>
        <body>
          <style>
            {`
                body: {
                  background-color: red;
                }`}
          </style>
        </body>
      </html>,
    );

    // 卸载根节点
    root.unmount();
    await waitForAll([]);
    expect(persistentElements).toEqual([
      document.documentElement,
      document.head,
      document.body,
    ]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="resource" />
          <link rel="stylesheet" href="3rdparty" />
          <link rel="stylesheet" href="3rdparty2" />
        </head>
        <body>
          <style>
            {`
                body: {
                  background-color: red;
                }`}
          </style>
        </body>
      </html>,
    );

    // 现在用已知不匹配的内容水合 document；断言 html、head、body 的节点身份均未改变，且内嵌样式
    // 仍被保留。
    const hydrationErrors = [];
    let hydrateRoot = ReactDOMClient.hydrateRoot(
      document,
      <html data-client-foo="foo">
        <head>
          <title>a client title</title>
        </head>
        <body data-client-baz="baz">
          <div>hello client</div>
        </body>
      </html>,
      {

        /**
         * 收集不匹配 hydration 的规范化首句与组件栈第一行，用例 flush 后精确断言一项 at div 错误。
         * @param error - hydration 恢复 Error。
         * @param errorInfo - 含 componentStack 的错误信息。
         * @returns undefined。
         */
        onRecoverableError(error, errorInfo) {
          hydrationErrors.push([
            normalizeError(error.message),
            errorInfo.componentStack
              ? errorInfo.componentStack.split('\n')[1].trim()
              : null,
          ]);
        },
      },
    );
    await waitForAll([]);
    expect(hydrationErrors).toEqual([
      [
        "Hydration failed because the server rendered HTML didn't match the client.",
        'at div (<anonymous>)',
      ],
    ]);
    expect(persistentElements).toEqual([
      document.documentElement,
      document.head,
      document.body,
    ]);
    expect(getVisibleChildren(document)).toEqual(
      <html data-client-foo="foo">
        <head>
          <link rel="stylesheet" href="resource" />
          <link rel="stylesheet" href="3rdparty" />
          <link rel="stylesheet" href="3rdparty2" />
          <title>a client title</title>
        </head>
        <body data-client-baz="baz">
          <style>
            {`
                body: {
                  background-color: red;
                }`}
          </style>
          <div>hello client</div>
        </body>
      </html>,
    );

    // 重置树
    hydrationErrors.length = 0;
    hydrateRoot.unmount();

    // 再使用匹配的节点进行 hydration，并确认保留的样式已绑定到 hydrated Fiber。
    const link = document.querySelector('link[rel="stylesheet"]');
    const style = document.querySelector('style');
    hydrateRoot = ReactDOMClient.hydrateRoot(
      document,
      <html data-client-foo="foo">
        <head>
          <link rel="stylesheet" href="resource" />
          <link rel="stylesheet" href="3rdparty" />
          <link rel="stylesheet" href="3rdparty2" />
        </head>
        <body data-client-baz="baz">
          <style>
            {`
                body: {
                  background-color: red;
                }`}
          </style>
        </body>
      </html>,
      {

        /**
         * 收集第二轮 hydration 的完整 message 与组件栈第一行；空数组检查紧接 hydrateRoot、在 waitForAll 前，后续属性差异由 console 告警断言检查。
         * @param error - 恢复 Error。
         * @param errorInfo - 含 componentStack 的错误信息。
         * @returns undefined。
         */
        onRecoverableError(error, errorInfo) {
          hydrationErrors.push([
            error.message,
            errorInfo.componentStack
              ? errorInfo.componentStack.split('\n')[1].trim()
              : null,
          ]);
        },
      },
    );
    expect(hydrationErrors).toEqual([]);
    await waitForAll([]);
    assertConsoleErrorDev([
      "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. " +
        "This won't be patched up. This can happen if a SSR-ed Client Component used:\n" +
        '\n' +
        "- A server/client branch `if (typeof window !== 'undefined')`.\n" +
        "- Variable input such as `Date.now()` or `Math.random()` which changes each time it's called.\n" +
        "- Date formatting in a user's locale which doesn't match the server.\n" +
        '- External changing data without sending a snapshot of it along with the HTML.\n' +
        '- Invalid HTML tag nesting.\n\nIt can also happen if the client has a browser extension installed ' +
        'which messes with the HTML before React loaded.\n' +
        '\n' +
        'https://react.dev/link/hydration-mismatch\n' +
        '\n' +
        '  <html\n' +
        '+   data-client-foo="foo"\n' +
        '-   data-client-foo={null}\n' +
        '  >\n' +
        '    <head>\n' +
        '    <body\n' +
        '+     data-client-baz="baz"\n' +
        '-     data-client-baz={null}\n' +
        '    >\n' +
        '\n    in body (at **)',
    ]);
    expect(persistentElements).toEqual([
      document.documentElement,
      document.head,
      document.body,
    ]);
    expect([link, style]).toEqual([
      document.querySelector('link[rel="stylesheet"]'),
      document.querySelector('style'),
    ]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="resource" />
          <link rel="stylesheet" href="3rdparty" />
          <link rel="stylesheet" href="3rdparty2" />
        </head>
        <body>
          <style>
            {`
                body: {
                  background-color: red;
                }`}
          </style>
        </body>
      </html>,
    );

    // 最后再卸载一次：persistent 节点仍会保留，但 hydration 时匹配的 style 内容会被移除。
    hydrateRoot.unmount();
    expect(persistentElements).toEqual([
      document.documentElement,
      document.head,
      document.body,
    ]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body />
      </html>,
    );
  });

  // 当前实现不支持该测试；若重新引入 insertion edge，应再复核此场景。
  /** 此定义为 skip/todo，不会执行；Given：已 hydration 的文档中，第三方在受管 title/div 前后插入 a–h 样式表；When：定义中依次移除 head、增 body 子节点，再挂新 head 且移除 body；Then：定义期望保留外部样式与相对插入位置；此 skip 用例不执行，不能作为当前插入边界支持证据。目的：保留尚未支持的 tree-adjacent 插入位置回归场景。 */
  // eslint-disable-next-line jest/no-disabled-tests

  it.skip('is able to maintain insertions in head and body between tree-adjacent Nodes', async () => {
    // 在服务器端渲染一些 HTML，再在客户端进行 hydration。
    await actIntoEmptyDocument(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <html>
          <head>
            <title>title</title>
          </head>
          <body>
            <div>hello</div>
          </body>
        </html>,
      );
      pipe(writable);
    });
    const root = ReactDOMClient.hydrateRoot(
      document,
      <html>
        <head>
          <title>title</title>
        </head>
        <body>
          <div>hello</div>
        </body>
      </html>,
    );
    await waitForAll([]);

    // 构造并插入一些模拟第三方脚本行为的样式表。将来可以尝试在文档已包含这些样式表时进行
    // hydration，但当前规则仍很严格，因此会失败并回退到客户端渲染。
    const [a, b, c, d, e, f, g, h] = 'abcdefgh'.split('').map(letter => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = letter;
      return link;
    });

    const head = document.head;
    const title = head.firstChild;
    head.insertBefore(a, title);
    head.insertBefore(b, title);
    head.appendChild(c);
    head.appendChild(d);

    const bodyContent = document.body.firstChild;
    const body = document.body;
    body.insertBefore(e, bodyContent);
    body.insertBefore(f, bodyContent);
    body.appendChild(g);
    body.appendChild(h);

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="a" />
          <link rel="stylesheet" href="b" />
          <title>title</title>
          <link rel="stylesheet" href="c" />
          <link rel="stylesheet" href="d" />
        </head>
        <body>
          <link rel="stylesheet" href="e" />
          <link rel="stylesheet" href="f" />
          <div>hello</div>
          <link rel="stylesheet" href="g" />
          <link rel="stylesheet" href="h" />
        </body>
      </html>,
    );

    // 卸载头部，并将 body 的子元素更改为新的内容。
    root.render(
      <html>
        {null}
        <body>
          <div>hello</div>
          <div>world</div>
        </body>
      </html>,
    );

    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="a" />
          <link rel="stylesheet" href="b" />
          <link rel="stylesheet" href="c" />
          <link rel="stylesheet" href="d" />
        </head>
        <body>
          <link rel="stylesheet" href="e" />
          <link rel="stylesheet" href="f" />
          <div>hello</div>
          <div>world</div>
          <link rel="stylesheet" href="g" />
          <link rel="stylesheet" href="h" />
        </body>
      </html>,
    );

    // 挂载新头部并卸载主体
    root.render(
      <html>
        <head>
          <title>a new title</title>
        </head>
      </html>,
    );
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head>
          <title>a new title</title>
          <link rel="stylesheet" href="a" />
          <link rel="stylesheet" href="b" />
          <link rel="stylesheet" href="c" />
          <link rel="stylesheet" href="d" />
        </head>
        <body>
          <link rel="stylesheet" href="e" />
          <link rel="stylesheet" href="f" />
          <link rel="stylesheet" href="g" />
          <link rel="stylesheet" href="h" />
        </body>
      </html>,
    );
  });

  /** Given：html 作为容器，其 head/body 各含前后样式表、旧内容与 data-meaningful script；When：createRoot(html) 渲染新的 head/body 内容；Then：旧 title/div 删除，样式表和有意义 script 保留，新内容追加于其后。目的：验证根清理穿过持久 head/body 但保留资源脚本。 */
  it('clears persistent head and body when html is the container', async () => {
    await actIntoEmptyDocument(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <html>
          <head>
            <link rel="stylesheet" href="headbefore" />
            <title>this should be removed</title>
            <link rel="stylesheet" href="headafter" />
            <script data-meaningful="">true</script>
          </head>
          <body>
            <link rel="stylesheet" href="bodybefore" />
            <div>this should be removed</div>
            <link rel="stylesheet" href="bodyafter" />
            <script data-meaningful="">true</script>
          </body>
        </html>,
      );
      pipe(writable);
    });
    container = document.documentElement;

    const root = ReactDOMClient.createRoot(container);
    root.render(
      <>
        <head>
          <title>something new</title>
        </head>
        <body>
          <div>something new</div>
        </body>
      </>,
    );
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="headbefore" />
          <link rel="stylesheet" href="headafter" />
          <script data-meaningful="">true</script>
          <title>something new</title>
        </head>
        <body>
          <link rel="stylesheet" href="bodybefore" />
          <link rel="stylesheet" href="bodyafter" />
          <script data-meaningful="">true</script>
          <div>something new</div>
        </body>
      </html>,
    );
  });

  /** Given：head 作为容器，旧 title 位于两个样式表之间；When：createRoot(head) 渲染新 title；Then：两个 link 保留，旧 title 删除，新 title 位于 link 后。目的：验证 head 容器清理保留样式表。 */
  it('clears persistent head when it is the container', async () => {
    await actIntoEmptyDocument(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <html>
          <head>
            <link rel="stylesheet" href="before" />
            <title>this should be removed</title>
            <link rel="stylesheet" href="after" />
          </head>
          <body />
        </html>,
      );
      pipe(writable);
    });
    container = document.head;

    const root = ReactDOMClient.createRoot(container);
    root.render(<title>something new</title>);
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head>
          <link rel="stylesheet" href="before" />
          <link rel="stylesheet" href="after" />
          <title>something new</title>
        </head>
        <body />
      </html>,
    );
  });

  /** Given：body 作为容器，旧 div 位于两个样式表之间；When：createRoot(body) 渲染新 div；Then：两个 link 保留，旧 div 删除，新 div 位于 link 后。目的：验证 body 容器清理保留样式表。 */
  it('clears persistent body when it is the container', async () => {
    await actIntoEmptyDocument(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <html>
          <head />
          <body>
            <link rel="stylesheet" href="before" />
            <div>this should be removed</div>
            <link rel="stylesheet" href="after" />
          </body>
        </html>,
      );
      pipe(writable);
    });
    container = document.body;

    const root = ReactDOMClient.createRoot(container);
    root.render(<div>something new</div>);
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <link rel="stylesheet" href="before" />
          <link rel="stylesheet" href="after" />
          <div>something new</div>
        </body>
      </html>,
    );
  });

  /** Given：Fizz body 只有文本 foo；When：匹配 hydration 后更新为 bar，再卸载并 createRoot 渲染 baz；Then：各阶段可见 body 文本为 foo、bar、baz。目的：验证 singleton 的单一文本路径覆盖 hydration、更新与新根。 */
  it('renders single Text children into HostSingletons correctly', async () => {
    await actIntoEmptyDocument(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <html>
          <head />
          <body>foo</body>
        </html>,
      );
      pipe(writable);
    });

    let root = ReactDOMClient.hydrateRoot(
      document,
      <html>
        <head />
        <body>foo</body>
      </html>,
    );
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>foo</body>
      </html>,
    );

    root.render(
      <html>
        <head />
        <body>bar</body>
      </html>,
    );
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>bar</body>
      </html>,
    );

    root.unmount();

    root = ReactDOMClient.createRoot(document);
    root.render(
      <html>
        <head />
        <body>baz</body>
      </html>,
    );
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>baz</body>
      </html>,
    );
  });

  /** Given：新根 body 的唯一子节点为文本 foo；When：依次改为 div foo、文本 foo、div foo；Then：每轮可见结构分别匹配文本或 div，旧内容没有残留。目的：验证直接文本和元素子节点之间的往返切换。 */
  it('supports going from single text child to many children back to single text child in body', async () => {
    const root = ReactDOMClient.createRoot(document);
    root.render(
      <html>
        <head />
        <body>foo</body>
      </html>,
    );
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>foo</body>
      </html>,
    );

    root.render(
      <html>
        <head />
        <body>
          <div>foo</div>
        </body>
      </html>,
    );
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <div>foo</div>
        </body>
      </html>,
    );

    root.render(
      <html>
        <head />
        <body>foo</body>
      </html>,
    );
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>foo</body>
      </html>,
    );

    root.render(
      <html>
        <head />
        <body>
          <div>foo</div>
        </body>
      </html>,
    );
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <div>foo</div>
        </body>
      </html>,
    );
  });

  /** Given：服务端 JSX 省略 head，但 HTML 解析补出空 head；When：以同样省略 head 的 JSX hydration；Then：服务端与 hydration 后可见结构均为 html/空 head/body foo。目的：验证隐式文档 head 不要求对应客户端组件。 */
  it('allows for hydrating without a head', async () => {
    await actIntoEmptyDocument(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <html>
          <body>foo</body>
        </html>,
      );
      pipe(writable);
    });

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>foo</body>
      </html>,
    );

    ReactDOMClient.hydrateRoot(
      document,
      <html>
        <body>foo</body>
      </html>,
    );
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>foo</body>
      </html>,
    );
  });

  // https://github.com/facebook/react/issues/26128
  /** Given：legacy mode 未禁用的门控环境；When：ReactDOM.render(<div />) 到 document.body；Then：调用完成且没有抛出；没有额外 DOM 断言。目的：回归 #26128 的 body 容器路径。 */
  // @gate !disableLegacyMode

  it('(#26128) does not throw when rendering at body in legacy mode', async () => {
    ReactDOM.render(<div />, document.body);
  });

  // https://github.com/facebook/react/issues/26128
  /** Given：legacy mode 未禁用的门控环境；When：ReactDOM.render(<body />) 到 document.documentElement；Then：调用完成且没有抛出；没有额外 DOM 断言。目的：回归 #26128 的 html 容器路径。 */
  // @gate !disableLegacyMode

  it('(#26128) does not throw when rendering at <html> in legacy mode', async () => {
    ReactDOM.render(<body />, document.documentElement);
  });

  // https://github.com/facebook/react/issues/26128
  /** Given：legacy mode 未禁用的门控环境；When：ReactDOM.render(<html />) 到 document；Then：调用完成且没有抛出；没有额外 DOM 断言。目的：回归 #26128 的 document 容器路径。 */
  // @gate !disableLegacyMode

  it('(#26128) does not throw when rendering at document in legacy mode', async () => {
    ReactDOM.render(<html />, document);
  });
});
