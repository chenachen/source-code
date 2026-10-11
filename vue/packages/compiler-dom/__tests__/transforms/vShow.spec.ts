/**
 * `v-show` 场景：保留运行时 vShow 指令及绑定表达式，并诊断空表达式；它不改变 children
 * 或 VNode tag，只通过样式切换可见性。
 */
import {
  type CompilerOptions,
  generate,
  baseParse as parse,
  transform,
} from '@vue/compiler-core'
import { transformElement } from '../../../compiler-core/src/transforms/transformElement'
import { transformShow } from '../../src/transforms/vShow'
import { DOMErrorCodes } from '../../src/errors'

/** 用 v-show 与元素转换器编译单个模板，供 helper、指令参数和错误断言复用。 */
function transformWithShow(template: string, options: CompilerOptions = {}) {
  const ast = parse(template)
  transform(ast, {
    nodeTransforms: [transformElement],
    directiveTransforms: {
      show: transformShow,
    },
    ...options,
  })
  return ast
}

describe('compiler: v-show transform', () => {
  /**
   * 场景：div 用 v-show=a，转换后匹配 render 快照，验证表达式与 vShow 运行时指令参数被保留。
   */
  test('simple expression', () => {
    const ast = transformWithShow(`<div v-show="a"/>`)

    expect(generate(ast).code).toMatchSnapshot()
  })

  /**
   * 场景：div 的 v-show 没有表达式，收集型 onError 继续转换，断言恰一次 NO_EXPRESSION 诊断，验证错误回调的次数与错误码。
   */
  test('should raise error if has no expression', () => {
    const onError = vi.fn()
    transformWithShow(`<div v-show/>`, { onError })

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: DOMErrorCodes.X_V_SHOW_NO_EXPRESSION,
      }),
    )
  })
})
