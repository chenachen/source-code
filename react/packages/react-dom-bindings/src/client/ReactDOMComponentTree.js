/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from 'react-reconciler/src/ReactInternalTypes';
import type {ReactScopeInstance} from 'shared/ReactTypes';
import type {
  ReactDOMEventHandle,
  ReactDOMEventHandleListener,
} from './ReactDOMEventHandleTypes';
import type {
  Container,
  TextInstance,
  Instance,
  ActivityInstance,
  SuspenseInstance,
  Props,
  HoistableRoot,
  RootResources,
} from './ReactFiberConfigDOM';

import {
  HostComponent,
  HostHoistable,
  HostSingleton,
  HostText,
  HostRoot,
  SuspenseComponent,
  ActivityComponent,
} from 'react-reconciler/src/ReactWorkTags';

import {getParentHydrationBoundary} from './ReactFiberConfigDOM';

import {enableScopeAPI} from 'shared/ReactFeatureFlags';

import {enableInternalInstanceMap} from 'shared/ReactFeatureFlags';

/** `randomKey` 保存维护 DOM 节点、Fiber、根容器和当前 props 的双向关联所需的共享索引、配置或模块级状态；生命周期覆盖当前 renderer。 */
const randomKey = Math.random().toString(36).slice(2);
/** `internalInstanceKey` 保存维护 DOM 节点、Fiber、根容器和当前 props 的双向关联所需的共享索引、配置或模块级状态；生命周期覆盖当前 renderer。 */
const internalInstanceKey = '__reactFiber$' + randomKey;
/** `internalPropsKey` 保存维护 DOM 节点、Fiber、根容器和当前 props 的双向关联所需的共享索引、配置或模块级状态；生命周期覆盖当前 renderer。 */
const internalPropsKey = '__reactProps$' + randomKey;
/** `internalContainerInstanceKey` 保存维护 DOM 节点、Fiber、根容器和当前 props 的双向关联所需的共享索引、配置或模块级状态；生命周期覆盖当前 renderer。 */
const internalContainerInstanceKey = '__reactContainer$' + randomKey;
/** `internalEventHandlersKey` 保存维护 DOM 节点、Fiber、根容器和当前 props 的双向关联所需的共享索引、配置或模块级状态；生命周期覆盖当前 renderer。 */
const internalEventHandlersKey = '__reactEvents$' + randomKey;
/** `internalEventHandlerListenersKey` 保存维护 DOM 节点、Fiber、根容器和当前 props 的双向关联所需的共享索引、配置或模块级状态；生命周期覆盖当前 renderer。 */
const internalEventHandlerListenersKey = '__reactListeners$' + randomKey;
/** `internalEventHandlesSetKey` 保存维护 DOM 节点、Fiber、根容器和当前 props 的双向关联所需的共享索引、配置或模块级状态；生命周期覆盖当前 renderer。 */
const internalEventHandlesSetKey = '__reactHandles$' + randomKey;
/** `internalRootNodeResourcesKey` 保存维护 DOM 节点、Fiber、根容器和当前 props 的双向关联所需的共享索引、配置或模块级状态；生命周期覆盖当前 renderer。 */
const internalRootNodeResourcesKey = '__reactResources$' + randomKey;
/** `internalHoistableMarker` 保存维护 DOM 节点、Fiber、根容器和当前 props 的双向关联所需的共享索引、配置或模块级状态；生命周期覆盖当前 renderer。 */
const internalHoistableMarker = '__reactMarker$' + randomKey;
/** `internalScrollTimer` 保存维护 DOM 节点、Fiber、根容器和当前 props 的双向关联所需的共享索引、配置或模块级状态；生命周期覆盖当前 renderer。 */
const internalScrollTimer = '__reactScroll$' + randomKey;
/** `internalLoadPendingKey` 保存维护 DOM 节点、Fiber、根容器和当前 props 的双向关联所需的共享索引、配置或模块级状态；生命周期覆盖当前 renderer。 */
const internalLoadPendingKey = '__reactLoad$' + randomKey;

