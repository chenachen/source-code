/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactRecoverable} from 'shared/ReactTypes';

import {enableBrowserAPI} from 'shared/ReactFeatureFlags';
import {REACT_RECOVERABLE_TYPE} from 'shared/ReactSymbols';

/**
 * 创建带 React 品牌的可恢复 Error，表示该子树要求浏览器专用渲染。
 * 使用 Error 可保留 `browser()` 调用点；若下游 renderer 都无法恢复，可把它作为最终原因。
 */
const browserImpl = /** 创建可恢复 Error并保留 browser 函数名，让错误栈指向请求浏览器渲染的位置。 */ function browser(): ReactRecoverable {
  // Recoverable 使用 Error，使下游 renderer 都无法恢复子树时，仍可把 browser() 调用点保留为 cause。
  const recoverable = new Error(
    'Browser-only rendering was requested by `browser()`.',
  );
  Object.defineProperty(recoverable as any, '$$typeof', {
    value: REACT_RECOVERABLE_TYPE,
  });
  return recoverable as any;
};

/** 特性开启时公开 browser-only 边界构造器，否则保持 `undefined`。 */
export const browser: (() => ReactRecoverable) | void = enableBrowserAPI
  ? browserImpl
  : undefined;
