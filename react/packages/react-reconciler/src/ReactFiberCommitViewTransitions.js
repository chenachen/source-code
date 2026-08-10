/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ViewTransitionProps} from 'shared/ReactTypes';
import type {Instance, InstanceMeasurement, Props} from './ReactFiberConfig';
import type {Fiber} from './ReactInternalTypes';
import type {ViewTransitionState} from './ReactFiberViewTransitionComponent';

import {
  HostComponent,
  OffscreenComponent,
  ViewTransitionComponent,
} from './ReactWorkTags';
import {
  NoFlags,
  Update,
  ViewTransitionStatic,
  ViewTransitionStaticParent,
  AffectedParentLayout,
  ViewTransitionNamedStatic,
} from './ReactFiberFlags';
import {
  supportsMutation,
  applyViewTransitionName,
  restoreViewTransitionName,
  measureInstance,
  measureClonedInstance,
  hasInstanceChanged,
  hasInstanceAffectedParent,
  wasInstanceInViewport,
} from './ReactFiberConfig';
import {
  scheduleViewTransitionEvent,
  scheduleGestureTransitionEvent,
} from './ReactFiberWorkLoop';
import {
  getViewTransitionName,
  getViewTransitionClassName,
} from './ReactFiberViewTransitionComponent';
import {trackAnimatingTask} from './ReactProfilerTimer';
import {
  enableComponentPerformanceTrack,
  enableProfilerTimer,
  enableViewTransitionForPersistenceMode,
  enableViewTransitionParentEnterExit,
} from 'shared/ReactFeatureFlags';

export let shouldStartViewTransition: boolean = false;

/** 新提交开始时清除“需启动宿主 View Transition”信号。 */
export function resetShouldStartViewTransition(): void {
  shouldStartViewTransition = false;
}

// accumulateSuspenseyCommit 阶段发现的命名 ViewTransition；beforeMutation 会在删除树中寻找
// 同名配对。
export let appearingViewTransitions: Map<string, ViewTransitionState> | null =
  null;

/** 提交完成/取消后清空新出现命名 ViewTransition 的配对索引。 */
export function resetAppearingViewTransitions(): void {
  appearingViewTransitions = null;
}

/** 登记新出现的命名 ViewTransitionState，供删除树按 name 建立 share 配对。 */
export function trackAppearingViewTransition(
  name: string,
  state: ViewTransitionState,
): void {
  if (appearingViewTransitions === null) {
    appearingViewTransitions = new Map();
  }
  appearingViewTransitions.set(name, state);
}

/**
 * Placement 子树含 ViewTransition 时预先要求启动宿主 View Transition；真正 enter 名称与
 * callback 在后续 commit pass 应用。
 */
export function trackEnterViewTransitions(placement: Fiber): void {
  if (
    placement.tag === ViewTransitionComponent ||
    (placement.subtreeFlags & ViewTransitionStatic) !== NoFlags
  ) {
    // 插入/出现 Fiber 自身或直接 child 是 ViewTransition，后续 pass 会触发 enter；即使
    // beforeMutation 无其他更新，也要保证调用 startViewTransition。
    shouldStartViewTransition = true;
  }
}

// 确认父级也无需动画前，不能取消 child ViewTransition。
export let viewTransitionCancelableChildren: null | Array<
  Instance | string | Props,
> = null; // 扁平三元组：[instance: Instance, oldName: string, props: Props]。

/** 进入父 ViewTransition 测量作用域，隔离当前层可取消 child 列表并返回上一层列表。 */
export function pushViewTransitionCancelableScope(): null | Array<
  Instance | string | Props,
> {
  const prevChildren = viewTransitionCancelableChildren;
  viewTransitionCancelableChildren = null;
  return prevChildren;
}

/** 离开测量作用域并恢复父级可取消 child 列表。 */
export function popViewTransitionCancelableScope(
  prevChildren: null | Array<Instance | string | Props>,
): void {
  viewTransitionCancelableChildren = prevChildren;
}

let viewTransitionHostInstanceIdx = 0;

/**
 * 为 ViewTransition 下终端 HostComponent 分配唯一 view-transition-name 与 class，并可选
 * 收集旧测量；返回是否至少一个实例进入 viewport，供跳过屏外动画与性能任务归因。
 */
function applyViewTransitionToHostInstances(
  fiber: Fiber,
  name: string,
  className: ?string,
  collectMeasurements: null | Array<InstanceMeasurement>,
  stopAtNestedViewTransitions: boolean,
): boolean {
  viewTransitionHostInstanceIdx = 0;
  const inViewport = applyViewTransitionToHostInstancesRecursive(
    fiber.child,
    name,
    className,
    collectMeasurements,
    stopAtNestedViewTransitions,
  );
  if (enableProfilerTimer && enableComponentPerformanceTrack && inViewport) {
    if (fiber._debugTask != null) {
      trackAnimatingTask(fiber._debugTask);
    }
  }
  return inViewport;
}

