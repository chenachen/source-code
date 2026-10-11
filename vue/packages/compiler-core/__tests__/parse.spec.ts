/**
 * 基础 parser 场景：覆盖文本、插值、注释、元素/属性/指令、实体、空白压缩、源码位置与
 * HTML 容错边界。测试既核对 AST 形状，也核对错误码和 location，保证 IDE 诊断可定位。
 */
import type { ParserOptions } from '../src/options'
import { ErrorCodes } from '../src/errors'
import {
  type CommentNode,
  ConstantTypes,
  type DirectiveNode,
  type ElementNode,
  ElementTypes,
  type InterpolationNode,
  Namespaces,
  NodeTypes,
  type Position,
  type TextNode,
} from '../src/ast'

import { baseParse } from '../src/parser'
import type { Program } from '@babel/types'

describe('compiler: parse', () => {
  // 文本分组：普通字符、实体、换行与特殊标签内容都应保留正确 content/location。
  describe('Text', () => {
    /**
     * 输入 some text；生成单个 Text，content 与源码相同，loc 为 UTF-16 偏移 0..9、行列 1:1..1:10。
     */
    test('simple text', () => {
      const ast = baseParse('some text')
      const text = ast.children[0] as TextNode

      expect(text).toStrictEqual({
        type: NodeTypes.TEXT,
        content: 'some text',
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 9, line: 1, column: 10 },
          source: 'some text',
        },
      })
    })

    /**
     * 输入普通文本后接无匹配的 </div>，使用 spy 返回型 onError；报告 offset 9 的 X_INVALID_END_TAG，同时完整保留此前 Text。
     */
    test('simple text with invalid end tag', () => {
      const onError = vi.fn()
      const ast = baseParse('some text</div>', { onError })
      const text = ast.children[0] as TextNode

      expect(onError.mock.calls).toMatchObject([
        [
          {
            code: ErrorCodes.X_INVALID_END_TAG,
            loc: {
              start: { column: 10, line: 1, offset: 9 },
              end: { column: 10, line: 1, offset: 9 },
            },
          },
        ],
      ])

      expect(text).toStrictEqual({
        type: NodeTypes.TEXT,
        content: 'some text',
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 9, line: 1, column: 10 },
          source: 'some text',
        },
      })
    })

    /**
     * 输入 some、foo+bar 插值、text 三段；分别核对插值前后 Text 的 content 与互不重叠的源码范围。
     */
    test('text with interpolation', () => {
      const ast = baseParse('some {{ foo + bar }} text')
      const text1 = ast.children[0] as TextNode
      const text2 = ast.children[2] as TextNode

      expect(text1).toStrictEqual({
        type: NodeTypes.TEXT,
        content: 'some ',
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 5, line: 1, column: 6 },
          source: 'some ',
        },
      })
      expect(text2).toStrictEqual({
        type: NodeTypes.TEXT,
        content: ' text',
        loc: {
          start: { offset: 20, line: 1, column: 21 },
          end: { offset: 25, line: 1, column: 26 },
          source: ' text',
        },
      })
    })

    /**
     * 插值正文含 a<b && c>d；小于号/大于号由 Interpolation 状态消费，不切成标签，前后 Text 范围仍精确。
     */
    test('text with interpolation which has `<`', () => {
      const ast = baseParse('some {{ a<b && c>d }} text')
      const text1 = ast.children[0] as TextNode
      const text2 = ast.children[2] as TextNode

      expect(text1).toStrictEqual({
        type: NodeTypes.TEXT,
        content: 'some ',
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 5, line: 1, column: 6 },
          source: 'some ',
        },
      })
      expect(text2).toStrictEqual({
        type: NodeTypes.TEXT,
        content: ' text',
        loc: {
          start: { offset: 21, line: 1, column: 22 },
          end: { offset: 26, line: 1, column: 27 },
          source: ' text',
        },
      })
    })

    /**
     * 根文本后有 span，内部为比较表达式插值加尾文本；核对根 Text 和 span 内 Text 的内容/范围，验证标签与插值状态切换。
     */
    test('text with mix of tags and interpolations', () => {
      const ast = baseParse('some <span>{{ foo < bar + foo }} text</span>')
      const text1 = ast.children[0] as TextNode
      const text2 = (ast.children[1] as ElementNode).children![1] as TextNode

      expect(text1).toStrictEqual({
        type: NodeTypes.TEXT,
        content: 'some ',
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 5, line: 1, column: 6 },
          source: 'some ',
        },
      })
      expect(text2).toStrictEqual({
        type: NodeTypes.TEXT,
        content: ' text',
        loc: {
          start: { offset: 32, line: 1, column: 33 },
          end: { offset: 37, line: 1, column: 38 },
          source: ' text',
        },
      })
    })

    /**
     * 输入 a < b 并只容忍指定标签名错误；断言最终仍合并成完整单个 Text，不在孤立 < 处分裂；用例没有断言一定触发该错误。
     */
    test('lonely "<" doesn\'t separate nodes', () => {
      const ast = baseParse('a < b', {
        onError: err => {
          if (err.code !== ErrorCodes.INVALID_FIRST_CHARACTER_OF_TAG_NAME) {
            throw err
          }
        },
      })
      const text = ast.children[0] as TextNode

      expect(text).toStrictEqual({
        type: NodeTypes.TEXT,
        content: 'a < b',
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 5, line: 1, column: 6 },
          source: 'a < b',
        },
      })
    })

    /**
     * 输入未闭合 a {{ b，回调只接受 X_MISSING_INTERPOLATION_END；EOF 恢复尾部文本，并与前段合成完整 Text。
     */
    test('lonely "{{" doesn\'t separate nodes', () => {
      const ast = baseParse('a {{ b', {
        onError: error => {
          if (error.code !== ErrorCodes.X_MISSING_INTERPOLATION_END) {
            throw error
          }
        },
      })
      const text = ast.children[0] as TextNode

      expect(text).toStrictEqual({
        type: NodeTypes.TEXT,
        content: 'a {{ b',
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 6, line: 1, column: 7 },
          source: 'a {{ b',
        },
      })
    })
  })

  // 插值分组：验证默认/自定义定界符、空白裁剪、实体与缺失结束符。
  describe('Interpolation', () => {
    /**
     * 输入 {{message}}；完整核对 Interpolation、非静态简单表达式和默认 NOT_CONSTANT，并区分外层含定界符与内层 message 的 loc。
     */
    test('simple interpolation', () => {
      const ast = baseParse('{{message}}')
      const interpolation = ast.children[0] as InterpolationNode

      expect(interpolation).toStrictEqual({
        type: NodeTypes.INTERPOLATION,
        content: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: `message`,
          isStatic: false,
          constType: ConstantTypes.NOT_CONSTANT,
          loc: {
            start: { offset: 2, line: 1, column: 3 },
            end: { offset: 9, line: 1, column: 10 },
            source: 'message',
          },
        },
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 11, line: 1, column: 12 },
          source: '{{message}}',
        },
      })
    })

    /**
     * 输入 {{ a<b }}；内层裁剪空白后为 a<b，外层保留定界符，比较运算符不启动标签解析。
     */
    test('it can have tag-like notation', () => {
      const ast = baseParse('{{ a<b }}')
      const interpolation = ast.children[0] as InterpolationNode

      expect(interpolation).toStrictEqual({
        type: NodeTypes.INTERPOLATION,
        content: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: `a<b`,
          isStatic: false,
          constType: ConstantTypes.NOT_CONSTANT,
          loc: {
            start: { offset: 3, line: 1, column: 4 },
            end: { offset: 6, line: 1, column: 7 },
            source: 'a<b',
          },
        },
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 9, line: 1, column: 10 },
          source: '{{ a<b }}',
        },
      })
    })

    /**
     * 连续输入 {{ a<b }}{{ c>d }}；生成两个独立插值节点，逐个核对表达式内容和相邻源码边界。
     */
    test('it can have tag-like notation (2)', () => {
      const ast = baseParse('{{ a<b }}{{ c>d }}')
      const interpolation1 = ast.children[0] as InterpolationNode
      const interpolation2 = ast.children[1] as InterpolationNode

      expect(interpolation1).toStrictEqual({
        type: NodeTypes.INTERPOLATION,
        content: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: `a<b`,
          isStatic: false,
          constType: ConstantTypes.NOT_CONSTANT,
          loc: {
            start: { offset: 3, line: 1, column: 4 },
            end: { offset: 6, line: 1, column: 7 },
            source: 'a<b',
          },
        },
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 9, line: 1, column: 10 },
          source: '{{ a<b }}',
        },
      })

      expect(interpolation2).toStrictEqual({
        type: NodeTypes.INTERPOLATION,
        content: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          isStatic: false,
          constType: ConstantTypes.NOT_CONSTANT,
          content: 'c>d',
          loc: {
            start: { offset: 12, line: 1, column: 13 },
            end: { offset: 15, line: 1, column: 16 },
            source: 'c>d',
          },
        },
        loc: {
          start: { offset: 9, line: 1, column: 10 },
          end: { offset: 18, line: 1, column: 19 },
          source: '{{ c>d }}',
        },
      })
    })

    /**
     * 在 div 插值里写字符串 "</div>"；该字符串不关闭元素，插值内容及 loc 保留原表达式，parser 不据字面量自动提升常量等级。
     */
    test('it can have tag-like notation (3)', () => {
      const ast = baseParse('<div>{{ "</div>" }}</div>')
      const element = ast.children[0] as ElementNode
      const interpolation = element.children[0] as InterpolationNode

      expect(interpolation).toStrictEqual({
        type: NodeTypes.INTERPOLATION,
        content: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          isStatic: false,
          // parser 只写入默认 constType，真实静态级别由 transformExpression 决定。
          constType: ConstantTypes.NOT_CONSTANT,
          content: '"</div>"',
          loc: {
            start: { offset: 8, line: 1, column: 9 },
            end: { offset: 16, line: 1, column: 17 },
            source: '"</div>"',
          },
        },
        loc: {
          start: { offset: 5, line: 1, column: 6 },
          end: { offset: 19, line: 1, column: 20 },
          source: '{{ "</div>" }}',
        },
      })
    })

    /**
     * 设置单字符 { / } 定界符解析 p 中的 {msg}；核对外插值与内表达式位置，验证按配置识别不同长度定界符。
     */
    test('custom delimiters', () => {
      const ast = baseParse('<p>{msg}</p>', {
        delimiters: ['{', '}'],
      })
      const element = ast.children[0] as ElementNode
      const interpolation = element.children[0] as InterpolationNode

      expect(interpolation).toStrictEqual({
        type: NodeTypes.INTERPOLATION,
        content: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: `msg`,
          isStatic: false,
          constType: ConstantTypes.NOT_CONSTANT,
          loc: {
            start: { offset: 4, line: 1, column: 5 },
            end: { offset: 7, line: 1, column: 8 },
            source: 'msg',
          },
        },
        loc: {
          start: { offset: 3, line: 1, column: 4 },
          end: { offset: 8, line: 1, column: 9 },
          source: '{msg}',
        },
      })
    })
  })

  // 注释分组：覆盖合法、错误开启/闭合、嵌套、EOF 和是否保留注释选项。
  describe('Comment', () => {
    /**
     * 输入 <!---->；生成 content 为空的 Comment，loc 包含整个注释定界符。
     */
    test('empty comment', () => {
      const ast = baseParse('<!---->')
      const comment = ast.children[0] as CommentNode

      expect(comment).toStrictEqual({
        type: NodeTypes.COMMENT,
        content: '',
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 7, line: 1, column: 8 },
          source: '<!---->',
        },
      })
    })

    /**
     * 输入 <!--abc-->；Comment.content 只含 abc，loc.source 保留完整注释。
     */
    test('simple comment', () => {
      const ast = baseParse('<!--abc-->')
      const comment = ast.children[0] as CommentNode

      expect(comment).toStrictEqual({
        type: NodeTypes.COMMENT,
        content: 'abc',
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 10, line: 1, column: 11 },
          source: '<!--abc-->',
        },
      })
    })

    /**
     * 连续两个 abc/def 注释各生成独立 Comment，并分别核对 0..10 与 10..20 源码范围。
     */
    test('two comments', () => {
      const ast = baseParse('<!--abc--><!--def-->')
      const comment1 = ast.children[0] as CommentNode
      const comment2 = ast.children[1] as CommentNode

      expect(comment1).toStrictEqual({
        type: NodeTypes.COMMENT,
        content: 'abc',
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 10, line: 1, column: 11 },
          source: '<!--abc-->',
        },
      })
      expect(comment2).toStrictEqual({
        type: NodeTypes.COMMENT,
        content: 'def',
        loc: {
          start: { offset: 10, line: 1, column: 11 },
          end: { offset: 20, line: 1, column: 21 },
          source: '<!--def-->',
        },
      })
    })

    /**
     * 同一 abc 注释分别传 comments:false/true；children 数量分别为 0/1，验证保留开关。
     */
    test('comments option', () => {
      const astOptionNoComment = baseParse('<!--abc-->', { comments: false })
      const astOptionWithComments = baseParse('<!--abc-->', { comments: true })

      expect(astOptionNoComment.children).toHaveLength(0)
      expect(astOptionWithComments.children).toHaveLength(1)
    })

    // #2217：关闭 comments 选项时，`<pre>` 内的注释也必须删除，不能因保留空白规则漏过。
    /**
     * pre 内 p、注释、p 以 comments:true/false 分别解析；前者三节点、后者两元素，证明注释开关不受标签名影响；此处未传 isPreTag。
     */
    test('comments in the <pre> tag should be removed when comments option requires it', () => {
      const rawText = `<p/><!-- foo --><p/>`

      const astWithComments = baseParse(`<pre>${rawText}</pre>`, {
        comments: true,
      })
      expect(
        (astWithComments.children[0] as ElementNode).children,
      ).toMatchObject([
        {
          type: NodeTypes.ELEMENT,
          tag: 'p',
        },
        {
          type: NodeTypes.COMMENT,
        },
        {
          type: NodeTypes.ELEMENT,
          tag: 'p',
        },
      ])

      const astWithoutComments = baseParse(`<pre>${rawText}</pre>`, {
        comments: false,
      })
      expect(
        (astWithoutComments.children[0] as ElementNode).children,
      ).toMatchObject([
        {
          type: NodeTypes.ELEMENT,
          tag: 'p',
        },
        {
          type: NodeTypes.ELEMENT,
          tag: 'p',
        },
      ])
    })
  })

  // 元素分组：覆盖标签栈、自闭合、属性/指令 tokenizer 事件及特殊内容模式。
  describe('Element', () => {
    /**
     * 输入 <div>hello</div>；严格核对 HTML Element、未生成 codegenNode、hello Text 及父子完整 loc。
     */
    test('simple div', () => {
      const ast = baseParse('<div>hello</div>')
      const element = ast.children[0] as ElementNode

      expect(element).toStrictEqual({
        type: NodeTypes.ELEMENT,
        ns: Namespaces.HTML,
        tag: 'div',
        tagType: ElementTypes.ELEMENT,
        codegenNode: undefined,
        props: [],
        children: [
          {
            type: NodeTypes.TEXT,
            content: 'hello',
            loc: {
              start: { offset: 5, line: 1, column: 6 },
              end: { offset: 10, line: 1, column: 11 },
              source: 'hello',
            },
          },
        ],
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 16, line: 1, column: 17 },
          source: '<div>hello</div>',
        },
      })
    })

    /**
     * 空的显式开闭 div 产生 children/props 空数组，loc 覆盖两标签，验证关闭时补齐范围。
     */
    test('empty', () => {
      const ast = baseParse('<div></div>')
      const element = ast.children[0] as ElementNode

      expect(element).toStrictEqual({
        type: NodeTypes.ELEMENT,
        ns: Namespaces.HTML,
        tag: 'div',
        tagType: ElementTypes.ELEMENT,
        codegenNode: undefined,
        props: [],
        children: [],
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 11, line: 1, column: 12 },
          source: '<div></div>',
        },
      })
    })

    /**
     * 输入 <div/>after；核对首元素 isSelfClosing:true、无 children、loc 仅覆盖 <div/>，不把尾文本收进自闭合元素。
     */
    test('self closing', () => {
      const ast = baseParse('<div/>after')
      const element = ast.children[0] as ElementNode

      expect(element).toStrictEqual({
        type: NodeTypes.ELEMENT,
        ns: Namespaces.HTML,
        tag: 'div',
        tagType: ElementTypes.ELEMENT,
        codegenNode: undefined,
        props: [],
        children: [],
        isSelfClosing: true,
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 6, line: 1, column: 7 },
          source: '<div/>',
        },
      })
    })

    /**
     * 用 isVoidTag 将 img 判为空元素；<img>after 的 img 无需结束标签，loc 止于开标签 >。
     */
    test('void element', () => {
      const ast = baseParse('<img>after', {
        isVoidTag: tag => tag === 'img',
      })
      const element = ast.children[0] as ElementNode

      expect(element).toStrictEqual({
        type: NodeTypes.ELEMENT,
        ns: Namespaces.HTML,
        tag: 'img',
        tagType: ElementTypes.ELEMENT,
        codegenNode: undefined,
        props: [],
        children: [],
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 5, line: 1, column: 6 },
          source: '<img>',
        },
      })
    })

    /**
     * 同一 void img 使用 />；除了正常空元素范围外，还保留 isSelfClosing:true。
     */
    test('self-closing void element', () => {
      const ast = baseParse('<img/>after', {
        isVoidTag: tag => tag === 'img',
      })
      const element = ast.children[0] as ElementNode

      expect(element).toStrictEqual({
        type: NodeTypes.ELEMENT,
        ns: Namespaces.HTML,
        tag: 'img',
        tagType: ElementTypes.ELEMENT,
        codegenNode: undefined,
        props: [],
        children: [],
        isSelfClosing: true,
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 6, line: 1, column: 7 },
          source: '<img/>',
        },
      })
    })

    /**
     * 带 v-if 的 template 在闭合分类为 ElementTypes.TEMPLATE，留给结构转换处理。
     */
    test('template element with directives', () => {
      const ast = baseParse('<template v-if="ok"></template>')
      const element = ast.children[0]
      expect(element).toMatchObject({
        type: NodeTypes.ELEMENT,
        tagType: ElementTypes.TEMPLATE,
      })
    })

    /**
     * 没有特殊指令的空 template 分类为普通 ELEMENT，不自动成为透明结构容器。
     */
    test('template element without directives', () => {
      const ast = baseParse('<template></template>')
      const element = ast.children[0]
      expect(element).toMatchObject({
        type: NodeTypes.ELEMENT,
        tagType: ElementTypes.ELEMENT,
      })
    })

    /**
     * 只把 div 列为 isNativeTag；div 为原生、comp 和 Comp 均为组件，核对平台标签表与首字母大写规则。
     */
    test('native element with `isNativeTag`', () => {
      const ast = baseParse('<div></div><comp></comp><Comp></Comp>', {
        isNativeTag: tag => tag === 'div',
      })

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
     * 不提供 isNativeTag 时 div/comp 为普通元素，Comp 由 ASCII 大写首字母规则分类为组件。
     */
    test('native element without `isNativeTag`', () => {
      const ast = baseParse('<div></div><comp></comp><Comp></Comp>')

      expect(ast.children[0]).toMatchObject({
        type: NodeTypes.ELEMENT,
        tag: 'div',
        tagType: ElementTypes.ELEMENT,
      })

      expect(ast.children[1]).toMatchObject({
        type: NodeTypes.ELEMENT,
        tag: 'comp',
        tagType: ElementTypes.ELEMENT,
      })

      expect(ast.children[2]).toMatchObject({
        type: NodeTypes.ELEMENT,
        tag: 'Comp',
        tagType: ElementTypes.COMPONENT,
      })
    })

    /**
     * 有 isNativeTag 时 div 上 is="vue:foo" 仍将第二个 div 分类为组件，普通 div 保持原生，Comp 仍为组件。
     */
    test('is casting with `isNativeTag`', () => {
      const ast = baseParse(
        `<div></div><div is="vue:foo"></div><Comp></Comp>`,
        {
          isNativeTag: tag => tag === 'div',
        },
      )

      expect(ast.children[0]).toMatchObject({
        type: NodeTypes.ELEMENT,
        tag: 'div',
        tagType: ElementTypes.ELEMENT,
      })

      expect(ast.children[1]).toMatchObject({
        type: NodeTypes.ELEMENT,
        tag: 'div',
        tagType: ElementTypes.COMPONENT,
      })

      expect(ast.children[2]).toMatchObject({
        type: NodeTypes.ELEMENT,
        tag: 'Comp',
        tagType: ElementTypes.COMPONENT,
      })
    })

    /**
     * 不提供 isNativeTag 也能由 is="vue:foo" 识别组件转换；核对三个节点的最终 tagType。
     */
    test('is casting without `isNativeTag`', () => {
      const ast = baseParse(`<div></div><div is="vue:foo"></div><Comp></Comp>`)

      expect(ast.children[0]).toMatchObject({
        type: NodeTypes.ELEMENT,
        tag: 'div',
        tagType: ElementTypes.ELEMENT,
      })

      expect(ast.children[1]).toMatchObject({
        type: NodeTypes.ELEMENT,
        tag: 'div',
        tagType: ElementTypes.COMPONENT,
      })

      expect(ast.children[2]).toMatchObject({
        type: NodeTypes.ELEMENT,
        tag: 'Comp',
        tagType: ElementTypes.COMPONENT,
      })
    })

    /**
     * 同时提供 native 表与 isCustomElement(comp)；custom 判定优先，comp 保持原生 ELEMENT。
     */
    test('custom element', () => {
      const ast = baseParse('<div></div><comp></comp>', {
        isNativeTag: tag => tag === 'div',
        isCustomElement: tag => tag === 'comp',
      })

      expect(ast.children[0]).toMatchObject({
        type: NodeTypes.ELEMENT,
        tag: 'div',
        tagType: ElementTypes.ELEMENT,
      })

      expect(ast.children[1]).toMatchObject({
        type: NodeTypes.ELEMENT,
        tag: 'comp',
        tagType: ElementTypes.ELEMENT,
      })
    })

    /**
     * isBuiltInComponent 对 comp 返回 Symbol；即使标签小写也分类为组件，普通 div 不变。
     */
    test('built-in component', () => {
      const ast = baseParse('<div></div><comp></comp>', {
        isBuiltInComponent: tag => (tag === 'comp' ? Symbol() : void 0),
      })

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
    })

    /**
     * slot 被优先分类为 SLOT 出口，邻接的 Comp 分类为 COMPONENT，二者语义不混用。
     */
    test('slot element', () => {
      const ast = baseParse('<slot></slot><Comp></Comp>')

      expect(ast.children[0]).toMatchObject({
        type: NodeTypes.ELEMENT,
        tag: 'slot',
        tagType: ElementTypes.SLOT,
      })

      expect(ast.children[1]).toMatchObject({
        type: NodeTypes.ELEMENT,
        tag: 'Comp',
        tagType: ElementTypes.COMPONENT,
      })
    })

    /**
     * 无值 id 属性保留 value:undefined，nameLoc 与整体属性 loc 相同；与显式空字符串不同。
     */
    test('attribute with no value', () => {
      const ast = baseParse('<div id></div>')
      const element = ast.children[0] as ElementNode

      expect(element).toStrictEqual({
        type: NodeTypes.ELEMENT,
        ns: Namespaces.HTML,
        tag: 'div',
        tagType: ElementTypes.ELEMENT,
        codegenNode: undefined,
        props: [
          {
            type: NodeTypes.ATTRIBUTE,
            name: 'id',
            nameLoc: {
              start: { offset: 5, line: 1, column: 6 },
              end: { offset: 7, line: 1, column: 8 },
              source: 'id',
            },
            value: undefined,
            loc: {
              start: { offset: 5, line: 1, column: 6 },
              end: { offset: 7, line: 1, column: 8 },
              source: 'id',
            },
          },
        ],

        children: [],
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 14, line: 1, column: 15 },
          source: '<div id></div>',
        },
      })
    })

    /**
     * 双引号空值 id="" 生成 Text 空字符串，value.loc 含两引号，属性 loc 同时含名称与等号。
     */
    test('attribute with empty value, double quote', () => {
      const ast = baseParse('<div id=""></div>')
      const element = ast.children[0] as ElementNode

      expect(element).toStrictEqual({
        type: NodeTypes.ELEMENT,
        ns: Namespaces.HTML,
        tag: 'div',
        tagType: ElementTypes.ELEMENT,
        codegenNode: undefined,
        props: [
          {
            type: NodeTypes.ATTRIBUTE,
            name: 'id',
            nameLoc: {
              start: { offset: 5, line: 1, column: 6 },
              end: { offset: 7, line: 1, column: 8 },
              source: 'id',
            },
            value: {
              type: NodeTypes.TEXT,
              content: '',
              loc: {
                start: { offset: 8, line: 1, column: 9 },
                end: { offset: 10, line: 1, column: 11 },
                source: '""',
              },
            },
            loc: {
              start: { offset: 5, line: 1, column: 6 },
              end: { offset: 10, line: 1, column: 11 },
              source: 'id=""',
            },
          },
        ],

        children: [],
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 17, line: 1, column: 18 },
          source: '<div id=""></div>',
        },
      })
    })

    /**
     * 单引号空值 id='' 同样生成 Text 空字符串，逐项核对 name/value/整体范围。
     */
    test('attribute with empty value, single quote', () => {
      const ast = baseParse("<div id=''></div>")
      const element = ast.children[0] as ElementNode

      expect(element).toStrictEqual({
        type: NodeTypes.ELEMENT,
        ns: Namespaces.HTML,
        tag: 'div',
        tagType: ElementTypes.ELEMENT,
        codegenNode: undefined,
        props: [
          {
            type: NodeTypes.ATTRIBUTE,
            name: 'id',
            nameLoc: {
              start: { offset: 5, line: 1, column: 6 },
              end: { offset: 7, line: 1, column: 8 },
              source: 'id',
            },
            value: {
              type: NodeTypes.TEXT,
              content: '',
              loc: {
                start: { offset: 8, line: 1, column: 9 },
                end: { offset: 10, line: 1, column: 11 },
                source: "''",
              },
            },
            loc: {
              start: { offset: 5, line: 1, column: 6 },
              end: { offset: 10, line: 1, column: 11 },
              source: "id=''",
            },
          },
        ],

        children: [],
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 17, line: 1, column: 18 },
          source: "<div id=''></div>",
        },
      })
    })

    /**
     * 双引号属性值包含 > 与单引号；二者都只是值内容，只有匹配双引号结束属性，核对 value.content 和含引号 loc。
     */
    test('attribute with value, double quote', () => {
      const ast = baseParse('<div id=">\'"></div>')
      const element = ast.children[0] as ElementNode

      expect(element).toStrictEqual({
        type: NodeTypes.ELEMENT,
        ns: Namespaces.HTML,
        tag: 'div',
        tagType: ElementTypes.ELEMENT,
        codegenNode: undefined,
        props: [
          {
            type: NodeTypes.ATTRIBUTE,
            name: 'id',
            nameLoc: {
              start: { offset: 5, line: 1, column: 6 },
              end: { offset: 7, line: 1, column: 8 },
              source: 'id',
            },
            value: {
              type: NodeTypes.TEXT,
              content: ">'",
              loc: {
                start: { offset: 8, line: 1, column: 9 },
                end: { offset: 12, line: 1, column: 13 },
                source: '">\'"',
              },
            },
            loc: {
              start: { offset: 5, line: 1, column: 6 },
              end: { offset: 12, line: 1, column: 13 },
              source: 'id=">\'"',
            },
          },
        ],

        children: [],
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 19, line: 1, column: 20 },
          source: '<div id=">\'"></div>',
        },
      })
    })

    /**
     * 单引号属性值包含 > 与双引号；二者不结束标签，只有匹配单引号完成值。
     */
    test('attribute with value, single quote', () => {
      const ast = baseParse("<div id='>\"'></div>")
      const element = ast.children[0] as ElementNode

      expect(element).toStrictEqual({
        type: NodeTypes.ELEMENT,
        ns: Namespaces.HTML,
        tag: 'div',
        tagType: ElementTypes.ELEMENT,
        codegenNode: undefined,
        props: [
          {
            type: NodeTypes.ATTRIBUTE,
            name: 'id',
            nameLoc: {
              start: { offset: 5, line: 1, column: 6 },
              end: { offset: 7, line: 1, column: 8 },
              source: 'id',
            },
            value: {
              type: NodeTypes.TEXT,
              content: '>"',
              loc: {
                start: { offset: 8, line: 1, column: 9 },
                end: { offset: 12, line: 1, column: 13 },
                source: "'>\"'",
              },
            },
            loc: {
              start: { offset: 5, line: 1, column: 6 },
              end: { offset: 12, line: 1, column: 13 },
              source: "id='>\"'",
            },
          },
        ],

        children: [],
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 19, line: 1, column: 20 },
          source: "<div id='>\"'></div>",
        },
      })
    })

    /**
     * 无引号 id=a/ 的斜杠是值的一部分而非自闭合符；元素仍用 </div> 关闭，value.content 为 a/。
     */
    test('attribute with value, unquoted', () => {
      const ast = baseParse('<div id=a/></div>')
      const element = ast.children[0] as ElementNode

      expect(element).toStrictEqual({
        type: NodeTypes.ELEMENT,
        ns: Namespaces.HTML,
        tag: 'div',
        tagType: ElementTypes.ELEMENT,
        codegenNode: undefined,
        props: [
          {
            type: NodeTypes.ATTRIBUTE,
            name: 'id',
            nameLoc: {
              start: { offset: 5, line: 1, column: 6 },
              end: { offset: 7, line: 1, column: 8 },
              source: 'id',
            },
            value: {
              type: NodeTypes.TEXT,
              content: 'a/',
              loc: {
                start: { offset: 8, line: 1, column: 9 },
                end: { offset: 10, line: 1, column: 11 },
                source: 'a/',
              },
            },
            loc: {
              start: { offset: 5, line: 1, column: 6 },
              end: { offset: 10, line: 1, column: 11 },
              source: 'id=a/',
            },
          },
        ],

        children: [],
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 17, line: 1, column: 18 },
          source: '<div id=a/></div>',
        },
      })
    })

    /**
     * SFC 模式 script 的 generic 值含 Record<string,string>；引号内 > 不提前结束开标签，逐个核对 setup/lang/generic 与空 innerLoc。
     */
    test('attribute value with >', () => {
      const ast = baseParse(
        '<script setup lang="ts" generic="T extends Record<string,string>"></script>',
        { parseMode: 'sfc' },
      )
      const element = ast.children[0] as ElementNode
      expect(element).toMatchObject({
        type: NodeTypes.ELEMENT,
        ns: Namespaces.HTML,
        tag: 'script',
        tagType: ElementTypes.ELEMENT,
        codegenNode: undefined,
        children: [],
        innerLoc: {
          start: { column: 67, line: 1, offset: 66 },
          end: { column: 67, line: 1, offset: 66 },
        },
        props: [
          {
            loc: {
              source: 'setup',
              end: { column: 14, line: 1, offset: 13 },
              start: { column: 9, line: 1, offset: 8 },
            },
            name: 'setup',
            nameLoc: {
              source: 'setup',
              end: { column: 14, line: 1, offset: 13 },
              start: { column: 9, line: 1, offset: 8 },
            },
            type: NodeTypes.ATTRIBUTE,
            value: undefined,
          },
          {
            loc: {
              source: 'lang="ts"',
              end: { column: 24, line: 1, offset: 23 },
              start: { column: 15, line: 1, offset: 14 },
            },
            name: 'lang',
            nameLoc: {
              source: 'lang',
              end: { column: 19, line: 1, offset: 18 },
              start: { column: 15, line: 1, offset: 14 },
            },
            type: NodeTypes.ATTRIBUTE,
            value: {
              content: 'ts',
              loc: {
                source: '"ts"',
                end: { column: 24, line: 1, offset: 23 },
                start: { column: 20, line: 1, offset: 19 },
              },
              type: NodeTypes.TEXT,
            },
          },
          {
            loc: {
              source: 'generic="T extends Record<string,string>"',
              end: { column: 66, line: 1, offset: 65 },
              start: { column: 25, line: 1, offset: 24 },
            },
            name: 'generic',
            nameLoc: {
              source: 'generic',
              end: { column: 32, line: 1, offset: 31 },
              start: { column: 25, line: 1, offset: 24 },
            },
            type: NodeTypes.ATTRIBUTE,
            value: {
              content: 'T extends Record<string,string>',
              loc: {
                source: '"T extends Record<string,string>"',
                end: { column: 66, line: 1, offset: 65 },
                start: { column: 33, line: 1, offset: 32 },
              },
              type: NodeTypes.TEXT,
            },
          },
        ],
      })
    })

    /**
     * 同一 div 顺序输入无引号 id、带引号 class、无值 inert、单引号空 style；逐项核对四种属性形态及各自源码范围。
     */
    test('multiple attributes', () => {
      const ast = baseParse('<div id=a class="c" inert style=\'\'></div>')
      const element = ast.children[0] as ElementNode

      expect(element).toStrictEqual({
        type: NodeTypes.ELEMENT,
        ns: Namespaces.HTML,
        tag: 'div',
        tagType: ElementTypes.ELEMENT,
        codegenNode: undefined,
        props: [
          {
            type: NodeTypes.ATTRIBUTE,
            name: 'id',
            nameLoc: {
              start: { offset: 5, line: 1, column: 6 },
              end: { offset: 7, line: 1, column: 8 },
              source: 'id',
            },
            value: {
              type: NodeTypes.TEXT,
              content: 'a',
              loc: {
                start: { offset: 8, line: 1, column: 9 },
                end: { offset: 9, line: 1, column: 10 },
                source: 'a',
              },
            },
            loc: {
              start: { offset: 5, line: 1, column: 6 },
              end: { offset: 9, line: 1, column: 10 },
              source: 'id=a',
            },
          },
          {
            type: NodeTypes.ATTRIBUTE,
            name: 'class',
            nameLoc: {
              start: { offset: 10, line: 1, column: 11 },
              end: { offset: 15, line: 1, column: 16 },
              source: 'class',
            },
            value: {
              type: NodeTypes.TEXT,
              content: 'c',
              loc: {
                start: { offset: 16, line: 1, column: 17 },
                end: { offset: 19, line: 1, column: 20 },
                source: '"c"',
              },
            },
            loc: {
              start: { offset: 10, line: 1, column: 11 },
              end: { offset: 19, line: 1, column: 20 },
              source: 'class="c"',
            },
          },
          {
            type: NodeTypes.ATTRIBUTE,
            name: 'inert',
            nameLoc: {
              start: { offset: 20, line: 1, column: 21 },
              end: { offset: 25, line: 1, column: 26 },
              source: 'inert',
            },
            value: undefined,
            loc: {
              start: { offset: 20, line: 1, column: 21 },
              end: { offset: 25, line: 1, column: 26 },
              source: 'inert',
            },
          },
          {
            type: NodeTypes.ATTRIBUTE,
            name: 'style',
            nameLoc: {
              start: { offset: 26, line: 1, column: 27 },
              end: { offset: 31, line: 1, column: 32 },
              source: 'style',
            },
            value: {
              type: NodeTypes.TEXT,
              content: '',
              loc: {
                start: { offset: 32, line: 1, column: 33 },
                end: { offset: 34, line: 1, column: 35 },
                source: "''",
              },
            },
            loc: {
              start: { offset: 26, line: 1, column: 27 },
              end: { offset: 34, line: 1, column: 35 },
              source: "style=''",
            },
          },
        ],

        children: [],
        loc: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 41, line: 1, column: 42 },
          source: '<div id=a class="c" inert style=\'\'></div>',
        },
      })
    })

    // https://github.com/vuejs/core/issues/4251
    /**
     * class 值包含空格、LF、Tab；content 归一化为 c，但 value/属性 loc.source 保留原始空白，元素终点仍在第三行。
     */
    test('class attribute should ignore whitespace when parsed', () => {
      const ast = baseParse('<div class=" \n\t c \t\n "></div>')
      const element = ast.children[0] as ElementNode

      expect(element).toStrictEqual({
        children: [],
        codegenNode: undefined,
        loc: {
          start: { column: 1, line: 1, offset: 0 },
          end: { column: 10, line: 3, offset: 29 },
          source: '<div class=" \n\t c \t\n "></div>',
        },
        ns: Namespaces.HTML,
        props: [
          {
            name: 'class',
            nameLoc: {
              start: { column: 6, line: 1, offset: 5 },
              end: { column: 11, line: 1, offset: 10 },
              source: 'class',
            },
            type: NodeTypes.ATTRIBUTE,
            value: {
              content: 'c',
              loc: {
                start: { column: 12, line: 1, offset: 11 },
                end: { column: 3, line: 3, offset: 22 },
                source: '" \n\t c \t\n "',
              },
              type: NodeTypes.TEXT,
            },
            loc: {
              start: { column: 6, line: 1, offset: 5 },
              end: { column: 3, line: 3, offset: 22 },
              source: 'class=" \n\t c \t\n "',
            },
          },
        ],
        tag: 'div',
        tagType: ElementTypes.ELEMENT,
        type: NodeTypes.ELEMENT,
      })
    })

    /**
     * 无值 v-if 保留规范名 if/rawName:v-if，exp/arg undefined 与空 modifiers；缺少条件的语义错误留给转换阶段。
     */
    test('directive with no value', () => {
      const ast = baseParse('<div v-if/>')
      const directive = (ast.children[0] as ElementNode).props[0]

      expect(directive).toStrictEqual({
        type: NodeTypes.DIRECTIVE,
        name: 'if',
        rawName: 'v-if',
        arg: undefined,
        modifiers: [],
        exp: undefined,
        loc: {
          start: { offset: 5, line: 1, column: 6 },
          end: { offset: 9, line: 1, column: 10 },
          source: 'v-if',
        },
      })
    })

    /**
     * v-if="a" 生成非静态表达式 a，表达式 loc 不含引号，指令 loc 包含名称、等号和值。
     */
    test('directive with value', () => {
      const ast = baseParse('<div v-if="a"/>')
      const directive = (ast.children[0] as ElementNode).props[0]

      expect(directive).toStrictEqual({
        type: NodeTypes.DIRECTIVE,
        name: 'if',
        rawName: 'v-if',
        arg: undefined,
        modifiers: [],
        exp: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: 'a',
          isStatic: false,
          constType: ConstantTypes.NOT_CONSTANT,
          loc: {
            start: { offset: 11, line: 1, column: 12 },
            end: { offset: 12, line: 1, column: 13 },
            source: 'a',
          },
        },
        loc: {
          start: { offset: 5, line: 1, column: 6 },
          end: { offset: 13, line: 1, column: 14 },
          source: 'v-if="a"',
        },
      })
    })

    /**
     * v-on:click 无值时 arg 是静态 CAN_STRINGIFY 的 click，exp 未定义，rawName 保留完整原写法。
     */
    test('directive with argument', () => {
      const ast = baseParse('<div v-on:click/>')
      const directive = (ast.children[0] as ElementNode).props[0]

      expect(directive).toStrictEqual({
        type: NodeTypes.DIRECTIVE,
        name: 'on',
        rawName: 'v-on:click',
        arg: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: 'click',
          isStatic: true,
          constType: ConstantTypes.CAN_STRINGIFY,
          loc: {
            start: { column: 11, line: 1, offset: 10 },
            end: { column: 16, line: 1, offset: 15 },
            source: 'click',
          },
        },
        modifiers: [],
        exp: undefined,
        loc: {
          start: { offset: 5, line: 1, column: 6 },
          end: { offset: 15, line: 1, column: 16 },
          source: 'v-on:click',
        },
      })
    })

    // #3494：`v-slot:slot` 在参数结束处不能多吞字符或把合法静态参数误报为缺失 `]`。
    /**
     * v-slot:slot 后以空白终止参数，loc 精确止于 slot 末尾，避免多吞终止字符。
     */
    test('directive argument edge case', () => {
      const ast = baseParse('<div v-slot:slot />')
      const directive = (ast.children[0] as ElementNode)
        .props[0] as DirectiveNode
      expect(directive.arg).toMatchObject({
        loc: {
          start: { offset: 12, line: 1, column: 13 },
          end: { offset: 16, line: 1, column: 17 },
        },
      })
    })

    // https://github.com/vuejs/language-tools/issues/2710
    /**
     * #item.item 的点号属于 slot 名；arg.content 为 item.item，loc 覆盖完整点号名称。
     */
    test('directive argument edge case (2)', () => {
      const ast = baseParse('<div #item.item />')
      const directive = (ast.children[0] as ElementNode)
        .props[0] as DirectiveNode
      expect(directive.arg).toMatchObject({
        content: 'item.item',
        loc: {
          start: { offset: 6, line: 1, column: 7 },
          end: { offset: 15, line: 1, column: 16 },
        },
      })
    })

    /**
     * v-on:[event] 的 arg.content 去掉方括号、isStatic:false；arg.loc 仍含 [event]，保留原源码范围。
     */
    test('directive with dynamic argument', () => {
      const ast = baseParse('<div v-on:[event]/>')
      const directive = (ast.children[0] as ElementNode).props[0]

      expect(directive).toStrictEqual({
        type: NodeTypes.DIRECTIVE,
        name: 'on',
        rawName: 'v-on:[event]',
        arg: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: 'event',
          isStatic: false,
          constType: ConstantTypes.NOT_CONSTANT,
          loc: {
            start: { column: 11, line: 1, offset: 10 },
            end: { column: 18, line: 1, offset: 17 },
            source: '[event]',
          },
        },
        modifiers: [],
        exp: undefined,
        loc: {
          start: { offset: 5, line: 1, column: 6 },
          end: { offset: 17, line: 1, column: 18 },
          source: 'v-on:[event]',
        },
      })
    })

    /**
     * v-on.enter 无参数且有单修饰符；enter 生成静态表达式，逐项核对 modifier 与指令 loc。
     */
    test('directive with a modifier', () => {
      const ast = baseParse('<div v-on.enter/>')
      const directive = (ast.children[0] as ElementNode).props[0]

      expect(directive).toStrictEqual({
        type: NodeTypes.DIRECTIVE,
        name: 'on',
        rawName: 'v-on.enter',
        arg: undefined,
        modifiers: [
          {
            constType: 3,
            content: 'enter',
            isStatic: true,
            loc: {
              end: {
                column: 16,
                line: 1,
                offset: 15,
              },
              source: 'enter',
              start: {
                column: 11,
                line: 1,
                offset: 10,
              },
            },
            type: 4,
          },
        ],
        exp: undefined,
        loc: {
          start: { offset: 5, line: 1, column: 6 },
          end: { offset: 15, line: 1, column: 16 },
          source: 'v-on.enter',
        },
      })
    })

    /**
     * v-on.enter.exact 将两个修饰符按顺序保存，分别核对 content、静态级别和源码范围。
     */
    test('directive with two modifiers', () => {
      const ast = baseParse('<div v-on.enter.exact/>')
      const directive = (ast.children[0] as ElementNode).props[0]

      expect(directive).toStrictEqual({
        type: NodeTypes.DIRECTIVE,
        name: 'on',
        rawName: 'v-on.enter.exact',
        arg: undefined,
        modifiers: [
          {
            constType: 3,
            content: 'enter',
            isStatic: true,
            loc: {
              end: {
                column: 16,
                line: 1,
                offset: 15,
              },
              source: 'enter',
              start: {
                column: 11,
                line: 1,
                offset: 10,
              },
            },
            type: 4,
          },
          {
            constType: 3,
            content: 'exact',
            isStatic: true,
            loc: {
              end: {
                column: 22,
                line: 1,
                offset: 21,
              },
              source: 'exact',
              start: {
                column: 17,
                line: 1,
                offset: 16,
              },
            },
            type: 4,
          },
        ],
        exp: undefined,
        loc: {
          start: { offset: 5, line: 1, column: 6 },
          end: { offset: 21, line: 1, column: 22 },
          source: 'v-on.enter.exact',
        },
      })
    })

    /**
     * v-on:click.enter.exact 同时保存静态 click 参数与两个修饰符，各范围止于相应片段末尾。
     */
    test('directive with argument and modifiers', () => {
      const ast = baseParse('<div v-on:click.enter.exact/>')
      const directive = (ast.children[0] as ElementNode).props[0]

      expect(directive).toStrictEqual({
        type: NodeTypes.DIRECTIVE,
        name: 'on',
        rawName: 'v-on:click.enter.exact',
        arg: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: 'click',
          isStatic: true,
          constType: ConstantTypes.CAN_STRINGIFY,
          loc: {
            start: { column: 11, line: 1, offset: 10 },
            end: { column: 16, line: 1, offset: 15 },
            source: 'click',
          },
        },
        modifiers: [
          {
            constType: 3,
            content: 'enter',
            isStatic: true,
            loc: {
              end: {
                column: 22,
                line: 1,
                offset: 21,
              },
              source: 'enter',
              start: {
                column: 17,
                line: 1,
                offset: 16,
              },
            },
            type: 4,
          },
          {
            constType: 3,
            content: 'exact',
            isStatic: true,
            loc: {
              end: {
                column: 28,
                line: 1,
                offset: 27,
              },
              source: 'exact',
              start: {
                column: 23,
                line: 1,
                offset: 22,
              },
            },
            type: 4,
          },
        ],
        exp: undefined,
        loc: {
          start: { offset: 5, line: 1, column: 6 },
          end: { offset: 27, line: 1, column: 28 },
          source: 'v-on:click.enter.exact',
        },
      })
    })

    /**
     * v-on:[a.b].camel 的方括号内点属于动态表达式，方括号外 camel 才是 modifier，核对两者内容与范围。
     */
    test('directive with dynamic argument and modifiers', () => {
      const ast = baseParse('<div v-on:[a.b].camel/>')
      const directive = (ast.children[0] as ElementNode).props[0]

      expect(directive).toStrictEqual({
        type: NodeTypes.DIRECTIVE,
        name: 'on',
        rawName: 'v-on:[a.b].camel',
        arg: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: 'a.b',
          isStatic: false,
          constType: ConstantTypes.NOT_CONSTANT,
          loc: {
            start: { column: 11, line: 1, offset: 10 },
            end: { column: 16, line: 1, offset: 15 },
            source: '[a.b]',
          },
        },
        modifiers: [
          {
            constType: 3,
            content: 'camel',
            isStatic: true,
            loc: {
              end: {
                column: 22,
                line: 1,
                offset: 21,
              },
              source: 'camel',
              start: {
                column: 17,
                line: 1,
                offset: 16,
              },
            },
            type: 4,
          },
        ],
        exp: undefined,
        loc: {
          start: { offset: 5, line: 1, column: 6 },
          end: { offset: 21, line: 1, column: 22 },
          source: 'v-on:[a.b].camel',
        },
      })
    })

    /**
     * 输入只有 v- 的指令名，返回型 onError 收到 X_MISSING_DIRECTIVE_NAME；该项降为普通属性 v- 并保留 nameLoc。
     */
    test('directive with no name', () => {
      let errorCode = -1
      const ast = baseParse('<div v-/>', {
        onError: err => {
          errorCode = err.code as number
        },
      })
      const directive = (ast.children[0] as ElementNode).props[0]

      expect(errorCode).toBe(ErrorCodes.X_MISSING_DIRECTIVE_NAME)
      expect(directive).toStrictEqual({
        type: NodeTypes.ATTRIBUTE,
        name: 'v-',
        value: undefined,
        loc: {
          start: { offset: 5, line: 1, column: 6 },
          end: { offset: 7, line: 1, column: 8 },
          source: 'v-',
        },
        nameLoc: {
          start: { offset: 5, line: 1, column: 6 },
          end: { offset: 7, line: 1, column: 8 },
          source: 'v-',
        },
      })
    })

    /**
     * :a=b 简写归一化为 bind，arg 为静态 a、exp 为非静态 b，rawName 仍为 :a。
     */
    test('v-bind shorthand', () => {
      const ast = baseParse('<div :a=b />')
      const directive = (ast.children[0] as ElementNode).props[0]

      expect(directive).toStrictEqual({
        type: NodeTypes.DIRECTIVE,
        name: 'bind',
        rawName: ':a',
        arg: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: 'a',
          isStatic: true,
          constType: ConstantTypes.CAN_STRINGIFY,
          loc: {
            start: { column: 7, line: 1, offset: 6 },
            end: { column: 8, line: 1, offset: 7 },
            source: 'a',
          },
        },
        modifiers: [],
        exp: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: 'b',
          isStatic: false,
          constType: ConstantTypes.NOT_CONSTANT,
          loc: {
            start: { offset: 8, line: 1, column: 9 },
            end: { offset: 9, line: 1, column: 10 },
            source: 'b',
          },
        },
        loc: {
          start: { offset: 5, line: 1, column: 6 },
          end: { offset: 9, line: 1, column: 10 },
          source: ':a=b',
        },
      })
    })

    /**
     * .a=b 简写归一化为 bind，并自动补 prop modifier；此自动节点使用缺省空 loc/非静态标记，与原写 modifier 节点不同。
     */
    test('v-bind .prop shorthand', () => {
      const ast = baseParse('<div .a=b />')
      const directive = (ast.children[0] as ElementNode).props[0]

      expect(directive).toStrictEqual({
        type: NodeTypes.DIRECTIVE,
        name: 'bind',
        rawName: '.a',
        arg: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: 'a',
          isStatic: true,
          constType: ConstantTypes.CAN_STRINGIFY,
          loc: {
            start: { column: 7, line: 1, offset: 6 },
            end: { column: 8, line: 1, offset: 7 },
            source: 'a',
          },
        },
        modifiers: [
          {
            constType: 0,
            content: 'prop',
            isStatic: false,
            loc: {
              end: {
                column: 1,
                line: 1,
                offset: 0,
              },
              source: '',
              start: {
                column: 1,
                line: 1,
                offset: 0,
              },
            },
            type: 4,
          },
        ],
        exp: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: 'b',
          isStatic: false,
          constType: ConstantTypes.NOT_CONSTANT,
          loc: {
            start: { offset: 8, line: 1, column: 9 },
            end: { offset: 9, line: 1, column: 10 },
            source: 'b',
          },
        },
        loc: {
          start: { offset: 5, line: 1, column: 6 },
          end: { offset: 9, line: 1, column: 10 },
          source: '.a=b',
        },
      })
    })

    /**
     * :a.sync=b 在当前非兼容配置保留 bind 与 sync modifier，不直接改成 v-model；核对三部分 loc。
     */
    test('v-bind shorthand with modifier', () => {
      const ast = baseParse('<div :a.sync=b />')
      const directive = (ast.children[0] as ElementNode).props[0]

      expect(directive).toStrictEqual({
        type: NodeTypes.DIRECTIVE,
        name: 'bind',
        rawName: ':a.sync',
        arg: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: 'a',
          isStatic: true,
          constType: ConstantTypes.CAN_STRINGIFY,
          loc: {
            start: { column: 7, line: 1, offset: 6 },
            end: { column: 8, line: 1, offset: 7 },
            source: 'a',
          },
        },
        modifiers: [
          {
            constType: 3,
            content: 'sync',
            isStatic: true,
            loc: {
              end: {
                column: 13,
                line: 1,
                offset: 12,
              },
              source: 'sync',
              start: {
                column: 9,
                line: 1,
                offset: 8,
              },
            },
            type: 4,
          },
        ],
        exp: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: 'b',
          isStatic: false,
          constType: ConstantTypes.NOT_CONSTANT,

          loc: {
            start: { offset: 13, line: 1, column: 14 },
            end: { offset: 14, line: 1, column: 15 },
            source: 'b',
          },
        },
        loc: {
          start: { offset: 5, line: 1, column: 6 },
          end: { offset: 14, line: 1, column: 15 },
          source: ':a.sync=b',
        },
      })
    })

    /**
     * @a=b 简写归一化为 on，静态事件参数 a 与非静态处理器 b 分别保留来源位置。
     */
    test('v-on shorthand', () => {
      const ast = baseParse('<div @a=b />')
      const directive = (ast.children[0] as ElementNode).props[0]

      expect(directive).toStrictEqual({
        type: NodeTypes.DIRECTIVE,
        name: 'on',
        rawName: '@a',
        arg: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: 'a',
          isStatic: true,
          constType: ConstantTypes.CAN_STRINGIFY,
          loc: {
            start: { column: 7, line: 1, offset: 6 },
            end: { column: 8, line: 1, offset: 7 },
            source: 'a',
          },
        },
        modifiers: [],
        exp: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: 'b',
          isStatic: false,
          constType: ConstantTypes.NOT_CONSTANT,

          loc: {
            start: { offset: 8, line: 1, column: 9 },
            end: { offset: 9, line: 1, column: 10 },
            source: 'b',
          },
        },
        loc: {
          start: { offset: 5, line: 1, column: 6 },
          end: { offset: 9, line: 1, column: 10 },
          source: '@a=b',
        },
      })
    })

    /**
     * @a.enter=b 同时归一化事件名、单个 enter modifier 和处理器表达式，逐项核对 loc。
     */
    test('v-on shorthand with modifier', () => {
      const ast = baseParse('<div @a.enter=b />')
      const directive = (ast.children[0] as ElementNode).props[0]

      expect(directive).toStrictEqual({
        type: NodeTypes.DIRECTIVE,
        name: 'on',
        rawName: '@a.enter',
        arg: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: 'a',
          isStatic: true,
          constType: ConstantTypes.CAN_STRINGIFY,
          loc: {
            start: { column: 7, line: 1, offset: 6 },
            end: { column: 8, line: 1, offset: 7 },
            source: 'a',
          },
        },
        modifiers: [
          {
            constType: 3,
            content: 'enter',
            isStatic: true,
            loc: {
              end: {
                column: 14,
                line: 1,
                offset: 13,
              },
              source: 'enter',
              start: {
                column: 9,
                line: 1,
                offset: 8,
              },
            },
            type: 4,
          },
        ],
        exp: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: 'b',
          isStatic: false,
          constType: ConstantTypes.NOT_CONSTANT,

          loc: {
            start: { offset: 14, line: 1, column: 15 },
            end: { offset: 15, line: 1, column: 16 },
            source: 'b',
          },
        },
        loc: {
          start: { offset: 5, line: 1, column: 6 },
          end: { offset: 15, line: 1, column: 16 },
          source: '@a.enter=b',
        },
      })
    })

    /**
     * Comp 上 #a="{ b }" 归一化为 slot，静态名称 a 与解构内容表达式分开，默认 constType 仍为 NOT_CONSTANT。
     */
    test('v-slot shorthand', () => {
      const ast = baseParse('<Comp #a="{ b }" />')
      const directive = (ast.children[0] as ElementNode).props[0]

      expect(directive).toStrictEqual({
        type: NodeTypes.DIRECTIVE,
        name: 'slot',
        rawName: '#a',
        arg: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: 'a',
          isStatic: true,
          constType: ConstantTypes.CAN_STRINGIFY,
          loc: {
            start: { column: 8, line: 1, offset: 7 },
            end: { column: 9, line: 1, offset: 8 },
            source: 'a',
          },
        },
        modifiers: [],
        exp: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: '{ b }',
          isStatic: false,
          // 此处 constType 仍是 parser 默认值，后续表达式转换才会重新判断。
          constType: ConstantTypes.NOT_CONSTANT,
          loc: {
            start: { offset: 10, line: 1, column: 11 },
            end: { offset: 15, line: 1, column: 16 },
            source: '{ b }',
          },
        },
        loc: {
          start: { offset: 6, line: 1, column: 7 },
          end: { offset: 16, line: 1, column: 17 },
          source: '#a="{ b }"',
        },
      })
    })

    // #1241：v-slot 不使用指令修饰符；`v-slot:foo.bar` 的点属于插槽名，参数为完整 foo.bar。
    /**
     * v-slot:foo.bar 的点合并进静态 arg，完整名称为 foo.bar，覆盖点号后的源码终点。
     */
    test('v-slot arg containing dots', () => {
      const ast = baseParse('<Comp v-slot:foo.bar="{ a }" />')
      const directive = (ast.children[0] as ElementNode).props[0]

      expect(directive).toMatchObject({
        type: NodeTypes.DIRECTIVE,
        name: 'slot',
        rawName: 'v-slot:foo.bar',
        arg: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: 'foo.bar',
          isStatic: true,
          constType: ConstantTypes.CAN_STRINGIFY,
          loc: {
            start: {
              column: 14,
              line: 1,
              offset: 13,
            },
            end: {
              column: 21,
              line: 1,
              offset: 20,
            },
          },
        },
      })
    })

    /**
     * 对照有/无 v-pre 的相邻 div：前者 :id 降为属性、Comp 为原生、插值为 Text；关闭边界后后者恢复指令/组件/插值。
     */
    test('v-pre', () => {
      const ast = baseParse(
        `<div v-pre :id="foo"><Comp/>{{ bar }}</div>\n` +
          `<div :id="foo"><Comp/>{{ bar }}</div>`,
      )

      const divWithPre = ast.children[0] as ElementNode
      expect(divWithPre.props).toMatchObject([
        {
          type: NodeTypes.ATTRIBUTE,
          name: `:id`,
          value: {
            type: NodeTypes.TEXT,
            content: `foo`,
          },
          loc: {
            start: { line: 1, column: 12 },
            end: { line: 1, column: 21 },
          },
        },
      ])
      expect(divWithPre.children[0]).toMatchObject({
        type: NodeTypes.ELEMENT,
        tagType: ElementTypes.ELEMENT,
        tag: `Comp`,
      })
      expect(divWithPre.children[1]).toMatchObject({
        type: NodeTypes.TEXT,
        content: `{{ bar }}`,
      })

      // v-pre 结束后不能继续影响后续兄弟节点。
      const divWithoutPre = ast.children[1] as ElementNode
      expect(divWithoutPre.props).toMatchObject([
        {
          type: NodeTypes.DIRECTIVE,
          name: `bind`,
          arg: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            isStatic: true,
            content: `id`,
          },
          exp: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            isStatic: false,
            content: `foo`,
          },
          loc: {
            start: {
              line: 2,
              column: 6,
            },
            end: {
              line: 2,
              column: 15,
            },
          },
        },
      ])
      expect(divWithoutPre.children[0]).toMatchObject({
        type: NodeTypes.ELEMENT,
        tagType: ElementTypes.COMPONENT,
        tag: `Comp`,
      })
      expect(divWithoutPre.children[1]).toMatchObject({
        type: NodeTypes.INTERPOLATION,
        content: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: `bar`,
          isStatic: false,
        },
      })
    })

    // https://github.com/vuejs/docs/issues/2586
    /**
     * v-pre 下分别验证跨 span 分散的 {{ 与 }}、只有 {{ 的 span、HTML textarea 内未闭合 {{；均保持 Text，不让插值状态吞掉闭标签。
     */
    test('v-pre with half-open interpolation', () => {
      const ast = baseParse(
        `<div v-pre>
          <span>{{ number </span>
          <span>}}</span>
        </div>
        `,
      )
      expect((ast.children[0] as ElementNode).children).toMatchObject([
        {
          type: NodeTypes.ELEMENT,
          children: [{ type: NodeTypes.TEXT, content: `{{ number ` }],
        },
        {
          type: NodeTypes.ELEMENT,
          children: [{ type: NodeTypes.TEXT, content: `}}` }],
        },
      ])

      const ast2 = baseParse(`<div v-pre><span>{{ number </span></div>`)
      expect((ast2.children[0] as ElementNode).children).toMatchObject([
        {
          type: NodeTypes.ELEMENT,
          children: [{ type: NodeTypes.TEXT, content: `{{ number ` }],
        },
      ])

      const ast3 = baseParse(`<div v-pre><textarea>{{ foo </textarea></div>`, {
        parseMode: 'html',
      })
      expect((ast3.children[0] as ElementNode).children).toMatchObject([
        {
          type: NodeTypes.ELEMENT,
          children: [
            {
              type: NodeTypes.TEXT,
              content: `{{ foo `,
            },
          ],
        },
      ])
    })

    /**
     * 自闭合 <div v-pre/> 后的兄弟 div 恢复 bind、Comp 组件和 bar 插值，验证立即关闭边界会清除 v-pre 状态；输入没有嵌套 v-pre。
     */
    test('self-closing v-pre', () => {
      const ast = baseParse(
        `<div v-pre/>\n<div :id="foo"><Comp/>{{ bar }}</div>`,
      )
      // 自闭合 v-pre 立即退出，后续兄弟应恢复正常指令解析。
      const divWithoutPre = ast.children[1] as ElementNode
      expect(divWithoutPre.props).toMatchObject([
        {
          type: NodeTypes.DIRECTIVE,
          name: `bind`,
          arg: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            isStatic: true,
            content: `id`,
          },
          exp: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            isStatic: false,
            content: `foo`,
          },
          loc: {
            start: {
              line: 2,
              column: 6,
            },
            end: {
              line: 2,
              column: 15,
            },
          },
        },
      ])
      expect(divWithoutPre.children[0]).toMatchObject({
        type: NodeTypes.ELEMENT,
        tagType: ElementTypes.COMPONENT,
        tag: `Comp`,
      })
      expect(divWithoutPre.children[1]).toMatchObject({
        type: NodeTypes.INTERPOLATION,
        content: {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: `bar`,
          isStatic: false,
        },
      })
    })

    /**
     * 小写开 div 配大写 </DIV> 可匹配同一开放元素，hello 的内容和范围保持正确。
     */
    test('end tags are case-insensitive.', () => {
      const ast = baseParse('<div>hello</DIV>after')
      const element = ast.children[0] as ElementNode
      const text = element.children[0] as TextNode

      expect(text).toStrictEqual({
        type: NodeTypes.TEXT,
        content: 'hello',
        loc: {
          start: { offset: 5, line: 1, column: 6 },
          end: { offset: 10, line: 1, column: 11 },
          source: 'hello',
        },
      })
    })
  })

  // 容错边界：模板编辑中的残缺输入也应尽量产出 AST，并给出稳定错误位置。
  describe('Edge Cases', () => {
    /**
     * 带动态 class 对象的单个自闭合 div 生成一个根元素，属性中的空格不拆分标签。
     */
    test('self closing single tag', () => {
      const ast = baseParse('<div :class="{ some: condition }" />')

      expect(ast.children).toHaveLength(1)
      expect(ast.children[0]).toMatchObject({ tag: 'div' })
    })

    /**
     * 两行自闭合 div/p 含对象绑定；根保留两元素并核对完整 AST 快照，根间换行纯空白被整理。
     */
    test('self closing multiple tag', () => {
      const ast = baseParse(
        `<div :class="{ some: condition }" />\n` +
          `<p v-bind:style="{ color: 'red' }"/>`,
      )

      expect(ast).toMatchSnapshot()

      expect(ast.children).toHaveLength(2)
      expect(ast.children[0]).toMatchObject({ tag: 'div' })
      expect(ast.children[1]).toMatchObject({ tag: 'p' })
    })

    /**
     * 正常嵌套 div 中包含自闭合 p 与带 <html> 字样的注释；children 仅为 p 和 Comment，注释正文不启动标签解析。
     */
    test('valid html', () => {
      const ast = baseParse(
        `<div :class="{ some: condition }">\n` +
          `  <p v-bind:style="{ color: 'red' }"/>\n` +
          `  <!-- a comment with <html> inside it -->\n` +
          `</div>`,
      )

      expect(ast).toMatchSnapshot()

      expect(ast.children).toHaveLength(1)
      const el = ast.children[0] as any
      expect(el).toMatchObject({
        tag: 'div',
      })
      expect(el.children).toHaveLength(2)
      expect(el.children[0]).toMatchObject({
        tag: 'p',
      })
      expect(el.children[1]).toMatchObject({
        type: NodeTypes.COMMENT,
      })
    })

    /**
     * 交错 <div><span></div></span>：默认错误处理先抛缺失闭标签；返回型 spy 记录 span 缺失和后续无效 </span> 的位置，并保留恢复 AST 快照。
     */
    test('invalid html', () => {
      expect(() => {
        baseParse(`<div>\n<span>\n</div>\n</span>`)
      }).toThrow('Element is missing end tag.')

      const spy = vi.fn()
      const ast = baseParse(`<div>\n<span>\n</div>\n</span>`, {
        onError: spy,
      })

      expect(spy.mock.calls).toMatchObject([
        [
          {
            code: ErrorCodes.X_MISSING_END_TAG,
            loc: {
              start: {
                offset: 6,
                line: 2,
                column: 1,
              },
            },
          },
        ],
        [
          {
            code: ErrorCodes.X_INVALID_END_TAG,
            loc: {
              start: {
                offset: 20,
                line: 4,
                column: 1,
              },
            },
          },
        ],
      ])

      expect(ast).toMatchSnapshot()
    })

    /**
     * 把带 LF 的 foo Text、bar 插值、but Text、baz 插值顺序拼接；累计 UTF-16 偏移并逐项核对父/内层表达式行列。
     */
    test('parse with correct location info', () => {
      const fooSrc = `foo\n is `
      const barSrc = `{{ bar }}`
      const butSrc = ` but `
      const bazSrc = `{{ baz }}`
      const [foo, bar, but, baz] = baseParse(
        fooSrc + barSrc + butSrc + bazSrc,
      ).children

      let offset = 0
      expect(foo.loc.start).toEqual({ line: 1, column: 1, offset })
      offset += fooSrc.length
      expect(foo.loc.end).toEqual({ line: 2, column: 5, offset })

      expect(bar.loc.start).toEqual({ line: 2, column: 5, offset })
      const barInner = (bar as InterpolationNode).content
      offset += 3
      expect(barInner.loc.start).toEqual({ line: 2, column: 8, offset })
      offset += 3
      expect(barInner.loc.end).toEqual({ line: 2, column: 11, offset })
      offset += 3
      expect(bar.loc.end).toEqual({ line: 2, column: 14, offset })

      expect(but.loc.start).toEqual({ line: 2, column: 14, offset })
      offset += butSrc.length
      expect(but.loc.end).toEqual({ line: 2, column: 19, offset })

      expect(baz.loc.start).toEqual({ line: 2, column: 19, offset })
      const bazInner = (baz as InterpolationNode).content
      offset += 3
      expect(bazInner.loc.start).toEqual({ line: 2, column: 22, offset })
      offset += 3
      expect(bazInner.loc.end).toEqual({ line: 2, column: 25, offset })
      offset += 3
      expect(baz.loc.end).toEqual({ line: 2, column: 28, offset })
    })

    // 标准 HTML 容错会忽略斜杠，把 `<` 与 template 当作 Hello 开始标签的属性，进而令
    // `<template>` 无法闭合、`<script>` 变成其 child。真实模板不会刻意这样写，但这是 IDE
    // 编辑中的常见中间态；应让 script 保持根级，便于 Volar 对稳定 SFC 结构做增量计算。
    /**
     * 输入尚未完成的 Hello 开标签后紧接 </template> 与 script；容错开启 Hello 后处理新闭标签，使 script 仍为第二个根节点，spy 仅用于允许恢复。
     */
    test('tag termination handling for IDE', () => {
      const spy = vi.fn()
      const ast = baseParse(
        `<template><Hello\n</template><script>console.log(1)</script>`,
        {
          onError: spy,
        },
      )
      //
      expect(ast.children.length).toBe(2)
      expect(ast.children[1]).toMatchObject({
        type: NodeTypes.ELEMENT,
        tag: 'script',
      })
    })

    /**
     * <template #> 的空简写参数保持 undefined，slot 指令仍存在，不生成空名称表达式。
     */
    test('arg should be undefined on shorthand dirs with no arg', () => {
      const ast = baseParse(`<template #></template>`)
      const el = ast.children[0] as ElementNode
      expect(el.props[0]).toMatchObject({
        type: NodeTypes.DIRECTIVE,
        name: 'slot',
        exp: undefined,
        arg: undefined,
      })
    })

    // vue-macros 发现的边界：SFC 原始文本状态不能泄漏到下一次解析 TS/JSX 片段。
    /**
     * 先以 SFC 模式解析未闭合 Foo 且吞下错误，再解析普通 { foo }；断言不抛，验证 reset 清 inRCDATA；未覆盖 pre/v-pre 残留。
     */
    test('should reset inRCDATA state', () => {
      baseParse(`<Foo>`, {
        parseMode: 'sfc',
        /** 此处只需要允许残缺 SFC 继续解析，错误内容不是本用例关注点。 */
        onError() {},
      })
      expect(() => baseParse(`{ foo }`)).not.toThrow()
    })

    /**
     * 闭 span 的 > 格式化到后续行；核对 loc.source 和终点 offset=27，本例没有断言终点 line/column。
     */
    test('correct loc when the closing > is foarmatted', () => {
      const [span] = baseParse(`<span></span
      
      >`).children

      expect(span.loc.source).toBe('<span></span\n      \n      >')
      expect(span.loc.start.offset).toBe(0)
      expect(span.loc.end.offset).toBe(27)
    })

    /**
     * v-if 属性表达式在 && 后换行；实体扫描回退不能遗漏 LF，最终 span.loc.end.line 为 2。
     */
    test('correct loc when a line in attribute value ends with &', () => {
      const [span] = baseParse(`<span v-if="foo &&\nbar"></span>`).children
      expect(span.loc.end.line).toBe(2)
    })
  })

  // 非浏览器实体解码：验证默认实体结果，以及 decodeEntities 选项会被忽略的警告。
  describe('decodeEntities option', () => {
    /**
     * 默认非浏览器实体解码把 gt/lt/amp/apos/quot 转字符，未知 foo 保留源码，并合并为一个 Text。
     */
    test('use decode by default', () => {
      const ast: any = baseParse('&gt;&lt;&amp;&apos;&quot;&foo;')

      expect(ast.children.length).toBe(1)
      expect(ast.children[0].type).toBe(NodeTypes.TEXT)
      expect(ast.children[0].content).toBe('><&\'"&foo;')
    })

    /**
     * 非浏览器构建传 decodeEntities 自定义 cups 规则；断言该选项被忽略的警告，本例不核对自定义解码结果。
     */
    test('should warn in non-browser build', () => {
      baseParse('&amp;&cups;', {
        decodeEntities: text => text.replace('&cups;', '\u222A\uFE00'),
        onError: () => {}, // 此例只核对警告，允许解析继续。
      })
      expect(
        `decodeEntities option is passed but will be ignored`,
      ).toHaveBeenWarned()
    })
  })

  // condense 策略：按节点邻接关系删除纯空白、折叠连续空白；pre 内容仍保留。
  describe('whitespace management when adopting strategy condense', () => {
    /** 固定 condense 选项解析，并允许单个用例覆盖其他 parser 配置。 */
    const parse = (content: string, options?: ParserOptions) =>
      baseParse(content, {
        whitespace: 'condense',
        ...options,
      })

    /**
     * condense 下 div 首尾只有空白且中间 span；关闭元素时移除边缘空白，children 只剩 span。
     */
    test('should remove whitespaces at start/end inside an element', () => {
      const ast = parse(`<div>   <span/>    </div>`)
      expect((ast.children[0] as ElementNode).children.length).toBe(1)
    })

    /**
     * condense 下三个根 div 之间含换行纯空白；最终根 children 只有三个元素。
     */
    test('should remove whitespaces w/ newline between elements', () => {
      const ast = parse(`<div/> \n <div/> \n <div/>`)
      expect(ast.children.length).toBe(3)
      expect(ast.children.every(c => c.type === NodeTypes.ELEMENT)).toBe(true)
    })

    /**
     * condense 下 div 与注释、注释与 div 之间空白都移除，即使注释后一段没有 LF，根为元素/注释/元素。
     */
    test('should remove whitespaces adjacent to comments', () => {
      const ast = parse(`<div/> \n <!--foo--> <div/>`)
      expect(ast.children.length).toBe(3)
      expect(ast.children[0].type).toBe(NodeTypes.ELEMENT)
      expect(ast.children[1].type).toBe(NodeTypes.COMMENT)
      expect(ast.children[2].type).toBe(NodeTypes.ELEMENT)
    })

    /**
     * condense 下评论与元素两侧都有 LF；仍删除这些纯空白，保留三个语义节点。
     */
    test('should remove whitespaces w/ newline between comments and elements', () => {
      const ast = parse(`<div/> \n <!--foo--> \n <div/>`)
      expect(ast.children.length).toBe(3)
      expect(ast.children[0].type).toBe(NodeTypes.ELEMENT)
      expect(ast.children[1].type).toBe(NodeTypes.COMMENT)
      expect(ast.children[2].type).toBe(NodeTypes.ELEMENT)
    })

    /**
     * condense 下两个插值间的换行不能删掉全部分隔；中间保留单空格 Text。
     */
    test('should NOT remove whitespaces w/ newline between interpolations', () => {
      const ast = parse(`{{ foo }} \n {{ bar }}`)
      expect(ast.children.length).toBe(3)
      expect(ast.children[0].type).toBe(NodeTypes.INTERPOLATION)
      expect(ast.children[1]).toMatchObject({
        type: NodeTypes.TEXT,
        content: ' ',
      })
      expect(ast.children[2].type).toBe(NodeTypes.INTERPOLATION)
    })

    /**
     * condense 下注释与 msg 插值间的换行保留为单空格 Text，插值邻接规则不同于两个元素。
     */
    test('should NOT remove whitespaces w/ newline between interpolation and comment', () => {
      const ast = parse(`<!-- foo --> \n {{msg}}`)
      expect(ast.children.length).toBe(3)
      expect(ast.children[0].type).toBe(NodeTypes.COMMENT)
      expect(ast.children[1]).toMatchObject({
        type: NodeTypes.TEXT,
        content: ' ',
      })
      expect(ast.children[2].type).toBe(NodeTypes.INTERPOLATION)
    })

    /**
     * condense 下三个 div 之间没有 LF 的空格保留为 Text，得到元素/文本交替的五节点。
     */
    test('should NOT remove whitespaces w/o newline between elements', () => {
      const ast = parse(`<div/> <div/> <div/>`)
      expect(ast.children.length).toBe(5)
      expect(ast.children.map(c => c.type)).toMatchObject([
        NodeTypes.ELEMENT,
        NodeTypes.TEXT,
        NodeTypes.ELEMENT,
        NodeTypes.TEXT,
        NodeTypes.ELEMENT,
      ])
    })

    /**
     * condense 将普通混合文本内空格与 LF 连续段折为单空格，保留非纯空白文本边缘的一格。
     */
    test('should condense consecutive whitespaces in text', () => {
      const ast = parse(`   foo  \n    bar     baz     `)
      expect((ast.children[0] as TextNode).content).toBe(` foo bar baz `)
    })

    /**
     * 显式设置 pre 与忽略首换行规则；<pre> 后的第一个 LF 删除，内部双空格与尾空格完整保留。
     */
    test('should remove leading newline character immediately following the pre element start tag', () => {
      const ast = parse(`<pre>\n  foo  bar  </pre>`, {
        isPreTag: tag => tag === 'pre',
        isIgnoreNewlineTag: tag => tag === 'pre',
      })
      expect(ast.children).toHaveLength(1)
      const preElement = ast.children[0] as ElementNode
      expect(preElement.children).toHaveLength(1)
      expect((preElement.children[0] as TextNode).content).toBe(`  foo  bar  `)
    })

    /**
     * pre 中首节点是 span，后面才有 LF 文本；保留这段 LF 和连续空格，不把子标签后的换行当作开 pre 首换行。
     */
    test('should NOT remove leading newline character immediately following child-tag of pre element', () => {
      const ast = parse(`<pre><span></span>\n  foo  bar  </pre>`, {
        isPreTag: tag => tag === 'pre',
      })
      const preElement = ast.children[0] as ElementNode
      expect(preElement.children).toHaveLength(2)
      expect((preElement.children[1] as TextNode).content).toBe(
        `\n  foo  bar  `,
      )
    })

    /**
     * 自闭合 pre 必须恢复 inPre；后续 span 内的 LF/连续空格仍按 condense 折为 foo bar。
     */
    test('self-closing pre tag', () => {
      const ast = parse(`<pre/><span>\n  foo   bar</span>`, {
        isPreTag: tag => tag === 'pre',
      })
      const elementAfterPre = ast.children[1] as ElementNode
      // 外层 pre 的保留规则不能泄漏到后续 span；span 内仍应压缩空白。
      expect((elementAfterPre.children[0] as TextNode).content).toBe(` foo bar`)
    })

    /**
     * HTML textarea 使用 RCDATA，Text:\n   foo 的 LF 和三空格保持原样，关闭回调不做 condense。
     */
    test('should NOT condense whitespaces in RCDATA text mode', () => {
      const ast = parse(`<textarea>Text:\n   foo</textarea>`, {
        parseMode: 'html',
      })
      const preElement = ast.children[0] as ElementNode
      expect(preElement.children).toHaveLength(1)
      expect((preElement.children[0] as TextNode).content).toBe(`Text:\n   foo`)
    })
  })

  // preserve 策略：保留非纯空白文本；仍删除首尾纯空白，其他纯空白合并为一个空格。
  describe('whitespace management when adopting strategy preserve', () => {
    /** 固定 preserve 选项解析，并允许用例追加平台配置。 */
    const parse = (content: string, options?: ParserOptions) =>
      baseParse(content, {
        whitespace: 'preserve',
        ...options,
      })

    /**
     * preserve 同样删除 div 首尾纯空白，children 只剩中间 span，说明 preserve 不等于保留所有节点。
     */
    test('should still remove whitespaces at start/end inside an element', () => {
      const ast = parse(`<div>   <span/>    </div>`)
      expect((ast.children[0] as ElementNode).children.length).toBe(1)
    })

    /**
     * preserve 下三个 div 之间的 LF 空白仍保留为 Text，根节点种类按元素/文本交替。
     */
    test('should preserve whitespaces w/ newline between elements', () => {
      const ast = parse(`<div/> \n <div/> \n <div/>`)
      expect(ast.children.length).toBe(5)
      expect(ast.children.map(c => c.type)).toMatchObject([
        NodeTypes.ELEMENT,
        NodeTypes.TEXT,
        NodeTypes.ELEMENT,
        NodeTypes.TEXT,
        NodeTypes.ELEMENT,
      ])
    })

    /**
     * preserve 下元素与评论间纯空白不删除，保留五节点的元素/文本/注释/文本/元素结构。
     */
    test('should preserve whitespaces adjacent to comments', () => {
      const ast = parse(`<div/> \n <!--foo--> <div/>`)
      expect(ast.children.length).toBe(5)
      expect(ast.children.map(c => c.type)).toMatchObject([
        NodeTypes.ELEMENT,
        NodeTypes.TEXT,
        NodeTypes.COMMENT,
        NodeTypes.TEXT,
        NodeTypes.ELEMENT,
      ])
    })

    /**
     * preserve 下评论与元素两侧含 LF 的空白仍形成 Text，不应用 condense 的邻接删除分支。
     */
    test('should preserve whitespaces w/ newline between comments and elements', () => {
      const ast = parse(`<div/> \n <!--foo--> \n <div/>`)
      expect(ast.children.length).toBe(5)
      expect(ast.children.map(c => c.type)).toMatchObject([
        NodeTypes.ELEMENT,
        NodeTypes.TEXT,
        NodeTypes.COMMENT,
        NodeTypes.TEXT,
        NodeTypes.ELEMENT,
      ])
    })

    /**
     * preserve 下两个插值之间的纯空白依然统一为单空格 Text，而不是保留原 LF 字符串。
     */
    test('should preserve whitespaces w/ newline between interpolations', () => {
      const ast = parse(`{{ foo }} \n {{ bar }}`)
      expect(ast.children.length).toBe(3)
      expect(ast.children[0].type).toBe(NodeTypes.INTERPOLATION)
      expect(ast.children[1]).toMatchObject({
        type: NodeTypes.TEXT,
        content: ' ',
      })
      expect(ast.children[2].type).toBe(NodeTypes.INTERPOLATION)
    })

    /**
     * preserve 下三个元素之间的普通空格保留为两个 Text，节点数量为五。
     */
    test('should preserve whitespaces w/o newline between elements', () => {
      const ast = parse(`<div/> <div/> <div/>`)
      expect(ast.children.length).toBe(5)
      expect(ast.children.map(c => c.type)).toMatchObject([
        NodeTypes.ELEMENT,
        NodeTypes.TEXT,
        NodeTypes.ELEMENT,
        NodeTypes.TEXT,
        NodeTypes.ELEMENT,
      ])
    })

    /**
     * preserve 下含 foo/bar/baz 的非纯空白文本完整保留原连续空格与 LF，核对 content 与输入严格相同。
     */
    test('should preserve consecutive whitespaces in text', () => {
      const content = `   foo  \n    bar     baz     `
      const ast = parse(content)
      expect((ast.children[0] as TextNode).content).toBe(content)
    })
  })

  // 表达式解析：Node 构建缓存 Babel AST，浏览器构建则保持轻量节点并延后校验。
  describe('expression parsing', () => {
    /**
     * prefixIdentifiers 模式解析 a+b 插值；节点缓存 Babel BinaryExpression，后续表达式转换可复用。
     */
    test('interpolation', () => {
      const ast = baseParse(`{{ a + b }}`, { prefixIdentifiers: true })
      // @ts-expect-error
      expect((ast.children[0] as InterpolationNode).content.ast?.type).toBe(
        'BinaryExpression',
      )
    })

    /**
     * 动态 bind 参数 key+1 与值 foo() 分别缓存 BinaryExpression/CallExpression，证明两个表达式采用各自 loc 和 AST。
     */
    test('v-bind', () => {
      const ast = baseParse(`<div :[key+1]="foo()" />`, {
        prefixIdentifiers: true,
      })
      const dir = (ast.children[0] as ElementNode).props[0] as DirectiveNode
      // @ts-expect-error
      expect(dir.arg?.ast?.type).toBe('BinaryExpression')
      // @ts-expect-error
      expect(dir.exp?.ast?.type).toBe('CallExpression')
    })

    /**
     * @click="a++;b++" 因含分号按 Statements 模式解析为 Program，body 包含两个 ExpressionStatement。
     */
    test('v-on multi statements', () => {
      const ast = baseParse(`<div @click="a++;b++" />`, {
        prefixIdentifiers: true,
      })
      const dir = (ast.children[0] as ElementNode).props[0] as DirectiveNode
      // @ts-expect-error
      expect(dir.exp?.ast?.type).toBe('Program')
      expect((dir.exp?.ast as Program).body).toMatchObject([
        { type: 'ExpressionStatement' },
        { type: 'ExpressionStatement' },
      ])
    })

    /**
     * #foo="{a,b}" 按 Params 模式包为箭头参数，缓存 ArrowFunctionExpression 而非对象表达式。
     */
    test('v-slot', () => {
      const ast = baseParse(`<Comp #foo="{ a, b }" />`, {
        prefixIdentifiers: true,
      })
      const dir = (ast.children[0] as ElementNode).props[0] as DirectiveNode
      // @ts-expect-error
      expect(dir.exp?.ast?.type).toBe('ArrowFunctionExpression')
    })

    /**
     * v-for 解构 value、key、index 和 a.b 数据源先拆分；source 缓存 MemberExpression，value 缓存箭头参数 AST，两个简单别名以 null 表示快速路径。
     */
    test('v-for', () => {
      const ast = baseParse(`<div v-for="({ a, b }, key, index) of a.b" />`, {
        prefixIdentifiers: true,
      })
      const dir = (ast.children[0] as ElementNode).props[0] as DirectiveNode
      const { source, value, key, index } = dir.forParseResult!
      // @ts-expect-error
      expect(source.ast?.type).toBe('MemberExpression')
      // @ts-expect-error
      expect(value?.ast?.type).toBe('ArrowFunctionExpression')
      expect(key?.ast).toBeNull() // 简单标识符快速路径。
      expect(index?.ast).toBeNull() // 简单标识符快速路径。
    })
  })

  // 错误矩阵：逐个锁定 tokenizer/parser 错误码及其 location，防止诊断编号漂移。
  describe('Errors', () => {
    // HTML 解析错误以 WHATWG 规范为基准：
    // https://html.spec.whatwg.org/multipage/parsing.html#parse-errors
    // 当前 tokenizer 没有实现的错误组以注释保留，未注册测试，也不算已验证覆盖。
    // 以下启用 17 组、54 个 fixture，全部共用 HTML 模式和仅 svg 取 SVG 的 namespace 回调。
    const patterns: {
      /** 错误码名称到复现输入矩阵的映射。 */
      [key: string]: Array<{
        /** 送入 parser 的完整模板源码。 */
        code: string
        /** 预期错误码及其准确起始位置。 */
        errors: Array<{
          /** 预期 parser 错误码。 */
          type: ErrorCodes
          /** 预期诊断位置。 */
          loc: Position
        }>
        /** 该输入需要覆盖的非默认 parser 选项。 */
        options?: Partial<ParserOptions>
      }>
    } = {
      // ABRUPT_CLOSING_OF_EMPTY_COMMENT: [
      //   {
      //     code: '<template><!--></template>',
      //     errors: [
      //       {
      //         type: ErrorCodes.ABRUPT_CLOSING_OF_EMPTY_COMMENT,
      //         loc: { offset: 10, line: 1, column: 11 }
      //       }
      //     ]
      //   },
      //   {
      //     code: '<template><!---></template>',
      //     errors: [
      //       {
      //         type: ErrorCodes.ABRUPT_CLOSING_OF_EMPTY_COMMENT,
      //         loc: { offset: 10, line: 1, column: 11 }
      //       }
      //     ]
      //   },
      //   {
      //     code: '<template><!----></template>',
      //     errors: []
      //   }
      // ],
      CDATA_IN_HTML_CONTENT: [
        {
          /** HTML template 内 CDATA 在 offset 10 报 CDATA_IN_HTML_CONTENT，外层正常闭合。 */
          code: '<template><![CDATA[cdata]]></template>',
          errors: [
            {
              type: ErrorCodes.CDATA_IN_HTML_CONTENT,
              loc: { offset: 10, line: 1, column: 11 },
            },
          ],
        },
        {
          /** svg 内 CDATA 使用 SVG namespace，正文作为 Text，errors 为空。 */
          code: '<template><svg><![CDATA[cdata]]></svg></template>',
          errors: [],
        },
        {
          // HTML 根级 CDATA 非法，应报告 parser 错误。
          /** 根 CDATA 使用默认 HTML namespace，在 0 报 CDATA_IN_HTML_CONTENT。 */
          code: '<![CDATA[cdata]]>',
          errors: [
            {
              type: ErrorCodes.CDATA_IN_HTML_CONTENT,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
      ],
      DUPLICATE_ATTRIBUTE: [
        {
          /** 同一 div 第二个 id="" 在 21 报 DUPLICATE_ATTRIBUTE；查重比较原始属性名。 */
          code: '<template><div id="" id=""></div></template>',
          errors: [
            {
              type: ErrorCodes.DUPLICATE_ATTRIBUTE,
              loc: { offset: 21, line: 1, column: 22 },
            },
          ],
        },
      ],
      // END_TAG_WITH_ATTRIBUTES: [
      //   {
      //     code: '<template><div></div id=""></template>',
      //     errors: [
      //       {
      //         type: ErrorCodes.END_TAG_WITH_ATTRIBUTES,
      //         loc: { offset: 21, line: 1, column: 22 }
      //       }
      //     ]
      //   }
      // ],
      // END_TAG_WITH_TRAILING_SOLIDUS: [
      //   {
      //     code: '<template><div></div/></template>',
      //     errors: [
      //       {
      //         type: ErrorCodes.END_TAG_WITH_TRAILING_SOLIDUS,
      //         loc: { offset: 20, line: 1, column: 21 }
      //       }
      //     ]
      //   }
      // ],
      EOF_BEFORE_TAG_NAME: [
        {
          /** 残留 < 使 EOF 停在 BeforeTagName：终点 11 报 EOF_BEFORE_TAG_NAME，再在 0 报 template 未闭合。 */
          code: '<template><',
          errors: [
            {
              type: ErrorCodes.EOF_BEFORE_TAG_NAME,
              loc: { offset: 11, line: 1, column: 12 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
        {
          /** 残留 </ 使 EOF 停在 BeforeClosingTagName：终点 12 报 EOF_BEFORE_TAG_NAME，再报 template 未闭合。 */
          code: '<template></',
          errors: [
            {
              type: ErrorCodes.EOF_BEFORE_TAG_NAME,
              loc: { offset: 12, line: 1, column: 13 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
      ],
      EOF_IN_CDATA: [
        {
          /** 带正文的 SVG CDATA 未结束：终点 29 报 EOF_IN_CDATA，再按栈顺序在 10/0 报 svg/template 未闭合。 */
          code: '<template><svg><![CDATA[cdata',
          errors: [
            {
              type: ErrorCodes.EOF_IN_CDATA,
              loc: { offset: 29, line: 1, column: 30 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 10, line: 1, column: 11 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
        {
          /** SVG CDATA 起始串后即 EOF：终点 24 报 EOF_IN_CDATA，再按 10/0 报 svg/template 未闭合。 */
          code: '<template><svg><![CDATA[',
          errors: [
            {
              type: ErrorCodes.EOF_IN_CDATA,
              loc: { offset: 24, line: 1, column: 25 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 10, line: 1, column: 11 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
      ],
      EOF_IN_COMMENT: [
        {
          /** 带正文注释未结束：终点 21 报 EOF_IN_COMMENT，再在 0 报 template 未闭合。 */
          code: '<template><!--comment',
          errors: [
            {
              type: ErrorCodes.EOF_IN_COMMENT,
              loc: { offset: 21, line: 1, column: 22 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
        {
          /** <!-- 后即 EOF：终点 14 报 EOF_IN_COMMENT，再在 0 报 template 未闭合。 */
          code: '<template><!--',
          errors: [
            {
              type: ErrorCodes.EOF_IN_COMMENT,
              loc: { offset: 14, line: 1, column: 15 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
        // // 非法开启的 bogus comment 不额外报告 eof-in-comment。
        // // https://html.spec.whatwg.org/multipage/parsing.html#bogus-comment-state
        // {
        //   code: '<template><!',
        //   errors: [
        //     {
        //       type: ErrorCodes.INCORRECTLY_OPENED_COMMENT,
        //       loc: { offset: 10, line: 1, column: 11 }
        //     },
        //     {
        //       type: ErrorCodes.X_MISSING_END_TAG,
        //       loc: { offset: 0, line: 1, column: 1 }
        //     }
        //   ]
        // },
        // {
        //   code: '<template><!-',
        //   errors: [
        //     {
        //       type: ErrorCodes.INCORRECTLY_OPENED_COMMENT,
        //       loc: { offset: 10, line: 1, column: 11 }
        //     },
        //     {
        //       type: ErrorCodes.X_MISSING_END_TAG,
        //       loc: { offset: 0, line: 1, column: 1 }
        //     }
        //   ]
        // },
        // {
        //   code: '<template><!abc',
        //   errors: [
        //     {
        //       type: ErrorCodes.INCORRECTLY_OPENED_COMMENT,
        //       loc: { offset: 10, line: 1, column: 11 }
        //     },
        //     {
        //       type: ErrorCodes.X_MISSING_END_TAG,
        //       loc: { offset: 0, line: 1, column: 1 }
        //     }
        //   ]
        // }
      ],
      // EOF_IN_SCRIPT_HTML_COMMENT_LIKE_TEXT: [
      //   {
      //     code: "<script><!--console.log('hello')",
      //     errors: [
      //       {
      //         type: ErrorCodes.X_MISSING_END_TAG,
      //         loc: { offset: 0, line: 1, column: 1 }
      //       },
      //       {
      //         type: ErrorCodes.EOF_IN_SCRIPT_HTML_COMMENT_LIKE_TEXT,
      //         loc: { offset: 32, line: 1, column: 33 }
      //       }
      //     ]
      //   },
      //   {
      //     code: "<script>console.log('hello')",
      //     errors: [
      //       {
      //         type: ErrorCodes.X_MISSING_END_TAG,
      //         loc: { offset: 0, line: 1, column: 1 }
      //       }
      //     ]
      //   }
      // ],
      EOF_IN_TAG: [
        {
          /** div 名未结束：InTagName 在终点 14 报 EOF_IN_TAG；div 尚未入栈，仅再报 template 未闭合。 */
          code: '<template><div',
          errors: [
            {
              type: ErrorCodes.EOF_IN_TAG,
              loc: { offset: 14, line: 1, column: 15 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
        {
          /** div 名后只有空格：BeforeAttrName 在终点 15 报 EOF_IN_TAG，仅再报 template 未闭合。 */
          code: '<template><div ',
          errors: [
            {
              type: ErrorCodes.EOF_IN_TAG,
              loc: { offset: 15, line: 1, column: 16 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
        {
          /** id 属性名未结束：InAttrName 在终点 17 报 EOF_IN_TAG，外层 template 在 0 报未闭合。 */
          code: '<template><div id',
          errors: [
            {
              type: ErrorCodes.EOF_IN_TAG,
              loc: { offset: 17, line: 1, column: 18 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
        {
          /** id 名后空格但无 >：AfterAttrName 在终点 18 报 EOF_IN_TAG，再报 template 未闭合。 */
          code: '<template><div id ',
          errors: [
            {
              type: ErrorCodes.EOF_IN_TAG,
              loc: { offset: 18, line: 1, column: 19 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
        {
          /** id 后停在等号：BeforeAttrValue 在 19 报 EOF_IN_TAG；未启用 MISSING_ATTRIBUTE_VALUE 断言，再报 template 未闭合。 */
          code: '<template><div id =',
          errors: [
            // {
            //   type: ErrorCodes.MISSING_ATTRIBUTE_VALUE,
            //   loc: { offset: 19, line: 1, column: 20 }
            // },
            {
              type: ErrorCodes.EOF_IN_TAG,
              loc: { offset: 19, line: 1, column: 20 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
        {
          /** 单引号值 abc 未闭引号：InAttrValueSq 在终点 22 报 EOF_IN_TAG，仅再报 template 未闭合。 */
          code: "<template><div id='abc",
          errors: [
            {
              type: ErrorCodes.EOF_IN_TAG,
              loc: { offset: 22, line: 1, column: 23 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
        {
          /** 双引号值 abc 未闭引号：InAttrValueDq 在终点 22 报 EOF_IN_TAG，仅再报 template 未闭合。 */
          code: '<template><div id="abc',
          errors: [
            {
              type: ErrorCodes.EOF_IN_TAG,
              loc: { offset: 22, line: 1, column: 23 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
        {
          /** 单引号值已完成但无 >：BeforeAttrName 在终点 23 报 EOF_IN_TAG，再报 template 未闭合。 */
          code: "<template><div id='abc'",
          errors: [
            {
              type: ErrorCodes.EOF_IN_TAG,
              loc: { offset: 23, line: 1, column: 24 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
        {
          /** 双引号值已完成但无 >：终点 23 报 EOF_IN_TAG，再报 template 未闭合。 */
          code: '<template><div id="abc"',
          errors: [
            {
              type: ErrorCodes.EOF_IN_TAG,
              loc: { offset: 23, line: 1, column: 24 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
        {
          /** 无引号 abc 到 EOF：InAttrValueNq 在终点 21 报 EOF_IN_TAG，再报 template 未闭合。 */
          code: '<template><div id=abc',
          errors: [
            {
              type: ErrorCodes.EOF_IN_TAG,
              loc: { offset: 21, line: 1, column: 22 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
        {
          /** 单引号值后孤立 /：按顺序在 23 报 UNEXPECTED_SOLIDUS_IN_TAG、24 报 EOF_IN_TAG、0 报 template 未闭合。 */
          code: "<template><div id='abc'/",
          errors: [
            {
              type: ErrorCodes.UNEXPECTED_SOLIDUS_IN_TAG,
              loc: { offset: 23, line: 1, column: 24 },
            },
            {
              type: ErrorCodes.EOF_IN_TAG,
              loc: { offset: 24, line: 1, column: 25 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
        {
          /** 双引号值后孤立 /：错误顺序及位置为意外斜杠 23、EOF 24、template 未闭合 0。 */
          code: '<template><div id="abc"/',
          errors: [
            {
              type: ErrorCodes.UNEXPECTED_SOLIDUS_IN_TAG,
              loc: { offset: 23, line: 1, column: 24 },
            },
            {
              type: ErrorCodes.EOF_IN_TAG,
              loc: { offset: 24, line: 1, column: 25 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
        {
          /** 无引号值后空格使 / 成为自闭合候选：缺 >，在 22 报意外斜杠、23 报 EOF_IN_TAG、0 报 template 未闭合。 */
          code: '<template><div id=abc /',
          errors: [
            {
              type: ErrorCodes.UNEXPECTED_SOLIDUS_IN_TAG,
              loc: { offset: 22, line: 1, column: 23 },
            },
            {
              type: ErrorCodes.EOF_IN_TAG,
              loc: { offset: 23, line: 1, column: 24 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
        {
          /** </div 缺 >，闭标签回调未触发：终点 10 报 EOF_IN_TAG，再在 0 报 div 未闭合。 */
          code: '<div></div',
          errors: [
            {
              type: ErrorCodes.EOF_IN_TAG,
              loc: { offset: 10, line: 1, column: 11 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
      ],
      // INCORRECTLY_CLOSED_COMMENT: [
      //   {
      //     code: '<template><!--comment--!></template>',
      //     errors: [
      //       {
      //         type: ErrorCodes.INCORRECTLY_CLOSED_COMMENT,
      //         loc: { offset: 10, line: 1, column: 11 }
      //       }
      //     ]
      //   }
      // ],
      // INCORRECTLY_OPENED_COMMENT: [
      //   {
      //     code: '<template><!></template>',
      //     errors: [
      //       {
      //         type: ErrorCodes.INCORRECTLY_OPENED_COMMENT,
      //         loc: { offset: 10, line: 1, column: 11 }
      //       }
      //     ]
      //   },
      //   {
      //     code: '<template><!-></template>',
      //     errors: [
      //       {
      //         type: ErrorCodes.INCORRECTLY_OPENED_COMMENT,
      //         loc: { offset: 10, line: 1, column: 11 }
      //       }
      //     ]
      //   },
      //   {
      //     code: '<template><!ELEMENT br EMPTY></template>',
      //     errors: [
      //       {
      //         type: ErrorCodes.INCORRECTLY_OPENED_COMMENT,
      //         loc: { offset: 10, line: 1, column: 11 }
      //       }
      //     ]
      //   },
      //   // doctype 直接忽略，不生成模板 AST 节点。
      //   {
      //     code: '<!DOCTYPE html>',
      //     errors: []
      //   }
      // ],
      // INVALID_FIRST_CHARACTER_OF_TAG_NAME: [
      //   {
      //     code: '<template>a < b</template>',
      //     errors: [
      //       {
      //         type: ErrorCodes.INVALID_FIRST_CHARACTER_OF_TAG_NAME,
      //         loc: { offset: 13, line: 1, column: 14 }
      //       }
      //     ]
      //   },
      //   {
      //     code: '<template><�></template>',
      //     errors: [
      //       {
      //         type: ErrorCodes.INVALID_FIRST_CHARACTER_OF_TAG_NAME,
      //         loc: { offset: 11, line: 1, column: 12 }
      //       }
      //     ]
      //   },
      //   {
      //     code: '<template>a </ b</template>',
      //     errors: [
      //       {
      //         type: ErrorCodes.INVALID_FIRST_CHARACTER_OF_TAG_NAME,
      //         loc: { offset: 14, line: 1, column: 15 }
      //       },
      //       {
      //         type: ErrorCodes.X_MISSING_END_TAG,
      //         loc: { offset: 0, line: 1, column: 1 }
      //       }
      //     ]
      //   },
      //   {
      //     code: '<template></�></template>',
      //     errors: [
      //       {
      //         type: ErrorCodes.INVALID_FIRST_CHARACTER_OF_TAG_NAME,
      //         loc: { offset: 12, line: 1, column: 13 }
      //       }
      //     ]
      //   },
      //   // 插值中的 `<` 属于 JS 运算符，不报告标签名首字符错误。
      //   {
      //     code: '<template>{{a < b}}</template>',
      //     errors: []
      //   }
      // ],
      MISSING_ATTRIBUTE_VALUE: [
        {
          /** id= 后直接 >，产生空无引号值；onattribend 在 18 报 MISSING_ATTRIBUTE_VALUE，标签仍正常关闭。 */
          code: '<template><div id=></div></template>',
          errors: [
            {
              type: ErrorCodes.MISSING_ATTRIBUTE_VALUE,
              loc: { offset: 18, line: 1, column: 19 },
            },
          ],
        },
        {
          /** id= 后空格再 >，空值诊断随终止字符移到 19，只预期 MISSING_ATTRIBUTE_VALUE。 */
          code: '<template><div id= ></div></template>',
          errors: [
            {
              type: ErrorCodes.MISSING_ATTRIBUTE_VALUE,
              loc: { offset: 19, line: 1, column: 20 },
            },
          ],
        },
        {
          /** id= 后空格再 /> 的 / 属于无引号值，不是自闭合符；后续 </div> 正常匹配，errors 为空。 */
          code: '<template><div id= /></div></template>',
          errors: [],
        },
      ],
      MISSING_END_TAG_NAME: [
        {
          /** 空闭标签 </> 在 > 的 offset 12 报 MISSING_END_TAG_NAME，外层 template 正常闭合。 */
          code: '<template></></template>',
          errors: [
            {
              type: ErrorCodes.MISSING_END_TAG_NAME,
              loc: { offset: 12, line: 1, column: 13 },
            },
          ],
        },
      ],
      // MISSING_WHITESPACE_BETWEEN_ATTRIBUTES: [
      //   {
      //     code: '<template><div id="foo"class="bar"></div></template>',
      //     errors: [
      //       {
      //         type: ErrorCodes.MISSING_WHITESPACE_BETWEEN_ATTRIBUTES,
      //         loc: { offset: 23, line: 1, column: 24 }
      //       }
      //     ]
      //   },
      //   // 本组已停用；当前 tokenizer 直接接收源码，CR 属于 HTML 空白但行号只按 LF 统计。
      //   // https://html.spec.whatwg.org/multipage/parsing.html#preprocessing-the-input-stream
      //   {
      //     code: '<template><div id="foo"\r\nclass="bar"></div></template>',
      //     errors: []
      //   }
      // ],
      // NESTED_COMMENT: [
      //   {
      //     code: '<template><!--a<!--b--></template>',
      //     errors: [
      //       {
      //         type: ErrorCodes.NESTED_COMMENT,
      //         loc: { offset: 15, line: 1, column: 16 }
      //       }
      //     ]
      //   },
      //   {
      //     code: '<template><!--a<!--b<!--c--></template>',
      //     errors: [
      //       {
      //         type: ErrorCodes.NESTED_COMMENT,
      //         loc: { offset: 15, line: 1, column: 16 }
      //       },
      //       {
      //         type: ErrorCodes.NESTED_COMMENT,
      //         loc: { offset: 20, line: 1, column: 21 }
      //       }
      //     ]
      //   },
      //   {
      //     code: '<template><!--a<!--b<!----></template>',
      //     errors: [
      //       {
      //         type: ErrorCodes.NESTED_COMMENT,
      //         loc: { offset: 15, line: 1, column: 16 }
      //       }
      //     ]
      //   },
      //   {
      //     code: '<template><!--a<!--></template>',
      //     errors: []
      //   },
      //   {
      //     code: '<template><!--a<!--',
      //     errors: [
      //       {
      //         type: ErrorCodes.EOF_IN_COMMENT,
      //         loc: { offset: 19, line: 1, column: 20 }
      //       },
      //       {
      //         type: ErrorCodes.X_MISSING_END_TAG,
      //         loc: { offset: 0, line: 1, column: 1 }
      //       }
      //     ]
      //   }
      // ],
      UNEXPECTED_CHARACTER_IN_ATTRIBUTE_NAME: [
        {
          /** 属性名 a"bc 含双引号，在 16 报 UNEXPECTED_CHARACTER_IN_ATTRIBUTE_NAME，扫描继续。 */
          code: "<template><div a\"bc=''></div></template>",
          errors: [
            {
              type: ErrorCodes.UNEXPECTED_CHARACTER_IN_ATTRIBUTE_NAME,
              loc: { offset: 16, line: 1, column: 17 },
            },
          ],
        },
        {
          /** 属性名含单引号，在 16 报 UNEXPECTED_CHARACTER_IN_ATTRIBUTE_NAME，后续值仍正常读取。 */
          code: "<template><div a'bc=''></div></template>",
          errors: [
            {
              type: ErrorCodes.UNEXPECTED_CHARACTER_IN_ATTRIBUTE_NAME,
              loc: { offset: 16, line: 1, column: 17 },
            },
          ],
        },
        {
          /** 属性名 a<bc 含 <，在 16 报非法属性字符，不把它当成新标签。 */
          code: "<template><div a<bc=''></div></template>",
          errors: [
            {
              type: ErrorCodes.UNEXPECTED_CHARACTER_IN_ATTRIBUTE_NAME,
              loc: { offset: 16, line: 1, column: 17 },
            },
          ],
        },
      ],
      UNEXPECTED_CHARACTER_IN_UNQUOTED_ATTRIBUTE_VALUE: [
        {
          /** 无引号值 bar 后双引号在 22 报 UNEXPECTED_CHARACTER_IN_UNQUOTED_ATTRIBUTE_VALUE，继续到 >。 */
          code: '<template><div foo=bar"></div></template>',
          errors: [
            {
              type: ErrorCodes.UNEXPECTED_CHARACTER_IN_UNQUOTED_ATTRIBUTE_VALUE,
              loc: { offset: 22, line: 1, column: 23 },
            },
          ],
        },
        {
          /** 无引号值 bar 后单引号同样在 22 报非法值字符，不启动引号模式。 */
          code: "<template><div foo=bar'></div></template>",
          errors: [
            {
              type: ErrorCodes.UNEXPECTED_CHARACTER_IN_UNQUOTED_ATTRIBUTE_VALUE,
              loc: { offset: 22, line: 1, column: 23 },
            },
          ],
        },
        {
          /** 无引号值 bar 后 <div 的 < 在 22 报非法值字符，其余文字仍属于属性。 */
          code: '<template><div foo=bar<div></div></template>',
          errors: [
            {
              type: ErrorCodes.UNEXPECTED_CHARACTER_IN_UNQUOTED_ATTRIBUTE_VALUE,
              loc: { offset: 22, line: 1, column: 23 },
            },
          ],
        },
        {
          /** 无引号值 bar=baz 的第二个 = 在 22 报非法值字符，不作为新属性赋值。 */
          code: '<template><div foo=bar=baz></div></template>',
          errors: [
            {
              type: ErrorCodes.UNEXPECTED_CHARACTER_IN_UNQUOTED_ATTRIBUTE_VALUE,
              loc: { offset: 22, line: 1, column: 23 },
            },
          ],
        },
        {
          /** 无引号值 bar 后反引号在 22 报非法值字符，不属于受支持的引号。 */
          code: '<template><div foo=bar`></div></template>',
          errors: [
            {
              type: ErrorCodes.UNEXPECTED_CHARACTER_IN_UNQUOTED_ATTRIBUTE_VALUE,
              loc: { offset: 22, line: 1, column: 23 },
            },
          ],
        },
      ],
      UNEXPECTED_EQUALS_SIGN_BEFORE_ATTRIBUTE_NAME: [
        {
          /** 属性区以 =foo=bar 开始，在 15 报 UNEXPECTED_EQUALS_SIGN_BEFORE_ATTRIBUTE_NAME，恢复扫描。 */
          code: '<template><div =foo=bar></div></template>',
          errors: [
            {
              type: ErrorCodes.UNEXPECTED_EQUALS_SIGN_BEFORE_ATTRIBUTE_NAME,
              loc: { offset: 15, line: 1, column: 16 },
            },
          ],
        },
        {
          /** 属性区只有 =>，在 15 报意外等号，> 仍完成开标签，没有附加空属性值诊断。 */
          code: '<template><div =></div></template>',
          errors: [
            {
              type: ErrorCodes.UNEXPECTED_EQUALS_SIGN_BEFORE_ATTRIBUTE_NAME,
              loc: { offset: 15, line: 1, column: 16 },
            },
          ],
        },
      ],
      UNEXPECTED_QUESTION_MARK_INSTEAD_OF_TAG_NAME: [
        {
          /** HTML 的 <?xml?> 触发 processing instruction，在 ? 的 offset 11 报错，不保留运行时节点。 */
          code: '<template><?xml?></template>',
          errors: [
            {
              type: ErrorCodes.UNEXPECTED_QUESTION_MARK_INSTEAD_OF_TAG_NAME,
              loc: { offset: 11, line: 1, column: 12 },
            },
          ],
        },
      ],
      UNEXPECTED_SOLIDUS_IN_TAG: [
        {
          /** 属性 a/b 的 / 后不是 >，在 16 报 UNEXPECTED_SOLIDUS_IN_TAG，随后按属性区扫描 b。 */
          code: '<template><div a/b></div></template>',
          errors: [
            {
              type: ErrorCodes.UNEXPECTED_SOLIDUS_IN_TAG,
              loc: { offset: 16, line: 1, column: 17 },
            },
          ],
        },
      ],
      X_INVALID_END_TAG: [
        {
          /** 栈中只有 template 时遇到 </div>，在闭标签 < 的 offset 10 报 X_INVALID_END_TAG。 */
          code: '<template></div></template>',
          errors: [
            {
              type: ErrorCodes.X_INVALID_END_TAG,
              loc: { offset: 10, line: 1, column: 11 },
            },
          ],
        },
        {
          /** 连续两次无匹配 </div> 在 10/16 顺序报告 X_INVALID_END_TAG。 */
          code: '<template></div></div></template>',
          errors: [
            {
              type: ErrorCodes.X_INVALID_END_TAG,
              loc: { offset: 10, line: 1, column: 11 },
            },
            {
              type: ErrorCodes.X_INVALID_END_TAG,
              loc: { offset: 16, line: 1, column: 17 },
            },
          ],
        },
        {
          /** 残缺 </ b</template> 被读作无匹配闭标签，在 12 报无效闭标签；真正 template 关闭被吞入片段，EOF 再在 0 报未闭合。 */
          code: '<template>a </ b</template>',
          errors: [
            {
              type: ErrorCodes.X_INVALID_END_TAG,
              loc: { offset: 12, line: 1, column: 13 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
        {
          /** 插值内字符串 </div> 不查开放栈，由插值状态消费，errors 为空。 */
          code: "<template>{{'</div>'}}</template>",
          errors: [],
        },
        {
          /** HTML textarea 中 </div> 是 RCDATA 正文，只识别 </textarea>，errors 为空。 */
          code: '<textarea></div></textarea>',
          errors: [],
        },
        {
          /** SVG CDATA 中 </div> 是正文，仅追加 Text，不触发闭标签事件，errors 为空。 */
          code: '<svg><![CDATA[</div>]]></svg>',
          errors: [],
        },
        {
          /** SVG 注释内 </div> 是 Comment 正文，不触发闭标签事件，errors 为空。 */
          code: '<svg><!--</div>--></svg>',
          errors: [],
        },
      ],
      X_MISSING_END_TAG: [
        {
          /** 祖先 </template> 跨过 div，先在 10 报 div 的 X_MISSING_END_TAG，再隐式关闭 div、正常关闭 template。 */
          code: '<template><div></template>',
          errors: [
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 10, line: 1, column: 11 },
            },
          ],
        },
        {
          /** EOF 栈内还有 div/template，按最近父优先顺序在 10/0 报两条 X_MISSING_END_TAG。 */
          code: '<template><div>',
          errors: [
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 10, line: 1, column: 11 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
      ],
      X_MISSING_INTERPOLATION_END: [
        {
          /** 根 {{ foo 未结束，在插值 sectionStart=0 报 X_MISSING_INTERPOLATION_END。 */
          code: '{{ foo',
          errors: [
            {
              type: ErrorCodes.X_MISSING_INTERPOLATION_END,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
        {
          /** 仅有 {{ 起始定界符也未完成，仍在 0 报 X_MISSING_INTERPOLATION_END。 */
          code: '{{',
          errors: [
            {
              type: ErrorCodes.X_MISSING_INTERPOLATION_END,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
        {
          /** div 内未闭合插值吞入 </div>：先在 5 报插值缺结束，再在 0 报 div 缺结束标签。 */
          code: '<div>{{ foo</div>',
          errors: [
            {
              type: ErrorCodes.X_MISSING_INTERPOLATION_END,
              loc: { offset: 5, line: 1, column: 6 },
            },
            {
              type: ErrorCodes.X_MISSING_END_TAG,
              loc: { offset: 0, line: 1, column: 1 },
            },
          ],
        },
        {
          /** 完整 {{}} 未开 prefixIdentifiers 预解析，不在 parser 阶段诊断空表达式，errors 为空。 */
          code: '{{}}',
          errors: [],
        },
      ],
      X_MISSING_DYNAMIC_DIRECTIVE_ARGUMENT_END: [
        {
          /** 动态参数 [sef fsef] 在中间空格就结束片段，offset 15 报 X_MISSING_DYNAMIC_DIRECTIVE_ARGUMENT_END。 */
          code: `<div v-foo:[sef fsef] />`,
          errors: [
            {
              type: ErrorCodes.X_MISSING_DYNAMIC_DIRECTIVE_ARGUMENT_END,
              loc: { offset: 15, line: 1, column: 16 },
            },
          ],
        },
      ],
    }

    // 每个错误码用多组源码/选项驱动同一断言，既锁定是否报错，也锁定精确 offset/行列。
    for (const key of Object.keys(patterns)) {
      describe(key, () => {
        for (const { code, errors, options } of patterns[key]) {
          /**
           * 每个启用 fixture 分别注册测试，code 的 CR/LF 仅在标题中转成转义串，真实输入不变。
           * 返回型 spy 收集多条诊断，比较错误码与 loc.start 的有序列表，再核对恢复 AST
           * 快照；options 在 HTML/namespace 默认值之后，可覆盖它们。
           */
          test(
            code.replace(
              /[\r\n]/g,
              c => `\\x0${c.codePointAt(0)!.toString(16)};`,
            ),
            () => {
              const spy = vi.fn()
              const ast = baseParse(code, {
                parseMode: 'html',
                getNamespace: tag =>
                  tag === 'svg' ? Namespaces.SVG : Namespaces.HTML,
                ...options,
                onError: spy,
              })

              expect(
                spy.mock.calls.map(([err]) => ({
                  type: err.code,
                  loc: err.loc.start,
                })),
              ).toMatchObject(errors)
              expect(ast).toMatchSnapshot()
            },
          )
        }
      })
    }
  })
})
