import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { exec } from 'node:child_process'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { ServerOptions as HttpsServerOptions } from 'node:https'
import { builtinModules } from 'node:module'
import { promises as dns } from 'node:dns'
import { performance } from 'node:perf_hooks'
import type { AddressInfo, Server } from 'node:net'
import fsp from 'node:fs/promises'
import remapping from '@jridgewell/remapping'
import type { DecodedSourceMap, RawSourceMap } from '@jridgewell/remapping'
import colors from 'picocolors'
import type { Debugger } from 'obug'
import debug from 'obug'
import type MagicString from 'magic-string'
import type { Equal } from '@type-challenges/utils'

import type { InputOption, TransformResult } from 'rolldown'
import { createFilter as _createFilter } from '@rollup/pluginutils'
import type { Alias, AliasOptions } from '#dep-types/alias'
import type { FSWatcher } from '#dep-types/chokidar'
import {
  cleanUrl,
  isWindows,
  slash,
  splitFileAndPostfix,
  withTrailingSlash,
} from '../shared/utils'
import { VALID_ID_PREFIX } from '../shared/constants'
import { createIsBuiltin } from '../shared/builtin'
import {
  CLIENT_ENTRY,
  CLIENT_PUBLIC_PATH,
  CSS_LANGS_RE,
  ENV_PUBLIC_PATH,
  FS_PREFIX,
  OPTIMIZABLE_ENTRY_RE,
  loopbackHosts,
  wildcardHosts,
} from './constants'
import type { DepOptimizationOptions } from './optimizer'
import type { ResolvedConfig } from './config'
import type { ResolvedServerUrls, ServerOptions, ViteDevServer } from './server'
import type { PreviewServer } from './preview'
import { type PackageCache, findNearestPackageData } from './packages'
import type { BuildEnvironmentOptions } from './build'
import type { CommonServerOptions } from '.'

/** 从 @rollup/pluginutils 内联，使该包只需保留在 devDependencies。 */
export type FilterPattern =
  | ReadonlyArray<string | RegExp>
  | string
  | RegExp
  | null
/** 复用 Rollup 过滤器实现，按 include/exclude 模式生成模块 ID 判定函数。 */
export const createFilter = _createFilter as (
  include?: FilterPattern,
  exclude?: FilterPattern,
  options?: {
    /** 用于把相对过滤模式解析为绝对路径的基准目录；false/null 表示不解析。 */
    resolve?: string | false | null
  },
) => (id: unknown) => boolean

export { withFilter } from 'rolldown/filter'