/**
 * 深度优先应用宿主 transition 名称；隐藏 Offscreen 整体跳过，update 模式可在嵌套
 * ViewTransition 停止，由最内层边界拥有动画。
 */
function applyViewTransitionToHostInstancesRecursive(
  child: null | Fiber,
  name: string,
  className: ?string,
  collectMeasurements: null | Array<InstanceMeasurement>,
  stopAtNestedViewTransitions: boolean,
): boolean {
  // $FlowFixMe[constant-condition]
  if (!supportsMutation) {
    if (enableViewTransitionForPersistenceMode) {
      while (child !== null) {
        if (child.tag === HostComponent) {
          const instance: Instance = child.stateNode;
          // TODO：为 persistence 模式计算组件是否在 viewport。
          shouldStartViewTransition = true;
          applyViewTransitionName(
            instance,
            viewTransitionHostInstanceIdx === 0
              ? name
              : name + '_' + viewTransitionHostInstanceIdx,
            className,
          );
          viewTransitionHostInstanceIdx++;
        } else if (
          child.tag === OffscreenComponent &&
          child.memoizedState !== null
        ) {
          // 跳过隐藏子树；对动画而言它们等同不存在。
        } else if (
          child.tag === ViewTransitionComponent &&
          stopAtNestedViewTransitions
        ) {
          // update 时跳过嵌套 ViewTransition，由最内层边界处理。
        } else {
          applyViewTransitionToHostInstancesRecursive(
            child.child,
            name,
            className,
            collectMeasurements,
            stopAtNestedViewTransitions,
          );
        }
        child = child.sibling;
      }
      return true;
    } else {
      return false;
    }
  }
  let inViewport = false;
  while (child !== null) {
    if (child.tag === HostComponent) {
      const instance: Instance = child.stateNode;
      if (collectMeasurements !== null) {
        const measurement = measureInstance(instance);
        collectMeasurements.push(measurement);
        if (wasInstanceInViewport(measurement)) {
          inViewport = true;
        }
      } else if (!inViewport) {
        if (wasInstanceInViewport(measureInstance(instance))) {
          inViewport = true;
        }
      }
      shouldStartViewTransition = true;
      applyViewTransitionName(
        instance,
        viewTransitionHostInstanceIdx === 0
          ? name
          : // 多个宿主实例追加下标后缀，保证名称唯一。
            name + '_' + viewTransitionHostInstanceIdx,
        className,
      );
      viewTransitionHostInstanceIdx++;
    } else if (
      child.tag === OffscreenComponent &&
      child.memoizedState !== null
    ) {
      // 跳过隐藏子树；对动画而言它们等同不存在。
    } else if (
      child.tag === ViewTransitionComponent &&
      stopAtNestedViewTransitions
    ) {
      // update 时跳过嵌套 ViewTransition，由最内层边界处理。
    } else {
      if (
        applyViewTransitionToHostInstancesRecursive(
          child.child,
          name,
          className,
          collectMeasurements,
          stopAtNestedViewTransitions,
        )
      ) {
        inViewport = true;
      }
    }
    child = child.sibling;
  }
  return inViewport;
}

/**
 * 递归恢复 HostConfig 原有 transition 名称/props；按 update 所有权规则可停在嵌套边界。
 */
function restoreViewTransitionOnHostInstances(
  child: null | Fiber,
  stopAtNestedViewTransitions: boolean,
): void {
  // $FlowFixMe[constant-condition]
  if (!supportsMutation) {
    return;
  }
  while (child !== null) {
    if (child.tag === HostComponent) {
      const instance: Instance = child.stateNode;
      restoreViewTransitionName(instance, child.memoizedProps);
    } else if (
      child.tag === OffscreenComponent &&
      child.memoizedState !== null
    ) {
      // 跳过隐藏子树；对动画而言它们等同不存在。
    } else if (
      child.tag === ViewTransitionComponent &&
      stopAtNestedViewTransitions
    ) {
      // update 时跳过嵌套 ViewTransition，由最内层边界处理。
    } else {
      restoreViewTransitionOnHostInstances(
        child.child,
        stopAtNestedViewTransitions,
      );
    }
    child = child.sibling;
  }
}

/**
 * 在新出现子树中处理已与删除边界配对的命名 ViewTransition，应用 share class。
 * 新边界若已离开 viewport，则撤销名称，退化为旧边界 exit，避免屏外飞入动画。
 */
