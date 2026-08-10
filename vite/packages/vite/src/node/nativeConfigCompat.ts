import path from 'node:path'
import colors from 'picocolors'
import type { Plugin } from 'rolldown'
import { walk as eswalk } from 'estree-walker'
import { parseSync, type ESTree } from 'rolldown/utils'
import { analyze } from 'periscopic'
import { isFilePathESM, normalizePath, numberToPos } from './utils'

/**
 * 从默认 bundle loader 迁移到 Node 原生配置加载器时可能失效的语法类别。
 *
 * 前五类描述 ESM 原生解析与 bundle 语义的差异；最后一类描述 `.cjs` 或
 * CommonJS package 边界内无法直接执行 ESM 声明的情况。
 */
export type NativeConfigIncompatibilityType =
  | 'dirname'
  | 'filename'
  | 'extensionless-import'
  | 'directory-index-import'
  | 'json-without-attributes'
  | 'esm-syntax-in-cjs'

/** 单个原生配置加载兼容风险及其可定位的源码位置。 */
export interface NativeConfigIncompatibility {
  /** 不兼容原因，用于选择针对性的迁移提示。 */
  type: NativeConfigIncompatibilityType
  /** 发现问题的模块绝对路径。 */
  file: string
  /** 从 1 开始的行号。 */
  line: number
  /** 从 0 开始的列号；格式化终端位置时再转换成从 1 开始。 */
  column: number
  /** 对 import 类问题记录原始说明符；全局变量和 CJS 语法问题没有此字段。 */
  specifier?: string
}

/** 从配置模块 AST 中抽取、等待解析器进一步分类的路径引用。 */
export interface ConfigImportRef {
  /** 源码中未经改写的相对或绝对说明符。 */
  specifier: string
  /** 说明符起点的 1-based 行、0-based 列。 */
  line: number
  /** 说明符起点从 0 开始的列号。 */
  column: number
  /** 是否显式携带 JSON import attribute。 */
  hasTypeJsonAttribute: boolean
}

/** 原生加载器相关的 JS/TS 文件扩展名与目录 index 文件匹配器。 */
const jsTsExtRE = /\.[cm]?[jt]sx?$/
/** 判断解析结果是否落到目录默认 index 脚本。 */
const indexFileRE = /^index\.[cm]?[jt]sx?$/

/** 取得说明符最后一个路径片段，避免目录部分中的点号干扰扩展名判断。 */
const lastSegmentOf = (specifier: string) =>
  specifier.slice(specifier.lastIndexOf('/') + 1)

/**
 * 已显式携带 JS/TS 扩展名的说明符会被原生加载器按原样解析，不可能再属于
 * “省略扩展名”或“隐式目录 index”问题，因此分类前不必额外调用解析器。
 */
const specifierHasJsExtension = (specifier: string) =>
  jsTsExtRE.test(lastSegmentOf(specifier))

/**
 * 将一个配置文件路径引用归类为原生加载器不兼容项。
 *
 * JSON 先检查 import attribute；其余引用结合插件容器的解析结果，区分“目录
 * 自动落到 index”与“文件扩展名被省略”。无法解析时不武断告警，因为问题也
 * 可能属于缺包或用户自定义解析规则。
 */
export function classifyImportRef(
  ref: ConfigImportRef,
  resolvedId: string | null,
  file: string,
): NativeConfigIncompatibility | undefined {
  const { specifier, line, column } = ref
  const base = { file, line, column, specifier }

  if (specifier.endsWith('.json')) {
    if (ref.hasTypeJsonAttribute) return undefined
    return { type: 'json-without-attributes', ...base }
  }

  if (!resolvedId) return undefined

  if (resolvedId.endsWith('.json') && !ref.hasTypeJsonAttribute) {
    return { type: 'json-without-attributes', ...base }
  }

  const lastSegment = lastSegmentOf(specifier)
  const specifierNamesIndex =
    lastSegment === 'index' || indexFileRE.test(lastSegment)

  if (indexFileRE.test(path.basename(resolvedId)) && !specifierNamesIndex) {
    return { type: 'directory-index-import', ...base }
  }
  if (!jsTsExtRE.test(lastSegment)) {
    return { type: 'extensionless-import', ...base }
  }
  return undefined
}

