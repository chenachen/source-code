import path from 'node:path'
import MagicString from 'magic-string'
import { stripLiteral } from 'strip-literal'
import { exactRegex } from 'rolldown/filter'
import type { Plugin } from '../plugin'
import type { ResolvedConfig } from '../config'
import {
  injectQuery,
  isDataUrl,
  isParentDirectory,
  transformStableResult,
  tryStatSync,
} from '../utils'
import { CLIENT_ENTRY } from '../constants'
import { slash } from '../../shared/utils'
import { createBackCompatIdResolver } from '../idResolver'
import type { ResolveIdFn } from '../idResolver'
import { fileToUrl } from './asset'
import { preloadHelperId } from './importAnalysisBuild'
import type { InternalResolveOptions } from './resolve'
import { tryFsResolve } from './resolve'
import { hasViteIgnoreRE } from './importAnalysis'

/**
 * 匹配以 import.meta.url 为基准、首参数为字符串或模板字面量的 new URL 表达式。
 * `d` 标志保留完整表达式与 URL 参数的源码区间，供插件从原始代码读取和替换。
 *
 * 插件把匹配到的动态模板改写为可枚举的 import.meta.glob：
 * ```
 * new URL(`./dir/${name}.png`, import.meta.url)
 * // 转换为
 * new URL(import.meta.glob('./dir/*.png', { eager: true, import: 'default', query: '?url' })[`./dir/${name}.png`], import.meta.url)
 * ```
 */
