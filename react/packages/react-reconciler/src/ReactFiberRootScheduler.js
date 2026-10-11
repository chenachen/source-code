/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {FiberRoot} from './ReactInternalTypes';
import type {Lane, Lanes} from './ReactFiberLane';
import type {PriorityLevel} from 'scheduler/src/SchedulerPriorities';
import type {Transition} from 'react/src/ReactStartTransition';

import {
  disableLegacyMode,
  disableSchedulerTimeoutInWorkLoop,
  enableProfilerTimer,
  enableProfilerNestedUpdatePhase,
  enableComponentPerformanceTrack,
  enableYieldingBeforePassive,
  enableGestureTransition,
  enableDefaultTransitionIndicator,
} from 'shared/ReactFeatureFlags';
import {
  NoLane,
  NoLanes,
  SyncLane,
  DefaultLane,
  getHighestPriorityLane,
  getNextLanes,
  includesSyncLane,
  markStarvedLanesAsExpired,
  claimNextTransitionUpdateLane,
  getNextLanesToFlushSync,
  checkIfRootIsPrerendering,
  isGestureRender,
} from './ReactFiberLane';
import {
  CommitContext,
  NoContext,
  RenderContext,
  flushPendingEffects,
  flushPendingEffectsDelayed,
  getExecutionContext,
  getWorkInProgressRoot,
  getWorkInProgressRootRenderLanes,
  getRootWithPendingPassiveEffects,
  getPendingPassiveEffectsLanes,
  hasPendingCommitEffects,
  isWorkLoopSuspendedOnData,
  performWorkOnRoot,
} from './ReactFiberWorkLoop';
import {LegacyRoot} from './ReactRootTags';
import {
  ImmediatePriority as ImmediateSchedulerPriority,
  UserBlockingPriority as UserBlockingSchedulerPriority,
  NormalPriority as NormalSchedulerPriority,
  IdlePriority as IdleSchedulerPriority,
  cancelCallback as Scheduler_cancelCallback,
  scheduleCallback as Scheduler_scheduleCallback,
  now,
} from './Scheduler';
import {
  DiscreteEventPriority,
  ContinuousEventPriority,
  DefaultEventPriority,
  IdleEventPriority,
  lanesToEventPriority,
} from './ReactEventPriorities';
import {
  supportsMicrotasks,
  scheduleMicrotask,
  shouldAttemptEagerTransition,
  trackSchedulerEvent,
  noTimeout,
} from './ReactFiberConfig';

import ReactSharedInternals from 'shared/ReactSharedInternals';
import {
  resetNestedUpdateFlag,
  syncNestedUpdateFlag,
} from './ReactProfilerTimer';
import {peekEntangledActionLane} from './ReactFiberAsyncAction';

import noop from 'shared/noop';
import reportGlobalError from 'shared/reportGlobalError';

import {
  startIsomorphicDefaultIndicatorIfNeeded,
  hasOngoingIsomorphicIndicator,
  retainIsomorphicIndicator,
  markIsomorphicIndicatorHandled,
} from './ReactFiberAsyncAction';

// 所有待处理 Root 的链表。常规应用通常只有一个 Root，但仍支持多 Root；实现复杂度由此
// 而来，热路径则继续针对单 Root 优化。
export let firstScheduledRoot: FiberRoot | null = null;
let lastScheduledRoot: FiberRoot | null = null;

// 防止重复调度 microtask。
let didScheduleMicrotask: boolean = false;
// `act` 的“microtask”进入 actQueue 而非真实微任务，故需独立去重；未来若强制 await act
// 则可消除这条特殊路径。
let didScheduleMicrotask_act: boolean = false;

// 没有同步工作时让 flushSync 快速退出。
let mightHavePendingSyncWork: boolean = false;

let isFlushingWork: boolean = false;

let currentEventTransitionLane: Lane = NoLane;

/**
 * 把收到更新的 Root 加入全局待调度链表，并确保存在处理该链表的 microtask。
 * 真正的车道选择和 Scheduler callback 复用延后到 scheduleTaskForRootDuringMicrotask。
 */
