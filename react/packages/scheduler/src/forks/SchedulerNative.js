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
 * React Native C++ Runtime Scheduler 当前实际支持的桥接协议。
 *
 * 这里只列原生实现已经提供且 React 会调用的成员；其余 Web Scheduler API 在本 fork 中明确禁用。
 * 对应原生实现：
 * https://github.com/facebook/react-native/blob/main/packages/react-native/ReactCommon/react/renderer/runtimescheduler/RuntimeSchedulerBinding.cpp
 */
type NativeSchedulerType = {
  // 原生 Immediate 优先级编码，必须与 JavaScript 常量一致。
  unstable_ImmediatePriority: PriorityLevels['ImmediatePriority'],
  // 原生 UserBlocking 优先级编码。
  unstable_UserBlockingPriority: PriorityLevels['UserBlockingPriority'],
  // 原生 Normal 优先级编码。
  unstable_NormalPriority: PriorityLevels['NormalPriority'],
  // 原生 Idle 优先级编码。
  unstable_IdlePriority: PriorityLevels['IdlePriority'],
  // 原生 Low 优先级编码。
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

// RN runtime 注入的全局桥；旧环境未注入时为 `undefined`，各导出回退到 JavaScript Scheduler。
declare const nativeRuntimeScheduler: void | NativeSchedulerType;

// UserBlocking 优先级优先取原生编码，保持提交任务与优先级常量来自同一实现。
export const unstable_UserBlockingPriority: PriorityLevels['UserBlockingPriority'] =
  typeof nativeRuntimeScheduler !== 'undefined'
    ? nativeRuntimeScheduler.unstable_UserBlockingPriority
    : Scheduler.unstable_UserBlockingPriority;

// Normal 优先级优先取原生编码，缺失桥时使用 JavaScript 值。
export const unstable_NormalPriority: PriorityLevels['NormalPriority'] =
  typeof nativeRuntimeScheduler !== 'undefined'
    ? nativeRuntimeScheduler.unstable_NormalPriority
    : Scheduler.unstable_NormalPriority;

// Idle 优先级优先取原生编码，缺失桥时使用 JavaScript 值。
export const unstable_IdlePriority: PriorityLevels['IdlePriority'] =
  typeof nativeRuntimeScheduler !== 'undefined'
    ? nativeRuntimeScheduler.unstable_IdlePriority
    : Scheduler.unstable_IdlePriority;

// Low 优先级优先取原生编码，缺失桥时使用 JavaScript 值。
export const unstable_LowPriority: PriorityLevels['LowPriority'] =
  typeof nativeRuntimeScheduler !== 'undefined'
    ? nativeRuntimeScheduler.unstable_LowPriority
    : Scheduler.unstable_LowPriority;

// Immediate 优先级优先取原生编码，缺失桥时使用 JavaScript 值。
export const unstable_ImmediatePriority: PriorityLevels['ImmediatePriority'] =
  typeof nativeRuntimeScheduler !== 'undefined'
    ? nativeRuntimeScheduler.unstable_ImmediatePriority
    : Scheduler.unstable_ImmediatePriority;

// 调度入口在桥存在时直接委派原生实现，否则完整回退到 JavaScript Scheduler。
export const unstable_scheduleCallback: (
  priorityLevel: PriorityLevel,
  callback: Callback,
) => Task =
  typeof nativeRuntimeScheduler !== 'undefined'
    ? nativeRuntimeScheduler.unstable_scheduleCallback
    : Scheduler.unstable_scheduleCallback;

// 取消入口必须与创建任务句柄的实现配对，因此采用相同的原生/JavaScript 选择条件。
export const unstable_cancelCallback: (task: Task) => void =
  typeof nativeRuntimeScheduler !== 'undefined'
    ? nativeRuntimeScheduler.unstable_cancelCallback
    : Scheduler.unstable_cancelCallback;

// 当前优先级查询委派给实际承担调度的实现。
export const unstable_getCurrentPriorityLevel: () => PriorityLevel =
  typeof nativeRuntimeScheduler !== 'undefined'
    ? nativeRuntimeScheduler.unstable_getCurrentPriorityLevel
    : Scheduler.unstable_getCurrentPriorityLevel;

// yield 查询委派给原生 runtime；回退路径使用 JavaScript 时间片判断。
export const unstable_shouldYield: () => boolean =
  typeof nativeRuntimeScheduler !== 'undefined'
    ? nativeRuntimeScheduler.unstable_shouldYield
    : Scheduler.unstable_shouldYield;

// paint 请求传给实际调度实现，使 renderer 与其 yield 策略保持一致。
export const unstable_requestPaint: () => void =
  typeof nativeRuntimeScheduler !== 'undefined'
    ? nativeRuntimeScheduler.unstable_requestPaint
    : Scheduler.unstable_requestPaint;

// 时间读取委派给实际调度实现，避免跨时钟比较任务时间戳。
export const unstable_now: () => number | DOMHighResTimeStamp =
  typeof nativeRuntimeScheduler !== 'undefined'
    ? nativeRuntimeScheduler.unstable_now
    : Scheduler.unstable_now;

// React 从不调用以下接口，原生 Scheduler 也未实现；统一抛错可避免部分接口意外混用两套状态。
// 动态优先级降级接口在 Native fork 中不可用。
export const unstable_next: any = throwNotImplemented;
// 动态优先级执行接口在 Native fork 中不可用。
export const unstable_runWithPriority: any = throwNotImplemented;
// 优先级捕获包装接口在 Native fork 中不可用。
export const unstable_wrapCallback: any = throwNotImplemented;
// 帧率覆盖接口在 Native fork 中不可用。
export const unstable_forceFrameRate: any = throwNotImplemented;
// Native fork 当前不提供 Scheduler profiling 会话。
export const unstable_Profiling: any = null;

/** 为 Native fork 不支持的公共接口抛出一致错误。 */
function throwNotImplemented() {
  throw Error('Not implemented.');
}

// Flow 类型哨兵：编译期验证本 fork 的导出形状与标准 Scheduler 完全兼容。
export type {Callback, Task};
null as any as SchedulerExportsType as SchedulerNativeExportsType as SchedulerExportsType;
