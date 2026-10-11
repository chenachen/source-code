/**
 * 文本转换场景：合并相邻文本与插值、按父节点语义决定是否创建 Text VNode，并验证动态
 * 文本 patchFlag；回归场景防止父元素的文本快速路径清空同一元素内自定义指令插入的 DOM。
 */
import {
  type CompilerOptions,
  type ElementNode,
  type ForNode,
  NodeTypes,
  generate,
  isWhitespaceText,
  baseParse as parse,
  transform,
} from '../../src'
import { transformFor } from '../../src/transforms/vFor'
import { transformText } from '../../src/transforms/transformText'
import { transformExpression } from '../../src/transforms/transformExpression'
import { transformElement } from '../../src/transforms/transformElement'
import { CREATE_TEXT } from '../../src/runtimeHelpers'
import { genFlagText } from '../testUtils'
import { PatchFlags } from '@vue/shared'

/** 按需启用标识符前缀并运行元素/循环/文本转换，返回文本优化后的根 AST。 */
function transformWithTextOpt(template: string, options: CompilerOptions = {}) {
  const ast = parse(template)
  transform(ast, {
    nodeTransforms: [
      transformFor,
      ...(options.prefixIdentifiers ? [transformExpression] : []),
      transformElement,
      transformText,
    ],
    ...options,
  })
  return ast
}

