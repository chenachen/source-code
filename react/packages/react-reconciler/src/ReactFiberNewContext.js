/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactContext} from 'shared/ReactTypes';
import type {
  Fiber,
  ContextDependency,
  Dependencies,
} from './ReactInternalTypes';
import type {StackCursor} from './ReactFiberStack';
import type {Lanes} from './ReactFiberLane';
import type {TransitionStatus} from './ReactFiberConfig';
import type {Hook} from './ReactFiberHooks';

import {isPrimaryRenderer, HostTransitionContext} from './ReactFiberConfig';
import {createCursor, push, pop} from './ReactFiberStack';
import {
  ContextProvider,
  DehydratedFragment,
  SuspenseComponent,
} from './ReactWorkTags';
import {NoLanes, isSubsetOfLanes, mergeLanes} from './ReactFiberLane';
import {
  NoFlags,
  DidPropagateContext,
  NeedsPropagation,
} from './ReactFiberFlags';

import is from 'shared/objectIs';
import {getHostTransitionProvider} from './ReactFiberHostContext';

/** 进入 Provider 前保存旧 `_currentValue` 的栈游标。 */
const valueCursor: StackCursor<mixed> = createCursor(null);

/** DEV 保存主 renderer 的旧身份哨兵，与 Provider value push/pop 配对。 */
let rendererCursorDEV: StackCursor<Object | null>;
if (__DEV__) {
  rendererCursorDEV = createCursor(null);
}
/** DEV 保存次 renderer 的旧身份哨兵，不与主 renderer 共用槽位。 */
let renderer2CursorDEV: StackCursor<Object | null>;
if (__DEV__) {
  renderer2CursorDEV = createCursor(null);
}

/** 当前 reconciler 模块实例的唯一 DEV 身份，用来诊断同一槽位被多个 renderer 同时使用。 */
let rendererSigil;
if (__DEV__) {
  // 用实例唯一哨兵检测多个 renderer 并发使用同一 Context。
  rendererSigil = {};
}

/** prepareToReadContext 设置的当前消费者；yield/异常重置后为 null，防止把外部读取归入旧 Fiber。 */
let currentlyRenderingFiber: Fiber | null = null;
/** 本轮消费者依赖单链表的尾节点；每次准备读取时清空。 */
let lastContextDependency: ContextDependency<mixed> | null = null;

/** DEV 仅用于警告 updater/useMemo 等内部回调读 Context，不影响实际值的读取。 */
let isDisallowedContextReadInDEV: boolean = false;

/**
 * 在 React 让出执行权前清空本轮 Context 读取状态。
 * 这样 render 阶段之外调用 `readContext` 无法误关联到上一个 Fiber。
 */
export function resetContextDependencies(): void {
  // React yield 前调用，确保 render 阶段之外不能读取 Context。
  currentlyRenderingFiber = null;
  lastContextDependency = null;
  if (__DEV__) {
    isDisallowedContextReadInDEV = false;
  }
}

/** 开发环境进入禁止读取 Context 的用户回调区间，例如 useMemo 的计算函数。 */
export function enterDisallowedContextReadInDEV(): void {
  if (__DEV__) {
    isDisallowedContextReadInDEV = true;
  }
}

/** 开发环境离开禁止读取 Context 的用户回调区间。 */
export function exitDisallowedContextReadInDEV(): void {
  if (__DEV__) {
    isDisallowedContextReadInDEV = false;
  }
}

/**
 * 进入 Provider 时保存旧值并写入当前 renderer 对应的 Context 槽位。
 * 开发环境同时压入 renderer 哨兵，若同一槽位已由另一 renderer 使用则诊断不支持的
 * 并发渲染。
 */
export function pushProvider<T>(
  providerFiber: Fiber,
  context: ReactContext<T>,
  nextValue: T,
): void {
  // $FlowFixMe[constant-condition]
  if (isPrimaryRenderer) {
    push(valueCursor, context._currentValue, providerFiber);

    context._currentValue = nextValue;
    if (__DEV__) {
      push(rendererCursorDEV, context._currentRenderer, providerFiber);

      if (
        context._currentRenderer !== undefined &&
        context._currentRenderer !== null &&
        context._currentRenderer !== rendererSigil
      ) {
        console.error(
          'Detected multiple renderers concurrently rendering the ' +
            'same context provider. This is currently unsupported.',
        );
      }
      context._currentRenderer = rendererSigil;
    }
  } else {
    push(valueCursor, context._currentValue2, providerFiber);

    context._currentValue2 = nextValue;
    if (__DEV__) {
      push(renderer2CursorDEV, context._currentRenderer2, providerFiber);

      if (
        context._currentRenderer2 !== undefined &&
        context._currentRenderer2 !== null &&
        context._currentRenderer2 !== rendererSigil
      ) {
        console.error(
          'Detected multiple renderers concurrently rendering the ' +
            'same context provider. This is currently unsupported.',
        );
      }
      context._currentRenderer2 = rendererSigil;
    }
  }
}

