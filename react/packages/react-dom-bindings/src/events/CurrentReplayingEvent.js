/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */
import type {AnyNativeEvent} from '../events/PluginModuleType';

// 该独立模块用于避免 ReactDOMEventReplaying
// 与 DOMPluginEventSystem 形成循环依赖。

let currentReplayingEvent = null;

/** setReplayingEvent 更新维护当前正在重放的原生事件哨兵，防止 replay 路径递归处理同一事件的模块状态或 DOM 状态；重复调用需保持队列顺序与恢复幂等性。 */
export function setReplayingEvent(event: AnyNativeEvent): void {
  if (__DEV__) {
    if (currentReplayingEvent !== null) {
      console.error(
        'Expected currently replaying event to be null. This error ' +
          'is likely caused by a bug in React. Please file an issue.',
      );
    }
  }
  currentReplayingEvent = event;
}

/** resetReplayingEvent 更新维护当前正在重放的原生事件哨兵，防止 replay 路径递归处理同一事件的模块状态或 DOM 状态；重复调用需保持队列顺序与恢复幂等性。 */
export function resetReplayingEvent(): void {
  if (__DEV__) {
    if (currentReplayingEvent === null) {
      console.error(
        'Expected currently replaying event to not be null. This error ' +
          'is likely caused by a bug in React. Please file an issue.',
      );
    }
  }
  currentReplayingEvent = null;
}

/** isReplayingEvent 判断维护当前正在重放的原生事件哨兵，防止 replay 路径递归处理同一事件的前置条件；返回值用于在热路径提前跳过不适用分支。 */
export function isReplayingEvent(event: AnyNativeEvent): boolean {
  return event === currentReplayingEvent;
}
