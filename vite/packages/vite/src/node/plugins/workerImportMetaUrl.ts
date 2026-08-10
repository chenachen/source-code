import path from 'node:path'
import MagicString from 'magic-string'
import type { RollupError } from 'rolldown'
import { parseAstAsync } from 'rolldown/parseAst'
import { stripLiteral } from 'strip-literal'
import type { ESTree } from 'rolldown/utils'
import type { ResolvedConfig } from '../config'
import type { Plugin } from '../plugin'
import { evalValue, injectQuery, transformStableResult } from '../utils'
import { createBackCompatIdResolver } from '../idResolver'
import type { ResolveIdFn } from '../idResolver'
import { cleanUrl, slash } from '../../shared/utils'
import type { WorkerType } from './worker'
import {
  WORKER_FILE_ID,
  emitWorkerAssetsForBundledDev,
  workerFileToUrl,
} from './worker'
import { fileToUrl, toOutputFilePathInJSForBundledDev } from './asset'
import type { InternalResolveOptions } from './resolve'
import { tryFsResolve } from './resolve'
import { hasViteIgnoreRE } from './importAnalysis'

/** 描述从 Worker 构造器第二参数中提取的静态类型选项。 */
interface WorkerOptions {
  /** Worker 以 classic 或 module 方式加载；忽略模式由注释标记单独推导。 */
  type?: WorkerType
}

/** 创建带源码位置的 Rollup 错误，使 Worker 选项诊断可生成准确代码框。 */
function err(e: string, pos: number) {
  const error = new Error(e) as RollupError
  error.pos = pos
  return error
}

/** 从 Worker URL 表达式结尾继续计数括号，定位构造器调用的闭括号。字符串/注释已被 stripLiteral 屏蔽。 */
function findClosingParen(input: string, fromIndex: number) {
  let count = 1

  for (let i = fromIndex; i < input.length; i++) {
    if (input[i] === '(') count++
    if (input[i] === ')') count--
    if (count === 0) return i
  }

  return -1
}

/**
 * evalValue 失败时只从 ObjectExpression 静态提取 type。spread 必须位于 type 前，否则后续 spread 可能
 * 覆盖 type，Vite无法可靠选择 classic/module 注入方式。
 */
function extractWorkerTypeFromAst(
  expression: ESTree.Expression,
  optsStartIndex: number,
): 'classic' | 'module' | undefined {
  if (expression.type !== 'ObjectExpression') {
    return
  }

  let lastSpreadElementIndex = -1
  let typeProperty = null
  let typePropertyIndex = -1

  for (let i = 0; i < expression.properties.length; i++) {
    const property = expression.properties[i]

    if (property.type === 'SpreadElement') {
      lastSpreadElementIndex = i
      continue
    }

    if (
      property.type === 'Property' &&
      ((property.key.type === 'Identifier' && property.key.name === 'type') ||
        (property.key.type === 'Literal' && property.key.value === 'type'))
    ) {
      typeProperty = property
      typePropertyIndex = i
    }
  }

  if (typePropertyIndex === -1 && lastSpreadElementIndex === -1) {
    // 无 type 且无 spread，其他动态属性不影响 worker 类型，安全回退 classic。
    return 'classic'
  }

  if (typePropertyIndex < lastSpreadElementIndex) {
    throw err(
      'Expected object spread to be used before the definition of the type property. ' +
        'Vite needs a static value for the type property to correctly infer it.',
      optsStartIndex,
    )
  }

  if (typeProperty?.value.type !== 'Literal') {
    throw err(
      'Expected worker options type property to be a literal value.',
      optsStartIndex,
    )
  }

  // 与 getWorkerType 一致：只有字面量 module 选择 module，其余值静默按 classic。
  return typeProperty?.value.value === 'module' ? 'module' : 'classic'
}

/** 优先静态求值完整 options，失败时用 AST 执行受限 type 提取；其余动态写法给出 Vite 忽略标记建议。 */
async function parseWorkerOptions(
  rawOpts: string,
  optsStartIndex: number,
): Promise<WorkerOptions> {
  let opts: WorkerOptions = {}
  try {
    opts = evalValue<WorkerOptions>(rawOpts)
  } catch {
    const optsNode = (
      (await parseAstAsync(`(${rawOpts})`))
        .body[0] as ESTree.ExpressionStatement
    ).expression

    const type = extractWorkerTypeFromAst(optsNode, optsStartIndex)
    if (type) {
      return { type }
    }

    throw err(
      'Vite is unable to parse the worker options as the value is not static. ' +
        'To ignore this error, please use /* @vite-ignore */ in the worker options.',
      optsStartIndex,
    )
  }

  if (opts == null) {
    return {}
  }

  if (typeof opts !== 'object') {
    throw err(
      `Expected worker options to be an object, got ${typeof opts}`,
      optsStartIndex,
    )
  }

  return opts
}

