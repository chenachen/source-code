/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

/** Scheduler 公共优先级编码；数值越小表示调度优先级越高。 */
export type PriorityLevel = 0 | 1 | 2 | 3 | 4 | 5;

// TODO: 是否改用 Symbol，避免把内部编码误当作可计算数值？
// 尚未进入任何优先级上下文时使用的哨兵值，不会作为可调度任务的有效优先级。
export const NoPriority = 0;
// 必须尽快执行的工作；超时时间为负，因此一进入 ready queue 就视为过期。
export const ImmediatePriority = 1;
// 对用户输入有直接反馈的工作，默认允许等待约 250 毫秒。
export const UserBlockingPriority = 2;
// 普通更新与后台渲染的默认优先级，默认超时约 5 秒。
export const NormalPriority = 3;
// 可延后的非紧急工作，默认超时约 10 秒。
export const LowPriority = 4;
// 仅在空闲机会执行的工作，使用可表示的最长超时。
export const IdlePriority = 5;
