import path from 'node:path'
import { URL } from 'node:url'
import type {
  OutputAsset,
  OutputBundle,
  OutputChunk,
  RollupError,
  SourceMapInput,
} from 'rolldown'
import MagicString from 'magic-string'
import colors from 'picocolors'
import type {
  DefaultTreeAdapterMap,
  ErrorCodes,
  ParserError,
  Token,
} from 'parse5'
import { stripLiteral } from 'strip-literal'
import escapeHtml from 'escape-html'
import type { MinimalPluginContextWithoutEnvironment, Plugin } from '../plugin'
import type { ViteDevServer } from '../server'
import {
  decodeURIIfPossible,
  encodeURIPath,
  generateCodeFrame,
  getHash,
  isCSSRequest,
  isDataUrl,
  isExternalUrl,
  normalizePath,
  partialEncodeURIPath,
  processSrcSet,
  removeLeadingSlash,
  unique,
} from '../utils'
import type { ResolvedConfig, ResolvedEnvironmentOptions } from '../config'
import { checkPublicFile } from '../publicDir'
import { BUNDLED_DEV_CLIENT_FILENAME } from '../constants'
import { toOutputFilePathInHtml } from '../build'
import { resolveEnvPrefix } from '../env'
import { cleanUrl } from '../../shared/utils'
import { perEnvironmentState } from '../environment'
import { getNodeAssetAttributes } from '../assetSource'
import type { Logger } from '../logger'
import {
  assetUrlRE,
  getPublicAssetFilename,
  publicAssetUrlRE,
  urlToBuiltUrl,
} from './asset'
import { cssBundleNameCache } from './css'
import { modulePreloadPolyfillId } from './modulePreloadPolyfill'

/** 记录 HTML 脚本资源 URL 在源码中的偏移范围及原始值。 */
interface ScriptAssetsUrl {
  /** 该片段在原始源码中的起始偏移。 */
  start: number
  /** 该片段在原始源码中的结束偏移。 */
  end: number
  /** 待加载或写入产物的资源 URL。 */
  url: string
}

/** 解析 HTML 代理模块 ID 中的文件哈希、索引与扩展名。 */
const htmlProxyRE =
  /[?&]html-proxy=?(?:&inline-css)?(?:&style-attr)?&index=(\d+)\.(?:js|css)$/
/** 识别 HTML 内联内容代理请求。 */
const isHtmlProxyRE = /[?&]html-proxy\b/

/** 识别要求返回内联 CSS 文本的内部查询参数。 */
const inlineCSSRE = /__VITE_INLINE_CSS__([a-z\d]{8}_\d+)__/g
// 前方不允许普通 `.`，避免把属性访问误认成动态 import；但允许 `...` 展开运算符。
const inlineImportRE =
  /(?<!(?<!\.\.)\.)\bimport\s*\(("(?:[^"]|(?<=\\)")*"|'(?:[^']|(?<=\\)')*')\)/dg
/** 识别 HTML 与 HTM 入口文件。 */
const htmlLangRE = /\.(?:html|htm)$/
/** 匹配 HTML 规范定义的空白字符。 */
const spaceRe = /[\t\n\f\r ]/

/** 定位 HTML 中的 import map 脚本标签。 */
const importMapRE =
  /[ \t]*<script[^>]*type\s*=\s*(?:"importmap"|'importmap'|importmap)[^>]*>.*?<\/script>/is
/** 定位 HTML 中 `type="module"` 的脚本标签。 */
const moduleScriptRE =
  /[ \t]*<script[^>]*type\s*=\s*(?:"module"|'module'|module)[^>]*>/i
/** 定位 HTML 中现有 modulepreload 链接，避免重复注入。 */
const modulePreloadLinkRE =
  /[ \t]*<link[^>]*rel\s*=\s*(?:"modulepreload"|'modulepreload'|modulepreload)[\s\S]*?>/i
/** 定位 import map 结束标签，使模块脚本可插入其后。 */
const importMapAppendRE = new RegExp(
  [moduleScriptRE, modulePreloadLinkRE].map((r) => r.source).join('|'),
  'i',
)

/** 判断 ID 是否是从 HTML 内联 JS/CSS 拆出的代理模块。 */
export const isHTMLProxy = (id: string): boolean => isHtmlProxyRE.test(id)

/** 判断请求路径是否以 .html/.htm 结尾。 */
export const isHTMLRequest = (request: string): boolean =>
  htmlLangRE.test(request)

/** HTML 代理源码缓存：config → HTML 文件路径 → 内联片段序号。 */
export const htmlProxyMap: WeakMap<
  ResolvedConfig,
  Map<
    string,
    {
      /** 转换后代码。 */
      code: string
      /** 与转换后代码对应的 sourcemap。 */
      map?: SourceMapInput
    }[]
  >
> = new WeakMap()

/**
 * HTML 内联 CSS 的转换结果缓存：`${hash(importer)}_${query.index}` → 转换后 CSS。
 * 例如 `hash(/vite/playground/assets/index.html)_1`。
 */
export const htmlProxyResult: Map<string, string> = new Map()

/**
 * 为 HTML 内联脚本/样式提供虚拟模块的 resolve/load，并强制保留其副作用。
 * 缓存在插件构造阶段初始化，避免多次 buildStart 清掉本轮仍需使用的片段（#6372）。
 */
export function htmlInlineProxyPlugin(config: ResolvedConfig): Plugin {
  // 必须在构造插件时初始化；buildStart 可能触发多次，放在那里会清空仍在使用的缓存。
  // https://github.com/vitejs/vite/issues/6372
  htmlProxyMap.set(config, new Map())
  return {
    name: 'vite:html-inline-proxy',

    resolveId: {
      filter: { id: isHtmlProxyRE },
      /** 声明 HTML 代理模块 ID，使内联脚本和样式可进入普通插件管线。 */
      handler(id) {
        return id
      },
    },

    load: {
      filter: { id: isHtmlProxyRE },
      /** 从当前环境的 HTML 代理缓存读取内联模块转换结果。 */
      handler(id) {
        const proxyMatch = htmlProxyRE.exec(id)
        if (proxyMatch) {
          const index = Number(proxyMatch[1])
          const file = cleanUrl(id)
          const url = file.replace(normalizePath(config.root), '')
          const result = htmlProxyMap.get(config)!.get(url)?.[index]
          if (result) {
            // 即使用户关闭 moduleSideEffects，也要保留 HTML 明确引用的内联模块。
            return { ...result, moduleSideEffects: true }
          } else {
            throw new Error(`No matching HTML proxy module found from ${id}`)
          }
        }
      },
    },
  }
}

/** 按 HTML 文件和片段序号登记内联代理源码，供 htmlInlineProxyPlugin.load 读取。 */
export function addToHTMLProxyCache(
  config: ResolvedConfig,
  filePath: string,
  index: number,
  result: {
    /** 内联代理经过插件管线转换后的模块代码。 */
    code: string;
    /** 转换结果对应的可选 sourcemap。 */
    map?: SourceMapInput
  },
): void {
  if (!htmlProxyMap.get(config)) {
    htmlProxyMap.set(config, new Map())
  }
  if (!htmlProxyMap.get(config)!.get(filePath)) {
    htmlProxyMap.get(config)!.set(filePath, [])
  }
  htmlProxyMap.get(config)!.get(filePath)![index] = result
}

/** 登记内联 CSS 经 CSS 插件处理后的文本，生成最终 HTML 时替换占位符。 */
export function addToHTMLProxyTransformResult(
  hash: string,
  code: string,
): void {
  htmlProxyResult.set(hash, code)
}

// 这些 `<link rel>` 资源不应在构建时内联。集合未列入：
// - `shortcut`：只适用于 IE < 9，应使用 `icon`；
// - `mask-icon`：Safari 12 起弃用；
// - `apple-touch-icon-precomposed`：只适用于 iOS < 7。
const noInlineLinkRels = new Set([
  'icon',
  'apple-touch-icon',
  'apple-touch-startup-image',
  'manifest',
])

/** 每份 HTML 的所有模块脚本是否均为 async；生成入口标签时保持执行语义。 */
export const isAsyncScriptMap: WeakMap<
  ResolvedConfig,
  Map<string, boolean>
> = new WeakMap()

/** parse5 的 element 类型守卫；注释、文本和 document 节点以 `#` 开头。 */
export function nodeIsElement(
  node: DefaultTreeAdapterMap['node'],
): node is DefaultTreeAdapterMap['element'] {
  return node.nodeName[0] !== '#'
}

