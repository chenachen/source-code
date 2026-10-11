/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict
 */

import * as Scheduler from './Scheduler';
import type {Callback, Task} from './Scheduler';
import type {PriorityLevel} from '../SchedulerPriorities';
import typeof * as PriorityLevels from '../SchedulerPriorities';
import typeof * as SchedulerExportsType from './Scheduler';
import typeof * as SchedulerNativeExportsType from './SchedulerNative';

/**
 * 本 fork 期望 React Native runtime 注入的 Scheduler 桥接协议。
 *
 * 这些成员在桥存在时直接转发；缺失桥时回退同名 JavaScript 函数。其余接口在本 fork 中禁用。
 * 对应原生实现：
 * https://github.com/facebook/react-native/blob/main/packages/react-native/ReactCommon/react/renderer/runtimescheduler/RuntimeSchedulerBinding.cpp
 */
type NativeSchedulerType = {
  /** 原生 Immediate 优先级编码，必须与 JavaScript 常量一致。 */
  unstable_ImmediatePriority: PriorityLevels['ImmediatePriority'],
  /** 原生 UserBlocking 优先级编码。 */
  unstable_UserBlockingPriority: PriorityLevels['UserBlockingPriority'],
  /** 原生 Normal 优先级编码。 */
  unstable_NormalPriority: PriorityLevels['NormalPriority'],
  /** 原生 Idle 优先级编码。 */
  unstable_IdlePriority: PriorityLevels['IdlePriority'],
  /** 原生 Low 优先级编码。 */
  unstable_LowPriority: PriorityLevels['LowPriority'],
  /** 把 callback 提交给原生 Runtime Scheduler。 */
  unstable_scheduleCallback: (
    priorityLevel: PriorityLevel,
    callback: Callback,
  ) => Task,
  /** 取消此前由原生 Runtime Scheduler 返回的任务句柄。 */
  unstable_cancelCallback: (task: Task) => void,
  /** 返回原生调度器当前动态优先级。 */
  unstable_getCurrentPriorityLevel: () => PriorityLevel,
  /** 判断原生 Runtime Scheduler 是否要求 JavaScript 让出执行权。 */
  unstable_shouldYield: () => boolean,
  /** 通知原生 Runtime Scheduler renderer 已请求绘制。 */
  unstable_requestPaint: () => void,
  /** 返回原生 Runtime Scheduler 的单调时间。 */
  unstable_now: () => DOMHighResTimeStamp,
};

/** RN runtime 注入的全局桥；旧环境未注入时为 `undefined`，各导出回退到 JavaScript Scheduler。 */
declare const nativeRuntimeScheduler: void | NativeSchedulerType;

/** UserBlocking 优先级优先取原生编码，保持提交任务与优先级常量来自同一实现。 */
export const unstable_UserBlockingPriority: PriorityLevels['UserBlockingPriority'] =
  typeof nativeRuntimeScheduler !== 'undefined'
    ? nativeRuntimeScheduler.unstable_UserBlockingPriority
    : Scheduler.unstable_UserBlockingPriority;

/** Normal 优先级优先取原生编码，缺失桥时使用 JavaScript 值。 */
export const unstable_NormalPriority: PriorityLevels['NormalPriority'] =
  typeof nativeRuntimeScheduler !== 'undefined'
    ? nativeRuntimeScheduler.unstable_NormalPriority
    : Scheduler.unstable_NormalPriority;

/** Idle 优先级优先取原生编码，缺失桥时使用 JavaScript 值。 */
export const unstable_IdlePriority: PriorityLevels['IdlePriority'] =
  typeof nativeRuntimeScheduler !== 'undefined'
    ? nativeRuntimeScheduler.unstable_IdlePriority
    : Scheduler.unstable_IdlePriority;

/** Low 优先级优先取原生编码，缺失桥时使用 JavaScript 值。 */
export const unstable_LowPriority: PriorityLevels['LowPriority'] =
  typeof nativeRuntimeScheduler !== 'undefined'
    ? nativeRuntimeScheduler.unstable_LowPriority
    : Scheduler.unstable_LowPriority;

