/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactElement} from 'shared/ReactElementType';
import type {
  ReactFragment,
  ReactPortal,
  ReactScope,
  ViewTransitionProps,
  ActivityProps,
  ReactKey,
} from 'shared/ReactTypes';
import type {Fiber} from './ReactInternalTypes';
import type {RootTag} from './ReactRootTags';
import type {WorkTag} from './ReactWorkTags';
import type {TypeOfMode} from './ReactTypeOfMode';
import type {Lanes} from './ReactFiberLane';
import type {ActivityInstance, SuspenseInstance} from './ReactFiberConfig';
import type {
  LegacyHiddenProps,
  OffscreenProps,
} from './ReactFiberOffscreenComponent';
import type {ViewTransitionState} from './ReactFiberViewTransitionComponent';
import type {TracingMarkerInstance} from './ReactFiberTracingMarkerComponent';

import {
  supportsResources,
  supportsSingletons,
  isHostHoistableType,
  isHostSingletonType,
} from './ReactFiberConfig';
import {
  enableProfilerTimer,
  enableScopeAPI,
  enableLegacyHidden,
  enableTransitionTracing,
  disableLegacyMode,
  enableObjectFiber,
  enableViewTransition,
  enableSuspenseyImages,
  enableOptimisticKey,
} from 'shared/ReactFeatureFlags';
import {NoFlags, Placement, StaticMask} from './ReactFiberFlags';
import {ConcurrentRoot} from './ReactRootTags';
import {
  ClassComponent,
  HostRoot,
  HostComponent,
  HostText,
  HostPortal,
  HostHoistable,
  HostSingleton,
  ForwardRef,
  Fragment,
  Mode,
  ContextProvider,
  ContextConsumer,
  Profiler,
  SuspenseComponent,
  SuspenseListComponent,
  DehydratedFragment,
  FunctionComponent,
  MemoComponent,
  SimpleMemoComponent,
  LazyComponent,
  ScopeComponent,
  OffscreenComponent,
  LegacyHiddenComponent,
  TracingMarkerComponent,
  Throw,
  ViewTransitionComponent,
  ActivityComponent,
} from './ReactWorkTags';
import {getComponentNameFromOwner} from 'react-reconciler/src/getComponentNameFromFiber';
import {isDevToolsPresent} from './ReactFiberDevToolsHook';
import {resolveTypeForHotReloading} from './ReactFiberHotReloading';
import {NoLanes} from './ReactFiberLane';
import {
  NoMode,
  ConcurrentMode,
  ProfileMode,
  StrictLegacyMode,
  StrictEffectsMode,
  SuspenseyImagesMode,
} from './ReactTypeOfMode';
import {
  REACT_FORWARD_REF_TYPE,
  REACT_FRAGMENT_TYPE,
  REACT_STRICT_MODE_TYPE,
  REACT_PROFILER_TYPE,
  REACT_CONTEXT_TYPE,
  REACT_CONSUMER_TYPE,
  REACT_SUSPENSE_TYPE,
  REACT_SUSPENSE_LIST_TYPE,
  REACT_MEMO_TYPE,
  REACT_LAZY_TYPE,
  REACT_SCOPE_TYPE,
  REACT_LEGACY_HIDDEN_TYPE,
  REACT_TRACING_MARKER_TYPE,
  REACT_ELEMENT_TYPE,
  REACT_VIEW_TRANSITION_TYPE,
  REACT_ACTIVITY_TYPE,
} from 'shared/ReactSymbols';
import {TransitionTracingMarker} from './ReactFiberTracingMarkerComponent';
import {getHostContext} from './ReactFiberHostContext';
import type {ReactComponentInfo} from '../../shared/ReactTypes';
import isArray from 'shared/isArray';
import getComponentNameFromType from 'shared/getComponentNameFromType';

export type {Fiber};

/** 开发期探测 Map/Set polyfill 是否拒绝不可扩展对象；异常 polyfill 会禁用 Fiber preventExtensions。 */
let hasBadMapPolyfill;

if (__DEV__) {
  hasBadMapPolyfill = false;
  try {
    const nonExtensibleObject = Object.preventExtensions({});
    // eslint-disable-next-line no-new
    new Map([[nonExtensibleObject, null]]);
    // eslint-disable-next-line no-new
    new Set([nonExtensibleObject]);
  } catch (e) {
    // TODO：评估是否向使用不兼容 Map/Set polyfill 的开发构建输出警告。
    hasBadMapPolyfill = true;
  }
}

