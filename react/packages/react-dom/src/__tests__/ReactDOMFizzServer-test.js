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

/** `normalizeError`：封装当前用例复用的操作、回调或断言步骤。 */
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
    global.requestAnimationFrame = global.window.requestAnimationFrame = cb =>
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

  /** `expectErrors`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** `componentStack`：封装当前用例复用的操作、回调或断言步骤。 */
  function componentStack(components) {
    return components
      .map(component => `\n    in ${component} (at **)`)
      .join('');
  }

  const bodyStartMatch = /<body(?:>| .*?>)/;
  const headStartMatch = /<head(?:>| .*?>)/;

  /** `act`：封装当前用例复用的操作、回调或断言步骤。 */
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
          // 我们解析了一个主体标签。 我们需要复制头部属性，并将未来的内容插入到 <body> 中。
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

  /** `rejectText`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** `AsyncTextWrapped`：封装当前用例复用的操作、回调或断言步骤。 */
  function AsyncTextWrapped({as, text}) {
    const As = as;
    return <As>{readText(text)}</As>;
  }
  /** `renderToPipeableStream`：封装当前用例复用的操作、回调或断言步骤。 */
  function renderToPipeableStream(jsx, options) {
    // 合并选项与 renderOptions。 可能包含特定于 featureFlag 的行为。
    return ReactDOMFizzServer.renderToPipeableStream(
      jsx,
      mergeOptions(options, renderOptions),
    );
  }

  // @gate enableBrowserAPI
  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「can opt a component into browser-only rendering」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言覆盖 react-dom 的服务端流适配层；完整 Fizz 状态机位于 react-server。
   */
  it('can opt a component into browser-only rendering', async () => {
    let resolveBrowserText;
    const browserText = new Promise(resolve => {
      resolveBrowserText = resolve;
    });
    const browserOnly = ReactDOM.browser();

    /** `BrowserOnly`：封装当前用例复用的操作、回调或断言步骤。 */
    function BrowserOnly() {
      use(browserOnly);
      const text = use(browserText);
      Scheduler.log(text);
      return <span>{text}</span>;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onError(error) {
          serverErrors.push(error);
        },
        /** `onBrowserBailout`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate enableBrowserAPI
  /** 测试场景：验证「can opt a component into browser-only rendering after streaming the fallback」描述的渲染、交互或错误处理结果。 */
  it('can opt a component into browser-only rendering after streaming the fallback', async () => {
    let resolveServerReady;
    const serverReady = new Promise(resolve => {
      resolveServerReady = resolve;
    });

    /** `BrowserOnly`：封装当前用例复用的操作、回调或断言步骤。 */
    function BrowserOnly() {
      use(serverReady);
      use(ReactDOM.browser());
      return <span>Browser</span>;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate enableBrowserAPI
  /** 测试场景：验证「errors if browser-only content is rendered outside Suspense」描述的渲染、交互或错误处理结果。 */
  it('errors if browser-only content is rendered outside Suspense', async () => {
    /** `createBrowserValue`：封装当前用例复用的操作、回调或断言步骤。 */
    function createBrowserValue() {
      return ReactDOM.browser();
    }
    const browserValue = createBrowserValue();

    /** `BrowserOnly`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onError(error) {
          reportedErrors.push(error);
        },
        /** `onBrowserBailout`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onBrowserBailout(error) {
          browserBailouts.push(error);
        },
        /** `onShellReady`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onShellReady() {
          shellReady = true;
        },
        /** `onShellError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate enableBrowserAPI
  /** 测试场景：验证「can abort all pending boundaries into browser-only rendering」描述的渲染、交互或错误处理结果。 */
  it('can abort all pending boundaries into browser-only rendering', async () => {
    const never = new Promise(() => {});
    let isClient = false;

    /** `Pending`：封装当前用例复用的操作、回调或断言步骤。 */
    function Pending({children}) {
      if (!isClient) {
        use(never);
      }
      return <span>{children}</span>;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onError(error) {
          serverErrors.push(error);
        },
        /** `onBrowserBailout`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate enableBrowserAPI
  /** 测试场景：验证「errors if aborted with browser() before the shell completes」描述的渲染、交互或错误处理结果。 */
  it('errors if aborted with browser() before the shell completes', async () => {
    const never = new Promise(() => {});
    const browserValue = ReactDOM.browser();

    /** `PendingRoot`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onError(error) {
          reportedErrors.push(error);
        },
        /** `onBrowserBailout`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onBrowserBailout(error) {
          browserBailouts.push(error);
        },
        /** `onShellReady`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onShellReady() {
          shellReady = true;
        },
        /** `onShellError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate enableBrowserAPI
  /** 测试场景：验证「reports the browser value if it is thrown instead of passed to use」描述的渲染、交互或错误处理结果。 */
  it('reports the browser value if it is thrown instead of passed to use', async () => {
    const browserValue = ReactDOM.browser();

    /** `BrowserOnly`：封装当前用例复用的操作、回调或断言步骤。 */
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
          /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
          onError(error) {
            reportedErrors.push(error);
          },
          /** `onBrowserBailout`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
    /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
    it(`does not reserve the ${JSON.stringify(
      userDigest,
    )} user error digest for browser rendering`, async () => {
      let isClient = false;
      const serverError = new Error('Server error');

      /** `ServerError`：封装当前用例复用的操作、回调或断言步骤。 */
      function ServerError() {
        if (!isClient) {
          throw serverError;
        }
        return <span>Client</span>;
      }

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
          /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「should asynchronously load a lazy component」描述的渲染、交互或错误处理结果。 */
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

    /** `TextWithPunctuation`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class TextWithPunctuation extends React.Component {
      /** `TextWithPunctuation.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「#23331: does not warn about hydration mismatches if something suspended in an earlier sibling」描述的渲染、交互或错误处理结果。 */
  it('#23331: does not warn about hydration mismatches if something suspended in an earlier sibling', async () => {
    /** `makeApp`：封装当前用例复用的操作、回调或断言步骤。 */
    const makeApp = () => {
      let resolve;
      const imports = new Promise(r => {
        resolve = () => r({
          /** 作为 React.lazy 动态模块的默认组件导出。 */
          default: () => <span id="async">async</span>
        });
      });
      const Lazy = React.lazy(() => imports);

      /** `makeApp.App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「should support nonce for bootstrap and runtime scripts」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should not automatically add nonce to rendered scripts」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should client render a boundary if a lazy component rejects」描述的渲染、交互或错误处理结果。 */
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

    /** `Wrapper`：封装当前用例复用的操作、回调或断言步骤。 */
    function Wrapper({children}) {
      return children;
    }
    const LazyWrapper = React.lazy(() => {
      return {
        /** `then`：实现测试夹具的生命周期、渲染或交互步骤。 */
        then(callback) {
          callback({
            default: Wrapper,
          });
        },
      };
    });

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
    window.__INIT__ = function () {
      bootstrapped = true;
      // 尝试 hydrate 内容。
      ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error, errorInfo) {
          errors.push({error, errorInfo});
        },
      });
    };

    const theError = new Error('Test');
    const loggedErrors = [];
    /** `onError`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「should have special stacks if Suspense fallback」描述的渲染、交互或错误处理结果。 */
  it('should have special stacks if Suspense fallback', async () => {
    const infinitePromise = new Promise(() => {});
    const InfiniteComponent = React.lazy(() => {
      return infinitePromise;
    });

    /** `Throw`：封装当前用例复用的操作、回调或断言步骤。 */
    function Throw({text}) {
      throw new Error(text);
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
    /** `onError`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「should asynchronously load a lazy element」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should client render a boundary if a lazy element rejects」描述的渲染、交互或错误处理结果。 */
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
    /** `onError`：封装当前用例复用的操作、回调或断言步骤。 */
    function onError(x, errorInfo) {
      loggedErrors.push(x);
      return 'hash of (' + x.message + ')';
    }
    const expectedDigest = onError(theError);
    loggedErrors.length = 0;

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「Errors in boundaries should be sent to the client and reported on client render - Error before flushing」描述的渲染、交互或错误处理结果。 */
  it('Errors in boundaries should be sent to the client and reported on client render - Error before flushing', async () => {
    /** `Indirection`：封装当前用例复用的操作、回调或断言步骤。 */
    function Indirection({level, children}) {
      if (level > 0) {
        return <Indirection level={level - 1}>{children}</Indirection>;
      }
      return children;
    }

    const theError = new Error('uh oh');

    /** `Erroring`：封装当前用例复用的操作、回调或断言步骤。 */
    function Erroring({isClient}) {
      if (isClient) {
        return 'Hello World';
      }
      throw theError;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
    /** `onError`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「Errors in boundaries should be sent to the client and reported on client render - Error after flushing」描述的渲染、交互或错误处理结果。 */
  it('Errors in boundaries should be sent to the client and reported on client render - Error after flushing', async () => {
    let rejectComponent;
    const LazyComponent = React.lazy(() => {
      return new Promise((resolve, reject) => {
        rejectComponent = reject;
      });
    });

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
    /** `onError`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「should asynchronously load the suspense boundary」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「waits for pending content to come in from the server and then hydrates it」描述的渲染、交互或错误处理结果。 */
  it('waits for pending content to come in from the server and then hydrates it', async () => {
    const ref = React.createRef();

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「handles an error on the client if the server ends up erroring」描述的渲染、交互或错误处理结果。 */
  it('handles an error on the client if the server ends up erroring', async () => {
    const ref = React.createRef();

    /** `ErrorBoundary`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ErrorBoundary extends React.Component {
      /** `ErrorBoundary.state`：记录测试夹具在当前场景中的状态。 */
      state = {error: null};
      /** `ErrorBoundary.getDerivedStateFromError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** `ErrorBoundary.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error) {
          return <b ref={ref}>{this.state.error.message}</b>;
        }
        return this.props.children;
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
          /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate enableSuspenseList
  /** 测试场景：验证「shows inserted items before pending in a SuspenseList as fallbacks while hydrating」描述的渲染、交互或错误处理结果。 */
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

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「client renders a boundary if it does not resolve before aborting」描述的渲染、交互或错误处理结果。 */
  it('client renders a boundary if it does not resolve before aborting', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
    /** `onError`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「should allow for two containers to be written to the same document」描述的渲染、交互或错误处理结果。 */
  it('should allow for two containers to be written to the same document', async () => {
    // 为两个容器各创建一个 passthrough 流，但不实现 end()：任一流完成时都不应关闭底层流；
    // 等两者都完成后再手动关闭。
    const writableA = new Stream.Writable();
    writableA._write = (chunk, encoding, next) => {
      writable.write(chunk, encoding, next);
    };
    const writableB = new Stream.Writable();
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
          /** `onShellReady`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
          /** `onShellReady`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「can resolve async content in esoteric parents」描述的渲染、交互或错误处理结果。 */
  it('can resolve async content in esoteric parents', async () => {
    /** `AsyncOption`：封装当前用例复用的操作、回调或断言步骤。 */
    function AsyncOption({text}) {
      return <option>{readText(text)}</option>;
    }

    /** `AsyncCol`：封装当前用例复用的操作、回调或断言步骤。 */
    function AsyncCol({className}) {
      return <col className={readText(className)} />;
    }

    /** `AsyncPath`：封装当前用例复用的操作、回调或断言步骤。 */
    function AsyncPath({id}) {
      return <path id={readText(id)} />;
    }

    /** `AsyncMi`：封装当前用例复用的操作、回调或断言步骤。 */
    function AsyncMi({id}) {
      return <mi id={readText(id)} />;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「can resolve async content in table parents」描述的渲染、交互或错误处理结果。 */
  it('can resolve async content in table parents', async () => {
    /** `AsyncTableBody`：封装当前用例复用的操作、回调或断言步骤。 */
    function AsyncTableBody({className, children}) {
      return <tbody className={readText(className)}>{children}</tbody>;
    }

    /** `AsyncTableRow`：封装当前用例复用的操作、回调或断言步骤。 */
    function AsyncTableRow({className, children}) {
      return <tr className={readText(className)}>{children}</tr>;
    }

    /** `AsyncTableCell`：封装当前用例复用的操作、回调或断言步骤。 */
    function AsyncTableCell({text}) {
      return <td>{readText(text)}</td>;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「can stream into an SVG container」描述的渲染、交互或错误处理结果。 */
  it('can stream into an SVG container', async () => {
    /** `AsyncPath`：封装当前用例复用的操作、回调或断言步骤。 */
    function AsyncPath({id}) {
      return <path id={readText(id)} />;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
          /** `onShellReady`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** `normalizeCodeLocInfo`：封装当前用例复用的操作、回调或断言步骤。 */
  function normalizeCodeLocInfo(str) {
    return (
      str &&
      String(str).replace(/\n +(?:at|in) ([^\(]+) [^\n]*/g, function (m, name) {
        return '\n    in ' + name + ' (at **)';
      })
    );
  }

  /** 测试场景：验证「should include a component stack across suspended boundaries」描述的渲染、交互或错误处理结果。 */
  it('should include a component stack across suspended boundaries', async () => {
    /** `B`：封装当前用例复用的操作、回调或断言步骤。 */
    function B() {
      const children = [readText('Hello'), readText('World')];
      // 故意触发一个 key 警告。
      return (
        <div>
          {children.map(function mapper(t) {
            return <span>{t}</span>;
          })}
        </div>
      );
    }
    /** `C`：封装当前用例复用的操作、回调或断言步骤。 */
    function C() {
      return (
        <inCorrectTag>
          <Text text="Loading" />
        </inCorrectTag>
      );
    }
    /** `A`：封装当前用例复用的操作、回调或断言步骤。 */
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

  // @gate !disableLegacyContext
  /** 测试场景：验证「should can suspend in a class component with legacy context」描述的渲染、交互或错误处理结果。 */
  it('should can suspend in a class component with legacy context', async () => {
    /** `TestProvider`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class TestProvider extends React.Component {
      /** `TestProvider.childContextTypes`：记录测试夹具在当前场景中的状态。 */
      static childContextTypes = {
        test: PropTypes.string,
      };
      /** `TestProvider.state`：记录测试夹具在当前场景中的状态。 */
      state = {ctxToSet: null};
      /** `TestProvider.getDerivedStateFromProps`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromProps(props, state) {
        return {ctxToSet: props.ctx};
      }
      /** `TestProvider.getChildContext`：实现测试夹具的生命周期、渲染或交互步骤。 */
      getChildContext() {
        return {
          test: this.state.ctxToSet,
        };
      }
      /** `TestProvider.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return this.props.children;
      }
    }

    /** `TestConsumer`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class TestConsumer extends React.Component {
      /** `TestConsumer.contextTypes`：记录测试夹具在当前场景中的状态。 */
      static contextTypes = {
        test: PropTypes.string,
      };
      /** `TestConsumer.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「should resume the context from where it left off」描述的渲染、交互或错误处理结果。 */
  it('should resume the context from where it left off', async () => {
    const ContextA = React.createContext('A0');
    const ContextB = React.createContext('B0');

    /** `PrintA`：封装当前用例复用的操作、回调或断言步骤。 */
    function PrintA() {
      return (
        <ContextA.Consumer>{value => <Text text={value} />}</ContextA.Consumer>
      );
    }

    /** `PrintB`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class PrintB extends React.Component {
      /** `PrintB.contextType`：记录测试夹具在当前场景中的状态。 */
      static contextType = ContextB;
      /** `PrintB.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <Text text={this.context} />;
      }
    }

    /** `AsyncParent`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「should recover the outer context when an error happens inside a provider」描述的渲染、交互或错误处理结果。 */
  it('should recover the outer context when an error happens inside a provider', async () => {
    const ContextA = React.createContext('A0');
    const ContextB = React.createContext('B0');

    /** `PrintA`：封装当前用例复用的操作、回调或断言步骤。 */
    function PrintA() {
      return (
        <ContextA.Consumer>{value => <Text text={value} />}</ContextA.Consumer>
      );
    }

    /** `PrintB`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class PrintB extends React.Component {
      /** `PrintB.contextType`：记录测试夹具在当前场景中的状态。 */
      static contextType = ContextB;
      /** `PrintB.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        return <Text text={this.context} />;
      }
    }

    /** `Throws`：封装当前用例复用的操作、回调或断言步骤。 */
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
          /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「client renders a boundary if it errors before finishing the fallback」描述的渲染、交互或错误处理结果。 */
  it('client renders a boundary if it errors before finishing the fallback', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
    /** `onError`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「should be able to abort the fallback if the main content finishes first」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「calls getServerSnapshot instead of getSnapshot」描述的渲染、交互或错误处理结果。 */
  it('calls getServerSnapshot instead of getSnapshot', async () => {
    const ref = React.createRef();

    /** `getServerSnapshot`：封装当前用例复用的操作、回调或断言步骤。 */
    function getServerSnapshot() {
      return 'server';
    }

    /** `getClientSnapshot`：封装当前用例复用的操作、回调或断言步骤。 */
    function getClientSnapshot() {
      return 'client';
    }

    /** `subscribe`：封装当前用例复用的操作、回调或断言步骤。 */
    function subscribe() {
      return () => {};
    }

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({text}) {
      Scheduler.log(text);
      return text;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
          /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
          onError(x) {
            loggedErrors.push(x);
          },
        },
      );
      pipe(writable);
    });
    assertLog(['server']);

    ReactDOMClient.hydrateRoot(container, <App />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「calls getServerSnapshot instead of getSnapshot (with selector and isEqual)」描述的渲染、交互或错误处理结果。 */
  it('calls getServerSnapshot instead of getSnapshot (with selector and isEqual)', async () => {
    // 如上一次测试一样。 但是，使用一个返回复杂对象的筛选器，并且该对象通过自定义的 `isEqual` 函数
    // 进行缓存。
    const ref = React.createRef();
    /** `getServerSnapshot`：封装当前用例复用的操作、回调或断言步骤。 */
    function getServerSnapshot() {
      return {env: 'server', other: 'unrelated'};
    }
    /** `getClientSnapshot`：封装当前用例复用的操作、回调或断言步骤。 */
    function getClientSnapshot() {
      return {env: 'client', other: 'unrelated'};
    }
    /** `selector`：封装当前用例复用的操作、回调或断言步骤。 */
    function selector({env}) {
      return {env};
    }
    /** `isEqual`：封装当前用例复用的操作、回调或断言步骤。 */
    function isEqual(a, b) {
      return a.env === b.env;
    }
    /** `subscribe`：封装当前用例复用的操作、回调或断言步骤。 */
    function subscribe() {
      return () => {};
    }
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({text}) {
      Scheduler.log(text);
      return text;
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
          /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
          onError(x) {
            loggedErrors.push(x);
          },
        },
      );
      pipe(writable);
    });
    assertLog(['server']);

    ReactDOMClient.hydrateRoot(container, <App />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
  it(
    'errors during hydration in the shell force a client render at the ' +
      'root, and during the client render it recovers',
    async () => {
      let isClient = false;

      /** `subscribe`：封装当前用例复用的操作、回调或断言步骤。 */
      function subscribe() {
        return () => {};
      }
      /** `getClientSnapshot`：封装当前用例复用的操作、回调或断言步骤。 */
      function getClientSnapshot() {
        return 'Yay!';
      }

      // 编写此测试时，只有 `getServerSnapshot` API 能暴露当前是否正在 hydration，因此这里用它
      // 模拟 hydration 期间的错误。
      /** `getServerSnapshot`：封装当前用例复用的操作、回调或断言步骤。 */
      function getServerSnapshot() {
        if (isClient) {
          throw new Error('Hydration error');
        }
        return 'Yay!';
      }

      /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
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

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「can hydrate uSES in StrictMode with different client and server snapshot (sync)」描述的渲染、交互或错误处理结果。 */
  it('can hydrate uSES in StrictMode with different client and server snapshot (sync)', async () => {
    /** `subscribe`：封装当前用例复用的操作、回调或断言步骤。 */
    function subscribe() {
      return () => {};
    }
    /** `getClientSnapshot`：封装当前用例复用的操作、回调或断言步骤。 */
    function getClientSnapshot() {
      return 'Yay!';
    }
    /** `getServerSnapshot`：封装当前用例复用的操作、回调或断言步骤。 */
    function getServerSnapshot() {
      return 'Nay!';
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「can hydrate uSES in StrictMode with different client and server snapshot (concurrent)」描述的渲染、交互或错误处理结果。 */
  it('can hydrate uSES in StrictMode with different client and server snapshot (concurrent)', async () => {
    /** `subscribe`：封装当前用例复用的操作、回调或断言步骤。 */
    function subscribe() {
      return () => {};
    }
    /** `getClientSnapshot`：封装当前用例复用的操作、回调或断言步骤。 */
    function getClientSnapshot() {
      return 'Yay!';
    }
    /** `getServerSnapshot`：封装当前用例复用的操作、回调或断言步骤。 */
    function getServerSnapshot() {
      return 'Nay!';
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
  it(
    'errors during hydration force a client render at the nearest Suspense ' +
      'boundary, and during the client render it recovers',
    async () => {
      let isClient = false;

      /** `subscribe`：封装当前用例复用的操作、回调或断言步骤。 */
      function subscribe() {
        return () => {};
      }
      /** `getClientSnapshot`：封装当前用例复用的操作、回调或断言步骤。 */
      function getClientSnapshot() {
        return 'Yay!';
      }

      // 编写此测试时，只有 `getServerSnapshot` API 能暴露当前是否正在 hydration，因此这里用它
      // 模拟 hydration 期间的错误。
      /** `getServerSnapshot`：封装当前用例复用的操作、回调或断言步骤。 */
      function getServerSnapshot() {
        if (isClient) {
          throw new Error('Hydration error');
        }
        return 'Yay!';
      }

      /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
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

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
  it(
    'errors during hydration force a client render at the nearest Suspense ' +
      'boundary, and during the client render it fails again',
    async () => {
      // 与前一个测试类似，但客户端渲染也会报错；错误边界应能捕获该错误。

      let isClient = false;

      /** `ErrorBoundary`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
      class ErrorBoundary extends React.Component {
        /** `ErrorBoundary.state`：记录测试夹具在当前场景中的状态。 */
        state = {error: null};
        /** `ErrorBoundary.getDerivedStateFromError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        static getDerivedStateFromError(error) {
          return {error};
        }
        /** `ErrorBoundary.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
        render() {
          if (this.state.error !== null) {
            return this.state.error.message;
          }
          return this.props.children;
        }
      }

      /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
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

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate FIXME
  /** 测试场景：验证「does not recreate the fallback if server errors and hydration suspends」描述的渲染、交互或错误处理结果。 */
  it('does not recreate the fallback if server errors and hydration suspends', async () => {
    let isClient = false;

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
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
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate FIXME
  /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
  it(
    'does not recreate the fallback if server errors and hydration suspends ' +
      'and root receives a transition',
    async () => {
      let isClient = false;

      /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
          /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate FIXME
  /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
  it(
    'recreates the fallback if server errors and hydration suspends but ' +
      'client receives new props',
    async () => {
      let isClient = false;

      /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
            /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
          /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
  it(
    'errors during hydration force a client render at the nearest Suspense ' +
      'boundary, and during the client render it recovers, then a deeper ' +
      'child suspends',
    async () => {
      let isClient = false;

      /** `subscribe`：封装当前用例复用的操作、回调或断言步骤。 */
      function subscribe() {
        return () => {};
      }
      /** `getClientSnapshot`：封装当前用例复用的操作、回调或断言步骤。 */
      function getClientSnapshot() {
        return 'Yay!';
      }

      // 编写此测试时，只有 `getServerSnapshot` API 能暴露当前是否正在 hydration，因此这里用它
      // 模拟 hydration 期间的错误。
      /** `getServerSnapshot`：封装当前用例复用的操作、回调或断言步骤。 */
      function getServerSnapshot() {
        if (isClient) {
          throw new Error('Hydration error');
        }
        return 'Yay!';
      }

      /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
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

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「logs regular (non-hydration) errors when the UI recovers」描述的渲染、交互或错误处理结果。 */
  it('logs regular (non-hydration) errors when the UI recovers', async () => {
    let shouldThrow = true;

    /** `A`：封装当前用例复用的操作、回调或断言步骤。 */
    function A({unused}) {
      if (shouldThrow) {
        Scheduler.log('Oops!');
        throw new Error('Oops!');
      }
      Scheduler.log('A');
      return 'A';
    }

    /** `B`：封装当前用例复用的操作、回调或断言步骤。 */
    function B() {
      Scheduler.log('B');
      return 'B';
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <>
          <A />
          <B />
        </>
      );
    }

    const root = ReactDOMClient.createRoot(container, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「logs multiple hydration errors in the same render」描述的渲染、交互或错误处理结果。 */
  it('logs multiple hydration errors in the same render', async () => {
    let isClient = false;

    /** `subscribe`：封装当前用例复用的操作、回调或断言步骤。 */
    function subscribe() {
      return () => {};
    }
    /** `getClientSnapshot`：封装当前用例复用的操作、回调或断言步骤。 */
    function getClientSnapshot() {
      return 'Yay!';
    }
    /** `getServerSnapshot`：封装当前用例复用的操作、回调或断言步骤。 */
    function getServerSnapshot() {
      if (isClient) {
        throw new Error('Hydration error');
      }
      return 'Yay!';
    }

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({label}) {
      // 这里会在客户端 hydration 期间抛错。本测试使用 useSyncExternalStore，只因为
      // getServerSnapshot 能观察当前是否正在 hydration。
      useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
      Scheduler.log(label);
      return label;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「supports iterable」描述的渲染、交互或错误处理结果。 */
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

  // @gate enableAsyncIterableChildren
  /** 测试场景：验证「supports async generator component」描述的渲染、交互或错误处理结果。 */
  it('supports async generator component', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // 每次动作都会重试一次，这会导致一个新的 ping，该 ping 会安排新的工作，但只有在动作完成渲染之
    // 后才会进行。
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

  // @gate enableAsyncIterableChildren
  /** 测试场景：验证「supports async iterable children」描述的渲染、交互或错误处理结果。 */
  it('supports async iterable children', async () => {
    const iterable = {
      /** `Symbol.asyncIterator`：实现测试夹具的生命周期、渲染或交互步骤。 */
      async *[Symbol.asyncIterator]() {
        yield <span key="1">{await Promise.resolve('Hi')}</span>;
        yield ' ';
        yield <span key="2">{await Promise.resolve('World')}</span>;
      },
    };

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({children}) {
      return <div>{children}</div>;
    }

    await act(() => {
      const {pipe} = renderToPipeableStream(<App>{iterable}</App>);
      pipe(writable);
    });

    // 每次动作都会重试一次，这会导致一个新的 ping，该 ping 会安排新的工作，但只有在动作完成渲染之
    // 后才会进行。
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

  /** 测试场景：验证「supports bigint」描述的渲染、交互或错误处理结果。 */
  it('supports bigint', async () => {
    await act(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <div>{10n}</div>,
      );
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual(<div>10</div>);
  });

  /** 测试场景：验证「Supports custom abort reasons with a string」描述的渲染、交互或错误处理结果。 */
  it('Supports custom abort reasons with a string', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「Supports custom abort reasons with an Error」描述的渲染、交互或错误处理结果。 */
  it('Supports custom abort reasons with an Error', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「reports abort errors for every suspended task when aborting fatals the shell」描述的渲染、交互或错误处理结果。 */
  it('reports abort errors for every suspended task when aborting fatals the shell', async () => {
    const promise = new Promise(() => {});
    const rendered = [];
    /** `Suspend`：封装当前用例复用的操作、回调或断言步骤。 */
    function Suspend({label}) {
      rendered.push(label);
      use(promise);
      return null;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onError(error) {
          errors.push(error.message);
        },
        /** `onShellError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onShellError() {},
      }).abort;
    });

    expect(rendered).toEqual(['boundary', 'root one', 'root two']);

    await act(() => {
      abort(new Error('abort reason'));
    });

    expect(errors).toEqual(['abort reason', 'abort reason', 'abort reason']);
  });

  /** 测试场景：验证「uses a rejection reason from a lazy component before the abort finishes」描述的渲染、交互或错误处理结果。 */
  it('uses a rejection reason from a lazy component before the abort finishes', async () => {
    let reject;
    const Lazy = React.lazy(
      () =>
        new Promise((resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    );
    const haltedPromise = new Promise(() => {});
    /** `HaltedWait`：封装当前用例复用的操作、回调或断言步骤。 */
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
          /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「does not report a rejection reason after abort has finished」描述的渲染、交互或错误处理结果。 */
  it('does not report a rejection reason after abort has finished', async () => {
    let reject;
    const promise = new Promise((resolve, rejectPromise) => {
      reject = rejectPromise;
    });
    /** `Wait`：封装当前用例复用的操作、回调或断言步骤。 */
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
          /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「warns in dev if you access digest from errorInfo in onRecoverableError」描述的渲染、交互或错误处理结果。 */
  it('warns in dev if you access digest from errorInfo in onRecoverableError', async () => {
    await act(() => {
      const {pipe} = renderToPipeableStream(
        <div>
          <Suspense fallback={'loading...'}>
            <AsyncText text={'hello'} />
          </Suspense>
        </div>,
        {
          /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「takes an importMap option which emits an "importmap" script in the head」描述的渲染、交互或错误处理结果。 */
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
  /** 测试场景：验证「can render custom elements with children on ther server」描述的渲染、交互或错误处理结果。 */
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
    // 此测试实际断言不多，因为 Node 版 Fizz 的关闭逻辑可能有 bug：close 会触发 abort，并在 Float 方法
    // 有机会调度写入前把 destination 设为 null。此问题修复后，若“流完成后仍写入”的底层问题未解决，
    // 本测试就会开始失败。
  /** 测试场景：验证「does not try to write to the stream after it has been closed」描述的渲染、交互或错误处理结果。 */
  it('does not try to write to the stream after it has been closed', async () => {
    /** `preloadLate`：封装当前用例复用的操作、回调或断言步骤。 */
    async function preloadLate() {
      await 1;
      ReactDOM.preconnect('foo');
    }

    /** `Preload`：封装当前用例复用的操作、回调或断言步骤。 */
    function Preload() {
      preloadLate();
      return null;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「provides headers after initial work if onHeaders option used」描述的渲染、交互或错误处理结果。 */
  it('provides headers after initial work if onHeaders option used', async () => {
    let headers = null;
    /** `onHeaders`：封装当前用例复用的操作、回调或断言步骤。 */
    function onHeaders(x) {
      headers = x;
    }

    /** `Preloads`：封装当前用例复用的操作、回调或断言步骤。 */
    function Preloads() {
      ReactDOM.preload('font2', {as: 'font'});
      ReactDOM.preload('imagepre2', {as: 'image', fetchPriority: 'high'});
      ReactDOM.preconnect('pre2', {crossOrigin: 'use-credentials'});
      ReactDOM.prefetchDNS('dns2');
    }

    /** `Blocked`：封装当前用例复用的操作、回调或断言步骤。 */
    function Blocked() {
      readText('blocked');
      return (
        <>
          <Preloads />
          <img src="image2" />
        </>
      );
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「omits images from preload headers if they contain srcset and sizes」描述的渲染、交互或错误处理结果。 */
  it('omits images from preload headers if they contain srcset and sizes', async () => {
    let headers = null;
    /** `onHeaders`：封装当前用例复用的操作、回调或断言步骤。 */
    function onHeaders(x) {
      headers = x;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「preserves referrerPolicy for image preload headers」描述的渲染、交互或错误处理结果。 */
  it('preserves referrerPolicy for image preload headers', async () => {
    let headers = null;
    /** `onHeaders`：封装当前用例复用的操作、回调或断言步骤。 */
    function onHeaders(x) {
      headers = x;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「emits nothing for headers if you pipe before work begins」描述的渲染、交互或错误处理结果。 */
  it('emits nothing for headers if you pipe before work begins', async () => {
    let headers = null;
    /** `onHeaders`：封装当前用例复用的操作、回调或断言步骤。 */
    function onHeaders(x) {
      headers = x;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「stops accumulating new headers once the maxHeadersLength limit is satisifed」描述的渲染、交互或错误处理结果。 */
  it('stops accumulating new headers once the maxHeadersLength limit is satisifed', async () => {
    let headers = null;
    /** `onHeaders`：封装当前用例复用的操作、回调或断言步骤。 */
    function onHeaders(x) {
      headers = x;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「logs an error if onHeaders throws but continues the render」描述的渲染、交互或错误处理结果。 */
  it('logs an error if onHeaders throws but continues the render', async () => {
    const errors = [];
    /** `onError`：封装当前用例复用的操作、回调或断言步骤。 */
    function onError(error) {
      errors.push(error.message);
    }

    /** `onHeaders`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「accounts for the length of the interstitial between links when computing the headers length」描述的渲染、交互或错误处理结果。 */
  it('accounts for the length of the interstitial between links when computing the headers length', async () => {
    let headers = null;
    /** `onHeaders`：封装当前用例复用的操作、回调或断言步骤。 */
    function onHeaders(x) {
      headers = x;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「does not perform any additional work after fatally erroring」描述的渲染、交互或错误处理结果。 */
  it('does not perform any additional work after fatally erroring', async () => {
    let resolve: () => void;
    const promise = new Promise(r => {
      resolve = r;
    });
    /** `AsyncComp`：封装当前用例复用的操作、回调或断言步骤。 */
    function AsyncComp() {
      React.use(promise);
      return <DidRender>Async</DidRender>;
    }

    let didRender = false;
    /** `DidRender`：封装当前用例复用的操作、回调或断言步骤。 */
    function DidRender({children}) {
      didRender = true;
      return children;
    }

    /** `ErrorComp`：封装当前用例复用的操作、回调或断言步骤。 */
    function ErrorComp() {
      throw new Error('boom');
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onError(error) {
          errors.push(error.message);
        },
        /** `onShellError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「does not report aborts after fatally erroring」描述的渲染、交互或错误处理结果。 */
  it('does not report aborts after fatally erroring', async () => {
    const promise = new Promise(() => {});
    /** `AsyncComp`：封装当前用例复用的操作、回调或断言步骤。 */
    function AsyncComp() {
      React.use(promise);
      return 'Async';
    }

    /** `ErrorComp`：封装当前用例复用的操作、回调或断言步骤。 */
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
          /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
          onError(error) {
            errors.push(error.message);
          },
          /** `onShellError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
    /** 测试场景：验证「escapes error hash, message, and component stack values in directly flushed errors (html escaping)」描述的渲染、交互或错误处理结果。 */
    it('escapes error hash, message, and component stack values in directly flushed errors (html escaping)', async () => {
      window.__outlet = {};

      const dangerousErrorString =
        '"></template></div><script>window.__outlet.message="from error"</script><div><template data-foo="';

      /** `Erroring`：封装当前用例复用的操作、回调或断言步骤。 */
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

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App() {
        return (
          <div>
            <Suspense fallback={<div>Loading...</div>}>
              <Erroring />
            </Suspense>
          </div>
        );
      }

      /** `onError`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** 测试场景：验证「escapes error hash, message, and component stack values in clientRenderInstruction (javascript escaping)」描述的渲染、交互或错误处理结果。 */
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

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
      function App() {
        return (
          <div>
            <Suspense fallback={<div>Loading...</div>}>
              <SuspensyErroring />
            </Suspense>
          </div>
        );
      }

      /** `onError`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** 测试场景：验证「escapes such that attributes cannot be masked」描述的渲染、交互或错误处理结果。 */
    it('escapes such that attributes cannot be masked', async () => {
      const dangerousErrorString = '" data-msg="bad message" data-foo="';
      const theError = new Error(dangerousErrorString);

      /** `Erroring`：封装当前用例复用的操作、回调或断言步骤。 */
      function Erroring({isClient}) {
        if (isClient) return 'Hello';
        throw theError;
      }

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `onError`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「accepts an integrity property for bootstrapScripts and bootstrapModules」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「accepts a crossOrigin property for bootstrapScripts and bootstrapModules」描述的渲染、交互或错误处理结果。 */
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
      /** 测试场景：验证「the "S" in "</?[Ss]cript" strings are replaced with unicode escaped lowercase s or S depending on case, preserving case sensitivity of nearby characters」描述的渲染、交互或错误处理结果。 */
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

      /** 测试场景：验证「does not escape \u2028, or \u2029 characters」描述的渲染、交互或错误处理结果。 */
      it('does not escape \\u2028, or \\u2029 characters', async () => {
    // 支持 https://github.com/tc39/proposal-json-superset 的引擎会忽略这些字符。本测试使用 JSDOM，
    // 字符会被静默丢弃，无需编码；旧浏览器可能因此失败，所以最好清理 JSON 输入中的这些字符。
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

      /** 测试场景：验证「does not escape <, >, or & characters」描述的渲染、交互或错误处理结果。 */
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
      /** 测试场景：验证「escapes </[sS]cirpt> in importMaps」描述的渲染、交互或错误处理结果。 */
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
      /** 测试场景：验证「escapes </[sS]cirpt> in inline scripts」描述的渲染、交互或错误处理结果。 */
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
    /** 测试场景：验证「the "S" in "</?[Ss]style" strings are replaced with unicode escaped lowercase s or S depending on case, preserving case sensitivity of nearby characters」描述的渲染、交互或错误处理结果。 */
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

    /** 测试场景：验证「the "S" in "</?[Ss]style" strings are replaced with unicode escaped lowercase s or S depending on case, preserving case sensitivity of nearby characters inside hoistable style tags」描述的渲染、交互或错误处理结果。 */
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

  // @gate enableFizzExternalRuntime
  /** 测试场景：验证「supports option to load runtime as an external script」描述的渲染、交互或错误处理结果。 */
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

  // @gate shouldUseFizzExternalRuntime
  /** 测试场景：验证「does not send script tags for SSR instructions when using the external runtime」描述的渲染、交互或错误处理结果。 */
  it('does not send script tags for SSR instructions when using the external runtime', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  // @gate shouldUseFizzExternalRuntime
  /** 测试场景：验证「does (unfortunately) send the external runtime for static pages」描述的渲染、交互或错误处理结果。 */
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

    // 不应发送任何脚本。
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

  /** 测试场景：验证「#24384: Suspending should halt hydration warnings and not emit any if hydration completes successfully after unsuspending」描述的渲染、交互或错误处理结果。 */
  it('#24384: Suspending should halt hydration warnings and not emit any if hydration completes successfully after unsuspending', async () => {
    /** `makeApp`：封装当前用例复用的操作、回调或断言步骤。 */
    const makeApp = () => {
      let resolve, resolved;
      const promise = new Promise(r => {
        resolve = () => {
          resolved = true;
          return r();
        };
      });
      /** `makeApp.ComponentThatSuspends`：封装当前用例复用的操作、回调或断言步骤。 */
      function ComponentThatSuspends() {
        if (!resolved) {
          throw promise;
        }
        return <p>A</p>;
      }

      /** `makeApp.App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        <p>A</p>
        <h2 name="hello">world</h2>
      </div>,
    );

    // 边界解析出子元素后，hydration 完成，并发现存在需要客户端渲染的不匹配。
    await clientResolve();
    await waitForAll([]);
    expect(getVisibleChildren(container)).toEqual(
      <div>
        <p>A</p>
        <h2 name="hello">world</h2>
      </div>,
    );
  });

  /** 测试场景：验证「#24384: Suspending should halt hydration warnings but still emit hydration warnings after unsuspending if mismatches are genuine」描述的渲染、交互或错误处理结果。 */
  it('#24384: Suspending should halt hydration warnings but still emit hydration warnings after unsuspending if mismatches are genuine', async () => {
    /** `makeApp`：封装当前用例复用的操作、回调或断言步骤。 */
    const makeApp = () => {
      let resolve, resolved;
      const promise = new Promise(r => {
        resolve = () => {
          resolved = true;
          return r();
        };
      });
      /** `makeApp.ComponentThatSuspends`：封装当前用例复用的操作、回调或断言步骤。 */
      function ComponentThatSuspends() {
        if (!resolved) {
          throw promise;
        }
        return <p>A</p>;
      }

      /** `makeApp.App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「only warns once on hydration mismatch while within a suspense boundary」描述的渲染、交互或错误处理结果。 */
  it('only warns once on hydration mismatch while within a suspense boundary', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「supresses hydration warnings when an error occurs within a Suspense boundary」描述的渲染、交互或错误处理结果。 */
  it('supresses hydration warnings when an error occurs within a Suspense boundary', async () => {
    let isClient = false;

    /** `ThrowWhenHydrating`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「does not log for errors after the first hydration error」描述的渲染、交互或错误处理结果。 */
  it('does not log for errors after the first hydration error', async () => {
    let isClient = false;

    /** `ThrowWhenHydrating`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「does not log for errors after a preceding fiber suspends」描述的渲染、交互或错误处理结果。 */
  it('does not log for errors after a preceding fiber suspends', async () => {
    let isClient = false;
    let promise = null;
    let unsuspend = null;
    let isResolved = false;

    /** `ComponentThatSuspendsOnClient`：封装当前用例复用的操作、回调或断言步骤。 */
    function ComponentThatSuspendsOnClient() {
      if (isClient && !isResolved) {
        if (promise === null) {
          promise = new Promise(resolve => {
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

    /** `ThrowWhenHydrating`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「(outdated behavior) suspending after erroring will cause errors previously queued to be silenced until the boundary resolves」描述的渲染、交互或错误处理结果。 */
  it('(outdated behavior) suspending after erroring will cause errors previously queued to be silenced until the boundary resolves', async () => {
    // 注意：本测试最初覆盖一个已不再发生的场景。hydration 期间报错时，React 会立即展开栈并切换到
    // 客户端渲染；保留此测试只是为了展示这组事件实际如何发生。

    let isClient = false;
    let promise = null;
    let unsuspend = null;
    let isResolved = false;

    /** `ComponentThatSuspendsOnClient`：封装当前用例复用的操作、回调或断言步骤。 */
    function ComponentThatSuspendsOnClient() {
      if (isClient && !isResolved) {
        if (promise === null) {
          promise = new Promise(resolve => {
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

    /** `ThrowWhenHydrating`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「#24578 Hydration errors caused by a suspending component should not become recoverable when nested in an ancestor Suspense that is showing primary content」描述的渲染、交互或错误处理结果。 */
  it('#24578 Hydration errors caused by a suspending component should not become recoverable when nested in an ancestor Suspense that is showing primary content', async () => {
    // 此测试曾失败，因为内部边界的 hydration 错误会被外部边界的代码路径升级为可恢复错误。
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「hydration warnings for mismatched text with multiple text nodes caused by suspending should be suppressed」描述的渲染、交互或错误处理结果。 */
  it('hydration warnings for mismatched text with multiple text nodes caused by suspending should be suppressed', async () => {
    let resolve;
    const Lazy = React.lazy(() => {
      return new Promise(r => {
        resolve = r;
      });
    });

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「can emit the preamble even if the head renders asynchronously」描述的渲染、交互或错误处理结果。 */
  it('can emit the preamble even if the head renders asynchronously', async () => {
    /** `AsyncNoOutput`：封装当前用例复用的操作、回调或断言步骤。 */
    function AsyncNoOutput() {
      readText('nooutput');
      return null;
    }
    /** `AsyncHead`：封装当前用例复用的操作、回调或断言步骤。 */
    function AsyncHead() {
      readText('head');
      return (
        <head data-foo="foo">
          <title>a title</title>
        </head>
      );
    }
    /** `AsyncBody`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「holds back body and html closing tags (the postamble) until all pending tasks are completed」描述的渲染、交互或错误处理结果。 */
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
    /** `afterImmediate`：封装当前用例复用的操作、回调或断言步骤。 */
    function afterImmediate() {
      return new Promise(resolve => {
        setImmediate(resolve);
      });
    }

    /** 测试场景：验证「only includes separators between adjacent text nodes」描述的渲染、交互或错误处理结果。 */
    it('only includes separators between adjacent text nodes', async () => {
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

    /** 测试场景：验证「does not insert text separators even when adjacent text is in a delayed segment」描述的渲染、交互或错误处理结果。 */
    it('does not insert text separators even when adjacent text is in a delayed segment', async () => {
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

    /** 测试场景：验证「works with multiple adjacent segments」描述的渲染、交互或错误处理结果。 */
    it('works with multiple adjacent segments', async () => {
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

    /** 测试场景：验证「works when some segments are flushed and others are patched」描述的渲染、交互或错误处理结果。 */
    it('works when some segments are flushed and others are patched', async () => {
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

    /** 测试场景：验证「does not prepend a text separators if the segment follows a non-Text Node」描述的渲染、交互或错误处理结果。 */
    it('does not prepend a text separators if the segment follows a non-Text Node', async () => {
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

    /** 测试场景：验证「does not prepend a text separators if the segments first emission is a non-Text Node」描述的渲染、交互或错误处理结果。 */
    it('does not prepend a text separators if the segments first emission is a non-Text Node', async () => {
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

    /** 测试场景：验证「should not insert separators for text inside Suspense boundaries even if they would otherwise be considered text-embedded」描述的渲染、交互或错误处理结果。 */
    it('should not insert separators for text inside Suspense boundaries even if they would otherwise be considered text-embedded', async () => {
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

    /** 测试场景：验证「(only) includes extraneous text separators in segments that complete before flushing, followed by nothing or a non-Text node」描述的渲染、交互或错误处理结果。 */
    it('(only) includes extraneous text separators in segments that complete before flushing, followed by nothing or a non-Text node', async () => {
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
    /** 测试场景：验证「should accept a single string child」描述的渲染、交互或错误处理结果。 */
    it('should accept a single string child', async () => {
      // 一个单字符串子节点
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(document.head)).toEqual(<title>hello</title>);
    });

    /** 测试场景：验证「should accept a single number child」描述的渲染、交互或错误处理结果。 */
    it('should accept a single number child', async () => {
      // 一个单个子节点
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(document.head)).toEqual(<title>4</title>);
    });

    /** 测试场景：验证「should accept a single bigint child」描述的渲染、交互或错误处理结果。 */
    it('should accept a single bigint child', async () => {
      // 一个单个子节点
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(document.head)).toEqual(<title>5n</title>);
    });

    /** 测试场景：验证「should accept children array of length 1 containing a string」描述的渲染、交互或错误处理结果。 */
    it('should accept children array of length 1 containing a string', async () => {
      // 一个单字符串子节点
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      expect(getVisibleChildren(document.head)).toEqual(<title>hello</title>);
    });

    /** 测试场景：验证「should warn in dev when given an array of length 2 or more」描述的渲染、交互或错误处理结果。 */
    it('should warn in dev when given an array of length 2 or more', async () => {
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      // 启用 Float 时，客户端和服务器端都不会渲染 title 内容。
      expect(getVisibleChildren(document.head)).toEqual(<title />);
    });

    /** 测试场景：验证「should warn in dev if you pass a React Component as a child to <title>」描述的渲染、交互或错误处理结果。 */
    it('should warn in dev if you pass a React Component as a child to <title>', async () => {
      /** `IndirectTitle`：封装当前用例复用的操作、回调或断言步骤。 */
      function IndirectTitle() {
        return 'hello';
      }

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
      // 启用 Float 时，对象形式的 title 会经 toString 转换。
      expect(getVisibleChildren(document.head)).toEqual(
        <title>{'[object Object]'}</title>,
      );
      const errors = [];
      ReactDOMClient.hydrateRoot(document.head, <App />, {
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      // 启用 Float 时，对象形式的 title 会经 toString 转换。
      expect(getVisibleChildren(document.head)).toEqual(
        <title>{'[object Object]'}</title>,
      );
    });

    /** 测试场景：验证「should warn in dev if you pass an object that does not implement toString as a child to <title>」描述的渲染、交互或错误处理结果。 */
    it('should warn in dev if you pass an object that does not implement toString as a child to <title>', async () => {
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
      // 启用 Float 时，对象形式的 title 会经 toString 转换。
      expect(getVisibleChildren(document.head)).toEqual(
        <title>{'[object Object]'}</title>,
      );
      const errors = [];
      ReactDOMClient.hydrateRoot(document.head, <App />, {
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          errors.push(error.message);
        },
      });
      await waitForAll([]);
      expect(errors).toEqual([]);
      // 启用 Float 时，对象形式的 title 会经 toString 转换。
      expect(getVisibleChildren(document.head)).toEqual(
        <title>{'[object Object]'}</title>,
      );
    });
  });

  /** 测试场景：验证「basic use(promise)」描述的渲染、交互或错误处理结果。 */
  it('basic use(promise)', async () => {
    const promiseA = Promise.resolve('A');
    const promiseB = Promise.resolve('B');
    const promiseC = Promise.resolve('C');

    /** `Async`：封装当前用例复用的操作、回调或断言步骤。 */
    function Async() {
      return use(promiseA) + use(promiseB) + use(promiseC);
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
    // mock Scheduler。此差异不影响任何公开 API，但内部测试以后仍应修复。
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

  /** 测试场景：验证「basic use(context)」描述的渲染、交互或错误处理结果。 */
  it('basic use(context)', async () => {
    const ContextA = React.createContext('default');
    const ContextB = React.createContext('B');
    /** `Client`：封装当前用例复用的操作、回调或断言步骤。 */
    function Client() {
      return use(ContextA) + use(ContextB);
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「use(promise) in multiple components」描述的渲染、交互或错误处理结果。 */
  it('use(promise) in multiple components', async () => {
    const promiseA = Promise.resolve('A');
    const promiseB = Promise.resolve('B');
    const promiseC = Promise.resolve('C');
    const promiseD = Promise.resolve('D');

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({prefix}) {
      return prefix + use(promiseC) + use(promiseD);
    }

    /** `Parent`：封装当前用例复用的操作、回调或断言步骤。 */
    function Parent() {
      return <Child prefix={use(promiseA) + use(promiseB)} />;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
    // mock Scheduler。此差异不影响任何公开 API，但内部测试以后仍应修复。
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

  /** 测试场景：验证「using a rejected promise will throw」描述的渲染、交互或错误处理结果。 */
  it('using a rejected promise will throw', async () => {
    const promiseA = Promise.resolve('A');
    const promiseB = Promise.reject(new Error('Oops!'));
    const promiseC = Promise.resolve('C');

    // 必须 await，否则 Jest/Node 会报告未处理的 rejection；浏览器中则不会。
    await expect(promiseB).rejects.toThrow('Oops!');

    /** `Async`：封装当前用例复用的操作、回调或断言步骤。 */
    function Async() {
      return use(promiseA) + use(promiseB) + use(promiseC);
    }

    /** `ErrorBoundary`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
    class ErrorBoundary extends React.Component {
      /** `ErrorBoundary.state`：记录测试夹具在当前场景中的状态。 */
      state = {error: null};
      /** `ErrorBoundary.getDerivedStateFromError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** `ErrorBoundary.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        if (this.state.error) {
          return this.state.error.message;
        }
        return this.props.children;
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onError(error) {
          reportedServerErrors.push(error);
        },
      });
      pipe(writable);
    });

    // TODO：本文件的 `act` 不会自动展开微任务，不能复用 Fiber 测试所用的 `act`，因为后者依赖
    // mock Scheduler。此差异不影响任何公开 API，但内部测试以后仍应修复。
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
      /** `onCaughtError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onCaughtError(error) {
        reportedCaughtErrors.push(error);
      },
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「use a promise that's already been instrumented and resolved」描述的渲染、交互或错误处理结果。 */
  it("use a promise that's already been instrumented and resolved", async () => {
    const thenable = {
      status: 'fulfilled',
      value: 'Hi',
      /** `then`：实现测试夹具的生命周期、渲染或交互步骤。 */
      then() {},
    };

    // thenable 已经 resolve，因此这里永远不会 suspend。
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「unwraps thenable that fulfills synchronously without suspending」描述的渲染、交互或错误处理结果。 */
  it('unwraps thenable that fulfills synchronously without suspending', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const thenable = {
        /** `App.then`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
  /** 测试场景：验证「only fires onAllReady once when a boundary with an instrumented sync-resolving thenable completes」描述的渲染、交互或错误处理结果。 */
  it('only fires onAllReady once when a boundary with an instrumented sync-resolving thenable completes', async () => {
    // 模拟 Flight 客户端 chunk：trackUsedThenable 中探测 status 的 .then() 始终 pending，
    // 但 renderNode 的 catch 中用于挂接 ping 的 .then() 会同步 resolve。这会重排工作队列，使内容任务
    // 完成时，fallback 任务仍留在 fallbackAbortableTasks 中。
    /** `createDeferredSyncThenable`：封装当前用例复用的操作、回调或断言步骤。 */
    function createDeferredSyncThenable(value) {
      let thenCallCount = 0;
      return {
        status: 'pending',
        value: undefined,
        /** `createDeferredSyncThenable.then`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
    /** `AsyncContent`：封装当前用例复用的操作、回调或断言步骤。 */
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
          /** `onAllReady`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
  /** 测试场景：验证「only fires onAllReady once when both content and fallback suspend on real promises」描述的渲染、交互或错误处理结果。 */
  it('only fires onAllReady once when both content and fallback suspend on real promises', async () => {
    let resolveContent;
    const contentPromise = new Promise(r => (resolveContent = r));
    // fallback promise 从不解决 — fallback-sub-task 在内容完成时被软终止。 所以，我们永远不会需要
    // 它。
    const fallbackPromise = new Promise(() => {});

    /** `AsyncContent`：封装当前用例复用的操作、回调或断言步骤。 */
    function AsyncContent() {
      return <Text text={use(contentPromise)} />;
    }
    /** `AsyncFallback`：封装当前用例复用的操作、回调或断言步骤。 */
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
          /** `onAllReady`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「promise as node」描述的渲染、交互或错误处理结果。 */
  it('promise as node', async () => {
    const promise = Promise.resolve('Hi');
    await act(async () => {
      const {pipe} = renderToPipeableStream(promise);
      pipe(writable);
    });

    // TODO：本文件的 `act` 不会自动展开微任务，不能复用 Fiber 测试所用的 `act`，因为后者依赖
    // mock Scheduler。此差异不影响任何公开 API，但内部测试以后仍应修复。
    await act(async () => {
      await promise;
    });

    expect(getVisibleChildren(container)).toEqual('Hi');
  });

  /** 测试场景：验证「context as node」描述的渲染、交互或错误处理结果。 */
  it('context as node', async () => {
    const Context = React.createContext('Hi');
    await act(async () => {
      const {pipe} = renderToPipeableStream(Context);
      pipe(writable);
    });
    expect(getVisibleChildren(container)).toEqual('Hi');
  });

  /** 测试场景：验证「recursive Usable as node」描述的渲染、交互或错误处理结果。 */
  it('recursive Usable as node', async () => {
    const Context = React.createContext('Hi');
    const promiseForContext = Promise.resolve(Context);
    await act(async () => {
      const {pipe} = renderToPipeableStream(promiseForContext);
      pipe(writable);
    });

    // TODO：本文件的 `act` 不会自动展开微任务，不能复用 Fiber 测试所用的 `act`，因为后者依赖
    // mock Scheduler。此差异不影响任何公开 API，但内部测试以后仍应修复。
    await act(async () => {
      await promiseForContext;
    });

    expect(getVisibleChildren(container)).toEqual('Hi');
  });

  /** 测试场景：验证「should correctly handle different promises in React.use() across lazy components」描述的渲染、交互或错误处理结果。 */
  it('should correctly handle different promises in React.use() across lazy components', async () => {
    let promise1;
    let promise2;
    let promiseLazy;

    /** `Component1`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** `Component2`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「useActionState hydrates without a mismatch」描述的渲染、交互或错误处理结果。 */
  it('useActionState hydrates without a mismatch', async () => {
    // 此测试覆盖实现细节：useActionState 会向 SSR 流发送注释节点，因此这里验证 hydration 期间
    // 能正确处理这些节点。

    /** `action`：封装当前用例复用的操作、回调或断言步骤。 */
    async function action(state) {
      return state;
    }

    const childRef = React.createRef(null);
    /** `Form`：封装当前用例复用的操作、回调或断言步骤。 */
    function Form() {
      const [state] = useActionState(action, 0);
      const text = `Child: ${state}`;
      return (
        <div id="child" ref={childRef}>
          {text}
        </div>
      );
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「useActionState hydrates without a mismatch if there's a render phase update」描述的渲染、交互或错误处理结果。 */
  it("useActionState hydrates without a mismatch if there's a render phase update", async () => {
    /** `action`：封装当前用例复用的操作、回调或断言步骤。 */
    async function action(state) {
      return state;
    }

    const childRef = React.createRef(null);
    /** `Form`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
    /** 测试场景：验证「can server render a component with useEffectEvent」描述的渲染、交互或错误处理结果。 */
    it('can server render a component with useEffectEvent', async () => {
      const ref = React.createRef();
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** 测试场景：验证「throws if useEffectEvent is called during a server render」描述的渲染、交互或错误处理结果。 */
    it('throws if useEffectEvent is called during a server render', async () => {
      const logs = [];
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
            /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

    /** 测试场景：验证「does not guarantee useEffectEvent return values during server rendering are distinct」描述的渲染、交互或错误处理结果。 */
    it('does not guarantee useEffectEvent return values during server rendering are distinct', async () => {
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          errors.push(error);
        },
      });
      await waitForAll([]);
      expect(errors.length).toEqual(1);
      expect(getVisibleChildren(container)).toEqual(<span />);
    });
  });

  /** 测试场景：验证「can render scripts with simple children」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「warns if script has complex children」描述的渲染、交互或错误处理结果。 */
  it('warns if script has complex children', async () => {
    /** `MyScript`：封装当前用例复用的操作、回调或断言步骤。 */
    function MyScript() {
      return 'bar();';
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
  it(
    'a transition that flows into a dehydrated boundary should not suspend ' +
      'if the boundary is showing a fallback',
    async () => {
      let setSearch;
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「can resume a prerender that was aborted」描述的渲染、交互或错误处理结果。 */
  it('can resume a prerender that was aborted', async () => {
    const promise = new Promise(r => {});

    let prerendering = true;

    /** `Wait`：封装当前用例复用的操作、回调或断言步骤。 */
    function Wait() {
      if (prerendering) {
        return React.use(promise);
      } else {
        return 'Hello';
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
    /** `onError`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「should NOT warn for using generator functions as components」描述的渲染、交互或错误处理结果。 */
  it('should NOT warn for using generator functions as components', async () => {
    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「can abort synchronously during render」描述的渲染、交互或错误处理结果。 */
  it('can abort synchronously during render', async () => {
    /** `Sibling`：封装当前用例复用的操作、回调或断言步骤。 */
    function Sibling() {
      return <p>sibling</p>;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
    /** `ComponentThatAborts`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「reports an in-flight root task after another root task fatals while aborting」描述的渲染、交互或错误处理结果。 */
  it('reports an in-flight root task after another root task fatals while aborting', async () => {
    const promise = new Promise(() => {});
    /** `SuspendedRoot`：封装当前用例复用的操作、回调或断言步骤。 */
    function SuspendedRoot() {
      use(promise);
      return null;
    }

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      return 'child';
    }

    const abortRef = {current: null};
    /** `ComponentThatAborts`：封装当前用例复用的操作、回调或断言步骤。 */
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
          /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
          onError(error) {
            errors.push(error.message);
          },
          /** `onShellError`：实现测试夹具的生命周期、渲染或交互步骤。 */
          onShellError() {},
        },
      );
      abortRef.current = abort;
    });

    expect(errors).toEqual(['abort reason', 'abort reason']);
  });

  /** 测试场景：验证「reports a root task before rendering a suspended child returned after aborting」描述的渲染、交互或错误处理结果。 */
  it('reports a root task before rendering a suspended child returned after aborting', async () => {
    const promise = new Promise(() => {});
    /** `SuspendedRoot`：封装当前用例复用的操作、回调或断言步骤。 */
    function SuspendedRoot() {
      use(promise);
      return null;
    }

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      use(promise);
      return null;
    }

    const abortRef = {current: null};
    /** `ComponentThatAborts`：封装当前用例复用的操作、回调或断言步骤。 */
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
          /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
          onError(error) {
            errors.push(error.message);
          },
          /** `onShellError`：实现测试夹具的生命周期、渲染或交互步骤。 */
          onShellError() {},
        },
      );
      abortRef.current = abort;
    });

    expect(errors).toEqual(['abort reason', 'abort reason']);
  });

  /** 测试场景：验证「reports a root task that suspends directly after aborting during render」描述的渲染、交互或错误处理结果。 */
  it('reports a root task that suspends directly after aborting during render', async () => {
    const promise = new Promise(() => {});
    const abortRef = {current: null};
    /** `ComponentThatAbortsAndSuspends`：封装当前用例复用的操作、回调或断言步骤。 */
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
          /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
          onError(error) {
            errors.push(error.message);
          },
          /** `onShellError`：实现测试夹具的生命周期、渲染或交互步骤。 */
          onShellError() {},
        },
      );
      abortRef.current = abort;
    });

    expect(errors).toEqual(['abort reason']);
  });

  /** 测试场景：验证「can abort during render in a lazy initializer for a component」描述的渲染、交互或错误处理结果。 */
  it('can abort during render in a lazy initializer for a component', async () => {
    /** `Sibling`：封装当前用例复用的操作、回调或断言步骤。 */
    function Sibling() {
      return <p>sibling</p>;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `then`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「can abort during render in a lazy initializer for an element」描述的渲染、交互或错误处理结果。 */
  it('can abort during render in a lazy initializer for an element', async () => {
    /** `Sibling`：封装当前用例复用的操作、回调或断言步骤。 */
    function Sibling() {
      return <p>sibling</p>;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `then`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「can abort during a synchronous thenable resolution」描述的渲染、交互或错误处理结果。 */
  it('can abort during a synchronous thenable resolution', async () => {
    /** `Sibling`：封装当前用例复用的操作、回调或断言步骤。 */
    function Sibling() {
      return <p>sibling</p>;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `then`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「can support throwing after aborting during a render」描述的渲染、交互或错误处理结果。 */
  it('can support throwing after aborting during a render', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div>
          <Suspense fallback={<p>loading...</p>}>
            <ComponentThatAborts />
          </Suspense>
        </div>
      );
    }

    /** `ComponentThatAborts`：封装当前用例复用的操作、回调或断言步骤。 */
    function ComponentThatAborts() {
      abortRef.current('boom');
      throw new Error('bam');
    }

    const abortRef = {current: null};
    let finished = false;
    const errors = [];
    await act(() => {
      const {pipe, abort} = renderToPipeableStream(<App />, {
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「should warn for using generators as children props」描述的渲染、交互或错误处理结果。 */
  it('should warn for using generators as children props', async () => {
    /** `getChildren`：封装当前用例复用的操作、回调或断言步骤。 */
    function* getChildren() {
      yield <h1 key="1">Hello</h1>;
      yield <h1 key="2">World</h1>;
    }

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「should warn for using other types of iterators as children」描述的渲染、交互或错误处理结果。 */
  it('should warn for using other types of iterators as children', async () => {
    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      let i = 0;
      const iterator = {
        /** `Symbol.iterator`：实现测试夹具的生命周期、渲染或交互步骤。 */
        [Symbol.iterator]() {
          return iterator;
        },
        /** `Foo.next`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate __DEV__
  /** 测试场景：验证「can get the component owner stacks during rendering in dev」描述的渲染、交互或错误处理结果。 */
  it('can get the component owner stacks during rendering in dev', async () => {
    let stack;

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      return <Bar />;
    }
    /** `Bar`：封装当前用例复用的操作、回调或断言步骤。 */
    function Bar() {
      return (
        <div>
          <Baz />
        </div>
      );
    }
    /** `Baz`：封装当前用例复用的操作、回调或断言步骤。 */
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

  // @gate __DEV__
  /** 测试场景：验证「can get the component owner stacks for onError in dev」描述的渲染、交互或错误处理结果。 */
  it('can get the component owner stacks for onError in dev', async () => {
    const thrownError = new Error('hi');
    let caughtError;
    let parentStack;
    let ownerStack;

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      return <Bar />;
    }
    /** `Bar`：封装当前用例复用的操作、回调或断言步骤。 */
    function Bar() {
      return (
        <div>
          <Baz />
        </div>
      );
    }
    /** `Baz`：封装当前用例复用的操作、回调或断言步骤。 */
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
            /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「can recover from very deep trees to avoid stack overflow」描述的渲染、交互或错误处理结果。 */
  it('can recover from very deep trees to avoid stack overflow', async () => {
    /** `Recursive`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「handles stack overflows inside components themselves」描述的渲染、交互或错误处理结果。 */
  it('handles stack overflows inside components themselves', async () => {
    /** `StackOverflow`：封装当前用例复用的操作、回调或断言步骤。 */
    function StackOverflow() {
      // 这个组件是递归的，因此是一个错误。 假设没有尾调用优化。
      /** `StackOverflow.recursive`：封装当前用例复用的操作、回调或断言步骤。 */
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
            /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「can recover from very deep trees during resume to avoid stack overflow」描述的渲染、交互或错误处理结果。 */
  it('can recover from very deep trees during resume to avoid stack overflow', async () => {
    const promise = new Promise(() => {});

    let prerendering = true;

    // postponed 边界上方存在深层包装。resume 时，这条 replay 路径经过 retryReplayTask → retryNode
    //（没有 trampoline），因此足以在此处溢出的深层树也必须恢复，而非只在普通渲染重试路径上恢复。
    /** `Deep`：封装当前用例复用的操作、回调或断言步骤。 */
    function Deep({n, children}) {
      if (n > 0) {
        return <Deep n={n - 1}>{children}</Deep>;
      }
      return children;
    }

    /** `Content`：封装当前用例复用的操作、回调或断言步骤。 */
    function Content() {
      if (prerendering) {
        return React.use(promise);
      }
      return <span>hi</span>;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「client renders incomplete Suspense boundaries when the document is no longer loading when hydration begins」描述的渲染、交互或错误处理结果。 */
  it('client renders incomplete Suspense boundaries when the document is no longer loading when hydration begins', async () => {
    let resolve;
    const promise = new Promise(r => {
      resolve = r;
    });

    /** `Blocking`：封装当前用例复用的操作、回调或断言步骤。 */
    function Blocking() {
      React.use(promise);
      return null;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error, errorInfo) {
        clientErrors.push(error.message);
      },
    });
    await waitForAll([]);
    // 开始客户端 hydration 时文档已不再 loading，因此客户端会在 fallback 状态下渲染该边界。
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

  /** 测试场景：验证「client renders incomplete Suspense boundaries when the document stops loading during hydration」描述的渲染、交互或错误处理结果。 */
  it('client renders incomplete Suspense boundaries when the document stops loading during hydration', async () => {
    let resolve;
    const promise = new Promise(r => {
      resolve = r;
    });

    /** `Blocking`：封装当前用例复用的操作、回调或断言步骤。 */
    function Blocking() {
      React.use(promise);
      return null;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
    // 文档 readyState 已不再是 loading，因此客户端会在 fallback 状态下渲染该边界。
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

  /** 测试场景：验证「can suspend inside the <head /> tag」描述的渲染、交互或错误处理结果。 */
  it('can suspend inside the <head /> tag', async () => {
    /** `BlockedOn`：封装当前用例复用的操作、回调或断言步骤。 */
    function BlockedOn({value, children}) {
      readText(value);
      return children;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「can render Suspense before, after, and around <html>」描述的渲染、交互或错误处理结果。 */
  it('can render Suspense before, after, and around <html>', async () => {
    /** `BlockedOn`：封装当前用例复用的操作、回调或断言步骤。 */
    function BlockedOn({value, children}) {
      readText(value);
      return children;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onShellReady`：封装当前用例复用的操作、回调或断言步骤。 */
        onShellReady: () => {
          shellReady = true;
        },
      });
      pipe(writable);
    });

    // 在 body 之前 suspend 会阻塞 shell，因为根 HTML scope 被视为 reconciliation 模式：语义上应
    // 保持此前视图（例如上一页），而不是显示 fallback。
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

  /** 测试场景：验证「can render Suspense before, after, and around <body>」描述的渲染、交互或错误处理结果。 */
  it('can render Suspense before, after, and around <body>', async () => {
    /** `BlockedOn`：封装当前用例复用的操作、回调或断言步骤。 */
    function BlockedOn({value, children}) {
      readText(value);
      return children;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onShellReady`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「can render Suspense before, after, and around <head>」描述的渲染、交互或错误处理结果。 */
  it('can render Suspense before, after, and around <head>', async () => {
    /** `BlockedOn`：封装当前用例复用的操作、回调或断言步骤。 */
    function BlockedOn({value, children}) {
      readText(value);
      return children;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onShellReady`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「will render fallback Document when erroring a boundary above the body and recover on the client」描述的渲染、交互或错误处理结果。 */
  it('will render fallback Document when erroring a boundary above the body and recover on the client', async () => {
    let serverRendering = true;
    /** `Boom`：封装当前用例复用的操作、回调或断言步骤。 */
    function Boom() {
      if (serverRendering) {
        throw new Error('Boom!');
      }
      return null;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onShellReady`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onShellReady() {
          shellReady = true;
        },
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「will hoist resources and hositables from a primary tree into the <head> of a client rendered fallback」描述的渲染、交互或错误处理结果。 */
  it('will hoist resources and hositables from a primary tree into the <head> of a client rendered fallback', async () => {
    let serverRendering = true;
    /** `Boom`：封装当前用例复用的操作、回调或断言步骤。 */
    function Boom() {
      if (serverRendering) {
        throw new Error('Boom!');
      }
      return null;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onShellReady`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onShellReady() {
          shellReady = true;
        },
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「will attempt to render the preamble inline to allow rendering before a later abort in the same task」描述的渲染、交互或错误处理结果。 */
  it('will attempt to render the preamble inline to allow rendering before a later abort in the same task', async () => {
    const promise = new Promise(() => {});
    /** `Pending`：封装当前用例复用的操作、回调或断言步骤。 */
    function Pending() {
      React.use(promise);
    }

    const controller = new AbortController();
    /** `Abort`：封装当前用例复用的操作、回调或断言步骤。 */
    function Abort() {
      controller.abort();
      return <Comp />;
    }

    /** `Comp`：封装当前用例复用的操作、回调或断言步骤。 */
    function Comp() {
      return null;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
          /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「Will wait to flush Document chunks until all boundaries which might contain a preamble are errored or resolved」描述的渲染、交互或错误处理结果。 */
  it('Will wait to flush Document chunks until all boundaries which might contain a preamble are errored or resolved', async () => {
    let rejectFirst;
    const firstPromise = new Promise((_, reject) => {
      rejectFirst = reject;
    });
    /** `First`：封装当前用例复用的操作、回调或断言步骤。 */
    function First({children}) {
      use(firstPromise);
      return children;
    }

    let resolveSecond;
    const secondPromise = new Promise(resolve => {
      resolveSecond = resolve;
    });
    /** `Second`：封装当前用例复用的操作、回调或断言步骤。 */
    function Second({children}) {
      use(secondPromise);
      return children;
    }

    const hangingPromise = new Promise(() => {});
    /** `Hanging`：封装当前用例复用的操作、回调或断言步骤。 */
    function Hanging({children}) {
      use(hangingPromise);
      return children;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onShellReady`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onShellReady() {
          shellReady = true;
        },
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「Can render a fallback <head> alongside a non-fallback body」描述的渲染、交互或错误处理结果。 */
  it('Can render a fallback <head> alongside a non-fallback body', async () => {
    let serverRendering = true;
    /** `Boom`：封装当前用例复用的操作、回调或断言步骤。 */
    function Boom() {
      if (serverRendering) {
        throw new Error('Boom!');
      }
      return null;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onShellReady`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onShellReady() {
          shellReady = true;
        },
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「Can render a fallback <body> alongside a non-fallback head」描述的渲染、交互或错误处理结果。 */
  it('Can render a fallback <body> alongside a non-fallback head', async () => {
    let serverRendering = true;
    /** `Boom`：封装当前用例复用的操作、回调或断言步骤。 */
    function Boom() {
      if (serverRendering) {
        throw new Error('Boom!');
      }
      return null;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onShellReady`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onShellReady() {
          shellReady = true;
        },
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「Can render a <head> outside of a containing <html>」描述的渲染、交互或错误处理结果。 */
  it('Can render a <head> outside of a containing <html>', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onShellReady`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「can render preamble tags in deeply nested indirect component trees」描述的渲染、交互或错误处理结果。 */
  it('can render preamble tags in deeply nested indirect component trees', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
    /** `Html`：封装当前用例复用的操作、回调或断言步骤。 */
    function Html({children}) {
      return (
        <Suspense fallback={<FallbackHtml>{children}</FallbackHtml>}>
          <MainHtml>{children}</MainHtml>
        </Suspense>
      );
    }
    /** `FallbackHtml`：封装当前用例复用的操作、回调或断言步骤。 */
    function FallbackHtml({children}) {
      return <html lang="default">{children}</html>;
    }
    /** `MainHtml`：封装当前用例复用的操作、回调或断言步骤。 */
    function MainHtml({children}) {
      const lang = use(langPromise);
      return <html lang={lang}>{children}</html>;
    }

    let loadMetadata;
    const metadataPromise = new Promise(r => {
      loadMetadata = r;
    });
    /** `DocumentMetadata`：封装当前用例复用的操作、回调或断言步骤。 */
    function DocumentMetadata() {
      return (
        <Suspense fallback={<FallbackDocumentMetadata />}>
          <MainDocumentMetadata />
        </Suspense>
      );
    }
    /** `FallbackDocumentMetadata`：封装当前用例复用的操作、回调或断言步骤。 */
    function FallbackDocumentMetadata() {
      return (
        <head data-fallback="">
          <meta content="fallback metadata" />
        </head>
      );
    }
    /** `MainDocumentMetadata`：封装当前用例复用的操作、回调或断言步骤。 */
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
    /** `Main`：封装当前用例复用的操作、回调或断言步骤。 */
    function Main() {
      return (
        <Suspense fallback={<Skeleton />}>
          <PrimaryContent />
        </Suspense>
      );
    }
    /** `Skeleton`：封装当前用例复用的操作、回调或断言步骤。 */
    function Skeleton() {
      return (
        <body data-fallback="">
          <div>Skeleton UI</div>
        </body>
      );
    }
    /** `PrimaryContent`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onShellReady`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onShellReady() {
          shellReady = true;
        },
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「will flush the preamble as soon as a complete preamble is available」描述的渲染、交互或错误处理结果。 */
  it('will flush the preamble as soon as a complete preamble is available', async () => {
    /** `BlockedOn`：封装当前用例复用的操作、回调或断言步骤。 */
    function BlockedOn({value, children}) {
      readText(value);
      return children;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onShellReady`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「will clean up the head when a hydration mismatch causes a boundary to recover on the client」描述的渲染、交互或错误处理结果。 */
  it('will clean up the head when a hydration mismatch causes a boundary to recover on the client', async () => {
    let content = 'server';

    /** `ServerApp`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** `ClientApp`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「can render styles with nonce」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「shouldn't render styles with mismatched nonce」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should render styles without nonce when render call doesn't receive nonce」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should render styles without nonce when render call receives a string nonce dedicated to scripts」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should allow for different script and style nonces」描述的渲染、交互或错误处理结果。 */
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

  /** 测试场景：验证「should not error when discarding deeply nested Suspense boundaries in a parent fallback partially complete before the parent boundary resolves」描述的渲染、交互或错误处理结果。 */
  it('should not error when discarding deeply nested Suspense boundaries in a parent fallback partially complete before the parent boundary resolves', async () => {
    let resolve1;
    const promise1 = new Promise(r => (resolve1 = r));
    let resolve2;
    const promise2 = new Promise(r => (resolve2 = r));
    const promise3 = new Promise(r => {});

    /** `Use`：封装当前用例复用的操作、回调或断言步骤。 */
    function Use({children, promise}) {
      React.use(promise);
      return children;
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「should not error when discarding deeply nested Suspense boundaries in a parent fallback partially complete before the parent boundary resolves with empty segments」描述的渲染、交互或错误处理结果。 */
  it('should not error when discarding deeply nested Suspense boundaries in a parent fallback partially complete before the parent boundary resolves with empty segments', async () => {
    let resolve1;
    const promise1 = new Promise(r => (resolve1 = r));
    let resolve2;
    const promise2 = new Promise(r => (resolve2 = r));
    const promise3 = new Promise(r => {});

    /** `Use`：封装当前用例复用的操作、回调或断言步骤。 */
    function Use({children, promise}) {
      React.use(promise);
      return children;
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「should always flush the boundaries contributing the preamble regardless of their size」描述的渲染、交互或错误处理结果。 */
  it('should always flush the boundaries contributing the preamble regardless of their size', async () => {
    const longDescription =
      `I need to make this segment somewhat large because it needs to be large enough to be outlined during the initial flush. Setting the progressive chunk size to near zero isn't enough because there is a fixed minimum size that we use to avoid doing the size tracking altogether and this needs to be larger than that at least.

Unfortunately that previous paragraph wasn't quite long enough so I'll continue with some more prose and maybe throw on some repeated additional strings at the end for good measure.

` + 'a'.repeat(500);

    const randomTag = Math.random().toString(36).slice(2, 10);

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「should track byte size of shells that may contribute to the preamble when determining if the blocking render exceeds the max size」描述的渲染、交互或错误处理结果。 */
  it('should track byte size of shells that may contribute to the preamble when determining if the blocking render exceeds the max size', async () => {
    const longDescription =
      `I need to make this segment somewhat large because it needs to be large enough to be outlined during the initial flush. Setting the progressive chunk size to near zero isn't enough because there is a fixed minimum size that we use to avoid doing the size tracking altogether and this needs to be larger than that at least.

Unfortunately that previous paragraph wasn't quite long enough so I'll continue with some more prose and maybe throw on some repeated additional strings at the end for good measure.

` + 'a'.repeat(500);

    const randomTag = Math.random().toString(36).slice(2, 10);

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「should be able to Suspend after aborting in the same component without hanging the render」描述的渲染、交互或错误处理结果。 */
  it('should be able to Suspend after aborting in the same component without hanging the render', async () => {
    const controller = new AbortController();

    const promise1 = new Promise(() => {});
    /** `AbortAndSuspend`：封装当前用例复用的操作、回调或断言步骤。 */
    function AbortAndSuspend() {
      controller.abort('boom');
      return React.use(promise1);
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  /** 测试场景：验证「not error when a suspended fallback segment directly inside another Suspense is abandoned」描述的渲染、交互或错误处理结果。 */
  it('not error when a suspended fallback segment directly inside another Suspense is abandoned', async () => {
    /** `SuspendForever`：封装当前用例复用的操作、回调或断言步骤。 */
    function SuspendForever() {
      React.use(new Promise(() => {}));
    }

    /** `resolve`：封装当前用例复用的操作、回调或断言步骤。 */
    let resolve = () => {};
    const suspendPromise = new Promise(r => {
      resolve = r;
    });
    /** `Suspend`：封装当前用例复用的操作、回调或断言步骤。 */
    function Suspend() {
      return React.use(suspendPromise);
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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

  // @gate enableCPUSuspense
  /** 测试场景：验证「outlines deferred Suspense boundaries」描述的渲染、交互或错误处理结果。 */
  it('outlines deferred Suspense boundaries', async () => {
    /** `Log`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「outlines boundaries based on UTF-8 byte size, not code unit count」描述的渲染、交互或错误处理结果。 */
  it('outlines boundaries based on UTF-8 byte size, not code unit count', async () => {
    // byteSize > 500 时边界会被 outline，先流式发送 fallback。内容由 200 个三字节字符组成：共 600 个
    // UTF-8 字节，却只有 200 个代码单元。边界足够大，初始应显示 fallback；若用 string.length 捷径
    // 计算字节数，会误计为 200、低于阈值并内联内容，从而错误地不显示 fallback。
    const multiByte = '✓'.repeat(200);

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「useId is consistent for siblings when component suspends with nested lazy」描述的渲染、交互或错误处理结果。 */
  it('useId is consistent for siblings when component suspends with nested lazy', async () => {
    // 内部组件使用 useId。
    /** `InnerComponent`：封装当前用例复用的操作、回调或断言步骤。 */
    function InnerComponent() {
      const id = React.useId();
      Scheduler.log('InnerComponent id: ' + id);
      return <span id={id}>inner</span>;
    }

    // 外部组件也使用 useId，并渲染一个 lazy 内部组件。
    /** `OuterComponent`：封装当前用例复用的操作、回调或断言步骤。 */
    function OuterComponent({innerElement}) {
      const id = React.useId();
      Scheduler.log('OuterComponent id: ' + id);
      return <div id={id}>{innerElement}</div>;
    }

    // 兄弟组件同样使用 useId，其 ID 必须与服务器端一致。
    /** `Sibling`：封装当前用例复用的操作、回调或断言步骤。 */
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
        resolveClientInner = () => r({default: <InnerComponent />});
      });
    });

    let resolveClientOuter;
    const clientLazyOuter = React.lazy(async () => {
      Scheduler.log('client lazy outer initializer');
      return new Promise(r => {
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
          /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
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
