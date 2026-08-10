import { transformSync } from 'rolldown/utils'
import type { ResolvedConfig } from '../config'
import type { Plugin } from '../plugin'
import { escapeRegex, isCSSRequest } from '../utils'
import type { Environment } from '../environment'
import { isHTMLRequest } from './html'

/** JSON 由专用插件/原生 transform 处理，不进入 JS define。 */
const nonJsRe = /\.json(?:$|\?)/
/** 快速识别当前仅需排除的非 JS 请求。 */
const isNonJsRequest = (request: string): boolean => nonJsRe.test(request)
/** 匹配 escapeRegex 生成、但不是双重转义的点，以扩展成可选链属性匹配。 */
const escapedDotRE = /(?<!\\)\\./g

/**
 * 创建编译期常量替换插件。
 *
 * bundled environment 把 define 注入 Rolldown 原生 transform；SSR dev 用 Oxc 对命中模块
 * 局部转换；client dev 的全局 define/import.meta.env 分别交给 clientInjections/importAnalysis，
 * 避免每个请求都运行一次 AST transform。
 */
export function definePlugin(config: ResolvedConfig): Plugin {
  const isBuild = config.command === 'build'
  const isBuildLib = isBuild && config.build.lib

  // 库产物不能固化发布者机器的 NODE_ENV 或伪造 process.env，交给下游应用决定。
  const processEnv: Record<string, string> = {}
  if (!isBuildLib) {
    const nodeEnv = process.env.NODE_ENV || config.mode
    Object.assign(processEnv, {
      'process.env': `{}`,
      'global.process.env': `{}`,
      'globalThis.process.env': `{}`,
      'process.env.NODE_ENV': JSON.stringify(nodeEnv),
      'global.process.env.NODE_ENV': JSON.stringify(nodeEnv),
      'globalThis.process.env.NODE_ENV': JSON.stringify(nodeEnv),
    })
  }

  /** 为一个 Environment 生成完整 define 表、快速命中正则与裸 import.meta.env 对象。 */
  function generatePattern(environment: Environment) {
    const isBundled = environment.config.isBundled
    const keepProcessEnv = environment.config.keepProcessEnv

    // dev 的 import.meta 由 importAnalysis 按请求处理；build/bundled 才在这里完整展开。
    const importMetaKeys: Record<string, string> = {}
    const importMetaEnvKeys: Record<string, string> = {}
    const importMetaFallbackKeys: Record<string, string> = {}
    if (isBuild) {
      importMetaKeys['import.meta.hot'] = `undefined`
    }
    if (isBundled) {
      for (const key in config.env) {
        const val = JSON.stringify(config.env[key])
        importMetaKeys[`import.meta.env.${key}`] = val
        importMetaEnvKeys[key] = val
      }
      // SSR 取决于当前 Environment，裸 import.meta.env 也要等汇总用户 define 后再生成。
      importMetaKeys['import.meta.env.SSR'] = `undefined`
      importMetaFallbackKeys['import.meta.env'] = `undefined`
    }

    const userDefine: Record<string, string> = {}
    const userDefineEnv: Record<string, any> = {}
    for (const key in environment.config.define) {
      userDefine[key] = handleDefineValue(environment.config.define[key])

      // 用户定义的 import.meta.env.X 也必须出现在裸 import.meta.env 对象中。
      if (isBuild && key.startsWith('import.meta.env.')) {
        userDefineEnv[key.slice(16)] = environment.config.define[key]
      }
    }

    const define: Record<string, string> = {
      ...(keepProcessEnv ? {} : processEnv),
      ...importMetaKeys,
      ...userDefine,
      ...importMetaFallbackKeys,
    }

    // 同一 resolved config 可服务 client/server Environment，SSR 不能在外层提前固定。
    const ssr = environment.config.consumer === 'server'

    if ('import.meta.env.SSR' in define) {
      define['import.meta.env.SSR'] = ssr + ''
    }

    const importMetaEnvVal = serializeDefine({
      ...importMetaEnvKeys,
      SSR: ssr + '',
      ...userDefineEnv,
    })

    // 先用廉价正则判定源码是否可能命中，避免对绝大多数模块启动 Oxc transform。
    const patternKeys = Object.keys(userDefine)
    if (!keepProcessEnv && Object.keys(processEnv).length) {
      patternKeys.push('process.env')
    }
    if (Object.keys(importMetaKeys).length) {
      patternKeys.push('import.meta.env', 'import.meta.hot')
    }
    const pattern = patternKeys.length
      ? new RegExp(
          patternKeys
            // 把单层转义点扩成可选问号加点，同时匹配普通属性与可选链；双转义保持原样。
            .map((key) => escapeRegex(key).replaceAll(escapedDotRE, '\\??\\.'))
            .join('|'),
        )
      : null

    return [define, pattern, importMetaEnvVal] as const
  }

  // Environment 为 WeakMap 键，环境关闭后缓存可回收，也不会把不同 define 配置串在一起。
  const patternsCache = new WeakMap<
    Environment,
    readonly [Record<string, string>, RegExp | null, string]
  >()
  /** 惰性取得当前 Environment 的 define 产物。 */
  function getPattern(environment: Environment) {
    let pattern = patternsCache.get(environment)
    if (!pattern) {
      pattern = generatePattern(environment)
      patternsCache.set(environment, pattern)
    }
    return pattern
  }

  return {
    name: 'vite:define',

    /** bundled 环境始终启用 define；开发态只在存在用户 define 时运行替换。 */
    applyToEnvironment(environment) {
      if (environment.config.isBundled) {
        // bundled 模式把定义并入 Rolldown options；未知静态 import.meta.env.* 统一为 undefined。
        return {
          name: 'vite:define',
          /** 声明 define transform 串行执行，保护插件内部替换缓存。 */
          options(option) {
            const [define, _pattern, importMetaEnvVal] = getPattern(
              this.environment,
            )
            define['import.meta.env'] = importMetaEnvVal
            define['import.meta.env.*'] = 'undefined'
            option.transform ??= {}
            option.transform.define = { ...option.transform.define, ...define }
          },
        }
      }
      return true
    },

    transform: {
      /** 跳过 HTML、CSS 和静态资源后，用 esbuild 替换 define 并清理无效 sourcemap。 */
      handler(code, id) {
        if (this.environment.config.consumer === 'client') {
          // client dev 的全局 define 和 import.meta.env 已由 clientInjection/importAnalysis 注入。
          return
        }

        if (
          // HTML、CSS、JSON 与静态资源不是此 JS transform 的输入，尽早跳过。
          isHTMLRequest(id) ||
          isCSSRequest(id) ||
          isNonJsRequest(id) ||
          config.assetsInclude(id)
        ) {
          return
        }

        const [define, pattern] = getPattern(this.environment)
        if (!pattern) return

        // 只有快速正则命中才启动 Oxc，且每次重置全局正则状态。
        pattern.lastIndex = 0
        if (!pattern.test(code)) return

        const result = replaceDefine(this.environment, code, id, define)
        return result
      },
    },
  }
}

