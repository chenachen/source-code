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

import {patchMessageChannel} from '../../../../scripts/jest/patchMessageChannel';

import {
  getVisibleChildren,
  insertNodesAndExecuteScripts,
} from '../test-utils/FizzTestUtils';

// 测试环境的补丁
global.ReadableStream =
  require('web-streams-polyfill/ponyfill/es6').ReadableStream;
global.TextEncoder = require('util').TextEncoder;
global.TextDecoder = require('util').TextDecoder;

let JSDOM;
let React;
let ReactDOMFizzServer;
let ReactDOMFizzStatic;
let Suspense;
let SuspenseList;
let container;
let serverAct;

describe('ReactDOMFizzStaticBrowser', () => {
  beforeEach(() => {
    jest.resetModules();
    JSDOM = require('jsdom').JSDOM;

    // 我们需要在文档内部的模拟版本的 setTimeout。
    window.setTimeout = setTimeout;
    window.requestAnimationFrame = setTimeout;

    patchMessageChannel();
    serverAct = require('internal-test-utils').serverAct;

    React = require('react');
    ReactDOMFizzServer = require('react-dom/server.browser');
    ReactDOMFizzStatic = require('react-dom/static.browser');
    Suspense = React.Suspense;
    SuspenseList = React.unstable_SuspenseList;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (typeof global.window.__restoreGlobalScope === 'function') {
      global.window.__restoreGlobalScope();
    }
    document.body.removeChild(container);
  });

  const theError = new Error('This is an error');
  /**
   * 抛出同一共享 Error，供根错误、fallback 错误和边界内错误用例比较对象身份。
   * @returns 不返回；始终抛出 theError。
   */
  function Throw() {
    throw theError;
  }
  const theInfinitePromise = new Promise(() => {});
  /**
   * 抛出永不完成的共享 Promise，让边界或 shell 保持待决直到 signal 取消。
   * @returns 不返回；始终挂起。
   */
  function InfiniteSuspend() {
    throw theInfinitePromise;
  }

  /**
   * 顺序消费 ReadableStream，逐块按 UTF-8 拼接；只在 reader 返回 done 后交付完整字符串，读取拒绝沿 async Promise 向上传播。
   * @param stream - 要完整读取的 prelude 或恢复流。
   * @returns 解析为累计 HTML 字符串的 Promise。
   */
  async function readContent(stream) {
    const reader = stream.getReader();
    let content = '';
    while (true) {
      const {done, value} = await reader.read();
      if (done) {
        return content;
      }
      content += Buffer.from(value).toString('utf8');
    }
  }

  /**
   * 消费流后把 HTML 放入临时 div，移入测试 container 并执行其中的 Fizz 完成脚本，最后推进定时器，使可见结构断言观察脚本合并后的 DOM。
   * @param stream - 包含 HTML 与完成脚本的流。
   * @returns 完成 DOM 插入和脚本执行的 Promise，无结果值。
   */
  async function readIntoContainer(stream) {
    const reader = stream.getReader();
    let result = '';
    while (true) {
      const {done, value} = await reader.read();
      if (done) {
        break;
      }
      result += Buffer.from(value).toString('utf8');
    }
    const temp = document.createElement('div');
    temp.innerHTML = result;
    await insertNodesAndExecuteScripts(temp, container, null);
    jest.runAllTimers();
  }

  /**
   * 把完整输出作为新 JSDOM 文档执行，安装该文档的 window/document 等全局；保存原环境并挂载恢复函数，交由 afterEach 恢复后移除原 container。
   * @param stream - 完整文档 prelude 或恢复流。
   * @returns 全局环境切换完成的 Promise，无结果值。
   */
  async function readIntoNewDocument(stream) {
    const content = await readContent(stream);
    const jsdom = new JSDOM(
      // Fizz runtime 使用 requestAnimationFrame，因此为 JSDOM 补上替身。
      '<script>window.requestAnimationFrame = setTimeout;</script>' + content,
      {
        runScripts: 'dangerously',
      },
    );
    const originalWindow = global.window;
    const originalDocument = global.document;
    const originalNavigator = global.navigator;
    const originalNode = global.Node;
    const originalAddEventListener = global.addEventListener;
    const originalMutationObserver = global.MutationObserver;
    global.window = jsdom.window;
    global.document = global.window.document;
    global.navigator = global.window.navigator;
    global.Node = global.window.Node;
    global.addEventListener = global.window.addEventListener;
    global.MutationObserver = global.window.MutationObserver;
    /**
     * 恢复 readIntoNewDocument 保存的 window、document、navigator、Node 和事件/观察器入口；afterEach 必须先恢复环境，才可从原 document 移除测试 container。
     * @returns undefined；仅还原全局引用。
     */
    global.window.__restoreGlobalScope = () => {
      global.window = originalWindow;
      global.document = originalDocument;
      global.navigator = originalNavigator;
      global.Node = originalNode;
      global.addEventListener = originalAddEventListener;
      global.MutationObserver = originalMutationObserver;
    };
  }

  /**
   * 读取恢复流并将 HTML 与完成脚本插入当前 document.body，随后推进定时器；用于已有文档上的后续恢复，不新建 JSDOM。
   * @param stream - 后续恢复产生的流。
   * @returns 插入与脚本执行完成的 Promise，无结果值。
   */
  async function readIntoCurrentDocument(stream) {
    const content = await readContent(stream);
    const temp = document.createElement('div');
    temp.innerHTML = content;
    await insertNodesAndExecuteScripts(temp, document.body, null);
    jest.runAllTimers();
  }

  /** Given：普通 div 包含 hello world；When：等待 prerender 返回并完整读取 prelude；Then：快照为 <div>hello world</div>。目的：确认静态入口产出完整 HTML。 */
  it('should call prerender', async () => {
    const result = await serverAct(() =>
      ReactDOMFizzStatic.prerender(<div>hello world</div>),
    );
    const prelude = await readContent(result.prelude);
    expect(prelude).toMatchInlineSnapshot(`"<div>hello world</div>"`);
  });

  /** Given：根元素为 html/body 文档；When：prerender 后读取 prelude；Then：快照包含 DOCTYPE；阻塞渲染门控开启时另含 expect link 与模板，否则 head 为空。目的：验证文档前导和门控下的完成标记。 */
  it('should emit DOCTYPE at the root of the document', async () => {
    const result = await serverAct(() =>
      ReactDOMFizzStatic.prerender(
        <html>
          <body>hello world</body>
        </html>,
      ),
    );
    const prelude = await readContent(result.prelude);
    if (gate(flags => flags.enableFizzBlockingRender)) {
      expect(prelude).toMatchInlineSnapshot(
        `"<!DOCTYPE html><html><head><link rel="expect" href="#_R_" blocking="render"/></head><body>hello world<template id="_R_"></template></body></html>"`,
      );
    } else {
      expect(prelude).toMatchInlineSnapshot(
        `"<!DOCTYPE html><html><head></head><body>hello world</body></html>"`,
      );
    }
  });

  /** Given：设置内联 INIT()、经典 init.js 与模块 init.mjs 引导脚本；When：读取 prerender 的 prelude；Then：快照中预加载提示先于正文，执行脚本位于正文之后。目的：验证静态输出的资源提示和引导脚本位置。 */
  it('should emit bootstrap script src at the end', async () => {
    const result = await serverAct(() =>
      ReactDOMFizzStatic.prerender(<div>hello world</div>, {
        bootstrapScriptContent: 'INIT();',
        bootstrapScripts: ['init.js'],
        bootstrapModules: ['init.mjs'],
      }),
    );
    const prelude = await readContent(result.prelude);
    expect(prelude).toMatchInlineSnapshot(
      `"<link rel="preload" as="script" fetchPriority="low" href="init.js"/><link rel="modulepreload" fetchPriority="low" href="init.mjs"/><div>hello world</div><script id="_R_">INIT();</script><script src="init.js" async=""></script><script type="module" src="init.mjs" async=""></script>"`,
    );
  });

  /** Given：Wait 在 hasLoaded=false 时抛出待决 Promise，Suspense 提供 Loading；When：启动 prerender，推进定时器后设为已加载并 resolve；Then：prelude 快照只有完成边界的 Done，没有 Loading。目的：验证 prerender 等待内容完成后整批返回。 */
  it('emits all HTML as one unit', async () => {
    let hasLoaded = false;
    let resolve;
    const promise = new Promise(r => (resolve = r));
    /**
     * hasLoaded 为 false 时抛出同一 Promise；测试 resolve 后返回 Done，让 prerender 等到完整内容再输出。
     * @returns 已加载时为 Done，否则挂起。
     */
    function Wait() {
      if (!hasLoaded) {
        throw promise;
      }
      return 'Done';
    }
    const resultPromise = serverAct(() =>
      ReactDOMFizzStatic.prerender(
        <div>
          <Suspense fallback="Loading">
            <Wait />
          </Suspense>
        </div>,
      ),
    );

    await jest.runAllTimers();

    // 解决加载。
    hasLoaded = true;
    await resolve();

    const result = await resultPromise;
    const prelude = await readContent(result.prelude);
    expect(prelude).toMatchInlineSnapshot(`"<div><!--$-->Done<!--/$--></div>"`);
  });

  /** Given：Throw 在根 div 中抛出共享 theError；When：捕获 prerender 拒绝并记录 onError；Then：caughtError 与 theError 为同一对象，reportedErrors 为 [theError]。目的：验证边界外错误同时报告并拒绝结果。 */
  it('should reject the promise when an error is thrown at the root', async () => {
    const reportedErrors = [];
    let caughtError = null;
    try {
      await serverAct(() =>
        ReactDOMFizzStatic.prerender(
          <div>
            <Throw />
          </div>,
          {
            /**
             * 记录根渲染抛出的原始 Error，供 reportedErrors 与共享 theError 做身份断言。
             * @param x - 本次报告的错误。
             * @returns undefined。
             */
            onError(x) {
              reportedErrors.push(x);
            },
          },
        ),
      );
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBe(theError);
    expect(reportedErrors).toEqual([theError]);
  });

  /** Given：主内容永久挂起，Suspense fallback 中的 Throw 抛错；When：捕获 prerender 拒绝；Then：caughtError 与 theError 相同，reportedErrors 为 [theError]。目的：验证 fallback 自身失败导致根输出失败。 */
  it('should reject the promise when an error is thrown inside a fallback', async () => {
    const reportedErrors = [];
    let caughtError = null;
    try {
      await serverAct(() =>
        ReactDOMFizzStatic.prerender(
          <div>
            <Suspense fallback={<Throw />}>
              <InfiniteSuspend />
            </Suspense>
          </div>,
          {
            /**
             * 收集 fallback 抛出的原始 Error，与 prerender 拒绝原因共同验证根失败。
             * @param x - fallback 渲染错误。
             * @returns undefined。
             */
            onError(x) {
              reportedErrors.push(x);
            },
          },
        ),
      );
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBe(theError);
    expect(reportedErrors).toEqual([theError]);
  });

  /** Given：Throw 位于带 Loading fallback 的 Suspense 内；When：完成 prerender 并读取 prelude；Then：输出包含 Loading，reportedErrors 为 [theError]。目的：验证边界内错误保留可用 fallback 输出。 */
  it('should not error the stream when an error is thrown inside suspense boundary', async () => {
    const reportedErrors = [];
    const result = await serverAct(() =>
      ReactDOMFizzStatic.prerender(
        <div>
          <Suspense fallback={<div>Loading</div>}>
            <Throw />
          </Suspense>
        </div>,
        {
          /**
           * 收集边界主内容抛出的原始 Error；用例同时确认 prelude 仍包含 Loading。
           * @param x - Suspense 内错误。
           * @returns undefined。
           */
          onError(x) {
            reportedErrors.push(x);
          },
        },
      ),
    );

    const prelude = await readContent(result.prelude);
    expect(prelude).toContain('Loading');
    expect(reportedErrors).toEqual([theError]);
  });

  /** Given：边界内 InfiniteSuspend 永久挂起，controller 尚未取消；When：先启动 prerender，再调用无参数 abort 并读取结果；Then：输出包含 Loading，errors 精确为 [This operation was aborted]。目的：验证取消可结束静态等待并输出已就绪 fallback。 */
  it('should be able to complete by aborting even if the promise never resolves', async () => {
    const errors = [];
    const controller = new AbortController();
    let resultPromise;
    await serverAct(() => {
      resultPromise = ReactDOMFizzStatic.prerender(
        <div>
          <Suspense fallback={<div>Loading</div>}>
            <InfiniteSuspend />
          </Suspense>
        </div>,
        {
          signal: controller.signal,
          /**
           * 提取默认取消原因的 message，供单元素错误数组断言。
           * @param x - 取消产生的错误。
           * @returns undefined。
           */
          onError(x) {
            errors.push(x.message);
          },
        },
      );
    });

    await serverAct(() => {
      controller.abort();
    });

    const result = await resultPromise;

    const prelude = await readContent(result.prelude);
    expect(prelude).toContain('Loading');

    expect(errors).toEqual(['This operation was aborted']);
  });

  /** Given：InfiniteSuspend 位于边界外，shell 尚未完成；When：推进定时器后以 Error(aborted for reasons) 取消；Then：结果不拒绝，errors 只有该消息，prelude 为空串。目的：验证取消未完成 shell 时返回空输出。 */
  it('should resolve an empty prelude if aborting before the shell is complete', async () => {
    const errors = [];
    const controller = new AbortController();
    const promise = serverAct(() =>
      ReactDOMFizzStatic.prerender(
        <div>
          <InfiniteSuspend />
        </div>,
        {
          signal: controller.signal,
          /**
           * 收集 shell 完成前取消所报告的 message，供 aborted for reasons 断言。
           * @param x - 取消 Error。
           * @returns undefined。
           */
          onError(x) {
            errors.push(x.message);
          },
        },
      ),
    );

    await jest.runAllTimers();

    const theReason = new Error('aborted for reasons');
    await serverAct(() => {
      controller.abort(theReason);
    });

    let rejected = false;
    let prelude;
    try {
      ({prelude} = await promise);
    } catch (error) {
      rejected = true;
    }
    expect(rejected).toBe(false);
    expect(errors).toEqual(['aborted for reasons']);
    const content = await readContent(prelude);
    expect(content).toBe('');
  });

  /** Given：App 进入时先调用无参数 abort，然后构造带永久挂起子树的边界；When：等待静态结果；Then：prelude 为空串，errors 为 [This operation was aborted]。目的：验证取消在子节点开始挂起之前已终止工作。 */
  it('should be able to abort before something suspends', async () => {
    const errors = [];
    const controller = new AbortController();
    /**
     * 先取消整个请求，再返回带 Loading 与永久挂起子树的边界；顺序刻意让取消早于子节点挂起。
     * @returns Suspense 元素，但请求已取消。
     */
    function App() {
      controller.abort();
      return (
        <Suspense fallback={<div>Loading</div>}>
          <InfiniteSuspend />
        </Suspense>
      );
    }
    const streamPromise = serverAct(() =>
      ReactDOMFizzStatic.prerender(
        <div>
          <App />
        </div>,
        {
          signal: controller.signal,
          /**
           * 收集 App 提前取消的默认错误消息。
           * @param x - 默认取消 Error。
           * @returns undefined。
           */
          onError(x) {
            errors.push(x.message);
          },
        },
      ),
    );

    const {prelude} = await streamPromise;
    const content = await readContent(prelude);
    expect(errors).toEqual(['This operation was aborted']);
    expect(content).toBe('');
  });

  /** Given：App 先以 Error(abort reason) 取消，再 use 待决 Promise；When：等待 prerender 返回并读取内容；Then：errors 为 [abort reason]，prelude 为空串。目的：验证取消后的 use 挂起不替换取消原因。 */
  it('reports the abort reason if a task suspends after aborting a prerender', async () => {
    const promise = new Promise(() => {});
    const errors = [];
    const controller = new AbortController();
    /**
     * 先以 abort reason 取消，再调用 use 读取待决 Promise；检验随后挂起不会改变已确定的取消原因。
     * @returns use 完成时返回 null；本用例中先取消并挂起。
     */
    function App() {
      controller.abort(new Error('abort reason'));
      React.use(promise);
      return null;
    }

    const result = await serverAct(() =>
      ReactDOMFizzStatic.prerender(<App />, {
        signal: controller.signal,
        /**
         * 记录取消后 use 场景的错误 message。
         * @param error - 请求错误。
         * @returns undefined。
         */
        onError(error) {
          errors.push(error.message);
        },
      }),
    );

    expect(errors).toEqual(['abort reason']);
    expect(await readContent(result.prelude)).toBe('');
  });

  /** Given：controller 在 prerender 调用前已携带 Error(aborted for reasons) 取消；When：传入已取消 signal 并读取结果；Then：不会抛错，errors 为该消息，prelude 为空串。目的：验证预先取消会阻止 shell 工作。 */
  it('should resolve an empty prelude if passing an already aborted signal', async () => {
    const errors = [];
    const controller = new AbortController();
    const theReason = new Error('aborted for reasons');
    controller.abort(theReason);

    const promise = serverAct(() =>
      ReactDOMFizzStatic.prerender(
        <div>
          <Suspense fallback={<div>Loading</div>}>
            <InfiniteSuspend />
          </Suspense>
        </div>,
        {
          signal: controller.signal,
          /**
           * 收集调用入口前已取消 signal 的错误 message。
           * @param x - 已取消 signal 的 Error。
           * @returns undefined。
           */
          onError(x) {
            errors.push(x.message);
          },
        },
      ),
    );

    // 技术上仍可继续渲染 shell，但当前语义还会中止所有待处理的 CPU 工作。
    let didThrow = false;
    let prelude;
    try {
      ({prelude} = await promise);
    } catch (error) {
      didThrow = true;
    }
    expect(didThrow).toBe(false);
    expect(errors).toEqual(['aborted for reasons']);
    const content = await readContent(prelude);
    expect(content).toBe('');
  });

  /** Given：两个 Suspense 边界分别挂起，onError 返回同一 digest；When：启动后用字符串 foobar 取消并等待结果；Then：errors 为 [foobar, foobar]；本用例没有读取或断言 HTML。目的：验证每个待决边界收到原始字符串取消原因。 */
  it('supports custom abort reasons with a string', async () => {
    const promise = new Promise(r => {});
    /**
     * 始终抛出本用例待决 Promise，让两个使用它的边界均等待取消。
     * @returns 不返回；挂起。
     */
    function Wait() {
      throw promise;
    }
    /**
     * 构造 p 与 span 两个独立 Loading 边界，分别使用 Wait；错误数组用于检查两次字符串取消报告。
     * @returns 包含两个 Suspense 的 div。
     */
    function App() {
      return (
        <div>
          <p>
            <Suspense fallback={'p'}>
              <Wait />
            </Suspense>
          </p>
          <span>
            <Suspense fallback={'span'}>
              <Wait />
            </Suspense>
          </span>
        </div>
      );
    }

    const errors = [];
    const controller = new AbortController();
    let resultPromise;
    await serverAct(() => {
      resultPromise = ReactDOMFizzStatic.prerender(<App />, {
        signal: controller.signal,
        /**
         * 保留原始字符串取消原因，两个边界各调用一次；返回 digest 供服务端错误协议使用，用例仅断言 errors。
         * @param x - 原始取消值 foobar。
         * @returns 固定字符串 a digest。
         */
        onError(x) {
          errors.push(x);
          return 'a digest';
        },
      });
    });

    await serverAct(() => {
      controller.abort('foobar');
    });

    await resultPromise;

    expect(errors).toEqual(['foobar', 'foobar']);
  });

  /** Given：两个 Suspense 边界分别挂起，onError 返回 digest；When：启动后用 Error(uh oh) 取消；Then：消息数组为 [uh oh, uh oh]；不检查 HTML。目的：验证 Error 取消原因分别报告到两个边界。 */
  it('supports custom abort reasons with an Error', async () => {
    const promise = new Promise(r => {});
    /**
     * 抛出本用例永久待决 Promise，让两个边界在 Error 取消前保持挂起。
     * @returns 不返回；挂起。
     */
    function Wait() {
      throw promise;
    }
    /**
     * 构造两个独立 Suspense 边界，以 p/span 作为各自 fallback。
     * @returns 双边界 div。
     */
    function App() {
      return (
        <div>
          <p>
            <Suspense fallback={'p'}>
              <Wait />
            </Suspense>
          </p>
          <span>
            <Suspense fallback={'span'}>
              <Wait />
            </Suspense>
          </span>
        </div>
      );
    }

    const errors = [];
    const controller = new AbortController();
    let resultPromise;
    await serverAct(() => {
      resultPromise = ReactDOMFizzStatic.prerender(<App />, {
        signal: controller.signal,
        /**
         * 把两个边界收到的 Error 转为 message，返回 digest 参与服务端协议；断言针对两项 uh oh 消息。
         * @param x - 自定义取消 Error。
         * @returns a digest。
         */
        onError(x) {
          errors.push(x.message);
          return 'a digest';
        },
      });
    });

    await serverAct(() => {
      controller.abort(new Error('uh oh'));
    });

    await resultPromise;

    expect(errors).toEqual(['uh oh', 'uh oh']);
  });

  /** Given：一个 use 等待可拒绝 Promise，另一个永久挂起；abort 监听器会拒绝前者；When：以 Error(abort reason) 取消，监听器同步 reject(Error(rejected during abort))；Then：errors 按顺序为 rejected during abort、abort reason。目的：验证取消过程中已发生的拒绝保留自身错误原因。 */
  it('uses a rejection reason when an abort listener rejects pending work before the abort finishes', async () => {
    let reject;
    const rejectedPromise = new Promise((resolve, rejectPromise) => {
      reject = rejectPromise;
    });
    const haltedPromise = new Promise(() => {});
    /**
     * use 可被 abort 监听器拒绝的 Promise，使该边界在取消过程中先获得 rejected during abort。
     * @returns Promise 成功时为 null；本用例为挂起后拒绝。
     */
    function RejectedWait() {
      React.use(rejectedPromise);
      return null;
    }
    /**
     * use 永不完成的 Promise，使另一个边界保留 abort reason。
     * @returns Promise 完成时为 null；本用例始终挂起。
     */
    function HaltedWait() {
      React.use(haltedPromise);
      return null;
    }

    const errors = [];
    const controller = new AbortController();
    let resultPromise;
    await serverAct(() => {
      resultPromise = ReactDOMFizzStatic.prerender(
        <>
          <Suspense fallback="Loading rejected">
            <RejectedWait />
          </Suspense>
          <Suspense fallback="Loading halted">
            <HaltedWait />
          </Suspense>
        </>,
        {
          signal: controller.signal,
          /**
           * 按发生顺序收集错误消息，区分监听器导致的拒绝与仍待决边界的取消。
           * @param error - 本次拒绝或取消 Error。
           * @returns undefined。
           */
          onError(error) {
            errors.push(error.message);
          },
        },
      );
    });

    controller.signal.addEventListener('abort', () => {
      reject(new Error('rejected during abort'));
    });
    await serverAct(() => {
      controller.abort(new Error('abort reason'));
    });
    await resultPromise;

    expect(errors).toEqual(['rejected during abort', 'abort reason']);
  });

  /** Given：普通 hello 内容的 onHeaders 抛出 bad onHeaders；When：等待 prerender 后把 prelude 执行到 container；Then：postponed 为 null，errors 为 [bad onHeaders]，可见内容仍为 div hello。目的：验证头部回调错误被报告但不破坏可用输出。 */
  it('logs an error if onHeaders throws but continues the prerender', async () => {
    const errors = [];
    /**
     * 收集 onHeaders 失败的消息，供非致命头部回调错误断言。
     * @param error - 回调抛出的 Error。
     * @returns undefined。
     */
    function onError(error) {
      errors.push(error.message);
    }

    /**
     * 主动抛出 bad onHeaders，测试该回调失败不会阻止正常 HTML 输出。
     * @param x - 服务端提供的头部数据，本 fixture 不读取。
     * @returns 不返回；抛出 Error。
     */
    function onHeaders(x) {
      throw new Error('bad onHeaders');
    }

    const prerendered = await serverAct(() =>
      ReactDOMFizzStatic.prerender(<div>hello</div>, {
        onHeaders,
        onError,
      }),
    );
    expect(prerendered.postponed).toBe(null);
    expect(errors).toEqual(['bad onHeaders']);

    await readIntoContainer(prerendered.prelude);
    expect(getVisibleChildren(container)).toEqual(<div>hello</div>);
  });

  /** Given：A、B 分别等待手动 Promise，外层 Loading A，内层 Loading B；When：取消首轮并读 Loading A；resolve A 后 resumeAndPrerender 再取消；resolve B 后 resume；Then：可见结构依次为 Loading A、Loading B、Hello，第一轮 postponed 非空；errors 仅收集，未断言数组或节点身份。目的：验证序列化 postponed 状态支持两次分阶段恢复。 */
  it('can resume render of a prerender', async () => {
    const errors = [];

    let resolveA;
    const promiseA = new Promise(r => (resolveA = r));
    let resolveB;
    const promiseB = new Promise(r => (resolveB = r));

    /**
     * 等待 promiseA 后构造等待 B 的内层边界；首轮由外层显示 Loading A，次轮由内层显示 Loading B。
     * @returns 解析为内层 Suspense 元素的 Promise。
     */
    async function ComponentA() {
      await promiseA;
      return (
        <Suspense fallback="Loading B">
          <ComponentB />
        </Suspense>
      );
    }

    /**
     * 等待 promiseB 才返回 Hello，完成第三阶段的恢复。
     * @returns 解析为 Hello 的 Promise。
     */
    async function ComponentB() {
      await promiseB;
      return 'Hello';
    }

    /**
     * 把异步 A 放入 Loading A 边界，A 完成后再暴露内层 B 边界。
     * @returns 三阶段恢复用 div。
     */
    function App() {
      return (
        <div>
          <Suspense fallback="Loading A">
            <ComponentA />
          </Suspense>
        </div>
      );
    }

    const controller = new AbortController();
    let pendingResult;
    await serverAct(async () => {
      pendingResult = ReactDOMFizzStatic.prerender(<App />, {
        signal: controller.signal,
        /**
         * 收集首轮取消的错误消息；本用例断言各阶段可见结构，没有断言该 errors 数组。
         * @param x - 首轮请求错误。
         * @returns undefined。
         */
        onError(x) {
          errors.push(x.message);
        },
      });
    });

    await serverAct(() => {
      controller.abort();
    });
    const prerendered = await pendingResult;
    const postponedState = JSON.stringify(prerendered.postponed);

    await readIntoContainer(prerendered.prelude);
    expect(getVisibleChildren(container)).toEqual(<div>Loading A</div>);

    await resolveA();

    expect(prerendered.postponed).not.toBe(null);

    const controller2 = new AbortController();
    await serverAct(async () => {
      pendingResult = ReactDOMFizzStatic.resumeAndPrerender(
        <App />,
        JSON.parse(postponedState),
        {
          signal: controller2.signal,
          /**
           * 将第二轮恢复预渲染的错误消息追加到同一数组；其内容未作为本用例断言。
           * @param x - 第二轮请求错误。
           * @returns undefined。
           */
          onError(x) {
            errors.push(x.message);
          },
        },
      );
    });

    await serverAct(() => {
      controller2.abort();
    });

    const prerendered2 = await pendingResult;
    const postponedState2 = JSON.stringify(prerendered2.postponed);

    await readIntoContainer(prerendered2.prelude);
    expect(getVisibleChildren(container)).toEqual(<div>Loading B</div>);

    await resolveB();

    const dynamic = await serverAct(() =>
      ReactDOMFizzServer.resume(<App />, JSON.parse(postponedState2)),
    );

    await readIntoContainer(dynamic);
    expect(getVisibleChildren(container)).toEqual(<div>Hello</div>);
  });

  /** Given：首轮取消留下 Loading 1；回放阶段 AbortDuringReplay 调用 resumeController.abort；When：切到恢复模式，JSON 往返 postponed 后调用 resume；Then：errors 精确为 [resume abort]；没有读取恢复 DOM。目的：验证回放路径内取消的原始原因只报告一次。 */
  it('can abort while replaying a prerendered tree', async () => {
    const promise = new Promise(() => {});
    let prerendering = true;
    const resumeController = new AbortController();

    /**
     * 首轮透传 children；恢复回放时先取消 resumeController，再透传，以触发回放内部取消。
     * @param props - children 为待回放边界。
     * @returns children。
     */
    function AbortDuringReplay({children}) {
      if (!prerendering) {
        resumeController.abort('resume abort');
      }
      return children;
    }

    /**
     * 首轮 use 待决 Promise；恢复模式返回 Hello，避免新增挂起干扰回放取消断言。
     * @returns 首轮挂起，恢复时为 Hello。
     */
    function Wait() {
      return prerendering ? React.use(promise) : 'Hello';
    }

    /**
     * 在 AbortDuringReplay 内放置 Loading 1 边界，生成可供恢复回放的路径。
     * @returns 测试 div。
     */
    function App() {
      return (
        <div>
          <AbortDuringReplay>
            <Suspense fallback="Loading 1...">
              <Wait />
            </Suspense>
          </AbortDuringReplay>
        </div>
      );
    }

    const controller = new AbortController();
    let pendingResult;
    await serverAct(() => {
      pendingResult = ReactDOMFizzStatic.prerender(<App />, {
        signal: controller.signal,
        /**
         * 忽略建立 postponed 状态时的预期首轮取消错误；实际断言只检查恢复阶段 errors。
         * @returns undefined。
         */
        onError() {},
      });
    });
    await serverAct(() => {
      controller.abort('prerender abort');
    });
    const prerendered = await pendingResult;

    prerendering = false;
    const errors = [];
    await serverAct(() =>
      ReactDOMFizzServer.resume(
        <App />,
        JSON.parse(JSON.stringify(prerendered.postponed)),
        {
          signal: resumeController.signal,
          /**
           * 保留恢复回放收到的原始字符串取消原因，供单次 resume abort 断言。
           * @param error - 恢复请求错误值。
           * @returns undefined。
           */
          onError(error) {
            errors.push(error);
          },
        },
      ),
    );

    expect(errors).toEqual(['resume abort']);
  });

  /** Given：首轮取消留下 Loading 1；回放组件在取消后还 use 永久 Promise；When：恢复序列化 postponed，等待 resume 结果；Then：errors 为 [resume abort]；没有 HTML 或节点身份断言。目的：验证回放同时取消和挂起时不重复错误报告。 */
  it('can abort and suspend while replaying a prerendered tree', async () => {
    const promise = new Promise(() => {});
    let prerendering = true;
    const resumeController = new AbortController();

    /**
     * 恢复时先取消请求，再 use 永久待决 Promise；首轮仅透传 children，专门覆盖取消与挂起重合。
     * @param props - children 为待回放边界。
     * @returns 首轮为 children；恢复阶段挂起。
     */
    function AbortDuringReplay({children}) {
      if (!prerendering) {
        resumeController.abort('resume abort');
        React.use(promise);
      }
      return children;
    }

    /**
     * 始终 use 待决 Promise，让边界在首轮与恢复时均可挂起。
     * @returns Promise 结果；本用例不完成。
     */
    function Wait() {
      return React.use(promise);
    }

    /**
     * 在取消后挂起的回放组件内构造 Loading 1 边界。
     * @returns 测试 div。
     */
    function App() {
      return (
        <div>
          <AbortDuringReplay>
            <Suspense fallback="Loading...">
              <Wait />
            </Suspense>
          </AbortDuringReplay>
        </div>
      );
    }

    const controller = new AbortController();
    let pendingResult;
    await serverAct(() => {
      pendingResult = ReactDOMFizzStatic.prerender(<App />, {
        signal: controller.signal,
        /**
         * 忽略生成 postponed 状态时的预期取消错误，避免混入恢复错误数组。
         * @returns undefined。
         */
        onError() {},
      });
    });
    await serverAct(() => {
      controller.abort('prerender abort');
    });
    const prerendered = await pendingResult;

    prerendering = false;
    const errors = [];
    await serverAct(() =>
      ReactDOMFizzServer.resume(
        <App />,
        JSON.parse(JSON.stringify(prerendered.postponed)),
        {
          signal: resumeController.signal,
          /**
           * 收集恢复中取消且挂起的原始错误值，验证只记录一次 resume abort。
           * @param error - 恢复错误值。
           * @returns undefined。
           */
          onError(error) {
            errors.push(error);
          },
        },
      ),
    );

    expect(errors).toEqual(['resume abort']);
  });

  /** Given：首轮 Wait 挂起，恢复时 Wait 在渲染内容段内取消然后返回 Hello；When：JSON 往返 postponed 后 resume；Then：errors 为 [resume abort]；不读取流内容。目的：验证恢复段渲染期间的取消仅报告一次。 */
  it('can abort while rendering a resumed segment', async () => {
    const promise = new Promise(() => {});
    let prerendering = true;
    const resumeController = new AbortController();

    /**
     * 首轮 use Promise 挂起；恢复段渲染时取消请求并返回 Hello，把取消位置放在段内容而非祖先回放中。
     * @returns 首轮挂起，恢复时为 Hello。
     */
    function Wait() {
      if (prerendering) {
        return React.use(promise);
      }
      resumeController.abort('resume abort');
      return 'Hello';
    }

    /**
     * 用 Loading 1 边界包住会在恢复段内取消的 Wait。
     * @returns 测试 div。
     */
    function App() {
      return (
        <div>
          <Suspense fallback="Loading...">
            <Wait />
          </Suspense>
        </div>
      );
    }

    const controller = new AbortController();
    let pendingResult;
    await serverAct(() => {
      pendingResult = ReactDOMFizzStatic.prerender(<App />, {
        signal: controller.signal,
        /**
         * 忽略首轮为建立 postponed 状态而触发的取消。
         * @returns undefined。
         */
        onError() {},
      });
    });
    await serverAct(() => {
      controller.abort('prerender abort');
    });
    const prerendered = await pendingResult;

    prerendering = false;
    const errors = [];
    await serverAct(() =>
      ReactDOMFizzServer.resume(
        <App />,
        JSON.parse(JSON.stringify(prerendered.postponed)),
        {
          signal: resumeController.signal,
          /**
           * 收集恢复段渲染期间的原始取消原因，供单次报告断言。
           * @param error - 恢复错误值。
           * @returns undefined。
           */
          onError(error) {
            errors.push(error);
          },
        },
      ),
    );

    expect(errors).toEqual(['resume abort']);
  });

  /** Given：外层 Suspense 包住 html/body 文档，A/B 依次挂起；When：第一轮取消读入新文档；resolve A 后恢复预渲染再取消；resolve B 后 resume 到当前文档；Then：可见文档 body 依次为 Loading A、Loading B、Hello，首轮状态非空；errors 未作数组断言，也未比较节点身份。目的：验证文档 preamble 在多阶段恢复中保持正确结构。 */
  it('can prerender a preamble', async () => {
    const errors = [];

    let resolveA;
    const promiseA = new Promise(r => (resolveA = r));
    let resolveB;
    const promiseB = new Promise(r => (resolveB = r));

    /**
     * 等待 A 后返回包住 B 的 Loading B 边界，使完整文档恢复也能分三阶段。
     * @returns 解析为 Suspense 元素的 Promise。
     */
    async function ComponentA() {
      await promiseA;
      return (
        <Suspense fallback="Loading B">
          <ComponentB />
        </Suspense>
      );
    }

    /**
     * 等待 B 后返回最终文档正文 Hello。
     * @returns 解析为 Hello 的 Promise。
     */
    async function ComponentB() {
      await promiseB;
      return 'Hello';
    }

    /**
     * 外层无显式 fallback 的边界包住 html/body，body 内另设 Loading A 边界；文档前导与内部内容一起参与暂停恢复。
     * @returns 文档级 Suspense 元素。
     */
    function App() {
      return (
        <Suspense>
          <html data-x="">
            <body data-x="">
              <Suspense fallback="Loading A">
                <ComponentA />
              </Suspense>
            </body>
          </html>
        </Suspense>
      );
    }

    const controller = new AbortController();
    let pendingResult;
    await serverAct(async () => {
      pendingResult = ReactDOMFizzStatic.prerender(<App />, {
        signal: controller.signal,
        /**
         * 收集文档首轮取消的 message；用例比较可见文档结构，不断言该数组。
         * @param x - 首轮错误。
         * @returns undefined。
         */
        onError(x) {
          errors.push(x.message);
        },
      });
    });

    await serverAct(() => {
      controller.abort();
    });

    const prerendered = await pendingResult;
    const postponedState = JSON.stringify(prerendered.postponed);

    await readIntoNewDocument(prerendered.prelude);
    expect(getVisibleChildren(document)).toEqual(
      <html data-x="">
        <head />
        <body data-x="">Loading A</body>
      </html>,
    );

    await resolveA();

    expect(prerendered.postponed).not.toBe(null);

    const controller2 = new AbortController();
    await serverAct(async () => {
      pendingResult = ReactDOMFizzStatic.resumeAndPrerender(
        <App />,
        JSON.parse(postponedState),
        {
          signal: controller2.signal,
          /**
           * 追加第二轮文档恢复预渲染的 message，保留调试信息；没有 errors 数组断言。
           * @param x - 第二轮错误。
           * @returns undefined。
           */
          onError(x) {
            errors.push(x.message);
          },
        },
      );
    });

    await serverAct(() => {
      controller2.abort();
    });

    const prerendered2 = await pendingResult;
    const postponedState2 = JSON.stringify(prerendered2.postponed);

    await readIntoCurrentDocument(prerendered2.prelude);
    expect(getVisibleChildren(document)).toEqual(
      <html data-x="">
        <head />
        <body data-x="">Loading B</body>
      </html>,
    );

    await resolveB();

    const dynamic = await serverAct(() =>
      ReactDOMFizzServer.resume(<App />, JSON.parse(postponedState2)),
    );

    await readIntoCurrentDocument(dynamic);
    expect(getVisibleChildren(document)).toEqual(
      <html data-x="">
        <head />
        <body data-x="">Hello</body>
      </html>,
    );
  });

  /** Given：head 中 Metadata use 永久 Promise，fallback 是 meta；body 已有 hello；When：以 Error(boom) 取消，并把 prelude 读入新文档；Then：可见 head 保留 fallback meta，body 保留 hello，errors 为 [boom]。目的：验证 head 挂起可随取消输出 fallback。 */
  it('can suspend inside <head> tag', async () => {
    const promise = new Promise(() => {});

    /**
     * 把永久挂起的 Metadata 放在 head 边界内，fallback 为 meta，body 提供已就绪 hello。
     * @returns 完整 html 元素。
     */
    function App() {
      return (
        <html>
          <head>
            <Suspense fallback={<meta itemProp="" content="fallback" />}>
              <Metadata />
            </Suspense>
          </head>
          <body>
            <div>hello</div>
          </body>
        </html>
      );
    }

    /**
     * use 永久 Promise 阻止 primary meta 完成，让取消后的 head 保留 fallback。
     * @returns Promise 完成时为 primary meta；本用例挂起。
     */
    function Metadata() {
      React.use(promise);
      return <meta itemProp="" content="primary" />;
    }

    const controller = new AbortController();
    let pendingResult;
    const errors = [];
    await serverAct(() => {
      pendingResult = ReactDOMFizzStatic.prerender(<App />, {
        signal: controller.signal,
        /**
         * 把 head 挂起后取消的错误 message 追加到 errors，供 boom 断言。
         * @param e - 请求 Error。
         * @returns undefined；回调仅追加消息。
         */
        onError: e => {
          errors.push(e.message);
        },
      });
    });

    await serverAct(() => {
      controller.abort(new Error('boom'));
    });

    const prerendered = await pendingResult;

    await readIntoNewDocument(prerendered.prelude);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head>
          <meta itemprop="" content="fallback" />
        </head>
        <body>
          <div>hello</div>
        </body>
      </html>,
    );

    expect(errors).toEqual(['boom']);
  });

  /** Given：首轮 Boom 挂起；外层边界的错误 fallback 是完整文档；When：取消首轮得到空 prelude，再切换 Boom 为抛错并 resume；Then：首轮 errors 为 [This operation was aborted]；恢复 errors 为 [Boom!]，最终显示 data-error 文档和 hello error。目的：验证 shell 为空时恢复仍能生成完整文档错误 fallback。 */
  it('will render fallback Document when erroring a boundary above the body', async () => {
    let isPrerendering = true;
    const promise = new Promise(() => {});

    /**
     * 首轮 use Promise 挂起，恢复模式跳过 use 并抛出 Boom!，触发完整文档 fallback。
     * @returns 不返回；首轮挂起，恢复时抛错。
     */
    function Boom() {
      if (isPrerendering) {
        React.use(promise);
      }
      throw new Error('Boom!');
    }

    /**
     * 在外层 Suspense 设置完整 data-error 文档 fallback，主文档 body 包含 Boom 与 hello world。
     * @returns 带文档级错误 fallback 的边界。
     */
    function App() {
      return (
        <Suspense
          fallback={
            <html data-error-html="">
              <body data-error-body="">
                <span>hello error</span>
              </body>
            </html>
          }>
          <html data-content-html="">
            <body data-content-body="">
              <Boom />
              <span>hello world</span>
            </body>
          </html>
        </Suspense>
      );
    }

    const controller = new AbortController();
    let pendingResult;
    const errors = [];
    await serverAct(() => {
      pendingResult = ReactDOMFizzStatic.prerender(<App />, {
        signal: controller.signal,
        /**
         * 记录首轮取消 Error 的 message，断言默认取消原因。
         * @param e - 首轮错误。
         * @returns undefined；回调仅追加消息。
         */
        onError: e => {
          errors.push(e.message);
        },
      });
    });

    await serverAct(() => {
      controller.abort();
    });

    const prerendered = await pendingResult;

    expect(errors).toEqual(['This operation was aborted']);
    const content = await readContent(prerendered.prelude);
    expect(content).toBe('');

    isPrerendering = false;
    const postponedState = JSON.stringify(prerendered.postponed);

    const resumeErrors = [];
    const dynamic = await serverAct(() =>
      ReactDOMFizzServer.resume(<App />, JSON.parse(postponedState), {
        /**
         * 记录恢复时 Boom! 的 message，供恢复错误数组断言。
         * @param e - 恢复错误。
         * @returns undefined；回调仅追加消息。
         */
        onError: e => {
          resumeErrors.push(e.message);
        },
      }),
    );

    expect(resumeErrors).toEqual(['Boom!']);
    await readIntoNewDocument(dynamic);

    expect(getVisibleChildren(document)).toEqual(
      <html data-error-html="">
        <head />
        <body data-error-body="">
          <span>hello error</span>
        </body>
      </html>,
    );
  });

  /** Given：800 字符 shell 边界被 progressiveChunkSize=100 外置，另一 Hole 首轮挂起；When：取消后拼接 shell 与 resume HTML，执行完成脚本；Then：可见 div 同时包含 800 个 a 与 800 个 b；没有 Loading C，未直接断言 ID 或错误数组。目的：复现 postponed 快照与已输出段 ID 的碰撞，避免完成脚本找错元素。 */
  it('reveals a resumed boundary even when the shell outlined a completed boundary', async () => {
    // 针对 prerender shell 与 resume 之间 segment ID 冲突的回归测试。prelude flush 会把一个大型且
    // 已完成的边界 outline 到 shell，使 request.nextSegmentId 越过 getPostponedState 在 flush 前保存的值。
    // 若该快照未在 flush 后最终确定，resume 会重新分配 shell 已使用的 ID；输出文档中的 `$RC`
    //（getElementById 取首个匹配项）便会显示错误元素，让恢复的边界一直停在 fallback。
    // 因此这里断言渲染输出，而不是直接断言 segment ID。
    let prerendering = true;
    const shellText = 'a'.repeat(800); // 超过 500 字节，可被 outline。
    const resumeText = 'b'.repeat(800);

    // 在预渲染期间完成；内容足够大，使 prelude 冲刷时将它拆分并写入 shell。
    /**
     * 返回 800 字符 shell 内容；它超过 progressiveChunkSize=100，会形成外置完成段，覆盖 shell 输出后段 ID 推进的回归条件。
     * @returns 包含 shellText 的 div。
     */
    function ShellBoundary() {
      return <div>{shellText}</div>;
    }

    // 在 prerender 期间挂起，使该边界成为由 resume 填充的 hole。resume 时它会渲染一个自身也被
    // outline 的大型嵌套边界，因此 resume 会从 postponed seed 分配新的 segment ID。
    /**
     * 首轮 use 共享无限 Promise 留下待恢复孔洞；恢复时返回内层边界与 800 字符内容，暴露段 ID 碰撞后的错误合并。
     * @returns 首轮挂起，恢复时为内层 Suspense。
     */
    function Hole() {
      if (prerendering) {
        return React.use(theInfinitePromise);
      }
      return (
        <Suspense fallback="LoadingC">
          <div>{resumeText}</div>
        </Suspense>
      );
    }

    /**
     * 并列放置大 shell 边界和待恢复 Hole，用不同 fallback 区分输出来源。
     * @returns 双边界 div。
     */
    function App() {
      return (
        <div>
          <Suspense fallback="LoadingA">
            <ShellBoundary />
          </Suspense>
          <Suspense fallback="LoadingB">
            <Hole />
          </Suspense>
        </div>
      );
    }

    const controller = new AbortController();
    let pendingResult;
    await serverAct(() => {
      pendingResult = ReactDOMFizzStatic.prerender(<App />, {
        signal: controller.signal,
        progressiveChunkSize: 100, // 强制完成边界绘制
        /**
         * 消费首轮取消的预期错误；此回归用例通过合并后的可见内容检测段 ID 问题，没有错误数组断言。
         * @returns undefined。
         */
        onError() {},
      });
    });
    await serverAct(() => controller.abort());
    const prerendered = await pendingResult;
    expect(prerendered.postponed).not.toBe(null);

    const shellHTML = await readContent(prerendered.prelude);

    prerendering = false;
    const resumed = await serverAct(() =>
      ReactDOMFizzServer.resume(
        <App />,
        JSON.parse(JSON.stringify(prerendered.postponed)),
        {
          /**
           * 消费恢复阶段错误；断言对象为 shell 与恢复 HTML 执行脚本后的可见结构。
           * @returns undefined。
           */
          onError() {}
        },
      ),
    );
    const resumeHTML = await readContent(resumed);

    // 把 shell 与 resume 作为同一份输出文档运行，让完成指令 `$RC` 像在浏览器中一样同时作用于二者。
    const temp = document.createElement('div');
    temp.innerHTML = shellHTML + resumeHTML;
    await insertNodesAndExecuteScripts(temp, container, null);
    jest.runAllTimers();

    // 两个边界都应显示各自内容。若无修复，恢复的边界会复用 shell 的 ID，使其 `$RC` 解析到 shell
    // 元素，并一直停留在 `LoadingC` fallback。
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div>{shellText}</div>
        <div>{resumeText}</div>
      </div>,
    );
  });

  /** Given：html/body 内直接渲染待决 A，首轮没有可用文档 preamble；When：取消首轮得到空串；resolve A 后恢复预渲染再取消；resolve B 后最终 resume；Then：首轮 prelude 为空；次轮文档 body 为 Loading B，末轮为 Hello，postponed 非空；未断言 errors 或节点身份。目的：验证未完成文档 preamble 可留到下一轮静态恢复。 */
  it('can omit a preamble with an empty shell if no preamble is ready when prerendering finishes', async () => {
    const errors = [];

    let resolveA;
    const promiseA = new Promise(r => (resolveA = r));
    let resolveB;
    const promiseB = new Promise(r => (resolveB = r));

    /**
     * 等待 A 后再建立 Loading B 边界；首轮 A 位于 body 直接路径上，阻止文档 preamble 完成。
     * @returns 解析为内层 Suspense 的 Promise。
     */
    async function ComponentA() {
      await promiseA;
      return (
        <Suspense fallback="Loading B">
          <ComponentB />
        </Suspense>
      );
    }

    /**
     * 等待 B 后返回最终 Hello，使下一次恢复完成正文。
     * @returns 解析为 Hello 的 Promise。
     */
    async function ComponentB() {
      await promiseB;
      return 'Hello';
    }

    /**
     * 在外层边界内构造 html/body，直接把 A 放入 body，使首轮没有可输出的文档前导。
     * @returns 文档级 Suspense 元素。
     */
    function App() {
      return (
        <Suspense>
          <html data-x="">
            <body data-x="">
              <ComponentA />
            </body>
          </html>
        </Suspense>
      );
    }

    const controller = new AbortController();
    let pendingResult;
    await serverAct(async () => {
      pendingResult = ReactDOMFizzStatic.prerender(<App />, {
        signal: controller.signal,
        /**
         * 收集首轮空 shell 的取消消息，仅留作调试；用例未断言该数组。
         * @param x - 首轮错误。
         * @returns undefined。
         */
        onError(x) {
          errors.push(x.message);
        },
      });
    });

    await serverAct(() => {
      controller.abort();
    });

    const prerendered = await pendingResult;
    const postponedState = JSON.stringify(prerendered.postponed);

    const content = await readContent(prerendered.prelude);
    expect(content).toBe('');

    await resolveA();

    expect(prerendered.postponed).not.toBe(null);

    const controller2 = new AbortController();
    await serverAct(async () => {
      pendingResult = ReactDOMFizzStatic.resumeAndPrerender(
        <App />,
        JSON.parse(postponedState),
        {
          signal: controller2.signal,
          /**
           * 追加第二轮恢复预渲染错误消息；断言集中在文档输出，数组未检查。
           * @param x - 第二轮错误。
           * @returns undefined。
           */
          onError(x) {
            errors.push(x.message);
          },
        },
      );
    });

    await serverAct(() => {
      controller2.abort();
    });

    const prerendered2 = await pendingResult;
    const postponedState2 = JSON.stringify(prerendered2.postponed);

    await readIntoNewDocument(prerendered2.prelude);
    expect(getVisibleChildren(document)).toEqual(
      <html data-x="">
        <head />
        <body data-x="">Loading B</body>
      </html>,
    );

    await resolveB();

    const dynamic = await serverAct(() =>
      ReactDOMFizzServer.resume(<App />, JSON.parse(postponedState2)),
    );

    await readIntoCurrentDocument(dynamic);
    expect(getVisibleChildren(document)).toEqual(
      <html data-x="">
        <head />
        <body data-x="">Hello</body>
      </html>,
    );
  });
  /** Given：门控启用 SuspenseList，forwards/visible 中 A/B 挂起，C/D 已就绪；When：首轮取消并读取四个 fallback；resolve A/B 后 resume；Then：可见内容从 Loading A/B/C/D 变为 A/B/C/D，postponed 非空；没有节点身份或 errors 数组断言。目的：验证列表的揭示约束延续到恢复阶段。 */

  // @gate enableSuspenseList
  it('can resume a partially prerendered SuspenseList', async () => {
    const errors = [];

    let resolveA;
    const promiseA = new Promise(r => (resolveA = r));
    let resolveB;
    const promiseB = new Promise(r => (resolveB = r));

    /**
     * 等待 promiseA 后返回 A，让列表的首个边界阻塞后续揭示。
     * @returns 解析为 A 的 Promise。
     */
    async function ComponentA() {
      await promiseA;
      return 'A';
    }

    /**
     * 等待 promiseB 后返回 B，配合 A 验证列表恢复的揭示顺序。
     * @returns 解析为 B 的 Promise。
     */
    async function ComponentB() {
      await promiseB;
      return 'B';
    }

    /**
     * 构造 forwards、tail=visible 的 SuspenseList；A/B 异步，C/D 已就绪，各自 fallback 保持可见。
     * @returns 包含列表的 div。
     */
    function App() {
      return (
        <div>
          <SuspenseList revealOrder="forwards" tail="visible">
            <Suspense fallback="Loading A">
              <ComponentA />
            </Suspense>
            <Suspense fallback="Loading B">
              <ComponentB />
            </Suspense>
            <Suspense fallback="Loading C">C</Suspense>
            <Suspense fallback="Loading D">D</Suspense>
          </SuspenseList>
        </div>
      );
    }

    const controller = new AbortController();
    const pendingResult = serverAct(() =>
      ReactDOMFizzStatic.prerender(<App />, {
        signal: controller.signal,
        /**
         * 收集列表首轮取消的 message；用例检查 fallback 与恢复内容，不断言 errors。
         * @param x - 请求错误。
         * @returns undefined。
         */
        onError(x) {
          errors.push(x.message);
        },
      }),
    );

    await serverAct(() => {
      controller.abort();
    });

    const prerendered = await pendingResult;

    const postponedState = JSON.stringify(prerendered.postponed);

    await readIntoContainer(prerendered.prelude);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        {'Loading A'}
        {'Loading B'}
        {'Loading C'}
        {'Loading D'}
      </div>,
    );

    expect(prerendered.postponed).not.toBe(null);

    await resolveA();
    await resolveB();

    const dynamic = await serverAct(() =>
      ReactDOMFizzServer.resume(<App />, JSON.parse(postponedState)),
    );

    await readIntoContainer(dynamic);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        {'A'}
        {'B'}
        {'C'}
        {'D'}
      </div>,
    );
  });
  /** Given：门控启用 optimisticKey，异步 Component 用该特殊 key 并挂起；When：取消读出 Loading，resolve 后以序列化状态 resume；Then：可见内容变为 Hi，postponed 非空；没有节点身份或 errors 数组断言。目的：验证 optimistic key 不阻碍暂停内容恢复。 */

  // @gate enableOptimisticKey
  it('can resume an optimistic keyed slot', async () => {
    const errors = [];

    let resolve;
    const promise = new Promise(r => (resolve = r));

    /**
     * 等待手动 Promise 后返回 Hi；特殊 optimisticKey 用于恢复时匹配该异步组件。
     * @returns 解析为 Hi 的 Promise。
     */
    async function Component() {
      await promise;
      return 'Hi';
    }

    if (React.optimisticKey === undefined) {
      throw new Error('optimisticKey missing');
    }

    /**
     * 把使用 React.optimisticKey 的异步 Component 放入 Loading 边界。
     * @returns 恢复测试用 div。
     */
    function App() {
      return (
        <div>
          <Suspense fallback="Loading">
            <Component key={React.optimisticKey} />
          </Suspense>
        </div>
      );
    }

    const controller = new AbortController();
    const pendingResult = serverAct(() =>
      ReactDOMFizzStatic.prerender(<App />, {
        signal: controller.signal,
        /**
         * 收集 optimistic key 用例首轮取消消息；数组没有独立断言。
         * @param x - 请求错误。
         * @returns undefined。
         */
        onError(x) {
          errors.push(x.message);
        },
      }),
    );

    await serverAct(() => {
      controller.abort();
    });

    const prerendered = await pendingResult;

    const postponedState = JSON.stringify(prerendered.postponed);

    await readIntoContainer(prerendered.prelude);
    expect(getVisibleChildren(container)).toEqual(<div>Loading</div>);

    expect(prerendered.postponed).not.toBe(null);

    await resolve();

    const dynamic = await serverAct(() =>
      ReactDOMFizzServer.resume(<App />, JSON.parse(postponedState)),
    );

    await readIntoContainer(dynamic);

    expect(getVisibleChildren(container)).toEqual(<div>Hi</div>);
  });
});
