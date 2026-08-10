/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/* eslint-disable no-var */

import type {PriorityLevel} from '../SchedulerPriorities';

import {
  enableProfiling,
  frameYieldMs,
  userBlockingPriorityTimeout,
  lowPriorityTimeout,
  normalPriorityTimeout,
  enableRequestPaint,
  enableAlwaysYieldScheduler,
} from '../SchedulerFeatureFlags';

import {push, pop, peek} from '../SchedulerMinHeap';

// TODO: 是否改用 Symbol 表示优先级，避免外部依赖内部数字编码？
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

/**
 * Scheduler 任务回调；参数表示任务开始时是否已经过期，返回另一个回调可创建 continuation。
 *
 * continuation 复用同一个 Task 与过期时间，并在新的 host task 中继续执行。
 */
export type Callback = boolean => ?Callback;

/**
 * 可在 timer queue 与 task queue 之间迁移的调度任务。
 *
 * 不变量：同一时刻最多位于一个堆；取消通过把 `callback` 置空实现，节点随后从堆顶惰性删除。
 */
export opaque type Task = {
  // 单调递增编号；`sortIndex` 相同时维持 FIFO 顺序。
  id: number,
  // 待执行回调；`null` 是已取消或当前正在执行的状态标记。
  callback: Callback | null,
  // 创建任务时确定的 Scheduler 优先级。
  priorityLevel: PriorityLevel,
  // 任务最早可执行的绝对时间，单位为毫秒。
  startTime: number,
  // 任务必须视为超时的绝对时间，等于 `startTime + priority timeout`。
  expirationTime: number,
  // 所在堆的排序键：timer queue 用 `startTime`，task queue 用 `expirationTime`。
  sortIndex: number,
  // 仅 profiling 构建使用，表示任务是否已被记录为进入 ready queue。
  isQueued?: boolean,
};

/** 返回 Scheduler 单调时间；优先采用高精度 `performance.now()`。 */
let getCurrentTime: () => number | DOMHighResTimeStamp;
// 当前 host 是否提供高精度、单调递增的 Performance 时间源。
const hasPerformanceNow =
  // $FlowFixMe[method-unbinding]
  typeof performance === 'object' && typeof performance.now === 'function';

if (hasPerformanceNow) {
  const localPerformance = performance;
  getCurrentTime = () => localPerformance.now();
} else {
  const localDate = Date;
  const initialTime = localDate.now();
  getCurrentTime = () => localDate.now() - initialTime;
}

// 最大 31 位有符号整数，也是 32 位 V8 可高效表示的最大整数；Idle 任务借它近似“永不过期”。
// Math.pow(2, 30) - 1
// 0b111111111111111111111111111111
var maxSigned31BitInt = 1073741823;

// ready task 最小堆；按过期时间、再按任务 id 排序。
var taskQueue: Array<Task> = [];
// delayed timer 最小堆；按开始时间、再按任务 id 排序。
var timerQueue: Array<Task> = [];

// 单调任务编号，用于在排序键相同时保持插入顺序。
var taskIdCounter = 1;

// 当前正在执行的任务；每轮 flush 结束必须清空。
var currentTask = null;
// 当前动态优先级上下文；任务执行及 runWithPriority 都会临时覆盖它。
var currentPriorityLevel: PriorityLevel = NormalPriority;

// 执行 work loop 时置为 true，防止调度新任务时重入 host callback。
var isPerformingWork = false;

// 已请求但尚未执行的 host callback 标记，避免重复发送消息。
var isHostCallbackScheduled = false;
// 已请求但尚未触发的 host timeout 标记，只追踪最早 delayed timer。
var isHostTimeoutScheduled = false;

// renderer 请求绘制后置为 true；下一次 host deadline 检查可因此提前 yield。
var needsPaint = false;

