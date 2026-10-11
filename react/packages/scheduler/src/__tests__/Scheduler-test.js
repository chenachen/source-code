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

// 每个用例重新加载 Scheduler，并把公开 API 与 feature flags 绑定到本套件的确定性 browser runtime。
let Scheduler;
let runtime;
let performance;
let cancelCallback;
let scheduleCallback;
let requestPaint;
let shouldYield;
let NormalPriority;
let SchedulerFeatureFlags;

// Scheduler 使用 `MessageChannel`、`setTimeout` 等浏览器 API 驱动主线程工作，但不同浏览器并不
// 保证完全相同的事件时序。本套件 mock 实现会显式记录和触发每个 host 事件，以最少时序假设
// 重现 yield、错误恢复、取消及浏览器输入事件等边界。
describe('SchedulerBrowser', () => {
  // host API 在 require 前安装；每例重置模块，强制重新捕获确定性的浏览器驱动。
  beforeEach(() => {
    jest.resetModules();
    runtime = installMockBrowserRuntime();
    jest.unmock('scheduler');

    performance = global.performance;
    Scheduler = require('scheduler');
    cancelCallback = Scheduler.unstable_cancelCallback;
    scheduleCallback = Scheduler.unstable_scheduleCallback;
    NormalPriority = Scheduler.unstable_NormalPriority;
    requestPaint = Scheduler.unstable_requestPaint;
    shouldYield = Scheduler.unstable_shouldYield;
    SchedulerFeatureFlags = require('../SchedulerFeatureFlags');
  });

  afterEach(() => {
    delete global.performance;

    if (!runtime.isLogEmpty()) {
      throw Error('Test exited without clearing log.');
    }
  });

  /**
   * 安装以 `MessageChannel` 为主驱动的确定性浏览器 runtime。
   *
   * WHY：Scheduler 在模块初始化时选择并捕获 host API，所以 runtime 必须先安装；显式 pending
   * 标志还能检测重复 post message、任务执行期间输入事件的延后顺序，以及异常后的状态恢复。
   *
   * @returns 推进虚拟时间、触发 message event、模拟输入事件并消费日志的测试控制器。
   */
  function installMockBrowserRuntime() {
    /** 是否已有尚未触发的 Scheduler message event；同一时刻最多允许一个。 */
    let hasPendingMessageEvent = false;
    /** 标记当前是否正在执行 message handler，用于模拟事件只能在 handler 返回后派发。 */
    let isFiringMessageEvent = false;
    /** handler 执行期间到达的离散输入事件。 */
    let hasPendingDiscreteEvent = false;
    /** handler 执行期间到达的连续输入事件。 */
    let hasPendingContinuousEvent = false;

    /** 为 fallback timer 生成稳定 id；timer 本身不在此套件执行。 */
    let timerIDCounter = 0;
    // let timerIDs = new Map();

    /** host 操作和任务副作用的阶段日志；每次断言后清空。 */
    let eventLog = [];

    /** Scheduler 可见的单调虚拟时间，单位毫秒。 */
    let currentTime = 0;

    global.performance = {
      /** 返回测试显式推进的虚拟时间，排除真实墙钟噪声。 */
      now() {
        return currentTime;
      },
    };

    // 删除 Node 提供的 `setImmediate`，强制 Scheduler 选择待验证的 `MessageChannel` 分支。
    delete global.setImmediate;

    // fallback timer 只记录安排动作；本套件关注 message event，不主动执行 timer callback。
    /** 仅记录 timer 安排并返回递增 id；cb/delay 不执行，当前套件不验证延迟任务。 */
    global.setTimeout = (cb, delay) => {
      const id = timerIDCounter++;
      log(`Set Timer`);
      // TODO：若新增 delayed task 用例，需保存 `cb`/`delay` 并由虚拟时钟触发；当前只观察 timer 安排动作。
      return id;
    };
    /** 接受 Scheduler 取消的 timer id；未保存 timer callback，因此此 fixture 无操作。 */
    global.clearTimeout = id => {
      // TODO：实现上述 timer 队列后按 id 删除；当前没有 callback 会从该空实现中泄漏执行。
    };

    /** Scheduler 写入 `onmessage` handler 的接收端。 */
    const port1 = {};
    /** 测试可观测的发送端；重复 post 表示 host callback 去重状态失效。 */
    const port2 = {
      /** 安排唯一待处理 message event，并记录 Scheduler 的唤醒动作。 */
      postMessage() {
        if (hasPendingMessageEvent) {
          throw Error('Message event already scheduled');
        }
        log('Post Message');
        hasPendingMessageEvent = true;
      },
    };
    /** 为 Scheduler 构造共享的 mock channel 两端。 */
    global.MessageChannel = function MessageChannel() {
      this.port1 = port1;
      this.port2 = port2;
    };

    /** 要求前一阶段日志已被断言消费，防止多个事件的观察结果意外混合。 */
    function ensureLogIsEmpty() {
      if (eventLog.length !== 0) {
        throw Error('Log is not empty. Call assertLog before continuing.');
      }
    }

    /** 推进 Scheduler 可见的虚拟时间；不会隐式触发 host 或输入事件。 */
    function advanceTime(ms) {
      currentTime += ms;
    }

    /** 将虚拟时钟归零，供需要隔离时间预算的场景重新建立基线。 */
    function resetTime() {
      currentTime = 0;
    }

    /**
     * 触发当前待处理 message event，并在 handler 返回或抛错后派发期间积压的输入事件。
     *
     * 状态：调用 handler 前清除 pending 标志，允许 Scheduler 在本轮内安排续事件；`finally`
     * 始终恢复 firing 状态并派发输入，确保异常路径与正常路径拥有相同的宿主清理语义。
     */
    function fireMessageEvent() {
      ensureLogIsEmpty();
      if (!hasPendingMessageEvent) {
        throw Error('No message event was scheduled');
      }
      hasPendingMessageEvent = false;
      const onMessage = port1.onmessage;
      log('Message Event');

      isFiringMessageEvent = true;
      try {
        onMessage();
      } finally {
        isFiringMessageEvent = false;
        if (hasPendingDiscreteEvent) {
          log('Discrete Event');
          hasPendingDiscreteEvent = false;
        }
        if (hasPendingContinuousEvent) {
          log('Continuous Event');
          hasPendingContinuousEvent = false;
        }
      }
    }

    /** 模拟离散输入；Scheduler handler 执行中到达时延迟到 handler 退出后记录。 */
    function scheduleDiscreteEvent() {
      if (isFiringMessageEvent) {
        hasPendingDiscreteEvent = true;
      } else {
        log('Discrete Event');
      }
    }

    /** 模拟连续输入；与离散输入分开记录，以验证两类 pending 状态均会被释放。 */
    function scheduleContinuousEvent() {
      if (isFiringMessageEvent) {
        hasPendingContinuousEvent = true;
      } else {
        log('Continuous Event');
      }
    }

    /** 将 host 操作、任务或输入事件追加到当前阶段日志。 */
    function log(val) {
      eventLog.push(val);
    }

    /** 判断阶段日志是否已消费，供 `afterEach` 检测漏断言。 */
    function isLogEmpty() {
      return eventLog.length === 0;
    }

    /** 原子取出并清空日志，再对完整事件顺序做断言。 */
    function assertLog(expected) {
      const actual = eventLog;
      eventLog = [];
      expect(actual).toEqual(expected);
    }
    return {
      advanceTime,
      resetTime,
      fireMessageEvent,
      log,
      isLogEmpty,
      assertLog,
      scheduleDiscreteEvent,
      scheduleContinuousEvent,
    };
  }

  /**
   * Given：一个 Normal 任务已入 ready queue。
   * When：触发 Scheduler post 的 message event。
   * Then：任务在同一 host event 内完成，且不再 post continuation event。
   *
   * 验证机制：分阶段断言 `Post Message` 与 `Message Event → Task`。
   * 对应源码：`requestHostCallback()`、`performWorkUntilDeadline()` 和 `workLoop()` 完成分支。
   */
  it('task that finishes before deadline', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('Task');
    });
    runtime.assertLog(['Post Message']);
    runtime.fireMessageEvent();
    runtime.assertLog(['Message Event', 'Task']);
  });

  /**
   * Given：任务请求 paint，并运行到 Scheduler 判断应 yield 后返回 continuation。
   * When：连续触发两个 message event。
   * Then：首轮保存 continuation 并 post 新事件，第二轮才执行它；yield 时间随 feature flag 变化。
   *
   * 验证机制：日志同时断言 paint/时间片门限、第二次 `Post Message` 与 continuation 的事件隔离。
   * 对应源码：`unstable_requestPaint()`、`shouldYieldToHost()` 与 `workLoop()` continuation 分支。
   */
  it('task with continuation', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('Task');
      // 请求 paint 后，启用 `enableRequestPaint` 的实现可在时间预算耗尽前主动 yield。
      requestPaint();
      while (!Scheduler.unstable_shouldYield()) {
        runtime.advanceTime(1);
      }
      runtime.log(`Yield at ${performance.now()}ms`);
      return () => {
        runtime.log('Continuation');
      };
    });
    runtime.assertLog(['Post Message']);

    runtime.fireMessageEvent();
    runtime.assertLog([
      'Message Event',
      'Task',
      gate(flags => flags.enableAlwaysYieldScheduler) ||
      !SchedulerFeatureFlags.enableRequestPaint
        ? gate(flags => (flags.www ? 'Yield at 10ms' : 'Yield at 5ms'))
        : 'Yield at 0ms',
      'Post Message',
    ]);

    runtime.fireMessageEvent();
    runtime.assertLog(['Message Event', 'Continuation']);
  });

  /** 入队 A/B 两个 Normal 任务后触发 message，日志要求按 A/B 顺序；逐任务 yield 配置分两轮，验证同过期时间以 id 保持 FIFO。 */
  it('multiple tasks', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('A');
    });
    scheduleCallback(NormalPriority, () => {
      runtime.log('B');
    });
    runtime.assertLog(['Post Message']);
    runtime.fireMessageEvent();
    if (gate(flags => flags.enableAlwaysYieldScheduler)) {
      runtime.assertLog(['Message Event', 'A', 'Post Message']);
      runtime.fireMessageEvent();
      runtime.assertLog(['Message Event', 'B']);
    } else {
      runtime.assertLog(['Message Event', 'A', 'B']);
    }
  });

  /**
   * 场景：任务 A 消耗完时间片后，B 必须留在 ready queue，并由新 post 的 message event 执行。
   * 输入两个 Normal 任务，A 推进时钟 4999ms；两次 fireMessageEvent 的日志分别只含 A
   * 与 B，验证未过期的 B 不会因堆中已有工作而忽略当前时间片结束。
   * 对应源码：`workLoop()` 在未过期任务且 `shouldYieldToHost()` 为 true 时返回 `hasMoreWork`。
   */
  it('multiple tasks with a yield in between', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('A');
      runtime.advanceTime(4999);
    });
    scheduleCallback(NormalPriority, () => {
      runtime.log('B');
    });
    runtime.assertLog(['Post Message']);
    runtime.fireMessageEvent();
    runtime.assertLog([
      'Message Event',
      'A',
      // 时间片已耗尽，只 post 后续 host 事件，不在当前轮执行 B。
      'Post Message',
    ]);
    runtime.fireMessageEvent();
    runtime.assertLog(['Message Event', 'B']);
  });

  /**
   * 场景：取消唯一 ready task 后仍可消费已经 post 的 host event，但被取消 callback 不得产生副作用。
   * scheduleCallback 返回 handle 后先 cancel，再 fireMessageEvent；日志只含宿主事件，
   * 验证取消不撤销已 post 的 message，但会消除任务 callback 的执行。
   * 对应源码：`unstable_cancelCallback()` 将 callback 置空，`workLoop()` 到达堆顶时惰性移除。
   */
  it('cancels tasks', () => {
    const task = scheduleCallback(NormalPriority, () => {
      runtime.log('Task');
    });
    runtime.assertLog(['Post Message']);
    cancelCallback(task);
    runtime.fireMessageEvent();
    runtime.assertLog(['Message Event']);
  });

  /**
   * Given：首任务抛错，后面仍有一个 ready task。
   * When：捕获首个 message event 的错误，再触发 Scheduler 安排的新事件。
   * Then：错误原样传播，后续任务仍执行。
   *
   * 验证机制：首轮错误日志后必须出现 `Post Message`，后续轮必须记录 `Yay`。
   * 对应源码：`performWorkUntilDeadline()` 的异常恢复和重新安排 host callback 路径。
   */
  it('throws when a task errors then continues in a new event', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('Oops!');
      throw Error('Oops!');
    });
    scheduleCallback(NormalPriority, () => {
      runtime.log('Yay');
    });
    runtime.assertLog(['Post Message']);

    expect(() => runtime.fireMessageEvent()).toThrow('Oops!');
    runtime.assertLog(['Message Event', 'Oops!', 'Post Message']);

    runtime.fireMessageEvent();
    if (gate(flags => flags.enableAlwaysYieldScheduler)) {
      runtime.assertLog(['Message Event', 'Post Message']);
      runtime.fireMessageEvent();
    }
    runtime.assertLog(['Message Event', 'Yay']);
  });

  /** 先触发 message 执行 A 排空队列，再入队 B；日志要求再次 Post Message 并执行 B，验证正常完成后的唤醒状态恢复。 */
  it('schedule new task after queue has emptied', () => {
    scheduleCallback(NormalPriority, () => {
      runtime.log('A');
    });

    runtime.assertLog(['Post Message']);
    runtime.fireMessageEvent();
    runtime.assertLog(['Message Event', 'A']);

    scheduleCallback(NormalPriority, () => {
      runtime.log('B');
    });
    runtime.assertLog(['Post Message']);
    runtime.fireMessageEvent();
    runtime.assertLog(['Message Event', 'B']);
  });

  /** 入队 A 后取消并消费空 message，再入队 B；日志要求重新 Post Message 且只执行 B，验证取消路径也清理 host 循环状态。 */
  it('schedule new task after a cancellation', () => {
    const handle = scheduleCallback(NormalPriority, () => {
      runtime.log('A');
    });

    runtime.assertLog(['Post Message']);
    cancelCallback(handle);

    runtime.fireMessageEvent();
    runtime.assertLog(['Message Event']);

    scheduleCallback(NormalPriority, () => {
      runtime.log('B');
    });
    runtime.assertLog(['Post Message']);
    runtime.fireMessageEvent();
    runtime.assertLog(['Message Event', 'B']);
  });

  /**
   * Given：任务在 `shouldYield()` 仍为 false、虚拟时间仍为 0 时主动返回 continuation。
   * When：触发首个 message event。
   * Then：Scheduler 仍把 continuation 推迟到独立宏任务，而不利用本轮剩余时间继续调用。
   *
   * 验证机制：断言零时间流逝、首轮末尾出现 `Post Message`，再由第二轮记录 continuation。
   * 对应源码：`workLoop()` 看到 callback 返回函数后立即返回 `true`。
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
    runtime.assertLog(['Post Message']);

    runtime.fireMessageEvent();
    runtime.assertLog([
      'Message Event',
      'Original Task',
      // 返回 continuation 前 `shouldYield` 仍为 false，证明当前时间片尚有余额。
      'shouldYield: false',
      'Return a continuation',

      // 即使仍有余额，continuation 也必须安排到独立宏任务，避免单个任务链长期占用主线程。
      'Post Message',
    ]);

    // 虚拟时间未推进，排除“因为时间片耗尽才续调度”的竞争解释。
    expect(performance.now()).toBe(0);

    runtime.fireMessageEvent();
    runtime.assertLog(['Message Event', 'Continuation Task']);
  });
});
