/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  ReactContext,
  StartTransitionOptions,
  Usable,
  Thenable,
  RejectedThenable,
  Awaited,
} from 'shared/ReactTypes';
import type {
  Fiber,
  FiberRoot,
  Dispatcher,
  HookType,
  MemoCache,
} from './ReactInternalTypes';
import type {Lanes, Lane} from './ReactFiberLane';
import type {HookFlags} from './ReactHookEffectTags';
import type {Flags} from './ReactFiberFlags';
import type {TransitionStatus} from './ReactFiberConfig';
import type {ScheduledGesture} from './ReactFiberGestureScheduler';

import {
  HostTransitionContext,
  NotPendingTransition as NoPendingHostTransition,
  setCurrentUpdatePriority,
  getCurrentUpdatePriority,
} from './ReactFiberConfig';
import ReactSharedInternals from 'shared/ReactSharedInternals';
import {
  enableSchedulingProfiler,
  enableTransitionTracing,
  enableLegacyCache,
  disableLegacyMode,
  enableNoCloningMemoCache,
  enableViewTransition,
  enableGestureTransition,
} from 'shared/ReactFeatureFlags';
import {
  REACT_CONTEXT_TYPE,
  REACT_RECOVERABLE_TYPE,
  REACT_MEMO_CACHE_SENTINEL,
} from 'shared/ReactSymbols';

import {
  NoMode,
  ConcurrentMode,
  StrictEffectsMode,
  StrictLegacyMode,
} from './ReactTypeOfMode';
import {
  NoLane,
  SyncLane,
  OffscreenLane,
  DeferredLane,
  NoLanes,
  isSubsetOfLanes,
  includesBlockingLane,
  includesOnlyNonUrgentLanes,
  mergeLanes,
  removeLanes,
  intersectLanes,
  isTransitionLane,
  markRootEntangled,
  includesSomeLane,
  isGestureRender,
  GestureLane,
  UpdateLanes,
} from './ReactFiberLane';
import {
  ContinuousEventPriority,
  higherEventPriority,
} from './ReactEventPriorities';
import {readContext, checkIfContextChanged} from './ReactFiberNewContext';
import {HostRoot, CacheComponent, HostComponent} from './ReactWorkTags';
import {
  LayoutStatic as LayoutStaticEffect,
  Passive as PassiveEffect,
  PassiveStatic as PassiveStaticEffect,
  StaticMask as StaticMaskEffect,
  Update as UpdateEffect,
  StoreConsistency,
  MountLayoutDev as MountLayoutDevEffect,
  MountPassiveDev as MountPassiveDevEffect,
  FormReset,
} from './ReactFiberFlags';
import {
  NoFlags as HookNoFlags,
  HasEffect as HookHasEffect,
  Layout as HookLayout,
  Passive as HookPassive,
  Insertion as HookInsertion,
} from './ReactHookEffectTags';
import {
  getWorkInProgressRoot,
  getWorkInProgressRootRenderLanes,
  scheduleUpdateOnFiber,
  requestUpdateLane,
  requestDeferredLane,
  markSkippedUpdateLanes,
  isInvalidExecutionContextForEventFunction,
} from './ReactFiberWorkLoop';

import getComponentNameFromFiber from 'react-reconciler/src/getComponentNameFromFiber';
import is from 'shared/objectIs';
import isArray from 'shared/isArray';
import {
  markWorkInProgressReceivedUpdate,
  checkIfWorkInProgressReceivedUpdate,
} from './ReactFiberBeginWork';
import {
  getIsHydrating,
  tryToClaimNextHydratableFormMarkerInstance,
} from './ReactFiberHydrationContext';
import {
  markStateUpdateScheduled,
  setIsStrictModeForDevtools,
} from './ReactFiberDevToolsHook';
import {
  startUpdateTimerByLane,
  startHostActionTimer,
} from './ReactProfilerTimer';
import {createCache} from './ReactFiberCacheComponent';
import {
  createUpdate as createLegacyQueueUpdate,
  enqueueUpdate as enqueueLegacyQueueUpdate,
  entangleTransitions as entangleLegacyQueueTransitions,
} from './ReactFiberClassUpdateQueue';
import {
  enqueueConcurrentHookUpdate,
  enqueueConcurrentHookUpdateAndEagerlyBailout,
  enqueueConcurrentRenderForLane,
} from './ReactFiberConcurrentUpdates';
import {getTreeId} from './ReactFiberTreeContext';
import {now} from './Scheduler';
import {
  trackUsedThenable,
  checkIfUseWrappedInTryCatch,
  checkIfUseWasUsedBefore,
  createThenableState,
  SuspenseException,
  SuspenseActionException,
} from './ReactFiberThenable';
import type {ThenableState} from './ReactFiberThenable';
import type {Transition} from 'react/src/ReactStartTransition';
import {
  peekEntangledActionLane,
  peekEntangledActionThenable,
  chainThenableValue,
} from './ReactFiberAsyncAction';
import {requestTransitionLane} from './ReactFiberRootScheduler';
import {isCurrentTreeHidden} from './ReactFiberHiddenContext';
import {requestCurrentTransition} from './ReactFiberTransition';

import {callComponentInDEV} from './ReactFiberCallUserSpace';

import {scheduleGesture} from './ReactFiberGestureScheduler';

/** Hook reducer 队列中的单个循环链表更新，携带 lane、动作及可选的 eager 结果。 */
export type Update<S, A> = {
  /** 本次更新参与调度与优先级比较的 lane。 */
  lane: Lane,
  /** 乐观更新需要回退时使用的 lane；普通更新为 NoLane。 */
  revertLane: Lane,
  /** 交给 reducer 计算下一状态的用户动作。 */
  action: A,
  /** 是否已在派发阶段提前计算 eagerState。 */
  hasEagerState: boolean,
  /** 派发阶段预计算的状态；仅在 hasEagerState 为 true 时有效。 */
  eagerState: S | null,
  /** 指向循环更新链表中的下一节点。 */
  next: Update<S, A>,
  /** 手势过渡调度信息；仅 enableGestureTransition 路径使用。 */
  gesture: null | ScheduledGesture, // enableGestureTransition
};

/** 某个 state/reducer Hook 的共享更新队列，在 current 与 work-in-progress Hook 间复用。 */
export type UpdateQueue<S, A> = {
  /** 尚未合并进 baseQueue 的循环更新链表尾节点。 */
  pending: Update<S, A> | null,
  /** 队列中已纠缠 transition 更新的 lane 集合。 */
  lanes: Lanes,
  /** 绑定当前 Fiber 与队列的稳定派发函数。 */
  dispatch: (A => mixed) | null,
  /** 最近一次队列处理记录的 reducer；useState 派发用它提前计算状态，useReducer 派发不走 eager 路径。 */
  lastRenderedReducer: ((S, A) => S) | null,
  /** 最近一次队列处理所得状态，供 useState 派发阶段提前计算；这些共享字段在 render 中写入。 */
  lastRenderedState: S | null,
};

let didWarnAboutMismatchedHooksForComponent;
let didWarnUncachedGetSnapshot: void | true;
let didWarnAboutUseWrappedInTryCatch;
let didWarnAboutAsyncClientComponent;
let didWarnAboutUseFormState;
if (__DEV__) {
  didWarnAboutMismatchedHooksForComponent = new Set<string | null>();
  didWarnAboutUseWrappedInTryCatch = new Set<string | null>();
  didWarnAboutAsyncClientComponent = new Set<string | null>();
  didWarnAboutUseFormState = new Set<string | null>();
}

/** Fiber.memoizedState 链表中的 Hook 节点，保存本 Hook 的状态、基线队列与共享队列。 */
export type Hook = {
  /** 当前渲染为该 Hook 计算出的记忆化状态。 */
  memoizedState: any,
  /** 跳过低优先级更新前可安全复用的基线状态。 */
  baseState: any,
  /** 尚未处理完、需要在后续 lane 重放的循环更新队列。 */
  baseQueue: Update<any, any> | null,
  /** 与 Hook 类型对应的共享队列或运行时辅助数据。 */
  queue: any,
  /** 指向组件 Hook 链表中的下一节点。 */
  next: Hook | null,
};

/**
 * 在副作用整个生命周期内保持同一引用的可变实例，作用类似 Rust 的 RefCell。
 *
 * @remarks
 * destroy 是副作用返回的有状态清理函数；副作用卸载或运行后没有清理函数时为 undefined。
 * 是否已挂载可由 Fiber 上方是否存在隐藏 Offscreen 推断，因此不另存布尔状态。
 * 单独对象会增加每个副作用的内存，但能让 current/work-in-progress Effect 共享清理状态。
 */
type EffectInstance = {
  /** 最近一次 create 返回的清理函数；未挂载或无清理逻辑时为空。 */
  destroy: void | (() => void),
};

/** 函数组件更新队列中的单个副作用节点，多个节点组成循环链表。 */
export type Effect = {
  /** 副作用种类及本次是否需要执行的 Hook 标志组合。 */
  tag: HookFlags,
  /** 跨 Effect 节点版本共享的可变生命周期实例。 */
  inst: EffectInstance,
  /** 提交阶段执行的创建函数，可返回卸载清理函数。 */
  create: () => (() => void) | void,
  /** 用于判断是否需要重新执行的依赖数组；null 表示每次执行。 */
  deps: Array<mixed> | void | null,
  /** 指向循环副作用链表中的下一节点。 */
  next: Effect,
};

/** useSyncExternalStore 在提交后持有的最新快照读取器与值。 */
type StoreInstance<T> = {
  /** 最近一次渲染确认的外部存储快照。 */
  value: T,
  /** 当前用于读取外部存储快照的函数。 */
  getSnapshot: () => T,
};

/** 并发提交前用于验证外部存储未撕裂的快照检查项。 */
type StoreConsistencyCheck<T> = {
  /** 渲染阶段读取并作为一致性基线的快照。 */
  value: T,
  /** 提交前重新读取快照的函数。 */
  getSnapshot: () => T,
};

/** useEffectEvent 更新队列中的实现替换记录。 */
type EventFunctionPayload<Args, Return, F: (...Array<Args>) => Return> = {
  /** 在各次渲染返回的事件包装器间共享当前实现的引用对象。 */
  ref: {
    /** 事件函数预留槽；当前 mountEvent/updateEvent 不在 ref 上缓存包装器。 */
    eventFn: F,
    /** 事件包装器调用时转发到的当前已提交实现。 */
    impl: F,
  },
  /** 本次提交后要写入 ref.impl 的新实现。 */
  nextImpl: F,
};

/** 函数组件 Fiber.updateQueue 的 Hook 专用形状，聚合副作用、事件、store 检查与 memo cache。 */
export type FunctionComponentUpdateQueue = {
  /** 循环副作用链表的尾节点。 */
  lastEffect: Effect | null,
  /** 待在提交阶段替换实现的 Effect Event 记录。 */
  events: Array<EventFunctionPayload<any, any, any>> | null,
  /** useSyncExternalStore 注册的提交前一致性检查。 */
  stores: Array<StoreConsistencyCheck<any>> | null,
  /** useMemoCache 使用的编译器记忆化槽位集合。 */
  memoCache: MemoCache | null,
};

/** useState 接受的直接值或基于旧状态计算新状态的函数。 */
type BasicStateAction<S> = (S => S) | S;

/** Hook 更新派发函数的公共形状。 */
type Dispatch<A> = A => void;

// 这些渲染状态会在调用组件前设置。
let renderLanes: Lanes = NoLanes;
// 当前正在渲染的 work-in-progress Fiber；名称特意与 work-in-progress Hook 区分。
let currentlyRenderingFiber: Fiber = null as any;

// Hook 以链表形式存放在 Fiber.memoizedState。currentHook 属于 current Fiber，
// workInProgressHook 属于本轮正在构建、最终会挂到 work-in-progress Fiber 的新链表。
let currentHook: Hook | null = null;
let workInProgressHook: Hook | null = null;

// 本次组件求值期间是否曾安排渲染阶段更新。重新渲染 pass 时不重置，组件完全求值后才清除，
// 以便抛错后快速判断是否需要清理渲染阶段更新。
let didScheduleRenderPhaseUpdate: boolean = false;
// 当前渲染 pass 是否安排了更新；每次尝试后重置。
// TODO：研究能否与 didScheduleRenderPhaseUpdate 或 numberOfReRenders 合并。
let didScheduleRenderPhaseUpdateDuringThisPass: boolean = false;
let shouldDoubleInvokeUserFnsInHooksDEV: boolean = false;
// 统计当前组件调用 useId 的次数。
let localIdCounter: number = 0;
// 统计当前组件通过 use 消费的 thenable 数量。
let thenableIndexCounter: number = 0;
let thenableState: ThenableState | null = null;

// 为完全在客户端（非水合）生成的 ID 提供全局序号，因此客户端 ID 在不同渲染尝试间不稳定。
let globalClientIdCounter: number = 0;

/** 单次组件求值允许的渲染阶段重渲染上限，用于阻止无限循环。 */
const RE_RENDER_LIMIT = 25;

// DEV 下当前正在执行的原始 Hook 名称。
let currentHookNameInDev: ?HookType = null;

// DEV 下记录首次挂载的 Hook 调用顺序，后续更新据此验证调用顺序保持一致。
let hookTypesDev: Array<HookType> | null = null;
let hookTypesUpdateIndexDev: number = -1;

// DEV 热更新期间若组件需要忽略 useEffect/useMemo 等 Hook 的旧依赖，则强制把它们视为重新挂载。
let ignorePreviousDependencies: boolean = false;

/** DEV 挂载阶段记录当前原始 Hook 名称，建立后续更新的顺序基线。 */
function mountHookTypesDev(): void {
  if (__DEV__) {
    const hookName = currentHookNameInDev as any as HookType;

    if (hookTypesDev === null) {
      hookTypesDev = [hookName];
    } else {
      hookTypesDev.push(hookName);
    }
  }
}

/** DEV 更新阶段推进 Hook 顺序索引，并在名称不匹配时报告规则违规。 */
function updateHookTypesDev(): void {
  if (__DEV__) {
    const hookName = currentHookNameInDev as any as HookType;

    if (hookTypesDev !== null) {
      hookTypesUpdateIndexDev++;
      if (hookTypesDev[hookTypesUpdateIndexDev] !== hookName) {
        warnOnHookMismatchInDev(hookName);
      }
    }
  }
}

/** DEV 挂载阶段验证依赖参数为数组，避免每次更新重复承担检查成本。 */
function checkDepsAreArrayDev(deps: mixed): void {
  if (__DEV__) {
    if (deps !== undefined && deps !== null && !isArray(deps)) {
      // 只在挂载时验证 deps 以避免额外开销；它通常内联定义，类型不太可能在更新间改变。
      console.error(
        '%s received a final argument that is not an array (instead, received `%s`). When ' +
          'specified, the final argument must be an array.',
        currentHookNameInDev,
        typeof deps,
      );
    }
  }
}

/** DEV 下输出前后两次渲染的 Hook 顺序差异表，并确保每个组件只警告一次。 */
function warnOnHookMismatchInDev(currentHookName: HookType): void {
  if (__DEV__) {
    const componentName = getComponentNameFromFiber(currentlyRenderingFiber);
    if (!didWarnAboutMismatchedHooksForComponent.has(componentName)) {
      didWarnAboutMismatchedHooksForComponent.add(componentName);

      if (hookTypesDev !== null) {
        let table = '';

        const secondColumnStart = 30;

        for (let i = 0; i <= (hookTypesUpdateIndexDev as any as number); i++) {
          const oldHookName = hookTypesDev[i];
          const newHookName =
            i === (hookTypesUpdateIndexDev as any as number)
              ? currentHookName
              : oldHookName;

          let row = `${i + 1}. ${oldHookName}`;

          // 补空格使第二列对齐；兼容不支持 String#repeat 的旧 IE。
          while (row.length < secondColumnStart) {
            row += ' ';
          }

          row += newHookName + '\n';

          table += row;
        }

        console.error(
          'React has detected a change in the order of Hooks called by %s. ' +
            'This will lead to bugs and errors if not fixed. ' +
            'For more information, read the Rules of Hooks: https://react.dev/link/rules-of-hooks\n\n' +
            '   Previous render            Next render\n' +
            '   ------------------------------------------------------\n' +
            '%s' +
            '   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n',
          componentName,
          table,
        );
      }
    }
  }
}

/** DEV 下提示 useFormState 已更名为 useActionState，并按组件去重警告。 */
function warnOnUseFormStateInDev(): void {
  if (__DEV__) {
    const componentName = getComponentNameFromFiber(currentlyRenderingFiber);
    if (!didWarnAboutUseFormState.has(componentName)) {
      didWarnAboutUseFormState.add(componentName);

      console.error(
        'ReactDOM.useFormState has been renamed to React.useActionState. ' +
          'Please update %s to use React.useActionState.',
        componentName,
      );
    }
  }
}

/** DEV 下识别原生 async 客户端组件并发出更具针对性的错误提示。 */
function warnIfAsyncClientComponent(Component: Function) {
  if (__DEV__) {
    // 此 DEV 检查只能识别原生 async 函数，不能识别转译后的函数。生产环境另有防崩溃检查，
    // 可覆盖转译后的 async 函数；两种机制都非绝对可靠，但组合后覆盖最常见场景。
    const isAsyncFunction =
      // $FlowFixMe[method-unbinding]
      Object.prototype.toString.call(Component) === '[object AsyncFunction]' ||
      // $FlowFixMe[method-unbinding]
      Object.prototype.toString.call(Component) ===
        '[object AsyncGeneratorFunction]';
    if (isAsyncFunction) {
      // 遇到尚不受支持的 async 客户端组件。
      const componentName = getComponentNameFromFiber(currentlyRenderingFiber);
      if (!didWarnAboutAsyncClientComponent.has(componentName)) {
        didWarnAboutAsyncClientComponent.add(componentName);
        console.error(
          '%s is an async Client Component. ' +
            'Only Server Components can be async at the moment. This error is often caused by accidentally ' +
            "adding `'use client'` to a module that was originally written " +
            'for the server.',
          componentName === null
            ? 'An unknown Component'
            : `<${componentName}>`,
        );
      }
    }
  }
}

/** 为组件渲染上下文之外的 Hook 调用抛出统一规则错误。 */
function throwInvalidHookError() {
  throw new Error(
    'Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for' +
      ' one of the following reasons:\n' +
      '1. You might have mismatching versions of React and the renderer (such as React DOM)\n' +
      '2. You might be breaking the Rules of Hooks\n' +
      '3. You might have more than one copy of React in the same app\n' +
      'See https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem.',
  );
}

/** 以 Object.is 比较 deps 共同长度内各项；null 的旧 deps 或 DEV 热更新强制视为变化。DEV 会警告长度不同但仍继续比较共同前缀，因此函数不负责在异常长度下强制返回 false；调用方须保持依赖数组长度与顺序稳定。 */
function areHookInputsEqual(
  nextDeps: Array<mixed>,
  prevDeps: Array<mixed> | null,
): boolean {
  if (__DEV__) {
    if (ignorePreviousDependencies) {
      // 仅热更新当前组件时为 true，此时强制视为依赖变化。
      return false;
    }
  }

  if (prevDeps === null) {
    if (__DEV__) {
      console.error(
        '%s received a final argument during this render, but not during ' +
          'the previous render. Even though the final argument is optional, ' +
          'its type cannot change between renders.',
        currentHookNameInDev,
      );
    }
    return false;
  }

  if (__DEV__) {
    // 依赖数组应内联传入；生产环境省略长度检查以避免额外开销。
    if (nextDeps.length !== prevDeps.length) {
      console.error(
        'The final argument passed to %s changed size between renders. The ' +
          'order and size of this array must remain constant.\n\n' +
          'Previous: %s\n' +
          'Incoming: %s',
        currentHookNameInDev,
        `[${prevDeps.join(', ')}]`,
        `[${nextDeps.join(', ')}]`,
      );
    }
  }
  // $FlowFixMe[incompatible-use] found when upgrading Flow
  for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
    // $FlowFixMe[incompatible-use] found when upgrading Flow
    if (is(nextDeps[i], prevDeps[i])) {
      continue;
    }
    return false;
  }
  return true;
}

/** BeginWork 在函数组件求值前设置 renderLanes/当前 Fiber，清空 WIP Hook 链和提交列表，再按 current.memoizedState 选择 mount/update dispatcher。第二参数用于 ForwardRef 等调用协议；有状态 Hook 占 memoizedState 链，context/use 不占。渲染阶段更新走额外 pass，DEV StrictLegacyMode 再执行组件但复用首遍状态，正常结束统一恢复 dispatcher；挂起保留重放信息，由 WorkLoop 决定 replay 或 unwind。 */
export function renderWithHooks<Props, SecondArg>(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: (p: Props, arg: SecondArg) => any,
  props: Props,
  secondArg: SecondArg,
  nextRenderLanes: Lanes,
): any {
  renderLanes = nextRenderLanes;
  currentlyRenderingFiber = workInProgress;

  if (__DEV__) {
    hookTypesDev =
      current !== null
        ? (current._debugHookTypes as any as Array<HookType>)
        : null;
    hookTypesUpdateIndexDev = -1;
    // 热更新时组件类型变化，需要忽略旧依赖。
    ignorePreviousDependencies =
      current !== null && current.type !== workInProgress.type;

    warnIfAsyncClientComponent(Component);
  }

  workInProgress.memoizedState = null;
  workInProgress.updateQueue = null;
  workInProgress.lanes = NoLanes;

  // 以下状态在进入这里前应已重置；保留注释代码用于明确入口不变量。
  // currentHook = null;
  // workInProgressHook = null;

  // didScheduleRenderPhaseUpdate = false;
  // localIdCounter = 0;
  // thenableIndexCounter = 0;
  // thenableState = null;

  // TODO：挂载时完全未用 Hook、更新时才使用时应警告。目前 memoizedState === null 会把更新识别为挂载；
  // 但某些组件类型（例如 React.lazy）合法地具有该形状，因此判断并不简单。

  // 只有至少使用一个有状态 Hook 时，memoizedState 才能区分挂载与更新。
  // context 等无状态 Hook 不进入 memoizedState，因此挂载和更新时它都可能为 null。
  if (__DEV__) {
    if (current !== null && current.memoizedState !== null) {
      ReactSharedInternals.H = HooksDispatcherOnUpdateInDEV;
    } else if (hookTypesDev !== null) {
      // 处理“组件正在更新但未使用有状态 Hook”的边界：行为与生产环境的 Mount dispatcher 一致，
      // 同时额外执行 DEV Hook 顺序验证。
      ReactSharedInternals.H = HooksDispatcherOnMountWithHookTypesInDEV;
    } else {
      ReactSharedInternals.H = HooksDispatcherOnMountInDEV;
    }
  } else {
    ReactSharedInternals.H =
      current === null || current.memoizedState === null
        ? HooksDispatcherOnMount
        : HooksDispatcherOnUpdate;
  }

  // DEV Strict Mode 会双调用用户函数以发现副作用，Hook 组件的处理需要保持以下不变量。
  //
  // 整个组件函数执行两次，但第二次复用第一次的 Hook 状态。因此 useMemo 等函数因依赖匹配
  // 会复用记忆化结果，不会自然再次执行。
  //
  // 为让记忆化函数也执行两次，用户函数只在组件第一次执行期间双调用，第二次不再双调用：
  //
  // - 第一次执行组件函数：用户函数双调用；
  // - DEV Strict Mode 的第二次执行：用户函数不双调用。
  //
  // 这一顺序尤其服务于 use 挂起路径：use 会复用首次尝试传入的 Promise，本身就是记忆化。
  // useMemo 等 Hook 必须能记忆化 use 的响应式输入，因此输入与输出必须来自同一次组件执行。
  //
  // 相关测试覆盖了这一双调用与复用行为。
  const shouldDoubleRenderDEV =
    __DEV__ && (workInProgress.mode & StrictLegacyMode) !== NoMode;

  shouldDoubleInvokeUserFnsInHooksDEV = shouldDoubleRenderDEV;
  let children = __DEV__
    ? callComponentInDEV(Component, props, secondArg)
    : Component(props, secondArg);
  shouldDoubleInvokeUserFnsInHooksDEV = false;

  // 若发生渲染阶段更新，持续重渲染直到组件状态稳定。
  if (didScheduleRenderPhaseUpdateDuringThisPass) {
    children = renderWithHooksAgain(
      workInProgress,
      Component,
      props,
      secondArg,
    );
  }

  if (shouldDoubleRenderDEV) {
    // DEV 下再次调用组件以帮助发现副作用。
    setIsStrictModeForDevtools(true);
    try {
      children = renderWithHooksAgain(
        workInProgress,
        Component,
        props,
        secondArg,
      );
    } finally {
      setIsStrictModeForDevtools(false);
    }
  }

  finishRenderingHooks(current, workInProgress, Component);

  return children;
}

