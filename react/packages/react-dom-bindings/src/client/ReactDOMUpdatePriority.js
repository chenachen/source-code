/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {EventPriority} from 'react-reconciler/src/ReactEventPriorities';

import {getEventPriority} from '../events/ReactDOMEventListener';
import {
  NoEventPriority,
  DefaultEventPriority,
} from 'react-reconciler/src/ReactEventPriorities';

import ReactDOMSharedInternals from 'shared/ReactDOMSharedInternals';

/** 写入 DOM shared internals 的当前更新优先级，供 reconciler 请求 lane。 */
export function setCurrentUpdatePriority(
  newPriority: EventPriority,
  // 保留未使用的第二参数，意在让 Closure 按二参数函数进行内联优化。
  IntentionallyUnusedArgument?: empty,
): void {
  ReactDOMSharedInternals.p /*当前更新优先级*/ = newPriority;
}

/** 读取当前显式更新优先级；NoEventPriority 表示尚未设置。 */
export function getCurrentUpdatePriority(): EventPriority {
  return ReactDOMSharedInternals.p; /*当前更新优先级*/
}

/** 优先取显式更新优先级，否则按 window.event 映射；无原生事件则取 DefaultEventPriority。 */
export function resolveUpdatePriority(): EventPriority {
  const updatePriority = ReactDOMSharedInternals.p; /*当前更新优先级*/
  if (updatePriority !== NoEventPriority) {
    return updatePriority;
  }
  const currentEvent = window.event;
  if (currentEvent === undefined) {
    return DefaultEventPriority;
  }
  return getEventPriority(currentEvent.type);
}

/** 在指定更新优先级下执行回调，finally 还原原优先级。 */
export function runWithPriority<T>(priority: EventPriority, fn: () => T): T {
  const previousPriority = getCurrentUpdatePriority();
  try {
    setCurrentUpdatePriority(priority);
    return fn();
  } finally {
    setCurrentUpdatePriority(previousPriority);
  }
}
