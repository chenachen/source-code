/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

import {patchMessageChannel} from '../../../../scripts/jest/patchMessageChannel';

describe('ReactMismatchedVersions-test', () => {
// 为测试环境补齐流式服务端入口所需的 Web API。
  global.ReadableStream =
    require('web-streams-polyfill/ponyfill/es6').ReadableStream;
  global.TextEncoder = require('util').TextEncoder;

  let React;
  let actualReactVersion;

  beforeEach(() => {
    jest.resetModules();

    patchMessageChannel();

    jest.mock('react', () => {
      const actualReact = jest.requireActual('react');
      return {
        ...actualReact,
        version: '18.0.0-whoa-this-aint-the-right-react',
        __actualVersion: actualReact.version,
      };
    });
    React = require('react');
    actualReactVersion = React.__actualVersion;
  });

  /**
   * Given：已建立该文件所需的 renderer、容器与测试夹具。
   * When：执行“当前测试”场景的唯一关键操作。
   * Then：断言 React 与 ReactDOM 版本一致性门禁 的可观察结果。
   *
   * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
   */
  it('importing "react-dom/client" throws if version does not match React version', async () => {
    expect(() => require('react-dom/client')).toThrow(
      'Incompatible React versions: The "react" and "react-dom" packages ' +
        'must have the exact same version. Instead got:\n' +
        '  - react:      18.0.0-whoa-this-aint-the-right-react\n' +
        `  - react-dom:  ${actualReactVersion}`,
    );
  });

      // 源码模式通过惰性 require 模拟构建期静态配置注入，只有调用 API 触发加载时才会报错；
      // 因此构建产物模式已足以验证导入时版本门禁。
  // @gate !source
  /**
   * 场景：“当前测试”。
   * 机制：验证React 与 ReactDOM 版本一致性门禁，锁定可观察结果与失败边界。
   */
  it('importing "react-dom/server" throws if version does not match React version', async () => {
    expect(() => require('react-dom/server')).toThrow(
      'Incompatible React versions: The "react" and "react-dom" packages ' +
        'must have the exact same version. Instead got:\n' +
        '  - react:      18.0.0-whoa-this-aint-the-right-react\n' +
        `  - react-dom:  ${actualReactVersion}`,
    );
  });

  // @gate !source
  /**
   * 场景：“当前测试”。
   * 机制：验证React 与 ReactDOM 版本一致性门禁，锁定可观察结果与失败边界。
   */
  it('importing "react-dom/server.node" throws if version does not match React version', async () => {
    expect(() => require('react-dom/server.node')).toThrow(
      'Incompatible React versions: The "react" and "react-dom" packages ' +
        'must have the exact same version. Instead got:\n' +
        '  - react:      18.0.0-whoa-this-aint-the-right-react\n' +
        `  - react-dom:  ${actualReactVersion}`,
    );
  });

  // @gate !source
  /**
   * 场景：“当前测试”。
   * 机制：验证React 与 ReactDOM 版本一致性门禁，锁定可观察结果与失败边界。
   */
  it('importing "react-dom/server.browser" throws if version does not match React version', async () => {
    expect(() => require('react-dom/server.browser')).toThrow(
      'Incompatible React versions: The "react" and "react-dom" packages ' +
        'must have the exact same version. Instead got:\n' +
        '  - react:      18.0.0-whoa-this-aint-the-right-react\n' +
        `  - react-dom:  ${actualReactVersion}`,
    );
  });

  // @gate !source
  /**
   * 场景：“当前测试”。
   * 机制：验证React 与 ReactDOM 版本一致性门禁，锁定可观察结果与失败边界。
   */
  it('importing "react-dom/server.bun" throws if version does not match React version', async () => {
    expect(() => require('react-dom/server.bun')).toThrow(
      'Incompatible React versions: The "react" and "react-dom" packages ' +
        'must have the exact same version. Instead got:\n' +
        '  - react:      18.0.0-whoa-this-aint-the-right-react\n' +
        `  - react-dom:  ${actualReactVersion}`,
    );
  });

  // @gate !source
  /**
   * 场景：“当前测试”。
   * 机制：验证React 与 ReactDOM 版本一致性门禁，锁定可观察结果与失败边界。
   */
  it('importing "react-dom/server.edge" throws if version does not match React version', async () => {
    expect(() => require('react-dom/server.edge')).toThrow(
      'Incompatible React versions: The "react" and "react-dom" packages ' +
        'must have the exact same version. Instead got:\n' +
        '  - react:      18.0.0-whoa-this-aint-the-right-react\n' +
        `  - react-dom:  ${actualReactVersion}`,
    );
  });

  /**
   * 场景：“当前测试”。
   * 机制：验证React 与 ReactDOM 版本一致性门禁，锁定可观察结果与失败边界。
   */
  it('importing "react-dom/static" throws if version does not match React version', async () => {
    expect(() => require('react-dom/static')).toThrow(
      'Incompatible React versions: The "react" and "react-dom" packages ' +
        'must have the exact same version. Instead got:\n' +
        '  - react:      18.0.0-whoa-this-aint-the-right-react\n' +
        `  - react-dom:  ${actualReactVersion}`,
    );
  });

  // @gate !source
  /**
   * 场景：“当前测试”。
   * 机制：验证React 与 ReactDOM 版本一致性门禁，锁定可观察结果与失败边界。
   */
  it('importing "react-dom/static.node" throws if version does not match React version', async () => {
    expect(() => require('react-dom/static.node')).toThrow(
      'Incompatible React versions: The "react" and "react-dom" packages ' +
        'must have the exact same version. Instead got:\n' +
        '  - react:      18.0.0-whoa-this-aint-the-right-react\n' +
        `  - react-dom:  ${actualReactVersion}`,
    );
  });

  /**
   * 场景：“当前测试”。
   * 机制：验证React 与 ReactDOM 版本一致性门禁，锁定可观察结果与失败边界。
   */
  it('importing "react-dom/static.browser" throws if version does not match React version', async () => {
    expect(() => require('react-dom/static.browser')).toThrow(
      'Incompatible React versions: The "react" and "react-dom" packages ' +
        'must have the exact same version. Instead got:\n' +
        '  - react:      18.0.0-whoa-this-aint-the-right-react\n' +
        `  - react-dom:  ${actualReactVersion}`,
    );
  });

  /**
   * 场景：“当前测试”。
   * 机制：验证React 与 ReactDOM 版本一致性门禁，锁定可观察结果与失败边界。
   */
  it('importing "react-dom/static.edge" throws if version does not match React version', async () => {
    expect(() => require('react-dom/static.edge')).toThrow(
      'Incompatible React versions: The "react" and "react-dom" packages ' +
        'must have the exact same version. Instead got:\n' +
        '  - react:      18.0.0-whoa-this-aint-the-right-react\n' +
        `  - react-dom:  ${actualReactVersion}`,
    );
  });
});