/**
 * 完成 Hook 渲染：保存 DEV 调试状态、恢复 ContextOnlyDispatcher 并清空模块级游标。
 *
 * @remarks 还会检测 Hook 数量不足、静态标志漂移、context 更新及 use 被 try/catch 包裹等错误边界。
 */
function finishRenderingHooks<Props, SecondArg>(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: (p: Props, arg: SecondArg) => any,
): void {
  if (__DEV__) {
    workInProgress._debugHookTypes = hookTypesDev;
    // 保存 thenable 状态供 DevTools 读取。
    if (workInProgress.dependencies === null) {
      if (thenableState !== null) {
        workInProgress.dependencies = {
          lanes: NoLanes,
          firstContext: null,
          _debugThenableState: thenableState,
        };
      }
    } else {
      workInProgress.dependencies._debugThenableState = thenableState;
    }
    checkIfUseWasUsedBefore(workInProgress, thenableState);
  }

  // 渲染入口设置 dispatcher 且本阶段不可重入，因此可以直接恢复为 ContextOnlyDispatcher。
  ReactSharedInternals.H = ContextOnlyDispatcher;

  // 使用 currentHook 检查可让 DEV 与生产构建行为一致；hookTypesDev 虽能捕获 context 等更多情况，
  // 但只存在于 DEV 构建。
  const didRenderTooFewHooks =
    currentHook !== null && currentHook.next !== null;

  renderLanes = NoLanes;
  currentlyRenderingFiber = null as any;

  currentHook = null;
  workInProgressHook = null;

  if (__DEV__) {
    currentHookNameInDev = null;
    hookTypesDev = null;
    hookTypesUpdateIndexDev = -1;

    // 确认静态标志自上次渲染后未被增删；若触发，说明其他代码错误重置了静态标志，
    // SuspenseList 实现曾出现过此类问题。
    if (
      current !== null &&
      (current.flags & StaticMaskEffect) !==
        (workInProgress.flags & StaticMaskEffect) &&
      // Legacy Suspense 会产生误报，因此 Legacy 模式禁用此警告。若要支持，需要标记以不完整状态
      // 提交的 Fiber；而相关真实问题要么只存在于并发模式，要么两种模式都有，禁用不会掩盖主要信号。
      (disableLegacyMode || (current.mode & ConcurrentMode) !== NoMode)
    ) {
      console.error(
        'Internal React error: Expected static flag was missing. Please ' +
          'notify the React team.',
      );
    }
  }

  didScheduleRenderPhaseUpdate = false;
  // localIdCounter 由 checkDidRenderIdHook 重置。
  // localIdCounter = 0;

  thenableIndexCounter = 0;
  thenableState = null;

  if (didRenderTooFewHooks) {
    throw new Error(
      'Rendered fewer hooks than expected. This may be caused by an accidental ' +
        'early return statement.',
    );
  }

  if (current !== null) {
    if (!checkIfWorkInProgressReceivedUpdate()) {
      // props 与 state 都未变化时仍需检查 context。依赖与 Hook 并非严格一一对应，故此前未检查；
      // 常见路径虽近似一一对应（readContext 是内部 API），但这里只在其他条件都 bailout 后到达，
      // 将比较留在冷路径可减少常见路径成本。
      const currentDependencies = current.dependencies;
      if (
        currentDependencies !== null &&
        checkIfContextChanged(currentDependencies)
      ) {
        markWorkInProgressReceivedUpdate();
      }
    }
  }

  if (__DEV__) {
    if (checkIfUseWrappedInTryCatch()) {
      const componentName =
        getComponentNameFromFiber(workInProgress) || 'Unknown';
      if (
        !didWarnAboutUseWrappedInTryCatch.has(componentName) &&
        // async 组件内用 use 挂起也会触发此警告；上方已有专门警告，这里抑制重复输出。
        !didWarnAboutAsyncClientComponent.has(componentName)
      ) {
        didWarnAboutUseWrappedInTryCatch.add(componentName);
        console.error(
          '`use` was called from inside a try/catch block. This is not allowed ' +
            'and can lead to unexpected behavior. To handle errors triggered ' +
            'by `use`, wrap your component in a error boundary.',
        );
      }
    }
  }
}

/**
 * 数据解决后重放先前挂起的 Hook 组件，复用挂起时保留的模块级渲染状态。
 *
 * @remarks 与 renderWithHooks 相比省略入口初始化，但会清空 updateQueue，确保卸载副作用正确重建。
 */
export function replaySuspendedComponentWithHooks<Props, SecondArg>(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: (p: Props, arg: SecondArg) => any,
  props: Props,
  secondArg: SecondArg,
): any {
  // 挂起时大部分入口状态不会重置；只有组件完成（finishRenderingHooks）或 unwind
  //（resetHooksOnUnwind）时才清理，因此重放可直接复用。
  if (__DEV__) {
    hookTypesUpdateIndexDev = -1;
    // 热更新时组件类型变化，需要忽略旧依赖。
    ignorePreviousDependencies =
      current !== null && current.type !== workInProgress.type;
  }
  // 普通 rerender pass 会重置 updateQueue 的临时列表并保留 memo cache；Suspense 重放则
  // 清空整个 updateQueue，再根据重放路径重新登记 Effect，避免沿用挂起前未完成的提交列表。
  workInProgress.updateQueue = null;
  const children = renderWithHooksAgain(
    workInProgress,
    Component,
    props,
    secondArg,
  );
  finishRenderingHooks(current, workInProgress, Component);
  return children;
}

/** 渲染阶段更新、Strict Mode 再调用或 Suspense replay 的额外求值循环：复用 WIP Hook 节点并重置 effect/event/store 列表及 memo cache 索引。新 render-phase 更新时重置 thenableState，最多允许 25 个此循环 pass；该局部上限不同于跨组件/提交的 nested-update 检测。 */
function renderWithHooksAgain<Props, SecondArg>(
  workInProgress: Fiber,
  Component: (p: Props, arg: SecondArg) => any,
  props: Props,
  secondArg: SecondArg,
): any {
  // 前一 pass 已处理的状态更新不会重复处理，useMemo 等记忆化函数也尽可能不再调用。

  currentlyRenderingFiber = workInProgress;

  let numberOfReRenders: number = 0;
  let children;
  do {
    if (didScheduleRenderPhaseUpdateDuringThisPass) {
      // use() 的值可能依赖本次重渲染更新的状态，因此清空 thenableState 以重新跟踪 thenable。
      thenableState = null;
    }
    thenableIndexCounter = 0;
    didScheduleRenderPhaseUpdateDuringThisPass = false;

    if (numberOfReRenders >= RE_RENDER_LIMIT) {
      throw new Error(
        'Too many re-renders. React limits the number of renders to prevent ' +
          'an infinite loop.',
      );
    }

    numberOfReRenders += 1;
    if (__DEV__) {
      // 即使热更新，也在首次渲染后允许依赖稳定，防止渲染阶段无限更新。
      ignorePreviousDependencies = false;
    }

    // 从 Hook 链表起点重新开始。
    currentHook = null;
    workInProgressHook = null;

    if (workInProgress.updateQueue != null) {
      resetFunctionComponentUpdateQueue(workInProgress.updateQueue as any);
    }

    if (__DEV__) {
      // 级联更新也要重新验证 Hook 顺序。
      hookTypesUpdateIndexDev = -1;
    }

    ReactSharedInternals.H = __DEV__
      ? HooksDispatcherOnRerenderInDEV
      : HooksDispatcherOnRerender;

    children = __DEV__
      ? callComponentInDEV(Component, props, secondArg)
      : Component(props, secondArg);
  } while (didScheduleRenderPhaseUpdateDuringThisPass);
  return children;
}

/** 通过完整 Hook 渲染入口求值 transition-aware 宿主组件的当前状态。 */
export function renderTransitionAwareHostComponentWithHooks(
  current: Fiber | null,
  workInProgress: Fiber,
  lanes: Lanes,
): TransitionStatus {
  return renderWithHooks(
    current,
    workInProgress,
    TransitionAwareHostComponent,
    null,
    null,
    lanes,
  );
}

/** 消费宿主 transition thenable，并在 reset state 变化时为当前 Fiber 标记表单重置。 */
export function TransitionAwareHostComponent(): TransitionStatus {
  const dispatcher: any = ReactSharedInternals.H;
  const [maybeThenable] = dispatcher.useState();
  let nextState;
  if (typeof maybeThenable.then === 'function') {
    const thenable: Thenable<TransitionStatus> = maybeThenable as any;
    nextState = useThenable(thenable);
  } else {
    const status: TransitionStatus = maybeThenable;
    nextState = status;
  }

  // reset state 是对象；引用变化表示有逻辑请求重置表单。
  const [nextResetState] = dispatcher.useState();
  const prevResetState =
    currentHook !== null ? currentHook.memoizedState : null;
  if (prevResetState !== nextResetState) {
    // 安排表单重置。
    currentlyRenderingFiber.flags |= FormReset;
  }

  return nextState;
}

/** 在 renderWithHooks 后读取并重置 useId 计数，返回本轮是否调用过 useId。 */
export function checkDidRenderIdHook(): boolean {
  // 概念上它属于 renderWithHooks 的返回值；拆为单独函数只是为了避免数组元组。
  const didRenderIdHook = localIdCounter !== 0;
  localIdCounter = 0;
  return didRenderIdHook;
}

/** 在组件 bailout 时复用 current 更新队列、清除本轮副作用标志并消费已完成 lanes。 */
export function bailoutHooks(
  current: Fiber,
  workInProgress: Fiber,
  lanes: Lanes,
): void {
  workInProgress.updateQueue = current.updateQueue;
  // TODO：complete 阶段的 bubbleProperties 会重置标志，这里可能无需再次清除。
  if (__DEV__ && (workInProgress.mode & StrictEffectsMode) !== NoMode) {
    workInProgress.flags &= ~(
      MountPassiveDevEffect |
      MountLayoutDevEffect |
      PassiveEffect |
      UpdateEffect
    );
  } else {
    workInProgress.flags &= ~(PassiveEffect | UpdateEffect);
  }
  current.lanes = removeLanes(current.lanes, lanes);
}

/** 抛错后立即撤销渲染上下文，但保留可能供工作循环无 rewind 重放的其余模块状态。 */
export function resetHooksAfterThrow(): void {
  // 这里只恢复 dispatcher 等调用边界，防止组件外调用 Hook；不能清空可能用于重放的全部状态。
  currentlyRenderingFiber = null as any;

  // 渲染入口设置 dispatcher 且本阶段不可重入，因此可直接恢复为 ContextOnlyDispatcher。
  ReactSharedInternals.H = ContextOnlyDispatcher;
}

/** unwind 放弃本次 Hook 渲染，移除仅本轮有效的渲染阶段更新并重置所有模块级游标。 */
export function resetHooksOnUnwind(workInProgress: Fiber): void {
  if (didScheduleRenderPhaseUpdate) {
    // 渲染阶段更新只对正在放弃的本轮有效，必须从已处理 Hook 队列中移除，不能泄漏到下次渲染。
    // 尚未处理的 Hook 更新在进入渲染前已安排，不应删除。
    //
    // 只有已克隆的队列才代表本轮处理过；未克隆队列中的更新来自渲染前。
    let hook: Hook | null = workInProgress.memoizedState;
    while (hook !== null) {
      const queue = hook.queue;
      if (queue !== null) {
        queue.pending = null;
      }
      hook = hook.next;
    }
    didScheduleRenderPhaseUpdate = false;
  }

  renderLanes = NoLanes;
  currentlyRenderingFiber = null as any;

  currentHook = null;
  workInProgressHook = null;

  if (__DEV__) {
    hookTypesDev = null;
    hookTypesUpdateIndexDev = -1;

    currentHookNameInDev = null;
  }

  didScheduleRenderPhaseUpdateDuringThisPass = false;
  localIdCounter = 0;
  thenableIndexCounter = 0;
  thenableState = null;
}

/** 创建并追加挂载阶段的 Hook 节点，维护 Fiber.memoizedState 链表头与尾游标。 */
function mountWorkInProgressHook(): Hook {
  const hook: Hook = {
    memoizedState: null,

    baseState: null,
    baseQueue: null,
    queue: null,

    next: null,
  };

  if (workInProgressHook === null) {
    // 首个 Hook 同时成为 Fiber.memoizedState 与 workInProgressHook。
    currentlyRenderingFiber.memoizedState = workInProgressHook = hook;
  } else {
    // 追加到 Hook 链表尾部。
    workInProgressHook = workInProgressHook.next = hook;
  }
  return workInProgressHook;
}

/**
 * 更新或渲染阶段重渲染时取得下一个 work-in-progress Hook，优先复用前一 pass 节点，否则克隆 current。
 *
 * @remarks Hook 顺序必须与 current 链一致；current 耗尽时继续调用会判定为 Hook 数量增加。
 */
function updateWorkInProgressHook(): Hook {
  let nextCurrentHook: null | Hook;
  if (currentHook === null) {
    const current = currentlyRenderingFiber.alternate;
    if (current !== null) {
      nextCurrentHook = current.memoizedState;
    } else {
      nextCurrentHook = null;
    }
  } else {
    nextCurrentHook = currentHook.next;
  }

  let nextWorkInProgressHook: null | Hook;
  if (workInProgressHook === null) {
    nextWorkInProgressHook = currentlyRenderingFiber.memoizedState;
  } else {
    nextWorkInProgressHook = workInProgressHook.next;
  }

  if (nextWorkInProgressHook !== null) {
    // 前一 render pass 已创建 work-in-progress Hook，直接复用。
    workInProgressHook = nextWorkInProgressHook;
    nextWorkInProgressHook = workInProgressHook.next;

    currentHook = nextCurrentHook;
  } else {
    // 没有可复用节点，从 current Hook 克隆。

    if (nextCurrentHook === null) {
      const currentFiber = currentlyRenderingFiber.alternate;
      if (currentFiber === null) {
        // 初次渲染挂起后恢复却又调用了额外 Hook 时可能到达；正常情况应先切换到 mount dispatcher。
        throw new Error(
          'Update hook called on initial render. This is likely a bug in React. Please file an issue.',
        );
      } else {
        // 更新路径理应始终存在对应 current Hook。
        throw new Error('Rendered more hooks than during the previous render.');
      }
    }

    currentHook = nextCurrentHook;

    const newHook: Hook = {
      memoizedState: currentHook.memoizedState,

      baseState: currentHook.baseState,
      baseQueue: currentHook.baseQueue,
      queue: currentHook.queue,

      next: null,
    };

    if (workInProgressHook === null) {
      // 这是链表中的首个 Hook。
      currentlyRenderingFiber.memoizedState = workInProgressHook = newHook;
    } else {
      // 追加到链表尾部。
      workInProgressHook = workInProgressHook.next = newHook;
    }
  }
  return workInProgressHook;
}

/** 创建空的函数组件更新队列，供副作用、事件、store 检查和 memo cache 按需填充。 */
function createFunctionComponentUpdateQueue(): FunctionComponentUpdateQueue {
  return {
    lastEffect: null,
    events: null,
    stores: null,
    memoCache: null,
  };
}

/** 重渲染前清空本 pass 的副作用、事件与 store 检查，同时保留可跨 pass 复用的 memo cache 数据。 */
function resetFunctionComponentUpdateQueue(
  updateQueue: FunctionComponentUpdateQueue,
): void {
  updateQueue.lastEffect = null;
  updateQueue.events = null;
  updateQueue.stores = null;
  if (updateQueue.memoCache != null) {
    // 有意不重置 memoCache.data。把 memo cache 放在 updateQueue 可避免为无需缓存的 Fiber 增加尺寸，
    // 但重置其他临时属性时仍应保留缓存内容，只把读取索引归零。
    updateQueue.memoCache.index = 0;
  }
}

/** 以当前 Fiber 内的稳定调用序号跟踪 thenable，并在挂起重放跨过旧 Hook 尾部时切回常规 dispatcher。 */
function useThenable<T>(thenable: Thenable<T>): T {
  // 跟踪 thenable 在当前 Fiber 中的位置。
  const index = thenableIndexCounter;
  thenableIndexCounter += 1;
  if (thenableState === null) {
    thenableState = createThenableState();
  }
  const result = trackUsedThenable(
    thenableState,
    thenable,
    index,
    __DEV__ ? currentlyRenderingFiber : null,
  );

  // use 导致挂起后会用 rerender dispatcher 重放组件，而不是 mount/update dispatcher。
  //
  // 若挂起的 use 之后还有额外 Hook，它们在前次尝试中尚未处理。再次执行 use 后，
  // 可能需要从 rerender dispatcher 切回 mount/update dispatcher，以下逻辑处理该边界。
  //
  // TODO：理论上只需放进 rerender dispatcher；可以优化，但收益可能有限。

  // 与 updateWorkInProgressHook 使用相同的下一 Hook 判断。
  const workInProgressFiber = currentlyRenderingFiber;
  const nextWorkInProgressHook =
    workInProgressHook === null
      ? // 当前位于链表起点，从 Fiber 读取首个 Hook。
        workInProgressFiber.memoizedState
      : workInProgressHook.next;

  if (nextWorkInProgressHook !== null) {
    // 前次尝试仍有 Hook 未消费，继续保持 rerender 模式。
  } else {
    // 前次尝试的 Hook 已消费完，退出 rerender 模式并切换到常规 mount/update dispatcher。
    //
    // 分派逻辑与 renderWithHooks 相同，但这里不再跟踪 Hook 类型调试信息；只在未挂起时记录已足够。
    const currentFiber = workInProgressFiber.alternate;
    if (__DEV__) {
      if (currentFiber !== null && currentFiber.memoizedState !== null) {
        ReactSharedInternals.H = HooksDispatcherOnUpdateInDEV;
      } else {
        ReactSharedInternals.H = HooksDispatcherOnMountInDEV;
      }
    } else {
      ReactSharedInternals.H =
        currentFiber === null || currentFiber.memoizedState === null
          ? HooksDispatcherOnMount
          : HooksDispatcherOnUpdate;
    }
  }
  return result;
}

/** 实现 use：消费 thenable、穿透 recoverable 边界或读取 React context，并拒绝其他输入。 */
function use<T>(usable: Usable<T>): T {
  // $FlowFixMe[invalid-compare]
  if (usable !== null && typeof usable === 'object') {
    // $FlowFixMe[method-unbinding]
    if (typeof usable.then === 'function') {
      // thenable 交给挂起跟踪路径处理。
      const thenable: Thenable<T> = usable as any;
      return useThenable(thenable);
    } else if (usable.$$typeof === REACT_RECOVERABLE_TYPE) {
      // Fiber 已是最终渲染器，没有下游宿主需要恢复该子树，继续穿透渲染。
      return undefined as any;
    } else if (usable.$$typeof === REACT_CONTEXT_TYPE) {
      const context: ReactContext<T> = usable as any;
      return readContext(context);
    }
  }

  // eslint-disable-next-line react-internal/safe-string-coercion
  throw new Error('An unsupported type was passed to use(): ' + String(usable));
}

/** React Compiler 的第 size 个固定容量槽位：按 memoCache.index 取得数组，首次填 sentinel 后推进索引。普通更新复制 current 的各槽位数组；enableNoCloningMemoCache 共享数据依赖编译器输入/输出原子写入，可复用中断尝试结果。rerender 只重置索引保留数据；DEV 热更新重新分配，容量变化仅警告且返回旧数组，不自动 resize。 */
function useMemoCache(size: number): Array<mixed> {
  let memoCache = null;
  // 快路径：若 work-in-progress Fiber 已准备缓存，直接读取。
  let updateQueue: FunctionComponentUpdateQueue | null =
    currentlyRenderingFiber.updateQueue as any;
  if (updateQueue !== null) {
    memoCache = updateQueue.memoCache;
  }
  // 否则从 current Fiber 克隆或共享缓存。
  if (memoCache == null) {
    const current: Fiber | null = currentlyRenderingFiber.alternate;
    if (current !== null) {
      const currentUpdateQueue: FunctionComponentUpdateQueue | null =
        current.updateQueue as any;
      if (currentUpdateQueue !== null) {
        const currentMemoCache: ?MemoCache = currentUpdateQueue.memoCache;
        if (currentMemoCache != null) {
          memoCache = {
            // enableNoCloningMemoCache 启用时，不再像 Fiber 一样按写时复制，
            // 而是在所有渲染尝试间共享同一缓存，即使组件提交前被中断。
            //
            // 更新因挂起或其他更新而中断时，可复用前次尝试的记忆化结果。
            // React Compiler 会原子写入缓存：不会只记录输入而不同时记录输出，因此共享是安全的。
            //
            // 这为组件与 Hook 提供了一种内部“恢复执行”能力。
            //
            // 该能力只适用于已挂载组件的更新。首次渲染时缓存存于 Fiber，而 Fiber 尚不支持恢复，
            // 因而始终是全新缓存。
            //
            // 即便如此，它仍覆盖 Suspense 驱动应用（如 RSC 或 Relay）中 action 后用新数据更新 UI
            // 这一常见场景。
            data: enableNoCloningMemoCache
              ? currentMemoCache.data
              : // 每次渲染前按写时复制克隆 memo cache。
                currentMemoCache.data.map(array => array.slice()),
            index: 0 as number,
          };
        }
      }
    }
  }
  // current 也没有缓存时，分配全新实例。
  if (memoCache == null) {
    memoCache = {
      data: [],
      index: 0 as number,
    };
  }
  if (updateQueue === null) {
    updateQueue = createFunctionComponentUpdateQueue();
    currentlyRenderingFiber.updateQueue = updateQueue;
  }
  updateQueue.memoCache = memoCache;

  let data = memoCache.data[memoCache.index];
  if (data === undefined || (__DEV__ && ignorePreviousDependencies)) {
    data = memoCache.data[memoCache.index] = new Array(size);
    for (let i = 0; i < size; i++) {
      data[i] = REACT_MEMO_CACHE_SENTINEL;
    }
  } else if (data.length !== size) {
    // TODO：考虑在这里警告或抛错。
    if (__DEV__) {
      console.error(
        'Expected a constant size argument for each invocation of useMemoCache. ' +
          'The previous cache was allocated with size %s but size %s was requested.',
        data.length,
        size,
      );
    }
  }
  memoCache.index++;
  return data;
}

/** useState 的基础 reducer：函数 action 接收旧状态，其他 action 直接成为新状态。 */
function basicStateReducer<S>(state: S, action: BasicStateAction<S>): S {
  // $FlowFixMe[incompatible-use]: Flow doesn't like mixed types
  return typeof action === 'function' ? action(state) : action;
}

