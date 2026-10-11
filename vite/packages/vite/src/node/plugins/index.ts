import aliasPlugin, { type ResolverFunction } from '@rollup/plugin-alias'
import colors from 'picocolors'
import type { ObjectHook } from 'rolldown'
import {
  viteAliasPlugin as nativeAliasPlugin,
  viteJsonPlugin as nativeJsonPlugin,
  oxcRuntimePlugin,
} from 'rolldown/experimental'
import type { PluginHookUtils, ResolvedConfig } from '../config'
import {
  type HookHandler,
  type Plugin,
  type PluginWithRequiredHook,
} from '../plugin'
import { watchPackageDataPlugin } from '../packages'
import { resolveBuildPlugins } from '../build'
import { oxcResolvePlugin } from './resolve'
import { optimizedDepsPlugin } from './optimizedDeps'
import { importAnalysisPlugin } from './importAnalysis'
import { cssAnalysisPlugin, cssPlugin, cssPostPlugin } from './css'
import { assetPlugin } from './asset'
import { clientInjectionsPlugin } from './clientInjections'
import { buildHtmlPlugin, htmlInlineProxyPlugin } from './html'
import { wasmHelperPlugin } from './wasm'
import { modulePreloadPolyfillPlugin } from './modulePreloadPolyfill'
import { webWorkerPlugin } from './worker'
import { preAliasPlugin } from './preAlias'
import { definePlugin } from './define'
import { workerImportMetaUrlPlugin } from './workerImportMetaUrl'
import { assetImportMetaUrlPlugin } from './assetImportMetaUrl'
import { dynamicImportVarsPlugin } from './dynamicImportVars'
import { importGlobPlugin } from './importMetaGlob'
import {
  type PluginFilter,
  type TransformHookFilter,
  createFilterForTransform,
  createIdFilter,
} from './pluginFilter'
import { forwardConsolePlugin } from './forwardConsole'
import { oxcPlugin } from './oxc'
import { esbuildBannerFooterCompatPlugin } from './esbuildBannerFooterCompatPlugin'

/**
 * 按 Vite 约定把用户插件与内部插件装配成最终应用级流水线。
 *
 * 这里决定“插件层级”顺序：依赖/alias → 用户 pre → 核心转换 → 用户 normal →
 * 构建前置 → 用户 post → 构建后置 → 服务器收尾分析。单个 hook 的对象级 `order` 由
 * {@link getSortedPluginsByHook} 在调用时二次排序。
 *
 * 只要任一 Environment 使用 bundled 模式，即使 command 是 serve，也需装配构建插件；
 * Worker 不安装主应用的 package watcher 和 DevTools。
 */
