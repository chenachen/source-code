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

/** `util`：保存当前测试场景复用的夹具、状态或回调。 */
const util = require('util');
/** `realConsoleError`：保存当前测试场景复用的夹具、状态或回调。 */
const realConsoleError = console.error;

/** `errorHandler`：封装当前用例复用的操作、回调或断言步骤。 */
function errorHandler() {
  // 转向 console.error 但不要失败测试
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

  /** `normalizeCodeLocInfo`：封装当前用例复用的操作、回调或断言步骤。 */
  function normalizeCodeLocInfo(str) {
    return typeof str === 'string'
      ? str.replace(/\n +(?:at|in) ([\S]+)[^\n]*/g, function (m, name) {
          return '\n    in ' + name + ' (at **)';
        })
      : str;
  }

  /** `formatMessage`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** `formatConsoleErrors`：封装当前用例复用的操作、回调或断言步骤。 */
  function formatConsoleErrors() {
    return console.error.mock.calls.map(formatMessage).filter(Boolean);
  }

  /** `testMismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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
    // @gate __DEV__
    /**
     * 代表场景（Given–When–Then）：
     * Given 当前文件已建立所需 DOM、React 根与测试夹具；
     * When 执行「warns when client and server render different text」描述的渲染或交互；
     * Then 通过本用例的 DOM、日志或调度断言确认行为。
     *
     * 验证机制：断言对应 ReactDOMRoot.hydrateRoot 的容器认领与事件重放路径。
     */
    it('warns when client and server render different text', () => {
      /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate __DEV__
    /** 测试场景：验证「warns when escaping on a checksum mismatch」描述的渲染、交互或错误处理结果。 */
    it('warns when escaping on a checksum mismatch', () => {
      /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate __DEV__
    /** 测试场景：验证「warns when client and server render different html」描述的渲染、交互或错误处理结果。 */
    it('warns when client and server render different html', () => {
      /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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
    // @gate __DEV__
    /** 测试场景：验证「warns when client and server render different attributes」描述的渲染、交互或错误处理结果。 */
    it('warns when client and server render different attributes', () => {
      /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate __DEV__
    /** 测试场景：验证「warns when client renders extra attributes」描述的渲染、交互或错误处理结果。 */
    it('warns when client renders extra attributes', () => {
      /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate __DEV__
    /** 测试场景：验证「warns when server renders extra attributes」描述的渲染、交互或错误处理结果。 */
    it('warns when server renders extra attributes', () => {
      /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate __DEV__
    /** 测试场景：验证「warns when both client and server render extra attributes」描述的渲染、交互或错误处理结果。 */
    it('warns when both client and server render extra attributes', () => {
      /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate __DEV__
    /** 测试场景：验证「warns when client and server render different styles」描述的渲染、交互或错误处理结果。 */
    it('warns when client and server render different styles', () => {
      /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate __DEV__
    /** 测试场景：验证「picks the DFS-first Fiber as the error Owner」描述的渲染、交互或错误处理结果。 */
    it('picks the DFS-first Fiber as the error Owner', () => {
      /** `LeftMismatch`：封装当前用例复用的操作、回调或断言步骤。 */
      function LeftMismatch({isClient}) {
        return <div className={isClient ? 'client' : 'server'} />;
      }

      /** `LeftIndirection`：封装当前用例复用的操作、回调或断言步骤。 */
      function LeftIndirection({isClient}) {
        return <LeftMismatch isClient={isClient} />;
      }

      /** `MiddleMismatch`：封装当前用例复用的操作、回调或断言步骤。 */
      function MiddleMismatch({isClient}) {
        return <span className={isClient ? 'client' : 'server'} />;
      }

      /** `RightMisMatch`：封装当前用例复用的操作、回调或断言步骤。 */
      function RightMisMatch({isClient}) {
        return <p className={isClient ? 'client' : 'server'} />;
      }

      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
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

      // @gate __DEV__
      /** 测试场景：验证「does not warn when nonce matches and CSP hides getAttribute」描述的渲染、交互或错误处理结果。 */
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

      // @gate __DEV__
      /** 测试场景：验证「does not warn when nonce matches without CSP hiding」描述的渲染、交互或错误处理结果。 */
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
      // @gate __DEV__
      /** 测试场景：验证「warns when client renders an extra element as only child」描述的渲染、交互或错误处理结果。 */
      it('warns when client renders an extra element as only child', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

      // @gate __DEV__
      /** 测试场景：验证「warns when client renders an extra element in the beginning」描述的渲染、交互或错误处理结果。 */
      it('warns when client renders an extra element in the beginning', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

      // @gate __DEV__
      /** 测试场景：验证「warns when client renders an extra element in the middle」描述的渲染、交互或错误处理结果。 */
      it('warns when client renders an extra element in the middle', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

      // @gate __DEV__
      /** 测试场景：验证「warns when client renders an extra element in the end」描述的渲染、交互或错误处理结果。 */
      it('warns when client renders an extra element in the end', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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
      // @gate __DEV__
      /** 测试场景：验证「warns when client renders an extra text node as only child」描述的渲染、交互或错误处理结果。 */
      it('warns when client renders an extra text node as only child', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

      // @gate __DEV__
      /** 测试场景：验证「warns when client renders an extra text node in the beginning」描述的渲染、交互或错误处理结果。 */
      it('warns when client renders an extra text node in the beginning', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

      // @gate __DEV__
      /** 测试场景：验证「warns when client renders an extra text node in the middle」描述的渲染、交互或错误处理结果。 */
      it('warns when client renders an extra text node in the middle', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

      // @gate __DEV__
      /** 测试场景：验证「warns when client renders an extra text node in the end」描述的渲染、交互或错误处理结果。 */
      it('warns when client renders an extra text node in the end', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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
      // @gate __DEV__
      /** 测试场景：验证「warns when server renders an extra element as only child」描述的渲染、交互或错误处理结果。 */
      it('warns when server renders an extra element as only child', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

      // @gate __DEV__
      /** 测试场景：验证「warns when server renders an extra element in the beginning」描述的渲染、交互或错误处理结果。 */
      it('warns when server renders an extra element in the beginning', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

      // @gate __DEV__
      /** 测试场景：验证「warns when server renders an extra element in the middle」描述的渲染、交互或错误处理结果。 */
      it('warns when server renders an extra element in the middle', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

      // @gate __DEV__
      /** 测试场景：验证「warns when server renders an extra element in the end」描述的渲染、交互或错误处理结果。 */
      it('warns when server renders an extra element in the end', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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
      // @gate __DEV__
      /** 测试场景：验证「warns when server renders an extra text node as only child」描述的渲染、交互或错误处理结果。 */
      it('warns when server renders an extra text node as only child', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

      // @gate __DEV__
      /** 测试场景：验证「warns when server renders an extra text node in the beginning」描述的渲染、交互或错误处理结果。 */
      it('warns when server renders an extra text node in the beginning', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

      // @gate __DEV__
      /** 测试场景：验证「warns when server renders an extra text node in the middle」描述的渲染、交互或错误处理结果。 */
      it('warns when server renders an extra text node in the middle', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

      // @gate __DEV__
      /** 测试场景：验证「warns when server renders an extra text node in the end」描述的渲染、交互或错误处理结果。 */
      it('warns when server renders an extra text node in the end', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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
      /** `Never`：封装当前用例复用的操作、回调或断言步骤。 */
      function Never() {
        throw new Promise(resolve => {});
      }

      // @gate __DEV__
      /** 测试场景：验证「warns when client renders an extra Suspense node in content mode」描述的渲染、交互或错误处理结果。 */
      it('warns when client renders an extra Suspense node in content mode', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

      // @gate __DEV__
      /** 测试场景：验证「warns when server renders an extra Suspense node in content mode」描述的渲染、交互或错误处理结果。 */
      it('warns when server renders an extra Suspense node in content mode', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

      // @gate __DEV__
      /** 测试场景：验证「warns when client renders an extra Suspense node in fallback mode」描述的渲染、交互或错误处理结果。 */
      it('warns when client renders an extra Suspense node in fallback mode', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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
        // TODO：这条消息似乎没有提供任何有用细节。
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

      // @gate __DEV__
      /** 测试场景：验证「warns when server renders an extra Suspense node in fallback mode」描述的渲染、交互或错误处理结果。 */
      it('warns when server renders an extra Suspense node in fallback mode', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

        // TODO：把 Fizz 错误发送到客户端的改动，会在客户端渲染的 Suspense 边界中插入 template。
        // 这里会泄漏进快照，因为该边界看起来像尚未 hydration 的尾节点，而 template 是首个匹配项。
        // 将来为客户端渲染的 Suspense 边界增加特殊处理后，此测试可能还会变化。
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

      // @gate __DEV__
      /** 测试场景：验证「warns when client renders an extra node inside Suspense content」描述的渲染、交互或错误处理结果。 */
      it('warns when client renders an extra node inside Suspense content', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

      // @gate __DEV__
      /** 测试场景：验证「warns when server renders an extra node inside Suspense content」描述的渲染、交互或错误处理结果。 */
      it('warns when server renders an extra node inside Suspense content', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

      // @gate __DEV__
      /** 测试场景：验证「warns when client renders an extra node inside Suspense fallback」描述的渲染、交互或错误处理结果。 */
      it('warns when client renders an extra node inside Suspense fallback', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

      // @gate __DEV__
      /** 测试场景：验证「warns when server renders an extra node inside Suspense fallback」描述的渲染、交互或错误处理结果。 */
      it('warns when server renders an extra node inside Suspense fallback', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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
      // @gate __DEV__
      /** 测试场景：验证「warns when client renders an extra Fragment node」描述的渲染、交互或错误处理结果。 */
      it('warns when client renders an extra Fragment node', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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

      // @gate __DEV__
      /** 测试场景：验证「warns when server renders an extra Fragment node」描述的渲染、交互或错误处理结果。 */
      it('warns when server renders an extra Fragment node', () => {
        /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
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
    // @gate __DEV__
    /** 测试场景：验证「warns when client renders an extra node deeper in the tree」描述的渲染、交互或错误处理结果。 */
    it('warns when client renders an extra node deeper in the tree', () => {
      /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
      function Mismatch({isClient}) {
        return isClient ? <ProfileSettings /> : <MediaSettings />;
      }

      /** `ProfileSettings`：封装当前用例复用的操作、回调或断言步骤。 */
      function ProfileSettings() {
        return (
          <div className="parent">
            <input />
            <Panel type="profile" />
          </div>
        );
      }

      /** `MediaSettings`：封装当前用例复用的操作、回调或断言步骤。 */
      function MediaSettings() {
        return (
          <div className="parent">
            <input />
            <Panel type="media" />
          </div>
        );
      }

      /** `Panel`：封装当前用例复用的操作、回调或断言步骤。 */
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

    // @gate __DEV__
    /** 测试场景：验证「warns when server renders an extra node deeper in the tree」描述的渲染、交互或错误处理结果。 */
    it('warns when server renders an extra node deeper in the tree', () => {
      /** `Mismatch`：封装当前用例复用的操作、回调或断言步骤。 */
      function Mismatch({isClient}) {
        return isClient ? <ProfileSettings /> : <MediaSettings />;
      }

      /** `ProfileSettings`：封装当前用例复用的操作、回调或断言步骤。 */
      function ProfileSettings() {
        return (
          <div className="parent">
            <input />
            <Panel type="profile" />
          </div>
        );
      }

      /** `MediaSettings`：封装当前用例复用的操作、回调或断言步骤。 */
      function MediaSettings() {
        return (
          <div className="parent">
            <input />
            <Panel type="media" />
          </div>
        );
      }

      /** `Panel`：封装当前用例复用的操作、回调或断言步骤。 */
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
