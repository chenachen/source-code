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

/** `ReactDOMServerIntegrationUtils`：保存当前测试场景复用的夹具、状态或回调。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

/** `TEXT_NODE_TYPE`：保存当前测试场景复用的夹具、状态或回调。 */
const TEXT_NODE_TYPE = 3;

let React;
let ReactDOM;
let ReactDOMClient;
let ReactDOMServer;
let assertConsoleErrorDev;

/** `initModules`：封装当前用例复用的操作、回调或断言步骤。 */
function initModules() {
  jest.resetModules();
  React = require('react');
  ReactDOM = require('react-dom');
  ReactDOMClient = require('react-dom/client');
  ReactDOMServer = require('react-dom/server');
  assertConsoleErrorDev = require('internal-test-utils').assertConsoleErrorDev;

  // 让他们可以帮助.
  return {
    ReactDOMClient,
    ReactDOMServer,
  };
}

/** `{ resetModules, itRenders, itThrowsWhenRendering, serverRender, streamRender, clientCleanRender, clientRenderOnServerString, }`：保存当前测试场景复用的夹具、状态或回调。 */
const {
  resetModules,
  itRenders,
  itThrowsWhenRendering,
  serverRender,
  streamRender,
  clientCleanRender,
  clientRenderOnServerString,
} = ReactDOMServerIntegrationUtils(initModules);

