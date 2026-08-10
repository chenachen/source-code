import path from 'node:path'
import MagicString from 'magic-string'
import type { ImportSpecifier } from 'es-module-lexer'
import { init, parse as parseImports } from 'es-module-lexer'
import type { SourceMap } from 'rolldown'
import { viteBuildImportAnalysisPlugin as nativeBuildImportAnalysisPlugin } from 'rolldown/experimental'
import type { RawSourceMap } from '@jridgewell/remapping'
import convertSourceMap from 'convert-source-map'
import {
  combineSourcemaps,
  generateCodeFrame,
  getFileStartIndex,
  numberToPos,
} from '../utils'
import { type Plugin, perEnvironmentPlugin } from '../plugin'
import type { ResolvedConfig } from '../config'
import { toOutputFilePathInJS } from '../build'
import { genSourceMapUrl } from '../server/sourcemap'
import type { PartialEnvironment } from '../baseEnvironment'
import { removedPureCssFilesCache } from './css'
import { getImportMap, getImportMapFilename } from './html'

/** 描述 preload 依赖 URL，以及它是否只能在运行时解析。 */
type FileDep = {
  /** 待加载或写入产物的资源 URL。 */
  url: string
  /** 为 true 时该依赖必须留到浏览器运行时解析。 */
  runtime: boolean
}

/** 扩展 preload 错误事件，携带触发失败的原始 Error。 */
type VitePreloadErrorEvent = Event & {
  /** preload 失败时携带、供应用决定是否接管的原始错误。 */
  payload: Error
}

/**
 * 注入 helper 的现代格式标记。输出不是原生 ES 时会替换为 false，使相关逻辑可被
 * dead-code elimination 删除。
 */
export const isModernFlag = `__VITE_IS_MODERN__`
/** 构建产物中调用 preload 辅助函数的稳定标识符。 */
export const preloadMethod = `__vitePreload`
/** renderChunk 阶段写入的 preload 依赖占位标记。 */
export const preloadMarker = `__VITE_PRELOAD__`

/** preload 运行时辅助模块的内部虚拟 ID。 */
export const preloadHelperId = '\0vite/preload-helper.js'
/** 匹配 chunk 中全部 preload 占位标记以便批量替换。 */
const preloadMarkerRE = new RegExp(preloadMarker, 'g')

/** 生成相对 importer 的显式 `./`/`../` 路径。 */
function toRelativePath(filename: string, importer: string) {
  const relPath = path.posix.relative(path.posix.dirname(importer), filename)
  return relPath[0] === '.' ? relPath : `./${relPath}`
}

/** 从指定位置查找下一个 preload 占位符，并重置全局正则游标。 */
function findPreloadMarker(str: string, pos: number = 0): number {
  preloadMarkerRE.lastIndex = pos
  const result = preloadMarkerRE.exec(str)
  return result?.index ?? -1
}

/**
 * 把每个动态 `import()` 与属于它的 `__VITE_PRELOAD__` 占位符配对。
 *
 * 每个 import 会包成 `__vitePreload(factory, marker)`。嵌套 import 令 wrapper 也
 * 嵌套，例如外层 a 的 marker 会落在内层 b 之后；若简单取“下一个 marker”，两者
 * 都会错误绑定到 b，并把 a 的 CSS 依赖变成 `void 0`（#22700）。算法单次扫描，
 * 用栈让每个 marker 关闭最近尚未匹配的 import。
 *
 * 返回数组与 `imports` 平行：第 i 项是其 marker 起点，无 marker 时为 -1。
 */
export function matchImportsToPreloadMarkers(
  code: string,
  imports: readonly ImportSpecifier[],
): number[] {
  const importMarkerPos = new Array<number>(imports.length).fill(-1)
  if (imports.length === 0) return importMarkerPos

  const openImports: number[] = []
  let nextImport = 0
  for (
    let markerStartPos = findPreloadMarker(code, imports[0].e);
    markerStartPos !== -1;
    markerStartPos = findPreloadMarker(
      code,
      markerStartPos + preloadMarker.length,
    )
  ) {
    while (
      nextImport < imports.length &&
      imports[nextImport].e <= markerStartPos
    ) {
      openImports.push(nextImport++)
    }
    if (openImports.length) {
      importMarkerPos[openImports.pop()!] = markerStartPos
    }
  }
  // #3051：只有一个 import/marker 时兼容 marker 未位于 import 之后的旧输出形态。
  if (imports.length === 1 && importMarkerPos[0] === -1) {
    importMarkerPos[0] = findPreloadMarker(code)
  }

  return importMarkerPos
}

