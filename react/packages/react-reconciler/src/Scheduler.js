/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 本模块只把外部 CommonJS Scheduler 包装为稳定 ESM 绑定。这里故意不使用 named import，
// 否则 Rollup 的 CommonJS interop 会为每次读取引入动态分派；Scheduler 完全迁到 ESM 后可删除。
import * as Scheduler from 'scheduler';

/** 向 Scheduler 注册带优先级的根级回调。 */
export const scheduleCallback = Scheduler.unstable_scheduleCallback;
/** 以 callback=null 的惰性语义取消 Scheduler Task。 */
export const cancelCallback = Scheduler.unstable_cancelCallback;
/** 查询当前 host 时间片或 paint 请求是否要求让步。 */
export const shouldYield = Scheduler.unstable_shouldYield;
/** 通知 Scheduler renderer 已产生需要尽快绘制的更新。 */
export const requestPaint = Scheduler.unstable_requestPaint;
/** 读取 Scheduler 使用的单调时间源。 */
export const now = Scheduler.unstable_now;
/** 读取当前 Scheduler 动态优先级上下文。 */
export const getCurrentPriorityLevel =
  Scheduler.unstable_getCurrentPriorityLevel;
/** 必须尽快运行、创建时即视为过期的 Scheduler 优先级。 */
export const ImmediatePriority = Scheduler.unstable_ImmediatePriority;
/** 面向用户输入反馈的 Scheduler 优先级。 */
export const UserBlockingPriority = Scheduler.unstable_UserBlockingPriority;
/** 普通并发 root 工作使用的 Scheduler 优先级。 */
export const NormalPriority = Scheduler.unstable_NormalPriority;
/** 可延后后台工作的 Scheduler 优先级。 */
export const LowPriority = Scheduler.unstable_LowPriority;
/** 只在空闲机会处理的 Scheduler 优先级。 */
export const IdlePriority = Scheduler.unstable_IdlePriority;
/** reconciler 传给 Scheduler 的可 continuation 回调形状。 */
export type SchedulerCallback = (isSync: boolean) => SchedulerCallback | null;

// 以下 API 不存在于生产 scheduler，只由 scheduler/unstable_mock 提供给内部确定性测试。
/** 向 mock Scheduler 期望日志写入一项。 */
export const log = Scheduler.log;
/** 控制 mock Scheduler 是否抑制 yield value 的测试开关。 */
export const unstable_setDisableYieldValue =
  Scheduler.unstable_setDisableYieldValue;
