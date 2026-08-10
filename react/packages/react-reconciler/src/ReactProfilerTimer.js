/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactInternalTypes';

import type {SuspendedReason} from './ReactFiberWorkLoop';

import type {Lane, Lanes} from './ReactFiberLane';

import type {CapturedValue} from './ReactCapturedValue';

import {
  isTransitionLane,
  isBlockingLane,
  isGestureRender,
  includesTransitionLane,
  includesBlockingLane,
  NoLanes,
} from './ReactFiberLane';

import {resolveEventType, resolveEventTimeStamp} from './ReactFiberConfig';

import {
  enableProfilerCommitHooks,
  enableProfilerNestedUpdatePhase,
  enableProfilerTimer,
  enableComponentPerformanceTrack,
} from 'shared/ReactFeatureFlags';

import getComponentNameFromFiber from './getComponentNameFromFiber';
import {isAlreadyRendering} from './ReactFiberWorkLoop';

// 刻意不使用命名导入；否则 Rollup 会为 CommonJS 互操作生成动态分派。
import * as Scheduler from 'scheduler';

/** Scheduler 的单调时钟，用于所有 render/commit 性能区间。 */
const {unstable_now: now} = Scheduler;

/** DEV ConsoleTask 工厂；宿主不支持时返回 null，生产构建消除 console 路径。 */
const createTask =
  // eslint-disable-next-line react-internal/no-production-logging
  __DEV__ && console.createTask
    ? // eslint-disable-next-line react-internal/no-production-logging
      console.createTask
    : (name: string) => null;

/** 直接由当前事件产生的常规更新。 */
export const REGULAR_UPDATE: UpdateType = 0;
/** 渲染/effect 或同一事件后续 microtask 派生的级联更新。 */
export const SPAWNED_UPDATE: UpdateType = 1;
/** Promise 解析 ping 唤醒的更新。 */
export const PINGED_UPDATE: UpdateType = 2;
/** Performance Track 用于区分更新时间来源的紧凑枚举。 */
export opaque type UpdateType = 0 | 1 | 2;

export let renderStartTime: number = -0;
export let commitStartTime: number = -0;
export let commitEndTime: number = -0;
export let commitErrors: null | Array<CapturedValue<mixed>> = null;
export let profilerStartTime: number = -1.1;
export let profilerEffectDuration: number = -0;
export let componentEffectDuration: number = -0;
export let componentEffectStartTime: number = -1.1;
export let componentEffectEndTime: number = -1.1;
export let componentEffectErrors: null | Array<CapturedValue<mixed>> = null;
export let componentEffectSpawnedUpdate: boolean = false;

export let blockingClampTime: number = -0;
export let blockingUpdateTime: number = -1.1; // 首个同步 setState 的调度时刻。
export let blockingUpdateTask: null | ConsoleTask = null; // 首个同步 setState 的调用栈。
export let blockingUpdateType: UpdateType = 0;
export let blockingUpdateMethodName: null | string = null; // 触发首个同步更新的方法名。
export let blockingUpdateComponentName: null | string = null; // 首个同步更新所在组件名。
export let blockingEventTime: number = -1.1; // 首个 setState 的事件 timeStamp。
export let blockingEventType: null | string = null; // 首个 setState 的事件类型。
export let blockingEventRepeatTime: number = -1.1;
export let blockingSuspendedTime: number = -1.1;

export let gestureClampTime: number = -0;
export let gestureUpdateTime: number = -1.1; // startGestureTransition 内首个 setOptimistic 时刻。
export let gestureUpdateTask: null | ConsoleTask = null; // 首个 gesture 更新的调用栈。
export let gestureUpdateType: UpdateType = 0;
export let gestureUpdateMethodName: null | string = null; // 触发首个 gesture 更新的方法名。
export let gestureUpdateComponentName: null | string = null; // 首个 gesture 更新所在组件名。
export let gestureEventTime: number = -1.1; // 首个 gesture 更新的事件 timeStamp。
export let gestureEventType: null | string = null; // 首个 gesture 更新的事件类型。
export let gestureEventRepeatTime: number = -1.1;
export let gestureSuspendedTime: number = -1.1;

