/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactInternalTypes';
import type {
  Instance,
  TextInstance,
  HydratableInstance,
  ActivityInstance,
  SuspenseInstance,
  Container,
  HostContext,
} from './ReactFiberConfig';
import type {ActivityState} from './ReactFiberActivityComponent';
import type {SuspenseState} from './ReactFiberSuspenseComponent';
import type {TreeContext} from './ReactFiberTreeContext';
import type {CapturedValue} from './ReactCapturedValue';
import type {HydrationDiffNode} from './ReactFiberHydrationDiffs';

import {
  HostComponent,
  HostSingleton,
  HostRoot,
  SuspenseComponent,
  ActivityComponent,
} from './ReactWorkTags';

import {createCapturedValueAtFiber} from './ReactCapturedValue';

import {createFiberFromDehydratedFragment} from './ReactFiber';
import {
  shouldSetTextContent,
  supportsHydration,
  supportsSingletons,
  getNextHydratableSibling,
  getNextHydratableSiblingAfterSingleton,
  getFirstHydratableChild,
  getFirstHydratableChildWithinContainer,
  getFirstHydratableChildWithinActivityInstance,
  getFirstHydratableChildWithinSuspenseInstance,
  getFirstHydratableChildWithinSingleton,
  hydrateInstance,
  diffHydratedPropsForDevWarnings,
  describeHydratableInstanceForDevWarnings,
  hydrateTextInstance,
  diffHydratedTextForDevWarnings,
  hydrateActivityInstance,
  hydrateSuspenseInstance,
  getNextHydratableInstanceAfterActivityInstance,
  getNextHydratableInstanceAfterSuspenseInstance,
  shouldDeleteUnhydratedTailInstances,
  resolveSingletonInstance,
  canHydrateInstance,
  canHydrateTextInstance,
  canHydrateActivityInstance,
  canHydrateSuspenseInstance,
  canHydrateFormStateMarker,
  isFormStateMarkerMatching,
  validateHydratableInstance,
  validateHydratableTextInstance,
} from './ReactFiberConfig';
import {OffscreenLane} from './ReactFiberLane';
import {
  getSuspendedTreeContext,
  restoreSuspendedTreeContext,
} from './ReactFiberTreeContext';
import {queueRecoverableErrors} from './ReactFiberWorkLoop';
import {getRootHostContainer, getHostContext} from './ReactFiberHostContext';
import {describeDiff} from './ReactFiberHydrationDiffs';
import {runWithFiberInDEV} from './ReactCurrentFiber';

// 栈上参与当前 hydration Context 的最深 Fiber；它可能是已匹配节点，也可能是插入树。
let hydrationParentFiber: null | Fiber = null;
let nextHydratableInstance: null | HydratableInstance = null;
let isHydrating: boolean = false;

// 先前 mismatch 或挂起使后续 mismatch 很可能是假阳性时，用此标记抑制警告。
let didSuspendOrErrorDEV: boolean = false;

// 已发现但尚未输出的 hydration 差异树。
let hydrationDiffRootDEV: null | HydrationDiffNode = null;

// 当前边界 hydration 尝试期间抛出的错误。
let hydrationErrors: Array<CapturedValue<mixed>> | null = null;

let rootOrSingletonContext = false;

/**
 * 从目标 Fiber 向根递归建立共享祖先 diff 树，并返回目标节点。
 *
 * 当前深度优先渲染保证共享祖先通常是 siblings 最后一项，可 O(1) 复用；同时维护
 * 到 mismatch 叶子的最短距离，供最终格式化折叠无意义链路。
 */
function buildHydrationDiffNode(
  fiber: Fiber,
  distanceFromLeaf: number,
): HydrationDiffNode {
  if (fiber.return === null) {
    // 已到达 diff 根。
    if (hydrationDiffRootDEV === null) {
      hydrationDiffRootDEV = {
        fiber: fiber,
        children: [],
        serverProps: undefined,
        serverTail: [],
        distanceFromLeaf: distanceFromLeaf,
      };
    } else if (hydrationDiffRootDEV.fiber !== fiber) {
      throw new Error(
        'Saw multiple hydration diff roots in a pass. This is a bug in React.',
      );
    } else if (hydrationDiffRootDEV.distanceFromLeaf > distanceFromLeaf) {
      hydrationDiffRootDEV.distanceFromLeaf = distanceFromLeaf;
    }
    return hydrationDiffRootDEV;
  }
  const siblings = buildHydrationDiffNode(
    fiber.return,
    distanceFromLeaf + 1,
  ).children;
  // 同一节点可能已存在于父级。当前始终深度优先，挂起或提前终止会重渲染；若共享
  // 祖先已加入，应仍处在该祖先内，因此它就是最后一项。遍历策略改变后可能需全扫。
  if (siblings.length > 0 && siblings[siblings.length - 1].fiber === fiber) {
    const existing = siblings[siblings.length - 1];
    if (existing.distanceFromLeaf > distanceFromLeaf) {
      existing.distanceFromLeaf = distanceFromLeaf;
    }
    return existing;
  }
  const newNode: HydrationDiffNode = {
    fiber: fiber,
    children: [],
    serverProps: undefined,
    serverTail: [],
    distanceFromLeaf: distanceFromLeaf,
  };
  siblings.push(newNode);
  return newNode;
}

