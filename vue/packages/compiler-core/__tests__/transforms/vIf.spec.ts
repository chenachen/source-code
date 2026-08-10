/**
 * `v-if` 场景：把相邻 if/else-if/else 合并成分支树，验证注释/空白邻接、重复 key、缺失条件
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

/** 解析并运行 v-if 结构转换，返回条件分支 AST 与代码生成节点。 */
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
      /** 测试管线完成后必定存在的条件代码生成节点。 */
      codegenNode: IfConditionalExpression
    },
  }
}

describe('compiler: v-if', () => {
  // AST 转换：合并相邻条件指令、跳过可忽略空白/注释，并保留分支用户 key。
  describe('transform', () => {
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
    /** 递归断言条件表达式每层 test、block 分支、key 与最终 else/注释占位。 */
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

    test('multiple v-if that are sibling nodes should have different keys', () => {
      const { root } = parseWithIfTransform(
        `<div v-if="ok"/><p v-if="orNot"/>`,
        {},
        0 /* returnIndex, just give the default value */,
        2 /* childrenLen */,
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

    test('increasing key: v-if + v-else-if + v-else', () => {
      const { root } = parseWithIfTransform(
        `<div v-if="ok"/><p v-else/><div v-if="another"/><p v-else-if="orNot"/><p v-else/>`,
        {},
        0 /* returnIndex, just give the default value */,
        2 /* childrenLen */,
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

    test('key injection (w/ custom directive)', () => {
      const {
        node: { codegenNode },
      } = parseWithIfTransform(`<div v-if="ok" v-foo />`)
      const branch1 = codegenNode.consequent as VNodeCall
      expect(branch1.directives).not.toBeUndefined()
      expect(branch1.props).toMatchObject(createObjectMatcher({ key: `[0]` }))
    })

    // #6631：动态组件的 v-if 各分支要使用唯一 key，避免切换组件类型时复用错误实例。
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
