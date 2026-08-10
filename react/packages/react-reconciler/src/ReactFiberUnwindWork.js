/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactContext} from 'shared/ReactTypes';
import type {Fiber, FiberRoot} from './ReactInternalTypes';
import type {Lanes} from './ReactFiberLane';
import type {ActivityState} from './ReactFiberActivityComponent';
import type {
  SuspenseState,
  SuspenseListRenderState,
} from './ReactFiberSuspenseComponent';
import type {Cache} from './ReactFiberCacheComponent';
import type {TracingMarkerInstance} from './ReactFiberTracingMarkerComponent';

import {
  ClassComponent,
  HostRoot,
  HostComponent,
  HostHoistable,
  HostSingleton,
  HostPortal,
  ContextProvider,
  ActivityComponent,
  SuspenseComponent,
  SuspenseListComponent,
  OffscreenComponent,
  LegacyHiddenComponent,
  CacheComponent,
  TracingMarkerComponent,
} from './ReactWorkTags';
import {DidCapture, NoFlags, ShouldCapture, Update} from './ReactFiberFlags';
import {NoMode, ProfileMode} from './ReactTypeOfMode';
import {
  enableProfilerTimer,
  enableTransitionTracing,
} from 'shared/ReactFeatureFlags';

import {popHostContainer, popHostContext} from './ReactFiberHostContext';
import {
  popSuspenseListContext,
  popSuspenseHandler,
} from './ReactFiberSuspenseContext';
import {popHiddenContext} from './ReactFiberHiddenContext';
import {resetHydrationState} from './ReactFiberHydrationContext';
import {
  isContextProvider as isLegacyContextProvider,
  popContext as popLegacyContext,
  popTopLevelContextObject as popTopLevelLegacyContextObject,
} from './ReactFiberLegacyContext';
import {popProvider} from './ReactFiberNewContext';
import {popCacheProvider} from './ReactFiberCacheComponent';
import {transferActualDuration} from './ReactProfilerTimer';
import {popTreeContext} from './ReactFiberTreeContext';
import {popRootTransition, popTransition} from './ReactFiberTransition';
import {
  popMarkerInstance,
  popRootMarkerInstance,
} from './ReactFiberTracingMarkerComponent';

/**
 * 从未完成的 Fiber 向上退栈，并恢复它在 begin 阶段压入的各类上下文。
 *
 * 普通节点退栈后返回 `null` 继续向父级冒泡；带 `ShouldCapture` 的错误或 Suspense
 * 边界会改写为 `DidCapture` 并返回自身，驱动工作循环对该边界进行第二遍渲染。
 * HostRoot 若接住未被子边界处理的错误，也返回根以执行卸载子树的恢复遍历。
 */
function unwindWork(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
): Fiber | null {
  // 这里刻意不检查 hydration：与当前树的 provider Fiber 比较同样快且更不易出错。
  // 理想方案是为 hydration 单独提供一套工作循环。
  popTreeContext(workInProgress);
  switch (workInProgress.tag) {
    case ClassComponent: {
      const Component = workInProgress.type;
      if (isLegacyContextProvider(Component)) {
        popLegacyContext(workInProgress);
      }
      const flags = workInProgress.flags;
      if (flags & ShouldCapture) {
        workInProgress.flags = (flags & ~ShouldCapture) | DidCapture;
        if (
          enableProfilerTimer &&
          (workInProgress.mode & ProfileMode) !== NoMode
        ) {
          transferActualDuration(workInProgress);
        }
        return workInProgress;
      }
      return null;
    }
    case HostRoot: {
      const root: FiberRoot = workInProgress.stateNode;
      const cache: Cache = workInProgress.memoizedState.cache;
      popCacheProvider(workInProgress, cache);

      if (enableTransitionTracing) {
        popRootMarkerInstance(workInProgress);
      }

      popRootTransition(workInProgress, root, renderLanes);
      popHostContainer(workInProgress);
      popTopLevelLegacyContextObject(workInProgress);
      const flags = workInProgress.flags;
      if (
        (flags & ShouldCapture) !== NoFlags &&
        (flags & DidCapture) === NoFlags
      ) {
        // 渲染错误未被 Suspense 边界捕获；在根上再走一遍以卸载子树。
        workInProgress.flags = (flags & ~ShouldCapture) | DidCapture;
        return workInProgress;
      }
      // 未完成任何捕获便退到根，结束本轮退栈。
      return null;
    }
    case HostHoistable:
    case HostSingleton:
    case HostComponent: {
      // TODO: 补充 popHydrationState。
      popHostContext(workInProgress);
      return null;
    }
    case ActivityComponent: {
      const activityState: null | ActivityState = workInProgress.memoizedState;
      if (activityState !== null) {
        popSuspenseHandler(workInProgress);

        if (workInProgress.alternate === null) {
          throw new Error(
            'Threw in newly mounted dehydrated component. This is likely a bug in ' +
              'React. Please file an issue.',
          );
        }

        resetHydrationState();
      }

      const flags = workInProgress.flags;
      if (flags & ShouldCapture) {
        workInProgress.flags = (flags & ~ShouldCapture) | DidCapture;
        // 捕获到 Suspense 效应，重新渲染该边界。
        if (
          enableProfilerTimer &&
          (workInProgress.mode & ProfileMode) !== NoMode
        ) {
          transferActualDuration(workInProgress);
        }
        return workInProgress;
      }
      return null;
    }
    case SuspenseComponent: {
      popSuspenseHandler(workInProgress);
      const suspenseState: null | SuspenseState = workInProgress.memoizedState;
      if (suspenseState !== null && suspenseState.dehydrated !== null) {
        if (workInProgress.alternate === null) {
          throw new Error(
            'Threw in newly mounted dehydrated component. This is likely a bug in ' +
              'React. Please file an issue.',
          );
        }

        resetHydrationState();
      }

      const flags = workInProgress.flags;
      if (flags & ShouldCapture) {
        workInProgress.flags = (flags & ~ShouldCapture) | DidCapture;
        // 捕获到 Suspense 效应，重新渲染该边界。
        if (
          enableProfilerTimer &&
          (workInProgress.mode & ProfileMode) !== NoMode
        ) {
          transferActualDuration(workInProgress);
        }
        return workInProgress;
      }
      return null;
    }
    case SuspenseListComponent: {
      popSuspenseListContext(workInProgress);
      // SuspenseList 通常不负责捕获；异常应由嵌套边界接住，否则继续向上冒泡。
      const flags = workInProgress.flags;
      if (flags & ShouldCapture) {
        workInProgress.flags = (flags & ~ShouldCapture) | DidCapture;
        // SuspenseList 自身接住内容表示需要忽略某些尾部工作；重新进入循环并在
        // complete 阶段处理。
        const renderState: null | SuspenseListRenderState =
          workInProgress.memoizedState;
        if (renderState !== null) {
          // 截断剩余 tail，且不提交当前渲染项；此前已经确认这些项都尚未挂载。
          renderState.rendering = null;
          renderState.tail = null;
        }
        // 安排一次提交，以挂接重试监听器。
        workInProgress.flags |= Update;
        return workInProgress;
      }
      return null;
    }
    case HostPortal:
      popHostContainer(workInProgress);
      return null;
    case ContextProvider:
      const context: ReactContext<any> = workInProgress.type;
      popProvider(context, workInProgress);
      return null;
    case OffscreenComponent:
    case LegacyHiddenComponent: {
      popSuspenseHandler(workInProgress);
      popHiddenContext(workInProgress);
      popTransition(workInProgress, current);
      const flags = workInProgress.flags;
      if (flags & ShouldCapture) {
        workInProgress.flags = (flags & ~ShouldCapture) | DidCapture;
        // 捕获到 Suspense 效应，重新渲染该边界。
        if (
          enableProfilerTimer &&
          (workInProgress.mode & ProfileMode) !== NoMode
        ) {
          transferActualDuration(workInProgress);
        }
        return workInProgress;
      }
      return null;
    }
    case CacheComponent:
      const cache: Cache = workInProgress.memoizedState.cache;
      popCacheProvider(workInProgress, cache);
      return null;
    case TracingMarkerComponent:
      if (enableTransitionTracing) {
        if (workInProgress.stateNode !== null) {
          popMarkerInstance(workInProgress);
        }
      }
      return null;
    default:
      return null;
  }
}

