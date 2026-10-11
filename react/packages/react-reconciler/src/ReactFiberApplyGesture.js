/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ViewTransitionProps} from 'shared/ReactTypes';

import type {Fiber, FiberRoot} from './ReactInternalTypes';

import type {Instance, TextInstance, Props} from './ReactFiberConfig';

import type {OffscreenState} from './ReactFiberOffscreenComponent';

import type {ViewTransitionState} from './ReactFiberViewTransitionComponent';

import {
  cloneMutableInstance,
  cloneMutableTextInstance,
  cloneRootViewTransitionContainer,
  removeRootViewTransitionClone,
  cancelRootViewTransitionName,
  restoreRootViewTransitionName,
  cancelViewTransitionName,
  applyViewTransitionName,
  appendChild,
  commitUpdate,
  commitTextUpdate,
  resetTextContent,
  supportsResources,
  supportsSingletons,
  unhideInstance,
  unhideTextInstance,
} from './ReactFiberConfig';
import {
  popMutationContext,
  pushMutationContext,
  viewTransitionMutationContext,
  trackHostMutation,
} from './ReactFiberMutationTracking';
import {
  MutationMask,
  Placement,
  Update,
  ContentReset,
  NoFlags,
  Visibility,
  ViewTransitionNamedStatic,
  ViewTransitionStatic,
  AffectedParentLayout,
} from './ReactFiberFlags';
import {
  HasEffect as HookHasEffect,
  Insertion as HookInsertion,
} from './ReactHookEffectTags';
import {
  FunctionComponent,
  ForwardRef,
  MemoComponent,
  SimpleMemoComponent,
  HostComponent,
  HostHoistable,
  HostSingleton,
  HostText,
  HostPortal,
  OffscreenComponent,
  ViewTransitionComponent,
} from './ReactWorkTags';
import {
  restoreEnterOrExitViewTransitions,
  restoreNestedViewTransitions,
  restoreUpdateViewTransitionForGesture,
  appearingViewTransitions,
  commitEnterViewTransitions,
  commitParentExitViewTransitions,
  measureNestedViewTransitions,
  measureUpdateViewTransition,
  viewTransitionCancelableChildren,
  pushViewTransitionCancelableScope,
  popViewTransitionCancelableScope,
} from './ReactFiberCommitViewTransitions';
import {
  commitHookEffectListMount,
  commitHookEffectListUnmount,
} from './ReactFiberCommitEffects';
import {
  getViewTransitionName,
  getViewTransitionClassName,
} from './ReactFiberViewTransitionComponent';

import {
  enableProfilerTimer,
  enableComponentPerformanceTrack,
  enableViewTransitionParentEnterExit,
} from 'shared/ReactFeatureFlags';
import {trackAnimatingTask} from './ReactProfilerTimer';
import {scheduleGestureTransitionEvent} from './ReactFiberWorkLoop';

// apply 阶段跟踪父 ViewTransition 是否可能受下层 mutation/relayout 影响。
let viewTransitionContextChanged: boolean = false;

/**
 * 判断 gesture snapshot 是否需构造目标 clone；当前实现保守始终克隆，预留后续 bailout。
 */
function detectMutationOrInsertClones(finishedWork: Fiber): boolean {
  return true;
}

/** clone 遍历处于更新子树或可能受布局影响。 */
const CLONE_UPDATE = 0;
/** clone 正重现被删除/离开的可见子树。 */
const CLONE_EXIT = 1; // 重现 Offscreen 内、尚未到下一 ViewTransition/HostComponent。
/** clone 正解除 Offscreen 隐藏，尚未到下一 HostComponent。 */
const CLONE_UNHIDE = 2; // 重现 Offscreen 内、尚未到下一 HostComponent。
/** 已进入首个宿主节点，只继续寻找 appearing share 配对。 */
const CLONE_APPEARING_PAIR = 3; // 已进入首个 HostComponent，只继续寻找 appearing pair。
/** 子树无 mutation，但仍需复制其既有宿主结构。 */
const CLONE_UNCHANGED = 4; // 子树未变化，但仍需遍历/克隆。
/** 新挂载树尚未进入首个边界/宿主节点，需建立 exit 视觉状态。 */
const INSERT_EXIT = 5; // 新挂载树内、尚未到下一 ViewTransition/HostComponent。
/** 新挂载树已进入边界，继续追加内部宿主节点。 */
const INSERT_APPEND = 6; // 新挂载树内、尚未到下一 HostComponent。
/** 新挂载树已进入宿主节点，只继续寻找 appearing share 配对。 */
const INSERT_APPEARING_PAIR = 7; // 新挂载树内仅寻找 appearing pair。
/** clone/insert 深度遍历的有限阶段机。 */
type VisitPhase = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * 为已建立配对的 clone 宿主实例应用唯一 transition 名称与 class，并归因动画 ConsoleTask。
 * 插入侧负责创建 clone；先访问删除侧还是插入侧只决定本函数何时被调用。
 */
function applyViewTransitionToClones(
  name: string,
  className: ?string,
  clones: Array<Instance>,
  fiber: Fiber,
): void {
  // 配对已找到且 clone 已由插入侧创建：插入侧先访问则删除侧调用，反之待插入侧稍后调用。
  for (let i = 0; i < clones.length; i++) {
    applyViewTransitionName(
      clones[i],
      i === 0
        ? name
        : // 多个宿主实例追加下标后缀，保证名称唯一。
          name + '_' + i,
      className,
    );
  }
  if (enableProfilerTimer && enableComponentPerformanceTrack) {
    if (fiber._debugTask != null) {
      trackAnimatingTask(fiber._debugTask);
    }
  }
}

/**
 * 在删除树中消费 appearingViewTransitions 同名配对，双向连接 ViewTransitionState；若插入
 * 侧 clone 已就绪则立即应用 share 名称，否则由插入遍历稍后补上。
 */
