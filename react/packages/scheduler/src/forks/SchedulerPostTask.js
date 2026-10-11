/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {PriorityLevel} from '../SchedulerPriorities';

/** 浏览器 Scheduling API 的可取消任务控制器；由 host 提供实现。 */
declare class TaskController {
  /** 以可选的原生调度优先级创建控制器。 */
  constructor(options?: {
    /** 浏览器 `postTask` 使用的字符串优先级。 */
    priority?: string
  }): TaskController;
  /** 传给 `postTask/yield` 的 AbortSignal，并携带控制器优先级。 */
  signal: mixed;
  /** 中止尚未执行或尚有 continuation 的原生任务。 */
  abort(): void;
}

/** 浏览器 Scheduling API 支持的三档优先级。 */
type PostTaskPriorityLevel = 'user-blocking' | 'user-visible' | 'background';

/** 对外返回的取消句柄；controller 贯穿原任务及其所有 continuation。 */
type CallbackNode = {
  /** 任务拥有的唯一控制器，取消时中止同一 continuation 链。 */
  _controller: TaskController,
};

import {
  ImmediatePriority,
  UserBlockingPriority,
  NormalPriority,
  LowPriority,
  IdlePriority,
} from '../SchedulerPriorities';

export {
  ImmediatePriority as unstable_ImmediatePriority,
  UserBlockingPriority as unstable_UserBlockingPriority,
  NormalPriority as unstable_NormalPriority,
  IdlePriority as unstable_IdlePriority,
  LowPriority as unstable_LowPriority,
};

// 模块初始化时捕获当时的 host API；后续替换全局函数不会改变这些时钟与错误上报引用。
/** 高精度单调时间源。 */
const perf = window.performance;
/** callback 抛错时把错误移出 Promise 链、转回普通 browser task 的 API。 */
const setTimeout = window.setTimeout;

/** 浏览器注入的实验性 Scheduling API；本 fork 要求 `scheduler.postTask` 可用。 */
const scheduler = global.scheduler;

/** 读取与浏览器 Scheduling API 共用的单调时间。 */
const getCurrentTime: () => DOMHighResTimeStamp = perf.now.bind(perf);

/** 对外时间 API 直接复用已绑定的 `performance.now`。 */
export const unstable_now = getCurrentTime;

// 每次 runTask 把 shouldYield 门限设为当前时间加 5 毫秒；callback 需主动检查并返回，无法强制中断。
/** 该 fork 不对齐帧边界，需要帧同步的调用方应使用 requestAnimationFrame。 */
const yieldInterval = 5;
// 当前 callback 允许运行到的绝对时间；每次 `runTask` 开始时刷新。
let deadline = 0;

// 兼容旧 Scheduler API 的同步动态优先级；`postTask` 的真实优先级另由 signal 固定。
let currentPriorityLevel_DEPRECATED: PriorityLevel = NormalPriority;

/** 当前单调时间到达本次 callback deadline 时要求 continuation 让出。 */
export function unstable_shouldYield(): boolean {
  return getCurrentTime() >= deadline;
}

/** 本 fork 不使用 paint 标记；返回 continuation 本身就会安排新的 host task。 */
export function unstable_requestPaint() {
  // 无操作：callback 返回 continuation 时，runTask 会通过 `yield/postTask` 安排下一次执行。
}

/** Scheduler callback；可返回 continuation，后者复用同一优先级与取消信号。 */
type SchedulerCallback<T> = (didTimeout_DEPRECATED: boolean) =>
  | T
  // 返回函数表示工作尚未完成。
  | SchedulerCallback<T>;

/**
 * 把 Scheduler 五档优先级映射到浏览器三档优先级并提交 `postTask`。
 *
 * 返回的 controller 句柄覆盖整个 continuation 链；delay 原样交给 host 处理。
 * @param priorityLevel - Scheduler 数值级别；未知值映射 user-visible，但兼容 scope 保留原值。
 * @param callback - 原任务函数；didTimeout 固定 false，函数返回值被解释为 continuation。
 * @param options - 原生 delay 参数；本层不计算 startTime/expirationTime 或维护最小堆。
 * @returns 仅含 controller 的取消句柄，不返回 postTask Promise 或 callback 的结果。
 * @remarks 五档到三档的映射会合并级别，排序及 delay 资格由宿主决定。postTask 直接
 * 抛错会从本调用传播，异步 rejection 则交 handleAbortError 忽略；这里不检查浏览器能力。
 */
export function unstable_scheduleCallback<T>(
  priorityLevel: PriorityLevel,
  callback: SchedulerCallback<T>,
  options?: {
    /** 原生 task 延迟，单位为毫秒；缺省为 0。 */
    delay?: number
  },
): CallbackNode {
  let postTaskPriority: PostTaskPriorityLevel;
  switch (priorityLevel) {
    case ImmediatePriority:
    case UserBlockingPriority:
      postTaskPriority = 'user-blocking';
      break;
    case LowPriority:
    case NormalPriority:
      postTaskPriority = 'user-visible';
      break;
    case IdlePriority:
      postTaskPriority = 'background';
      break;
    default:
      postTaskPriority = 'user-visible';
      break;
  }

  const controller = new TaskController({priority: postTaskPriority});
  const postTaskOptions = {
    // $FlowFixMe[invalid-compare]
    delay: typeof options === 'object' && options !== null ? options.delay : 0,
    signal: controller.signal,
  };

  const node = {
    _controller: controller,
  };

  scheduler
    .postTask(
      runTask.bind(null, priorityLevel, postTaskPriority, node, callback),
      postTaskOptions,
    )
    .catch(handleAbortError);

  return node;
}

