/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// UpdateQueue 是按插入顺序连接、按 Lane 选择执行的更新链表。
//
// 与 Fiber 相同，队列成对存在：current 表示屏幕可见状态；work-in-progress 可在提交前异步
// 修改和处理，形成双缓冲。若 WIP 渲染被丢弃，下一次会从 current 克隆新队列。
//
// 两个队列共享持久化单链表。新更新追加到两边的末尾；各队列各自指向首个未处理更新。
// WIP 始终处理得不比 current 少，current 指针只在提交、WIP 成为 current 时推进：
//
//   current 指针： A - B - C - D - E - F
//   WIP 指针：                 D - E - F
//                               ^ WIP 已处理更多更新
//
// 同时追加到两队列可防更新丢失：只写 WIP 会在从 current 重启时丢失；只写 current 会在旧
// WIP 提交交换时丢失。双写保证下一个 WIP 一定看到更新；WIP 提交后成为 current，因此也
// 不会重复应用。
//
// 优先级与 rebase
// ----------------
//
// 更新不按优先级排序，只按插入顺序追加。render 只执行优先级足够的更新；被跳过的更新
// 保留到低优先级渲染。关键规则是：首个跳过项之后的所有更新无论优先级都保留，因此高
// 优先级项可能在两种优先级各执行一次。baseState 表示应用首个保留更新之前的状态。
//
// 例如 baseState 为 ''，队列为 A1 - B2 - C1 - D2（数字表示优先级，字母追加到状态）：
//
//   优先级 1 首轮：base=''，执行 [A1, C1]，结果 'AC'
//   优先级 2 次轮：base='A'（B2 被跳过时尚未含 C1），执行 [B2, C1, D2]，结果 'ABCD'
//
// 按插入顺序执行，并在前项被跳过时 rebase 后续高优先级更新，使最终结果不受调度顺序
// 影响；系统资源只会改变中间状态，不改变最终状态。

import type {Fiber, FiberRoot} from './ReactInternalTypes';
import type {Lanes, Lane} from './ReactFiberLane';

import {
  NoLane,
  NoLanes,
  OffscreenLane,
  isSubsetOfLanes,
  mergeLanes,
  removeLanes,
  isTransitionLane,
  intersectLanes,
  markRootEntangled,
} from './ReactFiberLane';
import {
  enterDisallowedContextReadInDEV,
  exitDisallowedContextReadInDEV,
} from './ReactFiberNewContext';
import {
  Callback,
  Visibility,
  ShouldCapture,
  DidCapture,
} from './ReactFiberFlags';
import getComponentNameFromFiber from './getComponentNameFromFiber';

import {StrictLegacyMode} from './ReactTypeOfMode';
import {
  markSkippedUpdateLanes,
  isUnsafeClassRenderPhaseUpdate,
  getWorkInProgressRootRenderLanes,
} from './ReactFiberWorkLoop';
import {
  enqueueConcurrentClassUpdate,
  unsafe_markUpdateLaneFromFiberToRoot,
} from './ReactFiberConcurrentUpdates';
import {setIsStrictModeForDevtools} from './ReactFiberDevToolsHook';

import assign from 'shared/assign';
import {
  peekEntangledActionLane,
  peekEntangledActionThenable,
} from './ReactFiberAsyncAction';

/** 类组件/HostRoot 的单条状态更新节点。 */
export type Update<State> = {
  /** 决定本轮是否有资格执行的 Lane；OffscreenLane 可附加隐藏来源。 */
  lane: Lane,

  /** UpdateState、ReplaceState、ForceUpdate 或 CaptureUpdate 标签。 */
  tag: 0 | 1 | 2 | 3,
  /** 状态对象、updater 函数或错误边界派生 payload。 */
  payload: any,
  /** 提交后调用的可选 callback；rebase clone 会清空已执行 callback。 */
  callback: (() => mixed) | null,

  /** 持久化单链表中的下一更新。 */
  next: Update<State> | null,
};

