/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {PriorityLevel} from './SchedulerPriorities';
import {enableProfiling} from './SchedulerFeatureFlags';

// 每次任务真正开始/继续执行时递增，用于把多段 continuation 区分为不同运行片段。
let runIdCounter: number = 0;
// Scheduler 每次从运行转为挂起时递增，用于配对主线程 resume/suspend 事件。
let mainThreadIdCounter: number = 0;

// 初始日志容量按 Int32 元素计数；每个元素 4 字节，初始缓冲区为 512 KiB。
const INITIAL_EVENT_LOG_SIZE = 131072;
// 最大日志容量按 Int32 元素计数，对应 2 MiB；超过后自动停止，避免无限占用内存。
const MAX_EVENT_LOG_SIZE = 524288;

// 下列状态共同描述一次 profiling 会话；`eventLog === null` 表示当前未记录。
let eventLogSize = 0;
let eventLogBuffer = null;
let eventLog = null;
let eventLogIndex = 0;

// 任务进入 ready queue 的事件编码。
const TaskStartEvent = 1;
// 任务 callback 正常结束且无 continuation 的事件编码。
const TaskCompleteEvent = 2;
// 任务 callback 抛出错误的事件编码。
const TaskErrorEvent = 3;
// ready task 被取消的事件编码。
const TaskCancelEvent = 4;
// 任务 callback 开始一次运行片段的事件编码。
const TaskRunEvent = 5;
// callback 返回 continuation、当前运行片段主动让出的事件编码。
const TaskYieldEvent = 6;
// Scheduler 暂无可在当前 host task 中继续执行的工作的事件编码。
const SchedulerSuspendEvent = 7;
// Scheduler 恢复执行 ready task 的事件编码。
const SchedulerResumeEvent = 8;

/**
 * 把一条定长数字事件追加到当前 profiling 缓冲区。
 *
 * 状态：空间不足时缓冲区倍增并复制旧数据；超过 2 MiB 上限时停止本次会话。
 * 边界：未启动 profiling 时静默忽略，调用方无需重复判断会话状态。
 */
function logEvent(entries: Array<number | PriorityLevel>) {
  if (eventLog !== null) {
    const offset = eventLogIndex;
    eventLogIndex += entries.length;
    if (eventLogIndex + 1 > eventLogSize) {
      eventLogSize *= 2;
      if (eventLogSize > MAX_EVENT_LOG_SIZE) {
        // 使用 console['error'] 绕过 Babel 与 ESLint 对生产日志的变换/限制。
        console['error'](
          "Scheduler Profiling: Event log exceeded maximum size. Don't " +
            'forget to call `stopLoggingProfilingEvents()`.',
        );
        stopLoggingProfilingEvents();
        return;
      }
      const newEventLog = new Int32Array(eventLogSize * 4);
      // $FlowFixMe[incompatible-type] found when upgrading Flow
      newEventLog.set(eventLog);
      eventLogBuffer = newEventLog.buffer;
      eventLog = newEventLog;
    }
    eventLog.set(entries, offset);
  }
}

/** 初始化空 profiling 缓冲区，并丢弃此前会话的索引状态。 */
export function startLoggingProfilingEvents(): void {
  eventLogSize = INITIAL_EVENT_LOG_SIZE;
  eventLogBuffer = new ArrayBuffer(eventLogSize * 4);
  eventLog = new Int32Array(eventLogBuffer);
  eventLogIndex = 0;
}

/**
 * 停止 profiling、清空模块状态并交还底层 `ArrayBuffer`。
 *
 * 返回的是完整容量缓冲区；消费者以事件编码 0 识别未写入尾部。
 */
export function stopLoggingProfilingEvents(): ArrayBuffer | null {
  const buffer = eventLogBuffer;
  eventLogSize = 0;
  eventLogBuffer = null;
  eventLog = null;
  eventLogIndex = 0;
  return buffer;
}

