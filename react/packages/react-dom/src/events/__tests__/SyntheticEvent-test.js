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

describe('SyntheticEvent', () => {
  let container;
  let root;

  beforeEach(() => {
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;

    container = document.createElement('div');
    root = ReactDOMClient.createRoot(container);
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    container = null;
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should be able to `preventDefault`」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：事件断言连接 DOMPluginEventSystem 的委托、合成与传播路径。
   */
  it('should be able to `preventDefault`', async () => {
    let expectedCount = 0;

    /** `eventHandler`：封装当前用例复用的操作、回调或断言步骤。 */
    const eventHandler = syntheticEvent => {
      expect(syntheticEvent.isDefaultPrevented()).toBe(false);
      syntheticEvent.preventDefault();
      expect(syntheticEvent.isDefaultPrevented()).toBe(true);
      expect(syntheticEvent.defaultPrevented).toBe(true);

      expectedCount++;
    };
    const nodeRef = React.createRef();
    await act(async () => {
      root.render(<div onClick={eventHandler} ref={nodeRef} />);
    });
    const node = nodeRef.current;

    const event = document.createEvent('Event');
    event.initEvent('click', true, true);
    node.dispatchEvent(event);

    expect(expectedCount).toBe(1);
  });

  /** 测试场景：验证「should be prevented if nativeEvent is prevented」描述的渲染、交互或错误处理结果。 */
  it('should be prevented if nativeEvent is prevented', async () => {
    let expectedCount = 0;

    /** `eventHandler`：封装当前用例复用的操作、回调或断言步骤。 */
    const eventHandler = syntheticEvent => {
      expect(syntheticEvent.isDefaultPrevented()).toBe(true);

      expectedCount++;
    };
    const nodeRef = React.createRef();
    await act(async () => {
      root.render(<div onClick={eventHandler} ref={nodeRef} />);
    });
    const node = nodeRef.current;

    let event;
    event = document.createEvent('Event');
    event.initEvent('click', true, true);
    event.preventDefault();
    node.dispatchEvent(event);

    event = document.createEvent('Event');
    event.initEvent('click', true, true);
    // 模拟 IE8
    Object.defineProperty(event, 'defaultPrevented', {
      /** `get`：实现测试夹具的生命周期、渲染或交互步骤。 */
      get() {},
    });
    Object.defineProperty(event, 'returnValue', {
      /** `get`：实现测试夹具的生命周期、渲染或交互步骤。 */
      get() {
        return false;
      },
    });
    node.dispatchEvent(event);

    expect(expectedCount).toBe(2);
  });

  /** 测试场景：验证「should be able to `stopPropagation`」描述的渲染、交互或错误处理结果。 */
  it('should be able to `stopPropagation`', async () => {
    let expectedCount = 0;

    /** `eventHandler`：封装当前用例复用的操作、回调或断言步骤。 */
    const eventHandler = syntheticEvent => {
      expect(syntheticEvent.isPropagationStopped()).toBe(false);
      syntheticEvent.stopPropagation();
      expect(syntheticEvent.isPropagationStopped()).toBe(true);

      expectedCount++;
    };
    const nodeRef = React.createRef();
    await act(async () => {
      root.render(<div onClick={eventHandler} ref={nodeRef} />);
    });
    const node = nodeRef.current;

    const event = document.createEvent('Event');
    event.initEvent('click', true, true);
    node.dispatchEvent(event);

    expect(expectedCount).toBe(1);
  });
});