/** 弹出 Provider，恢复进入前的 Context 值与开发期 renderer 哨兵。 */
export function popProvider(
  context: ReactContext<any>,
  providerFiber: Fiber,
): void {
  const currentValue = valueCursor.current;

  // $FlowFixMe[constant-condition]
  if (isPrimaryRenderer) {
    context._currentValue = currentValue;
    if (__DEV__) {
      const currentRenderer = rendererCursorDEV.current;
      pop(rendererCursorDEV, providerFiber);
      context._currentRenderer = currentRenderer;
    }
  } else {
    context._currentValue2 = currentValue;
    if (__DEV__) {
      const currentRenderer2 = renderer2CursorDEV.current;
      pop(renderer2CursorDEV, providerFiber);
      context._currentRenderer2 = currentRenderer2;
    }
  }

  pop(valueCursor, providerFiber);
}

/**
 * 把 Context 更新的 renderLanes 从消费者父节点沿祖先路径传播到指定根。
 * 同步维护 current/alternate 的 childLanes；即使当前层已有足够优先级仍继续遍历，
 * 因为 Offscreen 或 fallback 子树的 childLanes 可能与外部不一致。
 */
export function scheduleContextWorkOnParentPath(
  parent: Fiber | null,
  renderLanes: Lanes,
  propagationRoot: Fiber,
) {
  // 更新全部祖先及其 alternate 的 childLanes。
  let node = parent;
  while (node !== null) {
    const alternate = node.alternate;
    if (!isSubsetOfLanes(node.childLanes, renderLanes)) {
      node.childLanes = mergeLanes(node.childLanes, renderLanes);
      if (alternate !== null) {
        alternate.childLanes = mergeLanes(alternate.childLanes, renderLanes);
      }
    } else if (
      alternate !== null &&
      !isSubsetOfLanes(alternate.childLanes, renderLanes)
    ) {
      alternate.childLanes = mergeLanes(alternate.childLanes, renderLanes);
    } else {
      // current/alternate 都无需更新。通常可据此判断其余祖先已有足够优先级，但
      // Offscreen/fallback 内的 childLanes 可能与周围不一致，所以仍继续循环。
    }
    if (node === propagationRoot) {
      break;
    }
    node = node.return;
  }
  if (__DEV__) {
    if (node !== propagationRoot) {
      console.error(
        'Expected to find the propagation root when scheduling context work. ' +
          'This error is likely caused by a bug in React. Please file an issue.',
      );
    }
  }
}

/**
 * 从指定工作 Fiber 向整个子树同步传播一个 Context 变化。
 * 当前只供 Cache 组件使用，必须完整遍历；普通 Provider 可走父级变化的懒传播路径。
 */
export function propagateContextChange<T>(
  workInProgress: Fiber,
  context: ReactContext<T>,
  renderLanes: Lanes,
): void {
  // TODO: 懒传播也识别 Cache 组件，让它们不必强制遍历完整子树。
  const forcePropagateEntireTree = true;
  propagateContextChanges(
    workInProgress,
    [context],
    renderLanes,
    forcePropagateEntireTree,
  );
}

/**
 * 深度优先扫描子树，对依赖任一变化 Context 的消费者标记 renderLanes。
 *
 * 懒模式命中消费者后可跳过其 children，因为随后 render 会访问；强制模式用于延迟
 * 树，必须走遍全部后代。dehydrated 或丢失主树 Fiber 的 Suspense 会保守标记边界。
 */
