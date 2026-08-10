/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// RSC 模块只能访问资源提示、版本和共享内部槽；这里不提供客户端根或完整 Fizz renderer。

import ReactVersion from 'shared/ReactVersion';
export {ReactVersion as version};

export {default as __DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE} from './ReactDOMSharedInternals';
export {
  prefetchDNS,
  preconnect,
  preload,
  preloadModule,
  preinit,
  preinitModule,
} from './shared/ReactDOMFloat';
