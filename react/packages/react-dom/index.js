/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// 默认入口暴露跨 renderer 协作槽及浏览器公共 API；根创建能力刻意位于 `/client` 子路径。
export {default as __DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE} from './src/ReactDOMSharedInternals';
export {
  browser,
  createPortal,
  flushSync,
  prefetchDNS,
  preconnect,
  preload,
  preloadModule,
  preinit,
  preinitModule,
  requestFormReset,
  unstable_batchedUpdates,
  useFormState,
  useFormStatus,
  version,
} from './src/shared/ReactDOM';
