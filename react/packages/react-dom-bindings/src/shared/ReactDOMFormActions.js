/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Dispatcher} from 'react-reconciler/src/ReactInternalTypes';
import type {Awaited} from 'shared/ReactTypes';

import ReactSharedInternals from 'shared/ReactSharedInternals';
import ReactDOMSharedInternals from 'shared/ReactDOMSharedInternals';

/** 表单没有进行中 action 时的稳定状态形状。 */
type FormStatusNotPending = {|
  /** 固定为 false，作为联合类型判别字段。 */
  pending: false,
  /** 非 pending 状态不携带提交数据。 */
  data: null,
  /** 非 pending 状态不携带 HTTP 方法。 */
  method: null,
  /** 非 pending 状态不携带 action。 */
  action: null,
|};

/** 表单 action 正在执行时暴露给宿主 transition Hook 的状态。 */
type FormStatusPending = {|
  /** 固定为 true，表示 action 尚未完成。 */
  pending: true,
  /** 本次提交的 FormData 快照。 */
  data: FormData,
  /** 本次表单提交采用的方法。 */
  method: string,
  /** 目标 URL 或接收 FormData 的函数 action。 */
  action: string | (FormData => void | Promise<void>) | null,
|};

/** 表单 action 对外可见的判别联合状态。 */
export type FormStatus = FormStatusPending | FormStatusNotPending;

/** “非 pending”值恒定，因此所有 transition 共享同一对象，避免无意义分配。 */
const sharedNotPendingObject: FormStatusNotPending = {
  pending: false,
  data: null,
  method: null,
  action: null,
};

/**
 * 对外暴露的共享非 pending 状态；开发环境冻结它以尽早发现意外写入。
 */
export const NotPending: FormStatus = __DEV__
  ? Object.freeze(sharedNotPendingObject)
  : sharedNotPendingObject;

/**
 * 取得当前 React Hook dispatcher。
 * 边界：渲染阶段外调用会在后续空引用处自然失败；热路径不额外主动抛错。
 */
function resolveDispatcher() {
  // 与 react/src/ReactHooks.js 的实现相同；这里因包边界需要保留副本。
  const dispatcher = ReactSharedInternals.H;
  if (__DEV__) {
    if (dispatcher === null) {
      console.error(
        'Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for' +
          ' one of the following reasons:\n' +
          '1. You might have mismatching versions of React and the renderer (such as React DOM)\n' +
          '2. You might be breaking the Rules of Hooks\n' +
          '3. You might have more than one copy of React in the same app\n' +
          'See https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem.',
      );
    }
  }
  // 渲染阶段外访问会产生空引用错误。热路径有意不自行抛错，也便于内联。
  return dispatcher as any as Dispatcher;
}

/** 读取最近宿主表单 transition 的状态。 */
export function useFormStatus(): FormStatus {
  const dispatcher = resolveDispatcher();
  return dispatcher.useHostTransitionStatus();
}

/**
 * 把表单 action、初始状态及可选永久链接交给当前 dispatcher 管理。
 * 返回值包含最新状态、派发函数和 pending 标志。
 */
export function useFormState<S, P>(
  action: (Awaited<S>, P) => S,
  initialState: Awaited<S>,
  permalink?: string,
): [Awaited<S>, (P) => void, boolean] {
  const dispatcher = resolveDispatcher();
  return dispatcher.useFormState(action, initialState, permalink);
}

/** 请求当前 React DOM dispatcher 在提交后重置指定表单。 */
export function requestFormReset(form: HTMLFormElement) {
  ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */
    .r(/* requestFormReset */ form);
}