export async function resolvePlugins(
  config: ResolvedConfig,
  prePlugins: Plugin[],
  normalPlugins: Plugin[],
  postPlugins: Plugin[],
): Promise<Plugin[]> {
  const isBuild = config.command === 'build'
  const isWorker = config.isWorker
  const anyEnvBundled =
    isBuild || Object.values(config.environments).some((env) => env.isBundled)
  const buildPlugins = anyEnvBundled
    ? resolveBuildPlugins(config)
    : { pre: [], post: [] }
  const devtoolsIntegrationPlugin =
    config.devtools.enabled && !isWorker
      ? await loadDevToolsIntegrationPlugin(config)
      : null
  const { modulePreload } = config.build

  return [
    optimizedDepsPlugin(),
    !isWorker ? watchPackageDataPlugin(config.packageCache) : null,
    preAliasPlugin(config),
    {
      ...aliasPlugin({
        // @ts-expect-error aliasPlugin receives rollup types
        entries: config.resolve.alias,
        customResolver: viteAliasCustomResolver,
      }),
      /** bundled 环境可用原生 alias；有用户 customResolver 时保留 JS 插件。 */
      applyToEnvironment(environment) {
        // 打包环境且不存在用户 customResolver 时，换成 Rolldown 原生 alias 插件；
        // 自定义 resolver 仍需保留 @rollup/plugin-alias 的完整行为。
        if (
          environment.config.isBundled &&
          !environment.config.resolve.alias.some((v) => v.customResolver)
        ) {
          return nativeAliasPlugin({
            entries: config.resolve.alias.map((item) => {
              return {
                find: item.find,
                replacement: item.replacement,
              }
            }),
          })
        }
        return true
      },
    } as Plugin,

    ...prePlugins,

    modulePreload !== false && modulePreload.polyfill
      ? modulePreloadPolyfillPlugin()
      : null,
    ...oxcResolvePlugin(
      {
        root: config.root,
        isProduction: config.isProduction,
        isBuild,
        packageCache: config.packageCache,
        asSrc: true,
        optimizeDeps: true,
        externalize: true,
        legacyInconsistentCjsInterop: config.legacy?.inconsistentCjsInterop,
      },
      isWorker
        ? {
            ...config,
            consumer: 'client',
            isBundled: true,
            optimizeDepsPluginNames: [],
          }
        : undefined,
    ),
    htmlInlineProxyPlugin(config),
    cssPlugin(config),
    esbuildBannerFooterCompatPlugin(config),
    // 打包环境由 Rolldown 自行解析 @oxc-project/runtime；仅非打包环境安装 runtime 插件。
    config.oxc !== false
      ? ({
          ...oxcRuntimePlugin(),
          /** 仅在非打包环境补充 Oxc helper 的模块解析。 */
          applyToEnvironment(environment) {
            return !environment.config.isBundled
          },
        } satisfies Plugin)
      : null,
    config.oxc !== false ? oxcPlugin(config) : null,
    nativeJsonPlugin({ ...config.json, minify: isBuild }),
    wasmHelperPlugin(),
    webWorkerPlugin(config),
    assetPlugin(config),
    // 浏览器控制台转发目前只适用于 client Environment。
    config.server.forwardConsole.enabled &&
      forwardConsolePlugin({ environments: ['client'] }),

    ...normalPlugins,

    definePlugin(config),
    cssPostPlugin(config),
    buildHtmlPlugin(config),
    workerImportMetaUrlPlugin(config),
    assetImportMetaUrlPlugin(config),
    ...buildPlugins.pre,
    dynamicImportVarsPlugin(config),
    importGlobPlugin(config),

    ...postPlugins,

    ...buildPlugins.post,
    devtoolsIntegrationPlugin,

    // 服务器端注入、CSS 分析和 import analysis 必须观察所有前序转换后的最终代码。
    clientInjectionsPlugin(config),
    cssAnalysisPlugin(config),
    importAnalysisPlugin(config),
  ].filter(Boolean) as Plugin[]
}

/** 按需加载可选 DevTools 插件；失败只记录错误，不让辅助工具阻断项目构建。 */
async function loadDevToolsIntegrationPlugin(
  config: ResolvedConfig,
): Promise<Plugin | null> {
  try {
    const { DevToolsIntegration } = await import('@vitejs/devtools/integration')
    return DevToolsIntegration({ config })
  } catch (error: any) {
    config.logger.error(
      colors.red(
        `Failed to load Vite DevTools integration: ${error?.message || error?.stack}`,
      ),
      { error },
    )
    return null
  }
}

/**
 * 为固定插件列表创建按 hook 查询和 handler 查询工具。
 * 每个 hook 第一次查询时排序并缓存；后续同名查询直接复用结果，不重新观察插件列表或
 * hook.order 的变化。Environment 会对 configResolved 后派生的插件列表另建查询工具。
 */
export function createPluginHookUtils(
  plugins: readonly Plugin[],
): PluginHookUtils {
  // 不同 hook 可声明不同 order，必须分别排序和缓存。
  const sortedPluginsCache = new Map<keyof Plugin, Plugin[]>()
  /** 按 pre、normal、post 顺序返回实现指定钩子的插件列表。 */
  function getSortedPlugins<K extends keyof Plugin>(
    hookName: K,
  ): PluginWithRequiredHook<K>[] {
    if (sortedPluginsCache.has(hookName))
      return sortedPluginsCache.get(hookName) as PluginWithRequiredHook<K>[]
    const sorted = getSortedPluginsByHook(hookName, plugins)
    sortedPluginsCache.set(hookName, sorted)
    return sorted
  }
  /** 在插件排序基础上提取指定钩子处理器，供调用路径直接遍历。 */
  function getSortedPluginHooks<K extends keyof Plugin>(
    hookName: K,
  ): NonNullable<HookHandler<Plugin[K]>>[] {
    const plugins = getSortedPlugins(hookName)
    return plugins.map((p) => getHookHandler(p[hookName])).filter(Boolean)
  }

  return {
    getSortedPlugins,
    getSortedPluginHooks,
  }
}

/**
 * 选出声明了指定 hook 的插件，并按 hook 对象的 `order: pre | post` 稳定排序。
 *
 * 通过 pre/normal/post 三个边界直接插入结果数组，避免每次 hook 查询创建三个临时数组。
 * 同一层级仍保持插件流水线中的原始顺序。
 */
