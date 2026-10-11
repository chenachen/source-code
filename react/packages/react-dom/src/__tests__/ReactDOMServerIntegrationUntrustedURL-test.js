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

/** 加载五模式服务端/客户端共用工具，统一从initModules获得当前模块实例。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

let React;
let ReactDOMClient;
let ReactDOMServer;
let act;

/** 所有危险javascript协议替换成这条仅抛错的占位URL，断言比较完整字符串而非执行它。 */
const EXPECTED_SAFE_URL =
  "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')";

describe('ReactDOMServerIntegration - Untrusted URLs', () => {
  /** 重置模块后加载React、客户端/服务端DOM及act，返回两DOM入口给五模式helper，隔离资源与DEV诊断状态。 */
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

  /** 五种render模式下a.href为http://javascript:0/thisisfine；DOM仍是A且URL原样，验证只识别协议开头的javascript而非URL中任意子串。 */
  itRenders('a http link with the word javascript in it', async render => {
    const e = await render(
      <a href="http://javascript:0/thisisfine">Click me</a>,
    );
    expect(e.tagName).toBe('A');
    expect(e.href).toBe('http://javascript:0/thisisfine');
  });

  /** 五种模式渲染两个不同javascript: href；两条最终均为EXPECTED_SAFE_URL占位脚本，验证每个危险URL独立替换。本例没有诊断次数断言。 */
  itRenders('a javascript protocol href', async render => {
    // 两个不同危险href均应替换；本例不检查警告。
    const e = await render(
      <div>
        <a href="javascript:notfine">p0wned</a>
        <a href="javascript:notfineagain">p0wned again</a>
      </div>,
    );
    expect(e.firstChild.href).toBe(EXPECTED_SAFE_URL);
    expect(e.lastChild.href).toBe(EXPECTED_SAFE_URL);
  });

  /** 五种模式分别渲染a.href、object.data、embed.src为javascript:；均替换为安全占位URL，验证有URL语义的不同属性。 */
  itRenders('sanitizes on various tags', async render => {
    const aElement = await render(<a href="javascript:notfine" />);
    expect(aElement.href).toBe(EXPECTED_SAFE_URL);

    const objectElement = await render(<object data="javascript:notfine" />);
    expect(objectElement.data).toBe(EXPECTED_SAFE_URL);

    const embedElement = await render(<embed src="javascript:notfine" />);
    expect(embedElement.src).toBe(EXPECTED_SAFE_URL);
  });

  /** div.data=test及a.data=javascript:fine在五种模式保留原attribute，验证data仅在object标签上具有URL净化语义。 */
  itRenders('passes through data on non-object tags', async render => {
    const div = await render(<div data="test" />);
    expect(div.getAttribute('data')).toBe('test');

    const a = await render(<a data="javascript:fine" />);
    expect(a.getAttribute('data')).toBe('javascript:fine');
  });

  /** 危险协议前有空白、NUL与控制字符、协议末尾含换行；五种模式严格断言最终URL等于安全占位串，验证协议识别可跨这些字符。 */
  itRenders('a javascript protocol with leading spaces', async render => {
    const e = await render(
      <a href={'  \t \u0000\u001F\u0003javascript\n: notfine'}>p0wned</a>,
    );
    // 用严格完整URL比较，确认含NUL的原输入也进入净化分支。
    expect(e.href).toBe(EXPECTED_SAFE_URL);
  });

  /** 协议内部插入换行/制表并混合大小写；五种模式仍替换危险href，验证不受字符拆分或大小写绕过。 */
  itRenders(
    'a javascript protocol with intermediate new lines and mixed casing',
    async render => {
      const e = await render(
        <a href={'\t\r\n Jav\rasCr\r\niP\t\n\rt\n:notfine'}>p0wned</a>,
      );
      expect(e.href).toBe(EXPECTED_SAFE_URL);
    },
  );

  /** map内area.href为javascript:；五种模式的area DOM href均被替换，验证区域链接属性。 */
  itRenders('a javascript protocol area href', async render => {
    const e = await render(
      <map>
        <area href="javascript:notfine" />
      </map>,
    );
    expect(e.firstChild.href).toBe(EXPECTED_SAFE_URL);
  });

  /** form.action为javascript:；五种模式最终action为占位URL，验证字符串表单action净化。 */
  itRenders('a javascript protocol form action', async render => {
    const e = await render(<form action="javascript:notfine">p0wned</form>);
    expect(e.action).toBe(EXPECTED_SAFE_URL);
  });

  /** submit input.formAction为javascript:；五种模式读取attribute应为安全占位URL，验证按钮覆盖表单目标的属性协议。 */
  itRenders('a javascript protocol input formAction', async render => {
    const e = await render(
      <input type="submit" formAction="javascript:notfine" />,
    );
    expect(e.getAttribute('formAction')).toBe(EXPECTED_SAFE_URL);
  });

  /** button.formAction为javascript:；五种模式attribute均替换，验证button独立formAction路径。 */
  itRenders('a javascript protocol button formAction', async render => {
    const e = await render(
      <button formAction="javascript:notfine">p0wned</button>,
    );
    expect(e.getAttribute('formAction')).toBe(EXPECTED_SAFE_URL);
  });

  /** iframe.src为javascript:；五种模式最终src被替换，验证嵌入浏览上下文的URL属性。 */
  itRenders('a javascript protocol iframe src', async render => {
    const e = await render(<iframe src="javascript:notfine" />);
    expect(e.src).toBe(EXPECTED_SAFE_URL);
  });

  /** html/frameset/frame.src为javascript:；clientCleanRender与正常server-string hydration直接返回未验证，其余render模式断言frame.src被替换，覆盖可用模式下的frameset路径。 */
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

  /** SVG中的a.href为javascript:；五种模式getAttribute(href)均为安全占位串，验证SVG普通链接属性。 */
  itRenders('a javascript protocol in an SVG link', async render => {
    const e = await render(
      <svg>
        <a href="javascript:notfine" />
      </svg>,
    );
    expect(e.firstChild.getAttribute('href')).toBe(EXPECTED_SAFE_URL);
  });

  /** SVG a.xlinkHref为javascript:；五种模式以xlink命名空间读取href应被替换，验证命名空间链接属性。 */
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

  /** 客户端a先http安全href后更新为javascript:；同节点最终href被替换，验证updateProperties也走净化。 */
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

  /** 对象toString在预期调用次数内返回https、之后返回javascript；五模式/DEV/TrustedTypes按分支计算次数并断言最终安全URL，验证同次序列化不会校验一次再额外转换出危险值。 */
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
      /** 在各模式预先计算的转换次数内给安全https URL，超过后返回危险协议；计数用于检测校验后额外转换的漏洞。 */
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

  /** 客户端安全href后连续两次更新危险href；两次均为占位URL，验证识别正则没有依赖全局lastIndex而漏掉重复输入。 */
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
