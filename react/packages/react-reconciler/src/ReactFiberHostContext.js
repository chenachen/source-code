/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactInternalTypes';
import type {StackCursor} from './ReactFiberStack';
import type {
  Container,
  HostContext,
  TransitionStatus,
} from './ReactFiberConfig';
import type {Hook} from './ReactFiberHooks';

import {
  getChildHostContext,
  getRootHostContext,
  HostTransitionContext,
  NotPendingTransition,
  isPrimaryRenderer,
} from './ReactFiberConfig';
import {createCursor, push, pop} from './ReactFiberStack';

/** 当前宿主命名空间或 renderer 定义上下文的栈游标。 */
const contextStackCursor: StackCursor<HostContext | null> = createCursor(null);
/** 实际提供栈顶 HostContext 的 Fiber，用于只弹出唯一值。 */
const contextFiberStackCursor: StackCursor<Fiber | null> = createCursor(null);
/** 当前根或 Portal 宿主容器的栈游标。 */
const rootInstanceStackCursor: StackCursor<Container | null> =
  createCursor(null);

/** 最近的宿主 Transition provider（React DOM 中为 form）；与宿主上下文一起压栈，在 complete/unwind 弹出后恢复外层 provider。 */
const hostTransitionProviderCursor: StackCursor<Fiber | null> =
  createCursor(null);

/**
 * 诊断缺失的宿主上下文，并把可空类型转换成调用方约定的非空类型。
 * DEV 中 null 只触发 console.error，生产中没有检查；两种构建都原样返回输入，不会在此抛错或补值。
 */
function requiredContext<Value>(c: Value | null): Value {
  if (__DEV__) {
    if (c === null) {
      console.error(
        'Expected host context to exist. This error is likely caused by a bug ' +
          'in React. Please file an issue.',
      );
    }
  }
  return c as any;
}

/** 返回当前根或 Portal 宿主容器；上下文尚未建立时允许为空。 */
function getCurrentRootHostContainer(): null | Container {
  return rootInstanceStackCursor.current;
}

/** 返回必定存在的当前宿主容器；缺失表示 reconciler 栈失配。 */
function getRootHostContainer(): Container {
  const rootInstance = requiredContext(rootInstanceStackCursor.current);
  return rootInstance;
}

/** 返回最近由宿主 Transition 升级的 Fiber。 */
export function getHostTransitionProvider(): Fiber | null {
  return hostTransitionProviderCursor.current;
}

/**
 * 进入根或 Portal 时压入容器和 renderer 根 HostContext。
 *
 * 先压一个空 Context 占位，再调用可能抛错的 `getRootHostContext`；这样异常退栈时
 * 三个栈始终等深。成功后以真实值替换占位。
 */
function pushHostContainer(fiber: Fiber, nextRootInstance: Container): void {
  // 压入当前根实例，使 Portal 弹出时能恢复外层根。
  push(rootInstanceStackCursor, nextRootInstance, fiber);
  // 记录提供 Context 的 Fiber，只让确实提供唯一值的节点执行弹出。
  push(contextFiberStackCursor, fiber, fiber);

  // 最后压 HostContext。不能先调用 getRootHostContext 再压栈，否则 renderer 代码
  // 抛错时栈项数量不同；先压空值即可安全退栈。
  push(contextStackCursor, null, fiber);
  const nextRootContext = getRootHostContext(nextRootInstance);
  // 已确认调用成功，用真实根 Context 替换占位。
  pop(contextStackCursor, fiber);
  push(contextStackCursor, nextRootContext, fiber);
}

/** 离开根或 Portal 时按相反顺序弹出 HostContext、提供者与容器。 */
function popHostContainer(fiber: Fiber) {
  pop(contextStackCursor, fiber);
  pop(contextFiberStackCursor, fiber);
  pop(rootInstanceStackCursor, fiber);
}

/** 返回当前 renderer HostContext；缺失表示 Fiber 栈协议被破坏。 */
function getHostContext(): HostContext {
  const context = requiredContext(contextStackCursor.current);
  return context;
}

/**
 * 进入宿主 Fiber 时传播表单 Transition 状态，并按需压入子 HostContext。
 * 只有 Context 引用真正变化时才压栈，减少常见宿主节点的 push/pop 成本。
 */
function pushHostContext(fiber: Fiber): void {
  const stateHook: Hook | null = fiber.memoizedState;
  if (stateHook !== null) {
    // 通过内部 Context 把当前宿主 Transition 状态传播给全部后代。
    //
    // 此实现假定 provider 不嵌套：唯一实现者 React DOM 的 form 不能嵌套。若未来
    // 支持嵌套，即使宿主 Fiber 尚未升级也必须压入 Context 值。
    const transitionStatus: TransitionStatus = stateHook.memoizedState;
    // $FlowFixMe[constant-condition]
    if (isPrimaryRenderer) {
      HostTransitionContext._currentValue = transitionStatus;
    } else {
      HostTransitionContext._currentValue2 = transitionStatus;
    }

    // 只有被宿主 Transition 升级的 Fiber 才提供该 Context；普通 HostContext 也同样优化。
    push(hostTransitionProviderCursor, fiber, fiber);
  }

  const context: HostContext = requiredContext(contextStackCursor.current);
  const nextContext = getChildHostContext(context, fiber.type);

  // Context 未变化时不为该 Fiber 额外压栈。
  if (context !== nextContext) {
    // 记录提供唯一 Context 的 Fiber，确保只由它负责弹出。
    push(contextFiberStackCursor, fiber, fiber);
    push(contextStackCursor, nextContext, fiber);
  }
}

/** 弹出当前 Fiber 实际提供的 HostContext 与宿主 Transition Context。 */
function popHostContext(fiber: Fiber): void {
  if (contextFiberStackCursor.current === fiber) {
    // pushHostContext 只压唯一值，因此仅由栈顶提供者弹出。
    pop(contextStackCursor, fiber);
    pop(contextFiberStackCursor, fiber);
  }

  if (hostTransitionProviderCursor.current === fiber) {
    // 只弹出真正的提供者。这既优化性能，也避免并发事件中宿主 provider 被升级
    //（memoizedState 从 null 变为非空）时出现潜在数据竞争。
    pop(hostTransitionProviderCursor, fiber);

    // 弹出后恢复 NotPendingTransition；form 不允许嵌套，所以无需恢复父 provider 状态。
    // 若未来支持多个嵌套宿主 provider，则必须恢复父级值。
    // $FlowFixMe[constant-condition]
    if (isPrimaryRenderer) {
      HostTransitionContext._currentValue = NotPendingTransition;
    } else {
      HostTransitionContext._currentValue2 = NotPendingTransition;
    }
  }
}

export {
  getHostContext,
  getCurrentRootHostContainer,
  getRootHostContainer,
  popHostContainer,
  popHostContext,
  pushHostContainer,
  pushHostContext,
};
