/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  Thenable,
  PendingThenable,
  FulfilledThenable,
  RejectedThenable,
  ReactIOInfo,
} from 'shared/ReactTypes';

import type {LazyComponent as LazyComponentType} from 'react/src/ReactLazy';
import type {Fiber} from './ReactInternalTypes';

import {callLazyInitInDEV} from './ReactFiberCallUserSpace';

import {getWorkInProgressRoot} from './ReactFiberWorkLoop';

import ReactSharedInternals from 'shared/ReactSharedInternals';

import {
  enableAsyncDebugInfo,
  enableConditionalUseWarning,
} from 'shared/ReactFeatureFlags';

import noop from 'shared/noop';

import {HostRoot} from './ReactWorkTags';

/** 开发环境为一个组件各次 `use` 调用保存的 Thenable 槽位与警告状态。 */
opaque type ThenableStateDev = {
  /** 是否已为该组件报告过未缓存 Promise，避免同源问题刷屏。 */
  didWarnAboutUncachedPromise: boolean,
  /** 按 `use` 调用顺序稳定保存的 Thenable 数组。 */
  thenables: Array<Thenable<any>>,
};

/** 生产环境只保留按调用顺序排列的 Thenable 数组。 */
opaque type ThenableStateProd = Array<Thenable<any>>;

/** Fiber 在多次渲染间复用的 Thenable 跟踪状态。 */
export opaque type ThenableState = ThenableStateDev | ThenableStateProd;

/** 从开发或生产形状中统一取出 Thenable 槽位数组。 */
function getThenablesFromState(state: ThenableState): Array<Thenable<any>> {
  if (__DEV__) {
    const devState: ThenableStateDev = state as any;
    return devState.thenables;
  } else {
    const prodState = state as any;
    return prodState;
  }
}

/**
 * `use` 用来中断当前渲染并触发 Suspense 的不透明占位异常。
 * 若它没有被工作循环消费而被用户代码捕获，开发环境会给出诊断。
 */
export const SuspenseException: mixed = new Error(
  "Suspense Exception: This is not a real error! It's an implementation " +
    'detail of `use` to interrupt the current render. You must either ' +
    'rethrow it immediately, or move the `use` call outside of the ' +
    '`try/catch` block. Capturing without rethrowing will lead to ' +
    'unexpected behavior.\n\n' +
    'To handle async errors, wrap your component in an error boundary, or ' +
    "call the promise's `.catch` method and pass the result to `use`.",
);

/** complete 阶段发现宿主资源未就绪时抛出的内部占位异常，用于决定是否回退或等待提交。 */
export const SuspenseyCommitException: mixed = new Error(
  'Suspense Exception: This is not a real error, and should not leak into ' +
    "userspace. If you're seeing this, it's likely a bug in React.",
);

/** `useActionState` 中断当前渲染时使用的内部 Suspense 占位异常。 */
export const SuspenseActionException: mixed = new Error(
  "Suspense Exception: This is not a real error! It's an implementation " +
    'detail of `useActionState` to interrupt the current render. You must either ' +
    'rethrow it immediately, or move the `useActionState` call outside of the ' +
    '`try/catch` block. Capturing without rethrowing will lead to ' +
    'unexpected behavior.\n\n' +
    'To handle async errors, wrap your component in an error boundary.',
);
/**
 * 只用于让 `throwException` 触发 fallback 的空 Thenable。
 * TODO: 可把 throwException 拆分为多条路径，直接触发 fallback 并去掉类型哨兵。
 */
export const noopSuspenseyCommitThenable = {
  /** 该对象不应真的被等待；若挂上监听器，说明 React 内部路径有误。 */
  then() {
    if (__DEV__) {
      console.error(
        'Internal React error: A listener was unexpectedly attached to a ' +
          '"noop" thenable. This is a bug in React. Please file an issue.',
      );
    }
  },
};

