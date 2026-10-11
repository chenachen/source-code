/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber, FiberRoot} from './ReactInternalTypes';
import type {
  UpdateQueue as HookQueue,
  Update as HookUpdate,
} from './ReactFiberHooks';
import type {
  SharedQueue as ClassQueue,
  Update as ClassUpdate,
} from './ReactFiberClassUpdateQueue';
import type {Lane, Lanes} from './ReactFiberLane';
import type {OffscreenInstance} from './ReactFiberOffscreenComponent';

import {
  warnAboutUpdateOnNotYetMountedFiberInDEV,
  throwIfInfiniteUpdateLoopDetected,
  getWorkInProgressRoot,
} from './ReactFiberWorkLoop';
import {NoLane, NoLanes, mergeLanes, markHiddenUpdate} from './ReactFiberLane';
import {NoFlags, Placement, Hydrating} from './ReactFiberFlags';
import {HostRoot, OffscreenComponent} from './ReactWorkTags';
import {OffscreenVisible} from './ReactFiberOffscreenComponent';

/** 可暂存于并发转移缓冲区、随后接入组件队列的最小更新形状。 */
export type ConcurrentUpdate = {
  /** 队列采用循环链表时指向下一条更新。 */
  next: ConcurrentUpdate,
  /** 该更新所属优先级 Lane。 */
  lane: Lane,
};

/** Hook 或类组件更新队列在本模块需要的公共形状。 */
type ConcurrentQueue = {
  /** 循环链表尾节点；其 next 指向首节点。 */
  pending: ConcurrentUpdate | null,
};

/**
 * 暂存并发入队的 fiber、queue、update、lane 四元组；queue 可为空，只传播该 Fiber 的 lane。
 * finishQueueingConcurrentUpdates 统一接入 pending 环并标记祖先 lanes，避免进行中的 render 直接改队列。
 * bailout 更新在没有并发 render 时也可立即调用该收尾函数，不要求先完成一次渲染。
 */
const concurrentQueues: Array<any> = [];
let concurrentQueuesIndex = 0;

let concurrentlyUpdatedLanes: Lanes = NoLanes;

/**
 * 把渲染期间暂存的并发更新批量接入各自循环队列，并把 Lane 向根传播。
 *
 * 先清空全局索引与 Lane 集，避免处理过程中重入污染本批；空 queue/update 仅用于
 * 标记 Fiber Lane，不会创建队列节点。
 */
export function finishQueueingConcurrentUpdates(): void {
  const endIndex = concurrentQueuesIndex;
  concurrentQueuesIndex = 0;

  concurrentlyUpdatedLanes = NoLanes;

  let i = 0;
  while (i < endIndex) {
    const fiber: Fiber = concurrentQueues[i];
    concurrentQueues[i++] = null;
    const queue: ConcurrentQueue = concurrentQueues[i];
    concurrentQueues[i++] = null;
    const update: ConcurrentUpdate = concurrentQueues[i];
    concurrentQueues[i++] = null;
    const lane: Lane = concurrentQueues[i];
    concurrentQueues[i++] = null;

    // $FlowFixMe[invalid-compare]
    if (queue !== null && update !== null) {
      const pending = queue.pending;
      if (pending === null) {
        // 首条更新自环，创建循环链表。
        update.next = update;
      } else {
        update.next = pending.next;
        pending.next = update;
      }
      queue.pending = update;
    }

    if (lane !== NoLane) {
      markUpdateLaneFromFiberToRoot(fiber, update, lane);
    }
  }
}

/** 返回当前渲染期间已经暂存但尚未转移完的并发 Lane 集。 */
export function getConcurrentlyUpdatedLanes(): Lanes {
  return concurrentlyUpdatedLanes;
}

/**
 * 把一次并发更新四元组写入全局缓冲，并立即标记源 Fiber/alternate 的 lanes。
 * childLanes 在 finishQueueingConcurrentUpdates 收口时沿 return 路径传播；
 * 收口点包括新 render 开始前与已有 render 完成后，避免事件入口改写正在遍历的父链。
 */