/** 匹配文件名中必须编码的控制字符及 Rollup 非法路径字符，防止扁平化 ID 冲突。 */
// eslint-disable-next-line no-control-regex
const invalidUrlPathCharRE = /[\u0000-\u001F"#$%&*+,:;<=>?[\]^`{|}\u007F]/g
/** 匹配依赖链 ID 中分隔父子模块的 `>` 及其两侧空白。 */
const replaceNestedIdRE = /\s*>\s*/g
/**
 * 把模块 ID 编码成可作依赖缓存文件名的稳定扁平字符串。
 *
 * @param id - 可含路径分隔符、query 非法字符或嵌套依赖链分隔符的原始模块 ID。
 * @returns 转义并限制长度后的文件名片段；超长结果带完整扁平字符串的摘要。
 */
export const flattenId = (id: string): string => {
  const flatId = limitFlattenIdLength(
    id
      .replaceAll(/_+/g, '$&__')
      .replaceAll('/', '_')
      .replaceAll('.', '__')
      .replace(replaceNestedIdRE, '_n_')
      // 预先编码所有会被 sanitizeFileName 替换的字符，避免不同 id 扁平化后冲突。
      .replace(
        invalidUrlPathCharRE,
        (c) => '_0' + c.charCodeAt(0).toString(16) + '_',
      ),
  )
  return flatId
}

/** 超长扁平 ID 末尾所附 SHA-256 摘要的字符数。 */
const FLATTEN_ID_HASH_LENGTH = 8
/** 扁平模块 ID 的最大文件名长度，为依赖缓存追加扩展名等后缀预留空间。 */
const FLATTEN_ID_MAX_FILE_LENGTH = 170

/** 截断超长扁平 ID，并附加截断前扁平字符串的摘要以降低前缀冲突。 */
const limitFlattenIdLength = (
  id: string,
  limit: number = FLATTEN_ID_MAX_FILE_LENGTH,
): string => {
  if (id.length <= limit) {
    return id
  }
  return id.slice(0, limit - (FLATTEN_ID_HASH_LENGTH + 1)) + '_' + getHash(id)
}

/** 把依赖链 ID 的 `>` 分隔符规范化为带单个空格的展示形式。 */
export const normalizeId = (id: string): string =>
  id.replace(replaceNestedIdRE, ' > ')

// Node、Deno、Bun 都支持的内置模块命名空间。
const NODE_BUILTIN_NAMESPACE = 'node:'
// Bun 专用内置模块命名空间。
const BUN_BUILTIN_NAMESPACE = 'bun:'
// Bun 等运行时会向 builtinModules 注入带命名空间的项，它们不属于 Node builtin。
const nodeBuiltins = builtinModules.filter((id) => !id.includes(':'))

/** 按内置模块规则数组缓存判定器；WeakMap 避免规则数组失去引用后仍被保留。 */
const isBuiltinCache = new WeakMap<
  (string | RegExp)[],
  (id: string, importer?: string) => boolean
>()

/** 判断 ID 是否命中给定内置模块规则，并复用同一规则数组对应的已编译判定器。 */
export function isBuiltin(builtins: (string | RegExp)[], id: string): boolean {
  let isBuiltin = isBuiltinCache.get(builtins)
  if (!isBuiltin) {
    isBuiltin = createIsBuiltin(builtins)
    isBuiltinCache.set(builtins, isBuiltin)
  }
  return isBuiltin(id)
}

/** Node、Deno 与 Bun 等类 Node 运行时可识别的内置模块规则。 */
export const nodeLikeBuiltins: (string | RegExp)[] = [
  ...nodeBuiltins,
  new RegExp(`^${NODE_BUILTIN_NAMESPACE}`),
  new RegExp(`^${BUN_BUILTIN_NAMESPACE}`),
]

/** 判断 ID 是否属于类 Node 运行时的内置模块，包括 `node:` 与 `bun:` 命名空间。 */
export function isNodeLikeBuiltin(id: string): boolean {
  return isBuiltin(nodeLikeBuiltins, id)
}

/** 接受 node: 前缀或已知 Node 内置名称；前缀分支不检查模块名是否实际存在。 */
export function isNodeBuiltin(id: string): boolean {
  if (id.startsWith(NODE_BUILTIN_NAMESPACE)) return true
  return nodeBuiltins.includes(id)
}

/** 判断模块 ID 是否包含 `node_modules` 子串，不要求完整路径段匹配。 */
export function isInNodeModules(id: string): boolean {
  return id.includes('node_modules')
}

/** 判断 ID 是否等于模块列表项或位于该项的深层导入路径下。 */
export function moduleListContains(
  moduleList: string[] | undefined,
  id: string,
): boolean | undefined {
  return moduleList?.some(
    (m) => m === id || id.startsWith(withTrailingSlash(m)),
  )
}

/** 判断模块 ID 的扩展名是否属于默认或用户扩展的依赖预构建输入类型。 */
export function isOptimizable(
  id: string,
  optimizeDeps: DepOptimizationOptions,
): boolean {
  const { extensions } = optimizeDeps
  return (
    OPTIMIZABLE_ENTRY_RE.test(id) ||
    (extensions?.some((ext) => id.endsWith(ext)) ?? false)
  )
}

/** 匹配不含 URL 协议、Windows 盘符且以包名合法首字符开头的裸导入。 */
export const bareImportRE: RegExp = /^(?![a-zA-Z]:)[\w@](?!.*:\/\/)/
/** 从裸导入中捕获普通包名或带 scope 的包名，忽略后续深层路径。 */
export const deepImportRE: RegExp = /^([^@][^/]*)\/|^(@[^/]+\/[^/]+)\//

/** 当前 Node 工具模块所在目录，用于解析 Vite 自身的运行时资源。 */
export const _dirname: string = path.dirname(
  fileURLToPath(/** #__KEEP__ */ import.meta.url),
)

// https://github.com/rolldown/rolldown/blob/62fba31428af244f871f0e119ed43936ee5d01fd/packages/rolldown/src/log/logger.ts#L64
/** 插件上下文公开的 Rollup 兼容版本；实际打包器版本由 rolldownVersion 提供。 */
export const rollupVersion = '4.23.0'
export { VERSION as rolldownVersion } from 'rolldown'

// 由 bin/vite.js 根据 CLI 参数写入。
const filter = process.env.VITE_DEBUG_FILTER

/** 启动时读取的 debug 命名空间配置，用于判断聚焦日志是否显式启用。 */
const DEBUG = process.env.DEBUG

/** 创建 Vite 调试记录器时的聚焦与对象展开选项。 */
interface DebuggerOptions {
  /** 仅在 DEBUG 显式包含当前命名空间或指定命名空间时输出。 */
  onlyWhenFocused?: boolean | string
  /** 调试对象的 inspect 展开深度；仅在底层未配置时写入。 */
  depth?: number
}

/** Vite 调试日志使用的 `vite:*` 命名空间。 */
export type ViteDebugScope = `vite:${string}`

/** 创建受命名空间、聚焦条件与内容过滤器控制的 Vite 调试日志函数。 */
export function createDebugger(
  namespace: ViteDebugScope,
  options: DebuggerOptions = {},
): Debugger['log'] | undefined {
  const log = debug(namespace)
  const { onlyWhenFocused, depth } = options

  if (depth && log.inspectOpts && log.inspectOpts.depth == null) {
    log.inspectOpts.depth = options.depth
  }

  let enabled = log.enabled
  if (enabled && onlyWhenFocused) {
    const ns = typeof onlyWhenFocused === 'string' ? onlyWhenFocused : namespace
    enabled = !!DEBUG?.includes(ns)
  }

  if (enabled) {
    return (...args: [string, ...any[]]) => {
      if (!filter || args.some((a) => a?.includes?.(filter))) {
        log(...args)
      }
    }
  }
}

/** 通过大小写变体探测当前文件系统是否忽略路径大小写，并校验探针入口有效。 */
function testCaseInsensitiveFS() {
  if (!CLIENT_ENTRY.endsWith('client.mjs')) {
    throw new Error(
      `cannot test case insensitive FS, CLIENT_ENTRY const doesn't contain client.mjs`,
    )
  }
  if (!fs.existsSync(CLIENT_ENTRY)) {
    throw new Error(
      'cannot test case insensitive FS, CLIENT_ENTRY does not point to an existing file: ' +
        CLIENT_ENTRY,
    )
  }
  return fs.existsSync(CLIENT_ENTRY.replace('client.mjs', 'cLiEnT.mjs'))
}

/** 当前运行文件系统是否大小写不敏感；模块初始化时以客户端入口探测一次。 */
export const isCaseInsensitiveFS: boolean = testCaseInsensitiveFS()

/** 匹配字符串开头的 Windows 盘符前缀。 */
const VOLUME_RE = /^[A-Z]:/i

/** Windows 上先把反斜杠转为 `/`，再统一用 posix.normalize 消解路径段。 */
export function normalizePath(id: string): string {
  return path.posix.normalize(isWindows ? slash(id) : id)
}

/** 把 `/@fs/` 模块 ID 转回规范化绝对文件路径，并保证 POSIX 路径带前导斜杠。 */
export function fsPathFromId(id: string): string {
  const fsPath = normalizePath(
    id.startsWith(FS_PREFIX) ? id.slice(FS_PREFIX.length) : id,
  )
  return fsPath[0] === '/' || VOLUME_RE.test(fsPath) ? fsPath : `/${fsPath}`
}

/** 去除 URL 查询与片段后，将其转换为规范化绝对文件路径。 */
export function fsPathFromUrl(url: string): string {
  return fsPathFromId(cleanUrl(url))
}

/**
 * 判断 dir 是否是 file 的父目录。
 *
 * 此函数不校验参数，只适用于已经规范化的绝对路径；在大小写不敏感文件系统上
 * 会使用小写副本比较。
 *
 * @param dir 已规范化的绝对目录
 * @param file 已规范化的绝对文件路径
 * @returns dir 是 file 父目录时为 true
 */
export function isParentDirectory(dir: string, file: string): boolean {
  dir = withTrailingSlash(dir)
  return (
    file.startsWith(dir) ||
    (isCaseInsensitiveFS && file.toLowerCase().startsWith(dir.toLowerCase()))
  )
}

/**
 * 判断两个文件路径是否指向同一名称。
 *
 * 此函数不校验参数，只适用于已经规范化的绝对路径；在大小写不敏感文件系统上
 * 忽略路径大小写。
 *
 * @param file1 已规范化的第一个绝对路径
 * @param file2 已规范化的第二个绝对路径
 * @returns 两个文件 URL 相同时为 true
 */
export function isSameFilePath(file1: string, file2: string): boolean {
  return (
    file1 === file2 ||
    (isCaseInsensitiveFS && file1.toLowerCase() === file2.toLowerCase())
  )
}

/** 匹配带协议或协议相对形式的外部 URL。 */
export const externalRE: RegExp = /^([a-z]+:)?\/\//
/** 判断字符串是否为带协议或协议相对形式的外部 URL。 */
export const isExternalUrl = (url: string): boolean => externalRE.test(url)

/** 匹配忽略前导空白及大小写的 data URL。 */
export const dataUrlRE: RegExp = /^\s*data:/i
/** 判断字符串是否为 data URL。 */
export const isDataUrl = (url: string): boolean => dataUrlRE.test(url)

/** 匹配以 Vite 公共虚拟模块协议开头的模块 ID。 */
export const virtualModuleRE: RegExp = /^virtual-module:.*/
/** 插件对外暴露虚拟模块时使用的公共 ID 前缀。 */
export const virtualModulePrefix = 'virtual-module:'

// 将来应依赖 Sec-Fetch-Dest，而不是硬编码扩展名；当开发模式最低浏览器版本都支持
// 该请求头后，可移除此兼容判断。
const knownJsSrcRE =
  /\.(?:[jt]sx?|m[jt]s|vue|marko|svelte|astro|imba|mdx)(?:$|\?)/
/** 根据已知脚本扩展名或无扩展文件形态判断 URL 是否应按 JS 请求处理。 */
export const isJSRequest = (url: string): boolean => {
  url = cleanUrl(url)
  if (knownJsSrcRE.test(url)) {
    return true
  }
  if (!path.extname(url) && url[url.length - 1] !== '/') {
    return true
  }
  return false
}

/** 判断请求路径是否使用 Vite 支持的 CSS 或预处理器扩展名。 */
export const isCSSRequest = (request: string): boolean =>
  CSS_LANGS_RE.test(request)

/** 匹配查询串中的内部 `import` 标记并保留其前导分隔符。 */
const importQueryRE = /(\?|&)import=?(?:&|$)/
/** 匹配查询串中的内部 `direct` 标记并保留其前导分隔符。 */
const directRequestRE = /(\?|&)direct=?(?:&|$)/
/** Vite 内部请求可使用的 URL 前缀。 */
const internalPrefixes = [
  FS_PREFIX,
  VALID_ID_PREFIX,
  CLIENT_PUBLIC_PATH,
  ENV_PUBLIC_PATH,
]
/** 匹配任一 Vite 内部请求前缀。 */
const InternalPrefixRE = new RegExp(`^(?:${internalPrefixes.join('|')})`)
/** 匹配移除查询参数后遗留在 URL 尾部的 `?` 或 `&`。 */
const trailingSeparatorRE = /[?&]$/
/** 判断 URL 查询串是否含 Vite 内部 `import` 标记。 */
export const isImportRequest = (url: string): boolean => importQueryRE.test(url)
/** 判断 URL 是否以文件系统、有效 ID、客户端或环境内部前缀开头。 */
export const isInternalRequest = (url: string): boolean =>
  InternalPrefixRE.test(url)

/** 移除 URL 查询串中的内部 `import` 标记，并清理尾部分隔符。 */
export function removeImportQuery(url: string): string {
  return url.replace(importQueryRE, '$1').replace(trailingSeparatorRE, '')
}
/** 移除 URL 查询串中的内部 `direct` 标记，并清理尾部分隔符。 */
export function removeDirectQuery(url: string): string {
  return url.replace(directRequestRE, '$1').replace(trailingSeparatorRE, '')
}

/** 匹配查询串中的资源 URL 导入标记。 */
export const urlRE: RegExp = /(\?|&)url(?:&|$)/
/** 匹配查询串中的原始文本导入标记。 */
export const rawRE: RegExp = /(\?|&)raw(?:&|$)/
/** 移除 URL 查询串中的 `url` 标记，并清理尾部分隔符。 */
export function removeUrlQuery(url: string): string {
  return url.replace(urlRE, '$1').replace(trailingSeparatorRE, '')
}

/** 在文件路径与既有查询/片段之间注入查询参数，并规范化 Windows 分隔符。 */
export function injectQuery(url: string, queryToInject: string): string {
  const { file, postfix } = splitFileAndPostfix(url)
  const normalizedFile = isWindows ? slash(file) : file
  return `${normalizedFile}?${queryToInject}${postfix[0] === '?' ? `&${postfix.slice(1)}` : /* 只有片段 */ postfix}`
}

/** 匹配 HMR 使用的 13 位毫秒时间戳查询参数。 */
const timestampRE = /\bt=\d{13}&?\b/
/** 移除 URL 中的 HMR 时间戳参数，并清理尾部分隔符。 */
export function removeTimestampQuery(url: string): string {
  return url.replace(timestampRE, '').replace(trailingSeparatorRE, '')
}

/**
 * 每轮对剩余文本调用 re.exec，等待替换器后拼接并截去已处理前缀。
 * 本函数不重置正则的 lastIndex；带 g/y 的输入正则会把自身状态带到下一轮剩余文本。
 */
export async function asyncReplace(
  input: string,
  re: RegExp,
  replacer: (match: RegExpExecArray) => string | Promise<string>,
): Promise<string> {
  let match: RegExpExecArray | null
  let remaining = input
  let rewritten = ''
  while ((match = re.exec(remaining))) {
    rewritten += remaining.slice(0, match.index)
    rewritten += await replacer(match)
    remaining = remaining.slice(match.index + match[0].length)
  }
  rewritten += remaining
  return rewritten
}

/** 计算扣除指定耗时后的持续时间，并按快、中、慢阈值着色为日志文本。 */
export function timeFrom(start: number, subtract = 0): string {
  const time: number | string = performance.now() - start - subtract
  const timeString = (time.toFixed(2) + `ms`).padEnd(5, ' ')
  if (time < 10) {
    return colors.green(timeString)
  } else if (time < 50) {
    return colors.yellow(timeString)
  } else {
    return colors.red(timeString)
  }
}

/** 将 URL 去掉时间戳并缩短为相对 root 的、适合日志展示的灰色文本。 */
export function prettifyUrl(url: string, root: string): string {
  url = removeTimestampQuery(url)
  const isAbsoluteFile = url.startsWith(root)
  if (isAbsoluteFile || url.startsWith(FS_PREFIX)) {
    const file = path.posix.relative(
      root,
      isAbsoluteFile ? url : fsPathFromId(url),
    )
    return colors.dim(file)
  } else {
    return colors.dim(url)
  }
}

/** 判断值的 toString 标签是否为 Object；普通 class 实例也可能命中。 */
export function isObject(value: unknown): value is Record<string, any> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

/** 从联合类型和值中排除 null 与 undefined。 */
export function isDefined<T>(value: T | undefined | null): value is T {
  return value != null
}

/** 同步读取文件状态；路径不存在、无权限或无效时统一返回 undefined。 */
export function tryStatSync(file: string): fs.Stats | undefined {
  try {
    // throwIfNoEntry=false 让不存在文件的热路径直接返回 undefined，避免异常构造开销。
    return fs.statSync(file, { throwIfNoEntry: false })
  } catch {
    // 权限、无效路径等 stat 错误统一视为“无法取得状态”。
  }
}

/** 从起始目录逐级向根目录查找第一个命中的普通文件。 */
export function lookupFile(
  dir: string,
  fileNames: string[],
): string | undefined {
  while (dir) {
    for (const fileName of fileNames) {
      const fullPath = path.join(dir, fileName)
      if (tryStatSync(fullPath)?.isFile()) return fullPath
    }
    const parentDir = path.dirname(dir)
    if (parentDir === dir) return

    dir = parentDir
  }
}

/**
 * 判断一个文件 ID 应按 ESM 还是 CommonJS 加载。
 *
 * @param filePath - 磁盘路径或以 `\0` 开头的虚拟模块 ID。
 * @param packageCache - 可选 package.json 查找缓存，供无显式模块扩展名的路径复用。
 * @returns 先按 `.mjs/.mts`、`.cjs/.cts` 决定格式，再接受 null-byte ID 为 ESM；其余取最近包的 `type`。
 */
export function isFilePathESM(
  filePath: string,
  packageCache?: PackageCache,
): boolean {
  if (/\.m[jt]s$/.test(filePath)) {
    return true
  } else if (/\.c[jt]s$/.test(filePath)) {
    return false
  } else if (filePath.startsWith('\0')) {
    // 虚拟模块由插件流水线生成，统一按 ESM 处理。
    return true
  } else if (!path.isAbsolute(filePath)) {
    // 非绝对路径若依赖 process.cwd()，结果会随宿主环境变化而不可复现。
    return false
  } else {
    // 普通 .js/.ts 由最近 package.json 的 type 决定模块身份。
    try {
      const pkg = findNearestPackageData(path.dirname(filePath), packageCache)
      return pkg?.data.type === 'module'
    } catch {
      return false
    }
  }
}

/**
 * 判断文件格式是否已由扩展名或最近 package.json 的 type 明确为 ESM/CJS，
 * 而不是仍需依赖默认运行时规则的模糊格式。
 */
export function isFilePathFormatExplicit(
  filePath: string,
  packageCache?: PackageCache,
): boolean {
  if (/\.[mc][jt]s$/.test(filePath)) {
    return true
  }
  if (filePath.startsWith('\0')) {
    // 虚拟模块由插件生成，格式明确按 ESM 处理。
    return true
  }
  if (!path.isAbsolute(filePath)) {
    // 相对路径需要 cwd 才能查包边界，结果不稳定，因此不判定为显式格式。
    return false
  }
  try {
    const pkg = findNearestPackageData(path.dirname(filePath), packageCache)
    return pkg?.data.type === 'module' || pkg?.data.type === 'commonjs'
  } catch {
    return false
  }
}

/** 匹配 LF 或 CRLF 换行，用于源码位置与代码框计算。 */
export const splitRE: RegExp = /\r?\n/g

/** 代码框在目标行上下默认展示的上下文行数。 */
const range: number = 2

/** 为源码每一行添加固定数量的前导空格。 */
export function pad(source: string, n = 2): string {
  const lines = source.split(splitRE)
  return lines.map((l) => ` `.repeat(n) + l).join(`\n`)
}

/** 代码框使用的源码位置；行从 1 开始，列从 0 开始。 */
type Pos = {
  /** 从 1 开始的行号。 */
  line: number
  /** 从 0 开始的列号。 */
  column: number
}

/** 把行列位置转换为零基偏移，每行分隔符按一个字符计算；数字偏移直接返回。 */
export function posToNumber(source: string, pos: number | Pos): number {
  if (typeof pos === 'number') return pos
  const lines = source.split(splitRE)
  const { line, column } = pos
  let start = 0
  for (let i = 0; i < line - 1 && i < lines.length; i++) {
    start += lines[i].length + 1
  }
  return start + column
}

/** 把零基源码偏移转换为行列位置，并拒绝超出源码末尾的偏移。 */
export function numberToPos(source: string, offset: number | Pos): Pos {
  if (typeof offset !== 'number') return offset
  if (offset > source.length) {
    throw new Error(
      `offset is longer than source length! offset ${offset} > length ${source.length}`,
    )
  }

  const lines = source.slice(0, offset).split(splitRE)
  return {
    line: lines.length,
    column: lines[lines.length - 1].length,
  }
}

/** 代码框单行允许展示的最大字符数。 */
const MAX_DISPLAY_LEN = 120
/** 代码框截断长行时使用的省略标记。 */
const ELLIPSIS = '...'

/** 生成带行号、上下文与 `^` 定位线的源码诊断代码框，并截断过长行。 */
export function generateCodeFrame(
  source: string,
  start: number | Pos = 0,
  end?: number | Pos,
): string {
  start = Math.max(posToNumber(source, start), 0)
  end = Math.min(
    end !== undefined ? posToNumber(source, end) : start,
    source.length,
  )
  const lastPosLine =
    end !== undefined
      ? numberToPos(source, end).line
      : numberToPos(source, start).line + range
  const lineNumberWidth = Math.max(3, String(lastPosLine).length + 1)
  const lines = source.split(splitRE)
  let count = 0
  const res: string[] = []
  for (let i = 0; i < lines.length; i++) {
    count += lines[i].length
    if (count >= start) {
      for (let j = i - range; j <= i + range || end > count; j++) {
        if (j < 0 || j >= lines.length) continue
        const line = j + 1
        const lineLength = lines[j].length
        const pad = Math.max(start - (count - lineLength), 0)
        const underlineLength = Math.max(
          1,
          end > count ? lineLength - pad : end - start,
        )

        let displayLine = lines[j]
        let underlinePad = pad
        if (lineLength > MAX_DISPLAY_LEN) {
          let startIdx = 0
          if (j === i) {
            if (underlineLength > MAX_DISPLAY_LEN) {
              startIdx = pad
            } else {
              const center = pad + Math.floor(underlineLength / 2)
              startIdx = Math.max(0, center - Math.floor(MAX_DISPLAY_LEN / 2))
            }
            underlinePad =
              Math.max(0, pad - startIdx) + (startIdx > 0 ? ELLIPSIS.length : 0)
          }
          const prefix = startIdx > 0 ? ELLIPSIS : ''
          const suffix = lineLength - startIdx > MAX_DISPLAY_LEN ? ELLIPSIS : ''
          const sliceLen = MAX_DISPLAY_LEN - prefix.length - suffix.length
          displayLine =
            prefix + displayLine.slice(startIdx, startIdx + sliceLen) + suffix
        }
        res.push(
          `${line}${' '.repeat(lineNumberWidth - String(line).length)}|  ${displayLine}`,
        )
        if (j === i) {
          // 在目标源码片段下一行添加定位下划线。
          const underline = '^'.repeat(
            Math.min(underlineLength, MAX_DISPLAY_LEN),
          )
          res.push(
            `${' '.repeat(lineNumberWidth)}|  ` +
              ' '.repeat(underlinePad) +
              underline,
          )
        } else if (j > i) {
          if (end > count) {
            const length = Math.max(Math.min(end - count, lineLength), 1)
            const underline = '^'.repeat(Math.min(length, MAX_DISPLAY_LEN))
            res.push(`${' '.repeat(lineNumberWidth)}|  ` + underline)
          }
          count += lineLength + 1
        }
      }
      break
    }
    count++
  }
  return res.join('\n')
}

/** 同时检查路径存在及当前进程读权限，判断文件是否可读。 */
export function isFileReadable(filename: string): boolean {
  if (!tryStatSync(filename)) {
    return false
  }

  try {
    // stat 成功不代表当前进程可读，再用 R_OK 验证真实访问权限。
    fs.accessSync(filename, fs.constants.R_OK)

    return true
  } catch {
    return false
  }
}

/** 把相对保留路径拆成首级目录与剩余路径。 */
const splitFirstDirRE = /(.+?)[\\/](.+)/

/**
 * 删除目录内的所有文件和子目录，调用前目录本身必须存在。
 *
 * 可传入相对根目录的 skip 列表保留指定路径；嵌套 skip 会按首段分组并递归传递，
 * 因此既能保留整个顶层项，也能只保留子目录中的部分文件。
 */
export function emptyDir(dir: string, skip?: string[]): void {
  const skipInDir: string[] = []
  let nested: Map<string, string[]> | null = null
  if (skip?.length) {
    for (const file of skip) {
      if (path.dirname(file) !== '.') {
        const matched = splitFirstDirRE.exec(file)
        if (matched) {
          nested ??= new Map()
          const [, nestedDir, skipPath] = matched
          let nestedSkip = nested.get(nestedDir)
          if (!nestedSkip) {
            nestedSkip = []
            nested.set(nestedDir, nestedSkip)
          }
          if (!nestedSkip.includes(skipPath)) {
            nestedSkip.push(skipPath)
          }
        }
      } else {
        skipInDir.push(file)
      }
    }
  }
  for (const file of fs.readdirSync(dir)) {
    if (skipInDir.includes(file)) {
      continue
    }
    if (nested?.has(file)) {
      emptyDir(path.resolve(dir, file), nested.get(file))
    } else {
      fs.rmSync(path.resolve(dir, file), { recursive: true, force: true })
    }
  }
}

/**
 * 递归复制目录内容，并跟随源目录中的符号链接。
 *
 * Node #58768/#59168 修复前不能使用 fs.cpSync；未来切换时还必须设置
 * dereference=true，保持当前跟随链接复制的语义。
 *
 * @see https://github.com/nodejs/node/issues/58768
 * @see https://github.com/nodejs/node/issues/59168
 */
export function copyDir(srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true })
  for (const file of fs.readdirSync(srcDir)) {
    const srcFile = path.resolve(srcDir, file)
    if (srcFile === destDir) {
      continue
    }
    const destFile = path.resolve(destDir, file)
    const stat = fs.statSync(srcFile)
    if (stat.isDirectory()) {
      copyDir(srcFile, destFile)
    } else {
      fs.copyFileSync(srcFile, destFile)
    }
  }
}

