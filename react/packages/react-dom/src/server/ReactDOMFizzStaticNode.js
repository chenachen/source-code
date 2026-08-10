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

import {Writable, Readable} from 'stream';

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

import {textEncoder} from 'react-server/src/ReactServerStreamConfigNode';

import {ensureCorrectIsomorphicReactVersion} from '../shared/ensureCorrectIsomorphicReactVersion';
ensureCorrectIsomorphicReactVersion();

/** 可统一配置 nonce，也可分别配置脚本与样式 nonce。 */
type NonceOption =
  | string
  | {
      /** 输出到 script 标签的 CSP nonce。 */
      script?: string,
      /** 输出到 style/link 标签的 CSP nonce。 */
      style?: string,
    };

/** Node 静态预渲染适配器的创建选项。 */
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
  /** Fizz 渐进输出采用的目标 chunk 大小。 */
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
  /** 在开始正文前接收协议生成的原始 header 描述符。 */
  onHeaders?: (headers: HeadersDescriptor) => void,
  /** 允许 Fizz 收集的 headers 总长度上限。 */
  maxHeadersLength?: number,
};

/** Node 静态预渲染结果：可消费的 Readable 与可选延期状态。 */
type StaticResult = {
  /** 未完成边界的序列化状态；没有延期内容时为空。 */
  postponed: null | PostponedState,
  /** 所有当前可预渲染内容组成的 Node Readable。 */
  prelude: Readable,
};

/**
 * 把 Web ReadableStream controller 伪装成 Node Writable 协议。
 * Node host config 只认识 Writable；此桥接编码字符串并转发 enqueue/close/error。
 */
function createFakeWritableFromReadableStreamController(
  controller: ReadableStreamController,
): Writable {
  // 当前 host config 需要 Writable，因此临时构造桥接器把输出推入 Web ReadableStream。
  return {
    /** 编码字符串 chunk 并入队；此桥接不使用 Node 式布尔背压。 */
    write(chunk: string | Uint8Array) {
      if (typeof chunk === 'string') {
        chunk = textEncoder.encode(chunk);
      }
      controller.enqueue(chunk);
      // 此桥接不使用 Node 的布尔背压协议，始终允许 Fizz 继续写入。
      return true;
    },
    /** 正常结束时关闭 Web controller。 */
    end() {
      controller.close();
    },
    /** 失败时优先把错误传给 controller；旧实现无 error 方法则退化为关闭。 */
    destroy(error) {
      // $FlowFixMe[method-unbinding]
      if (typeof controller.error === 'function') {
        // $FlowFixMe[incompatible-call]: This is an Error object or the destination accepts other types.
        controller.error(error);
      } else {
        controller.close();
      }
    },
  } as any;
}

/** 把 Node Readable 的 push/destroy 接口桥接成 host config 需要的 Writable。 */
function createFakeWritableFromReadable(readable: any): Writable {
  // 当前 host config 需要 Writable，因此用 Readable 的反向 push 接收服务端输出。
  return {
    /** 把 chunk 推入 Node Readable，并把其布尔返回值作为背压信号。 */
    write(chunk) {
      return readable.push(chunk);
    },
    /** 推入 null，标记 Node Readable 正常结束。 */
    end() {
      readable.push(null);
    },
    /** 把服务端流错误传播给 Node Readable。 */
    destroy(error) {
      readable.destroy(error);
    },
  } as any;
}

/**
 * 等待全部可预渲染内容就绪，再返回 Node Readable 与 postponed state。
 * 本文件只负责 Node stream/DOM host config 适配；完整 Fizz 预渲染状态机位于范围外的
 * `react-server`。Readable 的 read 回调按下游需求启动写出，保留 Node 背压语义。
 */
