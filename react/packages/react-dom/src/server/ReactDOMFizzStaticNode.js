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

/** 字符串仅配置脚本nonce；对象分别配置script/style，字符串不配置样式nonce。 */
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
  /** 在开始正文前接收协议生成的原始 header 描述符。 */
  onHeaders?: (headers: HeadersDescriptor) => void,
  /** Link 提示头的 UTF-16 码元预算；不等同于 HTTP 头 UTF-8 字节数。 */
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
 * Node host config只认识Writable；此桥接把字符串以TextEncoder转Uint8Array，二进制块原样
 * enqueue，end/error转controller关闭/错误。write恒true，不用desiredSize控制布尔背压，
 * 因此pull触发后可以继续入队本轮完整输出；取消由外层cancel先停destination再abort。
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

/** 以Node Readable的push/destroy伪装Writable；push(chunk)的false交给Fizz暂停destination，read再startFlowing恢复。end推null结束，destroy(error)让Readable报错；桥本身不注册消费者close/destroy到request.abort。 */
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
 * `react-server`。onAllReady才创建Readable与延期快照，read按下游需求启动写出，
 * push=false会暂停Fizz写出，后续read重新接回。结果Promise就绪不等于流已读完。
 * 本Node入口未为Readable的close/destroy添加abort回调；外部signal中止仍交给request，
 * 信号监听只在abort触发后移除，正常完成未在此处清理。
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

/**
 * 在 Node 构建中把静态预渲染结果适配为 Web ReadableStream。
 * 与 Node stream 入口共享 Fizz 请求配置，但通过 controller/Writable 桥提供 Web Streams
 * 的start/pull/cancel生命周期，并把header描述符转换为Web Headers。
 * start只准备桥，onAllReady交付后pull才写出；桥write恒true，未采用Node push式背压。
 * cancel先stopFlowing再abort，fatal在交付前拒绝结果、写出后由controller体现。
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
 * 从postponedState复用resumableState、用undefined nonce创建新renderState；只读取
 * signal/onError/onBrowserBailout，新的options不重选根格式或bootstrap。
 * onAllReady才交付新延期快照，Readable/Writable桥继续承载Node push背压；消费者
 * destroy没有专门接到abort，信号监听清理边界与首次Node预渲染相同。
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

/**
 * 从 postponed state 继续预渲染，并以 Web ReadableStream 返回本轮内容。
 * 从postponedState复用resumableState并创建新renderState，nonce固定undefined；
 * 类型Omit限制nonce，运行时未对多余字段抛错。onAllReady交付新延期快照及Web流，
 * start准备恒true写入桥，pull连接request，cancel依次stopFlowing/abort；消费背压
 * 不经Node push实现。options仅取signal和两种错误回调，信号监听正常完成时未清理。
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

export {
  prerender,
  prerenderToNodeStream,
  resumeAndPrerender,
  resumeAndPrerenderToNodeStream,
  ReactVersion as version,
};
