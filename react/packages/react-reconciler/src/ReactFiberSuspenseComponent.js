/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Wakeable, SuspenseListTailMode} from 'shared/ReactTypes';
import type {Fiber} from './ReactInternalTypes';
import type {SuspenseInstance} from './ReactFiberConfig';
import type {Lane} from './ReactFiberLane';
import type {TreeContext} from './ReactFiberTreeContext';
import type {CapturedValue} from './ReactCapturedValue';

import {SuspenseComponent, SuspenseListComponent} from './ReactWorkTags';
import {NoFlags, DidCapture} from './ReactFiberFlags';
import {
  isSuspenseInstancePending,
  isSuspenseInstanceFallback,
} from './ReactFiberConfig';

/**
 * Suspense 边界阻塞状态；memoizedState 为 null 表示正常显示 primary。
 * 非 null 且 dehydrated 非空表示等待 hydration，可由 HostConfig 查询 pending/fallback；
 * 非 null 且 dehydrated 为 null 表示客户端 thenable 挂起、当前显示 fallback。
 */
export type SuspenseState = {
  /** 服务端宿主 Suspense 边界；null 表示不是 dehydrated 状态。 */
  dehydrated: null | SuspenseInstance,
  /** 服务端树 id 上下文，用于 hydration 后保持 useId 稳定。 */
  treeContext: null | TreeContext,
  /** 下一次尝试 hydration 的 Lane；dehydrated 默认 Offscreen，普通边界默认 NoLane。 */
  retryLane: Lane,
  /** hydration 尝试期间暂存、待恢复路径报告的错误。 */
  hydrationErrors: Array<CapturedValue<mixed>> | null,
};

/** SuspenseList 本轮逐行 render 的方向、tail、计时与树 fork 状态。 */
export type SuspenseListRenderState = {
  /** 是否从末尾向前 reveal rows。 */
  isBackwards: boolean,
  /** 当前正在 render 的 tail row。 */
  rendering: null | Fiber,
  /** 最近一行开始 render 的绝对时间，用于时间预算判断。 */
  renderingStartTime: number,
  /** 已完成 children 链的最后一行。 */
  last: null | Fiber,
  /** 尚未 render 的 tail rows 链头。 */
  tail: null | Fiber,
  /** collapsed/hidden 等 tail 插入策略。 */
  tailMode: SuspenseListTailMode,
  /** 多 pass 期间累计的树 fork 数，用于恢复 useId 树上下文。 */
  treeForkCount: number,
};

/** Suspense commit 后需登记 ping listener 的 Wakeable 去重集合。 */
export type RetryQueue = Set<Wakeable>;

/**
 * 深度优先查找一行中第一个挂起的 Suspense/SuspenseList Fiber。
 * dehydrated pending/fallback、客户端 fallback 或非 independent 列表 DidCapture 都算挂起；遍历时修复 return 指针。
 */
export function findFirstSuspended(row: Fiber): null | Fiber {
  let node = row;
  // $FlowFixMe[invalid-compare]
  while (node !== null) {
    if (node.tag === SuspenseComponent) {
      const state: SuspenseState | null = node.memoizedState;
      if (state !== null) {
        const dehydrated: null | SuspenseInstance = state.dehydrated;
        if (
          dehydrated === null ||
          isSuspenseInstancePending(dehydrated) ||
          isSuspenseInstanceFallback(dehydrated)
        ) {
          return node;
        }
      }
    } else if (
      node.tag === SuspenseListComponent &&
      // independent revealOrder 不记录整体是否挂起，不能用 DidCapture 代表整行状态。
      node.memoizedProps.revealOrder !== 'independent'
    ) {
      const didSuspend = (node.flags & DidCapture) !== NoFlags;
      if (didSuspend) {
        return node;
      }
    } else if (node.child !== null) {
      node.child.return = node;
      node = node.child;
      continue;
    }
    if (node === row) {
      return null;
    }
    while (node.sibling === null) {
      if (node.return === null || node.return === row) {
        return null;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
  }
  return null;
}
