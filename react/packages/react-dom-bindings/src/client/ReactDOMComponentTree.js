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

/** 本 React 副本的随机后缀，隔离同一 DOM 上不同副本的内部字段。 */
const randomKey = Math.random().toString(36).slice(2);
/** DOM 节点上的 Host/边界 Fiber 关联键。 */
const internalInstanceKey = '__reactFiber$' + randomKey;
/** DOM 节点上的最新 props 缓存键；事件读取它而不是 Fiber.memoizedProps。 */
const internalPropsKey = '__reactProps$' + randomKey;
/** 容器上的 HostRoot Fiber 标记键。 */
const internalContainerInstanceKey = '__reactContainer$' + randomKey;
/** 节点已安装的原生事件名/阶段 Set 的键；节点复用时仍保留。 */
const internalEventHandlersKey = '__reactEvents$' + randomKey;
/** EventTarget 上 createEventHandle listener 集合的键。 */
const internalEventHandlerListenersKey = '__reactListeners$' + randomKey;
/** 目标已经使用过的 event handle 身份集合键，避免同一句柄重复注册。 */
const internalEventHandlesSetKey = '__reactHandles$' + randomKey;
/** Document/ShadowRoot 上 stylesheet 与 script 资源缓存的键。 */
const internalRootNodeResourcesKey = '__reactResources$' + randomKey;
/** 标记该节点由 React hoistable/resource 路径管理的键。 */
const internalHoistableMarker = '__reactMarker$' + randomKey;
/** 目标上 scrollend debounce 计时器的键。 */
const internalScrollTimer = '__reactScroll$' + randomKey;
/** 节点上等待重放 load 的标记键。 */
const internalLoadPendingKey = '__reactLoad$' + randomKey;

/** 实例映射允许关联的 DOM、文本、边界与 Scope 对象。 */
type InstanceUnion =
  | Instance
  | TextInstance
  | SuspenseInstance
  | ActivityInstance
  | ReactScopeInstance
  | Container;

/** 优先 WeakMap，环境缺失时回退 Map；用于可选的 Fiber/props 外部映射。 */
const PossiblyWeakMap = typeof WeakMap === 'function' ? WeakMap : Map;
/** 可选的实例到 Fiber 映射；删除实例时清除关联。 */
const internalInstanceMap:
  | WeakMap<InstanceUnion, Fiber>
  | Map<InstanceUnion, Fiber> = new PossiblyWeakMap();
/** 可选的实例到最新 props 映射，供事件 handler 查询。 */
const internalPropsMap:
  | WeakMap<InstanceUnion, Props>
  | Map<InstanceUnion, Props> = new PossiblyWeakMap();

/** 清除已删除实例的 Fiber、props 和 event-handle 关联；保留原生 listener Set，避免节点复用时重复安装。 */
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

/** 把 Host/边界 Fiber 写入实例映射或 DOM 字段，供事件和 hydration 反向查找。 */
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

/** 在容器上登记 HostRoot Fiber。 */
export function markContainerAsRoot(hostRoot: Fiber, node: Container): void {
  // $FlowFixMe[prop-missing]
  node[internalContainerInstanceKey] = hostRoot;
}

/** 释放容器的根标记；原生根 listener 由容器去重标记继续保留。 */
export function unmarkContainerAsRoot(node: Container): void {
  // $FlowFixMe[prop-missing]
  node[internalContainerInstanceKey] = null;
}

/** 检查容器是否仍登记为某个 React 根。 */
export function isContainerMarkedAsRoot(node: Container): boolean {
  // $FlowFixMe[prop-missing]
  return !!node[internalContainerInstanceKey];
}

/**
 * 从事件目标反查最近 React Fiber；先取直接关联，再沿 DOM 父链检查根和未 hydration 边界。
 * 父节点同时属于外层宿主和内层根时优先内层 HostRoot，使其能阻塞尚未 hydration 的事件。
 * HostRoot 容器标记只在父链读取，target 本身为容器时不会命中它自己的 HostRoot。
 * 返回值还需由事件入口检查 mounted/dehydrated 状态，本函数不决定是否可派发。
 */
