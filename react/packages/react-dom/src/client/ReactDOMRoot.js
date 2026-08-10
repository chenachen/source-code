/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactNodeList, ReactFormState} from 'shared/ReactTypes';
import type {
  FiberRoot,
  TransitionTracingCallbacks,
} from 'react-reconciler/src/ReactInternalTypes';

import {isValidContainer} from 'react-dom-bindings/src/client/ReactDOMContainer';
import {queueExplicitHydrationTarget} from 'react-dom-bindings/src/events/ReactDOMEventReplaying';
import {REACT_ELEMENT_TYPE} from 'shared/ReactSymbols';
import {
  disableCommentsAsDOMContainers,
  enableDefaultTransitionIndicator,
} from 'shared/ReactFeatureFlags';

/** 公开并发根句柄；封装 reconciler 根，调用者只能渲染或卸载。 */
export type RootType = {
  /** 把新的 React 子树排入该根；提交时由 reconciler 更新宿主 DOM。 */
  render(children: ReactNodeList): void,
  /** 同步卸载该根并解除容器所有权标记。 */
  unmount(): void,
  /** 内部 Fiber 根；卸载后置空，用作重复操作的状态哨兵。 */
  _internalRoot: FiberRoot | null,
};

/** 创建非 hydration 并发根时可覆盖的错误、标识与追踪策略。 */
export type CreateRootOptions = {
  /** 是否为此根启用严格模式检查。 */
  unstable_strictMode?: boolean,
  /** Transition tracing 的内部回调集合。 */
  unstable_transitionCallbacks?: TransitionTracingCallbacks,
  /** useId 等服务端/客户端标识使用的根级前缀。 */
  identifierPrefix?: string,
  /** 接收未被错误边界捕获的根级错误。 */
  onUncaughtError?: (
    error: mixed,
    errorInfo: {
      /** 错误发生位置对应的组件栈。 */
      +componentStack?: ?string
    },
  ) => void,
  /** 接收被错误边界捕获的错误及边界信息。 */
  onCaughtError?: (
    error: mixed,
    errorInfo: {
      /** 错误发生位置对应的组件栈。 */
      +componentStack?: ?string,
      /** 实际捕获错误的边界组件类型。 */
      +errorBoundary?: ?component(...props: any),
    },
  ) => void,
  /** 接收 React 可以恢复但仍需上报的错误。 */
  onRecoverableError?: (
    error: mixed,
    errorInfo: {
      /** 恢复错误发生位置对应的组件栈。 */
      +componentStack?: ?string
    },
  ) => void,
  /** 启停默认 Transition 指示器；返回值在 Transition 结束时负责清理。 */
  onDefaultTransitionIndicator?: () => void | (() => void),
};

/** hydration 根选项；在普通根策略上增加边界回调与服务端表单状态。 */
export type HydrateRootOptions = {
  /** hydration 边界完成认领时调用。 */
  onHydrated?: (hydrationBoundary: Comment) => void,
  /** hydration 边界被删除时调用。 */
  onDeleted?: (hydrationBoundary: Comment) => void,
  /** 是否为此根启用严格模式检查。 */
  unstable_strictMode?: boolean,
  /** Transition tracing 的内部回调集合。 */
  unstable_transitionCallbacks?: TransitionTracingCallbacks,
  /** useId 等同构标识使用的根级前缀，需与服务端一致。 */
  identifierPrefix?: string,
  /** 接收未被错误边界捕获的根级错误。 */
  onUncaughtError?: (
    error: mixed,
    errorInfo: {
      /** 错误发生位置对应的组件栈。 */
      +componentStack?: ?string
    },
  ) => void,
  /** 接收被错误边界捕获的错误及边界信息。 */
  onCaughtError?: (
    error: mixed,
    errorInfo: {
      /** 错误发生位置对应的组件栈。 */
      +componentStack?: ?string,
      /** 实际捕获错误的边界组件类型。 */
      +errorBoundary?: ?component(...props: any),
    },
  ) => void,
  /** 接收 hydration/渲染中可恢复的错误。 */
  onRecoverableError?: (
    error: mixed,
    errorInfo: {
      /** 恢复错误发生位置对应的组件栈。 */
      +componentStack?: ?string
    },
  ) => void,
  /** 启停默认 Transition 指示器；返回值在 Transition 结束时负责清理。 */
  onDefaultTransitionIndicator?: () => void | (() => void),
  /** 服务端编码的表单 Action 状态，用于 hydration 时恢复客户端状态。 */
  formState?: ReactFormState<any, any> | null,
};

