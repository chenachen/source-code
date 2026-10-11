/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactNodeList} from 'shared/ReactTypes';
import type {
  BootstrapScriptDescriptor,
  HeadersDescriptor,
} from 'react-dom-bindings/src/server/ReactFizzConfigDOM';
import type {PostponedState, ErrorInfo} from 'react-server/src/ReactFizzServer';
import type {ImportMap} from '../shared/ReactDOMTypes';

import ReactVersion from 'shared/ReactVersion';

import {
  createPrerenderRequest,
  resumeAndPrerenderRequest,
  startWork,
  startFlowing,
  stopFlowing,
  abort,
  getPostponedState,
} from 'react-server/src/ReactFizzServer';

import {
  createResumableState,
  createRenderState,
  resumeRenderState,
  createRootFormatContext,
} from 'react-dom-bindings/src/server/ReactFizzConfigDOM';

import {ensureCorrectIsomorphicReactVersion} from '../shared/ensureCorrectIsomorphicReactVersion';
ensureCorrectIsomorphicReactVersion();

/** 字符串仅配置脚本nonce；对象分别配置script/style，字符串不配置样式nonce。 */
type NonceOption =
  | string
  | {
      /** 输出到 script 标签的 CSP nonce。 */
      script?: string,
      /** 输出到 style/link 标签的 CSP nonce。 */
      style?: string,
    };

/** 浏览器静态预渲染适配器的创建选项。 */
type Options = {
  /** 为 useId 等同构标识添加根级前缀。 */
  identifierPrefix?: string,
  /** 指定根节点使用的 HTML/SVG/MathML 命名空间。 */
  namespaceURI?: string,
  /** 在 bootstrap 资源前内联写出的启动脚本。 */
  bootstrapScriptContent?: string,
  /** 需要生成传统 script 标签的启动资源。 */
  bootstrapScripts?: Array<string | BootstrapScriptDescriptor>,
  /** 需要生成 module script 标签的启动资源。 */
  bootstrapModules?: Array<string | BootstrapScriptDescriptor>,
  /** 决定已完成 Suspense 边界是否单独输出的字节阈值；不是流中每个 chunk 的固定大小。 */
  progressiveChunkSize?: number,
  /** 调用方用于取消预渲染请求的信号。 */
  signal?: AbortSignal,
  /** 接收渲染错误，并可返回供错误摘要使用的字符串。 */
  onError?: (error: mixed, errorInfo: ErrorInfo) => ?string,
  /** 接收要求浏览器接管渲染的服务端退避错误。 */
  onBrowserBailout?: (error: mixed, errorInfo: ErrorInfo) => void,
  /** 实验性外部 DOM 指令 runtime 的资源地址或描述符。 */
  unstable_externalRuntimeSrc?: string | BootstrapScriptDescriptor,
  /** 写入文档的模块 import map。 */
  importMap?: ImportMap,
  /** 在开始正文前接收协议生成的 HTTP headers。 */
  onHeaders?: (headers: Headers) => void,
  /** Link 提示头的 UTF-16 码元预算；不等同于 HTTP 头 UTF-8 字节数。 */
  maxHeadersLength?: number,
};

/** 静态预渲染结果：可立即消费的前奏流与可选延期状态。 */
type StaticResult = {
  /** 未完成边界的序列化状态；没有延期内容时为空。 */
  postponed: null | PostponedState,
  /** 所有当前可预渲染内容组成的字节流。 */
  prelude: ReadableStream,
};

/**
 * 等待全部可预渲染内容就绪，再返回浏览器字节流与 postponed state。
 * 本文件只负责 Web Streams/DOM host config 适配；完整 Fizz 预渲染状态机位于范围外的
 * `react-server`。onAllReady后才交付prelude流与延期快照，字节写出仍等pull，不代表下游已读完。
 * fatal在交付前拒绝外层Promise；流cancel先stopFlowing再abort。signal已中止立即abort，
 * 否则注册一次监听，只在abort触发后移除，本适配器正常完成时不另清理signal监听。
 * 静态bootstrap不传nonce，createRenderState明确收到undefined而非运行时校验选项。
 */
