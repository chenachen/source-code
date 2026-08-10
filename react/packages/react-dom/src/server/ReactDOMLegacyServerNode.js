/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactNodeList} from 'shared/ReactTypes';

import {version, renderToStringImpl} from './ReactDOMLegacyServerImpl';

/** Node legacy 同步服务端入口接受的最小选项。 */
type ServerOptions = {
  /** 为 useId 等同构标识添加前缀，避免多个根冲突。 */
  identifierPrefix?: string,
};

/**
 * 同步生成带 hydration 标记的 HTML 字符串。
 * 这是 Node 环境的 legacy 适配器；完整 Fizz 状态机位于范围外的 `react-server`。
 */
function renderToString(
  children: ReactNodeList,
  options?: ServerOptions,
): string {
  return renderToStringImpl(
    children,
    options,
    false,
    'The server used "renderToString" which does not support Suspense. If you intended for this Suspense boundary to render the fallback content on the server consider throwing an Error somewhere within the Suspense boundary. If you intended to have the server wait for the suspended component please switch to "renderToPipeableStream" which supports Suspense on the server',
  );
}

/** 同步生成不可 hydration 的静态 HTML 字符串，并拒绝等待 Suspense。 */
function renderToStaticMarkup(
  children: ReactNodeList,
  options?: ServerOptions,
): string {
  return renderToStringImpl(
    children,
    options,
    true,
    'The server used "renderToStaticMarkup" which does not support Suspense. If you intended to have the server wait for the suspended component please switch to "renderToPipeableStream" which supports Suspense on the server',
  );
}

export {renderToString, renderToStaticMarkup, version};
