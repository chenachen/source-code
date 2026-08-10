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
  /** 两个 script block 是否都采用可按 JavaScript 解析的语言。 */
  isJS: boolean
  /** 任一 script block 是否使用 TS/TSX；决定 Babel 插件和生成代码的类型处理。 */
  isTS: boolean
  /** 当前 SFC 是否按自定义元素编译。 */
  isCE = false

  /** 普通 `<script>` 的 Babel Program；缺少该 block 时为 null。 */
  scriptAst: Program | null
  /** `<script setup>` 的 Babel Program；宏扫描和源码改写都以它为主。 */
  scriptSetupAst: Program | null

  /** 完整 SFC 源码；所有 Babel 局部坐标最终都映射到这份文本。 */
  source: string = this.descriptor.source
  /** 诊断、source map 与默认组件名推导使用的 SFC 文件名。 */
  filename: string = this.descriptor.filename
  /** 覆盖完整 SFC 的可变字符串；各宏共享它，避免分段改写丢失全局坐标。 */
  s: MagicString = new MagicString(this.source)
  /** `<script setup>` 内容起点在完整 SFC 中的绝对 offset。 */
  startOffset: number | undefined =
    this.descriptor.scriptSetup?.loc.start.offset
  /** `<script setup>` 内容终点在完整 SFC 中的绝对 offset。 */
  endOffset: number | undefined = this.descriptor.scriptSetup?.loc.end.offset

  /** 当前 SFC 的类型解析作用域；首次解析类型引用时按需创建。 */
  scope?: TypeScope
  /** 用户配置的全局类型文件作用域；本地作用域找不到类型时再依次查询。 */
  globalScopes?: TypeScope[]
  /** setup 顶层本地名到 import 来源的索引，供宏识别、绑定分类与生成 import 使用。 */
  userImports: Record<string, ImportBinding> = Object.create(null)

  /** 是否已处理 defineProps；再次出现时报告重复宏调用。 */
  hasDefinePropsCall = false
  /** 是否已处理 defineEmits；再次出现时报告重复宏调用。 */
  hasDefineEmitCall = false
  /** 是否已处理 defineExpose；再次出现时报告重复宏调用。 */
  hasDefineExposeCall = false
  /** 普通 script 默认导出是否显式声明 name；为 true 时不再从文件名注入。 */
  hasDefaultExportName = false
  /** 普通 script 默认导出是否自带 render；无 template 时据此保留 setup 返回值。 */
  hasDefaultExportRender = false
  /** 是否已处理 defineOptions；再次出现时报告重复宏调用。 */
  hasDefineOptionsCall = false
  /** 是否已处理 defineSlots；再次出现时报告重复宏调用。 */
  hasDefineSlotsCall = false
  /** 是否处理过任意 defineModel；决定是否合并隐式 model props/emits。 */
  hasDefineModelCall = false

  /** defineProps 调用节点；最终用 `__props` 或 rest proxy 替换整段调用。 */
  propsCall: CallExpression | undefined
  /** 接收 defineProps 返回值的左值；可为标识符、解构模式或空。 */
  propsDecl: Node | undefined
  /** defineProps 的运行时对象/数组参数；与 `propsTypeDecl` 互斥。 */
  propsRuntimeDecl: Node | undefined
  /** defineProps 的类型参数；用于推导 runtime props 与 binding metadata。 */
  propsTypeDecl: Node | undefined
  /** 响应式 props 解构模式；后续据此重写所有局部读取。 */
  propsDestructureDecl: ObjectPattern | undefined
  /** 对外 prop 名到解构局部名/默认值的表，连接引用改写与 runtime defaults 生成。 */
  propsDestructuredBindings: PropsDestructureBindings = Object.create(null)
  /** props rest 解构的局部名；存在时生成 `createPropsRestProxy`。 */
  propsDestructureRestId: string | undefined
  /** withDefaults 的 defaults 参数；静态值内联，动态值交给 mergeDefaults。 */
  propsRuntimeDefaults: Node | undefined

  /** defineEmits 的运行时数组/对象参数；与 `emitsTypeDecl` 互斥。 */
  emitsRuntimeDecl: Node | undefined
  /** defineEmits 的类型参数；用于提取静态事件名。 */
  emitsTypeDecl: Node | undefined
  /** 接收 defineEmits 返回函数的左值；最终改写为 setup 上下文的 `emit`。 */
  emitDecl: Node | undefined

  // 按 model 名保存 defineModel 声明，支持多个不同名称。
  modelDecls: Record<string, ModelDecl> = Object.create(null)

  // defineOptions 的运行时对象表达式。
  optionsRuntimeDecl: Node | undefined

  /** script 分析交给 template 编译器的名字身份表。 */
  bindingMetadata: BindingMetadata = {}
  /** 宏转换实际使用的 Vue helper 名；最终去重生成一条 import。 */
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
