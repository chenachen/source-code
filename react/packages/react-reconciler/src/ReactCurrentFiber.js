/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactInternalTypes';

import ReactSharedInternals from 'shared/ReactSharedInternals';
import {getOwnerStackByFiberInDev} from './ReactFiberComponentStack';
import {getComponentNameFromOwner} from 'react-reconciler/src/getComponentNameFromFiber';

/** 开发期当前执行/诊断上下文的 Fiber；不参与生产调度状态。 */
export let current: Fiber | null = null;
/** 开发期标记用户组件 render 是否正在执行，用于检测非法更新与生成警告。 */
export let isRendering: boolean = false;

/** 返回当前 Fiber owner 的显示名；无 owner、无当前 Fiber 或生产构建时返回 null。 */
export function getCurrentFiberOwnerNameInDevOrNull(): string | null {
  if (__DEV__) {
    if (current === null) {
      return null;
    }
    const owner = current._debugOwner;
    if (owner != null) {
      return getComponentNameFromOwner(owner);
    }
  }
  return null;
}

/** 为 ReactSharedInternals 生成当前 Fiber 的 owner stack。 */
function getCurrentFiberStackInDev(): string {
  if (__DEV__) {
    if (current === null) {
      return '';
    }
    // 这里通常处于协调期并指向 work-in-progress，但该假设并不绝对：commit 阶段或抢占式
    // setState callback 也可能建立当前 Fiber。owner stack helper 必须容忍这些现场。
    return getOwnerStackByFiberInDev(current);
  }
  return '';
}

/**
 * 仅在开发构建中临时把回调归因到指定 Fiber，并在 finally 恢复前一现场。
 *
 * 若 Fiber 带 debug task，则通过 task.run 保留浏览器任务归因；生产构建调用属于内部错误。
 */
export function runWithFiberInDEV<A0, A1, A2, A3, A4, T>(
  fiber: null | Fiber,
  callback: (A0, A1, A2, A3, A4) => T,
  arg0: A0,
  arg1: A1,
  arg2: A2,
  arg3: A3,
  arg4: A4,
): T {
  if (__DEV__) {
    const previousFiber = current;
    setCurrentFiber(fiber);
    try {
      if (fiber !== null && fiber._debugTask) {
        return fiber._debugTask.run(
          callback.bind(null, arg0, arg1, arg2, arg3, arg4),
        );
      }
      return callback(arg0, arg1, arg2, arg3, arg4);
    } finally {
      setCurrentFiber(previousFiber);
    }
  }
  // 此路径不应进入生产构建，因此错误无需登记到 codes.json。
  // eslint-disable-next-line react-internal/prod-error-codes
  throw new Error(
    'runWithFiberInDEV should never be called in production. This is a bug in React.',
  );
}

/** 清空开发期当前 Fiber、render 标记与对外 stack getter。 */
export function resetCurrentFiber() {
  if (__DEV__) {
    ReactSharedInternals.getCurrentStack = null;
    isRendering = false;
  }
  current = null;
}

/** 设置当前诊断 Fiber，并同步安装 ReactSharedInternals 的 stack getter。 */
export function setCurrentFiber(fiber: Fiber | null) {
  if (__DEV__) {
    ReactSharedInternals.getCurrentStack =
      fiber === null ? null : getCurrentFiberStackInDev;
    isRendering = false;
  }
  current = fiber;
}

/** 更新开发期“正在 render 用户组件”标记；生产构建为空操作。 */
export function setIsRendering(rendering: boolean) {
  if (__DEV__) {
    isRendering = rendering;
  }
}

/** 读取开发期 render 标记；生产构建返回 void，避免形成运行时依赖。 */
export function getIsRendering(): void | boolean {
  if (__DEV__) {
    return isRendering;
  }
}
