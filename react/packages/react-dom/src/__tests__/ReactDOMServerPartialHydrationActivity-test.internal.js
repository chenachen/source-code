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

/** 截取错误message首句供稳定日志比较；无句点时保留完整msg，不处理cause，后者由调用处另记。 */
function normalizeError(msg) {
  // 将第一个句子作为基础，以便更容易地进行断言。
  const idx = msg.indexOf('.');
  if (idx > -1) {
    return msg.slice(0, idx + 1);
  }
  return msg;
}

/** 模拟指针从from移到to：先在from派发mouseout，再在to派发mouseover，relatedTarget互指；任一空端点代表进入或离开文档，用于连续事件覆盖与重放。 */
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
  /** 每例重置模块并在导入DOM入口前开启水合回调与event-handle开关；使用同一Scheduler/act实例，避免跨例缓存和事件实现串扰。 */
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

  /** SSR完整Hello Activity后客户端Child挂起，span ref为空；解除promise后ref复用原span，验证Activity子树的阻塞不迫使外层根替换DOM。 */
  it('hydrates a parent even if a child Activity boundary is blocked', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();

    /** 共享suspend为true时抛同promise，完成时返回Hello；用于保留完整SSR而延后客户端span的ref提交。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    /** 外div内Activity包住ref span/Child，隔开已水合根与受阻子树。 */
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

  /** 外Activity的Child先pending，后面另有已完成Activity Hello；服务端HelloHello保持，解除后同文本且无错误日志，覆盖挂起兄弟与边界游标恢复。 */
  it('can hydrate siblings of a suspended component without errors', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    /** 挂起时阻塞外Activity，完成输出Hello；其后的独立内Activity仍有完整服务端内容。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    /** Activity内先异步Child再内Activity/div Hello，制造暂停点后的边界兄弟。 */
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
      /** 记录恢复错误message首句并另记原cause首句；日志区分尚在暂停的尝试与已提交的客户端接管。 */
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

  /** Activity内Child先挂起，末尾第四Component仅客户端div改article；pending时保留原marker/DOM，解除后遍历差异、局部客户端重建并报告recoverable，移除Activity marker。 */
  it('falls back to client rendering boundary on mismatch', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      /** 先清suspend再兑现共享promise，保证重试不会继续抛已兑现的暂停任务；后续日志分辨恢复水合与客户端重建。 */
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });
    /** 记录Suspend并抛promise，否则记录/返回Hello；恢复日志分辨水合尝试与客户端重建。 */
    function Child() {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return 'Hello';
      }
    }
    /** 仅shouldMismatch且client时div改article Mismatch，其它三个实例始终div Component。 */
    function Component({shouldMismatch}) {
      Scheduler.log('Component');
      if (shouldMismatch && client) {
        return <article>Mismatch</article>;
      }
      return <div>Component</div>;
    }
    /** Activity先Child后四个Component，把唯一差异放到末尾且晚于暂停点。 */
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
      /** 记录恢复错误message首句并另记原cause首句；日志区分尚在暂停的尝试与已提交的客户端接管。 */
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

    // 客户端完成渲染，Activity 注释节点已移除。
    expect(container.innerHTML).toBe(
      'Hello<div>Component</div><div>Component</div><div>Component</div><article>Mismatch</article>',
    );
  });

  /** 差异Component紧随挂起Child，暂停期间仍保持服务端Hello/div；解除后先检测差异再客户端重建为Hello/article，验证未遍历的差异不会提前触发恢复。 */
  it('handles if mismatch is after suspending', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      /** 先清suspend再兑现共享promise，保证重试不会继续抛已兑现的暂停任务；后续日志分辨恢复水合与客户端重建。 */
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });
    /** 暂停时记录并抛promise，解阻后记录/返回Hello，控制是否能遍历紧随的差异。 */
    function Child() {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return 'Hello';
      }
    }
    /** 客户端的shouldMismatch实例把div改article，服务端保持div。 */
    function Component({shouldMismatch}) {
      Scheduler.log('Component');
      if (shouldMismatch && client) {
        return <article>Mismatch</article>;
      }
      return <div>Component</div>;
    }
    /** 同Activity里先Child再差异Component，无独立父Suspense fallback。 */
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
      /** 记录恢复错误message首句并另记原cause首句；日志区分尚在暂停的尝试与已提交的客户端接管。 */
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

    // 客户端完成渲染，Activity 注释节点已移除。
    expect(container.innerHTML).toBe('Hello<article>Mismatch</article>');
  });

  /** 差异嵌在挂起Child返回的div内；暂停时保留服务端嵌套DOM，解除后重建为div/article并报告差异，覆盖子树恢复后的游标。 */
  it('handles if mismatch is child of suspended component', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      /** 先清suspend再兑现共享promise，保证重试不会继续抛已兑现的暂停任务；后续日志分辨恢复水合与客户端重建。 */
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });
    /** 暂停时不返回子树；完成后返回包children的div，差异位于恢复后才能进入的内部。 */
    function Child({children}) {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return <div>{children}</div>;
      }
    }
    /** 把受控差异的div Component改为article Mismatch，位于Child返回的div内。 */
    function Component({shouldMismatch}) {
      Scheduler.log('Component');
      if (shouldMismatch && client) {
        return <article>Mismatch</article>;
      }
      return <div>Component</div>;
    }
    /** Activity的Child包住差异Component，检验恢复后深层主机游标。 */
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
      /** 记录恢复错误message首句并另记原cause首句；日志区分尚在暂停的尝试与已提交的客户端接管。 */
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

    // 客户端完成渲染，Activity 注释节点已移除。
    expect(container.innerHTML).toBe('<div><article>Mismatch</article></div>');
  });

  /** 父Component在Child之后放差异节点，第一child挂起使差异尚未被遍历；Component/Suspend日志后保留原DOM，解除后局部重建，区别父函数执行与主机节点差异。 */
  it('handles if mismatch is parent and first child suspends', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      /** 先清suspend再兑现共享promise，保证重试不会继续抛已兑现的暂停任务；后续日志分辨恢复水合与客户端重建。 */
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });
    /** 暂停时抛共享promise，否则返回div children；作为父Component的第一child。 */
    function Child({children}) {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return <div>{children}</div>;
      }
    }
    /** 父div保持相同，先children再服务端div或客户端article；差异节点晚于第一child暂停点。 */
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
    /** Activity内差异父Component包暂停Child，父函数已执行但后置差异尚未遍历。 */
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
      /** 记录恢复错误message首句并另记原cause首句；日志区分尚在暂停的尝试与已提交的客户端接管。 */
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

    // 客户端完成渲染，Activity 注释节点已移除。
    expect(container.innerHTML).toBe(
      '<div><div></div><article>Mismatch</article></div>',
    );
  });

  /** Component先产生article差异再到挂起的第二child，外层有Suspense；立即隐藏原div、保留marker并加Loading，解除后重建移除Activity marker；节流开关决定recoverable在timer前或后记录。 */
  it('does show a parent fallback if mismatch is parent and second child suspends', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      /** 先清suspend再兑现共享promise，保证重试不会继续抛已兑现的暂停任务；后续日志分辨恢复水合与客户端重建。 */
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });
    /** 异步div children位于Component的第二child，前面的差异已触发客户端重建。 */
    function Child({children}) {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return <div>{children}</div>;
      }
    }
    /** 先客户端article/服务端div差异，再children，确保差异先于第二child暂停。 */
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
    /** 记录Fallback并返回Loading，用日志证明暂停传播到父Suspense。 */
    function Fallback() {
      Scheduler.log('Fallback');
      return 'Loading...';
    }
    /** Suspense包Activity/Component/Child，让Activity重建期间的暂停由父fallback接住。 */
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
      /** 记录恢复错误message首句并另记原cause首句；日志区分尚在暂停的尝试与已提交的客户端接管。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll(['Component', 'Component', 'Suspend', 'Fallback']);
    jest.runAllTimers();

    // 父Suspense已提交Loading并隐藏服务端主机内容；Activity的客户端重建尚未提交，原marker仍保留。
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

    // alwaysThrottleRetries开启时恢复提交被节流，runAllTimers后才报告差异；关闭时前面的waitForAll已包含该回调。
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

  /** 父主机div仅客户端改article，内部Child仍pending且有外Suspense；先遇父标签差异，转客户端后挂起，保留隐藏原div并显示Loading；解除后article提交，覆盖父fallback与错误节流。 */
  it('does show a parent fallback if mismatch is in parent element only', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      /** 先清suspend再兑现共享promise，保证重试不会继续抛已兑现的暂停任务；后续日志分辨恢复水合与客户端重建。 */
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });
    /** 内部Child受同promise控制，完成返回div children，父标签已先被客户端改变。 */
    function Child({children}) {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return <div>{children}</div>;
      }
    }
    /** 仅改父标签div→article并原样放children，隔离父主机本身的水合差异。 */
    function Component({shouldMismatch, children}) {
      Scheduler.log('Component');
      if (shouldMismatch && client) {
        return <article>{children}</article>;
      }
      return <div>{children}</div>;
    }
    /** 记录Fallback并输出Loading，证明父标签差异后的暂停显示外层fallback。 */
    function Fallback() {
      Scheduler.log('Fallback');
      return 'Loading...';
    }
    /** 外Suspense接住Activity内父标签重建的异步Child，旧主机内容先隐藏。 */
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
      /** 记录恢复错误message首句并另记原cause首句；日志区分尚在暂停的尝试与已提交的客户端接管。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll(['Component', 'Component', 'Suspend', 'Fallback']);
    jest.runAllTimers();

    // 父Suspense已提交Loading并隐藏服务端主机内容；Activity的客户端重建尚未提交，原marker仍保留。
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

    // alwaysThrottleRetries开启时恢复提交被节流，runAllTimers后才报告差异；关闭时前面的waitForAll已包含该回调。
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

  /** 同Activity内差异Component先于挂起Child，外Suspense接住客户端重建的暂停；旧div隐藏、原Hello文本从textContent中清空，Loading可见，解除后article/Hello并报告恢复。 */
  it('does show a parent fallback if mismatch is before suspending', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      /** 先清suspend再兑现共享promise，保证重试不会继续抛已兑现的暂停任务；后续日志分辨恢复水合与客户端重建。 */
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });
    /** pending抛promise，完成返回Hello；前面的Component差异已放弃局部水合。 */
    function Child() {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return 'Hello';
      }
    }
    /** 首个主机child客户端div→article，确保水合差异先于随后Child暂停。 */
    function Component({shouldMismatch}) {
      Scheduler.log('Component');
      if (shouldMismatch && client) {
        return <article>Mismatch</article>;
      }
      return <div>Component</div>;
    }
    /** 记录并显示Loading，观察先差异后暂停的父Suspense提交。 */
    function Fallback() {
      Scheduler.log('Fallback');
      return 'Loading...';
    }
    /** Suspense内Activity先差异Component再Child，比较主机文本清空与父fallback。 */
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
      /** 记录恢复错误message首句并另记原cause首句；日志区分尚在暂停的尝试与已提交的客户端接管。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll(['Component', 'Component', 'Suspend', 'Fallback']);
    jest.runAllTimers();

    // 父Suspense已提交Loading并隐藏服务端主机内容；Activity的客户端重建尚未提交，原marker仍保留。
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

    // alwaysThrottleRetries开启时恢复提交被节流，runAllTimers后才报告差异；关闭时前面的waitForAll已包含该回调。
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

  /** 差异Component在前、挂起Child嵌在后一个div；旧两个div隐藏而Loading可见，解除后article/div Hello，验证父Suspense隐藏区间包含深层暂停的旧DOM。 */
  it('does show a parent fallback if mismatch is before suspending in a child', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      /** 先清suspend再兑现共享promise，保证重试不会继续抛已兑现的暂停任务；后续日志分辨恢复水合与客户端重建。 */
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });
    /** 暂停时抛promise，完成返回Hello；嵌在后一个div以测试多层暂停。 */
    function Child() {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return 'Hello';
      }
    }
    /** 前置Component客户端改article，触发Activity局部接管。 */
    function Component({shouldMismatch}) {
      Scheduler.log('Component');
      if (shouldMismatch && client) {
        return <article>Mismatch</article>;
      }
      return <div>Component</div>;
    }
    /** 记录并返回Loading，判断深层暂停是否传播到父边界。 */
    function Fallback() {
      Scheduler.log('Fallback');
      return 'Loading...';
    }
    /** 父Suspense包Activity，前差异Component、后div/Child，使整个原内容区间隐藏。 */
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
      /** 记录恢复错误message首句并另记原cause首句；日志区分尚在暂停的尝试与已提交的客户端接管。 */
      onRecoverableError(error) {
        Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
        if (error.cause) {
          Scheduler.log('Cause: ' + normalizeError(error.cause.message));
        }
      },
    });
    await waitForAll(['Component', 'Component', 'Suspend', 'Fallback']);
    jest.runAllTimers();

    // 父Suspense已提交Loading并隐藏服务端主机内容；Activity的客户端重建尚未提交，原marker仍保留。
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

    // alwaysThrottleRetries开启时恢复提交被节流，runAllTimers后才报告差异；关闭时前面的waitForAll已包含该回调。
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

  /** 两个Activity完整SSR后客户端都pending；先解决第一使onHydrated一次，再value=true让第二的新输入可完成、旧边界被接管，onDeleted一次，验证水合与删除回调的不同提交。 */
  it('calls the hydration callbacks after hydration or deletion', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    /** 第一Activity可由resolve解阻，完成Hello，对应成功水合回调。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    let suspend2 = false;
    const promise2 = new Promise(() => {});
    /** 第二Activity仅在suspend2且value为假时永pending，value=true的新输入返回World并接管旧边界。 */
    function Child2({value}) {
      if (suspend2 && !value) {
        throw promise2;
      } else {
        return 'World';
      }
    }

    /** 两个兄弟Activity分别挂第一Child和带value的Child2，区分水合与删除回调计数。 */
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
      /** 保存成功水合边界node，最终只应记录第一Activity的成功提交。 */
      onHydrated(node) {
        hydrated.push(node);
      },
      /** 保存接管时删除的边界node，最终记录第二Activity，和成功水合回调分开计数。 */
      onDeleted(node) {
        deleted.push(node);
      },
      /** 记录恢复错误message首句并另记原cause首句；日志区分尚在暂停的尝试与已提交的客户端接管。 */
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

  /** SSR空Activity后跟Sibling，水合同树后仍含Sibling；验证空边界后的主机游标能继续匹配，本例没有直接断言空marker身份。 */
  it('hydrates an empty activity boundary', async () => {
    /** 空Activity后放Sibling div，检验游标跳过空边界协议后仍能匹配兄弟。 */
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

  /** Activity的SSR含A/B而客户端仅A，store snapshot日志区分水合与客户端；报告差异、B消失且A ref不再指原span，验证边界尾部额外节点导致局部重建。 */
  it('recovers with client render when server rendered additional nodes at suspense root', async () => {
    /** 用store的server/client snapshot回调修改局部标签并返回null，日志显示当前水合或客户端路径；children未使用，订阅函数无外部store监听。 */
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
    /** Activity内A ref后按hasB放B，再snapshot探针；外Sibling用于限制重建范围。 */
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
        /** 记录恢复错误message首句并另记原cause首句；日志区分尚在暂停的尝试与已提交的客户端接管。 */
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

  /** 相同额外B，但前面的Suspender先阻塞；解除后发现多余节点、报告差异并新建A span，覆盖暂停恢复后的Activity尾部检查。 */
  it('recovers with client render when server rendered additional nodes at suspense root after unsuspending', async () => {
    const ref = React.createRef();
    let shouldSuspend = false;
    let resolve;
    const promise = new Promise(res => {
      /** 先清shouldSuspend再兑现promise，允许暂停恢复后继续检查额外B节点。 */
      resolve = () => {
        shouldSuspend = false;
        res();
      };
    });
    /** shouldSuspend时抛promise，否则空Fragment；在A/B之前阻止尾部多余节点检测。 */
    function Suspender() {
      if (shouldSuspend) {
        throw promise;
      }
      return <></>;
    }
    /** Activity先Suspender再A及可选B，制造暂停恢复后才暴露的尾部差异。 */
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
        /** 记录恢复错误message首句并另记原cause首句；日志区分尚在暂停的尝试与已提交的客户端接管。 */
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

  /** A/B嵌在Activity内额外div，客户端去掉B；差异回调、B删除且A ref指新节点，覆盖深层多余节点的重建边界。 */
  it('recovers with client render when server rendered additional nodes deep inside suspense root', async () => {
    const ref = React.createRef();
    /** 额外div中放A和可选B，差异位于Activity内部深层；外Sibling独立。 */
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
        /** 记录恢复错误message首句并另记原cause首句；日志区分尚在暂停的尝试与已提交的客户端接管。 */
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

  /** Activity Child永久pending时父App更新deleted=true返回null；onDeleted由0变1，验证祖先删除能清理并通知尚未水合的Activity。 */
  it('calls the onDeleted hydration callback if the parent gets deleted', async () => {
    let suspend = false;
    const promise = new Promise(() => {});
    /** 客户端suspend时抛永不兑现的promise，否则Hello，保证删除发生在未水合状态。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    /** deleted时返回null删除整个祖先div，否则保留Activity/Child，触发边界onDeleted。 */
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
        /** 收集祖先删除通知的未水合边界node，数组长度应仅增一次。 */
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

  /** Second Activity客户端永久pending，前面的Sibling最初null；独立state更新把First div插在未水合marker前，验证已水合兄弟可更新而无需解阻子边界。 */
  it('can insert siblings before the dehydrated boundary', async () => {
    let suspend = false;
    const promise = new Promise(() => {});
    let showSibling;

    /** 完整SSR输出Second，客户端抛永久pending promise，使后方边界始终未水合。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return 'Second';
      }
    }

    /** 初始null，暴露showSibling把visible设true后输出First div；已水合兄弟状态可独立提交。 */
    function Sibling() {
      const [visible, setVisibilty] = React.useState(false);
      /** 把Sibling自身visible置true，供测试在未水合Activity前插入First。 */
      showSibling = () => setVisibilty(true);
      if (visible) {
        return <div>First</div>;
      }
      return null;
    }

    /** 同div里先Sibling再Activity/Second，观察在未水合起始marker前插入主机节点。 */
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

  /** Before/After间Activity含Middle div与文本，客户端pending时hideMiddle删除整边界；第二个主机child由Middle变After，验证无需水合即可移除边界区间。 */
  it('can delete the dehydrated boundary before it is hydrated', async () => {
    let suspend = false;
    const promise = new Promise(() => {});
    let hideMiddle;

    /** 完整SSR返回Middle div与文本，客户端pending让整Activity可在未水合时被删除。 */
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

    /** Before/After间按visible放Activity；hideMiddle删除包括marker、div和文本的整个区间。 */
    function App() {
      const [visible, setVisibilty] = React.useState(true);
      /** 把visible置false，删除Middle Activity而无需解阻其中Child。 */
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

  /** Hello/hello Activity pending，root先排Hi/hi props更新并同时解除promise；原span/ref复用且文本、class都改Hi/hi，验证旧输入水合先于后续props提交。 */
  it('blocks updates to hydrate the content first if props have changed', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();

    /** 旧输入pending抛promise，解阻返回text，分别观察旧Hello水合与新Hi更新。 */
    function Child({text}) {
      if (suspend) {
        throw promise;
      } else {
        return text;
      }
    }

    /** Activity内span同时接收text/className和ref，节点身份与属性更新共同验证先水合再更新。 */
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

  /** 同样的Hi/hi更新在www环境以IdleEventPriority排队，同时解除promise；原span仍复用并完成ref/文本/class更新，覆盖低优先级变更与水合ping的顺序。 */
  // @gate www
  it('blocks updates to hydrate the content first if props changed at idle priority', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();

    /** 共享promise控制Hello/Hi的完成时机，供Idle props更新与ping交叠。 */
    function Child({text}) {
      if (suspend) {
        throw promise;
      } else {
        return text;
      }
    }

    /** Activity包带class/ref的span，验证低优先级更新不会导致不必要重建。 */
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

  /** 已水合外div内的Activity仍pending，普通props更新Hi/hi；父Suspense隐藏原div、outerRef脱离而原span仍在，textContent含HelloLoading；解除后新内容Hi/hi提交，验证隐藏保留而非立即删除。 */
  it('shows the fallback of the parent if props have changed before hydration completes and is still suspended', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const outerRef = React.createRef();
    const ref = React.createRef();

    /** suspend期间旧、新text均抛同promise，确保Hi更新只能先显示父fallback。 */
    function Child({text}) {
      if (suspend) {
        throw promise;
      } else {
        return text;
      }
    }

    /** 外Suspense内div有outerRef，Activity内span另有ref；区分已提交祖先隐藏时脱ref与子树尚未提交。 */
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
        /** 记录恢复错误message首句并另记原cause首句；日志区分尚在暂停的尝试与已提交的客户端接管。 */
        onRecoverableError(error) {
          Scheduler.log('onRecoverableError: ' + normalizeError(error.message));
          if (error.cause) {
            Scheduler.log('Cause: ' + normalizeError(error.cause.message));
          }
        },
      },
    );
    await waitForAll([]);

    expect(container.getElementsByTagName('div').length).toBe(1); // 此时外div已水合且尚未隐藏。
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

  /** 外Activity嵌内Activity，两处旧Hello永pending但新Hi不挂起；普通props更新直接提交Hi Hi/ref/class，验证接管父边界时清理未水合内边界且不需等待旧promise。 */
  it('clears nested activity boundaries if they did not hydrate yet', async () => {
    let suspend = false;
    const promise = new Promise(() => {});
    const ref = React.createRef();

    /** 旧Hello挂起但text为Hi直接完成，提供无需解决旧promise的新输入接管路径。 */
    function Child({text}) {
      if (suspend && text !== 'Hi') {
        throw promise;
      } else {
        return text;
      }
    }

    /** 外Activity内放嵌套Activity/text及带ref span/text，父接管须清理内层未水合协议。 */
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
        /** 记录恢复错误message首句并另记原cause首句；日志区分尚在暂停的尝试与已提交的客户端接管。 */
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

  /** transition排Hi/hi而旧Child仍pending，先保持Hello/ref空；随后解除promise并复用原span更新，覆盖可等待过渡；本例未测量具体timeout阈值。 */
  it('hydrates first if props changed but we are able to resolve within a timeout', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();

    /** suspend控制promise，供transition保留旧内容直到旧输入可水合。 */
    function Child({text}) {
      if (suspend) {
        throw promise;
      } else {
        return text;
      }
    }

    /** Activity内ref/class span承载text，原节点身份判断过渡是否先复用再更新。 */
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

    // 在 transition 中更新；原始内容仍挂起时，React 会保留已显示的服务端内容。
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

  /** Child水合render暴露setter但仍未提交，在暂停中setState Hi；开发警告未挂载，解除后最终仍Hello，验证该更新没有成为已提交状态，不按标题推断Hi已应用。 */
  it('warns but works if setState is called before commit in a dehydrated component', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    let updateText;

    /** render暴露尚未提交的state setter并记录Child；pending时抛promise，完成输出本轮初始Hello。 */
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

    /** 记录Sibling后返回null，日志证明解阻后完整渲染才经过后续兄弟。 */
    function Sibling() {
      Scheduler.log('Sibling');
      return null;
    }

    /** Activity包Child/Sibling，使中途暴露的setter属于未挂载子组件。 */
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

      // 再次尝试仍读初始Hello；该未挂载setter更新不进入最终已提交状态。
      await waitForAll(['Child']);

      expect(container.textContent).toBe('Hello');

      suspend = false;
      resolve();
      await promise;
    });
    assertLog(['Child', 'Sibling']);

    expect(container.textContent).toBe('Hello');
  });

  /** memo App内Child读Context Hello/hello且pending，Provider先排Hi/hi并同时解阻；原span/ref复用并改文本/class，验证context变更先水合旧树再提交新输入。 */
  it('blocks the update to hydrate first if context has changed', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();
    const Context = React.createContext(null);

    /** 从Context读取text/className，pending抛promise，完成返回带ref的span，观察context传播与水合顺序。 */
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

    const App = React.memo(/** memo化Activity外壳，Context消费者仍可因Provider传播更新而进入旧输入水合/新输入提交。 */ function App() {
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

  /** 同Context变更但promise仍pending，外Suspense显示Loading并保留隐藏原span、ref空、textContent为HelloLoading；解除后Hi/hi提交，验证父fallback隐藏旧Activity内容而非删除。 */
  it('shows the parent fallback if context has changed before hydration completes and is still suspended', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();
    const Context = React.createContext(null);

    /** Context消费者受共享promise阻塞，解阻输出带ref/class的span，旧树需要父Suspense隐藏保留。 */
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

    const App = React.memo(/** memo化含父Suspense的Activity外壳，Context变化继续挂起时由外边界隐藏旧内容。 */ function App() {
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
        /** 记录恢复错误message首句并另记原cause首句；日志区分尚在暂停的尝试与已提交的客户端接管。 */
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

    // 新Context仍挂起，父Suspense隐藏原span并显示Loading；旧span保留，textContent仍含Hello。
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

  /** 两个已完成兄弟Activity直接水合，两个ref分别指原span1/span2；验证独立Activity起止marker的游标匹配和节点复用。 */
  it('can hydrate TWO activity boundaries', async () => {
    const ref1 = React.createRef();
    const ref2 = React.createRef();

    /** 两个兄弟Activity各含不同ref span，检验&起止marker与主机节点身份逐一对应。 */
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

  /** 旧Context hello/文本Hello永pending，而新hi/Hi可完成；普通更新直接重建span/ref并改class，不复用旧span，验证新输入接管，本例没有推进过期计时器。 */
  it('regenerates if it cannot hydrate before changes to props/context expire', async () => {
    let suspend = false;
    const promise = new Promise(resolvePromise => {});
    const ref = React.createRef();
    const ClassName = React.createContext(null);

    /** 仅旧className和旧text同时出现才pending；hi或Hi可完成，普通更新能接管旧边界。 */
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

    /** Activity中将text传Child，className实际由外Context提供，保持两种更新来源分离。 */
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
        /** 记录恢复错误message首句并另记原cause首句；日志区分尚在暂停的尝试与已提交的客户端接管。 */
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

    // 原始数据仍挂起，无法完成水合；普通更新的新数据已经可用，因此 React 放弃复用旧边界并提交客户端内容。
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

  /** Activity的按钮Fiber已开始水合但Sibling仍pending，click不能调用handler；解除提交后clicks仍0且内容未变，验证未提交节点阻塞离散事件且不重放该click。 */
  it('does not invoke an event on a hydrated node until it commits', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** 同Activity中在按钮后挂起，阻止已遍历按钮Fiber完成提交；完成输出Hello。 */
    function Sibling({text}) {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    let clicks = 0;

    /** click设clicked并计数，已提交后应使a消失；本例阻塞click始终无调用所以a保持。 */
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

    /** Activity先按钮后异步Sibling，构造主机节点已匹配但边界未提交的状态。 */
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

  /** www event handle在客户端layout注册，Sibling阻塞整个Activity提交；水合前和部分水合时点击均0，解除后仍0，验证注册时序及离散click未重放；layout返回的注销函数随effect清理。 */
  // @gate www
  it('does not invoke an event on a hydrated event handle until it commits', async () => {
    const setClick = ReactDOM.unstable_createEventHandle('click');
    let suspend = false;
    let isServerRendering = true;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** 在event-handle按钮后挂起，推迟整个Activity的layout注册。 */
    function Sibling({text}) {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    const onEvent = jest.fn();

    /** ref绑定a，客户端layout注册click并返回注销函数；SSR不调用layout hook，未提交时onEvent尚不可执行。 */
    function Button() {
      const ref = React.useRef(null);
      if (!isServerRendering) {
        React.useLayoutEffect(() => {
          return setClick(ref.current, onEvent);
        });
      }
      return <a ref={ref}>Click me</a>;
    }

    /** Activity内先event-handle按钮再Sibling，检验注册依赖边界提交。 */
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
    // 当前click因边界未提交被阻塞；解阻后断言仍为0，不会重放该离散click。
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

  /** 外Activity的Child pending且内嵌Activity/按钮，水合前和部分水合时点击都0；解除后仍0，验证嵌套未提交边界阻塞离散click，标题invokes不代表本例有成功调用。 */
  it('invokes discrete events on nested activity boundaries in a root (legacy system)', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    let clicks = 0;

    /** 输出带click计数的a，本例边界阻塞使次数一直0。 */
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

    /** 外Child pending则抛promise，完成才返回内Activity/Button，形成嵌套阻塞边界。 */
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

    /** 根只返回外Activity/Child，比较嵌套边界上的离散click。 */
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
    // 当前click因边界未提交被阻塞；解阻后断言仍为0，不会重放该离散click。
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

  /** www createEventHandle版本嵌套Activity，客户端layout尚未提交注册；两次click均无调用，解除后仍0，覆盖嵌套边界的event-handle阻塞与不重放。 */
  // @gate www
  it('invokes discrete events on nested activity boundaries in a root (createEventHandle)', async () => {
    let suspend = false;
    let isServerRendering = true;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    const onEvent = jest.fn();
    const setClick = ReactDOM.unstable_createEventHandle('click');

    /** 客户端layout为ref a安装event handle并返回注销函数；SSR无注册，内Activity须先提交。 */
    function Button() {
      const ref = React.useRef(null);

      if (!isServerRendering) {
        React.useLayoutEffect(() => {
          return setClick(ref.current, onEvent);
        });
      }

      return <a ref={ref}>Click me</a>;
    }

    /** 外Child解阻后返回内Activity/Button，外边界pending使内部handle注册也延后。 */
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

    /** 外Activity包异步Child，检验嵌套createEventHandle的离散事件阻塞。 */
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
    // 当前click因边界未提交被阻塞；解阻后断言仍为0，不会重放该离散click。
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

  /** 已水合父div有click，Activity内Child的handler本应stopPropagation；pending时点击child不调用父子，解除后仍都0，验证不能越过未水合目标直接派发父监听器。 */
  it('does not invoke the parent of dehydrated boundary event', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    let clicksOnParent = 0;
    let clicksOnChild = 0;

    /** pending时抛promise，完成返回会stopPropagation并累加子次数的span；阻塞期间连父监听也不可先派发。 */
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

    /** 已水合父div有click计数，未水合Activity内Child的传播规则尚未就绪。 */
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

  /** 先完成父React root，再把pending Activity的独立hydrate root嵌到父DOM槽；点击子a不调用已水合父root，解除后仍0，验证阻塞事件不能跨根错误冒泡。 */
  it('does not invoke an event on a parent tree when a subtree is dehydrated', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    let clicks = 0;
    const childSlotRef = React.createRef();

    /** 在独立已提交root输出click div并暴露DOM槽，容纳另一个hydrate root。 */
    function Parent() {
      return <div onClick={() => clicks++} ref={childSlotRef} />;
    }

    /** pending时抛promise否则a，事件目标属于嵌入父root的未水合子root。 */
    function Child({text}) {
      if (suspend) {
        throw promise;
      } else {
        return <a>Click me</a>;
      }
    }

    /** 子root只输出Activity/Child，和父root保持独立Fiber入口以检测跨根误派发。 */
    function App() {
      // 根组件返回一个尚待水合的 Activity 边界。
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

    // Activity 边界尚未水合。
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

  /** 两个Activity都pending，鼠标从app→First→Second；初始无事件，先解决Second只重放Mouse Enter Second，再解决First无额外事件，验证连续事件只保留最后悬停目标。 */
  it('blocks only on the last continuous event (legacy system)', async () => {
    let suspend1 = false;
    let resolve1;
    const promise1 = new Promise(resolvePromise => (resolve1 = resolvePromise));
    let suspend2 = false;
    let resolve2;
    const promise2 = new Promise(resolvePromise => (resolve2 = resolvePromise));

    /** 独立promise1控制First边界，完成Hello；位于空span后让其监听器虽已遍历却未提交。 */
    function First({text}) {
      if (suspend1) {
        throw promise1;
      } else {
        return 'Hello';
      }
    }

    /** 独立promise2控制Second边界并返回World，最后悬停目标先解阻触发唯一重放。 */
    function Second({text}) {
      if (suspend2) {
        throw promise2;
      } else {
        return 'World';
      }
    }

    const ops = [];

    /** 两个Activity各带enter/leave日志，First空span之后再异步子、Second span内部异步子，覆盖监听器提前遍历。 */
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

  /** 稳定Activity元素保存Hello待水合，promise已ping但未重试时root更新加入Sibling；先render/commit Sibling使HelloWorld且ref仍空，再Child水合，验证普通更新先于较低优先级重试。 */
  it('finishes normal pri work before continuing to hydrate a retry', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();

    /** 解阻后记录Child并返回Hello，日志与ref用于判断水合重试是否晚于普通兄弟提交。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        Scheduler.log('Child');
        return 'Hello';
      }
    }

    /** render记录Sibling，layout记录Commit Sibling并返回World，提供普通更新提交证据。 */
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

    /** 复用同一个Activity元素tree避免props导致接管，showSibling仅在旁加入Sibling。 */
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

  /** Form已匹配但同Activity Sibling未提交，派发实际bubbles=true的submit；提交前后submits均0且表单还在，验证离散submit阻塞后不重放，标题non-bubbling不描述本输入。 */
  it('regression test: does not overfire non-bubbling browser events', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** 表单后共享promise挂起，阻止Form部分水合后的提交。 */
    function Sibling({text}) {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    let submits = 0;

    /** submit会设submitted并计数、随后删form；本例阻塞事件不执行，所以DOM仍有Click me。 */
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

    /** Activity先Form后异步Sibling，使用bubbles=true的submit检验未提交目标的离散事件。 */
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

  /** 两个Activity间根div server仅客户端改span client，且两个Child客户端pending；根恢复也会挂起而保留完整旧HTML，解除后整根重建1/client/2并报告差异，区别有父fallback的局部恢复。 */
  it('fallback to client render on hydration mismatch at root', async () => {
    let suspend = true;
    let resolve;
    const promise = new Promise((res, rej) => {
      /** 先清suspend再兑现共享promise，允许两个客户端Child完成根级恢复。 */
      resolve = () => {
        suspend = false;
        res();
      };
    });
    /** 两个Activity之间服务端div server改客户端span client，制造边界外根级差异且无父fallback。 */
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
    /** 只在客户端并且suspend时抛promise，服务端完整输出id div；根重建需等两个子都解阻。 */
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
        /** 记录恢复错误message首句并另记原cause首句；日志区分尚在暂停的尝试与已提交的客户端接管。 */
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

  /** 挂载effect普通更新同时增加pending Second并将待水合Activity First切hidden；解阻后Second存在且可见、First不存在或display none，验证新内容提交可配合旧树隐藏，不直接断言中间UI。 */
  it('commits new suspending content next to a dehydrated Activity that hides', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** 新增Second pending抛promise，完成输出id second span，最终验证可见性。 */
    function Second() {
      if (suspend) {
        throw promise;
      }
      return <span id="second">Second</span>;
    }

    /** effect普通setActive切到second，同步增加新异步Sibling并把旧First Activity从visible改hidden，父Suspense fallback为null。 */
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

  /** 同样First→Second切换在挂载effect中用startTransition；解除后Second可见、First删除或隐藏，覆盖过渡交叠与Activity模式变化，断言不要求两路径有相同中间提交。 */
  it('commits new suspending content next to a dehydrated Activity that hides (transition)', async () => {
    // 同上测试。 除了更新被包裹在 startTransition 中。
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** transition路径的新Second受promise阻塞，完成输出可见span供最终断言。 */
    function Second() {
      if (suspend) {
        throw promise;
      }
      return <span id="second">Second</span>;
    }

    /** effect中startTransition切active，增Second并隐藏待水合First Activity，观察两树交叠后最终提交。 */
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
