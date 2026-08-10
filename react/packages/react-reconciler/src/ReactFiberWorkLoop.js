/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {REACT_STRICT_MODE_TYPE} from 'shared/ReactSymbols';

import type {
  Wakeable,
  Thenable,
  GestureOptionsRequired,
} from 'shared/ReactTypes';
import type {Fiber, FiberRoot} from './ReactInternalTypes';
import type {Lanes, Lane} from './ReactFiberLane';
import type {ActivityState} from './ReactFiberActivityComponent';
import type {SuspenseState} from './ReactFiberSuspenseComponent';
import type {FunctionComponentUpdateQueue} from './ReactFiberHooks';
import type {Transition} from 'react/src/ReactStartTransition';
import type {
  PendingTransitionCallbacks,
  PendingBoundaries,
  TransitionAbort,
} from './ReactFiberTracingMarkerComponent';
import type {OffscreenInstance} from './ReactFiberOffscreenComponent';
import type {
  Resource,
  ViewTransitionInstance,
  RunningViewTransition,
  GestureTimeline,
  SuspendedState,
} from './ReactFiberConfig';
import type {RootState} from './ReactFiberRoot';
import {
  getViewTransitionName,
  type ViewTransitionState,
} from './ReactFiberViewTransitionComponent';
import type {TransitionTypes} from 'react/src/ReactTransitionType';

import {
  enableCreateEventHandleAPI,
  enableProfilerTimer,
  enableProfilerCommitHooks,
  enableProfilerNestedUpdatePhase,
  enableSchedulingProfiler,
  enableUpdaterTracking,
  enableTransitionTracing,
  disableLegacyContext,
  alwaysThrottleRetries,
  enableInfiniteRenderLoopDetection,
  enableInfiniteRenderLoopDetectionForceThrow,
  disableLegacyMode,
  enableComponentPerformanceTrack,
  enableYieldingBeforePassive,
  enableThrottledScheduling,
  enableViewTransition,
  enableGestureTransition,
  enableDefaultTransitionIndicator,
  enableParallelTransitions,
} from 'shared/ReactFeatureFlags';
import {resetOwnerStackLimit} from 'shared/ReactOwnerStackReset';
import ReactSharedInternals from 'shared/ReactSharedInternals';
import is from 'shared/objectIs';

import reportGlobalError from 'shared/reportGlobalError';

import {
  // 使用别名，因为 act 会覆写调度并把 callback 推入内部队列。
  scheduleCallback as Scheduler_scheduleCallback,
  shouldYield,
  requestPaint,
  now,
  NormalPriority as NormalSchedulerPriority,
  IdlePriority as IdleSchedulerPriority,
} from './Scheduler';
import {
  logBlockingStart,
  logGestureStart,
  logTransitionStart,
  logRenderPhase,
  logInterruptedRenderPhase,
  logSuspendedRenderPhase,
  logRecoveredRenderPhase,
  logErroredRenderPhase,
  logInconsistentRender,
  logSuspendedWithDelayPhase,
  logSuspendedCommitPhase,
  logSuspendedViewTransitionPhase,
  logCommitPhase,
  logPaintYieldPhase,
  logStartViewTransitionYieldPhase,
  logAnimatingPhase,
  logPassiveCommitPhase,
  logYieldTime,
  logActionYieldTime,
  logSuspendedYieldTime,
  setCurrentTrackFromLanes,
  markAllLanesInOrder,
  logApplyGesturePhase,
} from './ReactFiberPerformanceTrack';

import {
  resetAfterCommit,
  scheduleTimeout,
  cancelTimeout,
  noTimeout,
  afterActiveInstanceBlur,
  startSuspendingCommit,
  suspendOnActiveViewTransition,
  waitForCommitToBeReady,
  getSuspendedCommitReason,
  preloadInstance,
  preloadResource,
  supportsHydration,
  setCurrentUpdatePriority,
  getCurrentUpdatePriority,
  resolveUpdatePriority,
  trackSchedulerEvent,
  startViewTransition,
  startGestureTransition,
  stopViewTransition,
  addViewTransitionFinishedListener,
  createViewTransitionInstance,
  flushHydrationEvents,
} from './ReactFiberConfig';

import {createWorkInProgress, resetWorkInProgress} from './ReactFiber';
import {isRootDehydrated} from './ReactFiberShellHydration';
import {
  getIsHydrating,
  popHydrationStateOnInterruptedWork,
} from './ReactFiberHydrationContext';
import {
  NoMode,
  ProfileMode,
  ConcurrentMode,
  StrictLegacyMode,
  StrictEffectsMode,
} from './ReactTypeOfMode';
import {
  HostRoot,
  ClassComponent,
  ActivityComponent,
  SuspenseComponent,
  SuspenseListComponent,
  OffscreenComponent,
  FunctionComponent,
  ForwardRef,
  MemoComponent,
  SimpleMemoComponent,
  HostComponent,
  HostHoistable,
  HostSingleton,
} from './ReactWorkTags';
import {ConcurrentRoot, LegacyRoot} from './ReactRootTags';
import type {Flags} from './ReactFiberFlags';
import {
  NoFlags,
  Incomplete,
  StoreConsistency,
  HostEffectMask,
  ForceClientRender,
  BeforeMutationMask,
  MutationMask,
  LayoutMask,
  PassiveMask,
  PlacementDEV,
  Visibility,
  MountPassiveDev,
  MountLayoutDev,
  DidDefer,
  ShouldSuspendCommit,
  MaySuspendCommit,
  ScheduleRetry,
  PassiveTransitionMask,
} from './ReactFiberFlags';
import {
  NoLanes,
  NoLane,
  SyncLane,
  claimNextRetryLane,
  includesSyncLane,
  isSubsetOfLanes,
  mergeLanes,
  removeLanes,
  pickArbitraryLane,
  includesNonIdleWork,
  includesOnlyRetries,
  includesOnlyTransitions,
  includesBlockingLane,
  includesTransitionLane,
  includesRetryLane,
  includesIdleGroupLanes,
  includesExpiredLane,
  getNextLanes,
  getEntangledLanes,
  getLanesToRetrySynchronouslyOnError,
  upgradePendingLanesToSync,
  markRootSuspended as _markRootSuspended,
  markRootUpdated as _markRootUpdated,
  markRootPinged as _markRootPinged,
  markRootFinished,
  addFiberToLanesMap,
  movePendingFibersToMemoized,
  addTransitionToLanesMap,
  getTransitionsForLanes,
  includesSomeLane,
  OffscreenLane,
  SyncUpdateLanes,
  UpdateLanes,
  claimNextTransitionDeferredLane,
  checkIfRootIsPrerendering,
  includesOnlyViewTransitionEligibleLanes,
  isGestureRender,
  GestureLane,
  SomeTransitionLane,
  SomeRetryLane,
  IdleLane,
} from './ReactFiberLane';
import {
  DiscreteEventPriority,
  DefaultEventPriority,
  lowerEventPriority,
  lanesToEventPriority,
  eventPriorityToLane,
} from './ReactEventPriorities';
import {requestCurrentTransition} from './ReactFiberTransition';
import {
  SelectiveHydrationException,
  beginWork,
  replayFunctionComponent,
} from './ReactFiberBeginWork';
import {completeWork} from './ReactFiberCompleteWork';
import {unwindWork, unwindInterruptedWork} from './ReactFiberUnwindWork';
import {
  throwException,
  createRootErrorUpdate,
  createClassErrorUpdate,
  initializeClassErrorUpdate,
} from './ReactFiberThrow';
import {
  commitBeforeMutationEffects,
  shouldFireAfterActiveInstanceBlur,
  commitAfterMutationEffects,
  commitLayoutEffects,
  commitMutationEffects,
  commitPassiveMountEffects,
  commitPassiveUnmountEffects,
  disappearLayoutEffectsForDEVValidation,
  reconnectPassiveEffects,
  reappearLayoutEffectsForDEVValidation,
  disconnectPassiveEffect,
  invokeLayoutEffectMountInDEV,
  invokePassiveEffectMountInDEV,
  invokeLayoutEffectUnmountInDEV,
  invokePassiveEffectUnmountInDEV,
  accumulateSuspenseyCommit,
} from './ReactFiberCommitWork';
import {resetShouldStartViewTransition} from './ReactFiberCommitViewTransitions';
import {shouldStartViewTransition} from './ReactFiberCommitViewTransitions';
import {
  insertDestinationClones,
  applyDepartureTransitions,
  startGestureAnimations,
} from './ReactFiberApplyGesture';
import {enqueueUpdate} from './ReactFiberClassUpdateQueue';
import {resetContextDependencies} from './ReactFiberNewContext';
import {
  resetHooksAfterThrow,
  resetHooksOnUnwind,
  ContextOnlyDispatcher,
} from './ReactFiberHooks';
import {DefaultAsyncDispatcher} from './ReactFiberAsyncDispatcher';
import {
  createCapturedValueAtFiber,
  type CapturedValue,
} from './ReactCapturedValue';
import {
  enqueueConcurrentRenderForLane,
  finishQueueingConcurrentUpdates,
  getConcurrentlyUpdatedLanes,
} from './ReactFiberConcurrentUpdates';

import {
  blockingClampTime,
  blockingUpdateTime,
  blockingUpdateTask,
  blockingUpdateType,
  blockingUpdateMethodName,
  blockingUpdateComponentName,
  blockingEventTime,
  blockingEventType,
  blockingEventRepeatTime,
  blockingSuspendedTime,
  gestureClampTime,
  gestureUpdateTime,
  gestureUpdateTask,
  gestureUpdateType,
  gestureUpdateMethodName,
  gestureUpdateComponentName,
  gestureEventTime,
  gestureEventType,
  gestureEventRepeatTime,
  gestureSuspendedTime,
  transitionClampTime,
  transitionStartTime,
  transitionUpdateTime,
  transitionUpdateTask,
  transitionUpdateType,
  transitionUpdateMethodName,
  transitionUpdateComponentName,
  transitionEventTime,
  transitionEventType,
  transitionEventRepeatTime,
  transitionSuspendedTime,
  clearBlockingTimers,
  clearGestureTimers,
  clearGestureUpdates,
  clearTransitionTimers,
  clampBlockingTimers,
  clampGestureTimers,
  clampTransitionTimers,
  clampRetryTimers,
  clampIdleTimers,
  markNestedUpdateScheduled,
  renderStartTime,
  commitStartTime,
  commitEndTime,
  commitErrors,
  recordRenderTime,
  recordCommitTime,
  recordCommitEndTime,
  startProfilerTimer,
  stopProfilerTimerIfRunningAndRecordDuration,
  stopProfilerTimerIfRunningAndRecordIncompleteDuration,
  trackSuspendedTime,
  startYieldTimer,
  yieldStartTime,
  yieldReason,
  startPingTimerByLanes,
  recordEffectError,
  resetCommitErrors,
  PINGED_UPDATE,
  SPAWNED_UPDATE,
  startAnimating,
  stopAnimating,
  animatingLanes,
  retryClampTime,
  idleClampTime,
  animatingTask,
} from './ReactProfilerTimer';

// 开发期诊断依赖。
import getComponentNameFromFiber from 'react-reconciler/src/getComponentNameFromFiber';
import ReactStrictModeWarnings from './ReactStrictModeWarnings';
import {
  isRendering as ReactCurrentDebugFiberIsRenderingInDEV,
  resetCurrentFiber,
  runWithFiberInDEV,
} from './ReactCurrentFiber';
import {
  isDevToolsPresent,
  markCommitStarted,
  markCommitStopped,
  markComponentRenderStopped,
  markComponentSuspended,
  markComponentErrored,
  markLayoutEffectsStarted,
  markLayoutEffectsStopped,
  markPassiveEffectsStarted,
  markPassiveEffectsStopped,
  markRenderStarted,
  markRenderYielded,
  markRenderStopped,
  onCommitRoot as onCommitRootDevTools,
  onPostCommitRoot as onPostCommitRootDevTools,
  setIsStrictModeForDevtools,
} from './ReactFiberDevToolsHook';
import {onCommitRoot as onCommitRootTestSelector} from './ReactTestSelectors';
import {releaseCache} from './ReactFiberCacheComponent';
import {
  isLegacyActEnvironment,
  isConcurrentActEnvironment,
} from './ReactFiberAct';
import {processTransitionCallbacks} from './ReactFiberTracingMarkerComponent';
import {
  SuspenseException,
  SuspenseActionException,
  SuspenseyCommitException,
  getSuspendedThenable,
  isThenableResolved,
  hasPotentialUseWarnings,
  clearUseWarnings,
} from './ReactFiberThenable';
import {schedulePostPaintCallback} from './ReactPostPaintCallback';
import {
  getSuspenseHandler,
  getShellBoundary,
} from './ReactFiberSuspenseContext';
import {resetChildReconcilerOnUnwind} from './ReactChildFiber';
import {
  ensureRootIsScheduled,
  flushSyncWorkOnAllRoots,
  flushSyncWorkOnLegacyRootsOnly,
  requestTransitionLane,
} from './ReactFiberRootScheduler';
import {getMaskedContext, getUnmaskedContext} from './ReactFiberLegacyContext';
import {logUncaughtError} from './ReactFiberErrorLogger';
import {
  scheduleGestureCommit,
  stopCommittedGesture,
} from './ReactFiberGestureScheduler';
import {claimQueuedTransitionTypes} from './ReactFiberTransitionTypes';

/** 优先使用 WeakMap 保存 root→wakeable 监听；不支持时退回 Map。 */
const PossiblyWeakMap = typeof WeakMap === 'function' ? WeakMap : Map;

/** 当前调用栈处于 batched、render、commit 的位掩码。 */
type ExecutionContext = number;

/** 当前不在 React batched/render/commit 上下文。 */
export const NoContext = /*             */ 0b000;
/** 当前处于批处理更新上下文。 */
const BatchedContext = /*               */ 0b001;
/** 当前正在执行 render 工作循环。 */
export const RenderContext = /*         */ 0b010;
/** 当前正在执行 commit 阶段。 */
export const CommitContext = /*         */ 0b100;

/** 一次 root render 的退出状态编码。 */
type RootExitStatus = 0 | 1 | 2 | 3 | 4 | 5 | 6;
/** root render 尚在进行。 */
const RootInProgress = 0;
/** root 遇到无法恢复的致命错误。 */
const RootFatalErrored = 1;
/** root 遇错但可尝试同步恢复。 */
const RootErrored = 2;
/** root 挂起，可按策略提交 fallback。 */
const RootSuspended = 3;
/** root 挂起且应延迟 fallback，等待内容很快就绪。 */
const RootSuspendedWithDelay = 4;
/** root 的 shell 边界即已挂起，尚无可提交外壳。 */
const RootSuspendedAtTheShell = 6;
/** root render 已完整结束。 */
const RootCompleted = 5;

// 描述当前处于 React 执行栈的哪一阶段。
let executionContext: ExecutionContext = NoContext;
// 当前正在处理的 root。
let workInProgressRoot: FiberRoot | null = null;
// 当前正在处理的 Fiber。
let workInProgress: Fiber | null = null;
// 当前 root 正在 render 的 lanes。
let workInProgressRootRenderLanes: Lanes = NoLanes;

/** 当前 unit 暂停执行的具体原因，决定恢复时重试、重放还是 unwind。 */
export opaque type SuspendedReason = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
/** 当前 unit 未挂起。 */
const NotSuspended: SuspendedReason = 0;
/** 当前 unit 因普通错误停止。 */
const SuspendedOnError: SuspendedReason = 1;
/** 当前 unit 等待 thenable 数据。 */
const SuspendedOnData: SuspendedReason = 2;
/** 当前 unit 通过内部立即挂起控制异常停止。 */
const SuspendedOnImmediate: SuspendedReason = 3;
/** 当前 unit 等待宿主实例/资源。 */
const SuspendedOnInstance: SuspendedReason = 4;
/** 宿主实例等待已就绪，可直接继续当前 unit。 */
const SuspendedOnInstanceAndReadyToContinue: SuspendedReason = 5;
/** 当前 unit 使用旧式直接 throw Promise 协议挂起。 */
const SuspendedOnDeprecatedThrowPromise: SuspendedReason = 6;
/** thenable 已 ping，可在 unwind 前继续当前 unit。 */
const SuspendedAndReadyToContinue: SuspendedReason = 7;
/** selective hydration 请求中断并提高边界优先级。 */
const SuspendedOnHydration: SuspendedReason = 8;
/** 当前 unit 等待异步 Transition Action。 */
const SuspendedOnAction: SuspendedReason = 9;

// WIP Fiber 刚挂起（或抛错）而栈尚未 unwind 时保存原因；此后可能先向主线程 yield。若
// 恢复前 Fiber 已被 ping，可直接重试而无需 unwind。
let workInProgressSuspendedReason: SuspendedReason = NotSuspended;
let workInProgressThrownValue: mixed = null;

// 记录挂起后的 unwind 是否跳过 sibling，用于决定是否另起 render 预热它们。
let workInProgressRootDidSkipSuspendedSiblings: boolean = false;
// 标记本轮是否属于 prewarm/prerender，决定某个节点挂起后是否继续渲染 sibling。
let workInProgressRootIsPrerendering: boolean = false;

// 记录本轮是否新装 ping listener；它不等于“发生过挂起”，因为同 root+lane 的已见 Promise
// 不会重复注册。
let workInProgressRootDidAttachPingListener: boolean = false;

// workInProgressRootRenderLanes 的上下文化超集。进入隐藏子树时，HiddenContext 会加入若
// 该树未延后本应提交的 lanes。work loop 多数逻辑使用原 root lanes；begin/complete 阶段
// 多数逻辑使用 entangledRenderLanes。
export let entangledRenderLanes: Lanes = NoLanes;

// root 当前为完成、出错、挂起等退出状态。
let workInProgressRootExitStatus: RootExitStatus = RootInProgress;
// 本轮已访问组件留下的未处理更新，不含 bailout 子树中的工作。
let workInProgressRootSkippedLanes: Lanes = NoLanes;
// 本轮 render 期间由 interleaved event 更新的 lanes。
let workInProgressRootInterleavedUpdatedLanes: Lanes = NoLanes;
// render phase 内直接更新的 lanes（不含 interleaved event）。
let workInProgressRootRenderPhaseUpdatedLanes: Lanes = NoLanes;
// 本轮 render 期间由 interleaved event ping 的 lanes。
let workInProgressRootPingedLanes: Lanes = NoLanes;
// 若本轮派生 deferred work，此处保存其共享 Lane。
let workInProgressDeferredLane: Lane = NoLane;
// 本轮派生且尚未 ping 的 retry lanes，表示它们仍处于挂起状态。
let workInProgressSuspendedRetryLanes: Lanes = NoLanes;
// render phase 抛出的并发错误。
let workInProgressRootConcurrentErrors: Array<CapturedValue<mixed>> | null =
  null;
// 未暴露给 UI、已恢复的错误；树成功 commit 后统一记录。
let workInProgressRootRecoverableErrors: Array<CapturedValue<mixed>> | null =
  null;

// 记录 render phase 是否发生递归更新。
let workInProgressRootDidIncludeRecursiveRenderUpdate: boolean = false;
// 记录 commit phase 是否发生更新；与 render 分开，因为 commit 可能和另一次 render 并发。
let didIncludeCommitPhaseUpdate: boolean = false;
// 最近一次提交 fallback 或用 resolved UI 填充 fallback 的时间，用于节流流式内容、减少抖动。
// TODO：为该变量寻找更准确的名称。
let globalMostRecentFallbackTime: number = 0;
// 最近一次新 Transition 启动时间，让 suspensey 图片超时等启发式计入已等待时长。
let globalMostRecentTransitionTime: number = 0;

/** 连续 fallback/content commit 的最小间隔，用于降低流式 UI 抖动。 */
const FALLBACK_THROTTLE_MS: number = 300;

// 停止继续 render 更多内容、转而采用 CPU Suspense 启发式的绝对时间。
let workInProgressRootRenderTargetTime: number = Infinity;
// render 达到此时长后开始采用 CPU Suspense 启发式并停止扩展内容。
const RENDER_TIMEOUT_MS = 500;

let workInProgressTransitions: Array<Transition> | null = null;
/** 返回当前 root render 关联的 Transition 集合。 */
export function getWorkInProgressTransitions(): null | Array<Transition> {
  return workInProgressTransitions;
}

// 最终触发本次 render 的首个 setState 调用任务。
let workInProgressUpdateTask: null | ConsoleTask = null;

let currentPendingTransitionCallbacks: PendingTransitionCallbacks | null = null;
let currentEndTime: number | null = null;

/** 把 Transition start 事件加入本次 commit 的 tracing 回调批次。 */
export function addTransitionStartCallbackToPendingTransition(
  transition: Transition,
) {
  if (enableTransitionTracing) {
    if (currentPendingTransitionCallbacks === null) {
      currentPendingTransitionCallbacks = {
        transitionStart: [],
        transitionProgress: null,
        transitionComplete: null,
        markerProgress: null,
        markerIncomplete: null,
        markerComplete: null,
      };
    }

    if (currentPendingTransitionCallbacks.transitionStart === null) {
      currentPendingTransitionCallbacks.transitionStart =
        [] as Array<Transition>;
    }

    currentPendingTransitionCallbacks.transitionStart.push(transition);
  }
}

/** 记录 marker 当前仍 pending 的边界，供 commit 后触发 progress。 */
export function addMarkerProgressCallbackToPendingTransition(
  markerName: string,
  transitions: Set<Transition>,
  pendingBoundaries: PendingBoundaries,
) {
  if (enableTransitionTracing) {
    if (currentPendingTransitionCallbacks === null) {
      currentPendingTransitionCallbacks = {
        transitionStart: null,
        transitionProgress: null,
        transitionComplete: null,
        markerProgress: new Map(),
        markerIncomplete: null,
        markerComplete: null,
      } as PendingTransitionCallbacks;
    }

    if (currentPendingTransitionCallbacks.markerProgress === null) {
      currentPendingTransitionCallbacks.markerProgress = new Map();
    }

    currentPendingTransitionCallbacks.markerProgress.set(markerName, {
      pendingBoundaries,
      transitions,
    });
  }
}

/** 记录 marker 因 abort 未完成的 transitions 与原因。 */
export function addMarkerIncompleteCallbackToPendingTransition(
  markerName: string,
  transitions: Set<Transition>,
  aborts: Array<TransitionAbort>,
) {
  if (enableTransitionTracing) {
    if (currentPendingTransitionCallbacks === null) {
      currentPendingTransitionCallbacks = {
        transitionStart: null,
        transitionProgress: null,
        transitionComplete: null,
        markerProgress: null,
        markerIncomplete: new Map(),
        markerComplete: null,
      };
    }

    if (currentPendingTransitionCallbacks.markerIncomplete === null) {
      currentPendingTransitionCallbacks.markerIncomplete = new Map();
    }

    currentPendingTransitionCallbacks.markerIncomplete.set(markerName, {
      transitions,
      aborts,
    });
  }
}

/** 记录 marker 已完成的 transitions，供 commit 后回调。 */
export function addMarkerCompleteCallbackToPendingTransition(
  markerName: string,
  transitions: Set<Transition>,
) {
  if (enableTransitionTracing) {
    if (currentPendingTransitionCallbacks === null) {
      currentPendingTransitionCallbacks = {
        transitionStart: null,
        transitionProgress: null,
        transitionComplete: null,
        markerProgress: null,
        markerIncomplete: null,
        markerComplete: new Map(),
      };
    }

    if (currentPendingTransitionCallbacks.markerComplete === null) {
      currentPendingTransitionCallbacks.markerComplete = new Map();
    }

    currentPendingTransitionCallbacks.markerComplete.set(
      markerName,
      transitions,
    );
  }
}

/** 记录 Transition 当前 pending boundaries，供 commit 后 progress 回调。 */
export function addTransitionProgressCallbackToPendingTransition(
  transition: Transition,
  boundaries: PendingBoundaries,
) {
  if (enableTransitionTracing) {
    if (currentPendingTransitionCallbacks === null) {
      currentPendingTransitionCallbacks = {
        transitionStart: null,
        transitionProgress: new Map(),
        transitionComplete: null,
        markerProgress: null,
        markerIncomplete: null,
        markerComplete: null,
      };
    }

    if (currentPendingTransitionCallbacks.transitionProgress === null) {
      currentPendingTransitionCallbacks.transitionProgress = new Map();
    }

    currentPendingTransitionCallbacks.transitionProgress.set(
      transition,
      boundaries,
    );
  }
}

/** 把已完成 Transition 加入本次 commit 的 complete 回调批次。 */
export function addTransitionCompleteCallbackToPendingTransition(
  transition: Transition,
) {
  if (enableTransitionTracing) {
    if (currentPendingTransitionCallbacks === null) {
      currentPendingTransitionCallbacks = {
        transitionStart: null,
        transitionProgress: null,
        transitionComplete: [],
        markerProgress: null,
        markerIncomplete: null,
        markerComplete: null,
      };
    }

    if (currentPendingTransitionCallbacks.transitionComplete === null) {
      currentPendingTransitionCallbacks.transitionComplete =
        [] as Array<Transition>;
    }

    currentPendingTransitionCallbacks.transitionComplete.push(transition);
  }
}

