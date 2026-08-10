import path from 'node:path'
import type { ImportKind, Plugin, RolldownPlugin } from 'rolldown'
import { prefixRegex } from 'rolldown/filter'
import MagicString from 'magic-string'
import { stripLiteral } from 'strip-literal'
import { JS_TYPES_RE, KNOWN_ASSET_TYPES } from '../constants'
import type { PackageCache } from '../packages'
import {
  escapeRegex,
  flattenId,
  isBuiltin,
  isCSSRequest,
  isDataUrl,
  isExternalUrl,
  isNodeBuiltin,
  moduleListContains,
  normalizePath,
} from '../utils'
import { browserExternalId, optionalPeerDepId } from '../plugins/resolve'
import { isModuleCSSRequest } from '../plugins/css'
import type { Environment } from '../environment'
import { createBackCompatIdResolver } from '../idResolver'
import { isWindows } from '../../shared/utils'
import { hasViteIgnoreRE } from '../plugins/importAnalysis'
import { assetImportMetaUrlRE } from '../plugins/assetImportMetaUrl'

/** require 资源进入 ESM facade 前使用的临时虚拟 namespace。 */
const externalWithConversionNamespace =
  'vite:dep-pre-bundle:external-conversion'
/** facade 二次解析时用于标记“现在可以 external”的 ID 前缀。 */
const convertedExternalPrefix = 'vite-dep-pre-bundle-external:'

/** browser 平台下把 external require 转成 ESM import 的 facade namespace。 */
const cjsExternalFacadeNamespace = 'vite:cjs-external-facade'
/** facade 内部再次引用真实 external 时避免递归套 facade 的前缀。 */
const nonFacadePrefix = 'vite-cjs-external-facade:'

/** 默认不交给 JS 依赖预构建的资源、样式、SFC 与歧义脚本扩展名。 */
const externalTypes = [
  'css',
  // 支持的 CSS 预处理类型。
  'less',
  'sass',
  'scss',
  'styl',
  'stylus',
  'pcss',
  'postcss',
  // WASM。
  'wasm',
  // 已知 SFC 类型。
  'vue',
  'svelte',
  'marko',
  'astro',
  'imba',
  // JSX/TSX 可能由用户配置成不同编译语义，默认也 externalize。
  'jsx',
  'tsx',
  ...KNOWN_ASSET_TYPES,
]

/** 可选 peer 缺失时生成运行期诊断模块的 namespace。 */
const optionalPeerDepNamespace = 'optional-peer-dep:'
/** client builtin external 生成浏览器兼容代理模块的 namespace。 */
const browserExternalNamespace = 'browser-external:'

/**
 * 依赖预构建插件组：以 Vite 的 ESM/require resolver 读取扁平虚拟入口，externalize 资源/内建/
 * 可选 peer，桥接 CJS require 的资源与 external，并修正依赖内 `new URL(..., import.meta.url)` 路径。
 */
