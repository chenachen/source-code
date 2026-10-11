/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** 提供 Node Writable 基类，用来按 Fizz 实际 chunk 收集服务端 HTML。 */
const stream = require('stream');
/** 过滤测试环境约定的 console.error噪声，使错误计数针对场景诊断。 */
const shouldIgnoreConsoleError = require('internal-test-utils/shouldIgnoreConsoleError');

/** 以 initModules 回调构造集成工具集合，闭包保存当前 client/server和 act；调用者需先 resetModules初始化再执行 render。 */
module.exports = function (initModules) {
  let ReactDOM;
  let ReactDOMClient;
  let ReactDOMServer;
  let act;

  /** 调用场景提供的 initModules更新 client/server模块引用并重新取 act；SSR到hydration 的切换清除模块级缓存。 */
  function resetModules() {
    ({ReactDOM, ReactDOMClient, ReactDOMServer} = initModules());
    act = require('internal-test-utils').act;
  }

  /** 仅当 React 元素顶层 type 精确为 html 时选整文档容器；Fragment或包装组件中的 html不触发此快捷分支。 */
  function shouldUseDocument(reactElement) {
    // 用于整个文档测试。
    return reactElement && reactElement.type === 'html';
  }

  /** html 输入创建独立 HTMLDocument并用 document.write解析 markup或空文档基准；其它输入建 div并赋 innerHTML。解析得到的节点供 SSR断言与hydration使用。 */
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

  // 在 act 内调用客户端根的 render 或 hydrateRoot；兼容分支使用 legacy ReactDOM.render。
  /** 在 act 中完成 hydrateRoot或新根render；hydrate以 onRecoverableError转console.error但过滤指定根回退消息，非hydrate缺 client模块才回退legacy render。此函数不返回root也不统一卸载。 */
  async function asyncReactDOMRender(reactElement, domElement, forceHydrate) {
    if (forceHydrate) {
      await act(() => {
        ReactDOMClient.hydrateRoot(domElement, reactElement, {
          /** 过滤指定的整根切换客户端渲染消息，其它可恢复错误写 console.error供场景计数；不吞掉任意 hydration诊断。 */
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
  // 执行 fn 并过滤已知 console.error 噪声；有日志且过滤后数量不符时，DEV 校验原始调用次数。
  /** 清空/安装console.error mock并await fn；仅存在日志时过滤噪声，过滤数不匹配才打印并DEV断言原始调用总数。零调用或数量相等时不额外断言，因此此辅助器不是严格的逐条诊断匹配器。 */
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

  // 在 act 中完成客户端渲染或 hydration，经 expectErrors 检查日志后返回容器 firstChild。
  /** 经 expectErrors在 act 中完成 render/hydrate，再返回容器 firstChild；errorCount为期望日志数，返回首节点不检查其余结构。 */
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

  /** 在 Promise executor 中调用同步 renderToString；同步异常转拒绝，成功结果经 expectErrors作为 HTML字符串返回。 */
  async function renderIntoString(reactElement, errorCount = 0) {
    return await expectErrors(
      () =>
        new Promise(resolve =>
          resolve(ReactDOMServer.renderToString(reactElement)),
        ),
      errorCount,
    );
  }

  // 把 renderToString 的 HTML 解析为测试容器，返回 firstChild；此路径不创建客户端根。
  /** 字符串 SSR后解析适用容器并返回 firstChild，不创建客户端 Fiber根；场景可对解析后的 DOM形状断言。 */
  async function serverRender(reactElement, errorCount = 0) {
    const markup = await renderIntoString(reactElement, errorCount);
    return getContainerFromMarkup(reactElement, markup).firstChild;
  }

  // Writable 收集 Fizz 写出的每个 chunk，拼接到 .buffer。
  /** Node Writable子类，按写入顺序把每个 chunk字符串化后累加到 buffer，供流 finish时取完整HTML。 */
  class DrainWritable extends stream.Writable {
    /** 调用 Writable基类并把输出缓存设为空，options由 Node流基类解释。 */
    constructor(options) {
      super(options);
      this.buffer = '';
    }

    /** 把 chunk追加到 buffer后立即 cb确认写完，不模拟背压或延迟，也不使用 encoding另行解码。 */
    _write(chunk, encoding, cb) {
      this.buffer += chunk;
      cb();
    }
  }

  /** 创建 DrainWritable并pipe renderToPipeableStream；shell错误拒绝，Writable finish解析完整buffer后resolve，经expectErrors过滤诊断。本工具未另注册 Writable error回调。 */
  async function renderIntoStream(reactElement, errorCount = 0) {
    return await expectErrors(
      () =>
        new Promise((resolve, reject) => {
          const writable = new DrainWritable();
          const s = ReactDOMServer.renderToPipeableStream(reactElement, {
            /** 把无法产生shell的服务端错误传给 Promise.reject，避免等待正常finish结果。 */
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

  // 收集 Node 流输出并解析为 DOM，跳过开头的 doctype；此路径不创建客户端根。
  /** 等待流 finish得到HTML后解析容器；若firstChild是doctype则向nextSibling一步，返回第一个内容节点。 */
  async function streamRender(reactElement, errorCount = 0) {
    const markup = await renderIntoStream(reactElement, errorCount);
    let firstNode = getContainerFromMarkup(reactElement, markup).firstChild;
    if (firstNode && firstNode.nodeType === Node.DOCUMENT_TYPE_NODE) {
      // 跳过文档类型节点。
      firstNode = firstNode.nextSibling;
    }
    return firstNode;
  }

  /** 普通元素在新div中创建客户端根；顶层html改走正确服务器字符串的hydration，避免不合法空document初始化。 */
  const clientCleanRender = (element, errorCount = 0) => {
    if (shouldUseDocument(element)) {
      // 此辅助函数把整个文档的测试转到服务端字符串加 hydration 路径。
      return clientRenderOnServerString(element, errorCount);
    }
    const container = document.createElement('div');
    return renderIntoDom(element, container, false, errorCount);
  };

  /** 先SSR再resetModules，hydrate同一容器后逐个顶层节点比较类型与对象身份；返回firstClientNode，任何替换/数量变化都会失败。 */
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

  /** 专用空构造器，仅作为错误标记模式完成文本恢复后的拒绝哨兵，区别于渲染错误。 */
  function BadMarkupExpected() {}

  /** 用意外div标记触发hydration恢复，取末尾节点文本，再以空基准执行hydrate并比较文本；成功后抛专用哨兵终止当前模式，不继续进行原场景的结构或交互断言。 */
  const clientRenderOnBadMarkup = async (element, errorCount = 0) => {
    // 先建立含意外 div 的服务端容器，以触发 hydration mismatch。

    const container = getContainerFromMarkup(
      element,
      shouldUseDocument(element)
        ? '<html><body><div id="badIdWhichWillCauseMismatch" /></body></html>'
        : '<div id="badIdWhichWillCauseMismatch"></div>',
    );

    await renderIntoDom(element, container, true, errorCount + 1);

    // 记录错误标记经客户端恢复后的最后一个顶层节点文本。
    const hydratedTextContent =
      container.lastChild && container.lastChild.textContent;

    // 再对空白基准容器执行 hydration，比较客户端恢复后的文本。
    let cleanContainer;
    if (shouldUseDocument(element)) {
      // 整个文档的基准使用空 html 元素，改以其 children 作为 hydration 输入。
      cleanContainer = getContainerFromMarkup(
        element,
        '<html></html>',
      ).documentElement;
      element = element.props.children;
    } else {
      cleanContainer = document.createElement('div');
    }
    await asyncReactDOMRender(element, cleanContainer, true);
    // 基准容器的最后一个顶层节点提供预期文本。
    const cleanTextContent =
      (cleanContainer.lastChild && cleanContainer.lastChild.textContent) || '';

    // 此辅助函数在错误标记场景只比较最终文本内容，不继续验证节点结构和身份。
    expect(hydratedTextContent).toBe(cleanTextContent);

    // 抛出专用 BadMarkupExpected，让运行器结束此模式；普通错误仍会向外抛出。
    throw new BadMarkupExpected();
  };

  // 把用例扩展为五种模式：服务端字符串、服务端流、客户端全新渲染、正确标记的 hydration、
  // 错误标记的 hydration。testFn 接收 render(element, errorCount)，前三种及正确标记模式
  // 返回 DOM 节点；错误标记模式比较恢复后的文本并以 BadMarkupExpected 结束。
  // 服务端两种模式只解析 HTML，跨模式的断言应检查 DOM 输出。
  /** 把同一desc/testFn注册为字符串SSR、Node流SSR及三种客户端测试；testFn接render(element,errorCount)，错误标记模式由专用拒绝提前结束。 */
  function itRenders(desc, testFn) {
    /** 把调用方的 testFn 与 serverRender 绑定后注册普通 it；该模式 renderToString 后解析 HTML，不建客户端根，用同一 DOM 断言验证字符串 SSR 输出。 */
    it(`renders ${desc} with server string render`, () => testFn(serverRender));
    /** 把同一 testFn 与 streamRender 绑定注册 it；该模式收集 Node Writable finish 前全部 chunk后解析 HTML，验证 Node 流输出。 */
    it(`renders ${desc} with server stream render`, () => testFn(streamRender));
    /** 把同一 desc/testFn 交给三种客户端包装；各模式分别新建、认领正确标记、从错误标记恢复，避免字符串/流模式承担客户端交互断言。 */
    itClientRenders(desc, testFn);
  }

  // 客户端三种模式：全新渲染、复用正确服务端标记、从错误服务端标记恢复。
  // testFn 接收 render(element, errorCount)；前两种可继续检查返回节点的交互，
  // 错误标记模式只比较恢复文本，随后以 BadMarkupExpected 结束。
  /** 注册全新客户端、正确SSR标记认领、错误标记恢复三种测试；末种只接受BadMarkupExpected哨兵，普通渲染/断言错误原样传播。 */
  function itClientRenders(desc, testFn) {
    /** 同一 testFn 接 clientCleanRender；普通容器从空 div 创建根，html 元素改走正确 SSR 标记 hydration，验证适用容器的首次客户端输出。 */
    it(`renders ${desc} with clean client render`, () =>
      testFn(clientCleanRender));
    /** 同一 testFn 接 clientRenderOnServerString；SSR 后重置模块并 hydrate，辅助器逐顶层节点校验身份，验证认领而非替换。 */
    it(`renders ${desc} with client render on top of good server markup`, () =>
      testFn(clientRenderOnServerString));
    /** 同一 testFn 接 clientRenderOnBadMarkup；从错误 div 标记 hydration 后只比较末尾文本，专用 BadMarkupExpected 可终止本模式，普通异常必须继续抛，验证 mismatch 恢复而非后续交互。 */
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

  /** 把testFn Promise拒绝验证包装成it；成功resolve必须失败，错误须是Error且message含partialMessage，不接受任意非Error抛值。 */
  function itThrows(desc, testFn, partialMessage) {
    /** testFn 返回应拒绝的 Promise；若 resolve则显式失败，若 reject需为 Error且消息含 partialMessage，验证错误类型与诊断片段。 */
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

  /** 把错误场景分发到字符串SSR、新客户端及错误标记恢复三条路径；最后对warningCount减1，因为抛错使普通mismatch警告不再发生。 */
  function itThrowsWhenRendering(desc, testFn, partialMessage) {
    /** 对 serverRender 调用 testFn并要求 Error消息含 partialMessage，验证字符串 SSR 的抛错路径。 */
    itThrows(
      `when rendering ${desc} with server string render`,
      () => testFn(serverRender),
      partialMessage,
    );
    /** 对 clientCleanRender 调用 testFn并要求相同消息片段，验证首次客户端渲染错误传播。 */
    itThrows(
      `when rendering ${desc} with clean client render`,
      () => testFn(clientCleanRender),
      partialMessage,
    );

    // 我们在这里从警告计数中减去1，因为抛出意味着它不会得到通常的标记不匹配警告。
    /** 对错误标记恢复模式调用 testFn，warningCount减一以扣除未发生的普通 mismatch诊断；仍需捕获预期 Error而不是完成专用恢复标记，验证抛错中断恢复。 */
    itThrows(
      `when rendering ${desc} with client render on top of bad server markup`,
      () =>
        testFn((element, warningCount = 0) =>
          clientRenderOnBadMarkup(element, warningCount - 1),
        ),
      partialMessage,
    );
  }

  // 将 serverElement 的 HTML 放入容器，再用 clientElement 调用 hydrateRoot；
  // shouldMatch 选择传给日志检查器的预期错误数。
  /** 先serverRender得到节点并重置模块，再hydrate节点parentNode；shouldMatch决定传expectErrors的0/1错误预算，不另手工对比HTML。 */
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

  // hydration 匹配场景：传入预期错误数 0。
  /** 调用testMarkupMatch并使用0错误预算，验证服务端与客户端输入可在无mismatch诊断下认领。 */
  function expectMarkupMatch(serverElement, clientElement) {
    return testMarkupMatch(serverElement, clientElement, true);
  }

  // hydration 不匹配场景：传入预期错误数 1。
  /** 调用testMarkupMatch并使用1错误预算，验证不同输入应进入hydration诊断路径。 */
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
