/**
 * 原生表单 `v-model` 场景：按 input 类型选择 text/radio/checkbox/select/dynamic helper，
 * 处理 lazy/trim/number 修饰符，并诊断 file、value 冲突、非法元素和组件专用参数。
 */
import {
  type CompilerOptions,
  generate,
  baseParse as parse,
  transform,
  transformVBindShorthand,
} from '@vue/compiler-core'
import { transformModel } from '../../src/transforms/vModel'
import { transformElement } from '../../../compiler-core/src/transforms/transformElement'
import { DOMErrorCodes } from '../../src/errors'
import {
  V_MODEL_CHECKBOX,
  V_MODEL_DYNAMIC,
  V_MODEL_RADIO,
  V_MODEL_SELECT,
  V_MODEL_TEXT,
} from '../../src/runtimeHelpers'

/** 用 DOM v-model 与元素转换器编译模板，返回便于检查 helper/codegen 的根 AST。 */
function transformWithModel(template: string, options: CompilerOptions = {}) {
  const ast = parse(template)
  transform(ast, {
    nodeTransforms: [transformVBindShorthand, transformElement],
    directiveTransforms: {
      model: transformModel,
    },
    ...options,
  })
  return ast
}

describe('compiler: transform v-model', () => {
  /**
   * 场景：无 type 的 input 双向绑定 model，转换后断言 V_MODEL_TEXT 登记并匹配代码快照，验证 HTML 默认文本型采用运行时指令而非组件 modelValue prop。
   */
  test('simple expression', () => {
    const root = transformWithModel('<input v-model="model" />')

    expect(root.helpers).toContain(V_MODEL_TEXT)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 场景：input 显式 type=text 双向绑定 model，断言文本 helper 和生成快照，验证静态 type 的默认文本分支。
   */
  test('simple expression for input (text)', () => {
    const root = transformWithModel('<input type="text" v-model="model" />')

    expect(root.helpers).toContain(V_MODEL_TEXT)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 场景：input 静态 type=radio 绑定 model，断言单选 helper 与代码快照，验证编译期按 type 选择单选指令。
   */
  test('simple expression for input (radio)', () => {
    const root = transformWithModel('<input type="radio" v-model="model" />')

    expect(root.helpers).toContain(V_MODEL_RADIO)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 场景：input 静态 type=checkbox 绑定 model，断言复选 helper 与代码快照，验证与 radio/text 独立的 helper 分派。
   */
  test('simple expression for input (checkbox)', () => {
    const root = transformWithModel('<input type="checkbox" v-model="model" />')

    expect(root.helpers).toContain(V_MODEL_CHECKBOX)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 场景：input 的 :type=foo 只能运行时确定，断言动态 model helper 和快照，验证不提前猜测具体控件类型。
   */
  test('simple expression for input (dynamic type)', () => {
    const root = transformWithModel('<input :type="foo" v-model="model" />')

    expect(root.helpers).toContain(V_MODEL_DYNAMIC)
    expect(generate(root).code).toMatchSnapshot()
  })

  // #13169：`v-model` 后出现同名 `:type` 简写时仍是动态 input 类型，必须选择动态 model helper。
  /**
   * 场景：v-model 后出现同名 :type 简写，先经 transformVBindShorthand 补表达式，再断言动态 helper 与快照，验证指令顺序不遗漏 type 绑定。
   */
  test('input with v-bind shorthand type after v-model should use dynamic model', () => {
    const root = transformWithModel('<input v-model="model" :type/>')

    expect(root.helpers).toContain(V_MODEL_DYNAMIC)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 场景：分别用 v-bind=obj 与 v-bind:[key]=val 为无显式 type 的 input 提供未知属性，两个结果都登记动态 helper；快照验证这两类绑定可能携带 type。
   */
  test('input w/ dynamic v-bind', () => {
    const root = transformWithModel('<input v-bind="obj" v-model="model" />')

    expect(root.helpers).toContain(V_MODEL_DYNAMIC)
    expect(generate(root).code).toMatchSnapshot()

    const root2 = transformWithModel(
      '<input v-bind:[key]="val" v-model="model" />',
    )
    expect(root2.helpers).toContain(V_MODEL_DYNAMIC)
    expect(generate(root2).code).toMatchSnapshot()
  })

  /**
   * 场景：select 绑定 model，断言 V_MODEL_SELECT 与生成快照，验证选择框无需按 input type 分派。
   */
  test('simple expression for select', () => {
    const root = transformWithModel('<select v-model="model" />')

    expect(root.helpers).toContain(V_MODEL_SELECT)
    expect(generate(root).code).toMatchSnapshot()
  })

  /**
   * 场景：textarea 绑定 model，断言文本 helper 与快照，验证 textarea 复用文本指令而非 select 路径。
   */
  test('simple expression for textarea', () => {
    const root = transformWithModel('<textarea v-model="model" />')

    expect(root.helpers).toContain(V_MODEL_TEXT)
    expect(generate(root).code).toMatchSnapshot()
  })

  // 错误分组：非法元素、原生参数、file input 与首个动态绑定为 value 时的冲突。
  describe('errors', () => {
    /**
     * 场景：原生 input 使用组件式 v-model:value 参数，收集 onError 并断言一次 ARG_ON_ELEMENT，验证参数只允许进入组件协议。
     */
    test('plain elements with argument', () => {
      const onError = vi.fn()
      transformWithModel('<input v-model:value="model" />', { onError })

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: DOMErrorCodes.X_V_MODEL_ARG_ON_ELEMENT,
        }),
      )
    })

    /**
     * 场景：span 使用 v-model，收集错误并断言一次 INVALID_ELEMENT，验证普通非表单元素不能获得原生 model 指令。
     */
    test('invalid element', () => {
      const onError = vi.fn()
      transformWithModel('<span v-model="model" />', { onError })

      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: DOMErrorCodes.X_V_MODEL_ON_INVALID_ELEMENT,
        }),
      )
    })

    /**
     * 场景：isCustomElement 把 my-input 判为自定义原生元素，转换后断言文本 helper、无错误及快照，验证它进入 DOM 控件路径而非普通组件 props 路径。
     */
    test('should allow usage on custom element', () => {
      const onError = vi.fn()
      const root = transformWithModel('<my-input v-model="model" />', {
        onError,
        isCustomElement: tag => tag.startsWith('my-'),
      })
      expect(root.helpers).toContain(V_MODEL_TEXT)
      expect(onError).not.toHaveBeenCalled()
      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 场景：静态 file input 使用 v-model，收集错误并断言 FILE_INPUT_ELEMENT，验证只读文件控件诊断。
     */
    test('should raise error if used file input element', () => {
      const onError = vi.fn()
      transformWithModel(`<input type="file" v-model="test"/>`, {
        onError,
      })
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: DOMErrorCodes.X_V_MODEL_ON_FILE_INPUT_ELEMENT,
        }),
      )
    })

    /**
     * 场景：文本 input 的首个带表达式 v-bind 是 :value，且同时 v-model=test，收集错误并断言 UNNECESSARY_VALUE，验证两个动态值来源冲突检查。
     */
    test('should error on dynamic value binding alongside v-model', () => {
      const onError = vi.fn()
      transformWithModel(`<input v-model="test" :value="test" />`, {
        onError,
      })
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: DOMErrorCodes.X_V_MODEL_UNNECESSARY_VALUE,
        }),
      )
    })

    // #3596：静态 `value="..."` 不会与模型表达式竞争写入，不能像动态 `:value` 一样报冲突。
    /**
     * 场景：input 同时有 v-model 与静态 value=test，断言未报错，验证静态初值不走首个动态 :value 冲突诊断。
     */
    test('should NOT error on static value binding alongside v-model', () => {
      const onError = vi.fn()
      transformWithModel(`<input v-model="test" value="test" />`, {
        onError,
      })
      expect(onError).not.toHaveBeenCalled()
    })
  })

  // 修饰符分组：检查 number/trim/lazy 分别进入原生 runtime directive 的参数。
  describe('modifiers', () => {
    /**
     * 场景：input 使用 v-model.number，匹配生成快照确认 number 进入运行时指令 modifiers；不把编译快照当成数值转换已执行。
     */
    test('.number', () => {
      const root = transformWithModel('<input  v-model.number="model" />')

      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 场景：input 使用 v-model.trim，匹配生成快照确认 trim 进入运行时指令 modifiers；测试未触发实际输入事件。
     */
    test('.trim', () => {
      const root = transformWithModel('<input  v-model.trim="model" />')

      expect(generate(root).code).toMatchSnapshot()
    })

    /**
     * 场景：input 使用 v-model.lazy，匹配生成快照确认 lazy 进入运行时指令 modifiers。
     */
    test('.lazy', () => {
      const root = transformWithModel('<input  v-model.lazy="model" />')

      expect(generate(root).code).toMatchSnapshot()
    })
  })
})