/** Immediate 优先级优先取原生编码，缺失桥时使用 JavaScript 值。 */
export const unstable_ImmediatePriority: PriorityLevels['ImmediatePriority'] =
  typeof nativeRuntimeScheduler !== 'undefined'
    ? nativeRuntimeScheduler.unstable_ImmediatePriority
    : Scheduler.unstable_ImmediatePriority;

/**
 * 调度入口在模块求值时选取原生或 JavaScript 函数，priority/callback 来自同一实现契约。
 * 返回 handle 必须交给本模块的 cancelCallback；这里只转发函数引用，不包装 task 或 callback。
 */
export const unstable_scheduleCallback: (
  priorityLevel: PriorityLevel,
  callback: Callback,
) => Task =
  typeof nativeRuntimeScheduler !== 'undefined'
    ? nativeRuntimeScheduler.unstable_scheduleCallback
    : Scheduler.unstable_scheduleCallback;

/** 取消本模块 scheduleCallback 返回的任务句柄；与创建入口采用相同的桥选择条件。 */
export const unstable_cancelCallback: (task: Task) => void =
  typeof nativeRuntimeScheduler !== 'undefined'
    ? nativeRuntimeScheduler.unstable_cancelCallback
    : Scheduler.unstable_cancelCallback;

/** 查询实际调度实现的当前优先级，不读取 JavaScript fallback 中另一份 scope 状态。 */
export const unstable_getCurrentPriorityLevel: () => PriorityLevel =
  typeof nativeRuntimeScheduler !== 'undefined'
    ? nativeRuntimeScheduler.unstable_getCurrentPriorityLevel
    : Scheduler.unstable_getCurrentPriorityLevel;

/** 查询原生 runtime 的让出条件；缺桥时使用 JavaScript 时间片/paint 判断，调用方协作退出。 */
export const unstable_shouldYield: () => boolean =
  typeof nativeRuntimeScheduler !== 'undefined'
    ? nativeRuntimeScheduler.unstable_shouldYield
    : Scheduler.unstable_shouldYield;

/** 把 renderer 绘制请求传给实际调度实现，使其后续 yield 查询采用同一份状态。 */
export const unstable_requestPaint: () => void =
  typeof nativeRuntimeScheduler !== 'undefined'
    ? nativeRuntimeScheduler.unstable_requestPaint
    : Scheduler.unstable_requestPaint;

/** 返回实际调度实现的相对毫秒时钟，供开始/过期/耗时使用同一基准。 */
export const unstable_now: () => number | DOMHighResTimeStamp =
  typeof nativeRuntimeScheduler !== 'undefined'
    ? nativeRuntimeScheduler.unstable_now
    : Scheduler.unstable_now;

// 下列接口不属于此桥接协议；即使缺失原生桥也固定抛错，不回退到 JavaScript 实现。
/** Native fork 不提供动态优先级降级，调用立即抛出 Not implemented。 */
export const unstable_next: any = throwNotImplemented;
/** Native fork 不提供动态优先级 scope，调用立即抛错而不执行传入回调。 */
export const unstable_runWithPriority: any = throwNotImplemented;
/** Native fork 不提供优先级捕获包装，调用立即抛错，不返回可执行包装器。 */
export const unstable_wrapCallback: any = throwNotImplemented;
/** Native fork 不提供 JavaScript 时间片覆盖，调用立即抛错。 */
export const unstable_forceFrameRate: any = throwNotImplemented;
/** Native fork 当前不提供 Scheduler profiling 会话。 */
export const unstable_Profiling: any = null;

/** 为 Native fork 不支持的公共接口抛出一致错误。 */
function throwNotImplemented() {
  throw Error('Not implemented.');
}

// Flow 类型哨兵：编译期验证本 fork 的导出形状与标准 Scheduler 完全兼容。
export type {Callback, Task};
null as any as SchedulerExportsType as SchedulerNativeExportsType as SchedulerExportsType;