/** `recursiveReaddir` 遇到符号链接时写入 Error.code 的稳定错误标识。 */
export const ERR_SYMLINK_IN_RECURSIVE_READDIR =
  'ERR_SYMLINK_IN_RECURSIVE_READDIR'
/**
 * 递归列出目录中的非目录条目，遇到符号链接即拒绝本次扫描。
 *
 * @param dir - 要遍历的目录；不存在时视为空目录。
 * @returns 使用 `normalizePath()` 统一分隔符的绝对文件路径列表。
 * @throws 遇到任意符号链接时抛出 code 为 `ERR_SYMLINK_IN_RECURSIVE_READDIR` 的错误；无权限目录被忽略。
 */
export async function recursiveReaddir(dir: string): Promise<string[]> {
  if (!fs.existsSync(dir)) {
    return []
  }
  let dirents: fs.Dirent[]
  try {
    dirents = await fsp.readdir(dir, { withFileTypes: true })
  } catch (e) {
    if (e.code === 'EACCES') {
      // 无权限目录在递归扫描中按空目录处理。
      return []
    }
    throw e
  }
  if (dirents.some((dirent) => dirent.isSymbolicLink())) {
    const err: any = new Error(
      'Symbolic links are not supported in recursiveReaddir',
    )
    err.code = ERR_SYMLINK_IN_RECURSIVE_READDIR
    throw err
  }
  const files = await Promise.all(
    dirents.map((dirent) => {
      const res = path.resolve(dir, dirent.name)
      return dirent.isDirectory() ? recursiveReaddir(res) : normalizePath(res)
    }),
  )
  return files.flat(1)
}

// fs.realpathSync.native 在 Windows 网络盘的解析结果不同，可能造成后续读文件失败，
// 因此走专用安全实现（Node #37737）。
// https://github.com/nodejs/node/issues/37737
export let safeRealpathSync:
  | typeof windowsSafeRealPathSync
  | typeof fs.realpathSync.native = isWindows
  ? windowsSafeRealPathSync
  : fs.realpathSync.native

