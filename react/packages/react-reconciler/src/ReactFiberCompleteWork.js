/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber, FiberRoot} from './ReactInternalTypes';
import type {RootState} from './ReactFiberRoot';
import type {Lanes, Lane} from './ReactFiberLane';
import type {ReactScopeInstance, ReactContext} from 'shared/ReactTypes';
import type {
  Instance,
  Type,
  Props,
  Container,
  ChildSet,
  Resource,
} from './ReactFiberConfig';
import type {ActivityState} from './ReactFiberActivityComponent';
import type {
  SuspenseState,
  SuspenseListRenderState,
  RetryQueue,
} from './ReactFiberSuspenseComponent';
import type {
  OffscreenState,
  OffscreenQueue,
} from './ReactFiberOffscreenComponent';
import type {TracingMarkerInstance} from './ReactFiberTracingMarkerComponent';
import type {Cache} from './ReactFiberCacheComponent';
import {
  enableLegacyHidden,
  enableSuspenseCallback,
  enableScopeAPI,
  enableProfilerTimer,
  enableTransitionTracing,
  passChildrenWhenCloningPersistedNodes,
  disableLegacyMode,
  enableViewTransition,
  enableViewTransitionParentEnterExit,
  enableSuspenseyImages,
} from 'shared/ReactFeatureFlags';

import {now} from './Scheduler';

import {
  FunctionComponent,
  ClassComponent,
  HostRoot,
  HostComponent,
  HostHoistable,
  HostSingleton,
  HostText,
  HostPortal,
  ContextProvider,
  ContextConsumer,
  ForwardRef,
  Fragment,
  Mode,
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
  NoMode,
  ConcurrentMode,
  ProfileMode,
  SuspenseyImagesMode,
} from './ReactTypeOfMode';
import {
  Placement,
  Update,
  Visibility,
  NoFlags,
  DidCapture,
  Snapshot,
  ChildDeletion,
  StaticMask,
  Passive,
  ForceClientRender,
  MaySuspendCommit,
  ScheduleRetry,
  ShouldSuspendCommit,
  Cloned,
  ViewTransitionStatic,
  ViewTransitionStaticParent,
  Hydrate,
  PortalStatic,
} from './ReactFiberFlags';

import {
  createInstance,
  createTextInstance,
  resolveSingletonInstance,
  appendInitialChild,
  finalizeInitialChildren,
  finalizeHydratedChildren,
  supportsMutation,
  supportsPersistence,
  supportsResources,
  supportsSingletons,
  cloneInstance,
  cloneHiddenInstance,
  cloneHiddenTextInstance,
  createContainerChildSet,
  appendChildToContainerChildSet,
  finalizeContainerChildren,
  preparePortalMount,
  prepareScopeUpdate,
  maySuspendCommit,
  maySuspendCommitOnUpdate,
  maySuspendCommitInSyncRender,
  mayResourceSuspendCommit,
  preloadInstance,
  preloadResource,
} from './ReactFiberConfig';
import {
  getRootHostContainer,
  popHostContext,
  getHostContext,
  popHostContainer,
} from './ReactFiberHostContext';
import {
  suspenseStackCursor,
  popSuspenseListContext,
  popSuspenseHandler,
  pushSuspenseListContext,
  pushSuspenseListCatch,
  setShallowSuspenseListContext,
  ForceSuspenseFallback,
  setDefaultShallowSuspenseListContext,
} from './ReactFiberSuspenseContext';
import {popHiddenContext} from './ReactFiberHiddenContext';
import {findFirstSuspended} from './ReactFiberSuspenseComponent';
import {
  isContextProvider as isLegacyContextProvider,
  popContext as popLegacyContext,
  popTopLevelContextObject as popTopLevelLegacyContextObject,
} from './ReactFiberLegacyContext';
import {popProvider} from './ReactFiberNewContext';
import {
  prepareToHydrateHostInstance,
  prepareToHydrateHostTextInstance,
  prepareToHydrateHostActivityInstance,
  prepareToHydrateHostSuspenseInstance,
  popHydrationState,
  resetHydrationState,
  getIsHydrating,
  upgradeHydrationErrorsToRecoverable,
  emitPendingHydrationWarnings,
} from './ReactFiberHydrationContext';
import {
  renderHasNotSuspendedYet,
  getRenderTargetTime,
  getWorkInProgressTransitions,
  shouldRemainOnPreviousScreen,
  markSpawnedRetryLane,
} from './ReactFiberWorkLoop';
import {
  OffscreenLane,
  SomeRetryLane,
  NoLanes,
  includesSomeLane,
  mergeLanes,
  claimNextRetryLane,
  includesOnlySuspenseyCommitEligibleLanes,
} from './ReactFiberLane';
import {resetChildFibers} from './ReactChildFiber';
import {createScopeInstance} from './ReactFiberScope';
import {transferActualDuration} from './ReactProfilerTimer';
import {popCacheProvider} from './ReactFiberCacheComponent';
import {popTreeContext, pushTreeFork} from './ReactFiberTreeContext';
import {popRootTransition, popTransition} from './ReactFiberTransition';
import {
  popMarkerInstance,
  popRootMarkerInstance,
} from './ReactFiberTracingMarkerComponent';
import {suspendCommit} from './ReactFiberThenable';
import type {Flags} from './ReactFiberFlags';

/** 给 Fiber 标记 Update effect；与 Placement 组合后表示放置完成还需宿主更新。 */
function markUpdate(workInProgress: Fiber) {
  workInProgress.flags |= Update;
}

/** 持久化模式下标记 Cloned，通知祖先本次更新需要克隆持久树。 */
function markCloned(workInProgress: Fiber) {
  // $FlowFixMe[constant-condition]
  if (supportsPersistence) {
    workInProgress.flags |= Cloned;
  }
}

/**
 * 判断持久化渲染器是否必须克隆该子树：bailout 可直接复用，删除、放置、可见性或下层
 * 已克隆等结构 effect 则要求祖先生成新持久节点。
 */
function doesRequireClone(current: null | Fiber, completedWork: Fiber) {
  const didBailout = current !== null && current.child === completedWork.child;
  if (didBailout) {
    return false;
  }

  if ((completedWork.flags & ChildDeletion) !== NoFlags) {
    return true;
  }

  // TODO：若把调用移到 bubbleProperties 之后，只需检查 completedWork.subtreeFlags。
  let child = completedWork.child;
  while (child !== null) {
    const checkedFlags = Cloned | Visibility | Placement | ChildDeletion;
    if (
      (child.flags & checkedFlags) !== NoFlags ||
      (child.subtreeFlags & checkedFlags) !== NoFlags
    ) {
      return true;
    }
    child = child.sibling;
  }
  return false;
}

/**
 * 深度优先收集 workInProgress 下的终端宿主节点并追加到新建宿主父实例。
 *
 * mutation 模式跳过 Portal/singleton 独立子树；persistence 模式按 Offscreen 隐藏状态克隆
 * 实例。迭代遍历临时修复 return 指针，避免递归栈并保持 sibling 回溯正确。
 */
