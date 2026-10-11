import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import MagicString from 'magic-string'
import type { SourceMapInput } from 'rolldown'
import type { DefaultTreeAdapterMap, Token } from 'parse5'
import type { Connect } from '#dep-types/connect'
import type { IndexHtmlTransformHook } from '../../plugins/html'
import {
  addToHTMLProxyCache,
  applyHtmlTransforms,
  extractImportExpressionFromClassicScript,
  findNeedTransformStyleAttribute,
  getScriptInfo,
  htmlEnvHook,
  htmlProxyResult,
  injectCspNonceMetaTagHook,
  injectNonceAttributeTagHook,
  nodeIsElement,
  overwriteAttrValue,
  postImportMapHook,
  preImportMapHook,
  removeViteIgnoreAttr,
  resolveHtmlTransforms,
  traverseHtml,
} from '../../plugins/html'
import type { PreviewServer, ResolvedConfig, ViteDevServer } from '../..'
import { send } from '../send'
import { CLIENT_PUBLIC_PATH, FS_PREFIX } from '../../constants'
import {
  ensureWatchedFile,
  fsPathFromId,
  getHash,
  injectQuery,
  isCSSRequest,
  isDevServer,
  isJSRequest,
  isParentDirectory,
  joinUrlSegments,
  normalizePath,
  processSrcSetSync,
  stripBase,
} from '../../utils'
import { checkPublicFile } from '../../publicDir'
import { getCodeWithSourcemap, injectSourcesContent } from '../sourcemap'
import { cleanUrl, unwrapId, wrapId } from '../../../shared/utils'
import { getNodeAssetAttributes } from '../../assetSource'
import {
  BasicMinimalPluginContext,
  basePluginContextMeta,
} from '../pluginContainer'
import { getHmrImplementation } from '../../plugins/clientInjections'
import { checkLoadingAccess, respondWithAccessDenied } from './static'

/** 从 HTML 中抽出的内联样式片段及其源码替换范围。 */
interface AssetNode {
  /** 原 HTML 中待替换内容的起止位置。 */
  start: number
  /** 原 HTML 中片段的结束偏移。 */
  end: number
  /** 交给 CSS 插件的内联源码。 */
  code: string
}

/** style 属性代理模块所需的序号、位置与 CSS 源码。 */
interface InlineStyleAttribute {
  /** 与 html-proxy query 对应的片段序号。 */
  index: number
  /** style 属性在原 HTML 中的位置。 */
  location: Token.Location
  /** 属性中的 CSS 源码。 */
  code: string
}

/**
 * 创建开发态 transformIndexHtml：组装 Vite 内置 hook 与用户 pre/normal/post hooks，并提供
 * watchMode 插件上下文。返回函数由 server.transformIndexHtml 暴露，也由 HTML 中间件调用。
 */
export function createDevHtmlTransformFn(
  config: ResolvedConfig,
): (
  server: ViteDevServer,
  url: string,
  html: string,
  originalUrl?: string,
) => Promise<string> {
  const [preHooks, normalHooks, postHooks] = resolveHtmlTransforms(
    config.plugins,
  )
  const transformHooks = [
    preImportMapHook(config),
    injectCspNonceMetaTagHook(config),
    ...preHooks,
    htmlEnvHook(config),
    devHtmlHook,
    ...normalHooks,
    ...postHooks,
    injectNonceAttributeTagHook(config),
    postImportMapHook(config),
  ]
  const pluginContext = new BasicMinimalPluginContext(
    { ...basePluginContextMeta, watchMode: true },
    config.logger,
  )
  return (
    server: ViteDevServer,
    url: string,
    html: string,
    originalUrl?: string,
  ): Promise<string> => {
    return applyHtmlTransforms(html, transformHooks, pluginContext, {
      path: url,
      filename: getHtmlFilename(url, server),
      server,
      originalUrl,
    })
  }
}

/** 把 root URL 或 `/@fs/` URL 映射到供 hook 上下文和 Source Map 使用的文件名。 */
function getHtmlFilename(url: string, server: ViteDevServer) {
  if (url.startsWith(FS_PREFIX)) {
    return decodeURIComponent(fsPathFromId(url))
  } else {
    return decodeURIComponent(
      normalizePath(path.join(server.config.root, url.slice(1))),
    )
  }
}