export function getClosestInstanceFromNode(targetNode: Node): null | Fiber {
  let targetInst: void | Fiber;
  if (enableInternalInstanceMap) {
    targetInst = internalInstanceMap.get(targetNode as any as InstanceUnion);
  } else {
    targetInst = (targetNode as any)[internalInstanceKey];
  }
  if (targetInst) {
    // 直接目标已有实例关联，无需再搜索根或未 hydration 的边界。
    return targetInst;
  }
  // 未关联的目标可能是用户插入的节点，也可能属于尚未 hydration 的服务端子树。
  let parentNode = targetNode.parentNode;
  while (parentNode) {
    // 先查父节点自己的 HostRoot，再查它作为外层根宿主实例的关联，
    // 使尚未 hydration 的嵌套根优先成为 blocker。
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
        // 子树存在 Fiber 时，检查跳过的 DOM 是否在尚未 hydration 的边界中。
        let hydrationInstance = getParentHydrationBoundary(targetNode);
        while (hydrationInstance !== null) {
          // 读取边界注释关联的 Suspense/Activity Fiber。已 hydration 的宿主目标
          // 通常在函数入口就命中实例，不会走到这条边界搜索路径。
          const targetFiber = enableInternalInstanceMap
            ? internalInstanceMap.get(hydrationInstance)
            : // $FlowFixMe[prop-missing]
              hydrationInstance[internalInstanceKey];
          if (targetFiber) {
            return targetFiber;
          }
          // 内层注释尚无 Fiber 时，继续找更外层、已被 React 认领的边界。
          hydrationInstance = getParentHydrationBoundary(hydrationInstance);
          // 没有已关联边界时回退父实例；事件入口还会检查 mounted/hydration 状态。
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
 * 读取节点直接关联的宿主、Suspense/Activity 或 HostRoot Fiber；无关联或 tag 不受支持时返回 null。
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
 * 返回 HostComponent/HostHoistable/HostSingleton/HostText Fiber 的 stateNode；其他 tag 抛错。
 */
export function getNodeFromInstance(inst: Fiber): Instance | TextInstance {
  const tag = inst.tag;
  if (
    tag === HostComponent ||
    tag === HostHoistable ||
    tag === HostSingleton ||
    tag === HostText
  ) {
    // 这些宿主 tag 的 stateNode 就是对应 DOM 元素或 Text。
    return inst.stateNode;
  }

  // 此 API 不沿组件树寻找 DOM；传入非宿主 Fiber 直接拒绝。
  throw new Error('getNodeFromInstance: Invalid argument.');
}

/** 读取 DOM 实例上的最新 props；没有关联时返回 null。 */
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

/** 替换实例的 props 缓存，使随后派发读取本次提交的 handler。 */
export function updateFiberProps(node: Instance, props: Props): void {
  if (enableInternalInstanceMap) {
    internalPropsMap.set(node, props);
    return;
  }
  (node as any)[internalPropsKey] = props;
}

/** 取得节点原生监听去重 Set；首次读取时创建并缓存空 Set。 */
export function getEventListenerSet(node: EventTarget): Set<string> {
  let elementListenerSet: Set<string> | void = (node as any)[
    internalEventHandlersKey
  ];
  if (elementListenerSet === undefined) {
    elementListenerSet = (node as any)[internalEventHandlersKey] = new Set();
  }
  return elementListenerSet;
}

/** 读取 Scope 实例关联的 Fiber，供 Scope API 定位 React 树。 */
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

/** 替换 EventTarget 的 createEventHandle listener 集合。 */
export function setEventHandlerListeners(
  scope: EventTarget | ReactScopeInstance,
  listeners: Set<ReactDOMEventHandleListener>,
): void {
  (scope as any)[internalEventHandlerListenersKey] = listeners;
}

/** 读取 EventTarget 的 event-handle listener 集合；未登记时返回 null。 */
export function getEventHandlerListeners(
  scope: EventTarget | ReactScopeInstance,
): null | Set<ReactDOMEventHandleListener> {
  return (scope as any)[internalEventHandlerListenersKey] || null;
}

/** 将句柄身份加入目标的已注册集合，首次使用时创建集合。 */
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

/** 按句柄身份检查目标是否已注册该 event handle。 */
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

/** 取得或创建该 Document/ShadowRoot 的 stylesheet 与 script 资源缓存。 */
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

/** 检查节点是否被标记为 React 管理的 hoistable。 */
export function isMarkedHoistable(node: Node): boolean {
  return !!(node as any)[internalHoistableMarker];
}

/** 标记节点由 hoistable 路径管理。 */
export function markNodeAsHoistable(node: Node) {
  (node as any)[internalHoistableMarker] = true;
}

/** 读取目标当前 scrollend debounce 计时器。 */
export function getScrollEndTimer(node: EventTarget): ?TimeoutID {
  return (node as any)[internalScrollTimer];
}

/** 保存目标当前 scrollend debounce 计时器。 */
export function setScrollEndTimer(node: EventTarget, timer: TimeoutID): void {
  (node as any)[internalScrollTimer] = timer;
}

/** 把目标的 scrollend 计时器记录清空；实际 clearTimeout 由调用方完成。 */
export function clearScrollEndTimer(node: EventTarget): void {
  (node as any)[internalScrollTimer] = undefined;
}

/** 标记节点仍有待处理的 load。 */
export function markNodeAsPendingLoad(node: Node): void {
  (node as any)[internalLoadPendingKey] = true;
}

/** 清除节点的待处理 load 标记。 */
export function clearPendingLoadOnNode(node: Node): void {
  (node as any)[internalLoadPendingKey] = undefined;
}

/** 检查节点是否仍标记为等待 load。 */
export function isNodePendingLoad(node: Node): boolean {
  return (node as any)[internalLoadPendingKey] === true;
}

/** 检查节点是否关联当前 React 副本的 Fiber，或被当前副本标记为 hoistable。 */
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
