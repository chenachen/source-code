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

// 每例重置模块、修补 MessageChannel，并用真实 React 的其余导出加不匹配 version，保留 __actualVersion 供 renderer 版本错误断言。

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

  /** 将 React.version mock 为 18.0.0-whoa-this-aint-the-right-react、保留原真实版本，再 require client；同步导入必须抛出两包要求完全相同版本及各版本值，验证客户端入口门禁。 */
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
  /** 仅构建产物模式定义此路径：React.version mock 为故意不匹配值后 require 默认 server；导入抛出包含 React 与真实 ReactDOM 版本的错误，验证默认服务端门禁。源码惰性配置注入不在此入口断言范围。 */
  it('importing "react-dom/server" throws if version does not match React version', async () => {
    expect(() => require('react-dom/server')).toThrow(
      'Incompatible React versions: The "react" and "react-dom" packages ' +
        'must have the exact same version. Instead got:\n' +
        '  - react:      18.0.0-whoa-this-aint-the-right-react\n' +
        `  - react-dom:  ${actualReactVersion}`,
    );
  });

  // @gate !source
  /** 仅构建模式以故意不匹配 React.version 导入 server.node，要求精确版本错误包含 mock 与真实值，验证 Node 服务端入口门禁。 */
  it('importing "react-dom/server.node" throws if version does not match React version', async () => {
    expect(() => require('react-dom/server.node')).toThrow(
      'Incompatible React versions: The "react" and "react-dom" packages ' +
        'must have the exact same version. Instead got:\n' +
        '  - react:      18.0.0-whoa-this-aint-the-right-react\n' +
        `  - react-dom:  ${actualReactVersion}`,
    );
  });

  // @gate !source
  /** 仅构建模式以故意不匹配 React.version 导入 server.browser，要求精确版本错误包含 mock 与真实值，验证浏览器流服务端入口门禁。 */
  it('importing "react-dom/server.browser" throws if version does not match React version', async () => {
    expect(() => require('react-dom/server.browser')).toThrow(
      'Incompatible React versions: The "react" and "react-dom" packages ' +
        'must have the exact same version. Instead got:\n' +
        '  - react:      18.0.0-whoa-this-aint-the-right-react\n' +
        `  - react-dom:  ${actualReactVersion}`,
    );
  });

  // @gate !source
  /** 仅构建模式以故意不匹配 React.version 导入 server.bun，要求精确版本错误包含 mock 与真实值，验证 Bun 服务端入口门禁。 */
  it('importing "react-dom/server.bun" throws if version does not match React version', async () => {
    expect(() => require('react-dom/server.bun')).toThrow(
      'Incompatible React versions: The "react" and "react-dom" packages ' +
        'must have the exact same version. Instead got:\n' +
        '  - react:      18.0.0-whoa-this-aint-the-right-react\n' +
        `  - react-dom:  ${actualReactVersion}`,
    );
  });

  // @gate !source
  /** 仅构建模式以故意不匹配 React.version 导入 server.edge，要求精确版本错误包含 mock 与真实值，验证 Edge 服务端入口门禁。 */
  it('importing "react-dom/server.edge" throws if version does not match React version', async () => {
    expect(() => require('react-dom/server.edge')).toThrow(
      'Incompatible React versions: The "react" and "react-dom" packages ' +
        'must have the exact same version. Instead got:\n' +
        '  - react:      18.0.0-whoa-this-aint-the-right-react\n' +
        `  - react-dom:  ${actualReactVersion}`,
    );
  });

  /** React.version 为故意不匹配 mock 后 require 默认 static，要求错误列出 mock 与真实 ReactDOM 版本，验证默认预渲染入口门禁。 */
  it('importing "react-dom/static" throws if version does not match React version', async () => {
    expect(() => require('react-dom/static')).toThrow(
      'Incompatible React versions: The "react" and "react-dom" packages ' +
        'must have the exact same version. Instead got:\n' +
        '  - react:      18.0.0-whoa-this-aint-the-right-react\n' +
        `  - react-dom:  ${actualReactVersion}`,
    );
  });

  // @gate !source
  /** 仅构建模式以故意不匹配 React.version 导入 static.node，要求精确版本错误包含 mock 与真实值，验证 Node 预渲染入口门禁。 */
  it('importing "react-dom/static.node" throws if version does not match React version', async () => {
    expect(() => require('react-dom/static.node')).toThrow(
      'Incompatible React versions: The "react" and "react-dom" packages ' +
        'must have the exact same version. Instead got:\n' +
        '  - react:      18.0.0-whoa-this-aint-the-right-react\n' +
        `  - react-dom:  ${actualReactVersion}`,
    );
  });

  /** React.version 为故意不匹配 mock 后 require static.browser，要求错误列出 mock 与真实 ReactDOM 版本，验证浏览器预渲染入口门禁。 */
  it('importing "react-dom/static.browser" throws if version does not match React version', async () => {
    expect(() => require('react-dom/static.browser')).toThrow(
      'Incompatible React versions: The "react" and "react-dom" packages ' +
        'must have the exact same version. Instead got:\n' +
        '  - react:      18.0.0-whoa-this-aint-the-right-react\n' +
        `  - react-dom:  ${actualReactVersion}`,
    );
  });

  /** React.version 为故意不匹配 mock 后 require static.edge，要求错误列出 mock 与真实 ReactDOM 版本，验证 Edge 预渲染入口门禁。 */
  it('importing "react-dom/static.edge" throws if version does not match React version', async () => {
    expect(() => require('react-dom/static.edge')).toThrow(
      'Incompatible React versions: The "react" and "react-dom" packages ' +
        'must have the exact same version. Instead got:\n' +
        '  - react:      18.0.0-whoa-this-aint-the-right-react\n' +
        `  - react-dom:  ${actualReactVersion}`,
    );
  });
});