/** 开发环境断言某条不应位于 hydration 的路径确实已离开 hydration。 */
function warnIfHydrating() {
  if (__DEV__) {
    if (isHydrating) {
      console.error(
        'We should not be hydrating here. This is a bug in React. Please file a bug.',
      );
    }
  }
}

/** 标记 hydration 期间已经抛错或挂起，抑制其 sibling 上可能失真的 mismatch 警告。 */
export function markDidThrowWhileHydratingDEV() {
  if (__DEV__) {
    didSuspendOrErrorDEV = true;
  }
}

/**
 * 从 HostRoot 开始 hydration：把游标指向容器首个可复用节点并清空本轮错误/diff。
 */
function enterHydrationState(fiber: Fiber): boolean {
  // $FlowFixMe[constant-condition]
  if (!supportsHydration) {
    return false;
  }

  const parentInstance: Container = fiber.stateNode.containerInfo;
  nextHydratableInstance =
    getFirstHydratableChildWithinContainer(parentInstance);
  hydrationParentFiber = fiber;
  isHydrating = true;
  hydrationErrors = null;
  didSuspendOrErrorDEV = false;
  hydrationDiffRootDEV = null;
  rootOrSingletonContext = true;

  return true;
}

/**
 * 重新进入 dehydrated Activity 边界，恢复其首个宿主 child 与挂起时 TreeContext。
 */
function reenterHydrationStateFromDehydratedActivityInstance(
  fiber: Fiber,
  activityInstance: ActivityInstance,
  treeContext: TreeContext | null,
): boolean {
  // $FlowFixMe[constant-condition]
  if (!supportsHydration) {
    return false;
  }
  nextHydratableInstance =
    getFirstHydratableChildWithinActivityInstance(activityInstance);
  hydrationParentFiber = fiber;
  isHydrating = true;
  hydrationErrors = null;
  didSuspendOrErrorDEV = false;
  hydrationDiffRootDEV = null;
  rootOrSingletonContext = false;
  if (treeContext !== null) {
    restoreSuspendedTreeContext(fiber, treeContext);
  }
  return true;
}

/**
 * 重新进入 dehydrated Suspense 边界，恢复其首个宿主 child 与挂起时 TreeContext。
 */
function reenterHydrationStateFromDehydratedSuspenseInstance(
  fiber: Fiber,
  suspenseInstance: SuspenseInstance,
  treeContext: TreeContext | null,
): boolean {
  // $FlowFixMe[constant-condition]
  if (!supportsHydration) {
    return false;
  }
  nextHydratableInstance =
    getFirstHydratableChildWithinSuspenseInstance(suspenseInstance);
  hydrationParentFiber = fiber;
  isHydrating = true;
  hydrationErrors = null;
  didSuspendOrErrorDEV = false;
  hydrationDiffRootDEV = null;
  rootOrSingletonContext = false;
  if (treeContext !== null) {
    restoreSuspendedTreeContext(fiber, treeContext);
  }
  return true;
}

/**
 * 记录某客户端 Fiber 未找到可复用宿主节点，并把被拒候选加入服务端删除 tail。
 * 已有挂起/错误时跳过，因为缺失数据可能让该 mismatch 成为假阳性。
 */
function warnNonHydratedInstance(
  fiber: Fiber,
  rejectedCandidate: null | HydratableInstance,
) {
  if (__DEV__) {
    if (didSuspendOrErrorDEV) {
      // 正渲染已挂起节点的 siblings；差异可能来自缺失数据，极可能是假阳性。
      return;
    }

    // 把此 Fiber 加入差异树。
    const diffNode = buildHydrationDiffNode(fiber, 0);
    // null 表示没有服务端节点可匹配。
    diffNode.serverProps = null;
    if (rejectedCandidate !== null) {
      const description =
        describeHydratableInstanceForDevWarnings(rejectedCandidate);
      diffNode.serverTail.push(description);
    }
  }
}

/**
 * 尝试把 HostComponent Fiber 认领为当前服务端宿主实例。
 *
 * 匹配成功后写入 stateNode，在开发环境记录属性差异，并把 hydration 游标下沉到
 * 该实例的首个可复用 child；失败时不移动任何游标，由调用方决定是否抛 mismatch。
 */
