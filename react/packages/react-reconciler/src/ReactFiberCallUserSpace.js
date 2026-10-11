/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactInternalTypes';
import type {LazyComponent} from 'react/src/ReactLazy';
import type {Effect} from './ReactFiberHooks';
import type {CapturedValue} from './ReactCapturedValue';

import {isRendering, setIsRendering} from './ReactCurrentFiber';
import {captureCommitPhaseError} from './ReactFiberWorkLoop';

// 这些间接层让开发环境能从组件栈中排除边界函数及其下方内部帧。
// TODO: 可考虑标记整个 bundle，而不是逐个用户代码边界包装。

/** 包装函数组件调用并切换 React“正在渲染”调试状态。 */
const callComponent = {
  /** 组件栈裁剪识别的底部帧；finally 保证恢复先前渲染状态。 */
  react_stack_bottom_frame: function <Props, Arg, R>(
    Component: (p: Props, arg: Arg) => R,
    props: Props,
    secondArg: Arg,
  ): R {
    const wasRendering = isRendering;
    setIsRendering(true);
    try {
      const result = Component(props, secondArg);
      return result;
    } finally {
      setIsRendering(wasRendering);
    }
  },
};

/** 开发环境调用函数组件的具名边界；生产构建为空。 */
export const callComponentInDEV: <Props, Arg, R>(
  Component: (p: Props, arg: Arg) => R,
  props: Props,
  secondArg: Arg,
) => R = __DEV__
  ? // 通过 bind 让压缩器保留用于组件栈裁剪的函数名。
    (callComponent.react_stack_bottom_frame.bind(callComponent) as any)
  : (null as any);

/** 本模块调用的类组件生命周期最小接口。 */
interface ClassInstance<R> {
  /** 计算本轮类组件输出。 */
  render(): R;
  /** 实例首次提交后执行的挂载生命周期。 */
  componentDidMount(): void;
  /** 更新提交后接收旧 props/state 与 snapshot 的生命周期。 */
  componentDidUpdate(
    prevProps: Object,
    prevState: Object,
    snaphot: Object,
  ): void;
  /** Error Boundary 捕获后接收错误与组件栈。 */
  componentDidCatch(
    error: mixed,
    errorInfo: {
      /** React 生成的故障组件栈。 */
      componentStack: string
    }
  ): void;
  /** 实例删除前执行的卸载生命周期。 */
  componentWillUnmount(): void;
}

/** 包装类实例 render 调用并维护“正在渲染”调试状态。 */
const callRender = {
  /** 调用 instance.render 并用 finally 恢复 isRendering；用户抛错继续交给 render 异常路径。 */
  react_stack_bottom_frame: function <R>(instance: ClassInstance<R>): R {
    const wasRendering = isRendering;
    setIsRendering(true);
    try {
      const result = instance.render();
      return result;
    } finally {
      setIsRendering(wasRendering);
    }
  },
};

/** 开发环境调用类实例 render 的具名边界；生产构建为空。 */
export const callRenderInDEV: <R>(instance: ClassInstance<R>) => R => R =
  __DEV__
    ? // 通过 bind 让压缩器保留用于组件栈裁剪的函数名。
      (callRender.react_stack_bottom_frame.bind(callRender) as any)
    : (null as any);