describe('compiler: transform text', () => {
  /**
   * 根只有 {{ foo }} 一个插值；检查它保持 INTERPOLATION，生成快照核对根 codegen 的包装。文本转换不必先把单个根文本改成 TEXT_CALL。
   */
  test('no consecutive text', () => {
    const root = transformWithTextOpt(`{{ foo }}`)
    expect(root.children[0]).toMatchObject({
      type: NodeTypes.INTERPOLATION,
      content: {
        content: `foo`,
      },
    })
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 根由 foo 插值、静态 bar 和 baz 插值连续组成；检查 children 合并成一个 COMPOUND_EXPRESSION，按原顺序用加号连接三段文本。
   */
  test('consecutive text', () => {
    const root = transformWithTextOpt(`{{ foo }} bar {{ baz }}`)
    expect(root.children.length).toBe(1)
    expect(root.children[0]).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        { type: NodeTypes.INTERPOLATION, content: { content: `foo` } },
        ` + `,
        { type: NodeTypes.TEXT, content: ` bar ` },
        ` + `,
        { type: NodeTypes.INTERPOLATION, content: { content: `baz` } },
      ],
    })
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 两侧 div 之间连续混合插值与文本；检查根保留三项 children，中间成为 CREATE_TEXT 调用并携带 TEXT 标记，以维持数组中的 VNode 位置。
   */
  test('consecutive text between elements', () => {
    const root = transformWithTextOpt(`<div/>{{ foo }} bar {{ baz }}<div/>`)
    expect(root.children.length).toBe(3)
    expect(root.children[0].type).toBe(NodeTypes.ELEMENT)
    expect(root.children[1]).toMatchObject({
      // 与元素混排时必须显式创建 Text VNode，运行时才能维持 children 位置。
      type: NodeTypes.TEXT_CALL,
      codegenNode: {
        type: NodeTypes.JS_CALL_EXPRESSION,
        callee: CREATE_TEXT,
        arguments: [
          {
            type: NodeTypes.COMPOUND_EXPRESSION,
            children: [
              { type: NodeTypes.INTERPOLATION, content: { content: `foo` } },
              ` + `,
              { type: NodeTypes.TEXT, content: ` bar ` },
              ` + `,
              { type: NodeTypes.INTERPOLATION, content: { content: `baz` } },
            ],
          },
          genFlagText(PatchFlags.TEXT),
        ],
      },
    })
    expect(root.children[2].type).toBe(NodeTypes.ELEMENT)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 两侧 div 之间是静态 hello；检查它仍成为 CREATE_TEXT 调用，但不传 TEXT 更新标记，静态内容无需比较。
   */
  test('text between elements (static)', () => {
    const root = transformWithTextOpt(`<div/>hello<div/>`)
    expect(root.children.length).toBe(3)
    expect(root.children[0].type).toBe(NodeTypes.ELEMENT)
    expect(root.children[1]).toMatchObject({
      // 即使静态文本与元素混排，也要生成 Text VNode 调用而非裸字符串。
      type: NodeTypes.TEXT_CALL,
      codegenNode: {
        type: NodeTypes.JS_CALL_EXPRESSION,
        callee: CREATE_TEXT,
        arguments: [
          {
            type: NodeTypes.TEXT,
            content: `hello`,
          },
          // 纯静态文本无需 patchFlag。
        ],
      },
    })
    expect(root.children[2].type).toBe(NodeTypes.ELEMENT)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 元素之间含 hello 与两格空白；检查两种文本都转成 TEXT_CALL，isWhitespaceText 仍仅识别规范化后的空白节点。
   */
  test('whitespace text', () => {
    const root = transformWithTextOpt(`<div/>hello<div/>  <div/>`)
    expect(root.children.length).toBe(5)
    expect(root.children[0].type).toBe(NodeTypes.ELEMENT)
    expect(root.children[1].type).toBe(NodeTypes.TEXT_CALL)
    expect(root.children[2].type).toBe(NodeTypes.ELEMENT)
    expect(root.children[3].type).toBe(NodeTypes.TEXT_CALL)
    expect(root.children[4].type).toBe(NodeTypes.ELEMENT)

    expect(root.children.map(isWhitespaceText)).toEqual([
      false,
      false,
      false,
      true,
      false,
    ])
  })

  /**
   * 多个元素间分别放动态连续文本和静态 hello；检查合并后五项 children，动态文本有 TEXT 标记，静态文本没有，两种转换保持原顺序。
   */
  test('consecutive text mixed with elements', () => {
    const root = transformWithTextOpt(
      `<div/>{{ foo }} bar {{ baz }}<div/>hello<div/>`,
    )
    expect(root.children.length).toBe(5)
    expect(root.children[0].type).toBe(NodeTypes.ELEMENT)
    expect(root.children[1]).toMatchObject({
      type: NodeTypes.TEXT_CALL,
      codegenNode: {
        type: NodeTypes.JS_CALL_EXPRESSION,
        callee: CREATE_TEXT,
        arguments: [
          {
            type: NodeTypes.COMPOUND_EXPRESSION,
            children: [
              { type: NodeTypes.INTERPOLATION, content: { content: `foo` } },
              ` + `,
              { type: NodeTypes.TEXT, content: ` bar ` },
              ` + `,
              { type: NodeTypes.INTERPOLATION, content: { content: `baz` } },
            ],
          },
          genFlagText(PatchFlags.TEXT),
        ],
      },
    })
    expect(root.children[2].type).toBe(NodeTypes.ELEMENT)
    expect(root.children[3]).toMatchObject({
      type: NodeTypes.TEXT_CALL,
      codegenNode: {
        type: NodeTypes.JS_CALL_EXPRESSION,
        callee: CREATE_TEXT,
        arguments: [
          {
            type: NodeTypes.TEXT,
            content: `hello`,
          },
        ],
      },
    })
    expect(root.children[4].type).toBe(NodeTypes.ELEMENT)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * template v-for 的内容只有 foo 文本；检查 ForNode 的子节点转成 TEXT_CALL，列表/Fragment 的数组 children 需要显式 VNode。
   */
  test('<template v-for>', () => {
    const root = transformWithTextOpt(
      `<template v-for="i in list">foo</template>`,
    )
    expect(root.children[0].type).toBe(NodeTypes.FOR)
    const forNode = root.children[0] as ForNode
    // template v-for 的文本 children 位于 Fragment 数组中，必须转换为显式 Text VNode。
    expect(forNode.children[0]).toMatchObject({
      type: NodeTypes.TEXT_CALL,
    })
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 连续文本中的 foo 与 baz + qux 开启前缀；检查插值内部先完成 _ctx 改写，再由文本退出转换将其按顺序合并。
   */
  test('with prefixIdentifiers: true', () => {
    const root = transformWithTextOpt(`{{ foo }} bar {{ baz + qux }}`, {
      prefixIdentifiers: true,
    })
    expect(root.children.length).toBe(1)
    expect(root.children[0]).toMatchObject({
      type: NodeTypes.COMPOUND_EXPRESSION,
      children: [
        { type: NodeTypes.INTERPOLATION, content: { content: `_ctx.foo` } },
        ` + `,
        { type: NodeTypes.TEXT, content: ` bar ` },
        ` + `,
        {
          type: NodeTypes.INTERPOLATION,
          content: {
            type: NodeTypes.COMPOUND_EXPRESSION,
            children: [{ content: `_ctx.baz` }, ` + `, { content: `_ctx.qux` }],
          },
        },
      ],
    })
    expect(
      generate(root, {
        prefixIdentifiers: true,
      }).code,
    ).toMatchSnapshot()
  })

  // #3756：元素仅有一个文本 child 但带自定义指令时，不能走会跳过指令 DOM 变更的文本快速路径。
  /**
   * 父 p 带未知 v-foo 且只有一个插值；检查不走直接 textContent 的单文本快速路径，而生成带 TEXT 标记的 CREATE_TEXT，保留指令可能插入的其他 DOM。
   */
  test('element with custom directives and only one text child node', () => {
    const root = transformWithTextOpt(`<p v-foo>{{ foo }}</p>`)
    expect(root.children.length).toBe(1)
    expect(root.children[0].type).toBe(NodeTypes.ELEMENT)
    expect((root.children[0] as ElementNode).children[0]).toMatchObject({
      type: NodeTypes.TEXT_CALL,
      codegenNode: {
        type: NodeTypes.JS_CALL_EXPRESSION,
        callee: CREATE_TEXT,
        arguments: [
          {
            type: NodeTypes.INTERPOLATION,
            content: {
              type: NodeTypes.SIMPLE_EXPRESSION,
              content: 'foo',
            },
          },
          genFlagText(PatchFlags.TEXT),
        ],
      },
    })
    expect(generate(root).code).toMatchSnapshot()
  })
})