// Windows 网络盘映射逻辑基于以下实现：
// https://github.com/larrybahr/windows-network-drive
// MIT License, Copyright (c) 2017 Larry Bahr
/** 从 UNC 网络共享前缀到 Windows 盘符的已探测映射。 */
const windowsNetworkMap = new Map()
/** 把 Windows UNC realpath 按已发现的网络盘映射改写回盘符路径。 */
function windowsMappedRealpathSync(path: string) {
  const realPath = fs.realpathSync.native(path)
  if (realPath.startsWith('\\\\')) {
    for (const [network, volume] of windowsNetworkMap) {
      if (realPath.startsWith(network)) return realPath.replace(network, volume)
    }
  }
  return realPath
}
/** 从 `net use` 输出行中捕获盘符与对应 UNC 根路径。 */
const parseNetUseRE = /^\w* +(\w:) +([^ ]+)\s/
let firstSafeRealPathSyncRun = false

/** 首次调用时探测 Windows realpath 能力，随后使用已选定的安全实现解析路径。 */
function windowsSafeRealPathSync(path: string): string {
  if (!firstSafeRealPathSyncRun) {
    optimizeSafeRealPathSync()
    firstSafeRealPathSyncRun = true
  }
  return fs.realpathSync(path)
}

/** 探测 native realpath 与网络盘映射，并更新进程级 `safeRealpathSync` 实现。 */
function optimizeSafeRealPathSync() {
  // imDisk 等绕过 Volume Mount Manager 的 Windows 虚拟盘/RAM 盘调用 native realpath
  // 可能抛 EISDIR；先探测能力，失败后退回非 native 实现。
  try {
    fs.realpathSync.native(path.resolve('./'))
  } catch (error) {
    if (error.message.includes('EISDIR: illegal operation on a directory')) {
      safeRealpathSync = fs.realpathSync
      return
    }
  }
  exec('net use', { windowsHide: true }, (error, stdout) => {
    if (error) return
    const lines = stdout.split('\n')
    // net use 输出示例：
    // OK  Y:  \\NETWORKA\Foo  Microsoft Windows Network
    // OK  Z:  \\NETWORKA\Bar  Microsoft Windows Network
    for (const line of lines) {
      const m = parseNetUseRE.exec(line)
      if (m) windowsNetworkMap.set(m[2], m[1])
    }
    if (windowsNetworkMap.size === 0) {
      safeRealpathSync = fs.realpathSync.native
    } else {
      safeRealpathSync = windowsMappedRealpathSync
    }
  })
}

/** 把根目录之外、存在且非虚拟 ID 的文件显式加入开发服务器 watcher。 */
export function ensureWatchedFile(
  watcher: FSWatcher,
  file: string | null,
  root: string,
): void {
  if (
    file &&
    // root 内文件已由主 watcher 覆盖，只需额外加入 root 外文件。
    !file.startsWith(withTrailingSlash(root)) &&
    // 部分 Rollup 插件用空字节表示私有 resolved id，这不是磁盘路径。
    !file.includes('\0') &&
    fs.existsSync(file)
  ) {
    // watcher 接收规范化后的系统绝对路径。
    watcher.add(path.resolve(file))
  }
}

/** srcset 或 CSS image-set 中解析出的单个图片候选项。 */
interface ImageCandidate {
  /** 待加载或改写的 URL，可保留引号或 CSS 函数形式。 */
  url: string
  /** URL 后的密度、宽度等候选描述符；没有描述符时为空字符串。 */
  descriptor: string
}

/** 把图片候选项重新序列化为逗号分隔的 srcset 文本。 */
function joinSrcset(ret: ImageCandidate[]) {
  return ret
    .map(({ url, descriptor }) => url + (descriptor ? ` ${descriptor}` : ''))
    .join(', ')
}

/**
 * 对“图片候选字符串”和 image-set 选项的宽松匹配器。
 *
 * 正则提供 url 与 descriptor 两个具名捕获组。url 可为任意 CSS 函数、单双引号
 * CSS 字符串或无引号 URL；descriptor 是空格之后、逗号之前的剩余内容。
 *
 * @see https://html.spec.whatwg.org/multipage/images.html#srcset-attribute
 * @see https://drafts.csswg.org/css-images-4/#image-set-notation
 */
const imageCandidateRegex =
  /(?:^|\s|(?<=,))(?<url>[\w-]+\([^)]*\)|"[^"]*"|'[^']*'|[^,]\S*[^,])\s*(?:\s(?<descriptor>\w[^,]+))?(?:,|$)/g
/** 匹配 srcset 中可折叠为单个空格的普通或 CSS 转义空白。 */
const escapedSpaceCharacters = /(?: |\\t|\\n|\\f|\\r)+/g

/** 宽松解析 srcset/image-set 候选文本，返回非空 URL 与对应描述符。 */
export function parseSrcset(string: string): ImageCandidate[] {
  const matches = string
    .trim()
    .replace(escapedSpaceCharacters, ' ')
    .replace(/\r?\n/, '')
    .replace(/,\s+/, ', ')
    .replaceAll(/\s+/g, ' ')
    .matchAll(imageCandidateRegex)
  return Array.from(matches, ({ groups }) => ({
    url: groups?.url?.trim() ?? '',
    descriptor: groups?.descriptor?.trim() ?? '',
  })).filter(({ url }) => !!url)
}

/** 并行异步改写每个 srcset URL，再以原描述符顺序重新拼接候选列表。 */
export function processSrcSet(
  srcs: string,
  replacer: (arg: ImageCandidate) => Promise<string>,
): Promise<string> {
  return Promise.all(
    parseSrcset(srcs).map(async ({ url, descriptor }) => ({
      url: await replacer({ url, descriptor }),
      descriptor,
    })),
  ).then(joinSrcset)
}

/** 同步改写每个 srcset URL，再以原描述符顺序重新拼接候选列表。 */
export function processSrcSetSync(
  srcs: string,
  replacer: (arg: ImageCandidate) => string,
): string {
  return joinSrcset(
    parseSrcset(srcs).map(({ url, descriptor }) => ({
      url: replacer({ url, descriptor }),
      descriptor,
    })),
  )
}

/** 匹配字符串开头的大写 Windows 盘符前缀。 */
const windowsDriveRE = /^[A-Z]:/
/** 捕获待转义 Windows 绝对路径的盘符。 */
const replaceWindowsDriveRE = /^([A-Z]):\//
/** 匹配单斜杠开头、但不是 UNC 形式的 Linux 绝对路径。 */
const linuxAbsolutePathRE = /^\/[^/]/
/** 把 Windows 与 Linux 绝对路径编码到互不冲突的类 Linux sourcemap 命名空间。 */
function escapeToLinuxLikePath(path: string) {
  if (windowsDriveRE.test(path)) {
    return path.replace(replaceWindowsDriveRE, '/windows/$1/')
  }
  if (linuxAbsolutePathRE.test(path)) {
    return `/linux${path}`
  }
  return path
}

/** 捕获类 Linux sourcemap 路径中的 Windows 盘符命名空间。 */
const revertWindowsDriveRE = /^\/windows\/([A-Z])\//
/** 撤销 sourcemap 合并前添加的 Windows/Linux 路径命名空间。 */
function unescapeToLinuxLikePath(path: string) {
  if (path.startsWith('/linux/')) {
    return path.slice('/linux'.length)
  }
  if (path.startsWith('/windows/')) {
    return path.replace(revertWindowsDriveRE, '$1:/')
  }
  return path
}

// 基于 Svelte mapped_code 工具的空 sourcemap 结构。
// https://github.com/sveltejs/svelte/blob/abf11bb02b2afbd3e4cac509a0f70e318c306364/src/compiler/utils/mapped_code.ts#L221
const nullSourceMap: RawSourceMap = {
  names: [],
  sources: [],
  mappings: '',
  version: 3,
}
/**
 * 把多层转换的 sourcemap 合成为一张最终映射。
 * 中间 map 均只有一个 source 时使用数组链；否则仅沿 filename 对应的 source 加载下一张 map。
 * 空列表或所有 sources 均为空时返回标准空 map。
 */
export function combineSourcemaps(
  filename: string,
  sourcemapList: Array<DecodedSourceMap | RawSourceMap>,
): RawSourceMap {
  if (
    sourcemapList.length === 0 ||
    sourcemapList.every((m) => m.sources.length === 0)
  ) {
    return { ...nullSourceMap }
  }

  // sourcemap 解析器无法正确处理 C:/... 形式的 Windows 绝对路径，先转义为类 Linux
  // 路径；通过复制避免修改插件缓存的 map（Vue 等场景见 #7442）。
  sourcemapList = sourcemapList.map((sourcemap) => {
    const newSourcemaps = { ...sourcemap }
    newSourcemaps.sources = sourcemap.sources.map((source) =>
      source ? escapeToLinuxLikePath(source) : null,
    )
    if (sourcemap.sourceRoot) {
      newSourcemaps.sourceRoot = escapeToLinuxLikePath(sourcemap.sourceRoot)
    }
    return newSourcemaps
  })
  const escapedFilename = escapeToLinuxLikePath(filename)

  // 暂不声明具体类型，允许中间阶段在 SourceMap 与 RawSourceMap 形态间转换。
  let map //: SourceMap
  let mapIndex = 1
  const useArrayInterface =
    sourcemapList.slice(0, -1).find((m) => m.sources.length !== 1) === undefined
  if (useArrayInterface) {
    map = remapping(sourcemapList, () => null)
  } else {
    map = remapping(
      sourcemapList[0],
      /** 只在 source 等于当前 filename 时依次提供下一层 map，其他来源停止继续追溯。 */
      function loader(sourcefile) {
        // 只继续追溯当前文件，其余 source 保留；常见调用在这里合并前后两张 map。
        if (sourcefile === escapedFilename && sourcemapList[mapIndex]) {
          return sourcemapList[mapIndex++]
        } else {
          return null
        }
      }
    )
  }
  if (!map.file) {
    delete map.file
  }

  // 输出前撤销 Windows 路径转义。
  map.sources = map.sources.map((source) =>
    source ? unescapeToLinuxLikePath(source) : source,
  )
  map.file = filename

  return map as RawSourceMap
}

/** 按首次出现顺序移除数组中的重复值。 */
export function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}

/**
 * 当 Node dns.lookup 的 localhost 结果与 verbatim DNS 顺序不同时，返回 Node
 * 实际选中的地址。
 *
 * defaultResultOrder 为 verbatim 时二者必然一致；即使是 ipv4first，在机器或网络
 * 不支持 IPv6 等情况下也可能一致，此时返回 undefined。
 */