/** 深度优先遍历 parse5 树；template 的真实子节点位于 content fragment。 */
function traverseNodes(
  node: DefaultTreeAdapterMap['node'],
  visitor: (node: DefaultTreeAdapterMap['node']) => void,
) {
  if (node.nodeName === 'template') {
    node = (node as DefaultTreeAdapterMap['template']).content
  }
  visitor(node)
  if (
    nodeIsElement(node) ||
    node.nodeName === '#document' ||
    node.nodeName === '#document-fragment'
  ) {
    node.childNodes.forEach((childNode) => traverseNodes(childNode, visitor))
  }
}

/** 把 parse5 错误码映射为 Vite 可展示的解析警告。 */
type ParseWarnings = Partial<Record<ErrorCodes, string>>

/**
 * 惰性加载 parse5、遍历 HTML，并把同类解析警告合并后交给 Vite logger。
 * 开启 scriptingEnabled:false 是为了连 `<noscript>` 内部也按 HTML 节点解析。
 */
export async function traverseHtml(
  html: string,
  filePath: string,
  warn: Logger['warn'],
  visitor: (node: DefaultTreeAdapterMap['node']) => void,
): Promise<void> {
  // 只有进入 HTML 管线时才加载解析器，缩短非 HTML 场景的启动路径。
  const { parse, ErrorCodes } = await import('parse5')
  const warnings: ParseWarnings = {}
  const ast = parse(html, {
    scriptingEnabled: false, // 解析 `<noscript>` 内部节点。
    sourceCodeLocationInfo: true,
    onParseError: (e: ParserError) => {
      handleParseError(e, ErrorCodes, html, filePath, warnings)
    },
  })
  traverseNodes(ast, visitor)

  for (const message of Object.values(warnings)) {
    warn(colors.yellow(`\n${message}`))
  }
}

/** 一次扫描提取 script 的 src、module、async 与 Vite 忽略语义及源码位置。 */
export function getScriptInfo(node: DefaultTreeAdapterMap['element']): {
  /** 脚本标签的 src 属性及其原始值。 */
  src: Token.Attribute | undefined
  /** src 属性在 HTML 源码中的精确位置。 */
  srcSourceCodeLocation: Token.Location | undefined
  /** 指示脚本是否声明为 ES module。 */
  isModule: boolean
  /** 指示脚本是否带 async 属性。 */
  isAsync: boolean
  /** 指示脚本是否要求跳过 Vite 转换。 */
  isIgnored: boolean
} {
  let src: Token.Attribute | undefined
  let srcSourceCodeLocation: Token.Location | undefined
  let isModule = false
  let isAsync = false
  let isIgnored = false
  for (const p of node.attrs) {
    if (p.prefix !== undefined) continue
    if (p.name === 'src') {
      if (!src) {
        src = p
        srcSourceCodeLocation = node.sourceCodeLocation?.attrs!.src
      }
    } else if (p.name === 'type' && p.value === 'module') {
      isModule = true
    } else if (p.name === 'async') {
      isAsync = true
    } else if (p.name === 'vite-ignore') {
      isIgnored = true
    }
  }
  return { src, srcSourceCodeLocation, isModule, isAsync, isIgnored }
}

/** 定位 HTML 属性等号后的首个引号或非空白字符。 */
const attrValueStartRE = /=\s*(.)/

/**
 * 仅替换 HTML 属性值而保留属性名、引号样式和周围空白；位置来自 parse5。
 */
export function overwriteAttrValue(
  s: MagicString,
  sourceCodeLocation: Token.Location,
  newValue: string,
): MagicString {
  const srcString = s.slice(
    sourceCodeLocation.startOffset,
    sourceCodeLocation.endOffset,
  )
  const valueStart = attrValueStartRE.exec(srcString)
  if (!valueStart) {
    // 只有具有明确 `=` 与值范围的属性才能安全局部覆盖。
    throw new Error(
      `[vite:html] internal error, failed to overwrite attribute value`,
    )
  }
  const wrapOffset = valueStart[1] === '"' || valueStart[1] === "'" ? 1 : 0
  const valueOffset = valueStart.index! + valueStart[0].length - 1
  s.update(
    sourceCodeLocation.startOffset + valueOffset + wrapOffset,
    sourceCodeLocation.endOffset - wrapOffset,
    newValue,
  )
  return s
}

/** 消费内部 Vite 忽略属性，避免把它泄露到最终 HTML。 */
export function removeViteIgnoreAttr(
  s: MagicString,
  sourceCodeLocation: Token.Location,
): MagicString {
  const loc = (sourceCodeLocation as Token.LocationWithAttributes).attrs?.[
    'vite-ignore'
  ]
  if (loc) {
    s.remove(loc.startOffset, loc.endOffset)
  }
  return s
}

/** 把 parse5 的位置/错误码整理为插件体系统一的 RollupError 形状。 */
function formatParseError(parserError: ParserError, id: string, html: string) {
  const formattedError = {
    code: parserError.code,
    message: `parse5 error code ${parserError.code}`,
    frame: generateCodeFrame(
      html,
      parserError.startOffset,
      parserError.endOffset,
    ),
    loc: {
      file: id,
      line: parserError.startLine,
      column: parserError.startCol,
    },
  } satisfies RollupError
  return formattedError
}

/**
 * 忽略浏览器可容忍且生态常见的宽松写法；其余 parse5 错误按错误码去重为警告。
 */
function handleParseError(
  parserError: ParserError,
  errorCodes: typeof ErrorCodes,
  html: string,
  filePath: string,
  warnings: ParseWarnings,
) {
  switch (parserError.code) {
    case errorCodes.missingDoctype:
      // 缺少 DOCTYPE 不妨碍 Vite 处理片段式 HTML。
      return
    case errorCodes.abandonedHeadElementChild:
      // 接受 head 中未显式闭合的元素。
      return
    case errorCodes.duplicateAttribute:
      // 接受重复属性（#5966）；采用第一项，与浏览器静默忽略后续属性一致。
      return
    case errorCodes.nonVoidHtmlElementStartTagWithTrailingSolidus:
      // 允许非 void 元素使用自闭合写法（#10439）。
      return
    case errorCodes.unexpectedQuestionMarkInsteadOfTagName:
      // 允许 `<?xml>` 声明与 `<?>` 空元素；lit 会生成后者：
      // https://github.com/lit/lit/issues/2470
      return
  }
  const parseError = formatParseError(parserError, filePath, html)
  warnings[parseError.code] ??=
    `Unable to parse HTML; ${parseError.message}\n` +
    ` at ${parseError.loc.file}:${parseError.loc.line}:${parseError.loc.column}\n` +
    parseError.frame
}

/**
 * 深度优先收集 chunk 及其静态依赖的 CSS，保证“依赖 CSS 在前、入口 CSS 在后”。
 * 缓存保存未按当前入口过滤的完整子图结果；返回值再用本轮 seenCss 去重，避免共享依赖从另一个
 * 入口读取缓存时丢失 CSS（#21298/#22017）。
 */
export function getCssFilesForChunk(
  chunk: OutputChunk,
  bundle: OutputBundle,
  analyzedImportedCssFiles: Map<OutputChunk, string[]>,
  seenChunks: Set<string> = new Set(),
  seenCss: Set<string> = new Set(),
): string[] {
  if (seenChunks.has(chunk.fileName)) {
    return []
  }
  seenChunks.add(chunk.fileName)

  if (analyzedImportedCssFiles.has(chunk)) {
    const files = analyzedImportedCssFiles.get(chunk)!
    const additionals = files.filter((file) => !seenCss.has(file))
    additionals.forEach((file) => seenCss.add(file))
    return additionals
  }

  // allFiles 用于跨入口缓存完整子图；filteredFiles 只返回本轮尚未输出的 CSS。
  const allFiles: string[] = []
  const filteredFiles: string[] = []
  chunk.imports.forEach((file) => {
    const importee = bundle[file]
    if (importee?.type === 'chunk') {
      const importeeCss = getCssFilesForChunk(
        importee,
        bundle,
        analyzedImportedCssFiles,
        seenChunks,
        seenCss,
      )
      filteredFiles.push(...importeeCss)
      // 写父级缓存时必须使用依赖的完整缓存，不能使用受当前 seenCss 污染的返回子集。
      if (analyzedImportedCssFiles.has(importee)) {
        allFiles.push(...analyzedImportedCssFiles.get(importee)!)
      } else {
        allFiles.push(...importeeCss)
      }
    }
  })

  chunk.viteMetadata!.importedCss.forEach((file) => {
    allFiles.push(file)
    if (!seenCss.has(file)) {
      seenCss.add(file)
      filteredFiles.push(file)
    }
  })

  analyzedImportedCssFiles.set(chunk, unique(allFiles))

  return filteredFiles
}

