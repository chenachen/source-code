/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {FiberRoot} from './ReactInternalTypes';
import type {GestureOptions} from 'shared/ReactTypes';
import type {GestureTimeline, RunningViewTransition} from './ReactFiberConfig';
import type {TransitionTypes} from 'react/src/ReactTransitionType';
import type {Lane} from './ReactFiberLane';

import {
  GestureLane,
  markRootEntangled,
  markRootFinished,
  NoLane,
  NoLanes,
} from './ReactFiberLane';
import {
  ensureRootIsScheduled,
  requestTransitionLane,
} from './ReactFiberRootScheduler';
import {getCurrentGestureOffset, stopViewTransition} from './ReactFiberConfig';
import {pingGestureRoot, restartGestureRoot} from './ReactFiberWorkLoop';

/** 描述根上一个已排队或正在运行的手势式 View Transition。 */
export type ScheduledGesture = {
  /** 提供当前位置和时间线状态的宿主手势对象。 */
  provider: GestureTimeline,
  /** 同一个 provider 被启动但尚未取消的引用次数。 */
  count: number,
  /** 时间线上“当前状态”所在的百分比。 */
  rangeStart: number,
  /** 时间线上“目标状态”所在的百分比。 */
  rangeEnd: number,
  /** `startGestureTransition` 期间收集到的去重 Transition 类型。 */
  types: null | TransitionTypes,
  /** 正在运行的宿主 View Transition，结束时用它执行取消。 */
  running: null | RunningViewTransition,
  /** 已准备好提交时可直接执行的提交回调。 */
  commit: null | (() => void),
  /** 松手位置选择了目标状态，因而队首手势需要真正提交。 */
  committing: boolean,
  /** 取消手势时用于调度回退更新的 Lane。 */
  revertLane: Lane,
  /** 当前根手势队列中的前一个节点。 */
  prev: null | ScheduledGesture,
  /** 当前根手势队列中的后一个节点。 */
  next: null | ScheduledGesture,
};

/**
 * 确保指定手势 provider 已进入根的待处理队列。
 *
 * 同一个 provider 复用现有节点；新节点追加到双向链表尾部，并唤醒根调度器。
 * 此阶段只登记候选手势，真正的引用计数和范围由 `startScheduledGesture` 更新。
 */
export function scheduleGesture(
  root: FiberRoot,
  provider: GestureTimeline,
): ScheduledGesture {
  let prev = root.pendingGestures;
  while (prev !== null) {
    if (prev.provider === provider) {
      // 已经存在同一 provider 的排队实例，直接复用。
      return prev;
    }
    const next = prev.next;
    // $FlowFixMe[invalid-compare]
    if (next === null) {
      break;
    }
    prev = next;
  }
  const gesture: ScheduledGesture = {
    provider: provider,
    count: 0,
    rangeStart: 0, // 尚未由启动参数初始化。
    rangeEnd: 100, // 尚未由启动参数初始化。
    types: null,
    running: null,
    commit: null,
    committing: false,
    revertLane: NoLane, // 回退更新尚未分配 Lane。
    prev: prev,
    next: null,
  };
  if (prev === null) {
    root.pendingGestures = gesture;
  } else {
    prev.next = gesture;
  }
  ensureRootIsScheduled(root);
  return gesture;
}

/**
 * 启动已登记的手势，并合并本次范围与 Transition 类型。
 *
 * 范围缺省时从宿主时间线读取当前偏移，并把终点选到较远的一端。若同一 provider
 * 被嵌套启动，则增加引用计数并合并类型；若此 renderer 没有对应登记项，则返回
 * `null`，因为更新可能属于另一个 renderer。
 */
export function startScheduledGesture(
  root: FiberRoot,
  gestureTimeline: GestureTimeline,
  gestureOptions: ?GestureOptions,
  transitionTypes: null | TransitionTypes,
): null | ScheduledGesture {
  const rangeStart =
    gestureOptions && gestureOptions.rangeStart != null
      ? gestureOptions.rangeStart
      : getCurrentGestureOffset(gestureTimeline);
  const rangeEnd =
    gestureOptions && gestureOptions.rangeEnd != null
      ? gestureOptions.rangeEnd
      : rangeStart < 50
        ? 100
        : 0;
  let prev = root.pendingGestures;
  while (prev !== null) {
    if (prev.provider === gestureTimeline) {
      // 找到先前登记的同一手势实例。
      prev.count++;
      // 每次启动都以最新选项刷新有效范围。
      prev.rangeStart = rangeStart;
      prev.rangeEnd = rangeEnd;
      if (transitionTypes !== null) {
        let scheduledTypes = prev.types;
        if (scheduledTypes === null) {
          scheduledTypes = prev.types = [];
        }
        for (let i = 0; i < transitionTypes.length; i++) {
          const transitionType = transitionTypes[i];
          if (scheduledTypes.indexOf(transitionType) === -1) {
            scheduledTypes.push(transitionType);
          }
        }
      }
      return prev;
    }
    const next = prev.next;
    // $FlowFixMe[invalid-compare]
    if (next === null) {
      break;
    }
    prev = next;
  }
  // 当前 renderer 没有登记这个手势；更新可能发生在另一个 renderer。
  return null;
}

