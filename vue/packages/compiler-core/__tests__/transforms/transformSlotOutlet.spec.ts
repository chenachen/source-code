/**
 * `<slot>` 出口场景：提取静态/动态名称、生成 props 和 fallback，并验证 scoped/slotted、
 * 同名简写与非法自定义指令对 renderSlot 参数形状的影响。
 */
import {
  type CompilerOptions,
  type ElementNode,
  ErrorCodes,
  NodeTypes,
  baseParse as parse,
  transform,
} from '../../src'
import { transformElement } from '../../src/transforms/transformElement'
import { transformOn } from '../../src/transforms/vOn'
import { transformBind } from '../../src/transforms/vBind'
import { transformExpression } from '../../src/transforms/transformExpression'
import { RENDER_SLOT } from '../../src/runtimeHelpers'
import { transformSlotOutlet } from '../../src/transforms/transformSlotOutlet'

/** 编译 slot outlet 及其属性/表达式，返回可直接检查 renderSlot 调用的根 AST。 */
function parseWithSlots(template: string, options: CompilerOptions = {}) {
  const ast = parse(template)
  transform(ast, {
    nodeTransforms: [
      ...(options.prefixIdentifiers ? [transformExpression] : []),
      transformSlotOutlet,
      transformElement,
    ],
    directiveTransforms: {
      on: transformOn,
      bind: transformBind,
    },
    ...options,
  })
  return ast
}