/**
 * 初始化一枚空 Fiber 节点。
 *
 * 构造时只建立固定对象形状与中性状态；type、stateNode、lanes 等由具体 createFiberFrom* 路径写入。
 * current/work-in-progress 双缓冲通过 alternate 连接，不在构造器中递归创建。
 * tag 决定各阶段分派，key 用于同级身份匹配，pendingProps 是本轮待消费输入，mode 继承父子树运行模式。
 */
function FiberNode(
  this: $FlowFixMe,
  tag: WorkTag,
  pendingProps: mixed,
  key: ReactKey,
  mode: TypeOfMode,
) {
  // 元素/宿主实例身份。
  this.tag = tag;
  this.key = key;
  this.elementType = null;
  this.type = null;
  this.stateNode = null;

  // 树结构与协调状态。
  this.return = null;
  this.child = null;
  this.sibling = null;
  this.index = 0;

  this.ref = null;
  this.refCleanup = null;

  this.pendingProps = pendingProps;
  this.memoizedProps = null;
  this.updateQueue = null;
  this.memoizedState = null;
  this.dependencies = null;

  this.mode = mode;

  // 本节点与子树的 commit effects。
  this.flags = NoFlags;
  this.subtreeFlags = NoFlags;
  this.deletions = null;

  this.lanes = NoLanes;
  this.childLanes = NoLanes;

  this.alternate = null;

  if (enableProfilerTimer) {
    // 这些字段故意以 double 初始化，避免先写 SMI、后写 double 时与 Object.preventExtensions
    // 共同触发 V8 对象 shape 分裂的性能断崖。问题主要影响 DEV，但可让部分应用几乎不可用。
    // 详情：
    // https://github.com/facebook/react/issues/14365
    // https://bugs.chromium.org/p/v8/issues/detail?id=8538

    this.actualDuration = -0;
    this.actualStartTime = -1.1;
    this.selfBaseDuration = -0;
    this.treeBaseDuration = -0;
  }

  if (__DEV__) {
    // 以下字段不参与生产协调，仅保存 owner、调用栈、task 与 hooks 等调试信息。
    this._debugInfo = null;
    this._debugOwner = null;
    this._debugStack = null;
    this._debugTask = null;
    this._debugNeedsRemount = false;
    this._debugHookTypes = null;
    if (!hasBadMapPolyfill && typeof Object.preventExtensions === 'function') {
      Object.preventExtensions(this);
    }
  }
}

// Fiber 表示必须满足这些约束：不增加实例方法（静态编译器难以内联且优化不可预测）；不使用
// instanceof 识别；保留尝试数字键的空间；构造函数与对象字面量可按性能开关互换；字段布局应易于
// 映射为兼容的 C struct。
/** 使用固定构造函数创建 Fiber；用于与对象字面量实现做构建级性能比较。 */
function createFiberImplClass(
  tag: WorkTag,
  pendingProps: mixed,
  key: ReactKey,
  mode: TypeOfMode,
): Fiber {
  // $FlowFixMe[invalid-constructor]: the shapes are exact here but Flow doesn't like constructors
  return new FiberNode(tag, pendingProps, key, mode);
}

/**
 * 使用对象字面量创建与 FiberNode 相同字段布局的 Fiber。
 * 动态字段放在末尾可生成更紧凑的 Hermes bytecode；语义必须与 class 实现完全一致。
 */
function createFiberImplObject(
  tag: WorkTag,
  pendingProps: mixed,
  key: ReactKey,
  mode: TypeOfMode,
): Fiber {
  const fiber: Fiber = {
    // 元素/宿主实例身份；tag、key 在末尾作为动态属性写入。
    elementType: null,
    type: null,
    stateNode: null,

    // 树结构与协调状态。
    return: null,
    child: null,
    sibling: null,
    index: 0,

    ref: null,
    refCleanup: null,

    // pendingProps 在末尾作为动态属性写入。
    memoizedProps: null,
    updateQueue: null,
    memoizedState: null,
    dependencies: null,

    // 本节点与子树的 commit effects。
    flags: NoFlags,
    subtreeFlags: NoFlags,
    deletions: null,

    lanes: NoLanes,
    childLanes: NoLanes,

    alternate: null,

    // 动态属性集中在末尾，减少 Hermes bytecode 体积。
    tag,
    key,
    pendingProps,
    mode,
  };

  if (enableProfilerTimer) {
    fiber.actualDuration = -0;
    fiber.actualStartTime = -1.1;
    fiber.selfBaseDuration = -0;
    fiber.treeBaseDuration = -0;
  }

  if (__DEV__) {
    // 仅开发诊断使用的字段。
    fiber._debugInfo = null;
    fiber._debugOwner = null;
    fiber._debugStack = null;
    fiber._debugTask = null;
    fiber._debugNeedsRemount = false;
    fiber._debugHookTypes = null;
    if (!hasBadMapPolyfill && typeof Object.preventExtensions === 'function') {
      Object.preventExtensions(fiber);
    }
  }
  return fiber;
}