function trackDeletedPairViewTransitions(deletion: Fiber): void {
  if (
    appearingViewTransitions === null ||
    appearingViewTransitions.size === 0
  ) {
    // 所有新出现边界都已找到配对。
    return;
  }
  const pairs = appearingViewTransitions;
  if ((deletion.subtreeFlags & ViewTransitionNamedStatic) === NoFlags) {
    // 子树没有命名 ViewTransition。
    return;
  }
  let child = deletion.child;
  while (child !== null) {
    if (child.tag === OffscreenComponent && child.memoizedState !== null) {
      // 子树原本已隐藏，跳过。
    } else {
      if (
        child.tag === ViewTransitionComponent &&
        (child.flags & ViewTransitionNamedStatic) !== NoFlags
      ) {
        const props: ViewTransitionProps = child.memoizedProps;
        const name = props.name;
        if (name != null && name !== 'auto') {
          const pair = pairs.get(name);
          if (pair !== undefined) {
            // 消费条目；Map 清空即可停止搜索。
            pairs.delete(name);
            const className: ?string = getViewTransitionClassName(
              props.default,
              props.share,
            );
            if (className !== 'none') {
              // TODO：删除实例已有布局，可检查 viewport 后跳过屏外配对；但会导致 layout
              // thrash，需把 clone Root 插入延后到遍历末尾。

              // 反向 gesture 中“old”实际是将插入的一侧。
              const oldInstance: ViewTransitionState = pair;
              // “new”实际是已挂载、即将删除的一侧。
              const newInstance: ViewTransitionState = child.stateNode;
              oldInstance.paired = newInstance;
              newInstance.paired = oldInstance;
              const clones = oldInstance.clones;
              if (clones !== null) {
                // clone 已存在表示先访问过插入边界，可立即应用名称；否则等 clone 创建后补上。
                applyViewTransitionToClones(name, className, clones, child);
              }
            }
            if (pairs.size === 0) {
              break;
            }
          }
        }
      }
      trackDeletedPairViewTransitions(child);
    }
    child = child.sibling;
  }
}

/**
 * 为反向 gesture 扫描即将删除（视觉上进入）的 ViewTransition，并建立 share 配对；随后
 * 继续寻找更深命名边界。
 */
function trackEnterViewTransitions(deletion: Fiber): void {
  if (deletion.tag === ViewTransitionComponent) {
    const props: ViewTransitionProps = deletion.memoizedProps;
    const name = getViewTransitionName(props, deletion.stateNode);
    const pair =
      appearingViewTransitions !== null
        ? appearingViewTransitions.get(name)
        : undefined;
    const className: ?string = getViewTransitionClassName(
      props.default,
      pair !== undefined ? props.share : props.enter,
    );
    if (className !== 'none') {
      if (pair !== undefined) {
        // TODO：可用删除实例现有布局检查 viewport 并跳过屏外配对；为避免 layout thrash，
        // 需把 clone Root 插入延后到遍历末尾。

        // 消费条目；Map 清空即可停止搜索。
        // $FlowFixMe[incompatible-use]: Refined by the pair.
        appearingViewTransitions.delete(name);
        // 反向 gesture 中“old”实际是将插入的一侧。
        const oldInstance: ViewTransitionState = pair;
        // “new”实际是已挂载、即将删除的一侧。
        const newInstance: ViewTransitionState = deletion.stateNode;
        oldInstance.paired = newInstance;
        newInstance.paired = oldInstance;
        const clones = oldInstance.clones;
        if (clones !== null) {
          // clone 已存在表示先访问过插入边界，可立即应用名称；否则等 clone 创建后补上。
          applyViewTransitionToClones(name, className, clones, deletion);
        }
      }
    }
    // 继续寻找更深配对。
    trackDeletedPairViewTransitions(deletion);
  } else if ((deletion.subtreeFlags & ViewTransitionStatic) !== NoFlags) {
    let child = deletion.child;
    while (child !== null) {
      trackEnterViewTransitions(child);
      child = child.sibling;
    }
  } else {
    trackDeletedPairViewTransitions(deletion);
  }
}

/**
 * 对 clone 已收集完的 appearing 配对边界应用 share 名称并调度 onGestureShare。
 * 插入/Offscreen 遍历已分叉，因此由各循环显式调用而不在此递归。
 */
function applyAppearingPairViewTransition(child: Fiber): void {
  if ((child.flags & ViewTransitionNamedStatic) !== NoFlags) {
    const state: ViewTransitionState = child.stateNode;
    // 尚未配对不代表最终不会配对；找到删除侧时会再给 clone 应用名称。
    if (state.paired) {
      const props: ViewTransitionProps = child.memoizedProps;
      if (props.name == null || props.name === 'auto') {
        throw new Error(
          'Found a pair with an auto name. This is a bug in React.',
        );
      }
      const name = props.name;
      // 实际上“new”侧 className 最终胜出，此处值通常不影响结果。
      const className: ?string = getViewTransitionClassName(
        props.default,
        props.share,
      );
      if (className !== 'none') {
        const clones = state.clones;
        // 此时无 clone 表示该 ViewTransition 没有 HostComponent child。
        if (clones !== null) {
          applyViewTransitionToClones(name, className, clones, child);
        }
        scheduleGestureTransitionEvent(child, props.onGestureShare);
      }
    }
  }
}

/**
 * 对 clone 已收集完的反向 exit/共享边界应用名称，并调度 gesture exit/share 与 parentExit。
 */
function applyExitViewTransition(placement: Fiber): void {
  const state: ViewTransitionState = placement.stateNode;
  const props: ViewTransitionProps = placement.memoizedProps;
  const name = getViewTransitionName(props, state);
  const className: ?string = getViewTransitionClassName(
    props.default,
    // 当前无配对仍可能稍后找到；若找到，最终仍以“new”侧应用的 className 为准。
    state.paired ? props.share : props.exit,
  );
  if (className !== 'none') {
    // TODO：理想上应跳过 viewport 外 exit，但必须先插入并布局 clone；当前等宿主 View
    // Transition 启动后才读取布局。
    const clones = state.clones;
    // 此时无 clone 表示该 ViewTransition 没有 HostComponent child。
    if (clones !== null) {
      applyViewTransitionToClones(name, className, clones, placement);
    }
    if (state.paired) {
      scheduleGestureTransitionEvent(placement, props.onGestureShare);
    } else {
      scheduleGestureTransitionEvent(placement, props.onGestureExit);
      if (enableViewTransitionParentEnterExit) {
        commitParentExitViewTransitions(placement, true);
      }
    }
  }
}