describe('ReactDOMServerIntegration', () => {
  beforeEach(() => {
    resetModules();
  });

  afterEach(() => {
    // TODO：这是临时规避方案，因为 expectErrors 不会恢复 mock；彻底修复需要大规模重构这些测试。
    if (console.error.mockClear) {
      console.error.mockRestore();
    }
  });

  describe('elements and children', function () {
    /** `expectNode`：封装当前用例复用的操作、回调或断言步骤。 */
    function expectNode(node, type, value) {
      expect(node).not.toBe(null);
      expect(node.nodeType).toBe(type);
      expect(node.nodeValue).toMatch(value);
    }

    /** `expectTextNode`：封装当前用例复用的操作、回调或断言步骤。 */
    function expectTextNode(node, text) {
      expectNode(node, TEXT_NODE_TYPE, text);
    }

    describe('text children', function () {
      /**
       * 代表场景（Given–When–Then）：
       * Given `itRenders` 展开服务端字符串、客户端全新渲染及 hydration 场景；
       * When 渲染包含文本的 div；
       * Then 断言元素类型与文本节点在各模式中一致。
       *
       * 验证机制：`ReactDOMServerIntegrationTestUtils.js` 驱动 server/client 适配层并比较真实 DOM；
       * 完整 Fizz 状态机位于范围外的 `packages/react-server`。
       */
      itRenders('a div with text', async render => {
        const e = await render(<div>Text</div>);
        expect(e.tagName).toBe('DIV');
        expect(e.childNodes.length).toBe(1);
        expectNode(e.firstChild, TEXT_NODE_TYPE, 'Text');
      });

      itRenders('a div with text with flanking whitespace', async render => {
        // prettier-ignore
        const e = await render(<div>  Text </div>);
        expect(e.childNodes.length).toBe(1);
        expectNode(e.childNodes[0], TEXT_NODE_TYPE, '  Text ');
      });

      itRenders('a div with an empty text child', async render => {
        const e = await render(<div>{''}</div>);
        expect(e.childNodes.length).toBe(0);
      });

      itRenders('a div with multiple empty text children', async render => {
        const e = await render(
          <div>
            {''}
            {''}
            {''}
          </div>,
        );
        expect(e.childNodes.length).toBe(0);
        expect(e.textContent).toBe('');
      });

      itRenders('a div with multiple whitespace children', async render => {
        // prettier-ignore
        const e = await render(<div>{' '}{' '}{' '}</div>);
        if (
          render === serverRender ||
          render === clientRenderOnServerString ||
          render === streamRender
        ) {
          // 纯服务器标记会在它们之间包含注释；若能进行 hydration，这些注释会保留下来。
          expect(e.childNodes.length).toBe(5);
          expectTextNode(e.childNodes[0], ' ');
          expectTextNode(e.childNodes[2], ' ');
          expectTextNode(e.childNodes[4], ' ');
        } else {
          expect(e.childNodes.length).toBe(3);
          expectTextNode(e.childNodes[0], ' ');
          expectTextNode(e.childNodes[1], ' ');
          expectTextNode(e.childNodes[2], ' ');
        }
      });

      itRenders('a div with text sibling to a node', async render => {
        const e = await render(
          <div>
            Text<span>More Text</span>
          </div>,
        );
        expect(e.childNodes.length).toBe(2);
        const spanNode = e.childNodes[1];
        expectTextNode(e.childNodes[0], 'Text');
        expect(spanNode.tagName).toBe('SPAN');
        expect(spanNode.childNodes.length).toBe(1);
        expectNode(spanNode.firstChild, TEXT_NODE_TYPE, 'More Text');
      });

      itRenders('a non-standard element with text', async render => {
        // 此测试套件通常假设 SSR + innerHTML、hydration 和客户端渲染等所有场景都会产生完全相同的
        // 警告（或都没有警告）。但这个特定警告只会在客户端创建 DOM 节点时触发，因此先在这里触发，
        // 使它随后被去重而不致令测试失败。
        ReactDOM.flushSync(() => {
          const root = ReactDOMClient.createRoot(document.createElement('div'));
          root.render(<nonstandard />);
        });
        assertConsoleErrorDev([
          'The tag <nonstandard> is unrecognized in this browser. ' +
            'If you meant to render a React component, start its name with an uppercase letter.\n' +
            '    in nonstandard (at **)',
        ]);

        const e = await render(<nonstandard>Text</nonstandard>);
        expect(e.tagName).toBe('NONSTANDARD');
        expect(e.childNodes.length).toBe(1);
        expectNode(e.firstChild, TEXT_NODE_TYPE, 'Text');
      });

      itRenders('a custom element with text', async render => {
        const e = await render(<custom-element>Text</custom-element>);
        expect(e.tagName).toBe('CUSTOM-ELEMENT');
        expect(e.childNodes.length).toBe(1);
        expectNode(e.firstChild, TEXT_NODE_TYPE, 'Text');
      });

      itRenders('a leading blank child with a text sibling', async render => {
        const e = await render(<div>{''}foo</div>);
        expect(e.childNodes.length).toBe(1);
        expectTextNode(e.childNodes[0], 'foo');
      });

      itRenders('a trailing blank child with a text sibling', async render => {
        const e = await render(<div>foo{''}</div>);
        expect(e.childNodes.length).toBe(1);
        expectTextNode(e.childNodes[0], 'foo');
      });

      itRenders('an element with two text children', async render => {
        const e = await render(
          <div>
            {'foo'}
            {'bar'}
          </div>,
        );
        if (
          render === serverRender ||
          render === clientRenderOnServerString ||
          render === streamRender
        ) {
          // 在服务器渲染输出中有一个注释。
          expect(e.childNodes.length).toBe(3);
          expectTextNode(e.childNodes[0], 'foo');
          expectTextNode(e.childNodes[2], 'bar');
        } else {
          expect(e.childNodes.length).toBe(2);
          expectTextNode(e.childNodes[0], 'foo');
          expectTextNode(e.childNodes[1], 'bar');
        }
      });

      itRenders(
        'a component returning text node between two text nodes',
        async render => {
          /** `B`：封装当前用例复用的操作、回调或断言步骤。 */
          const B = () => 'b';
          const e = await render(
            <div>
              {'a'}
              <B />
              {'c'}
            </div>,
          );
          if (
            render === serverRender ||
            render === clientRenderOnServerString ||
            render === streamRender
          ) {
            // 在服务器渲染输出中有一个注释。
            expect(e.childNodes.length).toBe(5);
            expectTextNode(e.childNodes[0], 'a');
            expectTextNode(e.childNodes[2], 'b');
            expectTextNode(e.childNodes[4], 'c');
          } else {
            expect(e.childNodes.length).toBe(3);
            expectTextNode(e.childNodes[0], 'a');
            expectTextNode(e.childNodes[1], 'b');
            expectTextNode(e.childNodes[2], 'c');
          }
        },
      );

      itRenders('a tree with sibling host and text nodes', async render => {
        /** `X`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
        class X extends React.Component {
          /** `X.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
          render() {
            return [null, [<Y key="1" />], false];
          }
        }

        /** `Y`：封装当前用例复用的操作、回调或断言步骤。 */
        function Y() {
          return [<Z key="1" />, ['c']];
        }

        /** `Z`：封装当前用例复用的操作、回调或断言步骤。 */
        function Z() {
          return null;
        }

        const e = await render(
          <div>
            {[['a'], 'b']}
            <div>
              <X key="1" />d
            </div>
            e
          </div>,
        );
        if (
          render === serverRender ||
          render === streamRender ||
          render === clientRenderOnServerString
        ) {
          // 在服务器渲染输出中，文本节点之间有注释。
          expect(e.childNodes.length).toBe(5);
          expectTextNode(e.childNodes[0], 'a');
          expectTextNode(e.childNodes[2], 'b');
          expect(e.childNodes[3].childNodes.length).toBe(3);
          expectTextNode(e.childNodes[3].childNodes[0], 'c');
          expectTextNode(e.childNodes[3].childNodes[2], 'd');
          expectTextNode(e.childNodes[4], 'e');
        } else {
          expect(e.childNodes.length).toBe(4);
          expectTextNode(e.childNodes[0], 'a');
          expectTextNode(e.childNodes[1], 'b');
          expect(e.childNodes[2].childNodes.length).toBe(2);
          expectTextNode(e.childNodes[2].childNodes[0], 'c');
          expectTextNode(e.childNodes[2].childNodes[1], 'd');
          expectTextNode(e.childNodes[3], 'e');
        }
      });
    });

    describe('number children', function () {
      itRenders('a number as single child', async render => {
        const e = await render(<div>{3}</div>);
        expect(e.textContent).toBe('3');
      });

      // 零是假值。 这意味着，如果代码不够小心，它可能会看起来没有子节点。
      itRenders('zero as single child', async render => {
        const e = await render(<div>{0}</div>);
        expect(e.textContent).toBe('0');
      });

      itRenders('an element with number and text children', async render => {
        const e = await render(
          <div>
            {'foo'}
            {40}
          </div>,
        );
        // 使用 Fiber 时只有两个文本节点。
        if (
          render === serverRender ||
          render === clientRenderOnServerString ||
          render === streamRender
        ) {
          // 在服务器标记之间有一个注释。
          expect(e.childNodes.length).toBe(3);
          expectTextNode(e.childNodes[0], 'foo');
          expectTextNode(e.childNodes[2], '40');
        } else {
          expect(e.childNodes.length).toBe(2);
          expectTextNode(e.childNodes[0], 'foo');
          expectTextNode(e.childNodes[1], '40');
        }
      });
    });

    describe('null, false, and undefined children', function () {
      itRenders('null single child as blank', async render => {
        const e = await render(<div>{null}</div>);
        expect(e.childNodes.length).toBe(0);
      });

      itRenders('false single child as blank', async render => {
        const e = await render(<div>{false}</div>);
        expect(e.childNodes.length).toBe(0);
      });

      itRenders('undefined single child as blank', async render => {
        const e = await render(<div>{undefined}</div>);
        expect(e.childNodes.length).toBe(0);
      });

      itRenders('a null component children as empty', async render => {
        /** `NullComponent`：封装当前用例复用的操作、回调或断言步骤。 */
        const NullComponent = () => null;
        const e = await render(
          <div>
            <NullComponent />
          </div>,
        );
        expect(e.childNodes.length).toBe(0);
      });

      itRenders('null children as blank', async render => {
        const e = await render(<div>{null}foo</div>);
        expect(e.childNodes.length).toBe(1);
        expectTextNode(e.childNodes[0], 'foo');
      });

      itRenders('false children as blank', async render => {
        const e = await render(<div>{false}foo</div>);
        expect(e.childNodes.length).toBe(1);
        expectTextNode(e.childNodes[0], 'foo');
      });

      itRenders('null and false children together as blank', async render => {
        const e = await render(
          <div>
            {false}
            {null}foo{null}
            {false}
          </div>,
        );
        expect(e.childNodes.length).toBe(1);
        expectTextNode(e.childNodes[0], 'foo');
      });

      itRenders('only null and false children as blank', async render => {
        const e = await render(
          <div>
            {false}
            {null}
            {null}
            {false}
          </div>,
        );
        expect(e.childNodes.length).toBe(0);
      });
    });

    describe('elements with implicit namespaces', function () {
      itRenders('an svg element', async render => {
        const e = await render(<svg />);
        expect(e.childNodes.length).toBe(0);
        expect(e.tagName).toBe('svg');
        expect(e.namespaceURI).toBe('http://www.w3.org/2000/svg');
      });

      itRenders('svg child element with an attribute', async render => {
        const e = await render(<svg viewBox="0 0 0 0" />);
        expect(e.childNodes.length).toBe(0);
        expect(e.tagName).toBe('svg');
        expect(e.namespaceURI).toBe('http://www.w3.org/2000/svg');
        expect(e.getAttribute('viewBox')).toBe('0 0 0 0');
      });

      itRenders(
        'svg child element with a namespace attribute',
        async render => {
          let e = await render(
            <svg>
              <image xlinkHref="http://i.imgur.com/w7GCRPb.png" />
            </svg>,
          );
          e = e.firstChild;
          expect(e.childNodes.length).toBe(0);
          expect(e.tagName).toBe('image');
          expect(e.namespaceURI).toBe('http://www.w3.org/2000/svg');
          expect(e.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe(
            'http://i.imgur.com/w7GCRPb.png',
          );
        },
      );

      itRenders('svg child element with a badly cased alias', async render => {
        let e = await render(
          <svg>
            <image xlinkhref="http://i.imgur.com/w7GCRPb.png" />
          </svg>,
          1,
        );
        e = e.firstChild;
        expect(e.hasAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe(
          false,
        );
        expect(e.getAttribute('xlinkhref')).toBe(
          'http://i.imgur.com/w7GCRPb.png',
        );
      });

      itRenders('svg element with a tabIndex attribute', async render => {
        const e = await render(<svg tabIndex="1" />);
        expect(e.tabIndex).toBe(1);
      });

      itRenders(
        'svg element with a badly cased tabIndex attribute',
        async render => {
          const e = await render(<svg tabindex="1" />, 1);
          expect(e.tabIndex).toBe(1);
        },
      );

      itRenders('svg element with a mixed case name', async render => {
        let e = await render(
          <svg>
            <filter>
              <feMorphology />
            </filter>
          </svg>,
        );
        e = e.firstChild.firstChild;
        expect(e.childNodes.length).toBe(0);
        expect(e.tagName).toBe('feMorphology');
        expect(e.namespaceURI).toBe('http://www.w3.org/2000/svg');
      });

      itRenders('a math element', async render => {
        const e = await render(<math />);
        expect(e.childNodes.length).toBe(0);
        expect(e.tagName).toBe('math');
        expect(e.namespaceURI).toBe('http://www.w3.org/1998/Math/MathML');
      });
    });
    // 特殊包装的组件（参见 ReactDOMComponent.mountComponent 开头附近的大型 switch）
    itRenders('an img', async render => {
      const e = await render(<img />);
      expect(e.childNodes.length).toBe(0);
      expect(e.nextSibling).toBe(null);
      expect(e.tagName).toBe('IMG');
    });

    itRenders('a button', async render => {
      const e = await render(<button />);
      expect(e.childNodes.length).toBe(0);
      expect(e.nextSibling).toBe(null);
      expect(e.tagName).toBe('BUTTON');
    });

    itRenders('a div with dangerouslySetInnerHTML number', async render => {
      // 将 dangerouslySetInnerHTML 下移一层；否则从错误标记进行 hydration 会造成 mismatch，因为
      // 我们不会像修补文本内容那样修补 dangerouslySetInnerHTML。
      const e = (
        await render(
          <div>
            <span dangerouslySetInnerHTML={{__html: 0}} />
          </div>,
        )
      ).firstChild;
      expect(e.childNodes.length).toBe(1);
      expect(e.firstChild.nodeType).toBe(TEXT_NODE_TYPE);
      expect(e.textContent).toBe('0');
    });

    itRenders('a div with dangerouslySetInnerHTML boolean', async render => {
      // 将 dangerouslySetInnerHTML 下移一层；否则从错误标记进行 hydration 会造成 mismatch，因为
      // 我们不会像修补文本内容那样修补 dangerouslySetInnerHTML。
      const e = (
        await render(
          <div>
            <span dangerouslySetInnerHTML={{__html: false}} />
          </div>,
        )
      ).firstChild;
      expect(e.childNodes.length).toBe(1);
      expect(e.firstChild.nodeType).toBe(TEXT_NODE_TYPE);
      expect(e.firstChild.data).toBe('false');
    });

    itRenders(
      'a div with dangerouslySetInnerHTML text string',
      async render => {
        // 将 dangerouslySetInnerHTML 下移一层；否则从错误标记进行 hydration 会造成 mismatch，因为
        // 我们不会像修补文本内容那样修补 dangerouslySetInnerHTML。
        const e = (
          await render(
            <div>
              <span dangerouslySetInnerHTML={{__html: 'hello'}} />
            </div>,
          )
        ).firstChild;
        expect(e.childNodes.length).toBe(1);
        expect(e.firstChild.nodeType).toBe(TEXT_NODE_TYPE);
        expect(e.textContent).toBe('hello');
      },
    );

    itRenders(
      'a div with dangerouslySetInnerHTML element string',
      async render => {
        const e = await render(
          <div dangerouslySetInnerHTML={{__html: "<span id='child'/>"}} />,
        );
        expect(e.childNodes.length).toBe(1);
        expect(e.firstChild.tagName).toBe('SPAN');
        expect(e.firstChild.getAttribute('id')).toBe('child');
        expect(e.firstChild.childNodes.length).toBe(0);
      },
    );

    itRenders('a div with dangerouslySetInnerHTML object', async render => {
      const obj = {
        /** `toString`：实现测试夹具的生命周期、渲染或交互步骤。 */
        toString() {
          return "<span id='child'/>";
        },
      };
      const e = await render(<div dangerouslySetInnerHTML={{__html: obj}} />);
      expect(e.childNodes.length).toBe(1);
      expect(e.firstChild.tagName).toBe('SPAN');
      expect(e.firstChild.getAttribute('id')).toBe('child');
      expect(e.firstChild.childNodes.length).toBe(0);
    });

    itRenders(
      'a div with dangerouslySetInnerHTML set to null',
      async render => {
        const e = await render(
          <div dangerouslySetInnerHTML={{__html: null}} />,
        );
        expect(e.childNodes.length).toBe(0);
      },
    );

    itRenders(
      'a div with dangerouslySetInnerHTML set to undefined',
      async render => {
        const e = await render(
          <div dangerouslySetInnerHTML={{__html: undefined}} />,
        );
        expect(e.childNodes.length).toBe(0);
      },
    );

    itRenders('a noscript with children', async render => {
      const e = await render(
        <noscript>
          <div>Enable JavaScript to run this app.</div>
        </noscript>,
      );
      if (render === clientCleanRender) {
        // 在客户端上会忽略 noscript 的内容。
        expect(e.childNodes.length).toBe(0);
      } else {
        // 在服务器端或在内容被hydration时应正确。
        expect(e.childNodes.length).toBe(1);
        expect(e.firstChild.textContent).toBe(
          '<div>Enable JavaScript to run this app.</div>',
        );
      }
    });

    describe('newline-eating elements', function () {
      itRenders(
        'a newline-eating tag with content not starting with \\n',
        async render => {
          const e = await render(<pre>Hello</pre>);
          expect(e.textContent).toBe('Hello');
        },
      );
      itRenders(
        'a newline-eating tag with content starting with \\n',
        async render => {
          const e = await render(<pre>{'\nHello'}</pre>);
          expect(e.textContent).toBe('\nHello');
        },
      );
      itRenders('a normal tag with content starting with \\n', async render => {
        const e = await render(<div>{'\nHello'}</div>);
        expect(e.textContent).toBe('\nHello');
      });
    });

    describe('different component implementations', function () {
      /** `checkFooDiv`：封装当前用例复用的操作、回调或断言步骤。 */
      function checkFooDiv(e) {
        expect(e.childNodes.length).toBe(1);
        expectNode(e.firstChild, TEXT_NODE_TYPE, 'foo');
      }

      itRenders('stateless components', async render => {
        /** `FunctionComponent`：封装当前用例复用的操作、回调或断言步骤。 */
        const FunctionComponent = () => <div>foo</div>;
        checkFooDiv(await render(<FunctionComponent />));
      });

      itRenders('ES6 class components', async render => {
        /** `ClassComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
        class ClassComponent extends React.Component {
          /** `ClassComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
          render() {
            return <div>foo</div>;
          }
        }
        checkFooDiv(await render(<ClassComponent />));
      });

      itThrowsWhenRendering(
        'factory components',
        async render => {
          /** `FactoryComponent`：封装当前用例复用的操作、回调或断言步骤。 */
          const FactoryComponent = () => {
            return {
              /** `FactoryComponent.render`：封装当前用例复用的操作、回调或断言步骤。 */
              render: function () {
                return <div>foo</div>;
              },
            };
          };
          await render(<FactoryComponent />, 1);
        },
        'Objects are not valid as a React child (found: object with keys {render})',
      );
    });

    describe('component hierarchies', function () {
      itRenders('single child hierarchies of components', async render => {
        /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
        const Component = props => <div>{props.children}</div>;
        let e = await render(
          <Component>
            <Component>
              <Component>
                <Component />
              </Component>
            </Component>
          </Component>,
        );
        for (let i = 0; i < 3; i++) {
          expect(e.tagName).toBe('DIV');
          expect(e.childNodes.length).toBe(1);
          e = e.firstChild;
        }
        expect(e.tagName).toBe('DIV');
        expect(e.childNodes.length).toBe(0);
      });

      itRenders('multi-child hierarchies of components', async render => {
        /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
        const Component = props => <div>{props.children}</div>;
        const e = await render(
          <Component>
            <Component>
              <Component />
              <Component />
            </Component>
            <Component>
              <Component />
              <Component />
            </Component>
          </Component>,
        );
        expect(e.tagName).toBe('DIV');
        expect(e.childNodes.length).toBe(2);
        for (let i = 0; i < 2; i++) {
          const child = e.childNodes[i];
          expect(child.tagName).toBe('DIV');
          expect(child.childNodes.length).toBe(2);
          for (let j = 0; j < 2; j++) {
            const grandchild = child.childNodes[j];
            expect(grandchild.tagName).toBe('DIV');
            expect(grandchild.childNodes.length).toBe(0);
          }
        }
      });

      itRenders('a div with a child', async render => {
        const e = await render(
          <div id="parent">
            <div id="child" />
          </div>,
        );
        expect(e.id).toBe('parent');
        expect(e.childNodes.length).toBe(1);
        expect(e.childNodes[0].id).toBe('child');
        expect(e.childNodes[0].childNodes.length).toBe(0);
      });

      itRenders('a div with multiple children', async render => {
        const e = await render(
          <div id="parent">
            <div id="child1" />
            <div id="child2" />
          </div>,
        );
        expect(e.id).toBe('parent');
        expect(e.childNodes.length).toBe(2);
        expect(e.childNodes[0].id).toBe('child1');
        expect(e.childNodes[0].childNodes.length).toBe(0);
        expect(e.childNodes[1].id).toBe('child2');
        expect(e.childNodes[1].childNodes.length).toBe(0);
      });

      itRenders(
        'a div with multiple children separated by whitespace',
        async render => {
          const e = await render(
            <div id="parent">
              <div id="child1" /> <div id="child2" />
            </div>,
          );
          expect(e.id).toBe('parent');
          expect(e.childNodes.length).toBe(3);
          const child1 = e.childNodes[0];
          const textNode = e.childNodes[1];
          const child2 = e.childNodes[2];
          expect(child1.id).toBe('child1');
          expect(child1.childNodes.length).toBe(0);
          expectTextNode(textNode, ' ');
          expect(child2.id).toBe('child2');
          expect(child2.childNodes.length).toBe(0);
        },
      );

      itRenders(
        'a div with a single child surrounded by whitespace',
        async render => {
          // prettier-ignore
          const e = await render(<div id="parent">  <div id="child" />   </div>);
          expect(e.childNodes.length).toBe(3);
          const textNode1 = e.childNodes[0];
          const child = e.childNodes[1];
          const textNode2 = e.childNodes[2];
          expect(e.id).toBe('parent');
          expectTextNode(textNode1, '  ');
          expect(child.id).toBe('child');
          expect(child.childNodes.length).toBe(0);
          expectTextNode(textNode2, '   ');
        },
      );

      itRenders('a composite with multiple children', async render => {
        /** `Component`：封装当前用例复用的操作、回调或断言步骤。 */
        const Component = props => props.children;
        const e = await render(
          <Component>{['a', 'b', [undefined], [[false, 'c']]]}</Component>,
        );

        const parent = e.parentNode;
        if (
          render === serverRender ||
          render === clientRenderOnServerString ||
          render === streamRender
        ) {
          // 纯服务器标记会在它们之间包含注释；若能进行 hydration，这些注释会保留下来。
          expect(parent.childNodes.length).toBe(5);
          expectTextNode(parent.childNodes[0], 'a');
          expectTextNode(parent.childNodes[2], 'b');
          expectTextNode(parent.childNodes[4], 'c');
        } else {
          expect(parent.childNodes.length).toBe(3);
          expectTextNode(parent.childNodes[0], 'a');
          expectTextNode(parent.childNodes[1], 'b');
          expectTextNode(parent.childNodes[2], 'c');
        }
      });
    });

    describe('escaping >, <, and &', function () {
      itRenders('>,<, and & as single child', async render => {
        const e = await render(<div>{'<span>Text&quot;</span>'}</div>);
        expect(e.childNodes.length).toBe(1);
        expectNode(e.firstChild, TEXT_NODE_TYPE, '<span>Text&quot;</span>');
      });

      itRenders('>,<, and & as multiple children', async render => {
        const e = await render(
          <div>
            {'<span>Text1&quot;</span>'}
            {'<span>Text2&quot;</span>'}
          </div>,
        );
        if (
          render === serverRender ||
          render === clientRenderOnServerString ||
          render === streamRender
        ) {
          expect(e.childNodes.length).toBe(3);
          expectTextNode(e.childNodes[0], '<span>Text1&quot;</span>');
          expectTextNode(e.childNodes[2], '<span>Text2&quot;</span>');
        } else {
          expect(e.childNodes.length).toBe(2);
          expectTextNode(e.childNodes[0], '<span>Text1&quot;</span>');
          expectTextNode(e.childNodes[1], '<span>Text2&quot;</span>');
        }
      });
    });

    describe('carriage return and null character', () => {
      // HTML 解析会把 CR 和 CRLF 规范化为 LF，也会忽略 null 字符：
      // https://www.w3.org/TR/html5/single-page.html#preprocessing-the-input-stream
      // mismatch 可能由此引起（不应报告）；这里不会修补，因为这与以往行为一致。

      itRenders(
        'an element with one text child with special characters',
        async render => {
          const e = await render(<div>{'foo\rbar\r\nbaz\nqux\u0000'}</div>);
          if (
            render === serverRender ||
            render === streamRender ||
            render === clientRenderOnServerString
          ) {
            expect(e.childNodes.length).toBe(1);
            // 从服务器 HTML 解析或进行 hydration 时都会变成 LF；null 字符会被忽略。
            expectNode(e.childNodes[0], TEXT_NODE_TYPE, 'foo\nbar\nbaz\nqux');
          } else {
            expect(e.childNodes.length).toBe(1);
            // 客户端渲染使用具有 CR 的 JS 值。 null 字符会保留。

            expectNode(
              e.childNodes[0],
              TEXT_NODE_TYPE,
              'foo\rbar\r\nbaz\nqux\u0000',
            );
          }
        },
      );

      itRenders(
        'an element with two text children with special characters',
        async render => {
          const e = await render(
            <div>
              {'foo\rbar'}
              {'\r\nbaz\nqux\u0000'}
            </div>,
          );
          if (
            render === serverRender ||
            render === streamRender ||
            render === clientRenderOnServerString
          ) {
            // 我们有三个节点,因为它们之间有一个评论.
            expect(e.childNodes.length).toBe(3);
            // 从服务器 HTML 解析或进行 hydration 时都会变成 LF；null 字符会被忽略。
            expectNode(e.childNodes[0], TEXT_NODE_TYPE, 'foo\nbar');
            expectNode(e.childNodes[2], TEXT_NODE_TYPE, '\nbaz\nqux');
          } else if (render === clientRenderOnServerString) {
            // 我们有三个节点,因为它们之间有一个评论.
            expect(e.childNodes.length).toBe(3);
            // Hydration 使用带有 CR 和 null 字符的 JavaScript 值。

            expectNode(e.childNodes[0], TEXT_NODE_TYPE, 'foo\rbar');
            expectNode(e.childNodes[2], TEXT_NODE_TYPE, '\r\nbaz\nqux\u0000');
          } else {
            expect(e.childNodes.length).toBe(2);
            // 客户端渲染使用带有 CR 和 null 字符的 JavaScript 值。
            expectNode(e.childNodes[0], TEXT_NODE_TYPE, 'foo\rbar');
            expectNode(e.childNodes[1], TEXT_NODE_TYPE, '\r\nbaz\nqux\u0000');
          }
        },
      );

      itRenders(
        'an element with an attribute value with special characters',
        async render => {
          const e = await render(<a title={'foo\rbar\r\nbaz\nqux\u0000'} />);
          if (
            render === serverRender ||
            render === streamRender ||
            render === clientRenderOnServerString
          ) {
            // 一切都被解析为 LF 时，从服务器获取。 在属性中出现的 null 字节会被替换为替换字符。 Hydration
            // 也以 LF 结尾，因为我们没有修复属性。
            expect(e.title).toBe('foo\nbar\nbaz\nqux\uFFFD');
          } else {
            // 客户端渲染使用带有 CR 和 null 字符的 JavaScript 值。
            expect(e.title).toBe('foo\rbar\r\nbaz\nqux\u0000');
          }
        },
      );
    });

    describe('components that render nullish', function () {
      itRenders('a function returning null', async render => {
        /** `NullComponent`：封装当前用例复用的操作、回调或断言步骤。 */
        const NullComponent = () => null;
        await render(<NullComponent />);
      });

      itRenders('a class returning null', async render => {
        /** `NullComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
        class NullComponent extends React.Component {
          /** `NullComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
          render() {
            return null;
          }
        }
        await render(<NullComponent />);
      });

      itRenders('a function returning undefined', async render => {
        /** `UndefinedComponent`：封装当前用例复用的操作、回调或断言步骤。 */
        const UndefinedComponent = () => undefined;
        await render(<UndefinedComponent />);
      });

      itRenders('a class returning undefined', async render => {
        /** `UndefinedComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
        class UndefinedComponent extends React.Component {
          /** `UndefinedComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
          render() {
            return undefined;
          }
        }
        await render(<UndefinedComponent />);
      });
    });

    describe('components that throw errors', function () {
      itThrowsWhenRendering(
        'a function returning an object',
        async render => {
          /** `ObjectComponent`：封装当前用例复用的操作、回调或断言步骤。 */
          const ObjectComponent = () => ({x: 123});
          await render(<ObjectComponent />, 1);
        },
        'Objects are not valid as a React child (found: object with keys {x}).' +
          (__DEV__
            ? ' If you meant to render a collection of children, use ' +
              'an array instead.'
            : ''),
      );

      itThrowsWhenRendering(
        'a class returning an object',
        async render => {
          /** `ObjectComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
          class ObjectComponent extends React.Component {
            /** `ObjectComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
            render() {
              return {x: 123};
            }
          }
          await render(<ObjectComponent />, 1);
        },
        'Objects are not valid as a React child (found: object with keys {x}).' +
          (__DEV__
            ? ' If you meant to render a collection of children, use ' +
              'an array instead.'
            : ''),
      );

      itThrowsWhenRendering(
        'top-level object',
        async render => {
          await render({x: 123});
        },
        'Objects are not valid as a React child (found: object with keys {x}).' +
          (__DEV__
            ? ' If you meant to render a collection of children, use ' +
              'an array instead.'
            : ''),
      );
    });

    describe('badly-typed elements', function () {
      itThrowsWhenRendering(
        'object',
        async render => {
          let EmptyComponent = {};
          EmptyComponent = <EmptyComponent />;
          await render(EmptyComponent);
        },
        'Element type is invalid: expected a string (for built-in components) or a class/function ' +
          '(for composite components) but got: object.' +
          (__DEV__
            ? " You likely forgot to export your component from the file it's defined in, " +
              'or you might have mixed up default and named imports.'
            : ''),
      );

      itThrowsWhenRendering(
        'null',
        async render => {
          let NullComponent = null;
          NullComponent = <NullComponent />;
          await render(NullComponent);
        },
        'Element type is invalid: expected a string (for built-in components) or a class/function ' +
          '(for composite components) but got: null',
      );

      itThrowsWhenRendering(
        'undefined',
        async render => {
          let UndefinedComponent = undefined;
          UndefinedComponent = <UndefinedComponent />;
          await render(UndefinedComponent);
        },
        'Element type is invalid: expected a string (for built-in components) or a class/function ' +
          '(for composite components) but got: undefined.' +
          (__DEV__
            ? " You likely forgot to export your component from the file it's defined in, " +
              'or you might have mixed up default and named imports.'
            : ''),
      );
    });
  });
});