/**
 * 构建态 HTML 插件。
 * transform 阶段把模块脚本、样式和资源抽成入口 JS/代理模块；generateBundle 阶段依据真实 chunk
 * 图把入口脚本、modulepreload、CSS 与资源哈希写回 HTML，并最终以 asset 发出。
 */
export function buildHtmlPlugin(config: ResolvedConfig): Plugin {
  const [preHooks, normalHooks, postHooks] = resolveHtmlTransforms(
    config.plugins,
  )
  preHooks.unshift(injectCspNonceMetaTagHook(config))
  preHooks.unshift(preImportMapHook(config))
  preHooks.push(htmlEnvHook(config))
  postHooks.push(injectNonceAttributeTagHook(config))
  postHooks.push(postImportMapHook(config))
  const processedHtml = perEnvironmentState(() => new Map<string, string>())

  /** 判断 HTML 属性 URL 是否为外部、数据或已忽略地址，从而跳过资源处理。 */
  const isExcludedUrl = (url: string) =>
    url[0] === '#' || isExternalUrl(url) || isDataUrl(url)

  // 与 htmlInlineProxyPlugin 相同，按 config 初始化，不能被重复 buildStart 清空。
  isAsyncScriptMap.set(config, new Map())

  return {
    name: 'vite:build-html',

    /** 构建 HTML 转换只对客户端消费者启用。 */
    applyToEnvironment(environment) {
      return environment.config.isBundled
    },

    transform: {
      filter: { id: /\.html$/ },
      /** 解析 HTML，改写脚本与资源属性，并收集待注入入口和样式代理。 */
      async handler(html, id) {
        id = normalizePath(id)
        const relativeUrlPath = normalizePath(path.relative(config.root, id))
        const publicPath = `/${relativeUrlPath}`
        const publicBase = getBaseInHTML(relativeUrlPath, config)

        /** 把公共目录资源 URL 转为相对当前 HTML 输出位置的路径。 */
        const publicToRelative = (filename: string) => publicBase + filename
        /** 按 base 与 renderBuiltUrl 配置生成公共资源的最终 HTML URL。 */
        const toOutputPublicFilePath = (url: string) =>
          toOutputFilePathInHtml(
            url.slice(1),
            'public',
            relativeUrlPath,
            'html',
            config,
            publicToRelative,
          )
        // 删除节点时尽量连同该行前导空白/上一行换行删除，避免输出留下空行；若同一行前面还有
        // 内容，则只能从 `<` 开始，防止误删相邻文本。
        /** 计算节点起始位置并包含其前导空白，便于完整移除或替换标签。 */
        const nodeStartWithLeadingWhitespace = (
          node: DefaultTreeAdapterMap['node'],
        ) => {
          const startOffset = node.sourceCodeLocation!.startOffset
          if (startOffset === 0) return 0

          // startCol 为 1-based，减去它后会落到上一节点末尾的换行处。
          const lineStartOffset =
            startOffset - node.sourceCodeLocation!.startCol

          // <previous-line-node></previous-line-node>
          // <target-node></target-node>
          //
          // 目标是把上一行末尾换行作为待删节点的起点。
          //
          // <previous-node></previous-node>
          // <doubled-up-node></doubled-up-node><target-node></target-node>
          //
          // 若目标节点与上一换行之间还有非空内容，连行删除会伤及内容，必须退回节点起点。
          let isLineEmpty = false
          try {
            const line = s.slice(Math.max(0, lineStartOffset), startOffset)
            isLineEmpty = !line.trim()
          } catch {
            // sliced 区间已被 MagicString 删除时可能抛错；保守视为非空，不扩大删除范围。
          }

          return isLineEmpty ? lineStartOffset : startOffset
        }

        // 先执行 pre hooks；它们的输出才是随后 parse5 扫描的 HTML。
        html = await applyHtmlTransforms(html, preHooks, this, {
          path: publicPath,
          filename: id,
        })

        let js = ''
        const s = new MagicString(html)
        const scriptUrls: ScriptAssetsUrl[] = []
        const styleUrls: ScriptAssetsUrl[] = []
        let inlineModuleIndex = -1

        let everyScriptIsAsync = true
        let someScriptsAreAsync = false
        let someScriptsAreDefer = false

        const assetUrlsPromises: Promise<void>[] = []

        // 把每个资源 URL 交给 asset 插件生成构建占位符；空属性和对命名 output 的直接引用保留。
        const namedOutput = Object.keys(
          config.build.rolldownOptions.input || {},
        )
        /** 解析 HTML 资源属性，按内联规则返回 data URL、公共 URL 或构建占位符。 */
        const processAssetUrl = async (url: string, shouldInline?: boolean) => {
          if (
            url !== '' && // 空属性。
            !namedOutput.includes(url) && // 直接引用命名 output。
            !namedOutput.includes(removeLeadingSlash(url)) // 绝对 URL 也可能对应不带 `/` 的命名 output。
          ) {
            try {
              return await urlToBuiltUrl(this, url, id, shouldInline)
            } catch (e) {
              if (e.code !== 'ENOENT') {
                throw e
              }
            }
          }
          return url
        }

        const setModuleSideEffectPromises: Promise<void>[] = []
        await traverseHtml(html, id, config.logger.warn, (node) => {
          if (!nodeIsElement(node)) {
            return
          }

          let shouldRemove = false

          // script：模块脚本成为入口 import，内联模块成为 html-proxy，经典脚本只改写动态 import。
          if (node.nodeName === 'script') {
            const { src, srcSourceCodeLocation, isModule, isAsync, isIgnored } =
              getScriptInfo(node)

            if (isIgnored) {
              removeViteIgnoreAttr(s, node.sourceCodeLocation!)
            } else {
              const url = src && src.value
              const isPublicFile = !!(url && checkPublicFile(url, config))
              if (isPublicFile) {
                // publicDir 资源不入图/不打包，只重写为带 base 的最终公开路径。
                overwriteAttrValue(
                  s,
                  srcSourceCodeLocation!,
                  partialEncodeURIPath(toOutputPublicFilePath(url)),
                )
              }

              if (isModule) {
                inlineModuleIndex++
                if (url && !isExcludedUrl(url) && !isPublicFile) {
                  setModuleSideEffectPromises.push(
                    this.resolve(url, id).then((resolved) => {
                      if (!resolved) {
                        return Promise.reject(
                          new Error(`Failed to resolve ${url} from ${id}`),
                        )
                      }
                      // HTML 明确引用就是可观察副作用，即使全局关闭 sideEffects 也必须保留。
                      const moduleInfo = this.getModuleInfo(resolved.id)
                      if (moduleInfo) {
                        moduleInfo.moduleSideEffects = true
                      } else if (!resolved.external) {
                        return this.load({
                          ...resolved,
                          moduleSideEffects: true,
                        }).then(() => {})
                      }
                    }),
                  )
                  // 外链 module script 转成 HTML 入口模块中的 side-effect import。
                  js += `\nimport ${JSON.stringify(url)}`
                  shouldRemove = true
                } else if (node.childNodes.length) {
                  const scriptNode =
                    node.childNodes.pop() as DefaultTreeAdapterMap['textNode']
                  const contents = scriptNode.value
                  // 内联 module script 缓存为带序号的 JS 代理模块，再由入口 import。
                  const filePath = id.replace(normalizePath(config.root), '')
                  addToHTMLProxyCache(config, filePath, inlineModuleIndex, {
                    code: contents,
                  })
                  js += `\nimport "${id}?html-proxy&index=${inlineModuleIndex}.js"`
                  shouldRemove = true
                }

                everyScriptIsAsync &&= isAsync
                someScriptsAreAsync ||= isAsync
                someScriptsAreDefer ||= !isAsync
              } else if (url && !isPublicFile) {
                if (!isExcludedUrl(url)) {
                  config.logger.warn(
                    `<script src="${url}"> in "${publicPath}" can't be bundled without type="module" attribute`,
                  )
                }
              } else if (node.childNodes.length) {
                const scriptNode =
                  node.childNodes.pop() as DefaultTreeAdapterMap['textNode']
                scriptUrls.push(
                  ...extractImportExpressionFromClassicScript(scriptNode),
                )
              }
            }
          }

          // 扫描 src/href/srcset 等资源属性；CSS link 转成入口 import，其他资源交给 asset 插件。
          const assetAttributes = getNodeAssetAttributes(
            node,
            config.html?.additionalAssetSources,
          )
          for (const attr of assetAttributes) {
            if (attr.type === 'remove') {
              s.remove(attr.location.startOffset, attr.location.endOffset)
              continue
            } else if (attr.type === 'srcset') {
              assetUrlsPromises.push(
                (async () => {
                  const processedEncodedUrl = await processSrcSet(
                    attr.value,
                    async ({ url }) => {
                      const decodedUrl = decodeURIIfPossible(url)
                      if (
                        decodedUrl !== undefined &&
                        !isExcludedUrl(decodedUrl)
                      ) {
                        const result = await processAssetUrl(url)
                        return result !== decodedUrl
                          ? encodeURIPath(result)
                          : url
                      }
                      return url
                    },
                  )
                  if (processedEncodedUrl !== attr.value) {
                    overwriteAttrValue(s, attr.location, processedEncodedUrl)
                  }
                })(),
              )
            } else if (attr.type === 'src') {
              const url = decodeURIIfPossible(attr.value)
              if (url === undefined) {
                // 无法解码的 URL 保持原样，让浏览器按原 HTML 处理。
              } else if (checkPublicFile(url, config)) {
                overwriteAttrValue(
                  s,
                  attr.location,
                  partialEncodeURIPath(toOutputPublicFilePath(url)),
                )
              } else if (!isExcludedUrl(url)) {
                if (
                  node.nodeName === 'link' &&
                  isCSSRequest(url) &&
                  // 含 media/disabled 的 stylesheet 有条件加载语义，不能转换为无条件 import（#6748）。
                  !('media' in attr.attributes || 'disabled' in attr.attributes)
                ) {
                  // 普通 stylesheet 转成入口 side-effect import，生成阶段再注入真实 CSS chunk。
                  const importExpression = `\nimport ${JSON.stringify(url)}`
                  styleUrls.push({
                    url,
                    start: nodeStartWithLeadingWhitespace(node),
                    end: node.sourceCodeLocation!.endOffset,
                  })
                  js += importExpression
                } else {
                  // 部分 link 资源必须保持独立文件：false 强制不内联；undefined 交回默认阈值策略。
                  const isNoInlineLink =
                    node.nodeName === 'link' &&
                    attr.attributes.rel &&
                    parseRelAttr(attr.attributes.rel).some((v) =>
                      noInlineLinkRels.has(v),
                    )
                  const shouldInline = isNoInlineLink ? false : undefined
                  assetUrlsPromises.push(
                    (async () => {
                      const processedUrl = await processAssetUrl(
                        url,
                        shouldInline,
                      )
                      if (processedUrl !== url) {
                        overwriteAttrValue(
                          s,
                          attr.location,
                          partialEncodeURIPath(processedUrl),
                        )
                      }
                    })(),
                  )
                }
              }
            }
          }

          const inlineStyle = findNeedTransformStyleAttribute(node)
          if (inlineStyle) {
            inlineModuleIndex++
            // style 属性含 url()/image-set() 时，用占位符替换并创建 CSS 代理 import。
            const code = inlineStyle.attr.value
            const filePath = id.replace(normalizePath(config.root), '')
            addToHTMLProxyCache(config, filePath, inlineModuleIndex, { code })
            // CSS 插件负责处理 URL，css-post 再把结果写入 htmlProxyResult。
            js += `\nimport "${id}?html-proxy&inline-css&style-attr&index=${inlineModuleIndex}.css"`
            const hash = getHash(cleanUrl(id))
            // 最终 normal/post HTML hooks 前，用 htmlProxyResult 替换此占位符。
            overwriteAttrValue(
              s,
              inlineStyle.location!,
              `__VITE_INLINE_CSS__${hash}_${inlineModuleIndex}__`,
            )
          }

          // `<style>` 同样抽成 CSS 代理，使其中 url() 进入正常 CSS/asset 管线。
          if (node.nodeName === 'style' && node.childNodes.length) {
            const styleNode =
              node.childNodes.pop() as DefaultTreeAdapterMap['textNode']
            const filePath = id.replace(normalizePath(config.root), '')
            inlineModuleIndex++
            addToHTMLProxyCache(config, filePath, inlineModuleIndex, {
              code: styleNode.value,
            })
            js += `\nimport "${id}?html-proxy&inline-css&index=${inlineModuleIndex}.css"`
            const hash = getHash(cleanUrl(id))
            // generateBundle 中执行 normal/post hooks 前替换转换结果。
            s.update(
              styleNode.sourceCodeLocation!.startOffset,
              styleNode.sourceCodeLocation!.endOffset,
              `__VITE_INLINE_CSS__${hash}_${inlineModuleIndex}__`,
            )
          }

          if (shouldRemove) {
            // 原 module script 已成为入口 import，先从 HTML 删除，生成 chunk 后再注入新标签。
            s.remove(
              nodeStartWithLeadingWhitespace(node),
              node.sourceCodeLocation!.endOffset,
            )
          }
        })

        isAsyncScriptMap.get(config)!.set(id, everyScriptIsAsync)

        if (someScriptsAreAsync && someScriptsAreDefer) {
          config.logger.warn(
            `\nMixed async and defer script modules in ${id}, output script will fallback to defer. Every script, including inline ones, need to be marked as async for your output script to be async.`,
          )
        }

        await Promise.all(assetUrlsPromises)

        // 经典内联脚本中的字面量 import() 不会进入入口图，只重写其资源 URL。
        for (const { start, end, url } of scriptUrls) {
          if (checkPublicFile(url, config)) {
            s.update(
              start,
              end,
              partialEncodeURIPath(toOutputPublicFilePath(url)),
            )
          } else if (!isExcludedUrl(url)) {
            s.update(
              start,
              end,
              partialEncodeURIPath(await urlToBuiltUrl(this, url, id)),
            )
          }
        }

        // stylesheet 无法 resolve 时撤回为它生成的 import，并保留原 link 给运行时处理。
        const resolvedStyleUrls = await Promise.all(
          styleUrls.map(async (styleUrl) => ({
            ...styleUrl,
            resolved: await this.resolve(styleUrl.url, id),
          })),
        )
        for (const { start, end, url, resolved } of resolvedStyleUrls) {
          if (resolved == null) {
            config.logger.warnOnce(
              `\n${url} doesn't exist at build time, it will remain unchanged to be resolved at runtime`,
            )
            const importExpression = `\nimport ${JSON.stringify(url)}`
            js = js.replace(importExpression, '')
          } else {
            s.remove(start, end)
          }
        }

        processedHtml(this).set(id, s.toString())

        // 仅存在模块脚本且配置启用时，把 modulepreload polyfill 加到入口开头。
        const { modulePreload } = this.environment.config.build
        if (
          modulePreload !== false &&
          modulePreload.polyfill &&
          (someScriptsAreAsync || someScriptsAreDefer)
        ) {
          js = `import "${modulePreloadPolyfillId}";\n${js}`
        }

        await Promise.all(setModuleSideEffectPromises)

        // HTML 入口不能与其他入口共享/摇掉；若最终只含可内联 imports，generateBundle 再删除空壳 chunk。
        return {
          code: js,
          map: { mappings: '' },
          moduleSideEffects: 'no-treeshake',
        }
      },
    },

    /** 按入口依赖图生成脚本、preload 与样式标签，并写回最终 HTML 资源。 */
    async generateBundle(options, bundle) {
      const analyzedImportedCssFiles = new Map<OutputChunk, string[]>()
      const inlineEntryChunk = new Set<string>()
      /** 按依赖图深度优先收集入口引用的 chunk，并避免重复 preload。 */
      const getImportedChunks = (
        chunk: OutputChunk,
        seen: Set<string> = new Set(),
      ): (OutputChunk | string)[] => {
        const chunks: (OutputChunk | string)[] = []
        chunk.imports.forEach((file) => {
          const importee = bundle[file]
          if (importee) {
            if (importee.type === 'chunk' && !seen.has(file)) {
              seen.add(file)

              // 后序遍历保证依赖先于 importer，内联为多个 script 时仍保持执行顺序。
              chunks.push(...getImportedChunks(importee, seen))
              chunks.push(importee)
            }
          } else {
            // external import 没有 bundle chunk，直接保留 URL。
            chunks.push(file)
          }
        })
        return chunks
      }

      /** 把入口 chunk 转为带 module、crossorigin 与最终 URL 的脚本标签。 */
      const toScriptTag = (
        chunkOrUrl: OutputChunk | string,
        toOutputPath: (filename: string) => string,
        isAsync: boolean,
      ): HtmlTagDescriptor => ({
        tag: 'script',
        attrs: {
          ...(isAsync ? { async: true } : {}),
          type: 'module',
          // crossorigin 不只服务跨域资源，也使脚本可与 preload 复用同一凭据模式。早期模块脚本默认
          // omit 且属性无法显式表达；规范现已改为 same-origin，因此这里统一添加。
          // https://developer.chrome.com/blog/modulepreload/#ok-so-why-doesnt-link-relpreload-work-for-modules:~:text=For%20%3Cscript%3E,of%20other%20modules.
          // 规范变更：https://github.com/whatwg/html/pull/3656#:~:text=Module%20scripts%20are%20always%20fetched%20with%20credentials%20mode%20%22same%2Dorigin%22%20by%20default%20and%20can%20no%20longer%0Ause%20%22omit%22
          crossorigin: true,
          src:
            typeof chunkOrUrl === 'string'
              ? chunkOrUrl
              : toOutputPath(chunkOrUrl.fileName),
        },
      })

      /** 把依赖 chunk 转为 modulepreload 链接标签。 */
      const toPreloadTag = (
        filename: string,
        toOutputPath: (filename: string) => string,
      ): HtmlTagDescriptor => ({
        tag: 'link',
        attrs: {
          rel: 'modulepreload',
          crossorigin: true,
          href: toOutputPath(filename),
        },
      })

      /** 把 CSS 产物转换为 stylesheet 链接标签。 */
      const toStyleSheetLinkTag = (
        file: string,
        toOutputPath: (filename: string) => string,
      ): HtmlTagDescriptor => ({
        tag: 'link',
        attrs: {
          rel: 'stylesheet',
          crossorigin: true,
          href: toOutputPath(file),
        },
      })

      /** 递归收集 chunk 关联的 CSS 产物，并转换为去重的 link 标签。 */
      const getCssTagsForChunk = (
        chunk: OutputChunk,
        toOutputPath: (filename: string) => string,
      ) =>
        getCssFilesForChunk(chunk, bundle, analyzedImportedCssFiles).map(
          (file) => toStyleSheetLinkTag(file, toOutputPath),
        )

      for (const [normalizedId, html] of processedHtml(this)) {
        const relativeUrlPath = normalizePath(
          path.relative(config.root, normalizedId),
        )
        const assetsBase = getBaseInHTML(relativeUrlPath, config)
        /** 依据 HTML 输出位置、base 与运行时 URL 钩子生成最终引用路径。 */
        const toOutputFilePath = (
          filename: string,
          type: 'asset' | 'public',
        ) => {
          if (isExternalUrl(filename)) {
            return filename
          } else {
            return toOutputFilePathInHtml(
              filename,
              type,
              relativeUrlPath,
              'html',
              config,
              (filename) => assetsBase + filename,
            )
          }
        }

        /** 生成 HTML 中普通构建资源的最终引用路径。 */
        const toOutputAssetFilePath = (filename: string) =>
          toOutputFilePath(filename, 'asset')

        /** 生成 HTML 中公共目录资源的最终引用路径。 */
        const toOutputPublicAssetFilePath = (filename: string) =>
          toOutputFilePath(filename, 'public')

        const isAsync = isAsyncScriptMap.get(config)!.get(normalizedId)!

        let result = html

        // 通过 facadeModuleId 找回 transform 阶段由该 HTML 生成的入口 chunk。
        const chunk = Object.values(bundle).find(
          (chunk) =>
            chunk.type === 'chunk' &&
            chunk.isEntry &&
            chunk.facadeModuleId &&
            normalizePath(chunk.facadeModuleId) === normalizedId,
        ) as OutputChunk | undefined

        let canInlineEntry = false

        // 根据真实 chunk 图注入入口脚本、modulepreload 与关联 CSS。
        if (chunk) {
          // 入口可被消去的条件：输出为 ES module，且代码只含 side-effect import/注释/空白。
          // legacy 等非 ES 输出或含实际代码时必须保留入口 chunk。
          if (options.format === 'es' && isEntirelyImport(chunk.code)) {
            canInlineEntry = true
          }

          // 保留入口时：一个 script + 依赖 modulepreload；消去入口时：按后序给所有依赖注入 script。
          const imports = getImportedChunks(chunk)
          let assetTags: HtmlTagDescriptor[]
          if (canInlineEntry) {
            assetTags = imports.map((chunk) =>
              toScriptTag(chunk, toOutputAssetFilePath, isAsync),
            )
          } else {
            const { modulePreload } = this.environment.config.build
            assetTags = [toScriptTag(chunk, toOutputAssetFilePath, isAsync)]
            if (modulePreload !== false) {
              const resolveDependencies =
                typeof modulePreload === 'object' &&
                modulePreload.resolveDependencies
              const importsFileNames = imports
                .filter((chunkOrUrl) => typeof chunkOrUrl !== 'string')
                .map((chunk) => chunk.fileName)
              const resolvedDeps = resolveDependencies
                ? resolveDependencies(chunk.fileName, importsFileNames, {
                    hostId: relativeUrlPath,
                    hostType: 'html',
                  })
                : importsFileNames
              assetTags.push(
                ...resolvedDeps.map((i) =>
                  toPreloadTag(i, toOutputAssetFilePath),
                ),
              )
            }
          }
          assetTags.push(...getCssTagsForChunk(chunk, toOutputAssetFilePath))

          result = injectToHead(result, assetTags)
        }

        // bundled dev 的 HMR client 必须早于业务 chunk，注入到 head 最前。
        if (
          config.command === 'serve' &&
          this.environment.config.consumer === 'client' &&
          this.environment.config.isBundled
        ) {
          result = injectToHead(
            result,
            [
              {
                tag: 'script',
                attrs: {
                  type: 'module',
                  src: path.posix.join(
                    config.base,
                    BUNDLED_DEV_CLIENT_FILENAME,
                  ),
                },
              },
            ],
            true,
          )
        }

        // 关闭 cssCodeSplit 时没有逐 chunk CSS 元数据，改为注入唯一全局 CSS bundle。
        if (!this.environment.config.build.cssCodeSplit) {
          const cssBundleName = cssBundleNameCache.get(config)
          const cssChunk =
            cssBundleName &&
            (Object.values(bundle).find(
              (chunk) =>
                chunk.type === 'asset' && chunk.names.includes(cssBundleName),
            ) as OutputAsset | undefined)
          if (cssChunk) {
            result = injectToHead(result, [
              {
                tag: 'link',
                attrs: {
                  rel: 'stylesheet',
                  crossorigin: true,
                  href: toOutputAssetFilePath(cssChunk.fileName),
                },
              },
            ])
          }
        }

        // 内联 CSS 只替换 HTML 占位符，不能再走会额外 emit 文件的 asset 插件。
        let match: RegExpExecArray | null
        let s: MagicString | undefined
        inlineCSSRE.lastIndex = 0
        while ((match = inlineCSSRE.exec(result))) {
          s ||= new MagicString(result)
          const { 0: full, 1: scopedName } = match
          const cssTransformedCode = htmlProxyResult.get(scopedName)!
          s.update(match.index, match.index + full.length, cssTransformedCode)
        }
        if (s) {
          result = s.toString()
        }
        result = await applyHtmlTransforms(
          result,
          [...normalHooks, ...postHooks],
          this,
          {
            path: '/' + relativeUrlPath,
            filename: normalizedId,
            bundle,
            chunk,
          },
        )
        // 将 asset/public 占位符解析为最终文件名/base，并登记入口 chunk 的 importedAssets。
        result = result.replace(assetUrlRE, (_, fileHash, postfix = '') => {
          const file = this.getFileName(fileHash)
          if (chunk) {
            chunk.viteMetadata!.importedAssets.add(cleanUrl(file))
          }
          return encodeURIPath(toOutputAssetFilePath(file)) + postfix
        })

        result = result.replace(publicAssetUrlRE, (_, fileHash) => {
          const publicAssetPath = toOutputPublicAssetFilePath(
            getPublicAssetFilename(fileHash, config)!,
          )

          return encodeURIPath(
            URL.canParse(publicAssetPath)
              ? publicAssetPath
              : normalizePath(publicAssetPath),
          )
        })

        if (chunk && canInlineEntry) {
          inlineEntryChunk.add(chunk.fileName)
        }

        const shortEmitName = normalizePath(
          path.relative(config.root, normalizedId),
        )
        this.emitFile({
          type: 'asset',
          originalFileName: normalizedId,
          fileName: shortEmitName,
          source: result,
        })
      }

      for (const fileName of inlineEntryChunk) {
        // 入口 imports 已全部变成 HTML 标签，删除无意义的入口空壳文件。
        delete bundle[fileName]
      }
    },
  }
}

