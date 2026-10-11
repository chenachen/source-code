/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  Fiber,
  FiberRoot,
  SuspenseHydrationCallbacks,
  TransitionTracingCallbacks,
} from './ReactInternalTypes';
import type {RootTag} from './ReactRootTags';
import type {
  Container,
  PublicInstance,
  RendererInspectionConfig,
} from './ReactFiberConfig';
import type {ReactNodeList, ReactFormState} from 'shared/ReactTypes';
import type {Lane} from './ReactFiberLane';
import type {ActivityState} from './ReactFiberActivityComponent';
import type {SuspenseState} from './ReactFiberSuspenseComponent';

import {LegacyRoot} from './ReactRootTags';
import {
  findCurrentHostFiber,
  findCurrentHostFiberWithNoPortals,
} from './ReactFiberTreeReflection';
import {get as getInstance} from 'shared/ReactInstanceMap';
import {
  HostComponent,
  HostSingleton,
  ClassComponent,
  HostRoot,
  SuspenseComponent,
  ActivityComponent,
} from './ReactWorkTags';
import getComponentNameFromFiber from 'react-reconciler/src/getComponentNameFromFiber';
import isArray from 'shared/isArray';
import {
  enableSchedulingProfiler,
  disableLegacyMode,
} from 'shared/ReactFeatureFlags';
import ReactSharedInternals from 'shared/ReactSharedInternals';
import {
  getPublicInstance,
  rendererVersion,
  rendererPackageName,
  extraDevToolsConfig,
} from './ReactFiberConfig';
import {
  findCurrentUnmaskedContext,
  processChildContext,
  emptyContextObject,
  isContextProvider as isLegacyContextProvider,
} from './ReactFiberLegacyContext';
import {createFiberRoot} from './ReactFiberRoot';
import {isRootDehydrated} from './ReactFiberShellHydration';
import {
  injectInternals,
  markRenderScheduled,
  onScheduleRoot,
  injectProfilingHooks,
} from './ReactFiberDevToolsHook';
import {startUpdateTimerByLane} from './ReactProfilerTimer';
import {
  requestUpdateLane,
  scheduleUpdateOnFiber,
  scheduleInitialHydrationOnRoot,
  flushRoot,
  batchedUpdates,
  flushSyncFromReconciler,
  flushSyncWork,
  isAlreadyRendering,
  deferredUpdates,
  discreteUpdates,
  flushPendingEffects,
} from './ReactFiberWorkLoop';
import {enqueueConcurrentRenderForLane} from './ReactFiberConcurrentUpdates';
import {
  createUpdate,
  enqueueUpdate,
  entangleTransitions,
} from './ReactFiberClassUpdateQueue';
import {
  isRendering as ReactCurrentFiberIsRendering,
  current as ReactCurrentFiberCurrent,
  runWithFiberInDEV,
} from './ReactCurrentFiber';
import {StrictLegacyMode} from './ReactTypeOfMode';
import {
  SyncLane,
  SelectiveHydrationLane,
  getHighestPriorityPendingLanes,
  higherPriorityLane,
  getBumpedLaneForHydrationByLane,
  claimNextRetryLane,
} from './ReactFiberLane';
import {
  scheduleRefresh,
  scheduleRoot,
  setRefreshHandler,
} from './ReactFiberHotReloading';
import ReactVersion from 'shared/ReactVersion';
export {createPortal} from './ReactPortal';
export {
  createComponentSelector,
  createHasPseudoClassSelector,
  createRoleSelector,
  createTestNameSelector,
  createTextSelector,
  getFindAllNodesFailureDescription,
  findAllNodes,
  findBoundingRects,
  focusWithin,
  observeVisibleRects,
} from './ReactTestSelectors';
export {startHostTransition} from './ReactFiberHooks';
export {
  defaultOnUncaughtError,
  defaultOnCaughtError,
  defaultOnRecoverableError,
} from './ReactFiberErrorLogger';
import {getLabelForLane, TotalLanes} from 'react-reconciler/src/ReactFiberLane';
import {registerDefaultIndicator} from './ReactFiberAsyncAction';

/** 对宿主渲染器隐藏 FiberRoot 实现细节的容器句柄。 */
type OpaqueRoot = FiberRoot;

let didWarnAboutNestedUpdates;
let didWarnAboutFindNodeInStrictMode;

if (__DEV__) {
  didWarnAboutNestedUpdates = false;
  didWarnAboutFindNodeInStrictMode = {} as {
    /** 已按组件名输出 findHostInstance StrictMode 警告的集合。 */
    [string]: boolean
  };
}