/** current/WIP 共同持有的并发 pending 环形队列与 Transition 元数据。 */
export type SharedQueue<State> = {
  /** 待转移到 base list 的环形队列尾节点。 */
  pending: Update<State> | null,
  /** 与该队列 Transition 更新纠缠的车道并集。 */
  lanes: Lanes,
  /** Offscreen 隐藏期间延迟、待重新可见时调用的 callbacks。 */
  hiddenCallbacks: Array<() => mixed> | null,
};

/** 单个 current 或 work-in-progress Fiber 的可重放更新队列视图。 */
export type UpdateQueue<State> = {
  /** 应用 firstBaseUpdate 前的状态。 */
  baseState: State,
  /** 本视图尚需重放的首个 base update。 */
  firstBaseUpdate: Update<State> | null,
  /** base update 单链表尾节点。 */
  lastBaseUpdate: Update<State> | null,
  /** 与另一棵树共享的并发 pending 队列。 */
  shared: SharedQueue<State>,
  /** 本次 render 已执行、等待 commit 的 callbacks。 */
  callbacks: Array<() => mixed> | null,
};

/** 浅合并 partial state 的常规更新标签。 */
export const UpdateState = 0;
/** 用 payload 整体替换 state 的更新标签。 */
export const ReplaceState = 1;
/** 强制跳过 shouldComponentUpdate 否决的更新标签。 */
export const ForceUpdate = 2;
/** 子树 render 抛错后由错误边界捕获的更新标签。 */
export const CaptureUpdate = 3;

// processUpdateQueue 开始时重置的模块级状态；只能紧随处理后通过
// checkHasForceUpdateAfterProcessing 读取。
let hasForceUpdate = false;

let didWarnUpdateInsideUpdate;
let currentlyProcessingQueue: ?SharedQueue<$FlowFixMe>;
export let resetCurrentlyProcessingQueue: () => void;
if (__DEV__) {
  didWarnUpdateInsideUpdate = false;
  currentlyProcessingQueue = null;
  resetCurrentlyProcessingQueue = () => {
    currentlyProcessingQueue = null;
  };
}

/** 以 Fiber.memoizedState 为 baseState 初始化空 UpdateQueue。 */
export function initializeUpdateQueue<State>(fiber: Fiber): void {
  const queue: UpdateQueue<State> = {
    baseState: fiber.memoizedState,
    firstBaseUpdate: null,
    lastBaseUpdate: null,
    shared: {
      pending: null,
      lanes: NoLanes,
      hiddenCallbacks: null,
    },
    callbacks: null,
  };
  fiber.updateQueue = queue;
}

/**
 * 若 WIP 仍与 current 共用同一个队列对象，则浅克隆队列视图；shared pending 链继续共享，
 * callbacks 清空，维持双缓冲的独立处理指针。
 */
export function cloneUpdateQueue<State>(
  current: Fiber,
  workInProgress: Fiber,
): void {
  // 尚未克隆时从 current 建立 WIP 队列视图。
  const queue: UpdateQueue<State> = workInProgress.updateQueue as any;
  const currentQueue: UpdateQueue<State> = current.updateQueue as any;
  if (queue === currentQueue) {
    const clone: UpdateQueue<State> = {
      baseState: currentQueue.baseState,
      firstBaseUpdate: currentQueue.firstBaseUpdate,
      lastBaseUpdate: currentQueue.lastBaseUpdate,
      shared: currentQueue.shared,
      callbacks: null,
    };
    workInProgress.updateQueue = clone;
  }
}

/** 为指定 Lane 创建默认 UpdateState 节点，payload/callback/next 均为空。 */
export function createUpdate(lane: Lane): Update<mixed> {
  const update: Update<mixed> = {
    lane,

    tag: UpdateState,
    payload: null,
    callback: null,

    next: null,
  };
  return update;
}