/** 首次跟踪 thenable 时创建槽位状态；挂起重放可继续复用此前记录的对象。 */
export function createThenableState(): ThenableState {
  // useThenable 与 child 协调器首次读取 thenable 时创建状态，即使该对象已 fulfilled 也会创建。
  if (__DEV__) {
    return {
      didWarnAboutUncachedPromise: false,
      thenables: [],
    };
  } else {
    return [];
  }
}

/** 判断经过 React 插桩的 Thenable 是否已成功或失败落定。 */
export function isThenableResolved(thenable: Thenable<mixed>): boolean {
  const status = thenable.status;
  return status === 'fulfilled' || status === 'rejected';
}

// 以下状态仅供开发期检测条件式 `use`。
let lastSuspendedFiber: null | Fiber = null;
let lastSuspendedStack: null | Error = null;
let didIssueUseWarning = false;

/** 是否保存了可能需要在下一次不挂起渲染中验证的 `use` 调用。 */
export function hasPotentialUseWarnings(): boolean {
  return enableConditionalUseWarning && lastSuspendedFiber !== null;
}
/** 清除尚未验证的条件式 `use` Fiber；组件卸载或路径失效时调用。 */
export function clearUseWarnings() {
  lastSuspendedFiber = null;
}

/**
 * 读取并同步解包当前 `use` 槽位对应的 Thenable。
 *
 * 同一跟踪状态的相同索引复用首次记录的 Thenable。没有字符串 status 的对象会被
 * 附加 pending/fulfilled/rejected 插桩；已有字符串 status 的对象保留外部插桩。未落定时把真实对象保存到
 * 模块旁路并抛出 SuspenseException，让工作循环接管而不把 Promise 泄漏给用户代码。
 * @param thenableState 本次组件/child 序列可在挂起重放中复用的槽位状态。
 * @param thenable 当前代码提供的对象；同槽位更换对象时仍消费首次记录的那个。
 * @param index 调用者递增的使用序号，决定重放时与哪个旧 Thenable 对齐。
 * @param fiber DEV 首次挂载条件式 use 诊断的 Fiber；child 解包可传 null。
 * @returns 已完成值；拒绝时抛原始原因，未完成时抛内部 Suspense 占位异常。
 */
