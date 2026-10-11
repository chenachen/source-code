/**
 * `v-bind` 场景：覆盖静态/动态参数、无参数对象绑定、修饰符、同名简写和表达式缺失诊断，
 * 核对属性 key/value 与运行时规范化 helper 的生成方式。
 */
import {
  type CallExpression,
  type CompilerOptions,
  type ElementNode,
  ErrorCodes,
  NodeTypes,
  type ObjectExpression,
  type VNodeCall,
  baseParse as parse,
  transform,
} from '../../src'
import { transformBind } from '../../src/transforms/vBind'
import { transformElement } from '../../src/transforms/transformElement'
import {
  CAMELIZE,
  NORMALIZE_PROPS,
  helperNameMap,
} from '../../src/runtimeHelpers'
import { transformExpression } from '../../src/transforms/transformExpression'
import { transformVBindShorthand } from '../../src/transforms/transformVBindShorthand'

/** 编译 v-bind 与元素转换，并提取首元素的 props/codegen 供断言。 */
function parseWithVBind(
  template: string,
  options: CompilerOptions = {},
): ElementNode {
  const ast = parse(template)
  transform(ast, {
    nodeTransforms: [
      transformVBindShorthand,
      ...(options.prefixIdentifiers ? [transformExpression] : []),
      transformElement,
    ],
    directiveTransforms: {
      bind: transformBind,
    },
    ...options,
  })
  return ast.children[0] as ElementNode
}