// TODO：这些状态实际应按每条 TransitionLane 分开保存。
export let transitionClampTime: number = -0;
export let transitionStartTime: number = -1.1; // setState 前首个 startTransition 调用时刻。
export let transitionUpdateTime: number = -1.1; // 首个 Transition setState 调度时刻。
export let transitionUpdateType: UpdateType = 0;
export let transitionUpdateTask: null | ConsoleTask = null; // 首个 Transition setState 调用栈。
export let transitionUpdateMethodName: null | string = null; // 触发首个 Transition 更新的方法名。
export let transitionUpdateComponentName: null | string = null; // 首个 Transition 更新所在组件名。
export let transitionEventTime: number = -1.1; // 首个 Transition 的事件 timeStamp。
export let transitionEventType: null | string = null; // 首个 Transition 的事件类型。
export let transitionEventRepeatTime: number = -1.1;
export let transitionSuspendedTime: number = -1.1;

export let retryClampTime: number = -0;
export let idleClampTime: number = -0;

export let animatingLanes: Lanes = NoLanes;
export let animatingTask: null | ConsoleTask = null; // 首个应用 Animation 的 ViewTransition。

export let yieldReason: SuspendedReason = 0 as any;
export let yieldStartTime: number = -1.1; // 让出给事件循环的时刻。

/** 记录工作循环本次 yield 的时间与挂起原因，供 Component Performance Track 展示。 */
export function startYieldTimer(reason: SuspendedReason) {
  if (!enableProfilerTimer || !enableComponentPerformanceTrack) {
    return;
  }
  yieldStartTime = now();
  yieldReason = reason;
}

/**
 * 按 Lane 类别记录本事件首个 gesture/blocking/transition 更新的时间、调用栈、方法与组件。
 * 同事件重复 blocking 更新或渲染期间更新标为 SPAWNED_UPDATE，便于暴露级联性能问题。
 */
export function startUpdateTimerByLane(
  lane: Lane,
  method: string,
  fiber: Fiber | null,
): void {
  if (!enableProfilerTimer || !enableComponentPerformanceTrack) {
    return;
  }
  if (isGestureRender(lane)) {
    if (gestureUpdateTime < 0) {
      gestureUpdateTime = now();
      gestureUpdateTask = createTask(method);
      gestureUpdateMethodName = method;
      if (__DEV__ && fiber != null) {
        gestureUpdateComponentName = getComponentNameFromFiber(fiber);
      }
      const newEventTime = resolveEventTimeStamp();
      const newEventType = resolveEventType();
      if (
        newEventTime !== gestureEventRepeatTime ||
        newEventType !== gestureEventType
      ) {
        gestureEventRepeatTime = -1.1;
      }
      gestureEventTime = newEventTime;
      gestureEventType = newEventType;
    }
  } else if (isBlockingLane(lane)) {
    if (blockingUpdateTime < 0) {
      blockingUpdateTime = now();
      blockingUpdateTask = createTask(method);
      blockingUpdateMethodName = method;
      if (__DEV__ && fiber != null) {
        blockingUpdateComponentName = getComponentNameFromFiber(fiber);
      }
      if (isAlreadyRendering()) {
        componentEffectSpawnedUpdate = true;
        blockingUpdateType = SPAWNED_UPDATE;
      }
      const newEventTime = resolveEventTimeStamp();
      const newEventType = resolveEventType();
      if (
        newEventTime !== blockingEventRepeatTime ||
        newEventType !== blockingEventType
      ) {
        blockingEventRepeatTime = -1.1;
      } else if (newEventType !== null) {
        // 同一事件的第二次更新视为 spawned：可能来自 effect microtask、多次 flushSync，或
        // 首次 setState 后 microtask 中的再次 setState，都会拉长阻塞区间。
        blockingUpdateType = SPAWNED_UPDATE;
      }
      blockingEventTime = newEventTime;
      blockingEventType = newEventType;
    }
  } else if (isTransitionLane(lane)) {
    if (transitionUpdateTime < 0) {
      transitionUpdateTime = now();
      transitionUpdateTask = createTask(method);
      transitionUpdateMethodName = method;
      if (__DEV__ && fiber != null) {
        transitionUpdateComponentName = getComponentNameFromFiber(fiber);
      }
      if (transitionStartTime < 0) {
        const newEventTime = resolveEventTimeStamp();
        const newEventType = resolveEventType();
        if (
          newEventTime !== transitionEventRepeatTime ||
          newEventType !== transitionEventType
        ) {
          transitionEventRepeatTime = -1.1;
        }
        transitionEventTime = newEventTime;
        transitionEventType = newEventType;
      }
    }
  }
}