/** 当前构建选定的 Fiber 分配实现；两条路径必须产生等价字段与初值。 */
const createFiber = enableObjectFiber
  ? createFiberImplObject
  : createFiberImplClass;

/** 通过 React class prototype 标记判断函数是否应按 class component 构造。 */
function shouldConstruct(Component: Function) {
  const prototype = Component.prototype;
  return !!(prototype && prototype.isReactComponent);
}

/** 判断类型是否可走“无 defaultProps 的普通函数组件”快速路径。 */
export function isSimpleFunctionComponent(type: any): boolean {
  return (
    typeof type === 'function' &&
    !shouldConstruct(type) &&
    type.defaultProps === undefined
  );
}

/** 判断函数类型是否带 React class component 原型标记。 */
export function isFunctionClassComponent(
  type: (...args: Array<any>) => mixed,
): boolean {
  return shouldConstruct(type);
}

/**
 * 取得或复用 current 的 alternate，建立本轮可写 work-in-progress。
 *
 * 第一次更新惰性分配第二个 Fiber；后续轮复用 alternate。动态 effects 被清空，跨轮静态 flags、
 * memoized 状态、lanes 与树指针从 current 复制；render 中会修改的 dependencies 必须浅克隆。
 */
export function createWorkInProgress(current: Fiber, pendingProps: any): Fiber {
  let workInProgress = current.alternate;
  if (workInProgress === null) {
    // 一棵树最多需要 current 与候选树两版；惰性分配“另一面”可避免从未更新节点的额外对象，
    // 之后每轮复用这枚 alternate，形成双缓冲池。
    workInProgress = createFiber(
      current.tag,
      pendingProps,
      current.key,
      current.mode,
    );
    workInProgress.elementType = current.elementType;
    workInProgress.type = current.type;
    workInProgress.stateNode = current.stateNode;

    if (__DEV__) {
      // 复制只服务开发归因的字段。

      workInProgress._debugOwner = current._debugOwner;
      workInProgress._debugStack = current._debugStack;
      workInProgress._debugTask = current._debugTask;
      workInProgress._debugHookTypes = current._debugHookTypes;
    }

    workInProgress.alternate = current;
    current.alternate = workInProgress;
  } else {
    workInProgress.pendingProps = pendingProps;
    // type 可能被开发期热更新解析改写，每轮先恢复 current 的值。
    workInProgress.type = current.type;

    // alternate 已存在，先清除上一轮动态 effect。
    workInProgress.flags = NoFlags;

    // 子树聚合与 deletions 只属于上一轮 render，不能复用。
    workInProgress.subtreeFlags = NoFlags;
    workInProgress.deletions = null;

    if (enableOptimisticKey) {
      // optimistic key 解析前后两面可能临时不同，每轮从 current 恢复权威 key。
      workInProgress.key = current.key;
    }

    if (enableProfilerTimer) {
      // actualDuration/startTime 属于本轮尝试，必须重置而非复制，避免跨 commit 无限累计；
      // 不同优先级重启会丢弃先前值，但常见 yield/resume 可正确累计。
      workInProgress.actualDuration = -0;
      workInProgress.actualStartTime = -1.1;
    }
  }

  // 只保留不依赖单次 render 的静态 flags。
  workInProgress.flags = current.flags & StaticMask;
  workInProgress.childLanes = current.childLanes;
  workInProgress.lanes = current.lanes;

  workInProgress.child = current.child;
  workInProgress.memoizedProps = current.memoizedProps;
  workInProgress.memoizedState = current.memoizedState;
  workInProgress.updateQueue = current.updateQueue;

  // dependencies 会在 render 中修改，不能与 current 共享对象；其中 context 链节点本身只读，可浅复制头指针。
  const currentDependencies = current.dependencies;
  workInProgress.dependencies =
    currentDependencies === null
      ? null
      : __DEV__
        ? {
            lanes: currentDependencies.lanes,
            firstContext: currentDependencies.firstContext,
            _debugThenableState: currentDependencies._debugThenableState,
          }
        : {
            lanes: currentDependencies.lanes,
            firstContext: currentDependencies.firstContext,
          };

  // 父 Fiber 协调 children 时会重写这些结构位置；先从 current 提供可回退初值。
  workInProgress.sibling = current.sibling;
  workInProgress.index = current.index;
  workInProgress.ref = current.ref;
  workInProgress.refCleanup = current.refCleanup;

  if (enableProfilerTimer) {
    workInProgress.selfBaseDuration = current.selfBaseDuration;
    workInProgress.treeBaseDuration = current.treeBaseDuration;
  }

  if (__DEV__) {
    workInProgress._debugInfo = current._debugInfo;
    workInProgress._debugNeedsRemount = current._debugNeedsRemount;
    switch (workInProgress.tag) {
      case FunctionComponent:
      case SimpleMemoComponent:
      case MemoComponent:
      case ClassComponent:
      case ForwardRef:
        workInProgress.type = resolveTypeForHotReloading(current.type);
        break;
      default:
        break;
    }
  }

  return workInProgress;
}

