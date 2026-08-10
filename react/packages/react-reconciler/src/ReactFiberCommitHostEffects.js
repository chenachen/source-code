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
  ChildSet,
  FragmentInstanceType,
} from './ReactFiberConfig';
import type {Fiber, FiberRoot} from './ReactInternalTypes';

import {
  HostRoot,
  HostComponent,
  HostHoistable,
  HostSingleton,
  HostText,
  HostPortal,
  DehydratedFragment,
  Fragment,
} from './ReactWorkTags';
import {ContentReset, Placement} from './ReactFiberFlags';
import {
  supportsMutation,
  supportsResources,
  supportsSingletons,
  commitMount,
  commitUpdate,
  resetTextContent,
  commitTextUpdate,
  appendChild,
  appendChildToContainer,
  insertBefore,
  insertInContainerBefore,
  replaceContainerChildren,
  hideDehydratedBoundary,
  hideInstance,
  hideTextInstance,
  unhideDehydratedBoundary,
  unhideInstance,
  unhideTextInstance,
  commitHydratedInstance,
  commitHydratedContainer,
  commitHydratedActivityInstance,
  commitHydratedSuspenseInstance,
  removeChildFromContainer,
  removeChild,
  acquireSingletonInstance,
  releaseSingletonInstance,
  isSingletonScope,
  commitNewChildToFragmentInstance,
  deleteChildFromFragmentInstance,
} from './ReactFiberConfig';
import {captureCommitPhaseError} from './ReactFiberWorkLoop';
import {trackHostMutation} from './ReactFiberMutationTracking';

import {runWithFiberInDEV} from './ReactCurrentFiber';
import {
  enableFragmentRefs,
  enableFragmentRefsTextNodes,
} from 'shared/ReactFeatureFlags';

