/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

'use strict';

let act;
let ViewTransition;
let React;
let ReactServer;
let ReactNoop;
let ReactNoopFlightClient;
let ReactNoopFlightServer;

/** 验证 ViewTransition 能穿过 React Server/Flight 边界，并在客户端按透明边界渲染其子树。 */
describe('ViewTransitionReactServer', () => {
  /** 先加载 react-server 条件导出与 Flight server，再重置为客户端 React/Flight client，建立双环境管线。 */
  beforeEach(() => {
    jest.resetModules();
    jest.mock('react', () => require('react/react.react-server'));
    ReactServer = require('react');
    ViewTransition = ReactServer.ViewTransition;
    ReactNoopFlightServer = require('react-noop-renderer/flight-server');

    jest.resetModules();
    __unmockReact();
    React = require('react');
    ReactNoopFlightClient = require('react-noop-renderer/flight-client');
    ReactNoop = require('react-noop-renderer');
    const InternalTestUtils = require('internal-test-utils');
    act = InternalTestUtils.act;
  });

  /** 恢复模块 mock，避免 react-server 条件导出污染后续客户端测试。 */
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Given Server App 返回 ViewTransition 包裹的 div；When 经 Flight transport 序列化、客户端读取并交给 ReactNoop；Then最终仅渲染 div 文本。通过 Flight 往返与宿主输出验证 ViewTransition 的 Server Component 协议。 */
  // @gate enableViewTransition
  it('can be rendered in React Server', async () => {
    /** 在服务端创建 ViewTransition 元素，避免使用客户端 JSX runtime 混入服务端树。 */
    function App() {
      return ReactServer.createElement(
        ViewTransition,
        {},
        ReactServer.createElement('div', null, 'Hello, Dave!'),
      );
    }

    const transport = ReactNoopFlightServer.render(
      ReactServer.createElement(App, null),
    );

    await act(async () => {
      const app = await ReactNoopFlightClient.read(transport);

      ReactNoop.render(app);
    });

    expect(ReactNoop).toMatchRenderedOutput(<div>Hello, Dave!</div>);
  });
});
