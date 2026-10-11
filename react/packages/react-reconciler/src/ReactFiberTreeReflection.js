/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactInternalTypes';
import type {
  Container,
  Instance,
  TextInstance,
  ActivityInstance,
  SuspenseInstance,
} from './ReactFiberConfig';
import type {ActivityState} from './ReactFiberActivityComponent';
import type {SuspenseState} from './ReactFiberSuspenseComponent';

import {
  HostComponent,
  HostHoistable,
  HostSingleton,
  HostRoot,
  HostPortal,
  HostText,
  ActivityComponent,
  SuspenseComponent,
  OffscreenComponent,
  Fragment,
} from './ReactWorkTags';
import {NoFlags, Placement, Hydrating} from './ReactFiberFlags';
import {enableFragmentRefsTextNodes} from 'shared/ReactFeatureFlags';

/**
 * 返回仍可能挂载在宿主根上的最近 Fiber。
 *
 * 无 alternate 的新节点若带 Placement/Hydrating，只能把父级视为最近已挂载候选；随后继续走到
 * HostRoot 验证树仍连接。已断开 return 链的卸载子树返回 null。
 */
export function getNearestMountedFiber(fiber: Fiber): null | Fiber {
  let node = fiber;
  let nearestMounted: null | Fiber = fiber;
  // 无 alternate 可能表示尚未插入的新树；它会带待提交的 Placement/Hydrating。
  let nextNode: Fiber = node;
  while (nextNode && !nextNode.alternate) {
    node = nextNode;
    if ((node.flags & (Placement | Hydrating)) !== NoFlags) {
      // 当前节点仍在插入/认领中，最近可能已挂载的是父级，但还需继续验证父级连接到根。
      nearestMounted = node.return;
    }
    // $FlowFixMe[incompatible-type] we bail out when we get a null
    nextNode = node.return;
  }
  // 遇到已有 alternate 后继续走到顶；卸载树会断开 return，无法到达 HostRoot。
  while (node.return) {
    node = node.return;
  }
  if (node.tag === HostRoot) {
    // TODO：与 renderContainerIntoSubtree 共用时，复核嵌套 HostRoot 的挂载判断。
    return nearestMounted;
  }
  // 未到 HostRoot 表示该 return 链已经断开，Fiber 属于卸载树。
  return null;
}

/** 从 Suspense Fiber 的当前或 alternate 状态读取已认领的宿主 Suspense 边界。 */
export function getSuspenseInstanceFromFiber(
  fiber: Fiber,
): null | SuspenseInstance {
  if (fiber.tag === SuspenseComponent) {
    let suspenseState: SuspenseState | null = fiber.memoizedState;
    if (suspenseState === null) {
      const current = fiber.alternate;
      if (current !== null) {
        suspenseState = current.memoizedState;
      }
    }
    if (suspenseState !== null) {
      return suspenseState.dehydrated;
    }
  }
  return null;
}

/** 从 Activity Fiber 的当前或 alternate 状态读取 dehydrated 宿主边界。 */
export function getActivityInstanceFromFiber(
  fiber: Fiber,
): null | ActivityInstance {
  if (fiber.tag === ActivityComponent) {
    let activityState: ActivityState | null = fiber.memoizedState;
    if (activityState === null) {
      const current = fiber.alternate;
      if (current !== null) {
        activityState = current.memoizedState;
      }
    }
    if (activityState !== null) {
      return activityState.dehydrated;
    }
  }
  // TODO：ActivityComponent 的完整宿主实例反射仍待实现。
  return null;
}

/** 仅对 HostRoot 返回 HostConfig 容器；其他 Fiber 不伪造容器。 */
export function getContainerFromFiber(fiber: Fiber): null | Container {
  return fiber.tag === HostRoot
    ? (fiber.stateNode.containerInfo as Container)
    : null;
}

/** 断言 Fiber 本身就是最近已挂载节点，否则按卸载组件报错。 */
function assertIsMounted(fiber: Fiber) {
  if (getNearestMountedFiber(fiber) !== fiber) {
    throw new Error('Unable to find node on an unmounted component.');
  }
}