/** 挂载 reducer Hook：计算初始状态、创建共享队列并绑定稳定 dispatch。 */
function mountReducer<S, I, A>(
  reducer: (S, A) => S,
  initialArg: I,
  init?: I => S,
): [S, Dispatch<A>] {
  const hook = mountWorkInProgressHook();
  let initialState;
  if (init !== undefined) {
    initialState = init(initialArg);
    if (shouldDoubleInvokeUserFnsInHooksDEV) {
      setIsStrictModeForDevtools(true);
      try {
        init(initialArg);
      } finally {
        setIsStrictModeForDevtools(false);
      }
    }
  } else {
    initialState = initialArg as any as S;
  }
  hook.memoizedState = hook.baseState = initialState;
  const queue: UpdateQueue<S, A> = {
    pending: null,
    lanes: NoLanes,
    dispatch: null,
    lastRenderedReducer: reducer,
    lastRenderedState: initialState as any,
  };
  hook.queue = queue;
  const dispatch: Dispatch<A> = (queue.dispatch = dispatchReducerAction.bind(
    null,
    currentlyRenderingFiber,
    queue,
  ) as any);
  return [hook.memoizedState, dispatch];
}

/** 更新 reducer Hook：取得对应 Hook 节点并交给队列重放实现。 */
function updateReducer<S, I, A>(
  reducer: (S, A) => S,
  initialArg: I,
  init?: I => S,
): [S, Dispatch<A>] {
  const hook = updateWorkInProgressHook();
  return updateReducerImpl(hook, currentHook as any as Hook, reducer);
}

/** 按当前渲染 lanes 重放 Hook 状态队列：pending/base 都以尾节点表示环，交换首链后以 pending 为新尾，且先写 current.baseQueue 再清 pending，保证尝试中断也不丢入队更新。首个跳过项前状态成为新 baseState；之后已处理普通项以 NoLane 克隆以保持重放顺序。乐观项保留到 revertLane 被渲染，隐藏更新按根 lanes 比较；仅当最终状态变化且消费纠缠 action 时才抛未完成 action thenable。 */
function updateReducerImpl<S, A>(
  hook: Hook,
  current: Hook,
  reducer: (S, A) => S,
): [S, Dispatch<A>] {
  const queue = hook.queue;

  if (queue === null) {
    throw new Error(
      'Should have a queue. You are likely calling Hooks conditionally, ' +
        'which is not allowed. (https://react.dev/link/invalid-hook-call)',
    );
  }

  queue.lastRenderedReducer = reducer;

  // 最后一个尚未纳入 baseState、需要 rebase 的更新。
  let baseQueue = hook.baseQueue;

  // 尚未处理的 pending 循环队列尾节点。
  const pendingQueue = queue.pending;
  if (pendingQueue !== null) {
    // 将新到达的 pending 更新拼接进 baseQueue。
    if (baseQueue !== null) {
      // 交换两个循环链表的首节点连接，以 O(1) 合并队列。
      const baseFirst = baseQueue.next;
      const pendingFirst = pendingQueue.next;
      baseQueue.next = pendingFirst;
      pendingQueue.next = baseFirst;
    }
    if (__DEV__) {
      if (current.baseQueue !== baseQueue) {
        // 此内部不变量目前不应失败；未来若实现恢复渲染，队列克隆方式可能需要调整。
        console.error(
          'Internal error: Expected work-in-progress queue to be a clone. ' +
            'This is a bug in React.',
        );
      }
    }
    current.baseQueue = baseQueue = pendingQueue;
    queue.pending = null;
  }

  const baseState = hook.baseState;
  if (baseQueue === null) {
    // 无待处理更新时 memoizedState 应等于 baseState；目前只有 useOptimistic 会让两者分离，
    // 因为它每次渲染都接受新的 baseState。
    hook.memoizedState = baseState;
    // baseState 来自其他响应式值，无需调用 markWorkInProgressReceivedUpdate。
  } else {
    // 从 baseState 开始依序重放循环队列。
    const first = baseQueue.next;
    let newState = baseState;

    let newBaseState = null;
    let newBaseQueueFirst = null;
    let newBaseQueueLast: Update<S, A> | null = null;
    let update = first;
    let didReadFromEntangledAsyncAction = false;
    do {
      // 隐藏树内产生的更新会额外带 OffscreenLane，以区别于树隐藏前已存在的更新。
      const updateLane = removeLanes(update.lane, OffscreenLane);
      const isHiddenUpdate = updateLane !== update.lane;

      // 隐藏期间产生的更新不是 base 更新，判断优先级时应忽略进入 Offscreen 树时附加到 renderLanes
      // 的额外基线 lane，改用根的实际渲染 lanes。
      let shouldSkipUpdate = isHiddenUpdate
        ? !isSubsetOfLanes(getWorkInProgressRootRenderLanes(), updateLane)
        : !isSubsetOfLanes(renderLanes, updateLane);

      if (enableGestureTransition && updateLane === GestureLane) {
        // 手势乐观更新只在渲染 GestureLane 且正在处理其关联 ScheduledGesture 时计入状态。
        const scheduledGesture = update.gesture;
        if (scheduledGesture !== null) {
          if (scheduledGesture.count === 0 && !scheduledGesture.committing) {
            // 手势已取消，可直接清理该更新。
            update = update.next;
            continue;
          } else if (!isGestureRender(renderLanes)) {
            shouldSkipUpdate = true;
          } else {
            const root: FiberRoot | null = getWorkInProgressRoot();
            if (root === null) {
              throw new Error(
                'Expected a work-in-progress root. This is a bug in React. Please file an issue.',
              );
            }
            // 假定当前渲染的手势位于根 pendingGestures 队首。
            shouldSkipUpdate = root.pendingGestures !== scheduledGesture;
          }
        }
      }

      if (shouldSkipUpdate) {
        // 优先级不足，跳过此更新。若它是首个被跳过项，之前所得状态成为新的 baseState。
        const clone: Update<S, A> = {
          lane: updateLane,
          revertLane: update.revertLane,
          gesture: update.gesture,
          action: update.action,
          hasEagerState: update.hasEagerState,
          eagerState: update.eagerState,
          next: null as any,
        };
        if (newBaseQueueLast === null) {
          newBaseQueueFirst = newBaseQueueLast = clone;
          newBaseState = newState;
        } else {
          newBaseQueueLast = newBaseQueueLast.next = clone;
        }
        // 记录队列剩余优先级。
        // TODO：无需累积；可从原 lanes 中移除 renderLanes。
        currentlyRenderingFiber.lanes = mergeLanes(
          currentlyRenderingFiber.lanes,
          updateLane,
        );
        markSkippedUpdateLanes(updateLane);
      } else {
        // 此更新优先级足够，可以处理。

        // revertLane 区分普通更新与需要随 transition 回退的乐观更新。
        const revertLane = update.revertLane;
        if (revertLane === NoLane) {
          // 普通更新现在即可应用；若前面跳过过更新，仍需把它以 NoLane 克隆进新队列，
          // 以便后续从同一顺序 rebase。
          if (newBaseQueueLast !== null) {
            const clone: Update<S, A> = {
              // 该更新即将提交，不能在后续 rebase 中撤销。NoLane（0）是所有位掩码的子集，
              // 因而不会再被上方优先级检查跳过。
              lane: NoLane,
              revertLane: NoLane,
              gesture: null,
              action: update.action,
              hasEagerState: update.hasEagerState,
              eagerState: update.eagerState,
              next: null as any,
            };
            newBaseQueueLast = newBaseQueueLast.next = clone;
          }

          // 若更新属于待完成 async action，稍后需挂起直到 action 完成，
          // 从而与同一 action 中未来更新保持同一批次。
          if (updateLane === peekEntangledActionLane()) {
            didReadFromEntangledAsyncAction = true;
          }
        } else {
          // 乐观更新在 revertLane 优先级足够时应被视为已回退，不再应用；否则应用但保留在队列，
          // 供后续渲染回退或 rebase。
          if (isSubsetOfLanes(renderLanes, revertLane)) {
            // 关联 transition 已结束，跳过该更新，相当于它从未存在。
            update = update.next;

            // 若 revert 也属于待完成 async action，稍后挂起以维持 action 批次边界。
            if (revertLane === peekEntangledActionLane()) {
              didReadFromEntangledAsyncAction = true;
            }
            continue;
          } else {
            const clone: Update<S, A> = {
              // 乐观更新提交后，在关联 transition（由 revertLane 表示）完成前不能撤销。
              // lane 设为 NoLane 可确保普通优先级检查不会跳过它。
              lane: NoLane,
              // 保留同一 revertLane，以识别 transition 何时完成。
              revertLane: update.revertLane,
              gesture: null, // 一旦提交，就不再视为手势更新。
              action: update.action,
              hasEagerState: update.hasEagerState,
              eagerState: update.eagerState,
              next: null as any,
            };
            if (newBaseQueueLast === null) {
              newBaseQueueFirst = newBaseQueueLast = clone;
              newBaseState = newState;
            } else {
              newBaseQueueLast = newBaseQueueLast.next = clone;
            }
            // 记录队列剩余的回退优先级。
            // TODO：无需累积；可从原 lanes 中移除 renderLanes。
            currentlyRenderingFiber.lanes = mergeLanes(
              currentlyRenderingFiber.lanes,
              revertLane,
            );
            markSkippedUpdateLanes(revertLane);
          }
        }

        // 应用更新；DEV 双调用仅用于检测 reducer 副作用，结果仍只采用一次。
        const action = update.action;
        if (shouldDoubleInvokeUserFnsInHooksDEV) {
          reducer(newState, action);
        }
        if (update.hasEagerState) {
          // state 更新已在派发阶段 eager 计算，可直接复用结果而无需再次调用 reducer。
          newState = update.eagerState as any as S;
        } else {
          newState = reducer(newState, action);
        }
      }
      update = update.next;
      // $FlowFixMe[invalid-compare]
    } while (update !== null && update !== first);

    if (newBaseQueueLast === null) {
      newBaseState = newState;
    } else {
      newBaseQueueLast.next = newBaseQueueFirst as any;
    }

    // 只有新状态与当前记忆化状态不同，才标记 Fiber 确实执行了工作。
    if (!is(newState, hook.memoizedState)) {
      markWorkInProgressReceivedUpdate();

      // 若读取了纠缠 async action 的更新，需要挂起到 action 完成，使同一 action 的未来更新保持同批。
      // TODO：支持在 useMemo 或 Forget 等记忆化边界内使用 Hook 后，应把逻辑提升到边界外，
      // 只在边界产生新值时挂起。
      if (didReadFromEntangledAsyncAction) {
        const entangledActionThenable = peekEntangledActionThenable();
        if (entangledActionThenable !== null) {
          // TODO：不要直接抛 thenable；像 use 一样抛特殊对象，以检测是否被用户代码捕获。
          throw entangledActionThenable;
        }
      }
    }

    hook.memoizedState = newState;
    hook.baseState = newBaseState;
    hook.baseQueue = newBaseQueueLast;

    queue.lastRenderedState = newState;
  }

  if (baseQueue === null) {
    // queue.lanes 用于纠缠 transition；队列清空后可重置为 NoLanes。
    queue.lanes = NoLanes;
  }

  const dispatch: Dispatch<A> = queue.dispatch as any;
  return [hook.memoizedState, dispatch];
}

/** 在同一组件求值的额外 render pass 中应用渲染阶段 reducer 更新，不再进行 lane 优先级判断。 */
function rerenderReducer<S, I, A>(
  reducer: (S, A) => S,
  initialArg: I,
  init?: I => S,
): [S, Dispatch<A>] {
  const hook = updateWorkInProgressHook();
  const queue = hook.queue;

  if (queue === null) {
    throw new Error(
      'Should have a queue. You are likely calling Hooks conditionally, ' +
        'which is not allowed. (https://react.dev/link/invalid-hook-call)',
    );
  }

  queue.lastRenderedReducer = reducer;

  // 把新产生的渲染阶段更新应用到前一 pass 的 work-in-progress Hook。
  const dispatch: Dispatch<A> = queue.dispatch as any;
  const lastRenderPhaseUpdate = queue.pending;
  let newState = hook.memoizedState;
  if (lastRenderPhaseUpdate !== null) {
    // 渲染阶段队列不会跨越当前 pass。
    queue.pending = null;

    const firstRenderPhaseUpdate = lastRenderPhaseUpdate.next;
    let update = firstRenderPhaseUpdate;
    do {
      // 渲染阶段更新与当前渲染优先级相同，无需再检查 lane。
      const action = update.action;
      newState = reducer(newState, action);
      update = update.next;
    } while (update !== firstRenderPhaseUpdate);

    // 只有新状态不同才标记 Fiber 执行了工作。
    if (!is(newState, hook.memoizedState)) {
      markWorkInProgressReceivedUpdate();
    }

    hook.memoizedState = newState;
    // 除非 baseQueue 为空，否则不把渲染阶段更新累积出的状态持久化为 baseState。
    // TODO：需确认这是否是理想语义；当前与 gDSFP 的处理保持一致。
    if (hook.baseQueue === null) {
      hook.baseState = newState;
    }

    queue.lastRenderedState = newState;
  }
  return [newState, dispatch];
}

/** 挂载时以 getServerSnapshot 读取 hydration 基线，否则调用 getSnapshot；hydrate 缺少服务端读取器会抛错转客户端恢复。非 hydration 且根 lanes 不含 blocking lane 时登记 StoreConsistency，WorkLoop 提交前可复读。passive 阶段订阅并发布 inst，通知只在 Object.is 值变化或读取抛错时派发 SyncLane；subscribe 返回的取消订阅交给 effect cleanup。 */
function mountSyncExternalStore<T>(
  subscribe: (() => void) => () => void,
  getSnapshot: () => T,
  getServerSnapshot?: () => T,
): T {
  const fiber = currentlyRenderingFiber;
  const hook = mountWorkInProgressHook();

  let nextSnapshot;
  const isHydrating = getIsHydrating();
  if (isHydrating) {
    if (getServerSnapshot === undefined) {
      throw new Error(
        'Missing getServerSnapshot, which is required for ' +
          'server-rendered content. Will revert to client rendering.',
      );
    }
    nextSnapshot = getServerSnapshot();
    if (__DEV__) {
      if (!didWarnUncachedGetSnapshot) {
        if (nextSnapshot !== getServerSnapshot()) {
          console.error(
            'The result of getServerSnapshot should be cached to avoid an infinite loop',
          );
          didWarnUncachedGetSnapshot = true;
        }
      }
    }
  } else {
    nextSnapshot = getSnapshot();
    if (__DEV__) {
      if (!didWarnUncachedGetSnapshot) {
        const cachedSnapshot = getSnapshot();
        if (!is(nextSnapshot, cachedSnapshot)) {
          console.error(
            'The result of getSnapshot should be cached to avoid an infinite loop',
          );
          didWarnUncachedGetSnapshot = true;
        }
      }
    }
    // 非阻塞 lane 需要安排一致性检查；提交前遍历树，确认存储在渲染后未发生变更。
    //
    // 水合服务端内容时不做此检查：陈旧内容已经可见，只能在被动副作用中修正。
    const root: FiberRoot | null = getWorkInProgressRoot();

    if (root === null) {
      throw new Error(
        'Expected a work-in-progress root. This is a bug in React. Please file an issue.',
      );
    }

    const rootRenderLanes = getWorkInProgressRootRenderLanes();
    if (!includesBlockingLane(rootRenderLanes)) {
      pushStoreConsistencyCheck(fiber, getSnapshot, nextSnapshot);
    }
  }

  // 每次渲染都直接读取当前快照，虽打破常规 React 规则，但外部存储更新始终同步，因此可行。
  hook.memoizedState = nextSnapshot;
  const inst: StoreInstance<T> = {
    value: nextSnapshot,
    getSnapshot,
  };
  hook.queue = inst;

  // 安排被动副作用订阅外部存储。
  mountEffect(subscribeToStore.bind(null, fiber, inst, subscribe), [subscribe]);

  // 安排副作用更新可变实例字段；subscribe、getSnapshot 或 value 变化时都会刷新。
  // 此副作用无清理函数且依赖已准确跟踪，可直接 pushEffect，无需额外 Hook 状态或静态标志。
  fiber.flags |= PassiveEffect;
  pushSimpleEffect(
    HookHasEffect | HookPassive,
    createEffectInstance(),
    updateStoreInstance.bind(null, fiber, inst, nextSnapshot, getSnapshot),
    null,
  );

  return nextSnapshot;
}

/** 更新时再次读取水合/客户端快照并以 Object.is 标记变化，订阅 effect 仅由 subscribe 引用变化触发。getSnapshot/value/订阅变化时安排 passive 更新 inst，并在非 hydration、非 blocking 渲染中登记一致性检查；即使不变化也保留无 HasEffect 的检查 effect，Activity reconnect 时仍可复查隐藏期间的 store 变化。 */
function updateSyncExternalStore<T>(
  subscribe: (() => void) => () => void,
  getSnapshot: () => T,
  getServerSnapshot?: () => T,
): T {
  const fiber = currentlyRenderingFiber;
  const hook = updateWorkInProgressHook();
  // 每次渲染都直接读取当前快照；这依赖外部存储更新始终同步。
  let nextSnapshot;
  const isHydrating = getIsHydrating();
  if (isHydrating) {
    // Strict Mode 双渲染需要使用相同服务端快照入口。
    if (getServerSnapshot === undefined) {
      throw new Error(
        'Missing getServerSnapshot, which is required for ' +
          'server-rendered content. Will revert to client rendering.',
      );
    }
    nextSnapshot = getServerSnapshot();
  } else {
    nextSnapshot = getSnapshot();
    if (__DEV__) {
      if (!didWarnUncachedGetSnapshot) {
        const cachedSnapshot = getSnapshot();
        if (!is(nextSnapshot, cachedSnapshot)) {
          console.error(
            'The result of getSnapshot should be cached to avoid an infinite loop',
          );
          didWarnUncachedGetSnapshot = true;
        }
      }
    }
  }
  const prevSnapshot = (currentHook || hook).memoizedState;
  const snapshotChanged = !is(prevSnapshot, nextSnapshot);
  if (snapshotChanged) {
    hook.memoizedState = nextSnapshot;
    markWorkInProgressReceivedUpdate();
  }
  const inst = hook.queue;

  updateEffect(subscribeToStore.bind(null, fiber, inst, subscribe), [
    subscribe,
  ]);

  // getSnapshot 或 subscribe 变化时，提交阶段必须检查是否发生交错变更。
  // 并发模式经常出现；同步模式下较早的副作用也可能修改存储。
  const storeChanged =
    inst.getSnapshot !== getSnapshot ||
    snapshotChanged ||
    // 通过上方是否安排了订阅副作用判断 subscribe 是否变化，避免另存比较状态。
    (workInProgressHook !== null &&
      (workInProgressHook.memoizedState.tag & HookHasEffect) !== HookNoFlags);

  // 即使本轮没有变化，也把副作用保留在链表中，使隐藏 Activity 树重新显示、被动副作用重连时复查。
  // 树隐藏期间没有订阅者，期间变更不会通知任何人；若显示时组件未重渲染或早于变更渲染，
  // 只有该复查能发现差异。无变化时不加 HasEffect，普通提交会跳过执行。
  pushSimpleEffect(
    storeChanged ? HookHasEffect | HookPassive : HookPassive,
    createEffectInstance(),
    updateStoreInstance.bind(null, fiber, inst, nextSnapshot, getSnapshot),
    null,
  );

  if (storeChanged) {
    fiber.flags |= PassiveEffect;

    // 非阻塞 lane 安排提交前一致性检查，确认渲染后存储未发生变更。
    const root: FiberRoot | null = getWorkInProgressRoot();

    if (root === null) {
      throw new Error(
        'Expected a work-in-progress root. This is a bug in React. Please file an issue.',
      );
    }

    if (!isHydrating && !includesBlockingLane(renderLanes)) {
      pushStoreConsistencyCheck(fiber, getSnapshot, nextSnapshot);
    }
  }

  return nextSnapshot;
}

/** 把外部存储快照检查加入函数组件更新队列，并为 Fiber 标记 StoreConsistency。 */
function pushStoreConsistencyCheck<T>(
  fiber: Fiber,
  getSnapshot: () => T,
  renderedSnapshot: T,
): void {
  fiber.flags |= StoreConsistency;
  const check: StoreConsistencyCheck<T> = {
    getSnapshot,
    value: renderedSnapshot,
  };
  let componentUpdateQueue: null | FunctionComponentUpdateQueue =
    currentlyRenderingFiber.updateQueue as any;
  if (componentUpdateQueue === null) {
    componentUpdateQueue = createFunctionComponentUpdateQueue();
    currentlyRenderingFiber.updateQueue = componentUpdateQueue as any;
    componentUpdateQueue.stores = [check];
  } else {
    const stores = componentUpdateQueue.stores;
    if (stores === null) {
      componentUpdateQueue.stores = [check];
    } else {
      stores.push(check);
    }
  }
}

/** 被动阶段提交最新快照读取器和值，并补检 render/commit 间的交错存储变更。 */
function updateStoreInstance<T>(
  fiber: Fiber,
  inst: StoreInstance<T>,
  nextSnapshot: T,
  getSnapshot: () => T,
): void {
  // 在被动阶段发布最新实例字段。
  inst.value = nextSnapshot;
  inst.getSnapshot = getSnapshot;

  // render 与 commit 之间可能由被动副作用前触发的事件或布局副作用修改存储；此前 bailout 使用的是
  // 旧快照与读取器，因此必须再检查一次。隐藏 Activity 树重新显示时也会重跑此副作用。
  if (checkIfSnapshotChanged(inst)) {
    // 强制重渲染；这是内部一致性修正而非外部触发，故不记录更新时间与调用栈。
    forceStoreRerender(fiber);
  }
}

/** 建立外部存储订阅，并在通知到达且快照实际变化时安排同步重渲染。 */
function subscribeToStore<T>(
  fiber: Fiber,
  inst: StoreInstance<T>,
  subscribe: (() => void) => () => void,
): any {
  /** 存储通知回调：复读快照，过滤值未变化的通知。 */
  const handleStoreChange = () => {
    // 检查快照自上次读取后是否实际变化。
    if (checkIfSnapshotChanged(inst)) {
      // 使用 SyncLane 强制重渲染。
      startUpdateTimerByLane(SyncLane, 'updateSyncExternalStore()', fiber);
      forceStoreRerender(fiber);
    }
  };
  // 返回存储提供的取消订阅函数，交给 Effect 清理阶段调用。
  return subscribe(handleStoreChange);
}

/** 安全复读 StoreInstance 快照；读取抛错也视为变化，以触发渲染处理错误。 */
function checkIfSnapshotChanged<T>(inst: StoreInstance<T>): boolean {
  const latestGetSnapshot = inst.getSnapshot;
  const prevValue = inst.value;
  try {
    const nextValue = latestGetSnapshot();
    return !is(prevValue, nextValue);
  } catch (error) {
    return true;
  }
}

/** 在 SyncLane 为 store 消费者入队并调度一次更新。 */
function forceStoreRerender(fiber: Fiber) {
  const root = enqueueConcurrentRenderForLane(fiber, SyncLane);
  if (root !== null) {
    scheduleUpdateOnFiber(root, fiber, SyncLane);
  }
}

/** 初始化 useState Hook 与基础 reducer 队列；DEV Strict Mode 可双调用惰性初始化器。 */
function mountStateImpl<S>(initialState: (() => S) | S): Hook {
  const hook = mountWorkInProgressHook();
  if (typeof initialState === 'function') {
    const initialStateInitializer = initialState;
    // $FlowFixMe[incompatible-use]: Flow doesn't like mixed types
    initialState = initialStateInitializer();
    if (shouldDoubleInvokeUserFnsInHooksDEV) {
      setIsStrictModeForDevtools(true);
      try {
        // $FlowFixMe[incompatible-use]: Flow doesn't like mixed types
        initialStateInitializer();
      } finally {
        setIsStrictModeForDevtools(false);
      }
    }
  }
  hook.memoizedState = hook.baseState = initialState;
  const queue: UpdateQueue<S, BasicStateAction<S>> = {
    pending: null,
    lanes: NoLanes,
    dispatch: null,
    lastRenderedReducer: basicStateReducer,
    lastRenderedState: initialState as any,
  };
  hook.queue = queue;
  return hook;
}

