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
let ReactDOMFizzStatic;
let Suspense;
let textCache;
let document;
let writable;
let container;
let buffer = '';
let hasErrored = false;
let fatalError = undefined;

describe('ReactDOMFizzStatic', () => {
  beforeEach(() => {
    jest.resetModules();
    JSDOM = require('jsdom').JSDOM;
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ReactDOMFizzStatic = require('react-dom/static');
    Stream = require('stream');
    Suspense = React.Suspense;

    textCache = new Map();

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
        for (let i = 0; i < node.attributes.length; i++) {
          const attribute = node.attributes[i];
          script.setAttribute(attribute.name, attribute.value);
        }
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
          (node.tagName !== 'SCRIPT' || node.hasAttribute('type')) &&
          node.tagName !== 'TEMPLATE' &&
          node.tagName !== 'template' &&
          !node.hasAttribute('hidden') &&
          !node.hasAttribute('aria-hidden') &&
          // 忽略渲染阻塞，期望
          (node.getAttribute('rel') !== 'expect' ||
            node.getAttribute('blocking') !== 'render')
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

  /** `resolveText`：封装当前用例复用的操作、回调或断言步骤。 */
  function resolveText(text) {
    const record = textCache.get(text);
    if (record === undefined) {
      const newRecord = {
        status: 'resolved',
        value: text,
      };
      textCache.set(text, newRecord);
    } else if (record.status === 'pending') {
      const thenable = record.value;
      record.status = 'resolved';
      record.value = text;
      thenable.pings.forEach(t => t());
    }
  }

  /*
  function rejectText(text, error) {
    const record = textCache.get(text);
    if (record === undefined) {
      const newRecord = {
        status: 'rejected',
        value: error,
      };
      textCache.set(text, newRecord);
    } else if (record.status === 'pending') {
      const thenable = record.value;
      record.status = 'rejected';
      record.value = error;
      thenable.pings.forEach(t => t());
    }
  }
  */

  /** `readText`：封装当前用例复用的操作、回调或断言步骤。 */
  function readText(text) {
    const record = textCache.get(text);
    if (record !== undefined) {
      switch (record.status) {
        case 'pending':
          throw record.value;
        case 'rejected':
          throw record.value;
        case 'resolved':
          return record.value;
      }
    } else {
      const thenable = {
        pings: [],
        /** `readText.then`：实现测试夹具的生命周期、渲染或交互步骤。 */
        then(resolve) {
          if (newRecord.status === 'pending') {
            thenable.pings.push(resolve);
          } else {
            Promise.resolve().then(() => resolve(newRecord.value));
          }
        },
      };

      const newRecord = {
        status: 'pending',
        value: thenable,
      };
      textCache.set(text, newRecord);

      throw thenable;
    }
  }

  /** `Text`：封装当前用例复用的操作、回调或断言步骤。 */
  function Text({text}) {
    return text;
  }

  /** `AsyncText`：封装当前用例复用的操作、回调或断言步骤。 */
  function AsyncText({text}) {
    return readText(text);
  }

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should render a fully static document, send it and then hydrate it」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言覆盖 react-dom 的服务端流适配层；完整 Fizz 状态机位于 react-server。
   */
  it('should render a fully static document, send it and then hydrate it', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div>
          <Suspense fallback={<Text text="Loading..." />}>
            <AsyncText text="Hello" />
          </Suspense>
        </div>
      );
    }

    const promise = ReactDOMFizzStatic.prerenderToNodeStream(<App />);

    resolveText('Hello');

    const result = await promise;

    expect(result.postponed).toBe(null);

    await act(async () => {
      result.prelude.pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(<div>Hello</div>);

    await act(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });

    expect(getVisibleChildren(container)).toEqual(<div>Hello</div>);
  });

  /** 测试场景：验证「should support importMap option」描述的渲染、交互或错误处理结果。 */
  it('should support importMap option', async () => {
    const importMap = {
      foo: 'path/to/foo.js',
    };
    const result = await ReactDOMFizzStatic.prerenderToNodeStream(
      <html>
        <body>hello world</body>
      </html>,
      {importMap},
    );

    await act(async () => {
      result.prelude.pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual([
      <script type="importmap">{JSON.stringify(importMap)}</script>,
      'hello world',
    ]);
  });

  /** 测试场景：验证「supports onHeaders」描述的渲染、交互或错误处理结果。 */
  it('supports onHeaders', async () => {
    let headers;
    /** `onHeaders`：封装当前用例复用的操作、回调或断言步骤。 */
    function onHeaders(x) {
      headers = x;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      ReactDOM.preload('image', {as: 'image', fetchPriority: 'high'});
      ReactDOM.preload('font', {as: 'font'});
      return (
        <html>
          <body>hello</body>
        </html>
      );
    }

    const result = await ReactDOMFizzStatic.prerenderToNodeStream(<App />, {
      onHeaders,
    });
    expect(headers).toEqual({
      Link: `
<font>; rel=preload; as="font"; crossorigin="",
 <image>; rel=preload; as="image"; fetchpriority="high"
`
        .replaceAll('\n', '')
        .trim(),
    });

    await act(async () => {
      result.prelude.pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual('hello');
  });

  /** 测试场景：验证「will prerender Suspense fallbacks before children」描述的渲染、交互或错误处理结果。 */
  it('will prerender Suspense fallbacks before children', async () => {
    const values = [];
    /** `Indirection`：封装当前用例复用的操作、回调或断言步骤。 */
    function Indirection({children}) {
      values.push(children);
      return children;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div>
          <Suspense
            fallback={
              <div>
                <Indirection>outer loading...</Indirection>
              </div>
            }>
            <Suspense
              fallback={
                <div>
                  <Indirection>first inner loading...</Indirection>
                </div>
              }>
              <div>
                <Indirection>hello world</Indirection>
              </div>
            </Suspense>
            <Suspense
              fallback={
                <div>
                  <Indirection>second inner loading...</Indirection>
                </div>
              }>
              <div>
                <Indirection>goodbye world</Indirection>
              </div>
            </Suspense>
          </Suspense>
        </div>
      );
    }

    const result = await ReactDOMFizzStatic.prerenderToNodeStream(<App />);

    expect(values).toEqual([
      'outer loading...',
      'first inner loading...',
      'second inner loading...',
      'hello world',
      'goodbye world',
    ]);

    await act(async () => {
      result.prelude.pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div>hello world</div>
        <div>goodbye world</div>
      </div>,
    );
  });

  /** 测试场景：验证「will halt a prerender when aborting with an error during a render」描述的渲染、交互或错误处理结果。 */
  it('will halt a prerender when aborting with an error during a render', async () => {
    const controller = new AbortController();
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      controller.abort('sync');
      return <div>hello world</div>;
    }

    const errors = [];
    const result = await ReactDOMFizzStatic.prerenderToNodeStream(<App />, {
      signal: controller.signal,
      /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onError(error) {
        errors.push(error);
      },
    });
    await act(async () => {
      result.prelude.pipe(writable);
    });
    expect(errors).toEqual(['sync']);
    expect(getVisibleChildren(container)).toEqual(undefined);
  });

  /** 测试场景：验证「will halt a prerender when aborting with an error in a microtask」描述的渲染、交互或错误处理结果。 */
  it('will halt a prerender when aborting with an error in a microtask', async () => {
    const errors = [];

    const controller = new AbortController();
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      React.use(
        new Promise(() => {
          Promise.resolve().then(() => {
            controller.abort('async');
          });
        }),
      );
      return <div>hello world</div>;
    }

    errors.length = 0;
    const result = await ReactDOMFizzStatic.prerenderToNodeStream(<App />, {
      signal: controller.signal,
      /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onError(error) {
        errors.push(error);
      },
    });
    await act(async () => {
      result.prelude.pipe(writable);
    });
    expect(errors).toEqual(['async']);
    expect(getVisibleChildren(container)).toEqual(undefined);
  });
});