/** 按 HTML 空白字符拆分 link.rel token，并统一小写。 */
export function parseRelAttr(attr: string): string[] {
  return attr.split(spaceRe).map((v) => v.toLowerCase())
}

/**
 * 找出含 url()/image-set() 的 style 属性；只有这类内联 CSS 需要变成虚拟模块以发出资源。
 */
export function findNeedTransformStyleAttribute(
  node: DefaultTreeAdapterMap['element'],
):
  {
      /** 需要进入 CSS 资源管线的 style 属性。 */
      attr: Token.Attribute;
      /** 该属性在 HTML 原文中的可选位置。 */
      location?: Token.Location
    }
  | undefined {
  const attr = node.attrs.find(
    (prop) =>
      prop.prefix === undefined &&
      prop.name === 'style' &&
      // 普通声明无需经过 CSS asset 管线。
      (prop.value.includes('url(') || prop.value.includes('image-set(')),
  )
  if (!attr) return undefined
  const location = node.sourceCodeLocation?.attrs?.style
  return { attr, location }
}

/**
 * 从经典内联脚本中提取字面量动态 import() 的 URL 区间。
 * stripLiteral 先屏蔽字符串/注释，正则再跳过属性访问 `.import()`，保留 `...import()`。
 */
export function extractImportExpressionFromClassicScript(
  scriptTextNode: DefaultTreeAdapterMap['textNode'],
): ScriptAssetsUrl[] {
  const startOffset = scriptTextNode.sourceCodeLocation!.startOffset
  const cleanCode = stripLiteral(scriptTextNode.value)

  const scriptUrls: ScriptAssetsUrl[] = []
  let match: RegExpExecArray | null
  inlineImportRE.lastIndex = 0
  while ((match = inlineImportRE.exec(cleanCode))) {
    const [, [urlStart, urlEnd]] = match.indices as Array<[number, number]>
    const start = urlStart + 1
    const end = urlEnd - 1
    scriptUrls.push({
      start: start + startOffset,
      end: end + startOffset,
      url: scriptTextNode.value.slice(start, end),
    })
  }
  return scriptUrls
}