function tryHydrateInstance(
  fiber: Fiber,
  nextInstance: any,
  hostContext: HostContext,
) {
  // 此 Fiber 是 HostComponent。
  const instance = canHydrateInstance(
    nextInstance,
    fiber.type,
    fiber.pendingProps,
    rootOrSingletonContext,
  );
  // $FlowFixMe[invalid-compare]
  // $FlowFixMe[invalid-compare]
  if (instance !== null) {
    fiber.stateNode = instance as Instance;

    if (__DEV__) {
      if (!didSuspendOrErrorDEV) {
        const differences = diffHydratedPropsForDevWarnings(
          instance,
          fiber.type,
          fiber.pendingProps,
          hostContext,
          // $FlowFixMe[invalid-compare]
        );
        // $FlowFixMe[invalid-compare]
        if (differences !== null) {
          const diffNode = buildHydrationDiffNode(fiber, 0);
          diffNode.serverProps = differences;
        }
      }
    }

    hydrationParentFiber = fiber;
    nextHydratableInstance = getFirstHydratableChild(instance);
    rootOrSingletonContext = false;
    return true;
  }
  return false;
}

/**
 * 尝试把 HostText Fiber 认领为当前服务端文本实例。
 * 文本节点没有 child，成功后将下一可 hydration 游标置空，等待完成阶段返回父级。
 */
function tryHydrateText(fiber: Fiber, nextInstance: any) {
  // 此 Fiber 是 HostText。
  const text = fiber.pendingProps;
  const textInstance = canHydrateTextInstance(
    nextInstance,
    text,
    // $FlowFixMe[invalid-compare]
    rootOrSingletonContext,
  );
  // $FlowFixMe[invalid-compare]
  if (textInstance !== null) {
    fiber.stateNode = textInstance as TextInstance;
    hydrationParentFiber = fiber;
    // 文本实例没有 child，无需继续向下 hydration。
    nextHydratableInstance = null;
    return true;
  }
  return false;
}

/**
 * 尝试认领 dehydrated Activity 边界，并把服务端实例封装为待重入的 Fiber 状态。
 *
 * 首轮只创建 DehydratedFragment 占位 child，不进入边界内部；后续重放时再恢复保存的
 * TreeContext，从而让宿主 sibling 查找与删除逻辑把整个 dehydrated 区间视为一个单元。
 */
function tryHydrateActivity(
  fiber: Fiber,
  nextInstance: any,
): null | ActivityInstance {
  // 此 Fiber 是 ActivityComponent。
  const activityInstance = canHydrateActivityInstance(
    // $FlowFixMe[invalid-compare]
    nextInstance,
    rootOrSingletonContext,
  );
  // $FlowFixMe[invalid-compare]
  if (activityInstance !== null) {
    const activityState: ActivityState = {
      dehydrated: activityInstance,
      treeContext: getSuspendedTreeContext(),
      retryLane: OffscreenLane,
      hydrationErrors: null,
    };
    fiber.memoizedState = activityState;
    // 将 dehydrated fragment 保存为 child Fiber，使 getHostSibling 与删除逻辑无需为
    // 每个边界重复判断它是否仍处于 dehydrated 状态。
    const dehydratedFragment =
      createFiberFromDehydratedFragment(activityInstance);
    dehydratedFragment.return = fiber;
    fiber.child = dehydratedFragment;
    hydrationParentFiber = fiber;
    // Activity 实例虽有 child，但首轮不进入；稍后重放时再重新进入。
    nextHydratableInstance = null;
  }
  return activityInstance;
}

/**
 * 尝试认领 dehydrated Suspense 边界，并保存重试车道、TreeContext 与错误容器。
 * 首轮用 DehydratedFragment 占住整段服务端内容，实际 child 在边界重放时才 hydration。
 */
function tryHydrateSuspense(
  fiber: Fiber,
  nextInstance: any,
): null | SuspenseInstance {
  // 此 Fiber 是 SuspenseComponent。
  // $FlowFixMe[invalid-compare]
  const suspenseInstance = canHydrateSuspenseInstance(
    nextInstance,
    rootOrSingletonContext,
  );
  // $FlowFixMe[invalid-compare]
  if (suspenseInstance !== null) {
    const suspenseState: SuspenseState = {
      dehydrated: suspenseInstance,
      treeContext: getSuspendedTreeContext(),
      retryLane: OffscreenLane,
      hydrationErrors: null,
    };
    fiber.memoizedState = suspenseState;
    // 用 dehydrated fragment 作为 child Fiber，统一宿主 sibling 查找与节点删除路径。
    const dehydratedFragment =
      createFiberFromDehydratedFragment(suspenseInstance);
    dehydratedFragment.return = fiber;
    fiber.child = dehydratedFragment;
    hydrationParentFiber = fiber;
    // Suspense 实例虽有 child，但首轮不进入；稍后重放时再重新进入。
    nextHydratableInstance = null;
  }
  return suspenseInstance;
}