/** 重置 CPU Suspense 启发式的绝对 render 截止时间。 */
function resetRenderTimer() {
  workInProgressRootRenderTargetTime = now() + RENDER_TIMEOUT_MS;
}

/** 读取当前 render 的 CPU Suspense 截止时间。 */
export function getRenderTargetTime(): number {
  return workInProgressRootRenderTargetTime;
}

let legacyErrorBoundariesThatAlreadyFailed: Set<mixed> | null = null;

/** commit 因宿主资源等待而挂起时的可展示原因。 */
type SuspendedCommitReason = null | string;

/** ViewTransition/被动阶段让 commit 延后的原因编码。 */
type DelayedCommitReason = 0 | 1 | 2 | 3;
/** commit 无额外延迟。 */
const IMMEDIATE_COMMIT = 0;
/** ViewTransition 被中断后继续 commit。 */
const ABORTED_VIEW_TRANSITION_COMMIT = 1;
/** 上一轮 passive effects 使本次 commit 延迟。 */
const DELAYED_PASSIVE_COMMIT = 2;
/** 动画启动后继续剩余 commit 阶段。 */
const ANIMATION_STARTED_COMMIT = 3;

/** 当前没有待 flush 的 commit effect。 */
const NO_PENDING_EFFECTS = 0;
/** 等待执行 mutation 阶段。 */
const PENDING_MUTATION_PHASE = 1;
/** 等待执行 layout 阶段。 */
const PENDING_LAYOUT_PHASE = 2;
/** 等待执行 after-mutation 阶段。 */
const PENDING_AFTER_MUTATION_PHASE = 3;
/** 等待处理 commit 中派生的同步工作。 */
const PENDING_SPAWNED_WORK = 4;
/** 等待执行 passive effect 阶段。 */
const PENDING_PASSIVE_PHASE = 5;
/** 等待应用 gesture clone mutation。 */
const PENDING_GESTURE_MUTATION_PHASE = 6;
/** 等待启动 gesture 动画。 */
const PENDING_GESTURE_ANIMATION_PHASE = 7;
let pendingEffectsStatus: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 = 0;
let pendingEffectsRoot: FiberRoot = null as any;
let pendingFinishedWork: Fiber = null as any;
let pendingEffectsLanes: Lanes = NoLanes;
let pendingEffectsRemainingLanes: Lanes = NoLanes;
let pendingEffectsRenderEndTime: number = -0; // 仅用于性能分析。
let pendingPassiveTransitions: Array<Transition> | null = null;
let pendingRecoverableErrors: null | Array<CapturedValue<mixed>> = null;
let pendingViewTransition: null | RunningViewTransition = null;
let pendingViewTransitionEvents: Array<
  (types: Array<string>) => void | (() => void),
> | null = null;
let pendingTransitionTypes: null | TransitionTypes = null;
let pendingDidIncludeRenderPhaseUpdate: boolean = false;
let pendingSuspendedCommitReason: SuspendedCommitReason = null; // 仅用于性能分析。
let pendingDelayedCommitReason: DelayedCommitReason = IMMEDIATE_COMMIT; // 仅用于性能分析。
let pendingSuspendedViewTransitionReason: null | string = null; // 仅用于性能分析。

// 用于阻止嵌套更新形成无限循环。
const NESTED_UPDATE_LIMIT = 50;
let nestedUpdateCount: number = 0;
let rootWithNestedUpdates: FiberRoot | null = null;
let isFlushingPassiveEffects = false;
let didScheduleUpdateDuringPassiveEffects = false;

/** 本次 commit 未产生嵌套更新。 */
const NO_NESTED_UPDATE = 0;
/** 同步 Lane 在 commit 后仍有嵌套更新。 */
const NESTED_UPDATE_SYNC_LANE = 1;
/** render/commit 阶段派生了新更新。 */
const NESTED_UPDATE_PHASE_SPAWN = 2;
let nestedUpdateKind: 0 | 1 | 2 = NO_NESTED_UPDATE;

/** passive effect 连续嵌套更新的开发期上限。 */
const NESTED_PASSIVE_UPDATE_LIMIT = 50;
let nestedPassiveUpdateCount: number = 0;
let rootWithPassiveNestedUpdates: FiberRoot | null = null;

let isRunningInsertionEffect = false;

/** 返回当前正在 render 的根。 */
export function getWorkInProgressRoot(): FiberRoot | null {
  return workInProgressRoot;
}

/** 返回当前有待 flush commit effects 的根。 */
export function getCommittingRoot(): FiberRoot | null {
  return pendingEffectsRoot;
}

/** 返回当前 root render 的原始 Lane 集合。 */
export function getWorkInProgressRootRenderLanes(): Lanes {
  return workInProgressRootRenderLanes;
}

/** 判断 mutation/layout/gesture 等同步 commit 阶段是否仍待执行（不含 passive-only）。 */
export function hasPendingCommitEffects(): boolean {
  return (
    pendingEffectsStatus !== NO_PENDING_EFFECTS &&
    pendingEffectsStatus !== PENDING_PASSIVE_PHASE
  );
}

/** 若当前只待 passive 阶段，返回其根。 */
export function getRootWithPendingPassiveEffects(): FiberRoot | null {
  return pendingEffectsStatus === PENDING_PASSIVE_PHASE
    ? pendingEffectsRoot
    : null;
}

/** 返回待执行 passive effects 对应的提交 lanes。 */
export function getPendingPassiveEffectsLanes(): Lanes {
  return pendingEffectsLanes;
}

/** 返回本次待提交 ViewTransition 的类型集合。 */
export function getPendingTransitionTypes(): null | TransitionTypes {
  return pendingTransitionTypes;
}

/** 判断 work loop 当前是否等待数据 thenable 或异步 Action。 */
export function isWorkLoopSuspendedOnData(): boolean {
  return (
    workInProgressSuspendedReason === SuspendedOnData ||
    workInProgressSuspendedReason === SuspendedOnAction
  );
}

/** 读取调度器单调时钟。 */
export function getCurrentTime(): number {
  return now();
}

/** 按 Fiber mode、render-phase、Transition 与事件优先级为新更新选择 Lane。 */
export function requestUpdateLane(fiber: Fiber): Lane {
  // 先处理 Legacy/render-phase 等特殊情况。
  const mode = fiber.mode;
  if (!disableLegacyMode && (mode & ConcurrentMode) === NoMode) {
    return SyncLane as Lane;
  } else if (
    (executionContext & RenderContext) !== NoContext &&
    workInProgressRootRenderLanes !== NoLanes
  ) {
    // render-phase update 不受正式支持。旧行为让它沿用当前 render lanes，使后续组件的
    // setState 能在同一遍 flush；理想上应移除此特例，按 interleaved event 处理。当前仅作
    // 兼容 fallback，待 setState 警告全面启用后删除。
    return pickArbitraryLane(workInProgressRootRenderLanes);
  }

  const transition = requestCurrentTransition();
  if (transition !== null) {
    if (enableGestureTransition) {
      if (transition.gesture) {
        throw new Error(
          'Cannot setState on regular state inside a startGestureTransition. ' +
            'Gestures can only update the useOptimistic() hook. There should be no ' +
            'side-effects associated with starting a Gesture until its Action is ' +
            'invoked. Move side-effects to the Action instead.',
        );
      }
    }
    if (__DEV__) {
      if (!transition._updatedFibers) {
        transition._updatedFibers = new Set();
      }
      transition._updatedFibers.add(fiber);
      if (
        hasPotentialUseWarnings() &&
        resolveUpdatePriority() === DiscreteEventPriority
      ) {
        // 离散事件内更新可能代表新用户交互，而非自动完成的加载序列；除非再次发生，不警告。
        clearUseWarnings();
      }
    }

    return requestTransitionLane(transition);
  }

  const priority = resolveUpdatePriority();
  if (__DEV__ && priority === DiscreteEventPriority) {
    clearUseWarnings();
  }
  return eventPriorityToLane(priority);
}

/** 为 Suspense 从 fallback 重试 primary 选择专用 RetryLane。 */
function requestRetryLane(fiber: Fiber) {
  // requestUpdateLane 的 Suspense retry 分支，专门尝试把边界从 placeholder 切回 primary。

  // Legacy 根重试必须同步。
  const mode = fiber.mode;
  if (!disableLegacyMode && (mode & ConcurrentMode) === NoMode) {
    return SyncLane as Lane;
  }

  return claimNextRetryLane();
}

/** 为本轮 useDeferredValue/延后工作分配共享 Offscreen 或 Transition deferred Lane。 */
export function requestDeferredLane(): Lane {
  if (workInProgressDeferredLane === NoLane) {
    // 同一 render 内多个 useDeferredValue 派生任务应批量处理，因此共享同一 Lane。

    // 依据当前 render 优先级选择 deferred task 优先级。

    // OffscreenLane 同时用于 prerender 与增量 hydration，通常最低优先级；但 hydration 中的
    // useDeferredValue 需要把 UI 升级为最终值，因此按 Transition 处理。
    const isPrerendering =
      includesSomeLane(workInProgressRootRenderLanes, OffscreenLane) &&
      !getIsHydrating();
    if (isPrerendering) {
      // OffscreenLane 只有一个，直接用同一 Lane 重调度 deferred work。
      workInProgressDeferredLane = OffscreenLane;
    } else {
      // 其他 deferred work 均派生为 Transition Lane。
      workInProgressDeferredLane = claimNextTransitionDeferredLane();
    }
  }

  // 标记父 Suspense 边界，让它在完成时派生 deferred Lane。
  const suspenseHandler = getSuspenseHandler();
  if (suspenseHandler !== null) {
    // TODO：可改用 Suspense boundary.baseLanes 局部 entangle，避免总在 root 绑定；只有无
    // Suspense 边界时才需特殊处理。
    suspenseHandler.flags |= DidDefer;
  }

  return workInProgressDeferredLane;
}

/** 为本次 commit 收集普通 ViewTransition 回调，并惰性创建公开边界实例。 */
export function scheduleViewTransitionEvent(
  fiber: Fiber,
  callback: ?(
    instance: ViewTransitionInstance,
    types: Array<string>,
  ) => void | (() => void),
): void {
  if (enableViewTransition) {
    if (callback != null) {
      const state: ViewTransitionState = fiber.stateNode;
      let instance = state.ref;
      if (instance === null) {
        instance = state.ref = createViewTransitionInstance(
          getViewTransitionName(fiber.memoizedProps, state),
        );
      }
      if (pendingViewTransitionEvents === null) {
        pendingViewTransitionEvents = [];
      }
      pendingViewTransitionEvents.push(callback.bind(null, instance));
    }
  }
}

/** 为当前 gesture 收集带 timeline/range 的 ViewTransition 回调。 */
export function scheduleGestureTransitionEvent(
  fiber: Fiber,
  callback: ?(
    timeline: GestureTimeline,
    options: GestureOptionsRequired,
    instance: ViewTransitionInstance,
    types: Array<string>,
  ) => void | (() => void),
): void {
  if (enableGestureTransition) {
    if (callback != null) {
      const applyingGesture = pendingEffectsRoot.pendingGestures;
      if (applyingGesture !== null) {
        const state: ViewTransitionState = fiber.stateNode;
        let instance = state.ref;
        if (instance === null) {
          instance = state.ref = createViewTransitionInstance(
            getViewTransitionName(fiber.memoizedProps, state),
          );
        }
        const timeline = applyingGesture.provider;
        const options = {
          rangeStart: applyingGesture.rangeStart,
          rangeEnd: applyingGesture.rangeEnd,
        };
        if (pendingViewTransitionEvents === null) {
          pendingViewTransitionEvents = [];
        }
        pendingViewTransitionEvents.push(
          callback.bind(null, timeline, options, instance),
        );
      }
    }
  }
}

/** 读取本轮 render 已分配的 deferred Lane，不主动创建。 */
export function peekDeferredLane(): Lane {
  return workInProgressDeferredLane;
}

/**
 * 把 Fiber 更新标到 root/lane：处理中断的 suspended render/commit、render-phase 与 interleaved
 * 更新、Transition tracing、act 警告，并确保根进入调度队列。
 */
export function scheduleUpdateOnFiber(
  root: FiberRoot,
  fiber: Fiber,
  lane: Lane,
) {
  if (__DEV__) {
    if (isRunningInsertionEffect) {
      console.error('useInsertionEffect must not schedule updates.');
    }
  }

  if (__DEV__) {
    if (isFlushingPassiveEffects) {
      didScheduleUpdateDuringPassiveEffects = true;
    }
  }

  // 若 work loop 正等待数据或 pending commit，先判断新更新能否解除阻塞。
  if (
    // render phase 正等待数据/Action。
    (root === workInProgressRoot &&
      (workInProgressSuspendedReason === SuspendedOnData ||
        workInProgressSuspendedReason === SuspendedOnAction)) ||
    // commit phase 正等待宿主资源。
    root.cancelPendingCommit !== null
  ) {
    // 新更新可能解除当前阻塞；中断本次尝试并从 root 顶部重启。
    prepareFreshStack(root, NoLanes);
    const didAttemptEntireTree = false;
    markRootSuspended(
      root,
      workInProgressRootRenderLanes,
      workInProgressDeferredLane,
      didAttemptEntireTree,
    );
  }

  // 标记 root 存在 pending update。
  markRootUpdated(root, lane);

  if (
    (executionContext & RenderContext) !== NoContext &&
    root === workInProgressRoot
  ) {
    // render phase 派发更新：用户代码通常是错误（本地 Hook 更新走别处），但 selective
    // hydration 等内部功能会将其作为实现细节使用。
    warnAboutRenderPhaseUpdatesInDEV(fiber);

    // 累积 render phase 更新 lanes。
    workInProgressRootRenderPhaseUpdatedLanes = mergeLanes(
      workInProgressRootRenderPhaseUpdatedLanes,
      lane,
    );
  } else {
    // 普通更新来自 render 外，例如输入事件。
    if (enableUpdaterTracking) {
      if (isDevToolsPresent) {
        addFiberToLanesMap(root, fiber, lane);
      }
    }

    warnIfUpdatesNotWrappedWithActDEV(fiber);

    if (enableTransitionTracing) {
      const transition = ReactSharedInternals.T;
      if (transition !== null && transition.name != null) {
        if (transition.startTime === -1) {
          transition.startTime = now();
        }

        addTransitionToLanesMap(root, transition, lane);
      }
    }

    if (root === workInProgressRoot) {
      // 正在 render 的树收到更新，记录为 root 的 interleaved work。
      if ((executionContext & RenderContext) === NoContext) {
        workInProgressRootInterleavedUpdatedLanes = mergeLanes(
          workInProgressRootInterleavedUpdatedLanes,
          lane,
        );
      }
      if (workInProgressRootExitStatus === RootSuspendedWithDelay) {
        // root 已 delayed suspend，本轮必不完成；在登记新更新前立即标记挂起，使当前 render
        // 中断并切换到新更新。
        // TODO：确保不会覆盖 render 已开始后到达的 ping。
        const didAttemptEntireTree = false;
        markRootSuspended(
          root,
          workInProgressRootRenderLanes,
          workInProgressDeferredLane,
          didAttemptEntireTree,
        );
      }
    }

    ensureRootIsScheduled(root);
    if (
      lane === SyncLane &&
      executionContext === NoContext &&
      !disableLegacyMode &&
      (fiber.mode & ConcurrentMode) === NoMode
    ) {
      if (__DEV__ && ReactSharedInternals.isBatchingLegacy) {
        // 即使 Legacy 模式，也把 act 视为位于 batchedUpdates 内。
      } else {
        // 若当前不在工作/batch 中，立即 flush 同步工作。逻辑刻意放在 scheduleUpdateOnFiber，
        // 保留“只安排 callback 而不立即 flush”的能力；仅用户触发更新走此 Legacy 兼容路径。
        resetRenderTimer();
        flushSyncWorkOnLegacyRootsOnly();
      }
    }
  }
}

/** 给 hydration 根的 current Fiber 直接标记初始 Lane，并安排根调度。 */
export function scheduleInitialHydrationOnRoot(root: FiberRoot, lane: Lane) {
  // scheduleUpdateOnFiber 的初始 hydration 专用分支，可跳过大部分通用逻辑。独立入口用于
  // 区分首批 children 与后续更新：createRoot 顶层 render 都建模为 update，而 hydrateRoot
  // 首次 render 必须匹配服务端 HTML。
  const current = root.current;
  current.lanes = lane;
  markRootUpdated(root, lane);
  ensureRootIsScheduled(root);
}

/** Legacy Class 兼容：判断更新是否发生在任意 render 上下文，需走不安全队列路径。 */
export function isUnsafeClassRenderPhaseUpdate(fiber: Fiber): boolean {
  // 判断 Class render-phase update；服务于 UNSAFE_componentWillReceiveProps 的弃用兼容语义。
  return (executionContext & RenderContext) !== NoContext;
}

/**
 * 根调度入口：按 lanes/时间切片选择同步或并发 render，处理错误恢复、外部 store 一致性，
 * 最后完成、延迟或提交 root。
 */
export function performWorkOnRoot(
  root: FiberRoot,
  lanes: Lanes,
  forceSync: boolean,
): void {
  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    throw new Error('Should not already be working.');
  }

  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    if (workInProgressRootRenderLanes !== NoLanes && workInProgress !== null) {
      const yieldedFiber = workInProgress;
      // 从向事件循环 yield 中恢复，记录让出期间耗时。
      const yieldEndTime = now();
      switch (yieldReason) {
        case SuspendedOnImmediate:
        case SuspendedOnData:
          logSuspendedYieldTime(yieldStartTime, yieldEndTime, yieldedFiber);
          break;
        case SuspendedOnAction:
          logActionYieldTime(yieldStartTime, yieldEndTime, yieldedFiber);
          break;
        default:
          logYieldTime(yieldStartTime, yieldEndTime);
      }
    }
  }

  // 工作已过期（防饥饿）或默认同步更新模式时禁用时间切片。
  const shouldTimeSlice =
    (!forceSync &&
      !includesBlockingLane(lanes) &&
      !includesExpiredLane(root, lanes)) ||
    // prerender 即使 lanes 同步也用并发 work loop，避免阻塞主线程。
    // TODO：同步 Lane 挂起时都考虑如此处理，包括普通 ping。
    checkIfRootIsPrerendering(root, lanes);

  let exitStatus: RootExitStatus = shouldTimeSlice
    ? renderRootConcurrent(root, lanes)
    : renderRootSync(root, lanes, true);

  let renderWasConcurrent = shouldTimeSlice;

  do {
    if (exitStatus === RootInProgress) {
      // render phase 尚未完成。
      if (workInProgressRootIsPrerendering && !shouldTimeSlice) {
        // 同步更新挂起使系统进入 prerender，但当前未启用时间切片；退出 work loop，下次以
        // 并发循环恢复，保证 prerender 不阻塞。此处提前标记 root 挂起，确保恢复时仍是
        // prerender 模式。
        // TODO：考虑总是立即 markRootSuspended，但必须晚于安装 ping listener。
        const didAttemptEntireTree = false;
        markRootSuspended(root, lanes, NoLane, didAttemptEntireTree);
      }
      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        // 即将 yield，记录事件循环让出时长，并保存当时挂起原因；恢复前 ping 可能改变它。
        startYieldTimer(workInProgressSuspendedReason);
      }
      break;
    } else {
      let renderEndTime = 0;
      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        renderEndTime = now();
      }

      // render 已完成。

      // 若本轮可能向并发事件 yield，提交前确认新读取的外部 store 仍一致。
      // TODO：快速完成或过期的并发 render 也可能从未 yield，可在这种情况下跳过检查。
      const finishedWork: Fiber = root.current.alternate as any;
      if (
        renderWasConcurrent &&
        !isRenderConsistentWithExternalStores(finishedWork)
      ) {
        if (enableProfilerTimer && enableComponentPerformanceTrack) {
          setCurrentTrackFromLanes(lanes);
          logInconsistentRender(
            renderStartTime,
            renderEndTime,
            workInProgressUpdateTask,
          );
          finalizeRender(lanes, renderEndTime);
        }
        // interleaved event 改变了 store；同步重渲染以阻止进一步并发 mutation。
        exitStatus = renderRootSync(root, lanes, false);
        // 同步重试未向并发事件 yield，可认为树现已一致。
        renderWasConcurrent = false;
        // 同步重试后重新检查退出状态。
        continue;
      }

      // 检查 render 是否抛错。
      if (
        (disableLegacyMode || root.tag !== LegacyRoot) &&
        exitStatus === RootErrored
      ) {
        const lanesThatJustErrored = lanes;
        const errorRetryLanes = getLanesToRetrySynchronouslyOnError(
          root,
          lanesThatJustErrored,
        );
        if (errorRetryLanes !== NoLanes) {
          if (enableProfilerTimer && enableComponentPerformanceTrack) {
            setCurrentTrackFromLanes(lanes);
            logErroredRenderPhase(
              renderStartTime,
              renderEndTime,
              lanes,
              workInProgressUpdateTask,
            );
            finalizeRender(lanes, renderEndTime);
          }
          lanes = errorRetryLanes;
          exitStatus = recoverFromConcurrentError(
            root,
            lanesThatJustErrored,
            errorRetryLanes,
          );
          renderWasConcurrent = false;
          // 恢复 render 后重新检查退出状态。
          if (exitStatus !== RootErrored) {
            // 本次 root 未再出错，从头重启退出算法。
            // TODO：重构退出算法；当前循环主要由 RootSuspendedAtTheShell 再判断造成，可考虑
            // 用更清晰分支替代。
            continue;
          } else {
            // root 再次出错，继续提交可用树。
            if (enableProfilerTimer && enableComponentPerformanceTrack) {
              renderEndTime = now();
            }
          }
        }
      }
      if (exitStatus === RootFatalErrored) {
        if (enableProfilerTimer && enableComponentPerformanceTrack) {
          setCurrentTrackFromLanes(lanes);
          logErroredRenderPhase(
            renderStartTime,
            renderEndTime,
            lanes,
            workInProgressUpdateTask,
          );
          finalizeRender(lanes, renderEndTime);
        }
        prepareFreshStack(root, NoLanes);
        // 致命错误按“已尝试整棵树”处理，避免再安排 prerender。
        const didAttemptEntireTree = true;
        markRootSuspended(root, lanes, NoLane, didAttemptEntireTree);
        break;
      }

      // 已得到一致树；下一步立即提交，或在挂起时等待超时后提交。
      finishConcurrentRender(
        root,
        exitStatus,
        finishedWork,
        lanes,
        renderEndTime,
      );
    }
    break;
  } while (true);

  ensureRootIsScheduled(root);
}

/** 并发 render 失败后以同步模式重试同一 lanes，并合并 recoverable error。 */
function recoverFromConcurrentError(
  root: FiberRoot,
  originallyAttemptedLanes: Lanes,
  errorRetryLanes: Lanes,
): RootExitStatus {
  // hydration 出错时丢弃服务端响应，退回客户端 render。

  // 重渲染前保存上一尝试的错误。
  const errorsFromFirstAttempt = workInProgressRootConcurrentErrors;

  // $FlowFixMe[constant-condition]
  const wasRootDehydrated = supportsHydration && isRootDehydrated(root);
  // $FlowFixMe[constant-condition]
  if (wasRootDehydrated) {
    // shell hydration 失败，设置标志让下次强制客户端 render。现在调用 prepareFreshStack 创建
    // root WIP；该拆分依赖下方 renderRootSync 因 root/lanes 未变而不再准备新栈，略显脆弱。
    // TODO：像嵌套 Suspense 一样在 throwException 内设置 ForceClientRender；目前放这里是为了
    // 同时切到同步 work loop，未来重构再调整。
    const rootWorkInProgress = prepareFreshStack(root, errorRetryLanes);
    rootWorkInProgress.flags |= ForceClientRender;
  }

  const exitStatus = renderRootSync(root, errorRetryLanes, false);
  // RootSuspendedAtTheShell 表示 retry 未完成就 unwind 到 root，树不完整，不能视为恢复，否则
  // commit 会破坏 current 树。原样返回，让 root 保持挂起。
  if (exitStatus !== RootErrored && exitStatus !== RootSuspendedAtTheShell) {
    // retry render 成功完成。

    if (workInProgressRootDidAttachPingListener && !wasRootDehydrated) {
      // 同步 render 又安装了 ping listener，强烈暗示未缓存 Promise（但非唯一原因）。它可能
      // 掩盖后续错误而未真正修复。例如：
      //
      //    use(Promise.resolve('uncached'))
      //    throw new Error('Oops!')
      //
      // 此时“阻止并发数据竞争”与“解包未缓存 Promise”冲突，只能二选一；数据竞争恢复本就是
      // 最后手段，因此禁用它。
      root.errorRecoveryDisabledLanes = mergeLanes(
        root.errorRecoveryDisabledLanes,
        originallyAttemptedLanes,
      );

      // 标记当前 render 挂起并强制重启；这些 lanes 成功完成后，后续更新重新启用错误恢复。
      workInProgressRootInterleavedUpdatedLanes |= originallyAttemptedLanes;
      return RootSuspendedWithDelay;
    }

    // 第一次失败错误已恢复，加入 recoverable 集合，commit phase 再记录。
    const errorsFromSecondAttempt = workInProgressRootRecoverableErrors;
    workInProgressRootRecoverableErrors = errorsFromFirstAttempt;
    // 第二次尝试错误排在第一次之后，保留因果顺序。
    if (errorsFromSecondAttempt !== null) {
      queueRecoverableErrors(errorsFromSecondAttempt);
    }
  } else {
    // UI 恢复失败。
  }
  return exitStatus;
}

