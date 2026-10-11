/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/* eslint-disable no-var */
/* eslint-disable react-internal/prod-error-codes */

import type {PriorityLevel} from '../SchedulerPriorities';

import {enableProfiling} from '../SchedulerFeatureFlags';
import {push, pop, peek} from '../SchedulerMinHeap';

// TODO: 是否改用 Symbol 表示优先级，避免测试依赖内部数字编码？
import {
  ImmediatePriority,
  UserBlockingPriority,
  NormalPriority,
  LowPriority,
  IdlePriority,
} from '../SchedulerPriorities';
import {
  markTaskRun,
  markTaskYield,
  markTaskCompleted,
  markTaskCanceled,
  markTaskErrored,
  markSchedulerSuspended,
  markSchedulerUnsuspended,
  markTaskStart,
  stopLoggingProfilingEvents,
  startLoggingProfilingEvents,
} from '../SchedulerProfiling';

/** 测试任务回调；返回函数表示同一任务尚有 continuation。 */
type Callback = boolean => ?Callback;

/**
 * 虚拟 Scheduler 中在 timer queue 与 task queue 间迁移的任务。
 *
 * 字段与生产 `Scheduler` 保持一致，使同一调度算法和 profiling 记录可在确定性 host 上复用。
 */
type Task = {
  /** 单调任务编号；相同排序键时维持 FIFO。 */
  id: number,
  /** 待执行回调；执行前先置空，取消、完成或抛错后也保持 `null`，直到节点被移除。 */
  callback: Callback | null,
  /** 任务的 Scheduler 优先级。 */
  priorityLevel: PriorityLevel,
  /** 最早可进入 ready queue 的虚拟绝对时间，单位为毫秒。 */
  startTime: number,
  /** 任务视为超时的虚拟绝对时间。 */
  expirationTime: number,
  /** timer queue 使用开始时间，task queue 使用过期时间。 */
  sortIndex: number,
  /** profiling 构建中表示任务是否已记录为 ready。 */
  isQueued?: boolean,
};

// 最大 31 位有符号整数，也是 32 位 V8 可高效表示的最大整数。
// Math.pow(2, 30) - 1
// 0b111111111111111111111111111111
var maxSigned31BitInt = 1073741823;

// Immediate 任务的过期预算，负值使其进入 ready queue 时已过期；delay 仍决定最早运行时间。
var IMMEDIATE_PRIORITY_TIMEOUT = -1;
// UserBlocking 任务的虚拟过期预算，单位为毫秒。
var USER_BLOCKING_PRIORITY_TIMEOUT = 250;
// Normal 任务的虚拟过期预算，单位为毫秒。
var NORMAL_PRIORITY_TIMEOUT = 5000;
// Low 任务的虚拟过期预算，单位为毫秒。
var LOW_PRIORITY_TIMEOUT = 10000;
// Idle 任务借最大 31 位整数近似永不过期。
var IDLE_PRIORITY_TIMEOUT = maxSigned31BitInt;

// ready task 最小堆，按过期时间和任务 id 排序。
var taskQueue: Array<Task> = [];
// delayed timer 最小堆，按开始时间和任务 id 排序。
var timerQueue: Array<Task> = [];

// 单调任务编号，在相同排序键下保持插入顺序。
var taskIdCounter = 1;

// 当前执行任务与动态优先级；flush 退出时必须恢复。
var currentTask = null;
var currentPriorityLevel: PriorityLevel = NormalPriority;

// work loop 运行期间置为 true，防止新增任务重入虚拟 host callback。
var isPerformingWork = false;

// callback 登记状态；timeout 标记在 scheduleCallback 登记 timer 时设置，触发或 flush 接管时清除。
var isHostCallbackScheduled = false;
var isHostTimeoutScheduled = false;

// 以下状态组成可由测试显式驱动的虚拟 host：时钟、callback、timeout、yield 日志与 flush 边界。
let currentMockTime: number = 0;
let scheduledCallback:
  | null
  | ((
      hasTimeRemaining: boolean,
      initialTime: DOMHighResTimeStamp | number,
    ) => boolean) = null;