function appendAllChildren(
  parent: Instance,
  workInProgress: Fiber,
  needsVisibilityToggle: boolean,
  isHidden: boolean,
) {
  // $FlowFixMe[constant-condition]
  if (supportsMutation) {
    // 当前只有顶层新建 Fiber，需要向下遍历找到全部终端宿主节点。
    let node = workInProgress.child;
    while (node !== null) {
      if (node.tag === HostComponent || node.tag === HostText) {
        appendInitialChild(parent, node.stateNode);
      } else if (
        node.tag === HostPortal ||
        // $FlowFixMe[constant-condition]
        (supportsSingletons ? node.tag === HostSingleton : false)
      ) {
        // Portal child 由其容器直接接收插入，不进入其子树；HostSingleton 也独立放置。
      } else if (node.child !== null) {
        node.child.return = node;
        node = node.child;
        continue;
      }
      if (node === workInProgress) {
        return;
      }
      // $FlowFixMe[incompatible-use] found when upgrading Flow
      while (node.sibling === null) {
        // $FlowFixMe[incompatible-use] found when upgrading Flow
        if (node.return === null || node.return === workInProgress) {
          return;
        }
        node = node.return;
      }
      // $FlowFixMe[incompatible-use] found when upgrading Flow
      node.sibling.return = node.return;
      node = node.sibling;
    }
    // $FlowFixMe[constant-condition]
  } else if (supportsPersistence) {
    // 当前只有顶层新建 Fiber，需要向下遍历找到全部终端宿主节点。
    let node = workInProgress.child;
    while (node !== null) {
      if (node.tag === HostComponent) {
        let instance = node.stateNode;
        if (needsVisibilityToggle && isHidden) {
          // 此 child 位于超时树内，克隆为隐藏实例。
          const props = node.memoizedProps;
          const type = node.type;
          instance = cloneHiddenInstance(instance, type, props);
        }
        appendInitialChild(parent, instance);
      } else if (node.tag === HostText) {
        let instance = node.stateNode;
        if (needsVisibilityToggle && isHidden) {
          // 此 child 位于超时树内，克隆为隐藏文本实例。
          const text = node.memoizedProps;
          instance = cloneHiddenTextInstance(instance, text);
        }
        appendInitialChild(parent, instance);
      } else if (node.tag === HostPortal) {
        // Portal child 由其容器直接接收插入，不进入其子树。
      } else if (
        node.tag === OffscreenComponent &&
        node.memoizedState !== null
      ) {
        // 边界内 child 隐藏，追加前先切换可见性。
        const child = node.child;
        if (child !== null) {
          child.return = node;
        }
        appendAllChildren(
          parent,
          node,
          /* needsVisibilityToggle */ true,
          /* isHidden */ true,
        );
      } else if (node.child !== null) {
        node.child.return = node;
        node = node.child;
        continue;
      }
      if (node === workInProgress) {
        return;
      }
      // $FlowFixMe[incompatible-use] found when upgrading Flow
      while (node.sibling === null) {
        // $FlowFixMe[incompatible-use] found when upgrading Flow
        if (node.return === null || node.return === workInProgress) {
          return;
        }
        node = node.return;
      }
      // $FlowFixMe[incompatible-use] found when upgrading Flow
      node.sibling.return = node.return;
      node = node.sibling;
    }
  }
}

/**
 * appendAllChildren 面向 ChildSet 的持久化变体；父类型不同使两条热路径暂时分叉。
 * 返回是否包含需切换可见性的 Offscreen child，供 cloneInstance 决定能否直接接收 ChildSet。
 */
function appendAllChildrenToContainer(
  containerChildSet: ChildSet,
  workInProgress: Fiber,
  needsVisibilityToggle: boolean,
  isHidden: boolean,
): boolean {
  // 被 Offscreen 切换可见性的宿主组件不支持 passChildrenWhenCloningPersistedNodes；记录
  // ChildSet 是否含此类节点并返回给调用方。
  let hasOffscreenComponentChild = false;
  // $FlowFixMe[constant-condition]
  if (supportsPersistence) {
    // 当前只有顶层新建 Fiber，需要向下遍历找到全部终端宿主节点。
    let node = workInProgress.child;
    while (node !== null) {
      if (node.tag === HostComponent) {
        let instance = node.stateNode;
        if (needsVisibilityToggle && isHidden) {
          // 此 child 位于超时树内，克隆为隐藏实例。
          const props = node.memoizedProps;
          const type = node.type;
          instance = cloneHiddenInstance(instance, type, props);
        }
        appendChildToContainerChildSet(containerChildSet, instance);
      } else if (node.tag === HostText) {
        let instance = node.stateNode;
        if (needsVisibilityToggle && isHidden) {
          // 此 child 位于超时树内，克隆为隐藏文本实例。
          const text = node.memoizedProps;
          instance = cloneHiddenTextInstance(instance, text);
        }
        appendChildToContainerChildSet(containerChildSet, instance);
      } else if (node.tag === HostPortal) {
        // Portal child 由其容器直接接收插入，不进入其子树。
      } else if (
        node.tag === OffscreenComponent &&
        node.memoizedState !== null
      ) {
        // 边界内 child 隐藏，追加前先切换可见性。
        const child = node.child;
        if (child !== null) {
          child.return = node;
        }
        appendAllChildrenToContainer(
          containerChildSet,
          node,
          /* needsVisibilityToggle */ true,
          /* isHidden */ true,
        );

        hasOffscreenComponentChild = true;
      } else if (node.child !== null) {
        node.child.return = node;
        node = node.child;
        continue;
      }
      node = node as Fiber;
      if (node === workInProgress) {
        return hasOffscreenComponentChild;
      }
      // $FlowFixMe[incompatible-use] found when upgrading Flow
      while (node.sibling === null) {
        // $FlowFixMe[incompatible-use] found when upgrading Flow
        if (node.return === null || node.return === workInProgress) {
          return hasOffscreenComponentChild;
        }
        node = node.return;
      }
      // $FlowFixMe[incompatible-use] found when upgrading Flow
      node.sibling.return = node.return;
      node = node.sibling;
    }
  }

  return hasOffscreenComponentChild;
}

/**
 * 持久化模式下为 Root/Portal 重新构造 ChildSet，并在提交阶段用新集合整体替换容器内容。
 * 子树无需克隆时保持现有 pendingChildren，避免无意义的宿主提交。
 */
function updateHostContainer(current: null | Fiber, workInProgress: Fiber) {
  // $FlowFixMe[constant-condition]
  if (supportsPersistence) {
    if (doesRequireClone(current, workInProgress)) {
      const portalOrRoot: {
        /** Root 或 Portal 的宿主容器。 */
        containerInfo: Container,
        /** 完成阶段构造、等待提交阶段原子替换的子节点集合。 */
        pendingChildren: ChildSet,
        ...
      } = workInProgress.stateNode;
      const container = portalOrRoot.containerInfo;
      const newChildSet = createContainerChildSet();
      // child 可能变化时必须把全部终端宿主节点加入新集合。
      appendAllChildrenToContainer(
        newChildSet,
        workInProgress,
        /* needsVisibilityToggle */ false,
        /* isHidden */ false,
      );
      portalOrRoot.pendingChildren = newChildSet;
      // 标记容器更新，提交阶段整体交换 ChildSet。
      markUpdate(workInProgress);
      finalizeContainerChildren(container, newChildSet);
    }
  }
}

/**
 * 完成宿主组件更新：mutation 模式只为属性差异打 Update 标记；persistence 模式按结构
 * effect 克隆实例/ChildSet，并复用无变化实例。宿主首次挂载 effect 也在此补标。
 */
function updateHostComponent(
  current: Fiber,
  workInProgress: Fiber,
  type: Type,
  newProps: Props,
  renderLanes: Lanes,
) {
  // $FlowFixMe[constant-condition]
  if (supportsMutation) {
    // 存在 alternate 代表更新，需要安排提交阶段宿主副作用。
    const oldProps = current.memoizedProps;
    if (oldProps === newProps) {
      // mutation 模式属性引用相同即可 bailout；child 变化由各自 effect 处理。
      return;
    }

    markUpdate(workInProgress);
    // $FlowFixMe[constant-condition]
  } else if (supportsPersistence) {
    const currentInstance = current.stateNode;
    const oldProps = current.memoizedProps;
    // 节点及 child 均无结构 effect 时可安全复用整棵宿主子树。
    const requiresClone = doesRequireClone(current, workInProgress);
    if (!requiresClone && oldProps === newProps) {
      // 无变化，复用现有实例；这也可能释放先前尝试产生的 clone。
      workInProgress.stateNode = currentInstance;
      return;
    }
    const currentHostContext = getHostContext();

    let newChildSet = null;
    let hasOffscreenComponentChild = false;
    if (requiresClone && passChildrenWhenCloningPersistedNodes) {
      markCloned(workInProgress);
      newChildSet = createContainerChildSet();
      // child 可能变化，重新构造完整 ChildSet。
      hasOffscreenComponentChild = appendAllChildrenToContainer(
        newChildSet,
        workInProgress,
        /* needsVisibilityToggle */ false,
        /* isHidden */ false,
      );
    }

    const newInstance = cloneInstance(
      currentInstance,
      type,
      oldProps,
      newProps,
      !requiresClone,
      !hasOffscreenComponentChild ? newChildSet : undefined,
    );
    if (newInstance === currentInstance) {
      // HostConfig 判定无变化，复用现有实例并丢弃可能的旧 clone。
      workInProgress.stateNode = currentInstance;
      return;
    } else {
      markCloned(workInProgress);
    }

    // 某些渲染器初次挂载也需提交 effect（如 DOM autofocus），确保后续阶段处理。
    if (
      finalizeInitialChildren(newInstance, type, newProps, currentHostContext)
    ) {
      markUpdate(workInProgress);
    }
    workInProgress.stateNode = newInstance;
    if (
      requiresClone &&
      (!passChildrenWhenCloningPersistedNodes || hasOffscreenComponentChild)
    ) {
      // cloneInstance 未直接接收 ChildSet 时，重新追加全部 child。
      appendAllChildren(
        newInstance,
        workInProgress,
        /* needsVisibilityToggle */ false,
        /* isHidden */ false,
      );
    }
  }
}

