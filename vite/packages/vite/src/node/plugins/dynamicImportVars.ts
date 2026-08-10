import { posix } from 'node:path'
import MagicString from 'magic-string'
import { init, parse as parseImports } from 'es-module-lexer'
import type { ImportSpecifier } from 'es-module-lexer'
import { parseAst } from 'rolldown/parseAst'
import { dynamicImportToGlob } from '@rollup/plugin-dynamic-import-vars'
import { viteDynamicImportVarsPlugin as nativeDynamicImportVarsPlugin } from 'rolldown/experimental'
import { exactRegex } from 'rolldown/filter'
import type { Plugin } from '../plugin'
import type { ResolvedConfig } from '../config'
import { CLIENT_ENTRY } from '../constants'
import { createBackCompatIdResolver } from '../idResolver'
import {
  createFilter,
  normalizePath,
  rawRE,
  requestQueryMaybeEscapedSplitRE,
  requestQuerySplitRE,
  transformStableResult,
  urlRE,
} from '../utils'
import type { Environment } from '../environment'
import { perEnvironmentState } from '../environment'
import { hasViteIgnoreRE } from './importAnalysis'
import { workerOrSharedWorkerRE } from './worker'

/** 运行时从 glob 映射选择变量路径的内部虚拟模块。 */
export const dynamicImportHelperId = '\0vite/dynamic-import-helper.js'

