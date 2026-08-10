/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

/* eslint-disable no-for-of-loops/no-for-of-loops */

'use strict';

// 每个用例从 `scheduler/unstable_post_task` 重新提取 API，并由 runtime 控制 postTask promise 的执行时机。
let Scheduler;
let runtime;
let performance;
let cancelCallback;
let scheduleCallback;
let ImmediatePriority;
let NormalPriority;
let UserBlockingPriority;
let LowPriority;
let IdlePriority;
let shouldYield;

// postTask 变体依赖实验性的浏览器 Scheduler API。本套件 mock `postTask`、`yield`、`TaskController`
// 和错误上报 timer，以显式排空任务并验证优先级映射、continuation、取消与错误隔离，不依赖真实浏览器时序。
describe('SchedulerPostTask', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.mock('scheduler', () =>
      jest.requireActual('scheduler/unstable_post_task'),
    );

    runtime = installMockBrowserRuntime();
    performance = window.performance;
    Scheduler = require('scheduler');
    cancelCallback = Scheduler.unstable_cancelCallback;
    scheduleCallback = Scheduler.unstable_scheduleCallback;
    ImmediatePriority = Scheduler.unstable_ImmediatePriority;
    UserBlockingPriority = Scheduler.unstable_UserBlockingPriority;
    NormalPriority = Scheduler.unstable_NormalPriority;
    LowPriority = Scheduler.unstable_LowPriority;
    IdlePriority = Scheduler.unstable_IdlePriority;
    shouldYield = Scheduler.unstable_shouldYield;
  });

  afterEach(() => {
    if (!runtime.isLogEmpty()) {
      throw Error('Test exited without clearing log.');
    }
  });

  /**
   * 安装 postTask 变体所需的最小浏览器 runtime，并返回虚拟时钟、任务队列和日志控制器。
   *
   * WHY：实现会在模块初始化时捕获 `window.performance`、`window.setTimeout` 和 `global.scheduler`；
   * 因此必须先安装 mock 再 require。队列以 `TaskController` 为键，使 abort 能精确删除对应任务。
   *
   * @returns 用于推进时间、显式排空 postTask/yield continuation 以及消费日志的控制器。
   */
  function installMockBrowserRuntime() {
    /** 当前批次尚未触发的 postTask 或 yield continuation，以 controller 作为取消键。 */
    let taskQueue = new Map();
    /** 记录 native API 调用和用户 callback 副作用；每次断言后清空。 */
    let eventLog = [];

    // 提供实现模块初始化时捕获的最小 `window` 能力。
    const window = {};
    global.window = window;

    /** 为每个 mock native task 分配稳定 id，便于断言原任务与 continuation 的边界。 */
    let idCounter = 0;
    /** `performance.now()` 读取的单调虚拟时间，单位毫秒。 */
    let currentTime = 0;
    window.performance = {
      /** 返回测试显式推进的虚拟时间。 */
      now() {
        return currentTime;
      },
    };

    // `SchedulerPostTask.runTask()` 仅用该 timer 将 Promise 链中的异常转移到普通 browser task 上报。
    window.setTimeout = cb => {
      try {
        cb();
      } catch (error) {
        runtime.log(`Error: ${error.message}`);
      }
    };

    // 安装实验性 browser Scheduler API 的确定性替身。
    const scheduler = {};
    global.scheduler = scheduler;

    /**
     * 捕获一个 native postTask，并返回由 `flushTasks()` 结算的 Promise。
     * signal 同时携带 native priority 与其 controller，供日志和取消路径使用。
     */
    scheduler.postTask = function (callback, {signal}) {
      const {priority} = signal;
      const id = idCounter++;
      log(
        `Post Task ${id} [${priority === undefined ? '<default>' : priority}]`,
      );
      const controller = signal._controller;
      return new Promise((resolve, reject) => {
        taskQueue.set(controller, {id, callback, resolve, reject});
      });
    };

    /**
     * 捕获 continuation yield；`.then()` 注册的 callback 才是稍后入队的实际续任务。
     * 返回 thenable 而非立即 resolved Promise，确保测试能显式控制异步边界。
     */
    scheduler.yield = function ({signal}) {
      const {priority} = signal;
      const id = idCounter++;
      log(`Yield ${id} [${priority === undefined ? '<default>' : priority}]`);
      const controller = signal._controller;
      let callback;

      return {
        /** 登记 yield 后的 continuation，并返回可被实现追加 `.catch()` 的 Promise。 */
        then(cb) {
          callback = cb;
          return new Promise((resolve, reject) => {
            taskQueue.set(controller, {id, callback, resolve, reject});
          });
        },
      };
    };

    /** 模拟原生 `TaskController`：signal 保存优先级，abort 通过 controller 身份取消任务。 */
    global.TaskController = class TaskController {
      /** 创建与当前 controller 双向关联的 signal。 */
      constructor({priority}) {
        /** 传给 postTask/yield 的 signal；`_controller` 只供该测试 runtime 找回所有者。 */
        this.signal = {_controller: this, priority};
      }

      /**
       * 删除尚未触发的任务并 reject 其 Promise。
       * 已执行或不存在的任务保持幂等；实现的 `handleAbortError()` 会吞掉该内部取消错误。
       */
      abort() {
        const task = taskQueue.get(this);
        if (task !== undefined) {
          taskQueue.delete(this);
          const reject = task.reject;
          reject(new Error('Aborted'));
        }
      }
    };

    /** 要求上一阶段日志已经断言消费，防止不同 native task 批次相互污染。 */
    function ensureLogIsEmpty() {
      if (eventLog.length !== 0) {
        throw Error('Log is not empty. Call assertLog before continuing.');
      }
    }

    /** 推进 Scheduler 的 5ms deadline 所使用的虚拟时间，不自动执行任务。 */
    function advanceTime(ms) {
      currentTime += ms;
    }

    /**
     * 执行调用开始时已经入队的全部 native task，并结算其 Promise。
     *
     * WHY：callback 可能通过 `scheduler.yield()` 或 fallback `postTask()` 安排 continuation；先交换
     * 为新 Map 可让 continuation 留到下一批，避免循环尾部误删或在同一宏任务中执行。
     */
    function flushTasks() {
      ensureLogIsEmpty();

      // callback 若安排 continuation，会写入新 Map；保存旧队列后立刻换批，保证续任务属于下一 host task。
      const prevTaskQueue = taskQueue;
      taskQueue = new Map();
      for (const [, {id, callback, resolve}] of prevTaskQueue) {
        log(`Task ${id} Fired`);
        callback(false);
        resolve();
      }
    }

    /** 将 native API 操作或 callback 副作用追加到阶段日志。 */
    function log(val) {
      eventLog.push(val);
    }

    /** 判断阶段日志是否全部消费，供 `afterEach` 捕获漏断言。 */
    function isLogEmpty() {
      return eventLog.length === 0;
    }

    /** 原子取出并清空阶段日志，再断言 native task 与用户 callback 的完整顺序。 */
    function assertLog(expected) {
      const actual = eventLog;
      eventLog = [];
      expect(actual).toEqual(expected);
    }
    return {
      advanceTime,
      flushTasks,
      log,
      isLogEmpty,
      assertLog,
    };
  }

  /**
   * Given：一个 Normal callback 已安排。
   * When：排空当前 native task 批次。
   * Then：它以 `user-visible` postTask 执行完成且不产生 continuation。
   *
   * 验证机制：分别断言 native 安排日志和 `Task 0 Fired → A`。
   * 对应源码：`unstable_scheduleCallback()` 的优先级映射与 `runTask()` 完成分支。
   */
  it('task that finishes before deadline', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('A');
    });
    runtime.assertLog(['Post Task 0 [user-visible]']);
    runtime.flushTasks();
    runtime.assertLog(['Task 0 Fired', 'A']);
  });

  /**
   * Given：Normal callback 消耗到 5ms deadline 后返回 continuation，且宿主提供 `scheduler.yield`。
   * When：分两批排空 native task。
   * Then：首批通过 `Yield 1 [user-visible]` 安排续任务，第二批才调用 continuation。
   *
   * 验证机制：日志同时证明 deadline、priority 继承和跨批执行。
   * 对应源码：`runTask()` 的 `scheduler.yield(...).then(nextTask)` 分支。
   */
  it('task with continuation', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('A');
      while (!Scheduler.unstable_shouldYield()) {
        runtime.advanceTime(1);
      }
      runtime.log(`Yield at ${performance.now()}ms`);
      return () => {
        runtime.log('Continuation');
      };
    });
    runtime.assertLog(['Post Task 0 [user-visible]']);

    runtime.flushTasks();
    runtime.assertLog([
      'Task 0 Fired',
      'A',
      'Yield at 5ms',
      'Yield 1 [user-visible]',
    ]);

    runtime.flushTasks();
    runtime.assertLog(['Task 1 Fired', 'Continuation']);
  });

  /** 场景：两个 Normal callback 各自映射为独立 `user-visible` postTask，并按 mock 队列顺序执行。 */
  it('multiple tasks', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('A');
    });
    scheduleCallback(NormalPriority, () => {
      runtime.log('B');
    });
    runtime.assertLog([
      'Post Task 0 [user-visible]',
      'Post Task 1 [user-visible]',
    ]);
    runtime.flushTasks();
    runtime.assertLog(['Task 0 Fired', 'A', 'Task 1 Fired', 'B']);
  });

  /**
   * 场景：取消尚未触发的 postTask 会通过 `TaskController.abort()` 从 native 队列删除它，callback 不执行。
   * 对应源码：`unstable_cancelCallback()` 与被抑制的 `handleAbortError()`。
   */
  it('cancels tasks', () => {
    const task = scheduleCallback(NormalPriority, () => {
      runtime.log('A');
    });
    runtime.assertLog(['Post Task 0 [user-visible]']);
    cancelCallback(task);
    runtime.flushTasks();
    runtime.assertLog([]);
  });

  /**
   * Given：两个独立 postTask 中首任务抛错。
   * When：同一批次依次触发它们。
   * Then：错误经普通 timer 上报为日志，第二个 native task 仍正常执行。
   *
   * 验证机制：完整日志要求 `Error: Oops!` 位于两个 fired 事件之间。
   * 对应源码：`runTask()` catch 中通过捕获的 `setTimeout` 重新抛错。
   */
  it('an error in one task does not affect execution of other tasks', () => {
    scheduleCallback(NormalPriority, () => {
      throw Error('Oops!');
    });
    scheduleCallback(NormalPriority, () => {
      runtime.log('Yay');
    });
    runtime.assertLog([
      'Post Task 0 [user-visible]',
      'Post Task 1 [user-visible]',
    ]);
    runtime.flushTasks();
    runtime.assertLog(['Task 0 Fired', 'Error: Oops!', 'Task 1 Fired', 'Yay']);
  });

  /** 场景：native task queue 正常排空后，后续 callback 仍可创建新 id 并被下一批排空。 */
  it('schedule new task after queue has emptied', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('A');
    });

    runtime.assertLog(['Post Task 0 [user-visible]']);
    runtime.flushTasks();
    runtime.assertLog(['Task 0 Fired', 'A']);

    scheduleCallback(NormalPriority, () => {
      runtime.log('B');
    });
    runtime.assertLog(['Post Task 1 [user-visible]']);
    runtime.flushTasks();
    runtime.assertLog(['Task 1 Fired', 'B']);
  });

  /** 场景：取消当前唯一 native task 后队列为空；新 callback 仍能通过新 controller 正常安排并执行。 */
  it('schedule new task after a cancellation', () => {
    const handle = scheduleCallback(NormalPriority, () => {
      runtime.log('A');
    });

    runtime.assertLog(['Post Task 0 [user-visible]']);
    cancelCallback(handle);

    runtime.flushTasks();
    runtime.assertLog([]);

    scheduleCallback(NormalPriority, () => {
      runtime.log('B');
    });
    runtime.assertLog(['Post Task 1 [user-visible]']);
    runtime.flushTasks();
    runtime.assertLog(['Task 1 Fired', 'B']);
  });

  /**
   * Given：五种 Scheduler priority 各安排一个 callback。
   * When：观察传给 browser postTask 的 priority 并排空任务。
   * Then：Immediate/UserBlocking 映射 `user-blocking`，Normal/Low 映射 `user-visible`，Idle 映射 `background`。
   *
   * 验证机制：先断言五次 native 调用参数，再断言每个 callback 都执行。
   * 对应源码：`unstable_scheduleCallback()` 的 priority switch。
   */
  it('schedules tasks at different priorities', () => {
    scheduleCallback(ImmediatePriority, () => {
      runtime.log('A');
    });
    scheduleCallback(UserBlockingPriority, () => {
      runtime.log('B');
    });
    scheduleCallback(NormalPriority, () => {
      runtime.log('C');
    });
    scheduleCallback(LowPriority, () => {
      runtime.log('D');
    });
    scheduleCallback(IdlePriority, () => {
      runtime.log('E');
    });
    runtime.assertLog([
      'Post Task 0 [user-blocking]',
      'Post Task 1 [user-blocking]',
      'Post Task 2 [user-visible]',
      'Post Task 3 [user-visible]',
      'Post Task 4 [background]',
    ]);
    runtime.flushTasks();
    runtime.assertLog([
      'Task 0 Fired',
      'A',
      'Task 1 Fired',
      'B',
      'Task 2 Fired',
      'C',
      'Task 3 Fired',
      'D',
      'Task 4 Fired',
      'E',
    ]);
  });

  /**
   * Given：callback 在 `shouldYield()` 为 false 且时间仍为 0 时主动返回 continuation。
   * When：排空首批 native task。
   * Then：continuation 仍通过 `scheduler.yield` 进入下一 host task，而不在本批继续执行。
   * 对应源码：`runTask()` 对函数返回值的 continuation 分支。
   */
  it('yielding continues in a new task regardless of how much time is remaining', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('Original Task');
      runtime.log('shouldYield: ' + shouldYield());
      runtime.log('Return a continuation');
      return () => {
        runtime.log('Continuation Task');
      };
    });
    runtime.assertLog(['Post Task 0 [user-visible]']);

    runtime.flushTasks();
    runtime.assertLog([
      'Task 0 Fired',
      'Original Task',
      // 返回 continuation 前 `shouldYield` 为 false，证明不是 deadline 迫使本轮结束。
      'shouldYield: false',
      'Return a continuation',

      // 即使时间片仍有余额，continuation 也必须通过独立 host task 恢复。
      'Yield 1 [user-visible]',
    ]);

    // 虚拟时间未推进，排除时间片耗尽这一竞争解释。
    expect(performance.now()).toBe(0);

    runtime.flushTasks();
    runtime.assertLog(['Task 1 Fired', 'Continuation Task']);
  });

  // 某些 postTask 宿主尚未实现 `scheduler.yield`；此组验证兼容 fallback 保持相同事件边界。
  describe('falls back to postTask for scheduling continuations when scheduler.yield is not available', () => {
    beforeEach(() => {
      delete global.scheduler.yield;
    });

    /**
     * Given：宿主缺少 `scheduler.yield`，callback 到达 deadline 后返回 continuation。
     * When：排空首批任务。
     * Then：实现改用相同 signal 的新 `postTask`，续任务在下一批执行。
     * 对应源码：`runTask()` 的 `scheduler.postTask(nextTask, continuationOptions)` fallback。
     */
    it('task with continuation', () => {
      scheduleCallback(NormalPriority, () => {
        runtime.log('A');
        while (!Scheduler.unstable_shouldYield()) {
          runtime.advanceTime(1);
        }
        runtime.log(`Yield at ${performance.now()}ms`);
        return () => {
          runtime.log('Continuation');
        };
      });
      runtime.assertLog(['Post Task 0 [user-visible]']);

      runtime.flushTasks();
      runtime.assertLog([
        'Task 0 Fired',
        'A',
        'Yield at 5ms',
        'Post Task 1 [user-visible]',
      ]);

      runtime.flushTasks();
      runtime.assertLog(['Task 1 Fired', 'Continuation']);
    });

    /** 场景：即使时间片仍有余额，缺少 `scheduler.yield` 时 continuation 也必须由新 postTask 隔离执行。 */
    it('yielding continues in a new task regardless of how much time is remaining', () => {
      scheduleCallback(NormalPriority, () => {
        runtime.log('Original Task');
        runtime.log('shouldYield: ' + shouldYield());
        runtime.log('Return a continuation');
        return () => {
          runtime.log('Continuation Task');
        };
      });
      runtime.assertLog(['Post Task 0 [user-visible]']);

      runtime.flushTasks();
      runtime.assertLog([
        'Task 0 Fired',
        'Original Task',
        // 返回 continuation 前 `shouldYield` 为 false，证明当前时间片仍有余额。
        'shouldYield: false',
        'Return a continuation',

        // fallback 仍须安排独立 postTask，不能在当前 Promise callback 中同步继续。
        'Post Task 1 [user-visible]',
      ]);

      // 虚拟时间未推进，确认跨任务边界来自 continuation 规则而非 deadline。
      expect(performance.now()).toBe(0);

      runtime.flushTasks();
      runtime.assertLog(['Task 1 Fired', 'Continuation Task']);
    });
  });
});