function commitAppearingPairViewTransitions(placement: Fiber): void {
  if ((placement.subtreeFlags & ViewTransitionNamedStatic) === NoFlags) {
    // 子树没有命名 ViewTransition。
    return;
  }
  let child = placement.child;
  while (child !== null) {
    if (child.tag === OffscreenComponent && child.memoizedState !== null) {
      // 子树原本已隐藏，跳过。
    } else {
      commitAppearingPairViewTransitions(child);
      if (
        child.tag === ViewTransitionComponent &&
        (child.flags & ViewTransitionNamedStatic) !== NoFlags
      ) {
        const instance: ViewTransitionState = child.stateNode;
        if (instance.paired) {
          const props: ViewTransitionProps = child.memoizedProps;
          if (props.name == null || props.name === 'auto') {
            throw new Error(
              'Found a pair with an auto name. This is a bug in React.',
            );
          }
          const name = props.name;
          const className: ?string = getViewTransitionClassName(
            props.default,
            props.share,
          );
          if (className !== 'none') {
            // 新出现边界与删除边界同名，在两者间执行 share transition。
            const inViewport = applyViewTransitionToHostInstances(
              child,
              name,
              className,
              null,
              false,
            );
            if (!inViewport) {
              // 旧边界在 viewport 内退出，新边界却将离开 viewport；撤销新名称，按旧边界 exit
              // 处理。旧 snapshot 已建立，无法撤销。TODO：这可能意外触发 exit 动画，评估
              // 是否让新边界直接飞出屏幕更合理。
              restoreViewTransitionOnHostInstances(child.child, false);
            }
          }
        }
      }
    }
    child = child.sibling;
  }
}

/**
 * 递归应用后代 ViewTransition 的 parentEnter class/handler。
 * class 为 none 时停止向下 relay；gesture 路径选择 onGestureParentEnter 调度通道。
 */
export function commitParentEnterViewTransitions(
  parent: Fiber,
  gesture: boolean,
): void {
  let child = parent.child;
  while (child !== null) {
    if (child.tag === OffscreenComponent && child.memoizedState !== null) {
      // 跳过隐藏子树。
    } else if (child.tag === ViewTransitionComponent) {
      const props: ViewTransitionProps = child.memoizedProps;
      const hasParentClass = props.parentEnter !== undefined;
      const hasParentHandler = gesture
        ? props.onGestureParentEnter != null
        : props.onParentEnter != null;
      if (hasParentClass || hasParentHandler) {
        let relay = true;
        if (hasParentClass) {
          const state: ViewTransitionState = child.stateNode;
          const name = getViewTransitionName(props, state);
          const className: ?string = getViewTransitionClassName(
            props.default,
            props.parentEnter,
          );
          if (className === 'none') {
            relay = false;
          } else {
            applyViewTransitionToHostInstances(
              child,
              name,
              className,
              null,
              false,
            );
            if (hasParentHandler) {
              if (gesture) {
                scheduleGestureTransitionEvent(
                  child,
                  props.onGestureParentEnter,
                );
              } else {
                scheduleViewTransitionEvent(child, props.onParentEnter);
              }
            }
          }
        } else {
          if (gesture) {
            scheduleGestureTransitionEvent(child, props.onGestureParentEnter);
          } else {
            scheduleViewTransitionEvent(child, props.onParentEnter);
          }
        }
        if (relay) {
          commitParentEnterViewTransitions(child, gesture);
        }
      }
    } else if ((child.subtreeFlags & ViewTransitionStaticParent) !== NoFlags) {
      commitParentEnterViewTransitions(child, gesture);
    }
    child = child.sibling;
  }
}

/**
 * 递归应用后代 ViewTransition 的 parentExit class/handler；relay 与 gesture 规则同 enter。
 */
export function commitParentExitViewTransitions(
  parent: Fiber,
  gesture: boolean,
): void {
  let child = parent.child;
  while (child !== null) {
    if (child.tag === OffscreenComponent && child.memoizedState !== null) {
      // 跳过隐藏子树。
    } else if (child.tag === ViewTransitionComponent) {
      const props: ViewTransitionProps = child.memoizedProps;
      const hasParentClass = props.parentExit !== undefined;
      const hasParentHandler = gesture
        ? props.onGestureParentExit != null
        : props.onParentExit != null;
      if (hasParentClass || hasParentHandler) {
        let relay = true;
        if (hasParentClass) {
          const state: ViewTransitionState = child.stateNode;
          const name = getViewTransitionName(props, state);
          const className: ?string = getViewTransitionClassName(
            props.default,
            props.parentExit,
          );
          if (className === 'none') {
            relay = false;
          } else {
            applyViewTransitionToHostInstances(
              child,
              name,
              className,
              null,
              false,
            );
            if (hasParentHandler) {
              if (gesture) {
                scheduleGestureTransitionEvent(
                  child,
                  props.onGestureParentExit,
                );
              } else {
                scheduleViewTransitionEvent(child, props.onParentExit);
              }
            }
          }
        } else {
          if (gesture) {
            scheduleGestureTransitionEvent(child, props.onGestureParentExit);
          } else {
            scheduleViewTransitionEvent(child, props.onParentExit);
          }
        }
        if (relay) {
          commitParentExitViewTransitions(child, gesture);
        }
      }
    } else if ((child.subtreeFlags & ViewTransitionStaticParent) !== NoFlags) {
      commitParentExitViewTransitions(child, gesture);
    }
    child = child.sibling;
  }
}

