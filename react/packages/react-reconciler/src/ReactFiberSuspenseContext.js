/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {SuspenseProps} from 'shared/ReactTypes';
import type {Fiber} from './ReactInternalTypes';
import type {StackCursor} from './ReactFiberStack';
import type {SuspenseState} from './ReactFiberSuspenseComponent';

import {enableSuspenseAvoidThisFallback} from 'shared/ReactFeatureFlags';
import {createCursor, push, pop} from './ReactFiberStack';
import {isCurrentTreeHidden} from './ReactFiberHiddenContext';
import {OffscreenComponent} from './ReactWorkTags';

/** 当前应接住挂起的 Suspense 边界，相当于栈上最近的 `catch`。 */
const suspenseHandlerStackCursor: StackCursor<Fiber | null> =
  createCursor(null);

// 当前树中尚不可见的最外层边界；它以上属于应用 shell。null 表示正渲染 shell，
// 非 null 表示已经深入当前 UI 尚不可见的新树。
//
// 该边界用于判断 fallback 是否理想：在 shell 中激活 fallback 会隐藏当前仍可见但
// 可能陈旧的内容，应优先继续显示旧内容；新树本来不可见，没有旧内容可保留，
// 因而展示 fallback 可以接受。
let shellBoundary: Fiber | null = null;

/** 返回当前渲染离开可见 shell 时遇到的最外层边界；仍在 shell 中则为空。 */
export function getShellBoundary(): Fiber | null {
  return shellBoundary;
}

/**
 * 进入 Suspense 主内容树时压入捕获处理器，并更新 shell 边界。
 *
 * `unstable_avoidThisFallback` 边界在存在更理想父 fallback 时会复用父处理器；普通
 * 边界成为最近捕获点。首次进入当前 UI 不可见、或已显示 fallback 的边界时，将其
 * 记为 shellBoundary。
 */
export function pushPrimaryTreeSuspenseHandler(handler: Fiber): void {
  // TODO: 把 current 作为参数传入。
  const current = handler.alternate;
  const props: SuspenseProps = handler.pendingProps;

  // ForceSuspenseFallback 等浅层 Context 只传播一级，只强制最近 Suspense 边界。
  push(
    suspenseStackCursor,
    setDefaultShallowSuspenseListContext(suspenseStackCursor.current),
    handler,
  );

  // 实验能力：标记为“不理想 fallback”的边界仅在栈上没有其他可用边界时激活。
  if (
    enableSuspenseAvoidThisFallback &&
    props.unstable_avoidThisFallback === true &&
    // 已经可见的 avoided 边界与普通 Suspense 边界行为相同。
    (current === null || isCurrentTreeHidden())
  ) {
    if (shellBoundary === null) {
      // 正在 shell 中渲染，没有父边界能提供更理想 fallback，只能使用当前边界。
      push(suspenseHandlerStackCursor, handler, handler);

      // 但该 fallback 并不理想，其 children 仍视为 shell 一部分，故不写 shellBoundary。
    } else {
      // 父 Suspense 边界已有更理想 fallback，继续使用父处理器。
      const handlerOnStack = suspenseHandlerStackCursor.current;
      push(suspenseHandlerStackCursor, handlerOnStack, handler);
    }
    return;
  }

  // TODO: 父处理器已挂起时无需再压嵌套处理器，因为最终会被外层 fallback 替换。
  push(suspenseHandlerStackCursor, handler, handler);
  if (shellBoundary === null) {
    if (current === null || isCurrentTreeHidden()) {
      // 当前 UI 中尚不可见的边界成为 shell 分界点。
      shellBoundary = handler;
    } else {
      const prevState: SuspenseState = current.memoizedState;
      // $FlowFixMe[invalid-compare]
      if (prevState !== null) {
        // 当前 UI 已在此边界展示 fallback，它也成为 shell 分界点。
        shellBoundary = handler;
      }
    }
  }
}

/**
 * 进入 Suspense fallback 子树时复用外层处理器。
 *
 * fallback 内再次挂起相当于在 `catch` 块内部抛出，当前边界不能再次捕获自己。
 */
export function pushFallbackTreeSuspenseHandler(fiber: Fiber): void {
  // 即将渲染 fallback；其中挂起不能由当前边界捕获，复用栈上已有处理器。
  reuseSuspenseHandlerOnStack(fiber);
}

/**
 * hydration Activity 边界时把 Activity 自身压作处理器；挂起后可保持 dehydrated。
 */
export function pushDehydratedActivitySuspenseHandler(fiber: Fiber): void {
  // 同时压入当前 SuspenseList Context 只是为了避免 push/pop 数量失配。
  // TODO: 可把 popSuspenseHandler 拆成 Activity、Suspense、Offscreen 三种版本，
  // 从而去掉这次占位 push。
  push(suspenseStackCursor, suspenseStackCursor.current, fiber);
  push(suspenseHandlerStackCursor, fiber, fiber);
  if (shellBoundary === null) {
    // Activity 边界能把内部所有挂起限制在自身范围内。
    shellBoundary = fiber;
  }
}

/**
 * 进入 Offscreen 时设置挂起处理器；隐藏内容可通过不提交边界来吸收挂起。
 * LegacyHidden 没有这种边界语义，因此只复用当前处理器。
 */