/** 动态 chunk 执行前，并行加载其 CSS 与直接静态依赖的浏览器运行时 helper。 */

/** 检测浏览器原生 modulepreload；不支持时退为 preload as=script。 */
function detectScriptRel() {
  const relList =
    typeof document !== 'undefined' && document.createElement('link').relList
  return relList && relList.supports && relList.supports('modulepreload')
    ? 'modulepreload'
    : 'preload'
}

/** preload 运行时探测得到的脚本预加载 rel 值。 */
declare const scriptRel: string
/** 记录已插入的 preload URL，防止同一依赖重复创建 link。 */
declare const seen: Record<string, boolean>
/**
 * 先去重并加载依赖，再执行真正动态 import；CSS 会等待 load/error，错误通过
 * 可取消的 `vite:preloadError` 事件交给应用决定是否继续抛出。
 */
function preload(
  baseModule: () => Promise<unknown>,
  deps?: string[],
  importerUrl?: string,
) {
  let promise: Promise<PromiseSettledResult<unknown>[] | void> =
    Promise.resolve()
  // @ts-expect-error __VITE_IS_MODERN__ will be replaced with boolean later
  if (__VITE_IS_MODERN__ && deps && deps.length > 0) {
    const links = document.getElementsByTagName('link')
    const cspNonceMeta = document.querySelector<HTMLMetaElement>(
      'meta[property=csp-nonce]',
    )
    // 优先 `.nonce` 以兼容 nonce hiding；Firefox 67–74 支持 CSP nonce 却没有
    // `.nonce` 属性，因此回退 getAttribute：
    // https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/nonce#accessing_nonces_and_nonce_hiding
    const cspNonce = cspNonceMeta?.nonce || cspNonceMeta?.getAttribute('nonce')

    // 目标范围含不支持 Promise.allSettled 的旧浏览器，使用局部等价实现。
    /** 为旧浏览器提供局部 Promise.allSettled 等价实现，并保留每项成功或失败状态。 */
    function allSettled<T>(
      promises: Array<T | PromiseLike<T>>,
    ): Promise<PromiseSettledResult<T>[]> {
      return Promise.all(
        promises.map((p) =>
          Promise.resolve(p).then(
            (value: T) => ({ status: 'fulfilled' as const, value }),
            (reason: unknown) => ({ status: 'rejected' as const, reason }),
          ),
        ),
      )
    }

    /** 优先使用运行时 import.meta.resolve，并在不支持时回退相对 URL 解析。 */
    function importMetaResolve(specifier: string): string {
      // @ts-expect-error import.meta.resolve is not supported by all browsers we support
      if (import.meta.resolve) {
        return import.meta.resolve(specifier)
      }
      return new URL(specifier, /** #__KEEP__ */ import.meta.url).href
    }

    promise = allSettled(
      deps.map((dep) => {
        // @ts-expect-error assetsURL is declared before preload.toString()
        dep = assetsURL(dep, importerUrl)
        dep = importMetaResolve(dep)
        if (dep in seen) return
        seen[dep] = true
        const isCss = dep.endsWith('.css')

        // SSR HTML 可能已输出相同 preload；assetsURL 已把 dep 转成绝对 URL，可直接去重。
        for (let i = links.length - 1; i >= 0; i--) {
          const link = links[i]
          // 浏览器读取 link.href 时会自动反射为绝对 URL，可与 dep 直接比较：
          // https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflecting-content-attributes-in-idl-attributes:idl-domstring-5
          if (link.href === dep && (!isCss || link.rel === 'stylesheet')) {
            return
          }
        }

        const link = document.createElement('link')
        link.rel = isCss ? 'stylesheet' : scriptRel
        if (!isCss) {
          link.as = 'script'
        }
        link.crossOrigin = ''
        link.href = dep
        if (cspNonce) {
          link.setAttribute('nonce', cspNonce)
        }
        document.head.appendChild(link)
        if (isCss) {
          return new Promise((res, rej) => {
            link.addEventListener('load', res)
            link.addEventListener('error', () =>
              rej(new Error(`Unable to preload CSS for ${dep}`)),
            )
          })
        }
      }),
    )
  }

  /** 派发可取消的 preloadError 事件；未被应用接管时重新抛出错误。 */
  function handlePreloadError(err: Error) {
    const e = new Event('vite:preloadError', {
      cancelable: true,
    }) as VitePreloadErrorEvent
    e.payload = err
    window.dispatchEvent(e)
    if (!e.defaultPrevented) {
      throw err
    }
  }

  return promise.then((res) => {
    for (const item of res || []) {
      if (item.status !== 'rejected') continue
      handlePreloadError(item.reason)
    }
    return baseModule().catch(handlePreloadError)
  })
}