/**
 * hydration 结构不匹配的内部控制流异常。
 *
 * 它仅用于中止当前 hydration 并切换客户端重建，用户可见的诊断已另行入队，因此该
 * 哨兵异常本身不应逸出 reconciler。
 */
export const HydrationMismatchException: mixed = new Error(
  'Hydration Mismatch Exception: This is not a real error, and should not leak into ' +
    "userspace. If you're seeing this, it's likely a bug in React.",
);

/**
 * 终止当前 hydration：消费本次 DEV diff、构造可恢复诊断并抛出内部哨兵异常。
 * 调度器捕获后会改走客户端渲染，真正的错误在恢复/提交路径统一报告。
 */
function throwOnHydrationMismatch(fiber: Fiber, fromText: boolean = false) {
  let diff = '';
  if (__DEV__) {
    // 本次 mismatch 消费自己的 diff 根；后续错误会另建 diff。
    const diffRoot = hydrationDiffRootDEV;
    if (diffRoot !== null) {
      hydrationDiffRootDEV = null;
      diff = describeDiff(diffRoot);
    }
  }
  const error = new Error(
    `Hydration failed because the server rendered ${fromText ? 'text' : 'HTML'} didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:
` +
      '\n' +
      "- A server/client branch `if (typeof window !== 'undefined')`.\n" +
      "- Variable input such as `Date.now()` or `Math.random()` which changes each time it's called.\n" +
      "- Date formatting in a user's locale which doesn't match the server.\n" +
      '- External changing data without sending a snapshot of it along with the HTML.\n' +
      '- Invalid HTML tag nesting.\n' +
      '\n' +
      'It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.\n' +
      '\n' +
      'https://react.dev/link/hydration-mismatch' +
      diff,
  );
  queueHydrationError(createCapturedValueAtFiber(error, fiber));
  throw HydrationMismatchException;
}

/**
 * 在支持 singleton 的宿主环境解析并认领 document 级唯一实例。
 *
 * 它复用 HostConfig 解析结果、记录属性差异，然后将游标切到 singleton 内部；同时
 * 保持 root/singleton 上下文，使 head/body 等浮动节点遵循特殊匹配规则。
 */
function claimHydratableSingleton(fiber: Fiber): void {
  // $FlowFixMe[constant-condition]
  if (supportsSingletons) {
    if (!isHydrating) {
      return;
    }
    const currentRootContainer = getRootHostContainer();
    const currentHostContext = getHostContext();
    const instance = (fiber.stateNode = resolveSingletonInstance(
      fiber.type,
      fiber.pendingProps,
      currentRootContainer,
      currentHostContext,
      false,
    ));

    if (__DEV__) {
      if (!didSuspendOrErrorDEV) {
        const differences = diffHydratedPropsForDevWarnings(
          // $FlowFixMe[invalid-compare]
          instance,
          fiber.type,
          fiber.pendingProps,
          currentHostContext,
        );
        // $FlowFixMe[invalid-compare]
        if (differences !== null) {
          const diffNode = buildHydrationDiffNode(fiber, 0);
          diffNode.serverProps = differences;
        }
      }
    }

    hydrationParentFiber = fiber;
    rootOrSingletonContext = true;
    nextHydratableInstance = getFirstHydratableChildWithinSingleton(
      fiber.type,
      instance,
      nextHydratableInstance,
    );
  }
}

/**
 * 为 HostComponent 校验宿主上下文并认领当前 hydration 候选。
 * 候选缺失或类型不匹配时记录可解释 diff，随后触发该子树客户端重建。
 */
function tryToClaimNextHydratableInstance(fiber: Fiber): void {
  if (!isHydrating) {
    return;
  }

  // 在判断节点 mismatch 前，先验证该元素是否允许出现在当前宿主上下文。
  const currentHostContext = getHostContext();
  const shouldKeepWarning = validateHydratableInstance(
    fiber.type,
    fiber.pendingProps,
    currentHostContext,
  );

  const nextInstance = nextHydratableInstance;
  if (
    !nextInstance ||
    !tryHydrateInstance(fiber, nextInstance, currentHostContext)
  ) {
    if (shouldKeepWarning) {
      warnNonHydratedInstance(fiber, nextInstance);
    }
    throwOnHydrationMismatch(fiber);
  }
}

/**
 * 为 HostText 校验文本宿主上下文并认领当前候选；失败时记录差异并退出 hydration。
 */
