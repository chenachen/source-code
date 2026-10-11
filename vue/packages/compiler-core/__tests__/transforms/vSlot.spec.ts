/**
 * 组件插槽场景：覆盖具名/默认/动态插槽、组件级与 template 语法、v-if/v-for、作用域参数、
 * forwarded 标志和错误诊断，核对 slots 对象、createSlots 及稳定性标记。
 */
import {
  type CompilerOptions,
  type ComponentNode,
  type ElementNode,
  ErrorCodes,
  type ForNode,
  NodeTypes,
  type ObjectExpression,
  type RenderSlotCall,
  type SimpleExpressionNode,
  type SlotsExpression,
  type VNodeCall,
  generate,
  baseParse as parse,
  transform,
} from '../../src'
import { transformElement } from '../../src/transforms/transformElement'
import { transformOn } from '../../src/transforms/vOn'
import { transformBind } from '../../src/transforms/vBind'
import { transformExpression } from '../../src/transforms/transformExpression'
import { transformSlotOutlet } from '../../src/transforms/transformSlotOutlet'
import {
  trackSlotScopes,
  trackVForSlotScopes,
} from '../../src/transforms/vSlot'
import { CREATE_SLOTS, RENDER_LIST } from '../../src/runtimeHelpers'
import { createObjectMatcher } from '../testUtils'
import { PatchFlags } from '@vue/shared'
import { transformFor } from '../../src/transforms/vFor'
import { transformIf } from '../../src/transforms/vIf'
import { transformText } from '../../src/transforms/transformText'

/**
 * 按基础顺序运行结构、可选作用域/表达式、出口、元素、插槽跟踪和可选文本转换。
 * parser 这里只接收 whitespace；其余 options 传给 transform。逆序退出先撤销本层 slot 计数再构造 slots。
 * 返回根与首 child 的 codegen children；结构根返回 null，普通元素根的 children 也可能是模板数组。
 */
function parseWithSlots(
  template: string,
  options: CompilerOptions & {
    /** 是否在插槽测试管线中额外运行文本合并转换。 */
    transformText?: boolean
  } = {},
) {
  const ast = parse(template, {
    whitespace: options.whitespace,
  })
  transform(ast, {
    nodeTransforms: [
      transformIf,
      transformFor,
      ...(options.prefixIdentifiers
        ? [trackVForSlotScopes, transformExpression]
        : []),
      transformSlotOutlet,
      transformElement,
      trackSlotScopes,
      ...(options.transformText ? [transformText] : []),
    ],
    directiveTransforms: {
      on: transformOn,
      bind: transformBind,
    },
    ...options,
  })
  return {
    root: ast,
    slots:
      ast.children[0].type === NodeTypes.ELEMENT
        ? ((ast.children[0].codegenNode as VNodeCall)
            .children as SlotsExpression)
        : null,
  }
}

/**
 * 把键名映射到调用方给定的函数 matcher，再追加 STABLE/DYNAMIC 的 `_` 属性。
 * 方括号键表示动态名称并去除括号；这里只组装 partial matcher，不执行插槽函数。
 */
function createSlotMatcher(obj: Record<string, any>, isDynamic = false) {
  return {
    type: NodeTypes.JS_OBJECT_EXPRESSION,
    properties: Object.keys(obj)
      .map(key => {
        return {
          type: NodeTypes.JS_PROPERTY,
          key: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            isStatic: !/^\[/.test(key),
            content: key.replace(/^\[|\]$/g, ''),
          },
          value: obj[key],
        } as any
      })
      .concat({
        key: { content: `_` },
        value: {
          content: isDynamic ? `2 /* DYNAMIC */` : `1 /* STABLE */`,
          isStatic: false,
        },
      }),
  }
}