/**
 * 在 current/alternate 双缓冲中找出当前已提交分支。
 *
 * 算法从两枚候选同步向根上行，利用父 child 复用、return 不交叉和 sibling 集合归属消歧，
 * 最终以 FiberRoot.current 判定；新插入但未提交返回 null，卸载或结构不变量破坏则抛错。
 */
export function findCurrentFiberUsingSlowPath(fiber: Fiber): Fiber | null {
  const alternate = fiber.alternate;
  if (!alternate) {
    // 无 alternate 时只需区分已挂载、待插入与已卸载。
    const nearestMounted = getNearestMountedFiber(fiber);

    if (nearestMounted === null) {
      throw new Error('Unable to find node on an unmounted component.');
    }

    if (nearestMounted !== fiber) {
      return null;
    }
    return fiber;
  }
  // 有两枚候选时同步向根回溯，沿途处理 bailout 复用与 Suspense 额外 Fragment 等特例。
  let a: Fiber = fiber;
  let b: Fiber = alternate;
  while (true) {
    const parentA = a.return;
    if (parentA === null) {
      // A 已到根。
      break;
    }
    const parentB = parentA.alternate;
    if (parentB === null) {
      // 父级没有 alternate 是隐藏 Suspense 插入额外 Fragment 的特殊形状；跳过这层继续到共同父级。
      const nextParent = parentA.return;
      if (nextParent !== null) {
        a = b = nextParent;
        continue;
      }
      // 再无父级表示已到根。
      break;
    }

    // 两面父 Fiber 指向同一 child 链，表示低优先级 bailout 复用了 current children；
    // 在共享 sibling 链中出现的候选即为 current。
    if (parentA.child === parentB.child) {
      let child = parentA.child;
      while (child) {
        if (child === a) {
          // A 位于共享 current child 集合。
          assertIsMounted(parentA);
          return fiber;
        }
        if (child === b) {
          // B 位于共享 current child 集合。
          assertIsMounted(parentA);
          return alternate;
        }
        child = child.sibling;
      }

      // 正在挂载的新节点不应已有 alternate；两候选都不在集合中只能按卸载/断链处理。
      throw new Error('Unable to find node on an unmounted component.');
    }

    if (a.return !== b.return) {
      // 两面 return 不同且不允许交叉，因此各自必属于对应父级 child 集合，可直接同步上移。
      a = parentA;
      b = parentB;
    } else {
      // 两面 return 暂时指向同一 Fiber，需扫描两面父级 child 集合确认归属。
      // 先搜索 parent A 的 child 集合。
      let didFindChild = false;
      let child = parentA.child;
      while (child) {
        if (child === a) {
          didFindChild = true;
          a = parentA;
          b = parentB;
          break;
        }
        if (child === b) {
          didFindChild = true;
          b = parentA;
          a = parentB;
          break;
        }
        child = child.sibling;
      }
      if (!didFindChild) {
        // A 集合未命中，再搜索 parent B 的 child 集合。
        child = parentB.child;
        while (child) {
          if (child === a) {
            didFindChild = true;
            a = parentB;
            b = parentA;
            break;
          }
          if (child === b) {
            didFindChild = true;
            b = parentB;
            a = parentA;
            break;
          }
          child = child.sibling;
        }

        if (!didFindChild) {
          throw new Error(
            'Child was not found in either parent set. This indicates a bug ' +
              'in React related to the return pointer. Please file an issue.',
          );
        }
      }
    }

    if (a.alternate !== b) {
      throw new Error(
        "Return fibers should always be each others' alternates. " +
          'This error is likely caused by a bug in React. Please file an issue.',
      );
    }
  }

  // 顶部不是 HostRoot，说明候选位于已断开的卸载树。
  if (a.tag !== HostRoot) {
    throw new Error('Unable to find node on an unmounted component.');
  }

  if (a.stateNode.current === a) {
    // FiberRoot.current 明确指向 A 分支。
    return fiber;
  }
  // 否则在 alternate 不变量下 B 必为 current。
  return alternate;
}