/** 递归恢复 parentEnter/parentExit 曾应用到后代宿主实例的 transition 名称。 */
function restoreParentEnterOrExitViewTransitions(parent: Fiber): void {
  let child = parent.child;
  while (child !== null) {
    if (child.tag === OffscreenComponent && child.memoizedState !== null) {
      // 跳过隐藏子树。
    } else if (child.tag === ViewTransitionComponent) {
      const props: ViewTransitionProps = child.memoizedProps;
      const hasParentClass =
        props.parentEnter !== undefined || props.parentExit !== undefined;
      const hasParentHandler =
        props.onParentEnter != null ||
        props.onParentExit != null ||
        props.onGestureParentEnter != null ||
        props.onGestureParentExit != null;
      if (hasParentClass) {
        restoreViewTransitionOnHostInstances(child.child, false);
      }
      if (hasParentClass || hasParentHandler) {
        restoreParentEnterOrExitViewTransitions(child);
      }
    } else if ((child.subtreeFlags & ViewTransitionStaticParent) !== NoFlags) {
      restoreParentEnterOrExitViewTransitions(child);
    }
    child = child.sibling;
  }
}

/**
 * 为 Placement 子树提交 enter/share 动画。
 * 屏外边界撤销名称；配对边界先处理 share，未配对边界调度 enter 与可选 parentEnter；
 * 非 ViewTransition Fiber 仅在静态标记表明后代相关时递归。
 */
export function commitEnterViewTransitions(
  placement: Fiber,
  gesture: boolean,
): void {
  if (placement.tag === ViewTransitionComponent) {
    const state: ViewTransitionState = placement.stateNode;
    const props: ViewTransitionProps = placement.memoizedProps;
    const name = getViewTransitionName(props, state);
    const className: ?string = getViewTransitionClassName(
      props.default,
      state.paired ? props.share : props.enter,
    );
    if (className !== 'none') {
      const inViewport = applyViewTransitionToHostInstances(
        placement,
        name,
        className,
        null,
        false,
      );
      if (!inViewport) {
        // TODO：配对时仍会调用 onShare。边界不在 viewport，撤销名称并跳过动画。
        restoreViewTransitionOnHostInstances(placement.child, false);
        // TODO：是否仍应访问 child，以处理其中可能在 viewport 的命名边界？
      } else {
        commitAppearingPairViewTransitions(placement);

        if (!state.paired) {
          if (gesture) {
            scheduleGestureTransitionEvent(placement, props.onGestureEnter);
          } else {
            scheduleViewTransitionEvent(placement, props.onEnter);
          }
          if (enableViewTransitionParentEnterExit) {
            commitParentEnterViewTransitions(placement, gesture);
          }
        }
      }
    } else {
      commitAppearingPairViewTransitions(placement);
    }
  } else if ((placement.subtreeFlags & ViewTransitionStatic) !== NoFlags) {
    let child = placement.child;
    while (child !== null) {
      commitEnterViewTransitions(child, gesture);
      child = child.sibling;
    }
  } else {
    commitAppearingPairViewTransitions(placement);
  }
}

/**
 * 在删除子树中按 name 查找新出现边界的 share 配对；命中后双向连接 state.paired、应用
 * 旧侧名称并调度 onShare。每个 name 消费一次，Map 清空即可提前结束遍历。
 */
function commitDeletedPairViewTransitions(deletion: Fiber): void {
  if (
    appearingViewTransitions === null ||
    appearingViewTransitions.size === 0
  ) {
    // 所有新出现边界都已找到配对。
    return;
  }
  const pairs = appearingViewTransitions;
  if ((deletion.subtreeFlags & ViewTransitionNamedStatic) === NoFlags) {
    // 子树没有命名 ViewTransition。
    return;
  }
  let child = deletion.child;
  while (child !== null) {
    if (child.tag === OffscreenComponent && child.memoizedState !== null) {
      // 子树原本已隐藏，跳过。
    } else {
      if (
        child.tag === ViewTransitionComponent &&
        (child.flags & ViewTransitionNamedStatic) !== NoFlags
      ) {
        const props: ViewTransitionProps = child.memoizedProps;
        const name = props.name;
        if (name != null && name !== 'auto') {
          const pair = pairs.get(name);
          if (pair !== undefined) {
            const className: ?string = getViewTransitionClassName(
              props.default,
              props.share,
            );
            if (className !== 'none') {
              // 找到与删除边界同名的新出现 ViewTransition。
              const inViewport = applyViewTransitionToHostInstances(
                child,
                name,
                className,
                null,
                false,
              );
              if (!inViewport) {
                // 旧边界不在 viewport，不建立配对并撤销名称，避免无连续性地飞入屏幕。
                restoreViewTransitionOnHostInstances(child.child, false);
              } else {
                // 双向连接两侧，在旧/新 snapshot 间过渡。
                const oldInstance: ViewTransitionState = child.stateNode;
                const newInstance: ViewTransitionState = pair;
                newInstance.paired = oldInstance;
                oldInstance.paired = newInstance;
                // 即使另一侧最终在 viewport 外仍会调度，因此 onShare 可能只有旧 snapshot。
                scheduleViewTransitionEvent(child, props.onShare);
              }
            }
            // 消费 Map 条目；size 为零即可停止搜索。
            pairs.delete(name);
            if (pairs.size === 0) {
              break;
            }
          }
        }
      }
      commitDeletedPairViewTransitions(child);
    }
    child = child.sibling;
  }
}

