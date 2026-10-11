/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

import {createEventTarget} from 'dom-event-testing-library';

let React;
let ReactDOM;
let ReactDOMClient;
let ReactDOMServer;
let ReactFeatureFlags;
let Scheduler;
let Suspense;
let act;
let assertLog;
let waitForAll;
let waitFor;
let waitForPaint;

let IdleEventPriority;
let ContinuousEventPriority;

/**
 * 模拟从 from 到 to 的鼠标跨节点移动：先向 from 派发 mouseout（relatedTarget=to），再向 to 派发 mouseover（relatedTarget=from）；空端点代表窗口外。无返回值，供连续事件捕获/重放测试控制目标路径。
 */
function dispatchMouseHoverEvent(to, from) {
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

/**
 * 向 target 派发可冒泡、可取消的 click，返回 dispatchEvent 的布尔值；false 表示水合后 handler 已 preventDefault，true 并不代表 handler 已执行。
 */
function dispatchClickEvent(target) {
  const mouseOutEvent = document.createEvent('MouseEvents');
  mouseOutEvent.initMouseEvent(
    'click',
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
    target,
  );
  return target.dispatchEvent(mouseOutEvent);
}

// 用 unstable_runWithPriority 指定 IdleEventPriority，并暂时把 window.event 设为 message，
// 避免沿用外部事件的优先级。finally 恢复原事件。

/**
 * 在 IdleEventPriority 下调用 fn，临时 window.event=message 避免继承外部原生事件优先级；finally 恢复旧事件，即使 fn 抛错也不泄漏全局环境；不转发 fn 返回值。
 */
function TODO_scheduleIdleDOMSchedulerTask(fn) {
  ReactDOM.unstable_runWithPriority(IdleEventPriority, () => {
    const prevEvent = window.event;
    window.event = {type: 'message'};
    try {
      fn();
    } finally {
      window.event = prevEvent;
    }
  });
}

/**
 * 在 ContinuousEventPriority 下执行 fn，临时设置 message 事件以隔离优先级推断；finally 恢复 window.event，callback 异常继续传播，不转发返回值。
 */
function TODO_scheduleContinuousSchedulerTask(fn) {
  ReactDOM.unstable_runWithPriority(ContinuousEventPriority, () => {
    const prevEvent = window.event;
    window.event = {type: 'message'};
    try {
      fn();
    } finally {
      window.event = prevEvent;
    }
  });
}

describe('ReactDOMServerSelectiveHydration', () => {
  beforeEach(() => {
    jest.resetModules();

    ReactFeatureFlags = require('shared/ReactFeatureFlags');
    ReactFeatureFlags.enableCreateEventHandleAPI = true;
    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    act = require('internal-test-utils').act;
    Scheduler = require('scheduler');
    Suspense = React.Suspense;

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;
    waitForAll = InternalTestUtils.waitForAll;
    waitFor = InternalTestUtils.waitFor;
    waitForPaint = InternalTestUtils.waitForPaint;

    IdleEventPriority = require('react-reconciler/constants').IdleEventPriority;
    ContinuousEventPriority =
      require('react-reconciler/constants').ContinuousEventPriority;
  });

  /**
   * SSR 已输出 A/B，hydrateRoot 尚未执行客户端 render；点击 B 同步水合 App/B 并调用 preventDefault，dispatchEvent 返回 false；随后才水合 A，证明离散事件先恢复目标路径。
   */
  it('hydrates the target boundary synchronously during a click', async () => {

    /**
     * text 标识 server span 与 render 日志；成功时返回带 click handler 的 span，handler 接收事件后 preventDefault 并记 Clicked，使 dispatchEvent 返回值与日志可验证目标是否已水合。
     */
    function Child({text}) {
      Scheduler.log(text);
      return (
        <span
          onClick={e => {
            e.preventDefault();
            Scheduler.log('Clicked ' + text);
          }}>
          {text}
        </span>
      );
    }

    /**
     * 记录 App 并返回独立 A/B 边界；固定 server 顺序让点击 B 的 App/B/A 日志证明目标边界优先且 A 不必同步完成。
     */
    function App() {
      Scheduler.log('App');
      return (
        <div>
          <Suspense fallback="Loading...">
            <Child text="A" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="B" />
          </Suspense>
        </div>
      );
    }

    const finalHTML = ReactDOMServer.renderToString(<App />);

    assertLog(['App', 'A', 'B']);

    const container = document.createElement('div');
    // 我们需要将其放在文档中，因为我们将在此处触发事件。
    document.body.appendChild(container);

    container.innerHTML = finalHTML;

    const span = container.getElementsByTagName('span')[1];

    ReactDOMClient.hydrateRoot(container, <App />);

    // 目前没有任何内容完成水合。
    assertLog([]);

    // 这应同步水合根 App 和第二个 Suspense 边界。
    const result = dispatchClickEvent(span);

    // 由于调用了 preventDefault，事件应已被取消。
    expect(result).toBe(false);

    // 我们渲染了 App、B，然后没有渲染 A，就触发了事件。
    assertLog(['App', 'B', 'Clicked B']);

    // 继续运行调度器后，最终水合 A。
    await waitForAll(['A']);

    document.body.removeChild(container);
  });

  /**
   * SSR 有 A/B/C/D，客户端 A/D 被同一 Promise 阻塞；点击 D 未取消事件，先水合 B/C；解除 Promise 后日志 D→A，没有 Clicked D，证明提高 retry 优先级不会把阻塞 click 存成重放事件。
   */
  it('hydrates at higher pri if sync did not work first time', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /**
     * text 标识 server span 与 render 日志；A/D 在 suspend 开关开启时抛共享 Promise；成功时返回带 click handler 的 span，handler 接收事件后 preventDefault 并记 Clicked，使 dispatchEvent 返回值与日志可验证目标是否已水合。
     */
    function Child({text}) {
      if ((text === 'A' || text === 'D') && suspend) {
        throw promise;
      }
      Scheduler.log(text);
      return (
        <span
          onClick={e => {
            e.preventDefault();
            Scheduler.log('Clicked ' + text);
          }}>
          {text}
        </span>
      );
    }

    /**
     * 记录 App 并返回四个独立 Suspense，children 按 A/B/C/D 固定排列；客户端 A/D 可挂起，因此日志能区分事件目标优先与原 sibling 顺序。
     */
    function App() {
      Scheduler.log('App');
      return (
        <div>
          <Suspense fallback="Loading...">
            <Child text="A" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="B" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="C" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="D" />
          </Suspense>
        </div>
      );
    }

    const finalHTML = ReactDOMServer.renderToString(<App />);

    assertLog(['App', 'A', 'B', 'C', 'D']);

    const container = document.createElement('div');
    // 我们需要将其放在文档中，因为我们将在此处触发事件。
    document.body.appendChild(container);

    container.innerHTML = finalHTML;

    const spanD = container.getElementsByTagName('span')[3];

    suspend = true;

    // A 和 D 会挂起。我们将点击 D；解除挂起后，D 应获得更高优先级。
    ReactDOMClient.hydrateRoot(container, <App />);

    // 目前没有任何内容完成水合。
    assertLog([]);

    // 点击目标仍处于挂起状态，因此尚无法水合。
    await act(() => {
      const result = dispatchClickEvent(spanD);
      expect(result).toBe(true);
    });
    assertLog([
      'App',
      // 继续渲染将渲染 B。
      'B',
      'C',
    ]);

    await act(async () => {
      suspend = false;
      resolve();
      await promise;
    });

    assertLog(['D', 'A']);

    document.body.removeChild(container);
  });

  /**
   * 客户端 A/D 阻塞，依次点击 A/C/D；C 当场水合并执行 Clicked C，解除数据后 A→D→B；日志证明多个离散目标提升重试优先级而未点击 B 最后执行。
   */
  it('hydrates at higher pri for secondary discrete events', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /**
     * text 标识 server span 与 render 日志；A/D 在 suspend 开关开启时抛共享 Promise；成功时返回带 click handler 的 span，handler 接收事件后 preventDefault 并记 Clicked，使 dispatchEvent 返回值与日志可验证目标是否已水合。
     */
    function Child({text}) {
      if ((text === 'A' || text === 'D') && suspend) {
        throw promise;
      }
      Scheduler.log(text);
      return (
        <span
          onClick={e => {
            e.preventDefault();
            Scheduler.log('Clicked ' + text);
          }}>
          {text}
        </span>
      );
    }

    /**
     * 记录 App 并返回四个独立 Suspense，children 按 A/B/C/D 固定排列；客户端 A/D 可挂起，因此日志能区分事件目标优先与原 sibling 顺序。
     */
    function App() {
      Scheduler.log('App');
      return (
        <div>
          <Suspense fallback="Loading...">
            <Child text="A" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="B" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="C" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="D" />
          </Suspense>
        </div>
      );
    }

    const finalHTML = ReactDOMServer.renderToString(<App />);

    assertLog(['App', 'A', 'B', 'C', 'D']);

    const container = document.createElement('div');
    // 我们需要将其放在文档中，因为我们将在此处触发事件。
    document.body.appendChild(container);

    container.innerHTML = finalHTML;

    const spanA = container.getElementsByTagName('span')[0];
    const spanC = container.getElementsByTagName('span')[2];
    const spanD = container.getElementsByTagName('span')[3];

    suspend = true;

    // A 和 D 会挂起。我们将点击 D；解除挂起后，D 应获得更高优先级。
    ReactDOMClient.hydrateRoot(container, <App />);

    // 目前没有任何内容完成水合。
    assertLog([]);

    // 由于第一个边界处于挂起状态，当前点击目标尚无法水合。
    dispatchClickEvent(spanA);
    dispatchClickEvent(spanC);
    dispatchClickEvent(spanD);

    assertLog(['App', 'C', 'Clicked C']);

    await act(async () => {
      suspend = false;
      resolve();
      await promise;
    });

    assertLog([
      'A',
      'D',
      // B 应该最后渲染，因为它没有被点击。
      'B',
    ]);

    document.body.removeChild(container);
  });
  /**
   * www gate 下用 createEventHandle 在 layout 注册 click；SSR A/B 后点击 B，日志 App/B/Clicked B，随后 A；目标水合提交时即可安装监听并处理当前事件，effect 返回解除订阅函数。
   */

  // @gate www

  it('hydrates the target boundary synchronously during a click (createEventHandle)', async () => {
    const setClick = ReactDOM.unstable_createEventHandle('click');
    let isServerRendering = true;

    /**
     * 返回带 ref 的 text span，仅客户端通过 layout effect 对 DOM 注册 setClick，返回解除监听函数作为清理；render 日志与 Clicked 日志区分认领和当前离散事件执行。
     */
    function Child({text}) {
      const ref = React.useRef(null);
      Scheduler.log(text);
      if (!isServerRendering) {
        React.useLayoutEffect(() => {
          return setClick(ref.current, () => {
            Scheduler.log('Clicked ' + text);
          });
        });
      }

      return <span ref={ref}>{text}</span>;
    }

    /**
     * 记录 App 并返回独立 A/B 边界；固定 server 顺序让点击 B 的 App/B/A 日志证明目标边界优先且 A 不必同步完成。
     */
    function App() {
      Scheduler.log('App');
      return (
        <div>
          <Suspense fallback="Loading...">
            <Child text="A" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="B" />
          </Suspense>
        </div>
      );
    }

    const finalHTML = ReactDOMServer.renderToString(<App />);

    assertLog(['App', 'A', 'B']);

    const container = document.createElement('div');
    // 我们需要将其放在文档中，因为我们将在此处触发事件。
    document.body.appendChild(container);

    container.innerHTML = finalHTML;

    isServerRendering = false;

    ReactDOMClient.hydrateRoot(container, <App />);

    // 目前没有任何内容完成水合。
    assertLog([]);

    const span = container.getElementsByTagName('span')[1];

    const target = createEventTarget(span);

    // 这应同步水合根 App 和第二个 Suspense 边界。
    target.virtualclick();

    // 我们渲染了 App、B，然后没有渲染 A，就触发了事件。
    assertLog(['App', 'B', 'Clicked B']);

    // 继续运行调度器后，最终水合 A。
    await waitForAll(['A']);

    document.body.removeChild(container);
  });
  /**
   * createEventHandle 版本 A/D 阻塞时点击 D；先 App/B/C，解除 Promise 后 D→A 且无 Clicked D；验证失败同步水合只提升 retry 优先级，不重放离散事件。
   */

  // @gate www

  it('hydrates at higher pri if sync did not work first time (createEventHandle)', async () => {
    let suspend = false;
    let isServerRendering = true;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const setClick = ReactDOM.unstable_createEventHandle('click');

    /**
     * 返回带 ref 的 text span，A/D 在 suspend 时抛共享 Promise；仅客户端通过 layout effect 对 DOM 注册 setClick，返回解除监听函数作为清理；render 日志与 Clicked 日志区分认领和当前离散事件执行。
     */
    function Child({text}) {
      const ref = React.useRef(null);
      if ((text === 'A' || text === 'D') && suspend) {
        throw promise;
      }
      Scheduler.log(text);

      if (!isServerRendering) {
        React.useLayoutEffect(() => {
          return setClick(ref.current, () => {
            Scheduler.log('Clicked ' + text);
          });
        });
      }

      return <span ref={ref}>{text}</span>;
    }

    /**
     * 记录 App 并返回四个独立 Suspense，children 按 A/B/C/D 固定排列；客户端 A/D 可挂起，因此日志能区分事件目标优先与原 sibling 顺序。
     */
    function App() {
      Scheduler.log('App');
      return (
        <div>
          <Suspense fallback="Loading...">
            <Child text="A" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="B" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="C" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="D" />
          </Suspense>
        </div>
      );
    }

    const finalHTML = ReactDOMServer.renderToString(<App />);

    assertLog(['App', 'A', 'B', 'C', 'D']);

    const container = document.createElement('div');
    // 我们需要将其放在文档中，因为我们将在此处触发事件。
    document.body.appendChild(container);

    container.innerHTML = finalHTML;

    const spanD = container.getElementsByTagName('span')[3];

    suspend = true;
    isServerRendering = false;

    // A 和 D 会挂起。我们将点击 D；解除挂起后，D 应获得更高优先级。
    ReactDOMClient.hydrateRoot(container, <App />);

    // 目前没有任何内容完成水合。
    assertLog([]);

    // 继续渲染将渲染 B。
    await act(() => {
      const target = createEventTarget(spanD);
      target.virtualclick();
    });
    assertLog(['App', 'B', 'C']);

    // 解除阻塞后先重试被点击的 D，再处理 A；此前已完成 B/C，阻塞的 click 不重放。
    await act(async () => {
      suspend = false;
      resolve();
      await promise;
    });

    // 没有重播
    assertLog(['D', 'A']);

    document.body.removeChild(container);
  });
  /**
   * createEventHandle 版本依次点击阻塞 A、可水合 C、阻塞 D；先 App/C/Clicked C，解除后 A/D/B；目标优先级同样不受监听注册方式改变。
   */

  // @gate www

  it('hydrates at higher pri for secondary discrete events (createEventHandle)', async () => {
    const setClick = ReactDOM.unstable_createEventHandle('click');
    let suspend = false;
    let isServerRendering = true;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /**
     * 返回带 ref 的 text span，A/D 在 suspend 时抛共享 Promise；仅客户端通过 layout effect 对 DOM 注册 setClick，返回解除监听函数作为清理；render 日志与 Clicked 日志区分认领和当前离散事件执行。
     */
    function Child({text}) {
      const ref = React.useRef(null);
      if ((text === 'A' || text === 'D') && suspend) {
        throw promise;
      }
      Scheduler.log(text);

      if (!isServerRendering) {
        React.useLayoutEffect(() => {
          return setClick(ref.current, () => {
            Scheduler.log('Clicked ' + text);
          });
        });
      }
      return <span ref={ref}>{text}</span>;
    }

    /**
     * 记录 App 并返回四个独立 Suspense，children 按 A/B/C/D 固定排列；客户端 A/D 可挂起，因此日志能区分事件目标优先与原 sibling 顺序。
     */
    function App() {
      Scheduler.log('App');
      return (
        <div>
          <Suspense fallback="Loading...">
            <Child text="A" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="B" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="C" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="D" />
          </Suspense>
        </div>
      );
    }

    const finalHTML = ReactDOMServer.renderToString(<App />);

    assertLog(['App', 'A', 'B', 'C', 'D']);

    const container = document.createElement('div');
    // 我们需要将其放在文档中，因为我们将在此处触发事件。
    document.body.appendChild(container);

    container.innerHTML = finalHTML;

    const spanA = container.getElementsByTagName('span')[0];
    const spanC = container.getElementsByTagName('span')[2];
    const spanD = container.getElementsByTagName('span')[3];

    suspend = true;
    isServerRendering = false;

    // A 和 D 会挂起。我们将点击 D；解除挂起后，D 应获得更高优先级。
    ReactDOMClient.hydrateRoot(container, <App />);

    // 目前没有任何内容完成水合。
    assertLog([]);

    // 由于第一个边界处于挂起状态，当前点击目标尚无法水合。
    createEventTarget(spanA).virtualclick();
    createEventTarget(spanC).virtualclick();
    createEventTarget(spanD).virtualclick();

    assertLog(['App', 'C', 'Clicked C']);

    await act(async () => {
      suspend = false;
      resolve();
      await promise;
    });

    assertLog([
      'A',
      'D',
      // B 应该最后渲染，因为它没有被点击。
      'B',
    ]);

    document.body.removeChild(container);
  });

  /**
   * SSR 四边界，客户端 A/D 阻塞；hover/click D 后依次 hover B/C，解除后 D/B/C/Hover C/A；只重放最后 hover 的进入事件，阻塞 click 不重放，当前日志也保留此前提升的 B 工作。
   */
  it('hydrates the hovered targets as higher priority for continuous events', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /**
     * text 标识 A/B/C/D；A/D 在客户端开关开启时抛共享 Promise，否则返回 span；click 和 mouseEnter 均取消默认行为并记日志，以区别同步 click 处理与最后 hover 的重放。
     */
    function Child({text}) {
      if ((text === 'A' || text === 'D') && suspend) {
        throw promise;
      }
      Scheduler.log(text);
      return (
        <span
          onClick={e => {
            e.preventDefault();
            Scheduler.log('Clicked ' + text);
          }}
          onMouseEnter={e => {
            e.preventDefault();
            Scheduler.log('Hover ' + text);
          }}>
          {text}
        </span>
      );
    }

    /**
     * 记录 App 并返回四个独立 Suspense，children 按 A/B/C/D 固定排列；客户端 A/D 可挂起，因此日志能区分事件目标优先与原 sibling 顺序。
     */
    function App() {
      Scheduler.log('App');
      return (
        <div>
          <Suspense fallback="Loading...">
            <Child text="A" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="B" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="C" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="D" />
          </Suspense>
        </div>
      );
    }
    const finalHTML = ReactDOMServer.renderToString(<App />);
    assertLog(['App', 'A', 'B', 'C', 'D']);
    const container = document.createElement('div');
    // 我们需要将其放在文档中，因为我们将在此处触发事件。
    document.body.appendChild(container);

    container.innerHTML = finalHTML;

    const spanB = container.getElementsByTagName('span')[1];
    const spanC = container.getElementsByTagName('span')[2];
    const spanD = container.getElementsByTagName('span')[3];

    suspend = true;

    // A 和 D 会挂起。我们将点击 D；解除挂起后，D 应获得更高优先级。
    ReactDOMClient.hydrateRoot(container, <App />);

    // 目前没有任何内容完成水合。
    assertLog([]);

    await act(() => {
      // 点击 D。
      dispatchMouseHoverEvent(spanD, null);
      dispatchClickEvent(spanD);

      // 依次将鼠标悬停到 B 和 C。
      dispatchMouseHoverEvent(spanB, spanD);
      dispatchMouseHoverEvent(spanC, spanB);

      assertLog(['App']);

      suspend = false;
      resolve();
    });

    // 因为点击了 D，应优先水合 D；但事件不会重播。
    assertLog([
      'D',
      'B', // 理想情况下，这一步应更晚发生。
      'C',
      'Hover C',
      'A',
    ]);

    document.body.removeChild(container);
  });

  /**
   * 在嵌套 DOM 注册 capture、bubble、enter/out，客户端 A/D 阻塞；hover/click D 后移至 B/C，解除后只重放父/C mouseover capture；C stopPropagation 阻止更深 capture 和 bubble，再次移入也断言 B out capture 阻止 enter。
   */
  it('replays capture phase for continuous events and respects stopPropagation', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /**
     * 按 text 返回带嵌套 div 的 span，A/D 可抛共享 Promise；over/out capture 会 stopPropagation，其余监听只记日志与 preventDefault，用来验证重放 capture 路径及深层传播被阻断。
     */
    function Child({text}) {
      if ((text === 'A' || text === 'D') && suspend) {
        throw promise;
      }
      Scheduler.log(text);
      return (
        <span
          id={text}
          onClickCapture={e => {
            e.preventDefault();
            Scheduler.log('Capture Clicked ' + text);
          }}
          onClick={e => {
            e.preventDefault();
            Scheduler.log('Clicked ' + text);
          }}
          onMouseEnter={e => {
            e.preventDefault();
            Scheduler.log('Mouse Enter ' + text);
          }}
          onMouseOut={e => {
            e.preventDefault();
            Scheduler.log('Mouse Out ' + text);
          }}
          onMouseOutCapture={e => {
            e.preventDefault();
            e.stopPropagation();
            Scheduler.log('Mouse Out Capture ' + text);
          }}
          onMouseOverCapture={e => {
            e.preventDefault();
            e.stopPropagation();
            Scheduler.log('Mouse Over Capture ' + text);
          }}
          onMouseOver={e => {
            e.preventDefault();
            Scheduler.log('Mouse Over ' + text);
          }}>
          <div
            onMouseOverCapture={e => {
              e.preventDefault();
              Scheduler.log('Mouse Over Capture Inner ' + text);
            }}>
            {text}
          </div>
        </span>
      );
    }

    /**
     * 记录 App 并返回四个独立 Suspense，children 按 A/B/C/D 固定排列；客户端 A/D 可挂起，因此日志能区分事件目标优先与原 sibling 顺序。 父 capture handler 另记事件路径，配合 Child 的 stopPropagation 断言。
     */
    function App() {
      Scheduler.log('App');
      return (
        <div
          onClickCapture={e => {
            e.preventDefault();
            Scheduler.log('Capture Clicked Parent');
          }}
          onMouseOverCapture={e => {
            Scheduler.log('Mouse Over Capture Parent');
          }}>
          <Suspense fallback="Loading...">
            <Child text="A" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="B" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="C" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="D" />
          </Suspense>
        </div>
      );
    }

    const finalHTML = ReactDOMServer.renderToString(<App />);

    assertLog(['App', 'A', 'B', 'C', 'D']);

    const container = document.createElement('div');
    // 我们需要将其放在文档中，因为我们将在此处触发事件。
    document.body.appendChild(container);

    container.innerHTML = finalHTML;

    const spanB = document.getElementById('B').firstChild;
    const spanC = document.getElementById('C').firstChild;
    const spanD = document.getElementById('D').firstChild;

    suspend = true;

    // A 和 D 会挂起。我们将点击 D；解除挂起后，D 应获得更高优先级。
    ReactDOMClient.hydrateRoot(container, <App />);

    // 目前没有任何内容完成水合。
    assertLog([]);

    await act(async () => {
      // 点击 D。
      dispatchMouseHoverEvent(spanD, null);
      dispatchClickEvent(spanD);
      // 依次将鼠标悬停到 B 和 C。
      dispatchMouseHoverEvent(spanB, spanD);
      dispatchMouseHoverEvent(spanC, spanB);

      assertLog(['App']);

      suspend = false;
      resolve();
    });

    // 因为点击了 D，应优先水合 D；但事件不会重播。
    assertLog([
      'D',
      'B', // 理想情况下，这一步应更晚发生。
      'C',
      // mouseout 事件不重播：'Mouse Out Capture B'、'Mouse Out B'。
      'Mouse Over Capture Parent',
      'Mouse Over Capture C',
      // stopPropagation 会阻止这些事件：'Mouse Over Capture Inner C'、'Mouse Over C'。
      'A',
    ]);

    // 此测试展示一个现有怪异行为：在 mouseout 上调用 stopPropagation 会阻止 mouseEnter 触发。
    dispatchMouseHoverEvent(spanC, spanB);
    assertLog([
      'Mouse Out Capture B',
      // stopPropagation 会阻止这些事件：'Mouse Out B'、'Mouse Enter C'。
      'Mouse Over Capture Parent',
      'Mouse Over Capture C',
      // stopPropagation 会阻止这些事件：'Mouse Over Capture Inner C'、'Mouse Over C'。
    ]);

    document.body.removeChild(container);
  });

  describe('can handle replaying events as part of multiple instances of React', () => {
    let resolveInner;
    let resolveOuter;
    let innerPromise;
    let outerPromise;
    let OuterScheduler;
    let InnerScheduler;
    let innerDiv;

    let OuterTestUtils;
    let InnerTestUtils;

    beforeEach(async () => {
      document.body.innerHTML = '';
      jest.resetModules();
      let OuterReactDOMClient;
      let InnerReactDOMClient;

      jest.isolateModules(() => {
        OuterReactDOMClient = require('react-dom/client');
        OuterScheduler = require('scheduler');
        OuterTestUtils = require('internal-test-utils');
      });
      jest.isolateModules(() => {
        InnerReactDOMClient = require('react-dom/client');
        InnerScheduler = require('scheduler');
        InnerTestUtils = require('internal-test-utils');
      });

      expect(OuterReactDOMClient).not.toBe(InnerReactDOMClient);
      expect(OuterScheduler).not.toBe(InnerScheduler);

      const outerContainer = document.createElement('div');
      const innerContainer = document.createElement('div');

      let suspendOuter = false;
      outerPromise = new Promise(res => {
        /**
         * 解除外 renderer 的 suspendOuter 后 resolve outerPromise；顺序使重试读取开关时已经可继续，不返回 renderer 的冲刷结果。
         */
        resolveOuter = () => {
          suspendOuter = false;
          res();
        };
      });

      /**
       * 外 renderer 的故障组件：suspendOuter 时记日志并抛 outerPromise；否则返回 inner-root div，保留已存在的内部 HTML，避免外水合破坏内 renderer 的 DOM，enter 日志写入公共 Scheduler。
       */
      function Outer() {
        if (suspendOuter) {
          OuterScheduler.log('Suspend Outer');
          throw outerPromise;
        }
        OuterScheduler.log('Outer');
        const innerRoot = outerContainer.querySelector('#inner-root');
        return (
          <div
            id="inner-root"
            onMouseEnter={() => {
              Scheduler.log('Outer Mouse Enter');
            }}
            dangerouslySetInnerHTML={{
              __html: innerRoot ? innerRoot.innerHTML : '',
            }}
          />
        );
      }

      /**
       * 以 Suspense 包住 Outer，返回外 renderer 的水合边界；回退为 Loading div，外 Promise 不影响独立内 Scheduler 的状态。
       */
      const OuterApp = () => {
        return (
          <Suspense fallback={<div>Loading</div>}>
            <Outer />
          </Suspense>
        );
      };

      let suspendInner = false;
      innerPromise = new Promise(res => {
        /**
         * 先清除 suspendInner 再 resolve innerPromise，让内 renderer 重试可成功；与外 resolver 分开操控两个水合完成顺序。
         */
        resolveInner = () => {
          suspendInner = false;
          res();
        };
      });

      /**
       * 内 renderer 的故障组件：suspendInner 时抛 innerPromise，否则返回 inner div；render 写 InnerScheduler，enter 写公共 Scheduler，以区别水合进度与跨根事件顺序。
       */
      function Inner() {
        if (suspendInner) {
          InnerScheduler.log('Suspend Inner');
          throw innerPromise;
        }
        InnerScheduler.log('Inner');
        return (
          <div
            id="inner"
            onMouseEnter={() => {
              Scheduler.log('Inner Mouse Enter');
            }}
          />
        );
      }

      /**
       * 返回以 Loading div 为回退的内 Suspense 边界；它的 blocker 与外实例独立，重放仍需完整 DOM 祖先路径解除阻塞。
       */
      const InnerApp = () => {
        return (
          <Suspense fallback={<div>Loading</div>}>
            <Inner />
          </Suspense>
        );
      };

      document.body.appendChild(outerContainer);
      const outerHTML = ReactDOMServer.renderToString(<OuterApp />);
      outerContainer.innerHTML = outerHTML;

      const innerWrapper = document.querySelector('#inner-root');
      innerWrapper.appendChild(innerContainer);
      const innerHTML = ReactDOMServer.renderToString(<InnerApp />);
      innerContainer.innerHTML = innerHTML;

      OuterTestUtils.assertLog(['Outer']);
      InnerTestUtils.assertLog(['Inner']);

      suspendOuter = true;
      suspendInner = true;

      await OuterTestUtils.act(() =>
        OuterReactDOMClient.hydrateRoot(outerContainer, <OuterApp />),
      );
      await InnerTestUtils.act(() =>
        InnerReactDOMClient.hydrateRoot(innerContainer, <InnerApp />),
      );

      OuterTestUtils.assertLog(['Suspend Outer']);
      InnerTestUtils.assertLog(['Suspend Inner']);

      innerDiv = document.querySelector('#inner');

      dispatchClickEvent(innerDiv);

      await act(() => {
        jest.runAllTimers();
        Scheduler.unstable_flushAllWithoutAsserting();
        OuterScheduler.unstable_flushAllWithoutAsserting();
        InnerScheduler.unstable_flushAllWithoutAsserting();
      });

      OuterTestUtils.assertLog(['Suspend Outer']);

      // 事件被挂起组件阻塞，因此 OuterApp 在捕获阶段调用 stopPropagation，InnerApp 看不到该事件。
      InnerTestUtils.assertLog([]);

      assertLog([]);
    });
    afterEach(async () => {
      document.body.innerHTML = '';
    });

    /**
     * 两个隔离 ReactDOM/Scheduler 实例都阻塞，先解除 Inner，再解除 Outer；两者可各自水合，但 hover 必须等整个目标路径可交互才重放，最终 Inner Mouse Enter→Outer Mouse Enter。
     */
    it('Inner hydrates first then Outer', async () => {
      dispatchMouseHoverEvent(innerDiv);

      await InnerTestUtils.act(async () => {
        await OuterTestUtils.act(() => {
          resolveInner();
        });
      });

      OuterTestUtils.assertLog(['Suspend Outer']);
      // Inner App 因解除阻塞而渲染。
      InnerTestUtils.assertLog(['Inner']);
      // 还没有事件被重播。
      assertLog([]);

      dispatchMouseHoverEvent(innerDiv);
      OuterTestUtils.assertLog([]);
      InnerTestUtils.assertLog([]);
      // 还没有事件被重播。
      assertLog([]);

      await InnerTestUtils.act(async () => {
        await OuterTestUtils.act(() => {
          resolveOuter();

          // 内层 App 尚无变化，因为它正等待外层 App 重播事件。
          InnerTestUtils.assertLog([]);
          // 外层完成水合并调度重播。
          OuterTestUtils.waitFor(['Outer']);
          // 还没有事件被重播。
          assertLog([]);
        });
      });

      // 执行已经调度的事件重放：先触发内层 Mouse Enter，再触发外层 Mouse Enter。
      assertLog(['Inner Mouse Enter', 'Outer Mouse Enter']);
    });

    /**
     * 同样两份隔离 renderer，先解除 Outer，重放仍被 Inner 阻塞且没有 enter；再解除 Inner 后按内→外派发一次，额外冲刷为空日志，证明重放不会重复消费已完成事件。
     */
    it('Outer hydrates first then Inner', async () => {
      dispatchMouseHoverEvent(innerDiv);

      await act(async () => {
        resolveOuter();
        await outerPromise;
        Scheduler.unstable_flushAllWithoutAsserting();
        OuterScheduler.unstable_flushAllWithoutAsserting();
        InnerScheduler.unstable_flushAllWithoutAsserting();
      });

      // 外层解析并计划重播
      OuterTestUtils.assertLog(['Outer']);
      // 内层 App 仍处于阻塞状态。
      InnerTestUtils.assertLog([]);

      // 重播外层事件
      await act(() => {
        Scheduler.unstable_flushAllWithoutAsserting();
        OuterScheduler.unstable_flushAllWithoutAsserting();
        InnerScheduler.unstable_flushAllWithoutAsserting();
      });

      // 内层仍被阻塞，因此外层在捕获阶段重播事件时，内层最终会调用 stopPropagation。
      assertLog([]);
      OuterTestUtils.assertLog([]);
      InnerTestUtils.assertLog(['Suspend Inner']);

      dispatchMouseHoverEvent(innerDiv);
      OuterTestUtils.assertLog([]);
      InnerTestUtils.assertLog([]);
      assertLog([]);

      await act(async () => {
        resolveInner();
        await innerPromise;
        Scheduler.unstable_flushAllWithoutAsserting();
        OuterScheduler.unstable_flushAllWithoutAsserting();
        InnerScheduler.unstable_flushAllWithoutAsserting();
      });

      // 内层完成水合。
      InnerTestUtils.assertLog(['Inner']);
      // 外层先前已完成水合。
      OuterTestUtils.assertLog([]);

      // 先触发内层 Mouse Enter，再触发外层 Mouse Enter。
      assertLog(['Inner Mouse Enter', 'Outer Mouse Enter']);

      await act(() => {
        Scheduler.unstable_flushAllWithoutAsserting();
        OuterScheduler.unstable_flushAllWithoutAsserting();
        InnerScheduler.unstable_flushAllWithoutAsserting();
      });

      assertLog([]);
    });
  });

  /**
   * 将待重放 mouseover 的 Child 先水合，再在重放前把其 DOM 移到另一原生容器；最终只记 container2 mouse over，不调用旧 React handler，证明克隆事件沿当前 DOM 路径分发。
   */
  it('replays event with null target when tree is dismounted', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => {
      /**
       * 先清除 Child 挂起开关再 resolve Promise，供移动 DOM 前等待 Child 水合；不直接派发已保存的 mouseover。
       */
      resolve = () => {
        suspend = false;
        resolvePromise();
      };
    });

    /**
     * suspend 时抛 Promise，否则记 Child 并返回带 mouseover 日志的 div；用原 React handler 与新容器原生 handler 区分重放最终传播路径。
     */
    function Child() {
      if (suspend) {
        throw promise;
      }
      Scheduler.log('Child');
      return (
        <div
          onMouseOver={() => {
            Scheduler.log('on mouse over');
          }}>
          Child
        </div>
      );
    }

    /**
     * 用无显式 fallback 的 Suspense 包 Child，返回可挂起的 server/client 同构树；DOM 移动在外部测试控制。
     */
    function App() {
      return (
        <Suspense>
          <Child />
        </Suspense>
      );
    }

    const finalHTML = ReactDOMServer.renderToString(<App />);
    assertLog(['Child']);

    const container = document.createElement('div');

    document.body.appendChild(container);
    container.innerHTML = finalHTML;
    suspend = true;

    ReactDOMClient.hydrateRoot(container, <App />);

    const childDiv = container.firstElementChild;

    await act(async () => {
      dispatchMouseHoverEvent(childDiv);

      // 尚未水合，因此保存事件用于重播，并调用 stopPropagation。
      assertLog([]);

      resolve();
      await waitFor(['Child']);

      ReactDOM.flushSync(() => {
        container.removeChild(childDiv);

        const container2 = document.createElement('div');
        container2.addEventListener('mouseover', () => {
          Scheduler.log('container2 mouse over');
        });
        container2.appendChild(childDiv);
      });
    });

    // 即使树已移除，容器上的原生事件处理器仍会触发并分发事件。
    assertLog(['container2 mouse over']);

    document.body.removeChild(container);
  });

  /**
   * SSR A/B/C/D，B 还嵌套在 C 同一外边界内；客户端 A/D 阻塞，依次 hover B/C 后解除；实际日志 App/C/Hover C/A/B/D，没有点击 D，验证连续事件保留最后目标路径而非 FIFO 重放全部 hover。
   */
  it('hydrates the last target path first for continuous events', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /**
     * text 标识 span，A/D 可挂起，mouseEnter 取消默认行为并记录 Hover；B/C 位于不同深度，用日志观察最后连续目标路径的认领。
     */
    function Child({text}) {
      if ((text === 'A' || text === 'D') && suspend) {
        throw promise;
      }
      Scheduler.log(text);
      return (
        <span
          onMouseEnter={e => {
            e.preventDefault();
            Scheduler.log('Hover ' + text);
          }}>
          {text}
        </span>
      );
    }

    /**
     * 返回 A、嵌套 B 与同层 C、D 三组边界结构；B 有额外内 Suspense，让 hover B→C 可以比较新旧目标路径的深度。
     */
    function App() {
      Scheduler.log('App');
      return (
        <div>
          <Suspense fallback="Loading...">
            <Child text="A" />
          </Suspense>
          <Suspense fallback="Loading...">
            <div>
              <Suspense fallback="Loading...">
                <Child text="B" />
              </Suspense>
            </div>
            <Child text="C" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="D" />
          </Suspense>
        </div>
      );
    }

    const finalHTML = ReactDOMServer.renderToString(<App />);

    assertLog(['App', 'A', 'B', 'C', 'D']);

    const container = document.createElement('div');
    // 我们需要将其放在文档中，因为我们将在此处触发事件。
    document.body.appendChild(container);

    container.innerHTML = finalHTML;

    const spanB = container.getElementsByTagName('span')[1];
    const spanC = container.getElementsByTagName('span')[2];
    const spanD = container.getElementsByTagName('span')[3];

    suspend = true;

    // A 和 D 会挂起；接下来只 hover B/C，以验证最后连续目标路径优先。
    ReactDOMClient.hydrateRoot(container, <App />);

    // 目前没有任何内容完成水合。
    assertLog([]);

    // 依次将鼠标悬停到 B 和 C。
    dispatchMouseHoverEvent(spanB, spanD);
    dispatchMouseHoverEvent(spanC, spanB);

    await act(async () => {
      suspend = false;
      resolve();
      await promise;
    });

    // 本例只 hover B 后 hover C，没有点击 D。最后目标 C 先水合并重放 Hover C，随后按日志完成 A、B、D。
    assertLog(['App', 'C', 'Hover C', 'A', 'B', 'D']);

    document.body.removeChild(container);
  });

  /**
   * SSR 三边界 A/B/C，hydrateRoot 后先显式请求 B 再 C；日志 App/C/B/A，证明此例同优先级显式目标的新请求排在旧请求前面。
   */
  it('hydrates the last explicitly hydrated target at higher priority', async () => {

    /**
     * 记录 text 并返回无监听 span；仅作为显式 scheduleHydration 目标，避免事件副作用混入目标优先级断言。
     */
    function Child({text}) {
      Scheduler.log(text);
      return <span>{text}</span>;
    }

    /**
     * 返回各自独立边界的 A/B/C，初始 server 顺序固定，使后续 C/B/A 日志能反映显式目标队列的调度顺序。
     */
    function App() {
      Scheduler.log('App');
      return (
        <div>
          <Suspense fallback="Loading...">
            <Child text="A" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="B" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="C" />
          </Suspense>
        </div>
      );
    }

    const finalHTML = ReactDOMServer.renderToString(<App />);

    assertLog(['App', 'A', 'B', 'C']);

    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    const spanB = container.getElementsByTagName('span')[1];
    const spanC = container.getElementsByTagName('span')[2];

    const root = ReactDOMClient.hydrateRoot(container, <App />);

    // 目前没有任何内容完成水合。
    assertLog([]);

    // 先提高 B 的优先级，再提高 C。
    root.unstable_scheduleHydration(spanB);
    root.unstable_scheduleHydration(spanC);

    // 此处请求处于同一事件优先级；相同优先级的新目标插入队首，所以先 C、再 B，最后普通后台目标 A。
    await waitForAll(['App', 'C', 'B', 'A']);
  });
  /**
   * www gate 下先水合 shell，Idle 更新 A→AA 启动时打断；hover A/B 后点击 C，先水合 C/c，再完成 A/a、B/b，最后提交 AA/aa；原 spanA identity 保留，证明在更新前认领 server DOM 而非替换。
   */

  // @gate www

  it('hydrates before an update even if hydration moves away from it', async () => {

    /**
     * 记录 text 并返回 span，大小写 children 组成同一边界；外层 Idle 更新和事件水合都调用它，日志用来区分旧 A/a 认领与新 AA/aa 更新。
     */
    function Child({text}) {
      Scheduler.log(text);
      return <span>{text}</span>;
    }
    /**
     * memo 包装的边界 fixture；text 不变时可复用外部元素，边界内返回大小写两枚 Child，供验证 hydration 必须在后续 prop 更新之前完成。
     */
    const ChildWithBoundary = React.memo(function ({text}) {
      return (
        <Suspense fallback="Loading...">
          <Child text={text} />
          <Child text={text.toLowerCase()} />
        </Suspense>
      );
    });

    /**
     * a 驱动首个 memo 边界，其余 B/C props 固定；effect 记录 Commit，返回三组 children，帮助区分 shell 提交、选择性认领与最终 Idle 更新提交。
     */
    function App({a}) {
      Scheduler.log('App');
      React.useEffect(() => {
        Scheduler.log('Commit');
      });
      return (
        <div>
          <ChildWithBoundary text={a} />
          <ChildWithBoundary text="B" />
          <ChildWithBoundary text="C" />
        </div>
      );
    }

    const finalHTML = ReactDOMServer.renderToString(<App a="A" />);

    assertLog(['App', 'A', 'a', 'B', 'b', 'C', 'c']);

    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    // 我们需要将其放在文档中，因为我们将在此处触发事件。
    document.body.appendChild(container);

    const spanA = container.getElementsByTagName('span')[0];
    const spanB = container.getElementsByTagName('span')[2];
    const spanC = container.getElementsByTagName('span')[4];

    await act(async () => {
      const root = ReactDOMClient.hydrateRoot(container, <App a="A" />);
      // 水合 shell。
      await waitFor(['App', 'Commit']);

      // 以 Idle 优先级渲染一个需要更新 A 的更新。

      TODO_scheduleIdleDOMSchedulerTask(() => {
        root.render(<App a="AA" />);
      });

      // 开始渲染；通过以比 Idle 高一级的优先级调度第一个边界，迫使其水合。
      await waitFor([
        'App',

        // 开始水合 A。
        'A',
      ]);

      // 将鼠标悬停到 A 上，这可能以比 Idle 高一级的优先级调度水合。
      dispatchMouseHoverEvent(spanA, null);

      // 在完成前改为悬停 B，用于验证 React 不会忘记仍需水合第一个边界 A；同时验证连续 hover 事件不会被降低一级优先级，否则会降到 Idle。
      dispatchMouseHoverEvent(spanB, spanA);

      // 再点击 C，赋予它更高优先级并重置优先级层级。
      dispatchClickEvent(spanC);

      assertLog([
        // 因为点击了 C，所以先水合 C。
        'C',
        'c',
      ]);

      await waitForAll([
        // 此前已强制 A 水合，因此现在完成 A 的水合。
        'A',
        'a',
        // 还要水合 B，因为此前曾悬停其上。A 和 B 谁先完成并不重要，只要都发生在 Idle 更新之前。
        'B',
        'b',
        // 再次开始 Idle 更新。
        'App',
        'AA',
        'aa',
        'Commit',
      ]);
    });

    const spanA2 = container.getElementsByTagName('span')[0];
    // 这里应完成水合，而不是替换节点。
    expect(spanA).toBe(spanA2);

    document.body.removeChild(container);
  });

  /**
   * SSR A/B，Child layout 在 DOM.onclick 注册原生处理器；点击 B 同步认领并提交监听，日志依次 App/B、React capture、native、React bubble，再水合 A，验证本次事件可继续走完整原生传播。
   */
  it('fires capture event handlers and native events if content is hydratable during discrete event', async () => {
    spyOnDev(console, 'error');

    /**
     * 返回 span 并同时声明 React capture/bubble；layout effect 按 text 给 ref.current.onclick 安装原生日志，null ref 时跳过；无显式清理，DOM 随本例容器移除而离开文档。
     */
    function Child({text}) {
      Scheduler.log(text);
      const ref = React.useRef();
      React.useLayoutEffect(() => {
        if (!ref.current) {
          return;
        }
        /**
         * 原生 onclick 记录 Native Click 和闭包 text；由 Child layout 提交安装，插在 React capture 与 bubble 的实际 DOM 事件传播之间。
         */
        ref.current.onclick = () => {
          Scheduler.log('Native Click ' + text);
        };
      }, [text]);
      return (
        <span
          ref={ref}
          onClickCapture={() => {
            Scheduler.log('Capture Clicked ' + text);
          }}
          onClick={e => {
            Scheduler.log('Clicked ' + text);
          }}>
          {text}
        </span>
      );
    }

    /**
     * 返回独立 A/B Suspense，App 日志标记根 shell 认领；点击 B 时 A 可以继续保持未水合。
     */
    function App() {
      Scheduler.log('App');
      return (
        <div>
          <Suspense fallback="Loading...">
            <Child text="A" />
          </Suspense>
          <Suspense fallback="Loading...">
            <Child text="B" />
          </Suspense>
        </div>
      );
    }

    const finalHTML = ReactDOMServer.renderToString(<App />);

    assertLog(['App', 'A', 'B']);

    const container = document.createElement('div');
    // 我们需要将其放在文档中，因为我们将在此处触发事件。
    document.body.appendChild(container);

    container.innerHTML = finalHTML;

    const span = container.getElementsByTagName('span')[1];

    ReactDOMClient.hydrateRoot(container, <App />);

    // 目前没有任何内容完成水合。
    assertLog([]);

    // 这应同步水合根 App 和第二个 Suspense 边界。
    dispatchClickEvent(span);

    // 我们渲染了 App、B，然后没有渲染 A，就触发了事件。
    assertLog(['App', 'B', 'Capture Clicked B', 'Native Click B', 'Clicked B']);

    // 继续运行调度器后，最终水合 A。
    await waitForAll(['A']);

    document.body.removeChild(container);
  });

  /**
   * 客户端 Child 永久挂起，父同时有原生/React click，子有 capture stopPropagation；连续点击两次只水合 App，父子 flags 均 false，证明无法同步水合时 React 截断离散事件传播。
   */
  it('does not propagate discrete event if it cannot be synchronously hydrated', async () => {
    let triggeredParent = false;
    let triggeredChild = false;
    let suspend = false;
    const promise = new Promise(() => {});

    /**
     * 客户端 suspend 时抛永久未决 Promise，否则返回 Click me span；capture handler 停止传播并置 triggeredChild，断言未水合时这个 handler 根本不执行。
     */
    function Child() {
      if (suspend) {
        throw promise;
      }
      Scheduler.log('Child');
      return (
        <span
          onClickCapture={e => {
            e.stopPropagation();
            triggeredChild = true;
          }}>
          Click me
        </span>
      );
    }

    /**
     * 返回具有同一原生 onclick 与 React onClick 的父 div；Child 包在 Suspense 内，父 flag 用来发现阻塞子目标的 click 是否漏到祖先。
     */
    function App() {

      /**
       * 把 triggeredParent 设为 true；同时供原生与 React 冒泡注册使用，任一路径误传播都能被测试发现。
       */
      const onClick = () => {
        triggeredParent = true;
      };
      Scheduler.log('App');
      return (
        <div
          ref={n => {
            if (n) n.onclick = onClick;
          }}
          onClick={onClick}>
          <Suspense fallback={null}>
            <Child />
          </Suspense>
        </div>
      );
    }
    const finalHTML = ReactDOMServer.renderToString(<App />);

    assertLog(['App', 'Child']);

    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = finalHTML;

    suspend = true;

    ReactDOMClient.hydrateRoot(container, <App />);
    // 目前没有任何内容完成水合。
    assertLog([]);

    const span = container.getElementsByTagName('span')[0];
    dispatchClickEvent(span);

    assertLog(['App']);

    dispatchClickEvent(span);

    expect(triggeredParent).toBe(false);
    expect(triggeredChild).toBe(false);
  });

  /**
   * 根本身在 transition hydration render 中被 Promise 阻塞；click 再尝试同步水合仍只记录 App，未 preventDefault 所以返回 true；解除后 App/A 完成但无 Clicked A，覆盖挂起 HostRoot 的同步尝试。
   */
  it('can attempt sync hydration if suspended root is still concurrently rendering', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /**
     * suspend 时抛根级 Promise，否则返回带 preventDefault click 的 text span；没有局部 Suspense，让 hydration 在 HostRoot 层挂起。
     */
    function Child({text}) {
      if (suspend) {
        throw promise;
      }
      Scheduler.log(text);
      return (
        <span
          onClick={e => {
            e.preventDefault();
            Scheduler.log('Clicked ' + text);
          }}>
          {text}
        </span>
      );
    }

    /**
     * 返回包 Child A 的 div，并记录 App render；根级 thenable 造成并发 hydration 未完成，供事件触发第二次同步尝试。
     */
    function App() {
      Scheduler.log('App');
      return (
        <div>
          <Child text="A" />
        </div>
      );
    }

    const finalHTML = ReactDOMServer.renderToString(<App />);

    assertLog(['App', 'A']);

    const container = document.createElement('div');
    // 我们需要将其放在文档中，因为我们将在此处触发事件。
    document.body.appendChild(container);

    container.innerHTML = finalHTML;

    const span = container.getElementsByTagName('span')[0];

    // 客户端渲染会挂起。
    suspend = true;

    React.startTransition(() => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    await waitFor(['App']);

    // 应尝试同步水合根节点，然后因仍处于挂起状态而暂停。
    const result = dispatchClickEvent(span);
    assertLog(['App']);
    // 因未完成水合，事件不应被取消。
    expect(result).toBe(true);

    // 完成加载数据
    await act(async () => {
      suspend = false;
      await resolve();
    });

    // App 应已成功水合并完成渲染。
    assertLog(['App', 'A']);

    document.body.removeChild(container);
  });

  /**
   * 只提交 SSR A 的 shell，再 flushSync root.render(B)；日志 App B/Child A/App B/Child B，spanRef 与初始 server span 相同，证明同步更新先认领旧 A 再更新 B。
   */
  it('can force hydration in response to sync update', async () => {

    /**
     * 记录 Child text 并返回带 callback ref 的 span；提交时 ref 写 spanRef，让测试比较 server 节点 identity，日志区分旧 A 认领与新 B 更新。
     */
    function Child({text}) {
      Scheduler.log(`Child ${text}`);
      return <span ref={ref => (spanRef = ref)}>{text}</span>;
    }

    /**
     * 把 text 传入 Suspense 中的 Child 并记录 App text；返回稳定 div/边界结构，使 shell 先认领后外部更新可触发子边界先 hydration 再变更文本。
     */
    function App({text}) {
      Scheduler.log(`App ${text}`);
      return (
        <div>
          <Suspense fallback={null}>
            <Child text={text} />
          </Suspense>
        </div>
      );
    }

    let spanRef;
    const finalHTML = ReactDOMServer.renderToString(<App text="A" />);
    assertLog(['App A', 'Child A']);
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = finalHTML;
    const initialSpan = container.getElementsByTagName('span')[0];
    const root = ReactDOMClient.hydrateRoot(container, <App text="A" />);
    await waitForPaint(['App A']);

    await act(() => {
      ReactDOM.flushSync(() => {
        root.render(<App text="B" />);
      });
    });
    assertLog(['App B', 'Child A', 'App B', 'Child B']);
    expect(initialSpan).toBe(spanRef);
  });
  /**
   * www gate 下 shell 已认领、子边界未完成；连续事件优先级更新 A→B，日志先 Child A 后 Child B，server span identity 保留，证明该优先级也先完成 hydration 再处理更新。
   */

  // @gate www

  it('can force hydration in response to continuous update', async () => {

    /**
     * 记录 Child text 并返回带 callback ref 的 span；提交时 ref 写 spanRef，让测试比较 server 节点 identity，日志区分旧 A 认领与新 B 更新。
     */
    function Child({text}) {
      Scheduler.log(`Child ${text}`);
      return <span ref={ref => (spanRef = ref)}>{text}</span>;
    }

    /**
     * 把 text 传入 Suspense 中的 Child 并记录 App text；返回稳定 div/边界结构，使 shell 先认领后外部更新可触发子边界先 hydration 再变更文本。
     */
    function App({text}) {
      Scheduler.log(`App ${text}`);
      return (
        <div>
          <Suspense fallback={null}>
            <Child text={text} />
          </Suspense>
        </div>
      );
    }

    let spanRef;
    const finalHTML = ReactDOMServer.renderToString(<App text="A" />);
    assertLog(['App A', 'Child A']);
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = finalHTML;
    const initialSpan = container.getElementsByTagName('span')[0];
    const root = ReactDOMClient.hydrateRoot(container, <App text="A" />);
    await waitForPaint(['App A']);

    await act(() => {
      TODO_scheduleContinuousSchedulerTask(() => {
        root.render(<App text="B" />);
      });
    });

    assertLog(['App B', 'Child A', 'App B', 'Child B']);
    expect(initialSpan).toBe(spanRef);
  });

  /**
   * shell 已认领、子边界未完成，普通 root.render A→B；日志先认领 Child A 再提交 Child B，原 span 与 ref 相同，验证默认更新不直接替换尚未水合的 server 节点。
   */
  it('can force hydration in response to default update', async () => {

    /**
     * 记录 Child text 并返回带 callback ref 的 span；提交时 ref 写 spanRef，让测试比较 server 节点 identity，日志区分旧 A 认领与新 B 更新。
     */
    function Child({text}) {
      Scheduler.log(`Child ${text}`);
      return <span ref={ref => (spanRef = ref)}>{text}</span>;
    }

    /**
     * 把 text 传入 Suspense 中的 Child 并记录 App text；返回稳定 div/边界结构，使 shell 先认领后外部更新可触发子边界先 hydration 再变更文本。
     */
    function App({text}) {
      Scheduler.log(`App ${text}`);
      return (
        <div>
          <Suspense fallback={null}>
            <Child text={text} />
          </Suspense>
        </div>
      );
    }

    let spanRef;
    const finalHTML = ReactDOMServer.renderToString(<App text="A" />);
    assertLog(['App A', 'Child A']);
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = finalHTML;
    const initialSpan = container.getElementsByTagName('span')[0];
    const root = ReactDOMClient.hydrateRoot(container, <App text="A" />);
    await waitForPaint(['App A']);
    await act(() => {
      root.render(<App text="B" />);
    });
    assertLog(['App B', 'Child A', 'App B', 'Child B']);
    expect(initialSpan).toBe(spanRef);
  });
  /**
   * Provider 仅包待水合 Child，兄弟 reader 应读 DefaultContext；Idle A→AA 途中 click A 插入选择性水合，最终 reader 仍 DefaultContext，证明中断时 provider 栈正确 unwind，不向 sibling 泄漏 SiblingContext。
   */

  // @gate www

  it('regression test: can unwind context on selective hydration interruption', async () => {
    const Context = React.createContext('DefaultContext');

    /**
     * 读取 Context 并记其实际值，返回 null；位于 Provider sibling 而非内部，应始终读 DefaultContext，props 参数未参与读取。
     */
    function ContextReader(props) {
      const value = React.useContext(Context);
      Scheduler.log(value);
      return null;
    }

    /**
     * 记录 text 并返回 span，使中断前 A 认领与更新后 AA 输出在日志中可区分。
     */
    function Child({text}) {
      Scheduler.log(text);
      return <span>{text}</span>;
    }
    /**
     * memo/Suspense 包装 Child，返回可单独选择性水合的边界；与 Provider sibling reader 共同检验中断后的 Context 栈恢复。
     */
    const ChildWithBoundary = React.memo(function ({text}) {
      return (
        <Suspense fallback="Loading...">
          <Child text={text} />
        </Suspense>
      );
    });

    /**
     * 返回只包住 Child 边界的 SiblingContext Provider 和其外 sibling reader；a 控制 Child 更新，effect 记 Commit，reader 的 DefaultContext 是 unwind 的可观察证据。
     */
    function App({a}) {
      Scheduler.log('App');
      React.useEffect(() => {
        Scheduler.log('Commit');
      });
      return (
        <>
          <Context.Provider value="SiblingContext">
            <ChildWithBoundary text={a} />
          </Context.Provider>
          <ContextReader />
        </>
      );
    }
    const finalHTML = ReactDOMServer.renderToString(<App a="A" />);
    assertLog(['App', 'A', 'DefaultContext']);
    const container = document.createElement('div');
    container.innerHTML = finalHTML;
    document.body.appendChild(container);

    const spanA = container.getElementsByTagName('span')[0];

    await act(async () => {
      const root = ReactDOMClient.hydrateRoot(container, <App a="A" />);
      await waitFor(['App', 'DefaultContext', 'Commit']);

      TODO_scheduleIdleDOMSchedulerTask(() => {
        root.render(<App a="AA" />);
      });
      await waitFor(['App', 'A']);

      dispatchClickEvent(spanA);
      assertLog(['A']);
      await waitForAll(['App', 'AA', 'DefaultContext', 'Commit']);
    });
  });

  /**
   * 相同 Provider/sibling reader 结构，shell 后 flushSync A→AA；日志 App/A/App/AA/DefaultContext/Commit，验证同步水合重启也正确恢复 Context 栈。
   */
  it('regression test: can unwind context on selective hydration interruption for sync updates', async () => {
    const Context = React.createContext('DefaultContext');

    /**
     * 在 Provider 外读 Context 并记值，返回 null；同步水合重启后也必须得到 DefaultContext，props 未使用。
     */
    function ContextReader(props) {
      const value = React.useContext(Context);
      Scheduler.log(value);
      return null;
    }

    /**
     * 记录 text 并返回 span，供同步更新先认领 A 再提交 AA 的顺序断言。
     */
    function Child({text}) {
      Scheduler.log(text);
      return <span>{text}</span>;
    }
    /**
     * memo/Suspense 包装 Child，为同步更新构造仍脱水的独立边界；返回树中不读取 Context，本例关注祖先 Provider 栈恢复。
     */
    const ChildWithBoundary = React.memo(function ({text}) {
      return (
        <Suspense fallback="Loading...">
          <Child text={text} />
        </Suspense>
      );
    });

    /**
     * 返回 SiblingContext Provider 内的 Child 边界和 Provider 外 reader；effect 记录 Commit，a 更新触发认领重启，不能把 provider 值泄漏给 sibling。
     */
    function App({a}) {
      Scheduler.log('App');
      React.useEffect(() => {
        Scheduler.log('Commit');
      });
      return (
        <>
          <Context.Provider value="SiblingContext">
            <ChildWithBoundary text={a} />
          </Context.Provider>
          <ContextReader />
        </>
      );
    }
    const finalHTML = ReactDOMServer.renderToString(<App a="A" />);
    assertLog(['App', 'A', 'DefaultContext']);
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    await act(async () => {
      const root = ReactDOMClient.hydrateRoot(container, <App a="A" />);
      await waitFor(['App', 'DefaultContext', 'Commit']);

      ReactDOM.flushSync(() => {
        root.render(<App a="AA" />);
      });
      assertLog(['App', 'A', 'App', 'AA', 'DefaultContext', 'Commit']);
    });
  });

  /**
   * 100 个独立边界共用 insideRef，先仅水合 shell：outsideRef 非空、insideRef 为空；一次 flushSync setState(true) 触发子边界水合，最终 insideRef 非空且 act 完成，证明水合重试不应被累计为无限更新循环。
   */
  it('regression: selective hydration does not contribute to "maximum update limit" count', async () => {
    const outsideRef = React.createRef(null);
    const insideRef = React.createRef(null);

    /**
     * 返回一个含 insideRef div 的独立 Suspense；isMounted prop 未读取，但父更新把新 props 送到100个边界，迫使未水合 children 进入认领路径。
     */
    function Child() {
      return (
        <Suspense fallback="Loading...">
          <div ref={insideRef} />
        </Suspense>
      );
    }

    let setIsMounted = false;

    /**
     * useState(false) 的 setter 暴露为 setIsMounted，生成100个 keyed Child 并给 shell 挂 outsideRef；两类 ref 区分 shell 先提交与所有子边界后续认领，返回 div 子树。
     */
    function App() {
      const [isMounted, setState] = React.useState(false);
      setIsMounted = setState;

      const children = [];
      for (let i = 0; i < 100; i++) {
        children.push(<Child key={i} isMounted={isMounted} />);
      }

      return <div ref={outsideRef}>{children}</div>;
    }

    const finalHTML = ReactDOMServer.renderToString(<App />);
    const container = document.createElement('div');
    container.innerHTML = finalHTML;

    await act(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);

      // 只提交 shell。
      await waitForPaint([]);

      // 断言 shell 已完成水合，而子节点尚未水合。
      expect(outsideRef.current).not.toBe(null);
      expect(insideRef.current).toBe(null);

      // 同步更新 shell。更新会流入尚未水合的子节点，并触发选择性水合造成的级联提交；但实际只有一次更新，因此不应视为更新循环。注意：此时每个兄弟边界都会单独提交，这并不理想；若有可恢复的上下文栈，就能在一个渲染阶段提交全部内容。
      ReactDOM.flushSync(() => {
        setIsMounted(true);
      });
    });

    // 应已成功水合且没有错误。
    expect(insideRef.current).not.toBe(null);
  });
});