/** 从指定 Fiber 的 current 分支向下查找第一个宿主元素或文本 Fiber。 */
export function findCurrentHostFiber(parent: Fiber): Fiber | null {
  const currentParent = findCurrentFiberUsingSlowPath(parent);
  return currentParent !== null
    ? findCurrentHostFiberImpl(currentParent)
    : null;
}

/** 深度优先查找第一个 HostComponent/Hoistable/Singleton/Text。 */
function findCurrentHostFiberImpl(node: Fiber): Fiber | null {
  // 向下钻取复合组件，找到第一枚可映射宿主实例的 Fiber。
  const tag = node.tag;
  if (
    tag === HostComponent ||
    tag === HostHoistable ||
    tag === HostSingleton ||
    tag === HostText
  ) {
    return node;
  }

  let child = node.child;
  while (child !== null) {
    const match = findCurrentHostFiberImpl(child);
    if (match !== null) {
      return match;
    }
    child = child.sibling;
  }

  return null;
}

/** 从 current 分支向下查找第一个宿主 Fiber，但不跨入 Portal 的另一容器。 */
export function findCurrentHostFiberWithNoPortals(parent: Fiber): Fiber | null {
  const currentParent = findCurrentFiberUsingSlowPath(parent);
  return currentParent !== null
    ? findCurrentHostFiberWithNoPortalsImpl(currentParent)
    : null;
}

/** 深度优先查找宿主 Fiber；遇到 HostPortal 时剪掉整棵跨容器子树。 */
function findCurrentHostFiberWithNoPortalsImpl(node: Fiber): Fiber | null {
  // 向下钻取复合组件，找到当前容器内第一枚宿主 Fiber。
  const tag = node.tag;
  if (
    tag === HostComponent ||
    tag === HostHoistable ||
    tag === HostSingleton ||
    tag === HostText
  ) {
    return node;
  }

  let child = node.child;
  while (child !== null) {
    if (child.tag !== HostPortal) {
      const match = findCurrentHostFiberWithNoPortalsImpl(child);
      if (match !== null) {
        return match;
      }
    }
    child = child.sibling;
  }

  return null;
}

/** 判断 Suspense 已切到客户端 fallback，且当前状态不是 dehydrated 服务端边界。 */
export function isFiberSuspenseAndTimedOut(fiber: Fiber): boolean {
  const memoizedState = fiber.memoizedState;
  return (
    fiber.tag === SuspenseComponent &&
    memoizedState !== null &&
    memoizedState.dehydrated === null
  );
}

/** 沿 return 链判断 child 是否位于 parent 的 current 或 alternate 子树中。 */
export function doesFiberContain(
  parentFiber: Fiber,
  childFiber: Fiber,
): boolean {
  let node: null | Fiber = childFiber;
  const parentFiberAlternate = parentFiber.alternate;
  while (node !== null) {
    if (node === parentFiber || node === parentFiberAlternate) {
      return true;
    }
    node = node.return;
  }
  return false;
}

/** 遍历 Fragment 的可见顶层宿主实例/可选文本，并在回调返回 true 时提前停止。 */
export function traverseFragmentInstancesAndTextInstances<A, B, C>(
  fragmentFiber: Fiber,
  fn: (Fiber, A, B, C) => boolean,
  a: A,
  b: B,
  c: C,
): void {
  traverseVisibleInstancesAndTextInstances(
    fragmentFiber.child,
    false,
    fn,
    a,
    b,
    c,
  );
}

/** 深入宿主节点内部遍历 Fragment 的全部可见宿主实例/可选文本。 */
export function traverseFragmentInstancesAndTextInstancesDeeply<A, B, C>(
  fragmentFiber: Fiber,
  fn: (Fiber, A, B, C) => boolean,
  a: A,
  b: B,
  c: C,
): void {
  traverseVisibleInstancesAndTextInstances(
    fragmentFiber.child,
    true,
    fn,
    a,
    b,
    c,
  );
}

