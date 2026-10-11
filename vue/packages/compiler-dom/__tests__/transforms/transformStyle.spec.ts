/**
 * 验证静态 style Attribute 改为 bind:style 对象，并与 transformBind/transformElement
 * 协作生成无 STYLE 标志的 props。
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
  /**
   * 场景：只安装 transformStyle 解析 color:red 静态属性，断言该 Attribute 原位变为静态 style 参数加对象表达式的 v-bind，验证节点层改写而非运行时解析 CSS。
   */
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

  /**
   * 场景：同一静态 style 再串联 transformElement 与 transformBind，断言 codegen props 保存 JSON 对象且无 STYLE patchFlag，验证 CAN_STRINGIFY 常量不进入动态样式更新协议。
   */
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