/**
 * 把一次未完成 render 的 work-in-progress 恢复到第二次 pass 可用的起点。
 *
 * 无 alternate 的新 Fiber 清除首次尝试产生的 child/state/queue，并恢复 renderLanes；
 * 已有 alternate 的 Fiber 从 current 恢复可重用状态。pendingProps、结构位置与 ref 由父级协调确定，
 * 这里保留；Placement 与静态 flags 同样保留。实际耗时继续累计，基准耗时按有无 current 恢复。
 */
export function resetWorkInProgress(
  workInProgress: Fiber,
  renderLanes: Lanes,
): Fiber {
  // 理想状态下所有路径都应从 current 读、向 work-in-progress 写；现有路径仍会读取候选树，
  // 因此第二次 pass 前必须显式复原。

  // pendingProps、index、key、ref 与 return 假定未被破坏，以免重新执行父级 reconciliation。

  // 清除本轮 effects，但保留 child reconciliation 已确定的 Placement 与跨轮静态位。
  workInProgress.flags &= StaticMask | Placement;

  // 其余 effect 聚合均已失效。

  const current = workInProgress.alternate;
  if (current === null) {
    // 无 alternate 表示本轮新建，恢复 createFiber 初值并保留本次 renderLanes。
    workInProgress.childLanes = NoLanes;
    workInProgress.lanes = renderLanes;

    workInProgress.child = null;
    workInProgress.subtreeFlags = NoFlags;
    workInProgress.memoizedProps = null;
    workInProgress.memoizedState = null;
    workInProgress.updateQueue = null;

    workInProgress.dependencies = null;

    workInProgress.stateNode = null;

    if (enableProfilerTimer) {
      // actualDuration/startTime 不在此重置，Profiler 需要累计同一更新的多次 render pass；
      // base duration 则回到新 Fiber 初值。
      workInProgress.selfBaseDuration = 0;
      workInProgress.treeBaseDuration = 0;
    }
  } else {
    // 有 alternate 时恢复 createWorkInProgress 应从 current 克隆的值。
    workInProgress.childLanes = current.childLanes;
    workInProgress.lanes = current.lanes;

    workInProgress.child = current.child;
    workInProgress.subtreeFlags = NoFlags;
    workInProgress.deletions = null;
    workInProgress.memoizedProps = current.memoizedProps;
    workInProgress.memoizedState = current.memoizedState;
    workInProgress.updateQueue = current.updateQueue;
    // 历史 Blocks 曾把数据存到 type；Blocks 已移除，TODO：复核该复制是否仍有必要。
    workInProgress.type = current.type;

    if (enableOptimisticKey) {
      // optimistic key 的两面可能处于 sentinel/已解析两态，恢复 current 的权威值。
      workInProgress.key = current.key;
    }

    // dependencies 会在 render 中修改，因此与 current 分离；内部只读链可共享。
    const currentDependencies = current.dependencies;
    workInProgress.dependencies =
      currentDependencies === null
        ? null
        : __DEV__
          ? {
              lanes: currentDependencies.lanes,
              firstContext: currentDependencies.firstContext,
              _debugThenableState: currentDependencies._debugThenableState,
            }
          : {
              lanes: currentDependencies.lanes,
              firstContext: currentDependencies.firstContext,
            };

    if (enableProfilerTimer) {
      // 保留实际耗时累计，只恢复 current 的 base duration。
      workInProgress.selfBaseDuration = current.selfBaseDuration;
      workInProgress.treeBaseDuration = current.treeBaseDuration;
    }
  }

  return workInProgress;
}

