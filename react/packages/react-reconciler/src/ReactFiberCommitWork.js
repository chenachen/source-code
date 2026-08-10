/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  Instance,
  TextInstance,
  ActivityInstance,
  SuspenseInstance,
  Container,
  HoistableRoot,
  FormInstance,
  Props,
  SuspendedState,
} from './ReactFiberConfig';
import type {Fiber, FiberRoot} from './ReactInternalTypes';
import type {Lanes} from './ReactFiberLane';
import {
  includesLoadingIndicatorLanes,
  includesOnlySuspenseyCommitEligibleLanes,
  includesOnlyViewTransitionEligibleLanes,
} from './ReactFiberLane';
import type {ActivityState} from './ReactFiberActivityComponent';
import type {SuspenseState, RetryQueue} from './ReactFiberSuspenseComponent';
import type {UpdateQueue} from './ReactFiberClassUpdateQueue';
import type {FunctionComponentUpdateQueue} from './ReactFiberHooks';
import type {Wakeable, ViewTransitionProps} from 'shared/ReactTypes';
import type {
  OffscreenState,
  OffscreenInstance,
  OffscreenQueue,
} from './ReactFiberOffscreenComponent';
import type {Cache} from './ReactFiberCacheComponent';
import type {RootState} from './ReactFiberRoot';
import type {Transition} from 'react/src/ReactStartTransition';
import type {
  TracingMarkerInstance,
  TransitionAbort,
} from './ReactFiberTracingMarkerComponent';
import type {ViewTransitionState} from './ReactFiberViewTransitionComponent';

import {
  alwaysThrottleRetries,
  enableCreateEventHandleAPI,
  enableEffectEventMutationPhase,
  enableProfilerTimer,
  enableProfilerCommitHooks,
  enableSuspenseCallback,
  enableScopeAPI,
  enableUpdaterTracking,
  enableTransitionTracing,
  enableLegacyHidden,
  disableLegacyMode,
  enableComponentPerformanceTrack,
  enableViewTransition,
  enableFragmentRefs,
  enableDefaultTransitionIndicator,
  enableFragmentRefsTextNodes,
} from 'shared/ReactFeatureFlags';
import {
  FunctionComponent,
  ForwardRef,
  ClassComponent,
  HostRoot,
  HostComponent,
  HostHoistable,
  HostSingleton,
  HostText,
  HostPortal,
  Profiler,
  ActivityComponent,
  SuspenseComponent,
  DehydratedFragment,
  IncompleteClassComponent,
  MemoComponent,
  SimpleMemoComponent,
  SuspenseListComponent,
  ScopeComponent,
  OffscreenComponent,
  LegacyHiddenComponent,
  CacheComponent,
  TracingMarkerComponent,
  ViewTransitionComponent,
  Fragment,
} from './ReactWorkTags';
import {
  NoFlags,
  ContentReset,
  Placement,
  ChildDeletion,
  Snapshot,
  Update,
  Hydrate,
  Callback,
  Ref,
  Hydrating,
  Passive,
  BeforeMutationMask,
  BeforeAndAfterMutationTransitionMask,
  MutationMask,
  LayoutMask,
  PassiveMask,
  PassiveTransitionMask,
  Visibility,
  ShouldSuspendCommit,
  MaySuspendCommit,
  FormReset,
  Cloned,
  PerformedWork,
  ForceClientRender,
  DidCapture,
  AffectedParentLayout,
  ViewTransitionNamedStatic,
  PortalStatic,
} from './ReactFiberFlags';
import {
  commitStartTime,
  pushNestedEffectDurations,
  popNestedEffectDurations,
  bubbleNestedEffectDurations,
  resetComponentEffectTimers,
  pushComponentEffectStart,
  popComponentEffectStart,
  pushComponentEffectDuration,
  popComponentEffectDuration,
  pushComponentEffectErrors,
  popComponentEffectErrors,
  pushComponentEffectDidSpawnUpdate,
  popComponentEffectDidSpawnUpdate,
  componentEffectStartTime,
  componentEffectEndTime,
  componentEffectDuration,
  componentEffectErrors,
  componentEffectSpawnedUpdate,
} from './ReactProfilerTimer';
import {
  logComponentRender,
  logComponentErrored,
  logComponentEffect,
  logComponentMount,
  logComponentUnmount,
  logComponentReappeared,
  logComponentDisappeared,
  pushDeepEquality,
  popDeepEquality,
} from './ReactFiberPerformanceTrack';
import {ConcurrentMode, NoMode, ProfileMode} from './ReactTypeOfMode';
import {deferHiddenCallbacks} from './ReactFiberClassUpdateQueue';
import {
  supportsMutation,
  supportsPersistence,
  supportsHydration,
  supportsResources,
  supportsSingletons,
  clearSuspenseBoundary,
  clearSuspenseBoundaryFromContainer,
  createContainerChildSet,
  clearContainer,
  prepareScopeUpdate,
  prepareForCommit,
  beforeActiveInstanceBlur,
  detachDeletedInstance,
  getHoistableRoot,
  acquireResource,
  releaseResource,
  hydrateHoistable,
  mountHoistable,
  unmountHoistable,
  prepareToCommitHoistables,
  maySuspendCommitInSyncRender,
  suspendInstance,
  suspendResource,
  resetFormInstance,
  registerSuspenseInstanceRetry,
  cancelViewTransitionName,
  cancelRootViewTransitionName,
  restoreRootViewTransitionName,
  isSingletonScope,
  updateFragmentInstanceFiber,
} from './ReactFiberConfig';
import {
  captureCommitPhaseError,
  resolveRetryWakeable,
  markCommitTimeOfFallback,
  restorePendingUpdaters,
  addTransitionStartCallbackToPendingTransition,
  addTransitionProgressCallbackToPendingTransition,
  addTransitionCompleteCallbackToPendingTransition,
  addMarkerProgressCallbackToPendingTransition,
  addMarkerIncompleteCallbackToPendingTransition,
  addMarkerCompleteCallbackToPendingTransition,
  retryDehydratedSuspenseBoundary,
  scheduleViewTransitionEvent,
} from './ReactFiberWorkLoop';
import {
  HasEffect as HookHasEffect,
  Layout as HookLayout,
  Insertion as HookInsertion,
  Passive as HookPassive,
} from './ReactHookEffectTags';
import {doesFiberContain} from './ReactFiberTreeReflection';
import {isDevToolsPresent, onCommitUnmount} from './ReactFiberDevToolsHook';
import {releaseCache, retainCache} from './ReactFiberCacheComponent';
import {clearTransitionsForLanes} from './ReactFiberLane';
import {
  OffscreenVisible,
  OffscreenPassiveEffectsConnected,
} from './ReactFiberOffscreenComponent';
import {
  TransitionRoot,
  TransitionTracingMarker,
} from './ReactFiberTracingMarkerComponent';
import {getViewTransitionClassName} from './ReactFiberViewTransitionComponent';
import {
  commitHookLayoutEffects,
  commitHookLayoutUnmountEffects,
  commitHookEffectListMount,
  commitHookEffectListUnmount,
  commitHookPassiveMountEffects,
  commitHookPassiveUnmountEffects,
  commitClassLayoutLifecycles,
  commitClassDidMount,
  commitClassCallbacks,
  commitClassHiddenCallbacks,
  commitClassSnapshot,
  safelyCallComponentWillUnmount,
  safelyAttachRef,
  safelyDetachRef,
  commitProfilerUpdate,
  commitProfilerPostCommit,
  commitRootCallbacks,
} from './ReactFiberCommitEffects';
import {
  commitHostMount,
  commitHostHydratedInstance,
  commitHostUpdate,
  commitHostTextUpdate,
  commitHostResetTextContent,
  commitShowHideSuspenseBoundary,
  commitShowHideHostInstance,
  commitShowHideHostTextInstance,
  commitHostPlacement,
  commitHostRootContainerChildren,
  commitHostPortalContainerChildren,
  commitHostHydratedContainer,
  commitHostHydratedActivity,
  commitHostHydratedSuspense,
  commitHostRemoveChildFromContainer,
  commitHostRemoveChild,
  commitHostSingletonAcquisition,
  commitHostSingletonRelease,
  commitFragmentInstanceDeletionEffects,
  commitFragmentInstanceInsertionEffects,
} from './ReactFiberCommitHostEffects';
import {
  trackEnterViewTransitions,
  commitEnterViewTransitions,
  commitExitViewTransitions,
  commitBeforeUpdateViewTransition,
  commitNestedViewTransitions,
  restoreEnterOrExitViewTransitions,
  restoreUpdateViewTransition,
  restoreNestedViewTransitions,
  measureUpdateViewTransition,
  measureNestedViewTransitions,
  resetAppearingViewTransitions,
  trackAppearingViewTransition,
  viewTransitionCancelableChildren,
  pushViewTransitionCancelableScope,
  popViewTransitionCancelableScope,
} from './ReactFiberCommitViewTransitions';
import {
  viewTransitionMutationContext,
  pushRootMutationContext,
  pushMutationContext,
  popMutationContext,
  rootMutationContext,
} from './ReactFiberMutationTracking';
import {
  trackNamedViewTransition,
  untrackNamedViewTransition,
} from './ReactFiberDuplicateViewTransitions';
import {markIndicatorHandled} from './ReactFiberRootScheduler';
import type {Flags} from './ReactFiberFlags';

/** layout effect 遍历时控制是否含当前 WIP effect 与 HostSingleton 的位标志。 */
type LayoutEffectTraversalFlags = number;

/** 默认 layout 遍历：不额外处理 WIP effect 或 singleton。 */
const NoLayoutEffectTraversalFlags = /*        */ 0b00;
/** layout 遍历包含当前 work-in-progress Fiber 自身的 effect。 */
const IncludeWorkInProgressEffects = /*       */ 0b01;
/** layout 遍历包含 HostSingleton 的 acquire/release 生命周期。 */
const IncludeHostSingletons = /*              */ 0b10;

// 在提交阶段跟踪 Offscreen 组件栈状态，避免沿 return 路径回溯查找最近的 Offscreen 祖先。
let offscreenSubtreeIsHidden: boolean = false;
let offscreenSubtreeWasHidden: boolean = false;
// 跟踪上方是否存在与当前节点之间没有 HostComponent 的隐藏 Offscreen；若存在，
// 它会覆盖下方 HostComponent 自身的隐藏状态。
let offscreenDirectParentIsHidden: boolean = false;

// 跟踪表单是否需要在变更阶段结束时重置。
let needsFormReset = false;

/** 优先用 WeakSet 缓存 thenable retry 监听；无 WeakSet 环境退回 Set。 */
const PossiblyWeakSet = typeof WeakSet === 'function' ? WeakSet : Set;

let nextEffect: Fiber | null = null;

// 在 Profiling 构建中跟踪更新发起者。
let inProgressLanes: Lanes | null = null;
let inProgressRoot: FiberRoot | null = null;

let focusedInstanceHandle: null | Fiber = null;
export let shouldFireAfterActiveInstanceBlur: boolean = false;

// 在提交阶段跟踪父级 ViewTransition 组件是否可能受到下方变更或重新布局的影响。
let viewTransitionContextChanged: boolean = false;
let inUpdateViewTransition: boolean = false;
let rootViewTransitionAffected: boolean = false;
let rootViewTransitionNameCanceled: boolean = false;

/** 判断当前 Fiber 是否位于本次刚完成 hydration 的 Activity/Suspense 父边界。 */
function isHydratingParent(current: Fiber, finishedWork: Fiber): boolean {
  if (finishedWork.tag === ActivityComponent) {
    const prevState: ActivityState | null = current.memoizedState;
    const nextState: ActivityState | null = finishedWork.memoizedState;
    return prevState !== null && nextState === null;
  } else if (finishedWork.tag === SuspenseComponent) {
    const prevState: SuspenseState | null = current.memoizedState;
    const nextState: SuspenseState | null = finishedWork.memoizedState;
    return (
      prevState !== null &&
      prevState.dehydrated !== null &&
      (nextState === null || nextState.dehydrated === null)
    );
  } else if (finishedWork.tag === HostRoot) {
    return (
      (current.memoizedState as RootState).isDehydrated &&
      (finishedWork.flags & ForceClientRender) === NoFlags
    );
  } else {
    return false;
  }
}

/** 提交前置阶段入口：捕获焦点/selection、处理 snapshot 与 ViewTransition 测量前工作。 */
export function commitBeforeMutationEffects(
  root: FiberRoot,
  firstChild: Fiber,
  committedLanes: Lanes,
): void {
  focusedInstanceHandle = prepareForCommit(root.containerInfo);
  shouldFireAfterActiveInstanceBlur = false;

  const isViewTransitionEligible =
    enableViewTransition &&
    includesOnlyViewTransitionEligibleLanes(committedLanes);

  nextEffect = firstChild;
  commitBeforeMutationEffects_begin(isViewTransitionEligible);

  // 此后不再需要跟踪活动实例对应的 Fiber。
  focusedInstanceHandle = null;
  // 所有匹配对都已找到，现在可以重置跟踪状态。
  resetAppearingViewTransitions();
}

/** 深度优先进入 before-mutation 子树，按 flags 跳过无关分支并处理删除侧 transition。 */
function commitBeforeMutationEffects_begin(isViewTransitionEligible: boolean) {
  // 若本次提交符合 View Transition 条件，就检查所有发生变更的子树。
  // TODO：可在渲染阶段用 Snapshot 子树标志标记这些子树，以减少这里的遍历。
  const subtreeMask = isViewTransitionEligible
    ? BeforeAndAfterMutationTransitionMask
    : BeforeMutationMask;
  while (nextEffect !== null) {
    const fiber = nextEffect;

    // 此阶段只服务于 beforeActiveInstanceBlur；未启用时直接跳过整轮遍历。
    if (enableCreateEventHandleAPI || isViewTransitionEligible) {
      // TODO：也应通过标志检查包住这里，避免无效遍历。
      const deletions = fiber.deletions;
      if (deletions !== null) {
        for (let i = 0; i < deletions.length; i++) {
          const deletion = deletions[i];
          commitBeforeMutationEffectsDeletion(
            deletion,
            isViewTransitionEligible,
          );
        }
      }
    }

    if (
      enableViewTransition &&
      fiber.alternate === null &&
      (fiber.flags & Placement) !== NoFlags
    ) {
      // 跳过子节点的变更前副作用：这里不应触发嵌套 View Transition 更新，且快照副作用只用于更新，
      // 因而不应再有其他变更前副作用。TODO：改为完全通过标志表达这一约束。
      if (isViewTransitionEligible) {
        trackEnterViewTransitions(fiber);
      }
      commitBeforeMutationEffects_complete(isViewTransitionEligible);
      continue;
    }

    // TODO：这里应与 commitBeforeMutationEffectsOnFiber 中的 switch 递归逻辑合并。
    if (enableViewTransition && fiber.tag === OffscreenComponent) {
      const isModernRoot =
        disableLegacyMode || (fiber.mode & ConcurrentMode) !== NoMode;
      if (isModernRoot) {
        const current = fiber.alternate;
        const isHidden = fiber.memoizedState !== null;
        if (isHidden) {
          if (
            current !== null &&
            current.memoizedState === null &&
            isViewTransitionEligible
          ) {
            // 先前以可见状态挂载，现在变为隐藏。
            commitExitViewTransitions(current);
          }
          // 子节点处于隐藏状态，跳过其变更前副作用。
          commitBeforeMutationEffects_complete(isViewTransitionEligible);
          continue;
        } else if (current !== null && current.memoizedState !== null) {
          // 先前以隐藏状态挂载，现在变为可见。
          // 跳过子节点的变更前副作用：这里不应触发嵌套 View Transition 更新，且快照副作用只用于更新，
          // 因而不应再有其他变更前副作用。TODO：改为完全通过标志表达这一约束。
          if (isViewTransitionEligible) {
            trackEnterViewTransitions(fiber);
          }
          commitBeforeMutationEffects_complete(isViewTransitionEligible);
          continue;
        }
      }
    }

    const child = fiber.child;
    if ((fiber.subtreeFlags & subtreeMask) !== NoFlags && child !== null) {
      child.return = fiber;
      nextEffect = child;
    } else {
      if (isViewTransitionEligible) {
        // 当前位于已更新子树内。影响父级 HostInstance 布局或子节点集合的变更（例如重排）
        // 也可能改变内部 ViewTransition 的位置或尺寸，因此需要继续向内查找它们。
        commitNestedViewTransitions(fiber);
      }
      commitBeforeMutationEffects_complete(isViewTransitionEligible);
    }
  }
}

/** before-mutation 后序回溯，提交当前 Fiber 的 snapshot/blur 等效果并转向 sibling/parent。 */
function commitBeforeMutationEffects_complete(
  isViewTransitionEligible: boolean,
) {
  while (nextEffect !== null) {
    const fiber = nextEffect;
    commitBeforeMutationEffectsOnFiber(fiber, isViewTransitionEligible);

    const sibling = fiber.sibling;
    if (sibling !== null) {
      sibling.return = fiber.return;
      nextEffect = sibling;
      return;
    }

    nextEffect = fiber.return;
  }
}

/** 按 WorkTag 提交单 Fiber 的 getSnapshotBeforeUpdate、root 清容器与焦点相关前置效果。 */
function commitBeforeMutationEffectsOnFiber(
  finishedWork: Fiber,
  isViewTransitionEligible: boolean,
) {
  const current = finishedWork.alternate;
  const flags = finishedWork.flags;

  if (enableCreateEventHandleAPI) {
    if (!shouldFireAfterActiveInstanceBlur && focusedInstanceHandle !== null) {
      // 检查焦点元素是否位于隐藏的 Suspense 子树内。
      // TODO：通过专用副作用标志把这项检查移出热路径。
      // TODO：应覆盖所有 Offscreen 场景，而不只考虑 SuspenseComponent。
      if (
        finishedWork.tag === SuspenseComponent &&
        isSuspenseBoundaryBeingHidden(current, finishedWork) &&
        // $FlowFixMe[incompatible-type] found when upgrading Flow
        doesFiberContain(finishedWork, focusedInstanceHandle)
      ) {
        shouldFireAfterActiveInstanceBlur = true;
        beforeActiveInstanceBlur(finishedWork);
      }
    }
  }

  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      if (!enableEffectEventMutationPhase && (flags & Update) !== NoFlags) {
        const updateQueue: FunctionComponentUpdateQueue | null =
          finishedWork.updateQueue as any;
        const eventPayloads = updateQueue !== null ? updateQueue.events : null;
        if (eventPayloads !== null) {
          for (let ii = 0; ii < eventPayloads.length; ii++) {
            const {ref, nextImpl} = eventPayloads[ii];
            ref.impl = nextImpl;
          }
        }
      }
      break;
    }
    case ClassComponent: {
      if ((flags & Snapshot) !== NoFlags) {
        if (current !== null) {
          commitClassSnapshot(finishedWork, current);
        }
      }
      break;
    }
    case HostRoot: {
      if ((flags & Snapshot) !== NoFlags) {
        // $FlowFixMe[constant-condition]
        if (supportsMutation) {
          const root = finishedWork.stateNode;
          clearContainer(root.containerInfo);
        }
      }
      break;
    }
    case HostComponent:
    case HostHoistable:
    case HostSingleton:
    case HostText:
    case HostPortal:
    case IncompleteClassComponent:
      // 这些组件类型没有需要执行的变更前工作。
      break;
    case ViewTransitionComponent:
      if (enableViewTransition) {
        if (isViewTransitionEligible) {
          if (current === null) {
            // 这是一次新挂载：要么已由 Placement 副作用处理，要么位于更深层的进入过渡中。
          } else {
            // 此子树内部可能发生了变更，从而需要让父节点执行交叉淡化。
            // 为保留这种可能性，先在变更前阶段为旧树分配旧名称。
            // TODO：这里遍历的树随后可能还会继续遍历。更合适的做法是暂存父级
            // ViewTransitionComponent，并继续遍历到 HostComponent；但这需要引入栈并重构本阶段。
            commitBeforeUpdateViewTransition(current, finishedWork);
          }
        }
        break;
      }
    // 继续落入下一分支。
    default: {
      if ((flags & Snapshot) !== NoFlags) {
        throw new Error(
          'This unit of work tag should not have side-effects. This error is ' +
            'likely caused by a bug in React. Please file an issue.',
        );
      }
    }
  }
}

/** 删除前扫描宿主焦点实例及 ViewTransition enter/exit 信息。 */
function commitBeforeMutationEffectsDeletion(
  deletion: Fiber,
  isViewTransitionEligible: boolean,
) {
  if (enableCreateEventHandleAPI) {
    // TODO（effects）：最好避免调用 doesFiberContain()。可以考虑复用一个 subtreeFlags 位，
    // 记录焦点实例位于树的哪一部分；前提是渲染阶段能够安全确定该实例。
    if (doesFiberContain(deletion, focusedInstanceHandle as any as Fiber)) {
      shouldFireAfterActiveInstanceBlur = true;
      beforeActiveInstanceBlur(deletion);
    }
  }
  if (isViewTransitionEligible) {
    commitExitViewTransitions(deletion);
  }
}

