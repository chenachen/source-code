import { basename, dirname, join, relative } from 'node:path'
import { parse as parseImports } from 'es-module-lexer'
import type {
  ParseError as EsModuleLexerParseError,
  ImportSpecifier,
} from 'es-module-lexer'
import type { OutputChunk } from 'rolldown'
import type { Plugin } from '../plugin'
import { preloadMethod } from '../plugins/importAnalysisBuild'
import {
  generateCodeFrame,
  joinUrlSegments,
  normalizePath,
  numberToPos,
  sortObjectKeys,
} from '../utils'
import { perEnvironmentState } from '../environment'

/**
 * 生成 SSR 渲染时使用的“模块 → 预加载资源”清单。
 *
 * 普通模块条目来自 chunk.viteMetadata 的 CSS/asset；动态 import helper 还要解析最终 chunk
 * 代码，沿被导入 chunk 的静态 imports 递归收集 CSS，使服务端能为异步组件生成 preload link。
 */
export function ssrManifestPlugin(): Plugin {
  // 每个 Environment 独立维护 module id → preload assets，避免多环境构建互相覆盖。
  const getSsrManifest = perEnvironmentState(() => {
    return {} as Record<string, string[]>
  })

  return {
    name: 'vite:ssr-manifest',

    /** 只在当前 Environment 请求生成 SSR manifest 时启用插件。 */
    applyToEnvironment(environment) {
      return !!environment.config.build.ssrManifest
    },

    /** 遍历最终 chunk 图，生成模块到 JS/CSS/asset 预加载资源的映射文件。 */
    generateBundle(_options, bundle) {
      const config = this.environment.config
      const ssrManifest = getSsrManifest(this)
      const { base } = config
      for (const file in bundle) {
        const chunk = bundle[file]
        if (chunk.type === 'chunk') {
          for (const id in chunk.modules) {
            const normalizedId = normalizePath(relative(config.root, id))
            const mappedChunks =
              ssrManifest[normalizedId] ?? (ssrManifest[normalizedId] = [])
            if (!chunk.isEntry) {
              mappedChunks.push(joinUrlSegments(base, chunk.fileName))
              // 入口 JS/CSS 由 HTML 或集成框架负责链接；这里仅为非 entry chunk 补记录。
              chunk.viteMetadata!.importedCss.forEach((file) => {
                mappedChunks.push(joinUrlSegments(base, file))
              })
            }
            chunk.viteMetadata!.importedAssets.forEach((file) => {
              mappedChunks.push(joinUrlSegments(base, file))
            })
          }
          if (chunk.code.includes(preloadMethod)) {
            // 含动态 preload helper 的 chunk 需要额外建立动态入口 basename → CSS deps 映射。
            const code = chunk.code
            let imports: ImportSpecifier[] = []
            try {
              imports = parseImports(code)[0].filter((i) => i.n && i.d > -1)
            } catch (_e: unknown) {
              const e = _e as EsModuleLexerParseError
              const loc = numberToPos(code, e.idx)
              this.error({
                name: e.name,
                message: e.message,
                stack: e.stack,
                cause: e.cause,
                pos: e.idx,
                loc: { ...loc, file: chunk.fileName },
                frame: generateCodeFrame(code, loc),
              })
            }
            if (imports.length) {
              for (let index = 0; index < imports.length; index++) {
                const { s: start, e: end, n: name } = imports[index]
                // 对这些字面量动态 import，lexer 的区间包含引号；去引号后相对当前 chunk 定位文件。
                const url = code.slice(start, end)
                const deps: string[] = []
                const ownerFilename = chunk.fileName
                // 从字面量动态 import 目标递归追踪静态 imports，汇总整条子图的 CSS。
                const analyzed: Set<string> = new Set<string>()
                /** 深度遍历动态目标的 chunk imports，收集 CSS 并通过 analyzed 去重。 */
                const addDeps = (filename: string) => {
                  // owner 自环与已访问 chunk 跳过，防止循环 chunk 图无限递归或重复资源。
                  if (filename === ownerFilename) return
                  if (analyzed.has(filename)) return
                  analyzed.add(filename)
                  const chunk = bundle[filename] as OutputChunk | undefined
                  if (chunk) {
                    chunk.viteMetadata!.importedCss.forEach((file) => {
                      deps.push(joinUrlSegments(base, file))
                    })
                    chunk.imports.forEach(addDeps)
                  }
                }
                const normalizedFile = normalizePath(
                  join(dirname(chunk.fileName), url.slice(1, -1)),
                )
                addDeps(normalizedFile)
                // 以动态 import 目标的 basename 登记 CSS 依赖，供 SSR 集成查询。
                ssrManifest[basename(name!)] = deps
              }
            }
          }
        }
      }

      this.emitFile({
        // 字符串允许框架使用自定义位置；true 使用 Vite 默认隐藏目录。
        fileName:
          typeof config.build.ssrManifest === 'string'
            ? config.build.ssrManifest
            : '.vite/ssr-manifest.json',
        type: 'asset',
        source: JSON.stringify(sortObjectKeys(ssrManifest), undefined, 2),
      })
    },
  }
}
