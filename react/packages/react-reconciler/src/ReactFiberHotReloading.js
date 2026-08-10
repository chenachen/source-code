/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/* eslint-disable react-internal/prod-error-codes */

import type {ReactElement} from 'shared/ReactElementType';
import type {Fiber, FiberRoot} from './ReactInternalTypes';
import type {ReactNodeList} from 'shared/ReactTypes';

import {
  flushSyncWork,
  scheduleUpdateOnFiber,
  flushPendingEffects,
} from './ReactFiberWorkLoop';
import {enqueueConcurrentRenderForLane} from './ReactFiberConcurrentUpdates';
import {updateContainerSync} from './ReactFiberReconciler';
import {emptyContextObject} from './ReactFiberLegacyContext';
import {SyncLane} from './ReactFiberLane';
import {
  ClassComponent,
  FunctionComponent,
  ForwardRef,
  MemoComponent,
  SimpleMemoComponent,
} from './ReactWorkTags';
import {
  REACT_FORWARD_REF_TYPE,
  REACT_MEMO_TYPE,
  REACT_LAZY_TYPE,
} from 'shared/ReactSymbols';

/** React Refresh 把不同编辑版本组件关联起来的稳定族。 */
export type Family = {
  /** 该族当前最新的组件类型实现。 */
  current: any,
};

/** 一次 Refresh 中必须重挂载与可保留状态重渲染的组件族集合。 */
export type RefreshUpdate = {
  /** 签名不兼容或类型形态改变，必须丢弃旧状态并重挂载的族。 */
  staleFamilies: Set<Family>,
  /** 实现已更新但可保留 Hook 状态并重渲染的族。 */
  updatedFamilies: Set<Family>,
};

/** 把任意组件类型解析到 React Refresh 的稳定族。 */
type RefreshHandler = any => Family | void;

/** DevTools Global Hook 供 React Refresh runtime 安装族解析器的入口。 */
export type SetRefreshHandler = (handler: RefreshHandler | null) => void;
/** 在指定根应用一批族更新的 React Refresh 调度入口。 */
export type ScheduleRefresh = (root: FiberRoot, update: RefreshUpdate) => void;
/** 用新元素同步刷新整个根的 React Refresh 兼容入口。 */
export type ScheduleRoot = (root: FiberRoot, element: ReactNodeList) => void;

let resolveFamily: RefreshHandler | null = null;
let failedBoundaries: WeakSet<Fiber> | null = null;

/** 安装或移除开发期组件类型到 Refresh Family 的解析器。 */
export const setRefreshHandler = (handler: RefreshHandler | null): void => {
  if (__DEV__) {
    resolveFamily = handler;
  }
};

/** 返回组件类型所属 Family 的最新实现；Refresh 未启用或未登记时原样返回。 */
export function resolveTypeForHotReloading(type: any): any {
  if (__DEV__) {
    if (resolveFamily === null) {
      // Hot Reloading 未启用。
      return type;
    }
    const family = resolveFamily(type);
    if (family === undefined) {
      return type;
    }
    // 使用该族已知的最新实现。
    return family.current;
  } else {
    return type;
  }
}

/**
 * 判断现有 Fiber 与新 ReactElement 是否属于可保留状态的同一 Refresh Family。
 *
 * 只比较类、函数、ForwardRef、Memo 及其 lazy 包装；wrapper 按外层类型比较，避免
 * 两次独立 `memo(Foo)` 因共享内部 Foo 而被错误视为同一实例。
 */
export function isCompatibleFamilyForHotReloading(
  fiber: Fiber,
  element: ReactElement,
): boolean {
  if (__DEV__) {
    if (resolveFamily === null) {
      // Hot Reloading 未启用。
      return false;
    }
    const resolve = resolveFamily;

    const prevType = fiber.elementType;
    const nextType = element.type;

    // 进入这里时已知新旧类型不满足 ===。
    let needsCompareFamilies = false;

    const $$typeofNextType =
      typeof nextType === 'object' && nextType !== null
        ? nextType.$$typeof
        : null;

    switch (fiber.tag) {
      case ClassComponent: {
        if (typeof nextType === 'function') {
          needsCompareFamilies = true;
        }
        break;
      }
      case FunctionComponent: {
        if (typeof nextType === 'function') {
          needsCompareFamilies = true;
        } else if ($$typeofNextType === REACT_LAZY_TYPE) {
          // lazy 内部类型尚未知；假定它稳定，仅避免协调阶段删掉旧 Fiber，不解包也不
          // 真正使用新的 lazy 类型。
          needsCompareFamilies = true;
        }
        break;
      }
      case ForwardRef: {
        if ($$typeofNextType === REACT_FORWARD_REF_TYPE) {
          needsCompareFamilies = true;
        } else if ($$typeofNextType === REACT_LAZY_TYPE) {
          needsCompareFamilies = true;
        }
        break;
      }
      case MemoComponent:
      case SimpleMemoComponent: {
        if ($$typeofNextType === REACT_MEMO_TYPE) {
          needsCompareFamilies = true;
        } else if ($$typeofNextType === REACT_LAZY_TYPE) {
          needsCompareFamilies = true;
        }
        break;
      }
      default:
        return false;
    }

    // 检查新旧类型是否都解析到同一个 Family。
    if (needsCompareFamilies) {
      // memo/forwardRef 比较外层而非内部类型，所以 wrapper 自身也必须登记才能保留状态。
      // 若解包比较，两个独立 memo(Foo) 会因同包裹 Foo 被误判为等价。
      const prevFamily = resolve(prevType);
      if (prevFamily !== undefined && prevFamily === resolve(nextType)) {
        return true;
      }
    }
    return false;
  } else {
    return false;
  }
}

