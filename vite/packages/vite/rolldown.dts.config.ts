import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { defineConfig } from 'rolldown'
import type {
  OutputChunk,
  Plugin,
  PluginContext,
  RenderedChunk,
} from 'rolldown'
import type { ESTree } from 'rolldown/utils'
import { parseAst } from 'rolldown/parseAst'
import { dts } from 'rolldown-plugin-dts'
import { parse as parseWithBabel } from '@babel/parser'
import { walk } from 'estree-walker'
import MagicString from 'magic-string'

/** ESTree 指令节点类型别名，与 Statement 一起用于导入信息提取参数。 */
type Directive = ESTree.Directive
/** ESTree 导出名称节点别名，兼容 Identifier 与字符串名称。 */
type ModuleExportName = ESTree.ModuleExportName
/** 声明产物解析后的 ESTree Program，供顶层导入扫描使用。 */
type Program = ESTree.Program
/** 声明产物顶层语句节点别名。 */
type Statement = ESTree.Statement

/** Vite package.json；dependencies/peerDependencies 决定声明构建 external，校验器另检查允许依赖。 */
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url)).toString(),
)

/** 声明产物保留的 Node、Vite/Rolldown、内部 #types 和发布依赖引用，不把它们的声明合入当前 bundle。 */
const external = [
  /^node:*/,
  /^vite\//,
  /^rolldown\//,
  /^#types\//,
  ...Object.keys(pkg.dependencies),
  ...Object.keys(pkg.peerDependencies),
]

export default defineConfig({
  input: {
    index: './src/node/index.ts',
    'module-runner': './src/module-runner/index.ts',
    internal: './src/node/internalIndex.ts',
  },
  output: {
    dir: './dist/node',
    chunkFileNames: 'chunks/[name].d.ts',
    format: 'esm',
  },
  treeshake: {
    moduleSideEffects: 'no-external',
  },
  external,
  plugins: [
    esmifyPostcssLoadConfigDts(),
    patchTypes(),
    addNodePrefix(),
    dts({
      tsconfig: './tsconfig.base.json',
      compilerOptions: {
        noEmit: false,
        skipLibCheck: true, // 最终声明产物另做类型检查。
        stripInternal: true,
        paths: {
          'vite/module-runner': ['./src/module-runner'],
        },
      },
      emitDtsOnly: true,
    }),
  ],
})

// Taken from https://stackoverflow.com/a/36328890
/** 匹配块注释以筛掉许可证文本，来源保留于相邻注释。 */
const multilineCommentsRE = /\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g
/** 识别需要从声明产物移除的 MIT/BSD 许可证块注释文字。 */
const licenseCommentsRE = /MIT License|MIT license|BSD license/
/** 把两个以上连续换行收敛为一个空行。 */
const consecutiveNewlinesRE = /\n{2,}/g
/** 识别声明合并产生的 name$数字 标识，供重命名和遗漏检查。 */
const identifierWithTrailingDollarRE = /\b(\w+)\$\d+\b/g

/** 按来源模块与导入别名指定可读名称；含点的目标改为已有 namespace 访问，并移除原具名导入。 */
const identifierReplacements: Record<string, Record<string, string>> = {
  'vite/module-runner': {
    FetchResult$1: 'moduleRunner_FetchResult',
  },
  rolldown: {
    Plugin$1: 'Rolldown.Plugin',
    TransformResult$1: 'Rolldown.TransformResult',
  },
  'rolldown/utils': {
    TransformOptions$1: 'rolldown_utils_TransformOptions',
    TransformResult$2: 'rolldown_utils_TransformResult',
  },
  'node:http': {
    Server$1: 'http.Server',
    IncomingMessage$1: 'http.IncomingMessage',
  },
  'node:https': {
    Server$2: 'HttpsServer',
    ServerOptions$2: 'HttpsServerOptions',
  },
  'node:url': {
    URL$1: 'url_URL',
  },
  '#types/hmrPayload': {
    CustomPayload$1: 'hmrPayload_CustomPayload',
    HotPayload$1: 'hmrPayload_HotPayload',
  },
  '#types/customEvent': {
    InferCustomEventPayload$1: 'hmrPayload_InferCustomEventPayload',
  },
  '#types/internal/esbuildOptions': {
    EsbuildTransformOptions$1: 'esbuildOptions_EsbuildTransformOptions',
  },
  '#types/internal/lightningcssOptions': {
    LightningCSSOptions$1: 'lightningcssOptions_LightningCSSOptions',
  },
  postcss: {
    Plugin$2: 'PostCSS.Plugin',
  },
}