export function getLocalhostAddressIfDiffersFromDNS():
  | Promise<string | undefined>
  | undefined {
  // Bun 1.3.11 与 Deno 2.7.11 尚无 getDefaultResultOrder。虽然属于运行时缺陷，
  // 该函数调用频繁，先做能力探测以兼容这些版本。
  if (dns.getDefaultResultOrder && dns.getDefaultResultOrder() === 'verbatim') {
    return undefined
  }
  return Promise.all([
    dns.lookup('localhost'),
    dns.lookup('localhost', { verbatim: true }),
  ]).then(([nodeResult, dnsResult]) => {
    const isSame =
      nodeResult.family === dnsResult.family &&
      nodeResult.address === dnsResult.address
    return isSame ? undefined : nodeResult.address
  })
}

/** 比较服务器本地与网络 URL 列表是否发生变化，忽略外层对象引用差异。 */
export function diffDnsOrderChange(
  oldUrls: ViteDevServer['resolvedUrls'],
  newUrls: ViteDevServer['resolvedUrls'],
): boolean {
  return !(
    oldUrls === newUrls ||
    (oldUrls &&
      newUrls &&
      arrayEqual(oldUrls.local, newUrls.local) &&
      arrayEqual(oldUrls.network, newUrls.network))
  )
}

/** 监听服务器使用的实际 host 与面向用户展示的主机名。 */
export interface Hostname {
  /** 传给 server.listen 的地址；undefined 表示采用 Node 默认监听行为。 */
  host: string | undefined
  /** 用于生成访问 URL 的显示主机名，可能时解析为 localhost。 */
  name: string
}

/** 把 host 选项解析为监听地址与生成 URL 时使用的显示名称。 */
export async function resolveHostname(
  optionsHost: string | boolean | undefined,
): Promise<Hostname> {
  let host: string | undefined
  if (optionsHost === undefined || optionsHost === false) {
    // 安全默认值只监听 localhost。
    host = 'localhost'
  } else if (optionsHost === true) {
    // CLI 只写 --host 而不带值时，undefined 通常表示监听 0.0.0.0 或 :: 的全部接口。
    host = undefined
  } else {
    host = optionsHost
  }

  // 通配监听地址在可访问 URL 中尽可能显示为 localhost。
  let name = host === undefined || wildcardHosts.has(host) ? 'localhost' : host

  if (host === 'localhost') {
    // Node DNS 默认顺序与浏览器不同时改用真实监听地址，详见 #8647。
    const localhostAddr = await getLocalhostAddressIfDiffersFromDNS()
    if (localhostAddr) {
      name = localhostAddr
    }
  }

  return { host, name }
}

/** 从 TLS 证书的 DNS subjectAltName 提取去重后的显示主机名，不探测是否可访问。 */
export function extractHostnamesFromCerts(
  certs: HttpsServerOptions['cert'] | undefined,
): string[] {
  const certList = certs ? arraify(certs) : []
  if (certList.length === 0) return []

  const hostnames = certList
    .map((cert) => {
      try {
        return new crypto.X509Certificate(cert)
      } catch {
        return null
      }
    })
    .flatMap((cert) =>
      cert?.subjectAltName
        ? extractHostnamesFromSubjectAltName(cert.subjectAltName)
        : [],
    )

  return unique(hostnames)
}

/** 根据监听地址、网络接口、TLS 证书与 base 生成本地和局域网访问 URL。 */
export function resolveServerUrls(
  server: Server,
  options: CommonServerOptions,
  hostname: Hostname,
  httpsOptions: HttpsServerOptions | undefined,
  config: ResolvedConfig,
): ResolvedServerUrls {
  const address = server.address()

  /** 将 `server.address()` 的联合返回值收窄为含端口的 AddressInfo。 */
  const isAddressInfo = (x: any): x is AddressInfo => x?.address
  if (!isAddressInfo(address)) {
    return { local: [], network: [], networkInterfaceNames: [] }
  }

  const local: string[] = []
  const network: string[] = []
  // 每个 network URL 对应的接口名，索引顺序必须与 network 一致。
  const networkInterfaceNames: (string | undefined)[] = []
  const protocol = options.https ? 'https' : 'http'
  const port = address.port
  const base =
    config.rawBase === './' || config.rawBase === '' ? '/' : config.rawBase

  if (hostname.host !== undefined && !wildcardHosts.has(hostname.host)) {
    let hostnameName = hostname.name
    // IPv6 主机在 URL 中必须用方括号包裹。
    if (hostnameName.includes(':')) {
      hostnameName = `[${hostnameName}]`
    }
    const address = `${protocol}://${hostnameName}:${port}${base}`
    if (loopbackHosts.has(hostname.host)) {
      local.push(address)
    } else {
      network.push(address)
      // 显式绑定 IP 时反查对应网卡名，供 CLI 地址旁展示。
      let interfaceName: string | undefined
      if (hostname.host) {
        const interfaces = os.networkInterfaces()
        outer: for (const [name, nInterface] of Object.entries(interfaces)) {
          for (const detail of nInterface ?? []) {
            if (detail.address === hostname.host) {
              interfaceName = name
              break outer
            }
          }
        }
      }
      networkInterfaceNames.push(interfaceName)
    }
  } else {
    Object.entries(os.networkInterfaces()).forEach(([name, nInterface]) => {
      ;(nInterface ?? [])
        .filter((detail) => detail.address && detail.family === 'IPv4')
        .forEach((detail) => {
          let host = detail.address.replace('127.0.0.1', hostname.name)
          // IPv6 主机在 URL 中必须用方括号包裹。
          if (host.includes(':')) {
            host = `[${host}]`
          }
          const url = `${protocol}://${host}:${port}${base}`
          if (detail.address.includes('127.0.0.1')) {
            local.push(url)
          } else {
            network.push(url)
            networkInterfaceNames.push(name)
          }
        })
    })
  }

  const hostnamesFromCert = extractHostnamesFromCerts(httpsOptions?.cert)
  if (hostnamesFromCert.length > 0) {
    const existings = new Set([...local, ...network])
    local.push(
      ...hostnamesFromCert
        .map((hostname) => `${protocol}://${hostname}:${port}${base}`)
        .filter((url) => !existings.has(url)),
    )
  }

  return { local, network, networkInterfaceNames }
}

/** 解析 X.509 subjectAltName 文本中的 DNS 项，并过滤无效 IPv4 通配名称。 */
export function extractHostnamesFromSubjectAltName(
  subjectAltName: string,
): string[] {
  const hostnames: string[] = []
  let remaining = subjectAltName
  while (remaining) {
    const nameEndIndex = remaining.indexOf(':')
    const name = remaining.slice(0, nameEndIndex)
    remaining = remaining.slice(nameEndIndex + 1)
    if (!remaining) break

    const isQuoted = remaining[0] === '"'
    let value: string
    if (isQuoted) {
      const endQuoteIndex = remaining.indexOf('"', 1)
      value = JSON.parse(remaining.slice(0, endQuoteIndex + 1))
      remaining = remaining.slice(endQuoteIndex + 1)
    } else {
      const maybeEndIndex = remaining.indexOf(',')
      const endIndex = maybeEndIndex === -1 ? remaining.length : maybeEndIndex
      value = remaining.slice(0, endIndex)
      remaining = remaining.slice(endIndex)
    }
    remaining = remaining.slice(/* 跳过逗号 */ 1).trimStart()

    if (
      name === 'DNS' &&
      // [::1] 已作为本地地址加入，证书 SAN 中再次出现时跳过。
      value !== '[::1]' &&
      // `*.IPv4` 是无效通配证书名称，不能生成访问 URL。
      !(value.startsWith('*.') && net.isIPv4(value.slice(2)))
    ) {
      hostnames.push(value.replace('*', 'vite'))
    }
  }
  return hostnames
}

/** 把单值或数组统一转换为数组，不复制已经是数组的输入。 */
export function arraify<T>(target: T | T[]): T[] {
  return Array.isArray(target) ? target : [target]
}

// 多行注释正则取自 https://stackoverflow.com/a/36328890
export const multilineCommentsRE: RegExp = /\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g
/** 匹配源码中的 `//` 单行注释内容。 */
export const singlelineCommentsRE: RegExp = /\/\/.*/g
/** 在后续内容不像路径或模板闭合符时匹配请求 URL 的查询分隔符。 */
export const requestQuerySplitRE: RegExp = /\?(?!.*[/|}])/
/** 与请求查询分隔规则相同，但同时接受反斜杠转义的问号。 */
export const requestQueryMaybeEscapedSplitRE: RegExp = /\\?\?(?!.*[/|}])/

/** 生成与命中文本等长的空白，供移除注释时保持源码偏移。 */
export const blankReplacer = (match: string): string => ' '.repeat(match.length)

/** 返回文本或 Buffer 的 SHA-256 十六进制摘要；超出 64 位时以下划线补足。 */
export function getHash(text: Buffer | string, length = 8): string {
  const h = crypto.hash('sha256', text, 'hex').substring(0, length)
  if (length <= 64) return h
  return h.padEnd(length, '_')
}

/** 用等长空白替换 CSS 多行注释，保持后续字符偏移不变。 */
export function emptyCssComments(raw: string): string {
  return raw.replace(multilineCommentsRE, blankReplacer)
}

/**
 * 把旧 Worker plugins 配置统一成插件数组。
 * 历史 API 同时接受数组和工厂函数；其他值按空列表处理。
 */
function backwardCompatibleWorkerPlugins(plugins: any) {
  if (Array.isArray(plugins)) {
    return plugins
  }
  if (typeof plugins === 'function') {
    return plugins()
  }
  return []
}

/** 递归移除 readonly，用于表示深克隆后的默认配置可以安全写入。 */
type DeepWritable<T> =
  T extends ReadonlyArray<unknown>
    ? { -readonly [P in keyof T]: DeepWritable<T[P]> }
    : T extends RegExp
      ? RegExp
      : T[keyof T] extends Function
        ? T
        : { -readonly [P in keyof T]: DeepWritable<T[P]> }

/**
 * 深克隆配置默认值支持的结构。
 *
 * 数组和 Object 标签对象递归复制，RegExp 创建新实例，函数保持引用。class 实例若
 * 具有 Object 标签也会复制为普通对象；Map、Set、Date 等其他对象标签会抛错。
 */
export function deepClone<T>(value: T): DeepWritable<T> {
  if (Array.isArray(value)) {
    return value.map((v) => deepClone(v)) as DeepWritable<T>
  }
  if (isObject(value)) {
    const cloned: Record<string, any> = {}
    for (const key in value) {
      cloned[key] = deepClone(value[key])
    }
    return cloned as DeepWritable<T>
  }
  if (typeof value === 'function') {
    return value as DeepWritable<T>
  }
  if (value instanceof RegExp) {
    return new RegExp(value) as DeepWritable<T>
  }
  if (typeof value === 'object' && value != null) {
    throw new Error('Cannot deep clone non-plain object')
  }
  return value as DeepWritable<T>
}