/** 按 WorkTag 挂载 layout effect、调用 class 生命周期/ref，并处理 hydration 回调与 Profiler。 */
function commitLayoutEffectOnFiber(
  finishedRoot: FiberRoot,
  current: Fiber | null,
  finishedWork: Fiber,
  committedLanes: Lanes,
): void {
  const prevEffectStart = pushComponentEffectStart();
  const prevEffectDuration = pushComponentEffectDuration();
  const prevEffectErrors = pushComponentEffectErrors();
  const prevEffectDidSpawnUpdate = pushComponentEffectDidSpawnUpdate();
  // 更新此函数时也要同步更新 reappearLayoutEffects；后者在 Offscreen 树由隐藏变为可见时
  // 执行大部分相同工作。
  const flags = finishedWork.flags;
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      recursivelyTraverseLayoutEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
      );
      if (flags & Update) {
        commitHookLayoutEffects(finishedWork, HookLayout | HookHasEffect);
      }
      break;
    }
    case ClassComponent: {
      recursivelyTraverseLayoutEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
      );
      if (flags & Update) {
        commitClassLayoutLifecycles(finishedWork, current);
      }

      if (flags & Callback) {
        commitClassCallbacks(finishedWork);
      }

      if (flags & Ref) {
        safelyAttachRef(finishedWork, finishedWork.return);
      }
      break;
    }
    case HostRoot: {
      const prevProfilerEffectDuration = pushNestedEffectDurations();
      recursivelyTraverseLayoutEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
      );
      if (flags & Callback) {
        commitRootCallbacks(finishedWork);
      }
      if (enableProfilerTimer && enableProfilerCommitHooks) {
        finishedRoot.effectDuration += popNestedEffectDurations(
          prevProfilerEffectDuration,
        );
      }
      break;
    }
    case HostSingleton: {
      // $FlowFixMe[constant-condition]
      if (supportsSingletons) {
        // 先获取 singleton 实例，使其在其他布局副作用运行前具备正确样式。
        // 这并不完美：较早的兄弟节点可能在实例获取前通过副作用观察到它。
        // @TODO 移到变更阶段。目前尚未这样做，是因为需要把消失副作用移到出现副作用之前，
        // 看起来会额外增加一次遍历。
        if (current === null && flags & Update) {
          // 与重新出现路径不同，这里只在新挂载时获取实例。
          commitHostSingletonAcquisition(finishedWork);
        }
        // 继续落入下方 HostComponent 分支。
      }
      // 继续落入下一分支。
    }
    case HostHoistable:
    case HostComponent: {
      recursivelyTraverseLayoutEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
      );

      // 渲染器可能安排宿主组件挂载后的工作，例如 DOM 渲染器为输入框和表单控件安排自动聚焦。
      // 这些副作用只应在组件首次挂载（即不存在 current/alternate）时提交。
      if (current === null) {
        if (flags & Update) {
          commitHostMount(finishedWork);
        } else if (flags & Hydrate) {
          commitHostHydratedInstance(finishedWork);
        }
      }

      if (flags & Ref) {
        safelyAttachRef(finishedWork, finishedWork.return);
      }
      break;
    }
    case Profiler: {
      // TODO：它应在 Offscreen 树内部触发，还是应等到树再次可见时再触发？
      if (flags & Update) {
        const prevProfilerEffectDuration = pushNestedEffectDurations();

        recursivelyTraverseLayoutEffects(
          finishedRoot,
          finishedWork,
          committedLanes,
        );

        const profilerInstance = finishedWork.stateNode;

        if (enableProfilerTimer && enableProfilerCommitHooks) {
          // 将布局副作用耗时传播给最近的上级 Profiler。
          // 到下一次渲染前不要重置这些值，确保 DevTools 有机会读取。
          profilerInstance.effectDuration += bubbleNestedEffectDurations(
            prevProfilerEffectDuration,
          );
        }

        commitProfilerUpdate(
          finishedWork,
          current,
          commitStartTime,
          profilerInstance.effectDuration,
        );
      } else {
        recursivelyTraverseLayoutEffects(
          finishedRoot,
          finishedWork,
          committedLanes,
        );
      }
      break;
    }
    case ActivityComponent: {
      recursivelyTraverseLayoutEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
      );
      if (flags & Update) {
        commitActivityHydrationCallbacks(finishedRoot, finishedWork);
      }
      break;
    }
    case SuspenseComponent: {
      recursivelyTraverseLayoutEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
      );
      if (flags & Update) {
        commitSuspenseHydrationCallbacks(finishedRoot, finishedWork);
      }
      if (flags & Callback) {
        // 此边界正处于 fallback，并持有脱水的 Suspense 实例。
        // 理论上可以假定其仍为脱水状态，但这里重新检查以确保正确。
        const finishedState: SuspenseState | null = finishedWork.memoizedState;
        if (finishedState !== null) {
          const dehydrated = finishedState.dehydrated;
          if (dehydrated !== null) {
            // 注册回调，在服务端结果到达后重试此边界。
            const retry = retryDehydratedSuspenseBoundary.bind(
              null,
              finishedWork,
            );
            registerSuspenseInstanceRetry(dehydrated, retry);
          }
        }
      }
      break;
    }
    case OffscreenComponent: {
      const isModernRoot =
        disableLegacyMode || (finishedWork.mode & ConcurrentMode) !== NoMode;
      if (isModernRoot) {
        const isHidden = finishedWork.memoizedState !== null;
        const newOffscreenSubtreeIsHidden =
          isHidden || offscreenSubtreeIsHidden;
        if (newOffscreenSubtreeIsHidden) {
          // Offscreen 树处于隐藏状态，跳过其布局副作用。
        } else {
          // Offscreen 树处于可见状态。

          const wasHidden = current !== null && current.memoizedState !== null;
          const newOffscreenSubtreeWasHidden =
            wasHidden || offscreenSubtreeWasHidden;
          const prevOffscreenSubtreeIsHidden = offscreenSubtreeIsHidden;
          const prevOffscreenSubtreeWasHidden = offscreenSubtreeWasHidden;
          offscreenSubtreeIsHidden = newOffscreenSubtreeIsHidden;
          offscreenSubtreeWasHidden = newOffscreenSubtreeWasHidden;

          if (offscreenSubtreeWasHidden && !prevOffscreenSubtreeWasHidden) {
            // 这是重新出现边界的根。继续遍历布局副作用时，还必须重新挂载 Offscreen 子树隐藏时
            // 已卸载的布局副作用，因此这里覆盖的工作是普通 commitLayoutEffects 的超集。
            let layoutEffectTraversalFlags: LayoutEffectTraversalFlags;
            // $FlowFixMe[constant-condition]
            if (supportsSingletons) {
              layoutEffectTraversalFlags = IncludeHostSingletons;
            } else {
              layoutEffectTraversalFlags = NoLayoutEffectTraversalFlags;
            }
            if ((finishedWork.subtreeFlags & LayoutMask) !== NoFlags) {
              layoutEffectTraversalFlags |= IncludeWorkInProgressEffects;
            }
            recursivelyTraverseReappearLayoutEffects(
              finishedRoot,
              finishedWork,
              layoutEffectTraversalFlags,
            );
            if (
              enableProfilerTimer &&
              enableProfilerCommitHooks &&
              enableComponentPerformanceTrack &&
              (finishedWork.mode & ProfileMode) !== NoMode &&
              componentEffectStartTime >= 0 &&
              componentEffectEndTime >= 0 &&
              componentEffectEndTime - componentEffectStartTime > 0.05
            ) {
              logComponentReappeared(
                finishedWork,
                componentEffectStartTime,
                componentEffectEndTime,
              );
            }
          } else {
            recursivelyTraverseLayoutEffects(
              finishedRoot,
              finishedWork,
              committedLanes,
            );
          }
          offscreenSubtreeIsHidden = prevOffscreenSubtreeIsHidden;
          offscreenSubtreeWasHidden = prevOffscreenSubtreeWasHidden;
        }
      } else {
        recursivelyTraverseLayoutEffects(
          finishedRoot,
          finishedWork,
          committedLanes,
        );
      }
      break;
    }
    case ViewTransitionComponent: {
      if (enableViewTransition) {
        if (__DEV__) {
          if (flags & ViewTransitionNamedStatic) {
            trackNamedViewTransition(finishedWork);
          }
        }
        recursivelyTraverseLayoutEffects(
          finishedRoot,
          finishedWork,
          committedLanes,
        );
        if (flags & Ref) {
          safelyAttachRef(finishedWork, finishedWork.return);
        }
        break;
      }
      break;
    }
    case Fragment:
      if (enableFragmentRefs) {
        if (flags & Ref) {
          safelyAttachRef(finishedWork, finishedWork.return);
        }
      }
    // 继续落入下一分支。
    default: {
      recursivelyTraverseLayoutEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
      );
      break;
    }
  }

  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    enableComponentPerformanceTrack &&
    (finishedWork.mode & ProfileMode) !== NoMode &&
    componentEffectStartTime >= 0 &&
    componentEffectEndTime >= 0
  ) {
    if (componentEffectSpawnedUpdate || componentEffectDuration > 0.05) {
      logComponentEffect(
        finishedWork,
        componentEffectStartTime,
        componentEffectEndTime,
        componentEffectDuration,
        componentEffectErrors,
      );
    }
    if (
      // 插入阶段。
      finishedWork.alternate === null &&
      finishedWork.return !== null &&
      finishedWork.return.alternate !== null &&
      componentEffectEndTime - componentEffectStartTime > 0.05
    ) {
      const isHydration = isHydratingParent(
        finishedWork.return.alternate,
        finishedWork.return,
      );
      if (!isHydration) {
        logComponentMount(
          finishedWork,
          componentEffectStartTime,
          componentEffectEndTime,
        );
      }
    }
  }

  popComponentEffectStart(prevEffectStart);
  popComponentEffectDuration(prevEffectDuration);
  popComponentEffectErrors(prevEffectErrors);
  popComponentEffectDidSpawnUpdate(prevEffectDidSpawnUpdate);
}

/** 根提交终止时把待完成 Transition 标记为 aborted，并安排 tracing 回调。 */
function abortRootTransitions(
  root: FiberRoot,
  abort: TransitionAbort,
  deletedTransitions: Set<Transition>,
  deletedOffscreenInstance: OffscreenInstance | null,
  isInDeletedTree: boolean,
) {
  if (enableTransitionTracing) {
    const rootTransitions = root.incompleteTransitions;
    deletedTransitions.forEach(transition => {
      if (rootTransitions.has(transition)) {
        const transitionInstance: TracingMarkerInstance = rootTransitions.get(
          transition,
        ) as any;
        if (transitionInstance.aborts === null) {
          transitionInstance.aborts = [];
        }
        transitionInstance.aborts.push(abort);

        if (deletedOffscreenInstance !== null) {
          if (
            transitionInstance.pendingBoundaries !== null &&
            transitionInstance.pendingBoundaries.has(deletedOffscreenInstance)
          ) {
            // $FlowFixMe[incompatible-use] found when upgrading Flow
            transitionInstance.pendingBoundaries.delete(
              deletedOffscreenInstance,
            );
          }
        }
      }
    });
  }
}

/** marker 子树删除/隐藏时终止其仍 pending 的 Transition，并更新 marker 状态。 */
function abortTracingMarkerTransitions(
  abortedFiber: Fiber,
  abort: TransitionAbort,
  deletedTransitions: Set<Transition>,
  deletedOffscreenInstance: OffscreenInstance | null,
  isInDeletedTree: boolean,
) {
  if (enableTransitionTracing) {
    const markerInstance: TracingMarkerInstance = abortedFiber.stateNode;
    const markerTransitions = markerInstance.transitions;
    const pendingBoundaries = markerInstance.pendingBoundaries;
    if (markerTransitions !== null) {
      // TODO：重构这里；应研究能否把计算移到删除阶段，同时保证 complete 在正确时机调用。
      deletedTransitions.forEach(transition => {
        // 若 tracing marker 上的某个 transition 来自已中止子树，就中止该 marker。
        if (
          // $FlowFixMe[invalid-compare]
          abortedFiber !== null &&
          markerTransitions.has(transition) &&
          (markerInstance.aborts === null ||
            !markerInstance.aborts.includes(abort))
        ) {
          if (markerInstance.transitions !== null) {
            if (markerInstance.aborts === null) {
              markerInstance.aborts = [abort];
              addMarkerIncompleteCallbackToPendingTransition(
                abortedFiber.memoizedProps.name,
                markerInstance.transitions,
                markerInstance.aborts,
              );
            } else {
              markerInstance.aborts.push(abort);
            }

            // 仅在 marker 尚未被删除时调用 onTransitionProgress。
            if (
              deletedOffscreenInstance !== null &&
              !isInDeletedTree &&
              pendingBoundaries !== null &&
              pendingBoundaries.has(deletedOffscreenInstance)
            ) {
              pendingBoundaries.delete(deletedOffscreenInstance);

              addMarkerProgressCallbackToPendingTransition(
                abortedFiber.memoizedProps.name,
                deletedTransitions,
                pendingBoundaries,
              );
            }
          }
        }
      });
    }
  }
}

/** 删除 Fiber 时沿父 marker 集合撤销其关联 Transition 与 pending boundary。 */
function abortParentMarkerTransitionsForDeletedFiber(
  abortedFiber: Fiber,
  abort: TransitionAbort,
  deletedTransitions: Set<Transition>,
  deletedOffscreenInstance: OffscreenInstance | null,
  isInDeletedTree: boolean,
) {
  if (enableTransitionTracing) {
    // 找出中止子树中所有仍在等待子 Suspense 边界的待处理 marker，并取消它们。
    let fiber: null | Fiber = abortedFiber;
    while (fiber !== null) {
      switch (fiber.tag) {
        case TracingMarkerComponent:
          abortTracingMarkerTransitions(
            fiber,
            abort,
            deletedTransitions,
            deletedOffscreenInstance,
            isInDeletedTree,
          );
          break;
        case HostRoot:
          const root = fiber.stateNode;
          abortRootTransitions(
            root,
            abort,
            deletedTransitions,
            deletedOffscreenInstance,
            isInDeletedTree,
          );

          break;
        default:
          break;
      }

      fiber = fiber.return;
    }
  }
}

/** Offscreen 可见性提交后更新 Transition/marker pending boundary，并触发 progress/complete 回调。 */
function commitTransitionProgress(offscreenFiber: Fiber) {
  if (enableTransitionTracing) {
    // 此函数维护根或 tracing marker 的 pendingBoundaries 映射。
    // Suspense 边界由已解决转为 fallback 时加入映射，由 fallback 转为已解决时移除。

    // 使用 Offscreen 组件的 stateNode 作为跨渲染保持稳定的对象，借此区分不同 Offscreen 实例，
    // 同时识别“同一 Offscreen 实例对应不同 Fiber”的情况。
    const offscreenInstance: OffscreenInstance = offscreenFiber.stateNode;

    let prevState: SuspenseState | null = null;
    const previousFiber = offscreenFiber.alternate;
    if (previousFiber !== null && previousFiber.memoizedState !== null) {
      prevState = previousFiber.memoizedState;
    }
    const nextState: SuspenseState | null = offscreenFiber.memoizedState;

    const wasHidden = prevState !== null;
    const isHidden = nextState !== null;

    const pendingMarkers = offscreenInstance._pendingMarkers;
    // 若 Suspense 边界带有名称，也将其记录到待处理边界信息中。
    let name = null;
    const parent = offscreenFiber.return;
    if (
      parent !== null &&
      parent.tag === SuspenseComponent &&
      parent.memoizedProps.name
    ) {
      name = parent.memoizedProps.name;
    }

    if (!wasHidden && isHidden) {
      // Suspense 边界刚刚隐藏；若存在待处理边界集合，就把它加入集合。
      if (pendingMarkers !== null) {
        pendingMarkers.forEach(markerInstance => {
          const pendingBoundaries = markerInstance.pendingBoundaries;
          const transitions = markerInstance.transitions;
          const markerName = markerInstance.name;
          if (
            pendingBoundaries !== null &&
            !pendingBoundaries.has(offscreenInstance)
          ) {
            pendingBoundaries.set(offscreenInstance, {
              name,
            });
            if (transitions !== null) {
              if (
                markerInstance.tag === TransitionTracingMarker &&
                markerName !== null
              ) {
                addMarkerProgressCallbackToPendingTransition(
                  markerName,
                  transitions,
                  pendingBoundaries,
                );
              } else if (markerInstance.tag === TransitionRoot) {
                transitions.forEach(transition => {
                  addTransitionProgressCallbackToPendingTransition(
                    transition,
                    pendingBoundaries,
                  );
                });
              }
            }
          }
        });
      }
    } else if (wasHidden && !isHidden) {
      // Suspense 边界由隐藏变为可见；若存在待处理 Suspense 边界集合，就从中移除它。
      if (pendingMarkers !== null) {
        pendingMarkers.forEach(markerInstance => {
          const pendingBoundaries = markerInstance.pendingBoundaries;
          const transitions = markerInstance.transitions;
          const markerName = markerInstance.name;
          if (
            pendingBoundaries !== null &&
            pendingBoundaries.has(offscreenInstance)
          ) {
            pendingBoundaries.delete(offscreenInstance);
            if (transitions !== null) {
              if (
                markerInstance.tag === TransitionTracingMarker &&
                markerName !== null
              ) {
                addMarkerProgressCallbackToPendingTransition(
                  markerName,
                  transitions,
                  pendingBoundaries,
                );

                // 不再有未解决的 Suspense 边界时，本次交互即视为完成。
                if (pendingBoundaries.size === 0) {
                  if (markerInstance.aborts === null) {
                    addMarkerCompleteCallbackToPendingTransition(
                      markerName,
                      transitions,
                    );
                  }
                  markerInstance.transitions = null;
                  markerInstance.pendingBoundaries = null;
                  markerInstance.aborts = null;
                }
              } else if (markerInstance.tag === TransitionRoot) {
                transitions.forEach(transition => {
                  addTransitionProgressCallbackToPendingTransition(
                    transition,
                    pendingBoundaries,
                  );
                });
              }
            }
          }
        });
      }
    }
  }
}

/** 遍历 Offscreen/Activity 内容并隐藏或恢复其最近宿主节点，跳过嵌套隐藏边界。 */
function hideOrUnhideAllChildren(parentFiber: Fiber, isHidden: boolean) {
  // $FlowFixMe[constant-condition]
  if (!supportsMutation) {
    return;
  }
  // 查找最近的宿主组件子节点，并将其可见性更新为隐藏或可见。
  let child = parentFiber.child;
  while (child !== null) {
    hideOrUnhideAllChildrenOnFiber(child, isHidden);
    child = child.sibling;
  }
}

/** 按单 Fiber tag 对宿主实例/文本执行 hide/unhide，或继续深入可见子树。 */
function hideOrUnhideAllChildrenOnFiber(fiber: Fiber, isHidden: boolean) {
  // $FlowFixMe[constant-condition]
  if (!supportsMutation) {
    return;
  }
  switch (fiber.tag) {
    case HostComponent:
    case HostHoistable: {
      // 找到最近的宿主组件，将其隐藏。
      commitShowHideHostInstance(fiber, isHidden);
      // 通常只需隐藏最近的宿主节点，因为这会同时隐藏其内部的所有内容。
      //
      // Portal 是例外：它不处于常规宿主树层级中，React 树中的 HostComponent 父节点
      // 不一定也是实际宿主树中的父节点。
      //
      // 因此只要树内存在 Portal，无论嵌套多深，都必须对子节点重复执行该算法。
      hideOrUnhideNearestPortals(fiber, isHidden);
      return;
    }
    case HostText: {
      commitShowHideHostTextInstance(fiber, isHidden);
      return;
    }
    case DehydratedFragment: {
      commitShowHideSuspenseBoundary(fiber, isHidden);
      return;
    }
    case OffscreenComponent:
    case LegacyHiddenComponent: {
      const offscreenState: OffscreenState | null = fiber.memoizedState;
      if (offscreenState !== null) {
        // 找到隐藏的嵌套 Offscreen 组件；停止向下搜索，这棵树应继续保持隐藏。
      } else {
        hideOrUnhideAllChildren(fiber, isHidden);
      }
      return;
    }
    default: {
      hideOrUnhideAllChildren(fiber, isHidden);
      return;
    }
  }
}

/** 仅在最近 Portal 容器层级切换其宿主 children 可见性。 */
function hideOrUnhideNearestPortals(parentFiber: Fiber, isHidden: boolean) {
  // $FlowFixMe[constant-condition]
  if (!supportsMutation) {
    return;
  }
  if (parentFiber.subtreeFlags & PortalStatic) {
    let child = parentFiber.child;
    while (child !== null) {
      hideOrUnhideNearestPortalsOnFiber(child, isHidden);
      child = child.sibling;
    }
  }
}

/** 查找单分支最近 HostPortal，并在其容器内隐藏/恢复宿主内容。 */
function hideOrUnhideNearestPortalsOnFiber(fiber: Fiber, isHidden: boolean) {
  // $FlowFixMe[constant-condition]
  if (!supportsMutation) {
    return;
  }
  switch (fiber.tag) {
    case HostPortal: {
      // 找到 Portal；切回普通隐藏/显示算法，切换其子节点的可见性。
      hideOrUnhideAllChildrenOnFiber(fiber, isHidden);
      return;
    }
    case OffscreenComponent: {
      const offscreenState: OffscreenState | null = fiber.memoizedState;
      if (offscreenState !== null) {
        // 找到隐藏的嵌套 Offscreen 组件；停止向下搜索，这棵树应继续保持隐藏。
      } else {
        hideOrUnhideNearestPortals(fiber, isHidden);
      }
      return;
    }
    default: {
      hideOrUnhideNearestPortals(fiber, isHidden);
      return;
    }
  }
}

/** mutation 阶段断开删除 Fiber 的 return 指针，阻止事件向已卸载祖先冒泡。 */
function detachFiberMutation(fiber: Fiber) {
  // 切断 return 指针，使 Fiber 与树断开。这样既能检测并警告卸载组件上的状态更新，
  // 也能阻止事件从已断开的组件内部继续冒泡。
  //
  // 理想情况下还应清除父级 alternate 的 child 指针以便回收，但无法确定哪个父级是 current，
  // 因此这里只让该子节点的子树可被回收；父级下次更新时，这个子节点本身也会被回收。
  //
  // 此时还不能清除 child 或 sibling 指针，因为被动副作用和 findDOMNode 仍需要它们。
  // 这些字段及其他清理会延后到被动阶段执行，参见 detachFiberAfterEffects。
  //
  // alternate 也暂不能重置，被动阶段仍要借它断开 alternate 的字段。
  // 对 findDOMNode 语义而言，清除 return 指针已经足够。
  const alternate = fiber.alternate;
  if (alternate !== null) {
    alternate.return = null;
  }
  fiber.return = null;
}