function prerender(
  children: ReactNodeList,
  options?: Options,
): Promise<StaticResult> {
  return new Promise((resolve, reject) => {
    const onFatalError = reject;

    /** 所有可预渲染内容就绪后创建流，并连同延期状态一次性交付。 */
    function onAllReady() {
      const stream = new ReadableStream(
        {
          type: 'bytes',
          /** 下游拉取时把预渲染 request 接到当前 controller。 */
          pull: (controller): ?Promise<void> => {
            startFlowing(request, controller);
          },
          /** 消费者取消时停止 destination，并把原因传播到 request。 */
          cancel: (reason): ?Promise<void> => {
            stopFlowing(request);
            abort(request, reason);
          },
        },
        // $FlowFixMe[prop-missing] size() methods are not allowed on byte streams.
        // $FlowFixMe[incompatible-type]
        {highWaterMark: 0},
      );

      const result: StaticResult = {
        /** 捕获仍需后续 resume 的边界状态。 */
        postponed: getPostponedState(request),
        /** 暴露已完成内容的可读前奏流。 */
        prelude: stream,
      };
      resolve(result);
    }

    const onHeaders = options ? options.onHeaders : undefined;
    let onHeadersImpl;
    if (onHeaders) {
      /** 把 host config 描述符转换成浏览器 Headers 后交给调用方。 */
      onHeadersImpl = (headersDescriptor: HeadersDescriptor) => {
        onHeaders(new Headers(headersDescriptor));
      };
    }

    const resources = createResumableState(
      options ? options.identifierPrefix : undefined,
      options ? options.unstable_externalRuntimeSrc : undefined,
      options ? options.bootstrapScriptContent : undefined,
      options ? options.bootstrapScripts : undefined,
      options ? options.bootstrapModules : undefined,
    );
    const request = createPrerenderRequest(
      children,
      resources,
      createRenderState(
        resources,
        undefined, // 预渲染 bootstrap 脚本与 nonce 不兼容，必须保持未设置。
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
      undefined,
      undefined,
      onFatalError,
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

/** 从 postponed state 继续静态预渲染时允许覆盖的选项。 */
type ResumeOptions = {
  /** 常规恢复可设置 nonce；静态恢复入口会通过 Omit 禁止它。 */
  nonce?: NonceOption,
  /** 调用方用于取消恢复预渲染请求的信号。 */
  signal?: AbortSignal,
  /** 接收恢复阶段错误，并可返回错误摘要。 */
  onError?: (error: mixed) => ?string,
  /** 接收恢复阶段要求浏览器接管的错误。 */
  onBrowserBailout?: (error: mixed, errorInfo: ErrorInfo) => void,
  /** 类型中保留的外部runtime选项；此resumeAndPrerender实现不读取它，沿用postponedState的配置。 */
  unstable_externalRuntimeSrc?: string | BootstrapScriptDescriptor,
};

/**
 * 从 postponed state 继续预渲染，并返回新的前奏流与可能仍延期的状态。
 * 从postponedState取resumableState并创建新renderState，请求核心继续先前保留的任务；
 * 本入口只读取signal/onError/onBrowserBailout，不重选identifierPrefix/namespace或bootstrap。
 * nonce始终传undefined；类型Omit限制选项，但函数未对多余运行时字段抛错。
 * onAllReady交付新延期快照及尚需pull消费的流，cancel/abort顺序与首次prerender一致。
 */
function resumeAndPrerender(
  children: ReactNodeList,
  postponedState: PostponedState,
  options?: Omit<ResumeOptions, 'nonce'>,
): Promise<StaticResult> {
  return new Promise((resolve, reject) => {
    const onFatalError = reject;

    /** 恢复内容全部就绪后创建流，并连同新的延期状态一次性交付。 */
    function onAllReady() {
      const stream = new ReadableStream(
        {
          type: 'bytes',
          /** 下游拉取时把恢复 request 接到当前 controller。 */
          pull: (controller): ?Promise<void> => {
            startFlowing(request, controller);
          },
          /** 消费者取消时停止 destination，并把原因传播到恢复 request。 */
          cancel: (reason): ?Promise<void> => {
            stopFlowing(request);
            abort(request, reason);
          },
        },
        // $FlowFixMe[prop-missing] size() methods are not allowed on byte streams.
        // $FlowFixMe[incompatible-type]
        {highWaterMark: 0},
      );

      const result = {
        /** 捕获仍需下一轮 resume 的边界状态。 */
        postponed: getPostponedState(request),
        /** 暴露本轮已完成内容的可读前奏流。 */
        prelude: stream,
      };
      resolve(result);
    }

    const request = resumeAndPrerenderRequest(
      children,
      postponedState,
      resumeRenderState(postponedState.resumableState, undefined),
      options ? options.onError : undefined,
      options ? options.onBrowserBailout : undefined,
      onAllReady,
      undefined,
      undefined,
      onFatalError,
    );
    if (options && options.signal) {
      const signal = options.signal;
      if (signal.aborted) {
        abort(request, (signal as any).reason);
      } else {
        /** 信号触发 abort 后移除本监听器，避免同一监听器再次中止恢复请求。 */
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

export {prerender, resumeAndPrerender, ReactVersion as version};