function tryToClaimNextHydratableTextInstance(fiber: Fiber): void {
  if (!isHydrating) {
    return;
  }
  const text = fiber.pendingProps;

  let shouldKeepWarning = true;
  // 在判断节点 mismatch 前，先验证文本是否允许出现在当前宿主上下文。
  const currentHostContext = getHostContext();
  shouldKeepWarning = validateHydratableTextInstance(text, currentHostContext);

  const nextInstance = nextHydratableInstance;
  if (!nextInstance || !tryHydrateText(fiber, nextInstance)) {
    if (shouldKeepWarning) {
      warnNonHydratedInstance(fiber, nextInstance);
    }
    throwOnHydrationMismatch(fiber);
  }
}

/** 认领下一个 dehydrated Activity 实例；无法匹配时强制该边界客户端重建。 */
function claimNextHydratableActivityInstance(fiber: Fiber): ActivityInstance {
  const nextInstance = nextHydratableInstance;
  const activityInstance = nextInstance
    ? tryHydrateActivity(fiber, nextInstance)
    : null;
  if (activityInstance === null) {
    warnNonHydratedInstance(fiber, nextInstance);
    throw throwOnHydrationMismatch(fiber);
  }
  return activityInstance;
}

/** 认领下一个 dehydrated Suspense 实例；无法匹配时强制该边界客户端重建。 */
function claimNextHydratableSuspenseInstance(fiber: Fiber): SuspenseInstance {
  const nextInstance = nextHydratableInstance;
  const suspenseInstance = nextInstance
    ? tryHydrateSuspense(fiber, nextInstance)
    : null;
  if (suspenseInstance === null) {
    warnNonHydratedInstance(fiber, nextInstance);
    throw throwOnHydrationMismatch(fiber);
  }
  return suspenseInstance;
}

/**
 * 消费 useActionState 的服务端 form-state 标记，并判断它是否对应 hydrateRoot 的状态。
 *
 * 标记缺失代表服务端结构与客户端协议不同，必须触发客户端渲染；匹配结果决定是否把
 * 根传入的 form state 复用于当前 Hook。
 */
export function tryToClaimNextHydratableFormMarkerInstance(
  fiber: Fiber,
): boolean {
  if (!isHydrating) {
    return false;
  }
  if (nextHydratableInstance) {
    const markerInstance = canHydrateFormStateMarker(
      nextHydratableInstance,
      rootOrSingletonContext,
    );
    if (markerInstance) {
      // 已找到标记实例，先把游标移到其下一个 sibling。
      nextHydratableInstance = getNextHydratableSibling(markerInstance);
      // true 表示该标记应使用 hydrateRoot 传入的状态。
      // TODO：可让 Fizz 仅在根传入 form state 时输出这些标记，减少无效标记。
      return isFormStateMarkerMatching(markerInstance);
    }
  }
  // 本应存在标记；抛 mismatch 触发客户端渲染。useActionState 是新 API，无需因旧版
  // 兼容性再区分是否为 concurrent root。
  throwOnHydrationMismatch(fiber);
  return false;
}

/**
 * 在完成阶段把已认领宿主实例与 Fiber 的最终属性连接起来。
 * HostConfig 若报告无法 hydration，则按文本相关 mismatch 切换为客户端重建。
 */
function prepareToHydrateHostInstance(
  fiber: Fiber,
  hostContext: HostContext,
): void {
  // $FlowFixMe[constant-condition]
  if (!supportsHydration) {
    throw new Error(
      'Expected prepareToHydrateHostInstance() to never be called. ' +
        'This error is likely caused by a bug in React. Please file an issue.',
    );
  }

  const instance: Instance = fiber.stateNode;
  const didHydrate = hydrateInstance(
    instance,
    fiber.type,
    fiber.memoizedProps,
    hostContext,
    fiber,
  );
  if (!didHydrate) {
    throwOnHydrationMismatch(fiber, true);
  }
}

/**
 * 完成已认领文本实例的 hydration，并按其宿主父级属性生成 DEV 文本差异。
 * 父级属性参与诸如 suppressHydrationWarning 的宿主策略，实际绑定失败则重建子树。
 */