/**
 * 把类更新加入队列并返回需调度的 Root。
 * render-phase legacy 更新直接写入 pending 环形链以便本轮立即处理；常规路径委托并发
 * 队列。已卸载 Fiber 返回 null，DEV 会警告 updater 函数内部再次更新的副作用。
 */
export function enqueueUpdate<State>(
  fiber: Fiber,
  update: Update<State>,
  lane: Lane,
): FiberRoot | null {
  const updateQueue = fiber.updateQueue;
  if (updateQueue === null) {
    // 仅已卸载 Fiber 会没有队列。
    return null;
  }

  const sharedQueue: SharedQueue<State> = (updateQueue as any).shared;

  if (__DEV__) {
    if (
      currentlyProcessingQueue === sharedQueue &&
      !didWarnUpdateInsideUpdate
    ) {
      const componentName = getComponentNameFromFiber(fiber);
      console.error(
        'An update (setState, replaceState, or forceUpdate) was scheduled ' +
          'from inside an update function. Update functions should be pure, ' +
          'with zero side-effects. Consider using componentDidUpdate or a ' +
          'callback.\n\nPlease update the following component: %s',
        componentName,
      );
      didWarnUpdateInsideUpdate = true;
    }
  }

  if (isUnsafeClassRenderPhaseUpdate(fiber)) {
    // unsafe render-phase 更新直接进入队列，使本轮 render 立即处理。
    const pending = sharedQueue.pending;
    if (pending === null) {
      // 首条更新自指，建立环形链。
      update.next = update;
    } else {
      update.next = pending.next;
      pending.next = update;
    }
    sharedQueue.pending = update;

    // 即使很可能正渲染该 Fiber，也更新 childLanes；这是兼容 render 阶段更新另一组件的
    // 旧模式（该模式同时会警告）。
    return unsafe_markUpdateLaneFromFiberToRoot(fiber, lane);
  } else {
    return enqueueConcurrentClassUpdate(fiber, sharedQueue, update, lane);
  }
}

/**
 * 把类队列中新 TransitionLane 与同队列仍 pending 的 Transition 车道纠缠到 Root。
 * 先移除已完成车道，再重新 markRootEntangled；宁可保守多纠缠，也不能漏掉需同批完成者。
 */
export function entangleTransitions(root: FiberRoot, fiber: Fiber, lane: Lane) {
  const updateQueue = fiber.updateQueue;
  if (updateQueue === null) {
    // 仅已卸载 Fiber 会没有队列。
    return;
  }

  const sharedQueue: SharedQueue<mixed> = (updateQueue as any).shared;
  if (isTransitionLane(lane)) {
    let queueLanes = sharedQueue.lanes;

    // Root 已不 pending 的纠缠车道必已完成，可从 shared queue 超集中移除。保守多纠缠可接受，
    // 漏纠缠则会破坏 Transition 原子性。
    queueLanes = intersectLanes(queueLanes, root.pendingLanes);

    // 将新 TransitionLane 与队列其余 Transition 车道纠缠。
    const newQueueLanes = mergeLanes(queueLanes, lane);
    sharedQueue.lanes = newQueueLanes;
    // 即使 queue.lanes 已含 lane，也无法确认上次纠缠后它是否完成过，故再次登记。
    markRootEntangled(root, newQueueLanes);
  }
}

/**
 * 仅向 WIP 队列追加子树 render 抛出的 captured update。
 * 若 WIP 尚与 current 共用队列，先克隆 base list 并清空 clone callback，保证中止本轮时
 * captured update 随 WIP 丢弃，且已执行 callback 不因 rebase 重复触发。
 */