/** 只有非 publicDir 的 JS/CSS 资源才值得从 HTML 提前预热 transform。 */
function shouldPreTransform(url: string, config: ResolvedConfig) {
  return (
    !checkPublicFile(url, config) && (isJSRequest(url) || isCSSRequest(url))
  )
}

/** 判断 URL 首字符是否可构成不带 `./` 的裸相对路径。 */
const wordCharRE = /\w/

/** 识别 `src/main.js` 这类无 `./`、也无协议的相对 URL。 */
function isBareRelative(url: string) {
  return wordCharRE.test(url[0]) && !url.includes(':')
}

/** 目录 URL 自身就是相对基准；文件 URL 则取所在目录。 */
function getHtmlDirnameForRelativeUrl(htmlPath: string): string {
  return htmlPath.endsWith('/') ? htmlPath : path.posix.dirname(htmlPath)
}

/**
 * 开发态统一处理 HTML 节点 URL：补 base/SPA fallback 相对目录、追加 HMR 时间戳，并异步预热
 * JS/CSS。srcset 会对每个候选 URL 分别执行相同逻辑。
 */
const processNodeUrl = (
  url: string,
  useSrcSetReplacer: boolean,
  config: ResolvedConfig,
  htmlPath: string,
  originalUrl?: string,
  server?: ViteDevServer,
  isClassicScriptLink?: boolean,
): string => {
  // 开发态 base 永远不是相对值，可直接作为公开 URL 前缀。
  /** 规范化单个资源 URL，并根据模块图状态安排预转换或追加 HMR 时间戳。 */
  const replacer = (url: string) => {
    if (
      (url[0] === '/' && url[1] !== '/') ||
      // #3230：请求 `/a/b` 若回退到根 index.html，浏览器会把相对资源错误解析到 `/a/` 下。
      //
      // 含 `:` 表示 URL 协议或 Windows 路径，不做相对改写。
      //
      // base 为 `/` 的 `/a/b` fallback：`./index.js` → `/index.js`，`../index.js` → `/index.js`，
      // `relative/index.js` → `/relative/index.js`。资源以返回的根 HTML 为基准，而非导航目录。
      ((url[0] === '.' || isBareRelative(url)) &&
        originalUrl &&
        originalUrl !== '/' &&
        htmlPath === '/index.html')
    ) {
      url = path.posix.join(config.base, url)
    }

    let preTransformUrl: string | undefined

    if (!isClassicScriptLink && shouldPreTransform(url, config)) {
      if (url[0] === '/' && url[1] !== '/') {
        preTransformUrl = url
      } else if (url[0] === '.' || isBareRelative(url)) {
        preTransformUrl = path.posix.join(
          config.base,
          getHtmlDirnameForRelativeUrl(htmlPath),
          url,
        )
      }
    }

    if (server) {
      const mod = server.environments.client.moduleGraph.urlToModuleMap.get(
        stripBase(preTransformUrl || url, config.decodedBase),
      )
      if (mod && mod.lastHMRTimestamp > 0) {
        url = injectQuery(url, `t=${mod.lastHMRTimestamp}`)
      }
    }

    if (server && preTransformUrl) {
      try {
        preTransformUrl = decodeURI(preTransformUrl)
      } catch {
        // URI 不合法时保留响应 HTML，只跳过投机预热，避免非关键优化导致 500（#22781）。
        return url
      }
      preTransformRequest(server, preTransformUrl, config.decodedBase)
    }

    return url
  }

  const processedUrl = useSrcSetReplacer
    ? processSrcSetSync(url, ({ url }) => replacer(url))
    : replacer(url)
  return processedUrl
}
/**
 * 开发态核心 HTML hook：把内联 module/CSS 建成代理模块，规范化所有资源 URL，预热依赖，给
 * 已 HMR 更新的模块追加时间戳，最后在 head 最前注入 `/@vite/client`。
 */
