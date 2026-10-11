/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber, FiberRoot} from './ReactInternalTypes';
import type {Lane, Lanes} from './ReactFiberLane';
import type {CapturedValue} from './ReactCapturedValue';
import type {Update} from './ReactFiberClassUpdateQueue';
import type {Wakeable} from 'shared/ReactTypes';
import type {
  OffscreenQueue,
  OffscreenState,
} from './ReactFiberOffscreenComponent';
import type {RetryQueue} from './ReactFiberSuspenseComponent';

import getComponentNameFromFiber from 'react-reconciler/src/getComponentNameFromFiber';
import {
  ClassComponent,
  HostRoot,
  IncompleteClassComponent,
  IncompleteFunctionComponent,
  FunctionComponent,
  ForwardRef,
  SimpleMemoComponent,
  ActivityComponent,
  SuspenseComponent,
  OffscreenComponent,
  SuspenseListComponent,
} from './ReactWorkTags';
import {
  DidCapture,
  Incomplete,
  NoFlags,
  ShouldCapture,
  LifecycleEffectMask,
  ForceUpdateForLegacySuspense,
  ForceClientRender,
  ScheduleRetry,
} from './ReactFiberFlags';
import {NoMode, ConcurrentMode} from './ReactTypeOfMode';
import {
  enableUpdaterTracking,
  disableLegacyMode,
} from 'shared/ReactFeatureFlags';
import {createCapturedValueAtFiber} from './ReactCapturedValue';
import {
  enqueueCapturedUpdate,
  createUpdate,
  CaptureUpdate,
  ForceUpdate,
  enqueueUpdate,
} from './ReactFiberClassUpdateQueue';
import {markFailedErrorBoundaryForHotReloading} from './ReactFiberHotReloading';
import {
  getShellBoundary,
  getSuspenseHandler,
} from './ReactFiberSuspenseContext';
import {
  renderDidError,
  queueConcurrentError,
  renderDidSuspendDelayIfPossible,
  markLegacyErrorBoundaryAsFailed,
  isAlreadyFailedLegacyErrorBoundary,
  attachPingListener,
  restorePendingUpdaters,
  renderDidSuspend,
} from './ReactFiberWorkLoop';
import {propagateParentContextChangesToDeferredTree} from './ReactFiberNewContext';
import {logUncaughtError, logCaughtError} from './ReactFiberErrorLogger';
import {isDevToolsPresent} from './ReactFiberDevToolsHook';
import {
  SyncLane,
  includesSomeLane,
  mergeLanes,
  pickArbitraryLane,
} from './ReactFiberLane';
import {
  getIsHydrating,
  markDidThrowWhileHydratingDEV,
  queueHydrationError,
  HydrationMismatchException,
} from './ReactFiberHydrationContext';
import {ConcurrentRoot} from './ReactRootTags';
import {noopSuspenseyCommitThenable} from './ReactFiberThenable';
import {runWithFiberInDEV} from './ReactCurrentFiber';
import {callComponentDidCatchInDEV} from './ReactFiberCallUserSpace';

/**
 * 为根级未捕获错误创建一个捕获更新。
 *
 * 更新把根元素设为 `null` 以卸载故障树，并在提交回调中通过根配置的错误处理器
 * 报告原始值与组件栈。DevTools 依赖 payload 的 `element` 字段名。
 *
 * @param root 提供 onUncaughtError 的故障根。
 * @param errorInfo 已捕获的原始抛出值、源 Fiber 与组件栈，提交时无需重新取栈。
 * @param lane 本次恢复更新使用的单个 lane，由调用方从 render lanes 中选取。
 */
function createRootErrorUpdate(
  root: FiberRoot,
  errorInfo: CapturedValue<mixed>,
  lane: Lane,
): Update<mixed> {
  const update = createUpdate(lane);
  // 通过渲染 null 卸载整个根。
  update.tag = CaptureUpdate;
  // 注意：React DevTools 当前依赖该属性名必须是 `element`。
  update.payload = {element: null};
  /** 根卸载更新提交后报告原始错误；DEV 临时切到故障 Fiber，使错误处理器中的 owner 栈对应源组件。 */
  update.callback = () => {
    if (__DEV__) {
      runWithFiberInDEV(errorInfo.source, logUncaughtError, root, errorInfo);
    } else {
      logUncaughtError(root, errorInfo);
    }
  };
  return update;
}

