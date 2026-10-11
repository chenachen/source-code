import {
  type DirectiveTransform,
  ElementTypes,
  NodeTypes,
  transformModel as baseTransform,
  findDir,
  findProp,
  hasDynamicKeyVBind,
  isStaticArgOf,
} from '@vue/compiler-core'
import { DOMErrorCodes, createDOMCompilerError } from '../errors'
import {
  V_MODEL_CHECKBOX,
  V_MODEL_DYNAMIC,
  V_MODEL_RADIO,
  V_MODEL_SELECT,
  V_MODEL_TEXT,
} from '../runtimeHelpers'

/**
 * 在 core 的双向绑定 props 基础上，为 DOM 元素选择具体 v-model 运行时指令。
 *
 * 组件只需要 `modelValue` / `onUpdate:modelValue`；原生 input、textarea、select 则需根据
 * 标签和 type 选择文本、单选、复选、选择框或动态分派 helper，并校验 file input 等
 * 浏览器限制。
 * 成功的原生分支只登记 needRuntime，值由 withDirectives 的绑定参数传递；统一删除
 * modelValue prop，保留写回监听器。file/非法元素在 onError 仅收集时仍走这项过滤，
 * 但不会登记运行时 helper；默认抛错则在诊断处中止，不会返回有效 render 结果。
 */
export const transformModel: DirectiveTransform = (dir, node, context) => {
  const baseResult = baseTransform(dir, node, context)
  // core 已报错时没有 props；组件 v-model 只需 core 生成的 props，两种情况都直接返回。
  if (!baseResult.props.length || node.tagType === ElementTypes.COMPONENT) {
    return baseResult
  }

  if (dir.arg) {
    context.onError(
      createDOMCompilerError(
        DOMErrorCodes.X_V_MODEL_ARG_ON_ELEMENT,
        dir.arg.loc,
      ),
    )
  }

  /**
   * DEV 文本控件分支检查首个带表达式的 v-bind，仅当其静态参数是 value 时报告冲突。
   * findDir 不会继续查找后面的绑定，因此 `:id` 排在 `:value` 前面时不会命中。
   */
  function checkDuplicatedValue() {
    const value = findDir(node, 'bind')
    if (value && isStaticArgOf(value.arg, 'value')) {
      context.onError(
        createDOMCompilerError(
          DOMErrorCodes.X_V_MODEL_UNNECESSARY_VALUE,
          value.loc,
        ),
      )
    }
  }

  const { tag } = node
  const isCustomElement = context.isCustomElement(tag)
  if (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    isCustomElement
  ) {
    let directiveToUse = V_MODEL_TEXT
    let isInvalidType = false
    if (tag === 'input' || isCustomElement) {
      const type = findProp(node, `type`)
      // 显式 type 优先于对象/动态键绑定；即便 type 没有 value，存在该属性也不会再
      // 检查后面的动态绑定。默认 helper 已是文本型，需与下方“未找到 type”区分。
      if (type) {
        if (type.type === NodeTypes.DIRECTIVE) {
          // `:type="foo"` 运行时才能决定应采用文本、单选还是复选逻辑。
          directiveToUse = V_MODEL_DYNAMIC
        } else if (type.value) {
          switch (type.value.content) {
            case 'radio':
              directiveToUse = V_MODEL_RADIO
              break
            case 'checkbox':
              directiveToUse = V_MODEL_CHECKBOX
              break
            case 'file':
              isInvalidType = true
              context.onError(
                createDOMCompilerError(
                  DOMErrorCodes.X_V_MODEL_ON_FILE_INPUT_ELEMENT,
                  dir.loc,
                ),
              )
              break
            default:
              // 其他静态 type 采用文本控件逻辑。
              __DEV__ && checkDuplicatedValue()
              break
          }
        }
      } else if (hasDynamicKeyVBind(node)) {
        // 没有找到显式 type 时，`v-bind:[key]` / `v-bind="obj"` 可能提供 type，改用动态分派。
        // 若已命中上面的静态 type 分支，则不会因这些动态绑定重新选择 helper。
        directiveToUse = V_MODEL_DYNAMIC
      } else {
        // 没有 type 的 input 默认是文本输入框。
        __DEV__ && checkDuplicatedValue()
      }
    } else if (tag === 'select') {
      directiveToUse = V_MODEL_SELECT
    } else {
      // textarea 使用文本 v-model，并同样禁止额外 value 绑定。
      __DEV__ && checkDuplicatedValue()
    }
    // 通过 needRuntime 返回内置 helper symbol。代码生成器会直接导入运行时指令，
    // 而不是生成面向用户自定义指令的 resolveDirective()。
    if (!isInvalidType) {
      baseResult.needRuntime = context.helper(directiveToUse)
    }
  } else {
    context.onError(
      createDOMCompilerError(
        DOMErrorCodes.X_V_MODEL_ON_INVALID_ELEMENT,
        dir.loc,
      ),
    )
  }

  // 原生 v-model 的值已作为 runtime directive 的 binding.value 传入，删除冗余
  // modelValue prop 可缩小产物；onUpdate 仍需保留，用于把 DOM 变化写回表达式。
  baseResult.props = baseResult.props.filter(
    p =>
      !(
        p.key.type === NodeTypes.SIMPLE_EXPRESSION &&
        p.key.content === 'modelValue'
      ),
  )

  return baseResult
}
