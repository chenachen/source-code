/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  ReactConsumerType,
  ReactContext,
  ReactNodeList,
  ViewTransitionProps,
  ActivityProps,
  SuspenseProps,
  SuspenseListProps,
  SuspenseListRevealOrder,
  SuspenseListTailMode,
  TracingMarkerProps,
  CacheProps,
  ProfilerProps,
} from 'shared/ReactTypes';
import type {LazyComponent as LazyComponentType} from 'react/src/ReactLazy';
import type {Fiber, FiberRoot} from './ReactInternalTypes';
import type {TypeOfMode} from './ReactTypeOfMode';
import type {Lanes, Lane} from './ReactFiberLane';
import type {ActivityState} from './ReactFiberActivityComponent';
import type {
  SuspenseState,
  SuspenseListRenderState,
} from './ReactFiberSuspenseComponent';
import type {SuspenseContext} from './ReactFiberSuspenseContext';
import type {
  LegacyHiddenProps,
  OffscreenProps,
  OffscreenState,
  OffscreenQueue,
  OffscreenInstance,
} from './ReactFiberOffscreenComponent';
import type {
  Cache,
  CacheComponentState,
  SpawnedCachePool,
} from './ReactFiberCacheComponent';
import type {UpdateQueue} from './ReactFiberClassUpdateQueue';
import type {RootState} from './ReactFiberRoot';
import type {TracingMarkerInstance} from './ReactFiberTracingMarkerComponent';
import type {ViewTransitionState} from './ReactFiberViewTransitionComponent';

import {
  markComponentRenderStarted,
  markComponentRenderStopped,
  setIsStrictModeForDevtools,
} from './ReactFiberDevToolsHook';
import {
  FunctionComponent,
  ClassComponent,
  HostRoot,
  HostComponent,
  HostHoistable,
  HostSingleton,
  HostText,
  HostPortal,
  ForwardRef,
  Fragment,
  Mode,
  ContextProvider,
  ContextConsumer,
  Profiler,
  SuspenseComponent,
  SuspenseListComponent,
  MemoComponent,
  SimpleMemoComponent,
  LazyComponent,
  IncompleteClassComponent,
  IncompleteFunctionComponent,
  ScopeComponent,
  OffscreenComponent,
  LegacyHiddenComponent,
  CacheComponent,
  TracingMarkerComponent,
  Throw,
  ViewTransitionComponent,
  ActivityComponent,
} from './ReactWorkTags';
import {
  NoFlags,
  PerformedWork,
  Placement,
  PlacementDEV,
  Hydrating,
  Callback,
  ContentReset,
  DidCapture,
  Update,
  Ref,
  RefStatic,
  ChildDeletion,
  ForceUpdateForLegacySuspense,
  StaticMask,
  ShouldCapture,
  ForceClientRender,
  Passive,
  DidDefer,
  ViewTransitionNamedStatic,
  ViewTransitionNamedMount,
  LayoutStatic,
} from './ReactFiberFlags';
import {
  disableLegacyContext,
  disableLegacyContextForFunctionComponents,
  enableProfilerCommitHooks,
  enableProfilerTimer,
  enableScopeAPI,
  enableSchedulingProfiler,
  enableTransitionTracing,
  enableLegacyHidden,
  enableCPUSuspense,
  disableLegacyMode,
  enableViewTransition,
  enableFragmentRefs,
} from 'shared/ReactFeatureFlags';
import shallowEqual from 'shared/shallowEqual';
import getComponentNameFromFiber from 'react-reconciler/src/getComponentNameFromFiber';
import getComponentNameFromType from 'shared/getComponentNameFromType';
import ReactStrictModeWarnings from './ReactStrictModeWarnings';
import {
  REACT_LAZY_TYPE,
  REACT_FORWARD_REF_TYPE,
  REACT_MEMO_TYPE,
  REACT_CONTEXT_TYPE,
} from 'shared/ReactSymbols';
import {REACT_RECOVERABLE_DIGEST} from 'shared/ReactRecoverable';
import {setCurrentFiber} from './ReactCurrentFiber';
import {resolveTypeForHotReloading} from './ReactFiberHotReloading';

import {
  mountChildFibers,
  reconcileChildFibers,
  cloneChildFibers,
  validateSuspenseListChildren,
} from './ReactChildFiber';
import {
  processUpdateQueue,
  cloneUpdateQueue,
  initializeUpdateQueue,
  enqueueCapturedUpdate,
  suspendIfUpdateReadFromEntangledAsyncAction,
} from './ReactFiberClassUpdateQueue';
import {
  NoLane,
  NoLanes,
  OffscreenLane,
  DefaultLane,
  SomeRetryLane,
  includesSomeLane,
  includesOnlyRetries,
  laneToLanes,
  removeLanes,
  mergeLanes,
  getBumpedLaneForHydration,
  pickArbitraryLane,
} from './ReactFiberLane';
import {
  ConcurrentMode,
  NoMode,
  ProfileMode,
  StrictLegacyMode,
} from './ReactTypeOfMode';
import {
  shouldSetTextContent,
  isSuspenseInstancePending,
  isSuspenseInstanceFallback,
  getSuspenseInstanceFallbackErrorDetails,
  supportsHydration,
  supportsResources,
  supportsSingletons,
  isPrimaryRenderer,
  getResource,
  createHoistableInstance,
  HostTransitionContext,
} from './ReactFiberConfig';
import type {ActivityInstance, SuspenseInstance} from './ReactFiberConfig';
import {shouldError, shouldSuspend} from './ReactFiberReconciler';
import {
  pushHostContext,
  pushHostContainer,
  getRootHostContainer,
} from './ReactFiberHostContext';
import {
  suspenseStackCursor,
  pushSuspenseListContext,
  ForceSuspenseFallback,
  hasSuspenseListContext,
  setDefaultShallowSuspenseListContext,
  setShallowSuspenseListContext,
  pushPrimaryTreeSuspenseHandler,
  pushFallbackTreeSuspenseHandler,
  pushDehydratedActivitySuspenseHandler,
  pushOffscreenSuspenseHandler,
  reuseSuspenseHandlerOnStack,
  popSuspenseHandler,
} from './ReactFiberSuspenseContext';
import {
  pushHiddenContext,
  reuseHiddenContextOnStack,
  isCurrentTreeHidden,
} from './ReactFiberHiddenContext';
import {findFirstSuspended} from './ReactFiberSuspenseComponent';
import {
  pushProvider,
  propagateContextChange,
  lazilyPropagateParentContextChanges,
  propagateParentContextChangesToDeferredTree,
  checkIfContextChanged,
  readContext,
  prepareToReadContext,
  scheduleContextWorkOnParentPath,
} from './ReactFiberNewContext';
import {
  renderWithHooks,
  checkDidRenderIdHook,
  bailoutHooks,
  replaySuspendedComponentWithHooks,
  renderTransitionAwareHostComponentWithHooks,
} from './ReactFiberHooks';
import {stopProfilerTimerIfRunning} from './ReactProfilerTimer';
import {
  getMaskedContext,
  getUnmaskedContext,
  hasContextChanged as hasLegacyContextChanged,
  pushContextProvider as pushLegacyContextProvider,
  isContextProvider as isLegacyContextProvider,
  pushTopLevelContextObject,
  invalidateContextProvider,
} from './ReactFiberLegacyContext';
import {
  getIsHydrating,
  enterHydrationState,
  reenterHydrationStateFromDehydratedActivityInstance,
  reenterHydrationStateFromDehydratedSuspenseInstance,
  resetHydrationState,
  claimHydratableSingleton,
  tryToClaimNextHydratableInstance,
  tryToClaimNextHydratableTextInstance,
  claimNextHydratableActivityInstance,
  claimNextHydratableSuspenseInstance,
  warnIfHydrating,
  queueHydrationError,
} from './ReactFiberHydrationContext';
import {
  constructClassInstance,
  mountClassInstance,
  resumeMountClassInstance,
  updateClassInstance,
  resolveClassComponentProps,
} from './ReactFiberClassComponent';
import {
  createFiberFromTypeAndProps,
  createFiberFromFragment,
  createFiberFromOffscreen,
  createWorkInProgress,
  isSimpleFunctionComponent,
  isFunctionClassComponent,
} from './ReactFiber';
import {
  scheduleUpdateOnFiber,
  renderDidSuspendDelayIfPossible,
  markSkippedUpdateLanes,
  markRenderDerivedCause,
  getWorkInProgressRoot,
  peekDeferredLane,
} from './ReactFiberWorkLoop';
import {enqueueConcurrentRenderForLane} from './ReactFiberConcurrentUpdates';
import {pushCacheProvider, CacheContext} from './ReactFiberCacheComponent';
import {
  createCapturedValueFromError,
  createCapturedValueAtFiber,
} from './ReactCapturedValue';
import {OffscreenVisible} from './ReactFiberOffscreenComponent';
import {
  createClassErrorUpdate,
  initializeClassErrorUpdate,
} from './ReactFiberThrow';
import {
  getForksAtLevel,
  isForkedChild,
  pushTreeId,
  pushMaterializedTreeId,
} from './ReactFiberTreeContext';
import {
  requestCacheFromPool,
  pushRootTransition,
  getSuspendedCache,
  pushTransition,
  getOffscreenDeferredCache,
  getPendingTransitions,
} from './ReactFiberTransition';
import {
  getMarkerInstances,
  pushMarkerInstance,
  pushRootMarkerInstance,
  TransitionTracingMarker,
} from './ReactFiberTracingMarkerComponent';
import {callComponentInDEV, callRenderInDEV} from './ReactFiberCallUserSpace';
import {resolveLazy} from './ReactFiberThenable';

/** 更新流入 dehydrated 边界时用于退出当前栈、转入 selective hydration 的内部控制异常。 */
export const SelectiveHydrationException: mixed = new Error(
  "This is not a real error. It's an implementation detail of React's " +
    "selective hydration feature. If this leaks into userspace, it's a bug in " +
    'React. Please file an issue.',
);

let didReceiveUpdate: boolean = false;

let didWarnAboutBadClass;
let didWarnAboutContextTypeOnFunctionComponent;
let didWarnAboutContextTypes;
let didWarnAboutGetDerivedStateOnFunctionComponent;
export let didWarnAboutReassigningProps: boolean;
let didWarnAboutRevealOrder;
let didWarnAboutTailOptions;
let didWarnAboutClassNameOnViewTransition;

if (__DEV__) {
  didWarnAboutBadClass = {} as {
    /** 已报告非法 class 形态的组件名。 */
    [string]: boolean
  };
  didWarnAboutContextTypeOnFunctionComponent = {} as {
    /** 已报告函数组件误用 contextType 的组件名。 */
    [string]: boolean
  };
  didWarnAboutContextTypes = {} as {
    /** 已报告 legacy contextTypes 的组件名。 */
    [string]: boolean
  };
  didWarnAboutGetDerivedStateOnFunctionComponent = {} as {
    /** 已报告函数组件误用 getDerivedStateFromProps 的组件名。 */
    [string]: boolean
  };
  didWarnAboutReassigningProps = false;
  didWarnAboutRevealOrder = {} as {
    /** 已报告非法 SuspenseList revealOrder 的输入。 */
    [string]: boolean
  };
  didWarnAboutTailOptions = {} as {
    /** 已报告非法 SuspenseList tail 组合的输入。 */
    [string]: boolean
  };
  didWarnAboutClassNameOnViewTransition = {} as {
    /** 已报告 ViewTransition className 误用的组件名。 */
    [string]: boolean
  };
}

/** 按是否存在 current 选择 mount/update child reconciler，生成下一层 work-in-progress child 链。 */
export function reconcileChildren(
  current: Fiber | null,
  workInProgress: Fiber,
  nextChildren: any,
  renderLanes: Lanes,
) {
  if (current === null) {
    // 首次渲染无需以最小副作用更新既有 child 集合；所有子节点都会在渲染前加入，
    // 因而本轮协调可走不跟踪副作用的挂载路径。
    workInProgress.child = mountChildFibers(
      workInProgress,
      null,
      nextChildren,
      renderLanes,
    );
  } else {
    // current child 与 work-in-progress 相同表示尚未处理这些子节点；协调器会克隆当前链。
    // 若曾有推进中的工作，此时已失效，应直接丢弃并重新协调。
    workInProgress.child = reconcileChildFibers(
      workInProgress,
      current.child,
      nextChildren,
      renderLanes,
    );
  }
}

/** 先删除全部 current child、再以空 current 挂载新 child，强制同 key/type 也重新挂载。 */
function forceUnmountCurrentAndReconcile(
  current: Fiber,
  workInProgress: Fiber,
  nextChildren: any,
  renderLanes: Lanes,
) {
  // 这是 reconcileChildren 的强制重挂载分支：不与既有集合匹配，即使 type/key 相同，
  // 旧 child 也会卸载并创建新 child。第一遍传入 null，为全部当前子节点安排删除。
  workInProgress.child = reconcileChildFibers(
    workInProgress,
    current.child,
    null,
    renderLanes,
  );
  // 第二遍把 current child 集合替换为 null 来挂载新 children，从而无条件重挂载。
  workInProgress.child = reconcileChildFibers(
    workInProgress,
    null,
    nextChildren,
    renderLanes,
  );
}

/** 执行 ForwardRef renderWithHooks，剥离 props.ref 后协调 children，并处理 bailout/调试标志。 */
function updateForwardRef(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  nextProps: any,
  renderLanes: Lanes,
) {
  // TODO：首次渲染挂起后，即使组件尚未挂载，current 也可能非 null；需确认是否安全。
  let render = Component.render;
  if (__DEV__) {
    const resolvedRender = resolveTypeForHotReloading(render);
    if (resolvedRender !== render) {
      render = resolvedRender;
      if (current !== null) {
        didReceiveUpdate = true;
      }
    }
  }
  const ref = workInProgress.ref;

  let propsWithoutRef;
  if ('ref' in nextProps) {
    // ref 现在也是 prop，但 forwardRef 仍要求传给 render 的 props 中不含 ref；
    // 该剥离过去由 JSX runtime 完成，现在移到这里。
    propsWithoutRef = {} as {
      /** 除 ref 外透传给 ForwardRef render 的属性。 */
      [string]: any
    };
    for (const key in nextProps) {
      // ref 只应由 JSX transform 加入，因此可假定 nextProps 是普通对象，无需 hasOwnProperty 检查。
      if (key !== 'ref') {
        propsWithoutRef[key] = nextProps[key];
      }
    }
  } else {
    propsWithoutRef = nextProps;
  }

  // 余下流程与 updateFunctionComponent 同源。
  prepareToReadContext(workInProgress, renderLanes);
  if (enableSchedulingProfiler) {
    markComponentRenderStarted(workInProgress);
  }

  const nextChildren = renderWithHooks(
    current,
    workInProgress,
    render,
    propsWithoutRef,
    ref,
    renderLanes,
  );
  const hasId = checkDidRenderIdHook();

  if (enableSchedulingProfiler) {
    markComponentRenderStopped();
  }

  if (current !== null && !didReceiveUpdate) {
    bailoutHooks(current, workInProgress, renderLanes);
    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
  }

  if (getIsHydrating() && hasId) {
    pushMaterializedTreeId(workInProgress);
  }

  // React DevTools 读取该标志判断组件是否实际执行过渲染。
  workInProgress.flags |= PerformedWork;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

/** 按自定义/浅比较决定 Memo 外壳 bailout，或创建/更新其内层组件 Fiber。 */
function updateMemoComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  nextProps: any,
  renderLanes: Lanes,
): null | Fiber {
  if (current === null) {
    const type = Component.type;
    if (isSimpleFunctionComponent(type) && Component.compare === null) {
      let resolvedType = type;
      if (__DEV__) {
        resolvedType = resolveTypeForHotReloading(type);
      }
      // 普通函数组件没有 default props 且仅使用默认浅比较时，
      // 升级为 SimpleMemoComponent 以启用更新快速路径。
      workInProgress.tag = SimpleMemoComponent;
      workInProgress.type = resolvedType;
      if (__DEV__) {
        validateFunctionComponentInDev(workInProgress, type);
      }
      return updateSimpleMemoComponent(
        current,
        workInProgress,
        resolvedType,
        nextProps,
        renderLanes,
      );
    }
    const child = createFiberFromTypeAndProps(
      Component.type,
      null,
      nextProps,
      workInProgress,
      workInProgress.mode,
      renderLanes,
    );
    child.ref = workInProgress.ref;
    child.return = workInProgress;
    workInProgress.child = child;
    return child;
  }
  const currentChild = current.child as any as Fiber; // 这里始终恰好只有一个 child。
  const hasScheduledUpdateOrContext = checkScheduledUpdateOrContext(
    current,
    renderLanes,
  );
  if (!hasScheduledUpdateOrContext) {
    // 这里读取的是已解析 defaultProps 的 props；current.memoizedProps 仍是未解析形式。
    const prevProps = currentChild.memoizedProps;
    // 未提供自定义 compare 时默认浅比较。
    let compare = Component.compare;
    compare = compare !== null ? compare : shallowEqual;
    if (compare(prevProps, nextProps) && current.ref === workInProgress.ref) {
      return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
    }
  }
  // React DevTools 读取该标志判断组件是否实际执行过渲染。
  workInProgress.flags |= PerformedWork;
  const newChild = createWorkInProgress(currentChild, nextProps);
  newChild.ref = workInProgress.ref;
  newChild.return = workInProgress;
  workInProgress.child = newChild;
  return newChild;
}

