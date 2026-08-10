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
let Activity;
let act;
let assertLog;
let waitForAll;
let waitFor;
let waitForPaint;

let IdleEventPriority;
let ContinuousEventPriority;

/** `dispatchMouseHoverEvent`：封装当前用例复用的操作、回调或断言步骤。 */
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

/** `dispatchClickEvent`：封装当前用例复用的操作、回调或断言步骤。 */
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

// TODO：当前没有 React DOM API 可选择使用 Idle 优先级更新，也没有映射到 Idle 优先级的原生 DOM 事件，因此这里只能临时规避；需要类似 ReactDOM.unstable_IdleUpdates 的 API。
/** `TODO_scheduleIdleDOMSchedulerTask`：封装当前用例复用的操作、回调或断言步骤。 */
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

/** `TODO_scheduleContinuousSchedulerTask`：封装当前用例复用的操作、回调或断言步骤。 */
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

describe('ReactDOMServerSelectiveHydrationActivity', () => {
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
    Activity = React.Activity;

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
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「hydrates the target boundary synchronously during a click」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言对应 ReactDOMRoot.hydrateRoot 的容器认领与事件重放路径。
   */
  it('hydrates the target boundary synchronously during a click', async () => {
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      Scheduler.log('App');
      return (
        <div>
          <Activity>
            <Child text="A" />
          </Activity>
          <Activity>
            <Child text="B" />
          </Activity>
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

  /** 测试场景：验证「hydrates at higher pri if sync did not work first time」描述的渲染、交互或错误处理结果。 */
  it('hydrates at higher pri if sync did not work first time', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      Scheduler.log('App');
      return (
        <div>
          <Activity>
            <Child text="A" />
          </Activity>
          <Activity>
            <Child text="B" />
          </Activity>
          <Activity>
            <Child text="C" />
          </Activity>
          <Activity>
            <Child text="D" />
          </Activity>
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

  /** 测试场景：验证「hydrates at higher pri for secondary discrete events」描述的渲染、交互或错误处理结果。 */
  it('hydrates at higher pri for secondary discrete events', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      Scheduler.log('App');
      return (
        <div>
          <Activity>
            <Child text="A" />
          </Activity>
          <Activity>
            <Child text="B" />
          </Activity>
          <Activity>
            <Child text="C" />
          </Activity>
          <Activity>
            <Child text="D" />
          </Activity>
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

  // @gate www
  /** 测试场景：验证「hydrates the target boundary synchronously during a click (createEventHandle)」描述的渲染、交互或错误处理结果。 */
  it('hydrates the target boundary synchronously during a click (createEventHandle)', async () => {
    const setClick = ReactDOM.unstable_createEventHandle('click');
    let isServerRendering = true;

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      Scheduler.log('App');
      return (
        <div>
          <Activity>
            <Child text="A" />
          </Activity>
          <Activity>
            <Child text="B" />
          </Activity>
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

  // @gate www
  /** 测试场景：验证「hydrates at higher pri if sync did not work first time (createEventHandle)」描述的渲染、交互或错误处理结果。 */
  it('hydrates at higher pri if sync did not work first time (createEventHandle)', async () => {
    let suspend = false;
    let isServerRendering = true;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    const setClick = ReactDOM.unstable_createEventHandle('click');

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      Scheduler.log('App');
      return (
        <div>
          <Activity>
            <Child text="A" />
          </Activity>
          <Activity>
            <Child text="B" />
          </Activity>
          <Activity>
            <Child text="C" />
          </Activity>
          <Activity>
            <Child text="D" />
          </Activity>
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

    // 点击后应优先处理 D 和 Click，之后才渲染 A 和 C。
    await act(async () => {
      suspend = false;
      resolve();
      await promise;
    });

    // 没有重播
    assertLog(['D', 'A']);

    document.body.removeChild(container);
  });

  // @gate www
  /** 测试场景：验证「hydrates at higher pri for secondary discrete events (createEventHandle)」描述的渲染、交互或错误处理结果。 */
  it('hydrates at higher pri for secondary discrete events (createEventHandle)', async () => {
    const setClick = ReactDOM.unstable_createEventHandle('click');
    let suspend = false;
    let isServerRendering = true;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      Scheduler.log('App');
      return (
        <div>
          <Activity>
            <Child text="A" />
          </Activity>
          <Activity>
            <Child text="B" />
          </Activity>
          <Activity>
            <Child text="C" />
          </Activity>
          <Activity>
            <Child text="D" />
          </Activity>
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

  /** 测试场景：验证「hydrates the hovered targets as higher priority for continuous events」描述的渲染、交互或错误处理结果。 */
  it('hydrates the hovered targets as higher priority for continuous events', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      Scheduler.log('App');
      return (
        <div>
          <Activity>
            <Child text="A" />
          </Activity>
          <Activity>
            <Child text="B" />
          </Activity>
          <Activity>
            <Child text="C" />
          </Activity>
          <Activity>
            <Child text="D" />
          </Activity>
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

  /** 测试场景：验证「replays capture phase for continuous events and respects stopPropagation」描述的渲染、交互或错误处理结果。 */
  it('replays capture phase for continuous events and respects stopPropagation', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
          <Activity>
            <Child text="A" />
          </Activity>
          <Activity>
            <Child text="B" />
          </Activity>
          <Activity>
            <Child text="C" />
          </Activity>
          <Activity>
            <Child text="D" />
          </Activity>
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

  /** 测试场景：验证「replays event with null target when tree is dismounted」描述的渲染、交互或错误处理结果。 */
  it('replays event with null target when tree is dismounted', async () => {
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

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <Activity>
          <Child />
        </Activity>
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

  /** 测试场景：验证「hydrates the last target path first for continuous events」描述的渲染、交互或错误处理结果。 */
  it('hydrates the last target path first for continuous events', async () => {
    let suspend = false;
    let resolve;
    const promise = new Promise(resolvePromise => (resolve = resolvePromise));

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
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

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      Scheduler.log('App');
      return (
        <div>
          <Activity>
            <Child text="A" />
          </Activity>
          <Activity>
            <div>
              <Activity>
                <Child text="B" />
              </Activity>
            </div>
            <Child text="C" />
          </Activity>
          <Activity>
            <Child text="D" />
          </Activity>
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

    // 依次将鼠标悬停到 B 和 C。
    dispatchMouseHoverEvent(spanB, spanD);
    dispatchMouseHoverEvent(spanC, spanB);

    await act(async () => {
      suspend = false;
      resolve();
      await promise;
    });

    // 因为点击了 D，应先水合 D。接着水合当前悬停目标 C。之后先水合 A 还是 B 并不重要；当前实现先水合 B，因为此前曾悬停其上且从未降低其优先级。
    assertLog(['App', 'C', 'Hover C', 'A', 'B', 'D']);

    document.body.removeChild(container);
  });

  /** 测试场景：验证「hydrates the last explicitly hydrated target at higher priority」描述的渲染、交互或错误处理结果。 */
  it('hydrates the last explicitly hydrated target at higher priority', async () => {
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({text}) {
      Scheduler.log(text);
      return <span>{text}</span>;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      Scheduler.log('App');
      return (
        <div>
          <Activity>
            <Child text="A" />
          </Activity>
          <Activity>
            <Child text="B" />
          </Activity>
          <Activity>
            <Child text="C" />
          </Activity>
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

    // 应优先水合 C，因为最后添加的目标优先级最高，其次是倒数第二个。
    await waitForAll(['App', 'C', 'B', 'A']);
  });

  // @gate www
  /** 测试场景：验证「hydrates before an update even if hydration moves away from it」描述的渲染、交互或错误处理结果。 */
  it('hydrates before an update even if hydration moves away from it', async () => {
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({text}) {
      Scheduler.log(text);
      return <span>{text}</span>;
    }
    const ChildWithBoundary = React.memo(function ({text}) {
      return (
        <Activity>
          <Child text={text} />
          <Child text={text.toLowerCase()} />
        </Activity>
      );
    });

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「fires capture event handlers and native events if content is hydratable during discrete event」描述的渲染、交互或错误处理结果。 */
  it('fires capture event handlers and native events if content is hydratable during discrete event', async () => {
    spyOnDev(console, 'error');
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({text}) {
      Scheduler.log(text);
      const ref = React.useRef();
      React.useLayoutEffect(() => {
        if (!ref.current) {
          return;
        }
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

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      Scheduler.log('App');
      return (
        <div>
          <Activity>
            <Child text="A" />
          </Activity>
          <Activity>
            <Child text="B" />
          </Activity>
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

  /** 测试场景：验证「does not propagate discrete event if it cannot be synchronously hydrated」描述的渲染、交互或错误处理结果。 */
  it('does not propagate discrete event if it cannot be synchronously hydrated', async () => {
    let triggeredParent = false;
    let triggeredChild = false;
    let suspend = false;
    const promise = new Promise(() => {});
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
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
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      /** `App.onClick`：封装当前用例复用的操作、回调或断言步骤。 */
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
          <Activity>
            <Child />
          </Activity>
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

  /** 测试场景：验证「can force hydration in response to sync update」描述的渲染、交互或错误处理结果。 */
  it('can force hydration in response to sync update', async () => {
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({text}) {
      Scheduler.log(`Child ${text}`);
      return <span ref={ref => (spanRef = ref)}>{text}</span>;
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({text}) {
      Scheduler.log(`App ${text}`);
      return (
        <div>
          <Activity>
            <Child text={text} />
          </Activity>
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

  // @gate www
  /** 测试场景：验证「can force hydration in response to continuous update」描述的渲染、交互或错误处理结果。 */
  it('can force hydration in response to continuous update', async () => {
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({text}) {
      Scheduler.log(`Child ${text}`);
      return <span ref={ref => (spanRef = ref)}>{text}</span>;
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({text}) {
      Scheduler.log(`App ${text}`);
      return (
        <div>
          <Activity>
            <Child text={text} />
          </Activity>
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

  /** 测试场景：验证「can force hydration in response to default update」描述的渲染、交互或错误处理结果。 */
  it('can force hydration in response to default update', async () => {
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({text}) {
      Scheduler.log(`Child ${text}`);
      return <span ref={ref => (spanRef = ref)}>{text}</span>;
    }
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({text}) {
      Scheduler.log(`App ${text}`);
      return (
        <div>
          <Activity>
            <Child text={text} />
          </Activity>
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

  // @gate www
  /** 测试场景：验证「regression test: can unwind context on selective hydration interruption」描述的渲染、交互或错误处理结果。 */
  it('regression test: can unwind context on selective hydration interruption', async () => {
    const Context = React.createContext('DefaultContext');

    /** `ContextReader`：封装当前用例复用的操作、回调或断言步骤。 */
    function ContextReader(props) {
      const value = React.useContext(Context);
      Scheduler.log(value);
      return null;
    }

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({text}) {
      Scheduler.log(text);
      return <span>{text}</span>;
    }
    const ChildWithBoundary = React.memo(function ({text}) {
      return (
        <Activity>
          <Child text={text} />
        </Activity>
      );
    });

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「regression test: can unwind context on selective hydration interruption for sync updates」描述的渲染、交互或错误处理结果。 */
  it('regression test: can unwind context on selective hydration interruption for sync updates', async () => {
    const Context = React.createContext('DefaultContext');

    /** `ContextReader`：封装当前用例复用的操作、回调或断言步骤。 */
    function ContextReader(props) {
      const value = React.useContext(Context);
      Scheduler.log(value);
      return null;
    }

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({text}) {
      Scheduler.log(text);
      return <span>{text}</span>;
    }
    const ChildWithBoundary = React.memo(function ({text}) {
      return (
        <Activity>
          <Child text={text} />
        </Activity>
      );
    });

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「regression: selective hydration does not contribute to "maximum update limit" count」描述的渲染、交互或错误处理结果。 */
  it('regression: selective hydration does not contribute to "maximum update limit" count', async () => {
    const outsideRef = React.createRef(null);
    const insideRef = React.createRef(null);
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      return (
        <Activity>
          <div ref={insideRef} />
        </Activity>
      );
    }

    let setIsMounted = false;
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