// 模块初始化时捕获原生 API，避免之后安装的 polyfill 或 fake timer 改变调度语义。
// host timeout 的本地引用；处理 delayed timer 和最低级 fallback。
const localSetTimeout = typeof setTimeout === 'function' ? setTimeout : null;
// 与 `localSetTimeout` 成对，用于取消已失效的最早 delayed timer。
const localClearTimeout =
  typeof clearTimeout === 'function' ? clearTimeout : null;
// Node.js、旧 IE 与 jsdom 优先使用的 host task API。
const localSetImmediate =
  typeof setImmediate !== 'undefined' ? setImmediate : null; // IE、Node.js 与 jsdom

/**
 * 把已到开始时间的 delayed timer 迁移到 ready task queue，并清理已取消 timer。
 *
 * 状态：迁移时将 `sortIndex` 从开始时间改为过期时间；遇到首个未来 timer 即停止。
 */
function advanceTimers(currentTime: number) {
  // timer queue 已排序，只需连续检查堆顶，无需扫描其余未来任务。
  let timer = peek(timerQueue);
  while (timer !== null) {
    if (timer.callback === null) {
      // 取消仅清空 callback；节点到达堆顶后在此惰性删除。
      pop(timerQueue);
    } else if (timer.startTime <= currentTime) {
      // timer 已到期：从延迟堆移除，以过期时间作为新排序键进入 ready 堆。
      pop(timerQueue);
      timer.sortIndex = timer.expirationTime;
      push(taskQueue, timer);
      // $FlowFixMe[constant-condition]
      if (enableProfiling) {
        markTaskStart(timer, currentTime);
        timer.isQueued = true;
      }
    } else {
      // 堆顶尚未开始，其余 timer 也都仍在未来。
      return;
    }
    timer = peek(timerQueue);
  }
}

/**
 * 处理最早 delayed timer 的 host timeout。
 *
 * 搬运到期任务后优先唤醒 work loop；若仍无 ready task，则只为新的最早 timer 设 timeout。
 */
function handleTimeout(currentTime: number) {
  isHostTimeoutScheduled = false;
  advanceTimers(currentTime);

  if (!isHostCallbackScheduled) {
    if (peek(taskQueue) !== null) {
      isHostCallbackScheduled = true;
      requestHostCallback();
    } else {
      const firstTimer = peek(timerQueue);
      if (firstTimer !== null) {
        requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
      }
    }
  }
}

/**
 * 建立一次不可重入的 Scheduler flush，并在退出时恢复动态优先级和 profiling 状态。
 *
 * 错误边界：profiling 构建额外记录当前任务错误，但始终把原错误继续抛给 host。
 */