let scheduledTimeout: (number => void) | null = null;
let timeoutTime: number = -1;
let yieldedValues: Array<mixed> | null = null;
let expectedNumberOfYields: number = -1;
let didStop: boolean = false;
let isFlushing: boolean = false;
let needsPaint: boolean = false;
let shouldYieldForPaint: boolean = false;

var disableYieldValue = false;

/** 控制 render replay 期间是否忽略测试 yield 值和虚拟时间推进。 */
function setDisableYieldValue(newValue: boolean) {
  disableYieldValue = newValue;
}

/** 把已到虚拟开始时间的 delayed timer 迁移到 ready queue，并清理取消节点。 */
function advanceTimers(currentTime: number) {
  // timer queue 已排序，只需连续检查堆顶。
  let timer = peek(timerQueue);
  while (timer !== null) {
    if (timer.callback === null) {
      // 取消只清空 callback，节点到堆顶后惰性删除。
      pop(timerQueue);
    } else if (timer.startTime <= currentTime) {
      // 到期 timer 改用 expirationTime 排序并进入 ready queue。
      pop(timerQueue);
      timer.sortIndex = timer.expirationTime;
      push(taskQueue, timer);
      // $FlowFixMe[constant-condition]
      if (enableProfiling) {
        markTaskStart(timer, currentTime);
        timer.isQueued = true;
      }
    } else {
      // 堆顶仍在未来，其余 timer 也无需处理。
      return;
    }
    timer = peek(timerQueue);
  }
}

/** 虚拟 timeout 触发点：迁移 timer 后唤醒 flush，或登记下一个最早 timer。 */
function handleTimeout(currentTime: number) {
  isHostTimeoutScheduled = false;
  advanceTimers(currentTime);

  if (!isHostCallbackScheduled) {
    if (peek(taskQueue) !== null) {
      isHostCallbackScheduled = true;
      requestHostCallback(flushWork);
    } else {
      const firstTimer = peek(timerQueue);
      if (firstTimer !== null) {
        requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
      }
    }
  }
}

/**
 * 在不可重入边界内执行一次虚拟 flush，并恢复优先级/profiling 状态。
 *
 * `hasTimeRemaining` 由测试 helper 控制，可精确模拟 host 是否允许继续执行。
 */
function flushWork(hasTimeRemaining: boolean, initialTime: number) {
  // $FlowFixMe[constant-condition]
  if (enableProfiling) {
    markSchedulerUnsuspended(initialTime);
  }

  // 当前虚拟 host callback 已消费，剩余工作需要重新登记。
  isHostCallbackScheduled = false;
  if (isHostTimeoutScheduled) {
    // 已有 ready work 时不再等待 delayed timer 的 timeout。
    isHostTimeoutScheduled = false;
    cancelHostTimeout();
  }

  isPerformingWork = true;
  const previousPriorityLevel = currentPriorityLevel;
  try {
    // $FlowFixMe[constant-condition]
    if (enableProfiling) {
      try {
        return workLoop(hasTimeRemaining, initialTime);
      } catch (error) {
        if (currentTask !== null) {
          const currentTime = getCurrentTime();
          // $FlowFixMe[incompatible-call] found when upgrading Flow
          // $FlowFixMe[incompatible-type]
          markTaskErrored(currentTask, currentTime);
          // $FlowFixMe[incompatible-use] found when upgrading Flow
          currentTask.isQueued = false;
        }
        throw error;
      }
    } else {
      // profiling 关闭时不增加额外 catch，保持与生产热路径一致。
      return workLoop(hasTimeRemaining, initialTime);
    }
  } finally {
    currentTask = null;
    currentPriorityLevel = previousPriorityLevel;
    isPerformingWork = false;
    // $FlowFixMe[constant-condition]
    if (enableProfiling) {
      const currentTime = getCurrentTime();
      markSchedulerSuspended(currentTime);
    }
  }
}