/** 调用 HostConfig commitMount 完成仅挂载时需要的宿主副作用，并捕获提交阶段错误。 */
export function commitHostMount(finishedWork: Fiber) {
  const type = finishedWork.type;
  const props = finishedWork.memoizedProps;
  const instance: Instance = finishedWork.stateNode;
  try {
    if (__DEV__) {
      runWithFiberInDEV(
        finishedWork,
        commitMount,
        instance,
        type,
        props,
        finishedWork,
      );
    } else {
      commitMount(instance, type, props, finishedWork);
    }
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

/** 通知 HostConfig 某宿主实例已完成 hydration，供事件/属性等宿主状态收尾。 */
export function commitHostHydratedInstance(finishedWork: Fiber) {
  const type = finishedWork.type;
  const props = finishedWork.memoizedProps;
  const instance: Instance = finishedWork.stateNode;
  try {
    if (__DEV__) {
      runWithFiberInDEV(
        finishedWork,
        commitHydratedInstance,
        instance,
        type,
        props,
        finishedWork,
      );
    } else {
      commitHydratedInstance(instance, type, props, finishedWork);
    }
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

/**
 * 把宿主组件 oldProps/newProps 交给 HostConfig commitUpdate；具体 mutation 由 HostConfig
 * 自行跟踪，异常归属当前 finishedWork。
 */
export function commitHostUpdate(
  finishedWork: Fiber,
  newProps: any,
  oldProps: any,
): void {
  try {
    if (__DEV__) {
      runWithFiberInDEV(
        finishedWork,
        commitUpdate,
        finishedWork.stateNode,
        finishedWork.type,
        oldProps,
        newProps,
        finishedWork,
      );
    } else {
      commitUpdate(
        finishedWork.stateNode,
        finishedWork.type,
        oldProps,
        newProps,
        finishedWork,
      );
    }
    // mutation 由 commitUpdate 内部自行记录。
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

/** 将 HostText 从 oldText 更新为 newText，并记录一次宿主 mutation。 */
export function commitHostTextUpdate(
  finishedWork: Fiber,
  newText: string,
  oldText: string,
) {
  const textInstance: TextInstance = finishedWork.stateNode;
  try {
    if (__DEV__) {
      runWithFiberInDEV(
        finishedWork,
        commitTextUpdate,
        textInstance,
        oldText,
        newText,
      );
    } else {
      commitTextUpdate(textInstance, oldText, newText);
    }
    trackHostMutation();
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

/** 清空宿主实例的文本内容，为随后插入结构化 child 腾出容器。 */
export function commitHostResetTextContent(finishedWork: Fiber) {
  const instance: Instance = finishedWork.stateNode;
  try {
    if (__DEV__) {
      runWithFiberInDEV(finishedWork, resetTextContent, instance);
    } else {
      resetTextContent(instance);
    }
    trackHostMutation();
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

/** 按 Offscreen 可见状态隐藏或恢复 dehydrated Suspense 宿主边界。 */
export function commitShowHideSuspenseBoundary(node: Fiber, isHidden: boolean) {
  try {
    const instance = node.stateNode;
    if (isHidden) {
      if (__DEV__) {
        runWithFiberInDEV(node, hideDehydratedBoundary, instance);
      } else {
        hideDehydratedBoundary(instance);
      }
    } else {
      if (__DEV__) {
        runWithFiberInDEV(node, unhideDehydratedBoundary, node.stateNode);
      } else {
        unhideDehydratedBoundary(node.stateNode);
      }
    }
  } catch (error) {
    captureCommitPhaseError(node, node.return, error);
  }
}

/** 隐藏宿主实例，或用最新 memoizedProps 恢复其显示样式/属性。 */
export function commitShowHideHostInstance(node: Fiber, isHidden: boolean) {
  try {
    const instance = node.stateNode;
    if (isHidden) {
      if (__DEV__) {
        runWithFiberInDEV(node, hideInstance, instance);
      } else {
        hideInstance(instance);
      }
    } else {
      if (__DEV__) {
        runWithFiberInDEV(
          node,
          unhideInstance,
          node.stateNode,
          node.memoizedProps,
        );
      } else {
        unhideInstance(node.stateNode, node.memoizedProps);
      }
    }
  } catch (error) {
    captureCommitPhaseError(node, node.return, error);
  }
}

/** 隐藏或恢复宿主文本实例并记录 mutation；恢复时重用 Fiber 最新文本。 */
export function commitShowHideHostTextInstance(node: Fiber, isHidden: boolean) {
  try {
    const instance = node.stateNode;
    if (isHidden) {
      if (__DEV__) {
        runWithFiberInDEV(node, hideTextInstance, instance);
      } else {
        hideTextInstance(instance);
      }
    } else {
      if (__DEV__) {
        runWithFiberInDEV(
          node,
          unhideTextInstance,
          instance,
          node.memoizedProps,
        );
      } else {
        unhideTextInstance(instance, node.memoizedProps);
      }
    }
    trackHostMutation();
  } catch (error) {
    captureCommitPhaseError(node, node.return, error);
  }
}

/**
 * 首次插入宿主 child 时，把它登记到所有祖先 FragmentInstance。
 * 更新节点、非宿主节点或无祖先 Fragment 时快速退出，避免重复归属。
 */
export function commitNewChildToFragmentInstances(
  fiber: Fiber,
  parentFragmentInstances: null | Array<FragmentInstanceType>,
): void {
  if (
    (fiber.tag !== HostComponent &&
      fiber.tag !== HostSingleton &&
      !(enableFragmentRefsTextNodes && fiber.tag === HostText)) ||
    // Fragment 插入 effect 仅处理首次插入。
    fiber.alternate !== null ||
    parentFragmentInstances === null
  ) {
    return;
  }
  for (let i = 0; i < parentFragmentInstances.length; i++) {
    const fragmentInstance = parentFragmentInstances[i];
    commitNewChildToFragmentInstance(fiber.stateNode, fragmentInstance);
  }
}

/**
 * 从新宿主 Fiber 向上登记到每个 FragmentInstance，遇到最近宿主归属边界即停止。
 */
export function commitFragmentInstanceInsertionEffects(fiber: Fiber): void {
  let parent = fiber.return;
  while (parent !== null) {
    if (isFragmentInstanceParent(parent)) {
      const fragmentInstance: FragmentInstanceType = parent.stateNode;
      commitNewChildToFragmentInstance(fiber.stateNode, fragmentInstance);
    }

    if (isFragmentInstanceHostParent(parent)) {
      return;
    }

    parent = parent.return;
  }
}

/**
 * 从删除宿主 Fiber 向上解除每个 FragmentInstance 的 child 归属，遇到宿主边界即停止。
 */
export function commitFragmentInstanceDeletionEffects(fiber: Fiber): void {
  let parent = fiber.return;
  while (parent !== null) {
    if (isFragmentInstanceParent(parent)) {
      const fragmentInstance: FragmentInstanceType = parent.stateNode;
      deleteChildFromFragmentInstance(fiber.stateNode, fragmentInstance);
    }

    if (isFragmentInstanceHostParent(parent)) {
      return;
    }

    parent = parent.return;
  }
}

/** 判断 Fiber 是否可直接接收本次 Placement 的宿主 child。 */
function isHostParent(fiber: Fiber): boolean {
  return (
    fiber.tag === HostComponent ||
    fiber.tag === HostRoot ||
    // $FlowFixMe[constant-condition]
    (supportsResources ? fiber.tag === HostHoistable : false) ||
    // $FlowFixMe[constant-condition]
    (supportsSingletons
      ? fiber.tag === HostSingleton && isSingletonScope(fiber.type)
      : false) ||
    fiber.tag === HostPortal
  );
}

/** 判断 Fiber 是否为已创建公开 FragmentInstance 的 Fragment。 */
function isFragmentInstanceParent(fiber: Fiber): boolean {
  return fiber && fiber.tag === Fragment && fiber.stateNode !== null;
}

/**
 * 判断 FragmentInstance 收集 child 时的宿主边界。
 * Fragment 总会收集 HostSingleton 本身，无论它是否是 Placement scope，因此边界比
 * isHostParent 更宽。
 */
function isFragmentInstanceHostParent(fiber: Fiber): boolean {
  return (
    fiber.tag === HostComponent ||
    // $FlowFixMe[constant-condition]
    (supportsSingletons ? fiber.tag === HostSingleton : false) ||
    fiber.tag === HostRoot ||
    fiber.tag === HostPortal
  );
}

/**
 * 向前搜索同一宿主父级下首个稳定、非 Placement 的宿主 sibling，作为 insertBefore 锚点。
 * 连续插入会反复越过待放置子树，最坏产生指数搜索；TODO：设计更高效的 sibling 索引。
 */
function getHostSibling(fiber: Fiber): ?Instance {
  let node: Fiber = fiber;
  siblings: while (true) {
    // 当前分支没有候选，向上寻找下一个 sibling。
    while (node.sibling === null) {
      if (node.return === null || isHostParent(node.return)) {
        // 已离开 Root 或到达宿主父级，当前节点是最后一个 sibling。
        return null;
      }
      // $FlowFixMe[incompatible-type] found when upgrading Flow
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
    while (
      node.tag !== HostComponent &&
      node.tag !== HostText &&
      node.tag !== DehydratedFragment
    ) {
      // singleton scope 只允许在已处于其内部时作为插入父级，此处应跳过整个 scope。
      if (
        // $FlowFixMe[constant-condition]
        supportsSingletons &&
        node.tag === HostSingleton &&
        isSingletonScope(node.type)
      ) {
        continue siblings;
      }

      // 非宿主 Fiber 内可能含宿主节点，继续向下搜索。
      if (node.flags & Placement) {
        // 待 Placement 子树本身不稳定，改搜其 sibling。
        continue siblings;
      }
      // 没有 child 时改搜 sibling；Portal 属于另一宿主树，也整体跳过。
      if (node.child === null || node.tag === HostPortal) {
        continue siblings;
      } else {
        node.child.return = node;
        node = node.child;
      }
    }
    // 仅稳定宿主节点可作为锚点。
    if (!(node.flags & Placement)) {
      // 找到插入锚点。
      return node.stateNode;
    }
  }
}

/**
 * 把 Placement 子树的终端宿主节点插入 Root/Portal Container。
 * Portal 自行提交而跳过；singleton scope 会接管后代插入父级；FragmentInstance 同步登记
 * 直属宿主 child。
 */
function insertOrAppendPlacementNodeIntoContainer(
  node: Fiber,
  before: ?Instance,
  parent: Container,
  parentFragmentInstances: null | Array<FragmentInstanceType>,
): void {
  const {tag} = node;
  const isHost = tag === HostComponent || tag === HostText;
  if (isHost) {
    const stateNode = node.stateNode;
    if (before) {
      insertInContainerBefore(parent, stateNode, before);
    } else {
      appendChildToContainer(parent, stateNode);
    }
    if (enableFragmentRefs) {
      commitNewChildToFragmentInstances(node, parentFragmentInstances);
    }
    trackHostMutation();
    return;
  } else if (tag === HostPortal) {
    // Portal child 会向自己的容器直接提交，不进入其子树。
    return;
  }

  // $FlowFixMe[constant-condition]
  if (supportsSingletons ? tag === HostSingleton : false) {
    if (enableFragmentRefs) {
      // singleton 本身是 Fragment child，其内部 child 不归属更高层 FragmentInstance。
      commitNewChildToFragmentInstances(node, parentFragmentInstances);
      parentFragmentInstances = null;
    }
    if (isSingletonScope(node.type)) {
      // singleton scope 接管后代插入父级，且其内部没有外部 before 锚点。
      parent = node.stateNode;
      before = null;
    }
  }

  const child = node.child;
  if (child !== null) {
    insertOrAppendPlacementNodeIntoContainer(
      child,
      before,
      parent,
      parentFragmentInstances,
    );
    let sibling = child.sibling;
    while (sibling !== null) {
      insertOrAppendPlacementNodeIntoContainer(
        sibling,
        before,
        parent,
        parentFragmentInstances,
      );
      sibling = sibling.sibling;
    }
  }
}

/**
 * 把 Placement 子树的终端宿主节点插入普通宿主 Instance；规则与 Container 版本相同，
 * 但使用 appendChild/insertBefore 宿主接口。
 */
function insertOrAppendPlacementNode(
  node: Fiber,
  before: ?Instance,
  parent: Instance,
  parentFragmentInstances: null | Array<FragmentInstanceType>,
): void {
  const {tag} = node;
  const isHost = tag === HostComponent || tag === HostText;
  if (isHost) {
    const stateNode = node.stateNode;
    if (before) {
      insertBefore(parent, stateNode, before);
    } else {
      appendChild(parent, stateNode);
    }
    if (enableFragmentRefs) {
      commitNewChildToFragmentInstances(node, parentFragmentInstances);
    }
    trackHostMutation();
    return;
  } else if (tag === HostPortal) {
    // Portal child 会向自己的容器直接提交，不进入其子树。
    return;
  }

  // $FlowFixMe[constant-condition]
  if (supportsSingletons ? tag === HostSingleton : false) {
    if (enableFragmentRefs) {
      // singleton 本身是 Fragment child，其内部 child 不归属更高层 FragmentInstance。
      commitNewChildToFragmentInstances(node, parentFragmentInstances);
      parentFragmentInstances = null;
    }
    if (isSingletonScope(node.type)) {
      // singleton scope 接管后代插入父级。
      parent = node.stateNode;
    }
  }

  const child = node.child;
  if (child !== null) {
    insertOrAppendPlacementNode(child, before, parent, parentFragmentInstances);
    let sibling = child.sibling;
    while (sibling !== null) {
      insertOrAppendPlacementNode(
        sibling,
        before,
        parent,
        parentFragmentInstances,
      );
      sibling = sibling.sibling;
    }
  }
}

/**
 * 查找 Placement Fiber 的宿主父级与稳定 sibling 锚点，再递归插入全部终端宿主节点。
 * 同时收集到最近宿主边界为止的 FragmentInstance；mutation 关闭时仅维护其不可变归属。
 */
function commitPlacement(finishedWork: Fiber): void {
  // 递归把全部终端宿主节点插入父级。
  let hostParentFiber;
  let parentFragmentInstances = null;
  let collectFragmentInstances = enableFragmentRefs;
  let parentFiber = finishedWork.return;
  while (parentFiber !== null) {
    if (collectFragmentInstances && isFragmentInstanceParent(parentFiber)) {
      const fragmentInstance: FragmentInstanceType = parentFiber.stateNode;
      if (parentFragmentInstances === null) {
        parentFragmentInstances = [fragmentInstance];
      } else {
        parentFragmentInstances.push(fragmentInstance);
      }
    }
    if (collectFragmentInstances && isFragmentInstanceHostParent(parentFiber)) {
      // Fragment 只收集到最近宿主 Fiber。Placement 父级搜索可越过不能作为父级的宿主
      // Fiber（如 scope 外 singleton），但其上的 Fragment 拥有该宿主 Fiber，而非待放置节点。
      collectFragmentInstances = false;
    }
    if (isHostParent(parentFiber)) {
      hostParentFiber = parentFiber;
      break;
    }
    parentFiber = parentFiber.return;
  }

  // $FlowFixMe[constant-condition]
  if (!supportsMutation) {
    if (enableFragmentRefs) {
      commitImmutablePlacementNodeToFragmentInstances(
        finishedWork,
        parentFragmentInstances,
      );
    }
    return;
  }

  if (hostParentFiber == null) {
    throw new Error(
      'Expected to find a host parent. This error is likely caused by a bug ' +
        'in React. Please file an issue.',
    );
  }

  switch (hostParentFiber.tag) {
    case HostSingleton: {
      // $FlowFixMe[constant-condition]
      if (supportsSingletons) {
        const parent: Instance = hostParentFiber.stateNode;
        const before = getHostSibling(finishedWork);
        // 当前只有待插入顶层 Fiber，需递归找到所有终端宿主节点。
        insertOrAppendPlacementNode(
          finishedWork,
          before,
          parent,
          parentFragmentInstances,
        );
        break;
      }
      // HostConfig 不支持 singleton 时落入 HostComponent。
    }
    case HostComponent: {
      const parent: Instance = hostParentFiber.stateNode;
      if (hostParentFiber.flags & ContentReset) {
        // 插入结构化 child 前先清空父级文本内容。
        resetTextContent(parent);
        // 清除已消费的 ContentReset 标记。
        hostParentFiber.flags &= ~ContentReset;
      }

      const before = getHostSibling(finishedWork);
      // 当前只有待插入顶层 Fiber，需递归找到所有终端宿主节点。
      insertOrAppendPlacementNode(
        finishedWork,
        before,
        parent,
        parentFragmentInstances,
      );
      break;
    }
    case HostRoot:
    case HostPortal: {
      const parent: Container = hostParentFiber.stateNode.containerInfo;
      const before = getHostSibling(finishedWork);
      insertOrAppendPlacementNodeIntoContainer(
        finishedWork,
        before,
        parent,
        parentFragmentInstances,
      );
      break;
    }
    default:
      throw new Error(
        'Invalid host parent fiber. This error is likely caused by a bug ' +
          'in React. Please file an issue.',
      );
  }
}

/**
 * 非 mutation 渲染器中递归登记 Placement 子树与祖先 FragmentInstance 的归属。
 * singleton/宿主节点作为终端 child，Portal 属另一宿主树而跳过。
 */
function commitImmutablePlacementNodeToFragmentInstances(
  finishedWork: Fiber,
  parentFragmentInstances: null | Array<FragmentInstanceType>,
): void {
  if (!enableFragmentRefs) {
    return;
  }
  const isHost =
    finishedWork.tag === HostComponent ||
    // $FlowFixMe[constant-condition]
    (supportsSingletons ? finishedWork.tag === HostSingleton : false);
  if (isHost) {
    // singleton 本身是 Fragment child，其内部 child 不归属更高层 FragmentInstance。
    commitNewChildToFragmentInstances(finishedWork, parentFragmentInstances);
    return;
  } else if (finishedWork.tag === HostPortal) {
    // Portal child 会向自己的容器直接提交，不进入其子树。
    return;
  }

  const child = finishedWork.child;
  if (child !== null) {
    commitImmutablePlacementNodeToFragmentInstances(
      child,
      parentFragmentInstances,
    );
    let sibling = child.sibling;
    while (sibling !== null) {
      commitImmutablePlacementNodeToFragmentInstances(
        sibling,
        parentFragmentInstances,
      );
      sibling = sibling.sibling;
    }
  }
}

/** 用 DEV Fiber 上下文安全执行宿主 Placement，错误不会中断其余 mutation effect。 */
export function commitHostPlacement(finishedWork: Fiber) {
  try {
    if (__DEV__) {
      runWithFiberInDEV(finishedWork, commitPlacement, finishedWork);
    } else {
      commitPlacement(finishedWork);
    }
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

/** 从 Root/Portal Container 删除宿主 child，记录 mutation 并捕获宿主错误。 */
export function commitHostRemoveChildFromContainer(
  deletedFiber: Fiber,
  nearestMountedAncestor: Fiber,
  parentContainer: Container,
  hostInstance: Instance | TextInstance,
) {
  try {
    if (__DEV__) {
      runWithFiberInDEV(
        deletedFiber,
        removeChildFromContainer,
        parentContainer,
        hostInstance,
      );
    } else {
      removeChildFromContainer(parentContainer, hostInstance);
    }
    trackHostMutation();
  } catch (error) {
    captureCommitPhaseError(deletedFiber, nearestMountedAncestor, error);
  }
}

/** 从普通宿主 Instance 删除宿主 child，记录 mutation 并捕获宿主错误。 */
export function commitHostRemoveChild(
  deletedFiber: Fiber,
  nearestMountedAncestor: Fiber,
  parentInstance: Instance,
  hostInstance: Instance | TextInstance,
) {
  try {
    if (__DEV__) {
      runWithFiberInDEV(
        deletedFiber,
        removeChild,
        parentInstance,
        hostInstance,
      );
    } else {
      removeChild(parentInstance, hostInstance);
    }
    trackHostMutation();
  } catch (error) {
    captureCommitPhaseError(deletedFiber, nearestMountedAncestor, error);
  }
}

/** 持久化模式提交 Root.pendingChildren，用新 ChildSet 原子替换容器内容。 */
export function commitHostRootContainerChildren(
  root: FiberRoot,
  finishedWork: Fiber,
) {
  const containerInfo = root.containerInfo;
  const pendingChildren = root.pendingChildren;
  try {
    if (__DEV__) {
      runWithFiberInDEV(
        finishedWork,
        replaceContainerChildren,
        containerInfo,
        pendingChildren,
      );
    } else {
      replaceContainerChildren(containerInfo, pendingChildren);
    }
    trackHostMutation();
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

/** 持久化模式提交 Portal ChildSet，用新集合整体替换 Portal 容器内容。 */
export function commitHostPortalContainerChildren(
  portal: {
    /** Portal 指向的宿主容器。 */
    containerInfo: Container,
    /** Portal Fiber 保存的待提交 ChildSet。 */
    pendingChildren: ChildSet,
    ...
  },
  finishedWork: Fiber,
  pendingChildren: ChildSet,
) {
  const containerInfo = portal.containerInfo;
  try {
    if (__DEV__) {
      runWithFiberInDEV(
        finishedWork,
        replaceContainerChildren,
        containerInfo,
        pendingChildren,
      );
    } else {
      replaceContainerChildren(containerInfo, pendingChildren);
    }
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

/** 通知 HostConfig Root 容器已完成 hydration。 */
export function commitHostHydratedContainer(
  root: FiberRoot,
  finishedWork: Fiber,
) {
  try {
    if (__DEV__) {
      runWithFiberInDEV(
        finishedWork,
        commitHydratedContainer,
        root.containerInfo,
      );
    } else {
      commitHydratedContainer(root.containerInfo);
    }
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

/** 通知 HostConfig dehydrated Activity 实例已完成 hydration。 */
export function commitHostHydratedActivity(
  activityInstance: ActivityInstance,
  finishedWork: Fiber,
) {
  try {
    if (__DEV__) {
      runWithFiberInDEV(
        finishedWork,
        commitHydratedActivityInstance,
        activityInstance,
      );
    } else {
      commitHydratedActivityInstance(activityInstance);
    }
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

/** 通知 HostConfig dehydrated Suspense 实例已完成 hydration。 */
export function commitHostHydratedSuspense(
  suspenseInstance: SuspenseInstance,
  finishedWork: Fiber,
) {
  try {
    if (__DEV__) {
      runWithFiberInDEV(
        finishedWork,
        commitHydratedSuspenseInstance,
        suspenseInstance,
      );
    } else {
      commitHydratedSuspenseInstance(suspenseInstance);
    }
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

/**
 * 首次挂载 HostSingleton 时从宿主环境取得唯一实例，并写入初始属性/所有权。
 */
export function commitHostSingletonAcquisition(finishedWork: Fiber) {
  const singleton = finishedWork.stateNode;
  const props = finishedWork.memoizedProps;

  try {
    // 新挂载：取得 DOM singleton 并设置初始属性。
    if (__DEV__) {
      runWithFiberInDEV(
        finishedWork,
        acquireSingletonInstance,
        finishedWork.type,
        props,
        singleton,
        finishedWork,
      );
    } else {
      acquireSingletonInstance(
        finishedWork.type,
        props,
        singleton,
        finishedWork,
      );
    }
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

/** 卸载 HostSingleton 时释放宿主所有权并恢复 HostConfig 管理的原始状态。 */
export function commitHostSingletonRelease(releasingWork: Fiber) {
  if (__DEV__) {
    runWithFiberInDEV(
      releasingWork,
      releaseSingletonInstance,
      releasingWork.stateNode,
      releasingWork.type,
      releasingWork.memoizedProps,
    );
  } else {
    releaseSingletonInstance(
      releasingWork.stateNode,
      releasingWork.type,
      releasingWork.memoizedProps,
    );
  }
}