/** 把可恢复错误追加到当前 root render，待成功 commit 后统一上报。 */
export function queueRecoverableErrors(errors: Array<CapturedValue<mixed>>) {
  if (workInProgressRootRecoverableErrors === null) {
    workInProgressRootRecoverableErrors = errors;
  } else {
    // $FlowFixMe[method-unbinding]
    workInProgressRootRecoverableErrors.push.apply(
      workInProgressRootRecoverableErrors,
      errors,
    );
  }
}

/** 根据 root exit status 选择立即 commit、fallback throttle、延迟或等待 ping。 */
function finishConcurrentRender(
  root: FiberRoot,
  exitStatus: RootExitStatus,
  finishedWork: Fiber,
  lanes: Lanes,
  renderEndTime: number, // 仅用于性能分析。
) {
  // TODO：多数分支相同，说明部分状态不应建模为互斥 exit status，而应正交记录。
  switch (exitStatus) {
    case RootInProgress:
    case RootFatalErrored: {
      throw new Error('Root did not complete. This is a bug in React.');
    }
    case RootSuspendedWithDelay: {
      if (!includesOnlyTransitions(lanes) && !includesOnlyRetries(lanes)) {
        // 提交 placeholder/fallback。
        break;
      }
    }
    // 继续落入 delayed-suspend 处理。
    case RootSuspendedAtTheShell: {
      // Transition 不提交 placeholder、也不设 timeout；无限期等待更多数据后再继续。
      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        setCurrentTrackFromLanes(lanes);
        logSuspendedRenderPhase(
          renderStartTime,
          renderEndTime,
          lanes,
          workInProgressUpdateTask,
        );
        finalizeRender(lanes, renderEndTime);
        trackSuspendedTime(lanes, renderEndTime);
      }
      const didAttemptEntireTree = !workInProgressRootDidSkipSuspendedSiblings;
      markRootSuspended(
        root,
        lanes,
        workInProgressDeferredLane,
        didAttemptEntireTree,
      );
      return;
    }
    case RootErrored: {
      // 本轮最终出错，说明并未真正恢复；丢弃中间 recoverable errors，仅记录最终错误。这样
      // 服务端与客户端组件都抛同一普通错误时，只报告实际客户端错误。
      workInProgressRootRecoverableErrors = null;
      break;
    }
    case RootSuspended:
    case RootCompleted: {
      break;
    }
    default: {
      throw new Error('Unknown root exit status.');
    }
  }

  if (shouldForceFlushFallbacksInDEV()) {
    // 位于 act 作用域，立即提交以保持测试可预测。
    completeRoot(
      root,
      finishedWork,
      lanes,
      workInProgressRootRecoverableErrors,
      workInProgressTransitions,
      workInProgressRootDidIncludeRecursiveRenderUpdate,
      workInProgressDeferredLane,
      workInProgressRootInterleavedUpdatedLanes,
      workInProgressSuspendedRetryLanes,
      workInProgressRootDidSkipSuspendedSiblings,
      exitStatus,
      null,
      null,
      renderStartTime,
      renderEndTime,
    );
  } else {
    if (
      includesOnlyRetries(lanes) &&
      (alwaysThrottleRetries || exitStatus === RootSuspended)
    ) {
      // 本轮只有 retry、无真实 update；节流 retry commit，避免快速闪过过多 loading 状态。
      const msUntilTimeout =
        globalMostRecentFallbackTime + FALLBACK_THROTTLE_MS - now();

      // 极短等待无需额外延迟。
      if (msUntilTimeout > 10) {
        const didAttemptEntireTree =
          !workInProgressRootDidSkipSuspendedSiblings;
        markRootSuspended(
          root,
          lanes,
          workInProgressDeferredLane,
          didAttemptEntireTree,
        );

        const nextLanes = getNextLanes(root, NoLanes, true);
        if (nextLanes !== NoLanes) {
          // root 还有其他工作；挂起期间先尝试处理它。
          return;
        }

        // render 已挂起但未超时，且无更低优先级工作；不立即提交 fallback，等待更多数据。
        // TODO：把 retry 节流与 Suspensey commit 合并；当前两者串行执行。
        pendingEffectsLanes = lanes;
        root.timeoutHandle = scheduleTimeout(
          completeRootWhenReady.bind(
            null,
            root,
            finishedWork,
            workInProgressRootRecoverableErrors,
            workInProgressTransitions,
            workInProgressRootDidIncludeRecursiveRenderUpdate,
            lanes,
            workInProgressDeferredLane,
            workInProgressRootInterleavedUpdatedLanes,
            workInProgressSuspendedRetryLanes,
            workInProgressRootDidSkipSuspendedSiblings,
            exitStatus,
            'Throttled',
            renderStartTime,
            renderEndTime,
          ),
          msUntilTimeout,
        );
        return;
      }
    }
    completeRootWhenReady(
      root,
      finishedWork,
      workInProgressRootRecoverableErrors,
      workInProgressTransitions,
      workInProgressRootDidIncludeRecursiveRenderUpdate,
      lanes,
      workInProgressDeferredLane,
      workInProgressRootInterleavedUpdatedLanes,
      workInProgressSuspendedRetryLanes,
      workInProgressRootDidSkipSuspendedSiblings,
      exitStatus,
      null,
      renderStartTime,
      renderEndTime,
    );
  }
}

/** 收集 suspensey commit 资源；资源就绪则 completeRoot，否则安装取消/继续回调。 */
function completeRootWhenReady(
  root: FiberRoot,
  finishedWork: Fiber,
  recoverableErrors: Array<CapturedValue<mixed>> | null,
  transitions: Array<Transition> | null,
  didIncludeRenderPhaseUpdate: boolean,
  lanes: Lanes,
  spawnedLane: Lane,
  updatedLanes: Lanes,
  suspendedRetryLanes: Lanes,
  didSkipSuspendedSiblings: boolean,
  exitStatus: RootExitStatus,
  suspendedCommitReason: SuspendedCommitReason, // 仅用于性能分析。
  completedRenderStartTime: number, // 仅用于性能分析。
  completedRenderEndTime: number, // 仅用于性能分析。
) {
  root.timeoutHandle = noTimeout;

  // TODO：把 retry 节流与 Suspensey commit 合并；当前两者串行执行。
  const BothVisibilityAndMaySuspendCommit = Visibility | MaySuspendCommit;
  const subtreeFlags = finishedWork.subtreeFlags;
  const isViewTransitionEligible =
    enableViewTransition && includesOnlyViewTransitionEligibleLanes(lanes); // TODO：改用 subtreeFlag 避免重复判断。
  const isGestureTransition = enableGestureTransition && isGestureRender(lanes);
  const maySuspendCommit =
    subtreeFlags & ShouldSuspendCommit ||
    (subtreeFlags & BothVisibilityAndMaySuspendCommit) ===
      BothVisibilityAndMaySuspendCommit;
  let suspendedState: null | SuspendedState = null;
  if (isViewTransitionEligible || maySuspendCommit || isGestureTransition) {
    // commit 前询问 renderer 宿主树是否就绪；否则等待其通知。
    suspendedState = startSuspendingCommit();
    // 遍历完成树并给所有 suspensey 资源安装监听；renderer 在一次同步事务内用模块状态累积
    // load event。同时登记新增/出现的 ViewTransition 以建立配对。
    accumulateSuspenseyCommit(finishedWork, lanes, suspendedState);
    if (
      isViewTransitionEligible ||
      (isGestureTransition &&
        root.pendingGestures !== null &&
        // gesture 已有运行中的 ViewTransition 时无需先等待；completeRoot 后续可能在 gesture
        // 提交点再阻塞本次 commit。
        root.pendingGestures.running === null)
    ) {
      // 等待所有 pending ViewTransition（含 gesture）结束。
      suspendOnActiveViewTransition(suspendedState, root.containerInfo);
    }
    // timeout 基准：retry 用上次 fallback commit，Transition 用其启动时间；offset 表示已耗时。
    const timeoutOffset = includesOnlyRetries(lanes)
      ? globalMostRecentFallbackTime - now()
      : includesOnlyTransitions(lanes)
        ? globalMostRecentTransitionTime - now()
        : 0;
    // 最后询问 renderer 是否可提交；未就绪时返回订阅 ready 事件的函数。
    const schedulePendingCommit = waitForCommitToBeReady(
      suspendedState,
      timeoutOffset,
    );
    if (schedulePendingCommit !== null) {
      // waitForCommitToBeReady 仅在未就绪时返回 subscribe 函数，避免就绪快路径分配 callback。

      // 暂不可提交；延迟到 renderer 通知 ready。root 若重新开始工作，会取消该等待。
      pendingEffectsLanes = lanes;
      root.cancelPendingCommit = schedulePendingCommit(
        completeRoot.bind(
          null,
          root,
          finishedWork,
          lanes,
          recoverableErrors,
          transitions,
          didIncludeRenderPhaseUpdate,
          spawnedLane,
          updatedLanes,
          suspendedRetryLanes,
          didSkipSuspendedSiblings,
          exitStatus,
          suspendedState,
          enableProfilerTimer
            ? getSuspendedCommitReason(suspendedState, root.containerInfo)
            : null,
          completedRenderStartTime,
          completedRenderEndTime,
        ),
      );
      const didAttemptEntireTree = !didSkipSuspendedSiblings;
      markRootSuspended(root, lanes, spawnedLane, didAttemptEntireTree);
      return;
    }
  }

  // 无需等待资源则立即提交。
  completeRoot(
    root,
    finishedWork,
    lanes,
    recoverableErrors,
    transitions,
    didIncludeRenderPhaseUpdate,
    spawnedLane,
    updatedLanes,
    suspendedRetryLanes,
    didSkipSuspendedSiblings,
    exitStatus,
    suspendedState,
    suspendedCommitReason,
    completedRenderStartTime,
    completedRenderEndTime,
  );
}

/** 提交前重读 useSyncExternalStore snapshot，确认并发 render 未发生 tearing。 */
function isRenderConsistentWithExternalStores(finishedWork: Fiber): boolean {
  // 搜索完成树中的外部 store 读取，检查并发事件是否已 mutation；刻意用迭代遍历以便早退。
  let node: Fiber = finishedWork;
  while (true) {
    const tag = node.tag;
    if (
      (tag === FunctionComponent ||
        tag === ForwardRef ||
        tag === SimpleMemoComponent) &&
      node.flags & StoreConsistency
    ) {
      const updateQueue: FunctionComponentUpdateQueue | null =
        node.updateQueue as any;
      if (updateQueue !== null) {
        const checks = updateQueue.stores;
        if (checks !== null) {
          for (let i = 0; i < checks.length; i++) {
            const check = checks[i];
            const getSnapshot = check.getSnapshot;
            const renderedValue = check.value;
            try {
              if (!is(getSnapshot(), renderedValue)) {
                // snapshot 已变化，发现不一致 store。
                return false;
              }
            } catch (error) {
              // getSnapshot 抛错也返回 false，安排重渲染并在 render 中重新抛出。
              return false;
            }
          }
        }
      }
    }
    const child = node.child;
    if (node.subtreeFlags & StoreConsistency && child !== null) {
      child.return = node;
      node = child;
      continue;
    }
    if (node === finishedWork) {
      return true;
    }
    while (node.sibling === null) {
      if (node.return === null || node.return === finishedWork) {
        return true;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
  }
  // Flow 不知道此处不可达，eslint 能识别。
  // eslint-disable-next-line no-unreachable
  return true;
}

// markRootUpdated/markRootSuspended 的间接层用于避免本模块与 ReactFiberLane 循环依赖。
// 更合理的拆分可能是把全部 root 标记函数移到 work loop。

/** 调用 Lane 层标记 root 更新，并检测 render/commit 递归更新循环。 */
function markRootUpdated(root: FiberRoot, updatedLanes: Lanes) {
  _markRootUpdated(root, updatedLanes);

  if (enableInfiniteRenderLoopDetection) {
    // 检查 render/commit 中递归更新。
    if (executionContext & RenderContext) {
      workInProgressRootDidIncludeRecursiveRenderUpdate = true;
    } else if (executionContext & CommitContext) {
      didIncludeCommitPhaseUpdate = true;
    }

    throwIfInfiniteUpdateLoopDetected(true);
  }
}

/** 标记 suspended lanes 已被 wakeable ping，并检测递归 ping 循环。 */
function markRootPinged(root: FiberRoot, pingedLanes: Lanes) {
  _markRootPinged(root, pingedLanes);

  if (enableInfiniteRenderLoopDetection) {
    // 检查递归 ping。概念上 ping 不同于 update，但重复 ping 挂起 render 会不断安排新尝试，
    // 同样可能形成递归 render 循环。
    if (executionContext & RenderContext) {
      workInProgressRootDidIncludeRecursiveRenderUpdate = true;
    } else if (executionContext & CommitContext) {
      didIncludeCommitPhaseUpdate = true;
    }

    throwIfInfiniteUpdateLoopDetected(true);
  }
}

/** 从挂起 lanes 排除本轮已 ping/interleaved 更新，再通知 Lane 层及 spawned Lane。 */
function markRootSuspended(
  root: FiberRoot,
  suspendedLanes: Lanes,
  spawnedLane: Lane,
  didAttemptEntireTree: boolean,
) {
  if (enableParallelTransitions) {
    // 挂起时必须把 entangled lanes 一并标为 suspended。
    suspendedLanes = getEntangledLanes(root, suspendedLanes);
  }

  // 标记挂起时排除本轮已 ping 或 render phase 已更新的 lanes。
  suspendedLanes = removeLanes(suspendedLanes, workInProgressRootPingedLanes);
  suspendedLanes = removeLanes(
    suspendedLanes,
    workInProgressRootInterleavedUpdatedLanes,
  );
  _markRootSuspended(root, suspendedLanes, spawnedLane, didAttemptEntireTree);
}

/** 把指定 root lanes 升为同步优先级并 flush 全局同步工作。 */
export function flushRoot(root: FiberRoot, lanes: Lanes) {
  if (lanes !== NoLanes) {
    upgradePendingLanesToSync(root, lanes);
    ensureRootIsScheduled(root);
    if ((executionContext & (RenderContext | CommitContext)) === NoContext) {
      resetRenderTimer();
      // TODO：历史原因会 flush 所有根的同步工作；可改为只 flush 指定 root。
      flushSyncWorkOnAllRoots();
    }
  }
}

/** 返回当前 Batched/Render/Commit executionContext 位掩码。 */
export function getExecutionContext(): ExecutionContext {
  return executionContext;
}

/** 在默认事件优先级、无 Transition 上下文中运行回调，生成可延后的更新。 */
export function deferredUpdates<A>(fn: () => A): A {
  const prevTransition = ReactSharedInternals.T;
  const previousPriority = getCurrentUpdatePriority();
  try {
    setCurrentUpdatePriority(DefaultEventPriority);
    ReactSharedInternals.T = null;
    return fn();
  } finally {
    setCurrentUpdatePriority(previousPriority);
    ReactSharedInternals.T = prevTransition;
  }
}

/** 在 BatchedContext 中运行回调，并在最外层退出时 flush Legacy 同步更新。 */
export function batchedUpdates<A, R>(fn: A => R, a: A): R {
  if (disableLegacyMode) {
    // batchedUpdates 现已为空操作，但 react-dom 内部仍调用；移除 Legacy 模式后才能删除。
    return fn(a);
  } else {
    const prevExecutionContext = executionContext;
    executionContext |= BatchedContext;
    try {
      return fn(a);
    } finally {
      executionContext = prevExecutionContext;
      // 最外层 batchedUpdates-like 调用退出时 flush Legacy 同步更新。
      if (
        executionContext === NoContext &&
        // 即使 Legacy 模式，也把 act 视为位于 batchedUpdates 内。
        !(__DEV__ && ReactSharedInternals.isBatchingLegacy)
      ) {
        resetRenderTimer();
        flushSyncWorkOnLegacyRootsOnly();
      }
    }
  }
}

/** 以离散事件优先级、无 Transition 上下文运行事件回调。 */
export function discreteUpdates<A, B, C, D, R>(
  fn: (A, B, C, D) => R,
  a: A,
  b: B,
  c: C,
  d: D,
): R {
  const prevTransition = ReactSharedInternals.T;
  const previousPriority = getCurrentUpdatePriority();
  try {
    setCurrentUpdatePriority(DiscreteEventPriority);
    ReactSharedInternals.T = null;
    return fn(a, b, c, d);
  } finally {
    setCurrentUpdatePriority(previousPriority);
    ReactSharedInternals.T = prevTransition;
    if (executionContext === NoContext) {
      resetRenderTimer();
    }
  }
}

// 用重载表达两种合法签名；代价是 Flow 不再按重载检查函数体。
/** 带回调的 flushSync 签名：返回回调结果。 */
declare function flushSyncFromReconciler<R>(fn: () => R): R;
/** 无回调的 flushSync 签名：仅 flush 已排队同步工作。 */
declare function flushSyncFromReconciler(void): void;
/** 以离散优先级运行可选回调，恢复上下文后同步 flush 所有根。 */
export function flushSyncFromReconciler<R>(fn: (() => R) | void): R | void {
  // Legacy 模式在下一事件开头而非上一事件末尾 flush pending passive effects。
  if (
    pendingEffectsStatus !== NO_PENDING_EFFECTS &&
    !disableLegacyMode &&
    pendingEffectsRoot.tag === LegacyRoot &&
    (executionContext & (RenderContext | CommitContext)) === NoContext
  ) {
    flushPendingEffects();
  }

  const prevExecutionContext = executionContext;
  executionContext |= BatchedContext;

  const prevTransition = ReactSharedInternals.T;
  const previousPriority = getCurrentUpdatePriority();

  try {
    setCurrentUpdatePriority(DiscreteEventPriority);
    ReactSharedInternals.T = null;
    if (fn) {
      return fn();
    } else {
      return undefined;
    }
  } finally {
    setCurrentUpdatePriority(previousPriority);
    ReactSharedInternals.T = prevTransition;

    executionContext = prevExecutionContext;
    // flush 本 batch 安排的 immediate callbacks；即使栈上还有 batchedUpdates 也会执行。
    if ((executionContext & (RenderContext | CommitContext)) === NoContext) {
      flushSyncWorkOnAllRoots();
    }
  }
}

// 在 render/commit 外调用会 flush 全部根的同步工作；返回调用时是否位于 React 工作阶段。
/** 若不在 render/commit 中则 flush 全部同步工作；返回调用时是否已在 React 工作阶段。 */
export function flushSyncWork(): boolean {
  if ((executionContext & (RenderContext | CommitContext)) === NoContext) {
    flushSyncWorkOnAllRoots();
    return false;
  }
  return true;
}

/** 判断渲染器 API 当前是否在 render 或 commit 的非法重入上下文。 */
export function isAlreadyRendering(): boolean {
  // renderer 用于警告 API 在错误上下文调用，以及输出 profiling 警告。
  return (executionContext & (RenderContext | CommitContext)) !== NoContext;
}

/** 判断 Event Function 是否在 render 阶段被非法调用。 */
export function isInvalidExecutionContextForEventFunction(): boolean {
  // 用于在 API 于 render 上下文非法调用时抛错。
  return (executionContext & RenderContext) !== NoContext;
}

// HiddenContext 进入/离开隐藏子树时调用；栈逻辑由唯一修改方管理。函数会被内联，放在哪个
// 模块不影响性能。
/** HiddenContext 进入/离开隐藏子树时更新上下文化 entangled render lanes。 */
export function setEntangledRenderLanes(newEntangledRenderLanes: Lanes) {
  entangledRenderLanes = newEntangledRenderLanes;
}

/** 返回当前隐藏上下文扩展后的 entangled render lanes。 */
export function getEntangledRenderLanes(): Lanes {
  return entangledRenderLanes;
}

/** 中断当前 render 时 unwind context 栈并清空 work-in-progress 指针。 */
function resetWorkInProgressStack() {
  if (workInProgress === null) return;
  let interruptedWork;
  if (workInProgressSuspendedReason === NotSuspended) {
    // 普通情况：WIP 尚未开始，unwind 所有父级。
    interruptedWork = workInProgress.return;
  } else {
    // WIP 正挂起：先重置 work loop，再 unwind 挂起 Fiber 及所有父级。
    resetSuspendedWorkLoopOnUnwind(workInProgress);
    interruptedWork = workInProgress;
  }
  while (interruptedWork !== null) {
    const current = interruptedWork.alternate;
    unwindInterruptedWork(
      current,
      interruptedWork,
      workInProgressRootRenderLanes,
    );
    interruptedWork = interruptedWork.return;
  }
  workInProgress = null;
}

/** render 结束时记录 Profiler/性能轨道并恢复 dispatcher、debug task 与警告状态。 */
function finalizeRender(lanes: Lanes, finalizationTime: number): void {
  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    if (isGestureRender(lanes)) {
      clampGestureTimers(finalizationTime);
    } else if (includesBlockingLane(lanes)) {
      clampBlockingTimers(finalizationTime);
    }
    if (includesTransitionLane(lanes)) {
      clampTransitionTimers(finalizationTime);
    }
    if (includesRetryLane(lanes)) {
      clampRetryTimers(finalizationTime);
    }
    if (includesIdleGroupLanes(lanes)) {
      clampIdleTimers(finalizationTime);
    }
  }
}

/**
 * 取消/flush 旧 pending commit，重置 interrupted 栈，并从 root.current 创建全新 WIP 根及
 * 本轮 lanes、错误、Transition、Profiler 状态。
 */
function prepareFreshStack(root: FiberRoot, lanes: Lanes): Fiber {
  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    // 轨道组按最早 start time 排序。为了始终按优先级展示所有轨道，这里重复写占位标记；
    // 未被录制的调用不参与排序，而 React 无法知道录制何时开始，所以不能只做一次。
    markAllLanesInOrder();

    const previousRenderStartTime = renderStartTime;
    // 新 render 开始：记录上一 render 结束点及本次开始前的阻塞时间。
    recordRenderTime();
    // 若因打断更新而重启，轨道已连续 render 到重启点，没有空间显示原因，需夹紧时间。
    if (
      workInProgressRootRenderLanes !== NoLanes &&
      previousRenderStartTime > 0
    ) {
      setCurrentTrackFromLanes(workInProgressRootRenderLanes);
      if (
        workInProgressRootExitStatus === RootSuspended ||
        workInProgressRootExitStatus === RootSuspendedWithDelay
      ) {
        // root 被打断重启前已挂起，原本就无可展示内容，因此记为 prewarm 而非坏的 interrupted render。
        logSuspendedRenderPhase(
          previousRenderStartTime,
          renderStartTime,
          lanes,
          workInProgressUpdateTask,
        );
      } else {
        logInterruptedRenderPhase(
          previousRenderStartTime,
          renderStartTime,
          lanes,
          workInProgressUpdateTask,
        );
      }
      finalizeRender(workInProgressRootRenderLanes, renderStartTime);
    }
    const previousUpdateTask = workInProgressUpdateTask;

    workInProgressUpdateTask = null;
    if (isGestureRender(lanes)) {
      workInProgressUpdateTask = gestureUpdateTask;
      const clampedUpdateTime =
        gestureUpdateTime >= 0 && gestureUpdateTime < gestureClampTime
          ? gestureClampTime
          : gestureUpdateTime;
      const clampedEventTime =
        gestureEventTime >= 0 && gestureEventTime < gestureClampTime
          ? gestureClampTime
          : gestureEventTime;
      const clampedRenderStartTime =
        // 把挂起起点夹到首个事件/更新时刻。
        clampedEventTime >= 0
          ? clampedEventTime
          : clampedUpdateTime >= 0
            ? clampedUpdateTime
            : renderStartTime;
      if (gestureSuspendedTime >= 0) {
        setCurrentTrackFromLanes(GestureLane);
        logSuspendedWithDelayPhase(
          gestureSuspendedTime,
          clampedRenderStartTime,
          lanes,
          workInProgressUpdateTask,
        );
      } else if (isGestureRender(animatingLanes)) {
        // Lane 仍在动画时，把上一 render 结束至今记录为 animating。
        setCurrentTrackFromLanes(GestureLane);
        logAnimatingPhase(
          gestureClampTime,
          clampedRenderStartTime,
          animatingTask,
        );
      }
      logGestureStart(
        clampedUpdateTime,
        clampedEventTime,
        gestureEventType,
        gestureEventRepeatTime > 0,
        gestureUpdateType === PINGED_UPDATE,
        renderStartTime,
        gestureUpdateTask,
        gestureUpdateMethodName,
        gestureUpdateComponentName,
      );
      clearGestureTimers();
    } else if (includesBlockingLane(lanes)) {
      workInProgressUpdateTask = blockingUpdateTask;
      const clampedUpdateTime =
        blockingUpdateTime >= 0 && blockingUpdateTime < blockingClampTime
          ? blockingClampTime
          : blockingUpdateTime;
      const clampedEventTime =
        blockingEventTime >= 0 && blockingEventTime < blockingClampTime
          ? blockingClampTime
          : blockingEventTime;
      const clampedRenderStartTime = // 把挂起时间夹到首个事件或更新的起点。
        clampedEventTime >= 0
          ? clampedEventTime
          : clampedUpdateTime >= 0
            ? clampedUpdateTime
            : renderStartTime;
      if (blockingSuspendedTime >= 0) {
        setCurrentTrackFromLanes(SyncLane);
        logSuspendedWithDelayPhase(
          blockingSuspendedTime,
          clampedRenderStartTime,
          lanes,
          previousUpdateTask,
        );
      } else if (
        !isGestureRender(animatingLanes) &&
        includesBlockingLane(animatingLanes)
      ) {
        // Lane 仍在动画时，把上一 render 结束至今记录为 animating。
        setCurrentTrackFromLanes(SyncLane);
        logAnimatingPhase(
          blockingClampTime,
          clampedRenderStartTime,
          animatingTask,
        );
      }
      logBlockingStart(
        clampedUpdateTime,
        clampedEventTime,
        blockingEventType,
        blockingEventRepeatTime > 0,
        blockingUpdateType === SPAWNED_UPDATE,
        blockingUpdateType === PINGED_UPDATE,
        renderStartTime,
        lanes,
        blockingUpdateTask,
        blockingUpdateMethodName,
        blockingUpdateComponentName,
      );
      clearBlockingTimers();
    }
    if (includesTransitionLane(lanes)) {
      workInProgressUpdateTask = transitionUpdateTask;
      const clampedStartTime =
        transitionStartTime >= 0 && transitionStartTime < transitionClampTime
          ? transitionClampTime
          : transitionStartTime;
      const clampedUpdateTime =
        transitionUpdateTime >= 0 && transitionUpdateTime < transitionClampTime
          ? transitionClampTime
          : transitionUpdateTime;
      const clampedEventTime =
        transitionEventTime >= 0 && transitionEventTime < transitionClampTime
          ? transitionClampTime
          : transitionEventTime;
      const clampedRenderStartTime =
        // 把挂起起点夹到首个事件/更新时刻。
        clampedEventTime >= 0
          ? clampedEventTime
          : clampedUpdateTime >= 0
            ? clampedUpdateTime
            : renderStartTime;
      if (transitionSuspendedTime >= 0) {
        setCurrentTrackFromLanes(SomeTransitionLane);
        logSuspendedWithDelayPhase(
          transitionSuspendedTime,
          clampedRenderStartTime,
          lanes,
          workInProgressUpdateTask,
        );
      } else if (includesTransitionLane(animatingLanes)) {
        // Lane 仍在动画时，把上一 render 结束至今记录为 animating。
        setCurrentTrackFromLanes(SomeTransitionLane);
        logAnimatingPhase(
          transitionClampTime,
          clampedRenderStartTime,
          animatingTask,
        );
      }
      logTransitionStart(
        clampedStartTime,
        clampedUpdateTime,
        clampedEventTime,
        transitionEventType,
        transitionEventRepeatTime > 0,
        transitionUpdateType === PINGED_UPDATE,
        renderStartTime,
        transitionUpdateTask,
        transitionUpdateMethodName,
        transitionUpdateComponentName,
      );
      clearTransitionTimers();
    }
    if (includesRetryLane(lanes)) {
      if (includesRetryLane(animatingLanes)) {
        // Lane 仍在动画时，把上一 render 结束至今记录为 animating。
        setCurrentTrackFromLanes(SomeRetryLane);
        logAnimatingPhase(retryClampTime, renderStartTime, animatingTask);
      }
    }
    if (includesIdleGroupLanes(lanes)) {
      if (includesIdleGroupLanes(animatingLanes)) {
        // Lane 仍在动画时，把上一 render 结束至今记录为 animating。
        setCurrentTrackFromLanes(IdleLane);
        logAnimatingPhase(idleClampTime, renderStartTime, animatingTask);
      }
    }
  }

  const timeoutHandle = root.timeoutHandle;
  if (timeoutHandle !== noTimeout) {
    // root 先前挂起并安排 fallback timeout；现有新工作，取消 timeout。
    root.timeoutHandle = noTimeout;
    // $FlowFixMe[incompatible-call] Complains noTimeout is not a TimeoutID, despite the check above
    cancelTimeout(timeoutHandle);
  }
  const cancelPendingCommit = root.cancelPendingCommit;
  if (cancelPendingCommit !== null) {
    root.cancelPendingCommit = null;
    cancelPendingCommit();
  }

  pendingEffectsLanes = NoLanes;

  resetWorkInProgressStack();
  workInProgressRoot = root;
  const rootWorkInProgress = createWorkInProgress(root.current, null);
  workInProgress = rootWorkInProgress;
  workInProgressRootRenderLanes = lanes;
  workInProgressSuspendedReason = NotSuspended;
  workInProgressThrownValue = null;
  workInProgressRootDidSkipSuspendedSiblings = false;
  workInProgressRootIsPrerendering = checkIfRootIsPrerendering(root, lanes);
  workInProgressRootDidAttachPingListener = false;
  workInProgressRootExitStatus = RootInProgress;
  workInProgressRootSkippedLanes = NoLanes;
  workInProgressRootInterleavedUpdatedLanes = NoLanes;
  workInProgressRootRenderPhaseUpdatedLanes = NoLanes;
  workInProgressRootPingedLanes = NoLanes;
  workInProgressDeferredLane = NoLane;
  workInProgressSuspendedRetryLanes = NoLanes;
  workInProgressRootConcurrentErrors = null;
  workInProgressRootRecoverableErrors = null;
  workInProgressRootDidIncludeRecursiveRenderUpdate = false;

  // 取得与待 render lanes entangle 的集合，分离“render task 优先级”与“必须同批提交的 lanes”。
  // 例如 Transition 可能需包含已挂起 SyncLane 才能完成：两者同批 render，但仍以 Transition
  // 优先级执行，因为 SyncLane 已挂起。
  entangledRenderLanes = getEntangledLanes(root, lanes);

  finishQueueingConcurrentUpdates();

  if (__DEV__) {
    resetOwnerStackLimit();

    ReactStrictModeWarnings.discardPendingWarnings();
  }

  return rootWorkInProgress;
}