/** 对 SimpleMemoComponent 做浅 props/ref/实现比较，复用 props 与 lanes 后快速 bailout。 */
function updateSimpleMemoComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  nextProps: any,
  renderLanes: Lanes,
): null | Fiber {
  // TODO：内层渲染挂起后，即使组件尚未挂载，current 也可能非 null；需确认是否安全。
  if (current !== null) {
    const prevProps = current.memoizedProps;
    if (
      shallowEqual(prevProps, nextProps) &&
      current.ref === workInProgress.ref &&
      // 热更新改变实现时禁止 bailout。
      (__DEV__ ? workInProgress.type === current.type : true)
    ) {
      didReceiveUpdate = false;

      // props 浅相等时像普通 Fiber bailout 一样复用旧 props 对象。
      // 若同批次还有本地 state/context 更新而无法 bailout，引用相等性并无强保证；
      // 但不同 memo 包装方式应保持一致。React.memo 包装普通函数得到 SimpleMemoComponent，
      // 包装 forwardRef 等得到 MemoComponent，这只是内部布局差异，不应影响 bailout 时的复用语义。
      workInProgress.pendingProps = nextProps = prevProps;

      if (!checkScheduledUpdateOrContext(current, renderLanes)) {
        // beginWork 开头已清除 pending lanes，但本轮未包含的 lane 仍可能有工作。
        // 通常组件求值/处理更新队列时会重新累计优先级；此处不求值就提前 bailout，
        // 必须从 current 恢复 lanes。该特例仅适用于自身可持有 Hooks/更新队列的
        // SimpleMemoComponent；MemoComponent 只是包裹内层组件。
        // TODO：把 beginWork 的重置移出公共路径，消除此补偿。
        workInProgress.lanes = current.lanes;
        return bailoutOnAlreadyFinishedWork(
          current,
          workInProgress,
          renderLanes,
        );
      } else if ((current.flags & ForceUpdateForLegacySuspense) !== NoFlags) {
        // 仅 legacy mode 需要此特例，参见 https://github.com/facebook/react/pull/19216。
        didReceiveUpdate = true;
      }
    }
  }
  return updateFunctionComponent(
    current,
    workInProgress,
    Component,
    nextProps,
    renderLanes,
  );
}

/** 按 hidden/visible、OffscreenLane 与缓存池状态决定延后、恢复或渲染 Offscreen 子树。 */
function updateOffscreenComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
  nextProps: OffscreenProps,
) {
  const nextChildren = nextProps.children;

  const prevState: OffscreenState | null =
    current !== null ? current.memoizedState : null;

  if (current === null && workInProgress.stateNode === null) {
    // work-in-progress 先前被重置，需要新建 Offscreen 实例。
    const primaryChildInstance: OffscreenInstance = {
      _visibility: OffscreenVisible,
      _pendingMarkers: null,
      _retryCache: null,
      _transitions: null,
    };
    workInProgress.stateNode = primaryChildInstance;
  }

  if (
    nextProps.mode === 'hidden' ||
    (enableLegacyHidden && nextProps.mode === 'unstable-defer-without-hiding')
  ) {
    // 当前渲染隐藏树。

    const didSuspend = (workInProgress.flags & DidCapture) !== NoFlags;
    if (didSuspend) {
      // 隐藏树内部发生挂起。

      // 合并上轮保留的 base lanes。
      const nextBaseLanes =
        prevState !== null
          ? mergeLanes(prevState.baseLanes, renderLanes)
          : renderLanes;

      let remainingChildLanes;
      if (current !== null) {
        // 恢复 current children。
        let currentChild = (workInProgress.child = current.child);

        // 本轮虽已挂起，其他 lane 仍可能有工作。Offscreen 延后时重置过 childLanes，
        // 不能直接读取 current Offscreen，只能从各 child Fiber 重新汇总。
        let currentChildLanes: Lanes = NoLanes;
        while (currentChild !== null) {
          currentChildLanes = mergeLanes(
            mergeLanes(currentChildLanes, currentChild.lanes),
            currentChild.childLanes,
          );
          currentChild = currentChild.sibling;
        }
        const lanesWeJustAttempted = nextBaseLanes;
        remainingChildLanes = removeLanes(
          currentChildLanes,
          lanesWeJustAttempted,
        );
      } else {
        remainingChildLanes = NoLanes;
        workInProgress.child = null;
      }

      return deferHiddenOffscreenComponent(
        current,
        workInProgress,
        nextBaseLanes,
        renderLanes,
        remainingChildLanes,
      );
    }

    if (
      !disableLegacyMode &&
      (workInProgress.mode & ConcurrentMode) === NoMode
    ) {
      // legacy 同步模式不延后子树，立即渲染。
      // TODO：后续明确 Offscreen 与 transition 的交互语义。
      const nextState: OffscreenState = {
        baseLanes: NoLanes,
        cachePool: null,
      };
      workInProgress.memoizedState = nextState;
      // 即将 bailout 仍需压入 cache pool，否则 context 栈会错位。
      if (current !== null) {
        pushTransition(workInProgress, null, null);
      }
      reuseHiddenContextOnStack(workInProgress);
      pushOffscreenSuspenseHandler(workInProgress);
    } else if (!includesSomeLane(renderLanes, OffscreenLane as Lane)) {
      // 当前隐藏且并非 OffscreenLane 渲染；先 bailout，稍后恢复该树。

      // 把该 Fiber 调度到 Offscreen 优先级重渲染。

      const remainingChildLanes = (workInProgress.lanes =
        laneToLanes(OffscreenLane));

      // 合并上轮保留的 base lanes。
      const nextBaseLanes =
        prevState !== null
          ? mergeLanes(prevState.baseLanes, renderLanes)
          : renderLanes;

      return deferHiddenOffscreenComponent(
        current,
        workInProgress,
        nextBaseLanes,
        renderLanes,
        remainingChildLanes,
      );
    } else {
      // 这是第二轮渲染，周围可见内容已提交；现在恢复隐藏树。

      // 已在 OffscreenLane 渲染，可清空 base lanes。
      const nextState: OffscreenState = {
        baseLanes: NoLanes,
        cachePool: null,
      };
      workInProgress.memoizedState = nextState;
      if (current !== null) {
        // 若派生本轮的渲染访问过 cache pool，则复用同一缓存；父级变化表示 refresh，不能复用。
        const prevCachePool = prevState !== null ? prevState.cachePool : null;
        // TODO：确定 Offscreen 预渲染是否及如何归因到创建它的 transition。
        pushTransition(workInProgress, prevCachePool, null);
      }

      // 压入先前 bailout 时跳过的 lanes。
      if (prevState !== null) {
        pushHiddenContext(workInProgress, prevState);
      } else {
        reuseHiddenContextOnStack(workInProgress);
      }
      pushOffscreenSuspenseHandler(workInProgress);
    }
  } else {
    // 当前渲染可见树。
    if (prevState !== null) {
      // 状态由 hidden 切换为 visible。
      let prevCachePool = null;
      // 若派生本轮的渲染访问过 cache pool，则恢复同一缓存；父级变化表示 refresh。
      prevCachePool = prevState.cachePool;

      let transitions = null;
      if (enableTransitionTracing) {
        // hidden→visible 时把关联 transitions 压栈，使其传播到 Offscreen/Suspense 后代。
        const instance: OffscreenInstance | null = workInProgress.stateNode;
        if (instance !== null && instance._transitions != null) {
          transitions = Array.from(instance._transitions);
        }
      }

      pushTransition(workInProgress, prevCachePool, transitions);

      // 压入先前 bailout 时跳过的 lanes。
      pushHiddenContext(workInProgress, prevState);
      reuseSuspenseHandlerOnStack(workInProgress);

      // 已不再隐藏，清除 Offscreen 状态。
      workInProgress.memoizedState = null;
    } else {
      // 前后都可见，无特殊状态变更；仍必须压栈以保持 push/pop 对称。

      // 若派生本轮的渲染访问过 cache pool，则恢复同一缓存；父级变化表示 refresh。
      if (current !== null) {
        pushTransition(workInProgress, null, null);
      }

      // 即将 bailout 仍需压栈，避免 push/pop 错位。
      reuseHiddenContextOnStack(workInProgress);
      reuseSuspenseHandlerOnStack(workInProgress);
    }
  }

  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

/** Offscreen 无本优先级工作时维持栈对称并跳过子树。 */
function bailoutOffscreenComponent(
  current: Fiber | null,
  workInProgress: Fiber,
): Fiber | null {
  if (
    (current === null || current.tag !== OffscreenComponent) &&
    workInProgress.stateNode === null
  ) {
    const primaryChildInstance: OffscreenInstance = {
      _visibility: OffscreenVisible,
      _pendingMarkers: null,
      _retryCache: null,
      _transitions: null,
    };
    workInProgress.stateNode = primaryChildInstance;
  }

  return workInProgress.sibling;
}

/** 保存隐藏树 baseLanes/cache，并把其余工作改调度到 OffscreenLane 后退出本轮。 */
function deferHiddenOffscreenComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  nextBaseLanes: Lanes,
  renderLanes: Lanes,
  remainingChildLanes: Lanes,
) {
  const nextState: OffscreenState = {
    baseLanes: nextBaseLanes,
    // 保存 cache pool，供后续恢复。
    cachePool: getOffscreenDeferredCache(),
  };
  workInProgress.memoizedState = nextState;
  // 即将 bailout 仍需压入 cache pool，否则 context 栈会错位。
  if (current !== null) {
    pushTransition(workInProgress, null, null);
  }

  // 即将 bailout 仍需压栈，避免 push/pop 错位。
  reuseHiddenContextOnStack(workInProgress);

  pushOffscreenSuspenseHandler(workInProgress);

  if (current !== null) {
    // 该树会在独立渲染中恢复，必须现在传播父 context，避免丢失变更来源。
    propagateParentContextChangesToDeferredTree(
      current,
      workInProgress,
      renderLanes,
    );
  }

  // 用外部计算的子集覆盖剩余 child lanes。必须在 context 传播后执行，
  // 因为传播可能把调度冒泡到根并改写 childLanes；本轮尚不处理这部分，应将其排除。
  workInProgress.childLanes = remainingChildLanes;

  return null;
}

/** 以 Offscreen 同构 begin 逻辑更新 LegacyHidden；保留独立入口便于未来语义分叉。 */
function updateLegacyHiddenComponent(
  current: null | Fiber,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  const nextProps: LegacyHiddenProps = workInProgress.pendingProps;
  // 两者目前恰好拥有相同 begin 阶段与 Props；不应固化该约束，语义分叉时应拆分实现。
  return updateOffscreenComponent(
    current,
    workInProgress,
    renderLanes,
    nextProps,
  );
}

/** 为 Activity 边界创建 primary Offscreen child，并按 mode 设置可见/隐藏初始状态。 */
function mountActivityChildren(
  workInProgress: Fiber,
  nextProps: ActivityProps,
  renderLanes: Lanes,
) {
  if (__DEV__) {
    const hiddenProp = (nextProps as any).hidden;
    if (hiddenProp !== undefined) {
      console.error(
        '<Activity> doesn\'t accept a hidden prop. Use mode="hidden" instead.\n' +
          '- <Activity %s>\n' +
          '+ <Activity %s>',
        hiddenProp === true
          ? 'hidden'
          : hiddenProp === false
            ? 'hidden={false}'
            : 'hidden={...}',
        hiddenProp ? 'mode="hidden"' : 'mode="visible"',
      );
    }
  }
  const nextChildren = nextProps.children;
  const nextMode = nextProps.mode;
  const mode = workInProgress.mode;
  const offscreenChildProps: OffscreenProps = {
    mode: nextMode,
    children: nextChildren,
  };
  const primaryChildFragment = mountWorkInProgressOffscreenFiber(
    offscreenChildProps,
    mode,
    renderLanes,
  );
  primaryChildFragment.ref = workInProgress.ref;
  workInProgress.child = primaryChildFragment;
  primaryChildFragment.return = workInProgress;
  return primaryChildFragment;
}

/** Activity hydration 失败后删除 dehydrated child，改建客户端 Offscreen 树并记录可恢复错误。 */
function retryActivityComponentWithoutHydrating(
  current: Fiber,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  // 降级为客户端渲染会带来性能代价，因此即使用户通常看不出 UI 异常，也记为可恢复错误。

  // 把旧 Fiber 加入删除列表。
  reconcileChildFibers(workInProgress, current.child, null, renderLanes);

  // 此后边界既不挂起，也不再 dehydrated。
  const nextProps: ActivityProps = workInProgress.pendingProps;
  const primaryChildFragment = mountActivityChildren(
    workInProgress,
    nextProps,
    renderLanes,
  );
  // 父 Activity 边界已经挂载，而这是新 Fiber，因此需要 Placement 副作用。
  primaryChildFragment.flags |= Placement;

  // 若不再 hydration，后续挂起不能留在 dehydrated 状态，应冒泡到最近父边界；
  // 因此弹出刚压入的自身 handler。
  popSuspenseHandler(workInProgress);

  workInProgress.memoizedState = null;

  return primaryChildFragment;
}

/** 首次遇到服务端 Activity 占位时保留 DOM，不下钻 child，并以 Offscreen 优先级安排 hydration。 */
function mountDehydratedActivityComponent(
  workInProgress: Fiber,
  activityInstance: ActivityInstance,
  renderLanes: Lanes,
): null | Fiber {
  // 首轮不下钻 children，保留现有服务端内容并稍后 hydration。
  // 页面已显示正确内容，其余工作可在 Offscreen 优先级继续，无需抢占。
  workInProgress.lanes = laneToLanes(OffscreenLane);
  return null;
}

/**
 * 更新 dehydrated Activity：尝试选择性 hydration；输入变化、错误或挂起时决定提高优先级、
 * 保留服务端内容或切到客户端渲染。
 */
function updateDehydratedActivityComponent(
  current: Fiber,
  workInProgress: Fiber,
  didSuspend: boolean,
  nextProps: ActivityProps,
  activityInstance: ActivityInstance,
  activityState: ActivityState,
  renderLanes: Lanes,
): null | Fiber {
  // 本边界可通过保持 dehydrated 吸收挂起；先压入 handler，若改走非 hydration 尝试再弹出。
  pushDehydratedActivitySuspenseHandler(workInProgress);
  if (!didSuspend) {
    // 首轮渲染，尝试 hydration。

    // 这是首次尝试但树已提交过一次，此时不应仍处于全局 hydration 状态。
    warnIfHydrating();

    if (includesSomeLane(renderLanes, OffscreenLane as Lane)) {
      // 在 OffscreenLane 进入 Activity 时，本边界遗留工作可能是唯一渲染原因；
      // 若尚无 cause，则把它记录为派生原因。
      markRenderDerivedCause(workInProgress);
    }

    if (
      // TODO：此处拆分略显重复，下一段还会检查同一条件。
      !didReceiveUpdate
    ) {
      // bailout 前必须知道 child 是否依赖 context，因此现在传播父级变更。
      lazilyPropagateParentContextChanges(current, workInProgress, renderLanes);
    }

    // lanes 表示 child 可能依赖 context；任一 context 变化都按输入可能变化处理。
    const hasContextChanged = includesSomeLane(renderLanes, current.childLanes);
    if (didReceiveUpdate || hasContextChanged) {
      // 边界自首轮后已变化，当前 lane 无法 hydration；更高优先级 lane 仍可能成功。
      if (isCurrentTreeHidden()) {
        // 隐藏子树的工作会延后到揭示。选择性 hydration 依赖在更新生效前以更高优先级渲染，
        // 在此无法推进；等待会导致提交死锁。替换隐藏内容不可见，因此直接放弃并客户端渲染。
        return retryActivityComponentWithoutHydrating(
          current,
          workInProgress,
          renderLanes,
        );
      }
      const root = getWorkInProgressRoot();
      if (root !== null) {
        const attemptHydrationAtLane = getBumpedLaneForHydration(
          root,
          renderLanes,
        );
        if (
          attemptHydrationAtLane !== NoLane &&
          attemptHydrationAtLane !== activityState.retryLane
        ) {
          // 本轮马上会被中断，因此有意在 render 阶段修改 current 树；这是极少数例外。
          activityState.retryLane = attemptHydrationAtLane;
          enqueueConcurrentRenderForLane(current, attemptHydrationAtLane);
          scheduleUpdateOnFiber(root, current, attemptHydrationAtLane);

          // 抛出特殊对象通知 work loop 中断本轮。React 内部栈也可改写状态实现，
          // 但异常可避免每次循环都检查该情况，把判断移出快速路径。
          throw SelectiveHydrationException;
        } else {
          // 已尝试更高优先级 ping 仍无法 hydration，只能放弃：删除整棵子树并注入真实 Activity 边界。
          // 新边界可能继续挂起；若本轮提交前条件改善，仍可能再次获得 hydration 机会。
        }
      }

      // 未能选择性 hydration 时继续客户端渲染，并把树标为挂起，防止在 transition 外提交。
      // 仅 hydration lane 已经挂起时应进入该路径。
      renderDidSuspendDelayIfPossible();
      return retryActivityComponentWithoutHydrating(
        current,
        workInProgress,
        renderLanes,
      );
    } else {
      // 这是首次 hydration 尝试。

      reenterHydrationStateFromDehydratedActivityInstance(
        workInProgress,
        activityInstance,
        activityState.treeContext,
      );

      const primaryChildFragment = mountActivityChildren(
        workInProgress,
        nextProps,
        renderLanes,
      );
      // 标记 children 正在 hydration，供快速判断节点是否完成挂载及安排事件重放。
      // 概念上类似 Placement：新子树插入 React 树，只因 DOM 已存在而无需宿主变更；
      // Fiber 仍视为新插入，以便 Strict Effects 双调用。
      primaryChildFragment.flags |= Hydrating | PlacementDEV;
      return primaryChildFragment;
    }
  } else {
    // 第二轮渲染：先前 hydration 尝试发生了挂起或错误。

    if (workInProgress.flags & ForceClientRender) {
      // hydration 发生错误；清除标志并以客户端渲染重试。错误已由 throwException 记录。
      workInProgress.flags &= ~ForceClientRender;
      return retryActivityComponentWithoutHydrating(
        current,
        workInProgress,
        renderLanes,
      );
    } else if (
      (workInProgress.memoizedState as null | ActivityState) !== null
    ) {
      // 发生挂起且仍处于 dehydrated 模式，保留现有 child。

      workInProgress.child = current.child;
      // dehydrated 完成阶段要求 DidCapture；普通 Offscreen 路径不需要。
      workInProgress.flags |= DidCapture;
      return null;
    } else {
      // 已调用 retryActivityComponentWithoutHydrating 改为客户端渲染，却再次在此挂起。
      // 第二轮本不应压入自身 suspense handler，挂起应向上冒泡，因此到达这里是内部错误。
      throw new Error(
        'Client rendering an Activity suspended it again. This is a bug in React.',
      );
    }
  }
}

