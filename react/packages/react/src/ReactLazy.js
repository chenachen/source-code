/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  Wakeable,
  Thenable,
  FulfilledThenable,
  RejectedThenable,
  ReactDebugInfo,
  ReactIOInfo,
} from 'shared/ReactTypes';

import {enableAsyncDebugInfo} from 'shared/ReactFeatureFlags';

import {REACT_LAZY_TYPE} from 'shared/ReactSymbols';

import noop from 'shared/noop';

/** 尚未调用加载器；`_result` 此时保存用户传入的加载函数。 */
const Uninitialized = -1;
/** 加载器已返回 Thenable，但异步结果尚未落定。 */
const Pending = 0;
/** Thenable 已兑现；`_result` 此时保存模块对象。 */
const Resolved = 1;
/** Thenable 已拒绝；`_result` 此时保存需要向渲染流程抛出的原因。 */
const Rejected = 2;

/**
 * `lazy` 载荷的初始态。
 *
 * 首次读取时会调用 `_result`，并就地把同一个对象切换为等待态、完成态或拒绝态；
 * 复用对象可以让所有引用者观察到同一份状态机结果。
 */
type UninitializedPayload<T> = {
  /** 判别联合的初始态标记。 */
  _status: -1,
  /** 返回模块 Thenable 的用户加载器。 */
  _result: () => Thenable<{
    /** 模块的默认导出，即最终渲染的组件类型。 */
    default: T,
    ...
  }>,
  /** 仅开发环境使用的异步时间线与调试值。 */
  _ioInfo?: ReactIOInfo,
};

/** `lazy` 载荷的等待态；保留 Wakeable 供 Suspense 抛出并订阅。 */
type PendingPayload = {
  /** 判别联合的等待态标记。 */
  _status: 0,
  /** 尚未落定的异步对象。 */
  _result: Wakeable,
  /** 仅开发环境使用的异步时间线与调试值。 */
  _ioInfo?: ReactIOInfo,
};

/** `lazy` 载荷的完成态；模块对象已经可以同步读取。 */
type ResolvedPayload<T> = {
  /** 判别联合的完成态标记。 */
  _status: 1,
  /** 已兑现的模块对象。 */
  _result: {
    /** 模块的默认导出，即最终渲染的组件类型。 */
    default: T,
    ...
  },
  /** 仅开发环境使用的异步时间线与调试值。 */
  _ioInfo?: ReactIOInfo,
};

/** `lazy` 载荷的拒绝态；错误会在读取组件类型时重新抛出。 */
type RejectedPayload = {
  /** 判别联合的拒绝态标记。 */
  _status: 2,
  /** 加载失败的任意拒绝原因。 */
  _result: mixed,
  /** 仅开发环境使用的异步时间线与调试值。 */
  _ioInfo?: ReactIOInfo,
};

/** `lazy` 内部载荷的四态判别联合。 */
type Payload<T> =
  | UninitializedPayload<T>
  | PendingPayload
  | ResolvedPayload<T>
  | RejectedPayload;

/**
 * `React.lazy` 返回的惰性组件描述符。
 *
 * reconciler 通过品牌字段识别它，再把 `_payload` 交给 `_init`；描述符本身不执行渲染。
 */
export type LazyComponent<T, P> = {
  /** 标识该描述符属于 React Lazy 类型。 */
  $$typeof: symbol | number,
  /** 保存加载状态机及其当前结果。 */
  _payload: P,
  /** 把载荷解析为真实组件类型，或抛出 Wakeable/错误。 */
  _init: (payload: P) => T,

  // 以下字段仅供开发环境的诊断工具读取。
  /** 异步加载的调试时间线；等待栈会在后续消费处补齐。 */
  _debugInfo?: null | ReactDebugInfo,
  /** 开发环境的元素校验状态容器。 */
  _store?: {
    /** `0` 未校验，`1` 已校验，`2` 强制标记为失败。 */
    validated: 0 | 1 | 2,
    ...
  },
};

/**
 * 推进惰性载荷状态机，并返回已经解析出的默认导出。
 *
 * 初始态先调用加载器再订阅 thenable；同步落定可直接进入完成/拒绝态，不必经过等待态。
 * 订阅后仍未落定才保存 thenable 并进入等待态；等待时抛它，拒绝时重抛错误。
 * 回调只从初始态/等待态改写 payload，防止迟到回调覆盖终态。加载器或 then 订阅在落定前
 * 同步抛错时，payload 仍为初始态，下次解析会重新调用加载器。
 * @param payload - 由 lazy 创建并归该 lazy 类型持有的可变四态槽，多个 render 共用此槽。
 * @returns Resolved 模块的 default；Pending 抛同一 thenable，Rejected 抛保存的原因。
 * @remarks 此状态与 renderer 请求缓存不同，终态会随 lazy 类型引用一直保留，没有
 * 自动取消/超时/卸载重置。异步回调写入终态后才执行调试插桩；这些后续读取抛错不会
 * 自动回退 payload。Resolved 分支的 DEV 诊断不修正模块：缺 default 可返回 undefined，
 * null/undefined 模块或 default getter 仍可能抛错，且下次仍从 Resolved 读取。
 */