/** 只审查会由文件系统原生规则处理的相对/绝对路径，不检查裸包导入。 */
const isPathSpecifier = (s: string) => s.startsWith('.') || path.isAbsolute(s)

/** 判断静态 import/export 是否声明了 `with { type: 'json' }`。 */
const hasTypeJson = (
  attributes: ESTree.ImportAttribute[] | undefined,
): boolean =>
  !!attributes?.some((attr) => {
    const key = attr.key.type === 'Identifier' ? attr.key.name : attr.key.value
    return key === 'type' && attr.value?.value === 'json'
  })

/** CommonJS 路径全局变量到兼容问题类型的映射。 */
const DIRNAME_FILENAME = {
  __dirname: 'dirname',
  __filename: 'filename',
} as const

/**
 * 扫描一个配置模块，收集原生 ESM 加载时需复核的全局变量与路径导入。
 *
 * import、re-export 与字符串字面量 dynamic import 都会进入同一引用列表。
 * `periscopic` 只返回未被局部声明遮蔽的 `__dirname`/`__filename`，避免把用户
 * 自定义变量误报成 CommonJS 全局量。
 */
export function analyzeConfigModuleReferences(
  code: string,
  ast: ESTree.Program,
  file: string,
): {
  /** 未被局部声明遮蔽的 CommonJS 路径全局量。 */
  globals: NativeConfigIncompatibility[]
  /** 需要按 Node 原生解析规则复核的路径导入。 */
  imports: ConfigImportRef[]
} {
  const imports: ConfigImportRef[] = []

  /** 把路径型字面量及其源码位置加入待分类引用列表。 */
  const addImportRef = (
    source: ESTree.StringLiteral,
    hasTypeJsonAttribute: boolean,
  ): void => {
    if (!isPathSpecifier(source.value)) return
    const { line, column } = numberToPos(code, source.start)
    imports.push({
      specifier: source.value,
      line,
      column,
      hasTypeJsonAttribute,
    })
  }

  eswalk(ast as any, {
    /** 收集静态 import/export 与可静态识别的 dynamic import。 */
    enter(_node) {
      const node = _node as ESTree.Node
      switch (node.type) {
        case 'ImportDeclaration':
          addImportRef(node.source, hasTypeJson(node.attributes))
          break
        case 'ExportNamedDeclaration':
        case 'ExportAllDeclaration':
          if (node.source)
            addImportRef(node.source, hasTypeJson(node.attributes))
          break
        case 'ImportExpression':
          if (
            node.source.type === 'Literal' &&
            typeof node.source.value === 'string'
          ) {
            // 动态 import 的第二参数 AST 形态可能包含运行时表达式。为避免误报，
            // 只要存在 options 就保守地假设调用方已提供所需 attribute。
            addImportRef(node.source, node.options != null)
          }
          break
      }
    },
  })

  const globals: NativeConfigIncompatibility[] = []
  if (code.includes('__dirname') || code.includes('__filename')) {
    const { globals: freeReferences } = analyze(ast as any)
    for (const [name, type] of Object.entries(DIRNAME_FILENAME)) {
      const node = freeReferences.get(name) as ESTree.Node | undefined
      if (!node) continue
      const { line, column } = numberToPos(code, node.start)
      globals.push({ type, file, line, column })
    }
  }

  return { globals, imports }
}

/** CommonJS 原生加载阶段会立即产生语法错误的顶层 ESM 声明。 */
const esmStatementTypes = new Set([
  'ImportDeclaration',
  'ExportNamedDeclaration',
  'ExportDefaultDeclaration',
  'ExportAllDeclaration',
])

/** 在按 CommonJS 加载的配置中定位第一条顶层 ESM 声明。 */
export function findEsmSyntaxInCjs(
  code: string,
  ast: ESTree.Program,
  file: string,
): NativeConfigIncompatibility | undefined {
  for (const node of ast.body) {
    if (esmStatementTypes.has(node.type)) {
      const { line, column } = numberToPos(code, (node as ESTree.Node).start)
      return { type: 'esm-syntax-in-cjs', file, line, column }
    }
  }
  return undefined
}

