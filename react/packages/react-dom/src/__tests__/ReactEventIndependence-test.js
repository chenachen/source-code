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

  /** 带 onClick 的宿主 div 内用 innerHTML 注入旧 data-reactid 标记；点击该 div 应累计一次，验证不属于当前 Fiber 的旧标记不会破坏本实例事件派发。 */
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

  /** 在根容器自身加入旧 data-reactid 标记后渲染并点击内部按钮；点击计数应为 1，验证外部旧 React 标记不干扰当前根监听器。 */
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

  /** 保留已渲染按钮引用，卸载整根后再点击该按钮；计数应保持 0，验证已卸载 Fiber 不再作为合成事件派发目标。 */
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