export function pushOffscreenSuspenseHandler(fiber: Fiber): void {
  if (fiber.tag === OffscreenComponent) {
    // 压入当前 SuspenseList Context 只是为了避免 push/pop 数量失配。
    // TODO: 可为 Activity、Suspense、Offscreen 拆分 pop，移除此占位 push。
    push(suspenseStackCursor, suspenseStackCursor.current, fiber);
    push(suspenseHandlerStackCursor, fiber, fiber);
    if (shellBoundary === null) {
      // 正渲染隐藏内容；若挂起，只需不提交该 Offscreen 边界。
      shellBoundary = fiber;
    }
  } else {
    // LegacyHidden 组件不作为新的挂起捕获边界。
    reuseSuspenseHandlerOnStack(fiber);
  }
}

/** 为仅需保持栈深度的 Fiber 压入当前 Suspense 处理器与 Context。 */
export function reuseSuspenseHandlerOnStack(fiber: Fiber) {
  push(suspenseStackCursor, suspenseStackCursor.current, fiber);
  push(suspenseHandlerStackCursor, getSuspenseHandler(), fiber);
}

/** 返回栈顶最近的 Suspense 捕获边界。 */
export function getSuspenseHandler(): Fiber | null {
  return suspenseHandlerStackCursor.current;
}

/** 弹出一个 Suspense 处理器，并在离开 shellBoundary 时恢复 shell 状态。 */
export function popSuspenseHandler(fiber: Fiber): void {
  pop(suspenseHandlerStackCursor, fiber);
  if (shellBoundary === fiber) {
    // 已退回应用 shell。
    shellBoundary = null;
  }
  pop(suspenseStackCursor, fiber);
}

// SuspenseList Context。TODO: 可移到独立模块；SuspenseList 以后也可能改为 commit
// 阶段隐藏/显示。
/** SuspenseList 在 Fiber 栈上传递的位标记集合。 */
export opaque type SuspenseContext = number;
/** 会继续传播到后代层级的 SuspenseList Context 位。 */
export opaque type SubtreeSuspenseContext: SuspenseContext = number;
/** 只对下一层 Suspense 边界生效的 Context 位。 */
export opaque type ShallowSuspenseContext: SuspenseContext = number;

/** 不带任何 SuspenseList 行为的默认 Context。 */
const DefaultSuspenseContext: SuspenseContext = 0b00;

/** 从完整 Context 中保留可向子树传播部分的掩码。 */
const SubtreeSuspenseContextMask: SuspenseContext = 0b01;

/** SuspenseList 用于在某一遍渲染中强制新增项进入 fallback 的浅层位。 */
export const ForceSuspenseFallback: ShallowSuspenseContext = 0b10;

/** 当前 SuspenseList Context 的 Fiber 栈游标。 */
export const suspenseStackCursor: StackCursor<SuspenseContext> = createCursor(
  DefaultSuspenseContext,
);

/** 判断父 SuspenseList Context 是否包含指定标志。 */
export function hasSuspenseListContext(
  parentContext: SuspenseContext,
  flag: SuspenseContext,
): boolean {
  return (parentContext & flag) !== 0;
}

/** 清除浅层位，仅保留可继续向后代传播的默认 Context。 */
export function setDefaultShallowSuspenseListContext(
  parentContext: SuspenseContext,
): SuspenseContext {
  return parentContext & SubtreeSuspenseContextMask;
}

/** 在保留父级子树位的同时，替换只影响下一层的 SuspenseList Context。 */
export function setShallowSuspenseListContext(
  parentContext: SuspenseContext,
  shallowContext: ShallowSuspenseContext,
): SuspenseContext {
  return (parentContext & SubtreeSuspenseContextMask) | shallowContext;
}

/**
 * 进入普通 SuspenseList 行时压入新 Context，但继续复用当前捕获处理器。
 * 普通行挂起应由嵌套边界而非 SuspenseList 本身捕获。
 */
export function pushSuspenseListContext(
  fiber: Fiber,
  newContext: SuspenseContext,
): void {
  // 普通行不由 SuspenseList 捕获，因此把当前处理器原样压入。
  const handlerOnStack = suspenseHandlerStackCursor.current;
  push(suspenseHandlerStackCursor, handlerOnStack, fiber);
  push(suspenseStackCursor, newContext, fiber);
}

/**
 * 进入允许被隐藏的 SuspenseList 行时，把列表 Fiber 自身压作捕获处理器。
 */
export function pushSuspenseListCatch(
  fiber: Fiber,
  newContext: SuspenseContext,
): void {
  // 此类行允许隐藏，因此由实际列表边界接住挂起。
  push(suspenseHandlerStackCursor, fiber, fiber);
  push(suspenseStackCursor, newContext, fiber);
  if (shellBoundary === null) {
    // 挂起影响可限制为隐藏当前行。
    shellBoundary = fiber;
  }
}

/** 弹出 SuspenseList Context 与配对处理器，并按需返回应用 shell。 */
export function popSuspenseListContext(fiber: Fiber): void {
  pop(suspenseStackCursor, fiber);
  pop(suspenseHandlerStackCursor, fiber);
  if (shellBoundary === fiber) {
    // 已退回应用 shell。
    shellBoundary = null;
  }
}
