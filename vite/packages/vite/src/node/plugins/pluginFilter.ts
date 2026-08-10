import path from 'node:path'
import picomatch from 'picomatch'
import type { ModuleTypeFilter } from 'rolldown'
import { arraify } from '../utils'
import { slash } from '../../shared/utils'

/** 已编译的单字符串 hook 过滤函数。 */
export type PluginFilter = (input: string) => boolean

/** transform 的联合过滤函数；ID、源码和模块类型条件采用 AND 语义。 */
export type TransformHookFilter = (
  id: string,
  code: string,
  moduleType: string,
) => boolean

/**
 * 插件 hook 接受的字符串过滤描述。
 * 简单值/数组表示 include，也可显式同时声明 include 与 exclude；exclude 始终优先。
 */
export type StringFilter<Value = string | RegExp> =
  | Value
  | Array<Value>
  | {
      /** 仅匹配这些模式的文件会进入处理流程。 */
      include?: Value | Array<Value>
      /** 匹配这些模式的文件会被排除在处理流程外。 */
      exclude?: Value | Array<Value>
    }

/** 统一为数组后的内部字符串过滤描述。 */
type NormalizedStringFilter = {
  /** 仅匹配这些模式的文件会进入处理流程。 */
  include?: Array<string | RegExp>
  /** 匹配这些模式的文件会被排除在处理流程外。 */
  exclude?: Array<string | RegExp>
}

/**
 * 把 ID glob 转成 picomatch 可匹配的路径。
 * `**` 开头和绝对 glob 已自带位置语义；其他相对 glob 以 cwd 为根。统一正斜杠保证
 * Windows 与 POSIX 结果一致。
 */
function getMatcherString(glob: string, cwd: string) {
  if (glob.startsWith('**') || path.isAbsolute(glob)) {
    return slash(glob)
  }

  const resolved = path.join(cwd, glob)
  return slash(resolved)
}

/** 把一个 ID 正则或 glob 编译成过滤函数。 */
function patternToIdFilter(
  pattern: string | RegExp,
  cwd: string,
): PluginFilter {
  if (pattern instanceof RegExp) {
    return (id: string) => {
      const normalizedId = slash(id)
      const result = pattern.test(normalizedId)
      // 全局/粘滞正则会修改 lastIndex；复位后同一 filter 才能稳定处理后续模块。
      pattern.lastIndex = 0
      return result
    }
  }

  const glob = getMatcherString(pattern, cwd)
  const matcher = picomatch(glob, { dot: true })
  return (id: string) => {
    const normalizedId = slash(id)
    return matcher(normalizedId)
  }
}

/**
 * 把源码过滤模式编译成函数。字符串按字面子串匹配，不按 glob 解释；正则复位 lastIndex。
 */
function patternToCodeFilter(pattern: string | RegExp): PluginFilter {
  if (pattern instanceof RegExp) {
    return (code: string) => {
      const result = pattern.test(code)
      pattern.lastIndex = 0
      return result
    }
  }
  return (code: string) => code.includes(pattern)
}

/**
 * 组合多条 include/exclude：任一 exclude 命中立即拒绝；否则任一 include 命中才接受。
 * 没有 include 时默认接受所有未被排除的输入；两侧都为空则不创建过滤函数。
 */
function createFilter(
  exclude: Array<PluginFilter> | undefined,
  include: Array<PluginFilter> | undefined,
): PluginFilter | undefined {
  if (!exclude && !include) {
    return
  }

  return (input) => {
    if (exclude?.some((filter) => filter(input))) {
      return false
    }
    if (include?.some((filter) => filter(input))) {
      return true
    }
    return !(include && include.length > 0)
  }
}

/** 把简单值、数组或对象写法统一成 include/exclude 数组。 */
function normalizeFilter(filter: StringFilter): NormalizedStringFilter {
  if (typeof filter === 'string' || filter instanceof RegExp) {
    return {
      include: [filter],
    }
  }
  if (Array.isArray(filter)) {
    return {
      include: filter,
    }
  }
  return {
    include: filter.include ? arraify(filter.include) : undefined,
    exclude: filter.exclude ? arraify(filter.exclude) : undefined,
  }
}

/**
 * 创建 resolveId/load 使用的模块 ID 过滤器。
 * 相对字符串模式以 cwd 为根，正则和绝对/`**` glob 保持自身匹配范围。
 */
export function createIdFilter(
  filter: StringFilter | undefined,
  cwd: string = process.cwd(),
): PluginFilter | undefined {
  if (!filter) return
  const { exclude, include } = normalizeFilter(filter)
  const excludeFilter = exclude?.map((p) => patternToIdFilter(p, cwd))
  const includeFilter = include?.map((p) => patternToIdFilter(p, cwd))
  return createFilter(excludeFilter, includeFilter)
}

/** 创建 transform 使用的源码内容过滤器。 */
export function createCodeFilter(
  filter: StringFilter | undefined,
): PluginFilter | undefined {
  if (!filter) return
  const { exclude, include } = normalizeFilter(filter)
  const excludeFilter = exclude?.map(patternToCodeFilter)
  const includeFilter = include?.map(patternToCodeFilter)
  return createFilter(excludeFilter, includeFilter)
}

/** 把 Rolldown ModuleTypeFilter 编译为模块类型成员判断。 */
function createModuleTypeFilter(
  filter: ModuleTypeFilter | undefined,
): PluginFilter | undefined {
  if (!filter) return
  const include = Array.isArray(filter) ? filter : (filter.include ?? [])
  return (moduleType: string) => include.includes(moduleType)
}

/**
 * 合并 transform hook 的 ID、源码和 moduleType 过滤条件。
 * 条件间采用短路 AND；任何一项不匹配都不会调用插件 handler。全部缺省时返回
 * undefined，让调用方跳过额外函数调用（#19602、#19736）。
 */
export function createFilterForTransform(
  idFilter: StringFilter | undefined,
  codeFilter: StringFilter | undefined,
  moduleTypeFilter: ModuleTypeFilter | undefined,
  cwd?: string,
): TransformHookFilter | undefined {
  if (!idFilter && !codeFilter && !moduleTypeFilter) return
  const idFilterFn = createIdFilter(idFilter, cwd)
  const codeFilterFn = createCodeFilter(codeFilter)
  const moduleTypeFilterFn = createModuleTypeFilter(moduleTypeFilter)
  return (id, code, moduleType) => {
    // 先检查最便宜的 moduleType，再检查 ID，最后才扫描可能很长的源码字符串。
    let fallback = moduleTypeFilterFn?.(moduleType) ?? true
    if (!fallback) {
      return false
    }

    if (idFilterFn) {
      fallback &&= idFilterFn(id)
    }
    if (!fallback) {
      return false
    }

    if (codeFilterFn) {
      fallback &&= codeFilterFn(code)
    }
    return fallback
  }
}