/** 对未自身更新但受父布局影响的嵌套边界 clone 应用 update 名称/class。 */
function applyNestedViewTransition(child: Fiber): void {
  const state: ViewTransitionState = child.stateNode;
  const props: ViewTransitionProps = child.memoizedProps;
  const name = getViewTransitionName(props, state);
  const className: ?string = getViewTransitionClassName(
    props.default,
    props.update,
  );
  if (className !== 'none') {
    const clones = state.clones;
    // 此时无 clone 表示该 ViewTransition 没有 HostComponent child。
    if (clones !== null) {
      applyViewTransitionToClones(name, className, clones, child);
    }
  }
}

/**
 * 为反向 gesture 的更新边界 clone 应用名称。
 * 视觉“new”是 current、“old”是 finishedWork，因此 class 取 current props，保持正反方向
 * 动画效果一致。
 */
function applyUpdateViewTransition(current: Fiber, finishedWork: Fiber): void {
  const state: ViewTransitionState = finishedWork.stateNode;
  // 更新两侧可能有冲突名称/class；反向动画的“new”是 current，“old”是 finishedWork。
  const newProps: ViewTransitionProps = current.memoizedProps;
  const oldProps: ViewTransitionProps = finishedWork.memoizedProps;
  const oldName = getViewTransitionName(oldProps, state);
  // child DOM 减少，或父级动画迫使本应取消的 child 一起动画时才需此 class。通常“new”侧
  // 胜出；反向动画中 current 才是视觉 new，因此取 current props 维持方向对称。
  const className: ?string = getViewTransitionClassName(
    newProps.default,
    newProps.update,
  );
  if (className === 'none') {
    // update="none" 不动画该边界，无需应用名称。
    return;
  }
  const clones = state.clones;
  // 此时无 clone 表示该 ViewTransition 没有 HostComponent child。
  if (clones !== null) {
    applyViewTransitionToClones(oldName, className, clones, finishedWork);
  }
}

/**
 * 遍历全新挂载子树，把可见宿主节点插入 gesture clone，并继续寻找 appearing share 配对。
 */
function recursivelyInsertNew(
  parentFiber: Fiber,
  hostParentClone: Instance,
  parentViewTransition: null | ViewTransitionState,
  visitPhase: VisitPhase,
): void {
  if (
    visitPhase === INSERT_APPEARING_PAIR &&
    parentViewTransition === null &&
    (parentFiber.subtreeFlags & (ViewTransitionNamedStatic | Placement)) ===
      NoFlags
  ) {
    // 当前只搜索配对或 insertion effect；子树已无命名边界/新放置节点，可直接结束。
    return;
  }
  let child = parentFiber.child;
  while (child !== null) {
    recursivelyInsertNewFiber(
      child,
      hostParentClone,
      parentViewTransition,
      visitPhase,
    );
    child = child.sibling;
  }
}

/**
 * 按 Fiber tag 处理全新节点：临时挂载 insertion effect、插入宿主实例，并在边界末尾
 * 应用 exit/share gesture 名称。
 * finishedWork 没有 alternate，宿主 stateNode 直接用于目标 snapshot，不再 clone。
 * hostParentClone 是视觉目标容器；parentViewTransition 只收集该边界第一层宿主实例，
 * 进入宿主节点后传 null，嵌套边界重新接管。visitPhase 区分建立 exit 状态与仅找 share 配对。
 */
function recursivelyInsertNewFiber(
  finishedWork: Fiber,
  hostParentClone: Instance,
  parentViewTransition: null | ViewTransitionState,
  visitPhase: VisitPhase,
): void {
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case MemoComponent:
    case SimpleMemoComponent: {
      recursivelyInsertNew(
        finishedWork,
        hostParentClone,
        parentViewTransition,
        visitPhase,
      );
      if (finishedWork.flags & Update) {
        // 渲染 snapshot 时临时挂载 Insertion Effect。克隆的 Offscreen 内容此前已在
        // Offscreen 树中挂载，不受此步骤影响。旧 DOM 在 snapshot 期间仍保留，因而不能
        // 卸载旧 insertion effect；可能产生的冲突与同时挂载两个 Activity 边界相似。
        commitHookEffectListMount(HookInsertion | HookHasEffect, finishedWork);
      }
      break;
    }
    case HostHoistable: {
      // $FlowFixMe[constant-condition]
      if (supportsResources) {
        // TODO：Hoistable 应先乐观插入，再于恢复阶段移除。
        recursivelyInsertNew(
          finishedWork,
          hostParentClone,
          parentViewTransition,
          visitPhase,
        );
        break;
      }
      // 继续落入 HostSingleton/HostComponent 处理。
    }
    case HostSingleton: {
      // $FlowFixMe[constant-condition]
      if (supportsSingletons) {
        recursivelyInsertNew(
          finishedWork,
          hostParentClone,
          parentViewTransition,
          visitPhase,
        );

        if (__DEV__) {
          // Host Singleton 按定义不可克隆，所以不能向其应用 mutation；若本次提交确有
          // 影响，在开发模式发出警告。
          if (finishedWork.flags & Update) {
            console.error(
              'startGestureTransition() caused something to render a new <%s>. ' +
                'This is not possible in the current implementation. ' +
                "Make sure that the swipe doesn't mount any new <%s> elements.",
              finishedWork.type,
              finishedWork.type,
            );
          }
        }
        break;
      }
      // 继续落入 HostComponent 处理。
    }
    case HostComponent: {
      const instance: Instance = finishedWork.stateNode;
      // 插入节点本身就是新 stateNode，无需再次克隆。
      if (visitPhase !== INSERT_APPEARING_PAIR) {
        appendChild(hostParentClone, instance);
        trackHostMutation();
        recursivelyInsertNew(
          finishedWork,
          instance,
          null,
          INSERT_APPEARING_PAIR,
        );
      } else {
        recursivelyInsertNew(finishedWork, instance, null, visitPhase);
      }
      if (parentViewTransition !== null) {
        if (parentViewTransition.clones === null) {
          parentViewTransition.clones = [instance];
        } else {
          parentViewTransition.clones.push(instance);
        }
      }
      break;
    }
    case HostText: {
      const textInstance: TextInstance = finishedWork.stateNode;
      // $FlowFixMe[invalid-compare]
      if (textInstance === null) {
        throw new Error(
          'This should have a text node initialized. This error is likely ' +
            'caused by a bug in React. Please file an issue.',
        );
      }
      // 插入文本本身就是新 stateNode，无需再次克隆。
      if (visitPhase !== INSERT_APPEARING_PAIR) {
        appendChild(hostParentClone, textInstance);
        trackHostMutation();
      }
      break;
    }
    case HostPortal: {
      // TODO：确定 Portal 的跨容器语义；当前先排除。
      break;
    }
    case OffscreenComponent: {
      const newState: OffscreenState | null = finishedWork.memoizedState;
      const isHidden = newState !== null;
      if (!isHidden) {
        // 只插入即将可见的树；不可见内容无需进入 clone。此节点没有 mutation，visibility
        // 不可能改变，因此无需调整 visitPhase。
        recursivelyInsertNew(
          finishedWork,
          hostParentClone,
          parentViewTransition,
          visitPhase,
        );
      }
      break;
    }
    case ViewTransitionComponent:
      const prevMutationContext = pushMutationContext();
      const viewTransitionState: ViewTransitionState = finishedWork.stateNode;
      // TODO：若前一遍已克隆该边界，可复用其 clones。
      viewTransitionState.clones = null;
      let nextPhase: VisitPhase;
      if (visitPhase === INSERT_EXIT) {
        // 这是 ViewTransition 的 Enter；下一阶段插入内部 HostComponent 并寻找内层配对。
        nextPhase = INSERT_APPEND;
      } else {
        nextPhase = visitPhase;
      }
      recursivelyInsertNew(
        finishedWork,
        hostParentClone,
        viewTransitionState,
        nextPhase,
      );
      // 新节点收集进 clones 后，才能向它们应用 share 或 exit transition。
      if (visitPhase === INSERT_EXIT) {
        applyExitViewTransition(finishedWork);
      } else if (
        visitPhase === INSERT_APPEARING_PAIR ||
        visitPhase === INSERT_APPEND
      ) {
        applyAppearingPairViewTransition(finishedWork);
      }
      popMutationContext(prevMutationContext);
      break;
    default: {
      recursivelyInsertNew(
        finishedWork,
        hostParentClone,
        parentViewTransition,
        visitPhase,
      );
      break;
    }
  }
}