/**
 * 预加载可能阻塞提交的宿主实例，并决定留在旧屏幕、挂起提交或仅设置二次检查标记。
 *
 * 必须在 complete 阶段最后调用：它可能抛出挂起；资源若立刻加载，工作循环会把该 Fiber
 * 当作已完成后继续。TODO：理想上移到 begin 阶段，但实例目前到 complete 才创建；现有
 * 会挂起的宿主节点没有 child，未来若放宽该假设需同步重构。
 */
function preloadInstanceAndSuspendIfNeeded(
  workInProgress: Fiber,
  type: Type,
  oldProps: null | Props,
  newProps: Props,
  renderLanes: Lanes,
) {
  const maySuspend =
    (enableSuspenseyImages ||
      (workInProgress.mode & SuspenseyImagesMode) !== NoMode) &&
    (oldProps === null
      ? maySuspendCommit(type, newProps)
      : maySuspendCommitOnUpdate(type, oldProps, newProps));

  if (!maySuspend) {
    // 当前 props 确定不会挂起时清除旧标记。HostConfig 可保守始终返回 true；若能确信资源
    // 不会被驱逐，则返回 false 作为性能优化。
    workInProgress.flags &= ~MaySuspendCommit;
    return;
  }

  // 所有“可能”挂起的宿主实例均保留标记，即使当前已就绪；揭示预渲染树时，节点虽已挂载，
  // 资源仍可能尚未加载。
  workInProgress.flags |= MaySuspendCommit;

  if (
    includesOnlySuspenseyCommitEligibleLanes(renderLanes) ||
    maySuspendCommitInSyncRender(type, newProps)
  ) {
    // 必要时尽早预加载；即使紧急渲染也可能受益。TODO：考虑移到 beginWork。
    const isReady = preloadInstance(workInProgress.stateNode, type, newProps);
    if (!isReady) {
      if (shouldRemainOnPreviousScreen()) {
        workInProgress.flags |= ShouldSuspendCommit;
      } else {
        suspendCommit();
      }
    } else {
      // 即使当前就绪，也在 pre-commit 再检查解码延迟或渲染期间因压力被逐出缓存的情况。
      workInProgress.flags |= ShouldSuspendCommit;
    }
  }
}

/**
 * Resource 版本的提交前预加载：维护 MaySuspendCommit 标记，未就绪时依据屏幕保留策略
 * 设置 ShouldSuspendCommit 或直接挂起提交。
 */
function preloadResourceAndSuspendIfNeeded(
  workInProgress: Fiber,
  resource: Resource,
  type: Type,
  props: Props,
  renderLanes: Lanes,
) {
  // 这是 preloadInstanceAndSuspendIfNeeded 面向 Resource 的分支。
  if (!mayResourceSuspendCommit(resource)) {
    workInProgress.flags &= ~MaySuspendCommit;
    return;
  }

  workInProgress.flags |= MaySuspendCommit;

  const isReady = preloadResource(resource);
  if (!isReady) {
    if (shouldRemainOnPreviousScreen()) {
      workInProgress.flags |= ShouldSuspendCommit;
    } else {
      suspendCommit();
    }
  }
}

/**
 * 为 Suspense/Offscreen 的 wakeable 安排提交阶段 retry listener，并在未完整渲染 sibling
 * 时申请即时 RetryLane，使后台预渲染可在资源就绪前继续推进。
 */
function scheduleRetryEffect(
  workInProgress: Fiber,
  retryQueue: RetryQueue | null,
) {
  const wakeables = retryQueue;
  if (wakeables !== null) {
    // 安排 effect 给 Promise 附加 retry listener。TODO：移到 passive 阶段。
    workInProgress.flags |= Update;
  }

  // 挂起树展开且 sibling 尚未完整渲染时要立即 retry，以开始预渲染。Suspensey Resource
  // （如样式表）只阻塞提交、不阻塞渲染，也复用此机制在资源就绪前继续工作。
  if (workInProgress.flags & ScheduleRetry) {
    const retryLane =
      // TODO：把判断移入 claimNextRetryLane，并进一步合并 Offscreen/Retry 车道策略。
      workInProgress.tag !== OffscreenComponent
        ? claimNextRetryLane()
        : OffscreenLane;
    workInProgress.lanes = mergeLanes(workInProgress.lanes, retryLane);

    // 记录即时 retry 车道，Root 提交时可将它们标为 suspended。
    markSpawnedRetryLane(retryLane);
  }
}

/**
 * 完成宿主文本更新：mutation 模式只打 Update 标记；persistence 模式为变化文本创建新
 * TextInstance，否则复用 current.stateNode。
 */
function updateHostText(
  current: Fiber,
  workInProgress: Fiber,
  oldText: string,
  newText: string,
) {
  // $FlowFixMe[constant-condition]
  if (supportsMutation) {
    // 文本不同则标记 Update，实际宿主写入全部在 commitWork 完成。
    if (oldText !== newText) {
      markUpdate(workInProgress);
    }
    // $FlowFixMe[constant-condition]
  } else if (supportsPersistence) {
    if (oldText !== newText) {
      // 文本内容不同，为持久树创建新 TextInstance。
      const rootContainerInstance = getRootHostContainer();
      const currentHostContext = getHostContext();
      markCloned(workInProgress);
      workInProgress.stateNode = createTextInstance(
        newText,
        rootContainerInstance,
        currentHostContext,
        workInProgress,
      );
    } else {
      workInProgress.stateNode = current.stateNode;
    }
  }
}

/**
 * 按 SuspenseList tailMode 截断尚未提交的尾部插入项。
 * hydration 必须尽量消费全部服务端节点而跳过截断；collapsed 至少保留一个 fallback，
 * hidden 则仅保留已挂载行，避免尾部挂起继续阻塞父级。
 */
function cutOffTailIfNeeded(
  renderState: SuspenseListRenderState,
  hasRenderedATailFallback: boolean,
) {
  if (getIsHydrating()) {
    // hydration 应尽量消费全部项，避免遗留服务端节点。
    return;
  }
  switch (renderState.tailMode) {
    case 'visible': {
      // visible 模式保留原样。
      break;
    }
    case 'collapsed': {
      // 尾部新增项应隐藏；已挂载边界及其之前内容不参与折叠，故先扫描整条 tail 定位它。
      let tailNode = renderState.tail;
      let lastTailNode = null;
      while (tailNode !== null) {
        if (tailNode.alternate !== null) {
          lastTailNode = tailNode;
        }
        tailNode = tailNode.sibling;
      }
      // 删除最后一个已渲染项之后的全部插入。
      if (lastTailNode === null) {
        // tail 剩余项全是新插入。
        if (!hasRenderedATailFallback && renderState.tail !== null) {
          // head 阶段已挂起；至少保留一行 tail fallback，其余截断。
          renderState.tail.sibling = null;
        } else {
          renderState.tail = null;
        }
      } else {
        // 从最后一个已插入节点后断开新增项。
        lastTailNode.sibling = null;
      }
      break;
    }
    // hidden 现为默认模式。
    case 'hidden':
    default: {
      // 尾部新增项应隐藏；已挂载边界及其之前内容不参与折叠，故先扫描整条 tail 定位它。
      let tailNode = renderState.tail;
      let lastTailNode = null;
      while (tailNode !== null) {
        if (tailNode.alternate !== null) {
          lastTailNode = tailNode;
        }
        tailNode = tailNode.sibling;
      }
      // 删除最后一个已渲染项之后的全部插入。
      if (lastTailNode === null) {
        // tail 剩余项全是新插入。
        renderState.tail = null;
      } else {
        // 从最后一个已插入节点后断开新增项。
        lastTailNode.sibling = null;
      }
      break;
    }
  }
}

/** 判断 SuspenseList 的当前 tail 是否全部为没有 alternate 的首次挂载行。 */
function isOnlyNewMounts(tail: Fiber): boolean {
  let fiber: null | Fiber = tail;
  while (fiber !== null) {
    if (fiber.alternate !== null) {
      return false;
    }
    fiber = fiber.sibling;
  }
  return true;
}

