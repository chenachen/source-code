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

describe('SelectEventPlugin', () => {
  let container;

  beforeEach(() => {
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    container = null;
  });

  // 见 https://github.com/facebook/react/pull/3639 详情。
  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「does not get confused when dependent events are registered independently」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：事件断言连接 DOMPluginEventSystem 的委托、合成与传播路径。
   */
  it('does not get confused when dependent events are registered independently', async () => {
    const select = jest.fn();
    /** `onSelect`：封装当前用例复用的操作、回调或断言步骤。 */
    const onSelect = event => {
      expect(typeof event).toBe('object');
      expect(event.type).toBe('select');
      expect(event.target).toBe(node);
      select(event.currentTarget);
    };

    const root = ReactDOMClient.createRoot(container);
    const node = await (async function () {
      await act(() => {
        // 将 `onMouseDown` 传递给 React，以便 React 注册一个顶级监听器。
        root.render(<input type="text" onMouseDown={function () {}} />);
      });
      return container.firstChild;
    })();

    // 触发 `mousedown` 与 `mouseup`。注意，React 当前并未监听 `mouseup`。
    node.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
      }),
    );
    node.dispatchEvent(
      new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
      }),
    );

    await act(() => {
      // 现在订阅 `onSelect`。
      root.render(<input type="text" onSelect={onSelect} />);
    });
    node.focus();

    // 这会在 polyfill 中触发 `select` 事件。
    node.dispatchEvent(
      new KeyboardEvent('keydown', {bubbles: true, cancelable: true}),
    );

    // 验证它不会卡住并一直等待此前因尚无顶层监听器而错过的 `mouseup` 事件。
    expect(select).toHaveBeenCalledTimes(1);
  });

  /** 测试场景：验证「should fire `onSelect` when a listener is present」描述的渲染、交互或错误处理结果。 */
  it('should fire `onSelect` when a listener is present', async () => {
    const select = jest.fn();
    /** `onSelect`：封装当前用例复用的操作、回调或断言步骤。 */
    const onSelect = event => {
      expect(typeof event).toBe('object');
      expect(event.type).toBe('select');
      expect(event.target).toBe(node);
      select(event.currentTarget);
    };

    const node = await (async function () {
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<input type="text" onSelect={onSelect} />);
      });
      return container.firstChild;
    })();

    node.focus();

    let nativeEvent = new MouseEvent('focus', {
      bubbles: true,
      cancelable: true,
    });
    node.dispatchEvent(nativeEvent);
    expect(select).toHaveBeenCalledTimes(0);

    nativeEvent = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    });
    node.dispatchEvent(nativeEvent);
    expect(select).toHaveBeenCalledTimes(0);

    nativeEvent = new MouseEvent('mouseup', {bubbles: true, cancelable: true});
    node.dispatchEvent(nativeEvent);
    expect(select).toHaveBeenCalledTimes(1);
  });

  /** 测试场景：验证「should fire `onSelectCapture` when a listener is present」描述的渲染、交互或错误处理结果。 */
  it('should fire `onSelectCapture` when a listener is present', async () => {
    const select = jest.fn();
    /** `onSelectCapture`：封装当前用例复用的操作、回调或断言步骤。 */
    const onSelectCapture = event => {
      expect(typeof event).toBe('object');
      expect(event.type).toBe('select');
      expect(event.target).toBe(node);
      select(event.currentTarget);
    };

    const node = await (async function () {
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<input type="text" onSelectCapture={onSelectCapture} />);
      });
      return container.firstChild;
    })();

    node.focus();

    let nativeEvent = new MouseEvent('focus', {
      bubbles: true,
      cancelable: true,
    });
    node.dispatchEvent(nativeEvent);
    expect(select).toHaveBeenCalledTimes(0);

    nativeEvent = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    });
    node.dispatchEvent(nativeEvent);
    expect(select).toHaveBeenCalledTimes(0);

    nativeEvent = new MouseEvent('mouseup', {bubbles: true, cancelable: true});
    node.dispatchEvent(nativeEvent);
    expect(select).toHaveBeenCalledTimes(1);
  });

  // 针对 https://github.com/facebook/react/issues/11379 的回归测试。
  /** 测试场景：验证「should not wait for `mouseup` after receiving `dragend`」描述的渲染、交互或错误处理结果。 */
  it('should not wait for `mouseup` after receiving `dragend`', async () => {
    const select = jest.fn();
    /** `onSelect`：封装当前用例复用的操作、回调或断言步骤。 */
    const onSelect = event => {
      expect(typeof event).toBe('object');
      expect(event.type).toBe('select');
      expect(event.target).toBe(node);
      select(event.currentTarget);
    };

    const node = await (async function () {
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<input type="text" onSelect={onSelect} />);
      });
      return container.firstChild;
    })();

    node.focus();

    let nativeEvent = new MouseEvent('focus', {
      bubbles: true,
      cancelable: true,
    });
    node.dispatchEvent(nativeEvent);
    expect(select).toHaveBeenCalledTimes(0);

    nativeEvent = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    });
    node.dispatchEvent(nativeEvent);
    expect(select).toHaveBeenCalledTimes(0);

    nativeEvent = new MouseEvent('dragend', {bubbles: true, cancelable: true});
    node.dispatchEvent(nativeEvent);
    expect(select).toHaveBeenCalledTimes(1);
  });

  /** 测试场景：验证「should handle selectionchange events」描述的渲染、交互或错误处理结果。 */
  it('should handle selectionchange events', async function () {
    const onSelect = jest.fn();

    const node = await (async function () {
      const root = ReactDOMClient.createRoot(container);
      await act(() => {
        root.render(<input type="text" onSelect={onSelect} />);
      });
      return container.firstChild;
    })();

    node.focus();

    // 确认在派发 selection change 事件前，处理器尚未被调用。
    expect(onSelect).toHaveBeenCalledTimes(0);

    // 例如，在 macOS 上使用 CMD+A 时会派发该事件。
    document.dispatchEvent(
      new Event('selectionchange', {bubbles: false, cancelable: false}),
    );

    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
