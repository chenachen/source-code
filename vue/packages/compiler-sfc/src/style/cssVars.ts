import {
  type BindingMetadata,
  NodeTypes,
  type SimpleExpressionNode,
  createRoot,
  createSimpleExpression,
  createTransformContext,
  processExpression,
} from '@vue/compiler-dom'
import type { SFCDescriptor } from '../parse'
import type { PluginCreator } from 'postcss'
import hash from 'hash-sum'
import { getEscapedCssVarName } from '@vue/shared'

/** script 中注入 CSS 自定义属性所用的 Vue 运行时 helper 名。 */
export const CSS_VARS_HELPER = `useCssVars`

/**
 * 生成 CSS 绑定值对象的源码。客户端键不带 `--`，由 useCssVars 写入 style 时补上；
 * SSR 键为 `:--名称`，ssrRenderStyle 删除 `:` 并规范值：null/undefined 输出 initial，
 * 避免该实例继续继承外层值；正常字符串和数值保留。
 */
export function genCssVarsFromList(
  vars: string[],
  id: string,
  isProd: boolean,
  isSSR = false,
): string {
  return `{\n  ${vars
    .map(
      key =>
        `"${isSSR ? `:--` : ``}${genVarName(id, key, isProd, isSSR)}": (${key})`,
    )
    .join(',\n  ')}\n}`
}

/** 为 CSS v-bind 表达式生成组件内稳定且冲突概率低的自定义属性名。 */
function genVarName(
  id: string,
  raw: string,
  isProd: boolean,
  isSSR = false,
): string {
  if (isProd) {
    // CSS 自定义属性散列名不能以数字开头；命中时加 v 前缀。
    return hash(id + raw).replace(/^\d/, r => `v${r}`)
  } else {
    // 开发名保留表达式便于调试，但需转义 ASCII 标点。
    // #7823：SSR 还要多转义一次，因为变量最终进入 HTML 属性字符串。
    return `${id}-${getEscapedCssVarName(raw, isSSR)}`
  }
}

/** 去除 v-bind() 参数外层空白及可选引号，得到真实 JS 表达式文本。 */
function normalizeExpression(exp: string) {
  exp = exp.trim()
  if (
    (exp[0] === `'` && exp[exp.length - 1] === `'`) ||
    (exp[0] === `"` && exp[exp.length - 1] === `"`)
  ) {
    return exp.slice(1, -1)
  }
  return exp
}