/** values 可能为 undefined 时，类型结果允许回退到默认值。 */
type MaybeFallback<D, V> = undefined extends V ? Exclude<V, undefined> | D : V

/** `mergeWithDefaults()` 的递归类型级合并结果。 */
type MergeWithDefaultsResult<D, V> =
  Equal<D, undefined> extends true
    ? V
    : D extends Function | Array<any>
      ? MaybeFallback<D, V>
      : V extends Function | Array<any>
        ? MaybeFallback<D, V>
        : D extends Record<string, any>
          ? V extends Record<string, any>
            ? {
                [K in keyof D | keyof V]: K extends keyof D
                  ? K extends keyof V
                    ? MergeWithDefaultsResult<D[K], V[K]>
                    : D[K]
                  : K extends keyof V
                    ? V[K]
                    : never
              }
            : MaybeFallback<D, V>
          : MaybeFallback<D, V>

/**
 * 递归填充默认配置的内部实现。
 * undefined 表示“未配置”并保留默认值；null 是用户显式值，必须保留。数组和函数都
 * 整体替换，只有两侧均命中 isObject 的 Object 标签时才继续递归。
 */
function mergeWithDefaultsRecursively<
  D extends Record<string, any>,
  V extends Record<string, any>,
>(defaults: D, values: V): MergeWithDefaultsResult<D, V> {
  const merged: Record<string, any> = defaults
  for (const key in values) {
    const value = values[key]
    // 允许 null 覆盖默认值，例如 `server.watch: null` 用于关闭文件监听。
    if (value === undefined) continue

    const existing = merged[key]
    if (existing === undefined) {
      merged[key] = value
      continue
    }

    if (isObject(existing) && isObject(value)) {
      merged[key] = mergeWithDefaultsRecursively(existing, value)
      continue
    }

    // 数组也整体替换；这是“填充默认值”，不同于 mergeConfig 的用户配置叠加语义。
    merged[key] = value
  }
  return merged as MergeWithDefaultsResult<D, V>
}

/** 匹配 `environments.<name>`，使该节点以下路径重新按环境根配置规则处理。 */
const environmentPathRE = /^environments\.[^.]+$/

/**
 * 用用户值递归覆盖默认值，并保证不修改被冻结或跨项目复用的默认对象。
 *
 * @param defaults - 完整或部分默认配置。
 * @param values - 用户/插件提供的覆盖值。
 * @returns 深克隆默认值后得到的新配置；整体替换的用户值仍保留原引用。
 */
export function mergeWithDefaults<
  D extends Record<string, any>,
  V extends Record<string, any>,
>(defaults: D, values: V): MergeWithDefaultsResult<DeepWritable<D>, V> {
  // 必须先克隆；递归函数会原地写入 defaults，直接传 configDefaults 会污染下次解析。
  const clonedDefaults = deepClone(defaults)
  return mergeWithDefaultsRecursively(clonedDefaults, values)
}

/** 运行时访问旧字段时需要输出弃用告警的配置路径。 */
const runtimeDeprecatedPath = new Set(['optimizeDeps', 'ssr.optimizeDeps'])
/**
 * 输出 `rollupOptions` 弃用信息；设置 VITE_DEPRECATION_TRACE 时改用 trace，帮助定位
 * 是用户配置还是第三方插件仍在写旧字段。
 */
const rollupOptionsDeprecationCall = (() => {
  return () => {
    const method = process.env.VITE_DEPRECATION_TRACE ? 'trace' : 'warn'
    // eslint-disable-next-line no-console
    console[method](
      '`optimizeDeps.rollupOptions` / `ssr.optimizeDeps.rollupOptions` is deprecated. ' +
        'Use `optimizeDeps.rolldownOptions` instead. Note that this option may be set by a plugin. ' +
        (method === 'trace'
          ? 'Showing trace because VITE_DEPRECATION_TRACE is set.'
          : 'Set VITE_DEPRECATION_TRACE=1 to see where it is called.'),
    )
  }
})()

/**
 * 在单个配置对象上建立 `rollupOptions` → `rolldownOptions` 实时兼容代理。
 *
 * 初始值只在新字段缺省时从旧字段迁移；两者同时存在时新字段优先。之后无论读写旧
 * 字段都映射到同一 Rolldown 对象，避免插件在配置钩子中看到不同步快照。
 */
export function setupRollupOptionCompat<
  T extends Pick<BuildEnvironmentOptions, 'rollupOptions' | 'rolldownOptions'>,
>(
  buildConfig: T,
  path: string,
): asserts buildConfig is T & {
  /** 类型层断言为非空；运行时两字段均未提供时仍可能为 undefined，默认值由调用方补齐。 */
  rolldownOptions: Exclude<T['rolldownOptions'], undefined>
} {
  // 两者同时存在时忽略旧 rollupOptions，以显式新配置为准。
  buildConfig.rolldownOptions ??= buildConfig.rollupOptions
  if (
    runtimeDeprecatedPath.has(path) &&
    buildConfig.rollupOptions &&
    buildConfig.rolldownOptions !== buildConfig.rollupOptions
  ) {
    rollupOptionsDeprecationCall()
  }

  // 用 getter/setter 保证后续插件对任一名称的修改都写入同一对象。
  Object.defineProperty(buildConfig, 'rollupOptions', {
    /** 把旧 `rollupOptions` 读取转发到当前 `rolldownOptions`。 */
    get() {
      return buildConfig.rolldownOptions
    },
    /** 把旧字段写入转发到 `rolldownOptions`，并在需提示的路径输出弃用告警。 */
    set(newValue) {
      if (runtimeDeprecatedPath.has(path)) {
        rollupOptionsDeprecationCall()
      }
      buildConfig.rolldownOptions = newValue
    },
    configurable: true,
    enumerable: true,
  })
}

/** 支持 rollupOptions 兼容代理的四个配置根路径。 */
const rollupOptionsRootPaths = new Set([
  'build',
  'worker',
  'optimizeDeps',
  'ssr.optimizeDeps',
])

/**
 * 浅拷贝 Environment 覆盖对象，并为其中的 build 配置建立 Rolldown 兼容代理。
 * build 仍与原对象共享，安装 getter/setter 会修改这层对象；外层属性在副本上合并。
 */
function setupRollupOptionCompatForEnvironment(environment: any): any {
  if (!isObject(environment)) {
    return environment
  }
  const merged: Record<string, any> = { ...environment }
  if (isObject(merged.build)) {
    setupRollupOptionCompat(merged.build, 'build')
  }
  return merged
}

/**
 * 判断用户是否同时提供了引用不同的 rollupOptions 与 rolldownOptions，不比较对象内容。
 * 兼容代理会让两个属性指向同一对象，该情况不算冲突（#22043）。
 */
export function hasBothRollupOptionsAndRolldownOptions(
  options: Record<string, any>,
): boolean {
  for (const opt of [
    options.build,
    options.worker,
    options.optimizeDeps,
    options.ssr?.optimizeDeps,
  ]) {
    if (
      opt != null &&
      opt.rollupOptions != null &&
      opt.rolldownOptions != null &&
      // 排除 setupRollupOptionCompat 创建的同对象代理。
      opt.rollupOptions !== opt.rolldownOptions
    ) {
      return true
    }
  }
  return false
}

/** 从旧 `server.hmr` 迁移到 `server.ws` 的 WebSocket 字段集合。 */
const wsOptionKeys = [
  'protocol',
  'host',
  'port',
  'clientPort',
  'path',
  'timeout',
  'server',
] as const

/** 旧 HMR WebSocket 字段首次被写入时输出一次弃用告警。 */
const hmrWsOptionsDeprecationCall = /* @__PURE__ */ (() => {
  let logged = false
  return () => {
    if (logged) return
    logged = true
    const method = process.env.VITE_DEPRECATION_TRACE ? 'trace' : 'warn'
    // eslint-disable-next-line no-console
    console[method](
      '`server.hmr.protocol/host/port/path/clientPort/timeout/server` is deprecated. ' +
        'Use `server.ws.*` instead. Note that this option may be set by a plugin. ' +
        (method === 'trace'
          ? 'Showing trace because VITE_DEPRECATION_TRACE is set.'
          : 'Set VITE_DEPRECATION_TRACE=1 to see where it is called.'),
    )
  }
})()

/**
 * 把旧 `server.hmr.*` WebSocket 选项同步到 `server.ws.*`，并建立实时代理。
 *
 * HMR 的 overlay 等行为仍属于 `server.hmr`；只有 `wsOptionKeys` 中的连接字段迁移。
 * 新 `server.ws` 值优先，旧字段只补缺省值。插件后续写旧字段时代理会同步并告警。
 *
 * @see https://github.com/vitejs/vite/pull/21357
 */
export function setupHmrWsOptionCompat(
  serverConfig: Pick<ServerOptions, 'hmr' | 'ws'>,
): void {
  if (serverConfig.hmr === false || serverConfig.ws === false) {
    return
  }
  if (serverConfig.hmr === true) {
    serverConfig.hmr = {}
  }

  const hmrConfig = serverConfig.hmr
  const wsConfig = serverConfig.ws ? { ...serverConfig.ws } : {}
  if (hmrConfig) {
    for (const key of wsOptionKeys) {
      if (hmrConfig[key] !== undefined) {
        // 两个配置类型对相同 key 的声明兼容，但 TypeScript 无法关联动态索引。
        // @ts-expect-error 相同 key 对应相同值类型
        wsConfig[key] ??= hmrConfig[key]
      }
    }
  }
  serverConfig.ws = wsConfig

  const hmrProxy = hmrConfig || {}
  for (const key of wsOptionKeys) {
    Object.defineProperty(hmrProxy, key, {
      /** 从当前 `server.ws` 动态读取对应的旧 HMR 连接字段。 */
      get() {
        return (serverConfig.ws as Record<string, unknown>)?.[key]
      },
      /** 把旧 HMR 连接字段写入 `server.ws`，并触发一次性弃用告警。 */
      set(newValue) {
        hmrWsOptionsDeprecationCall()
        if (typeof serverConfig.ws === 'object') {
          ;(serverConfig.ws as Record<string, unknown>)[key] = newValue
        }
      },
      configurable: true,
      enumerable: true,
    })
  }
  serverConfig.hmr = hmrProxy
}