/**
 * 在一个原生 task 中执行 callback，并把 continuation 安排到新的 host task。
 *
 * 状态：进入时刷新 deadline/动态优先级，退出时恢复 Normal；controller signal 始终贯穿后续任务。
 * @param priorityLevel - 原始 Scheduler 级别，供兼容 getCurrentPriorityLevel 查询。
 * @param postTaskPriority - 首次选择的原生优先级标签；后续实际复用 controller.signal。
 * @param node - 整条 continuation 链的 controller 所有者。
 * @param callback - 当前段工作；非函数返回值结束链，不作为公开 API 结果返回。
 * @remarks 续任务不再次应用初始 delay。callback 或同步 yield/postTask 安排失败先被
 * 捕获，再由 timer 重抛；finally 固定恢复 Normal，而非保存 runTask 前的优先级。
 * callback 若返回 Promise 不被 await，因为只有函数才代表可恢复工作。
 */
function runTask<T>(
  priorityLevel: PriorityLevel,
  postTaskPriority: PostTaskPriorityLevel,
  node: CallbackNode,
  callback: SchedulerCallback<T>,
) {
  deadline = getCurrentTime() + yieldInterval;
  try {
    currentPriorityLevel_DEPRECATED = priorityLevel;
    const didTimeout_DEPRECATED = false;
    const result = callback(didTimeout_DEPRECATED);
    if (typeof result === 'function') {
      // 函数返回值按 Scheduler 协议解释为 continuation。
      const continuation: SchedulerCallback<T> = result as any;
      const continuationOptions = {
        signal: node._controller.signal,
      };

      const nextTask = runTask.bind(
        null,
        priorityLevel,
        postTaskPriority,
        node,
        continuation,
      );

      if (scheduler.yield !== undefined) {
        scheduler
          .yield(continuationOptions)
          .then(nextTask)
          .catch(handleAbortError);
      } else {
        scheduler
          .postTask(nextTask, continuationOptions)
          .catch(handleAbortError);
      }
    }
  } catch (error) {
    // 当前运行在 `postTask` Promise 内：直接抛出会变成 unhandled rejection。
    // 先捕获再在普通 browser task 中重抛，恢复非 Promise 任务的默认未处理错误上报行为。
    setTimeout(() => {
      throw error;
    });
  } finally {
    currentPriorityLevel_DEPRECATED = NormalPriority;
  }
}

/**
 * 吞掉 controller.abort() 产生的 Promise rejection。
 *
 * 调用方只得到取消句柄，不得到 `postTask/yield` Promise。当前处理器不检查错误类型，
 * 所有传入的 rejection 都被忽略；callback 抛错则由 `runTask` 另行通过 timer 上报。
 */
function handleAbortError(error: any) {
}

/** 通过任务句柄的 controller 中止原任务及其尚未执行的 continuation。 */
export function unstable_cancelCallback(node: CallbackNode) {
  const controller = node._controller;
  controller.abort();
}

/** 在指定兼容优先级中同步执行回调，并在 `finally` 中恢复调用方上下文。 */
export function unstable_runWithPriority<T>(
  priorityLevel: PriorityLevel,
  callback: () => T,
): T {
  const previousPriorityLevel = currentPriorityLevel_DEPRECATED;
  currentPriorityLevel_DEPRECATED = priorityLevel;
  try {
    return callback();
  } finally {
    currentPriorityLevel_DEPRECATED = previousPriorityLevel;
  }
}

/** 返回当前同步 callback scope 的兼容 Scheduler 优先级。 */
export function unstable_getCurrentPriorityLevel(): PriorityLevel {
  return currentPriorityLevel_DEPRECATED;
}

/** 高优先级上下文降到 Normal，Low/Idle 保持原级后同步执行回调。 */
export function unstable_next<T>(callback: () => T): T {
  let priorityLevel: PriorityLevel;
  switch (currentPriorityLevel_DEPRECATED) {
    case ImmediatePriority:
    case UserBlockingPriority:
    case NormalPriority:
      // 高于 Normal 的上下文降级。
      priorityLevel = NormalPriority;
      break;
    default:
      // 低优先级上下文不能升级。
      priorityLevel = currentPriorityLevel_DEPRECATED;
      break;
  }

  const previousPriorityLevel = currentPriorityLevel_DEPRECATED;
  currentPriorityLevel_DEPRECATED = priorityLevel;
  try {
    return callback();
  } finally {
    currentPriorityLevel_DEPRECATED = previousPriorityLevel;
  }
}

/**
 * 捕获当前兼容优先级并返回未来恢复该上下文的零参数包装函数。
 * @param callback - 在捕获优先级下同步调用的函数；结果或异常原样交还调用方。
 * @returns 每次执行都以 finally 恢复调用现场优先级的箭头函数。
 * @remarks 本 fork 调用 callback()，不转发参数或动态 this；原生 signal 优先级也不会
 * 因该同步 scope 改变，实际任务优先级仍由 scheduleCallback 的 controller 决定。
 */
export function unstable_wrapCallback<T>(callback: () => T): () => T {
  const parentPriorityLevel = currentPriorityLevel_DEPRECATED;
  return () => {
    const previousPriorityLevel = currentPriorityLevel_DEPRECATED;
    currentPriorityLevel_DEPRECATED = parentPriorityLevel;
    try {
      return callback();
    } finally {
      currentPriorityLevel_DEPRECATED = previousPriorityLevel;
    }
  };
}

/** `postTask` fork 不支持覆盖时间片帧率；保留空实现以匹配公共 API。 */
export function unstable_forceFrameRate() {}

/** `postTask` fork 当前没有 profiling 构建，公共能力固定为 null。 */
export const unstable_Profiling = null;
