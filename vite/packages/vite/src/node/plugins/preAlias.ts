import path from 'node:path'
import fs from 'node:fs'
import type {
  Alias,
  AliasOptions,
  DepOptimizationOptions,
  DevEnvironment,
  ResolvedConfig,
} from '..'
import type { Plugin } from '../plugin'
import {
  bareImportRE,
  isInNodeModules,
  isOptimizable,
  moduleListContains,
} from '../utils'
import { cleanUrl, withTrailingSlash } from '../../shared/utils'
import { isDepOptimizationDisabled } from '../optimizer'
import { tryOptimizedResolve } from './resolve'

/**
 * alias 之前的开发插件：若裸 specifier 同时命中 alias 且已有优化产物，直接返回优化 URL，避免 alias
 * 先把它展开成源码路径而绕过 optimizer；尚未优化时可登记 missing 并返回预计算入口 URL。
 */
export function preAliasPlugin(config: ResolvedConfig): Plugin {
  const findPatterns = getAliasPatterns(config.resolve.alias)
  return {
    name: 'vite:pre-alias',
    /** 预别名只在依赖优化器启用的环境运行。 */
    applyToEnvironment(environment) {
      if (environment.config.isBundled) {
        return false
      }
      return !isDepOptimizationDisabled(environment.config.optimizeDeps)
    },
    /** 在普通 alias 前识别已优化依赖，避免重复优化并处理别名命中。 */
    async resolveId(id, importer, options) {
      const environment = this.environment as DevEnvironment
      const ssr = environment.config.consumer === 'server'
      const depsOptimizer = environment.depsOptimizer
      if (
        importer &&
        depsOptimizer &&
        bareImportRE.test(id) &&
        !options.scan &&
        id !== '@vite/client' &&
        id !== '@vite/env'
      ) {
        if (findPatterns.find((pattern) => matches(pattern, id))) {
          const optimizedId = await tryOptimizedResolve(
            depsOptimizer,
            id,
            importer,
            config.resolve.preserveSymlinks,
            config.packageCache,
          )
          if (optimizedId) {
            return optimizedId // alias 目标已有优化产物。
          }
          if (depsOptimizer.options.noDiscovery) {
            return
          }
          const resolved = await this.resolve(id, importer, options)
          if (resolved && !depsOptimizer.isOptimizedDepFile(resolved.id)) {
            const optimizeDeps = depsOptimizer.options
            const resolvedId = cleanUrl(resolved.id)
            const isVirtual = resolvedId === id || resolvedId.includes('\0')
            if (
              !isVirtual &&
              fs.existsSync(resolvedId) &&
              !moduleListContains(optimizeDeps.exclude, id) &&
              path.isAbsolute(resolvedId) &&
              (isInNodeModules(resolvedId) ||
                optimizeDeps.include?.includes(id)) &&
              isOptimizable(resolvedId, optimizeDeps) &&
              (!ssr || optimizeAliasReplacementForSSR(resolvedId, optimizeDeps))
            ) {
              // alias 目标可优化但尚未处理，加入下一批 missing。
              const optimizedInfo = depsOptimizer!.registerMissingImport(
                id,
                resolvedId,
              )
              return { id: depsOptimizer!.getOptimizedDepId(optimizedInfo) }
            }
          }
          return resolved
        }
      }
    },
  }
}

/** SSR 只有 include 明确包含解析后的 replacement 文件路径，才自动登记该别名依赖。 */
function optimizeAliasReplacementForSSR(
  id: string,
  optimizeDeps: DepOptimizationOptions,
) {
  if (optimizeDeps.include?.includes(id)) {
    return true
  }
  // 普通 SSR 解析可按 package/CJS 判断默认优化；此处只有 replacement 文件路径，缺 package 身份。
  // 此处不根据路径猜测默认优化资格；include 需包含传入的 replacement 路径。
  return false
}

/** 与 Rollup alias 插件一致：字符串 pattern 只匹配自身或 `/` 子路径，正则直接测试。 */
function matches(pattern: string | RegExp, importee: string) {
  if (pattern instanceof RegExp) {
    return pattern.test(importee)
  }
  if (importee.length < pattern.length) {
    return false
  }
  if (importee === pattern) {
    return true
  }
  return importee.startsWith(withTrailingSlash(pattern))
}

/** 从数组或对象式 alias 配置中提取全部匹配模式。 */
function getAliasPatterns(
  entries: (AliasOptions | undefined) & Alias[],
): (string | RegExp)[] {
  if (Array.isArray(entries)) {
    return entries.map((entry) => entry.find)
  }
  return Object.entries(entries).map(([find]) => find)
}

/** 把 alias 配置编译为供 Import Analysis 判断“external URL 是否仍需先走 alias”的谓词。 */
export function getAliasPatternMatcher(
  entries: (AliasOptions | undefined) & Alias[],
): (importee: string) => boolean {
  const patterns = getAliasPatterns(entries)
  return (importee: string) =>
    patterns.some((pattern) => matches(pattern, importee))
}
