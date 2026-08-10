/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Lane, Lanes} from './ReactFiberLane';
import type {Fiber, FiberRoot} from './ReactInternalTypes';
import type {ReactNodeList, Wakeable} from 'shared/ReactTypes';
import type {EventPriority} from './ReactEventPriorities';
// import type {DevToolsProfilingHooks} from 'react-devtools-shared/src/backend/types';
// TODO: DevTools 依赖 DOM 版 React；若按 DOM React 正确检查，就无法同时检查本 Hook
// 可能所在的非 DOM React，所以暂不能直接 import 该类型。
/** Scheduling Profiler 后端注入的标记回调集合。 */
type DevToolsProfilingHooks = any;

import {DidCapture} from './ReactFiberFlags';
import {
  enableProfilerTimer,
  enableSchedulingProfiler,
} from 'shared/ReactFeatureFlags';
import {
  DiscreteEventPriority,
  ContinuousEventPriority,
  DefaultEventPriority,
  IdleEventPriority,
} from './ReactEventPriorities';
import {
  ImmediatePriority as ImmediateSchedulerPriority,
  UserBlockingPriority as UserBlockingSchedulerPriority,
  NormalPriority as NormalSchedulerPriority,
  IdlePriority as IdleSchedulerPriority,
  log,
  unstable_setDisableYieldValue,
} from './Scheduler';

/** 浏览器扩展或 Refresh runtime 安装的 DevTools 全局 Hook。 */
declare const __REACT_DEVTOOLS_GLOBAL_HOOK__: Object | void;

let rendererID = null;
let injectedHook = null;
let injectedProfilingHooks: DevToolsProfilingHooks | null = null;
let hasLoggedError = false;

/** 当前环境是否安装了 React DevTools 全局 Hook。 */
export const isDevToolsPresent =
  typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ !== 'undefined';

/**
 * 把 renderer internals 注册到 DevTools Hook，并保存返回的 rendererID。
 * 返回值只在真实 DevTools（带 checkDCE）时为真；Fast Refresh 注入的轻量 Hook 返回
 * 假。初始化期间的 Hook 异常被吞掉，避免第三方工具阻断 React 启动。
 */
export function injectInternals(internals: Object): boolean {
  if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === 'undefined') {
    // 没有 DevTools。
    return false;
  }
  const hook = __REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (hook.isDisabled) {
    // 这不是 Hook 正式属性，但可设置它来退出 DevTools 集成及相关警告/日志。
    // https://github.com/facebook/react/issues/3877
    return true;
  }
  if (!hook.supportsFiber) {
    if (__DEV__) {
      console.error(
        'The installed version of React DevTools is too old and will not work ' +
          'with the current version of React. Please update React DevTools. ' +
          'https://react.dev/link/react-devtools',
      );
    }
    // DevTools 虽存在但不支持 Fiber，仍算已安装。
    return true;
  }
  try {
    rendererID = hook.inject(internals);

    // 注入成功后才可安全保存并调用 Hook。
    injectedHook = hook;
  } catch (err) {
    // 初始化期间抛错不安全，因此捕获全部异常。
    if (__DEV__) {
      console.error('React instrumentation encountered an error: %o.', err);
    }
  }
  if (hook.checkDCE) {
    // 这是完整 DevTools。
    return true;
  } else {
    // 很可能只是 Fast Refresh runtime 安装的 Hook。
    return false;
  }
}

/** 在开发环境把根调度及下一棵 children 通知 DevTools。 */
export function onScheduleRoot(root: FiberRoot, children: ReactNodeList) {
  if (__DEV__) {
    if (
      injectedHook &&
      typeof injectedHook.onScheduleFiberRoot === 'function'
    ) {
      try {
        injectedHook.onScheduleFiberRoot(rendererID, root, children);
      } catch (err) {
        if (__DEV__ && !hasLoggedError) {
          hasLoggedError = true;
          console.error('React instrumentation encountered an error: %o', err);
        }
      }
    }
  }
}

/**
 * 根 commit 后通知 DevTools，并把 React EventPriority 映射为 SchedulerPriority。
 * 同时报告本次根是否通过 DidCapture 从错误恢复。
 */
export function onCommitRoot(root: FiberRoot, eventPriority: EventPriority) {
  if (injectedHook && typeof injectedHook.onCommitFiberRoot === 'function') {
    try {
      const didError = (root.current.flags & DidCapture) === DidCapture;
      if (enableProfilerTimer) {
        let schedulerPriority;
        switch (eventPriority) {
          case DiscreteEventPriority:
            schedulerPriority = ImmediateSchedulerPriority;
            break;
          case ContinuousEventPriority:
            schedulerPriority = UserBlockingSchedulerPriority;
            break;
          case DefaultEventPriority:
            schedulerPriority = NormalSchedulerPriority;
            break;
          case IdleEventPriority:
            schedulerPriority = IdleSchedulerPriority;
            break;
          default:
            schedulerPriority = NormalSchedulerPriority;
            break;
        }
        injectedHook.onCommitFiberRoot(
          rendererID,
          root,
          schedulerPriority,
          didError,
        );
      } else {
        injectedHook.onCommitFiberRoot(rendererID, root, undefined, didError);
      }
    } catch (err) {
      if (__DEV__) {
        if (!hasLoggedError) {
          hasLoggedError = true;
          console.error('React instrumentation encountered an error: %o', err);
        }
      }
    }
  }
}