/**
 * 在无 reconciliation mutation 的既有子树中构造 clone：需要继续找边界时浅克隆，否则
 * 深克隆并提前退出；同时收集边界宿主实例。
 * 当前函数访问的 child 可直接来自 current 树；为了后续布局测量，会清理其 ViewTransition
 * Update 标志并重建临时 clones。深 clone 省去逐 Fiber 遍历，但当前仍未迁移滚动位置。
 */
function recursivelyInsertClonesFromExistingTree(
  parentFiber: Fiber,
  hostParentClone: Instance,
  parentViewTransition: null | ViewTransitionState,
  visitPhase: VisitPhase,
): void {
  let child = parentFiber.child;
  while (child !== null) {
    switch (child.tag) {
      case HostComponent: {
        const instance: Instance = child.stateNode;
        let nextPhase: VisitPhase;
        switch (visitPhase) {
          case CLONE_EXIT:
          case CLONE_UNHIDE:
          case CLONE_APPEARING_PAIR:
            // unhide 时若子树仍有命名配对，必须继续深入以便给它们标记名称。
            nextPhase =
              (child.subtreeFlags & ViewTransitionNamedStatic) !== NoFlags
                ? CLONE_APPEARING_PAIR
                : CLONE_UNCHANGED;
            break;
          default:
            // 此时已找到所有 layout ViewTransition，可停止深入。
            nextPhase = CLONE_UNCHANGED;
        }
        let clone: Instance;
        if (nextPhase !== CLONE_UNCHANGED) {
          // 后续可能需要直接操作这些 clone，因此做浅克隆并继续遍历。
          clone = cloneMutableInstance(instance, false);
          recursivelyInsertClonesFromExistingTree(
            child,
            clone,
            null,
            nextPhase,
          );
        } else {
          // 子树无 mutation 且无需持有 clone 引用时，可直接深克隆并提前退出。
          clone = cloneMutableInstance(instance, true);
          // TODO：深克隆可能还需迁移滚动位置等 DOM 状态。
          // TODO：若 clone 内有手写 view-transition-name，理想上应先从原节点移除并在
          // mutation 阶段恢复，否则会产生重名。
        }
        appendChild(hostParentClone, clone);
        if (parentViewTransition !== null) {
          if (parentViewTransition.clones === null) {
            parentViewTransition.clones = [clone];
          } else {
            parentViewTransition.clones.push(clone);
          }
        }
        if (visitPhase === CLONE_EXIT || visitPhase === CLONE_UNHIDE) {
          unhideInstance(clone, child.memoizedProps);
          trackHostMutation();
        }
        break;
      }
      case HostText: {
        const textInstance: TextInstance = child.stateNode;
        // $FlowFixMe[invalid-compare]
        if (textInstance === null) {
          throw new Error(
            'This should have a text node initialized. This error is likely ' +
              'caused by a bug in React. Please file an issue.',
          );
        }
        const clone = cloneMutableTextInstance(textInstance);
        appendChild(hostParentClone, clone);
        if (visitPhase === CLONE_EXIT || visitPhase === CLONE_UNHIDE) {
          unhideTextInstance(clone, child.memoizedProps);
          trackHostMutation();
        }
        break;
      }
      case HostPortal: {
        // TODO：确定 Portal 的跨容器语义；当前先排除。
        break;
      }
      case OffscreenComponent: {
        const newState: OffscreenState | null = child.memoizedState;
        const isHidden = newState !== null;
        if (!isHidden) {
          // 只为即将可见的树插入 clone；不可见内容无需克隆。
          // TODO：可见但 detached 的树仍应克隆。
          // 此节点无 mutation，visibility 不可能变化，因此无需调整 visitPhase。
          recursivelyInsertClonesFromExistingTree(
            child,
            hostParentClone,
            parentViewTransition,
            visitPhase,
          );
        }
        break;
      }
      case ViewTransitionComponent:
        const prevMutationContext = pushMutationContext();
        const viewTransitionState: ViewTransitionState = child.stateNode;
        // TODO：若前一遍已克隆该边界，可复用其 clones。
        viewTransitionState.clones = null;
        // “既有”边界位于未更新子树，child 因而属于 current。Update 通常在重新渲染时
        // 清除，但提交阶段还要借它跟踪布局变化，所以测量前先手动清除。
        // TODO：改用独立临时状态跟踪该信息。
        child.flags &= ~Update;
        let nextPhase: VisitPhase;
        if (visitPhase === CLONE_EXIT) {
          // 这是 ViewTransition 的 Enter；下一阶段解除内部 HostComponent 隐藏并找配对。
          nextPhase = CLONE_UNHIDE;
          // TODO：标记名称并寻找配对。
        } else if (visitPhase === CLONE_UPDATE) {
          // 若树没有 mutation，最外层 ViewTransition 就是位置变化时可能接收 layout 状态的
          // 边界；找到其 HostComponent 后即可停止深入。
          nextPhase = CLONE_UNCHANGED;
        } else {
          nextPhase = visitPhase;
        }
        recursivelyInsertClonesFromExistingTree(
          child,
          hostParentClone,
          viewTransitionState,
          nextPhase,
        );
        // 收集完 clone 实例后，才可向其应用 exit/share transition。
        if (visitPhase === CLONE_EXIT) {
          applyExitViewTransition(child);
        } else if (
          visitPhase === CLONE_APPEARING_PAIR ||
          visitPhase === CLONE_UNHIDE
        ) {
          applyAppearingPairViewTransition(child);
        } else if (visitPhase === CLONE_UPDATE) {
          applyNestedViewTransition(child);
        }
        popMutationContext(prevMutationContext);
        break;
      default: {
        recursivelyInsertClonesFromExistingTree(
          child,
          hostParentClone,
          parentViewTransition,
          visitPhase,
        );
        break;
      }
    }
    child = child.sibling;
  }
}

