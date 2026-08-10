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

describe('SyntheticMouseEvent', () => {
  let container;

  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;

    // 容器必须挂载才能触发事件。
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    container = null;
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should only use values from movementX/Y when event type is mousemove」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：事件断言连接 DOMPluginEventSystem 的委托、合成与传播路径。
   */
  it('should only use values from movementX/Y when event type is mousemove', async () => {
    const events = [];
    /** `onMouseMove`：封装当前用例复用的操作、回调或断言步骤。 */
    const onMouseMove = event => {
      events.push(event.movementX);
    };

    /** `onMouseDown`：封装当前用例复用的操作、回调或断言步骤。 */
    const onMouseDown = event => {
      events.push(event.movementX);
    };

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<div onMouseMove={onMouseMove} onMouseDown={onMouseDown} />);
    });
    const node = container.firstChild;

    let event = new MouseEvent('mousemove', {
      relatedTarget: null,
      bubbles: true,
      screenX: 2,
      screenY: 2,
    });

    await act(() => {
      node.dispatchEvent(event);
    });

    event = new MouseEvent('mousemove', {
      relatedTarget: null,
      bubbles: true,
      screenX: 8,
      screenY: 8,
    });

    await act(() => {
      node.dispatchEvent(event);
    });

    // 现在触发一个mousedown事件，看看movementX是否又回到了0。
    event = new MouseEvent('mousedown', {
      relatedTarget: null,
      bubbles: true,
      screenX: 25,
      screenY: 65,
    });

    await act(() => {
      node.dispatchEvent(event);
    });

    expect(events.length).toBe(3);
    expect(events[0]).toBe(0);
    expect(events[1]).toBe(6);
    expect(events[2]).toBe(0); // `mousedown` 事件应该有 `movementX` 属性为 0。
  });

  /** 测试场景：验证「should correctly calculate movementX/Y for capture phase」描述的渲染、交互或错误处理结果。 */
  it('should correctly calculate movementX/Y for capture phase', async () => {
    const events = [];
    /** `onMouseMove`：封装当前用例复用的操作、回调或断言步骤。 */
    const onMouseMove = event => {
      events.push(['move', false, event.movementX, event.movementY]);
    };
    /** `onMouseMoveCapture`：封装当前用例复用的操作、回调或断言步骤。 */
    const onMouseMoveCapture = event => {
      events.push(['move', true, event.movementX, event.movementY]);
    };
    /** `onMouseDown`：封装当前用例复用的操作、回调或断言步骤。 */
    const onMouseDown = event => {
      events.push(['down', false, event.movementX, event.movementY]);
    };
    /** `onMouseDownCapture`：封装当前用例复用的操作、回调或断言步骤。 */
    const onMouseDownCapture = event => {
      events.push(['down', true, event.movementX, event.movementY]);
    };

    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <div
          onMouseMove={onMouseMove}
          onMouseMoveCapture={onMouseMoveCapture}
          onMouseDown={onMouseDown}
          onMouseDownCapture={onMouseDownCapture}
        />,
      );
    });
    const node = container.firstChild;

    let event = new MouseEvent('mousemove', {
      relatedTarget: null,
      bubbles: true,
      screenX: 2,
      screenY: 2,
    });

    await act(() => {
      node.dispatchEvent(event);
    });

    event = new MouseEvent('mousemove', {
      relatedTarget: null,
      bubbles: true,
      screenX: 8,
      screenY: 9,
    });

    await act(() => {
      node.dispatchEvent(event);
    });

    // 现在触发一个mousedown事件，看看movementX是否又回到了0。
    event = new MouseEvent('mousedown', {
      relatedTarget: null,
      bubbles: true,
      screenX: 25,
      screenY: 65,
    });

    await act(() => {
      node.dispatchEvent(event);
    });

    expect(events).toEqual([
      ['move', true, 0, 0],
      ['move', false, 0, 0],
      ['move', true, 6, 7],
      ['move', false, 6, 7],
      ['down', true, 0, 0],
      ['down', false, 0, 0],
    ]);
  });
});