export function ensureRootIsScheduled(root: FiberRoot): void {

  // 将 Root 加入调度链表。
  if (root === lastScheduledRoot || root.next !== null) {
    // 快路径：该 Root 已在链表中。
  } else {
    if (lastScheduledRoot === null) {
      firstScheduledRoot = lastScheduledRoot = root;
    } else {
      lastScheduledRoot.next = root;
      lastScheduledRoot = root;
    }
  }

  // 收到更新后保守标为可能含同步工作；处理链表时重新计算。false 时 flushSync 无需遍历。
  mightHavePendingSyncWork = true;

  ensureScheduleIsScheduled();

  if (
    __DEV__ &&
    !disableLegacyMode &&
    ReactSharedInternals.isBatchingLegacy &&
    root.tag === LegacyRoot
  ) {
    // `act` 特例：记录 legacy 更新曾被调度。
    ReactSharedInternals.didScheduleLegacyUpdate = true;
  }
}

/**
 * 确保当前更新批次会尽快遍历所有 Root，并按各自优先级建立任务。
 * 支持 microtask 的宿主在事件结束后处理；无此能力或检测到 render/commit 重入时改排 Immediate task。
 * DEV actQueue 与真实微任务分别去重，避免二者互相吞掉调度信号。
 */
export function ensureScheduleIsScheduled(): void {
  if (__DEV__ && ReactSharedInternals.actQueue !== null) {
    // 当前处于 `act` 作用域。
    if (!didScheduleMicrotask_act) {
      didScheduleMicrotask_act = true;
      scheduleImmediateRootScheduleTask();
    }
  } else {
    if (!didScheduleMicrotask) {
      didScheduleMicrotask = true;
      scheduleImmediateRootScheduleTask();
    }
  }
}

/** 在调用方已校验执行上下文后，同步冲刷所有 Root 的同步车道。 */
export function flushSyncWorkOnAllRoots() {
  flushSyncWorkAcrossRoots_impl(NoLanes, false);
}

/** 在 legacy 模式启用时，仅同步冲刷 LegacyRoot；调用方须先校验执行上下文。 */
export function flushSyncWorkOnLegacyRootsOnly() {
  if (!disableLegacyMode) {
    flushSyncWorkAcrossRoots_impl(NoLanes, true);
  }
}

/**
 * 遍历待调度 Root，反复执行符合条件的同步车道，直至本轮不再产生同步工作。
 * 重入保护避免 effect/提交阶段递归冲刷；快速标记可绕过无同步任务的链表扫描。
 */
function flushSyncWorkAcrossRoots_impl(
  syncTransitionLanes: Lanes | Lane,
  onlyLegacy: boolean,
) {
  if (isFlushingWork) {
    // 防止重入。TODO：调用方本就必须校验执行上下文，可评估该保护是否过度。
    return;
  }

  if (!mightHavePendingSyncWork) {
    // 快路径：没有同步工作。
    return;
  }

  // 标记仅表示“可能”，仍需扫描确认。
  let didPerformSomeWork;
  isFlushingWork = true;
  do {
    didPerformSomeWork = false;
    let root = firstScheduledRoot;
    while (root !== null) {
      if (onlyLegacy && (disableLegacyMode || root.tag !== LegacyRoot)) {
        // 跳过非 Legacy Root。
      } else {
        if (syncTransitionLanes !== NoLanes) {
          const nextLanes = getNextLanesToFlushSync(root, syncTransitionLanes);
          if (nextLanes !== NoLanes) {
            // 该 Root 有待处理同步工作，立即冲刷。
            didPerformSomeWork = true;
            performSyncWorkOnRoot(root, nextLanes);
          }
        } else {
          const workInProgressRoot = getWorkInProgressRoot();
          const workInProgressRootRenderLanes =
            getWorkInProgressRootRenderLanes();
          const rootHasPendingCommit =
            root.cancelPendingCommit !== null ||
            root.timeoutHandle !== noTimeout;
          const nextLanes = getNextLanes(
            root,
            root === workInProgressRoot
              ? workInProgressRootRenderLanes
              : NoLanes,
            rootHasPendingCommit,
          );
          if (
            (includesSyncLane(nextLanes) ||
              (enableGestureTransition && isGestureRender(nextLanes))) &&
            !checkIfRootIsPrerendering(root, nextLanes)
          ) {
            // 该 Root 有待处理同步工作，立即冲刷。
            didPerformSomeWork = true;
            performSyncWorkOnRoot(root, nextLanes);
          }
        }
      }
      root = root.next;
    }
  } while (didPerformSomeWork);
  isFlushingWork = false;
}

