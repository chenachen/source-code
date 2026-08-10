/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {
  enableDefaultTransitionIndicator,
  enableViewTransition,
} from 'shared/ReactFeatureFlags';

/** 当前 root commit 是否发生过可见宿主 mutation。 */
export let rootMutationContext: boolean = false;
/** 当前嵌套 ViewTransition 边界内是否发生过宿主 mutation。 */
export let viewTransitionMutationContext: boolean = false;

/** 在 root mutation traversal 开始时清空构建启用的追踪上下文。 */
export function pushRootMutationContext(): void {
  if (enableDefaultTransitionIndicator) {
    rootMutationContext = false;
  }
  if (enableViewTransition) {
    viewTransitionMutationContext = false;
  }
}

/** 进入嵌套 ViewTransition mutation 范围，返回外层状态并清空内层累计。 */
export function pushMutationContext(): boolean {
  if (!enableViewTransition) {
    return false;
  }
  const prev = viewTransitionMutationContext;
  viewTransitionMutationContext = false;
  return prev;
}

/** 离开嵌套范围，把内层 mutation 汇总到 root，再恢复外层边界状态。 */
export function popMutationContext(prev: boolean): void {
  if (enableViewTransition) {
    if (viewTransitionMutationContext) {
      rootMutationContext = true;
    }
    viewTransitionMutationContext = prev;
  }
}

/** 标记一次宿主 mutation；该极热函数须保持可内联的单次布尔写入路径。 */
export function trackHostMutation(): void {
  // 这是极热函数，必须保持可内联，不要添加额外工作。
  if (enableViewTransition) {
    viewTransitionMutationContext = true;
  } else if (enableDefaultTransitionIndicator) {
    // ViewTransition 开启时只写内层变量，并在 pop 汇总，避免热路径执行超过一次操作。
    rootMutationContext = true;
  }
}