/**
 * 取得挂载子树应继承的 legacy Context；父实例是 Provider 时先合并其 childContext。
 * 无父实例的 Root 使用稳定空对象。
 */
function getContextForSubtree(
  parentComponent: ?component(...props: any),
): Object {
  if (!parentComponent) {
    return emptyContextObject;
  }

  const fiber = getInstance(parentComponent);
  const parentContext = findCurrentUnmaskedContext(fiber);

  if (fiber.tag === ClassComponent) {
    const Component = fiber.type;
    if (isLegacyContextProvider(Component)) {
      return processChildContext(fiber, Component, parentContext);
    }
  }

  return parentContext;
}

/**
 * 从类组件实例映射到 current Fiber，再寻找首个宿主后代并返回 HostConfig 公开实例。
 * 未挂载组件与非 React 实例给出不同错误；无宿主输出时返回 null。
 */
function findHostInstance(component: Object): PublicInstance | null {
  const fiber = getInstance(component);
  if (fiber === undefined) {
    if (typeof component.render === 'function') {
      throw new Error('Unable to find node on an unmounted component.');
    } else {
      const keys = Object.keys(component).join(',');
      throw new Error(
        `Argument appears to not be a ReactComponent. Keys: ${keys}`,
      );
    }
  }
  const hostFiber = findCurrentHostFiber(fiber);
  if (hostFiber === null) {
    return null;
  }
  return getPublicInstance(hostFiber.stateNode);
}

/** findHostInstance 的 DEV 包装；StrictMode 中按组件名去重提示改用直接 ref。 */
function findHostInstanceWithWarning(
  component: Object,
  methodName: string,
): PublicInstance | null {
  if (__DEV__) {
    const fiber = getInstance(component);
    if (fiber === undefined) {
      if (typeof component.render === 'function') {
        throw new Error('Unable to find node on an unmounted component.');
      } else {
        const keys = Object.keys(component).join(',');
        throw new Error(
          `Argument appears to not be a ReactComponent. Keys: ${keys}`,
        );
      }
    }
    const hostFiber = findCurrentHostFiber(fiber);
    if (hostFiber === null) {
      return null;
    }
    if (hostFiber.mode & StrictLegacyMode) {
      const componentName = getComponentNameFromFiber(fiber) || 'Component';
      if (!didWarnAboutFindNodeInStrictMode[componentName]) {
        didWarnAboutFindNodeInStrictMode[componentName] = true;
        runWithFiberInDEV(hostFiber, () => {
          if (fiber.mode & StrictLegacyMode) {
            console.error(
              '%s is deprecated in StrictMode. ' +
                '%s was passed an instance of %s which is inside StrictMode. ' +
                'Instead, add a ref directly to the element you want to reference. ' +
                'Learn more about using refs safely here: ' +
                'https://react.dev/link/strict-mode-find-node',
              methodName,
              methodName,
              componentName,
            );
          } else {
            console.error(
              '%s is deprecated in StrictMode. ' +
                '%s was passed an instance of %s which renders StrictMode children. ' +
                'Instead, add a ref directly to the element you want to reference. ' +
                'Learn more about using refs safely here: ' +
                'https://react.dev/link/strict-mode-find-node',
              methodName,
              methodName,
              componentName,
            );
          }
        });
      }
    }
    return getPublicInstance(hostFiber.stateNode);
  }
  return findHostInstance(component);
}

/**
 * 创建非 hydration FiberRoot，安装错误/Transition callbacks 与默认 indicator。
 * 初始 child 为 null；实际 element 由随后 updateContainer 作为 Root Update 入队。
 * containerInfo 是 HostConfig 管理的目标容器；tag 决定 legacy/concurrent 根模式。
 * identifierPrefix 用于 useId，错误回调保存到根并在对应错误路径调用；这里只注册
 * onDefaultTransitionIndicator，不立即启动指示器。被忽略的兼容参数不改变更新优先级。
 */
