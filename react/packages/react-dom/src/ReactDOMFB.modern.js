/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 现代 WWW 入口只组合 FB 客户端 API，不附加经典构建仍依赖的事件 emitter 兼容字段。
export {default as __DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE} from './ReactDOMSharedInternalsFB';

export {
  browser,
  createPortal,
  flushSync,
  unstable_batchedUpdates,
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

export {createRoot, hydrateRoot} from './client/ReactDOMRootFB';
