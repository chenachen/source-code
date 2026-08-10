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
  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactNoop = require('react-noop-renderer');
  });

  /**
   * Given：已建立该文件所需的 renderer、容器与测试夹具。
   * When：执行“当前测试”场景的唯一关键操作。
   * Then：断言 Hooks 返回函数的公开形参数量契约 的可观察结果。
   *
   * 验证机制：同时观察返回值、渲染输出或诊断信息，证明结果来自目标分支。
   */
  it("ensure useState setter's arity is correct", () => {
    /** 验证 useState setter 的公开形参数量保持为一个。 */
    function Component() {
      const [, setState] = React.useState(() => 'Halo!');

      expect(setState.length).toBe(1);
      return null;
    }

    ReactNoop.render(<Component />);
  });

  /**
   * 场景：“当前测试”。
   * 机制：验证Hooks 返回函数的公开形参数量契约，锁定可观察结果与失败边界。
   */
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