/** 创建类组件 Error Boundary 使用的空 CaptureUpdate，内容由初始化阶段补齐。 */
function createClassErrorUpdate(lane: Lane): Update<mixed> {
  const update = createUpdate(lane);
  update.tag = CaptureUpdate;
  return update;
}

/**
 * 根据类组件实现的错误边界 API 填充捕获更新。
 *
 * `getDerivedStateFromError` 负责生成恢复状态，`componentDidCatch` 负责提交后通知；
 * 两者最终都会经统一日志通道报告捕获信息。仅实现旧式 `componentDidCatch` 的边界
 * 还会参与本批次失败去重，并必须自行调用 `setState` 才能展示后备 UI。
 *
 * payload 在更新队列计算恢复 state 时调用，callback 在提交时调用；同时实现两个
 * API 时，componentDidCatch 分支覆盖前面的 callback，避免重复报告同一捕获。
 * @param update 已设 CaptureUpdate 的可变记录；这里只填 payload 与 callback，不入队。
 * @param fiber 将接住错误的类组件边界，其 type 提供静态 API，stateNode 提供实例 API。
 * @param errorInfo 故障后代的抛出值和诊断栈，不是边界自身的错误。
 */
function initializeClassErrorUpdate(
  update: Update<mixed>,
  root: FiberRoot,
  fiber: Fiber,
  errorInfo: CapturedValue<mixed>,
): void {
  const getDerivedStateFromError = fiber.type.getDerivedStateFromError;
  if (typeof getDerivedStateFromError === 'function') {
    const error = errorInfo.value;
    /** 队列处理 CaptureUpdate 时向静态错误 API 传入原始值，返回待合并的恢复状态。 */
    update.payload = () => {
      return getDerivedStateFromError(error);
    };
    /** 仅静态恢复 API 的提交通知：登记热刷新失败边界，然后调用根的 onCaughtError。 */
    update.callback = () => {
      if (__DEV__) {
        markFailedErrorBoundaryForHotReloading(fiber);
      }
      if (__DEV__) {
        runWithFiberInDEV(
          errorInfo.source,
          logCaughtError,
          root,
          fiber,
          errorInfo,
        );
      } else {
        logCaughtError(root, fiber, errorInfo);
      }
    };
  }

  const inst = fiber.stateNode;
  if (inst !== null && typeof inst.componentDidCatch === 'function') {
    /** 由 commitCallbacks 以边界实例为 this 调用；先报告错误，再执行 componentDidCatch。旧式边界记录失败去重，用户回调抛错交由提交阶段错误捕获处理。 */
    // $FlowFixMe[missing-this-annot]
    update.callback = function callback() {
      if (__DEV__) {
        markFailedErrorBoundaryForHotReloading(fiber);
      }
      if (__DEV__) {
        runWithFiberInDEV(
          errorInfo.source,
          logCaughtError,
          root,
          fiber,
          errorInfo,
        );
      } else {
        logCaughtError(root, fiber, errorInfo);
      }
      if (typeof getDerivedStateFromError !== 'function') {
        // 为保留旧式错误边界的重试行为，记录本批次已经失败的边界；控制权交还浏览器
        // 前会清空该集合。
        // TODO: 未定义 getDerivedStateFromError 时在 StrictMode 中警告。
        markLegacyErrorBoundaryAsFailed(this);
      }
      if (__DEV__) {
        callComponentDidCatchInDEV(this, errorInfo);
      } else {
        const error = errorInfo.value;
        const stack = errorInfo.stack;
        this.componentDidCatch(error, {
          componentStack: stack !== null ? stack : '',
        });
      }
      if (__DEV__) {
        if (typeof getDerivedStateFromError !== 'function') {
          // 只实现 componentDidCatch 的边界必须调用 setState 才能恢复；没有安排状态
          // 更新时，该边界会吞掉错误而不展示后备 UI。
          if (!includesSomeLane(fiber.lanes, SyncLane as Lane)) {
            console.error(
              '%s: Error boundaries should implement getDerivedStateFromError(). ' +
                'In that method, return a state update to display an error message or fallback UI.',
              getComponentNameFromFiber(fiber) || 'Unknown',
            );
          }
        }
      }
    };
  }
}

