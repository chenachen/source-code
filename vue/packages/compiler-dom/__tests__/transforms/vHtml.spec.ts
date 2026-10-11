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
  /**
   * 场景：无 children 的 div 使用 v-html=test，经指令与元素转换生成 innerHTML prop；断言 PROPS 标志及 dynamicProps=[innerHTML]，验证整元素内容由该动态属性控制。
   */
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

  /**
   * 场景：div 同时有 v-html=test 与 hello 子文本，收集错误后断言 WITH_CHILDREN 诊断和无 children 的 codegen，验证继续转换时无效子树被清空。
   */
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
      children: undefined, // v-html 已清空原有子节点
      patchFlag: PatchFlags.PROPS,
      dynamicProps: `["innerHTML"]`,
    })
  })

  /**
   * 场景：div 上的 v-html 没有表达式，使用收集型 onError 转换并断言 NO_EXPRESSION 错误码，验证诊断分支。
   */
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