/** 允许保留的 $数字 标识清单；非 internal 入口同时检查清单项仍实际存在，发现过期项则标失败。 */
const ignoreConfusingTypeNames = [
  // 声明中有意保留的类型名。
  'MinimalPluginContext$1',
  'ServerOptions$1',
  'ServerOptions$3',
  // 类型导出的临时别名。
  'parseAst$1',
  'parseAstAsync$1',
]

/** 在 dts 输出的 post generateBundle 阶段校验 import。Runner/共享 chunk 只校验轻量依赖；其他入口另执行别名替换、internal 删除和注释清理。 */
function patchTypes(): Plugin {
  return {
    name: 'patch-types',
    generateBundle: {
      order: 'post',
      /** 逐个解析声明 chunk，按文件名分派 Runner 校验或完整公开类型修补流水线。 */
      handler(_opts, bundle) {
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk') continue

          const ast = parseAst(chunk.code, { lang: 'ts', sourceType: 'module' })
          const importBindings = getAllImportBindings(ast)
          if (
            chunk.fileName.startsWith('module-runner') ||
            // index 与 moduleRunner 共用声明 chunk。
            chunk.fileName.startsWith('chunks/') ||
            chunk.fileName.startsWith('types.d-')
          ) {
            validateRunnerChunk.call(this, chunk, importBindings)
          } else {
            validateChunkImports.call(this, chunk, importBindings)
            replaceConfusingTypeNames.call(this, chunk, importBindings)
            stripInternalTypes.call(this, chunk)
            cleanUnnecessaryComments(chunk)
          }
        }
      },
    },
  }
}

/** 读取 Identifier.name 或字符串节点 value，统一导出名称表示。 */
function stringifyModuleExportName(node: ModuleExportName): string {
  if (node.type === 'Identifier') {
    return node.name
  }
  return node.value
}

/** 一条 import/re-export 的来源模块、原始导出名和本地绑定名，供允许依赖与别名替换检查。 */
type ImportBindings = {
  /** 来源模块 specifier。 */
  id: string;
  /** 原始导出名，default 与 * 用特殊字符串表示。 */
  bindings: string[];
  /** import 的本地别名；re-export 为空。 */
  locals: string[]
}

/** 从 import、带 source 的 named export 或 export-all 提取模块引用；本地 export 与其他语句返回 undefined。 */
function getImportBindings(
  node: Directive | Statement,
): ImportBindings | undefined {
  if (node.type === 'ImportDeclaration') {
    return {
      id: node.source.value,
      bindings: node.specifiers.map((s) =>
        s.type === 'ImportDefaultSpecifier'
          ? 'default'
          : s.type === 'ImportNamespaceSpecifier'
            ? '*'
            : stringifyModuleExportName(s.imported),
      ),
      locals: node.specifiers.map((s) => s.local.name),
    }
  }
  if (node.type === 'ExportNamedDeclaration') {
    if (!node.source) return undefined
    return {
      id: node.source.value,
      bindings: node.specifiers.map((s) => stringifyModuleExportName(s.local)),
      locals: [],
    }
  }
  if (node.type === 'ExportAllDeclaration') {
    if (!node.source) return undefined
    return { id: node.source.value, bindings: ['*'], locals: [] }
  }
}

/** 按 Program 顶层顺序收集 import/re-export 信息，忽略不引用其他模块的语句。 */
function getAllImportBindings(ast: Program): ImportBindings[] {
  return ast.body.flatMap((node) => getImportBindings(node) ?? [])
}

/** 只允许 Runner/共享声明 chunk 引用相对路径、内部 # 或共享 types/chunks；违规时 warn 并设置 exitCode=1，仍保留输出供检查。 */
function validateRunnerChunk(
  this: PluginContext,
  chunk: RenderedChunk,
  importBindings: ImportBindings[],
) {
  for (const { id, bindings } of importBindings) {
    if (
      !id.startsWith('./') &&
      !id.startsWith('../') &&
      !id.startsWith('#') &&
      // index 与 moduleRunner 共用声明 chunk。
      !id.startsWith('chunks/') &&
      !id.startsWith('types.d')
    ) {
      this.warn(
        `${chunk.fileName} imports "${bindings.join(', ')}" from "${id}" which is not allowed`,
      )
      process.exitCode = 1
    }
  }
}

