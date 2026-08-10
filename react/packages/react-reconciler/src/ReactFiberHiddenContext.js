/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactInternalTypes';
import type {StackCursor} from './ReactFiberStack';
import type {Lanes} from './ReactFiberLane';

import {createCursor, push, pop} from './ReactFiberStack';

import {
  getEntangledRenderLanes,
  setEntangledRenderLanes,
} from './ReactFiberWorkLoop';
import {NoLanes, mergeLanes} from './ReactFiberLane';

// TODO：以 hidden context 完全替代独立 renderLanes context。
/** hidden 子树恢复时必须一并处理的基础 Lanes。 */
type HiddenContext = {
  /** 显示 hidden 内容时必须包含的此前跳过 Lanes；TODO：以它替代 work loop subtreeLanes context。 */
  baseLanes: number,
  ...
};

/** 当前树是否位于 hidden 上下文；目标是替代 SuspenseContext 的 InvisibleParentContext。 */
export const currentTreeHiddenStackCursor: StackCursor<HiddenContext | null> =
  createCursor(null);
/** 进入 hidden 子树前的 entangled render Lanes，用于退出时恢复。 */
export const prevEntangledRenderLanesCursor: StackCursor<Lanes> =
  createCursor(NoLanes);

/**
 * 压入 hidden 上下文，并把此前为隐藏而跳过的 baseLanes 纠缠进当前 render。
 * 这样 hidden→visible 的提交会同时包含所有被延后的更新，不泄漏部分状态。
 */
export function pushHiddenContext(fiber: Fiber, context: HiddenContext): void {
  const prevEntangledRenderLanes = getEntangledRenderLanes();
  push(prevEntangledRenderLanesCursor, prevEntangledRenderLanes, fiber);
  push(currentTreeHiddenStackCursor, context, fiber);

  // 恢复可见时必须提交最初隐藏树时跳过的全部 Lanes。
  setEntangledRenderLanes(
    mergeLanes(prevEntangledRenderLanes, context.baseLanes),
  );
}

/** 为未隐藏子树复用当前 context 值，维持 push/pop 栈深而不增加 render Lanes。 */
export function reuseHiddenContextOnStack(fiber: Fiber): void {
  // 子树当前可见，无需加 Lane；仍需压栈占位，避免退出时 cursor 错配。
  push(prevEntangledRenderLanesCursor, getEntangledRenderLanes(), fiber);
  push(
    currentTreeHiddenStackCursor,
    currentTreeHiddenStackCursor.current,
    fiber,
  );
}

/** 恢复进入 hidden 子树前的 entangled Lanes，并成对弹出两个 cursor。 */
export function popHiddenContext(fiber: Fiber): void {
  // 先恢复外层 render Lanes，再弹出当前 Fiber 对应值。
  setEntangledRenderLanes(prevEntangledRenderLanesCursor.current);

  pop(currentTreeHiddenStackCursor, fiber);
  pop(prevEntangledRenderLanesCursor, fiber);
}

/** 判断当前 Fiber 栈是否位于 hidden 子树。 */
export function isCurrentTreeHidden(): boolean {
  return currentTreeHiddenStackCursor.current !== null;
}
