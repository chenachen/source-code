import {
  BindingTypes,
  UNREF,
  isFunctionType,
  unwrapTSNode,
  walkIdentifiers,
} from '@vue/compiler-dom'
import {
  DEFAULT_FILENAME,
  type SFCDescriptor,
  type SFCScriptBlock,
} from './parse'
import type { ParserPlugin } from '@babel/parser'
import { generateCodeFrame } from '@vue/shared'
import type {
  ArrayPattern,
  CallExpression,
  Declaration,
  ExportSpecifier,
  Identifier,
  LVal,
  Node,
  ObjectPattern,
  Statement,
} from '@babel/types'
import { walk } from 'estree-walker'
import {
  type RawSourceMap,
  SourceMapConsumer,
  SourceMapGenerator,
} from 'source-map-js'
import {
  normalScriptDefaultVar,
  processNormalScript,
} from './script/normalScript'
import { CSS_VARS_HELPER, genCssVarsCode } from './style/cssVars'
import {
  type SFCTemplateCompileOptions,
  compileTemplate,
} from './compileTemplate'
import { warnOnce } from './warn'
import { transformDestructuredProps } from './script/definePropsDestructure'
import { ScriptCompileContext } from './script/context'
import {
  DEFINE_PROPS,
  WITH_DEFAULTS,
  genRuntimeProps,
  processDefineProps,
} from './script/defineProps'
import {
  DEFINE_EMITS,
  genRuntimeEmits,
  processDefineEmits,
} from './script/defineEmits'
import { DEFINE_EXPOSE, processDefineExpose } from './script/defineExpose'
import { DEFINE_OPTIONS, processDefineOptions } from './script/defineOptions'
import { DEFINE_SLOTS, processDefineSlots } from './script/defineSlots'
import { DEFINE_MODEL, processDefineModel } from './script/defineModel'
import {
  getImportedName,
  isCallOf,
  isJS,
  isLiteralNode,
  isTS,
} from './script/utils'
import { analyzeScriptBindings } from './script/analyzeScriptBindings'
import {
  isImportUsed,
  resolveTemplateVModelIdentifiers,
} from './script/importUsageCheck'
import { processAwait } from './script/topLevelAwait'

/** script/script setup 合并编译选项。 */
export interface SFCScriptCompileOptions {
  /**
   * 注入 CSS 变量名称所用的作用域 ID，必须与传给 compileStyle 的 id 一致。
   */
  id: string
  /**
   * 是否为生产模式；决定 CSS 变量名是否压缩为散列等产物策略。
   */
  isProd?: boolean
  /**
   * 是否生成 source map，默认 true。
   */
  sourceMap?: boolean
  /**
   * 追加的 Babel parser 插件：https://babeljs.io/docs/en/babel-parser#plugins
   */
  babelParserPlugins?: ParserPlugin[]
  /**
   * 提供给 SFC 宏类型解析的全局声明文件列表，必须是已解析的绝对文件路径。
   */
  globalTypeFiles?: string[]
  /**
   * 编译模板并把 render 函数直接内联到 setup。
   * 仅影响 script setup；通常只用于生产，因为内联后模板无法脱离组件状态单独热更新。
   */
  inlineTemplate?: boolean
  /**
   * 将最终组件生成为指定变量而非 default export，供 vite-plugin-vue 等把 script
   * 拼入主模块后继续附加 render、scopeId 使用。
   */
  genDefaultAs?: string
  /**
   * 内联模板时传给 compiler-sfc `compileTemplate()` 的选项，不是直接传给 compiler-dom。
   */
  templateOptions?: Partial<SFCTemplateCompileOptions>
  /**
   * 是否把 script setup 的静态常量提升到 setup 外；只有不存在普通 script 时才启用。
   * @default true
   */
  hoistStatic?: boolean
  /**
   * false 关闭 defineProps 响应式解构（Vue 3.5 前行为）；`'error'` 明确禁止并报错。
   * @default true
   */
  propsDestructure?: boolean | 'error'
  /**
   * 解析 SFC 宏导入类型所用文件系统；Node 默认使用 ts.sys，也可注入浏览器 REPL 的虚拟 FS。
   */
  fs?: {
    /** 判断类型依赖文件是否存在。 */
    fileExists(file: string): boolean
    /** 读取类型依赖源码；不存在时返回 undefined。 */
    readFile(file: string): string | undefined
    /** 可选地把符号链接等路径解析成规范真实路径。 */
    realpath?(file: string): string
  }
  /**
   * 是否把 SFC 编译为 Custom Element；函数形式可按文件名决定。
   */
  customElement?: boolean | ((filename: string) => boolean)
}

/** 用户 import 的来源、类型性与模板使用状态。 */
export interface ImportBinding {
  /** 是否为 type-only import。 */
  isType: boolean
  /** 源模块中的导入名，default/* 分别使用对应字符串。 */
  imported: string
  /** 当前模块局部名。 */
  local: string
  /** 模块 specifier。 */
  source: string
  /** 是否声明于 script setup 而非普通 script。 */
  isFromSetup: boolean
  /** 非 inline 模式下是否必须暴露给模板。 */
  isUsedInTemplate: boolean
}

/** 无需从 Vue 导入、由 compiler-sfc 在编译期消除的宏名称。 */
const MACROS = [
  DEFINE_PROPS,
  DEFINE_EMITS,
  DEFINE_EXPOSE,
  DEFINE_OPTIONS,
  DEFINE_SLOTS,
  DEFINE_MODEL,
  WITH_DEFAULTS,
]

/**
 * 编译 script setup，并在同时存在普通 script 时合并两者。
 *
 * descriptor 同时提供脚本、模板和样式信息：模板使用分析决定返回哪些 import，CSS vars
 * 决定是否注入 useCssVars，内联模板还需要 scoped/slotted 状态。宏类型解析另行读取类型依赖。
 * 先收集 import 并合并普通 script，再删除/改写宏与顶层 await，随后确定绑定类别、检查
 * 提升参数的作用域，最后生成 props/emits、setup 返回值（或内联 render）及组件导出。
 * MagicString 始终使用完整 SFC 的原始偏移，语句移动不会改变后续 AST 节点的定位基准。
 *
 * @param sfc - parse 产出的完整 descriptor；无 setup 时走普通 script 的独立处理路径。
 * @param options - scope id、类型文件系统、解构与模板内联等编译配置。
 * @returns 受支持语言返回生成代码及绑定/AST/map/依赖；未知语言或普通脚本后处理失败时可返回原块。
 * @throws 缺少脚本、语言不一致、Babel 解析失败或宏约束违反；宏诊断附完整 SFC 中的源码位置。
 */