/** 在无法直接使用 microtask 的路径记录性能事件，再处理全局 Root 调度链表。 */
function processRootScheduleInImmediateTask() {
  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    // 记录当前执行事件，使性能日志可排除调度器自身事件。
    trackSchedulerEvent();
  }

  processRootScheduleInMicrotask();
}

/**
 * microtask 阶段统一重算 Root 优先级、增删调度链表节点，并在末尾冲刷同步工作。
 * 这是唯一允许从链表移除 Root 的位置，降低更新重入造成链表损坏的风险。
 */
function processRootScheduleInMicrotask() {
  // 通常从 microtask 调用；无 microtask 或需避开 render/commit 重入时由 Immediate task 回退，不能在更新入口直接同步调用。
  didScheduleMicrotask = false;
  if (__DEV__) {
    didScheduleMicrotask_act = false;
  }

  // 遍历并重新调度全部 Root 时重新计算同步工作提示位。
  mightHavePendingSyncWork = false;

  let syncTransitionLanes = NoLanes;
  if (currentEventTransitionLane !== NoLane) {
    if (shouldAttemptEagerTransition()) {
      // 事件中虽调度了 Transition，仍尝试同步渲染；popstate 借此保留上一页滚动位置。
      syncTransitionLanes = currentEventTransitionLane;
    } else if (enableDefaultTransitionIndicator) {
      // 当前事件的 Transition 可能搭配 DefaultLane loading indicator。提前冲刷以确认是否
      // 渲染 indicator，并与后续事件拆批，避免普通 default-priority setState 误触发回调。
      syncTransitionLanes = DefaultLane;
    }
  }

  const currentTime = now();

  let prev = null;
  let root = firstScheduledRoot;
  while (root !== null) {
    const next = root.next;
    const nextLanes = scheduleTaskForRootDuringMicrotask(root, currentTime);
    if (nextLanes === NoLane) {
      // 该 Root 已无待处理工作。为防隐蔽重入问题，任何位置都可加入 Root，但只有这个
      // microtask 能从调度链表移除它。

      // 置空 next，明确标记该 Root 已离开链表。
      root.next = null;
      if (prev === null) {
        // 当前 next 成为新表头。
        firstScheduledRoot = next;
      } else {
        prev.next = next;
      }
      if (next === null) {
        // 当前 prev 成为新表尾。
        lastScheduledRoot = prev;
      }
    } else {
      // 该 Root 仍有工作，保留在链表中。
      prev = root;

      // 若可能仍有同步工作则置 true；否则后续 flushSyncWorkOnAllRoots 可快速退出。
      if (
        // 指定 syncTransitionLanes 时跳过该优化。
        syncTransitionLanes !== NoLanes ||
        // 常规路径没有额外同步车道，只需检查 nextLanes 是否包含 SyncLane。
        includesSyncLane(nextLanes) ||
        (enableGestureTransition && isGestureRender(nextLanes))
      ) {
        mightHavePendingSyncWork = true;
      }
    }
    root = next;
  }

  // 在 microtask 末尾冲刷同步工作，因为实际渲染可能抛错。若 View Transition 提交序列
  // 尚未完成，则不打断它，待其完成时再冲刷剩余工作。
  if (!hasPendingCommitEffects()) {
    flushSyncWorkAcrossRoots_impl(syncTransitionLanes, false);
  }

  if (currentEventTransitionLane !== NoLane) {
    // 重置事件 Transition 车道，下一事件将重新分配。
    currentEventTransitionLane = NoLane;
    startDefaultTransitionIndicatorIfNeeded();
  }
}