/**
 * 清理由并发调度中断的 Fiber 在 begin 阶段压入的上下文。
 *
 * 与 `unwindWork` 不同，本函数只恢复栈，不把 `ShouldCapture` 转成 `DidCapture`，
 * 也不会选择某个边界重渲染；恢复完成后，调度器可从别处安全地重新开始工作。
 */
function unwindInterruptedWork(
  current: Fiber | null,
  interruptedWork: Fiber,
  renderLanes: Lanes,
) {
  // 这里刻意不检查 hydration：与当前树的 provider Fiber 比较同样快且更不易出错。
  // 理想方案是为 hydration 单独提供一套工作循环。
  popTreeContext(interruptedWork);
  switch (interruptedWork.tag) {
    case ClassComponent: {
      const childContextTypes = interruptedWork.type.childContextTypes;
      if (childContextTypes !== null && childContextTypes !== undefined) {
        popLegacyContext(interruptedWork);
      }
      break;
    }
    case HostRoot: {
      const root: FiberRoot = interruptedWork.stateNode;
      const cache: Cache = interruptedWork.memoizedState.cache;
      popCacheProvider(interruptedWork, cache);

      if (enableTransitionTracing) {
        popRootMarkerInstance(interruptedWork);
      }

      popRootTransition(interruptedWork, root, renderLanes);
      popHostContainer(interruptedWork);
      popTopLevelLegacyContextObject(interruptedWork);
      break;
    }
    case HostHoistable:
    case HostSingleton:
    case HostComponent: {
      popHostContext(interruptedWork);
      break;
    }
    case HostPortal:
      popHostContainer(interruptedWork);
      break;
    case ActivityComponent: {
      if (interruptedWork.memoizedState !== null) {
        popSuspenseHandler(interruptedWork);
      }
      break;
    }
    case SuspenseComponent:
      popSuspenseHandler(interruptedWork);
      break;
    case SuspenseListComponent:
      popSuspenseListContext(interruptedWork);
      break;
    case ContextProvider:
      const context: ReactContext<any> = interruptedWork.type;
      popProvider(context, interruptedWork);
      break;
    case OffscreenComponent:
    case LegacyHiddenComponent:
      popSuspenseHandler(interruptedWork);
      popHiddenContext(interruptedWork);
      popTransition(interruptedWork, current);
      break;
    case CacheComponent:
      const cache: Cache = interruptedWork.memoizedState.cache;
      popCacheProvider(interruptedWork, cache);
      break;
    case TracingMarkerComponent:
      if (enableTransitionTracing) {
        const instance: TracingMarkerInstance | null =
          interruptedWork.stateNode;
        if (instance !== null) {
          popMarkerInstance(interruptedWork);
        }
      }
      break;
    default:
      break;
  }
}

export {unwindWork, unwindInterruptedWork};