/** 按 Activity mode、dehydrated 状态与可见性更新其 Offscreen 内容及 suspense handler。 */
function updateActivityComponent(
  current: null | Fiber,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  const nextProps: ActivityProps = workInProgress.pendingProps;

  // 检查首轮是否挂起。
  const didSuspend = (workInProgress.flags & DidCapture) !== NoFlags;
  workInProgress.flags &= ~DidCapture;

  if (current === null) {
    // 首次挂载。

    // hydration 特殊路径：若当前正在 hydration，则尝试认领该边界。
    // 服务端不会输出 hidden Activity 边界。
    if (getIsHydrating()) {
      if (nextProps.mode === 'hidden') {
        // SSR 不输出 hidden Activity，故不能 hydration；即使当前是 OffscreenLane，
        // 也延后到客户端 Offscreen 渲染。
        const primaryChildFragment = mountActivityChildren(
          workInProgress,
          nextProps,
          renderLanes,
        );
        workInProgress.lanes = laneToLanes(OffscreenLane);
        return bailoutOffscreenComponent(null, primaryChildFragment);
      } else {
        // 尝试 hydration 前必须先压入 suspense handler，避免错误路径造成栈不匹配。
        pushDehydratedActivitySuspenseHandler(workInProgress);
        const dehydrated: ActivityInstance =
          claimNextHydratableActivityInstance(workInProgress);
        return mountDehydratedActivityComponent(
          workInProgress,
          dehydrated,
          renderLanes,
        );
      }
    }

    return mountActivityChildren(workInProgress, nextProps, renderLanes);
  } else {
    // 更新路径。

    // dehydrated Activity 的 hydration 特殊路径。
    const prevState: null | ActivityState = current.memoizedState;

    if (prevState !== null) {
      const dehydrated = prevState.dehydrated;
      return updateDehydratedActivityComponent(
        current,
        workInProgress,
        didSuspend,
        nextProps,
        dehydrated,
        prevState,
        renderLanes,
      );
    }

    const currentChild: Fiber = current.child as any;

    const nextChildren = nextProps.children;
    const nextMode = nextProps.mode;
    const offscreenChildProps: OffscreenProps = {
      mode: nextMode,
      children: nextChildren,
    };

    if (
      includesSomeLane(renderLanes, OffscreenLane as Lane) &&
      includesSomeLane(renderLanes, current.lanes)
    ) {
      // 在 OffscreenLane 进入 Activity 时，本边界遗留工作可能是唯一渲染原因；
      // 若尚无 cause，则记录为派生原因。
      markRenderDerivedCause(workInProgress);
    }

    const primaryChildFragment = updateWorkInProgressOffscreenFiber(
      currentChild,
      offscreenChildProps,
    );

    primaryChildFragment.ref = workInProgress.ref;
    workInProgress.child = primaryChildFragment;
    primaryChildFragment.return = workInProgress;
    return primaryChildFragment;
  }
}

/** 读取/刷新 CacheComponent 的 update queue，向子树提供稳定 CacheContext 后协调 children。 */
function updateCacheComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  prepareToReadContext(workInProgress, renderLanes);
  const parentCache = readContext(CacheContext);

  if (current === null) {
    // 首次挂载，从 pool 请求新 cache。
    const freshCache = requestCacheFromPool(renderLanes);
    const initialState: CacheComponentState = {
      parent: parentCache,
      cache: freshCache,
    };
    workInProgress.memoizedState = initialState;
    initializeUpdateQueue(workInProgress);
    pushCacheProvider(workInProgress, freshCache);
  } else {
    // 检查并处理本 Fiber 的更新。
    if (includesSomeLane(current.lanes, renderLanes)) {
      cloneUpdateQueue(current, workInProgress);
      processUpdateQueue(workInProgress, null, null, renderLanes);
      suspendIfUpdateReadFromEntangledAsyncAction();
    }
    const prevState: CacheComponentState = current.memoizedState;
    const nextState: CacheComponentState = workInProgress.memoizedState;

    // 比较新旧父 cache，判断父级是否 refresh。
    if (prevState.parent !== parentCache) {
      // 父级已 refresh，派生状态改为新父 cache。
      const derivedState: CacheComponentState = {
        parent: parentCache,
        cache: parentCache,
      };

      // 与 getDerivedStateFromProps 相同：更新队列清空后，把派生状态持久化为 baseState。
      workInProgress.memoizedState = derivedState;
      if (workInProgress.lanes === NoLanes) {
        const updateQueue: UpdateQueue<any> = workInProgress.updateQueue as any;
        workInProgress.memoizedState = updateQueue.baseState = derivedState;
      }

      pushCacheProvider(workInProgress, parentCache);
      // 父级 refresh 已传播 context 变化，无需重复处理。
    } else {
      // 父级未 refresh，再检查当前 cache 自身。
      const nextCache = nextState.cache;
      pushCacheProvider(workInProgress, nextCache);
      if (nextCache !== prevState.cache) {
        // 当前 cache 已 refresh，传播 CacheContext 变化。
        propagateContextChange(workInProgress, CacheContext, renderLanes);
      }
    }
  }

  const nextProps: CacheProps = workInProgress.pendingProps;

  const nextChildren = nextProps.children;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

// 仅应在 marker 首次创建或名称变化时调用。
/** 创建或复用 TransitionTracing marker 实例，并把 marker/transition 集合压入子树上下文。 */
function updateTracingMarkerComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  if (!enableTransitionTracing) {
    return null;
  }

  const nextProps: TracingMarkerProps = workInProgress.pendingProps;

  // TODO(luna)：仅在 tracing marker 新渲染或名称变化时更新。
  // marker 只关联渲染/更新它的 transitions，因此每次可创建新的集合。
  if (current === null) {
    const currentTransitions = getPendingTransitions();
    if (currentTransitions !== null) {
      const markerInstance: TracingMarkerInstance = {
        tag: TransitionTracingMarker,
        transitions: new Set(currentTransitions),
        pendingBoundaries: null,
        name: nextProps.name,
        aborts: null,
      };
      workInProgress.stateNode = markerInstance;

      // 所有子 Suspense 边界解决后，在 Offscreen commit 阶段调用 marker complete。
      // 若没有子边界，仍需安排 passive effect 以保证回调触发。
      workInProgress.flags |= Passive;
    }
  } else {
    if (__DEV__) {
      if (current.memoizedProps.name !== nextProps.name) {
        console.error(
          'Changing the name of a tracing marker after mount is not supported. ' +
            'To remount the tracing marker, pass it a new key.',
        );
      }
    }
  }

  const instance: TracingMarkerInstance | null = workInProgress.stateNode;
  if (instance !== null) {
    pushMarkerInstance(workInProgress, instance);
  }
  const nextChildren = nextProps.children;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