/** 创建 HostRoot Fiber，并按 root tag、StrictMode 与 profiling 环境组合 mode 位。 */
export function createHostRootFiber(
  tag: RootTag,
  isStrictMode: boolean,
): Fiber {
  let mode: number;
  if (disableLegacyMode || tag === ConcurrentRoot) {
    mode = ConcurrentMode;
    if (isStrictMode === true) {
      mode |= StrictLegacyMode | StrictEffectsMode;
    }
  } else {
    mode = NoMode;
  }

  if (__DEV__ || (enableProfilerTimer && isDevToolsPresent)) {
    // DEV 默认启用 profiling instrumentation；profile 构建在 DevTools 存在或子树包裹 Profiler 时启用；
    // 普通生产构建关闭。
    mode |= ProfileMode;
  }

  return createFiber(HostRoot, null, null, mode);
}

// TODO：收敛为只允许 createFiberFromElement 入口，减少绕过 element 归因字段的调用。
/**
 * 把 element type、props 与 mode 分类成具体 WorkTag 并创建 Fiber。
 *
 * 函数/class/宿主字符串走直接分类；React 特殊 Symbol 与 $$typeof 描述对象走协议分派；
 * 非法类型创建 Throw Fiber，让错误在 child 的 begin 阶段抛出并保留 JSX owner/stack 归因。
 * type 保存在 elementType 作为协调身份，type 字段保存解析实现（lazy 暂为空）；
 * key 是同级身份，mode 是继承环境，lanes 标记首次 render 范围，owner 仅供开发错误归因。
 */
