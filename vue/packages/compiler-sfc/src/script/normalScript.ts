import { analyzeScriptBindings } from './analyzeScriptBindings'
import type { ScriptCompileContext } from './context'
import MagicString from 'magic-string'
import { rewriteDefaultAST } from '../rewriteDefault'
import { genNormalScriptCssVarsCode } from '../style/cssVars'
import type { SFCScriptBlock } from '../parse'

/** 普通 script 默认导出被改写后使用的内部变量名。 */
export const normalScriptDefaultVar = `__default__`

/**
 * 处理没有 script setup 的普通 `<script>`。
 *
 * 分析 Options API 模板绑定；需要注入 CSS vars 或 `genDefaultAs` 时把 default export 改为
 * 局部变量，包装 setup 后再按调用方要求导出。自定义 Babel 语法解析失败时保守返回原块，
 * 让上层自定义工具继续处理。
 */
export function processNormalScript(
  ctx: ScriptCompileContext,
  scopeId: string,
): SFCScriptBlock {
  const script = ctx.descriptor.script!
  try {
    let content = script.content
    let map = script.map
    const scriptAst = ctx.scriptAst!
    const bindings = analyzeScriptBindings(scriptAst.body)
    const { cssVars } = ctx.descriptor
    const { genDefaultAs, isProd } = ctx.options

    if (cssVars.length || genDefaultAs) {
      const defaultVar = genDefaultAs || normalScriptDefaultVar
      const s = new MagicString(content)
      rewriteDefaultAST(scriptAst.body, s, defaultVar)
      content = s.toString()
      if (cssVars.length && !ctx.options.templateOptions?.ssr) {
        content += genNormalScriptCssVarsCode(
          cssVars,
          bindings,
          scopeId,
          !!isProd,
          defaultVar,
        )
      }
      if (!genDefaultAs) {
        content += `\nexport default ${defaultVar}`
      }
    }
    return {
      ...script,
      content,
      map,
      bindings,
      scriptAst: scriptAst.body,
    }
  } catch (e: any) {
    // 用户可能使用未配置给 compiler-sfc 的自定义 Babel 语法；静默回退，避免破坏原脚本。
    return script
  }
}