/**
 * 运行 ready task，直到队列清空、测试规定的 yield 数达到或 paint 边界命中。
 *
 * 任务排序、取消与 continuation 的任务身份和过期时间与生产实现一致；执行边界不同：
 * 生产 continuation 必定结束当前 host task，mock 在非 paint 模式可于同次 flush 继续执行。
 * @param hasTimeRemaining - helper 是否给未过期工作执行资格；flushExpired 传 false。
 * @param initialTime - 当前虚拟毫秒时间，供 timer 迁移与 didTimeout 判断使用。
 * @returns 是否保留 ready 工作；未来 timer 不构成继续 flush 的理由。
 * @remarks 过期任务忽略 helper 的 yield 门限，callback 本身也可能记录多条日志后才
 * 返回，因此期望日志数量不是强制中断点。完成时只 pop 仍在堆顶的当前节点，允许
 * callback 内新安排的更早过期任务抢到堆顶而不被误删。
 */
function workLoop(hasTimeRemaining: boolean, initialTime: number): boolean {
  let currentTime = initialTime;
  advanceTimers(currentTime);
  currentTask = peek(taskQueue);
  while (currentTask !== null) {
    if (
      currentTask.expirationTime > currentTime &&
      (!hasTimeRemaining || shouldYieldToHost())
    ) {
      // 未过期任务可被虚拟 host deadline 或测试 yield 条件打断。
      break;
    }
    // $FlowFixMe[incompatible-use] found when upgrading Flow
    const callback = currentTask.callback;
    if (typeof callback === 'function') {
      // $FlowFixMe[incompatible-use] found when upgrading Flow
      currentTask.callback = null;
      // $FlowFixMe[incompatible-use] found when upgrading Flow
      currentPriorityLevel = currentTask.priorityLevel;
      // $FlowFixMe[incompatible-use] found when upgrading Flow
      const didUserCallbackTimeout = currentTask.expirationTime <= currentTime;
      // $FlowFixMe[constant-condition]
      if (enableProfiling) {
        // $FlowFixMe[incompatible-call] found when upgrading Flow
        // $FlowFixMe[incompatible-type]
        markTaskRun(currentTask, currentTime);
      }
      const continuationCallback = callback(didUserCallbackTimeout);
      currentTime = getCurrentTime();
      if (typeof continuationCallback === 'function') {
        // continuation 写回同一任务；是否立即停止由当前测试 helper 的 paint 策略决定。
        // $FlowFixMe[incompatible-use] found when upgrading Flow
        currentTask.callback = continuationCallback;
        // $FlowFixMe[constant-condition]
        if (enableProfiling) {
          // $FlowFixMe[incompatible-call] found when upgrading Flow
          // $FlowFixMe[incompatible-type]
          markTaskYield(currentTask, currentTime);
        }
        advanceTimers(currentTime);

        if (shouldYieldForPaint) {
          needsPaint = true;
          return true;
        } else {
          // 非 paint 模式继续同步 flush，供 `toFlushAndYield` 与 `toFlushAndYieldThrough` 精确收集日志。
        }
      } else {
        // $FlowFixMe[constant-condition]
        if (enableProfiling) {
          // $FlowFixMe[incompatible-call] found when upgrading Flow
          // $FlowFixMe[incompatible-type]
          markTaskCompleted(currentTask, currentTime);
          // $FlowFixMe[incompatible-use] found when upgrading Flow
          currentTask.isQueued = false;
        }
        if (currentTask === peek(taskQueue)) {
          pop(taskQueue);
        }
        advanceTimers(currentTime);
      }
    } else {
      pop(taskQueue);
    }
    currentTask = peek(taskQueue);
  }
  // 返回值告诉测试 host 是否仍有 ready 工作。
  if (currentTask !== null) {
    return true;
  } else {
    const firstTimer = peek(timerQueue);
    if (firstTimer !== null) {
      requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
    }
    return false;
  }
}

