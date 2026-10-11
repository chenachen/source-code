/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let React;

let ReactDOMClient;
let act;
let assertLog;
let Scheduler;

describe('ReactDOMSafariMicrotaskBug-test', () => {
  let container;
  let overrideQueueMicrotask;
  let flushFakeMicrotasks;

  beforeEach(() => {
    // Safari 的微任务并不总在干净调用栈上运行；此设置只做近似模拟。真实场景中，向页面添加 iframe
    // 会触发同步冲刷。参见 https://github.com/facebook/react/issues/22459。
    const originalQueueMicrotask = queueMicrotask;
    overrideQueueMicrotask = false;
    const fakeMicrotaskQueue = [];
    /** override 打开时把微任务保存到测试数组，否则转发原 queueMicrotask；模拟 Safari 在用户调用栈内提前运行的根任务。 */
    global.queueMicrotask = cb => {
      if (overrideQueueMicrotask) {
        fakeMicrotaskQueue.push(cb);
      } else {
        originalQueueMicrotask(cb);
      }
    };
    /** 按 FIFO 消费模拟微任务，连回调执行期间新追加的任务也一起冲刷，以制造真实的可重入调度条件。 */
    flushFakeMicrotasks = () => {
      while (fakeMicrotaskQueue.length > 0) {
        const cb = fakeMicrotaskQueue.shift();
        cb();
      }
    };

    jest.resetModules();
    container = document.createElement('div');
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
    assertLog = require('internal-test-utils').assertLog;
    Scheduler = require('scheduler');

    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  /** ref 提交回调中安排 state=1 并同步冲刷模拟微任务；ref 结束日志仍应看到 DOM 0，整个 act 后变为 1，验证 commit 期间过早运行根微任务不能重入提交。 */
  it('should deal with premature microtask in commit phase', async () => {
    let ran = false;

    /** 在宿主 ref 回调中首次安排更新并立即冲刷假微任务，用 ran 防止第二次提交重复调度。 */
    function Foo() {
      const [state, setState] = React.useState(0);
      return (
        <div
          ref={() => {
            overrideQueueMicrotask = true;
            if (!ran) {
              ran = true;
              setState(1);
              flushFakeMicrotasks();
              Scheduler.log(
                'Content at end of ref callback: ' + container.textContent,
              );
            }
          }}>
          {state}
        </div>
      );
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Foo />);
    });
    assertLog(['Content at end of ref callback: 0']);
    expect(container.textContent).toBe('1');
  });

  /** 按钮 click 中安排 state=1 并同步冲刷模拟微任务；handler 结束日志与最终 DOM 都应为 1，记录事件阶段允许提前冲刷的现状，并验证 Safari 式同步微任务不会使更新崩溃。 */
  it('should deal with premature microtask in event handler', async () => {

    /** 在 click handler 内安排状态并立即冲刷假微任务，让 DOM 日志观察事件阶段的同步提交现状。 */
    function Foo() {
      const [state, setState] = React.useState(0);
      return (
        <button
          onClick={() => {
            overrideQueueMicrotask = true;
            setState(1);
            flushFakeMicrotasks();
            Scheduler.log(
              'Content at end of click handler: ' + container.textContent,
            );
          }}>
          {state}
        </button>
      );
    }
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<Foo />);
    });
    expect(container.textContent).toBe('0');
    await act(() => {
      container.firstChild.dispatchEvent(
        new MouseEvent('click', {bubbles: true}),
      );
    });
    // 这会让更新比平常更早冲刷。该行为并不理想，但测试要记录现状；缺陷来自 Safari 而非 React，
    // 因此即使结果不完全正确，也至少要尽力避免崩溃。
    assertLog(['Content at end of click handler: 1']);
    expect(container.textContent).toBe('1');
  });
});
