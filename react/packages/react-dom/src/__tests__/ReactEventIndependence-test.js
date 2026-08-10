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

describe('ReactEventIndependence', () => {
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「does not crash with other react inside」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：事件断言连接 DOMPluginEventSystem 的委托、合成与传播路径。
   */
  it('does not crash with other react inside', async () => {
    let clicks = 0;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOMClient.createRoot(container);
    try {
      await act(() => {
        root.render(
          <div
            onClick={() => clicks++}
            dangerouslySetInnerHTML={{
              __html: '<button data-reactid=".z">click me</div>',
            }}
          />,
        );
      });

      container.firstElementChild.click();
      expect(clicks).toBe(1);
    } finally {
      document.body.removeChild(container);
    }
  });

  /** 测试场景：验证「does not crash with other react outside」描述的渲染、交互或错误处理结果。 */
  it('does not crash with other react outside', async () => {
    let clicks = 0;
    const outer = document.createElement('div');
    document.body.appendChild(outer);
    const root = ReactDOMClient.createRoot(outer);
    try {
      outer.setAttribute('data-reactid', '.z');
      await act(() => {
        root.render(<button onClick={() => clicks++}>click me</button>);
      });
      outer.firstElementChild.click();
      expect(clicks).toBe(1);
    } finally {
      document.body.removeChild(outer);
    }
  });

  /** 测试场景：验证「does not when event fired on unmounted tree」描述的渲染、交互或错误处理结果。 */
  it('does not when event fired on unmounted tree', async () => {
    let clicks = 0;
    const container = document.createElement('div');
    document.body.appendChild(container);
    try {
      const root = ReactDOMClient.createRoot(container);

      await act(() => {
        root.render(<button onClick={() => clicks++}>click me</button>);
      });

      const button = container.firstChild;

      // 现在卸载组件，模拟非 React 事件处理器先响应同一次点击并关闭浮层的情况：
      root.unmount();
      button.click();

      // 树已卸载，因此不会派发 click 事件。
      expect(clicks).toBe(0);
    } finally {
      document.body.removeChild(container);
    }
  });
});