/** passive 清理后彻底断开 alternate/child/sibling/stateNode 等引用，帮助 GC。 */
function detachFiberAfterEffects(fiber: Fiber) {
  const alternate = fiber.alternate;
  if (alternate !== null) {
    fiber.alternate = null;
    detachFiberAfterEffects(alternate);
  }

  // 清理 Fiber 的循环引用字段。这一层级大致模拟计划中的 Fiber 重构：届时 setState 会绑定到
  // 专用 instance 对象而非 Fiber；该对象不包含这些字段，只通过根部单一链接连接 Fiber 树。
  // 若仅清理这一层就能解决内存问题，说明该重构方向可行。
  fiber.child = null;
  fiber.deletions = null;
  fiber.sibling = null;

  // 宿主节点的 stateNode 指向带有子、父和兄弟指针的宿主树，而其他宿主节点又反向指向 Fiber，
  // 因而形成循环引用；这里也必须将其断开。
  if (fiber.tag === HostComponent) {
    const hostInstance: Instance = fiber.stateNode;
    // $FlowFixMe[invalid-compare]
    if (hostInstance !== null) {
      detachDeletedInstance(hostInstance);
    }
  }
  fiber.stateNode = null;

  if (__DEV__) {
    fiber._debugOwner = null;
  }

  // 理论上这里的清理都不是必需的，因为 Fiber 已与树断开；即使该 Fiber 本身泄漏，也不会连带泄漏其他对象。
  fiber.return = null;
  fiber.dependencies = null;
  fiber.memoizedProps = null;
  fiber.memoizedState = null;
  fiber.pendingProps = null;
  fiber.stateNode = null;
  // TODO：改为移到 commitPassiveUnmountInsideDeletedTreeOnFiber。
  fiber.updateQueue = null;
}

// 递归遍历已删除子树时，通过栈跟踪这些状态。
// TODO：应在整个变更阶段更新，而不只在删除过程中更新。
let hostParent: Instance | Container | null = null;
let hostParentIsContainer: boolean = false;

/** 定位最近宿主父节点，递归卸载删除子树、移除宿主实例，最后清理 Fiber 引用。 */
function commitDeletionEffects(
  root: FiberRoot,
  returnFiber: Fiber,
  deletedFiber: Fiber,
) {
  const prevEffectStart = pushComponentEffectStart();

  // $FlowFixMe[constant-condition]
  if (supportsMutation) {
    // 当前只有被删除的顶层 Fiber，必须递归其子节点才能找到所有终端节点。

    // 从父节点递归删除所有宿主节点、断开 ref、清理已挂载的布局副作用，并调用 componentWillUnmount。

    // 每个分支只需移除最上层宿主子节点，但仍要继续遍历以卸载副作用、ref 和 cWU。
    // TODO：可拆成两次遍历，第二次不含 removeChild；它可能与 disappearLayoutEffects
    //（或布局阶段改为递归后对应的函数）合并。

    // 开始前先在栈中找到最近的宿主父节点，确定应从哪个实例或容器移除子节点。
    // TODO：提交阶段遍历树时可在 JS 栈上跟踪最近的宿主组件，避免每次删除都沿 Fiber return
    // 路径向上搜索；这也能加快插入。
    let parent: null | Fiber = returnFiber;
    findParent: while (parent !== null) {
      switch (parent.tag) {
        case HostSingleton: {
          // $FlowFixMe[constant-condition]
          if (supportsSingletons) {
            if (isSingletonScope(parent.type)) {
              hostParent = parent.stateNode;
              hostParentIsContainer = false;
              break findParent;
            }
            break;
          }
          // supportsSingletons 为 false 时预期继续落入下一分支。
        }
        case HostComponent: {
          hostParent = parent.stateNode;
          hostParentIsContainer = false;
          break findParent;
        }
        case HostRoot:
        case HostPortal: {
          hostParent = parent.stateNode.containerInfo;
          hostParentIsContainer = true;
          break findParent;
        }
      }
      parent = parent.return;
    }
    if (hostParent === null) {
      throw new Error(
        'Expected to find a host parent. This error is likely caused by ' +
          'a bug in React. Please file an issue.',
      );
    }

    commitDeletionEffectsOnFiber(root, returnFiber, deletedFiber);
    hostParent = null;
    hostParentIsContainer = false;
  } else {
    // 为整棵子树断开 ref，并调用 componentWillUnmount()。
    commitDeletionEffectsOnFiber(root, returnFiber, deletedFiber);
  }

  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    enableComponentPerformanceTrack &&
    (deletedFiber.mode & ProfileMode) !== NoMode &&
    componentEffectStartTime >= 0 &&
    componentEffectEndTime >= 0 &&
    componentEffectEndTime - componentEffectStartTime > 0.05
  ) {
    logComponentUnmount(
      deletedFiber,
      componentEffectStartTime,
      componentEffectEndTime,
    );
  }
  popComponentEffectStart(prevEffectStart);

  detachFiberMutation(deletedFiber);
}

/** 深度优先提交删除 Fiber 的所有 child 卸载效果。 */
function recursivelyTraverseDeletionEffects(
  finishedRoot: FiberRoot,
  nearestMountedAncestor: Fiber,
  parent: Fiber,
) {
  // TODO：使用静态标志跳过不含卸载副作用的树。
  let child = parent.child;
  while (child !== null) {
    commitDeletionEffectsOnFiber(finishedRoot, nearestMountedAncestor, child);
    child = child.sibling;
  }
}

/** 按 WorkTag 提交单删除 Fiber 的 ref/effect/lifecycle/context/宿主移除与 tracing 清理。 */
function commitDeletionEffectsOnFiber(
  finishedRoot: FiberRoot,
  nearestMountedAncestor: Fiber,
  deletedFiber: Fiber,
) {
  // TODO：新版 DevTools 全面发布后删除此 Hook；届时不再需要它。
  onCommitUnmount(deletedFiber);

  const prevEffectStart = pushComponentEffectStart();
  const prevEffectDuration = pushComponentEffectDuration();
  const prevEffectErrors = pushComponentEffectErrors();
  const prevEffectDidSpawnUpdate = pushComponentEffectDidSpawnUpdate();

  // 外层 switch 的分支会在进入子树前修改栈；不修改栈的简单分支放在内层 switch。
  switch (deletedFiber.tag) {
    case HostHoistable: {
      // $FlowFixMe[constant-condition]
      if (supportsResources) {
        if (!offscreenSubtreeWasHidden) {
          safelyDetachRef(deletedFiber, nearestMountedAncestor);
        }
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber,
        );
        if (deletedFiber.memoizedState) {
          releaseResource(deletedFiber.memoizedState);
        } else if (deletedFiber.stateNode) {
          unmountHoistable(deletedFiber.stateNode);
        }
        break;
      }
      // 继续落入下一分支。
    }
    case HostSingleton: {
      // $FlowFixMe[constant-condition]
      if (supportsSingletons) {
        if (!offscreenSubtreeWasHidden) {
          safelyDetachRef(deletedFiber, nearestMountedAncestor);
        }
        if (enableFragmentRefs) {
          commitFragmentInstanceDeletionEffects(deletedFiber);
        }

        const prevHostParent = hostParent;
        const prevHostParentIsContainer = hostParentIsContainer;
        if (isSingletonScope(deletedFiber.type)) {
          hostParent = deletedFiber.stateNode;
          hostParentIsContainer = false;
        }
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber,
        );

        // 通常 detach 会在被动卸载副作用阶段调用；但 HostSingleton 若已关联其他 Fiber，
        // 再次获取会触发警告。尤其是带 key 的 HostSingleton 会先删除再 Placement，
        // 因此这里提前执行 detach，以尽量避免该警告。
        commitHostSingletonRelease(deletedFiber);

        hostParent = prevHostParent;
        hostParentIsContainer = prevHostParentIsContainer;

        break;
      }
      // 继续落入下一分支。
    }
    case HostComponent: {
      if (!offscreenSubtreeWasHidden) {
        safelyDetachRef(deletedFiber, nearestMountedAncestor);
      }
      if (
        enableFragmentRefs &&
        (deletedFiber.tag === HostComponent ||
          (enableFragmentRefsTextNodes && deletedFiber.tag === HostText))
      ) {
        commitFragmentInstanceDeletionEffects(deletedFiber);
      }
      // 有意继续落入下一分支。
    }
    case HostText: {
      // 只需移除最近的宿主子节点；把栈中的宿主父节点设为 null，表示嵌套子节点无需再移除。
      // $FlowFixMe[constant-condition]
      if (supportsMutation) {
        const prevHostParent = hostParent;
        const prevHostParentIsContainer = hostParentIsContainer;
        hostParent = null;
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber,
        );
        hostParent = prevHostParent;
        hostParentIsContainer = prevHostParentIsContainer;

        if (hostParent !== null) {
          // 所有子节点副作用都已卸载，现在可以从树中移除此节点。
          if (hostParentIsContainer) {
            commitHostRemoveChildFromContainer(
              deletedFiber,
              nearestMountedAncestor,
              hostParent as any as Container,
              deletedFiber.stateNode as Instance | TextInstance,
            );
          } else {
            commitHostRemoveChild(
              deletedFiber,
              nearestMountedAncestor,
              hostParent as any as Instance,
              deletedFiber.stateNode as Instance | TextInstance,
            );
          }
        }
      } else {
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber,
        );
      }
      break;
    }
    case DehydratedFragment: {
      if (enableSuspenseCallback) {
        const hydrationCallbacks = finishedRoot.hydrationCallbacks;
        if (hydrationCallbacks !== null) {
          try {
            const onDeleted = hydrationCallbacks.onDeleted;
            if (onDeleted) {
              onDeleted(
                deletedFiber.stateNode as SuspenseInstance | ActivityInstance,
              );
            }
          } catch (error) {
            captureCommitPhaseError(
              deletedFiber,
              nearestMountedAncestor,
              error,
            );
          }
        }
      }

      // 脱水片段没有子节点。

      // 删除脱水的 Suspense 边界及其全部内容。
      // $FlowFixMe[constant-condition]
      if (supportsMutation) {
        if (hostParent !== null) {
          if (hostParentIsContainer) {
            clearSuspenseBoundaryFromContainer(
              hostParent as any as Container,
              deletedFiber.stateNode as SuspenseInstance,
            );
          } else {
            clearSuspenseBoundary(
              hostParent as any as Instance,
              deletedFiber.stateNode as SuspenseInstance,
            );
          }
        }
      }
      break;
    }
    case HostPortal: {
      // $FlowFixMe[constant-condition]
      if (supportsMutation) {
        // 进入 Portal 后，它会成为后续移除操作的父节点。
        const prevHostParent = hostParent;
        const prevHostParentIsContainer = hostParentIsContainer;
        hostParent = deletedFiber.stateNode.containerInfo;
        hostParentIsContainer = true;
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber,
        );
        hostParent = prevHostParent;
        hostParentIsContainer = prevHostParentIsContainer;
      } else {
        // $FlowFixMe[constant-condition]
        if (supportsPersistence) {
          commitHostPortalContainerChildren(
            deletedFiber.stateNode,
            deletedFiber,
            createContainerChildSet(),
          );
        }

        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber,
        );
      }
      break;
    }
    case FunctionComponent:
    case ForwardRef:
    case MemoComponent:
    case SimpleMemoComponent: {
      // TODO：使用 commitHookInsertionUnmountEffects 包装器记录耗时。
      commitHookEffectListUnmount(
        HookInsertion,
        deletedFiber,
        nearestMountedAncestor,
      );
      if (!offscreenSubtreeWasHidden) {
        commitHookLayoutUnmountEffects(
          deletedFiber,
          nearestMountedAncestor,
          HookLayout,
        );
      }
      recursivelyTraverseDeletionEffects(
        finishedRoot,
        nearestMountedAncestor,
        deletedFiber,
      );
      break;
    }
    case ClassComponent: {
      if (!offscreenSubtreeWasHidden) {
        safelyDetachRef(deletedFiber, nearestMountedAncestor);
        const instance = deletedFiber.stateNode;
        if (typeof instance.componentWillUnmount === 'function') {
          safelyCallComponentWillUnmount(
            deletedFiber,
            nearestMountedAncestor,
            instance,
          );
        }
      }
      recursivelyTraverseDeletionEffects(
        finishedRoot,
        nearestMountedAncestor,
        deletedFiber,
      );
      break;
    }
    case ScopeComponent: {
      if (enableScopeAPI) {
        if (!offscreenSubtreeWasHidden) {
          safelyDetachRef(deletedFiber, nearestMountedAncestor);
        }
      }
      recursivelyTraverseDeletionEffects(
        finishedRoot,
        nearestMountedAncestor,
        deletedFiber,
      );
      break;
    }
    case OffscreenComponent: {
      if (disableLegacyMode || deletedFiber.mode & ConcurrentMode) {
        // 若此 Offscreen 组件已隐藏，它此前已经卸载。删除子节点前先记录该状态，避免重复卸载副作用。
        // TODO：隐藏树通常可以完全跳过嵌套子节点；例外是尚未找到要删除的最上层宿主节点，
        // 以及无论嵌套多深都必须断开的 Portal。应使用子树标志记录是否包含嵌套 Portal。
        const prevOffscreenSubtreeWasHidden = offscreenSubtreeWasHidden;
        offscreenSubtreeWasHidden =
          prevOffscreenSubtreeWasHidden || deletedFiber.memoizedState !== null;

        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber,
        );
        offscreenSubtreeWasHidden = prevOffscreenSubtreeWasHidden;
      } else {
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber,
        );
      }
      break;
    }
    case ViewTransitionComponent: {
      if (enableViewTransition) {
        if (__DEV__) {
          if (deletedFiber.flags & ViewTransitionNamedStatic) {
            untrackNamedViewTransition(deletedFiber);
          }
        }
        safelyDetachRef(deletedFiber, nearestMountedAncestor);
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber,
        );
        break;
      }
      // 继续落入下一分支。
    }
    case Fragment: {
      if (enableFragmentRefs) {
        if (!offscreenSubtreeWasHidden) {
          safelyDetachRef(deletedFiber, nearestMountedAncestor);
        }
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber,
        );
        break;
      }
      // 继续落入下一分支。
    }
    default: {
      recursivelyTraverseDeletionEffects(
        finishedRoot,
        nearestMountedAncestor,
        deletedFiber,
      );
      break;
    }
  }

  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    enableComponentPerformanceTrack &&
    (deletedFiber.mode & ProfileMode) !== NoMode &&
    componentEffectStartTime >= 0 &&
    componentEffectEndTime >= 0 &&
    (componentEffectSpawnedUpdate || componentEffectDuration > 0.05)
  ) {
    logComponentEffect(
      deletedFiber,
      componentEffectStartTime,
      componentEffectEndTime,
      componentEffectDuration,
      componentEffectErrors,
    );
  }

  popComponentEffectStart(prevEffectStart);
  popComponentEffectDuration(prevEffectDuration);
  popComponentEffectErrors(prevEffectErrors);
  popComponentEffectDidSpawnUpdate(prevEffectDidSpawnUpdate);
}

/** Suspense 显示 fallback 后调用其 suspenseCallback，并传入 retry queue thenable 集合。 */
function commitSuspenseCallback(finishedWork: Fiber) {
  // TODO：删除此功能；DEV 功能目前无法正确覆盖它。
  const newState: SuspenseState | null = finishedWork.memoizedState;
  if (enableSuspenseCallback && newState !== null) {
    const suspenseCallback = finishedWork.memoizedProps.suspenseCallback;
    if (typeof suspenseCallback === 'function') {
      const retryQueue: RetryQueue | null = finishedWork.updateQueue as any;
      if (retryQueue !== null) {
        suspenseCallback(new Set(retryQueue));
      }
    } else if (__DEV__) {
      if (suspenseCallback !== undefined) {
        console.error('Unexpected type for suspenseCallback.');
      }
    }
  }
}

/** Activity 从 dehydrated 变为客户端/已 hydration 后调用宿主 hydration 完成回调。 */
function commitActivityHydrationCallbacks(
  finishedRoot: FiberRoot,
  finishedWork: Fiber,
) {
  // $FlowFixMe[constant-condition]
  if (!supportsHydration) {
    return;
  }
  const newState: ActivityState | null = finishedWork.memoizedState;
  if (newState === null) {
    const current = finishedWork.alternate;
    if (current !== null) {
      const prevState: ActivityState | null = current.memoizedState;
      if (prevState !== null) {
        const activityInstance = prevState.dehydrated;
        commitHostHydratedActivity(activityInstance, finishedWork);
        if (enableSuspenseCallback) {
          try {
            // TODO：删除此功能；DEV 功能目前无法正确覆盖它。
            const hydrationCallbacks = finishedRoot.hydrationCallbacks;
            if (hydrationCallbacks !== null) {
              const onHydrated = hydrationCallbacks.onHydrated;
              if (onHydrated) {
                onHydrated(activityInstance);
              }
            }
          } catch (error) {
            captureCommitPhaseError(finishedWork, finishedWork.return, error);
          }
        }
      }
    }
  }
}

/** Suspense dehydrated 实例完成 hydration 时通知宿主层。 */
function commitSuspenseHydrationCallbacks(
  finishedRoot: FiberRoot,
  finishedWork: Fiber,
) {
  // $FlowFixMe[constant-condition]
  if (!supportsHydration) {
    return;
  }
  const newState: SuspenseState | null = finishedWork.memoizedState;
  if (newState === null) {
    const current = finishedWork.alternate;
    if (current !== null) {
      const prevState: SuspenseState | null = current.memoizedState;
      if (prevState !== null) {
        const suspenseInstance = prevState.dehydrated;
        if (suspenseInstance !== null) {
          commitHostHydratedSuspense(suspenseInstance, finishedWork);
          if (enableSuspenseCallback) {
            try {
              // TODO：删除此功能；DEV 功能目前无法正确覆盖它。
              const hydrationCallbacks = finishedRoot.hydrationCallbacks;
              if (hydrationCallbacks !== null) {
                const onHydrated = hydrationCallbacks.onHydrated;
                if (onHydrated) {
                  onHydrated(suspenseInstance);
                }
              }
            } catch (error) {
              captureCommitPhaseError(finishedWork, finishedWork.return, error);
            }
          }
        }
      }
    }
  }
}

/** 获取或创建 Suspense/Offscreen retry thenable 缓存，确保每个 wakeable 只订阅一次。 */
function getRetryCache(finishedWork: Fiber) {
  // TODO：统一重试缓存接口，避免像这里一样按 tag 分派。
  switch (finishedWork.tag) {
    case ActivityComponent:
    case SuspenseComponent:
    case SuspenseListComponent: {
      let retryCache = finishedWork.stateNode;
      if (retryCache === null) {
        retryCache = finishedWork.stateNode = new PossiblyWeakSet();
      }
      return retryCache;
    }
    case OffscreenComponent: {
      const instance: OffscreenInstance = finishedWork.stateNode;
      let retryCache: null | Set<Wakeable> | WeakSet<Wakeable> =
        instance._retryCache;
      if (retryCache === null) {
        retryCache = instance._retryCache = new PossiblyWeakSet();
      }
      return retryCache;
    }
    default: {
      throw new Error(
        `Unexpected Suspense handler tag (${finishedWork.tag}). This is a ` +
          'bug in React.',
      );
    }
  }
}

/** 为 commit 阶段收集的 wakeable 注册 resolve/reject ping，并写入 retry cache 去重。 */
function attachSuspenseRetryListeners(
  finishedWork: Fiber,
  wakeables: RetryQueue,
) {
  // 若此边界刚刚超时，它会持有一组 wakeable。为每个 wakeable 注册监听器，
  // 在其解决后让 React 尝试以超时前的主内容状态重新渲染边界。
  const retryCache = getRetryCache(finishedWork);
  wakeables.forEach(wakeable => {
    // 以边界 Fiber 作为记忆化键，避免重复注册监听器。
    if (!retryCache.has(wakeable)) {
      retryCache.add(wakeable);

      if (enableUpdaterTracking) {
        if (isDevToolsPresent) {
          if (inProgressLanes !== null && inProgressRoot !== null) {
            // 若仍有待处理工作，将原始更新发起者与其关联。
            restorePendingUpdaters(inProgressRoot, inProgressLanes);
          } else {
            throw Error(
              'Expected finished root and lanes to be set. This is a bug in React.',
            );
          }
        }
      }

      const retry = resolveRetryWakeable.bind(null, finishedWork, wakeable);
      wakeable.then(retry, retry);
    }
  });
}

// 检测 Suspense 边界是否由可见变为隐藏；若边界原本已隐藏则返回 false。
// TODO：改用副作用标志。
/** 判断 Suspense 是否从显示 primary 切到 fallback，即其 primary Offscreen 本次开始隐藏。 */
function isSuspenseBoundaryBeingHidden(
  current: Fiber | null,
  finishedWork: Fiber,
): boolean {
  if (current !== null) {
    const oldState: SuspenseState | null = current.memoizedState;
    if (oldState === null || oldState.dehydrated !== null) {
      const newState: SuspenseState | null = finishedWork.memoizedState;
      return newState !== null && newState.dehydrated === null;
    }
  }
  return false;
}

