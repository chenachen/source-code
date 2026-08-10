import type {
  IncomingMessage,
  OutgoingHttpHeaders,
  ServerResponse,
} from 'node:http'
import path from 'node:path'
import convertSourceMap from 'convert-source-map'
import getEtag from 'etag'
import type { SourceMap } from 'rolldown'
import MagicString from 'magic-string'
import { createDebugger, removeTimestampQuery } from '../utils'
import { getCodeWithSourcemap } from './sourcemap'

/** `DEBUG=vite:send` 启用的 fallback sourcemap 注入诊断日志。 */
const debug = createDebugger('vite:send', {
  onlyWhenFocused: true,
})

/** Vite 常用逻辑类型到响应 MIME 的映射。 */
const alias: Record<string, string | undefined> = {
  js: 'text/javascript',
  css: 'text/css',
  html: 'text/html',
  json: 'application/json',
}

/** 开发响应的缓存、Header 与 Source Map 发送选项。 */
export interface SendOptions {
  /** 已计算的实体标签；缺省按响应内容生成弱 ETag。 */
  etag?: string
  /** Cache-Control 值；开发态缺省 no-cache，让浏览器每次用 ETag 再验证。 */
  cacheControl?: string
  /** 覆盖/追加到 Vite 默认响应头之后的用户 header。 */
  headers?: OutgoingHttpHeaders
  /** 转换链产出的 Source Map；空 mappings 明确表示无需 fallback map。 */
  map?:
    | SourceMap
    | {
        /** 空字符串表示上游明确禁止生成 fallback Source Map。 */
        mappings: ''
      }
    | null
}

/**
 * 发送开发态转换结果：处理条件请求、MIME/cache/header、Source Map 注入和 HEAD 语义。
 * 该函数不执行 transform，只把已经得到的内容稳定映射为 HTTP 响应。
 */
export function send(
  req: IncomingMessage,
  res: ServerResponse,
  content: string | Buffer,
  type: string,
  options: SendOptions,
): void {
  const {
    etag = getEtag(content, { weak: true }),
    cacheControl = 'no-cache',
    headers,
    map,
  } = options

  if (res.writableEnded) {
    // 用户插件/proxy bypass 可能已结束响应，不能二次写入。
    return
  }

  if (req.headers['if-none-match'] === etag) {
    // 内容未变时不发送 body；浏览器复用本地缓存。
    res.statusCode = 304
    res.end()
    return
  }

  res.setHeader('Content-Type', alias[type] || type)
  res.setHeader('Cache-Control', cacheControl)
  res.setHeader('Etag', etag)

  if (headers) {
    for (const name in headers) {
      res.setHeader(name, headers[name]!)
    }
  }

  // 有真实 mappings 时，把对应 Source Map URL/data URL 注入 JS/CSS。
  if (map && 'version' in map && map.mappings) {
    if (type === 'js' || type === 'css') {
      content = getCodeWithSourcemap(type, content.toString(), map)
    }
  }
  // 没有可用 map 的 JS 生成 identity fallback map，改善浏览器断点定位（#13514）。
  // https://github.com/vitejs/vite/pull/13514#issuecomment-1592431496
  else if (type === 'js' && (!map || map.mappings !== '')) {
    const code = content.toString()
    // 代码已有内联 Source Map 时视为上游正确产物，避免重复注入（#14370）。
    if (convertSourceMap.mapFileCommentRegex.test(code)) {
      debug?.(`Skipped injecting fallback sourcemap for ${req.url}`)
    } else {
      const urlWithoutTimestamp = removeTimestampQuery(req.url!)
      const ms = new MagicString(code)
      content = getCodeWithSourcemap(
        type,
        code,
        ms.generateMap({
          source: path.basename(urlWithoutTimestamp),
          hires: 'boundary',
          includeContent: true,
        }) as SourceMap,
      )
    }
  }

  res.statusCode = 200
  if (req.method === 'HEAD') {
    // HEAD 返回与 GET 相同的状态/响应头，但不能带 body（#20421）。
    res.end()
  } else {
    res.end(content)
  }
  return
}
