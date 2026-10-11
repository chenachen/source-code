/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment ./scripts/jest/ReactDOMServerIntegrationEnvironment
 */

'use strict';

// 测试环境的补丁
global.ReadableStream =
  require('web-streams-polyfill/ponyfill/es6').ReadableStream;
global.TextEncoder = require('util').TextEncoder;

describe('ReactDOMSrcObject', () => {
  let React;
  let ReactDOMClient;
  let ReactDOMFizzServer;
  let act;
  let container;
  let assertConsoleErrorDev;

  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ReactDOMFizzServer = require('react-dom/server.edge');
    act = require('internal-test-utils').act;

    assertConsoleErrorDev =
      require('internal-test-utils').assertConsoleErrorDev;

    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    jest.restoreAllMocks();
  });

  // @gate enableSrcObject
  /** 特性开启时将 Blob 直接传 img.src；提交后 DOM src 应以 blob: 开头，验证客户端创建对象 URL 的支持标签路径。 */
  it('can render a Blob as an img src', async () => {
    const root = ReactDOMClient.createRoot(container);
    const ref = React.createRef();

    const blob = new Blob();
    await act(() => {
      root.render(<img src={blob} ref={ref} />);
    });

    expect(ref.current.src).toMatch(/^blob:/);
  });

  // @gate enableSrcObject
  /** 同一 Blob 放在 picture 内部 img.src；结果仍是 blob: URL，验证 picture 父级不妨碍支持的 img 路径。 */
  it('can render a Blob as a picture img src', async () => {
    const root = ReactDOMClient.createRoot(container);
    const ref = React.createRef();

    const blob = new Blob();
    await act(() => {
      root.render(
        <picture>
          <img src={blob} ref={ref} />
        </picture>,
      );
    });

    expect(ref.current.src).toMatch(/^blob:/);
  });

  // @gate enableSrcObject
  /** 同一 Blob 分别传 video.src 与 audio.src；两个宿主 src 都应为 blob:，验证媒体元素直接 src 的对象 URL 支持。 */
  it('can render a Blob as a video and audio src', async () => {
    const root = ReactDOMClient.createRoot(container);
    const videoRef = React.createRef();
    const audioRef = React.createRef();

    const blob = new Blob();
    await act(() => {
      root.render(
        <>
          <video src={blob} ref={videoRef} />
          <audio src={blob} ref={audioRef} />
        </>,
      );
    });

    expect(videoRef.current.src).toMatch(/^blob:/);
    expect(audioRef.current.src).toMatch(/^blob:/);
  });

  // @gate enableSrcObject || !__DEV__
  /** 把 Blob 传给 video/audio/picture 的 source 子元素；DEV 各报一次不支持诊断，三个 src 均不是 blob: 而包含字符串化后的 [object%20Blob]，验证对象值未在 source 上走对象 URL。 */
  it('warn when rendering a Blob as a source src of a video, audio or picture element', async () => {
    const root = ReactDOMClient.createRoot(container);
    const videoRef = React.createRef();
    const audioRef = React.createRef();
    const pictureRef = React.createRef();

    const blob = new Blob();
    await act(() => {
      root.render(
        <>
          <video ref={videoRef}>
            <source src={blob} />
          </video>
          <audio ref={audioRef}>
            <source src={blob} />
          </audio>
          <picture ref={pictureRef}>
            <source src={blob} />
            <img />
          </picture>
        </>,
      );
    });

    assertConsoleErrorDev([
      'Passing Blob, MediaSource or MediaStream to <source src> is not supported. ' +
        'Pass it directly to <img src>, <video src> or <audio src> instead.' +
        '\n    in source (at **)',
      'Passing Blob, MediaSource or MediaStream to <source src> is not supported. ' +
        'Pass it directly to <img src>, <video src> or <audio src> instead.' +
        '\n    in source (at **)',
      'Passing Blob, MediaSource or MediaStream to <source src> is not supported. ' +
        'Pass it directly to <img src>, <video src> or <audio src> instead.' +
        '\n    in source (at **)',
    ]);
    expect(videoRef.current.firstChild.src).not.toMatch(/^blob:/);
    expect(videoRef.current.firstChild.src).toContain('[object%20Blob]'); // source 不走对象 URL 支持路径；属性字符串经 JSDOM URL 规范化后把空格编码为 %20。
    expect(audioRef.current.firstChild.src).not.toMatch(/^blob:/);
    expect(audioRef.current.firstChild.src).toContain('[object%20Blob]'); // source 不走对象 URL 支持路径；属性字符串经 JSDOM URL 规范化后把空格编码为 %20。
    expect(pictureRef.current.firstChild.src).not.toMatch(/^blob:/);
    expect(pictureRef.current.firstChild.src).toContain('[object%20Blob]'); // source 不走对象 URL 支持路径；属性字符串经 JSDOM URL 规范化后把空格编码为 %20。
  });

  /** 连续读取 Web Stream Uint8Array 到 done，按 UTF8 合成完整 HTML，供 data URL 与 hydration 输入检查。 */
  async function readContent(stream) {
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

  // @gate enableSrcObject
  /** SSR 使用 image/jpeg Blob 且内容字节的 base64 为 ReactURL；img src 应为该 data URL，同 Blob hydration 后仍保持 data URL，验证服务器字节编码及客户端认领时不改成 blob URL。 */
  it('can SSR a Blob as an img src', async () => {
    const blob = new Blob([new Uint8Array([69, 230, 156, 181, 68, 75])], {
      type: 'image/jpeg',
    });

    const ref = React.createRef();

    /** 在服务器与客户端复用同一个 Blob/ref 的 img 树，隔离 hydration 是否保留 SSR data URL。 */
    function App() {
      return <img src={blob} ref={ref} />;
    }

    const stream = await ReactDOMFizzServer.renderToReadableStream(<App />);
    container.innerHTML = await readContent(stream);

    expect(container.firstChild.src).toBe('data:image/jpeg;base64,ReactURL');

    await act(() => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });

    expect(container.firstChild.src).toBe('data:image/jpeg;base64,ReactURL');
  });

  // @gate enableSrcObject
  /** 服务器 Blob 内容对应 ReactURL，客户端 Blob 少最后一个字节；hydration 的 DEV 属性差异应指出 Blob 与服务器 data URL 不一致，但 DOM 保留服务器 data URL，验证 mismatch 只诊断而不修补 src。 */
  it('errors in DEV when mismatching a Blob during hydration', async () => {
    const blob = new Blob([new Uint8Array([69, 230, 156, 181, 68, 75])], {
      type: 'image/jpeg',
    });

    const ref = React.createRef();

    const stream = await ReactDOMFizzServer.renderToReadableStream(
      <img src={blob} ref={ref} />,
    );
    container.innerHTML = await readContent(stream);

    expect(container.firstChild.src).toBe('data:image/jpeg;base64,ReactURL');

    const clientBlob = new Blob([new Uint8Array([69, 230, 156, 181, 68])], {
      type: 'image/jpeg',
    });

    await act(() => {
      ReactDOMClient.hydrateRoot(container, <img src={clientBlob} ref={ref} />);
    });

    assertConsoleErrorDev([
      "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. " +
        "This won't be patched up. This can happen if a SSR-ed Client Component used:\n\n" +
        "- A server/client branch `if (typeof window !== 'undefined')`.\n" +
        "- Variable input such as `Date.now()` or `Math.random()` which changes each time it's called.\n" +
        "- Date formatting in a user's locale which doesn't match the server.\n" +
        '- External changing data without sending a snapshot of it along with the HTML.\n' +
        '- Invalid HTML tag nesting.\n\n' +
        'It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.\n\n' +
        'https://react.dev/link/hydration-mismatch\n\n' +
        '  <img\n' +
        '+   src={Blob:image/jpeg}\n' +
        '-   src="data:image/jpeg;base64,ReactURL"\n' +
        '    ref={{current:null}}\n' +
        '  >\n' +
        '\n    in img (at **)',
    ]);

    // data URL 直接保留，不改成 blob URL。
    expect(container.firstChild.src).toBe('data:image/jpeg;base64,ReactURL');
  });
});
