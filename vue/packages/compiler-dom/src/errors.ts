import {
  type CompilerError,
  ErrorCodes,
  type SourceLocation,
  createCompilerError,
} from '@vue/compiler-core'

/** 带 DOM 专用错误码的编译错误。 */
export interface DOMCompilerError extends CompilerError {
  /** compiler-dom 平台专用错误码。 */
  code: DOMErrorCodes
}

/** 根据 DOM 错误码和源码位置创建统一格式的编译错误。 */
export function createDOMCompilerError(
  code: DOMErrorCodes,
  loc?: SourceLocation,
) {
  return createCompilerError(
    code,
    loc,
    __DEV__ || !__BROWSER__ ? DOMErrorMessages : undefined,
  ) as DOMCompilerError
}

/** DOM 平台在 core 错误码扩展点之后追加的错误码。 */
export enum DOMErrorCodes {
  /** `v-html` 缺少要写入 `innerHTML` 的表达式。 */
  X_V_HTML_NO_EXPRESSION = 54 /* ErrorCodes.__EXTEND_POINT__ */,
  /** `v-html` 与元素 children 共存；children 最终会被覆盖。 */
  X_V_HTML_WITH_CHILDREN,
  /** `v-text` 缺少要写入 `textContent` 的表达式。 */
  X_V_TEXT_NO_EXPRESSION,
  /** `v-text` 与元素 children 共存；children 最终会被覆盖。 */
  X_V_TEXT_WITH_CHILDREN,
  /** `v-model` 用在 input/textarea/select 以外的原生元素。 */
  X_V_MODEL_ON_INVALID_ELEMENT,
  /** 原生元素上的 `v-model` 使用了只适用于组件的参数。 */
  X_V_MODEL_ARG_ON_ELEMENT,
  /** 文件输入框只读，不能通过 `v-model` 回写文件路径。 */
  X_V_MODEL_ON_FILE_INPUT_ELEMENT,
  /** `v-model` 与显式 `value` 绑定冲突。 */
  X_V_MODEL_UNNECESSARY_VALUE,
  /** `v-show` 缺少控制可见性的表达式。 */
  X_V_SHOW_NO_EXPRESSION,
  /** `<Transition>` 包含多个可渲染子节点。 */
  X_TRANSITION_INVALID_CHILDREN,
  /** 客户端组件模板中的 `<script>` / `<style>` 因副作用而被忽略。 */
  X_IGNORED_SIDE_EFFECT_TAG,
  /** 后续平台编译器继续分配错误码的边界。 */
  __EXTEND_POINT__,
}

if (__TEST__) {
  // 枚举首值来自另一个文件时 esbuild 无法推导后续自增值，因此首值需手动同步。
  // 测试构建用此断言尽早发现 core 扩展点移动后造成的错误码冲突。
  if (DOMErrorCodes.X_V_HTML_NO_EXPRESSION < ErrorCodes.__EXTEND_POINT__) {
    throw new Error(
      `DOMErrorCodes need to be updated to ${
        ErrorCodes.__EXTEND_POINT__
      } to match extension point from core ErrorCodes.`,
    )
  }
}

/** DOM 错误码对应的开发期英文诊断文案。 */
export const DOMErrorMessages: {
  /** DOM 错误码对应的诊断文本。 */
  [code: number]: string
} = {
  [DOMErrorCodes.X_V_HTML_NO_EXPRESSION]: `v-html is missing expression.`,
  [DOMErrorCodes.X_V_HTML_WITH_CHILDREN]: `v-html will override element children.`,
  [DOMErrorCodes.X_V_TEXT_NO_EXPRESSION]: `v-text is missing expression.`,
  [DOMErrorCodes.X_V_TEXT_WITH_CHILDREN]: `v-text will override element children.`,
  [DOMErrorCodes.X_V_MODEL_ON_INVALID_ELEMENT]: `v-model can only be used on <input>, <textarea> and <select> elements.`,
  [DOMErrorCodes.X_V_MODEL_ARG_ON_ELEMENT]: `v-model argument is not supported on plain elements.`,
  [DOMErrorCodes.X_V_MODEL_ON_FILE_INPUT_ELEMENT]: `v-model cannot be used on file inputs since they are read-only. Use a v-on:change listener instead.`,
  [DOMErrorCodes.X_V_MODEL_UNNECESSARY_VALUE]: `Unnecessary value binding used alongside v-model. It will interfere with v-model's behavior.`,
  [DOMErrorCodes.X_V_SHOW_NO_EXPRESSION]: `v-show is missing expression.`,
  [DOMErrorCodes.X_TRANSITION_INVALID_CHILDREN]: `<Transition> expects exactly one child element or component.`,
  [DOMErrorCodes.X_IGNORED_SIDE_EFFECT_TAG]: `Tags with side effect (<script> and <style>) are ignored in client component templates.`,
}