/** `InstanceUnion` 定义维护 DOM 节点、Fiber、根容器和当前 props 的双向关联的数据契约；字段共同约束所有权、生命周期与跨模块传递边界。 */
type InstanceUnion =
  | Instance
  | TextInstance
  | SuspenseInstance
  | ActivityInstance
  | ReactScopeInstance
  | Container;

/** `PossiblyWeakMap` 保存维护 DOM 节点、Fiber、根容器和当前 props 的双向关联所需的共享索引、配置或模块级状态；生命周期覆盖当前 renderer。 */
const PossiblyWeakMap = typeof WeakMap === 'function' ? WeakMap : Map;
/** `internalInstanceMap` 保存维护 DOM 节点、Fiber、根容器和当前 props 的双向关联所需的共享索引、配置或模块级状态；生命周期覆盖当前 renderer。 */
const internalInstanceMap:
  | WeakMap<InstanceUnion, Fiber>
  | Map<InstanceUnion, Fiber> = new PossiblyWeakMap();
/** `internalPropsMap` 保存维护 DOM 节点、Fiber、根容器和当前 props 的双向关联所需的共享索引、配置或模块级状态；生命周期覆盖当前 renderer。 */
const internalPropsMap:
  | WeakMap<InstanceUnion, Props>
  | Map<InstanceUnion, Props> = new PossiblyWeakMap();