const devHtmlHook: IndexHtmlTransformHook = async (
  html,
  { path: htmlPath, filename, server, originalUrl },
) => {
  const { config, watcher } = server!
  const base = config.base || '/'
  const decodedBase = config.decodedBase || '/'

  let proxyModulePath: string
  let proxyModuleUrl: string

  const trailingSlash = htmlPath.endsWith('/')
  if (!trailingSlash && fs.existsSync(filename)) {
    // `/@fs/` HTML（例如 vitest-browser 的 testerHtmlPath）以绝对文件路径作为 proxyModulePath，
    // 使后续 proxyCacheUrl 与插件端解码后的 root-relative key 一致（#21762）。
    proxyModulePath = htmlPath.startsWith(FS_PREFIX) ? filename : htmlPath
    proxyModuleUrl = htmlPath
  } else {
    // SSR 集成会以 `/` 调 transformIndexHtml（#7993），调用方也可能给一个不存在于磁盘的合法
    // HTML 名。两者都标成虚拟 ID：避免误做磁盘 Source Map，并让插件按虚拟模块处理。
    const validPath = `${htmlPath}${trailingSlash ? 'index.html' : ''}`
    proxyModulePath = `\0${validPath}`
    proxyModuleUrl = wrapId(proxyModulePath)
  }
  proxyModuleUrl = joinUrlSegments(decodedBase, proxyModuleUrl)

  const s = new MagicString(html)
  let inlineModuleIndex = -1
  // html-proxy 缓存 key 使用解码路径，因为 HTML 插件查询时拿到的也是解码 URL。
  const proxyCacheUrl = decodeURI(
    cleanUrl(proxyModulePath).replace(normalizePath(config.root), ''),
  )
  const styleUrl: AssetNode[] = []
  const inlineStyles: InlineStyleAttribute[] = []
  const inlineModulePaths: string[] = []

  /** 把一个内联 module script 登记为 html-proxy 模块并替换成外链脚本。 */
  const addInlineModule = (
    node: DefaultTreeAdapterMap['element'],
    ext: 'js',
  ) => {
    inlineModuleIndex++

    const contentNode = node.childNodes[0] as DefaultTreeAdapterMap['textNode']

    const code = contentNode.value

    let map: SourceMapInput | undefined
    if (proxyModulePath[0] !== '\0') {
      map = new MagicString(html)
        .snip(
          contentNode.sourceCodeLocation!.startOffset,
          contentNode.sourceCodeLocation!.endOffset,
        )
        .generateMap({ hires: 'boundary' })
      map.sources = [filename]
      map.file = filename
    }

    // 登记原始代码/定位 map，后续代理模块请求会由 htmlInlineProxyPlugin.load 读取。
    addToHTMLProxyCache(config, proxyCacheUrl, inlineModuleIndex, { code, map })

    // 内联模块改写成外链代理 src；浏览器请求它时便可进入标准 transform/HMR 管线。
    const modulePath = `${proxyModuleUrl}?html-proxy&index=${inlineModuleIndex}.${ext}`
    inlineModulePaths.push(modulePath)

    s.update(
      node.sourceCodeLocation!.startOffset,
      node.sourceCodeLocation!.endOffset,
      `<script type="module" src="${modulePath}"></script>`,
    )
    preTransformRequest(server!, modulePath, decodedBase)
  }

  await traverseHtml(html, filename, config.logger.warn, (node) => {
    if (!nodeIsElement(node)) {
      return
    }

    // script：改写外链 URL、代理内联 module，并处理经典脚本中的字面量 import()。
    if (node.nodeName === 'script') {
      const { src, srcSourceCodeLocation, isModule, isIgnored } =
        getScriptInfo(node)

      if (isIgnored) {
        removeViteIgnoreAttr(s, node.sourceCodeLocation!)
      } else if (src) {
        const processedUrl = processNodeUrl(
          src.value,
          /* useSrcSetReplacer */ false,
          config,
          htmlPath,
          originalUrl,
          server,
          !isModule,
        )
        if (processedUrl !== src.value) {
          overwriteAttrValue(s, srcSourceCodeLocation!, processedUrl)
        }
      } else if (isModule && node.childNodes.length) {
        addInlineModule(node, 'js')
      } else if (node.childNodes.length) {
        const scriptNode = node.childNodes[
          node.childNodes.length - 1
        ] as DefaultTreeAdapterMap['textNode']
        for (const {
          url,
          start,
          end,
        } of extractImportExpressionFromClassicScript(scriptNode)) {
          const processedUrl = processNodeUrl(
            url,
            false,
            config,
            htmlPath,
            originalUrl,
          )
          if (processedUrl !== url) {
            s.update(start, end, processedUrl)
          }
        }
      }
    }

    const inlineStyle = findNeedTransformStyleAttribute(node)
    if (inlineStyle) {
      inlineModuleIndex++
      inlineStyles.push({
        index: inlineModuleIndex,
        location: inlineStyle.location!,
        code: inlineStyle.attr.value,
      })
    }

    if (node.nodeName === 'style' && node.childNodes.length) {
      const children = node.childNodes[0] as DefaultTreeAdapterMap['textNode']
      styleUrl.push({
        start: children.sourceCodeLocation!.startOffset,
        end: children.sourceCodeLocation!.endOffset,
        code: children.value,
      })
    }

    // 统一改写元素的 href/src/srcset 及 additionalAssetSources。
    const assetAttributes = getNodeAssetAttributes(
      node,
      config.html?.additionalAssetSources,
    )
    for (const attr of assetAttributes) {
      if (attr.type === 'remove') {
        s.remove(attr.location.startOffset, attr.location.endOffset)
      } else {
        const processedUrl = processNodeUrl(
          attr.value,
          attr.type === 'srcset',
          config,
          htmlPath,
          originalUrl,
        )
        if (processedUrl !== attr.value) {
          overwriteAttrValue(s, attr.location, processedUrl)
        }
      }
    }
  })

  // transformIndexHtml 可能对同 URL 重新生成内联代码；先使旧代理节点失效，下一请求才会读新缓存。
  const clientModuleGraph = server?.environments.client.moduleGraph
  if (clientModuleGraph) {
    await Promise.all(
      inlineModulePaths.map(async (url) => {
        const module = await clientModuleGraph.getModuleByUrl(url)
        if (module) {
          clientModuleGraph.invalidateModule(module)
        }
      }),
    )
  }

  await Promise.all([
    ...styleUrl.map(async ({ start, end, code }, index) => {
      const url = `${proxyModulePath}?html-proxy&direct&index=${index}.css`

      // `<style>` 直接在本次 HTML 转换中处理：先入图/监听，才能参与后续 HMR。
      const mod =
        await server!.environments.client.moduleGraph.ensureEntryFromUrl(
          url,
          false,
        )
      ensureWatchedFile(watcher, mod.file, config.root)

      const result =
        await server!.environments.client.pluginContainer.transform(
          code,
          mod.id!,
        )
      let content = ''
      if (result.map && 'version' in result.map) {
        if (result.map.mappings) {
          await injectSourcesContent(result.map, proxyModulePath, config.logger)
        }
        content = getCodeWithSourcemap('css', result.code, result.map)
      } else {
        content = result.code
      }
      s.overwrite(start, end, content)
    }),
    ...inlineStyles.map(async ({ index, location, code }) => {
      // style 属性走 CSS 插件；css-post 把结果写入 htmlProxyResult，再替换回属性值。
      const url = `${proxyModulePath}?html-proxy&inline-css&style-attr&index=${index}.css`

      const mod =
        await server!.environments.client.moduleGraph.ensureEntryFromUrl(
          url,
          false,
        )
      ensureWatchedFile(watcher, mod.file, config.root)

      await server?.environments.client.pluginContainer.transform(code, mod.id!)

      const hash = getHash(cleanUrl(mod.id!))
      const result = htmlProxyResult.get(`${hash}_${index}`)
      overwriteAttrValue(s, location, result ?? '')
    }),
  ])

  html = s.toString()

  return {
    html,
    tags: [
      {
        tag: 'script',
        attrs: {
          type: 'module',
          src: path.posix.join(base, CLIENT_PUBLIC_PATH),
        },
        injectTo: 'head-prepend',
      },
    ],
  }
}

