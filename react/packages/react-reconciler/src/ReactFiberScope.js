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
  ReactScopeInstance,
  ReactContext,
  ReactScopeQuery,
} from 'shared/ReactTypes';

import {
  getPublicInstance,
  getInstanceFromNode,
  getInstanceFromScope,
} from './ReactFiberConfig';
import {isFiberSuspenseAndTimedOut} from './ReactFiberTreeReflection';

import {HostComponent, ScopeComponent, ContextProvider} from './ReactWorkTags';
import {enableScopeAPI} from 'shared/ReactFeatureFlags';

/** 从已超时 Suspense 的 Offscreen 主分支跳到 fallback 子树首节点。 */
function getSuspenseFallbackChild(fiber: Fiber): Fiber | null {
  return ((fiber.child as any as Fiber).sibling as any as Fiber).child;
}

/** HostComponent 没有 memoizedProps 时传给 Scope 查询谓词的稳定空对象。 */
const emptyObject = {};

/**
 * 深度优先收集 Scope 子树中满足查询谓词的公开宿主实例。
 * 已显示 fallback 的 Suspense 只遍历可见 fallback，而不进入隐藏主内容。
 */
function collectScopedNodes(
  node: Fiber,
  fn: ReactScopeQuery,
  scopedNodes: Array<any>,
): void {
  if (enableScopeAPI) {
    if (node.tag === HostComponent) {
      const {type, memoizedProps, stateNode} = node;
      const instance = getPublicInstance(stateNode);
      if (
        // $FlowFixMe[invalid-compare]
        instance !== null &&
        fn(type, memoizedProps || emptyObject, instance) === true
      ) {
        scopedNodes.push(instance);
      }
    }
    let child = node.child;

    if (isFiberSuspenseAndTimedOut(node)) {
      child = getSuspenseFallbackChild(node);
    }
    if (child !== null) {
      collectScopedNodesFromChildren(child, fn, scopedNodes);
    }
  }
}

/** 深度优先返回 Scope 子树中首个满足谓词的公开宿主实例。 */
function collectFirstScopedNode(
  node: Fiber,
  fn: ReactScopeQuery,
): null | Object {
  if (enableScopeAPI) {
    if (node.tag === HostComponent) {
      const {type, memoizedProps, stateNode} = node;
      const instance = getPublicInstance(stateNode);
      // $FlowFixMe[invalid-compare]
      if (instance !== null && fn(type, memoizedProps, instance) === true) {
        return instance;
      }
    }
    let child = node.child;

    if (isFiberSuspenseAndTimedOut(node)) {
      child = getSuspenseFallbackChild(node);
    }
    if (child !== null) {
      return collectFirstScopedNodeFromChildren(child, fn);
    }
  }
  return null;
}

/** 遍历一组 sibling 子树，把所有查询命中项追加到输出数组。 */
function collectScopedNodesFromChildren(
  startingChild: Fiber,
  fn: ReactScopeQuery,
  scopedNodes: Array<any>,
): void {
  let child: null | Fiber = startingChild;
  while (child !== null) {
    collectScopedNodes(child, fn, scopedNodes);
    child = child.sibling;
  }
}

/** 按 sibling 顺序查找首个命中节点，找到后立即停止遍历。 */
function collectFirstScopedNodeFromChildren(
  startingChild: Fiber,
  fn: ReactScopeQuery,
): Object | null {
  let child: null | Fiber = startingChild;
  while (child !== null) {
    const scopedNode = collectFirstScopedNode(child, fn);
    if (scopedNode !== null) {
      return scopedNode;
    }
    child = child.sibling;
  }
  return null;
}

/**
 * 收集当前子树每条路径上最近的目标 Context Provider 值。
 * 命中 Provider 后不再深入它的后代，确保只返回离 Scope 最近的一层覆盖值。
 */
function collectNearestContextValues<T>(
  node: Fiber,
  context: ReactContext<T>,
  childContextValues: Array<T>,
): void {
  if (node.tag === ContextProvider && node.type === context) {
    const contextValue = node.memoizedProps.value;
    childContextValues.push(contextValue);
  } else {
    let child = node.child;

    if (isFiberSuspenseAndTimedOut(node)) {
      child = getSuspenseFallbackChild(node);
    }
    if (child !== null) {
      collectNearestChildContextValues(child, context, childContextValues);
    }
  }
}

/** 遍历 sibling 子树并收集各分支最近的目标 Context 值。 */
function collectNearestChildContextValues<T>(
  startingChild: Fiber | null,
  context: ReactContext<T>,
  childContextValues: Array<T>,
): void {
  let child = startingChild;
  while (child !== null) {
    collectNearestContextValues(child, context, childContextValues);
    child = child.sibling;
  }
}

/**
 * Scope 实例的实验查询 API：返回全部满足谓词的公开宿主实例，无命中时为空。
 */
function DO_NOT_USE_queryAllNodes(
  this: $FlowFixMe,
  fn: ReactScopeQuery,
): null | Array<Object> {
  const currentFiber = getInstanceFromScope(this);
  // $FlowFixMe[invalid-compare]
  if (currentFiber === null) {
    return null;
  }
  const child = currentFiber.child;
  const scopedNodes: Array<any> = [];
  // $FlowFixMe[invalid-compare]
  if (child !== null) {
    collectScopedNodesFromChildren(child, fn, scopedNodes);
  }
  return scopedNodes.length === 0 ? null : scopedNodes;
}

/** Scope 实例的实验查询 API：返回首个满足谓词的公开宿主实例。 */
function DO_NOT_USE_queryFirstNode(
  this: $FlowFixMe,
  fn: ReactScopeQuery,
): null | Object {
  const currentFiber = getInstanceFromScope(this);
  // $FlowFixMe[invalid-compare]
  if (currentFiber === null) {
    return null;
  }
  const child = currentFiber.child;
  // $FlowFixMe[invalid-compare]
  if (child !== null) {
    return collectFirstScopedNodeFromChildren(child, fn);
  }
  return null;
}

/** 判断给定公开宿主节点的 Fiber 祖先链是否包含当前 Scope 实例。 */
function containsNode(this: $FlowFixMe, node: Object): boolean {
  let fiber = getInstanceFromNode(node);
  while (fiber !== null) {
    if (fiber.tag === ScopeComponent && fiber.stateNode === this) {
      return true;
    }
    fiber = fiber.return;
  }
  return false;
}

/** 返回当前 Scope 各分支最近的指定 Context Provider 值。 */
function getChildContextValues<T>(
  this: $FlowFixMe,
  context: ReactContext<T>,
): Array<T> {
  const currentFiber = getInstanceFromScope(this);
  // $FlowFixMe[invalid-compare]
  if (currentFiber === null) {
    return [];
  }
  const child = currentFiber.child;
  const childContextValues: Array<T> = [];
  // $FlowFixMe[invalid-compare]
  if (child !== null) {
    collectNearestChildContextValues(child, context, childContextValues);
  }
  return childContextValues;
}

/** 创建暴露给 React Scope ref 的查询对象，并绑定其内部遍历实现。 */
export function createScopeInstance(): ReactScopeInstance {
  return {
    DO_NOT_USE_queryAllNodes,
    DO_NOT_USE_queryFirstNode,
    containsNode,
    getChildContextValues,
  };
}