/** 以 Fragment.pendingProps 直接协调其 children。 */
function updateFragment(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  const nextChildren = workInProgress.pendingProps;
  if (enableFragmentRefs) {
    markRef(current, workInProgress);
  }
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

/** Mode Fiber 不产生宿主输出，仅协调其 children。 */
function updateMode(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  const nextChildren = workInProgress.pendingProps.children;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

/** 初始化 Profiler 计时/回调标志并协调其 children。 */
function updateProfiler(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  if (enableProfilerTimer) {
    workInProgress.flags |= Update;

    if (enableProfilerCommitHooks) {
      // 为 Profiler 安排 passive effect 来调用 onPostCommit；即使没有回调也要安排，
      // 因为耗时也在此阶段向父 Profiler 冒泡。
      workInProgress.flags |= Passive;
      // 为下一次 effect 阶段重置耗时；在 render 中重置可让 DevTools commit hook 先读取旧值。
      const stateNode = workInProgress.stateNode;
      stateNode.effectDuration = -0;
      stateNode.passiveEffectDuration = -0;
    }
  }
  const nextProps: ProfilerProps = workInProgress.pendingProps;
  const nextChildren = nextProps.children;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

/** ref 新增、替换或移除时标记 Ref/RefStatic，交给 commit 阶段 attach/detach。 */
function markRef(current: Fiber | null, workInProgress: Fiber) {
  // TODO：启用 enableRefAsProp 时应检查 props.ref，而不是 fiber.ref。
  const ref = workInProgress.ref;
  if (ref === null) {
    if (current !== null && current.ref !== null) {
      // 安排 Ref 副作用。
      workInProgress.flags |= Ref | RefStatic;
    }
  } else {
    if (typeof ref !== 'function' && typeof ref !== 'object') {
      throw new Error(
        'Expected ref to be a function, an object returned by React.createRef(), or undefined/null.',
      );
    }
    if (current === null || current.ref !== ref) {
      // 安排 Ref 副作用。
      workInProgress.flags |= Ref | RefStatic;
    }
  }
}

/** Legacy 非并发树中函数组件挂起后，以全新 mount 语义重置并再次执行。 */
function mountIncompleteFunctionComponent(
  _current: null | Fiber,
  workInProgress: Fiber,
  Component: any,
  nextProps: any,
  renderLanes: Lanes,
) {
  resetSuspendedCurrentOnMountInLegacyMode(_current, workInProgress);

  workInProgress.tag = FunctionComponent;

  return updateFunctionComponent(
    null,
    workInProgress,
    Component,
    nextProps,
    renderLanes,
  );
}

/** 准备 Context、执行 renderWithHooks、判断 hook/context 更新并协调函数组件 children。 */
function updateFunctionComponent(
  current: null | Fiber,
  workInProgress: Fiber,
  Component: any,
  nextProps: any,
  renderLanes: Lanes,
) {
  if (__DEV__) {
    if (
      Component.prototype &&
      typeof Component.prototype.render === 'function'
    ) {
      const componentName = getComponentNameFromType(Component) || 'Unknown';

      if (!didWarnAboutBadClass[componentName]) {
        console.error(
          "The <%s /> component appears to have a render method, but doesn't extend React.Component. " +
            'This is likely to cause errors. Change %s to extend React.Component instead.',
          componentName,
          componentName,
        );
        didWarnAboutBadClass[componentName] = true;
      }
    }

    if (workInProgress.mode & StrictLegacyMode) {
      ReactStrictModeWarnings.recordLegacyContextWarning(workInProgress, null);
    }

    if (current === null) {
      // 部分校验过去在 mountIndeterminateComponent 中执行；现移到 updateFunctionComponent，
      // 但仍只在挂载时运行。
      validateFunctionComponentInDev(workInProgress, workInProgress.type);

      if (Component.contextTypes) {
        const componentName = getComponentNameFromType(Component) || 'Unknown';

        if (!didWarnAboutContextTypes[componentName]) {
          didWarnAboutContextTypes[componentName] = true;
          if (disableLegacyContext) {
            console.error(
              '%s uses the legacy contextTypes API which was removed in React 19. ' +
                'Use React.createContext() with React.useContext() instead. ' +
                '(https://react.dev/link/legacy-context)',
              componentName,
            );
          } else {
            console.error(
              '%s uses the legacy contextTypes API which will be removed soon. ' +
                'Use React.createContext() with React.useContext() instead. ' +
                '(https://react.dev/link/legacy-context)',
              componentName,
            );
          }
        }
      }
    }
  }

  let context;
  if (!disableLegacyContext && !disableLegacyContextForFunctionComponents) {
    const unmaskedContext = getUnmaskedContext(workInProgress, Component, true);
    context = getMaskedContext(workInProgress, unmaskedContext);
  }

  let nextChildren;
  let hasId;
  prepareToReadContext(workInProgress, renderLanes);
  if (enableSchedulingProfiler) {
    markComponentRenderStarted(workInProgress);
  }
  if (__DEV__) {
    nextChildren = renderWithHooks(
      current,
      workInProgress,
      Component,
      nextProps,
      context,
      renderLanes,
    );
    hasId = checkDidRenderIdHook();
  } else {
    nextChildren = renderWithHooks(
      current,
      workInProgress,
      Component,
      nextProps,
      context,
      renderLanes,
    );
    hasId = checkDidRenderIdHook();
  }
  if (enableSchedulingProfiler) {
    markComponentRenderStopped();
  }

  if (current !== null && !didReceiveUpdate) {
    bailoutHooks(current, workInProgress, renderLanes);
    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
  }

  if (getIsHydrating() && hasId) {
    pushMaterializedTreeId(workInProgress);
  }

  // React DevTools 读取该标志判断组件是否实际执行过渲染。
  workInProgress.flags |= PerformedWork;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

/** Suspense/错误恢复时用 renderWithHooksAgain 重放函数组件，并重新协调 children。 */
export function replayFunctionComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  nextProps: any,
  Component: any,
  secondArg: any,
  renderLanes: Lanes,
): Fiber | null {
  // 数据解决后重放先前挂起的组件；这是简化版 updateFunctionComponent，
  // 会复用上次尝试留下的 Hooks。

  prepareToReadContext(workInProgress, renderLanes);
  if (enableSchedulingProfiler) {
    markComponentRenderStarted(workInProgress);
  }
  const nextChildren = replaySuspendedComponentWithHooks(
    current,
    workInProgress,
    Component,
    nextProps,
    secondArg,
  );
  const hasId = checkDidRenderIdHook();
  if (enableSchedulingProfiler) {
    markComponentRenderStopped();
  }

  if (current !== null && !didReceiveUpdate) {
    bailoutHooks(current, workInProgress, renderLanes);
    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
  }

  if (getIsHydrating() && hasId) {
    pushMaterializedTreeId(workInProgress);
  }

  // React DevTools 读取该标志判断组件是否实际执行过渲染。
  workInProgress.flags |= PerformedWork;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

/** 构造/恢复/更新 Class 实例与 update queue，随后进入 finishClassComponent。 */
function updateClassComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  nextProps: any,
  renderLanes: Lanes,
) {
  if (__DEV__) {
    // DevTools 用该钩子强制边界进入错误路径。
    switch (shouldError(workInProgress)) {
      case false: {
        // 该边界先前模拟过错误，因此实例必定已在之前的 commit 中构造。
        const instance = workInProgress.stateNode;
        const ctor = workInProgress.type;
        // TODO：通过临时实例重置错误边界状态只是权宜方案，需要更合适的机制。
        const tempInstance = new ctor(
          workInProgress.memoizedProps,
          instance.context,
        );
        const state = tempInstance.state;
        instance.updater.enqueueSetState(instance, state, null);
        break;
      }
      case true: {
        workInProgress.flags |= DidCapture;
        workInProgress.flags |= ShouldCapture;
        // eslint-disable-next-line react-internal/prod-error-codes
        const error = new Error('Simulated error coming from DevTools');
        const lane = pickArbitraryLane(renderLanes);
        workInProgress.lanes = mergeLanes(workInProgress.lanes, lane);
        // 以捕获错误后的新 state 调度边界重渲染。
        const root: FiberRoot | null = getWorkInProgressRoot();
        if (root === null) {
          throw new Error(
            'Expected a work-in-progress root. This is a bug in React. Please file an issue.',
          );
        }
        const update = createClassErrorUpdate(lane);
        initializeClassErrorUpdate(
          update,
          root,
          workInProgress,
          createCapturedValueAtFiber(error, workInProgress),
        );
        enqueueCapturedUpdate(workInProgress, update);
        break;
      }
    }
  }

  // 提前压入 context provider，避免 context 栈错位。挂载时实例尚不存在，无法知道 child context；
  // render 后由 finishClassComponent() 立即使其失效并重算。
  let hasContext;
  if (isLegacyContextProvider(Component)) {
    hasContext = true;
    pushLegacyContextProvider(workInProgress);
  } else {
    hasContext = false;
  }
  prepareToReadContext(workInProgress, renderLanes);

  const instance = workInProgress.stateNode;
  let shouldUpdate;
  if (instance === null) {
    resetSuspendedCurrentOnMountInLegacyMode(current, workInProgress);

    // 首轮可能需要构造实例。
    constructClassInstance(workInProgress, Component, nextProps);
    mountClassInstance(workInProgress, Component, nextProps, renderLanes);
    shouldUpdate = true;
  } else if (current === null) {
    // 恢复挂载时已有可复用实例。
    shouldUpdate = resumeMountClassInstance(
      workInProgress,
      Component,
      nextProps,
      renderLanes,
    );
  } else {
    shouldUpdate = updateClassInstance(
      current,
      workInProgress,
      Component,
      nextProps,
      renderLanes,
    );
  }
  const nextUnitOfWork = finishClassComponent(
    current,
    workInProgress,
    Component,
    shouldUpdate,
    hasContext,
    renderLanes,
  );
  if (__DEV__) {
    const inst = workInProgress.stateNode;
    if (shouldUpdate && inst.props !== nextProps) {
      if (!didWarnAboutReassigningProps) {
        console.error(
          'It looks like %s is reassigning its own `this.props` while rendering. ' +
            'This is not supported and can lead to confusing bugs.',
          getComponentNameFromFiber(workInProgress) || 'a component',
        );
      }
      didWarnAboutReassigningProps = true;
    }
  }
  return nextUnitOfWork;
}

/** 根据 shouldUpdate/捕获错误决定调用 render、强制卸载旧 child 或 bailout，并标记 ref。 */
function finishClassComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  shouldUpdate: boolean,
  hasContext: boolean,
  renderLanes: Lanes,
) {
  // 即使 shouldComponentUpdate 返回 false，ref 仍应更新。
  markRef(current, workInProgress);

  const didCaptureError = (workInProgress.flags & DidCapture) !== NoFlags;

  if (!shouldUpdate && !didCaptureError) {
    // context provider 是否渲染也应遵循 shouldComponentUpdate。
    if (hasContext) {
      invalidateContextProvider(workInProgress, Component, false);
    }

    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
  }

  const instance = workInProgress.stateNode;

  // 执行类组件重渲染。
  if (__DEV__) {
    setCurrentFiber(workInProgress);
  }
  let nextChildren;
  if (
    didCaptureError &&
    typeof Component.getDerivedStateFromError !== 'function'
  ) {
    // 捕获错误但未定义 getDerivedStateFromError 时先卸载全部 children；
    // componentDidCatch 会安排更新来渲染 fallback。这是迁移到新 API 前的临时兼容路径。
    // TODO：未来版本增加警告。
    nextChildren = null;

    if (enableProfilerTimer) {
      stopProfilerTimerIfRunning(workInProgress);
    }
  } else {
    if (enableSchedulingProfiler) {
      markComponentRenderStarted(workInProgress);
    }
    if (__DEV__) {
      nextChildren = callRenderInDEV(instance);
      if (workInProgress.mode & StrictLegacyMode) {
        setIsStrictModeForDevtools(true);
        try {
          callRenderInDEV(instance);
        } finally {
          setIsStrictModeForDevtools(false);
        }
      }
    } else {
      nextChildren = instance.render();
    }
    if (enableSchedulingProfiler) {
      markComponentRenderStopped();
    }
  }

  // React DevTools 读取该标志判断组件是否实际执行过渲染。
  workInProgress.flags |= PerformedWork;
  if (current !== null && didCaptureError) {
    // 错误恢复时不复用任何现有 children。正常内容与错误内容在概念上是两套子树，
    // 即使 identity 相同也应强制重挂载。
    forceUnmountCurrentAndReconcile(
      current,
      workInProgress,
      nextChildren,
      renderLanes,
    );
  } else {
    reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  }

  // 记忆本次 render 使用后的实例 state。
  // TODO：重构为永不从实例回读值。
  workInProgress.memoizedState = instance.state;

  // render 可能改变 child context，需要重新计算。
  if (hasContext) {
    invalidateContextProvider(workInProgress, Component, true);
  }

  return workInProgress.child;
}

/** 把 HostRoot 的顶层 context 与宿主 container 压栈，供后代读取。 */
function pushHostRootContext(workInProgress: Fiber) {
  const root = workInProgress.stateNode as FiberRoot;
  if (root.pendingContext) {
    pushTopLevelContextObject(
      workInProgress,
      root.pendingContext,
      root.pendingContext !== root.context,
    );
  } else if (root.context) {
    // 正常情况下始终存在。
    pushTopLevelContextObject(workInProgress, root.context, false);
  }
  pushHostContainer(workInProgress, root.containerInfo);
}

/** 处理 HostRoot update queue、缓存与 hydration，得到 element 后协调根 children。 */
function updateHostRoot(
  current: null | Fiber,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  pushHostRootContext(workInProgress);

  if (current === null) {
    throw new Error('Should have a current fiber. This is a bug in React.');
  }

  const nextProps = workInProgress.pendingProps;
  const prevState: RootState = workInProgress.memoizedState;
  const prevChildren = prevState.element;
  cloneUpdateQueue(current, workInProgress);
  processUpdateQueue(workInProgress, nextProps, null, renderLanes);

  const nextState: RootState = workInProgress.memoizedState;
  const root: FiberRoot = workInProgress.stateNode;
  pushRootTransition(workInProgress, root, renderLanes);

  if (enableTransitionTracing) {
    pushRootMarkerInstance(workInProgress);
  }

  const nextCache: Cache = nextState.cache;
  pushCacheProvider(workInProgress, nextCache);
  if (nextCache !== prevState.cache) {
    // 根 cache 已 refresh，传播 CacheContext 变化。
    propagateContextChange(workInProgress, CacheContext, renderLanes);
  }

  // 理想上应放进 processUpdateQueue，但该调用可能挂起；必须在 pushCacheProvider 后执行，
  // 才不会造成 context 栈错位。
  suspendIfUpdateReadFromEntangledAsyncAction();

  // 注意：React DevTools 当前依赖该属性名必须是 element。
  const nextChildren = nextState.element;
  // $FlowFixMe[constant-condition]
  if (supportsHydration && prevState.isDehydrated) {
    // 这是 shell 尚未 hydration 的 hydration root，应开始尝试。

    // 把 isDehydrated 设为 false，表示本轮完成后根将不再 dehydrated。
    const overrideState: RootState = {
      element: nextChildren,
      isDehydrated: false,
      cache: nextState.cache,
    };
    const updateQueue: UpdateQueue<RootState> =
      workInProgress.updateQueue as any;
    // 根没有 reducer，不需要 rebase；baseState 可直接设为最新状态。
    updateQueue.baseState = overrideState;
    workInProgress.memoizedState = overrideState;

    if (workInProgress.flags & ForceClientRender) {
      // 先前 shell hydration 发生错误，已强制客户端渲染；可恢复错误应已安排。
      return mountHostRootWithoutHydrating(
        current,
        workInProgress,
        nextChildren,
        renderLanes,
      );
    } else if (nextChildren !== prevChildren) {
      const recoverableError = createCapturedValueAtFiber<mixed>(
        new Error(
          'This root received an early update, before anything was able ' +
            'hydrate. Switched the entire root to client rendering.',
        ),
        workInProgress,
      );
      queueHydrationError(recoverableError);
      return mountHostRootWithoutHydrating(
        current,
        workInProgress,
        nextChildren,
        renderLanes,
      );
    } else {
      // 最外层 shell 尚未 hydration，现在开始。
      enterHydrationState(workInProgress);

      const child = mountChildFibers(
        workInProgress,
        null,
        nextChildren,
        renderLanes,
      );
      workInProgress.child = child;

      let node = child;
      while (node) {
        // 标记每个 child 正在 hydration，供快速判断节点是否完成挂载及安排事件重放。
        // 概念上类似 Placement：子树新插入 React 树，只因 DOM 已存在而无需宿主变更；
        // Fiber 仍视为新插入，以便 Strict Effects 双调用。
        node.flags = (node.flags & ~Placement) | Hydrating | PlacementDEV;
        node = node.sibling;
      }
    }
  } else {
    // 根并非 dehydrated：它要么是纯客户端根，要么已经 hydration 完成。
    resetHydrationState();
    if (nextChildren === prevChildren) {
      return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
    }
    reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  }
  return workInProgress.child;
}

/** 根 hydration 放弃后重置状态，强制客户端协调 element 并标记 Placement。 */
function mountHostRootWithoutHydrating(
  current: Fiber,
  workInProgress: Fiber,
  nextChildren: ReactNodeList,
  renderLanes: Lanes,
) {
  // 重置 hydration 状态并切回客户端渲染。
  resetHydrationState();

  workInProgress.flags |= ForceClientRender;

  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

/** 压入宿主 context，规范化纯文本 children、标记 ref，并协调 HostComponent 子树。 */
function updateHostComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  if (current === null) {
    tryToClaimNextHydratableInstance(workInProgress);
  }

  pushHostContext(workInProgress);

  const type = workInProgress.type;
  const nextProps = workInProgress.pendingProps;
  const prevProps = current !== null ? current.memoizedProps : null;

  let nextChildren = nextProps.children;
  const isDirectTextChild = shouldSetTextContent(type, nextProps);

  if (isDirectTextChild) {
    // 宿主节点直接文本 child 很常见，不将其实体化为 Fiber；交由可访问 props 的宿主环境处理，
    // 避免分配和遍历额外 HostText Fiber。
    nextChildren = null;
  } else if (prevProps !== null && shouldSetTextContent(type, prevProps)) {
    // 从直接文本切换到普通 child 或空内容时，需要安排重置文本内容。
    workInProgress.flags |= ContentReset;
  }

  const memoizedState = workInProgress.memoizedState;
  if (memoizedState !== null) {
    // 该 Fiber 已因 form action 升级为有状态宿主组件，以 Hooks 跟踪表单 pending/error。
    // 一旦升级，其整个生命周期都保持有状态。
    const newState = renderTransitionAwareHostComponentWithHooks(
      current,
      workInProgress,
      renderLanes,
    );

    // transition 状态变化时通过 Context 向全部后代传播。pushHostContext 在处理 state Hook 前调用，
    // 以避免挂起时状态错位，因此必须在此更新当前值。
    // 注意：这里假设 transition provider 不会嵌套；当前仅 React DOM 实现且 form 不能嵌套。
    // 若未来支持嵌套，即使宿主 Fiber 尚未升级也必须压入 context 值。
    // $FlowFixMe[constant-condition]
    if (isPrimaryRenderer) {
      HostTransitionContext._currentValue = newState;
    } else {
      HostTransitionContext._currentValue2 = newState;
    }
  }

  markRef(current, workInProgress);
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

/** 在支持资源提升的宿主中更新 Hoistable，设置 context/ref 后协调其 children。 */
function updateHostHoistable(
  current: null | Fiber,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  markRef(current, workInProgress);

  if (current === null) {
    const resource = getResource(
      workInProgress.type,
      null,
      workInProgress.pendingProps,
      null,
    );
    if (resource) {
      workInProgress.memoizedState = resource;
    } else {
      if (!getIsHydrating()) {
        // 该 Hoistable 不是 Resource，且当前不在 hydration，直接构造宿主实例。
        workInProgress.stateNode = createHoistableInstance(
          workInProgress.type,
          workInProgress.pendingProps,
          getRootHostContainer(),
          workInProgress,
        );
      }
    }
  } else {
    // getResource 可能返回资源或 null；无论结果为何都写入 memoizedState。
    workInProgress.memoizedState = getResource(
      workInProgress.type,
      current.memoizedProps,
      workInProgress.pendingProps,
      current.memoizedState,
    );
  }

  // Resource 永不拥有由 reconciler 管理的 children。宿主 getResource 可在构造时参考 children，
  // 否则它们会被丢弃；实际上只允许最简单内容，宿主应对意外 children 给出专用警告。
  return null;
}

/** 在支持 singleton 的宿主中占用唯一实例、设置 context/ref 并协调 children。 */
function updateHostSingleton(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  pushHostContext(workInProgress);

  if (current === null) {
    claimHydratableSingleton(workInProgress);
  }

  const nextChildren = workInProgress.pendingProps.children;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  markRef(current, workInProgress);
  if (current === null) {
    // 用静态标志标记 Singleton，以便在含 Suspense 的 Offscreen 树中高效管理宿主单例所有权。
    workInProgress.flags |= LayoutStatic;
  }
  return workInProgress.child;
}

/** HostText 在 begin 阶段无 child 工作；hydration mount 时仅确保宿主 context 就绪。 */
function updateHostText(current: null | Fiber, workInProgress: Fiber) {
  if (current === null) {
    tryToClaimNextHydratableTextInstance(workInProgress);
  }
  // HostText 没有 child，是终止节点；随后立即进入 complete 阶段。
  return null;
}

/** 解析 Lazy payload，将 Fiber tag/type 改为真实组件类型并转派对应 begin 更新器。 */
function mountLazyComponent(
  _current: null | Fiber,
  workInProgress: Fiber,
  elementType: any,
  renderLanes: Lanes,
) {
  resetSuspendedCurrentOnMountInLegacyMode(_current, workInProgress);

  const props = workInProgress.pendingProps;
  const lazyComponent: LazyComponentType<any, any> = elementType;
  let Component = resolveLazy(lazyComponent);
  if (__DEV__) {
    Component = resolveTypeForHotReloading(Component);
  }
  // 在 type 中保存解包后的真实组件。
  workInProgress.type = Component;

  if (typeof Component === 'function') {
    if (isFunctionClassComponent(Component)) {
      const resolvedProps = resolveClassComponentProps(Component, props);
      workInProgress.tag = ClassComponent;
      return updateClassComponent(
        null,
        workInProgress,
        Component,
        resolvedProps,
        renderLanes,
      );
    } else {
      workInProgress.tag = FunctionComponent;
      if (__DEV__) {
        validateFunctionComponentInDev(workInProgress, Component);
      }
      return updateFunctionComponent(
        null,
        workInProgress,
        Component,
        props,
        renderLanes,
      );
    }
    // $FlowFixMe[invalid-compare]
  } else if (Component !== undefined && Component !== null) {
    const $$typeof = Component.$$typeof;
    // $FlowFixMe[invalid-compare]
    if ($$typeof === REACT_FORWARD_REF_TYPE) {
      workInProgress.tag = ForwardRef;
      return updateForwardRef(
        null,
        workInProgress,
        Component,
        props,
        renderLanes,
      );
      // $FlowFixMe[invalid-compare]
    } else if ($$typeof === REACT_MEMO_TYPE) {
      workInProgress.tag = MemoComponent;
      return updateMemoComponent(
        null,
        workInProgress,
        Component,
        props,
        renderLanes,
      );
      // $FlowFixMe[invalid-compare]
    } else if ($$typeof === REACT_CONTEXT_TYPE) {
      workInProgress.tag = ContextProvider;
      workInProgress.type = Component;
      return updateContextProvider(null, workInProgress, renderLanes);
    }
  }

  let hint = '';
  if (__DEV__) {
    if (
      // $FlowFixMe[invalid-compare]
      Component !== null &&
      typeof Component === 'object' &&
      // $FlowFixMe[invalid-compare]
      Component.$$typeof === REACT_LAZY_TYPE
    ) {
      hint = ' Did you wrap a component in React.lazy() more than once?';
    }
  }

  const loggedComponent = getComponentNameFromType(Component) || Component;

  // 错误消息有意不提 ForwardRef/MemoComponent；它们作为独立 work 类型只是实现细节。
  throw new Error(
    `Element type is invalid. Received a promise that resolves to: ${loggedComponent}. ` +
      `Lazy element type must resolve to a class or function.${hint}`,
  );
}

/** Legacy 挂起产生的不完整 Class Fiber 断开 alternate，以全新实例重新 mount。 */
function mountIncompleteClassComponent(
  _current: null | Fiber,
  workInProgress: Fiber,
  Component: any,
  nextProps: any,
  renderLanes: Lanes,
) {
  resetSuspendedCurrentOnMountInLegacyMode(_current, workInProgress);

  // 把 Fiber 提升为 ClassComponent 并重新尝试渲染。
  workInProgress.tag = ClassComponent;

  // 余下流程与 updateClassComponent 同源。

  // 提前压入 context provider，避免栈错位。挂载时实例尚不存在，无法知道 child context；
  // render 后由 finishClassComponent() 立即使其失效并重算。
  let hasContext;
  if (isLegacyContextProvider(Component)) {
    hasContext = true;
    pushLegacyContextProvider(workInProgress);
  } else {
    hasContext = false;
  }
  prepareToReadContext(workInProgress, renderLanes);

  constructClassInstance(workInProgress, Component, nextProps);
  mountClassInstance(workInProgress, Component, nextProps, renderLanes);

  return finishClassComponent(
    null,
    workInProgress,
    Component,
    true,
    hasContext,
    renderLanes,
  );
}

/** 开发期检查函数组件误用 class 专属 API、contextTypes 或返回 class 实例。 */
function validateFunctionComponentInDev(workInProgress: Fiber, Component: any) {
  if (__DEV__) {
    if (Component && Component.childContextTypes) {
      console.error(
        'childContextTypes cannot be defined on a function component.\n' +
          '  %s.childContextTypes = ...',
        Component.displayName || Component.name || 'Component',
      );
    }

    if (typeof Component.getDerivedStateFromProps === 'function') {
      const componentName = getComponentNameFromType(Component) || 'Unknown';

      if (!didWarnAboutGetDerivedStateOnFunctionComponent[componentName]) {
        console.error(
          '%s: Function components do not support getDerivedStateFromProps.',
          componentName,
        );
        didWarnAboutGetDerivedStateOnFunctionComponent[componentName] = true;
      }
    }

    if (
      typeof Component.contextType === 'object' &&
      Component.contextType !== null
    ) {
      const componentName = getComponentNameFromType(Component) || 'Unknown';

      if (!didWarnAboutContextTypeOnFunctionComponent[componentName]) {
        console.error(
          '%s: Function components do not support contextType.',
          componentName,
        );
        didWarnAboutContextTypeOnFunctionComponent[componentName] = true;
      }
    }
  }
}

/** 客户端 Suspense 已显示 fallback 时写入 memoizedState 的非 dehydrated 标记。 */
const SUSPENDED_MARKER: SuspenseState = {
  dehydrated: null,
  treeContext: null,
  retryLane: NoLane,
  hydrationErrors: null,
};

/** 创建首次隐藏 primary Offscreen 的 baseLanes/cachePool 状态。 */
function mountSuspenseOffscreenState(renderLanes: Lanes): OffscreenState {
  return {
    baseLanes: renderLanes,
    cachePool: getSuspendedCache(),
  };
}

/** 合并既有 baseLanes 与本轮 lanes，并继承或捕获 Suspense primary 的 cachePool。 */
function updateSuspenseOffscreenState(
  prevOffscreenState: OffscreenState,
  renderLanes: Lanes,
): OffscreenState {
  let cachePool: SpawnedCachePool | null = null;
  const prevCachePool: SpawnedCachePool | null = prevOffscreenState.cachePool;
  if (prevCachePool !== null) {
    // $FlowFixMe[constant-condition]
    const parentCache = isPrimaryRenderer
      ? CacheContext._currentValue
      : CacheContext._currentValue2;
    if (prevCachePool.parent !== parentCache) {
      // 检测到父级 refresh，覆盖先前挂起时保存的 cache。
      cachePool = {
        parent: parentCache,
        pool: parentCache,
      };
    } else {
      // 父级未 refresh，可复用上次 cache；唯一会使其失效的条件已在上方检查。
      cachePool = prevCachePool;
    }
  } else {
    // 没有旧 cache pool 时捕获当前挂起缓存。
    cachePool = getSuspendedCache();
  }
  return {
    baseLanes: mergeLanes(prevOffscreenState.baseLanes, renderLanes),
    cachePool,
  };
}

// TODO：可能应重新内联该辅助函数。
/** 根据 SuspenseContext/当前状态判断即使本轮未挂起也应继续显示 fallback。 */
function shouldRemainOnFallback(
  current: null | Fiber,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  // 已显示 fallback 时，即使内容解决也可能必须保持，例如 SuspenseList 需协调嵌套内容出现顺序。
  // TODO：为兼容 Offscreen 预渲染，还应检查 current Fiber 在上一棵树中是否可见。
  if (current !== null) {
    const suspenseState: SuspenseState = current.memoizedState;
    // $FlowFixMe[invalid-compare]
    if (suspenseState === null) {
      // 当前正显示 content，即使 ForceSuspenseFallback 为 true 也不要隐藏。
      // 更准确的名称可能是 ForceRemainSuspenseFallback；没有既有 fallback 时无从“保持”，
      // 说明这里的职责拆分并不理想。
      return false;
    }
  }

  // 当前未显示 content，查询 Suspense context 是否要求保持 fallback。
  const suspenseContext: SuspenseContext = suspenseStackCursor.current;
  return hasSuspenseListContext(
    suspenseContext,
    ForceSuspenseFallback as SuspenseContext,
  );
}

/** 计算 primary Offscreen 除本轮 renderLanes 外仍待处理的 base/child lanes。 */
function getRemainingWorkInPrimaryTree(
  current: Fiber | null,
  primaryTreeDidDefer: boolean,
  renderLanes: Lanes,
) {
  let remainingLanes =
    current !== null ? removeLanes(current.childLanes, renderLanes) : NoLanes;
  if (primaryTreeDidDefer) {
    // primary 树中的 useDeferredValue 产生了延后任务，必须在对应优先级重试本组件。
    // TODO：可改为每子树值而非全局值，但需像可恢复 context 一样在 context 栈跟踪。
    remainingLanes = mergeLanes(remainingLanes, peekDeferredLane());
  }
  return remainingLanes;
}

/**
 * Suspense begin 主状态机：选择 primary/fallback，处理首次/更新/二次 pass 与 dehydrated
 * hydration，并维护 suspense handler、Offscreen 状态和捕获标志。
 */
function updateSuspenseComponent(
  current: null | Fiber,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  const nextProps: SuspenseProps = workInProgress.pendingProps;

  // DevTools 用该钩子强制边界挂起。
  if (__DEV__) {
    if (shouldSuspend(workInProgress)) {
      workInProgress.flags |= DidCapture;
    }
  }

  let showFallback = false;
  const didSuspend = (workInProgress.flags & DidCapture) !== NoFlags;
  if (
    didSuspend ||
    shouldRemainOnFallback(current, workInProgress, renderLanes)
  ) {
    // 边界子树已有内容挂起，切换为渲染 fallback children。
    showFallback = true;
    workInProgress.flags &= ~DidCapture;
  }

  // 检查 primary children 首轮是否由 useDeferredValue 产生延后任务。
  const didPrimaryChildrenDefer = (workInProgress.flags & DidDefer) !== NoFlags;
  workInProgress.flags &= ~DidDefer;

  // 以下 Suspense child 协调较复杂，原因有三：
  // 1. Legacy Mode 为兼容会提交不一致的 primary 树，第二轮 fallback 需转移隐藏树的 effects/deletions；
  //    Concurrent Mode 可直接 bailout primary 并保留旧状态，类似 Offscreen（但后者无首轮尝试）。
  // 2. hydration 时 Fiber 布局不同，child 指向包含服务端 DOM 的 dehydrated fragment。
  // 3. Suspense 像错误边界：先尝试一棵树，失败后再渲染另一棵，必须跟踪当前分支；理想上应以栈建模。
  if (current === null) {
    // 首次挂载。

    // hydration 特殊路径：若当前正在 hydration，则尝试认领该边界。
    if (getIsHydrating()) {
      // 尝试 hydration 前必须先压入 suspense handler，避免错误路径造成栈不匹配。
      if (showFallback) {
        pushPrimaryTreeSuspenseHandler(workInProgress);
      } else {
        pushFallbackTreeSuspenseHandler(workInProgress);
      }
      // 认领失败会直接抛出 hydration mismatch。
      const dehydrated: SuspenseInstance =
        claimNextHydratableSuspenseInstance(workInProgress);
      return mountDehydratedSuspenseComponent(
        workInProgress,
        dehydrated,
        renderLanes,
      );
    }

    const nextPrimaryChildren = nextProps.children;
    const nextFallbackChildren = nextProps.fallback;

    if (showFallback) {
      pushFallbackTreeSuspenseHandler(workInProgress);

      mountSuspenseFallbackChildren(
        workInProgress,
        nextPrimaryChildren,
        nextFallbackChildren,
        renderLanes,
      );
      const primaryChildFragment: Fiber = workInProgress.child as any;
      primaryChildFragment.memoizedState =
        mountSuspenseOffscreenState(renderLanes);
      primaryChildFragment.childLanes = getRemainingWorkInPrimaryTree(
        current,
        didPrimaryChildrenDefer,
        renderLanes,
      );
      workInProgress.memoizedState = SUSPENDED_MARKER;
      if (enableTransitionTracing) {
        const currentTransitions = getPendingTransitions();
        if (currentTransitions !== null) {
          const parentMarkerInstances = getMarkerInstances();
          const offscreenQueue: OffscreenQueue | null =
            primaryChildFragment.updateQueue as any;
          if (offscreenQueue === null) {
            const newOffscreenQueue: OffscreenQueue = {
              transitions: currentTransitions,
              markerInstances: parentMarkerInstances,
              retryQueue: null,
            };
            primaryChildFragment.updateQueue = newOffscreenQueue;
          } else {
            offscreenQueue.transitions = currentTransitions;
            offscreenQueue.markerInstances = parentMarkerInstances;
          }
        }
      }

      return bailoutOffscreenComponent(null, primaryChildFragment);
    } else if (enableCPUSuspense && nextProps.defer === true) {
      // CPU 密集树先跳过并显示占位，使周围内容解除阻塞；首次 commit 后立即重试。
      pushFallbackTreeSuspenseHandler(workInProgress);
      mountSuspenseFallbackChildren(
        workInProgress,
        nextPrimaryChildren,
        nextFallbackChildren,
        renderLanes,
      );
      const primaryChildFragment: Fiber = workInProgress.child as any;
      primaryChildFragment.memoizedState =
        mountSuspenseOffscreenState(renderLanes);
      primaryChildFragment.childLanes = getRemainingWorkInPrimaryTree(
        current,
        didPrimaryChildrenDefer,
        renderLanes,
      );
      workInProgress.memoizedState = SUSPENDED_MARKER;

      // TODO：CPU Suspense 尚未实现 Transition Tracing。

      // 实际没有挂起，因此不会有 ping 来启动下一次尝试。优先级虽与本轮相同，
      // transition 提交后它已不属于同一 transition；同步路径也应先 yield 让占位绘制。
      // 概念上等同 ping，可使用任意 RetryLane，包括当前 lane，因为工作会留在本节点。
      workInProgress.lanes = SomeRetryLane;
      return bailoutOffscreenComponent(null, primaryChildFragment);
    } else {
      pushPrimaryTreeSuspenseHandler(workInProgress);
      return mountSuspensePrimaryChildren(
        workInProgress,
        nextPrimaryChildren,
        renderLanes,
      );
    }
  } else {
    // 更新路径。

    // dehydrated Suspense 的 hydration 特殊路径。
    const prevState: null | SuspenseState = current.memoizedState;
    if (prevState !== null) {
      const dehydrated = prevState.dehydrated;
      if (dehydrated !== null) {
        return updateDehydratedSuspenseComponent(
          current,
          workInProgress,
          didSuspend,
          didPrimaryChildrenDefer,
          nextProps,
          dehydrated,
          prevState,
          renderLanes,
        );
      }
    }

    if (showFallback) {
      pushFallbackTreeSuspenseHandler(workInProgress);

      const nextFallbackChildren = nextProps.fallback;
      const nextPrimaryChildren = nextProps.children;
      updateSuspenseFallbackChildren(
        current,
        workInProgress,
        nextPrimaryChildren,
        nextFallbackChildren,
        renderLanes,
      );
      const primaryChildFragment: Fiber = workInProgress.child as any;
      const prevOffscreenState: OffscreenState | null = (current.child as any)
        .memoizedState;
      primaryChildFragment.memoizedState =
        prevOffscreenState === null
          ? mountSuspenseOffscreenState(renderLanes)
          : updateSuspenseOffscreenState(prevOffscreenState, renderLanes);
      if (enableTransitionTracing) {
        const currentTransitions = getPendingTransitions();
        if (currentTransitions !== null) {
          const parentMarkerInstances = getMarkerInstances();
          const offscreenQueue: OffscreenQueue | null =
            primaryChildFragment.updateQueue as any;
          const currentOffscreenQueue: OffscreenQueue | null =
            current.updateQueue as any;
          if (offscreenQueue === null) {
            const newOffscreenQueue: OffscreenQueue = {
              transitions: currentTransitions,
              markerInstances: parentMarkerInstances,
              retryQueue: null,
            };
            primaryChildFragment.updateQueue = newOffscreenQueue;
          } else if (offscreenQueue === currentOffscreenQueue) {
            // work-in-progress queue 与 current 共用对象时，修改前必须先克隆。
            const newOffscreenQueue: OffscreenQueue = {
              transitions: currentTransitions,
              markerInstances: parentMarkerInstances,
              retryQueue:
                currentOffscreenQueue !== null
                  ? currentOffscreenQueue.retryQueue
                  : null,
            };
            primaryChildFragment.updateQueue = newOffscreenQueue;
          } else {
            offscreenQueue.transitions = currentTransitions;
            offscreenQueue.markerInstances = parentMarkerInstances;
          }
        }
      }
      primaryChildFragment.childLanes = getRemainingWorkInPrimaryTree(
        current,
        didPrimaryChildrenDefer,
        renderLanes,
      );
      workInProgress.memoizedState = SUSPENDED_MARKER;
      return bailoutOffscreenComponent(current.child, primaryChildFragment);
    } else {
      if (
        prevState !== null &&
        includesOnlyRetries(renderLanes) &&
        includesSomeLane(renderLanes, current.lanes)
      ) {
        // 在 Retry lanes 进入 primary content 时，可能只是此前留下该边界做预热，
        // 且没有其他更新；若如此，把它记录为本轮渲染原因。
        markRenderDerivedCause(workInProgress);
      }

      pushPrimaryTreeSuspenseHandler(workInProgress);

      const nextPrimaryChildren = nextProps.children;
      const primaryChildFragment = updateSuspensePrimaryChildren(
        current,
        workInProgress,
        nextPrimaryChildren,
        renderLanes,
      );
      workInProgress.memoizedState = null;
      return primaryChildFragment;
    }
  }
}

/** 首次未挂起时创建可见 primary Offscreen child。 */
function mountSuspensePrimaryChildren(
  workInProgress: Fiber,
  primaryChildren: $FlowFixMe,
  renderLanes: Lanes,
) {
  const mode = workInProgress.mode;
  const primaryChildProps: OffscreenProps = {
    mode: 'visible',
    children: primaryChildren,
  };
  const primaryChildFragment = mountWorkInProgressOffscreenFiber(
    primaryChildProps,
    mode,
    renderLanes,
  );
  primaryChildFragment.return = workInProgress;
  workInProgress.child = primaryChildFragment;
  return primaryChildFragment;
}

/** 首次挂起时创建隐藏 primary Offscreen 与可见 fallback Fragment sibling。 */
function mountSuspenseFallbackChildren(
  workInProgress: Fiber,
  primaryChildren: $FlowFixMe,
  fallbackChildren: $FlowFixMe,
  renderLanes: Lanes,
) {
  const mode = workInProgress.mode;
  const progressedPrimaryFragment: Fiber | null = workInProgress.child;

  const primaryChildProps: OffscreenProps = {
    mode: 'hidden',
    children: primaryChildren,
  };

  let primaryChildFragment;
  let fallbackChildFragment;
  if (
    !disableLegacyMode &&
    (mode & ConcurrentMode) === NoMode &&
    progressedPrimaryFragment !== null
  ) {
    // legacy mode 即使 primary 树状态不一致，也按成功完成来提交。
    primaryChildFragment = progressedPrimaryFragment;
    primaryChildFragment.childLanes = NoLanes;
    primaryChildFragment.pendingProps = primaryChildProps;

    if (enableProfilerTimer && workInProgress.mode & ProfileMode) {
      // 重置首轮耗时，避免计入最终结果。虽然有意漏算部分 render 看似反直觉，
      // 但这样才能与 Concurrent Mode 的计量一致。
      primaryChildFragment.actualDuration = -0;
      primaryChildFragment.actualStartTime = -1.1;
      primaryChildFragment.selfBaseDuration = -0;
      primaryChildFragment.treeBaseDuration = -0;
    }

    fallbackChildFragment = createFiberFromFragment(
      fallbackChildren,
      mode,
      renderLanes,
      null,
    );
  } else {
    primaryChildFragment = mountWorkInProgressOffscreenFiber(
      primaryChildProps,
      mode,
      NoLanes,
    );
    fallbackChildFragment = createFiberFromFragment(
      fallbackChildren,
      mode,
      renderLanes,
      null,
    );
  }

  primaryChildFragment.return = workInProgress;
  fallbackChildFragment.return = workInProgress;
  primaryChildFragment.sibling = fallbackChildFragment;
  workInProgress.child = primaryChildFragment;
  return fallbackChildFragment;
}

/** 按给定 props/state/lanes 创建并挂接新的 Offscreen Fiber。 */
function mountWorkInProgressOffscreenFiber(
  offscreenProps: OffscreenProps,
  mode: TypeOfMode,
  renderLanes: Lanes,
) {
  // createFiberFromOffscreen 的 props 类型是 any；用包装函数收窄为 OffscreenProps。
  return createFiberFromOffscreen(offscreenProps, mode, NoLanes, null);
}

/** 从 current Offscreen 创建 work-in-progress，并覆盖 pendingProps/state。 */
function updateWorkInProgressOffscreenFiber(
  current: Fiber,
  offscreenProps: OffscreenProps,
) {
  // createWorkInProgress 的 props 类型是 any；用包装函数收窄为 OffscreenProps。
  return createWorkInProgress(current, offscreenProps);
}

/** 从 fallback/primary 更新为显示 primary，复用 Offscreen 并删除旧 fallback。 */
function updateSuspensePrimaryChildren(
  current: Fiber,
  workInProgress: Fiber,
  primaryChildren: $FlowFixMe,
  renderLanes: Lanes,
) {
  const currentPrimaryChildFragment: Fiber = current.child as any;
  const currentFallbackChildFragment: Fiber | null =
    currentPrimaryChildFragment.sibling;

  const primaryChildFragment = updateWorkInProgressOffscreenFiber(
    currentPrimaryChildFragment,
    {
      mode: 'visible',
      children: primaryChildren,
    },
  );
  if (!disableLegacyMode && (workInProgress.mode & ConcurrentMode) === NoMode) {
    primaryChildFragment.lanes = renderLanes;
  }
  primaryChildFragment.return = workInProgress;
  primaryChildFragment.sibling = null;
  if (currentFallbackChildFragment !== null) {
    // 删除旧 fallback child fragment。
    const deletions = workInProgress.deletions;
    if (deletions === null) {
      workInProgress.deletions = [currentFallbackChildFragment];
      workInProgress.flags |= ChildDeletion;
    } else {
      deletions.push(currentFallbackChildFragment);
    }
  }

  workInProgress.child = primaryChildFragment;
  return primaryChildFragment;
}

/** 更新为继续显示 fallback，复用 primary Offscreen 与 fallback sibling，维护 baseLanes。 */
function updateSuspenseFallbackChildren(
  current: Fiber,
  workInProgress: Fiber,
  primaryChildren: $FlowFixMe,
  fallbackChildren: $FlowFixMe,
  renderLanes: Lanes,
) {
  const mode = workInProgress.mode;
  const currentPrimaryChildFragment: Fiber = current.child as any;
  const currentFallbackChildFragment: Fiber | null =
    currentPrimaryChildFragment.sibling;

  const primaryChildProps: OffscreenProps = {
    mode: 'hidden',
    children: primaryChildren,
  };

  let primaryChildFragment;
  if (
    // legacy mode 即使 primary 树状态不一致，也按成功完成来提交。
    !disableLegacyMode &&
    (mode & ConcurrentMode) === NoMode &&
    // 确认处于第二轮，即 primary fragment 已克隆。legacy mode 唯一例外是 DevTools
    // 强制 fallback：会跳过首轮直接渲染 fallback。Concurrent Mode 的 SuspenseList
    // 也可能触发相似场景，但本分支仅服务 legacy。
    workInProgress.child !== currentPrimaryChildFragment
  ) {
    const progressedPrimaryFragment: Fiber = workInProgress.child as any;
    primaryChildFragment = progressedPrimaryFragment;
    primaryChildFragment.childLanes = NoLanes;
    primaryChildFragment.pendingProps = primaryChildProps;

    if (enableProfilerTimer && workInProgress.mode & ProfileMode) {
      // 重置首轮耗时，避免计入最终结果；这与 Concurrent Mode 的计量保持一致。
      primaryChildFragment.actualDuration = -0;
      primaryChildFragment.actualStartTime = -1.1;
      primaryChildFragment.selfBaseDuration =
        currentPrimaryChildFragment.selfBaseDuration;
      primaryChildFragment.treeBaseDuration =
        currentPrimaryChildFragment.treeBaseDuration;
    }

    // 首轮曾把 fallback Fiber 加入删除；现在决定继续显示 fallback，因此取消删除。
    workInProgress.deletions = null;
  } else {
    primaryChildFragment = updateWorkInProgressOffscreenFiber(
      currentPrimaryChildFragment,
      primaryChildProps,
    );
    // 复用 current 树时也要复用静态 flags。legacy mode 不复用 current，故不走此逻辑。
    primaryChildFragment.subtreeFlags =
      currentPrimaryChildFragment.subtreeFlags & StaticMask;
  }
  let fallbackChildFragment;
  if (currentFallbackChildFragment !== null) {
    fallbackChildFragment = createWorkInProgress(
      currentFallbackChildFragment,
      fallbackChildren,
    );
  } else {
    fallbackChildFragment = createFiberFromFragment(
      fallbackChildren,
      mode,
      renderLanes,
      null,
    );
    // 父 Suspense 边界已挂载，而这是新 Fiber，因此需要 Placement 副作用。
    fallbackChildFragment.flags |= Placement;
  }

  fallbackChildFragment.return = workInProgress;
  primaryChildFragment.return = workInProgress;
  primaryChildFragment.sibling = fallbackChildFragment;
  workInProgress.child = primaryChildFragment;

  return bailoutOffscreenComponent(null, primaryChildFragment);
}

/** Suspense hydration 失败后删除 dehydrated child，并按当前输入改走客户端 primary render。 */
function retrySuspenseComponentWithoutHydrating(
  current: Fiber,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  // 降级为客户端渲染会带来性能代价，因此即使用户通常看不出 UI 异常，也记为可恢复错误。

  // 把旧 Fiber 加入删除列表。
  reconcileChildFibers(workInProgress, current.child, null, renderLanes);

  // 此后边界既不挂起，也不再 dehydrated。
  const nextProps = workInProgress.pendingProps;
  const primaryChildren = nextProps.children;
  const primaryChildFragment = mountSuspensePrimaryChildren(
    workInProgress,
    primaryChildren,
    renderLanes,
  );
  // 父 Suspense 边界已挂载，而这是新 Fiber，因此需要 Placement 副作用。
  primaryChildFragment.flags |= Placement;
  workInProgress.memoizedState = null;

  return primaryChildFragment;
}

/** 客户端 hydration 重试再次挂起时，在已建 primary 后追加 fallback sibling。 */
function mountSuspenseFallbackAfterRetryWithoutHydrating(
  current: Fiber,
  workInProgress: Fiber,
  primaryChildren: $FlowFixMe,
  fallbackChildren: $FlowFixMe,
  renderLanes: Lanes,
) {
  const fiberMode = workInProgress.mode;
  const primaryChildProps: OffscreenProps = {
    mode: 'visible',
    children: primaryChildren,
  };
  const primaryChildFragment = mountWorkInProgressOffscreenFiber(
    primaryChildProps,
    fiberMode,
    NoLanes,
  );
  const fallbackChildFragment = createFiberFromFragment(
    fallbackChildren,
    fiberMode,
    renderLanes,
    null,
  );
  // 父 Suspense 边界已挂载，而这是新 Fiber，因此需要 Placement 副作用。
  fallbackChildFragment.flags |= Placement;

  primaryChildFragment.return = workInProgress;
  fallbackChildFragment.return = workInProgress;
  primaryChildFragment.sibling = fallbackChildFragment;
  workInProgress.child = primaryChildFragment;

  if (disableLegacyMode || (workInProgress.mode & ConcurrentMode) !== NoMode) {
    // 原 effect 列表及其中删除项已丢失，需要再次协调来删除 current child。
    reconcileChildFibers(workInProgress, current.child, null, renderLanes);
  }

  return fallbackChildFragment;
}

/** 首次发现服务端 Suspense 实例时保留 DOM、不下钻，并按实例状态安排 hydration lane。 */
function mountDehydratedSuspenseComponent(
  workInProgress: Fiber,
  suspenseInstance: SuspenseInstance,
  renderLanes: Lanes,
): null | Fiber {
  // 首轮不下钻 children，保留现有服务端内容并稍后 hydration。
  if (isSuspenseInstanceFallback(suspenseInstance)) {
    // 这是纯客户端边界，服务端不会再提供内容；按其超时时机以更高优先级调度。
    // 本轮直接渲染会绑定错误优先级并阻碍父路径 hydration，因此留到独立 commit，
    // 用普通优先级更新渲染内容。
    workInProgress.lanes = laneToLanes(DefaultLane);
  } else {
    // 页面已显示正确服务端内容，其余 hydration 可在 Offscreen 优先级继续，无需抢占。
    workInProgress.lanes = laneToLanes(OffscreenLane);
  }
  return null;
}

/**
 * 更新 dehydrated Suspense：按服务端 pending/fallback、输入变化和捕获结果决定选择性 hydration、
 * 保留实例、提高优先级或切换客户端 primary/fallback。
 */
function updateDehydratedSuspenseComponent(
  current: Fiber,
  workInProgress: Fiber,
  didSuspend: boolean,
  didPrimaryChildrenDefer: boolean,
  nextProps: SuspenseProps,
  suspenseInstance: SuspenseInstance,
  suspenseState: SuspenseState,
  renderLanes: Lanes,
): null | Fiber {
  if (!didSuspend) {
    // 首轮渲染，尝试 hydration。
    pushPrimaryTreeSuspenseHandler(workInProgress);

    // 这是首次尝试但树已提交过一次，此时不应仍处于全局 hydration 状态。
    warnIfHydrating();

    if (includesSomeLane(renderLanes, OffscreenLane as Lane)) {
      // 在 OffscreenLane 进入边界时，本边界遗留工作可能是唯一渲染原因；若尚无 cause 则记录。
      markRenderDerivedCause(workInProgress);
    }

    if (isSuspenseInstanceFallback(suspenseInstance)) {
      // 边界处于永久 fallback，不会再收到服务端更新，也无法 hydration 最终内容；改试客户端渲染。
      let digest: ?string;
      let message;
      let stack = null;
      let componentStack = null;
      if (__DEV__) {
        ({digest, message, stack, componentStack} =
          getSuspenseInstanceFallbackErrorDetails(suspenseInstance));
      } else {
        ({digest} = getSuspenseInstanceFallbackErrorDetails(suspenseInstance));
      }

      // 不支持 hydration 的 renderer 无法到达此分支。
      // $FlowFixMe[invalid-compare]
      if (digest !== REACT_RECOVERABLE_DIGEST) {
        let error: Error;
        if (__DEV__ && message) {
          // eslint-disable-next-line react-internal/prod-error-codes
          error = new Error(message);
        } else {
          error = new Error(
            'The server could not finish this Suspense boundary, likely ' +
              'due to an error during server rendering. ' +
              'Switched to client rendering.',
          );
        }
        // 用服务端 stack 替换本地 stack，保留原始失败位置。
        error.stack = (__DEV__ && stack) || '';
        (error as any).digest = digest;
        const capturedValue = createCapturedValueFromError(
          error,
          componentStack === undefined ? null : componentStack,
        );
        queueHydrationError(capturedValue);
      }
      return retrySuspenseComponentWithoutHydrating(
        current,
        workInProgress,
        renderLanes,
      );
    }

    if (
      // TODO：此处拆分略显重复，下一段还会检查同一条件。
      !didReceiveUpdate
    ) {
      // bailout 前必须知道 child 是否依赖 context，因此现在传播父级变更。
      lazilyPropagateParentContextChanges(current, workInProgress, renderLanes);
    }

    // lanes 表示 child 可能依赖 context；任一 context 变化都按输入可能变化处理。
    const hasContextChanged = includesSomeLane(renderLanes, current.childLanes);
    if (didReceiveUpdate || hasContextChanged) {
      // 边界自首轮后已变化，当前 lane 无法 hydration；更高优先级 lane 仍可能成功。
      if (isCurrentTreeHidden()) {
        // 隐藏子树的工作会延后到揭示。选择性 hydration 依赖在更新生效前以更高优先级渲染，
        // 在此无法推进；等待会导致提交死锁。替换隐藏内容不可见，因此放弃并客户端渲染。
        return retrySuspenseComponentWithoutHydrating(
          current,
          workInProgress,
          renderLanes,
        );
      }
      const root = getWorkInProgressRoot();
      if (root !== null) {
        const attemptHydrationAtLane = getBumpedLaneForHydration(
          root,
          renderLanes,
        );
        if (
          attemptHydrationAtLane !== NoLane &&
          attemptHydrationAtLane !== suspenseState.retryLane
        ) {
          // 本轮马上会被中断，因此有意在 render 阶段修改 current 树；这是极少数例外。
          suspenseState.retryLane = attemptHydrationAtLane;
          enqueueConcurrentRenderForLane(current, attemptHydrationAtLane);
          scheduleUpdateOnFiber(root, current, attemptHydrationAtLane);

          // 抛出特殊对象通知 work loop 中断本轮。也可改写内部状态实现，但异常能避免循环每步检查，
          // 把该判断移出快速路径。
          throw SelectiveHydrationException;
        } else {
          // 更高优先级 ping 已尝试仍失败，只能删除整棵子树并注入真实 Suspense 边界，
          // 由其渲染 content/fallback。新边界可能继续挂起，本轮提交前仍可能再获 hydration 机会。
        }
      }

      // 未能选择性 hydration 时继续客户端渲染，并把树标为挂起，防止在 transition 外提交。
      // 仅 hydration lane 已经挂起时应进入该路径。
      if (isSuspenseInstancePending(suspenseInstance)) {
        // 这是 dehydrated Suspense 实例，已显示 fallback，无需再次挂起。
        // TODO：Fizz runtime 仍可能带外流入完整 HTML；客户端渲染也有同类问题，需进一步评估。
      } else {
        renderDidSuspendDelayIfPossible();
      }
      return retrySuspenseComponentWithoutHydrating(
        current,
        workInProgress,
        renderLanes,
      );
    } else if (isSuspenseInstancePending(suspenseInstance)) {
      // 组件仍等待服务端数据，无法 hydration。按自身挂起处理；立即客户端渲染会做大量无效工作，
      // 且往往仍因缺数据挂起。服务端还可能比客户端先渲染更多内容，贸然接管会制造更多 fallback。
      // 服务端超时或报错会把边界更新为永久 fallback。这里同时标记已捕获与需要重试。
      workInProgress.flags |= DidCapture | Callback;
      // 保留现有 dehydrated fragment child。
      workInProgress.child = current.child;
      return null;
    } else {
      // 这是首次 hydration 尝试。
      reenterHydrationStateFromDehydratedSuspenseInstance(
        workInProgress,
        suspenseInstance,
        suspenseState.treeContext,
      );
      const primaryChildren = nextProps.children;
      const primaryChildFragment = mountSuspensePrimaryChildren(
        workInProgress,
        primaryChildren,
        renderLanes,
      );
      // 标记 children 正在 hydration，供快速判断节点是否完成挂载及安排事件重放。
      // 概念上类似 Placement：子树新插入 React 树，只因 DOM 已存在而无需宿主变更；
      // Fiber 仍视为新插入，以便 Strict Effects 双调用。
      primaryChildFragment.flags |= Hydrating | PlacementDEV;
      return primaryChildFragment;
    }
  } else {
    // 第二轮渲染：先前 hydration 尝试发生了挂起或错误。

    if (workInProgress.flags & ForceClientRender) {
      // hydration 发生错误；清除标志并以客户端渲染重试。错误已由 throwException 记录。
      pushPrimaryTreeSuspenseHandler(workInProgress);
      workInProgress.flags &= ~ForceClientRender;
      return retrySuspenseComponentWithoutHydrating(
        current,
        workInProgress,
        renderLanes,
      );
    } else if (
      (workInProgress.memoizedState as null | SuspenseState) !== null
    ) {
      // 发生挂起且仍处于 dehydrated 模式，保留现有 child。

      // 压入 fallback handler 以保持栈对称。
      pushFallbackTreeSuspenseHandler(workInProgress);

      workInProgress.child = current.child;
      // dehydrated 完成阶段要求 DidCapture；普通 Suspense 路径不需要。
      workInProgress.flags |= DidCapture;
      return null;
    } else {
      // 已挂起但不应再处于 dehydrated 模式，因此现在渲染 fallback。
      pushFallbackTreeSuspenseHandler(workInProgress);

      const nextPrimaryChildren = nextProps.children;
      const nextFallbackChildren = nextProps.fallback;
      mountSuspenseFallbackAfterRetryWithoutHydrating(
        current,
        workInProgress,
        nextPrimaryChildren,
        nextFallbackChildren,
        renderLanes,
      );
      const primaryChildFragment: Fiber = workInProgress.child as any;
      primaryChildFragment.memoizedState =
        mountSuspenseOffscreenState(renderLanes);
      primaryChildFragment.childLanes = getRemainingWorkInPrimaryTree(
        current,
        didPrimaryChildrenDefer,
        renderLanes,
      );
      workInProgress.memoizedState = SUSPENDED_MARKER;
      return bailoutOffscreenComponent(null, primaryChildFragment);
    }
  }
}

/** 给 Suspense Fiber/alternate 合并指定 lanes，并把 child work 冒泡到根。 */
function scheduleSuspenseWorkOnFiber(
  fiber: Fiber,
  renderLanes: Lanes,
  propagationRoot: Fiber,
) {
  fiber.lanes = mergeLanes(fiber.lanes, renderLanes);
  const alternate = fiber.alternate;
  if (alternate !== null) {
    alternate.lanes = mergeLanes(alternate.lanes, renderLanes);
  }
  scheduleContextWorkOnParentPath(fiber.return, renderLanes, propagationRoot);
}

/** 向 SuspenseList 子树中当前显示 fallback 的边界传播重试 lanes。 */
function propagateSuspenseContextChange(
  workInProgress: Fiber,
  firstChild: null | Fiber,
  renderLanes: Lanes,
): void {
  // 给正在显示 fallback 的 Suspense 边界标记工作；先前被强制 fallback 的边界现在可能解除阻塞。
  let node = firstChild;
  while (node !== null) {
    if (node.tag === SuspenseComponent) {
      const state: SuspenseState | null = node.memoizedState;
      if (state !== null) {
        scheduleSuspenseWorkOnFiber(node, renderLanes, workInProgress);
      }
    } else if (node.tag === SuspenseListComponent) {
      // tail 隐藏时可能找不到可调度的 Suspense 边界，需调度列表自身；
      // 列表重渲染会传播变化，无需继续遍历其 children。
      scheduleSuspenseWorkOnFiber(node, renderLanes, workInProgress);
    } else if (node.child !== null) {
      node.child.return = node;
      node = node.child;
      continue;
    }
    if (node === workInProgress) {
      return;
    }
    // $FlowFixMe[incompatible-use]：升级 Flow 时发现。
    while (node.sibling === null) {
      // $FlowFixMe[incompatible-use]：升级 Flow 时发现。
      if (node.return === null || node.return === workInProgress) {
        return;
      }
      node = node.return;
    }
    // $FlowFixMe[incompatible-use]：升级 Flow 时发现。
    node.sibling.return = node.return;
    node = node.sibling;
  }
}

/** 按新 sibling 顺序寻找最后一个已显示真实内容、未处于 fallback 的 SuspenseList row。 */
function findLastContentRow(firstChild: null | Fiber): null | Fiber {
  // 找出 children 中最后一个已在屏幕显示 content、既非 fallback 也非新建的 row。
  // 一行含多个 Suspense 时，任一处于 fallback 即视为整行 fallback。
  // row 本身是 work-in-progress，但未渲染的嵌套 children 仍是 current；挂载顺序可能不同，
  // 这里以新 sibling 顺序为准。
  let row = firstChild;
  let lastContentRow: null | Fiber = null;
  while (row !== null) {
    const currentRow = row.alternate;
    // 新 row 不可能已是 content row。
    if (currentRow !== null && findFirstSuspended(currentRow) === null) {
      lastContentRow = row;
    }
    row = row.sibling;
  }
  return lastContentRow;
}

/** 开发期校验 SuspenseList revealOrder，并为大小写/拼写错误给出定向提示。 */
function validateRevealOrder(revealOrder: SuspenseListRevealOrder) {
  if (__DEV__) {
    const cacheKey = revealOrder == null ? 'null' : revealOrder;
    if (
      revealOrder != null &&
      revealOrder !== 'forwards' &&
      revealOrder !== 'backwards' &&
      revealOrder !== 'unstable_legacy-backwards' &&
      revealOrder !== 'together' &&
      revealOrder !== 'independent' &&
      !didWarnAboutRevealOrder[cacheKey]
    ) {
      didWarnAboutRevealOrder[cacheKey] = true;
      if (typeof revealOrder === 'string') {
        switch (revealOrder.toLowerCase()) {
          // $FlowFixMe[invalid-compare]
          case 'together':
          // $FlowFixMe[invalid-compare]：有意 fallthrough。
          case 'forwards':
          // $FlowFixMe[invalid-compare]：有意 fallthrough。
          case 'backwards':
          // $FlowFixMe[invalid-compare]：有意 fallthrough。
          case 'independent': {
            console.error(
              '"%s" is not a valid value for revealOrder on <SuspenseList />. ' +
                'Use lowercase "%s" instead.',
              revealOrder,
              revealOrder.toLowerCase(),
            );
            break;
          }
          // $FlowFixMe[invalid-compare]
          case 'forward':
          // $FlowFixMe[invalid-compare]：有意 fallthrough。
          case 'backward': {
            console.error(
              '"%s" is not a valid value for revealOrder on <SuspenseList />. ' +
                'React uses the -s suffix in the spelling. Use "%ss" instead.',
              revealOrder,
              revealOrder.toLowerCase(),
            );
            break;
          }
          default:
            console.error(
              '"%s" is not a supported revealOrder on <SuspenseList />. ' +
                'Did you mean "independent", "together", "forwards" or "backwards"?',
              revealOrder,
            );
            break;
        }
      } else {
        console.error(
          '%s is not a supported value for revealOrder on <SuspenseList />. ' +
            'Did you mean "independent", "together", "forwards" or "backwards"?',
          revealOrder,
        );
      }
    }
  }
}

/** 开发期校验 SuspenseList tail 只与 forwards/backwards 配合且值为 collapsed/hidden。 */
function validateTailOptions(
  tailMode: SuspenseListTailMode,
  revealOrder: SuspenseListRevealOrder,
) {
  if (__DEV__) {
    const cacheKey = tailMode == null ? 'null' : tailMode;
    if (!didWarnAboutTailOptions[cacheKey]) {
      if (tailMode == null) {
        // 默认 tail 现在是 hidden。
      } else if (
        tailMode !== 'visible' &&
        tailMode !== 'collapsed' &&
        tailMode !== 'hidden'
      ) {
        didWarnAboutTailOptions[cacheKey] = true;
        console.error(
          '"%s" is not a supported value for tail on <SuspenseList />. ' +
            'Did you mean "visible", "collapsed" or "hidden"?',
          tailMode,
        );
      } else if (
        revealOrder != null &&
        revealOrder !== 'forwards' &&
        revealOrder !== 'backwards' &&
        revealOrder !== 'unstable_legacy-backwards'
      ) {
        didWarnAboutTailOptions[cacheKey] = true;
        console.error(
          '<SuspenseList tail="%s" /> is only valid if revealOrder is ' +
            '"forwards" (default) or "backwards". ' +
            'Did you mean to specify revealOrder="forwards"?',
          tailMode,
        );
      }
    }
  }
}

/** 初始化或复用 SuspenseListRenderState，记录方向、tail、上次内容 row 与渲染时间。 */
function initSuspenseListRenderState(
  workInProgress: Fiber,
  isBackwards: boolean,
  tail: null | Fiber,
  lastContentRow: null | Fiber,
  tailMode: SuspenseListTailMode,
  treeForkCount: number,
): void {
  const renderState: null | SuspenseListRenderState =
    workInProgress.memoizedState;
  if (renderState === null) {
    workInProgress.memoizedState = {
      isBackwards: isBackwards,
      rendering: null,
      renderingStartTime: 0,
      last: lastContentRow,
      tail: tail,
      tailMode: tailMode,
      treeForkCount: treeForkCount,
    } as SuspenseListRenderState;
  } else {
    // 可复用前次渲染的状态对象，避免分配。
    renderState.isBackwards = isBackwards;
    renderState.rendering = null;
    renderState.renderingStartTime = 0;
    renderState.last = lastContentRow;
    renderState.tail = tail;
    renderState.tailMode = tailMode;
    renderState.treeForkCount = treeForkCount;
  }
}

/** 原地反转 Fiber.child sibling 链，并修正每个 child.return。 */
function reverseChildren(fiber: Fiber): void {
  let row = fiber.child;
  fiber.child = null;
  while (row !== null) {
    const nextRow = row.sibling;
    row.sibling = fiber.child;
    fiber.child = row;
    row = nextRow;
  }
}

/**
 * 更新 SuspenseList 多 pass 渐进展示：先拆 head/tail 并渲染 head；若发现 fallback，再以
 * force-suspend context 重跑全部 children；否则由 completeWork 逐 row 完成 tail。
 */
function updateSuspenseListComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  const nextProps: SuspenseListProps = workInProgress.pendingProps;
  const revealOrder: SuspenseListRevealOrder = nextProps.revealOrder;
  const tailMode: SuspenseListTailMode = nextProps.tail;
  const newChildren = nextProps.children;

  let suspenseContext: SuspenseContext = suspenseStackCursor.current;

  if (workInProgress.flags & DidCapture) {
    // 某 row 挂起后的第二轮，直接进入 complete 阶段。
    pushSuspenseListContext(workInProgress, suspenseContext);
    return null;
  }

  const shouldForceFallback = hasSuspenseListContext(
    suspenseContext,
    ForceSuspenseFallback as SuspenseContext,
  );
  if (shouldForceFallback) {
    suspenseContext = setShallowSuspenseListContext(
      suspenseContext,
      ForceSuspenseFallback,
    );
    workInProgress.flags |= DidCapture;
  } else {
    suspenseContext = setDefaultShallowSuspenseListContext(suspenseContext);
  }
  pushSuspenseListContext(workInProgress, suspenseContext);

  validateRevealOrder(revealOrder);
  validateTailOptions(tailMode, revealOrder);
  validateSuspenseListChildren(newChildren, revealOrder);

  if (revealOrder === 'backwards' && current !== null) {
    // backwards 模式下 current 挂载集合顺序也是反的，直接协调会错配并重排；
    // 先反转原集合，协调后再恢复。
    reverseChildren(current);
    reconcileChildren(current, workInProgress, newChildren, renderLanes);
    reverseChildren(current);
  } else {
    reconcileChildren(current, workInProgress, newChildren, renderLanes);
  }
  // 记录该集合压入的 child fork 数，使每次重试都能重建相同 tree context。
  const treeForkCount = getIsHydrating() ? getForksAtLevel(workInProgress) : 0;

  if (!shouldForceFallback) {
    const didSuspendBefore =
      current !== null && (current.flags & DidCapture) !== NoFlags;
    if (didSuspendBefore) {
      // 若先前强制 fallback，需要像 context 更新一样调度嵌套边界，让它们再次尝试渲染。
      propagateSuspenseContextChange(
        workInProgress,
        workInProgress.child,
        renderLanes,
      );
    }
  }

  if (!disableLegacyMode && (workInProgress.mode & ConcurrentMode) === NoMode) {
    // legacy mode 不支持 SuspenseList，将其按默认 revealOrder 当作空操作。
    workInProgress.memoizedState = null;
  } else {
    switch (revealOrder) {
      case 'backwards': {
        // 找到已有 content 的首行，并反转主内容以按协调后集合的逆序渲染。
        // tail 保持原序，因为每项完成时会插到前面。
        const lastContentRow = findLastContentRow(workInProgress.child);
        let tail;
        if (lastContentRow === null) {
          // 整个列表都属于 tail。
          tail = workInProgress.child;
          workInProgress.child = null;
        } else {
          // 断开 content row 后的 tail rows，稍后单独按逆序渲染。
          tail = lastContentRow.sibling;
          lastContentRow.sibling = null;
          // 同时反转主内容，使其也按 backwards 顺序渲染。
          reverseChildren(workInProgress);
        }
        // TODO：若 workInProgress.child 为 null，可立即继续处理 tail。
        initSuspenseListRenderState(
          workInProgress,
          true, // isBackwards
          tail,
          null, // last
          tailMode,
          treeForkCount,
        );
        break;
      }
      case 'unstable_legacy-backwards': {
        // 寻找首个已有 content 的 row，同时反转此前经过的列表，形成逆序 tail。
        let tail = null;
        let row = workInProgress.child;
        workInProgress.child = null;
        while (row !== null) {
          const currentRow = row.alternate;
          // 新 row 不可能已是 content row。
          if (currentRow !== null && findFirstSuspended(currentRow) === null) {
            // 这里是主内容起点。
            workInProgress.child = row;
            break;
          }
          const nextRow = row.sibling;
          row.sibling = tail;
          tail = row;
          row = nextRow;
        }
        // TODO：若 workInProgress.child 为 null，可立即继续处理 tail。
        initSuspenseListRenderState(
          workInProgress,
          true, // isBackwards
          tail,
          null, // last
          tailMode,
          treeForkCount,
        );
        break;
      }
      case 'together': {
        initSuspenseListRenderState(
          workInProgress,
          false, // isBackwards
          null, // tail
          null, // last
          undefined,
          treeForkCount,
        );
        break;
      }
      case 'independent': {
        // independent revealOrder 等同没有列表边界。
        workInProgress.memoizedState = null;
        break;
      }
      // 默认 revealOrder 现在是 forwards。
      case 'forwards':
      default: {
        const lastContentRow = findLastContentRow(workInProgress.child);
        let tail;
        if (lastContentRow === null) {
          // 整个列表都属于 tail。
          // TODO：可增加快速路径，立即渲染 tail。
          tail = workInProgress.child;
          workInProgress.child = null;
        } else {
          // 断开 content row 后的 tail rows，稍后单独渲染。
          tail = lastContentRow.sibling;
          lastContentRow.sibling = null;
        }
        initSuspenseListRenderState(
          workInProgress,
          false, // isBackwards
          tail,
          lastContentRow,
          tailMode,
          treeForkCount,
        );
        break;
      }
    }
  }
  return workInProgress.child;
}

/** 创建/复用 ViewTransitionState，登记显式名称/自动 ID、标记 ref，并协调边界 children。 */
function updateViewTransition(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  if (workInProgress.stateNode === null) {
    // work-in-progress 先前被重置，需要新建 ViewTransitionState 实例。
    const instance: ViewTransitionState = {
      autoName: null,
      paired: null,
      clones: null,
      ref: null,
    };
    workInProgress.stateNode = instance;
  }

  const pendingProps: ViewTransitionProps = workInProgress.pendingProps;
  if (pendingProps.name != null && pendingProps.name !== 'auto') {
    // 显式命名边界需要被跟踪；删除时可与另一显式边界配对。
    workInProgress.flags |=
      current === null
        ? ViewTransitionNamedMount | ViewTransitionNamedStatic
        : ViewTransitionNamedStatic;
  } else {
    // 服务端可能用 useId 为边界自动生成名称；压入 materialization，确保 child ID 与服务端对齐。
    if (getIsHydrating()) {
      pushMaterializedTreeId(workInProgress);
    }
  }
  if (__DEV__) {
    // $FlowFixMe[prop-missing]
    if (pendingProps.className !== undefined) {
      const example =
        typeof pendingProps.className === 'string'
          ? JSON.stringify(pendingProps.className)
          : '{...}';
      if (!didWarnAboutClassNameOnViewTransition[example]) {
        didWarnAboutClassNameOnViewTransition[example] = true;
        console.error(
          '<ViewTransition> doesn\'t accept a "className" prop. It has been renamed to "default".\n' +
            '-   <ViewTransition className=%s>\n' +
            '+   <ViewTransition default=%s>',
          example,
          example,
        );
      }
    }
  }
  if (current !== null && current.memoizedProps.name !== pendingProps.name) {
    // 名称变化时安排 ref 副作用，以创建新的 ref 实例。
    workInProgress.flags |= Ref | RefStatic;
  } else {
    markRef(current, workInProgress);
  }
  const nextChildren = pendingProps.children;
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

/** 压入 Portal 宿主容器，并在首次 mount 时用带副作用 reconciler 跟踪提交期插入。 */
function updatePortalComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  pushHostContainer(workInProgress, workInProgress.stateNode.containerInfo);
  const nextChildren = workInProgress.pendingProps;
  if (current === null) {
    // Portal 在 commit 而非 mount 时追加 children，因此需跟踪普通 mount 流程不记录的插入。
    // 根不会遇到此问题，因为始终从 child 为 null 的 current 开始。
    // TODO：考虑与根的实现统一。
    workInProgress.child = reconcileChildFibers(
      workInProgress,
      null,
      nextChildren,
      renderLanes,
    );
  } else {
    reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  }
  return workInProgress.child;
}

let hasWarnedAboutUsingNoValuePropOnContextProvider = false;

/** 将 Provider 新 value 压栈；值变化时传播 context，再协调 Provider children。 */
function updateContextProvider(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  const context: ReactContext<any> = workInProgress.type;
  const newProps = workInProgress.pendingProps;
  const newValue = newProps.value;

  if (__DEV__) {
    if (!('value' in newProps)) {
      if (!hasWarnedAboutUsingNoValuePropOnContextProvider) {
        hasWarnedAboutUsingNoValuePropOnContextProvider = true;
        console.error(
          'The `value` prop is required for the `<Context.Provider>`. Did you misspell it or forget to pass it?',
        );
      }
    }
  }

  pushProvider(workInProgress, context, newValue);

  const newChildren = newProps.children;
  reconcileChildren(current, workInProgress, newChildren, renderLanes);
  return workInProgress.child;
}

/** 准备并读取 Context 当前值，调用 render prop 得到 children 后继续协调。 */
function updateContextConsumer(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  const consumerType: ReactConsumerType<any> = workInProgress.type;
  const context: ReactContext<any> = consumerType._context;
  const newProps = workInProgress.pendingProps;
  const render = newProps.children;

  if (__DEV__) {
    if (typeof render !== 'function') {
      console.error(
        'A context consumer was rendered with multiple children, or a child ' +
          "that isn't a function. A context consumer expects a single child " +
          'that is a function. If you did pass a function, make sure there ' +
          'is no trailing or leading whitespace around it.',
      );
    }
  }

  prepareToReadContext(workInProgress, renderLanes);
  const newValue = readContext(context);
  if (enableSchedulingProfiler) {
    markComponentRenderStarted(workInProgress);
  }
  let newChildren;
  if (__DEV__) {
    newChildren = callComponentInDEV(render, newValue, undefined);
  } else {
    newChildren = render(newValue);
  }
  if (enableSchedulingProfiler) {
    markComponentRenderStopped();
  }

  // React DevTools 读取该标志判断 consumer 是否实际执行过渲染。
  workInProgress.flags |= PerformedWork;
  reconcileChildren(current, workInProgress, newChildren, renderLanes);
  return workInProgress.child;
}

/** Scope Fiber 仅标记 ref 并协调其 children，实例在提交阶段连接宿主树。 */
function updateScopeComponent(
  current: null | Fiber,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  const nextProps = workInProgress.pendingProps;
  const nextChildren = nextProps.children;
  markRef(current, workInProgress);
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);
  return workInProgress.child;
}

/** 由 hook/context 等路径声明当前 Fiber 在本轮确实收到更新，禁止 props bailout。 */
export function markWorkInProgressReceivedUpdate() {
  didReceiveUpdate = true;
}

/** 查询当前 beginWork 分支是否已观察到 hook/context/state 更新。 */
export function checkIfWorkInProgressReceivedUpdate(): boolean {
  return didReceiveUpdate;
}

/** Legacy 非并发 mount 挂起后断开不一致 alternate，把 work-in-progress 视为全新放置。 */
function resetSuspendedCurrentOnMountInLegacyMode(
  current: null | Fiber,
  workInProgress: Fiber,
) {
  if (!disableLegacyMode && (workInProgress.mode & ConcurrentMode) === NoMode) {
    if (current !== null) {
      // lazy 组件只有在非并发树中挂起并留下不一致状态时才会走此挂载路径。
      // 即使空版本已经提交，也按全新挂载处理，并断开 alternate 指针。
      current.alternate = null;
      workInProgress.alternate = null;
      // 概念上是新 Fiber，安排 Placement 副作用。
      workInProgress.flags |= Placement;
    }
  }
}

/**
 * 当前 Fiber 输入未变时复用 dependencies/Profiler 数据；子树也无 renderLanes 则完全退出，
 * 否则克隆 child 链继续处理其待办工作。
 */
function bailoutOnAlreadyFinishedWork(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
): Fiber | null {
  if (current !== null) {
    // 复用 current 的依赖集合。
    workInProgress.dependencies = current.dependencies;
  }

  if (enableProfilerTimer) {
    // bailout 不更新 base render 耗时。
    stopProfilerTimerIfRunning(workInProgress);
  }

  markSkippedUpdateLanes(workInProgress.lanes);

  // 检查 children 是否有 pending 工作。
  if (!includesSomeLane(renderLanes, workInProgress.childLanes)) {
    // children 也无工作，可跳过。
    // TODO：恢复 resume 能力后，应检查 children 是否为 work-in-progress 集合；若是需转移 effects。

    if (current !== null) {
      // bailout 前检查 children 是否受 context 变化影响。
      lazilyPropagateParentContextChanges(current, workInProgress, renderLanes);
      if (!includesSomeLane(renderLanes, workInProgress.childLanes)) {
        return null;
      }
    } else {
      return null;
    }
  }

  // 当前 Fiber 无工作但子树有；克隆 child Fibers 并继续。
  cloneChildFibers(current, workInProgress);
  return workInProgress.child;
}

/** 开发热更新时把旧 Fiber 从树断开，用新 Fiber 替换位置，并显式安排旧删除/新 Placement。 */
function remountFiber(
  current: Fiber,
  oldWorkInProgress: Fiber,
  newWorkInProgress: Fiber,
): Fiber | null {
  if (__DEV__) {
    const returnFiber = oldWorkInProgress.return;
    if (returnFiber === null) {
      // eslint-disable-next-line react-internal/prod-error-codes
      throw new Error('Cannot swap the root fiber.');
    }

    // 断开旧 current；它随后会被删除。
    current.alternate = null;
    oldWorkInProgress.alternate = null;

    // 把新 Fiber 接入树中，并继承位置、sibling、return 与 ref。
    newWorkInProgress.index = oldWorkInProgress.index;
    newWorkInProgress.sibling = oldWorkInProgress.sibling;
    newWorkInProgress.return = oldWorkInProgress.return;
    newWorkInProgress.ref = oldWorkInProgress.ref;

    // $FlowFixMe[constant-condition]
    if (__DEV__) {
      newWorkInProgress._debugInfo = oldWorkInProgress._debugInfo;
    }

    // 替换父级指向它的 child/sibling 指针。
    if (oldWorkInProgress === returnFiber.child) {
      returnFiber.child = newWorkInProgress;
    } else {
      let prevSibling = returnFiber.child;
      if (prevSibling === null) {
        // eslint-disable-next-line react-internal/prod-error-codes
        throw new Error('Expected parent to have a child.');
      }
      // $FlowFixMe[incompatible-use]：升级 Flow 时发现。
      while (prevSibling.sibling !== oldWorkInProgress) {
        // $FlowFixMe[incompatible-use]：升级 Flow 时发现。
        prevSibling = prevSibling.sibling;
        if (prevSibling === null) {
          // eslint-disable-next-line react-internal/prod-error-codes
          throw new Error('Expected to find the previous sibling.');
        }
      }
      // $FlowFixMe[incompatible-use]：升级 Flow 时发现。
      prevSibling.sibling = newWorkInProgress;
    }

    // 删除旧 Fiber 并放置新 Fiber。旧 Fiber 已断开，必须手工安排删除。
    const deletions = returnFiber.deletions;
    if (deletions === null) {
      returnFiber.deletions = [current];
      returnFiber.flags |= ChildDeletion;
    } else {
      deletions.push(current);
    }

    newWorkInProgress.flags |= Placement | PlacementDEV;

    // 从新 Fiber 重新开始 begin 工作。
    return newWorkInProgress;
  } else {
    throw new Error(
      'Did not expect this call in production. ' +
        'This is a bug in React. Please file an issue.',
    );
  }
}

/** 检查 current.lanes 或惰性传播的 Context 是否要求本轮进入 begin 阶段。 */
function checkScheduledUpdateOrContext(
  current: Fiber,
  renderLanes: Lanes,
): boolean {
  // 提前 bailout 前必须检查 pending 更新或 context 变化。
  const updateLanes = current.lanes;
  if (includesSomeLane(updateLanes, renderLanes)) {
    return true;
  }
  // 没有 pending 更新，但 context 惰性传播，bailout 前仍需检查依赖是否变化。
  const dependencies = current.dependencies;
  if (dependencies !== null && checkIfContextChanged(dependencies)) {
    return true;
  }
  return false;
}

/** 无 props/state/context 工作时按 tag 补齐必要 context 栈，再选择子树 bailout 路径。 */
function attemptEarlyBailoutIfNoScheduledUpdate(
  current: Fiber,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  // 该 Fiber 没有 pending 工作，不进入 begin 阶段直接 bailout；
  // 优化路径仍需完成必要记账，主要是把对应上下文压栈。
  switch (workInProgress.tag) {
    case HostRoot: {
      pushHostRootContext(workInProgress);
      const root: FiberRoot = workInProgress.stateNode;
      pushRootTransition(workInProgress, root, renderLanes);

      if (enableTransitionTracing) {
        pushRootMarkerInstance(workInProgress);
      }

      const cache: Cache = current.memoizedState.cache;
      pushCacheProvider(workInProgress, cache);
      resetHydrationState();
      break;
    }
    case HostSingleton:
    case HostComponent:
      pushHostContext(workInProgress);
      break;
    case ClassComponent: {
      const Component = workInProgress.type;
      if (isLegacyContextProvider(Component)) {
        pushLegacyContextProvider(workInProgress);
      }
      break;
    }
    case HostPortal:
      pushHostContainer(workInProgress, workInProgress.stateNode.containerInfo);
      break;
    case ContextProvider: {
      const newValue = workInProgress.memoizedProps.value;
      const context: ReactContext<any> = workInProgress.type;
      pushProvider(workInProgress, context, newValue);
      break;
    }
    case Profiler:
      if (enableProfilerTimer) {
        // 仅当至少一个后代实际渲染时，Profiler 才应调用 onRender。
        const hasChildWork = includesSomeLane(
          renderLanes,
          workInProgress.childLanes,
        );
        if (hasChildWork) {
          workInProgress.flags |= Update;
        }

        if (enableProfilerCommitHooks) {
          // 为 Profiler 安排 passive effect 来调用 onPostCommit；即使没有回调也要安排，
          // 因为耗时也在此阶段向父 Profiler 冒泡。
          workInProgress.flags |= Passive;
          // 为下一次 effect 阶段重置耗时；在 render 中重置可让 DevTools commit hook 先读取旧值。
          const stateNode = workInProgress.stateNode;
          stateNode.effectDuration = -0;
          stateNode.passiveEffectDuration = -0;
        }
      }
      break;
    case ActivityComponent: {
      const state: ActivityState | null = workInProgress.memoizedState;
      if (state !== null) {
        // 当前 dehydrated，不渲染 children；压栈仅为保持 push/pop 对称。
        // 若已解除挂起，它会作为 hydrated Activity 提交；若需重试，则本应已有调度。
        workInProgress.flags |= DidCapture;
        pushDehydratedActivitySuspenseHandler(workInProgress);
        return null;
      }
      break;
    }
    case SuspenseComponent: {
      const state: SuspenseState | null = workInProgress.memoizedState;
      if (state !== null) {
        if (state.dehydrated !== null) {
          // 不渲染 children，压入 handler 仅为保持 push/pop 对称。
          pushPrimaryTreeSuspenseHandler(workInProgress);
          // 它会再次挂起；若已解除挂起就会作为 resolved Suspense 提交，需重试时本应已有调度。
          workInProgress.flags |= DidCapture;
          // dehydrated 边界升级前绝不能渲染 children，因此返回 null 而非通用 bailout。
          return null;
        }

        // 边界已超时时，需按 primary fragment 优先级决定重试 primary 或直接进入 fallback。
        // 先传播 context：若首挂挂起时丢弃了 primary consumer Fiber，普通传播无法找到它们；
        // 此时保守重试边界，让重挂载 children 读取最新 context。
        const contextChanged = lazilyPropagateParentContextChanges(
          current,
          workInProgress,
          renderLanes,
        );
        const primaryChildFragment: Fiber = workInProgress.child as any;
        const primaryChildLanes = primaryChildFragment.childLanes;
        if (
          contextChanged ||
          includesSomeLane(renderLanes, primaryChildLanes)
        ) {
          // primary children 有 pending 工作，走常规路径重新尝试渲染。
          return updateSuspenseComponent(current, workInProgress, renderLanes);
        } else {
          // primary fragment 未标记 pending 工作。
          pushPrimaryTreeSuspenseHandler(workInProgress);
          // primary children 没有足够优先级的 pending 工作，执行 bailout。
          const child = bailoutOnAlreadyFinishedWork(
            current,
            workInProgress,
            renderLanes,
          );
          if (child !== null) {
            // fallback children 有 pending 工作，跳过 primary 并处理 fallback。
            return child.sibling;
          } else {
            // 可返回 null，因为上面的 bailoutOnAlreadyFinishedWork 已检查嵌套 context consumer。
            return null;
          }
        }
      } else {
        pushPrimaryTreeSuspenseHandler(workInProgress);
      }
      break;
    }
    case SuspenseListComponent: {
      if (workInProgress.flags & DidCapture) {
        // 已捕获第二轮，回到 SuspenseList 状态机处理。
        return updateSuspenseListComponent(
          current,
          workInProgress,
          renderLanes,
        );
      }
      const didSuspendBefore = (current.flags & DidCapture) !== NoFlags;

      let hasChildWork = includesSomeLane(
        renderLanes,
        workInProgress.childLanes,
      );

      if (!hasChildWork) {
        // context 变化可能尚未传播，决定 bailout 前现在执行。
        // TODO：多处以 childLanes 启发式判断剩余工作，包括 bailoutOnAlreadyFinishedWork
        // 与 updateDehydratedSuspenseComponent；应考虑提取专用函数。
        lazilyPropagateParentContextChanges(
          current,
          workInProgress,
          renderLanes,
        );
        hasChildWork = includesSomeLane(renderLanes, workInProgress.childLanes);
      }

      if (didSuspendBefore) {
        if (hasChildWork) {
          // 上次存在 fallback 且 children 未变，说明仍在渐进加载。
          // state 更新或重试可能解除某处阻塞并影响 tail，需走常规路径重新计算。
          return updateSuspenseListComponent(
            current,
            workInProgress,
            renderLanes,
          );
        }
        // children 均无工作表示没有重试，阻塞状态不变，可快速 bailout。
        workInProgress.flags |= DidCapture;
      }

      // 先前无挂起且 children 相同，则 tail 不重要；新挂起会按 together 模式处理，
      // 可沿用现有状态。
      const renderState = workInProgress.memoizedState;
      if (renderState !== null) {
        // 重置为 together，以清理先前开始但未完成的其他更新模式。
        renderState.rendering = null;
        renderState.tail = null;
        renderState.lastEffect = null;
      }
      pushSuspenseListContext(workInProgress, suspenseStackCursor.current);

      if (hasChildWork) {
        break;
      } else {
        // children 均无工作表示没有重试，阻塞状态不变，可快速 bailout。
        return null;
      }
    }
    case OffscreenComponent: {
      // 仍需检查树是否要延后；逻辑几乎等同常规更新，直接进入该路径。
      // 唯一区别是 child props 未变，会在下一层而非本层 bailout，语义可接受。
      // TODO：应重构 beginWork，拆分 bailout 与常规路径。
      workInProgress.lanes = NoLanes;
      return updateOffscreenComponent(
        current,
        workInProgress,
        renderLanes,
        workInProgress.pendingProps,
      );
    }
    case CacheComponent: {
      const cache: Cache = current.memoizedState.cache;
      pushCacheProvider(workInProgress, cache);
      break;
    }
    case TracingMarkerComponent: {
      if (enableTransitionTracing) {
        const instance: TracingMarkerInstance | null = workInProgress.stateNode;
        if (instance !== null) {
          pushMarkerInstance(workInProgress, instance);
        }
        break;
      }
      // 有意 fallthrough。
    }
    case LegacyHiddenComponent: {
      if (enableLegacyHidden) {
        workInProgress.lanes = NoLanes;
        return updateLegacyHiddenComponent(
          current,
          workInProgress,
          renderLanes,
        );
      }
      // 有意 fallthrough。
    }
  }
  return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
}

/**
 * Fiber render 阶段的总分派器：判定更新/bailout、处理 hydration/list fork，再按 WorkTag 调用
 * 对应 update/mount 函数并返回下一待处理 child。
 */
function beginWork(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
): Fiber | null {
  if (__DEV__) {
    if (workInProgress._debugNeedsRemount && current !== null) {
      // 以新 Fiber 重新启动 begin 阶段。
      const copiedFiber = createFiberFromTypeAndProps(
        // 从 Fiber 最外层 identity 重挂载；mount 会把内层类型解析为最新实现。
        resolveTypeForHotReloading(workInProgress.elementType),
        workInProgress.key,
        workInProgress.pendingProps,
        workInProgress._debugOwner || null,
        workInProgress.mode,
        workInProgress.lanes,
      );
      copiedFiber._debugStack = workInProgress._debugStack;
      copiedFiber._debugTask = workInProgress._debugTask;
      return remountFiber(current, workInProgress, copiedFiber);
    }
  }

  if (current !== null) {
    const oldProps = current.memoizedProps;
    const newProps = workInProgress.pendingProps;

    if (
      oldProps !== newProps ||
      hasLegacyContextChanged() ||
      // 热更新改变实现时强制重渲染。
      (__DEV__ ? workInProgress.type !== current.type : false)
    ) {
      // props 或 context 变化时先标记已执行工作；若 memo 后续判定 props 相等可再清除。
      didReceiveUpdate = true;
    } else {
      // props 与 legacy context 均未变，再检查 pending 更新或现代 context 变化。
      const hasScheduledUpdateOrContext = checkScheduledUpdateOrContext(
        current,
        renderLanes,
      );
      if (
        !hasScheduledUpdateOrContext &&
        // 错误/Suspense 边界第二轮可能未在 current 上调度工作，因此还需检查 DidCapture。
        (workInProgress.flags & DidCapture) === NoFlags
      ) {
        // 无 pending 更新或 context 变化，立即 bailout。
        didReceiveUpdate = false;
        return attemptEarlyBailoutIfNoScheduledUpdate(
          current,
          workInProgress,
          renderLanes,
        );
      }
      if ((current.flags & ForceUpdateForLegacySuspense) !== NoFlags) {
        // 仅 legacy mode 需要此特例，参见 https://github.com/facebook/react/pull/19216。
        didReceiveUpdate = true;
      } else {
        // Fiber 虽有调度，但 props/legacy context 未变，先设为 false。
        // 若更新队列或 context consumer 产生新值会再设为 true；否则假定 children 未变并 bailout。
        didReceiveUpdate = false;
      }
    }
  } else {
    didReceiveUpdate = false;

    if (getIsHydrating() && isForkedChild(workInProgress)) {
      // 检查 child 是否属于父级多 children 列表。真正多线程实现会在并行线程渲染 children，
      // 这里相当于为该子树开启新 render thread；当前仅用于 hydration ID 生成，故位于此特殊分支。
      const slotIndex = workInProgress.index;
      const numberOfForks = getForksAtLevel(workInProgress);
      pushTreeId(workInProgress, numberOfForks, slotIndex);
    }
  }

  // 进入 begin 阶段前清除 pending 更新优先级。
  // TODO：这假定马上会求值组件并处理更新队列，但 SimpleMemoComponent 有时稍后才 bailout；
  // 应把赋值从公共路径移到各分支。
  workInProgress.lanes = NoLanes;

  switch (workInProgress.tag) {
    case LazyComponent: {
      const elementType = workInProgress.elementType;
      return mountLazyComponent(
        current,
        workInProgress,
        elementType,
        renderLanes,
      );
    }
    case FunctionComponent: {
      const Component = workInProgress.type;
      return updateFunctionComponent(
        current,
        workInProgress,
        Component,
        workInProgress.pendingProps,
        renderLanes,
      );
    }
    case ClassComponent: {
      const Component = workInProgress.type;
      const unresolvedProps = workInProgress.pendingProps;
      const resolvedProps = resolveClassComponentProps(
        Component,
        unresolvedProps,
      );
      return updateClassComponent(
        current,
        workInProgress,
        Component,
        resolvedProps,
        renderLanes,
      );
    }
    case HostRoot:
      return updateHostRoot(current, workInProgress, renderLanes);
    case HostHoistable:
      // $FlowFixMe[constant-condition]
      if (supportsResources) {
        return updateHostHoistable(current, workInProgress, renderLanes);
      }
    // 有意 fallthrough。
    case HostSingleton:
      // $FlowFixMe[constant-condition]
      if (supportsSingletons) {
        return updateHostSingleton(current, workInProgress, renderLanes);
      }
    // 有意 fallthrough。
    case HostComponent:
      return updateHostComponent(current, workInProgress, renderLanes);
    case HostText:
      return updateHostText(current, workInProgress);
    case SuspenseComponent:
      return updateSuspenseComponent(current, workInProgress, renderLanes);
    case HostPortal:
      return updatePortalComponent(current, workInProgress, renderLanes);
    case ForwardRef: {
      return updateForwardRef(
        current,
        workInProgress,
        workInProgress.type,
        workInProgress.pendingProps,
        renderLanes,
      );
    }
    case Fragment:
      return updateFragment(current, workInProgress, renderLanes);
    case Mode:
      return updateMode(current, workInProgress, renderLanes);
    case Profiler:
      return updateProfiler(current, workInProgress, renderLanes);
    case ContextProvider:
      return updateContextProvider(current, workInProgress, renderLanes);
    case ContextConsumer:
      return updateContextConsumer(current, workInProgress, renderLanes);
    case MemoComponent: {
      return updateMemoComponent(
        current,
        workInProgress,
        workInProgress.type,
        workInProgress.pendingProps,
        renderLanes,
      );
    }
    case SimpleMemoComponent: {
      return updateSimpleMemoComponent(
        current,
        workInProgress,
        workInProgress.type,
        workInProgress.pendingProps,
        renderLanes,
      );
    }
    case IncompleteClassComponent: {
      if (disableLegacyMode) {
        break;
      }
      const Component = workInProgress.type;
      const unresolvedProps = workInProgress.pendingProps;
      const resolvedProps = resolveClassComponentProps(
        Component,
        unresolvedProps,
      );
      return mountIncompleteClassComponent(
        current,
        workInProgress,
        Component,
        resolvedProps,
        renderLanes,
      );
    }
    case IncompleteFunctionComponent: {
      if (disableLegacyMode) {
        break;
      }
      const Component = workInProgress.type;
      const unresolvedProps = workInProgress.pendingProps;
      const resolvedProps = resolveClassComponentProps(
        Component,
        unresolvedProps,
      );
      return mountIncompleteFunctionComponent(
        current,
        workInProgress,
        Component,
        resolvedProps,
        renderLanes,
      );
    }
    case SuspenseListComponent: {
      return updateSuspenseListComponent(current, workInProgress, renderLanes);
    }
    case ScopeComponent: {
      if (enableScopeAPI) {
        return updateScopeComponent(current, workInProgress, renderLanes);
      }
      break;
    }
    case ActivityComponent: {
      return updateActivityComponent(current, workInProgress, renderLanes);
    }
    case OffscreenComponent: {
      return updateOffscreenComponent(
        current,
        workInProgress,
        renderLanes,
        workInProgress.pendingProps,
      );
    }
    case LegacyHiddenComponent: {
      if (enableLegacyHidden) {
        return updateLegacyHiddenComponent(
          current,
          workInProgress,
          renderLanes,
        );
      }
      break;
    }
    case CacheComponent: {
      return updateCacheComponent(current, workInProgress, renderLanes);
    }
    case TracingMarkerComponent: {
      if (enableTransitionTracing) {
        return updateTracingMarkerComponent(
          current,
          workInProgress,
          renderLanes,
        );
      }
      break;
    }
    case ViewTransitionComponent: {
      if (enableViewTransition) {
        return updateViewTransition(current, workInProgress, renderLanes);
      }
      break;
    }
    case Throw: {
      // 表示组件在 reconciliation 阶段抛出；在此重新抛出，值可能是 Thenable。
      throw workInProgress.pendingProps;
    }
  }

  throw new Error(
    `Unknown unit of work tag (${workInProgress.tag}). This error is likely caused by a bug in ` +
      'React. Please file an issue.',
  );
}

export {beginWork};