/** 挂载 useState，并把稳定 dispatchSetState 绑定到当前 Fiber 与队列。 */
function mountState<S>(
  initialState: (() => S) | S,
): [S, Dispatch<BasicStateAction<S>>] {
  const hook = mountStateImpl(initialState);
  const queue = hook.queue;
  const dispatch: Dispatch<BasicStateAction<S>> = dispatchSetState.bind(
    null,
    currentlyRenderingFiber,
    queue,
  ) as any;
  queue.dispatch = dispatch;
  return [hook.memoizedState, dispatch];
}

/** 更新 useState，复用 basicStateReducer 的 reducer 队列重放路径。 */
function updateState<S>(
  initialState: (() => S) | S,
): [S, Dispatch<BasicStateAction<S>>] {
  return updateReducer(basicStateReducer, initialState);
}

/** 在额外 render pass 中应用 useState 的渲染阶段更新。 */
function rerenderState<S>(
  initialState: (() => S) | S,
): [S, Dispatch<BasicStateAction<S>>] {
  return rerenderReducer(basicStateReducer, initialState);
}

/** 挂载 useOptimistic，以 passthrough 为基线并绑定带 revertLane 语义的乐观派发函数。 */
function mountOptimistic<S, A>(
  passthrough: S,
  reducer: ?(S, A) => S,
): [S, (A) => void] {
  const hook = mountWorkInProgressHook();
  hook.memoizedState = hook.baseState = passthrough;
  const queue: UpdateQueue<S, A> = {
    pending: null,
    lanes: NoLanes,
    dispatch: null,
    // 乐观状态不使用 eager 更新优化。
    lastRenderedReducer: null,
    lastRenderedState: null,
  };
  hook.queue = queue;
  // 乐观派发与普通 setState 不同，会携带 transition 回退信息。
  const dispatch: A => void = dispatchOptimisticSetState.bind(
    null,
    currentlyRenderingFiber,
    true,
    queue,
  ) as any;
  queue.dispatch = dispatch;
  return [passthrough, dispatch];
}

/** 更新 useOptimistic，把所有待处理乐观更新重新建立在最新 passthrough 上。 */
function updateOptimistic<S, A>(
  passthrough: S,
  reducer: ?(S, A) => S,
): [S, (A) => void] {
  const hook = updateWorkInProgressHook();
  return updateOptimisticImpl(
    hook,
    currentHook as any as Hook,
    passthrough,
    reducer,
  );
}

/** 设置最新乐观基线并借用 reducer 队列实现执行 rebase。 */
function updateOptimisticImpl<S, A>(
  hook: Hook,
  current: Hook | null,
  passthrough: S,
  reducer: ?(S, A) => S,
): [S, (A) => void] {
  // 乐观更新始终建立在最新传入值上；没有 pending 更新时该 passthrough 会原样返回。
  //
  // 将 baseState 重置为 passthrough，未来更新继续叠加其上。
  hook.baseState = passthrough;

  // 未提供 reducer 时沿用 useState 的 basicStateReducer。
  const resolvedReducer: (S, A) => S =
    typeof reducer === 'function' ? reducer : (basicStateReducer as any);

  return updateReducerImpl(hook, currentHook as any as Hook, resolvedReducer);
}

/**
 * 额外 render pass 中重新计算 useOptimistic；它不支持渲染阶段更新，但需因 passthrough 变化重放队列。
 */
function rerenderOptimistic<S, A>(
  passthrough: S,
  reducer: ?(S, A) => S,
): [S, (A) => void] {
  // 与 useState 不同，useOptimistic 不支持渲染阶段更新，且 passthrough 可能变化，
  // 因此必须重新重放所有 pending 更新。
  //
  // 无需专门处理渲染阶段更新的分叉实现，可直接复用常规 mount/update 路径。
  const hook = updateWorkInProgressHook();

  if (currentHook !== null) {
    // 更新路径：处理现有更新队列。
    return updateOptimisticImpl(
      hook,
      currentHook as any as Hook,
      passthrough,
      reducer,
    );
  }

  // 挂载路径：没有需要处理的更新。

  // 将 baseState 重置为 passthrough，未来更新叠加其上。
  hook.baseState = passthrough;
  const dispatch = hook.queue.dispatch;
  return [passthrough, dispatch];
}

/**
 * useActionState 的串行 action 队列；每个 action 接收前一 action 的状态，因此不能并行执行。
 */
type ActionStateQueue<S, P> = {
  /** 最近完成 action 返回的状态，在 action 结束后立即更新。 */
  state: Awaited<S>,
  /** 暴露给用户且引用稳定的 payload 派发函数。 */
  dispatch: Dispatch<P>,
  /** 最近一次渲染的 action 实现，提交阶段更新；null 表示队列已出错，后续 action 不再运行。 */
  action: ((Awaited<S>, P) => S) | null,
  /** 待处理 action payload 的循环链表尾节点，包含当前正在运行的 action。 */
  pending: ActionStateQueueNode<S, P> | null,
};

/** useActionState 队列中的单个 thenable 节点，同时保存派发时捕获的 action 实现与 payload。 */
type ActionStateQueueNode<S, P> = {
  /** 用户派发给 action 的参数。 */
  payload: P,
  /** 派发瞬间捕获的 action 实现，即使队列等待期间组件产生新实现也保持不变。 */
  action: (Awaited<S>, P) => S,
  /** 循环链表下一节点，因此运行期不会为 null。 */
  next: ActionStateQueueNode<S, P>,

  /**
   * action 是否在 transition 内派发；执行排队 action 时据此恢复 transition 上下文。
   * 支持并行 async action 后，应改为记录关联的具体 transition 实例。
   */
  isTransition: boolean,

  /** 注册 action 完成监听器，实现供 use 挂起消费的 Thenable 接口。 */
  then: (listener: () => void) => void,
  /** action thenable 的当前状态。 */
  status: 'pending' | 'rejected' | 'fulfilled',
  /** fulfilled 后保存的 action 结果。 */
  value: any,
  /** rejected 后保存的错误原因。 */
  reason: any,
  /** action 完成时需要唤醒的 use 订阅者。 */
  listeners: Array<() => void>,
};

/** 事件派发把当前已发布 action 和 payload 固定进 thenable 节点；渲染期间调用抛错，action=null 的失败队列忽略新派发。transition 内先乐观 pending=true，再把节点入 state 队列；actionQueue.pending 为环尾，空队列立即执行首项，其余等待前项完成后串行运行。 */
function dispatchActionState<S, P>(
  fiber: Fiber,
  actionQueue: ActionStateQueue<S, P>,
  setPendingState: boolean => void,
  setState: Dispatch<ActionStateQueueNode<S, P>>,
  payload: P,
): void {
  if (isRenderPhaseUpdate(fiber)) {
    throw new Error('Cannot update action state while rendering.');
  }

  const currentAction = actionQueue.action;
  if (currentAction === null) {
    // 先前 action 已出错，后续 action 不再运行。
    return;
  }

  const actionNode: ActionStateQueueNode<S, P> = {
    payload,
    action: currentAction,
    next: null as any, // 循环链表指针稍后补齐。
    isTransition: true,

    status: 'pending',
    value: null,
    reason: null,
    listeners: [],
    /** 为 use 注册完成监听器；use 已检查 pending 状态，因此无需实现通用 thenable 的全部防御逻辑。 */
    then(listener) {
      actionNode.listeners.push(listener);
    },
  };

  // 记录派发是否位于 transition 内，以便 action 真正执行时恢复上下文。
  const prevTransition = ReactSharedInternals.T;
  if (prevTransition !== null) {
    // 与 useTransition 类似，乐观地更新 pending；所有 action 完成后会自动回退。
    setPendingState(true);
    // actionNode 是解析为 action 返回值的 thenable。
    setState(actionNode);
  } else {
    // 非 transition 派发不更新乐观 pending 状态。
    actionNode.isTransition = false;
    setState(actionNode);
  }

  const last = actionQueue.pending;
  if (last === null) {
    // 队列原本为空，这是首个 action，可立即执行。
    actionNode.next = actionQueue.pending = actionNode;
    runActionStateAction(actionQueue, actionNode);
  } else {
    // 已有 action 正在运行，将新节点追加到循环队列尾部。
    const first = last.next;
    actionNode.next = first;
    actionQueue.pending = last.next = actionNode;
  }
}

/** 以 actionQueue.state 为输入执行节点捕获的 action，而不是队列后来发布的新 action。transition 派发项创建执行时 transition 上下文并调用 shared.S 纠缠 async 返回值，finally 恢复父上下文/types；同步 throw 与 thenable reject 都封闭当前串行队列，非 transition async 在 DEV 发出 pending 使用警告。 */
function runActionStateAction<S, P>(
  actionQueue: ActionStateQueue<S, P>,
  node: ActionStateQueueNode<S, P>,
) {
  // node.action 是派发瞬间的实现。排队期间它可能相对 actionQueue.action 变旧，这是有意设计：
  // 概念模型类似把 action 立即派发到远程 worker，只延迟执行而不替换已派发代码。
  const action = node.action;
  const payload = node.payload;
  const prevState = actionQueue.state;

  if (node.isTransition) {
    // 原始派发属于 transition，在这里恢复其上下文。

    // 以下是 startTransition 的内联分叉。
    const prevTransition = ReactSharedInternals.T;
    const currentTransition: Transition = {} as any;
    if (enableViewTransition) {
      currentTransition.types =
        prevTransition !== null
          ? // 嵌套 transition 与父级概念上纠缠为同一 transition，应共享 types 集合。
            // 只有内部添加 type 却不设置状态时差异明显：内部可能不等待外部便结束。
            prevTransition.types
          : null;
    }
    if (enableGestureTransition) {
      currentTransition.gesture = null;
    }
    if (enableTransitionTracing) {
      currentTransition.name = null;
      currentTransition.startTime = -1;
    }
    if (__DEV__) {
      currentTransition._updatedFibers = new Set();
    }
    ReactSharedInternals.T = currentTransition;
    try {
      const returnValue = action(prevState, payload);
      const onStartTransitionFinish = ReactSharedInternals.S;
      if (onStartTransitionFinish !== null) {
        onStartTransitionFinish(currentTransition, returnValue);
      }
      handleActionReturnValue(actionQueue, node, returnValue);
    } catch (error) {
      onActionError(actionQueue, node, error);
    } finally {
      if (prevTransition !== null && currentTransition.types !== null) {
        // 若内部 transition 创建了新 types 集合，将其转移给父级；二者概念上纠缠并应共享集合。
        if (__DEV__) {
          if (
            prevTransition.types !== null &&
            prevTransition.types !== currentTransition.types
          ) {
            // 断言共享集合假设成立，避免覆盖父级并行写入的内容。
            console.error(
              'We expected inner Transitions to have transferred the outer types set and ' +
                'that you cannot add to the outer Transition while inside the inner.' +
                'This is a bug in React.',
            );
          }
        }
        prevTransition.types = currentTransition.types;
      }
      ReactSharedInternals.T = prevTransition;

      if (__DEV__) {
        if (prevTransition === null && currentTransition._updatedFibers) {
          const updatedFibersCount = currentTransition._updatedFibers.size;
          currentTransition._updatedFibers.clear();
          if (updatedFibersCount > 10) {
            console.warn(
              'Detected a large number of updates inside startTransition. ' +
                'If this is due to a subscription please re-write it to use React provided hooks. ' +
                'Otherwise concurrent mode guarantees are off the table.',
            );
          }
        }
      }
    }
  } else {
    // 原始派发不属于 transition，直接执行 action。
    try {
      const returnValue = action(prevState, payload);
      handleActionReturnValue(actionQueue, node, returnValue);
    } catch (error) {
      onActionError(actionQueue, node, error);
    }
  }
}

/** 区分 action 同步值与 thenable 返回值，并把完成或错误推进到串行队列。 */
function handleActionReturnValue<S, P>(
  actionQueue: ActionStateQueue<S, P>,
  node: ActionStateQueueNode<S, P>,
  returnValue: mixed,
) {
  if (
    returnValue !== null &&
    typeof returnValue === 'object' &&
    // $FlowFixMe[method-unbinding]
    typeof returnValue.then === 'function'
  ) {
    const thenable = returnValue as any as Thenable<Awaited<S>>;
    if (__DEV__) {
      // 跟踪仍在运行的 async transition 数量，供 DEV 警告使用。
      ReactSharedInternals.asyncTransitions++;
      thenable.then(releaseAsyncTransition, releaseAsyncTransition);
    }
    // 监听 action 返回状态；thenable 解决后即可运行序列中的下一 action。
    thenable.then(
      (nextState: Awaited<S>) => {
        onActionSuccess(actionQueue, node, nextState);
      },
      (error: mixed) => onActionError(actionQueue, node, error),
    );

    if (__DEV__) {
      if (!node.isTransition) {
        console.error(
          'An async function with useActionState was called outside of a transition. ' +
            'This is likely not what you intended (for example, isPending will not update ' +
            'correctly). Either call the returned function inside startTransition, or pass it ' +
            'to an `action` or `formAction` prop.',
        );
      }
    }
  } else {
    const nextState = returnValue as any as Awaited<S>;
    onActionSuccess(actionQueue, node, nextState);
  }
}

/** 先把节点 status/value 发布为 fulfilled 并通知 use 监听器，然后写 actionQueue.state 为下一 action 输入。环只有一项时清 pending，否则先把尾.next 跳过队首，再立刻运行下一节点；成功推进队列不等待 React 将该结果提交到 UI。 */
function onActionSuccess<S, P>(
  actionQueue: ActionStateQueue<S, P>,
  actionNode: ActionStateQueueNode<S, P>,
  nextState: Awaited<S>,
) {
  // action 已完成，先唤醒等待该 thenable 的 use。
  actionNode.status = 'fulfilled';
  actionNode.value = nextState;
  notifyActionListeners(actionNode);

  actionQueue.state = nextState;

  // 从队列弹出当前 action；若仍有待处理节点，立即运行下一项。
  const last = actionQueue.pending;
  if (last !== null) {
    const first = last.next;
    if (first === last) {
      // 当前节点是队列最后一项，清空 pending。
      actionQueue.pending = null;
    } else {
      // 从循环队列移除首节点。
      const next = first.next;
      last.next = next;

      // 运行下一 action。
      runActionStateAction(actionQueue, next);
    }
  }
}

/** 当前 action 失败时先清 pending，再沿原循环队列把当前及后续项标为 rejected 并通知内部监听器，最后设 action=null 阻止未来派发。已经排队的后续 action 不再执行，React 渲染消费 rejected 节点时才向错误边界抛出该原因。 */
function onActionError<S, P>(
  actionQueue: ActionStateQueue<S, P>,
  actionNode: ActionStateQueueNode<S, P>,
  error: mixed,
) {
  // 将当前及其后所有 action 标为 rejected。
  const last = actionQueue.pending;
  actionQueue.pending = null;
  if (last !== null) {
    const first = last.next;
    do {
      actionNode.status = 'rejected';
      actionNode.reason = error;
      notifyActionListeners(actionNode);
      actionNode = actionNode.next;
    } while (actionNode !== first);
  }

  // action 设为 null，阻止后续 action 派发。
  actionQueue.action = null;
}

/** 通知所有 use 内部订阅者 action thenable 已结束。 */
function notifyActionListeners<S, P>(actionNode: ActionStateQueueNode<S, P>) {
  const listeners = actionNode.listeners;
  for (let i = 0; i < listeners.length; i++) {
    // 监听器始终来自 React 内部，无需为用户回调抛错增加隔离。
    const listener = listeners[i];
    listener();
  }
}

/** useActionState 的替换型 reducer：action 结果直接成为下一状态。 */
function actionStateReducer<S>(oldState: S, newState: S): S {
  return newState;
}

/** 按固定顺序建立结果 state、乐观 pending、共享 actionQueue 三个 Hook；action 的上一完成状态在事件执行中维护，与渲染结果 Hook 分开。hydration 若根 formState 的 marker 匹配则复用服务端结果，否则用 initialStateProp；Fiber 路径接受 permalink 但不消费它。dispatch 稳定，已排队节点捕获各自派发时实现。 */
function mountActionState<S, P>(
  action: (Awaited<S>, P) => S,
  initialStateProp: Awaited<S>,
  permalink?: string,
): [Awaited<S>, (P) => void, boolean] {
  let initialState: Awaited<S> = initialStateProp;
  if (getIsHydrating()) {
    const root: FiberRoot = getWorkInProgressRoot() as any;
    const ssrFormState = root.formState;
    // 根带 formState 时需水合表单状态 marker，由 marker 判断状态是否属于当前 Hook 实例。
    if (ssrFormState !== null) {
      const isMatching = tryToClaimNextHydratableFormMarkerInstance(
        currentlyRenderingFiber,
      );
      if (isMatching) {
        initialState = ssrFormState[0];
      }
    }
  }

  // 状态 Hook 可存 thenable，并由渲染期间的 use 算法解包。
  const stateHook = mountWorkInProgressHook();
  stateHook.memoizedState = stateHook.baseState = initialState;
  // TODO：按精确类型声明会触发 Flow 递归上限。
  // const stateQueue: UpdateQueue<S | Awaited<S>, S | Awaited<S>> = {
  const stateQueue = {
    pending: null,
    lanes: NoLanes,
    dispatch: null as any,
    lastRenderedReducer: actionStateReducer,
    lastRenderedState: initialState,
  };
  stateHook.queue = stateQueue;
  const setState: Dispatch<S | Awaited<S>> = dispatchSetState.bind(
    null,
    currentlyRenderingFiber,
    stateQueue as any as UpdateQueue<S | Awaited<S>, S | Awaited<S>>,
  ) as any;
  stateQueue.dispatch = setState;

  // pending Hook 以乐观状态跟踪 action 是否待完成，语义类似 transition pending。
  const pendingStateHook = mountStateImpl(false as Thenable<boolean> | boolean);
  const setPendingState: boolean => void = dispatchOptimisticSetState.bind(
    null,
    currentlyRenderingFiber,
    false,
    pendingStateHook.queue as any as UpdateQueue<
      S | Awaited<S>,
      S | Awaited<S>,
    >,
  ) as any;

  // action queue Hook 保存所有 pending action，并在 Hook 的 current/work-in-progress 实例间共享。
  // 它类似普通 state queue，但 action 在事件中串行执行，而非渲染期间执行。
  const actionQueueHook = mountWorkInProgressHook();
  const actionQueue: ActionStateQueue<S, P> = {
    state: initialState,
    dispatch: null as any, // 创建后回填自引用 dispatch。
    action,
    pending: null,
  };
  actionQueueHook.queue = actionQueue;
  const dispatch = (dispatchActionState as any).bind(
    null,
    currentlyRenderingFiber,
    actionQueue,
    setPendingState,
    setState,
  );
  actionQueue.dispatch = dispatch;

  // 把 action 实现存入 Hook.memoizedState，用于检测引用变化并在副作用中发布新实现。
  actionQueueHook.memoizedState = action;

  return [initialState, dispatch, false];
}

/** 更新 useActionState，取得状态 Hook 并进入共享实现处理 thenable 与 action 实现替换。 */
function updateActionState<S, P>(
  action: (Awaited<S>, P) => S,
  initialState: Awaited<S>,
  permalink?: string,
): [Awaited<S>, (P) => void, boolean] {
  const stateHook = updateWorkInProgressHook();
  const currentStateHook = currentHook as any as Hook;
  return updateActionStateImpl(
    stateHook,
    currentStateHook,
    action,
    initialState,
    permalink,
  );
}

/** 按 reducer 处理结果 Hook，再读取 pending Hook；结果为 thenable 时用 useThenable 解包，未完成时把 SuspenseException 换为 SuspenseActionException 供 WorkLoop 识别 Action。最后读取 actionQueue Hook，action 与所存引用不同就排入 passive 实现发布，不重写既有节点捕获的 action；initialState/permalink 不在此更新路径使用。 */
function updateActionStateImpl<S, P>(
  stateHook: Hook,
  currentStateHook: Hook,
  action: (Awaited<S>, P) => S,
  initialState: Awaited<S>,
  permalink?: string,
): [Awaited<S>, (P) => void, boolean] {
  const [actionResult] = updateReducerImpl<S | Thenable<S>, S | Thenable<S>>(
    stateHook,
    currentStateHook,
    actionStateReducer,
  );

  const [isPending] = updateState(false);

  // actionResult 为 thenable 时，挂起到 action 完成。
  let state: Awaited<S>;
  if (
    typeof actionResult === 'object' &&
    // $FlowFixMe[invalid-compare]
    actionResult !== null &&
    // $FlowFixMe[method-unbinding]
    typeof actionResult.then === 'function'
  ) {
    try {
      state = useThenable(actionResult as any as Thenable<Awaited<S>>);
    } catch (x) {
      if (x === SuspenseException) {
        // 若在此挂起，改抛 SuspenseActionException，让 Profiling 工具将其识别为 Action。
        throw SuspenseActionException;
      } else {
        throw x;
      }
    }
  } else {
    state = actionResult as any;
  }

  const actionQueueHook = updateWorkInProgressHook();
  const actionQueue = actionQueueHook.queue;
  const dispatch = actionQueue.dispatch;

  // 若组件传入了新 action，实现要在提交后的被动副作用中发布，不能改变已派发节点。
  const prevAction = actionQueueHook.memoizedState;
  if (action !== prevAction) {
    currentlyRenderingFiber.flags |= PassiveEffect;
    pushSimpleEffect(
      HookHasEffect | HookPassive,
      createEffectInstance(),
      actionStateActionEffect.bind(null, actionQueue, action),
      null,
    );
  }

  return [state, dispatch, isPending];
}

/** 被动阶段把本次渲染的 action 实现发布到共享队列，供未来派发捕获。 */
function actionStateActionEffect<S, P>(
  actionQueue: ActionStateQueue<S, P>,
  action: (Awaited<S>, P) => S,
): void {
  actionQueue.action = action;
}

/** 额外 render pass 中复用常规 action state 更新路径；不支持渲染阶段 action 更新。 */
function rerenderActionState<S, P>(
  action: (Awaited<S>, P) => S,
  initialState: Awaited<S>,
  permalink?: string,
): [Awaited<S>, (P) => void, boolean] {
  // useActionState 不支持渲染阶段派发。更新组件的额外 pass 仍须消费状态与 pending Hook，
  // 并比较最新 action；挂载组件则复用首遍创建的三个 Hook。
  //
  // 无需处理渲染阶段更新的专门分叉，可直接复用常规 mount/update 实现。
  const stateHook = updateWorkInProgressHook();
  const currentStateHook = currentHook;

  if (currentStateHook !== null) {
    // 更新路径：处理更新队列。
    return updateActionStateImpl(
      stateHook,
      currentStateHook,
      action,
      initialState,
      permalink,
    );
  }

  updateWorkInProgressHook(); // 待完成状态 Hook。

  // 挂载路径：没有需要处理的更新。
  const state: Awaited<S> = stateHook.memoizedState;

  const actionQueueHook = updateWorkInProgressHook();
  const actionQueue = actionQueueHook.queue;
  const dispatch = actionQueue.dispatch;

  // 重渲染期间 action 实现可能变化，直接刷新记忆化引用。
  actionQueueHook.memoizedState = action;

  // 挂载阶段 pending 始终为 false。
  return [state, dispatch, false];
}

/** 构造 Effect 节点并追加到当前函数组件的循环副作用链表。 */
function pushSimpleEffect(
  tag: HookFlags,
  inst: EffectInstance,
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): Effect {
  const effect: Effect = {
    tag,
    create,
    deps,
    inst,
    // 循环指针由 pushEffectImpl 回填。
    next: null as any,
  };
  return pushEffectImpl(effect);
}

/** 把 Effect 以 O(1) 方式追加到 FunctionComponentUpdateQueue.lastEffect 循环链表尾部。 */
function pushEffectImpl(effect: Effect): Effect {
  let componentUpdateQueue: null | FunctionComponentUpdateQueue =
    currentlyRenderingFiber.updateQueue as any;
  if (componentUpdateQueue === null) {
    componentUpdateQueue = createFunctionComponentUpdateQueue();
    currentlyRenderingFiber.updateQueue = componentUpdateQueue as any;
  }
  const lastEffect = componentUpdateQueue.lastEffect;
  if (lastEffect === null) {
    componentUpdateQueue.lastEffect = effect.next = effect;
  } else {
    const firstEffect = lastEffect.next;
    lastEffect.next = effect;
    effect.next = firstEffect;
    componentUpdateQueue.lastEffect = effect;
  }
  return effect;
}