/** 描述 HTML 转换钩子可注入的标签、属性、子内容与插入位置。 */
export interface HtmlTagDescriptor {
  /** 标签名，如 `script`、`link`、`meta`。 */
  tag: string
  /** 属性值序列化时会自动做 HTML 转义；true 输出布尔属性，false 不输出。 */
  attrs?: Record<string, string | boolean | undefined>
  /** 原始文本或递归标签列表。 */
  children?: string | HtmlTagDescriptor[]
  /** 注入位置；默认 `head-prepend`。 */
  injectTo?: 'head' | 'body' | 'head-prepend' | 'body-prepend'
}

/** transformIndexHtml hook 允许只返回 HTML、只返回标签，或同时返回二者。 */
export type IndexHtmlTransformResult =
  | string
  | HtmlTagDescriptor[]
  | {
      /** HTML 钩子返回的替换文本。 */
      html: string
      /** HTML 钩子要求额外注入的标签列表。 */
      tags: HtmlTagDescriptor[]
    }

/** 提供 HTML 转换钩子的路径、文件名、服务器与原始 bundle 上下文。 */
export interface IndexHtmlTransformContext {
  /** 对外服务的 URL path。 */
  path: string
  /** 对应磁盘文件名；虚拟/SSR 场景可能由调用方合成。 */
  filename: string
  /** 仅开发态提供，用于访问模块图、HMR 与配置。 */
  server?: ViteDevServer
  /** 仅构建 generateBundle 阶段提供。 */
  bundle?: OutputBundle
  /** 当前 HTML 对应入口 chunk，若入口不存在则为空。 */
  chunk?: OutputChunk
  /** SPA fallback 前的原始请求 URL，用于修正相对资源路径。 */
  originalUrl?: string
}