export function compileScript(
  sfc: SFCDescriptor,
  options: SFCScriptCompileOptions,
): SFCScriptBlock {
  if (!options.id) {
    warnOnce(
      `compileScript now requires passing the \`id\` option.\n` +
        `Upgrade your vite or vue-loader version for compatibility with ` +
        `the latest experimental proposals.`,
    )
  }

  const { script, scriptSetup, source, filename } = sfc
  const hoistStatic = options.hoistStatic !== false && !script
  const scopeId = options.id ? options.id.replace(/^data-v-/, '') : ''
  const scriptLang = script && script.lang
  const scriptSetupLang = scriptSetup && scriptSetup.lang
  const isJSOrTS =
    isJS(scriptLang, scriptSetupLang) || isTS(scriptLang, scriptSetupLang)

  if (script && scriptSetup && scriptLang !== scriptSetupLang) {
    throw new Error(
      `[@vue/compiler-sfc] <script> and <script setup> must have the same ` +
        `language type.`,
    )
  }

  if (!scriptSetup) {
    if (!script) {
      throw new Error(`[@vue/compiler-sfc] SFC contains no <script> tags.`)
    }

    // 只有普通 script 时走较轻的 Options API/CSS vars 处理路径。
    if (script.lang && !isJSOrTS) {
      // 非 JS/TS 语言留给上层自定义插件处理。
      return script
    }

    const ctx = new ScriptCompileContext(sfc, options)
    return processNormalScript(ctx, scopeId)
  }

  if (scriptSetupLang && !isJSOrTS) {
    // 非 JS/TS 的 script setup 同样原样返回。
    return scriptSetup
  }

  const ctx = new ScriptCompileContext(sfc, options)

  // 分别记录普通 script 与 setup 声明，最终合并进模板 bindingMetadata/返回对象。
  const scriptBindings: Record<string, BindingTypes> = Object.create(null)
  const setupBindings: Record<string, BindingTypes> = Object.create(null)

  let defaultExport: Node | undefined
  let hasAwait = false
  let hasInlinedSsrRenderFn = false

  // Babel 节点坐标相对各 block；MagicString 坐标相对完整 SFC，因此集中保存偏移。
  const startOffset = ctx.startOffset!
  const endOffset = ctx.endOffset!
  const scriptStartOffset = script && script.loc.start.offset
  const scriptEndOffset = script && script.loc.end.offset

  /** 把 setup 顶层语句连同尾注释/空白移动到模块最前，保持源码布局与注释归属。 */
  function hoistNode(node: Statement) {
    const start = node.start! + startOffset
    let end = node.end! + startOffset
    // Babel statement.end 不一定包含 trailing comment，需要手动扩展移动范围。
    if (node.trailingComments && node.trailingComments.length > 0) {
      const lastCommentNode =
        node.trailingComments[node.trailingComments.length - 1]
      end = lastCommentNode.end! + startOffset
    }
    // 连同与下一语句之间的空白移动，避免原位置残留多余空行/缩进。
    while (end <= source.length) {
      if (!/\s/.test(source.charAt(end))) {
        break
      }
      end++
    }
    ctx.s.move(start, end, 0)
  }

  /**
   * 把值/类型 import 按本地名写入 ctx.userImports，保留来源、原名及属于哪个 script。
   * 非内联 TS+HTML 模板按标识符使用决定是否返回该 import；JS 或预处理模板采取保留策略。
   * 此函数只登记状态，import 去重、冲突诊断与 MagicString 移动由外层语句扫描负责。
   */
  function registerUserImport(
    source: string,
    local: string,
    imported: string,
    isType: boolean,
    isFromSetup: boolean,
    needTemplateUsageCheck: boolean,
  ) {
    // inline render 闭包可直接捕获 import；只有非 inline setup 返回对象需要模板使用分析。
    let isUsedInTemplate = needTemplateUsageCheck
    if (
      needTemplateUsageCheck &&
      ctx.isTS &&
      sfc.template &&
      !sfc.template.src &&
      !sfc.template.lang
    ) {
      isUsedInTemplate = isImportUsed(local, sfc, options.templateOptions)
    }

    ctx.userImports[local] = {
      isType,
      imported,
      local,
      source,
      isFromSetup,
      isUsedInTemplate,
    }
  }

  /**
   * 禁止被提升到 setup 外的宏参数引用 setup 局部变量。
   * 只放行已被绑定分类标为 LITERAL_CONST 的 setup 局部常量；其余局部绑定不能供模块选项使用。
   * 调用者决定检查哪些参数：defineModel 仅检查静态可拆对象中的 prop 选项，get/set 保留在 setup。
   */
  function checkInvalidScopeReference(node: Node | undefined, method: string) {
    if (!node) return
    walkIdentifiers(node, id => {
      const binding = setupBindings[id.name]
      if (binding && binding !== BindingTypes.LITERAL_CONST) {
        ctx.error(
          `\`${method}()\` in <script setup> cannot reference locally ` +
            `declared variables because it will be hoisted outside of the ` +
            `setup() function. If your component options require initialization ` +
            `in the module scope, use a separate normal <script> to export ` +
            `the options instead.`,
          id,
        )
      }
    })
  }

  const scriptAst = ctx.scriptAst
  const scriptSetupAst = ctx.scriptSetupAst!

  // 1.1 记录普通 script import，供 setup import 去重与冲突检查。
  if (scriptAst) {
    for (const node of scriptAst.body) {
      if (node.type === 'ImportDeclaration') {
        // 普通 script import 保持原位，只登记元数据。
        for (const specifier of node.specifiers) {
          const imported = getImportedName(specifier)
          registerUserImport(
            node.source.value,
            specifier.local.name,
            imported,
            node.importKind === 'type' ||
              (specifier.type === 'ImportSpecifier' &&
                specifier.importKind === 'type'),
            false,
            !options.inlineTemplate,
          )
        }
      }
    }
  }

  // 1.2 处理 script setup import。
  for (const node of scriptSetupAst.body) {
    if (node.type === 'ImportDeclaration') {
      // import 必须处于模块顶层，移到合并后源码最前。
      hoistNode(node)

      // 删除与普通 script/setup 其他说明符完全相同的 import，局部名冲突则报错。
      let removed = 0
      /** 从当前 import 声明移除指定 specifier，并正确连同相邻逗号/空白删除。 */
      const removeSpecifier = (i: number) => {
        const removeLeft = i > removed
        removed++
        const current = node.specifiers[i]
        const next = node.specifiers[i + 1]
        ctx.s.remove(
          removeLeft
            ? node.specifiers[i - 1].end! + startOffset
            : current.start! + startOffset,
          next && !removeLeft
            ? next.start! + startOffset
            : current.end! + startOffset,
        )
      }

      for (let i = 0; i < node.specifiers.length; i++) {
        const specifier = node.specifiers[i]
        const local = specifier.local.name
        const imported = getImportedName(specifier)
        const source = node.source.value
        const existing = ctx.userImports[local]
        if (source === 'vue' && MACROS.includes(imported)) {
          if (local === imported) {
            warnOnce(
              `\`${imported}\` is a compiler macro and no longer needs to be imported.`,
            )
          } else {
            ctx.error(
              `\`${imported}\` is a compiler macro and cannot be aliased to ` +
                `a different name.`,
              specifier,
            )
          }
          removeSpecifier(i)
        } else if (existing) {
          if (existing.source === source && existing.imported === imported) {
            // 同源、同导入名、同局部名可安全去重。
            removeSpecifier(i)
          } else {
            ctx.error(
              `different imports aliased to same local name.`,
              specifier,
            )
          }
        } else {
          registerUserImport(
            source,
            local,
            imported,
            node.importKind === 'type' ||
              (specifier.type === 'ImportSpecifier' &&
                specifier.importKind === 'type'),
            true,
            !options.inlineTemplate,
          )
        }
      }
      if (node.specifiers.length && removed === node.specifiers.length) {
        ctx.s.remove(node.start! + startOffset, node.end! + startOffset)
      }
    }
  }

  // 1.3 建立 Vue API 原名→用户别名，用于识别 `ref as myRef` 等调用的绑定类型。
  const vueImportAliases: Record<string, string> = {}
  for (const key in ctx.userImports) {
    const { source, imported, local } = ctx.userImports[key]
    if (source === 'vue') vueImportAliases[imported] = local
  }

  // 2.1 处理普通 script 的默认导出和顶层绑定。
  if (script && scriptAst) {
    for (const node of scriptAst.body) {
      if (node.type === 'ExportDefaultDeclaration') {
        // 保存并改写默认导出，稍后与生成的 setup/options 合并。
        defaultExport = node

        // 检查用户是否显式给出 name/render：已有 name 时不再从文件名推导；#4980 中
        // 没有 template 但普通 script 自带 render 时，应返回 setup bindings 而非内联空 render。
        let optionProperties
        if (defaultExport.declaration.type === 'ObjectExpression') {
          optionProperties = defaultExport.declaration.properties
        } else if (
          defaultExport.declaration.type === 'CallExpression' &&
          defaultExport.declaration.arguments[0] &&
          defaultExport.declaration.arguments[0].type === 'ObjectExpression'
        ) {
          optionProperties = defaultExport.declaration.arguments[0].properties
        }
        if (optionProperties) {
          for (const p of optionProperties) {
            if (
              p.type === 'ObjectProperty' &&
              p.key.type === 'Identifier' &&
              p.key.name === 'name'
            ) {
              ctx.hasDefaultExportName = true
            }
            if (
              (p.type === 'ObjectMethod' || p.type === 'ObjectProperty') &&
              p.key.type === 'Identifier' &&
              p.key.name === 'render'
            ) {
              // TODO：未来提供更明确的 script setup 自定义 render 方式后，可在此给迁移警告。
              ctx.hasDefaultExportRender = true
            }
          }
        }

        // `export default {...}` → `const __default__ = {...}`，留给最终组件选项合并。
        const start = node.start! + scriptStartOffset!
        const end = node.declaration.start! + scriptStartOffset!
        ctx.s.overwrite(start, end, `const ${normalScriptDefaultVar} = `)
      } else if (node.type === 'ExportNamedDeclaration') {
        const defaultSpecifier = node.specifiers.find(
          s =>
            s.exported.type === 'Identifier' && s.exported.name === 'default',
        ) as ExportSpecifier
        if (defaultSpecifier) {
          defaultExport = node
          // 从具名导出列表删除 default specifier，保留其他导出。
          if (node.specifiers.length > 1) {
            ctx.s.remove(
              defaultSpecifier.start! + scriptStartOffset!,
              defaultSpecifier.end! + scriptStartOffset!,
            )
          } else {
            ctx.s.remove(
              node.start! + scriptStartOffset!,
              node.end! + scriptStartOffset!,
            )
          }
          if (node.source) {
            // `export { x as default } from './x'` 改为顶部 import 到 `__default__`。
            ctx.s.prepend(
              `import { ${defaultSpecifier.local.name} as ${normalScriptDefaultVar} } from '${node.source.value}'\n`,
            )
          } else {
            // `export { x as default }` 改为 script 末尾的 `const __default__ = x`。
            ctx.s.appendLeft(
              scriptEndOffset!,
              `\nconst ${normalScriptDefaultVar} = ${defaultSpecifier.local.name}\n`,
            )
          }
        }
        if (node.declaration) {
          walkDeclaration(
            'script',
            node.declaration,
            scriptBindings,
            vueImportAliases,
            hoistStatic,
          )
        }
      } else if (
        (node.type === 'VariableDeclaration' ||
          node.type === 'FunctionDeclaration' ||
          node.type === 'ClassDeclaration' ||
          node.type === 'TSEnumDeclaration') &&
        !node.declare
      ) {
        walkDeclaration(
          'script',
          node,
          scriptBindings,
          vueImportAliases,
          hoistStatic,
        )
      }
    }

    // 普通 script 写在 setup 后时仍要整体前移，保证 __default__ 在最终组件定义前初始化。
    if (scriptStartOffset! > startOffset) {
      // 补换行，避免移动后最后一行与 setup 源码粘连。
      if (!/\n$/.test(script.content.trim())) {
        ctx.s.appendLeft(scriptEndOffset!, `\n`)
      }
      ctx.s.move(scriptStartOffset!, scriptEndOffset!, 0)
    }
  }

  // 2.2 遍历 script setup 顶层语句，消除/改写编译宏并收集声明。
  for (const node of scriptSetupAst.body) {
    if (node.type === 'ExpressionStatement') {
      const expr = unwrapTSNode(node.expression)
      // 无返回值使用的宏调用可整句删除；defineExpose 需保留为运行时 expose 调用。
      if (
        processDefineProps(ctx, expr) ||
        processDefineEmits(ctx, expr) ||
        processDefineOptions(ctx, expr) ||
        processDefineSlots(ctx, expr)
      ) {
        ctx.s.remove(node.start! + startOffset, node.end! + startOffset)
      } else if (processDefineExpose(ctx, expr)) {
        // `defineExpose({})` → setup context 中的 `__expose({})`。
        const callee = (expr as CallExpression).callee
        ctx.s.overwrite(
          callee.start! + startOffset,
          callee.end! + startOffset,
          '__expose',
        )
      } else {
        processDefineModel(ctx, expr)
      }
    }

    if (node.type === 'VariableDeclaration' && !node.declare) {
      const total = node.declarations.length
      let left = total
      let lastNonRemoved: number | undefined

      for (let i = 0; i < total; i++) {
        const decl = node.declarations[i]
        const init = decl.init && unwrapTSNode(decl.init)
        if (init) {
          if (processDefineOptions(ctx, init)) {
            ctx.error(
              `${DEFINE_OPTIONS}() has no returning value, it cannot be assigned.`,
              node,
            )
          }

          // defineProps 可能记录解构声明并导致当前 declarator 整体删除。
          const isDefineProps = processDefineProps(ctx, init, decl.id as LVal)
          if (ctx.propsDestructureRestId) {
            setupBindings[ctx.propsDestructureRestId] =
              BindingTypes.SETUP_REACTIVE_CONST
          }

          // defineEmits 的返回值直接替换为 setup 参数 `__emit`。
          const isDefineEmits =
            !isDefineProps && processDefineEmits(ctx, init, decl.id as LVal)
          !isDefineEmits &&
            (processDefineSlots(ctx, init, decl.id as LVal) ||
              processDefineModel(ctx, init, decl.id as LVal))

          if (
            isDefineProps &&
            !ctx.propsDestructureRestId &&
            ctx.propsDestructureDecl
          ) {
            if (left === 1) {
              ctx.s.remove(node.start! + startOffset, node.end! + startOffset)
            } else {
              let start = decl.start! + startOffset
              let end = decl.end! + startOffset
              if (i === total - 1) {
                // 删除声明列表最后一项时从前一个保留项末尾起删，连同逗号一起移除。
                start = node.declarations[lastNonRemoved!].end! + startOffset
              } else {
                // 非末项删到下一声明起点，连同后置逗号/空白一起移除。
                end = node.declarations[i + 1].start! + startOffset
              }
              ctx.s.remove(start, end)
              left--
            }
          } else if (isDefineEmits) {
            ctx.s.overwrite(
              startOffset + init.start!,
              startOffset + init.end!,
              '__emit',
            )
          } else {
            lastNonRemoved = i
          }
        }
      }
    }

    let isAllLiteral = false
    // 对剩余顶层声明分类，决定模板访问是否需 unref、getter/setter 或可直接内联。
    if (
      (node.type === 'VariableDeclaration' ||
        node.type === 'FunctionDeclaration' ||
        node.type === 'ClassDeclaration' ||
        node.type === 'TSEnumDeclaration') &&
      !node.declare
    ) {
      isAllLiteral = walkDeclaration(
        'scriptSetup',
        node,
        setupBindings,
        vueImportAliases,
        hoistStatic,
        !!ctx.propsDestructureDecl,
      )
    }

    // 全部由静态字面量组成的声明可提升到 setup 外，避免每个实例重复创建。
    if (hoistStatic && isAllLiteral) {
      hoistNode(node)
    }

    // 遍历语句/具名导出/变量初始化中的顶层 await，注入异步上下文恢复。
    if (
      (node.type === 'VariableDeclaration' && !node.declare) ||
      node.type.endsWith('Statement')
    ) {
      const scope: Statement[][] = [scriptSetupAst.body]
      walk(node, {
        /** 进入节点时维护 block scope，并把顶层 await 改写为异步上下文安全形式。 */
        enter(child: Node, parent: Node | null) {
          if (isFunctionType(child)) {
            this.skip()
          }
          if (child.type === 'BlockStatement') {
            scope.push(child.body)
          }
          if (child.type === 'AwaitExpression') {
            hasAwait = true
            // await 是表达式语句且位于根级，或不是嵌套 block 第一条时，生成代码前补分号，
            // 防止上一语句因 ASI 与开头括号拼成函数调用。
            const currentScope = scope[scope.length - 1]
            const needsSemi = currentScope.some((n, i) => {
              return (
                (scope.length === 1 || i > 0) &&
                n.type === 'ExpressionStatement' &&
                n.start === child.start
              )
            })
            processAwait(
              ctx,
              child,
              needsSemi,
              parent!.type === 'ExpressionStatement',
            )
          }
        },
        /** 离开 block 时恢复外层语句列表。 */
        exit(node: Node) {
          if (node.type === 'BlockStatement') scope.pop()
        },
      })
    }

    if (
      (node.type === 'ExportNamedDeclaration' && node.exportKind !== 'type') ||
      node.type === 'ExportAllDeclaration' ||
      node.type === 'ExportDefaultDeclaration'
    ) {
      ctx.error(
        `<script setup> cannot contain ES module exports. ` +
          `If you are using a previous version of <script setup>, please ` +
          `consult the updated RFC at https://github.com/vuejs/rfcs/pull/227.`,
        node,
      )
    }

    if (ctx.isTS) {
      // 类型声明没有实例状态且可能被生成组件类型引用，统一提升到 setup 外的模块作用域。
      if (
        node.type.startsWith('TS') ||
        (node.type === 'ExportNamedDeclaration' &&
          node.exportKind === 'type') ||
        (node.type === 'VariableDeclaration' && node.declare)
      ) {
        if (node.type !== 'TSEnumDeclaration') {
          hoistNode(node)
        }
      }
    }
  }

  // 3. 把响应式 props 解构引用重写为 __props 访问。
  if (ctx.propsDestructureDecl) {
    transformDestructuredProps(ctx, vueImportAliases)
  }

  // 4. 宏生成的组件选项位于 setup 外，检查其参数不能捕获 setup 局部变量。
  checkInvalidScopeReference(ctx.propsRuntimeDecl, DEFINE_PROPS)
  checkInvalidScopeReference(ctx.propsRuntimeDefaults, DEFINE_PROPS)
  checkInvalidScopeReference(ctx.propsDestructureDecl, DEFINE_PROPS)
  checkInvalidScopeReference(ctx.emitsRuntimeDecl, DEFINE_EMITS)
  checkInvalidScopeReference(ctx.optionsRuntimeDecl, DEFINE_OPTIONS)
  for (const { runtimeOptionNodes } of Object.values(ctx.modelDecls)) {
    for (const node of runtimeOptionNodes) {
      checkInvalidScopeReference(node, DEFINE_MODEL)
    }
  }

  // 5. 从完整 SFC MagicString 删除 template/style/custom block，只保留合并后的脚本。
  if (script) {
    if (startOffset < scriptStartOffset!) {
      // setup 在普通 script 前：删除 setup 结束到普通 script 内容起点之间的标签/块。
      ctx.s.remove(0, startOffset)
      ctx.s.remove(endOffset, scriptStartOffset!)
      ctx.s.remove(scriptEndOffset!, source.length)
    } else {
      // 普通 script 在 setup 前：删除普通 script 结束到 setup 内容起点之间的区域。
      ctx.s.remove(0, scriptStartOffset!)
      ctx.s.remove(scriptEndOffset!, startOffset)
      ctx.s.remove(endOffset, source.length)
    }
  } else {
    // 只有 setup：删除其内容前后所有 SFC 外壳。
    ctx.s.remove(0, startOffset)
    ctx.s.remove(endOffset, source.length)
  }

  // 6. 汇总普通 script、setup、import 绑定；defineProps/defineModel 已提前登记 props。
  if (scriptAst) {
    Object.assign(ctx.bindingMetadata, analyzeScriptBindings(scriptAst.body))
  }
  for (const [key, { isType, imported, source }] of Object.entries(
    ctx.userImports,
  )) {
    if (isType) continue
    ctx.bindingMetadata[key] =
      imported === '*' ||
      (imported === 'default' && source.endsWith('.vue')) ||
      source === 'vue'
        ? BindingTypes.SETUP_CONST
        : BindingTypes.SETUP_MAYBE_REF
  }
  for (const key in scriptBindings) {
    ctx.bindingMetadata[key] = scriptBindings[key]
  }
  for (const key in setupBindings) {
    ctx.bindingMetadata[key] = setupBindings[key]
  }

  // 6.1 #11265 / rolldown-vite#432：`const foo = reactive()` 若直接作为 v-model 目标，
  // 非 inline 模板会生成 `$setup.foo = $event`，需要 SETUP_LET 的 setter 才能同步回局部；
  // inline 模板更直接生成 `foo = $event`，同样不能写 const。因此自动降级声明为 let。
  if (sfc.template && !sfc.template.src && sfc.template.ast) {
    const vModelIds = resolveTemplateVModelIdentifiers(
      sfc,
      options.templateOptions,
    )
    if (vModelIds.size) {
      const toDemote = new Set<string>()
      for (const id of vModelIds) {
        if (setupBindings[id] === BindingTypes.SETUP_REACTIVE_CONST) {
          toDemote.add(id)
        }
      }

      if (toDemote.size) {
        for (const node of scriptSetupAst.body) {
          if (
            node.type === 'VariableDeclaration' &&
            node.kind === 'const' &&
            !node.declare
          ) {
            const demotedInDecl: string[] = []
            for (const decl of node.declarations) {
              if (decl.id.type === 'Identifier' && toDemote.has(decl.id.name)) {
                demotedInDecl.push(decl.id.name)
              }
            }
            if (demotedInDecl.length) {
              ctx.s.overwrite(
                node.start! + startOffset,
                node.start! + startOffset + 'const'.length,
                'let',
              )
              for (const id of demotedInDecl) {
                setupBindings[id] = BindingTypes.SETUP_LET
                ctx.bindingMetadata[id] = BindingTypes.SETUP_LET
                warnOnce(
                  `\`v-model\` cannot update a \`const\` reactive binding \`${id}\`. ` +
                    `The compiler has transformed it to \`let\` to make the update work.`,
                )
              }
            }
          }
        }
      }
    }
  }

  // 7. 客户端 setup 注入 useCssVars；SSR 由 ssrCssVars 模板代码负责。
  if (sfc.cssVars.length && !options.templateOptions?.ssr) {
    ctx.helperImports.add(CSS_VARS_HELPER)
    ctx.helperImports.add('unref')
    ctx.s.prependLeft(
      startOffset,
      `\n${genCssVarsCode(
        sfc.cssVars,
        ctx.bindingMetadata,
        scopeId,
        !!options.isProd,
      )}\n`,
    )
  }

  // 8. 组装 setup 参数，并把宏返回值替换成 __props/__emit/rest proxy。
  let args = `__props`
  if (ctx.propsTypeDecl) {
    // __props 参数先标 any，只在用户赋值位置体现类型；复杂用户类型可能与运行时声明反推
    // 类型不完全兼容，直接标注参数会让生成代码自身报 TS 错误。
    args += `: any`
  }
  // 用户没有解构时宏调用替换为 __props；rest 解构则生成排除已取键的只读代理。
  if (ctx.propsDecl) {
    if (ctx.propsDestructureRestId) {
      ctx.s.overwrite(
        startOffset + ctx.propsCall!.start!,
        startOffset + ctx.propsCall!.end!,
        `${ctx.helper(`createPropsRestProxy`)}(__props, ${JSON.stringify(
          Object.keys(ctx.propsDestructuredBindings),
        )})`,
      )
      ctx.s.overwrite(
        startOffset + ctx.propsDestructureDecl!.start!,
        startOffset + ctx.propsDestructureDecl!.end!,
        ctx.propsDestructureRestId,
      )
    } else if (!ctx.propsDestructureDecl) {
      ctx.s.overwrite(
        startOffset + ctx.propsCall!.start!,
        startOffset + ctx.propsCall!.end!,
        '__props',
      )
    }
  }

  // 顶层 await 转换共享两个临时变量，TS 产物显式标 any。
  if (hasAwait) {
    const any = ctx.isTS ? `: any` : ``
    ctx.s.prependLeft(startOffset, `\nlet __temp${any}, __restore${any}\n`)
  }

  const destructureElements =
    ctx.hasDefineExposeCall || !options.inlineTemplate
      ? [`expose: __expose`]
      : []
  if (ctx.emitDecl) {
    destructureElements.push(`emit: __emit`)
  }
  if (destructureElements.length) {
    args += `, { ${destructureElements.join(', ')} }`
  }

  let templateMap
  // 9. 非 inline 模式生成 setup 返回对象；inline 模式直接返回编译后的 render。
  let returned
  // inline 模板编译前先生成 props，确保类型式 props 已写入 bindingMetadata。
  const propsDecl = genRuntimeProps(ctx)
  if (
    !options.inlineTemplate ||
    (!sfc.template && ctx.hasDefaultExportRender)
  ) {
    // 非 inline 或普通 script 自带 render：把模板会访问的绑定暴露在 setup 返回对象。
    const allBindings: Record<string, any> = {
      ...scriptBindings,
      ...setupBindings,
    }
    for (const key in ctx.userImports) {
      if (
        !ctx.userImports[key].isType &&
        ctx.userImports[key].isUsedInTemplate
      ) {
        allBindings[key] = true
      }
    }
    returned = `{ `
    for (const key in allBindings) {
      if (
        allBindings[key] === true &&
        ctx.userImports[key].source !== 'vue' &&
        !ctx.userImports[key].source.endsWith('.vue')
      ) {
        // 外部模块 import 用 getter 保持 live binding；Vue API 和 .vue 组件引用稳定，可直接返回。
        returned += `get ${key}() { return ${key} }, `
      } else if (ctx.bindingMetadata[key] === BindingTypes.SETUP_LET) {
        // let 绑定增加 getter/setter，使非 inline render 通过 `$setup.x =` 写回真实局部变量。
        const setArg = key === 'v' ? `_v` : `v`
        returned +=
          `get ${key}() { return ${key} }, ` +
          `set ${key}(${setArg}) { ${key} = ${setArg} }, `
      } else {
        returned += `${key}, `
      }
    }
    returned = returned.replace(/, $/, '') + ` }`
  } else {
    // inline 模式下 render 闭包直接捕获 setup 局部，无需构造返回代理对象。
    if (sfc.template && !sfc.template.src) {
      if (options.templateOptions && options.templateOptions.ssr) {
        hasInlinedSsrRenderFn = true
      }
      // 将模板以 inline/bindingMetadata 模式编译，所得函数源码直接成为 setup 返回值。
      const { code, ast, preamble, tips, errors, map } = compileTemplate({
        filename,
        ast: sfc.template.ast,
        source: sfc.template.content,
        inMap: sfc.template.map,
        ...options.templateOptions,
        id: scopeId,
        scoped: sfc.styles.some(s => s.scoped),
        isProd: options.isProd,
        ssrCssVars: sfc.cssVars,
        compilerOptions: {
          ...(options.templateOptions &&
            options.templateOptions.compilerOptions),
          inline: true,
          isTS: ctx.isTS,
          bindingMetadata: ctx.bindingMetadata,
        },
      })
      templateMap = map
      if (tips.length) {
        tips.forEach(warnOnce)
      }
      const err = errors[0]
      if (typeof err === 'string') {
        throw new Error(err)
      } else if (err) {
        if (err.loc) {
          err.message +=
            `\n\n` +
            sfc.filename +
            '\n' +
            generateCodeFrame(
              source,
              err.loc.start.offset,
              err.loc.end.offset,
            ) +
            `\n`
        }
        throw err
      }
      if (preamble) {
        ctx.s.prepend(preamble)
      }
      // render preamble 与 CSS vars 都可能需要 unref；模板已导入时删除 script 侧重复 helper。
      if (ast && ast.helpers.has(UNREF)) {
        ctx.helperImports.delete('unref')
      }
      returned = code
    } else {
      returned = `() => {}`
    }
  }

  if (!options.inlineTemplate && !__TEST__) {
    // 标记返回对象，使公开实例代理和 Options API 不把这些绑定当普通 setup 状态暴露或修改。
    // 独立编译的模板仍通过 render 的 $setup 参数访问这些绑定，包括 `$`/`_` 开头的名字。
    ctx.s.appendRight(
      endOffset,
      `\nconst __returned__ = ${returned}\n` +
        `Object.defineProperty(__returned__, '__isScriptSetup', { enumerable: false, value: true })\n` +
        `return __returned__` +
        `\n}\n\n`,
    )
  } else {
    ctx.s.appendRight(endOffset, `\nreturn ${returned}\n}\n\n`)
  }

  // 10. 合并普通默认导出、defineOptions、推导 name、props/emits，生成最终组件定义。
  const genDefaultAs = options.genDefaultAs
    ? `const ${options.genDefaultAs} =`
    : `export default`

  let runtimeOptions = ``
  if (!ctx.hasDefaultExportName && filename && filename !== DEFAULT_FILENAME) {
    const match = filename.match(/([^/\\]+)\.\w+$/)
    if (match) {
      runtimeOptions += `\n  __name: '${match[1]}',`
    }
  }
  if (hasInlinedSsrRenderFn) {
    runtimeOptions += `\n  __ssrInlineRender: true,`
  }

  if (propsDecl) runtimeOptions += `\n  props: ${propsDecl},`

  const emitsDecl = genRuntimeEmits(ctx)
  if (emitsDecl) runtimeOptions += `\n  emits: ${emitsDecl},`

  let definedOptions = ''
  if (ctx.optionsRuntimeDecl) {
    definedOptions = scriptSetup.content
      .slice(ctx.optionsRuntimeDecl.start!, ctx.optionsRuntimeDecl.end!)
      .trim()
  }

  // script setup 组件默认封闭；未显式 defineExpose 时调用无参 __expose()，公开空对象。
  const exposeCall =
    ctx.hasDefineExposeCall || options.inlineTemplate ? `` : `  __expose();\n`
  // 把保留下来的 setup 源码包进组件选项的 setup 方法。
  if (ctx.isTS) {
    // TS 使用 defineComponent + 对象展开，确保普通选项和生成 props 的类型被正确合并；
    // 目标降级由用户 TS 配置负责。
    const def =
      (defaultExport ? `\n  ...${normalScriptDefaultVar},` : ``) +
      (definedOptions ? `\n  ...${definedOptions},` : '')
    ctx.s.prependLeft(
      startOffset,
      `\n${genDefaultAs} /*@__PURE__*/${ctx.helper(
        `defineComponent`,
      )}({${def}${runtimeOptions}\n  ${
        hasAwait ? `async ` : ``
      }setup(${args}) {\n${exposeCall}`,
    )
    ctx.s.appendRight(endOffset, `})`)
  } else {
    if (defaultExport || definedOptions) {
      // JS 不需要类型合并，使用 Object.assign 兼容更广目标并保持选项覆盖顺序。
      ctx.s.prependLeft(
        startOffset,
        `\n${genDefaultAs} /*@__PURE__*/Object.assign(${
          defaultExport ? `${normalScriptDefaultVar}, ` : ''
        }${definedOptions ? `${definedOptions}, ` : ''}{${runtimeOptions}\n  ` +
          `${hasAwait ? `async ` : ``}setup(${args}) {\n${exposeCall}`,
      )
      ctx.s.appendRight(endOffset, `})`)
    } else {
      ctx.s.prependLeft(
        startOffset,
        `\n${genDefaultAs} {${runtimeOptions}\n  ` +
          `${hasAwait ? `async ` : ``}setup(${args}) {\n${exposeCall}`,
      )
      ctx.s.appendRight(endOffset, `}`)
    }
  }

  // 11. 一次性生成所有实际使用的 Vue helper import，可由自定义 runtimeModuleName 改源。
  if (ctx.helperImports.size > 0) {
    const runtimeModuleName =
      options.templateOptions?.compilerOptions?.runtimeModuleName
    const importSrc = runtimeModuleName
      ? JSON.stringify(runtimeModuleName)
      : `'vue'`
    ctx.s.prepend(
      `import { ${[...ctx.helperImports]
        .map(h => `${h} as _${h}`)
        .join(', ')} } from ${importSrc}\n`,
    )
  }

  const content = ctx.s.toString()
  let map =
    options.sourceMap !== false
      ? (ctx.s.generateMap({
          source: filename,
          hires: true,
          includeContent: true,
        }) as unknown as RawSourceMap)
      : undefined
  // inline 模式将模板 map 按 render 插入行偏移合并进 script MagicString map。
  if (templateMap && map) {
    const offset = content.indexOf(returned)
    const templateLineOffset =
      content.slice(0, offset).split(/\r?\n/).length - 1
    map = mergeSourceMaps(map, templateMap, templateLineOffset)
  }
  return {
    ...scriptSetup,
    bindings: ctx.bindingMetadata,
    imports: ctx.userImports,
    content,
    map,
    scriptAst: scriptAst?.body,
    scriptSetupAst: scriptSetupAst?.body,
    deps: ctx.deps ? [...ctx.deps] : undefined,
  }
}