export function createContainer(
  containerInfo: Container,
  tag: RootTag,
  hydrationCallbacks: null | SuspenseHydrationCallbacks,
  isStrictMode: boolean,
  // TODO：移除已被忽略的 concurrentUpdatesByDefaultOverride。
  concurrentUpdatesByDefaultOverride: null | boolean,
  identifierPrefix: string,
  onUncaughtError: (
    error: mixed,
    errorInfo: {
      /** 抛错 Fiber 的可选组件栈。 */
      +componentStack?: ?string
    },
  ) => void,
  onCaughtError: (
    error: mixed,
    errorInfo: {
      /** 抛错 Fiber 的可选组件栈。 */
      +componentStack?: ?string,
      /** 实际捕获错误的类边界实例。 */
      +errorBoundary?: ?component(...props: any),
    },
  ) => void,
  onRecoverableError: (
    error: mixed,
    errorInfo: {
      /** 恢复错误关联的可选组件栈。 */
      +componentStack?: ?string
    },
  ) => void,
  onDefaultTransitionIndicator: () => void | (() => void),
  transitionCallbacks: null | TransitionTracingCallbacks,
): OpaqueRoot {
  const hydrate = false;
  const initialChildren = null;
  const root = createFiberRoot(
    containerInfo,
    tag,
    hydrate,
    initialChildren,
    hydrationCallbacks,
    isStrictMode,
    identifierPrefix,
    null,
    onUncaughtError,
    onCaughtError,
    onRecoverableError,
    onDefaultTransitionIndicator,
    transitionCallbacks,
  );
  registerDefaultIndicator(onDefaultTransitionIndicator);
  return root;
}

/**
 * 创建以服务端 child/formState 为初值的 hydration FiberRoot，并调度首轮 hydration。
 * 初始 Update 仅携带 legacy callback，不含 element payload；车道提升为 hydration 专用优先级，
 * 使首轮必须与既有宿主结构匹配，而非按普通 Root 更新处理。
 * initialChildren 直接写入根初始 state，formState 留给服务端 Action/form 标记认领；
 * callback 是根更新的提交通知。enqueueUpdate 建立队列，scheduleInitialHydrationOnRoot
 * 登记根 pending lanes 并安排调度，这个入口本身不同步认领宿主节点。
 */
export function createHydrationContainer(
  initialChildren: ReactNodeList,
  // TODO：删除 legacy mode 时一并移除 callback。
  callback: ?Function,
  containerInfo: Container,
  tag: RootTag,
  hydrationCallbacks: null | SuspenseHydrationCallbacks,
  isStrictMode: boolean,
  // TODO：移除已被忽略的 concurrentUpdatesByDefaultOverride。
  concurrentUpdatesByDefaultOverride: null | boolean,
  identifierPrefix: string,
  onUncaughtError: (
    error: mixed,
    errorInfo: {
      /** 抛错 Fiber 的可选组件栈。 */
      +componentStack?: ?string
    },
  ) => void,
  onCaughtError: (
    error: mixed,
    errorInfo: {
      /** 抛错 Fiber 的可选组件栈。 */
      +componentStack?: ?string,
      /** 实际捕获错误的类边界实例。 */
      +errorBoundary?: ?component(...props: any),
    },
  ) => void,
  onRecoverableError: (
    error: mixed,
    errorInfo: {
      /** 恢复错误关联的可选组件栈。 */
      +componentStack?: ?string
    },
  ) => void,
  onDefaultTransitionIndicator: () => void | (() => void),
  transitionCallbacks: null | TransitionTracingCallbacks,
  formState: ReactFormState<any, any> | null,
): OpaqueRoot {
  const hydrate = true;
  const root = createFiberRoot(
    containerInfo,
    tag,
    hydrate,
    initialChildren,
    hydrationCallbacks,
    isStrictMode,
    identifierPrefix,
    formState,
    onUncaughtError,
    onCaughtError,
    onRecoverableError,
    onDefaultTransitionIndicator,
    transitionCallbacks,
  );

  registerDefaultIndicator(onDefaultTransitionIndicator);

  // TODO：移入 FiberRoot 构造器。
  root.context = getContextForSubtree(null);

  // 调度首轮 hydration。它不同于普通更新：必须匹配服务端输出。Update 刻意没有 payload，
  // 只用于调度 Root Fiber；LegacyRoot 还可承载可选 callback。
  const current = root.current;
  let lane = requestUpdateLane(current);
  lane = getBumpedLaneForHydrationByLane(lane);
  const update = createUpdate(lane);
  update.callback =
    callback !== undefined && callback !== null ? callback : null;
  enqueueUpdate(current, update, lane);
  startUpdateTimerByLane(lane, 'hydrateRoot()', null);
  scheduleInitialHydrationOnRoot(root, lane);

  return root;
}

/**
 * 为 Root element 请求当前优先级 Lane，构造 Root Update 并返回该 Lane。
 * parentComponent 仅用于继承 legacy Context。
 * 返回 lane 表示已选更新优先级，不表示该更新已经提交；callback 在更新提交后调用。
 */
