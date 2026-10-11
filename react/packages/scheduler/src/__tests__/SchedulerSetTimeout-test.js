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

// 套件级绑定让用例共享本次重新加载的 Scheduler API；模块重置用于隔离队列状态。
let Scheduler;
let scheduleCallback;
/**
 * 错误恢复用例传入的 priority 绑定；本文件未赋值，因此实现走未知 priority 的默认 timeout 分支。
 * 该用例只验证异常后的队列恢复，不据此证明 Immediate priority 语义。
 */
let ImmediatePriority;
let UserBlockingPriority;
let NormalPriority;

describe('SchedulerNoDOM', () => {
  // 无 `setImmediate` 和 `MessageChannel` 时，Scheduler 会退化为基于 `setTimeout` 的简单 host 实现。
  // 该路径主要服务 Jest fake timers 等测试环境；这里固定 host 能力后再加载模块，确保选中该分支。
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    delete global.setImmediate;
    delete global.MessageChannel;
    jest.unmock('scheduler');

    Scheduler = require('scheduler');
    scheduleCallback = Scheduler.unstable_scheduleCallback;
    UserBlockingPriority = Scheduler.unstable_UserBlockingPriority;
    NormalPriority = Scheduler.unstable_NormalPriority;
  });

  /**
   * Given：三个同优先级回调已入队，但 fake timers 尚未推进。
   * When：`jest.runAllTimers()` 触发 Scheduler 的 `setTimeout` host callback。
   * Then：三个回调按入队顺序全部执行；always-yield 构建可能分成多次 timer，runAllTimers 会继续排空。
   *
   * 验证机制：执行 timer 前后分别断言日志为空和 `A → B → C`，证明入队本身不执行工作，
   * host timer 才驱动 `flushWork()`，且同一 `expirationTime` 的任务由 id 保持 FIFO。
   * 对应源码：`Scheduler.js` 的 `requestHostCallback()`、`performWorkUntilDeadline()` 与 `workLoop()`。
   */
  it('runAllTimers flushes all scheduled callbacks', () => {
    const log = [];
    scheduleCallback(NormalPriority, () => {
      log.push('A');
    });
    scheduleCallback(NormalPriority, () => {
      log.push('B');
    });
    scheduleCallback(NormalPriority, () => {
      log.push('C');
    });
    expect(log).toEqual([]);
    jest.runAllTimers();
    expect(log).toEqual(['A', 'B', 'C']);
  });

  /**
   * Given：Normal 与 UserBlocking 回调交错入队。
   * When：fake timers 一次排空 host timer。
   * Then：更早过期的 UserBlocking 组先执行，各组内部仍保持 FIFO。
   *
   * 验证机制：日志同时覆盖跨优先级排序和同优先级稳定顺序。
   * 对应源码：`unstable_scheduleCallback()` 计算 `expirationTime`，`SchedulerMinHeap.compare()` 再以 task id 破平局。
   */
  it('executes callbacks in order of priority', () => {
    const log = [];

    scheduleCallback(NormalPriority, () => {
      log.push('A');
    });
    scheduleCallback(NormalPriority, () => {
      log.push('B');
    });
    scheduleCallback(UserBlockingPriority, () => {
      log.push('C');
    });
    scheduleCallback(UserBlockingPriority, () => {
      log.push('D');
    });

    expect(log).toEqual([]);
    jest.runAllTimers();
    expect(log).toEqual(['C', 'D', 'A', 'B']);
  });

  /**
   * Given：三个回调中，第一个和第三个会抛错。
   * When：分两次排空 fake timers。
   * Then：每次只向调用方传播当前事件遇到的错误；剩余任务会在后续 host 事件继续执行。
   *
   * 验证机制：先断言 `Oops A` 与日志 `A`，再断言 `Oops C` 与日志 `B、C`，证明异常不会吞掉
   * 后续错误，也不会让 Scheduler 永久停在 `isHostCallbackScheduled` 状态。
   * 对应源码：`performWorkUntilDeadline()` 的异常恢复与重新调度分支。
   */
  it('handles errors', () => {
    let log = [];

    scheduleCallback(ImmediatePriority, () => {
      log.push('A');
      throw new Error('Oops A');
    });
    scheduleCallback(ImmediatePriority, () => {
      log.push('B');
    });
    scheduleCallback(ImmediatePriority, () => {
      log.push('C');
      throw new Error('Oops C');
    });

    expect(() => jest.runAllTimers()).toThrow('Oops A');

    expect(log).toEqual(['A']);

    log = [];

    // `B` 和 `C` 在后续事件中继续排空，使第二个错误拥有独立的传播机会而不会被首个错误吞掉。
    expect(() => jest.runAllTimers()).toThrow('Oops C');
    expect(log).toEqual(['B', 'C']);
  });
});

// 回归背景：https://github.com/facebook/react/pull/13088
describe('does not crash non-node SSR environments', () => {
  /**
   * 场景：SSR runtime 没有 `setTimeout` 时，仅导入 Scheduler 也不应在模块初始化阶段抛错。
   * 对应源码：host timer API 的初始化与 `localSetTimeout` fallback。
   */
  it('if setTimeout is undefined', () => {
    jest.resetModules();
    const originalSetTimeout = global.setTimeout;
    try {
      delete global.setTimeout;
      jest.unmock('scheduler');
      expect(() => {
        require('scheduler');
      }).not.toThrow();
    } finally {
      // 无论断言是否失败都恢复全局 API，避免污染同进程中的其他测试。
      global.setTimeout = originalSetTimeout;
    }
  });

  /**
   * 场景：SSR runtime 没有 `clearTimeout` 时，仅导入 Scheduler 仍应成功。
   * 对应源码：host timer API 的初始化与 `localClearTimeout` fallback。
   */
  it('if clearTimeout is undefined', () => {
    jest.resetModules();
    const originalClearTimeout = global.clearTimeout;
    try {
      delete global.clearTimeout;
      jest.unmock('scheduler');
      expect(() => {
        require('scheduler');
      }).not.toThrow();
    } finally {
      // 清理必须放在 `finally`，确保 require 或断言抛错时也恢复宿主环境。
      global.clearTimeout = originalClearTimeout;
    }
  });
});