function prepareToHydrateHostTextInstance(fiber: Fiber): void {
  // $FlowFixMe[constant-condition]
  if (!supportsHydration) {
    throw new Error(
      'Expected prepareToHydrateHostTextInstance() to never be called. ' +
        'This error is likely caused by a bug in React. Please file an issue.',
    );
  }

  const textInstance: TextInstance = fiber.stateNode;
  const textContent: string = fiber.memoizedProps;
  const shouldWarnIfMismatchDev = !didSuspendOrErrorDEV;
  let parentProps = null;
  // 调用此函数时，hydrationParentFiber 应是该宿主文本的宿主父组件。
  const returnFiber = hydrationParentFiber;
  if (returnFiber !== null) {
    switch (returnFiber.tag) {
      case HostRoot: {
        if (__DEV__) {
          // $FlowFixMe[invalid-compare]
          if (shouldWarnIfMismatchDev) {
            const difference = diffHydratedTextForDevWarnings(
              textInstance,
              textContent,
              parentProps,
            );
            // $FlowFixMe[invalid-compare]
            if (difference !== null) {
              const diffNode = buildHydrationDiffNode(fiber, 0);
              diffNode.serverProps = difference;
            }
          }
        }
        break;
      }
      case HostSingleton:
      case HostComponent: {
        parentProps = returnFiber.memoizedProps;
        // $FlowFixMe[invalid-compare]
        if (__DEV__) {
          if (shouldWarnIfMismatchDev) {
            const difference = diffHydratedTextForDevWarnings(
              textInstance,
              textContent,
              parentProps,
            );
            // $FlowFixMe[invalid-compare]
            if (difference !== null) {
              const diffNode = buildHydrationDiffNode(fiber, 0);
              diffNode.serverProps = difference;
            }
          }
        }
        break;
      }
    }
    // TODO：确认父级是 SuspenseInstance 时是否需要单独的属性语义。
  }

  const didHydrate = hydrateTextInstance(
    textInstance,
    textContent,
    fiber,
    parentProps,
  );
  if (!didHydrate) {
    throwOnHydrationMismatch(fiber, true);
  }
}

/** 从 Fiber 保存的 dehydrated 状态取出 Activity 实例，并交给 HostConfig 完成绑定。 */
function prepareToHydrateHostActivityInstance(fiber: Fiber): void {
  // $FlowFixMe[constant-condition]
  if (!supportsHydration) {
    throw new Error(
      'Expected prepareToHydrateHostActivityInstance() to never be called. ' +
        'This error is likely caused by a bug in React. Please file an issue.',
    );
  }
  const activityState: null | ActivityState = fiber.memoizedState;
  const activityInstance: null | ActivityInstance =
    activityState !== null ? activityState.dehydrated : null;

  if (!activityInstance) {
    throw new Error(
      'Expected to have a hydrated activity instance. ' +
        'This error is likely caused by a bug in React. Please file an issue.',
    );
  }

  hydrateActivityInstance(activityInstance, fiber);
}

/** 从 Fiber 保存的 dehydrated 状态取出 Suspense 实例，并交给 HostConfig 完成绑定。 */
function prepareToHydrateHostSuspenseInstance(fiber: Fiber): void {
  // $FlowFixMe[constant-condition]
  if (!supportsHydration) {
    throw new Error(
      'Expected prepareToHydrateHostSuspenseInstance() to never be called. ' +
        'This error is likely caused by a bug in React. Please file an issue.',
    );
  }

  const suspenseState: null | SuspenseState = fiber.memoizedState;
  const suspenseInstance: null | SuspenseInstance =
    suspenseState !== null ? suspenseState.dehydrated : null;

  if (!suspenseInstance) {
    throw new Error(
      'Expected to have a hydrated suspense instance. ' +
        'This error is likely caused by a bug in React. Please file an issue.',
    );
  }

  hydrateSuspenseInstance(suspenseInstance, fiber);
}

/** 返回整个 dehydrated Activity 区间之后的首个可 hydration 实例。 */
function skipPastDehydratedActivityInstance(
  fiber: Fiber,
): null | HydratableInstance {
  const activityState: null | ActivityState = fiber.memoizedState;
  const activityInstance: null | ActivityInstance =
    activityState !== null ? activityState.dehydrated : null;

  if (!activityInstance) {
    throw new Error(
      'Expected to have a hydrated suspense instance. ' +
        'This error is likely caused by a bug in React. Please file an issue.',
    );
  }

  return getNextHydratableInstanceAfterActivityInstance(activityInstance);
}

/** 返回整个 dehydrated Suspense 区间之后的首个可 hydration 实例。 */
function skipPastDehydratedSuspenseInstance(
  fiber: Fiber,
): null | HydratableInstance {
  // $FlowFixMe[constant-condition]
  if (!supportsHydration) {
    throw new Error(
      'Expected skipPastDehydratedSuspenseInstance() to never be called. ' +
        'This error is likely caused by a bug in React. Please file an issue.',
    );
  }
  const suspenseState: null | SuspenseState = fiber.memoizedState;
  const suspenseInstance: null | SuspenseInstance =
    suspenseState !== null ? suspenseState.dehydrated : null;

  if (!suspenseInstance) {
    throw new Error(
      'Expected to have a hydrated suspense instance. ' +
        'This error is likely caused by a bug in React. Please file an issue.',
    );
  }

  return getNextHydratableInstanceAfterSuspenseInstance(suspenseInstance);
}

/**
 * 从完成的 Fiber 向上寻找下一个宿主 hydration 父级，并同步 root/singleton 上下文。
 */
