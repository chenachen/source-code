import {
  type CodegenResult,
  type CompilerOptions,
  type DirectiveTransform,
  type NodeTransform,
  type ParserOptions,
  type RootNode,
  baseCompile,
  baseParse,
  noopDirectiveTransform,
} from '@vue/compiler-core'
import { parserOptions } from './parserOptions'
import { transformStyle } from './transforms/transformStyle'
import { transformVHtml } from './transforms/vHtml'
import { transformVText } from './transforms/vText'
import { transformModel } from './transforms/vModel'
import { transformOn } from './transforms/vOn'
import { transformShow } from './transforms/vShow'
import { transformTransition } from './transforms/Transition'
import { stringifyStatic } from './transforms/stringifyStatic'
import { ignoreSideEffectTags } from './transforms/ignoreSideEffectTags'
import { validateHtmlNesting } from './transforms/validateHtmlNesting'
import { extend } from '@vue/shared'

export { parserOptions }

/** DOM 平台追加的节点转换器；开发期还会校验 Transition 与 HTML 嵌套。 */
export const DOMNodeTransforms: NodeTransform[] = [
  transformStyle,
  ...(__DEV__ ? [transformTransition, validateHtmlNesting] : []),
]

/**
 * DOM 平台指令转换表。
 * `v-model`、`v-on` 会在 core 通用结果上补充原生元素和事件修饰符语义。
 */
export const DOMDirectiveTransforms: Record<string, DirectiveTransform> = {
  cloak: noopDirectiveTransform,
  html: transformVHtml,
  text: transformVText,
  model: transformModel, // 覆盖 compiler-core 的通用 v-model 转换
  on: transformOn, // 覆盖 compiler-core 的通用 v-on 转换
  show: transformShow,
}

/**
 * 将 DOM 模板编译为客户端 render 函数代码。
 *
 * 在 compiler-core 的平台无关管线前注入 HTML/SVG/MathML 解析规则，在转换阶段追加
 * DOM 指令，并在 Node.js 构建中把较大的静态树序列化为 `createStaticVNode()`。
 */
export function compile(
  src: string | RootNode,
  options: CompilerOptions = {},
): CodegenResult {
  return baseCompile(
    src,
    extend({}, parserOptions, options, {
      nodeTransforms: [
        // 客户端组件模板忽略有副作用的 <script>/<style>。它没有放进 DOMNodeTransforms，
        // 因为 SSR 会复用该数组生成 VNode fallback，而 fallback 不应重复执行此删除逻辑。
        ignoreSideEffectTags,
        ...DOMNodeTransforms,
        ...(options.nodeTransforms || []),
      ],
      directiveTransforms: extend(
        {},
        DOMDirectiveTransforms,
        options.directiveTransforms || {},
      ),
      transformHoist: __BROWSER__ ? null : stringifyStatic,
    }),
  )
}

/** 使用 DOM 平台规则只解析模板，返回 AST，不执行转换与代码生成。 */
export function parse(template: string, options: ParserOptions = {}): RootNode {
  return baseParse(template, extend({}, parserOptions, options))
}

export * from './runtimeHelpers'
export { transformStyle } from './transforms/transformStyle'
export {
  createDOMCompilerError,
  DOMErrorCodes,
  DOMErrorMessages,
} from './errors'
export * from '@vue/compiler-core'
