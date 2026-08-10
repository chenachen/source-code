/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactInternalTypes';
import type {ViewTransitionProps} from 'shared/ReactTypes';
import {runWithFiberInDEV} from './ReactCurrentFiber';

/**
 * 在开发环境记录已经挂载且具有显式名称的 ViewTransition Fiber。
 *
 * 同名组件会让浏览器的 View Transition 失败，因此这里保存名称到 Fiber 的
 * 映射以生成重复名称警告。严格来说命名空间属于各个 Document，并且还应纳入
 * React 之外手动设置的 `view-transition-name`；当前实现为了保持轻量而使用
 * 一个进程级 Map。
 */
const mountedNamedViewTransitions: Map<string, Fiber> = __DEV__
  ? new Map()
  : (null as any);
/** 已经发出过重复名称警告的集合，避免同一个名称反复刷屏。 */
const didWarnAboutName: {
  /** View Transition 名称到“已警告”标记的映射。 */
  [string]: boolean
} = __DEV__ ? {} : (null as any);

/**
 * 把新挂载的具名 ViewTransition 加入开发期登记表。
 *
 * 首次遇到名称时保存对应 Fiber；再次遇到属于另一组件的同名 Fiber 时，分别在
 * 新旧组件上下文中输出一次诊断，从而让两端组件栈都能定位冲突。`auto` 没有
 * 稳定的用户命名空间，因此不会参与登记。
 */
export function trackNamedViewTransition(fiber: Fiber): void {
  if (__DEV__) {
    const name = (fiber.memoizedProps as ViewTransitionProps).name;
    if (name != null && name !== 'auto') {
      const existing = mountedNamedViewTransitions.get(name);
      if (existing !== undefined) {
        if (existing !== fiber && existing !== fiber.alternate) {
          if (!didWarnAboutName[name]) {
            didWarnAboutName[name] = true;
            const stringifiedName = JSON.stringify(name);
            runWithFiberInDEV(fiber, () => {
              console.error(
                'There are two <ViewTransition name=%s> components with the same name mounted ' +
                  'at the same time. This is not supported and will cause View Transitions ' +
                  'to error. Try to use a more unique name e.g. by using a namespace prefix ' +
                  'and adding the id of an item to the name.',
                stringifiedName,
              );
            });
            runWithFiberInDEV(existing, () => {
              console.error(
                'The existing <ViewTransition name=%s> duplicate has this stack trace.',
                stringifiedName,
              );
            });
          }
        }
      } else {
        mountedNamedViewTransitions.set(name, fiber);
      }
    }
  }
}

/**
 * 在具名 ViewTransition 卸载时撤销登记。
 *
 * 只有登记值确实是当前 Fiber 或它的 alternate 才会删除，防止旧树的卸载过程
 * 误删同名的新树记录。
 */
export function untrackNamedViewTransition(fiber: Fiber): void {
  if (__DEV__) {
    const name = (fiber.memoizedProps as ViewTransitionProps).name;
    if (name != null && name !== 'auto') {
      const existing = mountedNamedViewTransitions.get(name);
      if (
        existing !== undefined &&
        (existing === fiber || existing === fiber.alternate)
      ) {
        mountedNamedViewTransitions.delete(name);
      }
    }
  }
}
