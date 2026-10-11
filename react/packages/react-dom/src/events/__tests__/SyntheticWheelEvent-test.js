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

  /** 把带 button=1 的 MouseEvent("wheel") 派发到有 onWheel 的节点；应收到一个合成事件且 button 保留为 1，验证 WheelEvent 继承的 MouseEvent 字段复制。 */
  it('should normalize properties from the MouseEvent interface', async () => {
    const events = [];
    /** 收集含 button 的 wheel 合成事件；persist 为兼容空方法，保存对象不依赖事件池。 */
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

  /** 依次派发标准 deltaX=10/deltaY=-50 的 WheelEvent 与手工补 wheelDeltaX=-10/wheelDeltaY=50 的旧式 MouseEvent；两次合成 delta 都应为 10/-50，验证 WebKit 回退取反后方向一致。 */
  it('should normalize properties from the WheelEvent interface', async () => {
    const events = [];
    /** 保存两种原生 wheel 形状对应的合成事件，以逐项比较标准 delta 和旧 WebKit 回退值。 */
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

  /** 向同一节点连续派发两次 wheel，handler 每次检查默认状态由 false 经 preventDefault 变为 true；事件数组应有两个对象且完成五次断言，验证合成默认标志可更新。本 case 未实际调用 stopPropagation，标题中的该部分没有独立断言。 */
  it('should be able to `preventDefault` and `stopPropagation`', async () => {
    const events = [];
    /** 逐事件核对默认状态更新并保留事件引用，计数和 assertions 数量共同检查两个派发都执行。 */
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