/** 在指定动态优先级内同步执行回调，并在 `finally` 中恢复调用方上下文。 */
function unstable_runWithPriority<T>(
  priorityLevel: PriorityLevel,
  eventHandler: () => T,
): T {
  switch (priorityLevel) {
    case ImmediatePriority:
    case UserBlockingPriority:
    case NormalPriority:
    case LowPriority:
    case IdlePriority:
      break;
    default:
      priorityLevel = NormalPriority;
  }

  var previousPriorityLevel = currentPriorityLevel;
  currentPriorityLevel = priorityLevel;

  try {
    return eventHandler();
  } finally {
    currentPriorityLevel = previousPriorityLevel;
  }
}

/** 高优先级上下文降到 Normal，Low/Idle 上下文保持原级后执行回调。 */
function unstable_next<T>(eventHandler: () => T): T {
  var priorityLevel: PriorityLevel;
  switch (currentPriorityLevel) {
    case ImmediatePriority:
    case UserBlockingPriority:
    case NormalPriority:
      // 高于 Normal 的上下文降级，避免普通后续工作继续占用高优先级。
      priorityLevel = NormalPriority;
      break;
    default:
      // 低优先级上下文不能升级。
      priorityLevel = currentPriorityLevel;
      break;
  }

  var previousPriorityLevel = currentPriorityLevel;
  currentPriorityLevel = priorityLevel;

  try {
    return eventHandler();
  } finally {
    currentPriorityLevel = previousPriorityLevel;
  }
}

/** 捕获当前优先级并返回保留 `this`、参数和错误恢复语义的包装函数。 */
function unstable_wrapCallback<T: (...Array<mixed>) => mixed>(callback: T): T {
  var parentPriorityLevel = currentPriorityLevel;
  // $FlowFixMe[incompatible-return]
  // $FlowFixMe[missing-this-annot]
  // $FlowFixMe[incompatible-type]
  return function () {
    // 内联 `runWithPriority`，让 mock 与生产包装器保持相同调用语义。
    var previousPriorityLevel = currentPriorityLevel;
    currentPriorityLevel = parentPriorityLevel;

    try {
      return callback.apply(this, arguments);
    } finally {
      currentPriorityLevel = previousPriorityLevel;
    }
  };
}

/**
 * 在虚拟时间轴创建任务，按 delay 决定进入 timer queue 或 ready queue。
 *
 * 任务过期预算与生产实现一致；host 唤醒只写入可由测试 helper 驱动的 callback 状态。
 * @param priorityLevel - 选择固定虚拟 timeout 的级别；未知值使用 Normal 预算但记录原值。
 * @param callback - 工作函数，参数表示已过期；返回函数保留同一 task 的身份及期限。
 * @param options - 可选正数 delay，以当前虚拟毫秒时钟计算开始时间。
 * @returns 可取消的原 Task handle；没有真实 timer/message 或自动执行。
 */
function unstable_scheduleCallback(
  priorityLevel: PriorityLevel,
  callback: Callback,
  options?: {
    /** 从当前虚拟时间起延迟多久，单位为毫秒；非正数按立即任务处理。 */
    delay: number
  },
): Task {
  var currentTime = getCurrentTime();

  var startTime;
  // $FlowFixMe[invalid-compare]
  if (typeof options === 'object' && options !== null) {
    var delay = options.delay;
    if (typeof delay === 'number' && delay > 0) {
      startTime = currentTime + delay;
    } else {
      startTime = currentTime;
    }
  } else {
    startTime = currentTime;
  }

  var timeout;
  switch (priorityLevel) {
    case ImmediatePriority:
      timeout = IMMEDIATE_PRIORITY_TIMEOUT;
      break;
    case UserBlockingPriority:
      timeout = USER_BLOCKING_PRIORITY_TIMEOUT;
      break;
    case IdlePriority:
      timeout = IDLE_PRIORITY_TIMEOUT;
      break;
    case LowPriority:
      timeout = LOW_PRIORITY_TIMEOUT;
      break;
    case NormalPriority:
    default:
      timeout = NORMAL_PRIORITY_TIMEOUT;
      break;
  }

  var expirationTime = startTime + timeout;

  var newTask: Task = {
    id: taskIdCounter++,
    callback,
    priorityLevel,
    startTime,
    expirationTime,
    sortIndex: -1,
  };
  // $FlowFixMe[constant-condition]
  if (enableProfiling) {
    newTask.isQueued = false;
  }

  if (startTime > currentTime) {
    // delayed task 先以开始时间进入 timer queue。
    newTask.sortIndex = startTime;
    push(timerQueue, newTask);
    if (peek(taskQueue) === null && newTask === peek(timerQueue)) {
      // ready queue 为空且它是最早 timer，只保留一个对应 timeout。
      if (isHostTimeoutScheduled) {
        // 新最早 timer 取代旧 timeout。
        cancelHostTimeout();
      } else {
        isHostTimeoutScheduled = true;
      }
      // 测试推进到该时刻时再迁移任务。
      requestHostTimeout(handleTimeout, startTime - currentTime);
    }
  } else {
    newTask.sortIndex = expirationTime;
    push(taskQueue, newTask);
    // $FlowFixMe[constant-condition]
    if (enableProfiling) {
      markTaskStart(newTask, currentTime);
      newTask.isQueued = true;
    }
    // 非执行中且尚无 callback 时才登记；执行中新增任务由当前 work loop 接管。
    if (!isHostCallbackScheduled && !isPerformingWork) {
      isHostCallbackScheduled = true;
      requestHostCallback(flushWork);
    }
  }

  return newTask;
}

