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

// 事件分发通过这个适配层进入 reconciler 的批处理，并在最外调用退出时恢复受控 DOM。
// 除更新调度上下文外，这里还管理嵌套事件的恢复时机，不能只理解为批处理 API 的别名。

let isInsideEventHandler = false;

/** 存在受控恢复目标时先 flushSyncWork，再按最终已提交 props 恢复 DOM。 */
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
    // 当前路径调用 flushSyncWork；恢复读取冲刷后节点上的 props 缓存。
    flushSyncWork();
    restoreStateIfNeeded();
  }
}

/** 最外事件调用建立批次；嵌套调用直接执行，只有最外 finally 执行受控恢复。 */
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
/** 转发到 reconciler 的离散更新上下文；此入口自身不管理受控恢复队列。 */
export function discreteUpdates(fn, a, b, c, d) {
  return discreteUpdatesImpl(fn, a, b, c, d);
}