function popToNextHostParent(fiber: Fiber): void {
  hydrationParentFiber = fiber.return;
  while (hydrationParentFiber) {
    switch (hydrationParentFiber.tag) {
      case HostComponent:
      case ActivityComponent:
      case SuspenseComponent:
        rootOrSingletonContext = false;
        return;
      case HostSingleton:
      case HostRoot:
        rootOrSingletonContext = true;
        return;
      default:
        hydrationParentFiber = hydrationParentFiber.return;
    }
  }
}

/**
 * 完成一个 hydration 父级并把游标推进到其服务端 sibling。
 *
 * 插入树完成时只重入 sibling；正常 hydration 则先检查未被客户端消费的服务端 tail，
 * 再按 Suspense、Activity、singleton 或普通宿主节点的边界规则越过整个实例区间。
 */
function popHydrationState(fiber: Fiber): boolean {
  // $FlowFixMe[constant-condition]
  if (!supportsHydration) {
    return false;
  }
  if (fiber !== hydrationParentFiber) {
    // 当前位于 hydration 上下文内更深的插入树，不应弹出父级。
    return false;
  }
  if (!isHydrating) {
    // 当前上下文来自一次插入；插入完成后返回父级并重新 hydration 它的 siblings。
    popToNextHostParent(fiber);
    isHydrating = true;
    return false;
  }

  const tag = fiber.tag;

  // $FlowFixMe[constant-condition]
  if (supportsSingletons) {
    // 启用 float/singleton 时不清理 Root、singleton，或承载 singleton 文本内容的实例。
    if (
      tag !== HostRoot &&
      tag !== HostSingleton &&
      !(
        tag === HostComponent &&
        (!shouldDeleteUnhydratedTailInstances(fiber.type) ||
          shouldSetTextContent(fiber.type, fiber.memoizedProps))
      )
    ) {
      const nextInstance = nextHydratableInstance;
      if (nextInstance) {
        warnIfUnhydratedTailNodes(fiber);
        throwOnHydrationMismatch(fiber);
      }
    }
  } else {
    // 若仍有可 hydration 节点，本应删除这些服务端 tail。head/body 常含随机外部节点，
    // 纯文本宿主会自行管理内容，根容器也不在此删除，因此这些位置均跳过该检查。
    if (
      tag !== HostRoot &&
      (tag !== HostComponent ||
        (shouldDeleteUnhydratedTailInstances(fiber.type) &&
          !shouldSetTextContent(fiber.type, fiber.memoizedProps)))
    ) {
      const nextInstance = nextHydratableInstance;
      if (nextInstance) {
        warnIfUnhydratedTailNodes(fiber);
        throwOnHydrationMismatch(fiber);
      }
    }
  }
  popToNextHostParent(fiber);
  if (tag === SuspenseComponent) {
    nextHydratableInstance = skipPastDehydratedSuspenseInstance(fiber);
  } else if (tag === ActivityComponent) {
    nextHydratableInstance = skipPastDehydratedActivityInstance(fiber);
    // $FlowFixMe[constant-condition]
  } else if (supportsSingletons && tag === HostSingleton) {
    nextHydratableInstance = getNextHydratableSiblingAfterSingleton(
      fiber.type,
      nextHydratableInstance,
    );
  } else {
    nextHydratableInstance = hydrationParentFiber
      ? getNextHydratableSibling(fiber.stateNode)
      : null;
  }
  return true;
}

// $FlowFixMe[invalid-compare]
/**
 * 把当前宿主父级下所有未消费的服务端 tail 追加到 DEV diff。
 * Suspense 要越过整段边界，其余实例逐 sibling 前进。
 */
function warnIfUnhydratedTailNodes(fiber: Fiber) {
  if (__DEV__) {
    let nextInstance = nextHydratableInstance;
    while (nextInstance) {
      const diffNode = buildHydrationDiffNode(fiber, 0);
      const description =
        describeHydratableInstanceForDevWarnings(nextInstance);
      diffNode.serverTail.push(description);
      // $FlowFixMe[invalid-compare]
      if (description.type === 'Suspense') {
        const suspenseInstance: SuspenseInstance = nextInstance as any;
        nextInstance =
          getNextHydratableInstanceAfterSuspenseInstance(suspenseInstance);
      } else {
        nextInstance = getNextHydratableSibling(nextInstance);
      }
    }
  }
}

/** 在离开根/边界时清空 hydration 游标与 DEV 挂起标记。 */
function resetHydrationState(): void {
  // $FlowFixMe[constant-condition]
  if (!supportsHydration) {
    return;
  }

  hydrationParentFiber = null;
  nextHydratableInstance = null;
  isHydrating = false;
  didSuspendOrErrorDEV = false;
}

