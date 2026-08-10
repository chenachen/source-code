/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment ./scripts/jest/ReactDOMServerIntegrationEnvironment
 */

/* eslint-disable no-script-url */

'use strict';

/** `ReactDOMServerIntegrationUtils`：保存当前测试场景复用的夹具、状态或回调。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

let React;
let ReactDOMClient;
let ReactDOMServer;
let act;

/** `EXPECTED_SAFE_URL`：保存当前测试场景复用的夹具、状态或回调。 */
const EXPECTED_SAFE_URL =
  "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')";

describe('ReactDOMServerIntegration - Untrusted URLs', () => {
  /** `initModules`：封装当前用例复用的操作、回调或断言步骤。 */
  function initModules() {
    jest.resetModules();

    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    act = require('internal-test-utils').act;

    // 将这些方法暴露给测试辅助函数。
    return {
      ReactDOMClient,
      ReactDOMServer,
    };
  }

  const {
    resetModules,
    itRenders,
    clientCleanRender,
    clientRenderOnBadMarkup,
    clientRenderOnServerString,
  } = ReactDOMServerIntegrationUtils(initModules);

  beforeEach(() => {
    resetModules();
  });

  itRenders('a http link with the word javascript in it', async render => {
    const e = await render(
      <a href="http://javascript:0/thisisfine">Click me</a>,
    );
    expect(e.tagName).toBe('A');
    expect(e.href).toBe('http://javascript:0/thisisfine');
  });

  itRenders('a javascript protocol href', async render => {
        // 只有第一次会警告；第二次警告已被去重。
    const e = await render(
      <div>
        <a href="javascript:notfine">p0wned</a>
        <a href="javascript:notfineagain">p0wned again</a>
      </div>,
    );
    expect(e.firstChild.href).toBe(EXPECTED_SAFE_URL);
    expect(e.lastChild.href).toBe(EXPECTED_SAFE_URL);
  });

  itRenders('sanitizes on various tags', async render => {
    const aElement = await render(<a href="javascript:notfine" />);
    expect(aElement.href).toBe(EXPECTED_SAFE_URL);

    const objectElement = await render(<object data="javascript:notfine" />);
    expect(objectElement.data).toBe(EXPECTED_SAFE_URL);

    const embedElement = await render(<embed src="javascript:notfine" />);
    expect(embedElement.src).toBe(EXPECTED_SAFE_URL);
  });

  itRenders('passes through data on non-object tags', async render => {
    const div = await render(<div data="test" />);
    expect(div.getAttribute('data')).toBe('test');

    const a = await render(<a data="javascript:fine" />);
    expect(a.getAttribute('data')).toBe('javascript:fine');
  });

  itRenders('a javascript protocol with leading spaces', async render => {
    const e = await render(
      <a href={'  \t \u0000\u001F\u0003javascript\n: notfine'}>p0wned</a>,
    );
    // 我们在这里使用近似比较，因为 JSDOM 可能无法正确解析 HTML 中的 \u0000。
    expect(e.href).toBe(EXPECTED_SAFE_URL);
  });

  itRenders(
    'a javascript protocol with intermediate new lines and mixed casing',
    async render => {
      const e = await render(
        <a href={'\t\r\n Jav\rasCr\r\niP\t\n\rt\n:notfine'}>p0wned</a>,
      );
      expect(e.href).toBe(EXPECTED_SAFE_URL);
    },
  );

  itRenders('a javascript protocol area href', async render => {
    const e = await render(
      <map>
        <area href="javascript:notfine" />
      </map>,
    );
    expect(e.firstChild.href).toBe(EXPECTED_SAFE_URL);
  });

  itRenders('a javascript protocol form action', async render => {
    const e = await render(<form action="javascript:notfine">p0wned</form>);
    expect(e.action).toBe(EXPECTED_SAFE_URL);
  });

  itRenders('a javascript protocol input formAction', async render => {
    const e = await render(
      <input type="submit" formAction="javascript:notfine" />,
    );
    expect(e.getAttribute('formAction')).toBe(EXPECTED_SAFE_URL);
  });

  itRenders('a javascript protocol button formAction', async render => {
    const e = await render(
      <button formAction="javascript:notfine">p0wned</button>,
    );
    expect(e.getAttribute('formAction')).toBe(EXPECTED_SAFE_URL);
  });

  itRenders('a javascript protocol iframe src', async render => {
    const e = await render(<iframe src="javascript:notfine" />);
    expect(e.src).toBe(EXPECTED_SAFE_URL);
  });

  itRenders('a javascript protocol frame src', async render => {
    if (render === clientCleanRender || render === clientRenderOnServerString) {
        // React 无法正确 hydration frameset，因为默认的 hydration scope 是 body。
      return;
    }
    const e = await render(
      <html>
        <head />
        <frameset>
          <frame src="javascript:notfine" />
        </frameset>
      </html>,
    );
    expect(e.lastChild.firstChild.src).toBe(EXPECTED_SAFE_URL);
  });

  itRenders('a javascript protocol in an SVG link', async render => {
    const e = await render(
      <svg>
        <a href="javascript:notfine" />
      </svg>,
    );
    expect(e.firstChild.getAttribute('href')).toBe(EXPECTED_SAFE_URL);
  });

  itRenders(
    'a javascript protocol in an SVG link with a namespace',
    async render => {
      const e = await render(
        <svg>
          <a xlinkHref="javascript:notfine" />
        </svg>,
      );
      expect(
        e.firstChild.getAttributeNS('http://www.w3.org/1999/xlink', 'href'),
      ).toBe(EXPECTED_SAFE_URL);
    },
  );

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「rejects a javascript protocol href if it is added during an update」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言覆盖 react-dom 的服务端流适配层；完整 Fizz 状态机位于 react-server。
   */
  it('rejects a javascript protocol href if it is added during an update', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(() => {
      root.render(<a href="http://thisisfine/">click me</a>);
    });
    expect(container.firstChild.href).toBe('http://thisisfine/');
    await act(() => {
      root.render(<a href="javascript:notfine">click me</a>);
    });
    expect(container.firstChild.href).toBe(EXPECTED_SAFE_URL);
  });

  itRenders('only the first invocation of toString', async render => {
    let expectedToStringCalls = 1;
    if (render === clientRenderOnBadMarkup) {
      // 它在服务器上被调用一次，在客户端上被调用一次，这发生在我们的测试运行器共享同一个对象的情况下。
      expectedToStringCalls = 2;
    }
    if (render === clientRenderOnServerString && __DEV__) {
      // hydration 校验会额外调用一次。TODO：为保持一致，最好只调用一次 toString，但当前代码结构很难
      // 做到。
      expectedToStringCalls = 4;
    } else if (__DEV__) {
      // 开发环境检查字符串强制转换问题时，会让 toString 调用次数翻倍。
      expectedToStringCalls *= 2;
    }

    if (gate('enableTrustedTypesIntegration') && render === clientCleanRender) {
      // Trusted types 进行了另一个 `toString`。
      expectedToStringCalls += 1;
    }

    let toStringCalls = 0;
    const firstIsSafe = {
      /** `toString`：实现测试夹具的生命周期、渲染或交互步骤。 */
      toString() {
        // 它试图绕过验证：前几次调用时伪装成安全 URL，随后才变成危险 URL。
        toStringCalls++;
        if (toStringCalls <= expectedToStringCalls) {
          return 'https://reactjs.org/';
        }
        return 'javascript:notfine';
      },
    };

    const e = await render(<a href={firstIsSafe} />);
    expect(toStringCalls).toBe(expectedToStringCalls);
    expect(e.href).toBe('https://reactjs.org/');
  });

  /** 测试场景：验证「rejects a javascript protocol href if it is added during an update twice」描述的渲染、交互或错误处理结果。 */
  it('rejects a javascript protocol href if it is added during an update twice', async () => {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);
    await act(async () => {
      root.render(<a href="http://thisisfine/">click me</a>);
    });
    expect(container.firstChild.href).toBe('http://thisisfine/');
    await act(async () => {
      root.render(<a href="javascript:notfine">click me</a>);
    });
    expect(container.firstChild.href).toBe(EXPECTED_SAFE_URL);
    // 第二次更新用于确认正则表达式没有被添加全局标志；否则第二次调用时可能匹配失败。
    await act(async () => {
      root.render(<a href="javascript:notfine">click me</a>);
    });
    expect(container.firstChild.href).toBe(EXPECTED_SAFE_URL);
  });
});
