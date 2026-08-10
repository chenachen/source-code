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

/** `normalizeError`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** `actIntoEmptyDocument`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** `getVisibleChildren`：封装当前用例复用的操作、回调或断言步骤。 */
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
            // 忽略渲染阻塞，期望
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

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「warns if you render the same singleton twice at the same time」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
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

  /** 测试场景：验证「resets property-backed state when a singleton is released」描述的渲染、交互或错误处理结果。 */
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

  // @gate TODO
  /** 测试场景：验证「clears dangerouslySetInnerHTML when it becomes undefined」描述的渲染、交互或错误处理结果。 */
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

  // @gate TODO
  /** 测试场景：验证「clears dangerouslySetInnerHTML when __html becomes undefined」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「updates dangerouslySetInnerHTML on a singleton」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「replaces singleton children with dangerouslySetInnerHTML」描述的渲染、交互或错误处理结果。 */
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

  // @gate TODO
  /** 测试场景：验证「replaces dangerouslySetInnerHTML with singleton children」描述的渲染、交互或错误处理结果。 */
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

  // @gate TODO
  /** 测试场景：验证「preserves imperative attributes when acquiring a singleton」描述的渲染、交互或错误处理结果。 */
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

  // @gate TODO
  /** 测试场景：验证「preserves imperative attributes when clearing a preamble contribution」描述的渲染、交互或错误处理结果。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError() {},
      },
    );
    await waitForAll([]);

    expect(body.textContent).toBe('client');
    expect(body.getAttribute('data-external')).toBe('true');
  });

  /** 测试场景：验证「does not duplicate native listeners when a singleton is reacquired」描述的渲染、交互或错误处理结果。 */
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

  // @gate __DEV__
  /** 测试场景：验证「does not release or reacquire singletons when double invoking effects during hydration」描述的渲染、交互或错误处理结果。 */
  it('does not release or reacquire singletons when double invoking effects during hydration', async () => {
    const effectLog = [];
    const html = '<span id="managed">managed content</span>';

    /** `Effect`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「renders into html, head, and body persistently so the node identities never change and extraneous styles are retained」描述的渲染、交互或错误处理结果。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
  // eslint-disable-next-line jest/no-disabled-tests
  /** 测试场景：验证「is able to maintain insertions in head and body between tree-adjacent Nodes」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「clears persistent head and body when html is the container」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「clears persistent head when it is the container」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「clears persistent body when it is the container」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「renders single Text children into HostSingletons correctly」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「supports going from single text child to many children back to single text child in body」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「allows for hydrating without a head」描述的渲染、交互或错误处理结果。 */
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
  // @gate !disableLegacyMode
  /** 测试场景：验证「(#26128) does not throw when rendering at body in legacy mode」描述的渲染、交互或错误处理结果。 */
  it('(#26128) does not throw when rendering at body in legacy mode', async () => {
    ReactDOM.render(<div />, document.body);
  });

  // https://github.com/facebook/react/issues/26128
  // @gate !disableLegacyMode
  /** 测试场景：验证「(#26128) does not throw when rendering at <html> in legacy mode」描述的渲染、交互或错误处理结果。 */
  it('(#26128) does not throw when rendering at <html> in legacy mode', async () => {
    ReactDOM.render(<body />, document.documentElement);
  });

  // https://github.com/facebook/react/issues/26128
  // @gate !disableLegacyMode
  /** 测试场景：验证「(#26128) does not throw when rendering at document in legacy mode」描述的渲染、交互或错误处理结果。 */
  it('(#26128) does not throw when rendering at document in legacy mode', async () => {
    ReactDOM.render(<html />, document);
  });
});