/**
 * 中断展开已认领 DOM 节点的 HostComponent 时，恢复而非推进 hydration 游标。
 *
 * 这是 popHydrationState 的展开专用分支：执行相同上下文校验，却不清理服务端 tail、
 * 不抛 mismatch。replaySuspendedUnitOfWork 重跑同一 Fiber，或工作循环展开祖先时，
 * beginWork 因而能再次认领同一宿主节点。
 */
function popHydrationStateOnInterruptedWork(fiber: Fiber): void {
  // $FlowFixMe[constant-condition]
  if (!supportsHydration) {
    return;
  }
  if (fiber !== hydrationParentFiber) {
    // 当前位于 hydration 上下文内更深的插入树，不触碰游标。
    return;
  }
  if (!isHydrating) {
    // 当前上下文来自一次插入；与正常 pop 相同，返回父级以重入 siblings。
    popToNextHostParent(fiber);
    isHydrating = true;
    return;
  }

  // 上下文有效：把游标恢复到当前 Fiber 的 DOM 节点，让重跑的 beginWork 认领同一节点。
  // 此处是恢复而非完成，因此不检查未消费 tail，也不把游标前移。
  popToNextHostParent(fiber);
  if (fiber.tag === HostComponent && fiber.stateNode != null) {
    nextHydratableInstance = fiber.stateNode;
  }
}

/**
 * 客户端强制重建成功后，把本轮 hydration 错误升级为提交阶段的可恢复错误。
 * 返回原队列供边界保存，同时清空模块级队列，避免下一轮重复报告。
 */
export function upgradeHydrationErrorsToRecoverable(): Array<
  CapturedValue<mixed>,
> | null {
  const queuedErrors = hydrationErrors;
  if (queuedErrors !== null) {
    // 强制客户端渲染已成功；hydration 尝试中的错误现已恢复，待整棵树完成后在提交阶段报告。
    queueRecoverableErrors(queuedErrors);
    hydrationErrors = null;
  }
  return queuedErrors;
}

/** 返回 reconciler 当前是否正在消费服务端可 hydration 实例。 */
function getIsHydrating(): boolean {
  return isHydrating;
}

/** 将附带 Fiber 栈的 hydration 错误加入本轮队列，等待恢复或边界接管。 */
export function queueHydrationError(error: CapturedValue<mixed>): void {
  if (hydrationErrors === null) {
    hydrationErrors = [error];
  } else {
    hydrationErrors.push(error);
  }
}

/**
 * hydration 成功完成后输出仅属性不一致的 DEV 警告。
 *
 * 结构 mismatch 已在更早阶段中止；这里消费剩余 diff，并选择深度优先首个叶 Fiber
 * 作为日志 owner，使组件栈尽量指向实际产生属性差异的位置。
 */
export function emitPendingHydrationWarnings() {
  if (__DEV__) {
    // 到结束仍未抛 hydration 错误说明结构复用成功，但仍可能存在仅 DEV 报告的属性差异。
    const diffRoot = hydrationDiffRootDEV;
    if (diffRoot !== null) {
      hydrationDiffRootDEV = null;
      const diff = describeDiff(diffRoot);

      // 选择深度优先首个叶节点作为 owner；大多数警告只有一个差异，足以定位组件栈。
      let diffOwner: HydrationDiffNode = diffRoot;
      while (diffOwner.children.length > 0) {
        diffOwner = diffOwner.children[0];
      }

      runWithFiberInDEV(diffOwner.fiber, () => {
        console.error(
          "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up. " +
            'This can happen if a SSR-ed Client Component used:\n' +
            '\n' +
            "- A server/client branch `if (typeof window !== 'undefined')`.\n" +
            "- Variable input such as `Date.now()` or `Math.random()` which changes each time it's called.\n" +
            "- Date formatting in a user's locale which doesn't match the server.\n" +
            '- External changing data without sending a snapshot of it along with the HTML.\n' +
            '- Invalid HTML tag nesting.\n' +
            '\n' +
            'It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.\n' +
            '\n' +
            '%s%s',
          'https://react.dev/link/hydration-mismatch',
          diff,
        );
      });
    }
  }
}

export {
  warnIfHydrating,
  enterHydrationState,
  getIsHydrating,
  reenterHydrationStateFromDehydratedActivityInstance,
  reenterHydrationStateFromDehydratedSuspenseInstance,
  resetHydrationState,
  popHydrationStateOnInterruptedWork,
  claimHydratableSingleton,
  tryToClaimNextHydratableInstance,
  tryToClaimNextHydratableTextInstance,
  claimNextHydratableActivityInstance,
  claimNextHydratableSuspenseInstance,
  prepareToHydrateHostInstance,
  prepareToHydrateHostTextInstance,
  prepareToHydrateHostActivityInstance,
  prepareToHydrateHostSuspenseInstance,
  popHydrationState,
};