/**
 * 记录宿主 action 同时产生的 pending blocking 更新与 action Transition 更新。
 * 两条 track 共享宿主 Fiber 的 debug task，并保留事件重复/级联判定。
 */
export function startHostActionTimer(fiber: Fiber): void {
  if (!enableProfilerTimer || !enableComponentPerformanceTrack) {
    return;
  }
  // pending state 使用 blocking lane，action 更新使用 TransitionLane；两者复用宿主 debug task。
  if (blockingUpdateTime < 0) {
    blockingUpdateTime = now();
    blockingUpdateTask =
      __DEV__ && fiber._debugTask != null ? fiber._debugTask : null;
    if (isAlreadyRendering()) {
      blockingUpdateType = SPAWNED_UPDATE;
    }
    const newEventTime = resolveEventTimeStamp();
    const newEventType = resolveEventType();
    if (
      newEventTime !== blockingEventRepeatTime ||
      newEventType !== blockingEventType
    ) {
      blockingEventRepeatTime = -1.1;
    } else if (newEventType !== null) {
      // 同一事件的第二次更新视为 spawned：可能来自 effect microtask、多次 flushSync，或
      // 首次 setState 后 microtask 中的再次 setState。
      blockingUpdateType = SPAWNED_UPDATE;
    }
    blockingEventTime = newEventTime;
    blockingEventType = newEventType;
  }
  if (transitionUpdateTime < 0) {
    transitionUpdateTime = now();
    transitionUpdateTask =
      __DEV__ && fiber._debugTask != null ? fiber._debugTask : null;
    if (transitionStartTime < 0) {
      const newEventTime = resolveEventTimeStamp();
      const newEventType = resolveEventType();
      if (
        newEventTime !== transitionEventRepeatTime ||
        newEventType !== transitionEventType
      ) {
        transitionEventRepeatTime = -1.1;
      }
      transitionEventTime = newEventTime;
      transitionEventType = newEventType;
    }
  }
}

/**
 * Promise ping 首次唤醒某类车道时记录更新时间，并把 clamp 同步到当前时刻。
 * 不清除旧事件身份，以便仍可判断是否为同一事件重复；track 类型标为 PINGED_UPDATE。
 */
export function startPingTimerByLanes(lanes: Lanes): void {
  if (!enableProfilerTimer || !enableComponentPerformanceTrack) {
    return;
  }
  // ping 不展示原事件起点，故把更早区间 clamp 到当前；但保留事件身份以判断重复。
  if (isGestureRender(lanes)) {
    if (gestureUpdateTime < 0) {
      gestureClampTime = gestureUpdateTime = now();
      gestureUpdateTask = createTask('Promise Resolved');
      gestureUpdateType = PINGED_UPDATE;
    }
  } else if (includesBlockingLane(lanes)) {
    if (blockingUpdateTime < 0) {
      blockingClampTime = blockingUpdateTime = now();
      blockingUpdateTask = createTask('Promise Resolved');
      blockingUpdateType = PINGED_UPDATE;
    }
  } else if (includesTransitionLane(lanes)) {
    if (transitionUpdateTime < 0) {
      transitionClampTime = transitionUpdateTime = now();
      transitionUpdateTask = createTask('Promise Resolved');
      transitionUpdateType = PINGED_UPDATE;
    }
  }
}

/** 按当前车道类别保存 render 挂起时刻，作为性能区间的 suspended 分界。 */
export function trackSuspendedTime(lanes: Lanes, renderEndTime: number) {
  if (!enableProfilerTimer || !enableComponentPerformanceTrack) {
    return;
  }
  if (isGestureRender(lanes)) {
    gestureSuspendedTime = renderEndTime;
  } else if (includesBlockingLane(lanes)) {
    blockingSuspendedTime = renderEndTime;
  } else if (includesTransitionLane(lanes)) {
    transitionSuspendedTime = renderEndTime;
  }
}