/**
 * 通过清空 callback 以 O(1) 取消待执行任务，等待堆顶路径惰性移除节点。
 * @param task - scheduleCallback 返回的 handle；保存 continuation 后仍使用同一个对象。
 * @remarks 不中断正在执行的函数；若该函数取消自己后返回续函数，workLoop 仍会把
 * 返回值写回 callback。已经登记的虚拟 host callback 也不会在此被撤销。
 */
function unstable_cancelCallback(task: Task) {
  // $FlowFixMe[constant-condition]
  if (enableProfiling) {
    if (task.isQueued) {
      const currentTime = getCurrentTime();
      markTaskCanceled(task, currentTime);
      task.isQueued = false;
    }
  }

  // 数组最小堆无法高效删除任意节点，因此只写取消标记。
  task.callback = null;
}

/** 返回虚拟 Scheduler 当前动态优先级。 */
function unstable_getCurrentPriorityLevel(): PriorityLevel {
  return currentPriorityLevel;
}

/** 把 work-loop callback 保存到虚拟 host，等待测试 helper 显式 flush。 */
function requestHostCallback(callback: (boolean, number) => boolean) {
  scheduledCallback = callback;
}

/** 记录 delayed timer callback 与绝对触发时间，等待虚拟时钟推进。 */
function requestHostTimeout(callback: number => void, ms: number) {
  scheduledTimeout = callback;
  timeoutTime = currentMockTime + ms;
}

/** 清除当前虚拟 host timeout。 */
function cancelHostTimeout(): void {
  scheduledTimeout = null;
  timeoutTime = -1;
}

/**
 * 根据期望 yield 数或 paint 请求决定测试 flush 是否停止。
 *
 * 命中时设置 `didStop`，外层 helper 据此退出循环并保留剩余 callback。
 */
function shouldYieldToHost(): boolean {
  if (
    (expectedNumberOfYields === 0 && yieldedValues === null) ||
    (expectedNumberOfYields !== -1 &&
      yieldedValues !== null &&
      yieldedValues.length >= expectedNumberOfYields) ||
    (shouldYieldForPaint && needsPaint)
  ) {
    // 已收集足够日志或到达 paint 边界，停止本轮 flush。
    didStop = true;
    return true;
  }
  return false;
}

/** 返回当前虚拟时间，单位为毫秒。 */
function getCurrentTime(): number {
  return currentMockTime;
}

/** mock 不模拟帧率覆盖；保留空实现以匹配 Scheduler 公共导出形状。 */
function forceFrameRate() {
  // 无操作。
}

/**
 * 清空虚拟 host 的时间、callback、日志与 paint 状态。
 *
 * flush 期间禁止 reset。该函数只重置虚拟 host，不清空任务堆；用例隔离依赖重新加载模块。
 * task id、动态优先级和队列标记同样未在这里重置，不能把它当作全模块重新初始化。
 */