export function updateContainer(
  element: ReactNodeList,
  container: OpaqueRoot,
  parentComponent: ?component(...props: any),
  callback: ?Function,
): Lane {
  const current = container.current;
  const lane = requestUpdateLane(current);
  updateContainerImpl(
    current,
    lane,
    element,
    container,
    parentComponent,
    callback,
  );
  return lane;
}

/**
 * 以 SyncLane 入队并调度 Root；这个函数本身不调用 flushSyncWork。
 * LegacyRoot 先冲刷 pending effects；renderer 通常在返回后另行冲刷同步工作。
 */
export function updateContainerSync(
  element: ReactNodeList,
  container: OpaqueRoot,
  parentComponent: ?component(...props: any),
  callback: ?Function,
): Lane {
  if (!disableLegacyMode && container.tag === LegacyRoot) {
    flushPendingEffects();
  }
  const current = container.current;
  updateContainerImpl(
    current,
    SyncLane,
    element,
    container,
    parentComponent,
    callback,
  );
  return SyncLane;
}

/**
 * Root render 的公共实现：登记 DevTools/Profiler 调度、更新 legacy Context，构造 `{element}`
 * Update 并入队，随后调度 FiberRoot 与纠缠 Transition。render 中嵌套调用在 DEV 警告。
 * rootFiber 是目标根的当前 Fiber；lane 由入口已选定，不在这里重新推断优先级。
 * container.context 首次写入，之后存到 pendingContext 由 HostRoot completeWork 接管；只有 enqueueUpdate
 * 找到仍连接的根时才启动计时、调度并纠缠。非法 callback 仅 DEV 警告，仍保存到更新。
 */
function updateContainerImpl(
  rootFiber: Fiber,
  lane: Lane,
  element: ReactNodeList,
  container: OpaqueRoot,
  parentComponent: ?component(...props: any),
  callback: ?Function,
): void {
  if (__DEV__) {
    onScheduleRoot(container, element);
  }

  if (enableSchedulingProfiler) {
    markRenderScheduled(lane);
  }

  const context = getContextForSubtree(parentComponent);
  if (container.context === null) {
    container.context = context;
  } else {
    container.pendingContext = context;
  }

  if (__DEV__) {
    if (
      ReactCurrentFiberIsRendering &&
      ReactCurrentFiberCurrent !== null &&
      !didWarnAboutNestedUpdates
    ) {
      didWarnAboutNestedUpdates = true;
      console.error(
        'Render methods should be a pure function of props and state; ' +
          'triggering nested component updates from render is not allowed. ' +
          'If necessary, trigger nested updates in componentDidUpdate.\n\n' +
          'Check the render method of %s.',
        getComponentNameFromFiber(ReactCurrentFiberCurrent) || 'Unknown',
      );
    }
  }

  const update = createUpdate(lane);
  // 注意：React DevTools 依赖此属性名必须是 "element"。
  update.payload = {element};

  callback = callback === undefined ? null : callback;
  if (callback !== null) {
    if (__DEV__) {
      if (typeof callback !== 'function') {
        console.error(
          'Expected the last optional `callback` argument to be a ' +
            'function. Instead received: %s.',
          callback,
        );
      }
    }
    update.callback = callback;
  }

  const root = enqueueUpdate(rootFiber, update, lane);
  if (root !== null) {
    startUpdateTimerByLane(lane, 'root.render()', null);
    scheduleUpdateOnFiber(root, rootFiber, lane);
    entangleTransitions(root, rootFiber, lane);
  }
}

export {
  batchedUpdates,
  deferredUpdates,
  discreteUpdates,
  flushSyncFromReconciler,
  flushSyncWork,
  isAlreadyRendering,
  flushPendingEffects as flushPassiveEffects,
};

/** 返回 Root 首个 child 的公开宿主实例；非宿主 child 直接返回其 stateNode。 */
export function getPublicRootInstance(
  container: OpaqueRoot,
): component(...props: any) | PublicInstance | null {
  const containerFiber = container.current;
  if (!containerFiber.child) {
    return null;
  }
  switch (containerFiber.child.tag) {
    case HostSingleton:
    case HostComponent:
      return getPublicInstance(containerFiber.child.stateNode);
    default:
      return containerFiber.child.stateNode;
  }
}

/**
 * 以同步优先级尝试 hydration：dehydrated Root 直接 flush 最高 pending lanes；Activity/
 * Suspense 则安排 SyncLane、冲刷，并提升未 hydration 边界的 retryLane。
 */
