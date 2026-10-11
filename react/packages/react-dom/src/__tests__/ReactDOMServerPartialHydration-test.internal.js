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

/** 将错误消息截到第一个句点（含句点），减少开发/生产附加栈差异；无句点时原样返回，可能截断包含句点的具体原因。 */
function normalizeError(msg) {
  // 将第一个句子作为基础，以便更容易地进行断言。
  const idx = msg.indexOf('.');
  if (idx > -1) {
    return msg.slice(0, idx + 1);
  }
  return msg;
}

/** 按from/to派发带relatedTarget的mouseout及mouseover，模拟鼠标跨目标；空端点代表离开/进入窗口，供连续事件最新目标重放检查。 */
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

/** 类输出空串Fragment与Hello Fragment，作为空child水合wrapper的类fixture。 */
class TestAppClass extends React.Component {

  /** 返回div内两个Fragment，一空一文本，检验空输出不占实际文本节点。 */
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

  /** 主机div.hidden负责真正隐藏；内部LegacyHidden hidden映射defer-without-hiding，供旧延迟树水合而避免重复隐藏。 */
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

  /** SSR完整Hello边界后客户端Child抛pending promise，span ref未赋；解除后ref指向原span，验证子边界阻塞不阻止外层进入水合。 */
  it('hydrates a parent even if a child Suspense boundary is blocked', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();

    /** 按suspend抛共享promise或返回Hello，控制边界水合解阻。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    /** 把带ref的span和异步Child放进完整Suspense，供检查是否复用SSR节点。 */
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

  /** 外边界Child挂起且后面嵌完整Hello边界，SSR文本HelloHello保持；解决后仍同文本且无错误日志，验证挂起兄弟不误报结构差异。 */
  it('can hydrate siblings of a suspended component without errors', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** pending时抛promise，解决后返回Hello，阻塞外边界。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    /** 外边界先异步Child再内完整Hello边界，覆盖挂起兄弟与嵌套游标。 */
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

      /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** StrictMode中边界先pending，layout/passive日志为空；解决水合后开发依次mount/cleanup/mount、生产各mount一次，验证延后水合提交也执行严格effect重播。 */
  it('replays effects when a suspended boundary hydrates in StrictMode', async () => {
    const log = [];
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** 分别用layout/passive effect记录mount及清理，供StrictMode水合提交重播顺序。 */
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

    /** 条件use共享promise，解阻后返回EffectfulChild，延迟其effect提交。 */
    function Child() {
      if (suspend) {
        use(promise);
      }
      return <EffectfulChild />;
    }

    /** 固定Suspense包Child，StrictMode由外部element包裹。 */
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

  /** 先Child暂停，末尾第四Component仅客户端div→article不匹配；pending期间保留原HTML，解决后检测差异再客户端重建边界并报告recoverable。 */
  it('falls back to client rendering boundary on mismatch', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      /** 先将suspend设false，再解决共享promise；保证水合或客户端重试能越过暂停点。 */
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });

    /** 记录Suspend或Hello并控制首childpending，推迟发现末尾差异。 */
    function Child() {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return 'Hello';
      }
    }

    /** 仅shouldMismatch且client时把div Component改article Mismatch，其余保持完整SSR输出。 */
    function Component({shouldMismatch}) {
      Scheduler.log('Component');
      if (shouldMismatch && client) {
        return <article>Mismatch</article>;
      }
      return <div>Component</div>;
    }

    /** 在异步Child后渲染四个Component，仅最后一个会变标签，制造靠后的结构差异。 */
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

      /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** mismatch组件在暂停Child之后；暂停时不执行Fallback且保留服务端HTML，解决后两轮render完成重建，验证未遍历差异前不提前放弃水合。 */
  it('does not show a fallback if mismatch is after suspending', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      /** 先将suspend设false，再解决共享promise；保证水合或客户端重试能越过暂停点。 */
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });

    /** 记录并控制首Child暂停，解决后返回Hello文本。 */
    function Child() {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return 'Hello';
      }
    }

    /** 按客户端开关制造后续Component标签差异。 */
    function Component({shouldMismatch}) {
      Scheduler.log('Component');
      if (shouldMismatch && client) {
        return <article>Mismatch</article>;
      }
      return <div>Component</div>;
    }

    /** 记录Fallback render并返回Loading，确认是否提前执行替代树。 */
    function Fallback() {
      Scheduler.log('Fallback');
      return 'Loading...';
    }

    /** 把暂停Child置于差异Component之前，检验遍历顺序。 */
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

