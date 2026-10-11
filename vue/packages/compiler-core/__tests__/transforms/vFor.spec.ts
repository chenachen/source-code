/**
 * `v-for` 场景：分别验证表达式拆分、别名作用域、源码位置、错误诊断和 renderList/Fragment
 * 代码生成，并覆盖 template、key、常量来源与嵌套循环对 block 稳定性的影响。
 */
import { baseParse as parse } from '../../src/parser'
import { transform } from '../../src/transform'
import { transformIf } from '../../src/transforms/vIf'
import { transformFor } from '../../src/transforms/vFor'
import { transformBind } from '../../src/transforms/vBind'
import { transformElement } from '../../src/transforms/transformElement'
import { transformSlotOutlet } from '../../src/transforms/transformSlotOutlet'
import { transformExpression } from '../../src/transforms/transformExpression'
import {
  ConstantTypes,
  type ElementNode,
  type ForCodegenNode,
  type ForNode,
  type InterpolationNode,
  NodeTypes,
  type RootNode,
  type SimpleExpressionNode,
} from '../../src/ast'
import { ErrorCodes } from '../../src/errors'
import { type CompilerOptions, generate } from '../../src'
import { FRAGMENT, RENDER_LIST, RENDER_SLOT } from '../../src/runtimeHelpers'
import { PatchFlags } from '@vue/shared'
import { createObjectMatcher } from '../testUtils'
import { transformVBindShorthand } from '../../src/transforms/transformVBindShorthand'

/**
 * 运行简写、if、for、可选表达式、slot outlet 和元素转换，并注册 bind 转换。
 * 返回根及首 child；正常循环用类型断言读取 ForNode，外层普通元素/if 或错误恢复场景实际可能是其他节点。
 */
export function parseWithForTransform(
  template: string,
  options: CompilerOptions = {},
): {
  /** 完整转换根节点。 */
  root: RootNode
  /** 首 child 的循环场景类型视图；不保证所有错误/组合场景实际都是 ForNode。 */
  node: ForNode & {
    /** `renderList` Fragment 代码生成节点。 */
    codegenNode: ForCodegenNode
  }
} {
  const ast = parse(template, options)
  transform(ast, {
    nodeTransforms: [
      transformVBindShorthand,
      transformIf,
      transformFor,
      ...(options.prefixIdentifiers ? [transformExpression] : []),
      transformSlotOutlet,
      transformElement,
    ],
    directiveTransforms: {
      bind: transformBind,
    },
    ...options,
  })
  return {
    root: ast,
    node: ast.children[0] as ForNode & {
      /** 正常循环转换后期望存在的 Fragment；错误恢复或外层 if 场景未必符合此类型。 */
      codegenNode: ForCodegenNode
    },
  }
}