/** `detachDeletedInstance` 更新关联或宿主状态，使后续读取看到一致快照；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function detachDeletedInstance(node: Instance): void {
  //不要删除事件监听器集合。它跟踪的本地事件监听器
  //保持附着在节点上，所以这种记账需要持续
  //节点的生命周期，以防在重用时出现重复的监听器。
  if (enableInternalInstanceMap) {
    internalInstanceMap.delete(node);
    internalPropsMap.delete(node);
    delete (node as any)[internalEventHandlerListenersKey];
    delete (node as any)[internalEventHandlesSetKey];
    delete (node as any)[internalRootNodeResourcesKey];
    if (__DEV__) {
      delete (node as any)[internalInstanceKey];
    }
    return;
  }
  //待办：此函数仅在主机组件上调用。我认为并不是所有的
  //这些字段是相关的。
  delete (node as any)[internalInstanceKey];
  delete (node as any)[internalPropsKey];
  delete (node as any)[internalEventHandlerListenersKey];
  delete (node as any)[internalEventHandlesSetKey];
}

/** `precacheFiberNode` 更新关联或宿主状态，使后续读取看到一致快照；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function precacheFiberNode(
  hostInst: Fiber,
  node:
    | Instance
    | TextInstance
    | SuspenseInstance
    | ActivityInstance
    | ReactScopeInstance,
): void {
  if (enableInternalInstanceMap) {
    internalInstanceMap.set(node, hostInst);
    if (__DEV__) {
      (node as any)[internalInstanceKey] = hostInst;
    }
    return;
  }
  (node as any)[internalInstanceKey] = hostInst;
}

/** `markContainerAsRoot` 更新关联或宿主状态，使后续读取看到一致快照；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function markContainerAsRoot(hostRoot: Fiber, node: Container): void {
  // $FlowFixMe[prop-missing]
  node[internalContainerInstanceKey] = hostRoot;
}

/** `unmarkContainerAsRoot` 完成该模块的宿主边界操作；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function unmarkContainerAsRoot(node: Container): void {
  // $FlowFixMe[prop-missing]
  node[internalContainerInstanceKey] = null;
}

/** `isContainerMarkedAsRoot` 判断适用条件并返回只读结果；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function isContainerMarkedAsRoot(node: Container): boolean {
  // $FlowFixMe[prop-missing]
  return !!node[internalContainerInstanceKey];
}

//给定一个 DOM 节点，返回最近的 HostComponent 或 HostText fiber 祖先。
//如果目标节点是已水化或尚未渲染的子树的一部分，那么
//这也可能返回一个 SuspenseComponent、ActivityComponent 或 HostRoot 到
//指出那一点。
//从概念上讲，HostRoot fiber 是 Container 节点的子节点。所以如果你
//将容器节点作为 targetNode，你实际上不会得到
//返回 HostRoot。要到达 HostRoot，你需要经过它的一个子节点。
//同样的道理也适用于悬念和活动边界。
/** `getClosestInstanceFromNode` 查询所需宿主值；无匹配时走显式回退；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function getClosestInstanceFromNode(targetNode: Node): null | Fiber {
  let targetInst: void | Fiber;
  if (enableInternalInstanceMap) {
    targetInst = internalInstanceMap.get(targetNode as any as InstanceUnion);
  } else {
    targetInst = (targetNode as any)[internalInstanceKey];
  }
  if (targetInst) {
    //不要在这里返回 HostRoot、SuspenseComponent 或 ActivityComponent。
    return targetInst;
  }
  //如果直接的事件目标不是 React 拥有的 DOM 节点，我们需要查看
  //查看它的某个父节点是否是 React 拥有的 DOM 节点。
  let parentNode = targetNode.parentNode;
  while (parentNode) {
    //我们将检查这是否是可能包含内容的容器根
    //未来的 React 节点。我们需要先检查这个，因为
    //如果我们是一个已脱水容器的子元素，我们需要先
    //在去寻找父容器之前先找到内部容器
    //实例。请注意，我们不会检查 targetNode 上的此字段
    //本身因为纤维在概念上位于容器之间
    //节点和第一个子节点。它并没有包围容器节点。
    //如果它不是容器，则继续检查它是否为宿主实例。
    if (enableInternalInstanceMap) {
      targetInst =
        (parentNode as any)[internalContainerInstanceKey] ||
        internalInstanceMap.get(parentNode as any as InstanceUnion);
    } else {
      targetInst =
        (parentNode as any)[internalContainerInstanceKey] ||
        (parentNode as any)[internalInstanceKey];
    }
    if (targetInst) {
      // 此节点并非事件的直接目标；向上查找时可能跨过了脱水 DOM 节点，也可能只跨过非 React 节点，
      // 这里需要区分两种情况。

      // instance 没有子节点时，内部不可能嵌套 Suspense 边界，可直接快速退出。常见情况是调用方通过
      // ref 向一个原本无子节点的 DOM 节点添加非 React 子节点。
      // 通常只需检查 current/alternate 中一个 Fiber：若它曾在“有子节点”和“删除子节点”之间切换，
      // 内部原有的脱水边界早已被删除。HostRoot 从创建起就有 alternate，边界却可能只在 alternate 上，
      // 因此根节点场景必须检查两者。
      const alternate = targetInst.alternate;
      if (
        targetInst.child !== null ||
        (alternate !== null && alternate.child !== null)
      ) {
        //接下来我们需要弄清楚跳过的节点是否是
        //嵌套在一个脱水的边界内，如果是的话，是哪个。
        let hydrationInstance = getParentHydrationBoundary(targetNode);
        while (hydrationInstance !== null) {
          //我们发现了一个挂起实例。这意味着我们还没有
          //还没有给它补水。即使我们把评论留在
          //DOM 在水合之后，并且 DOM 中存在边界
          //那可能已经被水合了，我们就找不到它们了
          //通过这个通道，因为如果目标是水合的，它会
          //它上面有一个 internalInstanceKey。
          //让我们获取与 SuspenseComponent 关联的 fiber
          //作为最深的实例。
          const targetFiber = enableInternalInstanceMap
            ? internalInstanceMap.get(hydrationInstance)
            : // $FlowFixMe[prop-missing]
              hydrationInstance[internalInstanceKey];
          if (targetFiber) {
            return targetFiber;
          }
          //如果我们在评论中找不到 Fiber，可能是因为
          //我们还没有去给它补水。可能还会有一个
          //父边界没有高于这个边界，所以我们需要查找
          //已知的最外层。
          hydrationInstance = getParentHydrationBoundary(hydrationInstance);
          //如果我们找不到一个，那么这应该意味着父母
          //宿主组件尚未被水合。我们可以返回它
          //下面因为它之后会在 isMounted 检查时退出。
        }
      }
      return targetInst;
    }
    targetNode = parentNode;
    parentNode = targetNode.parentNode;
  }
  return null;
}

/**
 * 给定一个 DOM 节点，返回 ReactDOMComponent 或 ReactDOMTextComponent 实例，如果该节点不是由此 React 渲染的，则返回 null。
 */
