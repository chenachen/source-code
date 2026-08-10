/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Dispatcher} from 'react-reconciler/src/ReactInternalTypes';
import type {
  ReactContext,
  StartTransitionOptions,
  Usable,
  Awaited,
} from 'shared/ReactTypes';
import {REACT_CONSUMER_TYPE} from 'shared/ReactSymbols';

import ReactSharedInternals from 'shared/ReactSharedInternals';

/** state hook 接受的新值或基于前值计算新值的函数。 */
type BasicStateAction<S> = (S => S) | S;
/** 把 action 交给当前 hook 队列的派发函数。 */
type Dispatch<A> = A => void;

/**
 * 读取当前 renderer 在共享槽中安装的 Hooks dispatcher。
 *
 * @remarks React 公共包不实现 hook 状态机；render 阶段由 reconciler 注入具体实现。
 * render 外调用会在 DEV 给出诊断，随后仍通过空值访问自然失败，以保持热路径可内联。
 */
function resolveDispatcher() {
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
  // render 阶段外会自然触发空值访问错误。这里故意不自行抛错，减少热路径工作并利于内联。
  return dispatcher as any as Dispatcher;
}

/** 从当前异步 dispatcher 取得某资源类型的请求级缓存实例。 */
export function getCacheForType<T>(resourceType: () => T): T {
  const dispatcher = ReactSharedInternals.A;
  if (!dispatcher) {
    // 无 dispatcher 时不跨调用缓存，直接创建资源。
    return resourceType();
  }
  return dispatcher.getCacheForType(resourceType);
}

/** 把 Context 读取转发给当前 renderer，并在 DEV 拒绝误传 Consumer。 */
export function useContext<T>(Context: ReactContext<T>): T {
  const dispatcher = resolveDispatcher();
  if (__DEV__) {
    if (Context.$$typeof === REACT_CONSUMER_TYPE) {
      console.error(
        'Calling useContext(Context.Consumer) is not supported and will cause bugs. ' +
          'Did you mean to call useContext(Context) instead?',
      );
    }
  }
  return dispatcher.useContext(Context);
}

/** 把 state hook 的初始化与更新队列创建交给当前 renderer。 */
export function useState<S>(
  initialState: (() => S) | S,
): [S, Dispatch<BasicStateAction<S>>] {
  const dispatcher = resolveDispatcher();
  return dispatcher.useState(initialState);
}

/** 把 reducer、初始参数和可选初始化器交给当前 renderer。 */
export function useReducer<S, I, A>(
  reducer: (S, A) => S,
  initialArg: I,
  init?: I => S,
): [S, Dispatch<A>] {
  const dispatcher = resolveDispatcher();
  return dispatcher.useReducer(reducer, initialArg, init);
}

/** 创建在组件生命周期内保持对象身份的可变 ref。 */
export function useRef<T>(initialValue: T): {
  /** 当前 renderer 保存的 ref 值。 */
  current: T
} {
  const dispatcher = resolveDispatcher();
  return dispatcher.useRef(initialValue);
}

/** 注册提交后异步执行、并可返回清理函数的 effect。 */
export function useEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  if (__DEV__) {
    if (create == null) {
      console.warn(
        'React Hook useEffect requires an effect callback. Did you forget to pass a callback to the hook?',
      );
    }
  }

  const dispatcher = resolveDispatcher();
  return dispatcher.useEffect(create, deps);
}

/** 注册在 DOM 变更前运行的 insertion effect，供样式注入等场景使用。 */
export function useInsertionEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  if (__DEV__) {
    if (create == null) {
      console.warn(
        'React Hook useInsertionEffect requires an effect callback. Did you forget to pass a callback to the hook?',
      );
    }
  }

  const dispatcher = resolveDispatcher();
  return dispatcher.useInsertionEffect(create, deps);
}

/** 注册提交后、浏览器绘制前同步执行的 layout effect。 */
export function useLayoutEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  if (__DEV__) {
    if (create == null) {
      console.warn(
        'React Hook useLayoutEffect requires an effect callback. Did you forget to pass a callback to the hook?',
      );
    }
  }

  const dispatcher = resolveDispatcher();
  return dispatcher.useLayoutEffect(create, deps);
}

