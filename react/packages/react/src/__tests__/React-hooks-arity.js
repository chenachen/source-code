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
let ReactNoop;

describe('arity', () => {
  // 每例重新加载 React 和 Noop renderer，避免上一例的模块级 dispatcher 状态进入下一次挂载。
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
  });

  /** 初挂组件调用 useState 后读取 setter.length，期望为 1；检查公开 setter 只声明 action 形参，而非把内部 Fiber/queue 参数暴露出来。 */
  it("ensure useState setter's arity is correct", () => {
    /** 验证 useState setter 的公开形参数量保持为一个。 */
    function Component() {
      const [, setState] = React.useState(() => 'Halo!');

      expect(setState.length).toBe(1);
      return null;
    }

    ReactNoop.render(<Component />);
  });

  /** 初挂组件取得 useReducer dispatch 后读取 length，期望为 1；验证绑定内部队列后的公开派发函数仍只声明 action 形参。 */
  it("ensure useReducer setter's arity is correct", () => {
    /** 验证 useReducer dispatch 的公开形参数量保持为一个。 */
    function Component() {
      const [, dispatch] = React.useReducer(() => 'Halo!');

      expect(dispatch.length).toBe(1);
      return null;
    }

    ReactNoop.render(<Component />);
  });
});