/**
 * 把 childLanes、subtreeFlags 与 Profiler duration 汇总到完成 Fiber。
 *
 * 正常完成上冒全部 effect；bailout 只上冒与 Fiber/Hook 同生命周期的 StaticMask。遍历中
 * 修复 child.return，且只累计本轮真正克隆/执行过节点的 actualDuration。
 */
function bubbleProperties(completedWork: Fiber) {
  const didBailout =
    completedWork.alternate !== null &&
    completedWork.alternate.child === completedWork.child;

  let newChildLanes: Lanes = NoLanes;
  let subtreeFlags: Flags = NoFlags;

  if (!didBailout) {
    // 上冒 child 车道与 effect。
    if (enableProfilerTimer && (completedWork.mode & ProfileMode) !== NoMode) {
      // Profiler 模式同时重算 duration。
      let actualDuration = completedWork.actualDuration;
      let treeBaseDuration = completedWork.selfBaseDuration as any as number;

      let child = completedWork.child;
      while (child !== null) {
        newChildLanes = mergeLanes(
          newChildLanes,
          mergeLanes(child.lanes, child.childLanes),
        );

        subtreeFlags |= child.subtreeFlags;
        subtreeFlags |= child.flags;

        // Fiber 克隆时 actualDuration 归零，只在本轮真正执行工作时更新并上冒；未克隆节点
        // 保留的是旧渲染耗时，不应重复计入。是否克隆由 child 指针关系判定。
        // $FlowFixMe[unsafe-addition] addition with possible null/undefined value
        actualDuration += child.actualDuration;

        // $FlowFixMe[unsafe-addition] addition with possible null/undefined value
        treeBaseDuration += child.treeBaseDuration;
        child = child.sibling;
      }

      completedWork.actualDuration = actualDuration;
      completedWork.treeBaseDuration = treeBaseDuration;
    } else {
      let child = completedWork.child;
      while (child !== null) {
        newChildLanes = mergeLanes(
          newChildLanes,
          mergeLanes(child.lanes, child.childLanes),
        );

        subtreeFlags |= child.subtreeFlags;
        subtreeFlags |= child.flags;

        // 修复 return 指针保持树一致；这依赖提交与渲染不并发，alternate 模型重构时应消除。
        child.return = completedWork;

        child = child.sibling;
      }
    }

    completedWork.subtreeFlags |= subtreeFlags;
  } else {
    // bailout 仍上冒 child 车道与静态 effect。
    if (enableProfilerTimer && (completedWork.mode & ProfileMode) !== NoMode) {
      // Profiler 模式仍需重算 treeBaseDuration。
      let treeBaseDuration = completedWork.selfBaseDuration as any as number;

      let child = completedWork.child;
      while (child !== null) {
        newChildLanes = mergeLanes(
          newChildLanes,
          mergeLanes(child.lanes, child.childLanes),
        );

        // Static flag 与所属 Fiber/Hook 同生命周期，bailout 也要上冒；其余 flag 只活一轮
        // render + commit，应忽略。
        subtreeFlags |= child.subtreeFlags & StaticMask;
        subtreeFlags |= child.flags & StaticMask;

        // $FlowFixMe[unsafe-addition] addition with possible null/undefined value
        treeBaseDuration += child.treeBaseDuration;
        child = child.sibling;
      }

      completedWork.treeBaseDuration = treeBaseDuration;
    } else {
      let child = completedWork.child;
      while (child !== null) {
        newChildLanes = mergeLanes(
          newChildLanes,
          mergeLanes(child.lanes, child.childLanes),
        );

        // Static flag 与所属 Fiber/Hook 同生命周期，bailout 也要上冒；其余单轮 flag 忽略。
        subtreeFlags |= child.subtreeFlags & StaticMask;
        subtreeFlags |= child.flags & StaticMask;

        // 修复 return 指针保持树一致；这依赖提交与渲染不并发，alternate 模型重构时应消除。
        child.return = completedWork;

        child = child.sibling;
      }
    }

    completedWork.subtreeFlags |= subtreeFlags;
  }

  completedWork.childLanes = newChildLanes;

  return didBailout;
}

/**
 * 完成 dehydrated Activity 边界，并决定是否回落到普通 Offscreen 完成路径。
 * 初次认领绑定宿主实例；重入后清理 hydration 状态、发布事件重放 effect；强制客户端
 * 渲染成功则把 hydration 错误保存到旧边界，交由提交阶段报告。
 */
function completeDehydratedActivityBoundary(
  current: Fiber | null,
  workInProgress: Fiber,
  nextState: ActivityState | null,
): boolean {
  const wasHydrated = popHydrationState(workInProgress);

  if (nextState !== null) {
    // 首次拾取或后续重入 Activity 边界时都可能仍处在 hydration 状态。
    if (current === null) {
      if (!wasHydrated) {
        throw new Error(
          'A dehydrated suspense component was completed without a hydrated node. ' +
            'This is probably a bug in React.',
        );
      }
      prepareToHydrateHostActivityInstance(workInProgress);
      bubbleProperties(workInProgress);
      if (enableProfilerTimer) {
        if ((workInProgress.mode & ProfileMode) !== NoMode) {
          // $FlowFixMe[invalid-compare]
          const isTimedOutSuspense = nextState !== null;
          if (isTimedOutSuspense) {
            // 超时子树耗时不计入基准 duration。
            const primaryChildFragment = workInProgress.child;
            if (primaryChildFragment !== null) {
              // $FlowFixMe[unsafe-arithmetic] Flow doesn't support type casting in combination with the -= operator
              workInProgress.treeBaseDuration -=
                primaryChildFragment.treeBaseDuration as any as number;
            }
          }
        }
      }
      return false;
    } else {
      emitPendingHydrationWarnings();
      // 若曾重入该边界，现在离开时需自行重置 hydration；popHydrationState 不负责全局清理。
      resetHydrationState();
      if ((workInProgress.flags & DidCapture) === NoFlags) {
        // 边界未挂起，现已完成 hydration 并解除 suspended 状态。
        nextState = workInProgress.memoizedState = null;
      }
      // 未挂起时 Update effect 标记边界已 hydration，允许事件调用并触发重放；挂起时同一
      // effect 用于附加 retry listener，因此无论哪种情况都标记。
      workInProgress.flags |= Update;
      bubbleProperties(workInProgress);
      if (enableProfilerTimer) {
        if ((workInProgress.mode & ProfileMode) !== NoMode) {
          const isTimedOutSuspense = nextState !== null;
          if (isTimedOutSuspense) {
            // 超时子树耗时不计入基准 duration。
            const primaryChildFragment = workInProgress.child;
            if (primaryChildFragment !== null) {
              // $FlowFixMe[unsafe-arithmetic] Flow doesn't support type casting in combination with the -= operator
              workInProgress.treeBaseDuration -=
                primaryChildFragment.treeBaseDuration as any as number;
            }
          }
        }
      }
      return false;
    }
  } else {
    // 树已完成。若来自强制客户端渲染，首次 hydration 的可恢复错误需进入提交队列，并
    // 保存到旧边界状态，便于从 Activity 边界访问。
    const hydrationErrors = upgradeHydrationErrorsToRecoverable();
    if (current !== null && current.memoizedState !== null) {
      const prevState: ActivityState = current.memoizedState;
      prevState.hydrationErrors = hydrationErrors;
    }
    // 回落到普通 Offscreen 完成路径。
    return true;
  }
}

/**
 * 完成 dehydrated Suspense 边界，并决定是否回落到普通 Suspense 完成路径。
 * 负责绑定宿主边界、清理重入 hydration、安排事件/重试 effect，以及保存强制客户端
 * 渲染所恢复的 hydration 错误。
 */