export function getInstanceFromNode(node: Node): Fiber | null {
  let inst: void | null | Fiber;
  if (enableInternalInstanceMap) {
    inst =
      internalInstanceMap.get(node as any as InstanceUnion) ||
      (node as any)[internalContainerInstanceKey];
  } else {
    inst =
      (node as any)[internalInstanceKey] ||
      (node as any)[internalContainerInstanceKey];
  }
  if (inst) {
    const tag = inst.tag;
    if (
      tag === HostComponent ||
      tag === HostText ||
      tag === SuspenseComponent ||
      tag === ActivityComponent ||
      tag === HostHoistable ||
      tag === HostSingleton ||
      tag === HostRoot
    ) {
      return inst;
    } else {
      return null;
    }
  }
  return null;
}

/**
 * 给定一个 ReactDOMComponent 或 ReactDOMTextComponent，返回对应的 DOM 节点。
 */
export function getNodeFromInstance(inst: Fiber): Instance | TextInstance {
  const tag = inst.tag;
  if (
    tag === HostComponent ||
    tag === HostHoistable ||
    tag === HostSingleton ||
    tag === HostText
  ) {
    //在 Fiber 中，这现在只是状态节点。我们假设它将会是
    //一个宿主组件或宿主文本。
    return inst.stateNode;
  }

  //没有这个第一个不变量，传递一个非 DOM 组件会触发下一个
  //针对缺失父项的不变式，这非常令人困惑。
  throw new Error('getNodeFromInstance: Invalid argument.');
}

