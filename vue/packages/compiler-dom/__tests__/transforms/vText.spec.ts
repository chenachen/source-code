/**
 * `v-text` 场景：生成 textContent 属性、对动态值调用 toDisplayString，并诊断空表达式；
 * 原有 children 必须移除，避免运行时 textContent 覆盖导致无效 VNode 创建。
 */
import {
  type CompilerOptions,
  type PlainElementNode,
  baseParse as parse,
  transform,
} from '@vue/compiler-core'
import { transformVText } from '../../src/transforms/vText'
import { transformElement } from '../../../compiler-core/src/transforms/transformElement'
import { createObjectMatcher } from '../../../compiler-core/__tests__/testUtils'
import { PatchFlags } from '@vue/shared'
import { DOMErrorCodes } from '../../src/errors'

/** 用 v-text 与元素转换器编译模板，返回包含生成 props 的根 AST。 */
function transformWithVText(template: string, options: CompilerOptions = {}) {
  const ast = parse(template)
  transform(ast, {
    nodeTransforms: [transformElement],
    directiveTransforms: {
      text: transformVText,
    },
    ...options,
  })
  return ast
}

describe('compiler: v-text transform', () => {
  /**
   * 场景：无 children 的 div 使用动态 v-text=test，断言 textContent 的调用参数、PROPS 标志及动态键，验证动态展示值经 toDisplayString 写入属性。
   */
  it('should convert v-text to textContent', () => {
    const ast = transformWithVText(`<div v-text="test"/>`)
    expect((ast.children[0] as PlainElementNode).codegenNode).toMatchObject({
      tag: `"div"`,
      props: createObjectMatcher({
        textContent: {
          arguments: [{ content: 'test' }],
        },
      }),
      children: undefined,
      patchFlag: PatchFlags.PROPS,
      dynamicProps: `["textContent"]`,
    })
  })

  /**
   * 场景：v-text=test 与 hello children 同存，收集错误后断言 WITH_CHILDREN 与 children 被移除，验证无效子树不会参与生成。
   */
  it('should raise error and ignore children when v-text is present', () => {
    const onError = vi.fn()
    const ast = transformWithVText(`<div v-text="test">hello</div>`, {
      onError,
    })
    expect(onError.mock.calls).toMatchObject([
      [{ code: DOMErrorCodes.X_V_TEXT_WITH_CHILDREN }],
    ])
    expect((ast.children[0] as PlainElementNode).codegenNode).toMatchObject({
      tag: `"div"`,
      props: createObjectMatcher({
        textContent: {
          arguments: [{ content: 'test' }],
        },
      }),
      children: undefined, // v-text 已清空原有子节点
      patchFlag: PatchFlags.PROPS,
      dynamicProps: `["textContent"]`,
    })
  })

  /**
   * 场景：v-text 缺少表达式，收集型 onError 转换并断言 NO_EXPRESSION，验证必需输入的诊断而非文本更新行为。
   */
  it('should raise error if has no expression', () => {
    const onError = vi.fn()
    transformWithVText(`<div v-text></div>`, {
      onError,
    })
    expect(onError.mock.calls).toMatchObject([
      [{ code: DOMErrorCodes.X_V_TEXT_NO_EXPRESSION }],
    ])
  })
})