/**
 * 深度优先遍历可见宿主 Fiber。
 *
 * hidden Offscreen 整树跳过；`searchWithinHosts=false` 时宿主节点是叶边界，true 时继续进入其 children。
 * 回调或递归返回 true 会沿调用栈提前结束搜索。
 * @param child 开始处理的 sibling 链，函数会逐项向后走，不向上寻找其它 sibling 链。
 * @param fn 只接收 HostComponent/HostSingleton，以及开关开启时的 HostText；HostHoistable 不在回调集合。
 * @param a 原样传给回调的第一项上下文；b/c 为另外两项，遍历自身不解释它们。
 */
function traverseVisibleInstancesAndTextInstances<A, B, C>(
  child: Fiber | null,
  searchWithinHosts: boolean,
  fn: (Fiber, A, B, C) => boolean,
  a: A,
  b: B,
  c: C,
): boolean {
  while (child !== null) {
    const isHostNode =
      child.tag === HostComponent ||
      child.tag === HostSingleton ||
      (enableFragmentRefsTextNodes && child.tag === HostText);
    if (isHostNode && fn(child, a, b, c)) {
      return true;
    } else if (
      child.tag === OffscreenComponent &&
      child.memoizedState !== null
    ) {
      // hidden Offscreen 不对应当前可见 Fragment 实例，整棵跳过。
    } else {
      if (
        (searchWithinHosts ||
          (child.tag !== HostComponent && child.tag !== HostSingleton)) &&
        traverseVisibleInstancesAndTextInstances(
          child.child,
          searchWithinHosts,
          fn,
          a,
          b,
          c,
        )
      ) {
        return true;
      }
    }
    child = child.sibling;
  }
  return false;
}

/** 向上查找 Fragment 所在的最近 HostRoot/HostComponent/HostSingleton 父级。 */
export function getFragmentParentInstanceOrContainerFiber(
  fiber: Fiber,
): null | Fiber {
  let parent = fiber.return;
  while (parent !== null) {
    if (
      parent.tag === HostRoot ||
      parent.tag === HostComponent ||
      parent.tag === HostSingleton
    ) {
      return parent;
    }
    parent = parent.return;
  }

  return null;
}

/** 判断 Fiber 到最近宿主父级之间是否跨过 HostPortal。 */
export function fiberIsPortaledIntoHost(fiber: Fiber): boolean {
  let foundPortalParent = false;
  let parent = fiber.return;
  while (parent !== null) {
    if (parent.tag === HostPortal) {
      foundPortalParent = true;
    }
    if (
      parent.tag === HostRoot ||
      parent.tag === HostComponent ||
      parent.tag === HostSingleton
    ) {
      break;
    }
    parent = parent.return;
  }
  return foundPortalParent;
}

/** 查找 Fragment 虚拟位置前后最近的可见宿主实例或可选 HostText sibling。 */
export function getFragmentInstanceOrTextInstanceSiblings(
  fiber: Fiber,
): [Fiber | null, Fiber | null] {
  const result: [Fiber | null, Fiber | null] = [null, null];
  const parentHostFiber = getFragmentParentInstanceOrContainerFiber(fiber);
  if (parentHostFiber === null) {
    return result;
  }

  findFragmentInstanceOrTextInstanceSiblings(
    result,
    fiber,
    parentHostFiber.child,
  );
  return result;
}

/**
 * 递归收集 Fragment 前后的宿主 sibling；仅在 enableFragmentRefsTextNodes 开启时把 HostText 纳入。
 * `result[0]` 持续更新为 self 前最后一项，`result[1]` 命中 self 后第一项即提前返回。
 * 子调用返回 true 时父调用立即退出；若 self 位于嵌套复合组件末尾，会在该层结束，
 * 不会继续搜索祖先层后续 sibling。foundSelf 按值传递，不是所有递归共享的游标。
 */
function findFragmentInstanceOrTextInstanceSiblings(
  result: [Fiber | null, Fiber | null],
  self: Fiber,
  child: null | Fiber,
  foundSelf: boolean = false,
): boolean {
  while (child !== null) {
    if (child === self) {
      foundSelf = true;
      if (child.sibling) {
        child = child.sibling;
      } else {
        return true;
      }
    }
    if (
      child.tag === HostComponent ||
      child.tag === HostSingleton ||
      (enableFragmentRefsTextNodes && child.tag === HostText)
    ) {
      if (foundSelf) {
        result[1] = child;
        return true;
      } else {
        result[0] = child;
      }
    } else if (
      child.tag === OffscreenComponent &&
      child.memoizedState !== null
    ) {
      // hidden Offscreen 不参与可见 sibling 位置计算。
    } else {
      if (
        findFragmentInstanceOrTextInstanceSiblings(
          result,
          self,
          child.child,
          foundSelf,
        )
      ) {
        return true;
      }
    }
    child = child.sibling;
  }
  return false;
}