/** 完成 blocking track 后清空更新元数据，并保留本次事件时刻用于下轮重复判定。 */
export function clearBlockingTimers(): void {
  blockingUpdateTime = -1.1;
  blockingUpdateType = 0;
  blockingUpdateMethodName = null;
  blockingUpdateComponentName = null;
  blockingSuspendedTime = -1.1;
  blockingEventRepeatTime = blockingEventTime;
  blockingEventTime = -1.1;
  blockingClampTime = now();
}

/**
 * async action 开始但尚未 setState 时记录 Transition 起点与事件身份；已有 Transition
 * 起点或更新时不覆盖首因。
 */
export function startAsyncTransitionTimer(): void {
  if (!enableProfilerTimer || !enableComponentPerformanceTrack) {
    return;
  }
  if (transitionStartTime < 0 && transitionUpdateTime < 0) {
    transitionStartTime = now();
    const newEventTime = resolveEventTimeStamp();
    const newEventType = resolveEventType();
    if (
      newEventTime !== transitionEventRepeatTime ||
      newEventType !== transitionEventType
    ) {
      transitionEventRepeatTime = -1.1;
    }
    transitionEventTime = newEventTime;
    transitionEventType = newEventType;
  }
}

/** 是否已有 Transition setState 或 useActionState 更新进入性能 track。 */
export function hasScheduledTransitionWork(): boolean {
  return transitionUpdateTime > -1;
}

/** async action 结束时仅清除 startTransition 起点，保留已调度更新的 track。 */
export function clearAsyncTransitionTimer(): void {
  transitionStartTime = -1.1;
}

/** 完成 Transition track 后清空时间/类型，并保留事件时刻用于重复判定。 */
export function clearTransitionTimers(): void {
  transitionStartTime = -1.1;
  transitionUpdateTime = -1.1;
  transitionUpdateType = 0;
  transitionSuspendedTime = -1.1;
  transitionEventRepeatTime = transitionEventTime;
  transitionEventTime = -1.1;
  transitionClampTime = now();
}

/** gesture transition 内是否已调用 setOptimistic 并产生工作。 */
export function hasScheduledGestureTransitionWork(): boolean {
  return gestureUpdateTime > -1;
}

/** 完成 gesture track 后清空时间/类型，并保留事件时刻用于重复判定。 */
export function clearGestureTimers(): void {
  gestureUpdateTime = -1.1;
  gestureUpdateType = 0;
  gestureSuspendedTime = -1.1;
  gestureEventRepeatTime = gestureEventTime;
  gestureEventTime = -1.1;
  gestureClampTime = now();
}

/**
 * 清除未实际产生 render 的 gesture 更新；与 clearGestureTimers 相同，但不推进 clampTime。
 */
export function clearGestureUpdates(): void {
  gestureUpdateTime = -1.1;
  gestureUpdateType = 0;
  gestureSuspendedTime = -1.1;
  gestureEventRepeatTime = gestureEventTime;
  gestureEventTime = -1.1;
}

/** 把渲染/提交期间新 blocking 更新的 track 起点限制到当前提交末尾，避免时间线重叠。 */
export function clampBlockingTimers(finalTime: number): void {
  if (!enableProfilerTimer || !enableComponentPerformanceTrack) {
    return;
  }
  // 渲染/提交期间进入的新更新不应生成重叠 track，截到提交末尾。
  blockingClampTime = finalTime;
}

/** 把渲染/提交期间新 gesture 更新的 track 起点限制到当前提交末尾。 */
export function clampGestureTimers(finalTime: number): void {
  if (!enableProfilerTimer || !enableComponentPerformanceTrack) {
    return;
  }
  // 渲染/提交期间进入的新更新不应生成重叠 track，截到提交末尾。
  gestureClampTime = finalTime;
}