function completeDehydratedSuspenseBoundary(
  current: Fiber | null,
  workInProgress: Fiber,
  nextState: SuspenseState | null,
): boolean {
  const wasHydrated = popHydrationState(workInProgress);

  if (nextState !== null && nextState.dehydrated !== null) {
    // 首次拾取或后续重入 Suspense 边界时都可能仍处在 hydration 状态。
    if (current === null) {
      if (!wasHydrated) {
        throw new Error(
          'A dehydrated suspense component was completed without a hydrated node. ' +
            'This is probably a bug in React.',
        );
      }
      prepareToHydrateHostSuspenseInstance(workInProgress);
      bubbleProperties(workInProgress);
      if (enableProfilerTimer) {
        if ((workInProgress.mode & ProfileMode) !== NoMode) {
          // $FlowFixMe[invalid-compare]
          const isTimedOutSuspense = nextState !== null;
          if (isTimedOutSuspense) {
            // 超时 Suspense 子树耗时不计入基准 duration。
            const primaryChildFragment = workInProgress.child;
            if (primaryChildFragment !== null) {
              // $FlowFixMe[unsafe-arithmetic] Flow doesn't support type casting in combination with the -= operator
              workInProgress.treeBaseDuration -=
                primaryChildFragment.treeBaseDuration as any as number;
            }
          }
        }
      }
      return false;
    } else {
      emitPendingHydrationWarnings();
      // 若曾重入该边界，现在离开时需自行重置 hydration；popHydrationState 不负责全局清理。
      resetHydrationState();
      if ((workInProgress.flags & DidCapture) === NoFlags) {
        // 边界未挂起，现已完成 hydration 并解除 suspended 状态。
        nextState = workInProgress.memoizedState = null;
      }
      // 未挂起时 Update effect 标记边界已 hydration，允许事件调用并触发重放；挂起时同一
      // effect 用于附加 retry listener，因此无论哪种情况都标记。
      workInProgress.flags |= Update;
      bubbleProperties(workInProgress);
      if (enableProfilerTimer) {
        if ((workInProgress.mode & ProfileMode) !== NoMode) {
          const isTimedOutSuspense = nextState !== null;
          if (isTimedOutSuspense) {
            // 超时 Suspense 子树耗时不计入基准 duration。
            const primaryChildFragment = workInProgress.child;
            if (primaryChildFragment !== null) {
              // $FlowFixMe[unsafe-arithmetic] Flow doesn't support type casting in combination with the -= operator
              workInProgress.treeBaseDuration -=
                primaryChildFragment.treeBaseDuration as any as number;
            }
          }
        }
      }
      return false;
    }
  } else {
    // 树已完成。若来自强制客户端渲染，首次 hydration 的可恢复错误需进入提交队列，并
    // 保存到旧边界状态，便于从 Suspense 边界访问。
    const hydrationErrors = upgradeHydrationErrorsToRecoverable();
    if (current !== null && current.memoizedState !== null) {
      const prevState: SuspenseState = current.memoizedState;
      prevState.hydrationErrors = hydrationErrors;
    }
    // 回落到普通 Suspense 完成路径。
    return true;
  }
}

/**
 * Fiber complete 阶段总分派器：弹出 begin 阶段压入的上下文，构造/复用宿主实例，完成
 * hydration 与 Suspense/Offscreen 状态，并把 child lanes/effects 上冒给父级。
 *
 * 返回非空 Fiber 表示当前节点需立即开始第二遍（如 Suspense fallback 或下一行 tail）；
 * 返回 null 表示该节点完成，工作循环可继续其 sibling/parent。
 */
