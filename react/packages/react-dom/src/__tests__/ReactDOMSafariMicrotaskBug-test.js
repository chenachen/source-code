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
    global.queueMicrotask = cb => {
      if (overrideQueueMicrotask) {
        fakeMicrotaskQueue.push(cb);
      } else {
        originalQueueMicrotask(cb);
      }
    };
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

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should deal with premature microtask in commit phase」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should deal with premature microtask in commit phase', async () => {
    let ran = false;
    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「should deal with premature microtask in event handler」描述的渲染、交互或错误处理结果。 */
  it('should deal with premature microtask in event handler', async () => {
    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
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
