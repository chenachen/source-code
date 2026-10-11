/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

'use strict';

let Stream;
let React;
let ReactDOMFizzServer;
let Suspense;
let act;

describe('ReactDOMFizzServerNode', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMFizzServer = require('react-dom/server');
    Stream = require('stream');
    Suspense = React.Suspense;
    act = require('internal-test-utils').act;
  });

  /** 建立 UTF8 PassThrough 与 result/error 记录；completed 在 writable finish 或 error 时解决，表示本测试写端结束，不代表任意下游消费者读完。 */
  function getTestWritable() {
    const writable = new Stream.PassThrough();
    writable.setEncoding('utf8');
    const output = {result: '', error: undefined};
    writable.on('data', chunk => {
      output.result += chunk;
    });
    writable.on('error', error => {
      output.error = error;
    });
    const completed = new Promise(resolve => {
      writable.on('finish', () => {
        resolve();
      });
      writable.on('error', () => {
        resolve();
      });
    });
    return {writable, completed, output};
  }

  const theError = new Error('This is an error');

  /** 抛固定 Error 对象，供流错误与 callback 检查引用一致。 */
  function Throw() {
    throw theError;
  }
  const theInfinitePromise = new Promise(() => {});

  /** 抛永不解决的共享 promise，保持请求任务挂起直至取消。 */
  function InfiniteSuspend() {
    throw theInfinitePromise;
  }

  /** 读取 Web 流到 done，每块用 Buffer 解为 UTF8 并拼接；此 helper 没有额外跨块 TextDecoder 状态。 */
  async function readContentWeb(stream) {
    const reader = stream.getReader();
    let content = '';
    while (true) {
      const {done, value} = await reader.read();
      if (done) {
        return content;
      }
      content += Buffer.from(value).toString('utf8');
    }
  }

  /** Node PassThrough 接收 pipeable 的简单 div；act 后完整 HTML 等于 hello world，验证 Node pipe 输出入口。 */
  it('should call renderToPipeableStream', async () => {
    const {writable, output} = getTestWritable();
    await act(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <div>hello world</div>,
      );
      pipe(writable);
    });
    expect(output.result).toMatchInlineSnapshot(`"<div>hello world</div>"`);
  });

  /** Node server 入口创建 Web ReadableStream；读至 done 得到简单 div HTML，验证双流 API 的编码输出。 */
  it('should support web streams', async () => {
    const stream = await act(() =>
      ReactDOMFizzServer.renderToReadableStream(<div>hello world</div>),
    );
    const result = await readContentWeb(stream);
    expect(result).toMatchInlineSnapshot(`"<div>hello world</div>"`);
  });

  /** 在 onShellReady 内调用 pipe(writable)，简单 shell 当轮全部写出；验证就绪回调与开始输出衔接。 */
  it('flush fully if piping in on onShellReady', async () => {
    const {writable, output} = getTestWritable();
    await act(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <div>hello world</div>,
        {

          /** shell 就绪时立即连接 writable，验证回调中开始输出可写完。 */
          onShellReady() {
            pipe(writable);
          },
        },
      );
    });
    expect(output.result).toMatchInlineSnapshot(`"<div>hello world</div>"`);
  });

  /** 渲染 html/body 文档根并 pipe；输出包含 doctype 与补出的 head，开启阻塞渲染标志时另有 expect link/template，验证文档外壳协议。 */
  it('should emit DOCTYPE at the root of the document', async () => {
    const {writable, output} = getTestWritable();
    await act(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <html>
          <body>hello world</body>
        </html>,
      );
      pipe(writable);
    });
    // 文档根省略显式 head 时仍补出 head；阻塞渲染功能还会加入 expect link。
    if (gate(flags => flags.enableFizzBlockingRender)) {
      expect(output.result).toMatchInlineSnapshot(
        `"<!DOCTYPE html><html><head><link rel="expect" href="#_R_" blocking="render"/></head><body>hello world<template id="_R_"></template></body></html>"`,
      );
    } else {
      expect(output.result).toMatchInlineSnapshot(
        `"<!DOCTYPE html><html><head></head><body>hello world</body></html>"`,
      );
    }
  });

  /** 给 bootstrap 内联脚本、经典与模块 src；快照验证 preload 在内容前、启动脚本在内容后及对应 script 属性。 */
  it('should emit bootstrap script src at the end', async () => {
    const {writable, output} = getTestWritable();
    await act(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <div>hello world</div>,
        {
          bootstrapScriptContent: 'INIT();',
          bootstrapScripts: ['init.js'],
          bootstrapModules: ['init.mjs'],
        },
      );
      pipe(writable);
    });
    expect(output.result).toMatchInlineSnapshot(
      `"<link rel="preload" as="script" fetchPriority="low" href="init.js"/><link rel="modulepreload" fetchPriority="low" href="init.mjs"/><div>hello world</div><script id="_R_">INIT();</script><script src="init.js" async=""></script><script type="module" src="init.mjs" async=""></script>"`,
    );
  });

  /** 完成渲染但暂不 pipe，手动先给 output 拼外壳，再 pipe；内容随后追加，验证只有 pipe 才开始向 destination 写数据。 */
  it('should start writing after pipe', async () => {
    const {writable, output} = getTestWritable();
    let pipe;
    await act(() => {
      pipe = ReactDOMFizzServer.renderToPipeableStream(
        <div>hello world</div>,
      ).pipe;
    });
    // 首先，我们编写我们的头部。
    output.result +=
      '<!doctype html><html><head><title>test</title><head><body>';
    // pipe 后才将已准备的 HTML 写入 destination。
    pipe(writable);
    expect(output.result).toMatchInlineSnapshot(
      `"<!doctype html><html><head><title>test</title><head><body><div>hello world</div>"`,
    );
  });

  /** Wait 挂起后解决 promise，在开始 pipe 前 onAllReady 触发一次但输出仍为空；最后 pipe 输出完成内容、不含 fallback，验证渲染完成与传输启动相互独立。 */
  it('emits all HTML as one unit if we wait until the end to start', async () => {
    let hasLoaded = false;
    let resolve;
    const promise = new Promise(r => (resolve = r));

    /** hasLoaded 前抛 promise，解决后返回 Done；允许延迟 pipe 前完成内容。 */
    function Wait() {
      if (!hasLoaded) {
        throw promise;
      }
      return 'Done';
    }
    let isCompleteCalls = 0;
    const {writable, output} = getTestWritable();
    const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
      <div>
        <Suspense fallback="Loading">
          <Wait />
        </Suspense>
      </div>,

      {

        /** 记录所有渲染任务已完成次数，与 destination 是否已 pipe 分开。 */
        onAllReady() {
          isCompleteCalls++;
        },
      },
    );
    await jest.runAllTimers();
    expect(output.result).toBe('');
    expect(isCompleteCalls).toBe(0);
    // 解决加载。
    hasLoaded = true;
    await resolve();

    await jest.runAllTimers();

    expect(output.result).toBe('');
    expect(isCompleteCalls).toBe(1);

    // 首先，我们编写我们的头部。
    output.result +=
      '<!doctype html><html><head><title>test</title><head><body>';
    // pipe 后才将已准备的 HTML 写入 destination。
    pipe(writable);
    expect(output.result).toMatchInlineSnapshot(
      `"<!doctype html><html><head><title>test</title><head><body><div><!--$-->Done<!-- --><!--/$--></div>"`,
    );
  });

  /** Throw 在 shell 根抛同一 Error，pipe 后 writable error 且无 HTML；onError/onShellError 各收原错误，shellReady/allReady 均不触发，验证致命 shell 失败。 */
  it('should error the stream when an error is thrown at the root', async () => {
    const reportedErrors = [];
    const reportedShellErrors = [];
    let shellReadyCalls = 0;
    let allReadyCalls = 0;
    const {writable, output, completed} = getTestWritable();
    const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
      <div>
        <Throw />
      </div>,
      {

        /** 保存根错误对象，检查 onError 与流错误一致。 */
        onError(x) {
          reportedErrors.push(x);
        },

        /** 保存致命 shell 错误，区别一般边界错误。 */
        onShellError(x) {
          reportedShellErrors.push(x);
        },

        /** 记录 shellReady 次数，致命根失败应始终为零。 */
        onShellReady() {
          shellReadyCalls++;
        },

        /** 记录 allReady 次数，致命根失败不会进入完成回调。 */
        onAllReady() {
          allReadyCalls++;
        },
      },
    );

    // 流一旦开始写入就会出错。
    pipe(writable);

    await completed;

    expect(output.error).toBe(theError);
    expect(output.result).toBe('');
    // 这类错误也会报告给 error callback。
    expect(reportedErrors).toEqual([theError]);
    expect(reportedShellErrors).toEqual([theError]);
    expect(shellReadyCalls).toBe(0);
    expect(allReadyCalls).toBe(0);
  });

  /** shell 根 Throw 已致命失败且仍有挂起边界，之后 abort(new Error)；错误回调仍只有最初 Error，验证失败后的重复取消不再报告任务错误。 */
  it('should not report aborts after the shell has fatally errored', async () => {
    const reportedErrors = [];
    const reportedShellErrors = [];
    const {abort} = ReactDOMFizzServer.renderToPipeableStream(
      <div>
        <Suspense fallback="Loading">
          <InfiniteSuspend />
        </Suspense>
        <Throw />
      </div>,
      {

        /** 保存初次根致命错误，供后来 abort 检查不会追加。 */
        onError(x) {
          reportedErrors.push(x);
        },

        /** 保存 shell 致命错误，确认后续取消不再调用。 */
        onShellError(x) {
          reportedShellErrors.push(x);
        },
      },
    );

    await jest.runAllTimers();

    expect(reportedErrors).toEqual([theError]);
    expect(reportedShellErrors).toEqual([theError]);

    abort(new Error('too late'));

    expect(reportedErrors).toEqual([theError]);
    expect(reportedShellErrors).toEqual([theError]);
  });

  /** 主内容永久挂起、fallback 自身抛 Error；shell 无法形成，writable 同错且空输出，onError/onShellError 均报告，验证 fallback 错误可使 shell 致命失败。 */
  it('should error the stream when an error is thrown inside a fallback', async () => {
    const reportedErrors = [];
    const reportedShellErrors = [];
    const {writable, output, completed} = getTestWritable();
    const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
      <div>
        <Suspense fallback={<Throw />}>
          <InfiniteSuspend />
        </Suspense>
      </div>,

      {

        /** 保存抛在 fallback 中的错误消息。 */
        onError(x) {
          reportedErrors.push(x.message);
        },

        /** 保存 fallback 导致的 shell 致命 Error 引用。 */
        onShellError(x) {
          reportedShellErrors.push(x);
        },
      },
    );
    pipe(writable);

    await completed;

    expect(output.error).toBe(theError);
    expect(output.result).toBe('');
    expect(reportedErrors).toEqual([theError.message]);
    expect(reportedShellErrors).toEqual([theError]);
  });

  /** Throw 在可用 Suspense fallback 内，pipe 正常结束并含 Loading；只 onError 报错、shellError 为空且 allReady 一次，验证边界降级客户端不会破坏整个流。 */
  it('should not error the stream when an error is thrown inside suspense boundary', async () => {
    const reportedErrors = [];
    const reportedShellErrors = [];
    let allReadyCalls = 0;
    const {writable, output, completed} = getTestWritable();
    const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
      <div>
        <Suspense fallback={<div>Loading</div>}>
          <Throw />
        </Suspense>
      </div>,
      {

        /** 记录 Suspense 主内容错误，验证边界失败仍会报告。 */
        onError(x) {
          reportedErrors.push(x);
        },

        /** 记录 shellError，有效 fallback 时该数组应保持为空。 */
        onShellError(x) {
          reportedShellErrors.push(x);
        },

        /** 记录任务结束次数；边界改为客户端渲染也可以达到 allReady。 */
        onAllReady() {
          allReadyCalls++;
        },
      },
    );
    pipe(writable);

    await completed;

    expect(output.error).toBe(undefined);
    expect(output.result).toContain('Loading');
    // 流本身不报告错误，但 callback 会收到该错误。
    expect(reportedErrors).toEqual([theError]);
    expect(reportedShellErrors).toEqual([]);
    // shell 仍然有效，边界改为客户端渲染且本次渲染已完成，因此 onAllReady 会触发；这是既定行为。
    expect(allReadyCalls).toBe(1);
  });

  /** 主内容同步返回 Hi，fallback 有执行标记；流含 Hi、不含 Loading且 fallback 从未执行，验证完成主路径不必准备 fallback。 */
  it('should not attempt to render the fallback if the main content completes first', async () => {
    const {writable, output, completed} = getTestWritable();

    let renderedFallback = false;

    /** 记录 fallback 是否执行，主路径同步完成时应保持 false。 */
    function Fallback() {
      renderedFallback = true;
      return 'Loading...';
    }

    /** 同步完成主内容 Hi，避免实际挂起。 */
    function Content() {
      return 'Hi';
    }
    const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
      <Suspense fallback={<Fallback />}>
        <Content />
      </Suspense>,
    );
    pipe(writable);

    await completed;

    expect(output.result).toContain('Hi');
    expect(output.result).not.toContain('Loading');
    expect(renderedFallback).toBe(false);
  });

  /** 已输出 Loading 的边界永久挂起，abort(uh oh) 后流正常完成；onError 收原因且 allReady 一次，验证取消边界任务可完成有效 shell。 */
  it('should be able to complete by aborting even if the promise never resolves', async () => {
    let isCompleteCalls = 0;
    const errors = [];
    const {writable, output, completed} = getTestWritable();
    let abort;
    await act(() => {
      const pipeable = ReactDOMFizzServer.renderToPipeableStream(
        <div>
          <Suspense fallback={<div>Loading</div>}>
            <InfiniteSuspend />
          </Suspense>
        </div>,
        {

          /** 记录取消边界任务的错误消息。 */
          onError(x) {
            errors.push(x.message);
          },

          /** 记录取消后有效 shell 的 allReady。 */
          onAllReady() {
            isCompleteCalls++;
          },
        },
      );
      pipeable.pipe(writable);
      abort = pipeable.abort;
    });

    expect(output.result).toContain('Loading');
    expect(isCompleteCalls).toBe(0);

    abort(new Error('uh oh'));
    await jest.runAllTimers();

    await completed;

    expect(errors).toEqual(['uh oh']);
    expect(output.error).toBe(undefined);
    expect(output.result).toContain('Loading');
    expect(isCompleteCalls).toBe(1);
  });

  /** 创建请求并 pipe 后、执行工作定时器前 abort(uh oh)；shell/error 回调报原因，writable 同错且无输出、allReady 零次，覆盖工作尚未开始的取消。 */
  it('should fail the shell if you abort before work has begun', async () => {
    let isCompleteCalls = 0;
    const errors = [];
    const shellErrors = [];
    const {writable, output, completed} = getTestWritable();
    const {pipe, abort} = ReactDOMFizzServer.renderToPipeableStream(
      <div>
        <Suspense fallback={<div>Loading</div>}>
          <InfiniteSuspend />
        </Suspense>
      </div>,
      {

        /** 记录工作开始前 abort 的原因消息。 */
        onError(x) {
          errors.push(x.message);
        },

        /** 记录取消导致的 shell 致命原因。 */
        onShellError(x) {
          shellErrors.push(x.message);
        },

        /** 记录 allReady；本例 shell 被取消失败，次数应为零。 */
        onAllReady() {
          isCompleteCalls++;
        },
      },
    );
    pipe(writable);

    // 现在我们延迟了工作,所以如果我们取消, 我们也会中止剩余的 CPU 工作。

    // 在执行渲染工作定时器之前 abort。
    const theReason = new Error('uh oh');
    abort(theReason);

    jest.runAllTimers();

    await completed;

    expect(errors).toEqual(['uh oh']);
    expect(shellErrors).toEqual(['uh oh']);
    expect(output.error).toBe(theReason);
    expect(output.result).toBe('');
    expect(isCompleteCalls).toBe(0);
  });

  /** 一个边界任务与两个根任务均 use 同一永不解决 promise；abort 后 onError 三次而 shellError 一次，验证任务级错误与 shell 致命回调不同计数。 */
  it('should report abort errors for every suspended task but fail the shell only once', async () => {
    const promise = new Promise(() => {});
    const rendered = [];

    /** 记录任务 label 并 use 永不解决 promise，制造边界及多个根挂起任务。 */
    function Suspend({label}) {
      rendered.push(label);
      React.use(promise);
      return null;
    }

    const errors = [];
    const shellErrors = [];
    const {abort} = ReactDOMFizzServer.renderToPipeableStream(
      <>
        <Suspense fallback="Loading...">
          <Suspend label="boundary" />
        </Suspense>
        <Suspend label="root one" />
        <Suspend label="root two" />
      </>,
      {

        /** 逐挂起任务记录 abort 消息，保留三次重复原因。 */
        onError(error) {
          errors.push(error.message);
        },

        /** 保存唯一 shellError，验证根失败回调不会按每个任务重复。 */
        onShellError(error) {
          shellErrors.push(error);
        },
      },
    );

    await jest.runAllTimers();
    expect(rendered).toEqual(['boundary', 'root one', 'root two']);

    const reason = new Error('abort reason');
    abort(reason);
    await jest.runAllTimers();

    expect(shellErrors).toEqual([reason]);
    expect(errors).toEqual(['abort reason', 'abort reason', 'abort reason']);
  });

  /** 内层主内容与其 fallback 都永久挂起，外层已有 Loading；无原因 abort 后报告两个任务默认错误，流无 destination 错误且 allReady 一次。 */
  it('should be able to complete by abort when the fallback is also suspended', async () => {
    let isCompleteCalls = 0;
    const errors = [];
    const {writable, output, completed} = getTestWritable();
    let abort;
    await act(() => {
      const pipeable = ReactDOMFizzServer.renderToPipeableStream(
        <div>
          <Suspense fallback="Loading">
            <Suspense fallback={<InfiniteSuspend />}>
              <InfiniteSuspend />
            </Suspense>
          </Suspense>
        </div>,
        {

          /** 记录内层主/fallback 两个任务取消时的默认原因。 */
          onError(x) {
            errors.push(x.message);
          },

          /** 记录外层有效 shell 完成，即使内部被取消。 */
          onAllReady() {
            isCompleteCalls++;
          },
        },
      );
      pipeable.pipe(writable);
      abort = pipeable.abort;
    });

    expect(output.result).toContain('Loading');
    expect(isCompleteCalls).toBe(0);

    abort();
    await jest.runAllTimers();

    await completed;

    expect(errors).toEqual([
      // 主内容和挂起 fallback 两个任务分别报告默认取消原因。
      'The render was aborted by the server without a reason.',
      'The render was aborted by the server without a reason.',
    ]);
    expect(output.error).toBe(undefined);
    expect(output.result).toContain('Loading');
    expect(isCompleteCalls).toBe(1);
  });

  /** Provider 中 Component 从 DelayClient 读 pending promise，500ms 后重试得到 OK；先输出 loading 后含 OK且无流错误，验证恢复任务能读取 Provider 值。 */
  it('should be able to get context value when promise resolves', async () => {

    /** 将一次定时延迟包装为可抛 promise 的读取客户端，保留 pending/resolved 状态供重试。 */
    class DelayClient {

      /** 已有 resolved 返回 OK，已有 pending 复用 promise；首次读创建 500ms 定时器，清 pending、设 resolved 后解决 promise，使重试读到字符串。 */
      get() {
        if (this.resolved) return this.resolved;
        if (this.pending) return this.pending;
        return (this.pending = new Promise(resolve => {
          setTimeout(() => {
            delete this.pending;
            this.resolved = 'OK';
            resolve();
          }, 500);
        }));
      }
    }

    const DelayContext = React.createContext(undefined);

    /** 读取 Provider 的 DelayClient；缺失时返回固定提示，pending 时抛 promise、完成时返回 OK。 */
    const Component = () => {
      const client = React.useContext(DelayContext);
      if (!client) {
        return 'context not found.';
      }
      const result = client.get();
      if (typeof result === 'string') {
        return result;
      }
      throw result;
    };

    const client = new DelayClient();
    const {writable, output, completed} = getTestWritable();
    await act(() => {
      ReactDOMFizzServer.renderToPipeableStream(
        <DelayContext.Provider value={client}>
          <div>
            <Suspense fallback="loading">
              <Component />
            </Suspense>
          </div>
        </DelayContext.Provider>,
      ).pipe(writable);
    });

    expect(output.error).toBe(undefined);
    expect(output.result).toContain('loading');

    await completed;

    expect(output.error).toBe(undefined);
    expect(output.result).not.toContain('context never found');
    expect(output.result).toContain('OK');
  });

  /** 同时启动两请求，各自 Provider 使用独立 DelayClient；两流先 loading 后各有 OK且无 context 缺失，验证并行请求恢复的 context 隔离。 */
  it('should be able to get context value when calls renderToPipeableStream twice at the same time', async () => {

    /** 为每个并行请求创建独立延迟状态，检验上下文恢复隔离。 */
    class DelayClient {

      /** 缓存首次 pending promise，500ms 后设 resolved 再解决；以后读取复用完成值。 */
      get() {
        if (this.resolved) return this.resolved;
        if (this.pending) return this.pending;
        return (this.pending = new Promise(resolve => {
          setTimeout(() => {
            delete this.pending;
            this.resolved = 'OK';
            resolve();
          }, 500);
        }));
      }
    }
    const DelayContext = React.createContext(undefined);

    /** 从当前请求 Provider 读取 client，抛 pending 或返回 OK，缺失时返回 context never found。 */
    const Component = () => {
      const client = React.useContext(DelayContext);
      if (!client) {
        return 'context never found';
      }
      const result = client.get();
      if (typeof result === 'string') {
        return result;
      }
      throw result;
    };

    const client0 = new DelayClient();
    const {
      writable: writable0,
      output: output0,
      completed: completed0,
    } = getTestWritable();
    const client1 = new DelayClient();
    const {
      writable: writable1,
      output: output1,
      completed: completed1,
    } = getTestWritable();
    await act(() => {
      ReactDOMFizzServer.renderToPipeableStream(
        <DelayContext.Provider value={client0}>
          <div>
            <Suspense fallback="loading">
              <Component />
            </Suspense>
          </div>
        </DelayContext.Provider>,
      ).pipe(writable0);
      ReactDOMFizzServer.renderToPipeableStream(
        <DelayContext.Provider value={client1}>
          <div>
            <Suspense fallback="loading">
              <Component />
            </Suspense>
          </div>
        </DelayContext.Provider>,
      ).pipe(writable1);
    });

    expect(output0.error).toBe(undefined);
    expect(output0.result).toContain('loading');

    expect(output1.error).toBe(undefined);
    expect(output1.result).toContain('loading');

    await Promise.all([completed0, completed1]);

    expect(output0.error).toBe(undefined);
    expect(output0.result).not.toContain('context never found');
    expect(output0.result).toContain('OK');

    expect(output1.error).toBe(undefined);
    expect(output1.result).not.toContain('context never found');
    expect(output1.result).toContain('OK');
  });

  /** 两个兄弟 Provider 使用同一 DelayClient，均挂起后恢复为 OK；流无错误，覆盖挂起时弹出上下文及恢复时重装各自 Provider。 */
  it('should be able to pop context after suspending', async () => {

    /** 为两个兄弟 Provider 共享同一 pending/resolved 缓存，覆盖弹出并恢复上下文。 */
    class DelayClient {

      /** 复用 pending promise，定时清理 pending 并保存 OK，再唤醒重试任务。 */
      get() {
        if (this.resolved) return this.resolved;
        if (this.pending) return this.pending;
        return (this.pending = new Promise(resolve => {
          setTimeout(() => {
            delete this.pending;
            this.resolved = 'OK';
            resolve();
          }, 500);
        }));
      }
    }

    const DelayContext = React.createContext(undefined);

    /** 读取当前 Provider 共享 client，挂起时抛 promise、完成时输出 OK。 */
    const Component = () => {
      const client = React.useContext(DelayContext);
      if (!client) {
        return 'context not found.';
      }
      const result = client.get();
      if (typeof result === 'string') {
        return result;
      }
      throw result;
    };

    const client = new DelayClient();
    const {writable, output, completed} = getTestWritable();
    await act(() => {
      ReactDOMFizzServer.renderToPipeableStream(
        <div>
          <DelayContext.Provider value={client}>
            <Suspense fallback="loading">
              <Component />
            </Suspense>
          </DelayContext.Provider>
          <DelayContext.Provider value={client}>
            <Suspense fallback="loading">
              <Component />
            </Suspense>
          </DelayContext.Provider>
        </div>,
      ).pipe(writable);
    });

    expect(output.error).toBe(undefined);
    expect(output.result).toContain('loading');

    await completed;

    expect(output.error).toBe(undefined);
    expect(output.result).not.toContain('context never found');
    expect(output.result).toContain('OK');
  });

  /** 挂起请求的 writable 提前 end，随后解决 promise；记录 destination 写错误，Wait 不再执行成功分支但 allReady 到达，验证断流取消任务而非继续渲染。 */
  it('should not continue rendering after the writable ends unexpectedly', async () => {
    let hasLoaded = false;
    let resolve;
    let isComplete = false;
    let rendered = false;
    const promise = new Promise(r => (resolve = r));

    /** pending 时抛 promise，完成分支设置 rendered；destination 取消后即使 promise 解决也不应到达该分支。 */
    function Wait({prop}) {
      if (!hasLoaded) {
        throw promise;
      }
      rendered = true;
      return 'Done';
    }
    const errors = [];
    const {writable, completed} = getTestWritable();
    const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
      <div>
        <Suspense fallback={<div>Loading</div>}>
          <Wait />
        </Suspense>
      </div>,
      {

        /** 记录写入已结束 destination 的错误消息。 */
        onError(x) {
          errors.push(x.message);
        },

        /** 标记被取消任务全部结束；allReady 不表示 Wait 成功渲染。 */
        onAllReady() {
          isComplete = true;
        },
      },
    );
    pipe(writable);

    expect(rendered).toBe(false);
    expect(isComplete).toBe(false);

    writable.end();

    await jest.runAllTimers();

    hasLoaded = true;
    resolve();

    await completed;
    await jest.runAllTimers();

    expect(errors).toEqual([
      'The destination stream errored while writing data.',
    ]);
    expect(rendered).toBe(false);
    expect(isComplete).toBe(true);
  });

  /** 输出 700 个三字符日文文本片段，UTF8 流结果与带文本分隔注释的串精确相等且无 NUL；回归检查多字节缓冲写出不产生零填充。 */
  it('should encode multibyte characters correctly without nulls (#24985)', async () => {
    const {writable, output} = getTestWritable();
    await act(() => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <div>{Array(700).fill('ののの')}</div>,
      );
      pipe(writable);
    });
    expect(output.result.indexOf('\u0000')).toBe(-1);
    expect(output.result).toEqual(
      '<div>' + Array(700).fill('ののの').join('<!-- -->') + '</div>',
    );
  });
});