/** mutation 阶段入口：提交删除、Placement、宿主更新、ref detach、可见性与资源变更。 */
export function commitMutationEffects(
  root: FiberRoot,
  finishedWork: Fiber,
  committedLanes: Lanes,
) {
  inProgressLanes = committedLanes;
  inProgressRoot = root;

  rootViewTransitionAffected = false;
  inUpdateViewTransition = false;

  resetComponentEffectTimers();

  commitMutationEffectsOnFiber(finishedWork, root, committedLanes);

  inProgressLanes = null;
  inProgressRoot = null;
}

/** 遍历含 MutationMask 的子树，先提交父 Fiber deletions，再访问 child mutation。 */
function recursivelyTraverseMutationEffects(
  root: FiberRoot,
  parentFiber: Fiber,
  lanes: Lanes,
) {
  // 删除副作用可安排在任意 Fiber 类型上，且必须先于子节点副作用执行。
  const deletions = parentFiber.deletions;
  if (deletions !== null) {
    for (let i = 0; i < deletions.length; i++) {
      const childToDelete = deletions[i];
      commitDeletionEffects(root, parentFiber, childToDelete);
    }
  }

  if (parentFiber.subtreeFlags & (MutationMask | Cloned)) {
    let child = parentFiber.child;
    while (child !== null) {
      commitMutationEffectsOnFiber(child, root, lanes);
      child = child.sibling;
    }
  }
}

let currentHoistableRoot: HoistableRoot | null = null;

/** 按 WorkTag 提交单 Fiber 的 reconciliation 与宿主 mutation，并递归相关子树。 */
function commitMutationEffectsOnFiber(
  finishedWork: Fiber,
  root: FiberRoot,
  lanes: Lanes,
) {
  const prevEffectStart = pushComponentEffectStart();
  const prevEffectDuration = pushComponentEffectDuration();
  const prevEffectErrors = pushComponentEffectErrors();
  const prevEffectDidSpawnUpdate = pushComponentEffectDidSpawnUpdate();
  const current = finishedWork.alternate;
  const flags = finishedWork.flags;

  // 应在细化 Fiber 类型后再检查副作用标志，因为 Fiber tag 提供更具体的类型信息。
  // 与协调相关的标志是例外，它们可能出现在所有 Fiber 类型上。
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case MemoComponent:
    case SimpleMemoComponent: {
      // 向下遍历时、变更副作用之前更新事件副作用回调，确保父级事件副作用先于子级更新。
      // 这不是受支持的用法，未来可以重新评估，但已发布版本采用了这一顺序。
      if (enableEffectEventMutationPhase) {
        if (flags & Update) {
          const updateQueue: FunctionComponentUpdateQueue | null =
            finishedWork.updateQueue as any;
          const eventPayloads =
            updateQueue !== null ? updateQueue.events : null;
          if (eventPayloads !== null) {
            for (let ii = 0; ii < eventPayloads.length; ii++) {
              const {ref, nextImpl} = eventPayloads[ii];
              ref.impl = nextImpl;
            }
          }
        }
      }
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork, lanes);

      if (flags & Update) {
        commitHookEffectListUnmount(
          HookInsertion | HookHasEffect,
          finishedWork,
          finishedWork.return,
        );
        // TODO：使用 commitHookInsertionUnmountEffects 包装器记录耗时。
        commitHookEffectListMount(HookInsertion | HookHasEffect, finishedWork);
        commitHookLayoutUnmountEffects(
          finishedWork,
          finishedWork.return,
          HookLayout | HookHasEffect,
        );
      }
      break;
    }
    case ClassComponent: {
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork, lanes);

      if (flags & Ref) {
        if (!offscreenSubtreeWasHidden && current !== null) {
          safelyDetachRef(current, current.return);
        }
      }

      if (flags & Callback && offscreenSubtreeIsHidden) {
        const updateQueue: UpdateQueue<mixed> | null =
          finishedWork.updateQueue as any;
        if (updateQueue !== null) {
          deferHiddenCallbacks(updateQueue);
        }
      }
      break;
    }
    case HostHoistable: {
      // $FlowFixMe[constant-condition]
      if (supportsResources) {
        // React 根处总会设置 root，因此处理变更副作用期间它不可能为 null；据此进行类型转换。
        const hoistableRoot: HoistableRoot = currentHoistableRoot as any;
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        commitReconciliationEffects(finishedWork, lanes);

        if (flags & Ref) {
          if (!offscreenSubtreeWasHidden && current !== null) {
            safelyDetachRef(current, current.return);
          }
        }

        if (flags & Update) {
          const currentResource =
            current !== null ? current.memoizedState : null;
          const newResource = finishedWork.memoizedState;
          if (current === null) {
            // 正在挂载新的 HostHoistable Fiber；根据实例是 Hoistable Instance 还是
            // Hoistable Resource 选择不同挂载路径。
            if (newResource === null) {
              if (finishedWork.stateNode === null) {
                finishedWork.stateNode = hydrateHoistable(
                  hoistableRoot,
                  finishedWork.type,
                  finishedWork.memoizedProps,
                  finishedWork,
                );
              } else {
                mountHoistable(
                  hoistableRoot,
                  finishedWork.type,
                  finishedWork.stateNode,
                );
              }
            } else {
              finishedWork.stateNode = acquireResource(
                hoistableRoot,
                newResource,
                finishedWork.memoizedProps,
              );
            }
          } else if (currentResource !== newResource) {
            // 正在进入、离开 Hoistable Resource，或在不同 Hoistable Resource 之间切换。
            if (currentResource === null) {
              if (current.stateNode !== null) {
                unmountHoistable(current.stateNode);
              }
            } else {
              releaseResource(currentResource);
            }
            if (newResource === null) {
              mountHoistable(
                hoistableRoot,
                finishedWork.type,
                finishedWork.stateNode,
              );
            } else {
              acquireResource(
                hoistableRoot,
                newResource,
                finishedWork.memoizedProps,
              );
            }
          } else if (newResource === null && finishedWork.stateNode !== null) {
            commitHostUpdate(
              finishedWork,
              finishedWork.memoizedProps,
              current.memoizedProps,
            );
          }
        }
        break;
      }
      // 继续落入下一分支。
    }
    case HostSingleton: {
      // $FlowFixMe[constant-condition]
      if (supportsSingletons) {
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        commitReconciliationEffects(finishedWork, lanes);
        if (flags & Ref) {
          if (!offscreenSubtreeWasHidden && current !== null) {
            safelyDetachRef(current, current.return);
          }
        }
        if (current !== null && flags & Update) {
          const newProps = finishedWork.memoizedProps;
          const oldProps = current.memoizedProps;
          commitHostUpdate(finishedWork, newProps, oldProps);
        }
        break;
      }
      // 继续落入下一分支。
    }
    case HostComponent: {
      // 已遇到宿主组件，因此更深层节点不再是当前节点的直接宿主子级。
      const prevOffscreenDirectParentIsHidden = offscreenDirectParentIsHidden;
      offscreenDirectParentIsHidden = false;

      recursivelyTraverseMutationEffects(root, finishedWork, lanes);

      offscreenDirectParentIsHidden = prevOffscreenDirectParentIsHidden;

      commitReconciliationEffects(finishedWork, lanes);

      if (flags & Ref) {
        if (!offscreenSubtreeWasHidden && current !== null) {
          safelyDetachRef(current, current.return);
        }
      }
      // $FlowFixMe[constant-condition]
      if (supportsMutation) {
        // TODO：提交阶段子节点会清除 ContentReset，这带来重构风险：必须在
        // commitReconciliationEffects 运行后读取 flags，执行顺序不可交换。
        // 应改为在渲染阶段设置独立标志，避免 ContentReset 依赖提交期间修改标志。
        if (finishedWork.flags & ContentReset) {
          commitHostResetTextContent(finishedWork);
        }

        if (flags & Update) {
          const instance: Instance = finishedWork.stateNode;
          if (instance != null) {
            // 提交此前准备好的工作。水合会复用更新路径，但把 oldProps 当作 newProps；
            // 此时真正的变更包含在 updatePayload 中。
            const newProps = finishedWork.memoizedProps;
            const oldProps =
              current !== null ? current.memoizedProps : newProps;
            commitHostUpdate(finishedWork, newProps, oldProps);
          }
        }

        if (flags & FormReset) {
          needsFormReset = true;
          if (__DEV__) {
            if (finishedWork.type !== 'form') {
              // 防御性检查，避免 FormReset 位将来意外被复用于其他含义。
              console.error(
                'Unexpected host component type. Expected a form. This is a ' +
                  'bug in React.',
              );
            }
          }
        }
      } else {
        // $FlowFixMe[constant-condition]
        if (supportsPersistence) {
          if (finishedWork.alternate !== null) {
            // 此时 finishedWork.alternate.stateNode 指向旧 shadow node，导致它及其子树被保留。
            // 将 alternate.stateNode 改指向新 shadow node，以及时回收旧节点内存。
            // React Native 的 ShadowNodeReferenceCounter-itest.js#L150 验证了该行为。
            finishedWork.alternate.stateNode = finishedWork.stateNode;
          }
        }
      }
      break;
    }
    case HostText: {
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork, lanes);

      if (flags & Update) {
        // $FlowFixMe[constant-condition]
        if (supportsMutation) {
          if (finishedWork.stateNode === null) {
            throw new Error(
              'This should have a text node initialized. This error is likely ' +
                'caused by a bug in React. Please file an issue.',
            );
          }

          const newText: string = finishedWork.memoizedProps;
          // 水合复用更新路径，但把 oldProps 当作 newProps；此时真正的变更包含在 updatePayload 中。
          const oldText: string =
            current !== null ? current.memoizedProps : newText;

          commitHostTextUpdate(finishedWork, newText, oldText);
        }
      }
      break;
    }
    case HostRoot: {
      const prevProfilerEffectDuration = pushNestedEffectDurations();

      pushRootMutationContext();
      // $FlowFixMe[constant-condition]
      if (supportsResources) {
        prepareToCommitHoistables();

        const previousHoistableRoot = currentHoistableRoot;
        currentHoistableRoot = getHoistableRoot(root.containerInfo);

        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        currentHoistableRoot = previousHoistableRoot;

        commitReconciliationEffects(finishedWork, lanes);
      } else {
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        commitReconciliationEffects(finishedWork, lanes);
      }

      if (flags & Update) {
        // $FlowFixMe[constant-condition]
        if (supportsMutation && supportsHydration) {
          if (current !== null) {
            const prevRootState: RootState = current.memoizedState;
            if (prevRootState.isDehydrated) {
              commitHostHydratedContainer(root, finishedWork);
            }
          }
        }
        // $FlowFixMe[constant-condition]
        if (supportsPersistence) {
          commitHostRootContainerChildren(root, finishedWork);
        }
      }

      if (needsFormReset) {
        // 某个表单组件请求在本次提交中重置。重置要等树中其余变更全部完成后执行，
        // 以确保 defaultValue 已更新；这样可用表单提交后服务端返回的数据更新 defaultValue。
        //
        // 理论上可检查 finishedWork.subtreeFlags & FormReset，但 FormReset 位与其他 Fiber 类型
        // 使用的标志复用。这个额外变量能让未实际提交表单时跳过树遍历。
        needsFormReset = false;
        recursivelyResetForms(finishedWork);
      }

      if (enableProfilerTimer && enableProfilerCommitHooks) {
        root.effectDuration += popNestedEffectDurations(
          prevProfilerEffectDuration,
        );
      }

      popMutationContext(false);

      if (
        enableDefaultTransitionIndicator &&
        rootMutationContext &&
        includesLoadingIndicatorLanes(lanes)
      ) {
        // 此根发生了变更，将其标记为已渲染手动 loading 状态。
        markIndicatorHandled(root);
      }

      break;
    }
    case HostPortal: {
      // 对可见性切换而言，Portal 的直接子节点都视为最近隐藏 OffscreenComponent 的“子节点”，
      // 无论两者之间是否隔着宿主组件。Portal 不属于常规宿主树层级，React 树中的
      // HostComponent 父节点不一定也是实际宿主树父节点，因此必须显式隐藏所有这些子节点。
      const prevOffscreenDirectParentIsHidden = offscreenDirectParentIsHidden;
      offscreenDirectParentIsHidden = offscreenSubtreeIsHidden;
      const prevMutationContext = pushMutationContext();
      // $FlowFixMe[constant-condition]
      if (supportsResources) {
        const previousHoistableRoot = currentHoistableRoot;
        currentHoistableRoot = getHoistableRoot(
          finishedWork.stateNode.containerInfo,
        );
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        commitReconciliationEffects(finishedWork, lanes);
        currentHoistableRoot = previousHoistableRoot;
      } else {
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        commitReconciliationEffects(finishedWork, lanes);
      }
      if (viewTransitionMutationContext && inUpdateViewTransition) {
        // Portal 不一定处于此子树的上下文内。理想情况下应跟踪哪个 React ViewTransition 组件
        // 包含该容器，但代价较高；因此把每个 Portal 视为新的 React 根，任何泄漏出来的变更
        // 都意味着该根需要执行动画。
        rootViewTransitionAffected = true;
      }
      popMutationContext(prevMutationContext);
      offscreenDirectParentIsHidden = prevOffscreenDirectParentIsHidden;

      if (flags & Update) {
        // $FlowFixMe[constant-condition]
        if (supportsPersistence) {
          commitHostPortalContainerChildren(
            finishedWork.stateNode,
            finishedWork,
            finishedWork.stateNode.pendingChildren,
          );
        }
      }
      break;
    }
    case Profiler: {
      const prevProfilerEffectDuration = pushNestedEffectDurations();

      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork, lanes);

      if (enableProfilerTimer && enableProfilerCommitHooks) {
        const profilerInstance = finishedWork.stateNode;
        // 将布局副作用耗时传播给最近的上级 Profiler。
        // 到下一次渲染前不要重置这些值，确保 DevTools 有机会读取。
        profilerInstance.effectDuration += bubbleNestedEffectDurations(
          prevProfilerEffectDuration,
        );
      }
      break;
    }
    case ActivityComponent: {
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork, lanes);
      if (flags & Update) {
        const retryQueue: RetryQueue | null = finishedWork.updateQueue as any;
        if (retryQueue !== null) {
          finishedWork.updateQueue = null;
          attachSuspenseRetryListeners(finishedWork, retryQueue);
        }
      }
      break;
    }
    case SuspenseComponent: {
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork, lanes);

      // TODO：应直接在 Suspense Fiber 上标志，而不是依赖 Offscreen Fiber 同时带标志。
      // 该 Offscreen Fiber 可能不属于 work-in-progress 树，而是从先前渲染复用。
      // 当前逻辑还会在下方显式比较状态，因此不会产生错误行为；但从建模角度应只靠标志检查，
      // 目前实现较脆弱。
      //
      // 此外，这些逻辑可以且应移到被动阶段，避免阻塞绘制。
      const offscreenFiber: Fiber = finishedWork.child as any;
      if (offscreenFiber.flags & Visibility) {
        // 对 Suspense fallback 的出现与消失进行节流。
        const isShowingFallback =
          (finishedWork.memoizedState as SuspenseState | null) !== null;
        const wasShowingFallback =
          current !== null &&
          (current.memoizedState as SuspenseState | null) !== null;

        if (alwaysThrottleRetries) {
          if (isShowingFallback !== wasShowingFallback) {
            // fallback 正在出现或消失。
            markCommitTimeOfFallback();
          }
        } else {
          if (isShowingFallback && !wasShowingFallback) {
            // 旧行为：只在 fallback 出现时标记，消失时不标记。
            markCommitTimeOfFallback();
          }
        }
      }

      if (flags & Update) {
        try {
          commitSuspenseCallback(finishedWork);
        } catch (error) {
          captureCommitPhaseError(finishedWork, finishedWork.return, error);
        }
        const retryQueue: RetryQueue | null = finishedWork.updateQueue as any;
        if (retryQueue !== null) {
          finishedWork.updateQueue = null;
          attachSuspenseRetryListeners(finishedWork, retryQueue);
        }
      }
      break;
    }
    case OffscreenComponent: {
      const newState: OffscreenState | null = finishedWork.memoizedState;
      const isHidden = newState !== null;
      const wasHidden = current !== null && current.memoizedState !== null;

      if (disableLegacyMode || finishedWork.mode & ConcurrentMode) {
        // 提交子节点前，在栈中记录此 Offscreen 子树先前是否已隐藏，避免重复卸载副作用。
        const prevOffscreenSubtreeIsHidden = offscreenSubtreeIsHidden;
        const prevOffscreenSubtreeWasHidden = offscreenSubtreeWasHidden;
        const prevOffscreenDirectParentIsHidden = offscreenDirectParentIsHidden;
        offscreenSubtreeIsHidden = prevOffscreenSubtreeIsHidden || isHidden;
        offscreenDirectParentIsHidden =
          prevOffscreenDirectParentIsHidden || isHidden;
        offscreenSubtreeWasHidden = prevOffscreenSubtreeWasHidden || wasHidden;
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        offscreenSubtreeWasHidden = prevOffscreenSubtreeWasHidden;
        offscreenDirectParentIsHidden = prevOffscreenDirectParentIsHidden;
        offscreenSubtreeIsHidden = prevOffscreenSubtreeIsHidden;

        if (
          // 若这是重新出现路径的根。
          wasHidden &&
          !isHidden &&
          !prevOffscreenSubtreeIsHidden &&
          !prevOffscreenSubtreeWasHidden &&
          enableProfilerTimer &&
          enableProfilerCommitHooks &&
          enableComponentPerformanceTrack &&
          (finishedWork.mode & ProfileMode) !== NoMode &&
          componentEffectStartTime >= 0 &&
          componentEffectEndTime >= 0 &&
          componentEffectEndTime - componentEffectStartTime > 0.05
        ) {
          logComponentReappeared(
            finishedWork,
            componentEffectStartTime,
            componentEffectEndTime,
          );
        }
      } else {
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      }

      commitReconciliationEffects(finishedWork, lanes);

      if (flags & Visibility) {
        const offscreenInstance: OffscreenInstance = finishedWork.stateNode;

        // 在 Offscreen 实例上记录当前状态，以便事件处理期间读取。
        if (isHidden) {
          offscreenInstance._visibility &= ~OffscreenVisible;
        } else {
          offscreenInstance._visibility |= OffscreenVisible;
        }

        const isUpdate = current !== null;
        if (isHidden) {
          // 仅在以下条件同时成立时触发消失布局副作用：
          //   - 当前是更新而非首次挂载；
          //   - 此 Offscreen 先前未隐藏；
          //   - 祖先 Offscreen 在上次提交与本次提交中都未隐藏。
          if (
            isUpdate &&
            !wasHidden &&
            !offscreenSubtreeIsHidden &&
            !offscreenSubtreeWasHidden
          ) {
            if (
              disableLegacyMode ||
              (finishedWork.mode & ConcurrentMode) !== NoMode
            ) {
              // 让所有子节点的布局副作用进入消失状态。
              let layoutEffectTraversalFlags: LayoutEffectTraversalFlags;
              // $FlowFixMe[constant-condition]
              if (supportsSingletons) {
                layoutEffectTraversalFlags = IncludeHostSingletons;
              } else {
                layoutEffectTraversalFlags = NoLayoutEffectTraversalFlags;
              }
              recursivelyTraverseDisappearLayoutEffects(
                finishedWork,
                layoutEffectTraversalFlags,
              );

              if (
                enableProfilerTimer &&
                enableProfilerCommitHooks &&
                enableComponentPerformanceTrack &&
                (finishedWork.mode & ProfileMode) !== NoMode &&
                componentEffectStartTime >= 0 &&
                componentEffectEndTime >= 0 &&
                componentEffectEndTime - componentEffectStartTime > 0.05
              ) {
                logComponentDisappeared(
                  finishedWork,
                  componentEffectStartTime,
                  componentEffectEndTime,
                );
              }
            }
          }
        }

        // $FlowFixMe[constant-condition]
        if (supportsMutation) {
          // 若当前节点尝试显示但父节点仍隐藏，则不能显示当前节点。
          if (isHidden || !offscreenDirectParentIsHidden) {
            hideOrUnhideAllChildren(finishedWork, isHidden);
          }
        }
      }

      // TODO：移到被动阶段。
      if (flags & Update) {
        const offscreenQueue: OffscreenQueue | null =
          finishedWork.updateQueue as any;
        if (offscreenQueue !== null) {
          const retryQueue = offscreenQueue.retryQueue;
          if (retryQueue !== null) {
            offscreenQueue.retryQueue = null;
            attachSuspenseRetryListeners(finishedWork, retryQueue);
          }
        }
      }
      break;
    }
    case SuspenseListComponent: {
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork, lanes);

      if (flags & Update) {
        const retryQueue: Set<Wakeable> | null =
          finishedWork.updateQueue as any;
        if (retryQueue !== null) {
          finishedWork.updateQueue = null;
          attachSuspenseRetryListeners(finishedWork, retryQueue);
        }
      }
      break;
    }
    case ViewTransitionComponent: {
      if (enableViewTransition) {
        if (flags & Ref) {
          if (!offscreenSubtreeWasHidden && current !== null) {
            safelyDetachRef(current, current.return);
          }
        }
        const prevMutationContext = pushMutationContext();
        const prevUpdate = inUpdateViewTransition;
        const isViewTransitionEligible =
          // $FlowFixMe[constant-condition]
          enableViewTransition &&
          includesOnlyViewTransitionEligibleLanes(lanes);
        const props = finishedWork.memoizedProps;
        inUpdateViewTransition =
          isViewTransitionEligible &&
          getViewTransitionClassName(props.default, props.update) !== 'none';
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        commitReconciliationEffects(finishedWork, lanes);
        if (isViewTransitionEligible) {
          if (current === null) {
            // 这是一次新挂载：要么已由 Placement 副作用处理，要么位于更深层的进入过渡中。
          } else if (viewTransitionMutationContext) {
            // 此树中发生了变更，因此无论测量结果如何都需要执行动画；使用 Update 标志跟踪。
            // 若仍像过去一样在渲染阶段做差异比较，这项判断本可在渲染时完成。
            finishedWork.flags |= Update;
          }
        }
        inUpdateViewTransition = prevUpdate;
        popMutationContext(prevMutationContext);
        break;
      }
      break;
    }
    case ScopeComponent: {
      if (enableScopeAPI) {
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        commitReconciliationEffects(finishedWork, lanes);

        // TODO：这是帮助 www 从 React Flare 迁出的临时方案。
        if (flags & Ref) {
          if (!offscreenSubtreeWasHidden && current !== null) {
            safelyDetachRef(finishedWork, finishedWork.return);
          }
          if (!offscreenSubtreeIsHidden) {
            safelyAttachRef(finishedWork, finishedWork.return);
          }
        }
        if (flags & Update) {
          const scopeInstance = finishedWork.stateNode;
          prepareScopeUpdate(scopeInstance, finishedWork);
        }
      }
      break;
    }
    case Fragment:
      if (enableFragmentRefs) {
        if (current && current.stateNode !== null) {
          updateFragmentInstanceFiber(finishedWork, current.stateNode);
        }
      }
    // 继续落入下一分支。
    default: {
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork, lanes);

      break;
    }
  }

  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    enableComponentPerformanceTrack &&
    (finishedWork.mode & ProfileMode) !== NoMode &&
    componentEffectStartTime >= 0 &&
    componentEffectEndTime >= 0
  ) {
    if (componentEffectSpawnedUpdate || componentEffectDuration > 0.05) {
      logComponentEffect(
        finishedWork,
        componentEffectStartTime,
        componentEffectEndTime,
        componentEffectDuration,
        componentEffectErrors,
      );
    }
    if (
      // 插入阶段。
      finishedWork.alternate === null &&
      finishedWork.return !== null &&
      finishedWork.return.alternate !== null &&
      componentEffectEndTime - componentEffectStartTime > 0.05
    ) {
      const isHydration = isHydratingParent(
        finishedWork.return.alternate,
        finishedWork.return,
      );
      if (!isHydration) {
        logComponentMount(
          finishedWork,
          componentEffectStartTime,
          componentEffectEndTime,
        );
      }
    }
  }

  popComponentEffectStart(prevEffectStart);
  popComponentEffectDuration(prevEffectDuration);
  popComponentEffectErrors(prevEffectErrors);
  popComponentEffectDidSpawnUpdate(prevEffectDidSpawnUpdate);
}

