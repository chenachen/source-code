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

  /** 先只给 input 注册 onMouseDown，并在 onSelect 尚未存在时派发 mousedown/mouseup；更新加入 onSelect、focus 后派发 keydown，应合成一次 select，验证依赖事件始终更新插件鼠标状态而不受 prop 注册时机干扰。 */
  it('does not get confused when dependent events are registered independently', async () => {
    const select = jest.fn();

    /** 核对 select 对象/type/target 并记录 currentTarget 调用，检查晚注册监听仍能正确提取。 */
    const onSelect = event => {
      expect(typeof event).toBe('object');
      expect(event.type).toBe('select');
      expect(event.target).toBe(node);
      select(event.currentTarget);
    };

    const root = ReactDOMClient.createRoot(container);
    const node = await (async function () {
      await act(() => {
        // 首次 render 仅提供 onMouseDown；createRoot 已注册包含 mouseup 在内的原生监听器。
        root.render(<input type="text" onMouseDown={function () {}} />);
      });
      return container.firstChild;
    })();

    // 在尚无 onSelect prop 时派发 mousedown/mouseup，检查插件的 mouseDown 状态能正确复位。
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

    // 后加入 onSelect 后，keydown 应能合成 select，不应被先前鼠标按下状态阻塞。
    expect(select).toHaveBeenCalledTimes(1);
  });

  /** 已聚焦 input 注册 onSelect，先派发 focus 与 mousedown 均不应触发，mouseup 应一次触发且 target 是 input，验证拖选期间抑制而释放时比较选择快照。 */
  it('should fire `onSelect` when a listener is present', async () => {
    const select = jest.fn();

    /** 校验 bubble select 的事件形状与活动 input 身份，并累计鼠标释放后的调用。 */
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

  /** 已聚焦 input 仅注册 onSelectCapture，focus/mousedown 后仍无调用，mouseup 后一次调用且 target 正确，验证 bubble 运行的 Select 插件能收集两阶段 capture listener。 */
  it('should fire `onSelectCapture` when a listener is present', async () => {
    const select = jest.fn();

    /** 校验仅 capture prop 收到的 select 仍以活动 input 为 target，证明插件自身累积了两阶段。 */
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

  /** 已聚焦 input 在 mousedown 后收到 dragend 而非 mouseup；select 应立即一次触发，验证拖动结束同样清空 mouseDown，不把后续选择检测永久压住。 */
  it('should not wait for `mouseup` after receiving `dragend`', async () => {
    const select = jest.fn();

    /** 记录 dragend 之后的 select，并验证目标不是 dragend 的其它路径节点。 */
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

  /** 聚焦 input 后对 document 派发 bubbles=false 的 selectionchange；此前回调 0、之后 1，验证 document 直接监听及活动控件跟踪能定位并生成 select。 */
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
