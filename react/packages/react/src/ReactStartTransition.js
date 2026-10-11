/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from 'react-reconciler/src/ReactInternalTypes';
import type {
  StartTransitionOptions,
  GestureProvider,
  GestureOptions,
} from 'shared/ReactTypes';
import type {TransitionTypes} from './ReactTransitionType';

import ReactSharedInternals from 'shared/ReactSharedInternals';

import {
  enableTransitionTracing,
  enableViewTransition,
  enableGestureTransition,
} from 'shared/ReactFeatureFlags';

import reportGlobalError from 'shared/reportGlobalError';

import noop from 'shared/noop';

/** 一次 transition 的动态上下文；嵌套调用会在 `finally` 中恢复父上下文。 */
export type Transition = {
  /** 视图 transition 开启时共享的去重类型标签。 */
  types: null | TransitionTypes,
  /** 手势 transition 开启时驱动时间线的 provider。 */
  gesture: null | GestureProvider,
  /** 仅 transition tracing 开启时记录的可选名称。 */
  name: null | string,
  /** 仅 transition tracing 开启时记录的开始时间。 */
  startTime: number,
  /** 仅开发环境记录本次 transition 更新过的 Fiber，用于订阅误用告警。 */
  _updatedFibers: Set<Fiber>,
  ...
};

/** 已登记的异步 transition 落定后，减少开发态在途计数。 */
function releaseAsyncTransition() {
  if (__DEV__) {
    ReactSharedInternals.asyncTransitions--;
  }
}

/**
 * 在新的 transition 上下文中同步调用作用域，并保证退出时恢复父上下文。
 *
 * 若作用域返回 Thenable，会登记落定处理与开发态异步计数；同步异常和异步拒绝都交给全局
 * 错误通道。renderer 钩子在 scope 返回后立即取得返回值，并按需登记异步 action；
 * `finally` 随同步调用栈恢复 T，不等待 Promise，因此 await 后的更新要重新进入 transition。
 * @param scope - 立即同步调用的更新作用域；返回值若为带 then 的对象则可交 renderer 纠缠 action。
 * @param options - 可选诊断 name，仅 enableTransitionTracing 开启时读取；不指定调度 delay。
 * @returns void，不返回 scope 结果、Promise 或取消句柄；外部读取 pending 应用 useTransition。
 * @remarks T 只标记执行 scope 的动态上下文，不把 JavaScript 放到后台线程。同步失败
 * 由 reportGlobalError 报给宿主，异步失败另订阅拒绝通道；宿主上报或告警本身抛错仍可
 * 传播。DEV 异步计数先递增再订阅，不为自定义 then 多次回调/注册抛错建立额外防护。
 */