function reset() {
  if (isFlushing) {
    throw new Error('Cannot reset while already flushing work.');
  }
  currentMockTime = 0;
  scheduledCallback = null;
  scheduledTimeout = null;
  timeoutTime = -1;
  yieldedValues = null;
  expectedNumberOfYields = -1;
  didStop = false;
  isFlushing = false;
  needsPaint = false;
}

/**
 * 以指定日志数量作为 yield 检查门限；应由会检查日志的断言 helper 调用。
 * 检查发生在任务之间或 callback 主动查询时，同一 callback 的多条日志及已过期工作可越过门限。
 *
 * finally 恢复日志门限与重入标记；抛错后未完成的队列和已有日志仍由后续测试操作处理。
 */
function unstable_flushNumberOfYields(count: number): void {
  if (isFlushing) {
    throw new Error('Already flushing work.');
  }
  if (scheduledCallback !== null) {
    const cb = scheduledCallback;
    expectedNumberOfYields = count;
    isFlushing = true;
    try {
      let hasMoreWork = true;
      do {
        hasMoreWork = cb(true, currentMockTime);
      } while (hasMoreWork && !didStop);
      if (!hasMoreWork) {
        scheduledCallback = null;
      }
    } finally {
      expectedNumberOfYields = -1;
      didStop = false;
      isFlushing = false;
    }
  }
}

/**
 * flush 到 paint 检查命中、callback 返回 continuation 或当前 ready queue 清空，并保留后续工作。
 *
 * @returns 固定 `false`，兼容旧测试 matcher 协议；是否有工作由内部 callback 状态表达。
 */
function unstable_flushUntilNextPaint(): false {
  if (isFlushing) {
    throw new Error('Already flushing work.');
  }
  if (scheduledCallback !== null) {
    const cb = scheduledCallback;
    shouldYieldForPaint = true;
    needsPaint = false;
    isFlushing = true;
    try {
      let hasMoreWork = true;
      do {
        hasMoreWork = cb(true, currentMockTime);
      } while (hasMoreWork && !didStop);
      if (!hasMoreWork) {
        scheduledCallback = null;
      }
    } finally {
      shouldYieldForPaint = false;
      didStop = false;
      isFlushing = false;
    }
  }
  return false;
}

/** 判断虚拟 host 是否仍持有待执行的 Scheduler callback。 */
function unstable_hasPendingWork(): boolean {
  return scheduledCallback !== null;
}

/** 只执行当前虚拟时间下已过期的工作，不给未过期任务时间预算。 */
function unstable_flushExpired() {
  if (isFlushing) {
    throw new Error('Already flushing work.');
  }
  if (scheduledCallback !== null) {
    isFlushing = true;
    try {
      const hasMoreWork = scheduledCallback(false, currentMockTime);
      if (!hasMoreWork) {
        scheduledCallback = null;
      }
    } finally {
      isFlushing = false;
    }
  }
}

/**
 * 同步排空当前 ready 工作，但不消费或断言日志，也不推进虚拟时钟；未来 timer 仍留在延迟堆。
 *
 * @returns 是否实际执行过至少一个 host callback。
 */
function unstable_flushAllWithoutAsserting(): boolean {
  if (isFlushing) {
    throw new Error('Already flushing work.');
  }
  if (scheduledCallback !== null) {
    const cb = scheduledCallback;
    isFlushing = true;
    try {
      let hasMoreWork = true;
      do {
        hasMoreWork = cb(true, currentMockTime);
      } while (hasMoreWork);
      // $FlowFixMe[constant-condition]
      if (!hasMoreWork) {
        scheduledCallback = null;
      }
      return true;
    } finally {
      isFlushing = false;
    }
  } else {
    return false;
  }
}

/** 返回并清空自上次读取以来的 yield 日志。 */
function unstable_clearLog(): Array<mixed> {
  if (yieldedValues === null) {
    return [];
  }
  const values = yieldedValues;
  yieldedValues = null;
  return values;
}

