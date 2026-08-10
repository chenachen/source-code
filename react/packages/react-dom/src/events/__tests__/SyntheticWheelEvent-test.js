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

describe('SyntheticWheelEvent', () => {
  let container;
  let root;

  beforeEach(() => {
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;

    // 容器必须挂载才能触发事件。
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOMClient.createRoot(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    container = null;
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should normalize properties from the MouseEvent interface」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：事件断言连接 DOMPluginEventSystem 的委托、合成与传播路径。
   */
  it('should normalize properties from the MouseEvent interface', async () => {
    const events = [];
    /** `onWheel`：封装当前用例复用的操作、回调或断言步骤。 */
    const onWheel = event => {
      event.persist();
      events.push(event);
    };
    await act(async () => {
      root.render(<div onWheel={onWheel} />);
    });

    container.firstChild.dispatchEvent(
      new MouseEvent('wheel', {
        bubbles: true,
        button: 1,
      }),
    );

    expect(events.length).toBe(1);
    expect(events[0].button).toBe(1);
  });

  /** 测试场景：验证「should normalize properties from the WheelEvent interface」描述的渲染、交互或错误处理结果。 */
  it('should normalize properties from the WheelEvent interface', async () => {
    const events = [];
    /** `onWheel`：封装当前用例复用的操作、回调或断言步骤。 */
    const onWheel = event => {
      event.persist();
      events.push(event);
    };

    await act(async () => {
      root.render(<div onWheel={onWheel} />);
    });

    let event = new WheelEvent('wheel', {
      bubbles: true,
      deltaX: 10,
      deltaY: -50,
    });
    container.firstChild.dispatchEvent(event);

    event = new MouseEvent('wheel', {
      bubbles: true,
    });
    // JSDOM 不支持这些遗留的 WebKit 属性，因此我们手动添加它们。
    Object.assign(event, {
      wheelDeltaX: -10,
      wheelDeltaY: 50,
    });
    container.firstChild.dispatchEvent(event);

    expect(events.length).toBe(2);
    expect(events[0].deltaX).toBe(10);
    expect(events[0].deltaY).toBe(-50);
    expect(events[1].deltaX).toBe(10);
    expect(events[1].deltaY).toBe(-50);
  });

  /** 测试场景：验证「should be able to `preventDefault` and `stopPropagation`」描述的渲染、交互或错误处理结果。 */
  it('should be able to `preventDefault` and `stopPropagation`', async () => {
    const events = [];
    /** `onWheel`：封装当前用例复用的操作、回调或断言步骤。 */
    const onWheel = event => {
      expect(event.isDefaultPrevented()).toBe(false);
      event.preventDefault();
      expect(event.isDefaultPrevented()).toBe(true);
      event.persist();
      events.push(event);
    };
    await act(async () => {
      root.render(<div onWheel={onWheel} />);
    });

    container.firstChild.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        deltaX: 10,
        deltaY: -50,
      }),
    );

    container.firstChild.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        deltaX: 10,
        deltaY: -50,
      }),
    );

    expect(events.length).toBe(2);
    expect.assertions(5);
  });
});
