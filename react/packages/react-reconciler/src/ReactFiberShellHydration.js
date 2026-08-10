/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {FiberRoot} from './ReactInternalTypes';
import type {RootState} from './ReactFiberRoot';

/**
 * 判断 HostRoot 是否仍处于 shell hydration。
 * 单独成文件供 React DOM 事件 replay 导入，避免 renderer 与 reconciler 主模块形成循环依赖。
 */
export function isRootDehydrated(root: FiberRoot): boolean {
  const currentState: RootState = root.current.memoizedState;
  return currentState.isDehydrated;
}
