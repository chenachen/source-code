/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  TransitionTracingCallbacks,
  Fiber,
  FiberRoot,
} from './ReactInternalTypes';
import type {Transition} from 'react/src/ReactStartTransition';
import type {OffscreenInstance} from './ReactFiberOffscreenComponent';
import type {StackCursor} from './ReactFiberStack';

import {enableTransitionTracing} from 'shared/ReactFeatureFlags';
import {createCursor, push, pop} from './ReactFiberStack';
import {getWorkInProgressTransitions} from './ReactFiberWorkLoop';

/** 暴露给 Transition tracing callback 的待完成 Suspense 边界摘要。 */
export type SuspenseInfo = {
  /** Suspense/Offscreen 边界的可选业务名称。 */
  name: string | null
};

/** 提交阶段累积、等待统一调用用户 Transition tracing callbacks 的事件批次。 */
export type PendingTransitionCallbacks = {
  /** 本次开始的 Transition。 */
  transitionStart: Array<Transition> | null,
  /** Transition 到尚未完成边界集合的进度快照。 */
  transitionProgress: Map<Transition, PendingBoundaries> | null,
  /** 本次已完成的 Transition。 */
  transitionComplete: Array<Transition> | null,
  /** Marker 名称到当前边界/Transition 集合的进度快照。 */
  markerProgress: Map<
    string,
    {
      /** 阻止 Marker 完成的边界。 */
      pendingBoundaries: PendingBoundaries,
      /** 观察该 Marker 的 Transition。 */
      transitions: Set<Transition>
    },
  > | null,
  /** Marker 名称到中止原因/Transition 集合的未完成事件。 */
  markerIncomplete: Map<
    string,
    {
      /** 造成 Marker 无法完成的中止记录。 */
      aborts: Array<TransitionAbort>,
      /** 受这些中止影响的 Transition。 */
      transitions: Set<Transition>
    },
  > | null,
  /** Marker 名称到已完成 Transition 集合的事件。 */
  markerComplete: Map<string, Set<Transition>> | null,
};

/**
 * 渲染期间压入栈的 Transition Root/Marker 运行时状态。
 * TODO：评估是否可从此结构移除 tag 或 name，进一步收窄状态形状。
 */
export type TracingMarkerInstance = {
  /** 区分 Root 隐式 Marker 与显式 TracingMarker。 */
  tag?: TracingMarkerTag,
  /** 当前 Marker 参与的 Transition；null 表示尚未关联。 */
  transitions: Set<Transition> | null,
  /** 必须全部解除挂起后 Marker 才能完成的边界。 */
  pendingBoundaries: PendingBoundaries | null,
  /** 导致 Marker 无法正常完成的原因。 */
  aborts: Array<TransitionAbort> | null,
  /** 显式 Marker 名称；Root 隐式 Marker 为 null。 */
  name: string | null,
};

/** Transition/Marker 未完成的内部原因；可选 name 指向相关 Marker 或 Suspense。 */
export type TransitionAbort = {
  /** 中止来源类别。 */
  reason: 'error' | 'unknown' | 'marker' | 'suspense',
  /** 与 marker/suspense 原因关联的可选名称。 */
  name?: string | null,
};

/** Root 为每个 Transition 建立的隐式 Marker 标签。 */
export const TransitionRoot = 0;
/** 用户显式 TracingMarker 的标签。 */
export const TransitionTracingMarker = 1;
/** TracingMarkerInstance.tag 的封闭数字联合。 */
export type TracingMarkerTag = 0 | 1;

/** Offscreen/Suspense 实例到 callback 可见摘要的待完成边界映射。 */
export type PendingBoundaries = Map<OffscreenInstance, SuspenseInfo>;

/**
 * 按开始、Marker 进度/完成/中止、Transition 进度/完成的顺序冲刷 tracing callback 批次。
 * 只向用户暴露命名 Transition，并在统一 endTime 下把内部 Map 转成不可依赖身份的数组。
 */