/** 提交 Placement/Hydrating 标志：把新宿主子树插入父容器，并清除已消费标志。 */
function commitReconciliationEffects(
  finishedWork: Fiber,
  committedLanes: Lanes,
) {
  // Placement 副作用（插入、重排）可安排在任意 Fiber 类型上；它必须在子节点副作用之后、
  // 当前 Fiber 的副作用之前执行。
  const flags = finishedWork.flags;
  if (flags & Placement) {
    commitHostPlacement(finishedWork);
    // 在 componentDidMount 等生命周期调用前清除副作用 tag 中的 placement，表明节点已插入。
    // TODO：findDOMNode 已不依赖此行为；仍依赖它的 isMounted 也已弃用，因此应可删除。
    finishedWork.flags &= ~Placement;
  }
  if (flags & Hydrating) {
    finishedWork.flags &= ~Hydrating;
  }
}

/** 遍历 NeedsFormReset 子树，重置本次 action 提交涉及的宿主 form。 */
function recursivelyResetForms(parentFiber: Fiber) {
  if (parentFiber.subtreeFlags & FormReset) {
    let child = parentFiber.child;
    while (child !== null) {
      resetFormOnFiber(child);
      child = child.sibling;
    }
  }
}

/** 对单 HostComponent 调用宿主 resetForm。 */
function resetFormOnFiber(fiber: Fiber) {
  recursivelyResetForms(fiber);
  if (fiber.tag === HostComponent && fiber.flags & FormReset) {
    const formInstance: FormInstance = fiber.stateNode;
    resetFormInstance(formInstance);
  }
}

/** mutation 之后、layout 之前入口：重置 form，并处理 ViewTransition/手势相关后置 mutation。 */
export function commitAfterMutationEffects(
  root: FiberRoot,
  finishedWork: Fiber,
  committedLanes: Lanes,
): void {
  if (!enableViewTransition) {
    // 此阶段只用于 View Transition。
    return;
  }
  commitAfterMutationEffectsOnFiber(finishedWork, root, committedLanes);
}

/** 遍历含 after-mutation 标志的子树，并累计 ViewTransition 父布局影响。 */
function recursivelyTraverseAfterMutationEffects(
  root: FiberRoot,
  parentFiber: Fiber,
  lanes: Lanes,
) {
  // 这里必须访问与变更前阶段相同的节点。
  if (parentFiber.subtreeFlags & BeforeAndAfterMutationTransitionMask) {
    let child = parentFiber.child;
    while (child !== null) {
      commitAfterMutationEffectsOnFiber(child, root, lanes);
      child = child.sibling;
    }
  } else {
    // 此子树自身没有变更，但父节点仍可能影响其尺寸和位置。需要重新测量；若未受影响，
    // 就恢复状态以避免动画。
    measureNestedViewTransitions(parentFiber, false);
  }
}

/** 按 Fiber 提交 after-mutation ViewTransition 测量、名称取消及层级状态恢复。 */
function commitAfterMutationEffectsOnFiber(
  finishedWork: Fiber,
  root: FiberRoot,
  lanes: Lanes,
) {
  const current = finishedWork.alternate;
  if (current === null) {
    // 这是新插入的子树。Placement 标志在变更阶段会被移除，无法用于检测；通常只检查 current
    // 也不够，因为同一棵树更深处也可能没有 current。但 AfterMutation 无需访问新插入子树，
    // 因而处理完第一个后即可退出。新挂载树中的首个 ViewTransition 执行进入过渡，
    // 其他嵌套项只有存在命名配对时才执行。
    commitEnterViewTransitions(finishedWork, false);
    return;
  }

  switch (finishedWork.tag) {
    case HostRoot: {
      viewTransitionContextChanged = false;
      rootViewTransitionNameCanceled = false;
      pushViewTransitionCancelableScope();
      recursivelyTraverseAfterMutationEffects(root, finishedWork, lanes);
      if (!viewTransitionContextChanged && !rootViewTransitionAffected) {
        // 若尺寸变化没有泄漏到根，就无需让根本身执行过渡；此时可安全撤销一路冒泡到根的取消标记。
        const cancelableChildren = viewTransitionCancelableChildren;
        if (cancelableChildren !== null) {
          for (let i = 0; i < cancelableChildren.length; i += 3) {
            cancelViewTransitionName(
              cancelableChildren[i] as any as Instance,
              cancelableChildren[i + 1] as any as string,
              cancelableChildren[i + 2] as any as Props,
            );
          }
        }
        // 同时取消根自身的过渡。
        cancelRootViewTransitionName(root.containerInfo);
        rootViewTransitionNameCanceled = true;
      }
      popViewTransitionCancelableScope(null);
      break;
    }
    case HostComponent: {
      recursivelyTraverseAfterMutationEffects(root, finishedWork, lanes);
      break;
    }
    case HostPortal: {
      const prevContextChanged = viewTransitionContextChanged;
      viewTransitionContextChanged = false;
      recursivelyTraverseAfterMutationEffects(root, finishedWork, lanes);
      if (viewTransitionContextChanged) {
        // Portal 不一定处于此子树上下文内。理想情况下应跟踪哪个 React ViewTransition 组件
        // 包含该容器，但代价较高；因此把每个 Portal 视为新的 React 根。任何子节点尺寸变化泄漏
        // 都可能影响根，根应执行动画。仅当 Portal 位于 ViewTransition 内且未用 update="none"
        // 禁用时才这样处理，否则视为该 Portal 不参与动画。
        rootViewTransitionAffected = true;
      }
      viewTransitionContextChanged = prevContextChanged;
      break;
    }
    case OffscreenComponent: {
      const isModernRoot =
        disableLegacyMode || (finishedWork.mode & ConcurrentMode) !== NoMode;
      if (isModernRoot) {
        const isHidden = finishedWork.memoizedState !== null;
        if (isHidden) {
          // Offscreen 树处于隐藏状态，跳过其变更后副作用。
        } else {
          // Offscreen 树处于可见状态。
          const wasHidden = current.memoizedState !== null;
          if (wasHidden) {
            commitEnterViewTransitions(finishedWork, false);
            // 若它先前隐藏，则子节点按进入而非更新处理，无需继续访问这些子节点。
          } else {
            recursivelyTraverseAfterMutationEffects(root, finishedWork, lanes);
          }
        }
      } else {
        recursivelyTraverseAfterMutationEffects(root, finishedWork, lanes);
      }
      break;
    }
    case ViewTransitionComponent: {
      const prevContextChanged = viewTransitionContextChanged;
      const prevCancelableChildren = pushViewTransitionCancelableScope();
      viewTransitionContextChanged = false;
      recursivelyTraverseAfterMutationEffects(root, finishedWork, lanes);

      if (viewTransitionContextChanged) {
        finishedWork.flags |= Update;
      }

      const inViewport = measureUpdateViewTransition(
        current,
        finishedWork,
        false,
      );

      if ((finishedWork.flags & Update) === NoFlags || !inViewport) {
        // 若此边界未更新，其子节点可能可以取消；先把它们冒泡到父集合，稍后再决定。
        // 同理，若新旧状态都在视口外，即使发生更新也可以跳过。
        if (prevCancelableChildren === null) {
          // 将整个集合冒泡到父级。
        } else {
          // 与父集合合并。
          // $FlowFixMe[method-unbinding]
          prevCancelableChildren.push.apply(
            prevCancelableChildren,
            viewTransitionCancelableChildren,
          );
          popViewTransitionCancelableScope(prevCancelableChildren);
        }
        // TODO：若因父节点执行动画而最终没有取消，应触发事件，因为此实例也参与其中。
      } else {
        const props: ViewTransitionProps = finishedWork.memoizedProps;
        scheduleViewTransitionEvent(finishedWork, props.onUpdate);

        // 若此边界确实更新，就不能取消其子节点，因此丢弃候选集合。
        popViewTransitionCancelableScope(prevCancelableChildren);
      }

      if ((finishedWork.flags & AffectedParentLayout) !== NoFlags) {
        // 此边界的尺寸变化可能导致父节点重新布局，需要把该信息向父级冒泡。
        viewTransitionContextChanged = true;
      } else {
        // 否则恢复为父级目前已计算出的状态。
        viewTransitionContextChanged = prevContextChanged;
      }
      break;
    }
    default: {
      recursivelyTraverseAfterMutationEffects(root, finishedWork, lanes);
      break;
    }
  }
}

/** layout 阶段入口：挂载 layout/insertion 结果、class 生命周期、ref 与宿主 mount 回调。 */
export function commitLayoutEffects(
  finishedWork: Fiber,
  root: FiberRoot,
  committedLanes: Lanes,
): void {
  inProgressLanes = committedLanes;
  inProgressRoot = root;

  resetComponentEffectTimers();

  const current = finishedWork.alternate;
  commitLayoutEffectOnFiber(root, current, finishedWork, committedLanes);

  inProgressLanes = null;
  inProgressRoot = null;
}

/** 遍历含 LayoutMask 的 child，并按遍历标志选择 WIP/singleton effect。 */
function recursivelyTraverseLayoutEffects(
  root: FiberRoot,
  parentFiber: Fiber,
  lanes: Lanes,
) {
  if (parentFiber.subtreeFlags & LayoutMask) {
    let child = parentFiber.child;
    while (child !== null) {
      const current = child.alternate;
      commitLayoutEffectOnFiber(root, current, child, lanes);
      child = child.sibling;
    }
  }
}

/** 开发期验证入口：模拟隐藏子树并卸载 layout effect。 */
export function disappearLayoutEffectsForDEVValidation(finishedWork: Fiber) {
  if (__DEV__) {
    disappearLayoutEffects(finishedWork, NoLayoutEffectTraversalFlags);
  }
}

/** Offscreen 隐藏时递归卸载 layout effect、class componentDidMount/ref 与 singleton。 */
function disappearLayoutEffects(
  finishedWork: Fiber,
  layoutEffectTraversalFlags: LayoutEffectTraversalFlags,
) {
  const prevEffectStart = pushComponentEffectStart();
  const prevEffectDuration = pushComponentEffectDuration();
  const prevEffectErrors = pushComponentEffectErrors();
  const prevEffectDidSpawnUpdate = pushComponentEffectDidSpawnUpdate();
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case MemoComponent:
    case SimpleMemoComponent: {
      // TODO（Offscreen）：检查 flags & LayoutStatic。
      commitHookLayoutUnmountEffects(
        finishedWork,
        finishedWork.return,
        HookLayout,
      );
      recursivelyTraverseDisappearLayoutEffects(
        finishedWork,
        layoutEffectTraversalFlags,
      );
      break;
    }
    case ClassComponent: {
      // TODO（Offscreen）：检查 flags & RefStatic。
      safelyDetachRef(finishedWork, finishedWork.return);

      const instance = finishedWork.stateNode;
      if (typeof instance.componentWillUnmount === 'function') {
        safelyCallComponentWillUnmount(
          finishedWork,
          finishedWork.return,
          instance,
        );
      }

      recursivelyTraverseDisappearLayoutEffects(
        finishedWork,
        layoutEffectTraversalFlags,
      );
      break;
    }
    case HostSingleton: {
      // $FlowFixMe[constant-condition]
      if (supportsSingletons) {
        const includeHostSingletons =
          (layoutEffectTraversalFlags & IncludeHostSingletons) !==
          NoLayoutEffectTraversalFlags;
        if (includeHostSingletons) {
          // TODO（Offscreen）：检查 flags & RefStatic。
          commitHostSingletonRelease(finishedWork);
        }
      }
      // 预期继续落入 HostComponent 分支。
    }
    case HostHoistable:
    case HostComponent: {
      // TODO（Offscreen）：检查 flags & RefStatic。
      safelyDetachRef(finishedWork, finishedWork.return);

      if (
        enableFragmentRefs &&
        (finishedWork.tag === HostComponent ||
          finishedWork.tag === HostSingleton ||
          (enableFragmentRefsTextNodes && finishedWork.tag === HostText))
      ) {
        commitFragmentInstanceDeletionEffects(finishedWork);
      }

      recursivelyTraverseDisappearLayoutEffects(
        finishedWork,
        layoutEffectTraversalFlags,
      );
      break;
    }
    case OffscreenComponent: {
      const isHidden = finishedWork.memoizedState !== null;
      if (isHidden) {
        // 嵌套 Offscreen 树已隐藏，不要再次让其副作用消失。
      } else {
        recursivelyTraverseDisappearLayoutEffects(
          finishedWork,
          layoutEffectTraversalFlags,
        );
      }
      break;
    }
    case ViewTransitionComponent: {
      if (enableViewTransition) {
        if (__DEV__) {
          if (finishedWork.flags & ViewTransitionNamedStatic) {
            untrackNamedViewTransition(finishedWork);
          }
        }
        safelyDetachRef(finishedWork, finishedWork.return);
      }
      recursivelyTraverseDisappearLayoutEffects(
        finishedWork,
        layoutEffectTraversalFlags,
      );
      break;
    }
    case Fragment: {
      if (enableFragmentRefs) {
        safelyDetachRef(finishedWork, finishedWork.return);
      }
      // 继续落入下一分支。
    }
    default: {
      recursivelyTraverseDisappearLayoutEffects(
        finishedWork,
        layoutEffectTraversalFlags,
      );
      break;
    }
  }

  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    enableComponentPerformanceTrack &&
    (finishedWork.mode & ProfileMode) !== NoMode &&
    componentEffectStartTime >= 0 &&
    componentEffectEndTime >= 0 &&
    (componentEffectSpawnedUpdate || componentEffectDuration > 0.05)
  ) {
    logComponentEffect(
      finishedWork,
      componentEffectStartTime,
      componentEffectEndTime,
      componentEffectDuration,
      componentEffectErrors,
    );
  }

  popComponentEffectStart(prevEffectStart);
  popComponentEffectDuration(prevEffectDuration);
  popComponentEffectErrors(prevEffectErrors);
  popComponentEffectDidSpawnUpdate(prevEffectDidSpawnUpdate);
}

/** 遍历隐藏子树并执行 disappearLayoutEffects，维护 offscreen 隐藏上下文。 */
function recursivelyTraverseDisappearLayoutEffects(
  parentFiber: Fiber,
  layoutEffectTraversalFlags: LayoutEffectTraversalFlags,
) {
  // TODO（Offscreen）：检查 subtreeFlags & (RefStatic | LayoutStatic)。
  let child = parentFiber.child;
  while (child !== null) {
    disappearLayoutEffects(child, layoutEffectTraversalFlags);
    child = child.sibling;
  }
}

/** 开发期验证入口：模拟隐藏子树重新出现并挂载 layout effect。 */
export function reappearLayoutEffectsForDEVValidation(
  finishedRoot: FiberRoot,
  current: Fiber | null,
  finishedWork: Fiber,
) {
  if (__DEV__) {
    reappearLayoutEffects(
      finishedRoot,
      current,
      finishedWork,
      NoLayoutEffectTraversalFlags,
    );
  }
}

/** Offscreen 重现时递归挂载 layout effect、class 生命周期/ref 与 singleton。 */
function reappearLayoutEffects(
  finishedRoot: FiberRoot,
  current: Fiber | null,
  finishedWork: Fiber,
  // 此函数既访问刚完成的工作，也访问从先前已提交树复用的节点；节点复用时不能检查非静态标志。
  layoutEffectTraversalFlags: LayoutEffectTraversalFlags,
) {
  const prevEffectStart = pushComponentEffectStart();
  const prevEffectDuration = pushComponentEffectDuration();
  const prevEffectErrors = pushComponentEffectErrors();
  const prevEffectDidSpawnUpdate = pushComponentEffectDidSpawnUpdate();
  // 重新启用先前已消失树中的布局副作用。
  const flags = finishedWork.flags;
  const includeWorkInProgressEffects =
    (layoutEffectTraversalFlags & IncludeWorkInProgressEffects) !==
    NoLayoutEffectTraversalFlags;
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      recursivelyTraverseReappearLayoutEffects(
        finishedRoot,
        finishedWork,
        layoutEffectTraversalFlags,
      );
      // TODO：检查 flags & LayoutStatic。
      commitHookLayoutEffects(finishedWork, HookLayout);
      break;
    }
    case ClassComponent: {
      recursivelyTraverseReappearLayoutEffects(
        finishedRoot,
        finishedWork,
        layoutEffectTraversalFlags,
      );

      commitClassDidMount(finishedWork);

      commitClassHiddenCallbacks(finishedWork);

      // 若这是刚完成的工作，检查 setState 回调。
      if (includeWorkInProgressEffects && flags & Callback) {
        commitClassCallbacks(finishedWork);
      }

      // TODO：检查 flags & RefStatic。
      safelyAttachRef(finishedWork, finishedWork.return);
      break;
    }
    // 与 commitLayoutEffectsOnFiber 不同，此函数只访问 Offscreen Fiber 内部节点，
    // 因此无需处理 HostRoot。
    // case HostRoot: {
    //  ...
    // }
    case HostSingleton: {
      // $FlowFixMe[constant-condition]
      if (supportsSingletons) {
        const includeHostSingletons =
          (layoutEffectTraversalFlags & IncludeHostSingletons) !==
          NoLayoutEffectTraversalFlags;
        if (includeHostSingletons) {
          // 先获取 singleton 实例，使其在其他布局副作用运行前具备正确样式。
          // 这并不完美：较早的兄弟节点可能在实例获取前通过副作用观察到它。
          // @TODO 移到变更阶段。目前尚未这样做，是因为需要把消失副作用移到出现副作用之前，
          // 看起来会额外增加一次遍历。
          commitHostSingletonAcquisition(finishedWork);
          // 继续落入下方 HostComponent 分支。
        }
      }
      // 继续落入下一分支。
    }
    case HostHoistable:
    case HostComponent: {
      // TODO：为 React Native 启用 HostText。
      if (
        enableFragmentRefs &&
        (finishedWork.tag === HostComponent ||
          finishedWork.tag === HostSingleton)
      ) {
        commitFragmentInstanceInsertionEffects(finishedWork);
      }
      recursivelyTraverseReappearLayoutEffects(
        finishedRoot,
        finishedWork,
        layoutEffectTraversalFlags,
      );

      // 渲染器可能安排宿主组件挂载后的工作，例如 DOM 渲染器为输入框和表单控件安排自动聚焦。
      // 这些副作用只应在组件首次挂载（即不存在 current/alternate）时提交。
      if (includeWorkInProgressEffects && current === null && flags & Update) {
        commitHostMount(finishedWork);
      }

      // TODO：检查 flags & Ref。
      safelyAttachRef(finishedWork, finishedWork.return);
      break;
    }
    case Profiler: {
      // TODO：明确 Profiler 更新与 Offscreen 协作时的行为。
      if (includeWorkInProgressEffects && flags & Update) {
        const prevProfilerEffectDuration = pushNestedEffectDurations();

        recursivelyTraverseReappearLayoutEffects(
          finishedRoot,
          finishedWork,
          layoutEffectTraversalFlags,
        );

        const profilerInstance = finishedWork.stateNode;

        if (enableProfilerTimer && enableProfilerCommitHooks) {
          // 将布局副作用耗时传播给最近的上级 Profiler。
          // 到下一次渲染前不要重置这些值，确保 DevTools 有机会读取。
          profilerInstance.effectDuration += bubbleNestedEffectDurations(
            prevProfilerEffectDuration,
          );
        }

        commitProfilerUpdate(
          finishedWork,
          current,
          commitStartTime,
          profilerInstance.effectDuration,
        );
      } else {
        recursivelyTraverseReappearLayoutEffects(
          finishedRoot,
          finishedWork,
          layoutEffectTraversalFlags,
        );
      }
      break;
    }
    case ActivityComponent: {
      recursivelyTraverseReappearLayoutEffects(
        finishedRoot,
        finishedWork,
        layoutEffectTraversalFlags,
      );

      if (includeWorkInProgressEffects && flags & Update) {
        // TODO：删除此功能。
        commitActivityHydrationCallbacks(finishedRoot, finishedWork);
      }
      break;
    }
    case SuspenseComponent: {
      recursivelyTraverseReappearLayoutEffects(
        finishedRoot,
        finishedWork,
        layoutEffectTraversalFlags,
      );

      if (includeWorkInProgressEffects && flags & Update) {
        // TODO：删除此功能。
        commitSuspenseHydrationCallbacks(finishedRoot, finishedWork);
      }
      break;
    }
    case OffscreenComponent: {
      const offscreenState: OffscreenState = finishedWork.memoizedState;
      // $FlowFixMe[invalid-compare]
      const isHidden = offscreenState !== null;
      if (isHidden) {
        // 嵌套 Offscreen 树仍处于隐藏状态，不要让其副作用重新出现。
      } else {
        recursivelyTraverseReappearLayoutEffects(
          finishedRoot,
          finishedWork,
          layoutEffectTraversalFlags,
        );
      }
      // TODO：检查 flags & Ref。
      safelyAttachRef(finishedWork, finishedWork.return);
      break;
    }
    case ViewTransitionComponent: {
      if (enableViewTransition) {
        recursivelyTraverseReappearLayoutEffects(
          finishedRoot,
          finishedWork,
          layoutEffectTraversalFlags,
        );
        if (__DEV__) {
          if (flags & ViewTransitionNamedStatic) {
            trackNamedViewTransition(finishedWork);
          }
        }
        safelyAttachRef(finishedWork, finishedWork.return);
        break;
      }
      break;
    }
    case Fragment: {
      if (enableFragmentRefs) {
        safelyAttachRef(finishedWork, finishedWork.return);
      }
      // 继续落入下一分支。
    }
    default: {
      recursivelyTraverseReappearLayoutEffects(
        finishedRoot,
        finishedWork,
        layoutEffectTraversalFlags,
      );
      break;
    }
  }

  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    enableComponentPerformanceTrack &&
    (finishedWork.mode & ProfileMode) !== NoMode &&
    componentEffectStartTime >= 0 &&
    componentEffectEndTime >= 0 &&
    (componentEffectSpawnedUpdate || componentEffectDuration > 0.05)
  ) {
    logComponentEffect(
      finishedWork,
      componentEffectStartTime,
      componentEffectEndTime,
      componentEffectDuration,
      componentEffectErrors,
    );
  }

  popComponentEffectStart(prevEffectStart);
  popComponentEffectDuration(prevEffectDuration);
  popComponentEffectErrors(prevEffectErrors);
  popComponentEffectDidSpawnUpdate(prevEffectDidSpawnUpdate);
}

