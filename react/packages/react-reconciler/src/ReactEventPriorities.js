/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Lane, Lanes} from './ReactFiberLane';

import {
  NoLane,
  SyncLane,
  InputContinuousLane,
  DefaultLane,
  IdleLane,
  getHighestPriorityLane,
  includesNonIdleWork,
} from './ReactFiberLane';

/**
 * 事件分派期间使用的更新优先级。
 *
 * 运行时直接复用单个 Lane 的位值，使 DOM 事件边界能无损写入当前 update priority；
 * opaque type 防止调用方把任意 Lane 集合误当成事件优先级。
 */
export opaque type EventPriority = Lane;

/** 尚未建立事件优先级上下文。 */
export const NoEventPriority: EventPriority = NoLane;
/** click、keydown 等离散输入；映射到必须同步响应的 SyncLane。 */
export const DiscreteEventPriority: EventPriority = SyncLane;
/** mousemove、scroll 等连续输入；允许相邻事件合并处理。 */
export const ContinuousEventPriority: EventPriority = InputContinuousLane;
/** 不属于离散/连续输入的普通事件更新。 */
export const DefaultEventPriority: EventPriority = DefaultLane;
/** 最低事件更新优先级；选中的工作映射到 Scheduler IdlePriority 的普通 host callback。 */
export const IdleEventPriority: EventPriority = IdleLane;

/** a 非零且比 b 更紧急时返回 a，否则返回 b；b 为 NoEventPriority 时保留零。 */
export function higherEventPriority(
  a: EventPriority,
  b: EventPriority,
): EventPriority {
  return a !== 0 && a < b ? a : b;
}

/** a 为 NoEventPriority 或比 b 更不紧急时返回 a，否则返回 b；零表示没有已设置的上下文。 */
export function lowerEventPriority(
  a: EventPriority,
  b: EventPriority,
): EventPriority {
  return a === 0 || a > b ? a : b;
}

/** 判断 `a` 是否为有效且比 `b` 更紧急的事件优先级。 */
export function isHigherEventPriority(
  a: EventPriority,
  b: EventPriority,
): boolean {
  return a !== 0 && a < b;
}

/** 把单 Lane 编码的事件优先级还原为更新 Lane。 */
export function eventPriorityToLane(updatePriority: EventPriority): Lane {
  return updatePriority;
}

/**
 * 把一组待处理 Lanes 归约成 DOM 事件层能表达的四档优先级。
 *
 * 只观察集合中最高优先级 Lane；同步、连续、普通非 idle、纯 idle 依次降档。
 */
export function lanesToEventPriority(lanes: Lanes): EventPriority {
  const lane = getHighestPriorityLane(lanes);
  if (!isHigherEventPriority(DiscreteEventPriority, lane)) {
    return DiscreteEventPriority;
  }
  if (!isHigherEventPriority(ContinuousEventPriority, lane)) {
    return ContinuousEventPriority;
  }
  if (includesNonIdleWork(lane)) {
    return DefaultEventPriority;
  }
  return IdleEventPriority;
}