export function processTransitionCallbacks(
  pendingTransitions: PendingTransitionCallbacks,
  endTime: number,
  callbacks: TransitionTracingCallbacks,
): void {
  if (enableTransitionTracing) {
    // $FlowFixMe[invalid-compare]
    if (pendingTransitions !== null) {
      const transitionStart = pendingTransitions.transitionStart;
      const onTransitionStart = callbacks.onTransitionStart;
      if (transitionStart !== null && onTransitionStart != null) {
        transitionStart.forEach(transition => {
          if (transition.name != null) {
            onTransitionStart(transition.name, transition.startTime);
          }
        });
      }

      const markerProgress = pendingTransitions.markerProgress;
      const onMarkerProgress = callbacks.onMarkerProgress;
      if (onMarkerProgress != null && markerProgress !== null) {
        markerProgress.forEach((markerInstance, markerName) => {
          // $FlowFixMe[invalid-compare]
          if (markerInstance.transitions !== null) {
            // TODO：克隆 Suspense 摘要，避免用户修改内部对象。
            const pending =
              // $FlowFixMe[invalid-compare]
              markerInstance.pendingBoundaries !== null
                ? Array.from(markerInstance.pendingBoundaries.values())
                : [];
            markerInstance.transitions.forEach(transition => {
              if (transition.name != null) {
                onMarkerProgress(
                  transition.name,
                  markerName,
                  transition.startTime,
                  endTime,
                  pending,
                );
              }
            });
          }
        });
      }

      const markerComplete = pendingTransitions.markerComplete;
      const onMarkerComplete = callbacks.onMarkerComplete;
      if (markerComplete !== null && onMarkerComplete != null) {
        markerComplete.forEach((transitions, markerName) => {
          transitions.forEach(transition => {
            if (transition.name != null) {
              onMarkerComplete(
                transition.name,
                markerName,
                transition.startTime,
                endTime,
              );
            }
          });
        });
      }

      const markerIncomplete = pendingTransitions.markerIncomplete;
      const onMarkerIncomplete = callbacks.onMarkerIncomplete;
      if (onMarkerIncomplete != null && markerIncomplete !== null) {
        markerIncomplete.forEach(({transitions, aborts}, markerName) => {
          transitions.forEach(transition => {
            const filteredAborts = [];
            aborts.forEach(abort => {
              switch (abort.reason) {
                case 'marker': {
                  filteredAborts.push({
                    type: 'marker',
                    name: abort.name,
                    endTime,
                  });
                  break;
                }
                case 'suspense': {
                  filteredAborts.push({
                    type: 'suspense',
                    name: abort.name,
                    endTime,
                  });
                  break;
                }
                default: {
                  break;
                }
              }
            });

            if (filteredAborts.length > 0) {
              if (transition.name != null) {
                onMarkerIncomplete(
                  transition.name,
                  markerName,
                  transition.startTime,
                  filteredAborts,
                );
              }
            }
          });
        });
      }

      const transitionProgress = pendingTransitions.transitionProgress;
      const onTransitionProgress = callbacks.onTransitionProgress;
      if (onTransitionProgress != null && transitionProgress !== null) {
        transitionProgress.forEach((pending, transition) => {
          if (transition.name != null) {
            onTransitionProgress(
              transition.name,
              transition.startTime,
              endTime,
              Array.from(pending.values()),
            );
          }
        });
      }

      const transitionComplete = pendingTransitions.transitionComplete;
      const onTransitionComplete = callbacks.onTransitionComplete;
      if (transitionComplete !== null && onTransitionComplete != null) {
        transitionComplete.forEach(transition => {
          if (transition.name != null) {
            onTransitionComplete(
              transition.name,
              transition.startTime,
              endTime,
            );
          }
        });
      }
    }
  }
}

// 保存当前祖先链的所有 Marker 指针，完成阶段据此查询仍需解除挂起的边界。该栈与
// ReactFiberTransition 分离，因为压栈/弹栈边界是 TracingMarker，而非 Suspense。
const markerInstanceStack: StackCursor<Array<TracingMarkerInstance> | null> =
  createCursor(null);

/**
 * 为 Root 当前涉及的每个 Transition 建立/复用隐式 Marker，并把全部未完成 Marker 压栈。
 * 每个 Transition 独立跟踪其 PendingBoundaries，因此可在不同时间完成。
 */
export function pushRootMarkerInstance(workInProgress: Fiber): void {
  if (enableTransitionTracing) {
    // Root 为每个 Transition 保存独立 Suspense 边界映射；映射清空即完成。不同 Transition
    // 的依赖与完成时刻不同，所以 incompleteTransitions 每项都像一个隐式 Marker 入栈。
    const transitions = getWorkInProgressTransitions();
    const root: FiberRoot = workInProgress.stateNode;

    if (transitions !== null) {
      transitions.forEach(transition => {
        if (!root.incompleteTransitions.has(transition)) {
          const markerInstance: TracingMarkerInstance = {
            tag: TransitionRoot,
            transitions: new Set([transition]),
            pendingBoundaries: null,
            aborts: null,
            name: null,
          };
          root.incompleteTransitions.set(transition, markerInstance);
        }
      });
    }

    const markerInstances = [];
    // 把每个未完成 Transition 及其 pending boundary 映射一并压入 Marker 栈。
    root.incompleteTransitions.forEach(markerInstance => {
      markerInstances.push(markerInstance);
    });
    push(markerInstanceStack, markerInstances, workInProgress);
  }
}

/** 完成 Root 子树后弹出与 pushRootMarkerInstance 对应的隐式 Marker 帧。 */
export function popRootMarkerInstance(workInProgress: Fiber) {
  if (enableTransitionTracing) {
    pop(markerInstanceStack, workInProgress);
  }
}

/**
 * 进入显式 TracingMarker 时，把实例追加到祖先 Marker 数组并压入新栈帧。
 * 后代 Suspense 可同时登记到当前 Marker 及其所有祖先 Marker。
 */
export function pushMarkerInstance(
  workInProgress: Fiber,
  markerInstance: TracingMarkerInstance,
): void {
  if (enableTransitionTracing) {
    if (markerInstanceStack.current === null) {
      push(markerInstanceStack, [markerInstance], workInProgress);
    } else {
      push(
        markerInstanceStack,
        markerInstanceStack.current.concat(markerInstance),
        workInProgress,
      );
    }
  }
}

/** 离开显式 TracingMarker 时弹出对应栈帧。 */
export function popMarkerInstance(workInProgress: Fiber): void {
  if (enableTransitionTracing) {
    pop(markerInstanceStack, workInProgress);
  }
}

/** 返回当前祖先链的 TracingMarker 实例；功能关闭时稳定返回 null。 */
export function getMarkerInstances(): Array<TracingMarkerInstance> | null {
  if (enableTransitionTracing) {
    return markerInstanceStack.current;
  }
  return null;
}