/** 记录任务首次进入 ready queue；延迟任务只有到期搬入 task queue 时才记录。 */
export function markTaskStart(
  task: {
    // 与 Scheduler Task 共用的单调任务编号。
    id: number,
    // 创建任务时确定的 Scheduler 优先级。
    priorityLevel: PriorityLevel,
    ...
  },
  ms: number,
) {
  // $FlowFixMe[constant-condition]
  if (enableProfiling) {
    if (eventLog !== null) {
      // `performance.now()` 返回毫秒浮点数；写入 Int32 前乘 1000 转成微秒，保留更多精度。
      logEvent([TaskStartEvent, ms * 1000, task.id, task.priorityLevel]);
    }
  }
}

/** 记录任务 callback 正常完成且不再返回 continuation。 */
export function markTaskCompleted(
  task: {
    // 完成任务的单调编号。
    id: number,
    // 保留字段形状与其他任务事件一致；本事件编码不写入该值。
    priorityLevel: PriorityLevel,
    ...
  },
  ms: number,
) {
  // $FlowFixMe[constant-condition]
  if (enableProfiling) {
    if (eventLog !== null) {
      logEvent([TaskCompleteEvent, ms * 1000, task.id]);
    }
  }
}

/** 记录仍位于 ready queue 的任务被取消。 */
export function markTaskCanceled(
  task: {
    // 被取消任务的单调编号。
    id: number,
    // 保留字段形状与 Scheduler Task 一致；本事件编码不写入该值。
    priorityLevel: PriorityLevel,
    ...
  },
  ms: number,
) {
  // $FlowFixMe[constant-condition]
  if (enableProfiling) {
    if (eventLog !== null) {
      logEvent([TaskCancelEvent, ms * 1000, task.id]);
    }
  }
}

/** 记录当前 callback 抛错；错误本身由 Scheduler 原样继续抛给 host。 */
export function markTaskErrored(
  task: {
    // 抛错任务的单调编号。
    id: number,
    // 保留字段形状与 Scheduler Task 一致；本事件编码不写入该值。
    priorityLevel: PriorityLevel,
    ...
  },
  ms: number,
) {
  // $FlowFixMe[constant-condition]
  if (enableProfiling) {
    if (eventLog !== null) {
      logEvent([TaskErrorEvent, ms * 1000, task.id]);
    }
  }
}

/** 记录任务开始或恢复一次 callback 运行片段，并分配新的 run id。 */
export function markTaskRun(
  task: {
    // 当前运行任务的单调编号。
    id: number,
    // 当前运行任务的 Scheduler 优先级。
    priorityLevel: PriorityLevel,
    ...
  },
  ms: number,
) {
  // $FlowFixMe[constant-condition]
  if (enableProfiling) {
    runIdCounter++;

    if (eventLog !== null) {
      logEvent([TaskRunEvent, ms * 1000, task.id, runIdCounter]);
    }
  }
}

/** 记录 callback 返回 continuation 后结束当前运行片段。 */
export function markTaskYield(
  task: {
    // 主动让出任务的单调编号。
    id: number,
    ...
  },
  ms: number
) {
  // $FlowFixMe[constant-condition]
  if (enableProfiling) {
    if (eventLog !== null) {
      logEvent([TaskYieldEvent, ms * 1000, task.id, runIdCounter]);
    }
  }
}

/** 记录 Scheduler 完成本轮 flush 并把执行权归还 host。 */
export function markSchedulerSuspended(ms: number) {
  // $FlowFixMe[constant-condition]
  if (enableProfiling) {
    mainThreadIdCounter++;

    if (eventLog !== null) {
      logEvent([SchedulerSuspendEvent, ms * 1000, mainThreadIdCounter]);
    }
  }
}

/** 记录 host callback 重新进入 Scheduler、准备开始本轮 flush。 */
export function markSchedulerUnsuspended(ms: number) {
  // $FlowFixMe[constant-condition]
  if (enableProfiling) {
    if (eventLog !== null) {
      logEvent([SchedulerResumeEvent, ms * 1000, mainThreadIdCounter]);
    }
  }
}
