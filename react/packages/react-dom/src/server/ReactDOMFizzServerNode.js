/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  Request,
  PostponedState,
  ErrorInfo,
} from 'react-server/src/ReactFizzServer';
import type {ReactNodeList, ReactFormState} from 'shared/ReactTypes';
import type {Writable} from 'stream';
import type {
  BootstrapScriptDescriptor,
  HeadersDescriptor,
} from 'react-dom-bindings/src/server/ReactFizzConfigDOM';
import type {Destination} from 'react-server/src/ReactServerStreamConfigNode';
import type {ImportMap} from '../shared/ReactDOMTypes';

import ReactVersion from 'shared/ReactVersion';

import {
  createRequest,
  resumeRequest,
  startWork,
  startFlowing,
  stopFlowing,
  abort,
  prepareForStartFlowingIfBeforeAllReady,
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

/** 为 Node Writable 的 drain 事件创建续流回调，解除此前的背压暂停。 */
function createDrainHandler(destination: Destination, request: Request) {
  return () => startFlowing(request, destination);
}

/** 为 destination 的 error/close 事件创建停止并中止 Fizz 请求的回调。 */
function createCancelHandler(request: Request, reason: string) {
  return () => {
    stopFlowing(request);
    // eslint-disable-next-line react-internal/prod-error-codes
    abort(request, new Error(reason));
  };
}

/** 可统一配置 nonce，也可分别配置脚本与样式 nonce。 */
type NonceOption =
  | string
  | {
      /** 输出到 script 标签的 CSP nonce。 */
      script?: string,
      /** 输出到 style/link 标签的 CSP nonce。 */
      style?: string,
    };

/** Node pipeable/ReadableStream 服务端渲染适配器的创建选项。 */
type Options = {
  /** 为 useId 等同构标识添加根级前缀。 */
  identifierPrefix?: string,
  /** 指定根节点使用的 HTML/SVG/MathML 命名空间。 */
  namespaceURI?: string,
  /** 写入脚本与样式资源的 CSP nonce。 */
  nonce?: NonceOption,
  /** 在 bootstrap 资源前内联写出的启动脚本。 */
  bootstrapScriptContent?: string,
  /** 需要生成传统 script 标签的启动资源。 */
  bootstrapScripts?: Array<string | BootstrapScriptDescriptor>,
  /** 需要生成 module script 标签的启动资源。 */
  bootstrapModules?: Array<string | BootstrapScriptDescriptor>,
  /** Fizz 渐进输出采用的目标 chunk 大小。 */
  progressiveChunkSize?: number,
  /** 首个可显示 shell 准备好时调用。 */
  onShellReady?: () => void,
  /** shell 生成失败且无法开始输出时调用。 */
  onShellError?: (error: mixed) => void,
  /** 所有 Suspense 边界完成时调用。 */
  onAllReady?: () => void,
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
  /** 在开始正文前接收协议生成的原始 header 描述符。 */
  onHeaders?: (headers: HeadersDescriptor) => void,
  /** 允许 Fizz 收集的 headers 总长度上限。 */
  maxHeadersLength?: number,
};

/** 从 postponed 状态恢复 Node pipeable stream 时允许覆盖的选项。 */
type ResumeOptions = {
  /** 恢复输出使用的 CSP nonce。 */
  nonce?: NonceOption,
  /** 恢复请求的 shell 可输出时调用。 */
  onShellReady?: () => void,
  /** 恢复请求的 shell 无法生成时调用。 */
  onShellError?: (error: mixed) => void,
  /** 恢复请求所有边界完成时调用。 */
  onAllReady?: () => void,
  /** 接收恢复阶段错误，并可返回错误摘要。 */
  onError?: (error: mixed, errorInfo: ErrorInfo) => ?string,
  /** 接收恢复阶段要求浏览器接管的错误。 */
  onBrowserBailout?: (error: mixed, errorInfo: ErrorInfo) => void,
};

/** 绑定单个 Node Writable destination 的可中止流句柄。 */
type PipeableStream = {
  /** 取消待处理 I/O，并让剩余 Suspense 内容转为客户端渲染。 */
  abort(reason: mixed): void,
  /** 把输出连接到唯一的 Node Writable，并原样返回 destination。 */
  pipe<T: Writable>(destination: T): T,
};

/**
 * 根据 DOM 服务端选项创建底层 Fizz request。
 * 本文件只选择 DOM host config 和 Node 流回调；完整 Fizz 调度/边界状态机位于范围外的
 * `react-server`，这里不重新实现它。
 */
function createRequestImpl(children: ReactNodeList, options: void | Options) {
  const resumableState = createResumableState(
    options ? options.identifierPrefix : undefined,
    options ? options.unstable_externalRuntimeSrc : undefined,
    options ? options.bootstrapScriptContent : undefined,
    options ? options.bootstrapScripts : undefined,
    options ? options.bootstrapModules : undefined,
  );
  return createRequest(
    children,
    resumableState,
    createRenderState(
      resumableState,
      options ? options.nonce : undefined,
      options ? options.unstable_externalRuntimeSrc : undefined,
      options ? options.importMap : undefined,
      options ? options.onHeaders : undefined,
      options ? options.maxHeadersLength : undefined,
    ),
    createRootFormatContext(options ? options.namespaceURI : undefined),
    options ? options.progressiveChunkSize : undefined,
    options ? options.onError : undefined,
    options ? options.onBrowserBailout : undefined,
    options ? options.onAllReady : undefined,
    options ? options.onShellReady : undefined,
    options ? options.onShellError : undefined,
    undefined,
    options ? options.formState : undefined,
  );
}

/**
 * 创建 Node pipeable stream 适配器并立即启动 Fizz 工作。
 * `pipe` 只允许绑定一次 destination；drain 恢复写出，error/提前 close 会停流并 abort，
 * 从而让 Node 背压与 Fizz request 生命周期保持一致。
 */
function renderToPipeableStream(
  children: ReactNodeList,
  options?: Options,
): PipeableStream {
  const request = createRequestImpl(children, options);
  let hasStartedFlowing = false;
  startWork(request);
  return {
    /** 绑定唯一 Writable，安装背压/失败监听器，并开始向它写出。 */
    pipe<T: Writable>(destination: T): T {
      if (hasStartedFlowing) {
        throw new Error(
          'React currently only supports piping to one writable stream.',
        );
      }
      hasStartedFlowing = true;
      prepareForStartFlowingIfBeforeAllReady(request);
      startFlowing(request, destination);
      destination.on('drain', createDrainHandler(destination, request));
      destination.on(
        'error',
        createCancelHandler(
          request,
          'The destination stream errored while writing data.',
        ),
      );
      destination.on(
        'close',
        createCancelHandler(request, 'The destination stream closed early.'),
      );
      return destination;
    },
    /** 用调用方原因中止尚未完成的渲染。 */
    abort(reason: mixed) {
      abort(request, reason);
    },
  };
}

/**
 * 把 Web ReadableStream controller 伪装成 Node Writable 协议。
 * 当前 Node host config 只认识 Writable；此桥接编码字符串并转发 enqueue/close/error，
 * 让同一 Fizz request 能服务 Web Streams API。
 */
function createFakeWritableFromReadableStreamController(
  controller: ReadableStreamController,
): Writable {
  // 当前 host config 需要 Writable，因此临时构造桥接器把输出推入 ReadableStream。
  return {
    /** 编码字符串 chunk 并入队；Web controller 在此适配层不反馈 Node 式背压。 */
    write(chunk: string | Uint8Array) {
      if (typeof chunk === 'string') {
        chunk = textEncoder.encode(chunk);
      }
      controller.enqueue(chunk);
      // 此桥接不使用 Node 的布尔背压协议，始终允许 Fizz 继续写入。
      return true;
    },
    /** 正常结束时关闭 ReadableStream controller。 */
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

/** 带“全部内容就绪”Promise 的 Node Web Streams 返回类型。 */
type ReactDOMServerReadableStream = ReadableStream & {
  /** 所有 Suspense 边界均完成或请求发生致命错误时结算。 */
  allReady: Promise<void>,
};

/** Web Streams 入口移除 pipeable 专用回调，并增加 AbortSignal/浏览器 Headers。 */
type WebStreamsOptions = Omit<
  Options,
  'onShellReady' | 'onShellError' | 'onAllReady' | 'onHeaders',
> & {
  /** 调用方用于取消 Web Streams 请求的信号。 */
  signal: AbortSignal,
  /** 在开始正文前接收转换后的 Web Headers。 */
  onHeaders?: (headers: Headers) => void
};

/**
 * 在 Node 构建中把 React 子树适配为 Web ReadableStream。
 * start 创建 Writable 桥，pull 驱动 Fizz 写出，cancel 停流并 abort；shell 就绪后才向
 * 调用方交付流，而 `allReady` 独立表示全部边界完成。
 */
function renderToReadableStream(
  children: ReactNodeList,
  options?: WebStreamsOptions,
): Promise<ReactDOMServerReadableStream> {
  return new Promise((resolve, reject) => {
    let onFatalError;
    let onAllReady;
    const allReady = new Promise<void>((res, rej) => {
      onAllReady = res;
      onFatalError = rej;
    });

    /** shell 可输出后创建 Web ReadableStream 与 Writable 桥。 */
    function onShellReady() {
      let writable: Writable;
      const stream: ReactDOMServerReadableStream = new ReadableStream(
        {
          type: 'bytes',
          /** stream 构造时为 controller 创建 host config 所需的 Writable 桥。 */
          start: (controller): ?Promise<void> => {
            writable =
              createFakeWritableFromReadableStreamController(controller);
          },
          /** 下游拉取时从 Fizz request 继续向桥接 Writable 写出。 */
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
      /** 把 host config 描述符转换成 Web Headers 后交给调用方。 */
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

/** 用 postponed state 与恢复选项创建底层 Fizz resume request。 */
function resumeRequestImpl(
  children: ReactNodeList,
  postponedState: PostponedState,
  options: void | ResumeOptions,
) {
  return resumeRequest(
    children,
    postponedState,
    resumeRenderState(
      postponedState.resumableState,
      options ? options.nonce : undefined,
    ),
    options ? options.onError : undefined,
    options ? options.onBrowserBailout : undefined,
    options ? options.onAllReady : undefined,
    options ? options.onShellReady : undefined,
    options ? options.onShellError : undefined,
    undefined,
  );
}

/**
 * 从 postponed state 创建 Node pipeable 恢复流。
 * 恢复请求仍只允许一个 destination，并复用 drain/error/close 的生命周期桥接。
 */
function resumeToPipeableStream(
  children: ReactNodeList,
  postponedState: PostponedState,
  options?: ResumeOptions,
): PipeableStream {
  const request = resumeRequestImpl(children, postponedState, options);
  let hasStartedFlowing = false;
  startWork(request);
  return {
    /** 绑定唯一 Writable，安装背压/失败监听器，并开始写出恢复内容。 */
    pipe<T: Writable>(destination: T): T {
      if (hasStartedFlowing) {
        throw new Error(
          'React currently only supports piping to one writable stream.',
        );
      }
      hasStartedFlowing = true;
      startFlowing(request, destination);
      destination.on('drain', createDrainHandler(destination, request));
      destination.on(
        'error',
        createCancelHandler(
          request,
          'The destination stream errored while writing data.',
        ),
      );
      destination.on(
        'close',
        createCancelHandler(request, 'The destination stream closed early.'),
      );
      return destination;
    },
    /** 用调用方原因中止尚未完成的恢复请求。 */
    abort(reason: mixed) {
      abort(request, reason);
    },
  };
}

/** Web Streams 恢复入口移除 pipeable 生命周期回调并要求 AbortSignal。 */
type WebStreamsResumeOptions = Omit<
  Options,
  'onShellReady' | 'onShellError' | 'onAllReady',
> & {
  /** 调用方用于取消 Web Streams 恢复请求的信号。 */
  signal: AbortSignal
};

/**
 * 从 postponed state 恢复 Node 构建的 Web ReadableStream。
 * 复用已序列化 render state，且保持 start/pull/cancel 与 allReady 的首次渲染协议。
 */
function resume(
  children: ReactNodeList,
  postponedState: PostponedState,
  options?: WebStreamsResumeOptions,
): Promise<ReactDOMServerReadableStream> {
  return new Promise((resolve, reject) => {
    let onFatalError;
    let onAllReady;
    const allReady = new Promise<void>((res, rej) => {
      onAllReady = res;
      onFatalError = rej;
    });

    /** 恢复请求的 shell 可输出后创建 Web ReadableStream 与 Writable 桥。 */
    function onShellReady() {
      let writable: Writable;
      const stream: ReactDOMServerReadableStream = new ReadableStream(
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
    const request = resumeRequest(
      children,
      postponedState,
      resumeRenderState(
        postponedState.resumableState,
        options ? options.nonce : undefined,
      ),
      options ? options.onError : undefined,
      options ? options.onBrowserBailout : undefined,
      onAllReady,
      onShellReady,
      onShellError,
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
  renderToPipeableStream,
  renderToReadableStream,
  resumeToPipeableStream,
  resume,
  ReactVersion as version,
};