export function enqueueCapturedUpdate<State>(
  workInProgress: Fiber,
  capturedUpdate: Update<State>,
) {
  // captured update 来自 child render 抛错；本轮中止时应丢弃，因此只写 WIP，不写 current。
  let queue: UpdateQueue<State> = workInProgress.updateQueue as any;

  // 检查 WIP 队列是否已有独立 clone。
  const current = workInProgress.alternate;
  if (current !== null) {
    const currentQueue: UpdateQueue<State> = current.updateQueue as any;
    if (queue === currentQueue) {
      // 父 Fiber bailout 后又捕获 child 错误时，WIP 仍等于 current。通常在 processUpdateQueue
      // 克隆，但父级被跳过；为只写 WIP，此处补做 base list clone。
      let newFirst = null;
      let newLast = null;
      const firstBaseUpdate = queue.firstBaseUpdate;
      if (firstBaseUpdate !== null) {
        // 遍历并克隆 base updates。
        let update: Update<State> = firstBaseUpdate;
        do {
          const clone: Update<State> = {
            lane: update.lane,

            tag: update.tag,
            payload: update.payload,
            // rebase 时不得再次触发已执行 callback。
            callback: null,

            next: null,
          };
          if (newLast === null) {
            newFirst = newLast = clone;
          } else {
            newLast.next = clone;
            newLast = clone;
          }
          // $FlowFixMe[incompatible-type] we bail out when we get a null
          update = update.next;
        } while (update !== null);

        // 把 captured update 追加到克隆链尾。
        // $FlowFixMe[invalid-compare]
        if (newLast === null) {
          newFirst = newLast = capturedUpdate;
        } else {
          newLast.next = capturedUpdate;
          newLast = capturedUpdate;
        }
      } else {
        // 没有 base update，captured update 同时成为首尾。
        newFirst = newLast = capturedUpdate;
      }
      queue = {
        baseState: currentQueue.baseState,
        firstBaseUpdate: newFirst,
        lastBaseUpdate: newLast,
        shared: currentQueue.shared,
        callbacks: currentQueue.callbacks,
      };
      workInProgress.updateQueue = queue;
      return;
    }
  }

  // WIP 已独立，直接追加到 base list 尾部。
  const lastBaseUpdate = queue.lastBaseUpdate;
  if (lastBaseUpdate === null) {
    queue.firstBaseUpdate = capturedUpdate;
  } else {
    lastBaseUpdate.next = capturedUpdate;
  }
  queue.lastBaseUpdate = capturedUpdate;
}

/**
 * 把单条 Update 应用到 prevState。
 * ReplaceState 整体替换；Update/Capture 浅合并 partial state；ForceUpdate 只置模块标记。
 * updater 函数在 StrictLegacyMode DEV 中重复调用以探测副作用，并禁止其中读取 Context。
 */
function getStateFromUpdate<State>(
  workInProgress: Fiber,
  queue: UpdateQueue<State>,
  update: Update<State>,
  prevState: State,
  nextProps: any,
  instance: any,
): any {
  switch (update.tag) {
    case ReplaceState: {
      const payload = update.payload;
      if (typeof payload === 'function') {
        // 整状态 updater 函数。
        if (__DEV__) {
          enterDisallowedContextReadInDEV();
        }
        const nextState = payload.call(instance, prevState, nextProps);
        if (__DEV__) {
          if (workInProgress.mode & StrictLegacyMode) {
            setIsStrictModeForDevtools(true);
            try {
              payload.call(instance, prevState, nextProps);
            } finally {
              setIsStrictModeForDevtools(false);
            }
          }
          exitDisallowedContextReadInDEV();
        }
        return nextState;
      }
      // 整状态对象。
      return payload;
    }
    case CaptureUpdate: {
      workInProgress.flags =
        (workInProgress.flags & ~ShouldCapture) | DidCapture;
    }
    // 刻意继续走 UpdateState 合并逻辑。
    case UpdateState: {
      const payload = update.payload;
      let partialState;
      if (typeof payload === 'function') {
        // partial-state updater 函数。
        if (__DEV__) {
          enterDisallowedContextReadInDEV();
        }
        partialState = payload.call(instance, prevState, nextProps);
        if (__DEV__) {
          if (workInProgress.mode & StrictLegacyMode) {
            setIsStrictModeForDevtools(true);
            try {
              payload.call(instance, prevState, nextProps);
            } finally {
              setIsStrictModeForDevtools(false);
            }
          }
          exitDisallowedContextReadInDEV();
        }
      } else {
        // partial state 对象。
        partialState = payload;
      }
      if (partialState === null || partialState === undefined) {
        // null/undefined 视为 no-op。
        return prevState;
      }
      // 将 partial state 与旧状态浅合并。
      return assign({}, prevState, partialState);
    }
    case ForceUpdate: {
      hasForceUpdate = true;
      return prevState;
    }
  }
  return prevState;
}