/**
 * 按 Vite 配置语义递归合并两个对象。
 *
 * 大部分对象递归、数组追加、标量以后者覆盖；input、alias、assetsInclude、SSR
 * external、Worker plugins、Rolldown 兼容字段和 HMR/WS 需要专门规则。
 *
 * @param defaults - 低优先级配置。
 * @param overrides - 高优先级配置。
 * @param rootPath - 当前递归路径，用于选择字段专属规则。
 */
function mergeConfigRecursively(
  defaults: Record<string, any>,
  overrides: Record<string, any>,
  rootPath: string,
) {
  const merged: Record<string, any> = { ...defaults }
  if (rollupOptionsRootPaths.has(rootPath)) {
    setupRollupOptionCompat(merged, rootPath)
  }
  if (rootPath === 'server') {
    setupHmrWsOptionCompat(merged)
  }
  if (rootPath === 'server.hmr') {
    for (const key of wsOptionKeys) {
      Object.defineProperty(
        merged,
        key,
        Object.getOwnPropertyDescriptor(defaults, key)!,
      )
    }
  }

  for (const key in overrides) {
    const value = overrides[key]
    // mergeConfig 用于叠加多个有效配置；null/undefined 都表示“不提供覆盖”。
    if (value == null) {
      continue
    }

    let existing = merged[key]
    if (key === 'rollupOptions' && rollupOptionsRootPaths.has(rootPath)) {
      // 两个名称同时存在时忽略旧 rollupOptions；只有旧字段时把它并入新字段。
      if (overrides.rolldownOptions) continue
      existing = merged.rolldownOptions
    }

    if (existing == null) {
      if (rootPath === '' && key === 'environments' && isObject(value)) {
        // 新增整组 environments 时浅拷贝外层；环境内 build 的兼容代理仍安装在共享对象上。
        const environments = { ...value }
        for (const envName in environments) {
          environments[envName] = setupRollupOptionCompatForEnvironment(
            environments[envName],
          )
        }
        merged[key] = environments
      } else if (rootPath === 'environments') {
        // environments 已存在、但当前环境为新增项，也要建立 build 兼容代理。
        merged[key] = setupRollupOptionCompatForEnvironment(value)
      } else {
        merged[key] = value
      }
      continue
    }

    // 下列字段无法使用通用对象/数组规则，需要保持各自公开配置语义。
    if (key === 'input' && rootPath === '') {
      merged[key] = mergeInput(existing, value)
      continue
    } else if (key === 'alias' && (rootPath === 'resolve' || rootPath === '')) {
      merged[key] = mergeAlias(existing, value)
      continue
    } else if (key === 'assetsInclude' && rootPath === '') {
      merged[key] = [].concat(existing, value)
      continue
    } else if (
      (((key === 'noExternal' || key === 'external') &&
        (rootPath === 'ssr' || rootPath === 'resolve')) ||
        (key === 'allowedHosts' && rootPath === 'server')) &&
      (existing === true || value === true)
    ) {
      merged[key] = true
      continue
    } else if (key === 'plugins' && rootPath === 'worker') {
      /** 延迟调用两侧 Worker 插件工厂，并按 defaults、overrides 顺序连接插件数组。 */
      merged[key] = () => [
        ...backwardCompatibleWorkerPlugins(existing),
        ...backwardCompatibleWorkerPlugins(value),
      ]
      continue
    } else if (
      key === 'server' &&
      (rootPath === 'server.hmr' || rootPath === 'server.ws')
    ) {
      merged[key] = value
      continue
    }

    if (Array.isArray(existing) || Array.isArray(value)) {
      // 普通配置数组表示叠加，例如 plugins；统一数组化后保持 defaults → overrides 顺序。
      merged[key] = [...arraify(existing), ...arraify(value)]
      continue
    }
    if (isObject(existing) && isObject(value)) {
      merged[key] = mergeConfigRecursively(
        existing,
        value,
        // `environments.<name>` 以下应重新采用环境根规则。若保留完整路径，
        // environments.ssr.resolve.noExternal 不会命中 resolve 专属合并（#20077）。
        rootPath && !environmentPathRE.test(rootPath)
          ? `${rootPath}.${key}`
          : key,
      )
      continue
    }

    merged[key] = value
  }
  return merged
}

/**
 * 合并两份对象形式的 Vite 配置。
 *
 * 函数式配置依赖 ConfigEnv，不能在没有执行上下文时安全合并，因此明确拒绝。顶层调用
 * 使用所有字段专属规则；内部调用可传 `isRoot: false`，避免把嵌套 input 等误当顶层。
 *
 * @param defaults - 低优先级配置。
 * @param overrides - 高优先级配置。
 * @param isRoot - 是否从配置根开始合并。
 * @returns 新配置对象；不修改两侧顶层对象。
 */
export function mergeConfig<
  D extends Record<string, any>,
  O extends Record<string, any>,
>(
  defaults: D extends Function ? never : D,
  overrides: O extends Function ? never : O,
  isRoot = true,
): Record<string, any> {
  if (typeof defaults === 'function' || typeof overrides === 'function') {
    throw new Error(`Cannot merge config in form of callback`)
  }

  return mergeConfigRecursively(defaults, overrides, isRoot ? '' : '.')
}

/**
 * 合并两种 Rolldown InputOption 形态。
 * 字符串/数组按顺序追加；任一侧为命名对象时，两侧都转换成对象并以后者同名键覆盖。
 */
function mergeInput(a?: InputOption, b?: InputOption): InputOption | undefined {
  if (!a) return b
  if (!b) return a

  if (typeof a === 'string' && typeof b === 'string') {
    return [a, b]
  }
  if (Array.isArray(a) && (typeof b === 'string' || Array.isArray(b))) {
    return [...a, ...(Array.isArray(b) ? b : [b])]
  }
  if (Array.isArray(b) && (typeof a === 'string' || Array.isArray(a))) {
    return [...(Array.isArray(a) ? a : [a]), ...b]
  }
  if (typeof a !== 'string' && !Array.isArray(a)) {
    return {
      ...a,
      ...normalizeToInputObject(b),
    }
  }
  // 到达此处时 b 必为命名入口对象，应覆盖由 a 推导出的同名键。
  return {
    ...normalizeToInputObject(a),
    ...(b as Record<string, string>),
  }
}

/**
 * 把字符串或数组入口转换成命名入口对象。
 * 默认名称取文件 basename 并去除扩展名，以便与显式对象入口合并。
 */
function normalizeToInputObject(input: InputOption): Record<string, string> {
  if (typeof input === 'string') {
    return { [path.basename(input, path.extname(input))]: input }
  }
  if (Array.isArray(input)) {
    return Object.fromEntries(
      input.map((i) => [path.basename(i, path.extname(i)), i]),
    )
  }
  return input
}

/**
 * 合并对象或数组形式的 alias。
 * 对象键直接以后者覆盖；数组按 resolver 自上而下匹配的规则把高优先级项放在前面。
 */
export function mergeAlias(
  a?: AliasOptions,
  b?: AliasOptions,
): AliasOptions | undefined {
  if (!a) return b
  if (!b) return a
  if (isObject(a) && isObject(b)) {
    return { ...a, ...b }
  }
  // alias 自上而下命中即停止；高优先级 overrides 必须排在 defaults 前面。
  return [...normalizeAlias(b), ...normalizeAlias(a)]
}

/** 把对象简写或 alias 数组统一转换成标准 Alias 数组。 */
export function normalizeAlias(o: AliasOptions = []): Alias[] {
  return Array.isArray(o)
    ? o.map(normalizeSingleAlias)
    : Object.keys(o).map((find) =>
        normalizeSingleAlias({
          find,
          replacement: (o as any)[find],
        }),
      )
}

/**
 * 规范化单条 alias，移除 find/replacement 两侧成对的尾斜杠。
 *
 * 两侧同时以 `/` 结尾时，Rollup alias 插件曾产生路径匹配异常；同时移除可保持原匹配
 * 语义并规避该问题。只移除一侧会改变替换结果，所以必须成对判断。
 *
 * @see https://github.com/vitejs/vite/issues/1363
 * @see https://github.com/rollup/plugins/issues/759
 */
function normalizeSingleAlias({
  find,
  replacement,
  customResolver,
}: Alias): Alias {
  if (
    typeof find === 'string' &&
    find.endsWith('/') &&
    replacement.endsWith('/')
  ) {
    find = find.slice(0, find.length - 1)
    replacement = replacement.slice(0, replacement.length - 1)
  }

  const alias: Alias = {
    find,
    replacement,
  }
  if (customResolver) {
    alias.customResolver = customResolver
  }
  return alias
}

/**
 * 为保持行结构的改写生成结果，保持行号是调用方对 MagicString 编辑的约束。
 * dev 返回 null map；build 且启用 sourcemap 时生成边界级映射。
 */
export function transformStableResult(
  s: MagicString,
  id: string,
  config: ResolvedConfig,
): TransformResult {
  return {
    code: s.toString(),
    map:
      config.command === 'build' && config.build.sourcemap
        ? s.generateMap({ hires: 'boundary', source: id })
        : null,
  }
}

/** `asyncFlatten` 返回的已等待、展平元素数组类型。 */
type AsyncFlatten<T extends unknown[]> = T extends (infer U)[]
  ? Exclude<Awaited<U>, U[]>[]
  : never

/** 并行等待数组成员并无限展平；若展开后仍含 Promise，则继续直到全部为最终值。 */
export async function asyncFlatten<T extends unknown[]>(
  arr: T,
): Promise<AsyncFlatten<T>> {
  do {
    arr = (await Promise.all(arr)).flat(Infinity) as any
  } while (arr.some((v: any) => v?.then))
  return arr as unknown[] as AsyncFlatten<T>
}

/** 去掉开头的 UTF-8 BOM，避免解析器把它当作源码字符。 */
export function stripBomTag(content: string): string {
  if (content.charCodeAt(0) === 0xfeff) {
    return content.slice(1)
  }

  return content
}

/**
 * 在大小写不敏感文件系统上逐级核对请求路径与磁盘名称；大小写敏感系统直接返回 true。
 */
export function shouldServeFile(filePath: string, root: string): boolean {
  // 大小写敏感文件系统已由磁盘查找保证，无需额外逐级扫描。
  if (!isCaseInsensitiveFS) return true

  return hasCorrectCase(filePath, root)
}

/** 逐级核对路径大小写；不能使用 realpath，因为这里不应跟随符号链接。 */
function hasCorrectCase(file: string, assets: string): boolean {
  if (file === assets) return true

  const parent = path.dirname(file)

  if (fs.readdirSync(parent).includes(path.basename(file))) {
    return hasCorrectCase(parent, assets)
  }

  return false
}