/** 遍历重现子树，并根据 IncludeWorkInProgressEffects 选择是否提交本轮 effect。 */
function recursivelyTraverseReappearLayoutEffects(
  finishedRoot: FiberRoot,
  parentFiber: Fiber,
  layoutEffectTraversalFlags: LayoutEffectTraversalFlags,
) {
  // 此函数既访问刚完成的工作，也访问从先前已提交树复用的节点；节点复用时不能检查非静态标志。
  const childLayoutEffectTraversalFlags =
    (parentFiber.subtreeFlags & LayoutMask) !== NoFlags
      ? layoutEffectTraversalFlags
      : layoutEffectTraversalFlags & ~IncludeWorkInProgressEffects;

  // TODO（Offscreen）：检查 flags & (RefStatic | LayoutStatic)。
  let child = parentFiber.child;
  while (child !== null) {
    const current = child.alternate;
    reappearLayoutEffects(
      finishedRoot,
      current,
      child,
      childLayoutEffectTraversalFlags,
    );
    child = child.sibling;
  }
}

/** Offscreen passive mount 时提交缓存池引用变化，并释放不再使用的 cache。 */
function commitOffscreenPassiveMountEffects(
  current: Fiber | null,
  finishedWork: Fiber,
  instance: OffscreenInstance,
) {
  let previousCache: Cache | null = null;
  if (
    current !== null &&
    current.memoizedState !== null &&
    current.memoizedState.cachePool !== null
  ) {
    previousCache = current.memoizedState.cachePool.pool;
  }
  let nextCache: Cache | null = null;
  if (
    finishedWork.memoizedState !== null &&
    finishedWork.memoizedState.cachePool !== null
  ) {
    nextCache = finishedWork.memoizedState.cachePool.pool;
  }
  // 保留或释放待处理（已挂起）节点使用的缓存。这里只有未挂起且可见时才会到达；
  // 内容挂起或隐藏时，由父 Suspense 组件执行保留或释放（参见上方分支）。
  if (nextCache !== previousCache) {
    if (nextCache != null) {
      retainCache(nextCache);
    }
    if (previousCache != null) {
      releaseCache(previousCache);
    }
  }

  if (enableTransitionTracing) {
    // TODO：预渲染不应计入 transition；可以为其增加独立日志，但它不属于主要指标。
    const offscreenState: OffscreenState = finishedWork.memoizedState;
    const queue: OffscreenQueue | null = finishedWork.updateQueue as any;

    // $FlowFixMe[invalid-compare]
    const isHidden = offscreenState !== null;
    if (queue !== null) {
      if (isHidden) {
        const transitions = queue.transitions;
        if (transitions !== null) {
          transitions.forEach(transition => {
            // 把渲染阶段保存到更新队列中的所有 transition（即与此边界关联的项）加入集合。
            if (instance._transitions === null) {
              instance._transitions = new Set();
            }
            instance._transitions.add(transition);
          });
        }

        const markerInstances = queue.markerInstances;
        if (markerInstances !== null) {
          markerInstances.forEach(markerInstance => {
            const markerTransitions = markerInstance.transitions;
            // tracing marker transition 应当很少，因为它们只与触发自身的 transition 关联。
            if (markerTransitions !== null) {
              markerTransitions.forEach(transition => {
                if (instance._transitions === null) {
                  instance._transitions = new Set();
                } else if (instance._transitions.has(transition)) {
                  if (markerInstance.pendingBoundaries === null) {
                    markerInstance.pendingBoundaries = new Map();
                  }
                  if (instance._pendingMarkers === null) {
                    instance._pendingMarkers = new Set();
                  }

                  instance._pendingMarkers.add(markerInstance);
                }
              });
            }
          });
        }
      }

      finishedWork.updateQueue = null;
    }

    commitTransitionProgress(finishedWork);

    // TODO：重构为 if/else 分支。
    if (!isHidden) {
      instance._transitions = null;
      instance._pendingMarkers = null;
    }
  }
}

/** CacheComponent passive 阶段 retain 新 cache、release 旧 cache。 */
function commitCachePassiveMountEffect(
  current: Fiber | null,
  finishedWork: Fiber,
) {
  let previousCache: Cache | null = null;
  if (finishedWork.alternate !== null) {
    previousCache = finishedWork.alternate.memoizedState.cache;
  }
  const nextCache = finishedWork.memoizedState.cache;
  // 保留或释放缓存。理论上 Cache 组件可能只是“借用”父级拥有的缓存实例，此时可省略操作；
  // 但难以可靠判断这种情况，因此始终执行保留或释放。
  if (nextCache !== previousCache) {
    retainCache(nextCache);
    if (previousCache != null) {
      releaseCache(previousCache);
    }
  }
}

/** TracingMarker passive 阶段提交 marker 实例与 transitions 的完成回调。 */
function commitTracingMarkerPassiveMountEffect(finishedWork: Fiber) {
  // 取得渲染期间发起的 transition，并为每项添加开始回调。
  // 只有 tracing marker 首次挂载且没有 Suspense 子节点时才调用这里。
  const instance = finishedWork.stateNode;
  if (instance.transitions !== null && instance.pendingBoundaries === null) {
    addMarkerCompleteCallbackToPendingTransition(
      finishedWork.memoizedProps.name,
      instance.transitions,
    );
    instance.transitions = null;
    instance.pendingBoundaries = null;
    instance.aborts = null;
    instance.name = null;
  }
}

/** passive mount 阶段入口：遍历已提交树，挂载 useEffect 并处理 cache/tracing/profiler。 */
export function commitPassiveMountEffects(
  root: FiberRoot,
  finishedWork: Fiber,
  committedLanes: Lanes,
  committedTransitions: Array<Transition> | null,
  renderEndTime: number, // 仅用于 Profiling。
): void {
  resetComponentEffectTimers();

  commitPassiveMountOnFiber(
    root,
    finishedWork,
    committedLanes,
    committedTransitions,
    enableProfilerTimer && enableComponentPerformanceTrack ? renderEndTime : 0,
  );
}

/** 遍历含 PassiveMask 的子树，累计 Profiler 时间并传播 hydration 状态。 */
function recursivelyTraversePassiveMountEffects(
  root: FiberRoot,
  parentFiber: Fiber,
  committedLanes: Lanes,
  committedTransitions: Array<Transition> | null,
  endTime: number, // 仅用于 Profiling：下一个 Fiber 或根完成阶段的开始时间。
) {
  const isViewTransitionEligible =
    enableViewTransition &&
    includesOnlyViewTransitionEligibleLanes(committedLanes);
  // TODO：可在渲染阶段用 Passive 子树标志标记这些节点，减少这里的遍历。
  const subtreeMask = isViewTransitionEligible
    ? PassiveTransitionMask
    : PassiveMask;
  if (
    parentFiber.subtreeFlags & subtreeMask ||
    // 若此子树在本次提交中以 profiling 模式渲染，就必须访问并记录它。
    (enableProfilerTimer &&
      enableComponentPerformanceTrack &&
      parentFiber.actualDuration !== 0 &&
      (parentFiber.alternate === null ||
        parentFiber.alternate.child !== parentFiber.child))
  ) {
    let child = parentFiber.child;
    while (child !== null) {
      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        const nextSibling = child.sibling;
        commitPassiveMountOnFiber(
          root,
          child,
          committedLanes,
          committedTransitions,
          nextSibling !== null
            ? (nextSibling.actualStartTime as any as number)
            : endTime,
        );
        child = nextSibling;
      } else {
        commitPassiveMountOnFiber(
          root,
          child,
          committedLanes,
          committedTransitions,
          0,
        );
        child = child.sibling;
      }
    }
  } else if (isViewTransitionEligible) {
    // 当前位于已更新子树内。影响父级 HostInstance 布局或子节点集合的变更（例如重排）
    // 也可能改变内部 ViewTransition 的位置或尺寸，因此还要恢复它们。
    restoreNestedViewTransitions(parentFiber);
  }
}

let inHydratedSubtree = false;

/** 按 WorkTag 挂载单 Fiber passive effect，处理 Offscreen reconnect、cache 与 tracing。 */
function commitPassiveMountOnFiber(
  finishedRoot: FiberRoot,
  finishedWork: Fiber,
  committedLanes: Lanes,
  committedTransitions: Array<Transition> | null,
  endTime: number, // 仅用于 Profiling：下一个 Fiber 或根完成阶段的开始时间。
): void {
  const prevEffectStart = pushComponentEffectStart();
  const prevEffectDuration = pushComponentEffectDuration();
  const prevEffectErrors = pushComponentEffectErrors();
  const prevEffectDidSpawnUpdate = pushComponentEffectDidSpawnUpdate();
  const prevDeepEquality = pushDeepEquality();

  const isViewTransitionEligible = enableViewTransition
    ? includesOnlyViewTransitionEligibleLanes(committedLanes)
    : false;

  if (
    isViewTransitionEligible &&
    finishedWork.alternate === null &&
    // Placement 标志此前已重置，无法在这里使用；改为检查父节点先前是否存在，
    // 以判断当前节点是否为插入根。
    finishedWork.return !== null &&
    finishedWork.return.alternate !== null
  ) {
    // 这是新挂载，内容可能触发过进入动画；若快照阶段分配过 View Transition，就恢复它们。
    restoreEnterOrExitViewTransitions(finishedWork);
  }

  // 更新此函数时也要同步更新 reconnectPassiveEffects；后者在 Offscreen 树由隐藏变为可见，
  // 或切换隐藏树内副作用时执行大部分相同工作。
  const flags = finishedWork.flags;
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      // 若组件以 Profiling 模式（DEV 或位于 Profiler 中）渲染，就记录其渲染耗时。
      // 记录延后到被动副作用执行，以免测量开销干扰渲染特征，也避免回退未提交渲染时的开销。
      if (
        enableProfilerTimer &&
        enableComponentPerformanceTrack &&
        (finishedWork.mode & ProfileMode) !== NoMode &&
        (finishedWork.actualStartTime as any as number) > 0 &&
        (finishedWork.flags & PerformedWork) !== NoFlags
      ) {
        logComponentRender(
          finishedWork,
          finishedWork.actualStartTime as any as number,
          endTime,
          inHydratedSubtree,
          committedLanes,
        );
      }

      recursivelyTraversePassiveMountEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        committedTransitions,
        endTime,
      );
      if (flags & Passive) {
        commitHookPassiveMountEffects(
          finishedWork,
          HookPassive | HookHasEffect,
        );
      }
      break;
    }
    case ClassComponent: {
      // 若组件以 Profiling 模式（DEV 或位于 Profiler 中）渲染，就记录其渲染耗时。
      // 记录延后到被动副作用执行，以免测量开销干扰渲染特征，也避免回退未提交渲染时的开销。
      if (
        enableProfilerTimer &&
        enableComponentPerformanceTrack &&
        (finishedWork.mode & ProfileMode) !== NoMode &&
        (finishedWork.actualStartTime as any as number) > 0
      ) {
        if ((finishedWork.flags & DidCapture) !== NoFlags) {
          logComponentErrored(
            finishedWork,
            finishedWork.actualStartTime as any as number,
            endTime,
            // TODO：捕获值都藏在 updater/callback 闭包中，目前无法取得错误；
            // 但错误确实存在，应设法记录。
            [],
          );
        } else if ((finishedWork.flags & PerformedWork) !== NoFlags) {
          logComponentRender(
            finishedWork,
            finishedWork.actualStartTime as any as number,
            endTime,
            inHydratedSubtree,
            committedLanes,
          );
        }
      }

      recursivelyTraversePassiveMountEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        committedTransitions,
        endTime,
      );
      break;
    }
    case HostRoot: {
      const prevProfilerEffectDuration = pushNestedEffectDurations();

      const wasInHydratedSubtree = inHydratedSubtree;
      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        // 通过检查先前状态是否脱水且本次并非强制客户端渲染，判断它是否为水合提交。
        inHydratedSubtree =
          finishedWork.alternate !== null &&
          (finishedWork.alternate.memoizedState as RootState).isDehydrated &&
          (finishedWork.flags & ForceClientRender) === NoFlags;
      }

      recursivelyTraversePassiveMountEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        committedTransitions,
        endTime,
      );

      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        inHydratedSubtree = wasInHydratedSubtree;
      }

      if (isViewTransitionEligible) {
        // $FlowFixMe[constant-condition]
        if (supportsMutation && rootViewTransitionNameCanceled) {
          restoreRootViewTransitionName(finishedRoot.containerInfo);
        }
      }

      if (flags & Passive) {
        let previousCache: Cache | null = null;
        if (finishedWork.alternate !== null) {
          previousCache = finishedWork.alternate.memoizedState.cache;
        }
        const nextCache = finishedWork.memoizedState.cache;
        // 保留或释放根缓存。首次挂载时 previousCache 与 nextCache 相同，这里不会执行 retain；
        // 因此创建根时会保留 HostRoot 的初始缓存，参见 ReactFiberRoot.js 的 createFiberRoot()。
        // 后续改变缓存的更新会在这里反映，从而正确保留 previous/next 缓存。
        if (nextCache !== previousCache) {
          retainCache(nextCache);
          if (previousCache != null) {
            releaseCache(previousCache);
          }
        }

        if (enableTransitionTracing) {
          // 取得渲染期间发起的 transition，并为每项添加开始回调。
          const root: FiberRoot = finishedWork.stateNode;
          const incompleteTransitions = root.incompleteTransitions;
          // 首次渲染。
          if (committedTransitions !== null) {
            committedTransitions.forEach(transition => {
              addTransitionStartCallbackToPendingTransition(transition);
            });

            clearTransitionsForLanes(finishedRoot, committedLanes);
          }

          incompleteTransitions.forEach((markerInstance, transition) => {
            const pendingBoundaries = markerInstance.pendingBoundaries;
            if (pendingBoundaries === null || pendingBoundaries.size === 0) {
              if (markerInstance.aborts === null) {
                addTransitionCompleteCallbackToPendingTransition(transition);
              }
              incompleteTransitions.delete(transition);
            }
          });

          clearTransitionsForLanes(finishedRoot, committedLanes);
        }
      }
      if (enableProfilerTimer && enableProfilerCommitHooks) {
        finishedRoot.passiveEffectDuration += popNestedEffectDurations(
          prevProfilerEffectDuration,
        );
      }
      break;
    }
    case Profiler: {
      // 只有子树中存在工作的 Profiler 才会安排 Passive 副作用。
      if (flags & Passive) {
        const prevProfilerEffectDuration = pushNestedEffectDurations();

        recursivelyTraversePassiveMountEffects(
          finishedRoot,
          finishedWork,
          committedLanes,
          committedTransitions,
          endTime,
        );

        const profilerInstance = finishedWork.stateNode;

        if (enableProfilerTimer && enableProfilerCommitHooks) {
          // 将耗时冒泡到最近的祖先 Profiler；处理该 Profiler 后再继续向上冒泡。
          profilerInstance.passiveEffectDuration += bubbleNestedEffectDurations(
            prevProfilerEffectDuration,
          );
        }

        commitProfilerPostCommit(
          finishedWork,
          finishedWork.alternate,
          // 此值仍反映上一次提交阶段，直到下一提交阶段开始时才会重置。
          commitStartTime,
          profilerInstance.passiveEffectDuration,
        );
      } else {
        recursivelyTraversePassiveMountEffects(
          finishedRoot,
          finishedWork,
          committedLanes,
          committedTransitions,
          endTime,
        );
      }
      break;
    }
    case ActivityComponent: {
      const wasInHydratedSubtree = inHydratedSubtree;
      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        const prevState: ActivityState | null =
          finishedWork.alternate !== null
            ? finishedWork.alternate.memoizedState
            : null;
        const nextState: ActivityState | null = finishedWork.memoizedState;
        if (prevState !== null && nextState === null) {
          // 它先前处于脱水状态，现在已不再脱水；可能已完成水合，也可能改为客户端渲染。
          const deletions = finishedWork.deletions;
          if (
            deletions !== null &&
            deletions.length > 0 &&
            deletions[0].tag === DehydratedFragment
          ) {
            // 这是一次已放弃的水合，并删除了脱水片段；说明此 Suspense 边界不会继续水合。
            inHydratedSubtree = false;
            const hydrationErrors = prevState.hydrationErrors;
            // 若没有水合错误，说明该边界是有意采用客户端渲染。
            if (hydrationErrors !== null) {
              const startTime: number = finishedWork.actualStartTime as any;
              logComponentErrored(
                finishedWork,
                startTime,
                endTime,
                hydrationErrors,
              );
            }
          } else {
            // 若有子节点提交，则这些子节点已完成水合。
            inHydratedSubtree = true;
          }
        } else {
          inHydratedSubtree = false;
        }
      }

      recursivelyTraversePassiveMountEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        committedTransitions,
        endTime,
      );

      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        inHydratedSubtree = wasInHydratedSubtree;
      }
      break;
    }
    case SuspenseComponent: {
      const wasInHydratedSubtree = inHydratedSubtree;
      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        const prevState: SuspenseState | null =
          finishedWork.alternate !== null
            ? finishedWork.alternate.memoizedState
            : null;
        const nextState: SuspenseState | null = finishedWork.memoizedState;
        if (
          prevState !== null &&
          prevState.dehydrated !== null &&
          (nextState === null || nextState.dehydrated === null)
        ) {
          // 它先前处于脱水状态，现在已不再脱水；可能已完成水合，也可能改为客户端渲染。
          const deletions = finishedWork.deletions;
          if (
            deletions !== null &&
            deletions.length > 0 &&
            deletions[0].tag === DehydratedFragment
          ) {
            // 这是一次已放弃的水合，并删除了脱水片段；说明此 Suspense 边界不会继续水合。
            inHydratedSubtree = false;
            const hydrationErrors = prevState.hydrationErrors;
            // 若没有水合错误，说明该边界是有意采用客户端渲染。
            if (hydrationErrors !== null) {
              const startTime: number = finishedWork.actualStartTime as any;
              logComponentErrored(
                finishedWork,
                startTime,
                endTime,
                hydrationErrors,
              );
            }
          } else {
            // 若有子节点提交，则这些子节点已完成水合。
            inHydratedSubtree = true;
          }
        } else {
          inHydratedSubtree = false;
        }
      }

      recursivelyTraversePassiveMountEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        committedTransitions,
        endTime,
      );

      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        inHydratedSubtree = wasInHydratedSubtree;
      }
      break;
    }
    case LegacyHiddenComponent: {
      if (enableLegacyHidden) {
        recursivelyTraversePassiveMountEffects(
          finishedRoot,
          finishedWork,
          committedLanes,
          committedTransitions,
          endTime,
        );

        if (flags & Passive) {
          const current = finishedWork.alternate;
          const instance: OffscreenInstance = finishedWork.stateNode;
          commitOffscreenPassiveMountEffects(current, finishedWork, instance);
        }
      }
      break;
    }
    case OffscreenComponent: {
      // TODO：把 current 作为参数传入此函数。
      const instance: OffscreenInstance = finishedWork.stateNode;
      const current = finishedWork.alternate;
      const nextState: OffscreenState | null = finishedWork.memoizedState;

      const isHidden = nextState !== null;

      if (isHidden) {
        if (
          isViewTransitionEligible &&
          current !== null &&
          current.memoizedState === null
        ) {
          // 内容现在隐藏而先前可见，可能已触发退出动画；若快照阶段分配过 View Transition，就恢复它们。
          restoreEnterOrExitViewTransitions(current);
        }
        if (instance._visibility & OffscreenPassiveEffectsConnected) {
          // 副作用当前已连接，更新它们。
          recursivelyTraversePassiveMountEffects(
            finishedRoot,
            finishedWork,
            committedLanes,
            committedTransitions,
            endTime,
          );
        } else {
          if (disableLegacyMode || finishedWork.mode & ConcurrentMode) {
            // 副作用当前已断开；树处于隐藏状态，不要连接它们，首次渲染也遵循此规则。
            // “原子”副作用必须在每次提交时触发，即使处于预渲染阶段，例如更新缓存实例引用计数。
            recursivelyTraverseAtomicPassiveEffects(
              finishedRoot,
              finishedWork,
              committedLanes,
              committedTransitions,
              endTime,
            );
          } else {
            // Legacy 模式：即使树隐藏也触发副作用。
            instance._visibility |= OffscreenPassiveEffectsConnected;
            recursivelyTraversePassiveMountEffects(
              finishedRoot,
              finishedWork,
              committedLanes,
              committedTransitions,
              endTime,
            );
          }
        }
      } else {
        // 树处于可见状态。
        if (
          isViewTransitionEligible &&
          current !== null &&
          current.memoizedState !== null
        ) {
          // 内容现在可见而先前隐藏，可能已触发进入动画；若快照阶段分配过 View Transition，就恢复它们。
          restoreEnterOrExitViewTransitions(finishedWork);
        }
        if (instance._visibility & OffscreenPassiveEffectsConnected) {
          // 副作用当前已连接，更新它们。
          recursivelyTraversePassiveMountEffects(
            finishedRoot,
            finishedWork,
            committedLanes,
            committedTransitions,
            endTime,
          );
        } else {
          // 副作用当前已断开；重新连接，并触发新挂载树内的副作用。首次渲染也适用。
          instance._visibility |= OffscreenPassiveEffectsConnected;

          const includeWorkInProgressEffects =
            (finishedWork.subtreeFlags & PassiveMask) !== NoFlags ||
            (enableProfilerTimer &&
              enableComponentPerformanceTrack &&
              finishedWork.actualDuration !== 0 &&
              (finishedWork.alternate === null ||
                finishedWork.alternate.child !== finishedWork.child));
          recursivelyTraverseReconnectPassiveEffects(
            finishedRoot,
            finishedWork,
            committedLanes,
            committedTransitions,
            includeWorkInProgressEffects,
            endTime,
          );

          if (
            enableProfilerTimer &&
            enableProfilerCommitHooks &&
            enableComponentPerformanceTrack &&
            (finishedWork.mode & ProfileMode) !== NoMode &&
            !inHydratedSubtree
          ) {
            // 在渲染阶段记录重新出现事件。
            const startTime = finishedWork.actualStartTime as any as number;
            if (startTime >= 0 && endTime - startTime > 0.05) {
              logComponentReappeared(finishedWork, startTime, endTime);
            }
            if (
              componentEffectStartTime >= 0 &&
              componentEffectEndTime >= 0 &&
              componentEffectEndTime - componentEffectStartTime > 0.05
            ) {
              logComponentReappeared(
                finishedWork,
                componentEffectStartTime,
                componentEffectEndTime,
              );
            }
          }
        }
      }

      if (flags & Passive) {
        commitOffscreenPassiveMountEffects(current, finishedWork, instance);
      }
      break;
    }
    case CacheComponent: {
      recursivelyTraversePassiveMountEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        committedTransitions,
        endTime,
      );
      if (flags & Passive) {
        // TODO：把 current 作为参数传入此函数。
        const current = finishedWork.alternate;
        commitCachePassiveMountEffect(current, finishedWork);
      }
      break;
    }
    case ViewTransitionComponent: {
      if (enableViewTransition) {
        if (isViewTransitionEligible) {
          const current = finishedWork.alternate;
          if (current === null) {
            // 这是一次新挂载：要么已由 Placement 副作用处理，要么位于更深层的进入过渡中。
          } else {
            // 此子树内部发生了变更；若尚未取消，可能已触发交叉淡化，否则恢复它。
            restoreUpdateViewTransition(current, finishedWork);
          }
        }
        recursivelyTraversePassiveMountEffects(
          finishedRoot,
          finishedWork,
          committedLanes,
          committedTransitions,
          endTime,
        );
        break;
      }
      // 继续落入下一分支。
    }
    case TracingMarkerComponent: {
      if (enableTransitionTracing) {
        recursivelyTraversePassiveMountEffects(
          finishedRoot,
          finishedWork,
          committedLanes,
          committedTransitions,
          endTime,
        );
        if (flags & Passive) {
          commitTracingMarkerPassiveMountEffect(finishedWork);
        }
        break;
      }
      // 有意继续落入下一分支。
    }
    default: {
      recursivelyTraversePassiveMountEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        committedTransitions,
        endTime,
      );
      break;
    }
  }

  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    enableComponentPerformanceTrack &&
    (finishedWork.mode & ProfileMode) !== NoMode
  ) {
    const isMount =
      !inHydratedSubtree &&
      finishedWork.alternate === null &&
      finishedWork.return !== null &&
      finishedWork.return.alternate !== null;
    if (isMount) {
      // 在渲染阶段记录挂载事件。
      const startTime = finishedWork.actualStartTime as any as number;
      if (startTime >= 0 && endTime - startTime > 0.05) {
        logComponentMount(finishedWork, startTime, endTime);
      }
    }
    if (componentEffectStartTime >= 0 && componentEffectEndTime >= 0) {
      if (componentEffectSpawnedUpdate || componentEffectDuration > 0.05) {
        logComponentEffect(
          finishedWork,
          componentEffectStartTime,
          componentEffectEndTime,
          componentEffectDuration,
          componentEffectErrors,
        );
      }
      if (isMount && componentEffectEndTime - componentEffectStartTime > 0.05) {
        logComponentMount(
          finishedWork,
          componentEffectStartTime,
          componentEffectEndTime,
        );
      }
    }
  }

  popComponentEffectStart(prevEffectStart);
  popComponentEffectDuration(prevEffectDuration);
  popComponentEffectErrors(prevEffectErrors);
  popComponentEffectDidSpawnUpdate(prevEffectDidSpawnUpdate);
  popDeepEquality(prevDeepEquality);
}

