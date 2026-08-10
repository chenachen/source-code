/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

describe('ReactDOMIframe', () => {
  let React;
  let ReactDOMClient;
  let act;

  beforeEach(() => {
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    act = require('internal-test-utils').act;
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should trigger load events」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should trigger load events', async () => {
    const onLoadSpy = jest.fn();
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(React.createElement('iframe', {onLoad: onLoadSpy}));
    });
    const iframe = container.firstChild;

    const loadEvent = document.createEvent('Event');
    loadEvent.initEvent('load', false, false);

    await act(() => {
      iframe.dispatchEvent(loadEvent);
    });

    expect(onLoadSpy).toHaveBeenCalled();
  });
});