/** 识别相对动态导入路径；非相对模式不能安全展开为 glob。 */
const relativePathRE = /^\.{1,2}\//
// 动态 import 快速过滤：同时接受 `/`，因为 `import/* comment */(...)` 在关键字与括号间可有注释。
const hasDynamicImportRE = /\bimport\s*[(/]/

/** 描述动态导入变量分析后得到的 glob、模式和查询信息。 */
interface DynamicImportRequest {
  /** 原动态 import 的 raw/url/worker 等查询，传给生成的 import.meta.glob。 */
  query?: string | Record<string, string>
  /** 特殊资源 query 需要完整模块 namespace。 */
  import?: string
}

/** 描述变量动态导入转换所需的 glob 与原始模式。 */
interface DynamicImportPattern {
  /** 传给 import.meta.glob 的第二参数；无 query 时为空。 */
  globParams: DynamicImportRequest | null
  /** dynamicImportToGlob 生成的用户语义 pattern。 */
  userPattern: string
  /** 未含 query 的原始模板 pattern。 */
  rawPattern: string
}

/**
 * 运行时按完整 path 查询构建好的 glob 表；lazy value 调函数，eager value 包成 Promise。
 * 未命中异步 reject，避免同步异常改变 import() 的 Promise 语义；变量只允许替代单层文件名。
 */
const dynamicImportHelper = (
  glob: Record<string, any>,
  path: string,
  segs: number,
) => {
  const v = glob[path]
  if (v) {
    return typeof v === 'function' ? v() : Promise.resolve(v)
  }
  return new Promise((_, reject) => {
    ;(typeof queueMicrotask === 'function' ? queueMicrotask : setTimeout)(
      reject.bind(
        null,
        new Error(
          'Unknown variable dynamic import: ' +
            path +
            (path.split('/').length !== segs
              ? '. Note that variables only represent file names one level deep.'
              : ''),
        ),
      ),
    )
  })
}

/** 把模板字面量转成 glob pattern，并把资源 query 规范成 import.meta.glob 选项。 */
function parseDynamicImportPattern(
  strings: string,
): DynamicImportPattern | null {
  const filename = strings.slice(1, -1)
  const ast = (parseAst(strings).body[0] as any).expression

  const userPatternQuery = dynamicImportToGlob(ast, filename)
  if (!userPatternQuery) {
    return null
  }

  const [userPattern] = userPatternQuery.split(
    // POSIX pattern 中 `?` 会被转义，需用兼容转义/未转义两种形式的分隔正则。
    requestQueryMaybeEscapedSplitRE,
    2,
  )
  let [rawPattern, search] = filename.split(requestQuerySplitRE, 2)
  let globParams: DynamicImportRequest | null = null
  if (search) {
    search = '?' + search
    if (
      workerOrSharedWorkerRE.test(search) ||
      urlRE.test(search) ||
      rawRE.test(search)
    ) {
      globParams = {
        query: search,
        import: '*',
      }
    } else {
      globParams = {
        query: search,
      }
    }
  }

  return {
    globParams,
    userPattern,
    rawPattern,
  }
}

/**
 * 将单个变量动态 import 规范成 `import.meta.glob(pattern, params)` 与运行时查表所需相对路径。
 * 裸包/alias pattern 先 resolve 到文件，再相对 importer 还原为 glob 可接受的路径。
 */
export async function transformDynamicImport(
  importSource: string,
  importer: string,
  resolve: (
    url: string,
    importer?: string,
  ) => Promise<string | undefined> | string | undefined,
  root: string,
): Promise<{
  /** 由动态导入模式推导出的 glob 表达式。 */
  glob: string
  /** 用于还原运行时导入路径的规范化模式。 */
  pattern: string
  /** 用户源码中的原始动态导入模式，供错误与代码生成保留语义。 */
  rawPattern: string
} | null> {
  if (importSource[1] !== '.' && importSource[1] !== '/') {
    const resolvedFileName = await resolve(importSource.slice(1, -1), importer)
    if (!resolvedFileName) {
      return null
    }
    const relativeFileName = normalizePath(
      posix.relative(
        posix.dirname(normalizePath(importer)),
        normalizePath(resolvedFileName),
      ),
    )
    importSource =
      '`' + (relativeFileName[0] === '.' ? '' : './') + relativeFileName + '`'
  }

  const dynamicImportPattern = parseDynamicImportPattern(importSource)
  if (!dynamicImportPattern) {
    return null
  }
  const { globParams, rawPattern, userPattern } = dynamicImportPattern
  const params = globParams ? `, ${JSON.stringify(globParams)}` : ''
  const dir = importer ? posix.dirname(importer) : root
  const normalized =
    rawPattern[0] === '/'
      ? posix.join(root, rawPattern.slice(1))
      : posix.join(dir, rawPattern)

  let newRawPattern = posix.relative(posix.dirname(importer), normalized)

  if (!relativePathRE.test(newRawPattern)) {
    newRawPattern = `./${newRawPattern}`
  }

  const exp = `(import.meta.glob(${JSON.stringify(userPattern)}${params}))`

  return {
    rawPattern: newRawPattern,
    pattern: userPattern,
    glob: exp,
  }
}

/**
 * 变量动态 import 插件。bundled 环境委托 Rolldown 原生实现；unbundled 环境把可分析的模板字面量
 * 展开成 glob 对象，并调用虚拟 helper 在运行时按变量路径选模块。
 */
export function dynamicImportVarsPlugin(config: ResolvedConfig): Plugin {
  const resolve = createBackCompatIdResolver(config, {
    preferRelative: true,
    tryIndex: false,
    extensions: [],
  })

  const getFilter = perEnvironmentState((environment: Environment) => {
    const { include, exclude } =
      environment.config.build.dynamicImportVarsOptions
    return createFilter(include, exclude)
  })

  return {
    name: 'vite:dynamic-import-vars',

    /** 变量动态导入转换只对客户端消费者启用。 */
    applyToEnvironment(environment) {
      if (environment.config.isBundled) {
        const { include, exclude } =
          environment.config.build.dynamicImportVarsOptions

        return nativeDynamicImportVarsPlugin({
          include,
          exclude,
          /** 复用插件容器解析裸模块动态导入，并规范化为相对 glob 模式。 */
          resolver(id, importer) {
            return resolve(environment, id, importer)
          },
          sourcemap: !!environment.config.build.sourcemap,
        })
      }
      return true
    },

    resolveId: {
      filter: { id: exactRegex(dynamicImportHelperId) },
      /** 声明动态导入辅助虚拟模块 ID，使后续 load 钩子能够接管。 */
      handler(id) {
        return id
      },
    },

    load: {
      filter: { id: exactRegex(dynamicImportHelperId) },
      /** 返回动态导入辅助运行时代码，负责按路径深度匹配模块。 */
      handler(_id) {
        return `export default ${dynamicImportHelper.toString()}`
      },
    },

    transform: {
      filter: {
        id: { exclude: exactRegex(CLIENT_ENTRY) },
        code: hasDynamicImportRE,
      },
      /** 把可分析的模板动态导入转换为 import.meta.glob 查表调用。 */
      async handler(source, importer) {
        const { environment } = this
        if (!getFilter(this)(importer)) {
          return
        }

        await init

        let imports: readonly ImportSpecifier[] = []
        try {
          imports = parseImports(source)[0]
        } catch {
          // 输入可能并非 JS；这里不抢先报错，后续对应语言插件/importAnalysis 会给出准确诊断。
          return null
        }

        if (!imports.length) {
          return null
        }

        let s: MagicString | undefined
        let needDynamicImportHelper = false

        for (let index = 0; index < imports.length; index++) {
          const {
            s: start,
            e: end,
            ss: expStart,
            se: expEnd,
            d: dynamicIndex,
          } = imports[index]

          if (dynamicIndex === -1 || source[start] !== '`') {
            // 仅处理模板字面量动态 import；普通字面量由 importAnalysis，其他表达式保留并警告。
            continue
          }

          if (hasViteIgnoreRE.test(source.slice(expStart, expEnd))) {
            // 用户明确要求运行时接管时，不做 glob 展开。
            continue
          }

          s ||= new MagicString(source)
          let result
          try {
            result = await transformDynamicImport(
              source.slice(start, end),
              importer,
              (id, importer) => resolve(environment, id, importer),
              config.root,
            )
          } catch (error) {
            this.warn(error)
          }

          if (!result) {
            continue
          }

          const { rawPattern, glob } = result

          needDynamicImportHelper = true
          // 第三个参数记录路径段数，用于未命中时区分“未知文件”与“变量跨越多级目录”。
          s.overwrite(
            expStart,
            expEnd,
            `__variableDynamicImportRuntimeHelper(${glob}, \`${rawPattern}\`, ${rawPattern.split('/').length})`,
          )
        }

        if (s) {
          if (needDynamicImportHelper) {
            s.prepend(
              `import __variableDynamicImportRuntimeHelper from "${dynamicImportHelperId}";`,
            )
          }
          return transformStableResult(s, importer, config)
        }
      },
    },
  }
}