/** 把渲染/提交期间新 Transition 更新的 track 起点限制到当前提交末尾。 */
export function clampTransitionTimers(finalTime: number): void {
  if (!enableProfilerTimer || !enableComponentPerformanceTrack) {
    return;
  }
  // 渲染/提交期间进入的新更新不应生成重叠 track，截到提交末尾。
  transitionClampTime = finalTime;
}

/** 把 retry track 的最早可见时间推进到 finalTime。 */
export function clampRetryTimers(finalTime: number): void {
  if (!enableProfilerTimer || !enableComponentPerformanceTrack) {
    return;
  }
  retryClampTime = finalTime;
}

/** 把 idle track 的最早可见时间推进到 finalTime。 */
export function clampIdleTimers(finalTime: number): void {
  if (!enableProfilerTimer || !enableComponentPerformanceTrack) {
    return;
  }
  idleClampTime = finalTime;
}

/** 进入嵌套提交作用域：保存父 Profiler effectDuration 并把子计数器归零。 */
export function pushNestedEffectDurations(): number {
  if (!enableProfilerTimer || !enableProfilerCommitHooks) {
    return 0;
  }
  const prevEffectDuration = profilerEffectDuration;
  profilerEffectDuration = 0; // 重置子作用域计数器。
  return prevEffectDuration;
}

/** 离开嵌套作用域：返回子耗时并恢复父 Profiler effectDuration，不向父级累加。 */
export function popNestedEffectDurations(prevEffectDuration: number): number {
  if (!enableProfilerTimer || !enableProfilerCommitHooks) {
    return 0;
  }
  const elapsedTime = profilerEffectDuration;
  profilerEffectDuration = prevEffectDuration;
  return elapsedTime;
}

/**
 * 离开嵌套作用域并把子耗时上冒到父 Profiler；返回值仍是当前子作用域自身耗时。
 */
export function bubbleNestedEffectDurations(
  prevEffectDuration: number,
): number {
  if (!enableProfilerTimer || !enableProfilerCommitHooks) {
    return 0;
  }
  const elapsedTime = profilerEffectDuration;
  profilerEffectDuration += prevEffectDuration;
  return elapsedTime;
}

/** 开始新的组件提交统计时清空首个 effect 起点与最后 effect 终点。 */
export function resetComponentEffectTimers(): void {
  if (!enableProfilerTimer || !enableProfilerCommitHooks) {
    return;
  }
  componentEffectStartTime = -1.1;
  componentEffectEndTime = -1.1;
}

/** 进入子组件 effect 作用域：保存父起点并等待记录子组件首个 effect。 */
export function pushComponentEffectStart(): number {
  if (!enableProfilerTimer || !enableProfilerCommitHooks) {
    return 0;
  }
  const prevEffectStart = componentEffectStartTime;
  componentEffectStartTime = -1.1; // 等待下一次 effect start。
  return prevEffectStart;
}

/**
 * 离开子组件作用域；父级已有起点则恢复，否则保留子级起点作为祖先首个 effect 时刻。
 */
export function popComponentEffectStart(prevEffectStart: number): void {
  if (!enableProfilerTimer || !enableProfilerCommitHooks) {
    return;
  }
  // 父组件没有起点时，让当前子级起点继续上冒。
  if (prevEffectStart >= 0) {
    // 否则恢复父组件原起点。
    componentEffectStartTime = prevEffectStart;
  }
}

/** 进入子组件 effect 作用域：保存父组件耗时并把子计数器归零。 */
export function pushComponentEffectDuration(): number {
  if (!enableProfilerTimer || !enableProfilerCommitHooks) {
    return 0;
  }
  const prevEffectDuration = componentEffectDuration;
  componentEffectDuration = -0; // 重置组件级耗时。
  return prevEffectDuration;
}

/** 离开子组件作用域；父级已有统计时恢复父值，否则让子耗时继续上冒。 */
export function popComponentEffectDuration(prevEffectDuration: number): void {
  if (!enableProfilerTimer || !enableProfilerCommitHooks) {
    return;
  }
  // 父组件没有既有统计时，让当前子级耗时继续上冒。
  if (prevEffectDuration >= 0) {
    // 否则恢复父组件原耗时。
    componentEffectDuration = prevEffectDuration;
  }
}