export function createFiberFromTypeAndProps(
  type: any, // React$ElementType
  key: ReactKey,
  pendingProps: any,
  owner: null | ReactComponentInfo | Fiber,
  mode: TypeOfMode,
  lanes: Lanes,
): Fiber {
  let fiberTag: WorkTag = FunctionComponent;
  // resolvedType 表示已知最终实现的类型；lazy 在初始化前必须保持 null。
  let resolvedType = type;
  if (__DEV__) {
    resolvedType = resolveTypeForHotReloading(type);
  }
  if (typeof resolvedType === 'function') {
    if (shouldConstruct(resolvedType)) {
      fiberTag = ClassComponent;
    }
  } else if (typeof resolvedType === 'string') {
    // $FlowFixMe[constant-condition]
    if (supportsResources && supportsSingletons) {
      const hostContext = getHostContext();
      fiberTag = isHostHoistableType(type, pendingProps, hostContext)
        ? HostHoistable
        : isHostSingletonType(type)
          ? HostSingleton
          : HostComponent;
      // $FlowFixMe[constant-condition]
    } else if (supportsResources) {
      const hostContext = getHostContext();
      fiberTag = isHostHoistableType(type, pendingProps, hostContext)
        ? HostHoistable
        : HostComponent;
      // $FlowFixMe[constant-condition]
    } else if (supportsSingletons) {
      fiberTag = isHostSingletonType(type) ? HostSingleton : HostComponent;
    } else {
      fiberTag = HostComponent;
    }
  } else {
    getTag: switch (resolvedType) {
      // $FlowFixMe[invalid-compare]
      case REACT_ACTIVITY_TYPE:
        return createFiberFromActivity(pendingProps, mode, lanes, key);
      // $FlowFixMe[invalid-compare]
      case REACT_FRAGMENT_TYPE:
        return createFiberFromFragment(pendingProps.children, mode, lanes, key);
      // $FlowFixMe[invalid-compare]
      case REACT_STRICT_MODE_TYPE:
        fiberTag = Mode;
        mode |= StrictLegacyMode;
        if (disableLegacyMode || (mode & ConcurrentMode) !== NoMode) {
          // legacy root 永远不能启用 StrictEffects 的重复 effect 检查。
          mode |= StrictEffectsMode;
        }
        break;
      // $FlowFixMe[invalid-compare]
      case REACT_PROFILER_TYPE:
        return createFiberFromProfiler(pendingProps, mode, lanes, key);
      // $FlowFixMe[invalid-compare]
      case REACT_SUSPENSE_TYPE:
        return createFiberFromSuspense(pendingProps, mode, lanes, key);
      // $FlowFixMe[invalid-compare]
      case REACT_SUSPENSE_LIST_TYPE:
        return createFiberFromSuspenseList(pendingProps, mode, lanes, key);
      // $FlowFixMe[invalid-compare]
      case REACT_LEGACY_HIDDEN_TYPE:
        if (enableLegacyHidden) {
          return createFiberFromLegacyHidden(pendingProps, mode, lanes, key);
        }
      // $FlowFixMe[invalid-compare] -- falls through
      case REACT_VIEW_TRANSITION_TYPE:
        if (enableViewTransition) {
          return createFiberFromViewTransition(pendingProps, mode, lanes, key);
        }
      // $FlowFixMe[invalid-compare] -- falls through
      case REACT_SCOPE_TYPE:
        if (enableScopeAPI) {
          return createFiberFromScope(type, pendingProps, mode, lanes, key);
        }
      // $FlowFixMe[invalid-compare] -- falls through
      case REACT_TRACING_MARKER_TYPE:
        if (enableTransitionTracing) {
          return createFiberFromTracingMarker(pendingProps, mode, lanes, key);
        }
      // 未启用对应实验类型时继续进入普通描述对象或非法类型处理。
      default: {
        // $FlowFixMe[invalid-compare]
        if (typeof resolvedType === 'object' && resolvedType !== null) {
          switch (resolvedType.$$typeof) {
            // $FlowFixMe[invalid-compare]
            case REACT_CONTEXT_TYPE:
              fiberTag = ContextProvider;
              break getTag;
            // $FlowFixMe[invalid-compare]
            case REACT_CONSUMER_TYPE:
              fiberTag = ContextConsumer;
              break getTag;
            // Context 标记不匹配时继续检查其余 $$typeof 包装对象。
            // $FlowFixMe[invalid-compare]
            case REACT_FORWARD_REF_TYPE:
              fiberTag = ForwardRef;
              break getTag;
            // $FlowFixMe[invalid-compare]
            case REACT_MEMO_TYPE:
              fiberTag = MemoComponent;
              break getTag;
            // $FlowFixMe[invalid-compare]
            case REACT_LAZY_TYPE:
              fiberTag = LazyComponent;
              resolvedType = null;
              break getTag;
          }
        }
        let info = '';
        let typeString;
        if (__DEV__) {
          if (
            type === undefined ||
            (typeof type === 'object' &&
              // $FlowFixMe[invalid-compare]
              type !== null &&
              Object.keys(type).length === 0)
          ) {
            info +=
              ' You likely forgot to export your component from the file ' +
              "it's defined in, or you might have mixed up default and named imports.";
          }

          // $FlowFixMe[invalid-compare]
          if (type === null) {
            typeString = 'null';
          } else if (isArray(type)) {
            typeString = 'array';
          } else if (
            type !== undefined &&
            // $FlowFixMe[invalid-compare]
            type.$$typeof === REACT_ELEMENT_TYPE
          ) {
            typeString = `<${
              getComponentNameFromType(type.type) || 'Unknown'
            } />`;
            info =
              ' Did you accidentally export a JSX literal instead of a component?';
          } else {
            typeString = typeof type;
          }

          const ownerName = owner ? getComponentNameFromOwner(owner) : null;
          if (ownerName) {
            info += '\n\nCheck the render method of `' + ownerName + '`.';
          }
        } else {
          // $FlowFixMe[invalid-compare]
          typeString = type === null ? 'null' : typeof type;
        }

        // 非法 type 概念上是 child 创建失败，不是当前父组件本身失败；创建虚拟 Throw child，
        // 在其 begin 阶段抛错。与 ReactChildFiber 的错误节点一致，但在这里可复制 element 的
        // debug owner/stack，使错误指向 JSX 创建现场。
        fiberTag = Throw;
        pendingProps = new Error(
          'Element type is invalid: expected a string (for built-in ' +
            'components) or a class/function (for composite components) ' +
            `but got: ${typeString}.${info}`,
        );
        resolvedType = null;
      }
    }
  }

  const fiber = createFiber(fiberTag, pendingProps, key, mode);
  fiber.elementType = type;
  fiber.type = resolvedType;
  fiber.lanes = lanes;

  if (__DEV__) {
    fiber._debugOwner = owner;
  }

  return fiber;
}