/** 在绑定元数据表中登记单个标识符分类。 */
function registerBinding(
  bindings: Record<string, BindingTypes>,
  node: Identifier,
  type: BindingTypes,
) {
  bindings[node.name] = type
}

/**
 * 分析顶层声明中的所有绑定并判断整条声明是否可静态提升。
 * BindingTypes 决定模板代码是否直接访问、unref、写 setter 或按 props 处理。
 *
 * from=script 的模块常量天然在实例外；setup 只有启用 hoistStatic 才把静态标识符声明
 * 归为 LITERAL_CONST。整条多变量声明必须每项都为静态 Identifier 才返回 true，避免只
 * 移动其中一部分破坏声明结构；单项绑定分类仍可比整条声明的可提升性更精确。
 * Vue API 识别依赖先前收集的 userImportAliases，同名外部函数不能据名字猜为 Ref。
 * 响应式 props 解构已由专门转换器登记，跳过它以免覆盖 PROPS/PROPS_ALIASED 分类。
 *
 * @param bindings - 当前脚本块的绑定表，按实际声明名原位写入。
 * @returns 变量声明或 enum 是否全部由静态节点构成；调用者再结合提升开关决定是否移动源码。
 */
function walkDeclaration(
  from: 'script' | 'scriptSetup',
  node: Declaration,
  bindings: Record<string, BindingTypes>,
  userImportAliases: Record<string, string>,
  hoistStatic: boolean,
  isPropsDestructureEnabled = false,
): boolean {
  let isAllLiteral = false

  if (node.type === 'VariableDeclaration') {
    const isConst = node.kind === 'const'
    isAllLiteral =
      isConst &&
      node.declarations.every(
        decl => decl.id.type === 'Identifier' && isStaticNode(decl.init!),
      )

    // 变量声明按 const/let、初始化调用及是否可能为 ref 分类。
    for (const { id, init: _init } of node.declarations) {
      const init = _init && unwrapTSNode(_init)
      const isConstMacroCall =
        isConst &&
        isCallOf(
          init,
          c =>
            c === DEFINE_PROPS ||
            c === DEFINE_EMITS ||
            c === WITH_DEFAULTS ||
            c === DEFINE_SLOTS,
        )
      if (id.type === 'Identifier') {
        let bindingType
        const userReactiveBinding = userImportAliases['reactive']
        if (
          (hoistStatic || from === 'script') &&
          (isAllLiteral || (isConst && isStaticNode(init!)))
        ) {
          bindingType = BindingTypes.LITERAL_CONST
        } else if (isCallOf(init, userReactiveBinding)) {
          // reactive() 虽用 const 声明，模板语义上是可变响应式对象，单独标记 reactive const。
          bindingType = isConst
            ? BindingTypes.SETUP_REACTIVE_CONST
            : BindingTypes.SETUP_LET
        } else if (
          // 宏结果或确定不可能是 ref 的 const 可直接访问，render 无需生成 unref()。
          isConstMacroCall ||
          (isConst && canNeverBeRef(init!, userReactiveBinding))
        ) {
          bindingType = isCallOf(init, DEFINE_PROPS)
            ? BindingTypes.SETUP_REACTIVE_CONST
            : BindingTypes.SETUP_CONST
        } else if (isConst) {
          if (
            isCallOf(
              init,
              m =>
                m === userImportAliases['ref'] ||
                m === userImportAliases['computed'] ||
                m === userImportAliases['shallowRef'] ||
                m === userImportAliases['customRef'] ||
                m === userImportAliases['toRef'] ||
                m === userImportAliases['useTemplateRef'] ||
                m === DEFINE_MODEL,
            )
          ) {
            bindingType = BindingTypes.SETUP_REF
          } else {
            bindingType = BindingTypes.SETUP_MAYBE_REF
          }
        } else {
          bindingType = BindingTypes.SETUP_LET
        }
        registerBinding(bindings, id, bindingType)
      } else {
        if (isCallOf(init, DEFINE_PROPS) && isPropsDestructureEnabled) {
          continue
        }
        if (id.type === 'ObjectPattern') {
          walkObjectPattern(id, bindings, isConst, isConstMacroCall)
        } else if (id.type === 'ArrayPattern') {
          walkArrayPattern(id, bindings, isConst, isConstMacroCall)
        }
      }
    }
  } else if (node.type === 'TSEnumDeclaration') {
    isAllLiteral = node.members.every(
      member => !member.initializer || isStaticNode(member.initializer),
    )
    bindings[node.id!.name] = isAllLiteral
      ? BindingTypes.LITERAL_CONST
      : BindingTypes.SETUP_CONST
  } else if (
    node.type === 'FunctionDeclaration' ||
    node.type === 'ClassDeclaration'
  ) {
    // 顶层函数/class 声明引用稳定；可导出的声明必有名称。
    bindings[node.id!.name] = BindingTypes.SETUP_CONST
  }

  return isAllLiteral
}

