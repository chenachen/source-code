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

let Activity;
let React = require('react');
let ReactDOM;
let ReactDOMClient;
let ReactDOMServer;
let ReactFeatureFlags;
let Scheduler;
let Suspense;
let useSyncExternalStore;
let act;
let IdleEventPriority;
let waitForAll;
let waitFor;
let assertLog;
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

/** `dispatchMouseEvent`：封装当前用例复用的操作、回调或断言步骤。 */
function dispatchMouseEvent(to, from) {
  if (!to) {
    to = null;
  }
  if (!from) {
    from = null;
  }
  if (from) {
    const mouseOutEvent = document.createEvent('MouseEvents');
    mouseOutEvent.initMouseEvent(
      'mouseout',
      true,
      true,
      window,
      0,
      50,
      50,
      50,
      50,
      false,
      false,
      false,
      false,
      0,
      to,
    );
    from.dispatchEvent(mouseOutEvent);
  }
  if (to) {
    const mouseOverEvent = document.createEvent('MouseEvents');
    mouseOverEvent.initMouseEvent(
      'mouseover',
      true,
      true,
      window,
      0,
      50,
      50,
      50,
      50,
      false,
      false,
      false,
      false,
      0,
      from,
    );
    to.dispatchEvent(mouseOverEvent);
  }
}