export function getSortedPluginsByHook<K extends keyof Plugin>(
  hookName: K,
  plugins: readonly Plugin[],
): PluginWithRequiredHook<K>[] {
  const sortedPlugins: Plugin[] = []
  // 三个计数器同时表示下一项在结果数组中的插入边界。
  let pre = 0,
    normal = 0,
    post = 0
  for (const plugin of plugins) {
    const hook = plugin[hookName]
    if (hook) {
      if (typeof hook === 'object') {
        if (hook.order === 'pre') {
          sortedPlugins.splice(pre++, 0, plugin)
          continue
        }
        if (hook.order === 'post') {
          sortedPlugins.splice(pre + normal + post++, 0, plugin)
          continue
        }
      }
      sortedPlugins.splice(pre + normal++, 0, plugin)
    }
  }

  return sortedPlugins as PluginWithRequiredHook<K>[]
}

/** 从普通函数 hook 或 `{ handler, order, filter }` 对象中取出实际处理函数。 */
export function getHookHandler<T extends ObjectHook<Function>>(
  hook: T,
): HookHandler<T> {
  return (typeof hook === 'object' ? hook.handler : hook) as HookHandler<T>
}

/** 单个插件三个高频模块 hook 的已编译过滤函数。 */
type FilterForPluginValue = {
  /** resolveId 钩子可声明的字符串或正则过滤器。 */
  resolveId?: PluginFilter | undefined
  /** load 钩子可声明的模块 ID 过滤器。 */
  load?: PluginFilter | undefined
  /** transform 钩子可声明的 ID 与代码过滤器。 */
  transform?: TransformHookFilter | undefined
}

/**
 * 以插件对象弱引用缓存 hook filter，避免每次模块请求重复编译 glob/正则。
 * WeakMap 不阻止服务器重启后旧插件实例被回收。
 */
const filterForPlugin = new WeakMap<Plugin, FilterForPluginValue>()

/**
 * 获取并缓存 resolveId/load/transform 对象 hook 的过滤函数。
 * 用 `hookName in filters` 区分“尚未计算”与“计算结果就是 undefined”，否则无 filter 的
 * 插件会在每个请求中重复归一化。
 */
export function getCachedFilterForPlugin<
  H extends 'resolveId' | 'load' | 'transform',
>(plugin: Plugin, hookName: H): FilterForPluginValue[H] | undefined {
  let filters = filterForPlugin.get(plugin)
  if (filters && hookName in filters) {
    return filters[hookName]
  }

  if (!filters) {
    filters = {}
    filterForPlugin.set(plugin, filters)
  }

  let filter: PluginFilter | TransformHookFilter | undefined
  switch (hookName) {
    case 'resolveId': {
      const rawFilter = extractFilter(plugin.resolveId)?.id
      filters.resolveId = createIdFilter(rawFilter)
      filter = filters.resolveId
      break
    }
    case 'load': {
      const rawFilter = extractFilter(plugin.load)?.id
      filters.load = createIdFilter(rawFilter)
      filter = filters.load
      break
    }
    case 'transform': {
      const rawFilters = extractFilter(plugin.transform)
      filters.transform = createFilterForTransform(
        rawFilters?.id,
        rawFilters?.code,
        rawFilters?.moduleType,
      )
      filter = filters.transform
      break
    }
  }
  return filter as FilterForPluginValue[H] | undefined
}

/** 仅从对象形式 ObjectHook 提取可选 filter；普通函数 hook 没有声明式过滤器。 */
function extractFilter<T extends Function, F>(
  hook:
    | ObjectHook<
        T,
        {
          /** 对象式钩子声明、可提前筛掉无关模块的过滤条件。 */
          filter?: F
        }
      >
    | undefined,
) {
  return hook && 'filter' in hook && hook.filter ? hook.filter : undefined
}

/**
 * Vite 的 alias 默认 customResolver。
 * 与 `@rollup/plugin-alias` 默认实现相同地委托 `this.resolve()`；解析失败时不立即吞掉 alias，
 * 而是在 meta 标记 `noResolved`，让 importAnalysis 输出包含原始导入位置的明确错误。
 */
export const viteAliasCustomResolver: ResolverFunction = async function (
  id,
  importer,
  options,
) {
  const resolved = await this.resolve(id, importer, options)
  return resolved || { id, meta: { 'vite:alias': { noResolved: true } } }
}