/** 决定 unwind 后重置 Context、Hooks 与 ChildReconciler 的模块级挂起状态。 */
function resetSuspendedWorkLoopOnUnwind(fiber: Fiber) {
  // 重置 render phase 写入的模块级状态。
  resetContextDependencies();
  resetHooksOnUnwind(fiber);
  resetChildReconcilerOnUnwind();
}

/**
 * 分类 render 抛出值为数据/Action/宿主资源/hydration/错误，保存 SuspendedReason 与值，
 * 清理用户代码 dispatcher，并记录 Profiler/Scheduling Profiler 信息。
 */
function handleThrow(root: FiberRoot, thrownValue: any): void {
  // 组件抛出异常，通常是挂起，也可能是普通错误。接下来要么 unwind 到 Suspense/Error
  // Boundary，要么在 Promise resolve 后重放组件。决定前保留 work loop 当前状态；若选择
  // unwind，再由 resetSuspendedWorkLoopOnUnwind 清理模块变量。

  // 这些状态只应在执行用户代码时存在，异常后立即重置。
  resetHooksAfterThrow();
  if (__DEV__) {
    resetCurrentFiber();
  }

  if (
    thrownValue === SuspenseException ||
    thrownValue === SuspenseActionException
  ) {
    // Suspense 内部异常需还原为 thenable：use 出现前，直接 throw thenable 是旧的不稳定 API，
    // 后续实现仍依赖该形态；旧 API 淘汰后可移除转换。
    thrownValue = getSuspendedThenable();
    // TODO：render phase 暂停 work loop 当前与 sibling prerender 不兼容，未来恢复优化。
    // 这里只给数据一次 microtask 内立即 resolve 的机会，否则触发最近 Suspense fallback。
    workInProgressSuspendedReason = SuspendedOnImmediate;
  } else if (thrownValue === SuspenseyCommitException) {
    thrownValue = getSuspendedThenable();
    workInProgressSuspendedReason = SuspendedOnInstance;
  } else if (thrownValue === SelectiveHydrationException) {
    // 更新流入 dehydrated 边界，必须先 hydration；中断 WIP render，以 hydration Lane 重启。
    // 理想实现可不 unwind 当前栈直接切换上下文；目前只有此场景需要该机制。
    workInProgressSuspendedReason = SuspendedOnHydration;
  } else {
    // 普通错误或旧式 wakeable。
    const isWakeable =
      thrownValue !== null &&
      typeof thrownValue === 'object' &&
      typeof thrownValue.then === 'function';

    workInProgressSuspendedReason = isWakeable
      ? // 旧式 Suspense 实现抛出了 wakeable；这种直接 throw 与 use 挂起语义略有不同。
        SuspendedOnDeprecatedThrowPromise
      : // 这是普通错误。若组件早先已挂起，必须清除 thenable 状态才能解除 work loop 阻塞。
        SuspendedOnError;
  }

  workInProgressThrownValue = thrownValue;

  const erroredWork = workInProgress;
  if (erroredWork === null) {
    // 已无当前 WIP，属于 root 级致命错误。
    workInProgressRootExitStatus = RootFatalErrored;
    logUncaughtError(
      root,
      createCapturedValueAtFiber(thrownValue, root.current),
    );
    return;
  }

  if (enableProfilerTimer && erroredWork.mode & ProfileMode) {
    // 记录抛错前 render 耗时，避免挂起 render 导致 Profiler duration 不准确。
    stopProfilerTimerIfRunningAndRecordDuration(erroredWork);
  }

  if (enableSchedulingProfiler) {
    markComponentRenderStopped();
    switch (workInProgressSuspendedReason) {
      case SuspendedOnError: {
        markComponentErrored(
          erroredWork,
          thrownValue,
          workInProgressRootRenderLanes,
        );
        break;
      }
      case SuspendedOnData:
      case SuspendedOnAction:
      case SuspendedOnImmediate:
      case SuspendedOnDeprecatedThrowPromise:
      case SuspendedAndReadyToContinue: {
        const wakeable: Wakeable = thrownValue as any;
        markComponentSuspended(
          erroredWork,
          wakeable,
          workInProgressRootRenderLanes,
        );
        break;
      }
      case SuspendedOnInstance: {
        // 概念上是挂起，但关联未加载 CSS/图片等宿主资源而非特定 wakeable；DevTools 暂不处理。
        break;
      }
      case SuspendedOnHydration: {
        // 概念上是无特定 wakeable 的 hydration 挂起，类似组件被中断；DevTools 暂不单独标记。
        break;
      }
    }
  }
}

/** 按 Lane 类型、最近 Suspense 与 shell 边界判断挂起时保留旧屏还是立即显示 fallback。 */
export function shouldRemainOnPreviousScreen(): boolean {
  // 比较“挂起 Transition 并保留旧屏”与“尽快显示 fallback”，同时考虑 render 优先级和体验。

  const handler = getSuspenseHandler();
  if (handler === null) {
    // 没有可提供 fallback 的 Suspense，只能保留旧屏；同步更新也如此。未来可考虑让整个 root
    // 进入 detached 模式。
    return true;
  }

  // TODO：use 完全替代 throw Promise 后，移除 finishConcurrentRender 的重复检查，只保留此处。
  if (includesOnlyTransitions(workInProgressRootRenderLanes)) {
    if (getShellBoundary() === null) {
      // 正在应用 shell 内 render；激活最近 fallback 会让可见内容消失，故保留旧屏更好。
      return true;
    } else {
      // 内容不属于旧屏；与其阻塞 Transition，不如尽快显示 fallback，并节流嵌套 fallback。
      return false;
    }
  }

  if (
    includesOnlyRetries(workInProgressRootRenderLanes) ||
    // 此上下文把 OffscreenLane 视为 Retry。
    // TODO：Retry 与 Offscreen 关联很深，可进一步统一。
    includesSomeLane(workInProgressRootRenderLanes, OffscreenLane)
  ) {
    // retry 时若最近 Suspense 即 shell 边界，可暂停 render，因为不会阻挡新内容出现。必须确认
    // 是 retry：它不改变现有 UI，只填充此前 Transition 留下的 fallback，不会阻塞真实更新。
    return handler === getShellBoundary();
  }

  // Transition/Retry 之外的 lanes 不等待数据加载。
  return false;
}

/** render 期间安装只允许 Context 的 Hooks dispatcher，并返回旧 dispatcher。 */
function pushDispatcher(container: any) {
  const prevDispatcher = ReactSharedInternals.H;
  ReactSharedInternals.H = ContextOnlyDispatcher;
  if (prevDispatcher === null) {
    // React isomorphic 包不含默认 dispatcher；首个 renderer 惰性安装，以提供更友好错误。
    return ContextOnlyDispatcher;
  } else {
    return prevDispatcher;
  }
}

/** render 结束后恢复先前 Hooks dispatcher。 */
function popDispatcher(prevDispatcher: any) {
  ReactSharedInternals.H = prevDispatcher;
}

/** render 期间安装默认 AsyncDispatcher，并返回旧值。 */
function pushAsyncDispatcher() {
  const prevAsyncDispatcher = ReactSharedInternals.A;
  ReactSharedInternals.A = DefaultAsyncDispatcher;
  return prevAsyncDispatcher;
}

/** render 结束后恢复先前 AsyncDispatcher。 */
function popAsyncDispatcher(prevAsyncDispatcher: any) {
  ReactSharedInternals.A = prevAsyncDispatcher;
}

/** 无显式更新任务时把留下待办工作的 Fiber debugTask 作为本次 render 原因。 */
export function markRenderDerivedCause(fiber: Fiber): void {
  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    if (__DEV__) {
      if (workInProgressUpdateTask === null) {
        // 无关联原因通常表示另一 render 在此 Fiber 留下工作；用该 Fiber.debugTask 作为原因。
        // 多 sibling 同时 render 时可能不唯一，但理想上不应如此。
        workInProgressUpdateTask =
          fiber._debugTask == null ? null : fiber._debugTask;
      }
    }
  }
}

/** 记录最近 Transition 启动时间，供 suspensey 资源超时启发式使用。 */
export function markTransitionStarted() {
  globalMostRecentTransitionTime = now();
}

/** 记录最近 fallback/content commit 时间，供连续 fallback 节流。 */
export function markCommitTimeOfFallback() {
  globalMostRecentFallbackTime = now();
}

/** 累积本轮访问组件中未处理的更新 lanes。 */
export function markSkippedUpdateLanes(lane: Lane | Lanes): void {
  workInProgressRootSkippedLanes = mergeLanes(
    lane,
    workInProgressRootSkippedLanes,
  );
}

/** 把尚在进行的 root 标记为普通挂起。 */
export function renderDidSuspend(): void {
  if (workInProgressRootExitStatus === RootInProgress) {
    workInProgressRootExitStatus = RootSuspended;
  }
}

/** 标记延迟 fallback 挂起，并在不可提交时转入 prerender、切换被跳过更新。 */
export function renderDidSuspendDelayIfPossible(): void {
  workInProgressRootExitStatus = RootSuspendedWithDelay;

  if (
    !workInProgressRootDidSkipSuspendedSiblings &&
    // 判断 root 是否会被阻止 commit。
    // TODO：与其他逻辑统一；或仅此条件成立时设置 RootSuspendedWithDelay，并删除重复检查。
    (includesOnlyTransitions(workInProgressRootRenderLanes) ||
      getSuspenseHandler() === null)
  ) {
    // 本轮原本可能不是 prerender，但可见树内挂起使 fallback 无法提交；按 prerender 继续，
    // 直接预热 sibling，避免另起一遍。
    workInProgressRootIsPrerendering = true;
  }

  // 检查此前跳过的更新是否可能解除本轮阻塞。
  if (
    (includesNonIdleWork(workInProgressRootSkippedLanes) ||
      includesNonIdleWork(workInProgressRootInterleavedUpdatedLanes)) &&
    workInProgressRoot !== null
  ) {
    // 立即把当前 render 标为 suspended，切换到被跳过更新；通常要到 render 末尾才标记。
    // TODO：考虑总在此立即标记，避免末尾误挂起 render 中已 ping/更新的 lanes；也可借
    // SuspendedOnHydration 机制立即 unwind。
    const didAttemptEntireTree = false;
    markRootSuspended(
      workInProgressRoot,
      workInProgressRootRenderLanes,
      workInProgressDeferredLane,
      didAttemptEntireTree,
    );
  }
}

/** 把 root 标记为可恢复错误，但不覆盖更强的 delayed-suspend 状态。 */
export function renderDidError() {
  if (workInProgressRootExitStatus !== RootSuspendedWithDelay) {
    workInProgressRootExitStatus = RootErrored;
  }
}

/** 把并发 render 错误加入当前 root 的恢复候选。 */
export function queueConcurrentError(error: CapturedValue<mixed>) {
  if (workInProgressRootConcurrentErrors === null) {
    workInProgressRootConcurrentErrors = [error];
  } else {
    workInProgressRootConcurrentErrors.push(error);
  }
}

// render 中判断是否尚无任何挂起；不确定时返回 false。
/** 仅在 root 仍为 InProgress 时确认尚未观察到挂起/错误。 */
export function renderHasNotSuspendedYet(): boolean {
  // 已出错或完成时无法确认，均返回 false。
  return workInProgressRootExitStatus === RootInProgress;
}

// TODO：该函数与 renderRootConcurrent 越来越相似，考虑重新合并路径。
/** 不向主线程 yield 地 render root；遇挂起立即 unwind 到最近 Suspense/Error Boundary。 */
function renderRootSync(
  root: FiberRoot,
  lanes: Lanes,
  shouldYieldForPrerendering: boolean,
): RootExitStatus {
  const prevExecutionContext = executionContext;
  executionContext |= RenderContext;
  const prevDispatcher = pushDispatcher(root.containerInfo);
  const prevAsyncDispatcher = pushAsyncDispatcher();

  // root 或 lanes 变化则丢弃旧栈、准备新栈；否则从上次位置继续。
  if (workInProgressRoot !== root || workInProgressRootRenderLanes !== lanes) {
    if (enableUpdaterTracking) {
      if (isDevToolsPresent) {
        const memoizedUpdaters = root.memoizedUpdaters;
        if (memoizedUpdaters.size > 0) {
          restorePendingUpdaters(root, workInProgressRootRenderLanes);
          memoizedUpdaters.clear();
        }

        // 把即将执行工作的 updater Fiber 从 Map 移到 memoized Set；若 bailout 再移回。现在
        // 移动可把当前更新与同优先级、不同 updater 派生的未来工作分开。
        movePendingFibersToMemoized(root, lanes);
      }
    }

    workInProgressTransitions = getTransitionsForLanes(root, lanes);
    prepareFreshStack(root, lanes);
  }

  if (enableSchedulingProfiler) {
    markRenderStarted(lanes);
  }

  let didSuspendInShell = false;
  let exitStatus = workInProgressRootExitStatus;
  outer: do {
    try {
      if (
        workInProgressSuspendedReason !== NotSuspended &&
        workInProgress !== null
      ) {
        // 同步 render 不向主线程 yield；work loop 挂起时立即 unwind，触发 fallback 或 Error
        // Boundary。TODO：非 flushSync 的离散/默认更新应先等 microtask flush；可借并发路径
        // 实现，或合并 sync/concurrent 根函数后再分叉行为。
        const unitOfWork = workInProgress;
        const thrownValue = workInProgressThrownValue;
        switch (workInProgressSuspendedReason) {
          case SuspendedOnHydration: {
            // selective hydration：更新流入 dehydrated 树；中断当前 render 切到 hydration Lane。
            // TODO：或可不在此重置栈，只 yield，重入 work loop 时按常规重置。
            resetWorkInProgressStack();
            exitStatus = RootSuspendedAtTheShell;
            break outer;
          }
          case SuspendedOnImmediate:
          case SuspendedOnData:
          case SuspendedOnAction:
          case SuspendedOnDeprecatedThrowPromise: {
            if (getSuspenseHandler() === null) {
              didSuspendInShell = true;
            }
            const reason = workInProgressSuspendedReason;
            workInProgressSuspendedReason = NotSuspended;
            workInProgressThrownValue = null;
            throwAndUnwindWorkLoop(root, unitOfWork, thrownValue, reason);
            if (
              shouldYieldForPrerendering &&
              workInProgressRootIsPrerendering
            ) {
              // 已切到 prerender，说明在 Suspense 外挂起、本轮无法 commit；向主线程 yield，
              // 下次改用并发 work loop 预渲染。
              exitStatus = RootInProgress;
              break outer;
            }
            break;
          }
          default: {
            // unwind 后继续普通 work loop。
            const reason = workInProgressSuspendedReason;
            workInProgressSuspendedReason = NotSuspended;
            workInProgressThrownValue = null;
            throwAndUnwindWorkLoop(root, unitOfWork, thrownValue, reason);
            break;
          }
        }
      }
      workLoopSync();
      exitStatus = workInProgressRootExitStatus;
      break;
    } catch (thrownValue) {
      handleThrow(root, thrownValue);
    }
  } while (true);

  // 检查 shell 内挂起，用于检测未缓存 Promise 造成的无限 ping 循环。每次同步整树尝试只加
  // 一次计数，即使多个 sibling 都挂起。
  if (didSuspendInShell) {
    root.shellSuspendCounter++;
  }

  resetContextDependencies();

  executionContext = prevExecutionContext;
  popDispatcher(prevDispatcher);
  popAsyncDispatcher(prevAsyncDispatcher);

  if (enableSchedulingProfiler) {
    markRenderStopped();
  }

  if (workInProgress !== null) {
    // 未完成整棵树，可能因为 shell 内挂起。
  } else {
    // 普通情况：整棵树已完成。

    // 清空指针表示已无进行中的 render。
    workInProgressRoot = null;
    workInProgressRootRenderLanes = NoLanes;

    // render phase 完成，现在可安全处理并发更新队列。
    finishQueueingConcurrentUpdates();
  }

  return exitStatus;
}

// work loop 是极热路径，要求 Closure 不内联。
/** 同步热路径：连续执行 unit，直到 WIP 为空；@noinline 避免 Closure 膨胀调用方。 */
function workLoopSync() {
  // Fiber 之间不检查 yield，持续执行工作。
  while (workInProgress !== null) {
    performUnitOfWork(workInProgress);
  }
}

