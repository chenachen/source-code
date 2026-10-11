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

let React;
let ReactNoop;
let assertConsoleErrorDev;
let waitForAll;
let waitForThrow;

/** 验证并发 render 失败后的错误重放：宿主错误应上抛，而仅首次失败的组件可由同步重试恢复。 */
describe('ReactIncrementalErrorReplay', () => {
  /** 每例重置 Noop renderer 与控制台断言工具，隔离根状态及已消费错误。 */
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactNoop = require('react-noop-renderer');

    const InternalTestUtils = require('internal-test-utils');
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;
    waitForAll = InternalTestUtils.waitForAll;
    waitForThrow = InternalTestUtils.waitForThrow;
  });

  /**
   * Given 会在 begin phase 由 HostConfig 抛错的宿主类型；When Noop root 开始并发渲染；
   * Then work loop 以原错误结束，而非进入无效恢复循环。
   * 验证机制：waitForThrow；对应 ReactFiberBeginWork 与 ReactFiberWorkLoop 的宿主错误传播路径。
   */
  it('should fail gracefully on error in the host environment', async () => {
    ReactNoop.render(<errorInBeginPhase />);
    await waitForThrow('Error in host config.');
  });

  /**
   * Given 用户惰性初始化器仅在第一次 render 抛错；When 并发尝试失败后 React 同步重放整根；
   * Then 第二次初始化成功、根完成提交，并只记录“已同步恢复”诊断。
   * 验证机制：空调度日志与 console error；对应 ReactFiberWorkLoop 的 error replay/synchronous retry。
   */
  it("should ignore error if it doesn't throw on retry", async () => {
    let didInit = false;

    /** 首次调用抛错、后续调用成功，精确区分原始 render 与同步重放。 */
    function badLazyInit() {
      const needsInit = !didInit;
      didInit = true;
      if (needsInit) {
        throw new Error('Hi');
      }
    }

    /** 在 render 中调用一次性失败初始化器，作为可恢复并发错误夹具。 */
    class App extends React.Component {
      /** 执行初始化器；重放成功后返回稳定宿主节点。 */
      render() {
        badLazyInit();
        return <div />;
      }
    }
    ReactNoop.render(<App />);
    await waitForAll([]);
    assertConsoleErrorDev([
      'Error: There was an error during concurrent rendering but React was able to recover by instead synchronously rendering the entire root.' +
        '\n    in <stack>',
    ]);
  });
});
