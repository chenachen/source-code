/**
 * 静态 style 属性转换场景：把 CSS 文本解析为对象表达式，验证多声明、CSS 变量、分号/括号
 * 等边界，同时保证动态 `:style` 不被当作静态文本重写。
 */
import {
  type CompilerOptions,
  type ElementNode,
  NodeTypes,
  type VNodeCall,
  baseParse as parse,
  transform,
} from '@vue/compiler-core'
import { transformBind } from '../../../compiler-core/src/transforms/vBind'
import { transformElement } from '../../../compiler-core/src/transforms/transformElement'
import { transformStyle } from '../../src/transforms/transformStyle'

/** 只运行静态 style 节点转换，并返回根和首元素以检查属性是否被改写。 */
function transformWithStyleTransform(
  template: string,
  options: CompilerOptions = {},
) {
  const ast = parse(template)
  transform(ast, {
    nodeTransforms: [transformStyle],
    ...options,
  })
  return {
    root: ast,
    node: ast.children[0] as ElementNode,
  }
}

describe('compiler: style transform', () => {
  test('should transform into directive node', () => {
    const { node } = transformWithStyleTransform(`<div style="color: red"/>`)
    expect(node.props[0]).toMatchObject({
      type: NodeTypes.DIRECTIVE,
      name: `bind`,
      arg: {
        type: NodeTypes.SIMPLE_EXPRESSION,
        content: `style`,
        isStatic: true,
      },
      exp: {
        type: NodeTypes.SIMPLE_EXPRESSION,
        content: `{"color":"red"}`,
        isStatic: false,
      },
    })
  })

  test('working with v-bind transform', () => {
    const { node } = transformWithStyleTransform(`<div style="color: red"/>`, {
      nodeTransforms: [transformStyle, transformElement],
      directiveTransforms: {
        bind: transformBind,
      },
    })
    expect((node.codegenNode as VNodeCall).props).toMatchObject({
      type: NodeTypes.JS_OBJECT_EXPRESSION,
      properties: [
        {
          key: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: `style`,
            isStatic: true,
          },
          value: {
            type: NodeTypes.SIMPLE_EXPRESSION,
            content: `{"color":"red"}`,
            isStatic: false,
          },
        },
      ],
    })
    // 静态 style 已编译为对象，不能附加 STYLE patchFlag。
    expect((node.codegenNode as VNodeCall).patchFlag).toBeUndefined()
  })
})