/**
 * 在组件因 Wakeable 挂起后恢复重试所需的 Context 与 Hook 状态。
 *
 * 由于本轮没有访问挂起组件的子树，需要显式传播父 Context 变化，确保重试能进入
 * 后代。遗留模式的函数类 Fiber 还要把 memoizedState、updateQueue 与 lanes 恢复
 * 到渲染前版本；普通错误不需要这一步，因为它会在两次提交之间直接重试。
 * @param sourceFiber 本次尚未完成的工作 Fiber；alternate 是恢复 Hook 状态的已提交版本。
 * @param rootRenderLanes 用于父 Context 变化向延后子树传播的当前渲染 lanes。
 */
function resetSuspendedComponent(sourceFiber: Fiber, rootRenderLanes: Lanes) {
  const currentSourceFiber = sourceFiber.alternate;
  if (currentSourceFiber !== null) {
    // 本轮没有访问挂起组件的子节点，因此现在传播 Context 变化，保证重试会进入它们。
    //
    // 普通错误会在中间不提交的情况下重试；这项恢复只属于 Suspense。
    propagateParentContextChangesToDeferredTree(
      currentSourceFiber,
      sourceFiber,
      rootRenderLanes,
    );
  }

  // 把 memoizedState 恢复到尝试渲染前；这是仅影响 Hook 组件的遗留模式 Suspense 行为。
  const tag = sourceFiber.tag;
  if (
    !disableLegacyMode &&
    (sourceFiber.mode & ConcurrentMode) === NoMode &&
    (tag === FunctionComponent ||
      tag === ForwardRef ||
      tag === SimpleMemoComponent)
  ) {
    const currentSource = sourceFiber.alternate;
    if (currentSource) {
      sourceFiber.updateQueue = currentSource.updateQueue;
      sourceFiber.memoizedState = currentSource.memoizedState;
      sourceFiber.lanes = currentSource.lanes;
    } else {
      sourceFiber.updateQueue = null;
      sourceFiber.memoizedState = null;
    }
  }
}

/**
 * 标记最近的 Suspense 边界接住当前挂起，并选择遗留或并发恢复策略。
 *
 * 遗留模式通常让未完成组件暂时按 `null` 提交，并消除其生命周期副作用；直接挂在
 * 边界内部 Offscreen 包装层的特殊情况改走退栈重渲染。并发模式统一设置
 * `ShouldCapture`，让工作循环在退栈后以 fallback 再渲染边界。
 *
 * sourceFiber 是挂起位置，returnFiber 用来识别尚未进入内容的边界特殊情况；
 * rootRenderLanes 写到并发边界上以保证第二遍参与当前渲染。root 在此实现中未读取。
 * @returns 负责捕获的边界；返回类型保留空值以匹配调用链约定。
 */
