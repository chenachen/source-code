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

// 测试通过 `scheduler/unstable_mock` 控制虚拟时间，并把 profiling 二进制事件流渲染为可断言文本。
let Scheduler;
// let runWithPriority;
let ImmediatePriority;
let UserBlockingPriority;
let NormalPriority;
let LowPriority;
let IdlePriority;
let scheduleCallback;
let cancelCallback;
// let wrapCallback;
// let getCurrentPriorityLevel;
// let shouldYield;
let waitForAll;
let waitFor;
let waitForThrow;

/**
 * 将 Scheduler 数值优先级转换为 flamegraph 使用的稳定标签。
 *
 * @param priorityLevel - profiling 事件记录的 Scheduler priority。
 * @returns 已知优先级名称；未知值返回 null，避免测试辅助代码伪造不存在的级别。
 */
function priorityLevelToString(priorityLevel) {
  switch (priorityLevel) {
    case ImmediatePriority:
      return 'Immediate';
    case UserBlockingPriority:
      return 'User-blocking';
    case NormalPriority:
      return 'Normal';
    case LowPriority:
      return 'Low';
    case IdlePriority:
      return 'Idle';
    default:
      return null;
  }
}

describe('Scheduler', () => {
  /** 当前构建是否把 profiling 事件记录逻辑编译进 Scheduler。 */
  const {enableProfiling} = require('scheduler/src/SchedulerFeatureFlags');
  if (!enableProfiling) {
    // 其余用例都依赖 profiling buffer；关闭 feature flag 时只验证 API 明确暴露为 null。
    /** enableProfiling=false 时导入 scheduler，断言 unstable_Profiling 为 null；验证未启用记录器的构建 API 形状，并提前结束本组其余注册。 */
    it('profiling APIs are not available', () => {
      Scheduler = require('scheduler');
      expect(Scheduler.unstable_Profiling).toBe(null);
    });
    return;
  }

  // 每例重载 mock 调度器及记录器，隔离虚拟时钟、任务 id、二进制缓冲区与 helper 日志。
  beforeEach(() => {
    jest.resetModules();
    jest.mock('scheduler', () => require('scheduler/unstable_mock'));
    Scheduler = require('scheduler');

    // runWithPriority = Scheduler.unstable_runWithPriority;
    ImmediatePriority = Scheduler.unstable_ImmediatePriority;
    UserBlockingPriority = Scheduler.unstable_UserBlockingPriority;
    NormalPriority = Scheduler.unstable_NormalPriority;
    LowPriority = Scheduler.unstable_LowPriority;
    IdlePriority = Scheduler.unstable_IdlePriority;
    scheduleCallback = Scheduler.unstable_scheduleCallback;
    cancelCallback = Scheduler.unstable_cancelCallback;
    // wrapCallback = Scheduler.unstable_wrapCallback;
    // getCurrentPriorityLevel = Scheduler.unstable_getCurrentPriorityLevel;
    // shouldYield = Scheduler.unstable_shouldYield;

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    waitFor = InternalTestUtils.waitFor;
    waitForThrow = InternalTestUtils.waitForThrow;
  });

  /** 新任务入队事件；记录时间、task id 与 priority。 */
  const TaskStartEvent = 1;
  /** callback 正常完成事件；任务生命周期终态为 completed。 */
  const TaskCompleteEvent = 2;
  /** callback 抛错事件；任务生命周期终态为 errored。 */
  const TaskErrorEvent = 3;
  /** callback 在完成前被取消事件；任务生命周期终态为 canceled。 */
  const TaskCancelEvent = 4;
  /** 某个 task callback 开始或恢复运行事件。 */
  const TaskRunEvent = 5;
  /** callback 返回 continuation、当前运行片段结束；mock 可在同次 flush 继续运行它。 */
  const TaskYieldEvent = 6;
  /** Scheduler 退出本次 flush 的事件。 */
  const SchedulerSuspendEvent = 7;
  /** Scheduler 进入一次 flush 的事件。 */
  const SchedulerResumeEvent = 8;

  /**
   * 停止 profiling，将 Int32 事件流校验并渲染为按时间对齐的文本 flamegraph。
   *
   * 上游：各测试在完成调度操作后调用，取得 `stopLoggingProfilingEvents()` 的 ArrayBuffer。
   * 状态：第一遍按 task id 还原生命周期和运行区间，同时校验 run/yield/complete 只发生在 work loop 内；
   * 第二遍按 priority 排序并绘制主线程与 task 时间线。未知指令或非法状态立即抛错，避免错误事件流
   * 被宽松快照掩盖。
   *
   * @returns 空 profile 标记，或以 50ms 字符宽度绘制的 flamegraph 文本。
   */
  function stopProfilingAndPrintFlamegraph() {
    const eventBuffer =
      Scheduler.unstable_Profiling.stopLoggingProfilingEvents();
    if (eventBuffer === null) {
      return '(empty profile)';
    }

    const eventLog = new Int32Array(eventBuffer);

    const tasks = new Map();
    const mainThreadRuns = [];

    // profiling 初始处于 work loop 外；Suspend/Resume 必须严格交替，task Run/Yield 只能夹在其中。
    let isSuspended = true;
    let i = 0;
    processLog: while (i < eventLog.length) {
      const instruction = eventLog[i];
      const time = eventLog[i + 1];
      switch (instruction) {
        case 0: {
          break processLog;
        }
        case TaskStartEvent: {
          const taskId = eventLog[i + 2];
          const priorityLevel = eventLog[i + 3];
          const task = {
            id: taskId,
            priorityLevel,
            label: null,
            start: time,
            end: -1,
            exitStatus: null,
            runs: [],
          };
          tasks.set(taskId, task);
          i += 4;
          break;
        }
        case TaskCompleteEvent: {
          if (isSuspended) {
            throw Error('Task cannot Complete outside the work loop.');
          }
          const taskId = eventLog[i + 2];
          const task = tasks.get(taskId);
          if (task === undefined) {
            throw Error('Task does not exist.');
          }
          task.end = time;
          task.exitStatus = 'completed';
          i += 3;
          break;
        }
        case TaskErrorEvent: {
          if (isSuspended) {
            throw Error('Task cannot Error outside the work loop.');
          }
          const taskId = eventLog[i + 2];
          const task = tasks.get(taskId);
          if (task === undefined) {
            throw Error('Task does not exist.');
          }
          task.end = time;
          task.exitStatus = 'errored';
          i += 3;
          break;
        }
        case TaskCancelEvent: {
          const taskId = eventLog[i + 2];
          const task = tasks.get(taskId);
          if (task === undefined) {
            throw Error('Task does not exist.');
          }
          task.end = time;
          task.exitStatus = 'canceled';
          i += 3;
          break;
        }
        case TaskRunEvent:
        case TaskYieldEvent: {
          if (isSuspended) {
            throw Error('Task cannot Run or Yield outside the work loop.');
          }
          const taskId = eventLog[i + 2];
          const task = tasks.get(taskId);
          if (task === undefined) {
            throw Error('Task does not exist.');
          }
          task.runs.push(time);
          i += 4;
          break;
        }
        case SchedulerSuspendEvent: {
          if (isSuspended) {
            throw Error('Scheduler cannot Suspend outside the work loop.');
          }
          isSuspended = true;
          mainThreadRuns.push(time);
          i += 3;
          break;
        }
        case SchedulerResumeEvent: {
          if (!isSuspended) {
            throw Error('Scheduler cannot Resume inside the work loop.');
          }
          isSuspended = false;
          mainThreadRuns.push(time);
          i += 3;
          break;
        }
        default: {
          throw Error('Unknown instruction type: ' + instruction);
        }
      }
    }

    // 事件状态验证完毕后，再把 task 生命周期渲染成 flamegraph。
    /** label 列固定宽度，确保不同 task 行的时间轴起点对齐。 */
    const labelColumnWidth = 30;
    /** Scheduler 事件时间以微秒记录；每个字符表示 50,000 微秒（50ms）。 */
    const microsecondsPerChar = 50000;

    let result = '';

    const mainThreadLabelColumn = '!!! Main thread              ';
    let mainThreadTimelineColumn = '';
    // 该辅助器从 true 开始交替填充：Resume/Suspend 之间画 ░，flush 外画 █。
    // Task 行则以 █ 表示运行；读取 Main thread 行的执行区间应按 Resume/Suspend 边界解释。
    let isMainThreadBusy = true;
    for (const time of mainThreadRuns) {
      const index = time / microsecondsPerChar;
      mainThreadTimelineColumn += (isMainThreadBusy ? '█' : '░').repeat(
        index - mainThreadTimelineColumn.length,
      );
      isMainThreadBusy = !isMainThreadBusy;
    }
    result += `${mainThreadLabelColumn}│${mainThreadTimelineColumn}\n`;

    const tasksByPriority = Array.from(tasks.values()).sort(
      (t1, t2) => t1.priorityLevel - t2.priorityLevel,
    );

    for (const task of tasksByPriority) {
      let label = task.label;
      if (label === undefined) {
        label = 'Task';
      }
      let labelColumn = `Task ${task.id} [${priorityLevelToString(
        task.priorityLevel,
      )}]`;
      labelColumn += ' '.repeat(labelColumnWidth - labelColumn.length - 1);

      // 用空格填充到 task start，保留相对主线程和其他任务的时间位置。
      let timelineColumn = ' '.repeat(task.start / microsecondsPerChar);

      let isRunning = false;
      for (const time of task.runs) {
        const index = time / microsecondsPerChar;
        timelineColumn += (isRunning ? '█' : '░').repeat(
          index - timelineColumn.length,
        );
        isRunning = !isRunning;
      }

      const endIndex = task.end / microsecondsPerChar;
      timelineColumn += (isRunning ? '█' : '░').repeat(
        endIndex - timelineColumn.length,
      );

      if (task.exitStatus !== 'completed') {
        timelineColumn += `🡐 ${task.exitStatus}`;
      }

      result += `${labelColumn}│${timelineColumn}\n`;
    }

    return '\n' + result;
  }

  /**
   * Given：Normal task 分两段运行，并在中间安排一个 UserBlocking task。
   * When：按两次 yield 边界推进虚拟时间后停止 profiling。
   * Then：flamegraph 同时呈现主线程 suspend/resume、Normal continuation 与高优先级 task 插队。
   *
   * 验证机制：完整文本精确断言每条 task 的 priority、起止位置、运行/暂停区间。
   * 对应源码：`SchedulerProfiling` 的 start/run/yield/complete/suspend/resume 事件写入分支。
   */
  it('creates a basic flamegraph', async () => {
    Scheduler.unstable_Profiling.startLoggingProfilingEvents();

    Scheduler.unstable_advanceTime(100);
    scheduleCallback(
      NormalPriority,
      () => {
        Scheduler.unstable_advanceTime(300);
        Scheduler.log('Yield 1');
        scheduleCallback(
          UserBlockingPriority,
          () => {
            Scheduler.log('Yield 2');
            Scheduler.unstable_advanceTime(300);
          },
          {label: 'Bar'},
        );
        Scheduler.unstable_advanceTime(100);
        Scheduler.log('Yield 3');
        return () => {
          Scheduler.log('Yield 4');
          Scheduler.unstable_advanceTime(300);
        };
      },
      {label: 'Foo'},
    );
    await waitFor(['Yield 1', 'Yield 3']);
    Scheduler.unstable_advanceTime(100);
    await waitForAll(['Yield 2', 'Yield 4']);

    expect(stopProfilingAndPrintFlamegraph()).toEqual(
      `
!!! Main thread              │██░░░░░░░░██░░░░░░░░░░░░
Task 2 [User-blocking]       │        ░░░░██████
Task 1 [Normal]              │  ████████░░░░░░░░██████
`,
    );
  });

  /**
   * Given：Normal task 首段运行后返回 continuation。
   * When：continuation 恢复前取消原 task handle。
   * Then：task 时间线终止于取消时刻并标记 `canceled`，不再出现 continuation 运行区间。
   * 对应源码：`markTaskCanceled()` 与 `unstable_cancelCallback()` 对同一 task id 的事件记录。
   */
  it('marks when a task is canceled', async () => {
    Scheduler.unstable_Profiling.startLoggingProfilingEvents();

    const task = scheduleCallback(NormalPriority, () => {
      Scheduler.log('Yield 1');
      Scheduler.unstable_advanceTime(300);
      Scheduler.log('Yield 2');
      return () => {
        Scheduler.log('Continuation');
        Scheduler.unstable_advanceTime(200);
      };
    });

    await waitFor(['Yield 1', 'Yield 2']);
    Scheduler.unstable_advanceTime(100);

    cancelCallback(task);

    Scheduler.unstable_advanceTime(1000);
    await waitForAll([]);
    expect(stopProfilingAndPrintFlamegraph()).toEqual(
      `
!!! Main thread              │░░░░░░██████████████████████
Task 1 [Normal]              │██████░░🡐 canceled
`,
    );
  });

  /**
   * Given：一个 task 运行 300ms 后抛错。
   * When：测试捕获该错误并停止 profiling。
   * Then：task 行在错误时刻终止并标记 `errored`，Scheduler 主线程状态恢复为 suspended。
   * 对应源码：callback 异常路径中的 `markTaskErrored()` 与 work loop 清理。
   */
  it('marks when a task errors', async () => {
    Scheduler.unstable_Profiling.startLoggingProfilingEvents();

    scheduleCallback(NormalPriority, () => {
      Scheduler.unstable_advanceTime(300);
      throw Error('Oops');
    });

    await waitForThrow('Oops');
    Scheduler.unstable_advanceTime(100);

    Scheduler.unstable_advanceTime(1000);
    await waitForAll([]);
    expect(stopProfilingAndPrintFlamegraph()).toEqual(
      `
!!! Main thread              │░░░░░░██████████████████████
Task 1 [Normal]              │██████🡐 errored
`,
    );
  });

  /**
   * 同时取消已 yield 和尚未运行的 task；两行分别终止于同一个取消时刻，并各标记 canceled。
   * 随后清理空 callback 的 flush 仍记录 Resume/Suspend，任务行的终止时间不再变化。
   */
  it('marks when multiple tasks are canceled', async () => {
    Scheduler.unstable_Profiling.startLoggingProfilingEvents();

    const task1 = scheduleCallback(NormalPriority, () => {
      Scheduler.log('Yield 1');
      Scheduler.unstable_advanceTime(300);
      Scheduler.log('Yield 2');
      return () => {
        Scheduler.log('Continuation');
        Scheduler.unstable_advanceTime(200);
      };
    });
    const task2 = scheduleCallback(NormalPriority, () => {
      Scheduler.log('Yield 3');
      Scheduler.unstable_advanceTime(300);
      Scheduler.log('Yield 4');
      return () => {
        Scheduler.log('Continuation');
        Scheduler.unstable_advanceTime(200);
      };
    });

    await waitFor(['Yield 1', 'Yield 2']);
    Scheduler.unstable_advanceTime(100);

    cancelCallback(task1);
    cancelCallback(task2);

    // callback 已清空但节点仍待惰性删除；推进时间后 flush 会清理节点并记录新一对 Resume/Suspend。
    Scheduler.unstable_advanceTime(1000);
    await waitForAll([]);

    // 任务行终止于取消时刻；Main thread 行还包括随后清理节点的 flush 边界。
    expect(stopProfilingAndPrintFlamegraph()).toEqual(
      `
!!! Main thread              │░░░░░░██████████████████████
Task 1 [Normal]              │██████░░🡐 canceled
Task 2 [Normal]              │░░░░░░░░🡐 canceled
`,
    );
  });

  /** 启动 profile 并 flush 完成运行 1000ms 的 A，再 cancel 原 handle；flamegraph 仍只有 completed 运行行，验证完成终态不会被取消改写。 */
  it('handles cancelling a task that already finished', async () => {
    Scheduler.unstable_Profiling.startLoggingProfilingEvents();

    const task = scheduleCallback(NormalPriority, () => {
      Scheduler.log('A');
      Scheduler.unstable_advanceTime(1000);
    });
    await waitForAll(['A']);
    cancelCallback(task);
    expect(stopProfilingAndPrintFlamegraph()).toEqual(
      `
!!! Main thread              │░░░░░░░░░░░░░░░░░░░░
Task 1 [Normal]              │████████████████████
`,
    );
  });

  /** A/B 两任务待执行时推进到 600ms，连续 cancel B 三次再 flush A；flamegraph 只给 B 一个 canceled 终态且 A 完成，验证重复取消幂等。 */
  it('handles cancelling a task multiple times', async () => {
    Scheduler.unstable_Profiling.startLoggingProfilingEvents();

    scheduleCallback(
      NormalPriority,
      () => {
        Scheduler.log('A');
        Scheduler.unstable_advanceTime(1000);
      },
      {label: 'A'},
    );
    Scheduler.unstable_advanceTime(200);
    const task = scheduleCallback(
      NormalPriority,
      () => {
        Scheduler.log('B');
        Scheduler.unstable_advanceTime(1000);
      },
      {label: 'B'},
    );
    Scheduler.unstable_advanceTime(400);
    cancelCallback(task);
    cancelCallback(task);
    cancelCallback(task);
    await waitForAll(['A']);
    expect(stopProfilingAndPrintFlamegraph()).toEqual(
      `
!!! Main thread              │████████████░░░░░░░░░░░░░░░░░░░░
Task 1 [Normal]              │░░░░░░░░░░░░████████████████████
Task 2 [Normal]              │    ░░░░░░░░🡐 canceled
`,
    );
  });

  /**
   * 场景：带 1000ms delay 的 task 在到期前不产生运行区间；到期后从对应时间位置开始并完成。
   * 先 flush 得到空日志，再推进 1000ms 并 flush 运行 1000ms 的 A；时间线从 1000ms
   * 起显示 task 行，用于验证 TaskStart 在进入 ready queue 时记录而非创建 timer 时。
   * 对应源码：timer queue 到 ready queue 的迁移及 profiling run/complete 事件。
   */
  it('handles delayed tasks', async () => {
    Scheduler.unstable_Profiling.startLoggingProfilingEvents();
    scheduleCallback(
      NormalPriority,
      () => {
        Scheduler.unstable_advanceTime(1000);
        Scheduler.log('A');
      },
      {
        delay: 1000,
      },
    );
    await waitForAll([]);

    Scheduler.unstable_advanceTime(1000);

    await waitForAll(['A']);

    expect(stopProfilingAndPrintFlamegraph()).toEqual(
      `
!!! Main thread              │████████████████████░░░░░░░░░░░░░░░░░░░░
Task 1 [Normal]              │                    ████████████████████
`,
    );
  });

  /** profile 中安排 delay=1000ms 的 A 后立即 cancel，再 flush；输出仅空主线程行，验证未进入 ready queue 的 timer 不产生 task/cancel 记录。 */
  it('handles cancelling a delayed task', async () => {
    Scheduler.unstable_Profiling.startLoggingProfilingEvents();
    const task = scheduleCallback(NormalPriority, () => Scheduler.log('A'), {
      delay: 1000,
    });
    cancelCallback(task);
    await waitForAll([]);
    expect(stopProfilingAndPrintFlamegraph()).toEqual(
      `
!!! Main thread              │
`,
    );
  });

  /**
   * Given：持续创建并立即取消 task，直到 profiling event buffer 超过上限。
   * When：记录器自动停止，再启动一段新 profile。
   * Then：只警告一次、旧 buffer 已清空，且后续 profile 仍可正常记录。
   *
   * 验证机制：同时断言 console 错误次数与原文、空 profile 标记、以及重启后的 task 时间线。
   * 对应源码：`logEvent()` 的最大 buffer 分支、`stopLoggingProfilingEvents()` 与重新初始化逻辑。
   */
  it('automatically stops profiling and warns if event log gets too big', async () => {
    Scheduler.unstable_Profiling.startLoggingProfilingEvents();

    spyOnDevAndProd(console, 'error').mockImplementation(() => {});

    // 扩大循环保护阈值，以触发 524288 个 Int32 的逻辑日志上限；扩容后的实际 backing buffer 最大为 8 MiB。
    const originalMaxIterations = global.__MAX_ITERATIONS__;
    global.__MAX_ITERATIONS__ = 120000;

    let taskId = 1;
    while (console.error.mock.calls.length === 0) {
      taskId++;
      const task = scheduleCallback(NormalPriority, () => {});
      cancelCallback(task);
      Scheduler.unstable_flushAll();
    }

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error.mock.calls[0][0]).toBe(
      "Scheduler Profiling: Event log exceeded maximum size. Don't forget " +
        'to call `stopLoggingProfilingEvents()`.',
    );

    // 超限会调用 stopLoggingProfilingEvents 丢弃返回值；随后再停止时只能取得 null。
    expect(stopProfilingAndPrintFlamegraph()).toEqual('(empty profile)');

    // 自动停止不是永久失效；随后启动的新 profile 应从干净 buffer 继续工作。
    Scheduler.unstable_Profiling.startLoggingProfilingEvents();
    scheduleCallback(NormalPriority, () => {
      Scheduler.unstable_advanceTime(1000);
    });
    await waitForAll([]);

    // task id 的具体值仅反映 buffer 扩容前恰好创建了多少任务；这里插值匹配而不赋予其协议含义。
    expect(stopProfilingAndPrintFlamegraph()).toEqual(`
!!! Main thread              │░░░░░░░░░░░░░░░░░░░░
Task ${taskId} [Normal]          │████████████████████
`);

    global.__MAX_ITERATIONS__ = originalMaxIterations;
  });
});