/**
 * 用 Rolldown/Oxc 的 define transform 执行语法感知替换并生成 sourcemap。
 * 它不会误改字符串或静态文本；对象 define 等产生的 map 也能继续与上游合成（#15805）。
 */
export function replaceDefine(
  environment: Environment,
  code: string,
  id: string,
  define: Record<string, string>,
): {
  /** 转换后代码。 */
  code: string
  /** 与转换后代码对应的 sourcemap。 */
  map: ReturnType<typeof transformSync>['map'] | null
} {
  const result = transformSync(id, code, {
    lang: 'js',
    sourceType: 'module',
    define,
    sourcemap:
      environment.config.command === 'build'
        ? !!environment.config.build.sourcemap
        : true,
    tsconfig: false,
  })

  if (result.errors.length > 0) {
    throw new AggregateError(result.errors, 'oxc transform error')
  }

  return {
    code: result.code,
    map: result.map || null,
  }
}

/**
 * 类似 `JSON.stringify`，但字符串值保持为原始源码表达式：例如值 `"window"` 表示引用
 * 全局 window，而不是生成字符串。key 排序保证裸 import.meta.env 输出稳定（#17748）。
 */
export function serializeDefine(define: Record<string, any>): string {
  let res = `{`
  const keys = Object.keys(define).sort()
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const val = define[key]
    res += `${JSON.stringify(key)}: ${handleDefineValue(val)}`
    if (i !== keys.length - 1) {
      res += `, `
    }
  }
  return res + `}`
}

/** 按 define 约定把 undefined、源码字符串及普通 JSON 值转换为代码。 */
function handleDefineValue(value: any): string {
  if (typeof value === 'undefined') return 'undefined'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}
