/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {
  getInstanceFromNode,
  getFiberCurrentPropsFromNode,
} from '../client/ReactDOMComponentTree';

import {restoreControlledState} from 'react-dom-bindings/src/client/ReactDOMComponent';

// 用于在 change 事件结束后恢复受控状态。

let restoreTarget = null;
let restoreQueue = null;

/** restoreStateOfTarget 更新排队并恢复受控表单状态，保证事件处理后的 DOM 与 props 一致的模块状态或 DOM 状态；重复调用需保持队列顺序与恢复幂等性。 */
function restoreStateOfTarget(target: Node) {
  // 该 Fiber 到 DOM 的转换放在事件循环末尾执行，以确保
  // 此处始终取得最新且正确的 Fiber。
  const internalInstance = getInstanceFromNode(target);
  if (!internalInstance) {
    // Fiber 已卸载。
    return;
  }

  const stateNode = internalInstance.stateNode;
  // 防止对已卸载 Fiber 执行状态恢复。
  if (stateNode) {
    const props = getFiberCurrentPropsFromNode(stateNode);
    restoreControlledState(
      internalInstance.stateNode,
      internalInstance.type,
      props,
    );
  }
}

/** enqueueStateRestore 更新排队并恢复受控表单状态，保证事件处理后的 DOM 与 props 一致的模块状态或 DOM 状态；重复调用需保持队列顺序与恢复幂等性。 */
export function enqueueStateRestore(target: Node): void {
  if (restoreTarget) {
    if (restoreQueue) {
      restoreQueue.push(target);
    } else {
      restoreQueue = [target];
    }
  } else {
    restoreTarget = target;
  }
}

/** needsStateRestore 执行排队并恢复受控表单状态，保证事件处理后的 DOM 与 props 一致的核心步骤；输入来自原生事件/Fiber，输出保持插件分发与调度边界。 */
export function needsStateRestore(): boolean {
  return restoreTarget !== null || restoreQueue !== null;
}

/** restoreStateIfNeeded 更新排队并恢复受控表单状态，保证事件处理后的 DOM 与 props 一致的模块状态或 DOM 状态；重复调用需保持队列顺序与恢复幂等性。 */
export function restoreStateIfNeeded() {
  if (!restoreTarget) {
    return;
  }
  const target = restoreTarget;
  const queuedTargets = restoreQueue;
  restoreTarget = null;
  restoreQueue = null;

  restoreStateOfTarget(target);
  if (queuedTargets) {
    for (let i = 0; i < queuedTargets.length; i++) {
      restoreStateOfTarget(queuedTargets[i]);
    }
  }
}