export function attemptSynchronousHydration(fiber: Fiber): void {
  switch (fiber.tag) {
    case HostRoot: {
      const root: FiberRoot = fiber.stateNode;
      if (isRootDehydrated(root)) {
        // 冲刷首个仅用于启动 hydration 的“update”。
        const lanes = getHighestPriorityPendingLanes(root);
        flushRoot(root, lanes);
      }
      break;
    }
    case ActivityComponent:
    case SuspenseComponent: {
      const root = enqueueConcurrentRenderForLane(fiber, SyncLane);
      if (root !== null) {
        scheduleUpdateOnFiber(root, fiber, SyncLane);
      }
      flushSyncWork();
      // 同步尝试后若仍阻塞，提升边界内 Promise 解析后的 retry 优先级。
      const retryLane = SyncLane;
      markRetryLaneIfNotHydrated(fiber, retryLane);
      break;
    }
  }
}

/** 若 Fiber 仍保存 dehydrated 状态，以更高优先级 Lane 更新其 retryLane。 */
function markRetryLaneImpl(fiber: Fiber, retryLane: Lane) {
  const suspenseState: null | SuspenseState | ActivityState =
    fiber.memoizedState;
  if (suspenseState !== null && suspenseState.dehydrated !== null) {
    suspenseState.retryLane = higherPriorityLane(
      suspenseState.retryLane,
      retryLane,
    );
  }
}

/** 同时更新 current/alternate 的 dehydrated retryLane，提升边界内 Thenable 解析后的重试。 */
function markRetryLaneIfNotHydrated(fiber: Fiber, retryLane: Lane) {
  markRetryLaneImpl(fiber, retryLane);
  const alternate = fiber.alternate;
  if (alternate) {
    markRetryLaneImpl(alternate, retryLane);
  }
}

/**
 * 连续事件触发时以 SelectiveHydrationLane 调度 Activity/Suspense，并提升其 retryLane。
 * HostRoot 无可增量提升的 I/O 挂起语义，因此忽略。
 */
export function attemptContinuousHydration(fiber: Fiber): void {
  if (fiber.tag !== SuspenseComponent && fiber.tag !== ActivityComponent) {
    // 忽略 HostRoot：其优先级无法这样提升，且可能 I/O 挂起的内容应包在 Suspense 内。
    return;
  }
  const lane = SelectiveHydrationLane;
  const root = enqueueConcurrentRenderForLane(fiber, lane);
  if (root !== null) {
    scheduleUpdateOnFiber(root, fiber, lane);
  }
  markRetryLaneIfNotHydrated(fiber, lane);
}

/**
 * 按当前事件请求 Lane，再提升为对应 hydration Lane 来调度 Activity/Suspense 边界。
 */
export function attemptHydrationAtCurrentPriority(fiber: Fiber): void {
  if (fiber.tag !== SuspenseComponent && fiber.tag !== ActivityComponent) {
    // 忽略 HostRoot：除同步 flush 外无法提升它的 hydration 优先级。
    return;
  }
  let lane = requestUpdateLane(fiber);
  lane = getBumpedLaneForHydrationByLane(lane);
  const root = enqueueConcurrentRenderForLane(fiber, lane);
  if (root !== null) {
    scheduleUpdateOnFiber(root, fiber, lane);
  }
  markRetryLaneIfNotHydrated(fiber, lane);
}

export {findHostInstance};

export {findHostInstanceWithWarning};

/** 查找 current Fiber 子树首个宿主实例，但不穿越 Portal 宿主树边界。 */
export function findHostInstanceWithNoPortals(
  fiber: Fiber,
): PublicInstance | null {
  const hostFiber = findCurrentHostFiberWithNoPortals(fiber);
  if (hostFiber === null) {
    return null;
  }
  return getPublicInstance(hostFiber.stateNode);
}

/** 测试/DevTools 可注入的 render 错误判定，默认不强制错误。 */
let shouldErrorImpl: Fiber => ?boolean = fiber => null;

/** 调用当前注入的错误判定器。 */
export function shouldError(fiber: Fiber): ?boolean {
  return shouldErrorImpl(fiber);
}

/** 测试/DevTools 可注入的 render 挂起判定，默认不强制挂起。 */
let shouldSuspendImpl = (fiber: Fiber) => false;

/** 调用当前注入的挂起判定器。 */
export function shouldSuspend(fiber: Fiber): boolean {
  return shouldSuspendImpl(fiber);
}

let overrideHookState = null;
let overrideHookStateDeletePath = null;
let overrideHookStateRenamePath = null;
let overrideProps = null;
let overridePropsDeletePath = null;
let overridePropsRenamePath = null;
let scheduleUpdate = null;
let scheduleRetry = null;
let setErrorHandler = null;
let setSuspenseHandler = null;