/** 进入子组件 effect 作用域：保存父错误数组并清空子数组。 */
export function pushComponentEffectErrors(): null | Array<
  CapturedValue<mixed>,
> {
  if (!enableProfilerTimer || !enableProfilerCommitHooks) {
    return null;
  }
  const prevErrors = componentEffectErrors;
  componentEffectErrors = null;
  return prevErrors;
}

/** 离开子组件 effect 作用域并恢复父错误数组。 */
export function popComponentEffectErrors(
  prevErrors: null | Array<CapturedValue<mixed>>,
): void {
  if (!enableProfilerTimer || !enableProfilerCommitHooks) {
    return;
  }
  componentEffectErrors = prevErrors;
}

/** 进入子组件 effect 作用域：保存父级 spawned-update 标记并清零。 */
export function pushComponentEffectDidSpawnUpdate(): boolean {
  if (!enableProfilerTimer || !enableProfilerCommitHooks) {
    return false;
  }

  const prev = componentEffectSpawnedUpdate;
  componentEffectSpawnedUpdate = false; // 重置子作用域标记。
  return prev;
}

/** 离开子组件 effect 作用域并恢复父级 spawned-update 标记。 */
export function popComponentEffectDidSpawnUpdate(previousValue: boolean): void {
  if (!enableProfilerTimer || !enableProfilerCommitHooks) {
    return;
  }

  componentEffectSpawnedUpdate = previousValue;
}

/**
 * 跟踪当前更新是否为 layout effect 调度的嵌套/级联更新。
 *
 * 时序为 render → commit（onRender/onCommit）→ 检查嵌套更新 → passive effects
 *（onPostCommit）。嵌套身份在第三步才确定，但第四步仍属于刚提交的工作，因此用两个标记
 * 分别表示“下一次更新”与“当前更新”，并在 render 开始时从前者同步到后者。
 */
let currentUpdateIsNested: boolean = false;
let nestedUpdateScheduled: boolean = false;

/** 当前正在提交/报告的更新是否为嵌套更新。 */
export function isCurrentUpdateNested(): boolean {
  return currentUpdateIsNested;
}

/** 标记提交期间已调度下一次嵌套更新。 */
export function markNestedUpdateScheduled(): void {
  if (enableProfilerNestedUpdatePhase) {
    nestedUpdateScheduled = true;
  }
}

/** 开始全新非嵌套序列时清空当前与待同步标记。 */
export function resetNestedUpdateFlag(): void {
  if (enableProfilerNestedUpdatePhase) {
    currentUpdateIsNested = false;
    nestedUpdateScheduled = false;
  }
}

/** render 开始时把“已调度下一次”同步为“当前”，随后清空待同步标记。 */
export function syncNestedUpdateFlag(): void {
  if (enableProfilerNestedUpdatePhase) {
    currentUpdateIsNested = nestedUpdateScheduled;
    nestedUpdateScheduled = false;
  }
}

/** 记录本轮 render 的全局起点，供 Component Performance Track 使用。 */
export function recordRenderTime(): void {
  if (!enableProfilerTimer || !enableComponentPerformanceTrack) {
    return;
  }
  renderStartTime = now();
}

/** 记录本轮 commit 起点，供 Profiler callbacks 与性能 track 共用。 */
export function recordCommitTime(): void {
  if (!enableProfilerTimer) {
    return;
  }
  commitStartTime = now();
}

/** 记录本轮 commit 终点，用于截断新更新及绘制提交区间。 */
export function recordCommitEndTime(): void {
  if (!enableProfilerTimer) {
    return;
  }
  commitEndTime = now();
}

/**
 * 启动当前 Fiber render/effect 计时；Fiber 尚无 actualStartTime 时保存本轮首次起点。
 */
export function startProfilerTimer(fiber: Fiber): void {
  if (!enableProfilerTimer) {
    return;
  }

  profilerStartTime = now();

  if ((fiber.actualStartTime as any as number) < 0) {
    fiber.actualStartTime = profilerStartTime;
  }
}

/** 停止全局 Profiler 计时器但不记录耗时，用于无需计入当前 Fiber 的退出路径。 */
export function stopProfilerTimerIfRunning(fiber: Fiber): void {
  if (!enableProfilerTimer) {
    return;
  }
  profilerStartTime = -1;
}