/**
 * 遍历发生 mutation/placement 的子树，将目标状态逐 Fiber 克隆；若子树稳定则切换到
 * 既有树深克隆快路径。
 */
function recursivelyInsertClones(
  parentFiber: Fiber,
  hostParentClone: Instance,
  parentViewTransition: null | ViewTransitionState,
  visitPhase: VisitPhase,
) {
  const deletions = parentFiber.deletions;
  if (deletions !== null) {
    for (let i = 0; i < deletions.length; i++) {
      const childToDelete = deletions[i];
      trackEnterViewTransitions(childToDelete);
      // 理论上只有下方确有 HostInstance 才应标记 mutation；纯虚拟组件删除不应触发。
      // 当前保守标记，避免漏掉删除树中的宿主影响。
      trackHostMutation();
    }
  }

  if (
    parentFiber.alternate === null ||
    (parentFiber.subtreeFlags & MutationMask) !== NoFlags
  ) {
    // 有 mutation 或属于新插入树时，沿遍历逐节点克隆。
    let child = parentFiber.child;
    while (child !== null) {
      insertDestinationClonesOfFiber(
        child,
        hostParentClone,
        parentViewTransition,
        visitPhase,
      );
      child = child.sibling;
    }
  } else {
    // 到达无更多 mutation 的子树即可停止逐节点处理，但仍须插入 HostComponent 深克隆。
    recursivelyInsertClonesFromExistingTree(
      parentFiber,
      hostParentClone,
      parentViewTransition,
      visitPhase,
    );
  }
}

/**
 * 将单个 finished Fiber 的目标视觉状态写入 clone：应用属性/文本 delta、可见性变化，
 * 并在 ViewTransition 边界收集 clone 与选择 exit/share/update。
 * current 是 alternate，但 gesture 的视觉 old 是目标 finished clone、视觉 new 是仍挂载
 * 的 current；因此下方 enter/exit 配对和普通提交方向相反。该遍不提交类生命周期/layout effect，
 * 新组件只临时运行 insertion effect，snapshot 捕获后再撤销。
 */
