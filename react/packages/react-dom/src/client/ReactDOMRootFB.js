/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactNodeList} from 'shared/ReactTypes';

import type {
  RootType,
  CreateRootOptions,
  HydrateRootOptions,
} from './ReactDOMRoot';

import type {FiberRoot} from 'react-reconciler/src/ReactInternalTypes';

import type {
  Container,
  PublicInstance,
} from 'react-dom-bindings/src/client/ReactFiberConfigDOM';

import {
  createRoot as createRootImpl,
  hydrateRoot as hydrateRootImpl,
} from './ReactDOMRoot';

import {
  disableLegacyMode,
  disableCommentsAsDOMContainers,
} from 'shared/ReactFeatureFlags';
import {clearContainer} from 'react-dom-bindings/src/client/ReactFiberConfigDOM';
import {
  getInstanceFromNode,
  isContainerMarkedAsRoot,
  markContainerAsRoot,
  unmarkContainerAsRoot,
} from 'react-dom-bindings/src/client/ReactDOMComponentTree';
import {listenToAllSupportedEvents} from 'react-dom-bindings/src/events/DOMPluginEventSystem';
import {isValidContainer} from 'react-dom-bindings/src/client/ReactDOMContainer';
import {
  DOCUMENT_NODE,
  ELEMENT_NODE,
  COMMENT_NODE,
} from 'react-dom-bindings/src/client/HTMLNodeType';

import {
  batchedUpdates,
  createContainer,
  createHydrationContainer,
  findHostInstanceWithNoPortals,
  updateContainer,
  updateContainerSync,
  flushSyncWork,
  getPublicRootInstance,
  findHostInstance,
  findHostInstanceWithWarning,
  defaultOnUncaughtError,
  defaultOnCaughtError,
} from 'react-reconciler/src/ReactFiberReconciler';
import {LegacyRoot} from 'react-reconciler/src/ReactRootTags';
import getComponentNameFromType from 'shared/getComponentNameFromType';

import {
  current as currentOwner,
  isRendering,
} from 'react-reconciler/src/ReactCurrentFiber';

import assign from 'shared/assign';

import noop from 'shared/noop';

/** WWW 运行时注入的错误对话框桥接器，用于接管默认控制台上报。 */
const ReactFiberErrorDialogWWW = require('ReactFiberErrorDialog');

if (typeof ReactFiberErrorDialogWWW.showErrorDialog !== 'function') {
  throw new Error(
    'Expected ReactFiberErrorDialog.showErrorDialog to be a function.',
  );
}

/**
 * 把未捕获错误先交给 WWW 对话框，并在其未明确拦截时回退到 React 默认上报。
 * 该返回协议让宿主可以抑制重复的 console.error/redbox。
 */
function wwwOnUncaughtError(
  error: mixed,
  errorInfo: {
    /** 错误发生位置对应的组件栈。 */
    +componentStack?: ?string
  },
): void {
  const componentStack =
    errorInfo.componentStack != null ? errorInfo.componentStack : '';
  const logError = ReactFiberErrorDialogWWW.showErrorDialog({
    errorBoundary: null,
    error,
    componentStack,
  });

  // 注入实现返回 false 时已自行处理错误；跳过默认日志可避免 WWW/React Native redbox 重复显示。
  if (logError === false) {
    return;
  }

  defaultOnUncaughtError(error, errorInfo);
}

/** 把已被错误边界捕获的错误及边界实例交给 WWW，并保留默认回退上报。 */
function wwwOnCaughtError(
  error: mixed,
  errorInfo: {
    /** 错误发生位置对应的组件栈。 */
    +componentStack?: ?string,
    /** 实际捕获错误的边界组件实例。 */
    +errorBoundary?: ?component(),
  },
): void {
  const errorBoundary = errorInfo.errorBoundary;
  const componentStack =
    errorInfo.componentStack != null ? errorInfo.componentStack : '';
  const logError = ReactFiberErrorDialogWWW.showErrorDialog({
    errorBoundary,
    error,
    componentStack,
  });

  // 注入实现返回 false 时已自行处理错误；跳过默认日志可避免 WWW/React Native redbox 重复显示。
  if (logError === false) {
    return;
  }

  defaultOnCaughtError(error, errorInfo);
}
/** WWW 不启用浏览器默认 Transition 指示器，因此提供稳定的空实现。 */
const noopOnDefaultTransitionIndicator = noop;

