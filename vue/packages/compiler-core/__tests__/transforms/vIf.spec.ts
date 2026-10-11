/**
 * `v-if` 场景：把相邻 if/else-if/else 合并成分支树，验证注释/空白邻接、重复 key、孤立 else
 * 诊断及递归三元 block 生成；issue 用例覆盖分支 key 与动态组件重建语义。
 */
import { baseParse as parse } from '../../src/parser'
import { transform } from '../../src/transform'
import { transformIf } from '../../src/transforms/vIf'
import { transformElement } from '../../src/transforms/transformElement'
import { transformSlotOutlet } from '../../src/transforms/transformSlotOutlet'
import { transformBind } from '../../src/transforms/vBind'
import {
  type CommentNode,
  type ConditionalExpression,
  type ElementNode,
  ElementTypes,
  type IfBranchNode,
  type IfConditionalExpression,
  type IfNode,
  NodeTypes,
  type SimpleExpressionNode,
  type TextNode,
  type VNodeCall,
} from '../../src/ast'
import { ErrorCodes } from '../../src/errors'
import {
  type CompilerOptions,
  TO_HANDLERS,
  generate,
  transformVBindShorthand,
} from '../../src'
import {
  CREATE_COMMENT,
  FRAGMENT,
  MERGE_PROPS,
  NORMALIZE_PROPS,
  RENDER_SLOT,
} from '../../src/runtimeHelpers'
import { createObjectMatcher } from '../testUtils'

/**
 * 解析并运行同名 bind 简写、if、slot outlet 和元素转换，返回根及 returnIndex 指定的 child。
 * 无自定义 onError 时断言根有 childrenLen 个 IfNode；收集式诊断场景跳过此结构断言，返回节点未必为 IfNode。
 * node 的类型断言供正常条件场景使用，不能据此推断错误恢复后的实际节点形态。
 */
function parseWithIfTransform(
  template: string,
  options: CompilerOptions = {},
  returnIndex: number = 0,
  childrenLen: number = 1,
) {
  const ast = parse(template, options)
  transform(ast, {
    nodeTransforms: [
      transformVBindShorthand,
      transformIf,
      transformSlotOutlet,
      transformElement,
    ],
    ...options,
  })
  if (!options.onError) {
    expect(ast.children.length).toBe(childrenLen)
    for (let i = 0; i < childrenLen; i++) {
      expect(ast.children[i].type).toBe(NodeTypes.IF)
    }
  }
  return {
    root: ast,
    node: ast.children[returnIndex] as IfNode & {
      /** 正常 if 场景所期望的条件生成节点；错误恢复场景未必符合此类型。 */
      codegenNode: IfConditionalExpression
    },
  }
}

