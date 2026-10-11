/**
 * Copyright (c) Meta Platforms, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

describe('ReactDOMInReactServer', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.mock('react', () => require('react/react.react-server'));
  });

  /** 把 react 模块替换为 react-server 入口后依次加载 react 与 react-dom；两个 require 都应完成而不抛错，验证 RSC 环境下 DOM 包初始化不会依赖客户端专用 React 导出。 */
  it('can require react-dom', () => {
    // 在 RSC 中，这将被别名化。
    require('react');
    require('react-dom');
  });
});