let didReadFromEntangledAsyncAction: boolean = false;

/**
 * 若 processUpdateQueue 读取了 pending async action 的纠缠更新，则抛其 Thenable 挂起，
 * 将本次更新与 action 后续更新同批提交。此检查独立成函数，是因为 updateHostRoot 必须先
 * 压入全部 Context 栈，避免挂起展开时栈不匹配。
 */
export function suspendIfUpdateReadFromEntangledAsyncAction() {
  // TODO：支持 useMemo/Forget 等记忆边界内 Hook 后，将检查上移，仅在边界产生新值时挂起。
  if (didReadFromEntangledAsyncAction) {
    const entangledActionThenable = peekEntangledActionThenable();
    if (entangledActionThenable !== null) {
      // TODO：像 use 一样抛特殊对象而非直接抛 Thenable，以识别是否被用户代码捕获。
      throw entangledActionThenable;
    }
  }
}

/**
 * 按 renderLanes 重放类组件/HostRoot UpdateQueue，计算 memoizedState 与剩余 base queue。
 *
 * 先把 shared.pending 环形链拆开并同时追加到 current/WIP；优先级不足的首项定义新
 * baseState，之后所有更新都 clone 以支持确定性 rebase。已执行 callback 留到 commit，
 * 隐藏更新另打 Visibility；纠缠 async action 则记录供后续挂起。
 */