/** Activity/Offscreen 重连时遍历整棵可见子树，重新挂载此前断开的 passive effect。 */
function recursivelyTraverseReconnectPassiveEffects(
  finishedRoot: FiberRoot,
  parentFiber: Fiber,
  committedLanes: Lanes,
  committedTransitions: Array<Transition> | null,
  includeWorkInProgressEffects: boolean,
  endTime: number,
) {
  // 此函数既访问刚完成的工作，也访问从先前已提交树复用的节点；节点复用时不能检查非静态标志。
  const childShouldIncludeWorkInProgressEffects =
    includeWorkInProgressEffects &&
    ((parentFiber.subtreeFlags & PassiveMask) !== NoFlags ||
      (enableProfilerTimer &&
        enableComponentPerformanceTrack &&
        parentFiber.actualDuration !== 0 &&
        (parentFiber.alternate === null ||
          parentFiber.alternate.child !== parentFiber.child)));

  // TODO（Offscreen）：检查 flags & (RefStatic | LayoutStatic)。
  let child = parentFiber.child;
  while (child !== null) {
    if (enableProfilerTimer && enableComponentPerformanceTrack) {
      const nextSibling = child.sibling;
      reconnectPassiveEffects(
        finishedRoot,
        child,
        committedLanes,
        committedTransitions,
        childShouldIncludeWorkInProgressEffects,
        nextSibling !== null
          ? (nextSibling.actualStartTime as any as number)
          : endTime,
      );
      child = nextSibling;
    } else {
      reconnectPassiveEffects(
        finishedRoot,
        child,
        committedLanes,
        committedTransitions,
        childShouldIncludeWorkInProgressEffects,
        endTime,
      );
      child = child.sibling;
    }
  }
}

/** 重新连接单 Fiber 的 passive effect，并按 tag 递归/处理 cache、tracing 与 Profiler。 */
export function reconnectPassiveEffects(
  finishedRoot: FiberRoot,
  finishedWork: Fiber,
  committedLanes: Lanes,
  committedTransitions: Array<Transition> | null,
  // 此函数既访问刚完成的工作，也访问从先前已提交树复用的节点；节点复用时不能检查非静态标志。
  includeWorkInProgressEffects: boolean,
  endTime: number, // 仅用于 Profiling：下一个 Fiber 或根完成阶段的开始时间。
) {
  const prevEffectStart = pushComponentEffectStart();
  const prevEffectDuration = pushComponentEffectDuration();
  const prevEffectErrors = pushComponentEffectErrors();
  const prevEffectDidSpawnUpdate = pushComponentEffectDidSpawnUpdate();
  const prevDeepEquality = pushDeepEquality();

  // 若组件以 Profiling 模式（DEV 或位于 Profiler 中）渲染，就记录其渲染耗时。
  // 记录延后到被动副作用执行，以免测量开销干扰渲染特征，也避免回退未提交渲染时的开销。
  if (
    enableProfilerTimer &&
    enableComponentPerformanceTrack &&
    includeWorkInProgressEffects &&
    (finishedWork.mode & ProfileMode) !== NoMode &&
    (finishedWork.actualStartTime as any as number) > 0 &&
    (finishedWork.flags & PerformedWork) !== NoFlags
  ) {
    logComponentRender(
      finishedWork,
      finishedWork.actualStartTime as any as number,
      endTime,
      inHydratedSubtree,
      committedLanes,
    );
  }

  const flags = finishedWork.flags;
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      recursivelyTraverseReconnectPassiveEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        committedTransitions,
        includeWorkInProgressEffects,
        endTime,
      );
      // TODO：检查 PassiveStatic 标志。
      commitHookPassiveMountEffects(finishedWork, HookPassive);
      break;
    }
    // 与 commitPassiveMountOnFiber 不同，此函数只访问 Offscreen Fiber 内部节点，
    // 因此无需处理 HostRoot。
    // case HostRoot: {
    //  ...
    // }
    case LegacyHiddenComponent: {
      if (enableLegacyHidden) {
        recursivelyTraverseReconnectPassiveEffects(
          finishedRoot,
          finishedWork,
          committedLanes,
          committedTransitions,
          includeWorkInProgressEffects,
          endTime,
        );

        if (includeWorkInProgressEffects && flags & Passive) {
          // TODO：把 current 作为参数传入此函数。
          const current: Fiber | null = finishedWork.alternate;
          const instance: OffscreenInstance = finishedWork.stateNode;
          commitOffscreenPassiveMountEffects(current, finishedWork, instance);
        }
      }
      break;
    }
    case OffscreenComponent: {
      const instance: OffscreenInstance = finishedWork.stateNode;
      const nextState: OffscreenState | null = finishedWork.memoizedState;

      const isHidden = nextState !== null;

      if (isHidden) {
        if (instance._visibility & OffscreenPassiveEffectsConnected) {
          // 副作用当前已连接，更新它们。
          recursivelyTraverseReconnectPassiveEffects(
            finishedRoot,
            finishedWork,
            committedLanes,
            committedTransitions,
            includeWorkInProgressEffects,
            endTime,
          );
        } else {
          if (disableLegacyMode || finishedWork.mode & ConcurrentMode) {
            // 副作用当前已断开；树处于隐藏状态，不要连接它们，首次渲染也遵循此规则。
            // “原子”副作用必须在每次提交时触发，即使处于预渲染阶段，例如更新缓存实例引用计数。
            recursivelyTraverseAtomicPassiveEffects(
              finishedRoot,
              finishedWork,
              committedLanes,
              committedTransitions,
              endTime,
            );
          } else {
            // Legacy 模式：即使树隐藏也触发副作用。
            instance._visibility |= OffscreenPassiveEffectsConnected;
            recursivelyTraverseReconnectPassiveEffects(
              finishedRoot,
              finishedWork,
              committedLanes,
              committedTransitions,
              includeWorkInProgressEffects,
              endTime,
            );
          }
        }
      } else {
        // 树处于可见状态。

        // 当前已位于重新连接的树中，副作用现在是否连接并不重要；两种情况下都会继续遍历并触发所有副作用。
        //
        // 但仍需在实例上设置 connected 标志。
        instance._visibility |= OffscreenPassiveEffectsConnected;

        recursivelyTraverseReconnectPassiveEffects(
          finishedRoot,
          finishedWork,
          committedLanes,
          committedTransitions,
          includeWorkInProgressEffects,
          endTime,
        );
      }

      if (includeWorkInProgressEffects && flags & Passive) {
        // TODO：把 current 作为参数传入此函数。
        const current: Fiber | null = finishedWork.alternate;
        commitOffscreenPassiveMountEffects(current, finishedWork, instance);
      }
      break;
    }
    case CacheComponent: {
      recursivelyTraverseReconnectPassiveEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        committedTransitions,
        includeWorkInProgressEffects,
        endTime,
      );
      if (includeWorkInProgressEffects && flags & Passive) {
        // TODO：把 current 作为参数传入此函数。
        const current = finishedWork.alternate;
        commitCachePassiveMountEffect(current, finishedWork);
      }
      break;
    }
    case TracingMarkerComponent: {
      if (enableTransitionTracing) {
        recursivelyTraverseReconnectPassiveEffects(
          finishedRoot,
          finishedWork,
          committedLanes,
          committedTransitions,
          includeWorkInProgressEffects,
          endTime,
        );
        if (includeWorkInProgressEffects && flags & Passive) {
          commitTracingMarkerPassiveMountEffect(finishedWork);
        }
        break;
      }
      // 有意继续落入下一分支。
    }
    default: {
      recursivelyTraverseReconnectPassiveEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        committedTransitions,
        includeWorkInProgressEffects,
        endTime,
      );
      break;
    }
  }

  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    enableComponentPerformanceTrack &&
    (finishedWork.mode & ProfileMode) !== NoMode &&
    componentEffectStartTime >= 0 &&
    componentEffectEndTime >= 0 &&
    (componentEffectSpawnedUpdate || componentEffectDuration > 0.05)
  ) {
    logComponentEffect(
      finishedWork,
      componentEffectStartTime,
      componentEffectEndTime,
      componentEffectDuration,
      componentEffectErrors,
    );
  }

  popComponentEffectStart(prevEffectStart);
  popComponentEffectDuration(prevEffectDuration);
  popComponentEffectErrors(prevEffectErrors);
  popComponentEffectDidSpawnUpdate(prevEffectDidSpawnUpdate);
  popDeepEquality(prevDeepEquality);
}

/** 对隐藏但 atomic passive 工作仍必须执行的子树进行受限遍历。 */
function recursivelyTraverseAtomicPassiveEffects(
  finishedRoot: FiberRoot,
  parentFiber: Fiber,
  committedLanes: Lanes,
  committedTransitions: Array<Transition> | null,
  endTime: number, // 仅用于 Profiling：下一个 Fiber 或根完成阶段的开始时间。
) {
  // “原子”副作用必须在每次提交时触发，即使处于预渲染阶段。
  // 遍历常规副作用已断开的隐藏树时调用此函数。
  // TODO：为原子副作用增加专用标志。
  if (
    parentFiber.subtreeFlags & PassiveMask ||
    (enableProfilerTimer &&
      enableComponentPerformanceTrack &&
      parentFiber.actualDuration !== 0 &&
      (parentFiber.alternate === null ||
        parentFiber.alternate.child !== parentFiber.child))
  ) {
    let child = parentFiber.child;
    while (child !== null) {
      if (enableProfilerTimer && enableComponentPerformanceTrack) {
        const nextSibling = child.sibling;
        commitAtomicPassiveEffects(
          finishedRoot,
          child,
          committedLanes,
          committedTransitions,
          nextSibling !== null
            ? (nextSibling.actualStartTime as any as number)
            : endTime,
        );
        child = nextSibling;
      } else {
        commitAtomicPassiveEffects(
          finishedRoot,
          child,
          committedLanes,
          committedTransitions,
          endTime,
        );
        child = child.sibling;
      }
    }
  }
}

/** 提交不能因 Offscreen 隐藏而延后的 atomic passive 效果（如 cache 引用）。 */
function commitAtomicPassiveEffects(
  finishedRoot: FiberRoot,
  finishedWork: Fiber,
  committedLanes: Lanes,
  committedTransitions: Array<Transition> | null,
  endTime: number, // 仅用于 Profiling：下一个 Fiber 或根完成阶段的开始时间。
) {
  const prevDeepEquality = pushDeepEquality();

  // 若组件以 Profiling 模式（DEV 或位于 Profiler 中）渲染，就记录其耗时；
  // 即使子树处于屏幕外，也仍可能发生渲染。
  if (
    enableProfilerTimer &&
    enableComponentPerformanceTrack &&
    (finishedWork.mode & ProfileMode) !== NoMode &&
    (finishedWork.actualStartTime as any as number) > 0 &&
    (finishedWork.flags & PerformedWork) !== NoFlags
  ) {
    logComponentRender(
      finishedWork,
      finishedWork.actualStartTime as any as number,
      endTime,
      inHydratedSubtree,
      committedLanes,
    );
  }

  // “原子”副作用必须在每次提交时触发，即使处于预渲染阶段。
  // 遍历常规副作用已断开的隐藏树时调用此函数。
  const flags = finishedWork.flags;
  switch (finishedWork.tag) {
    case OffscreenComponent: {
      recursivelyTraverseAtomicPassiveEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        committedTransitions,
        endTime,
      );
      if (flags & Passive) {
        // TODO：把 current 作为参数传入此函数。
        const current = finishedWork.alternate;
        const instance: OffscreenInstance = finishedWork.stateNode;
        commitOffscreenPassiveMountEffects(current, finishedWork, instance);
      }
      break;
    }
    case CacheComponent: {
      recursivelyTraverseAtomicPassiveEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        committedTransitions,
        endTime,
      );
      if (flags & Passive) {
        // TODO：把 current 作为参数传入此函数。
        const current = finishedWork.alternate;
        commitCachePassiveMountEffect(current, finishedWork);
      }
      break;
    }
    default: {
      recursivelyTraverseAtomicPassiveEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        committedTransitions,
        endTime,
      );
      break;
    }
  }

  popDeepEquality(prevDeepEquality);
}

/** passive unmount 阶段入口：卸载更新/删除/隐藏子树的 useEffect 与相关资源。 */
export function commitPassiveUnmountEffects(finishedWork: Fiber): void {
  resetComponentEffectTimers();
  commitPassiveUnmountOnFiber(finishedWork);
}

// 若当前位于全新树或先前已可见的树中，只挂起带 ShouldSuspendCommit 标志的宿主组件。
// 不带该标志的组件自上次提交后没有变化，可以跳过。
//
// 进入正在显示（由隐藏变为可见）的树时，需要挂起任何可能挂起的组件，即使它们已在 current 树中。
// 可见性改变后浏览器可能尚未预渲染它们，因此改为检查 MaySuspendCommit 标志。
//
// MaySuspendCommit 与 ShouldSuspendCommit 还包含命名 ViewTransition，
// 以便访问它们并收集正在出现的配对。
let suspenseyCommitFlag: Flags = ShouldSuspendCommit;
/** 在提交可挂起资源前遍历 ShouldSuspendCommit 标志并累积宿主等待项。 */
export function accumulateSuspenseyCommit(
  finishedWork: Fiber,
  committedLanes: Lanes,
  suspendedState: SuspendedState,
): void {
  resetAppearingViewTransitions();
  accumulateSuspenseyCommitOnFiber(
    finishedWork,
    committedLanes,
    suspendedState,
  );
}

/** 遍历含 suspensey commit 标志的 child，并为视图 transition 切换掩码。 */
function recursivelyAccumulateSuspenseyCommit(
  parentFiber: Fiber,
  committedLanes: Lanes,
  suspendedState: SuspendedState,
): void {
  if (parentFiber.subtreeFlags & suspenseyCommitFlag) {
    let child = parentFiber.child;
    while (child !== null) {
      accumulateSuspenseyCommitOnFiber(child, committedLanes, suspendedState);
      child = child.sibling;
    }
  }
}

