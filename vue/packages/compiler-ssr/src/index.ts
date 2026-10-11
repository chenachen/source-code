import {
  type CodegenResult,
  type CompilerOptions,
  type RootNode,
  baseParse,
  generate,
  noopDirectiveTransform,
  parserOptions,
  trackSlotScopes,
  trackVForSlotScopes,
  transform,
  transformBind,
  transformExpression,
  transformOn,
  transformStyle,
  transformVBindShorthand,
} from '@vue/compiler-dom'
import { ssrCodegenTransform } from './ssrCodegenTransform'
import { ssrTransformElement } from './transforms/ssrTransformElement'
import {
  rawOptionsMap,
  ssrTransformComponent,
} from './transforms/ssrTransformComponent'
import { ssrTransformSlotOutlet } from './transforms/ssrTransformSlotOutlet'
import { ssrTransformIf } from './transforms/ssrVIf'
import { ssrTransformFor } from './transforms/ssrVFor'
import { ssrTransformModel } from './transforms/ssrVModel'
import { ssrTransformShow } from './transforms/ssrVShow'
import { ssrInjectFallthroughAttrs } from './transforms/ssrInjectFallthroughAttrs'
import { ssrInjectCssVars } from './transforms/ssrInjectCssVars'

/**
 * 把模板编译为服务端 render 函数代码。
 *
 * 第一遍复用 compiler-core 的解析/结构与表达式转换，收集 SSR 专用元数据；第二遍
 * ssrCodegenTransform 把模板 AST 转为 `_push()` 字符串输出语句。SSR 不需要客户端
 * patch 优化，因此关闭 handler cache/static hoist，并始终前缀标识符以避免 with 作用域。
 * 第一遍的 exit 依赖后代元数据完整，第二遍再顺序生成控制流，不能提前把整个树直接
 * 拼成 HTML。编译过程同步；异步组件、Suspense 的等待发生在生成代码执行及 buffer 展开时。
 *
 * @param source - 模板字符串或调用方拥有的 RootNode；后者会原位转换。
 * @param options - 用户 transforms/错误回调等；DOM parserOptions 与 SSR 强制选项在此覆盖。
 * @returns ssrRender 代码、已转换 AST 与可选 map；不返回渲染后的 HTML。
 */
export function compile(
  source: string | RootNode,
  options: CompilerOptions = {},
): CodegenResult {
  options = {
    ...options,
    ...parserOptions,
    ssr: true,
    inSSR: true,
    scopeId: options.mode === 'function' ? null : options.scopeId,
    // SSR 产物不以 with 缩短代码；统一 `_ctx.` 前缀也让服务端执行作用域明确。
    prefixIdentifiers: true,
    // 这些优化服务客户端重复 patch；服务端每次只生成一次字符串，没有收益。
    cacheHandlers: false,
    hoistStatic: false,
  }

  const ast = typeof source === 'string' ? baseParse(source, options) : source

  // 保存 AST 对应原始选项；组件插槽需要对子分支执行客户端 VNode fallback 子转换。
  rawOptionsMap.set(ast, options)

  transform(ast, {
    ...options,
    hoistStatic: false,
    nodeTransforms: [
      transformVBindShorthand,
      ssrTransformIf,
      ssrTransformFor,
      trackVForSlotScopes,
      transformExpression,
      ssrTransformSlotOutlet,
      ssrInjectFallthroughAttrs,
      ssrInjectCssVars,
      ssrTransformElement,
      ssrTransformComponent,
      trackSlotScopes,
      transformStyle,
      ...(options.nodeTransforms || []), // 用户节点转换最后执行
    ],
    directiveTransforms: {
      // v-bind/v-on 的 props 表达式构建可直接复用 core。
      bind: transformBind,
      on: transformOn,
      // v-model/v-show 会直接影响输出属性，使用 SSR 专用实现。
      model: ssrTransformModel,
      show: ssrTransformShow,
      // cloak/once/memo 只影响客户端挂载/更新，SSR 可忽略。
      cloak: noopDirectiveTransform,
      once: noopDirectiveTransform,
      memo: noopDirectiveTransform,
      ...(options.directiveTransforms || {}), // 用户指令转换可覆盖默认项
    },
  })

  // 第二遍把已转换模板树变成 SSR JS AST，并替换根 codegenNode。
  ssrCodegenTransform(ast, options)

  return generate(ast, options)
}