describe('compiler: transform component slots', () => {
  /**
   * Comp 只含 div 且开启前缀；检查隐式 default 无参函数返回 div，slots 标记 STABLE，并比对 _withCtx 生成快照。
   */
  test('implicit default slot', () => {
    const { root, slots } = parseWithSlots(`<Comp><div/></Comp>`, {
      prefixIdentifiers: true,
    })
    expect(slots).toMatchObject(
      createSlotMatcher({
        default: {
          type: NodeTypes.JS_FUNCTION_EXPRESSION,
          params: undefined,
          returns: [
            {
              type: NodeTypes.ELEMENT,
              tag: `div`,
            },
          ],
        },
      }),
    )
    expect(generate(root, { prefixIdentifiers: true }).code).toMatchSnapshot()
  })

  /**
   * 组件自身 v-slot 解构 foo，子树插值 foo/bar；检查 default 参数模式和局部 foo 保留，bar 加前缀，自己的 slot 参数不使插槽捕获外层。
   */
  test('on-component default slot', () => {
    const { root, slots } = parseWithSlots(
      `<Comp v-slot="{ foo }">{{ foo }}{{ bar }}</Comp>`,
      { prefixIdentifiers: true },
    )
    expect(slots).toMatchObject(
      createSlotMatcher({
        default: {
          type: NodeTypes.JS_FUNCTION_EXPRESSION,
          params: {
            type: NodeTypes.COMPOUND_EXPRESSION,
            children: [`{ `, { content: `foo` }, ` }`],
          },
          returns: [
            {
              type: NodeTypes.INTERPOLATION,
              content: {
                content: `foo`,
              },
            },
            {
              type: NodeTypes.INTERPOLATION,
              content: {
                content: `_ctx.bar`,
              },
            },
          ],
        },
      }),
    )
    expect(generate(root, { prefixIdentifiers: true }).code).toMatchSnapshot()
  })

  /**
   * 组件自身 v-slot:named 解构 foo；检查生成 named 函数，参数/局部与自由变量的前缀规则同默认插槽。
   */
  test('on component named slot', () => {
    const { root, slots } = parseWithSlots(
      `<Comp v-slot:named="{ foo }">{{ foo }}{{ bar }}</Comp>`,
      { prefixIdentifiers: true },
    )
    expect(slots).toMatchObject(
      createSlotMatcher({
        named: {
          type: NodeTypes.JS_FUNCTION_EXPRESSION,
          params: {
            type: NodeTypes.COMPOUND_EXPRESSION,
            children: [`{ `, { content: `foo` }, ` }`],
          },
          returns: [
            {
              type: NodeTypes.INTERPOLATION,
              content: {
                content: `foo`,
              },
            },
            {
              type: NodeTypes.INTERPOLATION,
              content: {
                content: `_ctx.bar`,
              },
            },
          ],
        },
      }),
    )
    expect(generate(root, { prefixIdentifiers: true }).code).toMatchSnapshot()
  })

  /**
   * 两个 template 分别声明 one 的 foo 与 two 的 bar；检查两作用域相互独立，各自参数保持局部，另一名字作为自由量加前缀。
   */
  test('template named slots', () => {
    const { root, slots } = parseWithSlots(
      `<Comp>
        <template v-slot:one="{ foo }">
          {{ foo }}{{ bar }}
        </template>
        <template #two="{ bar }">
          {{ foo }}{{ bar }}
        </template>
      </Comp>`,
      { prefixIdentifiers: true },
    )
    expect(slots).toMatchObject(
      createSlotMatcher({
        one: {
          type: NodeTypes.JS_FUNCTION_EXPRESSION,
          params: {
            type: NodeTypes.COMPOUND_EXPRESSION,
            children: [`{ `, { content: `foo` }, ` }`],
          },
          returns: [
            {
              type: NodeTypes.INTERPOLATION,
              content: {
                content: `foo`,
              },
            },
            {
              type: NodeTypes.INTERPOLATION,
              content: {
                content: `_ctx.bar`,
              },
            },
          ],
        },
        two: {
          type: NodeTypes.JS_FUNCTION_EXPRESSION,
          params: {
            type: NodeTypes.COMPOUND_EXPRESSION,
            children: [`{ `, { content: `bar` }, ` }`],
          },
          returns: [
            {
              type: NodeTypes.INTERPOLATION,
              content: {
                content: `_ctx.foo`,
              },
            },
            {
              type: NodeTypes.INTERPOLATION,
              content: {
                content: `bar`,
              },
            },
          ],
        },
      }),
    )
    expect(generate(root, { prefixIdentifiers: true }).code).toMatchSnapshot()
  })

  /**
   * 组件自身的插槽名为 [named]；检查计算 key 为 _ctx.named，作用域参数 foo 局部，slots 标记 DYNAMIC。
   */
  test('on component dynamically named slot', () => {
    const { root, slots } = parseWithSlots(
      `<Comp v-slot:[named]="{ foo }">{{ foo }}{{ bar }}</Comp>`,
      { prefixIdentifiers: true },
    )
    expect(slots).toMatchObject(
      createSlotMatcher(
        {
          '[_ctx.named]': {
            type: NodeTypes.JS_FUNCTION_EXPRESSION,
            params: {
              type: NodeTypes.COMPOUND_EXPRESSION,
              children: [`{ `, { content: `foo` }, ` }`],
            },
            returns: [
              {
                type: NodeTypes.INTERPOLATION,
                content: {
                  content: `foo`,
                },
              },
              {
                type: NodeTypes.INTERPOLATION,
                content: {
                  content: `_ctx.bar`,
                },
              },
            ],
          },
        },
        true,
      ),
    )
    expect(generate(root, { prefixIdentifiers: true }).code).toMatchSnapshot()
  })

  /**
   * 具名 one 之外有 bar 文本和 span；检查创建隐式 default 包住这两项，同时保留 one 的 foo 文本函数。
   */
  test('named slots w/ implicit default slot', () => {
    const { root, slots } = parseWithSlots(
      `<Comp>
        <template #one>foo</template>bar<span/>
      </Comp>`,
    )
    expect(slots).toMatchObject(
      createSlotMatcher({
        one: {
          type: NodeTypes.JS_FUNCTION_EXPRESSION,
          params: undefined,
          returns: [
            {
              type: NodeTypes.TEXT,
              content: `foo`,
            },
          ],
        },
        default: {
          type: NodeTypes.JS_FUNCTION_EXPRESSION,
          params: undefined,
          returns: [
            {
              type: NodeTypes.TEXT,
              content: `bar`,
            },
            {
              type: NodeTypes.ELEMENT,
              tag: `span`,
            },
          ],
        },
      }),
    )
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 具名 one 之外只有 NBSP 与换行；检查 NBSP 不是 HTML 可忽略空白，生成含规范化空白与 NBSP 的 default。
   */
  test('named slots w/ implicit default slot containing non-breaking space', () => {
    const { root, slots } = parseWithSlots(
      `<Comp>
        \u00a0
        <template #one>foo</template>
      </Comp>`,
    )
    expect(slots).toMatchObject(
      createSlotMatcher({
        one: {
          type: NodeTypes.JS_FUNCTION_EXPRESSION,
          params: undefined,
          returns: [
            {
              type: NodeTypes.TEXT,
              content: `foo`,
            },
          ],
        },
        default: {
          type: NodeTypes.JS_FUNCTION_EXPRESSION,
          params: undefined,
          returns: [
            {
              type: NodeTypes.TEXT,
              content: ` \u00a0 `,
            },
          ],
        },
      }),
    )
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 两个 template 的名称分别为 [one]/[two]，参数为 foo/bar；检查名称自由变量加前缀、参数作用域隔离，整组 slots 标记 DYNAMIC。
   */
  test('dynamically named slots', () => {
    const { root, slots } = parseWithSlots(
      `<Comp>
        <template v-slot:[one]="{ foo }">
          {{ foo }}{{ bar }}
        </template>
        <template #[two]="{ bar }">
          {{ foo }}{{ bar }}
        </template>
      </Comp>`,
      { prefixIdentifiers: true },
    )
    expect(slots).toMatchObject(
      createSlotMatcher(
        {
          '[_ctx.one]': {
            type: NodeTypes.JS_FUNCTION_EXPRESSION,
            params: {
              type: NodeTypes.COMPOUND_EXPRESSION,
              children: [`{ `, { content: `foo` }, ` }`],
            },
            returns: [
              {
                type: NodeTypes.INTERPOLATION,
                content: {
                  content: `foo`,
                },
              },
              {
                type: NodeTypes.INTERPOLATION,
                content: {
                  content: `_ctx.bar`,
                },
              },
            ],
          },
          '[_ctx.two]': {
            type: NodeTypes.JS_FUNCTION_EXPRESSION,
            params: {
              type: NodeTypes.COMPOUND_EXPRESSION,
              children: [`{ `, { content: `bar` }, ` }`],
            },
            returns: [
              {
                type: NodeTypes.INTERPOLATION,
                content: {
                  content: `_ctx.foo`,
                },
              },
              {
                type: NodeTypes.INTERPOLATION,
                content: {
                  content: `bar`,
                },
              },
            ],
          },
        },
        true,
      ),
    )
    expect(generate(root, { prefixIdentifiers: true }).code).toMatchSnapshot()
  })

  /**
   * 外层 default 声明 foo，Inner 插槽声明 bar；检查内部 foo/bar 局部、baz 加前缀，内层捕获 foo 所以 DYNAMIC_SLOTS；退出 Inner 后 bar 又变为 _ctx.bar。
   */
  test('nested slots scoping', () => {
    const { root, slots } = parseWithSlots(
      `<Comp>
        <template #default="{ foo }">
          <Inner v-slot="{ bar }">
            {{ foo }}{{ bar }}{{ baz }}
          </Inner>
          {{ foo }}{{ bar }}{{ baz }}
        </template>
      </Comp>`,
      { prefixIdentifiers: true },
    )
    expect(slots).toMatchObject(
      createSlotMatcher({
        default: {
          type: NodeTypes.JS_FUNCTION_EXPRESSION,
          params: {
            type: NodeTypes.COMPOUND_EXPRESSION,
            children: [`{ `, { content: `foo` }, ` }`],
          },
          returns: [
            {
              type: NodeTypes.ELEMENT,
              codegenNode: {
                type: NodeTypes.VNODE_CALL,
                tag: `_component_Inner`,
                props: undefined,
                children: createSlotMatcher(
                  {
                    default: {
                      type: NodeTypes.JS_FUNCTION_EXPRESSION,
                      params: {
                        type: NodeTypes.COMPOUND_EXPRESSION,
                        children: [`{ `, { content: `bar` }, ` }`],
                      },
                      returns: [
                        {
                          type: NodeTypes.INTERPOLATION,
                          content: {
                            content: `foo`,
                          },
                        },
                        {
                          type: NodeTypes.INTERPOLATION,
                          content: {
                            content: `bar`,
                          },
                        },
                        {
                          type: NodeTypes.INTERPOLATION,
                          content: {
                            content: `_ctx.baz`,
                          },
                        },
                      ],
                    },
                  },
                  true,
                ),
                // 此处内层插槽确实捕获外层 foo；即使开启精确前缀分析，也须标记 DYNAMIC_SLOTS。
                patchFlag: PatchFlags.DYNAMIC_SLOTS,
              },
            },
            // 用作用域参数验证捕获关系。
            {
              type: NodeTypes.TEXT,
              content: ` `,
            },
            {
              type: NodeTypes.INTERPOLATION,
              content: {
                content: `foo`,
              },
            },
            {
              type: NodeTypes.INTERPOLATION,
              content: {
                content: `_ctx.bar`,
              },
            },
            {
              type: NodeTypes.INTERPOLATION,
              content: {
                content: `_ctx.baz`,
              },
            },
          ],
        },
      }),
    )
    expect(generate(root, { prefixIdentifiers: true }).code).toMatchSnapshot()
  })

  /**
   * 不开启前缀，将只含静态 foo 的组件插槽放进 for；检查仍保守标记 DYNAMIC_SLOTS，缺少精确引用分析时按外层循环深度处理。
   */
  test('should force dynamic when inside v-for', () => {
    const { root } = parseWithSlots(
      `<div v-for="i in list">
        <Comp v-slot="bar">foo</Comp>
      </div>`,
    )
    const div = ((root.children[0] as ForNode).children[0] as ElementNode)
      .codegenNode as any
    const comp = div.children[0]
    expect(comp.codegenNode.patchFlag).toBe(PatchFlags.DYNAMIC_SLOTS)
  })

  /**
   * 开启前缀逐个比较九种场景：for 中静态内容、内层自身 bar、无参 fn() 均无动态槽标记；捕获 i、外层 foo、事件 fn(i)、默认值 i、动态名 [i] 均为 DYNAMIC_SLOTS；普通组件 prop :i 仅为 PROPS。只有插槽捕获才升级插槽动态性。
   */
  test('should only force dynamic slots when actually using scope vars w/ prefixIdentifiers: true', () => {
    /** 编译插槽并断言最终组件 patchFlag，区分捕获作用域与普通动态 prop。 */
    function assertDynamicSlots(
      template: string,
      expectedPatchFlag?: PatchFlags,
    ) {
      const { root } = parseWithSlots(template, { prefixIdentifiers: true })
      let flag: any
      if (root.children[0].type === NodeTypes.FOR) {
        const div = (root.children[0].children[0] as ElementNode)
          .codegenNode as any
        const comp = div.children[0]
        flag = comp.codegenNode.patchFlag
      } else {
        const innerComp = (root.children[0] as ComponentNode)
          .children[0] as ComponentNode
        flag = (innerComp.codegenNode as VNodeCall).patchFlag
      }
      if (expectedPatchFlag) {
        expect(flag).toBe(expectedPatchFlag)
      } else {
        expect(flag).toBeUndefined()
      }
    }

    assertDynamicSlots(
      `<div v-for="i in list">
        <Comp v-slot="bar">foo</Comp>
      </div>`,
    )

    assertDynamicSlots(
      `<div v-for="i in list">
        <Comp v-slot="bar">{{ i }}</Comp>
      </div>`,
      PatchFlags.DYNAMIC_SLOTS,
    )

    // 只引用组件自身 slot 参数不会捕获外层作用域，因此不应强制标记动态插槽。
    assertDynamicSlots(
      `<Comp v-slot="foo">
        <Comp v-slot="bar">{{ bar }}</Comp>
      </Comp>`,
    )

    assertDynamicSlots(
      `<Comp v-slot="foo">
        <Comp v-slot="bar">{{ foo }}</Comp>
      </Comp>`,
      PatchFlags.DYNAMIC_SLOTS,
    )

    // #2564：插槽事件处理器捕获外层 v-for 别名时必须标记 DYNAMIC_SLOTS。
    assertDynamicSlots(
      `<div v-for="i in list">
        <Comp v-slot="bar"><button @click="fn(i)" /></Comp>
      </div>`,
      PatchFlags.DYNAMIC_SLOTS,
    )

    assertDynamicSlots(
      `<div v-for="i in list">
        <Comp v-slot="bar"><button @click="fn()" /></Comp>
      </div>`,
    )

    // #9380：普通 prop 引用外层 v-for 别名只需要 PROPS patchFlag，不能误升级为动态插槽。
    assertDynamicSlots(
      `<div v-for="i in list">
        <Comp :i="i">foo</Comp>
      </div>`,
      PatchFlags.PROPS,
    )

    assertDynamicSlots(
      `<div v-for="i in list">
        <Comp v-slot="{ value = i }"><button @click="fn()" /></Comp>
      </div>`,
      PatchFlags.DYNAMIC_SLOTS,
    )

    assertDynamicSlots(
      `<div v-for="i in list">
        <Comp v-slot:[i]><button @click="fn()" /></Comp>
      </div>`,
      PatchFlags.DYNAMIC_SLOTS,
    )
  })

  /**
   * 具名 one 的 template 带 if ok；检查 CREATE_SLOTS 合并条件描述 {name,fn,key:0}，不命中为 undefined，组件增加 DYNAMIC_SLOTS。
   */
  test('named slot with v-if', () => {
    const { root, slots } = parseWithSlots(
      `<Comp>
        <template #one v-if="ok">hello</template>
      </Comp>`,
    )
    expect(slots).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: CREATE_SLOTS,
      arguments: [
        createObjectMatcher({
          _: `[2 /* DYNAMIC */]`,
        }),
        {
          type: NodeTypes.JS_ARRAY_EXPRESSION,
          elements: [
            {
              type: NodeTypes.JS_CONDITIONAL_EXPRESSION,
              test: { content: `ok` },
              consequent: createObjectMatcher({
                name: `one`,
                fn: {
                  type: NodeTypes.JS_FUNCTION_EXPRESSION,
                  returns: [{ type: NodeTypes.TEXT, content: `hello` }],
                },
                key: `0`,
              }),
              alternate: {
                content: `undefined`,
                isStatic: false,
              },
            },
          ],
        },
      ],
    })
    expect((root as any).children[0].codegenNode.patchFlag).toBe(
      PatchFlags.DYNAMIC_SLOTS,
    )
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 条件插槽开启前缀且参数 props；检查条件 _ctx.ok、函数参数/内容 props 保持局部，描述仍带 key 0。
   */
  test('named slot with v-if + prefixIdentifiers: true', () => {
    const { root, slots } = parseWithSlots(
      `<Comp>
        <template #one="props" v-if="ok">{{ props }}</template>
      </Comp>`,
      { prefixIdentifiers: true },
    )
    expect(slots).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: CREATE_SLOTS,
      arguments: [
        createObjectMatcher({
          _: `[2 /* DYNAMIC */]`,
        }),
        {
          type: NodeTypes.JS_ARRAY_EXPRESSION,
          elements: [
            {
              type: NodeTypes.JS_CONDITIONAL_EXPRESSION,
              test: { content: `_ctx.ok` },
              consequent: createObjectMatcher({
                name: `one`,
                fn: {
                  type: NodeTypes.JS_FUNCTION_EXPRESSION,
                  params: { content: `props` },
                  returns: [
                    {
                      type: NodeTypes.INTERPOLATION,
                      content: { content: `props` },
                    },
                  ],
                },
                key: `0`,
              }),
              alternate: {
                content: `undefined`,
                isStatic: false,
              },
            },
          ],
        },
      ],
    })
    expect((root as any).children[0].codegenNode.patchFlag).toBe(
      PatchFlags.DYNAMIC_SLOTS,
    )
    expect(generate(root, { prefixIdentifiers: true }).code).toMatchSnapshot()
  })

  /**
   * one if、two else-if、one else 三条件插槽；检查三元链的名称与函数分别保留，分支 key 为 0/1/2，模板 children 仍有三项供插槽收集。
   */
  test('named slot with v-if + v-else-if + v-else', () => {
    const { root, slots } = parseWithSlots(
      `<Comp>
        <template #one v-if="ok">foo</template>
        <template #two="props" v-else-if="orNot">bar</template>
        <template #one v-else>baz</template>
      </Comp>`,
    )
    expect(slots).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: CREATE_SLOTS,
      arguments: [
        createObjectMatcher({
          _: `[2 /* DYNAMIC */]`,
        }),
        {
          type: NodeTypes.JS_ARRAY_EXPRESSION,
          elements: [
            {
              type: NodeTypes.JS_CONDITIONAL_EXPRESSION,
              test: { content: `ok` },
              consequent: createObjectMatcher({
                name: `one`,
                fn: {
                  type: NodeTypes.JS_FUNCTION_EXPRESSION,
                  params: undefined,
                  returns: [{ type: NodeTypes.TEXT, content: `foo` }],
                },
                key: `0`,
              }),
              alternate: {
                type: NodeTypes.JS_CONDITIONAL_EXPRESSION,
                test: { content: `orNot` },
                consequent: createObjectMatcher({
                  name: `two`,
                  fn: {
                    type: NodeTypes.JS_FUNCTION_EXPRESSION,
                    params: { content: `props` },
                    returns: [{ type: NodeTypes.TEXT, content: `bar` }],
                  },
                  key: `1`,
                }),
                alternate: createObjectMatcher({
                  name: `one`,
                  fn: {
                    type: NodeTypes.JS_FUNCTION_EXPRESSION,
                    params: undefined,
                    returns: [{ type: NodeTypes.TEXT, content: `baz` }],
                  },
                  key: `2`,
                }),
              },
            },
          ],
        },
      ],
    })
    expect((root as any).children[0].codegenNode.patchFlag).toBe(
      PatchFlags.DYNAMIC_SLOTS,
    )
    expect((root as any).children[0].children.length).toBe(3)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 循环 template 用 #[name]，内容插值 name；检查来源 _ctx.list、循环参数/name key/内容均局部，由 RENDER_LIST 返回描述并交 CREATE_SLOTS 合并。
   */
  test('named slot with v-for w/ prefixIdentifiers: true', () => {
    const { root, slots } = parseWithSlots(
      `<Comp>
        <template v-for="name in list" #[name]>{{ name }}</template>
      </Comp>`,
      { prefixIdentifiers: true },
    )
    expect(slots).toMatchObject({
      type: NodeTypes.JS_CALL_EXPRESSION,
      callee: CREATE_SLOTS,
      arguments: [
        createObjectMatcher({
          _: `[2 /* DYNAMIC */]`,
        }),
        {
          type: NodeTypes.JS_ARRAY_EXPRESSION,
          elements: [
            {
              type: NodeTypes.JS_CALL_EXPRESSION,
              callee: RENDER_LIST,
              arguments: [
                { content: `_ctx.list` },
                {
                  type: NodeTypes.JS_FUNCTION_EXPRESSION,
                  params: [{ content: `name` }],
                  returns: createObjectMatcher({
                    name: `[name]`,
                    fn: {
                      type: NodeTypes.JS_FUNCTION_EXPRESSION,
                      returns: [
                        {
                          type: NodeTypes.INTERPOLATION,
                          content: { content: `name`, isStatic: false },
                        },
                      ],
                    },
                  }),
                },
              ],
            },
          ],
        },
      ],
    })
    expect((root as any).children[0].codegenNode.patchFlag).toBe(
      PatchFlags.DYNAMIC_SLOTS,
    )
    expect(generate(root, { prefixIdentifiers: true }).code).toMatchSnapshot()
  })

  // 转发插槽：检测插槽函数内容中的 `<slot>`，为运行时设置 FORWARDED 稳定性标志。
  describe('forwarded slots', () => {
    /** 共同 fixture 仅匹配默认插槽函数与 FORWARDED 标记，不断言出口内部每个参数。 */
    const toMatch = {
      type: NodeTypes.JS_OBJECT_EXPRESSION,
      properties: [
        {
          key: { content: `default` },
          value: { type: NodeTypes.JS_FUNCTION_EXPRESSION },
        },
        {
          key: { content: `_` },
          value: { content: `3 /* FORWARDED */` },
        },
      ],
    }
    /**
     * Comp 直接转发 slot outlet；检查 default 插槽函数与 FORWARDED 标记，稳定性由接收方结合父级 slots 决定。
     */
    test('<slot> tag only', () => {
      const { slots } = parseWithSlots(`<Comp><slot/></Comp>`)
      expect(slots).toMatchObject(toMatch)
    })

    /**
     * 转发出口带 if；检查递归进入条件分支仍发现出口，slots 保持 FORWARDED。
     */
    test('<slot> tag w/ v-if', () => {
      const { slots } = parseWithSlots(`<Comp><slot v-if="ok"/></Comp>`)
      expect(slots).toMatchObject(toMatch)
    })

    /**
     * 转发出口带 for；检查递归进入循环 children 仍发现出口，slots 保持 FORWARDED。
     */
    test('<slot> tag w/ v-for', () => {
      const { slots } = parseWithSlots(`<Comp><slot v-for="a in b"/></Comp>`)
      expect(slots).toMatchObject(toMatch)
    })

    /**
     * 转发出口放在显式 default template；检查穿过透明模板 children 检测到出口，slots 标记 FORWARDED。
     */
    test('<slot> tag w/ template', () => {
      const { slots } = parseWithSlots(
        `<Comp><template #default><slot/></template></Comp>`,
      )
      expect(slots).toMatchObject(toMatch)
    })

    /**
     * 出口位于嵌套 Comp 内；检查递归穿过组件子树检测转发，外层 default 仍标记 FORWARDED。
     */
    test('<slot w/ nested component>', () => {
      const { slots } = parseWithSlots(`<Comp><Comp><slot/></Comp></Comp>`)
      expect(slots).toMatchObject(toMatch)
    })

    // #6900：事件名参数的 camelCase 与 kebab-case 写法应生成一致的 handler key。
    /**
     * 分别给出口监听 foo:modelValue 与 foo:model-Value；检查传给插槽的事件 props 都规范化为 onFoo:modelValue，处理器 handler 保持成员值。
     */
    test('consistent behavior of @xxx:modelValue and @xxx:model-value', () => {
      const { root: rootUpper } = parseWithSlots(
        `<div><slot @foo:modelValue="handler" /></div>`,
      )
      const slotNodeUpper = (rootUpper.codegenNode! as VNodeCall)
        .children as ElementNode[]
      const propertiesObjUpper = (
        slotNodeUpper[0].codegenNode! as RenderSlotCall
      ).arguments[2]
      expect(propertiesObjUpper).toMatchObject({
        properties: [
          {
            key: {
              type: NodeTypes.SIMPLE_EXPRESSION,
              content: 'onFoo:modelValue',
            },
            value: {
              type: NodeTypes.SIMPLE_EXPRESSION,
              content: `handler`,
              isStatic: false,
            },
          },
        ],
      })

      const { root } = parseWithSlots(
        `<div><slot @foo:model-Value="handler" /></div>`,
      )
      const slotNode = (root.codegenNode! as VNodeCall)
        .children as ElementNode[]
      const propertiesObj = (slotNode[0].codegenNode! as RenderSlotCall)
        .arguments[2]
      expect(propertiesObj).toMatchObject({
        properties: [
          {
            key: {
              type: NodeTypes.SIMPLE_EXPRESSION,
              content: 'onFoo:modelValue',
            },
            value: {
              type: NodeTypes.SIMPLE_EXPRESSION,
              content: `handler`,
              isStatic: false,
            },
          },
        ],
      })
    })
  })

  // 错误分组：混合语法、重名、错位指令及显式默认插槽外的多余 children。
  describe('errors', () => {
    /**
     * 组件已显式声明 default，后面又有 bar 文本；检查额外默认内容错误精确定位 bar，返回式处理器忽略该额外内容。
     */
    test('error on extraneous children w/ named default slot', () => {
      const onError = vi.fn()
      const source = `<Comp><template #default>foo</template>bar</Comp>`
      parseWithSlots(source, { onError })
      const index = source.indexOf('bar')
      expect(onError.mock.calls[0][0]).toMatchObject({
        code: ErrorCodes.X_V_SLOT_EXTRANEOUS_DEFAULT_SLOT_CHILDREN,
        loc: {
          start: {
            offset: index,
            line: 1,
            column: index + 1,
          },
          end: {
            offset: index + 3,
            line: 1,
            column: index + 4,
          },
        },
      })
    })

    /**
     * 组件内两个 template 都声明 foo；检查重复名称错误定位第二个 #foo，编译期静态名称可判重并跳过后项。
     */
    test('error on duplicated slot names', () => {
      const onError = vi.fn()
      const source = `<Comp><template #foo></template><template #foo></template></Comp>`
      parseWithSlots(source, { onError })
      const index = source.lastIndexOf('#foo')
      expect(onError.mock.calls[0][0]).toMatchObject({
        code: ErrorCodes.X_V_SLOT_DUPLICATE_SLOT_NAMES,
        loc: {
          start: {
            offset: index,
            line: 1,
            column: index + 1,
          },
          end: {
            offset: index + 4,
            line: 1,
            column: index + 5,
          },
        },
      })
    })

    /**
     * 组件自身 v-slot 与内层 #foo 同时存在；检查混用错误定位内层指令，作用域不明确时停止继续收集内层插槽。
     */
    test('error on invalid mixed slot usage', () => {
      const onError = vi.fn()
      const source = `<Comp v-slot="foo"><template #foo></template></Comp>`
      parseWithSlots(source, { onError })
      const index = source.lastIndexOf('#foo')
      expect(onError.mock.calls[0][0]).toMatchObject({
        code: ErrorCodes.X_V_SLOT_MIXED_SLOT_USAGE,
        loc: {
          start: {
            offset: index,
            line: 1,
            column: index + 1,
          },
          end: {
            offset: index + 4,
            line: 1,
            column: index + 5,
          },
        },
      })
    })

    /**
     * 普通 div 使用 v-slot；检查错误定位完整指令，只有组件或 template 才具有插槽定义语义。
     */
    test('error on v-slot usage on plain elements', () => {
      const onError = vi.fn()
      const source = `<div v-slot/>`
      parseWithSlots(source, { onError })
      const index = source.indexOf('v-slot')
      expect(onError.mock.calls[0][0]).toMatchObject({
        code: ErrorCodes.X_V_SLOT_MISPLACED,
        loc: {
          start: {
            offset: index,
            line: 1,
            column: index + 1,
          },
          end: {
            offset: index + 6,
            line: 1,
            column: index + 7,
          },
        },
      })
    })
  })

  // preserve 空白模式：插槽边界空白不能被误认为额外默认内容或打断条件插槽邻接。
  describe(`with whitespace: 'preserve'`, () => {
    /**
     * preserve 模式下 header/default template 之间保留空白；检查不警告额外 default 内容并比对快照，纯空白不会与显式 default 冲突。
     */
    test('named default slot + implicit whitespace content', () => {
      const source = `
      <Comp>
        <template #header> Header </template>
        <template #default> Default </template>
      </Comp>
      `
      const { root } = parseWithSlots(source, {
        whitespace: 'preserve',
      })

      expect(
        `Extraneous children found when component already has explicitly named default slot.`,
      ).not.toHaveBeenWarned()
      expect(generate(root, { prefixIdentifiers: true }).code).toMatchSnapshot()
    })

    /**
     * preserve 模式下 header 外另有 p；检查不发默认槽冲突警告，快照确认 p 与周围空白进入隐式 default。
     */
    test('implicit default slot', () => {
      const source = `
      <Comp>
        <template #header> Header </template>
        <p/>
      </Comp>
      `
      const { root } = parseWithSlots(source, {
        whitespace: 'preserve',
      })

      expect(
        `Extraneous children found when component already has explicitly named default slot.`,
      ).not.toHaveBeenWarned()
      expect(generate(root, { prefixIdentifiers: true }).code).toMatchSnapshot()
    })

    /**
     * preserve 模式只有 header/footer 及间隔空白；检查 slots 仅三属性（含 `_`），没有 default，忽略全空白的隐式内容。
     */
    test('should not generate whitespace only default slot', () => {
      const source = `
      <Comp>
        <template #header> Header </template>
        <template #footer> Footer </template>
      </Comp>
      `
      const { root } = parseWithSlots(source, {
        whitespace: 'preserve',
      })

      // 组件 VNodeCall 的 children 即 slots 对象表达式。
      const slots = (root as any).children[0].codegenNode.children
        .properties as ObjectExpression['properties']

      // 应仅有 header、footer 与稳定性 `_`，不能凭空生成 default。
      expect(slots.length).toBe(3)
      expect(
        slots.some(p => (p.key as SimpleExpressionNode).content === 'default'),
      ).toBe(false)

      expect(generate(root, { prefixIdentifiers: true }).code).toMatchSnapshot()
    })

    /**
     * preserve 模式具名 header 外放 &nbsp;；检查存在 default，实体解码后的 NBSP 仍是有意义内容。
     */
    test('implicit default slot with non-breaking space', () => {
      const source = `
      <Comp>
        &nbsp;
        <template #header> Header </template>
      </Comp>
      `
      const { root } = parseWithSlots(source, {
        whitespace: 'preserve',
      })

      const slots = (root as any).children[0].codegenNode.children
        .properties as ObjectExpression['properties']

      expect(
        slots.some(p => (p.key as SimpleExpressionNode).content === 'default'),
      ).toBe(true)

      expect(generate(root, { prefixIdentifiers: true }).code).toMatchSnapshot()
    })

    /**
     * preserve 模式具名 one if 与 two else 之间有空白；快照检查仍生成同一条件插槽链，邻接搜索跳过 HTML 空白。
     */
    test('named slot with v-if + v-else', () => {
      const source = `
        <Comp>
          <template #one v-if="ok">foo</template>
          <template #two v-else>baz</template>
        </Comp>
      `
      const { root } = parseWithSlots(source, {
        whitespace: 'preserve',
      })

      expect(generate(root, { prefixIdentifiers: true }).code).toMatchSnapshot()
    })

    /**
     * preserve 模式条件插槽间还夹两注释，启用文本转换；快照检查注释/空白不打断 if/else 收集，TEXT_CALL 空白识别与插槽邻接配合。
     */
    test('named slot with v-if + v-else and comments', () => {
      const source = `
        <Comp>
          <template #one v-if="ok">foo</template>
          <!-- start -->

          <!-- end -->
          <template #two v-else>baz</template>
        </Comp>
      `
      const { root } = parseWithSlots(source, {
        transformText: true,
        whitespace: 'preserve',
      })

      expect(generate(root, { prefixIdentifiers: true }).code).toMatchSnapshot()
    })
  })
})