/** 单个 transformIndexHtml hook：可异步修改 HTML 或声明结构化注入标签。 */
export type IndexHtmlTransformHook = (
  this: MinimalPluginContextWithoutEnvironment,
  html: string,
  ctx: IndexHtmlTransformContext,
) => IndexHtmlTransformResult | void | Promise<IndexHtmlTransformResult | void>

/** 插件暴露的 transformIndexHtml 形式，并可用 order 进入 pre/normal/post 阶段。 */
export type IndexHtmlTransform =
  | IndexHtmlTransformHook
  | {
      /** HTML 钩子相对默认阶段的执行顺序。 */
      order?: 'pre' | 'post' | null
      /** 执行 HTML 转换并返回修改结果的钩子。 */
      handler: IndexHtmlTransformHook
    }

/** 若用户 import map 位于 module script/preload 后方，开发/构建前置阶段给出一次性警告。 */
export function preImportMapHook(
  config: ResolvedConfig,
): IndexHtmlTransformHook {
  return (html, ctx) => {
    const importMapIndex = html.search(importMapRE)
    if (importMapIndex < 0) return

    const importMapAppendIndex = html.search(importMapAppendRE)
    if (importMapAppendIndex < 0) return

    if (importMapAppendIndex < importMapIndex) {
      const relativeHtml = normalizePath(
        path.relative(config.root, ctx.filename),
      )
      config.logger.warnOnce(
        colors.yellow(
          colors.bold(
            `(!) <script type="importmap"> should come before <script type="module"> and <link rel="modulepreload"> in /${relativeHtml}`,
          ),
        ),
      )
    }
  }
}

/**
 * 把用户 import map 移到首个 module script/modulepreload 之前；构建启用 chunk import map 时，
 * 再注入打包器生成的 import map，并保证它拥有优先解析顺序。
 */
export function postImportMapHook(
  config: ResolvedConfig,
): IndexHtmlTransformHook {
  const decoder = new TextDecoder()
  return function (html, { bundle }) {
    const chunkImportMapEnabled =
      config.command === 'build' &&
      config.environments.client.build.chunkImportMap

    if (importMapAppendRE.test(html)) {
      let importMap: string | undefined
      html = html.replace(importMapRE, (match) => {
        importMap = match
        return ''
      })

      if (importMap) {
        html = html.replace(
          importMapAppendRE,
          (match) => `${importMap}\n${match}`,
        )
        if (chunkImportMapEnabled) {
          // 多 import map 在旧浏览器和 Firefox 中不受支持：
          // https://caniuse.com/mdn-html_elements_script_type_importmap_multiple_import_maps
          this.warn(
            `The \`build.chunkImportMap\` option is enabled but an import map also exists in the input HTML file.` +
              ` This leads to multiple import maps generated in the output HTML, which is not supported by older browsers and Firefox.`,
          )
        }
      }
    }

    if (chunkImportMapEnabled) {
      const nonce = config.html?.cspNonce
      const importMap = bundle![
        getImportMapFilename(config.environments.client)
      ] as OutputAsset
      const importMapHtml = serializeTag({
        tag: 'script',
        attrs: { type: 'importmap', ...(nonce ? { nonce } : {}) },
        children:
          typeof importMap.source === 'string'
            ? importMap.source
            : decoder.decode(importMap.source),
      })
      if (importMapAppendRE.test(html)) {
        // 生成的 chunk import map 放在用户 map 前，确保占位 chunk 映射优先生效。
        html = html.replace(
          importMapAppendRE,
          (match) => `${importMapHtml}\n${match}`,
        )
      } else {
        html = `${importMapHtml}\n${html}`
      }
    }

    return html
  }
}

