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

let React;
let ReactDOM;
let ReactDOMClient;
let ReactDOMServer;
let assertConsoleErrorDev;

/** `initModules`：封装当前用例复用的操作、回调或断言步骤。 */
function initModules() {
  // 重置警告缓存。
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

/** `{resetModules, itRenders, clientCleanRender}`：保存当前测试场景复用的夹具、状态或回调。 */
const {resetModules, itRenders, clientCleanRender} =
  ReactDOMServerIntegrationUtils(initModules);

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

  describe('property to attribute mapping', function () {
    describe('string properties', function () {
      /**
       * 代表场景（Given–When–Then）：
       * Given `itRenders` 把同一属性 fixture 展开为服务端字符串、客户端全新渲染及 hydration 场景；
       * When 渲染带数值属性的宿主元素；
       * Then 断言最终 DOM 属性值在各条公开入口路径中保持一致。
       *
       * 验证机制：`ReactDOMServerIntegrationTestUtils.js` 驱动 `ReactDOMFizzServerNode.js` 与
       * `ReactDOMRoot.js` 的适配边界；完整 Fizz 状态机位于范围外的 `packages/react-server`。
       */
      itRenders('simple numbers', async render => {
        const e = await render(<div width={30} />);
        expect(e.getAttribute('width')).toBe('30');
      });

      itRenders('simple strings', async render => {
        const e = await render(<div width={'30'} />);
        expect(e.getAttribute('width')).toBe('30');
      });

      itRenders('empty src on img', async render => {
        const e = await render(<img src="" />, 1);
        expect(e.getAttribute('src')).toBe(null);
      });

      itRenders('empty href on anchor', async render => {
        const e = await render(<a href="" />);
        expect(e.getAttribute('href')).toBe('');
      });

      itRenders('empty href on base tags as null', async render => {
        const e = await render(<base href="" />, 1);
        expect(e.getAttribute('href')).toBe(null);
      });

      itRenders('empty href on area tags as null', async render => {
        const e = await render(
          <map>
            <area alt="" href="" />
          </map>,
          1,
        );
        expect(e.firstChild.getAttribute('href')).toBe(null);
      });

      itRenders('empty href on link tags as null', async render => {
        const e = await render(<link rel="stylesheet" href="" />, 1);
        expect(e.getAttribute('href')).toBe(null);
      });

      itRenders('no string prop with true value', async render => {
        const e = await render(<a href={true} />, 1);
        expect(e.hasAttribute('href')).toBe(false);
      });

      itRenders('no string prop with false value', async render => {
        const e = await render(<a href={false} />, 1);
        expect(e.hasAttribute('href')).toBe(false);
      });

      itRenders('no string prop with null value', async render => {
        const e = await render(<div width={null} />);
        expect(e.hasAttribute('width')).toBe(false);
      });

      itRenders('no string prop with function value', async render => {
        const e = await render(<div width={function () {}} />, 1);
        expect(e.hasAttribute('width')).toBe(false);
      });

      itRenders('no string prop with symbol value', async render => {
        const e = await render(<div width={Symbol('foo')} />, 1);
        expect(e.hasAttribute('width')).toBe(false);
      });
    });

    describe('boolean properties', function () {
      itRenders('boolean prop with true value', async render => {
        const e = await render(<div hidden={true} />);
        expect(e.getAttribute('hidden')).toBe('');
      });

      itRenders('boolean prop with false value', async render => {
        const e = await render(<div hidden={false} />);
        expect(e.getAttribute('hidden')).toBe(null);
      });

      itRenders('boolean prop with self value', async render => {
        const e = await render(<div hidden="hidden" />);
        expect(e.getAttribute('hidden')).toBe('');
      });

      // 这似乎不是正确的行为, 由于 HTML 中的 `hidden=""` 表示该布尔属性存在。 然而, 这正是当前代码的
      // 行为。 所以测试包含在这里。
      itRenders('boolean prop with "" value', async render => {
        const e = await render(<div hidden="" />);
        expect(e.getAttribute('hidden')).toBe(null);
      });

      // 这似乎可以掩盖程序员错误, 但这仍然是现有行为。
      itRenders('boolean prop with string value', async render => {
        const e = await render(<div hidden="foo" />);
        expect(e.getAttribute('hidden')).toBe('');
      });

      // 这似乎可以掩盖程序员错误, 但这仍然是现有行为。
      itRenders('boolean prop with array value', async render => {
        const e = await render(<div hidden={['foo', 'bar']} />);
        expect(e.getAttribute('hidden')).toBe('');
      });

      // 这似乎可以掩盖程序员错误, 但这仍然是现有行为。
      itRenders('boolean prop with object value', async render => {
        const e = await render(<div hidden={{foo: 'bar'}} />);
        expect(e.getAttribute('hidden')).toBe('');
      });

      // 这似乎可以掩盖程序员错误, 但这仍然是现有行为。
      itRenders('boolean prop with non-zero number value', async render => {
        const e = await render(<div hidden={10} />);
        expect(e.getAttribute('hidden')).toBe('');
      });

      // 这似乎可以掩盖程序员错误, 但这仍然是现有行为。
      itRenders('boolean prop with zero value', async render => {
        const e = await render(<div hidden={0} />);
        expect(e.getAttribute('hidden')).toBe(null);
      });

      itRenders('no boolean prop with null value', async render => {
        const e = await render(<div hidden={null} />);
        expect(e.hasAttribute('hidden')).toBe(false);
      });

      itRenders('no boolean prop with function value', async render => {
        const e = await render(<div hidden={function () {}} />, 1);
        expect(e.hasAttribute('hidden')).toBe(false);
      });

      itRenders('no boolean prop with symbol value', async render => {
        const e = await render(<div hidden={Symbol('foo')} />, 1);
        expect(e.hasAttribute('hidden')).toBe(false);
      });
    });

    describe('credentialless property', function () {
      itRenders('credentialless prop with true value', async render => {
        const e = await render(<iframe credentialless={true} />);
        expect(e.getAttribute('credentialless')).toBe('');
      });

      itRenders('credentialless prop with false value', async render => {
        const e = await render(<iframe credentialless={false} />);
        expect(e.hasAttribute('credentialless')).toBe(false);
      });
    });

    describe('download property (combined boolean/string attribute)', function () {
      itRenders('download prop with true value', async render => {
        const e = await render(<a download={true} />);
        expect(e.getAttribute('download')).toBe('');
      });

      itRenders('download prop with false value', async render => {
        const e = await render(<a download={false} />);
        expect(e.getAttribute('download')).toBe(null);
      });

      itRenders('download prop with string value', async render => {
        const e = await render(<a download="myfile" />);
        expect(e.getAttribute('download')).toBe('myfile');
      });

      itRenders('download prop with string "false" value', async render => {
        const e = await render(<a download="false" />);
        expect(e.getAttribute('download')).toBe('false');
      });

      itRenders('download prop with string "true" value', async render => {
        const e = await render(<a download={'true'} />);
        expect(e.getAttribute('download')).toBe('true');
      });

      itRenders('download prop with number 0 value', async render => {
        const e = await render(<a download={0} />);
        expect(e.getAttribute('download')).toBe('0');
      });

      itRenders('no download prop with null value', async render => {
        const e = await render(<div download={null} />);
        expect(e.hasAttribute('download')).toBe(false);
      });

      itRenders('no download prop with undefined value', async render => {
        const e = await render(<div download={undefined} />);
        expect(e.hasAttribute('download')).toBe(false);
      });

      itRenders('no download prop with function value', async render => {
        const e = await render(<div download={function () {}} />, 1);
        expect(e.hasAttribute('download')).toBe(false);
      });

      itRenders('no download prop with symbol value', async render => {
        const e = await render(<div download={Symbol('foo')} />, 1);
        expect(e.hasAttribute('download')).toBe(false);
      });
    });

    describe('className property', function () {
      itRenders('className prop with string value', async render => {
        const e = await render(<div className="myClassName" />);
        expect(e.getAttribute('class')).toBe('myClassName');
      });

      itRenders('className prop with empty string value', async render => {
        const e = await render(<div className="" />);
        expect(e.getAttribute('class')).toBe('');
      });

      itRenders('no className prop with true value', async render => {
        const e = await render(<div className={true} />, 1);
        expect(e.hasAttribute('class')).toBe(false);
      });

      itRenders('no className prop with false value', async render => {
        const e = await render(<div className={false} />, 1);
        expect(e.hasAttribute('class')).toBe(false);
      });

      itRenders('no className prop with null value', async render => {
        const e = await render(<div className={null} />);
        expect(e.hasAttribute('className')).toBe(false);
      });

      itRenders('badly cased className with a warning', async render => {
        const e = await render(<div classname="test" />, 1);
        expect(e.hasAttribute('class')).toBe(false);
        expect(e.hasAttribute('classname')).toBe(true);
      });

      itRenders(
        'className prop when given the alias with a warning',
        async render => {
          const e = await render(<div class="test" />, 1);
          expect(e.className).toBe('test');
        },
      );

      itRenders(
        'className prop when given a badly cased alias',
        async render => {
          const e = await render(<div cLASs="test" />, 1);
          expect(e.className).toBe('test');
        },
      );
    });

    describe('htmlFor property', function () {
      itRenders('htmlFor with string value', async render => {
        const e = await render(<div htmlFor="myFor" />);
        expect(e.getAttribute('for')).toBe('myFor');
      });

      itRenders('no badly cased htmlfor', async render => {
        const e = await render(<div htmlfor="myFor" />, 1);
        expect(e.hasAttribute('for')).toBe(false);
        expect(e.getAttribute('htmlfor')).toBe('myFor');
      });

      itRenders('htmlFor with an empty string', async render => {
        const e = await render(<div htmlFor="" />);
        expect(e.getAttribute('for')).toBe('');
      });

      itRenders('no htmlFor prop with true value', async render => {
        const e = await render(<div htmlFor={true} />, 1);
        expect(e.hasAttribute('for')).toBe(false);
      });

      itRenders('no htmlFor prop with false value', async render => {
        const e = await render(<div htmlFor={false} />, 1);
        expect(e.hasAttribute('for')).toBe(false);
      });

      itRenders('no htmlFor prop with null value', async render => {
        const e = await render(<div htmlFor={null} />);
        expect(e.hasAttribute('htmlFor')).toBe(false);
      });
    });

    describe('numeric properties', function () {
      itRenders(
        'positive numeric property with positive value',
        async render => {
          const e = await render(<input size={2} />);
          expect(e.getAttribute('size')).toBe('2');
        },
      );

      itRenders('numeric property with zero value', async render => {
        const e = await render(<ol start={0} />);
        expect(e.getAttribute('start')).toBe('0');
      });

      itRenders(
        'no positive numeric property with zero value',
        async render => {
          const e = await render(<input size={0} />);
          expect(e.hasAttribute('size')).toBe(false);
        },
      );

      itRenders('no numeric prop with function value', async render => {
        const e = await render(<ol start={function () {}} />, 1);
        expect(e.hasAttribute('start')).toBe(false);
      });

      itRenders('no numeric prop with symbol value', async render => {
        const e = await render(<ol start={Symbol('foo')} />, 1);
        expect(e.hasAttribute('start')).toBe(false);
      });

      itRenders(
        'no positive numeric prop with function value',
        async render => {
          const e = await render(<input size={function () {}} />, 1);
          expect(e.hasAttribute('size')).toBe(false);
        },
      );

      itRenders('no positive numeric prop with symbol value', async render => {
        const e = await render(<input size={Symbol('foo')} />, 1);
        expect(e.hasAttribute('size')).toBe(false);
      });
    });

    describe('props with special meaning in React', function () {
      itRenders('no ref attribute', async render => {
        /** `RefComponent`：定义测试夹具组件，用来观察渲染与生命周期行为。 */
        class RefComponent extends React.Component {
          /** `RefComponent.render`：实现测试夹具的生命周期、渲染或交互步骤。 */
          render() {
            return <div ref={React.createRef()} />;
          }
        }
        const e = await render(<RefComponent />);
        expect(e.getAttribute('ref')).toBe(null);
      });

      itRenders('no children attribute', async render => {
        const e = await render(React.createElement('div', {}, 'foo'));
        expect(e.getAttribute('children')).toBe(null);
      });

      itRenders('no key attribute', async render => {
        const e = await render(<div key="foo" />);
        expect(e.getAttribute('key')).toBe(null);
      });

      itRenders('no dangerouslySetInnerHTML attribute', async render => {
        const e = await render(
          <div dangerouslySetInnerHTML={{__html: '<foo />'}} />,
        );
        expect(e.getAttribute('dangerouslySetInnerHTML')).toBe(null);
      });

      itRenders('no suppressContentEditableWarning attribute', async render => {
        const e = await render(<div suppressContentEditableWarning={true} />);
        expect(e.getAttribute('suppressContentEditableWarning')).toBe(null);
      });

      itRenders('no suppressHydrationWarning attribute', async render => {
        const e = await render(<span suppressHydrationWarning={true} />);
        expect(e.getAttribute('suppressHydrationWarning')).toBe(null);
      });
    });

    describe('inline styles', function () {
      itRenders('simple styles', async render => {
        const e = await render(<div style={{color: 'red', width: '30px'}} />);
        expect(e.style.color).toBe('red');
        expect(e.style.width).toBe('30px');
      });

      itRenders('relevant styles with px', async render => {
        const e = await render(
          <div
            style={{
              left: 0,
              margin: 16,
              opacity: 0.5,
              padding: '4px',
            }}
          />,
        );
        expect(e.style.left).toBe('0px');
        expect(e.style.margin).toBe('16px');
        expect(e.style.opacity).toBe('0.5');
        expect(e.style.padding).toBe('4px');
      });

      itRenders('custom properties', async render => {
        const e = await render(<div style={{'--foo': 5}} />);
        expect(e.style.getPropertyValue('--foo')).toBe('5');
      });

      itRenders('camel cased custom properties', async render => {
        const e = await render(<div style={{'--someColor': '#000000'}} />);
        expect(e.style.getPropertyValue('--someColor')).toBe('#000000');
      });

      itRenders('no undefined styles', async render => {
        const e = await render(
          <div style={{color: undefined, width: '30px'}} />,
        );
        expect(e.style.color).toBe('');
        expect(e.style.width).toBe('30px');
      });

      itRenders('no null styles', async render => {
        const e = await render(<div style={{color: null, width: '30px'}} />);
        expect(e.style.color).toBe('');
        expect(e.style.width).toBe('30px');
      });

      itRenders('no empty styles', async render => {
        const e = await render(<div style={{color: null, width: null}} />);
        expect(e.style.color).toBe('');
        expect(e.style.width).toBe('');
        expect(e.hasAttribute('style')).toBe(false);
      });

      itRenders('unitless-number rules with prefixes', async render => {
        const {style} = await render(
          <div
            style={{
              lineClamp: 10,
              // TODO：需要 https://github.com/jsdom/cssstyle/pull/112
              // WebkitLineClamp: 10,
              // TODO：待 cssstyle 或 jsdom 决定是否支持其他厂商前缀后再复核：
              // MozFlexGrow: 10,
              // msFlexGrow: 10,
              // msGridRow: 10,
              // msGridRowEnd: 10,
              // msGridRowSpan: 10,
              // msGridRowStart: 10,
              // msGridColumn: 10,
              // msGridColumnEnd: 10,
              // msGridColumnSpan: 10,
              // msGridColumnStart: 10,
            }}
          />,
        );

        expect(style.lineClamp).toBe('10');
        // 参见上方内联样式处的说明。
        // expect(style.WebkitLineClamp).toBe('10');
        // expect(style.MozFlexGrow).toBe('10');
        // jsdom 在客户端与处理服务端标记时采用的样式属性名不一致，但无论使用哪种名称，该值都应存在。
        //expect(style.MsFlexGrow || style.msFlexGrow).toBe('10');
        // expect(style.MsGridRow || style.msGridRow).toBe('10');
        // expect(style.MsGridRowEnd || style.msGridRowEnd).toBe('10');
        // expect(style.MsGridRowSpan || style.msGridRowSpan).toBe('10');
        // expect(style.MsGridRowStart || style.msGridRowStart).toBe('10');
        // expect(style.MsGridColumn || style.msGridColumn).toBe('10');
        // expect(style.MsGridColumnEnd || style.msGridColumnEnd).toBe('10');
        // expect(style.MsGridColumnSpan || style.msGridColumnSpan).toBe('10');
        // expect(style.MsGridColumnStart || style.msGridColumnStart).toBe('10');
      });
    });

    describe('aria attributes', function () {
      itRenders('simple strings', async render => {
        const e = await render(<div aria-label="hello" />);
        expect(e.getAttribute('aria-label')).toBe('hello');
      });

      // 这可能只是一个隐藏程序员错误, 但这是一种存在的行为。
      itRenders('aria string prop with false value', async render => {
        const e = await render(<div aria-label={false} />);
        expect(e.getAttribute('aria-label')).toBe('false');
      });

      itRenders('no aria prop with null value', async render => {
        const e = await render(<div aria-label={null} />);
        expect(e.hasAttribute('aria-label')).toBe(false);
      });

      itRenders('"aria" attribute with a warning', async render => {
        // 预留用于未来使用。
        const e = await render(<div aria="hello" />, 1);
        expect(e.getAttribute('aria')).toBe('hello');
      });
    });

    describe('cased attributes', function () {
      itRenders(
        'badly cased aliased HTML attribute with a warning',
        async render => {
          const e = await render(<form acceptcharset="utf-8" />, 1);
          expect(e.hasAttribute('accept-charset')).toBe(false);
          expect(e.getAttribute('acceptcharset')).toBe('utf-8');
        },
      );

      itRenders('badly cased SVG attribute with a warning', async render => {
        const e = await render(
          <svg>
            <text textlength="10" />
          </svg>,
          1,
        );
        // 只要客户端与服务器端都发出警告，这种结果差异就是预期行为。
        if (render === clientCleanRender) {
          // 在客户端，`"textlength"` 被视为区分大小写的 SVG 属性，因此设置的是错误属性 `textlength`。
          expect(e.firstChild.getAttribute('textlength')).toBe('10');
          expect(e.firstChild.hasAttribute('textLength')).toBe(false);
        } else {
          // 解析 HTML（包括 hydration）时，浏览器会把 `textlength` 正确映射为 SVG 属性 `textLength`，
          // 因而初始渲染碰巧可以正常工作。
          expect(e.firstChild.getAttribute('textLength')).toBe('10');
          expect(e.firstChild.hasAttribute('textlength')).toBe(false);
        }
      });

      itRenders('no badly cased aliased SVG attribute alias', async render => {
        const e = await render(
          <svg>
            <text strokedasharray="10 10" />
          </svg>,
          1,
        );
        expect(e.firstChild.hasAttribute('stroke-dasharray')).toBe(false);
        expect(e.firstChild.getAttribute('strokedasharray')).toBe('10 10');
      });

      itRenders(
        'no badly cased original SVG attribute that is aliased',
        async render => {
          const e = await render(
            <svg>
              <text stroke-dasharray="10 10" />
            </svg>,
            1,
          );
          expect(e.firstChild.getAttribute('stroke-dasharray')).toBe('10 10');
        },
      );
    });

    describe('unknown attributes', function () {
      itRenders('unknown attributes', async render => {
        const e = await render(<div foo="bar" />);
        expect(e.getAttribute('foo')).toBe('bar');
      });

      itRenders('unknown data- attributes', async render => {
        const e = await render(<div data-foo="bar" />);
        expect(e.getAttribute('data-foo')).toBe('bar');
      });

      itRenders('badly cased reserved attributes', async render => {
        const e = await render(<div CHILDREN="5" />, 1);
        expect(e.getAttribute('CHILDREN')).toBe('5');
      });

      itRenders('"data" attribute', async render => {
        // 对于 `<object />` 起到 `src` 的作用。
        const e = await render(<object data="hello" />);
        expect(e.getAttribute('data')).toBe('hello');
      });

      itRenders('no unknown data- attributes with null value', async render => {
        const e = await render(<div data-foo={null} />);
        expect(e.hasAttribute('data-foo')).toBe(false);
      });

      itRenders('unknown data- attributes with casing', async render => {
        const e = await render(<div data-fooBar="true" />, 1);
        expect(e.getAttribute('data-foobar')).toBe('true');
      });

      itRenders('unknown data- attributes with boolean true', async render => {
        const e = await render(<div data-foobar={true} />);
        expect(e.getAttribute('data-foobar')).toBe('true');
      });

      itRenders('unknown data- attributes with boolean false', async render => {
        const e = await render(<div data-foobar={false} />);
        expect(e.getAttribute('data-foobar')).toBe('false');
      });

      itRenders(
        'no unknown data- attributes with casing and null value',
        async render => {
          const e = await render(<div data-fooBar={null} />, 1);
          expect(e.hasAttribute('data-foobar')).toBe(false);
        },
      );

      itRenders('custom attributes for non-standard elements', async render => {
        // 本套件通常假设 SSR + innerHTML、hydration 与客户端渲染等所有场景产生完全相同的警告（或均无警告）。
        // 但此警告只会在客户端创建 DOM 节点时触发，因此先让它提前触发，后续即可去重而不使测试失败。
        ReactDOM.flushSync(() => {
          const root = ReactDOMClient.createRoot(document.createElement('div'));
          root.render(<nonstandard />);
        });
        assertConsoleErrorDev([
          'The tag <nonstandard> is unrecognized in this browser. ' +
            'If you meant to render a React component, start its name with an uppercase letter.\n' +
            '    in nonstandard (at **)',
        ]);

        const e = await render(<nonstandard foo="bar" />);
        expect(e.getAttribute('foo')).toBe('bar');
      });

      itRenders('SVG tags with dashes in them', async render => {
        const e = await render(
          <svg>
            <font-face accentHeight={10} />
          </svg>,
        );
        expect(e.firstChild.hasAttribute('accentHeight')).toBe(false);
        expect(e.firstChild.getAttribute('accent-height')).toBe('10');
      });

      itRenders('cased custom attributes', async render => {
        const e = await render(<div fooBar="test" />, 1);
        expect(e.getAttribute('foobar')).toBe('test');
      });
    });

    itRenders('no HTML events', async render => {
      const e = await render(<div onClick={() => {}} />);
      expect(e.getAttribute('onClick')).toBe(null);
      expect(e.getAttribute('onClick')).toBe(null);
      expect(e.getAttribute('click')).toBe(null);
    });

    itRenders('no unknown events', async render => {
      const e = await render(<div onunknownevent='alert("hack")' />, 1);
      expect(e.getAttribute('onunknownevent')).toBe(null);
    });

    itRenders('custom attribute named `on`', async render => {
      const e = await render(<div on="tap:do-something" />);
      expect(e.getAttribute('on')).toEqual('tap:do-something');
    });
  });

  // 这些测试主要验证现有的行为。 虽然这并不总是有意义,但我们不能改变它在未成年人.
  describe('custom elements', () => {
    itRenders('class for custom elements', async render => {
      const e = await render(<div is="custom-element" class="test" />, 0);
      expect(e.getAttribute('class')).toBe('test');
    });

    itRenders('className for is elements', async render => {
      const e = await render(<div is="custom-element" className="test" />, 0);
      expect(e.getAttribute('className')).toBe(null);
      expect(e.getAttribute('class')).toBe('test');
    });

    itRenders('className for custom elements', async render => {
      const e = await render(<custom-element className="test" />, 0);
      expect(e.getAttribute('className')).toBe(null);
      expect(e.getAttribute('class')).toBe('test');
    });

    itRenders('htmlFor property on is elements', async render => {
      const e = await render(<div is="custom-element" htmlFor="test" />);
      expect(e.getAttribute('htmlFor')).toBe(null);
      expect(e.getAttribute('for')).toBe('test');
    });

    itRenders('htmlFor attribute on custom elements', async render => {
      const e = await render(<custom-element htmlFor="test" />);
      expect(e.getAttribute('htmlFor')).toBe('test');
      expect(e.getAttribute('for')).toBe(null);
    });

    itRenders('for attribute on custom elements', async render => {
      const e = await render(<div is="custom-element" for="test" />);
      expect(e.getAttribute('htmlFor')).toBe(null);
      expect(e.getAttribute('for')).toBe('test');
    });

    itRenders('unknown attributes for custom elements', async render => {
      const e = await render(<custom-element foo="bar" />);
      expect(e.getAttribute('foo')).toBe('bar');
    });

    itRenders('unknown `on*` attributes for custom elements', async render => {
      const e = await render(<custom-element onunknown="bar" />);
      expect(e.getAttribute('onunknown')).toBe('bar');
    });

    itRenders('unknown boolean `true` attributes as strings', async render => {
      const e = await render(<custom-element foo={true} />);
      expect(e.getAttribute('foo')).toBe('');
    });

    itRenders('unknown boolean `false` attributes as strings', async render => {
      const e = await render(<custom-element foo={false} />);
      expect(e.getAttribute('foo')).toBe(null);
    });

    itRenders('new boolean `true` attributes', async render => {
      const element = await render(<div inert={true} />, 0);

      expect(element.getAttribute('inert')).toBe('');
    });

    itRenders('new boolean `""` attributes', async render => {
      const element = await render(
        <div inert="" />,
        // 警告：由于此已渲染为 `inert=""` 如 `inert={true}`，但现在渲染为 `inert={false}`。
        1,
      );

      expect(element.getAttribute('inert')).toBe(null);
    });

    itRenders('new boolean `false` attributes', async render => {
      const element = await render(<div inert={false} />, 0);

      expect(element.getAttribute('inert')).toBe(null);
    });

    itRenders(
      'no unknown attributes for custom elements with null value',
      async render => {
        const e = await render(<custom-element foo={null} />);
        expect(e.hasAttribute('foo')).toBe(false);
      },
    );

    itRenders(
      'unknown attributes for custom elements using is',
      async render => {
        const e = await render(<div is="custom-element" foo="bar" />);
        expect(e.getAttribute('foo')).toBe('bar');
      },
    );

    itRenders(
      'no unknown attributes for custom elements using is with null value',
      async render => {
        const e = await render(<div is="custom-element" foo={null} />);
        expect(e.hasAttribute('foo')).toBe(false);
      },
    );
  });
});