describe('compiler: transform v-bind', () => {
  /**
   * 将 v-bind:id="id" 转成静态 key id 与动态值 id；断言两者的独立 loc，验证参数和值分别沿用模板中的源码范围。
   */
  test('basic', () => {
    const node = parseWithVBind(`<div v-bind:id="id"/>`)
    const props = (node.codegenNode as VNodeCall).props as ObjectExpression
    expect(props.properties[0]).toMatchObject({
      key: {
        content: `id`,
        isStatic: true,
        loc: {
          start: {
            line: 1,
            column: 13,
          },
          end: {
            line: 1,
            column: 15,
          },
        },
      },
      value: {
        content: `id`,
        isStatic: false,
        loc: {
          start: {
            line: 1,
            column: 17,
          },
          end: {
            line: 1,
            column: 19,
          },
        },
      },
    })
  })

  /**
   * 省略 v-bind:id 的值；同名简写转换从静态参数补出动态表达式 id，且 value.loc 使用参数位置。
   */
  test('no expression', () => {
    const node = parseWithVBind(`<div v-bind:id />`)
    const props = (node.codegenNode as VNodeCall).props as ObjectExpression
    expect(props.properties[0]).toMatchObject({
      key: {
        content: `id`,
        isStatic: true,
        loc: {
          start: { line: 1, column: 13, offset: 12 },
          end: { line: 1, column: 15, offset: 14 },
        },
      },
      value: {
        content: `id`,
        isStatic: false,
        loc: {
          start: { line: 1, column: 13, offset: 12 },
          end: { line: 1, column: 15, offset: 14 },
        },
      },
    })
  })

  /**
   * 使用裸 :id 简写；检查 props 的 key 为静态 id、value 为动态 id，同名恢复与完整 v-bind 写法一致。
   */
  test('no expression (shorthand)', () => {
    const node = parseWithVBind(`<div :id />`)
    const props = (node.codegenNode as VNodeCall).props as ObjectExpression
    expect(props.properties[0]).toMatchObject({
      key: {
        content: `id`,
        isStatic: true,
      },
      value: {
        content: `id`,
        isStatic: false,
      },
    })
  })

  /**
   * 临时切换浏览器构建，输入 :id="" 模拟 in-DOM 属性规范化；仍恢复同名表达式 id，并在 finally 恢复构建标志。
   */
  test('no expression (shorthand) in-DOM templates', () => {
    try {
      __BROWSER__ = true
      // in-DOM 模板中的裸 `:id` 会被浏览器解析为 `:id=""`，仍应按同名简写恢复。
      const node = parseWithVBind(`<div :id="" />`)
      const props = (node.codegenNode as VNodeCall).props as ObjectExpression
      expect(props.properties[0]).toMatchObject({
        key: {
          content: `id`,
          isStatic: true,
        },
        value: {
          content: `id`,
          isStatic: false,
        },
      })
    } finally {
      __BROWSER__ = false
    }
  })

  /**
   * 参数写成 [id]；key 增加空串回退 id || ""，整个 props 对象经 NORMALIZE_PROPS 包装，以处理运行时动态属性名。
   */
  test('dynamic arg', () => {
    const node = parseWithVBind(`<div v-bind:[id]="id"/>`)
    const props = (node.codegenNode as VNodeCall).props as CallExpression
    expect(props).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: NORMALIZE_PROPS,
      arguments: [
        {
          type: NodeTypes.JS_OBJECT_EXPRESSION,
          properties: [
            {
              key: {
                content: `id || ""`,
                isStatic: false,
              },
              value: {
                content: `id`,
                isStatic: false,
              },
            },
          ],
        },
      ],
    })
  })

  /**
   * 非浏览器输入 v-bind:arg="" 并使用收集式 onError；检查缺失表达式诊断及指令范围，恢复属性的值为静态空串。
   */
  test('should error if empty expression', () => {
    const onError = vi.fn()
    const node = parseWithVBind(`<div v-bind:arg="" />`, { onError })
    const props = (node.codegenNode as VNodeCall).props as ObjectExpression
    expect(onError.mock.calls[0][0]).toMatchObject({
      code: ErrorCodes.X_V_BIND_NO_EXPRESSION,
      loc: {
        start: {
          line: 1,
          column: 6,
        },
        end: {
          line: 1,
          column: 19,
        },
      },
    })
    expect(props.properties[0]).toMatchObject({
      key: {
        content: `arg`,
        isStatic: true,
      },
      value: {
        content: ``,
        isStatic: true,
      },
    })
  })

  /**
   * 静态参数 foo-bar 加 .camel；检查编译期改名为 fooBar，绑定值 id 保持动态表达式。
   */
  test('.camel modifier', () => {
    const node = parseWithVBind(`<div v-bind:foo-bar.camel="id"/>`)
    const props = (node.codegenNode as VNodeCall).props as ObjectExpression
    expect(props.properties[0]).toMatchObject({
      key: {
        content: `fooBar`,
        isStatic: true,
      },
      value: {
        content: `id`,
        isStatic: false,
      },
    })
  })

  /**
   * foo-bar.camel 省略值；先由简写规则补出 fooBar 表达式，再将静态 key 驼峰化，二者名称一致。
   */
  test('.camel modifier w/ no expression', () => {
    const node = parseWithVBind(`<div v-bind:foo-bar.camel />`)
    const props = (node.codegenNode as VNodeCall).props as ObjectExpression
    expect(props.properties[0]).toMatchObject({
      key: {
        content: `fooBar`,
        isStatic: true,
      },
      value: {
        content: `fooBar`,
        isStatic: false,
      },
    })
  })

  /**
   * 动态参数 [foo] 加 .camel；检查 CAMELIZE 包住 foo || ""，并由 NORMALIZE_PROPS 包装动态 props 对象。
   */
  test('.camel modifier w/ dynamic arg', () => {
    const node = parseWithVBind(`<div v-bind:[foo].camel="id"/>`)
    const props = (node.codegenNode as VNodeCall).props as CallExpression
    expect(props).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: NORMALIZE_PROPS,
      arguments: [
        {
          type: NodeTypes.JS_OBJECT_EXPRESSION,
          properties: [
            {
              key: {
                content: `_${helperNameMap[CAMELIZE]}(foo || "")`,
                isStatic: false,
              },
              value: {
                content: `id`,
                isStatic: false,
              },
            },
          ],
        },
      ],
    })
  })

  /**
   * 动态参数 foo(bar) 加 .camel 并启用前缀；检查分段表达式里的 foo/bar/id 均访问 _ctx，参数先做空串回退再调用 CAMELIZE。
   */
  test('.camel modifier w/ dynamic arg + prefixIdentifiers', () => {
    const node = parseWithVBind(`<div v-bind:[foo(bar)].camel="id"/>`, {
      prefixIdentifiers: true,
    })
    const props = (node.codegenNode as VNodeCall).props as CallExpression
    expect(props).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: NORMALIZE_PROPS,
      arguments: [
        {
          type: NodeTypes.JS_OBJECT_EXPRESSION,
          properties: [
            {
              key: {
                children: [
                  `_${helperNameMap[CAMELIZE]}(`,
                  `(`,
                  { content: `_ctx.foo` },
                  `(`,
                  { content: `_ctx.bar` },
                  `)`,
                  `) || ""`,
                  `)`,
                ],
              },
              value: {
                content: `_ctx.id`,
                isStatic: false,
              },
            },
          ],
        },
      ],
    })
  })

  /**
   * 静态 fooBar 加 .prop；检查 key 编码为 .fooBar，供运行时强制 DOM property，value 仍为 id。
   */
  test('.prop modifier', () => {
    const node = parseWithVBind(`<div v-bind:fooBar.prop="id"/>`)
    const props = (node.codegenNode as VNodeCall).props as ObjectExpression
    expect(props.properties[0]).toMatchObject({
      key: {
        content: `.fooBar`,
        isStatic: true,
      },
      value: {
        content: `id`,
        isStatic: false,
      },
    })
  })

  /**
   * fooBar.prop 省略值；检查 . 前缀只写入 key，简写恢复的表达式仍为 fooBar。
   */
  test('.prop modifier w/ no expression', () => {
    const node = parseWithVBind(`<div v-bind:fooBar.prop />`)
    const props = (node.codegenNode as VNodeCall).props as ObjectExpression
    expect(props.properties[0]).toMatchObject({
      key: {
        content: `.fooBar`,
        isStatic: true,
      },
      value: {
        content: `fooBar`,
        isStatic: false,
      },
    })
  })

  /**
   * 动态 fooBar 参数加 .prop；检查模板串在求值后添加点前缀，保留空串回退并规范化 props。
   */
  test('.prop modifier w/ dynamic arg', () => {
    const node = parseWithVBind(`<div v-bind:[fooBar].prop="id"/>`)
    const props = (node.codegenNode as VNodeCall).props as CallExpression
    expect(props).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: NORMALIZE_PROPS,
      arguments: [
        {
          type: NodeTypes.JS_OBJECT_EXPRESSION,
          properties: [
            {
              key: {
                content: '`.${fooBar || ""}`',
                isStatic: false,
              },
              value: {
                content: `id`,
                isStatic: false,
              },
            },
          ],
        },
      ],
    })
  })

  /**
   * 动态 foo(bar) 参数加 .prop 与前缀；检查复合 key 用点前缀拼接，内部自由变量和绑定值分别改写到 _ctx。
   */
  test('.prop modifier w/ dynamic arg + prefixIdentifiers', () => {
    const node = parseWithVBind(`<div v-bind:[foo(bar)].prop="id"/>`, {
      prefixIdentifiers: true,
    })
    const props = (node.codegenNode as VNodeCall).props as CallExpression
    expect(props).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: NORMALIZE_PROPS,
      arguments: [
        {
          type: NodeTypes.JS_OBJECT_EXPRESSION,
          properties: [
            {
              key: {
                children: [
                  `'.' + (`,
                  `(`,
                  { content: `_ctx.foo` },
                  `(`,
                  { content: `_ctx.bar` },
                  `)`,
                  `) || ""`,
                  `)`,
                ],
              },
              value: {
                content: `_ctx.id`,
                isStatic: false,
              },
            },
          ],
        },
      ],
    })
  })

  /**
   * 使用 .fooBar="id" 的点号简写；parser 将其识别为带 .prop 的 bind，输出 key 为 .fooBar、value 为 id。
   */
  test('.prop modifier (shorthand)', () => {
    const node = parseWithVBind(`<div .fooBar="id"/>`)
    const props = (node.codegenNode as VNodeCall).props as ObjectExpression
    expect(props.properties[0]).toMatchObject({
      key: {
        content: `.fooBar`,
        isStatic: true,
      },
      value: {
        content: `id`,
        isStatic: false,
      },
    })
  })

  /**
   * 裸 .fooBar 省略值；检查同名表达式 fooBar 与带点前缀 key 分离，避免把点写入赋值表达式。
   */
  test('.prop modifier (shortband) w/ no expression', () => {
    const node = parseWithVBind(`<div .fooBar />`)
    const props = (node.codegenNode as VNodeCall).props as ObjectExpression
    expect(props.properties[0]).toMatchObject({
      key: {
        content: `.fooBar`,
        isStatic: true,
      },
      value: {
        content: `fooBar`,
        isStatic: false,
      },
    })
  })

  /**
   * 静态 foo-bar 加 .attr；检查 key 保持短横线并增加 ^ 前缀，运行时据此强制 attribute。
   */
  test('.attr modifier', () => {
    const node = parseWithVBind(`<div v-bind:foo-bar.attr="id"/>`)
    const props = (node.codegenNode as VNodeCall).props as ObjectExpression
    expect(props.properties[0]).toMatchObject({
      key: {
        content: `^foo-bar`,
        isStatic: true,
      },
      value: {
        content: `id`,
        isStatic: false,
      },
    })
  })

  /**
   * foo-bar.attr 省略值；检查 key 为 ^foo-bar，而简写表达式经驼峰化恢复为 fooBar。
   */
  test('.attr modifier w/ no expression', () => {
    const node = parseWithVBind(`<div v-bind:foo-bar.attr />`)
    const props = (node.codegenNode as VNodeCall).props as ObjectExpression
    expect(props.properties[0]).toMatchObject({
      key: {
        content: `^foo-bar`,
        isStatic: true,
      },
      value: {
        content: `fooBar`,
        isStatic: false,
      },
    })
  })

  /**
   * 动态参数 [arg] 省略值并收集诊断；检查 X_V_BIND_INVALID_SAME_NAME_ARGUMENT 定位整个参数，因为运行时 key 不能推导同名变量。
   */
  test('error on invalid argument for same-name shorthand', () => {
    const onError = vi.fn()
    parseWithVBind(`<div v-bind:[arg] />`, { onError })
    expect(onError.mock.calls[0][0]).toMatchObject({
      code: ErrorCodes.X_V_BIND_INVALID_SAME_NAME_ARGUMENT,
      loc: {
        start: {
          line: 1,
          column: 13,
        },
        end: {
          line: 1,
          column: 18,
        },
      },
    })
  })
})