function propagateContextChanges<T>(
  workInProgress: Fiber,
  contexts: Array<any>,
  renderLanes: Lanes,
  forcePropagateEntireTree: boolean,
): void {
  let fiber = workInProgress.child;
  if (fiber !== null) {
    // 把 child 的 return 指向当前 work-in-progress Fiber。
    fiber.return = workInProgress;
  }
  while (fiber !== null) {
    let nextFiber;

    // 访问当前 Fiber。
    const list = fiber.dependencies;
    if (list !== null) {
      nextFiber = fiber.child;

      let dep = list.firstContext;
      findChangedDep: while (dep !== null) {
        // 赋给常量，帮助 Flow 收窄循环变量。
        const dependency = dep;
        const consumer = fiber;
        findContext: for (let i = 0; i < contexts.length; i++) {
          const context: ReactContext<T> = contexts[i];
          // 检查依赖是否属于本批变化 Context。
          // $FlowFixMe[invalid-compare]
          if (dependency.context === context) {
            // 命中：为消费者安排更新。

            // 懒实现不在依赖本身标脏：并非全部变化都会传播，消费者仍需自行比较。
            // 未来有 selector 后可恢复脏标志，减少二次检查；当前收益不值得复杂度。
            consumer.lanes = mergeLanes(consumer.lanes, renderLanes);
            const alternate = consumer.alternate;
            if (alternate !== null) {
              alternate.lanes = mergeLanes(alternate.lanes, renderLanes);
            }
            scheduleContextWorkOnParentPath(
              consumer.return,
              renderLanes,
              workInProgress,
            );

            if (!forcePropagateEntireTree) {
              // 懒传播命中后可把 children 留给 render 访问，但仍需继续扫描 siblings。
              nextFiber = null;
            }

            // 已命中一个变化 Context，无需继续遍历该消费者的依赖表。
            break findChangedDep;
          }
        }
        dep = dependency.next;
      }
    } else if (fiber.tag === DehydratedFragment) {
      // dehydrated Suspense 子树内是否有消费者不可知，只能保守标记边界有更新。
      const parentSuspense = fiber.return;

      if (parentSuspense === null) {
        throw new Error(
          'We just came from a parent so we must have had a parent. This is a bug in React.',
        );
      }

      parentSuspense.lanes = mergeLanes(parentSuspense.lanes, renderLanes);
      const alternate = parentSuspense.alternate;
      if (alternate !== null) {
        alternate.lanes = mergeLanes(alternate.lanes, renderLanes);
      }
      // 刻意从该 Fiber 的父路径安排，使它的 childLanes 表示子树 Context 已变化。
      scheduleContextWorkOnParentPath(
        parentSuspense,
        renderLanes,
        workInProgress,
      );
      nextFiber = null;
    } else if (
      fiber.tag === SuspenseComponent &&
      fiber.memoizedState !== null &&
      fiber.memoizedState.dehydrated === null
    ) {
      // 客户端 Suspense 当前显示 fallback。primary children 可能有消费者，但初次
      // 挂起时没有 current 树可保留，它们的 Fiber 可能已丢弃。无法进入主树扫描，
      // 因此保守标记边界重试；重渲染会重新挂载主树并读取新 Context。
      fiber.lanes = mergeLanes(fiber.lanes, renderLanes);
      const alternate = fiber.alternate;
      if (alternate !== null) {
        alternate.lanes = mergeLanes(alternate.lanes, renderLanes);
      }
      scheduleContextWorkOnParentPath(
        fiber.return,
        renderLanes,
        workInProgress,
      );
      // primary Fiber 可能不存在，但 fallback children 确实位于已提交且可见的树中，
      // 必须继续向 fallback 子树传播，让其中消费者重渲染。
      //
      // Fiber 结构如下：
      //   SuspenseComponent
      //     → child: OffscreenComponent (primary, hidden)
      //       → sibling: FallbackFragment
      //
      // 跳过隐藏 primary 子树，直接进入 fallback。
      const primaryChildFragment = fiber.child;
      if (primaryChildFragment !== null) {
        nextFiber = primaryChildFragment.sibling;
      } else {
        nextFiber = null;
      }
    } else {
      // 向 child 深入。
      nextFiber = fiber.child;
    }

    if (nextFiber !== null) {
      // 设置 child 的 return 指针。
      nextFiber.return = fiber;
    } else {
      // 没有 child，转向下一个 sibling。
      nextFiber = fiber;
      while (nextFiber !== null) {
        if (nextFiber === workInProgress) {
          // 已回到本子树根，退出遍历。
          nextFiber = null;
          break;
        }
        const sibling = nextFiber.sibling;
        if (sibling !== null) {
          // 修正 sibling 的 return 指针。
          sibling.return = nextFiber.return;
          nextFiber = sibling;
          break;
        }
        // 没有更多 sibling，向父级回溯。
        nextFiber = nextFiber.return;
      }
    }
    fiber = nextFiber;
  }
}