/**
 * 为删除子树提交 exit/share 动画：优先用 appearingViewTransitions 建立同名配对，否则
 * 调度 onExit 与 parentExit；屏外边界撤销名称并跳过动画。
 */
export function commitExitViewTransitions(deletion: Fiber): void {
  if (deletion.tag === ViewTransitionComponent) {
    const props: ViewTransitionProps = deletion.memoizedProps;
    const name = getViewTransitionName(props, deletion.stateNode);
    const pair =
      appearingViewTransitions !== null
        ? appearingViewTransitions.get(name)
        : undefined;
    const className: ?string = getViewTransitionClassName(
      props.default,
      pair !== undefined ? props.share : props.exit,
    );
    if (className !== 'none') {
      const inViewport = applyViewTransitionToHostInstances(
        deletion,
        name,
        className,
        null,
        false,
      );
      if (!inViewport) {
        // 边界不在 viewport，撤销 transition 名称并跳过动画。
        restoreViewTransitionOnHostInstances(deletion.child, false);
        // TODO：是否仍应访问 child，以处理其中可能在 viewport 的命名边界？
      } else if (pair !== undefined) {
        // 找到同名新出现边界，以 share 替代普通 exit。
        const oldInstance: ViewTransitionState = deletion.stateNode;
        const newInstance: ViewTransitionState = pair;
        newInstance.paired = oldInstance;
        oldInstance.paired = newInstance;
        // 消费 Map 条目；size 为零即可停止搜索。
        // $FlowFixMe[incompatible-use]: Refined by the pair.
        appearingViewTransitions.delete(name);
        // 即使另一侧最终在 viewport 外仍会调度，因此 onShare 可能只有旧 snapshot。
        scheduleViewTransitionEvent(deletion, props.onShare);
      } else {
        scheduleViewTransitionEvent(deletion, props.onExit);
        if (enableViewTransitionParentEnterExit) {
          commitParentExitViewTransitions(deletion, false);
        }
      }
    }
    if (appearingViewTransitions !== null) {
      // 继续在更深删除子树寻找配对。
      commitDeletedPairViewTransitions(deletion);
    }
  } else if ((deletion.subtreeFlags & ViewTransitionStatic) !== NoFlags) {
    let child = deletion.child;
    while (child !== null) {
      commitExitViewTransitions(child);
      child = child.sibling;
    }
  } else {
    if (appearingViewTransitions !== null) {
      commitDeletedPairViewTransitions(deletion);
    }
  }
}

/**
 * snapshot 阶段为更新前 current 宿主实例应用旧 transition 名称并保存测量。
 * 多宿主 child 按遍历顺序配对；插入/删除会使后续实例后缀变化，从而表现为层内容交叉淡入，
 * 若需要真实 reorder 动画，应给每个 child 独立 ViewTransition。
 */
export function commitBeforeUpdateViewTransition(
  current: Fiber,
  finishedWork: Fiber,
): void {
  // 此函数在 snapshot 对 current 调用；mutation 阶段再为 finishedWork 应用新名称。
  const oldProps: ViewTransitionProps = current.memoizedProps;
  const oldName = getViewTransitionName(oldProps, current.stateNode);
  const newProps: ViewTransitionProps = finishedWork.memoizedProps;
  // className 主要用于 child DOM 数量减少，或本应取消但父级仍动画、迫使 child 同步动画。
  // 例如 update="foo"、layout="none" 且仅布局变化时仍应用 foo，属于已知缺陷。
  const className: ?string = getViewTransitionClassName(
    newProps.default,
    newProps.update,
  );
  if (className === 'none') {
    // update="none" 不动画该边界，无需应用名称。
    return;
  }
  applyViewTransitionToHostInstances(
    current,
    oldName,
    className,
    (current.memoizedState = []),
    true,
  );
}

/**
 * 父级变化时为未自身重渲染的嵌套 ViewTransition 应用 update 名称并保存测量。
 * 外层通常拥有更新；若内层自身有更新则内层优先。临时清除 Update，留给布局测量重新判定。
 */