describe('compiler: v-if', () => {
  // AST 转换：合并相邻条件指令、跳过可忽略空白/注释，并保留分支用户 key。
  describe('transform', () => {
    /**
     * 普通 div 带 v-if="ok"；检查被替换成一个 IfNode，其唯一分支保存条件 ok 与原 div child。
     */
    test('basic v-if', () => {
      const { node } = parseWithIfTransform(`<div v-if="ok"/>`)
      expect(node.type).toBe(NodeTypes.IF)
      expect(node.branches.length).toBe(1)
      expect((node.branches[0].condition as SimpleExpressionNode).content).toBe(
        `ok`,
      )
      expect(node.branches[0].children.length).toBe(1)
      expect(node.branches[0].children[0].type).toBe(NodeTypes.ELEMENT)
      expect((node.branches[0].children[0] as ElementNode).tag).toBe(`div`)
    })

    /**
     * template if 内有 div、hello、p；检查容器解包为分支的三项 children，静态文本与元素顺序保持。
     */
    test('template v-if', () => {
      const { node } = parseWithIfTransform(
        `<template v-if="ok"><div/>hello<p/></template>`,
      )
      expect(node.type).toBe(NodeTypes.IF)
      expect(node.branches.length).toBe(1)
      expect((node.branches[0].condition as SimpleExpressionNode).content).toBe(
        `ok`,
      )
      expect(node.branches[0].children.length).toBe(3)
      expect(node.branches[0].children[0].type).toBe(NodeTypes.ELEMENT)
      expect((node.branches[0].children[0] as ElementNode).tag).toBe(`div`)
      expect(node.branches[0].children[1].type).toBe(NodeTypes.TEXT)
      expect((node.branches[0].children[1] as TextNode).content).toBe(`hello`)
      expect(node.branches[0].children[2].type).toBe(NodeTypes.ELEMENT)
      expect((node.branches[0].children[2] as ElementNode).tag).toBe(`p`)
    })

    /**
     * 组件 Component 带 if；检查分支 child 仍是组件，并将其 VNodeCall 升为 block。即使运行时组件名解析回退成元素，也保留条件更新边界。
     */
    test('component v-if', () => {
      const { node } = parseWithIfTransform(`<Component v-if="ok"></Component>`)
      expect(node.type).toBe(NodeTypes.IF)
      expect(node.branches.length).toBe(1)
      expect((node.branches[0].children[0] as ElementNode).tag).toBe(
        `Component`,
      )
      expect((node.branches[0].children[0] as ElementNode).tagType).toBe(
        ElementTypes.COMPONENT,
      )
      // #2058：组件解析可能失败并回退为同名原生元素，因此条件分支根仍必须生成 block。
      expect(
        ((node.branches[0].children[0] as ElementNode)!
          .codegenNode as VNodeCall)!.isBlock,
      ).toBe(true)
    })

    /**
     * 相邻 div if 与 p else；检查合并为两分支，第一条件 ok，第二 condition 为 undefined，原父级不再保留独立 else 元素。
     */
    test('v-if + v-else', () => {
      const { node } = parseWithIfTransform(`<div v-if="ok"/><p v-else/>`)
      expect(node.type).toBe(NodeTypes.IF)
      expect(node.branches.length).toBe(2)

      const b1 = node.branches[0]
      expect((b1.condition as SimpleExpressionNode).content).toBe(`ok`)
      expect(b1.children.length).toBe(1)
      expect(b1.children[0].type).toBe(NodeTypes.ELEMENT)
      expect((b1.children[0] as ElementNode).tag).toBe(`div`)

      const b2 = node.branches[1]
      expect(b2.condition).toBeUndefined()
      expect(b2.children.length).toBe(1)
      expect(b2.children[0].type).toBe(NodeTypes.ELEMENT)
      expect((b2.children[0] as ElementNode).tag).toBe(`p`)
    })

    /**
     * 相邻 div if 与 p else-if；检查两分支条件分别 ok/orNot，各自保留原元素。
     */
    test('v-if + v-else-if', () => {
      const { node } = parseWithIfTransform(
        `<div v-if="ok"/><p v-else-if="orNot"/>`,
      )
      expect(node.type).toBe(NodeTypes.IF)
      expect(node.branches.length).toBe(2)

      const b1 = node.branches[0]
      expect((b1.condition as SimpleExpressionNode).content).toBe(`ok`)
      expect(b1.children.length).toBe(1)
      expect(b1.children[0].type).toBe(NodeTypes.ELEMENT)
      expect((b1.children[0] as ElementNode).tag).toBe(`div`)

      const b2 = node.branches[1]
      expect((b2.condition as SimpleExpressionNode).content).toBe(`orNot`)
      expect(b2.children.length).toBe(1)
      expect(b2.children[0].type).toBe(NodeTypes.ELEMENT)
      expect((b2.children[0] as ElementNode).tag).toBe(`p`)
    })

    /**
     * if、else-if、文本 template else 三分支；检查有序合并，末分支无条件且 template 解包后保存 fine 文本。
     */
    test('v-if + v-else-if + v-else', () => {
      const { node } = parseWithIfTransform(
        `<div v-if="ok"/><p v-else-if="orNot"/><template v-else>fine</template>`,
      )
      expect(node.type).toBe(NodeTypes.IF)
      expect(node.branches.length).toBe(3)

      const b1 = node.branches[0]
      expect((b1.condition as SimpleExpressionNode).content).toBe(`ok`)
      expect(b1.children.length).toBe(1)
      expect(b1.children[0].type).toBe(NodeTypes.ELEMENT)
      expect((b1.children[0] as ElementNode).tag).toBe(`div`)

      const b2 = node.branches[1]
      expect((b2.condition as SimpleExpressionNode).content).toBe(`orNot`)
      expect(b2.children.length).toBe(1)
      expect(b2.children[0].type).toBe(NodeTypes.ELEMENT)
      expect((b2.children[0] as ElementNode).tag).toBe(`p`)

      const b3 = node.branches[2]
      expect(b3.condition).toBeUndefined()
      expect(b3.children.length).toBe(1)
      expect(b3.children[0].type).toBe(NodeTypes.TEXT)
      expect((b3.children[0] as TextNode).content).toBe(`fine`)
    })

    /**
     * 在各分支间加入 foo/bar 注释；检查分支仍相邻，开发构建将注释移到其后分支 children 开头，原序列不被破坏。
     */
    test('comment between branches', () => {
      const { node } = parseWithIfTransform(`
        <div v-if="ok"/>
        <!--foo-->
        <p v-else-if="orNot"/>
        <!--bar-->
        <template v-else>fine</template>
      `)
      expect(node.type).toBe(NodeTypes.IF)
      expect(node.branches.length).toBe(3)

      const b1 = node.branches[0]
      expect((b1.condition as SimpleExpressionNode).content).toBe(`ok`)
      expect(b1.children.length).toBe(1)
      expect(b1.children[0].type).toBe(NodeTypes.ELEMENT)
      expect((b1.children[0] as ElementNode).tag).toBe(`div`)

      const b2 = node.branches[1]
      expect((b2.condition as SimpleExpressionNode).content).toBe(`orNot`)
      expect(b2.children.length).toBe(2)
      expect(b2.children[0].type).toBe(NodeTypes.COMMENT)
      expect((b2.children[0] as CommentNode).content).toBe(`foo`)
      expect(b2.children[1].type).toBe(NodeTypes.ELEMENT)
      expect((b2.children[1] as ElementNode).tag).toBe(`p`)

      const b3 = node.branches[2]
      expect(b3.condition).toBeUndefined()
      expect(b3.children.length).toBe(2)
      expect(b3.children[0].type).toBe(NodeTypes.COMMENT)
      expect((b3.children[0] as CommentNode).content).toBe(`bar`)
      expect(b3.children[1].type).toBe(NodeTypes.TEXT)
      expect((b3.children[1] as TextNode).content).toBe(`fine`)
    })

    /**
     * if 条件 ok 开启前缀；检查 processIf 在通用表达式转换前主动把条件改为 _ctx.ok。
     */
    test('should prefix v-if condition', () => {
      const { node } = parseWithIfTransform(`<div v-if="ok"/>`, {
        prefixIdentifiers: true,
      })
      expect(node.branches[0].condition).toMatchObject({
        type: NodeTypes.SIMPLE_EXPRESSION,
        content: `_ctx.ok`,
      })
    })

    // #11321：`:key` 同名简写必须先补全表达式，再作为分支用户 key 使用。
    /**
     * if 元素使用裸 :key；检查 shorthand 已补出 exp key，并保存为 branch.userKey，供重复 key 检查与注入优先级使用。
     */
    test('v-if + :key shorthand', () => {
      const { node } = parseWithIfTransform(`<div v-if="ok" :key></div>`)
      expect(node.type).toBe(NodeTypes.IF)
      expect(node.branches[0].userKey).toMatchObject({
        arg: { content: 'key' },
        exp: { content: 'key' },
      })
    })
  })

  // 错误场景：缺失条件、孤立 else 与重复分支 key。
  describe('errors', () => {
    /**
     * 分别输入孤立 else、普通元素前驱、普通文本隔断、if 后的文本隔断及 NBSP 隔断；五次诊断都定位对应 else 元素。只有 HTML 可忽略空白/注释允许连接分支。
     */
    test('error on v-else missing adjacent v-if', () => {
      const onError = vi.fn()

      const { node: node1 } = parseWithIfTransform(`<div v-else/>`, { onError })
      expect(onError.mock.calls[0]).toMatchObject([
        {
          code: ErrorCodes.X_V_ELSE_NO_ADJACENT_IF,
          loc: node1.loc,
        },
      ])

      const { node: node2 } = parseWithIfTransform(
        `<div/><div v-else/>`,
        { onError },
        1,
      )
      expect(onError.mock.calls[1]).toMatchObject([
        {
          code: ErrorCodes.X_V_ELSE_NO_ADJACENT_IF,
          loc: node2.loc,
        },
      ])

      const { node: node3 } = parseWithIfTransform(
        `<div/>foo<div v-else/>`,
        { onError },
        2,
      )
      expect(onError.mock.calls[2]).toMatchObject([
        {
          code: ErrorCodes.X_V_ELSE_NO_ADJACENT_IF,
          loc: node3.loc,
        },
      ])

      const { node: node4 } = parseWithIfTransform(
        `<div v-if="bar"/>foo<div v-else/>`,
        { onError },
        2,
      )
      expect(onError.mock.calls[3]).toMatchObject([
        {
          code: ErrorCodes.X_V_ELSE_NO_ADJACENT_IF,
          loc: node4.loc,
        },
      ])

      // 不换行空格不是可忽略的普通模板空白。
      const { node: node5 } = parseWithIfTransform(
        `<div v-if="bar"/>\u00a0<div v-else/>`,
        { onError },
        2,
      )
      expect(onError.mock.calls[4]).toMatchObject([
        {
          code: ErrorCodes.X_V_ELSE_NO_ADJACENT_IF,
          loc: node5.loc,
        },
      ])
    })

    /**
     * 分别输入孤立 else-if、普通元素/文本/NBSP 隔断以及最终 else 后再接 else-if；六次诊断定位后续元素。返回式处理器使最后的不可达分支仍被加入 branches，测试从该分支取 loc。
     */
    test('error on v-else-if missing adjacent v-if or v-else-if', () => {
      const onError = vi.fn()

      const { node: node1 } = parseWithIfTransform(`<div v-else-if="foo"/>`, {
        onError,
      })
      expect(onError.mock.calls[0]).toMatchObject([
        {
          code: ErrorCodes.X_V_ELSE_NO_ADJACENT_IF,
          loc: node1.loc,
        },
      ])

      const { node: node2 } = parseWithIfTransform(
        `<div/><div v-else-if="foo"/>`,
        { onError },
        1,
      )
      expect(onError.mock.calls[1]).toMatchObject([
        {
          code: ErrorCodes.X_V_ELSE_NO_ADJACENT_IF,
          loc: node2.loc,
        },
      ])

      const { node: node3 } = parseWithIfTransform(
        `<div/>foo<div v-else-if="foo"/>`,
        { onError },
        2,
      )
      expect(onError.mock.calls[2]).toMatchObject([
        {
          code: ErrorCodes.X_V_ELSE_NO_ADJACENT_IF,
          loc: node3.loc,
        },
      ])

      const { node: node4 } = parseWithIfTransform(
        `<div v-if="bar"/>foo<div v-else-if="foo"/>`,
        { onError },
        2,
      )
      expect(onError.mock.calls[3]).toMatchObject([
        {
          code: ErrorCodes.X_V_ELSE_NO_ADJACENT_IF,
          loc: node4.loc,
        },
      ])

      // NBSP 应作为真实分支间内容处理。
      const { node: node5 } = parseWithIfTransform(
        `<div v-if="bar"/>\u00a0<div v-else-if="foo"/>`,
        { onError },
        2,
      )
      expect(onError.mock.calls[4]).toMatchObject([
        {
          code: ErrorCodes.X_V_ELSE_NO_ADJACENT_IF,
          loc: node5.loc,
        },
      ])

      const {
        node: { branches },
      } = parseWithIfTransform(
        `<div v-if="notOk"/><div v-else/><div v-else-if="ok"/>`,
        { onError },
        0,
      )

      expect(onError.mock.calls[5]).toMatchObject([
        {
          code: ErrorCodes.X_V_ELSE_NO_ADJACENT_IF,
          loc: branches[branches.length - 1].loc,
        },
      ])
    })

    /**
     * if 后连续写两个 else；检查第二个 else 报相邻分支错误，收集式处理器仍留下末分支供 location 对照。
     */
    test('error on adjacent v-else', () => {
      const onError = vi.fn()

      const {
        node: { branches },
      } = parseWithIfTransform(
        `<div v-if="false"/><div v-else/><div v-else/>`,
        { onError },
        0,
      )

      expect(onError.mock.calls[0]).toMatchObject([
        {
          code: ErrorCodes.X_V_ELSE_NO_ADJACENT_IF,
          loc: branches[branches.length - 1].loc,
        },
      ])
    })

    /**
     * 分别让 if/else 使用相同动态表达式 a+1 与相同静态 key 1；检查两次 X_V_IF_SAME_KEY。静态值比较与简单动态文本比较都能发现重复身份。
     */
    test('error on user key', () => {
      const onError = vi.fn()
      // 动态 key。
      parseWithIfTransform(
        `<div v-if="ok" :key="a + 1" /><div v-else :key="a + 1" />`,
        { onError },
      )
      expect(onError.mock.calls[0]).toMatchObject([
        {
          code: ErrorCodes.X_V_IF_SAME_KEY,
        },
      ])
      // 静态 key。
      parseWithIfTransform(`<div v-if="ok" key="1" /><div v-else key="1" />`, {
        onError,
      })
      expect(onError.mock.calls[1]).toMatchObject([
        {
          code: ErrorCodes.X_V_IF_SAME_KEY,
        },
      ])
    })
  })

  // 代码生成：给每个分支注入稳定 key，并构造 block 或注释占位的递归条件表达式。
  describe('codegen', () => {
    /**
     * 断言固定 ok 条件的三元骨架；depth >= 1 时另检查 orNot 的第二层，hasElse 选择最终 block 或注释。
     * 此 helper 不递归任意深度，也不检查 key；每个用例另行断言标签与分支属性。
     */
    function assertSharedCodegen(
      node: IfConditionalExpression,
      depth: number = 0,
      hasElse: boolean = false,
    ) {
      expect(node).toMatchObject({
        type: NodeTypes.JS_CONDITIONAL_EXPRESSION,
        test: {
          content: `ok`,
        },
        consequent: {
          type: NodeTypes.VNODE_CALL,
          isBlock: true,
        },
        alternate:
          depth < 1
            ? hasElse
              ? {
                  type: NodeTypes.VNODE_CALL,
                  isBlock: true,
                }
              : {
                  type: NodeTypes.JS_CALL_EXPRESSION,
                  callee: CREATE_COMMENT,
                }
            : {
                type: NodeTypes.JS_CONDITIONAL_EXPRESSION,
                test: {
                  content: `orNot`,
                },
                consequent: {
                  type: NodeTypes.VNODE_CALL,
                  isBlock: true,
                },
                alternate: hasElse
                  ? {
                      type: NodeTypes.VNODE_CALL,
                      isBlock: true,
                    }
                  : {
                      type: NodeTypes.JS_CALL_EXPRESSION,
                      callee: CREATE_COMMENT,
                    },
              },
      })
    }

    /**
     * 基本 if 的 codegen；检查真分支为带 key 0 的 div block，假分支为 CREATE_COMMENT 调用，并比对生成快照。
     */
    test('basic v-if', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithIfTransform(`<div v-if="ok"/>`)
      assertSharedCodegen(codegenNode)
      expect(codegenNode.consequent).toMatchObject({
        tag: `"div"`,
        props: createObjectMatcher({ key: `[0]` }),
      })
      expect(codegenNode.alternate).toMatchObject({
        type: NodeTypes.JS_CALL_EXPRESSION,
        callee: CREATE_COMMENT,
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * template if 有多根；检查真分支生成带 key 0 的 Fragment，保留 div/hello/p，假分支为注释占位。
     */
    test('template v-if', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithIfTransform(`<template v-if="ok"><div/>hello<p/></template>`)
      assertSharedCodegen(codegenNode)
      expect(codegenNode.consequent).toMatchObject({
        tag: FRAGMENT,
        props: createObjectMatcher({ key: `[0]` }),
        children: [
          { type: NodeTypes.ELEMENT, tag: 'div' },
          { type: NodeTypes.TEXT, content: `hello` },
          { type: NodeTypes.ELEMENT, tag: 'p' },
        ],
      })
      expect(codegenNode.alternate).toMatchObject({
        type: NodeTypes.JS_CALL_EXPRESSION,
        callee: CREATE_COMMENT,
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * template if 只有 slot；检查真分支直接复用 RENDER_SLOT，分支 key 0 写入第六参数，省去额外 Fragment。
     */
    test('template v-if w/ single <slot/> child', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithIfTransform(`<template v-if="ok"><slot/></template>`)
      expect(codegenNode.consequent).toMatchObject({
        type: NodeTypes.JS_CALL_EXPRESSION,
        callee: RENDER_SLOT,
        arguments: [
          '$slots',
          '"default"',
          '{}',
          'undefined',
          'undefined',
          { content: '0' },
        ],
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 直接给 slot 加 if；检查同样复用 RENDER_SLOT，第六参数传 key 0，中间参数补齐占位。
     */
    test('v-if on <slot/>', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithIfTransform(`<slot v-if="ok"></slot>`)
      expect(codegenNode.consequent).toMatchObject({
        type: NodeTypes.JS_CALL_EXPRESSION,
        callee: RENDER_SLOT,
        arguments: [
          '$slots',
          '"default"',
          '{}',
          'undefined',
          'undefined',
          { content: '0' },
        ],
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * if slot 还带对象 v-bind；检查 props 保持 NORMALIZE_PROPS 调用，编译器 key 仍独立进入第六参数，不混入插槽 props。
     */
    test('v-if on <slot/> with v-bind', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithIfTransform(`<slot v-if="ok" v-bind="items"></slot>`, {
        directiveTransforms: {
          bind: transformBind,
        },
      })
      expect(codegenNode.consequent).toMatchObject({
        type: NodeTypes.JS_CALL_EXPRESSION,
        callee: RENDER_SLOT,
        arguments: [
          '$slots',
          '"default"',
          {
            type: NodeTypes.JS_CALL_EXPRESSION,
            callee: NORMALIZE_PROPS,
          },
          'undefined',
          'undefined',
          { content: '0' },
        ],
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * if div 与 else p 的 codegen；检查两者都是 block，key 分别 0/1，最终 alternate 直接是 p，不保留无用注释。
     */
    test('v-if + v-else', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithIfTransform(`<div v-if="ok"/><p v-else/>`)
      assertSharedCodegen(codegenNode, 0, true)
      expect(codegenNode.consequent).toMatchObject({
        tag: `"div"`,
        props: createObjectMatcher({ key: `[0]` }),
      })
      expect(codegenNode.alternate).toMatchObject({
        tag: `"p"`,
        props: createObjectMatcher({ key: `[1]` }),
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * if div 与 else-if p；检查 alternate 为第二层条件表达式，两个真分支的 key 为 0/1，未命中时保留注释占位。
     */
    test('v-if + v-else-if', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithIfTransform(`<div v-if="ok"/><p v-else-if="orNot" />`)
      assertSharedCodegen(codegenNode, 1)
      expect(codegenNode.consequent).toMatchObject({
        tag: `"div"`,
        props: createObjectMatcher({ key: `[0]` }),
      })
      const branch2 = codegenNode.alternate as ConditionalExpression
      expect(branch2.consequent).toMatchObject({
        tag: `"p"`,
        props: createObjectMatcher({ key: `[1]` }),
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * if、else-if 与文本 template else；检查递归条件结构中 key 依次 0/1/2，末文本分支由 Fragment 承载。
     */
    test('v-if + v-else-if + v-else', () => {
      const {
        root,
        node: { codegenNode },
      } = parseWithIfTransform(
        `<div v-if="ok"/><p v-else-if="orNot"/><template v-else>fine</template>`,
      )
      assertSharedCodegen(codegenNode, 1, true)
      expect(codegenNode.consequent).toMatchObject({
        tag: `"div"`,
        props: createObjectMatcher({ key: `[0]` }),
      })
      const branch2 = codegenNode.alternate as ConditionalExpression
      expect(branch2.consequent).toMatchObject({
        tag: `"p"`,
        props: createObjectMatcher({ key: `[1]` }),
      })
      expect(branch2.alternate).toMatchObject({
        tag: FRAGMENT,
        props: createObjectMatcher({ key: `[2]` }),
        children: [
          {
            type: NodeTypes.TEXT,
            content: `fine`,
          },
        ],
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 两个独立相邻 if 组；检查第一组 key 0、第二组 key 1，同一父层的条件组累计前方分支数，避免身份碰撞。
     */
    test('multiple v-if that are sibling nodes should have different keys', () => {
      const { root } = parseWithIfTransform(
        `<div v-if="ok"/><p v-if="orNot"/>`,
        {},
        0 /* 使用默认返回索引 */,
        2 /* 根条件组数量 */,
      )

      const ifNode = root.children[0] as IfNode & {
        /** 首个条件组的代码生成节点。 */
        codegenNode: IfConditionalExpression
      }
      expect(ifNode.codegenNode.consequent).toMatchObject({
        tag: `"div"`,
        props: createObjectMatcher({ key: `[0]` }),
      })
      const ifNode2 = root.children[1] as IfNode & {
        /** 第二个条件组的代码生成节点。 */
        codegenNode: IfConditionalExpression
      }
      expect(ifNode2.codegenNode.consequent).toMatchObject({
        tag: `"p"`,
        props: createObjectMatcher({ key: `[1]` }),
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 前方 if/else 两分支，后方 if/else-if/else 三分支；检查 key 连续为 0 至 4，后组从已有分支总数开始。
     */
    test('increasing key: v-if + v-else-if + v-else', () => {
      const { root } = parseWithIfTransform(
        `<div v-if="ok"/><p v-else/><div v-if="another"/><p v-else-if="orNot"/><p v-else/>`,
        {},
        0 /* 使用默认返回索引 */,
        2 /* 根条件组数量 */,
      )
      const ifNode = root.children[0] as IfNode & {
        /** 首个 if/else 条件组的代码生成节点。 */
        codegenNode: IfConditionalExpression
      }
      expect(ifNode.codegenNode.consequent).toMatchObject({
        tag: `"div"`,
        props: createObjectMatcher({ key: `[0]` }),
      })
      expect(ifNode.codegenNode.alternate).toMatchObject({
        tag: `"p"`,
        props: createObjectMatcher({ key: `[1]` }),
      })
      const ifNode2 = root.children[1] as IfNode & {
        /** 后续 if/else-if/else 条件组的代码生成节点。 */
        codegenNode: IfConditionalExpression
      }
      expect(ifNode2.codegenNode.consequent).toMatchObject({
        tag: `"div"`,
        props: createObjectMatcher({ key: `[2]` }),
      })
      const branch = ifNode2.codegenNode.alternate as IfConditionalExpression
      expect(branch.consequent).toMatchObject({
        tag: `"p"`,
        props: createObjectMatcher({ key: `[3]` }),
      })
      expect(branch.alternate).toMatchObject({
        tag: `"p"`,
        props: createObjectMatcher({ key: `[4]` }),
      })
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * if 元素只有对象 v-bind；检查穿透 normalize/guard 包装后生成 normalizeProps(mergeProps({key:0},obj))，注入不直接修改响应式来源。
     */
    test('key injection (only v-bind)', () => {
      const {
        node: { codegenNode },
      } = parseWithIfTransform(`<div v-if="ok" v-bind="obj"/>`)
      const branch1 = codegenNode.consequent as VNodeCall
      expect(branch1.props).toMatchObject({
        type: NodeTypes.JS_CALL_EXPRESSION,
        callee: NORMALIZE_PROPS,
        arguments: [
          {
            type: NodeTypes.JS_CALL_EXPRESSION,
            callee: MERGE_PROPS,
            arguments: [
              createObjectMatcher({ key: `[0]` }),
              { content: `obj` },
            ],
          },
        ],
      })
    })

    /**
     * 静态 id 出现在对象 bind 之前；检查 key 前插到 mergeProps 首个字面对象，obj 仍是后续参数。
     */
    test('key injection (before v-bind)', () => {
      const {
        node: { codegenNode },
      } = parseWithIfTransform(`<div v-if="ok" id="foo" v-bind="obj"/>`)
      const branch1 = codegenNode.consequent as VNodeCall
      expect(branch1.props).toMatchObject({
        type: NodeTypes.JS_CALL_EXPRESSION,
        callee: MERGE_PROPS,
        arguments: [
          createObjectMatcher({
            key: '[0]',
            id: 'foo',
          }),
          { content: `obj` },
        ],
      })
    })

    /**
     * 静态 id 出现在对象 bind 之后；检查新增 key 首对象，随后保留 obj 与 id 对象，用户覆盖顺序不改变。
     */
    test('key injection (after v-bind)', () => {
      const {
        node: { codegenNode },
      } = parseWithIfTransform(`<div v-if="ok" v-bind="obj" id="foo"/>`)
      const branch1 = codegenNode.consequent as VNodeCall
      expect(branch1.props).toMatchObject({
        type: NodeTypes.JS_CALL_EXPRESSION,
        callee: MERGE_PROPS,
        arguments: [
          createObjectMatcher({ key: `[0]` }),
          { content: `obj` },
          createObjectMatcher({
            id: 'foo',
          }),
        ],
      })
    })

    /**
     * if 元素带未知 v-foo；检查保留运行时 directives，并同时生成分支 key props。
     */
    test('key injection (w/ custom directive)', () => {
      const {
        node: { codegenNode },
      } = parseWithIfTransform(`<div v-if="ok" v-foo />`)
      const branch1 = codegenNode.consequent as VNodeCall
      expect(branch1.directives).not.toBeUndefined()
      expect(branch1.props).toMatchObject(createObjectMatcher({ key: `[0]` }))
    })

    // #6631：已有用户 key 的 mergeProps 首对象不能再注入编译器 key，避免重复属性声明。
    /**
     * if 元素已有静态 custom_key，后接对象 bind；检查首个字面对象只保留用户 key，不再插入重复编译器 key。
     */
    test('avoid duplicate keys', () => {
      const {
        node: { codegenNode },
      } = parseWithIfTransform(`<div v-if="ok" key="custom_key" v-bind="obj"/>`)
      const branch1 = codegenNode.consequent as VNodeCall
      expect(branch1.props).toMatchObject({
        type: NodeTypes.JS_CALL_EXPRESSION,
        callee: MERGE_PROPS,
        arguments: [
          createObjectMatcher({
            key: 'custom_key',
          }),
          { content: `obj` },
        ],
      })
    })

    /**
     * if/else-if/else 之间只有普通空格；检查正常合并且三分支 key 为 0/1/2，空白不打断条件链。
     */
    test('with spaces between branches', () => {
      const {
        node: { codegenNode },
      } = parseWithIfTransform(
        `<div v-if="ok"/> <div v-else-if="no"/> <div v-else/>`,
      )
      expect(codegenNode.consequent).toMatchObject({
        tag: `"div"`,
        props: createObjectMatcher({ key: `[0]` }),
      })
      const branch = codegenNode.alternate as ConditionalExpression
      expect(branch.consequent).toMatchObject({
        tag: `"div"`,
        props: createObjectMatcher({ key: `[1]` }),
      })
      expect(branch.alternate).toMatchObject({
        tag: `"div"`,
        props: createObjectMatcher({ key: `[2]` }),
      })
    })

    /**
     * 外层 template if 中有嵌套 if/else 和多处注释；逐项检查 comment1/2/3/4 分别留在原子树或迁到后分支，嵌套条件组保持两分支。
     */
    test('with comments', () => {
      const { node } = parseWithIfTransform(`
          <template v-if="ok">
            <!--comment1-->
            <div v-if="ok2">
              <!--comment2-->
            </div>
            <!--comment3-->
            <b v-else/>
            <!--comment4-->
            <p/>
          </template>
        `)
      expect(node.type).toBe(NodeTypes.IF)
      expect(node.branches.length).toBe(1)

      const b1 = node.branches[0]
      expect((b1.condition as SimpleExpressionNode).content).toBe(`ok`)
      expect(b1.children.length).toBe(4)

      expect(b1.children[0].type).toBe(NodeTypes.COMMENT)
      expect((b1.children[0] as CommentNode).content).toBe(`comment1`)

      expect(b1.children[1].type).toBe(NodeTypes.IF)
      expect((b1.children[1] as IfNode).branches.length).toBe(2)
      const b1b1: ElementNode = (b1.children[1] as IfNode).branches[0]
        .children[0] as ElementNode
      expect(b1b1.type).toBe(NodeTypes.ELEMENT)
      expect(b1b1.tag).toBe('div')
      expect(b1b1.children[0].type).toBe(NodeTypes.COMMENT)
      expect((b1b1.children[0] as CommentNode).content).toBe('comment2')

      const b1b2: IfBranchNode = (b1.children[1] as IfNode)
        .branches[1] as IfBranchNode
      expect(b1b2.children[0].type).toBe(NodeTypes.COMMENT)
      expect((b1b2.children[0] as CommentNode).content).toBe(`comment3`)
      expect(b1b2.children[1].type).toBe(NodeTypes.ELEMENT)
      expect((b1b2.children[1] as ElementNode).tag).toBe(`b`)

      expect(b1.children[2].type).toBe(NodeTypes.COMMENT)
      expect((b1.children[2] as CommentNode).content).toBe(`comment4`)

      expect(b1.children[3].type).toBe(NodeTypes.ELEMENT)
      expect((b1.children[3] as ElementNode).tag).toBe(`p`)
    })

    // #6843：生产模式显式开启 comments 时，注释不能打断 v-if/v-else 邻接或改变分支结构。
    /**
     * 临时切到生产构建并显式保留 comments，编译同一嵌套条件模板；公共 helper 验证外层仍为单 IfNode，代码生成不抛错。此用例不逐项断言生产注释位置。
     */
    test('should parse correctly with comments: true in prod', () => {
      __DEV__ = false
      parseWithIfTransform(
        `
          <template v-if="ok">
            <!--comment1-->
            <div v-if="ok2">
              <!--comment2-->
            </div>
            <!--comment3-->
            <b v-else/>
            <!--comment4-->
            <p/>
          </template>
        `,
        { comments: true },
      )
      __DEV__ = true
    })
  })

  /**
   * button 同时带对象 v-on 与 if；检查 props 为 mergeProps({key:0},toHandlers(...))，key 不进入 TO_HANDLERS 的事件名转换。
   */
  test('v-on with v-if', () => {
    const {
      node: { codegenNode },
    } = parseWithIfTransform(
      `<button v-on="{ click: clickEvent }" v-if="true">w/ v-if</button>`,
    )

    expect((codegenNode.consequent as any).props.type).toBe(
      NodeTypes.JS_CALL_EXPRESSION,
    )
    expect((codegenNode.consequent as any).props.callee).toBe(MERGE_PROPS)
    expect(
      (codegenNode.consequent as any).props.arguments[0].properties[0].value
        .content,
    ).toBe('0')
    expect((codegenNode.consequent as any).props.arguments[1].callee).toBe(
      TO_HANDLERS,
    )
  })
})
