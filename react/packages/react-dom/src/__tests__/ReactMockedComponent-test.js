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

let MockedComponent;
let ReactDOMServer;

describe('ReactMockedComponent', () => {
  beforeEach(() => {
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    act = require('internal-test-utils').act;

    MockedComponent = class extends React.Component {
      /** `render`：实现测试夹具的生命周期、渲染或交互步骤。 */
      render() {
        throw new Error('Should not get here.');
      }
    };
    // 这已经足够接近于 Jest 模拟提供的结果了。
    MockedComponent.prototype.render = jest.fn();
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「should allow a mocked component to be rendered」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('should allow a mocked component to be rendered', async () => {
    const container = document.createElement('container');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<MockedComponent />);
    });
  });

  /** 测试场景：验证「should allow a mocked component to be updated in dev」描述的渲染、交互或错误处理结果。 */
  it('should allow a mocked component to be updated in dev', async () => {
    const container = document.createElement('container');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<MockedComponent />);
    });
    await act(() => {
      root.render(<MockedComponent />);
    });
  });

  /** 测试场景：验证「should allow a mocked component to be rendered in dev (SSR)」描述的渲染、交互或错误处理结果。 */
  it('should allow a mocked component to be rendered in dev (SSR)', () => {
    ReactDOMServer.renderToString(<MockedComponent />);
  });
});
