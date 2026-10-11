import { isAbsolute, posix } from 'node:path'
import picomatch from 'picomatch'
import { stripLiteral } from 'strip-literal'
import colors from 'picocolors'
import type { ESTree } from 'rolldown/utils'
import type { CustomPluginOptions, RollupError } from 'rolldown'
import MagicString from 'magic-string'
import { stringifyQuery } from 'ufo'
import { parseAstAsync } from 'rolldown/parseAst'
import { escapePath, glob } from 'tinyglobby'
import { viteImportGlobPlugin as nativeImportGlobPlugin } from 'rolldown/experimental'
import type { GeneralImportGlobOptions } from '#types/importGlob'
import type { Plugin } from '../plugin'
import type { EnvironmentModuleNode } from '../server/moduleGraph'
import type { ResolvedConfig } from '../config'
import { evalValue, normalizePath, transformStableResult } from '../utils'
import type { Logger } from '../logger'
import { slash } from '../../shared/utils'
import type { Environment } from '../environment'

/** 描述一次 import.meta.glob 调用的源码范围、模式与规范化选项。 */
export interface ParsedImportGlob {
  /** 当前文件中第几个 glob 调用，用于生成不冲突的 eager import 变量名。 */
  index: number
  /** 用户原始正/负 glob 字符串。 */
  globs: string[]
  /** 以 root/importer/base 解析后的绝对 glob。 */
  globsResolved: string[]
  /** 所有 pattern 是否均以 `.`/`!` 开头；决定结果对象 key 使用相对还是 root URL。 */
  isRelative: boolean
  /** 已静态求值、校验并规范化 query 的选项。 */
  options: ParsedGeneralImportGlobOptions
  /** 整个 import.meta.glob(...) 在源码中的范围。 */
  start: number
  /** 该片段在原始源码中的结束偏移。 */
  end: number
  /** 调用是否直接被 Object.keys 包裹；只生成对象键，省略实际 imports。 */
  onlyKeys: boolean
  /** 指示 glob 结果是否只需值集合而可省略键包装。 */
  onlyValues: boolean
}

/** 表示完成 `as`、query 等兼容项归一化后的 glob 选项。 */
interface ParsedGeneralImportGlobOptions extends GeneralImportGlobOptions {
  /** 附加到每个 glob 匹配导入上的规范化查询串。 */
  query?: string
}

/**
 * `import.meta.glob` 插件：bundled 环境委托 Rolldown 原生实现；unbundled 环境展开成静态/动态
 * import 对象，并保存 glob matcher，使文件新增/删除也能反向触发声明该 glob 的模块 HMR。
 */
export function importGlobPlugin(config: ResolvedConfig): Plugin {
  const importGlobMaps = new Map<
    Environment,
    Map<string, Array<(file: string) => boolean>>
  >()

  return {
    name: 'vite:import-glob',
    /** bundled Environment 使用原生插件；其余环境使用本地实现并记录 HMR matcher。 */
    applyToEnvironment(environment) {
      if (environment.config.isBundled) {
        return nativeImportGlobPlugin({
          root: environment.config.root,
          sourcemap: !!environment.config.build.sourcemap,
          restoreQueryExtension:
            environment.config.experimental.importGlobRestoreExtension,
        })
      }
      return true
    },
    /** 清空上一轮已解析 glob 记录，避免监听重构建沿用旧匹配集合。 */
    buildStart() {
      importGlobMaps.clear()
    },
    transform: {
      filter: { code: 'import.meta.glob' },
      /** 解析并展开源码中的 import.meta.glob 调用，记录模式与匹配文件用于热更新。 */
      async handler(code, id) {
        const result = await transformGlobImport(
          code,
          id,
          config.root,
          (im, _, options) =>
            this.resolve(im, id, options).then((i) => i?.id || im),
          config.experimental.importGlobRestoreExtension,
          config.logger,
        )
        if (result) {
          if (!importGlobMaps.has(this.environment)) {
            importGlobMaps.set(this.environment, new Map())
          }

          const globMatchers = result.matches.map((i) => {
            const affirmed: string[] = []
            const negated: string[] = []
            for (const glob of i.globsResolved) {
              if (glob[0] === '!') {
                negated.push(glob.slice(1))
              } else {
                affirmed.push(glob)
              }
            }
            const affirmedMatcher = picomatch(affirmed, {
              noextglob: true,
              dot: !!i.options.exhaustive,
              nocase: !(i.options.caseSensitive ?? true),
              ignore: i.options.exhaustive ? [] : ['**/node_modules/**'],
            })
            const negatedMatcher = picomatch(negated, {
              noextglob: true,
              dot: !!i.options.exhaustive,
              nocase: !(i.options.caseSensitive ?? true),
              ignore: i.options.exhaustive ? [] : ['**/node_modules/**'],
            })

            return (file: string) => {
              // 匹配语义：至少一个正 pattern（无正项则全匹配），且不能命中任一负 pattern。
              return (
                (affirmed.length === 0 || affirmedMatcher(file)) &&
                !(negated.length > 0 && negatedMatcher(file))
              )
            }
          })
          importGlobMaps.get(this.environment)!.set(id, globMatchers)

          return transformStableResult(result.s, id, config)
        }
      },
    },
    /** 文件新增或删除时匹配已记录 glob，把声明该 glob 的模块加入热更新集合；普通内容更新跳过。 */
    hotUpdate({ type, file, modules: oldModules }) {
      if (type === 'update') return

      const importGlobMap = importGlobMaps.get(this.environment)
      if (!importGlobMap) return

      const modules: EnvironmentModuleNode[] = []
      for (const [id, globMatchers] of importGlobMap) {
        if (globMatchers.some((matcher) => matcher(file))) {
          const mod = this.environment.moduleGraph.getModuleById(id)
          if (mod) modules.push(mod)
        }
      }
      return modules.length > 0 ? [...oldModules, ...modules] : undefined
    },
  }
}