/** 可中断地 render root；按 SuspendedReason 等待 microtask、重放 unit、unwind 或让出主线程。 */
function renderRootConcurrent(root: FiberRoot, lanes: Lanes): RootExitStatus {
  const prevExecutionContext = executionContext;
  executionContext |= RenderContext;
  const prevDispatcher = pushDispatcher(root.containerInfo);
  const prevAsyncDispatcher = pushAsyncDispatcher();

  // root 或 lanes 变化则丢弃旧栈、准备新栈；否则从上次位置继续。
  if (workInProgressRoot !== root || workInProgressRootRenderLanes !== lanes) {
    if (enableUpdaterTracking) {
      if (isDevToolsPresent) {
        const memoizedUpdaters = root.memoizedUpdaters;
        if (memoizedUpdaters.size > 0) {
          restorePendingUpdaters(root, workInProgressRootRenderLanes);
          memoizedUpdaters.clear();
        }

        // 把即将执行工作的 updater Fiber 从 Map 移到 Set；若 bailout 再移回。现在移动可把
        // 当前更新与同优先级、不同 updater 派生的未来工作分开。
        movePendingFibersToMemoized(root, lanes);
      }
    }

    workInProgressTransitions = getTransitionsForLanes(root, lanes);

    resetRenderTimer();
    prepareFreshStack(root, lanes);
  } else {
    // 延续既有 WIP；若此前为 prerender，检查 interleaved event 是否带来新数据。
    workInProgressRootIsPrerendering = checkIfRootIsPrerendering(root, lanes);
  }

  if (enableSchedulingProfiler) {
    markRenderStarted(lanes);
  }

  outer: do {
    try {
      if (
        workInProgressSuspendedReason !== NotSuspended &&
        workInProgress !== null
      ) {
        // work loop 已挂起，需要 unwind 或重放挂起组件。
        const unitOfWork = workInProgress;
        const thrownValue = workInProgressThrownValue;
        resumeOrUnwind: switch (workInProgressSuspendedReason) {
          case SuspendedOnError: {
            // unwind 后继续普通 work loop。
            workInProgressSuspendedReason = NotSuspended;
            workInProgressThrownValue = null;
            throwAndUnwindWorkLoop(
              root,
              unitOfWork,
              thrownValue,
              SuspendedOnError,
            );
            break;
          }
          case SuspendedOnData:
          case SuspendedOnAction: {
            const thenable: Thenable<mixed> = thrownValue as any;
            if (isThenableResolved(thenable)) {
              // 数据已 resolve，重试组件 render。
              workInProgressSuspendedReason = NotSuspended;
              workInProgressThrownValue = null;
              replaySuspendedUnitOfWork(unitOfWork);
              break;
            }
            // work loop 等待数据，resolve 后才能继续。
            // TODO：处理 Promise 同步 resolve；通常插桩 status 时处理，但已有 status 的 Promise
            // 直到此处才安装 listener。
            /** thenable resolve 后若仍等待同一 root 则标记可继续，并确保重新调度。 */
            const onResolution = () => {
              // 检查 root 是否仍等待同一 Promise。
              if (
                (workInProgressSuspendedReason === SuspendedOnData ||
                  workInProgressSuspendedReason === SuspendedOnAction) &&
                workInProgressRoot === root
              ) {
                // 标记 root 可继续 render。
                workInProgressSuspendedReason = SuspendedAndReadyToContinue;
              }
              // 确保 root 已调度；即使当前处理别的 root，也要保证稍后恢复。
              ensureRootIsScheduled(root);
            };
            thenable.then(onResolution, onResolution);
            break outer;
          }
          case SuspendedOnImmediate: {
            // Fiber 刚挂起时数据可能已缓存；向主线程 yield 给它 ping 的机会，成功则不 unwind
            // 直接重试。
            workInProgressSuspendedReason = SuspendedAndReadyToContinue;
            break outer;
          }
          case SuspendedOnInstance: {
            workInProgressSuspendedReason =
              SuspendedOnInstanceAndReadyToContinue;
            break outer;
          }
          case SuspendedAndReadyToContinue: {
            const thenable: Thenable<mixed> = thrownValue as any;
            if (isThenableResolved(thenable)) {
              // 数据已 resolve，重试组件 render。
              workInProgressSuspendedReason = NotSuspended;
              workInProgressThrownValue = null;
              replaySuspendedUnitOfWork(unitOfWork);
            } else {
              // 否则 unwind 后继续普通 work loop。
              workInProgressSuspendedReason = NotSuspended;
              workInProgressThrownValue = null;
              throwAndUnwindWorkLoop(
                root,
                unitOfWork,
                thrownValue,
                SuspendedAndReadyToContinue,
              );
            }
            break;
          }
          case SuspendedOnInstanceAndReadyToContinue: {
            let resource: null | Resource = null;
            switch (workInProgress.tag) {
              case HostHoistable: {
                resource = workInProgress.memoizedState;
              }
              // 有意继续落入下一分支。
              case HostComponent:
              case HostSingleton: {
                // unwind 前再检查实例是否就绪；React 向主线程 yield 期间它可能已加载。

                // 赋给常量，让 Flow 知道 preloadInstance 不会改变绑定。
                const hostFiber = workInProgress;
                const type = hostFiber.type;
                const props = hostFiber.pendingProps;
                const isReady = resource
                  ? preloadResource(resource)
                  : preloadInstance(hostFiber.stateNode, type, props);
                if (isReady) {
                  // 数据已就绪，像从未挂起一样恢复。宿主 Fiber 已完成，不像用户组件那样需重放。
                  workInProgressSuspendedReason = NotSuspended;
                  workInProgressThrownValue = null;
                  const sibling = hostFiber.sibling;
                  if (sibling !== null) {
                    workInProgress = sibling;
                  } else {
                    const returnFiber = hostFiber.return;
                    if (returnFiber !== null) {
                      workInProgress = returnFiber;
                      completeUnitOfWork(returnFiber);
                    } else {
                      workInProgress = null;
                    }
                  }
                  break resumeOrUnwind;
                }
                break;
              }
              default: {
                // 虽会优雅失败，但语义不正确，开发模式输出警告。
                if (__DEV__) {
                  console.error(
                    'Unexpected type of fiber triggered a suspensey commit. ' +
                      'This is a bug in React.',
                  );
                }
                break;
              }
            }
            // 否则 unwind 后继续普通 work loop。
            workInProgressSuspendedReason = NotSuspended;
            workInProgressThrownValue = null;
            throwAndUnwindWorkLoop(
              root,
              unitOfWork,
              thrownValue,
              SuspendedOnInstanceAndReadyToContinue,
            );
            break;
          }
          case SuspendedOnDeprecatedThrowPromise: {
            // 旧式 throw Promise 挂起；新重放行为可能引发无限 ping 等细微问题，故维持旧语义并
            // 总是 unwind。
            workInProgressSuspendedReason = NotSuspended;
            workInProgressThrownValue = null;
            throwAndUnwindWorkLoop(
              root,
              unitOfWork,
              thrownValue,
              SuspendedOnDeprecatedThrowPromise,
            );
            break;
          }
          case SuspendedOnHydration: {
            // selective hydration：更新流入 dehydrated 树；中断当前 render 切到 hydration Lane。
            resetWorkInProgressStack();
            workInProgressRootExitStatus = RootSuspendedAtTheShell;
            break outer;
          }
          default: {
            throw new Error(
              'Unexpected SuspendedReason. This is a bug in React.',
            );
          }
        }
      }

      if (__DEV__ && ReactSharedInternals.actQueue !== null) {
        // act 特例：作用域内不查询 shouldYield，持续工作直至 render 完成。这不仅是优化；单元
        // 测试通常 mock 宿主 I/O，shouldYield 结果不可信。
        workLoopSync();
      } else if (enableThrottledScheduling) {
        workLoopConcurrent(includesNonIdleWork(lanes));
      } else {
        workLoopConcurrentByScheduler();
      }
      break;
    } catch (thrownValue) {
      handleThrow(root, thrownValue);
    }
  } while (true);
  resetContextDependencies();

  popDispatcher(prevDispatcher);
  popAsyncDispatcher(prevAsyncDispatcher);
  executionContext = prevExecutionContext;

  // 检查整棵树是否完成。
  if (workInProgress !== null) {
    // 仍有未完成工作。
    if (enableSchedulingProfiler) {
      markRenderYielded();
    }
    return RootInProgress;
  } else {
    // 整棵树已完成。
    if (enableSchedulingProfiler) {
      markRenderStopped();
    }

    // 清空指针表示已无进行中的 render。
    workInProgressRoot = null;
    workInProgressRootRenderLanes = NoLanes;

    // render phase 完成，现在可安全处理并发更新队列。
    finishQueueingConcurrentUpdates();

    // 返回最终 root 退出状态。
    return workInProgressRootExitStatus;
  }
}

/** @noinline */
/** 并发热路径：在 Scheduler 时间片内执行 unit；非 idle 工作还受 25ms React 时间片约束。 */
function workLoopConcurrent(nonIdle: boolean) {
  // render Transition/Retry 时隔帧 yield；它们阻塞新内容揭示，目的不是省 yield 开销，而是
  // 防止高频动画等主线程工作饿死 React，相当于把动画降到 30fps。Idle 工作每 5ms yield，
  // 保持动画平滑。
  if (workInProgress !== null) {
    const yieldAfter = now() + (nonIdle ? 25 : 5);
    do {
      // $FlowFixMe[incompatible-type] flow doesn't know that now() is side-effect free
      performUnitOfWork(workInProgress);
    } while (workInProgress !== null && now() < yieldAfter);
  }
}

/** @noinline */
/** 仅由 Scheduler.shouldYield 控制的并发循环变体。 */
function workLoopConcurrentByScheduler() {
  // 持续工作，直到 Scheduler 要求 yield。
  while (workInProgress !== null && !shouldYield()) {
    // $FlowFixMe[incompatible-type] flow doesn't know that shouldYield() is side-effect free
    performUnitOfWork(workInProgress);
  }
}

/** 调用 beginWork 处理一个 Fiber；有 child 则下钻，否则进入 completeUnitOfWork 回溯。 */
function performUnitOfWork(unitOfWork: Fiber): void {
  // Fiber 已 flush 的 current 状态位于 alternate；这里依赖它可避免给 WIP 增加额外字段。
  const current = unitOfWork.alternate;

  let next;
  if (enableProfilerTimer && (unitOfWork.mode & ProfileMode) !== NoMode) {
    startProfilerTimer(unitOfWork);
    if (__DEV__) {
      next = runWithFiberInDEV(
        unitOfWork,
        beginWork,
        current,
        unitOfWork,
        entangledRenderLanes,
      );
    } else {
      next = beginWork(current, unitOfWork, entangledRenderLanes);
    }
    stopProfilerTimerIfRunningAndRecordDuration(unitOfWork);
  } else {
    if (__DEV__) {
      next = runWithFiberInDEV(
        unitOfWork,
        beginWork,
        current,
        unitOfWork,
        entangledRenderLanes,
      );
    } else {
      next = beginWork(current, unitOfWork, entangledRenderLanes);
    }
  }

  unitOfWork.memoizedProps = unitOfWork.pendingProps;
  if (next === null) {
    // beginWork 未返回新工作时，完成当前 unit。
    completeUnitOfWork(unitOfWork);
  } else {
    workInProgress = next;
  }
}

/** thenable 已就绪时恢复调试栈并重放刚挂起 unit 的 begin 阶段。 */
function replaySuspendedUnitOfWork(unitOfWork: Fiber): void {
  // performUnitOfWork 的专用分支，用于重放刚挂起的 Fiber。
  let next;
  if (__DEV__) {
    next = runWithFiberInDEV(unitOfWork, replayBeginWork, unitOfWork);
  } else {
    next = replayBeginWork(unitOfWork);
  }

  unitOfWork.memoizedProps = unitOfWork.pendingProps;
  if (next === null) {
    // 重放未返回新工作时，完成当前 unit。
    completeUnitOfWork(unitOfWork);
  } else {
    workInProgress = next;
  }
}

/** 清理挂起时的 hook/context 状态，再调用 replayFunctionComponent 或普通 beginWork。 */
function replayBeginWork(unitOfWork: Fiber): null | Fiber {
  // beginWork 的专用分支，用于重放刚挂起的 Fiber。

  const current = unitOfWork.alternate;

  let next;
  const isProfilingMode =
    enableProfilerTimer && (unitOfWork.mode & ProfileMode) !== NoMode;
  if (isProfilingMode) {
    startProfilerTimer(unitOfWork);
  }
  switch (unitOfWork.tag) {
    case SimpleMemoComponent:
    case FunctionComponent: {
      // 解析 defaultProps；逻辑复制自 beginWork。
      // TODO：考虑把 switch 移入该模块，也可借机明确 use 不支持 defaultProps。
      const Component = unitOfWork.type;
      let context: any;
      if (!disableLegacyContext) {
        const unmaskedContext = getUnmaskedContext(unitOfWork, Component, true);
        context = getMaskedContext(unitOfWork, unmaskedContext);
      }
      next = replayFunctionComponent(
        current,
        unitOfWork,
        unitOfWork.pendingProps,
        Component,
        context,
        workInProgressRootRenderLanes,
      );
      break;
    }
    case ForwardRef: {
      // 解析 defaultProps；逻辑复制自 beginWork。
      // TODO：考虑把 switch 移入该模块，也可借机明确 use 不支持 defaultProps。
      const Component = unitOfWork.type.render;
      next = replayFunctionComponent(
        current,
        unitOfWork,
        unitOfWork.pendingProps,
        Component,
        unitOfWork.ref,
        workInProgressRootRenderLanes,
      );
      break;
    }
    case HostComponent: {
      // 某些宿主组件有状态（如 form action），但复用 memoized state 不值得额外代码。重用旧 Hook
      // 主要为复用未缓存 Promise；宿主挂起 Promise 均由 React 控制且必已缓存，无需处理。
      resetHooksOnUnwind(unitOfWork);
      // 即将重试 HostComponent，先把 hydration cursor 调整到该 unit；其他 Fiber 类型的
      // hydration 不依赖此定位，因此仅宿主组件需要。
      popHydrationStateOnInterruptedWork(unitOfWork);
      // 继续落入下一分支。
    }
    default: {
      // 函数组件外的类型在重放前完全重置；目前只在 reconciliation Usable 挂起时发生。Fiber
      // 恢复原状态，但不是完整 unwind，因为要复用此前协调的 Promise，故刻意不调用
      // resetSuspendedWorkLoopOnUnwind。
      unwindInterruptedWork(current, unitOfWork, workInProgressRootRenderLanes);
      unitOfWork = workInProgress = resetWorkInProgress(
        unitOfWork,
        entangledRenderLanes,
      );
      next = beginWork(current, unitOfWork, entangledRenderLanes);
      break;
    }
  }
  if (isProfilingMode) {
    stopProfilerTimerIfRunningAndRecordDuration(unitOfWork);
  }

  return next;
}

/** 把 unit 抛出值交给 throwException 捕获，再 unwind 到可处理的边界或标记 fatal root。 */
function throwAndUnwindWorkLoop(
  root: FiberRoot,
  unitOfWork: Fiber,
  thrownValue: mixed,
  suspendedReason: SuspendedReason,
) {
  // performUnitOfWork 的抛错 unwind 分支；回到普通 work loop 后继续退栈，可能显示 fallback。
  resetSuspendedWorkLoopOnUnwind(unitOfWork);

  const returnFiber = unitOfWork.return;
  try {
    // 查找并标记可处理该“异常”的最近 Suspense/Error Boundary。
    const didFatal = throwException(
      root,
      returnFiber,
      unitOfWork,
      thrownValue,
      workInProgressRootRenderLanes,
    );
    if (didFatal) {
      panicOnRootError(root, thrownValue);
      return;
    }
  } catch (error) {
    // 处理错误本身又失败，例如读取 Error Boundary.componentDidCatch 时抛错；为避免无限循环，
    // 把错误冒泡给下一父级。
    if (returnFiber !== null) {
      workInProgress = returnFiber;
      throw error;
    } else {
      panicOnRootError(root, thrownValue);
      return;
    }
  }

  if (unitOfWork.flags & Incomplete) {
    // unwind 到最近可处理边界。
    let skipSiblings;

    if (
      // hydration 与错误算法均假设树顺序 render，因此总跳过 sibling。
      getIsHydrating() ||
      suspendedReason === SuspendedOnError
    ) {
      skipSiblings = true;
      // 刻意不设置 workInProgressRootDidSkipSuspendedSiblings，避免再触发 prerender。
    } else if (
      // 判断当前是否为 prerender。
      !workInProgressRootIsPrerendering &&
      // Offscreen render 也属于推测性 render。
      !includesSomeLane(workInProgressRootRenderLanes, OffscreenLane)
    ) {
      // 非 prerender：本轮跳过 sibling，稍后另排 prerender。
      skipSiblings = true;
      workInProgressRootDidSkipSuspendedSiblings = true;

      // 因跳过 sibling，立即安排边界 retry。prerender 只在 root 被阻止 commit（即
      // RootSuspendedWithDelay）时自动安排；显示 fallback 时原 Lane 已完成，但数据流入后仍有
      // pending retry。提前开始 retry 可在数据到达前预热 sibling。
      if (
        suspendedReason === SuspendedOnData ||
        suspendedReason === SuspendedOnAction ||
        suspendedReason === SuspendedOnImmediate ||
        suspendedReason === SuspendedOnDeprecatedThrowPromise
      ) {
        const boundary = getSuspenseHandler();
        if (boundary !== null && boundary.tag === SuspenseComponent) {
          boundary.flags |= ScheduleRetry;
        }
      }
    } else {
      // 当前是 prerender，不跳过 sibling。
      skipSiblings = false;
    }

    unwindUnitOfWork(unitOfWork, skipSiblings);
  } else {
    // Fiber 虽挂起，仍刻意以不一致状态提交；已知该树会隐藏时是安全的。当前只用于 Legacy
    // Suspense，未来同步并发根也可能采用类似策略，以边 render 边 mutation 而非末尾缓冲。
    completeUnitOfWork(unitOfWork);
  }
}

/** 记录本轮 render 派生的 RetryLane，供 completeRoot 标记 entanglement。 */
export function markSpawnedRetryLane(lane: Lane): void {
  // 记录本轮 fallback 派生且之后未 ping 的 retry lanes，它们确定仍处于挂起状态。
  workInProgressSuspendedRetryLanes = mergeLanes(
    workInProgressSuspendedRetryLanes,
    lane,
  );
}

/** 没有边界可恢复时清空 WIP 栈、把 root 标为 fatal 并记录未捕获错误。 */
function panicOnRootError(root: FiberRoot, error: mixed) {
  // 无祖先可处理异常；理论上 root 应捕获所有未被边界捕获的错误。恢复路径已耗尽，属于 fatal/panic。
  workInProgressRootExitStatus = RootFatalErrored;
  logUncaughtError(root, createCapturedValueAtFiber(error, root.current));
  // root 无 sibling/parent，把 workInProgress 置 null 表示遍历结束。通常由 completeUnitOfWork
  // 或 unwindWork 完成；这里刻意不调用，故手动清空。
  // TODO：考虑调用 unwindWork 以弹出 contexts。
  workInProgress = null;
}

/** 后序执行 completeWork，冒泡 flags/lanes，转向 sibling；挂起/错误时切换 unwind。 */
function completeUnitOfWork(unitOfWork: Fiber): void {
  // 尝试完成当前 unit，再转下一个 sibling；无 sibling 时返回父 Fiber。
  let completedWork: Fiber = unitOfWork;
  do {
    if ((completedWork.flags & Incomplete) !== NoFlags) {
      // 某 child 未完成导致当前 Fiber 不完整，切换到 unwind。“unwind”与“complete”交错，是
      // 因为节点挂起后仍会 render sibling，尽管它们最终可能被 fallback 替换。
      const skipSiblings = workInProgressRootDidSkipSuspendedSiblings;
      unwindUnitOfWork(completedWork, skipSiblings);
      return;
    }

    // Fiber 已 flush 的 current 状态位于 alternate；此处依赖它可避免 WIP 增加字段。
    const current = completedWork.alternate;
    const returnFiber = completedWork.return;

    let next;
    startProfilerTimer(completedWork);
    if (__DEV__) {
      next = runWithFiberInDEV(
        completedWork,
        completeWork,
        current,
        completedWork,
        entangledRenderLanes,
      );
    } else {
      next = completeWork(current, completedWork, entangledRenderLanes);
    }
    if (enableProfilerTimer && (completedWork.mode & ProfileMode) !== NoMode) {
      // 未抛错时更新 render duration。
      stopProfilerTimerIfRunningAndRecordIncompleteDuration(completedWork);
    }
    if (next !== null) {
      // completeWork 派生了新工作，下一步处理它。
      workInProgress = next;
      return;
    }

    const siblingFiber = completedWork.sibling;
    if (siblingFiber !== null) {
      // returnFiber 仍有新工作时优先处理。
      workInProgress = siblingFiber;
      return;
    }
    // 否则返回父 Fiber。
    // $FlowFixMe[incompatible-type] we bail out when we get a null
    completedWork = returnFiber;
    // 先更新 workInProgress，确保后续抛错可正确归因。
    workInProgress = completedWork;
  } while (completedWork !== null);

  // 已回溯到 root。
  if (workInProgressRootExitStatus === RootInProgress) {
    workInProgressRootExitStatus = RootCompleted;
  }
}

/** 从异常 unit 向上执行 unwindWork，并按 capture 结果重入边界或结束 root。 */
function unwindUnitOfWork(unitOfWork: Fiber, skipSiblings: boolean): void {
  let incompleteWork: Fiber = unitOfWork;
  do {
    // Fiber 已 flush 的 current 状态位于 alternate；此处依赖它可避免 WIP 增加字段。
    const current = incompleteWork.alternate;

    // Fiber 因抛出而未完成；不进 complete phase，直接弹栈；若为边界则尽可能捕获。
    const next = unwindWork(current, incompleteWork, entangledRenderLanes);

    // Fiber 未完成，不重置其 lanes。

    if (next !== null) {
      // 找到可处理异常的边界，重新进入 begin phase 并回到普通 work loop。因要重启，清除
      // 非宿主 effect 标志。
      next.flags &= HostEffectMask;
      workInProgress = next;
      return;
    }

    // 持续 unwind，直到边界或 root。

    if (enableProfilerTimer && (incompleteWork.mode & ProfileMode) !== NoMode) {
      // 记录抛错 Fiber 的 render duration。
      stopProfilerTimerIfRunningAndRecordIncompleteDuration(incompleteWork);

      // 继续前把失败 child 的耗时计入父级。
      let actualDuration = incompleteWork.actualDuration;
      let child = incompleteWork.child;
      while (child !== null) {
        // $FlowFixMe[unsafe-addition] addition with possible null/undefined value
        actualDuration += child.actualDuration;
        child = child.sibling;
      }
      incompleteWork.actualDuration = actualDuration;
    }

    // TODO：停止 prerender sibling 后，可在 unwind 时重置节点自身而非父级，省一次 null 检查。
    const returnFiber = incompleteWork.return;
    if (returnFiber !== null) {
      // 标记父 Fiber incomplete 并清除 subtree flags。
      // TODO：停止 prerender sibling 后，unwind 会同步到最近边界，可能可移除 Incomplete 标志。
      returnFiber.flags |= Incomplete;
      returnFiber.subtreeFlags = NoFlags;
      returnFiber.deletions = null;
    }

    if (!skipSiblings) {
      const siblingFiber = incompleteWork.sibling;
      if (siblingFiber !== null) {
        // 该分支会回到普通 work loop。
        workInProgress = siblingFiber;
        return;
      }
    }

    // 否则返回父 Fiber。
    // $FlowFixMe[incompatible-type] we bail out when we get a null
    incompleteWork = returnFiber;
    // 先更新 workInProgress，确保后续抛错可正确归因。
    workInProgress = incompleteWork;
  } while (incompleteWork !== null);

  // 已一路 unwind 到 root。
  workInProgressRootExitStatus = RootSuspendedAtTheShell;
  workInProgress = null;
}

/**
 * 将 finishedWork/lanes 写入 root，取消旧 timeout，决定 synchronous commit 或调度 callback，
 * 并把 spawned Lane、recoverable errors 与 Transition 信息交给 commitRoot。
 */