export function trackUsedThenable<T>(
  thenableState: ThenableState,
  thenable: Thenable<T>,
  index: number,
  fiber: null | Fiber, // 仅开发环境用于条件式 use 诊断。
): T {
  if (__DEV__ && ReactSharedInternals.actQueue !== null) {
    ReactSharedInternals.didUsePromise = true;
  }
  const trackedThenables = getThenablesFromState(thenableState);
  const previous = trackedThenables[index];
  if (previous === undefined) {
    trackedThenables.push(thenable);
  } else {
    if (previous !== thenable) {
      // 复用旧 Thenable 并丢弃新对象；组件应幂等，因此二者代表同一逻辑值。

      if (__DEV__) {
        const thenableStateDev: ThenableStateDev = thenableState as any;
        if (!thenableStateDev.didWarnAboutUncachedPromise) {
          // 每个组件只在首次发现未缓存 Thenable 时警告；后续对象通常由首个问题派生。
          //
          // 这里在 thenableState 上去重，而不像通常那样按组件名去重：Promise 作为
          // React 节点时，其 owner 往往不同于正在协调的父组件，按名称需要额外在状态
          // 中追踪 owner，而实现正在减少这种依赖。
          //
          // 这样也为未来按 memo/Forget 边界而非按组件建立 ThenableState 保留空间，
          // 届时警告粒度可以更细。
          thenableStateDev.didWarnAboutUncachedPromise = true;

          // TODO: 此警告应链接到对应文档页。
          console.error(
            'A component was suspended by an uncached promise. Creating ' +
              'promises inside a Client Component or hook is not yet ' +
              'supported, except via a Suspense-compatible library or framework.',
          );
        }
      }

      // 为刻意忽略的新 Promise 挂空处理器，避免未处理 rejection。
      thenable.then(noop, noop);
      thenable = previous;
    }
  }

  if (__DEV__ && enableAsyncDebugInfo && thenable._debugInfo === undefined) {
    // 开发环境观察到没有调试信息的 Thenable 时补一条推断 I/O，以便唯一追踪。真实
    // I/O 可能更早开始，甚至来自缓存 Promise，因此起点只是近似值。
    const startTime = performance.now();
    const displayName = thenable.displayName;
    const ioInfo: ReactIOInfo = {
      name: typeof displayName === 'string' ? displayName : 'Promise',
      start: startTime,
      end: startTime,
      value: thenable as any,
      // 此时还不知道发起请求的 owner 与调用栈。
    };
    // 等 Promise 真正被使用时再延迟推断 await owner/栈；它可能用于多处，不能现在绑定。
    thenable._debugInfo = [{awaited: ioInfo}];
    // 以 Promise 落定时刻作为 I/O 的近似结束时间。
    if (thenable.status !== 'fulfilled' && thenable.status !== 'rejected') {
      /** 在 Thenable 落定时更新推断 I/O 的结束时间。 */
      const trackEndTime = () => {
        // $FlowFixMe[cannot-write]
        ioInfo.end = performance.now();
      };
      thenable.then(trackEndTime, trackEndTime);
    }
  }

  // 在 Thenable 上扩展状态与结果字段，从而同步解包；可视为 Promise API 的超集。
  //
  // 没有 status 时设为 pending，并挂监听器在落定时更新状态与结果。
  switch (thenable.status) {
    case 'fulfilled': {
      // 自定义插桩可能漏写 `.value`；这是热路径，不额外检查，意外 undefined 也易定位。
      const fulfilledValue: T = thenable.value;
      return fulfilledValue;
    }
    case 'rejected': {
      const rejectedError = thenable.reason;
      checkIfUseWrappedInAsyncCatch(rejectedError);

      // rejection 较少见，可负担额外检查来捕获漏写 `.reason` 的插桩。抛出 undefined
      // 没有 JS 调用栈，很难定位；React 组件栈也只能提供近似位置。
      if (rejectedError === undefined && !('reason' in thenable)) {
        throw new Error(
          'A rejected Promise was passed to React without a `reason` property. ' +
            'React threw a generic error from where the Promise was used to assist in identifying the problematic Promise. ' +
            "Make sure that instrumented Promises correctly set the `reason` property when setting `status` to `'rejected'`.",
        );
      }

      throw rejectedError;
    }
    default: {
      if (typeof thenable.status === 'string') {
        // status 已存在但值未知，假定用户层做过自定义插桩并按 pending 处理。挂空监听器
        // 以触发延迟初始化，例如 Flight 会在真正 await 时才解析 JSON。
        thenable.then(noop, noop);
      } else {
        // 这是此前未见过的未缓存 Thenable。

        // 检测未缓存 Promise 导致的无限 ping 循环。
        const root = getWorkInProgressRoot();
        if (root !== null && root.shellSuspendCounter > 100) {
          // 根在 shell 中反复挂起且没有提交进展，强烈表明出现无限 ping，常见原因是
          // 意外创建了异步 Client Component。
          //
          // Transition 中可挂起工作循环等待 Promise，但当前是同步渲染；又没有 fallback
          // 可展示，只能以抛错作为最后保障。
          //
          // TODO: 后续可改为强制并发渲染或把整根置于 Offscreen，并移除此错误。
          throw new Error(
            'An unknown Component is an async Client Component. ' +
              'Only Server Components can be async at the moment. ' +
              'This error is often caused by accidentally ' +
              "adding `'use client'` to a module that was originally written " +
              'for the server.',
          );
        }

        const pendingThenable: PendingThenable<T> = thenable as any;
        pendingThenable.status = 'pending';
        pendingThenable.then(
          fulfilledValue => {
            if (thenable.status === 'pending') {
              const fulfilledThenable: FulfilledThenable<T> = thenable as any;
              fulfilledThenable.status = 'fulfilled';
              fulfilledThenable.value = fulfilledValue;
            }
          },
          (error: mixed) => {
            if (thenable.status === 'pending') {
              const rejectedThenable: RejectedThenable<T> = thenable as any;
              rejectedThenable.status = 'rejected';
              rejectedThenable.reason = error;
            }
          },
        );
      }

      // 监听器可能同步落定 Thenable，再检查一次状态。
      switch ((thenable as Thenable<T>).status) {
        case 'fulfilled': {
          const fulfilledThenable: FulfilledThenable<T> = thenable as any;
          return fulfilledThenable.value;
        }
        case 'rejected': {
          const rejectedThenable: RejectedThenable<T> = thenable as any;
          const rejectedError = rejectedThenable.reason;
          checkIfUseWrappedInAsyncCatch(rejectedError);
          throw rejectedError;
        }
      }

      // 执行挂起：
      //
      // 抛出值只是为了退开调用栈，不能让真实 Thenable 泄漏到用户层，因此改抛不透明
      // 占位值。若工作循环没有消费它，说明用户代码捕获了内部异常，需要警告。
      suspendedThenable = thenable;
      if (__DEV__) {
        needsToResetSuspendedThenableDEV = true;
        if (
          enableConditionalUseWarning &&
          !didIssueUseWarning &&
          fiber !== null &&
          // 暂时只跟踪初次挂载，避免更新阶段过量警告。
          fiber.alternate === null
        ) {
          lastSuspendedFiber = fiber;
          // 预先保存 Error，以便最终触发 use() 警告时能指向首次调用位置；若下一遍不再
          // 调用 use()，便没有第二次机会收集该栈。
          lastSuspendedStack = new Error(
            'This library called use() to suspend in a previous render but ' +
              'did not call use() when it finished. This indicates an incorrect use of use(). ' +
              'Learn more: https://react.dev/warnings/conditional-use-of-use',
          );
        }
      }
      throw SuspenseException;
    }
  }
}

