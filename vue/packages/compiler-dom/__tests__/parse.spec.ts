/**
 * DOM parser 场景：在 core 语法之上验证 HTML 实体、void/pre 标签、原生/组件判定以及
 * HTML→SVG→MathML 命名空间切换和集成点恢复。
 */
import {
  type AttributeNode,
  ConstantTypes,
  type ElementNode,
  ElementTypes,
  type InterpolationNode,
  Namespaces,
  NodeTypes,
  type TextNode,
  baseParse as parse,
} from '@vue/compiler-core'
import { parserOptions } from '../src/parserOptions'

describe('DOM parser', () => {
  // DOM 文本：验证命名实体、数字实体、特殊标签内容和 HTML 空白规则。
  describe('Text', () => {
    /**
     * 场景：textarea 内容含 div 标记和 HTML 注释，使用 DOM parserOptions 解析，断言只有一个 TEXT 且 loc 保留整个原串，验证 RCDATA 不创建这些内部元素/注释节点。
     */
    test('textarea handles comments/elements as just text', () => {
      const ast = parse(
        '<textarea>some<div>text</div>and<!--comment--></textarea>',
        parserOptions,
      )
      const element = ast.children[0] as ElementNode
      const text = element.children[0] as TextNode
      expect(element.children.length).toBe(1)
      expect(text).toStrictEqual({
        type: NodeTypes.TEXT,
        content: 'some<div>text</div>and<!--comment-->',
        loc: {
          start: { offset: 10, line: 1, column: 11 },
          end: { offset: 46, line: 1, column: 47 },
          source: 'some<div>text</div>and<!--comment-->',
        },
      })
    })

    /**
     * 场景：textarea 内容以换行开头，解析后断言 content 去掉首换行而 loc.source/位置仍覆盖原文本，验证内容规范化不会丢掉源码范围。
     */
    test('<textarea> should remove leading newline', () => {
      const ast = parse('<textarea>\nhello</textarea>', parserOptions)
      const element = ast.children[0] as ElementNode
      const text = element.children[0] as TextNode
      expect(element.children.length).toBe(1)
      expect(text).toStrictEqual({
        type: NodeTypes.TEXT,
        content: 'hello',
        loc: {
          start: { offset: 10, line: 1, column: 11 },
          end: { offset: 16, line: 2, column: 6 },
          source: '\nhello',
        },
      })
    })

    /**
     * 场景：大写 TextArea 按组件解析，断言内部依次为 TEXT/ELEMENT/TEXT/COMMENT，验证组件拼写不会误触小写 textarea 特殊内容模式。
     */
    test('should not treat Uppercase component as special tag', () => {
      const ast = parse(
        '<TextArea>some<div>text</div>and<!--comment--></TextArea>',
        parserOptions,
      )
      const element = ast.children[0] as ElementNode
      expect(element.children.map(n => n.type)).toMatchObject([
        NodeTypes.TEXT,
        NodeTypes.ELEMENT,
        NodeTypes.TEXT,
        NodeTypes.COMMENT,
      ])
    })

    /**
     * 场景：textarea 包含 &amp;，断言内容为 & 且源码范围仍是实体串，验证 RCDATA 解码字符实体并保留映射位置。
     */
    test('textarea handles entities', () => {
      const ast = parse('<textarea>&amp;</textarea>', parserOptions)
      const element = ast.children[0] as ElementNode
      const text = element.children[0] as TextNode

      expect(text).toStrictEqual({
        type: NodeTypes.TEXT,
        content: '&',
        loc: {
          start: { offset: 10, line: 1, column: 11 },
          end: { offset: 15, line: 1, column: 16 },
          source: '&amp;',
        },
      })
    })

    /**
     * 场景：textarea 内有 <div> 文本及 {{ foo }}，断言标签保持文本、插值仍形成表达式节点，验证特殊内容模式与 Vue 插值可以共存。
     */
    test('textarea support interpolation', () => {
      const ast = parse('<textarea><div>{{ foo }}</textarea>', parserOptions)
      const element = ast.children[0] as ElementNode
      expect(element.children).toMatchObject([
        { type: NodeTypes.TEXT, content: `<div>` },
        {
          type: NodeTypes.INTERPOLATION,
          content: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: `foo`,
            isStatic: false,
          },
        },
      ])
    })

    /**
     * 场景：style 内含 div 标记与注释，断言整段 TEXT 及原范围，验证 RAWTEXT 不将 CSS 中的标记解析为节点。
     */
    test('style handles comments/elements as just a text', () => {
      const ast = parse(
        '<style>some<div>text</div>and<!--comment--></style>',
        parserOptions,
      )
      const element = ast.children[0] as ElementNode
      const text = element.children[0] as TextNode

      expect(text).toStrictEqual({
        type: NodeTypes.TEXT,
        content: 'some<div>text</div>and<!--comment-->',
        loc: {
          start: { offset: 7, line: 1, column: 8 },
          end: { offset: 43, line: 1, column: 44 },
          source: 'some<div>text</div>and<!--comment-->',
        },
      })
    })

    /**
     * 场景：style 内输入 &amp;，断言 TEXT 仍为 &amp;，验证 RAWTEXT 不套用普通文本的字符实体解码。
     */
    test("style doesn't handle character references", () => {
      const ast = parse('<style>&amp;</style>', parserOptions)
      const element = ast.children[0] as ElementNode
      const text = element.children[0] as TextNode

      expect(text).toStrictEqual({
        type: NodeTypes.TEXT,
        content: '&amp;',
        loc: {
          start: { offset: 7, line: 1, column: 8 },
          end: { offset: 12, line: 1, column: 13 },
          source: '&amp;',
        },
      })
    })

    /**
     * 场景：SVG 内输入 CDATA，断言得到内容 some text 的 TEXT 和只覆盖内容的 loc，验证外来命名空间允许 CDATA，包裹标记不进入内容。
     */
    test('CDATA', () => {
      const ast = parse('<svg><![CDATA[some text]]></svg>', parserOptions)
      const text = (ast.children[0] as ElementNode).children![0] as TextNode

      expect(text).toStrictEqual({
        type: NodeTypes.TEXT,
        content: 'some text',
        loc: {
          start: { offset: 14, line: 1, column: 15 },
          end: { offset: 23, line: 1, column: 24 },
          source: 'some text',
        },
      })
    })

    /**
     * 场景：pre 中混合多空格、换行及嵌套 div，断言每段文本保持原始空白，验证 pre 的保留策略向元素后代传播。
     */
    test('<pre> tag should preserve raw whitespace', () => {
      const rawText = `  \na   <div>foo \n bar</div>   \n   c`
      const ast = parse(`<pre>${rawText}</pre>`, parserOptions)
      expect((ast.children[0] as ElementNode).children).toMatchObject([
        {
          type: NodeTypes.TEXT,
          content: `  \na   `,
        },
        {
          type: NodeTypes.ELEMENT,
          children: [
            {
              type: NodeTypes.TEXT,
              content: `foo \n bar`,
            },
          ],
        },
        {
          type: NodeTypes.TEXT,
          content: `   \n   c`,
        },
      ])
    })

    // #908：HTML 规范要求 `<pre>` 直接内容开头的单个换行被忽略，但嵌套元素中的换行保留。
    /**
     * 场景：pre 自身及嵌套 div 的内容都以换行开头，断言只去掉 pre 直接内容的首换行，验证忽略首换行规则不误用于嵌套元素。
     */
    test('<pre> tag should remove leading newline', () => {
      const rawText = `\nhello<div>\nbye</div>`
      const ast = parse(`<pre>${rawText}</pre>`, parserOptions)
      expect((ast.children[0] as ElementNode).children).toMatchObject([
        {
          type: NodeTypes.TEXT,
          content: `hello`,
        },
        {
          type: NodeTypes.ELEMENT,
          children: [
            {
              type: NodeTypes.TEXT,
              // 只有 pre 自身直接内容的首换行被移除，嵌套元素的首换行必须保留。
              content: `\nbye`,
            },
          ],
        },
      ])
    })

    // #945：NBSP 不是可折叠 ASCII 空白，condense 策略也必须保留连续不换行空格。
    /**
     * 场景：普通文本包含连续两个 &nbsp;，断言解析后保留两个 U+00A0，验证默认空白凝聚仅针对可折叠 ASCII 空白。
     */
    test('&nbsp; should not be condensed', () => {
      const nbsp = String.fromCharCode(160)
      const ast = parse(`foo&nbsp;&nbsp;bar`, parserOptions)
      expect(ast.children[0]).toMatchObject({
        type: NodeTypes.TEXT,
        content: `foo${nbsp}${nbsp}bar`,
      })
    })

    // https://html.spec.whatwg.org/multipage/parsing.html#named-character-reference-state
    /**
     * 场景：文本输入 &ampersand;，断言兼容解码为 &ersand; 且 loc 仍覆盖原串，验证缺少分号的已知实体前缀在文本上下文可被消费。
     */
    test('HTML entities compatibility in text', () => {
      const ast = parse('&ampersand;', parserOptions)
      const text = ast.children[0] as TextNode

      expect(text).toStrictEqual({
        type: NodeTypes.TEXT,
        content: '&ersand;',
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 11, line: 1, column: 12 },
          source: '&ampersand;',
        },
      })
    })

    // https://html.spec.whatwg.org/multipage/parsing.html#named-character-reference-state
    /**
     * 场景：三个属性分别输入 &ampersand;、&amp;ersand; 与 &amp!，断言只有后两项解码；同时检查含引号的 source 范围，验证属性上下文的字母边界限制。
     */
    test('HTML entities compatibility in attribute', () => {
      const ast = parse(
        '<div a="&ampersand;" b="&amp;ersand;" c="&amp!"></div>',
        parserOptions,
      )
      const element = ast.children[0] as ElementNode
      const text1 = (element.props[0] as AttributeNode).value
      const text2 = (element.props[1] as AttributeNode).value
      const text3 = (element.props[2] as AttributeNode).value

      expect(text1).toStrictEqual({
        type: NodeTypes.TEXT,
        content: '&ampersand;',
        loc: {
          start: { offset: 7, line: 1, column: 8 },
          end: { offset: 20, line: 1, column: 21 },
          source: '"&ampersand;"',
        },
      })
      expect(text2).toStrictEqual({
        type: NodeTypes.TEXT,
        content: '&ersand;',
        loc: {
          start: { offset: 23, line: 1, column: 24 },
          end: { offset: 37, line: 1, column: 38 },
          source: '"&amp;ersand;"',
        },
      })
      expect(text3).toStrictEqual({
        type: NodeTypes.TEXT,
        content: '&!',
        loc: {
          start: { offset: 40, line: 1, column: 41 },
          end: { offset: 47, line: 1, column: 48 },
          source: '"&amp!"',
        },
      })
    })

    /**
     * 场景：文本使用控制区数值实体 &#x86;，断言内容替换为 † 且 loc 保留实体原串，验证实体解码的兼容映射。
     */
    test('Some control character reference should be replaced.', () => {
      const ast = parse('&#x86;', parserOptions)
      const text = ast.children[0] as TextNode

      expect(text).toStrictEqual({
        type: NodeTypes.TEXT,
        content: '†',
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 6, line: 1, column: 7 },
          source: '&#x86;',
        },
      })
    })
  })

  // DOM 插值：为兼容旧模板，插值内容也会解码实体；JS parser 接收解码后的表达式，
  // loc.source 仍保留原始模板文本。
  describe('Interpolation', () => {
    /**
     * 场景：插值 a &lt; b，经 DOM 解析得到表达式 a < b，断言表达式/插值两个 loc 仍保存未解码来源，验证兼容解码与源码定位分离。
     */
    test('HTML entities in interpolation should be translated for backward compatibility.', () => {
      const ast = parse('<div>{{ a &lt; b }}</div>', parserOptions)
      const element = ast.children[0] as ElementNode
      const interpolation = element.children[0] as InterpolationNode

      expect(interpolation).toStrictEqual({
        type: NodeTypes.INTERPOLATION,
        content: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: `a < b`,
          isStatic: false,
          constType: ConstantTypes.NOT_CONSTANT,
          loc: {
            start: { offset: 8, line: 1, column: 9 },
            end: { offset: 16, line: 1, column: 17 },
            source: 'a &lt; b',
          },
        },
        loc: {
          start: { offset: 5, line: 1, column: 6 },
          end: { offset: 19, line: 1, column: 20 },
          source: '{{ a &lt; b }}',
        },
      })
    })
  })

  // DOM 元素：覆盖 pre 换行、void 标签和平台原生/组件识别。
  describe('Element', () => {
    /**
     * 场景：img 后紧跟 after 文本且没有结束标签，断言 img 的 children 为空、loc 仅到 >，验证 void 标签不吞掉后续兄弟内容。
     */
    test('void element', () => {
      const ast = parse('<img>after', parserOptions)
      const element = ast.children[0] as ElementNode

      expect(element).toStrictEqual({
        type: NodeTypes.ELEMENT,
        ns: Namespaces.HTML,
        tag: 'img',
        tagType: ElementTypes.ELEMENT,
        props: [],
        children: [],
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 5, line: 1, column: 6 },
          source: '<img>',
        },
        codegenNode: undefined,
      })
    })

    /**
     * 场景：并列 div、comp 与 Comp，断言只有 div 是原生元素，两种 comp 拼写均为组件，验证平台原生标签表与组件判定。
     */
    test('native element', () => {
      const ast = parse('<div></div><comp></comp><Comp></Comp>', parserOptions)

      expect(ast.children[0]).toMatchObject({
        type: NodeTypes.ELEMENT,
        tag: 'div',
        tagType: ElementTypes.ELEMENT,
      })

      expect(ast.children[1]).toMatchObject({
        type: NodeTypes.ELEMENT,
        tag: 'comp',
        tagType: ElementTypes.COMPONENT,
      })

      expect(ast.children[2]).toMatchObject({
        type: NodeTypes.ELEMENT,
        tag: 'Comp',
        tagType: ElementTypes.COMPONENT,
      })
    })

    /**
     * 场景：textarea 内容含不完整结束前缀和 textarea0，直到混合大小写的有效结束标签才闭合，断言伪结束串保留为文本，验证结束标签边界匹配。
     */
    test('Strict end tag detection for textarea.', () => {
      const ast = parse(
        '<textarea>hello</textarea</textarea0></texTArea>',
        parserOptions,
      )
      const element = ast.children[0] as ElementNode
      const text = element.children[0] as TextNode

      expect(ast.children.length).toBe(1)
      expect(text).toStrictEqual({
        type: NodeTypes.TEXT,
        content: 'hello</textarea</textarea0>',
        loc: {
          start: { offset: 10, line: 1, column: 11 },
          end: { offset: 37, line: 1, column: 38 },
          source: 'hello</textarea</textarea0>',
        },
      })
    })
  })

  // 命名空间：逐层验证 SVG/MathML 的进入、integration point 和退出规则。
  describe('Namespaces', () => {
    /**
     * 场景：解析 html 根并断言 HTML namespace，验证默认根命名空间。
     */
    test('HTML namespace', () => {
      const ast = parse('<html>test</html>', parserOptions)
      const element = ast.children[0] as ElementNode

      expect(element.ns).toBe(Namespaces.HTML)
    })

    /**
     * 场景：解析 svg 根并断言 SVG namespace，验证 HTML 中的 svg 入口切换。
     */
    test('SVG namespace', () => {
      const ast = parse('<svg>test</svg>', parserOptions)
      const element = ast.children[0] as ElementNode

      expect(element.ns).toBe(Namespaces.SVG)
    })

    /**
     * 场景：解析 math 根并断言 MATH_ML namespace，验证 MathML 入口切换。
     */
    test('MATH_ML namespace', () => {
      const ast = parse('<math>test</math>', parserOptions)
      const element = ast.children[0] as ElementNode

      expect(element.ns).toBe(Namespaces.MATH_ML)
    })

    /**
     * 场景：math/annotation-xml 内嵌 svg，断言 math 为 MathML 而 svg 为 SVG，验证 annotation-xml 的 svg 特例优先切换。
     */
    test('SVG in MATH_ML namespace', () => {
      const ast = parse(
        '<math><annotation-xml><svg></svg></annotation-xml></math>',
        parserOptions,
      )
      const elementMath = ast.children[0] as ElementNode
      const elementAnnotation = elementMath.children[0] as ElementNode
      const elementSvg = elementAnnotation.children[0] as ElementNode

      expect(elementMath.ns).toBe(Namespaces.MATH_ML)
      expect(elementSvg.ns).toBe(Namespaces.SVG)
    })

    /**
     * 场景：annotation-xml 的 encoding=text/html 包含 test，断言子元素切回 HTML、math 根不变，验证 HTML 集成点。
     */
    test('html text/html in MATH_ML namespace', () => {
      const ast = parse(
        '<math><annotation-xml encoding="text/html"><test/></annotation-xml></math>',
        parserOptions,
      )

      const elementMath = ast.children[0] as ElementNode
      const elementAnnotation = elementMath.children[0] as ElementNode
      const element = elementAnnotation.children[0] as ElementNode

      expect(elementMath.ns).toBe(Namespaces.MATH_ML)
      expect(element.ns).toBe(Namespaces.HTML)
    })

    /**
     * 场景：annotation-xml 的 encoding=application/xhtml+xml 包含 test，断言子元素切回 HTML，验证第二种兼容 HTML 编码值。
     */
    test('html application/xhtml+xml in MATH_ML namespace', () => {
      const ast = parse(
        '<math><annotation-xml encoding="application/xhtml+xml"><test/></annotation-xml></math>',
        parserOptions,
      )
      const elementMath = ast.children[0] as ElementNode
      const elementAnnotation = elementMath.children[0] as ElementNode
      const element = elementAnnotation.children[0] as ElementNode

      expect(elementMath.ns).toBe(Namespaces.MATH_ML)
      expect(element.ns).toBe(Namespaces.HTML)
    })

    /**
     * 场景：math/mtext 内是 malignmark，断言该子节点仍为 MathML，验证文本集成点的保留例外。
     */
    test('mtext malignmark in MATH_ML namespace', () => {
      const ast = parse(
        '<math><mtext><malignmark/></mtext></math>',
        parserOptions,
      )
      const elementMath = ast.children[0] as ElementNode
      const elementText = elementMath.children[0] as ElementNode
      const element = elementText.children[0] as ElementNode

      expect(elementMath.ns).toBe(Namespaces.MATH_ML)
      expect(element.ns).toBe(Namespaces.MATH_ML)
    })

    /**
     * 场景：math/mtext 内是普通 test，断言子节点为 HTML，验证非 mglyph/malignmark 子标签退出 MathML。
     */
    test('mtext and not malignmark tag in MATH_ML namespace', () => {
      const ast = parse('<math><mtext><test/></mtext></math>', parserOptions)
      const elementMath = ast.children[0] as ElementNode
      const elementText = elementMath.children[0] as ElementNode
      const element = elementText.children[0] as ElementNode

      expect(elementMath.ns).toBe(Namespaces.MATH_ML)
      expect(element.ns).toBe(Namespaces.HTML)
    })

    /**
     * 场景：svg/foreignObject 内是 test，断言 svg 为 SVG、test 为 HTML，验证 foreignObject 的 HTML 集成点。
     */
    test('foreignObject tag in SVG namespace', () => {
      const ast = parse(
        '<svg><foreignObject><test/></foreignObject></svg>',
        parserOptions,
      )
      const elementSvg = ast.children[0] as ElementNode
      const elementForeignObject = elementSvg.children[0] as ElementNode
      const element = elementForeignObject.children[0] as ElementNode

      expect(elementSvg.ns).toBe(Namespaces.SVG)
      expect(element.ns).toBe(Namespaces.HTML)
    })

    /**
     * 场景：svg/desc 内是 test，断言子节点为 HTML，验证 desc 同样恢复 HTML 子内容。
     */
    test('desc tag in SVG namespace', () => {
      const ast = parse('<svg><desc><test/></desc></svg>', parserOptions)
      const elementSvg = ast.children[0] as ElementNode
      const elementDesc = elementSvg.children[0] as ElementNode
      const element = elementDesc.children[0] as ElementNode

      expect(elementSvg.ns).toBe(Namespaces.SVG)
      expect(element.ns).toBe(Namespaces.HTML)
    })

    /**
     * 场景：svg/title 内是 test，断言子节点为 HTML，验证 title 的 SVG 集成点规则。
     */
    test('title tag in SVG namespace', () => {
      const ast = parse('<svg><title><test/></title></svg>', parserOptions)
      const elementSvg = ast.children[0] as ElementNode
      const elementTitle = elementSvg.children[0] as ElementNode
      const element = elementTitle.children[0] as ElementNode

      expect(elementSvg.ns).toBe(Namespaces.SVG)
      expect(element.ns).toBe(Namespaces.HTML)
    })

    /**
     * 场景：html 根下有 svg，断言父级 HTML、子级 SVG，验证命名空间按层传播而非整树统一。
     */
    test('SVG in HTML namespace', () => {
      const ast = parse('<html><svg></svg></html>', parserOptions)
      const elementHtml = ast.children[0] as ElementNode
      const element = elementHtml.children[0] as ElementNode

      expect(elementHtml.ns).toBe(Namespaces.HTML)
      expect(element.ns).toBe(Namespaces.SVG)
    })

    /**
     * 场景：html 根下有 math，断言父级 HTML、子级 MathML，验证 math 入口在嵌套层同样生效。
     */
    test('MATH in HTML namespace', () => {
      const ast = parse('<html><math></math></html>', parserOptions)
      const elementHtml = ast.children[0] as ElementNode
      const element = elementHtml.children[0] as ElementNode

      expect(elementHtml.ns).toBe(Namespaces.HTML)
      expect(element.ns).toBe(Namespaces.MATH_ML)
    })

    /**
     * 场景：显式 ns=SVG 解析 foreignObject 根及 test 子节点，断言根采用 SVG、子节点切到 HTML，验证调用方根 namespace 与集成点共同作用。
     */
    test('root ns', () => {
      const ast = parse('<foreignObject><test/></foreignObject>', {
        ...parserOptions,
        ns: Namespaces.SVG,
      })
      const elementForieng = ast.children[0] as ElementNode
      const element = elementForieng.children[0] as ElementNode

      expect(elementForieng.ns).toBe(Namespaces.SVG)
      expect(element.ns).toBe(Namespaces.HTML)
    })

    /**
     * 场景：显式 ns=SVG 解析 script 内两个 g，断言均为元素节点，验证 XML 根环境不误套 HTML script 的 RAWTEXT 模式。
     */
    test('correct XML handling with root ns', () => {
      // 根命名空间是 XML 时，script/style/textarea 等不能套用 HTML 特殊内容模式。
      const ast = parse('<script><g/><g/></script>', {
        ...parserOptions,
        ns: Namespaces.SVG,
      })
      const elementSvg = ast.children[0] as ElementNode
      // 其中的标签应继续解析成节点，而不是整段文本。
      expect(elementSvg.children).toMatchObject([
        { type: NodeTypes.ELEMENT, tag: 'g' },
        { type: NodeTypes.ELEMENT, tag: 'g' },
      ])
    })
  })
})
