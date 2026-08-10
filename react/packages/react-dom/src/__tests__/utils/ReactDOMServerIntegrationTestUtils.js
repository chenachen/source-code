/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** `stream`：保存当前测试场景复用的夹具、状态或回调。 */
const stream = require('stream');
/** `shouldIgnoreConsoleError`：保存当前测试场景复用的夹具、状态或回调。 */
const shouldIgnoreConsoleError = require('internal-test-utils/shouldIgnoreConsoleError');

module.exports = function (initModules) {
  let ReactDOM;
  let ReactDOMClient;
  let ReactDOMServer;
  let act;

  /** `resetModules`：封装当前用例复用的操作、回调或断言步骤。 */
  function resetModules() {
    ({ReactDOM, ReactDOMClient, ReactDOMServer} = initModules());
    act = require('internal-test-utils').act;
  }

  /** `shouldUseDocument`：封装当前用例复用的操作、回调或断言步骤。 */
  function shouldUseDocument(reactElement) {
    // 用于整个文档测试。
    return reactElement && reactElement.type === 'html';
  }

  /** `getContainerFromMarkup`：封装当前用例复用的操作、回调或断言步骤。 */
  function getContainerFromMarkup(reactElement, markup) {
    if (shouldUseDocument(reactElement)) {
      const doc = document.implementation.createHTMLDocument('');
      doc.open();
      doc.write(
        markup ||
          '<!doctype html><html><meta charset=utf-8><title>test doc</title>',
      );
      doc.close();
      return doc;
    } else {
      const container = document.createElement('div');
      container.innerHTML = markup;
      return container;
    }
  }

  // 渲染测试辅助函数 ==================================================

  // 把 ReactDOM.render() 包装为 Promise 形式。
  /** `asyncReactDOMRender`：封装当前用例复用的操作、回调或断言步骤。 */
  async function asyncReactDOMRender(reactElement, domElement, forceHydrate) {
    if (forceHydrate) {
      await act(() => {
        ReactDOMClient.hydrateRoot(domElement, reactElement, {
          /** `asyncReactDOMRender.onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
          onRecoverableError(e) {
            if (
              e.message.startsWith(
                'There was an error while hydrating. Because the error happened outside of a Suspense boundary, the entire root will switch to client rendering.',
              )
            ) {
              // 若原因是 hydration mismatch，这个额外错误本不应存在，因此忽略它。
            } else {
              console.error(e);
            }
          },
        });
      });
    } else {
      await act(() => {
        if (ReactDOMClient) {
          const root = ReactDOMClient.createRoot(domElement);
          root.render(reactElement);
        } else {
          ReactDOM.render(reactElement, domElement);
        }
      });
    }
  }
  // 异步执行 fn，并期望 console.error 记录 count 个错误；实际错误数不等于 count 时测试失败。
  /** `expectErrors`：封装当前用例复用的操作、回调或断言步骤。 */
  async function expectErrors(fn, count) {
    if (console.error.mockClear) {
      console.error.mockClear();
    } else {
      // TODO：重写使用此辅助函数的测试，以枚举预期的错误。 这将使辅助程序能够使用
      // assertConsoleErrorDev 而不是 spying。
      spyOnDev(console, 'error').mockImplementation(() => {});
    }

    const result = await fn();
    if (
      console.error.mock &&
      console.error.mock.calls &&
      console.error.mock.calls.length !== 0
    ) {
      const filteredWarnings = [];
      for (let i = 0; i < console.error.mock.calls.length; i++) {
        const args = console.error.mock.calls[i];
        const [format, ...rest] = args;
        if (!shouldIgnoreConsoleError(format, rest)) {
          filteredWarnings.push(args);
        }
      }
      if (filteredWarnings.length !== count) {
        console.log(
          `We expected ${count} warning(s), but saw ${filteredWarnings.length} warning(s).`,
        );
        if (filteredWarnings.length > 0) {
          console.log(`We saw these warnings:`);
          for (let i = 0; i < filteredWarnings.length; i++) {
            console.log(...filteredWarnings[i]);
          }
        }
        if (__DEV__) {
          expect(console.error).toHaveBeenCalledTimes(count);
        }
      }
    }
    return result;
  }

  // 把 reactElement 渲染进 domElement，并校验预期错误数；返回的 Promise 会在渲染完成时兑现。
  /** `renderIntoDom`：封装当前用例复用的操作、回调或断言步骤。 */
  function renderIntoDom(
    reactElement,
    domElement,
    forceHydrate,
    errorCount = 0,
  ) {
    return expectErrors(async () => {
      await asyncReactDOMRender(reactElement, domElement, forceHydrate);
      return domElement.firstChild;
    }, errorCount);
  }

  /** `renderIntoString`：封装当前用例复用的操作、回调或断言步骤。 */
  async function renderIntoString(reactElement, errorCount = 0) {
    return await expectErrors(
      () =>
        new Promise(resolve =>
          resolve(ReactDOMServer.renderToString(reactElement)),
        ),
      errorCount,
    );
  }

  // 使用服务器端渲染（SSR）渲染文本，并将结果塞入一个 DOM 节点中； 返回与 reactElement 对应的
  // DOM 元素。 不渲染客户端或不进行客户端复活。
  /** `serverRender`：封装当前用例复用的操作、回调或断言步骤。 */
  async function serverRender(reactElement, errorCount = 0) {
    const markup = await renderIntoString(reactElement, errorCount);
    return getContainerFromMarkup(reactElement, markup).firstChild;
  }

  // 这将读取管道中的可读内容并将其转换为字符串。 该值可以通过 `.buffer` 属性访问。
  /** `DrainWritable`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
  class DrainWritable extends stream.Writable {
    /** `DrainWritable.constructor`：初始化测试夹具实例及其状态。 */
    constructor(options) {
      super(options);
      this.buffer = '';
    }

    /** `DrainWritable._write`：实现测试夹具的生命周期、渲染或交互步骤。 */
    _write(chunk, encoding, cb) {
      this.buffer += chunk;
      cb();
    }
  }

  /** `renderIntoStream`：封装当前用例复用的操作、回调或断言步骤。 */
  async function renderIntoStream(reactElement, errorCount = 0) {
    return await expectErrors(
      () =>
        new Promise((resolve, reject) => {
          const writable = new DrainWritable();
          const s = ReactDOMServer.renderToPipeableStream(reactElement, {
            /** `renderIntoStream.onShellError`：实现测试夹具的生命周期、渲染或交互步骤。 */
            onShellError(e) {
              reject(e);
            },
          });
          s.pipe(writable);
          writable.on('finish', () => resolve(writable.buffer));
        }),
      errorCount,
    );
  }

  // 使用 node stream SSR 渲染文本并放入 DOM 节点；返回与 reactElement 对应的 DOM 元素。
  // 不在客户端渲染，也不执行 client-side revival。
  /** `streamRender`：封装当前用例复用的操作、回调或断言步骤。 */
  async function streamRender(reactElement, errorCount = 0) {
    const markup = await renderIntoStream(reactElement, errorCount);
    let firstNode = getContainerFromMarkup(reactElement, markup).firstChild;
    if (firstNode && firstNode.nodeType === Node.DOCUMENT_TYPE_NODE) {
      // 跳过文档类型节点。
      firstNode = firstNode.nextSibling;
    }
    return firstNode;
  }

  /** `clientCleanRender`：封装当前用例复用的操作、回调或断言步骤。 */
  const clientCleanRender = (element, errorCount = 0) => {
    if (shouldUseDocument(element)) {
      // 文档不能从头开始渲染。
      return clientRenderOnServerString(element, errorCount);
    }
    const container = document.createElement('div');
    return renderIntoDom(element, container, false, errorCount);
  };

  /** `clientRenderOnServerString`：封装当前用例复用的操作、回调或断言步骤。 */
  const clientRenderOnServerString = async (element, errorCount = 0) => {
    const markup = await renderIntoString(element, errorCount);
    resetModules();

    const container = getContainerFromMarkup(element, markup);
    let serverNode = container.firstChild;

    const firstClientNode = await renderIntoDom(
      element,
      container,
      true,
      errorCount,
    );
    let clientNode = firstClientNode;

    // 确保所有顶级节点匹配
    while (serverNode || clientNode) {
      expect(serverNode != null).toBe(true);
      expect(clientNode != null).toBe(true);
      expect(clientNode.nodeType).toBe(serverNode.nodeType);
      // 确保 DOM 元素未被替换。 请注意，由于 jest bug #1772，我们无法使用
      // expect(serverNode).toBe(clientNode)。
      expect(serverNode === clientNode).toBe(true);
      serverNode = serverNode.nextSibling;
      clientNode = clientNode.nextSibling;
    }
    return firstClientNode;
  };

  /** `BadMarkupExpected`：封装当前用例复用的操作、回调或断言步骤。 */
  function BadMarkupExpected() {}

  /** `clientRenderOnBadMarkup`：封装当前用例复用的操作、回调或断言步骤。 */
  const clientRenderOnBadMarkup = async (element, errorCount = 0) => {
    // 首先渲染坏的标记。

    const container = getContainerFromMarkup(
      element,
      shouldUseDocument(element)
        ? '<html><body><div id="badIdWhichWillCauseMismatch" /></body></html>'
        : '<div id="badIdWhichWillCauseMismatch"></div>',
    );

    await renderIntoDom(element, container, true, errorCount + 1);

    // 这给我们返回了结果文本内容。
    const hydratedTextContent =
      container.lastChild && container.lastChild.textContent;

    // 我们现在将元素渲染到一个干净的 DOM 客户端侧。
    let cleanContainer;
    if (shouldUseDocument(element)) {
      // 全新渲染时不能直接渲染进 document，因此改为把子节点渲染进 documentElement。
      cleanContainer = getContainerFromMarkup(
        element,
        '<html></html>',
      ).documentElement;
      element = element.props.children;
    } else {
      cleanContainer = document.createElement('div');
    }
    await asyncReactDOMRender(element, cleanContainer, true);
    // 这为我们提供了预期的文本内容。
    const cleanTextContent =
      (cleanContainer.lastChild && cleanContainer.lastChild.textContent) || '';

    // 唯一保证是文本内容已修补。
    expect(hydratedTextContent).toBe(cleanTextContent);

    // 终止后续断言；执行到这里后其余前提都已不再可靠。
    throw new BadMarkupExpected();
  };

  // 把一个 DOM 渲染用例扩展为四种场景：服务端字符串渲染、无服务端标记的客户端全新渲染、在正确服
  // 务端标记上渲染，以及在错误服务端标记上渲染。testFn 接收一个 render 函数；render 接收
  // ReactElement 与可选的预期错误数。
  // 返回一个包含 DOM 元素的 Promise。
  //
  // 你应该只进行测试以检查渲染结果的 DOM。 您不应依赖返回的 DOM 元素的交互性。 因为那在服务器字
  // 符串场景中不会起作用。
  /** `itRenders`：封装当前用例复用的操作、回调或断言步骤。 */
  function itRenders(desc, testFn) {
    /**
     * 代表场景（Given–When–Then）：
     * Given 当前文件已建立所需 DOM、React 根与测试夹具；
     * When 执行「当前参数化场景」描述的渲染或交互；
     * Then 通过本用例的 DOM、日志或调度断言确认行为。
     *
     * 验证机制：断言覆盖 react-dom 的服务端流适配层；完整 Fizz 状态机位于 react-server。
     */
    it(`renders ${desc} with server string render`, () => testFn(serverRender));
    /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
    it(`renders ${desc} with server stream render`, () => testFn(streamRender));
    itClientRenders(desc, testFn);
  }

  // 运行在三种不同的渲染场景中的 testFn：
  // 在客户端渲染，不包含任何服务器标记的“干净的客户端渲染” 在客户端渲染，覆盖良好生成的服务器
  // 标记的“干净的客户端渲染” 在客户端渲染，覆盖不良生成的服务器标记的“干净的客户端渲染”
  //
  // testFn 是一个测试函数，它有一个参数，该参数是一个渲染函数。 该函数接收一个 ReactElement 和一
  // 个可选的期望错误计数。
  // 返回一个包含 DOM 元素的 Promise。
  // 此函数中的渲染全部发生在客户端，因此可以测试交互；itRenders 不具备这一条件。
  /** `itClientRenders`：封装当前用例复用的操作、回调或断言步骤。 */
  function itClientRenders(desc, testFn) {
    /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
    it(`renders ${desc} with clean client render`, () =>
      testFn(clientCleanRender));
    /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
    it(`renders ${desc} with client render on top of good server markup`, () =>
      testFn(clientRenderOnServerString));
    /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
    it(`renders ${desc} with client render on top of bad server markup`, async () => {
      try {
        await testFn(clientRenderOnBadMarkup);
      } catch (x) {
        // 这里预期触发 BadMarkupExpected 拒绝。
        if (!(x instanceof BadMarkupExpected)) {
          // 若不是该拒绝，则重新抛出。
          throw x;
        }
      }
    });
  }

  /** `itThrows`：封装当前用例复用的操作、回调或断言步骤。 */
  function itThrows(desc, testFn, partialMessage) {
    /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
    it(`throws ${desc}`, () => {
      return testFn().then(
        () => expect(false).toBe('The promise resolved and should not have.'),
        err => {
          expect(err).toBeInstanceOf(Error);
          expect(err.message).toContain(partialMessage);
        },
      );
    });
  }

  /** `itThrowsWhenRendering`：封装当前用例复用的操作、回调或断言步骤。 */
  function itThrowsWhenRendering(desc, testFn, partialMessage) {
    itThrows(
      `when rendering ${desc} with server string render`,
      () => testFn(serverRender),
      partialMessage,
    );
    itThrows(
      `when rendering ${desc} with clean client render`,
      () => testFn(clientCleanRender),
      partialMessage,
    );

    // 我们在这里从警告计数中减去1，因为抛出意味着它不会得到通常的标记不匹配警告。
    itThrows(
      `when rendering ${desc} with client render on top of bad server markup`,
      () =>
        testFn((element, warningCount = 0) =>
          clientRenderOnBadMarkup(element, warningCount - 1),
        ),
      partialMessage,
    );
  }

  // 先把 serverElement 渲染成字符串并放入 DOM 元素，再尝试在其上渲染 clientElement；shouldMatch
  // 表示是否应期望两份标记匹配。
  /** `testMarkupMatch`：封装当前用例复用的操作、回调或断言步骤。 */
  async function testMarkupMatch(serverElement, clientElement, shouldMatch) {
    const domElement = await serverRender(serverElement);
    resetModules();
    return renderIntoDom(
      clientElement,
      domElement.parentNode,
      true,
      shouldMatch ? 0 : 1,
    );
  }

  // 期望在客户端元素渲染在服务器渲染的服务器元素之上时不会引发标记不匹配警告。
  /** `expectMarkupMatch`：封装当前用例复用的操作、回调或断言步骤。 */
  function expectMarkupMatch(serverElement, clientElement) {
    return testMarkupMatch(serverElement, clientElement, true);
  }

  // 期望在服务器渲染的服务器元素上渲染 clientElement 会引发标记不匹配警告。
  /** `expectMarkupMismatch`：封装当前用例复用的操作、回调或断言步骤。 */
  function expectMarkupMismatch(serverElement, clientElement) {
    return testMarkupMatch(serverElement, clientElement, false);
  }

  return {
    resetModules,
    expectMarkupMismatch,
    expectMarkupMatch,
    itRenders,
    itClientRenders,
    itThrowsWhenRendering,
    asyncReactDOMRender,
    serverRender,
    clientCleanRender,
    clientRenderOnBadMarkup,
    clientRenderOnServerString,
    renderIntoDom,
    streamRender,
  };
};