/** 从 Worker 构造器第二参数推断 classic/module；注释中的 Vite 忽略标记返回 ignore。 */
async function getWorkerType(
  raw: string,
  clean: string,
  i: number,
): Promise<WorkerType> {
  const commaIndex = clean.indexOf(',', i)
  if (commaIndex === -1) {
    return 'classic'
  }
  const endIndex = findClosingParen(clean, i)

  // 逗号位于当前构造器闭括号之后，说明它属于外层表达式，不存在 Worker options。
  if (commaIndex > endIndex) {
    return 'classic'
  }

  // 注释中的 `@vite-ignore` 必须检查原始代码而非已清理字符串。
  let workerOptString = raw.substring(commaIndex + 1, endIndex)
  const hasViteIgnore = hasViteIgnoreRE.test(workerOptString)
  if (hasViteIgnore) {
    return 'ignore'
  }

  // options 语法内容则从去注释/字面量干扰的 clean 代码判断是否为空。
  const cleanWorkerOptString = clean.substring(commaIndex + 1, endIndex)
  const trimmedCleanWorkerOptString = cleanWorkerOptString.trim()
  if (!trimmedCleanWorkerOptString.length) {
    return 'classic'
  }

  // evalValue 不接受这里只表示参数结尾的 trailing comma，求值前移除。
  if (trimmedCleanWorkerOptString.endsWith(',')) {
    workerOptString = workerOptString.slice(
      0,
      cleanWorkerOptString.lastIndexOf(','),
    )
  }

  const workerOpts = await parseWorkerOptions(workerOptString, commaIndex + 1)
  if (
    workerOpts.type &&
    (workerOpts.type === 'module' || workerOpts.type === 'classic')
  ) {
    return workerOpts.type
  }

  return 'classic'
}

/** 定位以 import.meta.url 为基准创建的 Worker 或 SharedWorker URL。 */
export const workerImportMetaUrlRE: RegExp =
  /\bnew\s+(?:Worker|SharedWorker)\s*\(\s*(new\s+URL\s*\(\s*('[^']+'|"[^"]+"|`[^`]+`)\s*,\s*import\.meta\.url\s*(?:,\s*)?\))/dg

/**
 * 转换 `new Worker(new URL('./worker.js', import.meta.url), options)`：静态解析 URL/type，普通开发态加
 * worker_file query，bundled 模式启动 Worker 子构建并替换为其输出 URL。
 */
export function workerImportMetaUrlPlugin(config: ResolvedConfig): Plugin {
  let workerResolver: ResolveIdFn

  const fsResolveOptions: InternalResolveOptions = {
    ...config.resolve,
    root: config.root,
    isProduction: config.isProduction,
    isBuild: config.command === 'build',
    packageCache: config.packageCache,
    asSrc: true,
  }

  return {
    name: 'vite:worker-import-meta-url',

    /** Worker 构造器 URL 重写只对客户端消费者启用。 */
    applyToEnvironment(environment) {
      return environment.config.consumer === 'client'
    },

    transform: {
      filter: { code: workerImportMetaUrlRE },
      /** 解析 Worker 类型与静态 URL，生成开发服务地址或构建 worker 占位符。 */
      async handler(code, id) {
        const isBundled = this.environment.config.isBundled
        let s: MagicString | undefined
        const cleanString = stripLiteral(code)
        const re = new RegExp(workerImportMetaUrlRE)

        let match: RegExpExecArray | null
        while ((match = re.exec(cleanString))) {
          const [[, endIndex], [expStart, expEnd], [urlStart, urlEnd]] =
            match.indices as Array<[number, number]>

          const rawUrl = code.slice(urlStart, urlEnd)

          // Worker 入口必须静态确定，动态模板不能像普通 asset 那样安全枚举并保持构造器语义。
          if (rawUrl[0] === '`' && rawUrl.includes('${')) {
            this.error(
              `\`new URL(url, import.meta.url)\` is not supported in dynamic template string.`,
              expStart,
            )
          }

          s ||= new MagicString(code)
          const workerType = await getWorkerType(code, cleanString, endIndex)
          const url = rawUrl.slice(1, -1)
          let file: string | undefined
          if (url[0] === '.') {
            file = path.resolve(path.dirname(id), url)
            file = slash(tryFsResolve(file, fsResolveOptions) ?? file)
          } else {
            workerResolver ??= createBackCompatIdResolver(config, {
              extensions: [],
              tryIndex: false,
              preferRelative: true,
            })
            file = await workerResolver(this.environment, url, id)
            file ??=
              url[0] === '/'
                ? slash(path.join(config.publicDir, url))
                : slash(path.resolve(path.dirname(id), url))
          }

          if (
            isBundled &&
            config.isWorker &&
            config.bundleChain.at(-1) === cleanUrl(file)
          ) {
            s.update(expStart, expEnd, 'self.location.href')
          } else {
            let builtUrl: string
            if (isBundled) {
              const result = await workerFileToUrl(config, file)
              if (this.environment.config.command === 'serve') {
                emitWorkerAssetsForBundledDev(this, config)
                builtUrl = toOutputFilePathInJSForBundledDev(
                  this.environment,
                  result.entryFilename,
                )
              } else {
                builtUrl = result.entryUrlPlaceholder
              }
              for (const file of result.watchedFiles) {
                this.addWatchFile(file)
              }
            } else {
              builtUrl = await fileToUrl(this, cleanUrl(file))
              builtUrl = injectQuery(
                builtUrl,
                `${WORKER_FILE_ID}&type=${workerType}`,
              )
            }
            s.update(
              expStart,
              expEnd,
              // 写入的 `@vite-ignore` 防止后续 asset 插件再处理；`'' +` 阻止 Rolldown 重复转换 new URL：
              // https://github.com/rolldown/rolldown/issues/2745
              `new URL(/* @vite-ignore */ ${JSON.stringify(builtUrl)}, '' + import.meta.url)`,
            )
          }
        }

        if (s) {
          return transformStableResult(s, id, config)
        }

        return null
      },
    },
  }
}