/** 在 complete 阶段中断未就绪宿主资源的处理；工作循环取出空 Thenable，必要时交给 throwException 切到回退路径。 */
export function suspendCommit(): void {
  // 这层间接调用只为把 noopSuspenseyCommitThenable 传给 throwException。
  // TODO: 从 throwException 中拆出 Thenable 类型判断。
  // $FlowFixMe[incompatible-type]
  suspendedThenable = noopSuspenseyCommitThenable;
  throw SuspenseyCommitException;
}

/**
 * 执行 React.lazy 初始化并返回模块值；若初始化挂起，则改走与 `use` 相同的不透明
 * SuspenseException 通道，确保真实 Thenable 只由工作循环读取。
 */
export function resolveLazy<T>(lazyType: LazyComponentType<T, any>): T {
  try {
    if (__DEV__) {
      return callLazyInitInDEV(lazyType);
    }
    const payload = lazyType._payload;
    const init = lazyType._init;
    return init(payload);
  } catch (x) {
    if (x !== null && typeof x === 'object' && typeof x.then === 'function') {
      // lazy 初始化挂起，按调用 use() 解包处理。
      suspendedThenable = x;
      if (__DEV__) {
        needsToResetSuspendedThenableDEV = true;
      }
      throw SuspenseException;
    }
    throw x;
  }
}

// 保存真正导致挂起的 Thenable，供历史上仍要求接收 Thenable 的 Suspense 后续路径读取。
let suspendedThenable: Thenable<any> | null = null;
let needsToResetSuspendedThenableDEV = false;
/**
 * 在 `use` 抛出不透明异常后取走真实 Thenable。
 *
 * 读取是一次性的：返回前清空旁路状态，防止后续异常误用上一次挂起对象。
 */
