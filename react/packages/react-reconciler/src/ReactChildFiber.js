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
  ReactPortal,
  Thenable,
  ReactContext,
  ReactDebugInfo,
  ReactComponentInfo,
  SuspenseListRevealOrder,
  ReactKey,
  ReactOptimisticKey,
} from 'shared/ReactTypes';
import type {Fiber} from './ReactInternalTypes';
import type {Lanes} from './ReactFiberLane';
import type {ThenableState} from './ReactFiberThenable';

import getComponentNameFromFiber from 'react-reconciler/src/getComponentNameFromFiber';
import {
  Placement,
  ChildDeletion,
  Forked,
  PlacementDEV,
} from './ReactFiberFlags';
import {NoMode, ConcurrentMode} from './ReactTypeOfMode';
import {
  getIteratorFn,
  ASYNC_ITERATOR,
  REACT_ELEMENT_TYPE,
  REACT_FRAGMENT_TYPE,
  REACT_PORTAL_TYPE,
  REACT_LAZY_TYPE,
  REACT_CONTEXT_TYPE,
  REACT_LEGACY_ELEMENT_TYPE,
  REACT_OPTIMISTIC_KEY,
} from 'shared/ReactSymbols';
import {
  HostRoot,
  HostText,
  HostPortal,
  Fragment,
  FunctionComponent,
} from './ReactWorkTags';
import isArray from 'shared/isArray';
import {
  enableAsyncIterableChildren,
  disableLegacyMode,
  enableFragmentRefs,
  enableOptimisticKey,
} from 'shared/ReactFeatureFlags';

import {
  createWorkInProgress,
  resetWorkInProgress,
  createFiberFromElement,
  createFiberFromFragment,
  createFiberFromText,
  createFiberFromPortal,
  createFiberFromThrow,
} from './ReactFiber';
import {isCompatibleFamilyForHotReloading} from './ReactFiberHotReloading';
import {getIsHydrating} from './ReactFiberHydrationContext';
import {pushTreeFork} from './ReactFiberTreeContext';
import {
  SuspenseException,
  SuspenseActionException,
  createThenableState,
  trackUsedThenable,
  resolveLazy,
} from './ReactFiberThenable';
import {readContextDuringReconciliation} from './ReactFiberNewContext';

import {runWithFiberInDEV} from './ReactCurrentFiber';

// 跟踪本轮 reconciliation 按读取顺序解包的 thenable。
let thenableState: ThenableState | null = null;
let thenableIndexCounter: number = 0;

// 当前 Server Component 元数据链，用于开发期栈与 ConsoleTask 归因。
let currentDebugInfo: null | ReactDebugInfo = null;

/** 合并进入 child reconciliation 的 Server Component 调试信息，并返回旧值供退出时恢复。 */
function pushDebugInfo(
  debugInfo: null | ReactDebugInfo,
): null | ReactDebugInfo {
  if (!__DEV__) {
    return null;
  }
  const previousDebugInfo = currentDebugInfo;
  if (debugInfo == null) {
    // 没有新增信息，保留当前链。
  } else if (previousDebugInfo === null) {
    currentDebugInfo = debugInfo;
  } else {
    // 两条 debugInfo 都存在时必须生成新数组；这会失去后续 live 更新，因此理想上应在
    // 两侧均完全 resolve/解除挂起后再合并。
    currentDebugInfo = previousDebugInfo.concat(debugInfo);
  }
  return previousDebugInfo;
}

/** 从当前 Server Component 调试链末端向前寻找最近的 ConsoleTask。 */
function getCurrentDebugTask(): null | ConsoleTask {
  // 优先使用最近父 Server Component 的调试任务。
  if (__DEV__) {
    const debugInfo = currentDebugInfo;
    if (debugInfo != null) {
      for (let i = debugInfo.length - 1; i >= 0; i--) {
        if (debugInfo[i].name != null) {
          const componentInfo: ReactComponentInfo = debugInfo[i];
          const debugTask: ?ConsoleTask = componentInfo.debugTask;
          if (debugTask != null) {
            return debugTask;
          }
        }
      }
    }
  }
  return null;
}

let didWarnAboutMaps;
let didWarnAboutGenerators;
let ownerHasKeyUseWarning;
let ownerHasFunctionTypeWarning;
let ownerHasSymbolTypeWarning;
/** 开发期检查列表 child 的显式 key，并按 owner 去重警告；生产模式为空操作。 */
let warnForMissingKey = (
  returnFiber: Fiber,
  workInProgress: Fiber,
  child: mixed,
) => {};

if (__DEV__) {
  didWarnAboutMaps = false;
  didWarnAboutGenerators = false;

  /**
   * 记录已经发出缺失或非法 key 警告的 owner。
   * 显式 key 让动态 children 的身份不依赖列表位置；缺失时协调器仍可按 index 匹配，
   * 插入与重排可能复用到不同逻辑项。该表按 owner 去重开发期警告。
   */
  ownerHasKeyUseWarning = {} as {
    /** 已发出缺失/非法 key 警告的 owner 名。 */
    [string]: boolean
  };
  ownerHasFunctionTypeWarning = {} as {
    /** 已发出函数 child 警告的 owner 名。 */
    [string]: boolean
  };
  ownerHasSymbolTypeWarning = {} as {
    /** 已发出 symbol child 警告的 owner 名。 */
    [string]: boolean
  };

  /**
   * DEV 检查尚未验证的 Element/Portal 是否缺 key，先更新 _store.validated，
   * 再按父 owner 名称去重并在候选 Fiber 栈中报告；静态已验证节点直接跳过。
   */
  warnForMissingKey = (
    returnFiber: Fiber,
    workInProgress: Fiber,
    child: mixed,
  ) => {
    if (child === null || typeof child !== 'object') {
      return;
    }
    if (
      !child._store ||
      ((child._store.validated || child.key != null) &&
        child._store.validated !== 2)
    ) {
      return;
    }

    if (typeof child._store !== 'object') {
      throw new Error(
        'React Component in warnForMissingKey should have a _store. ' +
          'This error is likely caused by a bug in React. Please file an issue.',
      );
    }

    // $FlowFixMe[cannot-write] unable to narrow type from mixed to writable object
    child._store.validated = 1;

    const componentName = getComponentNameFromFiber(returnFiber);

    const componentKey = componentName || 'null';
    if (ownerHasKeyUseWarning[componentKey]) {
      return;
    }
    ownerHasKeyUseWarning[componentKey] = true;

    const childOwner = child._owner;
    const parentOwner = returnFiber._debugOwner;

    let currentComponentErrorInfo = '';
    if (parentOwner && typeof parentOwner.tag === 'number') {
      const name = getComponentNameFromFiber(parentOwner as any);
      if (name) {
        currentComponentErrorInfo =
          '\n\nCheck the render method of `' + name + '`.';
      }
    }
    if (!currentComponentErrorInfo) {
      if (componentName) {
        currentComponentErrorInfo = `\n\nCheck the top-level render call using <${componentName}>.`;
      }
    }

    // 通常当前 owner 负责 key；若它通过 children 属性接收节点，则真正负责分配 key 的
    // 可能是创建 child 的组件。
    let childOwnerAppendix = '';
    if (childOwner != null && parentOwner !== childOwner) {
      let ownerName = null;
      if (typeof childOwner.tag === 'number') {
        ownerName = getComponentNameFromFiber(childOwner as any);
      } else if (typeof childOwner.name === 'string') {
        ownerName = childOwner.name;
      }
      if (ownerName) {
        // 在警告中指出最初创建该 child 的组件。
        childOwnerAppendix = ` It was passed a child from ${ownerName}.`;
      }
    }

    runWithFiberInDEV(workInProgress, () => {
      console.error(
        'Each child in a list should have a unique "key" prop.' +
          '%s%s See https://react.dev/link/warning-keys for more information.',
        currentComponentErrorInfo,
        childOwnerAppendix,
      );
    });
  };
}

/**
 * 校验 Fragment 只接收 children/key（启用时含 ref）。必须在此检查，因为 Fragment Fiber
 * 只保存 children、又与数组共用形态，BeginWork 已拿不到完整 props。
 */
function validateFragmentProps(
  element: ReactElement,
  fiber: null | Fiber,
  returnFiber: Fiber,
) {
  if (__DEV__) {
    const keys = Object.keys(element.props);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (
        key !== 'children' &&
        key !== 'key' &&
        (enableFragmentRefs ? key !== 'ref' : true)
      ) {
        if (fiber === null) {
          // 无 key 且无 ref 的根 Fragment 没有独立 Fiber；临时创建一个只用于错误栈归因。
          fiber = createFiberFromElement(element, returnFiber.mode, 0);
          if (__DEV__) {
            fiber._debugInfo = currentDebugInfo;
          }
          fiber.return = returnFiber;
        }
        runWithFiberInDEV(
          fiber,
          erroredKey => {
            if (enableFragmentRefs) {
              console.error(
                'Invalid prop `%s` supplied to `React.Fragment`. ' +
                  'React.Fragment can only have `key`, `ref`, and `children` props.',
                erroredKey,
              );
            } else {
              console.error(
                'Invalid prop `%s` supplied to `React.Fragment`. ' +
                  'React.Fragment can only have `key` and `children` props.',
                erroredKey,
              );
            }
          },
          key,
        );
        break;
      }
    }
  }
}

