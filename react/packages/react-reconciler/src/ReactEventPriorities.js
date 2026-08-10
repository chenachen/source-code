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
/** 不影响当前交互、只在空闲机会处理的事件更新。 */
export const IdleEventPriority: EventPriority = IdleLane;

/** 返回两者中更紧急的非零事件优先级；数值更小的 Lane 位更高。 */
export function higherEventPriority(
  a: EventPriority,
  b: EventPriority,
): EventPriority {
  return a !== 0 && a < b ? a : b;
}

/** 返回两者中更不紧急的事件优先级；NoEventPriority 作为最低有效上下文保留。 */
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