export function processUpdateQueue<State>(
  workInProgress: Fiber,
  props: any,
  instance: any,
  renderLanes: Lanes,
): void {
  didReadFromEntangledAsyncAction = false;

  // ClassComponent/HostRoot 的队列始终非空。
  const queue: UpdateQueue<State> = workInProgress.updateQueue as any;

  hasForceUpdate = false;

  if (__DEV__) {
    currentlyProcessingQueue = queue.shared;
  }

  let firstBaseUpdate = queue.firstBaseUpdate;
  let lastBaseUpdate = queue.lastBaseUpdate;

  // 把 shared.pending 新更新转移到 base queue。
  let pendingQueue = queue.shared.pending;
  if (pendingQueue !== null) {
    queue.shared.pending = null;

    // pending 是环形链，断开首尾把它变为普通单链表。
    const lastPendingUpdate = pendingQueue;
    const firstPendingUpdate = lastPendingUpdate.next;
    lastPendingUpdate.next = null;
    // 追加 pending updates 到 base queue。
    if (lastBaseUpdate === null) {
      firstBaseUpdate = firstPendingUpdate;
    } else {
      lastBaseUpdate.next = firstPendingUpdate;
    }
    lastBaseUpdate = lastPendingUpdate;

    // current 若有独立 base queue，也要追加同一单链表；无环结构允许两边共享后缀。
    // TODO：把 current 作为显式参数传入。
    const current = workInProgress.alternate;
    if (current !== null) {
      // ClassComponent/HostRoot 的队列始终非空。
      const currentQueue: UpdateQueue<State> = current.updateQueue as any;
      const currentLastBaseUpdate = currentQueue.lastBaseUpdate;
      if (currentLastBaseUpdate !== lastBaseUpdate) {
        if (currentLastBaseUpdate === null) {
          currentQueue.firstBaseUpdate = firstPendingUpdate;
        } else {
          currentLastBaseUpdate.next = firstPendingUpdate;
        }
        currentQueue.lastBaseUpdate = lastPendingUpdate;
      }
    }
  }

  // 下列 base 指针会随重放结果更新。
  if (firstBaseUpdate !== null) {
    // 遍历更新链计算新状态。
    let newState = queue.baseState;
    // TODO：无需重新累计，可从原 lanes 中移除 renderLanes 得到剩余项。
    let newLanes: Lanes = NoLanes;

    let newBaseState = null;
    let newFirstBaseUpdate = null;
    let newLastBaseUpdate: null | Update<State> = null;

    let update: Update<State> = firstBaseUpdate;
    do {
      // 隐藏树内产生的更新额外附加 OffscreenLane，以区别隐藏前已存在的更新。
      const updateLane = removeLanes(update.lane, OffscreenLane);
      const isHiddenUpdate = updateLane !== update.lane;

      // 隐藏期间产生的更新不是 base update，判断资格时忽略进入 Offscreen 树时额外加入
      // renderLanes 的 base lanes，改看 Root 本轮真实车道。
      const shouldSkipUpdate = isHiddenUpdate
        ? !isSubsetOfLanes(getWorkInProgressRootRenderLanes(), updateLane)
        : !isSubsetOfLanes(renderLanes, updateLane);

      if (shouldSkipUpdate) {
        // 优先级不足。首个跳过项把当前 newState 固定为新 baseState，并保留此后更新供 rebase。
        const clone: Update<State> = {
          lane: updateLane,

          tag: update.tag,
          payload: update.payload,
          callback: update.callback,

          next: null,
        };
        if (newLastBaseUpdate === null) {
          newFirstBaseUpdate = newLastBaseUpdate = clone;
          newBaseState = newState;
        } else {
          newLastBaseUpdate = newLastBaseUpdate.next = clone;
        }
        // 累计队列剩余优先级。
        newLanes = mergeLanes(newLanes, updateLane);
      } else {
        // 当前更新优先级足够。

        // 纠缠 pending async action 的更新需在处理后挂起，等待 action 后续更新同批。
        if (updateLane !== NoLane && updateLane === peekEntangledActionLane()) {
          didReadFromEntangledAsyncAction = true;
        }

        if (newLastBaseUpdate !== null) {
          const clone: Update<State> = {
            // 此更新将提交，rebase 时不能“取消提交”。clone 使用 NoLane；0 是所有位掩码
            // 子集，所以上述资格检查永远不会跳过它。
            lane: NoLane,

            tag: update.tag,
            payload: update.payload,

            // rebase 时不得再次触发已执行 callback。
            callback: null,

            next: null,
          };
          newLastBaseUpdate = newLastBaseUpdate.next = clone;
        }

        // 应用当前更新。
        newState = getStateFromUpdate(
          workInProgress,
          queue,
          update,
          newState,
          props,
          instance,
        );
        const callback = update.callback;
        if (callback !== null) {
          workInProgress.flags |= Callback;
          if (isHiddenUpdate) {
            workInProgress.flags |= Visibility;
          }
          const callbacks = queue.callbacks;
          if (callbacks === null) {
            queue.callbacks = [callback];
          } else {
            callbacks.push(callback);
          }
        }
      }
      // $FlowFixMe[incompatible-type] we bail out when we get a null
      update = update.next;
      if (update === null) {
        pendingQueue = queue.shared.pending;
        if (pendingQueue === null) {
          break;
        } else {
          // reducer/updater 内又调度更新：把新 pending 链接到末尾并继续处理。
          const lastPendingUpdate = pendingQueue;
          // 刻意放宽类型：pending 是环形链，但转入 base queue 时会拆环。
          const firstPendingUpdate =
            lastPendingUpdate.next as any as Update<State>;
          lastPendingUpdate.next = null;
          update = firstPendingUpdate;
          queue.lastBaseUpdate = lastPendingUpdate;
          queue.shared.pending = null;
        }
      }
    } while (true);

    if (newLastBaseUpdate === null) {
      newBaseState = newState;
    }

    queue.baseState = newBaseState as any as State;
    queue.firstBaseUpdate = newFirstBaseUpdate;
    queue.lastBaseUpdate = newLastBaseUpdate;

    // $FlowFixMe[invalid-compare]
    if (firstBaseUpdate === null) {
      // queue.lanes 只用于纠缠 Transition；队列清空后可归零。
      queue.shared.lanes = NoLanes;
    }

    // Fiber 剩余 lanes 取队列剩余优先级。另两种影响来源是 props 与 Context；处理队列时已
    // 处在 begin 中段，props 已处理。带 shouldComponentUpdate 的 Context 变化需由外层另算。
    markSkippedUpdateLanes(newLanes);
    workInProgress.lanes = newLanes;
    workInProgress.memoizedState = newState;
  }

  if (__DEV__) {
    currentlyProcessingQueue = null;
  }
}