/** 按本轮 child 读取序号交给 ThenableState 解包，保证重放时使用稳定次序。 */
function unwrapThenable<T>(thenable: Thenable<T>): T {
  const index = thenableIndexCounter;
  thenableIndexCounter += 1;
  if (thenableState === null) {
    thenableState = createThenableState();
  }
  return trackUsedThenable(thenableState, thenable, index, null);
}

/** 过渡期把 element.props.ref 规范化写入 Fiber.ref，供提交阶段统一消费。 */
function coerceRef(workInProgress: Fiber, element: ReactElement): void {
  // TODO：ref-as-prop 已启用，应在所附组件（Host/Class 等）的 begin 阶段解析 ref。
  const refProp = element.props.ref;
  // TODO：ref-as-prop 已全面启用后不应再依赖 Fiber.ref 字段，应始终从 prop 读取。
  workInProgress.ref = refProp !== undefined ? refProp : null;
}

/** 构造对象 child 的精确信息并抛错；同时识别旧版 React Element 混用。 */
function throwOnInvalidObjectTypeImpl(returnFiber: Fiber, newChild: Object) {
  if (newChild.$$typeof === REACT_LEGACY_ELEMENT_TYPE) {
    throw new Error(
      'A React Element from an older version of React was rendered. ' +
        'This is not supported. It can happen if:\n' +
        '- Multiple copies of the "react" package is used.\n' +
        '- A library pre-bundled an old copy of "react" or "react/jsx-runtime".\n' +
        '- A compiler tries to "inline" JSX instead of using the runtime.',
    );
  }

  // $FlowFixMe[method-unbinding]
  const childString = Object.prototype.toString.call(newChild);

  throw new Error(
    `Objects are not valid as a React child (found: ${
      childString === '[object Object]'
        ? 'object with keys {' + Object.keys(newChild).join(', ') + '}'
        : childString
    }). ` +
      'If you meant to render a collection of children, use an array ' +
      'instead.',
  );
}

/** 在最近 Server Component ConsoleTask 中执行对象 child 校验，保留可定位调用栈。 */
function throwOnInvalidObjectType(returnFiber: Fiber, newChild: Object) {
  const debugTask = getCurrentDebugTask();
  if (__DEV__ && debugTask !== null) {
    debugTask.run(
      throwOnInvalidObjectTypeImpl.bind(null, returnFiber, newChild),
    );
  } else {
    throwOnInvalidObjectTypeImpl(returnFiber, newChild);
  }
}

/** 开发期按父组件去重报告“函数不能直接作为 React child”。 */
function warnOnFunctionTypeImpl(returnFiber: Fiber, invalidChild: Function) {
  if (__DEV__) {
    const parentName = getComponentNameFromFiber(returnFiber) || 'Component';

    if (ownerHasFunctionTypeWarning[parentName]) {
      return;
    }
    ownerHasFunctionTypeWarning[parentName] = true;

    const name = invalidChild.displayName || invalidChild.name || 'Component';

    if (returnFiber.tag === HostRoot) {
      console.error(
        'Functions are not valid as a React child. This may happen if ' +
          'you return %s instead of <%s /> from render. ' +
          'Or maybe you meant to call this function rather than return it.\n' +
          '  root.render(%s)',
        name,
        name,
        name,
      );
    } else {
      console.error(
        'Functions are not valid as a React child. This may happen if ' +
          'you return %s instead of <%s /> from render. ' +
          'Or maybe you meant to call this function rather than return it.\n' +
          '  <%s>{%s}</%s>',
        name,
        name,
        parentName,
        name,
        parentName,
      );
    }
  }
}

/** 在最近 Server Component ConsoleTask 中发出函数 child 警告。 */
function warnOnFunctionType(returnFiber: Fiber, invalidChild: Function) {
  const debugTask = getCurrentDebugTask();
  if (__DEV__ && debugTask !== null) {
    debugTask.run(warnOnFunctionTypeImpl.bind(null, returnFiber, invalidChild));
  } else {
    warnOnFunctionTypeImpl(returnFiber, invalidChild);
  }
}

/** 开发期按父组件去重报告“symbol 不能作为 React child”。 */
function warnOnSymbolTypeImpl(returnFiber: Fiber, invalidChild: symbol) {
  if (__DEV__) {
    const parentName = getComponentNameFromFiber(returnFiber) || 'Component';

    if (ownerHasSymbolTypeWarning[parentName]) {
      return;
    }
    ownerHasSymbolTypeWarning[parentName] = true;

    // eslint-disable-next-line react-internal/safe-string-coercion
    const name = String(invalidChild);

    if (returnFiber.tag === HostRoot) {
      console.error(
        'Symbols are not valid as a React child.\n' + '  root.render(%s)',
        name,
      );
    } else {
      console.error(
        'Symbols are not valid as a React child.\n' + '  <%s>%s</%s>',
        parentName,
        name,
        parentName,
      );
    }
  }
}

/** 在最近 Server Component ConsoleTask 中发出 symbol child 警告。 */
function warnOnSymbolType(returnFiber: Fiber, invalidChild: symbol) {
  const debugTask = getCurrentDebugTask();
  if (__DEV__ && debugTask !== null) {
    debugTask.run(warnOnSymbolTypeImpl.bind(null, returnFiber, invalidChild));
  } else {
    warnOnSymbolTypeImpl(returnFiber, invalidChild);
  }
}

/** 将 current child 链与新 ReactNode 对齐并返回 work-in-progress 首 child 的策略签名。 */
type ChildReconciler = (
  returnFiber: Fiber,
  currentFirstChild: Fiber | null,
  newChild: any,
  lanes: Lanes,
) => Fiber | null;

/**
 * 按是否跟踪副作用生成 mount/update 两套 child reconciler。闭包让删除、Placement 等路径
 * 能尽早分支并分别优化；不依赖该开关的 helper 放在外层。
 */