/**
 * 为本次 Transition 启动默认 loading indicator，并把等价的 isomorphic indicator
 * 引用保留到各 Root 提交，保证多 Root 共享同一异步动作的可见状态。
 */
function startDefaultTransitionIndicatorIfNeeded() {
  if (!enableDefaultTransitionIndicator) {
    return;
  }
  // 异步 action 等场景可能需要先启动跨宿主一致的 indicator。
  startIsomorphicDefaultIndicatorIfNeeded();
  // 检查所有 Root 是否产生了新的 indicator 需求。
  let root = firstScheduledRoot;
  while (root !== null) {
    if (root.indicatorLanes !== NoLanes && root.pendingIndicator === null) {
      // 新 indicator 车道需要 loading 状态，启动默认 Transition indicator。
      if (hasOngoingIsomorphicIndicator()) {
        // 已有 isomorphic indicator 表示所有 Root 共用它；增加引用，使其持续到当前 Root 提交。
        root.pendingIndicator = retainIsomorphicIndicator();
      } else {
        try {
          const onDefaultTransitionIndicator =
            root.onDefaultTransitionIndicator;
          root.pendingIndicator = onDefaultTransitionIndicator() || noop;
        } catch (x) {
          root.pendingIndicator = noop;
          reportGlobalError(x);
        }
      }
    }
    root = root.next;
  }
}

/**
 * 在 microtask 中为单个 Root 选择下一组车道，并复用、取消或创建对应优先级 callback。
 *
 * 此函数只安排未来工作，不同步渲染；同步车道交给 microtask 尾部统一冲刷，挂起提交或
 * 等待数据的 Root 则撤销 callback，等待 ping/更新重新唤醒。
 */
