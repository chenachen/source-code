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
let SuspenseList;
let useSyncExternalStore;
let use;
let act;
let IdleEventPriority;
let waitForAll;
let waitFor;
let waitForPaint;
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

/** `TestAppClass`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
class TestAppClass extends React.Component {
  /** `TestAppClass.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
  render() {
    return (
      <div>
        <>{''}</>
        <>{'Hello'}</>
      </div>
    );
  }
}

describe('ReactDOMServerPartialHydration', () => {
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
    use = React.use;
    if (gate(flags => flags.enableSuspenseList)) {
      SuspenseList = React.unstable_SuspenseList;
    }

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    assertLog = InternalTestUtils.assertLog;
    waitForPaint = InternalTestUtils.waitForPaint;
    waitFor = InternalTestUtils.waitFor;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;

    IdleEventPriority = require('react-reconciler/constants').IdleEventPriority;
  });

  // 注意：此组件基于我们在 www 中使用的类似组件；额外的 div 包装不再需要后即可删除它。
  /** `LegacyHiddenDiv`：封装当前用例复用的操作、回调或断言步骤。 */
  function LegacyHiddenDiv({children, mode}) {
    return (
      <div hidden={mode === 'hidden'}>
        <React.unstable_LegacyHidden
          mode={mode === 'hidden' ? 'unstable-defer-without-hiding' : mode}>
          {children}
        </React.unstable_LegacyHidden>
      </div>
    );
  }

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「hydrates a parent even if a child Suspense boundary is blocked」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言对应 ReactDOMRoot.hydrateRoot 的容器认领与事件重放路径。
   */
  it('hydrates a parent even if a child Suspense boundary is blocked', async () => {
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
          <Suspense fallback="Loading...">
            <span ref={ref}>
              <Child />
            </span>
          </Suspense>
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
        <Suspense fallback="Loading...">
          <Child />
          <Suspense fallback="Loading...">
            <div>Hello</div>
          </Suspense>
        </Suspense>
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

  /** 测试场景：验证「replays effects when a suspended boundary hydrates in StrictMode」描述的渲染、交互或错误处理结果。 */
  it('replays effects when a suspended boundary hydrates in StrictMode', async () => {
    const log = [];
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** `EffectfulChild`：封装当前用例复用的操作、回调或断言步骤。 */
    function EffectfulChild() {
      React.useLayoutEffect(() => {
        log.push('layout mount');
        return () => log.push('layout unmount');
      }, []);
      React.useEffect(() => {
        log.push('effect mount');
        return () => log.push('effect unmount');
      }, []);
      return 'Hello';
    }

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      if (suspend) {
        use(promise);
      }
      return <EffectfulChild />;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Suspense fallback="Loading...">
          <Child />
        </Suspense>
      );
    }

    const element = (
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(element);
    const container = document.createElement('div');
    container.innerHTML = finalHTML;
    expect(container.textContent).toBe('Hello');

    suspend = true;
    ReactDOMClient.hydrateRoot(container, element);
    await waitForAll([]);
    expect(log).toEqual([]);
    expect(container.textContent).toBe('Hello');

    suspend = false;
    resolve();
    await promise;
    await waitForAll([]);

    expect(container.textContent).toBe('Hello');
    if (__DEV__) {
      expect(log).toEqual([
        'layout mount',
        'effect mount',
        'layout unmount',
        'effect unmount',
        'layout mount',
        'effect mount',
      ]);
    } else {
      expect(log).toEqual(['layout mount', 'effect mount']);
    }
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
        <Suspense fallback="Loading...">
          <Child />
          <Component />
          <Component />
          <Component />
          <Component shouldMismatch={true} />
        </Suspense>
      );
    }
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('section');
    container.innerHTML = finalHTML;
    assertLog(['Hello', 'Component', 'Component', 'Component', 'Component']);

    expect(container.innerHTML).toBe(
      '<!--$-->Hello<div>Component</div><div>Component</div><div>Component</div><div>Component</div><!--/$-->',
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
      '<!--$-->Hello<div>Component</div><div>Component</div><div>Component</div><div>Component</div><!--/$-->',
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

  /** 测试场景：验证「does not show a fallback if mismatch is after suspending」描述的渲染、交互或错误处理结果。 */
  it('does not show a fallback if mismatch is after suspending', async () => {
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
          <Child />
          <Component shouldMismatch={true} />
        </Suspense>
      );
    }
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('section');
    container.innerHTML = finalHTML;
    assertLog(['Hello', 'Component']);

    expect(container.innerHTML).toBe(
      '<!--$-->Hello<div>Component</div><!--/$-->',
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
      '<!--$-->Hello<div>Component</div><!--/$-->',
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

  /** 测试场景：验证「does not show a fallback if mismatch is child of suspended component」描述的渲染、交互或错误处理结果。 */
  it('does not show a fallback if mismatch is child of suspended component', async () => {
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
    /** `Fallback`：封装当前用例复用的操作、回调或断言步骤。 */
    function Fallback() {
      Scheduler.log('Fallback');
      return 'Loading...';
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Suspense fallback={<Fallback />}>
          <Child>
            <Component shouldMismatch={true} />
          </Child>
        </Suspense>
      );
    }
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('section');
    container.innerHTML = finalHTML;
    assertLog(['Hello', 'Component']);

    expect(container.innerHTML).toBe(
      '<!--$--><div><div>Component</div></div><!--/$-->',
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
      '<!--$--><div><div>Component</div></div><!--/$-->',
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

  /** 测试场景：验证「does not show a fallback if mismatch is parent and first child suspends」描述的渲染、交互或错误处理结果。 */
  it('does not show a fallback if mismatch is parent and first child suspends', async () => {
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
    /** `Fallback`：封装当前用例复用的操作、回调或断言步骤。 */
    function Fallback() {
      Scheduler.log('Fallback');
      return 'Loading...';
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Suspense fallback={<Fallback />}>
          <Component shouldMismatch={true}>
            <Child />
          </Component>
        </Suspense>
      );
    }
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('section');
    container.innerHTML = finalHTML;
    assertLog(['Component', 'Hello']);

    expect(container.innerHTML).toBe(
      '<!--$--><div><div></div><div>Component</div></div><!--/$-->',
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
      '<!--$--><div><div></div><div>Component</div></div><!--/$-->',
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

  /** 测试场景：验证「does show a fallback if mismatch is parent and second child suspends」描述的渲染、交互或错误处理结果。 */
  it('does show a fallback if mismatch is parent and second child suspends', async () => {
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
          <Component shouldMismatch={true}>
            <Child />
          </Component>
        </Suspense>
      );
    }
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('section');
    container.innerHTML = finalHTML;
    assertLog(['Component', 'Hello']);

    expect(container.innerHTML).toBe(
      '<!--$--><div><div>Component</div><div></div></div><!--/$-->',
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
    await waitForAll([
      'Component',
      'Component',
      'Suspend',
      'Fallback',
      "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
    ]);
    jest.runAllTimers();

    // !! 客户端切换到 Suspense 后备内容。
    expect(container.innerHTML).toBe('Loading...');

    suspend = false;
    resolve();
    await promise;
    await waitForAll(['Component', 'Hello']);
    jest.runAllTimers();

    // 客户端完成渲染，Suspense 注释节点已移除。
    expect(container.innerHTML).toBe(
      '<div><article>Mismatch</article><div></div></div>',
    );
  });

  /** 测试场景：验证「does show a fallback if mismatch is in parent element only」描述的渲染、交互或错误处理结果。 */
  it('does show a fallback if mismatch is in parent element only', async () => {
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
          <Component shouldMismatch={true}>
            <Child />
          </Component>
        </Suspense>
      );
    }
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('section');
    container.innerHTML = finalHTML;
    assertLog(['Component', 'Hello']);

    expect(container.innerHTML).toBe('<!--$--><div><div></div></div><!--/$-->');

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
    await waitForAll([
      'Component',
      'Component',
      'Suspend',
      'Fallback',
      "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
    ]);
    jest.runAllTimers();

    // !! 客户端切换到 Suspense 后备内容。
    expect(container.innerHTML).toBe('Loading...');

    suspend = false;
    resolve();
    await promise;
    await waitForAll(['Component', 'Hello']);
    jest.runAllTimers();

    // 客户端完成渲染，Suspense 注释节点已移除。
    expect(container.innerHTML).toBe('<article><div></div></article>');
  });

  /** 测试场景：验证「does show a fallback if mismatch is before suspending」描述的渲染、交互或错误处理结果。 */
  it('does show a fallback if mismatch is before suspending', async () => {
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
          <Component shouldMismatch={true} />
          <Child />
        </Suspense>
      );
    }
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('section');
    container.innerHTML = finalHTML;
    assertLog(['Component', 'Hello']);

    expect(container.innerHTML).toBe(
      '<!--$--><div>Component</div>Hello<!--/$-->',
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
    await waitForAll([
      'Component',
      'Component',
      'Suspend',
      'Fallback',
      "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
    ]);
    jest.runAllTimers();

    // !! 客户端切换到 Suspense 后备内容。
    expect(container.innerHTML).toBe('Loading...');

    suspend = false;
    resolve();
    await promise;
    await waitForAll([
      // 第一遍，末尾的不匹配
      'Component',
      'Hello',
    ]);
    jest.runAllTimers();

    // 客户端完成渲染，Suspense 注释节点已移除。
    expect(container.innerHTML).toBe('<article>Mismatch</article>Hello');
  });

  /** 测试场景：验证「does show a fallback if mismatch is before suspending in a child」描述的渲染、交互或错误处理结果。 */
  it('does show a fallback if mismatch is before suspending in a child', async () => {
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
          <Component shouldMismatch={true} />
          <div>
            <Child />
          </div>
        </Suspense>
      );
    }
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('section');
    container.innerHTML = finalHTML;
    assertLog(['Component', 'Hello']);

    expect(container.innerHTML).toBe(
      '<!--$--><div>Component</div><div>Hello</div><!--/$-->',
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
    await waitForAll([
      'Component',
      'Component',
      'Suspend',
      'Fallback',
      "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
    ]);
    jest.runAllTimers();

    // !! 客户端切换到 Suspense 后备内容。
    expect(container.innerHTML).toBe('Loading...');

    suspend = false;
    resolve();
    await promise;
    await waitForAll([
      // 第一遍，末尾的不匹配
      'Component',
      'Hello',
    ]);
    jest.runAllTimers();

    // 客户端完成渲染，Suspense 注释节点已移除。
    expect(container.innerHTML).toBe(
      '<article>Mismatch</article><div>Hello</div>',
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
    function Child2() {
      if (suspend2) {
        throw promise2;
      } else {
        return 'World';
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({value}) {
      return (
        <div>
          <Suspense fallback="Loading...">
            <Child />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child2 value={value} />
          </Suspense>
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

    // 执行更新应迫使 React 删除该边界。
    await act(() => {
      root.render(<App value={true} />);
    });

    expect(hydrated.length).toBe(1);
    expect(deleted.length).toBe(1);
  });

  /** 测试场景：验证「hydrates an empty suspense boundary」描述的渲染、交互或错误处理结果。 */
  it('hydrates an empty suspense boundary', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div>
          <Suspense fallback="Loading..." />
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
          <Suspense fallback="Loading...">
            <span ref={ref}>A</span>
            {hasB ? <span>B</span> : null}
            <CheckIfHydrating />
          </Suspense>
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
          <Suspense fallback="Loading...">
            <Suspender />
            <span ref={ref}>A</span>
            {hasB ? <span>B</span> : null}
          </Suspense>
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
          <Suspense fallback="Loading...">
            <div>
              <span ref={ref}>A</span>
              {hasB ? <span>B</span> : null}
            </div>
          </Suspense>
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
          <Suspense fallback="Loading...">
            <Child />
          </Suspense>
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
          <Suspense fallback="Loading...">
            <span>
              <Child />
            </span>
          </Suspense>
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
            <Suspense fallback="Loading...">
              <Child />
            </Suspense>
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
          <Suspense fallback="Loading...">
            <span ref={ref} className={className}>
              <Child text={text} />
            </span>
          </Suspense>
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
          <Suspense fallback="Loading...">
            <span ref={ref} className={className}>
              <Child text={text} />
            </span>
          </Suspense>
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

  /** 测试场景：验证「shows the fallback if props have changed before hydration completes and is still suspended」描述的渲染、交互或错误处理结果。 */
  it('shows the fallback if props have changed before hydration completes and is still suspended', async () => {
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
          <Suspense fallback="Loading...">
            <span ref={ref} className={className}>
              <Child text={text} />
            </span>
          </Suspense>
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

    // 渲染更新，但保持其仍处于挂起状态。
    await act(() => {
      root.render(<App text="Hi" className="hi" />);
    });

    // 立即冲刷应删除现有内容并显示后备内容。

    expect(container.getElementsByTagName('span').length).toBe(0);
    expect(ref.current).toBe(null);
    expect(container.textContent).toBe('Loading...');

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

  /** 测试场景：验证「treats missing fallback the same as if it was defined」描述的渲染、交互或错误处理结果。 */
  it('treats missing fallback the same as if it was defined', async () => {
    // 此测试与上一个完全相同，只是嵌套的 Suspense 没有后备内容；这应该是空操作。
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
          <Suspense fallback="Loading...">
            <span ref={ref} className={className}>
              <Suspense>
                <Child text={text} />
              </Suspense>
            </span>
          </Suspense>
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

    const span = container.getElementsByTagName('span')[0];
    expect(ref.current).toBe(span);

    // 渲染一次仍会保持挂起的更新；立即冲刷应删除现有内容并显示后备内容。
    await act(() => {
      root.render(<App text="Hi" className="hi" />);
    });

    expect(container.getElementsByTagName('span').length).toBe(1);
    expect(ref.current).toBe(span);
    expect(container.textContent).toBe('');

    // 解除挂起后显示内容。
    await act(async () => {
      suspend = false;
      resolve();
      await promise;
    });

    expect(span.textContent).toBe('Hi');
    expect(span.className).toBe('hi');
    expect(ref.current).toBe(span);
    expect(container.textContent).toBe('Hi');
  });

  /** 测试场景：验证「clears nested suspense boundaries if they did not hydrate yet」描述的渲染、交互或错误处理结果。 */
  it('clears nested suspense boundaries if they did not hydrate yet', async () => {
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
          <Suspense fallback="Loading...">
            <Suspense fallback="Never happens">
              <Child text={text} />
            </Suspense>{' '}
            <span ref={ref} className={className}>
              <Child text={text} />
            </span>
          </Suspense>
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

    // 渲染一次仍会保持挂起的更新；立即冲刷应删除现有内容并显示后备内容。
    await act(() => {
      root.render(<App text="Hi" className="hi" />);
    });

    expect(container.getElementsByTagName('span').length).toBe(0);
    expect(ref.current).toBe(null);
    expect(container.textContent).toBe('Loading...');

    // 解除挂起后显示内容。
    await act(async () => {
      suspend = false;
      resolve();
      await promise;
    });

    await waitForAll([]);

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
          <Suspense fallback="Loading...">
            <span ref={ref} className={className}>
              <Child text={text} />
            </span>
          </Suspense>
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
          <Suspense fallback="Loading...">
            <Child />
            <Sibling />
          </Suspense>
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

      // 水合进行到一半时更新状态，这会在 Suspense 边界的子节点上调度更新。
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
          <Suspense fallback="Loading...">
            <Child />
          </Suspense>
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

  /** 测试场景：验证「shows the fallback if context has changed before hydration completes and is still suspended」描述的渲染、交互或错误处理结果。 */
  it('shows the fallback if context has changed before hydration completes and is still suspended', async () => {
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
          <Suspense fallback="Loading...">
            <Child />
          </Suspense>
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

    expect(container.getElementsByTagName('span').length).toBe(0);
    expect(ref.current).toBe(null);
    expect(container.textContent).toBe('Loading...');

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

  /** 测试场景：验证「replaces the fallback with client content if it is not rendered by the server」描述的渲染、交互或错误处理结果。 */
  it('replaces the fallback with client content if it is not rendered by the server', async () => {
    let suspend = false;
    const promise = new Promise(resolvePromise => {});
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
          <Suspense fallback="Loading...">
            <span ref={ref}>
              <Child />
            </span>
          </Suspense>
        </div>
      );
    }

    // 首先渲染最终 HTML。流式渲染器可能在服务端产生 Suspense 挂起点，但这里要测试完整 HTML，因此服务端不要挂起。
    suspend = true;
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    expect(container.getElementsByTagName('span').length).toBe(0);

    // 在客户端，由于某种原因，我们有数据可用。
    suspend = false;
    ReactDOMClient.hydrateRoot(container, <App />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    if (__DEV__) {
      await waitForAll([
        'onRecoverableError: Switched to client rendering because the server rendering aborted due to:\n\n' +
          'The server used' +
          ' "renderToString" which does not support Suspense.',
      ]);
    } else {
      await waitForAll([
        'onRecoverableError: The server could not finish this Suspense boundary, likely due to ' +
          'an error during server rendering.',
      ]);
    }
    jest.runAllTimers();

    expect(container.textContent).toBe('Hello');

    const span = container.getElementsByTagName('span')[0];
    expect(ref.current).toBe(span);
  });

  /** 测试场景：验证「replaces the fallback within the suspended time if there is a nested suspense」描述的渲染、交互或错误处理结果。 */
  it('replaces the fallback within the suspended time if there is a nested suspense', async () => {
    let suspend = false;
    const promise = new Promise(resolvePromise => {});
    const ref = React.createRef();

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    /** `InnerChild`：封装当前用例复用的操作、回调或断言步骤。 */
    function InnerChild() {
      // 始终无限期挂起
      throw promise;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div>
          <Suspense fallback="Loading...">
            <span ref={ref}>
              <Child />
            </span>
            <Suspense fallback={null}>
              <InnerChild />
            </Suspense>
          </Suspense>
        </div>
      );
    }

    // 首先渲染最终 HTML。流式渲染器可能在服务端产生 Suspense 挂起点，但这里要测试完整 HTML，因此服务端不要挂起。
    suspend = true;
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    expect(container.getElementsByTagName('span').length).toBe(0);

    // 在客户端，由于某种原因，我们有数据可用。
    suspend = false;
    ReactDOMClient.hydrateRoot(container, <App />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    if (__DEV__) {
      await waitForAll([
        'onRecoverableError: Switched to client rendering because the server rendering aborted due to:\n\n' +
          'The server used' +
          ' "renderToString" which does not support Suspense.',
      ]);
    } else {
      await waitForAll([
        'onRecoverableError: The server could not finish this Suspense boundary, likely due to ' +
          'an error during server rendering.',
      ]);
    }
    // 已超过挂起超时时间，因此应触发超时。
    jest.advanceTimersByTime(500);
    // 中间内容对应的边界应不再挂起，即使内层边界仍处于挂起状态。

    expect(container.textContent).toBe('Hello');

    const span = container.getElementsByTagName('span')[0];
    expect(ref.current).toBe(span);
  });

  /** 测试场景：验证「replaces the fallback within the suspended time if there is a nested suspense in a nested suspense」描述的渲染、交互或错误处理结果。 */
  it('replaces the fallback within the suspended time if there is a nested suspense in a nested suspense', async () => {
    let suspend = false;
    const promise = new Promise(resolvePromise => {});
    const ref = React.createRef();

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    /** `InnerChild`：封装当前用例复用的操作、回调或断言步骤。 */
    function InnerChild() {
      // 始终无限期挂起
      throw promise;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div>
          <Suspense fallback="Another layer">
            <Suspense fallback="Loading...">
              <span ref={ref}>
                <Child />
              </span>
              <Suspense fallback={null}>
                <InnerChild />
              </Suspense>
            </Suspense>
          </Suspense>
        </div>
      );
    }

    // 首先渲染最终 HTML。流式渲染器可能在服务端产生 Suspense 挂起点，但这里要测试完整 HTML，因此服务端不要挂起。
    suspend = true;
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    expect(container.getElementsByTagName('span').length).toBe(0);

    // 在客户端，由于某种原因，我们有数据可用。
    suspend = false;
    ReactDOMClient.hydrateRoot(container, <App />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    if (__DEV__) {
      await waitForAll([
        'onRecoverableError: Switched to client rendering because the server rendering aborted due to:\n\n' +
          'The server used' +
          ' "renderToString" which does not support Suspense.',
      ]);
    } else {
      await waitForAll([
        'onRecoverableError: The server could not finish this Suspense boundary, likely due to ' +
          'an error during server rendering.',
      ]);
    }
    // 已超过挂起超时时间，因此应触发超时。
    jest.advanceTimersByTime(500);
    // 中间内容对应的边界应不再挂起，即使内层边界仍处于挂起状态。

    expect(container.textContent).toBe('Hello');

    const span = container.getElementsByTagName('span')[0];
    expect(ref.current).toBe(span);
  });

  // @gate enableSuspenseList
  /** 测试场景：验证「shows inserted items in a SuspenseList before content is hydrated」描述的渲染、交互或错误处理结果。 */
  it('shows inserted items in a SuspenseList before content is hydrated', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({children}) {
      if (suspend) {
        throw promise;
      } else {
        return children;
      }
    }

    // 这些被提升以避免它们重新渲染。
    const a = (
      <Suspense fallback="Loading A">
        <Child>
          <span>A</span>
        </Child>
      </Suspense>
    );
    const b = (
      <Suspense fallback="Loading B">
        <Child>
          <span ref={ref}>B</span>
        </Child>
      </Suspense>
    );

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({showMore}) {
      return (
        <SuspenseList revealOrder="forwards" tail="visible">
          {a}
          {b}
          {showMore ? (
            <Suspense fallback="Loading C">
              <span>C</span>
            </Suspense>
          ) : null}
        </SuspenseList>
      );
    }

    suspend = false;
    const html = ReactDOMServer.renderToString(<App showMore={false} />);

    const container = document.createElement('div');
    container.innerHTML = html;

    const spanB = container.getElementsByTagName('span')[1];

    suspend = true;
    const root = await act(() =>
      ReactDOMClient.hydrateRoot(container, <App showMore={false} />),
    );

    // 此时尚未水合。
    expect(ref.current).toBe(null);
    expect(container.textContent).toBe('AB');

    // 在前两行完成水合前添加更多行。
    await act(() => {
      root.render(<App showMore={true} />);
    });

    // 此时尚未水合。
    expect(ref.current).toBe(null);

    // 前两行已显示最终内容，因此应能显示真实内容。
    expect(container.textContent).toBe('ABC');

    suspend = false;
    await act(async () => {
      await resolve();
    });

    expect(container.textContent).toBe('ABC');
    // 水合后仍是同一个 span。
    expect(ref.current).toBe(spanB);
  });

  // @gate enableSuspenseList
  /** 测试场景：验证「shows is able to hydrate boundaries even if others in a list are pending」描述的渲染、交互或错误处理结果。 */
  it('shows is able to hydrate boundaries even if others in a list are pending', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({children}) {
      if (suspend) {
        throw promise;
      } else {
        return children;
      }
    }

    const promise2 = new Promise(() => {});
    /** `AlwaysSuspend`：封装当前用例复用的操作、回调或断言步骤。 */
    function AlwaysSuspend() {
      throw promise2;
    }

    // 这被提升以避免它们重新渲染。
    const a = (
      <Suspense fallback="Loading A">
        <Child>
          <span ref={ref}>A</span>
        </Child>
      </Suspense>
    );

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({showMore}) {
      return (
        <SuspenseList revealOrder="together">
          {a}
          {showMore ? (
            <Suspense fallback="Loading B">
              <AlwaysSuspend />
            </Suspense>
          ) : null}
        </SuspenseList>
      );
    }

    suspend = false;
    const html = ReactDOMServer.renderToString(<App showMore={false} />);

    const container = document.createElement('div');
    container.innerHTML = html;

    const spanA = container.getElementsByTagName('span')[0];

    suspend = true;
    const root = await act(() =>
      ReactDOMClient.hydrateRoot(container, <App showMore={false} />),
    );

    // 此时尚未水合。
    expect(ref.current).toBe(null);
    expect(container.textContent).toBe('A');

    await act(async () => {
      // 在第一行完成水合前再添加一行。
      root.render(<App showMore={true} />);
      // 同时兑现阻塞渲染的 Promise。
      suspend = false;
      await resolve();
    });

    // 第一行应能完成水合。
    expect(ref.current).toBe(spanA);
    // 即使 B 仍被刻意延缓。
    expect(container.textContent).toBe('ALoading B');
  });

  // @gate enableSuspenseList
  /** 测试场景：验证「clears server boundaries when SuspenseList runs out of time hydrating」描述的渲染、交互或错误处理结果。 */
  it('clears server boundaries when SuspenseList runs out of time hydrating', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    const ref = React.createRef();

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({children}) {
      if (suspend) {
        throw promise;
      } else {
        return children;
      }
    }

    /** `Before`：封装当前用例复用的操作、回调或断言步骤。 */
    function Before() {
      Scheduler.log('Before');
      return null;
    }

    /** `After`：封装当前用例复用的操作、回调或断言步骤。 */
    function After() {
      Scheduler.log('After');
      return null;
    }

    /** `FirstRow`：封装当前用例复用的操作、回调或断言步骤。 */
    function FirstRow() {
      return (
        <>
          <Before />
          <Suspense fallback="Loading A">
            <span>A</span>
          </Suspense>
          <After />
        </>
      );
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Suspense fallback={null}>
          <SuspenseList revealOrder="forwards" tail="hidden">
            <FirstRow />
            <Suspense fallback="Loading B">
              <Child>
                <span ref={ref}>B</span>
              </Child>
            </Suspense>
          </SuspenseList>
        </Suspense>
      );
    }

    suspend = false;
    const html = ReactDOMServer.renderToString(<App />);
    assertLog(['Before', 'After']);

    const container = document.createElement('div');
    container.innerHTML = html;

    const b = container.getElementsByTagName('span')[1];
    expect(b.textContent).toBe('B');

    const root = ReactDOMClient.hydrateRoot(container, <App />);

    // 将水合优先级提高到高于 offscreen。
    root.unstable_scheduleHydration(b);

    suspend = true;

    await act(async () => {
      await waitFor(['Before', 'After']);

      // 这会让 React 完全跳过第二行。
    });

    // 第二个子节点尚未水合，但占位符仍在列表中。
    expect(ref.current).toBe(null);
    expect(container.textContent).toBe('AB');

    suspend = false;
    await act(async () => {
      // 让边界进入最终的已解析状态。
      await resolve();
    });

    expect(container.textContent).toBe('AB');
    expect(ref.current).toBe(b);
  });

  // @gate enableSuspenseList
  /** 测试场景：验证「clears server boundaries when SuspenseList suspends last row hydrating」描述的渲染、交互或错误处理结果。 */
  it('clears server boundaries when SuspenseList suspends last row hydrating', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({children}) {
      if (suspend) {
        throw promise;
      } else {
        return children;
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Suspense fallback={null}>
          <SuspenseList revealOrder="forwards" tail="hidden">
            <Suspense fallback="Loading A">
              <span>A</span>
            </Suspense>
            <Suspense fallback="Loading B">
              <Child>
                <span>B</span>
              </Child>
            </Suspense>
          </SuspenseList>
        </Suspense>
      );
    }

    suspend = true;
    const html = ReactDOMServer.renderToString(<App />);

    const container = document.createElement('div');
    container.innerHTML = html;

    ReactDOMClient.hydrateRoot(container, <App />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });

    suspend = true;
    if (__DEV__) {
      await waitForAll([
        'onRecoverableError: Switched to client rendering because the server rendering aborted due to:\n\n' +
          'The server used' +
          ' "renderToString" which does not support Suspense.',
      ]);
    } else {
      await waitForAll([
        'onRecoverableError: The server could not finish this Suspense boundary, likely due to ' +
          'an error during server rendering.',
      ]);
    }

    // 第二个子节点尚未水合，但占位符仍在列表中。
    expect(container.textContent).toBe('ALoading B');

    suspend = false;
    await act(async () => {
      // 让边界进入最终的已解析状态。
      await resolve();
    });

    expect(container.textContent).toBe('AB');
  });

  /** 测试场景：验证「can client render nested boundaries」描述的渲染、交互或错误处理结果。 */
  it('can client render nested boundaries', async () => {
    let suspend = false;
    const promise = new Promise(() => {});
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
          <Suspense
            fallback={
              <>
                <Suspense fallback="Loading...">
                  <Child />
                </Suspense>
                <span>Inner Sibling</span>
              </>
            }>
            <Child />
          </Suspense>
          <span ref={ref}>Sibling</span>
        </div>
      );
    }

    suspend = true;
    const html = ReactDOMServer.renderToString(<App />);

    const container = document.createElement('div');
    container.innerHTML = html + '<!--unrelated comment-->';

    const span = container.getElementsByTagName('span')[1];

    suspend = false;
    ReactDOMClient.hydrateRoot(container, <App />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    if (__DEV__) {
      await waitForAll([
        'onRecoverableError: Switched to client rendering because the server rendering aborted due to:\n\n' +
          'The server used' +
          ' "renderToString" which does not support Suspense.',
      ]);
    } else {
      await waitForAll([
        'onRecoverableError: The server could not finish this Suspense boundary, likely due to ' +
          'an error during server rendering.',
      ]);
    }
    jest.runAllTimers();

    expect(ref.current).toBe(span);
    expect(span.parentNode).not.toBe(null);

    // 非 React 创建的注释节点不受影响。
    expect(container.lastChild.nodeType).toBe(8);
    expect(container.lastChild.data).toBe('unrelated comment');
  });

  /** 测试场景：验证「can hydrate TWO suspense boundaries」描述的渲染、交互或错误处理结果。 */
  it('can hydrate TWO suspense boundaries', async () => {
    const ref1 = React.createRef();
    const ref2 = React.createRef();

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div>
          <Suspense fallback="Loading 1...">
            <span ref={ref1}>1</span>
          </Suspense>
          <Suspense fallback="Loading 2...">
            <span ref={ref2}>2</span>
          </Suspense>
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
          <Suspense fallback="Loading...">
            <Child text={text} />
          </Suspense>
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
          <Suspense fallback="Loading...">
            <Button />
            <Sibling />
          </Suspense>
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
          <Suspense fallback="Loading...">
            <Button />
            <Sibling />
          </Suspense>
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

  /** 测试场景：验证「invokes discrete events on nested suspense boundaries in a root (legacy system)」描述的渲染、交互或错误处理结果。 */
  it('invokes discrete events on nested suspense boundaries in a root (legacy system)', async () => {
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
          <Suspense fallback="Loading...">
            <Button />
          </Suspense>
        );
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Suspense fallback="Loading...">
          <Child />
        </Suspense>
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
  /** 测试场景：验证「invokes discrete events on nested suspense boundaries in a root (createEventHandle)」描述的渲染、交互或错误处理结果。 */
  it('invokes discrete events on nested suspense boundaries in a root (createEventHandle)', async () => {
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
          <Suspense fallback="Loading...">
            <Button />
          </Suspense>
        );
      }
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Suspense fallback="Loading...">
          <Child />
        </Suspense>
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
          <Suspense fallback="Loading...">
            <Child />
          </Suspense>
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
        <Suspense fallback="Loading...">
          <Child />
        </Suspense>
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
          <Suspense fallback="Loading First...">
            <span
              onMouseEnter={() => ops.push('Mouse Enter First')}
              onMouseLeave={() => ops.push('Mouse Leave First')}
            />
            {/* 我们随后挂起，用于测试预先挂载监听器时会发生什么。 */}
            <First />
          </Suspense>
          <Suspense fallback="Loading Second...">
            <span
              onMouseEnter={() => ops.push('Mouse Enter Second')}
              onMouseLeave={() => ops.push('Mouse Leave Second')}>
              <Second />
            </span>
          </Suspense>
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
      <Suspense fallback="Loading...">
        <span ref={ref}>
          <Child />
        </span>
      </Suspense>
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
          <Suspense fallback="Loading...">
            <Form />
            <Sibling />
          </Suspense>
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

  // 两个 fork 中该测试都会失败：没有边界时，延迟树不会重新进入水合模式。实际使用中总有父级
  // Suspense 边界，所以通常不会遇到，但它仍是缺陷，留待后续修复。
  //
  // @gate FIXME
  /** 测试场景：验证「hydrates a hidden subtree outside of a Suspense boundary」描述的渲染、交互或错误处理结果。 */
  it('hydrates a hidden subtree outside of a Suspense boundary', async () => {
    const ref = React.createRef();

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <LegacyHiddenDiv mode="hidden">
          <span ref={ref}>Hidden child</span>
        </LegacyHiddenDiv>
      );
    }

    const finalHTML = ReactDOMServer.renderToString(<App />);

    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    const span = container.getElementsByTagName('span')[0];
    expect(span.innerHTML).toBe('Hidden child');

    await act(() =>
      ReactDOMClient.hydrateRoot(container, <App />, {
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          Scheduler.log('onRecoverableError: ' + error.message);
        },
      }),
    );

    expect(ref.current).toBe(span);
    expect(span.innerHTML).toBe('Hidden child');
  });

  // @gate www
  /** 测试场景：验证「renders a hidden LegacyHidden component inside a Suspense boundary」描述的渲染、交互或错误处理结果。 */
  it('renders a hidden LegacyHidden component inside a Suspense boundary', async () => {
    const ref = React.createRef();

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Suspense fallback="Loading...">
          <LegacyHiddenDiv mode="hidden">
            <span ref={ref}>Hidden child</span>
          </LegacyHiddenDiv>
        </Suspense>
      );
    }

    const finalHTML = ReactDOMServer.renderToString(<App />);

    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    const span = container.getElementsByTagName('span')[0];
    expect(span.innerHTML).toBe('Hidden child');

    await act(() => ReactDOMClient.hydrateRoot(container, <App />));
    expect(ref.current).toBe(span);
    expect(span.innerHTML).toBe('Hidden child');
  });

  // @gate www
  /** 测试场景：验证「renders a visible LegacyHidden component」描述的渲染、交互或错误处理结果。 */
  it('renders a visible LegacyHidden component', async () => {
    const ref = React.createRef();

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <LegacyHiddenDiv mode="visible">
          <span ref={ref}>Hidden child</span>
        </LegacyHiddenDiv>
      );
    }

    const finalHTML = ReactDOMServer.renderToString(<App />);

    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    const span = container.getElementsByTagName('span')[0];

    await act(() => ReactDOMClient.hydrateRoot(container, <App />));
    expect(ref.current).toBe(span);
    expect(ref.current.innerHTML).toBe('Hidden child');
  });

  /** 测试场景：验证「a visible Activity component is surrounded by comment markers」描述的渲染、交互或错误处理结果。 */
  it('a visible Activity component is surrounded by comment markers', async () => {
    const ref = React.createRef();

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Activity mode="visible">
          <span ref={ref}>Child</span>
        </Activity>
      );
    }

    const finalHTML = ReactDOMServer.renderToString(<App />);
    assertLog([]);

    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    // 可见的 Activity 边界与 Fragment 行为完全相同，只提供一层间接引用。
    expect(container).toMatchInlineSnapshot(`
      <div>
        <!--&-->
        <span>
          Child
        </span>
        <!--/&-->
      </div>
    `);

    const span = container.getElementsByTagName('span')[0];

    // 整棵树成功完成水合。
    ReactDOMClient.hydrateRoot(container, <App />);
    await waitForAll([]);
    expect(ref.current).toBe(span);
  });

  /** 测试场景：验证「a hidden Activity component is skipped over during server rendering」描述的渲染、交互或错误处理结果。 */
  it('a hidden Activity component is skipped over during server rendering', async () => {
    const visibleRef = React.createRef();

    /** `HiddenChild`：封装当前用例复用的操作、回调或断言步骤。 */
    function HiddenChild() {
      Scheduler.log('HiddenChild');
      return <span>Hidden</span>;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      Scheduler.log('App');
      return (
        <>
          <span ref={visibleRef}>Visible</span>
          <Activity mode="hidden">
            <HiddenChild />
          </Activity>
          <Suspense fallback={null}>
            <Activity mode="hidden">
              <HiddenChild />
            </Activity>
          </Suspense>
        </>
      );
    }

    // 服务端渲染期间不应渲染 Child 组件，因为它位于隐藏树中。
    const finalHTML = ReactDOMServer.renderToString(<App />);
    assertLog(['App']);

    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    // 隐藏的子节点不属于服务端渲染的 HTML。
    expect(container).toMatchInlineSnapshot(`
      <div>
        <span>
          Visible
        </span>
        <!--$-->
        <!--/$-->
      </div>
    `);

    const visibleSpan = container.getElementsByTagName('span')[0];

    // 可见的 span 成功完成水合。
    ReactDOMClient.hydrateRoot(container, <App />);
    await waitForPaint(['App']);
    expect(visibleRef.current).toBe(visibleSpan);

    if (gate(flags => flags.enableYieldingBeforePassive)) {
      // 被动 effect。
      await waitForPaint([]);
    }

    // 随后在客户端预渲染隐藏子节点，同时水合 Activity 外部的 Suspense 边界。
    await waitForPaint(['HiddenChild']);
    expect(container).toMatchInlineSnapshot(`
      <div>
        <span>
          Visible
        </span>
        <!--$-->
        <!--/$-->
        <span
          style="display: none;"
        >
          Hidden
        </span>
      </div>
    `);

    // 接着水合 Activity 内的子节点。
    await waitForPaint(['HiddenChild']);

    expect(container).toMatchInlineSnapshot(`
      <div>
        <span>
          Visible
        </span>
        <!--$-->
        <!--/$-->
        <span
          style="display: none;"
        >
          Hidden
        </span>
        <span
          style="display: none;"
        >
          Hidden
        </span>
      </div>
    `);
  });

  /** `itHydratesWithoutMismatch`：封装当前用例复用的操作、回调或断言步骤。 */
  function itHydratesWithoutMismatch(msg, App) {
    /** 测试场景：验证「当前参数化场景」描述的渲染、交互或错误处理结果。 */
    it('hydrates without mismatch ' + msg, async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const finalHTML = ReactDOMServer.renderToString(<App />);
      container.innerHTML = finalHTML;

      await act(() => ReactDOMClient.hydrateRoot(container, <App />));
    });
  }

  itHydratesWithoutMismatch('an empty string with neighbors', function App() {
    return (
      <div>
        <div id="test">Test</div>
        {'' && <div>Test</div>}
        {'Test'}
      </div>
    );
  });

  itHydratesWithoutMismatch('an empty string', function App() {
    return '';
  });
  itHydratesWithoutMismatch(
    'an empty string simple in fragment',
    function App() {
      return (
        <>
          {''}
          {'sup'}
        </>
      );
    },
  );
  itHydratesWithoutMismatch(
    'an empty string simple in suspense',
    function App() {
      return <Suspense>{'' && false}</Suspense>;
    },
  );

  itHydratesWithoutMismatch('an empty string in class component', TestAppClass);

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
          <Suspense fallback={<div>Loading</div>}>
            <ChildThatSuspends id={1} isClient={isClient} />
          </Suspense>
          {isClient ? <span>client</span> : <div>server</div>}
          <Suspense fallback={<div>Loading</div>}>
            <ChildThatSuspends id={2} isClient={isClient} />
          </Suspense>
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
    assertLog([
      "onRecoverableError: Hydration failed because the server rendered HTML didn't match the client.",
    ]);

    // 根节点发生不匹配时显示后备界面。
    expect(container.innerHTML).toEqual(
      '<div>Loading</div><span>client</span><div>Loading</div>',
    );

    await act(async () => {
      resolve();
      await promise;
    });

    expect(container.innerHTML).toEqual(
      '<div>1</div><span>client</span><div>2</div>',
    );
  });

  /** 测试场景：验证「falls back to client rendering when there's a text mismatch (direct text child)」描述的渲染、交互或错误处理结果。 */
  it("falls back to client rendering when there's a text mismatch (direct text child)", async () => {
    /** `DirectTextChild`：封装当前用例复用的操作、回调或断言步骤。 */
    function DirectTextChild({text}) {
      return <div>{text}</div>;
    }
    const container = document.createElement('div');
    container.innerHTML = ReactDOMServer.renderToString(
      <DirectTextChild text="good" />,
    );
    await act(() => {
      ReactDOMClient.hydrateRoot(container, <DirectTextChild text="bad" />, {
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
      "onRecoverableError: Hydration failed because the server rendered text didn't match the client.",
    ]);
  });

  /** 测试场景：验证「falls back to client rendering when there's a text mismatch (text child with siblings)」描述的渲染、交互或错误处理结果。 */
  it("falls back to client rendering when there's a text mismatch (text child with siblings)", async () => {
    /** `Sibling`：封装当前用例复用的操作、回调或断言步骤。 */
    function Sibling() {
      return 'Sibling';
    }

    /** `TextChildWithSibling`：封装当前用例复用的操作、回调或断言步骤。 */
    function TextChildWithSibling({text}) {
      return (
        <div>
          <Sibling />
          {text}
        </div>
      );
    }
    const container2 = document.createElement('div');
    container2.innerHTML = ReactDOMServer.renderToString(
      <TextChildWithSibling text="good" />,
    );
    await act(() => {
      ReactDOMClient.hydrateRoot(
        container2,
        <TextChildWithSibling text="bad" />,
        {
          /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
          onRecoverableError(error) {
            Scheduler.log(
              'onRecoverableError: ' + normalizeError(error.message),
            );
            if (error.cause) {
              Scheduler.log('Cause: ' + normalizeError(error.cause.message));
            }
          },
        },
      );
    });
    assertLog([
      "onRecoverableError: Hydration failed because the server rendered text didn't match the client.",
    ]);
  });

  /** 测试场景：验证「hides a dehydrated suspense boundary if the parent resuspends」描述的渲染、交互或错误处理结果。 */
  it('hides a dehydrated suspense boundary if the parent resuspends', async () => {
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

    /** `Sibling`：封装当前用例复用的操作、回调或断言步骤。 */
    function Sibling({resuspend}) {
      if (suspend && resuspend) {
        throw promise;
      } else {
        return null;
      }
    }

    /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
    function Component({text}) {
      return (
        <Suspense>
          <Child text={text} />
          <span ref={ref}>World</span>
        </Suspense>
      );
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({text, resuspend}) {
      const memoized = React.useMemo(() => <Component text={text} />, [text]);
      return (
        <div>
          <Suspense fallback="Loading...">
            {memoized}
            <Sibling resuspend={resuspend} />
          </Suspense>
        </div>
      );
    }

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(<App text="Hello" />);
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    // 客户端尚未取得全部数据，但仍要开始水合。
    suspend = true;
    const root = ReactDOMClient.hydrateRoot(container, <App text="Hello" />, {
      /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll([]);

    expect(ref.current).toBe(null); // 仍处于未水合状态。
    const span = container.getElementsByTagName('span')[0];
    const textNode = span.previousSibling;
    expect(textNode.nodeValue).toBe('Hello');
    expect(span.textContent).toBe('World');

    // 渲染一次使父边界再次挂起的更新；立即冲刷应隐藏文本内容。
    await act(() => {
      root.render(<App text="Hello" resuspend={true} />);
    });

    expect(ref.current).toBe(null);
    expect(span.style.display).toBe('none');
    expect(textNode.nodeValue).toBe('');

    // 解除挂起后显示内容。
    await act(async () => {
      suspend = false;
      resolve();
      await promise;
    });

    expect(textNode.nodeValue).toBe('Hello');
    expect(span.textContent).toBe('World');
    expect(span.style.display).toBe('');
    expect(ref.current).toBe(span);
  });

  // 针对 https://github.com/facebook/react/issues/35210 等问题的回归测试：飞行中创建懒元素会造成水合问题，因为重播路径未正确重置水合游标。
  /** 测试场景：验证「Can hydrate even when lazy content resumes immediately inside a HostComponent」描述的渲染、交互或错误处理结果。 */
  it('Can hydrate even when lazy content resumes immediately inside a HostComponent', async () => {
    let resolve;
    const promise = new Promise(r => {
      resolve = () => r({default: 'value'});
    });

    const lazyContent = React.lazy(() => {
      Scheduler.log('Lazy initializer called');
      return promise;
    });

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return <label>{lazyContent}</label>;
    }

    // 服务器端渲染 HTML
    const container = document.createElement('div');
    container.innerHTML = '<label>value</label>';

    const hydrationErrors = [];

    React.startTransition(() => {
      ReactDOMClient.hydrateRoot(container, <App />, {
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          console.log('[DEBUG] hydration error:', error.message);
          hydrationErrors.push(error.message);
        },
      });
    });

    await waitFor(['Lazy initializer called']);
    resolve();
    await waitForAll([]);

    // 未修复时，水合游标错误并导致不匹配。
    expect(hydrationErrors).toEqual([]);
    expect(container.innerHTML).toEqual('<label>value</label>');
  });

  /** 测试场景：验证「Can hydrate even when lazy content resumes immediately inside a HostSingleton」描述的渲染、交互或错误处理结果。 */
  it('Can hydrate even when lazy content resumes immediately inside a HostSingleton', async () => {
    let resolve;
    const promise = new Promise(r => {
      resolve = () => r({default: <div>value</div>});
    });

    const lazyContent = React.lazy(() => {
      Scheduler.log('Lazy initializer called');
      return promise;
    });

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <html>
          <body>{lazyContent}</body>
        </html>
      );
    }

    // 服务器端渲染 HTML
    document.body.innerHTML = '<div>value</div>';

    const hydrationErrors = [];

    React.startTransition(() => {
      ReactDOMClient.hydrateRoot(document, <App />, {
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          console.log('[DEBUG] hydration error:', error.message);
          hydrationErrors.push(error.message);
        },
      });
    });

    await waitFor(['Lazy initializer called']);
    resolve();
    await waitForAll([]);

    expect(hydrationErrors).toEqual([]);
    expect(document.documentElement.outerHTML).toEqual(
      '<html><head></head><body><div>value</div></body></html>',
    );
  });

  /** 测试场景：验证「Can hydrate even when lazy content resumes immediately inside a Suspense」描述的渲染、交互或错误处理结果。 */
  it('Can hydrate even when lazy content resumes immediately inside a Suspense', async () => {
    let resolve;
    const promise = new Promise(r => {
      resolve = () => r({default: 'value'});
    });

    const lazyContent = React.lazy(() => {
      Scheduler.log('Lazy initializer called');
      return promise;
    });

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return <Suspense>{lazyContent}</Suspense>;
    }

    // 服务器端渲染 HTML
    const container = document.createElement('div');
    container.innerHTML = '<!--$-->value<!--/$-->';

    const hydrationErrors = [];

    let root;
    React.startTransition(() => {
      root = ReactDOMClient.hydrateRoot(container, <App />, {
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          console.log('[DEBUG] hydration error:', error.message);
          hydrationErrors.push(error.message);
        },
      });
    });

    await waitFor(['Lazy initializer called']);
    resolve();
    await waitForAll([]);

    expect(hydrationErrors).toEqual([]);
    expect(container.innerHTML).toEqual('<!--$-->value<!--/$-->');
    root.unmount();
    expect(container.innerHTML).toEqual('<!--$--><!--/$-->');
  });

  /** 测试场景：验证「Can hydrate even when lazy content resumes immediately inside an Activity」描述的渲染、交互或错误处理结果。 */
  it('Can hydrate even when lazy content resumes immediately inside an Activity', async () => {
    let resolve;
    const promise = new Promise(r => {
      resolve = () => r({default: 'value'});
    });

    const lazyContent = React.lazy(() => {
      Scheduler.log('Lazy initializer called');
      return promise;
    });

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return <Activity mode="visible">{lazyContent}</Activity>;
    }

    // 服务器端渲染 HTML
    const container = document.createElement('div');
    container.innerHTML = '<!--&-->value<!--/&-->';

    const hydrationErrors = [];

    let root;
    React.startTransition(() => {
      root = ReactDOMClient.hydrateRoot(container, <App />, {
        /** `onRecoverableError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onRecoverableError(error) {
          console.log('[DEBUG] hydration error:', error.message);
          hydrationErrors.push(error.message);
        },
      });
    });

    await waitFor(['Lazy initializer called']);
    resolve();
    await waitForAll([]);

    expect(hydrationErrors).toEqual([]);
    expect(container.innerHTML).toEqual('<!--&-->value<!--/&-->');
    root.unmount();
    expect(container.innerHTML).toEqual('<!--&--><!--/&-->');
  });

  /** 测试场景：验证「recovers when an update changes a dehydrated boundary inside a suspended parent boundary」描述的渲染、交互或错误处理结果。 */
  it('recovers when an update changes a dehydrated boundary inside a suspended parent boundary', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** `Sibling`：封装当前用例复用的操作、回调或断言步骤。 */
    function Sibling() {
      if (suspend) {
        throw promise;
      }
      return <span id="sibling">Sibling</span>;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({showSiblingOnMount}) {
      const [showSibling, setShowSibling] = React.useState(false);
      React.useEffect(() => {
        if (showSiblingOnMount) {
          // 不是 transition：内层未水合边界在完成水合前以 Default 优先级收到此更新。
          setShowSibling(true);
        }
      }, [showSiblingOnMount]);
      return (
        <div>
          <Suspense fallback={null}>
            {showSibling ? <Sibling /> : null}
            <Suspense fallback={null}>
              <span id="content">{showSibling ? 'b' : 'a'}</span>
            </Suspense>
          </Suspense>
        </div>
      );
    }

    // 在服务器上不要挂起。
    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(
      <App showSiblingOnMount={false} />,
    );
    const container = document.createElement('div');
    container.innerHTML = finalHTML;
    expect(container.textContent).toBe('a');

    // 开始水合。第一个 effect 在外层边界挂载一个会挂起的兄弟节点，使外层边界显示后备内容并隐藏主内容；同时更改仍未水合的内层边界输入。
    suspend = true;
    await act(() => {
      ReactDOMClient.hydrateRoot(container, <App showSiblingOnMount={true} />);
    });

    // 兄弟节点的数据到达。
    suspend = false;
    await act(async () => {
      resolve();
      await promise;
    });

    // 外层边界应同时显示兄弟节点和更新后的内层内容。
    const sibling = container.querySelector('#sibling');
    const content = container.querySelector('#content');
    expect(sibling).not.toBe(null);
    expect(sibling.style.display).not.toBe('none');
    expect(content).not.toBe(null);
    expect(content.style.display).not.toBe('none');
    expect(content.textContent).toBe('b');
  });

  /** 测试场景：验证「recovers when a transition changes a dehydrated boundary inside a suspended parent boundary」描述的渲染、交互或错误处理结果。 */
  it('recovers when a transition changes a dehydrated boundary inside a suspended parent boundary', async () => {
    // 同上测试。 除了更新被包裹在 startTransition 中。
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** `Sibling`：封装当前用例复用的操作、回调或断言步骤。 */
    function Sibling() {
      if (suspend) {
        throw promise;
      }
      return <span id="sibling">Sibling</span>;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({showSiblingOnMount}) {
      const [showSibling, setShowSibling] = React.useState(false);
      React.useEffect(() => {
        if (showSiblingOnMount) {
          React.startTransition(() => {
            setShowSibling(true);
          });
        }
      }, [showSiblingOnMount]);
      return (
        <div>
          <Suspense fallback={null}>
            {showSibling ? <Sibling /> : null}
            <Suspense fallback={null}>
              <span id="content">{showSibling ? 'b' : 'a'}</span>
            </Suspense>
          </Suspense>
        </div>
      );
    }

    suspend = false;
    const finalHTML = ReactDOMServer.renderToString(
      <App showSiblingOnMount={false} />,
    );
    const container = document.createElement('div');
    container.innerHTML = finalHTML;
    expect(container.textContent).toBe('a');

    suspend = true;
    await act(() => {
      ReactDOMClient.hydrateRoot(container, <App showSiblingOnMount={true} />);
    });

    suspend = false;
    await act(async () => {
      resolve();
      await promise;
    });

    const sibling = container.querySelector('#sibling');
    const content = container.querySelector('#content');
    expect(sibling).not.toBe(null);
    expect(sibling.style.display).not.toBe('none');
    expect(content).not.toBe(null);
    expect(content.style.display).not.toBe('none');
    expect(content.textContent).toBe('b');
  });
});