/**
 * 懒传播当前 Fiber 祖先 Provider 的变化。
 * 命中消费者后可跳过其 children，返回本轮是否观察到任一变化 Provider。
 */
export function lazilyPropagateParentContextChanges(
  current: Fiber,
  workInProgress: Fiber,
  renderLanes: Lanes,
): boolean {
  const forcePropagateEntireTree = false;
  return propagateParentContextChanges(
    current,
    workInProgress,
    renderLanes,
    forcePropagateEntireTree,
  );
}

/**
 * 向 Suspense/Offscreen 延迟树完整传播祖先 Context 变化。
 * 当前 render 完成前不会再访问该树，之后也会丢失“哪些 Provider 改变”的信息，
 * 因此不能采用命中后跳过后代的懒策略。
 */
export function propagateParentContextChangesToDeferredTree(
  current: Fiber,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  const forcePropagateEntireTree = true;
  propagateParentContextChanges(
    current,
    workInProgress,
    renderLanes,
    forcePropagateEntireTree,
  );
}

/**
 * 沿当前 Fiber 的祖先链收集值发生变化的 Context，再向其子树传播。
 * `DidPropagateContext` 防止同一子树重复扫描；位于 NeedsPropagation 延迟树内时忽略
 * 该提前退出标记，因为先前传播可能并不完整。
 */
function propagateParentContextChanges(
  current: Fiber,
  workInProgress: Fiber,
  renderLanes: Lanes,
  forcePropagateEntireTree: boolean,
): boolean {
  // 收集所有变化的父 Provider；数量通常很小，用 Array 比 Set 更轻。
  let contexts = null;
  let parent: null | Fiber = workInProgress;
  let isInsidePropagationBailout = false;
  while (parent !== null) {
    if (!isInsidePropagationBailout) {
      if ((parent.flags & NeedsPropagation) !== NoFlags) {
        isInsidePropagationBailout = true;
      } else if ((parent.flags & DidPropagateContext) !== NoFlags) {
        break;
      }
    }

    if (parent.tag === ContextProvider) {
      const currentParent = parent.alternate;

      if (currentParent === null) {
        throw new Error('Should have a current fiber. This is a bug in React.');
      }

      const oldProps = currentParent.memoizedProps;
      if (oldProps !== null) {
        const context: ReactContext<any> = parent.type;
        const newProps = parent.pendingProps;
        const newValue = newProps.value;

        const oldValue = oldProps.value;

        if (!is(newValue, oldValue)) {
          if (contexts !== null) {
            contexts.push(context);
          } else {
            contexts = [context];
          }
        }
      }
    } else if (parent === getHostTransitionProvider()) {
      // 宿主 Transition 中，宿主组件也可充当 Context Provider；React DOM 中即 <form />。
      const currentParent = parent.alternate;
      if (currentParent === null) {
        throw new Error('Should have a current fiber. This is a bug in React.');
      }

      const oldStateHook: Hook = currentParent.memoizedState;
      const oldState: TransitionStatus = oldStateHook.memoizedState;

      const newStateHook: Hook = parent.memoizedState;
      const newState: TransitionStatus = newStateHook.memoizedState;

      // 使用普通相等而非 Object.is，因为宿主 Transition 状态类型假定不包含 NaN。
      if (oldState !== newState) {
        if (contexts !== null) {
          contexts.push(HostTransitionContext);
        } else {
          contexts = [HostTransitionContext];
        }
      }
    }
    parent = parent.return;
  }

  if (contexts !== null) {
    // 存在变化 Provider 时扫描 children 并传播。
    propagateContextChanges(
      workInProgress,
      contexts,
      renderLanes,
      forcePropagateEntireTree,
    );
  }

  // 此标记让每棵子树只传播一次。深层 child bailout 再调用本函数时，可知道其余祖先
  // Provider 已经处理。
  //
  // 之所以需要它，是因为有时会进入没有工作的节点 begin 阶段，特别是有工作节点的
  // siblings。它们会 bailout 并重复调用本函数，即使 Context 已传播到该子树。
  //
  // 但在 Context 传播被延迟的树内必须忽略它，NeedsPropagation 即用于标识该情况。
  //
  // 若能在进入 siblings 的 begin 阶段前 bailout，即可删除 DidPropagateContext 与
  // NeedsPropagation；下次 Fiber 树结构重构可一并考虑。
  workInProgress.flags |= DidPropagateContext;
  return contexts !== null;
}