export function commitNestedViewTransitions(changedParent: Fiber): void {
  let child = changedParent.child;
  while (child !== null) {
    if (child.tag === ViewTransitionComponent) {
      // 未穿过内层更新时外层拥有动画；内层自身更新时由内层拥有。
      const props: ViewTransitionProps = child.memoizedProps;
      const name = getViewTransitionName(props, child.stateNode);
      const className: ?string = getViewTransitionClassName(
        props.default,
        props.update,
      );
      // 嵌套边界位于未更新子树，因此这是 current。Update 通常在重渲染时清除，但提交期还用
      // 它跟踪布局变化，故先清除。TODO：改用独立临时状态。
      child.flags &= ~Update;
      if (className !== 'none') {
        applyViewTransitionToHostInstances(
          child,
          name,
          className,
          (child.memoizedState = []),
          false,
        );
      }
    } else if ((child.subtreeFlags & ViewTransitionStatic) !== NoFlags) {
      commitNestedViewTransitions(child);
    }
    child = child.sibling;
  }
}

/** 递归断开命名边界 state.paired，并恢复配对时应用的宿主 transition 名称。 */
function restorePairedViewTransitions(parent: Fiber): void {
  if ((parent.subtreeFlags & ViewTransitionNamedStatic) === NoFlags) {
    // 子树没有命名 ViewTransition。
    return;
  }
  let child = parent.child;
  while (child !== null) {
    if (child.tag === OffscreenComponent && child.memoizedState !== null) {
      // 子树原本已隐藏，跳过。
    } else {
      if (
        child.tag === ViewTransitionComponent &&
        (child.flags & ViewTransitionNamedStatic) !== NoFlags
      ) {
        const instance: ViewTransitionState = child.stateNode;
        if (instance.paired !== null) {
          instance.paired = null;
          restoreViewTransitionOnHostInstances(child.child, false);
        }
      }
      restorePairedViewTransitions(child);
    }
    child = child.sibling;
  }
}

/**
 * enter/exit/share 结束或取消后，恢复当前边界、parent enter/exit 与所有命名配对的宿主名称。
 */
export function restoreEnterOrExitViewTransitions(fiber: Fiber): void {
  if (fiber.tag === ViewTransitionComponent) {
    const instance: ViewTransitionState = fiber.stateNode;
    instance.paired = null;
    restoreViewTransitionOnHostInstances(fiber.child, false);
    if (enableViewTransitionParentEnterExit) {
      restoreParentEnterOrExitViewTransitions(fiber);
    }
    restorePairedViewTransitions(fiber);
  } else if ((fiber.subtreeFlags & ViewTransitionStatic) !== NoFlags) {
    let child = fiber.child;
    while (child !== null) {
      restoreEnterOrExitViewTransitions(child);
      child = child.sibling;
    }
  } else {
    restorePairedViewTransitions(fiber);
  }
}

/** update 动画结束后同时恢复 current 旧侧与 finishedWork 新侧的宿主名称。 */
export function restoreUpdateViewTransition(
  current: Fiber,
  finishedWork: Fiber,
): void {
  restoreViewTransitionOnHostInstances(current.child, true);
  restoreViewTransitionOnHostInstances(finishedWork.child, true);
}

/**
 * gesture update 结束后仅恢复 current；finishedWork 侧均为已删除 clone，无需恢复。
 */
export function restoreUpdateViewTransitionForGesture(
  current: Fiber,
  finishedWork: Fiber,
): void {
  // gesture 的 finishedWork 均为已删除 clone，无需重置。
  restoreViewTransitionOnHostInstances(current.child, true);
}

/** 递归恢复父布局变化时给嵌套 ViewTransition 应用的宿主名称。 */
export function restoreNestedViewTransitions(changedParent: Fiber): void {
  let child = changedParent.child;
  while (child !== null) {
    if (child.tag === ViewTransitionComponent) {
      restoreViewTransitionOnHostInstances(child.child, false);
    } else if ((child.subtreeFlags & ViewTransitionStatic) !== NoFlags) {
      restoreNestedViewTransitions(child);
    }
    child = child.sibling;
  }
}

/**
 * 重置宿主下标并测量 ViewTransition 的新旧终端实例，返回是否有任一状态位于 viewport。
 */
export function measureViewTransitionHostInstances(
  parentViewTransition: Fiber,
  child: null | Fiber,
  newName: string,
  oldName: string,
  className: ?string,
  previousMeasurements: null | Array<InstanceMeasurement>,
  stopAtNestedViewTransitions: boolean,
): boolean {
  viewTransitionHostInstanceIdx = 0;
  return measureViewTransitionHostInstancesRecursive(
    parentViewTransition,
    child,
    newName,
    oldName,
    className,
    previousMeasurements,
    stopAtNestedViewTransitions,
  );
}

