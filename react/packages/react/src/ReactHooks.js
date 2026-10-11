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

/**
 * 公共 Hooks 是 renderer 协议入口，不在 react 包中保存 Fiber、Hook 链或更新队列。
 * 每次调用重新读取 H；mount/update/rerender、服务端和非法调用阶段可安装不同 dispatcher。
 * 下列参数原样转发，依赖比较、状态回放、effect 创建/清理与挂起都由该实现决定。
 * 因此这里没有 catch、异步等待或跨 renderer 缓存，dispatcher 的返回值/异常直接传播。
 */

/** state hook 接受的新值或基于前值计算新值的函数。 */
type BasicStateAction<S> = (S => S) | S;
/** 把 action 交给当前 hook 队列的派发函数。 */
type Dispatch<A> = A => void;

/**
 * 读取当前 renderer 在共享槽中安装的 Hooks dispatcher。
 *
 * @remarks React 公共包不实现 hook 状态机；render 阶段由 reconciler 注入具体实现。
 * dispatcher 为空时在 DEV 给出诊断，随后由调用处的空值访问失败；此处不另行抛错。
 * reconciler 退出函数组件后通常安装 ContextOnlyDispatcher，由它拒绝 state/effect 等调用。
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
  // 空槽位由后续方法访问报错；非空 dispatcher 自己决定哪些 API 当前可用。
  return dispatcher as any as Dispatcher;
}

/**
 * 从异步 dispatcher 的缓存域取得由 resourceType 身份索引的资源。
 * @param resourceType - 零参数资源工厂；有 dispatcher 时是否调用/复用由其缓存表决定。
 * @returns 该域已有资源或工厂结果；无 A 时每次直接调用工厂，不建立模块全局缓存。
 * @remarks 工厂可有副作用或抛错；异常与 undefined 的缓存规则属于 dispatcher 实现。
 */
export function getCacheForType<T>(resourceType: () => T): T {
  const dispatcher = ReactSharedInternals.A;
  if (!dispatcher) {
    // 无 dispatcher 时不跨调用缓存，直接创建资源。
    return resourceType();
  }
  return dispatcher.getCacheForType(resourceType);
}

/**
 * 把 Context 读取转发给当前 renderer，并在 DEV 报告误传 Consumer。
 * @param Context - createContext 返回的本体，身份决定所读值栈与依赖记录。
 * @returns renderer 当前提供的值；此包装器不写 Context 或自行登记订阅。
 * @remarks Consumer 误用仅 console.error，仍继续转发原参数，不在此修正或直接拒绝。
 */
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

/**
 * 把 state Hook 的初始化、读取和更新队列交给当前 renderer。
 * @param initialState - 初值或惰性初值工厂；是否执行工厂由 mount 等 dispatcher 分支决定。
 * @returns 当前状态与派发函数；派发接受值或前值计算函数，不由本包装器同步改写状态。
 */
export function useState<S>(
  initialState: (() => S) | S,
): [S, Dispatch<BasicStateAction<S>>] {
  const dispatcher = resolveDispatcher();
  return dispatcher.useState(initialState);
}

/**
 * 把 reducer 状态协议交给当前 renderer。
 * @param reducer - 按前状态与 action 计算新状态的规则，队列回放时由 renderer 调用。
 * @param initialArg - 初始化输入；不是每次 render 都应用的新状态。
 * @param init - 可选的 initialArg 到初始状态转换器，原样转发。
 * @returns 当前状态与 action 派发函数；存储、lane 筛选和重放不在公共包装器执行。
 */
export function useReducer<S, I, A>(
  reducer: (S, A) => S,
  initialArg: I,
  init?: I => S,
): [S, Dispatch<A>] {
  const dispatcher = resolveDispatcher();
  return dispatcher.useReducer(reducer, initialArg, init);
}

/**
 * 从当前 dispatcher 取得 ref Hook 的可变容器。
 * @param initialValue - 首次建立容器时的 current 初值；更新 render 的复用由 renderer 决定。
 * @returns 含 current 的对象；直接修改 current 不在此安排组件更新。
 * @remarks 与每次新建对象的 createRef 不同，客户端 Hook 槽保存跨 render 的容器身份。
 */
export function useRef<T>(initialValue: T): {
  /** 当前 renderer 保存的 ref 值。 */
  current: T
} {
  const dispatcher = resolveDispatcher();
  return dispatcher.useRef(initialValue);
}

/**
 * 注册由 renderer 后续冲刷的 passive effect。
 * @param create - 提交生效后调用的创建函数，可返回下次替换/卸载使用的清理函数。
 * @param deps - 依赖序列；传入相同依赖是否跳过创建由 renderer 的依赖比较决定。
 * @remarks 这里不执行 create/cleanup；DEV 缺 callback 只警告，随后仍转发参数。
 */
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