if (__DEV__) {
  /** 结构共享地删除对象/数组深层 path；沿途只克隆被访问的容器。 */
  const copyWithDeleteImpl = (
    obj: Object | Array<any>,
    path: Array<string | number>,
    index: number,
  ): $FlowFixMe => {
    const key = path[index];
    const updated = isArray(obj) ? obj.slice() : {...obj};
    if (index + 1 === path.length) {
      if (isArray(updated)) {
        updated.splice(key as any as number, 1);
      } else {
        delete updated[key];
      }
      return updated;
    }
    // $FlowFixMe[incompatible-use] number or string is fine here
    updated[key] = copyWithDeleteImpl(obj[key], path, index + 1);
    return updated;
  };

  /** 从根开始执行不可变深层删除。 */
  const copyWithDelete = (
    obj: Object | Array<any>,
    path: Array<string | number>,
  ): Object | Array<any> => {
    return copyWithDeleteImpl(obj, path, 0);
  };

  /** 结构共享地把同一父路径下的最深 key 重命名。 */
  const copyWithRenameImpl = (
    obj: Object | Array<any>,
    oldPath: Array<string | number>,
    newPath: Array<string | number>,
    index: number,
  ): $FlowFixMe => {
    const oldKey = oldPath[index];
    const updated = isArray(obj) ? obj.slice() : {...obj};
    if (index + 1 === oldPath.length) {
      const newKey = newPath[index];
      // $FlowFixMe[incompatible-use] number or string is fine here
      updated[newKey] = updated[oldKey];
      if (isArray(updated)) {
        updated.splice(oldKey as any as number, 1);
      } else {
        delete updated[oldKey];
      }
    } else {
      // $FlowFixMe[incompatible-use] number or string is fine here
      updated[oldKey] = copyWithRenameImpl(
        // $FlowFixMe[incompatible-use] number or string is fine here
        obj[oldKey],
        oldPath,
        newPath,
        index + 1,
      );
    }
    return updated;
  };

  /** 校验 old/new path 仅最深 key 不同，再执行不可变重命名。 */
  const copyWithRename = (
    obj: Object | Array<any>,
    oldPath: Array<string | number>,
    newPath: Array<string | number>,
  ): Object | Array<any> => {
    if (oldPath.length !== newPath.length) {
      console.warn('copyWithRename() expects paths of the same length');
      return;
    } else {
      for (let i = 0; i < newPath.length - 1; i++) {
        if (oldPath[i] !== newPath[i]) {
          console.warn(
            'copyWithRename() expects paths to be the same except for the deepest key',
          );
          return;
        }
      }
    }
    return copyWithRenameImpl(obj, oldPath, newPath, 0);
  };

  /** 结构共享地设置对象/数组深层 path；到达路径末端时替换为 value。 */
  const copyWithSetImpl = (
    obj: Object | Array<any>,
    path: Array<string | number>,
    index: number,
    value: any,
  ): $FlowFixMe => {
    if (index >= path.length) {
      return value;
    }
    const key = path[index];
    const updated = isArray(obj) ? obj.slice() : {...obj};
    // $FlowFixMe[incompatible-use] number or string is fine here
    updated[key] = copyWithSetImpl(obj[key], path, index + 1, value);
    return updated;
  };

  /** 从根开始执行不可变深层设置。 */
  const copyWithSet = (
    obj: Object | Array<any>,
    path: Array<string | number>,
    value: any,
  ): Object | Array<any> => {
    return copyWithSetImpl(obj, path, 0, value);
  };

  /** 按 stateful Hook 顺序下标遍历 Fiber.memoizedState 链。 */
  const findHook = (fiber: Fiber, id: number) => {
    // 当前 id 就是 stateful Hook 下标；未来嵌套 Hook 可能改变该身份模型。
    let currentHook = fiber.memoizedState;
    while (currentHook !== null && id > 0) {
      currentHook = currentHook.next;
      id--;
    }
    return currentHook;
  };

  /**
   * DEV 编辑指定 Hook 的嵌套 state：id 是 memoizedState 链下标，path 是属性/数组下标路径，
   * 空 path 直接替换整个 state。同步改写 memoizedState/baseState，浅克隆 props 绕过 bailout，
   * 再安排 SyncLane render；不生成 reducer action，也不清空现有 baseQueue。
   */
  overrideHookState = (
    fiber: Fiber,
    id: number,
    path: Array<string | number>,
    value: any,
  ) => {
    const hook = findHook(fiber, id);
    if (hook !== null) {
      const newState = copyWithSet(hook.memoizedState, path, value);
      hook.memoizedState = newState;
      hook.baseState = newState;

      // DevTools override 没有适用于任意 useReducer 的 action，不能真正向队列加 Update；
      // React 会把裸调度看作 no-op 并 bailout，因此浅克隆 props 绕过该检查。
      fiber.memoizedProps = {...fiber.memoizedProps};

      const root = enqueueConcurrentRenderForLane(fiber, SyncLane);
      if (root !== null) {
        scheduleUpdateOnFiber(root, fiber, SyncLane);
      }
    }
  };
  /** 删除指定 Hook state 的非空路径，沿访问链克隆容器；更新 memoizedState/baseState 后以 SyncLane 调度，旧更新队列仍保留。数组末端键按 splice 删除并移动后续下标。 */
  overrideHookStateDeletePath = (
    fiber: Fiber,
    id: number,
    path: Array<string | number>,
  ) => {
    const hook = findHook(fiber, id);
    if (hook !== null) {
      const newState = copyWithDelete(hook.memoizedState, path);
      hook.memoizedState = newState;
      hook.baseState = newState;

      // DevTools override 没有适用于任意 useReducer 的 action，不能真正入队；浅克隆 props
      // 绕过 no-op bailout，强制展示编辑后的 state。
      fiber.memoizedProps = {...fiber.memoizedProps};

      const root = enqueueConcurrentRenderForLane(fiber, SyncLane);
      if (root !== null) {
        scheduleUpdateOnFiber(root, fiber, SyncLane);
      }
    }
  };
  /** 编辑 Hook state 的最深键；old/new 路径必须等长且共享父路径，否则辅助函数警告并返回 undefined。本入口仍保存该返回值，不另做失败回滚；成功后的旧 baseQueue 也不会被清空。 */
  overrideHookStateRenamePath = (
    fiber: Fiber,
    id: number,
    oldPath: Array<string | number>,
    newPath: Array<string | number>,
  ) => {
    const hook = findHook(fiber, id);
    if (hook !== null) {
      const newState = copyWithRename(hook.memoizedState, oldPath, newPath);
      hook.memoizedState = newState;
      hook.baseState = newState;

      // DevTools override 没有适用于任意 useReducer 的 action，不能真正入队；浅克隆 props
      // 绕过 no-op bailout，强制展示编辑后的 state。
      fiber.memoizedProps = {...fiber.memoizedProps};

      const root = enqueueConcurrentRenderForLane(fiber, SyncLane);
      if (root !== null) {
        scheduleUpdateOnFiber(root, fiber, SyncLane);
      }
    }
  };

  /** DEV 编辑完整 memoizedProps 的指定路径，将结果同步写入两面的 pendingProps；不改已提交 memoizedProps，随后以 SyncLane 调度展示编辑结果。空路径可整体替换 props。 */
  overrideProps = (fiber: Fiber, path: Array<string | number>, value: any) => {
    fiber.pendingProps = copyWithSet(fiber.memoizedProps, path, value);
    if (fiber.alternate) {
      fiber.alternate.pendingProps = fiber.pendingProps;
    }
    const root = enqueueConcurrentRenderForLane(fiber, SyncLane);
    if (root !== null) {
      scheduleUpdateOnFiber(root, fiber, SyncLane);
    }
  };
  /** 从已提交 props 克隆并删除非空路径，给 current/alternate 设置同一 pendingProps，再安排同步 render；数组叶子用 splice 删除，兄弟属性仍结构共享。 */
  overridePropsDeletePath = (fiber: Fiber, path: Array<string | number>) => {
    fiber.pendingProps = copyWithDelete(fiber.memoizedProps, path);
    if (fiber.alternate) {
      fiber.alternate.pendingProps = fiber.pendingProps;
    }
    const root = enqueueConcurrentRenderForLane(fiber, SyncLane);
    if (root !== null) {
      scheduleUpdateOnFiber(root, fiber, SyncLane);
    }
  };
  /** 在 props 的相同父路径下改最深键，将辅助函数结果写到两面 pendingProps 并同步调度。路径校验失败时结果为 undefined，本入口不会取消后续调度。 */
  overridePropsRenamePath = (
    fiber: Fiber,
    oldPath: Array<string | number>,
    newPath: Array<string | number>,
  ) => {
    fiber.pendingProps = copyWithRename(fiber.memoizedProps, oldPath, newPath);
    if (fiber.alternate) {
      fiber.alternate.pendingProps = fiber.pendingProps;
    }
    const root = enqueueConcurrentRenderForLane(fiber, SyncLane);
    if (root !== null) {
      scheduleUpdateOnFiber(root, fiber, SyncLane);
    }
  };

  /** DEV 请求 Fiber 重新 render，不修改 props/state 或入队用户 Update；并发暂存仅标 lane，找到根后以 SyncLane 安排工作。 */
  scheduleUpdate = (fiber: Fiber) => {
    const root = enqueueConcurrentRenderForLane(fiber, SyncLane);
    if (root !== null) {
      scheduleUpdateOnFiber(root, fiber, SyncLane);
    }
  };

  /** DEV 请求一次边界重试，从循环分配器取 RetryLane 后标记 Fiber/祖先并调度根；不直接解决资源，也不在此冲刷工作。 */
  scheduleRetry = (fiber: Fiber) => {
    const lane = claimNextRetryLane();
    const root = enqueueConcurrentRenderForLane(fiber, lane);
    if (root !== null) {
      scheduleUpdateOnFiber(root, fiber, lane);
    }
  };

  /** 替换后续 render 使用的 DEV 错误判定器；按 Fiber 返回 true/false/null 的语义由 beginWork 消费，本函数不触发更新或包装用户异常。 */
  setErrorHandler = (newShouldErrorImpl: Fiber => ?boolean) => {
    shouldErrorImpl = newShouldErrorImpl;
  };

  /** 替换 DEV 挂起判定器供后续 Suspense render 查询；设置操作不触发 retry，判定器抛错也不在这里捕获。 */
  setSuspenseHandler = (newShouldSuspendImpl: Fiber => boolean) => {
    shouldSuspendImpl = newShouldSuspendImpl;
  };
}

