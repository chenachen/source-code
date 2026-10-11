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

/** 恢复前重新查询节点的 Fiber 和最新 props，再调用对应表单 restore；已无关联的节点跳过。 */
function restoreStateOfTarget(target: Node) {
  // 最外事件 batch 结束且同步工作已冲刷，再查询节点关联与当前 props。
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

/** 登记浏览器改动过的控件；首个目标单独保存，随后目标放入数组，不按节点身份去重。 */
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

/** 检查最外事件批次结束时是否还有待恢复控件。 */
export function needsStateRestore(): boolean {
  return restoreTarget !== null || restoreQueue !== null;
}

/**
 * 先取出并清空恢复队列，再按当前已提交 props 恢复各控件，使重入事件登记到下一份队列。
 * 已卸载目标跳过；恢复抛错会向外传播，尚未遍历的旧队列目标不会重新排队。
 */
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