function scheduleTaskForRootDuringMicrotask(
  root: FiberRoot,
  currentTime: number,
): Lane {
  // 仅在 microtask 内，或渲染任务让出主线程前的末尾调用；不得作为同步入口。

  // 不同步执行 React 工作，只为后续 task/microtask 建立调度。

  // 将长期被其他工作饿死的车道标为 expired，提升为下一轮候选。
  markStarvedLanesAsExpired(root, currentTime);

  // 选择下一组工作车道及其优先级。
  const rootWithPendingPassiveEffects = getRootWithPendingPassiveEffects();
  const pendingPassiveEffectsLanes = getPendingPassiveEffectsLanes();
  const workInProgressRoot = getWorkInProgressRoot();
  const workInProgressRootRenderLanes = getWorkInProgressRootRenderLanes();
  const rootHasPendingCommit =
    root.cancelPendingCommit !== null || root.timeoutHandle !== noTimeout;
  const nextLanes =
    enableYieldingBeforePassive && root === rootWithPendingPassiveEffects
      ? // callback 采用车道自身优先级；过去固定为 NormalPriority。Discrete 本就同步冲刷，
        // 差异主要在 Idle，不应仅因已过提交阶段就无条件提升它。
        pendingPassiveEffectsLanes
      : getNextLanes(
          root,
          root === workInProgressRoot ? workInProgressRootRenderLanes : NoLanes,
          rootHasPendingCommit,
        );

  const existingCallbackNode = root.callbackNode;
  if (
    // 没有可处理车道。
    nextLanes === NoLanes ||
    // Root 正挂起等待数据时不安排渲染，等待 ping 或新更新唤醒。
    //
    // 渲染阶段挂起。
    (root === workInProgressRoot && isWorkLoopSuspendedOnData()) ||
    // 提交阶段挂起。
    root.cancelPendingCommit !== null
  ) {
    // 快路径：当前无工作。
    if (existingCallbackNode !== null) {
      cancelCallback(existingCallbackNode);
    }
    root.callbackNode = null;
    root.callbackPriority = NoLane;
    return NoLane;
  }

  // 在宿主环境安排新 callback。
  if (
    includesSyncLane(nextLanes) &&
    // 预渲染即使遇到同步车道也使用并发工作循环，避免阻塞主线程。
    !checkIfRootIsPrerendering(root, nextLanes)
  ) {
    // 同步工作在 microtask 末尾统一冲刷，无需另建 task。
    if (existingCallbackNode !== null) {
      cancelCallback(existingCallbackNode);
    }
    root.callbackPriority = SyncLane;
    root.callbackNode = null;
    return SyncLane;
  } else {
    // 用最高优先级车道代表 callback 优先级。
    const existingCallbackPriority = root.callbackPriority;
    const newCallbackPriority = getHighestPriorityLane(nextLanes);

    if (
      newCallbackPriority === existingCallbackPriority &&
      // `act` 特例：若现有任务来自 Scheduler 而非 actQueue，取消并改排到 actQueue。
      !(
        __DEV__ &&
        ReactSharedInternals.actQueue !== null &&
        existingCallbackNode !== fakeActCallbackNode
      )
    ) {
      // 优先级未改变，可复用现有任务。
      return newCallbackPriority;
    } else {
      // 取消现有 callback，随后按新优先级重建。
      cancelCallback(existingCallbackNode);
    }

    let schedulerPriorityLevel;
    switch (lanesToEventPriority(nextLanes)) {
      // Scheduler 虽有 ImmediatePriority，但同步工作已由 microtask 处理；能到此处的同步
      // 工作本就应时间切片，因此映射为 UserBlockingPriority。
      case DiscreteEventPriority:
      case ContinuousEventPriority:
        schedulerPriorityLevel = UserBlockingSchedulerPriority;
        break;
      case DefaultEventPriority:
        schedulerPriorityLevel = NormalSchedulerPriority;
        break;
      case IdleEventPriority:
        schedulerPriorityLevel = IdleSchedulerPriority;
        break;
      default:
        schedulerPriorityLevel = NormalSchedulerPriority;
        break;
    }

    const newCallbackNode = scheduleCallback(
      schedulerPriorityLevel,
      performWorkOnRootViaSchedulerTask.bind(null, root),
    );

    root.callbackPriority = newCallbackPriority;
    root.callbackNode = newCallbackNode;
    return newCallbackPriority;
  }
}

/** Scheduler 渲染任务；返回自身类型 continuation 表示同一 callback 尚有同优先级工作。 */
type RenderTaskFn = (didTimeout: boolean) => RenderTaskFn | null;

/**
 * Scheduler 并发任务入口：先冲刷 passive effects，再选择车道并执行工作循环。
 * 若原 callback 仍有效且同优先级工作未完成，返回 continuation；否则让根调度器重建任务。
 */