/** DEV 下向 DevTools 暴露当前正在运行用户代码的 Fiber，用于 owner stack。 */
function getCurrentFiberForDevTools() {
  return ReactCurrentFiberCurrent;
}

/** 构造每个单 bit Lane 到调试名称的映射；Scheduling Profiler 关闭时返回 null。 */
function getLaneLabelMap(): Map<Lane, string> | null {
  if (enableSchedulingProfiler) {
    const map: Map<Lane, string> = new Map();

    let lane = 1;
    for (let index = 0; index < TotalLanes; index++) {
      const label = getLabelForLane(lane) as any as string;
      map.set(lane, label);
      lane *= 2;
    }

    return map;
  } else {
    return null;
  }
}

/**
 * 将渲染器版本、Dispatcher、可编辑 Hook/props、Refresh、错误/挂起注入点及可选 Profiler
 * hooks 注册到 DevTools，全量能力由构建 feature flags 决定。
 */
export function injectIntoDevTools(): boolean {
  const internals: Object = {
    bundleType: __DEV__ ? 1 : 0, // 后续可能增加 PROFILE 类型。
    version: rendererVersion,
    rendererPackageName: rendererPackageName,
    currentDispatcherRef: ReactSharedInternals,
    // 让 DevTools 检测 reconciler 版本；第三方 renderer 自身版本可能不匹配。
    reconcilerVersion: ReactVersion,
  };
  // $FlowFixMe[invalid-compare]
  if (extraDevToolsConfig !== null) {
    internals.rendererConfig = extraDevToolsConfig as RendererInspectionConfig;
  }
  if (__DEV__) {
    internals.overrideHookState = overrideHookState;
    internals.overrideHookStateDeletePath = overrideHookStateDeletePath;
    internals.overrideHookStateRenamePath = overrideHookStateRenamePath;
    internals.overrideProps = overrideProps;
    internals.overridePropsDeletePath = overridePropsDeletePath;
    internals.overridePropsRenamePath = overridePropsRenamePath;
    internals.scheduleUpdate = scheduleUpdate;
    internals.scheduleRetry = scheduleRetry;
    internals.setErrorHandler = setErrorHandler;
    internals.setSuspenseHandler = setSuspenseHandler;
    // React Refresh 能力。
    internals.scheduleRefresh = scheduleRefresh;
    internals.scheduleRoot = scheduleRoot;
    internals.setRefreshHandler = setRefreshHandler;
    // 让 DevTools 在 DEV 错误信息中附加 owner stack。
    internals.getCurrentFiber = getCurrentFiberForDevTools;
  }
  if (enableSchedulingProfiler) {
    // 仅构建支持 Timeline Profiler 时注入；DevTools 因而可按能力检测，而非绑定版本号，
    // 因为 profiling 与 timeline 由不同 feature flag 控制。
    internals.getLaneLabelMap = getLaneLabelMap;
    internals.injectProfilingHooks = injectProfilingHooks;
  }
  return injectInternals(internals);
}