/** 创建尚未持有清理函数的稳定 EffectInstance。 */
function createEffectInstance(): EffectInstance {
  return {destroy: undefined};
}

/** 挂载 useRef，创建并记忆化稳定的 current 容器。 */
function mountRef<T>(initialValue: T): {
  /** 对用户可变、但 ref 对象生命周期内保持同一槽位。 */
  current: T
} {
  const hook = mountWorkInProgressHook();
  const ref = {current: initialValue};
  hook.memoizedState = ref;
  return ref;
}

/** 更新 useRef，返回挂载阶段创建的同一引用对象。 */
function updateRef<T>(initialValue: T): {
  /** 对用户可变、但 ref 对象生命周期内保持同一槽位。 */
  current: T
} {
  const hook = updateWorkInProgressHook();
  return hook.memoizedState;
}

/** 挂载指定种类的 Effect，标记 Fiber 并把带 HookHasEffect 的节点加入队列。 */
function mountEffectImpl(
  fiberFlags: Flags,
  hookFlags: HookFlags,
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  currentlyRenderingFiber.flags |= fiberFlags;
  hook.memoizedState = pushSimpleEffect(
    HookHasEffect | hookFlags,
    createEffectInstance(),
    create,
    nextDeps,
  );
}

/** 更新 Effect：依赖相等时复用实例且不加 HookHasEffect，否则安排本次提交执行。 */
function updateEffectImpl(
  fiberFlags: Flags,
  hookFlags: HookFlags,
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const effect: Effect = hook.memoizedState;
  const inst = effect.inst;

  // 初次挂载因渲染阶段更新或 Strict Mode 进入重渲染时，currentHook 可能为 null。
  if (currentHook !== null) {
    if (nextDeps !== null) {
      const prevEffect: Effect = currentHook.memoizedState;
      const prevDeps = prevEffect.deps;
      // $FlowFixMe[incompatible-type] (@poteto)
      if (areHookInputsEqual(nextDeps, prevDeps)) {
        hook.memoizedState = pushSimpleEffect(
          hookFlags,
          inst,
          create,
          nextDeps,
        );
        return;
      }
    }
  }

  currentlyRenderingFiber.flags |= fiberFlags;

  hook.memoizedState = pushSimpleEffect(
    HookHasEffect | hookFlags,
    inst,
    create,
    nextDeps,
  );
}

/** 挂载被动 Effect；DEV StrictEffectsMode 额外附加 MountPassiveDevEffect。 */
function mountEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  if (
    __DEV__ &&
    (currentlyRenderingFiber.mode & StrictEffectsMode) !== NoMode
  ) {
    mountEffectImpl(
      MountPassiveDevEffect | PassiveEffect | PassiveStaticEffect,
      HookPassive,
      create,
      deps,
    );
  } else {
    mountEffectImpl(
      PassiveEffect | PassiveStaticEffect,
      HookPassive,
      create,
      deps,
    );
  }
}

/** 更新被动 Effect，使用依赖比较决定是否设置 HookHasEffect。 */
function updateEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  updateEffectImpl(PassiveEffect, HookPassive, create, deps);
}

/** 把新的实现替换记录加入 FunctionComponentUpdateQueue.events，并标记 Update。commit 在 enableEffectEventMutationPhase 开启时于父先子 mutation 入口发布 ref.impl，否则在 before-mutation 后序发布；两种路径都早于普通 layout effect 创建，渲染期间不发布未提交 callback。 */
function useEffectEventImpl<Args, Return, F: (...Array<Args>) => Return>(
  payload: EventFunctionPayload<Args, Return, F>,
) {
  currentlyRenderingFiber.flags |= UpdateEffect;
  let componentUpdateQueue: null | FunctionComponentUpdateQueue =
    currentlyRenderingFiber.updateQueue as any;
  if (componentUpdateQueue === null) {
    componentUpdateQueue = createFunctionComponentUpdateQueue();
    currentlyRenderingFiber.updateQueue = componentUpdateQueue as any;
    componentUpdateQueue.events = [payload];
  } else {
    const events = componentUpdateQueue.events;
    if (events === null) {
      componentUpdateQueue.events = [payload];
    } else {
      events.push(payload);
    }
  }
}

/** 挂载 useEffectEvent，创建共享实现 ref 并返回禁止在渲染期间调用的包装器；返回函数不承诺引用稳定。 */
function mountEvent<Args, Return, F: (...Array<Args>) => Return>(
  callback: F,
): F {
  const hook = mountWorkInProgressHook();
  const ref = {impl: callback};
  hook.memoizedState = ref;
  // $FlowFixMe[incompatible-type]
  return /** 在 render 外把 arguments 转发给共享 ref.impl；impl 在提交阶段发布，包装器自身每次 mount/update 新建。 */ function eventFn() {
    if (isInvalidExecutionContextForEventFunction()) {
      throw new Error(
        "A function wrapped in useEffectEvent can't be called during rendering.",
      );
    }
    return ref.impl.apply(undefined, arguments);
  };
}

/** 更新 useEffectEvent，复用实现 ref、排队发布新 callback，并返回一个新的事件包装器。 */
function updateEvent<Args, Return, F: (...Array<Args>) => Return>(
  callback: F,
): F {
  const hook = updateWorkInProgressHook();
  const ref = hook.memoizedState;
  useEffectEventImpl({ref, nextImpl: callback});
  // $FlowFixMe[incompatible-type]
  return /** 在 render 外把 arguments 转发给共享 ref.impl；impl 在提交阶段发布，包装器自身每次 mount/update 新建。 */ function eventFn() {
    if (isInvalidExecutionContextForEventFunction()) {
      throw new Error(
        "A function wrapped in useEffectEvent can't be called during rendering.",
      );
    }
    return ref.impl.apply(undefined, arguments);
  };
}

/** 挂载 insertion Effect，登记 mutation 阶段的 create/cleanup；它早于 layout create，但不早于所有宿主变更。 */
function mountInsertionEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  mountEffectImpl(UpdateEffect, HookInsertion, create, deps);
}

/** 更新 insertion Effect，并按依赖决定本次是否执行。 */
function updateInsertionEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  return updateEffectImpl(UpdateEffect, HookInsertion, create, deps);
}

/** 挂载 layout Effect；DEV StrictEffectsMode 额外附加 MountLayoutDevEffect。 */
function mountLayoutEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  let fiberFlags: Flags = UpdateEffect | LayoutStaticEffect;
  if (
    __DEV__ &&
    (currentlyRenderingFiber.mode & StrictEffectsMode) !== NoMode
  ) {
    fiberFlags |= MountLayoutDevEffect;
  }
  return mountEffectImpl(fiberFlags, HookLayout, create, deps);
}

/** 更新 layout Effect，并按依赖决定本次提交是否执行。 */
function updateLayoutEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  return updateEffectImpl(UpdateEffect, HookLayout, create, deps);
}

/** layout create 调用用户 create 后附加命令式句柄；callback ref 返回函数时 cleanup 调该函数，否则回调 null。object ref cleanup 把 current 设 null；null/undefined ref 不调用 create。创建/附加/清理错误由 commit effect 层捕获，这里不缓存句柄或自行隔离错误。 */
function imperativeHandleEffect<T>(
  create: () => T,
  ref: {
    /** 暴露给用户的命令式句柄；清理时重置为 null。 */
    current: T | null
  }
    | ((inst: T | null) => mixed)
    | null
    | void,
): void | (() => void) {
  if (typeof ref === 'function') {
    const refCallback = ref;
    const inst = create();
    const refCleanup = refCallback(inst);
    return () => {
      if (typeof refCleanup === 'function') {
        // $FlowFixMe[incompatible-use] we need to assume no parameters
        refCleanup();
      } else {
        refCallback(null);
      }
    };
  } else if (ref !== null && ref !== undefined) {
    const refObject = ref;
    if (__DEV__) {
      if (!refObject.hasOwnProperty('current')) {
        console.error(
          'Expected useImperativeHandle() first argument to either be a ' +
            'ref callback or React.createRef() object. Instead received: %s.',
          'an object with keys {' + Object.keys(refObject).join(', ') + '}',
        );
      }
    }
    const inst = create();
    refObject.current = inst;
    return () => {
      refObject.current = null;
    };
  }
}

/** 挂载 useImperativeHandle，以 layout Effect 创建句柄，并把 ref 纳入依赖。 */
function mountImperativeHandle<T>(
  ref: {
    /** 暴露给用户的命令式句柄；清理时重置为 null。 */
    current: T | null
  }
    | ((inst: T | null) => mixed)
    | null
    | void,
  create: () => T,
  deps: Array<mixed> | void | null,
): void {
  if (__DEV__) {
    if (typeof create !== 'function') {
      console.error(
        'Expected useImperativeHandle() second argument to be a function ' +
          'that creates a handle. Instead received: %s.',
        // $FlowFixMe[invalid-compare]
        create !== null ? typeof create : 'null',
      );
    }
  }

  // TODO：提供 deps 时是否应跳过 ref 本身的比较？
  const effectDeps =
    deps !== null && deps !== undefined ? deps.concat([ref]) : null;

  let fiberFlags: Flags = UpdateEffect | LayoutStaticEffect;
  if (
    __DEV__ &&
    (currentlyRenderingFiber.mode & StrictEffectsMode) !== NoMode
  ) {
    fiberFlags |= MountLayoutDevEffect;
  }
  mountEffectImpl(
    fiberFlags,
    HookLayout,
    imperativeHandleEffect.bind(null, create, ref),
    effectDeps,
  );
}

/** 更新 useImperativeHandle；ref 或 deps 变化时重新安排 layout Effect。 */
function updateImperativeHandle<T>(
  ref: {
    /** 暴露给用户的命令式句柄；清理时重置为 null。 */
    current: T | null
  }
    | ((inst: T | null) => mixed)
    | null
    | void,
  create: () => T,
  deps: Array<mixed> | void | null,
): void {
  if (__DEV__) {
    if (typeof create !== 'function') {
      console.error(
        'Expected useImperativeHandle() second argument to be a function ' +
          'that creates a handle. Instead received: %s.',
        // $FlowFixMe[invalid-compare]
        create !== null ? typeof create : 'null',
      );
    }
  }

  // TODO：提供 deps 时是否应跳过 ref 本身的比较？
  const effectDeps =
    deps !== null && deps !== undefined ? deps.concat([ref]) : null;

  updateEffectImpl(
    UpdateEffect,
    HookLayout,
    imperativeHandleEffect.bind(null, create, ref),
    effectDeps,
  );
}

/** useDebugValue 的默认空实现；react-debug-hooks 会注入读取逻辑供 DevTools 展示自定义值。 */
function mountDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
}

/** 更新阶段沿用 useDebugValue 的可注入空实现。 */
const updateDebugValue = mountDebugValue;

/** 挂载 useCallback，记忆化回调引用与规范化后的依赖。 */
function mountCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  hook.memoizedState = [callback, nextDeps];
  return callback;
}

/** 更新 useCallback；依赖相等时复用旧回调，否则保存并返回新回调。 */
function updateCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const prevState = hook.memoizedState;
  if (nextDeps !== null) {
    const prevDeps: Array<mixed> | null = prevState[1];
    if (areHookInputsEqual(nextDeps, prevDeps)) {
      return prevState[0];
    }
  }
  hook.memoizedState = [callback, nextDeps];
  return callback;
}

/** 挂载 useMemo，计算并保存值与依赖；DEV Strict Mode 可双调用计算函数。 */
function mountMemo<T>(
  nextCreate: () => T,
  deps: Array<mixed> | void | null,
): T {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const nextValue = nextCreate();
  if (shouldDoubleInvokeUserFnsInHooksDEV) {
    setIsStrictModeForDevtools(true);
    try {
      nextCreate();
    } finally {
      setIsStrictModeForDevtools(false);
    }
  }
  hook.memoizedState = [nextValue, nextDeps];
  return nextValue;
}

/** 更新 useMemo；依赖相等时复用旧值，否则重新计算并记录。 */
function updateMemo<T>(
  nextCreate: () => T,
  deps: Array<mixed> | void | null,
): T {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const prevState = hook.memoizedState;
  // 假定依赖已定义；若形状异常，areHookInputsEqual 会在 DEV 下警告。
  if (nextDeps !== null) {
    const prevDeps: Array<mixed> | null = prevState[1];
    if (areHookInputsEqual(nextDeps, prevDeps)) {
      return prevState[0];
    }
  }
  const nextValue = nextCreate();
  if (shouldDoubleInvokeUserFnsInHooksDEV) {
    setIsStrictModeForDevtools(true);
    try {
      nextCreate();
    } finally {
      setIsStrictModeForDevtools(false);
    }
  }
  hook.memoizedState = [nextValue, nextDeps];
  return nextValue;
}

/** 挂载 useDeferredValue，并根据 initialValue 与当前 lane 决定是否先显示占位值。 */
function mountDeferredValue<T>(value: T, initialValue?: T): T {
  const hook = mountWorkInProgressHook();
  return mountDeferredValueImpl(hook, value, initialValue);
}

/** 更新 useDeferredValue，将新值与 current 记忆化值交给延迟策略。 */
function updateDeferredValue<T>(value: T, initialValue?: T): T {
  const hook = updateWorkInProgressHook();
  const resolvedCurrentHook: Hook = currentHook as any;
  const prevValue: T = resolvedCurrentHook.memoizedState;
  return updateDeferredValueImpl(hook, prevValue, value, initialValue);
}

/** 额外 render pass 中根据是否仍处于挂载选择 deferred value 的挂载或更新路径。 */
function rerenderDeferredValue<T>(value: T, initialValue?: T): T {
  const hook = updateWorkInProgressHook();
  if (currentHook === null) {
    // 挂载期间的重渲染。
    return mountDeferredValueImpl(hook, value, initialValue);
  } else {
    // 更新期间的重渲染。
    const prevValue: T = currentHook.memoizedState;
    return updateDeferredValueImpl(hook, prevValue, value, initialValue);
  }
}

/** 判断当前渲染是否纯粹由 DeferredLane 驱动，而未与普通 update lane 合批。 */
function isRenderingDeferredWork(): boolean {
  if (!includesSomeLane(renderLanes, DeferredLane)) {
    // 当前 renderLanes 不包含 DeferredLane。
    return false;
  }
  // renderLanes 至少含一个 DeferredLane；若又与普通更新合批，则不能视为纯延迟工作。
  // 通过根 render lanes 是否含 setState 等更新专用 UpdateLanes 判断。
  const rootRenderLanes = getWorkInProgressRootRenderLanes();
  return !includesSomeLane(rootRenderLanes, UpdateLanes);
}

/** 首次渲染 deferred value：可先提交 initialValue，并安排 DeferredLane 切换到最终值。 */
function mountDeferredValueImpl<T>(hook: Hook, value: T, initialValue?: T): T {
  if (
    // 提供 initialValue 时，即使当前并非同步渲染也先延迟最终值。
    initialValue !== undefined &&
    // 为避免瀑布，若本轮本身由先前 useDeferredValue 触发，则不再次延迟。
    !isRenderingDeferredWork()
  ) {
    // 本轮先渲染 initialValue。
    hook.memoizedState = initialValue;

    // 安排延迟渲染切换到最终值。
    const deferredLane = requestDeferredLane();
    currentlyRenderingFiber.lanes = mergeLanes(
      currentlyRenderingFiber.lanes,
      deferredLane,
    );
    markSkippedUpdateLanes(deferredLane);

    return initialValue;
  } else {
    hook.memoizedState = value;
    return value;
  }
}

/** Object.is 相等时复用；当前树隐藏时采用挂载 initialValue 策略。可见树在包含 urgent lanes 且并非独立 deferred work 时保留旧值并请求后续 lane；非 urgent 或本身 deferred 渲染采用新值并标记 receivedUpdate。deferred lane 由 WorkLoop 根据根/隐藏上下文分配，不能等同固定 Scheduler 优先级或定时器。 */
function updateDeferredValueImpl<T>(
  hook: Hook,
  prevValue: T,
  value: T,
  initialValue?: T,
): T {
  if (is(value, prevValue)) {
    // 新值与当前渲染值引用相同，可快速退出。
    return value;
  } else {
    // 收到与当前值不同的新值。

    // 隐藏树重新显示等价于挂载新树，复用挂载延迟策略。
    if (isCurrentTreeHidden()) {
      const resultValue = mountDeferredValueImpl(hook, value, initialValue);
      // 与真实挂载不同，值变化时仍需标记为更新。
      if (!is(resultValue, prevValue)) {
        markWorkInProgressReceivedUpdate();
      }
      return resultValue;
    }

    const shouldDeferValue =
      !includesOnlyNonUrgentLanes(renderLanes) && !isRenderingDeferredWork();
    if (shouldDeferValue) {
      // 紧急更新先继续使用旧值，并派生延迟渲染稍后更新。

      // 安排 DeferredLane 渲染。
      const deferredLane = requestDeferredLane();
      currentlyRenderingFiber.lanes = mergeLanes(
        currentlyRenderingFiber.lanes,
        deferredLane,
      );
      markSkippedUpdateLanes(deferredLane);

      // 本轮复用旧值，没有渲染新值，故无需标记更新。
      return prevValue;
    } else {
      // 非紧急更新可直接采用最新值，无需延迟。

      // 标记更新以阻止 Fiber bailout。
      markWorkInProgressReceivedUpdate();
      hook.memoizedState = value;
      return value;
    }
  }
}

/** DEV 下在 async transition 结束时递减运行计数。 */
function releaseAsyncTransition() {
  if (__DEV__) {
    ReactSharedInternals.asyncTransitions--;
  }
}

/**
 * 运行 useTransition/宿主表单 transition：先乐观发布 pending，再以完成值或 thenable 安排回退更新。
 *
 * @remarks callback 为 async 时把完成状态链接到 thenable，使渲染挂起到 action scope 完成；
 * 嵌套 transition 共享 types 集合，并在 finally 中恢复优先级与父 transition 上下文。
 */
function startTransition<S>(
  fiber: Fiber,
  queue: UpdateQueue<S | Thenable<S>, BasicStateAction<S | Thenable<S>>>,
  pendingState: S,
  finishedState: S,
  callback: () => mixed,
  options?: StartTransitionOptions,
): void {
  const previousPriority = getCurrentUpdatePriority();
  setCurrentUpdatePriority(
    higherEventPriority(previousPriority, ContinuousEventPriority),
  );

  const prevTransition = ReactSharedInternals.T;
  const currentTransition: Transition = {} as any;
  if (enableViewTransition) {
    currentTransition.types =
      prevTransition !== null
        ? // 嵌套 transition 与父级概念上纠缠为同一 transition，应共享 types 集合。
          // 只有内部添加 type 却不设置状态时差异明显：内部可能不等待外部便结束。
          prevTransition.types
        : null;
  }
  if (enableGestureTransition) {
    currentTransition.gesture = null;
  }
  if (enableTransitionTracing) {
    currentTransition.name =
      options !== undefined && options.name !== undefined ? options.name : null;
    currentTransition.startTime = now();
  }
  if (__DEV__) {
    currentTransition._updatedFibers = new Set();
  }

  // 下方还会安排第二个 revert 更新，用它挂起到 async action scope 完成，理论上这里无需乐观更新。
  // 仍沿用乐观路径以避免行为意外分叉，例如两者必须共享同一 lane。
  ReactSharedInternals.T = currentTransition;
  dispatchOptimisticSetState(fiber, false, queue, pendingState);

  try {
    const returnValue = callback();
    const onStartTransitionFinish = ReactSharedInternals.S;
    if (onStartTransitionFinish !== null) {
      onStartTransitionFinish(currentTransition, returnValue);
    }

    // 若已在 async action scope 内，把新 action 与现有 scope 纠缠。
    //
    // 若尚无 scope 且 action 为 async，则创建新 scope。
    //
    // async 情况下，结果渲染会挂起到整个 action scope 完成。
    if (
      returnValue !== null &&
      typeof returnValue === 'object' &&
      typeof returnValue.then === 'function'
    ) {
      const thenable = returnValue as any as Thenable<mixed>;
      if (__DEV__) {
        // 跟踪仍在运行的 async transition 数量，供 DEV 警告使用。
        ReactSharedInternals.asyncTransitions++;
        thenable.then(releaseAsyncTransition, releaseAsyncTransition);
      }
      // 创建在 async action 完成后解析为 finishedState 的 thenable。
      const thenableForFinishedState = chainThenableValue(
        thenable,
        finishedState,
      );
      dispatchSetStateInternal(
        fiber,
        queue,
        thenableForFinishedState as any,
        requestUpdateLane(fiber),
      );
    } else {
      dispatchSetStateInternal(
        fiber,
        queue,
        finishedState,
        requestUpdateLane(fiber),
      );
    }
  } catch (error) {
    // 用 rejected thenable 让 useTransition 在 use 解包时重新抛出 callback 错误。
    const rejectedThenable: RejectedThenable<S> = {
      /** rejected thenable 已终结，无需登记完成监听器。 */
      then() {},
      status: 'rejected',
      reason: error,
    };
    dispatchSetStateInternal(
      fiber,
      queue,
      rejectedThenable,
      requestUpdateLane(fiber),
    );
  } finally {
    setCurrentUpdatePriority(previousPriority);

    if (prevTransition !== null && currentTransition.types !== null) {
      // 内部 transition 若创建了新 types 集合，将其转移给概念上纠缠且应共享集合的父级。
      if (__DEV__) {
        if (
          prevTransition.types !== null &&
          prevTransition.types !== currentTransition.types
        ) {
          // 断言共享集合假设成立，避免覆盖父级并行写入的内容。
          console.error(
            'We expected inner Transitions to have transferred the outer types set and ' +
              'that you cannot add to the outer Transition while inside the inner.' +
              'This is a bug in React.',
          );
        }
      }
      prevTransition.types = currentTransition.types;
    }
    ReactSharedInternals.T = prevTransition;

    if (__DEV__) {
      if (prevTransition === null && currentTransition._updatedFibers) {
        const updatedFibersCount = currentTransition._updatedFibers.size;
        currentTransition._updatedFibers.clear();
        if (updatedFibersCount > 10) {
          console.warn(
            'Detected a large number of updates inside startTransition. ' +
              'If this is due to a subscription please re-write it to use React provided hooks. ' +
              'Otherwise concurrent mode guarantees are off the table.',
          );
        }
      }
    }
  }
}

/** 宿主 transition 未提供 action 时使用的空回调，仍允许发布 pending 表单状态。 */
const noop = () => {};

/** 把 HostComponent form 升级为 pending/reset 两个 state Hook，启动 pending→NoPendingHostTransition 过渡。有 action 时先把 reset 请求入同一 transition，再立即调用 action(formData)；异步结算通过 startTransition 的 thenable 更新控制完成提交。不是等待 action 返回后才调用 requestFormReset，action=null 时只发布表单状态。 */
export function startHostTransition<F>(
  formFiber: Fiber,
  pendingState: TransitionStatus,
  action: (F => mixed) | null,
  formData: F,
): void {
  if (formFiber.tag !== HostComponent) {
    throw new Error(
      'Expected the form instance to be a HostComponent. This ' +
        'is a bug in React.',
    );
  }

  const stateHook = ensureFormComponentIsStateful(formFiber);

  const queue: UpdateQueue<
    Thenable<TransitionStatus> | TransitionStatus,
    BasicStateAction<Thenable<TransitionStatus> | TransitionStatus>,
  > = stateHook.queue;

  startHostActionTimer(formFiber);

  startTransition(
    formFiber,
    queue,
    pendingState,
    NoPendingHostTransition,
    // TODO：startTransition 同时设置 pending 与派发可选 action；可拆分职责以避免额外 lambda。

    action === null
      ? // 未提供 action，仍调用 startTransition 以设置 pending 表单状态。
        noop
      : () => {
          // 先把表单 reset 请求加入本 transition，再调用 action；实际 reset 随结果提交执行。
          requestFormReset(formFiber);
          return action(formData);
        },
  );
}