function performWorkOnRootViaSchedulerTask(
  root: FiberRoot,
  didTimeout: boolean,
): RenderTaskFn | null {
  // Scheduler（未来也可能是 postTask）调度的并发任务入口。

  if (enableProfilerTimer && enableProfilerNestedUpdatePhase) {
    resetNestedUpdateFlag();
  }

  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    // 记录当前执行事件，使性能日志可排除调度器自身事件。
    trackSchedulerEvent();
  }

  if (hasPendingCommitEffects()) {
    // 正处于 View Transition 等异步提交中；推迟新工作优于强制提前冲刷，且等待对象可能
    // 并非当前 Root。TODO：这里依赖提交最终调用 ensureRootIsScheduled，并由 microtask
    // 全量扫描 Root；若优化该流程，必须为所有跳过的 Root 重新安排任务。
    root.callbackNode = null;
    root.callbackPriority = NoLane;
    return null;
  }

  // 选择车道前先冲刷 passive effects，因为它们可能调度额外工作。
  const originalCallbackNode = root.callbackNode;
  const didFlushPassiveEffects = flushPendingEffectsDelayed();
  if (didFlushPassiveEffects) {
    // passive effect 可能取消当前任务，检查 Root 的任务节点是否已变化。
    if (root.callbackNode !== originalCallbackNode) {
      // 当前任务已取消：Root 要么已有新任务，要么没有剩余工作，无需再 ensure 调度。
      return null;
    } else {
      // 当前任务仍有效，继续。
    }
  }

  // 依据 Root 当前字段重新选择车道。TODO：调度 callback 时已调用 getNextLanes，理论上可
  // 缓存在 Root；callback 通常由 microtask 安排，同一浏览器 task 可能更早又产生更新，
  // 且 Scheduler 会把多个 callback 合并进一个 macrotask，中间不让出给 microtask。
  // 后续应与 postTask 行为对齐，并在可用时直接使用 postTask。
  const workInProgressRoot = getWorkInProgressRoot();
  const workInProgressRootRenderLanes = getWorkInProgressRootRenderLanes();
  const rootHasPendingCommit =
    root.cancelPendingCommit !== null || root.timeoutHandle !== noTimeout;
  const lanes = getNextLanes(
    root,
    root === workInProgressRoot ? workInProgressRootRenderLanes : NoLanes,
    rootHasPendingCommit,
  );
  if (lanes === NoLanes) {
    // 该 Root 已无工作。
    return null;
  }

  // 进入工作循环。TODO：didTimeout 只是防御仍在调查的 Scheduler 问题；修复后可移除，
  // 因为 reconciler 自己跟踪 expiration。
  const forceSync = !disableSchedulerTimeoutInWorkLoop && didTimeout;
  performWorkOnRoot(root, lanes, forceSync);

  // 工作循环已让出，但当前优先级可能仍有工作。复用 microtask 调度逻辑判断应返回
  // continuation 还是新建 task；此处位于浏览器 task 末尾，虽非真实 microtask，时序等价。
  scheduleTaskForRootDuringMicrotask(root, now());
  if (root.callbackNode != null && root.callbackNode === originalCallbackNode) {
    // Root 上仍是当前执行的任务节点，返回 continuation。
    return performWorkOnRootViaSchedulerTask.bind(null, root);
  }
  return null;
}

/**
 * 不经 Scheduler 的 Root 同步工作入口；先冲刷 pending effects，只要实际冲刷过就返回外层
 * 重算优先级，因为 effect 可能改变根工作。未冲刷时以 forceSync 进入工作循环。
 */
function performSyncWorkOnRoot(root: FiberRoot, lanes: Lanes) {
  const didFlushPassiveEffects = flushPendingEffects();
  if (didFlushPassiveEffects) {
    // passive effects 已冲刷，返回根调度器外层重新计算优先级。
    return null;
  }
  if (enableProfilerTimer && enableProfilerNestedUpdatePhase) {
    syncNestedUpdateFlag();
  }
  const forceSync = true;
  performWorkOnRoot(root, lanes, forceSync);
}

/** actQueue 中任务的哨兵 callbackNode，用于区别真实 Scheduler 任务。 */
const fakeActCallbackNode = {};

/** 在 DEV act 作用域内改投 actQueue；其余情况委托 Scheduler 建立 callback。 */
function scheduleCallback(
  priorityLevel: PriorityLevel,
  callback: RenderTaskFn,
) {
  if (__DEV__ && ReactSharedInternals.actQueue !== null) {
    // `act` 测试作用域内不调度到宿主环境，改加入 act 实现管理的内部队列。
    ReactSharedInternals.actQueue.push(callback);
    return fakeActCallbackNode;
  } else {
    return Scheduler_scheduleCallback(priorityLevel, callback);
  }
}

/** 取消真实 Scheduler callback；actQueue 哨兵由 act 自己管理，无需删除。 */
function cancelCallback(callbackNode: mixed) {
  if (__DEV__ && callbackNode === fakeActCallbackNode) {
    // `act` 哨兵节点不对应真实 Scheduler callback。
  } else if (callbackNode !== null) {
    Scheduler_cancelCallback(callbackNode);
  }
}

