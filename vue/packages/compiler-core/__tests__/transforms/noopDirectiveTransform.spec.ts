/**
 * 空指令转换器场景：确认平台声明“已识别但无需生成 props”的指令能被消费，且不会错误地
 * 留作运行时自定义指令或改变元素代码生成结果。
 */
import {
  type ElementNode,
  type VNodeCall,
  noopDirectiveTransform,
  baseParse as parse,
  transform,
} from '../../src'
import { transformElement } from '../../src/transforms/transformElement'

describe('compiler: noop directive transform', () => {
  /**
   * 解析带 v-noop 的原生 div，并将 noopDirectiveTransform 注册进指令转换表；转换后检查 VNodeCall 的 props 为 undefined。该指令返回空属性列表，因此不会给元素生成属性。
   */
  test('should add no props to DOM', () => {
    const ast = parse(`<div v-noop/>`)
    transform(ast, {
      nodeTransforms: [transformElement],
      directiveTransforms: {
        noop: noopDirectiveTransform,
      },
    })
    const node = ast.children[0] as ElementNode
    // v-noop 不生成任何属性，因此 codegen 应与无 props/响应式数据的 div 相同，只传 tag。
    expect((node.codegenNode as VNodeCall).props).toBeUndefined()
  })
})