export function rolldownDepPlugin(
  environment: Environment,
  qualified: Record<string, string>,
  external: string[],
): RolldownPlugin[] {
  const { isProduction } = environment.config
  const { extensions } = environment.config.optimizeDeps

  // 用户显式声明可优化扩展名时，从默认 external 类型移除。
  const allExternalTypes = extensions
    ? externalTypes.filter((type) => !extensions.includes('.' + type))
    : externalTypes

  // 优化器会密集遍历 node_modules，使用独立 ESM/CJS package cache；避免把这些短期路径缓存塞进主
  // Vite cache，主进程之后通常不会再次深入同样目录。
  const esmPackageCache: PackageCache = new Map()
  const cjsPackageCache: PackageCache = new Map()

  /** 按 import/require 语法选择直接 external 或 require→import facade。 */
  const resolveAssets = (resolved: string, kind: ImportKind) => {
    if (kind === 'require-call') {
      // require 资源先进入虚拟 facade 转成 import，不能在此直接 external。
      return {
        id: externalWithConversionNamespace + resolved,
      }
    }
    return {
      id: resolved,
      external: 'absolute' as const,
    }
  }

  // 默认 resolver 偏好 ESM 条件。
  const _resolve = createBackCompatIdResolver(environment.getTopLevelConfig(), {
    asSrc: false,
    scan: true,
    packageCache: esmPackageCache,
  })

  // require resolver 使用 Node/CJS 条件。
  const _resolveRequire = createBackCompatIdResolver(
    environment.getTopLevelConfig(),
    {
      asSrc: false,
      isRequire: true,
      scan: true,
      packageCache: cjsPackageCache,
    },
  )

  /** 使用与语法类别匹配的 Vite ESM/CJS resolver 解析依赖子引用。 */
  const resolve = (
    id: string,
    importer: string | undefined,
    kind: ImportKind,
  ): Promise<string | undefined> => {
    // 扁平入口 ID 先映回真实 src，才能从正确 package 目录解析子依赖。
    const _importer =
      importer && importer in qualified ? qualified[importer] : importer
    const resolver = kind.startsWith('require') ? _resolveRequire : _resolve
    return resolver(environment, id, _importer)
  }

  /** 把 Vite resolver 结果分类为浏览器 external、可选 peer、资源、URL 或普通文件。 */
  const resolveResult = (id: string, resolved: string, kind: ImportKind) => {
    if (resolved.startsWith(browserExternalId)) {
      return {
        id: browserExternalNamespace + id,
      }
    }
    if (resolved.startsWith(optionalPeerDepId)) {
      return {
        id: optionalPeerDepNamespace + resolved,
      }
    }
    if (allExternalTypesReg.test(resolved)) {
      return resolveAssets(resolved, kind)
    }
    if (isBuiltin(environment.config.resolve.builtins, resolved)) {
      return
    }
    if (isExternalUrl(resolved)) {
      return {
        id: resolved,
        external: 'absolute',
      }
    }
    return {
      id: path.resolve(resolved),
    }
  }

  const allExternalTypesReg = new RegExp(
    `\\.(` + allExternalTypes.join('|') + `)(\\?.*)?$`,
  )

  /** 把扁平虚拟入口 ID 映回 Vite 预先选定的真实依赖入口。 */
  function resolveEntry(id: string) {
    const flatId = flattenId(id)
    if (flatId in qualified) {
      return {
        id: qualified[flatId],
      }
    }
  }

  const bundleOutputDir = path.join(environment.config.cacheDir, 'deps')

  return [
    {
      name: 'vite:dep-pre-bundle-assets',
      // 静态资源/常见非 JS externalize；require→import 转换背景见 #8459。
      resolveId: {
        filter: { id: allExternalTypesReg },
        /** 解析资源最终文件，避免包名/extension fallback 被仅按原 ID 误判。 */
        async handler(id, importer, options) {
          const kind = options.kind
          // 带 converted 前缀表示 facade 已把 require 转成 import，此次可真正 external。
          if (id.startsWith(convertedExternalPrefix)) {
            return {
              id: id.slice(convertedExternalPrefix.length),
              external: 'absolute',
            }
          }

          const resolved = await resolve(id, importer, kind)
          if (resolved) {
            // raw ID 虽像资源，CJS extension fallback 可能解析到 JS（`./test.pdf.js`），包名也可含
            // `.pdf`；最终 resolved 是 JS 时必须继续打包。
            if (JS_TYPES_RE.test(resolved)) {
              return {
                // Windows 上统一为反斜杠，兼容两打包器路径行为差异：
                // https://github.com/sapphi-red-repros/rolldown-esbuild-path-normalization
                id: isWindows ? resolved.replaceAll('/', '\\') : resolved,
                external: false,
              }
            }
            return resolveAssets(resolved, kind)
          }
        },
      },
      load: {
        filter: {
          id: prefixRegex(externalWithConversionNamespace),
        },
        /** 生成 require 资源转为 ESM import/re-export 的一次性 facade。 */
        handler(id) {
          const path = id.slice(externalWithConversionNamespace.length)
          // facade 用带前缀 import 自身，下一次 resolve 才标 external，完成 require→import 转换。
          const modulePath = `"${convertedExternalPrefix}${path}"`
          return {
            code:
              isCSSRequest(path) && !isModuleCSSRequest(path)
                ? `import ${modulePath};`
                : `export { default } from ${modulePath};` +
                  `export * from ${modulePath};`,
          }
        },
      },
    },
    {
      name: 'vite:dep-pre-bundle',
      // 本轮构建结束释放优化器专用 package caches。
      /** 本轮构建结束后释放优化器专用 ESM/CJS package cache。 */
      buildEnd() {
        esmPackageCache.clear()
        cjsPackageCache.clear()
      },
      resolveId: {
        filter: { id: /^[\w@][^:]/ },
        /** 解析预构建入口与子依赖，并应用 external/内建/资源分类。 */
        async handler(id, importer, options) {
          const kind = options.kind

          if (moduleListContains(external, id)) {
            return {
              id: id,
              external: 'absolute',
            }
          }

          // 入口必须使用 Vite 预先选定的真实路径，而不是让 Rolldown 再次自行解析。
          let entry:
            | {
                /** Vite 预先解析的真实入口路径。 */
                id: string
              }
            | undefined
          // 无 importer 表示入口；同时兼容 alias 后命中扁平入口。
          if (!importer) {
            if ((entry = resolveEntry(id))) return entry
            // alias 后若命中已知入口，也使用同一真实 entry。
            const aliased = await _resolve(environment, id, undefined, true)
            if (aliased && (entry = resolveEntry(aliased))) {
              return entry
            }
          }

          // 子依赖统一复用 Vite resolver 与 Environment 条件。
          const resolved = await resolve(id, importer, kind)
          if (resolved) {
            return resolveResult(id, resolved, kind)
          }
        },
      },
      load: {
        filter: {
          id: [
            prefixRegex(browserExternalNamespace),
            prefixRegex(optionalPeerDepNamespace),
          ],
        },
        /** 为 browser builtin 或缺失 optional peer 生成运行时诊断模块。 */
        handler(id) {
          if (id.startsWith(browserExternalNamespace)) {
            const path = id.slice(browserExternalNamespace.length)
            if (isProduction) {
              return {
                code: 'module.exports = {}',
              }
            } else {
              return {
                // 用 CJS 才能拦截 named import。Proxy 放在 prototype 是为适配 CJS→ESM 流程：打包器
                // 以 `Object.create(Object.getPrototypeOf(module.exports))` 建 namespace，再复制自有属性。
                // 若 module.exports 直接是无属性 Proxy，最终会得到普通空对象；Proxy 作为原型则第一步
                // 已返回可拦截对象。跳过打包器/DevTools 自己探测的内部 key，避免噪声警告。
                code: `\
    module.exports = Object.create(new Proxy({}, {
        get(_, key) {
        if (
            key !== '__esModule' &&
            key !== '__proto__' &&
            key !== 'constructor' &&
            key !== 'splice'
        ) {
            console.warn(\`Module "${path}" has been externalized for browser compatibility. Cannot access "${path}.\${key}" in client code. See https://vite.dev/guide/troubleshooting.html#module-externalized-for-browser-compatibility for more details.\`)
        }
        }
    }))`,
              }
            }
          }

          if (id.startsWith(optionalPeerDepNamespace)) {
            const path = id.slice(optionalPeerDepNamespace.length)
            const [, peerDep, parentDep] = path.split(':')
            return {
              code:
                'module.exports = {};' +
                `throw new Error(\`Could not resolve "${peerDep}" imported by "${parentDep}". Is it installed?\`)`,
            }
          }
        },
      },
      transform: {
        filter: {
          code: assetImportMetaUrlRE,
        },
        /** 把依赖内静态 `new URL` 改写为相对 deps 输出目录的稳定路径。 */
        handler(code, id) {
          let s: MagicString | undefined
          const re = new RegExp(assetImportMetaUrlRE)
          const cleanString = stripLiteral(code)

          let match: RegExpExecArray | null
          while ((match = re.exec(cleanString))) {
            const [[startIndex, endIndex], [urlStart, urlEnd]] =
              match.indices as Array<[number, number]>
            if (hasViteIgnoreRE.test(code.slice(startIndex, urlStart))) continue

            const rawUrl = code.slice(urlStart, urlEnd)

            if (rawUrl[0] === '`' && rawUrl.includes('${')) {
              // 动态模板需要 glob 枚举，交给主 asset 插件；优化器暂不重复该复杂转换。
              continue
            }

            const url = rawUrl.slice(1, -1)
            if (isDataUrl(url) || isExternalUrl(url) || url.startsWith('/')) {
              continue
            }

            if (!s) s = new MagicString(code)

            // 先相对原依赖文件解析资源，再改写为相对 deps 输出目录，使移动后的预构建 bundle 仍指向
            // 正确原资源。
            const absolutePath = path.resolve(path.dirname(id), url)
            const relativePath = path.relative(bundleOutputDir, absolutePath)
            const normalizedRelativePath = normalizePath(relativePath)
            s.update(
              startIndex,
              endIndex,
              // 加 `'' +` 阻止 Rolldown 再次接管此 new URL：
              // https://github.com/rolldown/rolldown/issues/2745
              `new URL('' + ${JSON.stringify(
                normalizedRelativePath,
              )}, import.meta.url)`,
            )
          }

          if (s) {
            return {
              code: s.toString(),
              map: s.generateMap({ hires: 'boundary' }),
            }
          }
        },
      },
    },
  ]
}