function insertDestinationClonesOfFiber(
  finishedWork: Fiber,
  hostParentClone: Instance,
  parentViewTransition: null | ViewTransitionState,
  visitPhase: VisitPhase,
) {
  const current = finishedWork.alternate;
  if (current === null) {
    // 新挂载子树：插入其 HostComponent，并触发反向方向的 Enter/exit 处理。
    recursivelyInsertNewFiber(
      finishedWork,
      hostParentClone,
      parentViewTransition,
      INSERT_EXIT,
    );
    return;
  }

  const flags = finishedWork.flags;
  // 先按 tag 缩窄 Fiber 类型，再检查 effect flag；reconciliation 类 flag 可出现在任意
  // Fiber，属于例外。
  switch (finishedWork.tag) {
    case HostHoistable: {
      // $FlowFixMe[constant-condition]
      if (supportsResources) {
        // TODO：Hoistable 应先乐观插入，再于恢复阶段移除。
        recursivelyInsertClones(
          finishedWork,
          hostParentClone,
          parentViewTransition,
          visitPhase,
        );
        break;
      }
      // 继续落入 HostSingleton/HostComponent 处理。
    }
    case HostSingleton: {
      // $FlowFixMe[constant-condition]
      if (supportsSingletons) {
        recursivelyInsertClones(
          finishedWork,
          hostParentClone,
          parentViewTransition,
          visitPhase,
        );
        if (__DEV__) {
          // Host Singleton 按定义不可克隆，所以无法向其应用 mutation；若本次提交确有
          // 影响，在开发模式发出警告。
          if (flags & Update) {
            const newProps = finishedWork.memoizedProps;
            const oldProps = current.memoizedProps;
            const instance = finishedWork.stateNode;
            const type = finishedWork.type;
            const prev = pushMutationContext();

            try {
              // 当前没有逐属性独立 diff，Update 可能是假阳性；先临时应用新 props 检测
              // 是否真实 mutation，再恢复旧值。
              commitUpdate(instance, type, oldProps, newProps, finishedWork);
              if (viewTransitionMutationContext) {
                console.error(
                  'startGestureTransition() caused something to mutate <%s>. ' +
                    'This is not possible in the current implementation. ' +
                    "Make sure that the swipe doesn't update any state which " +
                    'causes <%s> to change.',
                  finishedWork.type,
                  finishedWork.type,
                );
              }
              // 恢复原 props，避免测量阶段污染真实 singleton。
              commitUpdate(instance, type, newProps, oldProps, finishedWork);
            } finally {
              popMutationContext(prev);
            }
          }
        }
        break;
      }
      // 继续落入 HostComponent 处理。
    }
    case HostComponent: {
      const instance: Instance = finishedWork.stateNode;
      let clone: Instance;
      if (finishedWork.child === null) {
        // 叶宿主节点仍做深克隆，以保留用户插入内容、文本或 dangerouslySetInnerHTML。
        clone = cloneMutableInstance(instance, true);
        if (finishedWork.flags & ContentReset) {
          resetTextContent(clone);
          trackHostMutation();
        }
      } else {
        // 有 child 时后续会逐层克隆，当前只需浅克隆。
        clone = cloneMutableInstance(instance, false);
      }

      if (flags & Update) {
        const newProps = finishedWork.memoizedProps;
        const oldProps = current.memoizedProps;
        const type = finishedWork.type;
        // 把 current→finished 的属性 delta 应用到 clone。
        commitUpdate(clone, type, oldProps, newProps, finishedWork);
      }

      if (visitPhase === CLONE_EXIT || visitPhase === CLONE_UNHIDE) {
        appendChild(hostParentClone, clone);
        unhideInstance(clone, finishedWork.memoizedProps);
        recursivelyInsertClones(
          finishedWork,
          clone,
          null,
          CLONE_APPEARING_PAIR,
        );
        trackHostMutation();
      } else {
        appendChild(hostParentClone, clone);
        recursivelyInsertClones(finishedWork, clone, null, visitPhase);
      }
      if (parentViewTransition !== null) {
        if (parentViewTransition.clones === null) {
          parentViewTransition.clones = [clone];
        } else {
          parentViewTransition.clones.push(clone);
        }
      }
      break;
    }
    case HostText: {
      const textInstance: TextInstance = finishedWork.stateNode;
      // $FlowFixMe[invalid-compare]
      if (textInstance === null) {
        throw new Error(
          'This should have a text node initialized. This error is likely ' +
            'caused by a bug in React. Please file an issue.',
        );
      }
      const clone = cloneMutableTextInstance(textInstance);
      if (flags & Update) {
        const newText: string = finishedWork.memoizedProps;
        const oldText: string = current.memoizedProps;
        // 此调用实际按 finishedText、currentText 传入；普通提交接口按 oldText、newText 使用。
        // DOM HostConfig 只把第三实参 currentText 写入 nodeValue。若下方进入 CLONE_EXIT/
        // CLONE_UNHIDE，unhideTextInstance 会再写 finishedText；其它 phase 没有这次覆盖。
        commitTextUpdate(clone, newText, oldText);
        trackHostMutation();
      }
      appendChild(hostParentClone, clone);
      if (visitPhase === CLONE_EXIT || visitPhase === CLONE_UNHIDE) {
        unhideTextInstance(clone, finishedWork.memoizedProps);
        trackHostMutation();
      }
      break;
    }
    case HostPortal: {
      // TODO：确定 Portal 的跨容器语义；当前先排除。
      break;
    }
    case OffscreenComponent: {
      const newState: OffscreenState | null = finishedWork.memoizedState;
      const isHidden = newState !== null;
      if (!isHidden) {
        // 只为即将可见的树插入 clone；不可见内容无需克隆。
        // TODO：可见但 detached 的树仍应克隆。
        let nextPhase: VisitPhase;
        if (visitPhase === CLONE_UPDATE && (flags & Visibility) !== NoFlags) {
          // 这是重新出现子树的根，需要触发 Enter transition。
          nextPhase = CLONE_EXIT;
        } else {
          nextPhase = visitPhase;
        }
        recursivelyInsertClones(
          finishedWork,
          hostParentClone,
          parentViewTransition,
          nextPhase,
        );
        // $FlowFixMe[invalid-compare]
      } else if (current !== null && current.memoizedState === null) {
        // 从已挂载可见变为隐藏；current 在反向 gesture 中属于视觉进入侧。
        trackEnterViewTransitions(current);
        // 理论上只有下方确有 HostInstance 才应标记 mutation；纯虚拟组件隐藏不应触发。
        // 当前保守标记，避免漏掉宿主可见性影响。
        trackHostMutation();
      }
      break;
    }
    case ViewTransitionComponent:
      const prevMutationContext = pushMutationContext();
      const viewTransitionState: ViewTransitionState = finishedWork.stateNode;
      // TODO：若前一遍已克隆该边界，可复用其 clones。
      viewTransitionState.clones = null;
      let nextPhase: VisitPhase;
      if (visitPhase === CLONE_EXIT) {
        // 这是 ViewTransition 的 Enter；下一阶段解除内部 HostComponent 隐藏并找配对。
        nextPhase = CLONE_UNHIDE;
        // TODO：标记名称并寻找配对。
      } else {
        nextPhase = visitPhase;
      }
      recursivelyInsertClones(
        finishedWork,
        hostParentClone,
        viewTransitionState,
        nextPhase,
      );
      if (viewTransitionMutationContext) {
        // 记录该边界发生过 mutation；无论尺寸是否变化都需要动画。
        finishedWork.flags |= Update;
      }
      // 收集完 clone 实例后，才可向其应用 exit/share/update transition。
      if (visitPhase === CLONE_EXIT) {
        applyExitViewTransition(finishedWork);
      } else if (
        visitPhase === CLONE_APPEARING_PAIR ||
        visitPhase === CLONE_UNHIDE
      ) {
        applyAppearingPairViewTransition(finishedWork);
      } else if (visitPhase === CLONE_UPDATE) {
        applyUpdateViewTransition(current, finishedWork);
      }
      popMutationContext(prevMutationContext);
      break;
    default: {
      recursivelyInsertClones(
        finishedWork,
        hostParentClone,
        parentViewTransition,
        visitPhase,
      );
      break;
    }
  }
}