function completeRoot(
  root: FiberRoot,
  finishedWork: null | Fiber,
  lanes: Lanes,
  recoverableErrors: null | Array<CapturedValue<mixed>>,
  transitions: Array<Transition> | null,
  didIncludeRenderPhaseUpdate: boolean,
  spawnedLane: Lane,
  updatedLanes: Lanes,
  suspendedRetryLanes: Lanes,
  didSkipSuspendedSiblings: boolean,
  exitStatus: RootExitStatus,
  suspendedState: null | SuspendedState,
  suspendedCommitReason: SuspendedCommitReason, // 仅用于性能分析。
  completedRenderStartTime: number, // 仅用于性能分析。
  completedRenderEndTime: number, // 仅用于性能分析。
): void {
  root.cancelPendingCommit = null;

  do {
    // flushPassiveEffects 末尾会 flush 同步更新，可能产生更多 passive effects；循环直到无待办。
    // TODO：若 passive flush 不自动执行同步工作，可避免这种拆分隐患。
    flushPendingEffects();
  } while (pendingEffectsStatus !== NO_PENDING_EFFECTS);
  flushRenderPhaseStrictModeWarningsInDEV();

  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    throw new Error('Should not already be working.');
  }

  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    // commit 时记录上一 render phase，表示它未被打断。
    setCurrentTrackFromLanes(lanes);
    if (isGestureRender(lanes)) {
      // 若该 Lane 已提交过其他内容（如同树上一版本），夹紧 render 起点。
      if (completedRenderStartTime < gestureClampTime) {
        completedRenderStartTime = gestureClampTime;
      }
      if (completedRenderEndTime < gestureClampTime) {
        completedRenderEndTime = gestureClampTime;
      }
    }
    if (exitStatus === RootErrored) {
      logErroredRenderPhase(
        completedRenderStartTime,
        completedRenderEndTime,
        lanes,
        workInProgressUpdateTask,
      );
    } else if (recoverableErrors !== null) {
      const hydrationFailed =
        finishedWork !== null &&
        finishedWork.alternate !== null &&
        (finishedWork.alternate.memoizedState as RootState).isDehydrated &&
        (finishedWork.flags & ForceClientRender) !== NoFlags;
      logRecoveredRenderPhase(
        completedRenderStartTime,
        completedRenderEndTime,
        lanes,
        recoverableErrors,
        hydrationFailed,
        workInProgressUpdateTask,
      );
    } else {
      logRenderPhase(
        completedRenderStartTime,
        completedRenderEndTime,
        lanes,
        workInProgressUpdateTask,
      );
    }
  }

  if (enableSchedulingProfiler) {
    markCommitStarted(lanes);
  }

  if (finishedWork === null) {
    if (enableSchedulingProfiler) {
      markCommitStopped();
    }
    if (enableGestureTransition) {
      // 停止已提交的 gesture。
      if (isGestureRender(lanes)) {
        stopCommittedGesture(root);
      }
    }
    return;
  } else {
    if (__DEV__) {
      if (lanes === NoLanes) {
        console.error(
          'finishedLanes should not be empty during a commit. This is a ' +
            'bug in React.',
        );
      }
    }
  }

  if (finishedWork === root.current) {
    throw new Error(
      'Cannot commit the same tree as before. This error is likely caused by ' +
        'a bug in React. Please file an issue.',
    );
  }

  if (root === workInProgressRoot) {
    // 对应工作已完成，可重置这些状态。
    workInProgressRoot = null;
    workInProgress = null;
    workInProgressRootRenderLanes = NoLanes;
  } else {
    // 上次工作的 root 与当前 commit root 不同，最常见于挂起 root timeout。
  }

  // workInProgress* 可能被覆盖，因此保存到 pending* 直到处理；commit 被 setTimeout 节流时，
  // 前次 render 与提交之间 WIP 状态可能已变化，所以由 completeRoot 参数显式传入。
  pendingFinishedWork = finishedWork;
  pendingEffectsRoot = root;
  pendingEffectsLanes = lanes;
  pendingPassiveTransitions = transitions;
  pendingRecoverableErrors = recoverableErrors;
  pendingDidIncludeRenderPhaseUpdate = didIncludeRenderPhaseUpdate;
  if (enableProfilerTimer) {
    pendingEffectsRenderEndTime = completedRenderEndTime;
    pendingSuspendedCommitReason = suspendedCommitReason;
    pendingDelayedCommitReason = IMMEDIATE_COMMIT;
    pendingSuspendedViewTransitionReason = null;
  }

  if (enableGestureTransition && isGestureRender(lanes)) {
    const committingGesture = root.pendingGestures;
    if (committingGesture !== null && !committingGesture.committing) {
      // gesture 尚不可提交；标记挂起并启动不算副作用的 gesture transition，稍后再回来真正
      // commit root。
      const didAttemptEntireTree = !didSkipSuspendedSiblings;
      markRootSuspended(root, lanes, spawnedLane, didAttemptEntireTree);
      if (committingGesture.running === null) {
        applyGestureOnRoot(
          root,
          finishedWork,
          recoverableErrors,
          suspendedState,
          enableProfilerTimer
            ? suspendedCommitReason === null
              ? completedRenderEndTime
              : commitStartTime
            : 0,
        );
      } else {
        // 已有 gesture 运行时，即使有新树也不原地更新；等待到可 commit。
        if (enableProfilerTimer && enableComponentPerformanceTrack) {
          // 本次不会完成剩余 commit/apply，把时间夹到 render 结束点。
          finalizeRender(lanes, completedRenderEndTime);
        }
        // 当前不再处于 commit。
        pendingEffectsRoot = null as any; // 清除引用以便 GC。
        pendingFinishedWork = null as any; // 清除引用以便 GC。
        pendingEffectsLanes = NoLanes;
      }
      // 安排 gesture 完成后提交 root。
      root.cancelPendingCommit = scheduleGestureCommit(
        committingGesture,
        completeRoot.bind(
          null,
          root,
          finishedWork,
          lanes,
          recoverableErrors,
          transitions,
          didIncludeRenderPhaseUpdate,
          spawnedLane,
          updatedLanes,
          suspendedRetryLanes,
          didSkipSuspendedSiblings,
          exitStatus,
          suspendedState,
          'Waiting for the Gesture to finish' /* suspendedCommitReason */,
          completedRenderStartTime,
          completedRenderEndTime,
        ),
      );
      return;
    }
  }

  // 未启动 gesture 时，现在真正提交 root。
  commitRoot(
    root,
    finishedWork,
    lanes,
    spawnedLane,
    updatedLanes,
    suspendedRetryLanes,
    suspendedState,
    suspendedCommitReason,
    completedRenderEndTime,
  );
}

/**
 * root 提交协调器：先 flush 前序 passive effects，准备 before-mutation/资源等待/宿主
 * ViewTransition，再驱动 mutation→layout→spawned→passive 状态机。
 */
function commitRoot(
  root: FiberRoot,
  finishedWork: Fiber,
  lanes: Lanes,
  spawnedLane: Lane,
  updatedLanes: Lanes,
  suspendedRetryLanes: Lanes,
  suspendedState: null | SuspendedState,
  suspendedCommitReason: SuspendedCommitReason, // 仅用于性能分析。
  completedRenderEndTime: number, // 仅用于性能分析。
) {
  // 找出已无工作调度的 lanes 并标记 finished。
  let remainingLanes = mergeLanes(finishedWork.lanes, finishedWork.childLanes);

  pendingEffectsRemainingLanes = remainingLanes;

  // render phase 中由并发事件更新的 lanes 仍有工作，不可标记 finished。
  const concurrentlyUpdatedLanes = getConcurrentlyUpdatedLanes();
  remainingLanes = mergeLanes(remainingLanes, concurrentlyUpdatedLanes);

  if (enableGestureTransition && root.pendingGestures === null) {
    // gesture 活跃时不清 Lane，但可能已不再 render；新 gesture 到来前不要继续安排 GestureLane。
    if (enableProfilerTimer && (remainingLanes & GestureLane) !== NoLanes) {
      // 清除已调度 updater，让未来更新能作为下一 render 的原因。
      clearGestureUpdates();
    }
    remainingLanes &= ~GestureLane;
  }

  markRootFinished(
    root,
    lanes,
    remainingLanes,
    spawnedLane,
    updatedLanes,
    suspendedRetryLanes,
  );

  // 触发副作用前重置，以检测其中的递归更新。
  didIncludeCommitPhaseUpdate = false;

  // 若有 passive effects，尽早安排 callback，使其排在 commit phase 可能产生的其他任务之前
  //（见 #16714）。TODO：删除其他重复安排 passive callback 的位置。
  let passiveSubtreeMask;
  if (enableViewTransition) {
    pendingViewTransitionEvents = null;
    if (includesOnlyViewTransitionEligibleLanes(lanes)) {
      // 领取本次 commit 的 pending Transition Types。
      pendingTransitionTypes = claimQueuedTransitionTypes(root);
      passiveSubtreeMask = PassiveTransitionMask;
    } else {
      pendingTransitionTypes = null;
      passiveSubtreeMask = PassiveMask;
    }
  } else {
    passiveSubtreeMask = PassiveMask;
  }
  if (
    // 子树本次以 profiling 模式 render 时必须访问并记录。
    (enableProfilerTimer &&
      enableComponentPerformanceTrack &&
      finishedWork.actualDuration !== 0) ||
    (finishedWork.subtreeFlags & passiveSubtreeMask) !== NoFlags ||
    (finishedWork.flags & passiveSubtreeMask) !== NoFlags
  ) {
    if (enableYieldingBeforePassive) {
      // 不单独安排 passive flush 任务，依赖下方 ensureRootIsScheduled 安排 callback。
    } else {
      // 先清除现有 callback 信息，允许安排新 callback。
      root.callbackNode = null;
      root.callbackPriority = NoLane;
      scheduleCallback(NormalSchedulerPriority, () => {
        if (enableProfilerTimer && enableComponentPerformanceTrack) {
          // 若当前有执行中的事件，保存它以便性能事件日志忽略自身。
          trackSchedulerEvent();
        }
        if (pendingDelayedCommitReason === IMMEDIATE_COMMIT) {
          pendingDelayedCommitReason = DELAYED_PASSIVE_COMMIT;
        }
        flushPassiveEffects();
        // 本轮产生 passive effects：等它们执行后再释放 root cache pool，避免提前释放仍被
        // HostRoot/Cache boundary 等节点引用的缓存。
        return null;
      });
    }
  } else {
    // 无 passive effects 即无更多工作，可立即清除 callback。
    root.callbackNode = null;
    root.callbackPriority = NoLane;
  }

  if (enableProfilerTimer) {
    // 为本 batch 所有 Profiler 共享同一 commit 时间，便于后续分组。
    resetCommitErrors();
    recordCommitTime();
    if (enableComponentPerformanceTrack) {
      if (suspendedCommitReason !== null) {
        logSuspendedCommitPhase(
          completedRenderEndTime,
          commitStartTime,
          suspendedCommitReason,
          workInProgressUpdateTask,
        );
      }
    }
  }

  resetShouldStartViewTransition();

  // commit 被拆成多个子阶段，每阶段独立遍历 effect：全部 mutation 先于全部 layout，依此类推。

  // 检查整树是否有 effect。TODO：这是旧 effect list 为满足 Flow 检查 firstEffect 的遗留；
  // 除 profiling 外或已无意义，重新评估是否需要。
  const subtreeHasBeforeMutationEffects =
    (finishedWork.subtreeFlags & (BeforeMutationMask | MutationMask)) !==
    NoFlags;
  const rootHasBeforeMutationEffect =
    (finishedWork.flags & (BeforeMutationMask | MutationMask)) !== NoFlags;

  if (subtreeHasBeforeMutationEffects || rootHasBeforeMutationEffect) {
    const prevTransition = ReactSharedInternals.T;
    ReactSharedInternals.T = null;
    const previousPriority = getCurrentUpdatePriority();
    setCurrentUpdatePriority(DiscreteEventPriority);
    const prevExecutionContext = executionContext;
    executionContext |= CommitContext;
    try {
      // 第一阶段 before-mutation 在修改前读取宿主树，getSnapshotBeforeUpdate 在此调用。
      commitBeforeMutationEffects(root, finishedWork, lanes);
    } finally {
      // 恢复此前非同步优先级。
      executionContext = prevExecutionContext;
      setCurrentUpdatePriority(previousPriority);
      ReactSharedInternals.T = prevTransition;
    }
  }

  if (enableGestureTransition) {
    // 停止已提交的 gesture。
    if (isGestureRender(lanes)) {
      stopCommittedGesture(root);
      // 此处 shouldStartViewTransition 应始终为 false：gesture commit 自身不属于可启动宿主
      // ViewTransition 的 Lane，只有后续 Transition commit 能触发动画。
    }
  }

  pendingEffectsStatus = PENDING_MUTATION_PHASE;
  if (enableViewTransition && shouldStartViewTransition) {
    if (enableProfilerTimer && enableComponentPerformanceTrack) {
      startAnimating(lanes);
    }
    pendingViewTransition = startViewTransition(
      suspendedState,
      root.containerInfo,
      pendingTransitionTypes,
      flushMutationEffects,
      flushLayoutEffects,
      flushAfterMutationEffects,
      flushSpawnedWork,
      flushPassiveEffects,
      reportViewTransitionError,
      enableProfilerTimer ? suspendedViewTransition : (null as any),
      enableProfilerTimer
        ? // 该回调晚于 pendingEffects 触发，因此现在就要捕获参数快照。
          finishedViewTransition.bind(null, lanes)
        : (null as any),
    );
  } else {
    // 同步 flush。
    flushMutationEffects();
    flushLayoutEffects();
    // 强制提前 flush 时跳过 after-mutation。
    flushSpawnedWork();
  }
}

/** 将宿主 ViewTransition callback/ready/finished 错误以可恢复错误上报。 */
function reportViewTransitionError(error: mixed) {
  // 上报准备 ViewTransition 时发生的错误。
  if (pendingEffectsStatus === NO_PENDING_EFFECTS) {
    return;
  }
  const root = pendingEffectsRoot;
  const onRecoverableError = root.onRecoverableError;
  onRecoverableError(error, makeErrorInfo(null));
}

/** 标记 ViewTransition 启动等待原因，并在性能轨道记录等待起点。 */
function suspendedViewTransition(reason: string): void {
  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    // commit 中途挂起，因此拆成两个阶段。
    recordCommitEndTime();
    logCommitPhase(
      pendingSuspendedCommitReason === null
        ? pendingEffectsRenderEndTime
        : commitStartTime,
      commitEndTime,
      commitErrors,
      pendingDelayedCommitReason === ABORTED_VIEW_TRANSITION_COMMIT,
      workInProgressUpdateTask, // TODO：改用 ViewTransition Task；此阶段读取当前值并不安全。
    );
    pendingSuspendedViewTransitionReason = reason;
    pendingSuspendedCommitReason = reason;
  }
}

/** 宿主 ViewTransition 完成后记录动画区间、清理 root 动画 lanes 并继续 pending effects。 */
function finishedViewTransition(lanes: Lanes): void {
  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    if ((animatingLanes & lanes) === NoLanes) {
      // 已被其他动作或其他 root 停止。
      return;
    }
    const task = animatingTask;
    stopAnimating(lanes);
    // 受影响轨道若未在 render/commit，从上一 render 完成点记录到动画结束。
    if (
      isGestureRender(lanes) &&
      !isGestureRender(workInProgressRootRenderLanes) &&
      !isGestureRender(pendingEffectsLanes)
    ) {
      setCurrentTrackFromLanes(GestureLane);
      logAnimatingPhase(gestureClampTime, now(), task);
    }
    if (
      includesTransitionLane(lanes) &&
      !includesTransitionLane(workInProgressRootRenderLanes) &&
      !includesTransitionLane(pendingEffectsLanes)
    ) {
      setCurrentTrackFromLanes(SomeTransitionLane);
      logAnimatingPhase(transitionClampTime, now(), task);
    }
    if (
      includesRetryLane(lanes) &&
      !includesRetryLane(workInProgressRootRenderLanes) &&
      !includesRetryLane(pendingEffectsLanes)
    ) {
      setCurrentTrackFromLanes(SomeRetryLane);
      logAnimatingPhase(retryClampTime, now(), task);
    }
    if (
      includesIdleGroupLanes(lanes) &&
      !includesIdleGroupLanes(workInProgressRootRenderLanes) &&
      !includesIdleGroupLanes(pendingEffectsLanes)
    ) {
      setCurrentTrackFromLanes(IdleLane);
      logAnimatingPhase(idleClampTime, now(), task);
    }
  }
}

/** 执行 pending root 的 after-mutation 阶段，并推进状态到 spawned work。 */
function flushAfterMutationEffects(): void {
  if (pendingEffectsStatus !== PENDING_AFTER_MUTATION_PHASE) {
    return;
  }
  pendingEffectsStatus = NO_PENDING_EFFECTS;
  const root = pendingEffectsRoot;
  const finishedWork = pendingFinishedWork;
  const lanes = pendingEffectsLanes;
  commitAfterMutationEffects(root, finishedWork, lanes);
  pendingEffectsStatus = PENDING_SPAWNED_WORK;
}

/** 执行 root mutation effects、切换 current 树，再推进到 layout 阶段。 */
function flushMutationEffects(): void {
  if (pendingEffectsStatus !== PENDING_MUTATION_PHASE) {
    return;
  }
  pendingEffectsStatus = NO_PENDING_EFFECTS;

  const root = pendingEffectsRoot;
  const finishedWork = pendingFinishedWork;
  const lanes = pendingEffectsLanes;
  const subtreeMutationHasEffects =
    (finishedWork.subtreeFlags & MutationMask) !== NoFlags;
  const rootMutationHasEffect = (finishedWork.flags & MutationMask) !== NoFlags;

  if (subtreeMutationHasEffects || rootMutationHasEffect) {
    const prevTransition = ReactSharedInternals.T;
    ReactSharedInternals.T = null;
    const previousPriority = getCurrentUpdatePriority();
    setCurrentUpdatePriority(DiscreteEventPriority);
    const prevExecutionContext = executionContext;
    executionContext |= CommitContext;
    try {
      // 下一阶段 mutation：修改宿主树。
      commitMutationEffects(root, finishedWork, lanes);

      if (enableCreateEventHandleAPI) {
        if (shouldFireAfterActiveInstanceBlur) {
          afterActiveInstanceBlur();
        }
      }
      resetAfterCommit(root.containerInfo);
    } finally {
      // 恢复此前非同步优先级。
      executionContext = prevExecutionContext;
      setCurrentUpdatePriority(previousPriority);
      ReactSharedInternals.T = prevTransition;
    }
  }

  // WIP 现切为 current。必须晚于 mutation，使 componentWillUnmount 期间旧树仍为 current；
  // 又必须早于 layout，使 componentDidMount/Update 看到完成树为 current。
  root.current = finishedWork;
  pendingEffectsStatus = PENDING_LAYOUT_PHASE;
}

/** 执行 layout effects 与宿主重置，记录性能信息，再推进 after-mutation/spawned。 */
function flushLayoutEffects(): void {
  if (pendingEffectsStatus !== PENDING_LAYOUT_PHASE) {
    return;
  }
  pendingEffectsStatus = NO_PENDING_EFFECTS;

  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    const suspendedViewTransitionReason = pendingSuspendedViewTransitionReason;
    if (suspendedViewTransitionReason !== null) {
      // ViewTransition 使 commit 中途挂起，现在开启新的 commit 性能轨道。
      recordCommitTime();
      logSuspendedViewTransitionPhase(
        commitEndTime, // 起点是第一段 commit 的终点。
        commitStartTime, // 终点是第二段 commit 的起点。
        suspendedViewTransitionReason,
        animatingTask,
      );
    }
  }

  const root = pendingEffectsRoot;
  const finishedWork = pendingFinishedWork;
  const lanes = pendingEffectsLanes;

  if (enableDefaultTransitionIndicator) {
    const cleanUpIndicator = root.pendingIndicator;
    if (cleanUpIndicator !== null && root.indicatorLanes === NoLanes) {
      // 依赖默认 indicator 的 Transition 均已提交，可运行清理。放在 layout 阶段，使语义等同
      // useLayoutEffect 或 useOptimistic 自动重置。
      const prevTransition = ReactSharedInternals.T;
      ReactSharedInternals.T = null;
      const previousPriority = getCurrentUpdatePriority();
      setCurrentUpdatePriority(DiscreteEventPriority);
      const prevExecutionContext = executionContext;
      executionContext |= CommitContext;
      root.pendingIndicator = null;
      try {
        cleanUpIndicator();
      } catch (x) {
        reportGlobalError(x);
      } finally {
        // 恢复此前非同步优先级。
        executionContext = prevExecutionContext;
        setCurrentUpdatePriority(previousPriority);
        ReactSharedInternals.T = prevTransition;
      }
    }
  }

  const subtreeHasLayoutEffects =
    (finishedWork.subtreeFlags & LayoutMask) !== NoFlags;
  const rootHasLayoutEffect = (finishedWork.flags & LayoutMask) !== NoFlags;

  if (subtreeHasLayoutEffects || rootHasLayoutEffect) {
    const prevTransition = ReactSharedInternals.T;
    ReactSharedInternals.T = null;
    const previousPriority = getCurrentUpdatePriority();
    setCurrentUpdatePriority(DiscreteEventPriority);
    const prevExecutionContext = executionContext;
    executionContext |= CommitContext;
    try {
      // 下一阶段 layout：调用读取 mutation 后宿主树的 effect；典型用途是布局，Class 生命周期
      // 因历史兼容也在此触发。
      if (enableSchedulingProfiler) {
        markLayoutEffectsStarted(lanes);
      }
      commitLayoutEffects(finishedWork, root, lanes);
      if (enableSchedulingProfiler) {
        markLayoutEffectsStopped();
      }
    } finally {
      // 恢复此前非同步优先级。
      executionContext = prevExecutionContext;
      setCurrentUpdatePriority(previousPriority);
      ReactSharedInternals.T = prevTransition;
    }
  }

  const completedRenderEndTime = pendingEffectsRenderEndTime;
  const suspendedCommitReason = pendingSuspendedCommitReason;

  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    recordCommitEndTime();
    logCommitPhase(
      suspendedCommitReason === null ? completedRenderEndTime : commitStartTime,
      commitEndTime,
      commitErrors,
      pendingDelayedCommitReason === ABORTED_VIEW_TRANSITION_COMMIT,
      workInProgressUpdateTask,
    );
  }

  pendingEffectsStatus = PENDING_AFTER_MUTATION_PHASE;
}

