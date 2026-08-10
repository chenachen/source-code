/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  needsStateRestore,
  restoreStateIfNeeded,
} from './ReactDOMControlledComponent';

import {
  batchedUpdates as batchedUpdatesImpl,
  discreteUpdates as discreteUpdatesImpl,
  flushSyncWork,
} from 'react-reconciler/src/ReactFiberReconciler';

// 当调用方没有 renderer 引用时，通过这里调用 batchedUpdates，
// 例如事件分发或第三方
// 库需要批量更新的场景。所有更新默认批处理后，该 API 将被移除，
// 届时会提供相反的 API，用于退出默认调度
// 并强制同步执行。

let isInsideEventHandler = false;

/** finishEventHandler 建立把事件回调包进 reconciler batching/discrete 更新，并在批次末恢复受控状态的批次边界，并在退出时完成受控状态恢复或队列清理。 */
function finishEventHandler() {
  // 这里必须等待全部更新传播完成，这对
  // 跨层级使用受控组件尤其重要：
  // 参考：https://github.com/facebook/react/issues/1698
  // 之后再恢复所有受控组件的 DOM 状态。
  const controlledComponentsHavePendingUpdates = needsStateRestore();
  if (controlledComponentsHavePendingUpdates) {
    // 受控事件触发后，可能需要把
    // DOM 节点恢复为 props 中的受控值；当 React
    // bailout 且没有触碰 DOM 时尤其必要。
    // TODO：改为在离散更新冲刷后的微任务中恢复状态，
    // 而不是在这里提前冲刷。
    // @TODO 移除 legacy mode 后应迁移到 flushSyncWork；但由于这次 flushSync
    // 由于当前冲刷还会触发 passive effects，暂时无法这样做。
    flushSyncWork();
    restoreStateIfNeeded();
  }
}

/** batchedUpdates 建立把事件回调包进 reconciler batching/discrete 更新，并在批次末恢复受控状态的批次边界，并在退出时完成受控状态恢复或队列清理。 */
export function batchedUpdates(fn, a, b) {
  if (isInsideEventHandler) {
    // 若当前仍位于另一批次内部，必须等它
    // 完全结束后再恢复状态。
    return fn(a, b);
  }
  isInsideEventHandler = true;
  try {
    return batchedUpdatesImpl(fn, a, b);
  } finally {
    isInsideEventHandler = false;
    finishEventHandler();
  }
}

// TODO：替换为 flushSync。
/** discreteUpdates 建立把事件回调包进 reconciler batching/discrete 更新，并在批次末恢复受控状态的批次边界，并在退出时完成受控状态恢复或队列清理。 */
export function discreteUpdates(fn, a, b, c, d) {
  return discreteUpdatesImpl(fn, a, b, c, d);
}