export function getSuspendedThenable(): Thenable<mixed> {
  // use 只抛不透明值以避免用户捕获真实 Thenable；工作循环紧接着从这里取回它。
  if (suspendedThenable === null) {
    throw new Error(
      'Expected a suspended thenable. This is a bug in React. Please file ' +
        'an issue.',
    );
  }
  const thenable = suspendedThenable;
  suspendedThenable = null;
  if (__DEV__) {
    needsToResetSuspendedThenableDEV = false;
  }
  return thenable;
}

/**
 * 判断 SuspenseException 是否被用户同步 try/catch 截获。
 * 正常工作循环会在处理异常时先清掉标记；标记残留即说明内部占位值泄漏到用户层。
 */
export function checkIfUseWrappedInTryCatch(): boolean {
  if (__DEV__) {
    // 标记在抛出 SuspenseException 前设置，正常处理后应被清除；残留表示用户层捕获。
    if (needsToResetSuspendedThenableDEV) {
      needsToResetSuspendedThenableDEV = false;
      return true;
    }
  }
  return false;
}

/**
 * 阻止 Suspense 内部占位异常被 async 函数捕获后异步重抛。
 * 这种场景代表 Client Component/Hook 使用了不受支持的 async 组件模式。
 */
export function checkIfUseWrappedInAsyncCatch(rejectedReason: any) {
  // 生产环境也要检查，以免 SuspenseException 被 Promise 捕获后异步抛出，形成更晦涩错误。
  // TODO: 也可在每次调用 use 时检查 dispatcher，以与其他 Hook 的误用防护统一。
  if (
    rejectedReason === SuspenseException ||
    rejectedReason === SuspenseActionException
  ) {
    throw new Error(
      'Hooks are not supported inside an async component. This ' +
        "error is often caused by accidentally adding `'use client'` " +
        'to a module that was originally written for the server.',
    );
  }
}

/**
 * 沿祖先链核对 tag/type/key/index，直到遇到同一个 Fiber 对象才接受为同一调用位置。
 * HostRoot 的根实例不同立即拒绝；只拥有相同字段但没有共同 Fiber 祖先的两条路径也拒绝。
 */
function areSameKeyPath(a: Fiber, b: Fiber): boolean {
  if (a === b) {
    return true;
  }
  if (
    a.tag !== b.tag ||
    a.type !== b.type ||
    a.key !== b.key ||
    a.index !== b.index
  ) {
    return false;
  }
  if (a.tag === HostRoot && a.stateNode !== b.stateNode) {
    // 两者虽都是根，但实例不同，不属于同一棵树。
    return false;
  }
  if (a.return === null || b.return === null) {
    return false;
  }
  return areSameKeyPath(a.return, b.return);
}

/**
 * 在一次未挂起渲染后检查组件是否仍在相同结构位置调用 `use`。
 *
 * 相同路径仍有 ThenableState 说明调用持续存在；状态消失则大概率是条件式 `use`
 * 解除了先前挂起，开发环境用首次调用处保存的 Error 栈报告一次。
 */
export function checkIfUseWasUsedBefore(
  unsuspendedFiber: Fiber,
  thenableState: null | ThenableState,
): void {
  if (__DEV__ && enableConditionalUseWarning) {
    if (
      lastSuspendedFiber !== null &&
      areSameKeyPath(lastSuspendedFiber, unsuspendedFiber)
    ) {
      if (thenableState !== null) {
        // 解决后仍在使用 use()；调用数量变化暂不诊断，视为合法并清理状态。
        lastSuspendedFiber = null;
        lastSuspendedStack = null;
      } else {
        // 上次因 use() 挂起的 Fiber 在同一位置不再调用它，疑似错误的条件式 use 解除了挂起。
        if (lastSuspendedStack !== null && !didIssueUseWarning) {
          didIssueUseWarning = true;
          // 传 Error 对象而非自定义字符串，让浏览器原生显示保存的调用栈。
          console['error'](lastSuspendedStack);
        }
        lastSuspendedFiber = null;
        lastSuspendedStack = null;
      }
    }
  }
}
