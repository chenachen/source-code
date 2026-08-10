import type { PartialResolvedId } from 'rolldown'
import aliasPlugin from '@rollup/plugin-alias'
import type { ResolvedConfig } from './config'
import type { EnvironmentPluginContainer } from './server/pluginContainer'
import { createEnvironmentPluginContainer } from './server/pluginContainer'
import { oxcResolvePlugin } from './plugins/resolve'
import type { InternalResolveOptions } from './plugins/resolve'
import type { Environment } from './environment'
import type { PartialEnvironment } from './baseEnvironment'

/** Vite 内部精简 resolver 的统一签名；返回最终 id，不计算完整模块元数据。 */
export type ResolveIdFn = (
  environment: PartialEnvironment,
  id: string,
  importer?: string,
  aliasOnly?: boolean,
) => Promise<string | undefined>

/**
 * 创建兼容旧 `config.createResolver` 覆盖行为的 resolver。
 * Astro 等项目曾覆写它以注入 alias，因此 client/ssr 继续转发旧入口；自定义 Environment
 * 使用新的按 Environment resolver，避免兼容布尔 `ssr` 限制新模型（#17972）。
 */
export function createBackCompatIdResolver(
  config: ResolvedConfig,
  options?: Partial<InternalResolveOptions>,
): ResolveIdFn {
  const compatResolve = config.createResolver(options)
  let resolve: ResolveIdFn
  return async (environment, id, importer, aliasOnly) => {
    if (environment.name === 'client' || environment.name === 'ssr') {
      return compatResolve(id, importer, aliasOnly, environment.name === 'ssr')
    }
    resolve ??= createIdResolver(config, options)
    return resolve(environment, id, importer, aliasOnly)
  }
}

/**
 * 创建供依赖优化器、CSS `@import` 等特殊流程使用的内部 resolver。
 *
 * 每个 PartialEnvironment 惰性创建并缓存一条只含 alias + Vite resolve 的精简插件管线；
 * `aliasOnly` 使用另一条纯 alias 管线。它只返回 id，跳过 sideEffects 等构建元数据计算。
 */
export function createIdResolver(
  config: ResolvedConfig,
  options?: Partial<InternalResolveOptions>,
): ResolveIdFn {
  const scan = options?.scan

  const pluginContainerMap = new Map<
    PartialEnvironment,
    EnvironmentPluginContainer
  >()
  /** 为每个 Environment 惰性创建完整 alias + Vite resolve 精简容器。 */
  async function resolve(
    environment: PartialEnvironment,
    id: string,
    importer?: string,
  ): Promise<PartialResolvedId | null> {
    let pluginContainer = pluginContainerMap.get(environment)
    if (!pluginContainer) {
      pluginContainer = await createEnvironmentPluginContainer(
        environment as Environment,
        [
          // @ts-expect-error aliasPlugin 仍声明 Rollup 类型，但运行协议兼容。
          aliasPlugin({ entries: environment.config.resolve.alias }),
          ...oxcResolvePlugin(
            {
              root: config.root,
              isProduction: config.isProduction,
              isBuild: config.command === 'build',
              asSrc: true,
              preferRelative: false,
              tryIndex: true,
              ...options,
              // 本调用只需要 id，跳过 sideEffects/packageJsonPath 等计算。
              idOnly: true,
            },
            environment.config,
            true,
          ),
        ],
        undefined,
        false,
      )
      pluginContainerMap.set(environment, pluginContainer)
    }
    return await pluginContainer.resolveId(id, importer, { scan })
  }

  const aliasOnlyPluginContainerMap = new Map<
    PartialEnvironment,
    EnvironmentPluginContainer
  >()
  /** 为每个 Environment 惰性创建只执行 alias 的精简容器。 */
  async function resolveAlias(
    environment: PartialEnvironment,
    id: string,
    importer?: string,
  ): Promise<PartialResolvedId | null> {
    let pluginContainer = aliasOnlyPluginContainerMap.get(environment)
    if (!pluginContainer) {
      pluginContainer = await createEnvironmentPluginContainer(
        environment as Environment,
        // @ts-expect-error aliasPlugin 仍声明 Rollup 类型，但运行协议兼容。
        [aliasPlugin({ entries: environment.config.resolve.alias })],
        undefined,
        false,
      )
      aliasOnlyPluginContainerMap.set(environment, pluginContainer)
    }
    return await pluginContainer.resolveId(id, importer, { scan })
  }

  return async (environment, id, importer, aliasOnly) => {
    const resolveFn = aliasOnly ? resolveAlias : resolve
    // 精简容器的插件实现要求完整 Environment；这里的 PartialEnvironment 只在这些插件会读取的
    // 配置能力上等价，因此由内部边界完成类型收窄。
    const resolved = await resolveFn(environment, id, importer)
    return resolved?.id
  }
}
