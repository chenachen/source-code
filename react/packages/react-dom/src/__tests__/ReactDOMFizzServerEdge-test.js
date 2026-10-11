/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

// 测试环境的补丁
global.ReadableStream =
  require('web-streams-polyfill/ponyfill/es6').ReadableStream;
global.TextEncoder = require('util').TextEncoder;
global.AsyncLocalStorage = require('async_hooks').AsyncLocalStorage;

let React;
let ReactDOM;
let ReactDOMFizzServer;
let Suspense;

describe('ReactDOMFizzServerEdge', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useRealTimers();
    React = require('react');
    Suspense = React.Suspense;
    ReactDOM = require('react-dom');
    ReactDOMFizzServer = require('react-dom/server.edge');
  });

  /** 以 reader.read 消费 Uint8Array 并按 UTF8 合并，到 done 返回全部输出；显式消费让流关闭时机可观察。 */
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

  // https://github.com/facebook/react/issues/27540
  /** Edge SSR 中启动等待两个微任务的 preconnect，而主树没有悬挂；读完已关闭的流后再等宏任务，不应追加 foo 提示或发生关闭后写入，快照只包含正常文档及特性开启时的阻塞标记，回归晚到资源提示。 */
  it('does not try to write to the stream after it has been closed', async () => {
    /** 跨两个微任务后发 preconnect，刻意把资源提示推到主文档已完成输出之后。 */
    async function preloadLate() {
      await 1;
      await 1;
      // 需要等待几个微任务才能将流关闭，然后调用此方法。
      ReactDOM.preconnect('foo');
    }

    /** 在渲染期间启动晚到提示但不返回或抛该 Promise，因此不会阻止 shell 完成。 */
    function Preload() {
      preloadLate();
      return null;
    }

    /** 输出完整 html/body 文档并启动无阻塞 Preload，重现已关闭流后资源提示请求。 */
    function App() {
      return (
        <html>
          <body>
            <main>hello</main>
            <Preload />
          </body>
        </html>
      );
    }
    const stream = await ReactDOMFizzServer.renderToReadableStream(<App />);
    const result = await readResult(stream);
    // 需要等待宏任务来让预连接计划的工作执行。
    await new Promise(resolve => {
      setTimeout(resolve, 1);
    });

    if (gate(flags => flags.enableFizzBlockingRender)) {
      expect(result).toMatchInlineSnapshot(
        `"<!DOCTYPE html><html><head><link rel="expect" href="#_R_" blocking="render"/></head><body><main>hello</main><template id="_R_"></template></body></html>"`,
      );
    } else {
      expect(result).toMatchInlineSnapshot(
        `"<!DOCTYPE html><html><head></head><body><main>hello</main></body></html>"`,
      );
    }
  });

  /** 用 600 个段落构成超过默认容量的完整 shell；无边界时不输出 rel=expect，阻塞渲染开启则报告一次可恢复大型文档错误。包入 Suspense 或调大 progressiveChunkSize 后都无错误，expect 仅随特性开启出现，验证大 shell 的可恢复降级与两条可正常阻塞的输入。 */
  it('recoverably errors and does not add rel="expect" for large shells', async () => {
    /** 固定的大段文本叶节点；重复 600 次使无 Suspense shell 超出默认阻塞渲染容量。 */
    function Paragraph() {
      return (
        <p>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Mauris
          porttitor tortor ac lectus faucibus, eget eleifend elit hendrerit.
          Integer porttitor nisi in leo congue rutrum. Morbi sed ante posuere,
          aliquam lorem ac, imperdiet orci. Duis malesuada gravida pharetra.
          Cras facilisis arcu diam, id dictum lorem imperdiet a. Suspendisse
          aliquet tempus tortor et ultricies. Aliquam libero velit, posuere
          tempus ante sed, pellentesque tincidunt lorem. Nullam iaculis, eros a
          varius aliquet, tortor felis tempor metus, nec cursus felis eros
          aliquam nulla. Vivamus ut orci sed mauris congue lacinia. Cras eget
          blandit neque. Pellentesque a massa in turpis ullamcorper volutpat vel
          at massa. Sed ante est, auctor non diam non, vulputate ultrices metus.
          Maecenas dictum fermentum quam id aliquam. Donec porta risus vitae
          pretium posuere. Fusce facilisis eros in lacus tincidunt congue.
        </p>
      );
    }

    /** 按 suspense 输入把同样 600 段内容直接放入 shell 或置于独立边界，隔离容量与边界分块因素。 */
    function App({suspense}) {
      const paragraphs = [];
      for (let i = 0; i < 600; i++) {
        paragraphs.push(<Paragraph key={i} />);
      }
      return (
        <html>
          <body>
            {suspense ? (
              // Suspense 边界允许大型内容拆成后续片段，shell 不必一次输出全部段落。
              <Suspense fallback="Loading">{paragraphs}</Suspense>
            ) : (
              // 没有边界时全部段落属于 shell；启用阻塞渲染后，超过容量会报告大型文档错误。
              paragraphs
            )}
          </body>
        </html>
      );
    }
    const errors = [];
    const stream = await ReactDOMFizzServer.renderToReadableStream(
      <App suspense={false} />,
      {
        /** 收集无边界大 shell 的可恢复错误；特性开启应恰好一次，关闭应没有。 */
        onError(error) {
          errors.push(error);
        },
      },
    );
    const result = await readResult(stream);
    expect(result).not.toContain('rel="expect"');
    if (gate(flags => flags.enableFizzBlockingRender)) {
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain(
        'This rendered a large document (>512 kB) without any Suspense boundaries around most of it.',
      );
    } else {
      expect(errors.length).toBe(0);
    }

    // 如果把内容包在 Suspense 边界内，就可以正常处理。
    const errors2 = [];
    const stream2 = await ReactDOMFizzServer.renderToReadableStream(
      <App suspense={true} />,
      {
        /** 收集加 Suspense 边界后的错误，验证同样内容经边界拆分不会触发大 shell 降级。 */
        onError(error) {
          errors2.push(error);
        },
      },
    );
    const result2 = await readResult(stream2);
    if (gate(flags => flags.enableFizzBlockingRender)) {
      expect(result2).toContain('rel="expect"');
    } else {
      expect(result2).not.toContain('rel="expect"');
    }
    expect(errors2.length).toBe(0);

    // 也可增大 progressiveChunkSize，使同一份 shell 不再超过本次测试的容量限制。
    const errors3 = [];
    const stream3 = await ReactDOMFizzServer.renderToReadableStream(
      <App suspense={false} />,
      {
        progressiveChunkSize: 100000,
        /** 收集提高 progressiveChunkSize 后的错误，验证其容量阈值允许同样无边界内容正常阻塞。 */
        onError(error) {
          errors3.push(error);
        },
      },
    );
    const result3 = await readResult(stream3);
    if (gate(flags => flags.enableFizzBlockingRender)) {
      expect(result3).toContain('rel="expect"');
    } else {
      expect(result3).not.toContain('rel="expect"');
    }
    expect(errors3.length).toBe(0);
  });
});
