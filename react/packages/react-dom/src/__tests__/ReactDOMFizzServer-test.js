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
  mergeOptions,
  stripExternalRuntimeInNodes,
  getVisibleChildren,
} from '../test-utils/FizzTestUtils';

let JSDOM;
let Stream;
let Scheduler;
let React;
let ReactDOM;
let ReactDOMClient;
let ReactDOMFizzServer;
let ReactDOMFizzStatic;
let Suspense;
let SuspenseList;

let assertConsoleErrorDev;
let useSyncExternalStore;
let useSyncExternalStoreWithSelector;
let use;
let useActionState;
let PropTypes;
let textCache;
let writable;
let CSPnonce = null;
let container;
let buffer = '';
let hasErrored = false;
let fatalError = undefined;
let renderOptions;
let waitFor;
let waitForAll;
let assertLog;
let waitForPaint;
let clientAct;
let streamingContainer;

/**
 * 取message从开头到第一个句点（含句点）作稳定断言；没有句点时原样返回，不解析句子语法。
 * @param msg 错误消息字符串。
 * @returns 首个句点前缀或原字符串。
 */
function normalizeError(msg) {
  // 将第一个句子作为基础，以便更容易地进行断言。
  const idx = msg.indexOf('.');
  if (idx > -1) {
    return msg.slice(0, idx + 1);
  }
  return msg;
}

describe('ReactDOMFizzServer', () => {
  beforeEach(() => {
    // 每例resetModules后创建可执行脚本的JSDOM，配置窄matchMedia/rAF polyfill、Node流缓冲和文本缓存；VARIANT选择旧useFormState并只屏蔽改名提示，source配置补with-selector模块映射。
    jest.resetModules();
    JSDOM = require('jsdom').JSDOM;

    const jsdom = new JSDOM(
      '<!DOCTYPE html><html><head></head><body><div id="container">',
      {
        runScripts: 'dangerously',
      },
    );
    // 我们模拟 matchMedia。 为了简化起见，它只匹配 `'all'` 或空字符串，而忽略了其他一切。
    Object.defineProperty(jsdom.window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation(query => ({
        matches: query === 'all' || query === '',
        media: query,
      })),
    });
    streamingContainer = null;
    global.window = jsdom.window;
    global.document = global.window.document;
    global.navigator = global.window.navigator;
    global.Node = global.window.Node;
    global.addEventListener = global.window.addEventListener;
    global.MutationObserver = global.window.MutationObserver;
    // Fizz 运行时假定 requestAnimationFrame 存在，因此这里需要补上 polyfill。
    global.requestAnimationFrame =
    /**
     * JSDOM的rAF以setTimeout调用cb，返回计时器ID；只为测试提供异步回调，不模拟浏览器帧时间。
     * @param cb 待调用回调。
     * @returns setTimeout句柄。
     */
    global.window.requestAnimationFrame = cb =>
      setTimeout(cb);
    container = document.getElementById('container');

    CSPnonce = null;
    Scheduler = require('scheduler');
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ReactDOMFizzServer = require('react-dom/server');
    ReactDOMFizzStatic = require('react-dom/static');
    Stream = require('stream');
    Suspense = React.Suspense;
    use = React.use;
    if (gate(flags => flags.enableSuspenseList)) {
      SuspenseList = React.unstable_SuspenseList;
    }
    PropTypes = require('prop-types');
    if (__VARIANT__) {
      const originalConsoleError = console.error;
      /**
       * VARIANT下改用旧useFormState时，只过滤改名提示，其他非字符串错误及不匹配字符串转发原console.error。
       * @param error 首项错误或消息。
       * @param args 其余控制台参数。
       */
      console.error = (error, ...args) => {
        if (
          typeof error !== 'string' ||
          error.indexOf('ReactDOM.useFormState has been renamed') === -1
        ) {
          originalConsoleError(error, ...args);
        }
      };

      // 此 API 删除后移除。
      useActionState = ReactDOM.useFormState;
    } else {
      useActionState = React.useActionState;
    }

    ({
      assertConsoleErrorDev,
      assertLog,
      act: clientAct,
      waitFor,
      waitForAll,
      waitForPaint,
    } = require('internal-test-utils'));

    if (gate(flags => flags.source)) {
      // `with-selector` 模块组合了 `use-sync-external-store` 主入口。构建产物由构建配置把该入口解析为
      // `shim` 实现；直接对源文件运行测试时，还需要告诉 Jest 如何解析它。这里 mock 的是源模块，
      // 因此不会影响构建产物测试。
      jest.mock('use-sync-external-store/src/useSyncExternalStore', () =>
        jest.requireActual('react'),
      );
    }
    useSyncExternalStore = React.useSyncExternalStore;
    useSyncExternalStoreWithSelector =
      require('use-sync-external-store/with-selector').useSyncExternalStoreWithSelector;

    textCache = new Map();

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

    renderOptions = {};
    if (gate(flags => flags.shouldUseFizzExternalRuntime)) {
      renderOptions.unstable_externalRuntimeSrc =
        'react-dom-bindings/src/server/ReactDOMServerExternalRuntime.js';
    }
  });

  /**
   * 把每条{error,errorInfo}映射为message，存在componentStack时附digest和规范化栈，否则有truthy digest时附digest；按DEV选择精确期望数组，空digest不单列。
   * @param errorsArr server/hydrate回调采集记录。
   * @param toBeDevArr DEV配置的期望。
   * @param toBeProdArr 生产配置的期望。
   */
  function expectErrors(errorsArr, toBeDevArr, toBeProdArr) {
    const mappedErrows = errorsArr.map(({error, errorInfo}) => {
      const stack = errorInfo && errorInfo.componentStack;
      const digest = error.digest;
      if (stack) {
        return [error.message, digest, normalizeCodeLocInfo(stack)];
      } else if (digest) {
        return [error.message, digest];
      }
      return error.message;
    });
    if (__DEV__) {
      expect(mappedErrows).toEqual(toBeDevArr);
    } else {
      expect(mappedErrows).toEqual(toBeProdArr);
    }
  }

  /**
   * 把按从叶到根排列的组件名格式化成带通配源码位置的标准栈文本，供错误回调断言。
   * @param components 组件名数组。
   * @returns 拼接的换行栈字符串。
   */
  function componentStack(components) {
    return components
      .map(component => `\n    in ${component} (at **)`)
      .join('');
  }

  const bodyStartMatch = /<body(?:>| .*?>)/;
  const headStartMatch = /<head(?:>| .*?>)/;

  /**
   * 执行callback、等一次setImmediate，再读取PassThrough缓冲并用JSDOM解析完整片段；首段可重建文档内容，后续按head/body/container插入并执行脚本，最终跑定时器处理节流揭示。此夹具不模拟浏览器逐字节HTML解析。
   * @param callback 本轮渲染、解锁、abort或hydrate操作。
   * @returns DOM片段插入完成的Promise；空buffer只跑定时器。
   * @throws callback/脚本错误、流fatalError或非法文档首段；不回滚已插节点。
   */
  async function act(callback) {
    await callback();
    // 等待事件循环转一轮；这里假定此前收到的内容都会被 flush。
    await new Promise(resolve => {
      setImmediate(resolve);
    });
    if (hasErrored) {
      throw fatalError;
    }
    // JSDOM 不支持流式 HTML parser，因此需要给它完整片段，并执行其中嵌入的脚本。这里假定此时已收到
    // 一个完整的 HTML 片段。
    let bufferedContent = buffer;
    buffer = '';

    if (!bufferedContent) {
      jest.runAllTimers();
      return;
    }

    const bodyMatch = bufferedContent.match(bodyStartMatch);
    const headMatch = bufferedContent.match(headStartMatch);

    if (streamingContainer === null) {
      // 这是首批流式内容，因此在这里决定插入位置。若收到 <html>、<head> 或 <body>，就放弃预先
      // 构建的文档并从头创建；其他内容则假定应放入容器。这不是真实的生产行为，因为无法正确、高效地
      // 流式写入深层 div，但很适合测试。

      if (
        bufferedContent.startsWith('<head>') ||
        bufferedContent.startsWith('<head ') ||
        bufferedContent.startsWith('<body>') ||
        bufferedContent.startsWith('<body ')
      ) {
        // 将元素包裹在文档类型声明中以标准化解析过程。
        bufferedContent = '<!DOCTYPE html><html>' + bufferedContent;
      } else if (
        bufferedContent.startsWith('<html>') ||
        bufferedContent.startsWith('<html ')
      ) {
        throw new Error(
          'Recieved <html> without a <!DOCTYPE html> which is almost certainly a bug in React',
        );
      }

      if (bufferedContent.startsWith('<!DOCTYPE html>')) {
        // 我们完全可以使用整个文档。
        const tempDom = new JSDOM(bufferedContent);

        // 清除现有的头部和主体内容
        document.head.innerHTML = '';
        document.body.innerHTML = '';

        // 复制 <html> 属性。
        const tempHtmlNode = tempDom.window.document.documentElement;
        for (let i = 0; i < tempHtmlNode.attributes.length; i++) {
          const attr = tempHtmlNode.attributes[i];
          document.documentElement.setAttribute(attr.name, attr.value);
        }

        if (headMatch) {
          // 我们解析了一个头部打开标签。 我们需要复制头部属性，并将未来的内容插入到 <head> 中。
          streamingContainer = document.head;
          const tempHeadNode = tempDom.window.document.head;
          for (let i = 0; i < tempHeadNode.attributes.length; i++) {
            const attr = tempHeadNode.attributes[i];
            document.head.setAttribute(attr.name, attr.value);
          }
          const source = document.createElement('head');
          source.innerHTML = tempHeadNode.innerHTML;
          await insertNodesAndExecuteScripts(source, document.head, CSPnonce);
        }

        if (bodyMatch) {
          // 解析到 body 起始标签后，复制 body 属性，并将后续片段插入 document.body。
          streamingContainer = document.body;
          const tempBodyNode = tempDom.window.document.body;
          for (let i = 0; i < tempBodyNode.attributes.length; i++) {
            const attr = tempBodyNode.attributes[i];
            document.body.setAttribute(attr.name, attr.value);
          }
          const source = document.createElement('body');
          source.innerHTML = tempBodyNode.innerHTML;
          await insertNodesAndExecuteScripts(source, document.body, CSPnonce);
        }

        if (!headMatch && !bodyMatch) {
          throw new Error('expected <head> or <body> after <html>');
        }
      } else {
        // 我们假设数据流进入默认容器。
        streamingContainer = container;
        const div = document.createElement('div');
        div.innerHTML = bufferedContent;
        await insertNodesAndExecuteScripts(div, container, CSPnonce);
      }
    } else if (streamingContainer === document.head) {
      bufferedContent = '<!DOCTYPE html><html><head>' + bufferedContent;
      const tempDom = new JSDOM(bufferedContent);

      const tempHeadNode = tempDom.window.document.head;
      const source = document.createElement('head');
      source.innerHTML = tempHeadNode.innerHTML;
      await insertNodesAndExecuteScripts(source, document.head, CSPnonce);

      if (bodyMatch) {
        streamingContainer = document.body;

        const tempBodyNode = tempDom.window.document.body;
        for (let i = 0; i < tempBodyNode.attributes.length; i++) {
          const attr = tempBodyNode.attributes[i];
          document.body.setAttribute(attr.name, attr.value);
        }
        const bodySource = document.createElement('body');
        bodySource.innerHTML = tempBodyNode.innerHTML;
        await insertNodesAndExecuteScripts(bodySource, document.body, CSPnonce);
      }
    } else {
      const div = document.createElement('div');
      div.innerHTML = bufferedContent;
      await insertNodesAndExecuteScripts(div, streamingContainer, CSPnonce);
    }
      // 让受节流限制的边界显示出来。
    jest.runAllTimers();
  }

  /**
   * 缺记录创建resolved；pending先写成功状态和值，再同步通知所有ping，已有resolved/rejected不改。ping保留但重复成功不再次通知。
   * @param text 缓存键及resolved字符串值。
   */
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

  /**
   * 缺记录创建rejected；pending先存error并改状态，再同步通知ping以便render重读抛错，已resolved/rejected不修改。
   * @param text 文本记录键。
   * @param error 后续readText抛出的错误值。
   */
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

  /**
   * resolved返回值，pending/rejected抛记录值；首次未命中存自定义thenable为pending并抛出，让Fizz/Suspense等待显式resolve/reject。
   * @param text 字符串缓存键。
   * @returns 成功文本；未完成抛thenable，失败抛error。
   */
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
        /**
         * pending保存resolve通知；状态已改变时Promise微任务调用resolve(record.value)，让订阅方重试。拒绝也通过ping重读抛error，不是完整Promise的reject/链式协议。
         * @param resolve Fizz或hydrate重试通知函数。
         */
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

  /**
   * 同步文本夹具，直接透传text；lazy default、bootstrap与流完成用它作为无挂起对照。
   * @param props text为输出字符串。
   * @returns text。
   */
  function Text({text}) {
    return text;
  }

  /**
   * 调用readText，pending/rejected沿缓存抛出，resolved时返回文本，供分阶段SSR/hydrate揭示。
   * @param props text为缓存键与成功值。
   * @returns 成功文本。
   */
  function AsyncText({text}) {
    return readText(text);
  }

  /**
   * 用as指定宿主/组件包装readText的结果，等待时仍先抛thenable，不提前返回空包装。
   * @param props as为包装类型，text为缓存键。
   * @returns 包装成功文本的元素。
   */
  function AsyncTextWrapped({as, text}) {
    const As = as;
    return <As>{readText(text)}</As>;
  }
  /**
   * 将本例options与按feature flag建立的renderOptions合并后调用Fizz Node流入口，返回pipe/abort由测试控制。
   * @param jsx 待输出React树。
   * @param options 当前例的回调、nonce和bootstrap等选项。
   * @returns Fizz流控制对象。
   */
  function renderToPipeableStream(jsx, options) {
    // 合并选项与 renderOptions。 可能包含特定于 featureFlag 的行为。
    return ReactDOMFizzServer.renderToPipeableStream(
      jsx,
      mergeOptions(options, renderOptions),
    );
  }

  /** enableBrowserAPI下BrowserOnly先use浏览器标记，SSR只输出fallback且onError为空、onBrowserBailout收到原标记和组件栈；hydrate仍等browserText，解该promise后显示Browser且无recoverable error，区分主动浏览器接管与服务端错误。 */
  // @gate enableBrowserAPI
  it('can opt a component into browser-only rendering', async () => {
    let resolveBrowserText;
    const browserText = new Promise(resolve => {
      resolveBrowserText = resolve;
    });
    const browserOnly = ReactDOM.browser();

    /**
     * 先use预先建立的browser标记，服务端转接管；客户端再use browserText直到显式解锁，成功时记文本日志并返回span。
     * @returns Browser文本span；等待时挂起。
     */
    function BrowserOnly() {
      use(browserOnly);
      const text = use(browserText);
      Scheduler.log(text);
      return <span>{text}</span>;
    }

    /**
     * 用Suspense包BrowserOnly，SSR与客户端等待阶段都有span Fallback，复用同树核对恢复回调。
     * @returns div/边界树。
     */
    function App() {
      return (
        <div>
          <Suspense fallback={<span>Fallback</span>}>
            <BrowserOnly />
          </Suspense>
        </div>
      );
    }

    const serverErrors = [];
    const browserBailouts = [];
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />, {
        /**
         * 采集服务端普通错误；本例主动browser接管期望此数组为空。
         * @param error Fizz普通错误回调值。
         */
        onError(error) {
          serverErrors.push(error);
        },
        /**
         * 采集主动browser接管的标记与组件栈；断言原标记身份及BrowserOnly→App栈。
         * @param error browser()标记。
         * @param errorInfo 含componentStack的上下文。
         */
        onBrowserBailout(error, errorInfo) {
          browserBailouts.push({error, errorInfo});
        },
      });
      pipe(writable);
    });

    expect(serverErrors).toEqual([]);
    expect(browserBailouts).toHaveLength(1);
    expect(browserBailouts[0].error).toBe(browserOnly);
    expect(
      normalizeCodeLocInfo(browserBailouts[0].errorInfo.componentStack),
    ).toBe(componentStack(['BrowserOnly', 'Suspense', 'div', 'App']));
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Fallback</span>
      </div>,
    );
    const recoverableErrors = [];
    ReactDOMClient.hydrateRoot(container, <App />, {
      /**
       * 采集hydrate恢复错误；本例browser接管后文本正常解锁应保持空。
       * @param error React可恢复错误。
       */
      onRecoverableError(error) {
        recoverableErrors.push(error);
      },
    });
    await waitForAll([]);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Fallback</span>
      </div>,
    );

    await clientAct(() => {
      resolveBrowserText('Browser');
    });
    assertLog(['Browser']);

    expect(recoverableErrors).toEqual([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Browser</span>
      </div>,
    );
  });

  /** enableBrowserAPI下先use serverReady让fallback已流出，再解promise触达browser()；SSR onError仍空，hydrate直接显示Browser且无恢复错误，浏览器接管可发生在fallback输出后。 */
  // @gate enableBrowserAPI
  it('can opt a component into browser-only rendering after streaming the fallback', async () => {
    let resolveServerReady;
    const serverReady = new Promise(resolve => {
      resolveServerReady = resolve;
    });

    /**
     * 先use serverReady让SSR输出fallback，解锁后再use browser标记转客户端；hydrate时ready已完成而直接返回Browser span。
     * @returns Browser span。
     */
    function BrowserOnly() {
      use(serverReady);
      use(ReactDOM.browser());
      return <span>Browser</span>;
    }

    /**
     * 用相同Fallback边界包住先等待serverReady的BrowserOnly，比较晚触达browser标记的流式接管。
     * @returns div/边界树。
     */
    function App() {
      return (
        <div>
          <Suspense fallback={<span>Fallback</span>}>
            <BrowserOnly />
          </Suspense>
        </div>
      );
    }

    const serverErrors = [];
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />, {
        /**
         * 采集晚到browser接管期间的普通服务端错误，断言仍为空。
         * @param error Fizz错误值。
         */
        onError(error) {
          serverErrors.push(error);
        },
      });
      pipe(writable);
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Fallback</span>
      </div>,
    );

    await act(() => {
      resolveServerReady();
    });

    expect(serverErrors).toEqual([]);

    const recoverableErrors = [];
    ReactDOMClient.hydrateRoot(container, <App />, {
      /**
       * 采集late browser接管后的hydrate恢复错误，断言为空。
       * @param error 可恢复错误。
       */
      onRecoverableError(error) {
        recoverableErrors.push(error);
      },
    });
    await waitForAll([]);

    expect(recoverableErrors).toEqual([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Browser</span>
      </div>,
    );
  });

  /** enableBrowserAPI下无Suspense的BrowserOnly use浏览器标记；shellReady不触发，onShellError包装异常cause保留标记及创建栈，onError仅收到包装错误且onBrowserBailout为空，根无法作为局部浏览器接管。 */
  // @gate enableBrowserAPI
  it('errors if browser-only content is rendered outside Suspense', async () => {
    /**
     * 在命名调用栈创建browser标记，以便shell错误cause.stack仍能追溯创建点。
     * @returns browser()结果。
     */
    function createBrowserValue() {
      return ReactDOM.browser();
    }
    const browserValue = createBrowserValue();

    /**
     * 在无Suspense根use创建好的browser标记，触发不能完成shell的包装错误。
     * @returns 仅客户端可能返回的Browser span。
     */
    function BrowserOnly() {
      use(browserValue);
      return <span>Browser</span>;
    }

    const reportedErrors = [];
    const browserBailouts = [];
    let shellReady = false;
    let shellError;
    await act(() => {
      renderToPipeableStream(<BrowserOnly />, {
        /**
         * 采集根browser接管失败的普通错误；期望唯一值等于onShellError包装错误。
         * @param error shell失败包装Error。
         */
        onError(error) {
          reportedErrors.push(error);
        },
        /**
         * 记录局部接管通知；根无边界本例期望不调用。
         * @param error 假设出现的browser接管值。
         */
        onBrowserBailout(error) {
          browserBailouts.push(error);
        },
        /** 置shellReady=true供反向断言；无边界browser接管时不会执行。 */
        onShellReady() {
          shellReady = true;
        },
        /**
         * 保存shell失败包装Error，用于核对message、stack、cause与onError身份。
         * @param error 不可完成shell的错误。
         */
        onShellError(error) {
          shellError = error;
        },
      });
    });

    expect(shellError).toBeInstanceOf(Error);
    expect(shellError.message).toBe(
      'The server render could not complete because client rendering was ' +
        "requested outside a Suspense boundary. See this error's cause for " +
        'additional details.',
    );
    expect(shellError.stack).toContain('BrowserOnly');
    expect(shellError.cause).toBe(browserValue);
    expect(shellError.cause.stack).toContain('createBrowserValue');
    expect(shellReady).toBe(false);
    expect(reportedErrors).toEqual([shellError]);
    expect(browserBailouts).toEqual([]);
  });

  /** enableBrowserAPI下两个边界服务端永远pending，shell已显示Shell/Loading A/B；以browser标记abort后两次bailout且无onError，isClient切真hydrate显示A/B，无recoverable error，验证批量转浏览器渲染。 */
  // @gate enableBrowserAPI
  it('can abort all pending boundaries into browser-only rendering', async () => {
    const never = new Promise(() => {});
    let isClient = false;

    /**
     * 服务端use never永远挂起，isClient真时直接返回children span；两边界共用never但客户端各显示自己的文本。
     * @param props children为A/B内容。
     * @returns span；服务端等待时不返回。
     */
    function Pending({children}) {
      if (!isClient) {
        use(never);
      }
      return <span>{children}</span>;
    }

    /**
     * Shell文本旁放A/B两个独立pending边界，已完成shell后可用browser标记abort两者。
     * @returns div与两个Suspense。
     */
    function App() {
      return (
        <div>
          <span>Shell</span>
          <Suspense fallback={<span>Loading A</span>}>
            <Pending>A</Pending>
          </Suspense>
          <Suspense fallback={<span>Loading B</span>}>
            <Pending>B</Pending>
          </Suspense>
        </div>
      );
    }

    const serverErrors = [];
    const browserBailouts = [];
    const browserValue = ReactDOM.browser();
    let abort;
    await act(() => {
      const controls = renderToPipeableStream(<App />, {
        /**
         * 采集abort browser标记期间的普通错误；本例已完成shell故期望为空。
         * @param error Fizz错误值。
         */
        onError(error) {
          serverErrors.push(error);
        },
        /**
         * 按通知顺序保存被abort的两个边界标记，本例都等于browserValue。
         * @param error 浏览器接管标记。
         */
        onBrowserBailout(error) {
          browserBailouts.push(error);
        },
      });
      abort = controls.abort;
      controls.pipe(writable);
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Shell</span>
        <span>Loading A</span>
        <span>Loading B</span>
      </div>,
    );

    await act(() => {
      abort(browserValue);
    });

    expect(serverErrors).toEqual([]);
    expect(browserBailouts).toEqual([browserValue, browserValue]);

    isClient = true;
    const recoverableErrors = [];
    ReactDOMClient.hydrateRoot(container, <App />, {
      /**
       * 收集被abort边界转客户端后的恢复错误，正常A/B输出期望为空。
       * @param error 可恢复错误。
       */
      onRecoverableError(error) {
        recoverableErrors.push(error);
      },
    });
    await waitForAll([]);

    expect(recoverableErrors).toEqual([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Shell</span>
        <span>A</span>
        <span>B</span>
      </div>,
    );
  });

  /** enableBrowserAPI下整个根use永不完成promise，shell尚未就绪就以browser标记abort；onShellError/onError收到cause为标记的包装异常、shellReady=false且无局部bailout，区别已输出shell后的边界中止。 */
  // @gate enableBrowserAPI
  it('errors if aborted with browser() before the shell completes', async () => {
    const never = new Promise(() => {});
    const browserValue = ReactDOM.browser();

    /**
     * 根无Suspense地use never，阻住整个shell，供早abort区别局部边界中止。
     * @returns 等待永不结束，此Root span不在服务端输出。
     */
    function PendingRoot() {
      use(never);
      return <span>Root</span>;
    }

    const reportedErrors = [];
    const browserBailouts = [];
    let shellReady = false;
    let shellError;
    let abort;
    await act(() => {
      const controls = renderToPipeableStream(<PendingRoot />, {
        /**
         * 采集shell前browser abort的包装错误，期望与shellError同一对象。
         * @param error 根中止Error。
         */
        onError(error) {
          reportedErrors.push(error);
        },
        /**
         * 记录局部接管通知；shell尚未完成的根abort期望无通知。
         * @param error 假设的接管值。
         */
        onBrowserBailout(error) {
          browserBailouts.push(error);
        },
        /** 置shellReady标志；本例根一直pending直至abort，期望保持false。 */
        onShellReady() {
          shellReady = true;
        },
        /**
         * 保存早abort产生的shell错误，核对其cause为browser标记。
         * @param error 包装Error。
         */
        onShellError(error) {
          shellError = error;
        },
      });
      abort = controls.abort;
    });

    await act(() => {
      abort(browserValue);
    });

    expect(shellError).toBeInstanceOf(Error);
    expect(shellError.message).toBe(
      'The server render could not complete because client rendering was ' +
        "requested outside a Suspense boundary. See this error's cause for " +
        'additional details.',
    );
    expect(shellError.cause).toBe(browserValue);
    expect(shellReady).toBe(false);
    expect(reportedErrors).toEqual([shellError]);
    expect(browserBailouts).toEqual([]);
  });

  /** enableBrowserAPI下组件直接throw浏览器标记而不use，在Suspense内SSR仍显示fallback；onError收到原标记而onBrowserBailout为空，只有use路径具主动浏览器接管语义。 */
  // @gate enableBrowserAPI
  it('reports the browser value if it is thrown instead of passed to use', async () => {
    const browserValue = ReactDOM.browser();

    /**
     * 直接throw browser标记，以普通异常路径区别use(browserValue)主动接管。
     * @throws browserValue；无UI返回。
     */
    function BrowserOnly() {
      throw browserValue;
    }

    const reportedErrors = [];
    const browserBailouts = [];
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <Suspense fallback={<span>Fallback</span>}>
          <BrowserOnly />
        </Suspense>,
        {
          /**
           * 记录直接throw的标记，本例按普通错误处理。
           * @param error 原browserValue。
           */
          onError(error) {
            reportedErrors.push(error);
          },
          /**
           * 收集主动接管通知；直接throw标记本例期望数组为空。
           * @param error 假设的主动接管值。
           */
          onBrowserBailout(error) {
            browserBailouts.push(error);
          },
        },
      );
      pipe(writable);
    });

    expect(reportedErrors).toEqual([browserValue]);
    expect(browserBailouts).toEqual([]);
    expect(getVisibleChildren(container)).toEqual(<span>Fallback</span>);
  });

  ['', 'BROWSER'].forEach(userDigest => {
    /** 遍历userDigest空串与BROWSER：普通server Error经onError返回该digest，SSR fallback；切isClient后hydrate显示Client且仍有一次recoverable error，非空digest保留、空串转undefined，用户字符串不会成为浏览器专属标记。 */
    it(`does not reserve the ${JSON.stringify(
      userDigest,
    )} user error digest for browser rendering`, async () => {
      let isClient = false;
      const serverError = new Error('Server error');

      /**
       * isClient=false时抛固定serverError，切真后返回Client span，比较用户digest不改变恢复错误语义。
       * @returns Client span；SSR抛Server error。
       */
      function ServerError() {
        if (!isClient) {
          throw serverError;
        }
        return <span>Client</span>;
      }

      /**
       * 以Fallback span包住可切客户端成功的ServerError，用两个userDigest配置复跑同场景。
       * @returns Suspense元素。
       */
      function App() {
        return (
          <Suspense fallback={<span>Fallback</span>}>
            <ServerError />
          </Suspense>
        );
      }

      const serverErrors = [];
      await act(() => {
        const {pipe} = renderToPipeableStream(<App />, {
          /**
           * 保存serverError并返回当前循环userDigest，空串/BROWSER都由普通错误协议编码。
           * @param error 普通服务端异常。
           * @returns 当前userDigest字符串。
           */
          onError(error) {
            serverErrors.push(error);
            return userDigest;
          },
        });
        pipe(writable);
      });

      expect(serverErrors).toEqual([serverError]);
      expect(getVisibleChildren(container)).toEqual(<span>Fallback</span>);

      isClient = true;
      const recoverableErrors = [];
      ReactDOMClient.hydrateRoot(container, <App />, {
        /**
         * 收集普通server错误转客户端的恢复Error，核对一项与digest保留/空串归undefined。
         * @param error 带可选digest的恢复错误。
         */
        onRecoverableError(error) {
          recoverableErrors.push(error);
        },
      });
      await waitForAll([]);

      expect(recoverableErrors).toHaveLength(1);
      expect(recoverableErrors[0].digest).toBe(userDigest || undefined);
      expect(getVisibleChildren(container)).toEqual(<span>Client</span>);
    });
  });

  /** 两个独立lazy模块都pending时各显示Loading；先解A default=Text只显示Hello，后解B default=class TextWithPunctuation显示world!，核对渐进完成及class defaultProps的标点解析。 */
  it('should asynchronously load a lazy component', async () => {
    let resolveA;
    const LazyA = React.lazy(() => {
      return new Promise(r => {
        resolveA = r;
      });
    });

    let resolveB;
    const LazyB = React.lazy(() => {
      return new Promise(r => {
        resolveB = r;
      });
    });

    /** lazy B的class导出，用defaultProps的!补标点，验证惰性类型解析后仍应用class缺省props。 */
    class TextWithPunctuation extends React.Component {
      /**
       * 合并props.text与punctuation后交给同步Text；没有异步或本地状态。
       * @returns 合并文本的Text元素。
       */
      render() {
        return <Text text={this.props.text + this.props.punctuation} />;
      }
    }

    // 验证内部元素的默认 props 已解析。
    TextWithPunctuation.defaultProps = {
      punctuation: '!',
    };

    await act(() => {
      const {pipe} = renderToPipeableStream(
        <div>
          <div>
            <Suspense fallback={<Text text="Loading..." />}>
              <LazyA text="Hello" />
            </Suspense>
          </div>
          <div>
            <Suspense fallback={<Text text="Loading..." />}>
              <LazyB text="world" />
            </Suspense>
          </div>
        </div>,
      );
      pipe(writable);
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div>Loading...</div>
        <div>Loading...</div>
      </div>,
    );
    await act(() => {
      resolveA({default: Text});
    });
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div>Hello</div>
        <div>Loading...</div>
      </div>,
    );
    await act(() => {
      resolveB({default: TextWithPunctuation});
    });
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div>Hello</div>
        <div>world!</div>
      </div>,
    );
  });

  /** makeApp为服务端与客户端各造独立lazy promise；SSR完成后body含async/after，hydrate的首兄弟仍pending时不误判后续span，解客户端promise后可见树保持，无DEV mismatch期望。 */
  it('#23331: does not warn about hydration mismatches if something suspended in an earlier sibling', async () => {
    /**
     * 每次调用创建独立lazy import promise及完成入口，给SSR/客户端分别保留加载状态；避免复用已resolve的服务端模块。
     * @returns [App, resolve]二元数组。
     */
    const makeApp = () => {
      let resolve;
      const imports = new Promise(r => {
        /** 完成当前makeApp独立lazy promise，并提供输出async span的默认组件；服务器与客户端各自持有解除函数。 */
        resolve = () => r({
          /** 作为 React.lazy 动态模块的默认组件导出。 */
          /**
           * 作为本次makeApp的lazy默认组件，输出id=async的span；服务器/客户端独立lazy模块完成后使用等价树匹配hydration。
           * @returns async span。
           */
          default: () => <span id="async">async</span>
        });
      });
      const Lazy = React.lazy(() => imports);

      /**
       * 返回同一边界内先lazy span再after span，客户端首项挂起时不应误把后兄弟匹配为首项。
       * @returns div/Suspense树。
       */
      const App = () => (
        <div>
          <Suspense fallback={<span>Loading...</span>}>
            <Lazy />
            <span id="after">after</span>
          </Suspense>
        </div>
      );

      return [App, resolve];
    };

    // 服务器端
    const [App, resolve] = makeApp();
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Loading...</span>
      </div>,
    );
    await act(() => {
      resolve();
    });
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span id="async">async</span>
        <span id="after">after</span>
      </div>,
    );

    // 客户端
    const [HydrateApp, hydrateResolve] = makeApp();
    await act(() => {
      ReactDOMClient.hydrateRoot(container, <HydrateApp />);
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span id="async">async</span>
        <span id="after">after</span>
      </div>,
    );

    await act(() => {
      hydrateResolve();
    });
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span id="async">async</span>
        <span id="after">after</span>
      </div>,
    );
  });

  /** CSPnonce=R4nd0m，pending lazy树携内联bootstrap、两script和两module；初次四preload带nonce且两项integrity保留，检查六script匹配nonce，解lazy后Hello取代Loading，finally清nonce。 */
  it('should support nonce for bootstrap and runtime scripts', async () => {
    CSPnonce = 'R4nd0m';
    try {
      let resolve;
      const Lazy = React.lazy(() => {
        return new Promise(r => {
          resolve = r;
        });
      });

      await act(() => {
        const {pipe} = renderToPipeableStream(
          <div>
            <Suspense fallback={<Text text="Loading..." />}>
              <Lazy text="Hello" />
            </Suspense>
          </div>,
          {
            nonce: 'R4nd0m',
            bootstrapScriptContent: 'function noop(){}',
            bootstrapScripts: [
              'init.js',
              {src: 'init2.js', integrity: 'init2hash'},
            ],
            bootstrapModules: [
              'init.mjs',
              {src: 'init2.mjs', integrity: 'init2hash'},
            ],
          },
        );
        pipe(writable);
      });

      expect(getVisibleChildren(container)).toEqual([
        <link
          rel="preload"
          fetchpriority="low"
          href="init.js"
          as="script"
          nonce={CSPnonce}
        />,
        <link
          rel="preload"
          fetchpriority="low"
          href="init2.js"
          as="script"
          nonce={CSPnonce}
          integrity="init2hash"
        />,
        <link
          rel="modulepreload"
          fetchpriority="low"
          href="init.mjs"
          nonce={CSPnonce}
        />,
        <link
          rel="modulepreload"
          fetchpriority="low"
          href="init2.mjs"
          nonce={CSPnonce}
          integrity="init2hash"
        />,
        <div>Loading...</div>,
      ]);

      // 检查 6 个脚本都带有匹配的 nonce：运行时脚本或首屏脚本、一个内联 bootstrap 脚本、
      // 两个 bootstrap 脚本和两个 bootstrap 模块。
      expect(
        Array.from(container.getElementsByTagName('script')).filter(
          node => node.getAttribute('nonce') === CSPnonce,
        ).length,
      ).toEqual(6);

      await act(() => {
        resolve({default: Text});
      });
      expect(getVisibleChildren(container)).toEqual([
        <link
          rel="preload"
          fetchpriority="low"
          href="init.js"
          as="script"
          nonce={CSPnonce}
        />,
        <link
          rel="preload"
          fetchpriority="low"
          href="init2.js"
          as="script"
          nonce={CSPnonce}
          integrity="init2hash"
        />,
        <link
          rel="modulepreload"
          fetchpriority="low"
          href="init.mjs"
          nonce={CSPnonce}
        />,
        <link
          rel="modulepreload"
          fetchpriority="low"
          href="init2.mjs"
          nonce={CSPnonce}
          integrity="init2hash"
        />,
        <div>Hello</div>,
      ]);
    } finally {
      CSPnonce = null;
    }
  });

  /** render options有nonce但用户七script仅两项显式nonce；去外部runtime后逐outerHTML断言，仅foo async与内联脚本携nonce，其余资源script/module保持无nonce，选项不自动扩散给渲染资源。 */
  it('should not automatically add nonce to rendered scripts', async () => {
    CSPnonce = 'R4nd0m';
    try {
      await act(async () => {
        const {pipe} = renderToPipeableStream(
          <html>
            <body>
              <script nonce={CSPnonce}>{'try { foo() } catch (e) {} ;'}</script>
              <script nonce={CSPnonce} src="foo" async={true} />
              <script src="bar" />
              <script src="baz" integrity="qux" async={true} />
              <script type="module" src="quux" async={true} />
              <script type="module" src="corge" async={true} />
              <script
                type="module"
                src="grault"
                integrity="garply"
                async={true}
              />
            </body>
          </html>,
          {
            nonce: CSPnonce,
          },
        );
        pipe(writable);
      });

      expect(
        stripExternalRuntimeInNodes(
          document.getElementsByTagName('script'),
          renderOptions.unstable_externalRuntimeSrc,
        ).map(n => n.outerHTML),
      ).toEqual([
        `<script nonce="${CSPnonce}" src="foo" async=""></script>`,
        `<script src="baz" integrity="qux" async=""></script>`,
        `<script type="module" src="quux" async=""></script>`,
        `<script type="module" src="corge" async=""></script>`,
        `<script type="module" src="grault" integrity="garply" async=""></script>`,
        `<script nonce="${CSPnonce}">try { foo() } catch (e) {} ;</script>`,
        `<script src="bar"></script>`,
      ]);
    } finally {
      CSPnonce = null;
    }
  });

  /** 双层lazy与同步thenable LazyWrapper下等待模块，bootstrap立即hydrate客户端Hello树；server拒绝lazy后onError仅一次并编码digest，客户端随后接管Hello且DEV/生产恢复错误格式不同，保留Wrapper组件栈。 */
  it('should client render a boundary if a lazy component rejects', async () => {
    let rejectComponent;
    const promise = new Promise((resolve, reject) => {
      rejectComponent = reject;
    });
    const LazyComponent = React.lazy(() => {
      return promise;
    });

    const LazyLazy = React.lazy(async () => {
      return {
        default: LazyComponent,
      };
    });

    /**
     * LazyWrapper同步解析后的组件，直接透传children，给拒绝lazy组件的恢复栈增加Wrapper层。
     * @param props children为server LazyLazy或client Text。
     * @returns children。
     */
    function Wrapper({children}) {
      return children;
    }
    const LazyWrapper = React.lazy(() => {
      return {
        /**
         * LazyWrapper的同步thenable立刻回调default=Wrapper，不等待真正Promise调度。
         * @param callback React.lazy解析成功处理器。
         */
        then(callback) {
          callback({
            default: Wrapper,
          });
        },
      };
    });

    /**
     * 按isClient选择Hello同步Text或双层LazyLazy，在共同LazyWrapper及Loading边界下比较模块拒绝恢复。
     * @param props isClient选择本轮输入组件。
     * @returns div/Suspense树。
     */
    function App({isClient}) {
      return (
        <div>
          <Suspense fallback={<Text text="Loading..." />}>
            <LazyWrapper>
              {isClient ? <Text text="Hello" /> : <LazyLazy text="Hello" />}
            </LazyWrapper>
          </Suspense>
        </div>
      );
    }

    let bootstrapped = false;
    const errors = [];
    /** bootstrap脚本调用此入口时先标记bootstrapped，再立即hydrate客户端App并收集恢复信息，使lazy错误发生于已开始hydration的边界。 */
    window.__INIT__ = function () {
      bootstrapped = true;
      // 尝试 hydrate 内容。
      ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
        /**
         * 采集bootstrap hydrate的恢复error/errorInfo，expectErrors按配置核对digest与Wrapper/Lazy栈。
         * @param error 恢复异常。
         * @param errorInfo 含componentStack的上下文。
         */
        onRecoverableError(error, errorInfo) {
          errors.push({error, errorInfo});
        },
      });
    };

    const theError = new Error('Test');
    const loggedErrors = [];
    /**
     * 保存拒绝模块的服务端错误，返回Hash of(message)作digest；errorInfo参数未读取。先人工调用算期望后清日志，再由Fizz正式调用。
     * @param x 原始模块拒绝Error。
     * @param errorInfo Fizz错误上下文，本例忽略。
     * @returns hash字符串。
     */
    function onError(x, errorInfo) {
      loggedErrors.push(x);
      return 'Hash of (' + x.message + ')';
    }
    const expectedDigest = onError(theError);
    loggedErrors.length = 0;

    await act(() => {
      const {pipe} = renderToPipeableStream(<App isClient={false} />, {
        bootstrapScriptContent: '__INIT__();',
        onError,
      });
      pipe(writable);
    });

    expect(loggedErrors).toEqual([]);
    expect(bootstrapped).toBe(true);

    await waitForAll([]);

    // 我们仍在加载，因为我们正在等待服务器流更多内容。
    expect(getVisibleChildren(container)).toEqual(<div>Loading...</div>);

    expect(loggedErrors).toEqual([]);

    await act(() => {
      rejectComponent(theError);
    });

    expect(loggedErrors).toEqual([theError]);

    // 客户端 hydration 尚未运行。
    expect(getVisibleChildren(container)).toEqual(<div>Loading...</div>);

    // 我们现在可以客户端渲染它了。
    await waitForAll([]);
    expectErrors(
      errors,
      [
        [
          'Switched to client rendering because the server rendering errored:\n\n' +
            theError.message,
          expectedDigest,
          componentStack(['Lazy', 'Wrapper', 'Suspense', 'div', 'App']),
        ],
      ],
      [
        [
          'The server could not finish this Suspense boundary, likely due to an error during server rendering. Switched to client rendering.',
          expectedDigest,
        ],
      ],
    );

    // 客户端已渲染 HTML。
    expect(getVisibleChildren(container)).toEqual(<div>Hello</div>);

    expect(loggedErrors).toEqual([theError]);
  });

  /** 内层lazy永远pending，其Suspense fallback的Throw抛Bye；Fizz记录一次错误及Throw→Suspense Fallback→div→Suspense→App特殊栈，验证错误来自fallback而非primary组件。 */
  it('should have special stacks if Suspense fallback', async () => {
    const infinitePromise = new Promise(() => {});
    const InfiniteComponent = React.lazy(() => {
      return infinitePromise;
    });

    /**
     * 用text构造异常，在内层Suspense fallback render中抛出。
     * @param props text为错误message，此例Bye。
     * @throws 对应Error。
     */
    function Throw({text}) {
      throw new Error(text);
    }

    /**
     * 永不完成的lazy令内fallback Throw抛错，外层Suspense提供Loading，形成特殊Fallback组件栈。
     * @returns 两层Suspense树。
     */
    function App() {
      return (
        <Suspense fallback="Loading">
          <div>
            <Suspense fallback={<Throw text="Bye" />}>
              <InfiniteComponent text="Hi" />
            </Suspense>
          </div>
        </Suspense>
      );
    }

    const loggedErrors = [];
    /**
     * 采集fallback错误message与componentStack，返回Hash of(message)供Fizz编码。
     * @param x Throw的Bye错误。
     * @param errorInfo Fizz提供的特殊fallback栈。
     * @returns hash字符串。
     */
    function onError(x, errorInfo) {
      loggedErrors.push({
        message: x.message,
        componentStack: errorInfo.componentStack,
      });
      return 'Hash of (' + x.message + ')';
    }
    loggedErrors.length = 0;

    await act(() => {
      const {pipe} = renderToPipeableStream(<App />, {
        onError,
      });
      pipe(writable);
    });

    expect(loggedErrors.length).toBe(1);
    expect(loggedErrors[0].message).toBe('Bye');
    expect(normalizeCodeLocInfo(loggedErrors[0].componentStack)).toBe(
      componentStack(['Throw', 'Suspense Fallback', 'div', 'Suspense', 'App']),
    );
  });

  /** 把React.lazy对象本身作为元素位置子项，初次Loading且没有额外partial DOM，节点数按external runtime配置分支；promise default解为Text元素后显示Hello，验证lazy element不是组件调用。 */
  it('should asynchronously load a lazy element', async () => {
    let resolveElement;
    const lazyElement = React.lazy(() => {
      return new Promise(r => {
        resolveElement = r;
      });
    });

    await act(() => {
      const {pipe} = renderToPipeableStream(
        <div>
          <Suspense fallback={<Text text="Loading..." />}>
            {lazyElement}
          </Suspense>
        </div>,
      );
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(<div>Loading...</div>);
    // Suspense 边界内还没有可写入的内容，因此此时不应 flush 出任何额外的部分数据。
    expect(
      stripExternalRuntimeInNodes(
        container.childNodes,
        renderOptions.unstable_externalRuntimeSrc,
      ).length,
    ).toBe(gate(flags => flags.shouldUseFizzExternalRuntime) ? 1 : 2);
    await act(() => {
      resolveElement({default: <Text text="Hello" />});
    });
    expect(getVisibleChildren(container)).toEqual(<div>Hello</div>);
  });

  /** lazy element模块在SSR等待，hydrate客户端已有Hello元素仍等待服务端；拒绝后只记一次server错误并核对recoverable message/digest/栈。最终Hello DOM断言被注释，场景不宣称已直接验证最终内容。 */
  it('should client render a boundary if a lazy element rejects', async () => {
    let rejectElement;
    const element = <Text text="Hello" />;
    const lazyElement = React.lazy(() => {
      return new Promise((resolve, reject) => {
        rejectElement = reject;
      });
    });

    const theError = new Error('Test');
    const loggedErrors = [];
    /**
     * 保存lazy element拒绝错误并生成小写hash of(message)digest；额外errorInfo未读取。
     * @param x Test异常。
     * @param errorInfo 未使用的上下文。
     * @returns digest字符串。
     */
    function onError(x, errorInfo) {
      loggedErrors.push(x);
      return 'hash of (' + x.message + ')';
    }
    const expectedDigest = onError(theError);
    loggedErrors.length = 0;

    /**
     * server子位置放lazyElement对象，client放已创建Text元素，比较元素惰性解码拒绝后的接管。
     * @param props isClient选择同步或惰性元素。
     * @returns div/Loading边界。
     */
    function App({isClient}) {
      return (
        <div>
          <Suspense fallback={<Text text="Loading..." />}>
            {isClient ? element : lazyElement}
          </Suspense>
        </div>
      );
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<App isClient={false} />, {
        onError,
      });
      pipe(writable);
    });
    expect(loggedErrors).toEqual([]);

    const errors = [];
    // 尝试 hydrate 内容。
    ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
      /**
       * 保存lazy element恢复异常和栈，供DEV/生产格式断言；不自行修改UI。
       * @param error 恢复Error。
       * @param errorInfo 组件栈上下文。
       */
      onRecoverableError(error, errorInfo) {
        errors.push({error, errorInfo});
      },
    });
    await waitForAll([]);

    // 我们仍在加载，因为我们正在等待服务器流更多内容。
    expect(getVisibleChildren(container)).toEqual(<div>Loading...</div>);

    expect(loggedErrors).toEqual([]);

    await act(() => {
      rejectElement(theError);
    });

    expect(loggedErrors).toEqual([theError]);

    // 客户端 hydration 尚未运行。
    expect(getVisibleChildren(container)).toEqual(<div>Loading...</div>);

    // 我们现在可以客户端渲染它了。
    await waitForAll([]);

    expectErrors(
      errors,
      [
        [
          'Switched to client rendering because the server rendering errored:\n\n' +
            theError.message,
          expectedDigest,
          componentStack(['Suspense', 'div', 'App']),
        ],
      ],
      [
        [
          'The server could not finish this Suspense boundary, likely due to an error during server rendering. Switched to client rendering.',
          expectedDigest,
        ],
      ],
    );

    // 客户端已渲染 HTML。
    // expect(getVisibleChildren(container)).toEqual(<div>Hello</div>);

    expect(loggedErrors).toEqual([theError]);
  });

  /** Erroring经三层Indirection在shell输出前抛uh oh，SSR onError一次并返回hash；hydrate切isClient直接显示Hello World，恢复错误保留digest且DEV栈含三层Indirection。 */
  it('Errors in boundaries should be sent to the client and reported on client render - Error before flushing', async () => {
    /**
     * level大于零时自递归减一，零时透传children，用三层同名组件验证错误栈包含每层。
     * @param props level为剩余层数，children为Erroring。
     * @returns 递归元素或children。
     */
    function Indirection({level, children}) {
      if (level > 0) {
        return <Indirection level={level - 1}>{children}</Indirection>;
      }
      return children;
    }

    const theError = new Error('uh oh');

    /**
     * server分支抛固定theError，client分支返回Hello World，让hydrate能接管服务端已失败边界。
     * @param props isClient控制是否成功。
     * @returns 客户端文本；SSR抛uh oh。
     */
    function Erroring({isClient}) {
      if (isClient) {
        return 'Hello World';
      }
      throw theError;
    }

    /**
     * 将Erroring放入level=2的Indirection和loading边界，跨SSR/hydrate保留递归错误栈结构。
     * @param props isClient传给Erroring。
     * @returns div/边界树。
     */
    function App({isClient}) {
      return (
        <div>
          <Suspense fallback={<span>loading...</span>}>
            <Indirection level={2}>
              <Erroring isClient={isClient} />
            </Indirection>
          </Suspense>
        </div>
      );
    }

    const loggedErrors = [];
    /**
     * 记录shell输出前的原错误并返回hash(message)digest，先人工求期望再清日志。
     * @param x uh oh错误。
     * @returns digest字符串。
     */
    function onError(x) {
      loggedErrors.push(x);
      return 'hash(' + x.message + ')';
    }
    const expectedDigest = onError(theError);
    loggedErrors.length = 0;

    await act(() => {
      const {pipe} = renderToPipeableStream(
        <App />,

        {
          onError,
        },
      );
      pipe(writable);
    });
    expect(loggedErrors).toEqual([theError]);

    const errors = [];
    // 尝试 hydrate 内容。
    ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
      /**
       * 保存客户端接管错误及栈，核对三层Indirection和服务端digest。
       * @param error 恢复异常。
       * @param errorInfo 组件栈上下文。
       */
      onRecoverableError(error, errorInfo) {
        errors.push({error, errorInfo});
      },
    });
    await waitForAll([]);

    expect(getVisibleChildren(container)).toEqual(<div>Hello World</div>);

    expectErrors(
      errors,
      [
        [
          'Switched to client rendering because the server rendering errored:\n\n' +
            theError.message,
          expectedDigest,
          componentStack([
            'Erroring',
            'Indirection',
            'Indirection',
            'Indirection',
            'Suspense',
            'div',
            'App',
          ]),
        ],
      ],
      [
        [
          'The server could not finish this Suspense boundary, likely due to an error during server rendering. Switched to client rendering.',
          expectedDigest,
        ],
      ],
    );
  });

  /** 初次lazy pending先输出Loading，hydrate客户端Hello仍等server流；随后lazy拒绝uh oh，server记一次hash，直到推进客户端工作才显示Hello并报告含Lazy栈的恢复错误，区分流已发出的错误恢复。 */
  it('Errors in boundaries should be sent to the client and reported on client render - Error after flushing', async () => {
    let rejectComponent;
    const LazyComponent = React.lazy(() => {
      return new Promise((resolve, reject) => {
        rejectComponent = reject;
      });
    });

    /**
     * server以lazy模块等待，client同步返回Hello；同Loading边界用于已流出fallback后的模块拒绝恢复。
     * @param props isClient选择Text或LazyComponent。
     * @returns div/边界。
     */
    function App({isClient}) {
      return (
        <div>
          <Suspense fallback={<Text text="Loading..." />}>
            {isClient ? <Text text="Hello" /> : <LazyComponent text="Hello" />}
          </Suspense>
        </div>
      );
    }

    const loggedErrors = [];
    const theError = new Error('uh oh');
    /**
     * 采集晚拒绝lazy的uh oh并返回hash(message)，供客户端恢复异常携带。
     * @param x 服务端模块拒绝原因。
     * @returns digest字符串。
     */
    function onError(x) {
      loggedErrors.push(x);
      return 'hash(' + x.message + ')';
    }
    const expectedDigest = onError(theError);
    loggedErrors.length = 0;

    await act(() => {
      const {pipe} = renderToPipeableStream(
        <App />,

        {
          onError,
        },
      );
      pipe(writable);
    });
    expect(loggedErrors).toEqual([]);

    const errors = [];
    // 尝试 hydrate 内容。
    ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
      /**
       * 收集late server失败后的客户端恢复错误和Lazy组件栈。
       * @param error 恢复异常。
       * @param errorInfo 组件栈上下文。
       */
      onRecoverableError(error, errorInfo) {
        errors.push({error, errorInfo});
      },
    });
    await waitForAll([]);

    expect(getVisibleChildren(container)).toEqual(<div>Loading...</div>);

    await act(() => {
      rejectComponent(theError);
    });

    expect(loggedErrors).toEqual([theError]);
    expect(getVisibleChildren(container)).toEqual(<div>Loading...</div>);

    // 我们现在可以客户端渲染它了。
    await waitForAll([]);

    expectErrors(
      errors,
      [
        [
          'Switched to client rendering because the server rendering errored:\n\n' +
            theError.message,
          expectedDigest,
          componentStack(['Lazy', 'Suspense', 'div', 'App']),
        ],
      ],
      [
        [
          'The server could not finish this Suspense boundary, likely due to an error during server rendering. Switched to client rendering.',
          expectedDigest,
        ],
      ],
    );

    // 客户端已渲染 HTML。
    expect(getVisibleChildren(container)).toEqual(<div>Hello</div>);
    expect(loggedErrors).toEqual([theError]);
  });

  /** AsyncText Hello World初次pending输出Loading，显式resolveText后server流脚本替换为成功文本，验证基础Suspense渐进揭示，无hydrate步骤。 */
  it('should asynchronously load the suspense boundary', async () => {
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <div>
          <Suspense fallback={<Text text="Loading..." />}>
            <AsyncText text="Hello World" />
          </Suspense>
        </div>,
      );
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(<div>Loading...</div>);
    await act(() => {
      resolveText('Hello World');
    });
    expect(getVisibleChildren(container)).toEqual(<div>Hello World</div>);
  });

  /** bootstrap在fallback流到达时已启动hydrate，但Hello仍pending；server解文本后h1 DOM已插而ref仍null，再推进客户端调度后ref严格等于原h1，区分流揭示与实际hydrate完成。 */
  it('waits for pending content to come in from the server and then hydrates it', async () => {
    const ref = React.createRef();

    /**
     * h1带共享ref，内部AsyncText等Hello；同树SSR/hydrate用于证明server插入节点先于ref附着。
     * @returns div/Suspense/h1结构。
     */
    function App() {
      return (
        <div>
          <Suspense fallback="Loading...">
            <h1 ref={ref}>
              <AsyncText text="Hello" />
            </h1>
          </Suspense>
        </div>
      );
    }

    let bootstrapped = false;
    /** bootstrap脚本调用时标记启动并hydrate App，使服务器完成后能对比ref与同一h1节点。 */
    window.__INIT__ = function () {
      bootstrapped = true;
    // 尝试 hydrate 内容。
      ReactDOMClient.hydrateRoot(container, <App />);
    };

    await act(() => {
      const {pipe} = renderToPipeableStream(<App />, {
        bootstrapScriptContent: '__INIT__();',
      });
      pipe(writable);
    });

    // 我们仍然显示一个备用方案。
    expect(getVisibleChildren(container)).toEqual(<div>Loading...</div>);

    // 我们已经启动了。
    expect(bootstrapped).toBe(true);

    // 尝试 hydrate 内容。
    await waitForAll([]);

    // 我们仍在加载，因为我们正在等待服务器流更多内容。
    expect(getVisibleChildren(container)).toEqual(<div>Loading...</div>);

    // 现在，服务器会在备用中更新内容。
    await act(() => {
      resolveText('Hello');
    });

    // 现在已使用了最后的 HTML.
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <h1>Hello</h1>
      </div>,
    );
    const h1 = container.getElementsByTagName('h1')[0];

    // 但它还没有完成 hydration。
    expect(ref.current).toBe(null);

    await waitForAll([]);

    // 现在 hydration 已完成。
    expect(ref.current).toBe(h1);
  });

  /** SSR与hydrate共用This Errors文本缓存，server先pending后reject Error Message；仍fallback且ref=null，推进客户端后class边界捕获同错误并显示b，ref等于该b，验证服务端失败后客户端自身也失败的回退。 */
  it('handles an error on the client if the server ends up erroring', async () => {
    const ref = React.createRef();

    /** 客户端读取已rejected文本时捕获异常，回退b节点与成功span共用ref，用于验证最终ref切到错误UI。 */
    class ErrorBoundary extends React.Component {
      /** error初值null透传children，派生异常后选择b回退。 */
      state = {error: null};
      /**
       * 把客户端文本缓存读取异常转换为error状态。
       * @param error Error Message异常。
       * @returns error补丁。
       */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /**
       * 有truthy error时返回绑定ref的b/message，无错透传children；自身没有I/O。
       * @returns 错误b或原树。
       */
      render() {
        if (this.state.error) {
          return <b ref={ref}>{this.state.error.message}</b>;
        }
        return this.props.children;
      }
    }

    /**
     * class边界包住Loading Suspense与带ref的AsyncText span，SSR等待与客户端错误共用缓存记录。
     * @returns 错误边界树。
     */
    function App() {
      return (
        <ErrorBoundary>
          <div>
            <Suspense fallback="Loading...">
              <span ref={ref}>
                <AsyncText text="This Errors" />
              </span>
            </Suspense>
          </div>
        </ErrorBoundary>
      );
    }

    const loggedErrors = [];

    // 先让边界挂起，并开始流式传输加载状态。
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <App />,

        {
          /**
           * 记录server文本记录reject后的原Error，客户端边界状态由后续render独立决定。
           * @param x server拒绝错误。
           */
          onError(x) {
            loggedErrors.push(x);
          },
        },
      );
      pipe(writable);
    });

    // 我们仍然显示一个备用方案。
    expect(getVisibleChildren(container)).toEqual(<div>Loading...</div>);

    expect(loggedErrors).toEqual([]);

    // 尝试 hydrate 内容。
    ReactDOMClient.hydrateRoot(container, <App />);
    await waitForAll([]);

    // 我们仍在加载，因为我们正在等待服务器流更多内容。
    expect(getVisibleChildren(container)).toEqual(<div>Loading...</div>);

    const theError = new Error('Error Message');
    await act(() => {
      rejectText('This Errors', theError);
    });

    expect(loggedErrors).toEqual([theError]);

    // 服务器已报错，但客户端尚未完成 hydration，因此还不知道客户端能否成功，继续显示加载状态。
    expect(getVisibleChildren(container)).toEqual(<div>Loading...</div>);
    expect(ref.current).toBe(null);

    // Flush hydration 工作。
    await waitForAll([]);

    // Hydration 应触发错误，并替换该 Suspense 边界。
    expect(getVisibleChildren(container)).toEqual(<b>Error Message</b>);

    const b = container.getElementsByTagName('b')[0];
    expect(ref.current).toBe(b);
  });

  /** enableSuspenseList下forwards/visible的A pending、B同步，hydrate两行尚未完成时根更新追加C；三行都先显示fallback且ref=null，解A后A/B/C按序显示并ref挂到A span，插入行遵守未完成前行顺序。 */
  // @gate enableSuspenseList
  it('shows inserted items before pending in a SuspenseList as fallbacks while hydrating', async () => {
    const ref = React.createRef();

    // 这些被提升以避免它们重新渲染。
    const a = (
      <Suspense fallback="Loading A">
        <span ref={ref}>
          <AsyncText text="A" />
        </span>
      </Suspense>
    );
    const b = (
      <Suspense fallback="Loading B">
        <span>
          <Text text="B" />
        </span>
      </Suspense>
    );

    /**
     * 使用预先创建的a/b元素保持引用稳定，按showMore追加同步C行；forwards/visible列表控制hydrate期新行揭示。
     * @param props showMore决定是否渲染C边界。
     * @returns div/SuspenseList。
     */
    function App({showMore}) {
      return (
        <div>
          <SuspenseList revealOrder="forwards" tail="visible">
            {a}
            {b}
            {showMore ? (
              <Suspense fallback="Loading C">
                <span>C</span>
              </Suspense>
            ) : null}
          </SuspenseList>
        </div>
      );
    }

    // 先让边界挂起，并开始流式传输加载状态。
    await act(() => {
      const {pipe} = renderToPipeableStream(<App showMore={false} />);
      pipe(writable);
    });

    const root = ReactDOMClient.hydrateRoot(
      container,
      <App showMore={false} />,
    );
    await waitForAll([]);

    // 我们尚未进行hydration。
    expect(ref.current).toBe(null);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        {'Loading A'}
        {'Loading B'}
      </div>,
    );

    // 在我们已经成功水合了前两个元素之前添加更多行。
    root.render(<App showMore={true} />);
    await waitForAll([]);

    // 我们尚未进行hydration。
    expect(ref.current).toBe(null);

    // 我们尚未解决。
    expect(getVisibleChildren(container)).toEqual(
      <div>
        {'Loading A'}
        {'Loading B'}
        {'Loading C'}
      </div>,
    );

    await act(async () => {
      await resolveText('A');
    });

    await waitForAll([]);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </div>,
    );

    const span = container.getElementsByTagName('span')[0];
    expect(ref.current).toBe(span);
  });

  /** Hello/World两边界pending且hydrate已开始，无原因abort服务器为两边界编码同digest并报告两条恢复错误；客户端文本仍pending所以fallback保留，随后clientAct解两记录才显示h1 Hello/main World。 */
  it('client renders a boundary if it does not resolve before aborting', async () => {
    /**
     * Hello文本位于h1边界，World位于main边界，两任务abort时生成不同栈并可各转客户端等待。
     * @returns 两个pending边界的div。
     */
    function App() {
      return (
        <div>
          <Suspense fallback="Loading...">
            <h1>
              <AsyncText text="Hello" />
            </h1>
          </Suspense>
          <main>
            <Suspense fallback="loading...">
              <AsyncText text="World" />
            </Suspense>
          </main>
        </div>
      );
    }

    const loggedErrors = [];
    const expectedDigest = 'Hash for Abort';
    /**
     * 采集两边界abort原因并统一返回expectedDigest；无原因abort由Fizz构造默认错误。
     * @param error 服务端任务中止异常。
     * @returns Hash for Abort。
     */
    function onError(error) {
      loggedErrors.push(error);
      return expectedDigest;
    }

    let controls;
    await act(() => {
      controls = renderToPipeableStream(<App />, {onError});
      controls.pipe(writable);
    });

    // 我们仍然显示一个备用方案。

    const errors = [];
    // 尝试 hydrate 内容。
    ReactDOMClient.hydrateRoot(container, <App />, {
      /**
       * 记录两条客户端接管错误及各自任务栈，expectErrors核对共同digest与h1/main差异。
       * @param error 接管异常。
       * @param errorInfo 任务组件栈。
       */
      onRecoverableError(error, errorInfo) {
        errors.push({error, errorInfo});
      },
    });
    await waitForAll([]);

    // 我们仍在加载，因为我们正在等待服务器流更多内容。
    expect(getVisibleChildren(container)).toEqual(
      <div>
        Loading...<main>loading...</main>
      </div>,
    );

    // 我们中断服务器响应。
    await act(() => {
      controls.abort();
    });

    // 我们仍然无法在客户端渲染它。
    await waitForAll([]);
    expectErrors(
      errors,
      [
        [
          'Switched to client rendering because the server rendering aborted due to:\n\n' +
            'The render was aborted by the server without a reason.',
          expectedDigest,
          // 这里取得的是任务中止时的组件栈，因此栈中会出现 `h1`。
          componentStack(['AsyncText', 'h1', 'Suspense', 'div', 'App']),
        ],
        [
          'Switched to client rendering because the server rendering aborted due to:\n\n' +
            'The render was aborted by the server without a reason.',
          expectedDigest,
          componentStack(['AsyncText', 'Suspense', 'main', 'div', 'App']),
        ],
      ],
      [
        [
          'The server could not finish this Suspense boundary, likely due to an error during server rendering. Switched to client rendering.',
          expectedDigest,
        ],
        [
          'The server could not finish this Suspense boundary, likely due to an error during server rendering. Switched to client rendering.',
          expectedDigest,
        ],
      ],
    );
    expect(getVisibleChildren(container)).toEqual(
      <div>
        Loading...<main>loading...</main>
      </div>,
    );

    // 我们现在在客户端解析它。
    await clientAct(() => {
      resolveText('Hello');
      resolveText('World');
    });
    assertLog([]);

    // 客户端已渲染 HTML。
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <h1>Hello</h1>
        <main>World</main>
      </div>,
    );
  });

  /** 将两个独立Fizz流写入同一文档的不同容器，共享底层PassThrough并分别用A_/B_标识前缀。初始两个fallback均可见；先完成B只替换B，再完成A替换A，最后手动结束共享流，验证边界ID与流结束互不干扰。 */
  it('should allow for two containers to be written to the same document', async () => {
    // 为两个容器各创建一个 passthrough 流，但不实现 end()：任一流完成时都不应关闭底层流；
    // 等两者都完成后再手动关闭。
    const writableA = new Stream.Writable();
    /**
     * 把流A的chunk及encoding/完成回调转发共享PassThrough；仅转发write，A结束不结束共享流。
     * @param chunk 流A输出块。
     * @param encoding 块编码。
     * @param next Writable写完成回调。
     */
    writableA._write = (chunk, encoding, next) => {
      writable.write(chunk, encoding, next);
    };
    const writableB = new Stream.Writable();
    /**
     * 把流B的chunk及encoding/完成回调转发共享PassThrough，B与A共享文档但各自结束不关闭共享流。
     * @param chunk 流B输出块。
     * @param encoding 编码。
     * @param next 写完成回调。
     */
    writableB._write = (chunk, encoding, next) => {
      writable.write(chunk, encoding, next);
    };

    await act(() => {
      const {pipe} = renderToPipeableStream(
        // 我们使用两个嵌套的边界来覆盖旧的重入性漏洞。
        <div>
          <Suspense fallback="Loading...">
            <Suspense fallback={<Text text="Loading A..." />}>
              <>
                <Text text="This will show A: " />
                <div>
                  <AsyncText text="A" />
                </div>
              </>
            </Suspense>
          </Suspense>
        </div>,
        {
          identifierPrefix: 'A_',
          /** 流A的shell就绪时向共享流写入containerA开标签，管道转发A的内容，再写闭标签；A自己的Writable结束不结束共享流。 */
          onShellReady() {
            writableA.write('<div id="container-A">');
            pipe(writableA);
            writableA.write('</div>');
          },
        },
      );
    });

    await act(() => {
      const {pipe} = renderToPipeableStream(
        <div>
          <Suspense fallback={<Text text="Loading B..." />}>
            <Text text="This will show B: " />
            <div>
              <AsyncText text="B" />
            </div>
          </Suspense>
        </div>,
        {
          identifierPrefix: 'B_',
          /** 流B的shell就绪时写入containerB包裹并转发B内容；配合B_前缀，将恢复指令限定在B的边界。 */
          onShellReady() {
            writableB.write('<div id="container-B">');
            pipe(writableB);
            writableB.write('</div>');
          },
        },
      );
    });

    expect(getVisibleChildren(container)).toEqual([
      <div id="container-A">
        <div>Loading A...</div>
      </div>,
      <div id="container-B">
        <div>Loading B...</div>
      </div>,
    ]);

    await act(() => {
      resolveText('B');
    });

    expect(getVisibleChildren(container)).toEqual([
      <div id="container-A">
        <div>Loading A...</div>
      </div>,
      <div id="container-B">
        <div>
          This will show B: <div>B</div>
        </div>
      </div>,
    ]);

    await act(() => {
      resolveText('A');
    });

    // 两个流均已写完。
    writable.end();

    expect(getVisibleChildren(container)).toEqual([
      <div id="container-A">
        <div>
          This will show A: <div>A</div>
        </div>
      </div>,
      <div id="container-B">
        <div>
          This will show B: <div>B</div>
        </div>
      </div>,
    ]);
  });

  /** 在select的option、table的colgroup/col、SVG的g/path及MathML的mi中暂停文本读取；依次完成Hello、World、my-path、my-mi后核对最终节点结构，并显式检查path与mi命名空间，验证特殊父节点的片段恢复。 */
  it('can resolve async content in esoteric parents', async () => {
    /**
     * 以text为文本缓存键读取；未完成时暂停，完成后把返回文本放入option，验证select特殊插入上下文。
     * @param text option显示文本及暂停缓存键。
     * @returns option元素。
     */
    function AsyncOption({text}) {
      return <option>{readText(text)}</option>;
    }

    /**
     * 读取className对应的文本缓存；完成后生成带该类名的col，暂停时使外层边界等待。
     * @param className 异步类名的缓存键。
     * @returns col元素。
     */
    function AsyncCol({className}) {
      return <col className={readText(className)} />;
    }

    /**
     * 读取id对应的文本缓存，完成后生成SVG path；配合SVG父节点验证恢复命名空间。
     * @param id 异步ID的缓存键。
     * @returns path元素。
     */
    function AsyncPath({id}) {
      return <path id={readText(id)} />;
    }

    /**
     * 读取id对应缓存并生成MathML mi，验证同一流中MathML恢复上下文。
     * @param id 异步ID的缓存键。
     * @returns mi元素。
     */
    function AsyncMi({id}) {
      return <mi id={readText(id)} />;
    }

    /**
     * 同时建立select、table、SVG和MathML暂停树；option独占一个Suspense，其余三种特殊父节点共用另一个边界。
     * @returns 供分批完成文本的测试树。
     */
    function App() {
      return (
        <div>
          <select>
            <Suspense fallback="Loading...">
              <AsyncOption text="Hello" />
            </Suspense>
          </select>
          <Suspense fallback="Loading...">
            <table>
              <colgroup>
                <AsyncCol className="World" />
              </colgroup>
            </table>
            <svg>
              <g>
                <AsyncPath id="my-path" />
              </g>
            </svg>
            <math>
              <AsyncMi id="my-mi" />
            </math>
          </Suspense>
        </div>
      );
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <select>Loading...</select>Loading...
      </div>,
    );

    await act(() => {
      resolveText('Hello');
    });

    await act(() => {
      resolveText('World');
    });

    await act(() => {
      resolveText('my-path');
      resolveText('my-mi');
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <select>
          <option>Hello</option>
        </select>
        <table>
          <colgroup>
            <col class="World" />
          </colgroup>
        </table>
        <svg>
          <g>
            <path id="my-path" />
          </g>
        </svg>
        <math>
          <mi id="my-mi" />
        </math>
      </div>,
    );

    expect(container.querySelector('#my-path').namespaceURI).toBe(
      'http://www.w3.org/2000/svg',
    );
    expect(container.querySelector('#my-mi').namespaceURI).toBe(
      'http://www.w3.org/1998/Math/MathML',
    );
  });

  /** 将tbody、tr、td分别置于异步读取A、B、C的组件中，table内Suspense先输出合法tbody fallback，再依次完成三项。断言初始Loading和最终A/B类名及C单元格，验证表格片段插入；本例不逐步断言中间DOM。 */
  it('can resolve async content in table parents', async () => {
    /**
     * 读取className后输出tbody并保留children；未完成时暂停当前表格分支。
     * @param className tbody类名的缓存键。
     * @param children 待恢复的表格行。
     * @returns tbody元素。
     */
    function AsyncTableBody({className, children}) {
      return <tbody className={readText(className)}>{children}</tbody>;
    }

    /**
     * 读取className后输出tr并保留children，形成tbody恢复之后仍可暂停的行。
     * @param className tr类名的缓存键。
     * @param children 单元格内容。
     * @returns tr元素。
     */
    function AsyncTableRow({className, children}) {
      return <tr className={readText(className)}>{children}</tr>;
    }

    /**
     * 读取text后生成td；最后一个文本键完成才产出完整表格主内容。
     * @param text 单元格文本及缓存键。
     * @returns td元素。
     */
    function AsyncTableCell({text}) {
      return <td>{readText(text)}</td>;
    }

    /**
     * 在table中建立异步tbody→tr→td链，以合法tbody/tr/td结构作为Suspense fallback，检验表格插入上下文。
     * @returns 表格测试树。
     */
    function App() {
      return (
        <table>
          <Suspense
            fallback={
              <tbody>
                <tr>
                  <td>Loading...</td>
                </tr>
              </tbody>
            }>
            <AsyncTableBody className="A">
              <AsyncTableRow className="B">
                <AsyncTableCell text="C" />
              </AsyncTableRow>
            </AsyncTableBody>
          </Suspense>
        </table>
      );
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });

    expect(getVisibleChildren(container)).toEqual(
      <table>
        <tbody>
          <tr>
            <td>Loading...</td>
          </tr>
        </tbody>
      </table>,
    );

    await act(() => {
      resolveText('A');
    });

    await act(() => {
      resolveText('B');
    });

    await act(() => {
      resolveText('C');
    });

    expect(getVisibleChildren(container)).toEqual(
      <table>
        <tbody class="A">
          <tr class="B">
            <td>C</td>
          </tr>
        </tbody>
      </table>,
    );
  });

  /** 以SVG namespaceURI渲染g内暂停的path，由onShellReady写入外层svg并管道输出。先核对text fallback，完成my-path后核对path结构和SVG命名空间，验证SVG容器中的流式片段恢复。 */
  it('can stream into an SVG container', async () => {
    /**
     * 在SVG容器测试中读取id缓存后生成path，暂停让g先显示text fallback。
     * @param id path ID的缓存键。
     * @returns path元素。
     */
    function AsyncPath({id}) {
      return <path id={readText(id)} />;
    }

    /**
     * 输出g及其Suspense边界，让异步path与text fallback共享SVG上下文。
     * @returns g元素。
     */
    function App() {
      return (
        <g>
          <Suspense fallback={<text>Loading...</text>}>
            <AsyncPath id="my-path" />
          </Suspense>
        </g>
      );
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(
        <App />,

        {
          namespaceURI: 'http://www.w3.org/2000/svg',
          /** 先写svg开标签再管道转发指定SVG命名空间的shell，最后写闭标签，使Fizz输出成为svg内部内容。 */
          onShellReady() {
            writable.write('<svg>');
            pipe(writable);
            writable.write('</svg>');
          },
        },
      );
    });

    expect(getVisibleChildren(container)).toEqual(
      <svg>
        <g>
          <text>Loading...</text>
        </g>
      </svg>,
    );

    await act(() => {
      resolveText('my-path');
    });

    expect(getVisibleChildren(container)).toEqual(
      <svg>
        <g>
          <path id="my-path" />
        </g>
      </svg>,
    );

    expect(container.querySelector('#my-path').namespaceURI).toBe(
      'http://www.w3.org/2000/svg',
    );
  });

  /**
   * 将匹配的at/in堆栈行统一为in 名称 (at **)，屏蔽文件与行号差异；未匹配部分保留，假值经短路原样返回。
   * @param str 待稳定化的警告栈文本或假值。
   * @returns 稳定化文本或输入假值。
   */
  function normalizeCodeLocInfo(str) {
    return (
      str &&
      String(str).replace(/\n +(?:at|in) ([^\(]+) [^\n]*/g, function (m, name) {
        return '\n    in ' + name + ' (at **)';
      })
    );
  }

  /** 组件B先在Hello/World读取处暂停，fallback组件C包含大小写错误的标签；完成文本后B通过未加key的map生成span。DEV分别断言fallback标签警告与恢复后key警告的组件栈，再核对两个span，验证暂停前后栈上下文。 */
  it('should include a component stack across suspended boundaries', async () => {
    /**
     * 先读取Hello和World，两项均完成后map成未加key的span；有意保留缺key以检查恢复后的警告栈。
     * @returns span数组。
     */
    function B() {
      const children = [readText('Hello'), readText('World')];
      // 故意触发一个 key 警告。
      return (
        <div>
          {children.map(/**
 * 将已完成文本映射为未加key的span，故意触发key警告并在组件栈保留mapper名。
 * @param t 已完成文本。
 * @returns span。
 */ function mapper(t) {
            return <span>{t}</span>;
          })}
        </div>
      );
    }
    /**
     * 作为暂停期间的fallback，输出故意大小写错误的inCorrectTag与Loading文本，触发标签警告栈。
     * @returns fallback元素。
     */
    function C() {
      return (
        <inCorrectTag>
          <Text text="Loading" />
        </inCorrectTag>
      );
    }
    /**
     * 用Suspense包裹B并以C兜底，保留外层div，比较暂停前后警告中的组件栈。
     * @returns 警告栈测试树。
     */
    function A() {
      return (
        <div>
          <Suspense fallback={<C />}>
            <B />
          </Suspense>
        </div>
      );
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<A />);
      pipe(writable);
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <incorrecttag>Loading</incorrecttag>
      </div>,
    );

    assertConsoleErrorDev([
      '<inCorrectTag /> is using incorrect casing. Use PascalCase for React components, or lowercase for HTML elements.' +
        '\n' +
        '    in inCorrectTag (at **)\n' +
        '    in C (at **)\n' +
        '    in A (at **)',
    ]);

    await act(() => {
      resolveText('Hello');
      resolveText('World');
    });

    assertConsoleErrorDev([
      'Each child in a list should have a unique "key" prop.\n\nCheck the render method of `B`.' +
        ' See https://react.dev/link/warning-keys for more information.\n' +
        '    in span (at **)\n' +
        '    in mapper (at **)\n' +
        '    in Array.map (at **)\n' +
        '    in B (at **)\n' +
        '    in A (at **)',
    ]);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div>
          <span>Hello</span>
          <span>World</span>
        </div>
      </div>,
    );
  });

  /** 仅在legacy context启用时运行：外层provider为A，Suspense主内容的内层provider为B，consumer在Hello:读取处暂停。先断言fallback读到A，完成后断言主内容读到B、外部consumer仍读A，并核对DEV废弃API警告。 */
  // @gate !disableLegacyContext
  it('should can suspend in a class component with legacy context', async () => {
    /** 旧context provider夹具：先由派生state复制ctx prop，再通过getChildContext向后代发布，render直接返回children。 */
    class TestProvider extends React.Component {
      /** 声明旧context键test为字符串，使getChildContext返回值参与legacy context传递。 */
      static childContextTypes = {
        test: PropTypes.string,
      };
      /** 初始ctxToSet为空；首次渲染前由getDerivedStateFromProps复制本例A或B。 */
      state = {ctxToSet: null};
      /**
       * 把props.ctx复制为ctxToSet，保证旧context的值与当前输入一致；本实现不使用state入参。
       * @param props 当前ctx输入。
       * @param state React传入的旧state，本例未读取。
       * @returns 新ctxToSet片段。
       */
      static getDerivedStateFromProps(props, state) {
        return {ctxToSet: props.ctx};
      }
      /**
       * 发布state中ctxToSet为旧context的test键，供TestConsumer读取。
       * @returns legacy context对象。
       */
      getChildContext() {
        return {
          test: this.state.ctxToSet,
        };
      }
      /**
       * 直接透传children，使provider只影响旧context而不增加DOM包裹。
       * @returns children。
       */
      render() {
        return this.props.children;
      }
    }

    /** 旧context consumer夹具：把test值写入b；有prefix时先读取异步文本，制造读取上下文后暂停的路径。 */
    class TestConsumer extends React.Component {
      /** 声明消费旧context的字符串键test。 */
      static contextTypes = {
        test: PropTypes.string,
      };
      /**
       * 以this.context.test生成b；prefix存在时先读文本缓存并组合到Fragment，未完成则暂停整个consumer。
       * @returns b或前缀与b组成的Fragment。
       */
      render() {
        const child = (
          <b>
            <Text text={this.context.test} />
          </b>
        );
        if (this.props.prefix) {
          return (
            <>
              {readText(this.props.prefix)}
              {child}
            </>
          );
        }
        return child;
      }
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(
        <TestProvider ctx="A">
          <div>
            <Suspense
              fallback={
                <>
                  <Text text="Loading: " />
                  <TestConsumer />
                </>
              }>
              <TestProvider ctx="B">
                <TestConsumer prefix="Hello: " />
              </TestProvider>
              <TestConsumer />
            </Suspense>
          </div>
        </TestProvider>,
      );
      pipe(writable);
    });
    assertConsoleErrorDev([
      'TestProvider uses the legacy childContextTypes API which will soon be removed. ' +
        'Use React.createContext() instead. (https://react.dev/link/legacy-context)\n' +
        '    in TestProvider (at **)',
      'TestConsumer uses the legacy contextTypes API which will soon be removed. ' +
        'Use React.createContext() with static contextType instead. (https://react.dev/link/legacy-context)\n' +
        '    in TestConsumer (at **)',
    ]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        Loading: <b>A</b>
      </div>,
    );
    await act(() => {
      resolveText('Hello: ');
    });
    expect(getVisibleChildren(container)).toEqual(
      <div>
        Hello: <b>B</b>
        <b>A</b>
      </div>,
    );
  });

  /** 两个Context默认A0/B0，内层Provider将A改为A0.1，并让AsyncParent在Child:处暂停。完成后核对内部consumer为A0.1/B0、外部仍为A0，验证恢复捕获的上下文且不泄漏到外层。 */
  it('should resume the context from where it left off', async () => {
    const ContextA = React.createContext('A0');
    const ContextB = React.createContext('B0');

    /**
     * 通过ContextA.Consumer将当前A值交给Text，便于断言暂停分支内外的上下文。
     * @returns A上下文consumer元素。
     */
    function PrintA() {
      return (
        <ContextA.Consumer>{value => <Text text={value} />}</ContextA.Consumer>
      );
    }

    /** 用类组件contextType读取ContextB，覆盖与函数consumer并存的上下文恢复路径。 */
    class PrintB extends React.Component {
      /** 将类组件的this.context绑定到ContextB。 */
      static contextType = ContextB;
      /**
       * 把当前ContextB值传给Text，作为默认B0保持不变的观察点。
       * @returns Text元素。
       */
      render() {
        return <Text text={this.context} />;
      }
    }

    /**
     * 先渲染异步text，再在b中渲染children；text未完成时后代随Suspense暂停，完成后检查其捕获上下文。
     * @param text 暂停缓存键和前缀文本。
     * @param children 待恢复的context consumer。
     * @returns 文本与b组成的Fragment。
     */
    function AsyncParent({text, children}) {
      return (
        <>
          <AsyncText text={text} />
          <b>{children}</b>
        </>
      );
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(
        <div>
          <PrintA />
          <div>
            <ContextA.Provider value="A0.1">
              <Suspense fallback={<Text text="Loading..." />}>
                <AsyncParent text="Child:">
                  <PrintA />
                </AsyncParent>
                <PrintB />
              </Suspense>
            </ContextA.Provider>
          </div>
          <PrintA />
        </div>,
      );
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(
      <div>
        A0<div>Loading...</div>A0
      </div>,
    );
    await act(() => {
      resolveText('Child:');
    });
    expect(getVisibleChildren(container)).toEqual(
      <div>
        A0
        <div>
          Child:<b>A0.1</b>B0
        </div>
        A0
      </div>,
    );
  });

  /** 内层A0.1.1 Provider中的Throws读取该值后抛错；Suspense输出Loading，onError恰收一次A0.1.1。随后B consumer与内外A consumer仍输出B0/A0，验证错误回退时恢复外层上下文。 */
  it('should recover the outer context when an error happens inside a provider', async () => {
    const ContextA = React.createContext('A0');
    const ContextB = React.createContext('B0');

    /**
     * 通过ContextA.Consumer把当前A值写入Text，观察内层抛错后的外部上下文。
     * @returns ContextA consumer元素。
     */
    function PrintA() {
      return (
        <ContextA.Consumer>{value => <Text text={value} />}</ContextA.Consumer>
      );
    }

    /** 类组件ContextB consumer夹具，检查A provider错误回退后B默认值仍可读取。 */
    class PrintB extends React.Component {
      /** 将this.context绑定到ContextB，独立于本例发生错误的ContextA。 */
      static contextType = ContextB;
      /**
       * 把this.context写入Text，作为错误恢复后B0的观察点。
       * @returns Text元素。
       */
      render() {
        return <Text text={this.context} />;
      }
    }

    /**
     * 读取最内层ContextA并以该值构造Error抛出，使onError可断言错误发生时读取到A0.1.1。
     * @throws 带当前A值的Error。
     */
    function Throws() {
      const value = React.useContext(ContextA);
      throw new Error(value);
    }

    const loggedErrors = [];
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <div>
          <PrintA />
          <div>
            <ContextA.Provider value="A0.1">
              <Suspense
                fallback={
                  <b>
                    <Text text="Loading..." />
                  </b>
                }>
                <ContextA.Provider value="A0.1.1">
                  <Throws />
                </ContextA.Provider>
              </Suspense>
              <PrintB />
            </ContextA.Provider>
          </div>
          <PrintA />
        </div>,

        {
          /**
           * 收集最内层provider渲染抛出的错误；本例断言恰一次且消息为A0.1.1。
           * @param x 服务器渲染错误。
           */
          onError(x) {
            loggedErrors.push(x);
          },
        },
      );
      pipe(writable);
    });
    expect(loggedErrors.length).toBe(1);
    expect(loggedErrors[0].message).toEqual('A0.1.1');
    expect(getVisibleChildren(container)).toEqual(
      <div>
        A0
        <div>
          <b>Loading...</b>B0
        </div>
        A0
      </div>,
    );
  });

  /** 内层主内容Hello与其异步fallback Loading...均暂停，使外层先显示Loading root...。拒绝Hello只记录服务器错误，完成fallback后才可显示内层占位；客户端随后接管为Hello，并核对digest和恢复错误栈。 */
  it('client renders a boundary if it errors before finishing the fallback', async () => {
    /**
     * 按isClient选择同步Hello或异步Hello，且让内层fallback也暂停；外层Loading root...用于观察尚未就绪的fallback阻塞。
     * @param isClient 是否直接渲染客户端文本。
     * @returns 两层Suspense测试树。
     */
    function App({isClient}) {
      return (
        <div>
          <Suspense fallback="Loading root...">
            <div>
              <Suspense fallback={<AsyncText text="Loading..." />}>
                <h1>
                  {isClient ? (
                    <Text text="Hello" />
                  ) : (
                    <AsyncText text="Hello" />
                  )}
                </h1>
              </Suspense>
            </div>
          </Suspense>
        </div>
      );
    }

    const theError = new Error('Test');
    const loggedErrors = [];
    /**
     * 保存服务器错误并返回消息生成的digest；调用一次取得预期digest后清空收集列表，避免预计算计入服务器报错次数。
     * @param x 待记录错误。
     * @returns 错误digest。
     */
    function onError(x) {
      loggedErrors.push(x);
      return `hash of (${x.message})`;
    }
    const expectedDigest = onError(theError);
    loggedErrors.length = 0;

    let controls;
    await act(() => {
      controls = renderToPipeableStream(
        <App isClient={false} />,

        {
          onError,
        },
      );
      controls.pipe(writable);
    });

    // 我们仍然显示一个备用方案。

    const errors = [];
    // 尝试 hydrate 内容。
    ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
      /**
       * 收集边界服务器报错后客户端接管的error/errorInfo，供digest与组件栈断言。
       * @param error 恢复错误。
       * @param errorInfo 附带的恢复信息。
       */
      onRecoverableError(error, errorInfo) {
        errors.push({error, errorInfo});
      },
    });
    await waitForAll([]);

    // 我们仍在加载，因为我们正在等待服务器流更多内容。
    expect(getVisibleChildren(container)).toEqual(<div>Loading root...</div>);

    expect(loggedErrors).toEqual([]);

    // 让内容报错；此时 fallback 尚未就绪。
    await act(() => {
      rejectText('Hello', theError);
    });

    expect(loggedErrors).toEqual([theError]);

    // 我们仍然无法在客户端渲染它，因为还没有解除父组件的封锁。
    await waitForAll([]);
    expect(getVisibleChildren(container)).toEqual(<div>Loading root...</div>);

    // 解锁加载状态
    await act(() => {
      resolveText('Loading...');
    });

    // 现在我们可以显示内部边界。
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div>Loading...</div>
      </div>,
    );

    // 这样我们就可以客户端渲染它了。
    await waitForAll([]);
    expectErrors(
      errors,
      [
        [
          'Switched to client rendering because the server rendering errored:\n\n' +
            theError.message,
          expectedDigest,
          componentStack([
            'AsyncText',
            'h1',
            'Suspense',
            'div',
            'Suspense',
            'div',
            'App',
          ]),
        ],
      ],
      [
        [
          'The server could not finish this Suspense boundary, likely due to an error during server rendering. Switched to client rendering.',
          expectedDigest,
        ],
      ],
    );

    // 客户端已渲染 HTML。
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div>
          <h1>Hello</h1>
        </div>
      </div>,
    );

    expect(loggedErrors).toEqual([theError]);
  });

  /** 内层fallback的Loading文本暂停但其Inner片段已进入原始HTML，外层显示Loading Outer。只完成主内容Hello、不完成Loading，即断言直接显示Hello，验证主内容先完成可取消未完成fallback的依赖。 */
  it('should be able to abort the fallback if the main content finishes first', async () => {
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <div>
          <Suspense fallback={<Text text="Loading Outer" />}>
            <div>
              <Suspense
                fallback={
                  <div>
                    <AsyncText text="Loading" />
                    Inner
                  </div>
                }>
                <AsyncText text="Hello" />
              </Suspense>
            </div>
          </Suspense>
        </div>,
      );
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(<div>Loading Outer</div>);
    // 此时应已收到一个包含部分 fallback 的 segment。
    expect(container.innerHTML).toContain('Inner');
    await act(() => {
      resolveText('Hello');
    });
    // 无需等待 fallback 的其余部分，也应能够显示内容。
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div>Hello</div>
      </div>,
    );
  });

  /** 服务器树带Suspense并以getServerSnapshot输出server；客户端以不带该边界的App hydrate，读取client并报告根HTML不匹配，最终显示client。覆盖服务器快照选择与本例明确的结构不匹配恢复。 */
  it('calls getServerSnapshot instead of getSnapshot', async () => {
    const ref = React.createRef();

    /**
     * 服务器快照返回固定server，用渲染日志证明服务器没有读取客户端快照。
     * @returns server字符串。
     */
    function getServerSnapshot() {
      return 'server';
    }

    /**
     * 客户端快照返回固定client，供根不匹配后的客户端渲染读取。
     * @returns client字符串。
     */
    function getClientSnapshot() {
      return 'client';
    }

    /**
     * 空订阅夹具，不产生外部更新；返回空清理函数满足useSyncExternalStore订阅接口。
     * @returns 取消订阅函数。
     */
    function subscribe() {
      return () => {};
    }

    /**
     * 记录并返回传入text，观察实际使用服务器或客户端快照。
     * @param text 要输出的快照文本。
     * @returns text。
     */
    function Child({text}) {
      Scheduler.log(text);
      return text;
    }

    /**
     * 读取useSyncExternalStore的服务器/客户端快照并在带ref的div中输出Child；测试在服务器额外包裹Suspense。
     * @returns 快照显示树。
     */
    function App() {
      const value = useSyncExternalStore(
        subscribe,
        getClientSnapshot,
        getServerSnapshot,
      );
      return (
        <div ref={ref}>
          <Child text={value} />
        </div>
      );
    }

    const loggedErrors = [];
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <Suspense fallback="Loading...">
          <App />
        </Suspense>,
        {
          /**
           * 收集服务器错误，配合server渲染日志确认该阶段成功。
           * @param x 服务器渲染错误。
           */
          onError(x) {
            loggedErrors.push(x);
          },
        },
      );
      pipe(writable);
    });
    assertLog(['server']);

    ReactDOMClient.hydrateRoot(container, <App />, {
      /**
       * 记录恢复错误首句及存在时的cause，核对客户端省去Suspense包裹造成的根不匹配。
       * @param error hydration恢复错误。
       */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });

    // 首次绘制因不匹配而切换为客户端渲染。
    await waitForPaint([
      'client',
      "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
    ]);
    expect(getVisibleChildren(container)).toEqual(<div>client</div>);
  });

  // selector 实现采用惰性 ref 初始化模式。

  /** 服务器快照与客户端快照均为含env/other的对象，selector只保留env，isEqual按env比较；服务器输出server，客户端省略服务器Suspense包裹并报告根不匹配后显示client，覆盖selector路径的快照选择。 */
  it('calls getServerSnapshot instead of getSnapshot (with selector and isEqual)', async () => {
    // 如上一次测试一样。 但是，使用一个返回复杂对象的筛选器，并且该对象通过自定义的 `isEqual` 函数
    // 进行缓存。
    const ref = React.createRef();
    /**
     * 返回含server环境和无关字段的服务器快照，覆盖selector从对象提取字段的路径。
     * @returns 服务器快照对象。
     */
    function getServerSnapshot() {
      return {env: 'server', other: 'unrelated'};
    }
    /**
     * 返回含client环境和相同无关字段的客户端快照。
     * @returns 客户端快照对象。
     */
    function getClientSnapshot() {
      return {env: 'client', other: 'unrelated'};
    }
    /**
     * 仅提取env并生成新对象，让isEqual负责识别环境相同的选择结果。
     * @param env 快照环境字段。
     * @returns 仅含env的选择对象。
     */
    function selector({env}) {
      return {env};
    }
    /**
     * 按env比较两个选择结果，忽略对象身份与other字段。
     * @param a 前一选择结果。
     * @param b 当前选择结果。
     * @returns env是否相同。
     */
    function isEqual(a, b) {
      return a.env === b.env;
    }
    /**
     * 空订阅夹具，无主动更新；返回空清理函数，使测试聚焦快照选择。
     * @returns 取消订阅函数。
     */
    function subscribe() {
      return () => {};
    }
    /**
     * 记录并返回env文本，用日志观察selector路径实际选择的环境。
     * @param text 选择后的环境字符串。
     * @returns text。
     */
    function Child({text}) {
      Scheduler.log(text);
      return text;
    }
    /**
     * 调用带selector/isEqual的外部存储Hook，只把选择后的env交给Child；服务器另包Suspense而客户端直接hydrate此树。
     * @returns 环境显示div。
     */
    function App() {
      const {env} = useSyncExternalStoreWithSelector(
        subscribe,
        getClientSnapshot,
        getServerSnapshot,
        selector,
        isEqual,
      );
      return (
        <div ref={ref}>
          <Child text={env} />
        </div>
      );
    }
    const loggedErrors = [];
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <Suspense fallback="Loading...">
          <App />
        </Suspense>,
        {
          /**
           * 收集服务器错误，使server日志的快照选择可与报错路径区分。
           * @param x 服务器错误。
           */
          onError(x) {
            loggedErrors.push(x);
          },
        },
      );
      pipe(writable);
    });
    assertLog(['server']);

    ReactDOMClient.hydrateRoot(container, <App />, {
      /**
       * 记录恢复错误首句，核对客户端结构不匹配后接管。
       * @param error hydration恢复错误。
       */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
      },
    });

    // 不匹配迫使客户端渲染，因此首次绘制使用客户端结果。
    await waitForPaint([
      'client',
      "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
    ]);
    expect(getVisibleChildren(container)).toEqual(<div>client</div>);
  });

  /** 服务器getServerSnapshot正常输出Yay!；hydration时切换isClient使其抛错，但getClientSnapshot仍成功。断言根恢复错误及cause、最终Yay!，并检查span ref不是原服务器节点，验证整个根的客户端重建。 */
  it(
    'errors during hydration in the shell force a client render at the ' +
      'root, and during the client render it recovers',
    async () => {
      let isClient = false;

      /**
       * 空订阅及空清理函数，避免外部事件影响hydration错误恢复。
       * @returns 取消订阅函数。
       */
      function subscribe() {
        return () => {};
      }
      /**
       * 始终返回Yay!，使getServerSnapshot在hydration失败后仍能通过客户端快照重建。
       * @returns 客户端文本快照。
       */
      function getClientSnapshot() {
        return 'Yay!';
      }

      // 编写此测试时，只有 `getServerSnapshot` API 能暴露当前是否正在 hydration，因此这里用它
      // 模拟 hydration 期间的错误。
      /**
       * 服务器阶段返回Yay!；isClient打开后在hydration读取时抛错，客户端重试改用getClientSnapshot因此可恢复。
       * @returns 服务器文本快照。
       * @throws Hydration error。
       */
      function getServerSnapshot() {
        if (isClient) {
          throw new Error('Hydration error');
        }
        return 'Yay!';
      }

      /**
       * 读取外部存储快照并记录/返回值，用于观察根接管后的成功渲染。
       * @returns 当前快照文本。
       */
      function Child() {
        const value = useSyncExternalStore(
          subscribe,
          getClientSnapshot,
          getServerSnapshot,
        );
        Scheduler.log(value);
        return value;
      }

      const spanRef = React.createRef();

      /**
       * 用spanRef标记包含Child的span，比较恢复后是否复用服务器节点。
       * @returns span测试树。
       */
      function App() {
        return (
          <span ref={spanRef}>
            <Child />
          </span>
        );
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });
      assertLog(['Yay!']);

      const span = container.getElementsByTagName('span')[0];

      // Hydrate 组件树。子组件会在 hydration 期间抛错，但回退到客户端渲染时不会。
      isClient = true;
      ReactDOMClient.hydrateRoot(container, <App />, {
        /**
         * 记录根hydration恢复错误及cause首句，确认失败来源与整个根接管。
         * @param error 恢复错误。
         */
        onRecoverableError(error) {
          Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
          if (error.cause) {
            Scheduler.log('Cause: ' + normalizeError(error.cause.message));
          }
        },
      });

      // 错误已记录；React 没有把它暴露给 UI，而是切换到客户端渲染。
      await waitForAll([
        'Yay!',
        'onRecoverableError: There was an error while hydrating but React was able to recover by instead client rendering the entire root.',
        'Cause: Hydration error',
      ]);
      expect(getVisibleChildren(container)).toEqual(<span>Yay!</span>);

      // hydration 期间边界内报错的节点没有被 hydrate。
      expect(spanRef.current).not.toBe(span);
    },
  );

  /** StrictMode服务器快照Nay!、客户端快照Yay!，先流式输出Nay!，再flushSync触发hydrate。断言hydration先读Nay!、后切Yay!，最终DOM为Yay!，覆盖同步入口的快照更新。 */
  it('can hydrate uSES in StrictMode with different client and server snapshot (sync)', async () => {
    /**
     * 空订阅夹具；返回空清理函数，StrictMode重复处理不会引入更新事件。
     * @returns 取消订阅函数。
     */
    function subscribe() {
      return () => {};
    }
    /**
     * 返回Yay!作为同步hydration之后的客户端快照。
     * @returns 客户端快照文本。
     */
    function getClientSnapshot() {
      return 'Yay!';
    }
    /**
     * 返回Nay!作为服务器输出与同步hydration初次读取的快照。
     * @returns 服务器快照文本。
     */
    function getServerSnapshot() {
      return 'Nay!';
    }

    /**
     * 读取并记录外部存储快照，作为StrictMode flushSync hydration的观察组件。
     * @returns 当前快照文本。
     */
    function App() {
      const value = useSyncExternalStore(
        subscribe,
        getClientSnapshot,
        getServerSnapshot,
      );
      Scheduler.log(value);

      return value;
    }

    const element = (
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );

    await act(async () => {
      const {pipe} = renderToPipeableStream(element);
      pipe(writable);
    });

    assertLog(['Nay!']);
    expect(getVisibleChildren(container)).toEqual('Nay!');

    await clientAct(() => {
      ReactDOM.flushSync(() => {
        ReactDOMClient.hydrateRoot(container, element);
      });
    });

    expect(getVisibleChildren(container)).toEqual('Yay!');
    assertLog(['Nay!', 'Yay!']);
  });

  /** StrictMode使用不同的服务器/客户端快照，先输出Nay!，再在startTransition中hydrate。断言日志Nay!→Yay!和最终Yay!，覆盖并发入口的快照恢复。 */
  it('can hydrate uSES in StrictMode with different client and server snapshot (concurrent)', async () => {
    /**
     * 空订阅夹具，返回空清理函数以隔离transition hydration的快照行为。
     * @returns 取消订阅函数。
     */
    function subscribe() {
      return () => {};
    }
    /**
     * 返回Yay!作为并发hydration之后的客户端快照。
     * @returns 客户端快照文本。
     */
    function getClientSnapshot() {
      return 'Yay!';
    }
    /**
     * 返回Nay!作为服务器与并发hydration初次读取的快照。
     * @returns 服务器快照文本。
     */
    function getServerSnapshot() {
      return 'Nay!';
    }

    /**
     * 读取并记录快照，让transition hydration的Nay!→Yay!顺序可被断言。
     * @returns 当前快照文本。
     */
    function App() {
      const value = useSyncExternalStore(
        subscribe,
        getClientSnapshot,
        getServerSnapshot,
      );
      Scheduler.log(value);

      return value;
    }

    const element = (
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );

    await act(async () => {
      const {pipe} = renderToPipeableStream(element);
      pipe(writable);
    });

    assertLog(['Nay!']);
    expect(getVisibleChildren(container)).toEqual('Nay!');

    await clientAct(() => {
      React.startTransition(() => {
        ReactDOMClient.hydrateRoot(container, element);
      });
    });

    expect(getVisibleChildren(container)).toEqual('Yay!');
    assertLog(['Nay!', 'Yay!']);
  });

  /** Suspense内的getServerSnapshot仅在hydration抛错，客户端快照成功。断言最近边界恢复错误与cause，内层span被替换、外侧两个span复用，验证客户端接管仅局限该边界。 */
  it(
    'errors during hydration force a client render at the nearest Suspense ' +
      'boundary, and during the client render it recovers',
    async () => {
      let isClient = false;

      /**
       * 空订阅夹具，返回空清理函数，不制造本例之外的外部更新。
       * @returns 取消订阅函数。
       */
      function subscribe() {
        return () => {};
      }
      /**
       * 固定返回Yay!，保证最近Suspense边界改为客户端渲染后能够恢复。
       * @returns 客户端文本快照。
       */
      function getClientSnapshot() {
        return 'Yay!';
      }

      // 编写此测试时，只有 `getServerSnapshot` API 能暴露当前是否正在 hydration，因此这里用它
      // 模拟 hydration 期间的错误。
      /**
       * 服务器返回Yay!，hydration时因isClient抛Hydration error；该错误局限于包裹Child的Suspense。
       * @returns 服务器快照文本。
       * @throws Hydration error。
       */
      function getServerSnapshot() {
        if (isClient) {
          throw new Error('Hydration error');
        }
        return 'Yay!';
      }

      /**
       * 读取外部存储并记录/输出快照，触发边界内的hydration错误或成功客户端重试。
       * @returns 当前文本快照。
       */
      function Child() {
        const value = useSyncExternalStore(
          subscribe,
          getClientSnapshot,
          getServerSnapshot,
        );
        Scheduler.log(value);
        return value;
      }

      const span1Ref = React.createRef();
      const span2Ref = React.createRef();
      const span3Ref = React.createRef();

      /**
       * 用三个span ref包围仅包含Child的Suspense，以比较边界内节点替换与外侧节点复用。
       * @returns 局部恢复测试树。
       */
      function App() {
        return (
          <div>
            <span ref={span1Ref} />
            <Suspense fallback="Loading...">
              <span ref={span2Ref}>
                <Child />
              </span>
            </Suspense>
            <span ref={span3Ref} />
          </div>
        );
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });
      assertLog(['Yay!']);

      const [span1, span2, span3] = container.getElementsByTagName('span');

      // Hydrate 组件树。子组件会在 hydration 期间抛错，但回退到客户端渲染时不会。
      isClient = true;
      ReactDOMClient.hydrateRoot(container, <App />, {
        /**
         * 记录最近Suspense边界的恢复错误及cause，供局部客户端接管断言。
         * @param error 恢复错误。
         */
        onRecoverableError(error) {
          Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
          if (error.cause) {
            Scheduler.log('Cause: ' + normalizeError(error.cause.message));
          }
        },
      });

      // 错误已记录；React 没有把它暴露给 UI，而是切换到客户端渲染。
      await waitForAll([
        'Yay!',
        'onRecoverableError: There was an error while hydrating but React was able to recover by instead client rendering from the nearest Suspense boundary.',
        'Cause: Hydration error',
      ]);
      expect(getVisibleChildren(container)).toEqual(
        <div>
          <span />
          <span>Yay!</span>
          <span />
        </div>,
      );

      // hydration 期间边界内报错的节点没有被 hydrate。
      expect(span2Ref.current).not.toBe(span2);

      // 但边界外的节点已被 hydrate。
      expect(span1Ref.current).toBe(span1);
      expect(span3Ref.current).toBe(span3);
    },
  );

  /** 服务器Child正常，客户端hydration与随后的客户端重试均抛Oops!；外层ErrorBoundary改显错误文本。断言最终Oops!且onRecoverableError为空，覆盖重试仍失败而由错误边界接管的路径。 */
  it(
    'errors during hydration force a client render at the nearest Suspense ' +
      'boundary, and during the client render it fails again',
    async () => {
      // 与前一个测试类似，但客户端渲染也会报错；错误边界应能捕获该错误。

      let isClient = false;

      /** 客户端连续两次失败的错误边界夹具；把错误存入state并显示message，覆盖没有成功恢复的路径。 */
      class ErrorBoundary extends React.Component {
        /** 初始error为null，因此先渲染children；捕获后由派生state保存错误。 */
        state = {error: null};
        /**
         * 把捕获错误存为state.error，供render显示。
         * @param error 捕获的客户端错误。
         * @returns error状态片段。
         */
        static getDerivedStateFromError(error) {
          return {error};
        }
        /**
         * error不为null时显示message，否则透传children；本例最终显示Oops!。
         * @returns 错误文本或children。
         */
        render() {
          if (this.state.error !== null) {
            return this.state.error.message;
          }
          return this.props.children;
        }
      }

      /**
       * 服务器记录/输出Yay!，isClient打开后每次渲染均抛Oops!，使hydration与客户端重试都失败。
       * @returns 服务器文本Yay!。
       * @throws Oops!。
       */
      function Child() {
        if (isClient) {
          throw new Error('Oops!');
        }
        Scheduler.log('Yay!');
        return 'Yay!';
      }

      const span1Ref = React.createRef();
      const span2Ref = React.createRef();
      const span3Ref = React.createRef();

      /**
       * 用ErrorBoundary包裹三段span与中间Suspense，错误最终替换整段子树为边界消息。
       * @returns 失败重试测试树。
       */
      function App() {
        return (
          <ErrorBoundary>
            <span ref={span1Ref} />
            <Suspense fallback="Loading...">
              <span ref={span2Ref}>
                <Child />
              </span>
            </Suspense>
            <span ref={span3Ref} />
          </ErrorBoundary>
        );
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });
      assertLog(['Yay!']);

      // Hydrate 组件树；子组件会在渲染时抛错。
      isClient = true;
      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App />, {
        /**
         * 收集可恢复错误消息；本例重试仍失败，断言此数组为空。
         * @param error 可恢复错误。
         */
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });

      // 因为我们没有从错误中恢复过来, onRecoverableError 不应被调用。
      await waitForAll([]);
      expect(getVisibleChildren(container)).toEqual('Oops!');

      expectErrors(errors, [], []);
    },
  );

  // 因 WWW 的延迟变更回归而禁用；若能查明原因，可能需要重新启用。

  /** FIXME开关禁用的回归定义：服务器Child抛Oops.，客户端先在Yay!暂停；预期保留同一p fallback且暂不报恢复错误，完成文本后新建主内容并报告接管。这里记录预期断言，不称当前配置已执行。 */
  // @gate FIXME
  it('does not recreate the fallback if server errors and hydration suspends', async () => {
    let isClient = false;

    /**
     * 禁用回归夹具：服务器抛Oops.，客户端读取Yay!并在未完成时暂停，完成后记录/输出Yay!。
     * @returns 完成后的文本。
     * @throws 服务器错误或暂停thenable。
     */
    function Child() {
      if (isClient) {
        readText('Yay!');
      } else {
        throw Error('Oops.');
      }
      Scheduler.log('Yay!');
      return 'Yay!';
    }

    const fallbackRef = React.createRef();
    /**
     * 禁用回归夹具：以带ref的p作为Suspense fallback，供比较服务器与客户端占位节点身份。
     * @returns fallback复用测试树。
     */
    function App() {
      return (
        <div>
          <Suspense fallback={<p ref={fallbackRef}>Loading...</p>}>
            <span>
              <Child />
            </span>
          </Suspense>
        </div>
      );
    }
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />, {
        /**
         * 记录服务器Oops.错误，以日志确认边界需要客户端接管。
         * @param error 服务器错误。
         */
        onError(error) {
          Scheduler.log('[s!] ' + error.message);
        },
      });
      pipe(writable);
    });
    assertLog(['[s!] Oops.']);

    // 服务器无法完成此边界。 我们将在客户端重试。
    const serverFallback = container.getElementsByTagName('p')[0];
    expect(serverFallback.innerHTML).toBe('Loading...');

    // Hydrate 组件树；此操作会 suspend。
    isClient = true;
    ReactDOMClient.hydrateRoot(container, <App />, {
      /**
       * 记录接管错误及cause；禁用回归的预期是暂停时不调用，完成后才记录。
       * @param error 恢复错误。
       */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + error.message);
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    // 此时不应报告任何错误。
    await waitForAll([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>Loading...</p>
      </div>,
    );

    // 通常，服务器报错后的 hydration 会强制执行一次全新的客户端渲染。但本次渲染又 suspend，
    // 最多仍只能得到相同 fallback；重建相同 fallback DOM 只会增加工作量并重启动画，因此验证这里不会重建。
    const clientFallback = container.getElementsByTagName('p')[0];
    expect(serverFallback).toBe(clientFallback);

    // 能够完整 hydrate 后，应得到一次全新的客户端渲染。
    await act(() => {
      resolveText('Yay!');
    });
    await waitForAll([
      'Yay!',
      'onRecoverableError: The server could not finish this Suspense boundary, ' +
        'likely due to an error during server rendering. ' +
        'Switched to client rendering.',
    ]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Yay!</span>
      </div>,
    );
  });

  // 因 WWW 的延迟变更回归而禁用；若能查明原因，可能需要重新启用。

  /** FIXME开关禁用的回归定义：服务器报错、客户端暂停时保留p fallback，再以transition将red更新为blue，预期fallback节点仍相同；完成后先恢复red再显示blue并报告错误。描述为禁用用例的预期。 */
  // @gate FIXME
  it(
    'does not recreate the fallback if server errors and hydration suspends ' +
      'and root receives a transition',
    async () => {
      let isClient = false;

      /**
       * 禁用回归夹具：服务器抛错；客户端等待Yay!后输出带color的文本，让red/blue transition顺序可见。
       * @param color 输出颜色标签。
       * @returns 含颜色的Yay!文本。
       * @throws 服务器错误或暂停thenable。
       */
      function Child({color}) {
        if (isClient) {
          readText('Yay!');
        } else {
          throw Error('Oops.');
        }
        Scheduler.log('Yay! (' + color + ')');
        return 'Yay! (' + color + ')';
      }

      const fallbackRef = React.createRef();
      /**
       * 禁用回归夹具：p fallback保持固定，color只传给Child，观察transition是否保留占位节点。
       * @param color 主内容颜色输入。
       * @returns fallback复用测试树。
       */
      function App({color}) {
        return (
          <div>
            <Suspense fallback={<p ref={fallbackRef}>Loading...</p>}>
              <span>
                <Child color={color} />
              </span>
            </Suspense>
          </div>
        );
      }
      await act(() => {
        const {pipe} = renderToPipeableStream(<App color="red" />, {
          /**
           * 记录服务器错误，确认初始主内容未完成。
           * @param error 服务器错误。
           */
          onError(error) {
            Scheduler.log('[s!] ' + error.message);
          },
        });
        pipe(writable);
      });
      assertLog(['[s!] Oops.']);

      // 服务器无法完成此边界。 我们将在客户端重试。
      const serverFallback = container.getElementsByTagName('p')[0];
      expect(serverFallback.innerHTML).toBe('Loading...');

    // Hydrate 组件树；此操作会 suspend。
      isClient = true;
      const root = ReactDOMClient.hydrateRoot(container, <App color="red" />, {
        /**
         * 记录客户端接管错误及cause，预期文本完成前暂不报告。
         * @param error 恢复错误。
         */
        onRecoverableError(error) {
          Scheduler.log('onRecoverableError: ' + error.message);
          if (error.cause) {
            Scheduler.log('Cause: ' + normalizeError(error.cause.message));
          }
        },
      });
    // 此时不应报告任何错误。
      await waitForAll([]);
      expect(getVisibleChildren(container)).toEqual(
        <div>
          <p>Loading...</p>
        </div>,
      );

    // 通常，服务器报错后的 hydration 会强制执行一次全新的客户端渲染。但本次渲染又 suspend，
    // 最多仍只能得到相同 fallback；重建相同 fallback DOM 只会增加工作量并重启动画，因此验证这里不会重建。
      const clientFallback = container.getElementsByTagName('p')[0];
      expect(serverFallback).toBe(clientFallback);

      // transition 更新也不应重建 fallback。
      React.startTransition(() => {
        root.render(<App color="blue" />);
      });
      await waitForAll([]);
      jest.runAllTimers();
      const clientFallback2 = container.getElementsByTagName('p')[0];
      expect(clientFallback2).toBe(serverFallback);

    // 能够完整 hydrate 后，应得到一次全新的客户端渲染。
      await act(() => {
        resolveText('Yay!');
      });
      await waitForAll([
        'Yay! (red)',
        'onRecoverableError: The server could not finish this Suspense boundary, ' +
          'likely due to an error during server rendering. ' +
          'Switched to client rendering.',
        'Yay! (blue)',
      ]);
      expect(getVisibleChildren(container)).toEqual(
        <div>
          <span>Yay! (blue)</span>
        </div>,
      );
    },
  );

  // 因 WWW 的延迟变更回归而禁用；若能查明原因，可能需要重新启用。

  /** FIXME开关禁用的回归定义：服务器报错且hydration暂停时先复用fallback；普通root.render改fallbackText为More loading...，预期替换p节点并报告接管，完成Yay!后显示主内容。描述为禁用用例的预期。 */
  // @gate FIXME
  it(
    'recreates the fallback if server errors and hydration suspends but ' +
      'client receives new props',
    async () => {
      let isClient = false;

      /**
       * 禁用回归夹具：服务器抛Oops.，客户端在固定Yay!缓存键暂停，完成后记录并返回文本。
       * @returns Yay!。
       * @throws 服务器错误或暂停thenable。
       */
      function Child() {
        const value = 'Yay!';
        if (isClient) {
          readText(value);
        } else {
          throw Error('Oops.');
        }
        Scheduler.log(value);
        return value;
      }

      const fallbackRef = React.createRef();
      /**
       * 禁用回归夹具：fallbackText直接控制p占位文本，供普通更新改变fallback并重建节点。
       * @param fallbackText 占位文本。
       * @returns fallback props变化测试树。
       */
      function App({fallbackText}) {
        return (
          <div>
            <Suspense fallback={<p ref={fallbackRef}>{fallbackText}</p>}>
              <span>
                <Child />
              </span>
            </Suspense>
          </div>
        );
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(
          <App fallbackText="Loading..." />,
          {
            /**
             * 记录服务器错误，作为客户端接管的初始条件。
             * @param error 服务器错误。
             */
            onError(error) {
              Scheduler.log('[s!] ' + error.message);
            },
          },
        );
        pipe(writable);
      });
      assertLog(['[s!] Oops.']);

      const serverFallback = container.getElementsByTagName('p')[0];
      expect(serverFallback.innerHTML).toBe('Loading...');

    // Hydrate 组件树；此操作会 suspend。
      isClient = true;
      const root = ReactDOMClient.hydrateRoot(
        container,
        <App fallbackText="Loading..." />,
        {
          /**
           * 记录接管错误及cause，预期改变fallback props的普通更新触发报告。
           * @param error 恢复错误。
           */
          onRecoverableError(error) {
            Scheduler.log('onRecoverableError: ' + error.message);
            if (error.cause) {
              Scheduler.log('Cause: ' + normalizeError(error.cause.message));
            }
          },
        },
      );
    // 此时不应报告任何错误。
      await waitForAll([]);
      expect(getVisibleChildren(container)).toEqual(
        <div>
          <p>Loading...</p>
        </div>,
      );

      // 通常，服务器报错后的 hydration 会强制执行一次全新的客户端渲染。但该渲染又 suspend，
      // 最多仍只能得到 fallback；用相同 fallback 替换现有 fallback 只会增加工作量并重启动画，因此验证这里不会替换。
      const clientFallback1 = container.getElementsByTagName('p')[0];
      expect(serverFallback).toBe(clientFallback1);

      // 但更新可能改变 fallback props；此时必须强制在客户端重新渲染，并丢弃服务器版本。
      root.render(<App fallbackText="More loading..." />);
      await waitForAll([]);
      jest.runAllTimers();
      assertLog([
        'onRecoverableError: The server could not finish this Suspense boundary, ' +
          'likely due to an error during server rendering. ' +
          'Switched to client rendering.',
      ]);
      expect(getVisibleChildren(container)).toEqual(
        <div>
          <p>More loading...</p>
        </div>,
      );
      // 这应是一次不复用 DOM 的全新渲染。
      const clientFallback2 = container.getElementsByTagName('p')[0];
      expect(clientFallback2).not.toBe(clientFallback1);

      // 验证随后仍能全新渲染内容。
      await act(() => {
        resolveText('Yay!');
      });
      await waitForAll(['Yay!']);
      expect(getVisibleChildren(container)).toEqual(
        <div>
          <span>Yay!</span>
        </div>,
      );
    },
  );

  /** 边界内服务器快照在hydration抛错，客户端快照虽成功但Child又读取未完成的Yay!。先断言恢复错误与Loading，再完成文本显示Yay!；内层span重建、外侧span复用，验证接管后再次暂停。 */
  it(
    'errors during hydration force a client render at the nearest Suspense ' +
      'boundary, and during the client render it recovers, then a deeper ' +
      'child suspends',
    async () => {
      let isClient = false;

      /**
       * 空订阅夹具，返回空清理函数，避免外部更新混入再次暂停的路径。
       * @returns 取消订阅函数。
       */
      function subscribe() {
        return () => {};
      }
      /**
       * 返回Yay!；客户端接管成功读取快照后，Child还会以该值读取文本缓存并暂停。
       * @returns 客户端快照文本。
       */
      function getClientSnapshot() {
        return 'Yay!';
      }

      // 编写此测试时，只有 `getServerSnapshot` API 能暴露当前是否正在 hydration，因此这里用它
      // 模拟 hydration 期间的错误。
      /**
       * 服务器返回Yay!，hydration时因isClient抛Hydration error，触发最近Suspense边界接管。
       * @returns 服务器快照文本。
       * @throws Hydration error。
       */
      function getServerSnapshot() {
        if (isClient) {
          throw new Error('Hydration error');
        }
        return 'Yay!';
      }

      /**
       * 读取外部存储；客户端阶段额外读取同值文本缓存，完成后才记录/输出快照。
       * @returns 已完成的快照文本。
       * @throws 缓存未完成时的thenable。
       */
      function Child() {
        const value = useSyncExternalStore(
          subscribe,
          getClientSnapshot,
          getServerSnapshot,
        );
        if (isClient) {
          readText(value);
        }
        Scheduler.log(value);
        return value;
      }

      const span1Ref = React.createRef();
      const span2Ref = React.createRef();
      const span3Ref = React.createRef();

      /**
       * 用三个span ref围住中间Suspense，比较再次暂停后内层重建与外层复用。
       * @returns 接管后暂停测试树。
       */
      function App() {
        return (
          <div>
            <span ref={span1Ref} />
            <Suspense fallback="Loading...">
              <span ref={span2Ref}>
                <Child />
              </span>
            </Suspense>
            <span ref={span3Ref} />
          </div>
        );
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });
      assertLog(['Yay!']);

      const [span1, span2, span3] = container.getElementsByTagName('span');

      // Hydrate 组件树。子组件会在 hydration 期间抛错，但回退到客户端渲染时不会。
      isClient = true;
      ReactDOMClient.hydrateRoot(container, <App />, {
        /**
         * 记录局部hydration恢复错误及cause；文本缓存完成前就应报告接管原因。
         * @param error 恢复错误。
         */
        onRecoverableError(error) {
          Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
          if (error.cause) {
            Scheduler.log('Cause: ' + normalizeError(error.cause.message));
          }
        },
      });

      // 错误已记录；React 没有把它暴露给 UI，而是切换到客户端渲染。
      await waitForAll([
        'onRecoverableError: There was an error while hydrating but React was able to recover by instead client rendering from the nearest Suspense boundary.',
        'Cause: Hydration error',
      ]);
      expect(getVisibleChildren(container)).toEqual(
        <div>
          <span />
          Loading...
          <span />
        </div>,
      );

      await clientAct(() => {
        resolveText('Yay!');
      });
      assertLog(['Yay!']);
      expect(getVisibleChildren(container)).toEqual(
        <div>
          <span />
          <span>Yay!</span>
          <span />
        </div>,
      );

      // hydration 期间边界内报错的节点没有被 hydrate。
      expect(span2Ref.current).not.toBe(span2);

      // 但边界外的节点已被 hydrate。
      expect(span1Ref.current).toBe(span1);
      expect(span3Ref.current).toBe(span3);
    },
  );

  /** 仅在客户端createRoot并发渲染：A先抛Oops!，等待该日志后关闭shouldThrow；同步重试得到AB，同时onRecoverableError记录并发恢复及cause。验证成功恢复的普通渲染错误仍被报告。 */
  it('logs regular (non-hydration) errors when the UI recovers', async () => {
    let shouldThrow = true;

    /**
     * shouldThrow为真时记录并抛Oops!，关闭后记录/返回A；unused入参未读取，保留原测试签名。
     * @param unused 本例未使用的prop。
     * @returns A文本。
     * @throws Oops!。
     */
    function A({unused}) {
      if (shouldThrow) {
        Scheduler.log('Oops!');
        throw new Error('Oops!');
      }
      Scheduler.log('A');
      return 'A';
    }

    /**
     * 记录并返回B，观察同步重试时是否完成后续兄弟。
     * @returns B文本。
     */
    function B() {
      Scheduler.log('B');
      return 'B';
    }

    /**
     * 输出兄弟A/B，用于并发失败后同步重试的完整根。
     * @returns Fragment。
     */
    function App() {
      return (
        <>
          <A />
          <B />
        </>
      );
    }

    const root = ReactDOMClient.createRoot(container, {
      /**
       * 记录普通并发渲染恢复错误及cause，验证成功重试仍报告原错误。
       * @param error 可恢复渲染错误。
       */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    React.startTransition(() => {
      root.render(<App />);
    });

    // 部分渲染 A，但在渲染尚未完成之前返回。
    await waitFor(['Oops!']);

    // React 会再次同步渲染；重试时 A 不再抛错。这模拟了通过阻塞主线程修复的并发数据竞争。
    shouldThrow = false;
    await waitForAll([
      // 重新渲染，同步地
      'A',
      'B',

      // 记录错误
      'onRecoverableError: There was an error during concurrent rendering but React was able to recover by instead synchronously rendering the entire root.',
      'Cause: Oops!',
    ]);

    // UI 显示正常。
    expect(container.textContent).toEqual('AB');
  });

  /** 服务器两个Suspense分别输出A/B，hydration时两处getServerSnapshot均抛Hydration error。客户端重试成功，日志按A、B后各记录一次局部恢复错误与cause，验证同轮多个边界错误均被报告。 */
  it('logs multiple hydration errors in the same render', async () => {
    let isClient = false;

    /**
     * 空订阅及空清理函数，使两个边界的hydration错误由快照读取触发。
     * @returns 取消订阅函数。
     */
    function subscribe() {
      return () => {};
    }
    /**
     * 固定返回Yay!，保证两个边界改为客户端渲染后均可成功。
     * @returns 客户端快照。
     */
    function getClientSnapshot() {
      return 'Yay!';
    }
    /**
     * 服务器返回Yay!，hydration时isClient为真则抛Hydration error，分别触发两个边界恢复。
     * @returns 服务器快照。
     * @throws Hydration error。
     */
    function getServerSnapshot() {
      if (isClient) {
        throw new Error('Hydration error');
      }
      return 'Yay!';
    }

    /**
     * 先读取外部存储快照以制造hydration错误，成功后记录并输出label；输出与快照值有意独立。
     * @param label 区分A/B边界的标签。
     * @returns label。
     */
    function Child({label}) {
      // 这里会在客户端 hydration 期间抛错。本测试使用 useSyncExternalStore，只因为
      // getServerSnapshot 能观察当前是否正在 hydration。
      useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
      Scheduler.log(label);
      return label;
    }

    /**
     * 输出分别包裹A/B的两个Suspense，便于同轮收集两个独立恢复错误。
     * @returns 双边界Fragment。
     */
    function App() {
      return (
        <>
          <Suspense fallback="Loading...">
            <Child label="A" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child label="B" />
          </Suspense>
        </>
      );
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });
    assertLog(['A', 'B']);

      // Hydrate 组件树。子组件会在 hydration 期间抛错，但回退到客户端渲染时不会。
    isClient = true;
    ReactDOMClient.hydrateRoot(container, <App />, {
      /**
       * 记录每个边界的恢复错误与cause首句，断言同轮两个错误均被报告。
       * @param error 恢复错误。
       */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });

    await waitForAll([
      'A',
      'B',

      'onRecoverableError: There was an error while hydrating but React was able to recover by instead client rendering from the nearest Suspense boundary.',
      'Cause: Hydration error',

      'onRecoverableError: There was an error while hydrating but React was able to recover by instead client rendering from the nearest Suspense boundary.',
      'Cause: Hydration error',
    ]);
  });

  /** 用Immutable集合从两条记录map出带key的li，将可迭代对象作为ul children流式渲染；断言a/b列表，验证同步iterable展开。 */
  it('supports iterable', async () => {
    const Immutable = require('immutable');

    const mappedJSX = Immutable.fromJS([
      {name: 'a', value: 'a'},
      {name: 'b', value: 'b'},
    ]).map(item => <li key={item.get('value')}>{item.get('name')}</li>);

    await act(() => {
      const {pipe} = renderToPipeableStream(<ul>{mappedJSX}</ul>);
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(
      <ul>
        <li>a</li>
        <li>b</li>
      </ul>,
    );
  });

  /** enableAsyncIterableChildren开启时，异步生成器组件先后yield Hi span、空格、World span；多轮act处理后续ping，断言完整div，验证生成器组件的异步children收集。 */
  // @gate enableAsyncIterableChildren
  it('supports async generator component', async () => {
    /**
     * 异步生成器组件依次产出等待promise后的Hi、空格与World；key区分两个span，消费者需等待多个ping推进迭代。
     * @returns 异步生成器。
     */
    async function* App() {
      yield <span key="1">{await Promise.resolve('Hi')}</span>;
      yield ' ';
      yield <span key="2">{await Promise.resolve('World')}</span>;
    }

    await act(async () => {
      const {pipe} = renderToPipeableStream(
        <div>
          <App />
        </div>,
      );
      pipe(writable);
    });

    // 每轮 act 会重试一次；本轮渲染产生的 ping 又调度下一轮工作，因此这里连续运行多轮 act。
    await act(() => {});
    await act(() => {});
    await act(() => {});
    await act(() => {});

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Hi</span> <span>World</span>
      </div>,
    );
  });

  /** enableAsyncIterableChildren开启时，对象的Symbol.asyncIterator依次产生两个异步span与空格，App透传为children；多轮act后断言Hi World，验证异步可迭代children。 */
  // @gate enableAsyncIterableChildren
  it('supports async iterable children', async () => {
    const iterable = {
      /**
       * 实现对象的异步迭代协议，依次yield带key的Hi/World span及空格；await为服务器创建后续恢复任务。
       * @returns 异步迭代器。
       */
      async *[Symbol.asyncIterator]() {
        yield <span key="1">{await Promise.resolve('Hi')}</span>;
        yield ' ';
        yield <span key="2">{await Promise.resolve('World')}</span>;
      },
    };

    /**
     * 将传入的异步iterable直接作为div children，测试由服务器遍历并收集其结果。
     * @param children 异步可迭代对象。
     * @returns div。
     */
    function App({children}) {
      return <div>{children}</div>;
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<App>{iterable}</App>);
      pipe(writable);
    });

    // 每轮 act 会重试一次；本轮渲染产生的 ping 又调度下一轮工作，因此这里连续运行多轮 act。
    await act(() => {});
    await act(() => {});
    await act(() => {});
    await act(() => {});

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Hi</span> <span>World</span>
      </div>,
    );
  });

  /** 通过公开renderToPipeableStream直接渲染10n，断言div文本10，验证bigint作为子节点的字符串输出。 */
  it('supports bigint', async () => {
    await act(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <div>{10n}</div>,
      );
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(<div>10</div>);
  });

  /** 两个边界分别暂停hello/world，先显示p/span fallback；以字符串foobar abort，onError按每个任务收到该字符串并返回a digest。hydration核对两项接管错误、digest与DEV栈，本例不完成主内容。 */
  it('Supports custom abort reasons with a string', async () => {
    /**
     * 以p/span中的两个Suspense暂停hello/world，分别使用简短fallback，观察字符串中止对每个任务的报告。
     * @returns 双边界树。
     */
    function App() {
      return (
        <div>
          <p>
            <Suspense fallback={'p'}>
              <AsyncText text={'hello'} />
            </Suspense>
          </p>
          <span>
            <Suspense fallback={'span'}>
              <AsyncText text={'world'} />
            </Suspense>
          </span>
        </div>
      );
    }

    let abort;
    const loggedErrors = [];
    await act(() => {
      const {pipe, abort: abortImpl} = renderToPipeableStream(<App />, {
        /**
         * 直接保存abort传入的字符串而非读取message，并返回固定digest；两个暂停任务分别调用。
         * @param error 本例为字符串的中止原因。
         * @returns a digest。
         */
        onError(error) {
          // 在这些测试中，我们故意以字符串形式引发错误，因此我们将其推入错误中；而在大多数其他测试中，我
          // 们故意以错误形式引发错误，并将其消息推入错误中。
          loggedErrors.push(error);
          return 'a digest';
        },
      });
      abort = abortImpl;
      pipe(writable);
    });

    expect(loggedErrors).toEqual([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>p</p>
        <span>span</span>
      </div>,
    );

    await act(() => {
      abort('foobar');
    });

    expect(loggedErrors).toEqual(['foobar', 'foobar']);

    const errors = [];
    ReactDOMClient.hydrateRoot(container, <App />, {
      /**
       * 保存中止后每个边界的恢复错误及附加信息，核对digest与DEV栈。
       * @param error 恢复错误。
       * @param errorInfo 恢复附加信息。
       */
      onRecoverableError(error, errorInfo) {
        errors.push({error, errorInfo});
      },
    });

    await waitForAll([]);

    expectErrors(
      errors,
      [
        [
          'Switched to client rendering because the server rendering aborted due to:\n\n' +
            'foobar',
          'a digest',
          componentStack(['AsyncText', 'Suspense', 'p', 'div', 'App']),
        ],
        [
          'Switched to client rendering because the server rendering aborted due to:\n\n' +
            'foobar',
          'a digest',
          componentStack(['AsyncText', 'Suspense', 'span', 'div', 'App']),
        ],
      ],
      [
        [
          'The server could not finish this Suspense boundary, likely due to an error during server rendering. Switched to client rendering.',
          'a digest',
        ],
        [
          'The server could not finish this Suspense boundary, likely due to an error during server rendering. Switched to client rendering.',
          'a digest',
        ],
      ],
    );
  });

  /** 两个边界暂停hello/world后以Error(uh oh) abort；onError两次记录message并返回digest。hydration核对每个边界的接管错误与DEV组件栈，覆盖Error类型的自定义中止原因。 */
  it('Supports custom abort reasons with an Error', async () => {
    /**
     * 在p/span中分别暂停hello/world，供Error类型abort逐任务收尾。
     * @returns 双边界树。
     */
    function App() {
      return (
        <div>
          <p>
            <Suspense fallback={'p'}>
              <AsyncText text={'hello'} />
            </Suspense>
          </p>
          <span>
            <Suspense fallback={'span'}>
              <AsyncText text={'world'} />
            </Suspense>
          </span>
        </div>
      );
    }

    let abort;
    const loggedErrors = [];
    await act(() => {
      const {pipe, abort: abortImpl} = renderToPipeableStream(<App />, {
        /**
         * 保存中止Error的message并返回固定digest，区分于字符串原因测试。
         * @param error 中止Error。
         * @returns a digest。
         */
        onError(error) {
          loggedErrors.push(error.message);
          return 'a digest';
        },
      });
      abort = abortImpl;
      pipe(writable);
    });

    expect(loggedErrors).toEqual([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>p</p>
        <span>span</span>
      </div>,
    );

    await act(() => {
      abort(new Error('uh oh'));
    });

    expect(loggedErrors).toEqual(['uh oh', 'uh oh']);

    const errors = [];
    ReactDOMClient.hydrateRoot(container, <App />, {
      /**
       * 保存两个边界客户端接管的恢复信息，断言Error中止原因与digest。
       * @param error 恢复错误。
       * @param errorInfo 附加信息。
       */
      onRecoverableError(error, errorInfo) {
        errors.push({error, errorInfo});
      },
    });

    await waitForAll([]);

    expectErrors(
      errors,
      [
        [
          'Switched to client rendering because the server rendering aborted due to:\n\n' +
            'uh oh',
          'a digest',
          componentStack(['AsyncText', 'Suspense', 'p', 'div', 'App']),
        ],
        [
          'Switched to client rendering because the server rendering aborted due to:\n\n' +
            'uh oh',
          'a digest',
          componentStack(['AsyncText', 'Suspense', 'span', 'div', 'App']),
        ],
      ],
      [
        [
          'The server could not finish this Suspense boundary, likely due to an error during server rendering. Switched to client rendering.',
          'a digest',
        ],
        [
          'The server could not finish this Suspense boundary, likely due to an error during server rendering. Switched to client rendering.',
          'a digest',
        ],
      ],
    );
  });

  /** 一个有边界任务及两个根任务共用永不完成的promise，根shell不能就绪。以abort reason中止后断言三个任务均已尝试且onError收到三次原因，验证fatal shell中止仍逐任务报告。 */
  it('reports abort errors for every suspended task when aborting fatals the shell', async () => {
    const promise = new Promise(() => {});
    const rendered = [];
    /**
     * 先记录label再use同一个永不完成promise，使边界与根任务都停在可中止状态。
     * @param label 区分三项暂停任务的标签。
     * @returns 正常完成时null，本例不会完成。
     * @throws 未完成promise的暂停信号。
     */
    function Suspend({label}) {
      rendered.push(label);
      use(promise);
      return null;
    }

    /**
     * 组合一个Suspense内任务和两个根级暂停任务，令shell无法完成并检查逐任务中止报告。
     * @returns 三任务Fragment。
     */
    function App() {
      return (
        <>
          <Suspense fallback="Loading...">
            <Suspend label="boundary" />
          </Suspense>
          <Suspend label="root one" />
          <Suspend label="root two" />
        </>
      );
    }

    const errors = [];
    let abort;
    await act(() => {
      abort = renderToPipeableStream(<App />, {
        /**
         * 记录每个暂停任务的abort消息，预期三项均为abort reason。
         * @param error 中止错误。
         */
        onError(error) {
          errors.push(error.message);
        },
        /** 空shell错误回调，消费根暂停任务被中止后的fatal通知；次数未单独断言。 */
        onShellError() {},
      }).abort;
    });

    expect(rendered).toEqual(['boundary', 'root one', 'root two']);

    await act(() => {
      abort(new Error('abort reason'));
    });

    expect(errors).toEqual(['abort reason', 'abort reason', 'abort reason']);
  });

  /** lazy边界与永不完成的use(promise)边界先输出fallback，同一act内先abort再拒绝lazy promise；断言lazy采用rejected during abort、另一任务采用abort reason，验证中止收尾前的拒绝优先级。 */
  it('uses a rejection reason from a lazy component before the abort finishes', async () => {
    let reject;
    const Lazy = React.lazy(
      () =>
        new Promise((resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    );
    const haltedPromise = new Promise(() => {});
    /**
     * use永不完成的haltedPromise，作为lazy拒绝之外仍需使用abort reason的任务。
     * @returns 正常完成时null。
     * @throws 暂停信号。
     */
    function HaltedWait() {
      use(haltedPromise);
      return null;
    }

    const errors = [];
    let abort;
    await act(() => {
      const controls = renderToPipeableStream(
        <>
          <Suspense fallback="Loading lazy">
            <Lazy />
          </Suspense>
          <Suspense fallback="Loading halted">
            <HaltedWait />
          </Suspense>
        </>,
        {
          /**
           * 按任务收集错误message，核对lazy拒绝先于另一任务的abort原因。
           * @param error 任务最终错误。
           */
          onError(error) {
            errors.push(error.message);
          },
        },
      );
      abort = controls.abort;
      controls.pipe(writable);
    });

    await act(() => {
      abort(new Error('abort reason'));
      reject(new Error('rejected during abort'));
    });

    expect(errors).toEqual(['rejected during abort', 'abort reason']);
  });

  /** use(promise)边界先暂停，完成一次abort act后再拒绝promise；断言仅abort reason被报告，验证已结束中止不再接收迟到拒绝。 */
  it('does not report a rejection reason after abort has finished', async () => {
    let reject;
    const promise = new Promise((resolve, rejectPromise) => {
      reject = rejectPromise;
    });
    /**
     * use可外部拒绝的promise，使测试能够比较abort结束后的迟到拒绝。
     * @returns 正常完成时null。
     * @throws 暂停或拒绝错误。
     */
    function Wait() {
      use(promise);
      return null;
    }

    const errors = [];
    let abort;
    await act(() => {
      const controls = renderToPipeableStream(
        <Suspense fallback="Loading">
          <Wait />
        </Suspense>,
        {
          /**
           * 收集任务错误message；abort结束后不应再收到迟到的promise拒绝。
           * @param error 任务错误。
           */
          onError(error) {
            errors.push(error.message);
          },
        },
      );
      abort = controls.abort;
      controls.pipe(writable);
    });

    await act(() => {
      abort(new Error('abort reason'));
    });

    await act(() => {
      reject(new Error('rejected after abort'));
    });

    expect(errors).toEqual(['abort reason']);
  });

  /** 服务器hello被拒绝并由onError返回a digest，客户端以同步hello接管；恢复回调断言error.digest保留值、errorInfo.digest为undefined，并核对DEV读取旧字段的警告。 */
  it('warns in dev if you access digest from errorInfo in onRecoverableError', async () => {
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <div>
          <Suspense fallback={'loading...'}>
            <AsyncText text={'hello'} />
          </Suspense>
        </div>,
        {
          /**
           * 为服务器失败返回固定a digest；error入参本例不读取。
           * @param error 服务器渲染错误。
           * @returns a digest。
           */
          onError(error) {
            return 'a digest';
          },
        },
      );
      rejectText('hello');
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(<div>loading...</div>);

    ReactDOMClient.hydrateRoot(
      container,
      <div>
        <Suspense fallback={'loading...'}>hello</Suspense>
      </div>,
      {
        /**
         * 在恢复回调中检查digest迁移到Error实例，并故意读取errorInfo.digest触发DEV废弃字段警告。
         * @param error 带digest的恢复错误。
         * @param errorInfo 已无digest值的附加信息。
         */
        onRecoverableError(error, errorInfo) {
          expect(error.digest).toBe('a digest');
          expect(errorInfo.digest).toBe(undefined);
          assertConsoleErrorDev([
            'You are accessing "digest" from the errorInfo object passed to onRecoverableError.' +
              ' This property is no longer provided as part of errorInfo but can be accessed as a property' +
              ' of the Error instance itself.',
          ]);
        },
      },
    );
    await waitForAll([]);
  });

  /** 完整html中渲染async foo脚本并传importMap选项；断言head原始HTML先含importmap脚本再含foo，并按开关允许外部运行时及blocking标记，验证import map序列化位置。 */
  it('takes an importMap option which emits an "importmap" script in the head', async () => {
    const importMap = {
      foo: './path/to/foo.js',
    };
    await act(() => {
      renderToPipeableStream(
        <html>
          <head>
            <script async={true} src="foo" />
          </head>
          <body>
            <div>hello world</div>
          </body>
        </html>,
        {
          importMap,
        },
      ).pipe(writable);
    });

    expect(document.head.innerHTML).toBe(
      '<script type="importmap">' +
        JSON.stringify(importMap) +
        '</script><script async="" src="foo"></script>' +
        (gate(flags => flags.shouldUseFizzExternalRuntime)
          ? '<script src="react-dom-bindings/src/server/ReactDOMServerExternalRuntime.js" async=""></script>'
          : '') +
        (gate(flags => flags.enableFizzBlockingRender)
          ? '<link rel="expect" href="#_R_" blocking="render">'
          : ''),
    );
  });

  // 修复：https://github.com/facebook/react/issues/27286
  /** 在完整html/body的自定义my-element内渲染div foo，断言保留自定义标签与children且补空head，覆盖自定义元素子节点服务器输出回归。 */
  it('can render custom elements with children on ther server', async () => {
    await act(() => {
      renderToPipeableStream(
        <html>
          <body>
            <my-element>
              <div>foo</div>
            </my-element>
          </body>
        </html>,
      ).pipe(writable);
    });

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <my-element>
            <div>foo</div>
          </my-element>
        </body>
      </html>,
    );
  });

    // https://github.com/facebook/react/issues/27540
    // preconnect 在微任务中晚于初始渲染执行；流结束后不应再写入资源提示。
    // 本用例检查最终文档且要求全过程没有异步写入错误；并未独立统计 write 调用。
  /** Preload启动await 1之后的preconnect，使资源提示晚于初始输出与流结束；act完成后文档仍只有main hello，无异步写入错误冒出。断言没有单独统计write调用次数。 */
  it('does not try to write to the stream after it has been closed', async () => {
    /**
     * 等待一个微任务后发出preconnect foo，让资源调用发生在初始同步渲染之后；返回的promise未被组件await。
     * @returns 完成资源调用的promise。
     */
    async function preloadLate() {
      await 1;
      ReactDOM.preconnect('foo');
    }

    /**
     * 启动preloadLate且返回null，不暂停服务器树，故流可先结束再执行资源调用。
     * @returns null。
     */
    function Preload() {
      preloadLate();
      return null;
    }

    /**
     * 输出完整html/body/main并附加无DOM的Preload组件，观察晚到资源提示不会破坏已结束文档。
     * @returns 完整文档。
     */
    function App() {
      return (
        <html>
          <body>
            <main>hello</main>
            <Preload />
          </body>
        </html>
      );
    }
    await act(() => {
      renderToPipeableStream(<App />).pipe(writable);
    });

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <main>hello</main>
        </body>
      </html>,
    );
  });

  /** 不pipe而等待初次工作，App发出preconnect、DNS、font与高优先级image预加载，blocked子树仍暂停。onHeaders只含已执行资源及初始img，验证初次工作后的headers收集不包含未执行子树。 */
  it('provides headers after initial work if onHeaders option used', async () => {
    let headers = null;
    /**
     * 保存初次工作结束时的headers对象，供精确Link内容断言；此时尚未pipe。
     * @param x 服务器生成的headers。
     */
    function onHeaders(x) {
      headers = x;
    }

    /** 发出font2/imagepre2/pre2/dns2资源调用；父Blocked未完成时此组件尚未执行，因此首批headers不含这些资源。 */
    function Preloads() {
      ReactDOM.preload('font2', {as: 'font'});
      ReactDOM.preload('imagepre2', {as: 'image', fetchPriority: 'high'});
      ReactDOM.preconnect('pre2', {crossOrigin: 'use-credentials'});
      ReactDOM.prefetchDNS('dns2');
    }

    /**
     * 先在blocked文本键暂停，完成后才输出Preloads与image2；本例不完成此键。
     * @returns 已解锁的资源调用与图片。
     * @throws 未完成文本的thenable。
     */
    function Blocked() {
      readText('blocked');
      return (
        <>
          <Preloads />
          <img src="image2" />
        </>
      );
    }

    /**
     * 先发出首批字体/图片/连接/DNS资源，再输出image及Blocked，区分初次可执行资源和暂停后的资源。
     * @returns 完整文档。
     */
    function App() {
      ReactDOM.preload('font', {as: 'font'});
      ReactDOM.preload('imagepre', {as: 'image', fetchPriority: 'high'});
      ReactDOM.preconnect('pre', {crossOrigin: 'use-credentials'});
      ReactDOM.prefetchDNS('dns');
      return (
        <html>
          <body>
            <img src="image" />
            <Blocked />
          </body>
        </html>
      );
    }

    await act(() => {
      renderToPipeableStream(<App />, {onHeaders});
    });

    expect(headers).toEqual({
      Link: `
<pre>; rel=preconnect; crossorigin="use-credentials",
 <dns>; rel=dns-prefetch,
 <font>; rel=preload; as="font"; crossorigin="",
 <imagepre>; rel=preload; as="image"; fetchpriority="high",
 <image>; rel=preload; as="image"
`
        .replaceAll('\n', '')
        .trim(),
    });
  });

  /** 显式preload与img分别提供srcSet、srcSet+sizes及普通URL；不pipe时收集headers，断言仅两条普通图片进入Link，验证响应式图片不纳入HTTP预加载头。 */
  it('omits images from preload headers if they contain srcset and sizes', async () => {
    let headers = null;
    /**
     * 保存响应式图片测试的headers对象。
     * @param x 当前Link头集合。
     */
    function onHeaders(x) {
      headers = x;
    }

    /**
     * 同时发出带srcSet、srcSet+sizes与普通URL的preload和img，观察headers仅保留普通图片。
     * @returns 图片文档。
     */
    function App() {
      ReactDOM.preload('responsive-preload-set-only', {
        as: 'image',
        fetchPriority: 'high',
        imageSrcSet: 'srcset',
      });
      ReactDOM.preload('responsive-preload', {
        as: 'image',
        fetchPriority: 'high',
        imageSrcSet: 'srcset',
        imageSizes: 'sizes',
      });
      ReactDOM.preload('non-responsive-preload', {
        as: 'image',
        fetchPriority: 'high',
      });
      return (
        <html>
          <body>
            <img
              src="responsive-img-set-only"
              fetchPriority="high"
              srcSet="srcset"
            />
            <img
              src="responsive-img"
              fetchPriority="high"
              srcSet="srcset"
              sizes="sizes"
            />
            <img src="non-responsive-img" fetchPriority="high" />
          </body>
        </html>
      );
    }

    await act(() => {
      renderToPipeableStream(<App />, {onHeaders});
    });

    expect(headers).toEqual({
      Link: `
<non-responsive-preload>; rel=preload; as="image"; fetchpriority="high",
 <non-responsive-img>; rel=preload; as="image"; fetchpriority="high"
`
        .replaceAll('\n', '')
        .trim(),
    });
  });

  /** 高优先级img带no-referrer，初次工作后捕获headers；断言Link包含referrerpolicy=no-referrer，验证图片头保留策略。 */
  it('preserves referrerPolicy for image preload headers', async () => {
    let headers = null;
    /**
     * 保存带referrerPolicy图片的headers，用于完整Link字符串断言。
     * @param x headers对象。
     */
    function onHeaders(x) {
      headers = x;
    }

    /**
     * 输出带high优先级和no-referrer策略的img，验证图片HTTP预加载头属性传播。
     * @returns 图片文档。
     */
    function App() {
      return (
        <html>
          <body>
            <img
              src="image-with-referrer-policy"
              fetchPriority="high"
              referrerPolicy="no-referrer"
            />
          </body>
        </html>
      );
    }

    await act(() => {
      renderToPipeableStream(<App />, {onHeaders});
    });

    expect(headers).toEqual({
      Link: `<image-with-referrer-policy>; rel=preload; as="image"; fetchpriority="high"; referrerpolicy="no-referrer"`,
    });
  });

  /** 初次工作之前立即pipe含响应式图片及显式preload的树；断言onHeaders收到空对象，覆盖提前流出时header窗口已关闭的路径。 */
  it('emits nothing for headers if you pipe before work begins', async () => {
    let headers = null;
    /**
     * 保存立即pipe时的headers，断言为空对象。
     * @param x headers对象。
     */
    function onHeaders(x) {
      headers = x;
    }

    /**
     * 发出响应式preload并输出响应式img，让测试在任何工作开始前pipe并关闭header收集窗口。
     * @returns 图片文档。
     */
    function App() {
      ReactDOM.preload('presrc', {
        as: 'image',
        fetchPriority: 'high',
        imageSrcSet: 'presrcset',
        imageSizes: 'presizes',
      });
      return (
        <html>
          <body>
            <img src="src" srcSet="srcset" sizes="sizes" />
          </body>
        </html>
      );
    }

    await act(() => {
      renderToPipeableStream(<App />, {onHeaders}).pipe(writable);
    });

    expect(headers).toEqual({});
  });

  /** 依次preconnect foo/bar/baz，maxHeadersLength设44；断言Link只容纳foo与bar，验证达到上限后不再累积下一条。 */
  it('stops accumulating new headers once the maxHeadersLength limit is satisifed', async () => {
    let headers = null;
    /**
     * 保存长度上限测试的headers对象。
     * @param x headers对象。
     */
    function onHeaders(x) {
      headers = x;
    }

    /**
     * 依次发出foo/bar/baz连接提示，令44字符上限只能容纳前两条。
     * @returns hello文档。
     */
    function App() {
      ReactDOM.preconnect('foo');
      ReactDOM.preconnect('bar');
      ReactDOM.preconnect('baz');
      return (
        <html>
          <body>hello</body>
        </html>
      );
    }

    await act(() => {
      renderToPipeableStream(<App />, {onHeaders, maxHeadersLength: 44});
    });

    expect(headers).toEqual({
      Link: `
<foo>; rel=preconnect,
 <bar>; rel=preconnect
`
        .replaceAll('\n', '')
        .trim(),
    });
  });

  /** onHeaders抛bad onHeaders，onError记录一次；随后仍pipe已返回控制器并断言div hello，验证回调错误被报告但不终止正常渲染。 */
  it('logs an error if onHeaders throws but continues the render', async () => {
    const errors = [];
    /**
     * 收集onHeaders抛错的message，证明回调失败被报告。
     * @param error headers回调错误。
     */
    function onError(error) {
      errors.push(error.message);
    }

    /**
     * 故意抛bad onHeaders，让测试检查错误报告后pipe仍可正常输出；x未读取。
     * @param x 生成的headers，本例未使用。
     * @throws bad onHeaders。
     */
    function onHeaders(x) {
      throw new Error('bad onHeaders');
    }

    let pipe;
    await act(() => {
      ({pipe} = renderToPipeableStream(<div>hello</div>, {onHeaders, onError}));
    });

    expect(errors).toEqual(['bad onHeaders']);

    await act(() => {
      pipe(writable);
    });

    expect(getVisibleChildren(container)).toEqual(<div>hello</div>);
  });

  /** 依次发出01至14的preconnect，比较maxHeadersLength为305与306的两次请求。断言Link长度分别284/306，验证链接间逗号空格计入长度且边界恰好可容纳时加入末条。 */
  it('accounts for the length of the interstitial between links when computing the headers length', async () => {
    let headers = null;
    /**
     * 保存每次请求的headers，使305/306两个上限可比较Link长度。
     * @param x 当前请求的headers。
     */
    function onHeaders(x) {
      headers = x;
    }

    /**
     * 依序发出14条等长preconnect；注释列出包含链接间分隔符的累计长度，供精确边界断言。
     * @returns hello文档。
     */
    function App() {
      // 20 字节
      ReactDOM.preconnect('01');
      // 42 字节
      ReactDOM.preconnect('02');
      // 64 字节
      ReactDOM.preconnect('03');
      // 86 字节
      ReactDOM.preconnect('04');
      // 108 字节
      ReactDOM.preconnect('05');
      // 130 字节
      ReactDOM.preconnect('06');
      // 152 字节
      ReactDOM.preconnect('07');
      // 174 字节
      ReactDOM.preconnect('08');
      // 196 字节
      ReactDOM.preconnect('09');
      // 218 字节
      ReactDOM.preconnect('10');
      // 240 字节
      ReactDOM.preconnect('11');
      // 262 字节
      ReactDOM.preconnect('12');
      // 284 字节
      ReactDOM.preconnect('13');
      // 306 字节
      ReactDOM.preconnect('14');
      return (
        <html>
          <body>hello</body>
        </html>
      );
    }

    await act(() => {
      renderToPipeableStream(<App />, {onHeaders, maxHeadersLength: 305});
    });
    expect(headers.Link.length).toBe(284);

    await act(() => {
      renderToPipeableStream(<App />, {onHeaders, maxHeadersLength: 306});
    });
    expect(headers.Link.length).toBe(306);
  });

  /** AsyncComp先暂停，兄弟ErrorComp抛boom令shell fatal；随后完成promise并再次pipe，didRender始终false且errors仅boom，验证fatal后不继续工作。didFatal初值true且末尾与自身比较，不能据此证明onShellError调用。 */
  it('does not perform any additional work after fatally erroring', async () => {
    let resolve: () => void;
    const promise = new Promise(r => {
      resolve = r;
    });
    /**
     * use可外部完成的promise，成功后才创建DidRender；fatal后完成promise不应再走到该组件。
     * @returns 包含Async文本的DidRender。
     * @throws 暂停信号。
     */
    function AsyncComp() {
      React.use(promise);
      return <DidRender>Async</DidRender>;
    }

    let didRender = false;
    /**
     * 一旦执行即将didRender置true并透传children，作为fatal后是否继续工作的探针。
     * @param children 输出内容。
     * @returns children。
     */
    function DidRender({children}) {
      didRender = true;
      return children;
    }

    /**
     * 根级无Suspense包裹地抛boom，使shell发生fatal错误。
     * @throws boom。
     */
    function ErrorComp() {
      throw new Error('boom');
    }

    /**
     * 先建立暂停边界再渲染根级ErrorComp，制造已有待恢复任务的fatal请求。
     * @returns fatal shell树。
     */
    function App() {
      return (
        <div>
          <Suspense fallback="loading...">
            <AsyncComp />
          </Suspense>
          <ErrorComp />
        </div>
      );
    }

    let pipe;
    const errors = [];
    let didFatal = true;
    await act(() => {
      pipe = renderToPipeableStream(<App />, {
        /**
         * 收集fatal错误message，预期只收到boom。
         * @param error 根级渲染错误。
         */
        onError(error) {
          errors.push(error.message);
        },
        /**
         * 收到shell错误时将didFatal设true；变量初值已为true且断言与自身比较，本例未有效验证该回调是否执行。
         * @param error shell错误，本回调未读取。
         */
        onShellError(error) {
          didFatal = true;
        },
      }).pipe;
    });

    expect(didRender).toBe(false);
    await act(() => {
      resolve();
    });
    expect(didRender).toBe(false);

    const testWritable = new Stream.Writable();
    await act(() => pipe(testWritable));
    expect(didRender).toBe(false);
    expect(didFatal).toBe(didFatal);
    expect(errors).toEqual(['boom']);
  });

  /** 异步边界永远暂停、根兄弟抛boom，先断言唯一错误boom；fatal结束后再abort too late，errors仍不变，验证迟到中止不再报告。 */
  it('does not report aborts after fatally erroring', async () => {
    const promise = new Promise(() => {});
    /**
     * use永不完成promise并在完成时返回Async，使fatal请求保留可中止的暂停任务。
     * @returns 正常完成后的Async文本。
     * @throws 暂停信号。
     */
    function AsyncComp() {
      React.use(promise);
      return 'Async';
    }

    /**
     * 根级抛boom，让请求在迟到abort之前fatal。
     * @throws boom。
     */
    function ErrorComp() {
      throw new Error('boom');
    }

    const errors = [];
    let abort;
    await act(() => {
      abort = renderToPipeableStream(
        <div>
          <Suspense fallback="loading...">
            <AsyncComp />
          </Suspense>
          <ErrorComp />
        </div>,
        {
          /**
           * 收集任务错误message，核对fatal后abort不会追加too late。
           * @param error 服务器错误。
           */
          onError(error) {
            errors.push(error.message);
          },
          /** 空shell错误回调，处理预期的根级fatal通知；本例只断言onError消息。 */
          onShellError() {},
        },
      ).abort;
    });

    expect(errors).toEqual(['boom']);

    await act(() => {
      abort(new Error('too late'));
    });

    expect(errors).toEqual(['boom']);
  });

  describe('error escaping', () => {
    /** 同步错误message、digest及displayName包含可闭合HTML属性并插入script的字符串；流式错误fallback输出执行后window.__outlet仍为空，验证直接输出错误属性的HTML转义。 */
    it('escapes error hash, message, and component stack values in directly flushed errors (html escaping)', async () => {
      window.__outlet = {};

      const dangerousErrorString =
        '"></template></div><script>window.__outlet.message="from error"</script><div><template data-foo="';

      /**
       * 抛出带HTML属性与script注入片段的Error；displayName另带栈注入片段，覆盖错误消息和组件栈的转义。
       * @throws 注入文本Error。
       */
      function Erroring() {
        throw new Error(dangerousErrorString);
      }

      // 我们无法在组件堆栈中测试换行，因为堆栈总是只有一行，所以我们会丢弃包括换行字符的第一部分。
      Erroring.displayName =
        'DangerousName' +
        dangerousErrorString.replace(
          'message="from error"',
          'stack="from_stack"',
        );

      /**
       * 在Suspense内放置Erroring，使同步失败直接序列化到边界错误模板属性。
       * @returns 错误转义测试树。
       */
      function App() {
        return (
          <div>
            <Suspense fallback={<div>Loading...</div>}>
              <Erroring />
            </Suspense>
          </div>
        );
      }

      /**
       * 从危险消息生成含另一script赋值的digest，检查hash字段也被HTML转义。
       * @param x 危险消息Error。
       * @returns 注入文本digest。
       */
      function onError(x) {
        return `dangerous hash ${x.message.replace(
          'message="from error"',
          'hash="from hash"',
        )}`;
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />, {
          onError,
        });
        pipe(writable);
      });
      expect(window.__outlet).toEqual({});
    });

    /** lazy先暂停，后以可闭合JS字符串及script标签的错误拒绝，同时digest/displayName带注入文本；恢复指令执行后window.__outlet仍为空，验证客户端接管指令中的JavaScript转义。 */
    it('escapes error hash, message, and component stack values in clientRenderInstruction (javascript escaping)', async () => {
      window.__outlet = {};

      const dangerousErrorString =
        '");window.__outlet.message="from error";</script><script>(() => {})("';

      let rejectComponent;
      const SuspensyErroring = React.lazy(() => {
        return new Promise((resolve, reject) => {
          rejectComponent = reject;
        });
      });

      // 我们无法在组件堆栈中测试换行，因为堆栈总是只有一行，所以我们会丢弃包括换行字符的第一部分。
      SuspensyErroring.displayName =
        'DangerousName' +
        dangerousErrorString.replace(
          'message="from error"',
          'stack="from_stack"',
        );

      /**
       * 用Suspense包裹可外部拒绝的lazy组件，先输出fallback，后输出客户端接管指令。
       * @returns lazy错误转义树。
       */
      function App() {
        return (
          <div>
            <Suspense fallback={<div>Loading...</div>}>
              <SuspensyErroring />
            </Suspense>
          </div>
        );
      }

      /**
       * 从危险消息生成含hash赋值的digest，覆盖接管指令的JavaScript字符串转义。
       * @param x 危险消息Error。
       * @returns 注入文本digest。
       */
      function onError(x) {
        return `dangerous hash ${x.message.replace(
          'message="from error"',
          'hash="from hash"',
        )}`;
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />, {
          onError,
        });
        pipe(writable);
      });

      await act(() => {
        rejectComponent(new Error(dangerousErrorString));
      });
      expect(window.__outlet).toEqual({});
    });

    /** 错误message含伪造data-msg/data-foo属性，digest将bad message替为bad hash；服务器收集原错误，客户端同步Hello接管并核对原消息/digest/DEV栈，验证转义防止属性被额外字段覆盖。 */
    it('escapes such that attributes cannot be masked', async () => {
      const dangerousErrorString = '" data-msg="bad message" data-foo="';
      const theError = new Error(dangerousErrorString);

      /**
       * 服务器阶段抛含伪造属性的theError，客户端阶段返回Hello，便于从恢复错误中读回原始字段。
       * @param isClient 是否直接成功渲染。
       * @returns Hello。
       * @throws theError。
       */
      function Erroring({isClient}) {
        if (isClient) return 'Hello';
        throw theError;
      }

      /**
       * 把isClient传给边界内Erroring，服务器失败后可在客户端成功接管。
       * @param isClient 客户端成功开关。
       * @returns 属性覆盖测试树。
       */
      function App({isClient}) {
        return (
          <div>
            <Suspense fallback={<div>Loading...</div>}>
              <Erroring isClient={isClient} />
            </Suspense>
          </div>
        );
      }

      const loggedErrors = [];
      /**
       * 保存原始Error并生成只替换bad message为bad hash的digest；预计算后清空列表以保证次数断言。
       * @param x 原始Error。
       * @returns 危险属性文本digest。
       */
      function onError(x) {
        loggedErrors.push(x);
        return x.message.replace('bad message', 'bad hash');
      }
      const expectedDigest = onError(theError);
      loggedErrors.length = 0;

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />, {
          onError,
        });
        pipe(writable);
      });

      expect(loggedErrors).toEqual([theError]);

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
        /**
         * 收集恢复error/errorInfo，验证注入文本未覆盖序列化的message、digest或组件栈。
         * @param error 恢复错误。
         * @param errorInfo 附加信息。
         */
        onRecoverableError(error, errorInfo) {
          errors.push({error, errorInfo});
        },
      });
      await waitForAll([]);

    // 若未正确转义，将会收到内容为 "bad hash" 的消息。
      expectErrors(
        errors,
        [
          [
            'Switched to client rendering because the server rendering errored:\n\n' +
              theError.message,
            expectedDigest,
            componentStack(['Erroring', 'Suspense', 'div', 'App']),
          ],
        ],
        [
          [
            'The server could not finish this Suspense boundary, likely due to an error during server rendering. Switched to client rendering.',
            expectedDigest,
          ],
        ],
      );
    });
  });

  /** bootstrapScripts/bootstrapModules各混合字符串、仅src对象和带integrity对象；断言head低优先级preload及body脚本原始HTML，验证integrity仅随指定资源传播且module类型正确。 */
  it('accepts an integrity property for bootstrapScripts and bootstrapModules', async () => {
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head />
          <body>
            <div>hello world</div>
          </body>
        </html>,
        {
          bootstrapScripts: [
            'foo',
            {
              src: 'bar',
            },
            {
              src: 'baz',
              integrity: 'qux',
            },
          ],
          bootstrapModules: [
            'quux',
            {
              src: 'corge',
            },
            {
              src: 'grault',
              integrity: 'garply',
            },
          ],
        },
      );
      pipe(writable);
    });

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head>
          <link rel="preload" fetchpriority="low" href="foo" as="script" />
          <link rel="preload" fetchpriority="low" href="bar" as="script" />
          <link
            rel="preload"
            fetchpriority="low"
            href="baz"
            as="script"
            integrity="qux"
          />
          <link rel="modulepreload" fetchpriority="low" href="quux" />
          <link rel="modulepreload" fetchpriority="low" href="corge" />
          <link
            rel="modulepreload"
            fetchpriority="low"
            href="grault"
            integrity="garply"
          />
        </head>
        <body>
          <div>hello world</div>
        </body>
      </html>,
    );
    expect(
      stripExternalRuntimeInNodes(
        document.getElementsByTagName('script'),
        renderOptions.unstable_externalRuntimeSrc,
      ).map(n => n.outerHTML),
    ).toEqual([
      '<script src="foo" id="_R_" async=""></script>',
      '<script src="bar" async=""></script>',
      '<script src="baz" integrity="qux" async=""></script>',
      '<script type="module" src="quux" async=""></script>',
      '<script type="module" src="corge" async=""></script>',
      '<script type="module" src="grault" integrity="garply" async=""></script>',
    ]);
  });

  /** bootstrapScripts/Modules混合字符串及不同crossOrigin对象；断言低优先级preload与原始脚本HTML，空值和未知字符串归为空crossorigin，use-credentials保留，未指定项不增加该属性。 */
  it('accepts a crossOrigin property for bootstrapScripts and bootstrapModules', async () => {
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head />
          <body>
            <div>hello world</div>
          </body>
        </html>,
        {
          bootstrapScripts: [
            'foo',
            {
              src: 'bar',
            },
            {
              src: 'baz',
              crossOrigin: '',
            },
            {
              src: 'qux',
              crossOrigin: 'defaults-to-empty',
            },
          ],
          bootstrapModules: [
            'quux',
            {
              src: 'corge',
            },
            {
              src: 'grault',
              crossOrigin: 'use-credentials',
            },
          ],
        },
      );
      pipe(writable);
    });

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head>
          <link rel="preload" fetchpriority="low" href="foo" as="script" />
          <link rel="preload" fetchpriority="low" href="bar" as="script" />
          <link
            rel="preload"
            fetchpriority="low"
            href="baz"
            as="script"
            crossorigin=""
          />
          <link
            rel="preload"
            fetchpriority="low"
            href="qux"
            as="script"
            crossorigin=""
          />
          <link rel="modulepreload" fetchpriority="low" href="quux" />
          <link rel="modulepreload" fetchpriority="low" href="corge" />
          <link
            rel="modulepreload"
            fetchpriority="low"
            href="grault"
            crossorigin="use-credentials"
          />
        </head>
        <body>
          <div>hello world</div>
        </body>
      </html>,
    );
    expect(
      stripExternalRuntimeInNodes(
        document.getElementsByTagName('script'),
        renderOptions.unstable_externalRuntimeSrc,
      ).map(n => n.outerHTML),
    ).toEqual([
      '<script src="foo" id="_R_" async=""></script>',
      '<script src="bar" async=""></script>',
      '<script src="baz" crossorigin="" async=""></script>',
      '<script src="qux" crossorigin="" async=""></script>',
      '<script type="module" src="quux" async=""></script>',
      '<script type="module" src="corge" async=""></script>',
      '<script type="module" src="grault" crossorigin="use-credentials" async=""></script>',
    ]);
  });

  describe('inline script escaping', () => {
    describe('bootstrapScriptContent', () => {
      /** bootstrapScriptContent包含多种大小写script子串、关闭标签及HTML注释，执行后outlet仍等于原始字符串；验证只转义匹配标签中的S/s而保留相邻字符大小写及运行结果。 */
      it('the "S" in "</?[Ss]cript" strings are replaced with unicode escaped lowercase s or S depending on case, preserving case sensitivity of nearby characters', async () => {
        window.__test_outlet = '';
        const stringWithScriptsInIt =
          'prescription pre<scription pre<Scription pre</scRipTion pre</ScripTion </script><script><!-- <script> -->';
        await act(() => {
          const {pipe} = renderToPipeableStream(<div />, {
            bootstrapScriptContent:
              'window.__test_outlet = "This should have been replaced";var x = "' +
              stringWithScriptsInIt +
              '";\nwindow.__test_outlet = x;',
          });
          pipe(writable);
        });
        expect(window.__test_outlet).toMatch(stringWithScriptsInIt);
      });

      /** 将含U+2028/U+2029的JSON作为脚本表达式执行，断言对象序列化等于移去该空白的原文本；验证这些字符无需转义且仍可被JS解析。 */
      it('does not escape \\u2028, or \\u2029 characters', async () => {
    // 这里把含 U+2028/U+2029 的 JSON 放在脚本表达式中；它们作为表达式间的空白解析，最终对象仍包含 one/two。
        window.__test_outlet = '';
        const el = document.createElement('p');
        el.textContent = '{"one":1,\u2028\u2029"two":2}';
        const stringWithLSAndPSCharacters = el.textContent;
        await act(() => {
          const {pipe} = renderToPipeableStream(<div />, {
            bootstrapScriptContent:
              'let x = ' +
              stringWithLSAndPSCharacters +
              '; window.__test_outlet = x;',
          });
          pipe(writable);
        });
        const outletString = JSON.stringify(window.__test_outlet);
        expect(outletString).toBe(
          stringWithLSAndPSCharacters.replace(/[\u2028\u2029]/g, ''),
        );
      });

      /** bootstrapScriptContent直接执行1 < 2 & 3 > 1表达式，断言结果1；验证小于、大于和按位与符号保持可执行语法。 */
      it('does not escape <, >, or & characters', async () => {
    // 这些字符是有效 JavaScript，脚本可能需要它们；若在 JavaScript 字符串上下文之外转义，
    // 反而无法被正确解释。
        window.__test_outlet = null;
    // 由于按位与运算，这个布尔表达式会被转换成数字；下面检查真值 1。
        const booleanLogicString = '1 < 2 & 3 > 1';
        await act(() => {
          const {pipe} = renderToPipeableStream(<div />, {
            bootstrapScriptContent:
              'let x = ' + booleanLogicString + '; window.__test_outlet = x;',
          });
          pipe(writable);
        });
        expect(window.__test_outlet).toBe(1);
      });
    });

    describe('importMaps', () => {
      /** importMap的键和值均包含闭合script与额外赋值脚本，输出后两个outlet仍为空，验证JSON内关闭标签被转义而未执行注入。 */
      it('escapes </[sS]cirpt> in importMaps', async () => {
        window.__test_outlet_key = '';
        window.__test_outlet_value = '';
        const jsonWithScriptsInIt = {
          "keypos</script><script>window.__test_outlet_key = 'pwned'</script><script>":
            'value',
          key: "valuepos</script><script>window.__test_outlet_value = 'pwned'</script><script>",
        };
        await act(() => {
          const {pipe} = renderToPipeableStream(<div />, {
            importMap: jsonWithScriptsInIt,
          });
          pipe(writable);
        });
        expect(window.__test_outlet_key).toBe('');
        expect(window.__test_outlet_value).toBe('');
      });
    });

    describe('inline script', () => {
      /** inline script的HTML注释含关闭标签及恶意后续脚本，正常赋值为safe；执行后outlet仍safe，验证标签转义防止提前结束script。 */
      it('escapes </[sS]cirpt> in inline scripts', async () => {
        window.__test_outlet = '';
        await act(() => {
          const {pipe} = renderToPipeableStream(
            <script>{`
              <!-- some html comment </script><script>window.__test_outlet = 'pwned'</script>
              window.__test_outlet = 'safe';
              --> </script><script>window.__test_outlet = 'pwned after'</script>
            `}</script>,
          );
          pipe(writable);
        });
        expect(window.__test_outlet).toBe('safe');
      });
    });
  });

  describe('<style> textContent escaping', () => {
    /** 普通style的content字符串含不同大小写的关闭/打开style标签，后续body背景设blue；断言计算样式仍蓝，验证style文本转义未截断CSS。 */
    it('the "S" in "</?[Ss]style" strings are replaced with unicode escaped lowercase s or S depending on case, preserving case sensitivity of nearby characters', async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <style>{`
            .foo::after {
              content: 'sSsS</style></Style></StYlE><style><Style>sSsS'
            }
            body {
              background-color: blue;
            }
          `}</style>,
        );
        pipe(writable);
      });
      expect(window.getComputedStyle(document.body).backgroundColor).toMatch(
        'rgb(0, 0, 255)',
      );
    });

    /** 两条可提升style分别带foo/bar href与同一precedence，内部含危险style标签串且背景依次blue/red；断言最终红色，验证合并/提升样式的转义与顺序。 */
    it('the "S" in "</?[Ss]style" strings are replaced with unicode escaped lowercase s or S depending on case, preserving case sensitivity of nearby characters inside hoistable style tags', async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <>
            <style href="foo" precedence="default">{`
            .foo::after {
              content: 'sSsS</style></Style></StYlE><style><Style>sSsS'
            }
            body {
              background-color: blue;
            }
          `}</style>
            <style href="bar" precedence="default">{`
          .foo::after {
            content: 'sSsS</style></Style></StYlE><style><Style>sSsS'
          }
          body {
            background-color: red;
          }
        `}</style>
          </>,
        );
        pipe(writable);
      });
      expect(window.getComputedStyle(document.body).backgroundColor).toMatch(
        'rgb(255, 0, 0)',
      );
    });
  });

  /** enableFizzExternalRuntime开启时指定src-of-external-runtime并暂停Hello；断言head只含该async脚本、body仍loading，验证外部运行时选项的插入位置；本例未完成边界或断言阻塞效果。 */
  // @gate enableFizzExternalRuntime
  it('supports option to load runtime as an external script', async () => {
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head />
          <body>
            <Suspense fallback={'loading...'}>
              <AsyncText text="Hello" />
            </Suspense>
          </body>
        </html>,
        {
          unstable_externalRuntimeSrc: 'src-of-external-runtime',
        },
      );
      pipe(writable);
    });

    // 外部运行时应发送到 <head>，以便尽早获取并执行脚本。对于使用 Suspense 的 SSR 页面，
    // 这次脚本执行会阻塞渲染。
    expect(
      Array.from(document.head.getElementsByTagName('script')).map(
        n => n.outerHTML,
      ),
    ).toEqual(['<script src="src-of-external-runtime" async=""></script>']);

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>loading...</body>
      </html>,
    );
  });

  /** shouldUseFizzExternalRuntime开启时先输出Hello fallback再完成文本；断言整个文档只有一个script，验证恢复指令不另输出inline script。 */
  // @gate shouldUseFizzExternalRuntime
  it('does not send script tags for SSR instructions when using the external runtime', async () => {
    /**
     * 在Suspense内暂停Hello，供外部运行时恢复后统计script数量。
     * @returns div测试树。
     */
    function App() {
      return (
        <div>
          <Suspense fallback="Loading...">
            <div>
              <AsyncText text="Hello" />
            </div>
          </Suspense>
        </div>
      );
    }
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });
    await act(() => {
      resolveText('Hello');
    });

    // 唯一发送的 script 元素应来自 unstable_externalRuntimeSrc。
    expect(document.getElementsByTagName('script').length).toEqual(1);
  });

  /** shouldUseFizzExternalRuntime开启时渲染无Suspense的静态完整文档；断言仍输出一个外部runtime脚本及开关控制的blocking标记，记录当前静态页也发送runtime的行为。 */
  // @gate shouldUseFizzExternalRuntime
  it('does (unfortunately) send the external runtime for static pages', async () => {
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head />
          <body>
            <p>hello world!</p>
          </body>
        </html>,
      );
      pipe(writable);
    });

    // 除已输出的 external runtime script 外，不应再发送脚本。
    expect(document.getElementsByTagName('script').length).toEqual(1);

    // 应保持 HTML 如原样。
    expect(document.documentElement.innerHTML).toEqual(
      '<head><script src="react-dom-bindings/src/server/ReactDOMServerExternalRuntime.js" async=""></script>' +
        (gate(flags => flags.enableFizzBlockingRender)
          ? '<link rel="expect" href="#_R_" blocking="render">'
          : '') +
        '</head><body><p>hello world!</p>' +
        (gate(flags => flags.enableFizzBlockingRender)
          ? '<template id="_R_"></template>'
          : '') +
        '</body>',
    );
  });

  /** 服务器与客户端各建独立暂停promise，服务器先完成输出p A/h2 world，客户端hydration先暂停保持相同DOM。完成客户端promise后无恢复日志且DOM一致，验证暂停抑制伪不匹配警告而后成功hydrate。 */
  it('#24384: Suspending should halt hydration warnings and not emit any if hydration completes successfully after unsuspending', async () => {
    /**
     * 为服务器/客户端分别创建独立promise、完成标记与组件，返回App和解除函数；两次调用不共享暂停状态。
     * @returns App及resolve二元组。
     */
    const makeApp = () => {
      let resolve, resolved;
      const promise = new Promise(r => {
        /** 先置本次makeApp的resolved为true再完成promise，使重试不再抛同一等待项；两端解除函数互相独立。 */
        resolve = () => {
          resolved = true;
          return r();
        };
      });
      /**
       * 未resolved时抛本次makeApp的promise，完成后输出p A，供匹配hydration路径使用。
       * @returns p A。
       * @throws 未完成promise。
       */
      function ComponentThatSuspends() {
        if (!resolved) {
          throw promise;
        }
        return <p>A</p>;
      }

      /**
       * 输出暂停组件及固定world h2，服务器和客户端内容相同，检查恢复后无伪不匹配。
       * @returns Suspense测试树。
       */
      const App = () => {
        return (
          <div>
            <Suspense fallback={<h1>Loading...</h1>}>
              <ComponentThatSuspends />
              <h2 name="hello">world</h2>
            </Suspense>
          </div>
        );
      };

      return [App, resolve];
    };

    const [ServerApp, serverResolve] = makeApp();
    await act(() => {
      const {pipe} = renderToPipeableStream(<ServerApp />);
      pipe(writable);
    });
    await act(() => {
      serverResolve();
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>A</p>
        <h2 name="hello">world</h2>
      </div>,
    );

    const [ClientApp, clientResolve] = makeApp();
    ReactDOMClient.hydrateRoot(container, <ClientApp />, {
      /**
       * 记录恢复错误首句及cause；匹配树完成hydration后预期没有任何日志。
       * @param error 恢复错误。
       */
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
        <p>A</p>
        <h2 name="hello">world</h2>
      </div>,
    );

    // 客户端暂停解除后，内容与服务器一致，hydration完成且没有恢复错误日志。
    await clientResolve();
    await waitForAll([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>A</p>
        <h2 name="hello">world</h2>
      </div>,
    );
  });

  /** 独立服务器/客户端promise暂停同一组件，但h2文本及name从initial改replaced；暂停时保留initial且无日志，完成后恰报告文本不匹配并显示replaced，验证真实不匹配在恢复后仍被报告。 */
  it('#24384: Suspending should halt hydration warnings but still emit hydration warnings after unsuspending if mismatches are genuine', async () => {
    /**
     * 独立创建promise、resolved标记与可接受text的App，使两端在同一结构中使用不同文本。
     * @returns App及解除函数。
     */
    const makeApp = () => {
      let resolve, resolved;
      const promise = new Promise(r => {
        /** 将本次makeApp置为已完成并resolve promise，使真正文本不匹配在暂停解除后被检查。 */
        resolve = () => {
          resolved = true;
          return r();
        };
      });
      /**
       * 未完成时暂停，完成后输出相同p A，使真正不匹配集中于后方h2。
       * @returns p A。
       * @throws promise。
       */
      function ComponentThatSuspends() {
        if (!resolved) {
          throw promise;
        }
        return <p>A</p>;
      }

      /**
       * text同时控制h2的name及内容，配合前方暂停组件比较暂停前后真实不匹配。
       * @param text initial或replaced。
       * @returns Suspense树。
       */
      const App = ({text}) => {
        return (
          <div>
            <Suspense fallback={<h1>Loading...</h1>}>
              <ComponentThatSuspends />
              <h2 name={text}>{text}</h2>
            </Suspense>
          </div>
        );
      };

      return [App, resolve];
    };

    const [ServerApp, serverResolve] = makeApp();
    await act(() => {
      const {pipe} = renderToPipeableStream(<ServerApp text="initial" />);
      pipe(writable);
    });
    await act(() => {
      serverResolve();
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>A</p>
        <h2 name="initial">initial</h2>
      </div>,
    );

    // 客户端应用故意渲染错误文本。组件仍处于 suspended 状态，使 hydration 静默失败：允许预热缓存，
    // 但在组件 resolve 前跳过此边界。
    const [ClientApp, clientResolve] = makeApp();
    ReactDOMClient.hydrateRoot(container, <ClientApp text="replaced" />, {
      /**
       * 记录真实文本不匹配的恢复错误首句及cause，预期只在暂停解除后调用。
       * @param error 恢复错误。
       */
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
        <p>A</p>
        <h2 name="initial">initial</h2>
      </div>,
    );

    // 边界解析出子元素后，hydration 完成，并发现存在需要客户端渲染的不匹配。
    await clientResolve();
    await waitForAll([
      "onRecoverableError: Hydration failed because the server rendered text didn't match the client.",
    ]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>A</p>
        <h2 name="replaced">replaced</h2>
      </div>,
    );

    await waitForAll([]);
  });

  /** 同一Suspense内三个h2均从initial变replaced；hydration恰记录一次文本不匹配，最终三处全部replaced且后续无日志，验证同一边界不重复报告。 */
  it('only warns once on hydration mismatch while within a suspense boundary', async () => {
    /**
     * 在一个Suspense内将同一text写入三个h2，制造多处不匹配但一次边界接管。
     * @param text 两端不同的文本。
     * @returns 三h2测试树。
     */
    const App = ({text}) => {
      return (
        <div>
          <Suspense fallback={<h1>Loading...</h1>}>
            <h2>{text}</h2>
            <h2>{text}</h2>
            <h2>{text}</h2>
          </Suspense>
        </div>
      );
    };

    await act(() => {
      const {pipe} = renderToPipeableStream(<App text="initial" />);
      pipe(writable);
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <h2>initial</h2>
        <h2>initial</h2>
        <h2>initial</h2>
      </div>,
    );

    ReactDOMClient.hydrateRoot(container, <App text="replaced" />, {
      /**
       * 记录恢复错误首句及cause，检查多处文本不匹配只报告一次。
       * @param error 恢复错误。
       */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll([
      "onRecoverableError: Hydration failed because the server rendered text didn't match the client.",
    ]);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <h2>replaced</h2>
        <h2>replaced</h2>
        <h2>replaced</h2>
      </div>,
    );

    await waitForAll([]);
  });

  /** hydration时首个子树的getServerSnapshot抛uh oh，同时后面h3由three变five。仅记录最近边界恢复错误及cause，最终显示five，验证先发生错误后不另报告文本不匹配。 */
  it('supresses hydration warnings when an error occurs within a Suspense boundary', async () => {
    let isClient = false;

    /**
     * 利用getServerSnapshot只在hydration调用的路径抛uh oh；客户端重建使用普通快照，因此可返回children。
     * @param children 成功时透传的内容。
     * @returns children。
     * @throws hydration阶段的uh oh。
     */
    function ThrowWhenHydrating({children}) {
      // 这个技巧让错误只在 hydration 时抛出，因为该场景下 useSyncExternalStore 调用
      // getServerSnapshot，而不是常规的 getSnapshot。
      useSyncExternalStore(
        () => {},
        t => t,
        () => {
          if (isClient) {
            throw new Error('uh oh');
          }
        },
      );
      return children;
    }

    /**
     * 先放置hydration报错子树，再把h3从three改five；检查首次错误后不再报告后方文本不匹配。
     * @returns 错误与文本变化树。
     */
    const App = () => {
      return (
        <div>
          <Suspense fallback={<h1>Loading...</h1>}>
            <ThrowWhenHydrating>
              <h1>one</h1>
            </ThrowWhenHydrating>
            <h2>two</h2>
            <h3>{isClient ? 'five' : 'three'}</h3>
          </Suspense>
        </div>
      );
    };

    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <h1>one</h1>
        <h2>two</h2>
        <h3>three</h3>
      </div>,
    );

    isClient = true;

    ReactDOMClient.hydrateRoot(container, <App />, {
      /**
       * 记录局部hydration恢复错误及cause，预期只报告uh oh而非另一文本不匹配。
       * @param error 恢复错误。
       */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll([
      'onRecoverableError: There was an error while hydrating but React was able to recover by instead client rendering from the nearest Suspense boundary.',
      'Cause: uh oh',
    ]);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <h1>one</h1>
        <h2>two</h2>
        <h3>five</h3>
      </div>,
    );

    await waitForAll([]);
  });

  /** 同一边界三个子组件均设计为hydration抛错；断言只尝试并报告first error，第二/第三没有日志，随后客户端正常重建相同DOM，验证首次错误后停止该边界的hydration遍历。 */
  it('does not log for errors after the first hydration error', async () => {
    let isClient = false;

    /**
     * hydration时记录message并由getServerSnapshot抛同名错误，客户端重建透传children。
     * @param children 成功渲染内容。
     * @param message 标记first/second/third错误。
     * @returns children。
     * @throws hydration错误。
     */
    function ThrowWhenHydrating({children, message}) {
      // 这个技巧让错误只在 hydration 时抛出，因为该场景下 useSyncExternalStore 调用
      // getServerSnapshot，而不是常规的 getSnapshot。
      useSyncExternalStore(
        () => {},
        t => t,
        () => {
          if (isClient) {
            Scheduler.log('throwing: ' + message);
            throw new Error(message);
          }
        },
      );
      return children;
    }

    /**
     * 在同一Suspense中顺序放三项错误探针，验证首次错误后不继续尝试后两项。
     * @returns 三子树测试结构。
     */
    const App = () => {
      return (
        <div>
          <Suspense fallback={<h1>Loading...</h1>}>
            <ThrowWhenHydrating message="first error">
              <h1>one</h1>
            </ThrowWhenHydrating>
            <ThrowWhenHydrating message="second error">
              <h2>two</h2>
            </ThrowWhenHydrating>
            <ThrowWhenHydrating message="third error">
              <h3>three</h3>
            </ThrowWhenHydrating>
          </Suspense>
        </div>
      );
    };

    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <h1>one</h1>
        <h2>two</h2>
        <h3>three</h3>
      </div>,
    );

    isClient = true;

    ReactDOMClient.hydrateRoot(container, <App />, {
      /**
       * 记录恢复错误与cause，供仅first error被报告的断言。
       * @param error 恢复错误。
       */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll([
      'throwing: first error',

      // UI 已恢复且未向用户暴露错误，因此调用 onRecoverableError。
      'onRecoverableError: There was an error while hydrating but React was able to recover by instead client rendering from the nearest Suspense boundary.',
      'Cause: first error',
    ]);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <h1>one</h1>
        <h2>two</h2>
        <h3>three</h3>
      </div>,
    );

    await waitForAll([]);
  });

  /** 首个组件仅客户端暂停，后续三组件可在hydration抛错；先仅有suspending且保留服务器DOM，解除后只尝试/报告first error并成功接管，验证先暂停阻止后续错误被提前记录。 */
  it('does not log for errors after a preceding fiber suspends', async () => {
    let isClient = false;
    let promise = null;
    let unsuspend = null;
    let isResolved = false;

    /**
     * 服务器直接返回null；客户端未完成时只创建一次promise及unsuspend闭包、记录suspending后抛promise，解除后返回null。
     * @returns null。
     * @throws 客户端暂停promise。
     */
    function ComponentThatSuspendsOnClient() {
      if (isClient && !isResolved) {
        if (promise === null) {
          promise = new Promise(resolve => {
            /** 先置isResolved再完成缓存promise，让下次hydration继续遍历首个错误探针。 */
            unsuspend = () => {
              isResolved = true;
              resolve();
            };
          });
        }
        Scheduler.log('suspending');
        throw promise;
      }
      return null;
    }

    /**
     * 仅在hydration快照读取时记录并抛message错误，普通客户端渲染直接透传children。
     * @param children 输出内容。
     * @param message 错误标签。
     * @returns children。
     * @throws hydration错误。
     */
    function ThrowWhenHydrating({children, message}) {
      // 这个技巧让错误只在 hydration 时抛出，因为该场景下 useSyncExternalStore 调用
      // getServerSnapshot，而不是常规的 getSnapshot。
      useSyncExternalStore(
        () => {},
        t => t,
        () => {
          if (isClient) {
            Scheduler.log('throwing: ' + message);
            throw new Error(message);
          }
        },
      );
      return children;
    }

    /**
     * 将客户端暂停探针置于三个错误探针之前，观察暂停先阻止后续hydration遍历。
     * @returns 暂停优先测试树。
     */
    const App = () => {
      return (
        <div>
          <Suspense fallback={<h1>Loading...</h1>}>
            <ComponentThatSuspendsOnClient />
            <ThrowWhenHydrating message="first error">
              <h1>one</h1>
            </ThrowWhenHydrating>
            <ThrowWhenHydrating message="second error">
              <h2>two</h2>
            </ThrowWhenHydrating>
            <ThrowWhenHydrating message="third error">
              <h3>three</h3>
            </ThrowWhenHydrating>
          </Suspense>
        </div>
      );
    };

    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <h1>one</h1>
        <h2>two</h2>
        <h3>three</h3>
      </div>,
    );

    isClient = true;

    ReactDOMClient.hydrateRoot(container, <App />, {
      /**
       * 记录解除暂停后的第一个恢复错误及cause，前两轮不应记录后续错误。
       * @param error 恢复错误。
       */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll(['suspending']);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <h1>one</h1>
        <h2>two</h2>
        <h3>three</h3>
      </div>,
    );
    await unsuspend();
    await waitForAll([
      'throwing: first error',
      'onRecoverableError: There was an error while hydrating but React was able to recover by instead client rendering from the nearest Suspense boundary.',
      'Cause: first error',
    ]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <h1>one</h1>
        <h2>two</h2>
        <h3>three</h3>
      </div>,
    );
  });

  /** 标题保留outdated behavior：hydration首个组件抛first error，立即客户端接管时后方组件暂停。实际断言错误当轮已报告并显示Loading；解除后显示原内容且无新日志，不是等边界完成才报告错误。 */
  it('(outdated behavior) suspending after erroring will cause errors previously queued to be silenced until the boundary resolves', async () => {
    // 注意：本测试最初覆盖一个已不再发生的场景。hydration 期间报错时，React 会立即展开栈并切换到
    // 客户端渲染；保留此测试只是为了展示这组事件实际如何发生。

    let isClient = false;
    let promise = null;
    let unsuspend = null;
    let isResolved = false;

    /**
     * 服务器返回null；客户端创建一次promise并暂停，unsuspend同时置isResolved并resolve，供错误接管后的fallback显示测试。
     * @returns null。
     * @throws 暂停promise。
     */
    function ComponentThatSuspendsOnClient() {
      if (isClient && !isResolved) {
        if (promise === null) {
          promise = new Promise(resolve => {
            /** 先置isResolved再完成promise，让客户端接管后暂停的主内容重新显示；不会重新走服务器快照抛错路径。 */
            unsuspend = () => {
              isResolved = true;
              resolve();
            };
          });
        }
        Scheduler.log('suspending');
        throw promise;
      }
      return null;
    }

    /**
     * 在hydration阶段记录并抛message；切换客户端重建后透传children，因此后续暂停可发生于重建路径。
     * @param children 内容。
     * @param message 错误标签。
     * @returns children。
     * @throws hydration错误。
     */
    function ThrowWhenHydrating({children, message}) {
      // 这个技巧让错误只在 hydration 时抛出，因为该场景下 useSyncExternalStore 调用
      // getServerSnapshot，而不是常规的 getSnapshot。
      useSyncExternalStore(
        () => {},
        t => t,
        () => {
          if (isClient) {
            Scheduler.log('throwing: ' + message);
            throw new Error(message);
          }
        },
      );
      return children;
    }

    /**
     * 顺序放两个错误探针、暂停探针及第三错误探针；真实路径首次错误立即接管，再在客户端暂停。
     * @returns outdated标题对应的当前行为树。
     */
    const App = () => {
      return (
        <div>
          <Suspense fallback={<h1>Loading...</h1>}>
            <ThrowWhenHydrating message="first error">
              <h1>one</h1>
            </ThrowWhenHydrating>
            <ThrowWhenHydrating message="second error">
              <h2>two</h2>
            </ThrowWhenHydrating>
            <ComponentThatSuspendsOnClient />
            <ThrowWhenHydrating message="third error">
              <h3>three</h3>
            </ThrowWhenHydrating>
          </Suspense>
        </div>
      );
    };

    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <h1>one</h1>
        <h2>two</h2>
        <h3>three</h3>
      </div>,
    );

    isClient = true;

    ReactDOMClient.hydrateRoot(container, <App />, {
      /**
       * 记录当轮接管错误及cause，实际在边界暂停未完成时就已报告。
       * @param error 恢复错误。
       */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll([
      'throwing: first error',
      'suspending',
      'onRecoverableError: There was an error while hydrating but React was able to recover by instead client rendering from the nearest Suspense boundary.',
      'Cause: first error',
    ]);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <h1>Loading...</h1>
      </div>,
    );
    await clientAct(() => unsuspend());
    // 客户端组件只在首次渲染时抛错，因此本轮不会再有新的错误。
    assertLog([]);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <h1>one</h1>
        <h2>two</h2>
        <h3>three</h3>
      </div>,
    );
  });

  /** 外层/内层Suspense均已输出主内容，客户端只把A改为尚未完成的AsyncText。暂停前后errors都为空、服务器AB保持可见，完成后仍无错误，覆盖嵌套已完成边界不把暂停当可恢复错误。 */
  it('#24578 Hydration errors caused by a suspending component should not become recoverable when nested in an ancestor Suspense that is showing primary content', async () => {
    // 此测试曾失败，因为内部边界的 hydration 错误会被外部边界的代码路径升级为可恢复错误。
    /**
     * 嵌套两个Suspense，服务器使用同步A、客户端使用异步A，后接b B；保持输出匹配以排除真实hydration不匹配。
     * @param isClient 是否使A读取文本缓存。
     * @returns 嵌套边界树。
     */
    function App({isClient}) {
      return (
        <Suspense fallback={'outer'}>
          <Suspense fallback={'inner'}>
            <div>
              {isClient ? <AsyncText text="A" /> : <Text text="A" />}
              <b>B</b>
            </div>
          </Suspense>
        </Suspense>
      );
    }
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });

    const errors = [];
    ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
      /**
       * 收集恢复错误message；仅暂停且输出一致的路径预期始终为空。
       * @param error 恢复错误。
       */
      onRecoverableError(error) {
        errors.push(error.message);
      },
    });

    await waitForAll([]);
    expect(errors).toEqual([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        A<b>B</b>
      </div>,
    );

    resolveText('A');
    await waitForAll([]);
    expect(errors).toEqual([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        A<b>B</b>
      </div>,
    );
  });

  /** 服务器先输出p lazy及带多段文本的p some text，客户端lazy尚未完成且根暂停；先后断言无恢复错误，提供等价默认组件后DOM仍一致，验证暂停不造成相邻文本的伪不匹配。 */
  it('hydration warnings for mismatched text with multiple text nodes caused by suspending should be suppressed', async () => {
    let resolve;
    const Lazy = React.lazy(() => {
      return new Promise(r => {
        resolve = r;
      });
    });

    /**
     * 服务器直接输出p lazy，客户端改用等价lazy组件；后接含多个文本段的p，观察根暂停期间的文本匹配。
     * @param isClient 是否使用lazy。
     * @returns 懒组件与文本测试树。
     */
    function App({isClient}) {
      return (
        <div>
          {isClient ? <Lazy /> : <p>lazy</p>}
          <p>some {'text'}</p>
        </div>
      );
    }
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });

    const errors = [];
    ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
      /**
       * 收集恢复错误，预期lazy完成前后都没有伪文本不匹配。
       * @param error 恢复错误。
       */
      onRecoverableError(error) {
        errors.push(error.message);
      },
    });

    await waitForAll([]);
    expect(errors).toEqual([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>lazy</p>
        <p>some {'text'}</p>
      </div>,
    );

    resolve({
      /** 解除 lazy 模块等待时提供的默认组件导出。 */
      /**
       * 提供lazy完成后的默认组件，输出与服务器p lazy等价的节点，而非返回promise本身。
       * @returns p lazy。
       */
      default: () => <p>lazy</p>
    });
    await waitForAll([]);
    expect(errors).toEqual([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>lazy</p>
        <p>some {'text'}</p>
      </div>,
    );
  });

  /** html内无输出任务、head、body分别暂停，按body→nooutput→head完成。最终断言html/head/body属性与title，body中的preload被移至head，验证异步head仍可组合完整preamble。 */
  it('can emit the preamble even if the head renders asynchronously', async () => {
    /**
     * 先等待nooutput键再返回null，作为不产生DOM但仍影响文档完成时机的任务。
     * @returns null。
     * @throws 未完成文本的thenable。
     */
    function AsyncNoOutput() {
      readText('nooutput');
      return null;
    }
    /**
     * 先等待head键，完成后输出带属性和title的head，测试异步preamble合并。
     * @returns head。
     * @throws 未完成文本的thenable。
     */
    function AsyncHead() {
      readText('head');
      return (
        <head data-foo="foo">
          <title>a title</title>
        </head>
      );
    }
    /**
     * 先等待body键，完成后输出带属性的body、可提升preload与hello文本。
     * @returns body。
     * @throws 未完成文本的thenable。
     */
    function AsyncBody() {
      readText('body');
      return (
        <body data-bar="bar">
          <link rel="preload" as="style" href="foo" />
          hello
        </body>
      );
    }
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html data-html="html">
          <AsyncNoOutput />
          <AsyncHead />
          <AsyncBody />
        </html>,
      );
      pipe(writable);
    });
    await act(() => {
      resolveText('body');
    });
    await act(() => {
      resolveText('nooutput');
    });
    await act(() => {
      resolveText('head');
    });
    expect(getVisibleChildren(document)).toEqual(
      <html data-html="html">
        <head data-foo="foo">
          <link rel="preload" as="style" href="foo" />
          <title>a title</title>
        </head>
        <body data-bar="bar">hello</body>
      </html>,
    );
  });

  /** 监听原始流块，body先输出first、Suspense中的second暂停；完成后最终DOM含两段文本，最后一块恰为</body></html>，验证postamble延后到所有任务完成。 */
  it('holds back body and html closing tags (the postamble) until all pending tasks are completed', async () => {
    const chunks = [];
    writable.on('data', chunk => {
      chunks.push(chunk);
    });

    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <head />
          <body>
            first
            <Suspense>
              <AsyncText text="second" />
            </Suspense>
          </body>
        </html>,
      );
      pipe(writable);
    });

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>{'first'}</body>
      </html>,
    );

    await act(() => {
      resolveText('second');
    });

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>
          {'first'}
          {'second'}
        </body>
      </html>,
    );

    expect(chunks.pop()).toEqual('</body></html>');
  });

  describe('text separators', () => {
    // 为了让 performWork 在 resolve AsyncText 前、且在 pipe 前启动，需要等到 scheduleWork 之后；
    // scheduleWork 当前通过 setImmediate 延迟 performWork。
    /**
     * 等待一次setImmediate，使服务器已开始工作而尚未pipe；测试随后先完成部分文本再flush。
     * @returns 下一次immediate完成的promise。
     */
    function afterImmediate() {
      return new Promise(resolve => {
        setImmediate(resolve);
      });
    }

    /** 同步输出hello/b内world,与Foo/!；原始HTML仅相邻文本world,与Foo之间有分隔注释。随后hydrate无错误并保留可见内容，验证文本分隔符位置。 */
    it('only includes separators between adjacent text nodes', async () => {
      /**
       * 用b边界隔开hello/!，只让world,与name成为相邻文本，检查同步分隔符位置。
       * @param name 动态文本Foo。
       * @returns 文本树。
       */
      function App({name}) {
        return (
          <div>
            hello<b>world, {name}</b>!
          </div>
        );
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App name="Foo" />);
        pipe(writable);
      });

      expect(container.innerHTML).toEqual(
        (gate(flags => flags.shouldUseFizzExternalRuntime)
          ? '<script src="react-dom-bindings/src/server/ReactDOMServerExternalRuntime.js" async=""></script>'
          : '') + '<div>hello<b>world, <!-- -->Foo</b>!</div>',
      );
      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App name="Foo" />, {
        /**
         * 收集同步相邻文本的hydration恢复错误，预期输出保持一致且数组为空。
         * @param error 恢复错误。
         */
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(container)).toEqual(
        <div>
          hello<b>world, {'Foo'}</b>!
        </div>,
      );
    });

    /** 已flush的b内末段Foo暂停，先断言template占位；完成后原始HTML无分隔注释但b有两个独立Text节点，hydrate无错误，验证补丁插入本身保留文本节点边界。 */
    it('does not insert text separators even when adjacent text is in a delayed segment', async () => {
      /**
       * b中world,之后放异步name，末尾!在外层；观察已flush父节点内template被独立Text补丁替换。
       * @param name 异步文本键。
       * @returns 暂停文本树。
       */
      function App({name}) {
        return (
          <div>
            <Suspense fallback={'loading...'}>
              <div id="app-div">
                hello
                <b>
                  world, <AsyncText text={name} />
                </b>
                !
              </div>
            </Suspense>
          </div>
        );
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App name="Foo" />);
        pipe(writable);
      });

      expect(document.getElementById('app-div').outerHTML).toEqual(
        '<div id="app-div">hello<b>world, <template id="P:1"></template></b>!</div>',
      );

      await act(() => resolveText('Foo'));

      const div = stripExternalRuntimeInNodes(
        container.children,
        renderOptions.unstable_externalRuntimeSrc,
      )[0].children[0];
      expect(div.outerHTML).toEqual(
        '<div id="app-div">hello<b>world, Foo</b>!</div>',
      );

      expect(div.childNodes.length).toBe(3);
      const b = div.childNodes[1];
      expect(b.childNodes.length).toBe(2);
      expect(b.childNodes[0]).toMatchInlineSnapshot('world, ');
      expect(b.childNodes[1]).toMatchInlineSnapshot('Foo');

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App name="Foo" />, {
        /**
         * 收集延迟文本补丁的hydration恢复错误，预期输出保持一致且数组为空。
         * @param error 恢复错误。
         */
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(container)).toEqual(
        <div>
          <div id="app-div">
            hello<b>world, {'Foo'}</b>!
          </div>
        </div>,
      );
    });

    /** h/ello/w/orld形成两个异步segment，先完成orld再ello；逐步断言template被替换与最终helloworld原始HTML，hydrate仍无错误，验证乱序补丁恢复多个相邻文本节点。 */
    it('works with multiple adjacent segments', async () => {
      /**
       * 在同一div中交替放h、异步ello、w、异步orld，生成两个可乱序完成的相邻segment。
       * @returns 双文本segment树。
       */
      function App() {
        return (
          <div>
            <Suspense fallback={'loading...'}>
              <div id="app-div">
                h<AsyncText text={'ello'} />
                w<AsyncText text={'orld'} />
              </div>
            </Suspense>
          </div>
        );
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });

      expect(document.getElementById('app-div').outerHTML).toEqual(
        '<div id="app-div">h<template id="P:1"></template>w<template id="P:2"></template></div>',
      );

      await act(() => resolveText('orld'));

      expect(document.getElementById('app-div').outerHTML).toEqual(
        '<div id="app-div">h<template id="P:1"></template>world</div>',
      );

      await act(() => resolveText('ello'));
      expect(
        stripExternalRuntimeInNodes(
          container.children,
          renderOptions.unstable_externalRuntimeSrc,
        )[0].children[0].outerHTML,
      ).toEqual('<div id="app-div">helloworld</div>');

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App name="Foo" />, {
        /**
         * 收集乱序相邻segment的hydration恢复错误，预期输出保持一致且数组为空。
         * @param error 恢复错误。
         */
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(container)).toEqual(
        <div>
          <div id="app-div">{['h', 'ello', 'w', 'orld']}</div>
        </div>,
      );
    });

    /** pipe前先完成ello，orld仍待补丁；断言初始h/ello/w之间有分隔注释与一个template，完成后world补丁不增加分隔注释，hydrate无错误，覆盖直接flush与补丁混合。 */
    it('works when some segments are flushed and others are patched', async () => {
      /**
       * 交替输出h/ello/w/orld，配合pipe前只完成ello，比较直接flush文本分隔与后续补丁。
       * @returns 混合flush树。
       */
      function App() {
        return (
          <div>
            <Suspense fallback={'loading...'}>
              <div id="app-div">
                h<AsyncText text={'ello'} />
                w<AsyncText text={'orld'} />
              </div>
            </Suspense>
          </div>
        );
      }

      await act(async () => {
        const {pipe} = renderToPipeableStream(<App />);
        await afterImmediate();
        await act(() => resolveText('ello'));
        pipe(writable);
      });

      expect(document.getElementById('app-div').outerHTML).toEqual(
        '<div id="app-div">h<!-- -->ello<!-- -->w<template id="P:1"></template></div>',
      );

      await act(() => resolveText('orld'));

      expect(
        stripExternalRuntimeInNodes(
          container.children,
          renderOptions.unstable_externalRuntimeSrc,
        )[0].children[0].outerHTML,
      ).toEqual('<div id="app-div">h<!-- -->ello<!-- -->world</div>');

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App />, {
        /**
         * 保存恢复错误首句并在存在时记录cause，验证混合flush与补丁文本能无错误hydrate。
         * @param error 恢复错误。
         */
        onRecoverableError(error) {
          errors.push('onRecoverableError: ' + normalizeError(error.message));
          if (error.cause) {
            Scheduler.log('Cause: ' + normalizeError(error.cause.message));
          }
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(container)).toEqual(
        <div>
          <div id="app-div">{['h', 'ello', 'w', 'orld']}</div>
        </div>,
      );
    });

    /** 暂停文本world位于b内，pipe前先完成；断言没有前置分隔符但保留尾部注释，hydrate无错误，覆盖segment前方是元素边界的路径。 */
    it('does not prepend a text separators if the segment follows a non-Text Node', async () => {
      /**
       * 把world暂停放进b元素，让segment前方为非文本边界，检查没有前置分隔注释。
       * @returns b内文本树。
       */
      function App() {
        return (
          <Suspense fallback={'loading...'}>
            <div>
              hello
              <b>
                <AsyncText text={'world'} />
              </b>
            </div>
          </Suspense>
        );
      }

      await act(async () => {
        const {pipe} = renderToPipeableStream(<App />);
        await afterImmediate();
        await act(() => resolveText('world'));
        pipe(writable);
      });

      expect(container.lastElementChild.outerHTML).toEqual(
        '<div>hello<b>world<!-- --></b></div>',
      );

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App />, {
        /**
         * 收集元素之后的文本segment的hydration恢复错误，预期输出保持一致且数组为空。
         * @param error 恢复错误。
         */
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(container)).toEqual(
        <div>
          hello<b>world</b>
        </div>,
      );
    });

    /** 暂停组件完成后首次输出为b元素而非Text；pipe前完成world，断言hello<b>world</b>无分隔注释并成功hydrate，验证segment首输出为元素时无需文本分隔。 */
    it('does not prepend a text separators if the segments first emission is a non-Text Node', async () => {
      /**
       * 异步完成后输出b包装的world，使segment首节点是元素而非Text。
       * @returns 包装元素树。
       */
      function App() {
        return (
          <Suspense fallback={'loading...'}>
            <div>
              hello
              <AsyncTextWrapped as={'b'} text={'world'} />
            </div>
          </Suspense>
        );
      }

      await act(async () => {
        const {pipe} = renderToPipeableStream(<App />);
        await afterImmediate();
        await act(() => resolveText('world'));
        pipe(writable);
      });

      expect(container.lastElementChild.outerHTML).toEqual(
        '<div>hello<b>world</b></div>',
      );

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App />, {
        /**
         * 收集首输出为元素的segment的hydration恢复错误，预期输出保持一致且数组为空。
         * @param error 恢复错误。
         */
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(container)).toEqual(
        <div>
          hello<b>world</b>
        </div>,
      );
    });

    /** 外层start/end之间两个Suspense分别含异步文本；先完成first、hydration时第二仍fallback，再完成second。逐步断言边界标记及内部文本无额外分隔且errors为空；预先完成world键未被本树读取。 */
    it('should not insert separators for text inside Suspense boundaries even if they would otherwise be considered text-embedded', async () => {
      /**
       * start/end之间放两条嵌套Suspense，第一条纯文本前后夹异步文本，第二条用b包异步文本，检查边界内部不追加分隔符。
       * @returns 两边界文本树。
       */
      function App() {
        return (
          <Suspense fallback={'loading...'}>
            <div id="app-div">
              start
              <Suspense fallback={'[loading first]'}>
                firststart
                <AsyncText text={'first suspended'} />
                firstend
              </Suspense>
              <Suspense fallback={'[loading second]'}>
                secondstart
                <b>
                  <AsyncText text={'second suspended'} />
                </b>
              </Suspense>
              end
            </div>
          </Suspense>
        );
      }

      await act(async () => {
        const {pipe} = renderToPipeableStream(<App />);
        await afterImmediate();
        await act(() => resolveText('world'));
        pipe(writable);
      });

      expect(document.getElementById('app-div').outerHTML).toEqual(
        '<div id="app-div">start<!--$?--><template id="B:0"></template>[loading first]<!--/$--><!--$?--><template id="B:1"></template>[loading second]<!--/$-->end</div>',
      );

      await act(() => {
        resolveText('first suspended');
      });

      expect(document.getElementById('app-div').outerHTML).toEqual(
        '<div id="app-div">start<!--$-->firststartfirst suspendedfirstend<!--/$--><!--$?--><template id="B:1"></template>[loading second]<!--/$-->end</div>',
      );

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App />, {
        /**
         * 收集嵌套边界文本的hydration恢复错误，预期输出保持一致且数组为空。
         * @param error 恢复错误。
         */
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(container)).toEqual(
        <div id="app-div">
          {'start'}
          {'firststart'}
          {'first suspended'}
          {'firstend'}
          {'[loading second]'}
          {'end'}
        </div>,
      );

      await act(() => {
        resolveText('second suspended');
      });

      expect(
        stripExternalRuntimeInNodes(
          container.children,
          renderOptions.unstable_externalRuntimeSrc,
        )[0].outerHTML,
      ).toEqual(
        '<div id="app-div">start<!--$-->firststartfirst suspendedfirstend<!--/$--><!--$-->secondstart<b>second suspended</b><!--/$-->end</div>',
      );

      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(container)).toEqual(
        <div id="app-div">
          {'start'}
          {'firststart'}
          {'first suspended'}
          {'firstend'}
          {'secondstart'}
          <b>second suspended</b>
          {'end'}
        </div>,
      );
    });

    /** 四个边界组合文本前缀有无、尾随br有无，在pipe前都完成world。断言各异步文本后保留冗余分隔注释，之后hydrate无错误，记录当前预完成segment的尾部分隔行为。 */
    it('(only) includes extraneous text separators in segments that complete before flushing, followed by nothing or a non-Text node', async () => {
      /**
       * 构造四种异步world的前后邻居组合：hello前缀有无、br尾随有无，观察pipe前完成时的冗余尾分隔。
       * @returns 四边界树。
       */
      function App() {
        return (
          <div>
            <Suspense fallback={'text before, nothing after...'}>
              hello
              <AsyncText text="world" />
            </Suspense>
            <Suspense fallback={'nothing before or after...'}>
              <AsyncText text="world" />
            </Suspense>
            <Suspense fallback={'text before, element after...'}>
              hello
              <AsyncText text="world" />
              <br />
            </Suspense>
            <Suspense fallback={'nothing before, element after...'}>
              <AsyncText text="world" />
              <br />
            </Suspense>
          </div>
        );
      }

      await act(async () => {
        const {pipe} = renderToPipeableStream(<App />);
        await afterImmediate();
        await act(() => resolveText('world'));
        pipe(writable);
      });

      expect(container.innerHTML).toEqual(
        (gate(flags => flags.shouldUseFizzExternalRuntime)
          ? '<script src="react-dom-bindings/src/server/ReactDOMServerExternalRuntime.js" async=""></script>'
          : '') +
          '<div><!--$-->hello<!-- -->world<!-- --><!--/$--><!--$-->world<!-- --><!--/$--><!--$-->hello<!-- -->world<!-- --><br><!--/$--><!--$-->world<!-- --><br><!--/$--></div>',
      );

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App />, {
        /**
         * 收集冗余尾分隔符的hydration恢复错误，预期输出保持一致且数组为空。
         * @param error 恢复错误。
         */
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(container)).toEqual(
        <div>
          {/* 第一个边界 */}
          {'hello'}
          {'world'}
          {/* 第二边界 */}
          {'world'}
          {/* 第三层边界 */}
          {'hello'}
          {'world'}
          <br />
          {/* 第四边界 */}
          {'world'}
          <br />
        </div>,
      );
    });
  });

  describe('title children', () => {
    /** title以单个字符串hello作为children，服务器与hydrate后均显示hello且无恢复错误，验证允许的单字符串输入。 */
    it('should accept a single string child', async () => {
      // 一个单字符串子节点
      /**
       * 输出title的单字符串hello；服务器与客户端共用相同树以检查可接受输入。
       * @returns head/title。
       */
      function App() {
        return (
          <head>
            <title>hello</title>
          </head>
        );
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });
      expect(getVisibleChildren(document.head)).toEqual(<title>hello</title>);

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App />, {
        /**
         * 收集单字符串title的hydration恢复错误，预期输出保持一致且数组为空。
         * @param error 恢复错误。
         */
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(document.head)).toEqual(<title>hello</title>);
    });

    /** 标题称number，但实际JSX children是字符串4；服务器与hydrate后title均为4且无错误，本定义只验证该字符串，未传入数值类型。 */
    it('should accept a single number child', async () => {
      // 一个单个子节点
      /**
       * 输出title的字符串4；虽测试标题称number，此JSX未使用数值表达式。
       * @returns head/title。
       */
      function App() {
        return (
          <head>
            <title>4</title>
          </head>
        );
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });
      expect(getVisibleChildren(document.head)).toEqual(<title>4</title>);

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App />, {
        /**
         * 收集字符串4 title的hydration恢复错误，预期输出保持一致且数组为空。
         * @param error 恢复错误。
         */
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(document.head)).toEqual(<title>4</title>);
    });

    /** 标题称bigint，但实际JSX children是字符串5n；服务器与hydrate后title均为5n且无错误，本定义未传入bigint类型。 */
    it('should accept a single bigint child', async () => {
      // 一个单个子节点
      /**
       * 输出title的字符串5n；虽测试标题称bigint，此JSX未使用bigint表达式。
       * @returns head/title。
       */
      function App() {
        return (
          <head>
            <title>5n</title>
          </head>
        );
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });
      expect(getVisibleChildren(document.head)).toEqual(<title>5n</title>);

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App />, {
        /**
         * 收集字符串5n title的hydration恢复错误，预期输出保持一致且数组为空。
         * @param error 恢复错误。
         */
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(document.head)).toEqual(<title>5n</title>);
    });

    /** title children为长度1的字符串数组[hello]；服务器与hydrate后均显示hello且无错误，验证单项数组可转为标题文本。 */
    it('should accept children array of length 1 containing a string', async () => {
      // 一个单字符串子节点
      /**
       * 输出title的单项字符串数组[hello]，检查其转换为一个标题字符串。
       * @returns head/title。
       */
      function App() {
        return (
          <head>
            <title>{['hello']}</title>
          </head>
        );
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });
      expect(getVisibleChildren(document.head)).toEqual(<title>hello</title>);

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App />, {
        /**
         * 收集单项数组title的hydration恢复错误，预期输出保持一致且数组为空。
         * @param error 恢复错误。
         */
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(document.head)).toEqual(<title>hello</title>);
    });

    /** title children为两个字符串的数组，DEV断言不支持多项数组的警告；服务器输出空title，hydrate仍为空且无恢复错误，记录非法输入的当前输出。 */
    it('should warn in dev when given an array of length 2 or more', async () => {
      /**
       * 把两项字符串数组传给title，故意触发DEV不支持多项children的警告并观察空输出。
       * @returns 非法title树。
       */
      function App() {
        return (
          <head>
            <title>{['hello1', 'hello2']}</title>
          </head>
        );
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });
      assertConsoleErrorDev([
        'React expects the `children` prop of <title> tags to be a string, number, bigint, ' +
          'or object with a novel `toString` method but found an Array with length 2 instead. ' +
          'Browsers treat all child Nodes of <title> tags as Text content and React expects ' +
          'to be able to convert `children` of <title> tags to a single string value which is why ' +
          'Arrays of length greater than 1 are not supported. ' +
          'When using JSX it can be common to combine text nodes and value nodes. ' +
          'For example: <title>hello {nameOfUser}</title>. ' +
          'While not immediately apparent, `children` in this case is an Array with length 2. ' +
          'If your `children` prop is using this form try rewriting it using a template string: ' +
          '<title>{`hello ${nameOfUser}`}</title>.\n' +
          '    in title (at **)\n' +
          '    in App (at **)',
      ]);

      expect(getVisibleChildren(document.head)).toEqual(<title />);
      const errors = [];
      ReactDOMClient.hydrateRoot(document.head, <App />, {
        /**
         * 收集多项数组空title的hydration恢复错误，预期输出保持一致且数组为空。
         * @param error 恢复错误。
         */
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      // title 的子节点是对象；服务器不会输出该内容，hydration 也保留这个空 title。
      expect(getVisibleChildren(document.head)).toEqual(<title />);
    });

    /** title中直接放IndirectTitle React元素；DEV警告不支持元素children，服务器与hydrate均为[object Object]且无恢复错误，验证其被转为对象字符串而非执行组件得到hello。 */
    it('should warn in dev if you pass a React Component as a child to <title>', async () => {
      /**
       * 若作为组件执行会返回hello，但本例将其元素直接传给title，结果是对象字符串而非调用该组件。
       * @returns hello。
       */
      function IndirectTitle() {
        return 'hello';
      }

      /**
       * 直接把IndirectTitle React元素置于title children，触发DEV警告并输出[object Object]。
       * @returns 非法元素title树。
       */
      function App() {
        return (
          <head>
            <title>
              <IndirectTitle />
            </title>
          </head>
        );
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });
      assertConsoleErrorDev([
        'React expects the `children` prop of <title> tags to be a string, number, bigint, ' +
          'or object with a novel `toString` method but found an object that appears to be a ' +
          'React element which never implements a suitable `toString` method. ' +
          'Browsers treat all child Nodes of <title> tags as Text content and React expects ' +
          'to be able to convert children of <title> tags to a single string value which is ' +
          'why rendering React elements is not supported. If the `children` of <title> is a ' +
          'React Component try moving the <title> tag into that component. ' +
          'If the `children` of <title> is some HTML markup change it to be Text only to be valid HTML.\n' +
          '    in title (at **)\n' +
          '    in App (at **)',
      ]);
      // 本例对象形式的title经默认toString输出[object Object]，没有执行子组件。
      expect(getVisibleChildren(document.head)).toEqual(
        <title>{'[object Object]'}</title>,
      );
      const errors = [];
      ReactDOMClient.hydrateRoot(document.head, <App />, {
        /**
         * 收集React元素title的hydration恢复错误，预期输出保持一致且数组为空。
         * @param error 恢复错误。
         */
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      // 本例对象形式的title经默认toString输出[object Object]，没有执行子组件。
      expect(getVisibleChildren(document.head)).toEqual(
        <title>{'[object Object]'}</title>,
      );
    });

    /** title children为空对象{}，DEV警告没有合适toString；服务器与hydrate均为[object Object]且无恢复错误，记录默认对象字符串行为。 */
    it('should warn in dev if you pass an object that does not implement toString as a child to <title>', async () => {
      /**
       * 把空对象置于title children，触发默认toString警告并观察对象字符串输出。
       * @returns 对象title树。
       */
      function App() {
        return (
          <head>
            <title>{{}}</title>
          </head>
        );
      }

      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });
      assertConsoleErrorDev([
        'React expects the `children` prop of <title> tags to be a string, number, bigint, ' +
          'or object with a novel `toString` method but found an object that does not implement a ' +
          'suitable `toString` method. Browsers treat all child Nodes of <title> tags as Text ' +
          'content and React expects to be able to convert children of <title> tags to a single string value. ' +
          'Using the default `toString` method available on every object is almost certainly an error. ' +
          'Consider whether the `children` of this <title> is an object in error and change it to a ' +
          'string or number value if so. Otherwise implement a `toString` method that React can ' +
          'use to produce a valid <title>.\n' +
          '    in title (at **)\n' +
          '    in App (at **)',
      ]);
      // 本例对象形式的title经默认toString输出[object Object]，没有执行子组件。
      expect(getVisibleChildren(document.head)).toEqual(
        <title>{'[object Object]'}</title>,
      );
      const errors = [];
      ReactDOMClient.hydrateRoot(document.head, <App />, {
        /**
         * 收集普通对象title的hydration恢复错误，预期输出保持一致且数组为空。
         * @param error 恢复错误。
         */
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      // 本例对象形式的title经默认toString输出[object Object]，没有执行子组件。
      expect(getVisibleChildren(document.head)).toEqual(
        <title>{'[object Object]'}</title>,
      );
    });
  });

  /** Async连续use已resolve的A/B/C promise，本地act需显式分轮await三项推进重试。服务器最终ABC，客户端hydrate后仍ABC，验证use(promise)串联读取。 */
  it('basic use(promise)', async () => {
    const promiseA = Promise.resolve('A');
    const promiseB = Promise.resolve('B');
    const promiseC = Promise.resolve('C');

    /**
     * 依次use三个promise并连接A/B/C；未就绪项使任务暂停，重试逐项推进读取。
     * @returns ABC。
     * @throws 未完成promise的暂停信号。
     */
    function Async() {
      return use(promiseA) + use(promiseB) + use(promiseC);
    }

    /**
     * 用Loading...的Suspense包裹Async，使promise串联暂停可先输出fallback。
     * @returns promise读取测试树。
     */
    function App() {
      return (
        <Suspense fallback="Loading...">
          <Async />
        </Suspense>
      );
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });

    // TODO：本文件的 `act` 不会自动展开微任务，不能复用 Fiber 测试所用的 `act`，因为后者依赖
    // mock Scheduler；这里需显式等待 Promise，让服务端重试有机会运行。
    //
    // 目前按顺序等待每个 Promise。
    await act(async () => {
      await promiseA;
    });
    await act(async () => {
      await promiseB;
    });
    await act(async () => {
      await promiseC;
    });

    expect(getVisibleChildren(container)).toEqual('ABC');

    ReactDOMClient.hydrateRoot(container, <App />);
    await waitForAll([]);
    expect(getVisibleChildren(container)).toEqual('ABC');
  });

  /** use直接读取ContextA provider值A与ContextB默认B，服务器输出AB；重置A的_currentRenderer避免测试多renderer警告，再hydrate并断言AB，验证Fizz/Fiber都支持use(context)。 */
  it('basic use(context)', async () => {
    const ContextA = React.createContext('default');
    const ContextB = React.createContext('B');
    /**
     * use读取ContextA与ContextB并连接，观察provider值A和默认B。
     * @returns AB。
     */
    function Client() {
      return use(ContextA) + use(ContextB);
    }
    /**
     * 将Client置于ContextA的A provider内，B使用默认值，服务器与客户端共享树。
     * @returns context读取树。
     */
    function App() {
      return (
        <>
          <ContextA.Provider value="A">
            <Client />
          </ContextA.Provider>
        </>
      );
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual('AB');

      // Hydration 使用不同的渲染运行时（Fiber 而非 Fizz）。这里重置 _currentRenderer，避免多个
      // renderer 并发使用这些 context 时触发警告。
    ContextA._currentRenderer = null;
    ReactDOMClient.hydrateRoot(container, <App />);
    await waitForAll([]);
    expect(getVisibleChildren(container)).toEqual('AB');
  });

  /** Parent用A/B promise拼前缀，Child再用C/D；逐轮显式await四项后服务器与hydrate均ABCD，验证不同组件各自的use位置和暂停重试不串值。 */
  it('use(promise) in multiple components', async () => {
    const promiseA = Promise.resolve('A');
    const promiseB = Promise.resolve('B');
    const promiseC = Promise.resolve('C');
    const promiseD = Promise.resolve('D');

    /**
     * 接收父组件拼出的prefix，再use C/D promise连接；每个promise完成前可暂停该组件。
     * @param prefix 父组件A/B读取结果。
     * @returns ABCD。
     */
    function Child({prefix}) {
      return prefix + use(promiseC) + use(promiseD);
    }

    /**
     * 用A/B promise拼前缀后传给Child，将use位置分散于父子组件。
     * @returns Child元素。
     */
    function Parent() {
      return <Child prefix={use(promiseA) + use(promiseB)} />;
    }

    /**
     * 以Loading...包裹Parent，允许跨组件的promise读取逐步恢复。
     * @returns Suspense树。
     */
    function App() {
      return (
        <Suspense fallback="Loading...">
          <Parent />
        </Suspense>
      );
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });

    // TODO：本文件的 `act` 不会自动展开微任务，不能复用 Fiber 测试所用的 `act`，因为后者依赖
    // mock Scheduler；这里需显式等待 Promise，让服务端重试有机会运行。
    //
    // 目前按顺序等待每个 Promise。
    await act(async () => {
      await promiseA;
    });
    await act(async () => {
      await promiseB;
    });
    await act(async () => {
      await promiseC;
    });
    await act(async () => {
      await promiseD;
    });

    expect(getVisibleChildren(container)).toEqual('ABCD');

    ReactDOMClient.hydrateRoot(container, <App />);
    await waitForAll([]);
    expect(getVisibleChildren(container)).toEqual('ABCD');
  });

  /** use读A、拒绝Oops!的B及C；先观察拒绝避免环境未处理警告，服务器onError一次且保留Loading。客户端ErrorBoundary捕获同一错误显示Oops!，onCaughtError一次、onRecoverableError零次，验证拒绝不是成功恢复。 */
  it('using a rejected promise will throw', async () => {
    const promiseA = Promise.resolve('A');
    const promiseB = Promise.reject(new Error('Oops!'));
    const promiseC = Promise.resolve('C');

    // 先观察这个已拒绝的 Promise，避免 React 安装订阅之前被测试环境报告为未处理的 rejection。
    await expect(promiseB).rejects.toThrow('Oops!');

    /**
     * 顺序use A/B/C，B拒绝时抛Oops!而不能返回完整文本。
     * @returns 全部成功时的连接文本。
     * @throws B的拒绝错误或暂停信号。
     */
    function Async() {
      return use(promiseA) + use(promiseB) + use(promiseC);
    }

    /** 客户端错误边界保存use拒绝错误并显示message；服务器ErrorBoundary不捕获此类错误。 */
    class ErrorBoundary extends React.Component {
      /** 初始error为空，成功时透传children，捕获时由派生state填入。 */
      state = {error: null};
      /**
       * 将use拒绝错误存入state.error。
       * @param error 捕获错误。
       * @returns error状态片段。
       */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /**
       * 有error时显示message，否则返回children，本例客户端最终Oops!。
       * @returns 错误文本或children。
       */
      render() {
        if (this.state.error) {
          return this.state.error.message;
        }
        return this.props.children;
      }
    }

    /**
     * 把ErrorBoundary置于Suspense内部，比较服务器fallback与客户端错误边界输出。
     * @returns 拒绝promise测试树。
     */
    function App() {
      return (
        <div>
          <Suspense fallback="Loading...">
            <ErrorBoundary>
              <Async />
            </ErrorBoundary>
          </Suspense>
        </div>
      );
    }

    const reportedServerErrors = [];
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />, {
        /**
         * 保存服务器use拒绝错误对象，断言一次Oops!。
         * @param error 服务器错误。
         */
        onError(error) {
          reportedServerErrors.push(error);
        },
      });
      pipe(writable);
    });

    // TODO：本文件的 `act` 不会自动展开微任务，不能复用 Fiber 测试所用的 `act`，因为后者依赖
    // mock Scheduler；这里需显式等待 Promise，让服务端重试有机会运行。
    //
    // 目前按顺序等待每个 Promise。
    await act(async () => {
      await promiseA;
    });
    await act(async () => {
      await expect(promiseB).rejects.toThrow('Oops!');
    });
    await act(async () => {
      await promiseC;
    });

    expect(getVisibleChildren(container)).toEqual(<div>Loading...</div>);
    expect(reportedServerErrors.length).toBe(1);
    expect(reportedServerErrors[0].message).toBe('Oops!');

    const reportedCaughtErrors = [];
    const reportedClientErrors = [];
    ReactDOMClient.hydrateRoot(container, <App />, {
      /**
       * 保存客户端ErrorBoundary捕获的错误对象，断言一次Oops!。
       * @param error 已捕获错误。
       */
      onCaughtError(error) {
        reportedCaughtErrors.push(error);
      },
      /**
       * 保存可恢复错误；客户端重试仍抛相同错误，本例预期没有成功恢复报告。
       * @param error 恢复错误。
       */
      onRecoverableError(error) {
        reportedClientErrors.push(error);
      },
    });
    await waitForAll([]);
    expect(getVisibleChildren(container)).toEqual(<div>Oops!</div>);
      // 此错误会在客户端重新抛出，因此不是可恢复错误。
    expect(reportedClientErrors.length).toBe(0);
    // 该错误会被错误边界捕获。
    expect(reportedCaughtErrors.length).toBe(1);
    expect(reportedCaughtErrors[0].message).toBe('Oops!');
  });

  /** thenable已带fulfilled状态与Hi值、then为空；服务器与hydrate均直接Hi，验证已被instrument的完成值可直接解包而不暂停。 */
  it("use a promise that's already been instrumented and resolved", async () => {
    const thenable = {
      status: 'fulfilled',
      value: 'Hi',
      /** 已fulfilled thenable的空then方法；use直接读status/value，不靠此方法完成。 */
      then() {},
    };

    // thenable 已经 resolve，因此这里永远不会 suspend。
    /**
     * 直接use已有fulfilled/Hi字段的thenable，验证同步读取已instrument结果。
     * @returns Hi。
     */
    function App() {
      return use(thenable);
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual('Hi');

    ReactDOMClient.hydrateRoot(container, <App />);
    await waitForAll([]);
    expect(getVisibleChildren(container)).toEqual('Hi');
  });

  /** thenable.then同步resolve Hi，App用try/catch将任何暂停转成测试错误；最终Hi证明同步完成可直接解包，本例不显示fallback。 */
  it('unwraps thenable that fulfills synchronously without suspending', async () => {
    /**
     * 创建同步resolve Hi的thenable并在try内use；若发生暂停则转成明确Error，使测试失败可见。
     * @returns Text Hi。
     * @throws 意外暂停时的测试错误。
     */
    function App() {
      const thenable = {
        /**
         * 立即调用resolve(Hi)，不等待微任务；允许use在当前调用中读到fulfilled值。
         * @param resolve thenable完成回调。
         */
        then(resolve) {
          // 此 thenable 会立即同步 resolve，不等待微任务。
          resolve('Hi');
        },
      };
      try {
        return <Text text={use(thenable)} />;
      } catch {
        throw new Error(
          '`use` should not suspend because the thenable resolved synchronously.',
        );
      }
    }
    // thenable 会同步 resolve，因此应能同步完成渲染，不显示 fallback。
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual('Hi');
  });

  // 回归场景：finishedTask 中止已完成边界里的剩余 fallback 任务时，可能经 abortTaskSoft 重入自身，
  // 导致 onAllReady 触发两次。内层调用把 allPendingTasks 清到 0 并调用 completeAll，外层调用随后又
  // 观察到同一个 0。
  /** 构造status=pending且第一次then不完成、后续then同步完成hello的thenable，令fallback任务收尾重入完成路径。断言最终hello及onAllReady恰一次，覆盖同步ping导致的重复完成回归。 */
  it('only fires onAllReady once when a boundary with an instrumented sync-resolving thenable completes', async () => {
    // 模拟 Flight 客户端 chunk：trackUsedThenable 中探测 status 的 .then() 始终 pending，
    // 但 renderNode 的 catch 中用于挂接 ping 的 .then() 会同步 resolve。这会重排工作队列，使内容任务
    // 完成时，fallback 任务仍留在 fallbackAbortableTasks 中。
    /**
     * 创建第一次then保持pending、第二次及以后同步完成的thenable，模拟状态探测订阅与ping订阅之间的差异。
     * @param value 后续完成值。
     * @returns 带状态字段的thenable。
     */
    function createDeferredSyncThenable(value) {
      let thenCallCount = 0;
      return {
        status: 'pending',
        value: undefined,
        /**
         * 累加then调用次数，首调用不完成，后续先写fulfilled/value再同步resolve；通过this修改返回的同一个thenable。
         * @param resolve 完成回调。
         */
        then(resolve) {
          thenCallCount++;
          if (thenCallCount > 1) {
            this.status = 'fulfilled';
            this.value = value;
            resolve(value);
          }
        },
      };
    }

    const thenable = createDeferredSyncThenable('hello');
    /**
     * use特殊同步完成thenable并输出Text，触发内容完成时仍有fallback任务的收尾路径。
     * @returns Text hello。
     */
    function AsyncContent() {
      return <Text text={use(thenable)} />;
    }

    let allReadyCount = 0;
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <Suspense fallback={<Text text="Loading..." />}>
          <AsyncContent />
        </Suspense>,
        {
          /** 累加全部就绪通知次数，测试断言重入完成路径也只能调用一次。 */
          onAllReady() {
            allReadyCount++;
          },
        },
      );
      pipe(writable);
    });

    expect(allReadyCount).toBe(1);
    expect(getVisibleChildren(container)).toEqual('hello');
  });

  // 同一 bug 无需同步 thenable 技巧也可触发：若 fallback 也 suspend，其子任务会留在
  // fallbackAbortableTasks 中运行，并且可能在内容任务完成之前仍然存在。
  /** 主内容与fallback均use真实promise暂停，fallback永不完成；只完成内容hello后断言显示hello、onAllReady恰一次，验证废弃fallback任务时不会重复通知全部就绪。 */
  it('only fires onAllReady once when both content and fallback suspend on real promises', async () => {
    let resolveContent;
    const contentPromise = new Promise(r => (resolveContent = r));
    // fallback promise 从不解决 — fallback-sub-task 在内容完成时被软终止。 所以，我们永远不会需要
    // 它。
    const fallbackPromise = new Promise(() => {});

    /**
     * use外部可完成的contentPromise并输出Text；完成主内容会废弃仍暂停的fallback任务。
     * @returns 内容Text。
     * @throws 暂停信号。
     */
    function AsyncContent() {
      return <Text text={use(contentPromise)} />;
    }
    /**
     * use永不完成的fallbackPromise，使fallback本身仍持有暂停子任务。
     * @returns 正常完成时Text，本例不完成。
     * @throws 暂停信号。
     */
    function AsyncFallback() {
      return <Text text={use(fallbackPromise)} />;
    }

    let allReadyCount = 0;
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <Suspense fallback={<AsyncFallback />}>
          <AsyncContent />
        </Suspense>,
        {
          /** 累加全部就绪通知次数，验证只完成内容即可收尾且不重复通知。 */
          onAllReady() {
            allReadyCount++;
          },
        },
      );
      pipe(writable);
    });

    // 只 resolve 内容即可：内容任务完成时，fallback 子任务仍在 fallbackAbortableTasks 中；
    // 对它调用 abortTaskSoft 会重入 finishedTask。
    await act(async () => {
      resolveContent('hello');
      await contentPromise;
    });

    expect(allReadyCount).toBe(1);
    expect(getVisibleChildren(container)).toEqual('hello');
  });

  /** 把resolve Hi的promise直接作为根node，显式await推进服务器重试，最终可见Hi，验证promise节点解包。 */
  it('promise as node', async () => {
    const promise = Promise.resolve('Hi');
    await act(async () => {
      const {pipe} = renderToPipeableStream(promise);
      pipe(writable);
    });

    // TODO：本文件的 `act` 不会自动展开微任务，不能复用 Fiber 测试所用的 `act`，因为后者依赖
    // mock Scheduler；这里需显式等待 Promise，让服务端重试有机会运行。
    await act(async () => {
      await promise;
    });

    expect(getVisibleChildren(container)).toEqual('Hi');
  });

  /** 把默认值Hi的Context直接作为根node，服务器最终Hi，验证context节点解包。 */
  it('context as node', async () => {
    const Context = React.createContext('Hi');
    await act(async () => {
      const {pipe} = renderToPipeableStream(Context);
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual('Hi');
  });

  /** 把resolve为Context对象的promise直接作为根node，显式await后最终Hi，验证promise→context的递归Usable解包。 */
  it('recursive Usable as node', async () => {
    const Context = React.createContext('Hi');
    const promiseForContext = Promise.resolve(Context);
    await act(async () => {
      const {pipe} = renderToPipeableStream(promiseForContext);
      pipe(writable);
    });

    // TODO：本文件的 `act` 不会自动展开微任务，不能复用 Fiber 测试所用的 `act`，因为后者依赖
    // mock Scheduler；这里需显式等待 Promise，让服务端重试有机会运行。
    await act(async () => {
      await promiseForContext;
    });

    expect(getVisibleChildren(container)).toEqual('Hi');
  });

  /** Component1、lazy模块加载和Component2各缓存独立50ms promise；依次等待value1、lazy、value2完成，断言父子各获正确文本，验证lazy跨组件重试不复用错误的use promise位置。 */
  it('should correctly handle different promises in React.use() across lazy components', async () => {
    let promise1;
    let promise2;
    let promiseLazy;

    /**
     * 首次创建并缓存value1 promise，use后输出包含lazy子组件的div；缓存使重试保持同一promise。
     * @returns value1与lazy子树。
     * @throws 暂停信号。
     */
    function Component1() {
      promise1 ??= new Promise(r => setTimeout(() => r('value1'), 50));
      const data = React.use(promise1);
      return (
        <div>
          {data}
          <Component2Lazy />
        </div>
      );
    }

    /**
     * 首次创建并缓存独立value2 promise，use后输出子div，防止跨组件读取错值。
     * @returns value2 div。
     * @throws 暂停信号。
     */
    function Component2() {
      promise2 ??= new Promise(r => setTimeout(() => r('value2'), 50));
      const data = React.use(promise2);
      return <div>{data}</div>;
    }

    const Component2Lazy = React.lazy(async () => {
      promiseLazy ??= new Promise(r => setTimeout(r, 50));
      await promiseLazy;
      return {default: Component2};
    });

    /**
     * 返回Component1作为跨lazy边界的promise读取入口。
     * @returns Component1。
     */
    function App() {
      return <Component1 />;
    }

    await act(async () => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });

    // 等待 Promise 解析
    await act(async () => {
      await promise1;
    });
    await act(async () => {
      await promiseLazy;
    });
    await act(async () => {
      await promise2;
    });

    // 检查两个组件均获得了正确的值
    expect(getVisibleChildren(container)).toEqual(
      <div>
        value1
        <div>value2</div>
      </div>,
    );
  });

  /** Form以useActionState(action,0)输出Child:0，服务器流包含Hook标记与兄弟。hydration后ref与原child DOM相同，验证标记不破坏节点匹配；本例不提交action。 */
  it('useActionState hydrates without a mismatch', async () => {
    // 此测试覆盖实现细节：useActionState 会向 SSR 流发送注释节点，因此这里验证 hydration 期间
    // 能正确处理这些节点。

    /**
     * 异步action原样返回state；此例只初始化useActionState，不触发提交。
     * @param state 当前action状态。
     * @returns 原状态promise。
     */
    async function action(state) {
      return state;
    }

    const childRef = React.createRef(null);
    /**
     * 以action和初值0声明useActionState，在带ref的child div中输出Child:0，供hydration节点身份检查。
     * @returns child div。
     */
    function Form() {
      const [state] = useActionState(action, 0);
      const text = `Child: ${state}`;
      return (
        <div id="child" ref={childRef}>
          {text}
        </div>
      );
    }

    /**
     * 将Form放在额外div包裹内并添加Sibling span，检验Hook标记不会误占兄弟节点位置。
     * @returns action状态测试树。
     */
    function App() {
      return (
        <div>
          <div>
            <Form />
          </div>
          <span>Sibling</span>
        </div>
      );
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div>
          <div id="child">Child: 0</div>
        </div>
        <span>Sibling</span>
      </div>,
    );
    const child = document.getElementById('child');

    // 确认 hydration 正确完成。
    await clientAct(() => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    expect(childRef.current).toBe(child);
  });

  /** Form在render阶段将localState从0更新到3并读取暂停Child，useActionState初值0；完成后Child:0:3，hydrate ref复用原节点，验证重复求值及暂停后的Hook标记仍可匹配；未直接统计标记数量。 */
  it("useActionState hydrates without a mismatch if there's a render phase update", async () => {
    /**
     * 原样返回state的异步action；渲染阶段更新测试未调用该action。
     * @param state 当前状态。
     * @returns 原状态promise。
     */
    async function action(state) {
      return state;
    }

    const childRef = React.createRef(null);
    /**
     * render阶段将localState逐次增到3，声明useActionState初值0，再读Child键暂停；完成后输出Child:0:3并保留ref。
     * @returns child div。
     * @throws 未完成文本的thenable。
     */
    function Form() {
      const [localState, setLocalState] = React.useState(0);
      if (localState < 3) {
        setLocalState(localState + 1);
      }

      // 由于上面的渲染阶段更新，此组件会被多次求值（SSR 期间也是如此），但每个 useActionState 实例
      // 只应发出一个 marker。
      const [actionState] = useActionState(action, 0);
      const text = `${readText('Child')}:${actionState}:${localState}`;
      return (
        <div id="child" ref={childRef}>
          {text}
        </div>
      );
    }

    /**
     * 以Suspense包裹Form并添加Sibling，观察渲染阶段更新和暂停恢复后的Hook标记匹配。
     * @returns Form测试树。
     */
    function App() {
      return (
        <div>
          <Suspense fallback="Loading...">
            <Form />
          </Suspense>
          <span>Sibling</span>
        </div>
      );
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(
      <div>
        Loading...<span>Sibling</span>
      </div>,
    );

    await act(() => resolveText('Child'));
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div id="child">Child:0:3</div>
        <span>Sibling</span>
      </div>,
    );
    const child = document.getElementById('child');

    // 确认 hydration 正确完成。
    await clientAct(() => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    expect(childRef.current).toBe(child);
  });

  describe('useEffectEvent', () => {
    /** useEffectEvent包装计数更新，服务器与hydrate初始button0；派发真实冒泡click并跑定时器后button1，验证服务器声明EffectEvent及客户端事件使用。 */
    it('can server render a component with useEffectEvent', async () => {
      const ref = React.createRef();
      /**
       * 声明计数state与EffectEvent，由button事件包装调用它；服务器只声明不调用，客户端click将count加一。
       * @returns 带ref的计数button。
       */
      function App() {
        const [count, setCount] = React.useState(0);
        const onClick = React.useEffectEvent(() => {
          setCount(c => c + 1);
        });
        return (
          <button ref={ref} onClick={() => onClick()}>
            {count}
          </button>
        );
      }
      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });
      expect(getVisibleChildren(container)).toEqual(<button>0</button>);

      ReactDOMClient.hydrateRoot(container, <App />);
      await waitForAll([]);
      expect(getVisibleChildren(container)).toEqual(<button>0</button>);

      ref.current.dispatchEvent(
        new window.MouseEvent('click', {bubbles: true}),
      );
      await jest.runAllTimers();
      expect(getVisibleChildren(container)).toEqual(<button>1</button>);
    });

    /** 服务器渲染期间立即调用useEffectEvent返回函数，断言主体日志为空、捕获禁止渲染期调用的错误、onError收到同一对象，验证服务器阶段不执行事件实现。 */
    it('throws if useEffectEvent is called during a server render', async () => {
      const logs = [];
      /**
       * 声明记录rendered的EffectEvent并在render立即调用，故意触发服务器渲染期调用错误，不能到达p输出。
       * @returns 正常时p，本例先抛错。
       * @throws EffectEvent渲染期调用错误。
       */
      function App() {
        const onRender = React.useEffectEvent(() => {
          logs.push('rendered');
        });
        onRender();
        return <p>Hello</p>;
      }

      const reportedServerErrors = [];
      let caughtError;
      try {
        await act(() => {
          const {pipe} = renderToPipeableStream(<App />, {
            /**
             * 收集服务器EffectEvent调用错误，断言与act捕获的错误是同一对象。
             * @param e 服务器错误。
             */
            onError(e) {
              reportedServerErrors.push(e);
            },
          });
          pipe(writable);
        });
      } catch (err) {
        caughtError = err;
      }
      expect(logs).toEqual([]);
      expect(caughtError.message).toContain(
        "A function wrapped in useEffectEvent can't be called during rendering.",
      );
      expect(reportedServerErrors).toEqual([caughtError]);
    });

    /** 同一组件比较两个useEffectEvent返回值身份，服务器当前相同而输出div，客户端不同而输出span；断言一次恢复错误，记录跨renderer身份差异不可用于一致输出。 */
    it('does not guarantee useEffectEvent return values during server rendering are distinct', async () => {
      /**
       * 按两次EffectEvent返回值身份选择div或span，故意观察服务器共享占位函数与客户端独立函数导致的输出差异。
       * @returns div或span。
       */
      function App() {
        const onClick1 = React.useEffectEvent(() => {});
        const onClick2 = React.useEffectEvent(() => {});
        if (onClick1 === onClick2) {
          return <div />;
        } else {
          return <span />;
        }
      }
      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });
      expect(getVisibleChildren(container)).toEqual(<div />);

      const errors = [];
      ReactDOMClient.hydrateRoot(container, <App />, {
        /**
         * 收集身份分支差异引发的hydration恢复错误，断言恰一项。
         * @param error 恢复错误。
         */
        onRecoverableError(error) {
          errors.push(error);
        },
      });
      await waitForAll([]);
      expect(errors.length).toEqual(1);
      expect(getVisibleChildren(container)).toEqual(<span />);
    });
  });

  /** 完整文档中的script children为单个JS字符串；断言原始outerHTML保留该脚本文本，并允许开关控制的外部runtime和blocking标记，验证合法script字符串输出。 */
  it('can render scripts with simple children', async () => {
    await act(async () => {
      const {pipe} = renderToPipeableStream(
        <html>
          <body>
            <script>{'try { foo() } catch (e) {} ;'}</script>
          </body>
        </html>,
      );
      pipe(writable);
    });

    expect(document.documentElement.outerHTML).toEqual(
      '<html><head>' +
        (gate(flags => flags.shouldUseFizzExternalRuntime)
          ? '<script src="react-dom-bindings/src/server/ReactDOMServerExternalRuntime.js" async=""></script>'
          : '') +
        (gate(flags => flags.enableFizzBlockingRender)
          ? '<link rel="expect" href="#_R_" blocking="render">'
          : '') +
        '</head><body><script>try { foo() } catch (e) {} ;</script>' +
        (gate(flags => flags.enableFizzBlockingRender)
          ? '<template id="_R_"></template>'
          : '') +
        '</body></html>',
    );
  });

  /** script分别接收number、字符串数组和MyScript React元素，DEV核对三种非法children警告及组件栈；本例没有断言这些输入的DOM或脚本执行结果。 */
  it('warns if script has complex children', async () => {
    /**
     * 若执行将返回bar();字符串，本例却把其React元素直接传给script，验证非法children警告。
     * @returns JS字符串。
     */
    function MyScript() {
      return 'bar();';
    }

    /**
     * 在三个script中分别传number、字符串数组和React元素，故意触发不同DEVchildren诊断。
     * @returns script警告文档。
     */
    function App() {
      return (
        <html>
          <body>
            <script>{2}</script>
            <script>
              {['try { foo() } catch (e) {} ;', 'try { bar() } catch (e) {} ;']}
            </script>
            <script>
              <MyScript />
            </script>
          </body>
        </html>
      );
    }

    await act(async () => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });

    assertConsoleErrorDev([
      'A script element was rendered with a number for children. If script element has children it must be a single string. Consider using dangerouslySetInnerHTML or passing a plain string as children.' +
        componentStack(['script', 'App']),
      'A script element was rendered with an array for children. If script element has children it must be a single string. Consider using dangerouslySetInnerHTML or passing a plain string as children.' +
        componentStack(['script', 'App']),
      'A script element was rendered with something unexpected for children. If script element has children it must be a single string. Consider using dangerouslySetInnerHTML or passing a plain string as children.' +
        componentStack(['script', 'App']),
    ]);
  });

  /** 服务器边界显示Loading且Async未完成，hydrate后在transition更新边界外search。断言updated query及时显示、边界仍Loading，验证显示fallback的dehydrated边界不阻止外部transition提交。 */
  it(
    'a transition that flows into a dehydrated boundary should not suspend ' +
      'if the boundary is showing a fallback',
    async () => {
      let setSearch;
      /**
       * 记录search的setState出口，Suspense只包含固定Async键；search更新可提交到仍显示fallback的边界外。
       * @returns search与暂停边界。
       */
      function App() {
        const [search, _setSearch] = React.useState('initial query');
        setSearch = _setSearch;
        return (
          <div>
            <div>{search}</div>
            <div>
              <Suspense fallback="Loading...">
                <AsyncText text="Async" />
              </Suspense>
            </div>
          </div>
        );
      }

    // 渲染初始 HTML，此时显示 fallback。
      await act(() => {
        const {pipe} = renderToPipeableStream(<App />);
        pipe(writable);
      });

    // 开始 hydration。
      await clientAct(() => {
        ReactDOMClient.hydrateRoot(container, <App />);
      });
      expect(getVisibleChildren(container)).toEqual(
        <div>
          <div>initial query</div>
          <div>Loading...</div>
        </div>,
      );

    // 在 HTML 流入前更新查询；fallback 外的部分应能完成更新。
      await clientAct(() => {
        React.startTransition(() => setSearch('updated query'));
      });
      expect(getVisibleChildren(container)).toEqual(
        <div>
          <div>updated query</div>
          <div>Loading...</div>
        </div>,
      );
    },
  );

  /** 静态prerender的两个内层边界永远暂停，用AbortController中止boom并收到两次原因；输出prelude后关闭prerendering，JSON往返postponed再resume。最终两处Hello且无新错误，验证中止预渲染状态可序列化恢复。 */
  it('can resume a prerender that was aborted', async () => {
    const promise = new Promise(r => {});

    let prerendering = true;

    /**
     * prerendering时use永不完成promise，关闭后同步返回Hello，使同一树可从postponed状态恢复。
     * @returns 暂停promise结果或Hello。
     * @throws 预渲染暂停信号。
     */
    function Wait() {
      if (prerendering) {
        return React.use(promise);
      } else {
        return 'Hello';
      }
    }

    /**
     * 外层Suspense包含两个p/span中的内层边界，各自渲染Wait，形成两项可中止/恢复的任务。
     * @returns 预渲染恢复树。
     */
    function App() {
      return (
        <div>
          <Suspense fallback="Loading...">
            <p>
              <span>
                <Suspense fallback="Loading again...">
                  <Wait />
                </Suspense>
              </span>
            </p>
            <p>
              <span>
                <Suspense fallback="Loading again too...">
                  <Wait />
                </Suspense>
              </span>
            </p>
          </Suspense>
        </div>
      );
    }

    const controller = new AbortController();
    const signal = controller.signal;

    const errors = [];
    /**
     * 保存prerender中止及resume错误；阶段切换时清空以验证恢复无新错误。
     * @param error 当前阶段服务器错误。
     */
    function onError(error) {
      errors.push(error);
    }
    let pendingPrerender;
    await act(() => {
      pendingPrerender = ReactDOMFizzStatic.prerenderToNodeStream(<App />, {
        signal,
        onError,
      });
    });
    controller.abort('boom');

    const prerendered = await pendingPrerender;

    expect(errors).toEqual(['boom', 'boom']);

    const preludeWritable = new Stream.PassThrough();
    preludeWritable.setEncoding('utf8');
    preludeWritable.on('data', chunk => {
      writable.write(chunk);
    });

    await act(() => {
      prerendered.prelude.pipe(preludeWritable);
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>
          <span>Loading again...</span>
        </p>
        <p>
          <span>Loading again too...</span>
        </p>
      </div>,
    );

    prerendering = false;

    errors.length = 0;
    const resumed = await ReactDOMFizzServer.resumeToPipeableStream(
      <App />,
      JSON.parse(JSON.stringify(prerendered.postponed)),
      {
        onError,
      },
    );

    await act(() => {
      resumed.pipe(writable);
    });

    expect(errors).toEqual([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>
          <span>Hello</span>
        </p>
        <p>
          <span>Hello</span>
        </p>
      </div>,
    );
  });

  /** 生成器函数组件Foo yield两个带key的h1，服务器body文本HelloWorld且无需DEV iterator警告，验证生成器组件入口被支持。 */
  it('should NOT warn for using generator functions as components', async () => {
    /**
     * 生成器组件依次yield两个带key的h1，组件返回的生成器被服务器作为支持入口消费。
     * @returns 同步生成器。
     */
    function* Foo() {
      yield <h1 key="1">Hello</h1>;
      yield <h1 key="2">World</h1>;
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<Foo />);
      pipe(writable);
    });

    expect(document.body.textContent).toBe('HelloWorld');
  });

  /** 首个Suspense内组件渲染时同步无原因abort，另两个边界也受中止；断言三项DEV中止错误、流finish与三处fallback，验证渲染中中止能完成输出。 */
  it('can abort synchronously during render', async () => {
    /**
     * 输出sibling p作为中止后尚待遍历的普通兄弟。
     * @returns p sibling。
     */
    function Sibling() {
      return <p>sibling</p>;
    }

    /**
     * 建立三个Suspense，首个含中止组件，其余普通兄弟用于检查同步中止遍及剩余边界。
     * @returns 三边界树。
     */
    function App() {
      return (
        <div>
          <Suspense fallback={<p>loading 1...</p>}>
            <ComponentThatAborts />
            <Sibling />
          </Suspense>
          <Suspense fallback={<p>loading 2...</p>}>
            <Sibling />
          </Suspense>
          <div>
            <Suspense fallback={<p>loading 3...</p>}>
              <div>
                <Sibling />
              </div>
            </Suspense>
          </div>
        </div>
      );
    }

    const abortRef = {current: null};
    /**
     * 调用已由外层安装到abortRef的abort后返回hello world p；既定中止阻止正常内容输出。
     * @returns p hello world。
     */
    function ComponentThatAborts() {
      abortRef.current();
      return <p>hello world</p>;
    }

    let finished = false;
    await act(() => {
      const {pipe, abort} = renderToPipeableStream(<App />);
      abortRef.current = abort;
      writable.on('finish', () => {
        finished = true;
      });
      pipe(writable);
    });

    assertConsoleErrorDev([
      'Error: The render was aborted by the server without a reason.' +
        '\n    in <stack>',
      'Error: The render was aborted by the server without a reason.' +
        '\n    in <stack>',
      'Error: The render was aborted by the server without a reason.' +
        '\n    in <stack>',
    ]);

    expect(finished).toBe(true);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>loading 1...</p>
        <p>loading 2...</p>
        <div>
          <p>loading 3...</p>
        </div>
      </div>,
    );
  });

  /** 一个根任务已暂停，另一个根组件渲染时以abort reason中止后返回同步Child；不pipe，断言两次原因，验证另一个任务fatal时仍报告当前执行中的根任务。 */
  it('reports an in-flight root task after another root task fatals while aborting', async () => {
    const promise = new Promise(() => {});
    /**
     * 在根级use永不完成promise，制造在另一根任务中止时仍待报告的任务。
     * @returns 正常完成时null。
     * @throws 暂停信号。
     */
    function SuspendedRoot() {
      use(promise);
      return null;
    }

    /**
     * 返回同步child，覆盖abort后组件仍返回可渲染子树的情况。
     * @returns child文本。
     */
    function Child() {
      return 'child';
    }

    const abortRef = {current: null};
    /**
     * 渲染时以abort reason中止并返回Child，使当前根任务与先前暂停根任务都被报告。
     * @returns Child。
     */
    function ComponentThatAborts() {
      abortRef.current(new Error('abort reason'));
      return <Child />;
    }

    const errors = [];
    await act(() => {
      const {abort} = renderToPipeableStream(
        <>
          <SuspendedRoot />
          <ComponentThatAborts />
        </>,
        {
          /**
           * 记录逐根任务的中止message，预期两次abort reason。
           * @param error 中止错误。
           */
          onError(error) {
            errors.push(error.message);
          },
          /** 空shell错误回调，处理根任务中止的fatal通知；本例仅断言onError。 */
          onShellError() {},
        },
      );
      abortRef.current = abort;
    });

    expect(errors).toEqual(['abort reason', 'abort reason']);
  });

  /** 一个根任务先暂停，另一组件abort后返回同样会暂停的Child；断言两次abort reason，覆盖中止后尚未遍历返回子树时根任务仍被正确报告。 */
  it('reports a root task before rendering a suspended child returned after aborting', async () => {
    const promise = new Promise(() => {});
    /**
     * 根级use永不完成promise，形成已暂停的第一根任务。
     * @returns 正常完成时null。
     * @throws 暂停信号。
     */
    function SuspendedRoot() {
      use(promise);
      return null;
    }

    /**
     * use同一个永不完成promise，若abort后继续遍历该返回子树就会暂停。
     * @returns 正常完成时null。
     * @throws 暂停信号。
     */
    function Child() {
      use(promise);
      return null;
    }

    const abortRef = {current: null};
    /**
     * 先以abort reason中止再返回会暂停的Child，检查当前根任务在返回子树前被报告。
     * @returns Child。
     */
    function ComponentThatAborts() {
      abortRef.current(new Error('abort reason'));
      return <Child />;
    }

    const errors = [];
    await act(() => {
      const {abort} = renderToPipeableStream(
        <>
          <SuspendedRoot />
          <ComponentThatAborts />
        </>,
        {
          /**
           * 保存逐任务abort message，断言仅两项既定根任务原因。
           * @param error 中止错误。
           */
          onError(error) {
            errors.push(error.message);
          },
          /** 空shell错误回调，接收根中止fatal通知，不独立断言次数。 */
          onShellError() {},
        },
      );
      abortRef.current = abort;
    });

    expect(errors).toEqual(['abort reason', 'abort reason']);
  });

  /** 唯一根组件先abort reason再use永不完成promise；断言错误只一次，验证当前根任务在中止后直接暂停仍报告既定原因。 */
  it('reports a root task that suspends directly after aborting during render', async () => {
    const promise = new Promise(() => {});
    const abortRef = {current: null};
    /**
     * 渲染时先中止，再use永不完成promise；当前任务只有一次既定abort报告。
     * @returns 正常完成时null。
     * @throws 暂停信号。
     */
    function ComponentThatAbortsAndSuspends() {
      abortRef.current(new Error('abort reason'));
      use(promise);
      return null;
    }

    const errors = [];
    await act(() => {
      const {abort} = renderToPipeableStream(
        <ComponentThatAbortsAndSuspends />,
        {
          /**
           * 收集中止message，断言当前根任务只报告一次。
           * @param error 中止错误。
           */
          onError(error) {
            errors.push(error.message);
          },
          /** 空shell错误回调，处理预期fatal通知。 */
          onShellError() {},
        },
      );
      abortRef.current = abort;
    });

    expect(errors).toEqual(['abort reason']);
  });

  /** 首边界lazy组件初始化时无原因abort，返回同步完成的default div thenable；断言三项DEV中止错误、finish及三处fallback，验证lazy组件入口中止。 */
  it('can abort during render in a lazy initializer for a component', async () => {
    /**
     * 输出p sibling，作为lazy初始化中止后不显示的普通内容。
     * @returns p sibling。
     */
    function Sibling() {
      return <p>sibling</p>;
    }

    /**
     * 三个Suspense中首个放LazyAbort，其余放Sibling，检验lazy组件初始化中止整个请求。
     * @returns 三边界树。
     */
    function App() {
      return (
        <div>
          <Suspense fallback={<p>loading 1...</p>}>
            <LazyAbort />
            <Sibling />
          </Suspense>
          <Suspense fallback={<p>loading 2...</p>}>
            <Sibling />
          </Suspense>
          <div>
            <Suspense fallback={<p>loading 3...</p>}>
              <div>
                <Sibling />
              </div>
            </Suspense>
          </div>
        </div>
      );
    }

    const abortRef = {current: null};
    const LazyAbort = React.lazy(() => {
      abortRef.current();
      return {
        /**
         * 同步提供default div组件导出；lazy初始化已先abort，因此不会正常显示该组件内容。
         * @param cb lazy模块完成回调。
         */
        then(cb) {
          cb({default: 'div'});
        },
      };
    });

    let finished = false;
    await act(() => {
      const {pipe, abort} = renderToPipeableStream(<App />);
      abortRef.current = abort;
      writable.on('finish', () => {
        finished = true;
      });
      pipe(writable);
    });

    assertConsoleErrorDev([
      'Error: The render was aborted by the server without a reason.' +
        '\n    in <stack>',
      'Error: The render was aborted by the server without a reason.' +
        '\n    in <stack>',
      'Error: The render was aborted by the server without a reason.' +
        '\n    in <stack>',
    ]);

    expect(finished).toBe(true);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>loading 1...</p>
        <p>loading 2...</p>
        <div>
          <p>loading 3...</p>
        </div>
      </div>,
    );
  });

  /** 首边界的lazy元素初始化时abort，thenable同步提供hello world字符串；断言三项DEV中止错误、finish和fallback，验证lazy作为node时中止。 */
  it('can abort during render in a lazy initializer for an element', async () => {
    /**
     * 输出p sibling，作为lazy元素初始化中止的普通兄弟。
     * @returns p sibling。
     */
    function Sibling() {
      return <p>sibling</p>;
    }

    /**
     * 首个Suspense把lazyAbort对象直接作为node，其余边界放Sibling，覆盖lazy元素入口。
     * @returns 三边界树。
     */
    function App() {
      return (
        <div>
          <Suspense fallback={<p>loading 1...</p>}>
            {lazyAbort}
            <Sibling />
          </Suspense>
          <Suspense fallback={<p>loading 2...</p>}>
            <Sibling />
          </Suspense>
          <div>
            <Suspense fallback={<p>loading 3...</p>}>
              <div>
                <Sibling />
              </div>
            </Suspense>
          </div>
        </div>
      );
    }

    const abortRef = {current: null};
    const lazyAbort = React.lazy(() => {
      abortRef.current();
      return {
        /**
         * 同步完成lazy node为hello world字符串；先前中止已确定请求状态。
         * @param cb lazy完成回调。
         */
        then(cb) {
          cb({default: 'hello world'});
        },
      };
    });

    let finished = false;
    await act(() => {
      const {pipe, abort} = renderToPipeableStream(<App />);
      abortRef.current = abort;
      writable.on('finish', () => {
        finished = true;
      });
      pipe(writable);
    });

    assertConsoleErrorDev([
      'Error: The render was aborted by the server without a reason.' +
        '\n    in <stack>',
      'Error: The render was aborted by the server without a reason.' +
        '\n    in <stack>',
      'Error: The render was aborted by the server without a reason.' +
        '\n    in <stack>',
    ]);

    expect(finished).toBe(true);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>loading 1...</p>
        <p>loading 2...</p>
        <div>
          <p>loading 3...</p>
        </div>
      </div>,
    );
  });

  /** 首边界的thenable在同步then回调中abort后调用cb(thenable.value)，其value未定义；断言三项DEV中止错误、finish和fallback，验证同步解包中止而非正常输出。 */
  it('can abort during a synchronous thenable resolution', async () => {
    /**
     * 输出p sibling，供同步then回调中止时观察fallback取代主内容。
     * @returns p sibling。
     */
    function Sibling() {
      return <p>sibling</p>;
    }

    /**
     * 首个边界直接使用thenable node，其余普通边界观察同一次请求中止。
     * @returns 三边界树。
     */
    function App() {
      return (
        <div>
          <Suspense fallback={<p>loading 1...</p>}>
            {thenable}
            <Sibling />
          </Suspense>
          <Suspense fallback={<p>loading 2...</p>}>
            <Sibling />
          </Suspense>
          <div>
            <Suspense fallback={<p>loading 3...</p>}>
              <div>
                <Sibling />
              </div>
            </Suspense>
          </div>
        </div>
      );
    }

    const abortRef = {current: null};
    const thenable = {
      /**
       * 先调用abortRef中的无原因abort，再用未定义的thenable.value调用cb，模拟同步解包时中止。
       * @param cb thenable完成回调。
       */
      then(cb) {
        abortRef.current();
        cb(thenable.value);
      },
    };

    let finished = false;
    await act(() => {
      const {pipe, abort} = renderToPipeableStream(<App />);
      abortRef.current = abort;
      writable.on('finish', () => {
        finished = true;
      });
      pipe(writable);
    });

    assertConsoleErrorDev([
      'Error: The render was aborted by the server without a reason.' +
        '\n    in <stack>',
      'Error: The render was aborted by the server without a reason.' +
        '\n    in <stack>',
      'Error: The render was aborted by the server without a reason.' +
        '\n    in <stack>',
    ]);

    expect(finished).toBe(true);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>loading 1...</p>
        <p>loading 2...</p>
        <div>
          <p>loading 3...</p>
        </div>
      </div>,
    );
  });

  /** 边界内组件先abort字符串boom再throw Error(bam)，断言onError仅收到boom、流finish且显示fallback，验证中止原因已确定后不追加后续抛错。 */
  it('can support throwing after aborting during a render', async () => {
    /**
     * 以loading p包裹先中止再抛错的组件，让请求仍可输出fallback。
     * @returns 单边界树。
     */
    function App() {
      return (
        <div>
          <Suspense fallback={<p>loading...</p>}>
            <ComponentThatAborts />
          </Suspense>
        </div>
      );
    }

    /**
     * 先abort字符串boom，再throw Error(bam)，制造中止已确定后发生另一错误的路径。
     * @throws bam，服务器报告仍使用boom。
     */
    function ComponentThatAborts() {
      abortRef.current('boom');
      throw new Error('bam');
    }

    const abortRef = {current: null};
    let finished = false;
    const errors = [];
    await act(() => {
      const {pipe, abort} = renderToPipeableStream(<App />, {
        /**
         * 直接保存中止值，预期仅字符串boom而非后续Error(bam)。
         * @param err 中止原因或渲染错误。
         */
        onError(err) {
          errors.push(err);
        },
      });
      abortRef.current = abort;
      writable.on('finish', () => {
        finished = true;
      });
      pipe(writable);
    });

    expect(errors).toEqual(['boom']);

    expect(finished).toBe(true);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>loading...</p>
      </div>,
    );
  });

  /** Foo将getChildren生成器实例作为div children，DEV警告一次性iterator会被消费；body仍HelloWorld，区分iterator children与支持的生成器组件入口。 */
  it('should warn for using generators as children props', async () => {
    /**
     * 生成两个带key的h1，返回一次性生成器实例，消费时会推进内部状态。
     * @returns 同步生成器。
     */
    function* getChildren() {
      yield <h1 key="1">Hello</h1>;
      yield <h1 key="2">World</h1>;
    }

    /**
     * 把生成器实例直接置于div children，故意触发一次性iterator诊断。
     * @returns div。
     */
    function Foo() {
      const children = getChildren();
      return <div>{children}</div>;
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<Foo />);
      pipe(writable);
    });
    assertConsoleErrorDev([
      'Using Iterators as children is unsupported and will likely yield ' +
        'unexpected results because enumerating a generator mutates it. ' +
        'You may convert it to an array with `Array.from()` or the ' +
        '`[...spread]` operator before rendering. You can also use an ' +
        'Iterable that can iterate multiple times over the same items.\n' +
        '    in div (at **)\n' +
        '    in Foo (at **)',
    ]);

    expect(document.body.textContent).toBe('HelloWorld');
  });

  /** Foo返回一次性iterator：Symbol.iterator返回自身，next依次产生Hello/World后done；DEV警告iterator被消费，body仍HelloWorld，覆盖非生成器但同样不可重放的迭代器。 */
  it('should warn for using other types of iterators as children', async () => {
    /**
     * 返回自身可迭代的一次性iterator，闭包i随next增长，故不能从头重复遍历。
     * @returns iterator。
     */
    function Foo() {
      let i = 0;
      const iterator = {
        /**
         * 返回同一个iterator实例，而非创建新迭代状态，触发一次性iterator诊断。
         * @returns 当前iterator。
         */
        [Symbol.iterator]() {
          return iterator;
        },
        /**
         * 按i++依序返回Hello/World的带key h1，随后done true；消费会修改闭包位置。
         * @returns 当前迭代结果。
         */
        next() {
          switch (i++) {
            case 0:
              return {done: false, value: <h1 key="1">Hello</h1>};
            case 1:
              return {done: false, value: <h1 key="2">World</h1>};
            default:
              return {done: true, value: undefined};
          }
        },
      };
      return iterator;
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<Foo />);
      pipe(writable);
    });
    assertConsoleErrorDev([
      'Using Iterators as children is unsupported and will likely yield ' +
        'unexpected results because enumerating a generator mutates it. ' +
        'You may convert it to an array with `Array.from()` or the ' +
        '`[...spread]` operator before rendering. You can also use an ' +
        'Iterable that can iterate multiple times over the same items.\n' +
        '    in Foo (at **)',
    ]);

    expect(document.body.textContent).toBe('HelloWorld');
  });

  /** DEV中Foo→Bar→Baz在Baz render捕获owner stack，断言仅Bar/Foo，不含宿主div及Baz自身，验证创建者栈与渲染父栈的区别。 */
  // @gate __DEV__
  it('can get the component owner stacks during rendering in dev', async () => {
    let stack;

    /**
     * 创建Bar元素，作为owner栈最外层创建者。
     * @returns Bar。
     */
    function Foo() {
      return <Bar />;
    }
    /**
     * 在宿主div内创建Baz，作为owner栈直接创建者；宿主div不进入owner栈。
     * @returns div/Baz。
     */
    function Bar() {
      return (
        <div>
          <Baz />
        </div>
      );
    }
    /**
     * 渲染时捕获React.captureOwnerStack并输出hi，检查栈只包含创建者Bar/Foo。
     * @returns span hi。
     */
    function Baz() {
      stack = React.captureOwnerStack();
      return <span>hi</span>;
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(
        <div>
          <Foo />
        </div>,
      );
      pipe(writable);
    });

    expect(normalizeCodeLocInfo(stack)).toBe(
      '\n    in Bar (at **)' + '\n    in Foo (at **)',
    );
  });

  /** DEV中Baz抛固定Error，根act拒绝同一对象；onError分别捕获componentStack与ownerStack。断言前者含Baz/宿主div/Bar/Foo，后者仅Bar/Foo，验证错误回调期间owner栈恢复。 */
  // @gate __DEV__
  it('can get the component owner stacks for onError in dev', async () => {
    const thrownError = new Error('hi');
    let caughtError;
    let parentStack;
    let ownerStack;

    /**
     * 创建Bar作为错误组件的外层owner。
     * @returns Bar。
     */
    function Foo() {
      return <Bar />;
    }
    /**
     * 在div内创建Baz，供比较组件父栈和owner栈。
     * @returns div/Baz。
     */
    function Bar() {
      return (
        <div>
          <Baz />
        </div>
      );
    }
    /**
     * 抛固定thrownError，使根fatal回调可比较同一Error身份和两类栈。
     * @throws thrownError。
     */
    function Baz() {
      throw thrownError;
    }

    await expect(async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <div>
            <Foo />
          </div>,
          {
            /**
             * 保存原错误及componentStack，并在回调上下文捕获ownerStack；断言两类栈包含不同节点。
             * @param error 原始错误。
             * @param errorInfo 含组件父栈的信息。
             */
            onError(error, errorInfo) {
              caughtError = error;
              parentStack = errorInfo.componentStack;
              ownerStack = React.captureOwnerStack
                ? React.captureOwnerStack()
                : null;
            },
          },
        );
        pipe(writable);
      });
    }).rejects.toThrow(thrownError);

    expect(caughtError).toBe(thrownError);
    expect(normalizeCodeLocInfo(parentStack)).toBe(
      '\n    in Baz (at **)' +
        '\n    in div (at **)' +
        '\n    in Bar (at **)' +
        '\n    in Foo (at **)' +
        '\n    in div (at **)',
    );
    expect(normalizeCodeLocInfo(ownerStack)).toBe(
      '\n    in Bar (at **)' + '\n    in Foo (at **)',
    );
  });

  /** Recursive递减1200层组件树后输出span hi，最终div/span正确；覆盖服务器遍历深层React树可从栈溢出重试恢复，本例不统计实际溢出次数。 */
  it('can recover from very deep trees to avoid stack overflow', async () => {
    /**
     * 递减n生成下一层Recursive，归零输出span hi；深度来自React树而非组件内部同步递归调用。
     * @param n 剩余组件层数。
     * @returns 下一层Recursive或span。
     */
    function Recursive({n}) {
      if (n > 0) {
        return <Recursive n={n - 1} />;
      }
      return <span>hi</span>;
    }

    // 递归渲染足够深的组件树，多次触发栈溢出。首次溢出由 renderNode trampoline 恢复；更深的树在
    // 重试任务再次溢出时也必须恢复。深度不宜过大，以免拖慢测试。
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <div>
          <Recursive n={1200} />
        </div>,
      );
      pipe(writable);
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>hi</span>
      </div>,
    );
  });

  /** 组件内部普通函数递归10000层且追加字符串，触发Maximum call stack size exceeded；act拒绝该消息、onError同消息，验证用户组件自身无限深计算作为错误而非React树重试。 */
  it('handles stack overflows inside components themselves', async () => {
    /**
     * 在组件内部调用深递归计算，制造用户代码自身RangeError，区别于React遍历深树的可恢复溢出。
     * @returns 正常完成时字符串，本例先溢出。
     * @throws 栈溢出RangeError。
     */
    function StackOverflow() {
      // 这个组件是递归的，因此是一个错误。 假设没有尾调用优化。
      /**
       * 普通同步递归n次，返回时追加四段参数以阻止尾调用形式；10000层触发组件自身栈溢出。
       * @param n 剩余递归次数。
       * @param a0 基值及追加片段。
       * @param a1 追加片段。
       * @param a2 追加片段。
       * @param a3 追加片段。
       * @returns 递归拼接结果。
       * @throws 调用栈溢出。
       */
      function recursive(n, a0, a1, a2, a3) {
        if (n > 0) {
          return recursive(n - 1, a0, a1, a2, a3) + a0 + a1 + a2 + a3;
        }
        return a0;
      }
      return recursive(10000, 'should', 'not', 'resolve', 'this');
    }

    let caughtError;

    await expect(async () => {
      await act(() => {
        const {pipe} = renderToPipeableStream(
          <div>
            <StackOverflow />
          </div>,
          {
            /**
             * 保存组件内部溢出错误；errorInfo未读取，本例只核对message。
             * @param error 溢出错误。
             * @param errorInfo 附加错误信息，本例未用。
             */
            onError(error, errorInfo) {
              caughtError = error;
            },
          },
        );
        pipe(writable);
      });
    }).rejects.toThrow('Maximum call stack size exceeded');

    expect(caughtError.message).toBe('Maximum call stack size exceeded');
  });

  /** 1200层Deep包裹暂停Content，静态prerender中止后产生非空postponed与Loading prelude；关闭暂停并JSON往返状态后resume，无新错误且span hi，覆盖深层replay恢复路径。 */
  it('can recover from very deep trees during resume to avoid stack overflow', async () => {
    const promise = new Promise(() => {});

    let prerendering = true;

    // postponed 边界上方存在深层包装。resume 时，这条 replay 路径经过 retryReplayTask → retryNode
    //（没有 trampoline），因此足以在此处溢出的深层树也必须恢复，而非只在普通渲染重试路径上恢复。
    /**
     * 递减n创建组件包装，归零透传children，使postponed边界之上存在深层replay路径。
     * @param n 剩余层数。
     * @param children 底部Suspense。
     * @returns Deep或children。
     */
    function Deep({n, children}) {
      if (n > 0) {
        return <Deep n={n - 1}>{children}</Deep>;
      }
      return children;
    }

    /**
     * prerender时use永不完成promise，resume阶段关闭标记后输出span hi。
     * @returns promise结果或span。
     * @throws 预渲染暂停信号。
     */
    function Content() {
      if (prerendering) {
        return React.use(promise);
      }
      return <span>hi</span>;
    }

    /**
     * 1200层Deep包裹Suspense/Content，测试深层预渲染与resume replay恢复。
     * @returns 深树。
     */
    function App() {
      return (
        <div>
          <Deep n={1200}>
            <Suspense fallback="Loading...">
              <Content />
            </Suspense>
          </Deep>
        </div>
      );
    }

    const controller = new AbortController();
    const errors = [];
    let pendingPrerender;
    await act(() => {
      pendingPrerender = ReactDOMFizzStatic.prerenderToNodeStream(<App />, {
        signal: controller.signal,
        /**
         * 保存预渲染中止错误，预期一项字符串abort。
         * @param error 当前任务错误。
         */
        onError(error) {
          errors.push(error);
        },
      });
    });
    controller.abort('abort');

    const prerendered = await pendingPrerender;
    expect(errors).toEqual(['abort']);
    expect(prerendered.postponed).not.toBe(null);

    const preludeWritable = new Stream.PassThrough();
    preludeWritable.setEncoding('utf8');
    preludeWritable.on('data', chunk => {
      writable.write(chunk);
    });

    await act(() => {
      prerendered.prelude.pipe(preludeWritable);
    });
    expect(getVisibleChildren(container)).toEqual(<div>Loading...</div>);

    prerendering = false;
    errors.length = 0;

    const resumed = await ReactDOMFizzServer.resumeToPipeableStream(
      <App />,
      JSON.parse(JSON.stringify(prerendered.postponed)),
      {
        /**
         * 保存resume错误，阶段开始前清空列表，预期深层恢复没有新错误。
         * @param error 恢复阶段错误。
         */
        onError(error) {
          errors.push(error);
        },
      },
    );

    await act(() => {
      resumed.pipe(writable);
    });

    expect(errors).toEqual([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>hi</span>
      </div>,
    );
  });

  /** 服务器边界暂停后提前writable.end、设readyState complete并完成promise，断言destination closed early且fallback未更新；随后hydrate立即客户端显示inside并报告未完成边界，验证开始时文档已完成的接管。 */
  it('client renders incomplete Suspense boundaries when the document is no longer loading when hydration begins', async () => {
    let resolve;
    const promise = new Promise(r => {
      resolve = r;
    });

    /**
     * use可外部完成的promise，正常后返回null，阻塞同边界中的inside p。
     * @returns null。
     * @throws 暂停信号。
     */
    function Blocking() {
      React.use(promise);
      return null;
    }

    /**
     * 输出外部outside p及边界内Blocking/inside p，观察流提前关闭后的客户端局部接管。
     * @returns 未完成边界树。
     */
    function App() {
      return (
        <div>
          <p>outside</p>
          <Suspense fallback={<p>loading...</p>}>
            <Blocking />
            <p>inside</p>
          </Suspense>
        </div>
      );
    }

    const errors = [];
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />, {
        /**
         * 收集服务器错误message，核对destination stream closed early。
         * @param err 服务器错误。
         */
        onError(err) {
          errors.push(err.message);
        },
      });
      pipe(writable);
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>outside</p>
        <p>loading...</p>
      </div>,
    );

    await act(() => {
      // 现在结束流，并 resolve 阻塞边界的 promise；流已结束，因此结果不会真正传播到客户端。
      writable.end();
      document.readyState = 'complete';
      resolve();
    });
    // 提前结束流会导致在服务器上抛出错误。
    expect(errors).toEqual([
      expect.stringContaining('The destination stream closed early'),
    ]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>outside</p>
        <p>loading...</p>
      </div>,
    );

    const clientErrors = [];
    ReactDOMClient.hydrateRoot(container, <App />, {
      /**
       * 收集文档开始hydration时已complete的未完成边界接管消息；errorInfo未使用。
       * @param error 恢复错误。
       * @param errorInfo 附加信息。
       */
      onRecoverableError(error, errorInfo) {
        clientErrors.push(error.message);
      },
    });
    await waitForAll([]);
    // hydration开始时文档已complete，边界改为客户端渲染，已完成的promise让inside主内容直接显示。
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>outside</p>
        <p>inside</p>
      </div>,
    );
    expect(clientErrors).toEqual([
      expect.stringContaining(
        'The server could not finish this Suspense boundar',
      ),
    ]);
  });

  /** 服务器提前结束流并完成promise仍留下fallback；hydrate开始时document仍loading，先保持fallback。再设complete触发客户端接管为inside并报告未完成边界，验证hydration过程中结束加载的路径。 */
  it('client renders incomplete Suspense boundaries when the document stops loading during hydration', async () => {
    let resolve;
    const promise = new Promise(r => {
      resolve = r;
    });

    /**
     * use可外部完成promise并返回null，使服务器留下尚未恢复的inside边界。
     * @returns null。
     * @throws 暂停信号。
     */
    function Blocking() {
      React.use(promise);
      return null;
    }

    /**
     * 外部outside和边界内inside由同一div包裹，测试readyState在hydration中改变的时机。
     * @returns 未完成边界树。
     */
    function App() {
      return (
        <div>
          <p>outside</p>
          <Suspense fallback={<p>loading...</p>}>
            <Blocking />
            <p>inside</p>
          </Suspense>
        </div>
      );
    }

    const errors = [];
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />, {
        /**
         * 收集提前结束流的服务器错误message。
         * @param err 服务器错误。
         */
        onError(err) {
          errors.push(err.message);
        },
      });
      pipe(writable);
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>outside</p>
        <p>loading...</p>
      </div>,
    );

    await act(() => {
      // 现在结束流，并 resolve 阻塞边界的 promise；流已结束，因此结果不会真正传播到客户端。
      writable.end();
      resolve();
    });
    // 提前结束流会导致在服务器上抛出错误。
    expect(errors).toEqual([
      expect.stringContaining('The destination stream closed early'),
    ]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>outside</p>
        <p>loading...</p>
      </div>,
    );

    const clientErrors = [];
    ReactDOMClient.hydrateRoot(container, <App />, {
      /**
       * 收集readyState变complete后的局部接管消息，errorInfo未读取。
       * @param error 恢复错误。
       * @param errorInfo 附加信息。
       */
      onRecoverableError(error, errorInfo) {
        clientErrors.push(error.message);
      },
    });
    await waitForAll([]);
    // hydration 时客户端仍在等待被阻塞的边界；只有文档不再 loading 才会改用客户端渲染。
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>outside</p>
        <p>loading...</p>
      </div>,
    );

    document.readyState = 'complete';
    await waitForAll([]);
    // readyState变为complete后触发客户端接管，已完成的promise使inside主内容替换fallback。
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>outside</p>
        <p>inside</p>
      </div>,
    );
    expect(clientErrors).toEqual([
      expect.stringContaining(
        'The server could not finish this Suspense boundar',
      ),
    ]);
  });

  /** head内Suspense先输出itemProp meta fallback，完成head键后替换主meta；hydrate保持文档，unmount后head/body清空，验证head暂停、恢复与清理。 */
  it('can suspend inside the <head /> tag', async () => {
    /**
     * 先读取value缓存键，完成后原样返回children，在head内制造暂停。
     * @param value 暂停键。
     * @param children 完成后内容。
     * @returns children。
     */
    function BlockedOn({value, children}) {
      readText(value);
      return children;
    }

    /**
     * head内以itemProp meta作为fallback及主内容，body独立输出，覆盖head暂停与卸载清理。
     * @returns 完整文档。
     */
    function App() {
      return (
        <html>
          <head>
            <Suspense fallback={<meta itemProp="head loading" />}>
              <BlockedOn value="head">
                <meta itemProp="" content="head" />
              </BlockedOn>
            </Suspense>
          </head>
          <body>
            <div>hello world</div>
          </body>
        </html>
      );
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head>
          <meta itemprop="head loading" />
        </head>
        <body>
          <div>hello world</div>
        </body>
      </html>,
    );

    await act(() => {
      resolveText('head');
    });

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head>
          <meta itemprop="" content="head" />
        </head>
        <body>
          <div>hello world</div>
        </body>
      </html>,
    );

    const root = ReactDOMClient.hydrateRoot(document, <App />);
    await waitForAll([]);

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head>
          <meta itemprop="" content="head" />
        </head>
        <body>
          <div>hello world</div>
        </body>
      </html>,
    );

    await act(() => {
      root.unmount();
    });
    await waitForAll([]);

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body />
      </html>,
    );
  });

  /** 三个Suspense分别位于html之前、包裹html、之后；html暂停时shellReady已true但流零字节，完成后doctype开头且before/after归入body。hydrate保持结构，unmount去属性并清空head/body。 */
  it('can render Suspense before, after, and around <html>', async () => {
    /**
     * 读取html缓存键后透传children，使包含html标签的边界延后完成。
     * @param value 暂停键。
     * @param children 文档树。
     * @returns children。
     */
    function BlockedOn({value, children}) {
      readText(value);
      return children;
    }

    /**
     * 以Fragment兄弟排列html前后内容及包裹html的Suspense，观察preamble合并而非独立输出fallback。
     * @returns 文档与兄弟内容。
     */
    function App() {
      return (
        <>
          <Suspense fallback="this fallback never renders">
            <div>before</div>
          </Suspense>
          <Suspense fallback="this fallback never renders">
            <BlockedOn value="html">
              <html lang="en">
                <head>
                  <meta itemProp="" content="non-floaty meta" />
                </head>
                <body>
                  <div>hello world</div>
                </body>
              </html>
            </BlockedOn>
          </Suspense>
          <Suspense fallback="this fallback never renders">
            <div>after</div>
          </Suspense>
        </>
      );
    }

    let content = '';
    writable.on('data', chunk => (content += chunk));

    let shellReady = false;
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />, {
        /** 将shellReady设true，供对比shell回调与实际首字节之间的时间差。 */
        onShellReady: () => {
          shellReady = true;
        },
      });
      pipe(writable);
    });

    // onShellReady 已触发，但包含 html/head/body 的 preamble 仍未就绪，flushCompletedQueues 不输出字节。
    // html 对应的数据 resolve 后，preamble 与文档内容才能一起写出。
    expect(shellReady).toBe(true);
    expect(content).toBe('');

    await act(() => {
      resolveText('html');
    });
    expect(content).toMatch(/^<!DOCTYPE html>/);
    expect(getVisibleChildren(document)).toEqual(
      <html lang="en">
        <head>
          <meta itemprop="" content="non-floaty meta" />
        </head>
        <body>
          <div>before</div>
          <div>hello world</div>
          <div>after</div>
        </body>
      </html>,
    );

    const root = ReactDOMClient.hydrateRoot(document, <App />);
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html lang="en">
        <head>
          <meta itemprop="" content="non-floaty meta" />
        </head>
        <body>
          <div>before</div>
          <div>hello world</div>
          <div>after</div>
        </body>
      </html>,
    );

    root.unmount();
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body />
      </html>,
    );
  });

  /** html内Suspense位于body前后及包裹body，meta含可提升与itemProp两类；完成body才flush完整文档，可提升meta进head、itemProp留body。hydrate核对结构及DEV非法嵌套警告，unmount清空。 */
  it('can render Suspense before, after, and around <body>', async () => {
    /**
     * 读取body缓存键后透传body树，推迟文档preamble确定。
     * @param value 暂停键。
     * @param children body内容。
     * @returns children。
     */
    function BlockedOn({value, children}) {
      readText(value);
      return children;
    }

    /**
     * html内组合body前后meta与暂停body，两种meta按是否itemProp区分提升及原位内容。
     * @returns 完整文档树。
     */
    function App() {
      return (
        <html>
          <Suspense fallback="this fallback never renders">
            <meta content="before" />
            <meta itemProp="" content="before" />
          </Suspense>
          <Suspense fallback="this fallback never renders">
            <BlockedOn value="body">
              <body lang="en">
                <div>hello world</div>
              </body>
            </BlockedOn>
          </Suspense>
          <Suspense fallback="this fallback never renders">
            <meta content="after" />
            <meta itemProp="" content="after" />
          </Suspense>
        </html>
      );
    }

    let content = '';
    writable.on('data', chunk => (content += chunk));

    let shellReady = false;
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />, {
        /** 记录shell已就绪；body仍暂停时流内容必须为空。 */
        onShellReady() {
          shellReady = true;
        },
      });
      pipe(writable);
    });

    expect(shellReady).toBe(true);
    expect(content).toBe('');

    await act(() => {
      resolveText('body');
    });
    expect(content).toMatch(/^<!DOCTYPE html>/);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head>
          <meta content="before" />
          <meta content="after" />
        </head>
        <body lang="en">
          <meta itemprop="" content="before" />
          <div>hello world</div>
          <meta itemprop="" content="after" />
        </body>
      </html>,
    );

    const root = ReactDOMClient.hydrateRoot(document, <App />);
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head>
          <meta content="before" />
          <meta content="after" />
        </head>
        <body lang="en">
          <meta itemprop="" content="before" />
          <div>hello world</div>
          <meta itemprop="" content="after" />
        </body>
      </html>,
    );
    assertConsoleErrorDev([
      'Cannot render a <meta> outside the main document if it has an `itemProp` prop. `itemProp` suggests the tag belongs to an `itemScope` which can appear anywhere in the DOM. If you were intending for React to hoist this <meta> remove the `itemProp` prop. Otherwise, try moving this tag into the <head> or <body> of the Document.',
      'In HTML, <meta> cannot be a child of <html>.\nThis will cause a hydration error.' +
        '\n' +
        '\n  <App>' +
        '\n>   <html>' +
        '\n      <Suspense fallback="this fallb...">' +
        '\n        <meta>' +
        '\n>       <meta itemProp="" content="before">' +
        '\n      ...' +
        '\n' +
        '\n    in meta (at **)' +
        '\n    in App (at **)',
      '<html> cannot contain a nested <meta>.\nSee this log for the ancestor stack trace.' +
        '\n    in html (at **)' +
        '\n    in App (at **)',
      'Cannot render a <meta> outside the main document if it has an `itemProp` prop. `itemProp` suggests the tag belongs to an `itemScope` which can appear anywhere in the DOM. If you were intending for React to hoist this <meta> remove the `itemProp` prop. Otherwise, try moving this tag into the <head> or <body> of the Document.',
    ]);

    await root.unmount();
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body />
      </html>,
    );
  });

  /** html内Suspense位于head前后及包裹head；head未完成时shell ready但零字节，完成后可提升meta进head、外部itemProp留body。hydrate核对非法位置警告及结构，unmount清空。 */
  it('can render Suspense before, after, and around <head>', async () => {
    /**
     * 读取head缓存键后透传head树，使preamble等待该任务。
     * @param value 暂停键。
     * @param children head内容。
     * @returns children。
     */
    function BlockedOn({value, children}) {
      readText(value);
      return children;
    }

    /**
     * 在html内按head前后及包裹head安排Suspense，并显式提供body；测试meta提升与非法原位位置警告。
     * @returns 完整文档树。
     */
    function App() {
      return (
        <html>
          <Suspense fallback="this fallback never renders">
            <meta content="before" />
            <meta itemProp="" content="before" />
          </Suspense>
          <Suspense fallback="this fallback never renders">
            <BlockedOn value="head">
              <head lang="en">
                <meta itemProp="" />
              </head>
            </BlockedOn>
          </Suspense>
          <Suspense fallback="this fallback never renders">
            <meta content="after" />
            <meta itemProp="" content="after" />
          </Suspense>
          <body>
            <div>hello world</div>
          </body>
        </html>
      );
    }

    let content = '';
    writable.on('data', chunk => (content += chunk));

    let shellReady = false;
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />, {
        /** 记录shell就绪，区别于head完成后才开始flush的时点。 */
        onShellReady() {
          shellReady = true;
        },
      });
      pipe(writable);
    });

    expect(shellReady).toBe(true);
    expect(content).toBe('');

    await act(() => {
      resolveText('head');
    });
    expect(content).toMatch(/^<!DOCTYPE html>/);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head lang="en">
          <meta content="before" />
          <meta content="after" />
          <meta itemprop="" />
        </head>
        <body>
          <meta itemprop="" content="before" />
          <meta itemprop="" content="after" />
          <div>hello world</div>
        </body>
      </html>,
    );

    const root = ReactDOMClient.hydrateRoot(document, <App />);
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head lang="en">
          <meta content="before" />
          <meta content="after" />
          <meta itemprop="" />
        </head>
        <body>
          <meta itemprop="" content="before" />
          <meta itemprop="" content="after" />
          <div>hello world</div>
        </body>
      </html>,
    );
    assertConsoleErrorDev([
      'Cannot render a <meta> outside the main document if it has an `itemProp` prop. `itemProp` suggests the tag belongs to an `itemScope` which can appear anywhere in the DOM. If you were intending for React to hoist this <meta> remove the `itemProp` prop. Otherwise, try moving this tag into the <head> or <body> of the Document.',
      'In HTML, <meta> cannot be a child of <html>.\nThis will cause a hydration error.' +
        '\n' +
        '\n  <App>' +
        '\n>   <html>' +
        '\n      <Suspense fallback="this fallb...">' +
        '\n        <meta>' +
        '\n>       <meta itemProp="" content="before">' +
        '\n      ...' +
        '\n' +
        '\n    in meta (at **)' +
        '\n    in App (at **)',
      '<html> cannot contain a nested <meta>.\nSee this log for the ancestor stack trace.' +
        '\n    in html (at **)' +
        '\n    in App (at **)',
      'Cannot render a <meta> outside the main document if it has an `itemProp` prop. `itemProp` suggests the tag belongs to an `itemScope` which can appear anywhere in the DOM. If you were intending for React to hoist this <meta> remove the `itemProp` prop. Otherwise, try moving this tag into the <head> or <body> of the Document.',
    ]);

    await root.unmount();
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body />
      </html>,
    );
  });

  /** html/body主树中的Boom仅服务器抛错，外层Suspense输出带error属性的完整fallback文档；核对shell/doctype/一次错误。客户端关闭Boom后改为content文档并报一次接管，unmount去属性且清空。 */
  it('will render fallback Document when erroring a boundary above the body and recover on the client', async () => {
    let serverRendering = true;
    /**
     * serverRendering为真时抛Boom!，客户端关闭后返回null，便于文档fallback恢复。
     * @returns null。
     * @throws 服务器Boom!。
     */
    function Boom() {
      if (serverRendering) {
        throw new Error('Boom!');
      }
      return null;
    }

    /**
     * 用完整error文档作为Suspense fallback，主文档在body内渲染Boom并带content属性。
     * @returns 文档边界。
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

    let content = '';
    writable.on('data', chunk => (content += chunk));

    let shellReady = false;
    const errors = [];
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />, {
        /** 记录fallback文档shell已就绪。 */
        onShellReady() {
          shellReady = true;
        },
        /**
         * 保存服务器Boom!错误对象，断言一次错误。
         * @param e 服务器错误。
         */
        onError(e) {
          errors.push(e);
        },
      });
      pipe(writable);
    });

    expect(shellReady).toBe(true);
    expect(content).toMatch(/^<!DOCTYPE html>/);
    expect(errors).toEqual([new Error('Boom!')]);
    expect(getVisibleChildren(document)).toEqual(
      <html data-error-html="">
        <head />
        <body data-error-body="">
          <span>hello error</span>
        </body>
      </html>,
    );

    serverRendering = false;

    const recoverableErrors = [];
    const root = ReactDOMClient.hydrateRoot(document, <App />, {
      /**
       * 保存完整文档由fallback接管为主树的恢复错误。
       * @param err 恢复错误。
       */
      onRecoverableError(err) {
        recoverableErrors.push(err);
      },
    });
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html data-content-html="">
        <head />
        <body data-content-body="">
          <span>hello world</span>
        </body>
      </html>,
    );
    expect(recoverableErrors).toEqual([
      __DEV__
        ? new Error(
            'Switched to client rendering because the server rendering errored:\n\nBoom!',
          )
        : new Error(
            'The server could not finish this Suspense boundary, likely due to an error during server rendering. Switched to client rendering.',
          ),
    ]);

    root.unmount();
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body />
      </html>,
    );
  });

  /** 主文档服务器Boom失败，但边界外前后meta与stylesheet均提升进fallback head；客户端恢复后保留提升资源、移除fallback非提升meta。unmount后普通meta移除、两条stylesheet仍保留，验证资源持久行为。 */
  it('will hoist resources and hositables from a primary tree into the <head> of a client rendered fallback', async () => {
    let serverRendering = true;
    /**
     * 仅服务器抛Boom!，客户端返回null，让提升资源测试可恢复主文档。
     * @returns null。
     * @throws Boom!。
     */
    function Boom() {
      if (serverRendering) {
        throw new Error('Boom!');
      }
      return null;
    }

    /**
     * 边界前后各放meta/stylesheet，fallback head用itemProp保留原位meta；比较恢复与卸载时资源和普通节点清理。
     * @returns 带提升资源的文档边界。
     */
    function App() {
      return (
        <>
          <meta content="hoistable before" />
          <link rel="stylesheet" href="hoistable before" precedence="default" />
          <Suspense
            fallback={
              <html data-error-html="">
                <head data-error-head="">
                  {/*
 * 必须把它设为不可提升项，因为当前不会在 fallback 内发出可提升项；hydration 时也无法清理它们。
                      */}
                  <meta itemProp="" content="error document" />
                </head>
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
          <meta content="hoistable after" />
          <link rel="stylesheet" href="hoistable after" precedence="default" />
        </>
      );
    }

    let content = '';
    writable.on('data', chunk => (content += chunk));

    let shellReady = false;
    const errors = [];
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />, {
        /** 记录fallback文档shell就绪，供doctype输出断言。 */
        onShellReady() {
          shellReady = true;
        },
        /**
         * 保存一次服务器Boom!。
         * @param e 服务器错误。
         */
        onError(e) {
          errors.push(e);
        },
      });
      pipe(writable);
    });

    expect(shellReady).toBe(true);
    expect(content).toMatch(/^<!DOCTYPE html>/);
    expect(errors).toEqual([new Error('Boom!')]);
    expect(getVisibleChildren(document)).toEqual(
      <html data-error-html="">
        <head data-error-head="">
          <link
            rel="stylesheet"
            href="hoistable before"
            data-precedence="default"
          />
          <link
            rel="stylesheet"
            href="hoistable after"
            data-precedence="default"
          />
          <meta content="hoistable before" />
          <meta content="hoistable after" />
          <meta itemprop="" content="error document" />
        </head>
        <body data-error-body="">
          <span>hello error</span>
        </body>
      </html>,
    );

    serverRendering = false;

    const recoverableErrors = [];
    const root = ReactDOMClient.hydrateRoot(document, <App />, {
      /**
       * 保存资源所在文档边界的客户端接管错误。
       * @param err 恢复错误。
       */
      onRecoverableError(err) {
        recoverableErrors.push(err);
      },
    });
    await waitForAll([]);
    expect(recoverableErrors).toEqual([
      __DEV__
        ? new Error(
            'Switched to client rendering because the server rendering errored:\n\nBoom!',
          )
        : new Error(
            'The server could not finish this Suspense boundary, likely due to an error during server rendering. Switched to client rendering.',
          ),
    ]);
    expect(getVisibleChildren(document)).toEqual(
      <html data-content-html="">
        <head>
          <link
            rel="stylesheet"
            href="hoistable before"
            data-precedence="default"
          />
          <link
            rel="stylesheet"
            href="hoistable after"
            data-precedence="default"
          />
          <meta content="hoistable before" />
          <meta content="hoistable after" />
        </head>
        <body data-content-body="">
          <span>hello world</span>
        </body>
      </html>,
    );

    root.unmount();
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head>
          <link
            rel="stylesheet"
            href="hoistable before"
            data-precedence="default"
          />
          <link
            rel="stylesheet"
            href="hoistable after"
            data-precedence="default"
          />
        </head>
        <body />
      </html>,
    );
  });

  /** 完整文档同一task中先有暂停任务，后Abort组件触发controller→abort(boom)。act抛boom且onError按Abort、Pending、Suspense Fallback记录三栈，文档仍默认container，验证尚未flush便中止的preamble尝试。 */
  it('will attempt to render the preamble inline to allow rendering before a later abort in the same task', async () => {
    const promise = new Promise(() => {});
    /**
     * use永不完成promise，产生在稍后同步中止时仍需收尾的Pending任务。
     * @throws 暂停信号。
     */
    function Pending() {
      React.use(promise);
    }

    const controller = new AbortController();
    /**
     * 同步触发controller.abort，由已安装signal监听器转为Fizz abort字符串boom，再返回Comp。
     * @returns Comp。
     */
    function Abort() {
      controller.abort();
      return <Comp />;
    }

    /**
     * 返回null，作为Abort触发后仍返回组件元素的路径。
     * @returns null。
     */
    function Comp() {
      return null;
    }

    /**
     * 完整html先放meta/main及暂停边界，再渲染Abort，制造同task尚未flush的preamble中止。
     * @returns 文档树。
     */
    function App() {
      return (
        <html>
          <head>
            <meta content="here" />
          </head>
          <body>
            <main>hello</main>
            <Suspense>
              <Pending />
            </Suspense>
            <Abort />
          </body>
        </html>
      );
    }

    const signal = controller.signal;

    let thrownError = null;
    const errors = [];
    try {
      await act(() => {
        const {pipe, abort} = renderToPipeableStream(<App />, {
          /**
           * 保存中止值和规范化componentStack，核对Abort、Pending及Suspense Fallback三项任务顺序。
           * @param e 中止值。
           * @param ei 含组件栈的信息。
           */
          onError(e, ei) {
            errors.push({
              error: e,
              componentStack: normalizeCodeLocInfo(ei.componentStack),
            });
          },
        });
        signal.addEventListener('abort', () => abort('boom'));
        pipe(writable);
      });
    } catch (e) {
      thrownError = e;
    }

    expect(thrownError).toBe('boom');
    expect(errors).toEqual([
      {
        error: 'boom',
        componentStack: componentStack(['Abort', 'body', 'html', 'App']),
      },
      {
        error: 'boom',
        componentStack: componentStack([
          'Pending',
          'Suspense',
          'body',
          'html',
          'App',
        ]),
      },
      {
        error: 'boom',
        componentStack: componentStack([
          'Suspense Fallback',
          'body',
          'html',
          'App',
        ]),
      },
    ]);

    // 我们期望渲染在流式传输任何内容之前抛出错误，因此默认文档仍然加载。
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <div id="container" />
        </body>
      </html>,
    );
  });

  /** 可能贡献preamble的第一根边界暂停、第二位于main内暂停，第三位于div内永远暂停；shell ready后仍零字节，完成second仍不flush，拒绝first才输出inner fallback/second/第三fallback并仅报Boom!。 */
  it('Will wait to flush Document chunks until all boundaries which might contain a preamble are errored or resolved', async () => {
    let rejectFirst;
    const firstPromise = new Promise((_, reject) => {
      rejectFirst = reject;
    });
    /**
     * use可外部拒绝firstPromise后透传children，使可能贡献preamble的第一边界一直待定到拒绝。
     * @param children 主内容。
     * @returns children。
     * @throws 暂停或拒绝值。
     */
    function First({children}) {
      use(firstPromise);
      return children;
    }

    let resolveSecond;
    const secondPromise = new Promise(resolve => {
      resolveSecond = resolve;
    });
    /**
     * use可外部完成secondPromise，完成后透传children；main父上下文使其不贡献文档preamble。
     * @param children 主内容。
     * @returns children。
     */
    function Second({children}) {
      use(secondPromise);
      return children;
    }

    const hangingPromise = new Promise(() => {});
    /**
     * use永不完成hangingPromise，作为div内不阻止preamble确定的长期暂停任务。
     * @param children 主内容。
     * @returns 正常完成时children。
     * @throws 暂停信号。
     */
    function Hanging({children}) {
      use(hangingPromise);
      return children;
    }

    /**
     * 组合根级嵌套Suspense、main内边界与div内边界，区分可能贡献preamble的任务及普通内容任务。
     * @returns 三分支树。
     */
    function App() {
      return (
        <>
          <Suspense fallback={<span>loading...</span>}>
            <Suspense fallback={<span>inner loading...</span>}>
              <First>
                <span>first</span>
              </First>
            </Suspense>
          </Suspense>
          <Suspense fallback={<span>loading...</span>}>
            <main>
              <Second>
                <span>second</span>
              </Second>
            </main>
          </Suspense>
          <div>
            <Suspense fallback={<span>loading...</span>}>
              <Hanging>
                <span>third</span>
              </Hanging>
            </Suspense>
          </div>
        </>
      );
    }

    let content = '';
    writable.on('data', chunk => (content += chunk));

    let shellReady = false;
    const errors = [];
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />, {
        /** 记录shell已就绪；此时第一潜在preamble任务仍暂停，流不输出字节。 */
        onShellReady() {
          shellReady = true;
        },
        /**
         * 保存first拒绝原因Boom!，用于开始flush时的错误断言。
         * @param e 服务器错误。
         */
        onError(e) {
          errors.push(e);
        },
      });
      pipe(writable);
    });

    expect(shellReady).toBe(true);
    expect(content).toBe('');

    await act(() => {
      resolveSecond();
    });
    expect(content).toBe('');

    await act(() => {
      rejectFirst('Boom!');
    });
    expect(content.length).toBeGreaterThan(0);
    expect(errors).toEqual(['Boom!']);

    expect(getVisibleChildren(container)).toEqual([
      <span>inner loading...</span>,
      <main>
        <span>second</span>
      </main>,
      <div>
        <span>loading...</span>
      </div>,
    ]);
  });

  /** head主分支服务器Boom失败、body正常，服务器输出fallback head+primary body；客户端恢复为primary head/body并报一次接管，unmount清空，验证文档不同部分可独立选fallback。 */
  it('Can render a fallback <head> alongside a non-fallback body', async () => {
    let serverRendering = true;
    /**
     * 仅服务器抛Boom!使head走fallback，客户端关闭后返回null。
     * @returns null。
     * @throws Boom!。
     */
    function Boom() {
      if (serverRendering) {
        throw new Error('Boom!');
      }
      return null;
    }

    /**
     * 以两个独立Suspense分别产出head和body，只有head主分支包含Boom，形成fallback head与primary body。
     * @returns 文档树。
     */
    function App() {
      return (
        <html>
          <Suspense
            fallback={
              <head data-fallback="">
                <meta itemProp="" content="fallback" />
              </head>
            }>
            <Boom />
            <head data-primary="">
              <meta itemProp="" content="primary" />
            </head>
          </Suspense>
          <Suspense
            fallback={
              <body data-fallback="">
                <div>fallback body</div>
              </body>
            }>
            <body data-primary="">
              <div>primary body</div>
            </body>
          </Suspense>
        </html>
      );
    }

    let content = '';
    writable.on('data', chunk => (content += chunk));

    let shellReady = false;
    const errors = [];
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />, {
        /** 记录组合文档shell就绪，配合doctype断言。 */
        onShellReady() {
          shellReady = true;
        },
        /**
         * 保存head主分支的服务器错误。
         * @param e 服务器错误。
         */
        onError(e) {
          errors.push(e);
        },
      });
      pipe(writable);
    });

    expect(shellReady).toBe(true);
    expect(content).toMatch(/^<!DOCTYPE html>/);
    expect(errors).toEqual([new Error('Boom!')]);

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head data-fallback="">
          <meta itemprop="" content="fallback" />
        </head>
        <body data-primary="">
          <div>primary body</div>
        </body>
      </html>,
    );

    serverRendering = false;

    const recoverableErrors = [];
    const root = ReactDOMClient.hydrateRoot(document, <App />, {
      /**
       * 保存head从fallback恢复primary的客户端接管错误。
       * @param err 恢复错误。
       */
      onRecoverableError(err) {
        recoverableErrors.push(err);
      },
    });
    await waitForAll([]);
    expect(recoverableErrors).toEqual([
      __DEV__
        ? new Error(
            'Switched to client rendering because the server rendering errored:\n\nBoom!',
          )
        : new Error(
            'The server could not finish this Suspense boundary, likely due to an error during server rendering. Switched to client rendering.',
          ),
    ]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head data-primary="">
          <meta itemprop="" content="primary" />
        </head>
        <body data-primary="">
          <div>primary body</div>
        </body>
      </html>,
    );

    root.unmount();
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body />
      </html>,
    );
  });

  /** body主分支服务器Boom失败、head正常，服务器输出primary head+fallback body；客户端恢复primary body并报一次接管，unmount清空，验证与head失败对称的组合。 */
  it('Can render a fallback <body> alongside a non-fallback head', async () => {
    let serverRendering = true;
    /**
     * 仅服务器抛Boom!使body走fallback，客户端关闭后返回null。
     * @returns null。
     * @throws Boom!。
     */
    function Boom() {
      if (serverRendering) {
        throw new Error('Boom!');
      }
      return null;
    }

    /**
     * 用独立Suspense产出head/body，只有body主分支含Boom，形成primary head与fallback body。
     * @returns 文档树。
     */
    function App() {
      return (
        <html>
          <Suspense
            fallback={
              <head data-fallback="">
                <meta itemProp="" content="fallback" />
              </head>
            }>
            <head data-primary="">
              <meta itemProp="" content="primary" />
            </head>
          </Suspense>
          <Suspense
            fallback={
              <body data-fallback="">
                <div>fallback body</div>
              </body>
            }>
            <Boom />
            <body data-primary="">
              <div>primary body</div>
            </body>
          </Suspense>
        </html>
      );
    }

    let content = '';
    writable.on('data', chunk => (content += chunk));

    let shellReady = false;
    const errors = [];
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />, {
        /** 记录组合文档shell就绪。 */
        onShellReady() {
          shellReady = true;
        },
        /**
         * 保存body主分支的服务器Boom!错误。
         * @param e 服务器错误。
         */
        onError(e) {
          errors.push(e);
        },
      });
      pipe(writable);
    });

    expect(shellReady).toBe(true);
    expect(content).toMatch(/^<!DOCTYPE html>/);
    expect(errors).toEqual([new Error('Boom!')]);

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head data-primary="">
          <meta itemprop="" content="primary" />
        </head>
        <body data-fallback="">
          <div>fallback body</div>
        </body>
      </html>,
    );

    serverRendering = false;

    const recoverableErrors = [];
    const root = ReactDOMClient.hydrateRoot(document, <App />, {
      /**
       * 保存body fallback恢复为primary时的客户端接管错误。
       * @param err 恢复错误。
       */
      onRecoverableError(err) {
        recoverableErrors.push(err);
      },
    });
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head data-primary="">
          <meta itemprop="" content="primary" />
        </head>
        <body data-primary="">
          <div>primary body</div>
        </body>
      </html>,
    );
    expect(recoverableErrors).toEqual([
      __DEV__
        ? new Error(
            'Switched to client rendering because the server rendering errored:\n\nBoom!',
          )
        : new Error(
            'The server could not finish this Suspense boundary, likely due to an error during server rendering. Switched to client rendering.',
          ),
    ]);

    root.unmount();
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body />
      </html>,
    );
  });

  /** head与含html/body的Suspense作为Fragment兄弟，服务器合并成一个带x/y属性的文档并发doctype；hydrate保持结构，unmount去属性且清空，验证head无需词法嵌套html。 */
  it('Can render a <head> outside of a containing <html>', async () => {
    /**
     * Fragment中含html/body的Suspense与独立head作为兄弟，测试服务器合并同一文档的标签。
     * @returns 文档标签Fragment。
     */
    function App() {
      return (
        <>
          <Suspense>
            <html data-x="">
              <body data-x="">
                <span>hello world</span>
              </body>
            </html>
          </Suspense>
          <head data-y="">
            <meta itemProp="" />
          </head>
        </>
      );
    }

    let content = '';
    writable.on('data', chunk => (content += chunk));

    let shellReady = false;
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />, {
        /** 记录兄弟head合并后shell就绪。 */
        onShellReady() {
          shellReady = true;
        },
      });
      pipe(writable);
    });

    expect(shellReady).toBe(true);
    expect(content).toMatch(/^<!DOCTYPE html>/);

    expect(getVisibleChildren(document)).toEqual(
      <html data-x="">
        <head data-y="">
          <meta itemprop="" />
        </head>
        <body data-x="">
          <span>hello world</span>
        </body>
      </html>,
    );

    const root = ReactDOMClient.hydrateRoot(document, <App />);
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html data-x="">
        <head data-y="">
          <meta itemprop="" />
        </head>
        <body data-x="">
          <span>hello world</span>
        </body>
      </html>,
    );

    root.unmount();
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body />
      </html>,
    );
  });

  /** Html、DocumentMetadata、Main各间接产出文档标签并等待独立promise；依次完成语言、正文仍零字节，最后metadata完成才输出完整doctype文档。hydrate保持es/metadata/正文，unmount清空。 */
  it('can render preamble tags in deeply nested indirect component trees', async () => {
    /**
     * 通过Html、DocumentMetadata和Main三层间接组件建立文档标签，检查preamble等待异步来源。
     * @returns 间接文档树。
     */
    function App() {
      return (
        <Html>
          <DocumentMetadata />
          <Main />
        </Html>
      );
    }

    let loadLanguage;
    const langPromise = new Promise(r => {
      loadLanguage = r;
    });
    /**
     * 用FallbackHtml包裹相同children兜底，MainHtml等待语言promise；fallback文档也可包含后续暂停head/body。
     * @param children 元数据与正文组件。
     * @returns html边界。
     */
    function Html({children}) {
      return (
        <Suspense fallback={<FallbackHtml>{children}</FallbackHtml>}>
          <MainHtml>{children}</MainHtml>
        </Suspense>
      );
    }
    /**
     * 输出lang=default的fallback html并保留children。
     * @param children 文档内容。
     * @returns html。
     */
    function FallbackHtml({children}) {
      return <html lang="default">{children}</html>;
    }
    /**
     * use语言promise，完成后以该lang输出html并透传children。
     * @param children 文档内容。
     * @returns html。
     */
    function MainHtml({children}) {
      const lang = use(langPromise);
      return <html lang={lang}>{children}</html>;
    }

    let loadMetadata;
    const metadataPromise = new Promise(r => {
      loadMetadata = r;
    });
    /**
     * 以独立Suspense选择fallback head或等待元数据的主head。
     * @returns head边界。
     */
    function DocumentMetadata() {
      return (
        <Suspense fallback={<FallbackDocumentMetadata />}>
          <MainDocumentMetadata />
        </Suspense>
      );
    }
    /**
     * 输出带fallback属性及fallback metadata的head，供元数据暂停时选择。
     * @returns head。
     */
    function FallbackDocumentMetadata() {
      return (
        <head data-fallback="">
          <meta content="fallback metadata" />
        </head>
      );
    }
    /**
     * use元数据数组并按内容作为key生成meta，完成后输出带main属性的head。
     * @returns head。
     */
    function MainDocumentMetadata() {
      const metadata = use(metadataPromise);
      return (
        <head data-main="">
          {metadata.map(m => (
            <meta content={m} key={m} />
          ))}
        </head>
      );
    }

    let loadMainContent;
    const mainContentPromise = new Promise(r => {
      loadMainContent = r;
    });
    /**
     * 以Skeleton兜底等待PrimaryContent，间接创建body标签。
     * @returns body边界。
     */
    function Main() {
      return (
        <Suspense fallback={<Skeleton />}>
          <PrimaryContent />
        </Suspense>
      );
    }
    /**
     * 输出fallback body与Skeleton UI，正文未完成时作为文档主体候选。
     * @returns body。
     */
    function Skeleton() {
      return (
        <body data-fallback="">
          <div>Skeleton UI</div>
        </body>
      );
    }
    /**
     * use正文promise并输出main body及内容div，等待后形成完整主preamble。
     * @returns body。
     */
    function PrimaryContent() {
      const content = use(mainContentPromise);
      return (
        <body data-main="">
          <div>{content}</div>
        </body>
      );
    }

    let content = '';
    writable.on('data', chunk => (content += chunk));

    let shellReady = false;
    const errors = [];
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />, {
        /** 记录shell已就绪，仍需等语言/正文/元数据确定完整preamble才flush。 */
        onShellReady() {
          shellReady = true;
        },
        /**
         * 收集间接文档树的服务器错误；本例三个promise均成功。
         * @param e 服务器错误。
         */
        onError(e) {
          errors.push(e);
        },
      });
      pipe(writable);
    });

    expect(shellReady).toBe(true);
    expect(content).toBe('');

    await act(() => {
      loadLanguage('es');
    });
    expect(content).toBe('');

    await act(() => {
      loadMainContent('This is soooo cool!');
    });
    expect(content).toBe('');

    await act(() => {
      loadMetadata(['author', 'published date']);
    });
    expect(content).toMatch(/^<!DOCTYPE html>/);

    expect(getVisibleChildren(document)).toEqual(
      <html lang="es">
        <head data-main="">
          <meta content="author" />
          <meta content="published date" />
        </head>
        <body data-main="">
          <div>This is soooo cool!</div>
        </body>
      </html>,
    );

    const root = ReactDOMClient.hydrateRoot(document, <App />);
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html lang="es">
        <head data-main="">
          <meta content="author" />
          <meta content="published date" />
        </head>
        <body data-main="">
          <div>This is soooo cool!</div>
        </body>
      </html>,
    );

    root.unmount();
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body />
      </html>,
    );
  });

  /** 文档前后异步div、body文本、外置head分别暂停；完成body仍零字节，完成head后立即flush而前后仍fallback。hydrate后再完成before/after显示全部，验证完整preamble可用即输出，不等无关任务。 */
  it('will flush the preamble as soon as a complete preamble is available', async () => {
    /**
     * 读取head缓存键后透传meta，使外置head边界暂停。
     * @param value 缓存键。
     * @param children 完成内容。
     * @returns children。
     */
    function BlockedOn({value, children}) {
      readText(value);
      return children;
    }

    /**
     * 文档前后内容、html/body及外置head分别设Suspense；body/head完成即可组成preamble，无需等待before/after。
     * @returns 四边界Fragment。
     */
    function App() {
      return (
        <>
          <Suspense fallback="loading before...">
            <div>
              <AsyncText text="before" />
            </div>
          </Suspense>
          <Suspense fallback="loading document...">
            <html>
              <body>
                <div>
                  <AsyncText text="body" />
                </div>
              </body>
            </html>
          </Suspense>
          <Suspense fallback="loading head...">
            <head>
              <BlockedOn value="head">
                <meta content="head" />
              </BlockedOn>
            </head>
          </Suspense>
          <Suspense fallback="loading after...">
            <div>
              <AsyncText text="after" />
            </div>
          </Suspense>
        </>
      );
    }

    let content = '';
    writable.on('data', chunk => (content += chunk));

    let shellReady = false;
    await act(() => {
      const {pipe} = renderToPipeableStream(<App />, {
        /** 记录shell就绪，供比较body独自完成和head也完成时的首字节时点。 */
        onShellReady() {
          shellReady = true;
        },
      });
      pipe(writable);
    });

    expect(shellReady).toBe(true);
    expect(content).toBe('');

    await act(() => {
      resolveText('body');
    });
    expect(content).toBe('');

    await act(() => {
      resolveText('head');
    });
    expect(content).toMatch(/^<!DOCTYPE html>/);

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head>
          <meta content="head" />
        </head>
        <body>
          loading before...
          <div>body</div>
          loading after...
        </body>
      </html>,
    );

    const root = ReactDOMClient.hydrateRoot(document, <App />);
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head>
          <meta content="head" />
        </head>
        <body>
          loading before...
          <div>body</div>
          loading after...
        </body>
      </html>,
    );

    await act(() => {
      resolveText('before');
      resolveText('after');
    });
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head>
          <meta content="head" />
        </head>
        <body>
          <div>before</div>
          <div>body</div>
          <div>after</div>
        </body>
      </html>,
    );

    root.unmount();
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body />
      </html>,
    );
  });

  /** 服务器html/head/body用data-x与server内容，客户端改data-y、meta name及client文本；一次文本不匹配后断言服务器head节点与属性已清理并换客户端内容，unmount清空，验证文档级接管清理。 */
  it('will clean up the head when a hydration mismatch causes a boundary to recover on the client', async () => {
    let content = 'server';

    /**
     * 输出data-x及server文本的完整文档，head meta使用content属性，作为hydration旧树。
     * @returns 服务器文档。
     */
    function ServerApp() {
      return (
        <Suspense>
          <html data-x={content}>
            <head data-x={content}>
              <meta itemProp="" content={content} />
            </head>
            <body data-x={content}>{content}</body>
          </html>
        </Suspense>
      );
    }

    /**
     * 输出data-y及client文本，head meta改name属性，制造文本不匹配并检查旧head清理。
     * @returns 客户端文档。
     */
    function ClientApp() {
      return (
        <Suspense>
          <html data-y={content}>
            <head data-y={content}>
              <meta itemProp="" name={content} />
            </head>
            <body data-y={content}>{content}</body>
          </html>
        </Suspense>
      );
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<ServerApp />);
      pipe(writable);
    });
    expect(getVisibleChildren(document)).toEqual(
      <html data-x="server">
        <head data-x="server">
          <meta itemprop="" content="server" />
        </head>
        <body data-x="server">server</body>
      </html>,
    );

    content = 'client';

    const recoverableErrors = [];
    const root = ReactDOMClient.hydrateRoot(document, <ClientApp />, {
      /**
       * 保存文档边界文本不匹配的恢复消息，预期一项。
       * @param err 恢复错误。
       */
      onRecoverableError(err) {
        recoverableErrors.push(err.message);
      },
    });
    await waitForAll([]);
    expect(getVisibleChildren(document)).toEqual(
      <html data-y="client">
        <head data-y="client">
          <meta itemprop="" name="client" />
        </head>
        <body data-y="client">client</body>
      </html>,
    );
    expect(recoverableErrors).toEqual([
      expect.stringContaining(
        "Hydration failed because the server rendered text didn't match the client.",
      ),
    ]);

    root.unmount();
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body />
      </html>,
    );
  });

  /** 两条同precedence style携带匹配nonce且选项nonce.style相同；断言合并style的data-href包含foo bar、规则串联且nonce保留，验证样式nonce配置传播。 */
  it('can render styles with nonce', async () => {
    CSPnonce = 'R4nd0m';
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <>
          <style
            href="foo"
            precedence="default"
            nonce={CSPnonce}>{`.foo { color: hotpink; }`}</style>
          <style
            href="bar"
            precedence="default"
            nonce={CSPnonce}>{`.bar { background-color: blue; }`}</style>
        </>,
        {nonce: {style: CSPnonce}},
      );
      pipe(writable);
    });
    expect(document.querySelector('style').nonce).toBe(CSPnonce);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <div id="container">
            <style
              data-precedence="default"
              data-href="foo bar"
              nonce={
                CSPnonce
              }>{`.foo { color: hotpink; }.bar { background-color: blue; }`}</style>
          </div>
        </body>
      </html>,
    );
  });

  /** 两条同precedence style的nonce分别匹配与重复字符串不匹配；DEV警告不匹配项，最终合并style只含foo规则，验证不匹配nonce的可管理样式被丢弃。 */
  it("shouldn't render styles with mismatched nonce", async () => {
    CSPnonce = 'R4nd0m';
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <>
          <style
            href="foo"
            precedence="default"
            nonce={CSPnonce}>{`.foo { color: hotpink; }`}</style>
          <style
            href="bar"
            precedence="default"
            nonce={`${CSPnonce}${CSPnonce}`}>{`.bar { background-color: blue; }`}</style>
        </>,
        {nonce: {style: CSPnonce}},
      );
      pipe(writable);
    });
    assertConsoleErrorDev([
      'React encountered a style tag with `precedence` "default" and `nonce` "R4nd0mR4nd0m". When React manages style rules using `precedence` it will only include rules if the nonce matches the style nonce "R4nd0m" that was included with this render.' +
        '\n    in style (at **)',
    ]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <div id="container">
            <style
              data-precedence="default"
              data-href="foo"
              nonce={CSPnonce}>{`.foo { color: hotpink; }`}</style>
          </div>
        </body>
      </html>,
    );
  });

  /** style声明nonce但render选项未提供style nonce；DEV警告后仍输出foo规则，最终没有nonce属性，验证未配置时忽略元素nonce。 */
  it("should render styles without nonce when render call doesn't receive nonce", async () => {
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <>
          <style
            href="foo"
            precedence="default"
            nonce="R4nd0m">{`.foo { color: hotpink; }`}</style>
        </>,
      );
      pipe(writable);
    });
    assertConsoleErrorDev([
      'React encountered a style tag with `precedence` "default" and `nonce` "R4nd0m". When React manages style rules using `precedence` it will only include a nonce attributes if you also provide the same style nonce value as a render option.' +
        '\n    in style (at **)',
    ]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <div id="container">
            <style
              data-precedence="default"
              data-href="foo">{`.foo { color: hotpink; }`}</style>
          </div>
        </body>
      </html>,
    );
  });

  /** style元素有nonce，render只给字符串nonce（专用于脚本）；DEV警告且style输出不含nonce，验证字符串nonce不授权style nonce。 */
  it('should render styles without nonce when render call receives a string nonce dedicated to scripts', async () => {
    CSPnonce = 'R4nd0m';
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <>
          <style
            href="foo"
            precedence="default"
            nonce={CSPnonce}>{`.foo { color: hotpink; }`}</style>
        </>,
        {nonce: CSPnonce},
      );
      pipe(writable);
    });
    assertConsoleErrorDev([
      'React encountered a style tag with `precedence` "default" and `nonce` "R4nd0m". When React manages style rules using `precedence` it will only include a nonce attributes if you also provide the same style nonce value as a render option.' +
        '\n    in style (at **)',
    ]);
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <div id="container">
            <style
              data-precedence="default"
              data-href="foo">{`.foo { color: hotpink; }`}</style>
          </div>
        </body>
      </html>,
    );
  });

  /** 选项分别设置script R4nd0m和style D1ff3r3nt，输出bootstrapScriptContent与foo样式；断言匹配脚本nonce的末项文本及style独立nonce，验证两类nonce可以不同。 */
  it('should allow for different script and style nonces', async () => {
    CSPnonce = 'R4nd0m';
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <>
          <style
            href="foo"
            precedence="default"
            nonce="D1ff3r3nt">{`.foo { color: hotpink; }`}</style>
        </>,
        {
          nonce: {script: CSPnonce, style: 'D1ff3r3nt'},
          bootstrapScriptContent: 'function noop(){}',
        },
      );
      pipe(writable);
    });
    const scripts = Array.from(container.getElementsByTagName('script')).filter(
      node => node.getAttribute('nonce') === CSPnonce,
    );
    expect(scripts[scripts.length - 1].textContent).toBe('function noop(){}');
    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <div id="container">
            <style
              data-precedence="default"
              data-href="foo"
              nonce="D1ff3r3nt">{`.foo { color: hotpink; }`}</style>
          </div>
        </body>
      </html>,
    );
  });

  /** 父fallback中promise1先解锁深层边界，promise3永远暂停；主内容promise2与promise1同一act完成。断言从Loading直接Success!且无错误冒出，覆盖丢弃部分完成的深层fallback子树。 */
  it('should not error when discarding deeply nested Suspense boundaries in a parent fallback partially complete before the parent boundary resolves', async () => {
    let resolve1;
    const promise1 = new Promise(r => (resolve1 = r));
    let resolve2;
    const promise2 = new Promise(r => (resolve2 = r));
    const promise3 = new Promise(r => {});

    /**
     * use指定promise后透传children，使fallback深层或主内容各自暂停。
     * @param children 完成后内容。
     * @param promise 当前层等待项。
     * @returns children。
     */
    function Use({children, promise}) {
      React.use(promise);
      return children;
    }
    /**
     * 父fallback中嵌套两层暂停边界且带宿主div包装，主内容另等promise2，测试部分fallback完成后整体废弃。
     * @returns 深fallback树。
     */
    function App() {
      return (
        <div>
          <Suspense
            fallback={
              <div>
                <Suspense fallback="Loading...">
                  <div>
                    <Use promise={promise1}>
                      <div>
                        <Suspense fallback="Loading more...">
                          <div>
                            <Use promise={promise3}>
                              <div>deep fallback</div>
                            </Use>
                          </div>
                        </Suspense>
                      </div>
                    </Use>
                  </div>
                </Suspense>
              </div>
            }>
            <Use promise={promise2}>Success!</Use>
          </Suspense>
        </div>
      );
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div>Loading...</div>
      </div>,
    );

    await act(() => {
      resolve1('resolved');
      resolve2('resolved');
    });

    expect(getVisibleChildren(container)).toEqual(<div>Success!</div>);
  });

  /** 去掉fallback中的宿主包装，形成空segment的深层Suspense；promise1与主内容promise2同轮完成、深层promise3仍暂停。最终Success!，覆盖空segment下废弃fallback收尾。 */
  it('should not error when discarding deeply nested Suspense boundaries in a parent fallback partially complete before the parent boundary resolves with empty segments', async () => {
    let resolve1;
    const promise1 = new Promise(r => (resolve1 = r));
    let resolve2;
    const promise2 = new Promise(r => (resolve2 = r));
    const promise3 = new Promise(r => {});

    /**
     * use传入promise后返回children，给无宿主包装的fallback制造空segment暂停。
     * @param children 完成内容。
     * @param promise 等待项。
     * @returns children。
     */
    function Use({children, promise}) {
      React.use(promise);
      return children;
    }
    /**
     * 嵌套Suspense之间不加div，使fallback有空segment；主内容完成时深层promise仍暂停。
     * @returns 空segment fallback树。
     */
    function App() {
      return (
        <div>
          <Suspense
            fallback={
              <Suspense fallback="Loading...">
                <Use promise={promise1}>
                  <Suspense fallback="Loading more...">
                    <Use promise={promise3}>
                      <div>deep fallback</div>
                    </Use>
                  </Suspense>
                </Use>
              </Suspense>
            }>
            <Use promise={promise2}>Success!</Use>
          </Suspense>
        </div>
      );
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<App />);
      pipe(writable);
    });

    expect(getVisibleChildren(container)).toEqual(<div>Loading...</div>);

    await act(() => {
      resolve1('resolved');
      resolve2('resolved');
    });

    expect(getVisibleChildren(container)).toEqual(<div>Success!</div>);
  });

  /** 包裹完整html/body的Suspense主内容足够大，progressiveChunkSize设100；收集原始流并断言随机fallback标签从未出现，验证贡献preamble的边界不因大小而先输出fallback。 */
  it('should always flush the boundaries contributing the preamble regardless of their size', async () => {
    const longDescription =
      `I need to make this segment somewhat large because it needs to be large enough to be outlined during the initial flush. Setting the progressive chunk size to near zero isn't enough because there is a fixed minimum size that we use to avoid doing the size tracking altogether and this needs to be larger than that at least.

Unfortunately that previous paragraph wasn't quite long enough so I'll continue with some more prose and maybe throw on some repeated additional strings at the end for good measure.

` + 'a'.repeat(500);

    const randomTag = Math.random().toString(36).slice(2, 10);

    /**
     * 以随机fallback包裹大html/body内容，使测试从原始流检查贡献preamble边界不被大小阈值outline。
     * @returns 大文档边界。
     */
    function App() {
      return (
        <Suspense fallback={randomTag}>
          <html lang="en">
            <body>
              <main>{longDescription}</main>
            </body>
          </html>
        </Suspense>
      );
    }

    let streamedContent = '';
    writable.on('data', chunk => (streamedContent += chunk));

    await act(() => {
      renderToPipeableStream(<App />, {progressiveChunkSize: 100}).pipe(
        writable,
      );
    });

    // 这里不检查 DOM，因为执行脚本会掩盖 fallback 是否曾短暂显示；改为断言流中从未输出包围 body 的
    // Suspense 边界的 fallback。
    expect(streamedContent).not.toContain(randomTag);
  });

  /** 大文档preamble边界外另有div，progressiveChunkSize设5；blocking开关启用时恰报大文档阈值警告，禁用时零错误，同时原始流从未含随机fallback，验证shell字节计数与preamble直出。 */
  it('should track byte size of shells that may contribute to the preamble when determining if the blocking render exceeds the max size', async () => {
    const longDescription =
      `I need to make this segment somewhat large because it needs to be large enough to be outlined during the initial flush. Setting the progressive chunk size to near zero isn't enough because there is a fixed minimum size that we use to avoid doing the size tracking altogether and this needs to be larger than that at least.

Unfortunately that previous paragraph wasn't quite long enough so I'll continue with some more prose and maybe throw on some repeated additional strings at the end for good measure.

` + 'a'.repeat(500);

    const randomTag = Math.random().toString(36).slice(2, 10);

    /**
     * 输出大文档preamble边界及外部div，配合很小chunk阈值检测shell大小警告和fallback未输出。
     * @returns 文档与外部内容。
     */
    function App() {
      return (
        <>
          <Suspense fallback={randomTag}>
            <html lang="en">
              <body>
                <main>{longDescription}</main>
              </body>
            </html>
          </Suspense>
          <div>Outside Preamble</div>
        </>
      );
    }

    let streamedContent = '';
    writable.on('data', chunk => (streamedContent += chunk));

    const errors = [];
    await act(() => {
      renderToPipeableStream(<App />, {
        progressiveChunkSize: 5,
        /**
         * 保存blocking大文档阈值错误，按feature flag断言一项或零项。
         * @param e 服务器报告错误。
         */
        onError(e) {
          errors.push(e);
        },
      }).pipe(writable);
    });

    if (gate(flags => flags.enableFizzBlockingRender)) {
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain(
        // 我们设置 chunk 的大小足够低，使得阈值变为零 kB。
        'This rendered a large document (>0 kB) without any Suspense boundaries around most of it.',
      );
    } else {
      expect(errors.length).toBe(0);
    }

    // 这里不检查 DOM，因为执行脚本会掩盖 fallback 是否曾短暂显示；改为断言流中从未输出包围 body 的
    // Suspense 边界的 fallback。
    expect(streamedContent).not.toContain(randomTag);
  });

  /** 静态prerender中宿主div内的AbortAndSuspend先controller.abort(boom)再use永不完成promise；prerender仍返回可pipe的prelude，errors仅boom且文档显示loading，验证同一组件中止后暂停不会挂住。 */
  it('should be able to Suspend after aborting in the same component without hanging the render', async () => {
    const controller = new AbortController();

    const promise1 = new Promise(() => {});
    /**
     * 先controller.abort字符串boom，再use永不完成promise，在同次render中制造中止后暂停。
     * @returns promise结果。
     * @throws 暂停信号。
     */
    function AbortAndSuspend() {
      controller.abort('boom');
      return React.use(promise1);
    }

    /**
     * 将AbortAndSuspend放宿主div内并以Suspense兜底，命中renderNode内中止后暂停的静态预渲染路径。
     * @returns 完整文档。
     */
    function App() {
      return (
        <html>
          <body>
            <Suspense fallback="loading...">
              {/*
 * 出问题的特定代码路径要求在 renderNode 而非 retryRenderTask 中 suspend，因此这里故意把会中止
 * 并 suspend 的函数渲染在宿主组件内。
              */}
              <div>
                <AbortAndSuspend />
              </div>
            </Suspense>
          </body>
        </html>
      );
    }

    const errors = [];
    await act(async () => {
      const result = await ReactDOMFizzStatic.prerenderToNodeStream(<App />, {
        signal: controller.signal,
        /**
         * 保存静态prerender中止值，预期仅boom。
         * @param e 中止原因。
         */
        onError(e) {
          errors.push(e);
        },
      });

      result.prelude.pipe(writable);
    });

    expect(errors).toEqual(['boom']);

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>loading...</body>
      </html>,
    );
  });

  /** 内层边界fallback直接为永远暂停组件，外层用outer兜底，主内容含可完成的Suspend；完成为!后最终两个span正常，覆盖废弃嵌套暂停fallback。onError为空回调，本例没有独立错误次数断言。 */
  it('not error when a suspended fallback segment directly inside another Suspense is abandoned', async () => {
    /**
     * 每次执行use新建的永不完成promise，作为待废弃的暂停fallback，不能自然完成。
     * @throws 暂停信号。
     */
    function SuspendForever() {
      React.use(new Promise(() => {}));
    }

    /** resolve初始为空函数，Promise执行器随后替换成真实解除函数，供测试稍后完成主内容。 */
    let resolve = () => {};
    const suspendPromise = new Promise(r => {
      resolve = r;
    });
    /**
     * use可外部完成suspendPromise，完成后返回!作为span内容。
     * @returns promise结果。
     * @throws 暂停信号。
     */
    function Suspend() {
      return React.use(suspendPromise);
    }

    /**
     * 外层Suspense包内层边界，内层fallback直接为SuspendForever，主内容含同步与异步span。
     * @returns 完整文档。
     */
    function App() {
      return (
        <html>
          <body>
            <Suspense fallback="outer">
              <Suspense fallback={<SuspendForever />}>
                <span>hello world</span>
                <span>
                  <Suspend />
                </span>
              </Suspense>
            </Suspense>
          </body>
        </html>
      );
    }

    await act(async () => {
      const {pipe} = renderToPipeableStream(<App />, {
        /** 空onError回调消费错误报告；本例只断言最终文档，没有单独错误次数验证。 */
        onError() {},
      });
      pipe(writable);
    });

    await act(() => {
      resolve('!');
    });

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <span>hello world</span>
          <span>!</span>
        </body>
      </html>,
    );
  });

  /** enableCPUSuspense开启时defer边界的主内容无需promise等待；在act消费buffer前断言原始片段先Waiting，日志Waiting→hello，随后最终span hello，验证CPU延后边界outline输出。 */
  // @gate enableCPUSuspense
  it('outlines deferred Suspense boundaries', async () => {
    /**
     * 记录并返回text，比较defer边界先渲染Waiting再渲染hello的调度顺序。
     * @param text 日志与输出文本。
     * @returns text。
     */
    function Log({text}) {
      Scheduler.log(text);
      return text;
    }

    await act(async () => {
      renderToPipeableStream(
        <div>
          <Suspense defer={true} fallback={<Log text="Waiting" />}>
            <span>{<Log text="hello" />}</span>
          </Suspense>
        </div>,
      ).pipe(writable);
      await jest.runAllTimers();
      const temp = document.createElement('body');
      temp.innerHTML = buffer;
      expect(getVisibleChildren(temp)).toEqual(<div>Waiting</div>);
    });

    assertLog(['Waiting', 'hello']);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>hello</span>
      </div>,
    );
  });

  /** 主内容含200个✓，UTF-8为600字节而仅200代码单元，progressiveChunkSize设100；消费buffer前是Waiting，最终完整多字节文本，验证outline按UTF-8字节大小决定。 */
  it('outlines boundaries based on UTF-8 byte size, not code unit count', async () => {
    // byteSize > 500 时边界会被 outline，先流式发送 fallback。内容由 200 个三字节字符组成：共 600 个
    // UTF-8 字节，却只有 200 个代码单元。边界足够大，初始应显示 fallback；若用 string.length 捷径
    // 计算字节数，会误计为 200、低于阈值并内联内容，从而错误地不显示 fallback。
    const multiByte = '✓'.repeat(200);

    /**
     * 200个三字节✓作为span内容置于Suspense，测试UTF-8字节计数超过outline阈值。
     * @returns 多字节文本树。
     */
    function App() {
      return (
        <div>
          <Suspense fallback="Waiting">
            <span>{multiByte}</span>
          </Suspense>
        </div>
      );
    }

    await act(async () => {
      renderToPipeableStream(<App />, {progressiveChunkSize: 100}).pipe(
        writable,
      );
      await jest.runAllTimers();
      const temp = document.createElement('body');
      temp.innerHTML = buffer;
      // 之所以显示 fallback，是因为边界按其 UTF-8 字节数被 outline。
      expect(getVisibleChildren(temp)).toEqual(<div>Waiting</div>);
    });

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>{multiByte}</span>
      </div>,
    );
  });

  /** 服务器嵌套lazy node输出Outer/Inner/Sibling ID为_R_1_/_R_5_/_R_2_；客户端以独立lazy先后完成outer/inner两次暂停。断言日志及最终ID完全一致、无hydration错误，验证嵌套lazy恢复不污染兄弟useId路径。 */
  it('useId is consistent for siblings when component suspends with nested lazy', async () => {
    // 内部组件使用 useId。
    /**
     * 读取useId并记录，输出inner span，检查嵌套lazy恢复后的深层ID路径。
     * @returns 带ID的span。
     */
    function InnerComponent() {
      const id = React.useId();
      Scheduler.log('InnerComponent id: ' + id);
      return <span id={id}>inner</span>;
    }

    // 外部组件也使用 useId，并渲染一个 lazy 内部组件。
    /**
     * 读取useId并记录，在div中透传innerElement；lazy node的恢复必须保留当前树ID路径。
     * @param innerElement 内层lazy节点。
     * @returns 带ID的div。
     */
    function OuterComponent({innerElement}) {
      const id = React.useId();
      Scheduler.log('OuterComponent id: ' + id);
      return <div id={id}>{innerElement}</div>;
    }

    // 兄弟组件同样使用 useId，其 ID 必须与服务器端一致。
    /**
     * 读取useId并记录，作为嵌套lazy之外的兄弟节点，验证暂停恢复不改变其_R_2_路径。
     * @returns 带ID的span。
     */
    function Sibling() {
      const id = React.useId();
      Scheduler.log('Sibling id: ' + id);
      return <span id={id}>sibling</span>;
    }

    // 创建用于服务器的全新懒加载组件（立即解析）
    const serverLazyInner = React.lazy(async () => {
      Scheduler.log('server lazy inner initializer');
      return {default: <InnerComponent />};
    });

    const serverLazyOuter = React.lazy(async () => {
      Scheduler.log('server lazy outer initializer');
      return {
        default: <OuterComponent key="outer" innerElement={serverLazyInner} />,
      };
    });

    // 服务器端渲染（lazy 立即完成解析）。
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <html>
          <body>
            <>{serverLazyOuter}</>
            <>
              <Sibling />
            </>
          </body>
        </html>,
      );
      pipe(writable);
    });

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <div id="_R_1_">
            <span id="_R_5_">inner</span>
          </div>
          <span id="_R_2_">sibling</span>
        </body>
      </html>,
    );

    assertLog([
      'server lazy outer initializer',
      'Sibling id: _R_2_',
      'OuterComponent id: _R_1_',
      'server lazy inner initializer',
      'InnerComponent id: _R_5_',
    ]);

    // 创建用于客户端的全新懒加载组件
    let resolveClientInner;
    const clientLazyInner = React.lazy(async () => {
      Scheduler.log('client lazy inner initializer');
      return new Promise(r => {
        /** 完成客户端内层lazy为InnerComponent元素，保留作为lazy node的默认导出形式。 */
        resolveClientInner = () => r({default: <InnerComponent />});
      });
    });

    let resolveClientOuter;
    const clientLazyOuter = React.lazy(async () => {
      Scheduler.log('client lazy outer initializer');
      return new Promise(r => {
        /** 完成客户端外层lazy为OuterComponent元素并传内层lazy节点，供第二次暂停继续使用同一树位置。 */
        resolveClientOuter = () =>
          r({default: <OuterComponent innerElement={clientLazyInner} />});
      });
    });

    const hydrationErrors = [];

    // 客户端使用嵌套 lazy 组件进行 hydration。
    let root;
    React.startTransition(() => {
      root = ReactDOMClient.hydrateRoot(
        document,
        <html>
          <body>
            <>{clientLazyOuter}</>
            <>
              <Sibling />
            </>
          </body>
        </html>,
        {
          /**
           * 保存嵌套lazy hydration恢复错误，ID一致时预期列表为空。
           * @param error 恢复错误。
           */
          onRecoverableError(error) {
            hydrationErrors.push(error.message);
          },
        },
      );
    });

    // 外层 lazy 组件第一次 suspend。
    await waitFor(['client lazy outer initializer']);
    resolveClientOuter();

    // 内层 lazy 组件第二次 suspend。
    await waitFor([
      'OuterComponent id: _R_1_',
      'client lazy inner initializer',
    ]);
    resolveClientInner();

    await waitForAll(['InnerComponent id: _R_5_', 'Sibling id: _R_2_']);

    // 客户端 ID 应与服务器生成的 ID 匹配。
    expect(hydrationErrors).toEqual([]);

    expect(getVisibleChildren(document)).toEqual(
      <html>
        <head />
        <body>
          <div id="_R_1_">
            <span id="_R_5_">inner</span>
          </div>
          <span id="_R_2_">sibling</span>
        </body>
      </html>,
    );

    root.unmount();
  });
});