/** 按 WorkTag 收集单 Fiber 的资源、stylesheet、图片或 ViewTransition commit 依赖。 */
function accumulateSuspenseyCommitOnFiber(
  fiber: Fiber,
  committedLanes: Lanes,
  suspendedState: SuspendedState,
) {
  switch (fiber.tag) {
    case HostHoistable: {
      recursivelyAccumulateSuspenseyCommit(
        fiber,
        committedLanes,
        suspendedState,
      );
      if (fiber.flags & suspenseyCommitFlag) {
        if (fiber.memoizedState !== null) {
          suspendResource(
            suspendedState,
            // 访问 HostRoot 时应始终先设置此值。
            currentHoistableRoot as any,
            fiber.memoizedState,
            fiber.memoizedProps,
          );
        } else {
          const instance = fiber.stateNode;
          const type = fiber.type;
          const props = fiber.memoizedProps;
          // TODO：提供显式选项，让同步 lane 也可挂起。
          if (
            includesOnlySuspenseyCommitEligibleLanes(committedLanes) ||
            maySuspendCommitInSyncRender(type, props)
          ) {
            suspendInstance(suspendedState, instance, type, props);
          }
        }
      }
      break;
    }
    case HostComponent: {
      recursivelyAccumulateSuspenseyCommit(
        fiber,
        committedLanes,
        suspendedState,
      );
      if (fiber.flags & suspenseyCommitFlag) {
        const instance = fiber.stateNode;
        const type = fiber.type;
        const props = fiber.memoizedProps;
        // TODO：提供显式选项，让同步 lane 也可挂起。
        if (
          includesOnlySuspenseyCommitEligibleLanes(committedLanes) ||
          maySuspendCommitInSyncRender(type, props)
        ) {
          suspendInstance(suspendedState, instance, type, props);
        }
      }
      break;
    }
    case HostRoot:
    case HostPortal: {
      // $FlowFixMe[constant-condition]
      if (supportsResources) {
        const previousHoistableRoot = currentHoistableRoot;
        const container: Container = fiber.stateNode.containerInfo;
        currentHoistableRoot = getHoistableRoot(container);

        recursivelyAccumulateSuspenseyCommit(
          fiber,
          committedLanes,
          suspendedState,
        );
        currentHoistableRoot = previousHoistableRoot;
      } else {
        recursivelyAccumulateSuspenseyCommit(
          fiber,
          committedLanes,
          suspendedState,
        );
      }
      break;
    }
    case OffscreenComponent: {
      const isHidden = (fiber.memoizedState as OffscreenState | null) !== null;
      if (isHidden) {
        // 不在隐藏树中挂起。
      } else {
        const current = fiber.alternate;
        const wasHidden =
          current !== null &&
          (current.memoizedState as OffscreenState | null) !== null;
        if (wasHidden) {
          // 此树正在显示；访问所有新近可见、可能挂起的实例，即使它们已在 current 树中。
          const prevFlags = suspenseyCommitFlag;
          suspenseyCommitFlag = MaySuspendCommit;
          recursivelyAccumulateSuspenseyCommit(
            fiber,
            committedLanes,
            suspendedState,
          );
          suspenseyCommitFlag = prevFlags;
        } else {
          recursivelyAccumulateSuspenseyCommit(
            fiber,
            committedLanes,
            suspendedState,
          );
        }
      }
      break;
    }
    case ViewTransitionComponent: {
      if (enableViewTransition) {
        if ((fiber.flags & suspenseyCommitFlag) !== NoFlags) {
          const props: ViewTransitionProps = fiber.memoizedProps;
          const name: ?string | 'auto' = props.name;
          if (name != null && name !== 'auto') {
            // 这是正在挂载或重新出现的命名 ViewTransition；加入映射，以便稍后与删除项配对。
            const state: ViewTransitionState = fiber.stateNode;
            // 重置配对，以防先前提交最终未恢复实例。该情况现在理论上不会发生，
            // 但仍作防御性处理；后续可考虑增加不变量检查。
            state.paired = null;
            trackAppearingViewTransition(name, state);
          }
        }
        recursivelyAccumulateSuspenseyCommit(
          fiber,
          committedLanes,
          suspendedState,
        );
        break;
      }
      // 继续落入下一分支。
    }
    default: {
      recursivelyAccumulateSuspenseyCommit(
        fiber,
        committedLanes,
        suspendedState,
      );
    }
  }
}

/** 删除 passive 清理完成后断开 alternate 的旧 sibling 链，释放已删除 Fiber。 */
function detachAlternateSiblings(parentFiber: Fiber) {
  // 某个 Fiber 已从当前父 Fiber 删除，但仍在先前（alternate）父 Fiber 的子链表中。
  // 由于子节点采用链表，仍存活的较早兄弟节点会通过 alternate 连接到已删除 Fiber：
  //
  //   live fiber --alternate--> previous live fiber --sibling--> deleted
  //   fiber
  //
  // 尚未删除的节点不能断开 alternate，但可以断开 sibling 与 child 指针。

  const previousFiber = parentFiber.alternate;
  if (previousFiber !== null) {
    let detachedChild = previousFiber.child;
    if (detachedChild !== null) {
      previousFiber.child = null;
      do {
        // $FlowFixMe[incompatible-use] found when upgrading Flow
        const detachedSibling = detachedChild.sibling;
        // $FlowFixMe[incompatible-use] found when upgrading Flow
        detachedChild.sibling = null;
        detachedChild = detachedSibling;
      } while (detachedChild !== null);
    }
  }
}

/** 遍历含 PassiveMask 的更新子树及父 Fiber deletions，执行 passive unmount。 */
function recursivelyTraversePassiveUnmountEffects(parentFiber: Fiber): void {
  // 删除副作用可安排在任意 Fiber 类型上，且必须先于子节点副作用执行。
  const deletions = parentFiber.deletions;

  if ((parentFiber.flags & ChildDeletion) !== NoFlags) {
    if (deletions !== null) {
      for (let i = 0; i < deletions.length; i++) {
        const childToDelete = deletions[i];
        const prevEffectStart = pushComponentEffectStart();
        // TODO：改为递归实现。
        nextEffect = childToDelete;
        commitPassiveUnmountEffectsInsideOfDeletedTree_begin(
          childToDelete,
          parentFiber,
        );
        if (
          enableProfilerTimer &&
          enableProfilerCommitHooks &&
          enableComponentPerformanceTrack &&
          (childToDelete.mode & ProfileMode) !== NoMode &&
          componentEffectStartTime >= 0 &&
          componentEffectEndTime >= 0 &&
          componentEffectEndTime - componentEffectStartTime > 0.05
        ) {
          logComponentUnmount(
            childToDelete,
            componentEffectStartTime,
            componentEffectEndTime,
          );
        }
        popComponentEffectStart(prevEffectStart);
      }
    }
    detachAlternateSiblings(parentFiber);
  }

  // TODO：是否应把 PassiveMask 拆成挂载与卸载各自的掩码？
  if (parentFiber.subtreeFlags & PassiveMask) {
    let child = parentFiber.child;
    while (child !== null) {
      commitPassiveUnmountOnFiber(child);
      child = child.sibling;
    }
  }
}

/** 按 WorkTag 卸载单 Fiber 的 passive effect，并处理 Offscreen 断连与 cache/tracing。 */
function commitPassiveUnmountOnFiber(finishedWork: Fiber): void {
  const prevEffectStart = pushComponentEffectStart();
  const prevEffectDuration = pushComponentEffectDuration();
  const prevEffectErrors = pushComponentEffectErrors();
  const prevEffectDidSpawnUpdate = pushComponentEffectDidSpawnUpdate();
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      recursivelyTraversePassiveUnmountEffects(finishedWork);
      if (finishedWork.flags & Passive) {
        commitHookPassiveUnmountEffects(
          finishedWork,
          finishedWork.return,
          HookPassive | HookHasEffect,
        );
      }
      break;
    }
    case HostRoot: {
      const prevProfilerEffectDuration = pushNestedEffectDurations();
      recursivelyTraversePassiveUnmountEffects(finishedWork);
      if (enableProfilerTimer && enableProfilerCommitHooks) {
        const finishedRoot: FiberRoot = finishedWork.stateNode;
        finishedRoot.passiveEffectDuration += popNestedEffectDurations(
          prevProfilerEffectDuration,
        );
      }
      break;
    }
    case Profiler: {
      const prevProfilerEffectDuration = pushNestedEffectDurations();

      recursivelyTraversePassiveUnmountEffects(finishedWork);

      if (enableProfilerTimer && enableProfilerCommitHooks) {
        const profilerInstance = finishedWork.stateNode;
        // 将布局副作用耗时传播给最近的上级 Profiler。
        // 到下一次渲染前不要重置这些值，确保 DevTools 有机会读取。
        profilerInstance.passiveEffectDuration += bubbleNestedEffectDurations(
          prevProfilerEffectDuration,
        );
      }
      break;
    }
    case OffscreenComponent: {
      const instance: OffscreenInstance = finishedWork.stateNode;
      const nextState: OffscreenState | null = finishedWork.memoizedState;

      const isHidden = nextState !== null;

      if (
        isHidden &&
        instance._visibility & OffscreenPassiveEffectsConnected &&
        // 为保持向后兼容，树挂起时不卸载副作用；未来可能改为延迟一段时间后卸载。
        (finishedWork.return === null ||
          finishedWork.return.tag !== SuspenseComponent)
      ) {
        // 副作用当前已连接，将其断开。
        // TODO：增加选项或启发式策略以延迟断开；若树在延迟结束前重新出现，
        // 就可以完全跳过副作用切换。
        instance._visibility &= ~OffscreenPassiveEffectsConnected;

        recursivelyTraverseDisconnectPassiveEffects(finishedWork);

        if (
          enableProfilerTimer &&
          enableProfilerCommitHooks &&
          enableComponentPerformanceTrack &&
          (finishedWork.mode & ProfileMode) !== NoMode &&
          componentEffectStartTime >= 0 &&
          componentEffectEndTime >= 0 &&
          componentEffectEndTime - componentEffectStartTime > 0.05
        ) {
          logComponentDisappeared(
            finishedWork,
            componentEffectStartTime,
            componentEffectEndTime,
          );
        }
      } else {
        recursivelyTraversePassiveUnmountEffects(finishedWork);
      }

      break;
    }
    default: {
      recursivelyTraversePassiveUnmountEffects(finishedWork);
      break;
    }
  }

  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    enableComponentPerformanceTrack &&
    (finishedWork.mode & ProfileMode) !== NoMode &&
    componentEffectStartTime >= 0 &&
    componentEffectEndTime >= 0 &&
    (componentEffectSpawnedUpdate || componentEffectDuration > 0.05)
  ) {
    logComponentEffect(
      finishedWork,
      componentEffectStartTime,
      componentEffectEndTime,
      componentEffectDuration,
      componentEffectErrors,
    );
  }

  popComponentEffectStart(prevEffectStart);
  popComponentEffectDuration(prevEffectDuration);
  popComponentEffectDidSpawnUpdate(prevEffectDidSpawnUpdate);
  popComponentEffectErrors(prevEffectErrors);
}

/** Offscreen 隐藏时遍历子树并断开所有已连接 passive effect。 */
function recursivelyTraverseDisconnectPassiveEffects(parentFiber: Fiber): void {
  // 删除副作用可安排在任意 Fiber 类型上，且必须先于子节点副作用执行。
  const deletions = parentFiber.deletions;

  if ((parentFiber.flags & ChildDeletion) !== NoFlags) {
    if (deletions !== null) {
      for (let i = 0; i < deletions.length; i++) {
        const childToDelete = deletions[i];
        const prevEffectStart = pushComponentEffectStart();

        // TODO：改为递归实现。
        nextEffect = childToDelete;
        commitPassiveUnmountEffectsInsideOfDeletedTree_begin(
          childToDelete,
          parentFiber,
        );

        if (
          enableProfilerTimer &&
          enableProfilerCommitHooks &&
          enableComponentPerformanceTrack &&
          (childToDelete.mode & ProfileMode) !== NoMode &&
          componentEffectStartTime >= 0 &&
          componentEffectEndTime >= 0 &&
          componentEffectEndTime - componentEffectStartTime > 0.05
        ) {
          // 当前位于断开路径，这是已断开树内部的删除。由于此逻辑与消失路径共享，
          // 目前会在变更阶段为删除记录它。
          logComponentUnmount(
            childToDelete,
            componentEffectStartTime,
            componentEffectEndTime,
          );
        }
        popComponentEffectStart(prevEffectStart);
      }
    }
    detachAlternateSiblings(parentFiber);
  }

  // TODO：检查 PassiveStatic 标志。
  let child = parentFiber.child;
  while (child !== null) {
    disconnectPassiveEffect(child);
    child = child.sibling;
  }
}

/** 断开单 Fiber passive effect；对 Offscreen/LegacyHidden 避免重复处理已隐藏后代。 */
export function disconnectPassiveEffect(finishedWork: Fiber): void {
  const prevEffectStart = pushComponentEffectStart();
  const prevEffectDuration = pushComponentEffectDuration();
  const prevEffectErrors = pushComponentEffectErrors();
  const prevEffectDidSpawnUpdate = pushComponentEffectDidSpawnUpdate();

  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      // TODO：检查 PassiveStatic 标志。
      commitHookPassiveUnmountEffects(
        finishedWork,
        finishedWork.return,
        HookPassive,
      );
      // 断开被动副作用时，按删除时相同的顺序触发：父节点先于子节点。
      recursivelyTraverseDisconnectPassiveEffects(finishedWork);
      break;
    }
    case OffscreenComponent: {
      const instance: OffscreenInstance = finishedWork.stateNode;
      if (instance._visibility & OffscreenPassiveEffectsConnected) {
        instance._visibility &= ~OffscreenPassiveEffectsConnected;
        recursivelyTraverseDisconnectPassiveEffects(finishedWork);
      } else {
        // 副作用已经断开。
      }
      break;
    }
    default: {
      recursivelyTraverseDisconnectPassiveEffects(finishedWork);
      break;
    }
  }

  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    enableComponentPerformanceTrack &&
    (finishedWork.mode & ProfileMode) !== NoMode &&
    componentEffectStartTime >= 0 &&
    componentEffectEndTime >= 0 &&
    (componentEffectSpawnedUpdate || componentEffectDuration > 0.05)
  ) {
    logComponentEffect(
      finishedWork,
      componentEffectStartTime,
      componentEffectEndTime,
      componentEffectDuration,
      componentEffectErrors,
    );
  }

  popComponentEffectStart(prevEffectStart);
  popComponentEffectDuration(prevEffectDuration);
  popComponentEffectDidSpawnUpdate(prevEffectDidSpawnUpdate);
  popComponentEffectErrors(prevEffectErrors);
}

/** 从删除子树根开始深度优先卸载 passive effect，并在完成阶段彻底分离 Fiber。 */
function commitPassiveUnmountEffectsInsideOfDeletedTree_begin(
  deletedSubtreeRoot: Fiber,
  nearestMountedAncestor: Fiber | null,
) {
  while (nextEffect !== null) {
    const fiber = nextEffect;

    // 删除副作用按父节点到子节点的顺序触发。
    // TODO：检查 Fiber 是否带 PassiveStatic 标志。
    commitPassiveUnmountInsideDeletedTreeOnFiber(fiber, nearestMountedAncestor);

    const child = fiber.child;
    // TODO：仅在子树带 PassiveStatic 标志时遍历。
    if (child !== null) {
      child.return = fiber;
      nextEffect = child;
    } else {
      commitPassiveUnmountEffectsInsideOfDeletedTree_complete(
        deletedSubtreeRoot,
      );
    }
  }
}

/** 删除子树后序回溯：记录 profiler 时间、断开 Fiber，再转 sibling/parent。 */
function commitPassiveUnmountEffectsInsideOfDeletedTree_complete(
  deletedSubtreeRoot: Fiber,
) {
  while (nextEffect !== null) {
    const fiber = nextEffect;
    const sibling = fiber.sibling;
    const returnFiber = fiber.return;

    // 递归遍历整棵已删除树并清理 Fiber 字段。这比理想方案更激进；长期目标是只需在根部断开已删除树。
    detachFiberAfterEffects(fiber);
    if (fiber === deletedSubtreeRoot) {
      nextEffect = null;
      return;
    }

    if (sibling !== null) {
      sibling.return = returnFiber;
      nextEffect = sibling;
      return;
    }

    nextEffect = returnFiber;
  }
}

/** 按 WorkTag 卸载删除树单 Fiber 的 passive effect 与 cache/tracing 资源。 */
function commitPassiveUnmountInsideDeletedTreeOnFiber(
  current: Fiber,
  nearestMountedAncestor: Fiber | null,
): void {
  const prevEffectStart = pushComponentEffectStart();
  const prevEffectDuration = pushComponentEffectDuration();
  const prevEffectErrors = pushComponentEffectErrors();
  const prevEffectDidSpawnUpdate = pushComponentEffectDidSpawnUpdate();
  switch (current.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      commitHookPassiveUnmountEffects(
        current,
        nearestMountedAncestor,
        HookPassive,
      );
      break;
    }
    // TODO：卸载根时运行被动卸载副作用。当前未运行这些副作用，
    // 因而根拥有的缓存实例永远不会释放。副作用启用后，应在这里释放缓存：
    // case HostRoot: {
    //   const cache = current.memoizedState.cache;
    //   releaseCache(cache);
    //   break;
    // }
    case LegacyHiddenComponent:
    case OffscreenComponent: {
      if (
        current.memoizedState !== null &&
        current.memoizedState.cachePool !== null
      ) {
        const cache: Cache = current.memoizedState.cachePool.pool;
        // 保留或释放待处理（已挂起）节点使用的缓存。这里只有未挂起且可见时才会到达；
        // 内容挂起或隐藏时，由父 Suspense 组件执行保留或释放（参见上方分支）。
        if (cache != null) {
          retainCache(cache);
        }
      }
      break;
    }
    case SuspenseComponent: {
      if (enableTransitionTracing) {
        // 需要把此 Fiber 的父级标记为已删除。
        const offscreenFiber: Fiber = current.child as any;
        const instance: OffscreenInstance = offscreenFiber.stateNode;
        const transitions = instance._transitions;
        if (transitions !== null) {
          const abortReason: TransitionAbort = {
            reason: 'suspense',
            name: current.memoizedProps.name || null,
          };
          if (
            current.memoizedState === null ||
            current.memoizedState.dehydrated === null
          ) {
            abortParentMarkerTransitionsForDeletedFiber(
              offscreenFiber,
              abortReason,
              transitions,
              instance,
              true,
            );

            if (nearestMountedAncestor !== null) {
              abortParentMarkerTransitionsForDeletedFiber(
                nearestMountedAncestor,
                abortReason,
                transitions,
                instance,
                false,
              );
            }
          }
        }
      }
      break;
    }
    case CacheComponent: {
      const cache = current.memoizedState.cache;
      releaseCache(cache);
      break;
    }
    case TracingMarkerComponent: {
      if (enableTransitionTracing) {
        // 需要把此 Fiber 的父级标记为已删除。
        const instance: TracingMarkerInstance = current.stateNode;
        const transitions = instance.transitions;
        if (transitions !== null) {
          const abortReason: TransitionAbort = {
            reason: 'marker',
            name: current.memoizedProps.name,
          };
          abortParentMarkerTransitionsForDeletedFiber(
            current,
            abortReason,
            transitions,
            null,
            true,
          );

          if (nearestMountedAncestor !== null) {
            abortParentMarkerTransitionsForDeletedFiber(
              nearestMountedAncestor,
              abortReason,
              transitions,
              null,
              false,
            );
          }
        }
      }
      break;
    }
  }

  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    enableComponentPerformanceTrack &&
    (current.mode & ProfileMode) !== NoMode &&
    componentEffectStartTime >= 0 &&
    componentEffectEndTime >= 0 &&
    (componentEffectSpawnedUpdate || componentEffectDuration > 0.05)
  ) {
    logComponentEffect(
      current,
      componentEffectStartTime,
      componentEffectEndTime,
      componentEffectDuration,
      componentEffectErrors,
    );
  }

  popComponentEffectStart(prevEffectStart);
  popComponentEffectDuration(prevEffectDuration);
  popComponentEffectDidSpawnUpdate(prevEffectDidSpawnUpdate);
  popComponentEffectErrors(prevEffectErrors);
}

/** Strict Effects 开发验证：再次挂载指定 Fiber 的 layout effect/class lifecycle。 */
export function invokeLayoutEffectMountInDEV(fiber: Fiber): void {
  if (__DEV__) {
    // 此处无需再次检查 StrictEffectsMode；只有先前检查通过后才会调用本函数。
    switch (fiber.tag) {
      case FunctionComponent:
      case ForwardRef:
      case SimpleMemoComponent: {
        commitHookEffectListMount(HookLayout | HookHasEffect, fiber);
        break;
      }
      case ClassComponent: {
        commitClassDidMount(fiber);
        break;
      }
    }
  }
}

/** Strict Effects 开发验证：再次挂载指定函数 Fiber 的 passive effect。 */
export function invokePassiveEffectMountInDEV(fiber: Fiber): void {
  if (__DEV__) {
    // 此处无需再次检查 StrictEffectsMode；只有先前检查通过后才会调用本函数。
    switch (fiber.tag) {
      case FunctionComponent:
      case ForwardRef:
      case SimpleMemoComponent: {
        commitHookEffectListMount(HookPassive | HookHasEffect, fiber);
        break;
      }
    }
  }
}

/** Strict Effects 开发验证：再次卸载指定 Fiber 的 layout effect/class lifecycle。 */
export function invokeLayoutEffectUnmountInDEV(fiber: Fiber): void {
  if (__DEV__) {
    // 此处无需再次检查 StrictEffectsMode；只有先前检查通过后才会调用本函数。
    switch (fiber.tag) {
      case FunctionComponent:
      case ForwardRef:
      case SimpleMemoComponent: {
        commitHookEffectListUnmount(
          HookLayout | HookHasEffect,
          fiber,
          fiber.return,
        );
        break;
      }
      case ClassComponent: {
        const instance = fiber.stateNode;
        if (typeof instance.componentWillUnmount === 'function') {
          safelyCallComponentWillUnmount(fiber, fiber.return, instance);
        }
        break;
      }
    }
  }
}

/** Strict Effects 开发验证：再次卸载指定函数 Fiber 的 passive effect。 */
export function invokePassiveEffectUnmountInDEV(fiber: Fiber): void {
  if (__DEV__) {
    // 此处无需再次检查 StrictEffectsMode；只有先前检查通过后才会调用本函数。
    switch (fiber.tag) {
      case FunctionComponent:
      case ForwardRef:
      case SimpleMemoComponent: {
        commitHookEffectListUnmount(
          HookPassive | HookHasEffect,
          fiber,
          fiber.return,
        );
      }
    }
  }
}
