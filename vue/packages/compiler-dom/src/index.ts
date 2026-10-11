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
 * 用户节点转换排在 DOM 转换之后；同名用户指令转换覆盖默认项。这里创建新的 options
 * 对象，但传入 RootNode 时 baseCompile 会原位转换该树，不提供 AST 隔离。
 *
 * @param src - 原始模板或已经解析、尚待转换的根树。
 * @param options - 调用方解析/转换/生成选项；错误是否抛出取决于 onError。
 * @returns AST、render 代码及可选 source map；API 本身同步，不执行生成的 render。
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

/**
 * 使用 DOM 平台规则解析模板；调用方 options 最后合并，可选择 SFC 等解析模式。
 * 返回可交给 compile 的新 RootNode。默认错误回调抛出；收集错误不会自动开始转换。
 */
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