/**
 * 按需把宿主 form Fiber 升级为带两个 state Hook 的形状，复用函数组件 transition 实现。
 * 第一个 Hook 保存 pending 状态，第二个以对象引用变化表示提交阶段需要重置表单。
 */
function ensureFormComponentIsStateful(formFiber: Fiber) {
  const existingStateHook: Hook | null = formFiber.memoizedState;
  if (existingStateHook !== null) {
    // Fiber 已升级为有状态形状，复用现有 Hook 链。
    return existingStateHook;
  }

  // 把宿主组件 Fiber 升级为有状态，并让 current/alternate 都像从一开始就持有 Hook，
  // 从而复用函数组件与 useTransition 的大部分实现。
  //
  // 内联 mountState，创建 TransitionAwareHostComponent 使用的状态 Hook。
  const newQueue: UpdateQueue<
    Thenable<TransitionStatus> | TransitionStatus,
    BasicStateAction<Thenable<TransitionStatus> | TransitionStatus>,
  > = {
    pending: null,
    lanes: NoLanes,
    // 有意不创建绑定 dispatch；startTransition 会直接操作队列。
    dispatch: null as any,
    lastRenderedReducer: basicStateReducer,
    lastRenderedState: NoPendingHostTransition,
  };

  const stateHook: Hook = {
    memoizedState: NoPendingHostTransition,
    baseState: NoPendingHostTransition,
    baseQueue: null,
    queue: newQueue,
    next: null,
  };

  // 第二个 state Hook 跟踪表单是否需要重置。状态为空对象；更新为新对象即可让渲染检测到
  // 引用变化，并安排提交副作用。
  const initialResetState = {};
  const newResetStateQueue: UpdateQueue<Object, Object> = {
    pending: null,
    lanes: NoLanes,
    // 有意不创建绑定 dispatch；重置请求会直接操作队列。
    dispatch: null as any,
    lastRenderedReducer: basicStateReducer,
    lastRenderedState: initialResetState,
  };
  const resetStateHook: Hook = {
    memoizedState: initialResetState,
    baseState: initialResetState,
    baseQueue: null,
    queue: newResetStateQueue,
    next: null,
  };
  stateHook.next = resetStateHook;

  // 把同一 Hook 链挂到两个 Fiber alternate，使升级看起来像从一开始就有状态。
  formFiber.memoizedState = stateHook;
  const alternate = formFiber.alternate;
  if (alternate !== null) {
    alternate.memoizedState = stateHook;
  }

  return stateHook;
}

/** 向 form 的第二 state Hook 派发新对象，渲染比较引用后标记 FormReset，mutation 收尾才使用最新 defaultValue 重置宿主表单。lane 由 requestUpdateLane 选择：transition 外 DEV 警告但仍按当前更新/事件优先级入队，手势 transition 内抛错；不强制 SyncLane，也不直接操作宿主实例。 */
export function requestFormReset(formFiber: Fiber) {
  const transition = requestCurrentTransition();

  if (transition === null) {
    if (__DEV__) {
      // 当前栈上没有 startTransition，重置按现有更新/事件优先级入队，通常不是用户意图，
      // 最常见原因是在 await 之后调用 requestFormReset。
      // TODO：非 transition 更新理论上也可先同步更新 defaultValue、再等提交后重置；
      // 当前仍选择警告，因为 await 误用更常见，但可重新评估。
      console.error(
        'requestFormReset was called outside a transition or action. To ' +
          'fix, move to an action, or wrap with startTransition.',
      );
    }
  } else if (enableGestureTransition && transition.gesture) {
    throw new Error(
      'Cannot requestFormReset() inside a startGestureTransition. ' +
        'There should be no side-effects associated with starting a ' +
        'Gesture until its Action is invoked. Move side-effects to the ' +
        'Action instead.',
    );
  }

  let stateHook: Hook = ensureFormComponentIsStateful(formFiber);
  const newResetState = {};
  if (stateHook.next === null) {
    // 若 formFiber 正是 work-in-progress，可能观察到中间态；改从 alternate 读取。
    // TODO：应像 setState 绑定 Queue 一样，把该队列存到稳定位置。
    stateHook = (formFiber.alternate as any).memoizedState;
  }
  const resetStateHook: Hook = stateHook.next as any;
  const resetStateQueue = resetStateHook.queue;
  dispatchSetStateInternal(
    formFiber,
    resetStateQueue,
    newResetState,
    requestUpdateLane(formFiber),
  );
}

/** 挂载 useTransition：创建 pending state Hook，并记忆化稳定的 start 函数。 */
function mountTransition(): [
  boolean,
  (callback: () => void, options?: StartTransitionOptions) => void,
] {
  const stateHook = mountStateImpl(false as Thenable<boolean> | boolean);
  // start 方法在 Hook 生命周期内保持引用稳定。
  const start = startTransition.bind(
    null,
    currentlyRenderingFiber,
    stateHook.queue,
    true,
    false,
  );
  const hook = mountWorkInProgressHook();
  hook.memoizedState = start;
  return [false, start];
}

/** 更新 useTransition；async action 未完成时通过 thenable 挂起并返回稳定 start。 */
function updateTransition(): [
  boolean,
  (callback: () => void, options?: StartTransitionOptions) => void,
] {
  const [booleanOrThenable] = updateState(false);
  const hook = updateWorkInProgressHook();
  const start = hook.memoizedState;
  const isPending =
    typeof booleanOrThenable === 'boolean'
      ? booleanOrThenable
      : // 挂起到 async action scope 完成。
        useThenable(booleanOrThenable);
  return [isPending, start];
}

/** 额外 render pass 中更新 transition pending 状态，并复用稳定 start。 */
function rerenderTransition(): [
  boolean,
  (callback: () => void, options?: StartTransitionOptions) => void,
] {
  const [booleanOrThenable] = rerenderState(false);
  const hook = updateWorkInProgressHook();
  const start = hook.memoizedState;
  const isPending =
    typeof booleanOrThenable === 'boolean'
      ? booleanOrThenable
      : // 挂起到 async action scope 完成。
        useThenable(booleanOrThenable);
  return [isPending, start];
}

/** 从 HostTransitionContext 读取最近宿主表单 transition 状态。 */
function useHostTransitionStatus(): TransitionStatus {
  return readContext(HostTransitionContext);
}

/** 挂载 useId：水合时按树位置生成稳定服务端 ID，客户端渲染则使用全局序号。 */
function mountId(): string {
  const hook = mountWorkInProgressHook();

  const root = getWorkInProgressRoot() as any as FiberRoot;
  // TODO：Fizz 的 ID 生成由服务端配置决定，Fiber 或许也应如此；目前 Fiber 树无法引用
  // public createRoot 上保存前缀的内部字段，因此暂缓决定。
  const identifierPrefix = root.identifierPrefix;

  let id;
  if (getIsHydrating()) {
    const treeId = getTreeId();

    // 服务端生成 ID 使用大写 R 前缀。
    id = '_' + identifierPrefix + 'R_' + treeId;

    // 同层首个 ID 之外，附加序号表示该 useId 在当前 Fiber 所有 useId 调用中的位置。
    const localId = localIdCounter++;
    if (localId > 0) {
      id += 'H' + localId.toString(32);
    }

    id += '_';
  } else {
    // 客户端生成 ID 使用小写 r 前缀和全局序号。
    const globalClientId = globalClientIdCounter++;
    id = '_' + identifierPrefix + 'r_' + globalClientId.toString(32) + '_';
  }

  hook.memoizedState = id;
  return id;
}

/** 更新 useId，复用挂载阶段记忆化的稳定 ID。 */
function updateId(): string {
  const hook = updateWorkInProgressHook();
  const id: string = hook.memoizedState;
  return id;
}

/** 挂载 cache refresh Hook，并绑定当前 Fiber 形成稳定刷新函数。 */
function mountRefresh(): any {
  const hook = mountWorkInProgressHook();
  const refresh = (hook.memoizedState = refreshCache.bind(
    null,
    currentlyRenderingFiber,
  ));
  return refresh;
}

/** 更新 cache refresh Hook，返回挂载阶段创建的稳定刷新函数。 */
function updateRefresh(): any {
  const hook = updateWorkInProgressHook();
  return hook.memoizedState;
}

/** 向最近 CacheComponent/HostRoot 入队新缓存实例，并可用调用方数据为实验性缓存预填种子。 */
function refreshCache<T>(fiber: Fiber, seedKey: ?() => T, seedValue: T): void {
  // TODO：确认 Cache 是否支持 Legacy 模式并补测试。
  // TODO：离散优先级刷新或疑似未正确批处理时考虑警告。
  let provider = fiber.return;
  while (provider !== null) {
    switch (provider.tag) {
      case CacheComponent:
      case HostRoot: {
        // 在缓存边界安排更新以触发刷新。
        const lane = requestUpdateLane(provider);
        const refreshUpdate = createLegacyQueueUpdate(lane);
        const root = enqueueLegacyQueueUpdate(provider, refreshUpdate, lane);
        if (root !== null) {
          startUpdateTimerByLane(lane, 'refresh()', fiber);
          scheduleUpdateOnFiber(root, provider, lane);
          entangleLegacyQueueTransitions(root, provider, lane);
        }

        // TODO：刷新若始终未提交，必须释放这里创建的新缓存；例如刷新完成前卸载缓存边界。
        const seededCache = createCache();
        if (seedKey !== null && seedKey !== undefined && root !== null) {
          if (enableLegacyCache) {
            // 用调用方传值预填缓存，来源可以是服务端 mutation 或流式响应。
            seededCache.data.set(seedKey, seedValue);
          } else {
            if (__DEV__) {
              console.error(
                'The seed argument is not enabled outside experimental channels.',
              );
            }
          }
        }

        const payload = {
          cache: seededCache,
        };
        refreshUpdate.payload = payload;
        return;
      }
    }
    provider = provider.return;
  }
  // TODO：未找到已挂载缓存边界时是否应警告？
}

/** 为 useReducer 动作选择 lane、构造更新并按渲染阶段或并发路径入队。 */
function dispatchReducerAction<S, A>(
  fiber: Fiber,
  queue: UpdateQueue<S, A>,
  action: A,
): void {
  if (__DEV__) {
    // 引用 arguments 会阻止影响函数 arity 的 GCC 优化，从而保留公开派发函数形状。
    const args = arguments;
    if (typeof args[3] === 'function') {
      console.error(
        "State updates from the useState() and useReducer() Hooks don't support the " +
          'second callback argument. To execute a side effect after ' +
          'rendering, declare it in the component body with useEffect().',
      );
    }
  }

  const lane = requestUpdateLane(fiber);

  const update: Update<S, A> = {
    lane,
    revertLane: NoLane,
    gesture: null,
    action,
    hasEagerState: false,
    eagerState: null,
    next: null as any,
  };

  if (isRenderPhaseUpdate(fiber)) {
    enqueueRenderPhaseUpdate(queue, update);
  } else {
    const root = enqueueConcurrentHookUpdate(fiber, queue, update, lane);
    if (root !== null) {
      startUpdateTimerByLane(lane, 'dispatch()', fiber);
      scheduleUpdateOnFiber(root, fiber, lane);
      entangleTransitionUpdate(root, queue, lane);
    }
  }

  markUpdateInDevTools(fiber, lane, action);
}

/** useState 公开派发入口：选择 lane、尝试调度内部更新并记录 profiler 信息。 */
function dispatchSetState<S, A>(
  fiber: Fiber,
  queue: UpdateQueue<S, A>,
  action: A,
): void {
  if (__DEV__) {
    // 引用 arguments 会阻止影响函数 arity 的 GCC 优化，从而保留公开派发函数形状。
    const args = arguments;
    if (typeof args[3] === 'function') {
      console.error(
        "State updates from the useState() and useReducer() Hooks don't support the " +
          'second callback argument. To execute a side effect after ' +
          'rendering, declare it in the component body with useEffect().',
      );
    }
  }

  const lane = requestUpdateLane(fiber);
  const didScheduleUpdate = dispatchSetStateInternal(
    fiber,
    queue,
    action,
    lane,
  );
  if (didScheduleUpdate) {
    startUpdateTimerByLane(lane, 'setState()', fiber);
  }
  markUpdateInDevTools(fiber, lane, action);
}

/** 构造 state 更新；render-phase 直接入当前环并请求额外 pass，返回 false。事件路径仅在 fiber/alternate 均无 lanes 且存在 lastRenderedReducer 时计算 eagerState，与 lastRenderedState 相等仍保留更新但不调度；eager 抛错先抑制，后续 render 重算。其余入 concurrent staging，找到 root 才 schedule/entangle 并返回 true；参数 lane 已由调用方选择。 */
function dispatchSetStateInternal<S, A>(
  fiber: Fiber,
  queue: UpdateQueue<S, A>,
  action: A,
  lane: Lane,
): boolean {
  const update: Update<S, A> = {
    lane,
    revertLane: NoLane,
    gesture: null,
    action,
    hasEagerState: false,
    eagerState: null,
    next: null as any,
  };

  if (isRenderPhaseUpdate(fiber)) {
    enqueueRenderPhaseUpdate(queue, update);
  } else {
    const alternate = fiber.alternate;
    if (
      fiber.lanes === NoLanes &&
      (alternate === null || alternate.lanes === NoLanes)
    ) {
      // Fiber 与 alternate 都没有待处理 lane，可在进入渲染前 eager 计算下一状态。
      // 队列仍可能留有之前 eager bailout 的无变化更新；此守卫并不检查 pending 是否为空。
      const lastRenderedReducer = queue.lastRenderedReducer;
      if (lastRenderedReducer !== null) {
        let prevDispatcher = null;
        if (__DEV__) {
          prevDispatcher = ReactSharedInternals.H;
          ReactSharedInternals.H = InvalidNestedHooksDispatcherOnUpdateInDEV;
        }
        try {
          const currentState: S = queue.lastRenderedState as any;
          const eagerState = lastRenderedReducer(currentState, action);
          // 保存 eager 结果；updateReducerImpl 处理到该更新时直接复用，不再调用 reducer。
          update.hasEagerState = true;
          update.eagerState = eagerState;
          if (is(eagerState, currentState)) {
            // 状态相等时不安排这次渲染，但仍保留更新。若之后有更高优先级工作插队，
            // 该更新可能进入 baseQueue，后续重放必须保留它在原序列中的位置。
            // TODO：此情况下是否仍需纠缠 transition？
            enqueueConcurrentHookUpdateAndEagerlyBailout(fiber, queue, update);
            return false;
          }
        } catch (error) {
          // 暂时抑制 eager reducer 错误；渲染阶段会再次调用并抛出。
        } finally {
          if (__DEV__) {
            ReactSharedInternals.H = prevDispatcher;
          }
        }
      }
    }

    const root = enqueueConcurrentHookUpdate(fiber, queue, update, lane);
    if (root !== null) {
      scheduleUpdateOnFiber(root, fiber, lane);
      entangleTransitionUpdate(root, queue, lane);
      return true;
    }
  }
  return false;
}

/** 普通乐观项使用 SyncLane，手势上下文使用 GestureLane；revertLane 来自 transition lane，供后续 render 丢弃该项而不是执行反向 reducer。throwIfDuringRender=true（useOptimistic）在 render 调用抛错，false（pending transition）仅 DEV 警告且该乐观项不入队。事件路径先 staging/schedule，再为手势关联稳定 ScheduledGesture/revertLane；无需普通 transition 队列纠缠。 */
function dispatchOptimisticSetState<S, A>(
  fiber: Fiber,
  throwIfDuringRender: boolean,
  queue: UpdateQueue<S, A>,
  action: A,
): void {
  const transition = requestCurrentTransition();

  if (__DEV__) {
    if (transition === null) {
      // 发生乐观更新但调用栈上没有 startTransition，通常有两种情况。

      // 一种是在普通事件处理器（如 onSubmit）而非 action 中触发，这是误用，需要警告。

      // 另一种是在 async action 的 await 之后；可通过关联待完成 async action 让它继续工作。

      // 乐观更新理论上可能与 pending action 无关，但浏览器尚不能跟踪 async scope，无法确认；
      // AsyncContext 提案未来可解决。该局限类似无关 transition 被分为同组：不一定错误，但并不理想。

      // AsyncContext 在浏览器落地后可提供更准确的 DEV 警告。
      if (peekEntangledActionLane() !== NoLane) {
        // 存在 pending async action，推定与其关联，不警告。
      } else {
        // 没有 pending async action，最可能是在普通事件处理器而非 action 中误用。
        console.error(
          'An optimistic state update occurred outside a transition or ' +
            'action. To fix, move the update to an action, or wrap ' +
            'with startTransition.',
        );
      }
    }
  }

  // 普通 transition 的乐观更新同步提交；手势 transition 则在 GestureLane 提交。
  const lane =
    enableGestureTransition && transition !== null && transition.gesture
      ? GestureLane
      : SyncLane;
  const update: Update<S, A> = {
    lane: lane,
    // 提交后使用关联 transition 的 lane 回退乐观更新。
    revertLane: requestTransitionLane(transition),
    gesture: null,
    action,
    hasEagerState: false,
    eagerState: null,
    next: null as any,
  };

  if (isRenderPhaseUpdate(fiber)) {
    // 渲染期间调用 startTransition 只警告，因为改为抛错会破坏兼容；setOptimisticState 是新 API，
    // 可以直接抛错。
    if (throwIfDuringRender) {
      throw new Error('Cannot update optimistic state while rendering.');
    } else {
      // startTransition 在渲染期间调用时只需警告；渲染阶段更新最终会被第二个更新覆盖。
      // 未来版本可删除该兼容分支并改为抛错。
      if (__DEV__) {
        console.error('Cannot call startTransition while rendering.');
      }
    }
  } else {
    const root = enqueueConcurrentHookUpdate(fiber, queue, update, lane);
    if (root !== null) {
      // 普通乐观项使用 SyncLane，手势项使用 GestureLane；回退 transition 不应先于该乐观项尝试。
      // 若未来改变优先级，必须重新处理该顺序约束。
      startUpdateTimerByLane(lane, 'setOptimistic()', fiber);
      scheduleUpdateOnFiber(root, fiber, lane);
      // 乐观项通过 revertLane 关联回退，不走普通 transition 队列的 entangleTransitionUpdate。
      if (enableGestureTransition && transition !== null) {
        const provider = transition.gesture;
        if (provider !== null) {
          // 手势 transition 需确保已调度 ScheduledGesture，并把更新关联到具体手势实例。
          const gesture = (update.gesture = scheduleGesture(root, provider));
          // 同一手势必须始终使用同一 revert lane；不同事件可能对同一 provider 两次调用
          // startGestureTransition，因此需要统一。
          if (gesture.revertLane === NoLane) {
            gesture.revertLane = update.revertLane;
          } else {
            update.revertLane = gesture.revertLane;
          }
        }
      }
    }
  }

  markUpdateInDevTools(fiber, lane, action);
}

/** 判断目标 Fiber 或其 alternate 是否正是当前渲染 Fiber。 */
function isRenderPhaseUpdate(fiber: Fiber): boolean {
  const alternate = fiber.alternate;
  return (
    fiber === currentlyRenderingFiber ||
    (alternate !== null && alternate === currentlyRenderingFiber)
  );
}

/** 把渲染阶段更新追加到队列循环链表，并标记当前 pass 需要从头重渲染。 */
function enqueueRenderPhaseUpdate<S, A>(
  queue: UpdateQueue<S, A>,
  update: Update<S, A>,
): void {
  // 渲染阶段更新暂存在 queue 对应的循环链表；当前 pass 结束后从头开始，
  // 在 work-in-progress Hook 状态之上应用它们。
  didScheduleRenderPhaseUpdateDuringThisPass =
    didScheduleRenderPhaseUpdate = true;
  const pending = queue.pending;
  if (pending === null) {
    // 首个更新自指，创建循环链表。
    update.next = update;
  } else {
    update.next = pending.next;
    pending.next = update;
  }
  queue.pending = update;
}

// TODO：是否移到 ReactFiberConcurrentUpdates？
/** 把 Hook 队列中的 transition lanes 与根上仍 pending 的 lanes 重新纠缠。 */
function entangleTransitionUpdate<S, A>(
  root: FiberRoot,
  queue: UpdateQueue<S, A>,
  lane: Lane,
): void {
  if (isTransitionLane(lane)) {
    let queueLanes = queue.lanes;

    // 已不在根 pendingLanes 中的纠缠 lane 必然已完成，可从共享队列移除。
    // 队列允许是实际 pending lanes 的超集；多纠缠比漏纠缠更安全。
    queueLanes = intersectLanes(queueLanes, root.pendingLanes);

    // 将新 transition lane 与队列中其他 transition lanes 纠缠。
    const newQueueLanes = mergeLanes(queueLanes, lane);
    queue.lanes = newQueueLanes;
    // 即使 queue.lanes 已含该 lane，也无法确认它自上次纠缠后是否完成过，故仍需重新纠缠。
    markRootEntangled(root, newQueueLanes);
  }
}

/** 在启用 Scheduling Profiler 时记录 Hook 状态更新调度。 */
function markUpdateInDevTools<A>(fiber: Fiber, lane: Lane, action: A): void {
  if (enableSchedulingProfiler) {
    markStateUpdateScheduled(fiber, lane);
  }
}

/** 仅允许读取 context/use 的非组件 dispatcher；其他 Hook 调用统一抛出 invalid hook error。 */
export const ContextOnlyDispatcher: Dispatcher = {
  readContext,

  use,
  useCallback: throwInvalidHookError,
  useContext: throwInvalidHookError,
  useEffect: throwInvalidHookError,
  useImperativeHandle: throwInvalidHookError,
  useLayoutEffect: throwInvalidHookError,
  useInsertionEffect: throwInvalidHookError,
  useMemo: throwInvalidHookError,
  useReducer: throwInvalidHookError,
  useRef: throwInvalidHookError,
  useState: throwInvalidHookError,
  useDebugValue: throwInvalidHookError,
  useDeferredValue: throwInvalidHookError,
  useTransition: throwInvalidHookError,
  useSyncExternalStore: throwInvalidHookError,
  useId: throwInvalidHookError,
  useHostTransitionStatus: throwInvalidHookError,
  useFormState: throwInvalidHookError,
  useActionState: throwInvalidHookError,
  useOptimistic: throwInvalidHookError,
  useMemoCache: throwInvalidHookError,
  useCacheRefresh: throwInvalidHookError,
  useEffectEvent: throwInvalidHookError,
};

/** 生产环境挂载 dispatcher：把各 Hook 路由到创建首个 Hook 节点与初始状态的实现。 */
const HooksDispatcherOnMount: Dispatcher = {
  readContext,

  use,
  useCallback: mountCallback,
  useContext: readContext,
  useEffect: mountEffect,
  useImperativeHandle: mountImperativeHandle,
  useLayoutEffect: mountLayoutEffect,
  useInsertionEffect: mountInsertionEffect,
  useMemo: mountMemo,
  useReducer: mountReducer,
  useRef: mountRef,
  useState: mountState,
  useDebugValue: mountDebugValue,
  useDeferredValue: mountDeferredValue,
  useTransition: mountTransition,
  useSyncExternalStore: mountSyncExternalStore,
  useId: mountId,
  useHostTransitionStatus: useHostTransitionStatus,
  useFormState: mountActionState,
  useActionState: mountActionState,
  useOptimistic: mountOptimistic,
  useMemoCache,
  useCacheRefresh: mountRefresh,
  useEffectEvent: mountEvent,
};

