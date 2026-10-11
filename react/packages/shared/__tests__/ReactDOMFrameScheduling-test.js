/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

describe('ReactDOMFrameScheduling', () => {
  // 重置模块并启用真实 Scheduler，让入口的环境探测发生在本次 require 而非 mock 中。
  beforeEach(() => {
    jest.resetModules();

    jest.unmock('scheduler');
  });

  /**
   * Given：全局 `window` 被移除，模拟纯 Node 环境。
   * When：只导入 react-dom，不调用 DOM API。
   * Then：模块初始化不得抛错。
   *
   * 验证机制：isomorphic 组件也可能静态导入 react-dom，故入口不能在求值阶段无条件
   * 读取 window；`finally` 恢复测试前全局状态。
   */
  it('can import findDOMNode in Node environment', () => {
    const prevWindow = global.window;
    try {
      // 删除 window 后重载模块，确保不是前一次 require cache 偶然通过。
      delete global.window;
      jest.resetModules();
      expect(() => {
        require('react-dom');
      }).not.toThrow();
    } finally {
      global.window = prevWindow;
    }
  });
});