import {
  isContainerMarkedAsRoot,
  markContainerAsRoot,
  unmarkContainerAsRoot,
} from 'react-dom-bindings/src/client/ReactDOMComponentTree';
import {listenToAllSupportedEvents} from 'react-dom-bindings/src/events/DOMPluginEventSystem';
import {COMMENT_NODE} from 'react-dom-bindings/src/client/HTMLNodeType';

import {
  createContainer,
  createHydrationContainer,
  updateContainer,
  updateContainerSync,
  flushSyncWork,
  isAlreadyRendering,
  defaultOnUncaughtError,
  defaultOnCaughtError,
  defaultOnRecoverableError,
} from 'react-reconciler/src/ReactFiberReconciler';
import {defaultOnDefaultTransitionIndicator} from './ReactDOMDefaultTransitionIndicator';
import {ConcurrentRoot} from 'react-reconciler/src/ReactRootTags';

// $FlowFixMe[missing-this-annot]
/** 构造公开普通根句柄，并保存其唯一的 FiberRoot 所有权。 */
function ReactDOMRoot(internalRoot: FiberRoot) {
  this._internalRoot = internalRoot;
}

// $FlowFixMe[prop-missing] found when upgrading Flow
ReactDOMHydrationRoot.prototype.render = ReactDOMRoot.prototype.render =
  // $FlowFixMe[missing-this-annot]
  /**
   * 将下一棵 React 子树排入当前根。
   * 卸载先把 `_internalRoot` 置空，因此这里用空值检查阻止已释放句柄复用。
   */
  function (children: ReactNodeList): void {
    const root = this._internalRoot;
    if (root === null) {
      throw new Error('Cannot update an unmounted root.');
    }

    if (__DEV__) {
      // 显式读取 `arguments` 会退出影响函数 arity 的 GCC 优化，故只在开发诊断路径使用。
      const args = arguments;
      if (typeof args[1] === 'function') {
        console.error(
          'does not support the second callback argument. ' +
            'To execute a side effect after rendering, declare it in a component body with useEffect().',
        );
      } else if (isValidContainer(args[1])) {
        console.error(
          'You passed a container to the second argument of root.render(...). ' +
            "You don't need to pass it again since you already passed it to create the root.",
        );
      } else if (typeof args[1] !== 'undefined') {
        console.error(
          'You passed a second argument to root.render(...) but it only accepts ' +
            'one argument.',
        );
      }
    }
    updateContainer(children, root, null, null);
  };

// $FlowFixMe[prop-missing] found when upgrading Flow
ReactDOMHydrationRoot.prototype.unmount = ReactDOMRoot.prototype.unmount =
  // $FlowFixMe[missing-this-annot]
  /**
   * 同步提交空子树、冲刷待处理工作并释放容器根标记。
   * 先清空句柄再进入 reconciler，避免重入路径把已开始销毁的根当成可用状态。
   */
  function (): void {
    if (__DEV__) {
      // 显式读取 `arguments` 会退出影响函数 arity 的 GCC 优化，故只在开发诊断路径使用。
      const args = arguments;
      if (typeof args[0] === 'function') {
        console.error(
          'does not support a callback argument. ' +
            'To execute a side effect after rendering, declare it in a component body with useEffect().',
        );
      }
    }
    const root = this._internalRoot;
    if (root !== null) {
      this._internalRoot = null;
      const container = root.containerInfo;
      if (__DEV__) {
        if (isAlreadyRendering()) {
          console.error(
            'Attempted to synchronously unmount a root while React was already ' +
              'rendering. React cannot finish unmounting the root until the ' +
              'current render has completed, which may lead to a race condition.',
          );
        }
      }
      updateContainerSync(null, root, null, null);
      flushSyncWork();
      unmarkContainerAsRoot(container);
    }
  };