export function startTransition(
  scope: () => void,
  options?: StartTransitionOptions,
): void {
  const prevTransition = ReactSharedInternals.T;
  const currentTransition: Transition = {} as any;
  if (enableViewTransition) {
    currentTransition.types =
      prevTransition !== null
        ? // 嵌套 transition 在概念上与父级纠缠为同一次 transition，因此应共享类型集合。
          // 当内部只添加类型而不更新状态时这一点尤其重要：内部可能先于外层完成，若另建
          // 集合就会丢失外层应观察到的类型。
          prevTransition.types
        : null;
  }
  if (enableGestureTransition) {
    currentTransition.gesture = null;
  }
  if (enableTransitionTracing) {
    currentTransition.name =
      options !== undefined && options.name !== undefined ? options.name : null;
    currentTransition.startTime = -1; // TODO：这里最终应读取真实时间戳。
  }
  if (__DEV__) {
    currentTransition._updatedFibers = new Set();
  }
  ReactSharedInternals.T = currentTransition;

  try {
    const returnValue = scope();
    const onStartTransitionFinish = ReactSharedInternals.S;
    if (onStartTransitionFinish !== null) {
      onStartTransitionFinish(currentTransition, returnValue);
    }
    if (
      typeof returnValue === 'object' &&
      // $FlowFixMe[invalid-compare]
      returnValue !== null &&
      typeof returnValue.then === 'function'
    ) {
      if (__DEV__) {
        // 统计仍在运行的异步 transition，供异步间隙中的 API 发出精确告警。
        ReactSharedInternals.asyncTransitions++;
        returnValue.then(releaseAsyncTransition, releaseAsyncTransition);
      }
      returnValue.then(noop, reportGlobalError);
    }
  } catch (error) {
    reportGlobalError(error);
  } finally {
    warnAboutTransitionSubscriptions(prevTransition, currentTransition);
    if (prevTransition !== null && currentTransition.types !== null) {
      // 若内部创建了类型集合，则在离开前回传父级；二者概念上相互纠缠，必须共享结果。
      if (__DEV__) {
        if (
          prevTransition.types !== null &&
          prevTransition.types !== currentTransition.types
        ) {
          // 断言共享集合的假设仍成立，避免静默覆盖父级在嵌套期间发生的修改。
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
  }
}

/**
 * 建立必须同步启动的手势 transition，并返回 renderer 提供的结束/清理函数。
 *
 * 手势要求立即启动；DEV 发现 scope 返回 Thenable 时告警，但仍继续调用 renderer 钩子。
 * 没有 renderer 钩子或 scope/钩子抛错时返回空清理函数。特性未开启或缺少 provider 会直接抛错。
 * @param provider - 宿主手势时间线；非 null 即接受，具体能力由 renderer 钩子解释。
 * @param scope - 必须立即安排手势更新的作用域；返回 thenable 仅 DEV 告警，不 await。
 * @param options - 手势 rangeStart/rangeEnd 及可选诊断 name，原样传给 renderer。
 * @returns renderer 的结束函数；无钩子或已上报失败时回退 noop，不是动画完成 Promise。
 * @remarks 手势建立独立 types 初值，不像普通嵌套 transition 继承父类型数组；G 钩子
 * 接管后才启动实际宿主工作。provider 检查在 scope 前，T 在正常钩子退出或抛错后恢复。
 */
export function startGestureTransition(
  provider: GestureProvider,
  scope: () => void,
  options?: GestureOptions & StartTransitionOptions,
): () => void {
  if (!enableGestureTransition) {
    // eslint-disable-next-line react-internal/prod-error-codes
    throw new Error(
      'startGestureTransition should not be exported when the enableGestureTransition flag is off.',
    );
  }
  if (provider == null) {
    // 即便类型已约束也必须运行时检查：内部用 `null` 区分普通 transition，放过它会悄悄
    // 改变调用语义，而不是立即指出缺少 Timeline。
    throw new Error(
      'A Timeline is required as the first argument to startGestureTransition.',
    );
  }
  const prevTransition = ReactSharedInternals.T;
  const currentTransition: Transition = {} as any;
  if (enableViewTransition) {
    currentTransition.types = null;
  }
  // $FlowFixMe[constant-condition]
  if (enableGestureTransition) {
    currentTransition.gesture = provider;
  }
  if (enableTransitionTracing) {
    currentTransition.name =
      options !== undefined && options.name !== undefined ? options.name : null;
    currentTransition.startTime = -1; // TODO：这里最终应读取真实时间戳。
  }
  if (__DEV__) {
    currentTransition._updatedFibers = new Set();
  }
  ReactSharedInternals.T = currentTransition;

  try {
    const returnValue = scope();
    if (__DEV__) {
      if (
        typeof returnValue === 'object' &&
        // $FlowFixMe[invalid-compare]
        returnValue !== null &&
        typeof returnValue.then === 'function'
      ) {
        console.error(
          'Cannot use an async function in startGestureTransition. It must be able to start immediately.',
        );
      }
    }
    const onStartGestureTransitionFinish = ReactSharedInternals.G;
    if (onStartGestureTransitionFinish !== null) {
      return onStartGestureTransitionFinish(
        currentTransition,
        provider,
        options,
      );
    }
  } catch (error) {
    reportGlobalError(error);
  } finally {
    ReactSharedInternals.T = prevTransition;
  }
  return noop;
}

/**
 * 在最外层 transition 结束时检查更新规模，并清空 Fiber 集合释放开发态引用。
 * 超过 10 个 Fiber 时提示检查是否使用了外部订阅；数量本身不能确定更新来自订阅。
 */
function warnAboutTransitionSubscriptions(
  prevTransition: Transition | null,
  currentTransition: Transition,
) {
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
