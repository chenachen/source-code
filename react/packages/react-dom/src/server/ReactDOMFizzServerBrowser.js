/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {PostponedState, ErrorInfo} from 'react-server/src/ReactFizzServer';
import type {ReactNodeList, ReactFormState} from 'shared/ReactTypes';
import type {
  BootstrapScriptDescriptor,
  HeadersDescriptor,
} from 'react-dom-bindings/src/server/ReactFizzConfigDOM';
import type {ImportMap} from '../shared/ReactDOMTypes';

import ReactVersion from 'shared/ReactVersion';

import {
  createRequest,
  resumeRequest,
  startWork,
  startFlowing,
  stopFlowing,
  abort,
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

/** 浏览器 ReadableStream 服务端渲染适配器的创建选项。 */
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

/** 从 postponed 状态恢复浏览器流时允许覆盖的运行期选项。 */
type ResumeOptions = {
  /** 恢复输出使用的 CSP nonce。 */
  nonce?: NonceOption,
  /** 调用方用于取消恢复请求的信号。 */
  signal?: AbortSignal,
  /** 接收恢复阶段错误，并可返回错误摘要。 */
  onError?: (error: mixed) => ?string,
  /** 接收恢复阶段要求浏览器接管的错误。 */
  onBrowserBailout?: (error: mixed, errorInfo: ErrorInfo) => void,
  /** 类型中保留的runtime选项；此resume不读取它，沿用postponedState的资源配置。 */
  unstable_externalRuntimeSrc?: string | BootstrapScriptDescriptor,
};

/** 带“全部内容就绪”Promise 的浏览器字节流返回类型。 */
type ReactDOMServerReadableStream = ReadableStream & {
  /** 服务端待处理任务归零时 resolve，致命错误时 reject；不表示下游已读完全部字节。 */
  allReady: Promise<void>,
};

/**
 * 把 React 子树适配为浏览器原生字节 ReadableStream。
 *
 * 本文件只把 DOM host config 与范围外 `react-server` 中的完整 Fizz 状态机接到 Web
 * Streams：shell就绪才公开流，pull启动写出，cancel先stopFlowing再abort；allReady
 * 独立表示服务端任务已完成，因此调用者既可渐进消费也可等待全部内容可输出。
 * shell前失败拒绝外层Promise并消费无法取得的allReady拒绝；shell公开后，后续fatal
 * 通过流错误及尚未结算的allReady体现，不会再次拒绝已resolve的外层Promise。
 * signal已中止则立即abort；正常完成未在本函数移除监听器，只在abort触发后移除。
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

    /** shell 可输出后创建并交付 Web ReadableStream。 */
    function onShellReady() {
      const stream: ReactDOMServerReadableStream = new ReadableStream(
        {
          type: 'bytes',
          /** 下游请求字节时把 Fizz request 接到当前 controller。 */
          pull: (controller): ?Promise<void> => {
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
      /** 把 host config 的描述符转换成浏览器 Headers 实例后交给调用方。 */
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

/**
 * 从 postponed Fizz 状态恢复浏览器字节流。
 * 恢复路径根据已序列化的 resumableState 新建 RenderState；bootstrap 按保存字段重建，已产出 shell 的字段已清除。流的背压、
 * 取消与allReady结算协议和首次渲染保持一致。
 * 本入口只取nonce/signal/onError/onBrowserBailout；identifier、格式上下文与bootstrap
 * 由postponedState恢复，不读取ResumeOptions里保留的unstable_externalRuntimeSrc。
 */
function resume(
  children: ReactNodeList,
  postponedState: PostponedState,
  options?: ResumeOptions,
): Promise<ReactDOMServerReadableStream> {
  return new Promise((resolve, reject) => {
    let onFatalError;
    let onAllReady;
    const allReady = new Promise<void>((res, rej) => {
      onAllReady = res;
      onFatalError = rej;
    });

    /** 恢复请求的 shell 可输出后创建并交付 Web ReadableStream。 */
    function onShellReady() {
      const stream: ReactDOMServerReadableStream = new ReadableStream(
        {
          type: 'bytes',
          /** 下游请求字节时把恢复 request 接到当前 controller。 */
          pull: (controller): ?Promise<void> => {
            startFlowing(request, controller);
          },
          /** 消费者取消时停止当前 destination，并把原因传播到恢复 request。 */
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

export {renderToReadableStream, resume, ReactVersion as version};