describe('ReactDOMServerPartialHydrationActivity', () => {
  beforeEach(() => {
    jest.resetModules();

    ReactFeatureFlags = require('shared/ReactFeatureFlags');
    ReactFeatureFlags.enableSuspenseCallback = true;
    ReactFeatureFlags.enableCreateEventHandleAPI = true;

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
    ReactDOMServer = require('react-dom/server');
    Scheduler = require('scheduler');
    Activity = React.Activity;
    Suspense = React.Suspense;
    useSyncExternalStore = React.useSyncExternalStore;

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    assertLog = InternalTestUtils.assertLog;
    waitFor = InternalTestUtils.waitFor;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;

    IdleEventPriority = require('react-reconciler/constants').IdleEventPriority;
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「hydrates a parent even if a child Activity boundary is blocked」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言对应 ReactDOMRoot.hydrateRoot 的容器认领与事件重放路径。
   */
  it('hydrates a parent even if a child Activity boundary is blocked', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div>
          <Activity>
            <span ref={ref}>
              <Child />
            </span>
          </Activity>
        </div>
      );
    }

    // 首先渲染最终 HTML。流式渲染器可能在服务端产生 Suspense 挂起点，但这里要测试完整 HTML，因此服务端不要挂起。
    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(<App />);

    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    const span = container.getElementsByTagName('span')[0];

    // 客户端尚未取得全部数据，但仍要开始水合。
    suspend = true;
    ReactDOMClient.hydrateRoot(container, <App />);
    await waitForAll([]);

    expect(ref.current).toBe(null);

    // Promise 兑现后应继续水合。
    suspend = false;
    resolve();
    await promise;
    await waitForAll([]);

    // 此时 ref 应指向已经水合的现有 span。
    expect(ref.current).toBe(span);
  });

  /** 测试场景：验证「can hydrate siblings of a suspended component without errors」描述的渲染、交互或错误处理结果。 */
  it('can hydrate siblings of a suspended component without errors', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Activity>
          <Child />
          <Activity>
            <div>Hello</div>
          </Activity>
        </Activity>
      );
    }

    // 首先渲染最终 HTML。流式渲染器可能在服务端产生 Suspense 挂起点，但这里要测试完整 HTML，因此服务端不要挂起。
    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(<App />);

    const container = document.createElement('div');
    container.innerHTML = finalHTML;
    expect(container.textContent).toBe('HelloHello');

    // 客户端尚未取得全部数据，但仍要开始水合。
    suspend = true;
    ReactDOMClient.hydrateRoot(container, <App />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll([]);

    // 预计服务器生成的 HTML 保持完整.
    expect(container.textContent).toBe('HelloHello');

    // Promise 兑现后应继续水合。
    suspend = false;
    resolve();
    await promise;
    await waitForAll([]);
    // 水合不应改变任何内容。
    expect(container.textContent).toBe('HelloHello');
  });

  /** 测试场景：验证「falls back to client rendering boundary on mismatch」描述的渲染、交互或错误处理结果。 */
  it('falls back to client rendering boundary on mismatch', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return 'Hello';
      }
    }
    /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
    function Component({shouldMismatch}) {
      Scheduler.log('Component');
      if (shouldMismatch && client) {
        return <article>Mismatch</article>;
      }
      return <div>Component</div>;
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Activity>
          <Child />
          <Component />
          <Component />
          <Component />
          <Component shouldMismatch={true} />
        </Activity>
      );
    }
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('section');
    container.innerHTML = finalHTML;
    assertLog(['Hello', 'Component', 'Component', 'Component', 'Component']);

    expect(container.innerHTML).toBe(
      '<!--&-->Hello<div>Component</div><div>Component</div><div>Component</div><div>Component</div><!--/&-->',
    );

    suspend = true;
    client = true;

    ReactDOMClient.hydrateRoot(container, <App />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll(['Suspend']);
    jest.runAllTimers();

    // 无变化
    expect(container.innerHTML).toBe(
      '<!--&-->Hello<div>Component</div><div>Component</div><div>Component</div><div>Component</div><!--/&-->',
    );

    suspend = false;
    resolve();
    await promise;
    await waitForAll([
      // 第一遍，末尾的不匹配
      'Hello',
      'Component',
      'Component',
      'Component',
      'Component',

      // 第二遍作为客户端渲染
      'Hello',
      'Component',
      'Component',
      'Component',
      'Component',
      // 记录水合不匹配。
      "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
    ]);

    // 客户端完成渲染，Suspense 注释节点已移除。
    expect(container.innerHTML).toBe(
      'Hello<div>Component</div><div>Component</div><div>Component</div><article>Mismatch</article>',
    );
  });

  /** 测试场景：验证「handles if mismatch is after suspending」描述的渲染、交互或错误处理结果。 */
  it('handles if mismatch is after suspending', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return 'Hello';
      }
    }
    /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
    function Component({shouldMismatch}) {
      Scheduler.log('Component');
      if (shouldMismatch && client) {
        return <article>Mismatch</article>;
      }
      return <div>Component</div>;
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Activity>
          <Child />
          <Component shouldMismatch={true} />
        </Activity>
      );
    }
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('section');
    container.innerHTML = finalHTML;
    assertLog(['Hello', 'Component']);

    expect(container.innerHTML).toBe(
      '<!--&-->Hello<div>Component</div><!--/&-->',
    );

    suspend = true;
    client = true;

    ReactDOMClient.hydrateRoot(container, <App />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll(['Suspend']);
    jest.runAllTimers();

    // !! 保持不变；挂起期间继续显示服务端内容。
    expect(container.innerHTML).toBe(
      '<!--&-->Hello<div>Component</div><!--/&-->',
    );

    suspend = false;
    resolve();
    await promise;
    await waitForAll([
      // 第一遍，末尾的不匹配
      'Hello',
      'Component',
      'Hello',
      'Component',
      "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
    ]);
    jest.runAllTimers();

    // 客户端完成渲染，Suspense 注释节点已移除。
    expect(container.innerHTML).toBe('Hello<article>Mismatch</article>');
  });

  /** 测试场景：验证「handles if mismatch is child of suspended component」描述的渲染、交互或错误处理结果。 */
  it('handles if mismatch is child of suspended component', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({children}) {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return <div>{children}</div>;
      }
    }
    /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
    function Component({shouldMismatch}) {
      Scheduler.log('Component');
      if (shouldMismatch && client) {
        return <article>Mismatch</article>;
      }
      return <div>Component</div>;
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Activity>
          <Child>
            <Component shouldMismatch={true} />
          </Child>
        </Activity>
      );
    }
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('section');
    container.innerHTML = finalHTML;
    assertLog(['Hello', 'Component']);

    expect(container.innerHTML).toBe(
      '<!--&--><div><div>Component</div></div><!--/&-->',
    );

    suspend = true;
    client = true;

    ReactDOMClient.hydrateRoot(container, <App />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll(['Suspend']);
    jest.runAllTimers();

    // !! 保持不变；挂起期间继续显示服务端内容。
    expect(container.innerHTML).toBe(
      '<!--&--><div><div>Component</div></div><!--/&-->',
    );

    suspend = false;
    resolve();
    await promise;
    await waitForAll([
      // 第一遍，末尾的不匹配
      'Hello',
      'Component',
      'Hello',
      'Component',
      "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
    ]);
    jest.runAllTimers();

    // 客户端完成渲染，Suspense 注释节点已移除。
    expect(container.innerHTML).toBe('<div><article>Mismatch</article></div>');
  });

  /** 测试场景：验证「handles if mismatch is parent and first child suspends」描述的渲染、交互或错误处理结果。 */
  it('handles if mismatch is parent and first child suspends', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({children}) {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return <div>{children}</div>;
      }
    }
    /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
    function Component({shouldMismatch, children}) {
      Scheduler.log('Component');
      if (shouldMismatch && client) {
        return (
          <div>
            {children}
            <article>Mismatch</article>
          </div>
        );
      }
      return (
        <div>
          {children}
          <div>Component</div>
        </div>
      );
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Activity>
          <Component shouldMismatch={true}>
            <Child />
          </Component>
        </Activity>
      );
    }
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('section');
    container.innerHTML = finalHTML;
    assertLog(['Component', 'Hello']);

    expect(container.innerHTML).toBe(
      '<!--&--><div><div></div><div>Component</div></div><!--/&-->',
    );

    suspend = true;
    client = true;

    ReactDOMClient.hydrateRoot(container, <App />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll(['Component', 'Suspend']);
    jest.runAllTimers();

    // !! 保持不变；挂起期间继续显示服务端内容。
    expect(container.innerHTML).toBe(
      '<!--&--><div><div></div><div>Component</div></div><!--/&-->',
    );

    suspend = false;
    resolve();
    await promise;
    await waitForAll([
      // 第一遍，末尾的不匹配
      'Component',
      'Hello',
      'Component',
      'Hello',
      "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
    ]);
    jest.runAllTimers();

    // 客户端完成渲染，Suspense 注释节点已移除。
    expect(container.innerHTML).toBe(
      '<div><div></div><article>Mismatch</article></div>',
    );
  });

  /** 测试场景：验证「does show a parent fallback if mismatch is parent and second child suspends」描述的渲染、交互或错误处理结果。 */
  it('does show a parent fallback if mismatch is parent and second child suspends', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({children}) {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return <div>{children}</div>;
      }
    }
    /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
    function Component({shouldMismatch, children}) {
      Scheduler.log('Component');
      if (shouldMismatch && client) {
        return (
          <div>
            <article>Mismatch</article>
            {children}
          </div>
        );
      }
      return (
        <div>
          <div>Component</div>
          {children}
        </div>
      );
    }
    /** `Fallback`：封装当前用例复用的操作、回调或断言步骤。 */
    function Fallback() {
      Scheduler.log('Fallback');
      return 'Loading...';
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Suspense fallback={<Fallback />}>
          <Activity>
            <Component shouldMismatch={true}>
              <Child />
            </Component>
          </Activity>
        </Suspense>
      );
    }
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('section');
    container.innerHTML = finalHTML;
    assertLog(['Component', 'Hello']);

    const div = container.getElementsByTagName('div')[0];

    expect(container.innerHTML).toBe(
      '<!--$--><!--&--><div><div>Component</div><div></div></div><!--/&--><!--/$-->',
    );

    suspend = true;
    client = true;

    ReactDOMClient.hydrateRoot(container, <App />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll(['Component', 'Component', 'Suspend', 'Fallback']);
    jest.runAllTimers();

    // !! 客户端切换到 Suspense 后备内容。由于客户端渲染从未提交，未水合内容仍保持隐藏。
    expect(container.innerHTML).toBe(
      '<!--$--><!--&--><div style="display: none;"><div>Component</div><div></div></div><!--/&--><!--/$-->' +
        'Loading...',
    );

    suspend = false;
    resolve();
    await promise;
    if (gate(flags => flags.alwaysThrottleRetries)) {
      await waitForAll(['Component', 'Component', 'Hello']);
    } else {
      await waitForAll([
        'Component',
        'Component',
        'Hello',
        "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
      ]);
    }
    jest.runAllTimers();

    // 达到节流超时后，即可提交失败的水合。
    if (gate(flags => flags.alwaysThrottleRetries)) {
      assertLog([
        "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
      ]);
    }

    // 客户端完成渲染，Activity 注释节点已移除。
    expect(container.innerHTML).toBe(
      '<!--$--><!--/$--><div><article>Mismatch</article><div></div></div>',
    );
  });

  /** 测试场景：验证「does show a parent fallback if mismatch is in parent element only」描述的渲染、交互或错误处理结果。 */
  it('does show a parent fallback if mismatch is in parent element only', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({children}) {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return <div>{children}</div>;
      }
    }
    /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
    function Component({shouldMismatch, children}) {
      Scheduler.log('Component');
      if (shouldMismatch && client) {
        return <article>{children}</article>;
      }
      return <div>{children}</div>;
    }
    /** `Fallback`：封装当前用例复用的操作、回调或断言步骤。 */
    function Fallback() {
      Scheduler.log('Fallback');
      return 'Loading...';
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Suspense fallback={<Fallback />}>
          <Activity>
            <Component shouldMismatch={true}>
              <Child />
            </Component>
          </Activity>
        </Suspense>
      );
    }
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('section');
    container.innerHTML = finalHTML;
    assertLog(['Component', 'Hello']);

    expect(container.innerHTML).toBe(
      '<!--$--><!--&--><div><div></div></div><!--/&--><!--/$-->',
    );

    suspend = true;
    client = true;

    ReactDOMClient.hydrateRoot(container, <App />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll(['Component', 'Component', 'Suspend', 'Fallback']);
    jest.runAllTimers();

    // !! 客户端切换到 Suspense 后备内容。由于客户端渲染从未提交，未水合内容仍保持隐藏。
    expect(container.innerHTML).toBe(
      '<!--$--><!--&--><div style="display: none;"><div></div></div><!--/&--><!--/$-->' +
        'Loading...',
    );

    suspend = false;
    resolve();
    await promise;
    if (gate(flags => flags.alwaysThrottleRetries)) {
      await waitForAll(['Component', 'Component', 'Hello']);
    } else {
      await waitForAll([
        'Component',
        'Component',
        'Hello',
        "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
      ]);
    }
    jest.runAllTimers();

    // 达到节流超时后，即可提交失败的水合。
    if (gate(flags => flags.alwaysThrottleRetries)) {
      assertLog([
        "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
      ]);
    }

    // 客户端完成渲染，Activity 注释节点已移除。
    expect(container.innerHTML).toBe(
      '<!--$--><!--/$--><article><div></div></article>',
    );
  });

  /** 测试场景：验证「does show a parent fallback if mismatch is before suspending」描述的渲染、交互或错误处理结果。 */
  it('does show a parent fallback if mismatch is before suspending', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return 'Hello';
      }
    }
    /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
    function Component({shouldMismatch}) {
      Scheduler.log('Component');
      if (shouldMismatch && client) {
        return <article>Mismatch</article>;
      }
      return <div>Component</div>;
    }
    /** `Fallback`：封装当前用例复用的操作、回调或断言步骤。 */
    function Fallback() {
      Scheduler.log('Fallback');
      return 'Loading...';
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Suspense fallback={<Fallback />}>
          <Activity>
            <Component shouldMismatch={true} />
            <Child />
          </Activity>
        </Suspense>
      );
    }
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('section');
    container.innerHTML = finalHTML;
    assertLog(['Component', 'Hello']);

    expect(container.innerHTML).toBe(
      '<!--$--><!--&--><div>Component</div>Hello<!--/&--><!--/$-->',
    );

    suspend = true;
    client = true;

    ReactDOMClient.hydrateRoot(container, <App />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll(['Component', 'Component', 'Suspend', 'Fallback']);
    jest.runAllTimers();

    // !! 客户端切换到 Suspense 后备内容。由于客户端渲染从未提交，未水合内容仍保持隐藏。
    expect(container.innerHTML).toBe(
      '<!--$--><!--&--><div style="display: none;">Component</div><!--/&--><!--/$-->' +
        'Loading...',
    );

    suspend = false;
    resolve();
    await promise;
    if (gate(flags => flags.alwaysThrottleRetries)) {
      await waitForAll(['Component', 'Component', 'Hello']);
    } else {
      await waitForAll([
        'Component',
        'Component',
        'Hello',
        "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
      ]);
    }
    jest.runAllTimers();

    // 达到节流超时后，即可提交失败的水合。
    if (gate(flags => flags.alwaysThrottleRetries)) {
      assertLog([
        "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
      ]);
    }

    // 客户端完成渲染，Activity 注释节点已移除。
    expect(container.innerHTML).toBe(
      '<!--$--><!--/$--><article>Mismatch</article>Hello',
    );
  });

  /** 测试场景：验证「does show a parent fallback if mismatch is before suspending in a child」描述的渲染、交互或错误处理结果。 */
  it('does show a parent fallback if mismatch is before suspending in a child', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return 'Hello';
      }
    }
    /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
    function Component({shouldMismatch}) {
      Scheduler.log('Component');
      if (shouldMismatch && client) {
        return <article>Mismatch</article>;
      }
      return <div>Component</div>;
    }
    /** `Fallback`：封装当前用例复用的操作、回调或断言步骤。 */
    function Fallback() {
      Scheduler.log('Fallback');
      return 'Loading...';
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Suspense fallback={<Fallback />}>
          <Activity>
            <Component shouldMismatch={true} />
            <div>
              <Child />
            </div>
          </Activity>
        </Suspense>
      );
    }
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('section');
    container.innerHTML = finalHTML;
    assertLog(['Component', 'Hello']);

    expect(container.innerHTML).toBe(
      '<!--$--><!--&--><div>Component</div><div>Hello</div><!--/&--><!--/$-->',
    );

    suspend = true;
    client = true;

    ReactDOMClient.hydrateRoot(container, <App />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll(['Component', 'Component', 'Suspend', 'Fallback']);
    jest.runAllTimers();

    // !! 客户端切换到 Suspense 后备内容。由于客户端渲染从未提交，未水合内容仍保持隐藏。
    expect(container.innerHTML).toBe(
      '<!--$--><!--&--><div style="display: none;">Component</div><div style="display: none;">Hello</div><!--/&--><!--/$-->' +
        'Loading...',
    );

    suspend = false;
    resolve();
    await promise;
    if (gate(flags => flags.alwaysThrottleRetries)) {
      await waitForAll(['Component', 'Component', 'Hello']);
    } else {
      await waitForAll([
        'Component',
        'Component',
        'Hello',
        "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
      ]);
    }
    jest.runAllTimers();

    // 达到节流超时后，即可提交失败的水合。
    if (gate(flags => flags.alwaysThrottleRetries)) {
      assertLog([
        "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
      ]);
    }

    // 客户端完成渲染，Activity 注释节点已移除。
    expect(container.innerHTML).toBe(
      '<!--$--><!--/$--><article>Mismatch</article><div>Hello</div>',
    );
  });

  /** 测试场景：验证「calls the hydration callbacks after hydration or deletion」描述的渲染、交互或错误处理结果。 */
  it('calls the hydration callbacks after hydration or deletion', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    let suspend2 = false;
    const promise2 = new Promise(() => {});
    /** `Child2`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child2({value}) {
      if (suspend2 && !value) {
        throw promise2;
      } else {
        return 'World';
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({value}) {
      return (
        <div>
          <Activity>
            <Child />
          </Activity>
          <Activity>
            <Child2 value={value} />
          </Activity>
        </div>
      );
    }

    // 首先渲染最终 HTML。流式渲染器可能在服务端产生 Suspense 挂起点，但这里要测试完整 HTML，因此服务端不要挂起。
    suspend = false;
    suspend2 = false;
    const finalHTML = ReactDOMServer.renderToString(<App />);

    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    const hydrated = [];
    const deleted = [];

    // 客户端尚未取得全部数据，但仍要开始水合。
    suspend = true;
    suspend2 = true;
    const root = ReactDOMClient.hydrateRoot(container, <App />, {
      /** `onHydrated`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onHydrated(node) {
        hydrated.push(node);
      },
      /** `onDeleted`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onDeleted(node) {
        deleted.push(node);
      },
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll([]);

    expect(hydrated.length).toBe(0);
    expect(deleted.length).toBe(0);

    await act(async () => {
      // Promise 兑现后应继续水合。
      suspend = false;
      resolve();
      await promise;
    });

    expect(hydrated.length).toBe(1);
    expect(deleted.length).toBe(0);

    // 如果更新能够解除挂起，执行更新应迫使 React 删除该边界。
    await act(() => {
      root.render(<App value={true} />);
    });

    expect(hydrated.length).toBe(1);
    expect(deleted.length).toBe(1);
  });

  /** 测试场景：验证「hydrates an empty activity boundary」描述的渲染、交互或错误处理结果。 */
  it('hydrates an empty activity boundary', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div>
          <Activity />
          <div>Sibling</div>
        </div>
      );
    }

    const finalHTML = ReactDOMServer.renderToString(<App />);

    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    ReactDOMClient.hydrateRoot(container, <App />);
    await waitForAll([]);

    expect(container.innerHTML).toContain('<div>Sibling</div>');
  });

  /** 测试场景：验证「recovers with client render when server rendered additional nodes at suspense root」描述的渲染、交互或错误处理结果。 */
  it('recovers with client render when server rendered additional nodes at suspense root', async () => {
    /** `CheckIfHydrating`：封装当前用例复用的操作、回调或断言步骤。 */
    function CheckIfHydrating({children}) {
      // 这里借助 useSyncExternalStore 判断当前是否正在水合，因为 React 目前没有公开其他方式获取该状态。
      let serverOrClient = '(unknown)';
      useSyncExternalStore(
        () => {},
        () => {
          serverOrClient = 'Client rendered';
          return null;
        },
        () => {
          serverOrClient = 'Server rendered';
          return null;
        },
      );
      Scheduler.log(serverOrClient);
      return null;
    }

    const ref = React.createRef();
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({hasB}) {
      return (
        <div>
          <Activity>
            <span ref={ref}>A</span>
            {hasB ? <span>B</span> : null}
            <CheckIfHydrating />
          </Activity>
          <div>Sibling</div>
        </div>
      );
    }

    const finalHTML = ReactDOMServer.renderToString(<App hasB={true} />);
    assertLog(['Server rendered']);

    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    const span = container.getElementsByTagName('span')[0];

    expect(container.innerHTML).toContain('<span>A</span>');
    expect(container.innerHTML).toContain('<span>B</span>');
    expect(ref.current).toBe(null);

    await act(() => {
      ReactDOMClient.hydrateRoot(container, <App hasB={false} />, {
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
          if (error.cause) {
            Scheduler.log('Cause: ' + normalizeError(error.cause.message));
          }
        },
      });
    });

    expect(container.innerHTML).toContain('<span>A</span>');
    expect(container.innerHTML).not.toContain('<span>B</span>');

    assertLog([
      'Server rendered',
      'Client rendered',
      "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
    ]);
    expect(ref.current).not.toBe(span);
  });

  /** 测试场景：验证「recovers with client render when server rendered additional nodes at suspense root after unsuspending」描述的渲染、交互或错误处理结果。 */
  it('recovers with client render when server rendered additional nodes at suspense root after unsuspending', async () => {
    const ref = React.createRef();
    let shouldSuspend = false;
    let resolve;
    const promise = new Promise(res => {
      resolve = () => {
        shouldSuspend = false;
        res();
      };
    });
    /** `Suspender`：封装当前用例复用的操作、回调或断言步骤。 */
    function Suspender() {
      if (shouldSuspend) {
        throw promise;
      }
      return <></>;
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({hasB}) {
      return (
        <div>
          <Activity>
            <Suspender />
            <span ref={ref}>A</span>
            {hasB ? <span>B</span> : null}
          </Activity>
          <div>Sibling</div>
        </div>
      );
    }
    const finalHTML = ReactDOMServer.renderToString(<App hasB={true} />);

    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    const span = container.getElementsByTagName('span')[0];

    expect(container.innerHTML).toContain('<span>A</span>');
    expect(container.innerHTML).toContain('<span>B</span>');
    expect(ref.current).toBe(null);

    shouldSuspend = true;
    await act(() => {
      ReactDOMClient.hydrateRoot(container, <App hasB={false} />, {
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
          if (error.cause) {
            Scheduler.log('Cause: ' + normalizeError(error.cause.message));
          }
        },
      });
    });

    await act(() => {
      resolve();
    });

    assertLog([
      "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
    ]);

    expect(container.innerHTML).toContain('<span>A</span>');
    expect(container.innerHTML).not.toContain('<span>B</span>');
    expect(ref.current).not.toBe(span);
  });

  /** 测试场景：验证「recovers with client render when server rendered additional nodes deep inside suspense root」描述的渲染、交互或错误处理结果。 */
  it('recovers with client render when server rendered additional nodes deep inside suspense root', async () => {
    const ref = React.createRef();
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({hasB}) {
      return (
        <div>
          <Activity>
            <div>
              <span ref={ref}>A</span>
              {hasB ? <span>B</span> : null}
            </div>
          </Activity>
          <div>Sibling</div>
        </div>
      );
    }

    const finalHTML = ReactDOMServer.renderToString(<App hasB={true} />);

    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    const span = container.getElementsByTagName('span')[0];

    expect(container.innerHTML).toContain('<span>A</span>');
    expect(container.innerHTML).toContain('<span>B</span>');
    expect(ref.current).toBe(null);

    await act(() => {
      ReactDOMClient.hydrateRoot(container, <App hasB={false} />, {
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
          if (error.cause) {
            Scheduler.log('Cause: ' + normalizeError(error.cause.message));
          }
        },
      });
    });
    assertLog([
      "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
    ]);

    expect(container.innerHTML).toContain('<span>A</span>');
    expect(container.innerHTML).not.toContain('<span>B</span>');
    expect(ref.current).not.toBe(span);
  });

  /** 测试场景：验证「calls the onDeleted hydration callback if the parent gets deleted」描述的渲染、交互或错误处理结果。 */
  it('calls the onDeleted hydration callback if the parent gets deleted', async () => {
    let suspend = false;
    const promise = new Promise(() => {});
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({deleted}) {
      if (deleted) {
        return null;
      }
      return (
        <div>
          <Activity>
            <Child />
          </Activity>
        </div>
      );
    }

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(<App />);

    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    const deleted = [];

    // 客户端尚未取得全部数据，但仍要开始水合。
    suspend = true;
    const root = await act(() => {
      return ReactDOMClient.hydrateRoot(container, <App />, {
        /** `onDeleted`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onDeleted(node) {
          deleted.push(node);
        },
      });
    });

    expect(deleted.length).toBe(0);

    await act(() => {
      root.render(<App deleted={true} />);
    });

    // 回调应已调用。
    expect(deleted.length).toBe(1);
  });

  /** 测试场景：验证「can insert siblings before the dehydrated boundary」描述的渲染、交互或错误处理结果。 */
  it('can insert siblings before the dehydrated boundary', async () => {
    let suspend = false;
    const promise = new Promise(() => {});
    let showSibling;

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return 'Second';
      }
    }

    /** `Sibling`：封装当前用例复用的操作、回调或断言步骤。 */
    function Sibling() {
      const [visible, setVisibilty] = React.useState(false);
      showSibling = () => setVisibilty(true);
      if (visible) {
        return <div>First</div>;
      }
      return null;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div>
          <Sibling />
          <Activity>
            <span>
              <Child />
            </span>
          </Activity>
        </div>
      );
    }

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    // 客户端尚未取得全部数据，但仍要开始水合。
    suspend = true;

    await act(() => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });

    expect(container.firstChild.firstChild.tagName).not.toBe('DIV');

    // 在该状态下，我们仍然可以更新兄弟元素。
    await act(() => showSibling());

    expect(container.firstChild.firstChild.tagName).toBe('DIV');
    expect(container.firstChild.firstChild.textContent).toBe('First');
  });

  /** 测试场景：验证「can delete the dehydrated boundary before it is hydrated」描述的渲染、交互或错误处理结果。 */
  it('can delete the dehydrated boundary before it is hydrated', async () => {
    let suspend = false;
    const promise = new Promise(() => {});
    let hideMiddle;

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return (
          <>
            <div>Middle</div>
            Some text
          </>
        );
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [visible, setVisibilty] = React.useState(true);
      hideMiddle = () => setVisibilty(false);

      return (
        <div>
          <div>Before</div>
          {visible ? (
            <Activity>
              <Child />
            </Activity>
          ) : null}
          <div>After</div>
        </div>
      );
    }

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    // 客户端尚未取得全部数据，但仍要开始水合。
    suspend = true;
    await act(() => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });

    expect(container.firstChild.children[1].textContent).toBe('Middle');

    // 在该状态下，我们仍然可以删除边界。
    await act(() => hideMiddle());

    expect(container.firstChild.children[1].textContent).toBe('After');
  });

  /** 测试场景：验证「blocks updates to hydrate the content first if props have changed」描述的渲染、交互或错误处理结果。 */
  it('blocks updates to hydrate the content first if props have changed', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({text}) {
      if (suspend) {
        throw promise;
      } else {
        return text;
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({text, className}) {
      return (
        <div>
          <Activity>
            <span ref={ref} className={className}>
              <Child text={text} />
            </span>
          </Activity>
        </div>
      );
    }

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(
      <App text="Hello" className="hello" />,
    );
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    const span = container.getElementsByTagName('span')[0];

    // 客户端尚未取得全部数据，但仍要开始水合。
    suspend = true;
    const root = ReactDOMClient.hydrateRoot(
      container,
      <App text="Hello" className="hello" />,
    );
    await waitForAll([]);

    expect(ref.current).toBe(null);
    expect(span.textContent).toBe('Hello');

    // 渲染一次更新，其优先级高于或等于水合 ping 的优先级。
    root.render(<App text="Hi" className="hi" />);

    // 同时兑现 Promise，使渲染得以完成。React 应先完成水合，再将更新冲刷到已水合状态。
    await act(async () => {
      suspend = false;
      resolve();
      await promise;
    });

    // 新 span 应与原来相同，因为它应在变更前已成功水合。
    const newSpan = container.getElementsByTagName('span')[0];
    expect(span).toBe(newSpan);

    // 此时新 span 应已完成渲染，并由 ref 指向。
    expect(ref.current).toBe(span);
    expect(span.textContent).toBe('Hi');
    // 如果最终水合了现有内容，树可能未被正确修补，className 也可能因此没有更新。
    expect(span.className).toBe('hi');
  });

  // @gate www
  /** 测试场景：验证「blocks updates to hydrate the content first if props changed at idle priority」描述的渲染、交互或错误处理结果。 */
  it('blocks updates to hydrate the content first if props changed at idle priority', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({text}) {
      if (suspend) {
        throw promise;
      } else {
        return text;
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({text, className}) {
      return (
        <div>
          <Activity>
            <span ref={ref} className={className}>
              <Child text={text} />
            </span>
          </Activity>
        </div>
      );
    }

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(
      <App text="Hello" className="hello" />,
    );
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    const span = container.getElementsByTagName('span')[0];

    // 客户端尚未取得全部数据，但仍要开始水合。
    suspend = true;
    const root = ReactDOMClient.hydrateRoot(
      container,
      <App text="Hello" className="hello" />,
    );
    await waitForAll([]);

    expect(ref.current).toBe(null);
    expect(span.textContent).toBe('Hello');

    // 以 Idle 优先级调度更新。
    ReactDOM.unstable_runWithPriority(IdleEventPriority, () => {
      root.render(<App text="Hi" className="hi" />);
    });

    // 同时, 解析 Promise 以允许渲染完成。
    suspend = false;
    resolve();
    await promise;

    // 应先完成水合，再将更新冲刷到已水合状态。
    await waitForAll([]);

    // 新 span 应与原来相同，因为它应在变更前已成功水合。
    const newSpan = container.getElementsByTagName('span')[0];
    expect(span).toBe(newSpan);

    // 此时新 span 应已完成渲染，并由 ref 指向。
    expect(ref.current).toBe(span);
    expect(span.textContent).toBe('Hi');
    // 如果最终水合了现有内容，树可能未被正确修补，className 也可能因此没有更新。
    expect(span.className).toBe('hi');
  });

  /** 测试场景：验证「shows the fallback of the parent if props have changed before hydration completes and is still suspended」描述的渲染、交互或错误处理结果。 */
  it('shows the fallback of the parent if props have changed before hydration completes and is still suspended', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const outerRef = React.createRef();
    const ref = React.createRef();

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({text}) {
      if (suspend) {
        throw promise;
      } else {
        return text;
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({text, className}) {
      return (
        <Suspense fallback="Loading...">
          <div ref={outerRef}>
            <Activity>
              <span ref={ref} className={className}>
                <Child text={text} />
              </span>
            </Activity>
          </div>
        </Suspense>
      );
    }

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(
      <App text="Hello" className="hello" />,
    );
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    // 客户端尚未取得全部数据，但仍要开始水合。
    suspend = true;
    const root = ReactDOMClient.hydrateRoot(
      container,
      <App text="Hello" className="hello" />,
      {
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
          if (error.cause) {
            Scheduler.log('Cause: ' + normalizeError(error.cause.message));
          }
        },
      },
    );
    await waitForAll([]);

    expect(container.getElementsByTagName('div').length).toBe(1); // 隐藏
    const div = container.getElementsByTagName('div')[0];

    expect(outerRef.current).toBe(div);
    expect(ref.current).toBe(null);

    // 渲染更新，但保持其仍处于挂起状态。
    await act(() => {
      root.render(<App text="Hi" className="hi" />);
    });

    // 立即冲刷应隐藏现有内容并显示后备内容。

    expect(outerRef.current).toBe(null);
    expect(div.style.display).toBe('none');
    expect(container.getElementsByTagName('span').length).toBe(1); // 隐藏
    expect(ref.current).toBe(null);
    expect(container.textContent).toBe('HelloLoading...');

    // 解除挂起后显示内容。
    await act(async () => {
      suspend = false;
      resolve();
      await promise;
    });

    const span = container.getElementsByTagName('span')[0];
    expect(span.textContent).toBe('Hi');
    expect(span.className).toBe('hi');
    expect(ref.current).toBe(span);
    expect(container.textContent).toBe('Hi');
  });

  /** 测试场景：验证「clears nested activity boundaries if they did not hydrate yet」描述的渲染、交互或错误处理结果。 */
  it('clears nested activity boundaries if they did not hydrate yet', async () => {
    let suspend = false;
    const promise = new Promise(() => {});
    const ref = React.createRef();

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({text}) {
      if (suspend && text !== 'Hi') {
        throw promise;
      } else {
        return text;
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({text, className}) {
      return (
        <div>
          <Activity>
            <Activity>
              <Child text={text} />
            </Activity>{' '}
            <span ref={ref} className={className}>
              <Child text={text} />
            </span>
          </Activity>
        </div>
      );
    }

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(
      <App text="Hello" className="hello" />,
    );
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    // 客户端尚未取得全部数据，但仍要开始水合。
    suspend = true;
    const root = ReactDOMClient.hydrateRoot(
      container,
      <App text="Hello" className="hello" />,
      {
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
          if (error.cause) {
            Scheduler.log('Cause: ' + normalizeError(error.cause.message));
          }
        },
      },
    );
    await waitForAll([]);

    expect(ref.current).toBe(null);

    // 渲染一次解除阻塞的更新；立即冲刷应删除现有内容并显示更新结果。
    await act(() => {
      root.render(<App text="Hi" className="hi" />);
    });

    const span = container.getElementsByTagName('span')[0];
    expect(span.textContent).toBe('Hi');
    expect(span.className).toBe('hi');
    expect(ref.current).toBe(span);
    expect(container.textContent).toBe('Hi Hi');
  });

  /** 测试场景：验证「hydrates first if props changed but we are able to resolve within a timeout」描述的渲染、交互或错误处理结果。 */
  it('hydrates first if props changed but we are able to resolve within a timeout', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({text}) {
      if (suspend) {
        throw promise;
      } else {
        return text;
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({text, className}) {
      return (
        <div>
          <Activity>
            <span ref={ref} className={className}>
              <Child text={text} />
            </span>
          </Activity>
        </div>
      );
    }

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(
      <App text="Hello" className="hello" />,
    );
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    const span = container.getElementsByTagName('span')[0];

    // 客户端尚未取得全部数据，但仍要开始水合。
    suspend = true;
    const root = ReactDOMClient.hydrateRoot(
      container,
      <App text="Hello" className="hello" />,
    );
    await waitForAll([]);

    expect(ref.current).toBe(null);
    expect(container.textContent).toBe('Hello');

    // 渲染一个带有长超时的更新。
    React.startTransition(() => root.render(<App text="Hi" className="hi" />));
    // 此时还不应强制显示后备内容。
    await waitForAll([]);

    expect(ref.current).toBe(null);
    expect(container.textContent).toBe('Hello');

    // 兑现 Promise 让渲染完成；应先完成水合，再将更新冲刷到已水合状态。
    suspend = false;
    await act(() => resolve());

    // 新 span 应与原来相同，因为它应在变更前已成功水合。
    const newSpan = container.getElementsByTagName('span')[0];
    expect(span).toBe(newSpan);

    // 此时新 span 应已完成渲染，并由 ref 指向。
    expect(ref.current).toBe(span);
    expect(container.textContent).toBe('Hi');
    // 如果最终水合了现有内容，树可能未被正确修补，className 也可能因此没有更新。
    expect(span.className).toBe('hi');
  });

  /** 测试场景：验证「warns but works if setState is called before commit in a dehydrated component」描述的渲染、交互或错误处理结果。 */
  it('warns but works if setState is called before commit in a dehydrated component', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    let updateText;

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      const [state, setState] = React.useState('Hello');
      updateText = setState;
      Scheduler.log('Child');
      if (suspend) {
        throw promise;
      } else {
        return state;
      }
    }

    /** `Sibling`：封装当前用例复用的操作、回调或断言步骤。 */
    function Sibling() {
      Scheduler.log('Sibling');
      return null;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div>
          <Activity>
            <Child />
            <Sibling />
          </Activity>
        </div>
      );
    }

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(<App />);
    assertLog(['Child', 'Sibling']);

    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    ReactDOMClient.hydrateRoot(
      container,
      <App text="Hello" className="hello" />,
    );

    await act(async () => {
      suspend = true;
      await waitFor(['Child']);

      // 水合进行到一半时更新状态，这会在 Activity 边界的子节点上调度更新。
      updateText('Hi');
      assertConsoleErrorDev([
        "Can't perform a React state update on a component that hasn't mounted yet. " +
          'This indicates that you have a side-effect in your render function that ' +
          'asynchronously tries to update the component. Move this work to useEffect instead.\n' +
          '    in App (at **)',
      ]);

      // 这会丢弃现有内容并重新渲染。
      await waitForAll(['Child']);

      expect(container.textContent).toBe('Hello');

      suspend = false;
      resolve();
      await promise;
    });
    assertLog(['Child', 'Sibling']);

    expect(container.textContent).toBe('Hello');
  });

  /** 测试场景：验证「blocks the update to hydrate first if context has changed」描述的渲染、交互或错误处理结果。 */
  it('blocks the update to hydrate first if context has changed', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();
    const Context = React.createContext(null);

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      const {text, className} = React.useContext(Context);
      if (suspend) {
        throw promise;
      } else {
        return (
          <span ref={ref} className={className}>
            {text}
          </span>
        );
      }
    }

    const App = React.memo(function App() {
      return (
        <div>
          <Activity>
            <Child />
          </Activity>
        </div>
      );
    });

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(
      <Context.Provider value={{text: 'Hello', className: 'hello'}}>
        <App />
      </Context.Provider>,
    );
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    const span = container.getElementsByTagName('span')[0];

    // 客户端尚未取得全部数据，但仍要开始水合。
    suspend = true;
    const root = ReactDOMClient.hydrateRoot(
      container,
      <Context.Provider value={{text: 'Hello', className: 'hello'}}>
        <App />
      </Context.Provider>,
    );
    await waitForAll([]);

    expect(ref.current).toBe(null);
    expect(span.textContent).toBe('Hello');

    // 渲染一次更新，其优先级高于或等于水合 ping 的优先级。
    root.render(
      <Context.Provider value={{text: 'Hi', className: 'hi'}}>
        <App />
      </Context.Provider>,
    );

    // 同时兑现 Promise，使渲染得以完成。React 应先完成水合，再将更新冲刷到已水合状态。
    await act(async () => {
      suspend = false;
      resolve();
      await promise;
    });

    // 这里应已完成水合，因此仍应是同一个 span。
    const newSpan = container.getElementsByTagName('span')[0];
    expect(newSpan).toBe(span);

    // 此时新 span 应已完成渲染，并由 ref 指向。
    expect(ref.current).toBe(span);
    expect(span.textContent).toBe('Hi');
    // 如果最终水合了现有内容，树可能未被正确修补，className 也可能因此没有更新。
    expect(span.className).toBe('hi');
  });

  /** 测试场景：验证「shows the parent fallback if context has changed before hydration completes and is still suspended」描述的渲染、交互或错误处理结果。 */
  it('shows the parent fallback if context has changed before hydration completes and is still suspended', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();
    const Context = React.createContext(null);

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      const {text, className} = React.useContext(Context);
      if (suspend) {
        throw promise;
      } else {
        return (
          <span ref={ref} className={className}>
            {text}
          </span>
        );
      }
    }

    const App = React.memo(function App() {
      return (
        <Suspense fallback="Loading...">
          <div>
            <Activity>
              <Child />
            </Activity>
          </div>
        </Suspense>
      );
    });

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(
      <Context.Provider value={{text: 'Hello', className: 'hello'}}>
        <App />
      </Context.Provider>,
    );
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    // 客户端尚未取得全部数据，但仍要开始水合。
    suspend = true;
    const root = ReactDOMClient.hydrateRoot(
      container,
      <Context.Provider value={{text: 'Hello', className: 'hello'}}>
        <App />
      </Context.Provider>,
      {
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
          if (error.cause) {
            Scheduler.log('Cause: ' + normalizeError(error.cause.message));
          }
        },
      },
    );
    await waitForAll([]);

    expect(ref.current).toBe(null);

    // 渲染一次仍会保持挂起的更新；立即冲刷应删除现有内容并显示后备内容。
    await act(() => {
      root.render(
        <Context.Provider value={{text: 'Hi', className: 'hi'}}>
          <App />
        </Context.Provider>,
      );
    });

    expect(container.getElementsByTagName('span').length).toBe(1); // 隐藏
    expect(ref.current).toBe(null);
    expect(container.textContent).toBe('HelloLoading...');

    // 解除挂起后显示内容。
    await act(async () => {
      suspend = false;
      resolve();
      await promise;
    });

    const span = container.getElementsByTagName('span')[0];
    expect(span.textContent).toBe('Hi');
    expect(span.className).toBe('hi');
    expect(ref.current).toBe(span);
    expect(container.textContent).toBe('Hi');
  });

  /** 测试场景：验证「can hydrate TWO activity boundaries」描述的渲染、交互或错误处理结果。 */
  it('can hydrate TWO activity boundaries', async () => {
    const ref1 = React.createRef();
    const ref2 = React.createRef();

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div>
          <Activity>
            <span ref={ref1}>1</span>
          </Activity>
          <Activity>
            <span ref={ref2}>2</span>
          </Activity>
        </div>
      );
    }

    // 首先渲染最终 HTML。流式渲染器可能在服务端产生 Suspense 挂起点，但这里要测试完整 HTML，因此服务端不要挂起。
    const finalHTML = ReactDOMServer.renderToString(<App />);

    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    const span1 = container.getElementsByTagName('span')[0];
    const span2 = container.getElementsByTagName('span')[1];

    // 客户端尚未取得全部数据，但仍要开始水合。
    ReactDOMClient.hydrateRoot(container, <App />);
    await waitForAll([]);

    expect(ref1.current).toBe(span1);
    expect(ref2.current).toBe(span2);
  });

  /** 测试场景：验证「regenerates if it cannot hydrate before changes to props/context expire」描述的渲染、交互或错误处理结果。 */
  it('regenerates if it cannot hydrate before changes to props/context expire', async () => {
    let suspend = false;
    const promise = new Promise(resolvePromise => {});
    const ref = React.createRef();
    const ClassName = React.createContext(null);

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({text}) {
      const className = React.useContext(ClassName);
      if (suspend && className !== 'hi' && text !== 'Hi') {
        // 新数据永远不会挂起。
        throw promise;
      } else {
        return (
          <span ref={ref} className={className}>
            {text}
          </span>
        );
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({text, className}) {
      return (
        <div>
          <Activity>
            <Child text={text} />
          </Activity>
        </div>
      );
    }

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(
      <ClassName.Provider value={'hello'}>
        <App text="Hello" />
      </ClassName.Provider>,
    );
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    const span = container.getElementsByTagName('span')[0];

    // 客户端尚未取得全部数据，但仍要开始水合。
    suspend = true;
    const root = ReactDOMClient.hydrateRoot(
      container,
      <ClassName.Provider value={'hello'}>
        <App text="Hello" />
      </ClassName.Provider>,
      {
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
          if (error.cause) {
            Scheduler.log('Cause: ' + normalizeError(error.cause.message));
          }
        },
      },
    );
    await waitForAll([]);

    expect(ref.current).toBe(null);
    expect(span.textContent).toBe('Hello');

    // 渲染一次更新，其优先级高于或等于水合 ping。新更新不会挂起；由于原始数据仍挂起，当前无法水合。这会强制冲刷所有过期时间。
    await act(() => {
      root.render(
        <ClassName.Provider value={'hi'}>
          <App text="Hi" />
        </ClassName.Provider>,
      );
    });

    // 由于此前无法水合，现在会得到一个新的 span。
    const newSpan = container.getElementsByTagName('span')[0];
    expect(newSpan).not.toBe(span);

    // 此时新 span 应已完成渲染，并由 ref 指向。
    expect(ref.current).toBe(newSpan);
    expect(newSpan.textContent).toBe('Hi');
    // 如果最终水合了现有内容，树可能未被正确修补，className 也可能因此没有更新。
    expect(newSpan.className).toBe('hi');
  });

  /** 测试场景：验证「does not invoke an event on a hydrated node until it commits」描述的渲染、交互或错误处理结果。 */
  it('does not invoke an event on a hydrated node until it commits', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** `Sibling`：封装当前用例复用的操作、回调或断言步骤。 */
    function Sibling({text}) {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    let clicks = 0;

    /** `Button`：封装当前用例复用的操作、回调或断言步骤。 */
    function Button() {
      const [clicked, setClicked] = React.useState(false);
      if (clicked) {
        return null;
      }
      return (
        <a
          onClick={() => {
            setClicked(true);
            clicks++;
          }}>
          Click me
        </a>
      );
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div>
          <Activity>
            <Button />
            <Sibling />
          </Activity>
        </div>
      );
    }

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    // 我们需要将其放在文档中，因为我们将在此处触发事件。
    document.body.appendChild(container);

    const a = container.getElementsByTagName('a')[0];

    // 客户端尚未取得全部数据，但仍要开始水合。
    suspend = true;
    ReactDOMClient.hydrateRoot(container, <App />);
    await waitForAll([]);

    expect(container.textContent).toBe('Click meHello');

    // 此时已完成部分水合。
    await act(() => {
      a.click();
    });
    expect(clicks).toBe(0);

    // 解析 Promise 以允许渲染完成。
    await act(async () => {
      suspend = false;
      resolve();
      await promise;
    });

    expect(clicks).toBe(0);
    expect(container.textContent).toBe('Click meHello');

    document.body.removeChild(container);
  });

  // @gate www
  /** 测试场景：验证「does not invoke an event on a hydrated event handle until it commits」描述的渲染、交互或错误处理结果。 */
  it('does not invoke an event on a hydrated event handle until it commits', async () => {
    const setClick = ReactDOM.unstable_createEventHandle('click');
    let suspend = false;
    let isServerRendering = true;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** `Sibling`：封装当前用例复用的操作、回调或断言步骤。 */
    function Sibling({text}) {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    const onEvent = jest.fn();

    /** `Button`：封装当前用例复用的操作、回调或断言步骤。 */
    function Button() {
      const ref = React.useRef(null);
      if (!isServerRendering) {
        React.useLayoutEffect(() => {
          return setClick(ref.current, onEvent);
        });
      }
      return <a ref={ref}>Click me</a>;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div>
          <Activity>
            <Button />
            <Sibling />
          </Activity>
        </div>
      );
    }

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    // 我们需要将其放在文档中，因为我们将在此处触发事件。
    document.body.appendChild(container);

    const a = container.getElementsByTagName('a')[0];

    // 客户端尚未取得全部数据，但仍要开始水合。
    suspend = true;
    isServerRendering = false;
    ReactDOMClient.hydrateRoot(container, <App />);

    // 水合前先点击一次。
    a.click();
    // 这应该延迟.
    expect(onEvent).toHaveBeenCalledTimes(0);

    await waitForAll([]);

    // 此时已完成部分水合。
    await act(() => {
      a.click();
    });
    // 尚未水合，因此此时不应触发事件。
    expect(onEvent).toHaveBeenCalledTimes(0);

    // 解析 Promise 以允许渲染完成。
    await act(async () => {
      suspend = false;
      resolve();
      await promise;
    });

    expect(onEvent).toHaveBeenCalledTimes(0);

    document.body.removeChild(container);
  });

  /** 测试场景：验证「invokes discrete events on nested activity boundaries in a root (legacy system)」描述的渲染、交互或错误处理结果。 */
  it('invokes discrete events on nested activity boundaries in a root (legacy system)', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    let clicks = 0;

    /** `Button`：封装当前用例复用的操作、回调或断言步骤。 */
    function Button() {
      return (
        <a
          onClick={() => {
            clicks++;
          }}>
          Click me
        </a>
      );
    }

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return (
          <Activity>
            <Button />
          </Activity>
        );
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Activity>
          <Child />
        </Activity>
      );
    }

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    // 我们需要将其放在文档中，因为我们将在此处触发事件。
    document.body.appendChild(container);

    const a = container.getElementsByTagName('a')[0];

    // 客户端尚未取得全部数据，但仍要开始水合。
    suspend = true;
    ReactDOMClient.hydrateRoot(container, <App />);

    // 水合前先点击一次。
    await act(() => {
      a.click();
    });
    // 这应该延迟.
    expect(clicks).toBe(0);

    await waitForAll([]);

    // 此时已完成部分水合。
    await act(() => {
      a.click();
    });
    expect(clicks).toBe(0);

    // 解析 Promise 以允许渲染完成。
    await act(async () => {
      suspend = false;
      resolve();
      await promise;
    });

    expect(clicks).toBe(0);

    document.body.removeChild(container);
  });

  // @gate www
  /** 测试场景：验证「invokes discrete events on nested activity boundaries in a root (createEventHandle)」描述的渲染、交互或错误处理结果。 */
  it('invokes discrete events on nested activity boundaries in a root (createEventHandle)', async () => {
    let suspend = false;
    let isServerRendering = true;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    const onEvent = jest.fn();
    const setClick = ReactDOM.unstable_createEventHandle('click');

    /** `Button`：封装当前用例复用的操作、回调或断言步骤。 */
    function Button() {
      const ref = React.useRef(null);

      if (!isServerRendering) {
        React.useLayoutEffect(() => {
          return setClick(ref.current, onEvent);
        });
      }

      return <a ref={ref}>Click me</a>;
    }

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return (
          <Activity>
            <Button />
          </Activity>
        );
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Activity>
          <Child />
        </Activity>
      );
    }

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    // 我们需要将其放在文档中，因为我们将在此处触发事件。
    document.body.appendChild(container);

    const a = container.getElementsByTagName('a')[0];

    // 客户端尚未取得全部数据，但仍要开始水合。
    suspend = true;
    isServerRendering = false;
    ReactDOMClient.hydrateRoot(container, <App />);

    // 水合前先点击一次。
    a.click();
    // 这应该延迟.
    expect(onEvent).toHaveBeenCalledTimes(0);

    await waitForAll([]);

    // 此时已完成部分水合。
    await act(() => {
      a.click();
    });
    // 尚未水合，因此此时不应触发事件。
    expect(onEvent).toHaveBeenCalledTimes(0);

    // 解析 Promise 以允许渲染完成。
    await act(async () => {
      suspend = false;
      resolve();
      await promise;
    });

    expect(onEvent).toHaveBeenCalledTimes(0);

    document.body.removeChild(container);
  });

  /** 测试场景：验证「does not invoke the parent of dehydrated boundary event」描述的渲染、交互或错误处理结果。 */
  it('does not invoke the parent of dehydrated boundary event', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    let clicksOnParent = 0;
    let clicksOnChild = 0;

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({text}) {
      if (suspend) {
        throw promise;
      } else {
        return (
          <span
            onClick={e => {
              // 停止传播是一个示例，说明仅在父元素上调用事件可能并不正确。
              e.stopPropagation();
              clicksOnChild++;
            }}>
            Hello
          </span>
        );
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div onClick={() => clicksOnParent++}>
          <Activity>
            <Child />
          </Activity>
        </div>
      );
    }

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    // 我们需要将其放在文档中，因为我们将在此处触发事件。
    document.body.appendChild(container);

    const span = container.getElementsByTagName('span')[0];

    // 客户端尚未取得全部数据，但仍要开始水合。
    suspend = true;
    ReactDOMClient.hydrateRoot(container, <App />);
    await waitForAll([]);

    // 此时已完成部分水合。
    await act(() => {
      span.click();
    });
    expect(clicksOnChild).toBe(0);
    expect(clicksOnParent).toBe(0);

    // 解析 Promise 以允许渲染完成。
    await act(async () => {
      suspend = false;
      resolve();
      await promise;
    });

    expect(clicksOnChild).toBe(0);
    expect(clicksOnParent).toBe(0);

    document.body.removeChild(container);
  });

  /** 测试场景：验证「does not invoke an event on a parent tree when a subtree is dehydrated」描述的渲染、交互或错误处理结果。 */
  it('does not invoke an event on a parent tree when a subtree is dehydrated', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    let clicks = 0;
    const childSlotRef = React.createRef();

    /** `Parent`：封装当前用例复用的操作、回调或断言步骤。 */
    function Parent() {
      return <div onClick={() => clicks++} ref={childSlotRef} />;
    }

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({text}) {
      if (suspend) {
        throw promise;
      } else {
        return <a>Click me</a>;
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      // 根节点是 Suspense 边界。
      return (
        <Activity>
          <Child />
        </Activity>
      );
    }

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(<App />);

    const parentContainer = document.createElement('div');
    const childContainer = document.createElement('div');

    // 我们需要将其放在文档中，因为我们将在此处触发事件。
    document.body.appendChild(parentContainer);

    // 我们将使用不同的根作为父元素。 这样我们就可以检测到事件是否通过React的事件系统.
    const parentRoot = ReactDOMClient.createRoot(parentContainer);
    await act(() => parentRoot.render(<Parent />));

    childSlotRef.current.appendChild(childContainer);

    childContainer.innerHTML = finalHTML;

    const a = childContainer.getElementsByTagName('a')[0];

    suspend = true;

    // 异步水合。
    await act(() => ReactDOMClient.hydrateRoot(childContainer, <App />));

    // Suspense 边界尚未水合。
    await act(() => {
      a.click();
    });
    expect(clicks).toBe(0);

    // 解析 Promise 以允许渲染完成。
    await act(async () => {
      suspend = false;
      resolve();
      await promise;
    });

    expect(clicks).toBe(0);

    document.body.removeChild(parentContainer);
  });

  /** 测试场景：验证「blocks only on the last continuous event (legacy system)」描述的渲染、交互或错误处理结果。 */
  it('blocks only on the last continuous event (legacy system)', async () => {
    let suspend1 = false;
    let resolve1;
    const promise1 = new Promise(resolvePromise => (resolve1 = resolvePromise));
    let suspend2 = false;
    let resolve2;
    const promise2 = new Promise(resolvePromise => (resolve2 = resolvePromise));

    /** `First`：封装当前用例复用的操作、回调或断言步骤。 */
    function First({text}) {
      if (suspend1) {
        throw promise1;
      } else {
        return 'Hello';
      }
    }

    /** `Second`：封装当前用例复用的操作、回调或断言步骤。 */
    function Second({text}) {
      if (suspend2) {
        throw promise2;
      } else {
        return 'World';
      }
    }

    const ops = [];

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div>
          <Activity>
            <span
              onMouseEnter={() => ops.push('Mouse Enter First')}
              onMouseLeave={() => ops.push('Mouse Leave First')}
            />
            {/* 我们随后挂起，用于测试预先挂载监听器时会发生什么。 */}
            <First />
          </Activity>
          <Activity>
            <span
              onMouseEnter={() => ops.push('Mouse Enter Second')}
              onMouseLeave={() => ops.push('Mouse Leave Second')}>
              <Second />
            </span>
          </Activity>
        </div>
      );
    }

    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    // 我们需要将其放在文档中，因为我们将在此处触发事件。
    document.body.appendChild(container);

    const appDiv = container.getElementsByTagName('div')[0];
    const firstSpan = appDiv.getElementsByTagName('span')[0];
    const secondSpan = appDiv.getElementsByTagName('span')[1];
    expect(firstSpan.textContent).toBe('');
    expect(secondSpan.textContent).toBe('World');

    // 客户端尚未取得全部数据，但仍要开始水合。
    suspend1 = true;
    suspend2 = true;
    ReactDOMClient.hydrateRoot(container, <App />);

    await waitForAll([]);

    dispatchMouseEvent(appDiv, null);
    dispatchMouseEvent(firstSpan, appDiv);
    dispatchMouseEvent(secondSpan, firstSpan);

    // 两个目标都尚未水合。
    expect(ops).toEqual([]);

    // 兑现第二个 Promise，使渲染得以完成。
    suspend2 = false;
    resolve2();
    await promise2;

    await waitForAll([]);

    // 当前悬停目标已解除阻塞，因此现在应能重播事件。
    expect(ops).toEqual(['Mouse Enter Second']);

    // 此时兑现第一个 Promise 不会产生影响。
    suspend1 = false;
    resolve1();
    await promise1;

    await waitForAll([]);

    expect(ops).toEqual(['Mouse Enter Second']);

    document.body.removeChild(container);
  });

  /** 测试场景：验证「finishes normal pri work before continuing to hydrate a retry」描述的渲染、交互或错误处理结果。 */
  it('finishes normal pri work before continuing to hydrate a retry', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        Scheduler.log('Child');
        return 'Hello';
      }
    }

    /** `Sibling`：封装当前用例复用的操作、回调或断言步骤。 */
    function Sibling() {
      Scheduler.log('Sibling');
      React.useLayoutEffect(() => {
        Scheduler.log('Commit Sibling');
      });
      return 'World';
    }

    // 避免重渲染树，将它提升到顶部。
    const tree = (
      <Activity>
        <span ref={ref}>
          <Child />
        </span>
      </Activity>
    );

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({showSibling}) {
      return (
        <div>
          {tree}
          {showSibling ? <Sibling /> : null}
        </div>
      );
    }

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(<App />);
    assertLog(['Child']);

    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    suspend = true;
    const root = ReactDOMClient.hydrateRoot(
      container,
      <App showSibling={false} />,
    );
    await waitForAll([]);

    expect(ref.current).toBe(null);
    expect(container.textContent).toBe('Hello');

    // Promise 兑现后应继续水合。
    suspend = false;
    resolve();
    await promise;

    Scheduler.unstable_advanceTime(100);

    // 在有机会冲刷它之前，还会再渲染一次更新。
    root.render(<App showSibling={true} />);

    // 冲刷时，Normal 优先级的渲染应高于水合。
    await waitFor(['Sibling', 'Commit Sibling']);

    // 此时子组件应尚未水合。
    expect(ref.current).toBe(null);
    // 但我们确实有机会更新内容.
    expect(container.textContent).toBe('HelloWorld');

    await waitForAll(['Child']);

    // 此时已完成水合。
    expect(ref.current).not.toBe(null);
  });

  /** 测试场景：验证「regression test: does not overfire non-bubbling browser events」描述的渲染、交互或错误处理结果。 */
  it('regression test: does not overfire non-bubbling browser events', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** `Sibling`：封装当前用例复用的操作、回调或断言步骤。 */
    function Sibling({text}) {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    let submits = 0;

    /** `Form`：封装当前用例复用的操作、回调或断言步骤。 */
    function Form() {
      const [submitted, setSubmitted] = React.useState(false);
      if (submitted) {
        return null;
      }
      return (
        <form
          onSubmit={() => {
            setSubmitted(true);
            submits++;
          }}>
          Click me
        </form>
      );
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div>
          <Activity>
            <Form />
            <Sibling />
          </Activity>
        </div>
      );
    }

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    // 我们需要将其放在文档中，因为我们将在此处触发事件。
    document.body.appendChild(container);

    const form = container.getElementsByTagName('form')[0];

    // 客户端尚未取得全部数据，但仍要开始水合。
    suspend = true;
    ReactDOMClient.hydrateRoot(container, <App />);
    await waitForAll([]);

    expect(container.textContent).toBe('Click meHello');

    // 此时已完成部分水合。
    await act(() => {
      form.dispatchEvent(
        new window.Event('submit', {
          bubbles: true,
        }),
      );
    });
    expect(submits).toBe(0);

    // 解析 Promise 以允许渲染完成。
    await act(async () => {
      suspend = false;
      resolve();
      await promise;
    });

    // 离散事件未重播
    expect(submits).toBe(0);
    expect(container.textContent).toBe('Click meHello');

    document.body.removeChild(container);
  });

  /** 测试场景：验证「fallback to client render on hydration mismatch at root」描述的渲染、交互或错误处理结果。 */
  it('fallback to client render on hydration mismatch at root', async () => {
    let suspend = true;
    let resolve;
    const promise = new Promise((res, rej) => {
      resolve = () => {
        suspend = false;
        res();
      };
    });
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({isClient}) {
      return (
        <>
          <Activity>
            <ChildThatSuspends id={1} isClient={isClient} />
          </Activity>
          {isClient ? <span>client</span> : <div>server</div>}
          <Activity>
            <ChildThatSuspends id={2} isClient={isClient} />
          </Activity>
        </>
      );
    }
    /** `ChildThatSuspends`：封装当前用例复用的操作、回调或断言步骤。 */
    function ChildThatSuspends({id, isClient}) {
      if (isClient && suspend) {
        throw promise;
      }
      return <div>{id}</div>;
    }

    const finalHTML = ReactDOMServer.renderToString(<App isClient={false} />);

    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = finalHTML;

    await act(() => {
      ReactDOMClient.hydrateRoot(container, <App isClient={true} />, {
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
          if (error.cause) {
            Scheduler.log('Cause: ' + normalizeError(error.cause.message));
          }
        },
      });
    });

    // 等待 Promise 兑现时让根节点保持挂起，并保留现有内容。
    expect(container.innerHTML).toEqual(
      '<!--&--><div>1</div><!--/&--><div>server</div><!--&--><div>2</div><!--/&-->',
    );

    await act(async () => {
      resolve();
      await promise;
    });

    assertLog([
      "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
    ]);

    expect(container.innerHTML).toEqual(
      '<div>1</div><span>client</span><div>2</div>',
    );
  });

  /** 测试场景：验证「commits new suspending content next to a dehydrated Activity that hides」描述的渲染、交互或错误处理结果。 */
  it('commits new suspending content next to a dehydrated Activity that hides', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** `Second`：封装当前用例复用的操作、回调或断言步骤。 */
    function Second() {
      if (suspend) {
        throw promise;
      }
      return <span id="second">Second</span>;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({showSecondOnMount}) {
      const [active, setActive] = React.useState('first');
      React.useEffect(() => {
        if (showSecondOnMount) {
          // 不是 transition：未水合的 Activity 在完成水合前以 Default 优先级收到此更新。
          setActive('second');
        }
      }, [showSecondOnMount]);
      return (
        <div>
          <Suspense fallback={null}>
            {active === 'second' ? <Second /> : null}
            <Activity mode={active === 'first' ? 'visible' : 'hidden'}>
              <span id="first">First</span>
            </Activity>
          </Suspense>
        </div>
      );
    }

    // 在服务器上不要挂起。
    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(
      <App showSecondOnMount={false} />,
    );
    const container = document.createElement('div');
    container.innerHTML = finalHTML;
    expect(container.textContent).toBe('First');

    // 开始水合。第一个 effect 挂载仍在加载的新内容，并在其子树仍未水合时隐藏服务端渲染的 Activity。
    suspend = true;
    await act(() => {
      ReactDOMClient.hydrateRoot(container, <App showSecondOnMount={true} />);
    });

    // 新行的数据到达。
    suspend = false;
    await act(async () => {
      resolve();
      await promise;
    });

    // 新行应可见，旧行应隐藏。
    const second = container.querySelector('#second');
    const first = container.querySelector('#first');
    expect(second).not.toBe(null);
    expect(second.style.display).not.toBe('none');
    expect(first === null || first.style.display === 'none').toBe(true);
  });

  /** 测试场景：验证「commits new suspending content next to a dehydrated Activity that hides (transition)」描述的渲染、交互或错误处理结果。 */
  it('commits new suspending content next to a dehydrated Activity that hides (transition)', async () => {
    // 同上测试。 除了更新被包裹在 startTransition 中。
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** `Second`：封装当前用例复用的操作、回调或断言步骤。 */
    function Second() {
      if (suspend) {
        throw promise;
      }
      return <span id="second">Second</span>;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({showSecondOnMount}) {
      const [active, setActive] = React.useState('first');
      React.useEffect(() => {
        if (showSecondOnMount) {
          React.startTransition(() => {
            setActive('second');
          });
        }
      }, [showSecondOnMount]);
      return (
        <div>
          <Suspense fallback={null}>
            {active === 'second' ? <Second /> : null}
            <Activity mode={active === 'first' ? 'visible' : 'hidden'}>
              <span id="first">First</span>
            </Activity>
          </Suspense>
        </div>
      );
    }

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(
      <App showSecondOnMount={false} />,
    );
    const container = document.createElement('div');
    container.innerHTML = finalHTML;
    expect(container.textContent).toBe('First');

    suspend = true;
    await act(() => {
      ReactDOMClient.hydrateRoot(container, <App showSecondOnMount={true} />);
    });

    suspend = false;
    await act(async () => {
      resolve();
      await promise;
    });

    const second = container.querySelector('#second');
    const first = container.querySelector('#first');
    expect(second).not.toBe(null);
    expect(second.style.display).not.toBe('none');
    expect(first === null || first.style.display === 'none').toBe(true);
  });
});