/** 递归登记对象解构创建的绑定。 */
function walkObjectPattern(
  node: ObjectPattern,
  bindings: Record<string, BindingTypes>,
  isConst: boolean,
  isDefineCall = false,
) {
  for (const p of node.properties) {
    if (p.type === 'ObjectProperty') {
      if (p.key.type === 'Identifier' && p.key === p.value) {
        // 简写 `const { x } = ...` 可直接登记 key 标识符。
        const type = isDefineCall
          ? BindingTypes.SETUP_CONST
          : isConst
            ? BindingTypes.SETUP_MAYBE_REF
            : BindingTypes.SETUP_LET
        registerBinding(bindings, p.key, type)
      } else {
        walkPattern(p.value, bindings, isConst, isDefineCall)
      }
    } else {
      // 对象解构 rest 的 argument 按语法只能是标识符。
      const type = isConst ? BindingTypes.SETUP_CONST : BindingTypes.SETUP_LET
      registerBinding(bindings, p.argument as Identifier, type)
    }
  }
}

/** 递归登记数组解构中的非空元素。 */
function walkArrayPattern(
  node: ArrayPattern,
  bindings: Record<string, BindingTypes>,
  isConst: boolean,
  isDefineCall = false,
) {
  for (const e of node.elements) {
    e && walkPattern(e, bindings, isConst, isDefineCall)
  }
}