/** 提交后处理派生同步任务、Transition callbacks、recoverable errors 与 passive 调度。 */
function flushSpawnedWork(): void {
  if (
    pendingEffectsStatus !== PENDING_SPAWNED_WORK &&
    // startViewTransition timeout 时可能提前 flush；此时跳过 after-mutation 阶段。
    pendingEffectsStatus !== PENDING_AFTER_MUTATION_PHASE
  ) {
    return;
  }
  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    // 未跳过 after-mutation 表示已启动动画。
    const startedAnimation = pendingEffectsStatus === PENDING_SPAWNED_WORK;
    if (startedAnimation) {
      const startViewTransitionStartTime = commitEndTime;
      // 把 commitEndTime 更新为动画启动时刻。
      recordCommitEndTime();
      logStartViewTransitionYieldPhase(
        startViewTransitionStartTime,
        commitEndTime,
        pendingDelayedCommitReason === ABORTED_VIEW_TRANSITION_COMMIT,
        animatingTask,
      );
      if (pendingDelayedCommitReason !== ABORTED_VIEW_TRANSITION_COMMIT) {
        pendingDelayedCommitReason = ANIMATION_STARTED_COMMIT;
      }
    }
  }

  pendingEffectsStatus = NO_PENDING_EFFECTS;

  const committedViewTransition = pendingViewTransition;
  pendingViewTransition = null; // View Transition 此时已经完全启动。

  // 通知 Scheduler 在帧末 yield，让浏览器有机会 paint。
  requestPaint();

  const root = pendingEffectsRoot;
  const finishedWork = pendingFinishedWork;
  const lanes = pendingEffectsLanes;
  const recoverableErrors = pendingRecoverableErrors;
  const didIncludeRenderPhaseUpdate = pendingDidIncludeRenderPhaseUpdate;

  const passiveSubtreeMask =
    enableViewTransition && includesOnlyViewTransitionEligibleLanes(lanes)
      ? PassiveTransitionMask
      : PassiveMask;
  const rootDidHavePassiveEffects = // 若子树本次以 profiling 模式 render，仍需遍历并记录。
    (enableProfilerTimer &&
      enableComponentPerformanceTrack &&
      finishedWork.actualDuration !== 0) ||
    (finishedWork.subtreeFlags & passiveSubtreeMask) !== NoFlags ||
    (finishedWork.flags & passiveSubtreeMask) !== NoFlags;

  if (rootDidHavePassiveEffects) {
    pendingEffectsStatus = PENDING_PASSIVE_PHASE;
  } else {
    pendingEffectsStatus = NO_PENDING_EFFECTS;
    pendingEffectsRoot = null as any; // 清除引用以便 GC。
    pendingFinishedWork = null as any; // 清除引用以便 GC。
    // 无 passive effects，可立即释放本轮 render 的 cache pool。
    releaseRootPooledCache(root, root.pendingLanes);
    if (__DEV__) {
      nestedPassiveUpdateCount = 0;
      rootWithPassiveNestedUpdates = null;
    }
  }

  // effect 可能更新该值，重新读取。
  let remainingLanes = root.pendingLanes;

  // 检查 root 是否还有工作。TODO：这是 componentDidCatch 对内部 setState 的兼容检测，本身
  // 有缺陷（因此推荐 getDerivedStateFromError）。可改为只检查 remainingLanes 是否含 Sync，
  // 而非把 Suspense retry/Transition 等任意剩余工作都算入；历史已久，优先级不高。
  if (remainingLanes === NoLanes) {
    // 无剩余工作时清空“已失败 Error Boundary”集合。
    legacyErrorBoundariesThatAlreadyFailed = null;
  }

  if (__DEV__) {
    if (!rootDidHavePassiveEffects) {
      commitDoubleInvokeEffectsInDEV(root, false);
    }
  }

  const renderPriority = lanesToEventPriority(lanes);
  onCommitRootDevTools(finishedWork.stateNode, renderPriority);

  if (enableUpdaterTracking) {
    if (isDevToolsPresent) {
      root.memoizedUpdaters.clear();
    }
  }

  if (__DEV__) {
    onCommitRootTestSelector();
  }

  if (recoverableErrors !== null) {
    const prevTransition = ReactSharedInternals.T;
    const previousUpdateLanePriority = getCurrentUpdatePriority();
    setCurrentUpdatePriority(DiscreteEventPriority);
    ReactSharedInternals.T = null;
    try {
      // 本轮错误已恢复且未暴露到 UI，在此统一记录。
      const onRecoverableError = root.onRecoverableError;
      for (let i = 0; i < recoverableErrors.length; i++) {
        const recoverableError = recoverableErrors[i];
        const errorInfo = makeErrorInfo(recoverableError.stack);
        if (__DEV__) {
          runWithFiberInDEV(
            recoverableError.source,
            onRecoverableError,
            recoverableError.value,
            errorInfo,
          );
        } else {
          onRecoverableError(recoverableError.value, errorInfo);
        }
      }
    } finally {
      ReactSharedInternals.T = prevTransition;
      setCurrentUpdatePriority(previousUpdateLanePriority);
    }
  }

  if (enableViewTransition) {
    // 此时已越过 startViewTransition.ready，可开始伪元素动画。要在 passive effects/派生同步
    // 工作前执行，因为它仍属于上一 commit；概念上则像 layout 与 passive 之间的独立任务。
    const pendingEvents = pendingViewTransitionEvents;
    let pendingTypes = pendingTransitionTypes;
    pendingTransitionTypes = null;
    if (pendingEvents !== null) {
      pendingViewTransitionEvents = null;
      if (pendingTypes === null) {
        // 规范化 types；该数组只在存在事件时惰性创建。
        pendingTypes = [];
      }
      if (committedViewTransition !== null) {
        for (let i = 0; i < pendingEvents.length; i++) {
          const viewTransitionEvent = pendingEvents[i];
          const cleanup = viewTransitionEvent(pendingTypes);
          if (cleanup !== undefined) {
            addViewTransitionFinishedListener(committedViewTransition, cleanup);
          }
        }
      }
    }
  }

  // 离散 render 产生的 passive effects 在当前任务末尾同步 flush，使结果立即可观察；其他
  // passive effects 视为无顺序依赖，可等 paint 后执行。
  // TODO：合并多处 callback 调度后，可避免此前先安排再同步 flush 的浪费。
  if (
    includesSyncLane(pendingEffectsLanes) &&
    (disableLegacyMode || root.tag !== LegacyRoot)
  ) {
    flushPendingEffects();
  }

  // completeRoot 退出前总调用，确保 root 新增工作已调度。
  ensureRootIsScheduled(root);

  // passive effect 可能更新该值，重新读取。
  remainingLanes = root.pendingLanes;

  // 检查本轮是否安排级联同步更新，作为无限循环启发式；刻意排除 hydration lanes，因为
  // selective hydration 触发的 render 概念上不是 update。
  if (
    // 完成 render 是否来自真实 update（非 hydration）？
    includesSomeLane(lanes, UpdateLanes) &&
    // 它是否又安排同步更新？
    includesSomeLane(remainingLanes, SyncUpdateLanes)
  ) {
    if (enableProfilerTimer && enableProfilerNestedUpdatePhase) {
      markNestedUpdateScheduled();
    }

    // 统计 root 未稳定结束就同步重渲染的次数；过多表示无限更新循环。
    if (root === rootWithNestedUpdates) {
      nestedUpdateCount++;
    } else {
      nestedUpdateCount = 0;
      rootWithNestedUpdates = root;
    }
    nestedUpdateKind = NESTED_UPDATE_SYNC_LANE;
  } else if (
    // 检查本轮在 render/commit phase 是否派生递归更新；仅从 remaining lanes 无法推断，故显式跟踪。
    enableInfiniteRenderLoopDetection &&
    (didIncludeRenderPhaseUpdate || didIncludeCommitPhaseUpdate)
  ) {
    if (enableProfilerTimer && enableProfilerNestedUpdatePhase) {
      markNestedUpdateScheduled();
    }

    // 统计 root 未稳定结束就同步重渲染的次数；过多表示无限更新循环。
    if (root === rootWithNestedUpdates) {
      nestedUpdateCount++;
    } else {
      nestedUpdateCount = 0;
      rootWithNestedUpdates = root;
    }
    nestedUpdateKind = NESTED_UPDATE_PHASE_SPAWN;
  } else {
    nestedUpdateCount = 0;
    rootWithNestedUpdates = null;
    nestedUpdateKind = NO_NESTED_UPDATE;
  }

  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    if (!rootDidHavePassiveEffects) {
      finalizeRender(lanes, commitEndTime);
    }
  }

  // 立即 flush 本次 commit 解锁的事件重放，确保它们早于任何新变化 render 被观察。
  // $FlowFixMe[constant-condition]
  if (supportsHydration) {
    flushHydrationEvents();
  }

  // 若安排了 layout work，现在 flush。
  flushSyncWorkOnAllRoots();

  if (enableSchedulingProfiler) {
    markCommitStopped();
  }

  if (enableTransitionTracing) {
    // Transition 在 passive effects 中处理，而 passive 可在 commit 内同步或 paint 后异步执行。
    // commit 末安排 paint 后 callback：若 Transition 已同步处理，就安排其回调；若尚无 pending
    // Transition callback，表示 passive 要到 paint 后处理，此时先保存 paint 结束时间，之后用
    // 正确 end time 处理 Transition 并调用回调。
    const prevRootTransitionCallbacks = root.transitionCallbacks;
    if (prevRootTransitionCallbacks !== null) {
      schedulePostPaintCallback(endTime => {
        const prevPendingTransitionCallbacks =
          currentPendingTransitionCallbacks;
        if (prevPendingTransitionCallbacks !== null) {
          currentPendingTransitionCallbacks = null;
          scheduleCallback(IdleSchedulerPriority, () => {
            processTransitionCallbacks(
              prevPendingTransitionCallbacks,
              endTime,
              prevRootTransitionCallbacks,
            );
          });
        } else {
          currentEndTime = endTime;
        }
      });
    }
  }
}

/** 为 gesture root render clone/ghost 树，提交 departure transition 并安排动画阶段。 */
function applyGestureOnRoot(
  root: FiberRoot,
  finishedWork: Fiber,
  recoverableErrors: null | Array<CapturedValue<mixed>>,
  suspendedState: null | SuspendedState,
  renderEndTime: number, // 仅用于性能分析。
): void {
  // 假设刚 render 的 gesture 是队首项。
  const finishedGesture = root.pendingGestures;
  if (finishedGesture === null) {
    // 该 gesture 在 render 前已取消，安排下一组 lanes。
    ensureRootIsScheduled(root);
    return;
  }

  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    startAnimating(pendingEffectsLanes);
  }

  pendingViewTransitionEvents = null;

  const prevTransition = ReactSharedInternals.T;
  ReactSharedInternals.T = null;
  const previousPriority = getCurrentUpdatePriority();
  setCurrentUpdatePriority(DiscreteEventPriority);
  const prevExecutionContext = executionContext;
  executionContext |= CommitContext;
  try {
    insertDestinationClones(root, finishedWork);
  } finally {
    // 恢复此前非同步优先级。
    executionContext = prevExecutionContext;
    setCurrentUpdatePriority(previousPriority);
    ReactSharedInternals.T = prevTransition;
  }
  pendingTransitionTypes = finishedGesture.types;
  pendingEffectsStatus = PENDING_GESTURE_MUTATION_PHASE;

  pendingViewTransition = finishedGesture.running = startGestureTransition(
    suspendedState,
    root.containerInfo,
    finishedGesture.provider,
    finishedGesture.rangeStart,
    finishedGesture.rangeEnd,
    pendingTransitionTypes,
    flushGestureMutations,
    flushGestureAnimations,
    reportViewTransitionError,
    enableProfilerTimer
      ? // 该回调晚于 pendingEffects 触发，因此现在就要捕获参数快照。
        finishedViewTransition.bind(null, pendingEffectsLanes)
      : (null as any),
  );
}

/** 提交 gesture clone 的 mutation 与 departure names，再推进 gesture animation 阶段。 */
function flushGestureMutations(): void {
  if (!enableGestureTransition) {
    return;
  }
  if (pendingEffectsStatus !== PENDING_GESTURE_MUTATION_PHASE) {
    return;
  }
  pendingEffectsStatus = NO_PENDING_EFFECTS;
  const root = pendingEffectsRoot;
  const finishedWork = pendingFinishedWork;

  const prevTransition = ReactSharedInternals.T;
  ReactSharedInternals.T = null;
  const previousPriority = getCurrentUpdatePriority();
  setCurrentUpdatePriority(DiscreteEventPriority);
  const prevExecutionContext = executionContext;
  executionContext |= CommitContext;
  try {
    applyDepartureTransitions(root, finishedWork);
  } finally {
    // 恢复此前非同步优先级。
    executionContext = prevExecutionContext;
    setCurrentUpdatePriority(previousPriority);
    ReactSharedInternals.T = prevTransition;
  }

  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    recordCommitEndTime();
    logApplyGesturePhase(
      pendingEffectsRenderEndTime,
      commitEndTime,
      animatingTask,
    );
  }

  pendingEffectsStatus = PENDING_GESTURE_ANIMATION_PHASE;
}

/** 恢复真实 transition 名称并启动/校准 gesture 动画，随后清理 pending effects。 */
function flushGestureAnimations(): void {
  if (!enableGestureTransition) {
    return;
  }
  // 若启动前被取消，mutation 可能尚未应用；先补执行。
  flushGestureMutations();
  if (pendingEffectsStatus !== PENDING_GESTURE_ANIMATION_PHASE) {
    return;
  }

  const lanes = pendingEffectsLanes;

  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    const startViewTransitionStartTime = commitEndTime;
    // 把 commitEndTime 更新为动画启动时刻。
    recordCommitEndTime();
    logStartViewTransitionYieldPhase(
      startViewTransitionStartTime,
      commitEndTime,
      pendingDelayedCommitReason === ABORTED_VIEW_TRANSITION_COMMIT,
      animatingTask,
    );
    if (pendingDelayedCommitReason !== ABORTED_VIEW_TRANSITION_COMMIT) {
      pendingDelayedCommitReason = ANIMATION_STARTED_COMMIT;
    }
  }

  pendingEffectsStatus = NO_PENDING_EFFECTS;
  const root = pendingEffectsRoot;
  const finishedWork = pendingFinishedWork;
  pendingEffectsRoot = null as any; // 清除引用以便 GC。
  pendingFinishedWork = null as any; // 清除引用以便 GC。
  pendingEffectsLanes = NoLanes;

  pendingViewTransition = null; // View Transition 此时已经完全启动。

  const prevTransition = ReactSharedInternals.T;
  ReactSharedInternals.T = null;
  const previousPriority = getCurrentUpdatePriority();
  setCurrentUpdatePriority(DiscreteEventPriority);
  const prevExecutionContext = executionContext;
  executionContext |= CommitContext;
  try {
    startGestureAnimations(root, finishedWork);
  } finally {
    // 恢复此前非同步优先级。
    executionContext = prevExecutionContext;
    setCurrentUpdatePriority(previousPriority);
    ReactSharedInternals.T = prevTransition;
  }

  if (enableViewTransition) {
    // 此时已越过 startGestureTransition.ready，可开始伪元素动画；内建动画调整也已应用，ref
    // 可读取最终状态。
    const pendingEvents = pendingViewTransitionEvents;
    let pendingTypes = pendingTransitionTypes;
    pendingTransitionTypes = null;
    if (pendingEvents !== null) {
      pendingViewTransitionEvents = null;
      if (pendingTypes === null) {
        // 规范化 types；该数组只在存在事件时惰性创建。
        pendingTypes = [];
      }
      const appliedGesture = root.pendingGestures;
      if (appliedGesture !== null) {
        const runningTransition = appliedGesture.running;
        if (runningTransition !== null) {
          for (let i = 0; i < pendingEvents.length; i++) {
            const viewTransitionEvent = pendingEvents[i];
            const cleanup = viewTransitionEvent(pendingTypes);
            if (cleanup !== undefined) {
              addViewTransitionFinishedListener(runningTransition, cleanup);
            }
          }
        }
      }
    }
  }

  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    finalizeRender(lanes, commitEndTime);
  }

  // 当前 Lane 已 render，开始下一 Lane。
  ensureRootIsScheduled(root);
}

/** 构造 onRecoverableError 的 errorInfo，并为已移除 digest 属性安装开发期访问警告。 */
function makeErrorInfo(componentStack: ?string) {
  const errorInfo = {
    componentStack,
  };
  if (__DEV__) {
    Object.defineProperty(errorInfo as any, 'digest', {
      /** 访问旧 digest 字段时提示改从 Error 实例读取。 */
      get() {
        console.error(
          'You are accessing "digest" from the errorInfo object passed to onRecoverableError.' +
            ' This property is no longer provided as part of errorInfo but can be accessed as a property' +
            ' of the Error instance itself.',
        );
      },
    });
  }
  return errorInfo;
}

/** root 剩余 lanes 不再依赖 pooled cache 时 release 并清空引用。 */
function releaseRootPooledCache(root: FiberRoot, remainingLanes: Lanes) {
  const pooledCacheLanes = (root.pooledCacheLanes &= remainingLanes);
  if (pooledCacheLanes === NoLanes) {
    // 剩余工作均不依赖 cache pool，清除后让后续请求获得新 cache。
    const pooledCache = root.pooledCache;
    if (pooledCache != null) {
      root.pooledCache = null;
      releaseCache(pooledCache);
    }
  }
}

let didWarnAboutInterruptedViewTransitions = false;

/** 标记 commit 曾因 passive 等待延迟，再 flush 全部 pending effects。 */
export function flushPendingEffectsDelayed(): boolean {
  if (pendingDelayedCommitReason === IMMEDIATE_COMMIT) {
    pendingDelayedCommitReason = DELAYED_PASSIVE_COMMIT;
  }
  return flushPendingEffects();
}

/** 按状态机顺序 flush gesture/mutation/layout/spawned/passive 全部待提交阶段。 */
export function flushPendingEffects(): boolean {
  // 返回本次是否 flush 了 passive effects。
  if (enableViewTransition && pendingViewTransition !== null) {
    // ViewTransition 完全启动前被强制 flush 时跳过它，避免运行半截动画。
    stopViewTransition(pendingViewTransition);
    if (__DEV__) {
      if (!didWarnAboutInterruptedViewTransitions) {
        didWarnAboutInterruptedViewTransitions = true;
        console.warn(
          'A flushSync update cancelled a View Transition because it was called ' +
            'while the View Transition was still preparing. To preserve the synchronous ' +
            'semantics, React had to skip the View Transition. If you can, try to avoid ' +
            "flushSync() in a scenario that's likely to interfere.",
        );
      }
    }
    pendingViewTransition = null;
    pendingDelayedCommitReason = ABORTED_VIEW_TRANSITION_COMMIT;
  }
  flushGestureMutations();
  flushGestureAnimations();
  flushMutationEffects();
  flushLayoutEffects();
  // 强制提前 flush 时跳过 after-mutation。
  flushSpawnedWork();
  return flushPassiveEffects();
}

/** 以合适事件优先级进入 passive effect flush，并恢复 Transition/优先级上下文。 */
function flushPassiveEffects(): boolean {
  if (pendingEffectsStatus !== PENDING_PASSIVE_PHASE) {
    return false;
  }
  // TODO：把 flushPassiveEffectsImpl 合并进来；过去分开是为了传给 Scheduler.runWithPriority，
  // 现在 React 内部自行跟踪优先级，可直接修改变量。先缓存 root，因为实现内会清空它。
  const root = pendingEffectsRoot;
  // 缓存并清除 remaining lanes；该方法可从多处调用，不总经过已知 remaining lanes 的
  // completeRoot，因此必须重置。
  const remainingLanes = pendingEffectsRemainingLanes;
  pendingEffectsRemainingLanes = NoLanes;

  const renderPriority = lanesToEventPriority(pendingEffectsLanes);
  const priority = lowerEventPriority(DefaultEventPriority, renderPriority);
  const prevTransition = ReactSharedInternals.T;
  const previousPriority = getCurrentUpdatePriority();

  try {
    setCurrentUpdatePriority(priority);
    ReactSharedInternals.T = null;
    return flushPassiveEffectsImpl();
  } finally {
    setCurrentUpdatePriority(previousPriority);
    ReactSharedInternals.T = prevTransition;

    // passive effects 执行后，组件已有机会 retain 所需 cache；此时可释放 root pooled cache。
    releaseRootPooledCache(root, remainingLanes);
  }
}

/** 卸载再挂载 passive effects，处理 nested updates、Profiler、错误与 root cache 释放。 */
function flushPassiveEffectsImpl() {
  // 缓存并清除 passive transitions。
  const transitions = pendingPassiveTransitions;
  pendingPassiveTransitions = null;

  const root = pendingEffectsRoot;
  const lanes = pendingEffectsLanes;
  pendingEffectsStatus = NO_PENDING_EFFECTS;
  pendingEffectsRoot = null as any; // 清除引用以便 GC。
  pendingFinishedWork = null as any; // 清除引用以便 GC。
  // TODO：该值有时与 pendingEffectsRoot 不同步；查明并修复。当前仅用于 profiling，暂无已知
  // 问题，但会给重构埋雷。
  pendingEffectsLanes = NoLanes;

  if (enableYieldingBeforePassive) {
    // 本轮 render 的全部工作完成。
    root.callbackNode = null;
    root.callbackPriority = NoLane;
  }

  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    throw new Error('Cannot flush passive effects while already rendering.');
  }

  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    // 即将写大量 commit profiling；预先计算一次，避免每条日志重复计算。
    setCurrentTrackFromLanes(lanes);
  }

  if (__DEV__) {
    isFlushingPassiveEffects = true;
    didScheduleUpdateDuringPassiveEffects = false;
  }

  let passiveEffectStartTime = 0;
  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    resetCommitErrors();
    passiveEffectStartTime = now();
    if (pendingDelayedCommitReason === ANIMATION_STARTED_COMMIT) {
      // 动画已启动，从该时刻起均记为 animating。
      logAnimatingPhase(commitEndTime, passiveEffectStartTime, animatingTask);
    } else {
      logPaintYieldPhase(
        commitEndTime,
        passiveEffectStartTime,
        pendingDelayedCommitReason === DELAYED_PASSIVE_COMMIT,
        workInProgressUpdateTask,
      );
    }
  }

  if (enableSchedulingProfiler) {
    markPassiveEffectsStarted(lanes);
  }

  const prevExecutionContext = executionContext;
  executionContext |= CommitContext;

  commitPassiveUnmountEffects(root.current);
  commitPassiveMountEffects(
    root,
    root.current,
    lanes,
    transitions,
    pendingEffectsRenderEndTime,
  );

  if (enableSchedulingProfiler) {
    markPassiveEffectsStopped();
  }

  if (__DEV__) {
    commitDoubleInvokeEffectsInDEV(root, true);
  }

  executionContext = prevExecutionContext;

  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    const passiveEffectsEndTime = now();
    logPassiveCommitPhase(
      passiveEffectStartTime,
      passiveEffectsEndTime,
      commitErrors,
      workInProgressUpdateTask,
    );
    finalizeRender(lanes, passiveEffectsEndTime);
  }

  flushSyncWorkOnAllRoots();

  if (enableTransitionTracing) {
    const prevPendingTransitionCallbacks = currentPendingTransitionCallbacks;
    const prevRootTransitionCallbacks = root.transitionCallbacks;
    const prevEndTime = currentEndTime;
    if (
      prevPendingTransitionCallbacks !== null &&
      prevRootTransitionCallbacks !== null &&
      prevEndTime !== null
    ) {
      currentPendingTransitionCallbacks = null;
      currentEndTime = null;
      scheduleCallback(IdleSchedulerPriority, () => {
        processTransitionCallbacks(
          prevPendingTransitionCallbacks,
          prevEndTime,
          prevRootTransitionCallbacks,
        );
      });
    }
  }

  if (__DEV__) {
    // passive flush 中又安排 effect 时递增计数，超限则警告。
    if (didScheduleUpdateDuringPassiveEffects) {
      if (root === rootWithPassiveNestedUpdates) {
        nestedPassiveUpdateCount++;
      } else {
        nestedPassiveUpdateCount = 0;
        rootWithPassiveNestedUpdates = root;
      }
    } else {
      nestedPassiveUpdateCount = 0;
    }
    isFlushingPassiveEffects = false;
    didScheduleUpdateDuringPassiveEffects = false;
  }

  if (enableYieldingBeforePassive) {
    // 剩余工作属于新序列，末尾再安排新任务；passive effect 可能派生更高优先级工作，延后可
    // 避免先安排一个马上被取消的 callback。
    ensureRootIsScheduled(root);
  }

  // TODO：移到 commitPassiveMountEffects。
  onPostCommitRootDevTools(root);
  if (enableProfilerTimer && enableProfilerCommitHooks) {
    const stateNode = root.current.stateNode;
    stateNode.effectDuration = 0;
    stateNode.passiveEffectDuration = 0;
  }

  return true;
}

/** 查询 Legacy Error Boundary 实例在当前批次是否已捕获失败，避免无限重试。 */
export function isAlreadyFailedLegacyErrorBoundary(instance: mixed): boolean {
  return (
    legacyErrorBoundariesThatAlreadyFailed !== null &&
    legacyErrorBoundariesThatAlreadyFailed.has(instance)
  );
}

/** 将 Legacy Error Boundary 实例记入本批次失败集合。 */
export function markLegacyErrorBoundaryAsFailed(instance: mixed) {
  if (legacyErrorBoundariesThatAlreadyFailed === null) {
    legacyErrorBoundariesThatAlreadyFailed = new Set([instance]);
  } else {
    legacyErrorBoundariesThatAlreadyFailed.add(instance);
  }
}

/** commit phase 错误到达 HostRoot 时创建 CaptureUpdate 并安排 SyncLane。 */
function captureCommitPhaseErrorOnRoot(
  rootFiber: Fiber,
  sourceFiber: Fiber,
  error: mixed,
) {
  const errorInfo = createCapturedValueAtFiber(error, sourceFiber);
  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    recordEffectError(errorInfo);
  }
  const update = createRootErrorUpdate(
    rootFiber.stateNode,
    errorInfo,
    SyncLane as Lane,
  );
  const root = enqueueUpdate(rootFiber, update, SyncLane as Lane);
  if (root !== null) {
    markRootUpdated(root, SyncLane);
    ensureRootIsScheduled(root);
  }
}

/** 从抛错 Fiber 向上寻找 Class Error Boundary 或 HostRoot，并调度捕获更新。 */
export function captureCommitPhaseError(
  sourceFiber: Fiber,
  nearestMountedAncestor: Fiber | null,
  error: mixed,
) {
  if (__DEV__) {
    setIsRunningInsertionEffect(false);
  }
  if (sourceFiber.tag === HostRoot) {
    // 错误在 root 抛出且无父级，由 root 自身捕获。
    captureCommitPhaseErrorOnRoot(sourceFiber, sourceFiber, error);
    return;
  }

  let fiber = nearestMountedAncestor;
  while (fiber !== null) {
    if (fiber.tag === HostRoot) {
      captureCommitPhaseErrorOnRoot(fiber, sourceFiber, error);
      return;
    } else if (fiber.tag === ClassComponent) {
      const ctor = fiber.type;
      const instance = fiber.stateNode;
      if (
        typeof ctor.getDerivedStateFromError === 'function' ||
        (typeof instance.componentDidCatch === 'function' &&
          !isAlreadyFailedLegacyErrorBoundary(instance))
      ) {
        const errorInfo = createCapturedValueAtFiber(error, sourceFiber);
        if (enableProfilerTimer && enableComponentPerformanceTrack) {
          recordEffectError(errorInfo);
        }
        const update = createClassErrorUpdate(SyncLane as Lane);
        const root = enqueueUpdate(fiber, update, SyncLane as Lane);
        if (root !== null) {
          initializeClassErrorUpdate(update, root, fiber, errorInfo);
          markRootUpdated(root, SyncLane);
          ensureRootIsScheduled(root);
        }
        return;
      }
    }
    fiber = fiber.return;
  }

  if (__DEV__) {
    console.error(
      'Internal React error: Attempted to capture a commit phase error ' +
        'inside a detached tree. This indicates a bug in React. Potential ' +
        'causes include deleting the same fiber more than once, committing an ' +
        'already-finished tree, or an inconsistent return pointer.\n\n' +
        'Error message:\n\n%s',
      error,
    );
  }
}

/** 按 root+lanes 为 wakeable 去重安装 ping 监听，并标记本轮已订阅。 */
export function attachPingListener(
  root: FiberRoot,
  wakeable: Wakeable,
  lanes: Lanes,
) {
  // 安装 ping listener。数据可能在 fallback commit 前 resolve，refresh 甚至不会提交 fallback；
  // 因此现在订阅，ping 后再决定是否重渲染。仅当当前 lanes（此处相当于 thread ID）尚无监听
  // 时安装；只需并发模式，Legacy Suspense 同步提交 fallback，不存在 ping 窗口。
  let pingCache = root.pingCache;
  let threadIDs;
  if (pingCache === null) {
    pingCache = root.pingCache = new PossiblyWeakMap();
    threadIDs = new Set<mixed>();
    pingCache.set(wakeable, threadIDs);
  } else {
    threadIDs = pingCache.get(wakeable);
    if (threadIDs === undefined) {
      threadIDs = new Set();
      pingCache.set(wakeable, threadIDs);
    }
  }
  if (!threadIDs.has(lanes)) {
    workInProgressRootDidAttachPingListener = true;

    // 以 thread ID（lanes）记忆，避免重复 listener。
    threadIDs.add(lanes);
    const ping = pingSuspendedRoot.bind(null, root, wakeable, lanes);
    if (enableUpdaterTracking) {
      if (isDevToolsPresent) {
        // 若仍有 pending work，恢复原 updater 集合。
        restorePendingUpdaters(root, lanes);
      }
    }
    wakeable.then(ping, ping);
  }
}