/**
 * 按遍历位置比较旧/新 InstanceMeasurement，标记 Update 与 AffectedParentLayout，并为实际
 * 动画实例应用新名称。可能取消的 child 暂存，待确认父级不动画后再恢复。
 */
function measureViewTransitionHostInstancesRecursive(
  parentViewTransition: Fiber,
  child: null | Fiber,
  newName: string,
  oldName: string,
  className: ?string,
  previousMeasurements: null | Array<InstanceMeasurement>,
  stopAtNestedViewTransitions: boolean,
): boolean {
  // $FlowFixMe[constant-condition]
  if (!supportsMutation) {
    if (enableViewTransitionForPersistenceMode) {
      while (child !== null) {
        if (child.tag === HostComponent) {
          const instance: Instance = child.stateNode;
          if (
            previousMeasurements == null ||
            viewTransitionHostInstanceIdx >= previousMeasurements.length
          ) {
            // 新增额外宿主节点时保守认为影响父布局；mutation 本应已标记 Update。
            parentViewTransition.flags |= AffectedParentLayout;
          }
          // TODO：检查 persistence 实例是否在 viewport 外。
          if ((parentViewTransition.flags & Update) !== NoFlags) {
            applyViewTransitionName(
              instance,
              viewTransitionHostInstanceIdx === 0
                ? newName
                : newName + '_' + viewTransitionHostInstanceIdx,
              className,
            );
          }
          // TODO：通过 viewTransitionCancelableChildren 支持取消 transition。
          viewTransitionHostInstanceIdx++;
        } else if (
          child.tag === OffscreenComponent &&
          child.memoizedState !== null
        ) {
          // 跳过隐藏子树；对动画而言它们等同不存在。
        } else if (
          child.tag === ViewTransitionComponent &&
          stopAtNestedViewTransitions
        ) {
          // update 时跳过嵌套边界，由最内层处理；但其 resize 需上冒 AffectedParentLayout。
          parentViewTransition.flags |= child.flags & AffectedParentLayout;
        } else {
          measureViewTransitionHostInstancesRecursive(
            parentViewTransition,
            child.child,
            newName,
            oldName,
            className,
            previousMeasurements,
            stopAtNestedViewTransitions,
          );
        }
        child = child.sibling;
      }
      return true;
    } else {
      return false;
    }
  }
  let inViewport = false;
  while (child !== null) {
    if (child.tag === HostComponent) {
      const instance: Instance = child.stateNode;
      if (
        previousMeasurements !== null &&
        viewTransitionHostInstanceIdx < previousMeasurements.length
      ) {
        // 这是 ViewTransition 同一遍历位置的旧测量；child 变化时未必是同一宿主实例。
        const previousMeasurement =
          previousMeasurements[viewTransitionHostInstanceIdx];
        const nextMeasurement = measureInstance(instance);
        if (
          wasInstanceInViewport(previousMeasurement) ||
          wasInstanceInViewport(nextMeasurement)
        ) {
          // 旧/新任一状态在 viewport 内就需动画；两者都不在时可跳过。
          inViewport = true;
        }
        if (
          (parentViewTransition.flags & Update) === NoFlags &&
          hasInstanceChanged(previousMeasurement, nextMeasurement)
        ) {
          parentViewTransition.flags |= Update;
        }
        if (hasInstanceAffectedParent(previousMeasurement, nextMeasurement)) {
          // 实例在父级内尺寸变化可能触发布局，父级需 cross-fade。
          parentViewTransition.flags |= AffectedParentLayout;
        }
      } else {
        // 新增额外宿主节点时保守认为影响父布局；mutation 本应已标记 Update。
        parentViewTransition.flags |= AffectedParentLayout;
      }
      if ((parentViewTransition.flags & Update) !== NoFlags) {
        // 节点可能更新，需为新状态应用名称；ApplyGesture 的 clone 已有名称，原实例也需补上。
        applyViewTransitionName(
          instance,
          viewTransitionHostInstanceIdx === 0
            ? newName
            : // 多个宿主实例追加下标后缀，保证名称唯一。
              newName + '_' + viewTransitionHostInstanceIdx,
          className,
        );
      }
      if (!inViewport || (parentViewTransition.flags & Update) === NoFlags) {
        // 没有更深 mutation、child transition 未影响父布局且实例尺寸未变，可跳过动画；但
        // 只有父级也不动画时才能取消，因此先入队，待父级测量完成再决定。
        if (viewTransitionCancelableChildren === null) {
          viewTransitionCancelableChildren = [];
        }
        viewTransitionCancelableChildren.push(
          instance,
          viewTransitionHostInstanceIdx === 0
            ? oldName
            : // 多个宿主实例追加下标后缀，保证名称唯一。
              oldName + '_' + viewTransitionHostInstanceIdx,
          child.memoizedProps,
        );
      }
      viewTransitionHostInstanceIdx++;
    } else if (
      child.tag === OffscreenComponent &&
      child.memoizedState !== null
    ) {
      // 跳过隐藏子树；对动画而言它们等同不存在。
    } else if (
      child.tag === ViewTransitionComponent &&
      stopAtNestedViewTransitions
    ) {
      // update 时跳过嵌套边界，由最内层处理；但其 resize 需上冒 AffectedParentLayout。
      parentViewTransition.flags |= child.flags & AffectedParentLayout;
    } else {
      if (
        measureViewTransitionHostInstancesRecursive(
          parentViewTransition,
          child.child,
          newName,
          oldName,
          className,
          previousMeasurements,
          stopAtNestedViewTransitions,
        )
      ) {
        inViewport = true;
      }
    }
    child = child.sibling;
  }
  return inViewport;
}

