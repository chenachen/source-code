import * as pathe from 'pathe'
import { isWindows } from '../shared/utils'

/** 浏览器回退路径复用的 UTF-8 解码器。 */
const textDecoder = new TextDecoder()

/** 在 Node Buffer 或浏览器 atob 间选择稳定的 base64 UTF-8 解码实现。 */
export const decodeBase64: (base64: string) => string = (() => {
  // 在模块加载时捕获绑定：某些 realm 之后会主动删除 `globalThis.Buffer`
  //（例如模拟浏览器的测试），而堆栈准备阶段才会延迟调用这个解码器。
  const capturedBuffer = typeof Buffer === 'function' ? Buffer : undefined
  if (capturedBuffer && typeof capturedBuffer.from === 'function') {
    return (base64: string) =>
      capturedBuffer.from(base64, 'base64').toString('utf-8')
  }

  return (base64: string) =>
    textDecoder.decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)))
})()

/** `/` 的字符码，用于无分配检测路径尾分隔符。 */
const CHAR_FORWARD_SLASH = 47
/** `\\` 的字符码，用于 Windows 路径尾分隔符检测。 */
const CHAR_BACKWARD_SLASH = 92

/** 路径中已有 percent 的全局匹配器。 */
const percentRegEx = /%/g
/** POSIX 文件名中反斜杠的全局匹配器。 */
const backslashRegEx = /\\/g
/** 文件名换行符的全局匹配器。 */
const newlineRegEx = /\n/g
/** 文件名回车符的全局匹配器。 */
const carriageReturnRegEx = /\r/g
/** 文件名制表符的全局匹配器。 */
const tabRegEx = /\t/g
/** 会被 URL 解释为 query 的问号匹配器。 */
const questionRegex = /\?/g
/** 会被 URL 解释为 fragment 的井号匹配器。 */
const hashRegex = /#/g

/** 编码会破坏 file URL 结构的路径字符，同时保留普通路径分隔符。 */
function encodePathChars(filepath: string) {
  if (filepath.includes('%')) filepath = filepath.replace(percentRegEx, '%25')
  // POSIX 路径允许反斜杠作为普通字符，不能把它误当作目录分隔符。
  if (!isWindows && filepath.includes('\\'))
    filepath = filepath.replace(backslashRegEx, '%5C')
  if (filepath.includes('\n')) filepath = filepath.replace(newlineRegEx, '%0A')
  if (filepath.includes('\r'))
    filepath = filepath.replace(carriageReturnRegEx, '%0D')
  if (filepath.includes('\t')) filepath = filepath.replace(tabRegEx, '%09')
  return filepath
}

/** 与平台无关、始终返回 POSIX 分隔符的 dirname。 */
export const posixDirname: (path: string) => string = pathe.dirname
/** 与平台无关、始终返回 POSIX 分隔符的 resolve。 */
export const posixResolve: (...paths: string[]) => string = pathe.resolve

/**
 * 把统一为 POSIX 形式的绝对路径转换为合法 file URL。
 * 单独实现热点路径，避免创建 URL 后再设置 pathname 带来的额外开销。
 */
export function posixPathToFileHref(posixPath: string): string {
  let resolved = posixResolve(posixPath)
  // path.resolve 会去掉结尾斜杠，这里恢复调用者表达的目录语义。
  const filePathLast = posixPath.charCodeAt(posixPath.length - 1)
  if (
    (filePathLast === CHAR_FORWARD_SLASH ||
      (isWindows && filePathLast === CHAR_BACKWARD_SLASH)) &&
    resolved[resolved.length - 1] !== '/'
  )
    resolved += '/'

  // 先编码已有 `%`，避免随后编码 `?` 与 `#` 时造成二次转义。
  resolved = encodePathChars(resolved)

  // `?` 与 `#` 属于文件名，而不是 URL 的 query/hash，必须编码后才能留在 pathname。
  // 直接替换也避免先创建 URL、再触发 pathname setter 的性能成本。
  if (resolved.includes('?')) resolved = resolved.replace(questionRegex, '%3F')
  if (resolved.includes('#')) resolved = resolved.replace(hashRegex, '%23')
  return new URL(`file://${resolved}`).href
}

/** 把内部统一使用的 POSIX 分隔符还原成 Windows 路径分隔符。 */
export function toWindowsPath(path: string): string {
  return path.replace(/\//g, '\\')
}
