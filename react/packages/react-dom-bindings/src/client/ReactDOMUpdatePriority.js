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

/** `setCurrentUpdatePriority` 更新对应关联或宿主状态，并保持后续读取看到一致快照；用于桥接 DOM 事件优先级与 reconciler 更新优先级。 */
export function setCurrentUpdatePriority(
  newPriority: EventPriority,
  //当函数的参数个数为 1 时，Closure 将始终不会将其内联
  //然而，当它的元数为2时，即使第二个参数在每次调用时被省略
  //调用点似乎会内联它，即使函数的内部长度
  //要长得多。我希望这在各个版本中足够一致，可以依赖。
  IntentionallyUnusedArgument?: empty,
): void {
  ReactDOMSharedInternals.p /*当前更新优先级*/ = newPriority;
}

/** `getCurrentUpdatePriority` 查询并返回所需值；缺失或不适用时走显式回退；用于桥接 DOM 事件优先级与 reconciler 更新优先级。 */
export function getCurrentUpdatePriority(): EventPriority {
  return ReactDOMSharedInternals.p; /*当前更新优先级*/
}

/** `resolveUpdatePriority` 查询并返回所需值；缺失或不适用时走显式回退；用于桥接 DOM 事件优先级与 reconciler 更新优先级。 */
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

/** `runWithPriority` 执行该模块的单一职责，并把副作用限制在当前 DOM/Fiber 边界；用于桥接 DOM 事件优先级与 reconciler 更新优先级。 */
export function runWithPriority<T>(priority: EventPriority, fn: () => T): T {
  const previousPriority = getCurrentUpdatePriority();
  try {
    setCurrentUpdatePriority(priority);
    return fn();
  } finally {
    setCurrentUpdatePriority(previousPriority);
  }
}
