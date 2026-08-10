/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use strict';

describe('SyntheticFocusEvent', () => {
  let React;
  let ReactDOMClient;
  let act;
  let container;

  beforeEach(() => {
    jest.resetModules();
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

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「onFocus events have the focus type」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：事件断言连接 DOMPluginEventSystem 的委托、合成与传播路径。
   */
  it('onFocus events have the focus type', async () => {
    const log = [];
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <button
          onFocus={event => log.push(`onFocus: ${event.type}`)}
          onFocusCapture={event => log.push(`onFocusCapture: ${event.type}`)}
        />,
      );
    });

    const button = container.querySelector('button');

    await act(() => {
      button.dispatchEvent(
        new FocusEvent('focusin', {
          bubbles: true,
          cancelable: false,
        }),
      );
    });

    expect(log).toEqual(['onFocusCapture: focus', 'onFocus: focus']);
  });

  /** 测试场景：验证「onBlur events have the blur type」描述的渲染、交互或错误处理结果。 */
  it('onBlur events have the blur type', async () => {
    const log = [];
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(
        <button
          onBlur={event => log.push(`onBlur: ${event.type}`)}
          onBlurCapture={event => log.push(`onBlurCapture: ${event.type}`)}
        />,
      );
    });

    const button = container.querySelector('button');

    await act(() => {
      button.dispatchEvent(
        new FocusEvent('focusout', {
          bubbles: true,
          cancelable: false,
        }),
      );
    });

    expect(log).toEqual(['onBlurCapture: blur', 'onBlur: blur']);
  });
});
