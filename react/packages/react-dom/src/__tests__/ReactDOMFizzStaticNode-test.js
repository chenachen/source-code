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

let React;
let ReactDOMFizzStatic;
let Suspense;

/** 把栈行at/in统一为in、去函数名前缀与源码位置，含数字位置时用at **，稳定组件/owner栈快照。 */
function normalizeCodeLocInfo(str) {
  return (
    str &&
    str.replace(/^ +(?:at|in) ([\S]+)[^\n]*/gm, function (m, name) {
      const dot = name.lastIndexOf('.');
      if (dot !== -1) {
        name = name.slice(dot + 1);
      }
      return '    in ' + name + (/\d/.test(m) ? ' (at **)' : '');
    })
  );
}

/** 只保留含本文件__filename的owner栈行，用于移除库栈；空输入原样返回。 */
function ignoreListStack(str) {
  if (!str) {
    return str;
  }

  let ignoreListedStack = '';
  const lines = str.split('\n');
  // eslint-disable-next-line no-for-of-loops/no-for-of-loops
  for (const line of lines) {
    if (line.indexOf(__filename) !== -1) {
      ignoreListedStack += '\n' + line;
    }
  }
  return ignoreListedStack;
}

describe('ReactDOMFizzStaticNode', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMFizzStatic = require('react-dom/static');
    Suspense = React.Suspense;
  });

  const theError = new Error('This is an error');

  /** 抛同一theError对象，供检查错误身份和单次报告。 */
  function Throw() {
    throw theError;
  }
  const theInfinitePromise = new Promise(() => {});

  /** 抛永不解决的共享Promise，让静态任务只能通过取消结束。 */
  function InfiniteSuspend() {
    throw theInfinitePromise;
  }

  /** 订阅Node流data拼UTF8，error拒绝，end返回全部文字；单Chunk独立Buffer解码，不实现跨Chunk增量Decoder。 */
  function readContent(readable) {
    return new Promise((resolve, reject) => {
      let content = '';
      readable.on('data', chunk => {
        content += Buffer.from(chunk).toString('utf8');
      });
      readable.on('error', error => {
        reject(error);
      });
      readable.on('end', () => resolve(content));
    });
  }

  /** getReader串行读Web流直到done并逐块UTF8拼接；read拒绝自然向上，未releaseLock或主动取消。 */
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

  /** Node静态入口prerenderToNodeStream渲染div/hello world；完整读Node prelude后快照相同HTML，验证公开入口返回可消费Readable。 */
  it('should call prerenderToNodeStream', async () => {
    const result = await ReactDOMFizzStatic.prerenderToNodeStream(
      <div>hello world</div>,
    );
    const prelude = await readContent(result.prelude);
    expect(prelude).toMatchInlineSnapshot(`"<div>hello world</div>"`);
  });

  /** Node环境的prerender Web入口渲染同div；用getReader读到done后HTML快照相同，验证Node也暴露Web流桥接。 */
  it('should suppport web streams', async () => {
    const result = await ReactDOMFizzStatic.prerender(<div>hello world</div>);
    const prelude = await readContentWeb(result.prelude);
    expect(prelude).toMatchInlineSnapshot(`"<div>hello world</div>"`);
  });

  /** 静态完整html/body文档；prelude有DOCTYPE及补head，blocking-render开关另加expect link与_R_ template，验证文档前导/闭合和构建差异。 */
  it('should emit DOCTYPE at the root of the document', async () => {
    const result = await ReactDOMFizzStatic.prerenderToNodeStream(
      <html>
        <body>hello world</body>
      </html>,
    );
    const prelude = await readContent(result.prelude);
    if (gate(flags => flags.enableFizzBlockingRender)) {
      expect(prelude).toMatchInlineSnapshot(
        `"<!DOCTYPE html><html><head><link rel="expect" href="#_R_" blocking="render"/></head><body>hello world<template id="_R_"></template></body></html>"`,
      );
    } else {
      expect(prelude).toMatchInlineSnapshot(
        `"<!DOCTYPE html><html><head></head><body>hello world</body></html>"`,
      );
    }
  });

  /** 静态div带内联bootstrap、经典init.js与模块init.mjs；快照先两种preload，再div、内联INIT、两async脚本，验证bootstrap前导提示与末尾执行标签顺序。 */
  it('should emit bootstrap script src at the end', async () => {
    const result = await ReactDOMFizzStatic.prerenderToNodeStream(
      <div>hello world</div>,
      {
        bootstrapScriptContent: 'INIT();',
        bootstrapScripts: ['init.js'],
        bootstrapModules: ['init.mjs'],
      },
    );
    const prelude = await readContent(result.prelude);
    expect(prelude).toMatchInlineSnapshot(
      `"<link rel="preload" as="script" fetchPriority="low" href="init.js"/><link rel="modulepreload" fetchPriority="low" href="init.mjs"/><div>hello world</div><script id="_R_">INIT();</script><script src="init.js" async=""></script><script type="module" src="init.mjs" async=""></script>"`,
    );
  });

  /** Wait首次挂起，先跑定时器再置hasLoaded并resolve；静态结果完整读只含Done边界、无Loading，验证等待全体内容后一次提供prelude，不在未完成时发shell。 */
  it('emits all HTML as one unit', async () => {
    let hasLoaded = false;
    let resolve;
    const promise = new Promise(r => (resolve = r));

    /** 未hasLoaded就抛本例Promise，置true后返回Done，控制静态all-ready时点。 */
    function Wait() {
      if (!hasLoaded) {
        throw promise;
      }
      return 'Done';
    }
    const resultPromise = ReactDOMFizzStatic.prerenderToNodeStream(
      <div>
        <Suspense fallback="Loading">
          <Wait />
        </Suspense>
      </div>,
    );

    await jest.runAllTimers();

    // 解除加载阻塞。
    hasLoaded = true;
    await resolve();

    const result = await resultPromise;
    const prelude = await readContent(result.prelude);
    expect(prelude).toMatchInlineSnapshot(`"<div><!--$-->Done<!--/$--></div>"`);
  });

  /** 根div子Throw抛共享theError且无Suspense；外Promise拒绝同对象、onError同对象一次，验证根致命错误。 */
  it('should reject the promise when an error is thrown at the root', async () => {
    const reportedErrors = [];
    let caughtError = null;
    try {
      await ReactDOMFizzStatic.prerenderToNodeStream(
        <div>
          <Throw />
        </div>,
        {

          /** 收集根致命错误原对象，外Promise也应拒绝同对象。 */
          onError(x) {
            reportedErrors.push(x);
          },
        },
      );
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBe(theError);
    expect(reportedErrors).toEqual([theError]);
  });

  /** Suspense内容永远挂起但fallback Throw；外Promise拒绝theError且onError一次，验证shell fallback自身失败也是致命错误。 */
  it('should reject the promise when an error is thrown inside a fallback', async () => {
    const reportedErrors = [];
    let caughtError = null;
    try {
      await ReactDOMFizzStatic.prerenderToNodeStream(
        <div>
          <Suspense fallback={<Throw />}>
            <InfiniteSuspend />
          </Suspense>
        </div>,
        {

          /** 收集fallback致命错误原对象，确认不是内容永久挂起本身。 */
          onError(x) {
            reportedErrors.push(x);
          },
        },
      );
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBe(theError);
    expect(reportedErrors).toEqual([theError]);
  });

  /** Suspense内容Throw、fallback Loading成功；静态Promise成功且prelude可读含Loading，onError一次，验证边界内失败转fallback不破坏流。 */
  it('should not error the stream when an error is thrown inside suspense boundary', async () => {
    const reportedErrors = [];
    const result = await ReactDOMFizzStatic.prerenderToNodeStream(
      <div>
        <Suspense fallback={<div>Loading</div>}>
          <Throw />
        </Suspense>
      </div>,
      {

        /** 记录边界内容错误原对象，不抛新错，静态结果仍可用fallback。 */
        onError(x) {
          reportedErrors.push(x);
        },
      },
    );

    const prelude = await readContent(result.prelude);
    expect(prelude).toContain('Loading');
    expect(reportedErrors).toEqual([theError]);
  });

  /** 完成shell的Suspense永久等待，默认AbortController.abort后结果成功含Loading，错误message为默认abort原因，验证取消剩余任务可完成静态结果。 */
  it('should be able to complete by aborting even if the promise never resolves', async () => {
    const errors = [];
    const controller = new AbortController();
    const resultPromise = ReactDOMFizzStatic.prerenderToNodeStream(
      <div>
        <Suspense fallback={<div>Loading</div>}>
          <InfiniteSuspend />
        </Suspense>
      </div>,
      {
        signal: controller.signal,

        /** 提取默认abort错误message，每未完成任务报告一次。 */
        onError(x) {
          errors.push(x.message);
        },
      },
    );

    await jest.runAllTimers();

    controller.abort();
    await jest.runAllTimers();

    const result = await resultPromise;

    const prelude = await readContent(result.prelude);
    expect(prelude).toContain('Loading');

    expect(errors).toEqual(['This operation was aborted']);
  });

  /** 根永久挂起且无Suspense shell，abort自定义Error；Promise成功、prelude空且报告原因，验证静态halt允许无完整shell时返回空结果。 */
  it('should resolve an empty shell if aborting before the shell is complete', async () => {
    const errors = [];
    const controller = new AbortController();
    const promise = ReactDOMFizzStatic.prerenderToNodeStream(
      <div>
        <InfiniteSuspend />
      </div>,
      {
        signal: controller.signal,

        /** 记录根shell未完成的自定义取消message，结果允许空prelude。 */
        onError(x) {
          errors.push(x.message);
        },
      },
    );

    await jest.runAllTimers();

    const theReason = new Error('aborted for reasons');
    controller.abort(theReason);
    await jest.runAllTimers();

    let didThrow = false;
    let prelude;
    try {
      ({prelude} = await promise);
    } catch (error) {
      didThrow = true;
    }
    expect(didThrow).toBe(false);
    expect(errors).toEqual(['aborted for reasons']);
    const content = await readContent(prelude);
    expect(content).toBe('');
  });

  /** App在返回Suspense之前abort()；结果空、默认原因一次，验证渲染期间取消截断后续挂起内容。 */
  it('should be able to abort before something suspends', async () => {
    const errors = [];
    const controller = new AbortController();

    /** 先同步abort再返回含永久挂起内容的Suspense，测试取消早于实际读Promise。 */
    function App() {
      controller.abort();
      return (
        <Suspense fallback={<div>Loading</div>}>
          <InfiniteSuspend />
        </Suspense>
      );
    }
    const streamPromise = ReactDOMFizzStatic.prerenderToNodeStream(
      <div>
        <App />
      </div>,
      {
        signal: controller.signal,

        /** 记录渲染中默认abort原因，结果不继续建shell。 */
        onError(x) {
          errors.push(x.message);
        },
      },
    );

    await jest.runAllTimers();
    const {prelude} = await streamPromise;
    const content = await readContent(prelude);
    expect(errors).toEqual(['This operation was aborted']);
    expect(content).toBe('');
  });

  /** App先abort(Error reason)再use永不完成Promise；报告原abort reason且空prelude，验证同任务取消后挂起不能覆盖原因。 */
  it('reports the abort reason if a task suspends after aborting a prerender', async () => {
    const promise = new Promise(() => {});
    const errors = [];
    const controller = new AbortController();

    /** 先abort自定义Error再use永久Promise，同任务挂起不能换掉取消原因。 */
    function App() {
      controller.abort(new Error('abort reason'));
      React.use(promise);
      return null;
    }

    const resultPromise = ReactDOMFizzStatic.prerenderToNodeStream(<App />, {
      signal: controller.signal,

      /** 保存同任务取消报告的message。 */
      onError(error) {
        errors.push(error.message);
      },
    });

    await jest.runAllTimers();
    const result = await resultPromise;

    expect(errors).toEqual(['abort reason']);
    expect(await readContent(result.prelude)).toBe('');
  });

  /** 调用前signal已abort(Error)；即使有可用fallback仍结果成功为空，错误保留自定义原因，验证已取消请求不继续CPU构建shell。 */
  it('should resolve with an empty prelude if passing an already aborted signal', async () => {
    const errors = [];
    const controller = new AbortController();
    const theReason = new Error('aborted for reasons');
    controller.abort(theReason);

    const promise = ReactDOMFizzStatic.prerenderToNodeStream(
      <div>
        <Suspense fallback={<div>Loading</div>}>
          <InfiniteSuspend />
        </Suspense>
      </div>,
      {
        signal: controller.signal,

        /** 保存调用前已取消signal的原因，检查空结果而非抛拒绝。 */
        onError(x) {
          errors.push(x.message);
        },
      },
    );

    // 技术上仍可继续渲染 shell，但当前语义还会中止所有待处理的 CPU 工作。
    await jest.runAllTimers();

    let didThrow = false;
    let prelude;
    try {
      ({prelude} = await promise);
    } catch (error) {
      didThrow = true;
    }
    expect(didThrow).toBe(false);
    expect(errors).toEqual(['aborted for reasons']);
    const content = await readContent(prelude);
    expect(content).toBe('');
  });

  /** 两个Suspense分别永久Wait，signal.abort字符串foobar；onError原字符串两次且结果成功，验证每个未完成任务保留非Error取消原因，未检查prelude内容。 */
  it('supports custom abort reasons with a string', async () => {
    const promise = new Promise(r => {});

    /** 两个边界共用Wait，各自抛同一个永久Promise。 */
    function Wait() {
      throw promise;
    }

    /** 用p/span两个独立Suspense包Wait，取消应报告两份任务原因。 */
    function App() {
      return (
        <div>
          <p>
            <Suspense fallback={'p'}>
              <Wait />
            </Suspense>
          </p>
          <span>
            <Suspense fallback={'span'}>
              <Wait />
            </Suspense>
          </span>
        </div>
      );
    }

    const errors = [];
    const controller = new AbortController();
    const resultPromise = ReactDOMFizzStatic.prerenderToNodeStream(<App />, {
      signal: controller.signal,

      /** 保存原字符串取消值并返回digest；本例只断言报告值，不读取digest标记。 */
      onError(x) {
        errors.push(x);
        return 'a digest';
      },
    });

    await jest.runAllTimers();

    controller.abort('foobar');
    await jest.runAllTimers();

    await resultPromise;

    expect(errors).toEqual(['foobar', 'foobar']);
  });

  /** 同两边界，但abort Error uh oh；onError提取message两次，验证Error原因按任务分别报告。 */
  it('supports custom abort reasons with an Error', async () => {
    const promise = new Promise(r => {});

    /** Error取消场景的永久挂起Wait，两个边界共享同Promise。 */
    function Wait() {
      throw promise;
    }

    /** 构造两独立边界以比较Error原因分别上报。 */
    function App() {
      return (
        <div>
          <p>
            <Suspense fallback={'p'}>
              <Wait />
            </Suspense>
          </p>
          <span>
            <Suspense fallback={'span'}>
              <Wait />
            </Suspense>
          </span>
        </div>
      );
    }

    const errors = [];
    const controller = new AbortController();
    const resultPromise = ReactDOMFizzStatic.prerenderToNodeStream(<App />, {
      signal: controller.signal,

      /** 记录取消Error.message并返回digest，确保原Error不被替换成默认原因。 */
      onError(x) {
        errors.push(x.message);
        return 'a digest';
      },
    });

    await jest.runAllTimers();

    controller.abort(new Error('uh oh'));
    await jest.runAllTimers();

    await resultPromise;

    expect(errors).toEqual(['uh oh', 'uh oh']);
  });

  /** 两边界use rejectedPromise/haltedPromise，abort监听同时reject前者；最终错误顺序rejected during abort、abort reason，验证已拒绝任务采用自身原因而未完成另一任务采用取消原因。 */
  it('uses a rejection reason when an abort listener rejects pending work before the abort finishes', async () => {
    let reject;
    const rejectedPromise = new Promise((resolve, rejectPromise) => {
      reject = rejectPromise;
    });
    const haltedPromise = new Promise(() => {});

    /** use可被abort监听reject的Promise，最终采用自身拒绝原因。 */
    function RejectedWait() {
      React.use(rejectedPromise);
      return null;
    }

    /** use仍永久pending的Promise，最终采用abort原因。 */
    function HaltedWait() {
      React.use(haltedPromise);
      return null;
    }

    const errors = [];
    const controller = new AbortController();
    const resultPromise = ReactDOMFizzStatic.prerenderToNodeStream(
      <>
        <Suspense fallback="Loading rejected">
          <RejectedWait />
        </Suspense>
        <Suspense fallback="Loading halted">
          <HaltedWait />
        </Suspense>
      </>,
      {
        signal: controller.signal,

        /** 按到达顺序保存两种错误message，不统一重写原因。 */
        onError(error) {
          errors.push(error.message);
        },
      },
    );

    await jest.runAllTimers();

    controller.signal.addEventListener('abort', () => {
      reject(new Error('rejected during abort'));
    });
    controller.abort(new Error('abort reason'));

    await Promise.resolve();
    await jest.runAllTimers();
    await resultPromise;

    expect(errors).toEqual(['rejected during abort', 'abort reason']);
  });

  describe('with real timers', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    afterEach(() => {
      jest.useFakeTimers();
    });

    /** 真定时器下AbortAndSuspend同任务abort后use永久Promise；错误reason与空prelude正确，DEV组件栈含挂起调用点/App，ownerStack受asyncDebug开关影响、PROD为null，验证取消挂起诊断位置。 */
    it('includes the suspended call site when aborting in the same rendering task', async () => {
      const promise = new Promise(() => {});
      const controller = new AbortController();
      let caughtError;
      let componentStack;
      let ownerStack;

      /** 在同一个render任务先abort再use挂起，诊断栈应指向此调用site。 */
      function AbortAndSuspend() {
        controller.abort(new Error('abort reason'));
        React.use(promise);
        return null;
      }

      /** 返回AbortAndSuspend，为组件/owner栈提供上层App。 */
      function App() {
        return <AbortAndSuspend />;
      }

      const {prelude} = await ReactDOMFizzStatic.prerenderToNodeStream(
        <App />,
        {
          signal: controller.signal,

          /** 保存原错误、errorInfo.componentStack及DEV captureOwnerStack，PROD明确null；回调不恢复渲染。 */
          onError(error, errorInfo) {
            caughtError = error;
            componentStack = errorInfo.componentStack;
            ownerStack = __DEV__ ? React.captureOwnerStack() : null;
          },
        },
      );

      expect(caughtError).toEqual(
        expect.objectContaining({message: 'abort reason'}),
      );
      expect(await readContent(prelude)).toBe('');
      if (__DEV__) {
        expect(normalizeCodeLocInfo(componentStack)).toBe(
          '\n    in AbortAndSuspend (at **)\n    in App',
        );
        expect(normalizeCodeLocInfo(ignoreListStack(ownerStack))).toBe(
          (gate(flags => flags.enableAsyncDebugInfo)
            ? '\n    in AbortAndSuspend (at **)'
            : '') + '\n    in App (at **)',
        );
      } else {
        expect(ownerStack).toBeNull();
      }
    });
  });
});