/** 生产环境更新 dispatcher：复用既有 Hook 链，并按依赖或队列状态计算本轮结果。 */
const HooksDispatcherOnUpdate: Dispatcher = {
  readContext,

  use,
  useCallback: updateCallback,
  useContext: readContext,
  useEffect: updateEffect,
  useImperativeHandle: updateImperativeHandle,
  useInsertionEffect: updateInsertionEffect,
  useLayoutEffect: updateLayoutEffect,
  useMemo: updateMemo,
  useReducer: updateReducer,
  useRef: updateRef,
  useState: updateState,
  useDebugValue: updateDebugValue,
  useDeferredValue: updateDeferredValue,
  useTransition: updateTransition,
  useSyncExternalStore: updateSyncExternalStore,
  useId: updateId,
  useHostTransitionStatus: useHostTransitionStatus,
  useFormState: updateActionState,
  useActionState: updateActionState,
  useOptimistic: updateOptimistic,
  useMemoCache,
  useCacheRefresh: updateRefresh,
  useEffectEvent: updateEvent,
};

/** 渲染阶段更新触发重渲染时使用的 dispatcher；状态类 Hook 改走 rerender 队列消费路径。 */
const HooksDispatcherOnRerender: Dispatcher = {
  readContext,

  use,
  useCallback: updateCallback,
  useContext: readContext,
  useEffect: updateEffect,
  useImperativeHandle: updateImperativeHandle,
  useInsertionEffect: updateInsertionEffect,
  useLayoutEffect: updateLayoutEffect,
  useMemo: updateMemo,
  useReducer: rerenderReducer,
  useRef: updateRef,
  useState: rerenderState,
  useDebugValue: updateDebugValue,
  useDeferredValue: rerenderDeferredValue,
  useTransition: rerenderTransition,
  useSyncExternalStore: updateSyncExternalStore,
  useId: updateId,
  useHostTransitionStatus: useHostTransitionStatus,
  useFormState: rerenderActionState,
  useActionState: rerenderActionState,
  useOptimistic: rerenderOptimistic,
  useMemoCache,
  useCacheRefresh: updateRefresh,
  useEffectEvent: updateEvent,
};

/** 开发环境挂载 dispatcher：执行 mount 实现，同时记录 Hook 名称、顺序并校验依赖形状。 */
let HooksDispatcherOnMountInDEV: Dispatcher | null = null;
/**
 * 无有状态 Hook 的组件更新时使用的开发 dispatcher。
 * WHY：`memoizedState` 为空无法区分挂载与更新，因此复用 mount 实现，同时按上一轮 `_debugHookTypes` 校验顺序。
 */
let HooksDispatcherOnMountWithHookTypesInDEV: Dispatcher | null = null;
/** 开发环境更新 dispatcher：复用 Hook 链，并将本轮 Hook 类型与上一轮记录逐项比对。 */
let HooksDispatcherOnUpdateInDEV: Dispatcher | null = null;
/** 开发环境重渲染 dispatcher：消费渲染阶段更新，同时继续执行 Hook 顺序诊断。 */
let HooksDispatcherOnRerenderInDEV: Dispatcher | null = null;
/** 挂载期用户回调执行期间的防嵌套 dispatcher；发现其中调用 Hook 时报警并维持挂载语义。 */
let InvalidNestedHooksDispatcherOnMountInDEV: Dispatcher | null = null;
/** 更新期用户回调执行期间的防嵌套 dispatcher；报警后仍沿既有 Hook 链完成诊断路径。 */
let InvalidNestedHooksDispatcherOnUpdateInDEV: Dispatcher | null = null;
/** 重渲染期用户回调执行期间的防嵌套 dispatcher；报警后消费对应渲染阶段更新。 */
let InvalidNestedHooksDispatcherOnRerenderInDEV: Dispatcher | null = null;