/** 在 head 注入隐藏 nonce meta，供 Vite runtime 读取并应用到运行时创建的标签。 */
export function injectCspNonceMetaTagHook(
  config: ResolvedConfig,
): IndexHtmlTransformHook {
  return () => {
    if (!config.html?.cspNonce) return

    return [
      {
        tag: 'meta',
        injectTo: 'head',
        // nonce 属性按浏览器规则会隐藏实际值，避免通过普通 DOM 属性读取泄露。
        // https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/nonce#accessing_nonces_and_nonce_hiding
        attrs: { property: 'csp-nonce', nonce: config.html.cspNonce },
      },
    ]
  }
}

/**
 * 支持 HTML 中 `%ENV_NAME%` 替换，并合并用户对 `import.meta.env.*` 的 define。
 * 未定义但匹配 envPrefix 的变量会警告；非公开前缀占位符原样保留。
 */
export function htmlEnvHook(config: ResolvedConfig): IndexHtmlTransformHook {
  const pattern = /%(\S+?)%/g
  const envPrefix = resolveEnvPrefix({ envPrefix: config.envPrefix })
  const env: Record<string, any> = { ...config.env }

  // config.define 中的 import.meta.env.* 也应与 JS 环境变量表现一致。
  for (const key in config.define) {
    if (key.startsWith(`import.meta.env.`)) {
      const val = config.define[key]
      if (typeof val === 'string') {
        try {
          const parsed = JSON.parse(val)
          env[key.slice(16)] = typeof parsed === 'string' ? parsed : val
        } catch {
          env[key.slice(16)] = val
        }
      } else {
        env[key.slice(16)] = JSON.stringify(val)
      }
    }
  }
  return (html, ctx) => {
    return html.replace(pattern, (text, key) => {
      if (key in env) {
        return env[key]
      } else {
        if (envPrefix.some((prefix) => key.startsWith(prefix))) {
          const relativeHtml = normalizePath(
            path.relative(config.root, ctx.filename),
          )
          config.logger.warn(
            colors.yellow(
              colors.bold(
                `(!) ${text} is not defined in env variables found in /${relativeHtml}. ` +
                  `Is the variable mistyped?`,
              ),
            ),
          )
        }

        return text
      }
    })
  }
}

/** 给 script/style 和会主动加载资源的 link 标签补 CSP nonce，保留用户已提供的 nonce。 */
export function injectNonceAttributeTagHook(
  config: ResolvedConfig,
): IndexHtmlTransformHook {
  const processRelType = new Set(['stylesheet', 'modulepreload', 'preload'])

  return async (html, { filename }) => {
    const nonce = config.html?.cspNonce
    if (!nonce) return

    const s = new MagicString(html)

    await traverseHtml(html, filename, config.logger.warn, (node) => {
      if (!nodeIsElement(node)) {
        return
      }

      const { nodeName, attrs, sourceCodeLocation } = node

      if (
        nodeName === 'script' ||
        nodeName === 'style' ||
        (nodeName === 'link' &&
          attrs.some(
            (attr) =>
              attr.name === 'rel' &&
              parseRelAttr(attr.value).some((a) => processRelType.has(a)),
          ))
      ) {
        // 用户已声明 nonce 时不重复添加。
        if (attrs.some(({ name }) => name === 'nonce')) {
          return
        }

        const startTagEndOffset = sourceCodeLocation!.startTag!.endOffset

        // 自闭合 `/>` 要在 `/` 前插入；普通 `>` 只向左偏移一个字符。
        const appendOffset = html[startTagEndOffset - 2] === '/' ? 2 : 1

        s.appendRight(startTagEndOffset - appendOffset, ` nonce="${nonce}"`)
      }
    })

    return s.toString()
  }
}

/** 按插件顺序收集 transformIndexHtml，并分为 pre、normal、post 三组。 */
export function resolveHtmlTransforms(
  plugins: readonly Plugin[],
): [
  IndexHtmlTransformHook[],
  IndexHtmlTransformHook[],
  IndexHtmlTransformHook[],
] {
  const preHooks: IndexHtmlTransformHook[] = []
  const normalHooks: IndexHtmlTransformHook[] = []
  const postHooks: IndexHtmlTransformHook[] = []

  for (const plugin of plugins) {
    const hook = plugin.transformIndexHtml
    if (!hook) continue

    if (typeof hook === 'function') {
      normalHooks.push(hook)
    } else {
      const handler = hook.handler
      if (hook.order === 'pre') {
        preHooks.push(handler)
      } else if (hook.order === 'post') {
        postHooks.push(handler)
      } else {
        normalHooks.push(handler)
      }
    }
  }

  return [preHooks, normalHooks, postHooks]
}

// https://developer.mozilla.org/en-US/docs/Web/HTML/Element/head#see_also
const elementsAllowedInHead = new Set([
  'title',
  'base',
  'link',
  'style',
  'meta',
  'script',
  'noscript',
  'template',
])

/** 开发态检查注入 head 的标签是否合法；构建上下文无 server/logger 时静默跳过。 */
function headTagInsertCheck(
  tags: HtmlTagDescriptor[],
  ctx: IndexHtmlTransformContext,
) {
  if (!tags.length) return
  const { logger } = ctx.server?.config || {}
  const disallowedTags = tags.filter(
    (tagDescriptor) => !elementsAllowedInHead.has(tagDescriptor.tag),
  )

  if (disallowedTags.length) {
    const dedupedTags = unique(
      disallowedTags.map((tagDescriptor) => `<${tagDescriptor.tag}>`),
    )
    logger?.warn(
      colors.yellow(
        colors.bold(
          `[${dedupedTags.join(',')}] can not be used inside the <head> Element, please check the 'injectTo' value`,
        ),
      ),
    )
  }
}

/**
 * 串行执行 HTML hooks；每个 hook 都看到前一 hook 的 HTML，并把结构化标签按四个位置分组注入。
 */
export async function applyHtmlTransforms(
  html: string,
  hooks: IndexHtmlTransformHook[],
  pluginContext: MinimalPluginContextWithoutEnvironment,
  ctx: IndexHtmlTransformContext,
): Promise<string> {
  for (const hook of hooks) {
    const res = await hook.call(pluginContext, html, ctx)
    if (!res) {
      continue
    }
    if (typeof res === 'string') {
      html = res
    } else {
      let tags: HtmlTagDescriptor[]
      if (Array.isArray(res)) {
        tags = res
      } else {
        html = res.html || html
        tags = res.tags
      }

      let headTags: HtmlTagDescriptor[] | undefined
      let headPrependTags: HtmlTagDescriptor[] | undefined
      let bodyTags: HtmlTagDescriptor[] | undefined
      let bodyPrependTags: HtmlTagDescriptor[] | undefined

      for (const tag of tags) {
        switch (tag.injectTo) {
          case 'body':
            ;(bodyTags ??= []).push(tag)
            break
          case 'body-prepend':
            ;(bodyPrependTags ??= []).push(tag)
            break
          case 'head':
            ;(headTags ??= []).push(tag)
            break
          default:
            ;(headPrependTags ??= []).push(tag)
        }
      }
      headTagInsertCheck([...(headTags || []), ...(headPrependTags || [])], ctx)
      if (headPrependTags) html = injectToHead(html, headPrependTags, true)
      if (headTags) html = injectToHead(html, headTags)
      if (bodyPrependTags) html = injectToBody(html, bodyPrependTags, true)
      if (bodyTags) html = injectToBody(html, bodyTags)
    }
  }

  return html
}