/**
 * 停止计时并把本段耗时累加到 actualDuration，同时以其作为本轮 selfBaseDuration。
 */
export function stopProfilerTimerIfRunningAndRecordDuration(
  fiber: Fiber,
): void {
  if (!enableProfilerTimer) {
    return;
  }

  if (profilerStartTime >= 0) {
    const elapsedTime = now() - profilerStartTime;
    fiber.actualDuration += elapsedTime;
    fiber.selfBaseDuration = elapsedTime;
    profilerStartTime = -1;
  }
}

/**
 * 错误/中断路径停止计时，只累加 actualDuration；不更新 selfBaseDuration，避免把未完成
 * render 当作稳定基准。
 */
export function stopProfilerTimerIfRunningAndRecordIncompleteDuration(
  fiber: Fiber,
): void {
  if (!enableProfilerTimer) {
    return;
  }

  if (profilerStartTime >= 0) {
    const elapsedTime = now() - profilerStartTime;
    fiber.actualDuration += elapsedTime;
    // 本轮出错，不能更新 selfBaseDuration。
    profilerStartTime = -1;
  }
}

/**
 * 结束当前 commit effect 计时，并累加到最近 Profiler 与当前组件；同时推进组件最后 effect
 * 终点，供性能 track 描绘完整 effect 区间。
 */
export function recordEffectDuration(fiber: Fiber): void {
  if (!enableProfilerTimer || !enableProfilerCommitHooks) {
    return;
  }

  if (profilerStartTime >= 0) {
    const endTime = now();
    const elapsedTime = endTime - profilerStartTime;

    profilerStartTime = -1;

    // 保存到最近 Profiler 祖先，或 Root（供 DevTools Profiler 读取）。
    profilerEffectDuration += elapsedTime;
    componentEffectDuration += elapsedTime;

    // 记录最后一个 effect 的结束时刻。
    componentEffectEndTime = endTime;
  }
}

/** 同时把 effect 错误登记到当前组件区间与整次 commit，供性能 track 关联错误。 */
export function recordEffectError(errorInfo: CapturedValue<mixed>): void {
  if (!enableProfilerTimer || !enableProfilerCommitHooks) {
    return;
  }
  if (componentEffectErrors === null) {
    componentEffectErrors = [];
  }
  componentEffectErrors.push(errorInfo);
  if (commitErrors === null) {
    commitErrors = [];
  }
  commitErrors.push(errorInfo);
}

/** 新提交开始前清空上一轮 commit 错误。 */
export function resetCommitErrors(): void {
  commitErrors = null;
}

/** 启动 commit effect 计时，并在当前组件尚无起点时记录首个 effect 时刻。 */
export function startEffectTimer(): void {
  if (!enableProfilerTimer || !enableProfilerCommitHooks) {
    return;
  }
  profilerStartTime = now();
  if (componentEffectStartTime < 0) {
    // 当前组件第一次启动 effect 时保存区间起点。
    componentEffectStartTime = profilerStartTime;
  }
}

/**
 * 第二遍重渲染前把 child.actualDuration 转移到父 Fiber，保留多遍工作总耗时。
 */
export function transferActualDuration(fiber: Fiber): void {
  let child = fiber.child;
  while (child) {
    // $FlowFixMe[unsafe-addition] addition with possible null/undefined value
    fiber.actualDuration += child.actualDuration;
    child = child.sibling;
  }
}

/** 把车道加入正在执行 ViewTransition Animation 的集合，并等待首个 ConsoleTask。 */
export function startAnimating(lanes: Lanes): void {
  animatingLanes |= lanes;
  animatingTask = null;
}

/** 从动画集合移除已完成车道，并清空当前动画任务归因。 */
export function stopAnimating(lanes: Lanes): void {
  animatingLanes &= ~lanes;
  animatingTask = null;
}

/** 保存本轮动画的首个 ConsoleTask，后续任务不覆盖首因调用栈。 */
export function trackAnimatingTask(task: ConsoleTask): void {
  if (animatingTask === null) {
    animatingTask = task;
  }
}
