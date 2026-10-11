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

  /** 连续派发 screen 坐标 2/2、8/8 的两次 mousemove，再派发 25/65 的 mousedown；movementX 应为 0、6、0，验证缺少原生 movement 字段时仅移动事件计算差值，按下事件重置为 0。 */
  it('should only use values from movementX/Y when event type is mousemove', async () => {
    const events = [];

    /** 保存每次移动事件的水平差值，检查相邻移动坐标的 fallback 运算。 */
    const onMouseMove = event => {
      events.push(event.movementX);
    };

    /** 保存按下事件的水平差值，验证非 mousemove 会把回退值清零。 */
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

  /** 同时注册鼠标移动/按下的 capture 与 bubble，再派发两个不同坐标的 mousemove 和一个 mousedown；两阶段分别得到相同的 0/0、6/7、0/0，验证同一原生事件仅更新一次位移缓存且 capture 先执行。 */
  it('should correctly calculate movementX/Y for capture phase', async () => {
    const events = [];

    /** 记录移动 bubble 的两个坐标差值及阶段标识，和本次 capture 对照。 */
    const onMouseMove = event => {
      events.push(['move', false, event.movementX, event.movementY]);
    };

    /** 记录移动 capture 的坐标差，验证它首次归一化后 bubble 不会重新计算为零。 */
    const onMouseMoveCapture = event => {
      events.push(['move', true, event.movementX, event.movementY]);
    };

    /** 记录按下 bubble 的差值，验证结束移动序列后仍为零。 */
    const onMouseDown = event => {
      events.push(['down', false, event.movementX, event.movementY]);
    };

    /** 记录按下 capture 的差值及阶段顺序，检查两阶段非移动归一化一致。 */
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
