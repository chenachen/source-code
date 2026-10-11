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

  /** 给 div 注册点击 handler 并派发可取消 click；handler 内取消默认前查询为 false，取消后查询与 defaultPrevented 字段都为 true，最终仅调用一次，验证合成默认状态同步。 */
  it('should be able to `preventDefault`', async () => {
    let expectedCount = 0;

    /** 核对点击的默认状态从未阻止到已阻止，并累计一次 handler 执行。 */
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

  /** 分别派发已 preventDefault 的现代 click 和 defaultPrevented getter 返回 undefined、returnValue=false 的 IE8 形状 click；两次合成查询都应直接为 true，验证构造器读取原生默认状态及旧字段回退。 */
  it('should be prevented if nativeEvent is prevented', async () => {
    let expectedCount = 0;

    /** 只检查构造时已阻止默认的状态，用同一 handler 覆盖现代字段与 IE8 returnValue 回退。 */
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
      /** 返回 undefined 模拟旧浏览器缺少 defaultPrevented 值，迫使构造器读取 returnValue。 */
      get() {},
    });
    Object.defineProperty(event, 'returnValue', {
      /** 固定返回 false 模拟 IE8 取消默认的原生 returnValue 标记。 */
      get() {
        return false;
      },
    });
    node.dispatchEvent(event);

    expect(expectedCount).toBe(2);
  });

  /** 派发冒泡 click，handler 内检查传播查询从 false 经 stopPropagation 变为 true，累计一次调用；验证该方法更新合成传播标志，本 case 通过状态查询而非祖先 handler 次数断言。 */
  it('should be able to `stopPropagation`', async () => {
    let expectedCount = 0;

    /** 调用 stopPropagation 前后查询合成状态，累计执行次数确保点击提取成功。 */
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
