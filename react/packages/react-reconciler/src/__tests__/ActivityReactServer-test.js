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
let Activity;
let React;
let ReactServer;
let ReactNoop;
let ReactNoopFlightClient;
let ReactNoopFlightServer;

/** 验证 React Server 产出的 Activity Flight 模型能由客户端解码，并保持 hidden 宿主语义。 */
describe('ActivityReactServer', () => {
  /** 分别建立 react-server 与客户端 React 模块世界，防止条件导出缓存互相污染。 */
  beforeEach(() => {
    jest.resetModules();
    jest.mock('react', () => require('react/react.react-server'));
    ReactServer = require('react');
    Activity = ReactServer.Activity;
    ReactNoopFlightServer = require('react-noop-renderer/flight-server');

    jest.resetModules();
    __unmockReact();
    React = require('react');
    ReactNoopFlightClient = require('react-noop-renderer/flight-client');
    ReactNoop = require('react-noop-renderer');
    const InternalTestUtils = require('internal-test-utils');
    act = InternalTestUtils.act;
  });

  /** 恢复本例安装的模块 mock，避免后续客户端测试继续解析到 react-server 构建。 */
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * Given 服务端 Activity mode 为 hidden；When 经 Flight server 编码、client 解码并交给 Noop renderer；
   * Then 客户端宿主节点保留 hidden 属性与原始文本。
   * 验证机制：Flight transport 与最终渲染树；对应 ReactFlightServer、ReactFlightClient 及 ReactFiberActivityComponent。
   */
  it('can be rendered in React Server', async () => {
    /** 在服务端元素模型中构造 hidden Activity，作为 Flight 往返的最小夹具。 */
    function App() {
      return ReactServer.createElement(
        Activity,
        {mode: 'hidden'},
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

    expect(ReactNoop).toMatchRenderedOutput(
      <div hidden={true}>Hello, Dave!</div>,
    );
  });
});
