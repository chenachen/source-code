/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

import {patchMessageChannel} from '../../../../scripts/jest/patchMessageChannel';

// 测试环境的补丁
global.ReadableStream =
  require('web-streams-polyfill/ponyfill/es6').ReadableStream;
global.TextEncoder = require('util').TextEncoder;

let React;
let ReactDOMFizzServer;
let Suspense;
let serverAct;

describe('ReactDOMFizzServerBrowser', () => {
  beforeEach(() => {
    jest.resetModules();

    patchMessageChannel();
    serverAct = require('internal-test-utils').serverAct;

    React = require('react');
    ReactDOMFizzServer = require('react-dom/server.browser');
    Suspense = React.Suspense;
  });

  const theError = new Error('This is an error');

  /** 抛同一theError对象，比较外Promise和onError身份。 */
  function Throw() {
    throw theError;
  }
  const theInfinitePromise = new Promise(() => {});

  /** 抛永不完成Promise，使边界只能通过取消收尾。 */
  function InfiniteSuspend() {
    throw theInfinitePromise;
  }

  /** 用Web reader串行读到done，逐块Buffer转UTF8并拼字串；读失败自然拒绝，未releaseLock/取消或做跨块增量解码。 */
  async function readResult(stream) {
    const reader = stream.getReader();
    let result = '';
    while (true) {
      const {done, value} = await reader.read();
      if (done) {
        return result;
      }
      result += Buffer.from(value).toString('utf8');
    }
  }

  /** 浏览器入口renderToReadableStream渲染hello div，serverAct后读到done快照相同，验证公开Web流入口。 */
  it('should call renderToReadableStream', async () => {
    const stream = await serverAct(() =>
      ReactDOMFizzServer.renderToReadableStream(<div>hello world</div>),
    );
    const result = await readResult(stream);
    expect(result).toMatchInlineSnapshot(`"<div>hello world</div>"`);
  });

  /** 完整html/body文档；DOCTYPE及补head固定，blocking-render开时另有expect link/_R_模板，验证文档协议构建差异。 */
  it('should emit DOCTYPE at the root of the document', async () => {
    const stream = await serverAct(() =>
      ReactDOMFizzServer.renderToReadableStream(
        <html>
          <body>hello world</body>
        </html>,
      ),
    );
    const result = await readResult(stream);
    if (gate(flags => flags.enableFizzBlockingRender)) {
      expect(result).toMatchInlineSnapshot(
        `"<!DOCTYPE html><html><head><link rel="expect" href="#_R_" blocking="render"/></head><body>hello world<template id="_R_"></template></body></html>"`,
      );
    } else {
      expect(result).toMatchInlineSnapshot(
        `"<!DOCTYPE html><html><head></head><body>hello world</body></html>"`,
      );
    }
  });

  /** div加内联/经典/模块bootstrap；快照顺序preload/modulepreload→div→INIT script→两async脚本，验证提示与执行标签位置。 */
  it('should emit bootstrap script src at the end', async () => {
    const stream = await serverAct(() =>
      ReactDOMFizzServer.renderToReadableStream(<div>hello world</div>, {
        bootstrapScriptContent: 'INIT();',
        bootstrapScripts: ['init.js'],
        bootstrapModules: ['init.mjs'],
      }),
    );
    const result = await readResult(stream);
    expect(result).toMatchInlineSnapshot(
      `"<link rel="preload" as="script" fetchPriority="low" href="init.js"/><link rel="modulepreload" fetchPriority="low" href="init.mjs"/><div>hello world</div><script id="_R_">INIT();</script><script src="init.js" async=""></script><script type="module" src="init.mjs" async=""></script>"`,
    );
  });

  /** Wait首次挂起，stream返回时allReady未完成；resolve后allReady完成才开始读，输出完整Done无Loading，验证延迟消费可避免fallback流，而allReady本身不表示已消费字节。 */
  it('emits all HTML as one unit if we wait until the end to start', async () => {
    let hasLoaded = false;
    let resolve;
    const promise = new Promise(r => (resolve = r));

    /** hasLoaded前抛本例Promise，resolve后返回Done；allReady观察任务完成而非字节消费。 */
    function Wait() {
      if (!hasLoaded) {
        throw promise;
      }
      return 'Done';
    }
    let isComplete = false;
    const stream = await serverAct(() =>
      ReactDOMFizzServer.renderToReadableStream(
        <div>
          <Suspense fallback="Loading">
            <Wait />
          </Suspense>
        </div>,
      ),
    );

    stream.allReady.then(() => (isComplete = true));

    expect(isComplete).toBe(false);
    // 解除加载阻塞。
    hasLoaded = true;
    await serverAct(() => resolve());

    expect(isComplete).toBe(true);

    const result = await readResult(stream);
    expect(result).toMatchInlineSnapshot(
      `"<div><!--$-->Done<!-- --><!--/$--></div>"`,
    );
  });

  /** 根Throw且无边界；外Promise拒绝共享theError，onError同对象一次，验证shell建立前致命错误。 */
  it('should reject the promise when an error is thrown at the root', async () => {
    const reportedErrors = [];
    let caughtError = null;
    try {
      await serverAct(() =>
        ReactDOMFizzServer.renderToReadableStream(
          <div>
            <Throw />
          </div>,
          {

            /** 收集根致命Error原对象，不自行捕获恢复。 */
            onError(x) {
              reportedErrors.push(x);
            },
          },
        ),
      );
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBe(theError);
    expect(reportedErrors).toEqual([theError]);
  });

  /** 内容永久挂起、fallback Throw；外Promise拒绝theError且报告一次，验证fallback失败不能建立shell。 */
  it('should reject the promise when an error is thrown inside a fallback', async () => {
    const reportedErrors = [];
    let caughtError = null;
    try {
      await serverAct(() =>
        ReactDOMFizzServer.renderToReadableStream(
          <div>
            <Suspense fallback={<Throw />}>
              <InfiniteSuspend />
            </Suspense>
          </div>,
          {

            /** 收集fallback致命Error，外Promise应拒绝同对象。 */
            onError(x) {
              reportedErrors.push(x);
            },
          },
        ),
      );
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBe(theError);
    expect(reportedErrors).toEqual([theError]);
  });

  /** 边界内容Throw、fallback Loading正常；Web流可读含Loading、onError一次，验证可恢复边界错误不终止整个流。 */
  it('should not error the stream when an error is thrown inside suspense boundary', async () => {
    const reportedErrors = [];
    const stream = await serverAct(() =>
      ReactDOMFizzServer.renderToReadableStream(
        <div>
          <Suspense fallback={<div>Loading</div>}>
            <Throw />
          </Suspense>
        </div>,
        {

          /** 记录边界内错误而保留fallback流，区分致命根失败。 */
          onError(x) {
            reportedErrors.push(x);
          },
        },
      ),
    );

    const result = await readResult(stream);
    expect(result).toContain('Loading');
    expect(reportedErrors).toEqual([theError]);
  });

  /** 正常shell中的边界永远挂起，默认signal.abort后流可读Loading，报告默认浏览器取消message，验证取消未完成边界仍能结束现有shell。 */
  it('should be able to complete by aborting even if the promise never resolves', async () => {
    const errors = [];
    const controller = new AbortController();
    const stream = await serverAct(() =>
      ReactDOMFizzServer.renderToReadableStream(
        <div>
          <Suspense fallback={<div>Loading</div>}>
            <InfiniteSuspend />
          </Suspense>
        </div>,
        {
          signal: controller.signal,

          /** 提取默认AbortSignal原因message，边界shell仍可读完。 */
          onError(x) {
            errors.push(x.message);
          },
        },
      ),
    );

    await serverAct(() => {
      controller.abort();
    });

    const result = await readResult(stream);
    expect(result).toContain('Loading');

    expect(errors).toEqual(['The operation was aborted.']);
  });

  /** 根永久挂起、无shell；自定义Error abort后外Promise拒绝同对象并报告message，验证动态流与静态空prelude取消语义区别。 */
  it('should reject if aborting before the shell is complete', async () => {
    const errors = [];
    const controller = new AbortController();
    const promise = serverAct(() =>
      ReactDOMFizzServer.renderToReadableStream(
        <div>
          <InfiniteSuspend />
        </div>,
        {
          signal: controller.signal,

          /** 记录shell完成前自定义取消message，外Promise也以该Error拒绝。 */
          onError(x) {
            errors.push(x.message);
          },
        },
      ),
    );

    const theReason = new Error('aborted for reasons');
    await serverAct(() => {
      controller.abort(theReason);
    });

    let caughtError = null;
    try {
      await promise;
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBe(theReason);
    expect(errors).toEqual(['aborted for reasons']);
  });

  /** App渲染期间先abort再返回含挂起边界；外Promise拒绝默认取消message且仅一次报告，验证建shell前取消。 */
  it('should be able to abort before something suspends', async () => {
    const errors = [];
    const controller = new AbortController();

    /** 渲染中立即abort，再返回挂起子树，测试取消早于建立shell。 */
    function App() {
      controller.abort();
      return (
        <Suspense fallback={<div>Loading</div>}>
          <InfiniteSuspend />
        </Suspense>
      );
    }
    const streamPromise = serverAct(() =>
      ReactDOMFizzServer.renderToReadableStream(
        <div>
          <App />
        </div>,
        {
          signal: controller.signal,

          /** 保存建shell期间默认取消报告。 */
          onError(x) {
            errors.push(x.message);
          },
        },
      ),
    );

    let caughtError = null;
    try {
      await streamPromise;
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError.message).toBe('The operation was aborted.');
    expect(errors).toEqual(['The operation was aborted.']);
  });

  /** 调用前signal已自定义Error abort；外Promise拒绝同对象并报告该message，验证已取消不会继续shell工作。 */
  it('should reject if passing an already aborted signal', async () => {
    const errors = [];
    const controller = new AbortController();
    const theReason = new Error('aborted for reasons');
    controller.abort(theReason);

    const promise = serverAct(() =>
      ReactDOMFizzServer.renderToReadableStream(
        <div>
          <Suspense fallback={<div>Loading</div>}>
            <InfiniteSuspend />
          </Suspense>
        </div>,
        {
          signal: controller.signal,

          /** 记录预先已取消signal的自定义message。 */
          onError(x) {
            errors.push(x.message);
          },
        },
      ),
    );

    // 技术上仍可继续渲染 shell，但当前语义还会中止所有待处理的 CPU 工作。
    let caughtError = null;
    try {
      await promise;
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBe(theReason);
    expect(errors).toEqual(['aborted for reasons']);
  });

  /** 边界Wait待定，reader先读shell再cancel；错误一次为无原因取消，之后resolve数据也不render Done但allReady=true，验证消费取消终止任务且allReady可因中止完成。 */
  it('should not continue rendering after the reader cancels', async () => {
    let hasLoaded = false;
    let resolve;
    let isComplete = false;
    let rendered = false;
    const promise = new Promise(r => (resolve = r));

    /** 未加载时挂起，完成后置rendered=true；reader.cancel后即使数据resolve也不该执行完成分支。 */
    function Wait() {
      if (!hasLoaded) {
        throw promise;
      }
      rendered = true;
      return 'Done';
    }
    const errors = [];
    const stream = await serverAct(() =>
      ReactDOMFizzServer.renderToReadableStream(
        <div>
          <Suspense fallback={<div>Loading</div>}>
            <Wait />
          </Suspense>
        </div>,
        {

          /** 记录reader.cancel触发的无原因中止message，后续数据resolve不追加报告。 */
          onError(x) {
            errors.push(x.message);
          },
        },
      ),
    );

    stream.allReady.then(() => (isComplete = true));

    expect(rendered).toBe(false);
    expect(isComplete).toBe(false);

    const reader = stream.getReader();
    await reader.read();
    await serverAct(() => reader.cancel());

    expect(errors).toEqual([
      'The render was aborted by the server without a reason.',
    ]);

    hasLoaded = true;
    await serverAct(() => resolve());

    expect(rendered).toBe(false);
    expect(isComplete).toBe(true);

    expect(errors).toEqual([
      'The render was aborted by the server without a reason.',
    ]);
  });

  /** 两492 ASCII块与空span组合、再独立2049块；完整读取HTML快照均无丢失。当前VIEW_SIZE=2048，2049跨过一个view；前布局是历史边界构造，验证拼接/大Chunk直写。 */
  it('should stream large contents that might overlow individual buffers', async () => {
    const str492 = `(492) This string is intentionally 492 bytes long because we want to make sure we process chunks that will overflow buffer boundaries. It will repeat to fill out the bytes required (inclusive of this prompt):: foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux q :: total count (492)`;
    const str2049 = `(2049) This string is intentionally 2049 bytes long because we want to make sure we process chunks that will overflow buffer boundaries. It will repeat to fill out the bytes required (inclusive of this prompt):: foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy thud foo bar qux quux corge grault garply waldo fred plugh xyzzy  :: total count (2049)`;

    // 两个492字节块及标签壳沿用历史边界布局；当前view为2048，这组并非恰好切在view末端。
    // 仍用完整HTML快照检查多块拼接，下面2049输入才明确大于当前view。
    let stream;
    stream = await serverAct(() =>
      ReactDOMFizzServer.renderToReadableStream(
        <>
          <div>
            <span>{''}</span>
          </div>
          <div>{str492}</div>
          <div>{str492}</div>
        </>,
      ),
    );

    let result;
    result = await readResult(stream);

    expect(result).toMatchInlineSnapshot(
      // TODO：移除插值，因为它会阻止快照自动更新。
      // eslint-disable-next-line jest/no-interpolation-in-snapshots
      `"<div><span></span></div><div>${str492}</div><div>${str492}</div>"`,
    );

    // 2049个ASCII字节比当前2048字节view多1，覆盖大Chunk直接写出分支；view大小变化需重新核对该边界。
    stream = await serverAct(() =>
      ReactDOMFizzServer.renderToReadableStream(
        <>
          <div>{str2049}</div>
        </>,
      ),
    );

    result = await readResult(stream);
    // TODO：移除插值，因为它会阻止快照自动更新。
    // eslint-disable-next-line jest/no-interpolation-in-snapshots
    expect(result).toMatchInlineSnapshot(`"<div>${str2049}</div>"`);
  });

  /** 两独立Suspense永久Wait，signal.abort字符串foobar；onError原字符串两次，验证非Error原因按未完成任务传递，未消费流/检查digest。 */
  it('supports custom abort reasons with a string', async () => {
    const promise = new Promise(r => {});

    /** 两独立边界Wait抛同一永久Promise，分别产生取消任务报告。 */
    function Wait() {
      throw promise;
    }

    /** p/span各一边界与独立fallback，字符串取消应报告两次。 */
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
    await serverAct(() =>
      ReactDOMFizzServer.renderToReadableStream(<App />, {
        signal: controller.signal,

        /** 保留原字符串原因并返回digest，本例未消费标记验证digest。 */
        onError(x) {
          errors.push(x);
          return 'a digest';
        },
      }),
    );

    await serverAct(() => {
      controller.abort('foobar');
    });

    expect(errors).toEqual(['foobar', 'foobar']);
  });

  /** 同两边界abort Error uh oh；onError.message两次，验证Error自定义取消原因。 */
  it('supports custom abort reasons with an Error', async () => {
    const promise = new Promise(r => {});

    /** Error取消场景共用永久Promise的Wait。 */
    function Wait() {
      throw promise;
    }

    /** 构造p/span两边界，使Error原因分别报告。 */
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
    await serverAct(() =>
      ReactDOMFizzServer.renderToReadableStream(<App />, {
        signal: controller.signal,

        /** 保存Error.message并返回digest，不改原始取消原因。 */
        onError(x) {
          errors.push(x.message);
          return 'a digest';
        },
      }),
    );

    await serverAct(() => {
      controller.abort(new Error('uh oh'));
    });

    expect(errors).toEqual(['uh oh', 'uh oh']);
  });

  // https://github.com/facebook/react/pull/25534/files —— 修复对调的转义函数。

  /** 文档title foo/body bar；完整HTML含正确title编码、blocking标记按开关，验证title块使用对应文本编码路径。 */
  it('should encode title properly', async () => {
    const stream = await serverAct(() =>
      ReactDOMFizzServer.renderToReadableStream(
        <html>
          <head>
            <title>foo</title>
          </head>
          <body>bar</body>
        </html>,
      ),
    );

    const result = await readResult(stream);
    expect(result).toEqual(
      '<!DOCTYPE html><html><head>' +
        (gate(flags => flags.enableFizzBlockingRender)
          ? '<link rel="expect" href="#_R_" blocking="render"/>'
          : '') +
        '<title>foo</title></head><body>bar' +
        (gate(flags => flags.enableFizzBlockingRender)
          ? '<template id="_R_"></template>'
          : '') +
        '</body></html>',
    );
  });

  /** 字符串nonce R4nd0m加三种bootstrap；快照脚本preload与执行标签都有nonce，验证字符串配置作用于script相关输出，本例不覆盖style nonce。 */
  it('should support nonce attribute for bootstrap scripts', async () => {
    const nonce = 'R4nd0m';
    const stream = await serverAct(() =>
      ReactDOMFizzServer.renderToReadableStream(<div>hello world</div>, {
        nonce,
        bootstrapScriptContent: 'INIT();',
        bootstrapScripts: ['init.js'],
        bootstrapModules: ['init.mjs'],
      }),
    );
    const result = await readResult(stream);
    expect(result).toMatchInlineSnapshot(
      // TODO：移除插值，因为它会阻止快照自动更新。
      // eslint-disable-next-line jest/no-interpolation-in-snapshots
      `"<link rel="preload" as="script" fetchPriority="low" nonce="R4nd0m" href="init.js"/><link rel="modulepreload" fetchPriority="low" nonce="R4nd0m" href="init.mjs"/><div>hello world</div><script nonce="${nonce}" id="_R_">INIT();</script><script src="init.js" nonce="${nonce}" async=""></script><script type="module" src="init.mjs" nonce="${nonce}" async=""></script>"`,
    );
  });
});
