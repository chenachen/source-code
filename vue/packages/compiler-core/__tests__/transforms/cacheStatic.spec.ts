/**
 * 静态缓存分析场景：区分可整体缓存、仅 props 可提升、必须保留运行时 patch 的节点；
 * 覆盖 prefixIdentifiers、组件、作用域变量、v-for，以及 HMR 场景的缓存数组展开读取。
 */
import {
  type CompilerOptions,
  ConstantTypes,
  type ElementNode,
  type ForNode,
  type IfNode,
  NodeTypes,
  type VNodeCall,
  generate,
  baseParse as parse,
  transform,
} from '../../src'
import {
  FRAGMENT,
  NORMALIZE_CLASS,
  RENDER_LIST,
} from '../../src/runtimeHelpers'
import { transformElement } from '../../src/transforms/transformElement'
import { transformExpression } from '../../src/transforms/transformExpression'
import { transformIf } from '../../src/transforms/vIf'
import { transformFor } from '../../src/transforms/vFor'
import { transformBind } from '../../src/transforms/vBind'
import { transformOn } from '../../src/transforms/vOn'
import { createObjectMatcher } from '../testUtils'
import { transformText } from '../../src/transforms/transformText'
import { PatchFlags } from '@vue/shared'

/** 匹配被 `_cache` 包裹且取出时需要数组展开的静态 children。 */
const cachedChildrenArrayMatcher = (
  tags: string[],
  needArraySpread = true,
) => ({
  type: NodeTypes.JS_CACHE_EXPRESSION,
  needArraySpread,
  value: {
    type: NodeTypes.JS_ARRAY_EXPRESSION,
    elements: tags.map(tag => {
      if (tag === '') {
        return {
          type: NodeTypes.TEXT_CALL,
        }
      } else {
        return {
          type: NodeTypes.ELEMENT,
          codegenNode: {
            type: NodeTypes.VNODE_CALL,
            tag: JSON.stringify(tag),
          },
        }
      }
    }),
  },
})

/** 解析模板并运行结构、元素、文本与静态缓存转换；返回根 AST，代码由用例另行 generate。 */
function transformWithCache(template: string, options: CompilerOptions = {}) {
  const ast = parse(template)
  transform(ast, {
    hoistStatic: true,
    nodeTransforms: [
      transformIf,
      transformFor,
      ...(options.prefixIdentifiers ? [transformExpression] : []),
      transformElement,
      transformText,
    ],
    directiveTransforms: {
      on: transformOn,
      bind: transformBind,
    },
    ...options,
  })
  expect(ast.codegenNode).toMatchObject({
    type: NodeTypes.VNODE_CALL,
    isBlock: true,
  })
  return ast
}

