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

// 每个用例从重新加载的 Scheduler 模块提取 API，并通过 `runtime` 驱动可观测的 host 事件。
let Scheduler;
let runtime;
let performance;
let cancelCallback;
let scheduleCallback;
let NormalPriority;
let UserBlockingPriority;

// Scheduler 会从 `setImmediate`、`MessageChannel` 和 `setTimeout` 中选择 host API；真实宿主对这些
// API 的事件顺序和时机没有统一到足以覆盖全部边界。本套件用确定性 runtime 固定 `setImmediate`
// 分支，只显式触发 host callback，从而验证 Scheduler 自身状态而非某个浏览器的偶然时序。
describe('SchedulerDOMSetImmediate', () => {
  beforeEach(() => {
    jest.resetModules();
    runtime = installMockBrowserRuntime();
    jest.unmock('scheduler');

    performance = global.performance;
    Scheduler = require('scheduler');
    cancelCallback = Scheduler.unstable_cancelCallback;
    scheduleCallback = Scheduler.unstable_scheduleCallback;
    NormalPriority = Scheduler.unstable_NormalPriority;
    UserBlockingPriority = Scheduler.unstable_UserBlockingPriority;
  });

  afterEach(() => {
    delete global.performance;

    if (!runtime.isLogEmpty()) {
      throw Error('Test exited without clearing log.');
    }
  });

  /**
   * 安装只实现 Scheduler 所需能力的 `setImmediate` 宿主，并返回虚拟时钟与事件日志控制器。
   *
   * WHY：Scheduler 在模块初始化时捕获 host API，因此必须先安装 mock、再 require 模块；
   * 单槽 `pendingSetImmediateCallback` 还会主动暴露重复安排 host callback 的状态错误。
   *
   * @returns 用于推进时间、触发 host callback 以及消费日志的测试控制器。
   */
  function installMockBrowserRuntime() {
    /** 为 mock timer 分配稳定 id；此套件只观察 Scheduler 是否尝试设置 timer。 */
    let timerIDCounter = 0;
    // let timerIDs = new Map();

    /** 记录 host 操作和任务副作用；每次断言后清空，形成严格的阶段边界。 */
    let eventLog = [];

    /** Scheduler 读取的单调虚拟时间，单位毫秒。 */
    let currentTime = 0;

    global.performance = {
      /** 返回由测试显式推进的虚拟时间，避免墙钟造成不确定结果。 */
      now() {
        return currentTime;
      },
    };

    // 这里只记录 fallback timer 请求；`setImmediate` 可用时不应依赖 timer 执行工作。
    global.setTimeout = (cb, delay) => {
      const id = timerIDCounter++;
      log(`Set Timer`);
      return id;
    };
    global.clearTimeout = id => {
      // TODO：若未来执行 fallback timer，需按 id 取消；当前套件只验证 `setImmediate` 分支，不触发 timer。
    };

    // 若 Scheduler 错误选择 `MessageChannel`，立即抛错；正确路径应优先使用 `setImmediate`。
    global.MessageChannel = function () {
      return {
        port1: {},
        port2: {
          /** 防护分支：本套件中调用它即表示 host API 优先级选择错误。 */
          postMessage() {
            throw Error('Should be unused');
          },
        },
      };
    };

    /** 当前等待触发的唯一 `setImmediate` 回调；非空时再次安排代表 Scheduler 重复唤醒。 */
    let pendingSetImmediateCallback = null;
    /** 捕获一个 host callback，直到测试调用 `fireSetImmediate()` 才执行。 */
    global.setImmediate = function (cb) {
      if (pendingSetImmediateCallback) {
        throw Error('Message event already scheduled');
      }
      log('Set Immediate');
      pendingSetImmediateCallback = cb;
    };

    /** 要求上一阶段日志已被断言消费，防止不同 host 事件的副作用混入同一断言。 */
    function ensureLogIsEmpty() {
      if (eventLog.length !== 0) {
        throw Error('Log is not empty. Call assertLog before continuing.');
      }
    }

    /** 推进 Scheduler 可见的虚拟时间；不自动触发任何 host callback。 */
    function advanceTime(ms) {
      currentTime += ms;
    }

    /**
     * 触发并清除当前 `setImmediate` 回调。
     * 先清空 pending 槽再执行，使回调内部可以合法安排下一次 host 事件。
     */
    function fireSetImmediate() {
      ensureLogIsEmpty();
      if (!pendingSetImmediateCallback) {
        throw Error('No setImmediate was scheduled');
      }
      const cb = pendingSetImmediateCallback;
      pendingSetImmediateCallback = null;
      log('setImmediate Callback');
      cb();
    }

    /** 将任务或 host 副作用追加到当前阶段日志。 */
    function log(val) {
      eventLog.push(val);
    }

    /** 判断当前阶段日志是否已全部消费，供 `afterEach` 检测遗漏断言。 */
    function isLogEmpty() {
      return eventLog.length === 0;
    }

    /** 原子地取出并清空阶段日志，再按完整顺序断言。 */
    function assertLog(expected) {
      const actual = eventLog;
      eventLog = [];
      expect(actual).toEqual(expected);
    }
    return {
      advanceTime,
      fireSetImmediate,
      log,
      isLogEmpty,
      assertLog,
    };
  }

  /**
   * Given：Scheduler 已在模块初始化时捕获原始 `setImmediate`，随后全局函数被覆盖为抛错实现。
   * When：安排并触发一个 Normal 任务。
   * Then：任务仍通过原始 mock host callback 完成，覆盖实现从未被调用。
   *
   * 验证机制：完整日志只含 `Set Immediate → callback → Task`，且测试未抛出覆盖函数的错误。
   * 对应源码：`Scheduler.js` 模块级 `localSetImmediate` 捕获及 `schedulePerformWorkUntilDeadline()`。
   */
  it('does not use setImmediate override', () => {
    global.setImmediate = () => {
      throw new Error('Should not throw');
    };

    scheduleCallback(NormalPriority, () => {
      runtime.log('Task');
    });
    runtime.assertLog(['Set Immediate']);
    runtime.fireSetImmediate();
    runtime.assertLog(['setImmediate Callback', 'Task']);
  });

  /** 场景：未耗尽时间片的单个任务应在一次 `setImmediate` host 事件内完成，不安排续事件。 */
  it('task that finishes before deadline', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('Task');
    });
    runtime.assertLog(['Set Immediate']);
    runtime.fireSetImmediate();
    runtime.assertLog(['setImmediate Callback', 'Task']);
  });

  /**
   * Given：Normal 回调运行到 `shouldYield()` 为 true 后返回 continuation。
   * When：依次触发两个 `setImmediate` host 事件。
   * Then：首事件记录 yield 并安排续事件，第二个事件才执行 continuation。
   *
   * 验证机制：日志同时断言时间片阈值、重新安排 `Set Immediate` 以及 continuation 的事件隔离。
   * 对应源码：`workLoop()` 保存返回函数为 `currentTask.callback`，随后 host 循环安排下一轮。
   */
  it('task with continuation', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('Task');
      while (!Scheduler.unstable_shouldYield()) {
        runtime.advanceTime(1);
      }
      runtime.log(`Yield at ${performance.now()}ms`);
      return () => {
        runtime.log('Continuation');
      };
    });
    runtime.assertLog(['Set Immediate']);

    runtime.fireSetImmediate();
    runtime.assertLog([
      'setImmediate Callback',
      'Task',
      gate(flags => (flags.www ? 'Yield at 10ms' : 'Yield at 5ms')),
      'Set Immediate',
    ]);

    runtime.fireSetImmediate();
    runtime.assertLog(['setImmediate Callback', 'Continuation']);
  });

  /** 场景：两个同优先级任务共享时间片；`enableAlwaysYieldScheduler` 开启时每轮只执行一个任务。 */
  it('multiple tasks', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('A');
    });
    scheduleCallback(NormalPriority, () => {
      runtime.log('B');
    });
    runtime.assertLog(['Set Immediate']);
    runtime.fireSetImmediate();
    if (gate(flags => flags.enableAlwaysYieldScheduler)) {
      runtime.assertLog(['setImmediate Callback', 'A', 'Set Immediate']);
      runtime.fireSetImmediate();
      runtime.assertLog(['setImmediate Callback', 'B']);
    } else {
      runtime.assertLog(['setImmediate Callback', 'A', 'B']);
    }
  });

  /** 场景：UserBlocking 与 Normal 任务同时就绪时，高优先级任务先执行；同样覆盖强制逐任务 yield 配置。 */
  it('multiple tasks at different priority', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('A');
    });
    scheduleCallback(UserBlockingPriority, () => {
      runtime.log('B');
    });
    runtime.assertLog(['Set Immediate']);
    runtime.fireSetImmediate();
    if (gate(flags => flags.enableAlwaysYieldScheduler)) {
      runtime.assertLog(['setImmediate Callback', 'B', 'Set Immediate']);
      runtime.fireSetImmediate();
      runtime.assertLog(['setImmediate Callback', 'A']);
    } else {
      runtime.assertLog(['setImmediate Callback', 'B', 'A']);
    }
  });

  /**
   * Given：任务 A 消耗完当前时间片，任务 B 仍在 ready queue。
   * When：触发首个 host callback。
   * Then：A 后立即安排新 `setImmediate`，B 延迟到下一 host 事件。
   * 对应源码：`workLoop()` 的 `shouldYieldToHost()` 分支。
   */
  it('multiple tasks with a yield in between', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('A');
      runtime.advanceTime(4999);
    });
    scheduleCallback(NormalPriority, () => {
      runtime.log('B');
    });
    runtime.assertLog(['Set Immediate']);
    runtime.fireSetImmediate();
    runtime.assertLog([
      'setImmediate Callback',
      'A',
      // 时间片已耗尽，Scheduler 只安排后续 host 事件，不在本轮执行 B。
      'Set Immediate',
    ]);
    runtime.fireSetImmediate();
    runtime.assertLog(['setImmediate Callback', 'B']);
  });

  /** 场景：取消 ready task 会将 callback 置空；尚未触发的 host 事件可保留，但任务副作用不得出现。 */
  it('cancels tasks', () => {
    const task = scheduleCallback(NormalPriority, () => {
      runtime.log('Task');
    });
    runtime.assertLog(['Set Immediate']);
    cancelCallback(task);
    runtime.assertLog([]);
  });

  /**
   * Given：首个任务抛错，后面仍有一个 ready task。
   * When：触发首个 host callback 并捕获错误，再触发恢复后安排的事件。
   * Then：错误原样传播，第二个任务仍在新事件中执行。
   *
   * 验证机制：首轮日志要求错误任务后出现 `Set Immediate`；后续日志要求 `Yay`，覆盖异常清理与重调度。
   * 对应源码：`performWorkUntilDeadline()` 的 `finally`/重新唤醒路径。
   */
  it('throws when a task errors then continues in a new event', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('Oops!');
      throw Error('Oops!');
    });
    scheduleCallback(NormalPriority, () => {
      runtime.log('Yay');
    });
    runtime.assertLog(['Set Immediate']);

    expect(() => runtime.fireSetImmediate()).toThrow('Oops!');
    runtime.assertLog(['setImmediate Callback', 'Oops!', 'Set Immediate']);

    runtime.fireSetImmediate();
    if (gate(flags => flags.enableAlwaysYieldScheduler)) {
      runtime.assertLog(['setImmediate Callback', 'Set Immediate']);
      runtime.fireSetImmediate();
      runtime.assertLog(['setImmediate Callback', 'Yay']);
    } else {
      runtime.assertLog(['setImmediate Callback', 'Yay']);
    }
  });

  /** 场景：ready queue 正常排空后再次安排任务，Scheduler 必须重新请求 host callback。 */
  it('schedule new task after queue has emptied', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('A');
    });

    runtime.assertLog(['Set Immediate']);
    runtime.fireSetImmediate();
    runtime.assertLog(['setImmediate Callback', 'A']);

    scheduleCallback(NormalPriority, () => {
      runtime.log('B');
    });
    runtime.assertLog(['Set Immediate']);
    runtime.fireSetImmediate();
    runtime.assertLog(['setImmediate Callback', 'B']);
  });

  /** 场景：取消队列唯一任务并消费空 host 事件后，新任务仍能重新唤醒 Scheduler。 */
  it('schedule new task after a cancellation', () => {
    const handle = scheduleCallback(NormalPriority, () => {
      runtime.log('A');
    });

    runtime.assertLog(['Set Immediate']);
    cancelCallback(handle);

    runtime.fireSetImmediate();
    runtime.assertLog(['setImmediate Callback']);

    scheduleCallback(NormalPriority, () => {
      runtime.log('B');
    });
    runtime.assertLog(['Set Immediate']);
    runtime.fireSetImmediate();
    runtime.assertLog(['setImmediate Callback', 'B']);
  });
});

/**
 * 场景：Node 环境缺少 `setImmediate` 时导入 Scheduler 不应崩溃，而应继续选择其他 host API。
 * 对应源码：`schedulePerformWorkUntilDeadline` 的 `MessageChannel`/`setTimeout` fallback 选择。
 */
test('does not crash if setImmediate is undefined', () => {
  jest.resetModules();
  const originalSetImmediate = global.setImmediate;
  try {
    delete global.setImmediate;
    jest.unmock('scheduler');
    expect(() => {
      require('scheduler');
    }).not.toThrow();
  } finally {
    // 始终恢复 Node 全局 API，避免该兼容性用例污染后续测试。
    global.setImmediate = originalSetImmediate;
  }
});
