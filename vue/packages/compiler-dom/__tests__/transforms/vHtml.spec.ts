/**
 * DOM `v-html` 场景：生成 innerHTML 属性，诊断缺失表达式，并确认显式 children 会被清空，
 * 避免生成“先创建 children、随后又由 innerHTML 覆盖”的冲突代码。
 */
import {
  type CompilerOptions,
  type PlainElementNode,
  baseParse as parse,
  transform,
} from '@vue/compiler-core'
import { transformVHtml } from '../../src/transforms/vHtml'
import { transformElement } from '../../../compiler-core/src/transforms/transformElement'
import { createObjectMatcher } from '../../../compiler-core/__tests__/testUtils'
import { PatchFlags } from '@vue/shared'
import { DOMErrorCodes } from '../../src/errors'

/** 用 v-html 与元素转换器编译模板，返回包含生成 innerHTML prop 的根 AST。 */
function transformWithVHtml(template: string, options: CompilerOptions = {}) {
  const ast = parse(template)
  transform(ast, {
    nodeTransforms: [transformElement],
    directiveTransforms: {
      html: transformVHtml,
    },
    ...options,
  })
  return ast
}

describe('compiler: v-html transform', () => {
  it('should convert v-html to innerHTML', () => {
    const ast = transformWithVHtml(`<div v-html="test"/>`)
    expect((ast.children[0] as PlainElementNode).codegenNode).toMatchObject({
      tag: `"div"`,
      props: createObjectMatcher({
        innerHTML: `[test]`,
      }),
      children: undefined,
      patchFlag: PatchFlags.PROPS,
      dynamicProps: `["innerHTML"]`,
    })
  })

  it('should raise error and ignore children when v-html is present', () => {
    const onError = vi.fn()
    const ast = transformWithVHtml(`<div v-html="test">hello</div>`, {
      onError,
    })
    expect(onError.mock.calls).toMatchObject([
      [{ code: DOMErrorCodes.X_V_HTML_WITH_CHILDREN }],
    ])
    expect((ast.children[0] as PlainElementNode).codegenNode).toMatchObject({
      tag: `"div"`,
      props: createObjectMatcher({
        innerHTML: `[test]`,
      }),
      children: undefined, // <-- children should have been removed
      patchFlag: PatchFlags.PROPS,
      dynamicProps: `["innerHTML"]`,
    })
  })

  it('should raise error if has no expression', () => {
    const onError = vi.fn()
    transformWithVHtml(`<div v-html></div>`, {
      onError,
    })
    expect(onError.mock.calls).toMatchObject([
      [{ code: DOMErrorCodes.X_V_HTML_NO_EXPRESSION }],
    ])
  })
})