/** 按 polyfill、base 与 renderBuiltUrl 策略序列化 preload helper 虚拟模块。 */
function getPreloadCode(
  environment: PartialEnvironment,
  renderBuiltUrlBoolean: boolean,
  isRelativeBase: boolean,
) {
  const { modulePreload } = environment.config.build

  const scriptRel =
    modulePreload && modulePreload.polyfill
      ? `'modulepreload'`
      : `/* @__PURE__ */ (${detectScriptRel.toString()})()`

  // __vitePreload 的依赖列表存在两种兼容格式：
  //
  // __vitePreload(() => import(asyncChunk), [ ...deps... ])
  //
  // 早期 module preload 不可配置，一些插件用正则处理该列表；继续保留其文本形态。
  const assetsURL =
    renderBuiltUrlBoolean || isRelativeBase
      ? // renderBuiltUrl 或相对 base 下，依赖可能相对当前 chunk，需把 importerUrl
        // 作为第三参数交给 __vitePreload 再用 URL 求绝对地址。
        `function(dep, importerUrl) { return new URL(dep, importerUrl).href }`
      : // 非相对 base 下，deps 相对项目 outDir，helper 直接前置 base。
        `function(dep) { return ${JSON.stringify(environment.config.base)}+dep }`
  // toString 结果再还原特殊 import 拼写，绕过 StackBlitz 对源码关键字的预处理限制：
  // https://stackblitz.com/edit/node-vqfvv8dy?file=index.js
  const preloadMethodCode = preload.toString().replaceAll('𝐢𝐦𝐩𝐨𝐫𝐭', 'import')
  const preloadCode = `const scriptRel = ${scriptRel};const assetsURL = ${assetsURL};const seen = {};export const ${preloadMethod} = ${preloadMethodCode}`
  return preloadCode
}

/**
 * 构建专用动态导入分析：native 插件在 transform 时注入 wrapper/marker，本插件在
 * render/generate 阶段填入真实依赖、处理纯 CSS chunk，并维护 sourcemap。
 * 开发态的对应职责位于 `./importAnalysis`。
 */