function enqueueUpdate(
  fiber: Fiber,
  queue: ConcurrentQueue | null,
  update: ConcurrentUpdate | null,
  lane: Lane,
) {
  // 暂不更新 return 路径上的 childLanes；若正在渲染，要等它结束后再传播。
  concurrentQueues[concurrentQueuesIndex++] = fiber;
  concurrentQueues[concurrentQueuesIndex++] = queue;
  concurrentQueues[concurrentQueuesIndex++] = update;
  concurrentQueues[concurrentQueuesIndex++] = lane;

  concurrentlyUpdatedLanes = mergeLanes(concurrentlyUpdatedLanes, lane);

  // 某些 eager bailout 会立刻检查 Fiber.lanes 判断是否有工作，所以该字段必须同步更新。
  // TODO: 这份标记可能更适合放到 shared queue。
  fiber.lanes = mergeLanes(fiber.lanes, lane);
  const alternate = fiber.alternate;
  if (alternate !== null) {
    alternate.lanes = mergeLanes(alternate.lanes, lane);
  }
}

/** 暂存一条 Hook 更新，并返回沿 Fiber 路径找到的调度根。 */
export function enqueueConcurrentHookUpdate<S, A>(
  fiber: Fiber,
  queue: HookQueue<S, A>,
  update: HookUpdate<S, A>,
  lane: Lane,
): FiberRoot | null {
  const concurrentQueue: ConcurrentQueue = queue as any;
  const concurrentUpdate: ConcurrentUpdate = update as any;
  enqueueUpdate(fiber, concurrentQueue, concurrentUpdate, lane);
  return getRootForUpdatedFiber(fiber);
}

/**
 * 暂存无需立即重渲染的 Hook eager bailout 更新。
 *
 * 使用 NoLane 只为保留将来被更高优先级更新 rebase 的可能；若当前不在渲染，立刻
 * 转移缓冲，避免没有后续工作唤醒时更新永久滞留。
 */
export function enqueueConcurrentHookUpdateAndEagerlyBailout<S, A>(
  fiber: Fiber,
  queue: HookQueue<S, A>,
  update: HookUpdate<S, A>,
): void {
  // 该更新本身无需重渲染；入队只为后续高优先级更新触发 rebase 时仍能保留。
  const lane = NoLane;
  const concurrentQueue: ConcurrentQueue = queue as any;
  const concurrentUpdate: ConcurrentUpdate = update as any;
  enqueueUpdate(fiber, concurrentQueue, concurrentUpdate, lane);

  // 通常下一轮 render 会处理并发队列，但 bailout 不调度工作；若不主动处理，更新会
  // 滞留到某个未知的后续调度，甚至永久泄漏。
  //
  // 当前没有树在渲染时立即转移队列，防止泄漏。
  const isConcurrentlyRendering = getWorkInProgressRoot() !== null;
  if (!isConcurrentlyRendering) {
    finishQueueingConcurrentUpdates();
  }
}

/** 暂存一条类组件更新，并返回沿 Fiber 路径找到的调度根。 */
export function enqueueConcurrentClassUpdate<State>(
  fiber: Fiber,
  queue: ClassQueue<State>,
  update: ClassUpdate<State>,
  lane: Lane,
): FiberRoot | null {
  const concurrentQueue: ConcurrentQueue = queue as any;
  const concurrentUpdate: ConcurrentUpdate = update as any;
  enqueueUpdate(fiber, concurrentQueue, concurrentUpdate, lane);
  return getRootForUpdatedFiber(fiber);
}

/** 只为指定 Fiber/Lane 安排一次并发渲染，不附带组件队列更新。 */
export function enqueueConcurrentRenderForLane(
  fiber: Fiber,
  lane: Lane,
): FiberRoot | null {
  enqueueUpdate(fiber, null, null, lane);
  return getRootForUpdatedFiber(fiber);
}

/**
 * 为向后兼容直接把 Lane 从 Fiber 标到根；外部调用必须同时给出警告。
 *
 * 保持历史可观察顺序：无限更新循环诊断应在实际 Lane 传播前抛出。
 */
export function unsafe_markUpdateLaneFromFiberToRoot(
  sourceFiber: Fiber,
  lane: Lane,
): FiberRoot | null {
  // 受 Hyrum 定律影响，检测到无限更新时要先于 markUpdateLaneFromFiberToRoot 抛错。
  // 这属于未定义行为，未来可调整；当前恰有内部产品测试依赖该顺序。
  const root = getRootForUpdatedFiber(sourceFiber);
  markUpdateLaneFromFiberToRoot(sourceFiber, null, lane);
  return root;
}