function markSuspenseBoundaryShouldCapture(
  suspenseBoundary: Fiber,
  returnFiber: Fiber | null,
  sourceFiber: Fiber,
  root: FiberRoot,
  rootRenderLanes: Lanes,
): Fiber | null {
  // 标记 Suspense 边界，使退栈阶段接住这个挂起“异常”并执行第二遍 fallback 渲染。
  if (
    !disableLegacyMode &&
    (suspenseBoundary.mode & ConcurrentMode) === NoMode
  ) {
    // 遗留模式 Suspense：
    //
    // 不暂停提交，而是假装挂起组件渲染了 null 并继续。边界完成后再走第二遍，
    // 渲染 fallback。
    if (suspenseBoundary === returnFiber) {
      // 特殊情况：协调 Suspense 内部 Offscreen 包装 Fiber 的子节点时发生挂起，
      // 常见于 React.lazy 直接作为 Suspense 子节点。
      //
      // Suspense 边界由多个 Fiber 实现，但概念上是一个单元。此时“挂起”的其实是
      // 内部 Offscreen 包装层，遗留模式把它当作 null 提交的办法不成立。
      //
      // 边界内容尚未开始渲染，树中没有部分完成的内容，因此可切换到常规并发策略：
      // 为边界设置 ShouldCapture 并进入退栈阶段。
      suspenseBoundary.flags |= ShouldCapture;
    } else {
      suspenseBoundary.flags |= DidCapture;
      sourceFiber.flags |= ForceUpdateForLegacySuspense;

      // 虽然该 Fiber 未完成，遗留模式仍会提交它；必须移除全部生命周期 Effect，
      // 避免调用任何生命周期方法或回调。
      sourceFiber.flags &= ~(LifecycleEffectMask | Incomplete);

      if (sourceFiber.tag === ClassComponent) {
        const currentSourceFiber = sourceFiber.alternate;
        if (currentSourceFiber === null) {
          // 新挂载尚未完成，把 tag 改为 IncompleteClassComponent，避免误当成完整类
          // 组件，例如删除时不应调用 componentWillUnmount。
          sourceFiber.tag = IncompleteClassComponent;
        } else {
          // 已知当前 Fiber 状态不一致，重试时不能复用；安排强制更新以阻止 bailout。
          const update = createUpdate(SyncLane);
          update.tag = ForceUpdate;
          enqueueUpdate(sourceFiber, update, SyncLane);
        }
      } else if (sourceFiber.tag === FunctionComponent) {
        const currentSourceFiber = sourceFiber.alternate;
        if (currentSourceFiber === null) {
          // 新挂载尚未完成，改写 tag，避免误当成完整函数组件。
          sourceFiber.tag = IncompleteFunctionComponent;
        }
      }

      // 源 Fiber 未完成，以 Sync 优先级标明仍有待处理工作。
      sourceFiber.lanes = mergeLanes(sourceFiber.lanes, SyncLane);
    }
    return suspenseBoundary;
  }
  // 并发路径先标记捕获，退栈后重渲染边界；是否提交本次 fallback 由工作循环决定。
  // shell 中挂起会请求延迟提交；已可见内容的 Transition 可继续保留上一屏。
  // 仅 RetryLane 驱动的候选提交还受最近 fallback 提交时间的 300ms 节流窗口约束，
  // 若有其他可运行 lane，工作循环可先处理它们。这里不负责设置计时器或提交宿主树。
  suspenseBoundary.flags |= ShouldCapture;
  // TODO: begin 阶段现已用 DidCapture 防止过早 bailout，这项 lane 赋值可能可删除。
  suspenseBoundary.lanes = rootRenderLanes;
  return suspenseBoundary;
}

/**
 * 处理 render 阶段从组件抛出的 Wakeable 或普通错误。
 *
 * Wakeable 会标记最近的捕获边界并登记 retry/ping：Suspense 可构造 fallback，
 * Activity 可保留 dehydrated 状态，隐藏 Offscreen 则放弃本次预渲染；普通错误会在 hydration 时优先切到客户端渲染，否则向上寻找 HostRoot
 * 或类组件 Error Boundary 安排 CaptureUpdate。隐藏 Offscreen 中的错误只中止预渲染，
 * 不允许泄漏到可见 UI。
 *
 * @param sourceFiber 抛出位置的工作 Fiber，先标记 Incomplete，错误栈也从它生成。
 * @param returnFiber 捕获搜索的起点，故障组件不能捕获自己的 render 错误。
 * @param value 原始抛出值；这里只把非 null 对象且 then 可调用的值识别为 Wakeable。
 * @param rootRenderLanes 当前整根渲染的 lanes，用于 ping 去重和恢复更新选 lane。
 *
 * @returns 只有连父 Fiber 都不存在的不可恢复根错误才返回 `true`，通知工作循环 panic。
 */
