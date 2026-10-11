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

/** 登记当前重放的原生事件；配对的 reset 在本轮原生 dispatch 之后清除哨兵。 */
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

/** 结束本轮重放并清空原生事件哨兵。 */
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

/** 按对象身份判断事件是否为当前正在重放的克隆。 */
export function isReplayingEvent(event: AnyNativeEvent): boolean {
  return event === currentReplayingEvent;
}