/**
 * 尽快安排 Root 链表处理：DEV act 额外加入 actQueue，宿主仍按能力安排 microtask 或 Immediate task。
 * 两条入口依靠独立去重标记协调；若 microtask 发现仍在 render/commit 中，改排 Immediate task，
 * 避免 Safari 等宿主提前执行微任务时递归进入工作循环。
 */
function scheduleImmediateRootScheduleTask() {
  if (__DEV__ && ReactSharedInternals.actQueue !== null) {
    // act 仍兼容不 await 的调用，因此把“microtask”加入伪 callback 队列；未来强制 await
    // 后可依赖真实微任务获得执行机会。
    ReactSharedInternals.actQueue.push(() => {
      processRootScheduleInMicrotask();
      return null;
    });
  }

  // TODO：确认哪些环境仍不支持 microtask，或把该判断完全下沉 HostConfig。
  // $FlowFixMe[constant-condition]
  if (supportsMicrotasks) {
    scheduleMicrotask(() => {
      // Safari 追加 iframe 会强制 microtask 执行。
      // https://github.com/facebook/react/issues/22459
      // React 不支持在 render/commit 中途运行 callback，故需检查执行上下文。
      const executionContext = getExecutionContext();
      if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
        // 若发生在 render/commit 之外（如事件中），callback 仍可能被提前冲刷。

        // 此处刻意改用 macrotask；语义并不完全正确，但能规避 Safari 问题导致的无限循环。
        Scheduler_scheduleCallback(
          ImmediateSchedulerPriority,
          processRootScheduleInImmediateTask,
        );
        return;
      }
      processRootScheduleInMicrotask();
    });
  } else {
    // 宿主不支持 microtask 时改用 Scheduler。
    Scheduler_scheduleCallback(
      ImmediateSchedulerPriority,
      processRootScheduleInImmediateTask,
    );
  }
}

/**
 * 为当前浏览器事件申请稳定的 TransitionLane。
 *
 * 同一事件中的所有 Transition 复用缓存车道；若位于 entangled async action，则优先复用
 * action scope 车道。processRootScheduleInMicrotask 处理完该批根后重置缓存，后续更新再分配新车道。
 */
export function requestTransitionLane(
  // 参数只用于促使调用方确认当前处于 Transition。TODO：调整 useOptimistic 后改为非空。
  transition: Transition | null,
): Lane {
  // 同一事件、同一优先级的更新必须得到稳定车道；缓存事件内首次输入，并在
  // processRootScheduleInMicrotask 末尾重置。
  if (currentEventTransitionLane === NoLane) {
    // 同一事件内所有 Transition 分配同一车道。
    const actionScopeLane = peekEntangledActionLane();
    currentEventTransitionLane =
      actionScopeLane !== NoLane
        ? // 位于 async action scope，复用同一车道。
          actionScopeLane
        : // 不在 action scope，或这是 scope 内首次更新；两种情况都申请新 Transition 车道。
          claimNextTransitionUpdateLane();
  }
  return currentEventTransitionLane;
}

/** 当前事件是否已经申请过 TransitionLane。 */
export function didCurrentEventScheduleTransition(): boolean {
  return currentEventTransitionLane !== NoLane;
}

/**
 * 标记当前事件的同步 loading 状态已处理，从 Root indicatorLanes 移除该事件车道，
 * 并清除同构指示器的待启动需求；此处不调用已启动指示器的清理函数，其释放由根提交/Action 完成路径处理。
 */
export function markIndicatorHandled(root: FiberRoot): void {
  if (enableDefaultTransitionIndicator) {
    // 当前 Transition 事件已同步渲染 loading 状态，无需为该车道再显示独立 indicator。
    root.indicatorLanes &= ~currentEventTransitionLane;
    markIsomorphicIndicatorHandled();
  }
}