/**
 * 沿对象、数组和默认值的左侧登记实际绑定，默认值右侧只是表达式，不产生声明。
 * const 普通解构值可能是 Ref，宏直接创建的绑定按 SETUP_CONST；let 始终是 SETUP_LET。
 * 遇到再嵌套 pattern 时当前实现只传 isConst，不把 isDefineCall 继续向下传播。
 */
function walkPattern(
  node: Node,
  bindings: Record<string, BindingTypes>,
  isConst: boolean,
  isDefineCall = false,
) {
  if (node.type === 'Identifier') {
    const type = isDefineCall
      ? BindingTypes.SETUP_CONST
      : isConst
        ? BindingTypes.SETUP_MAYBE_REF
        : BindingTypes.SETUP_LET
    registerBinding(bindings, node, type)
  } else if (node.type === 'RestElement') {
    // 此分支按 Identifier 登记 rest 绑定；它没有继续递归展开数组 rest 中的嵌套 pattern。
    const type = isConst ? BindingTypes.SETUP_CONST : BindingTypes.SETUP_LET
    registerBinding(bindings, node.argument as Identifier, type)
  } else if (node.type === 'ObjectPattern') {
    walkObjectPattern(node, bindings, isConst)
  } else if (node.type === 'ArrayPattern') {
    walkArrayPattern(node, bindings, isConst)
  } else if (node.type === 'AssignmentPattern') {
    if (node.left.type === 'Identifier') {
      const type = isDefineCall
        ? BindingTypes.SETUP_CONST
        : isConst
          ? BindingTypes.SETUP_MAYBE_REF
          : BindingTypes.SETUP_LET
      registerBinding(bindings, node.left, type)
    } else {
      walkPattern(node.left, bindings, isConst)
    }
  }
}

