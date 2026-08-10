/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactNodeList} from 'shared/ReactTypes';

import {disableLegacyMode} from 'shared/ReactFeatureFlags';
import {isValidContainer} from 'react-dom-bindings/src/client/ReactDOMContainer';
import {createEventHandle} from 'react-dom-bindings/src/client/ReactDOMEventHandle';
import {runWithPriority} from 'react-dom-bindings/src/client/ReactDOMUpdatePriority';
import {flushSync as flushSyncIsomorphic} from '../shared/ReactDOMFlushSync';

import {
  flushSyncFromReconciler as flushSyncWithoutWarningIfAlreadyRendering,
  isAlreadyRendering,
  injectIntoDevTools,
  findHostInstance,
} from 'react-reconciler/src/ReactFiberReconciler';
import {createPortal as createPortalImpl} from 'react-reconciler/src/ReactPortal';
import {canUseDOM} from 'shared/ExecutionEnvironment';
import ReactVersion from 'shared/ReactVersion';

import {ensureCorrectIsomorphicReactVersion} from '../shared/ensureCorrectIsomorphicReactVersion';
ensureCorrectIsomorphicReactVersion();

import {browser} from '../shared/ReactDOMBrowser';
import {
  getInstanceFromNode,
  getNodeFromInstance,
  getFiberCurrentPropsFromNode,
} from 'react-dom-bindings/src/client/ReactDOMComponentTree';
import {
  enqueueStateRestore,
  restoreStateIfNeeded,
} from 'react-dom-bindings/src/events/ReactDOMControlledComponent';
import Internals from '../ReactDOMSharedInternalsFB';

export {
  prefetchDNS,
  preconnect,
  preload,
  preloadModule,
  preinit,
  preinitModule,
} from '../shared/ReactDOMFloat';
export {
  useFormStatus,
  useFormState,
  requestFormReset,
} from 'react-dom-bindings/src/shared/ReactDOMFormActions';

if (__DEV__) {
  if (
    typeof Map !== 'function' ||
    // $FlowFixMe[prop-missing] Flow incorrectly thinks Map has no prototype
    Map.prototype == null ||
    typeof Map.prototype.forEach !== 'function' ||
    typeof Set !== 'function' ||
    // $FlowFixMe[prop-missing] Flow incorrectly thinks Set has no prototype
    Set.prototype == null ||
    typeof Set.prototype.clear !== 'function' ||
    typeof Set.prototype.forEach !== 'function'
  ) {
    console.error(
      'React depends on Map and Set built-in types. Make sure that you load a ' +
        'polyfill in older browsers. https://react.dev/link/react-polyfills',
    );
  }
}

/**
 * 校验 DOM 容器并创建一个由 reconciler 追踪的 Portal 描述对象。
 *
 * Portal 的协调与提交仍由 reconciler/DOM bindings 完成；这里是 FB 构建公开 API
 * 的参数边界，拒绝不能作为宿主容器的目标。
 */
function createPortal(
  children: ReactNodeList,
  container: Element | DocumentFragment,
  key: ?string = null,
): React$Portal {
  if (!isValidContainer(container)) {
    throw new Error('Target container is not a DOM element.');
  }

  // TODO：未来把 ReactDOM Portal 实现作为第三个参数传入；当前宿主实现参数为空。
  // $FlowFixMe[incompatible-type] The Flow type is opaque but there's no way to actually create it.
  return createPortalImpl(children, container, null, key);
}

// 通过重载把定义限制为两个合法签名；注意，这会退出对函数体的类型检查。
/** 同步执行回调并立即冲刷其更新。 */
declare function flushSyncFromReconciler<R>(fn: () => R): R;
/** 在没有回调时冲刷已经排队的同步工作。 */
declare function flushSyncFromReconciler(): void;
/**
 * FB 兼容入口使用的同步冲刷包装器。
 *
 * 两个重载描述公开调用形态；实现统一转交 reconciler，并在开发环境阻止调用者
 * 把“渲染中再次冲刷”误认为受支持的重入路径。
 */
function flushSyncFromReconciler<R>(fn: (() => R) | void): R | void {
  if (__DEV__) {
    if (isAlreadyRendering()) {
      console.error(
        'flushSync was called from inside a lifecycle method. React cannot ' +
          'flush when React is already rendering. Consider moving this call to ' +
          'a scheduler task or micro task.',
      );
    }
  }
  // $FlowFixMe[incompatible-type]
  return flushSyncWithoutWarningIfAlreadyRendering(fn);
}

/** 根据构建是否保留 legacy mode，选择同构实现或兼容警告实现。 */
const flushSync: typeof flushSyncIsomorphic = disableLegacyMode
  ? flushSyncIsomorphic
  : flushSyncFromReconciler;

/** 把组件实例映射到其当前宿主 DOM 节点，供旧版 FB API 与 internals 使用。 */
function findDOMNode(
  componentOrElement: component(...props: any),
): null | Element | Text {
  return findHostInstance(componentOrElement);
}

// 通过共享槽位发布实现，使测试与兼容入口不必形成循环依赖。
Internals.findDOMNode = findDOMNode;

/**
 * 保留 React 19 之前的批处理 API 形状，但直接执行回调。
 *
 * legacy mode 之外该 API 原本就不提供额外语义；保留符号只为尚未迁移的库避免
 * 导入失败，真正的更新优先级仍由 reconciler 管理。
 */
function unstable_batchedUpdates<A, R>(fn: (a: A) => R, a: A): R {
  // React 19 已把 legacy mode 之外的 batchedUpdates 明确降为直通调用；暂留导出兼容旧库。
  return fn(a);
}

export {
  browser,
  createPortal,
  unstable_batchedUpdates,
  flushSync,
  ReactVersion as version,
  // 此导出受 enableCreateEventHandleAPI 特性开关控制。
  createEventHandle as unstable_createEventHandle,
  // TODO：调用方迁移到替代方案后删除；该能力只允许 React 内部使用。
  runWithPriority as unstable_runWithPriority,
};

// 必须与 ReactTestUtils.js 保持同序；使用数组是为了获得更好的压缩结果。
Internals.Events /* Events */ = [
  getInstanceFromNode,
  getNodeFromInstance,
  getFiberCurrentPropsFromNode,
  enqueueStateRestore,
  restoreStateIfNeeded,
  unstable_batchedUpdates,
];

/** DevTools 注入是否成功；仅用于决定开发环境是否提示安装扩展。 */
const foundDevTools = injectIntoDevTools();

if (__DEV__) {
  if (!foundDevTools && canUseDOM && window.top === window.self) {
    // 只在常见且支持扩展的 Chrome/Firefox 顶层页面提示下载，避免 iframe 重复提示。
    if (
      (navigator.userAgent.indexOf('Chrome') > -1 &&
        navigator.userAgent.indexOf('Edge') === -1) ||
      navigator.userAgent.indexOf('Firefox') > -1
    ) {
      const protocol = window.location.protocol;
      // chrome-extension:// 等特殊协议不适用普通下载提示，因此保持静默。
      if (/^(https?|file):$/.test(protocol)) {
        // eslint-disable-next-line react-internal/no-production-logging
        console.info(
          '%cDownload the React DevTools ' +
            'for a better development experience: ' +
            'https://react.dev/link/react-devtools' +
            (protocol === 'file:'
              ? '\nYou might need to use a local HTTP server (instead of file://): ' +
                'https://react.dev/link/react-devtools-faq'
              : ''),
          'font-weight:bold',
        );
      }
    }
  }
}