/** 允许本地、内部 #、Node、Vite 子路径和 dependencies 及其子路径；其他引用 warn 并设置失败退出码，不立即阻断文件写出。 */
function validateChunkImports(
  this: PluginContext,
  chunk: RenderedChunk,
  importBindings: ImportBindings[],
) {
  const deps = Object.keys(pkg.dependencies)
  for (const { id, bindings } of importBindings) {
    if (
      !id.startsWith('./') &&
      !id.startsWith('../') &&
      !id.startsWith('#') &&
      !id.startsWith('node:') &&
      !id.startsWith('types.d') &&
      !id.startsWith('vite/') &&
      // index 与 moduleRunner 共用声明 chunk。
      !id.startsWith('chunks/') &&
      !deps.includes(id) &&
      !deps.some((name) => id.startsWith(name + '/'))
    ) {
      // 仅告警并设置失败退出码，让文件仍写到磁盘供检查。
      this.warn(
        `${chunk.fileName} imports "${bindings.join(', ')}" from "${id}" which is not allowed`,
      )
      process.exitCode = 1
    }
  }
}

/** 按已登记来源导入改写 $数字 别名，并检查未替换或过期清单项；internal 入口跳过指定映射但仍检查残留名称。 */
function replaceConfusingTypeNames(
  this: PluginContext,
  chunk: OutputChunk,
  importBindings: ImportBindings[],
) {
  const isInternalEntry = chunk.fileName.startsWith('internal.')
  if (!isInternalEntry) {
    for (const modName in identifierReplacements) {
      const imp = importBindings.filter((imp) => imp.id === modName)
      // 未匹配到预期项时报告替换清单已过期。
      if (imp.length === 0) {
        this.warn(
          `${chunk.fileName} does not import "${modName}" for replacement`,
        )
        process.exitCode = 1
        continue
      }

      const replacements = identifierReplacements[modName]
      for (const id in replacements) {
        // 未匹配到预期项时报告替换清单已过期。
        if (!imp.some((i) => i.locals.includes(id))) {
          this.warn(
            `${chunk.fileName} does not import "${id}" from "${modName}" for replacement`,
          )
          process.exitCode = 1
          continue
        }

        const betterId = replacements[id]
        const regexEscapedId = escapeRegex(id)
        // namespace 成员不能作为 import 别名，先删掉原具名导入再改为 namespace 访问。
        if (betterId.includes('.')) {
          chunk.code = chunk.code.replace(
            new RegExp(`\\b\\w+\\b as ${regexEscapedId},?\\s?`),
            '',
          )
        }
        chunk.code = chunk.code.replace(
          new RegExp(`\\b${regexEscapedId}\\b`, 'g'),
          betterId,
        )
      }
    }
  }

  const identifiers = unique(
    Array.from(
      chunk.code.matchAll(identifierWithTrailingDollarRE),
      (m) => m[0],
    ),
  )
  const unreplacedIds = identifiers.filter(
    (id) => !ignoreConfusingTypeNames.includes(id),
  )
  if (unreplacedIds.length) {
    const unreplacedStr = unreplacedIds.map((id) => `\n- ${id}`).join('')
    this.warn(
      `${chunk.fileName} contains confusing identifier names${unreplacedStr}`,
    )
    process.exitCode = 1
  }

  if (!isInternalEntry) {
    const notUsedConfusingTypeNames = ignoreConfusingTypeNames.filter(
      (id) => !identifiers.includes(id),
    )
    // 未匹配到预期项时报告替换清单已过期。
    if (notUsedConfusingTypeNames.length) {
      const notUsedStr = notUsedConfusingTypeNames
        .map((id) => `\n- ${id}`)
        .join('')
      this.warn(
        `${chunk.fileName} contains unused identifier names${notUsedStr}`,
      )
      process.exitCode = 1
    }
  }
}

/** 对 TypeScript stripInternal 未移除的参数/联合成员再做 Babel AST 删除；仍残留 @internal 时 warn 并设置失败退出码。 */
function stripInternalTypes(this: PluginContext, chunk: OutputChunk) {
  if (chunk.code.includes('@internal')) {
    const s = new MagicString(chunk.code)
    // 用 Babel 解析以取得 leadingComments 与节点范围。
    const ast = parseWithBabel(chunk.code, {
      plugins: ['typescript'],
      sourceType: 'module',
    })

    walk(ast as any, {
      /** 删除当前带 internal 注释的节点后跳过其子树，避免对已删除范围重复编辑。 */
      enter(node: any) {
        if (removeInternal(s, node)) {
          this.skip()
        }
      },
    })

    chunk.code = s.toString()

    if (chunk.code.includes('@internal')) {
      this.warn(`${chunk.fileName} has unhandled @internal declarations`)
      process.exitCode = 1
    }
  }
}

