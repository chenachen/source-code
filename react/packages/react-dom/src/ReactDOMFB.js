/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {isEnabled} from 'react-dom-bindings/src/events/ReactDOMEventListener';

import Internals from './ReactDOMSharedInternalsFB';

// 经典 WWW 构建仍有调用方依赖事件开关，因此把该兼容内部能力并入共享对象。
Object.assign(Internals as any, {
  ReactBrowserEventEmitter: {
    isEnabled,
  },
});

export {Internals as __DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE};

export {
  browser,
  createPortal,
  flushSync,
  unstable_createEventHandle,
  unstable_runWithPriority, // 请勿新增使用：仅为迁离 Scheduler.runWithPriority 暂时暴露。
  useFormStatus,
  useFormState,
  requestFormReset,
  prefetchDNS,
  preconnect,
  preload,
  preloadModule,
  preinit,
  preinitModule,
  version,
} from './client/ReactDOMClientFB';

export {
  createRoot,
  hydrateRoot,
  render,
  unstable_batchedUpdates,
  findDOMNode,
  unmountComponentAtNode,
} from './client/ReactDOMRootFB';
