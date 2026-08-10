/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactNodeList} from 'shared/ReactTypes';

import ReactVersion from 'shared/ReactVersion';

import {isValidContainer} from 'react-dom-bindings/src/client/ReactDOMContainer';
import {createPortal as createPortalImpl} from 'react-reconciler/src/ReactPortal';
import {flushSync} from './ReactDOMFlushSync';

import {
  prefetchDNS,
  preconnect,
  preload,
  preloadModule,
  preinit,
  preinitModule,
} from './ReactDOMFloat';
import {
  requestFormReset,
  useFormStatus,
  useFormState,
} from 'react-dom-bindings/src/shared/ReactDOMFormActions';
import {browser} from './ReactDOMBrowser';

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
        'polyfill in older browsers. https://reactjs.org/link/react-polyfills',
    );
  }
}

/**
 * 保留旧 `unstable_batchedUpdates` 调用形状的透传兼容层。
 * 现代 renderer 已在事件边界自动批处理，因此此入口不再建立额外批次。
 */
function batchedUpdates<A, R>(fn: (a: A) => R, a: A): R {
  // 直接调用并保留返回值/异常语义。
  return fn(a);
}

/**
 * 校验目标容器后创建 DOM Portal 描述符，交由 reconciler 在独立宿主容器提交 children。
 *
 * @param children Portal 子树。
 * @param container 接收宿主节点的 Element 或 DocumentFragment。
 * @param key Portal 在同级集合中的可选身份。
 */
function createPortal(
  children: ReactNodeList,
  container: Element | DocumentFragment,
  key: ?string = null,
): React$Portal {
  if (!isValidContainer(container)) {
    throw new Error('Target container is not a DOM element.');
  }

  // TODO：未来把 ReactDOM portal 实现作为第三参数传入；当前实现槽保持 `null`。
  // $FlowFixMe[incompatible-type] The Flow type is opaque but there's no way to actually create it.
  return createPortalImpl(children, container, null, key);
}

export {
  ReactVersion as version,
  browser,
  createPortal,
  flushSync,
  batchedUpdates as unstable_batchedUpdates,
  prefetchDNS,
  preconnect,
  preload,
  preloadModule,
  preinit,
  preinitModule,
  requestFormReset,
  useFormStatus,
  useFormState,
};
