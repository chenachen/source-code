/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @jest-environment ./scripts/jest/ReactDOMServerIntegrationEnvironment
 */

'use strict';

let React;
let ReactDOMClient;
let ReactDOMServer;
let act;

/** Node util 模块，用 format 按 console.error 的格式串与参数还原快照消息；也用于缺少 owner stack 时的失败说明。 */
const util = require('util');

/** 保存本套件安装 mock 前的 console.error；afterEach 无论场景结果都还原该引用，避免跨用例污染。 */
const realConsoleError = console.error;

/**
 * 作为 window error 的空用户监听器注册，使测试显式接收浏览器错误事件并通过 console.error mock 检查诊断；自身不转发消息、不调用 preventDefault。afterEach 移除同一函数引用。
 * @returns undefined。
 */
function errorHandler() {
  // 空用户 error 监听器；诊断由本套件的 console.error mock 收集。
}

describe('ReactDOMServerHydration', () => {
  let container;
  let ownerStacks;

  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server');
    act = React.act;

    window.addEventListener('error', errorHandler);
    ownerStacks = [];
    console.error = jest.fn(() => {
      const ownerStack = React.captureOwnerStack();
      if (typeof ownerStack === 'string') {
        ownerStacks.push(ownerStack === '' ? ' <empty>' : ownerStack);
      } else {
        ownerStacks.push(' ' + String(ownerStack));
      }
    });
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    window.removeEventListener('error', errorHandler);
    document.body.removeChild(container);
    console.error = realConsoleError;
  });

  /**
   * 只对字符串把 at/in 栈帧中的路径、行号等位置统一成 (at **)，保留组件名；其他类型原样返回，避免环境路径干扰快照。
   * @param str - 待规范化的字符串或其他消息参数。
   * @returns 规范化字符串或原值。
   */
  function normalizeCodeLocInfo(str) {
    return typeof str === 'string'
      ? str.replace(/\n +(?:at|in) ([\S]+)[^\n]*/g, function (m, name) {
          return '\n    in ' + name + ' (at **)';
        })
      : str;
  }

  /**
   * 按 console.error 调用索引读取同步采集的 owner stack；缺少对应记录立即抛错，避免误配。Error 消息另行呈现 cause（若为 Error）；格式串参数则规范化末项栈信息后由 util.format 拼接，最后附 Owner Stack。
   * @param args - 某一次 console.error 的参数数组。
   * @param index - 该调用在 mock.calls 中的索引。
   * @returns 用于快照的完整消息字符串。
   */
  function formatMessage(args, index) {
    const ownerStack = ownerStacks[index];

    if (ownerStack === undefined) {
      throw new Error(
        'Expected an owner stack for message ' +
          index +
          ':\n' +
          util.format(...args),
      );
    }

    const [format, ...rest] = args;
    if (format instanceof Error) {
      if (format.cause instanceof Error) {
        return (
          'Caught [' +
          format.message +
          ']\n  Cause [' +
          format.cause.message +
          ']\n  Owner Stack:' +
          normalizeCodeLocInfo(ownerStack)
        );
      }
      return (
        'Caught [' +
        format.message +
        ']\n  Owner Stack:' +
        normalizeCodeLocInfo(ownerStack)
      );
    }
    rest[rest.length - 1] = normalizeCodeLocInfo(rest[rest.length - 1]);
    return (
      util.format(format, ...rest) +
      '\n  Owner Stack:' +
      normalizeCodeLocInfo(ownerStack)
    );
  }

  /**
   * 将全部 console.error 调用按索引交给 formatMessage，保留和 ownerStacks 的一一对应，再过滤假值。
   * @returns 诊断字符串数组；配对缺失时由 formatMessage 抛错。
   */
  function formatConsoleErrors() {
    return console.error.mock.calls.map(formatMessage).filter(Boolean);
  }

  /**
   * 先用 false 标志 renderToString 并放入 container，再在同步 act 中用 true 标志 hydrateRoot；收集格式化诊断作为断言输入，不额外比较最终 DOM。beforeEach 重置日志并建容器，afterEach 恢复 mock/监听器并移除容器。
   * @param Mismatch - 根据 isClient 产生两端测试输入的组件。
   * @returns 当前 console.error 的格式化消息数组。
   */
  function testMismatch(Mismatch) {
    const htmlString = ReactDOMServer.renderToString(
      <Mismatch isClient={false} />,
    );
    container.innerHTML = htmlString;
    act(() => {
      ReactDOMClient.hydrateRoot(container, <Mismatch isClient={true} />);
    });
    return formatConsoleErrors();
  }

  describe('text mismatch', () => {
    /** Given：main 的服务端文本为 server，客户端为 client；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：日志快照为 text mismatch，差异 +client/-server，Owner Stack 从 main 指向 Mismatch。目的：验证文本差异和错误拥有者。 */
    // @gate __DEV__

    it('warns when client and server render different text', () => {

      /**
       * 在 parent/main 层级只改变 server/client 文本，让差异拥有者定位到 main。
       * @param props - isClient 选择客户端 true 或服务端 false 输入。
       * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
       */
      function Mismatch({isClient}) {
        return (
          <div className="parent">
            <main className="child">{isClient ? 'client' : 'server'}</main>
          </div>
        );
      }
      expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered text didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
                <main className="child">
          +       client
          -       server
          ]
            Owner Stack:
              in main (at **)
              in Mismatch (at **)",
          ]
        `);
    });
    /** Given：两段文本都包含 nbsp 实体，仅 client/server 后缀不同；标题 checksum 是历史名称；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照保留解析后的不换行空格，并显示 client/server 文本差异与 div 拥有者。目的：验证错误显示实体解析后的文本，此输入没有 checksum 计算。 */

    // @gate __DEV__

    it('warns when escaping on a checksum mismatch', () => {

      /**
       * 返回包含同一 nbsp 实体的两段文本，只按 isClient 改后缀；测试的是实体解析后的消息文字。
       * @param props - isClient 选择客户端 true 或服务端 false 输入。
       * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
       */
      function Mismatch({isClient}) {
        if (isClient) {
          return (
            <div>This markup contains an nbsp entity: &nbsp; client text</div>
          );
        }
        return (
          <div>This markup contains an nbsp entity: &nbsp; server text</div>
        );
      }

      /* eslint-disable no-irregular-whitespace */
      expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered text didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div>
          +     This markup contains an nbsp entity:   client text
          -     This markup contains an nbsp entity:   server text
          ]
            Owner Stack:
              in div (at **)
              in Mismatch (at **)",
          ]
        `);
      /* eslint-enable no-irregular-whitespace */
    });
    /** Given：main 的 __html 分别为 span server/client；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：属性告警快照展示 dangerouslySetInnerHTML 对象的 __html 差异，Owner Stack 从 main 开始。目的：验证内联 HTML 差异采用属性告警格式。 */

    // @gate __DEV__

    it('warns when client and server render different html', () => {

      /**
       * 保持 main 结构，只改变 dangerouslySetInnerHTML.__html 中 span 的文字，触发属性级诊断。
       * @param props - isClient 选择客户端 true 或服务端 false 输入。
       * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
       */
      function Mismatch({isClient}) {
        return (
          <div className="parent">
            <main
              className="child"
              dangerouslySetInnerHTML={{
                __html: isClient
                  ? '<span>client</span>'
                  : '<span>server</span>',
              }}
            />
          </div>
        );
      }
      expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
        [
          "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up. This can happen if a SSR-ed Client Component used:

        - A server/client branch \`if (typeof window !== 'undefined')\`.
        - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
        - Date formatting in a user's locale which doesn't match the server.
        - External changing data without sending a snapshot of it along with the HTML.
        - Invalid HTML tag nesting.

        It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

        https://react.dev/link/hydration-mismatch

          <Mismatch isClient={true}>
            <div className="parent">
              <main
                className="child"
                dangerouslySetInnerHTML={{
        +         __html: "<span>client</span>"
        -         __html: "<span>server</span>"
                }}
              >

          Owner Stack:
            in main (at **)
            in Mismatch (at **)",
        ]
      `);
    });
  });

  describe('attribute mismatch', () => {
    /** Given：main 的 className 从 child server 变为 child client，dir 从 rtl 变为 ltr；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：单个告警快照同时显示两个属性的正负差异与 main 拥有者。目的：验证多个属性差异聚合。 */
    // @gate __DEV__

    it('warns when client and server render different attributes', () => {

      /**
       * 同时改变 main 的 className 和 dir，让多个属性差异汇入同一消息。
       * @param props - isClient 选择客户端 true 或服务端 false 输入。
       * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
       */
      function Mismatch({isClient}) {
        return (
          <div className="parent">
            <main
              className={isClient ? 'child client' : 'child server'}
              dir={isClient ? 'ltr' : 'rtl'}
            />
          </div>
        );
      }
      expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
        [
          "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up. This can happen if a SSR-ed Client Component used:

        - A server/client branch \`if (typeof window !== 'undefined')\`.
        - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
        - Date formatting in a user's locale which doesn't match the server.
        - External changing data without sending a snapshot of it along with the HTML.
        - Invalid HTML tag nesting.

        It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

        https://react.dev/link/hydration-mismatch

          <Mismatch isClient={true}>
            <div className="parent">
              <main
        +       className="child client"
        -       className="child server"
        +       dir="ltr"
        -       dir="rtl"
              >

          Owner Stack:
            in main (at **)
            in Mismatch (at **)",
        ]
      `);
    });
    /** Given：服务端没有 tabIndex/dir，客户端提供 1/ltr；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照显示 +tabIndex={1}/-tabIndex={null} 与 +dir=ltr/-dir={null}。目的：验证客户端额外属性与服务端缺省值的显示。 */

    // @gate __DEV__

    it('warns when client renders extra attributes', () => {

      /**
       * 仅客户端提供 tabIndex=1 与 dir=ltr；服务端 null 不输出这两个属性。
       * @param props - isClient 选择客户端 true 或服务端 false 输入。
       * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
       */
      function Mismatch({isClient}) {
        return (
          <div className="parent">
            <main
              className="child"
              tabIndex={isClient ? 1 : null}
              dir={isClient ? 'ltr' : null}
            />
          </div>
        );
      }
      expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
        [
          "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up. This can happen if a SSR-ed Client Component used:

        - A server/client branch \`if (typeof window !== 'undefined')\`.
        - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
        - Date formatting in a user's locale which doesn't match the server.
        - External changing data without sending a snapshot of it along with the HTML.
        - Invalid HTML tag nesting.

        It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

        https://react.dev/link/hydration-mismatch

          <Mismatch isClient={true}>
            <div className="parent">
              <main
                className="child"
        +       tabIndex={1}
        -       tabIndex={null}
        +       dir="ltr"
        -       dir={null}
              >

          Owner Stack:
            in main (at **)
            in Mismatch (at **)",
        ]
      `);
    });
    /** Given：服务端提供 tabIndex=1、dir=rtl，客户端均为 null；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照以服务端字符串 tabIndex=1/dir=rtl 对比客户端 null。目的：验证服务端额外属性的值类型与删除显示。 */

    // @gate __DEV__

    it('warns when server renders extra attributes', () => {

      /**
       * 仅服务端提供 tabIndex=1 与 dir=rtl；客户端 null 用于缺失属性对比。
       * @param props - isClient 选择客户端 true 或服务端 false 输入。
       * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
       */
      function Mismatch({isClient}) {
        return (
          <div className="parent">
            <main
              className="child"
              tabIndex={isClient ? null : 1}
              dir={isClient ? null : 'rtl'}
            />
          </div>
        );
      }
      expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
        [
          "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up. This can happen if a SSR-ed Client Component used:

        - A server/client branch \`if (typeof window !== 'undefined')\`.
        - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
        - Date formatting in a user's locale which doesn't match the server.
        - External changing data without sending a snapshot of it along with the HTML.
        - Invalid HTML tag nesting.

        It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

        https://react.dev/link/hydration-mismatch

          <Mismatch isClient={true}>
            <div className="parent">
              <main
                className="child"
        +       tabIndex={null}
        -       tabIndex="1"
        +       dir={null}
        -       dir="rtl"
              >

          Owner Stack:
            in main (at **)
            in Mismatch (at **)",
        ]
      `);
    });
    /** Given：服务端只有 dir=rtl，客户端只有 tabIndex=1；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：同一快照列出新增 tabIndex 和缺失 dir。目的：验证两端各自额外属性可以共同展示。 */

    // @gate __DEV__

    it('warns when both client and server render extra attributes', () => {

      /**
       * 客户端只提供 tabIndex，服务端只提供 dir，覆盖两端各自新增属性。
       * @param props - isClient 选择客户端 true 或服务端 false 输入。
       * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
       */
      function Mismatch({isClient}) {
        return (
          <div className="parent">
            <main
              className="child"
              tabIndex={isClient ? 1 : null}
              dir={isClient ? null : 'rtl'}
            />
          </div>
        );
      }
      expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
        [
          "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up. This can happen if a SSR-ed Client Component used:

        - A server/client branch \`if (typeof window !== 'undefined')\`.
        - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
        - Date formatting in a user's locale which doesn't match the server.
        - External changing data without sending a snapshot of it along with the HTML.
        - Invalid HTML tag nesting.

        It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

        https://react.dev/link/hydration-mismatch

          <Mismatch isClient={true}>
            <div className="parent">
              <main
                className="child"
        +       tabIndex={1}
        -       tabIndex={null}
        +       dir={null}
        -       dir="rtl"
              >

          Owner Stack:
            in main (at **)
            in Mismatch (at **)",
        ]
      `);
    });
    /** Given：服务端 opacity=0，客户端 opacity=1；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照将客户端数字 1 与 DOM 读取的服务端字符串 0 放在 style 对象差异中。目的：验证 style 差异的读取与展示形式。 */

    // @gate __DEV__

    it('warns when client and server render different styles', () => {

      /**
       * 把 opacity 从服务端数字 0 改成客户端数字 1；诊断需区分客户端对象值与服务端 DOM 属性读取值。
       * @param props - isClient 选择客户端 true 或服务端 false 输入。
       * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
       */
      function Mismatch({isClient}) {
        return (
          <div className="parent">
            <main
              className="child"
              style={{
                opacity: isClient ? 1 : 0,
              }}
            />
          </div>
        );
      }
      expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
        [
          "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up. This can happen if a SSR-ed Client Component used:

        - A server/client branch \`if (typeof window !== 'undefined')\`.
        - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
        - Date formatting in a user's locale which doesn't match the server.
        - External changing data without sending a snapshot of it along with the HTML.
        - Invalid HTML tag nesting.

        It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

        https://react.dev/link/hydration-mismatch

          <Mismatch isClient={true}>
            <div className="parent">
              <main
                className="child"
        +       style={{opacity:1}}
        -       style={{opacity:"0"}}
              >

          Owner Stack:
            in main (at **)
            in Mismatch (at **)",
        ]
      `);
    });
    /** Given：Left/Middle/Right 三个分支的 className 都变化，Left 另有 Indirection；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：一条属性告警包含三个差异，Owner Stack 为 div→LeftMismatch→LeftIndirection→App。目的：验证聚合错误的拥有者选取深度优先遇到的首个差异 Fiber。 */

    // @gate __DEV__

    it('picks the DFS-first Fiber as the error Owner', () => {

      /**
       * 左侧 div 的 className 按两端变化，提供深度优先首次属性差异。
       * @param props - isClient 选择客户端 true 或服务端 false 输入。
       * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
       */
      function LeftMismatch({isClient}) {
        return <div className={isClient ? 'client' : 'server'} />;
      }

      /**
       * 透传 isClient 到 LeftMismatch，增加首个差异节点的组件拥有者层级。
       * @param props - isClient 选择客户端 true 或服务端 false 输入。
       * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
       */
      function LeftIndirection({isClient}) {
        return <LeftMismatch isClient={isClient} />;
      }

      /**
       * 中间 span 同样改变 className，让聚合消息有第二个差异但不成为错误拥有者。
       * @param props - isClient 选择客户端 true 或服务端 false 输入。
       * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
       */
      function MiddleMismatch({isClient}) {
        return <span className={isClient ? 'client' : 'server'} />;
      }

      /**
       * 右侧 p 改变 className，提供第三个聚合差异。
       * @param props - isClient 选择客户端 true 或服务端 false 输入。
       * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
       */
      function RightMisMatch({isClient}) {
        return <p className={isClient ? 'client' : 'server'} />;
      }

      /**
       * 按 LeftIndirection、MiddleMismatch、RightMisMatch 的顺序返回兄弟分支，使首个深度优先差异的拥有者可确定。
       * @param props - isClient 选择客户端 true 或服务端 false 输入。
       * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
       */
      function App({isClient}) {
        return (
          <>
            <LeftIndirection isClient={isClient} />
            <MiddleMismatch isClient={isClient} />
            <RightMisMatch isClient={isClient} />
          </>
        );
      }
      expect(testMismatch(App)).toMatchInlineSnapshot(`
        [
          "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up. This can happen if a SSR-ed Client Component used:

        - A server/client branch \`if (typeof window !== 'undefined')\`.
        - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
        - Date formatting in a user's locale which doesn't match the server.
        - External changing data without sending a snapshot of it along with the HTML.
        - Invalid HTML tag nesting.

        It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

        https://react.dev/link/hydration-mismatch

          <App isClient={true}>
            <LeftIndirection isClient={true}>
              <LeftMismatch isClient={true}>
                <div
        +         className="client"
        -         className="server"
                >
            <MiddleMismatch isClient={true}>
              <span
        +       className="client"
        -       className="server"
              >
            <RightMisMatch isClient={true}>
              <p
        +       className="client"
        -       className="server"
              >

          Owner Stack:
            in div (at **)
            in LeftMismatch (at **)
            in LeftIndirection (at **)
            in App (at **)",
        ]
      `);
    });

    describe('nonce', () => {
      // nonce 属于 HTMLOrSVGElement；覆盖若干通过 getValueForAttribute 水合属性的宿主标签。

      /**
       * 生成固定 r4nd0m nonce 的脚本、样式、资源、媒体、表单与自定义元素；忽略 testMismatch 传入的 isClient，保证两端 nonce 相同。
       * @returns nonce 属性匹配的 div 树。
       */
      function App() {
        return (
          <div>
            <script nonce="r4nd0m" src="https://example.com/script.js" />
            <style nonce="r4nd0m">{`body { background-color: red; }`}</style>
            <link
              rel="stylesheet"
              nonce="r4nd0m"
              href="https://example.com/style.css"
            />
            <img nonce="r4nd0m" src="https://example.com/image.png" />
            <video nonce="r4nd0m" src="https://example.com/video.mp4" />
            <audio nonce="r4nd0m" src="https://example.com/audio.mp3" />
            <iframe nonce="r4nd0m" src="https://example.com/iframe.html" />
            <form nonce="r4nd0m">
              <input type="text" nonce="r4nd0m" />
            </form>
            <my-element nonce="r4nd0m" />
          </div>
        );
      }
      /** Given：各类标签 nonce 相同；mock getAttribute 对 nonce 返回空串、其他属性按原方法读取；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：显式断言 script.getAttribute 为空而 .nonce 为 r4nd0m，随后 testMismatch 返回空日志数组。目的：验证 CSP 隐藏内容属性时仍可通过 nonce property 匹配。 */

      // @gate __DEV__

      it('does not warn when nonce matches and CSP hides getAttribute', () => {
        // 启用 CSP 时，浏览器会隐藏 nonce 内容属性：getAttribute("nonce") 返回空字符串，但 `.nonce`
        // 仍可读取。JSDOM 未实现该行为，因此在此场景中模拟它。
        // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#cryptographicnonce
        const originalGetAttribute = window.Element.prototype.getAttribute;
        spyOnDevAndProd(
          window.Element.prototype,
          'getAttribute',
        ).mockImplementation(function (name) {
          if (typeof name === 'string' && name.toLowerCase() === 'nonce') {
            return '';
          }
          return originalGetAttribute.call(this, name);
        });

        const htmlString = ReactDOMServer.renderToString(<App />);
        container.innerHTML = htmlString;

        // 启用 CSP 时，验证 getAttribute 会隐藏 nonce 属性，以模拟浏览器行为。
        const script = container.querySelector('script');
        expect(script.getAttribute('nonce')).toBe('');
        expect(script.nonce).toBe('r4nd0m');

        expect(testMismatch(App)).toEqual([]);
      });
      /** Given：相同 nonce 的各类标签采用未模拟隐藏的 getAttribute；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：script 内容属性和 .nonce 均为 r4nd0m，testMismatch 返回空日志数组。目的：验证正常 nonce 属性匹配不告警。 */

      // @gate __DEV__

      it('does not warn when nonce matches without CSP hiding', () => {
        const htmlString = ReactDOMServer.renderToString(<App />);
        container.innerHTML = htmlString;

        // 禁用 CSP 时，验证可通过 getAttribute 读取 nonce 属性。
        const script = container.querySelector('script');
        expect(script.getAttribute('nonce')).toBe('r4nd0m');
        expect(script.nonce).toBe('r4nd0m');
        expect(testMismatch(App)).toEqual([]);
      });
    });
  });

  describe('extra nodes on the client', () => {
    describe('extra elements on the client', () => {
      /** Given：服务端 parent 为空，客户端多出唯一 main；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照 +main className=only，Owner Stack 从 main 开始。目的：验证客户端唯一元素缺失时的差异。 */
      // @gate __DEV__

      it('warns when client renders an extra element as only child', () => {

        /**
         * 仅客户端在空 parent 中加入唯一 main。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              {isClient && <main className="only" />}
            </div>
          );
        }
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
          +     <main className="only">
          ]
            Owner Stack:
              in main (at **)
              in Mismatch (at **)",
          ]
        `);
      });
      /** Given：服务端有 main/footer，客户端在其前加入 header；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照 +header/-main 后省略剩余内容，拥有者为 header。目的：验证客户端首部插入导致首次位置不匹配。 */

      // @gate __DEV__

      it('warns when client renders an extra element in the beginning', () => {

        /**
         * 仅客户端在已有 main/footer 前加入 header。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              {isClient && <header className="1" />}
              <main className="2" />
              <footer className="3" />
            </div>
          );
        }
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
          +     <header className="1">
          -     <main className="2">
                ...
          ]
            Owner Stack:
              in header (at **)
              in Mismatch (at **)",
          ]
        `);
      });
      /** Given：服务端有 header/footer，客户端在两者间加入 main；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照保留 header，并显示 +main/-footer，拥有者为 main。目的：验证客户端中间插入的首次差异。 */

      // @gate __DEV__

      it('warns when client renders an extra element in the middle', () => {

        /**
         * 仅客户端在 header/footer 中间加入 main。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              <header className="1" />
              {isClient && <main className="2" />}
              <footer className="3" />
            </div>
          );
        }
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
                <header>
          +     <main className="2">
          -     <footer className="3">
                ...
          ]
            Owner Stack:
              in main (at **)
              in Mismatch (at **)",
          ]
        `);
      });
      /** Given：服务端有 header/main，客户端末尾增加 footer；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照 +footer，拥有者为 footer。目的：验证客户端尾部额外元素。 */

      // @gate __DEV__

      it('warns when client renders an extra element in the end', () => {

        /**
         * 仅客户端在已有 header/main 后加入 footer。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              <header className="1" />
              <main className="2" />
              {isClient && <footer className="3" />}
            </div>
          );
        }
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
                <header>
                <main>
          +     <footer className="3">
          ]
            Owner Stack:
              in footer (at **)
              in Mismatch (at **)",
          ]
        `);
      });
    });

    describe('extra text nodes on the client', () => {
      /** Given：服务端 parent 为空，客户端唯一文本为 only；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：text mismatch 快照显示 +only 与服务端空文本，拥有者为 div。目的：验证直接文本内容路径的缺失差异。 */
      // @gate __DEV__

      it('warns when client renders an extra text node as only child', () => {

        /**
         * 仅客户端向空 parent 提供直接文本 only。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return <div className="parent">{isClient && 'only'}</div>;
        }
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
            [
              "Caught [Hydration failed because the server rendered text didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

            - A server/client branch \`if (typeof window !== 'undefined')\`.
            - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
            - Date formatting in a user's locale which doesn't match the server.
            - External changing data without sending a snapshot of it along with the HTML.
            - Invalid HTML tag nesting.

            It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

            https://react.dev/link/hydration-mismatch

              <Mismatch isClient={true}>
                <div className="parent">
            +     only
            -     
            ]
              Owner Stack:
                in div (at **)
                in Mismatch (at **)",
            ]
          `);
      });
      /** Given：标题为 beginning，但实际客户端 second 文本位于 header 与 footer 之间；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：HTML mismatch 快照显示 +second/-footer，拥有者为 div。目的：按真实输入验证中间文本插入，避免由标题误推位置。 */

      // @gate __DEV__

      it('warns when client renders an extra text node in the beginning', () => {

        /**
         * 仅客户端在 header/footer 之间加入 second；实际是中间位置，虽然测试标题为 beginning。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              <header className="1" />
              {isClient && 'second'}
              <footer className="3" />
            </div>
          );
        }
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
                <header>
          +     second
          -     <footer className="3">
                ...
          ]
            Owner Stack:
              in div (at **)
              in Mismatch (at **)",
          ]
        `);
      });
      /** Given：标题为 middle，但实际客户端 first 文本位于 main/footer 之前；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：HTML mismatch 快照显示 +first/-main，拥有者为 div。目的：按真实输入验证首部文本插入。 */

      // @gate __DEV__

      it('warns when client renders an extra text node in the middle', () => {

        /**
         * 仅客户端在 main/footer 之前加入 first；实际是首部位置，虽然标题为 middle。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              {isClient && 'first'}
              <main className="2" />
              <footer className="3" />
            </div>
          );
        }
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
          +     first
          -     <main className="2">
                ...
          ]
            Owner Stack:
              in div (at **)
              in Mismatch (at **)",
          ]
        `);
      });
      /** Given：服务端已有 header/main，客户端在末尾加入 third 文本；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照保留已有元素并显示 +third，拥有者为 div。目的：验证尾部文本插入的显示。 */

      // @gate __DEV__

      it('warns when client renders an extra text node in the end', () => {

        /**
         * 仅客户端在 header/main 之后加入尾部文本 third。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              <header className="1" />
              <main className="2" />
              {isClient && 'third'}
            </div>
          );
        }
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
                <header>
                <main>
          +     third
          ]
            Owner Stack:
              in div (at **)
              in Mismatch (at **)",
          ]
        `);
      });
    });
  });

  describe('extra nodes on the server', () => {
    describe('extra elements on the server', () => {
      /** Given：服务端 parent 唯一子元素为 main，客户端 parent 为空；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：HTML mismatch 快照显示 -main，拥有者为 div。目的：验证服务端唯一额外元素。 */
      // @gate __DEV__

      it('warns when server renders an extra element as only child', () => {

        /**
         * 仅服务端在 parent 中保留唯一 main。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              {!isClient && <main className="only" />}
            </div>
          );
        }
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
          -     <main className="only">
          ]
            Owner Stack:
              in div (at **)
              in Mismatch (at **)",
          ]
        `);
      });
      /** Given：服务端在 main/footer 前另有 header，客户端省略 header；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照 +main/-header 并省略后续内容，拥有者为 main。目的：验证服务端首部元素导致后续匹配错位。 */

      // @gate __DEV__

      it('warns when server renders an extra element in the beginning', () => {

        /**
         * 仅服务端在 main/footer 前加入 header。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              {!isClient && <header className="1" />}
              <main className="2" />
              <footer className="3" />
            </div>
          );
        }
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
          +     <main className="2">
          -     <header className="1">
                ...
          ]
            Owner Stack:
              in main (at **)
              in Mismatch (at **)",
          ]
        `);
      });
      /** Given：服务端在 header/footer 间另有 main，客户端省略 main；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照保留 header，显示 +footer/-main，拥有者为 footer。目的：验证服务端中间元素的首次差异。 */

      // @gate __DEV__

      it('warns when server renders an extra element in the middle', () => {

        /**
         * 仅服务端在 header/footer 之间加入 main。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              <header className="1" />
              {!isClient && <main className="2" />}
              <footer className="3" />
            </div>
          );
        }
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
                <header>
          +     <footer className="3">
          -     <main className="2">
          ]
            Owner Stack:
              in footer (at **)
              in Mismatch (at **)",
          ]
        `);
      });
      /** Given：服务端在 header/main 后另有 footer，客户端省略 footer；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照显示 -footer，拥有者为 div。目的：验证未消费的服务端尾元素。 */

      // @gate __DEV__

      it('warns when server renders an extra element in the end', () => {

        /**
         * 仅服务端在 header/main 后加入 footer。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              <header className="1" />
              <main className="2" />
              {!isClient && <footer className="3" />}
            </div>
          );
        }
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
          -     <footer className="3">
          ]
            Owner Stack:
              in div (at **)
              in Mismatch (at **)",
          ]
        `);
      });
    });

    describe('extra text nodes on the server', () => {
      /** Given：服务端 parent 唯一子节点是 only 文本，客户端为空；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：HTML mismatch 快照显示 -only，拥有者为 div。目的：验证服务端额外直接文本的尾节点诊断。 */
      // @gate __DEV__

      it('warns when server renders an extra text node as only child', () => {

        /**
         * 仅服务端向 parent 提供唯一文本 only；客户端空树留下多余服务端文本。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return <div className="parent">{!isClient && 'only'}</div>;
        }
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
          -     only
          ]
            Owner Stack:
              in div (at **)
              in Mismatch (at **)",
          ]
        `);
      });
      /** Given：服务端在 main/footer 前有 first 文本，客户端省略；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照 +main/-first 并省略剩余内容，拥有者为 main。目的：验证服务端首部文本与客户端元素冲突。 */

      // @gate __DEV__

      it('warns when server renders an extra text node in the beginning', () => {

        /**
         * 仅服务端在 main/footer 前加入 first 文本。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              {!isClient && 'first'}
              <main className="2" />
              <footer className="3" />
            </div>
          );
        }
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
          +     <main className="2">
          -     first
                ...
          ]
            Owner Stack:
              in main (at **)
              in Mismatch (at **)",
          ]
        `);
      });
      /** Given：服务端在 header/footer 间有 second 文本，客户端省略；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照保留 header，显示 +footer/-second，拥有者为 footer。目的：验证服务端中间文本的差异。 */

      // @gate __DEV__

      it('warns when server renders an extra text node in the middle', () => {

        /**
         * 仅服务端在 header/footer 间加入 second 文本。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              <header className="1" />
              {!isClient && 'second'}
              <footer className="3" />
            </div>
          );
        }
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
                <header>
          +     <footer className="3">
          -     second
          ]
            Owner Stack:
              in footer (at **)
              in Mismatch (at **)",
          ]
        `);
      });
      /** Given：服务端在 header/main 后有 third 文本，客户端省略；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照显示 -third，拥有者为 div。目的：验证服务端尾部额外文本。 */

      // @gate __DEV__

      it('warns when server renders an extra text node in the end', () => {

        /**
         * 仅服务端在 header/main 后加入 third 文本。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              <header className="1" />
              <main className="2" />
              {!isClient && 'third'}
            </div>
          );
        }
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
          -     third
          ]
            Owner Stack:
              in div (at **)
              in Mismatch (at **)",
          ]
        `);
      });
    });
  });

  describe('special nodes', () => {
    describe('Suspense', () => {

      /**
       * 每次调用抛出新建且从不 resolve 的 Promise，迫使对应 Suspense 进入 fallback；用例没有恢复此 Promise 的协议。
       * @returns 不返回；始终挂起。
       */
      function Never() {
        throw new Promise(resolve => {});
      }
      /** Given：服务端 parent 为空，客户端加入已完成主内容的 Suspense/main；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照显示 +Suspense fallback=p，拥有者为 Suspense。目的：验证客户端额外完成边界以边界节点表示。 */

      // @gate __DEV__

      it('warns when client renders an extra Suspense node in content mode', () => {

        /**
         * 仅客户端加入包含就绪 main 的 Suspense，服务端 parent 为空。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              {isClient && (
                <React.Suspense fallback={<p>Loading...</p>}>
                  <main className="only" />
                </React.Suspense>
              )}
            </div>
          );
        }
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
          +     <Suspense fallback={<p>}>
          ]
            Owner Stack:
              in Suspense (at **)
              in Mismatch (at **)",
          ]
        `);
      });
      /** Given：服务端包含已完成 Suspense/main，客户端 parent 为空；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照显示 -Suspense，拥有者为 div。目的：验证服务端额外完成边界的尾节点显示。 */

      // @gate __DEV__

      it('warns when server renders an extra Suspense node in content mode', () => {

        /**
         * 仅服务端加入包含就绪 main 的 Suspense，客户端 parent 为空。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              {!isClient && (
                <React.Suspense fallback={<p>Loading...</p>}>
                  <main className="only" />
                </React.Suspense>
              )}
            </div>
          );
        }
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
          -     <Suspense>
          ]
            Owner Stack:
              in div (at **)
              in Mismatch (at **)",
          ]
        `);
      });
      /** Given：客户端额外 Suspense 内有 main 和永久挂起 Never，服务端没有边界；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照仍显示 +Suspense fallback=p，拥有者为 Suspense。目的：验证挂起边界插入的诊断定位在边界层。 */

      // @gate __DEV__

      it('warns when client renders an extra Suspense node in fallback mode', () => {

        /**
         * 仅客户端加入 main/Never 边界，Never 永久挂起，使额外边界采用 fallback。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              {isClient && (
                <React.Suspense fallback={<p>Loading...</p>}>
                  <main className="only" />
                  <Never />
                </React.Suspense>
              )}
            </div>
          );
        }
        // 差异定位在额外 Suspense 边界；此快照没有展开其内部 fallback。
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
          +     <Suspense fallback={<p>}>
          ]
            Owner Stack:
              in Suspense (at **)
              in Mismatch (at **)",
          ]
        `);
      });
      /** Given：仅服务端 Suspense 含永久挂起 Never，renderToString 输出 fallback；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：当前快照显示 -Suspense，拥有者为 div，没有 template 差异行。目的：验证服务端 fallback 边界的删除诊断，以当前快照为准。 */

      // @gate __DEV__

      it('warns when server renders an extra Suspense node in fallback mode', () => {

        /**
         * 仅服务端加入 main/Never 边界；renderToString 不能等待它，服务端输出 fallback 与中止信息。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              {!isClient && (
                <React.Suspense fallback={<p>Loading...</p>}>
                  <main className="only" />
                  <Never />
                </React.Suspense>
              )}
            </div>
          );
        }

        // 当前诊断将服务端额外 fallback 边界显示为 -Suspense；下方快照没有 template 差异行。
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
          -     <Suspense>
          ]
            Owner Stack:
              in div (at **)
              in Mismatch (at **)",
          ]
        `);
      });
      /** Given：已完成 Suspense 内服务端有 header/footer，客户端中间增加 main；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照在边界内显示 +main/-footer，拥有者为 main。目的：验证边界主内容的中间插入诊断。 */

      // @gate __DEV__

      it('warns when client renders an extra node inside Suspense content', () => {

        /**
         * 两端都有已完成 Suspense；客户端在其 header/footer 间额外插入 main。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              <React.Suspense fallback={<p>Loading...</p>}>
                <header className="1" />
                {isClient && <main className="second" />}
                <footer className="3" />
              </React.Suspense>
            </div>
          );
        }
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
                <Suspense fallback={<p>}>
                  <header>
          +       <main className="second">
          -       <footer className="3">
                  ...
          ]
            Owner Stack:
              in main (at **)
              in Mismatch (at **)",
          ]
        `);
      });
      /** Given：已完成 Suspense 内服务端有 header/main/footer，客户端省略 main；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照在边界内显示 +footer/-main，拥有者为 footer。目的：验证边界主内容的服务端额外节点诊断。 */

      // @gate __DEV__

      it('warns when server renders an extra node inside Suspense content', () => {

        /**
         * 两端都有已完成 Suspense；仅服务端在其 header/footer 间额外插入 main。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              <React.Suspense fallback={<p>Loading...</p>}>
                <header className="1" />
                {!isClient && <main className="second" />}
                <footer className="3" />
              </React.Suspense>
            </div>
          );
        }
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
                <Suspense fallback={<p>}>
                  <header>
          +       <footer className="3">
          -       <main className="second">
          ]
            Owner Stack:
              in footer (at **)
              in Mismatch (at **)",
          ]
        `);
      });
      /** Given：两端 Never 均挂起，客户端 fallback 在 Loading p 后多一个 br；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照仅为 renderToString 不支持等待 Suspense 导致切换客户端渲染的错误，Owner Stack 为 null。目的：验证真实诊断为服务端挂起中止，没有 fallback br 差异快照。 */

      // @gate __DEV__

      it('warns when client renders an extra node inside Suspense fallback', () => {

        /**
         * 两端主内容均含 Never 并挂起；只有客户端 fallback 多 br，实际错误快照来自 renderToString 的挂起中止。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              <React.Suspense
                fallback={
                  <>
                    <p>Loading...</p>
                    {isClient && <br />}
                  </>
                }>
                <main className="only" />
                <Never />
              </React.Suspense>
            </div>
          );
        }

        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Switched to client rendering because the server rendering aborted due to:

          The server used "renderToString" which does not support Suspense. If you intended for this Suspense boundary to render the fallback content on the server consider throwing an Error somewhere within the Suspense boundary. If you intended to have the server wait for the suspended component please switch to "renderToPipeableStream" which supports Suspense on the server]
            Owner Stack: null",
          ]
        `);
      });
      /** Given：两端 Never 均挂起，仅服务端 fallback 在 Loading p 后多 br；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照同样为 renderToString 挂起中止并切换客户端渲染的错误，Owner Stack 为 null。目的：验证该场景没有单独输出 fallback 节点差异。 */

      // @gate __DEV__

      it('warns when server renders an extra node inside Suspense fallback', () => {

        /**
         * 两端主内容均含 Never；只有服务端 fallback 多 br，客户端接管时快照检查中止错误而非 br 差异。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              <React.Suspense
                fallback={
                  <>
                    <p>Loading...</p>
                    {!isClient && <br />}
                  </>
                }>
                <main className="only" />
                <Never />
              </React.Suspense>
            </div>
          );
        }

        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Switched to client rendering because the server rendering aborted due to:

          The server used "renderToString" which does not support Suspense. If you intended for this Suspense boundary to render the fallback content on the server consider throwing an Error somewhere within the Suspense boundary. If you intended to have the server wait for the suspended component please switch to "renderToPipeableStream" which supports Suspense on the server]
            Owner Stack: null",
          ]
        `);
      });
    });

    describe('Fragment', () => {
      /** Given：服务端 parent 为空，客户端增加无包装 Fragment 的 header/main/footer；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照 +header 并省略后续兄弟，拥有者为 header。目的：验证 Fragment 差异落在实际宿主元素而非包装节点。 */
      // @gate __DEV__

      it('warns when client renders an extra Fragment node', () => {

        /**
         * 仅客户端加入含 header/main/footer 的 Fragment；没有对应 DOM 包装节点。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              {isClient && (
                <>
                  <header className="1" />
                  <main className="2" />
                  <footer className="3" />
                </>
              )}
            </div>
          );
        }
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
          +     <header className="1">
                ...
          ]
            Owner Stack:
              in header (at **)
              in Mismatch (at **)",
          ]
        `);
      });
      /** Given：仅服务端 Fragment 含 header/main/footer，客户端 parent 为空；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照逐行 -header/-main/-footer，拥有者为 div。目的：验证 Fragment 的多个尾节点删除展示。 */

      // @gate __DEV__

      it('warns when server renders an extra Fragment node', () => {

        /**
         * 仅服务端加入含 header/main/footer 的 Fragment，形成三个服务端尾节点。
         * @param props - isClient 选择客户端 true 或服务端 false 输入。
         * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
         */
        function Mismatch({isClient}) {
          return (
            <div className="parent">
              {!isClient && (
                <>
                  <header className="1" />
                  <main className="2" />
                  <footer className="3" />
                </>
              )}
            </div>
          );
        }
        expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
          [
            "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

          - A server/client branch \`if (typeof window !== 'undefined')\`.
          - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
          - Date formatting in a user's locale which doesn't match the server.
          - External changing data without sending a snapshot of it along with the HTML.
          - Invalid HTML tag nesting.

          It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

          https://react.dev/link/hydration-mismatch

            <Mismatch isClient={true}>
              <div className="parent">
          -     <header className="1">
          -     <main className="2">
          -     <footer className="3">
          ]
            Owner Stack:
              in div (at **)
              in Mismatch (at **)",
          ]
        `);
      });
    });
  });

  describe('misc cases', () => {
    /** Given：客户端 ProfileSettings 与服务端 MediaSettings 共享 input 和 Panel；仅 profile Panel 多 footer；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照沿 ProfileSettings→Panel 展示 +footer，Owner Stack 为 footer→Panel→ProfileSettings→Mismatch。目的：验证深层客户端额外节点的组件路径。 */
    // @gate __DEV__

    it('warns when client renders an extra node deeper in the tree', () => {

      /**
       * 客户端返回 ProfileSettings、服务端返回 MediaSettings，保持上层 DOM 相似但制造 Panel 深处差异。
       * @param props - isClient 选择客户端 true 或服务端 false 输入。
       * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
       */
      function Mismatch({isClient}) {
        return isClient ? <ProfileSettings /> : <MediaSettings />;
      }

      /**
       * 提供客户端 profile 页面，固定 input 后放 type=profile 的 Panel；该轮 Panel 会额外返回 footer。
       * @returns parent div。
       */
      function ProfileSettings() {
        return (
          <div className="parent">
            <input />
            <Panel type="profile" />
          </div>
        );
      }

      /**
       * 提供服务端 media 页面，固定 input 后放 type=media 的 Panel；该轮 Panel 没有 footer。
       * @returns parent div。
       */
      function MediaSettings() {
        return (
          <div className="parent">
            <input />
            <Panel type="media" />
          </div>
        );
      }

      /**
       * 总是返回 header/main，仅 profile 时补 footer，使额外节点位于组件深处。
       * @param props - type 为 profile 或 media。
       * @returns 无 DOM 包装的 Fragment。
       */
      function Panel({type}) {
        return (
          <>
            <header className="1" />
            <main className="2" />
            {type === 'profile' && <footer className="3" />}
          </>
        );
      }

      expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
        [
          "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

        - A server/client branch \`if (typeof window !== 'undefined')\`.
        - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
        - Date formatting in a user's locale which doesn't match the server.
        - External changing data without sending a snapshot of it along with the HTML.
        - Invalid HTML tag nesting.

        It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

        https://react.dev/link/hydration-mismatch

          <Mismatch isClient={true}>
            <ProfileSettings>
              <div className="parent">
                <input>
                <Panel type="profile">
                  <header>
                  <main>
        +         <footer className="3">
        ]
          Owner Stack:
            in footer (at **)
            in Panel (at **)
            in ProfileSettings (at **)
            in Mismatch (at **)",
        ]
      `);
    });
    /** Given：客户端 ProfileSettings 与服务端 MediaSettings 共用 Panel；仅 media Panel 多 footer；When：DEV 门控下，先以 isClient=false 服务端输出，再用 isClient=true hydration；Then：快照在 parent div 下显示 -footer，Owner Stack 为 div→ProfileSettings→Mismatch。目的：验证深层服务端尾节点的诊断不虚构已缺失组件拥有者。 */

    // @gate __DEV__

    it('warns when server renders an extra node deeper in the tree', () => {

      /**
       * 客户端 profile 与服务端 media 页面分别走同名 Panel，以服务端多余 footer 覆盖尾节点差异。
       * @param props - isClient 选择客户端 true 或服务端 false 输入。
       * @returns 本用例用于服务端输出和客户端 hydration 的元素树。
       */
      function Mismatch({isClient}) {
        return isClient ? <ProfileSettings /> : <MediaSettings />;
      }

      /**
       * 构造客户端 profile 页面，Panel 在这一用例中不返回 footer。
       * @returns input 与 Panel 所在的 parent div。
       */
      function ProfileSettings() {
        return (
          <div className="parent">
            <input />
            <Panel type="profile" />
          </div>
        );
      }

      /**
       * 构造服务端 media 页面，Panel 在这一用例中返回额外 footer。
       * @returns input 与 Panel 所在的 parent div。
       */
      function MediaSettings() {
        return (
          <div className="parent">
            <input />
            <Panel type="media" />
          </div>
        );
      }

      /**
       * 总是返回 header/main，仅非 profile 时补 footer；与前一用例条件相反，制造服务端尾节点。
       * @param props - type 为 profile 或 media。
       * @returns 无 DOM 包装的 Fragment。
       */
      function Panel({type}) {
        return (
          <>
            <header className="1" />
            <main className="2" />
            {type !== 'profile' && <footer className="3" />}
          </>
        );
      }

      expect(testMismatch(Mismatch)).toMatchInlineSnapshot(`
        [
          "Caught [Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:

        - A server/client branch \`if (typeof window !== 'undefined')\`.
        - Variable input such as \`Date.now()\` or \`Math.random()\` which changes each time it's called.
        - Date formatting in a user's locale which doesn't match the server.
        - External changing data without sending a snapshot of it along with the HTML.
        - Invalid HTML tag nesting.

        It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.

        https://react.dev/link/hydration-mismatch

          <Mismatch isClient={true}>
            <ProfileSettings>
              <div className="parent">
        -       <footer className="3">
        ]
          Owner Stack:
            in div (at **)
            in ProfileSettings (at **)
            in Mismatch (at **)",
        ]
      `);
    });
  });
});