/**
 * 比较更新边界新旧宿主测量，决定是否真的动画并标记父布局影响。
 * gesture 的 old/new Fiber 语义反转，但 flags 始终写 finishedWork；旧测量来自 snapshot，
 * gesture 则从 clone 测量。child 数量变化保守视为影响父布局。
 */
export function measureUpdateViewTransition(
  current: Fiber,
  finishedWork: Fiber,
  gesture: boolean,
): boolean {
  // gesture 时 old/new Fiber 反转，但本次提交 flags 仍写 finishedWork。
  const oldFiber = gesture ? finishedWork : current;
  const newFiber = gesture ? current : finishedWork;
  const props: ViewTransitionProps = newFiber.memoizedProps;
  const state: ViewTransitionState = newFiber.stateNode;
  const newName = getViewTransitionName(props, state);
  const oldName = getViewTransitionName(oldFiber.memoizedProps, state);
  // 无论实际内容更新还是 relayout，都使用 update className。
  const className: ?string = getViewTransitionClassName(
    props.default,
    props.update,
  );
  if (className === 'none') {
    // update="none" 不动画该边界，无需应用名称。
    return false;
  }
  // 若 mutation/child 尺寸最终未造成测量变化，应恢复名称并取消动画。
  let previousMeasurements: null | Array<InstanceMeasurement>;
  if (gesture) {
    const clones = state.clones;
    if (clones === null) {
      previousMeasurements = null;
    } else {
      previousMeasurements = clones.map(measureClonedInstance);
    }
  } else {
    previousMeasurements = oldFiber.memoizedState;
    oldFiber.memoizedState = null; // 旧测量已消费，立即清空。
  }
  const inViewport = measureViewTransitionHostInstances(
    finishedWork, // flags 始终写 finishedWork。
    newFiber.child, // gesture 决定这里来自 current 还是 finishedWork。
    newName,
    oldName,
    className,
    previousMeasurements,
    true,
  );
  const previousCount =
    previousMeasurements === null ? 0 : previousMeasurements.length;
  if (viewTransitionHostInstanceIdx !== previousCount) {
    // child DOM 数量变化时保守认为父布局受影响；绝对定位节点可能是例外。
    finishedWork.flags |= AffectedParentLayout;
  }
  return inViewport;
}

/**
 * 测量父级变化下未重渲染的嵌套 ViewTransition；确认实际 Update 且进入 viewport 后，
 * 按 gesture/普通路径调度 onGestureUpdate 或 onUpdate。
 */
export function measureNestedViewTransitions(
  changedParent: Fiber,
  gesture: boolean,
): void {
  let child = changedParent.child;
  while (child !== null) {
    if (child.tag === ViewTransitionComponent) {
      const props: ViewTransitionProps = child.memoizedProps;
      const state: ViewTransitionState = child.stateNode;
      const name = getViewTransitionName(props, state);
      const className: ?string = getViewTransitionClassName(
        props.default,
        props.update,
      );
      let previousMeasurements: null | Array<InstanceMeasurement>;
      if (gesture) {
        const clones = state.clones;
        if (clones === null) {
          previousMeasurements = null;
        } else {
          previousMeasurements = clones.map(measureClonedInstance);
        }
      } else {
        previousMeasurements = child.memoizedState;
        child.memoizedState = null; // 旧测量已消费，立即清空。
      }
      const inViewport = measureViewTransitionHostInstances(
        child,
        child.child,
        name,
        name, // 边界自身未变，新旧名称相同。
        className,
        previousMeasurements,
        false,
      );
      if ((child.flags & Update) === NoFlags || !inViewport) {
        // 没有实际变化或完全位于 viewport 外。
      } else {
        if (gesture) {
          scheduleGestureTransitionEvent(child, props.onGestureUpdate);
        } else {
          scheduleViewTransitionEvent(child, props.onUpdate);
        }
      }
    } else if ((child.subtreeFlags & ViewTransitionStatic) !== NoFlags) {
      measureNestedViewTransitions(child, gesture);
    }
    child = child.sibling;
  }
}