/** 用 WWW 错误处理与空 Transition 指示器包装通用并发根创建。 */
export function createRoot(
  container: Element | Document | DocumentFragment,
  options?: CreateRootOptions,
): RootType {
  return createRootImpl(
    container,
    assign(
      {
        onUncaughtError: wwwOnUncaughtError,
        onCaughtError: wwwOnCaughtError,
        onDefaultTransitionIndicator: noopOnDefaultTransitionIndicator,
      } as any,
      options,
    ),
  );
}

/** 用 WWW 错误处理与空 Transition 指示器包装通用 hydration 根创建。 */
export function hydrateRoot(
  container: Document | Element,
  initialChildren: ReactNodeList,
  options?: HydrateRootOptions,
): RootType {
  return hydrateRootImpl(
    container,
    initialChildren,
    assign(
      {
        onUncaughtError: wwwOnUncaughtError,
        onCaughtError: wwwOnCaughtError,
        onDefaultTransitionIndicator: noopOnDefaultTransitionIndicator,
      } as any,
      options,
    ),
  );
}

/** 开发环境 legacy 顶层更新诊断器；生产构建不会初始化或调用它。 */
let topLevelUpdateWarnings;

if (__DEV__) {
  /** 检查 legacy 容器内容是否被外部移走，或传入节点是否已经持有另一棵 React 树的内部宿主节点。 */
  topLevelUpdateWarnings = (container: Container) => {
    if (container._reactRootContainer && container.nodeType !== COMMENT_NODE) {
      const hostInstance = findHostInstanceWithNoPortals(
        container._reactRootContainer.current,
      );
      if (hostInstance) {
        if (hostInstance.parentNode !== container) {
          console.error(
            'It looks like the React-rendered content of this ' +
              'container was removed without using React. This is not ' +
              'supported and will cause errors. Instead, call ' +
              'ReactDOM.unmountComponentAtNode to empty a container.',
          );
        }
      }
    }

    const isRootRenderedBySomeReact = !!container._reactRootContainer;
    const rootEl = getReactRootElementInContainer(container);
    const hasNonRootReactChild = !!(rootEl && getInstanceFromNode(rootEl));

    if (hasNonRootReactChild && !isRootRenderedBySomeReact) {
      console.error(
        'Replacing React-rendered children with a new root ' +
          'component. If you intended to update the children of this node, ' +
          'you should instead have the existing children update their state ' +
          'and render the new components instead of calling ReactDOM.render.',
      );
    }
  };
}

/** 返回 legacy 容器用于判断 React 所有权的首个根元素。 */
function getReactRootElementInContainer(container: any) {
  if (!container) {
    return null;
  }

  if (container.nodeType === DOCUMENT_NODE) {
    return container.documentElement;
  } else {
    return container.firstChild;
  }
}

/** legacy API 不会触发 recoverable error 回调，使用空实现满足 reconciler 协议。 */
const noopOnRecoverableError = noop;

/**
 * 首次 legacy render/hydrate 时创建并登记 LegacyRoot。
 *
 * hydration 分支保留既有 DOM 并创建 hydration 容器；普通分支先清空宿主内容，再创建
 * 容器并同步提交初始子树。两条路径都会包装回调的 `this`、标记容器并安装事件委托，
 * 防止 legacy 句柄与现代根的所有权状态脱节。
 */
