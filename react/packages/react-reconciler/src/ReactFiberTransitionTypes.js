/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {FiberRoot} from './ReactInternalTypes';
import type {TransitionTypes} from 'react/src/ReactTransitionType';

import {enableViewTransition} from 'shared/ReactFeatureFlags';
import {includesTransitionLane} from './ReactFiberLane';

/**
 * 把本次更新声明的 View Transition 类型去重后加入 root。
 * 只有 root 仍含 transition Lane 时才记录；当前假设所有 transitions 已纠缠，未来应改为 LaneMap。
 */
export function queueTransitionTypes(
  root: FiberRoot,
  transitionTypes: TransitionTypes,
): void {
  if (enableViewTransition) {
    // TODO：按 LaneMap 存储并在 commit 合并，移除“所有 transition 都已纠缠”的假设。
    if (includesTransitionLane(root.pendingLanes)) {
      let queued = root.transitionTypes;
      if (queued === null) {
        queued = root.transitionTypes = [];
      }
      for (let i = 0; i < transitionTypes.length; i++) {
        const transitionType = transitionTypes[i];
        if (queued.indexOf(transitionType) === -1) {
          queued.push(transitionType);
        }
      }
    }
  }
}

/** 异步 actions 仍纠缠期间跨 await 累积的去重 transition 类型。 */
export let entangledTransitionTypes: null | TransitionTypes = null;

/** 把异步 transition 类型去重合并到全局 entangled 集合。 */
export function entangleAsyncTransitionTypes(
  transitionTypes: TransitionTypes,
): void {
  if (enableViewTransition) {
    let queued = entangledTransitionTypes;
    if (queued === null) {
      queued = entangledTransitionTypes = [];
    }
    for (let i = 0; i < transitionTypes.length; i++) {
      const transitionType = transitionTypes[i];
      if (queued.indexOf(transitionType) === -1) {
        queued.push(transitionType);
      }
    }
  }
}

/** 全部 Async Actions 结束后释放跨 await 累积的 transition 类型。 */
export function clearEntangledAsyncTransitionTypes() {
  // 仅在整组纠缠的 Async Actions 全部结束后调用。
  entangledTransitionTypes = null;
}

/** 原子取走 root 已排队 transition 类型并清空 root 槽。 */
export function claimQueuedTransitionTypes(
  root: FiberRoot,
): null | TransitionTypes {
  const claimed = root.transitionTypes;
  root.transitionTypes = null;
  return claimed;
}