/** 将结构化问题转换为带源码定位和具体替代方案的一行提示。 */
function describeIncompatibility(
  item: NativeConfigIncompatibility,
  root: string,
): string {
  // 终端通常以 `file:line:column` 识别可点击位置，因此输出时将列号改为 1-based。
  // #23064 修正的正是“内部列号正确、终端链接却偏一列”的场景。
  const loc = `${normalizePath(path.relative(root, item.file))}:${item.line}:${item.column + 1}`
  switch (item.type) {
    case 'dirname':
      return `\`__dirname\` (${loc}). Use \`import.meta.dirname\` instead`
    case 'filename':
      return `\`__filename\` (${loc}). Use \`import.meta.filename\` instead`
    case 'extensionless-import':
      return `import "${item.specifier}" without a file extension (${loc}). Add the file extension`
    case 'directory-index-import':
      return `import "${item.specifier}" resolves to a directory index (${loc}). Import the index file directly`
    case 'json-without-attributes':
      return item.specifier?.endsWith('.json')
        ? `JSON import "${item.specifier}" without import attributes (${loc}). Add \`with { type: 'json' }\``
        : `import "${item.specifier}" resolves to a JSON file (${loc}). Import it with a \`.json\` extension and \`with { type: 'json' }\``
    case 'esm-syntax-in-cjs':
      return `ESM syntax in a file loaded as CommonJS (${loc}). Use a \`.mjs\` extension or set \`"type": "module"\` in the closest package.json`
  }
}

/** 将一组不兼容项汇总为一次带迁移开关说明的彩色警告。 */
export function formatNativeConfigIncompatWarning(
  items: NativeConfigIncompatibility[],
  root: string,
): string {
  const header =
    `Your Vite config uses features that are unsupported by ` +
    `\`configLoader: 'native'\`, which is planned to become the default in a ` +
    `future major version of Vite:`
  const lines = items.map((it) => `  - ${describeIncompatibility(it, root)}`)
  const footer = `Set \`VITE_CONFIG_NATIVE_IGNORE_WARNING=true\` to suppress this warning.`
  return colors.yellow([`(!) ${header}`, ...lines, footer].join('\n'))
}

/**
 * 创建配置 bundle 阶段的只读兼容性检查插件。
 *
 * 插件不改写模块，只把发现项写入调用方提供的 collector。它跳过 `\0` 开头的
 * Rolldown 虚拟运行时（#22979），解析失败时也不覆盖原本更准确的编译错误。
 * 对 CommonJS 文件只检查 ESM 声明；对 ESM 文件再检查路径全局量、JSON
 * attribute、扩展名和目录 index。这些差异是 #22850 引入 native loader 预警
 * 时希望在切换默认加载方式前暴露给用户的迁移风险。
 */
export function createNativeConfigCompatPlugin(
  collector: NativeConfigIncompatibility[],
): Plugin {
  return {
    name: 'vite:native-config-compat-check',
    transform: {
      filter: {
        id: {
          include: /\.[cm]?[jt]sx?$/,
          // Rolldown 注入的虚拟运行时不是用户配置依赖，不能产生迁移告警。
          exclude: /^\0/,
        },
      },
      /** 解析并分类单个用户配置模块，不改写其源码。 */
      async handler(code, id) {
        const isESM =
          typeof process.versions.deno === 'string' || isFilePathESM(id)

        let program: ESTree.Program
        try {
          const result = parseSync(id, code)
          if (result.errors.length > 0) return null
          program = result.program
        } catch {
          return null
        }

        // Node 会把此文件当 CommonJS 加载。`__dirname` 与 CJS 解析规则在这里合法，
        // 但任何顶层 ESM 声明都会被原生加载器直接拒绝。
        if (!isESM) {
          const finding = findEsmSyntaxInCjs(code, program, id)
          if (finding) collector.push(finding)
          return null
        }

        const { globals, imports } = analyzeConfigModuleReferences(
          code,
          program,
          id,
        )
        for (const g of globals) collector.push(g)
        for (const ref of imports) {
          let resolvedId: string | null = null
          if (
            !ref.specifier.endsWith('.json') &&
            !specifierHasJsExtension(ref.specifier)
          ) {
            const resolved = await this.resolve(ref.specifier, id)
            resolvedId = resolved?.id ?? null
          }
          const finding = classifyImportRef(ref, resolvedId, id)
          if (finding) collector.push(finding)
        }
        return null
      },
    },
  }
}