export const assetImportMetaUrlRE: RegExp =
  /\bnew\s+URL\s*\(\s*('[^']+'|"[^"]+"|`[^`]+`)\s*,\s*import\.meta\.url\s*(?:,\s*)?\)/dg

/**
 * client 专用 new URL 转换插件：静态字面量复用 asset URL 协议，动态模板转 glob；不存在文件保留原
 * URL 值交给运行时解析，并允许 Vite 忽略标记显式跳过。
 */
export function assetImportMetaUrlPlugin(config: ResolvedConfig): Plugin {
  const { publicDir } = config
  let assetResolver: ResolveIdFn

  const fsResolveOptions: InternalResolveOptions = {
    ...config.resolve,
    root: config.root,
    isProduction: config.isProduction,
    isBuild: config.command === 'build',
    packageCache: config.packageCache,
    asSrc: true,
  }

  return {
    name: 'vite:asset-import-meta-url',

    /** 仅为客户端消费者启用 new URL 重写，服务端保留原生 import.meta.url 语义。 */
    applyToEnvironment(environment) {
      return environment.config.consumer === 'client'
    },

    transform: {
      filter: {
        id: {
          exclude: [exactRegex(preloadHelperId), exactRegex(CLIENT_ENTRY)],
        },
        code: assetImportMetaUrlRE,
      },
      /** 扫描 new URL 表达式：模板路径展开 glob，静态路径解析为 Vite 资源 URL。 */
      async handler(code, id) {
        let s: MagicString | undefined
        const re = new RegExp(assetImportMetaUrlRE)
        const cleanString = stripLiteral(code)

        let match: RegExpExecArray | null
        while ((match = re.exec(cleanString))) {
          const [[startIndex, endIndex], [urlStart, urlEnd]] =
            match.indices as Array<[number, number]>
          if (hasViteIgnoreRE.test(code.slice(startIndex, urlStart))) continue

          const rawUrl = code.slice(urlStart, urlEnd)

          if (!s) s = new MagicString(code)

          // 含 `${}` 的模板可能需要枚举为 glob；无表达式模板仍按静态 URL 处理。
          if (rawUrl[0] === '`' && rawUrl.includes('${')) {
            const queryDelimiterIndex = getQueryDelimiterIndex(rawUrl)
            const hasQueryDelimiter = queryDelimiterIndex !== -1
            const pureUrl = hasQueryDelimiter
              ? rawUrl.slice(0, queryDelimiterIndex) + '`'
              : rawUrl
            const queryString = hasQueryDelimiter
              ? rawUrl.slice(queryDelimiterIndex, -1)
              : ''
            const ast = this.parse(pureUrl)
            const templateLiteral = (ast as any).body[0].expression
            if (templateLiteral.expressions.length) {
              const pattern = buildGlobPattern(templateLiteral)
              if (pattern[0] === '*') {
                // pattern 以 `*` 开头表示动态段覆盖整个前缀，枚举范围不可控，通常也不是用户本意。
                continue
              }

              const globOptions = {
                eager: true,
                import: 'default',
                // glob 内部通过 url query 表达旧 as:'url' 语义，使 query 与 URL 导出可同时存在。
                query: injectQuery(queryString, 'url'),
              }
              s.update(
                startIndex,
                endIndex,
                `new URL((import.meta.glob(${JSON.stringify(
                  pattern,
                )}, ${JSON.stringify(
                  globOptions,
                )}))[${pureUrl}], import.meta.url)`,
              )
              continue
            }
          }

          const url = rawUrl.slice(1, -1)
          if (isDataUrl(url)) {
            continue
          }
          let file: string | undefined
          if (url[0] === '.') {
            file = slash(path.resolve(path.dirname(id), url))
            file = tryFsResolve(file, fsResolveOptions) ?? file
          } else {
            assetResolver ??= createBackCompatIdResolver(config, {
              extensions: [],
              mainFields: [],
              tryIndex: false,
              preferRelative: true,
            })
            file = await assetResolver(this.environment, url, id)
            file ??=
              url[0] === '/'
                ? slash(path.join(publicDir, url))
                : slash(path.resolve(path.dirname(id), url))
          }

          // 尝试得到最终 asset URL；文件不存在/解析异常则退回原 URL，让运行时自行解析。
          let builtUrl: string | undefined
          if (file) {
            try {
              if (publicDir && isParentDirectory(publicDir, file)) {
                const publicPath = '/' + path.posix.relative(publicDir, file)
                builtUrl = await fileToUrl(this, publicPath)
              } else {
                builtUrl = await fileToUrl(this, file)
                // 开发 builtUrl 可能指目录或尚不存在文件，只有真实文件才登记 watcher。
                if (tryStatSync(file)?.isFile()) {
                  this.addWatchFile(file)
                }
              }
            } catch {
              // 统一在下方输出包含原表达式的警告。
            }
          }
          if (!builtUrl) {
            const rawExp = code.slice(startIndex, endIndex)
            config.logger.warnOnce(
              `\n${rawExp} doesn't exist at build time, it will remain unchanged to be resolved at runtime. ` +
                `If this is intended, you can use the /* @vite-ignore */ comment to suppress this warning.`,
            )
            builtUrl = url
          }
          s.update(
            startIndex,
            endIndex,
            // 加 `'' +` 阻止 Rolldown 再次接管已由 Vite 转换的 new URL：
            // https://github.com/rolldown/rolldown/issues/2745
            `new URL(${JSON.stringify(builtUrl)}, '' + import.meta.url)`,
          )
        }
        if (s) {
          return transformStableResult(s, id, config)
        }
      },
    },
  }
}

/** 把模板 quasi/expression 折叠为 glob，并合并相邻动态表达式为一个 `*`。 */
function buildGlobPattern(ast: any) {
  let pattern = ''
  let lastIsGlob = false
  for (let i = 0; i < ast.quasis.length; i++) {
    const str = ast.quasis[i].value.raw
    if (str) {
      pattern += str
      lastIsGlob = false
    }

    if (ast.expressions[i] && !lastIsGlob) {
      pattern += '*'
      lastIsGlob = true
    }
  }
  return pattern
}

/** 找模板顶层 query 的 `?`；跳过 `${condition ? a : b}` 内部问号。 */
function getQueryDelimiterIndex(rawUrl: string): number {
  let bracketsStack = 0
  for (let i = 0; i < rawUrl.length; i++) {
    if (rawUrl[i] === '{') {
      bracketsStack++
    } else if (rawUrl[i] === '}') {
      bracketsStack--
    } else if (rawUrl[i] === '?' && bracketsStack === 0) {
      return i
    }
  }
  return -1
}