function completeWork(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
): Fiber | null {
  const newProps = workInProgress.pendingProps;
  // 此处刻意不判断 hydration；直接比较 current provider 同样快且更不易出错。理想上可为
  // hydration 提供专用工作循环。
  popTreeContext(workInProgress);
  switch (workInProgress.tag) {
    case IncompleteFunctionComponent: {
      if (disableLegacyMode) {
        break;
      }
      // 继续落入无宿主完成工作的函数组件分支。
    }
    case LazyComponent:
    case SimpleMemoComponent:
    case FunctionComponent:
    case ForwardRef:
    case Fragment:
    case Mode:
    case Profiler:
    case ContextConsumer:
    case MemoComponent:
      bubbleProperties(workInProgress);
      return null;
    case ClassComponent: {
      const Component = workInProgress.type;
      if (isLegacyContextProvider(Component)) {
        popLegacyContext(workInProgress);
      }
      bubbleProperties(workInProgress);
      return null;
    }
    case HostRoot: {
      const fiberRoot = workInProgress.stateNode as FiberRoot;

      if (enableTransitionTracing) {
        const transitions = getWorkInProgressTransitions();
        // 若有新 Transition，需在 passive 阶段安排 callback 并处理，故此处标记 Passive。
        if (transitions !== null) {
          workInProgress.flags |= Passive;
        }
      }

      let previousCache: Cache | null = null;
      if (current !== null) {
        previousCache = current.memoizedState.cache;
      }
      const cache: Cache = workInProgress.memoizedState.cache;
      if (cache !== previousCache) {
        // 用 passive effect retain/release Cache。
        workInProgress.flags |= Passive;
      }
      popCacheProvider(workInProgress, cache);

      if (enableTransitionTracing) {
        popRootMarkerInstance(workInProgress);
      }

      popRootTransition(workInProgress, fiberRoot, renderLanes);
      popHostContainer(workInProgress);
      popTopLevelLegacyContextObject(workInProgress);
      if (fiberRoot.pendingContext) {
        fiberRoot.context = fiberRoot.pendingContext;
        fiberRoot.pendingContext = null;
      }
      if (current === null || current.child === null) {
        // 若执行了 hydration，弹出状态以检查并删除未被消费的剩余 child。
        const wasHydrated = popHydrationState(workInProgress);
        if (wasHydrated) {
          emitPendingHydrationWarnings();
          // hydration 完成后为 Root 的提交副作用安排 Update。
          markUpdate(workInProgress);
        } else {
          if (current !== null) {
            const prevState: RootState = current.memoizedState;
            if (
              // 检查是否为客户端 Root。
              !prevState.isDehydrated ||
              // 检查是否因错误等原因回退为客户端渲染。
              (workInProgress.flags & ForceClientRender) !== NoFlags
            ) {
              // 安排下次提交开始时清空容器，处理容器原有外部 child 的情况。更新时也安全：
              // current.child 仅在上次渲染为 null 时为空，此时容器本就应为空。
              workInProgress.flags |= Snapshot;

              // 强制客户端渲染可能恢复了首次 hydration 错误，将其入队供提交阶段报告。
              upgradeHydrationErrorsToRecoverable();
            }
          }
        }
      }
      updateHostContainer(current, workInProgress);
      bubbleProperties(workInProgress);
      if (enableTransitionTracing) {
        if ((workInProgress.subtreeFlags & Visibility) !== NoFlags) {
          // Suspense child 切换可见性时，pending boundaries 数组需在 passive 阶段更新。
          workInProgress.flags |= Passive;
        }
      }
      return null;
    }
    case HostHoistable: {
      // $FlowFixMe[constant-condition]
      if (supportsResources) {
        // HostHoistable 可能对应 Resource 或 Instance，且更新时可切换，因此分支较多。

        const type = workInProgress.type;
        const nextResource: Resource | null = workInProgress.memoizedState;
        if (current === null) {
          // 挂载时必须在本次提交更新 Hoistable。TODO：非 hydration 时在 complete 阶段创建实例。
          markUpdate(workInProgress);
          if (nextResource !== null) {
            // 当前是 Hoistable Resource。

            // 预加载必须位于 complete 阶段最后。
            bubbleProperties(workInProgress);
            preloadResourceAndSuspendIfNeeded(
              workInProgress,
              nextResource,
              type,
              newProps,
              renderLanes,
            );
            return null;
          } else {
            // 当前是 Hoistable Instance；预加载必须位于 complete 阶段最后。
            bubbleProperties(workInProgress);
            preloadInstanceAndSuspendIfNeeded(
              workInProgress,
              type,
              null,
              newProps,
              renderLanes,
            );
            return null;
          }
        } else {
          // 当前是更新。
          if (nextResource) {
            // 当前是 Resource。
            if (nextResource !== current.memoizedState) {
              // Resource 已更换，需要提交更新。
              markUpdate(workInProgress);
              // 预加载前先完成属性上冒。
              bubbleProperties(workInProgress);
              // 预加载可能抛挂起且资源可能立刻就绪，故必须在 complete 阶段最后执行。
              preloadResourceAndSuspendIfNeeded(
                workInProgress,
                nextResource,
                type,
                newProps,
                renderLanes,
              );
              return null;
            } else {
              // 清除标记前先完成属性上冒。
              bubbleProperties(workInProgress);
              workInProgress.flags &= ~MaySuspendCommit;
              return null;
            }
          } else {
            const oldProps = current.memoizedProps;
            // 当前是 Instance，可能需要更新 Hoistable props。
            // $FlowFixMe[constant-condition]
            if (supportsMutation) {
              if (oldProps !== newProps) {
                markUpdate(workInProgress);
              }
            } else {
              // 复用 updateHostComponent，以生成 Hoistable 所需更新数据。
              updateHostComponent(
                current,
                workInProgress,
                type,
                newProps,
                renderLanes,
              );
            }
            // 预加载必须位于 complete 阶段最后。
            bubbleProperties(workInProgress);
            preloadInstanceAndSuspendIfNeeded(
              workInProgress,
              type,
              oldProps,
              newProps,
              renderLanes,
            );
            return null;
          }
        }
      }
      // HostConfig 不支持 Resource 时落入 HostSingleton/HostComponent。
    }
    case HostSingleton: {
      // $FlowFixMe[constant-condition]
      if (supportsSingletons) {
        popHostContext(workInProgress);
        const rootContainerInstance = getRootHostContainer();
        const type = workInProgress.type;
        if (current !== null && workInProgress.stateNode != null) {
          // $FlowFixMe[constant-condition]
          if (supportsMutation) {
            const oldProps = current.memoizedProps;
            if (oldProps !== newProps) {
              markUpdate(workInProgress);
            }
          } else {
            updateHostComponent(
              current,
              workInProgress,
              type,
              newProps,
              renderLanes,
            );
          }
        } else {
          if (!newProps) {
            if (workInProgress.stateNode === null) {
              throw new Error(
                'We must have new props for new mounts. This error is likely ' +
                  'caused by a bug in React. Please file an issue.',
              );
            }

            // 中止工作后恢复时可能进入此路径。
            bubbleProperties(workInProgress);
            if (enableViewTransition) {
              // HostComponent 自身充当不执行 enter/exit 动画的 View Transition，清除内部
              // ViewTransition 上冒的静态标记。
              workInProgress.subtreeFlags &= ~ViewTransitionStatic;
            }
            return null;
          }

          const currentHostContext = getHostContext();
          const wasHydrated = popHydrationState(workInProgress);
          let instance: Instance;
          if (wasHydrated) {
            // 忽略表示 updateQueue 的布尔结果：它仅用于设置文本 child，HostSingleton 不使用。
            prepareToHydrateHostInstance(workInProgress, currentHostContext);
            instance = workInProgress.stateNode;
          } else {
            instance = resolveSingletonInstance(
              type,
              newProps,
              rootContainerInstance,
              currentHostContext,
              true,
            );
            workInProgress.stateNode = instance;
            markUpdate(workInProgress);
          }
        }
        bubbleProperties(workInProgress);
        if (enableViewTransition) {
          // HostComponent 自身充当不执行 enter/exit 动画的 View Transition，清除内部
          // ViewTransition 上冒的静态标记。
          workInProgress.subtreeFlags &= ~ViewTransitionStatic;
        }
        return null;
      }
      // HostConfig 不支持 singleton 时落入普通 HostComponent。
    }
    case HostComponent: {
      popHostContext(workInProgress);
      const type = workInProgress.type;
      if (current !== null && workInProgress.stateNode != null) {
        updateHostComponent(
          current,
          workInProgress,
          type,
          newProps,
          renderLanes,
        );
      } else {
        if (!newProps) {
          if (workInProgress.stateNode === null) {
            throw new Error(
              'We must have new props for new mounts. This error is likely ' +
                'caused by a bug in React. Please file an issue.',
            );
          }

          // 中止工作后恢复时可能进入此路径。
          bubbleProperties(workInProgress);
          if (enableViewTransition) {
            // HostComponent 自身充当不执行 enter/exit 动画的 View Transition，清除内部
            // ViewTransition 上冒的静态标记。
            workInProgress.subtreeFlags &= ~ViewTransitionStatic;
          }
          return null;
        }

        const currentHostContext = getHostContext();
        // TODO：把 createInstance 移到 beginWork，并在 Context 栈保存父级；随后可按宿主
        // 需要选择 beginWork 自顶向下或 completeWork 自底向上追加，IE11 前者更快。
        const wasHydrated = popHydrationState(workInProgress);
        if (wasHydrated) {
          // TODO：与 createInstance 一并移到 begin 阶段以合并路径。
          prepareToHydrateHostInstance(workInProgress, currentHostContext);
          if (
            finalizeHydratedChildren(
              workInProgress.stateNode,
              type,
              newProps,
              currentHostContext,
            )
          ) {
            workInProgress.flags |= Hydrate;
          }
        } else {
          const rootContainerInstance = getRootHostContainer();
          const instance = createInstance(
            type,
            newProps,
            rootContainerInstance,
            currentHostContext,
            workInProgress,
          );
          // TODO：持久化渲染器应在首次创建实例时直接传入 child。
          markCloned(workInProgress);
          appendAllChildren(instance, workInProgress, false, false);
          workInProgress.stateNode = instance;

          // 某些渲染器初次挂载也需提交 effect（如 DOM autofocus），确保后续阶段处理。
          if (
            finalizeInitialChildren(
              instance,
              type,
              newProps,
              currentHostContext,
            )
          ) {
            markUpdate(workInProgress);
          }
        }
      }
      bubbleProperties(workInProgress);
      if (enableViewTransition) {
        // HostComponent 自身充当不执行 enter/exit 动画的 View Transition，清除内部
        // ViewTransition 上冒的静态标记。
        workInProgress.subtreeFlags &= ~ViewTransitionStatic;
      }

      // 预加载可能抛挂起且资源可能立刻就绪，故必须在 complete 阶段最后执行。
      preloadInstanceAndSuspendIfNeeded(
        workInProgress,
        workInProgress.type,
        current === null ? null : current.memoizedProps,
        workInProgress.pendingProps,
        renderLanes,
      );
      return null;
    }
    case HostText: {
      const newText = newProps;
      if (current && workInProgress.stateNode != null) {
        const oldText = current.memoizedProps;
        // 存在 alternate 代表更新，需要安排提交阶段副作用。
        updateHostText(current, workInProgress, oldText, newText);
      } else {
        if (typeof newText !== 'string') {
          if (workInProgress.stateNode === null) {
            throw new Error(
              'We must have new props for new mounts. This error is likely ' +
                'caused by a bug in React. Please file an issue.',
            );
          }
          // 中止工作后恢复时可能进入此路径。
        }
        const rootContainerInstance = getRootHostContainer();
        const currentHostContext = getHostContext();
        const wasHydrated = popHydrationState(workInProgress);
        if (wasHydrated) {
          prepareToHydrateHostTextInstance(workInProgress);
        } else {
          markCloned(workInProgress);
          workInProgress.stateNode = createTextInstance(
            newText,
            rootContainerInstance,
            currentHostContext,
            workInProgress,
          );
        }
      }
      bubbleProperties(workInProgress);
      return null;
    }
    case ActivityComponent: {
      const nextState: null | ActivityState = workInProgress.memoizedState;

      if (current === null || current.memoizedState !== null) {
        const fallthroughToNormalOffscreenPath =
          completeDehydratedActivityBoundary(
            current,
            workInProgress,
            nextState,
          );
        if (!fallthroughToNormalOffscreenPath) {
          if (workInProgress.flags & ForceClientRender) {
            popSuspenseHandler(workInProgress);
            // 仍有未 hydration 节点，按 mismatch 处理并回退客户端渲染。
            return workInProgress;
          } else {
            popSuspenseHandler(workInProgress);
            // 初次渲染或内部挂起导致 hydration 尚未完成。
            return null;
          }
        }

        if ((workInProgress.flags & DidCapture) !== NoFlags) {
          // retryActivityComponentWithoutHydrating 已尝试客户端渲染却再次挂起；第二遍本不应
          // 压入 Suspense handler，而应向上挂起，故到此即为内部错误。
          throw new Error(
            'Client rendering an Activity suspended it again. This is a bug in React.',
          );
        }

        // 继续普通 Activity 路径。
      }

      bubbleProperties(workInProgress);
      return null;
    }
    case SuspenseComponent: {
      const nextState: null | SuspenseState = workInProgress.memoizedState;

      // dehydrated 边界专用路径。未来可能拆成独立 Fiber 类型，以支持非 Suspense 的其他
      // hydration 边界；为便于重构，相关逻辑集中在此分支。
      if (
        current === null ||
        (current.memoizedState !== null &&
          current.memoizedState.dehydrated !== null)
      ) {
        const fallthroughToNormalSuspensePath =
          completeDehydratedSuspenseBoundary(
            current,
            workInProgress,
            nextState,
          );
        if (!fallthroughToNormalSuspensePath) {
          if (workInProgress.flags & ForceClientRender) {
            popSuspenseHandler(workInProgress);
            // 仍有未 hydration 节点，按 mismatch 处理并回退客户端渲染。
            return workInProgress;
          } else {
            popSuspenseHandler(workInProgress);
            // 初次渲染或内部挂起导致 hydration 尚未完成。
            return null;
          }
        }

        // 继续普通 Suspense 路径。
      }

      popSuspenseHandler(workInProgress);

      if ((workInProgress.flags & DidCapture) !== NoFlags) {
        // 有内容挂起，用 fallback child 重渲染。
        workInProgress.lanes = renderLanes;
        if (
          enableProfilerTimer &&
          (workInProgress.mode & ProfileMode) !== NoMode
        ) {
          transferActualDuration(workInProgress);
        }
        // 此时不应上冒属性，第二遍完成后再汇总。
        return workInProgress;
      }

      const nextDidTimeout = nextState !== null;
      const prevDidTimeout =
        current !== null &&
        (current.memoizedState as null | SuspenseState) !== null;

      if (nextDidTimeout) {
        const offscreenFiber: Fiber = workInProgress.child as any;
        let previousCache: Cache | null = null;
        if (
          offscreenFiber.alternate !== null &&
          offscreenFiber.alternate.memoizedState !== null &&
          offscreenFiber.alternate.memoizedState.cachePool !== null
        ) {
          previousCache = offscreenFiber.alternate.memoizedState.cachePool.pool;
        }
        let cache: Cache | null = null;
        if (
          offscreenFiber.memoizedState !== null &&
          offscreenFiber.memoizedState.cachePool !== null
        ) {
          cache = offscreenFiber.memoizedState.cachePool.pool;
        }
        if (cache !== previousCache) {
          // 用 passive effect retain/release Cache。
          offscreenFiber.flags |= Passive;
        }
      }

      // 边界 suspended 状态变化时，安排 passive effect 处理 Transition。
      if (nextDidTimeout !== prevDidTimeout) {
        if (enableTransitionTracing) {
          const offscreenFiber: Fiber = workInProgress.child as any;
          offscreenFiber.flags |= Passive;
        }

        // 状态变化还需切换子树可见性。fallback → primary 时内部 Offscreen 会在自身 complete
        // 阶段安排；primary → fallback 时它没有 complete 阶段，故在此补标。effect 的连接/
        // 断开也遵循相同规则：只有 fallback 激活时需要此特殊处理。
        if (nextDidTimeout) {
          const offscreenFiber: Fiber = workInProgress.child as any;
          offscreenFiber.flags |= Visibility;
        }
      }

      const retryQueue: RetryQueue | null = workInProgress.updateQueue as any;
      scheduleRetryEffect(workInProgress, retryQueue);

      if (
        enableSuspenseCallback &&
        workInProgress.updateQueue !== null &&
        workInProgress.memoizedProps.suspenseCallback != null
      ) {
        // 始终通知 suspenseCallback。TODO：移到 passive 阶段。
        workInProgress.flags |= Update;
      }
      bubbleProperties(workInProgress);
      if (enableProfilerTimer) {
        if ((workInProgress.mode & ProfileMode) !== NoMode) {
          if (nextDidTimeout) {
            // 超时 Suspense 子树耗时不计入基准 duration。
            const primaryChildFragment = workInProgress.child;
            if (primaryChildFragment !== null) {
              // $FlowFixMe[unsafe-arithmetic] Flow doesn't support type casting in combination with the -= operator
              workInProgress.treeBaseDuration -=
                primaryChildFragment.treeBaseDuration as any as number;
            }
          }
        }
      }
      return null;
    }
    case HostPortal:
      popHostContainer(workInProgress);
      updateHostContainer(current, workInProgress);
      if (current === null) {
        preparePortalMount(workInProgress.stateNode.containerInfo);
      }
      workInProgress.flags |= PortalStatic;
      bubbleProperties(workInProgress);
      return null;
    case ContextProvider:
      // 弹出 Provider Fiber。
      const context: ReactContext<any> = workInProgress.type;
      popProvider(context, workInProgress);
      bubbleProperties(workInProgress);
      return null;
    case IncompleteClassComponent: {
      if (disableLegacyMode) {
        break;
      }
      // 与 ClassComponent 相同；放在此处保持 tag 连续，使 switch 可编译为 jump table。
      const Component = workInProgress.type;
      if (isLegacyContextProvider(Component)) {
        popLegacyContext(workInProgress);
      }
      bubbleProperties(workInProgress);
      return null;
    }
    case SuspenseListComponent: {
      popSuspenseListContext(workInProgress);

      const renderState: null | SuspenseListRenderState =
        workInProgress.memoizedState;

      if (renderState === null) {
        // 默认 independent 模式无需额外协调。
        bubbleProperties(workInProgress);
        return null;
      }

      let didSuspendAlready = (workInProgress.flags & DidCapture) !== NoFlags;

      const renderedTail = renderState.rendering;
      if (renderedTail === null) {
        // 刚完成 head。
        if (!didSuspendAlready) {
          // 第一遍需确认已渲染集合中是否仍有挂起边界。

          // 若部分新内容解除挂起而另一些仍未解除，第二遍强制所有边界继续显示 fallback。

          // 本轮或上次已提交渲染可能挂起；若两者都没有，可跳过昂贵的 findFirstSuspended。
          const cannotBeSuspended =
            renderHasNotSuspendedYet() &&
            (current === null || (current.flags & DidCapture) === NoFlags);
          if (!cannotBeSuspended) {
            let row = workInProgress.child;
            while (row !== null) {
              const suspended = findFirstSuspended(row);
              if (suspended !== null) {
                didSuspendAlready = true;
                workInProgress.flags |= DidCapture;
                cutOffTailIfNeeded(renderState, false);

                // 新挂起树第二遍可能不提交，因而无人订阅其 thenable；把 retryQueue 转移到
                // SuspenseList，解析后仍能 retry。列表可能有多个，但最终要等全部依赖，哪个
                // 发 ping 不重要；动态增删行/依赖使精确计数复杂。提前退出也无妨，已找到的
                // 其他边界已有 listener。
                const retryQueue: RetryQueue | null =
                  suspended.updateQueue as any;
                workInProgress.updateQueue = retryQueue;
                scheduleRetryEffect(workInProgress, retryQueue);

                // 第二遍重渲染整表并强制保留 fallback；先清除已失效 effect，再把 child
                // Fiber 重置到原始状态。
                workInProgress.subtreeFlags = NoFlags;
                resetChildFibers(workInProgress, renderLanes);

                // 设置 SuspenseList Context 强制挂起，并立即重渲染 child。
                pushSuspenseListContext(
                  workInProgress,
                  setShallowSuspenseListContext(
                    suspenseStackCursor.current,
                    ForceSuspenseFallback,
                  ),
                );
                if (getIsHydrating()) {
                  // 函数开头已弹出 TreeFork Context，此处为 hydration 第二遍重新压入。
                  pushTreeFork(workInProgress, renderState.treeForkCount);
                }
                // 此时不应上冒属性，第二遍完成后再汇总。
                return workInProgress.child;
              }
              row = row.sibling;
            }
          }

          if (renderState.tail !== null && now() > getRenderTargetTime()) {
            // 已超过 CPU deadline 且 tail 仍有行，放弃继续主内容，仅渲染 fallback。
            workInProgress.flags |= DidCapture;
            didSuspendAlready = true;

            cutOffTailIfNeeded(renderState, false);

            // 没有真实挂起就不会有 ping 触发下一项；虽然优先级与当前渲染相同，Transition
            // 提交后已属下一批，同步路径也应先让出供绘制。概念上等价于 ping，可复用任意
            // RetryLane，包括当前正在渲染的车道，因为它将留在此节点。
            workInProgress.lanes = SomeRetryLane;
          }
        } else {
          cutOffTailIfNeeded(renderState, false);
        }
        // 下一步渲染 tail。
      } else {
        // 把已渲染行追加到 child 链表。
        if (!didSuspendAlready) {
          const suspended = findFirstSuspended(renderedTail);
          if (suspended !== null) {
            workInProgress.flags |= DidCapture;
            didSuspendAlready = true;

            // 把 updateQueue 转移给父级，避免该行在第二遍被丢弃时遗失 retry 订阅。
            const retryQueue: RetryQueue | null = suspended.updateQueue as any;
            workInProgress.updateQueue = retryQueue;
            scheduleRetryEffect(workInProgress, retryQueue);

            cutOffTailIfNeeded(renderState, true);
            // cutOffTailIfNeeded 可能已修改 tail。
            if (
              renderState.tail === null &&
              renderState.tailMode !== 'collapsed' &&
              renderState.tailMode !== 'visible' &&
              !renderedTail.alternate &&
              !getIsHydrating() // hydration 时不截断。
            ) {
              // tail 已完成。
              bubbleProperties(workInProgress);
              return null;
            }
          } else if (
            // 上一行耗时已大于剩余预算，再渲染一行很可能超时。
            now() * 2 - renderState.renderingStartTime >
              getRenderTargetTime() &&
            renderLanes !== OffscreenLane
          ) {
            // 已超过 CPU deadline，放弃继续主内容，仅渲染通常更快的 fallback。
            workInProgress.flags |= DidCapture;
            didSuspendAlready = true;

            cutOffTailIfNeeded(renderState, false);

            // 没有真实挂起就不会有 ping；用 RetryLane 把下一项留到 Transition 提交后的新批次，
            // 同步渲染也先让出供绘制。可复用任意 RetryLane，包括当前车道。
            workInProgress.lanes = SomeRetryLane;
          }
        }
        if (renderState.isBackwards) {
          // backwards 模式把行插到链表开头。
          renderedTail.sibling = workInProgress.child;
          workInProgress.child = renderedTail;
        } else {
          const previousSibling = renderState.last;
          if (previousSibling !== null) {
            previousSibling.sibling = renderedTail;
          } else {
            workInProgress.child = renderedTail;
          }
          renderState.last = renderedTail;
        }
      }

      if (renderState.tail !== null) {
        // 仍有 tail 行，弹出下一行。TODO：在 state 保存首次挂载 tail 的表头，避免每行重算。
        const next = renderState.tail;
        const onlyNewMounts = isOnlyNewMounts(next);
        renderState.rendering = next;
        renderState.tail = next.sibling;
        renderState.renderingStartTime = now();
        next.sibling = null;

        // 恢复 Context。TODO：可避免先弹出，只在首次从未挂起转为挂起时设置。
        let suspenseContext = suspenseStackCursor.current;
        if (didSuspendAlready) {
          suspenseContext = setShallowSuspenseListContext(
            suspenseContext,
            ForceSuspenseFallback,
          );
        } else {
          suspenseContext =
            setDefaultShallowSuspenseListContext(suspenseContext);
        }
        if (
          renderState.tailMode === 'visible' ||
          renderState.tailMode === 'collapsed' ||
          !onlyNewMounts ||
          // TODO：hydration 时仍允许 tail 挂起父级；hidden 模式的 hydration 当前本就不完整，
          // 此分支谨慎保留旧语义。正确实现后应移除该特例。
          getIsHydrating()
        ) {
          pushSuspenseListContext(workInProgress, suspenseContext);
        } else {
          // hidden（默认）模式中 tail 自身挂起可直接删除，无需挂起父级，故在此充当 catch。
          // collapsed 至少渲染一个 suspended 行后会截掉其余，不会到此。更新节点不能从 tail
          // 删除，等效 visible；若再次挂起会走另一分支挂起父级。
          pushSuspenseListCatch(workInProgress, suspenseContext);
        }
        // 对下一行执行一遍完成流程。
        if (getIsHydrating()) {
          // 函数开头已弹出 TreeFork Context，此处为 hydration 下一行重新压入。
          pushTreeFork(workInProgress, renderState.treeForkCount);
        }
        // 此时不应上冒属性，下一行完成后再汇总。
        return next;
      }
      bubbleProperties(workInProgress);
      return null;
    }
    case ScopeComponent: {
      if (enableScopeAPI) {
        if (current === null) {
          const scopeInstance: ReactScopeInstance = createScopeInstance();
          workInProgress.stateNode = scopeInstance;
          prepareScopeUpdate(scopeInstance, workInProgress);
          if (workInProgress.ref !== null) {
            // ScopeComponent 挂有 ref 时提交阶段必有工作。
            markUpdate(workInProgress);
          }
        } else {
          if (workInProgress.ref !== null) {
            // ScopeComponent 挂有 ref 时提交阶段必有工作。
            markUpdate(workInProgress);
          }
        }
        bubbleProperties(workInProgress);
        return null;
      }
      break;
    }
    case OffscreenComponent:
    case LegacyHiddenComponent: {
      popSuspenseHandler(workInProgress);
      popHiddenContext(workInProgress);
      const nextState: OffscreenState | null = workInProgress.memoizedState;
      const nextIsHidden = nextState !== null;

      // 可见性变化时安排 Visibility effect。
      if (enableLegacyHidden && workInProgress.tag === LegacyHiddenComponent) {
        // LegacyHidden 不实际隐藏，只做预渲染。
      } else {
        if (current !== null) {
          const prevState: OffscreenState | null = current.memoizedState;
          const prevIsHidden = prevState !== null;
          if (prevIsHidden !== nextIsHidden) {
            workInProgress.flags |= Visibility;
          }
        } else {
          // 首次挂载仅在树隐藏时需要 Visibility effect。
          if (nextIsHidden) {
            workInProgress.flags |= Visibility;
          }
        }
      }

      if (
        !nextIsHidden ||
        (!disableLegacyMode &&
          (workInProgress.mode & ConcurrentMode) === NoMode)
      ) {
        bubbleProperties(workInProgress);
      } else {
        // 隐藏 child 仅在 Offscreen 优先级渲染时上冒属性。
        if (
          includesSomeLane(renderLanes, OffscreenLane as Lane) &&
          // 树挂起时同样不上冒。
          (workInProgress.flags & DidCapture) === NoLanes
        ) {
          bubbleProperties(workInProgress);
          // 隐藏子树若有插入/更新，提交阶段需隐藏新宿主节点，故安排 Visibility effect。
          if (
            (!enableLegacyHidden ||
              workInProgress.tag !== LegacyHiddenComponent) &&
            workInProgress.subtreeFlags & (Placement | Update)
          ) {
            workInProgress.flags |= Visibility;
          }
        }
      }

      const offscreenQueue: OffscreenQueue | null =
        workInProgress.updateQueue as any;
      if (offscreenQueue !== null) {
        const retryQueue = offscreenQueue.retryQueue;
        scheduleRetryEffect(workInProgress, retryQueue);
      }

      let previousCache: Cache | null = null;
      if (
        current !== null &&
        current.memoizedState !== null &&
        current.memoizedState.cachePool !== null
      ) {
        previousCache = current.memoizedState.cachePool.pool;
      }
      let cache: Cache | null = null;
      if (
        workInProgress.memoizedState !== null &&
        workInProgress.memoizedState.cachePool !== null
      ) {
        cache = workInProgress.memoizedState.cachePool.pool;
      }
      if (cache !== previousCache) {
        // 用 passive effect retain/release Cache。
        workInProgress.flags |= Passive;
      }

      popTransition(workInProgress, current);

      return null;
    }
    case CacheComponent: {
      let previousCache: Cache | null = null;
      if (current !== null) {
        previousCache = current.memoizedState.cache;
      }
      const cache: Cache = workInProgress.memoizedState.cache;
      if (cache !== previousCache) {
        // 用 passive effect retain/release Cache。
        workInProgress.flags |= Passive;
      }
      popCacheProvider(workInProgress, cache);
      bubbleProperties(workInProgress);
      return null;
    }
    case TracingMarkerComponent: {
      if (enableTransitionTracing) {
        const instance: TracingMarkerInstance | null = workInProgress.stateNode;
        if (instance !== null) {
          popMarkerInstance(workInProgress);
        }
        bubbleProperties(workInProgress);
      }
      return null;
    }
    case ViewTransitionComponent: {
      if (enableViewTransition) {
        // 该组件卸载时可能需要 exit transition；静态标记上冒，通知父树存在此类 child。
        workInProgress.flags |= ViewTransitionStatic;
        if (enableViewTransitionParentEnterExit) {
          const props = workInProgress.pendingProps;
          if (
            props.parentEnter !== undefined ||
            props.parentExit !== undefined ||
            props.onParentEnter != null ||
            props.onParentExit != null ||
            props.onGestureParentEnter != null ||
            props.onGestureParentExit != null
          ) {
            workInProgress.flags |= ViewTransitionStaticParent;
          } else {
            workInProgress.flags &= ~ViewTransitionStaticParent;
          }
        }
        bubbleProperties(workInProgress);
      }
      return null;
    }
    case Throw: {
      if (!disableLegacyMode) {
        // 仅 Legacy Mode 会完成错误节点。
        return null;
      }
    }
  }

  throw new Error(
    `Unknown unit of work tag (${workInProgress.tag}). This error is likely caused by a bug in ` +
      'React. Please file an issue.',
  );
}

export {completeWork};