/**
 * 发现 leading block comment 含 @internal 时删除整个节点及后随的逗号/竖线；返回是否删除，供 walker 跳过子树。
 * 参考：https://github.com/vuejs/core/blob/main/rollup.dts.config.js
 */
function removeInternal(s: MagicString, node: any): boolean {
  if (
    node.leadingComments &&
    node.leadingComments.some((c: any) => {
      return c.type === 'CommentBlock' && c.value.includes('@internal')
    })
  ) {
    // 删除范围示例：
    // function a(foo: string, /* @internal */ bar: number, baz: boolean)
    //                         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    // type Enum = Foo | /* @internal */ Bar | Baz
    //                   ^^^^^^^^^^^^^^^^^^^^^
    // 连同后随逗号或联合类型竖线一起删除。
    const trailingRe = /\s*[,|]/y
    trailingRe.lastIndex = node.end
    const trailingStr = trailingRe.exec(s.original)?.[0] ?? ''
    s.remove(node.leadingComments[0].start, node.end + trailingStr.length)
    return true
  }
  return false
}

/** 删除匹配 MIT/BSD 文字的块注释，再合并多余空行；其他说明性注释保留。 */
function cleanUnnecessaryComments(chunk: OutputChunk) {
  chunk.code = chunk.code
    .replace(multilineCommentsRE, (m) => {
      return licenseCommentsRE.test(m) ? '' : m
    })
    .replace(consecutiveNewlinesRE, '\n\n')
}

/** 匹配需转义的正则元字符，供声明别名字面量替换使用。 */
const escapeRegexRE = /[-/\\^$*+?.()|[\]{}]/g
/** 转义标识符中的正则元字符，以精确匹配包含 $ 的声明别名。 */
function escapeRegex(str: string): string {
  return str.replace(escapeRegexRE, '\\$&')
}

/** 按首次出现顺序去重数组，避免重复报告同一残留标识。 */
function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}

/** postcss-load-config 原声明中需要改写的 Processor 深层导入文本。 */
const postcssLoadConfigDeepImport =
  "import Processor from 'postcss/lib/processor'"
/** 匹配 postcssrc namespace 与 CommonJS export= 尾部，捕获可提升到顶层的成员。 */
const postcssLoadConfigNamespaceRE =
  /declare namespace postcssrc \{([\s\S]*?)\n\}\s*\nexport = postcssrc/

/** 将 postcss-load-config 声明改为 ESM：Processor 从外部 postcss 入口引入，namespace 成员提升到顶层并改为 default export，供公开 PostcssUserConfig 导出与 tree-shaking。 */
function esmifyPostcssLoadConfigDts(): Plugin {
  return {
    name: 'esmify-postcss-load-config-dts',
    transform: {
      filter: { id: /postcss-load-config[\\/].*\.d\.ts$/ },
      /** 验证当前依赖声明的预期形态，再改写深层 import、namespace/export= 和 postcssrc 成员引用；形态变化时明确失败。 */
      handler(code, id) {
        if (
          !code.includes(postcssLoadConfigDeepImport) ||
          !postcssLoadConfigNamespaceRE.test(code)
        ) {
          this.error(
            `The shape of the postcss-load-config dts changed and this plugin needs to be updated: ${id}`,
          )
        }
        return code
          .replace(
            postcssLoadConfigDeepImport,
            "import type { Processor } from 'postcss'",
          )
          .replace(
            postcssLoadConfigNamespaceRE,
            (_, body) => `${body}\nexport default postcssrc`,
          )
          .replace(/\bpostcssrc\.(\w+)/g, '$1')
      },
    },
  }
}

/** 在声明解析前把裸 Node builtin 模块加 node: 前缀并 external，统一产物引用。 */
function addNodePrefix(): Plugin {
  return {
    name: 'add-node-prefix',
    resolveId: {
      order: 'pre',
      filter: {
        id: new RegExp(`^(?:${builtinModules.join('|')})$`),
      },
      /** 返回 node: builtin external ID，避免把内建模块声明打包进去。 */
      handler(id) {
        return { id: `node:${id}`, external: true }
      },
    },
  }
}
