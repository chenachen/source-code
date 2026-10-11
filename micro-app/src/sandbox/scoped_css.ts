/* eslint-disable no-useless-escape, no-cond-assign */
import type { AppInterface } from '@micro-app/types'
import { CompletionPath, getLinkFileDir, logError, trim, isFireFox } from '../libs/utils'
import microApp from '../micro_app'

// 通用选择器正则；root 规则会按 isolation-root 选项在 `formatSelector` 中动态生成。
// const rootSelectorREG = /(^|\s+)(html|:root)(?=[\s>~[.#:]+|$)/
/** 匹配选择器中的 `body` 或 `html … body`，用于把文档根替换为子应用的 `micro-app-body`。 */
const bodySelectorREG = /(^|\s+)((html[\s>~]+body)|body)(?=[\s>~[.#:]+|$)/

/**
 * CSS 解析失败时抛出的扩展错误。
 */
type parseErrorType = Error & {
  /** 供上层日志读取的规范化错误原因。 */
  reason: string,
  /** 发生错误的外链样式地址；内联样式没有该字段。 */
  filename?: string
}

/**
 * 构造并抛出带样式来源信息的 CSS 解析错误。
 *
 * @param msg 解析失败原因。
 * @param linkPath 可选的外链样式地址。
 * @throws 始终抛出携带 `reason` 与可选 `filename` 的错误。
 */
function parseError (msg: string, linkPath?: string): void {
  msg = linkPath ? `${linkPath} ${msg}` : msg
  const err = new Error(msg) as parseErrorType
  err.reason = msg
  if (linkPath) {
    err.filename = linkPath
  }

  throw err
}

/**
 * 以游标切片方式解析并重写子应用 CSS。
 *
 * 解析器参考 reworkcss/css，识别普通样式规则、`@` 规则与注释三类结构；作用域处理只改写选择器
 * 与相对 `url()`，并通过内联控制注释临时关闭改写。匹配成功后从 `cssText` 前缀消费文本，把
 * 原片段或改写后的片段追加到 `result`；规则循环每轮必须前移游标，才能继续处理剩余文本。
 *
 * @see https://github.com/reworkcss/css
 */
class CSSParser {
  /** 尚未消费的 CSS 源文本；所有匹配器只从头部切片。 */
  private cssText = ''
  /** 注入普通选择器前的子应用根前缀，例如 `micro-app[name=xxx]`。 */
  private prefix = ''
  /** URL 补全的当前基址；起初为应用入口，遇到需处理的外链非根路径 URL 后持续改为 CSS 文件目录。 */
  private baseURI = ''
  /** 外链样式地址；内联样式为空，并用于错误定位及相对路径基准。 */
  private linkPath = ''
  /** 按原顺序累计的解析结果。 */
  private result = ''
  /** disable 指令是否生效；配合空列表时全局禁用，非空列表时只豁免精确命中的选择器。 */
  private scopecssDisable = false
  /** `scopecss-disable` 后的精确选择器列表；非空时只跳过这些选择器，URL 仍会补全。 */
  private scopecssDisableSelectors: Array<string> = []
  /** 跳过下一条普通规则的选择器，或声明内紧接注释的下一段 URL 改写；消费后复位。 */
  private scopecssDisableNextLine = false
  /** 来自 `microApp.options.optionCss`、需要参与特殊隔离判断的选择器选项。 */
  private optionCssSelectors: Array<string> = []

  /**
   * 初始化一次解析任务并返回完成作用域与 URL 重写的 CSS。
   *
   * Firefox 对包含特殊字符的长字符串拼接存在性能退化，因此累计阶段编码、输出阶段统一解码；调用方
   * 无论成功或失败都必须随后执行 `reset`，避免单例解析器把状态泄漏到下一份样式。
   *
   * @param cssText 原始 CSS 文本。
   * @param prefix 子应用选择器前缀。
   * @param baseURI 子应用资源基础地址。
   * @param linkPath 可选外链样式地址。
   * @returns 重写后的 CSS 文本。
   */
  public exec (
    cssText: string,
    prefix: string,
    baseURI: string,
    linkPath?: string,
  ): string {
    this.cssText = cssText
    this.prefix = prefix
    this.baseURI = baseURI
    this.linkPath = linkPath || ''
    // 每次执行重新读取配置，确保运行时更新 optionCss 后不复用旧快照。
    this.optionCssSelectors = microApp.options.optionCss || []

    this.matchRules()
    return isFireFox() ? decodeURIComponent(this.result) : this.result
  }

  /**
   * 清空解析游标、输出与所有控制注释状态，使单例解析器可安全复用。
   */
  public reset (): void {
    this.cssText = this.prefix = this.baseURI = this.linkPath = this.result = ''
    this.scopecssDisable = this.scopecssDisableNextLine = false
    this.scopecssDisableSelectors = []
    this.optionCssSelectors = []
  }

  /**
   * 连续匹配当前块中的注释、`@` 规则和普通样式规则，直到输入耗尽或遇到当前层右花括号。
   *
   * 循环体中的成功分支必须至少消费一个字符，否则会形成死循环。
   */
  private matchRules (): void {
    this.matchLeadingSpaces()
    this.matchComments()
    while (
      this.cssText.length &&
      this.cssText.charAt(0) !== '}' &&
      (this.matchAtRule() || this.matchStyleRule())
    ) {
      this.matchComments()
    }
  }

  /**
   * 匹配一条普通样式规则，改写选择器后递归消费声明块。
   *
   * @returns 匹配成功时为 `true`，当前游标不是有效规则或解析失败时为空。
   * @see https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleRule
   */
  private matchStyleRule (): boolean | void {
    const selectors = this.formatSelector(true)

    // “仅下一行”只覆盖当前选择器，必须在进入声明块前复位。
    this.scopecssDisableNextLine = false

    if (!selectors) return this.printError('selector missing', this.linkPath)

    this.recordResult(selectors)

    this.matchComments()

    this.styleDeclarations()

    this.matchLeadingSpaces()

    return true
  }

  /**
   * 读取并格式化当前规则的选择器列表。
   *
   * 属性选择器中的逗号会先被占位，防止列表分割误切；随后逐个选择器判断控制注释、根选择器和
   * `body` 映射，再决定是否添加子应用前缀。禁用列表用 trim 后的整段字符串执行 includes，
   * 因而 `div` 不会同时豁免 `div .child`；body 正则也可命中 `.x body` 中的 body。
   *
   * @param skip 是否只消费选择器而暂不把原文本写入结果。
   * @returns 格式化后的选择器文本；无法匹配时为 `false`。
   */
  private formatSelector (skip: boolean): false | string {
    const m = this.commonMatch(/^[^{]+/, skip)
    if (!m) return false

    /**
     * 先用占位值保护属性选择器内的逗号，再按逗号分段、恢复属性值并逐段添加前缀。
     * 当前正则不识别函数伪类括号：`:is(.a, .b)` 也会被拆开，第二段再次加前缀，因而会改变
     * 多参数伪类的含义。`body :not(.a)` 没有参数逗号，仍可进入 body 改写分支。
     */
    const attributeValues: {[key: string]: any} = {}
    const matchRes = m[0].replace(/\[([^\]=]+)(?:=([^\]]+))?\]/g, (match, p1, p2, offset) => {
      const mock = `__mock_${p1}_${offset}Value__`
      attributeValues[mock] = p2
      return match.replace(p2, mock)
    })

    return matchRes.replace(/(^|,[\n\s]*)([^,]+)/g, (_, separator, selector) => {
      selector = trim(selector)
      selector = selector.replace(/\[[^\]=]+(?:=([^\]]+))?\]/g, (match:string, p1: string) => {
        if (attributeValues[p1]) {
          return match.replace(p1, attributeValues[p1])
        }
        return match
      })

      // isolation-root 将 :root 移出免前缀列表；输出是“应用前缀 :root”，不会把 :root 替换为应用根。
      const isIsolationRoot = this.optionCssSelectors.some(includeSelector => {
        if (includeSelector === 'isolation-root') return true
        return false
      })
      const rootSelectorREG = isIsolationRoot ? /(^|\s+)(html)(?=[\s>~[.#:]+|$)/ : /(^|\s+)(html|:root)(?=[\s>~[.#:]+|$)/ // 未开启隔离时 html 与 :root 都保持全局根语义。

      // 根选择器检测先于 body 改写，所以 `html body` 整段保留；普通 `body .x` 才映射到应用 body。
      if (selector && !(
        this.scopecssDisableNextLine ||
        (
          this.scopecssDisable && (
            !this.scopecssDisableSelectors.length ||
            this.scopecssDisableSelectors.includes(selector)
          )
        ) ||
        rootSelectorREG.test(selector)
      )) {
        if (bodySelectorREG.test(selector)) {
          selector = selector.replace(bodySelectorREG, this.prefix + ' micro-app-body')
        } else {
          selector = this.prefix + ' ' + selector
        }
      }

      return separator + selector
    })
  }

  /**
   * 匹配一对花括号包裹的声明块，并把内部声明完整写入结果。
   *
   * @returns 声明块完整时为 `true`，缺少边界花括号时为空并上报错误。
   * @see https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleDeclaration
   */
  private styleDeclarations (): boolean | void {
    if (!this.matchOpenBrace()) return this.printError("Declaration missing '{'", this.linkPath)

    this.matchAllDeclarations()

    if (!this.matchCloseBrace()) return this.printError("Declaration missing '}'", this.linkPath)

    return true
  }

  /**
   * 消费声明块内容、嵌套花括号和其中的注释，同时补全相对 `url()`。
   *
   * data/blob、以 #/%23 开头的锚点及 http(s)、file、协议相对 URL 原样保留，匹配区分大小写。
   * 外链中非空且不以 / 开头的 URL 会把 baseURI 改为 CSS 文件目录，后续规则也沿用这个值；
   * 因此根路径 URL 采用“当前基址”的 origin，可能已由应用 origin 切换为 CSS 所在 origin。
   * 嵌套规则在这里作为声明文本消费，只保证花括号层次与文本保留，不逐层给嵌套选择器加前缀。
   * `nesting` 只允许内部右花括号被消费，最外层右花括号留给调用者校验。
   *
   * @param nesting 当前声明内部的附加花括号深度。
   */
  private matchAllDeclarations (nesting = 0): void {
    let cssValue = (this.commonMatch(/^(?:url\(["']?(?:[^)"'}]+)["']?\)|[^{}/])*/, true) as RegExpExecArray)[0]

    if (cssValue) {
      if (
        !this.scopecssDisableNextLine &&
        (!this.scopecssDisable || this.scopecssDisableSelectors.length)
      ) {
        cssValue = cssValue.replace(/url\((["']?)(.*?)\1\)/gm, (all, _, $1) => {
          if (/^((data|blob):|#|%23)/.test($1) || /^((https?|file):)?\/\//.test($1)) {
            return all
          }

          // 这是解析器字段的持久赋值，不是单个 URL 的局部基址；后续 /a.png 也采用 CSS origin。
          if (/^((\.\.?\/)|[^/])/.test($1) && this.linkPath) {
            this.baseURI = getLinkFileDir(this.linkPath)
          }

          return `url("${CompletionPath($1, this.baseURI)}")`
        })
      }

      this.recordResult(cssValue)
    }

    // 一次性控制注释在消费当前声明片段后失效。
    this.scopecssDisableNextLine = false

    if (!this.cssText.length) return

    // 声明内部的注释和嵌套块也必须被消费，否则游标会停滞。
    if (this.cssText.charAt(0) === '/') {
      if (this.cssText.charAt(1) === '*') {
        this.matchComments()
      } else {
        this.commonMatch(/\/+/)
      }
    } else if (this.cssText.charAt(0) === '{') {
      this.matchOpenBrace()
      nesting++
    } else if (this.cssText.charAt(0) === '}') {
      if (nesting < 1) return
      this.matchCloseBrace()
      nesting--
    }

    return this.matchAllDeclarations(nesting)
  }

  /**
   * 按固定优先级匹配当前 `@` 规则。
   *
   * 每个子匹配器先验证自己的规则前缀，失败时不得消费输入；首个成功匹配器负责完整消费该规则。
   *
   * @returns 匹配结果；当前字符不是 `@` 时为 `false`。
   */
  private matchAtRule (): boolean | void {
    if (this.cssText[0] !== '@') return false
    // “仅下一行”控制只作用于紧邻的普通规则，遇到 @ 规则时立即复位。
    this.scopecssDisableNextLine = false
    return this.keyframesRule() ||
      this.mediaRule() ||
      this.customMediaRule() ||
      this.supportsRule() ||
      this.importRule() ||
      this.charsetRule() ||
      this.namespaceRule() ||
      this.containerRule() ||
      this.documentRule() ||
      this.pageRule() ||
      this.hostRule() ||
      this.fontFaceRule() ||
      this.layerRule()
  }

  // `:global` 属于 CSS Modules 语法；若重新启用，应转换为普通选择器后再进入同一递归流程。
  // private matchGlobalRule (): boolean | void {
  //   if (this.cssText[0] !== ':') return false
  //   // reset scopecssDisableNextLine
  //   this.scopecssDisableNextLine = false

  //   return this.globalRule()
  // }

  /**
   * 匹配 `@keyframes` 及其中的全部关键帧规则。
   *
   * @returns 匹配成功时为 `true`，不是 keyframes 或结构不完整时为空/`false`。
   * @see https://developer.mozilla.org/en-US/docs/Web/API/CSSKeyframesRule
   */
  private keyframesRule (): boolean | void {
    if (!this.commonMatch(/^@([-\w]+)?keyframes\s*/)) return false

    if (!this.commonMatch(/^[^{]+/)) return this.printError('@keyframes missing name', this.linkPath)

    this.matchComments()

    if (!this.matchOpenBrace()) return this.printError("@keyframes missing '{'", this.linkPath)

    this.matchComments()
    while (this.keyframeRule()) {
      this.matchComments()
    }

    if (!this.matchCloseBrace()) return this.printError("@keyframes missing '}'", this.linkPath)

    this.matchLeadingSpaces()

    return true
  }

  /**
   * 匹配一条关键帧百分比或关键字列表及其声明块。
   *
   * @returns 至少读取一个关键帧位置时为 `true`，否则为 `false`。
   */
  private keyframeRule (): boolean {
    let r; const valList = []

    while (r = this.commonMatch(/^((\d+\.\d+|\.\d+|\d+)%?|[a-z]+)\s*/)) {
      valList.push(r[1])
      this.commonMatch(/^,\s*/)
    }

    if (!valList.length) return false

    this.styleDeclarations()

    this.matchLeadingSpaces()

    return true
  }

  /**
   * 匹配无块体的 `@custom-media` 声明。
   *
   * @returns 匹配成功时为 `true`。
   * @see https://github.com/postcss/postcss-custom-media
   */
  private customMediaRule (): boolean {
    if (!this.commonMatch(/^@custom-media\s+(--[^\s]+)\s*([^{;]+);/)) return false

    this.matchLeadingSpaces()

    return true
  }

  /**
   * 匹配 `@page` 选择器与其自身声明块。
   *
   * @returns 匹配成功时为 `true`，不是 page 规则或结构不完整时为空/`false`。
   * @see https://developer.mozilla.org/en-US/docs/Web/API/CSSPageRule
   */
  private pageRule (): boolean | void {
    if (!this.commonMatch(/^@page */)) return false

    this.formatSelector(false)

    // @page 的格式化已消费一次性控制状态，进入声明前复位。
    this.scopecssDisableNextLine = false

    return this.commonHandlerForAtRuleWithSelfRule('page')
  }

  /**
   * 匹配 `@font-face` 的自包含声明块。
   *
   * @returns 匹配成功时为 `true`，否则为空/`false`。
   * @see https://developer.mozilla.org/en-US/docs/Web/API/CSSFontFaceRule
   */
  private fontFaceRule (): boolean | void {
    if (!this.commonMatch(/^@font-face\s*/)) return false

    return this.commonHandlerForAtRuleWithSelfRule('font-face')
  }

  /**
   * 匹配命名 `@layer` 的语句形式或包含子规则的块形式；匿名 `@layer {}` 不符合此头部正则。
   *
   * @returns 完整消费 layer 规则时为 `true`，否则为空/`false`。
   * @see https://developer.mozilla.org/en-US/docs/Web/CSS/@layer
   */
  private layerRule (): boolean | void {
    if (!this.commonMatch(/^@layer\s*([^{;]+)/)) return false

    // `@layer theme, base, components, utilities;` 是没有花括号的声明形式。
    if (this.cssText.charAt(0) === ';') {
      this.commonMatch(/^;/) // 分号属于规则本身，必须一并消费。
      this.matchLeadingSpaces()
      return true
    }

    if (!this.matchOpenBrace()) return false

    this.matchComments()

    this.matchRules()

    if (!this.matchCloseBrace()) return this.printError('@layer missing \'}\'', this.linkPath)

    this.matchLeadingSpaces()

    return true
  }

  /** 匹配包含子规则的 `@media` 块。 */
  private mediaRule = this.createMatcherForRuleWithChildRule(/^@media *([^{]+)/, '@media')
  /** 匹配包含子规则的 `@supports` 块。 */
  private supportsRule = this.createMatcherForRuleWithChildRule(/^@supports *([^{]+)/, '@supports')
  /** 匹配厂商前缀或标准形式的 `@document` 块。 */
  private documentRule = this.createMatcherForRuleWithChildRule(/^@([-\w]+)?document *([^{]+)/, '@document')
  /** 匹配包含子规则的历史 `@host` 块。 */
  private hostRule = this.createMatcherForRuleWithChildRule(/^@host\s*/, '@host')
  // `:global` 属于 CSS Modules 语法；启用时应先转为普通选择器。
  // private globalRule = this.createMatcherForRuleWithChildRule(/^:global([^{]*)/, ':global')
  /** 原样消费以分号结束的 `@import`；不补全其 URL，也不加载或隔离被导入的 CSS。 */
  private importRule = this.createMatcherForNoneBraceAtRule('import')
  /** 原样消费以分号结束的 `@charset` 编码声明。 */
  private charsetRule = this.createMatcherForNoneBraceAtRule('charset')
  /** 匹配以分号结束、没有块体的 `@namespace`。 */
  private namespaceRule = this.createMatcherForNoneBraceAtRule('namespace')
  /** 匹配包含子规则的 `@container` 块。 */
  private containerRule = this.createMatcherForRuleWithChildRule(/^@container *([^{]+)/, '@container')

  /**
   * 创建“外层头部 + 子规则块”类型 `@` 规则的匹配器。
   *
   * 工厂返回的闭包复用当前解析器游标；头部不匹配时不得消费输入，匹配后则必须成对消费花括号并
   * 递归处理内部规则。
   *
   * @param reg 匹配规则头部的正则，必须以 `^` 锚定当前游标。
   * @param name 用于错误信息的规则名。
   * @returns 对当前游标执行匹配的函数。
   */
  private createMatcherForRuleWithChildRule (reg: RegExp, name: string): () => boolean | void {
    return () => {
      if (!this.commonMatch(reg)) return false

      if (!this.matchOpenBrace()) return this.printError(`${name} missing '{'`, this.linkPath)

      this.matchComments()

      this.matchRules()

      if (!this.matchCloseBrace()) return this.printError(`${name} missing '}'`, this.linkPath)

      this.matchLeadingSpaces()

      return true
    }
  }

  /**
   * 创建“头部 + 分号”类型无块体 `@` 规则的匹配器。
   *
   * @param name 不含 `@` 的规则名。
   * @returns 对当前游标执行匹配的函数。
   */
  private createMatcherForNoneBraceAtRule (name: string): () => boolean {
    const reg = new RegExp('^@' + name + '\\s*([^;]+);')
    return () => {
      if (!this.commonMatch(reg)) return false
      this.matchLeadingSpaces()
      return true
    }
  }

  /**
   * 处理只包含自身声明的 `@font-face`、`@page` 等规则。
   *
   * @param name 用于错误信息的规则名。
   * @returns 声明块完整时为 `true`，否则为空。
   */
  private commonHandlerForAtRuleWithSelfRule (name: string): boolean | void {
    if (!this.matchOpenBrace()) return this.printError(`@${name} missing '{'`, this.linkPath)

    this.matchAllDeclarations()

    if (!this.matchCloseBrace()) return this.printError(`@${name} missing '}'`, this.linkPath)

    this.matchLeadingSpaces()

    return true
  }

  /** 连续消费当前位置的全部 CSS 块注释。 */
  private matchComments (): void {
    while (this.matchComment());
  }

  /**
   * 消费一个 CSS 块注释、原样记录，并更新 scoped CSS 控制状态。
   *
   * 任意注释都会先清除 next-line，包括普通说明注释；带列表的 disable 累加选择器，
   * 裸 disable 只设置开关而不清空旧列表，只有 enable 同时清开关与列表。
   *
   * @returns 成功消费时为 `true`，当前位置不是注释时为 `false`，未闭合时为空并上报错误。
   */
  private matchComment (): boolean | void {
    if (this.cssText.charAt(0) !== '/' || this.cssText.charAt(1) !== '*') return false
    // 普通注释也会复位上一条“一次性禁用”，再由当前注释内容决定是否重新打开。
    this.scopecssDisableNextLine = false

    let i = 2
    while (this.cssText.charAt(i) !== '' && (this.cssText.charAt(i) !== '*' || this.cssText.charAt(i + 1) !== '/')) ++i
    i += 2

    if (this.cssText.charAt(i - 1) === '') {
      return this.printError('End of comment missing', this.linkPath)
    }

    // 注释必须原样输出，去除空白和 `!` 只用于识别控制指令。
    let commentText = this.cssText.slice(2, i - 2)

    this.recordResult(`/*${commentText}*/`)

    commentText = trim(commentText.replace(/^\s*!/, ''))

    // 更新全局、选择器级或下一规则级的作用域禁用配置。
    if (commentText === 'scopecss-disable-next-line') {
      this.scopecssDisableNextLine = true
    } else if (/^scopecss-disable/.test(commentText)) {
      if (commentText === 'scopecss-disable') {
        this.scopecssDisable = true
      } else {
        this.scopecssDisable = true
        const ignoreRules = commentText.replace('scopecss-disable', '').split(',')
        ignoreRules.forEach((rule: string) => {
          this.scopecssDisableSelectors.push(trim(rule))
        })
      }
    } else if (commentText === 'scopecss-enable') {
      this.scopecssDisable = false
      this.scopecssDisableSelectors = []
    }

    this.cssText = this.cssText.slice(i)

    this.matchLeadingSpaces()

    return true
  }

  /**
   * 在当前游标执行头部匹配，消费命中文本并按需写入结果。
   *
   * 所有解析器正则都应以 `^` 开始；只有命中后才移动游标，这是规则匹配失败可安全回退的基础。
   *
   * @param reg 以当前文本头部为起点的正则。
   * @param skip 是否只消费、不立即记录原文本。
   * @returns 正则匹配结果；未命中时为空且不移动游标。
   */
  private commonMatch (reg: RegExp, skip = false): RegExpExecArray | null | void {
    const matchArray = reg.exec(this.cssText)
    if (!matchArray) return
    const matchStr = matchArray[0]
    this.cssText = this.cssText.slice(matchStr.length)
    if (!skip) this.recordResult(matchStr)
    return matchArray
  }

  /** 消费左花括号及其后空白。 */
  private matchOpenBrace () {
    return this.commonMatch(/^{\s*/)
  }

  /** 消费右花括号及其后空白。 */
  private matchCloseBrace () {
    return this.commonMatch(/^}\s*/)
  }

  /** 消费并保留当前位置的前导空白。 */
  private matchLeadingSpaces (): void {
    this.commonMatch(/^\s*/)
  }

  /**
   * 按解析顺序追加一个结果片段。
   *
   * Firefox 对含特殊字符的字符串反复拼接可能显著退化，因此先逐片段编码，最终在 `exec` 返回前
   * 一次性解码；其他浏览器直接拼接。
   *
   * @param strFragment 已消费且需要保留/改写后的 CSS 片段。
   * @see https://github.com/jd-opensource/micro-app/issues/256
   */
  private recordResult (strFragment: string): void {
    if (isFireFox()) {
      this.result += encodeURIComponent(strFragment)
    } else {
      this.result += strFragment
    }
  }

  /**
   * 仅在仍有未消费文本时抛出解析错误。
   *
   * 输入恰好结束时不报错；例如 `div {` 在缺少右花括号时已耗尽文本，也会沿此分支返回而不抛出。
   *
   * @param msg 错误原因。
   * @param linkPath 可选外链样式地址。
   */
  private printError (msg: string, linkPath?: string): void {
    if (this.cssText.length) {
      parseError(msg, linkPath)
    }
  }
}

/**
 * 对一个 style 元素执行一次 scoped CSS 改写，并在失败时恢复解析器状态。
 *
 * `__MICRO_APP_HAS_SCOPED__` 在解析前置为 true，阻止重复添加前缀。失败只记录错误、保留原 CSS，
 * 标记仍为 true。已有文本路径的 observer 观察到无前缀的新文本时会清标记并重试；空 style
 * 路径的 observer 在调用前已断开，不持续重试。单例解析器在成功与异常路径都 reset，避免
 * 残余游标和控制注释状态影响下一份样式。
 *
 * @param styleElement 待改写的样式元素。
 * @param appName 子应用名称，用于错误日志。
 * @param prefix 要注入的选择器前缀。
 * @param baseURI 子应用资源基础地址。
 * @param linkPath 可选外链 CSS 地址。
 */
function commonAction (
  styleElement: HTMLStyleElement,
  appName: string,
  prefix: string,
  baseURI: string,
  linkPath?: string,
) {
  if (!styleElement.__MICRO_APP_HAS_SCOPED__) {
    styleElement.__MICRO_APP_HAS_SCOPED__ = true
    let result: string | null = null
    try {
      result = parser.exec(
        styleElement.textContent!,
        prefix,
        baseURI,
        linkPath,
      )
      parser.reset()
    } catch (e) {
      parser.reset()
      logError('An error occurred while parsing CSS:\n', appName, e)
    }

    if (result) styleElement.textContent = result
  }
}

/** 跨样式元素复用的串行 CSS 解析器；每次使用后必须由 `commonAction` 重置。 */
let parser: CSSParser

/**
 * 为子应用 style 元素启用选择器作用域和相对资源地址补全。
 *
 * 已有文本会立即处理，并观察框架后续替换 textContent 的情况；空 style 则等待首批子节点写入。
 * styled-components 通过 `data-styled` 管理自身规则，空节点延迟路径中不对其二次改写。
 *
 * @param styleElement 目标样式元素。
 * @param app 子应用实例，提供名称、资源基址和 scopecss 开关。
 * @param linkPath 可选外链 CSS 地址。
 * @returns 原样式元素，便于调用方继续插入 DOM。
 */
export default function scopedCSS (
  styleElement: HTMLStyleElement,
  app: AppInterface,
  linkPath?: string,
): HTMLStyleElement {
  if (app.scopecss) {
    const prefix = createPrefix(app.name)

    if (!parser) parser = new CSSParser()

    /**
     * 转义选择器前缀中的正则元字符，供 MutationObserver 判断新文本是否已处理。
     *
     * @param regStr 原始前缀。
     * @returns 可安全插入 `RegExp` 的文本。
     */
    const escapeRegExp = (regStr: string) => regStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    if (styleElement.textContent) {
      commonAction(styleElement, app.name, prefix, app.url, linkPath)

      // 框架可能整体替换已处理 style 的文本；观察一次变更，只有前缀消失时才重新执行作用域改写。
      const observer = new MutationObserver(() => {
        const escapedPrefix = escapeRegExp(prefix)
        const isPrefixed = styleElement.textContent && new RegExp(escapedPrefix).test(styleElement.textContent)
        observer.disconnect()
        if (!isPrefixed) {
          styleElement.__MICRO_APP_HAS_SCOPED__ = false
          scopedCSS(styleElement, app, linkPath)
        }
      })
      observer.observe(styleElement, { childList: true, characterData: true })
    } else {
      const observer = new MutationObserver(function () {
        observer.disconnect()
        // styled-components 自行维护动态样式，带 data-styled 的节点不做二次处理。
        if (styleElement.textContent && !styleElement.hasAttribute('data-styled')) {
          commonAction(
            styleElement,
            app.name,
            prefix,
            app.url,
            linkPath,
          )
        }
      })

      observer.observe(styleElement, { childList: true })
    }
  }

  return styleElement
}

/**
 * 生成子应用 scoped CSS 的根选择器前缀。
 *
 * @param appName 子应用名称。
 * @param reg 是否转义属性选择器的方括号以供正则使用。
 * @returns `micro-app[name=应用名]` 形式的选择器。
 */
export function createPrefix (appName: string, reg = false): string {
  const regCharacter = reg ? '\\' : ''
  return `${microApp.tagName}${regCharacter}[name=${appName}${regCharacter}]`
}