function lazyInitializer<T>(payload: Payload<T>): T {
  if (payload._status === Uninitialized) {
    let resolveDebugValue: (void | T) => void = null as any;
    let rejectDebugValue: mixed => void = null as any;
    if (__DEV__ && enableAsyncDebugInfo) {
      const ioInfo = payload._ioInfo;
      if (ioInfo != null) {
        // 首次启动惰性请求时同时初始化起止时间；结束回调会覆盖 `end`。
        // $FlowFixMe[cannot-write]
        ioInfo.start = ioInfo.end = performance.now();
        // 另存一个可探查 Promise，供开发工具在不改动业务 Thenable 的情况下读取最终值。
        // $FlowFixMe[cannot-write]
        ioInfo.value = new Promise((resolve, reject) => {
          resolveDebugValue = resolve;
          rejectDebugValue = reject;
        });
      }
    }
    const ctor = payload._result;
    const thenable = ctor();
    // 注册回调以推进状态。访问或调用 `then` 本身也可能抛错；此处故意不提前写入等待态，
    // 因而这类同步失败仍保持初始态，下次读取会重试。这与加载器或外层包装器同步抛错的
    // 行为一致，也让偶发的并发解析问题有机会在重试时恢复。
    thenable.then(
      moduleObject => {
        if (
          (payload as Payload<T>)._status === Pending ||
          payload._status === Uninitialized
        ) {
          // 仅从初始态/等待态进入完成态，确保终态不会被迟到的回调覆盖。
          const resolved: ResolvedPayload<T> = payload as any;
          resolved._status = Resolved;
          resolved._result = moduleObject;
          if (__DEV__ && enableAsyncDebugInfo) {
            const ioInfo = payload._ioInfo;
            if (ioInfo != null) {
              // 记录成功落定时间，闭合开发工具展示的 I/O 区间。
              // $FlowFixMe[cannot-write]
              ioInfo.end = performance.now();
              // 调试视图关心可渲染的默认导出，而不是包裹它的模块命名空间对象。
              const debugValue =
                moduleObject == null ? undefined : moduleObject.default;
              resolveDebugValue(debugValue);
              // $FlowFixMe[incompatible-use]
              // $FlowFixMe[prop-missing]
              ioInfo.value.status = 'fulfilled';
              // $FlowFixMe[incompatible-use]
              // $FlowFixMe[prop-missing]
              ioInfo.value.value = debugValue;
            }
          }
          // 为没有自带状态字段的 Thenable 补齐可探查信息，使调试器能同步读取落定结果。
          // TODO：应把惰性探查迁移到 `resolveLazy`，或让 suspendedThenable 直接表示 lazy。
          if (thenable.status === undefined) {
            const fulfilledThenable: FulfilledThenable<{
              /** 已解析模块的默认导出。 */
              default: T,
              ...
            }> = thenable as any;
            fulfilledThenable.status = 'fulfilled';
            fulfilledThenable.value = moduleObject;
          }
        }
      },
      error => {
        if (
          (payload as Payload<T>)._status === Pending ||
          payload._status === Uninitialized
        ) {
          // 仅从初始态/等待态进入拒绝态，确保终态不会被迟到的回调覆盖。
          const rejected: RejectedPayload = payload as any;
          rejected._status = Rejected;
          rejected._result = error;
          if (__DEV__ && enableAsyncDebugInfo) {
            const ioInfo = payload._ioInfo;
            if (ioInfo != null) {
              // 记录拒绝时间，闭合开发工具展示的 I/O 区间。
              // $FlowFixMe[cannot-write]
              ioInfo.end = performance.now();
              // 为仅供调试的 Promise 安装双向空处理器，避免它产生未处理拒绝告警。
              // $FlowFixMe[incompatible-use]
              ioInfo.value.then(noop, noop);
              rejectDebugValue(error);
              // $FlowFixMe[incompatible-use]
              // $FlowFixMe[prop-missing]
              ioInfo.value.status = 'rejected';
              // $FlowFixMe[incompatible-use]
              // $FlowFixMe[prop-missing]
              ioInfo.value.reason = error;
            }
          }
          // 为没有自带状态字段的 Thenable 补齐可探查信息，使调试器能同步读取拒绝原因。
          // TODO：应把惰性探查迁移到 `resolveLazy`，或让 suspendedThenable 直接表示 lazy。
          if (thenable.status === undefined) {
            const rejectedThenable: RejectedThenable<{
              /** 加载目标模块预期提供的默认导出。 */
              default: T,
              ...
            }> = thenable as any;
            rejectedThenable.status = 'rejected';
            rejectedThenable.reason = error;
          }
        }
      },
    );
    if (__DEV__ && enableAsyncDebugInfo) {
      const ioInfo = payload._ioInfo;
      if (ioInfo != null) {
        const displayName = thenable.displayName;
        if (typeof displayName === 'string') {
          // $FlowFixMe[cannot-write]
          ioInfo.name = displayName;
        }
      }
    }
    if (payload._status === Uninitialized) {
      // 若回调没有同步落定载荷，则缓存 Thenable 并进入等待态；后续读取会抛出同一对象，
      // 让 Suspense 订阅它，而不会重复调用加载器。
      const pending: PendingPayload = payload as any;
      pending._status = Pending;
      pending._result = thenable;
    }
  }
  if (payload._status === Resolved) {
    const moduleObject = payload._result;
    if (__DEV__) {
      if (moduleObject === undefined) {
        console.error(
          'lazy: Expected the result of a dynamic imp' +
            'ort() call. ' +
            'Instead received: %s\n\nYour code should look like: \n  ' +
            // 故意拆开 `import` 字样，避免构建工具把错误示例误解析为真实依赖。
            'const MyComponent = lazy(() => imp' +
            "ort('./MyComponent'))\n\n" +
            'Did you accidentally put curly braces around the import?',
          moduleObject,
        );
      }
    }
    if (__DEV__) {
      if (!('default' in moduleObject)) {
        console.error(
          'lazy: Expected the result of a dynamic imp' +
            'ort() call. ' +
            'Instead received: %s\n\nYour code should look like: \n  ' +
            // 故意拆开 `import` 字样，避免构建工具把错误示例误解析为真实依赖。
            'const MyComponent = lazy(() => imp' +
            "ort('./MyComponent'))",
          moduleObject,
        );
      }
    }
    return moduleObject.default;
  } else {
    throw payload._result;
  }
}