/** passive effects 提交后通知 DevTools 根已完成 post-commit。 */
export function onPostCommitRoot(root: FiberRoot) {
  if (
    injectedHook &&
    typeof injectedHook.onPostCommitFiberRoot === 'function'
  ) {
    try {
      injectedHook.onPostCommitFiberRoot(rendererID, root);
    } catch (err) {
      if (__DEV__) {
        if (!hasLoggedError) {
          hasLoggedError = true;
          console.error('React instrumentation encountered an error: %o', err);
        }
      }
    }
  }
}

/** Fiber 卸载提交时通知 DevTools 删除对应节点。 */
export function onCommitUnmount(fiber: Fiber) {
  if (injectedHook && typeof injectedHook.onCommitFiberUnmount === 'function') {
    try {
      injectedHook.onCommitFiberUnmount(rendererID, fiber);
    } catch (err) {
      if (__DEV__) {
        if (!hasLoggedError) {
          hasLoggedError = true;
          console.error('React instrumentation encountered an error: %o', err);
        }
      }
    }
  }
}

/**
 * 告知 DevTools 当前是否处于 StrictMode 双调用，并在 SchedulerMock 测试中同步禁止
 * yield 日志，减少严格模式测试噪声。
 */
export function setIsStrictModeForDevtools(newIsStrictMode: boolean) {
  if (typeof log === 'function') {
    // Scheduler.log 只在 SchedulerMock 存在，说明当前是测试；双渲染期间禁用 yield 值。
    unstable_setDisableYieldValue(newIsStrictMode);
  }

  if (injectedHook && typeof injectedHook.setStrictMode === 'function') {
    try {
      injectedHook.setStrictMode(rendererID, newIsStrictMode);
    } catch (err) {
      if (__DEV__) {
        if (!hasLoggedError) {
          hasLoggedError = true;
          console.error('React instrumentation encountered an error: %o', err);
        }
      }
    }
  }
}

// Profiler API Hook：以下函数只有功能开关开启且后端实现对应回调时才转发。

/** 注入 Scheduling Profiler 后端回调集合。 */
export function injectProfilingHooks(
  profilingHooks: DevToolsProfilingHooks,
): void {
  injectedProfilingHooks = profilingHooks;
}

/** 标记指定 lanes 的 commit 阶段开始。 */
export function markCommitStarted(lanes: Lanes): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markCommitStarted === 'function'
    ) {
      injectedProfilingHooks.markCommitStarted(lanes);
    }
  }
}

/** 标记当前 commit 阶段结束。 */
export function markCommitStopped(): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markCommitStopped === 'function'
    ) {
      injectedProfilingHooks.markCommitStopped();
    }
  }
}

/** 标记某 Fiber 的组件 render 用户代码开始。 */
export function markComponentRenderStarted(fiber: Fiber): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markComponentRenderStarted === 'function'
    ) {
      injectedProfilingHooks.markComponentRenderStarted(fiber);
    }
  }
}

/** 标记当前组件 render 用户代码结束。 */
export function markComponentRenderStopped(): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markComponentRenderStopped === 'function'
    ) {
      injectedProfilingHooks.markComponentRenderStopped();
    }
  }
}

/** 标记某 Fiber 的 passive effect mount 开始。 */
export function markComponentPassiveEffectMountStarted(fiber: Fiber): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markComponentPassiveEffectMountStarted ===
        'function'
    ) {
      injectedProfilingHooks.markComponentPassiveEffectMountStarted(fiber);
    }
  }
}

/** 标记当前 passive effect mount 结束。 */
export function markComponentPassiveEffectMountStopped(): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markComponentPassiveEffectMountStopped ===
        'function'
    ) {
      injectedProfilingHooks.markComponentPassiveEffectMountStopped();
    }
  }
}

/** 标记某 Fiber 的 passive effect unmount 开始。 */
export function markComponentPassiveEffectUnmountStarted(fiber: Fiber): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markComponentPassiveEffectUnmountStarted ===
        'function'
    ) {
      injectedProfilingHooks.markComponentPassiveEffectUnmountStarted(fiber);
    }
  }
}