/** 识别只含 import、注释和空白的模块代码。 */
const importOrCommentRE =
  /\s+|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$)|import\s*(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')\s*;*/y

/** 判断模块是否只有 import 与注释，用于安全移除空 HTML 代理 chunk。 */
function isEntirelyImport(code: string) {
  // 只接受 side-effect import，它与原 `<script type=module src>` 语义精确对应。极端语法下宁可
  // 假阴性而保留入口 chunk，也不能假阳性删掉实际代码。逐 token 消费可避免整段回溯（#22848）。
  importOrCommentRE.lastIndex = 0
  while (importOrCommentRE.lastIndex < code.length) {
    if (!importOrCommentRE.test(code)) {
      return false
    }
  }
  return true
}

/** 根据 HTML 相对路径和 base 配置计算当前页面使用的基础 URL。 */
function getBaseInHTML(urlRelativePath: string, config: ResolvedConfig) {
  // 显式绝对 base 优先；只有 `./` 或空 base 才按 HTML 层级计算相对资源前缀。
  return config.base === './' || config.base === ''
    ? path.posix.join(
        path.posix.relative(urlRelativePath, '').slice(0, -2),
        './',
      )
    : config.base
}

/** 定位 `</head>`，供默认 head 标签插入。 */
const headInjectRE = /([ \t]*)<\/head>/i
/** 定位 `<head>` 起始标签，供 head-prepend 标签插入。 */
const headPrependInjectRE = /([ \t]*)<head[^>]*>/i

/** 定位 `</html>`，作为缺少 head/body 时的注入回退点。 */
const htmlInjectRE = /<\/html>/i
/** 定位 `<html>` 起始标签，作为前置注入回退点。 */
const htmlPrependInjectRE = /([ \t]*)<html[^>]*>/i

/** 定位 `</body>`，供 body 标签插入。 */
const bodyInjectRE = /([ \t]*)<\/body>/i
/** 定位 `<body>` 起始标签，供 body-prepend 标签插入。 */
const bodyPrependInjectRE = /([ \t]*)<body[^>]*>/i

/** 定位 doctype 后方，作为文档缺少容器标签时的前置插入点。 */
const doctypePrependInjectRE = /<!doctype html>/i

/** 把标签序列注入 head 尾部；缺少 head 时按 body/html 层级回退。 */
function injectToHead(
  html: string,
  tags: HtmlTagDescriptor[],
  prepend = false,
) {
  if (tags.length === 0) return html

  if (prepend) {
    // head-prepend：放在 `<head>` 开标签之后。
    if (headPrependInjectRE.test(html)) {
      return html.replace(
        headPrependInjectRE,
        (match, p1) => `${match}\n${serializeTags(tags, incrementIndent(p1))}`,
      )
    }
  } else {
    // head：放在 `</head>` 之前。
    if (headInjectRE.test(html)) {
      // 继承闭合标签所在行的缩进。
      return html.replace(
        headInjectRE,
        (match, p1) => `${serializeTags(tags, incrementIndent(p1))}${match}`,
      )
    }
    // 无 head 但有 body 时，head 标签放在 `<body>` 之前。
    if (bodyPrependInjectRE.test(html)) {
      return html.replace(
        bodyPrependInjectRE,
        (match, p1) => `${serializeTags(tags, p1)}\n${match}`,
      )
    }
  }
  // 完全没有 head 时，prepend 与 append 都走文档头部回退。
  return prependInjectFallback(html, tags)
}

/** 把标签序列注入 body 尾部；缺少 body 时回退到 html 或文档末尾。 */
function injectToBody(
  html: string,
  tags: HtmlTagDescriptor[],
  prepend = false,
) {
  if (tags.length === 0) return html

  if (prepend) {
    // body-prepend：放在 `<body>` 开标签之后。
    if (bodyPrependInjectRE.test(html)) {
      return html.replace(
        bodyPrependInjectRE,
        (match, p1) => `${match}\n${serializeTags(tags, incrementIndent(p1))}`,
      )
    }
    // 无 body 时先尝试放在 `</head>` 后，再退回文档头部。
    if (headInjectRE.test(html)) {
      return html.replace(
        headInjectRE,
        (match, p1) => `${match}\n${serializeTags(tags, p1)}`,
      )
    }
    return prependInjectFallback(html, tags)
  } else {
    // body：放在 `</body>` 之前。
    if (bodyInjectRE.test(html)) {
      return html.replace(
        bodyInjectRE,
        (match, p1) => `${serializeTags(tags, incrementIndent(p1))}${match}`,
      )
    }
    // 无 body 时放在 `</html>` 前；连 html 都没有则追加到文件尾。
    if (htmlInjectRE.test(html)) {
      return html.replace(htmlInjectRE, `${serializeTags(tags)}\n$&`)
    }
    return html + `\n` + serializeTags(tags)
  }
}

/** 在缺少标准 HTML 容器时，把标签插入 doctype 后或文档开头。 */
function prependInjectFallback(html: string, tags: HtmlTagDescriptor[]) {
  // 回退优先级：`<html>` 后 → doctype 后 → 文档起点。
  if (htmlPrependInjectRE.test(html)) {
    return html.replace(htmlPrependInjectRE, `$&\n${serializeTags(tags)}`)
  }
  if (doctypePrependInjectRE.test(html)) {
    return html.replace(doctypePrependInjectRE, `$&\n${serializeTags(tags)}`)
  }
  return serializeTags(tags) + html
}

/** 保存无需闭合标签的 HTML 元素，序列化时不输出结束标签。 */
const unaryTags = new Set(['link', 'meta', 'base'])

/** 按描述对象序列化单个 HTML 标签，并处理一元标签与缩进。 */
function serializeTag(
  { tag, attrs, children }: HtmlTagDescriptor,
  indent: string = '',
): string {
  if (unaryTags.has(tag)) {
    return `<${tag}${serializeAttrs(attrs)}>`
  } else {
    return `<${tag}${serializeAttrs(attrs)}>${serializeTags(
      children,
      incrementIndent(indent),
    )}</${tag}>`
  }
}

/** 按当前缩进批量序列化 HTML 标签列表。 */
function serializeTags(
  tags: HtmlTagDescriptor['children'],
  indent: string = '',
): string {
  if (typeof tags === 'string') {
    return tags
  } else if (tags && tags.length) {
    return tags.map((tag) => `${indent}${serializeTag(tag, indent)}\n`).join('')
  }
  return ''
}

/** 把属性对象序列化为 HTML 属性串，并转义双引号。 */
function serializeAttrs(attrs: HtmlTagDescriptor['attrs']): string {
  let res = ''
  for (const key in attrs) {
    if (typeof attrs[key] === 'boolean') {
      res += attrs[key] ? ` ${key}` : ``
    } else {
      res += ` ${key}="${escapeHtml(attrs[key])}"`
    }
  }
  return res
}

/** 在已有缩进基础上增加一级，同时保留制表符或空格风格。 */
function incrementIndent(indent: string = '') {
  return `${indent}${indent[0] === '\t' ? '\t' : '  '}`
}

/** 获取 Rolldown chunk import map 的配置文件名，默认 `importmap.json`。 */
export function getImportMapFilename(
  options: ResolvedEnvironmentOptions,
): string {
  const chunkImportMap =
    options.build.rolldownOptions.experimental?.chunkImportMap
  if (typeof chunkImportMap === 'object' && chunkImportMap.fileName) {
    return chunkImportMap.fileName
  }
  return 'importmap.json'
}

/** 按 base 与相对路径模式计算 import map 中资源的基准 URL。 */
function getImportMapBaseUrl(options: ResolvedEnvironmentOptions): string {
  const chunkImportMap =
    options.build.rolldownOptions.experimental?.chunkImportMap
  if (typeof chunkImportMap === 'object' && chunkImportMap.baseUrl) {
    return chunkImportMap.baseUrl
  }
  return '/'
}

/**
 * 从 bundle 读取并解析 chunk import map asset；不存在时返回 undefined。
 * mapping 会去掉 base，得到“占位文件名 → 真实文件名”，供 HTML 资源替换使用。
 */
export function getImportMap(
  bundle: OutputBundle,
  options: ResolvedEnvironmentOptions & ResolvedConfig,
):
  | {
      /** 承载待解析 import map 的 Rollup 资源产物。 */
      asset: OutputAsset
      /** import map 资源解析后的结构。 */
      content: {
        /** 裸模块标识到目标 URL 的映射。 */
        imports: Record<string, string>
      }
      /** 去掉 base 的 import map 条目（占位文件名 → 真实文件名）。 */
      mapping: Record<string, string>
    }
  | undefined {
  const asset = bundle[getImportMapFilename(options)] as OutputAsset | undefined
  if (!asset) return undefined

  const content: {
    /** 裸模块标识到目标 URL 的映射。 */
    imports: Record<string, string>
  } = JSON.parse(
    typeof asset.source === 'string'
      ? asset.source
      : new TextDecoder().decode(asset.source),
  )
  const baseUrl = getImportMapBaseUrl(options)
  const mapping = Object.fromEntries(
    Object.entries(content.imports).map(([k, v]) => [
      k.slice(baseUrl.length),
      v.slice(baseUrl.length),
    ]),
  )
  return { asset, content, mapping }
}