function legacyCreateRootFromDOMContainer(
  container: Container,
  initialChildren: ReactNodeList,
  parentComponent: ?component(...props: any),
  callback: ?Function,
  isHydrationContainer: boolean,
): FiberRoot {
  if (isHydrationContainer) {
    if (typeof callback === 'function') {
      const originalCallback = callback;
      /** hydration 提交后读取公开根实例作为 this，原样调用用户 callback；root 在后续冲刷前已创建。 */
      callback = function () {
        const instance = getPublicRootInstance(root);
        originalCallback.call(instance);
      };
    }

    const root: FiberRoot = createHydrationContainer(
      initialChildren,
      callback,
      container,
      LegacyRoot,
      null, // legacy hydration 不提供边界回调。
      false, // legacy 根不启用严格模式。
      false, // legacy 根不覆盖并发更新默认策略。
      '', // legacy 根不设置标识前缀。
      wwwOnUncaughtError,
      wwwOnCaughtError,
      noopOnRecoverableError,
      noopOnDefaultTransitionIndicator,
      // TODO(luna)：未来为 legacy hydration 补充 Transition tracing 支持。
      null,
      null,
    );
    container._reactRootContainer = root;
    markContainerAsRoot(root.current, container);

    const rootContainerElement =
      !disableCommentsAsDOMContainers && container.nodeType === COMMENT_NODE
        ? container.parentNode
        : container;
    // $FlowFixMe[incompatible-type]
    listenToAllSupportedEvents(rootContainerElement);

    flushSyncWork();
    return root;
  } else {
    // 普通首次挂载必须先清空非 React 内容，建立唯一的宿主所有权起点。
    clearContainer(container);

    if (typeof callback === 'function') {
      const originalCallback = callback;
      /** 首次普通 legacy 提交后以公开根实例作为 this 调用用户 callback，而不是以容器作为 this。 */
      callback = function () {
        const instance = getPublicRootInstance(root);
        originalCallback.call(instance);
      };
    }

    const root = createContainer(
      container,
      LegacyRoot,
      null, // 普通 legacy 根没有 hydration 回调。
      false, // legacy 根不启用严格模式。
      false, // legacy 根不覆盖并发更新默认策略。
      '', // legacy 根不设置标识前缀。
      wwwOnUncaughtError,
      wwwOnCaughtError,
      noopOnRecoverableError,
      noopOnDefaultTransitionIndicator,
      null, // legacy 根不提供 Transition tracing 回调。
    );
    container._reactRootContainer = root;
    markContainerAsRoot(root.current, container);

    const rootContainerElement =
      !disableCommentsAsDOMContainers && container.nodeType === COMMENT_NODE
        ? container.parentNode
        : container;
    // $FlowFixMe[incompatible-type]
    listenToAllSupportedEvents(rootContainerElement);

    // legacy 首次挂载不应被批处理。
    updateContainerSync(initialChildren, root, parentComponent, callback);
    flushSyncWork();

    return root;
  }
}

/** 在开发环境诊断 legacy API 末尾的非函数 callback。 */
function warnOnInvalidCallback(callback: mixed): void {
  if (__DEV__) {
    if (callback !== null && typeof callback !== 'function') {
      console.error(
        'Expected the last optional `callback` argument to be a ' +
          'function. Instead received: %s.',
        callback,
      );
    }
  }
}

/**
 * legacy render 的统一入口：首次调用创建 LegacyRoot，后续调用复用根并排入更新。
 * 回调会绑定到公开根实例，最终返回值也保持旧 API 的组件/宿主实例语义。
 */
function legacyRenderSubtreeIntoContainer(
  parentComponent: ?component(...props: any),
  children: ReactNodeList,
  container: Container,
  forceHydrate: boolean,
  callback: ?Function,
): component(...props: any) | PublicInstance | null {
  if (__DEV__) {
    topLevelUpdateWarnings(container);
    warnOnInvalidCallback(callback === undefined ? null : callback);
  }

  const maybeRoot = container._reactRootContainer;
  let root: FiberRoot;
  if (!maybeRoot) {
    // 首次挂载同时建立根、容器标记和事件委托。
    root = legacyCreateRootFromDOMContainer(
      container,
      children,
      parentComponent,
      callback,
      forceHydrate,
    );
  } else {
    root = maybeRoot;
    if (typeof callback === 'function') {
      const originalCallback = callback;
      /** 复用根更新的提交回调，每次从当前根读取公开实例，使 this 对应更新后的根输出。 */
      callback = function () {
        const instance = getPublicRootInstance(root);
        originalCallback.call(instance);
      };
    }
    // 更新路径复用现有根，避免重复清空容器或重新安装监听器。
    updateContainer(children, root, parentComponent, callback);
  }
  return getPublicRootInstance(root);
}

/**
 * 解析 legacy 组件实例对应的宿主节点，并在开发环境诊断 render 阶段读取旧提交数据。
 * 已经是 DOM Element 的输入直接返回；其他组件交给 reconciler 查找当前宿主实例。
 */
export function findDOMNode(
  componentOrElement: Element | ?component(...props: any),
): null | Element | Text {
  if (__DEV__) {
    const owner = currentOwner;
    if (owner !== null && isRendering && owner.stateNode !== null) {
      const warnedAboutRefsInRender = owner.stateNode._warnedAboutRefsInRender;
      if (!warnedAboutRefsInRender) {
        console.error(
          '%s is accessing findDOMNode inside its render(). ' +
            'render() should be a pure function of props and state. It should ' +
            'never access something that requires stale data from the previous ' +
            'render, such as refs. Move this logic to componentDidMount and ' +
            'componentDidUpdate instead.',
          getComponentNameFromType(owner.type) || 'A component',
        );
      }
      owner.stateNode._warnedAboutRefsInRender = true;
    }
  }
  if (componentOrElement == null) {
    return null;
  }
  if ((componentOrElement as any).nodeType === ELEMENT_NODE) {
    return componentOrElement as any;
  }
  if (__DEV__) {
    return findHostInstanceWithWarning(componentOrElement, 'findDOMNode');
  }
  return findHostInstance(componentOrElement);
}