/**
 * 读取并响应 fallback 后确定的 `.html`：开发态执行 fs 访问控制与 transformIndexHtml，preview
 * 只允许输出目录内文件；bundled dev 则优先从内存构建产物读取，并在重构建时返回等待页。
 */
export function indexHtmlMiddleware(
  root: string,
  server: ViteDevServer | PreviewServer,
): Connect.NextHandleFunction {
  const isDev = isDevServer(server)
  const fullBundle = isDev && server.environments.client.bundledDev

  // 保留命名函数；`DEBUG=connect:dispatcher` 会显示它的名称。
  /** 响应解析后的 HTML 路径：bundled dev 用内存/等待页，普通 dev 转换磁盘 HTML，preview 仅读取输出目录。 */
  return async function viteIndexHtmlMiddleware(req, res, next) {
    if (res.writableEnded) {
      return next()
    }

    const url = req.url && cleanUrl(req.url)
    // 上游 htmlFallbackMiddleware 已把扩展名省略/目录 URL 规范化为 `.html` 请求。
    if (url?.endsWith('.html') && req.headers['sec-fetch-dest'] !== 'script') {
      if (fullBundle) {
        let pathname
        try {
          pathname = decodeURIComponent(url)
        } catch {
          // bundled dev 的畸形 URI 交给后续中间件，不让 decode 异常变成 500。
          return next()
        }
        const filePath = pathname.slice(1) // 移除开头 `/`，匹配内存产物 key。

        let file = fullBundle.memoryFiles.get(filePath)
        if (!file && fullBundle.hasBuildOutput) {
          return next()
        }
        const secFetchDest = req.headers['sec-fetch-dest']
        const isDocumentRequest = [
          'document',
          'iframe',
          'frame',
          'fencedframe',
          '',
          undefined,
        ].includes(secFetchDest)
        if (
          isDocumentRequest &&
          ((await fullBundle.triggerBundleRegenerationIfStale()) ||
            file === undefined)
        ) {
          file = { source: await generateFallbackHtml(server as ViteDevServer) }
        }
        if (!file) {
          return next()
        }

        const html =
          typeof file.source === 'string'
            ? file.source
            : Buffer.from(file.source)
        const headers = server.config.server.headers
        return send(req, res, html, 'html', { headers, etag: file.etag })
      }

      let filePath: string
      if (isDev && url.startsWith(FS_PREFIX)) {
        filePath = decodeURIComponent(fsPathFromId(url))
      } else {
        filePath = normalizePath(
          path.resolve(path.join(root, decodeURIComponent(url))),
        )
      }

      if (isDev) {
        const servingAccessResult = checkLoadingAccess(server.config, filePath)
        if (servingAccessResult === 'denied') {
          return respondWithAccessDenied(filePath, server, res)
        }
        if (servingAccessResult === 'fallback') {
          return next()
        }
        servingAccessResult satisfies 'allowed'
      } else {
        // preview 不应用 server.fs 配置，但仍必须禁止读取输出目录之外的文件。
        if (!isParentDirectory(root, filePath)) {
          return next()
        }
      }

      if (fs.existsSync(filePath)) {
        const headers = isDev
          ? server.config.server.headers
          : server.config.preview.headers

        try {
          let html = await fsp.readFile(filePath, 'utf-8')
          if (isDev) {
            html = await server.transformIndexHtml(url, html, req.originalUrl)
          }
          return send(req, res, html, 'html', { headers })
        } catch (e) {
          return next(e)
        }
      }
    }
    next()
  }
}