/**
 * 按编译器的语法分类判断初始化值是否走无需 unref 的路径。
 * reactive 别名调用、字面量、容器、函数/类等返回 true；序列表达式只看最终值。
 * 一般调用和标识符返回 false。TaggedTemplateExpression 也在直接访问白名单中，
 * 因此该结果表示当前分类规则，不能当作任意 tag 函数返回值的语义证明。
 */
function canNeverBeRef(node: Node, userReactiveImport?: string): boolean {
  if (isCallOf(node, userReactiveImport)) {
    return true
  }
  switch (node.type) {
    case 'UnaryExpression':
    case 'BinaryExpression':
    case 'ArrayExpression':
    case 'ObjectExpression':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'UpdateExpression':
    case 'ClassExpression':
    case 'TaggedTemplateExpression':
      return true
    case 'SequenceExpression':
      return canNeverBeRef(
        node.expressions[node.expressions.length - 1],
        userReactiveImport,
      )
    default:
      if (isLiteralNode(node)) {
        return true
      }
      return false
  }
}

/**
 * 判断表达式是否只由字面量及其纯语法组合构成，可安全提升到 setup 外。
 * 不接受标识符、调用、成员访问等可能依赖实例或产生副作用的节点。
 */
function isStaticNode(node: Node): boolean {
  node = unwrapTSNode(node)

  switch (node.type) {
    case 'UnaryExpression': // 例如 void 0、!true
      return isStaticNode(node.argument)

    case 'LogicalExpression':
    case 'BinaryExpression': // 例如 1 + 2
      return isStaticNode(node.left) && isStaticNode(node.right)

    case 'ConditionalExpression': {
      // 条件、真分支、假分支都静态时整体才静态。
      return (
        isStaticNode(node.test) &&
        isStaticNode(node.consequent) &&
        isStaticNode(node.alternate)
      )
    }

    case 'SequenceExpression': // 例如 (1, 2)
    case 'TemplateLiteral': // 例如 `foo${1}`
      return node.expressions.every(expr => isStaticNode(expr))

    case 'ParenthesizedExpression': // 例如 (1)
      return isStaticNode(node.expression)

    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
    case 'NullLiteral':
    case 'BigIntLiteral':
      return true
  }
  return false
}