function createChildReconciler(
  shouldTrackSideEffects: boolean,
): ChildReconciler {
  /** 更新模式把未复用 child 加入父 Fiber.deletions，并设置 ChildDeletion 标志。 */
  function deleteChild(returnFiber: Fiber, childToDelete: Fiber): void {
    if (!shouldTrackSideEffects) {
      // 首次挂载没有 current 宿主节点可删除。
      return;
    }
    const deletions = returnFiber.deletions;
    if (deletions === null) {
      returnFiber.deletions = [childToDelete];
      returnFiber.flags |= ChildDeletion;
    } else {
      deletions.push(childToDelete);
    }
  }

  /** 从指定 current child 起删除整条 sibling 链，并返回 null 便于调用方结束。 */
  function deleteRemainingChildren(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
  ): null {
    if (!shouldTrackSideEffects) {
      // 首次挂载没有 current sibling 可删除。
      return null;
    }

    // TODO：shouldClone 路径可假设首 child 后其余已全部加入，做微型优化。
    let childToDelete = currentFirstChild;
    while (childToDelete !== null) {
      deleteChild(returnFiber, childToDelete);
      childToDelete = childToDelete.sibling;
    }
    return null;
  }

  /** 把剩余 current sibling 按显式 key 或 index 建 Map，供慢路径 O(1) 查找与移动复用。 */
  function mapRemainingChildren(
    currentFirstChild: Fiber,
  ): Map<string | number | ReactOptimisticKey, Fiber> {
    // 把剩余 child 加进临时 Map；显式 key 直接索引，隐式 null key 以原 index 索引。
    const existingChildren: Map<
      | string
      | number
      // 该联合类型只服务 enableOptimisticKey 关闭场景；功能稳定后可移除。
      | ReactOptimisticKey,
      Fiber,
    > = new Map();

    let existingChild: null | Fiber = currentFirstChild;
    while (existingChild !== null) {
      if (existingChild.key === null) {
        existingChildren.set(existingChild.index, existingChild);
      } else if (
        enableOptimisticKey &&
        existingChild.key === REACT_OPTIMISTIC_KEY
      ) {
        // optimistic key 用 -(index + 1) 区分普通 index；若新 key 无其他匹配，再尝试此槽。
        existingChildren.set(-existingChild.index - 1, existingChild);
      } else {
        existingChildren.set(existingChild.key, existingChild);
      }
      existingChild = existingChild.sibling;
    }
    return existingChildren;
  }

  /** 以 current Fiber 创建可复用 work-in-progress，并清理旧 sibling/index 链接。 */
  function useFiber(fiber: Fiber, pendingProps: mixed): Fiber {
    // 在 helper 内统一把 sibling 置空、index 归零，避免单 child 等返回路径遗漏。
    const clone = createWorkInProgress(fiber, pendingProps);
    clone.index = 0;
    clone.sibling = null;
    return clone;
  }

  /**
   * 为列表 child 写入新 index，并用旧 index 与 lastPlacedIndex 判断复用节点是原位、移动还是
   * 新插入；返回新的 lastPlacedIndex。
   * @param newFiber 本轮候选；alternate 指向旧 Fiber，其 index 提供旧列表位置。
   * @param lastPlacedIndex 已处理且可保留相对次序的旧节点下标上界，不是新 DOM 插入位置。
   * @param newIndex 当前新列表槽位下标，空槽也参与计数。
   */
  function placeChild(
    newFiber: Fiber,
    lastPlacedIndex: number,
    newIndex: number,
  ): number {
    newFiber.index = newIndex;
    if (!shouldTrackSideEffects) {
      // hydration 时 useId 算法必须知道哪些 Fiber 属于数组/迭代器列表。
      newFiber.flags |= Forked;
      return lastPlacedIndex;
    }
    const current = newFiber.alternate;
    if (current !== null) {
      const oldIndex = current.index;
      if (oldIndex < lastPlacedIndex) {
        // 旧 index 落后表示移动。Fiber 已存在，不设置 PlacementDEV，避免 StrictMode 把
        // 子树当作重新挂载而重复运行 effect。
        newFiber.flags |= Placement;
        return lastPlacedIndex;
      } else {
        // 旧 index 仍在单调序列中，可原位保留。
        return oldIndex;
      }
    } else {
      // 没有 alternate，属于新插入。
      newFiber.flags |= Placement | PlacementDEV;
      return lastPlacedIndex;
    }
  }

  /** 单 child 快路径：只有没有 alternate 的新 Fiber 才需标记 Placement。 */
  function placeSingleChild(newFiber: Fiber): Fiber {
    // 单 child 不涉及相对移动，只区分复用与插入。
    if (shouldTrackSideEffects && newFiber.alternate === null) {
      newFiber.flags |= Placement | PlacementDEV;
    }
    return newFiber;
  }

  /** 复用现有 HostText 或新建文本 Fiber，并挂回 returnFiber。 */
  function updateTextNode(
    returnFiber: Fiber,
    current: Fiber | null,
    textContent: string,
    lanes: Lanes,
  ) {
    if (current === null || current.tag !== HostText) {
      // current 不是 HostText：创建文本 Fiber。
      const created = createFiberFromText(textContent, returnFiber.mode, lanes);
      created.return = returnFiber;
      if (__DEV__) {
        // 文本没有 element owner，错误栈归因给父 Fiber。
        created._debugOwner = returnFiber;
        created._debugTask = returnFiber._debugTask;
        created._debugInfo = currentDebugInfo;
      }
      return created;
    } else {
      // 复用 HostText alternate，仅更新 pending text。
      const existing = useFiber(current, textContent);
      existing.return = returnFiber;
      if (__DEV__) {
        existing._debugInfo = currentDebugInfo;
      }
      return existing;
    }
  }

  /** 调用方已按 key 选定候选；此处按 elementType、hot-reload 或 lazy resolved type 兼容性复用或新建 Fiber。 */
  function updateElement(
    returnFiber: Fiber,
    current: Fiber | null,
    element: ReactElement,
    lanes: Lanes,
  ): Fiber {
    const elementType = element.type;
    if (elementType === REACT_FRAGMENT_TYPE) {
      const updated = updateFragment(
        returnFiber,
        current,
        element.props.children,
        lanes,
        element.key,
      );
      if (enableFragmentRefs) {
        coerceRef(updated, element);
      }
      validateFragmentProps(element, updated, returnFiber);
      return updated;
    }
    if (current !== null) {
      if (
        current.elementType === elementType ||
        // 保持内联，让热更新兼容检查只在类型不相等的慢分支执行。
        (__DEV__
          ? isCompatibleFamilyForHotReloading(current, element)
          : false) ||
        // Lazy 应以 resolved type 对齐；必须晚于热更新检查，因为热更新不会重新挂起，不能
        // 让下面的 resolve 提前 suspend 改变其语义。
        (typeof elementType === 'object' &&
          elementType !== null &&
          elementType.$$typeof === REACT_LAZY_TYPE &&
          resolveLazy(elementType) === current.type)
      ) {
        // 复用 Fiber，列表移动由旧 index 决定。
        const existing = useFiber(current, element.props);
        coerceRef(existing, element);
        existing.return = returnFiber;
        if (__DEV__) {
          existing._debugOwner = element._owner;
          existing._debugInfo = currentDebugInfo;
        }
        return existing;
      }
    }
    // 类型不兼容：创建新的 Element Fiber。
    const created = createFiberFromElement(element, returnFiber.mode, lanes);
    coerceRef(created, element);
    created.return = returnFiber;
    if (__DEV__) {
      created._debugInfo = currentDebugInfo;
    }
    return created;
  }

  /** 容器与 implementation 相同则复用 Portal Fiber，否则为新容器创建 Portal。 */
  function updatePortal(
    returnFiber: Fiber,
    current: Fiber | null,
    portal: ReactPortal,
    lanes: Lanes,
  ): Fiber {
    if (
      current === null ||
      current.tag !== HostPortal ||
      current.stateNode.containerInfo !== portal.containerInfo ||
      current.stateNode.implementation !== portal.implementation
    ) {
      // current 不是同容器 Portal：新建。
      const created = createFiberFromPortal(portal, returnFiber.mode, lanes);
      created.return = returnFiber;
      if (__DEV__) {
        created._debugInfo = currentDebugInfo;
      }
      return created;
    } else {
      // 容器相同：复用并更新 portal children。
      const existing = useFiber(current, portal.children || []);
      if (enableOptimisticKey) {
        // 旧 key 为 optimistic 占位时，保存现已到达的真实 key。
        existing.key = portal.key;
      }
      existing.return = returnFiber;
      if (__DEV__) {
        existing._debugInfo = currentDebugInfo;
      }
      return existing;
    }
  }

  /** 复用 Fragment Fiber 或按 children 创建新的 Fragment，并同步 key/debug 信息。 */
  function updateFragment(
    returnFiber: Fiber,
    current: Fiber | null,
    fragment: Iterable<React$Node>,
    lanes: Lanes,
    key: ReactKey,
  ): Fiber {
    if (current === null || current.tag !== Fragment) {
      // current 不是 Fragment：创建新 Fragment。
      const created = createFiberFromFragment(
        fragment,
        returnFiber.mode,
        lanes,
        key,
      );
      created.return = returnFiber;
      if (__DEV__) {
        // 数组/隐式 Fragment 没有 element owner，错误栈归因给父 Fiber。
        created._debugOwner = returnFiber;
        created._debugTask = returnFiber._debugTask;
        created._debugInfo = currentDebugInfo;
      }
      return created;
    } else {
      // 复用 Fragment alternate，并更新 children。
      const existing = useFiber(current, fragment);
      if (enableOptimisticKey) {
        // 旧 key 为 optimistic 占位时，保存现已到达的真实 key。
        existing.key = key;
      }
      existing.return = returnFiber;
      if (__DEV__) {
        existing._debugInfo = currentDebugInfo;
      }
      return existing;
    }
  }

  /** 从任意合法 ReactNode 新建对应 Fiber；递归解包 Lazy、Thenable 与 Context。 */
  function createChild(
    returnFiber: Fiber,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    if (
      (typeof newChild === 'string' && newChild !== '') ||
      typeof newChild === 'number' ||
      typeof newChild === 'bigint'
    ) {
      // 文本节点没有 key，可直接创建而无需列表 key 匹配。
      const created = createFiberFromText(
        // $FlowFixMe[unsafe-addition] Flow doesn't want us to use `+` operator with string and bigint
        '' + newChild,
        returnFiber.mode,
        lanes,
      );
      created.return = returnFiber;
      if (__DEV__) {
        // 文本没有 element owner，错误栈归因给父 Fiber。
        created._debugOwner = returnFiber;
        created._debugTask = returnFiber._debugTask;
        created._debugInfo = currentDebugInfo;
      }
      return created;
    }

    if (typeof newChild === 'object' && newChild !== null) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          const created = createFiberFromElement(
            newChild,
            returnFiber.mode,
            lanes,
          );
          coerceRef(created, newChild);
          created.return = returnFiber;
          if (__DEV__) {
            const prevDebugInfo = pushDebugInfo(newChild._debugInfo);
            created._debugInfo = currentDebugInfo;
            currentDebugInfo = prevDebugInfo;
          }
          return created;
        }
        case REACT_PORTAL_TYPE: {
          const created = createFiberFromPortal(
            newChild,
            returnFiber.mode,
            lanes,
          );
          created.return = returnFiber;
          if (__DEV__) {
            created._debugInfo = currentDebugInfo;
          }
          return created;
        }
        case REACT_LAZY_TYPE: {
          const prevDebugInfo = pushDebugInfo(newChild._debugInfo);
          const resolvedChild = resolveLazy(newChild as any);
          const created = createChild(returnFiber, resolvedChild, lanes);
          currentDebugInfo = prevDebugInfo;
          return created;
        }
      }

      if (
        isArray(newChild) ||
        getIteratorFn(newChild) ||
        (enableAsyncIterableChildren &&
          typeof newChild[ASYNC_ITERATOR] === 'function')
      ) {
        const created = createFiberFromFragment(
          newChild,
          returnFiber.mode,
          lanes,
          null,
        );
        created.return = returnFiber;
        if (__DEV__) {
          // 数组/迭代器没有 element owner，错误栈归因给父 Fiber。
          created._debugOwner = returnFiber;
          created._debugTask = returnFiber._debugTask;
          // 预先保存到 Fragment，处理其 child 时不要重复 push。
          const prevDebugInfo = pushDebugInfo(newChild._debugInfo);
          created._debugInfo = currentDebugInfo;
          currentDebugInfo = prevDebugInfo;
        }
        return created;
      }

      // Thenable 属于 Usable：解包内部值后递归按真实 ReactNode 类型创建。
      if (typeof newChild.then === 'function') {
        const thenable: Thenable<any> = newChild as any;
        const prevDebugInfo = pushDebugInfo(newChild._debugInfo);
        const created = createChild(
          returnFiber,
          unwrapThenable(thenable),
          lanes,
        );
        currentDebugInfo = prevDebugInfo;
        return created;
      }

      // $FlowFixMe[invalid-compare]
      if (newChild.$$typeof === REACT_CONTEXT_TYPE) {
        const context: ReactContext<mixed> = newChild as any;
        return createChild(
          returnFiber,
          readContextDuringReconciliation(returnFiber, context, lanes),
          lanes,
        );
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType(returnFiber, newChild);
      }
      if (typeof newChild === 'symbol') {
        warnOnSymbolType(returnFiber, newChild);
      }
    }

    return null;
  }

  /**
   * 列表顺序快路径：仅当 oldFiber.key 与新节点 key/隐式槽兼容时复用；不匹配返回 null，
   * 让调用方切换到 Map 慢路径。
   */
  function updateSlot(
    returnFiber: Fiber,
    oldFiber: Fiber | null,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    // key 匹配才尝试更新，否则返回 null 触发慢路径。
    const key = oldFiber !== null ? oldFiber.key : null;

    if (
      (typeof newChild === 'string' && newChild !== '') ||
      typeof newChild === 'number' ||
      typeof newChild === 'bigint'
    ) {
      // 文本没有 key；只有旧槽也为隐式 key 时才能继续顺序复用。
      if (key !== null) {
        return null;
      }
      return updateTextNode(
        returnFiber,
        oldFiber,
        // $FlowFixMe[unsafe-addition] Flow doesn't want us to use `+` operator with string and bigint
        '' + newChild,
        lanes,
      );
    }

    if (typeof newChild === 'object' && newChild !== null) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          if (
            // 这里只接受真实 key 相等；optimistic 槽不在顺序快路径抢占身份，交给 Map 慢
            // 路径，确保列表其他位置的真实 key 匹配优先。
            newChild.key === key
          ) {
            const prevDebugInfo = pushDebugInfo(newChild._debugInfo);
            const updated = updateElement(
              returnFiber,
              oldFiber,
              newChild,
              lanes,
            );
            currentDebugInfo = prevDebugInfo;
            return updated;
          } else {
            return null;
          }
        }
        case REACT_PORTAL_TYPE: {
          if (
            // 这里只接受真实 key 相等；optimistic 槽交给 Map 慢路径，让其他位置的真实
            // key 匹配优先。
            newChild.key === key
          ) {
            return updatePortal(returnFiber, oldFiber, newChild, lanes);
          } else {
            return null;
          }
        }
        case REACT_LAZY_TYPE: {
          const prevDebugInfo = pushDebugInfo(newChild._debugInfo);
          const resolvedChild = resolveLazy(newChild as any);
          const updated = updateSlot(
            returnFiber,
            oldFiber,
            resolvedChild,
            lanes,
          );
          currentDebugInfo = prevDebugInfo;
          return updated;
        }
      }

      if (
        isArray(newChild) ||
        getIteratorFn(newChild) ||
        (enableAsyncIterableChildren &&
          typeof newChild[ASYNC_ITERATOR] === 'function')
      ) {
        if (key !== null) {
          return null;
        }

        const prevDebugInfo = pushDebugInfo(newChild._debugInfo);
        const updated = updateFragment(
          returnFiber,
          oldFiber,
          newChild,
          lanes,
          null,
        );
        currentDebugInfo = prevDebugInfo;
        return updated;
      }

      // Thenable 属于 Usable：解包内部值后递归重试同一旧槽。
      if (typeof newChild.then === 'function') {
        const thenable: Thenable<any> = newChild as any;
        const prevDebugInfo = pushDebugInfo((thenable as any)._debugInfo);
        const updated = updateSlot(
          returnFiber,
          oldFiber,
          unwrapThenable(thenable),
          lanes,
        );
        currentDebugInfo = prevDebugInfo;
        return updated;
      }

      // $FlowFixMe[invalid-compare]
      if (newChild.$$typeof === REACT_CONTEXT_TYPE) {
        const context: ReactContext<mixed> = newChild as any;
        return updateSlot(
          returnFiber,
          oldFiber,
          readContextDuringReconciliation(returnFiber, context, lanes),
          lanes,
        );
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType(returnFiber, newChild);
      }
      if (typeof newChild === 'symbol') {
        warnOnSymbolType(returnFiber, newChild);
      }
    }

    return null;
  }

  /** 在列表慢路径从 key/index Map 找 current Fiber，再按新 ReactNode 类型复用或创建。 */
  function updateFromMap(
    existingChildren: Map<string | number | ReactOptimisticKey, Fiber>,
    returnFiber: Fiber,
    newIdx: number,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    if (
      (typeof newChild === 'string' && newChild !== '') ||
      typeof newChild === 'number' ||
      typeof newChild === 'bigint'
    ) {
      // 文本没有显式 key，按新 index 查找；若匹配项也是 HostText 即可复用。
      const matchedFiber = existingChildren.get(newIdx) || null;
      return updateTextNode(
        returnFiber,
        matchedFiber,
        // $FlowFixMe[unsafe-addition] Flow doesn't want us to use `+` operator with string and bigint
        '' + newChild,
        lanes,
      );
    }

    if (typeof newChild === 'object' && newChild !== null) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          const matchedFiber =
            existingChildren.get(
              newChild.key === null ? newIdx : newChild.key,
            ) ||
            (enableOptimisticKey &&
              // 既有 child 使用 optimistic key 时，仍可退回按 index 匹配。
              existingChildren.get(-newIdx - 1)) ||
            null;
          const prevDebugInfo = pushDebugInfo(newChild._debugInfo);
          const updated = updateElement(
            returnFiber,
            matchedFiber,
            newChild,
            lanes,
          );
          currentDebugInfo = prevDebugInfo;
          return updated;
        }
        case REACT_PORTAL_TYPE: {
          const matchedFiber =
            existingChildren.get(
              newChild.key === null ? newIdx : newChild.key,
            ) ||
            (enableOptimisticKey &&
              // 既有 child 使用 optimistic key 时，仍可退回按 index 匹配。
              existingChildren.get(-newIdx - 1)) ||
            null;
          return updatePortal(returnFiber, matchedFiber, newChild, lanes);
        }
        case REACT_LAZY_TYPE: {
          const prevDebugInfo = pushDebugInfo(newChild._debugInfo);
          const resolvedChild = resolveLazy(newChild as any);
          const updated = updateFromMap(
            existingChildren,
            returnFiber,
            newIdx,
            resolvedChild,
            lanes,
          );
          currentDebugInfo = prevDebugInfo;
          return updated;
        }
      }

      if (
        isArray(newChild) ||
        getIteratorFn(newChild) ||
        (enableAsyncIterableChildren &&
          typeof newChild[ASYNC_ITERATOR] === 'function')
      ) {
        const matchedFiber = existingChildren.get(newIdx) || null;
        const prevDebugInfo = pushDebugInfo(newChild._debugInfo);
        const updated = updateFragment(
          returnFiber,
          matchedFiber,
          newChild,
          lanes,
          null,
        );
        currentDebugInfo = prevDebugInfo;
        return updated;
      }

      // Thenable 属于 Usable：解包内部值后递归查询 Map。
      if (typeof newChild.then === 'function') {
        const thenable: Thenable<any> = newChild as any;
        const prevDebugInfo = pushDebugInfo((thenable as any)._debugInfo);
        const updated = updateFromMap(
          existingChildren,
          returnFiber,
          newIdx,
          unwrapThenable(thenable),
          lanes,
        );
        currentDebugInfo = prevDebugInfo;
        return updated;
      }

      // $FlowFixMe[invalid-compare]
      if (newChild.$$typeof === REACT_CONTEXT_TYPE) {
        const context: ReactContext<mixed> = newChild as any;
        return updateFromMap(
          existingChildren,
          returnFiber,
          newIdx,
          readContextDuringReconciliation(returnFiber, context, lanes),
          lanes,
        );
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType(returnFiber, newChild);
      }
      if (typeof newChild === 'symbol') {
        warnOnSymbolType(returnFiber, newChild);
      }
    }

    return null;
  }

  /** 检查列表 child 缺失/重复 key，并返回累计已见 key 集合。 */
  function warnOnInvalidKey(
    returnFiber: Fiber,
    workInProgress: Fiber,
    child: mixed,
    knownKeys: Set<string> | null,
  ): Set<string> | null {
    if (__DEV__) {
      if (typeof child !== 'object' || child === null) {
        return knownKeys;
      }
      switch (child.$$typeof) {
        case REACT_ELEMENT_TYPE:
        case REACT_PORTAL_TYPE:
          warnForMissingKey(returnFiber, workInProgress, child);
          const key = child.key;
          if (typeof key !== 'string') {
            break;
          }
          if (knownKeys === null) {
            knownKeys = new Set();
            knownKeys.add(key);
            break;
          }
          if (!knownKeys.has(key)) {
            knownKeys.add(key);
            break;
          }
          runWithFiberInDEV(workInProgress, () => {
            console.error(
              'Encountered two children with the same key, `%s`. ' +
                'Keys should be unique so that components maintain their identity ' +
                'across updates. Non-unique keys may cause children to be ' +
                'duplicated and/or omitted — the behavior is unsupported and ' +
                'could change in a future version.',
              key,
            );
          });
          break;
        case REACT_LAZY_TYPE: {
          const resolvedChild = resolveLazy(child as any);
          warnOnInvalidKey(
            returnFiber,
            workInProgress,
            resolvedChild,
            knownKeys,
          );
          break;
        }
        default:
          break;
      }
    }
    return knownKeys;
  }

  /**
   * 对齐数组 child：先沿 sibling 顺序线性复用；旧链耗尽则批量插入；首个 miss 后把剩余
   * current 建 Map，以 key/index 复用、移动并删除未消费项。
   * Map 项只有实际复用（存在 alternate）才消费；同 key 不同类型创建新 Fiber 后，
   * 旧项留到末尾删除。本阶段只构建 WIP 链与 flags，宿主插入/删除由 commit 执行。
   */
  function reconcileChildrenArray(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChildren: Array<any>,
    lanes: Lanes,
  ): Fiber | null {
    // Fiber 没有反向指针，无法直接做双端搜索。少量变更优先线性比较，只有需要前瞻时才
    // 建 Map；反转列表不如双端算法，但较少见，且 Iterable 若双端搜索还需复制全集。
    // 当前接受每次插入/移动都可能把剩余项加入 Map 的最坏情况。
    // 修改本算法时须同步 reconcileChildrenIterator，它们应保持同一决策序列。

    let knownKeys: Set<string> | null = null;

    let resultingFirstChild: Fiber | null = null;
    let previousNewFiber: Fiber | null = null;

    let oldFiber = currentFirstChild;
    let lastPlacedIndex = 0;
    let newIdx = 0;
    let nextOldFiber = null;
    for (; oldFiber !== null && newIdx < newChildren.length; newIdx++) {
      if (oldFiber.index > newIdx) {
        nextOldFiber = oldFiber;
        oldFiber = null;
      } else {
        nextOldFiber = oldFiber.sibling;
      }
      const newFiber = updateSlot(
        returnFiber,
        oldFiber,
        newChildren[newIdx],
        lanes,
      );
      if (newFiber === null) {
        // TODO：null/boolean/undefined 等空槽也会返回 null，无法与真正 miss 区分，导致
        // 频繁进入慢路径；需设计可区分结果。
        if (oldFiber === null) {
          oldFiber = nextOldFiber;
        }
        break;
      }

      if (__DEV__) {
        knownKeys = warnOnInvalidKey(
          returnFiber,
          newFiber,
          newChildren[newIdx],
          knownKeys,
        );
      }

      if (shouldTrackSideEffects) {
        if (oldFiber && newFiber.alternate === null) {
          // 槽位匹配但类型不兼容、没有复用旧 Fiber，需删除原 child。
          deleteChild(returnFiber, oldFiber);
        }
      }
      lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
      if (previousNewFiber === null) {
        // TODO：首 child 赋值只发生一次，可移到循环外。
        resultingFirstChild = newFiber;
      } else {
        // TODO：存在前置 null 时应按槽位延迟链接 sibling，但又不能用前一项调用 updateSlot。
        previousNewFiber.sibling = newFiber;
      }
      previousNewFiber = newFiber;
      oldFiber = nextOldFiber;
    }

    if (newIdx === newChildren.length) {
      // 新数组已结束，删除未消费的旧 sibling。
      deleteRemainingChildren(returnFiber, oldFiber);
      if (getIsHydrating()) {
        const numberOfForks = newIdx;
        pushTreeFork(returnFiber, numberOfForks);
      }
      return resultingFirstChild;
    }

    if (oldFiber === null) {
      // 旧链已耗尽，剩余新项全部是插入，走无需 Map 的快路径。
      for (; newIdx < newChildren.length; newIdx++) {
        const newFiber = createChild(returnFiber, newChildren[newIdx], lanes);
        if (newFiber === null) {
          continue;
        }
        if (__DEV__) {
          knownKeys = warnOnInvalidKey(
            returnFiber,
            newFiber,
            newChildren[newIdx],
            knownKeys,
          );
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          // TODO：首 child 赋值只发生一次，可移到循环外。
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
      if (getIsHydrating()) {
        const numberOfForks = newIdx;
        pushTreeFork(returnFiber, numberOfForks);
      }
      return resultingFirstChild;
    }

    // 首次顺序 miss 后，把剩余旧 child 建成 key/index Map。
    const existingChildren = mapRemainingChildren(oldFiber);

    // 继续扫描新数组；从 Map 取回的旧项按位置判断为原位或移动。
    for (; newIdx < newChildren.length; newIdx++) {
      const newFiber = updateFromMap(
        existingChildren,
        returnFiber,
        newIdx,
        newChildren[newIdx],
        lanes,
      );
      if (newFiber !== null) {
        if (__DEV__) {
          knownKeys = warnOnInvalidKey(
            returnFiber,
            newFiber,
            newChildren[newIdx],
            knownKeys,
          );
        }
        if (shouldTrackSideEffects) {
          const currentFiber = newFiber.alternate;
          if (currentFiber !== null) {
            // 新 Fiber 有 current 表示已复用；从 Map 删除它，避免末尾误加进 deletion 列表。
            if (
              enableOptimisticKey &&
              currentFiber.key === REACT_OPTIMISTIC_KEY
            ) {
              existingChildren.delete(-newIdx - 1);
            } else {
              existingChildren.delete(
                currentFiber.key === null ? newIdx : currentFiber.key,
              );
            }
          }
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
    }

    if (shouldTrackSideEffects) {
      // Map 中未消费的旧 child 均需删除；加入父 Fiber 的 deletions 列表，宿主删除要等 commit。
      existingChildren.forEach(child => deleteChild(returnFiber, child));
    }

    if (getIsHydrating()) {
      const numberOfForks = newIdx;
      pushTreeFork(returnFiber, numberOfForks);
    }
    return resultingFirstChild;
  }

  /** 获取同步 Iterable 的 iterator、发出 Generator/Map 使用警告，再复用 iterator 算法。 */
  function reconcileChildrenIteratable(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChildrenIterable: Iterable<mixed>,
    lanes: Lanes,
  ): Fiber | null {
    // 算法与数组版本一致，只把索引读取替换为 iterator.next。

    const iteratorFn = getIteratorFn(newChildrenIterable);

    if (typeof iteratorFn !== 'function') {
      throw new Error(
        'An object is not an iterable. This error is likely caused by a bug in ' +
          'React. Please file an issue.',
      );
    }

    const newChildren = iteratorFn.call(newChildrenIterable);

    if (__DEV__) {
      if (newChildren === newChildrenIterable) {
        // Generator 枚举会改变自身，通常不能作为 props 重放；GeneratorFunction 组件直接
        // 返回的 generator 可通过重渲染重建，因此例外。参见 issue #12995。
        const isGeneratorComponent =
          returnFiber.tag === FunctionComponent &&
          // $FlowFixMe[method-unbinding]
          Object.prototype.toString.call(returnFiber.type) ===
            '[object GeneratorFunction]' &&
          // $FlowFixMe[method-unbinding]
          Object.prototype.toString.call(newChildren) === '[object Generator]';
        if (!isGeneratorComponent) {
          if (!didWarnAboutGenerators) {
            console.error(
              'Using Iterators as children is unsupported and will likely yield ' +
                'unexpected results because enumerating a generator mutates it. ' +
                'You may convert it to an array with `Array.from()` or the ' +
                '`[...spread]` operator before rendering. You can also use an ' +
                'Iterable that can iterate multiple times over the same items.',
            );
          }
          didWarnAboutGenerators = true;
        }
      } else if ((newChildrenIterable as any).entries === iteratorFn) {
        // Map.entries 会产生键值二元数组，提示改用带 key 的 ReactElement 数组。
        if (!didWarnAboutMaps) {
          console.error(
            'Using Maps as children is not supported. ' +
              'Use an array of keyed ReactElements instead.',
          );
          didWarnAboutMaps = true;
        }
      }
    }

    return reconcileChildrenIterator(
      returnFiber,
      currentFirstChild,
      newChildren,
      lanes,
    );
  }

  /** 把 AsyncIterable 每次 next 的 Promise 当作 Usable 解包，再复用同步 iterator 对齐算法。 */
  function reconcileChildrenAsyncIteratable(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChildrenIterable: AsyncIterable<mixed>,
    lanes: Lanes,
  ): Fiber | null {
    const newChildren = newChildrenIterable[ASYNC_ITERATOR]();

    if (__DEV__) {
      if (newChildren === newChildrenIterable) {
        // AsyncGenerator 枚举会改变自身，通常不能作为 props 重放；AsyncGeneratorFunction
        // 组件直接返回的实例可通过重渲染重建，因此例外。
        const isGeneratorComponent =
          returnFiber.tag === FunctionComponent &&
          // $FlowFixMe[method-unbinding]
          Object.prototype.toString.call(returnFiber.type) ===
            '[object AsyncGeneratorFunction]' &&
          // $FlowFixMe[method-unbinding]
          Object.prototype.toString.call(newChildren) ===
            '[object AsyncGenerator]';
        if (!isGeneratorComponent) {
          if (!didWarnAboutGenerators) {
            console.error(
              'Using AsyncIterators as children is unsupported and will likely yield ' +
                'unexpected results because enumerating a generator mutates it. ' +
                'You can use an AsyncIterable that can iterate multiple times over ' +
                'the same items.',
            );
          }
          didWarnAboutGenerators = true;
        }
      }
    }

    if (newChildren == null) {
      throw new Error('An iterable object provided no iterator.');
    }

    // 包一层同步 Iterator 以复用逻辑并减小产物体积；每次 next 通过 thenable 解包挂起。
    const iterator: Iterator<mixed> = {
      /** 读取下一异步项；未就绪时由 unwrapThenable 触发 Suspense，重放后返回结果。 */
      next(): IteratorResult<mixed, void> {
        return unwrapThenable(newChildren.next());
      },
    } as any;

    return reconcileChildrenIterator(
      returnFiber,
      currentFirstChild,
      iterator,
      lanes,
    );
  }

  /**
   * 消费 Iterator 并执行与数组版本相同的顺序快路径、批量插入和 Map 移动/删除慢路径。
   */
  function reconcileChildrenIterator(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChildren: ?Iterator<mixed>,
    lanes: Lanes,
  ): Fiber | null {
    if (newChildren == null) {
      throw new Error('An iterable object provided no iterator.');
    }

    let resultingFirstChild: Fiber | null = null;
    let previousNewFiber: Fiber | null = null;

    let oldFiber = currentFirstChild;
    let lastPlacedIndex = 0;
    let newIdx = 0;
    let nextOldFiber = null;

    let knownKeys: Set<string> | null = null;

    let step = newChildren.next();
    for (
      ;
      oldFiber !== null && !step.done;
      newIdx++, step = newChildren.next()
    ) {
      if (oldFiber.index > newIdx) {
        nextOldFiber = oldFiber;
        oldFiber = null;
      } else {
        nextOldFiber = oldFiber.sibling;
      }
      const newFiber = updateSlot(returnFiber, oldFiber, step.value, lanes);
      if (newFiber === null) {
        // TODO：空槽与真正 miss 都返回 null，导致频繁进入慢路径；需设计可区分结果。
        if (oldFiber === null) {
          oldFiber = nextOldFiber;
        }
        break;
      }

      if (__DEV__) {
        knownKeys = warnOnInvalidKey(
          returnFiber,
          newFiber,
          step.value,
          knownKeys,
        );
      }

      if (shouldTrackSideEffects) {
        if (oldFiber && newFiber.alternate === null) {
          // 槽位匹配但类型不兼容、没有复用旧 Fiber，需删除原 child。
          deleteChild(returnFiber, oldFiber);
        }
      }
      lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
      if (previousNewFiber === null) {
        // TODO：首 child 赋值只发生一次，可移到循环外。
        resultingFirstChild = newFiber;
      } else {
        // TODO：存在前置 null 时应按槽位延迟链接 sibling，但不能用前一项调用 updateSlot。
        previousNewFiber.sibling = newFiber;
      }
      previousNewFiber = newFiber;
      oldFiber = nextOldFiber;
    }

    if (step.done) {
      // Iterator 已结束，删除未消费的旧 sibling。
      deleteRemainingChildren(returnFiber, oldFiber);
      if (getIsHydrating()) {
        const numberOfForks = newIdx;
        pushTreeFork(returnFiber, numberOfForks);
      }
      return resultingFirstChild;
    }

    if (oldFiber === null) {
      // 旧链已耗尽，剩余 iterator 项全部是插入，走无需 Map 的快路径。
      for (; !step.done; newIdx++, step = newChildren.next()) {
        const newFiber = createChild(returnFiber, step.value, lanes);
        if (newFiber === null) {
          continue;
        }
        if (__DEV__) {
          knownKeys = warnOnInvalidKey(
            returnFiber,
            newFiber,
            step.value,
            knownKeys,
          );
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          // TODO：首 child 赋值只发生一次，可移到循环外。
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
      if (getIsHydrating()) {
        const numberOfForks = newIdx;
        pushTreeFork(returnFiber, numberOfForks);
      }
      return resultingFirstChild;
    }

    // 首次顺序 miss 后，把剩余旧 child 建成 key/index Map。
    const existingChildren = mapRemainingChildren(oldFiber);

    // 继续消费 iterator；从 Map 取回的旧项按位置判断为原位或移动。
    for (; !step.done; newIdx++, step = newChildren.next()) {
      const newFiber = updateFromMap(
        existingChildren,
        returnFiber,
        newIdx,
        step.value,
        lanes,
      );
      if (newFiber !== null) {
        if (__DEV__) {
          knownKeys = warnOnInvalidKey(
            returnFiber,
            newFiber,
            step.value,
            knownKeys,
          );
        }
        if (shouldTrackSideEffects) {
          const currentFiber = newFiber.alternate;
          if (currentFiber !== null) {
            // 新 Fiber 有 current 表示已复用；从 Map 删除，避免末尾误加进 deletion 列表。
            if (
              enableOptimisticKey &&
              currentFiber.key === REACT_OPTIMISTIC_KEY
            ) {
              existingChildren.delete(-newIdx - 1);
            } else {
              existingChildren.delete(
                currentFiber.key === null ? newIdx : currentFiber.key,
              );
            }
          }
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
    }

    if (shouldTrackSideEffects) {
      // Map 中未消费的旧 child 均需删除；加入父 Fiber 的 deletions 列表，宿主删除要等 commit。
      existingChildren.forEach(child => deleteChild(returnFiber, child));
    }

    if (getIsHydrating()) {
      const numberOfForks = newIdx;
      pushTreeFork(returnFiber, numberOfForks);
    }
    return resultingFirstChild;
  }

  /** 单文本快路径：复用首个 HostText 并删除其余 sibling，否则重建唯一文本 Fiber。 */
  function reconcileSingleTextNode(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    textContent: string,
    lanes: Lanes,
  ): Fiber {
    // 文本无法定义 key，无需做 key 检查。
    if (currentFirstChild !== null && currentFirstChild.tag === HostText) {
      // 首 child 已是 HostText，复用并删除其余 sibling。
      deleteRemainingChildren(returnFiber, currentFirstChild.sibling);
      const existing = useFiber(currentFirstChild, textContent);
      existing.return = returnFiber;
      return existing;
    }
    // 首 child 不是文本，删除旧链并创建唯一 HostText。
    deleteRemainingChildren(returnFiber, currentFirstChild);
    const created = createFiberFromText(textContent, returnFiber.mode, lanes);
    created.return = returnFiber;
    if (__DEV__) {
      // 文本没有 element owner，错误栈归因给父 Fiber。
      created._debugOwner = returnFiber;
      created._debugTask = returnFiber._debugTask;
      created._debugInfo = currentDebugInfo;
    }
    return created;
  }

  /**
   * 以 key 找单个 Element 的候选 current；类型/热更新/Lazy resolved type 兼容则复用并删除
   * 其余 sibling，否则删除旧候选并创建新 Fiber。
   */
  function reconcileSingleElement(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    element: ReactElement,
    lanes: Lanes,
  ): Fiber {
    const key = element.key;
    let child = currentFirstChild;
    while (child !== null) {
      // TODO：key 与 child.key 都为 null 时只应检查列表第一项。
      if (
        child.key === key ||
        (enableOptimisticKey && child.key === REACT_OPTIMISTIC_KEY)
      ) {
        const elementType = element.type;
        if (elementType === REACT_FRAGMENT_TYPE) {
          if (child.tag === Fragment) {
            deleteRemainingChildren(returnFiber, child.sibling);
            const existing = useFiber(child, element.props.children);
            if (enableOptimisticKey) {
              // 旧 key 为 optimistic 占位时，保存现已到达的真实 key。
              existing.key = key;
            }
            if (enableFragmentRefs) {
              coerceRef(existing, element);
            }
            existing.return = returnFiber;
            if (__DEV__) {
              existing._debugOwner = element._owner;
              existing._debugInfo = currentDebugInfo;
            }
            validateFragmentProps(element, existing, returnFiber);
            return existing;
          }
        } else {
          if (
            child.elementType === elementType ||
            // 保持内联，让热更新兼容检查只在类型不相等的慢分支执行。
            (__DEV__
              ? isCompatibleFamilyForHotReloading(child, element)
              : false) ||
            // Lazy 以 resolved type 对齐；必须晚于热更新检查，因为热更新不会重新挂起，不能
            // 让下面的 resolve 提前 suspend 改变其语义。
            (typeof elementType === 'object' &&
              elementType !== null &&
              elementType.$$typeof === REACT_LAZY_TYPE &&
              resolveLazy(elementType) === child.type)
          ) {
            deleteRemainingChildren(returnFiber, child.sibling);
            const existing = useFiber(child, element.props);
            if (enableOptimisticKey) {
              // 旧 key 为 optimistic 占位时，保存现已到达的真实 key。
              existing.key = key;
            }
            coerceRef(existing, element);
            existing.return = returnFiber;
            if (__DEV__) {
              existing._debugOwner = element._owner;
              existing._debugInfo = currentDebugInfo;
            }
            return existing;
          }
        }
        // key 相同但类型不兼容，候选及其后 sibling 全部删除。
        deleteRemainingChildren(returnFiber, child);
        break;
      } else {
        deleteChild(returnFiber, child);
      }
      child = child.sibling;
    }

    if (element.type === REACT_FRAGMENT_TYPE) {
      const created = createFiberFromFragment(
        element.props.children,
        returnFiber.mode,
        lanes,
        element.key,
      );
      if (enableFragmentRefs) {
        coerceRef(created, element);
      }
      created.return = returnFiber;
      if (__DEV__) {
        // 隐式 Fragment 的错误栈归因给父 Fiber。
        created._debugOwner = returnFiber;
        created._debugTask = returnFiber._debugTask;
        created._debugInfo = currentDebugInfo;
      }
      validateFragmentProps(element, created, returnFiber);
      return created;
    } else {
      const created = createFiberFromElement(element, returnFiber.mode, lanes);
      coerceRef(created, element);
      created.return = returnFiber;
      if (__DEV__) {
        created._debugInfo = currentDebugInfo;
      }
      return created;
    }
  }

  /** 单 Portal 快路径：key、容器与 implementation 均相同则复用，否则重建 Portal Fiber。 */
  function reconcileSinglePortal(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    portal: ReactPortal,
    lanes: Lanes,
  ): Fiber {
    const key = portal.key;
    let child = currentFirstChild;
    while (child !== null) {
      // TODO：key 与 child.key 都为 null 时只应检查列表第一项。
      if (
        child.key === key ||
        (enableOptimisticKey && child.key === REACT_OPTIMISTIC_KEY)
      ) {
        if (
          child.tag === HostPortal &&
          child.stateNode.containerInfo === portal.containerInfo &&
          child.stateNode.implementation === portal.implementation
        ) {
          deleteRemainingChildren(returnFiber, child.sibling);
          const existing = useFiber(child, portal.children || []);
          if (enableOptimisticKey) {
            // 旧 key 为 optimistic 占位时，保存现已到达的真实 key。
            existing.key = key;
          }
          existing.return = returnFiber;
          return existing;
        } else {
          deleteRemainingChildren(returnFiber, child);
          break;
        }
      } else {
        deleteChild(returnFiber, child);
      }
      child = child.sibling;
    }

    const created = createFiberFromPortal(portal, returnFiber.mode, lanes);
    created.return = returnFiber;
    return created;
  }

  /**
   * child reconciliation 的类型总分派器；按单节点、数组、同步/异步 Iterable、Usable、
   * Context 或空节点选择路径，并在更新策略中给 child 标记 Placement/Deletion 副作用。
   */
  function reconcileChildFibersImpl(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    // 只为 Usable/Lazy 递归，不为嵌套数组递归，让 Lazy 包装对 Fragment 约定不可观察。
    // 顶层数组视为 children 集合，嵌套数组才形成 Fragment Fiber。
    // 顶层无 key/ref Fragment 等价展开为数组；<>{[...]}</> 与 <>...</> 的歧义统一处理。
    // 此处直接改写而非递归，避免内层 Fragment 被误判为顶层。
    const isUnkeyedUnrefedTopLevelFragment =
      typeof newChild === 'object' &&
      newChild !== null &&
      newChild.type === REACT_FRAGMENT_TYPE &&
      newChild.key === null &&
      (enableFragmentRefs ? newChild.props.ref === undefined : true);

    if (isUnkeyedUnrefedTopLevelFragment) {
      validateFragmentProps(newChild, null, returnFiber);
      newChild = newChild.props.children;
    }

    // 先分派带 $$typeof 或可迭代协议的对象节点。
    if (typeof newChild === 'object' && newChild !== null) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          const prevDebugInfo = pushDebugInfo(newChild._debugInfo);
          const firstChild = placeSingleChild(
            reconcileSingleElement(
              returnFiber,
              currentFirstChild,
              newChild,
              lanes,
            ),
          );
          currentDebugInfo = prevDebugInfo;
          return firstChild;
        }
        case REACT_PORTAL_TYPE:
          return placeSingleChild(
            reconcileSinglePortal(
              returnFiber,
              currentFirstChild,
              newChild,
              lanes,
            ),
          );
        case REACT_LAZY_TYPE: {
          const prevDebugInfo = pushDebugInfo(newChild._debugInfo);
          const result = resolveLazy(newChild as any);
          const firstChild = reconcileChildFibersImpl(
            returnFiber,
            currentFirstChild,
            result,
            lanes,
          );
          currentDebugInfo = prevDebugInfo;
          return firstChild;
        }
      }

      if (isArray(newChild)) {
        // 上层已为该数组 Fragment 保存 debugInfo，无需再次 push。
        const firstChild = reconcileChildrenArray(
          returnFiber,
          currentFirstChild,
          newChild,
          lanes,
        );
        return firstChild;
      }

      if (getIteratorFn(newChild)) {
        // 上层已为该 Iterable Fragment 保存 debugInfo，无需再次 push。
        const firstChild = reconcileChildrenIteratable(
          returnFiber,
          currentFirstChild,
          newChild,
          lanes,
        );
        return firstChild;
      }

      if (
        enableAsyncIterableChildren &&
        typeof newChild[ASYNC_ITERATOR] === 'function'
      ) {
        // 上层已为该 AsyncIterable Fragment 保存 debugInfo，无需再次 push。
        const firstChild = reconcileChildrenAsyncIteratable(
          returnFiber,
          currentFirstChild,
          newChild,
          lanes,
        );
        return firstChild;
      }

      // Usable 可作为 ReactNode：用与 use 相同算法解包 Promise，未就绪时抛内部异常回退栈，
      // resolve 后重放组件。与 use 不同，这里持续解包直到得到非 Usable，因此嵌套
      // Usable<Usable<T>> 最终得到 T。当前必须重放父 Fiber 的完整 begin 阶段才能重新
      // reconciliation；未来可重构为更局部的 child 重放。
      if (typeof newChild.then === 'function') {
        const thenable: Thenable<any> = newChild as any;
        const prevDebugInfo = pushDebugInfo((thenable as any)._debugInfo);
        const firstChild = reconcileChildFibersImpl(
          returnFiber,
          currentFirstChild,
          unwrapThenable(thenable),
          lanes,
        );
        currentDebugInfo = prevDebugInfo;
        return firstChild;
      }

      // $FlowFixMe[invalid-compare]
      if (newChild.$$typeof === REACT_CONTEXT_TYPE) {
        const context: ReactContext<mixed> = newChild as any;
        return reconcileChildFibersImpl(
          returnFiber,
          currentFirstChild,
          readContextDuringReconciliation(returnFiber, context, lanes),
          lanes,
        );
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (
      (typeof newChild === 'string' && newChild !== '') ||
      typeof newChild === 'number' ||
      typeof newChild === 'bigint'
    ) {
      return placeSingleChild(
        reconcileSingleTextNode(
          returnFiber,
          currentFirstChild,
          // $FlowFixMe[unsafe-addition] Flow doesn't want us to use `+` operator with string and bigint
          '' + newChild,
          lanes,
        ),
      );
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType(returnFiber, newChild);
      }
      if (typeof newChild === 'symbol') {
        warnOnSymbolType(returnFiber, newChild);
      }
    }

    // null、undefined、boolean 等其余类型统一视为空 children。
    return deleteRemainingChildren(returnFiber, currentFirstChild);
  }

  /**
   * 包装单轮 child reconciliation：初始化/清理 thenable 读取状态，透传 Suspense 控制异常，
   * 并把普通异常转换成在 child begin 阶段抛出的虚拟 Fiber。
   * @param returnFiber 接收 child 链、deletions 与 ChildDeletion 标记的 WIP 父 Fiber。
   * @param currentFirstChild 已提交旧树的首 child；挂载路径可为空。
   * @param newChild 组件返回值/children，可含顶层 Fragment、迭代器或待解包的 Usable。
   * @param lanes 本轮渲染车道，写到新 Fiber，并用于协调期间 Context 读取。
   * 正常完成清空 ThenableState；挂起路径保留读取序列供重放，unwind 再显式丢弃。
   */
  function reconcileChildFibers(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    const prevDebugInfo = currentDebugInfo;
    currentDebugInfo = null;
    try {
      // 该间接层只为在末尾重置 thenableState；Closure 应把调用内联。
      thenableIndexCounter = 0;
      const firstChildFiber = reconcileChildFibersImpl(
        returnFiber,
        currentFirstChild,
        newChild,
        lanes,
      );
      thenableState = null;
      // thenableIndexCounter 每轮开头必置零，此处无需重复清理。
      return firstChildFiber;
    } catch (x) {
      if (
        x === SuspenseException ||
        x === SuspenseActionException ||
        (!disableLegacyMode &&
          (returnFiber.mode & ConcurrentMode) === NoMode &&
          typeof x === 'object' &&
          x !== null &&
          typeof x.then === 'function')
      ) {
        // Suspense 控制异常必须在 yield 前读取当前挂起状态，并以同序列重放，不能转换成
        // Throw Fiber。Legacy 挂起会实际 mount，若吞掉异常会先挂载 child 再在更新中删除。
        throw x;
      }
      // 普通错误概念上属于 child 而非当前组件；创建在自身 begin 阶段抛错的虚拟 child，
      // 让当前组件的边界有机会捕获错误或挂起。
      const throwFiber = createFiberFromThrow(x, returnFiber.mode, lanes);
      throwFiber.return = returnFiber;
      if (__DEV__) {
        const debugInfo = (throwFiber._debugInfo = currentDebugInfo);
        // 理想上 Error 构造时就捕获 owner；React 不重写构造器，因此先用最近父级作为错误
        // owner/task，再以 Server Component debugInfo 校正。跨组件 await 时两者可能不同。
        // 新版 Chrome 会由 Error 构造器捕获并供 reportError 使用的 Task，此 debugTask
        // 在那种环境不会参与输出。
        throwFiber._debugOwner = returnFiber._debugOwner;
        throwFiber._debugTask = returnFiber._debugTask;
        if (debugInfo != null) {
          for (let i = debugInfo.length - 1; i >= 0; i--) {
            if (typeof debugInfo[i].stack === 'string') {
              throwFiber._debugOwner = debugInfo[i] as any;
              throwFiber._debugTask = debugInfo[i].debugTask;
              break;
            }
          }
        }
      }
      return throwFiber;
    } finally {
      currentDebugInfo = prevDebugInfo;
    }
  }

  return reconcileChildFibers;
}

/** 更新阶段 child reconciler：跟踪 Placement、移动与 Deletion 副作用。 */
export const reconcileChildFibers: ChildReconciler =
  createChildReconciler(true);
/** 首次挂载 child reconciler：构建 Fiber 链但不记录对不存在 current 树的删除/移动。 */
export const mountChildFibers: ChildReconciler = createChildReconciler(false);

/** unwind 时丢弃本轮未完成的 thenable 读取状态，防止污染下次重放。 */
export function resetChildReconcilerOnUnwind(): void {
  // unwind 后任何已使用但未完成的 thenable 序列都不可复用。
  thenableState = null;
  thenableIndexCounter = 0;
}

/** 从 work-in-progress 当前 child 链逐一创建 alternate，供同一父 Fiber 继续下一遍工作。 */
export function cloneChildFibers(
  current: Fiber | null,
  workInProgress: Fiber,
): void {
  if (current !== null && workInProgress.child !== current.child) {
    throw new Error('Resuming work not yet implemented.');
  }

  if (workInProgress.child === null) {
    return;
  }

  let currentChild = workInProgress.child;
  let newChild = createWorkInProgress(currentChild, currentChild.pendingProps);
  workInProgress.child = newChild;

  newChild.return = workInProgress;
  while (currentChild.sibling !== null) {
    currentChild = currentChild.sibling;
    newChild = newChild.sibling = createWorkInProgress(
      currentChild,
      currentChild.pendingProps,
    );
    newChild.return = workInProgress;
  }
  newChild.sibling = null;
}

/** 重置整条 work-in-progress child sibling 链的 flags/lanes，准备第二遍 render。 */
export function resetChildFibers(workInProgress: Fiber, lanes: Lanes): void {
  let child = workInProgress.child;
  while (child !== null) {
    resetWorkInProgress(child, lanes);
    child = child.sibling;
  }
}

/** 校验 SuspenseList 单行不是嵌套数组/Iterable，要求用内层 SuspenseList 明示 revealOrder。 */
function validateSuspenseListNestedChild(childSlot: mixed, index: number) {
  if (__DEV__) {
    const isAnArray = isArray(childSlot);
    const isIterable =
      !isAnArray && typeof getIteratorFn(childSlot) === 'function';
    const isAsyncIterable =
      enableAsyncIterableChildren &&
      typeof childSlot === 'object' &&
      childSlot !== null &&
      typeof (childSlot as any)[ASYNC_ITERATOR] === 'function';
    if (isAnArray || isIterable || isAsyncIterable) {
      const type = isAnArray
        ? 'array'
        : isAsyncIterable
          ? 'async iterable'
          : 'iterable';
      console.error(
        'A nested %s was passed to row #%s in <SuspenseList />. Wrap it in ' +
          'an additional SuspenseList to configure its revealOrder: ' +
          '<SuspenseList revealOrder=...> ... ' +
          '<SuspenseList revealOrder=...>{%s}</SuspenseList> ... ' +
          '</SuspenseList>',
        type,
        index,
        type,
      );
      return false;
    }
  }
  return true;
}

/**
 * 开发期校验带顺序 revealOrder 的 SuspenseList 确有多行、且每行没有未配置的嵌套列表。
 */
export function validateSuspenseListChildren(
  children: mixed,
  revealOrder: SuspenseListRevealOrder,
) {
  if (__DEV__) {
    if (
      (revealOrder == null ||
        revealOrder === 'forwards' ||
        revealOrder === 'backwards' ||
        revealOrder === 'unstable_legacy-backwards') &&
      children !== undefined &&
      children !== null &&
      children !== false
    ) {
      if (isArray(children)) {
        for (let i = 0; i < children.length; i++) {
          if (!validateSuspenseListNestedChild(children[i], i)) {
            return;
          }
        }
      } else {
        const iteratorFn = getIteratorFn(children);
        if (typeof iteratorFn === 'function') {
          const childrenIterator = iteratorFn.call(children);
          if (childrenIterator) {
            let step = childrenIterator.next();
            let i = 0;
            for (; !step.done; step = childrenIterator.next()) {
              if (!validateSuspenseListNestedChild(step.value, i)) {
                return;
              }
              i++;
            }
          }
        } else if (
          enableAsyncIterableChildren &&
          typeof (children as any)[ASYNC_ITERATOR] === 'function'
        ) {
          // TODO：理论上应警告 AsyncIterable 内嵌数组，但检查需要异步解包；这种误用较少，
          // 当前暂不警告。
        } else if (
          enableAsyncIterableChildren &&
          children.$$typeof === REACT_ELEMENT_TYPE &&
          typeof children.type === 'function' &&
          // $FlowFixMe[method-unbinding]
          (Object.prototype.toString.call(children.type) ===
            '[object GeneratorFunction]' ||
            // $FlowFixMe[incompatible-use]
            // $FlowFixMe[method-unbinding]
            Object.prototype.toString.call(children.type) ===
              '[object AsyncGeneratorFunction]')
        ) {
          console.error(
            'A generator Component was passed to a <SuspenseList revealOrder="%s" />. ' +
              'This is not supported as a way to generate lists. Instead, pass an ' +
              'iterable as the children.',
            revealOrder,
          );
        } else {
          console.error(
            'A single row was passed to a <SuspenseList revealOrder="%s" />. ' +
              'This is not useful since it needs multiple rows. ' +
              'Did you mean to pass multiple children or an array?',
            revealOrder,
          );
        }
      }
    }
  }
}
