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

  /** 执行callback并等一次setImmediate，再把本轮UTF8 buffer解析/搬入JSDOM；若流error则抛记录原因。该工具假定本例已形成完整片段，不等待所有任意异步任务；克隆SCRIPT使内联协议执行。 */
  async function act(callback) {
    await callback();
    // 只等一次setImmediate，让本例当前安排的流工作产生完整片段；这不是任意异步任务完成信号。
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

  /** 递归重建断言用React树，过滤无type的script、template、hidden/aria-hidden属性存在及rel=expect且blocking=render节点；冒号id也省略。它是测试投影，不计算CSS可见性。 */
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
          // 忽略rel=expect且blocking=render的协议link，不把它计入可见投影。
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

  /** 先改pending记录为resolved再同步通知pings，或未读key直接存resolved，供静态任务结束。 */
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

  /* 此rejectText草稿被整体注释，不在当前测试运行中执行。
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

  /** 按文本缓存返回resolved或抛pending/rejected；初读创建收集pings的thenable并抛出，让Fizz等待。 */
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

        /** pending收集resolve，已完成通过Promise微任务通知，支持晚订阅重试。 */
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

  /** 同步文字fixture，直接返回text。 */
  function Text({text}) {
    return text;
  }

  /** 读取可能挂起的缓存，返回完成text，作为静态Suspense内容。 */
  function AsyncText({text}) {
    return readText(text);
  }

  /** 静态Node prerender的Suspense等Hello，先resolve再await结果；postponed=null、prelude管道显示Hello，随后hydrate仍相同，验证完整静态内容可认领。 */
  it('should render a fully static document, send it and then hydrate it', async () => {

    /** div内Suspense等待Hello，fallback Loading用于证明prelude只输出完成内容。 */
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

  /** 完整文档prerender带importMap对象；管道解析后保留type=importmap脚本JSON和hello文字，验证配置importMap在前导输出。 */
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

  /** App显式preload高优先级image和font并给onHeaders；返回描述符Link按font再image顺序，prelude可见仅hello，验证早期资源走响应头而不重复可见元素。 */
  it('supports onHeaders', async () => {
    let headers;

    /** 保存静态Node onHeaders收到的原描述符，供检查Link字段与顺序。 */
    function onHeaders(x) {
      headers = x;
    }

    /** 发高image/font preload并输出完整hello文档，资源应进入早期响应头。 */
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

  /** 嵌套Suspense所有内容同步，用Indirection记录fallback/content；顺序为外fallback、两内fallback、两内容，但prelude只两内容，验证prerender先探索fallback而非实际输出它们。 */
  it('will prerender Suspense fallbacks before children', async () => {
    const values = [];

    /** 记录children被探索的顺序后透传，不影响内容结构。 */
    function Indirection({children}) {
      values.push(children);
      return children;
    }

    /** 外层与两个内层Suspense的fallback/content都经Indirection，比较探索顺序和最终输出。 */
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

  /** App渲染中同步abort(sync)；静态结果仍可管道，onError仅sync且没有可见内容，验证取消中止预渲染而不发未完成shell。 */
  it('will halt a prerender when aborting with an error during a render', async () => {
    const controller = new AbortController();

    /** 渲染期间同步abort(sync)再返回div，此返回内容不应发到prelude。 */
    function App() {
      controller.abort('sync');
      return <div>hello world</div>;
    }

    const errors = [];
    const result = await ReactDOMFizzStatic.prerenderToNodeStream(<App />, {
      signal: controller.signal,

      /** 收集同步取消原因，保留原输入sync供错误断言。 */
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

  /** App use未解决Promise，微任务abort(async)；onError仅async且prelude无可见内容，验证异步取消唤醒等待并结束静态请求。 */
  it('will halt a prerender when aborting with an error in a microtask', async () => {
    const errors = [];

    const controller = new AbortController();

    /** use一个永不解决Promise并在微任务abort(async)，制造异步中止静态等待。 */
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

      /** 收集异步取消原因，预期唯一async，不自行恢复内容。 */
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