// 本文件频繁混用浏览器编码 URL 与 parse5/缓存中的解码路径，故用 decoded 前缀显式标出；其他
// 模块通常不这样命名。
/** 将 HTML 中发现的 client 资源投机送入变换管线，减少浏览器解析后的请求瀑布。 */
function preTransformRequest(
  server: ViteDevServer,
  decodedUrl: string,
  decodedBase: string,
) {
  if (!server.config.server.preTransformRequests) return

  // HTML 声明的都是 client 资源，统一去 base/虚拟包装后走非 SSR warmup。
  decodedUrl = unwrapId(stripBase(decodedUrl, decodedBase))
  server.warmupRequest(decodedUrl)
}

/** bundled dev 首轮/重构建期间的临时等待页；内嵌 HMR runtime，构建完成后自动 reload。 */
async function generateFallbackHtml(server: ViteDevServer) {
  const hmrRuntime = await getHmrImplementation(server.config)
  return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <script>globalThis.__vite_is_fallback_page__ = true</script>
  <script type="module">
    ${hmrRuntime.replaceAll('</script>', '<\\/script>')}
  </script>
  <style>
    :root {
      --page-bg: #ffffff;
      --text-color: #1d1d1f;
      --spinner-track: #f5f5f7;
      --spinner-accent: #0071e3;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --page-bg: #1e1e1e;
        --text-color: #f5f5f5;
        --spinner-track: #424242;
      }
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      background-color: var(--page-bg);
      color: var(--text-color);
    }

    .container {
      margin: auto;
      padding: 2rem;
      text-align: center;
      border-radius: 1rem;
    }

    .spinner {
      width: 3rem;
      height: 3rem;
      margin: 2rem auto;
      border: 3px solid var(--spinner-track);
      border-top-color: var(--spinner-accent);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg) } }
  </style>
</head>
<body>
  <div class="container">
    <h1>Bundling in progress</h1>
    <p>The page will automatically reload when ready.</p>
    <div class="spinner"></div>
  </div>
</body>
</html>
`
}
