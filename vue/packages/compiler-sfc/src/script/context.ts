import type { CallExpression, Node, ObjectPattern, Program } from '@babel/types'
import type { SFCDescriptor } from '../parse'
import { generateCodeFrame, isArray } from '@vue/shared'
import { type ParserPlugin, parse as babelParse } from '@babel/parser'
import type { ImportBinding, SFCScriptCompileOptions } from '../compileScript'
import type { PropsDestructureBindings } from './defineProps'
import type { ModelDecl } from './defineModel'
import type { BindingMetadata } from '../../../compiler-core/src'
import MagicString from 'magic-string'
import type { TypeScope } from './resolveType'
import { warn } from '../warn'
import { isJS, isTS } from './utils'

/**
 * 一次 compileScript 调用共享的解析、宏状态、类型作用域与代码改写上下文。
 * 所有宏处理器只读写这里，最后由 compileScript 统一生成组件选项和 setup 返回值。
 */
export class ScriptCompileContext {
  /** 两个 script block 的整体语言模式。 */
  isJS: boolean
  isTS: boolean
  /** 当前 SFC 是否按自定义元素编译。 */
  isCE = false

  /** 普通 script 与 script setup 的 Babel Program；缺少对应 block 时为 null。 */
  scriptAst: Program | null
  scriptSetupAst: Program | null

  /** 完整 SFC 源码、文件名及基于完整源码执行的 MagicString。 */
  source: string = this.descriptor.source
  filename: string = this.descriptor.filename
  s: MagicString = new MagicString(this.source)
  startOffset: number | undefined =
    this.descriptor.scriptSetup?.loc.start.offset
  endOffset: number | undefined = this.descriptor.scriptSetup?.loc.end.offset

  // import 与跨文件类型解析状态。
  scope?: TypeScope
  globalScopes?: TypeScope[]
  userImports: Record<string, ImportBinding> = Object.create(null)

  // 各编译宏是否已出现；用于查重和决定最终组件选项。
  hasDefinePropsCall = false
  hasDefineEmitCall = false
  hasDefineExposeCall = false
  hasDefaultExportName = false
  hasDefaultExportRender = false
  hasDefineOptionsCall = false
  hasDefineSlotsCall = false
  hasDefineModelCall = false

  // defineProps 的调用、运行时/类型声明、解构及默认值信息。
  propsCall: CallExpression | undefined
  propsDecl: Node | undefined
  propsRuntimeDecl: Node | undefined
  propsTypeDecl: Node | undefined
  propsDestructureDecl: ObjectPattern | undefined
  propsDestructuredBindings: PropsDestructureBindings = Object.create(null)
  propsDestructureRestId: string | undefined
  propsRuntimeDefaults: Node | undefined

  // defineEmits 的运行时/类型声明及接收 emit 函数的变量。
  emitsRuntimeDecl: Node | undefined
  emitsTypeDecl: Node | undefined
  emitDecl: Node | undefined

  // 按 model 名保存 defineModel 声明，支持多个不同名称。
  modelDecls: Record<string, ModelDecl> = Object.create(null)

  // defineOptions 的运行时对象表达式。
  optionsRuntimeDecl: Node | undefined

  // 代码生成阶段共享的绑定分类和需要从 vue 导入的 helper。
  bindingMetadata: BindingMetadata = {}
  helperImports: Set<string> = new Set()
  /** 登记运行时 helper，并返回 compiler-sfc 约定的下划线局部名。 */
  helper(key: string): string {
    this.helperImports.add(key)
    return `_${key}`
  }

  /**
   * 类型宏实际读取的依赖，暴露给编译结果供 HMR 精确失效缓存。
   */
  deps?: Set<string>

  /**
   * 解析后的文件系统适配器缓存，避免每次类型引用都重新规范化用户 fs。
   */
  fs?: NonNullable<SFCScriptCompileOptions['fs']>