/**
 * 兼容 ReactDOM.render：在启用 legacy mode 的构建中同步创建或更新 LegacyRoot。
 * 禁用 legacy mode 时明确抛错；若容器属于 createRoot，则开发环境提示 API 混用。
 */
export function render(
  element: React$Element<any>,
  container: Container,
  callback: ?Function,
): component(...props: any) | PublicInstance | null {
  if (disableLegacyMode) {
    if (__DEV__) {
      console.error(
        'ReactDOM.render was removed in React 19. Use createRoot instead.',
      );
    }
    throw new Error('ReactDOM: Unsupported Legacy Mode API.');
  }
  if (__DEV__) {
    console.error(
      'ReactDOM.render has not been supported since React 18. Use createRoot ' +
        'instead. Until you switch to the new API, your app will behave as ' +
        "if it's running React 17. Learn " +
        'more: https://react.dev/link/switch-to-createroot',
    );
  }

  if (!isValidContainer(container)) {
    throw new Error('Target container is not a DOM element.');
  }

  if (__DEV__) {
    const isModernRoot =
      isContainerMarkedAsRoot(container) &&
      container._reactRootContainer === undefined;
    if (isModernRoot) {
      console.error(
        'You are calling ReactDOM.render() on a container that was previously ' +
          'passed to ReactDOMClient.createRoot(). This is not supported. ' +
          'Did you mean to call root.render(element)?',
      );
    }
  }
  return legacyRenderSubtreeIntoContainer(
    null,
    // $FlowFixMe[incompatible-type]
    element,
    container,
    false,
    callback,
  );
}

/**
 * 兼容卸载 legacy 根，并返回传入容器是否确实持有可卸载根。
 * 成功路径同步提交空树、冲刷工作、清除 legacy 指针并解除根标记；现代根必须使用
 * `root.unmount()`，以免绕过其句柄状态机。
 */
export function unmountComponentAtNode(container: Container): boolean {
  if (disableLegacyMode) {
    if (__DEV__) {
      console.error(
        'unmountComponentAtNode was removed in React 19. Use root.unmount() instead.',
      );
    }
    throw new Error('ReactDOM: Unsupported Legacy Mode API.');
  }
  if (!isValidContainer(container)) {
    throw new Error('Target container is not a DOM element.');
  }

  if (__DEV__) {
    const isModernRoot =
      isContainerMarkedAsRoot(container) &&
      container._reactRootContainer === undefined;
    if (isModernRoot) {
      console.error(
        'You are calling ReactDOM.unmountComponentAtNode() on a container that was previously ' +
          'passed to ReactDOMClient.createRoot(). This is not supported. Did you mean to call root.unmount()?',
      );
    }
  }

  if (container._reactRootContainer) {
    const root = container._reactRootContainer;

    if (__DEV__) {
      const rootEl = getReactRootElementInContainer(container);
      const renderedByDifferentReact = rootEl && !getInstanceFromNode(rootEl);
      if (renderedByDifferentReact) {
        console.error(
          "unmountComponentAtNode(): The node you're attempting to unmount " +
            'was rendered by another copy of React.',
        );
      }
    }

    updateContainerSync(null, root, null, null);
    flushSyncWork();
    // $FlowFixMe[incompatible-type] This should probably use `delete container._reactRootContainer`
    container._reactRootContainer = null;
    unmarkContainerAsRoot(container);
    return true;
  } else {
    if (__DEV__) {
      const rootEl = getReactRootElementInContainer(container);
      const hasNonRootReactChild = !!(rootEl && getInstanceFromNode(rootEl));

      // 继续判断调用者是否误把 React 根元素本身当成了它的外层容器。
      const isContainerReactRoot =
        container.nodeType === ELEMENT_NODE &&
        isValidContainer(container.parentNode) &&
        // $FlowFixMe[prop-missing]
        // $FlowFixMe[incompatible-use]
        !!container.parentNode._reactRootContainer;

      if (hasNonRootReactChild) {
        console.error(
          "unmountComponentAtNode(): The node you're attempting to unmount " +
            'was rendered by React and is not a top-level container. %s',
          isContainerReactRoot
            ? 'You may have accidentally passed in a React root node instead ' +
                'of its container.'
            : 'Instead, have the parent component update its state and ' +
                'rerender in order to remove this component.',
        );
      }
    }

    return false;
  }
}

export {batchedUpdates as unstable_batchedUpdates};