describe('compiler: v-for', () => {
  // AST 转换：将指令元素替换为 ForNode，并登记/撤销 value、key、index 局部作用域。
  describe('transform', () => {
    /**
     * span 的 v-for 输入 index in 5；检查拆分后的 source 为 5，value='index'、key 为 undefined、index 为 undefined。解析器去除外层参数括号与边缘空白，保留解构/数据源内部文本和被省略的参数位置。
     */
    test('number expression', () => {
      const { node: forNode } = parseWithForTransform(
        '<span v-for="index in 5" />',
      )
      expect(forNode.keyAlias).toBeUndefined()
      expect(forNode.objectIndexAlias).toBeUndefined()
      expect((forNode.valueAlias as SimpleExpressionNode).content).toBe('index')
      expect((forNode.source as SimpleExpressionNode).content).toBe('5')
    })

    /**
     * span 的 v-for 输入 (item) in items；检查拆分后的 source 为 items，value='item'、key 为 undefined、index 为 undefined。解析器去除外层参数括号与边缘空白，保留解构/数据源内部文本和被省略的参数位置。
     */
    test('value', () => {
      const { node: forNode } = parseWithForTransform(
        '<span v-for="(item) in items" />',
      )
      expect(forNode.keyAlias).toBeUndefined()
      expect(forNode.objectIndexAlias).toBeUndefined()
      expect((forNode.valueAlias as SimpleExpressionNode).content).toBe('item')
      expect((forNode.source as SimpleExpressionNode).content).toBe('items')
    })

    /**
     * span 的 v-for 输入 ({ id, value }) in items；检查拆分后的 source 为 items，value='{ id, value }'、key 为 undefined、index 为 undefined。解析器去除外层参数括号与边缘空白，保留解构/数据源内部文本和被省略的参数位置。
     */
    test('object de-structured value', () => {
      const { node: forNode } = parseWithForTransform(
        '<span v-for="({ id, value }) in items" />',
      )
      expect(forNode.keyAlias).toBeUndefined()
      expect(forNode.objectIndexAlias).toBeUndefined()
      expect((forNode.valueAlias as SimpleExpressionNode).content).toBe(
        '{ id, value }',
      )
      expect((forNode.source as SimpleExpressionNode).content).toBe('items')
    })

    /**
     * span 的 v-for 输入 ([ id, value ]) in items；检查拆分后的 source 为 items，value='[ id, value ]'、key 为 undefined、index 为 undefined。解析器去除外层参数括号与边缘空白，保留解构/数据源内部文本和被省略的参数位置。
     */
    test('array de-structured value', () => {
      const { node: forNode } = parseWithForTransform(
        '<span v-for="([ id, value ]) in items" />',
      )
      expect(forNode.keyAlias).toBeUndefined()
      expect(forNode.objectIndexAlias).toBeUndefined()
      expect((forNode.valueAlias as SimpleExpressionNode).content).toBe(
        '[ id, value ]',
      )
      expect((forNode.source as SimpleExpressionNode).content).toBe('items')
    })

    /**
     * span 的 v-for 输入 (item, key) in items；检查拆分后的 source 为 items，value='item'、key='key'、index 为 undefined。解析器去除外层参数括号与边缘空白，保留解构/数据源内部文本和被省略的参数位置。
     */
    test('value and key', () => {
      const { node: forNode } = parseWithForTransform(
        '<span v-for="(item, key) in items" />',
      )
      expect(forNode.keyAlias).not.toBeUndefined()
      expect((forNode.keyAlias as SimpleExpressionNode).content).toBe('key')
      expect(forNode.objectIndexAlias).toBeUndefined()
      expect((forNode.valueAlias as SimpleExpressionNode).content).toBe('item')
      expect((forNode.source as SimpleExpressionNode).content).toBe('items')
    })

    /**
     * span 的 v-for 输入 (value, key, index) in items；检查拆分后的 source 为 items，value='value'、key='key'、index='index'。解析器去除外层参数括号与边缘空白，保留解构/数据源内部文本和被省略的参数位置。
     */
    test('value, key and index', () => {
      const { node: forNode } = parseWithForTransform(
        '<span v-for="(value, key, index) in items" />',
      )
      expect(forNode.keyAlias).not.toBeUndefined()
      expect((forNode.keyAlias as SimpleExpressionNode).content).toBe('key')
      expect(forNode.objectIndexAlias).not.toBeUndefined()
      expect((forNode.objectIndexAlias as SimpleExpressionNode).content).toBe(
        'index',
      )
      expect((forNode.valueAlias as SimpleExpressionNode).content).toBe('value')
      expect((forNode.source as SimpleExpressionNode).content).toBe('items')
    })

    /**
     * span 的 v-for 输入 (value,,index) in items；检查拆分后的 source 为 items，value='value'、key 为 undefined、index='index'。解析器去除外层参数括号与边缘空白，保留解构/数据源内部文本和被省略的参数位置。
     */
    test('skipped key', () => {
      const { node: forNode } = parseWithForTransform(
        '<span v-for="(value,,index) in items" />',
      )
      expect(forNode.keyAlias).toBeUndefined()
      expect(forNode.objectIndexAlias).not.toBeUndefined()
      expect((forNode.objectIndexAlias as SimpleExpressionNode).content).toBe(
        'index',
      )
      expect((forNode.valueAlias as SimpleExpressionNode).content).toBe('value')
      expect((forNode.source as SimpleExpressionNode).content).toBe('items')
    })

    /**
     * span 的 v-for 输入 (,,index) in items；检查拆分后的 source 为 items，value 为 undefined、key 为 undefined、index='index'。解析器去除外层参数括号与边缘空白，保留解构/数据源内部文本和被省略的参数位置。
     */
    test('skipped value and key', () => {
      const { node: forNode } = parseWithForTransform(
        '<span v-for="(,,index) in items" />',
      )
      expect(forNode.keyAlias).toBeUndefined()
      expect(forNode.objectIndexAlias).not.toBeUndefined()
      expect((forNode.objectIndexAlias as SimpleExpressionNode).content).toBe(
        'index',
      )
      expect(forNode.valueAlias).toBeUndefined()
      expect((forNode.source as SimpleExpressionNode).content).toBe('items')
    })

    /**
     * span 的 v-for 输入 item in items；检查拆分后的 source 为 items，value='item'、key 为 undefined、index 为 undefined。解析器去除外层参数括号与边缘空白，保留解构/数据源内部文本和被省略的参数位置。
     */
    test('unbracketed value', () => {
      const { node: forNode } = parseWithForTransform(
        '<span v-for="item in items" />',
      )
      expect(forNode.keyAlias).toBeUndefined()
      expect(forNode.objectIndexAlias).toBeUndefined()
      expect((forNode.valueAlias as SimpleExpressionNode).content).toBe('item')
      expect((forNode.source as SimpleExpressionNode).content).toBe('items')
    })

    /**
     * span 的 v-for 输入 item, key in items；检查拆分后的 source 为 items，value='item'、key='key'、index 为 undefined。解析器去除外层参数括号与边缘空白，保留解构/数据源内部文本和被省略的参数位置。
     */
    test('unbracketed value and key', () => {
      const { node: forNode } = parseWithForTransform(
        '<span v-for="item, key in items" />',
      )
      expect(forNode.keyAlias).not.toBeUndefined()
      expect((forNode.keyAlias as SimpleExpressionNode).content).toBe('key')
      expect(forNode.objectIndexAlias).toBeUndefined()
      expect((forNode.valueAlias as SimpleExpressionNode).content).toBe('item')
      expect((forNode.source as SimpleExpressionNode).content).toBe('items')
    })

    /**
     * span 的 v-for 输入 value, key, index in items；检查拆分后的 source 为 items，value='value'、key='key'、index='index'。解析器去除外层参数括号与边缘空白，保留解构/数据源内部文本和被省略的参数位置。
     */
    test('unbracketed value, key and index', () => {
      const { node: forNode } = parseWithForTransform(
        '<span v-for="value, key, index in items" />',
      )
      expect(forNode.keyAlias).not.toBeUndefined()
      expect((forNode.keyAlias as SimpleExpressionNode).content).toBe('key')
      expect(forNode.objectIndexAlias).not.toBeUndefined()
      expect((forNode.objectIndexAlias as SimpleExpressionNode).content).toBe(
        'index',
      )
      expect((forNode.valueAlias as SimpleExpressionNode).content).toBe('value')
      expect((forNode.source as SimpleExpressionNode).content).toBe('items')
    })

    /**
     * span 的 v-for 输入 value, , index in items；检查拆分后的 source 为 items，value='value'、key 为 undefined、index='index'。解析器去除外层参数括号与边缘空白，保留解构/数据源内部文本和被省略的参数位置。
     */
    test('unbracketed skipped key', () => {
      const { node: forNode } = parseWithForTransform(
        '<span v-for="value, , index in items" />',
      )
      expect(forNode.keyAlias).toBeUndefined()
      expect(forNode.objectIndexAlias).not.toBeUndefined()
      expect((forNode.objectIndexAlias as SimpleExpressionNode).content).toBe(
        'index',
      )
      expect((forNode.valueAlias as SimpleExpressionNode).content).toBe('value')
      expect((forNode.source as SimpleExpressionNode).content).toBe('items')
    })

    /**
     * span 的 v-for 输入 , , index in items；检查拆分后的 source 为 items，value 为 undefined、key 为 undefined、index='index'。解析器去除外层参数括号与边缘空白，保留解构/数据源内部文本和被省略的参数位置。
     */
    test('unbracketed skipped value and key', () => {
      const { node: forNode } = parseWithForTransform(
        '<span v-for=", , index in items" />',
      )
      expect(forNode.keyAlias).toBeUndefined()
      expect(forNode.objectIndexAlias).not.toBeUndefined()
      expect((forNode.objectIndexAlias as SimpleExpressionNode).content).toBe(
        'index',
      )
      expect(forNode.valueAlias).toBeUndefined()
      expect((forNode.source as SimpleExpressionNode).content).toBe('items')
    })

    /**
     * span 的 v-for 输入 item in state ['my items']；检查拆分后的 source 为 state ['my items']，value='item'、key 为 undefined、index 为 undefined。解析器去除外层参数括号与边缘空白，保留解构/数据源内部文本和被省略的参数位置。
     */
    test('source containing string expression with spaces', () => {
      const { node: forNode } = parseWithForTransform(
        `<span v-for="item in state ['my items']" />`,
      )
      expect(forNode.keyAlias).toBeUndefined()
      expect(forNode.objectIndexAlias).toBeUndefined()
      expect((forNode.valueAlias as SimpleExpressionNode).content).toBe('item')
      expect((forNode.source as SimpleExpressionNode).content).toBe(
        "state ['my items']",
      )
    })
  })

  // 错误场景：空/畸形表达式及 template key 错位必须给出精确诊断。
  describe('errors', () => {
    /**
     * 输入裸 v-for 并收集诊断；检查只报一次缺失表达式错误，尚无 exp 的指令不建立循环结构。
     */
    test('missing expression', () => {
      const onError = vi.fn()
      parseWithForTransform('<span v-for />', { onError })

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: ErrorCodes.X_V_FOR_NO_EXPRESSION,
        }),
      )
    })

    /**
     * 输入 v-for=""；检查一次畸形表达式错误，空串无法拆成别名与来源。
     */
    test('empty expression', () => {
      const onError = vi.fn()
      parseWithForTransform('<span v-for="" />', { onError })

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: ErrorCodes.X_V_FOR_MALFORMED_EXPRESSION,
        }),
      )
    })

    /**
     * 表达式只有 items，没有 in/of 分隔；检查畸形表达式诊断，不把整个文本误当数据源。
     */
    test('invalid expression', () => {
      const onError = vi.fn()
      parseWithForTransform('<span v-for="items" />', { onError })

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: ErrorCodes.X_V_FOR_MALFORMED_EXPRESSION,
        }),
      )
    })

    /**
     * 表达式为 item in，右侧完全缺失；检查畸形表达式诊断，循环必须有来源。
     */
    test('missing source', () => {
      const onError = vi.fn()
      parseWithForTransform('<span v-for="item in" />', { onError })

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: ErrorCodes.X_V_FOR_MALFORMED_EXPRESSION,
        }),
      )
    })

    /**
     * 表达式为 item in 后接多个空格；检查仍为来源缺失诊断，空白不能满足数据源匹配。
     */
    test('missing source and have multiple spaces with', () => {
      const onError = vi.fn()
      parseWithForTransform('<span v-for="item in  " />', { onError })

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: ErrorCodes.X_V_FOR_MALFORMED_EXPRESSION,
        }),
      )
    })

    /**
     * 表达式为 in items，左侧别名缺失；检查畸形表达式诊断，参数区不能完全空缺。
     */
    test('missing value', () => {
      const onError = vi.fn()
      parseWithForTransform('<span v-for="in items" />', { onError })

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: ErrorCodes.X_V_FOR_MALFORMED_EXPRESSION,
        }),
      )
    })

    /**
     * 先把 key 写在 template for 的直接 div child 上，检查错位诊断；再给 child 自身添加嵌套 for，检查调用次数不增加。内层 ForNode 的 key 属于内层列表。
     */
    test('<template v-for> key placement', () => {
      const onError = vi.fn()
      parseWithForTransform(
        `
      <template v-for="item in items">
        <div :key="item.id"/>
      </template>`,
        { onError },
      )

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: ErrorCodes.X_V_FOR_TEMPLATE_KEY_PLACEMENT,
        }),
      )

      // 子元素自身带 v-for 后已变成 ForNode，外层 template 的直接元素 key 检查不应把它误报为错位。
      parseWithForTransform(
        `
      <template v-for="item in items">
        <div v-for="c in item.children" :key="c.id"/>
      </template>`,
        { onError },
      )
      expect(onError).toHaveBeenCalledTimes(1)
    })
  })

  // 位置场景：拆分出的 source/value/key/index 均应指向原 `v-for` 属性内的准确切片。
  describe('source location', () => {
    /**
     * 输入 item in items；逐项检查 value/source 的 offset、行列和结束列，位置分别覆盖属性中的 item 与 items，采用左闭右开切片。
     */
    test('value & source', () => {
      const source = '<span v-for="item in items" />'
      const { node: forNode } = parseWithForTransform(source)

      const itemOffset = source.indexOf('item')
      const value = forNode.valueAlias as SimpleExpressionNode
      expect((forNode.valueAlias as SimpleExpressionNode).content).toBe('item')
      expect(value.loc.start.offset).toBe(itemOffset)
      expect(value.loc.start.line).toBe(1)
      expect(value.loc.start.column).toBe(itemOffset + 1)
      expect(value.loc.end.line).toBe(1)
      expect(value.loc.end.column).toBe(itemOffset + 1 + `item`.length)

      const itemsOffset = source.indexOf('items')
      expect((forNode.source as SimpleExpressionNode).content).toBe('items')
      expect(forNode.source.loc.start.offset).toBe(itemsOffset)
      expect(forNode.source.loc.start.line).toBe(1)
      expect(forNode.source.loc.start.column).toBe(itemsOffset + 1)
      expect(forNode.source.loc.end.line).toBe(1)
      expect(forNode.source.loc.end.column).toBe(
        itemsOffset + 1 + `items`.length,
      )
    })

    /**
     * 输入带空格的 ( item ) in items；检查别名 loc 只覆盖 item，排除外层括号与边缘空白，数据源 loc 仍准确。
     */
    test('bracketed value', () => {
      const source = '<span v-for="( item ) in items" />'
      const { node: forNode } = parseWithForTransform(source)

      const itemOffset = source.indexOf('item')
      const value = forNode.valueAlias as SimpleExpressionNode
      expect(value.content).toBe('item')
      expect(value.loc.start.offset).toBe(itemOffset)
      expect(value.loc.start.line).toBe(1)
      expect(value.loc.start.column).toBe(itemOffset + 1)
      expect(value.loc.end.line).toBe(1)
      expect(value.loc.end.column).toBe(itemOffset + 1 + `item`.length)

      const itemsOffset = source.indexOf('items')
      expect((forNode.source as SimpleExpressionNode).content).toBe('items')
      expect(forNode.source.loc.start.offset).toBe(itemsOffset)
      expect(forNode.source.loc.start.line).toBe(1)
      expect(forNode.source.loc.start.column).toBe(itemsOffset + 1)
      expect(forNode.source.loc.end.line).toBe(1)
      expect(forNode.source.loc.end.column).toBe(
        itemsOffset + 1 + `items`.length,
      )
    })

    /**
     * 输入带前导空格的 ({ id, key }) 解构参数；检查 value loc 覆盖完整对象模式，source loc 独立覆盖 items。
     */
    test('de-structured value', () => {
      const source = '<span v-for="(  { id, key }) in items" />'
      const { node: forNode } = parseWithForTransform(source)

      const value = forNode.valueAlias as SimpleExpressionNode
      const valueIndex = source.indexOf('{ id, key }')
      expect(value.content).toBe('{ id, key }')
      expect(value.loc.start.offset).toBe(valueIndex)
      expect(value.loc.start.line).toBe(1)
      expect(value.loc.start.column).toBe(valueIndex + 1)
      expect(value.loc.end.line).toBe(1)
      expect(value.loc.end.column).toBe(valueIndex + 1 + '{ id, key }'.length)

      const itemsOffset = source.indexOf('items')
      expect((forNode.source as SimpleExpressionNode).content).toBe('items')
      expect(forNode.source.loc.start.offset).toBe(itemsOffset)
      expect(forNode.source.loc.start.line).toBe(1)
      expect(forNode.source.loc.start.column).toBe(itemsOffset + 1)
      expect(forNode.source.loc.end.line).toBe(1)
      expect(forNode.source.loc.end.column).toBe(
        itemsOffset + 1 + `items`.length,
      )
    })

    /**
     * 输入 ( item, key, index ) 三别名；检查三项与 source 的独立 offset/行列，逗号和括号不属于各表达式范围。
     */
    test('bracketed value, key, index', () => {
      const source = '<span v-for="( item, key, index ) in items" />'
      const { node: forNode } = parseWithForTransform(source)

      const itemOffset = source.indexOf('item')
      const value = forNode.valueAlias as SimpleExpressionNode
      expect(value.content).toBe('item')
      expect(value.loc.start.offset).toBe(itemOffset)
      expect(value.loc.start.line).toBe(1)
      expect(value.loc.start.column).toBe(itemOffset + 1)
      expect(value.loc.end.line).toBe(1)
      expect(value.loc.end.column).toBe(itemOffset + 1 + `item`.length)

      const keyOffset = source.indexOf('key')
      const key = forNode.keyAlias as SimpleExpressionNode
      expect(key.content).toBe('key')
      expect(key.loc.start.offset).toBe(keyOffset)
      expect(key.loc.start.line).toBe(1)
      expect(key.loc.start.column).toBe(keyOffset + 1)
      expect(key.loc.end.line).toBe(1)
      expect(key.loc.end.column).toBe(keyOffset + 1 + `key`.length)

      const indexOffset = source.indexOf('index')
      const index = forNode.objectIndexAlias as SimpleExpressionNode
      expect(index.content).toBe('index')
      expect(index.loc.start.offset).toBe(indexOffset)
      expect(index.loc.start.line).toBe(1)
      expect(index.loc.start.column).toBe(indexOffset + 1)
      expect(index.loc.end.line).toBe(1)
      expect(index.loc.end.column).toBe(indexOffset + 1 + `index`.length)

      const itemsOffset = source.indexOf('items')
      expect((forNode.source as SimpleExpressionNode).content).toBe('items')
      expect(forNode.source.loc.start.offset).toBe(itemsOffset)
      expect(forNode.source.loc.start.line).toBe(1)
      expect(forNode.source.loc.start.column).toBe(itemsOffset + 1)
      expect(forNode.source.loc.end.line).toBe(1)
      expect(forNode.source.loc.end.column).toBe(
        itemsOffset + 1 + `items`.length,
      )
    })

    /**
     * 输入 ( item,, index ) 省略 key；检查 value/index/source 的准确范围，缺失的中间项不造成 index 定位偏移。
     */
    test('skipped key', () => {
      const source = '<span v-for="( item,, index ) in items" />'
      const { node: forNode } = parseWithForTransform(source)

      const itemOffset = source.indexOf('item')
      const value = forNode.valueAlias as SimpleExpressionNode
      expect(value.content).toBe('item')
      expect(value.loc.start.offset).toBe(itemOffset)
      expect(value.loc.start.line).toBe(1)
      expect(value.loc.start.column).toBe(itemOffset + 1)
      expect(value.loc.end.line).toBe(1)
      expect(value.loc.end.column).toBe(itemOffset + 1 + `item`.length)

      const indexOffset = source.indexOf('index')
      const index = forNode.objectIndexAlias as SimpleExpressionNode
      expect(index.content).toBe('index')
      expect(index.loc.start.offset).toBe(indexOffset)
      expect(index.loc.start.line).toBe(1)
      expect(index.loc.start.column).toBe(indexOffset + 1)
      expect(index.loc.end.line).toBe(1)
      expect(index.loc.end.column).toBe(indexOffset + 1 + `index`.length)

      const itemsOffset = source.indexOf('items')
      expect((forNode.source as SimpleExpressionNode).content).toBe('items')
      expect(forNode.source.loc.start.offset).toBe(itemsOffset)
      expect(forNode.source.loc.start.line).toBe(1)
      expect(forNode.source.loc.start.column).toBe(itemsOffset + 1)
      expect(forNode.source.loc.end.line).toBe(1)
      expect(forNode.source.loc.end.column).toBe(
        itemsOffset + 1 + `items`.length,
      )
    })
  })

  // 前缀模式：只给数据源和自由变量加 `_ctx`，循环别名在自身及嵌套表达式中保持局部。
  describe('prefixIdentifiers: true', () => {
    /**
     * 开启前缀编译 i in list；检查 source 为 _ctx.list，来源在别名登记之前按外层作用域处理。
     */
    test('should prefix v-for source', () => {
      const { node } = parseWithForTransform(`<div v-for="i in list"/>`, {
        prefixIdentifiers: true,
      })
      expect(node.source).toMatchObject({
        type: NodeTypes.SIMPLE_EXPRESSION,
        content: `_ctx.list`,
      })
    })

    /**
     * 来源为 list.concat([foo]) 且开启前缀；检查 list/foo 加 _ctx，静态成员 concat 保持属性名，调用分段顺序保留。
     */
    test('should prefix v-for source w/ complex expression', () => {
      const { node } = parseWithForTransform(
        `<div v-for="i in list.concat([foo])"/>`,
        { prefixIdentifiers: true },
      )
      expect(node.source).toMatchObject({
        type: NodeTypes.COMPOUND_EXPRESSION,
        children: [
          { content: `_ctx.list` },
          `.`,
          { content: `concat` },
          `([`,
          { content: `_ctx.foo` },
          `])`,
        ],
      })
    })

    /**
     * 循环 i 的元素内分别插值 i 和 j；检查 i 保持局部别名、j 加 _ctx 前缀，作用域登记只覆盖本轮已声明名字。
     */
    test('should not prefix v-for alias', () => {
      const { node } = parseWithForTransform(
        `<div v-for="i in list">{{ i }}{{ j }}</div>`,
        { prefixIdentifiers: true },
      )
      const div = node.children[0] as ElementNode
      expect((div.children[0] as InterpolationNode).content).toMatchObject({
        type: NodeTypes.SIMPLE_EXPRESSION,
        content: `i`,
      })
      expect((div.children[1] as InterpolationNode).content).toMatchObject({
        type: NodeTypes.SIMPLE_EXPRESSION,
        content: `_ctx.j`,
      })
    })

    /**
     * 循环声明 i/j/k，内部插值 i+j+k 与 l；检查三别名保持局部，只有 l 改为 _ctx.l。
     */
    test('should not prefix v-for aliases (multiple)', () => {
      const { node } = parseWithForTransform(
        `<div v-for="(i, j, k) in list">{{ i + j + k }}{{ l }}</div>`,
        { prefixIdentifiers: true },
      )
      const div = node.children[0] as ElementNode
      expect((div.children[0] as InterpolationNode).content).toMatchObject({
        type: NodeTypes.COMPOUND_EXPRESSION,
        children: [
          { content: `i` },
          ` + `,
          { content: `j` },
          ` + `,
          { content: `k` },
        ],
      })
      expect((div.children[1] as InterpolationNode).content).toMatchObject({
        type: NodeTypes.SIMPLE_EXPRESSION,
        content: `_ctx.l`,
      })
    })

    /**
     * 同一父 div 内先有 for 的 i，再有兄弟插值 i；检查兄弟表达式为 _ctx.i，循环退出后已撤销局部计数。
     */
    test('should prefix id outside of v-for', () => {
      const { node } = parseWithForTransform(
        `<div><div v-for="i in list" />{{ i }}</div>`,
        { prefixIdentifiers: true },
      )
      expect((node.children[1] as InterpolationNode).content).toMatchObject({
        type: NodeTypes.SIMPLE_EXPRESSION,
        content: `_ctx.i`,
      })
    })

    /**
     * 内外 for 都声明 i，内层使用 i+j，退出内层后外层又插值 i；检查两处 i 仍局部、j 加前缀，同名计数不能在退出内层时删除外层绑定。
     */
    test('nested v-for', () => {
      const { node } = parseWithForTransform(
        `<div v-for="i in list">
          <div v-for="i in list">{{ i + j }}</div>{{ i }}
        </div>`,
        { prefixIdentifiers: true },
      )
      const outerDiv = node.children[0] as ElementNode
      const innerFor = outerDiv.children[0] as ForNode
      const innerExp = (innerFor.children[0] as ElementNode)
        .children[0] as InterpolationNode
      expect(innerExp.content).toMatchObject({
        type: NodeTypes.COMPOUND_EXPRESSION,
        children: [{ content: 'i' }, ` + `, { content: `_ctx.j` }],
      })

      // 内层 v-for 遮蔽外层同名变量后退出时，只减少一层计数，不能删除外层已知别名。
      const outerExp = outerDiv.children[1] as InterpolationNode
      expect(outerExp.content).toMatchObject({
        type: NodeTypes.SIMPLE_EXPRESSION,
        content: `i`,
      })
    })

    /**
     * 循环参数用对象解构和嵌套数组默认值；检查声明 foo/qux 保持局部，默认值 bar/quux 加前缀，属性名 baz 不成为局部变量，模板中的 baz 仍访问 _ctx。
     */
    test('v-for aliases w/ complex expressions', () => {
      const { node } = parseWithForTransform(
        `<div v-for="({ foo = bar, baz: [qux = quux] }) in list">
          {{ foo + bar + baz + qux + quux }}
        </div>`,
        { prefixIdentifiers: true },
      )
      expect(node.valueAlias!).toMatchObject({
        type: NodeTypes.COMPOUND_EXPRESSION,
        children: [
          `{ `,
          { content: `foo` },
          ` = `,
          { content: `_ctx.bar` },
          `, baz: [`,
          { content: `qux` },
          ` = `,
          { content: `_ctx.quux` },
          `] }`,
        ],
      })
      const div = node.children[0] as ElementNode
      expect((div.children[0] as InterpolationNode).content).toMatchObject({
        type: NodeTypes.COMPOUND_EXPRESSION,
        children: [
          { content: `foo` },
          ` + `,
          { content: `_ctx.bar` },
          ` + `,
          { content: `_ctx.baz` },
          ` + `,
          { content: `qux` },
          ` + `,
          { content: `_ctx.quux` },
        ],
      })
    })

    /**
     * 循环元素的 key 为 itemKey(item)；检查自由函数 itemKey 加 _ctx、循环 item 保持局部，key 使用当前迭代作用域。
     */
    test('element v-for key expression prefixing', () => {
      const {
        node: { codegenNode },
      } = parseWithForTransform(
        '<div v-for="item in items" :key="itemKey(item)">test</div>',
        { prefixIdentifiers: true },
      )
      const innerBlock = codegenNode.children.arguments[1].returns
      expect(innerBlock).toMatchObject({
        type: NodeTypes.VNODE_CALL,
        tag: `"div"`,
        props: createObjectMatcher({
          key: {
            type: NodeTypes.COMPOUND_EXPRESSION,
            children: [
              // 外层自由变量需要前缀化。
              { content: `_ctx.itemKey` },
              `(`,
              // 当前循环作用域内的别名不得前缀化。
              { content: `item` },
              `)`,
            ],
          },
        }),
      })
    })

    /**
     * 循环元素的 key 为简单 itemKey；检查它加 _ctx 前缀，key 本身没有声明新的别名。
     */
    test('element v-for key expression prefixing on simple expression', () => {
      const {
        node: { codegenNode },
      } = parseWithForTransform(
        '<div v-for="item in items" :key="itemKey">test</div>',
        { prefixIdentifiers: true },
      )
      const innerBlock = codegenNode.children.arguments[1].returns
      expect(innerBlock).toMatchObject({
        type: NodeTypes.VNODE_CALL,
        tag: `"div"`,
        props: createObjectMatcher({
          key: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: `_ctx.itemKey`,
          },
        }),
      })
    })

    // #2085：`<template v-for :key="foo">` 中的 key 表达式也要前缀化自由变量。
    /**
     * 循环 template 的 key 为 itemKey(item)，内容为文本；检查手动处理 template key 后注入每轮 Fragment，自由函数加前缀、item 保持局部。
     */
    test('template v-for key expression prefixing', () => {
      const {
        node: { codegenNode },
      } = parseWithForTransform(
        '<template v-for="item in items" :key="itemKey(item)">test</template>',
        { prefixIdentifiers: true },
      )
      const innerBlock = codegenNode.children.arguments[1].returns
      expect(innerBlock).toMatchObject({
        type: NodeTypes.VNODE_CALL,
        tag: FRAGMENT,
        props: createObjectMatcher({
          key: {
            type: NodeTypes.COMPOUND_EXPRESSION,
            children: [
              // key 表达式中的外层引用需要前缀化。
              { content: `_ctx.itemKey` },
              `(`,
              // key 中引用的循环别名保持局部。
              { content: `item` },
              `)`,
            ],
          },
        }),
      })
    })

    /**
     * 循环 template 的 key 为简单 itemKey；检查值加 _ctx 后成为每轮 Fragment 的 key，透明容器不会再经过普通元素转换。
     */
    test('template v-for key expression prefixing on simple expression', () => {
      const {
        node: { codegenNode },
      } = parseWithForTransform(
        '<template v-for="item in items" :key="itemKey">test</template>',
        { prefixIdentifiers: true },
      )
      const innerBlock = codegenNode.children.arguments[1].returns
      expect(innerBlock).toMatchObject({
        type: NodeTypes.VNODE_CALL,
        tag: FRAGMENT,
        props: createObjectMatcher({
          key: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: `_ctx.itemKey`,
          },
        }),
      })
    })

    /**
     * 循环 template 使用普通 key="key"；检查 key 为静态字符串内容，开启前缀也不把字面属性值改为变量。
     */
    test('template v-for key no prefixing on attribute key', () => {
      const {
        node: { codegenNode },
      } = parseWithForTransform(
        '<template v-for="item in items" key="key">test</template>',
        { prefixIdentifiers: true },
      )
      const innerBlock = codegenNode.children.arguments[1].returns
      expect(innerBlock).toMatchObject({
        type: NodeTypes.VNODE_CALL,
        tag: FRAGMENT,
        props: createObjectMatcher({
          key: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: 'key',
          },
        }),
      })
    })
  })

  // 代码生成：核对 renderList 迭代器参数、Fragment patchFlag、key 与 block tracking。
  describe('codegen', () => {
    /** 复用 v-for 外层 Fragment 与 renderList 调用协议的公共断言。 */
    function assertSharedCodegen(
      node: ForCodegenNode,
      keyed: boolean = false,
      customReturn: boolean = false,
      disableTracking: boolean = true,
    ) {
      expect(node).toMatchObject({
        type: NodeTypes.VNODE_CALL,
        tag: FRAGMENT,
        disableTracking,
        patchFlag: !disableTracking
          ? PatchFlags.STABLE_FRAGMENT
          : keyed
            ? PatchFlags.KEYED_FRAGMENT
            : PatchFlags.UNKEYED_FRAGMENT,
        children: {
          type: NodeTypes.JS_CALL_EXPRESSION,
          callee: RENDER_LIST,
          arguments: [
            {}, // 数据源由各用例单独断言。
            {
              type: NodeTypes.JS_FUNCTION_EXPRESSION,
              returns: customReturn
                ? {}
                : {
                    type: NodeTypes.VNODE_CALL,
                    isBlock: disableTracking,
                  },
            },
          ],
        },
      })
      const renderListArgs = node.children.arguments
      return {
        source: renderListArgs[0] as SimpleExpressionNode,
        params: (renderListArgs[1] as any).params,
        returns: (renderListArgs[1] as any).returns,
        innerVNodeCall: customReturn
          ? null
          : (renderListArgs[1] as any).returns,
      }
    }

    /**
     * 普通 span 循环 item in items；检查外层 UNKEYED_FRAGMENT 关闭追踪，renderList 只传 item 参数并返回 span block，快照核对嵌套边界。
     */
    test('basic v-for', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithForTransform('<span v-for="(item) in items" />')
      expect(assertSharedCodegen(codegenNode)).toMatchObject({
        source: { content: `items` },
        params: [{ content: `item` }],
        innerVNodeCall: {
          tag: `"span"`,
        },
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 循环声明 item/key/index；检查 renderList 回调按固定顺序接收三个参数，并比对生成快照。
     */
    test('value + key + index', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithForTransform('<span v-for="(item, key, index) in items" />')
      expect(assertSharedCodegen(codegenNode)).toMatchObject({
        source: { content: `items` },
        params: [{ content: `item` }, { content: `key` }, { content: `index` }],
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 循环省略 value、保留 key/index；检查回调用 _ 占据第一位置，避免把 key 错当成 value。
     */
    test('skipped value', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithForTransform('<span v-for="(, key, index) in items" />')
      expect(assertSharedCodegen(codegenNode)).toMatchObject({
        source: { content: `items` },
        params: [{ content: `_` }, { content: `key` }, { content: `index` }],
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 循环省略 key、保留 item/index；检查中间生成 __ 占位，第三个 index 的位置保持不变。
     */
    test('skipped key', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithForTransform('<span v-for="(item,,index) in items" />')
      expect(assertSharedCodegen(codegenNode)).toMatchObject({
        source: { content: `items` },
        params: [{ content: `item` }, { content: `__` }, { content: `index` }],
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 循环只声明第三位置 index；检查回调使用 _、__ 两个占位，再接 index，生成合法 JS 参数列表。
     */
    test('skipped value & key', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithForTransform('<span v-for="(,,index) in items" />')
      expect(assertSharedCodegen(codegenNode)).toMatchObject({
        source: { content: `items` },
        params: [{ content: `_` }, { content: `__` }, { content: `index` }],
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 以常量 10 为来源、每轮插值 item，并开启前缀；检查外层 STABLE_FRAGMENT 保持收集，内层 p 可降为普通 VNode，但其动态文本仍带 TEXT 标记。
     */
    test('v-for with constant expression', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithForTransform('<p v-for="item in 10">{{item}}</p>', {
        prefixIdentifiers: true,
      })

      expect(
        assertSharedCodegen(
          codegenNode,
          false /* 无显式 key */,
          false /* 常规 VNode 返回值 */,
          false /* 保持动态收集 */,
        ),
      ).toMatchObject({
        source: { content: `10`, constType: ConstantTypes.CAN_STRINGIFY },
        params: [{ content: `item` }],
        innerVNodeCall: {
          tag: `"p"`,
          props: undefined,
          isBlock: false,
          children: {
            type: NodeTypes.INTERPOLATION,
            content: {
              type: NodeTypes.SIMPLE_EXPRESSION,
              content: 'item',
              isStatic: false,
              constType: ConstantTypes.NOT_CONSTANT,
            },
          },
          patchFlag: PatchFlags.TEXT,
        },
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 循环 template 每轮产生 hello 与 span 两根；检查额外生成该轮的 STABLE_FRAGMENT block，外层 renderList 仍管理不稳定列表。
     */
    test('template v-for', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithForTransform(
        '<template v-for="item in items">hello<span/></template>',
      )
      expect(assertSharedCodegen(codegenNode)).toMatchObject({
        source: { content: `items` },
        params: [{ content: `item` }],
        innerVNodeCall: {
          tag: FRAGMENT,
          props: undefined,
          isBlock: true,
          children: [
            { type: NodeTypes.TEXT, content: `hello` },
            { type: NodeTypes.ELEMENT, tag: `span` },
          ],
          patchFlag: PatchFlags.STABLE_FRAGMENT,
        },
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 循环 template 只有一个 slot outlet；检查每轮直接返回 RENDER_SLOT，不再套额外 Fragment。
     */
    test('template v-for w/ <slot/>', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithForTransform(
        '<template v-for="item in items"><slot/></template>',
      )
      expect(
        assertSharedCodegen(codegenNode, false, true /* 自定义返回形态 */),
      ).toMatchObject({
        source: { content: `items` },
        params: [{ content: `item` }],
        returns: {
          type: NodeTypes.JS_CALL_EXPRESSION,
          callee: RENDER_SLOT,
        },
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 循环 template 带 item.id key，唯一 child 为 slot；检查 key 注入 renderSlot 第六参数，中间补占位，保持插槽 props 为空对象。
     */
    test('template v-for key injection with single slot child', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithForTransform(
        '<template v-for="item in items" :key="item.id"><slot/></template>',
      )
      expect(
        assertSharedCodegen(codegenNode, true, true /* 自定义返回形态 */),
      ).toMatchObject({
        source: { content: `items` },
        params: [{ content: `item` }],
        returns: {
          type: NodeTypes.JS_CALL_EXPRESSION,
          callee: RENDER_SLOT,
          arguments: [
            '$slots',
            '"default"',
            '{}',
            'undefined',
            'undefined',
            { content: 'item.id' },
          ],
        },
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    // #1907：template 循环只有一个元素 child 时，key 应注入该 child，且不能额外制造 Fragment。
    /**
     * 循环 template 带 item.id key，唯一 child 为动态 id 的 span；检查 key 与 id 同处 span props，复用元素 block 而不额外制造 Fragment。
     */
    test('template v-for key injection with single child', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithForTransform(
        '<template v-for="item in items" :key="item.id"><span :id="item.id" /></template>',
      )
      expect(assertSharedCodegen(codegenNode, true)).toMatchObject({
        source: { content: `items` },
        params: [{ content: `item` }],
        innerVNodeCall: {
          type: NodeTypes.VNODE_CALL,
          tag: `"span"`,
          props: createObjectMatcher({
            key: '[item.id]',
            id: '[item.id]',
          }),
        },
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 直接给 slot outlet 加 for；检查 renderList 迭代器返回 RENDER_SLOT 调用，列表外层 Fragment 仍存在。
     */
    test('v-for on <slot/>', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithForTransform('<slot v-for="item in items"></slot>')
      expect(
        assertSharedCodegen(codegenNode, false, true /* 自定义返回形态 */),
      ).toMatchObject({
        source: { content: `items` },
        params: [{ content: `item` }],
        returns: {
          type: NodeTypes.JS_CALL_EXPRESSION,
          callee: RENDER_SLOT,
        },
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 循环 span 带 :key="item"；检查外层 KEYED_FRAGMENT 与每轮 span 的 key，二者分别决定列表 diff 与单项身份。
     */
    test('keyed v-for', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithForTransform('<span v-for="(item) in items" :key="item" />')
      expect(assertSharedCodegen(codegenNode, true)).toMatchObject({
        source: { content: `items` },
        params: [{ content: `item` }],
        innerVNodeCall: {
          tag: `"span"`,
          props: createObjectMatcher({
            key: `[item]`,
          }),
        },
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 循环 template 带 item key 且每轮两根；检查外层 KEYED_FRAGMENT，每轮 STABLE_FRAGMENT 携带 key 并保存 hello/span children。
     */
    test('keyed template v-for', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithForTransform(
        '<template v-for="item in items" :key="item">hello<span/></template>',
      )
      expect(assertSharedCodegen(codegenNode, true)).toMatchObject({
        source: { content: `items` },
        params: [{ content: `item` }],
        innerVNodeCall: {
          tag: FRAGMENT,
          props: createObjectMatcher({
            key: `[item]`,
          }),
          children: [
            { type: NodeTypes.TEXT, content: `hello` },
            { type: NodeTypes.ELEMENT, tag: `span` },
          ],
          patchFlag: PatchFlags.STABLE_FRAGMENT,
        },
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 同一 div 同时带 if 与 for；检查 if 先形成条件表达式，真分支复用列表 Fragment 并注入分支 key 0，每轮再返回 div block。
     */
    test('v-if + v-for', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithForTransform(`<div v-if="ok" v-for="i in list"/>`)
      expect(codegenNode).toMatchObject({
        type: NodeTypes.JS_CONDITIONAL_EXPRESSION,
        test: { content: `ok` },
        consequent: {
          type: NodeTypes.VNODE_CALL,
          props: createObjectMatcher({
            key: `[0]`,
          }),
          isBlock: true,
          disableTracking: true,
          patchFlag: PatchFlags.UNKEYED_FRAGMENT,
          children: {
            type: NodeTypes.JS_CALL_EXPRESSION,
            callee: RENDER_LIST,
            arguments: [
              { content: `list` },
              {
                type: NodeTypes.JS_FUNCTION_EXPRESSION,
                params: [{ content: `i` }],
                returns: {
                  type: NodeTypes.VNODE_CALL,
                  tag: `"div"`,
                  isBlock: true,
                },
              },
            ],
          },
        },
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    // #1637：template 同时带 if/for 时，先保留条件边界，再解包每轮 children。
    /**
     * 空 template 同时带 if 与 for；检查条件先包住列表 Fragment，迭代器仍返回该轮空 Fragment，透明容器的解包不丢条件边界。
     */
    test('v-if + v-for on <template>', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithForTransform(`<template v-if="ok" v-for="i in list"/>`)
      expect(codegenNode).toMatchObject({
        type: NodeTypes.JS_CONDITIONAL_EXPRESSION,
        test: { content: `ok` },
        consequent: {
          type: NodeTypes.VNODE_CALL,
          props: createObjectMatcher({
            key: `[0]`,
          }),
          isBlock: true,
          disableTracking: true,
          patchFlag: PatchFlags.UNKEYED_FRAGMENT,
          children: {
            type: NodeTypes.JS_CALL_EXPRESSION,
            callee: RENDER_LIST,
            arguments: [
              { content: `list` },
              {
                type: NodeTypes.JS_FUNCTION_EXPRESSION,
                params: [{ content: `i` }],
                returns: {
                  type: NodeTypes.VNODE_CALL,
                  tag: FRAGMENT,
                  isBlock: true,
                },
              },
            ],
          },
        },
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 循环 div 带未知 v-foo；检查每轮 VNodeCall 保留运行时指令数组，列表 block 调整不会移除 directive metadata。
     */
    test('v-for on element with custom directive', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithForTransform('<div v-for="i in list" v-foo/>')
      const { returns } = assertSharedCodegen(codegenNode, false, true)
      expect(returns).toMatchObject({
        type: NodeTypes.VNODE_CALL,
        directives: { type: NodeTypes.JS_ARRAY_EXPRESSION },
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 循环 div 使用裸 :key 同名简写，别名为 key；检查外层选择 KEYED_FRAGMENT，简写转换须先补出可识别的用户 key。
     */
    test('template v-for key w/ :key shorthand on div', () => {
      const {
        node: { codegenNode },
      } = parseWithForTransform('<div v-for="key in keys" :key>test</div>')
      expect(codegenNode.patchFlag).toBe(PatchFlags.KEYED_FRAGMENT)
    })

    /**
     * 循环 template 使用裸 :key，唯一 div child；检查循环别名 key 被注入 child props，迭代器返回 div block，外层仍按 keyed 列表生成。
     */
    test('template v-for key w/ :key shorthand on template injected to the child', () => {
      const {
        node: { codegenNode },
      } = parseWithForTransform(
        '<template v-for="key in keys" :key><div>test</div></template>',
      )
      expect(assertSharedCodegen(codegenNode, true)).toMatchObject({
        source: { content: `keys` },
        params: [{ content: `key` }],
        innerVNodeCall: {
          type: NodeTypes.VNODE_CALL,
          tag: `"div"`,
          props: createObjectMatcher({
            key: '[key]',
          }),
        },
      })
    })
  })
})
