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

/** 集成测试工厂；itRenders展开SSR字符串/流、全新客户端、匹配与错误标记hydration，错误标记模式只核对恢复文本后提前拒绝，后续DOM断言不在该模式执行。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

/** DOM Text节点的nodeType标准值3；用于区分文本、宿主元素与SSR插入的注释分隔节点。 */
const TEXT_NODE_TYPE = 3;

let React;
let ReactDOM;
let ReactDOMClient;
let ReactDOMServer;
let assertConsoleErrorDev;

/**
 * 重置模块后重取React、DOM/client/server及控制台断言器，使每种渲染模式拥有独立警告缓存。
 * @returns 给集成辅助器使用的当前ReactDOMClient与ReactDOMServer引用。
 */
function initModules() {
  jest.resetModules();
  React = require('react');
  ReactDOM = require('react-dom');
  ReactDOMClient = require('react-dom/client');
  ReactDOMServer = require('react-dom/server');
  assertConsoleErrorDev = require('internal-test-utils').assertConsoleErrorDev;

  // 将这些模块提供给集成测试辅助函数。
  return {
    ReactDOMClient,
    ReactDOMServer,
  };
}

/** 五模式渲染与拒绝校验入口；serverRender、streamRender、clientRenderOnServerString引用用于选择保留SSR注释/HTML解析规范化的断言分支。 */
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
    /**
     * 核对非空DOM节点的种类和值，供文本结构测试复用；匹配nodeValue而不是只比较父元素总文本。
     * @param node - 待检查的真实DOM节点。
     * @param type - 期望的nodeType。
     * @param value - nodeValue必须匹配的文本或模式。
     * @returns 无返回值；expect失败会使当前用例失败。
     */
    function expectNode(node, type, value) {
      expect(node).not.toBe(null);
      expect(node.nodeType).toBe(type);
      expect(node.nodeValue).toMatch(value);
    }

    /**
     * 按Text节点标准类型转发expectNode，保持空节点、种类和值三项检查。
     * @param node - 待检查的文本节点。
     * @param text - 期望匹配的文字。
     * @returns 无返回值。
     */
    function expectTextNode(node, text) {
      expectNode(node, TEXT_NODE_TYPE, text);
    }

    describe('text children', function () {
      /** Given：div的单个文本子节点为Text；When：交给 render 渲染；Then：tagName为DIV、恰有一个nodeType=3且值为Text的节点。目的：普通文本形成文本节点而非元素。 */
      itRenders('a div with text', async render => {
        const e = await render(<div>Text</div>);
        expect(e.tagName).toBe('DIV');
        expect(e.childNodes.length).toBe(1);
        expectNode(e.firstChild, TEXT_NODE_TYPE, 'Text');
      });

      /** Given：div文本为两前导空格与一个尾空格的Text；When：交给 render 渲染；Then：只有一个文本节点且空格原样保留。目的：不修剪普通文本的首尾空白。 */
      itRenders('a div with text with flanking whitespace', async render => {
        // prettier-ignore
        const e = await render(<div>  Text </div>);
        expect(e.childNodes.length).toBe(1);
        expectNode(e.childNodes[0], TEXT_NODE_TYPE, '  Text ');
      });

      /** Given：div的单个文本输入为空串；When：交给 render 渲染；Then：没有子节点。目的：空串不生成空文本节点。 */
      itRenders('a div with an empty text child', async render => {
        const e = await render(<div>{''}</div>);
        expect(e.childNodes.length).toBe(0);
      });

      /** Given：div含三个空串子节点；When：交给 render 渲染；Then：节点数量0且textContent为空。目的：连续空文本均被省略。 */
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

      /** Given：div含三个独立空格文本；When：交给 render 渲染；Then：SSR/流/匹配hydration保留5节点含分隔注释；全新客户端为3文本节点。目的：服务端分隔符防止相邻文本被HTML解析器合并。 */
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

      /** Given：div包含Text与span(More Text)；When：交给 render 渲染；Then：外层2节点，首节点为Text，SPAN内一个More Text文本。目的：宿主与文本兄弟保持顺序。 */
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

      /** Given：预先创建nonstandard并消费标签警告，再渲染其Text子节点；When：交给 render 渲染；Then：NONSTANDARD内一个Text文本节点。目的：警告去重后验证非标准标签的内容。 */
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

      /** Given：custom-element包含Text；When：交给 render 渲染；Then：CUSTOM-ELEMENT内一个Text文本节点。目的：自定义标签正常容纳文本。 */
      itRenders('a custom element with text', async render => {
        const e = await render(<custom-element>Text</custom-element>);
        expect(e.tagName).toBe('CUSTOM-ELEMENT');
        expect(e.childNodes.length).toBe(1);
        expectNode(e.firstChild, TEXT_NODE_TYPE, 'Text');
      });

      /** Given：div的空串先于foo；When：交给 render 渲染；Then：只有一个foo文本节点。目的：前导空文本不占节点。 */
      itRenders('a leading blank child with a text sibling', async render => {
        const e = await render(<div>{''}foo</div>);
        expect(e.childNodes.length).toBe(1);
        expectTextNode(e.childNodes[0], 'foo');
      });

      /** Given：div的foo后跟空串；When：交给 render 渲染；Then：只有一个foo文本节点。目的：尾随空文本不占节点。 */
      itRenders('a trailing blank child with a text sibling', async render => {
        const e = await render(<div>foo{''}</div>);
        expect(e.childNodes.length).toBe(1);
        expectTextNode(e.childNodes[0], 'foo');
      });

      /** Given：div含foo与bar两个独立文本；When：交给 render 渲染；Then：SSR/流/匹配hydration为3节点，文本在0/2；客户端为2节点。目的：相邻文本的服务端注释分隔保留下来。 */
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

      /** Given：a、返回b的B、c作为div子节点；When：交给 render 渲染；Then：服务端及匹配hydration为5节点、文本在0/2/4；全新客户端为3节点。目的：组件返回文本也参与相邻文本分隔。 */
      itRenders(
        'a component returning text node between two text nodes',
        async render => {
          /**
           * 返回字符串b的组件，放在a/c之间验证组件边界不会改变相邻文本的SSR分隔。
           * @returns 文本child b。
           */
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

      /** Given：嵌套数组和X/Y/Z分别返回数组/null，组合a、b、内部c/d及尾e；When：交给 render 渲染；Then：SSR外层5节点内部3节点；客户端外层4内部2；文本顺序一致。目的：递归展开数组并过滤空值，同时保留服务端注释。 */
      itRenders('a tree with sibling host and text nodes', async render => {
        /** 返回嵌套数组与空值的类fixture，借Y/Z制造宿主层内c/d相邻文本。 */
        class X extends React.Component {
          /**
           * 返回null、包含Y的数组以及false，测试嵌套集合中的空child过滤。
           * @returns 可协调的混合children数组。
           */
          render() {
            return [null, [<Y key="1" />], false];
          }
        }

        /**
         * 把返回null的Z与文本c组合为数组。
         * @returns Z元素及嵌套文本数组，用于验证递归展开。
         */
        function Y() {
          return [<Z key="1" />, ['c']];
        }

        /**
         * 作为层级中的空返回组件，不应留下占位DOM。
         * @returns null。
         */
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
      /** Given：div的数值子节点为3；When：交给 render 渲染；Then：textContent为3。目的：数值子节点转换为文本。 */
      itRenders('a number as single child', async render => {
        const e = await render(<div>{3}</div>);
        expect(e.textContent).toBe('3');
      });

      // 零是假值。 这意味着，如果代码不够小心，它可能会看起来没有子节点。
      /** Given：div的数值子节点为0；When：交给 render 渲染；Then：textContent为0。目的：零虽为JS假值但不能按空children删除。 */
      itRenders('zero as single child', async render => {
        const e = await render(<div>{0}</div>);
        expect(e.textContent).toBe('0');
      });

      /** Given：div有foo文本和数值40；When：交给 render 渲染；Then：SSR及匹配hydration3节点，客户端2节点；文本为foo与40。目的：数值文本同样需要SSR相邻文本分隔。 */
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
      /** Given：div唯一children为null；When：交给 render 渲染；Then：子节点数量0。目的：null为空children。 */
      itRenders('null single child as blank', async render => {
        const e = await render(<div>{null}</div>);
        expect(e.childNodes.length).toBe(0);
      });

      /** Given：div唯一children为false；When：交给 render 渲染；Then：子节点数量0。目的：布尔假为空children。 */
      itRenders('false single child as blank', async render => {
        const e = await render(<div>{false}</div>);
        expect(e.childNodes.length).toBe(0);
      });

      /** Given：div唯一children为undefined；When：交给 render 渲染；Then：子节点数量0。目的：undefined为空children。 */
      itRenders('undefined single child as blank', async render => {
        const e = await render(<div>{undefined}</div>);
        expect(e.childNodes.length).toBe(0);
      });

      /** Given：div内NullComponent返回null；When：交给 render 渲染；Then：子节点数量0。目的：组件空返回不产生占位DOM。 */
      itRenders('a null component children as empty', async render => {
        /**
         * 位于div中的空函数组件fixture。
         * @returns null，使父div不产生子节点。
         */
        const NullComponent = () => null;
        const e = await render(
          <div>
            <NullComponent />
          </div>,
        );
        expect(e.childNodes.length).toBe(0);
      });

      /** Given：div包含null后跟foo；When：交给 render 渲染；Then：仅一个foo文本节点。目的：null兄弟被省略而不影响文本。 */
      itRenders('null children as blank', async render => {
        const e = await render(<div>{null}foo</div>);
        expect(e.childNodes.length).toBe(1);
        expectTextNode(e.childNodes[0], 'foo');
      });

      /** Given：div包含false后跟foo；When：交给 render 渲染；Then：仅一个foo文本节点。目的：布尔兄弟被省略。 */
      itRenders('false children as blank', async render => {
        const e = await render(<div>{false}foo</div>);
        expect(e.childNodes.length).toBe(1);
        expectTextNode(e.childNodes[0], 'foo');
      });

      /** Given：foo前后夹有null和false；When：交给 render 渲染；Then：仅一个foo文本节点。目的：多处空值不会分裂实际文本。 */
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

      /** Given：仅有false/null/null/false子节点；When：交给 render 渲染；Then：子节点数量0。目的：全空集合不产生DOM占位。 */
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
      /** Given：空svg元素；When：交给 render 渲染；Then：无子节点、tagName为小写svg且namespaceURI为SVG命名空间。目的：根svg切换宿主命名空间。 */
      itRenders('an svg element', async render => {
        const e = await render(<svg />);
        expect(e.childNodes.length).toBe(0);
        expect(e.tagName).toBe('svg');
        expect(e.namespaceURI).toBe('http://www.w3.org/2000/svg');
      });

      /** Given：svg带viewBox=0 0 0 0；When：交给 render 渲染；Then：无子节点、SVG命名空间且viewBox原样保留。目的：SVG属性大小写不套HTML规则。 */
      itRenders('svg child element with an attribute', async render => {
        const e = await render(<svg viewBox="0 0 0 0" />);
        expect(e.childNodes.length).toBe(0);
        expect(e.tagName).toBe('svg');
        expect(e.namespaceURI).toBe('http://www.w3.org/2000/svg');
        expect(e.getAttribute('viewBox')).toBe('0 0 0 0');
      });

      /** Given：svg image的xlinkHref为固定PNG地址；When：交给 render 渲染；Then：image无子节点、处于SVG且getAttributeNS(xlink,href)读到地址。目的：xlink属性写入专用命名空间。 */
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

      /** Given：svg image误写xlinkhref，错误预算1；When：交给 render 渲染；Then：xlink命名空间href缺失、普通xlinkhref保留地址。目的：错误大小写不触发命名空间别名。 */
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

      /** Given：svg的tabIndex为字符串1；When：交给 render 渲染；Then：e.tabIndex为数值1。目的：SVG也接受焦点顺序属性。 */
      itRenders('svg element with a tabIndex attribute', async render => {
        const e = await render(<svg tabIndex="1" />);
        expect(e.tabIndex).toBe(1);
      });

      /** Given：svg误写tabindex为1，错误预算1；When：交给 render 渲染；Then：e.tabIndex仍为1。目的：名称诊断不改变浏览器的tabIndex效果。 */
      itRenders(
        'svg element with a badly cased tabIndex attribute',
        async render => {
          const e = await render(<svg tabindex="1" />, 1);
          expect(e.tabIndex).toBe(1);
        },
      );

      /** Given：svg/filter包含feMorphology；When：交给 render 渲染；Then：节点名保留混合大小写、无子节点且SVG命名空间。目的：SVG标签大小写准确创建。 */
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

      /** Given：空math元素；When：交给 render 渲染；Then：无子节点、名为math且MathML命名空间。目的：math根切换到MathML。 */
      itRenders('a math element', async render => {
        const e = await render(<math />);
        expect(e.childNodes.length).toBe(0);
        expect(e.tagName).toBe('math');
        expect(e.namespaceURI).toBe('http://www.w3.org/1998/Math/MathML');
      });
    });
    // 这些标签在 ReactDOMComponent.setInitialProperties 中有专用初始化分支。
    /** Given：空img元素；When：交给 render 渲染；Then：无子节点、无后续兄弟且tagName为IMG。目的：void标签输出单个宿主节点。 */
    itRenders('an img', async render => {
      const e = await render(<img />);
      expect(e.childNodes.length).toBe(0);
      expect(e.nextSibling).toBe(null);
      expect(e.tagName).toBe('IMG');
    });

    /** Given：空button元素；When：交给 render 渲染；Then：无子节点、无后续兄弟且tagName为BUTTON。目的：有专用初始化分支的标签也维持空节点结构。 */
    itRenders('a button', async render => {
      const e = await render(<button />);
      expect(e.childNodes.length).toBe(0);
      expect(e.nextSibling).toBe(null);
      expect(e.tagName).toBe('BUTTON');
    });

    /** Given：外层div内span的__html=0；When：交给 render 渲染；Then：span含一个nodeType=3文本且textContent为0。目的：HTML注入接受数值，嵌套一层避免顶层坏markup对比干扰。 */
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

    /** Given：外层div内span的__html=false；When：交给 render 渲染；Then：span含一个文本节点且data为false。目的：注入布尔值字符串化而非按空children省略。 */
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

    /** Given：外层div内span的__html=hello；When：交给 render 渲染；Then：span含一个文本节点且textContent为hello。目的：注入字符串形成文本。 */
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

    /** Given：__html为带id child的span标记；When：交给 render 渲染；Then：恰有空SPAN子节点、id为child。目的：注入标记被解析为元素而非转义文本。 */
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

    /** Given：__html对象的toString返回带id child的span标记；When：交给 render 渲染；Then：恰有空SPAN子节点、id为child。目的：HTML输入的对象转换结果进入解析器。 */
    itRenders('a div with dangerouslySetInnerHTML object', async render => {
      const obj = {
        /**
         * 提供dangerouslySetInnerHTML对象的可观察字符串转换结果。
         * @returns 带id=child的span HTML标记，解析后可检查结构。
         */
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

    /** Given：__html=null；When：交给 render 渲染；Then：没有子节点。目的：null不注入字符串null。 */
    itRenders(
      'a div with dangerouslySetInnerHTML set to null',
      async render => {
        const e = await render(
          <div dangerouslySetInnerHTML={{__html: null}} />,
        );
        expect(e.childNodes.length).toBe(0);
      },
    );

    /** Given：__html=undefined；When：交给 render 渲染；Then：没有子节点。目的：未定义HTML输入不注入内容。 */
    itRenders(
      'a div with dangerouslySetInnerHTML set to undefined',
      async render => {
        const e = await render(
          <div dangerouslySetInnerHTML={{__html: undefined}} />,
        );
        expect(e.childNodes.length).toBe(0);
      },
    );

    /** Given：noscript的children为div说明文案；When：交给 render 渲染；Then：全新客户端无子节点；SSR/匹配hydration只有一个含原始div标记的文本节点。目的：区分客户端忽略与启用脚本环境HTML解析的原始文本。 */
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
      /** Given：pre内容Hello，不以前导换行开头；When：交给 render 渲染；Then：textContent为Hello。目的：换行吞食标签不额外加入可见换行。 */
      itRenders(
        'a newline-eating tag with content not starting with \\n',
        async render => {
          const e = await render(<pre>Hello</pre>);
          expect(e.textContent).toBe('Hello');
        },
      );
      /** Given：pre内容以换行Hello开头；When：交给 render 渲染；Then：textContent仍以换行开头。目的：服务器为HTML解析器吞首换行补偿。 */
      itRenders(
        'a newline-eating tag with content starting with \\n',
        async render => {
          const e = await render(<pre>{'\nHello'}</pre>);
          expect(e.textContent).toBe('\nHello');
        },
      );
      /** Given：普通div内容以换行Hello开头；When：交给 render 渲染；Then：textContent保留该换行。目的：普通标签不需要pre式补偿。 */
      itRenders('a normal tag with content starting with \\n', async render => {
        const e = await render(<div>{'\nHello'}</div>);
        expect(e.textContent).toBe('\nHello');
      });
    });

    describe('different component implementations', function () {
      /**
       * 检查组件输出div内只有一个foo文本节点；函数与类组件共用此断言避免只验证总文本。
       * @param e - render返回的div节点。
       * @returns 无返回值，断言失败会使测试失败。
       */
      function checkFooDiv(e) {
        expect(e.childNodes.length).toBe(1);
        expectNode(e.firstChild, TEXT_NODE_TYPE, 'foo');
      }

      /** Given：FunctionComponent返回div(foo)；When：交给 render 渲染；Then：checkFooDiv见一个foo文本节点。目的：函数组件输出正常宿主树。 */
      itRenders('stateless components', async render => {
        /**
         * 无状态组件fixture，不读取props或Hook。
         * @returns 包含foo的div元素。
         */
        const FunctionComponent = () => <div>foo</div>;
        checkFooDiv(await render(<FunctionComponent />));
      });

      /** Given：ClassComponent的render返回div(foo)；When：交给 render 渲染；Then：checkFooDiv见一个foo文本节点。目的：类组件与函数组件使用相同输出语义。 */
      itRenders('ES6 class components', async render => {
        /** 以ES6类形式提供与函数fixture相同的div(foo)输出。 */
        class ClassComponent extends React.Component {
          /**
           * 返回foo宿主描述。
           * @returns 含单个foo文本的div元素。
           */
          render() {
            return <div>foo</div>;
          }
        }
        checkFooDiv(await render(<ClassComponent />));
      });

      /** Given：FactoryComponent返回含render方法的普通对象，render错误预算1；When：由 itThrowsWhenRendering 驱动 render 并检查拒绝消息；Then：itThrowsWhenRendering要求Objects are not valid且keys为render。目的：工厂对象不是可接受组件返回值。 */
      itThrowsWhenRendering(
        'factory components',
        async render => {
          /**
           * 返回旧工厂形状的普通对象，专门触发非法React child错误。
           * @returns 带render方法的对象，不能作为当前组件的渲染结果。
           */
          const FactoryComponent = () => {
            return {
              /**
               * 对象内部render虽可生成div，但React不会把这个普通返回对象当组件实例。
               * @returns div(foo)；本报错路径不会通过组件协议调用它。
               */
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
      /** Given：四层Component依次包装props.children；When：交给 render 渲染；Then：前3层DIV均有一个child，最内层DIV为空。目的：组件层级不丢失宿主嵌套。 */
      itRenders('single child hierarchies of components', async render => {
        /**
         * 每层用div包住children，构造4层单child嵌套。
         * @param props - children是下一层Component或空值。
         * @returns 包含children的div。
         */
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

      /** Given：Component构成两层各2分支；When：交给 render 渲染；Then：根2个DIV、每个2个空DIV孙节点。目的：多子节点组件层级保持结构。 */
      itRenders('multi-child hierarchies of components', async render => {
        /**
         * 用div转发children，构造每层2分支的组件树。
         * @param props - children为下一层组件集合。
         * @returns 对应分支的div宿主元素。
         */
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

      /** Given：parent div包含child div；When：交给 render 渲染；Then：parent/child id正确，child为空。目的：单个宿主子节点保持身份属性。 */
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

      /** Given：parent包含child1与child2；When：交给 render 渲染；Then：顺序和id正确且两child均为空。目的：多个宿主节点不被合并。 */
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

      /** Given：child1与child2之间有一个空格；When：交给 render 渲染；Then：父含3节点，中间为单空格文本。目的：宿主兄弟之间的空白属于真实children。 */
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

      /** Given：child前有2空格后有3空格；When：交给 render 渲染；Then：3节点且前后文本分别保留2/3空格。目的：包围宿主元素的空白不修剪。 */
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

      /** Given：Component直接返回嵌套数组a/b/undefined/false/c；When：交给 render 渲染；Then：父容器在SSR有5节点、客户端3文本，文本始终a/b/c。目的：组件可返回集合并过滤空值，SSR注释仍分隔文本。 */
      itRenders('a composite with multiple children', async render => {
        /**
         * 直接返回children集合而不加入额外宿主包装。
         * @param props - 包含a/b及嵌套undefined/false/c的children。
         * @returns 原children，用于检查数组展开及服务端注释分隔。
         */
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
      /** Given：单个文本含字面span标记与&quot;样式实体文字；When：交给 render 渲染；Then：只有一个文本节点且nodeValue保留原始字符串。目的：用户文本不被当HTML或二次实体解析。 */
      itRenders('>,<, and & as single child', async render => {
        const e = await render(<div>{'<span>Text&quot;</span>'}</div>);
        expect(e.childNodes.length).toBe(1);
        expectNode(e.firstChild, TEXT_NODE_TYPE, '<span>Text&quot;</span>');
      });

      /** Given：两个文本含span标记与实体文字；When：交给 render 渲染；Then：SSR3节点、客户端2节点，两段原字串均保留。目的：转义后仍保持相邻文本身份。 */
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

      /** Given：单个文本含CR、CRLF、LF与NUL；When：交给 render 渲染；Then：SSR/匹配hydration为LF并忽略NUL；全新客户端保留原CR/NUL。目的：HTML输入规范化与直接文本创建不同。 */
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

      /** Given：两文本分别含CR与CRLF/LF/NUL；When：交给 render 渲染；Then：SSR/匹配hydration3节点且LF/NUL省略；全新客户端2节点保留原字串。目的：首分支已包含匹配hydration，后面的同条件elseif不会执行。 */
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
            // 两个文本节点之间保留了服务端插入的注释，因此 childNodes 长度为 3。
            expect(e.childNodes.length).toBe(3);
            // 从服务器 HTML 解析或进行 hydration 时都会变成 LF；null 字符会被忽略。
            expectNode(e.childNodes[0], TEXT_NODE_TYPE, 'foo\nbar');
            expectNode(e.childNodes[2], TEXT_NODE_TYPE, '\nbaz\nqux');
          } else if (render === clientRenderOnServerString) {
            // 两个文本节点之间保留了服务端插入的注释，因此 childNodes 长度为 3。
            expect(e.childNodes.length).toBe(3);
            // 此elseif条件已被首分支覆盖，当前不会执行；下列原断言不构成额外hydration证据。

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

      /** Given：anchor的title含CR、CRLF、LF与NUL；When：交给 render 渲染；Then：SSR/匹配hydration转LF且NUL为替换字符；客户端保留原字串。目的：属性解析的NUL替换不同于文本忽略且hydration不修补属性。 */
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
      /** Given：函数NullComponent返回null；When：交给 render 渲染；Then：await render正常完成，未额外断言节点数量。目的：空函数返回值被接受。 */
      itRenders('a function returning null', async render => {
        /**
         * 作为顶层null函数返回fixture。
         * @returns null；用例只验证render完成而不额外断言DOM。
         */
        const NullComponent = () => null;
        await render(<NullComponent />);
      });

      /** Given：类NullComponent的render返回null；When：交给 render 渲染；Then：await render正常完成，未额外断言节点数量。目的：空类返回值被接受。 */
      itRenders('a class returning null', async render => {
        /** 顶层空类组件fixture，验证类render允许null。 */
        class NullComponent extends React.Component {
          /**
           * 声明此组件没有UI。
           * @returns null。
           */
          render() {
            return null;
          }
        }
        await render(<NullComponent />);
      });

      /** Given：函数UndefinedComponent返回undefined；When：交给 render 渲染；Then：await render正常完成，未额外断言节点数量。目的：当前版本允许函数无UI返回。 */
      itRenders('a function returning undefined', async render => {
        /**
         * 作为顶层undefined函数返回fixture。
         * @returns undefined；当前版本接受这种空结果。
         */
        const UndefinedComponent = () => undefined;
        await render(<UndefinedComponent />);
      });

      /** Given：类UndefinedComponent的render返回undefined；When：交给 render 渲染；Then：await render正常完成，未额外断言节点数量。目的：当前版本允许类无UI返回。 */
      itRenders('a class returning undefined', async render => {
        /** 顶层类fixture，验证render允许undefined空结果。 */
        class UndefinedComponent extends React.Component {
          /**
           * 返回未定义值以覆盖无UI类组件路径。
           * @returns undefined。
           */
          render() {
            return undefined;
          }
        }
        await render(<UndefinedComponent />);
      });
    });

    describe('components that throw errors', function () {
      /** Given：函数ObjectComponent返回对象x=123，错误预算1；When：由 itThrowsWhenRendering 驱动 render 并检查拒绝消息；Then：异常包含Objects are not valid及keys x，DEV还含数组建议。目的：普通对象不是React child。 */
      itThrowsWhenRendering(
        'a function returning an object',
        async render => {
          /**
           * 构造非法child对象作为函数返回值。
           * @returns x=123的普通对象，渲染器应拒绝并报告对象键名。
           */
          const ObjectComponent = () => ({x: 123});
          await render(<ObjectComponent />, 1);
        },
        'Objects are not valid as a React child (found: object with keys {x}).' +
          (__DEV__
            ? ' If you meant to render a collection of children, use ' +
              'an array instead.'
            : ''),
      );

      /** Given：类ObjectComponent的render返回对象x=123，错误预算1；When：由 itThrowsWhenRendering 驱动 render 并检查拒绝消息；Then：异常包含Objects are not valid及keys x。目的：类组件也受child类型校验。 */
      itThrowsWhenRendering(
        'a class returning an object',
        async render => {
          /** 返回普通对象的类fixture，与函数对象child路径使用相同错误断言。 */
          class ObjectComponent extends React.Component {
            /**
             * 故意返回非法React child而不创建元素。
             * @returns x=123对象，供渲染器child类型校验拒绝。
             */
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

      /** Given：顶层直接传对象x=123；When：由 itThrowsWhenRendering 驱动 render 并检查拒绝消息；Then：包装器校验对象child错误与keys x。目的：无组件包裹也不能渲染普通对象。 */
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
      /** Given：JSX的EmptyComponent类型为对象；When：由 itThrowsWhenRendering 驱动 render 并检查拒绝消息；Then：异常包含Element type is invalid并指明object，DEV附导出/导入提示。目的：组件类型与组件返回值错误不同。 */
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

      /** Given：JSX的NullComponent类型为null；When：由 itThrowsWhenRendering 驱动 render 并检查拒绝消息；Then：异常包含Element type is invalid并指明null。目的：null作为child可空，作为元素type却非法。 */
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

      /** Given：JSX的UndefinedComponent类型为undefined；When：由 itThrowsWhenRendering 驱动 render 并检查拒绝消息；Then：异常包含Element type is invalid并指明undefined及DEV导入提示。目的：未定义组件type不能按空返回处理。 */
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