/**
 * 克隆发生 mutation 或可能受子级插入影响布局的 ViewTransition 边界，并挂到 root，供
 * gesture snapshot/反向动画使用。
 * detectMutationOrInsertClones 当前恒为 true，因此每次都创建根 clone 并保存 gestureClone，
 * 没有稳定树不克隆的实际快路径。此遍同步修改 snapshot 宿主树，等待/动画生命周期由 WorkLoop 管理。
 */
export function insertDestinationClones(
  root: FiberRoot,
  finishedWork: Fiber,
): void {
  // 根要么不参与 transition，要么由 clone 参与；两种情况都先取消真实根的名称。
  const needsClone = detectMutationOrInsertClones(finishedWork);
  if (needsClone) {
    // 从整个根容器构造目标视觉 clone。
    const rootClone = cloneRootViewTransitionContainer(root.containerInfo);
    root.gestureClone = rootClone;
    recursivelyInsertClones(finishedWork, rootClone, null, CLONE_UPDATE);
  } else {
    root.gestureClone = null;
    cancelRootViewTransitionName(root.containerInfo);
  }
}

/**
 * 扫描新放置子树中的命名边界，为后续 exit/share 测量寻找配对；当前配对测量仍为占位。
 */
function measureExitViewTransitions(placement: Fiber): void {
  if (placement.tag === ViewTransitionComponent) {
    // const state: ViewTransitionState = placement.stateNode;
    const props: ViewTransitionProps = placement.memoizedProps;
    const name = props.name;
    if (name != null && name !== 'auto') {
      // TODO：寻找并测量同名配对。
    }
  } else if ((placement.subtreeFlags & ViewTransitionStatic) !== NoFlags) {
    // TODO：下钻前识别隐藏 Offscreen 与 Portal。
    let child = placement.child;
    while (child !== null) {
      measureExitViewTransitions(child);
      child = child.sibling;
    }
  } else {
    // 此分支的配对已在 deletion 阶段找到并测量，无需重复搜索。
  }
}

/**
 * snapshot 捕获完新插入视觉状态后，卸载此前临时挂载的 insertion effect，恢复动画启动前
 * 的真实 effect 状态。
 */
function recursivelyRestoreNew(
  finishedWork: Fiber,
  nearestMountedAncestor: Fiber,
): void {
  // 下方只要涉及 Placement 或 Update 就进入遍历；真正卸载仅针对无 alternate 且有 Update
  // 的函数组件。这里仅处理新组件的
  // insertion effect。
  if (((Placement | Update) & finishedWork.subtreeFlags) !== NoFlags) {
    let child = finishedWork.child;
    while (child !== null) {
      recursivelyRestoreNew(child, nearestMountedAncestor);
      child = child.sibling;
    }
  }
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case MemoComponent:
    case SimpleMemoComponent: {
      const current = finishedWork.alternate;
      if (current === null && finishedWork.flags & Update) {
        // Insertion Effect 只在 snapshot 渲染时临时挂载；捕获插入状态后即可卸载，恢复到
        // 动画开始前的原状态。
        commitHookEffectListUnmount(
          HookInsertion | HookHasEffect,
          finishedWork,
          nearestMountedAncestor,
        );
      }
      break;
    }
  }
}

/**
 * 在 clone 已捕获后遍历真实 finished 树：提交删除侧 enter、测量更新/嵌套边界，并撤销
 * 新节点的临时 insertion effect。
 */
function recursivelyApplyViewTransitions(parentFiber: Fiber) {
  const deletions = parentFiber.deletions;
  if (deletions !== null) {
    for (let i = 0; i < deletions.length; i++) {
      const childToDelete = deletions[i];
      commitEnterViewTransitions(childToDelete, true);
    }
  }

  if (
    parentFiber.alternate === null ||
    (parentFiber.subtreeFlags & MutationMask) !== NoFlags
  ) {
    // 有 mutation 或属于新插入树时，逐 Fiber 判断放置、更新与可见性变化。
    let child = parentFiber.child;
    while (child !== null) {
      const current = child.alternate;
      if (current === null) {
        measureExitViewTransitions(child);
        recursivelyRestoreNew(child, parentFiber);
      } else {
        applyViewTransitionsOnFiber(child, current);
      }
      child = child.sibling;
    }
  } else {
    // 子树自身未变化，但父级仍可能改变其尺寸/位置；测量 old/new 状态决定是否做布局动画。
    measureNestedViewTransitions(parentFiber, true);
  }
}

/**
 * 对单个已有 Fiber 应用反向 gesture 的测量与事件：处理 Offscreen 可见性，并在
 * ViewTransition 边界决定更新动画、取消候选及布局影响冒泡。
 */