/**
 * 在 props/state 已 bailout 后比较一个 Fiber 记录的全部 Context 依赖。
 * 该冷路径以 Object.is 检查 memoizedValue；把比较放在这里可避免加重更热的 readContext。
 */
export function checkIfContextChanged(
  currentDependencies: Dependencies,
): boolean {
  // 遍历当前依赖找变化。除变化子树根外，该路径仅在 props/state bailout 后出现，
  // 频率较低；放在这里比增加 readContext 热路径成本更合适。
  let dependency = currentDependencies.firstContext;
  while (dependency !== null) {
    const context = dependency.context;
    // $FlowFixMe[constant-condition]
    const newValue = isPrimaryRenderer
      ? context._currentValue
      : context._currentValue2;
    const oldValue = dependency.memoizedValue;
    if (!is(newValue, oldValue)) {
      return true;
    }
    dependency = dependency.next;
  }
  return false;
}

/**
 * 为当前 Fiber 开始一轮 Context 读取，清空 WIP 的 firstContext 和模块尾指针，随后按实际读取重建依赖。
 * dependencies 已由 createWorkInProgress 浅克隆，不能改写 current 的依赖头；renderLanes 保留调用签名，此处不消费。
 */
export function prepareToReadContext(
  workInProgress: Fiber,
  renderLanes: Lanes,
): void {
  currentlyRenderingFiber = workInProgress;
  lastContextDependency = null;

  const dependencies = workInProgress.dependencies;
  if (dependencies !== null) {
    // 重置 work-in-progress 依赖链。
    dependencies.firstContext = null;
  }
}

/**
 * 在当前 render Fiber 上读取 Context，并登记依赖。
 * 开发环境会警告 useMemo/useReducer 等 Hook 内部回调中的非法读取；仍返回当前值并登记依赖。
 */
export function readContext<T>(context: ReactContext<T>): T {
  if (__DEV__) {
    // 在 useMemo 等 Hook 内读取会触发；出于性能考虑，生产环境不做此项检查。
    if (isDisallowedContextReadInDEV) {
      console.error(
        'Context can only be read while React is rendering. ' +
          'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
          'In function components, you can read it directly in the function body, but not ' +
          'inside Hooks like useReducer() or useMemo().',
      );
    }
  }
  return readContextForConsumer(currentlyRenderingFiber, context);
}

/** 协调阶段若尚未准备消费者，则先初始化依赖链，再读取并登记 Context。 */
export function readContextDuringReconciliation<T>(
  consumer: Fiber,
  context: ReactContext<T>,
  renderLanes: Lanes,
): T {
  if (currentlyRenderingFiber === null) {
    prepareToReadContext(consumer, renderLanes);
  }
  return readContextForConsumer(consumer, context);
}

/**
 * 读取当前 renderer 槽位并把 `{context, memoizedValue}` 追加到消费者依赖链。
 * 首项会创建 Dependencies 并设置 NeedsPropagation，使 bailout 路径仍检查父 Provider。
 * 值以 Object.is 比较的快照形式保存，后续 checkIfContextChanged 使用它；没有当前消费者时首项读取直接抛错。
 * 每次读取都会追加独立节点，此处不按 Context 去重；调用方须先 prepare 并在退出 render 时 reset。
 */
function readContextForConsumer<T>(
  consumer: Fiber | null,
  context: ReactContext<T>,
): T {
  // $FlowFixMe[constant-condition]
  const value = isPrimaryRenderer
    ? context._currentValue
    : context._currentValue2;

  const contextItem = {
    context: context as any as ReactContext<mixed>,
    memoizedValue: value,
    next: null,
  };

  if (lastContextDependency === null) {
    if (consumer === null) {
      throw new Error(
        'Context can only be read while React is rendering. ' +
          'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
          'In function components, you can read it directly in the function body, but not ' +
          'inside Hooks like useReducer() or useMemo().',
      );
    }

    // 这是组件的首个依赖，创建新链表。
    // $FlowFixMe[incompatible-type]
    lastContextDependency = contextItem;
    consumer.dependencies = __DEV__
      ? // $FlowFixMe[incompatible-type]
        {
          lanes: NoLanes,
          firstContext: contextItem,
          _debugThenableState: null,
        }
      : // $FlowFixMe[incompatible-type]
        {
          lanes: NoLanes,
          firstContext: contextItem,
        };
    consumer.flags |= NeedsPropagation;
  } else {
    // 追加一个 Context 依赖项。
    // $FlowFixMe[incompatible-type]
    lastContextDependency = lastContextDependency.next = contextItem;
  }
  return value;
}