/** 定位 CSS 声明值中的 `v-bind(` 起点；结束括号由 lexer 精确查找。 */
const vBindRE = /v-bind\s*\(/g

/** 扫描所有 style block，按首次出现顺序收集去重后的 CSS v-bind 表达式。 */
export function parseCssVars(sfc: SFCDescriptor): string[] {
  const vars: string[] = []
  sfc.styles.forEach(style => {
    let match
    // 先剔除块注释以及 Less/Sass/Stylus 都支持的 `//` 注释，避免把示例文本当表达式。
    const content = style.content.replace(/\/\*([\s\S]*?)\*\/|\/\/.*/g, '')
    while ((match = vBindRE.exec(content))) {
      const start = match.index + match[0].length
      const end = lexBinding(content, start)
      if (end !== null) {
        const variable = normalizeExpression(content.slice(start, end))
        if (!vars.includes(variable)) {
          vars.push(variable)
        }
      }
    }
  })
  return vars
}

/** v-bind() 参数扫描器状态；引号内的括号不能改变嵌套深度。 */
enum LexerState {
  /** 扫描 `v-bind(...)` 参数主体并维护嵌套括号深度。 */
  inParens,
  /** 位于单引号字符串中，其中的右括号不结束绑定表达式。 */
  inSingleQuoteString,
  /** 位于双引号字符串中，其中的右括号不结束绑定表达式。 */
  inDoubleQuoteString,
}

/**
 * 从 `v-bind(` 后开始扫描与其匹配的右括号。
 * 支持嵌套调用和单双引号；源码不完整时返回 null，让上层保留原 CSS。
 * 这里仅寻找 CSS v-bind 的括号边界，不校验 JS 表达式；不处理反引号或字符串转义，
 * 引号结束仅按相同字符判断。start 是左括号后的原文索引，返回匹配右括号的位置。
 */
function lexBinding(content: string, start: number): number | null {
  let state: LexerState = LexerState.inParens
  let parenDepth = 0

  for (let i = start; i < content.length; i++) {
    const char = content.charAt(i)
    switch (state) {
      case LexerState.inParens:
        if (char === `'`) {
          state = LexerState.inSingleQuoteString
        } else if (char === `"`) {
          state = LexerState.inDoubleQuoteString
        } else if (char === `(`) {
          parenDepth++
        } else if (char === `)`) {
          if (parenDepth > 0) {
            parenDepth--
          } else {
            return i
          }
        }
        break
      case LexerState.inSingleQuoteString:
        if (char === `'`) {
          state = LexerState.inParens
        }
        break
      case LexerState.inDoubleQuoteString:
        if (char === `"`) {
          state = LexerState.inParens
        }
        break
    }
  }
  return null
}

/** cssVars PostCSS 插件所需的组件作用域信息。 */
export interface CssVarsPluginOptions {
  /** 组件作用域哈希，用于防止不同组件的 CSS 自定义属性重名。 */
  id: string
  /** 生产模式使用哈希变量名，开发模式保留可读表达式名称。 */
  isProd: boolean
}

/**
 * 将 CSS 声明中的 `v-bind(expr)` 改写为组件专属的 `var(--generated-name)`。
 * JS 侧会由 useCssVars 在每个实例根节点写入同名自定义属性。
 */
export const cssVarsPlugin: PluginCreator<CssVarsPluginOptions> = opts => {
  const { id, isProd } = opts!
  return {
    postcssPlugin: 'vue-sfc-vars',
    /** 扫描单条 CSS 声明值，并替换其中每个完整 `v-bind(...)`。 */
    Declaration(decl) {
      // 一个声明可含多个 v-bind；保留匹配间原文本，仅替换参数完整的调用。
      const value = decl.value
      if (vBindRE.test(value)) {
        vBindRE.lastIndex = 0
        let transformed = ''
        let lastIndex = 0
        let match
        while ((match = vBindRE.exec(value))) {
          const start = match.index + match[0].length
          const end = lexBinding(value, start)
          if (end !== null) {
            const variable = normalizeExpression(value.slice(start, end))
            transformed +=
              value.slice(lastIndex, match.index) +
              `var(--${genVarName(id, variable, isProd)})`
            lastIndex = end + 1
          }
        }
        decl.value = transformed + value.slice(lastIndex)
      }
    },
  }
}
cssVarsPlugin.postcss = true

/**
 * 生成 script setup 内调用 `useCssVars(_ctx => vars)` 的代码。
 * 表达式复用 compiler-core 的 identifier 重写，使 setup binding/ref 的访问语义与模板一致。
 * 创建 inline=true 的表达式上下文：已知 ref 写 .value、可能 ref 用 unref、prop 用 __props。
 * 普通 script 的 __isScriptSetup=false 会丢弃绑定元信息，让所有公开值经 _ctx 读取。
 * 本函数只生成调用源码，不直接注入 import；compileScript/普通 script 包装负责提供 helper。
 */
export function genCssVarsCode(
  vars: string[],
  bindings: BindingMetadata,
  id: string,
  isProd: boolean,
) {
  const varsExp = genCssVarsFromList(vars, id, isProd)
  const exp = createSimpleExpression(varsExp, false)
  const context = createTransformContext(createRoot([]), {
    prefixIdentifiers: true,
    inline: true,
    bindingMetadata: bindings.__isScriptSetup === false ? undefined : bindings,
  })
  const transformed = processExpression(exp, context)
  const transformedString =
    transformed.type === NodeTypes.SIMPLE_EXPRESSION
      ? transformed.content
      : transformed.children
          .map(c => {
            return typeof c === 'string'
              ? c
              : (c as SimpleExpressionNode).content
          })
          .join('')

  return `_${CSS_VARS_HELPER}(_ctx => (${transformedString}))`
}

/**
 * 为只有普通 `<script>` 的组件包装原 setup，并在其执行前注入 CSS vars。
 * script setup 已在主转换中直接插入 helper 调用，不走此兼容包装。
 */
export function genNormalScriptCssVarsCode(
  cssVars: string[],
  bindings: BindingMetadata,
  id: string,
  isProd: boolean,
  defaultVar: string,
): string {
  return (
    `\nimport { ${CSS_VARS_HELPER} as _${CSS_VARS_HELPER} } from 'vue'\n` +
    `const __injectCSSVars__ = () => {\n${genCssVarsCode(
      cssVars,
      bindings,
      id,
      isProd,
    )}}\n` +
    `const __setup__ = ${defaultVar}.setup\n` +
    `${defaultVar}.setup = __setup__\n` +
    `  ? (props, ctx) => { __injectCSSVars__();return __setup__(props, ctx) }\n` +
    `  : __injectCSSVars__\n`
  )
}