      /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** mismatch位于暂停Child返回div的内部；Child挂起时仍保留原DOM，解决后才遍历差异并客户端重建，无先行fallback。 */
  it('does not show a fallback if mismatch is child of suspended component', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      /** 先将suspend设false，再解决共享promise；保证水合或客户端重试能越过暂停点。 */
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });

    /** pending时不遍历children，完成时以div包children，令差异位于暂停组件内部。 */
    function Child({children}) {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return <div>{children}</div>;
      }
    }

    /** 客户端有条件改article，作为Child内部差异。 */
    function Component({shouldMismatch}) {
      Scheduler.log('Component');
      if (shouldMismatch && client) {
        return <article>Mismatch</article>;
      }
      return <div>Component</div>;
    }

    /** 记录Fallback是否准备并返回Loading。 */
    function Fallback() {
      Scheduler.log('Fallback');
      return 'Loading...';
    }

    /** 把差异组件嵌入可挂起Child，保证暂停在结构检查之前。 */
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

      /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** Component包住暂停的第一child，另一个差异节点位于其后；先Component/Suspend但未遇差异，保留旧HTML，解决后重建并报告错误，验证父组件执行不等于父主机不匹配。 */
  it('does not show a fallback if mismatch is parent and first child suspends', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      /** 先将suspend设false，再解决共享promise；保证水合或客户端重试能越过暂停点。 */
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });

    /** pending时抛promise，完成时输出带children的div，作为父Component第一child。 */
    function Child({children}) {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return <div>{children}</div>;
      }
    }

    /** 主机外壳一直是div，先children后尾部差异节点；客户端只替换后一个div为article。 */
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

    /** 记录替代UI render，供确认第一child暂停时尚未到后部差异。 */
    function Fallback() {
      Scheduler.log('Fallback');
      return 'Loading...';
    }

    /** 用Component包住Child，区别组件父执行与主机父标签差异。 */
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

      /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** Component先输出客户端article差异，再到暂停的第二child；水合已遇差异并改客户端，暂停后立即显示Loading，解决后输出新树，验证差异/挂起遍历顺序。 */
  it('does show a fallback if mismatch is parent and second child suspends', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      /** 先将suspend设false，再解决共享promise；保证水合或客户端重试能越过暂停点。 */
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });

    /** 控制第二child暂停并在完成时输出div。 */
    function Child({children}) {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return <div>{children}</div>;
      }
    }

    /** 先输出差异节点再children，迫使水合在到Child前发现标签差异。 */
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

    /** 返回并记录Loading，用来确认接管后的挂起UI。 */
    function Fallback() {
      Scheduler.log('Fallback');
      return 'Loading...';
    }

    /** 父Component先差异再Child，覆盖先mismatch后暂停路径。 */
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

      /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** 父主机div自身客户端改article，内部Child仍pending；先遇父标签差异，重建再暂停，显示Loading后解决为article，覆盖父主机层差异。 */
  it('does show a fallback if mismatch is in parent element only', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      /** 先将suspend设false，再解决共享promise；保证水合或客户端重试能越过暂停点。 */
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });

    /** 在父主机标签已经检查后才可能挂起，完成输出div。 */
    function Child({children}) {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return <div>{children}</div>;
      }
    }

    /** 客户端直接把父div改article，差异发生在进入children前。 */
    function Component({shouldMismatch, children}) {
      Scheduler.log('Component');
      if (shouldMismatch && client) {
        return <article>{children}</article>;
      }
      return <div>{children}</div>;
    }

    /** 记录Loading替代路径。 */
    function Fallback() {
      Scheduler.log('Fallback');
      return 'Loading...';
    }

    /** 父标签差异组件包异步Child。 */
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

      /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** 同边界差异Component在暂停Child之前；重建阶段遇pending显示Loading，解决后article+Hello，验证已有mismatch时不保留原边界。 */
  it('does show a fallback if mismatch is before suspending', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      /** 先将suspend设false，再解决共享promise；保证水合或客户端重试能越过暂停点。 */
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });

    /** pending时抛promise，完成后输出Hello文本。 */
    function Child() {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return 'Hello';
      }
    }

    /** 客户端将前置Component改article，先于后续Child检查。 */
    function Component({shouldMismatch}) {
      Scheduler.log('Component');
      if (shouldMismatch && client) {
        return <article>Mismatch</article>;
      }
      return <div>Component</div>;
    }

    /** 记录客户端接管后显示的Loading。 */
    function Fallback() {
      Scheduler.log('Fallback');
      return 'Loading...';
    }

    /** 前置差异组件与后置异步Child同属一个边界。 */
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

      /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** 差异Component在前、暂停Child嵌在后面的div；仍先放弃水合显示Loading，解决后article及div Hello，覆盖多层子暂停。 */
  it('does show a fallback if mismatch is before suspending in a child', async () => {
    let client = false;
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      /** 先将suspend设false，再解决共享promise；保证水合或客户端重试能越过暂停点。 */
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });

    /** 异步文本嵌在后置div里，pending时抛promise。 */
    function Child() {
      if (suspend) {
        Scheduler.log('Suspend');
        throw promise;
      } else {
        Scheduler.log('Hello');
        return 'Hello';
      }
    }

    /** 前置组件标签切换制造先发生的mismatch。 */
    function Component({shouldMismatch}) {
      Scheduler.log('Component');
      if (shouldMismatch && client) {
        return <article>Mismatch</article>;
      }
      return <div>Component</div>;
    }

    /** 记录Loading，检查即使暂停位于深层也走客户端fallback。 */
    function Fallback() {
      Scheduler.log('Fallback');
      return 'Loading...';
    }

    /** 前差异Component与后div Child共同放入边界。 */
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

      /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** 两个完整边界客户端都pending，先解决第一触发onHydrated一次，再改第二props仍无法水合触发onDeleted一次；验证成功与删除回调分属不同边界提交。 */
  it('calls the hydration callbacks after hydration or deletion', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** 控制第一个边界的可解决暂停，完成返回Hello。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    let suspend2 = false;
    const promise2 = new Promise(() => {});

    /** 第二边界可永久pending，完成返回World；收到value但不消费它，props变化仍可触发协调。 */
    function Child2() {
      if (suspend2) {
        throw promise2;
      } else {
        return 'World';
      }
    }

    /** 两个独立边界，value只传第二Child2用于更新接管。 */
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

      /** 保存成功水合提交的边界marker节点，外层只检查次数。 */
      onHydrated(node) {
        hydrated.push(node);
      },

      /** 保存放弃/删除水合边界marker，外层只检查次数。 */
      onDeleted(node) {
        deleted.push(node);
      },

      /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** SSR空Suspense与外Sibling，客户端水合同树后仍含Sibling；验证空边界游标可越过，不直接断言空边界的ref或marker身份。 */
  it('hydrates an empty suspense boundary', async () => {

    /** 输出空Suspense与独立Sibling，检验边界游标可越过空内容。 */
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

  /** SSR边界A/B、客户端只有A，用store snapshot日志区分水合与客户端；报告差异、删除B且A ref指新span，验证边界根多余节点导致局部重建。 */
  it('recovers with client render when server rendered additional nodes at suspense root', async () => {

    /** 用useSyncExternalStore的server/client snapshot回调设置本轮标记并写日志；不订阅更新、不输出children，可观察重建前后的渲染模式。 */
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

    /** 边界含A/ref、可选B和模式日志，供服务器多余节点的重建检查。 */
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

        /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** 相同多余B但Suspender先阻塞水合；解除后报告差异、B消失、A变新span，验证暂停恢复后的边界尾部多余节点检测。 */
  it('recovers with client render when server rendered additional nodes at suspense root after unsuspending', async () => {
    const ref = React.createRef();
    let shouldSuspend = false;
    let resolve;
    const promise = new Promise(res => {
      /** 先清shouldSuspend再解决promise，允许重试继续检测多余B。 */
      resolve = () => {
        shouldSuspend = false;
        res();
      };
    });

    /** shouldSuspend时抛promise，否则空Fragment；阻止继续检测A/B结构直至解阻。 */
    function Suspender() {
      if (shouldSuspend) {
        throw promise;
      }
      return <></>;
    }

    /** 先Suspender再A/ref与可选B，制造暂停之后的尾部多余节点。 */
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

        /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** A/B在边界内额外div深层，客户端去B；报告差异并重建A，覆盖深层多余节点而非仅边界根尾部。 */
  it('recovers with client render when server rendered additional nodes deep inside suspense root', async () => {
    const ref = React.createRef();

    /** 把A/ref与可选B嵌div，覆盖更深层额外节点。 */
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

        /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** Child永久挂起阻塞边界，父App普通更新deleted=true返回null；onDeleted从0到1，验证删除祖先会通知尚未水合边界。 */
  it('calls the onDeleted hydration callback if the parent gets deleted', async () => {
    let suspend = false;
    const promise = new Promise(() => {});

    /** 永久promise控制父删除前的pendingChild。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    /** deleted时返回null，否则输出完整边界，测试删除祖先。 */
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

        /** 记录被父删除的待水合边界节点。 */
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

  /** 完整Second边界水合pending，外Sibling初始null；独立state更新显示First在边界前，验证可在未水合marker前插入兄弟。 */
  it('can insert siblings before the dehydrated boundary', async () => {
    let suspend = false;
    const promise = new Promise(() => {});
    let showSibling;

    /** pending时抛永远promise，完成返回Second。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return 'Second';
      }
    }

    /** 初始null并暴露显示setter，更新后First主机节点可插在待水合边界前。 */
    function Sibling() {
      const [visible, setVisibilty] = React.useState(false);
      /** 把Sibling可见状态设true，从null插入First。 */
      showSibling = () => setVisibilty(true);
      if (visible) {
        return <div>First</div>;
      }
      return null;
    }

    /** 先独立Sibling再带span的pending边界，保持兄弟更新与水合解耦。 */
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

  /** Before/After之间边界含Middle与文本，水合pending时hideMiddle；第二个主机child改为After，验证无需完成子水合即可删除整个边界区间。 */
  it('can delete the dehydrated boundary before it is hydrated', async () => {
    let suspend = false;
    const promise = new Promise(() => {});
    let hideMiddle;

    /** 返回Middle div及文本，pending时抛promise，测试删除整个marker区间。 */
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

    /** visible控制Before/After之间边界存在，并暴露隐藏函数。 */
    function App() {
      const [visible, setVisibilty] = React.useState(true);
      /** 把visible设false，删除整个待水合Middle边界。 */
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

  /** Hello/hello边界pending，排Hi/hi props更新并同时解除promise；原span复用、ref绑定且文本/类更新，验证先按旧输入水合再处理新props。 */
  it('blocks updates to hydrate the content first if props have changed', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();

    /** pending抛promise，完成返回text prop，供按旧输入水合后再更新文本。 */
    function Child({text}) {
      if (suspend) {
        throw promise;
      } else {
        return text;
      }
    }

    /** 把text/className放在span及其Child，使用ref验证完整主机实例复用。 */
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
    // 除文本与节点身份外，还检查 className 已按新输入更新。
    expect(span.className).toBe('hi');
  });

  // @gate www

  /** 相同props更新以IdleEventPriority排队（www gate），同时解除；仍复用原span并更新Hi/hi，覆盖低优先级变更与hydration ping。 */
  it('blocks updates to hydrate the content first if props changed at idle priority', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();

    /** 按pending控制text输出，配Idle更新。 */
    function Child({text}) {
      if (suspend) {
        throw promise;
      } else {
        return text;
      }
    }

    /** 相同text/className/ref主机树，用Idle根更新测试先水合。 */
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
    // 除文本与节点身份外，还检查 className 已按新输入更新。
    expect(span.className).toBe('hi');
  });

  /** props改Hi/hi但旧边界仍pending，普通act更新放弃水合删除span并显示Loading；解决后新span/ref含Hi/hi，验证未解阻塞的新props接管。 */
  it('shows the fallback if props have changed before hydration completes and is still suspended', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();

    /** pending抛promise，接管后仍挂起直到解除。 */
    function Child({text}) {
      if (suspend) {
        throw promise;
      } else {
        return text;
      }
    }

    /** Hello/hello到Hi/hi更改会影响边界输入，未解promise时可改显示Loading。 */
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

        /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** 外span内再嵌无fallback的Suspense，改props时内层pending；外span已水合且始终复用，内部空fallback令文本空，解决后Hi/hi，验证缺省fallback相当于null而非忽略边界。 */
  it('treats missing fallback the same as if it was defined', async () => {
    // 额外的内Suspense缺省fallback为null；外span可以先水合，而内边界接管后暂时输出空内容。
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();

    /** 异步输出text，嵌在缺省fallback的内Suspense中。 */
    function Child({text}) {
      if (suspend) {
        throw promise;
      } else {
        return text;
      }
    }

    /** 外span在内边界之外可先水合；内Suspense没有fallback时显示null，不能当没有边界。 */
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

        /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

    // 新text仍挂起，内Suspense接管后显示null fallback；外span保持原节点/ref，只清空内部可见文本。
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

  /** 外边界一子为嵌内边界、另一为span，两处都pending；普通props更新显示外Loading且删除span，解决后Hi Hi，验证接管清理尚未水合的内marker。 */
  it('clears nested suspense boundaries if they did not hydrate yet', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();

    /** 同时用于内边界与外span的异步text，保证两处水合都pending。 */
    function Child({text}) {
      if (suspend) {
        throw promise;
      } else {
        return text;
      }
    }

    /** 嵌套边界后还有同promiseChild，外更新接管时要删除内待水合区间。 */
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

        /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** transition更新Hi/hi期间旧边界pending，先保留Hello；解决后原span成功水合再更新，验证可等待的过渡路径，本例没有实测具体timeout阈值。 */
  it('hydrates first if props changed but we are able to resolve within a timeout', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();

    /** 控制transition可等待的旧text水合，解除后返回text。 */
    function Child({text}) {
      if (suspend) {
        throw promise;
      } else {
        return text;
      }
    }

    /** 稳定span/ref与text/className，观察transition保留SSR直至解阻。 */
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

    // 在 transition 中更新，允许等待水合所需资源并保留当前服务端内容。
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
    // 除文本与节点身份外，还检查 className 已按新输入更新。
    expect(span.className).toBe('hi');
  });

  /** Child水合render已暴露setter但未提交，在暂停中调用setState Hi；开发报未挂载警告，解除后最终仍Hello，验证该更新没有作为已挂载状态生效。 */
  it('warns but works if setState is called before commit in a dehydrated component', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    let updateText;

    /** render暴露state setter再按suspend暂停；提交前setter更新不应被当成已挂载状态。 */
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

    /** 记录Sibling遍历并返回null，观察暂停恢复执行顺序。 */
    function Sibling() {
      Scheduler.log('Sibling');
      return null;
    }

    /** 边界内并列Child与Sibling，外App接收但不消费text/className。 */
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

      // 继续尝试仍读到未提交的初始状态；下面DOM保持Hello，最终不会应用这次Hi更新。
      await waitForAll(['Child']);

      expect(container.textContent).toBe('Hello');

      suspend = false;
      resolve();
      await promise;
    });
    assertLog(['Child', 'Sibling']);

    expect(container.textContent).toBe('Hello');
  });

  /** memo App内Child读Context Hello/hello且pending，Provider排Hi/hi后同时解除；原span/ref复用并更新，验证context变化先水合旧输入再更新。 */
  it('blocks the update to hydrate first if context has changed', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();
    const Context = React.createContext(null);

    /** 从Context读text/className，pending抛promise，完成返回ref span；绕过memo App静态元素继续传播context变化。 */
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

    const App = React.memo(/** memo化边界外壳，text/className不经props，内部Child仍由Context更新。 */ function App() {
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
    // 除文本与节点身份外，还检查 className 已按新输入更新。
    expect(span.className).toBe('hi');
  });

  /** 同Context变化但promise仍pending，普通更新删除span并显示Loading；解除后新span为Hi/hi，验证context接管的fallback路径。 */
  it('shows the fallback if context has changed before hydration completes and is still suspended', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();
    const Context = React.createContext(null);

    /** 同样消费Context，在持续pending更新时触发客户端fallback接管。 */
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

    const App = React.memo(/** memo化相同Context消费者外壳，检验pending时Context传播导致接管。 */ function App() {
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

        /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** SSR实际挂起、renderToString输出Loading及未完成标记，客户端已有Hello；报告服务器未完成边界并客户端建立span，验证不是完整HTML普通水合。 */
  it('replaces the fallback with client content if it is not rendered by the server', async () => {
    let suspend = false;
    const promise = new Promise(resolvePromise => {});
    const ref = React.createRef();

    /** 服务器可pending、客户端提前完成的Child，制造renderToString未完成边界恢复。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    /** span/ref位于Suspense主内容，服务器fallback里没有此span。 */
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

    // 本例服务器会挂起；renderToString输出未完成边界及fallback，客户端必须接管该边界。
    suspend = true;
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    expect(container.getElementsByTagName('span').length).toBe(0);

    // 在客户端，由于某种原因，我们有数据可用。
    suspend = false;
    ReactDOMClient.hydrateRoot(container, <App />, {

      /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** SSR外内容挂起，客户端Child已可用但内边界永久pending/null fallback；推进500ms后显示Hello且ref绑定，验证可完成的外层不被内层永久阻塞。 */
  it('replaces the fallback within the suspended time if there is a nested suspense', async () => {
    let suspend = false;
    const promise = new Promise(resolvePromise => {});
    const ref = React.createRef();

    /** 客户端已完成的Hello文本，允许外层替换SSR Loading。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    /** 始终抛永远promise，维持内null fallback而不阻止外层完成。 */
    function InnerChild() {
      // 始终无限期挂起
      throw promise;
    }

    /** 外主内容含Hello span与永挂内边界，测试可完成部分的揭示。 */
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

    // 本例服务器会挂起；renderToString输出未完成边界及fallback，客户端必须接管该边界。
    suspend = true;
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    expect(container.getElementsByTagName('span').length).toBe(0);

    // 在客户端，由于某种原因，我们有数据可用。
    suspend = false;
    ReactDOMClient.hydrateRoot(container, <App />, {

      /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** 再加一层外Suspense包上述结构，服务端仍有未完成边界；客户端解决中间Child且内层pending，500ms后Hello/ref完成，覆盖额外边界层级。 */
  it('replaces the fallback within the suspended time if there is a nested suspense in a nested suspense', async () => {
    let suspend = false;
    const promise = new Promise(resolvePromise => {});
    const ref = React.createRef();

    /** 控制中间边界Child在客户端可输出Hello。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    /** 永久pending内Child，保持最内层空fallback。 */
    function InnerChild() {
      // 始终无限期挂起
      throw promise;
    }

    /** 再加一层Suspense外壳，测试中间完成与内部pending独立。 */
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

    // 本例服务器会挂起；renderToString输出未完成边界及fallback，客户端必须接管该边界。
    suspend = true;
    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    expect(container.getElementsByTagName('span').length).toBe(0);

    // 在客户端，由于某种原因，我们有数据可用。
    suspend = false;
    ReactDOMClient.hydrateRoot(container, <App />, {

      /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** forwards列表A/B完整SSR但客户端都pending，先插入C；DOM立即ABC、B ref仍空，解决后ref复用原B，验证新行可见不要求原行先绑定。 */
  it('shows inserted items in a SuspenseList before content is hydrated', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();

    /** pending时抛promise，完成透传children，供列表原行解阻。 */
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

    /** forwards/visible列表使用外部稳定A/B元素并按showMore加C，避免原边界props被重新创建改变。 */
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

  /** 列表together的A待水合，添加永挂B同时解决A；A ref复用原span、DOM ALoading B，验证其它新行pending不阻止既有完成行水合。 */
  it('shows is able to hydrate boundaries even if others in a list are pending', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();

    /** 可解阻的A行children包装。 */
    function Child({children}) {
      if (suspend) {
        throw promise;
      } else {
        return children;
      }
    }

    const promise2 = new Promise(() => {});

    /** 新B行永远抛独立promise，故只能显示Loading B。 */
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

    /** together列表保留稳定A行并可添加永挂B，检验已有行水合不受新行阻塞。 */
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

  /** forwards/hidden列表A/B完整SSR，显式scheduleHydration(B)并在Before/After日志处暂停；B ref仍空但DOM AB，解决后复用B，标题clear不表示本断言删除服务端节点。 */
  it('clears server boundaries when SuspenseList runs out of time hydrating', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    const ref = React.createRef();

    /** 控制B行pending，解除后透传原span。 */
    function Child({children}) {
      if (suspend) {
        throw promise;
      } else {
        return children;
      }
    }

    /** 记录第一行进入时的render日志。 */
    function Before() {
      Scheduler.log('Before');
      return null;
    }

    /** 记录第一行边界之后的render日志，供waitFor切出。 */
    function After() {
      Scheduler.log('After');
      return null;
    }

    /** 把A完整边界夹在Before/After之间，制造同一行分段工作。 */
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

    /** 外边界中forwards/hidden列表，首FirstRow后B pending，供显式scheduleHydration优先级及ref检查。 */
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

  /** forwards/hidden最后行服务端已挂起，客户端报告未完成并显示ALoading B；解除后AB，验证fallback尾行恢复，而非完整服务端B被移除。 */
  it('clears server boundaries when SuspenseList suspends last row hydrating', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** 控制服务端最后行挂起，客户端解决后透传B节点。 */
    function Child({children}) {
      if (suspend) {
        throw promise;
      } else {
        return children;
      }
    }

    /** forwards/hidden的A已完整、B在服务器pending，覆盖尾fallback恢复。 */
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

      /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** SSR外主/嵌fallback都挂起并有外Sibling及非React注释，客户端Child已完成；局部接管后Sibling同span且仍连接、末尾注释保留，验证删除区间不波及外部节点。 */
  it('can client render nested boundaries', async () => {
    let suspend = false;
    const promise = new Promise(() => {});
    const ref = React.createRef();

    /** 服务器pending、客户端成功Hello，用于外主/内fallback均含异步组件。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    /** 外fallback含内边界及Inner Sibling，外部还有Sibling/ref；恢复区间不得删除外span或非React注释。 */
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

      /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** 两个完整兄弟Suspense各有ref，直接水合后两ref分别复用原span1/span2；验证独立边界游标恢复。 */
  it('can hydrate TWO suspense boundaries', async () => {
    const ref1 = React.createRef();
    const ref2 = React.createRef();

    /** 两独立完整边界各带自己的span ref，校验游标跳过与身份。 */
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

  /** 旧Context hello/文本Hello永远pending，新Context hi/Hi不挂起；普通更新直接新建span并绑定ref，不复用旧span，验证新输入可用时边界接管。 */
  it('regenerates if it cannot hydrate before changes to props/context expire', async () => {
    let suspend = false;
    const promise = new Promise(resolvePromise => {});
    const ref = React.createRef();
    const ClassName = React.createContext(null);

    /** 旧hello/Hello在suspend时永久挂起，新hi或Hi任一条件便不挂起；输出ref span用于检验更新接管会新建节点。 */
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

    /** 边界内Child接text，className实际由Context提供，App参数className未使用。 */
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

        /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

    // 普通优先级更新改变 Context 与文本；旧输入仍无法水合，因此边界改走客户端渲染以提交新内容。
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
    // 除文本与节点身份外，还检查 className 已按新输入更新。
    expect(newSpan.className).toBe('hi');
  });

  /** 按钮Fiber已开始水合但同边界Sibling仍pending，click不调用handler；解除提交后次数仍0且旧内容保留，验证阻塞离散click不会延迟重放。 */
  it('does not invoke an event on a hydrated node until it commits', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** Sibling在按钮后挂起，阻止同边界整体提交；text参数未消费。 */
    function Sibling({text}) {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    let clicks = 0;

    /** 点击本应设clicked并计数、返回null；测试早click不可运行该handler。 */
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

    /** 在一个边界中先Button后可能暂停Sibling，使Button协调不等于已提交。 */
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

  /** www event handle仅在客户端layout注册，水合前及部分水合各click一次；解阻提交后仍0次，验证未提交handle不运行且先前离散click未重放。 */
  it('does not invoke an event on a hydrated event handle until it commits', async () => {
    const setClick = ReactDOM.unstable_createEventHandle('click');
    let suspend = false;
    let isServerRendering = true;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** 与event handle按钮同边界的暂停点，完成返回Hello。 */
    function Sibling({text}) {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    const onEvent = jest.fn();

    /** 服务器仅ref，客户端layout才安装click handle并返回其清理；边界未提交时不注册handle。 */
    function Button() {
      const ref = React.useRef(null);
      if (!isServerRendering) {
        React.useLayoutEffect(() => {
          return setClick(ref.current, onEvent);
        });
      }
      return <a ref={ref}>Click me</a>;
    }

    /** 先handleButton后Sibling，阻止layout注册直至边界解阻。 */
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
    // 当前click被未提交边界阻塞；解阻后本例仍期望零调用，不重放离散click。
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

  /** 嵌套完整边界藏在pending Child内，水合前和部分水合各click一次；解阻后clicks仍0，标题invokes与实际断言相反，验证嵌套阻塞click未交付。 */
  it('invokes discrete events on nested suspense boundaries in a root (legacy system)', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    let clicks = 0;

    /** 普通onClick仅累计clicks，供嵌套阻塞事件零调用检查。 */
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

    /** 外Child pending前不返回内边界，解阻后才可水合Button。 */
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

    /** 外Suspense包可挂起Child，形成两级marker。 */
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
    // 当前click被未提交边界阻塞；解阻后本例仍期望零调用，不重放离散click。
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

  /** 相同嵌套结构用www createEventHandle/layout注册，两次早click均0且解阻后仍0；验证事件handle也不接收阻塞离散click。 */
  it('invokes discrete events on nested suspense boundaries in a root (createEventHandle)', async () => {
    let suspend = false;
    let isServerRendering = true;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    const onEvent = jest.fn();
    const setClick = ReactDOM.unstable_createEventHandle('click');

    /** 客户端layout注册click handle、返清理，服务器不运行该effect。 */
    function Button() {
      const ref = React.useRef(null);

      if (!isServerRendering) {
        React.useLayoutEffect(() => {
          return setClick(ref.current, onEvent);
        });
      }

      return <a ref={ref}>Click me</a>;
    }

    /** pending时不展开内handle边界，解阻后返回它。 */
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

    /** 构造外Child/内Button嵌套边界，覆盖www handle路径。 */
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
    // 当前click被未提交边界阻塞；解阻后本例仍期望零调用，不重放离散click。
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

  /** 子span click handler本应stopPropagation，父div也有click；子边界pending点击后父/子均0且解除后仍0，验证不能跳过未水合子handler只执行父监听。 */
  it('does not invoke the parent of dehydrated boundary event', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    let clicksOnParent = 0;
    let clicksOnChild = 0;

    /** 子span handler先stopPropagation再计数，证明不能绕过它直接调用父监听。 */
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

    /** 已水合外div有父click，内部Child边界pending；事件应在阻塞点停止。 */
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

  /** 父div属于已提交独立根，嵌入子根的Suspense仍pending；点击子a父click为0且解除后不重放，验证阻塞传播跨根也拦住父React监听。 */
  it('does not invoke an event on a parent tree when a subtree is dehydrated', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    let clicks = 0;
    const childSlotRef = React.createRef();

    /** 独立父根提供React onClick及child容器ref，检测子根阻塞是否穿透。 */
    function Parent() {
      return <div onClick={() => clicks++} ref={childSlotRef} />;
    }

    /** 子根pending时抛promise，完成为无click处理器的a。 */
    function Child({text}) {
      if (suspend) {
        throw promise;
      } else {
        return <a>Click me</a>;
      }
    }

    /** 子根直接以Suspense为顶层，制造跨根传播中的阻塞点。 */
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

  /** 鼠标从外div经过两个pending边界，最新目标第二span；先解决第二只触发Enter Second，后解决第一无额外事件，验证连续mouseover槽只保留最新目标。 */
  it('blocks only on the last continuous event (legacy system)', async () => {
    let suspend1 = false;
    let resolve1;
    const promise1 = new Promise(resolvePromise => (resolve1 = resolvePromise));
    let suspend2 = false;
    let resolve2;
    const promise2 = new Promise(resolvePromise => (resolve2 = resolvePromise));

    /** 第一边界由promise1控制，输出Hello在监听span之后。 */
    function First({text}) {
      if (suspend1) {
        throw promise1;
      } else {
        return 'Hello';
      }
    }

    /** 第二边界由promise2控制，World在监听span内部。 */
    function Second({text}) {
      if (suspend2) {
        throw promise2;
      } else {
        return 'World';
      }
    }

    const ops = [];

    /** 两边界都有enter/leave日志，但第一span已遍历仍不能先提交；latest mouseover只应重放最新第二目标。 */
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

  /** 稳定tree内Child pending，解除promise后先排普通Sibling插入；先Sibling/Commit日志、Child ref仍空，最后Child水合，验证普通工作先于retry继续。 */
  it('finishes normal pri work before continuing to hydrate a retry', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();

    /** 解阻后记录Child，作为低优先retry水合日志。 */
    function Child() {
      if (suspend) {
        throw promise;
      } else {
        Scheduler.log('Child');
        return 'Hello';
      }
    }

    /** 记录render与layout commit，证明Sibling已提交时Child仍未水合。 */
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

    /** 复用提升的待水合tree，只按showSibling增加普通更新兄弟，不主动改tree输入。 */
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

  /** Form已开始水合而Sibling pending，派发实际bubbles=true的submit；解阻后submits仍0、文本不变，验证离散submit不重放，标题non-bubbling未反映该输入。 */
  it('regression test: does not overfire non-bubbling browser events', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** Form后的pendingSibling阻止整边界提交。 */
    function Sibling({text}) {
      if (suspend) {
        throw promise;
      } else {
        return 'Hello';
      }
    }

    let submits = 0;

    /** submit本应更新submitted并计数、删除表单，提前阻塞事件不应触发。 */
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

    /** 完整边界中Form在前、Sibling在后，覆盖submit未提交监听器。 */
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

  /** FIXME gate禁用定义：LegacyHiddenDiv在无父Suspense下，预期水合后ref复用span、内容不变；记录待修复断言，该配置未执行。 */
  it('hydrates a hidden subtree outside of a Suspense boundary', async () => {
    const ref = React.createRef();

    /** 无父Suspense的hidden LegacyHidden fixture，当前FIXME gate不执行。 */
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

        /** 记录禁用定义的恢复错误，预期没有新增mismatch。 */
        onRecoverableError(error) {
          Scheduler.log('onRecoverableError: ' + error.message);
        },
      }),
    );

    expect(ref.current).toBe(span);
    expect(span.innerHTML).toBe('Hidden child');
  });

  // @gate www

  /** www gate下LegacyHiddenDiv hidden置于Suspense中，SSR含隐藏span；水合后ref复用span且文本不变，验证包装hidden/defer协议。 */
  it('renders a hidden LegacyHidden component inside a Suspense boundary', async () => {
    const ref = React.createRef();

    /** 用完整Suspense围住hidden LegacyHidden，使延迟树可重新进入水合。 */
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

  /** www gate下LegacyHiddenDiv visible完整SSR并水合，ref为原span且文本保持；验证可见分支。 */
  it('renders a visible LegacyHidden component', async () => {
    const ref = React.createRef();

    /** visible LegacyHidden包装span，避免隐藏延迟分支。 */
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

  /** Activity visible的SSR快照含&起止注释及Child span，水合后ref复用；验证可见边界仍有自身协议marker。 */
  it('a visible Activity component is surrounded by comment markers', async () => {
    const ref = React.createRef();

    /** visible Activity包装span，保留其起止&注释协议。 */
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

    // 可见Activity仍输出自身&起止marker；内部span可直接匹配并复用。
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

  /** 两个hidden Activity分处根兄弟与Suspense内，SSR只执行App、不含隐藏span；可见span先水合，再两轮客户端创建display:none隐藏内容，验证服务器跳过与客户端后台挂载顺序。 */
  it('a hidden Activity component is skipped over during server rendering', async () => {
    const visibleRef = React.createRef();

    /** 记录隐藏子是否执行，SSR不应进入而客户端后台应创建span。 */
    function HiddenChild() {
      Scheduler.log('HiddenChild');
      return <span>Hidden</span>;
    }

    /** 同时放可见span、根hidden Activity与Suspense内hidden Activity，比较可见水合和后台创建顺序。 */
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

    // 接着在客户端创建Suspense内另一棵hidden Activity的子节点；这些Hidden span不在SSR HTML中。
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

  /** 注册同App先SSR后act水合的通用用例，msg标出五个空输出变体；容器挂到body，本helper不单独移除它，也不手工验证节点身份。 */
  function itHydratesWithoutMismatch(msg, App) {

    /** 本地wrapper用同App做SSR与act水合，覆盖五个调用输入：空串带邻居、空串根、Fragment空串、Suspense空表达式、类内空串/Hello；无手工DOM身份断言，目标是这些空输出不触发水合错误。 */
    it('hydrates without mismatch ' + msg, async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const finalHTML = ReactDOMServer.renderToString(<App />);
      container.innerHTML = finalHTML;

      await act(() => ReactDOMClient.hydrateRoot(container, <App />));
    });
  }

  /** 输入空串逻辑表达式、前div Test和后Test文本；同fixture SSR与hydrate应匹配，检查空串不多占主机槽。 */
  itHydratesWithoutMismatch('an empty string with neighbors', /** 空串逻辑表达式与主机邻居/后续Test混合，检验空串不消耗主机水合槽。 */ function App() {
    return (
      <div>
        <div id="test">Test</div>
        {'' && <div>Test</div>}
        {'Test'}
      </div>
    );
  });

  /** 纯空串根输出先SSR再hydrate，应保持无节点且无水合错误。 */
  itHydratesWithoutMismatch('an empty string', /** 返回纯空串，SSR和水合均无可见节点。 */ function App() {
    return '';
  });
  /** Fragment内空串后跟sup文本，SSR与hydrate同序，应无文本游标错位。 */
  itHydratesWithoutMismatch(
    'an empty string simple in fragment',
    /** Fragment先空串再sup文本，检验空child不造成后续HostText错位。 */ function App() {
      return (
        <>
          {''}
          {'sup'}
        </>
      );
    },
  );
  /** Suspense内空串逻辑表达式，SSR为空边界，hydrate应匹配marker而不报差异。 */
  itHydratesWithoutMismatch(
    'an empty string simple in suspense',
    /** 缺省fallback的Suspense输出空串逻辑表达式，检验空边界marker匹配。 */ function App() {
      return <Suspense>{'' && false}</Suspense>;
    },
  );

  /** 类fixture返回div含空串Fragment及Hello Fragment，SSR与hydrate应匹配，覆盖类输出空child。 */
  itHydratesWithoutMismatch('an empty string in class component', TestAppClass);

  /** 两个Suspense之间根元素服务端div/client span不匹配且客户端两子pending；整根接管显示两个Loading与client，解决后1/client/2，验证边界外差异扩大到根。 */
  it('fallback to client render on hydration mismatch at root', async () => {
    let suspend = true;
    let resolve;
    const promise = new Promise((res, rej) => {
      /** 解除根差异例的两个客户端pending子任务，让其替换Loading。 */
      resolve = () => {
        suspend = false;
        res();
      };
    });

    /** 两个客户端可暂停边界之间把server div改client span，制造根级差异。 */
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

    /** 只在客户端且suspend时抛promise，服务端完整输出各id div。 */
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

        /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** 直接div文本SSR good/client bad；收recoverable text mismatch消息，验证直接文本优化路径也放弃水合；本例未断言新DOM身份。 */
  it("falls back to client rendering when there's a text mismatch (direct text child)", async () => {

    /** 把单一text prop直接放div中，覆盖主机直接文本路径。 */
    function DirectTextChild({text}) {
      return <div>{text}</div>;
    }
    const container = document.createElement('div');
    container.innerHTML = ReactDOMServer.renderToString(
      <DirectTextChild text="good" />,
    );
    await act(() => {
      ReactDOMClient.hydrateRoot(container, <DirectTextChild text="bad" />, {

        /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** div包含Sibling文本及good/bad第二文本；同样收text mismatch，覆盖多个HostText槽路径，与直接textContent路径区分。 */
  it("falls back to client rendering when there's a text mismatch (text child with siblings)", async () => {

    /** 固定Sibling文本，保证后面的动态文本不是唯一child。 */
    function Sibling() {
      return 'Sibling';
    }

    /** 先Sibling再text prop，制造分离HostText槽的水合差异。 */
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

          /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** 外父边界因Sibling resuspend隐藏内未水合边界，span display:none且前HostText清空、ref仍空；解除后文本/样式恢复、ref指原span，验证临时隐藏不是删除。 */
  it('hides a dehydrated suspense boundary if the parent resuspends', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const ref = React.createRef();

    /** 内边界Child受共享promise控制，完成返回text。 */
    function Child({text}) {
      if (suspend) {
        throw promise;
      } else {
        return text;
      }
    }

    /** resuspend且pending时抛promise，否则null；从外层触发重新暂停而不改内组件props。 */
    function Sibling({resuspend}) {
      if (suspend && resuspend) {
        throw promise;
      } else {
        return null;
      }
    }

    /** 内缺省fallback边界含异步text与World ref，保留待水合DOM供父隐藏。 */
    function Component({text}) {
      return (
        <Suspense>
          <Child text={text} />
          <span ref={ref}>World</span>
        </Suspense>
      );
    }

    /** memoize内Component仅依text变化，Sibling按resuspend决定父挂起，使内树输入稳定。 */
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

      /** 记录本边界恢复错误的首句，并在有cause时另记录原原因；用日志区分重建恢复与仍挂起未提交。 */
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

  /** 手工<label>value</label>水合lazy child在初始化后立即解决为字符串；无recoverable且HTML完全相同，回归检查HostComponent内重播游标。 */
  it('Can hydrate even when lazy content resumes immediately inside a HostComponent', async () => {
    let resolve;
    const promise = new Promise(r => {
      /** 解决lazy模块为default字符串value，使主机child路径立即重播。 */
      resolve = () => r({default: 'value'});
    });

    const lazyContent = React.lazy(() => {
      Scheduler.log('Lazy initializer called');
      return promise;
    });

    /** 主机label以lazy对象为child；这是懒child解为字符串，非懒组件type。 */
    function App() {
      return <label>{lazyContent}</label>;
    }

    // 服务器端渲染 HTML
    const container = document.createElement('div');
    container.innerHTML = '<label>value</label>';

    const hydrationErrors = [];

    React.startTransition(() => {
      ReactDOMClient.hydrateRoot(container, <App />, {

        /** 将lazy立即恢复期间的recoverable message保存到hydrationErrors；回归期望为空，console调试日志不是成功判据。 */
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

  /** 手工document body含div value，lazy立即解决为div元素；整文档水合无错误且html/head/body完整，覆盖HostSingleton游标。 */
  it('Can hydrate even when lazy content resumes immediately inside a HostSingleton', async () => {
    let resolve;
    const promise = new Promise(r => {
      /** 解决lazy模块为default div元素，恢复文档body游标。 */
      resolve = () => r({default: <div>value</div>});
    });

    const lazyContent = React.lazy(() => {
      Scheduler.log('Lazy initializer called');
      return promise;
    });

    /** html/body singleton树以内联lazy对象为body child，解为div元素。 */
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

        /** 将lazy立即恢复期间的recoverable message保存到hydrationErrors；回归期望为空，console调试日志不是成功判据。 */
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

  /** 手工完整Suspense注释包value，lazy即解字符串；水合无错误、marker保留，卸载后只余起止marker，验证恢复及删除边界范围。 */
  it('Can hydrate even when lazy content resumes immediately inside a Suspense', async () => {
    let resolve;
    const promise = new Promise(r => {
      /** 解决lazy模块为字符串value，恢复完整Suspense游标。 */
      resolve = () => r({default: 'value'});
    });

    const lazyContent = React.lazy(() => {
      Scheduler.log('Lazy initializer called');
      return promise;
    });

    /** 完整Suspense内的lazy child，检查恢复后边界marker保留。 */
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

        /** 将lazy立即恢复期间的recoverable message保存到hydrationErrors；回归期望为空，console调试日志不是成功判据。 */
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

  /** 手工Activity注释包value，lazy即解；水合无错误，卸载仅保留marker，覆盖Activity重播游标与删除。 */
  it('Can hydrate even when lazy content resumes immediately inside an Activity', async () => {
    let resolve;
    const promise = new Promise(r => {
      /** 解决lazy模块为字符串value，恢复Activity游标。 */
      resolve = () => r({default: 'value'});
    });

    const lazyContent = React.lazy(() => {
      Scheduler.log('Lazy initializer called');
      return promise;
    });

    /** visible Activity内lazy child，检查&marker游标及卸载范围。 */
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

        /** 将lazy立即恢复期间的recoverable message保存到hydrationErrors；回归期望为空，console调试日志不是成功判据。 */
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

  /** 服务器内边界文本a，客户端挂载effect普通更新增加pending Sibling且改内文本b；解阻后两节点存在、可见且content b，回归检查外边界再次暂停时内待水合输入变更能恢复。 */
  it('recovers when an update changes a dehydrated boundary inside a suspended parent boundary', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** pending时抛promise，完成输出带sibling id的span。 */
    function Sibling() {
      if (suspend) {
        throw promise;
      }
      return <span id="sibling">Sibling</span>;
    }

    /** 挂载effect用普通state更新同时增加Sibling与改内边界a→b；内边界props在父暂停时仍必须保留更新。 */
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

  /** 相同场景改为startTransition effect更新；解阻后Sibling/content均可见且b，覆盖过渡与内待水合边界交叠，未额外断言pending时的可见UI。 */
  it('recovers when a transition changes a dehydrated boundary inside a suspended parent boundary', async () => {
    // 同上测试。 除了更新被包裹在 startTransition 中。
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** 同样的pending Sibling，供transition交叠路径。 */
    function Sibling() {
      if (suspend) {
        throw promise;
      }
      return <span id="sibling">Sibling</span>;
    }

    /** 挂载effect以startTransition增加Sibling并改内文本，随后解阻应可恢复新内容。 */
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
