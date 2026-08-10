import { type UrlWithStringQuery, parse as uriParse } from 'url'
import { isString } from '@vue/shared'

/** 判断 URL 是否应由构建器按本地模块资源处理。 */
export function isRelativeUrl(url: string): boolean {
  const firstChar = url.charAt(0)
  return (
    firstChar === '.' ||
    firstChar === '~' ||
    firstChar === '@' ||
    firstChar === '#'
  )
}

/** 匹配 http(s) 绝对 URL 与 `//host/path` 协议相对 URL。 */
const externalRE = /^(?:https?:)?\/\//
/** 判断 URL 是否指向外部网络资源。 */
export function isExternalUrl(url: string): boolean {
  return externalRE.test(url)
}

/** 匹配允许前导空白、大小写不敏感的 data URL。 */
const dataUrlRE = /^\s*data:/i
/** 判断 URL 是否直接内嵌 data 内容。 */
export function isDataUrl(url: string): boolean {
  return dataUrlRE.test(url)
}

/**
 * 尝试解码 URL 编码后的 import 路径；非法 `%` 序列保持原值，避免编译过程抛错。
 */
export function normalizeDecodedImportPath(source: string): string {
  try {
    return decodeURIComponent(source)
  } catch {
    return source
  }
}

/**
 * 将模板属性中的 URL 字符串解析为 Node URL 结构。
 * webpack 风格的 `~pkg/file` 会先去掉 `~`/`~/`，使其成为模块请求。
 */
export function parseUrl(url: string): UrlWithStringQuery {
  const firstChar = url.charAt(0)
  if (firstChar === '~') {
    const secondChar = url.charAt(1)
    url = url.slice(secondChar === '/' ? 2 : 1)
  }
  return parseUriParts(url)
}

/**
 * 解析 URL 的 pathname、query 与 hash。
 * component-compiler-utils#22：必须保留片段部分，资产转换后才能生成正确的模块请求。
 * @param urlString - 原始 URL 字符串
 */
function parseUriParts(urlString: string): UrlWithStringQuery {
  // Node 的 url.parse 收到非字符串会抛 TypeError；这里用空串防御异常调用。
  // @see https://nodejs.org/api/url.html#url_url_parse_urlstring_parsequerystring_slashesdenotehost
  return uriParse(isString(urlString) ? urlString : '', false, true)
}
