/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactNodeList, ReactFormState} from 'shared/ReactTypes';
import type {
  BootstrapScriptDescriptor,
  HeadersDescriptor,
} from 'react-dom-bindings/src/server/ReactFizzConfigDOM';
import type {ImportMap} from '../shared/ReactDOMTypes';
import type {ErrorInfo} from 'react-server/src/ReactFizzServer';

import ReactVersion from 'shared/ReactVersion';

import {
  createRequest,
  startWork,
  startFlowing,
  stopFlowing,
  abort,
} from 'react-server/src/ReactFizzServer';

import {
  createResumableState,
  createRenderState,
  createRootFormatContext,
} from 'react-dom-bindings/src/server/ReactFizzConfigDOM';

import {ensureCorrectIsomorphicReactVersion} from '../shared/ensureCorrectIsomorphicReactVersion';
ensureCorrectIsomorphicReactVersion();

/** Bun 直连 ReadableStream 服务端渲染适配器的创建选项。 */
type Options = {
  /** 为 useId 等同构标识添加根级前缀。 */
  identifierPrefix?: string,
  /** 指定根节点使用的 HTML/SVG/MathML 命名空间。 */
  namespaceURI?: string,
  /** CSP nonce：字符串仅给脚本，对象可分别给script/style。 */
  nonce?:
    | string
    | {
        /** 输出到 script 标签的 CSP nonce。 */
        script?: string,
        /** 输出到 style/link 标签的 CSP nonce。 */
        style?: string,
      },
  /** 在 bootstrap 资源前内联写出的启动脚本。 */
  bootstrapScriptContent?: string,
  /** 需要生成传统 script 标签的启动资源。 */
  bootstrapScripts?: Array<string | BootstrapScriptDescriptor>,
  /** 需要生成 module script 标签的启动资源。 */
  bootstrapModules?: Array<string | BootstrapScriptDescriptor>,
  /** 决定已完成 Suspense 边界是否单独输出的字节阈值；不是流中每个 chunk 的固定大小。 */
  progressiveChunkSize?: number,
  /** 调用方用于取消服务端请求的信号。 */
  signal?: AbortSignal,
  /** 接收渲染错误，并可返回供错误摘要使用的字符串。 */
  onError?: (error: mixed, errorInfo: ErrorInfo) => ?string,
  /** 接收要求浏览器接管渲染的服务端退避错误。 */
  onBrowserBailout?: (error: mixed, errorInfo: ErrorInfo) => void,
  /** 实验性外部 DOM 指令 runtime 的资源地址或描述符。 */
  unstable_externalRuntimeSrc?: string | BootstrapScriptDescriptor,
  /** 写入文档的模块 import map。 */
  importMap?: ImportMap,
  /** 服务端编码的表单 Action 状态。 */
  formState?: ReactFormState<any, any> | null,
  /** 在开始正文前接收协议生成的 HTTP headers。 */
  onHeaders?: (headers: Headers) => void,
  /** Link 提示头的 UTF-16 码元预算；不等同于 HTTP 头 UTF-8 字节数。 */
  maxHeadersLength?: number,
};

/** 带“全部内容就绪”Promise 的 Bun 直连流返回类型。 */
type ReactDOMServerReadableStream = ReadableStream & {
  /** 服务端待处理任务归零时 resolve，致命错误时 reject；不表示下游已读完全部字节。 */
  allReady: Promise<void>,
};

/**
 * 把 React 子树适配为 Bun 的 direct ReadableStream。
 *
 * 本文件只把 DOM host config 与范围外 `react-server` 中的完整 Fizz 状态机接到 Bun
 * stream：shell 就绪才公开流，pull 启动写出，cancel 同时停流并 abort；Bun 的
 * `type: 'direct'` 与 2048高水位接宿主背压。shell错误拒绝外层Promise，shell成功后
 * fatal错误由stream/allReady通道体现；allReady不等待消费者排空。AbortSignal已经中止时
 * 立即把reason传给request，否则仅在abort事件触发后移除监听器，正常结束未在此处移除。
 */
function renderToReadableStream(
  children: ReactNodeList,
  options?: Options,
): Promise<ReactDOMServerReadableStream> {
  return new Promise((resolve, reject) => {
    let onFatalError;
    let onAllReady;
    const allReady = new Promise<void>((res, rej) => {
      onAllReady = res;
      onFatalError = rej;
    });

    /** shell 可输出后创建并交付 Bun direct ReadableStream。 */
    function onShellReady() {
      const stream: ReactDOMServerReadableStream = new ReadableStream(
        {
          type: 'direct',
          /** 下游请求字节时把 Fizz request 接到 Bun controller。 */
          pull: (controller): ?Promise<void> => {
            // $FlowFixMe[incompatible-type]
            startFlowing(request, controller);
          },
          /** 消费者取消时停止当前 destination，并把原因传播到 Fizz request。 */
          cancel: (reason): ?Promise<void> => {
            stopFlowing(request);
            abort(request, reason);
          },
        },
        // $FlowFixMe[prop-missing] size() methods are not allowed on byte streams.
        // $FlowFixMe[incompatible-type]
        {highWaterMark: 2048},
      ) as any;
      // TODO：未来改用 ReadableStream 子类，避免在实例上动态附加 allReady。
      stream.allReady = allReady;
      resolve(stream);
    }
    /** shell 创建前失败时拒绝外层 Promise，并消费调用方无法再取得的 allReady 拒绝。 */
    function onShellError(error: mixed) {
      // shell 失败后调用方拿不到 stream.allReady，但 fatal 路径仍会拒绝它；这里吞掉重复拒绝，
      // 防止产生无法由调用方处理的 UnhandledPromiseRejection。
      allReady.catch(() => {});
      reject(error);
    }

    const onHeaders = options ? options.onHeaders : undefined;
    let onHeadersImpl;
    if (onHeaders) {
      /** 把 host config 的描述符转换成 Bun Headers 实例后交给调用方。 */
      onHeadersImpl = (headersDescriptor: HeadersDescriptor) => {
        onHeaders(new Headers(headersDescriptor));
      };
    }

    const resumableState = createResumableState(
      options ? options.identifierPrefix : undefined,
      options ? options.unstable_externalRuntimeSrc : undefined,
      options ? options.bootstrapScriptContent : undefined,
      options ? options.bootstrapScripts : undefined,
      options ? options.bootstrapModules : undefined,
    );
    const request = createRequest(
      children,
      resumableState,
      createRenderState(
        resumableState,
        options ? options.nonce : undefined,
        options ? options.unstable_externalRuntimeSrc : undefined,
        options ? options.importMap : undefined,
        onHeadersImpl,
        options ? options.maxHeadersLength : undefined,
      ),
      createRootFormatContext(options ? options.namespaceURI : undefined),
      options ? options.progressiveChunkSize : undefined,
      options ? options.onError : undefined,
      options ? options.onBrowserBailout : undefined,
      onAllReady,
      onShellReady,
      onShellError,
      onFatalError,
      options ? options.formState : undefined,
    );
    if (options && options.signal) {
      const signal = options.signal;
      if (signal.aborted) {
        abort(request, (signal as any).reason);
      } else {
        /** 信号触发 abort 后移除本监听器，避免同一监听器再次中止请求。 */
        const listener = () => {
          abort(request, (signal as any).reason);
          signal.removeEventListener('abort', listener);
        };
        signal.addEventListener('abort', listener);
      }
    }
    startWork(request);
  });
}

export {renderToReadableStream, ReactVersion as version};