describe('compiler: cacheStatic transform', () => {
  /**
   * 场景：唯一根 div 完全静态，转换后仍是 VNodeCall 且缓存槽为零，验证静态优化保留单根 block 自身。
   */
  test('should NOT cache root node', () => {
    // 即使整棵树静态，根仍需保持 block；优化 patch 才能直接跳过其 children。
    const root = transformWithCache(`<div/>`)
    expect(root.codegenNode).toMatchObject({
      type: NodeTypes.VNODE_CALL,
      tag: `"div"`,
    })
    expect(root.cached.length).toBe(0)
  })

  /**
   * 场景：两个静态 span 同为模板根，断言根 Fragment 的 children 分别包入缓存、总计两槽，验证根 codegen 尚未建立时采用单节点缓存。
   */
  test('cache root node children', () => {
    // 当前 transform 阶段拿不到最终根 codegenNode，因此只能逐个缓存根 children。
    const root = transformWithCache(
      `<span class="inline">hello</span><span class="inline">hello</span>`,
    )
    expect(root.codegenNode).toMatchObject({
      type: NodeTypes.VNODE_CALL,
      children: [
        { codegenNode: { type: NodeTypes.JS_CACHE_EXPRESSION } },
        { codegenNode: { type: NodeTypes.JS_CACHE_EXPRESSION } },
      ],
    })
    expect(root.cached.length).toBe(2)
  })

  /**
   * 场景：div 只有一个静态 span，断言 children 整体为数组缓存、需要展开读取且仅一槽，验证全部静态子项合并缓存。
   */
  test('cache single children array', () => {
    const root = transformWithCache(
      `<div><span class="inline">hello</span></div>`,
    )
    expect(root.codegenNode).toMatchObject({
      tag: `"div"`,
      props: undefined,
      children: cachedChildrenArrayMatcher(['span']),
    })
    expect(root.cached.length).toBe(1)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 场景：div 下两个 p 各有两个 span，断言只缓存外层 [p,p] 数组且总计一槽，验证整棵静态后代归入同一缓存而不重复留内层槽。
   */
  test('cache nested children array', () => {
    const root = transformWithCache(
      `<div><p><span/><span/></p><p><span/><span/></p></div>`,
    )
    expect((root.codegenNode as VNodeCall).children).toMatchObject(
      cachedChildrenArrayMatcher(['p', 'p']),
    )
    expect(root.cached.length).toBe(1)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 场景：静态后代 div 内含 comment，断言外层 children 数组仍可缓存且一槽，验证模板注释不破坏普通 VNode 静态缓存。
   */
  test('cache nested static tree with comments', () => {
    const root = transformWithCache(`<div><div><!--comment--></div></div>`)
    expect((root.codegenNode as VNodeCall).children).toMatchObject(
      cachedChildrenArrayMatcher(['div']),
    )
    expect(root.cached.length).toBe(1)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 场景：div 子项依次 span、foo 文本、div，matcher 同时匹配元素和 TEXT_CALL，总计一槽，验证文本调用与元素可共用静态 children 数组缓存。
   */
  test('cache siblings including text with common non-hoistable parent', () => {
    const root = transformWithCache(`<div><span/>foo<div/></div>`)
    expect((root.codegenNode as VNodeCall).children).toMatchObject(
      cachedChildrenArrayMatcher(['span', '', 'div']),
    )
    expect(root.cached.length).toBe(1)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 场景：Foo 默认槽含动态 x 文本和静态 span，断言文本调用保留、第二个 child 为缓存元素，验证混合插槽只缓存独立静态项。
   */
  test('cache inside default slot', () => {
    const root = transformWithCache(`<Foo>{{x}}<span/></Foo>`)
    expect((root.codegenNode as VNodeCall).children).toMatchObject({
      properties: [
        {
          key: { content: 'default' },
          value: {
            type: NodeTypes.JS_FUNCTION_EXPRESSION,
            returns: [
              {
                type: NodeTypes.TEXT_CALL,
              },
              // 动态文本后的第二个 child 是独立静态元素，可缓存。
              {
                type: NodeTypes.ELEMENT,
                codegenNode: {
                  type: NodeTypes.JS_CACHE_EXPRESSION,
                },
              },
            ],
          },
        },
        {/* _ 插槽稳定性标记的占位匹配 */},
      ],
    })
  })

  /**
   * 场景：Foo 默认槽只有两个静态 span，断言槽函数 returns 是缓存数组，验证静态插槽返回值整体缓存。
   */
  test('cache default slot as a whole', () => {
    const root = transformWithCache(`<Foo><span/><span/></Foo>`)
    expect((root.codegenNode as VNodeCall).children).toMatchObject({
      properties: [
        {
          key: { content: 'default' },
          value: {
            type: NodeTypes.JS_FUNCTION_EXPRESSION,
            returns: {
              type: NodeTypes.JS_CACHE_EXPRESSION,
              value: {
                type: NodeTypes.JS_ARRAY_EXPRESSION,
                elements: [
                  { type: NodeTypes.ELEMENT },
                  { type: NodeTypes.ELEMENT },
                ],
              },
            },
          },
        },
        {/* _ 插槽稳定性标记的占位匹配 */},
      ],
    })
  })

  /**
   * 场景：具名 foo 槽含动态 x 和静态 span，断言具名属性保留、文本调用与缓存元素并存，验证具名槽采用相同的局部静态优化。
   */
  test('cache inside named slot', () => {
    const root = transformWithCache(
      `<Foo><template #foo>{{x}}<span/></template></Foo>`,
    )
    expect((root.codegenNode as VNodeCall).children).toMatchObject({
      properties: [
        {
          key: { content: 'foo' },
          value: {
            type: NodeTypes.JS_FUNCTION_EXPRESSION,
            returns: [
              {
                type: NodeTypes.TEXT_CALL,
              },
              // 只缓存动态文本后的静态 span。
              {
                type: NodeTypes.ELEMENT,
                codegenNode: {
                  type: NodeTypes.JS_CACHE_EXPRESSION,
                },
              },
            ],
          },
        },
        {/* _ 插槽稳定性标记的占位匹配 */},
      ],
    })
  })

  /**
   * 场景：具名 foo 槽含两个静态 span，断言槽函数整体返回缓存数组，验证缓存针对内容而非仅默认槽名称。
   */
  test('cache named slot as a whole', () => {
    const root = transformWithCache(
      `<Foo><template #foo><span/><span/></template></Foo>`,
    )
    expect((root.codegenNode as VNodeCall).children).toMatchObject({
      properties: [
        {
          key: { content: 'foo' },
          value: {
            type: NodeTypes.JS_FUNCTION_EXPRESSION,
            returns: {
              type: NodeTypes.JS_CACHE_EXPRESSION,
              value: {
                type: NodeTypes.JS_ARRAY_EXPRESSION,
                elements: [
                  { type: NodeTypes.ELEMENT },
                  { type: NodeTypes.ELEMENT },
                ],
              },
            },
          },
        },
        {/* _ 插槽稳定性标记的占位匹配 */},
      ],
    })
  })

  /**
   * 场景：动态槽名 [foo] 配两个静态 span，断言槽 key 仍动态而返回值整体缓存，验证名称动态不影响这组固定内容的缓存。
   */
  test('cache dynamically named slot as a whole', () => {
    const root = transformWithCache(
      `<Foo><template #[foo]><span/><span/></template></Foo>`,
    )
    expect((root.codegenNode as VNodeCall).children).toMatchObject({
      properties: [
        {
          key: { content: 'foo', isStatic: false },
          value: {
            type: NodeTypes.JS_FUNCTION_EXPRESSION,
            returns: {
              type: NodeTypes.JS_CACHE_EXPRESSION,
              value: {
                type: NodeTypes.JS_ARRAY_EXPRESSION,
                elements: [
                  { type: NodeTypes.ELEMENT },
                  { type: NodeTypes.ELEMENT },
                ],
              },
            },
          },
        },
        {/* _ 插槽稳定性标记的占位匹配 */},
      ],
    })
  })

  /**
   * 场景：开启标识符前缀并使用动态槽名 [foo+1]，断言 key 为复合表达式、两 span 仍整体缓存，验证名称表达式和内容静态分析独立。
   */
  test('cache dynamically named (expression) slot as a whole', () => {
    const root = transformWithCache(
      `<Foo><template #[foo+1]><span/><span/></template></Foo>`,
      { prefixIdentifiers: true },
    )
    expect((root.codegenNode as VNodeCall).children).toMatchObject({
      properties: [
        {
          key: { type: NodeTypes.COMPOUND_EXPRESSION },
          value: {
            type: NodeTypes.JS_FUNCTION_EXPRESSION,
            returns: {
              type: NodeTypes.JS_CACHE_EXPRESSION,
              value: {
                type: NodeTypes.JS_ARRAY_EXPRESSION,
                elements: [
                  { type: NodeTypes.ELEMENT },
                  { type: NodeTypes.ELEMENT },
                ],
              },
            },
          },
        },
        {/* _ 插槽稳定性标记的占位匹配 */},
      ],
    })
  })

  /**
   * 场景：div 包 Comp，断言 Comp 仍是组件 VNodeCall 且无缓存槽，验证组件调用不作为纯静态原生子树缓存。
   */
  test('should NOT cache components', () => {
    const root = transformWithCache(`<div><Comp/></div>`)
    expect((root.codegenNode as VNodeCall).children).toMatchObject([
      {
        type: NodeTypes.ELEMENT,
        codegenNode: {
          type: NodeTypes.VNODE_CALL,
          tag: `_component_Comp`,
        },
      },
    ])
    expect(root.cached.length).toBe(0)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 场景：子 div 的 id 读取 foo，断言节点无缓存、保留 PROPS 标记并把动态属性名列表提升到 _hoisted_1，验证动态值与固定键列表采用不同优化。
   */
  test('should NOT cache element with dynamic props (but hoist the props list)', () => {
    const root = transformWithCache(`<div><div :id="foo"/></div>`)
    expect(root.hoists.length).toBe(1)
    expect((root.codegenNode as VNodeCall).children).toMatchObject([
      {
        type: NodeTypes.ELEMENT,
        codegenNode: {
          type: NodeTypes.VNODE_CALL,
          tag: `"div"`,
          props: createObjectMatcher({
            id: `[foo]`,
          }),
          children: undefined,
          patchFlag: PatchFlags.PROPS,
          dynamicProps: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: `_hoisted_1`,
            isStatic: false,
          },
        },
      },
    ])
    expect(root.cached.length).toBe(0)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 场景：子 div 的 key 是静态 foo，断言 children 数组可缓存且一槽，验证静态身份键不阻止子树缓存。
   */
  test('cache element with static key', () => {
    const root = transformWithCache(`<div><div key="foo"/></div>`)
    expect(root.codegenNode).toMatchObject({
      tag: `"div"`,
      props: undefined,
      children: cachedChildrenArrayMatcher(['div']),
    })
    expect(root.cached.length).toBe(1)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 场景：子 div 的 key 读取 foo，断言仍保留 key 表达式且无缓存槽，验证动态身份键阻止复用静态 VNode。
   */
  test('should NOT cache element with dynamic key', () => {
    const root = transformWithCache(`<div><div :key="foo"/></div>`)
    expect((root.codegenNode as VNodeCall).children).toMatchObject([
      {
        type: NodeTypes.ELEMENT,
        codegenNode: {
          type: NodeTypes.VNODE_CALL,
          tag: `"div"`,
          props: createObjectMatcher({
            key: `[foo]`,
          }),
        },
      },
    ])
    expect(root.cached.length).toBe(0)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 场景：子 div 的 ref 读取 foo，断言 NEED_PATCH 且无缓存槽，验证动态 ref 需要保留运行时更新路径。
   */
  test('should NOT cache element with dynamic ref', () => {
    const root = transformWithCache(`<div><div :ref="foo"/></div>`)
    expect((root.codegenNode as VNodeCall).children).toMatchObject([
      {
        type: NodeTypes.ELEMENT,
        codegenNode: {
          type: NodeTypes.VNODE_CALL,
          tag: `"div"`,
          props: createObjectMatcher({
            ref: `[foo]`,
          }),
          children: undefined,
          patchFlag: PatchFlags.NEED_PATCH,
        },
      },
    ])
    expect(root.cached.length).toBe(0)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 场景：子 div 有静态 id 与 v-foo 指令，断言只提升 id props、保留指令数组和 NEED_PATCH、无节点缓存，验证指令生命周期阻止整体静态缓存。
   */
  test('hoist static props for elements with directives', () => {
    const root = transformWithCache(`<div><div id="foo" v-foo/></div>`)
    expect(root.hoists).toMatchObject([createObjectMatcher({ id: 'foo' })])
    expect((root.codegenNode as VNodeCall).children).toMatchObject([
      {
        type: NodeTypes.ELEMENT,
        codegenNode: {
          type: NodeTypes.VNODE_CALL,
          tag: `"div"`,
          props: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: `_hoisted_1`,
          },
          children: undefined,
          patchFlag: PatchFlags.NEED_PATCH,
          directives: {
            type: NodeTypes.JS_ARRAY_EXPRESSION,
          },
        },
      },
    ])
    expect(root.cached.length).toBe(0)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 场景：子 div 有静态 id 和 hello 插值，断言 props 提升、插值保留 TEXT 标记、无节点缓存，验证动态 children 与静态 props 分开优化。
   */
  test('hoist static props for elements with dynamic text children', () => {
    const root = transformWithCache(
      `<div><div id="foo">{{ hello }}</div></div>`,
    )
    expect(root.hoists).toMatchObject([createObjectMatcher({ id: 'foo' })])
    expect((root.codegenNode as VNodeCall).children).toMatchObject([
      {
        type: NodeTypes.ELEMENT,
        codegenNode: {
          type: NodeTypes.VNODE_CALL,
          tag: `"div"`,
          props: { content: `_hoisted_1` },
          children: { type: NodeTypes.INTERPOLATION },
          patchFlag: PatchFlags.TEXT,
        },
      },
    ])
    expect(root.cached.length).toBe(0)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 场景：带静态 id 的子 div 包 Comp，断言 id props 提升而组件 child 保留、无缓存槽，验证不可缓存后代不会阻止独立 props 提升。
   */
  test('hoist static props for elements with unhoistable children', () => {
    const root = transformWithCache(`<div><div id="foo"><Comp/></div></div>`)
    expect(root.hoists).toMatchObject([createObjectMatcher({ id: 'foo' })])
    expect((root.codegenNode as VNodeCall).children).toMatchObject([
      {
        type: NodeTypes.ELEMENT,
        codegenNode: {
          type: NodeTypes.VNODE_CALL,
          tag: `"div"`,
          props: { content: `_hoisted_1` },
          children: [{ type: NodeTypes.ELEMENT, tag: `Comp` }],
        },
      },
    ])
    expect(root.cached.length).toBe(0)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 场景：条件 div 有静态 id/span，断言分支注入 key=0 的 props 被提升、div 保持 block、span children 一槽缓存，验证条件根与静态后代的缓存边界。
   */
  test('should cache v-if props/children if static', () => {
    const root = transformWithCache(
      `<div><div v-if="ok" id="foo"><span/></div></div>`,
    )
    expect(root.hoists).toMatchObject([
      createObjectMatcher({
        key: `[0]`, // v-if 分支注入的身份键
        id: 'foo',
      }),
    ])
    expect(
      ((root.children[0] as ElementNode).children[0] as IfNode).codegenNode,
    ).toMatchObject({
      type: NodeTypes.JS_CONDITIONAL_EXPRESSION,
      consequent: {
        // block 负责动态子节点追踪，不能整体缓存。
        type: NodeTypes.VNODE_CALL,
        tag: `"div"`,
        props: { content: `_hoisted_1` },
        children: cachedChildrenArrayMatcher(['span']),
      },
    })
    expect(root.cached.length).toBe(1)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 场景：列表单项 div 有静态 id/span，断言外层 UNKEYED_FRAGMENT/renderList、内层 props 提升及 span 数组缓存，验证循环控制结构保留而独立静态数据可优化。
   */
  test('should hoist v-for children if static', () => {
    const root = transformWithCache(
      `<div><div v-for="i in list" id="foo"><span/></div></div>`,
    )
    expect(root.hoists).toMatchObject([
      createObjectMatcher({
        id: 'foo',
      }),
    ])
    const forBlockCodegen = (
      (root.children[0] as ElementNode).children[0] as ForNode
    ).codegenNode
    expect(forBlockCodegen).toMatchObject({
      type: NodeTypes.VNODE_CALL,
      tag: FRAGMENT,
      props: undefined,
      children: {
        type: NodeTypes.JS_CALL_EXPRESSION,
        callee: RENDER_LIST,
      },
      patchFlag: PatchFlags.UNKEYED_FRAGMENT,
    })
    const innerBlockCodegen = forBlockCodegen!.children.arguments[1]
    expect(innerBlockCodegen.returns).toMatchObject({
      type: NodeTypes.VNODE_CALL,
      tag: `"div"`,
      props: { content: `_hoisted_1` },
      children: cachedChildrenArrayMatcher(['span']),
    })
    expect(root.cached.length).toBe(1)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 场景：根注释之后只有一个带静态 id 的 div 及多层后代，断言根 div props 提升、后代一槽缓存、注释和根 VNodeCall 保留，验证唯一有效元素根判定排除注释。
   */
  test('should hoist props for root with single element excluding comments', () => {
    // 根级注释不改变唯一元素根判定：根 div 的 props 可提升，静态后代可缓存，根本身保留 VNodeCall。
    const root = transformWithCache(
      `<!--comment--><div id="a"><div id="b"><div id="c"><div id="d"><div id="e">hello</div></div></div></div></div>`,
    )
    expect(root.cached.length).toBe(1)
    expect(root.hoists).toMatchObject([createObjectMatcher({ id: 'a' })])

    expect((root.codegenNode as VNodeCall).children).toMatchObject([
      {
        type: NodeTypes.COMMENT,
        content: 'comment',
      },
      {
        type: NodeTypes.ELEMENT,
        codegenNode: {
          type: NodeTypes.VNODE_CALL,
          tag: `"div"`,
          props: { content: `_hoisted_1` },
          children: { type: NodeTypes.JS_CACHE_EXPRESSION },
        },
      },
    ])
    expect(generate(root).code).toMatchSnapshot()
  })

  // 标识符前缀模式可精确识别模板局部量，因此单独验证更积极但安全的静态提升结果。
  describe('prefixIdentifiers', () => {
    /**
     * 场景：开启前缀，span 内容含文字和 1/true 插值，断言整个 span 归入 children 缓存且一槽，验证字面量插值按常量处理。
     */
    test('cache nested static tree with static interpolation', () => {
      const root = transformWithCache(
        `<div><span>foo {{ 1 }} {{ true }}</span></div>`,
        {
          prefixIdentifiers: true,
        },
      )
      expect(root.codegenNode).toMatchObject({
        tag: `"div"`,
        props: undefined,
        children: cachedChildrenArrayMatcher(['span']),
      })
      expect(root.cached.length).toBe(1)
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 场景：开启前缀，span 的 foo 绑定为 0、插值为 1，断言整个 span 缓存，验证常量绑定与常量文本可共同达到静态条件。
     */
    test('cache nested static tree with static prop value', () => {
      const root = transformWithCache(
        `<div><span :foo="0">{{ 1 }}</span></div>`,
        {
          prefixIdentifiers: true,
        },
      )
      expect(root.codegenNode).toMatchObject({
        tag: `"div"`,
        props: undefined,
        children: cachedChildrenArrayMatcher(['span']),
      })
      expect(root.cached.length).toBe(1)
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 场景：开启前缀，span 的 class 为静态对象而 bar 插值动态，断言 normalizeClass 对象 props 提升、bar 访问 _ctx 并保留 TEXT，验证常量 helper 调用可提升而文本仍更新。
     */
    test('hoist class with static object value', () => {
      const root = transformWithCache(
        `<div><span :class="{ foo: true }">{{ bar }}</span></div>`,
        {
          prefixIdentifiers: true,
        },
      )

      expect(root.hoists).toMatchObject([
        {
          type: NodeTypes.JS_OBJECT_EXPRESSION,
          properties: [
            {
              key: {
                content: `class`,
                isStatic: true,
                constType: ConstantTypes.CAN_STRINGIFY,
              },
              value: {
                type: NodeTypes.JS_CALL_EXPRESSION,
                callee: NORMALIZE_CLASS,
                arguments: [
                  {
                    content: `{ foo: true }`,
                    isStatic: false,
                    constType: ConstantTypes.CAN_STRINGIFY,
                  },
                ],
              },
            },
          ],
        },
      ])
      expect(root.codegenNode).toMatchObject({
        tag: `"div"`,
        props: undefined,
        children: [
          {
            type: NodeTypes.ELEMENT,
            codegenNode: {
              type: NodeTypes.VNODE_CALL,
              tag: `"span"`,
              props: {
                type: NodeTypes.SIMPLE_EXPRESSION,
                content: `_hoisted_1`,
              },
              children: {
                type: NodeTypes.INTERPOLATION,
                content: {
                  content: `_ctx.bar`,
                  isStatic: false,
                  constType: ConstantTypes.NOT_CONSTANT,
                },
              },
              patchFlag: PatchFlags.TEXT,
            },
          },
        ],
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 场景：for 局部 o 出现在 span 插值中，开启前缀后断言零缓存并核对快照，验证局部迭代值不被视作实例间固定常量。
     */
    test('should NOT cache expressions that refer scope variables', () => {
      const root = transformWithCache(
        `<div><p v-for="o in list"><span>{{ o }}</span></p></div>`,
        {
          prefixIdentifiers: true,
        },
      )

      expect(root.cached.length).toBe(0)
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 场景：局部 o 参与 o+'foo' 复合插值，断言仍零缓存并核对快照，验证加入字面量片段不会消除作用域依赖。
     */
    test('should NOT cache expressions that refer scope variables (2)', () => {
      const root = transformWithCache(
        `<div><p v-for="o in list"><span>{{ o + 'foo' }}</span></p></div>`,
        {
          prefixIdentifiers: true,
        },
      )

      expect(root.cached.length).toBe(0)
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 场景：Comp 槽解构 foo 并在插值读取，断言零缓存并核对快照，验证 slot 参数依赖保留逐次求值。
     */
    test('should NOT cache expressions that refer scope variables (v-slot)', () => {
      const root = transformWithCache(
        `<Comp v-slot="{ foo }">{{ foo }}</Comp>`,
        {
          prefixIdentifiers: true,
        },
      )

      expect(root.cached.length).toBe(0)
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 场景：开启前缀和 handler 缓存，深层 div 绑定 click=foo；断言一槽但无 hoist，快照确认该槽只缓存 handler，验证 handler 缓存不提升整个元素静态等级。
     */
    test('should NOT cache elements with cached handlers', () => {
      const root = transformWithCache(
        `<div><div><div @click="foo"/></div></div>`,
        {
          prefixIdentifiers: true,
          cacheHandlers: true,
        },
      )

      expect(root.cached.length).toBe(1)
      expect(root.hoists.length).toBe(0)
      expect(
        generate(root, {
          mode: 'module',
          prefixIdentifiers: true,
        }).code,
      ).toMatchSnapshot()
    })

    /**
     * 场景：同一事件元素另有常量 class 对象，断言仍只有 handler 一槽且无 hoist，快照保留 class 规范化，验证其他常量绑定不能绕过 handler 的节点缓存边界。
     */
    test('should NOT cache elements with cached handlers + other bindings', () => {
      const root = transformWithCache(
        `<div><div><div :class="{}" @click="foo"/></div></div>`,
        {
          prefixIdentifiers: true,
          cacheHandlers: true,
        },
      )

      expect(root.cached.length).toBe(1)
      expect(root.hoists.length).toBe(0)
      expect(
        generate(root, {
          mode: 'module',
          prefixIdentifiers: true,
        }).code,
      ).toMatchSnapshot()
    })

    /**
     * 场景：带 item key 的 template v-for 包静态 span，断言无 hoist、快照把 key 注入逐项 span block，验证需要动态身份的循环单项不能作为固定节点复用。
     */
    test('should NOT cache keyed template v-for with plain element child', () => {
      const root = transformWithCache(
        `<div><template v-for="item in items" :key="item"><span/></template></div>`,
      )
      expect(root.hoists.length).toBe(0)
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 场景：svg 带自定义指令，path 完全静态，断言仅缓存 svg children 数组、svg 自身仍保留，验证指令根与静态 SVG 后代分开处理。
     */
    test('should NOT cache SVG with directives', () => {
      const root = transformWithCache(
        `<div><svg v-foo><path d="M2,3H5.5L12"/></svg></div>`,
      )
      expect(root.cached.length).toBe(1)
      expect(root.codegenNode).toMatchObject({
        children: [
          {
            tag: 'svg',
            // 只缓存 SVG children，不缓存 SVG 根标签本身。
            codegenNode: {
              children: {
                type: NodeTypes.JS_CACHE_EXPRESSION,
              },
            },
          },
        ],
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 场景：hmr=true 的 v-for 单项含静态 span，断言 UNKEYED_FRAGMENT、缓存一槽且 children.needArraySpread=true，快照确认 [...缓存数组]，验证读取时复制数组容器。
     */
    test('clone hoisted array children in v-for + HMR mode', () => {
      const root = transformWithCache(
        `<div><div v-for="i in 1"><span class="hi"></span></div></div>`,
        {
          hmr: true,
        },
      )
      expect(root.cached.length).toBe(1)
      const forBlockCodegen = (
        (root.children[0] as ElementNode).children[0] as ForNode
      ).codegenNode
      expect(forBlockCodegen).toMatchObject({
        type: NodeTypes.VNODE_CALL,
        tag: FRAGMENT,
        props: undefined,
        children: {
          type: NodeTypes.JS_CALL_EXPRESSION,
          callee: RENDER_LIST,
        },
        patchFlag: PatchFlags.UNKEYED_FRAGMENT,
      })
      const innerBlockCodegen = forBlockCodegen!.children.arguments[1]
      expect(innerBlockCodegen.returns).toMatchObject({
        type: NodeTypes.VNODE_CALL,
        tag: `"div"`,
        children: cachedChildrenArrayMatcher(
          ['span'],
          true /* 展开缓存数组，复制容器 */,
        ),
      })
      expect(generate(root).code).toMatchSnapshot()
    })
  })
})