function prerenderToNodeStream(
  children: ReactNodeList,
  options?: Options,
): Promise<StaticResult> {
  return new Promise((resolve, reject) => {
    const onFatalError = reject;

    /** 所有可预渲染内容就绪后创建 Readable/Writable 桥并交付结果。 */
    function onAllReady() {
      const readable: Readable = new Readable({
        /** 下游读取时让 Fizz 向桥接 Writable 继续写出。 */
        read() {
          startFlowing(request, writable);
        },
      });
      const writable = createFakeWritableFromReadable(readable);

      const result: StaticResult = {
        /** 捕获仍需后续 resume 的边界状态。 */
        postponed: getPostponedState(request),
        /** 暴露已完成内容的 Node Readable。 */
        prelude: readable,
      };
      resolve(result);
    }
    const resumableState = createResumableState(
      options ? options.identifierPrefix : undefined,
      options ? options.unstable_externalRuntimeSrc : undefined,
      options ? options.bootstrapScriptContent : undefined,
      options ? options.bootstrapScripts : undefined,
      options ? options.bootstrapModules : undefined,
    );
    const request = createPrerenderRequest(
      children,
      resumableState,
      createRenderState(
        resumableState,
        undefined, // 预渲染 bootstrap 脚本与 nonce 不兼容，必须保持未设置。
        options ? options.unstable_externalRuntimeSrc : undefined,
        options ? options.importMap : undefined,
        options ? options.onHeaders : undefined,
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
        /** 只处理一次 abort，并立即注销监听器，避免 request 被信号长期引用。 */
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

/**
 * 在 Node 构建中把静态预渲染结果适配为 Web ReadableStream。
 * 与 Node stream 入口共享 Fizz 请求配置，但通过 controller/Writable 桥提供 Web Streams
 * 的 start/pull/cancel 生命周期，并把 header 描述符转换为 Web Headers。
 */
function prerender(
  children: ReactNodeList,
  options?: Omit<Options, 'onHeaders'> & {
    /** 在开始正文前接收转换后的 Web Headers。 */
    onHeaders?: (headers: Headers) => void,
  },
): Promise<{
  /** 未完成边界的序列化状态；没有延期内容时为空。 */
  postponed: null | PostponedState,
  /** 所有当前可预渲染内容组成的 Web 字节流。 */
  prelude: ReadableStream,
}> {
  return new Promise((resolve, reject) => {
    const onFatalError = reject;

    /** 所有可预渲染内容就绪后创建 Web 流与 Writable 桥并交付结果。 */
    function onAllReady() {
      let writable: Writable;
      const stream = new ReadableStream(
        {
          type: 'bytes',
          /** stream 构造时为 controller 创建 host config 所需的 Writable 桥。 */
          start: (controller): ?Promise<void> => {
            writable =
              createFakeWritableFromReadableStreamController(controller);
          },
          /** 下游拉取时从 Fizz request 继续写出。 */
          pull: (controller): ?Promise<void> => {
            startFlowing(request, writable);
          },
          /** 消费者取消时停止 destination 并把原因传播到 request。 */
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
        /** 捕获仍需后续 resume 的边界状态。 */
        postponed: getPostponedState(request),
        /** 暴露已完成内容的 Web 前奏流。 */
        prelude: stream,
      };
      resolve(result);
    }

    const onHeaders = options ? options.onHeaders : undefined;
    let onHeadersImpl;
    if (onHeaders) {
      /** 把 host config 描述符转换成 Web Headers 后交给调用方。 */
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
        /** 只处理一次 abort，并立即注销监听器，避免 request 被信号长期引用。 */
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

/** 从 postponed state 继续 Node 静态预渲染时允许覆盖的选项。 */
type ResumeOptions = {
  /** 常规恢复可设置 nonce；静态恢复入口会通过 Omit 禁止它。 */
  nonce?: NonceOption,
  /** 调用方用于取消恢复预渲染请求的信号。 */
  signal?: AbortSignal,
  /** 接收恢复阶段错误，并可返回错误摘要。 */
  onError?: (error: mixed, errorInfo: ErrorInfo) => ?string,
  /** 接收恢复阶段要求浏览器接管的错误。 */
  onBrowserBailout?: (error: mixed, errorInfo: ErrorInfo) => void,
};

/**
 * 从 postponed state 继续预渲染，并以 Node Readable 返回本轮内容。
 * 恢复请求复用序列化 state；Readable/Writable 桥继续承载 Node 背压。
 */
function resumeAndPrerenderToNodeStream(
  children: ReactNodeList,
  postponedState: PostponedState,
  options?: Omit<ResumeOptions, 'nonce'>,
): Promise<StaticResult> {
  return new Promise((resolve, reject) => {
    const onFatalError = reject;

    /** 恢复内容全部就绪后创建 Readable/Writable 桥并交付结果。 */
    function onAllReady() {
      const readable: Readable = new Readable({
        /** 下游读取时让恢复 request 向桥接 Writable 继续写出。 */
        read() {
          startFlowing(request, writable);
        },
      });
      const writable = createFakeWritableFromReadable(readable);

      const result = {
        /** 捕获仍需下一轮 resume 的边界状态。 */
        postponed: getPostponedState(request),
        /** 暴露本轮已完成内容的 Node Readable。 */
        prelude: readable,
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
        /** 只处理一次 abort，并立即注销监听器，避免恢复 request 被信号长期引用。 */
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

/**
 * 从 postponed state 继续预渲染，并以 Web ReadableStream 返回本轮内容。
 * start/pull/cancel 通过 Writable 桥连接恢复 request，继续保持禁止 nonce 的静态协议。
 */
function resumeAndPrerender(
  children: ReactNodeList,
  postponedState: PostponedState,
  options?: Omit<ResumeOptions, 'nonce'>,
): Promise<{
  /** 未完成边界的序列化状态；没有延期内容时为空。 */
  postponed: null | PostponedState,
  /** 本轮已完成内容组成的 Web 字节流。 */
  prelude: ReadableStream,
}> {
  return new Promise((resolve, reject) => {
    const onFatalError = reject;

    /** 恢复内容全部就绪后创建 Web 流与 Writable 桥并交付结果。 */
    function onAllReady() {
      let writable: Writable;
      const stream = new ReadableStream(
        {
          type: 'bytes',
          /** stream 构造时为 controller 创建 host config 所需的 Writable 桥。 */
          start: (controller): ?Promise<void> => {
            writable =
              createFakeWritableFromReadableStreamController(controller);
          },
          /** 下游拉取时从恢复 request 继续写出。 */
          pull: (controller): ?Promise<void> => {
            startFlowing(request, writable);
          },
          /** 消费者取消时停止 destination 并把原因传播到恢复 request。 */
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
        /** 暴露本轮已完成内容的 Web 前奏流。 */
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
        /** 只处理一次 abort，并立即注销监听器，避免恢复 request 被信号长期引用。 */
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

export {
  prerender,
  prerenderToNodeStream,
  resumeAndPrerender,
  resumeAndPrerenderToNodeStream,
  ReactVersion as version,
};