  /**
   * 为一份 SFC 建立脚本编译上下文：确定语言/CE 模式，解析两个 script AST，并初始化宏状态。
   */
  constructor(
    public descriptor: SFCDescriptor,
    public options: Partial<SFCScriptCompileOptions>,
  ) {
    const { script, scriptSetup } = descriptor
    const scriptLang = script && script.lang
    const scriptSetupLang = scriptSetup && scriptSetup.lang

    this.isJS = isJS(scriptLang, scriptSetupLang)
    this.isTS = isTS(scriptLang, scriptSetupLang)

    const customElement = options.customElement
    const filename = this.descriptor.filename
    if (customElement) {
      this.isCE =
        typeof customElement === 'boolean'
          ? customElement
          : customElement(filename)
    }
    // 根据 lang 组合 Babel 插件，确保普通 script 与 setup 使用同一语法方言。
    const plugins: ParserPlugin[] = resolveParserPlugins(
      (scriptLang || scriptSetupLang)!,
      options.babelParserPlugins,
    )

    /** 解析单个 block，并把 Babel 的局部错误坐标映射回完整 SFC code frame。 */
    function parse(input: string, offset: number): Program {
      try {
        return babelParse(input, {
          plugins,
          sourceType: 'module',
        }).program
      } catch (e: any) {
        e.message = `[vue/compiler-sfc] ${e.message}\n\n${
          descriptor.filename
        }\n${generateCodeFrame(
          descriptor.source,
          e.pos + offset,
          e.pos + offset + 1,
        )}`
        throw e
      }
    }

    this.scriptAst =
      descriptor.script &&
      parse(descriptor.script.content, descriptor.script.loc.start.offset)

    this.scriptSetupAst =
      descriptor.scriptSetup &&
      parse(descriptor.scriptSetup!.content, this.startOffset!)
  }

  /** 从指定 script block 取回 Babel 节点对应的原始源码。 */
  getString(node: Node, scriptSetup = true): string {
    const block = scriptSetup
      ? this.descriptor.scriptSetup!
      : this.descriptor.script!
    return block.content.slice(node.start!, node.end!)
  }

  /** 输出带节点位置和 code frame 的编译警告。 */
  warn(msg: string, node: Node, scope?: TypeScope): void {
    warn(generateError(msg, node, this, scope))
  }

  /** 抛出带节点位置和 code frame 的不可恢复编译错误。 */
  error(msg: string, node: Node, scope?: TypeScope): never {
    throw new Error(
      `[@vue/compiler-sfc] ${generateError(msg, node, this, scope)}`,
    )
  }
}

/** 将 AST 局部坐标结合 block/type scope 偏移，格式化为完整文件诊断。 */
function generateError(
  msg: string,
  node: Node,
  ctx: ScriptCompileContext,
  scope?: TypeScope,
) {
  const offset = scope ? scope.offset : ctx.startOffset!
  return `${msg}\n\n${(scope || ctx.descriptor).filename}\n${generateCodeFrame(
    (scope || ctx.descriptor).source,
    node.start! + offset,
    node.end! + offset,
  )}`
}

/**
 * 根据 script lang 和用户配置生成去冲突的 Babel parser 插件列表。
 * TS/TSX 自动启用 TypeScript、资源管理与 legacy decorators；非 JSX 语言会主动移除用户
 * 传入的 jsx，避免 Babel 把 TypeScript 泛型等语法按 JSX 误解析。
 */
export function resolveParserPlugins(
  lang: string,
  userPlugins?: ParserPlugin[],
  dts = false,
): ParserPlugin[] {
  const plugins: ParserPlugin[] = []
  if (
    !userPlugins ||
    !userPlugins.some(
      p =>
        p === 'importAssertions' ||
        p === 'importAttributes' ||
        (isArray(p) && p[0] === 'importAttributes'),
    )
  ) {
    plugins.push('importAttributes')
  }
  if (lang === 'jsx' || lang === 'tsx' || lang === 'mtsx') {
    plugins.push('jsx')
  } else if (userPlugins) {
    // 非 jsx/tsx lang 不应被用户插件强行切换成 JSX 语法。
    userPlugins = userPlugins.filter(p => p !== 'jsx')
  }
  if (
    lang === 'ts' ||
    lang === 'mts' ||
    lang === 'tsx' ||
    lang === 'cts' ||
    lang === 'mtsx'
  ) {
    plugins.push(['typescript', { dts }], 'explicitResourceManagement')
    if (!userPlugins || !userPlugins.includes('decorators')) {
      plugins.push('decorators-legacy')
    }
  }
  if (userPlugins) {
    plugins.push(...userPlugins)
  }
  return plugins
}