/**
 * 排空当前 ready 工作，并要求执行前后都没有未断言日志；不推进时钟执行未来 delayed task。
 *
 * WHY：防止测试漏掉中间可观察输出却仍然通过。
 */
function unstable_flushAll(): void {
  if (yieldedValues !== null) {
    throw new Error(
      'Log is not empty. Assert on the log of yielded values before ' +
        'flushing additional work.',
    );
  }
  unstable_flushAllWithoutAsserting();
  if (yieldedValues !== null) {
    throw new Error(
      'While flushing work, something yielded a value. Use an ' +
        'assertion helper to assert on the log of yielded values, e.g. ' +
        'expect(Scheduler).toFlushAndYield([...])',
    );
  }
}

/**
 * 记录一个供测试断言的 yield 值。
 *
 * render replay 或显式禁用时忽略第二遍输出，避免严格模式重放造成重复日志。
 */
function log(value: mixed): void {
  // eslint-disable-next-line react-internal/no-production-logging
  if (console.log.name === 'disabledLog' || disableYieldValue) {
    // console.log 被 React patch 代表正在重放 render；第二遍 yield 不属于新的可观察工作。
    return;
  }
  if (yieldedValues === null) {
    yieldedValues = [value];
  } else {
    yieldedValues.push(value);
  }
}

/**
 * 推进虚拟时钟，并在跨过最早 timeout 时同步触发其迁移逻辑。
 *
 * render replay 期间忽略推进，保证第二遍执行不会把测试时间重复累加。
 * @param ms - 要累加到 currentMockTime 的毫秒差；这里不校验非负或有限值。
 * @remarks 只检查一次已登记 timeout，不循环模拟期间所有 timer。调用其 callback
 * 后无条件清空 scheduledTimeout/timeoutTime，所以 callback 中新登记的 timeout
 * 也会被这些赋值覆盖；此 helper 的行为不能等同于完整浏览器 timer 队列。
 */
function unstable_advanceTime(ms: number) {
  // eslint-disable-next-line react-internal/no-production-logging
  if (console.log.name === 'disabledLog' || disableYieldValue) {
    // console.log 被 patch 代表 render replay；忽略第二遍时间副作用。
    return;
  }
  currentMockTime += ms;
  if (scheduledTimeout !== null && timeoutTime <= currentMockTime) {
    scheduledTimeout(currentMockTime);
    timeoutTime = -1;
    scheduledTimeout = null;
  }
}

/** 标记 renderer 已请求绘制，供 paint 模式 flush 在下一检查点停止。 */
function requestPaint() {
  needsPaint = true;
}

export {
  ImmediatePriority as unstable_ImmediatePriority,
  UserBlockingPriority as unstable_UserBlockingPriority,
  NormalPriority as unstable_NormalPriority,
  IdlePriority as unstable_IdlePriority,
  LowPriority as unstable_LowPriority,
  unstable_runWithPriority,
  unstable_next,
  unstable_scheduleCallback,
  unstable_cancelCallback,
  unstable_wrapCallback,
  unstable_getCurrentPriorityLevel,
  shouldYieldToHost as unstable_shouldYield,
  requestPaint as unstable_requestPaint,
  getCurrentTime as unstable_now,
  forceFrameRate as unstable_forceFrameRate,
  unstable_flushAllWithoutAsserting,
  unstable_flushNumberOfYields,
  unstable_flushExpired,
  unstable_clearLog,
  unstable_flushUntilNextPaint,
  unstable_hasPendingWork,
  unstable_flushAll,
  log,
  unstable_advanceTime,
  reset,
  setDisableYieldValue as unstable_setDisableYieldValue,
};

/** profiling 构建暴露会话控制器；其他构建固定为 null。 */
export const unstable_Profiling: {
  /** 启动新的二进制事件记录会话。 */
  startLoggingProfilingEvents(): void,
  /** 停止会话并返回事件缓冲区。 */
  stopLoggingProfilingEvents(): ArrayBuffer | null,
  // $FlowFixMe[constant-condition]
} | null = enableProfiling
  ? {
      startLoggingProfilingEvents,
      stopLoggingProfilingEvents,
    }
  : null;