/** 从完整 ReactElement 提取 type/key/props 与开发归因字段，创建对应 Fiber。 */
export function createFiberFromElement(
  element: ReactElement,
  mode: TypeOfMode,
  lanes: Lanes,
): Fiber {
  let owner = null;
  if (__DEV__) {
    owner = element._owner;
  }
  const type = element.type;
  const key = element.key;
  const pendingProps = element.props;
  const fiber = createFiberFromTypeAndProps(
    type,
    key,
    pendingProps,
    owner,
    mode,
    lanes,
  );
  if (__DEV__) {
    fiber._debugOwner = element._owner;
    fiber._debugStack = element._debugStack;
    fiber._debugTask = element._debugTask;
  }
  return fiber;
}

/** 创建不产生宿主节点的 Fragment Fiber，pendingProps 直接保存 child 列表。 */
export function createFiberFromFragment(
  elements: ReactFragment,
  mode: TypeOfMode,
  lanes: Lanes,
  key: ReactKey,
): Fiber {
  const fiber = createFiber(Fragment, elements, key, mode);
  fiber.lanes = lanes;
  return fiber;
}

/** 创建实验性 Scope Fiber，并保留 Scope 描述对象供 HostConfig 查询。 */
function createFiberFromScope(
  scope: ReactScope,
  pendingProps: any,
  mode: TypeOfMode,
  lanes: Lanes,
  key: ReactKey,
) {
  const fiber = createFiber(ScopeComponent, pendingProps, key, mode);
  fiber.type = scope;
  fiber.elementType = scope;
  fiber.lanes = lanes;
  return fiber;
}

/** 创建 Profiler Fiber、启用 ProfileMode，并在计时开关开启时初始化 commit 累计状态。 */
function createFiberFromProfiler(
  pendingProps: any,
  mode: TypeOfMode,
  lanes: Lanes,
  key: ReactKey,
): Fiber {
  if (__DEV__) {
    if (typeof pendingProps.id !== 'string') {
      console.error(
        'Profiler must specify an "id" of type `string` as a prop. Received the type `%s` instead.',
        typeof pendingProps.id,
      );
    }
  }

  const fiber = createFiber(Profiler, pendingProps, key, mode | ProfileMode);
  fiber.elementType = REACT_PROFILER_TYPE;
  fiber.lanes = lanes;

  if (enableProfilerTimer) {
    fiber.stateNode = {
      effectDuration: 0,
      passiveEffectDuration: 0,
    };
  }

  return fiber;
}

/** 创建可捕获 thenable 并切换 primary/fallback 的 Suspense Fiber。 */
export function createFiberFromSuspense(
  pendingProps: any,
  mode: TypeOfMode,
  lanes: Lanes,
  key: ReactKey,
): Fiber {
  const fiber = createFiber(SuspenseComponent, pendingProps, key, mode);
  fiber.elementType = REACT_SUSPENSE_TYPE;
  fiber.lanes = lanes;
  return fiber;
}

/** 创建按 revealOrder/tail 协调多个 Suspense 行的 SuspenseList Fiber。 */
export function createFiberFromSuspenseList(
  pendingProps: any,
  mode: TypeOfMode,
  lanes: Lanes,
  key: ReactKey,
): Fiber {
  const fiber = createFiber(SuspenseListComponent, pendingProps, key, mode);
  fiber.elementType = REACT_SUSPENSE_LIST_TYPE;
  fiber.lanes = lanes;
  return fiber;
}

/** 创建可隐藏/显示子树并管理其 effects/cache 的 Offscreen Fiber。 */
export function createFiberFromOffscreen(
  pendingProps: OffscreenProps,
  mode: TypeOfMode,
  lanes: Lanes,
  key: ReactKey,
): Fiber {
  const fiber = createFiber(OffscreenComponent, pendingProps, key, mode);
  fiber.lanes = lanes;
  return fiber;
}
/** 创建 active/hidden 语义的 Activity Fiber，并安装其共享元素标记。 */
export function createFiberFromActivity(
  pendingProps: ActivityProps,
  mode: TypeOfMode,
  lanes: Lanes,
  key: ReactKey,
): Fiber {
  const fiber = createFiber(ActivityComponent, pendingProps, key, mode);
  fiber.elementType = REACT_ACTIVITY_TYPE;
  fiber.lanes = lanes;
  return fiber;
}