/**
 * 注册 mutation 阶段的 insertion effect，供 layout effect 前的样式注入使用。
 * @param create - 创建逻辑及其可选清理函数，在相应提交阶段执行而非本次 Hook 调用时。
 * @param deps - 控制 renderer 是否替换上次 effect 的依赖序列。
 * @remarks DEV 缺 callback 只警告；执行顺序、清理和插入阶段限制由 renderer 处理。
 */
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

/**
 * 注册 commit 的 layout effect；DOM renderer 在浏览器绘制前同步执行该阶段。
 * @param create - 读取已提交宿主状态的创建函数，可返回依赖变化/卸载时的清理函数。
 * @param deps - 控制 effect 是否需要替换的依赖序列，原样转发给 renderer。
 * @remarks 公共包装器不读取 DOM，也不保证任意 renderer 具有浏览器绘制语义。
 */
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

/**
 * 把 callback 与依赖序列交给 renderer，选择本次应返回的函数引用。
 * @param callback - 本次 render 提供的候选值；包装器不调用它或绑定 this。
 * @param deps - 依赖比较输入；相等时 renderer 可复用前次保存的 callback。
 * @returns dispatcher 返回的回调引用，不是执行 callback 后的结果。
 */
export function useCallback<T>(
  callback: T,
  deps: Array<mixed> | void | null,
): T {
  const dispatcher = resolveDispatcher();
  return dispatcher.useCallback(callback, deps);
}

/**
 * 按依赖序列请求 renderer 复用或重新计算 memo 值。
 * @param create - 需要重新计算时执行的零参数工厂，异常沿 render 路径传播。
 * @param deps - 依赖比较输入，公共包装器不深比较其中对象。
 * @returns 工厂结果或先前保存结果；缓存存储和丢弃时机由当前 renderer 管理。
 */
export function useMemo<T>(
  create: () => T,
  deps: Array<mixed> | void | null,
): T {
  const dispatcher = resolveDispatcher();
  return dispatcher.useMemo(create, deps);
}

/**
 * 请求 renderer 在 layout effect 协议中安装自定义命令式句柄。
 * @param ref - 目标对象 ref 或回调 ref；为空时是否忽略由 renderer 实现决定。
 * @param create - 提交阶段计算公开句柄的工厂，不在此立即执行。
 * @param deps - 决定何时重建句柄的依赖；ref 的变更与解绑清理由 renderer 处理。
 * @remarks 此入口不保存 ref、不读宿主实例，直接返回 dispatcher 的 void 结果。
 */
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

/**
 * 在 DEV 向当前 renderer 提交自定义 Hook 调试值。
 * @param value - DevTools 可显示的原始值，不因此参与组件状态或调度。
 * @param formatterFn - 可选显示格式器；此包装器不调用它，消费规则由 renderer/DevTools 决定。
 * @remarks 生产分支连 dispatcher 都不读取，直接返回 undefined。
 */
export function useDebugValue<T>(
  value: T,
  formatterFn: ?(value: T) => mixed,
): void {
  if (__DEV__) {
    const dispatcher = resolveDispatcher();
    return dispatcher.useDebugValue(value, formatterFn);
  }
}

/**
 * 请求 renderer 返回该 Hook 跟踪的 transition 状态与启动函数。
 * @returns [isPending, start]；start 执行给定 callback 并标注其更新，可接诊断 name 选项。
 * @remarks pending 状态的调度、异步 action 等待和完成回滚由 renderer 管理；公共入口
 * 不把 callback 放到后台线程，也不自动延迟调用 callback。
 */
export function useTransition(): [
  boolean,
  (callback: () => void, options?: StartTransitionOptions) => void,
] {
  const dispatcher = resolveDispatcher();
  return dispatcher.useTransition();
}

/**
 * 请求 renderer 按当前更新优先级选择可延后的值。
 * @param value - 当前 render 的最新候选值，不是状态派发函数或 timeout。
 * @param initialValue - 可选初始占位值，首次或重新显露路径如何采用由 renderer 决定。
 * @returns 本次 render 应使用的值；可能暂时保留旧值并安排后台 render。
 */
export function useDeferredValue<T>(value: T, initialValue?: T): T {
  const dispatcher = resolveDispatcher();
  return dispatcher.useDeferredValue(value, initialValue);
}

/**
 * 从 renderer 取得当前 Hook 位置的 ID，供关联宿主属性及服务端 hydration 对应使用。
 * @returns ID 字符串；前缀、树位置编码与客户端计数策略由 renderer 的实现决定。
 * @remarks 公共包不维护全局 ID 计数器，也不把该值作为 children 的业务 key。
 */