/**
 * 在 DOM 容器上创建一个新的并发根。
 *
 * 调用链为：校验容器 → 归一化根选项 → reconciler `createContainer` → 标记容器
 * → 在实际事件容器上安装委托监听器 → 返回句柄。此函数只创建根；首次子树由
 * `root.render` 排入，和 hydration 的“创建即携带初始子树”不同。
 */
export function createRoot(
  container: Element | Document | DocumentFragment,
  options?: CreateRootOptions,
): RootType {
  if (!isValidContainer(container)) {
    throw new Error('Target container is not a DOM element.');
  }

  warnIfReactDOMContainerInDEV(container);

  const concurrentUpdatesByDefaultOverride = false;
  let isStrictMode = false;
  let identifierPrefix = '';
  let onUncaughtError = defaultOnUncaughtError;
  let onCaughtError = defaultOnCaughtError;
  let onRecoverableError = defaultOnRecoverableError;
  let onDefaultTransitionIndicator = defaultOnDefaultTransitionIndicator;
  let transitionCallbacks = null;

  // $FlowFixMe[invalid-compare]
  if (options !== null && options !== undefined) {
    if (__DEV__) {
      if ((options as any).hydrate) {
        console.warn(
          'hydrate through createRoot is deprecated. Use ReactDOMClient.hydrateRoot(container, <App />) instead.',
        );
      } else {
        if (
          typeof options === 'object' &&
          // $FlowFixMe[invalid-compare]
          options !== null &&
          (options as any).$$typeof === REACT_ELEMENT_TYPE
        ) {
          console.error(
            'You passed a JSX element to createRoot. You probably meant to ' +
              'call root.render instead. ' +
              'Example usage:\n\n' +
              '  let root = createRoot(domContainer);\n' +
              '  root.render(<App />);',
          );
        }
      }
    }
    if (options.unstable_strictMode === true) {
      isStrictMode = true;
    }
    if (options.identifierPrefix !== undefined) {
      identifierPrefix = options.identifierPrefix;
    }
    if (options.onUncaughtError !== undefined) {
      onUncaughtError = options.onUncaughtError;
    }
    if (options.onCaughtError !== undefined) {
      onCaughtError = options.onCaughtError;
    }
    if (options.onRecoverableError !== undefined) {
      onRecoverableError = options.onRecoverableError;
    }
    if (enableDefaultTransitionIndicator) {
      if (options.onDefaultTransitionIndicator !== undefined) {
        onDefaultTransitionIndicator = options.onDefaultTransitionIndicator;
      }
    }
    if (options.unstable_transitionCallbacks !== undefined) {
      transitionCallbacks = options.unstable_transitionCallbacks;
    }
  }

  const root = createContainer(
    container,
    ConcurrentRoot,
    null,
    isStrictMode,
    concurrentUpdatesByDefaultOverride,
    identifierPrefix,
    onUncaughtError,
    onCaughtError,
    onRecoverableError,
    onDefaultTransitionIndicator,
    transitionCallbacks,
  );
  markContainerAsRoot(root.current, container);

  // 注释节点兼容模式把 Fiber 根挂在注释上，但事件必须委托到可接收事件的父节点。
  const rootContainerElement: Document | Element | DocumentFragment =
    !disableCommentsAsDOMContainers && container.nodeType === COMMENT_NODE
      ? (container.parentNode as any)
      : container;
  listenToAllSupportedEvents(rootContainerElement);

  // $FlowFixMe[invalid-constructor] Flow no longer supports calling new on functions
  return new ReactDOMRoot(root);
}

// $FlowFixMe[missing-this-annot]
/** 构造 hydration 根句柄；其 render/unmount 与普通根共享原型实现。 */
function ReactDOMHydrationRoot(internalRoot: FiberRoot) {
  this._internalRoot = internalRoot;
}
/** 把指定 DOM 节点登记为显式 hydration 目标，以提高其事件重放优先级。 */
function scheduleHydration(target: Node) {
  if (target) {
    queueExplicitHydrationTarget(target);
  }
}
// $FlowFixMe[prop-missing] found when upgrading Flow
ReactDOMHydrationRoot.prototype.unstable_scheduleHydration = scheduleHydration;