/**
 * 创建 ViewTransition Fiber 及其配对/克隆状态。
 * 即使全局 suspensey image 开关关闭，进入该边界也局部启用对应 mode，以便捕获稳定快照。
 */
export function createFiberFromViewTransition(
  pendingProps: ViewTransitionProps,
  mode: TypeOfMode,
  lanes: Lanes,
  key: ReactKey,
): Fiber {
  if (!enableSuspenseyImages) {
    // ViewTransition 自身选择加入 SuspenseyImages mode，即使全局开关关闭。
    mode |= SuspenseyImagesMode;
  }
  const fiber = createFiber(ViewTransitionComponent, pendingProps, key, mode);
  fiber.elementType = REACT_VIEW_TRANSITION_TYPE;
  fiber.lanes = lanes;
  const instance: ViewTransitionState = {
    autoName: null,
    paired: null,
    clones: null,
    ref: null,
  };
  fiber.stateNode = instance;
  return fiber;
}

/** 创建旧版隐藏子树兼容 Fiber。 */
export function createFiberFromLegacyHidden(
  pendingProps: LegacyHiddenProps,
  mode: TypeOfMode,
  lanes: Lanes,
  key: ReactKey,
): Fiber {
  const fiber = createFiber(LegacyHiddenComponent, pendingProps, key, mode);
  fiber.elementType = REACT_LEGACY_HIDDEN_TYPE;
  fiber.lanes = lanes;
  return fiber;
}

/** 创建 transition tracing marker Fiber，并初始化等待边界、abort 与 transition 集合。 */
export function createFiberFromTracingMarker(
  pendingProps: any,
  mode: TypeOfMode,
  lanes: Lanes,
  key: ReactKey,
): Fiber {
  const fiber = createFiber(TracingMarkerComponent, pendingProps, key, mode);
  fiber.elementType = REACT_TRACING_MARKER_TYPE;
  fiber.lanes = lanes;
  const tracingMarkerInstance: TracingMarkerInstance = {
    tag: TransitionTracingMarker,
    transitions: null,
    pendingBoundaries: null,
    aborts: null,
    name: pendingProps.name,
  };
  fiber.stateNode = tracingMarkerInstance;
  return fiber;
}

/** 创建 HostText Fiber；文本内容直接存入 pendingProps。 */
export function createFiberFromText(
  content: string,
  mode: TypeOfMode,
  lanes: Lanes,
): Fiber {
  const fiber = createFiber(HostText, content, null, mode);
  fiber.lanes = lanes;
  return fiber;
}

/** 为服务端已存在的 Suspense/Activity 宿主边界创建不透明 dehydrated 占位 Fiber。 */
export function createFiberFromDehydratedFragment(
  dehydratedNode: SuspenseInstance | ActivityInstance,
): Fiber {
  const fiber = createFiber(DehydratedFragment, null, null, NoMode);
  fiber.stateNode = dehydratedNode;
  return fiber;
}

/** 创建跨容器 HostPortal Fiber，并保存目标容器及 persistence child set 状态。 */
export function createFiberFromPortal(
  portal: ReactPortal,
  mode: TypeOfMode,
  lanes: Lanes,
): Fiber {
  const pendingProps = portal.children !== null ? portal.children : [];
  const fiber = createFiber(HostPortal, pendingProps, portal.key, mode);
  fiber.lanes = lanes;
  fiber.stateNode = {
    containerInfo: portal.containerInfo,
    pendingChildren: null, // persistence renderer 在替换容器 children 前写入待提交集合。
    implementation: portal.implementation,
  };
  return fiber;
}

/** 创建在 beginWork 中重新抛出指定值的虚拟 child Fiber。 */
export function createFiberFromThrow(
  error: mixed,
  mode: TypeOfMode,
  lanes: Lanes,
): Fiber {
  const fiber = createFiber(Throw, error, null, mode);
  fiber.lanes = lanes;
  return fiber;
}