/** wakeable resolve/reject 后标记 root lanes 已 ping，重置/合并 WIP 状态并确保调度。 */
function pingSuspendedRoot(
  root: FiberRoot,
  wakeable: Wakeable,
  pingedLanes: Lanes,
) {
  const pingCache = root.pingCache;
  if (pingCache !== null) {
    // wakeable 已 resolve，不会再被抛出，无需继续记忆。
    pingCache.delete(wakeable);
  }

  markRootPinged(root, pingedLanes);

  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    startPingTimerByLanes(pingedLanes);
  }

  warnIfSuspenseResolutionNotWrappedWithActDEV(root);

  if (
    workInProgressRoot === root &&
    isSubsetOfLanes(workInProgressRootRenderLanes, pingedLanes)
  ) {
    // 当前 render 同优先级收到 ping，可能需重启；判断应与 root 完成后是否挂起一致。
    // TODO：Sync/Batched/expired 导致的同步 render 可能永不应重启；prerender 安装的 listener
    // 应与普通 listener 区分，其 ping 不应打断普通 render。

    // delayed suspend 或 retry 最终必挂起，因此总可重启。
    if (
      workInProgressRootExitStatus === RootSuspendedWithDelay ||
      (workInProgressRootExitStatus === RootSuspended &&
        includesOnlyRetries(workInProgressRootRenderLanes) &&
        now() - globalMostRecentFallbackTime < FALLBACK_THROTTLE_MS)
    ) {
      // unwind 栈以强制从 root 重启；但 render phase 内调用会崩溃，不能立即做。
      if ((executionContext & RenderContext) === NoContext) {
        prepareFreshStack(root, NoLanes);
      } else {
        // TODO：render phase 内可抛 selective hydration 使用的内部中断异常；该机制暂时回退，
        // 恢复后可复用。当前先记录 pinged lanes，防止 markRootSuspended 把它们标为挂起。
        workInProgressRootPingedLanes = mergeLanes(
          workInProgressRootPingedLanes,
          pingedLanes,
        );
      }
    } else {
      // 虽无法立即重启，稍后仍可能有机会；标记本轮已收到 ping。
      workInProgressRootPingedLanes = mergeLanes(
        workInProgressRootPingedLanes,
        pingedLanes,
      );
    }

    // WIP render 收到 ping 后，此前挂起工作可能已解除。只有 lanes 精确相同才清挂起；不精确
    // 表示 Promise 来自更旧 render。
    if (workInProgressSuspendedRetryLanes === workInProgressRootRenderLanes) {
      workInProgressSuspendedRetryLanes = NoLanes;
    }
  }

  ensureRootIsScheduled(root);
}

/** gesture provider 更新时把 root 的 GestureLane 标为 pinged 并重新调度。 */
export function pingGestureRoot(root: FiberRoot): void {
  const gesture = root.pendingGestures;
  if (gesture === null) {
    return;
  }
  // ping 该 root 以重新 render/commit。
  markRootPinged(root, GestureLane);
  ensureRootIsScheduled(root);
}

/** 停止已提交 gesture 并重新安排 GestureLane，重新构造动画目标。 */
export function restartGestureRoot(root: FiberRoot): void {
  if (
    workInProgressRoot === root &&
    isGestureRender(workInProgressRootRenderLanes)
  ) {
    // 当前 render 属于已失效 gesture，需重启。
    if ((executionContext & RenderContext) === NoContext) {
      prepareFreshStack(root, NoLanes);
    } else {
      // TODO：中断异常恢复支持后在此抛出。
    }
  } else if (
    root.cancelPendingCommit !== null &&
    isGestureRender(pendingEffectsLanes)
  ) {
    // 丢弃现有 suspended commit。
    const cancelPendingCommit = root.cancelPendingCommit;
    if (cancelPendingCommit !== null) {
      root.cancelPendingCommit = null;
      cancelPendingCommit();
    }
  }
  if (root.pendingGestures !== null) {
    // 仍有 gesture 待处理，安排重启。
    markRootPinged(root, GestureLane);
  }
  ensureRootIsScheduled(root);
}

/** 给已显示 fallback 的 Suspense/Activity 边界安排 retry lane 并冒泡到 root。 */
function retryTimedOutBoundary(boundaryFiber: Fiber, retryLane: Lane) {
  // Suspense/SuspenseList 边界此前显示 fallback；其一个 Promise 已 resolve，树至少部分解除
  // 阻塞，使用新 Lane 重试 render。
  if (retryLane === NoLane) {
    // TODO：是否写入 suspenseState.retryLane，以避免不必要 entanglement？
    retryLane = requestRetryLane(boundaryFiber);
  }
  // TODO：是否为 idle 优先级设特例？
  const root = enqueueConcurrentRenderForLane(boundaryFiber, retryLane);
  if (root !== null) {
    markRootUpdated(root, retryLane);
    ensureRootIsScheduled(root);
  }
}

/** 为 dehydrated Suspense 选择/复用 retryLane 并安排 hydration 重试。 */
export function retryDehydratedSuspenseBoundary(boundaryFiber: Fiber) {
  const suspenseState: null | SuspenseState = boundaryFiber.memoizedState;
  let retryLane: Lane = NoLane;
  if (suspenseState !== null) {
    retryLane = suspenseState.retryLane;
  }
  retryTimedOutBoundary(boundaryFiber, retryLane);
}

/** wakeable 就绪时从边界 retry cache 移除并调度对应 retry。 */
export function resolveRetryWakeable(boundaryFiber: Fiber, wakeable: Wakeable) {
  let retryLane: Lane = NoLane; // 默认尚未分配 retry Lane。
  let retryCache: WeakSet<Wakeable> | Set<Wakeable> | null;
  switch (boundaryFiber.tag) {
    case ActivityComponent:
    case SuspenseComponent:
      retryCache = boundaryFiber.stateNode;
      const suspenseState: null | SuspenseState | ActivityState =
        boundaryFiber.memoizedState;
      if (suspenseState !== null) {
        retryLane = suspenseState.retryLane;
      }
      break;
    case SuspenseListComponent:
      retryCache = boundaryFiber.stateNode;
      break;
    case OffscreenComponent: {
      const instance: OffscreenInstance = boundaryFiber.stateNode;
      retryCache = instance._retryCache;
      break;
    }
    default:
      throw new Error(
        'Pinged unknown suspense boundary type. ' +
          'This is probably a bug in React.',
      );
  }

  if (retryCache !== null) {
    // wakeable 已 resolve，不会再抛出，无需继续记忆。
    retryCache.delete(wakeable);
  }

  retryTimedOutBoundary(boundaryFiber, retryLane);
}

/** 构造并抛出 React 递归更新上限错误；需要时附带 owner stack 与错误捕获。 */
function throwForcedInfiniteRenderLoopError(
  root: FiberRoot | null,
  renderLanes: Lanes,
): empty {
  if (root !== null) {
    // 禁用当前 render 的并发错误恢复，让异常到达最近 Error Boundary、打破无限更新循环，而非
    // 被恢复机制静默重试。
    root.errorRecoveryDisabledLanes = mergeLanes(
      root.errorRecoveryDisabledLanes,
      renderLanes,
    );
  }
  throw new Error(
    'Maximum update depth exceeded. This could be an infinite loop. This can happen when a component ' +
      'repeatedly calls setState during render phase or inside useLayoutEffect, ' +
      'causing infinite render loop. React limits the number of nested updates to ' +
      'prevent infinite loops.',
  );
}

/** 检查同步/passive 嵌套更新计数，超限则重置状态并抛错以打破循环。 */
export function throwIfInfiniteUpdateLoopDetected(
  isFromInfiniteRenderLoopDetectionInstrumentation: boolean,
) {
  if (nestedUpdateCount > NESTED_UPDATE_LIMIT) {
    nestedUpdateCount = 0;
    nestedPassiveUpdateCount = 0;
    rootWithNestedUpdates = null;
    rootWithPassiveNestedUpdates = null;

    const updateKind = nestedUpdateKind;
    nestedUpdateKind = NO_NESTED_UPDATE;

    if (enableInfiniteRenderLoopDetection) {
      if (updateKind === NESTED_UPDATE_SYNC_LANE) {
        if (
          isFromInfiniteRenderLoopDetectionInstrumentation ||
          (executionContext & RenderContext) !== NoContext
        ) {
          // 该循环只因 enableInfiniteRenderLoopDetection 的插桩被识别；除非 ForceThrow，否则
          // 只警告不抛错。
          if (enableInfiniteRenderLoopDetectionForceThrow) {
            throwForcedInfiniteRenderLoopError(
              workInProgressRoot,
              workInProgressRootRenderLanes,
            );
          } else if (__DEV__) {
            console.error(
              'Maximum update depth exceeded. This could be an infinite loop. This can happen when a component ' +
                'repeatedly calls setState during render phase or inside useLayoutEffect, ' +
                'causing infinite render loop. React limits the number of nested updates to ' +
                'prevent infinite loops.',
            );
          }
        } else {
          throw new Error(
            'Maximum update depth exceeded. This can happen when a component ' +
              'repeatedly calls setState inside componentWillUpdate or ' +
              'componentDidUpdate. React limits the number of nested updates to ' +
              'prevent infinite loops.',
          );
        }
      } else if (updateKind === NESTED_UPDATE_PHASE_SPAWN) {
        if (enableInfiniteRenderLoopDetectionForceThrow) {
          throwForcedInfiniteRenderLoopError(
            workInProgressRoot,
            workInProgressRootRenderLanes,
          );
        } else if (__DEV__) {
          console.error(
            'Maximum update depth exceeded. This could be an infinite loop. This can happen when a component ' +
              'repeatedly calls setState during render phase or inside useLayoutEffect, ' +
              'causing infinite render loop. React limits the number of nested updates to ' +
              'prevent infinite loops.',
          );
        }
      }
    } else {
      throw new Error(
        'Maximum update depth exceeded. This can happen when a component ' +
          'repeatedly calls setState inside componentWillUpdate or ' +
          'componentDidUpdate. React limits the number of nested updates to ' +
          'prevent infinite loops.',
      );
    }
  }

  if (__DEV__) {
    if (nestedPassiveUpdateCount > NESTED_PASSIVE_UPDATE_LIMIT) {
      nestedPassiveUpdateCount = 0;
      rootWithPassiveNestedUpdates = null;

      console.error(
        'Maximum update depth exceeded. This can happen when a component ' +
          "calls setState inside useEffect, but useEffect either doesn't " +
          'have a dependency array, or one of the dependencies changes on ' +
          'every render.',
      );
    }
  }
}

/** 开发期在 render 完成后批量输出 StrictMode legacy API 警告。 */
function flushRenderPhaseStrictModeWarningsInDEV() {
  if (__DEV__) {
    ReactStrictModeWarnings.flushLegacyContextWarning();
    ReactStrictModeWarnings.flushPendingUnsafeLifecycleWarnings();
  }
}

/** StrictMode 开发验证：遍历新放置/可见 Offscreen 子树并选择双调用 effect。 */
function recursivelyTraverseAndDoubleInvokeEffectsInDEV(
  root: FiberRoot,
  parentFiber: Fiber,
  isInStrictMode: boolean,
) {
  if ((parentFiber.subtreeFlags & (PlacementDEV | Visibility)) === NoFlags) {
    // 父级后代已双调用 effect，提前退出避免重复遍历。
    return;
  }
  let child = parentFiber.child;
  while (child !== null) {
    doubleInvokeEffectsInDEVIfNecessary(root, child, isInStrictMode);
    child = child.sibling;
  }
}

// 无条件断开再连接 passive/layout effects。
/** 临时隐藏/重现 Fiber 的 layout/passive effects，模拟一次额外卸载与挂载。 */
function doubleInvokeEffectsOnFiber(root: FiberRoot, fiber: Fiber) {
  setIsStrictModeForDevtools(true);
  try {
    disappearLayoutEffectsForDEVValidation(fiber);
    disconnectPassiveEffect(fiber);
    reappearLayoutEffectsForDEVValidation(root, fiber.alternate, fiber);
    reconnectPassiveEffects(root, fiber, NoLanes, null, false, 0);
  } finally {
    setIsStrictModeForDevtools(false);
  }
}

/** 按祖先 StrictMode 与 Placement/Offscreen 可见性决定当前 Fiber 是否需双调用。 */
function doubleInvokeEffectsInDEVIfNecessary(
  root: FiberRoot,
  fiber: Fiber,
  parentIsInStrictMode: boolean,
) {
  const isStrictModeFiber = fiber.type === REACT_STRICT_MODE_TYPE;
  const isInStrictMode = parentIsInStrictMode || isStrictModeFiber;

  // 情况一：Fiber 不是 OffscreenComponent，按通用规则双调用。
  if (fiber.tag !== OffscreenComponent) {
    if (fiber.flags & PlacementDEV) {
      if (isInStrictMode) {
        runWithFiberInDEV(fiber, doubleInvokeEffectsOnFiber, root, fiber);
      }
    } else {
      recursivelyTraverseAndDoubleInvokeEffectsInDEV(
        root,
        fiber,
        isInStrictMode,
      );
    }
    return;
  }

  // 情况二：Fiber 是 OffscreenComponent，应用 Offscreen 专属规则。
  if (fiber.memoizedState === null) {
    // 只考虑可见 Offscreen。TODO（Offscreen）：处理 manual mode。
    if (isInStrictMode && fiber.flags & (Visibility | PlacementDEV)) {
      // Offscreen 可见且 visibility 变化时双调用子树 effect；新 hydration Offscreen 即使标志未变
      // 也需处理。
      runWithFiberInDEV(fiber, doubleInvokeEffectsOnFiber, root, fiber);
    } else if (fiber.subtreeFlags & PlacementDEV) {
      // 子树可能曾挂起，继续遍历寻找新插入 Fiber。
      runWithFiberInDEV(
        fiber,
        recursivelyTraverseAndDoubleInvokeEffectsInDEV,
        root,
        fiber,
        isInStrictMode,
      );
    }
  }
}

/** commit 后执行 Strict Effects 双调用；LegacyRoot 使用旧遍历，并发根用新递归路径。 */
function commitDoubleInvokeEffectsInDEV(
  root: FiberRoot,
  hasPassiveEffects: boolean,
) {
  if (__DEV__) {
    if (disableLegacyMode || root.tag !== LegacyRoot) {
      let doubleInvokeEffects = true;

      if (
        (disableLegacyMode || root.tag === ConcurrentRoot) &&
        !(root.current.mode & (StrictLegacyMode | StrictEffectsMode))
      ) {
        doubleInvokeEffects = false;
      }
      recursivelyTraverseAndDoubleInvokeEffectsInDEV(
        root,
        root.current,
        doubleInvokeEffects,
      );
    } else {
      // TODO：其他 effect 函数也会 runWithFiberInDEV，此处是否仍需要？
      runWithFiberInDEV(
        root.current,
        legacyCommitDoubleInvokeEffectsInDEV,
        root.current,
        hasPassiveEffects,
      );
    }
  }
}

/** Legacy StrictMode 先批量卸载 layout/passive，再批量重新挂载。 */
function legacyCommitDoubleInvokeEffectsInDEV(
  fiber: Fiber,
  hasPassiveEffects: boolean,
) {
  // TODO（StrictEffects）：root 若含 strict effects，是否设置根级标记避免无谓遍历？类似
  // subtreeFlags，但仅根级。此逻辑只在 DEV，收益可能有限。

  invokeEffectsInDev(fiber, MountLayoutDev, invokeLayoutEffectUnmountInDEV);
  if (hasPassiveEffects) {
    invokeEffectsInDev(fiber, MountPassiveDev, invokePassiveEffectUnmountInDEV);
  }

  invokeEffectsInDev(fiber, MountLayoutDev, invokeLayoutEffectMountInDEV);
  if (hasPassiveEffects) {
    invokeEffectsInDev(fiber, MountPassiveDev, invokePassiveEffectMountInDEV);
  }
}

/** 按指定 FiberFlags 遍历子树并调用开发期 effect mount/unmount helper。 */
function invokeEffectsInDev(
  firstChild: Fiber,
  fiberFlags: Flags,
  invokeEffectFn: (fiber: Fiber) => void,
) {
  let current: null | Fiber = firstChild;
  let subtreeRoot = null;
  while (current != null) {
    const primarySubtreeFlag = current.subtreeFlags & fiberFlags;
    if (
      current !== subtreeRoot &&
      current.child != null &&
      primarySubtreeFlag !== NoFlags
    ) {
      current = current.child;
    } else {
      if ((current.flags & fiberFlags) !== NoFlags) {
        invokeEffectFn(current);
      }

      if (current.sibling !== null) {
        current = current.sibling;
      } else {
        current = subtreeRoot = current.return;
      }
    }
  }
}

let didWarnStateUpdateForNotYetMountedComponent: Set<string> | null = null;
/** 开发期警告 render 尚未完成 mount 的组件被异步更新，并按组件名去重。 */
export function warnAboutUpdateOnNotYetMountedFiberInDEV(fiber: Fiber) {
  if (__DEV__) {
    if ((executionContext & RenderContext) !== NoContext) {
      // 交给另一条 render-phase update 警告处理。
      return;
    }

    if (!disableLegacyMode && !(fiber.mode & ConcurrentMode)) {
      return;
    }

    const tag = fiber.tag;
    if (
      tag !== HostRoot &&
      tag !== ClassComponent &&
      tag !== FunctionComponent &&
      tag !== ForwardRef &&
      tag !== MemoComponent &&
      tag !== SimpleMemoComponent
    ) {
      // 只警告用户组件，不警告 Suspense 等内部组件。
      return;
    }

    // 展示完整栈，但按顶层组件名去重，因为问题代码几乎总在该组件内。
    const componentName = getComponentNameFromFiber(fiber) || 'ReactComponent';
    if (didWarnStateUpdateForNotYetMountedComponent !== null) {
      if (didWarnStateUpdateForNotYetMountedComponent.has(componentName)) {
        return;
      }
      // $FlowFixMe[incompatible-use] found when upgrading Flow
      didWarnStateUpdateForNotYetMountedComponent.add(componentName);
    } else {
      didWarnStateUpdateForNotYetMountedComponent = new Set([componentName]);
    }

    runWithFiberInDEV(fiber, () => {
      console.error(
        "Can't perform a React state update on a component that hasn't mounted yet. " +
          'This indicates that you have a side-effect in your render function that ' +
          'asynchronously tries to update the component. Move this work to ' +
          'useEffect instead.',
      );
    });
  }
}

let didWarnAboutUpdateInRender = false;
let didWarnAboutUpdateInRenderForAnotherComponent;
if (__DEV__) {
  didWarnAboutUpdateInRenderForAnotherComponent = new Set<string>();
}

/** 开发期警告 render 中更新其他组件或 Class 自身 render-phase update。 */
function warnAboutRenderPhaseUpdatesInDEV(fiber: Fiber) {
  if (__DEV__) {
    if (ReactCurrentDebugFiberIsRenderingInDEV) {
      switch (fiber.tag) {
        case FunctionComponent:
        case ForwardRef:
        case SimpleMemoComponent: {
          const renderingComponentName =
            (workInProgress && getComponentNameFromFiber(workInProgress)) ||
            'Unknown';
          // 按正在 render 的组件去重，因为它才是需要修复的一方。
          const dedupeKey = renderingComponentName;
          if (!didWarnAboutUpdateInRenderForAnotherComponent.has(dedupeKey)) {
            didWarnAboutUpdateInRenderForAnotherComponent.add(dedupeKey);
            const setStateComponentName =
              getComponentNameFromFiber(fiber) || 'Unknown';
            console.error(
              'Cannot update a component (`%s`) while rendering a ' +
                'different component (`%s`). To locate the bad setState() call inside `%s`, ' +
                'follow the stack trace as described in https://react.dev/link/setstate-in-render',
              setStateComponentName,
              renderingComponentName,
              renderingComponentName,
            );
          }
          break;
        }
        case ClassComponent: {
          if (!didWarnAboutUpdateInRender) {
            console.error(
              'Cannot update during an existing state transition (such as ' +
                'within `render`). Render methods should be a pure ' +
                'function of props and state.',
            );
            didWarnAboutUpdateInRender = true;
          }
          break;
        }
      }
    }
  }
}

/** render bailout/中断时把 memoized updater Fiber 放回指定 lanes 的 DevTools Map。 */
export function restorePendingUpdaters(root: FiberRoot, lanes: Lanes): void {
  if (enableUpdaterTracking) {
    if (isDevToolsPresent) {
      const memoizedUpdaters = root.memoizedUpdaters;
      memoizedUpdaters.forEach(schedulingFiber => {
        addFiberToLanesMap(root, schedulingFiber, lanes);
      });

      // 刻意不清 memoized updaters；它们对当前 commit 及未来 commit（如 Suspense）仍可能相关。
    }
  }
}

/** act 测试队列中的占位 callback node，用于模拟 Scheduler 句柄。 */
const fakeActCallbackNode = {};
// $FlowFixMe[missing-local-annot]
/** 测试 act 环境把 callback 推入 actQueue；否则委托 Scheduler。 */
function scheduleCallback(priorityLevel: any, callback) {
  if (__DEV__) {
    // 位于 act 作用域时绕过 Scheduler，直接推入 actQueue。
    const actQueue = ReactSharedInternals.actQueue;
    if (actQueue !== null) {
      actQueue.push(callback);
      return fakeActCallbackNode;
    } else {
      return Scheduler_scheduleCallback(priorityLevel, callback);
    }
  } else {
    // 生产模式始终调用 Scheduler；开发分支会被裁剪。
    return Scheduler_scheduleCallback(priorityLevel, callback);
  }
}

/** 判断当前 act legacy 模式是否要求同步显示 Suspense fallback。 */
function shouldForceFlushFallbacksInDEV() {
  // 生产模式从不强制 flush；函数应被裁剪。
  return __DEV__ && ReactSharedInternals.actQueue !== null;
}

/** 开发测试环境警告状态更新未包在 act(...) 中。 */
function warnIfUpdatesNotWrappedWithActDEV(fiber: Fiber): void {
  if (__DEV__) {
    if (disableLegacyMode || fiber.mode & ConcurrentMode) {
      if (!isConcurrentActEnvironment()) {
        // 不在 act 测试环境，无需警告。
        return;
      }
    } else {
      // Legacy 模式还有额外抑制警告条件。
      if (!isLegacyActEnvironment(fiber)) {
        // 不在 act 测试环境，无需警告。
        return;
      }
      if (executionContext !== NoContext) {
        // Legacy 模式对 batchedUpdates/flushSync 内的批量更新不警告。
        return;
      }
      if (
        fiber.tag !== FunctionComponent &&
        fiber.tag !== ForwardRef &&
        fiber.tag !== SimpleMemoComponent
      ) {
        // 为兼容 Hooks 前代码，Legacy 模式只警告源自 Hook 的更新。
        return;
      }
    }

    if (ReactSharedInternals.actQueue === null) {
      runWithFiberInDEV(fiber, () => {
        console.error(
          'An update to %s inside a test was not wrapped in act(...).\n\n' +
            'When testing, code that causes React state updates should be ' +
            'wrapped into act(...):\n\n' +
            'act(() => {\n' +
            '  /* fire events that update state */\n' +
            '});\n' +
            '/* assert on the output */\n\n' +
            "This ensures that you're testing the behavior the user would see " +
            'in the browser.' +
            ' Learn more at https://react.dev/link/wrap-tests-with-act',
          getComponentNameFromFiber(fiber),
        );
      });
    }
  }
}

/** 开发测试环境警告 Suspense wakeable resolve 未包在 act(...) 中。 */
function warnIfSuspenseResolutionNotWrappedWithActDEV(root: FiberRoot): void {
  if (__DEV__) {
    if (
      (disableLegacyMode || root.tag !== LegacyRoot) &&
      isConcurrentActEnvironment() &&
      ReactSharedInternals.actQueue === null
    ) {
      console.error(
        'A suspended resource finished loading inside a test, but the event ' +
          'was not wrapped in act(...).\n\n' +
          'When testing, code that resolves suspended data should be wrapped ' +
          'into act(...):\n\n' +
          'act(() => {\n' +
          '  /* finish loading suspended data */\n' +
          '});\n' +
          '/* assert on the output */\n\n' +
          "This ensures that you're testing the behavior the user would see " +
          'in the browser.' +
          ' Learn more at https://react.dev/link/wrap-tests-with-act',
      );
    }
  }
}

/** 标记当前是否执行 useInsertionEffect，供 scheduleUpdate 发出非法更新警告。 */
export function setIsRunningInsertionEffect(isRunning: boolean): void {
  if (__DEV__) {
    isRunningInsertionEffect = isRunning;
  }
}