/**
 * 创建惰性组件描述符，并把实际加载延迟到描述符首次被解析时。
 *
 * @param ctor 返回含默认导出的 Thenable；React 缓存其等待及落定结果，同步启动失败则保留初始态。
 * @returns 可被 React 识别并通过 Suspense 协调加载的惰性组件类型。
 * @remarks 创建本身不调用 ctor；renderer 或调试命名工具首次调用 _init 才启动加载。
 * 每次 lazy(ctor) 有独立 payload，即使 ctor 相同也不在本函数按工厂去重；返回类型
 * 的所有消费者才共享同一 payload。DEV 开启异步调试时另建 I/O 信息，但不改变业务模块结果。
 */
export function lazy<T>(
  ctor: () => Thenable<{
    /** 模块的默认导出，即惰性组件最终解析出的类型。 */
    default: T,
    ...
  }>,
): LazyComponent<T, Payload<T>> {
  const payload: Payload<T> = {
    // 这两个字段共同构成可变状态槽：状态决定 `_result` 当前表示加载器、Wakeable、模块还是错误。
    _status: Uninitialized,
    _result: ctor,
  };

  const lazyType: LazyComponent<T, Payload<T>> = {
    $$typeof: REACT_LAZY_TYPE,
    _payload: payload,
    _init: lazyInitializer,
  };

  if (__DEV__ && enableAsyncDebugInfo) {
    // TODO：理想情况下应记录 owner，但 ReactIOInfo 目前只能容纳 ReactComponentInfo，不能
    // 容纳 Fiber。通常 lazy 应在模块作用域创建，因此在 owner 内创建本就较少见。
    const owner = null;
    const ioInfo: ReactIOInfo = {
      name: 'lazy',
      start: -1,
      end: -1,
      value: null,
      owner: owner,
      debugStack: new Error('react-stack-top-frame'),
      // eslint-disable-next-line react-internal/no-production-logging
      debugTask: console.createTask ? console.createTask('lazy()') : null,
    };
    payload._ioInfo = ioInfo;
    // 先把 I/O 信息挂到 lazy 上；此时尚无等待栈，后续真正消费该类型时再推断并补齐。
    lazyType._debugInfo = [{awaited: ioInfo}];
  }

  return lazyType;
}