/** 把本轮抛错的 Error Boundary 记为 Refresh 时必须重挂载，避免复用故障状态。 */
export function markFailedErrorBoundaryForHotReloading(fiber: Fiber) {
  if (__DEV__) {
    if (resolveFamily === null) {
      // Hot Reloading 未启用。
      return;
    }
    if (typeof WeakSet !== 'function') {
      return;
    }
    if (failedBoundaries === null) {
      failedBoundaries = new WeakSet();
    }
    failedBoundaries.add(fiber);
  }
}

/**
 * 同步应用一批 React Refresh 族更新。
 * 先提交待处理 Effects，再遍历根标记重渲染/重挂载，最后 flush 同步工作。
 */
export const scheduleRefresh: ScheduleRefresh = (
  root: FiberRoot,
  update: RefreshUpdate,
): void => {
  if (__DEV__) {
    if (resolveFamily === null) {
      // Hot Reloading 未启用。
      return;
    }
    const {staleFamilies, updatedFamilies} = update;
    flushPendingEffects();
    scheduleFibersWithFamiliesRecursively(
      root.current,
      updatedFamilies,
      staleFamilies,
    );
    flushSyncWork();
  }
};

/**
 * 用新元素同步刷新一个没有遗留 `_renderSubtree` Context 的根。
 * 无法重建父组件提供的遗留 Context 时安全忽略，待旧入口删除后可移除此特例。
 */
export const scheduleRoot: ScheduleRoot = (
  root: FiberRoot,
  element: ReactNodeList,
): void => {
  if (__DEV__) {
    if (root.context !== emptyContextObject) {
      // 极端情况：根带遗留 _renderSubtree Context，却不知道 parentComponent，无法传递；
      // 先忽略，删除 _renderSubtree 路径时一并移除。
      return;
    }
    updateContainerSync(element, root, null, null);
    flushSyncWork();
  }
};

/**
 * 深度优先遍历 Fiber 树，把受 RefreshUpdate 影响的节点安排到 SyncLane。
 *
 * stale Family、类组件更新、失败边界或 wrapper 形态变化会重挂载；兼容的函数族只
 * 重渲染并保留状态。某节点需重挂载时不再深入旧 children。
 */
function scheduleFibersWithFamiliesRecursively(
  fiber: Fiber,
  updatedFamilies: Set<Family>,
  staleFamilies: Set<Family>,
): void {
  if (__DEV__) {
    do {
      const {alternate, child, sibling, tag, type, elementType} = fiber;

      let candidateType = null;
      // memo/forwardRef 等 wrapper 通常通过内部实现解析 Family，但把 memo 改成普通
      // 函数等类型形态变化只记在外层 Family，故还要检查 outer type 以触发重挂载。
      let outerCandidateType = null;
      switch (tag) {
        case FunctionComponent:
        case ClassComponent:
          candidateType = type;
          break;
        case SimpleMemoComponent:
          candidateType = type;
          outerCandidateType = elementType;
          break;
        case MemoComponent:
          // 内部实现的编辑由 inner Fiber 处理。
          outerCandidateType = elementType;
          break;
        case ForwardRef:
          candidateType = type.render;
          outerCandidateType = elementType;
          break;
        default:
          break;
      }

      if (resolveFamily === null) {
        throw new Error('Expected resolveFamily to be set during hot reload.');
      }
      const resolve = resolveFamily;

      let needsRender = false;
      let needsRemount = false;
      if (candidateType !== null) {
        const family = resolve(candidateType);
        if (family !== undefined) {
          if (staleFamilies.has(family)) {
            needsRemount = true;
          } else if (updatedFamilies.has(family)) {
            if (tag === ClassComponent) {
              needsRemount = true;
            } else {
              needsRender = true;
            }
          }
        }
      }
      if (!needsRemount && outerCandidateType !== null) {
        const outerFamily = resolve(outerCandidateType);
        if (outerFamily !== undefined && staleFamilies.has(outerFamily)) {
          needsRemount = true;
        } else if (
          typeof outerCandidateType === 'object' &&
          outerCandidateType.$$typeof === REACT_LAZY_TYPE
        ) {
          const payload = outerCandidateType._payload;
          if (payload._status === 1 /* 已解决；参见 ReactLazy */) {
            const middleFamily = resolve(payload._result.default);
            if (middleFamily !== undefined && staleFamilies.has(middleFamily)) {
              needsRemount = true;
            }
          }
        }
      }
      if (failedBoundaries !== null) {
        if (
          failedBoundaries.has(fiber) ||
          // $FlowFixMe[incompatible-use] found when upgrading Flow
          (alternate !== null && failedBoundaries.has(alternate))
        ) {
          needsRemount = true;
        }
      }

      if (needsRemount) {
        fiber._debugNeedsRemount = true;
      }
      if (needsRemount || needsRender) {
        const root = enqueueConcurrentRenderForLane(fiber, SyncLane);
        if (root !== null) {
          scheduleUpdateOnFiber(root, fiber, SyncLane);
        }
      }
      if (child !== null && !needsRemount) {
        scheduleFibersWithFamiliesRecursively(
          child,
          updatedFamilies,
          staleFamilies,
        );
      }

      if (sibling === null) {
        break;
      }
      fiber = sibling;
    } while (true);
  }
}