/**
 * 把更新 Lane 从源 Fiber 沿 return 链传播到 HostRoot。
 *
 * 同步更新源与 alternate 的 lanes、所有祖先与 alternate 的 childLanes；若路径经过
 * 隐藏 Offscreen，则给更新附加 OffscreenLane，并把引用记入根的 hiddenUpdates；
 * 原 Lane 完成时会清掉该标记，更新无需重新接回组件队列。
 */
function markUpdateLaneFromFiberToRoot(
  sourceFiber: Fiber,
  update: ConcurrentUpdate | null,
  lane: Lane,
): null | FiberRoot {
  // 更新源 Fiber 的 lanes。
  sourceFiber.lanes = mergeLanes(sourceFiber.lanes, lane);
  let alternate = sourceFiber.alternate;
  if (alternate !== null) {
    alternate.lanes = mergeLanes(alternate.lanes, lane);
  }
  // 沿父路径走到根，并更新每层 childLanes。
  let isHidden = false;
  let parent = sourceFiber.return;
  let node = sourceFiber;
  while (parent !== null) {
    parent.childLanes = mergeLanes(parent.childLanes, lane);
    alternate = parent.alternate;
    if (alternate !== null) {
      alternate.childLanes = mergeLanes(alternate.childLanes, lane);
    }

    if (parent.tag === OffscreenComponent) {
      // 检查 Offscreen 边界当前是否隐藏。
      //
      // Offscreen 父节点卸载后 instance 可能为空。通常删除 Fiber 会断开树连接，父节点
      // 不再可达；但若 Fiber 首次挂载前被中断后调用 setState，它既未挂载也不会经历
      // 删除，return 指针也未断开，可能仍指向已删除的 Offscreen 父节点。这也表明若
      // 到 commit 阶段才连接 return，内存行为或许更好，但初次渲染需另用栈记录父路径。
      //
      // 此情况总会伴随警告，但仍必须安全处理；也可能还有尚未发现的类似路径。
      const offscreenInstance: OffscreenInstance | null = parent.stateNode;
      if (
        offscreenInstance !== null &&
        !(offscreenInstance._visibility & OffscreenVisible)
      ) {
        isHidden = true;
      }
    }

    node = parent;
    parent = parent.return;
  }

  if (node.tag === HostRoot) {
    const root: FiberRoot = node.stateNode;
    if (isHidden && update !== null) {
      markHiddenUpdate(root, update, lane);
    }
    return root;
  }
  return null;
}

/**
 * 从收到 setState 的 Fiber 沿 return 路径找到 HostRoot，并执行更新时序诊断。
 *
 * 更新队列没有指回根的指针，只能遍历祖先；沿途还检测尚未挂载 Fiber 的更新。
 */
function getRootForUpdatedFiber(sourceFiber: Fiber): FiberRoot | null {
  // TODO: 当前即使 Fiber 已卸载也检测无限更新并抛错，这是多个版本沿用的行为，但
  // 已卸载 Fiber 不可能再造成循环，可考虑跳过。
  throwIfInfiniteUpdateLoopDetected(false);

  // setState 后必须确保根已调度。更新队列没有根反向指针，只能沿 return 路径遍历。
  // 过去设置 childLanes 时本就要走这条路径，成本不明显；如今两次遍历发生在不同阶段。
  // TODO: 考虑在更新队列增加 `root` 反向指针。
  detectUpdateOnUnmountedFiber(sourceFiber, sourceFiber);
  let node = sourceFiber;
  let parent = node.return;
  while (parent !== null) {
    detectUpdateOnUnmountedFiber(sourceFiber, node);
    node = parent;
    parent = node.return;
  }
  return node.tag === HostRoot ? (node.stateNode as FiberRoot) : null;
}

/** 开发环境检测从尚未完成 Placement/hydration 的 Fiber 发起更新。 */
function detectUpdateOnUnmountedFiber(sourceFiber: Fiber, parent: Fiber) {
  if (__DEV__) {
    const alternate = parent.alternate;
    if (
      alternate === null &&
      (parent.flags & (Placement | Hydrating)) !== NoFlags
    ) {
      warnAboutUpdateOnNotYetMountedFiberInDEV(sourceFiber);
    }
  }
}