/**
 * 在带有服务端标记的 DOM 容器上创建并启动并发 hydration 根。
 *
 * 与 `createRoot` 不同，初始子树、hydration 回调与可选表单状态在
 * `createHydrationContainer` 时一次性交给 reconciler，使既有 DOM 能被认领而非清空重建；
 * 随后才标记容器并安装事件委托，以支持被阻塞事件的选择性 hydration 与重放。
 */
export function hydrateRoot(
  container: Document | Element,
  initialChildren: ReactNodeList,
  options?: HydrateRootOptions,
): RootType {
  if (!isValidContainer(container)) {
    throw new Error('Target container is not a DOM element.');
  }

  warnIfReactDOMContainerInDEV(container);

  if (__DEV__) {
    if (initialChildren === undefined) {
      console.error(
        'Must provide initial children as second argument to hydrateRoot. ' +
          'Example usage: hydrateRoot(domContainer, <App />)',
      );
    }
  }

  // hydration 回调与通用根选项同处一个对象，当前直接把整包选项交给 reconciler。
  const hydrationCallbacks = options != null ? options : null;

  const concurrentUpdatesByDefaultOverride = false;
  let isStrictMode = false;
  let identifierPrefix = '';
  let onUncaughtError = defaultOnUncaughtError;
  let onCaughtError = defaultOnCaughtError;
  let onRecoverableError = defaultOnRecoverableError;
  let onDefaultTransitionIndicator = defaultOnDefaultTransitionIndicator;
  let transitionCallbacks = null;
  let formState = null;
  // $FlowFixMe[invalid-compare]
  if (options !== null && options !== undefined) {
    if (options.unstable_strictMode === true) {
      isStrictMode = true;
    }
    if (options.identifierPrefix !== undefined) {
      identifierPrefix = options.identifierPrefix;
    }
    if (options.onUncaughtError !== undefined) {
      onUncaughtError = options.onUncaughtError;
    }
    if (options.onCaughtError !== undefined) {
      onCaughtError = options.onCaughtError;
    }
    if (options.onRecoverableError !== undefined) {
      onRecoverableError = options.onRecoverableError;
    }
    if (enableDefaultTransitionIndicator) {
      if (options.onDefaultTransitionIndicator !== undefined) {
        onDefaultTransitionIndicator = options.onDefaultTransitionIndicator;
      }
    }
    if (options.unstable_transitionCallbacks !== undefined) {
      transitionCallbacks = options.unstable_transitionCallbacks;
    }
    if (options.formState !== undefined) {
      formState = options.formState;
    }
  }

  const root = createHydrationContainer(
    initialChildren,
    null,
    container,
    ConcurrentRoot,
    hydrationCallbacks,
    isStrictMode,
    concurrentUpdatesByDefaultOverride,
    identifierPrefix,
    onUncaughtError,
    onCaughtError,
    onRecoverableError,
    onDefaultTransitionIndicator,
    transitionCallbacks,
    formState,
  );
  markContainerAsRoot(root.current, container);
  // hydration 本就不支持注释节点容器，因此事件可以直接委托到传入容器。
  listenToAllSupportedEvents(container);

  // $FlowFixMe[invalid-constructor] Flow no longer supports calling new on functions
  return new ReactDOMHydrationRoot(root);
}

/**
 * 在开发环境诊断同一容器混用 legacy root 或重复创建并发根。
 * 生产环境依靠容器标记维持行为，不承担额外警告成本。
 */
function warnIfReactDOMContainerInDEV(container: any) {
  if (__DEV__) {
    if (isContainerMarkedAsRoot(container)) {
      if (container._reactRootContainer) {
        console.error(
          'You are calling ReactDOMClient.createRoot() on a container that was previously ' +
            'passed to ReactDOM.render(). This is not supported.',
        );
      } else {
        console.error(
          'You are calling ReactDOMClient.createRoot() on a container that ' +
            'has already been passed to createRoot() before. Instead, call ' +
            'root.render() on the existing root instead if you want to update it.',
        );
      }
    }
  }
}