/**
 * 结束一次手势引用，并在最后一次结束时决定提交目标态还是立即回退。
 *
 * 终点越过范围中点时保留队首手势并触发 GestureLane 提交；否则停止宿主 View
 * Transition、从双向队列移除节点，并在必要时重启队首渲染。手势事件中产生的
 * Transition 与回退 Lane 纠缠，确保它们原子提交。
 */
export function cancelScheduledGesture(
  root: FiberRoot,
  gesture: ScheduledGesture,
): void {
  // 把本事件启动的 Transition 与手势回退 Lane 纠缠，使它们在同一次提交中生效。
  if (gesture.revertLane !== NoLane) {
    const entangledLanes = gesture.revertLane | requestTransitionLane(null);
    markRootEntangled(root, entangledLanes);
  }

  gesture.count--;
  if (gesture.count === 0) {
    // 松手位置更接近目标端时先提交目标态；否则直接回退，不提交目标态。
    let shouldCommit: boolean;
    const finalOffset = getCurrentGestureOffset(gesture.provider);
    const rangeStart = gesture.rangeStart;
    const rangeEnd = gesture.rangeEnd;
    if (rangeStart < rangeEnd) {
      shouldCommit = finalOffset > rangeStart + (rangeEnd - rangeStart) / 2;
    } else {
      shouldCommit = finalOffset < rangeEnd + (rangeStart - rangeEnd) / 2;
    }
    // TODO: 若当前正渲染此手势，应改用另一手势重新开始或取消本次渲染。
    // TODO: 此时位置已经不应再变化；可以考虑暂停 View Transition，也可能直接
    // 提交手势状态更合适。
    const runningTransition = gesture.running;
    if (runningTransition !== null && shouldCommit) {
      // 选择目标态时要等 React 提交后再停止宿主 Transition，并在 GestureLane
      // 调度一次渲染来落实该状态。
      gesture.committing = true;
      if (root.pendingGestures === gesture) {
        const commitCallback = gesture.commit;
        if (commitCallback !== null) {
          gesture.commit = null;
          // 已准备好提交回调时可跳过重新渲染，直接提交树。
          // TODO: 考虑把它放进任务，而不是在最后一次取消中同步执行。
          commitCallback();
        } else {
          // 用新状态唤醒根，作用类似 pingSuspendedRoot。
          pingGestureRoot(root);
        }
      }
    } else {
      // 不提交目标态时可立即停止 View Transition，并从待处理队列删除手势。
      if (gesture.prev === null) {
        if (root.pendingGestures === gesture) {
          // 该节点正是当前渲染的队首手势。
          root.pendingGestures = gesture.next;
          let remainingLanes = root.pendingLanes;
          if (root.pendingGestures === null) {
            // 活跃手势本身不会清掉 Lane；队列已经为空时，仍需移除 GestureLane，
            // 避免在新手势入队前继续调度无效工作。
            remainingLanes &= ~GestureLane;
          }
          markRootFinished(
            root,
            GestureLane,
            remainingLanes,
            NoLane,
            NoLane,
            NoLanes,
          );
          // 队首手势被移除后重置手势渲染：继续下一个节点，或在队列为空时取消。
          restartGestureRoot(root);
        }
        gesture.running = null;
        if (runningTransition !== null) {
          stopViewTransition(runningTransition);
        }
      } else {
        // 非队首手势未参与当前渲染，只需从双向链表摘除。
        gesture.prev.next = gesture.next;
        if (gesture.next !== null) {
          gesture.next.prev = gesture.prev;
        }
        gesture.prev = null;
        gesture.next = null;
      }
    }
  }
}

/**
 * 在队首手势完成 React 提交后停止其宿主 Transition 并推进队列。
 *
 * 若没有后续手势，同时清掉根上的 GestureLane；否则把下一节点提升为无前驱的
 * 队首，等待后续调度继续处理。
 */
export function stopCommittedGesture(root: FiberRoot) {
  // 队首刚刚完成提交，现在可以移出队列并停止对应 View Transition。
  const committedGesture = root.pendingGestures;
  if (committedGesture !== null) {
    // 提交结束后不再把此手势纳入重渲染。
    committedGesture.committing = false;
    const nextGesture = committedGesture.next;
    if (nextGesture === null) {
      // 活跃手势不会自行清 Lane；队列为空后清掉 GestureLane，直到新手势再次入队。
      root.pendingLanes &= ~GestureLane;
    } else {
      nextGesture.prev = null;
    }
    root.pendingGestures = nextGesture;
    const runningTransition = committedGesture.running;
    if (runningTransition !== null) {
      committedGesture.running = null;
      stopViewTransition(runningTransition);
    }
  }
}

/**
 * 为队首手势登记一个无需重渲染即可执行的提交回调。
 *
 * 返回的清理函数会撤销该回调，防止已经失效的预备树被后续手势误提交。
 */
export function scheduleGestureCommit(
  gesture: ScheduledGesture,
  callback: () => void,
): () => void {
  gesture.commit = callback;
  return function () {
    gesture.commit = null;
  };
}