export function useId(): string {
  const dispatcher = resolveDispatcher();
  return dispatcher.useId();
}

/**
 * 订阅外部可变存储，并用同步快照协议避免并发渲染中的撕裂。
 * @param subscribe - 注册变化通知并返回 unsubscribe；订阅安装/替换发生在 renderer effect 路径。
 * @param getSnapshot - 同步取得客户端快照，相同存储状态应返回可稳定比较的值。
 * @param getServerSnapshot - 可选服务端/hydration 快照入口，缺失时的处理由 renderer 决定。
 * @returns 当前 render 采用的快照；提交一致性检查与补发同步更新由 renderer 负责。
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

/**
 * 返回当前 renderer 的缓存刷新函数，供调用方请求替换所属缓存域。
 * @returns 可接资源工厂与预置值的扩展函数；定位缓存边界、安排更新和释放旧域属于 renderer。
 * @remarks dispatcher 方法是可选实验能力；不支持时由实际方法访问/调用产生错误。
 */
export function useCacheRefresh(): <T>(?() => T, ?T) => void {
  const dispatcher = resolveDispatcher();
  // $FlowFixMe[not-a-function] This is unstable, thus optional
  return dispatcher.useCacheRefresh();
}

/**
 * 让当前 renderer 读取可用值，必要时将控制权交给挂起或恢复路径。
 * @param usable - Context、Thenable 或跨 renderer 的 ReactRecoverable 信号。
 * @returns 已可读的值；未完成/失败时 dispatcher 可以抛 thenable、reason 或恢复信号。
 * @remarks 此包装器不 await，不自己标记 Promise，也不把控制信号转换为普通返回值。
 */
export function use<T>(usable: Usable<T>): T {
  const dispatcher = resolveDispatcher();
  return dispatcher.use(usable);
}

/**
 * 为 React Compiler 生成代码请求一组固定数量的 memo 槽位。
 * @param size - 编译器为当前缓存调用点分配的槽位数量，不是字节数或可变业务数组长度。
 * @returns renderer 初始化/复用的缓存数组；sentinel、复制与 render 重试所有权由其实现管理。
 */
export function useMemoCache(size: number): Array<mixed> {
  const dispatcher = resolveDispatcher();
  // $FlowFixMe[not-a-function] This is unstable, thus optional
  return dispatcher.useMemoCache(size);
}

/**
 * 请求 renderer 创建读取已提交 callback 实现的 effect event。
 * @param callback - 本次 render 的候选实现，其引用如何在提交时更新由 renderer 决定。
 * @returns 转交给 effect 使用的可调用函数；参数/结果由该函数传递给已提交实现。
 * @remarks renderer 会拒绝 render 阶段调用；此公共包装器本身不执行或缓存 callback。
 */
export function useEffectEvent<Args, F: (...Array<Args>) => mixed>(
  callback: F,
): F {
  const dispatcher = resolveDispatcher();
  // $FlowFixMe[not-a-function] This is unstable, thus optional
  return dispatcher.useEffectEvent(callback);
}

/**
 * 请求 renderer 在基础状态上叠加待完成 action 的乐观更新。
 * @param passthrough - 当前 render 的基础状态，完成或回滚后以最新基础值重新计算。
 * @param reducer - 可选前状态/action 合并规则，原样交给乐观队列实现。
 * @returns 当前乐观状态与 action 派发函数；回滚 lane 和 action 生命周期由 renderer 管理。
 */
export function useOptimistic<S, A>(
  passthrough: S,
  reducer: ?(S, A) => S,
): [S, (A) => void] {
  const dispatcher = resolveDispatcher();
  return dispatcher.useOptimistic(passthrough, reducer);
}

/**
 * 请求 renderer 把 action 结果纳入状态，并跟踪队列 pending 状态。
 * @param action - 接收此前已解析状态与 payload 的处理函数；串行执行及异步等待由 renderer 管理。
 * @param initialState - 首次建立 action 状态的初值，后续 render 不在此重新覆盖队列。
 * @param permalink - 可选表单目标 URL，供服务端表单状态及渐进增强协议使用。
 * @returns [state, dispatch, isPending]；dispatch 接收 payload，公共包装器不立即执行 action。
 */
export function useActionState<S, P>(
  action: (Awaited<S>, P) => S,
  initialState: Awaited<S>,
  permalink?: string,
): [Awaited<S>, (P) => void, boolean] {
  const dispatcher = resolveDispatcher();
  return dispatcher.useActionState(action, initialState, permalink);
}