/** 从宿主 Fiber 取 HostConfig 实例；HostRoot 返回 containerInfo，非宿主标签属于内部错误。 */
export function getInstanceFromHostFiber<
  I: Instance | TextInstance | Container,
>(fiber: Fiber): I {
  switch (fiber.tag) {
    case HostComponent:
    case HostSingleton:
    case HostText:
      return fiber.stateNode;
    case HostRoot:
      return fiber.stateNode.containerInfo;
    default:
      throw new Error('Expected to find a host node. This is a bug in React.');
  }
}

/** 复用遍历 callback 签名传回命中的 Fiber；每次公开搜索后必须清空。 */
let searchTarget = null;
/** 顺序比较时记录是否已经越过边界 Fiber；每次公开搜索后必须清空。 */
let searchBoundary = null;
/** 写入当前遍历命中目标。 */
function pushSearchTarget(target: null | Fiber): void {
  searchTarget = target;
}
/** 读取当前遍历命中目标。 */
function popSearchTarget(): null | Fiber {
  return searchTarget;
}
/** 写入顺序比较的边界状态。 */
function pushSearchBoundary(value: null | Fiber): void {
  searchBoundary = value;
}
/** 读取顺序比较的边界状态。 */
function popSearchBoundary(): null | Fiber {
  return searchBoundary;
}

/** 返回给定 Fiber 之后、同一可见宿主遍历中的下一枚实例或文本 Fiber。 */
export function getNextSiblingInstanceOrTextInstanceFiber(
  fiber: Fiber,
): null | Fiber {
  traverseVisibleInstancesAndTextInstances(
    fiber.sibling,
    false,
    findNextSibling,
  );
  const sibling = popSearchTarget();
  pushSearchTarget(null);
  return sibling;
}

/** 遍历 callback：记录第一枚候选并立即停止。 */
function findNextSibling(child: Fiber): boolean {
  pushSearchTarget(child);
  return true;
}

/** 判断 Fiber 的 return 链是否经过指定 Fragment 的 current/alternate。 */
export function isFiberContainedByFragment(
  fiber: Fiber,
  fragmentFiber: Fiber,
): boolean {
  let current: Fiber | null = fiber;
  while (current !== null) {
    if (
      current.tag === Fragment &&
      (current === fragmentFiber || current.alternate === fragmentFiber)
    ) {
      return true;
    }
    current = current.return;
  }
  return false;
}

/**
 * 当前实现查 fragmentFiber 自己的最近宿主父级，再沿同一 return 链确认它。
 * otherFiber 参数未读取；有宿主父级时通常返回 true，不能据此判断两个指定 Fiber 的包含关系。
 */
export function isFragmentContainedByFiber(
  fragmentFiber: Fiber,
  otherFiber: Fiber,
): boolean {
  let current: Fiber | null = fragmentFiber;
  const fiberHostParent: Fiber | null =
    getFragmentParentInstanceOrContainerFiber(fragmentFiber);
  while (current !== null) {
    if (
      (current.tag === HostComponent ||
        current.tag === HostRoot ||
        current.tag === HostSingleton) &&
      (current === fiberHostParent || current.alternate === fiberHostParent)
    ) {
      return true;
    }
    current = current.return;
  }
  return false;
}

/**
 * 沿最近公共宿主祖先的可见深度优先遍历比较两项。
 * 当前回调实参是 target=otherFiber、boundary=fiber，先遇到 otherFiber 时返回 true；
 * 因而实际检查 otherFiber 在 fiber 之前，不能按函数名读成相反方向。
 */