/** 校验并以指定实例作为 this 调用 Update callback。 */
function callCallback(callback: () => mixed, context: any) {
  if (typeof callback !== 'function') {
    throw new Error(
      'Invalid argument passed as callback. Expected a function. Instead ' +
        `received: ${callback}`,
    );
  }

  callback.call(context);
}

/** 重放队列前清除模块级 ForceUpdate 命中标记。 */
export function resetHasForceUpdateBeforeProcessing() {
  hasForceUpdate = false;
}

/** 返回最近一次 processUpdateQueue 是否执行过 ForceUpdate。 */
export function checkHasForceUpdateAfterProcessing(): boolean {
  return hasForceUpdate;
}

/**
 * Offscreen 隐藏组件完成更新时，把本次 callbacks 转存到 shared.hiddenCallbacks，延迟到
 * 组件重新可见后再调用。
 */
export function deferHiddenCallbacks<State>(
  updateQueue: UpdateQueue<State>,
): void {
  // 隐藏组件的 callback 不得立即触发，保存到 shared queue 供重新可见时使用。
  const newHiddenCallbacks = updateQueue.callbacks;
  if (newHiddenCallbacks !== null) {
    const existingHiddenCallbacks = updateQueue.shared.hiddenCallbacks;
    if (existingHiddenCallbacks === null) {
      updateQueue.shared.hiddenCallbacks = newHiddenCallbacks;
    } else {
      updateQueue.shared.hiddenCallbacks =
        existingHiddenCallbacks.concat(newHiddenCallbacks);
    }
  }
}

/** 隐藏组件切换为可见时冲刷并清空此前延迟的 callbacks。 */
export function commitHiddenCallbacks<State>(
  updateQueue: UpdateQueue<State>,
  context: any,
): void {
  // 组件正从 hidden 切为 visible，提交此前延迟的 callbacks。
  const hiddenCallbacks = updateQueue.shared.hiddenCallbacks;
  if (hiddenCallbacks !== null) {
    updateQueue.shared.hiddenCallbacks = null;
    for (let i = 0; i < hiddenCallbacks.length; i++) {
      const callback = hiddenCallbacks[i];
      callCallback(callback, context);
    }
  }
}

/** 提交并清空本轮 UpdateQueue.callbacks，每项以组件/Root 公开实例为 this。 */
export function commitCallbacks<State>(
  updateQueue: UpdateQueue<State>,
  context: any,
): void {
  const callbacks = updateQueue.callbacks;
  if (callbacks !== null) {
    updateQueue.callbacks = null;
    for (let i = 0; i < callbacks.length; i++) {
      const callback = callbacks[i];
      callCallback(callback, context);
    }
  }
}