describe('compiler: transform <slot> outlets', () => {
  /**
   * 解析空 slot outlet；检查 renderSlot 仅接收 $slots 和默认名称，省略未使用的 props/fallback 尾参。
   */
  test('default slot outlet', () => {
    const ast = parseWithSlots(`<slot/>`)
    expect((ast.children[0] as ElementNode).codegenNode).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: RENDER_SLOT,
      arguments: [`$slots`, `"default"`],
    })
  })

  /**
   * 出口静态 name 为 foo；检查第二参数为带引号的 foo，普通 name 属性不生成额外 props。
   */
  test('statically named slot outlet', () => {
    const ast = parseWithSlots(`<slot name="foo" />`)
    expect((ast.children[0] as ElementNode).codegenNode).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: RENDER_SLOT,
      arguments: [`$slots`, `"foo"`],
    })
  })

  /**
   * 出口使用 :name="foo"；检查名称为动态表达式而非字符串字面量，仍只保留两个调用参数。
   */
  test('dynamically named slot outlet', () => {
    const ast = parseWithSlots(`<slot :name="foo" />`)
    expect((ast.children[0] as ElementNode).codegenNode).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: RENDER_SLOT,
      arguments: [
        `$slots`,
        {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: `foo`,
          isStatic: false,
        },
      ],
    })
  })

  /**
   * 出口名称为 foo + bar 并开启前缀；检查 _ctx.$slots 与分段的 _ctx.foo/_ctx.bar，表达式结构继续参与 codegen。
   */
  test('dynamically named slot outlet w/ prefixIdentifiers: true', () => {
    const ast = parseWithSlots(`<slot :name="foo + bar" />`, {
      prefixIdentifiers: true,
    })
    expect((ast.children[0] as ElementNode).codegenNode).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: RENDER_SLOT,
      arguments: [
        `_ctx.$slots`,
        {
          type: NodeTypes.COMPOUND_EXPRESSION,
          children: [
            {
              type: NodeTypes.SIMPLE_EXPRESSION,
              content: `_ctx.foo`,
              isStatic: false,
            },
            ` + `,
            {
              type: NodeTypes.SIMPLE_EXPRESSION,
              content: `_ctx.bar`,
              isStatic: false,
            },
          ],
        },
      ],
    })
  })

  /**
   * 默认出口带静态 foo、动态 baz 和短横线绑定 foo-bar；检查第三参数对象区分静态/动态值，并将绑定 key 转成 fooBar。
   */
  test('default slot outlet with props', () => {
    const ast = parseWithSlots(
      `<slot foo="bar" :baz="qux" :foo-bar="foo-bar" />`,
    )
    expect((ast.children[0] as ElementNode).codegenNode).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: RENDER_SLOT,
      arguments: [
        `$slots`,
        `"default"`,
        {
          type: NodeTypes.JS_OBJECT_EXPRESSION,
          properties: [
            {
              key: {
                content: `foo`,
                isStatic: true,
              },
              value: {
                content: `bar`,
                isStatic: true,
              },
            },
            {
              key: {
                content: `baz`,
                isStatic: true,
              },
              value: {
                content: `qux`,
                isStatic: false,
              },
            },
            {
              key: {
                content: `fooBar`,
                isStatic: true,
              },
              value: {
                content: `foo-bar`,
                isStatic: false,
              },
            },
          ],
        },
      ],
    })
  })

  /**
   * 静态命名出口还带 foo/baz props；检查 name 仅作为调用第二参数，其余两项才进入第三参数对象。
   */
  test('statically named slot outlet with props', () => {
    const ast = parseWithSlots(`<slot name="foo" foo="bar" :baz="qux" />`)
    expect((ast.children[0] as ElementNode).codegenNode).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: RENDER_SLOT,
      arguments: [
        `$slots`,
        `"foo"`,
        {
          type: NodeTypes.JS_OBJECT_EXPRESSION,
          // name 作为 renderSlot 第二参数，不能重复出现在 props 中。
          properties: [
            {
              key: {
                content: `foo`,
                isStatic: true,
              },
              value: {
                content: `bar`,
                isStatic: true,
              },
            },
            {
              key: {
                content: `baz`,
                isStatic: true,
              },
              value: {
                content: `qux`,
                isStatic: false,
              },
            },
          ],
        },
      ],
    })
  })

  /**
   * 动态命名出口还带 foo/baz props；检查动态 name 同样被排除在 props 外，避免重复传给插槽函数。
   */
  test('dynamically named slot outlet with props', () => {
    const ast = parseWithSlots(`<slot :name="foo" foo="bar" :baz="qux" />`)
    expect((ast.children[0] as ElementNode).codegenNode).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: RENDER_SLOT,
      arguments: [
        `$slots`,
        { content: `foo`, isStatic: false },
        {
          type: NodeTypes.JS_OBJECT_EXPRESSION,
          // 动态 name 同样必须从插槽 props 排除。
          properties: [
            {
              key: {
                content: `foo`,
                isStatic: true,
              },
              value: {
                content: `bar`,
                isStatic: true,
              },
            },
            {
              key: {
                content: `baz`,
                isStatic: true,
              },
              value: {
                content: `qux`,
                isStatic: false,
              },
            },
          ],
        },
      ],
    })
  })

  /**
   * 默认出口包含 div fallback；检查第三参数补空对象，第四参数是返回该 div 的无参函数，后续子节点遍历负责其 codegen。
   */
  test('default slot outlet with fallback', () => {
    const ast = parseWithSlots(`<slot><div/></slot>`)
    expect((ast.children[0] as ElementNode).codegenNode).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: RENDER_SLOT,
      arguments: [
        `$slots`,
        `"default"`,
        `{}`,
        {
          type: NodeTypes.JS_FUNCTION_EXPRESSION,
          params: [],
          returns: [
            {
              type: NodeTypes.ELEMENT,
              tag: `div`,
            },
          ],
        },
      ],
    })
  })

  /**
   * 命名 foo 出口包含 div fallback；检查名称与 fallback 函数分别占第二和第四参数，空 props 占位保证参数位置。
   */
  test('named slot outlet with fallback', () => {
    const ast = parseWithSlots(`<slot name="foo"><div/></slot>`)
    expect((ast.children[0] as ElementNode).codegenNode).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: RENDER_SLOT,
      arguments: [
        `$slots`,
        `"foo"`,
        `{}`,
        {
          type: NodeTypes.JS_FUNCTION_EXPRESSION,
          params: [],
          returns: [
            {
              type: NodeTypes.ELEMENT,
              tag: `div`,
            },
          ],
        },
      ],
    })
  })

  /**
   * 默认出口同时带动态 foo prop 与 div fallback；检查第三参数对象和第四参数函数共同生成，不丢失绑定与后备内容。
   */
  test('default slot outlet with props & fallback', () => {
    const ast = parseWithSlots(`<slot :foo="bar"><div/></slot>`)
    expect((ast.children[0] as ElementNode).codegenNode).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: RENDER_SLOT,
      arguments: [
        `$slots`,
        `"default"`,
        {
          type: NodeTypes.JS_OBJECT_EXPRESSION,
          properties: [
            {
              key: {
                content: `foo`,
                isStatic: true,
              },
              value: {
                content: `bar`,
                isStatic: false,
              },
            },
          ],
        },
        {
          type: NodeTypes.JS_FUNCTION_EXPRESSION,
          params: [],
          returns: [
            {
              type: NodeTypes.ELEMENT,
              tag: `div`,
            },
          ],
        },
      ],
    })
  })

  /**
   * 命名出口同时带动态 foo prop 与 div fallback；检查 name 被单独提取，props 和 fallback 保持 renderSlot 的固定位置。
   */
  test('named slot outlet with props & fallback', () => {
    const ast = parseWithSlots(`<slot name="foo" :foo="bar"><div/></slot>`)
    expect((ast.children[0] as ElementNode).codegenNode).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: RENDER_SLOT,
      arguments: [
        `$slots`,
        `"foo"`,
        {
          type: NodeTypes.JS_OBJECT_EXPRESSION,
          properties: [
            {
              key: {
                content: `foo`,
                isStatic: true,
              },
              value: {
                content: `bar`,
                isStatic: false,
              },
            },
          ],
        },
        {
          type: NodeTypes.JS_FUNCTION_EXPRESSION,
          params: [],
          returns: [
            {
              type: NodeTypes.ELEMENT,
              tag: `div`,
            },
          ],
        },
      ],
    })
  })

  /**
   * 传 scopeId 且 slotted:false，分别编译空出口与文本 fallback；检查第五参数 true，缺失的中间项用空对象/undefined 补齐，避免对子级插槽内容追加 slotted scopeId。
   */
  test('slot with slotted: false', async () => {
    const ast = parseWithSlots(`<slot/>`, { slotted: false, scopeId: 'foo' })
    expect((ast.children[0] as ElementNode).codegenNode).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: RENDER_SLOT,
      arguments: [`$slots`, `"default"`, `{}`, `undefined`, `true`],
    })
    const fallback = parseWithSlots(`<slot>fallback</slot>`, {
      slotted: false,
      scopeId: 'foo',
    })

    const child = {
      type: NodeTypes.JS_FUNCTION_EXPRESSION,
      params: [],
      returns: [
        {
          type: NodeTypes.TEXT,
          content: `fallback`,
        },
      ],
    }
    expect((fallback.children[0] as ElementNode).codegenNode).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: RENDER_SLOT,
      arguments: [`$slots`, `"default"`, `{}`, child, `true`],
    })
  })

  /**
   * 出口带未知 v-foo 并收集诊断；检查错误代码及 v-foo 精确范围。运行时自定义指令不能直接作用于 renderSlot 调用。
   */
  test(`error on unexpected custom directive on <slot>`, () => {
    const onError = vi.fn()
    const source = `<slot v-foo />`
    parseWithSlots(source, { onError })
    const index = source.indexOf('v-foo')
    expect(onError.mock.calls[0][0]).toMatchObject({
      code: ErrorCodes.X_V_SLOT_UNEXPECTED_DIRECTIVE_ON_SLOT_OUTLET,
      loc: {
        start: {
          offset: index,
          line: 1,
          column: index + 1,
        },
        end: {
          offset: index + 5,
          line: 1,
          column: index + 6,
        },
      },
    })
  })

  /**
   * 出口使用裸 :name 同名简写；processSlotOutlet 自行补出动态 name 表达式，检查第二参数保持动态节点。
   */
  test('dynamically named slot outlet with v-bind shorthand', () => {
    const ast = parseWithSlots(`<slot :name />`)
    expect((ast.children[0] as ElementNode).codegenNode).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: RENDER_SLOT,
      arguments: [
        `$slots`,
        {
          type: NodeTypes.SIMPLE_EXPRESSION,
          content: `name`,
          isStatic: false,
        },
      ],
    })
  })
})