export function isFiberPreceding(fiber: Fiber, otherFiber: Fiber): boolean {
  const commonAncestor = getLowestCommonAncestor(
    fiber,
    otherFiber,
    getParentForFragmentAncestors,
  );
  if (commonAncestor === null) {
    return false;
  }
  traverseVisibleInstancesAndTextInstances(
    commonAncestor,
    true,
    isFiberPrecedingCheck,
    otherFiber,
    fiber,
  );
  const target = popSearchTarget();
  pushSearchTarget(null);
  return target !== null;
}

/** “在前”遍历 callback：先遇到 boundary 即失败，先遇到 target 则记录成功。 */
function isFiberPrecedingCheck(
  child: Fiber,
  target: Fiber,
  boundary: Fiber,
): boolean {
  if (child === boundary) {
    return true;
  }
  if (child === target) {
    pushSearchTarget(child);
    return true;
  }
  return false;
}

/**
 * 当前回调实参是 target=otherFiber、boundary=fiber，只有先见 fiber 再见 otherFiber 才成功。
 * 实际检查 otherFiber 在 fiber 之后；成功或正常失败后清空模块内临时目标与边界。
 */
export function isFiberFollowing(fiber: Fiber, otherFiber: Fiber): boolean {
  const commonAncestor = getLowestCommonAncestor(
    fiber,
    otherFiber,
    getParentForFragmentAncestors,
  );
  if (commonAncestor === null) {
    return false;
  }
  traverseVisibleInstancesAndTextInstances(
    commonAncestor,
    true,
    isFiberFollowingCheck,
    otherFiber,
    fiber,
  );
  const target = popSearchTarget();
  pushSearchTarget(null);
  pushSearchBoundary(null);
  return target !== null;
}

/** “在后”遍历 callback：只有先越过 boundary、再命中 target 才记录成功。 */
function isFiberFollowingCheck(
  child: Fiber,
  target: Fiber,
  boundary: Fiber,
): boolean {
  if (child === boundary) {
    pushSearchBoundary(child);
    return false;
  }
  if (child === target) {
    // 只有此前已遇到 boundary，target 才确实位于其后。
    if (popSearchBoundary() !== null) {
      pushSearchTarget(child);
    }
    return true;
  }
  return false;
}

/** 为 Fragment 顺序比较向上跳到最近宿主父级或 HostRoot。 */
function getParentForFragmentAncestors(inst: Fiber | null): Fiber | null {
  if (inst === null) {
    return null;
  }
  do {
    inst = inst === null ? null : inst.return;
  } while (
    inst &&
    inst.tag !== HostComponent &&
    inst.tag !== HostSingleton &&
    inst.tag !== HostRoot
  );
  if (inst) {
    return inst;
  }
  return null;
}

/**
 * 返回 A、B 在调用方父级关系下的最低公共祖先；不同树返回 null。
 *
 * 先分别计算深度并抬升较深一侧，再同步上行；current 与 alternate 视为同一逻辑祖先。
 */
export function getLowestCommonAncestor(
  instA: Fiber,
  instB: Fiber,
  getParent: (inst: Fiber | null) => Fiber | null,
): Fiber | null {
  let nodeA: null | Fiber = instA;
  let nodeB: null | Fiber = instB;
  let depthA = 0;
  for (let tempA: null | Fiber = nodeA; tempA; tempA = getParent(tempA)) {
    depthA++;
  }
  let depthB = 0;
  for (let tempB: null | Fiber = nodeB; tempB; tempB = getParent(tempB)) {
    depthB++;
  }

  // A 更深时先抬升到相同深度。
  while (depthA - depthB > 0) {
    nodeA = getParent(nodeA);
    depthA--;
  }

  // B 更深时先抬升到相同深度。
  while (depthB - depthA > 0) {
    nodeB = getParent(nodeB);
    depthB--;
  }

  // 同步向上，直到节点相同或两者互为 alternate。
  let depth = depthA;
  while (depth--) {
    if (nodeA === nodeB || (nodeB !== null && nodeA === nodeB.alternate)) {
      return nodeA;
    }
    nodeA = getParent(nodeA);
    nodeB = getParent(nodeB);
  }
  return null;
}
