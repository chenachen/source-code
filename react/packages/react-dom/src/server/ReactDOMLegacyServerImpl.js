/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import ReactVersion from 'shared/ReactVersion';

import type {ReactNodeList} from 'shared/ReactTypes';

import {
  createRequest,
  startWork,
  startFlowing,
  abort,
} from 'react-server/src/ReactFizzServer';

import {
  createResumableState,
  createRenderState,
  createRootFormatContext,
} from 'react-dom-bindings/src/server/ReactFizzConfigDOMLegacy';

/** legacy 字符串渲染器使用的根级选项。 */
type ServerOptions = {
  /** 为 useId 等同构标识添加前缀，避免多个根冲突。 */
  identifierPrefix?: string,
};

/** legacy API 忽略非致命错误；致命错误由 destination.destroy 单独记录。 */
function onError() {
  // legacy 同步返回值没有增量错误通道，因此非致命错误保持静默。
}

/**
 * 用 Fizz 核心请求同步收集 HTML，再适配成旧版字符串返回值。
 *
 * 该文件只组装 DOM legacy 配置与 `react-server` 的完整 Fizz 引擎：启动请求后立即
 * abort 尚未完成的 Suspense 边界，使这些未完成边界从首次输出就标为客户端恢复；已完成内容仍输出。destination
 * 同步拼接 chunk，并把 fatal 与“预期 abort 原因”区分后再返回字符串。
 * generateStaticMarkup选择静态DOM编码，identifierPrefix供同构id；abortReason为legacy入口
 * 的悬挂说明。didFatal单独记录异常是否发生，确保null/undefined等抛值也能向调用方传播。
 */
function renderToStringImpl(
  children: ReactNodeList,
  options: void | ServerOptions,
  generateStaticMarkup: boolean,
  abortReason: string,
): string {
  let didFatal = false;
  let fatalError = null;
  let result = '';
  const destination = {
    // $FlowFixMe[missing-local-annot]
    /** 收集 Fizz 写出的非空 chunk；返回 true 表示没有背压。 */
    push(chunk) {
      if (chunk !== null) {
        result += chunk;
      }
      return true;
    },
    // $FlowFixMe[missing-local-annot]
    /** 记录致命流错误，待同步流程结束后由外层抛出。 */
    destroy(error) {
      didFatal = true;
      fatalError = error;
    },
  };

  let readyToStream = false;
  /** 标记至少已产生可写 shell，用于识别同步输入期间悬挂的异常路径。 */
  function onShellReady() {
    readyToStream = true;
  }
  const resumableState = createResumableState(
    options ? options.identifierPrefix : undefined,
    undefined,
  );
  const request = createRequest(
    children,
    resumableState,
    createRenderState(resumableState, generateStaticMarkup),
    createRootFormatContext(),
    Infinity,
    onError,
    undefined,
    undefined,
    onShellReady,
    undefined,
    undefined,
    undefined,
  );
  startWork(request);
  // 写出前中止所有仍挂起的内容，使这些边界从第一字节起就明确交由客户端渲染。
  abort(request, abortReason);
  startFlowing(request, destination);
  if (didFatal && fatalError !== abortReason) {
    throw fatalError;
  }

  if (!readyToStream) {
    // 这里沿用客户端错误文案，语境并不完全匹配；这是计划移除的 legacy 服务端兼容路径。
    throw new Error(
      'A component suspended while responding to synchronous input. This ' +
        'will cause the UI to be replaced with a loading indicator. To fix, ' +
        'updates that suspend should be wrapped with startTransition.',
    );
  }

  return result;
}

export {renderToStringImpl, ReactVersion as version};