function throwException(
  root: FiberRoot,
  returnFiber: Fiber | null,
  sourceFiber: Fiber,
  value: mixed,
  rootRenderLanes: Lanes,
): boolean {
  // 抛出值的源 Fiber 没有完成。
  sourceFiber.flags |= Incomplete;

  if (enableUpdaterTracking) {
    if (isDevToolsPresent) {
      // 仍有待处理工作时，恢复 DevTools 看到的原始 updater 集合。
      restorePendingUpdaters(root, rootRenderLanes);
    }
  }

  if (value !== null && typeof value === 'object') {
    if (typeof value.then === 'function') {
      // 这是 Wakeable，组件进入挂起状态。
      const wakeable: Wakeable = value as any;
      resetSuspendedComponent(sourceFiber, rootRenderLanes);

      if (__DEV__) {
        if (
          getIsHydrating() &&
          (disableLegacyMode || sourceFiber.mode & ConcurrentMode)
        ) {
          markDidThrowWhileHydratingDEV();
        }
      }

      // 标记最近的 Suspense 处理器，使其切换到 fallback。
      const suspenseBoundary = getSuspenseHandler();
      if (suspenseBoundary !== null) {
        switch (suspenseBoundary.tag) {
          case ActivityComponent:
          case SuspenseComponent:
          case SuspenseListComponent: {
            // 边界尚未显示 fallback 时，尽早把进行中的渲染标记为挂起，让工作循环
            // 判断能否切换任务，或等待数据就绪后继续。
            // TODO: 多数检查在进入 Suspense 边界时已经做过；应把结果保存在栈上，
            // 避免按需重算，并与更早执行同类逻辑的 `use` 路径统一。
            if (disableLegacyMode || sourceFiber.mode & ConcurrentMode) {
              if (getShellBoundary() === null) {
                // 在应用 shell 内挂起会形成不理想的 loading 状态，应避免提交这棵树。
                renderDidSuspendDelayIfPossible();
              } else {
                // 挂起点深于 shell 时无需延迟提交；若是新边界，仍调用 renderDidSuspend，
                // 告知工作循环本轮出现了新的 fallback。
                // TODO: 此分支理论上可删除。当前一是用于节流连续 loading，二是供
                // SuspenseList 判断子树是否有待处理 fallback。前者应覆盖全部重试，
                // 后者应检查 subtreeFlags，完成这两项后即可移除。
                const current = suspenseBoundary.alternate;
                if (current === null) {
                  renderDidSuspend();
                }
              }
            }

            suspenseBoundary.flags &= ~ForceClientRender;
            markSuspenseBoundaryShouldCapture(
              suspenseBoundary,
              returnFiber,
              sourceFiber,
              root,
              rootRenderLanes,
            );
            // 重试监听器：
            //
            // fallback 提交后需挂边界 retry 监听器；Wakeable settle 时安排边界再渲染。
            // 若仍有资源未就绪，重试仍可继续显示 fallback。
            //
            // 先把 Wakeable 存在边界 Fiber 上，供 commit 阶段读取。
            //
            // Wakeable 解决后再次尝试渲染边界，也就是 retry。

            // Suspensey 资源只影响提交，不影响渲染，所以不挂 retry 监听器。若 fallback
            // 已提交且唯一挂起原因就是该资源，则立即重试。
            // TODO: 调用方已知挂起原因，应重构 throwException 以去掉这里的类型检查。
            const isSuspenseyResource =
              wakeable === noopSuspenseyCommitThenable;
            if (isSuspenseyResource) {
              suspenseBoundary.flags |= ScheduleRetry;
            } else {
              const retryQueue: RetryQueue | null =
                suspenseBoundary.updateQueue as any;
              if (retryQueue === null) {
                suspenseBoundary.updateQueue = new Set([wakeable]);
              } else {
                retryQueue.add(wakeable);
              }

              // 只在并发模式挂 ping 监听器；遗留 Suspense 同步提交 fallback，不存在 ping。
              if (disableLegacyMode || suspenseBoundary.mode & ConcurrentMode) {
                attachPingListener(root, wakeable, rootRenderLanes);
              }
            }
            return false;
          }
          case OffscreenComponent: {
            if (disableLegacyMode || suspenseBoundary.mode & ConcurrentMode) {
              suspenseBoundary.flags |= ShouldCapture;
              const isSuspenseyResource =
                wakeable === noopSuspenseyCommitThenable;
              if (isSuspenseyResource) {
                suspenseBoundary.flags |= ScheduleRetry;
              } else {
                const offscreenQueue: OffscreenQueue | null =
                  suspenseBoundary.updateQueue as any;
                if (offscreenQueue === null) {
                  const newOffscreenQueue: OffscreenQueue = {
                    transitions: null,
                    markerInstances: null,
                    retryQueue: new Set([wakeable]),
                  };
                  suspenseBoundary.updateQueue = newOffscreenQueue;
                } else {
                  const retryQueue = offscreenQueue.retryQueue;
                  if (retryQueue === null) {
                    offscreenQueue.retryQueue = new Set([wakeable]);
                  } else {
                    retryQueue.add(wakeable);
                  }
                }

                attachPingListener(root, wakeable, rootRenderLanes);
              }
              return false;
            }
          }
        }
        throw new Error(
          `Unexpected Suspense handler tag (${suspenseBoundary.tag}). This ` +
            'is a bug in React.',
        );
      } else {
        // 没找到边界；由根模式决定等待还是转成错误，不以当前更新是否同步为判断条件。

        if (disableLegacyMode || root.tag === ConcurrentRoot) {
          // 并发根允许在没有 Suspense 边界时挂起；它会无限等待且不提交。
          //
          // TODO: 离散更新或 flushSync 是否应采用不同策略？可考虑把树置为 inert 并
          // 输出警告，留待后续版本重新评估。
          attachPingListener(root, wakeable, rootRenderLanes);
          renderDidSuspendDelayIfPossible();
          return false;
        } else {
          // 遗留根中没有边界的挂起始终是错误。
          const uncaughtSuspenseError = new Error(
            'A component suspended while responding to synchronous input. This ' +
              'will cause the UI to be replaced with a loading indicator. To ' +
              'fix, updates that suspend should be wrapped ' +
              'with startTransition.',
          );
          value = uncaughtSuspenseError;
        }
      }
    }
  }

  // 到这里处理的是普通错误，而不是 Suspense Wakeable。
  if (
    getIsHydrating() &&
    (disableLegacyMode || sourceFiber.mode & ConcurrentMode)
  ) {
    markDidThrowWhileHydratingDEV();
    const hydrationBoundary = getSuspenseHandler();
    // hydration 期间的错误可通过丢弃 dehydrated 内容并切换客户端渲染来恢复；
    // 优先找到最近的 Suspense 边界，关闭 hydration 后重新渲染，而不直接上抛。
    if (hydrationBoundary !== null) {
      if (__DEV__) {
        if (hydrationBoundary.tag === SuspenseListComponent) {
          console.error(
            'SuspenseList should never catch while hydrating. This is a bug in React.',
          );
        }
      }
      if ((hydrationBoundary.flags & ShouldCapture) === NoFlags) {
        // 标记下一遍应重新渲染普通 children，而不是 fallback。
        hydrationBoundary.flags |= ForceClientRender;
      }
      markSuspenseBoundaryShouldCapture(
        hydrationBoundary,
        returnFiber,
        sourceFiber,
        root,
        rootRenderLanes,
      );

      // 即使用户界面已恢复，仍记录该错误，便于修复根因。
      if (value !== HydrationMismatchException) {
        const wrapperError = new Error(
          'There was an error while hydrating but React was able to recover by ' +
            'instead client rendering from the nearest Suspense boundary.',
          {cause: value},
        );
        queueHydrationError(
          createCapturedValueAtFiber(wrapperError, sourceFiber),
        );
      }
      return false;
    } else {
      if (value !== HydrationMismatchException) {
        const wrapperError = new Error(
          'There was an error while hydrating but React was able to recover by ' +
            'instead client rendering the entire root.',
          {cause: value},
        );
        queueHydrationError(
          createCapturedValueAtFiber(wrapperError, sourceFiber),
        );
      }
      const workInProgress: Fiber = (root.current as any).alternate;
      // 在根上安排错误报告更新；正常情况下恢复路径会使它不真正触发。
      workInProgress.flags |= ShouldCapture;
      const lane = pickArbitraryLane(rootRenderLanes);
      workInProgress.lanes = mergeLanes(workInProgress.lanes, lane);
      const rootErrorInfo = createCapturedValueAtFiber(value, sourceFiber);
      const update = createRootErrorUpdate(
        workInProgress.stateNode,
        rootErrorInfo, // 恢复成功时这条信息不会真正写入日志。
        lane,
      );
      enqueueCapturedUpdate(workInProgress, update);
      renderDidError();
      return false;
    }
  } else {
    // 非 hydration 场景直接落入普通错误路径。
  }

  const wrapperError = new Error(
    'There was an error during concurrent rendering but React was able to recover by ' +
      'instead synchronously rendering the entire root.',
    {cause: value},
  );
  queueConcurrentError(createCapturedValueAtFiber(wrapperError, sourceFiber));
  renderDidError();

  // 先前未找到能处理该异常的边界；从父路径重新向上遍历，这次按普通错误处理。

  if (returnFiber === null) {
    // 没有 return Fiber 表示根自身出错，理论上不应发生；返回 true 触发致命 panic。
    return true;
  }

  const errorInfo = createCapturedValueAtFiber(value, sourceFiber);
  let workInProgress: Fiber = returnFiber;
  do {
    switch (workInProgress.tag) {
      case HostRoot: {
        workInProgress.flags |= ShouldCapture;
        const lane = pickArbitraryLane(rootRenderLanes);
        workInProgress.lanes = mergeLanes(workInProgress.lanes, lane);
        const update = createRootErrorUpdate(
          workInProgress.stateNode,
          errorInfo,
          lane,
        );
        enqueueCapturedUpdate(workInProgress, update);
        return false;
      }
      case ClassComponent:
        // 捕获并重试。
        const ctor = workInProgress.type;
        const instance = workInProgress.stateNode;
        if (
          (workInProgress.flags & DidCapture) === NoFlags &&
          (typeof ctor.getDerivedStateFromError === 'function' ||
            (instance !== null &&
              typeof instance.componentDidCatch === 'function' &&
              !isAlreadyFailedLegacyErrorBoundary(instance)))
        ) {
          workInProgress.flags |= ShouldCapture;
          const lane = pickArbitraryLane(rootRenderLanes);
          workInProgress.lanes = mergeLanes(workInProgress.lanes, lane);
          // 安排 Error Boundary 使用更新后的状态重新渲染。
          const update = createClassErrorUpdate(lane);
          initializeClassErrorUpdate(update, root, workInProgress, errorInfo);
          enqueueCapturedUpdate(workInProgress, update);
          return false;
        }
        break;
      case OffscreenComponent: {
        const offscreenState: OffscreenState | null =
          workInProgress.memoizedState as any;
        if (offscreenState !== null) {
          // 隐藏 Offscreen 边界内的错误不能逃逸到可见 UI。设置 ShouldCapture 中止
          // 当前预渲染；挂起时也使用同一标记，下次尝试边界时会清除。
          workInProgress.flags |= ShouldCapture;
          return false;
        }
        break;
      }
      default:
        break;
    }
    // $FlowFixMe[incompatible-type] 取得 null 时循环会退出。
    workInProgress = workInProgress.return;
  } while (workInProgress !== null);

  return false;
}

export {
  throwException,
  createRootErrorUpdate,
  createClassErrorUpdate,
  initializeClassErrorUpdate,
};