/** 捕获 componentDidMount 抛错并交给 commit 阶段错误边界。 */
const callComponentDidMount = {
  /** 调用挂载生命周期；抛错以 finishedWork 为故障点、其 return 为仍挂载祖先交给 commit 错误捕获。 */
  react_stack_bottom_frame: function (
    finishedWork: Fiber,
    instance: ClassInstance<any>,
  ): void {
    try {
      instance.componentDidMount();
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  },
};

/** 开发环境调用 componentDidMount 的具名安全边界。 */
export const callComponentDidMountInDEV: (
  finishedWork: Fiber,
  instance: ClassInstance<any>,
) => void = __DEV__
  ? // 通过 bind 让压缩器保留用于组件栈裁剪的函数名。
    (callComponentDidMount.react_stack_bottom_frame.bind(
      callComponentDidMount,
    ) as any)
  : (null as any);

/** 调用 componentDidUpdate，并把用户异常捕获为 commit 阶段错误。 */
const callComponentDidUpdate = {
  /** 传入上次 props/state 与 before-mutation snapshot；用户异常进入 finishedWork 的 commit 捕获路径。 */
  react_stack_bottom_frame: function (
    finishedWork: Fiber,
    instance: ClassInstance<any>,
    prevProps: Object,
    prevState: Object,
    snapshot: Object,
  ): void {
    try {
      instance.componentDidUpdate(prevProps, prevState, snapshot);
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  },
};

/** 开发环境调用 componentDidUpdate 的具名安全边界。 */
export const callComponentDidUpdateInDEV: (
  finishedWork: Fiber,
  instance: ClassInstance<any>,
  prevProps: Object,
  prevState: Object,
  snaphot: Object,
) => void = __DEV__
  ? // 通过 bind 让压缩器保留用于组件栈裁剪的函数名。
    (callComponentDidUpdate.react_stack_bottom_frame.bind(
      callComponentDidUpdate,
    ) as any)
  : (null as any);

/** 把 CapturedValue 转换成公开 componentDidCatch 参数。 */
const callComponentDidCatch = {
  /** 将 value 和空串兜底的组件栈传给错误边界；此包装不 catch，回调自身错误由调用方 commit 边界处理。 */
  react_stack_bottom_frame: function (
    instance: ClassInstance<any>,
    errorInfo: CapturedValue<mixed>,
  ): void {
    const error = errorInfo.value;
    const stack = errorInfo.stack;
    instance.componentDidCatch(error, {
      componentStack: stack !== null ? stack : '',
    });
  },
};

/** 开发环境调用 componentDidCatch 的具名边界。 */
export const callComponentDidCatchInDEV: (
  instance: ClassInstance<any>,
  errorInfo: CapturedValue<mixed>,
) => void = __DEV__
  ? // 通过 bind 让压缩器保留用于组件栈裁剪的函数名。
    (callComponentDidCatch.react_stack_bottom_frame.bind(
      callComponentDidCatch,
    ) as any)
  : (null as any);

/** 调用 componentWillUnmount，并把用户异常捕获为 commit 阶段错误。 */
const callComponentWillUnmount = {
  /** 调用删除中的实例卸载生命周期；nearestMountedAncestor 避免沿已删除边界重新寻找错误处理器。 */
  react_stack_bottom_frame: function (
    current: Fiber,
    nearestMountedAncestor: Fiber | null,
    instance: ClassInstance<any>,
  ): void {
    try {
      instance.componentWillUnmount();
    } catch (error) {
      captureCommitPhaseError(current, nearestMountedAncestor, error);
    }
  },
};

/** 开发环境调用 componentWillUnmount 的具名安全边界。 */
export const callComponentWillUnmountInDEV: (
  current: Fiber,
  nearestMountedAncestor: Fiber | null,
  instance: ClassInstance<any>,
) => void = __DEV__
  ? // 通过 bind 让压缩器保留用于组件栈裁剪的函数名。
    (callComponentWillUnmount.react_stack_bottom_frame.bind(
      callComponentWillUnmount,
    ) as any)
  : (null as any);

/** 调用 Hook Effect create，并把返回的 destroy 存到 EffectInstance，供后续更新或卸载清理。 */
const callCreate = {
  /** 执行 effect.create 后保存清理值；create 抛错时不写 destroy，由外层 effect 提交路径捕获。 */
  react_stack_bottom_frame: function (
    effect: Effect,
  ): (() => void) | {...} | void | null {
    const create = effect.create;
    const inst = effect.inst;
    const destroy = create();
    inst.destroy = destroy;
    return destroy;
  },
};

/** 开发环境调用 Effect create 的具名边界。 */
export const callCreateInDEV: (effect: Effect) => (() => void) | void = __DEV__
  ? // 通过 bind 让压缩器保留用于组件栈裁剪的函数名。
    (callCreate.react_stack_bottom_frame.bind(callCreate) as any)
  : (null as any);

/** 调用 Effect destroy，并把用户异常捕获为 commit 阶段错误。 */
const callDestroy = {
  /** 同步调用清理函数；故障归于 current，并从 nearestMountedAncestor 开始寻找仍挂载的错误边界。 */
  react_stack_bottom_frame: function (
    current: Fiber,
    nearestMountedAncestor: Fiber | null,
    destroy: () => void,
  ): void {
    try {
      destroy();
    } catch (error) {
      captureCommitPhaseError(current, nearestMountedAncestor, error);
    }
  },
};

/** 开发环境调用 Effect destroy 的具名安全边界。 */
export const callDestroyInDEV: (
  current: Fiber,
  nearestMountedAncestor: Fiber | null,
  destroy: (() => void) | (({...}) => void),
) => void = __DEV__
  ? // 通过 bind 让压缩器保留用于组件栈裁剪的函数名。
    (callDestroy.react_stack_bottom_frame.bind(callDestroy) as any)
  : (null as any);

/** 执行 React.lazy 的 init(payload)，保留独立用户代码栈边界。 */
const callLazyInit = {
  /** 用 lazy._payload 调用 _init；其 thenable 或错误原样抛出，由 child/render 协调路径处理。 */
  react_stack_bottom_frame: function (lazy: LazyComponent<any, any>): any {
    const payload = lazy._payload;
    const init = lazy._init;
    return init(payload);
  },
};

/** 开发环境调用 lazy 初始化器的具名边界。 */
export const callLazyInitInDEV: (lazy: LazyComponent<any, any>) => any = __DEV__
  ? // 通过 bind 让压缩器保留用于组件栈裁剪的函数名。
    (callLazyInit.react_stack_bottom_frame.bind(callLazyInit) as any)
  : (null as any);