/** 把 external ID 转为只匹配完整 specifier 的正则片段。 */
const matchesEntireLine = (text: string) => `^${escapeRegex(text)}$`

/**
 * browser platform 下给 external CJS require 建 facade；Rolldown/esbuild 对 external `require('foo')`
 * 不会自动转成 import，而浏览器没有 require。
 *
 * https://rolldown.rs/in-depth/bundling-cjs#require-external-modules
 */
export function rolldownCjsExternalPlugin(
  externals: string[],
  platform: 'node' | 'browser' | 'neutral',
): Plugin | undefined {
  // Node 原生支持 require，保留比转换为 import 更准确。
  if (platform === 'node') {
    return undefined
  }
  // neutral 无法判断目标是否有 require，保守不改写。
  if (platform === 'neutral') {
    return undefined
  }

  // browser 没有 require，必须通过 facade 变成 import 才能运行。
  platform satisfies 'browser'

  const filter = new RegExp(externals.map(matchesEntireLine).join('|'))

  return {
    name: 'cjs-external',
    resolveId: {
      filter: { id: [prefixRegex(nonFacadePrefix), filter] },
      /** 给 browser require external 建 facade，其他 import 保持绝对 external。 */
      handler(id, _importer, options) {
        if (id.startsWith(nonFacadePrefix)) {
          return {
            id: id.slice(nonFacadePrefix.length),
            external: 'absolute',
          }
        }
        if (options.kind === 'require-call') {
          return {
            id: cjsExternalFacadeNamespace + id,
          }
        }
        return {
          id,
          external: 'absolute',
        }
      },
    },
    load: {
      filter: { id: prefixRegex(cjsExternalFacadeNamespace) },
      /** 生成把 external ESM namespace 转为 CJS module.exports 的 facade。 */
      handler(id) {
        const idWithoutNamespace = id.slice(cjsExternalFacadeNamespace.length)
        return {
          code: `\
import * as m from ${JSON.stringify(nonFacadePrefix + idWithoutNamespace)};
module.exports = ${isNodeBuiltin(idWithoutNamespace) ? 'm.default' : '{ ...m }'};
`,
        }
      },
    },
  }
}