export function buildImportAnalysisPlugin(config: ResolvedConfig): Plugin[] {
  /** 按环境配置决定 preload 辅助函数的插入位置与依赖标记形式。 */
  const getInsertPreload = (environment: PartialEnvironment) =>
    environment.config.consumer === 'client' &&
    !config.isWorker &&
    !config.build.lib

  const renderBuiltUrl = config.experimental.renderBuiltUrl
  const isRelativeBase = config.base === './' || config.base === ''

  const plugin: Plugin = {
    name: 'vite:build-import-analysis',

    /** 在 chunk 中插入 preload 辅助调用，并把现代构建条件折叠为目标布尔值。 */
    renderChunk(code, _, { format }) {
      // 只有 ES 现代输出保留 preload helper；legacy 输出可通过常量折叠删除。
      if (code.includes(isModernFlag)) {
        const re = new RegExp(isModernFlag, 'g')
        const isModern = String(format === 'es')
        const isModernWithPadding =
          isModern + ' '.repeat(isModernFlag.length - isModern.length)
        return {
          code: code.replace(re, isModernWithPadding),
          map: null,
        }
      }
      return null
    },

    /** 分析 chunk 依赖图并替换 preload 标记，同时补入 CSS 与资源依赖。 */
    async generateBundle(opts, bundle) {
      const { format } = opts
      if (format !== 'es') {
        return
      }

      await init

      // 不插入 preload 时仍需清理指向“已删除纯 CSS chunk”的动态 import。
      if (!getInsertPreload(this.environment)) {
        const removedPureCssFiles = removedPureCssFilesCache.get(config)
        if (removedPureCssFiles && removedPureCssFiles.size > 0) {
          for (const file in bundle) {
            const chunk = bundle[file]
            if (chunk.type === 'chunk' && chunk.code.includes('import')) {
              const code = chunk.code
              let imports!: ImportSpecifier[]
              try {
                imports = parseImports(code)[0].filter((i) => i.d > -1)
              } catch (e: any) {
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

              for (const imp of imports) {
                const {
                  n: name,
                  s: start,
                  e: end,
                  ss: expStart,
                  se: expEnd,
                } = imp
                let url = name
                if (!url) {
                  const rawUrl = code.slice(start, end)
                  if (
                    (rawUrl[0] === `"` && rawUrl[rawUrl.length - 1] === `"`) ||
                    (rawUrl[0] === '`' && rawUrl[rawUrl.length - 1] === '`')
                  )
                    url = rawUrl.slice(1, -1)
                }
                if (!url) continue

                const normalizedFile = path.posix.join(
                  path.posix.dirname(chunk.fileName),
                  url,
                )
                if (removedPureCssFiles.has(normalizedFile)) {
                  // 用等长 Promise.resolve({}) 替换，既移除失效 import 又尽量保持映射位置。
                  chunk.code =
                    chunk.code.slice(0, expStart) +
                    `Promise.resolve({${''.padEnd(expEnd - expStart - 19, ' ')}})` +
                    chunk.code.slice(expEnd)
                }
              }
            }
          }
        }
        return
      }
      const buildSourcemap = this.environment.config.build.sourcemap
      const { modulePreload } = this.environment.config.build

      let importMapMapping: Record<string, string> | undefined
      let importMapReverseMapping: Record<string, string> | undefined
      if (this.environment.config.build.chunkImportMap) {
        const importMap = getImportMap(bundle, this.environment.config)!
        importMapMapping = importMap.mapping
        importMapReverseMapping = Object.fromEntries(
          Object.entries(importMapMapping).map(([k, v]) => [v, k]),
        )

        if (config.isOutputOptionsForLegacyChunks?.(opts)) {
          this.emitFile({
            type: 'asset',
            fileName: 'importmap.legacy.json',
            source: importMap.asset.source,
          })
          delete bundle[getImportMapFilename(this.environment.config)]
        }
      }

      for (const file in bundle) {
        const chunk = bundle[file]
        // 不能依赖 chunk.dynamicImports.length：常量 JSON 等动态导入可能已被内联，
        // 但代码里的 preload marker 仍需要处理。
        if (chunk.type === 'chunk' && chunk.code.includes(preloadMarker)) {
          const code = chunk.code
          let imports!: ImportSpecifier[]
          try {
            imports = parseImports(code)[0].filter((i) => i.d > -1)
          } catch (e: any) {
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

          const s = new MagicString(code)
          // 记录已重写标记的起始双引号位置，避免同一字面量被重复处理。
          const rewroteMarkerStartPos = new Set()

          const fileDeps: FileDep[] = []
          /** 把文件依赖加入当前 preload 标记，并区分运行时 URL 与静态产物。 */
          const addFileDep = (
            url: string,
            runtime: boolean = false,
          ): number => {
            const index = fileDeps.findIndex((dep) => dep.url === url)
            if (index === -1) {
              return fileDeps.push({ url, runtime }) - 1
            } else {
              return index
            }
          }

          if (imports.length) {
            const importMarkerPos = matchImportsToPreloadMarkers(code, imports)

            for (let index = 0; index < imports.length; index++) {
              // specifier 含转义时优先使用 lexer 解码后的 `.n`，缺失再从源码切片恢复。
              const {
                n: name,
                s: start,
                e: end,
                ss: expStart,
                se: expEnd,
              } = imports[index]
              // 解析当前动态 import 指向的输出 chunk。
              let url = name
              if (!url) {
                const rawUrl = code.slice(start, end)
                if (
                  (rawUrl[0] === `"` && rawUrl[rawUrl.length - 1] === `"`) ||
                  (rawUrl[0] === '`' && rawUrl[rawUrl.length - 1] === '`')
                )
                  url = rawUrl.slice(1, -1)
              }
              const deps = new Set<string>()
              let hasRemovedPureCssChunk = false

              let normalizedFile: string | undefined = undefined

              if (url) {
                normalizedFile = path.posix.join(
                  path.posix.dirname(chunk.fileName),
                  url,
                )

                const ownerFilename = chunk.fileName
                // 字面量 import：递归追踪直接静态 imports，收集并行 preload 依赖。
                const analyzed: Set<string> = new Set<string>()
                /** 递归收集 chunk 的静态依赖、CSS 与资源，并保持去重后的加载顺序。 */
                const addDeps = (rawFilename: string) => {
                  const filename =
                    importMapMapping?.[rawFilename] ?? rawFilename
                  if (filename === ownerFilename) return
                  if (analyzed.has(filename)) return
                  analyzed.add(filename)
                  const chunk = bundle[filename]
                  if (chunk) {
                    deps.add(chunk.fileName)
                    if (chunk.type === 'chunk') {
                      chunk.imports.forEach(addDeps)
                      // 先递归依赖、后追加当前 chunk CSS，保持 CSS 加载顺序，避免依赖样式
                      // 反过来覆盖当前 chunk 的规则。
                      chunk.viteMetadata!.importedCss.forEach((file) => {
                        deps.add(file)
                      })
                    }
                  } else {
                    const removedPureCssFiles =
                      removedPureCssFilesCache.get(config)!
                    const chunk = removedPureCssFiles.get(filename)
                    if (chunk) {
                      if (chunk.viteMetadata!.importedCss.size) {
                        chunk.viteMetadata!.importedCss.forEach((file) => {
                          deps.add(file)
                        })
                        hasRemovedPureCssChunk = true
                      }

                      s.update(expStart, expEnd, 'Promise.resolve({})')
                    }
                  }
                }
                addDeps(normalizedFile)
              }

              const markerStartPos = importMarkerPos[index]

              if (markerStartPos > 0) {
                // deps 包含动态入口自身；没有额外依赖时无需生成 preload 列表。
                let depsArray =
                  deps.size > 1 ||
                  // 纯 CSS 动态入口的 JS chunk 已被删除，但其 CSS 仍需加载。
                  (hasRemovedPureCssChunk && deps.size > 0)
                    ? modulePreload === false
                      ? // CSS 复用 preload helper 实现实际装载；即便关闭 module preload，
                        // 动态 import 仍必须传递 CSS 依赖。
                        [...deps].filter((d) => d.endsWith('.css'))
                      : [...deps]
                    : []

                const resolveDependencies = modulePreload
                  ? modulePreload.resolveDependencies
                  : undefined
                if (resolveDependencies && normalizedFile) {
                  // CSS 项不是可选性能 preload，而是 chunk 正确运行所需的真实装载；
                  // resolveDependencies 只能调整其他依赖，不能删除 CSS。
                  const cssDeps: string[] = []
                  const otherDeps: string[] = []
                  for (const dep of depsArray) {
                    ;(dep.endsWith('.css') ? cssDeps : otherDeps).push(dep)
                  }
                  depsArray = [
                    // 传给用户的是最终 URL，不是 import map 中的 specifier。
                    ...resolveDependencies(normalizedFile, otherDeps, {
                      hostId: file,
                      hostType: 'js',
                    }),
                    ...cssDeps,
                  ]
                }

                depsArray = depsArray.map(
                  (dep) => importMapReverseMapping?.[dep] ?? dep,
                )

                let renderedDeps: number[]
                if (renderBuiltUrl) {
                  renderedDeps = depsArray.map((dep) => {
                    const replacement = toOutputFilePathInJS(
                      this.environment,
                      dep,
                      'asset',
                      chunk.fileName,
                      'js',
                      toRelativePath,
                    )

                    if (typeof replacement === 'string') {
                      return addFileDep(replacement)
                    }

                    return addFileDep(replacement.runtime, true)
                  })
                } else {
                  renderedDeps = depsArray.map((d) =>
                    // 相对 base 下不保留默认 assetsDir 前缀；preload helper 会结合当前
                    // importer URL 重新构造完整路径。
                    isRelativeBase
                      ? addFileDep(toRelativePath(d, file))
                      : addFileDep(d),
                  )
                }

                s.update(
                  markerStartPos,
                  markerStartPos + preloadMarker.length,
                  renderedDeps.length > 0
                    ? `__vite__mapDeps([${renderedDeps.join(',')}])`
                    : `[]`,
                )
                rewroteMarkerStartPos.add(markerStartPos)
              }
            }
          }

          if (fileDeps.length > 0) {
            const fileDepsCode = `[${fileDeps
              .map((fileDep) =>
                fileDep.runtime ? fileDep.url : JSON.stringify(fileDep.url),
              )
              .join(',')}]`

            const mapDepsCode = `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=${fileDepsCode})))=>i.map(i=>d[i]);\n`

            // 依赖表映射器放文件头；存在 hashbang 时必须插到其下一行。
            if (code.startsWith('#!')) {
              s.prependLeft(getFileStartIndex(code), mapDepsCode)
            } else {
              s.prepend(mapDepsCode)
            }
          }

          // 动态 import 被内联后可能只剩 marker；所有未成功配对的 marker 统一替换为 void 0。
          let markerStartPos = findPreloadMarker(code)
          while (markerStartPos >= 0) {
            if (!rewroteMarkerStartPos.has(markerStartPos)) {
              s.update(
                markerStartPos,
                markerStartPos + preloadMarker.length,
                'void 0',
              )
            }
            markerStartPos = findPreloadMarker(
              code,
              markerStartPos + preloadMarker.length,
            )
          }

          if (s.hasChanged()) {
            chunk.code = s.toString()
            if (buildSourcemap && chunk.map) {
              const nextMap = s.generateMap({
                source: chunk.fileName,
                hires: 'boundary',
              })
              const originalFile = chunk.map.file
              const map = combineSourcemaps(chunk.fileName, [
                nextMap as RawSourceMap,
                chunk.map as RawSourceMap,
              ]) as SourceMap
              map.toUrl = () => genSourceMapUrl(map)
              if (originalFile) {
                map.file = originalFile
              }

              const originalDebugId = chunk.map.debugId
              chunk.map = map

              if (buildSourcemap === 'inline') {
                chunk.code = chunk.code.replace(
                  convertSourceMap.mapFileCommentRegex,
                  '',
                )
                chunk.code += `\n//# sourceMappingURL=${genSourceMapUrl(map)}`
              } else {
                if (originalDebugId) {
                  map.debugId = originalDebugId
                }
                const mapAsset = bundle[chunk.fileName + '.map']
                if (mapAsset && mapAsset.type === 'asset') {
                  mapAsset.source = map.toString()
                }
              }
            }
          }
        }
      }
    },
  }

  return [
    plugin,
    perEnvironmentPlugin('native:import-analysis-build', (environment) => {
      const preloadCode = getPreloadCode(
        environment,
        !!renderBuiltUrl,
        isRelativeBase,
      )
      return nativeBuildImportAnalysisPlugin({
        preloadCode,
        insertPreload: getInsertPreload(environment),
        // 原生插件当前仍要求该字段，先传固定值保持协议完整。
        optimizeModulePreloadRelativePaths: false,
        renderBuiltUrl: !!renderBuiltUrl,
        isRelativeBase,
      })
    }),
  ]
}