/** 标记当前 passive effect unmount 结束。 */
export function markComponentPassiveEffectUnmountStopped(): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markComponentPassiveEffectUnmountStopped ===
        'function'
    ) {
      injectedProfilingHooks.markComponentPassiveEffectUnmountStopped();
    }
  }
}

/** 标记某 Fiber 的 layout effect mount 开始。 */
export function markComponentLayoutEffectMountStarted(fiber: Fiber): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markComponentLayoutEffectMountStarted ===
        'function'
    ) {
      injectedProfilingHooks.markComponentLayoutEffectMountStarted(fiber);
    }
  }
}

/** 标记当前 layout effect mount 结束。 */
export function markComponentLayoutEffectMountStopped(): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markComponentLayoutEffectMountStopped ===
        'function'
    ) {
      injectedProfilingHooks.markComponentLayoutEffectMountStopped();
    }
  }
}

/** 标记某 Fiber 的 layout effect unmount 开始。 */
export function markComponentLayoutEffectUnmountStarted(fiber: Fiber): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markComponentLayoutEffectUnmountStarted ===
        'function'
    ) {
      injectedProfilingHooks.markComponentLayoutEffectUnmountStarted(fiber);
    }
  }
}

/** 标记当前 layout effect unmount 结束。 */
export function markComponentLayoutEffectUnmountStopped(): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markComponentLayoutEffectUnmountStopped ===
        'function'
    ) {
      injectedProfilingHooks.markComponentLayoutEffectUnmountStopped();
    }
  }
}

/** 把组件抛错值及当时 lanes 记录到 Scheduling Profiler。 */
export function markComponentErrored(
  fiber: Fiber,
  thrownValue: mixed,
  lanes: Lanes,
): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markComponentErrored === 'function'
    ) {
      injectedProfilingHooks.markComponentErrored(fiber, thrownValue, lanes);
    }
  }
}

/** 把组件挂起的 Wakeable 及当时 lanes 记录到 Scheduling Profiler。 */
export function markComponentSuspended(
  fiber: Fiber,
  wakeable: Wakeable,
  lanes: Lanes,
): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markComponentSuspended === 'function'
    ) {
      injectedProfilingHooks.markComponentSuspended(fiber, wakeable, lanes);
    }
  }
}

/** 标记一批 layout effects 的提交阶段开始。 */
export function markLayoutEffectsStarted(lanes: Lanes): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markLayoutEffectsStarted === 'function'
    ) {
      injectedProfilingHooks.markLayoutEffectsStarted(lanes);
    }
  }
}

/** 标记一批 layout effects 的提交阶段结束。 */
export function markLayoutEffectsStopped(): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markLayoutEffectsStopped === 'function'
    ) {
      injectedProfilingHooks.markLayoutEffectsStopped();
    }
  }
}

/** 标记一批 passive effects 的提交阶段开始。 */
export function markPassiveEffectsStarted(lanes: Lanes): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markPassiveEffectsStarted === 'function'
    ) {
      injectedProfilingHooks.markPassiveEffectsStarted(lanes);
    }
  }
}

/** 标记一批 passive effects 的提交阶段结束。 */
export function markPassiveEffectsStopped(): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markPassiveEffectsStopped === 'function'
    ) {
      injectedProfilingHooks.markPassiveEffectsStopped();
    }
  }
}

/** 标记指定 lanes 的 render 工作开始。 */
export function markRenderStarted(lanes: Lanes): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markRenderStarted === 'function'
    ) {
      injectedProfilingHooks.markRenderStarted(lanes);
    }
  }
}

/** 标记并发 render 主动让出执行权。 */
export function markRenderYielded(): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markRenderYielded === 'function'
    ) {
      injectedProfilingHooks.markRenderYielded();
    }
  }
}

/** 标记当前 render 工作结束。 */
export function markRenderStopped(): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markRenderStopped === 'function'
    ) {
      injectedProfilingHooks.markRenderStopped();
    }
  }
}

/** 标记一个 Lane 已被安排渲染。 */
export function markRenderScheduled(lane: Lane): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markRenderScheduled === 'function'
    ) {
      injectedProfilingHooks.markRenderScheduled(lane);
    }
  }
}

/** 标记类组件 forceUpdate 在指定 Fiber/Lane 上入队。 */
export function markForceUpdateScheduled(fiber: Fiber, lane: Lane): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markForceUpdateScheduled === 'function'
    ) {
      injectedProfilingHooks.markForceUpdateScheduled(fiber, lane);
    }
  }
}

/** 标记状态更新在指定 Fiber/Lane 上入队。 */
export function markStateUpdateScheduled(fiber: Fiber, lane: Lane): void {
  if (enableSchedulingProfiler) {
    if (
      injectedProfilingHooks !== null &&
      typeof injectedProfilingHooks.markStateUpdateScheduled === 'function'
    ) {
      injectedProfilingHooks.markStateUpdateScheduled(fiber, lane);
    }
  }
}