if (__DEV__) {
  /** 报告在 render 主体之外、内建 Hook 回调之内读取 Context 的非法调用位置。 */
  const warnInvalidContextAccess = () => {
    console.error(
      'Context can only be read while React is rendering. ' +
        'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
        'In function components, you can read it directly in the function body, but not ' +
        'inside Hooks like useReducer() or useMemo().',
    );
  };

  /** 报告在 Effect、Memo 等内建 Hook 的用户回调里再次调用 Hook 的规则违例。 */
  const warnInvalidHookAccess = () => {
    console.error(
      'Do not call Hooks inside useEffect(...), useMemo(...), or other built-in Hooks. ' +
        'You can only call Hooks at the top level of your React function. ' +
        'For more information, see ' +
        'https://react.dev/link/rules-of-hooks',
    );
  };

  HooksDispatcherOnMountInDEV = {
    /** 挂载期直接读取 Context 当前值；该入口不分配 Hook 节点。 */
    readContext<T>(context: ReactContext<T>): T {
      return readContext(context);
    },
    use,
    /** 登记 `useCallback` 的挂载顺序、校验依赖数组，并把首个 callback/deps 缓存写入 Hook。 */
    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      return mountCallback(callback, deps);
    },
    /** 登记 `useContext` 的挂载顺序，再从当前渲染 Fiber 的 Context 依赖链读取值。 */
    useContext<T>(context: ReactContext<T>): T {
      currentHookNameInDev = 'useContext';
      mountHookTypesDev();
      return readContext(context);
    },
    /** 登记 `useEffect`、校验依赖数组，并把首次被动副作用加入提交后的执行队列。 */
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      return mountEffect(create, deps);
    },
    /** 登记 `useImperativeHandle`、校验依赖，并安排布局阶段写入及清理命令式 ref。 */
    useImperativeHandle<T>(
      ref: {
        /** 保存提交阶段写入的命令式实例；清理时恢复为 `null`。 */
        current: T | null
      } | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      return mountImperativeHandle(ref, create, deps);
    },
    /** 登记 `useInsertionEffect`、校验依赖，并安排其在布局副作用前执行。 */
    useInsertionEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useInsertionEffect';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      return mountInsertionEffect(create, deps);
    },
    /** 登记 `useLayoutEffect`、校验依赖，并安排其在宿主变更后同步执行。 */
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      return mountLayoutEffect(create, deps);
    },
    /** 登记并校验 `useMemo`；计算初值期间临时启用防嵌套 dispatcher，最终恢复原 dispatcher。 */
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      mountHookTypesDev();
      checkDepsAreArrayDev(deps);
      const prevDispatcher = ReactSharedInternals.H;
      ReactSharedInternals.H = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountMemo(create, deps);
      } finally {
        ReactSharedInternals.H = prevDispatcher;
      }
    },
    /** 登记 `useReducer` 并创建状态队列；执行可选初始化器时用防嵌套 dispatcher 捕获非法 Hook。 */
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      mountHookTypesDev();
      const prevDispatcher = ReactSharedInternals.H;
      ReactSharedInternals.H = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountReducer(reducer, initialArg, init);
      } finally {
        ReactSharedInternals.H = prevDispatcher;
      }
    },
    /** 登记 `useRef` 并创建跨渲染复用、写入时不触发调度的 ref 对象。 */
    useRef<T>(initialValue: T): {
      /** 保存跨渲染复用的可变值；修改它不会调度组件更新。 */
      current: T
    } {
      currentHookNameInDev = 'useRef';
      mountHookTypesDev();
      return mountRef(initialValue);
    },
    /** 登记 `useState` 并建立更新队列；调用函数初始化器期间禁止嵌套 Hook。 */
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      mountHookTypesDev();
      const prevDispatcher = ReactSharedInternals.H;
      ReactSharedInternals.H = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountState(initialState);
      } finally {
        ReactSharedInternals.H = prevDispatcher;
      }
    },
    /** 登记 `useDebugValue` 的 Hook 类型；此 dispatcher 不保存 value，DevTools 用独立调试 dispatcher 读取它。 */
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      mountHookTypesDev();
      return mountDebugValue(value, formatterFn);
    },
    /** 登记 `useDeferredValue` 并建立首个延迟值状态，必要时把低优先级工作留到后续渲染。 */
    useDeferredValue<T>(value: T, initialValue?: T): T {
      currentHookNameInDev = 'useDeferredValue';
      mountHookTypesDev();
      return mountDeferredValue(value, initialValue);
    },
    /** 登记 `useTransition`，创建 pending 状态与绑定当前 Fiber 的 transition 启动函数。 */
    useTransition(): [boolean, (() => void) => void] {
      currentHookNameInDev = 'useTransition';
      mountHookTypesDev();
      return mountTransition();
    },
    /** 登记外部 store Hook，读取首个快照并建立订阅及一致性检查。 */
    useSyncExternalStore<T>(
      subscribe: (() => void) => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ): T {
      currentHookNameInDev = 'useSyncExternalStore';
      mountHookTypesDev();
      return mountSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    },
    /** 登记 `useId` 并根据 hydration 或客户端计数器生成本组件的稳定标识。 */
    useId(): string {
      currentHookNameInDev = 'useId';
      mountHookTypesDev();
      return mountId();
    },
    /** 登记旧名 `useFormState`、发出迁移提示，并挂载 Action State 队列。 */
    useFormState<S, P>(
      action: (Awaited<S>, P) => S,
      initialState: Awaited<S>,
      permalink?: string,
    ): [Awaited<S>, (P) => void, boolean] {
      currentHookNameInDev = 'useFormState';
      mountHookTypesDev();
      warnOnUseFormStateInDev();
      return mountActionState(action, initialState, permalink);
    },
    /** 登记 `useActionState` 并挂载串行 action 队列、pending 状态与 dispatch。 */
    useActionState<S, P>(
      action: (Awaited<S>, P) => S,
      initialState: Awaited<S>,
      permalink?: string,
    ): [Awaited<S>, (P) => void, boolean] {
      currentHookNameInDev = 'useActionState';
      mountHookTypesDev();
      return mountActionState(action, initialState, permalink);
    },
    /** 登记 `useOptimistic`，保存 passthrough 基线并创建乐观更新 dispatch。 */
    useOptimistic<S, A>(
      passthrough: S,
      reducer: ?(S, A) => S,
    ): [S, (A) => void] {
      currentHookNameInDev = 'useOptimistic';
      mountHookTypesDev();
      return mountOptimistic(passthrough, reducer);
    },
    useHostTransitionStatus,
    useMemoCache,
    /** 登记 `useCacheRefresh` 并创建向最近 Cache 边界调度刷新更新的稳定回调。 */
    useCacheRefresh() {
      currentHookNameInDev = 'useCacheRefresh';
      mountHookTypesDev();
      return mountRefresh();
    },
    /** 登记 `useEffectEvent`，创建事件包装器及跨渲染共享的实现 ref。 */
    useEffectEvent<Args, Return, F: (...Array<Args>) => Return>(
      callback: F,
    ): F {
      currentHookNameInDev = 'useEffectEvent';
      mountHookTypesDev();
      return mountEvent(callback);
    },
  };

  HooksDispatcherOnMountWithHookTypesInDEV = {
    /** 直接读取 Context；此入口不占用 `_debugHookTypes` 中的 Hook 槽位。 */
    readContext<T>(context: ReactContext<T>): T {
      return readContext(context);
    },
    use,
    /** 按上一轮类型序列核对 `useCallback`；因旧 Fiber 没有有状态 Hook 链，仍以 mount 路径建立缓存。 */
    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      updateHookTypesDev();
      return mountCallback(callback, deps);
    },
    /** 按 `_debugHookTypes` 核对 `useContext` 的位置，再读取当前 Context 值。 */
    useContext<T>(context: ReactContext<T>): T {
      currentHookNameInDev = 'useContext';
      updateHookTypesDev();
      return readContext(context);
    },
    /** 核对 `useEffect` 的历史位置，并以 mount 路径创建本轮被动副作用记录。 */
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      updateHookTypesDev();
      return mountEffect(create, deps);
    },
    /** 核对命令式句柄 Hook 的位置，并以 mount 路径登记 ref 写入与清理。 */
    useImperativeHandle<T>(
      ref: {
        /** 保存布局阶段写入的命令式实例；卸载或依赖变化时清空。 */
        current: T | null
      } | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      updateHookTypesDev();
      return mountImperativeHandle(ref, create, deps);
    },
    /** 核对插入副作用的 Hook 顺序，并创建本轮首次可追踪的 insertion effect。 */
    useInsertionEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useInsertionEffect';
      updateHookTypesDev();
      return mountInsertionEffect(create, deps);
    },
    /** 核对布局副作用的 Hook 顺序，并创建提交布局阶段执行的 effect。 */
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      updateHookTypesDev();
      return mountLayoutEffect(create, deps);
    },
    /** 核对 `useMemo` 类型后建立缓存；运行 create 时切到挂载期防嵌套 dispatcher。 */
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      updateHookTypesDev();
      const prevDispatcher = ReactSharedInternals.H;
      ReactSharedInternals.H = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountMemo(create, deps);
      } finally {
        ReactSharedInternals.H = prevDispatcher;
      }
    },
    /** 核对 `useReducer` 类型并新建队列；初始化器运行期间拦截嵌套 Hook。 */
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      updateHookTypesDev();
      const prevDispatcher = ReactSharedInternals.H;
      ReactSharedInternals.H = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountReducer(reducer, initialArg, init);
      } finally {
        ReactSharedInternals.H = prevDispatcher;
      }
    },
    /** 核对 `useRef` 类型，并在旧 Fiber 无对应状态节点时创建稳定 ref。 */
    useRef<T>(initialValue: T): {
      /** 保存新建的可变引用值；后续更新复用同一对象身份。 */
      current: T
    } {
      currentHookNameInDev = 'useRef';
      updateHookTypesDev();
      return mountRef(initialValue);
    },
    /** 核对 `useState` 类型并建立首个队列；函数初始化器由防嵌套 dispatcher 包裹。 */
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      updateHookTypesDev();
      const prevDispatcher = ReactSharedInternals.H;
      ReactSharedInternals.H = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountState(initialState);
      } finally {
        ReactSharedInternals.H = prevDispatcher;
      }
    },
    /** 核对 `useDebugValue` 在历史 Hook 类型序列中的位置；运行时实现不保存 value。 */
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      updateHookTypesDev();
      return mountDebugValue(value, formatterFn);
    },
    /** 核对延迟值 Hook 的位置，并建立首个 deferred 状态。 */
    useDeferredValue<T>(value: T, initialValue?: T): T {
      currentHookNameInDev = 'useDeferredValue';
      updateHookTypesDev();
      return mountDeferredValue(value, initialValue);
    },
    /** 核对 transition Hook 的位置，并创建 pending 状态及启动函数。 */
    useTransition(): [boolean, (() => void) => void] {
      currentHookNameInDev = 'useTransition';
      updateHookTypesDev();
      return mountTransition();
    },
    /** 核对外部 store Hook 的位置，再建立首个快照、订阅与一致性检查。 */
    useSyncExternalStore<T>(
      subscribe: (() => void) => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ): T {
      currentHookNameInDev = 'useSyncExternalStore';
      updateHookTypesDev();
      return mountSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    },
    /** 核对 `useId` 的历史位置，并生成 hydration/客户端稳定标识。 */
    useId(): string {
      currentHookNameInDev = 'useId';
      updateHookTypesDev();
      return mountId();
    },
    /** 核对 `useActionState` 的位置，并在缺少旧 Hook 节点时挂载 action 队列。 */
    useActionState<S, P>(
      action: (Awaited<S>, P) => S,
      initialState: Awaited<S>,
      permalink?: string,
    ): [Awaited<S>, (P) => void, boolean] {
      currentHookNameInDev = 'useActionState';
      updateHookTypesDev();
      return mountActionState(action, initialState, permalink);
    },
    /** 核对旧名 `useFormState`、发出迁移提示，并挂载同一 Action State 机制。 */
    useFormState<S, P>(
      action: (Awaited<S>, P) => S,
      initialState: Awaited<S>,
      permalink?: string,
    ): [Awaited<S>, (P) => void, boolean] {
      currentHookNameInDev = 'useFormState';
      updateHookTypesDev();
      warnOnUseFormStateInDev();
      return mountActionState(action, initialState, permalink);
    },
    /** 核对乐观状态 Hook 的位置，并创建基线状态与更新 dispatch。 */
    useOptimistic<S, A>(
      passthrough: S,
      reducer: ?(S, A) => S,
    ): [S, (A) => void] {
      currentHookNameInDev = 'useOptimistic';
      updateHookTypesDev();
      return mountOptimistic(passthrough, reducer);
    },
    useHostTransitionStatus,
    useMemoCache,
    /** 核对缓存刷新 Hook 的位置，并创建向 Cache 边界派发更新的回调。 */
    useCacheRefresh() {
      currentHookNameInDev = 'useCacheRefresh';
      updateHookTypesDev();
      return mountRefresh();
    },
    /** 核对 Effect Event Hook 的位置，并挂载事件包装器与共享实现 ref。 */
    useEffectEvent<Args, Return, F: (...Array<Args>) => Return>(
      callback: F,
    ): F {
      currentHookNameInDev = 'useEffectEvent';
      updateHookTypesDev();
      return mountEvent(callback);
    },
  };

  HooksDispatcherOnUpdateInDEV = {
    /** 更新期直接读取 Context 当前值；该入口不推进 Hook 链游标。 */
    readContext<T>(context: ReactContext<T>): T {
      return readContext(context);
    },
    use,
    /** 校验 `useCallback` 的 Hook 顺序，并在依赖相等时复用旧回调，否则更新缓存。 */
    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      updateHookTypesDev();
      return updateCallback(callback, deps);
    },
    /** 校验 `useContext` 的历史位置，再登记当前 Fiber 对 Context 的读取依赖。 */
    useContext<T>(context: ReactContext<T>): T {
      currentHookNameInDev = 'useContext';
      updateHookTypesDev();
      return readContext(context);
    },
    /** 校验 `useEffect` 顺序，并按依赖比较决定复用记录或标记本轮被动副作用。 */
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      updateHookTypesDev();
      return updateEffect(create, deps);
    },
    /** 校验命令式句柄 Hook，并按依赖决定是否重新安排 ref 写入与旧值清理。 */
    useImperativeHandle<T>(
      ref: {
        /** 持有上次提交的命令式实例；依赖变化时先清理再写入新值。 */
        current: T | null
      } | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      updateHookTypesDev();
      return updateImperativeHandle(ref, create, deps);
    },
    /** 校验插入副作用顺序，并仅在依赖变化时给 effect 标记执行位。 */
    useInsertionEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useInsertionEffect';
      updateHookTypesDev();
      return updateInsertionEffect(create, deps);
    },
    /** 校验布局副作用顺序，并仅在依赖变化时安排同步 layout effect。 */
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      updateHookTypesDev();
      return updateLayoutEffect(create, deps);
    },
    /** 校验 `useMemo` 后按依赖复用或重算；重算期间切到更新期防嵌套 dispatcher。 */
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      updateHookTypesDev();
      const prevDispatcher = ReactSharedInternals.H;
      ReactSharedInternals.H = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateMemo(create, deps);
      } finally {
        ReactSharedInternals.H = prevDispatcher;
      }
    },
    /** 校验 `useReducer` 并合并 base/pending 队列；执行用户 reducer 时捕获嵌套 Hook。 */
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      updateHookTypesDev();
      const prevDispatcher = ReactSharedInternals.H;
      ReactSharedInternals.H = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateReducer(reducer, initialArg, init);
      } finally {
        ReactSharedInternals.H = prevDispatcher;
      }
    },
    /** 校验 `useRef` 并返回 Hook 链中已有的稳定 ref，忽略新的 initialValue。 */
    useRef<T>(initialValue: T): {
      /** 持有挂载期创建的可变值；更新期保持对象身份不变。 */
      current: T
    } {
      currentHookNameInDev = 'useRef';
      updateHookTypesDev();
      return updateRef(initialValue);
    },
    /** 校验 `useState` 并处理 BasicStateReducer 队列；用户 updater 运行期间禁止嵌套 Hook。 */
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      updateHookTypesDev();
      const prevDispatcher = ReactSharedInternals.H;
      ReactSharedInternals.H = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateState(initialState);
      } finally {
        ReactSharedInternals.H = prevDispatcher;
      }
    },
    /** 校验 `useDebugValue` 的顺序；运行时实现不保存 value。 */
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      updateHookTypesDev();
      return updateDebugValue(value, formatterFn);
    },
    /** 校验延迟值 Hook，并根据当前 lane 选择立即保留旧值或调度延迟渲染。 */
    useDeferredValue<T>(value: T, initialValue?: T): T {
      currentHookNameInDev = 'useDeferredValue';
      updateHookTypesDev();
      return updateDeferredValue(value, initialValue);
    },
    /** 校验 transition Hook，并从现有 pending 状态与启动函数生成本轮返回值。 */
    useTransition(): [boolean, (() => void) => void] {
      currentHookNameInDev = 'useTransition';
      updateHookTypesDev();
      return updateTransition();
    },
    /** 校验外部 store Hook，读取新快照并更新订阅、实例与一致性检查。 */
    useSyncExternalStore<T>(
      subscribe: (() => void) => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ): T {
      currentHookNameInDev = 'useSyncExternalStore';
      updateHookTypesDev();
      return updateSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    },
    /** 校验 `useId` 的顺序并复用挂载期生成的稳定标识。 */
    useId(): string {
      currentHookNameInDev = 'useId';
      updateHookTypesDev();
      return updateId();
    },
    /** 校验旧名 `useFormState`、提示迁移，并更新 Action State 的 action 引用与队列结果。 */
    useFormState<S, P>(
      action: (Awaited<S>, P) => S,
      initialState: Awaited<S>,
      permalink?: string,
    ): [Awaited<S>, (P) => void, boolean] {
      currentHookNameInDev = 'useFormState';
      updateHookTypesDev();
      warnOnUseFormStateInDev();
      return updateActionState(action, initialState, permalink);
    },
    /** 校验 `useActionState`，消费 action 队列结果并在需要时安排 action 引用副作用。 */
    useActionState<S, P>(
      action: (Awaited<S>, P) => S,
      initialState: Awaited<S>,
      permalink?: string,
    ): [Awaited<S>, (P) => void, boolean] {
      currentHookNameInDev = 'useActionState';
      updateHookTypesDev();
      return updateActionState(action, initialState, permalink);
    },
    /** 校验乐观状态 Hook，并以最新 passthrough 重放尚未完成的乐观更新。 */
    useOptimistic<S, A>(
      passthrough: S,
      reducer: ?(S, A) => S,
    ): [S, (A) => void] {
      currentHookNameInDev = 'useOptimistic';
      updateHookTypesDev();
      return updateOptimistic(passthrough, reducer);
    },
    useHostTransitionStatus,
    useMemoCache,
    /** 校验缓存刷新 Hook，并复用现有的 Cache 边界刷新 dispatch。 */
    useCacheRefresh() {
      currentHookNameInDev = 'useCacheRefresh';
      updateHookTypesDev();
      return updateRefresh();
    },
    /** 校验 Effect Event Hook，并把最新 callback 排入提交期实现更新队列。 */
    useEffectEvent<Args, Return, F: (...Array<Args>) => Return>(
      callback: F,
    ): F {
      currentHookNameInDev = 'useEffectEvent';
      updateHookTypesDev();
      return updateEvent(callback);
    },
  };

  HooksDispatcherOnRerenderInDEV = {
    /** 在 render-phase 更新触发的重渲染中读取 context；context 不占用 Hook 链槽位。 */
    readContext<T>(context: ReactContext<T>): T {
      return readContext(context);
    },
    use,
    /** 记录 useCallback 的 DEV 调用顺序，并沿更新路径按依赖复用回调。 */
    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      updateHookTypesDev();
      return updateCallback(callback, deps);
    },
    /** 记录 useContext 的 DEV 调用顺序，并读取当前 context 值。 */
    useContext<T>(context: ReactContext<T>): T {
      currentHookNameInDev = 'useContext';
      updateHookTypesDev();
      return readContext(context);
    },
    /** 记录 useEffect 的 DEV 调用顺序，并沿更新路径比较依赖、登记被动副作用。 */
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      updateHookTypesDev();
      return updateEffect(create, deps);
    },
    /** 记录 useImperativeHandle 的 DEV 调用顺序，并沿更新路径刷新句柄副作用。 */
    useImperativeHandle<T>(
      ref: {
        /** 暴露给用户的命令式句柄。 */
        current: T | null
      } | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      updateHookTypesDev();
      return updateImperativeHandle(ref, create, deps);
    },
    /** 记录 useInsertionEffect 的 DEV 调用顺序，并沿更新路径比较依赖。 */
    useInsertionEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useInsertionEffect';
      updateHookTypesDev();
      return updateInsertionEffect(create, deps);
    },
    /** 记录 useLayoutEffect 的 DEV 调用顺序，并沿更新路径比较依赖。 */
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      updateHookTypesDev();
      return updateLayoutEffect(create, deps);
    },
    /** 在无效嵌套 dispatcher 保护下执行 useMemo 创建函数，诊断其内部违规调用 Hook。 */
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      updateHookTypesDev();
      const prevDispatcher = ReactSharedInternals.H;
      ReactSharedInternals.H = InvalidNestedHooksDispatcherOnRerenderInDEV;
      try {
        return updateMemo(create, deps);
      } finally {
        ReactSharedInternals.H = prevDispatcher;
      }
    },
    /** 在无效嵌套 dispatcher 保护下重放 reducer 的 render-phase 更新。 */
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      updateHookTypesDev();
      const prevDispatcher = ReactSharedInternals.H;
      ReactSharedInternals.H = InvalidNestedHooksDispatcherOnRerenderInDEV;
      try {
        return rerenderReducer(reducer, initialArg, init);
      } finally {
        ReactSharedInternals.H = prevDispatcher;
      }
    },
    /** 记录 useRef 的 DEV 调用顺序，并返回已挂载的稳定 ref。 */
    useRef<T>(initialValue: T): {
      /** 对用户可变的 ref 槽位。 */
      current: T
    } {
      currentHookNameInDev = 'useRef';
      updateHookTypesDev();
      return updateRef(initialValue);
    },
    /** 在无效嵌套 dispatcher 保护下重放 state 的 render-phase 更新。 */
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      updateHookTypesDev();
      const prevDispatcher = ReactSharedInternals.H;
      ReactSharedInternals.H = InvalidNestedHooksDispatcherOnRerenderInDEV;
      try {
        return rerenderState(initialState);
      } finally {
        ReactSharedInternals.H = prevDispatcher;
      }
    },
    /** 记录 useDebugValue 的 DEV 调用顺序；该 Hook 不产生运行时状态。 */
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      updateHookTypesDev();
      return updateDebugValue(value, formatterFn);
    },
    /** 记录 useDeferredValue 的 DEV 调用顺序，并按重渲染路径计算延迟值。 */
    useDeferredValue<T>(value: T, initialValue?: T): T {
      currentHookNameInDev = 'useDeferredValue';
      updateHookTypesDev();
      return rerenderDeferredValue(value, initialValue);
    },
    /** 记录 useTransition 的 DEV 调用顺序，并读取重渲染期间的 pending 状态。 */
    useTransition(): [boolean, (() => void) => void] {
      currentHookNameInDev = 'useTransition';
      updateHookTypesDev();
      return rerenderTransition();
    },
    /** 记录 useSyncExternalStore 的 DEV 调用顺序，并复查外部 store 当前快照。 */
    useSyncExternalStore<T>(
      subscribe: (() => void) => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ): T {
      currentHookNameInDev = 'useSyncExternalStore';
      updateHookTypesDev();
      return updateSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    },
    /** 记录 useId 的 DEV 调用顺序，并复用当前 Fiber 已挂载的 ID。 */
    useId(): string {
      currentHookNameInDev = 'useId';
      updateHookTypesDev();
      return updateId();
    },
    /** 记录旧名 useFormState 的调用并给出迁移警告，再重放 action state 队列。 */
    useFormState<S, P>(
      action: (Awaited<S>, P) => S,
      initialState: Awaited<S>,
      permalink?: string,
    ): [Awaited<S>, (P) => void, boolean] {
      currentHookNameInDev = 'useFormState';
      updateHookTypesDev();
      warnOnUseFormStateInDev();
      return rerenderActionState(action, initialState, permalink);
    },
    /** 记录 useActionState 的 DEV 调用顺序，并重放串行 action state 队列。 */
    useActionState<S, P>(
      action: (Awaited<S>, P) => S,
      initialState: Awaited<S>,
      permalink?: string,
    ): [Awaited<S>, (P) => void, boolean] {
      currentHookNameInDev = 'useActionState';
      updateHookTypesDev();
      return rerenderActionState(action, initialState, permalink);
    },
    /** 记录 useOptimistic 的 DEV 调用顺序，并重放当前 render pass 的乐观更新。 */
    useOptimistic<S, A>(
      passthrough: S,
      reducer: ?(S, A) => S,
    ): [S, (A) => void] {
      currentHookNameInDev = 'useOptimistic';
      updateHookTypesDev();
      return rerenderOptimistic(passthrough, reducer);
    },
    useHostTransitionStatus,
    useMemoCache,
    /** 记录 useCacheRefresh 的 DEV 调用顺序，并返回稳定的 cache 刷新函数。 */
    useCacheRefresh() {
      currentHookNameInDev = 'useCacheRefresh';
      updateHookTypesDev();
      return updateRefresh();
    },
    /** 记录 useEffectEvent 的 DEV 调用顺序，并排队替换事件实现。 */
    useEffectEvent<Args, Return, F: (...Array<Args>) => Return>(
      callback: F,
    ): F {
      currentHookNameInDev = 'useEffectEvent';
      updateHookTypesDev();
      return updateEvent(callback);
    },
  };

  InvalidNestedHooksDispatcherOnMountInDEV = {
    /** 警告 Hook 内部读取 context，并继续执行读取以保持 DEV 行为可观察。 */
    readContext<T>(context: ReactContext<T>): T {
      warnInvalidContextAccess();
      return readContext(context);
    },
    /** 警告 Hook 内部调用 use，并沿挂载语义消费 usable。 */
    use<T>(usable: Usable<T>): T {
      warnInvalidHookAccess();
      return use(usable);
    },
    /** 警告 Hook 内部调用 useCallback，并记录挂载顺序后创建记忆化回调。 */
    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountCallback(callback, deps);
    },
    /** 警告 Hook 内部调用 useContext，并记录挂载顺序后读取 context。 */
    useContext<T>(context: ReactContext<T>): T {
      currentHookNameInDev = 'useContext';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return readContext(context);
    },
    /** 警告 Hook 内部调用 useEffect，并按挂载路径登记被动副作用。 */
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountEffect(create, deps);
    },
    /** 警告 Hook 内部调用 useImperativeHandle，并按挂载路径登记句柄副作用。 */
    useImperativeHandle<T>(
      ref: {
        /** 暴露给用户的命令式句柄。 */
        current: T | null
      } | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountImperativeHandle(ref, create, deps);
    },
    /** 警告 Hook 内部调用 useInsertionEffect，并按挂载路径登记插入副作用。 */
    useInsertionEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useInsertionEffect';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountInsertionEffect(create, deps);
    },
    /** 警告 Hook 内部调用 useLayoutEffect，并按挂载路径登记布局副作用。 */
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountLayoutEffect(create, deps);
    },
    /** 警告 Hook 内部调用 useMemo，并在无效嵌套 dispatcher 下执行创建函数。 */
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      warnInvalidHookAccess();
      mountHookTypesDev();
      const prevDispatcher = ReactSharedInternals.H;
      ReactSharedInternals.H = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountMemo(create, deps);
      } finally {
        ReactSharedInternals.H = prevDispatcher;
      }
    },
    /** 警告 Hook 内部调用 useReducer，并在无效嵌套 dispatcher 下初始化 reducer。 */
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      warnInvalidHookAccess();
      mountHookTypesDev();
      const prevDispatcher = ReactSharedInternals.H;
      ReactSharedInternals.H = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountReducer(reducer, initialArg, init);
      } finally {
        ReactSharedInternals.H = prevDispatcher;
      }
    },
    /** 警告 Hook 内部调用 useRef，并按挂载路径创建稳定 ref。 */
    useRef<T>(initialValue: T): {
      /** 对用户可变的 ref 槽位。 */
      current: T
    } {
      currentHookNameInDev = 'useRef';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountRef(initialValue);
    },
    /** 警告 Hook 内部调用 useState，并在无效嵌套 dispatcher 下初始化状态。 */
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      warnInvalidHookAccess();
      mountHookTypesDev();
      const prevDispatcher = ReactSharedInternals.H;
      ReactSharedInternals.H = InvalidNestedHooksDispatcherOnMountInDEV;
      try {
        return mountState(initialState);
      } finally {
        ReactSharedInternals.H = prevDispatcher;
      }
    },
    /** 警告 Hook 内部调用 useDebugValue，并记录挂载顺序。 */
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountDebugValue(value, formatterFn);
    },
    /** 警告 Hook 内部调用 useDeferredValue，并按挂载路径计算延迟值。 */
    useDeferredValue<T>(value: T, initialValue?: T): T {
      currentHookNameInDev = 'useDeferredValue';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountDeferredValue(value, initialValue);
    },
    /** 警告 Hook 内部调用 useTransition，并按挂载路径创建 transition 状态。 */
    useTransition(): [boolean, (() => void) => void] {
      currentHookNameInDev = 'useTransition';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountTransition();
    },
    /** 警告 Hook 内部调用 useSyncExternalStore，并按挂载路径建立订阅。 */
    useSyncExternalStore<T>(
      subscribe: (() => void) => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ): T {
      currentHookNameInDev = 'useSyncExternalStore';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    },
    /** 警告 Hook 内部调用 useId，并按挂载路径生成 ID。 */
    useId(): string {
      currentHookNameInDev = 'useId';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountId();
    },
    /** 警告 Hook 内部调用旧名 useFormState，并按挂载路径创建 action 队列。 */
    useFormState<S, P>(
      action: (Awaited<S>, P) => S,
      initialState: Awaited<S>,
      permalink?: string,
    ): [Awaited<S>, (P) => void, boolean] {
      currentHookNameInDev = 'useFormState';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountActionState(action, initialState, permalink);
    },
    /** 警告 Hook 内部调用 useActionState，并按挂载路径创建串行 action 队列。 */
    useActionState<S, P>(
      action: (Awaited<S>, P) => S,
      initialState: Awaited<S>,
      permalink?: string,
    ): [Awaited<S>, (P) => void, boolean] {
      currentHookNameInDev = 'useActionState';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountActionState(action, initialState, permalink);
    },
    /** 警告 Hook 内部调用 useOptimistic，并按挂载路径创建乐观状态。 */
    useOptimistic<S, A>(
      passthrough: S,
      reducer: ?(S, A) => S,
    ): [S, (A) => void] {
      currentHookNameInDev = 'useOptimistic';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountOptimistic(passthrough, reducer);
    },
    /** 警告 Hook 内部调用编译器 memo cache，并返回当前挂载缓存槽位。 */
    useMemoCache(size: number): Array<any> {
      warnInvalidHookAccess();
      return useMemoCache(size);
    },
    useHostTransitionStatus,
    /** 在嵌套挂载上下文中记录并创建稳定 cache refresh 函数。 */
    useCacheRefresh() {
      currentHookNameInDev = 'useCacheRefresh';
      mountHookTypesDev();
      return mountRefresh();
    },
    /** 警告 Hook 内部调用 useEffectEvent，并按挂载路径创建事件包装器。 */
    useEffectEvent<Args, Return, F: (...Array<Args>) => Return>(
      callback: F,
    ): F {
      currentHookNameInDev = 'useEffectEvent';
      warnInvalidHookAccess();
      mountHookTypesDev();
      return mountEvent(callback);
    },
  };

  InvalidNestedHooksDispatcherOnUpdateInDEV = {
    /** 警告 Hook 内部读取 context，并继续执行读取以保持 DEV 行为可观察。 */
    readContext<T>(context: ReactContext<T>): T {
      warnInvalidContextAccess();
      return readContext(context);
    },
    /** 警告 Hook 内部调用 use，并沿更新语义消费 usable。 */
    use<T>(usable: Usable<T>): T {
      warnInvalidHookAccess();
      return use(usable);
    },
    /** 警告 Hook 内部调用 useCallback，并验证顺序后更新记忆化回调。 */
    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateCallback(callback, deps);
    },
    /** 警告 Hook 内部调用 useContext，并验证顺序后读取 context。 */
    useContext<T>(context: ReactContext<T>): T {
      currentHookNameInDev = 'useContext';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return readContext(context);
    },
    /** 警告 Hook 内部调用 useEffect，并按更新路径比较依赖。 */
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateEffect(create, deps);
    },
    /** 警告 Hook 内部调用 useImperativeHandle，并按更新路径刷新句柄副作用。 */
    useImperativeHandle<T>(
      ref: {
        /** 暴露给用户的命令式句柄。 */
        current: T | null
      } | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateImperativeHandle(ref, create, deps);
    },
    /** 警告 Hook 内部调用 useInsertionEffect，并按更新路径比较依赖。 */
    useInsertionEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useInsertionEffect';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateInsertionEffect(create, deps);
    },
    /** 警告 Hook 内部调用 useLayoutEffect，并按更新路径比较依赖。 */
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateLayoutEffect(create, deps);
    },
    /** 警告 Hook 内部调用 useMemo，并在无效嵌套 dispatcher 下更新缓存值。 */
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactSharedInternals.H;
      ReactSharedInternals.H = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateMemo(create, deps);
      } finally {
        ReactSharedInternals.H = prevDispatcher;
      }
    },
    /** 警告 Hook 内部调用 useReducer，并在无效嵌套 dispatcher 下重放 reducer 队列。 */
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactSharedInternals.H;
      ReactSharedInternals.H = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateReducer(reducer, initialArg, init);
      } finally {
        ReactSharedInternals.H = prevDispatcher;
      }
    },
    /** 警告 Hook 内部调用 useRef，并返回已挂载的稳定 ref。 */
    useRef<T>(initialValue: T): {
      /** 对用户可变的 ref 槽位。 */
      current: T
    } {
      currentHookNameInDev = 'useRef';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateRef(initialValue);
    },
    /** 警告 Hook 内部调用 useState，并在无效嵌套 dispatcher 下重放状态队列。 */
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactSharedInternals.H;
      ReactSharedInternals.H = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateState(initialState);
      } finally {
        ReactSharedInternals.H = prevDispatcher;
      }
    },
    /** 警告 Hook 内部调用 useDebugValue，并验证更新顺序。 */
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateDebugValue(value, formatterFn);
    },
    /** 警告 Hook 内部调用 useDeferredValue，并按更新路径处理新值。 */
    useDeferredValue<T>(value: T, initialValue?: T): T {
      currentHookNameInDev = 'useDeferredValue';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateDeferredValue(value, initialValue);
    },
    /** 警告 Hook 内部调用 useTransition，并按更新路径读取 pending。 */
    useTransition(): [boolean, (() => void) => void] {
      currentHookNameInDev = 'useTransition';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateTransition();
    },
    /** 警告 Hook 内部调用 useSyncExternalStore，并按更新路径复查快照。 */
    useSyncExternalStore<T>(
      subscribe: (() => void) => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ): T {
      currentHookNameInDev = 'useSyncExternalStore';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    },
    /** 警告 Hook 内部调用 useId，并复用已挂载 ID。 */
    useId(): string {
      currentHookNameInDev = 'useId';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateId();
    },
    /** 警告 Hook 内部调用旧名 useFormState，并按更新路径处理 action 结果。 */
    useFormState<S, P>(
      action: (Awaited<S>, P) => S,
      initialState: Awaited<S>,
      permalink?: string,
    ): [Awaited<S>, (P) => void, boolean] {
      currentHookNameInDev = 'useFormState';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateActionState(action, initialState, permalink);
    },
    /** 警告 Hook 内部调用 useActionState，并按更新路径处理串行 action。 */
    useActionState<S, P>(
      action: (Awaited<S>, P) => S,
      initialState: Awaited<S>,
      permalink?: string,
    ): [Awaited<S>, (P) => void, boolean] {
      currentHookNameInDev = 'useActionState';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateActionState(action, initialState, permalink);
    },
    /** 警告 Hook 内部调用 useOptimistic，并按更新路径重放乐观状态。 */
    useOptimistic<S, A>(
      passthrough: S,
      reducer: ?(S, A) => S,
    ): [S, (A) => void] {
      currentHookNameInDev = 'useOptimistic';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateOptimistic(passthrough, reducer);
    },
    /** 警告 Hook 内部调用编译器 memo cache，并返回当前更新缓存槽位。 */
    useMemoCache(size: number): Array<any> {
      warnInvalidHookAccess();
      return useMemoCache(size);
    },
    useHostTransitionStatus,
    /** 在嵌套更新上下文中验证顺序并返回稳定 cache refresh 函数。 */
    useCacheRefresh() {
      currentHookNameInDev = 'useCacheRefresh';
      updateHookTypesDev();
      return updateRefresh();
    },
    /** 警告 Hook 内部调用 useEffectEvent，并排队替换事件实现。 */
    useEffectEvent<Args, Return, F: (...Array<Args>) => Return>(
      callback: F,
    ): F {
      currentHookNameInDev = 'useEffectEvent';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateEvent(callback);
    },
  };

  InvalidNestedHooksDispatcherOnRerenderInDEV = {
    /** 警告 Hook 内部读取 context，并继续执行读取以保持 DEV 行为可观察。 */
    readContext<T>(context: ReactContext<T>): T {
      warnInvalidContextAccess();
      return readContext(context);
    },
    /** 警告 Hook 内部调用 use，并沿重渲染语义消费 usable。 */
    use<T>(usable: Usable<T>): T {
      warnInvalidHookAccess();
      return use(usable);
    },
    /** 警告 Hook 内部调用 useCallback，并验证重渲染顺序后更新回调。 */
    useCallback<T>(callback: T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useCallback';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateCallback(callback, deps);
    },
    /** 警告 Hook 内部调用 useContext，并验证重渲染顺序后读取 context。 */
    useContext<T>(context: ReactContext<T>): T {
      currentHookNameInDev = 'useContext';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return readContext(context);
    },
    /** 警告 Hook 内部调用 useEffect，并按更新路径比较依赖。 */
    useEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useEffect';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateEffect(create, deps);
    },
    /** 警告 Hook 内部调用 useImperativeHandle，并按更新路径刷新句柄副作用。 */
    useImperativeHandle<T>(
      ref: {
        /** 暴露给用户的命令式句柄。 */
        current: T | null
      } | ((inst: T | null) => mixed) | null | void,
      create: () => T,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useImperativeHandle';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateImperativeHandle(ref, create, deps);
    },
    /** 警告 Hook 内部调用 useInsertionEffect，并按更新路径比较依赖。 */
    useInsertionEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useInsertionEffect';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateInsertionEffect(create, deps);
    },
    /** 警告 Hook 内部调用 useLayoutEffect，并按更新路径比较依赖。 */
    useLayoutEffect(
      create: () => (() => void) | void,
      deps: Array<mixed> | void | null,
    ): void {
      currentHookNameInDev = 'useLayoutEffect';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateLayoutEffect(create, deps);
    },
    /** 警告 Hook 内部调用 useMemo，并在无效嵌套 dispatcher 下复用或更新缓存值。 */
    useMemo<T>(create: () => T, deps: Array<mixed> | void | null): T {
      currentHookNameInDev = 'useMemo';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactSharedInternals.H;
      ReactSharedInternals.H = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return updateMemo(create, deps);
      } finally {
        ReactSharedInternals.H = prevDispatcher;
      }
    },
    /** 警告 Hook 内部调用 useReducer，并应用当前 render pass 的队列更新。 */
    useReducer<S, I, A>(
      reducer: (S, A) => S,
      initialArg: I,
      init?: I => S,
    ): [S, Dispatch<A>] {
      currentHookNameInDev = 'useReducer';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactSharedInternals.H;
      ReactSharedInternals.H = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return rerenderReducer(reducer, initialArg, init);
      } finally {
        ReactSharedInternals.H = prevDispatcher;
      }
    },
    /** 警告 Hook 内部调用 useRef，并返回已挂载的稳定 ref。 */
    useRef<T>(initialValue: T): {
      /** 对用户可变的 ref 槽位。 */
      current: T
    } {
      currentHookNameInDev = 'useRef';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateRef(initialValue);
    },
    /** 警告 Hook 内部调用 useState，并应用当前 render pass 的状态更新。 */
    useState<S>(
      initialState: (() => S) | S,
    ): [S, Dispatch<BasicStateAction<S>>] {
      currentHookNameInDev = 'useState';
      warnInvalidHookAccess();
      updateHookTypesDev();
      const prevDispatcher = ReactSharedInternals.H;
      ReactSharedInternals.H = InvalidNestedHooksDispatcherOnUpdateInDEV;
      try {
        return rerenderState(initialState);
      } finally {
        ReactSharedInternals.H = prevDispatcher;
      }
    },
    /** 警告 Hook 内部调用 useDebugValue，并验证重渲染顺序。 */
    useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void {
      currentHookNameInDev = 'useDebugValue';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateDebugValue(value, formatterFn);
    },
    /** 警告 Hook 内部调用 useDeferredValue，并按重渲染路径计算延迟值。 */
    useDeferredValue<T>(value: T, initialValue?: T): T {
      currentHookNameInDev = 'useDeferredValue';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return rerenderDeferredValue(value, initialValue);
    },
    /** 警告 Hook 内部调用 useTransition，并按重渲染路径读取 pending。 */
    useTransition(): [boolean, (() => void) => void] {
      currentHookNameInDev = 'useTransition';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return rerenderTransition();
    },
    /** 警告 Hook 内部调用 useSyncExternalStore，并复查当前快照。 */
    useSyncExternalStore<T>(
      subscribe: (() => void) => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ): T {
      currentHookNameInDev = 'useSyncExternalStore';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    },
    /** 警告 Hook 内部调用 useId，并复用已挂载 ID。 */
    useId(): string {
      currentHookNameInDev = 'useId';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateId();
    },
    /** 警告 Hook 内部调用旧名 useFormState，并按重渲染路径处理 action。 */
    useFormState<S, P>(
      action: (Awaited<S>, P) => S,
      initialState: Awaited<S>,
      permalink?: string,
    ): [Awaited<S>, (P) => void, boolean] {
      currentHookNameInDev = 'useFormState';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return rerenderActionState(action, initialState, permalink);
    },
    /** 警告 Hook 内部调用 useActionState，并按重渲染路径处理串行 action。 */
    useActionState<S, P>(
      action: (Awaited<S>, P) => S,
      initialState: Awaited<S>,
      permalink?: string,
    ): [Awaited<S>, (P) => void, boolean] {
      currentHookNameInDev = 'useActionState';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return rerenderActionState(action, initialState, permalink);
    },
    /** 警告 Hook 内部调用 useOptimistic，并按重渲染路径重放乐观队列。 */
    useOptimistic<S, A>(
      passthrough: S,
      reducer: ?(S, A) => S,
    ): [S, (A) => void] {
      currentHookNameInDev = 'useOptimistic';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return rerenderOptimistic(passthrough, reducer);
    },
    /** 警告 Hook 内部调用编译器 memo cache，并返回当前重渲染缓存槽位。 */
    useMemoCache(size: number): Array<any> {
      warnInvalidHookAccess();
      return useMemoCache(size);
    },
    useHostTransitionStatus,
    /** 在嵌套重渲染上下文中验证顺序并返回稳定 cache refresh 函数。 */
    useCacheRefresh() {
      currentHookNameInDev = 'useCacheRefresh';
      updateHookTypesDev();
      return updateRefresh();
    },
    /** 警告 Hook 内部调用 useEffectEvent，并排队替换事件实现。 */
    useEffectEvent<Args, Return, F: (...Array<Args>) => Return>(
      callback: F,
    ): F {
      currentHookNameInDev = 'useEffectEvent';
      warnInvalidHookAccess();
      updateHookTypesDev();
      return updateEvent(callback);
    },
  };
}