/** 按依赖数组保持回调引用，由当前 renderer 决定是否复用。 */
export function useCallback<T>(
  callback: T,
  deps: Array<mixed> | void | null,
): T {
  const dispatcher = resolveDispatcher();
  return dispatcher.useCallback(callback, deps);
}

/** 按依赖数组缓存计算结果，由当前 renderer 管理其生命周期。 */
export function useMemo<T>(
  create: () => T,
  deps: Array<mixed> | void | null,
): T {
  const dispatcher = resolveDispatcher();
  return dispatcher.useMemo(create, deps);
}

/** 把自定义命令式实例绑定到对象 ref 或回调 ref。 */
export function useImperativeHandle<T>(
  ref:
    {
        /** 提交时写入、清理时复位的命令式实例。 */
        current: T | null
      }
    | ((inst: T | null) => mixed)
    | null
    | void,
  create: () => T,
  deps: Array<mixed> | void | null,
): void {
  const dispatcher = resolveDispatcher();
  return dispatcher.useImperativeHandle(ref, create, deps);
}

/** 在 DEV 向 DevTools 暴露自定义 hook 调试值；生产构建为空操作。 */
export function useDebugValue<T>(
  value: T,
  formatterFn: ?(value: T) => mixed,
): void {
  if (__DEV__) {
    const dispatcher = resolveDispatcher();
    return dispatcher.useDebugValue(value, formatterFn);
  }
}

/** 返回当前 transition 的 pending 状态与启动低优先级更新的函数。 */
export function useTransition(): [
  boolean,
  (callback: () => void, options?: StartTransitionOptions) => void,
] {
  const dispatcher = resolveDispatcher();
  return dispatcher.useTransition();
}

/** 允许 renderer 延后采用新值，并可在初次渲染使用指定占位值。 */
export function useDeferredValue<T>(value: T, initialValue?: T): T {
  const dispatcher = resolveDispatcher();
  return dispatcher.useDeferredValue(value, initialValue);
}

/** 从 renderer 取得在服务端与客户端可对应的组件级稳定 ID。 */
export function useId(): string {
  const dispatcher = resolveDispatcher();
  return dispatcher.useId();
}

/**
 * 订阅外部可变存储，并用同步快照协议避免并发渲染中的撕裂。
 */
export function useSyncExternalStore<T>(
  subscribe: (() => void) => () => void,
  getSnapshot: () => T,
  getServerSnapshot?: () => T,
): T {
  const dispatcher = resolveDispatcher();
  return dispatcher.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
}

/** 返回使当前缓存边界失效的 renderer 扩展函数。 */
export function useCacheRefresh(): <T>(?() => T, ?T) => void {
  const dispatcher = resolveDispatcher();
  // $FlowFixMe[not-a-function] This is unstable, thus optional
  return dispatcher.useCacheRefresh();
}

/** 让 renderer 读取 Context、thenable 等可用值，并按需挂起当前组件。 */
export function use<T>(usable: Usable<T>): T {
  const dispatcher = resolveDispatcher();
  return dispatcher.use(usable);
}

/** 为 React Compiler 取得固定槽位数的组件级 memo 缓存数组。 */
export function useMemoCache(size: number): Array<mixed> {
  const dispatcher = resolveDispatcher();
  // $FlowFixMe[not-a-function] This is unstable, thus optional
  return dispatcher.useMemoCache(size);
}

/** 创建读取最新闭包值、但不参与 effect 依赖关系的事件函数。 */
export function useEffectEvent<Args, F: (...Array<Args>) => mixed>(
  callback: F,
): F {
  const dispatcher = resolveDispatcher();
  // $FlowFixMe[not-a-function] This is unstable, thus optional
  return dispatcher.useEffectEvent(callback);
}

/** 在异步 action 完成前叠加乐观状态，并返回派发乐观 action 的函数。 */
export function useOptimistic<S, A>(
  passthrough: S,
  reducer: ?(S, A) => S,
): [S, (A) => void] {
  const dispatcher = resolveDispatcher();
  return dispatcher.useOptimistic(passthrough, reducer);
}

/** 把 action 结果纳入组件状态，并返回派发函数与 pending 标记。 */
export function useActionState<S, P>(
  action: (Awaited<S>, P) => S,
  initialState: Awaited<S>,
  permalink?: string,
): [Awaited<S>, (P) => void, boolean] {
  const dispatcher = resolveDispatcher();
  return dispatcher.useActionState(action, initialState, permalink);
}