function flushWork(initialTime: number) {
  // $FlowFixMe[constant-condition]
  if (enableProfiling) {
    markSchedulerUnsuspended(initialTime);
  }

  // 当前 host callback 已被消费；后续剩余工作需重新登记下一次 callback。
  isHostCallbackScheduled = false;
  if (isHostTimeoutScheduled) {
    // ready work 已经出现，先前等待 delayed timer 的 timeout 已无必要。
    isHostTimeoutScheduled = false;
    cancelHostTimeout();
  }

  isPerformingWork = true;
  const previousPriorityLevel = currentPriorityLevel;
  try {
    // $FlowFixMe[constant-condition]
    if (enableProfiling) {
      try {
        return workLoop(initialTime);
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
      // 非 profiling 路径不增加 catch，保持生产热路径和原始错误栈尽量精简。
      return workLoop(initialTime);
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
 * 按过期时间执行 ready task，直到队列清空或未过期任务应向 host 让出。
 *
 * 状态：callback 执行前置空；返回函数时把 continuation 写回同一任务并强制结束本轮 slice。
 * @returns `true` 表示仍有 ready 工作，需要再安排 host callback。
 */
function workLoop(initialTime: number) {
  let currentTime = initialTime;
  advanceTimers(currentTime);
  currentTask = peek(taskQueue);
  while (currentTask !== null) {
    if (!enableAlwaysYieldScheduler) {
      if (currentTask.expirationTime > currentTime && shouldYieldToHost()) {
        // 未过期任务允许时间切片；已到 host deadline 时保留在堆顶等待下一轮。
        break;
      }
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
        // $FlowFixMe[incompatible-type] found when upgrading Flow
        markTaskRun(currentTask, currentTime);
      }
      const continuationCallback = callback(didUserCallbackTimeout);
      currentTime = getCurrentTime();
      if (typeof continuationCallback === 'function') {
        // continuation 必须放到新的 host task；即使当前时间片尚有余额，也立即归还主线程。
        // $FlowFixMe[incompatible-use] found when upgrading Flow
        currentTask.callback = continuationCallback;
        // $FlowFixMe[constant-condition]
        if (enableProfiling) {
          // $FlowFixMe[incompatible-type] found when upgrading Flow
          markTaskYield(currentTask, currentTime);
        }
        advanceTimers(currentTime);
        return true;
      } else {
        // $FlowFixMe[constant-condition]
        if (enableProfiling) {
          // $FlowFixMe[incompatible-type] found when upgrading Flow
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
    if (enableAlwaysYieldScheduler) {
      if (currentTask === null || currentTask.expirationTime > currentTime) {
        // always-yield 模式只连续清空当前过期批次；下一个未过期任务留给新的 browser task。
        break;
      }
    }
  }
  // 返回值直接决定消息循环是否继续发送下一次 host callback。
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

/**
 * 在指定动态优先级中同步执行事件处理器，并在 `finally` 中恢复调用方上下文。
 *
 * 边界：非法优先级降级为 Normal，避免把未知编码传播给任务。
 */
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

/**
 * 在不高于 Normal 的动态优先级中执行回调。
 *
 * Immediate/UserBlocking 会降到 Normal；Low/Idle 保持原值，防止低优先级工作意外升级。
 */
function unstable_next<T>(eventHandler: () => T): T {
  var priorityLevel: PriorityLevel;
  switch (currentPriorityLevel) {
    case ImmediatePriority:
    case UserBlockingPriority:
    case NormalPriority:
      // 高于 Normal 的上下文降级，给回调中的普通工作留出让步空间。
      priorityLevel = NormalPriority;
      break;
    default:
      // 低于 Normal 的上下文不能升级，否则会破坏调用者的优先级约束。
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

/**
 * 捕获当前动态优先级，返回在未来调用时恢复该优先级的包装函数。
 *
 * 包装器保留原 callback 的 `this` 与参数，并在抛错时同样恢复调用现场优先级。
 */
function unstable_wrapCallback<T: (...Array<mixed>) => mixed>(callback: T): T {
  var parentPriorityLevel = currentPriorityLevel;
  // $FlowFixMe[incompatible-type]
  // $FlowFixMe[missing-this-annot]
  return function () {
    // 这是 `runWithPriority` 的内联版本，避免每次调用额外分派。
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
 * 创建任务，按 delay 和优先级计算开始/过期时间，并登记到对应最小堆。
 *
 * 状态：未来任务进入 timer queue；立即任务进入 task queue。只有最早 timer 或首个 ready task
 * 会触发 host 调度，避免同一队列重复登记 callback/timeout。
 *
 * @param priorityLevel - 决定任务超时预算的 Scheduler 优先级。
 * @param callback - 实际工作；可返回 continuation 继续同一任务。
 * @param options - 可选延迟配置。
 */
function unstable_scheduleCallback(
  priorityLevel: PriorityLevel,
  callback: Callback,
  options?: {
    // 从当前时间起延迟多久进入 ready queue，单位为毫秒；非正数按立即任务处理。
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
      // 负预算让任务在创建时立即视为过期，不受时间片 yield 限制。
      timeout = -1;
      break;
    case UserBlockingPriority:
      // 用户阻塞任务使用较短预算，避免输入反馈长期等待。
      timeout = userBlockingPriorityTimeout;
      break;
    case IdlePriority:
      // 用最大 31 位整数近似永不过期。
      timeout = maxSigned31BitInt;
      break;
    case LowPriority:
      // 低优先级任务允许较长等待时间。
      timeout = lowPriorityTimeout;
      break;
    case NormalPriority:
    default:
      // 未知优先级按 Normal 预算处理，但任务记录仍保留调用方传入值。
      timeout = normalPriorityTimeout;
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
    // delayed task 先按开始时间排序，尚不能由 work loop 执行。
    newTask.sortIndex = startTime;
    push(timerQueue, newTask);
    if (peek(taskQueue) === null && newTask === peek(timerQueue)) {
      // ready queue 为空且它成为最早 timer；host 只需为这个时间点保留一个 timeout。
      if (isHostTimeoutScheduled) {
        // 新 timer 更早，取消旧 timeout 后按新时间重新登记。
        cancelHostTimeout();
      } else {
        isHostTimeoutScheduled = true;
      }
      // timeout 到点后由 `advanceTimers` 完成跨堆迁移。
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
    // 仅在没有 host callback 且当前不在 work loop 时唤醒消息循环；执行中新增任务由本轮或退出路径接管。
    if (!isHostCallbackScheduled && !isPerformingWork) {
      isHostCallbackScheduled = true;
      requestHostCallback();
    }
  }

  return newTask;
}

/**
 * 取消任务并保留堆结构，节点到达堆顶时再惰性移除。
 *
 * WHY：数组最小堆只能高效移除根节点；把 callback 置空可让取消保持 O(1)。
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

  // `null` 同时是取消标记；advanceTimers/workLoop 遇到该节点时会丢弃它。
  task.callback = null;
}

/** 返回当前任务或动态 priority scope 的 Scheduler 优先级。 */
function unstable_getCurrentPriorityLevel(): PriorityLevel {
  return currentPriorityLevel;
}

// 消息循环是否已启动；true 时后续任务复用同一循环，不重复发送首条 host 消息。
let isMessageLoopRunning = false;
// 当前最早 delayed timer 对应的 host timeout 句柄。
let taskTimeoutID: TimeoutID = -1 as any;

// Scheduler 周期性让出主线程，让用户事件等 host 工作获得执行机会。它不会对齐浏览器帧边界；
// 大多数任务不需要帧同步，需要同步绘制的调用方应使用 requestAnimationFrame。
// 当前时间片预算，可由 `forceFrameRate` 临时覆盖，单位为毫秒。
let frameInterval: number = frameYieldMs;
// 当前 host task 开始执行 Scheduler 的时间，单位为毫秒。
let startTime = -1;

/**
 * 判断当前未过期任务是否应把执行权交还 host。
 *
 * paint 请求优先；否则比较本轮已占用时间与时间片。过期任务由 work loop 绕过此检查。
 */
function shouldYieldToHost(): boolean {
  if (!enableAlwaysYieldScheduler && enableRequestPaint && needsPaint) {
    // renderer 已请求绘制，继续执行会直接延迟可见更新。
    return true;
  }
  const timeElapsed = getCurrentTime() - startTime;
  if (timeElapsed < frameInterval) {
    // 尚未用完时间片，继续批量执行可减少 host 消息切换开销。
    return false;
  }
  // 时间片已耗尽，让用户事件、绘制等 host 工作先运行。
  return true;
}

/** 标记 renderer 需要绘制，使下一次 yield 检查尽快结束当前时间片。 */
function requestPaint() {
  // $FlowFixMe[constant-condition]
  if (enableRequestPaint) {
    needsPaint = true;
  }
}

/**
 * 用目标帧率换算 Scheduler 时间片；传入 0 恢复构建默认值。
 *
 * 边界：只接受 0 到 125，避免极短时间片造成调度震荡。
 */
function forceFrameRate(fps: number) {
  if (fps < 0 || fps > 125) {
    // 使用 console['error'] 绕过 Babel 与 ESLint 对生产日志的变换/限制。
    console['error'](
      'forceFrameRate takes a positive int between 0 and 125, ' +
        'forcing frame rates higher than 125 fps is not supported',
    );
    return;
  }
  if (fps > 0) {
    frameInterval = Math.floor(1000 / fps);
  } else {
    // 0 表示清除覆盖，恢复当前构建的默认时间片。
    frameInterval = frameYieldMs;
  }
}

/**
 * host task 的统一入口：执行一轮 flush，并按剩余工作决定续发消息或关闭消息循环。
 *
 * 错误边界：`hasMoreWork` 默认 true；即使 flush 抛错，`finally` 仍续发下一条消息，
 * 让其他任务不因一个 callback 失败而永久滞留。
 */
const performWorkUntilDeadline = () => {
  // $FlowFixMe[constant-condition]
  if (enableRequestPaint) {
    needsPaint = false;
  }
  if (isMessageLoopRunning) {
    const currentTime = getCurrentTime();
    // 每个 host task 重置时间片起点，yield 判断只计算本轮占用时间。
    startTime = currentTime;

    // 不用 catch 吞转错误，确保当前 browser task 退出并让调试器观察原错误。
    // `finally` 只负责续发消息：若 `flushWork` 抛错，`hasMoreWork` 保持 true，余下工作仍可继续。
    let hasMoreWork = true;
    try {
      hasMoreWork = flushWork(currentTime);
    } finally {
      if (hasMoreWork) {
        // 当前 host task 尾部续发消息，下一轮在新的 task 中继续。
        schedulePerformWorkUntilDeadline();
      } else {
        isMessageLoopRunning = false;
      }
    }
  }
};

/** 当前环境选定的“发送下一次 host task”实现。 */
let schedulePerformWorkUntilDeadline;
if (typeof localSetImmediate === 'function') {
  // Node.js 与旧 IE 优先使用 setImmediate。与 MessageChannel 不同，它不会阻止 Node 进程退出；
  // 即使这是 DOM fork，Node.js 15+、MessageChannel 与 jsdom 混用时仍可能进入这里。
  // https://github.com/facebook/react/issues/20756
  // setImmediate 也更早运行，更符合调度语义；若浏览器实现它同样优先，但仍不如原生调度 API。
  schedulePerformWorkUntilDeadline = () => {
    localSetImmediate(performWorkUntilDeadline);
  };
} else if (typeof MessageChannel !== 'undefined') {
  // DOM 与 Worker 环境使用 MessageChannel，避开嵌套 setTimeout 的 4 毫秒钳制。
  const channel = new MessageChannel();
  const port = channel.port2;
  channel.port1.onmessage = performWorkUntilDeadline;
  schedulePerformWorkUntilDeadline = () => {
    port.postMessage(null);
  };
} else {
  // 仅无 setImmediate/MessageChannel 的非浏览器环境回退到 setTimeout。
  schedulePerformWorkUntilDeadline = () => {
    // $FlowFixMe[not-a-function] nullable value
    localSetTimeout(performWorkUntilDeadline, 0);
  };
}

/** 确保消息循环正在运行；已运行时不重复发送 host 消息。 */
function requestHostCallback() {
  if (!isMessageLoopRunning) {
    isMessageLoopRunning = true;
    schedulePerformWorkUntilDeadline();
  }
}

/** 为最早 delayed timer 注册 host timeout，并在触发时传入 Scheduler 当前时间。 */
function requestHostTimeout(
  callback: (currentTime: number) => void,
  ms: number,
) {
  // $FlowFixMe[not-a-function] nullable value
  taskTimeoutID = localSetTimeout(() => {
    callback(getCurrentTime());
  }, ms);
}

/** 取消当前 delayed timer 的 host timeout，并清空句柄。 */
function cancelHostTimeout() {
  // $FlowFixMe[not-a-function] nullable value
  localClearTimeout(taskTimeoutID);
  taskTimeoutID = -1 as any as TimeoutID;
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
};

// profiling 开启时暴露会话控制器；关闭时固定为 null，让构建器消除记录路径。
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