function applyViewTransitionsOnFiber(finishedWork: Fiber, current: Fiber) {
  // 先按 tag 缩窄 Fiber 类型，再检查 effect flag；reconciliation 类 flag 可出现在任意
  // Fiber，属于例外。
  switch (finishedWork.tag) {
    case HostPortal: {
      // TODO：确定 Portal 的跨容器语义；当前先排除。
      break;
    }
    case OffscreenComponent: {
      const newState: OffscreenState | null = finishedWork.memoizedState;
      const isHidden = newState !== null;
      const wasHidden = current.memoizedState !== null;
      if (!isHidden) {
        if (wasHidden) {
          measureExitViewTransitions(finishedWork);
          recursivelyRestoreNew(finishedWork, finishedWork);
        } else {
          recursivelyApplyViewTransitions(finishedWork);
        }
      } else {
        if (!wasHidden) {
          // 从已挂载可见变为隐藏；对 current 提交视觉进入侧 transition。
          commitEnterViewTransitions(current, true);
        }
      }
      break;
    }
    case ViewTransitionComponent: {
      const prevContextChanged = viewTransitionContextChanged;
      const prevCancelableChildren = pushViewTransitionCancelableScope();
      viewTransitionContextChanged = false;
      recursivelyApplyViewTransitions(finishedWork);

      if (viewTransitionContextChanged) {
        finishedWork.flags |= Update;
      }

      const inViewport = measureUpdateViewTransition(
        current,
        finishedWork,
        true,
      );

      if ((finishedWork.flags & Update) === NoFlags || !inViewport) {
        // 边界未更新时其 child 可能可取消，先冒泡到父集合统一裁决；old/new 都在 viewport
        // 外时，即使更新也可跳过。
        if (prevCancelableChildren === null) {
          // 当前集合已直接作为父级可取消集合，无需合并。
        } else {
          // 把当前可取消候选合并进父集合。
          // $FlowFixMe[method-unbinding]
          prevCancelableChildren.push.apply(
            prevCancelableChildren,
            viewTransitionCancelableChildren,
          );
          popViewTransitionCancelableScope(prevCancelableChildren);
        }
        // TODO：若因父级动画而最终未取消，应为参与动画的本实例补发事件。
      } else {
        const props: ViewTransitionProps = finishedWork.memoizedProps;
        scheduleGestureTransitionEvent(finishedWork, props.onGestureUpdate);
        // 边界确实更新时不能取消其 child，丢弃该层候选集合。
        popViewTransitionCancelableScope(prevCancelableChildren);
      }

      if ((finishedWork.flags & AffectedParentLayout) !== NoFlags) {
        // 边界尺寸变化可能让父级重新布局，把此信息向上冒泡。
        viewTransitionContextChanged = true;
      } else {
        // 否则恢复进入边界前父级已累计的布局变化状态。
        viewTransitionContextChanged = prevContextChanged;
      }

      const viewTransitionState: ViewTransitionState = finishedWork.stateNode;
      viewTransitionState.clones = null; // clone 只服务本次 gesture，测量后释放。
      break;
    }
    default: {
      recursivelyApplyViewTransitions(finishedWork);
      break;
    }
  }
}

/**
 * 撤销 snapshot 插入状态并向视觉“new”（current）应用 transition 名称；随后移除根 clone，
 * 若布局影响未泄漏到根则取消可省略的 child/root transition。
 * 先测量再移除 clone，防止目标视觉状态消失后测量失真；取消集合以实例/名称/props 三槽
 * 一组保存。gestureClone 在宿主移除前置 null，此函数没有局部回滚或 finally 清理。
 */
export function applyDepartureTransitions(
  root: FiberRoot,
  finishedWork: Fiber,
): void {
  // 先测量视觉 new 状态，并向其应用 view-transition-name。
  viewTransitionContextChanged = false;
  pushViewTransitionCancelableScope();

  recursivelyApplyViewTransitions(finishedWork);

  // 测量完成后移除临时根 clone。
  const rootClone = root.gestureClone;
  if (rootClone !== null) {
    root.gestureClone = null;
    removeRootViewTransitionClone(root.containerInfo, rootClone);
  }

  if (!viewTransitionContextChanged) {
    // 尺寸变化未泄漏到根时，根无需参与 transition，可安全执行一路冒泡到顶的取消候选。
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
    // 根本身也取消：先把名称恢复到 documentElement，再清除 transition 名称。
    restoreRootViewTransitionName(root.containerInfo);
    cancelRootViewTransitionName(root.containerInfo);
  }
  popViewTransitionCancelableScope(null);
}

/**
 * 动画启动前递归恢复真实树上的 enter/exit/update 名称；稳定子树走嵌套恢复快路径。
 */
function recursivelyRestoreViewTransitions(parentFiber: Fiber) {
  const deletions = parentFiber.deletions;
  if (deletions !== null) {
    for (let i = 0; i < deletions.length; i++) {
      const childToDelete = deletions[i];
      restoreEnterOrExitViewTransitions(childToDelete);
    }
  }

  if (
    parentFiber.alternate === null ||
    (parentFiber.subtreeFlags & MutationMask) !== NoFlags
  ) {
    // 有 mutation 或属于新插入树时，逐 Fiber 恢复。
    let child = parentFiber.child;
    while (child !== null) {
      restoreViewTransitionsOnFiber(child);
      child = child.sibling;
    }
  } else {
    // 子树自身未变化但可能受父布局影响，交给嵌套边界恢复逻辑。
    restoreNestedViewTransitions(parentFiber);
  }
}

/**
 * 恢复单个 Fiber 的 gesture transition 状态：新节点恢复 enter/exit，Offscreen 按可见性
 * 选择一侧，更新边界恢复其名称后继续深入。
 */
function restoreViewTransitionsOnFiber(finishedWork: Fiber) {
  const current = finishedWork.alternate;
  if (current === null) {
    restoreEnterOrExitViewTransitions(finishedWork);
    return;
  }

  const flags = finishedWork.flags;
  // 先按 tag 缩窄 Fiber 类型，再检查 effect flag；reconciliation 类 flag 可出现在任意
  // Fiber，属于例外。
  switch (finishedWork.tag) {
    case HostPortal: {
      // TODO：确定 Portal 的跨容器语义；当前先排除。
      break;
    }
    case OffscreenComponent: {
      if (flags & Visibility) {
        const newState: OffscreenState | null = finishedWork.memoizedState;
        const isHidden = newState !== null;
        if (!isHidden) {
          restoreEnterOrExitViewTransitions(finishedWork);
          // $FlowFixMe[invalid-compare]
        } else if (current !== null && current.memoizedState === null) {
          // 从已挂载可见变为隐藏，恢复 current 一侧的 enter/exit 名称。
          restoreEnterOrExitViewTransitions(current);
        }
      }
      break;
    }
    case ViewTransitionComponent:
      restoreUpdateViewTransitionForGesture(current, finishedWork);
      recursivelyRestoreViewTransitions(finishedWork);
      break;
    default: {
      recursivelyRestoreViewTransitions(finishedWork);
      break;
    }
  }
}

/**
 * 在宿主 ViewTransition 已启动后恢复真实树与根容器名称，从而启动或校准 gesture 动画。
 * 此入口只恢复用于捕获 snapshot 的名称，不调用用户 gesture 回调或返回其 cleanup；
 * 事件队列在 WorkLoop 的后续 gesture 动画阶段执行。
 */
export function startGestureAnimations(
  root: FiberRoot,
  finishedWork: Fiber,
): void {
  restoreViewTransitionsOnFiber(finishedWork);
  restoreRootViewTransitionName(root.containerInfo);
}