/** 定位源码中的 import.meta.glob 调用起点。 */
const importGlobRE = /\bimport\.meta\.glob(?:<\w+>)?\s*\(/g
/** 识别紧邻 glob 调用的 Object.keys 包装，以启用键集合优化。 */
const objectKeysRE = /\bObject\.keys\(\s*$/
/** 识别紧邻 glob 调用的 Object.values 包装，以启用值集合优化。 */
const objectValuesRE = /\bObject\.values\(\s*$/

/** 允许的 glob 选项及静态求值后的类型约束。 */
const knownOptions = {
  as: ['string'],
  eager: ['boolean'],
  import: ['string'],
  exhaustive: ['boolean'],
  query: ['object', 'string'],
  base: ['string'],
  caseSensitive: ['boolean'],
}

/** 这些旧式 `as` 模式固定导入默认导出，以保持兼容行为。 */
const forceDefaultAs = ['raw', 'url']

/** 创建带源码位置的插件错误，供 overlay/code frame 指向 glob 调用。 */
function err(e: string, pos: number) {
  const error = new Error(e) as RollupError
  error.pos = pos
  return error
}

/** 静态求值并校验第二参数；动态变量、未知 key 与错误类型均拒绝。 */
function parseGlobOptions(
  rawOpts: string,
  optsStartIndex: number,
  logger?: Logger,
): ParsedGeneralImportGlobOptions {
  let opts: GeneralImportGlobOptions = {}
  try {
    opts = evalValue(rawOpts)
  } catch {
    throw err(
      'Vite is unable to parse the glob options as the value is not static',
      optsStartIndex,
    )
  }

  if (opts == null) {
    return {}
  }

  for (const key in opts) {
    if (!(key in knownOptions)) {
      throw err(`Unknown glob option "${key}"`, optsStartIndex)
    }
    const allowedTypes = knownOptions[key as keyof typeof knownOptions]
    const valueType = typeof opts[key as keyof GeneralImportGlobOptions]
    if (!allowedTypes.includes(valueType)) {
      throw err(
        `Expected glob option "${key}" to be of type ${allowedTypes.join(
          ' or ',
        )}, but got ${valueType}`,
        optsStartIndex,
      )
    }
  }

  if (opts.base) {
    if (opts.base[0] === '!') {
      throw err('Option "base" cannot start with "!"', optsStartIndex)
    } else if (
      opts.base[0] !== '/' &&
      !opts.base.startsWith('./') &&
      !opts.base.startsWith('../')
    ) {
      throw err(
        `Option "base" must start with '/', './' or '../', but got "${opts.base}"`,
        optsStartIndex,
      )
    }
  }

  if (typeof opts.query === 'object') {
    for (const key in opts.query) {
      const value = opts.query[key]
      if (!['string', 'number', 'boolean'].includes(typeof value)) {
        throw err(
          `Expected glob option "query.${key}" to be of type string, number, or boolean, but got ${typeof value}`,
          optsStartIndex,
        )
      }
    }
    // 对象 query 提前序列化，后续只需按字符串拼接 import path。
    opts.query = stringifyQuery(opts.query)
  }

  if (opts.as && logger) {
    const importSuggestion = forceDefaultAs.includes(opts.as)
      ? `, import: 'default'`
      : ''
    logger.warn(
      colors.yellow(
        `The glob option "as" has been deprecated in favour of "query". Please update \`as: '${opts.as}'\` to \`query: '?${opts.as}'${importSuggestion}\`.`,
      ),
    )
  }

  // 旧 as:raw/url 只能配 default/* import；迁移后统一为 query + import。
  if (opts.as && forceDefaultAs.includes(opts.as)) {
    if (opts.import && opts.import !== 'default' && opts.import !== '*')
      throw err(
        `Option "import" can only be "default" or "*" when "as" is "${opts.as}", but got "${opts.import}"`,
        optsStartIndex,
      )
    opts.import = opts.import || 'default'
  }

  if (opts.as && opts.query)
    throw err(
      'Options "as" and "query" cannot be used together',
      optsStartIndex,
    )

  if (opts.as) opts.query = opts.as

  if (opts.query && opts.query[0] !== '?') opts.query = `?${opts.query}`

  return opts as ParsedGeneralImportGlobOptions
}

/**
 * 词法定位并用 AST 校验 `import.meta.glob()`：参数必须是静态字符串/字符串数组，选项必须是对象
 * 字面量。并行解析每个 pattern 为绝对 glob，同时识别 Object.keys/values 优化形态。
 */
export async function parseImportGlob(
  code: string,
  importer: string | undefined,
  root: string,
  resolveId: IdResolver,
  logger?: Logger,
): Promise<ParsedImportGlob[]> {
  let cleanCode: string
  try {
    cleanCode = stripLiteral(code)
  } catch {
    // 非法 JS 交给后续解析/Import Analysis 报更准确错误；glob 快路径不抢占诊断。
    return []
  }
  const matches = Array.from(cleanCode.matchAll(importGlobRE))

  const tasks = matches.map(async (match, index) => {
    const start = match.index!

    /** 创建带 glob 调用偏移的语法错误，使上层诊断能指向当前调用。 */
    const err = (msg: string) => {
      const e = new Error(`Invalid glob import syntax: ${msg}`)
      ;(e as any).pos = start
      return e
    }

    const end =
      findCorrespondingCloseParenthesisPosition(
        cleanCode,
        start + match[0].length,
      ) + 1
    if (end <= 0) {
      throw err('Close parenthesis not found')
    }

    const statementCode = code.slice(start, end)

    const rootAst = (await parseAstAsync(statementCode)).body[0]
    if (rootAst.type !== 'ExpressionStatement') {
      throw err(`Expect CallExpression, got ${rootAst.type}`)
    }
    const ast = rootAst.expression
    if (ast.type !== 'CallExpression') {
      throw err(`Expect CallExpression, got ${ast.type}`)
    }
    if (ast.arguments.length < 1 || ast.arguments.length > 2)
      throw err(`Expected 1-2 arguments, but got ${ast.arguments.length}`)

    const arg1 = ast.arguments[0]
    const arg2 = ast.arguments[1]

    const globs: string[] = []

    /** 校验第一参数中的每个 pattern 是字符串或无插值模板，否则抛出带位置错误。 */
    const validateLiteral = (
      element: ESTree.Expression | ESTree.SpreadElement | null,
    ) => {
      if (!element) return
      if (element.type === 'Literal') {
        if (typeof element.value !== 'string')
          throw err(
            `Expected glob to be a string, but got "${typeof element.value}"`,
          )
        globs.push(element.value)
      } else if (element.type === 'TemplateLiteral') {
        if (element.expressions.length !== 0) {
          throw err(
            `Expected glob to be a string, but got dynamic template literal`,
          )
        }
        globs.push(element.quasis[0].value.raw)
      } else {
        throw err('Could only use literals')
      }
    }

    if (arg1.type === 'ArrayExpression') {
      for (const element of arg1.elements) {
        validateLiteral(element)
      }
    } else {
      validateLiteral(arg1)
    }

    // 第二参数必须是可静态求值的对象字面量。
    let options: ParsedGeneralImportGlobOptions = {}
    if (arg2) {
      if (arg2.type !== 'ObjectExpression')
        throw err(
          `Expected the second argument to be an object literal, but got "${arg2.type}"`,
        )

      options = parseGlobOptions(
        code.slice(start + arg2.start, start + arg2.end),
        start + arg2.start,
        logger,
      )
    }

    const globsResolved = await Promise.all(
      globs.map((glob) =>
        toAbsoluteGlob(glob, root, importer, resolveId, options.base),
      ),
    )
    const isRelative = globs.every((i) => '.!'.includes(i[0]))
    const sliceCode = cleanCode.slice(0, start)
    const onlyKeys = objectKeysRE.test(sliceCode)
    let onlyValues = false
    if (!onlyKeys) {
      onlyValues = objectValuesRE.test(sliceCode)
    }

    return {
      index,
      globs,
      globsResolved,
      isRelative,
      options,
      start,
      end,
      onlyKeys,
      onlyValues,
    }
  })

  return (await Promise.all(tasks)).filter(Boolean)
}

/**
 * 在 stripLiteral 后的代码中寻找 glob 调用闭括号；无嵌套时走 indexOf 快路径，有嵌套选项时计数。
 */
function findCorrespondingCloseParenthesisPosition(
  cleanCode: string,
  openPos: number,
) {
  const closePos = cleanCode.indexOf(')', openPos)
  if (closePos < 0) return -1

  if (!cleanCode.slice(openPos, closePos).includes('(')) return closePos

  let remainingParenthesisCount = 0
  const cleanCodeLen = cleanCode.length
  for (let pos = openPos; pos < cleanCodeLen; pos++) {
    switch (cleanCode[pos]) {
      case '(': {
        remainingParenthesisCount++
        break
      }
      case ')': {
        remainingParenthesisCount--
        if (remainingParenthesisCount <= 0) {
          return pos
        }
      }
    }
  }
  return -1
}

/** 生成 glob 展开导入绑定时使用的内部变量前缀。 */
const importPrefix = '__vite_glob_'

/** 复用 POSIX 路径函数，确保 glob 转换结果不受宿主平台分隔符影响。 */
const { basename, dirname, relative } = posix

/** 描述 glob 转换后的代码、匹配文件和源码位置。 */
export interface TransformGlobImportResult {
  /** 已完成 glob 调用覆盖与 eager import prepend 的源码。 */
  s: MagicString
  /** 每个调用的解析结果，供开发态建立文件新增/删除 matcher。 */
  matches: ParsedImportGlob[]
  /** 本轮实际匹配文件全集。 */
  files: Set<string>
}

/**
 * 展开一个文件中的所有 import.meta.glob：tinyglobby 枚举文件，按 eager/import/query/base 生成
 * import 与对象/数组表达式，并保持原调用的换行数以稳定 Source Map。
 */
export async function transformGlobImport(
  code: string,
  id: string,
  root: string,
  resolveId: IdResolver,
  restoreQueryExtension = false,
  logger?: Logger,
): Promise<TransformGlobImportResult | null> {
  id = slash(id)
  root = slash(root)
  const isVirtual = isVirtualModule(id)
  const dir = isVirtual ? undefined : dirname(id)
  const matches = await parseImportGlob(
    code,
    isVirtual ? undefined : id,
    root,
    resolveId,
    logger,
  )
  const matchedFiles = new Set<string>()

  if (!matches.length) return null

  const s = new MagicString(code)

  const staticImports = (
    await Promise.all(
      matches.map(
        async ({
          globsResolved,
          isRelative,
          options,
          index,
          start,
          end,
          onlyKeys,
          onlyValues,
        }) => {
          if (!dir && !options.base && isRelative) {
            throw new Error("In virtual modules, all globs must start with '/'")
          }

          const cwd = getCommonBase(globsResolved) ?? root
          const files = (
            await glob(globsResolved, {
              absolute: true,
              cwd,
              dot: !!options.exhaustive,
              expandDirectories: false,
              caseSensitiveMatch: options.caseSensitive ?? true,
              ignore: options.exhaustive ? [] : ['**/node_modules/**'],
              extglob: false,
            })
          )
            .filter((file) => file !== id)
            .sort()

          const objectProps: string[] = []
          const staticImports: string[] = []

          /** 同时生成实际 import specifier 与暴露给用户的对象 key。 */
          const resolvePaths = (file: string) => {
            if (!dir) {
              const importPath = `/${relative(root, file)}`
              let filePath = options.base
                ? `${relative(posix.join(root, options.base), file)}`
                : importPath
              if (
                options.base &&
                !filePath.startsWith('./') &&
                !filePath.startsWith('../')
              ) {
                filePath = `./${filePath}`
              }
              return { filePath, importPath }
            }

            let importPath = relative(dir, file)
            if (!importPath.startsWith('./') && !importPath.startsWith('../')) {
              importPath = `./${importPath}`
            }

            let filePath: string
            if (options.base) {
              const resolvedBasePath = options.base[0] === '/' ? root : dir
              filePath = relative(
                posix.join(resolvedBasePath, options.base),
                file,
              )
              if (!filePath.startsWith('./') && !filePath.startsWith('../')) {
                filePath = `./${filePath}`
              }
            } else if (isRelative) {
              filePath = importPath
            } else {
              filePath = relative(root, file)
              if (!filePath.startsWith('./') && !filePath.startsWith('../')) {
                filePath = `/${filePath}`
              }
            }

            return { filePath, importPath }
          }

          files.forEach((file, i) => {
            const paths = resolvePaths(file)
            const filePath = paths.filePath
            let importPath = paths.importPath
            let importQuery = options.query ?? ''

            if (onlyKeys) {
              // Object.keys 只需要枚举后的键，不生成实际 imports；文件枚举仍已在上方完成。
              objectProps.push(`${JSON.stringify(filePath)}: 0`)
              return
            }

            if (importQuery && importQuery !== '?raw') {
              const fileExtension = basename(file).split('.').slice(-1)[0]
              if (fileExtension && restoreQueryExtension)
                importQuery = `${importQuery}&lang.${fileExtension}`
            }

            importPath = `${importPath}${importQuery}`

            const importKey =
              options.import && options.import !== '*'
                ? options.import
                : undefined

            if (options.eager) {
              // eager 在模块顶层生成静态 import，便于 tree-shaking 并保持同步 value。
              const variableName = `${importPrefix}${index}_${i}`
              const expression = importKey
                ? `{ ${importKey} as ${variableName} }`
                : `* as ${variableName}`
              staticImports.push(
                `import ${expression} from ${JSON.stringify(importPath)}`,
              )
              objectProps.push(
                onlyValues
                  ? `${variableName}`
                  : `${JSON.stringify(filePath)}: ${variableName}`,
              )
            } else {
              // 默认 lazy：每个 key 对应一个返回动态 import Promise 的函数。
              let importStatement = `import(${JSON.stringify(importPath)})`
              if (importKey)
                importStatement += `.then(m => m[${JSON.stringify(importKey)}])`
              objectProps.push(
                onlyValues
                  ? `() => ${importStatement}`
                  : `${JSON.stringify(filePath)}: () => ${importStatement}`,
              )
            }
          })

          files.forEach((i) => matchedFiles.add(i))

          // 覆盖 glob 调用时补回相同行数，避免后续 code frame/source map 整体偏移。
          const originalLineBreakCount =
            code.slice(start, end).match(/\n/g)?.length ?? 0
          const lineBreaks =
            originalLineBreakCount > 0
              ? '\n'.repeat(originalLineBreakCount)
              : ''
          let replacement = ''
          if (onlyKeys) {
            replacement = `{${objectProps.join(',')}${lineBreaks}}`
          } else if (onlyValues) {
            replacement = `[${objectProps.join(',')}${lineBreaks}]`
          } else {
            replacement = `/* #__PURE__ */ Object.assign({${objectProps.join(
              ',',
            )}${lineBreaks}})`
          }

          s.overwrite(start, end, replacement)

          return staticImports
        },
      ),
    )
  ).flat()

  if (staticImports.length) s.prepend(`${staticImports.join(';')};`)

  return {
    s,
    matches,
    files: matchedFiles,
  }
}

/** 定义 glob 文件解析时透传给插件容器的解析选项。 */
type IdResolver = (
  id: string,
  importer?: string,
  options?: {
    /** 传给 Rollup 解析钩子的 import attributes。 */
    attributes?: Record<string, string>
    /** 透传给其他解析插件的自定义选项。 */
    custom?: CustomPluginOptions
    /** 指示解析目标是否作为入口处理。 */
    isEntry?: boolean
    /** 避免解析时再次调用当前插件。 */
    skipSelf?: boolean
  },
) => Promise<string | undefined> | string | undefined

/** 先统一 `/` 再转义 glob 元字符，避免 Windows `\` 参与两次转义。 */
function globSafePath(path: string) {
  return escapePath(normalizePath(path))
}

/** 从末尾向前取第 n 个字符，用于比较 resolver 结果与用户 glob 的共同动态后缀。 */
function lastNthChar(str: string, n: number) {
  return str.charAt(str.length - 1 - n)
}

/**
 * resolver 得到的静态路径部分必须转义 glob 元字符，但用户声明的 `*` 等动态后缀必须保留。两串从
 * 末尾回溯共同后缀，只对 resolved 的前缀做 escape。
 */
function globSafeResolvedPath(resolved: string, glob: string) {
  let numEqual = 0
  const maxEqual = Math.min(resolved.length, glob.length)
  while (
    numEqual < maxEqual &&
    lastNthChar(resolved, numEqual) === lastNthChar(glob, numEqual)
  ) {
    numEqual += 1
  }
  const staticPartEnd = resolved.length - numEqual
  const staticPart = resolved.slice(0, staticPartEnd)
  const dynamicPart = resolved.slice(staticPartEnd)
  return globSafePath(staticPart) + dynamicPart
}

/**
 * 按 root/importer/base 把用户 pattern 解析成 tinyglobby 绝对 pattern。支持 `/`、`./`、`../`、
 * `**`、alias/package imports；正负 pattern 保留前导 `!`。
 */
export async function toAbsoluteGlob(
  glob: string,
  root: string,
  importer: string | undefined,
  resolveId: IdResolver,
  base?: string,
): Promise<string> {
  let pre = ''
  if (glob[0] === '!') {
    pre = '!'
    glob = glob.slice(1)
  }
  root = globSafePath(root)
  let dir
  if (base) {
    if (base[0] === '/') {
      dir = posix.join(root, base)
    } else {
      dir = posix.resolve(
        importer ? globSafePath(dirname(importer)) : root,
        base,
      )
    }
  } else {
    dir = importer ? globSafePath(dirname(importer)) : root
  }

  if (glob[0] === '/') return pre + posix.join(root, glob.slice(1))
  if (glob.startsWith('./')) return pre + posix.join(dir, glob.slice(2))
  if (glob.startsWith('../')) return pre + posix.join(dir, glob)
  if (glob.startsWith('**')) return pre + glob

  const isSubImportsPattern = glob[0] === '#' && glob.includes('*')

  const resolved = normalizePath(
    (await resolveId(glob, importer, {
      custom: { 'vite:import-glob': { isSubImportsPattern } },
    })) || glob,
  )
  if (isAbsolute(resolved)) {
    return pre + globSafeResolvedPath(resolved, glob)
  }

  throw new Error(
    `Invalid glob: "${glob}" (resolved: "${resolved}"). It must start with '/' or './'`,
  )
}

/** 计算所有正 pattern 的最深共同静态目录，缩小 tinyglobby 的 cwd 扫描范围。 */
export function getCommonBase(globsResolved: string[]): null | string {
  const bases = globsResolved
    .filter((g) => g[0] !== '!')
    .map((glob) => {
      let { base } = picomatch.scan(glob)
      // basename 含点时按文件名近似判断，cwd 退到父目录；这里不读取文件系统区分文件/目录。
      if (posix.basename(base).includes('.')) base = posix.dirname(base)

      return base
    })

  if (!bases.length) return null

  let commonAncestor = ''
  const dirS = bases[0].split('/')
  for (let i = 0; i < dirS.length; i++) {
    const candidate = dirS.slice(0, i + 1).join('/')
    if (
      bases.every(
        (base) => base === candidate || base.startsWith(`${candidate}/`),
      )
    )
      commonAncestor = candidate
    else break
  }
  if (!commonAncestor) commonAncestor = '/'

  return commonAncestor
}

/** 按 Vite 约定识别 `virtual:`、null byte 或无路径分隔符的虚拟模块 ID。 */
export function isVirtualModule(id: string): boolean {
  // https://vite.dev/guide/api-plugin.html#virtual-modules-convention
  return id.startsWith('virtual:') || id[0] === '\0' || !id.includes('/')
}