/**
 * 合并 script 变换 map 与 inline template render map，并对模板生成行增加插入偏移。
 * 两份输入都已映射到原 SFC，故这里是追加映射而非沿中间坐标再合成；模板列号不平移。
 * 先复制来源文本，再跳过没有 originalLine 的合成节点，最终沿用 script 的 file/sourceRoot。
 * @param templateLineOffset - render 插入 script 输出后增加的生成行数。
 */
export function mergeSourceMaps(
  scriptMap: RawSourceMap,
  templateMap: RawSourceMap,
  templateLineOffset: number,
): RawSourceMap {
  const generator = new SourceMapGenerator()
  /** 把一份 source map 的来源内容与映射追加到结果，并给生成行施加偏移。 */
  const addMapping = (map: RawSourceMap, lineOffset = 0) => {
    const consumer = new SourceMapConsumer(map)
    ;(consumer as any).sources.forEach((sourceFile: string) => {
      ;(generator as any)._sources.add(sourceFile)
      const sourceContent = consumer.sourceContentFor(sourceFile)
      if (sourceContent != null) {
        generator.setSourceContent(sourceFile, sourceContent)
      }
    })
    consumer.eachMapping(m => {
      if (m.originalLine == null) return
      generator.addMapping({
        generated: {
          line: m.generatedLine + lineOffset,
          column: m.generatedColumn,
        },
        original: {
          line: m.originalLine,
          column: m.originalColumn!,
        },
        source: m.source,
        name: m.name,
      })
    })
  }

  addMapping(scriptMap)
  addMapping(templateMap, templateLineOffset)
  ;(generator as any)._sourceRoot = scriptMap.sourceRoot
  ;(generator as any)._file = scriptMap.file
  return (generator as any).toJSON()
}