/** `getFiberCurrentPropsFromNode` 查询所需宿主值；无匹配时走显式回退；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function getFiberCurrentPropsFromNode(
  node:
    | Container
    | Instance
    | TextInstance
    | SuspenseInstance
    | ActivityInstance,
): Props | null {
  if (enableInternalInstanceMap) {
    return internalPropsMap.get(node) || null;
  }
  return (node as any)[internalPropsKey] || null;
}

/** `updateFiberProps` 更新关联或宿主状态，使后续读取看到一致快照；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function updateFiberProps(node: Instance, props: Props): void {
  if (enableInternalInstanceMap) {
    internalPropsMap.set(node, props);
    return;
  }
  (node as any)[internalPropsKey] = props;
}

/** `getEventListenerSet` 查询所需宿主值；无匹配时走显式回退；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function getEventListenerSet(node: EventTarget): Set<string> {
  let elementListenerSet: Set<string> | void = (node as any)[
    internalEventHandlersKey
  ];
  if (elementListenerSet === undefined) {
    elementListenerSet = (node as any)[internalEventHandlersKey] = new Set();
  }
  return elementListenerSet;
}

/** `getFiberFromScopeInstance` 查询所需宿主值；无匹配时走显式回退；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function getFiberFromScopeInstance(
  scope: ReactScopeInstance,
): null | Fiber {
  if (enableScopeAPI) {
    if (enableInternalInstanceMap) {
      return internalInstanceMap.get(scope as any as InstanceUnion) || null;
    }
    return (scope as any)[internalInstanceKey] || null;
  }
  return null;
}

/** `setEventHandlerListeners` 更新关联或宿主状态，使后续读取看到一致快照；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function setEventHandlerListeners(
  scope: EventTarget | ReactScopeInstance,
  listeners: Set<ReactDOMEventHandleListener>,
): void {
  (scope as any)[internalEventHandlerListenersKey] = listeners;
}

/** `getEventHandlerListeners` 查询所需宿主值；无匹配时走显式回退；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function getEventHandlerListeners(
  scope: EventTarget | ReactScopeInstance,
): null | Set<ReactDOMEventHandleListener> {
  return (scope as any)[internalEventHandlerListenersKey] || null;
}

/** `addEventHandleToTarget` 登记目标并保持现有监听器或宿主顺序；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function addEventHandleToTarget(
  target: EventTarget | ReactScopeInstance,
  eventHandle: ReactDOMEventHandle,
): void {
  let eventHandles = (target as any)[internalEventHandlesSetKey];
  if (eventHandles === undefined) {
    eventHandles = (target as any)[internalEventHandlesSetKey] = new Set();
  }
  eventHandles.add(eventHandle);
}

/** `doesTargetHaveEventHandle` 完成该模块的宿主边界操作；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function doesTargetHaveEventHandle(
  target: EventTarget | ReactScopeInstance,
  eventHandle: ReactDOMEventHandle,
): boolean {
  const eventHandles = (target as any)[internalEventHandlesSetKey];
  if (eventHandles === undefined) {
    return false;
  }
  return eventHandles.has(eventHandle);
}

/** `getResourcesFromRoot` 查询所需宿主值；无匹配时走显式回退；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function getResourcesFromRoot(root: HoistableRoot): RootResources {
  let resources = (root as any)[internalRootNodeResourcesKey];
  if (!resources) {
    resources = (root as any)[internalRootNodeResourcesKey] = {
      hoistableStyles: new Map(),
      hoistableScripts: new Map(),
    };
  }
  return resources;
}

/** `isMarkedHoistable` 判断适用条件并返回只读结果；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function isMarkedHoistable(node: Node): boolean {
  return !!(node as any)[internalHoistableMarker];
}

/** `markNodeAsHoistable` 更新关联或宿主状态，使后续读取看到一致快照；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function markNodeAsHoistable(node: Node) {
  (node as any)[internalHoistableMarker] = true;
}

/** `getScrollEndTimer` 查询所需宿主值；无匹配时走显式回退；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function getScrollEndTimer(node: EventTarget): ?TimeoutID {
  return (node as any)[internalScrollTimer];
}

/** `setScrollEndTimer` 更新关联或宿主状态，使后续读取看到一致快照；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function setScrollEndTimer(node: EventTarget, timer: TimeoutID): void {
  (node as any)[internalScrollTimer] = timer;
}

/** `clearScrollEndTimer` 清理对应状态，重复清理保持安全；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function clearScrollEndTimer(node: EventTarget): void {
  (node as any)[internalScrollTimer] = undefined;
}

/** `markNodeAsPendingLoad` 更新关联或宿主状态，使后续读取看到一致快照；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function markNodeAsPendingLoad(node: Node): void {
  (node as any)[internalLoadPendingKey] = true;
}

/** `clearPendingLoadOnNode` 清理对应状态，重复清理保持安全；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function clearPendingLoadOnNode(node: Node): void {
  (node as any)[internalLoadPendingKey] = undefined;
}

/** `isNodePendingLoad` 判断适用条件并返回只读结果；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function isNodePendingLoad(node: Node): boolean {
  return (node as any)[internalLoadPendingKey] === true;
}

/** `isOwnedInstance` 判断适用条件并返回只读结果；用于维护 DOM 节点、Fiber、根容器和当前 props 的双向关联。 */
export function isOwnedInstance(node: Node): boolean {
  if (enableInternalInstanceMap) {
    return !!(
      (node as any)[internalHoistableMarker] ||
      internalInstanceMap.has(node as any)
    );
  }
  return !!(
    (node as any)[internalHoistableMarker] || (node as any)[internalInstanceKey]
  );
}