/** 连接 URL 路径段：移除 a 的一个尾斜杠，并在 b 没有前导斜杠时补一个。 */
export function joinUrlSegments(a: string, b: string): string {
  if (!a || !b) {
    return a || b || ''
  }
  if (a.endsWith('/')) {
    a = a.substring(0, a.length - 1)
  }
  if (b[0] !== '/') {
    b = '/' + b
  }
  return a + b
}

/** 移除字符串开头至多一个 `/`。 */
export function removeLeadingSlash(str: string): string {
  return str[0] === '/' ? str.slice(1) : str
}

/** 在路径位于指定 base 下时去掉 base，同时保留结果的前导 `/`。 */
export function stripBase(path: string, base: string): string {
  if (path === base) {
    return '/'
  }
  const devBase = withTrailingSlash(base)
  return path.startsWith(devBase) ? path.slice(devBase.length - 1) : path
}

/** 以严格相等和相同顺序比较两个一维数组。 */
export function arrayEqual(a: any[], b: any[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * 把字符串作为 JavaScript 表达式求值，并遮蔽常见 CommonJS/进程全局变量。
 * 这不是安全沙箱，调用方必须保证输入可信。
 */
export function evalValue<T = any>(rawValue: string): T {
  const fn = new Function(`
    var console, exports, global, module, process, require
    return (\n${rawValue}\n)
  `)
  return fn()
}

/** 从导入路径提取 npm 顶层包名；不完整的 scoped 路径返回 null。 */
export function getNpmPackageName(importPath: string): string | null {
  const parts = importPath.split('/')
  if (parts[0][0] === '@') {
    if (!parts[1]) return null
    return `${parts[0]}/${parts[1]}`
  } else {
    return parts[0]
  }
}

/** 从包名中提取不含 scope 的名称；scoped 名称缺少第二段时返回 undefined。 */
export function getPkgName(name: string): string | undefined {
  return name[0] === '@' ? name.split('/')[1] : name
}

/** 匹配在正则表达式字面含义中需要转义的元字符。 */
const escapeRegexRE = /[-/\\^$*+?.()|[\]{}]/g
/** 转义字符串中的正则元字符，使结果可作为字面匹配模式。 */
export function escapeRegex(str: string): string {
  return str.replace(escapeRegexRE, '\\$&')
}

/** 可生成命令提示的包管理操作。 */
type CommandType = 'install' | 'uninstall' | 'update'
/** 根据 npm user-agent 推断包管理器，并返回对应安装、卸载或更新命令。 */
export function getPackageManagerCommand(
  type: CommandType = 'install',
): string {
  const packageManager =
    process.env.npm_config_user_agent?.split(' ')[0].split('/')[0] || 'npm'
  switch (type) {
    case 'install':
      return packageManager === 'npm' ? 'npm install' : `${packageManager} add`
    case 'uninstall':
      return packageManager === 'npm'
        ? 'npm uninstall'
        : `${packageManager} remove`
    case 'update':
      return packageManager === 'yarn'
        ? 'yarn upgrade'
        : `${packageManager} update`
    default:
      throw new TypeError(`Unknown command type: ${type}`)
  }
}

/** 通过开发服务器特有的 pluginContainer 字段收窄服务器联合类型。 */
export function isDevServer(
  server: ViteDevServer | PreviewServer,
): server is ViteDevServer {
  return 'pluginContainer' in server
}

/**
 * 创建按调用顺序交付结果的 Promise 队列。
 *
 * 每个任务会立即启动；`run` 的 Promise 需等待前序任务与当前任务，因而仅串行化完成
 * 顺序，不串行化任务执行。前序任务失败也会使后续等待链拒绝。
 *
 * @returns 带 `run()` 的队列；每次调用返回按提交顺序交付的当前任务结果。
 */
export function createSerialPromiseQueue<T>(): {
  /** 立即启动任务，并在此前提交的任务完成后交付其结果。 */
  run(f: () => Promise<T>): Promise<T>
} {
  let previousTask: Promise<[unknown, Awaited<T>]> | undefined

  return {
    /** 把任务链接到当前队尾，同时在成为最后任务并完成后释放 Promise 链。 */
    async run(f) {
      const thisTask = f()
      // 当前任务可立即开始，但返回值必须同时等待前一任务，保证 run 按调用顺序完成。
      const depTasks = Promise.all([previousTask, thisTask])
      previousTask = depTasks

      const [, result] = await depTasks

      // 若当前仍是队尾，清除 previousTask 引用以释放整条已完成 Promise 链。
      if (previousTask === depTasks) {
        previousTask = undefined
      }

      return result
    },
  }
}

/** 浅复制对象，并按字符串升序重排自身可枚举键。 */
export function sortObjectKeys<T extends Record<string, any>>(obj: T): T {
  const sorted: Record<string, any> = {}
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key]
  }
  return sorted as T
}

/** 把毫秒时长格式化为紧凑的 ms、s 或 m/s 日志文本。 */
export function displayTime(time: number): string {
  // 小于一秒：显示 `{X}ms`。
  if (time < 1000) {
    return `${time}ms`
  }

  time = time / 1000

  // 小于一分钟：显示 `{X}s`。
  if (time < 60) {
    return `${time.toFixed(2)}s`
  }

  // 计算完整分钟与剩余秒数。
  const mins = Math.floor(time / 60)
  const seconds = Math.round(time % 60)

  // 四舍五入得到 60 秒时进位，避免展示 `1m 60s`。
  if (seconds === 60) {
    return `${mins + 1}m`
  }

  // 一分钟以上：显示 `{X}m {Y}s`。
  return `${mins}m${seconds < 1 ? '' : ` ${seconds}s`}`
}

/** 只编码 URI 的路径部分，保留 `?` 或 `#` 之后的查询与片段原文。 */
export function encodeURIPath(uri: string): string {
  if (uri.startsWith('data:')) return uri
  const filePath = cleanUrl(uri)
  const postfix = filePath !== uri ? uri.slice(filePath.length) : ''
  return encodeURI(filePath) + postfix
}

/**
 * 类似 encodeURIPath，但只把 `%` 替换为 `%25`。适用于能处理未编码 URI、仅把
 * 百分号视为歧义字符的运行环境。
 */
export function partialEncodeURIPath(uri: string): string {
  if (uri.startsWith('data:')) return uri
  const filePath = cleanUrl(uri)
  const postfix = filePath !== uri ? uri.slice(filePath.length) : ''
  return filePath.replaceAll('%', '%25') + postfix
}

/** 尝试解码完整 URI；遇到非法百分号转义时返回 undefined 而不抛错。 */
export function decodeURIIfPossible(input: string): string | undefined {
  try {
    return decodeURI(input)
  } catch {
    // 非法 URL 常来自模板引擎插值语法；调用方会保留原值或选择其他解析路径。
    return
  }
}

/** 开发服务器收到 SIGTERM 或 stdin 结束时执行的异步清理回调。 */
type SigtermCallback = (signal?: 'SIGTERM', exitCode?: number) => Promise<void>

// 所有消费者共享一个进程级 SIGTERM listener，避免 MaxListenersExceededWarning。
const sigtermCallbacks = new Set<SigtermCallback>()
/** 并行分发进程终止事件给当前已登记的全部清理回调。 */
const parentSigtermCallback: SigtermCallback = async (signal, exitCode) => {
  await Promise.all([...sigtermCallbacks].map((cb) => cb(signal, exitCode)))
}

/** 注册共享终止清理回调，并在首个回调加入时安装进程级监听器。 */
export const setupSIGTERMListener = (
  callback: (signal?: 'SIGTERM', exitCode?: number) => Promise<void>,
): void => {
  if (sigtermCallbacks.size === 0) {
    process.once('SIGTERM', parentSigtermCallback)
    if (process.env.CI !== 'true') {
      process.stdin.on('end', parentSigtermCallback)
    }
  }
  sigtermCallbacks.add(callback)
}

/** 注销终止清理回调，并在集合清空时移除进程级监听器。 */
export const teardownSIGTERMListener = (
  callback: Parameters<typeof setupSIGTERMListener>[0],
): void => {
  sigtermCallbacks.delete(callback)
  if (sigtermCallbacks.size === 0) {
    process.off('SIGTERM', parentSigtermCallback)
    if (process.env.CI !== 'true') {
      process.stdin.off('end', parentSigtermCallback)
    }
  }
}

/** 优先返回包含显式 host 的服务器 URL，否则回退到首个本地或网络 URL。 */
export function getServerUrlByHost(
  resolvedUrls: ResolvedServerUrls | null,
  host: CommonServerOptions['host'],
): string | undefined {
  if (typeof host === 'string') {
    const matchedUrl = [
      ...(resolvedUrls?.local ?? []),
      ...(resolvedUrls?.network ?? []),
    ].find((url) => url.includes(host))
    if (matchedUrl) {
      return matchedUrl
    }
  }
  return resolvedUrls?.local[0] ?? resolvedUrls?.network[0]
}

let lastDateNow = 0
/**
 * 返回类似 Date.now()、但严格单调递增的数值。
 *
 * 即使同一毫秒多次调用或系统时钟回拨，也绝不返回相同/更小值，因此可能与真实
 * 时间存在偏差。HMR 用它生成版本戳，避免缓存 URL 倒退。
 * @see https://github.com/vitejs/vite/issues/19804
 */
export function monotonicDateNow(): number {
  const now = Date.now()
  if (now > lastDateNow) {
    lastDateNow = now
    return lastDateNow
  }

  lastDateNow++
  return lastDateNow
}

/**
 * 把文件列表格式化为日志文本；首项始终保留，追加后续项会达到 500 字符时改写为
 * 剩余文件数量。
 */
export function formatAndTruncateFileList(files: string[]): {
  /** 逗号分隔且可能带 `and N more` 后缀的日志文本。 */
  formatted: string
  /** 是否因长度预算省略了一个或多个文件名。 */
  truncated: boolean
} {
  const MAX_LOG_LENGTH = 500
  let log = ''
  let truncated = false
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (log === '') {
      log = file
    } else if (log.length + 2 + file.length < MAX_LOG_LENGTH) {
      log += ', ' + file
    } else {
      log += ` and ${files.length - i} more`
      truncated = true
      break
    }
  }
  return { formatted: log, truncated }
}

/** 匹配字符串末尾的 ECMAScript 行终止符。 */
export const lineTerminatorRE: RegExp = /[\r\n\u2028\u2029]$/

/** 匹配文件开头完整 hashbang 行及其可选行终止符。 */
const hashbangRE = /^#![^\r\n\u2028\u2029]*(?:\r\n|[\r\n\u2028\u2029])?/

/** 返回 hashbang 之后的源码起点；没有 hashbang 时返回 0。 */
export function getFileStartIndex(code: string): number {
  return hashbangRE.exec(code)?.[0].length ?? 0
}
