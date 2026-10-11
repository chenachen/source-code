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

/** 五模式SSR/客户端集成测试工厂；调用initModules取得当前renderer，错误标记模式只比较恢复文本并以BadMarkupExpected提前结束，后续属性断言在其余四模式执行。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

let React;
let ReactDOM;
let ReactDOMClient;
let ReactDOMServer;
let assertConsoleErrorDev;

/**
 * 重新装载React与DOM renderer并清空模块级警告缓存，交给集成测试工厂建立每个模式的独立环境。
 * @returns 当前ReactDOMClient和ReactDOMServer模块，供SSR、创建根与hydration辅助器调用。
 */
function initModules() {
  // 重置警告缓存。
  jest.resetModules();
  React = require('react');
  ReactDOM = require('react-dom');
  ReactDOMClient = require('react-dom/client');
  ReactDOMServer = require('react-dom/server');
  assertConsoleErrorDev = require('internal-test-utils').assertConsoleErrorDev;

  // 将重新装载的两个 renderer 返回给集成辅助器，避免继续使用旧模块引用。
  return {
    ReactDOMClient,
    ReactDOMServer,
  };
}

/** 本套件的模块重置和五模式注册器；clientCleanRender引用用来区分SVG在直接客户端设置属性与SSR HTML解析时的大小写结果。 */
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
      /** Given：div的width为数值30；When：交给 render 渲染；Then：width属性为字符串30。目的：普通字符串属性接受数值并序列化。 */
      itRenders('simple numbers', async render => {
        const e = await render(<div width={30} />);
        expect(e.getAttribute('width')).toBe('30');
      });

      /** Given：div的width为字符串30；When：交给 render 渲染；Then：width属性仍为30。目的：字符串值不被数值规则过滤。 */
      itRenders('simple strings', async render => {
        const e = await render(<div width={'30'} />);
        expect(e.getAttribute('width')).toBe('30');
      });

      /** Given：img的src为空字符串，render错误预算1；When：交给 render 渲染；Then：src属性缺失。目的：空图片URL被诊断并省略。 */
      itRenders('empty src on img', async render => {
        const e = await render(<img src="" />, 1);
        expect(e.getAttribute('src')).toBe(null);
      });

      /** Given：a的href为空字符串；When：交给 render 渲染；Then：href保留空串。目的：锚点允许空地址，与资源URL不同。 */
      itRenders('empty href on anchor', async render => {
        const e = await render(<a href="" />);
        expect(e.getAttribute('href')).toBe('');
      });

      /** Given：base的href为空字符串，错误预算1；When：交给 render 渲染；Then：href属性缺失。目的：base空URL不写入DOM。 */
      itRenders('empty href on base tags as null', async render => {
        const e = await render(<base href="" />, 1);
        expect(e.getAttribute('href')).toBe(null);
      });

      /** Given：map内area的href为空字符串，错误预算1；When：交给 render 渲染；Then：首个area没有href。目的：area空URL被过滤。 */
      itRenders('empty href on area tags as null', async render => {
        const e = await render(
          <map>
            <area alt="" href="" />
          </map>,
          1,
        );
        expect(e.firstChild.getAttribute('href')).toBe(null);
      });

      /** Given：stylesheet link的href为空字符串，错误预算1；When：交给 render 渲染；Then：href属性缺失。目的：资源空URL不形成有效属性。 */
      itRenders('empty href on link tags as null', async render => {
        const e = await render(<link rel="stylesheet" href="" />, 1);
        expect(e.getAttribute('href')).toBe(null);
      });

      /** Given：a的href=true，错误预算1；When：交给 render 渲染；Then：没有href属性。目的：普通URL属性不接受布尔真。 */
      itRenders('no string prop with true value', async render => {
        const e = await render(<a href={true} />, 1);
        expect(e.hasAttribute('href')).toBe(false);
      });

      /** Given：a的href=false，错误预算1；When：交给 render 渲染；Then：没有href属性。目的：普通URL属性不接受布尔假。 */
      itRenders('no string prop with false value', async render => {
        const e = await render(<a href={false} />, 1);
        expect(e.hasAttribute('href')).toBe(false);
      });

      /** Given：div的width=null；When：交给 render 渲染；Then：没有width属性。目的：null表示省略属性。 */
      itRenders('no string prop with null value', async render => {
        const e = await render(<div width={null} />);
        expect(e.hasAttribute('width')).toBe(false);
      });

      /** Given：div的width为函数，错误预算1；When：交给 render 渲染；Then：没有width属性。目的：函数不是可输出的普通属性值。 */
      itRenders('no string prop with function value', async render => {
        const e = await render(<div width={function () {}} />, 1);
        expect(e.hasAttribute('width')).toBe(false);
      });

      /** Given：div的width为Symbol(foo)，错误预算1；When：交给 render 渲染；Then：没有width属性。目的：Symbol不做字符串强制转换。 */
      itRenders('no string prop with symbol value', async render => {
        const e = await render(<div width={Symbol('foo')} />, 1);
        expect(e.hasAttribute('width')).toBe(false);
      });
    });

    describe('boolean properties', function () {
      /** Given：div的hidden=true；When：交给 render 渲染；Then：hidden为空字符串。目的：HTML布尔属性由存在性表示真。 */
      itRenders('boolean prop with true value', async render => {
        const e = await render(<div hidden={true} />);
        expect(e.getAttribute('hidden')).toBe('');
      });

      /** Given：div的hidden=false；When：交给 render 渲染；Then：hidden缺失。目的：布尔假移除属性。 */
      itRenders('boolean prop with false value', async render => {
        const e = await render(<div hidden={false} />);
        expect(e.getAttribute('hidden')).toBe(null);
      });

      /** Given：div的hidden为字符串hidden；When：交给 render 渲染；Then：hidden为空字符串。目的：真值字符串只决定存在性。 */
      itRenders('boolean prop with self value', async render => {
        const e = await render(<div hidden="hidden" />);
        expect(e.getAttribute('hidden')).toBe('');
      });

      // React 按 JS 值的真值性处理 hidden：空字符串会移除属性，区别于直接解析 HTML 的 hidden=""。
      /** Given：div的hidden为空字符串；When：交给 render 渲染；Then：hidden缺失。目的：JS空串假值不同于直接解析hidden空属性。 */
      itRenders('boolean prop with "" value', async render => {
        const e = await render(<div hidden="" />);
        expect(e.getAttribute('hidden')).toBe(null);
      });

      // 布尔属性按值的真值性决定是否输出，不做一般属性的字符串转换。
      /** Given：div的hidden为foo；When：交给 render 渲染；Then：hidden为空字符串。目的：布尔属性不输出原字符串。 */
      itRenders('boolean prop with string value', async render => {
        const e = await render(<div hidden="foo" />);
        expect(e.getAttribute('hidden')).toBe('');
      });

      // 布尔属性按值的真值性决定是否输出，不做一般属性的字符串转换。
      /** Given：div的hidden为foo/bar数组；When：交给 render 渲染；Then：hidden为空字符串。目的：真值数组不被逗号字符串化。 */
      itRenders('boolean prop with array value', async render => {
        const e = await render(<div hidden={['foo', 'bar']} />);
        expect(e.getAttribute('hidden')).toBe('');
      });

      // 布尔属性按值的真值性决定是否输出，不做一般属性的字符串转换。
      /** Given：div的hidden为对象；When：交给 render 渲染；Then：hidden为空字符串。目的：真值对象仅开启属性。 */
      itRenders('boolean prop with object value', async render => {
        const e = await render(<div hidden={{foo: 'bar'}} />);
        expect(e.getAttribute('hidden')).toBe('');
      });

      // 布尔属性按值的真值性决定是否输出，不做一般属性的字符串转换。
      /** Given：div的hidden=10；When：交给 render 渲染；Then：hidden为空字符串。目的：非零数值在布尔属性中代表真。 */
      itRenders('boolean prop with non-zero number value', async render => {
        const e = await render(<div hidden={10} />);
        expect(e.getAttribute('hidden')).toBe('');
      });

      // 布尔属性按值的真值性决定是否输出，不做一般属性的字符串转换。
      /** Given：div的hidden=0；When：交给 render 渲染；Then：hidden缺失。目的：零的假值关闭布尔属性。 */
      itRenders('boolean prop with zero value', async render => {
        const e = await render(<div hidden={0} />);
        expect(e.getAttribute('hidden')).toBe(null);
      });

      /** Given：div的hidden=null；When：交给 render 渲染；Then：没有hidden属性。目的：null省略布尔属性。 */
      itRenders('no boolean prop with null value', async render => {
        const e = await render(<div hidden={null} />);
        expect(e.hasAttribute('hidden')).toBe(false);
      });

      /** Given：div的hidden为函数，错误预算1；When：交给 render 渲染；Then：没有hidden属性。目的：即使函数为真值也先过滤非法类型。 */
      itRenders('no boolean prop with function value', async render => {
        const e = await render(<div hidden={function () {}} />, 1);
        expect(e.hasAttribute('hidden')).toBe(false);
      });

      /** Given：div的hidden为Symbol(foo)，错误预算1；When：交给 render 渲染；Then：没有hidden属性。目的：Symbol不参与一般真值输出。 */
      itRenders('no boolean prop with symbol value', async render => {
        const e = await render(<div hidden={Symbol('foo')} />, 1);
        expect(e.hasAttribute('hidden')).toBe(false);
      });
    });

    describe('credentialless property', function () {
      /** Given：iframe的credentialless=true；When：交给 render 渲染；Then：credentialless为空字符串。目的：新布尔属性输出存在性。 */
      itRenders('credentialless prop with true value', async render => {
        const e = await render(<iframe credentialless={true} />);
        expect(e.getAttribute('credentialless')).toBe('');
      });

      /** Given：iframe的credentialless=false；When：交给 render 渲染；Then：没有credentialless属性。目的：新布尔属性的假值省略。 */
      itRenders('credentialless prop with false value', async render => {
        const e = await render(<iframe credentialless={false} />);
        expect(e.hasAttribute('credentialless')).toBe(false);
      });
    });

    describe('download property (combined boolean/string attribute)', function () {
      /** Given：a的download=true；When：交给 render 渲染；Then：download为空字符串。目的：重载布尔属性可表达无文件名下载。 */
      itRenders('download prop with true value', async render => {
        const e = await render(<a download={true} />);
        expect(e.getAttribute('download')).toBe('');
      });

      /** Given：a的download=false；When：交给 render 渲染；Then：download缺失。目的：重载布尔属性假值关闭。 */
      itRenders('download prop with false value', async render => {
        const e = await render(<a download={false} />);
        expect(e.getAttribute('download')).toBe(null);
      });

      /** Given：a的download为myfile；When：交给 render 渲染；Then：download为myfile。目的：重载属性保留具体文件名。 */
      itRenders('download prop with string value', async render => {
        const e = await render(<a download="myfile" />);
        expect(e.getAttribute('download')).toBe('myfile');
      });

      /** Given：a的download为字符串false；When：交给 render 渲染；Then：download为false。目的：字符串false不是布尔假。 */
      itRenders('download prop with string "false" value', async render => {
        const e = await render(<a download="false" />);
        expect(e.getAttribute('download')).toBe('false');
      });

      /** Given：a的download为字符串true；When：交给 render 渲染；Then：download为true。目的：字符串true是文件名而非空布尔值。 */
      itRenders('download prop with string "true" value', async render => {
        const e = await render(<a download={'true'} />);
        expect(e.getAttribute('download')).toBe('true');
      });

      /** Given：a的download=0；When：交给 render 渲染；Then：download为字符串0。目的：重载属性不按数值假值过滤。 */
      itRenders('download prop with number 0 value', async render => {
        const e = await render(<a download={0} />);
        expect(e.getAttribute('download')).toBe('0');
      });

      /** Given：div的download=null；When：交给 render 渲染；Then：没有download属性。目的：null省略重载属性。 */
      itRenders('no download prop with null value', async render => {
        const e = await render(<div download={null} />);
        expect(e.hasAttribute('download')).toBe(false);
      });

      /** Given：div的download=undefined；When：交给 render 渲染；Then：没有download属性。目的：未定义值省略重载属性。 */
      itRenders('no download prop with undefined value', async render => {
        const e = await render(<div download={undefined} />);
        expect(e.hasAttribute('download')).toBe(false);
      });

      /** Given：div的download为函数，错误预算1；When：交给 render 渲染；Then：没有download属性。目的：重载属性也拒绝函数。 */
      itRenders('no download prop with function value', async render => {
        const e = await render(<div download={function () {}} />, 1);
        expect(e.hasAttribute('download')).toBe(false);
      });

      /** Given：div的download为Symbol(foo)，错误预算1；When：交给 render 渲染；Then：没有download属性。目的：重载属性也拒绝Symbol。 */
      itRenders('no download prop with symbol value', async render => {
        const e = await render(<div download={Symbol('foo')} />, 1);
        expect(e.hasAttribute('download')).toBe(false);
      });
    });

    describe('className property', function () {
      /** Given：div的className为myClassName；When：交给 render 渲染；Then：class为myClassName。目的：React名称映射到HTML class。 */
      itRenders('className prop with string value', async render => {
        const e = await render(<div className="myClassName" />);
        expect(e.getAttribute('class')).toBe('myClassName');
      });

      /** Given：div的className为空串；When：交给 render 渲染；Then：class属性存在且为空。目的：空字符串不同于省略。 */
      itRenders('className prop with empty string value', async render => {
        const e = await render(<div className="" />);
        expect(e.getAttribute('class')).toBe('');
      });

      /** Given：div的className=true，错误预算1；When：交给 render 渲染；Then：没有class属性。目的：class不接受布尔真。 */
      itRenders('no className prop with true value', async render => {
        const e = await render(<div className={true} />, 1);
        expect(e.hasAttribute('class')).toBe(false);
      });

      /** Given：div的className=false，错误预算1；When：交给 render 渲染；Then：没有class属性。目的：class不接受布尔假。 */
      itRenders('no className prop with false value', async render => {
        const e = await render(<div className={false} />, 1);
        expect(e.hasAttribute('class')).toBe(false);
      });

      /** Given：div的className=null；When：交给 render 渲染；Then：没有className属性。目的：不把React的prop名称漏到DOM。 */
      itRenders('no className prop with null value', async render => {
        const e = await render(<div className={null} />);
        expect(e.hasAttribute('className')).toBe(false);
      });

      /** Given：div误写classname=test，错误预算1；When：交给 render 渲染；Then：没有class且classname属性存在。目的：错误大小写仍走未知属性而不自动修正。 */
      itRenders('badly cased className with a warning', async render => {
        const e = await render(<div classname="test" />, 1);
        expect(e.hasAttribute('class')).toBe(false);
        expect(e.hasAttribute('classname')).toBe(true);
      });

      /** Given：使用div的class=test，错误预算1；When：交给 render 渲染；Then：e.className为test。目的：HTML别名虽报警仍有DOM效果。 */
      itRenders(
        'className prop when given the alias with a warning',
        async render => {
          const e = await render(<div class="test" />, 1);
          expect(e.className).toBe('test');
        },
      );

      /** Given：使用div的cLASs=test，错误预算1；When：交给 render 渲染；Then：e.className为test。目的：HTML解析/属性设置的大小写规则仍得到class值。 */
      itRenders(
        'className prop when given a badly cased alias',
        async render => {
          const e = await render(<div cLASs="test" />, 1);
          expect(e.className).toBe('test');
        },
      );
    });

    describe('htmlFor property', function () {
      /** Given：div的htmlFor为myFor；When：交给 render 渲染；Then：for属性为myFor。目的：React属性名映射到HTML for。 */
      itRenders('htmlFor with string value', async render => {
        const e = await render(<div htmlFor="myFor" />);
        expect(e.getAttribute('for')).toBe('myFor');
      });

      /** Given：误写div的htmlfor=myFor，错误预算1；When：交给 render 渲染；Then：for缺失而htmlfor为myFor。目的：错误大小写不自动转为别名。 */
      itRenders('no badly cased htmlfor', async render => {
        const e = await render(<div htmlfor="myFor" />, 1);
        expect(e.hasAttribute('for')).toBe(false);
        expect(e.getAttribute('htmlfor')).toBe('myFor');
      });

      /** Given：div的htmlFor为空串；When：交给 render 渲染；Then：for属性为空串。目的：合法别名保留空值。 */
      itRenders('htmlFor with an empty string', async render => {
        const e = await render(<div htmlFor="" />);
        expect(e.getAttribute('for')).toBe('');
      });

      /** Given：div的htmlFor=true，错误预算1；When：交给 render 渲染；Then：for缺失。目的：for不是布尔属性。 */
      itRenders('no htmlFor prop with true value', async render => {
        const e = await render(<div htmlFor={true} />, 1);
        expect(e.hasAttribute('for')).toBe(false);
      });

      /** Given：div的htmlFor=false，错误预算1；When：交给 render 渲染；Then：for缺失。目的：布尔假也不能作为for值。 */
      itRenders('no htmlFor prop with false value', async render => {
        const e = await render(<div htmlFor={false} />, 1);
        expect(e.hasAttribute('for')).toBe(false);
      });

      /** Given：div的htmlFor=null；When：交给 render 渲染；Then：没有htmlFor属性。目的：React保留的别名不成为原名DOM属性。 */
      itRenders('no htmlFor prop with null value', async render => {
        const e = await render(<div htmlFor={null} />);
        expect(e.hasAttribute('htmlFor')).toBe(false);
      });
    });

    describe('numeric properties', function () {
      /** Given：input的size=2；When：交给 render 渲染；Then：size属性为2。目的：正数属性接受正值。 */
      itRenders(
        'positive numeric property with positive value',
        async render => {
          const e = await render(<input size={2} />);
          expect(e.getAttribute('size')).toBe('2');
        },
      );

      /** Given：ol的start=0；When：交给 render 渲染；Then：start属性为0。目的：普通数值属性接受零。 */
      itRenders('numeric property with zero value', async render => {
        const e = await render(<ol start={0} />);
        expect(e.getAttribute('start')).toBe('0');
      });

      /** Given：input的size=0；When：交给 render 渲染；Then：没有size属性。目的：必须为正的数值属性拒绝零。 */
      itRenders(
        'no positive numeric property with zero value',
        async render => {
          const e = await render(<input size={0} />);
          expect(e.hasAttribute('size')).toBe(false);
        },
      );

      /** Given：ol的start为函数，错误预算1；When：交给 render 渲染；Then：没有start属性。目的：数值属性过滤函数。 */
      itRenders('no numeric prop with function value', async render => {
        const e = await render(<ol start={function () {}} />, 1);
        expect(e.hasAttribute('start')).toBe(false);
      });

      /** Given：ol的start为Symbol(foo)，错误预算1；When：交给 render 渲染；Then：没有start属性。目的：数值属性过滤Symbol。 */
      itRenders('no numeric prop with symbol value', async render => {
        const e = await render(<ol start={Symbol('foo')} />, 1);
        expect(e.hasAttribute('start')).toBe(false);
      });

      /** Given：input的size为函数，错误预算1；When：交给 render 渲染；Then：没有size属性。目的：正数属性过滤非法类型。 */
      itRenders(
        'no positive numeric prop with function value',
        async render => {
          const e = await render(<input size={function () {}} />, 1);
          expect(e.hasAttribute('size')).toBe(false);
        },
      );

      /** Given：input的size为Symbol(foo)，错误预算1；When：交给 render 渲染；Then：没有size属性。目的：正数属性不会强制转换Symbol。 */
      itRenders('no positive numeric prop with symbol value', async render => {
        const e = await render(<input size={Symbol('foo')} />, 1);
        expect(e.hasAttribute('size')).toBe(false);
      });
    });

    describe('props with special meaning in React', function () {
      /** Given：RefComponent在render中为div创建ref；When：交给 render 渲染；Then：ref属性为null。目的：实例引用由React管理，不序列化为DOM属性。 */
      itRenders('no ref attribute', async render => {
        /** 仅渲染带新ref的div的类fixture；用于证明ref参与实例关联而不是DOM属性。 */
        class RefComponent extends React.Component {
          /**
           * 创建本次render使用的ref并返回div描述记录；ref不作为字符串HTML属性输出。
           * @returns 带React.createRef()引用的div元素。
           */
          render() {
            return <div ref={React.createRef()} />;
          }
        }
        const e = await render(<RefComponent />);
        expect(e.getAttribute('ref')).toBe(null);
      });

      /** Given：createElement为div提供children字符串foo；When：交给 render 渲染；Then：children属性为null。目的：children用来构造子树，不成为属性。 */
      itRenders('no children attribute', async render => {
        const e = await render(React.createElement('div', {}, 'foo'));
        expect(e.getAttribute('children')).toBe(null);
      });

      /** Given：div带key=foo；When：交给 render 渲染；Then：key属性为null。目的：协调身份不泄露为宿主属性。 */
      itRenders('no key attribute', async render => {
        const e = await render(<div key="foo" />);
        expect(e.getAttribute('key')).toBe(null);
      });

      /** Given：div使用dangerouslySetInnerHTML注入foo标签；When：交给 render 渲染；Then：dangerouslySetInnerHTML属性为null。目的：HTML注入配置不序列化为属性。 */
      itRenders('no dangerouslySetInnerHTML attribute', async render => {
        const e = await render(
          <div dangerouslySetInnerHTML={{__html: '<foo />'}} />,
        );
        expect(e.getAttribute('dangerouslySetInnerHTML')).toBe(null);
      });

      /** Given：div带suppressContentEditableWarning=true；When：交给 render 渲染；Then：同名属性为null。目的：警告开关只由React消费。 */
      itRenders('no suppressContentEditableWarning attribute', async render => {
        const e = await render(<div suppressContentEditableWarning={true} />);
        expect(e.getAttribute('suppressContentEditableWarning')).toBe(null);
      });

      /** Given：span带suppressHydrationWarning=true；When：交给 render 渲染；Then：同名属性为null。目的：hydration开关不输出为DOM属性。 */
      itRenders('no suppressHydrationWarning attribute', async render => {
        const e = await render(<span suppressHydrationWarning={true} />);
        expect(e.getAttribute('suppressHydrationWarning')).toBe(null);
      });
    });

    describe('inline styles', function () {
      /** Given：div的style含color red和width 30px；When：交给 render 渲染；Then：style.color为red、width为30px。目的：样式对象映射到CSS属性。 */
      itRenders('simple styles', async render => {
        const e = await render(<div style={{color: 'red', width: '30px'}} />);
        expect(e.style.color).toBe('red');
        expect(e.style.width).toBe('30px');
      });

      /** Given：div样式含left 0、margin 16、opacity 0.5、padding 4px；When：交给 render 渲染；Then：分别为0px、16px、0.5、4px。目的：长度补px而无单位数值和已有单位保留。 */
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

      /** Given：div样式自定义属性--foo=5；When：交给 render 渲染；Then：getPropertyValue为字符串5。目的：CSS自定义属性不自动补px。 */
      itRenders('custom properties', async render => {
        const e = await render(<div style={{'--foo': 5}} />);
        expect(e.style.getPropertyValue('--foo')).toBe('5');
      });

      /** Given：自定义属性--someColor为#000000；When：交给 render 渲染；Then：同大小写名称读到#000000。目的：自定义CSS属性保留名称大小写。 */
      itRenders('camel cased custom properties', async render => {
        const e = await render(<div style={{'--someColor': '#000000'}} />);
        expect(e.style.getPropertyValue('--someColor')).toBe('#000000');
      });

      /** Given：style.color=undefined且width=30px；When：交给 render 渲染；Then：color为空、width为30px。目的：忽略未定义项而不丢其他样式。 */
      itRenders('no undefined styles', async render => {
        const e = await render(
          <div style={{color: undefined, width: '30px'}} />,
        );
        expect(e.style.color).toBe('');
        expect(e.style.width).toBe('30px');
      });

      /** Given：style.color=null且width=30px；When：交给 render 渲染；Then：color为空、width为30px。目的：null清空单项样式。 */
      itRenders('no null styles', async render => {
        const e = await render(<div style={{color: null, width: '30px'}} />);
        expect(e.style.color).toBe('');
        expect(e.style.width).toBe('30px');
      });

      /** Given：style的color与width均为null；When：交给 render 渲染；Then：两项为空且没有style属性。目的：全空对象不输出空style。 */
      itRenders('no empty styles', async render => {
        const e = await render(<div style={{color: null, width: null}} />);
        expect(e.style.color).toBe('');
        expect(e.style.width).toBe('');
        expect(e.hasAttribute('style')).toBe(false);
      });

      /** Given：style.lineClamp=10，其他厂商前缀断言仍被注释；When：交给 render 渲染；Then：get到lineClamp字符串10。目的：仅验证实际执行的无单位属性，不把未启用前缀算为覆盖。 */
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
      /** Given：div的aria-label=hello；When：交给 render 渲染；Then：aria-label为hello。目的：ARIA字符串属性原样输出。 */
      itRenders('simple strings', async render => {
        const e = await render(<div aria-label="hello" />);
        expect(e.getAttribute('aria-label')).toBe('hello');
      });

      // ARIA 属性接受布尔值并输出字符串 "false"，与 HTML 布尔属性的存在/缺失规则不同。
      /** Given：div的aria-label=false；When：交给 render 渲染；Then：aria-label为字符串false。目的：ARIA布尔值使用字符串语义。 */
      itRenders('aria string prop with false value', async render => {
        const e = await render(<div aria-label={false} />);
        expect(e.getAttribute('aria-label')).toBe('false');
      });

      /** Given：div的aria-label=null；When：交给 render 渲染；Then：没有aria-label属性。目的：null省略ARIA属性。 */
      itRenders('no aria prop with null value', async render => {
        const e = await render(<div aria-label={null} />);
        expect(e.hasAttribute('aria-label')).toBe(false);
      });

      /** Given：div误用aria=hello，错误预算1；When：交给 render 渲染；Then：aria属性仍为hello。目的：非法ARIA名称报警但保留普通属性。 */
      itRenders('"aria" attribute with a warning', async render => {
        // 预留用于未来使用。
        const e = await render(<div aria="hello" />, 1);
        expect(e.getAttribute('aria')).toBe('hello');
      });
    });

    describe('cased attributes', function () {
      /** Given：form误写acceptcharset=utf-8，错误预算1；When：交给 render 渲染；Then：accept-charset缺失、acceptcharset为utf-8。目的：错误别名不会自动转为正确HTML名称。 */
      itRenders(
        'badly cased aliased HTML attribute with a warning',
        async render => {
          const e = await render(<form acceptcharset="utf-8" />, 1);
          expect(e.hasAttribute('accept-charset')).toBe(false);
          expect(e.getAttribute('acceptcharset')).toBe('utf-8');
        },
      );

      /** Given：svg text误写textlength=10，错误预算1；When：交给 render 渲染；Then：全新客户端保留textlength；解析SSR及匹配hydration得到textLength。目的：区分客户端SVG区分大小写与HTML解析器规范化。 */
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

      /** Given：svg text误写strokedasharray为10 10，错误预算1；When：交给 render 渲染；Then：stroke-dasharray缺失、strokedasharray保留。目的：错误合并名称不自动转为SVG别名。 */
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

      /** Given：svg text直接使用stroke-dasharray为10 10，错误预算1；When：交给 render 渲染；Then：正确连字符属性为10 10。目的：原HTML/SVG名称可输出但React名称校验报警。 */
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
      /** Given：div的未知foo=bar；When：交给 render 渲染；Then：foo属性为bar。目的：允许安全未知字符串属性。 */
      itRenders('unknown attributes', async render => {
        const e = await render(<div foo="bar" />);
        expect(e.getAttribute('foo')).toBe('bar');
      });

      /** Given：div的data-foo=bar；When：交给 render 渲染；Then：data-foo为bar。目的：data扩展属性传递字符串。 */
      itRenders('unknown data- attributes', async render => {
        const e = await render(<div data-foo="bar" />);
        expect(e.getAttribute('data-foo')).toBe('bar');
      });

      /** Given：div误写CHILDREN=5，错误预算1；When：交给 render 渲染；Then：getAttribute(CHILDREN)为5。目的：大小写错误不会被当成真正children配置。 */
      itRenders('badly cased reserved attributes', async render => {
        const e = await render(<div CHILDREN="5" />, 1);
        expect(e.getAttribute('CHILDREN')).toBe('5');
      });

      /** Given：object的data=hello；When：交给 render 渲染；Then：data属性为hello。目的：object资源地址是合法属性。 */
      itRenders('"data" attribute', async render => {
        // 对于 `<object />` 起到 `src` 的作用。
        const e = await render(<object data="hello" />);
        expect(e.getAttribute('data')).toBe('hello');
      });

      /** Given：div的data-foo=null；When：交给 render 渲染；Then：没有data-foo属性。目的：null省略data扩展属性。 */
      itRenders('no unknown data- attributes with null value', async render => {
        const e = await render(<div data-foo={null} />);
        expect(e.hasAttribute('data-foo')).toBe(false);
      });

      /** Given：div的data-fooBar=true字符串，错误预算1；When：交给 render 渲染；Then：data-foobar为true。目的：HTML属性名规范化但警告错误大小写。 */
      itRenders('unknown data- attributes with casing', async render => {
        const e = await render(<div data-fooBar="true" />, 1);
        expect(e.getAttribute('data-foobar')).toBe('true');
      });

      /** Given：div的data-foobar=true；When：交给 render 渲染；Then：属性为字符串true。目的：data布尔值不使用HTML布尔属性规则。 */
      itRenders('unknown data- attributes with boolean true', async render => {
        const e = await render(<div data-foobar={true} />);
        expect(e.getAttribute('data-foobar')).toBe('true');
      });

      /** Given：div的data-foobar=false；When：交给 render 渲染；Then：属性为字符串false。目的：data保留布尔假文本。 */
      itRenders('unknown data- attributes with boolean false', async render => {
        const e = await render(<div data-foobar={false} />);
        expect(e.getAttribute('data-foobar')).toBe('false');
      });

      /** Given：div的data-fooBar=null，错误预算1；When：交给 render 渲染；Then：没有data-foobar属性。目的：名称诊断与空值省略可以同时发生。 */
      itRenders(
        'no unknown data- attributes with casing and null value',
        async render => {
          const e = await render(<div data-fooBar={null} />, 1);
          expect(e.hasAttribute('data-foobar')).toBe(false);
        },
      );

      /** Given：预先用flushSync创建nonstandard并消费未识别标签警告，再渲染foo=bar；When：交给 render 渲染；Then：foo为bar。目的：先触发去重缓存使跨模式只验证未知标签的属性传递。 */
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

      /** Given：svg含font-face且accentHeight=10；When：交给 render 渲染；Then：accentHeight缺失、accent-height为10。目的：带连字符SVG标签仍使用SVG属性映射。 */
      itRenders('SVG tags with dashes in them', async render => {
        const e = await render(
          <svg>
            <font-face accentHeight={10} />
          </svg>,
        );
        expect(e.firstChild.hasAttribute('accentHeight')).toBe(false);
        expect(e.firstChild.getAttribute('accent-height')).toBe('10');
      });

      /** Given：div的fooBar=test，错误预算1；When：交给 render 渲染；Then：foobar属性为test。目的：未知HTML属性大小写规范化并报警。 */
      itRenders('cased custom attributes', async render => {
        const e = await render(<div fooBar="test" />, 1);
        expect(e.getAttribute('foobar')).toBe('test');
      });
    });

    /** Given：div带onClick函数；When：交给 render 渲染；Then：onClick与click属性均为null。目的：事件处理器不输出为可执行HTML属性。 */
    itRenders('no HTML events', async render => {
      const e = await render(<div onClick={() => {}} />);
      expect(e.getAttribute('onClick')).toBe(null);
      expect(e.getAttribute('onClick')).toBe(null);
      expect(e.getAttribute('click')).toBe(null);
    });

    /** Given：div带onunknownevent字符串，错误预算1；When：交给 render 渲染；Then：同名属性为null。目的：过滤未知事件样式的字符串属性。 */
    itRenders('no unknown events', async render => {
      const e = await render(<div onunknownevent='alert("hack")' />, 1);
      expect(e.getAttribute('onunknownevent')).toBe(null);
    });

    /** Given：div的on为tap:do-something；When：交给 render 渲染；Then：on属性保留该字符串。目的：单独on不满足事件名过滤规则。 */
    itRenders('custom attribute named `on`', async render => {
      const e = await render(<div on="tap:do-something" />);
      expect(e.getAttribute('on')).toEqual('tap:do-something');
    });
  });

  // 这些用例记录自定义元素的属性传递行为，包括字符串、布尔值和事件 prop 的差异。
  describe('custom elements', () => {
    /** Given：div通过is=custom-element使用class=test；When：交给 render 渲染；Then：class为test且错误预算0。目的：定制内建元素接受HTML class名称。 */
    itRenders('class for custom elements', async render => {
      const e = await render(<div is="custom-element" class="test" />, 0);
      expect(e.getAttribute('class')).toBe('test');
    });

    /** Given：定制内建div使用className=test；When：交给 render 渲染；Then：className缺失、class为test。目的：内建标签仍执行className映射。 */
    itRenders('className for is elements', async render => {
      const e = await render(<div is="custom-element" className="test" />, 0);
      expect(e.getAttribute('className')).toBe(null);
      expect(e.getAttribute('class')).toBe('test');
    });

    /** Given：custom-element使用className=test；When：交给 render 渲染；Then：className缺失、class为test。目的：自定义标签也特殊处理className。 */
    itRenders('className for custom elements', async render => {
      const e = await render(<custom-element className="test" />, 0);
      expect(e.getAttribute('className')).toBe(null);
      expect(e.getAttribute('class')).toBe('test');
    });

    /** Given：定制内建div使用htmlFor=test；When：交给 render 渲染；Then：htmlFor缺失、for为test。目的：内建标签继续使用htmlFor别名。 */
    itRenders('htmlFor property on is elements', async render => {
      const e = await render(<div is="custom-element" htmlFor="test" />);
      expect(e.getAttribute('htmlFor')).toBe(null);
      expect(e.getAttribute('for')).toBe('test');
    });

    /** Given：custom-element使用htmlFor=test；When：交给 render 渲染；Then：htmlFor为test、for缺失。目的：自定义标签按原属性名传递htmlFor。 */
    itRenders('htmlFor attribute on custom elements', async render => {
      const e = await render(<custom-element htmlFor="test" />);
      expect(e.getAttribute('htmlFor')).toBe('test');
      expect(e.getAttribute('for')).toBe(null);
    });

    /** Given：定制内建div直接使用for=test；When：交给 render 渲染；Then：htmlFor缺失、for为test。目的：原HTML for名在定制内建元素中可使用。 */
    itRenders('for attribute on custom elements', async render => {
      const e = await render(<div is="custom-element" for="test" />);
      expect(e.getAttribute('htmlFor')).toBe(null);
      expect(e.getAttribute('for')).toBe('test');
    });

    /** Given：custom-element的foo=bar；When：交给 render 渲染；Then：foo属性为bar。目的：自定义元素接收未知字符串属性。 */
    itRenders('unknown attributes for custom elements', async render => {
      const e = await render(<custom-element foo="bar" />);
      expect(e.getAttribute('foo')).toBe('bar');
    });

    /** Given：custom-element的onunknown=bar；When：交给 render 渲染；Then：onunknown属性为bar。目的：自定义元素的字符串on前缀属性不同于普通HTML过滤。 */
    itRenders('unknown `on*` attributes for custom elements', async render => {
      const e = await render(<custom-element onunknown="bar" />);
      expect(e.getAttribute('onunknown')).toBe('bar');
    });

    /** Given：custom-element的foo=true；When：交给 render 渲染；Then：foo为空字符串。目的：标题虽称as strings，实际断言真值属性存在为空。 */
    itRenders('unknown boolean `true` attributes as strings', async render => {
      const e = await render(<custom-element foo={true} />);
      expect(e.getAttribute('foo')).toBe('');
    });

    /** Given：custom-element的foo=false；When：交给 render 渲染；Then：foo属性缺失。目的：标题虽称as strings，实际布尔假被省略。 */
    itRenders('unknown boolean `false` attributes as strings', async render => {
      const e = await render(<custom-element foo={false} />);
      expect(e.getAttribute('foo')).toBe(null);
    });

    /** Given：div的inert=true，错误预算0；When：交给 render 渲染；Then：inert为空字符串。目的：新的HTML布尔属性输出存在性。 */
    itRenders('new boolean `true` attributes', async render => {
      const element = await render(<div inert={true} />, 0);

      expect(element.getAttribute('inert')).toBe('');
    });

    /** Given：div的inert为空字符串，错误预算1；When：交给 render 渲染；Then：inert属性为null。目的：空串按假值处理并诊断布尔属性用法。 */
    itRenders('new boolean `""` attributes', async render => {
      const element = await render(
        <div inert="" />,
        // 警告：由于此已渲染为 `inert=""` 如 `inert={true}`，但现在渲染为 `inert={false}`。
        1,
      );

      expect(element.getAttribute('inert')).toBe(null);
    });

    /** Given：div的inert=false，错误预算0；When：交给 render 渲染；Then：inert属性为null。目的：布尔假移除inert。 */
    itRenders('new boolean `false` attributes', async render => {
      const element = await render(<div inert={false} />, 0);

      expect(element.getAttribute('inert')).toBe(null);
    });

    /** Given：custom-element的foo=null；When：交给 render 渲染；Then：没有foo属性。目的：null同样省略自定义属性。 */
    itRenders(
      'no unknown attributes for custom elements with null value',
      async render => {
        const e = await render(<custom-element foo={null} />);
        expect(e.hasAttribute('foo')).toBe(false);
      },
    );

    /** Given：定制内建div的foo=bar；When：交给 render 渲染；Then：foo属性为bar。目的：is标记不妨碍未知属性传递。 */
    itRenders(
      'unknown attributes for custom elements using is',
      async render => {
        const e = await render(<div is="custom-element" foo="bar" />);
        expect(e.getAttribute('foo')).toBe('bar');
      },
    );

    /** Given：定制内建div的foo=null；When：交给 render 渲染；Then：没有foo属性。目的：null省略规则覆盖is元素。 */
    itRenders(
      'no unknown attributes for custom elements using is with null value',
      async render => {
        const e = await render(<div is="custom-element" foo={null} />);
        expect(e.hasAttribute('foo')).toBe(false);
      },
    );
  });
});
