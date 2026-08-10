import type { InlineConfig } from '../config'
import { resolveConfig } from '../config'
import { createRunnableDevEnvironment } from '../server/environments/runnableEnvironment'
import { mergeConfig } from '../utils'

/** runnerImport 返回的模块命名空间与内部化文件依赖。 */
interface RunnerImportResult<T> {
  /** 入口模块求值后的导出命名空间。 */
  module: T
  /** 除入口外由 Vite 转换、可用于文件监听的依赖路径。 */
  dependencies: string[]
}

/**
 * 创建一次性的默认 server Environment，通过 Vite 插件链导入任意文件，并返回
 * 所有 internalized 依赖文件；完成后无论成功失败都关闭环境。
 * @experimental
 */
export async function runnerImport<T>(
  moduleId: string,
  inlineConfig?: InlineConfig,
): Promise<RunnerImportResult<T>> {
  const isModuleSyncConditionEnabled = (await import('#module-sync-enabled'))
    .default
  const config = await resolveConfig(
    mergeConfig(inlineConfig || {}, {
      configFile: false,
      envDir: false,
      cacheDir: process.cwd(),
      environments: {
        inline: {
          consumer: 'server',
          dev: {
            moduleRunnerTransform: true,
          },
          resolve: {
            external: true,
            mainFields: [],
            conditions: [
              'node',
              ...(isModuleSyncConditionEnabled ? ['module-sync'] : []),
            ],
          },
        },
      },
    } satisfies InlineConfig),
    'serve',
  )
  const environment = createRunnableDevEnvironment('inline', config, {
    runnerOptions: {
      hmr: {
        logger: false,
      },
    },
    hot: false,
  })
  await environment.init()
  try {
    const module = await environment.runner.import(moduleId)
    const modules = [
      ...environment.runner.evaluatedModules.urlToIdModuleMap.values(),
    ]
    const dependencies = modules
      .filter((m) => {
        // externalized 模块由 Node 管理，不属于 Vite 需要观察的文件依赖。
        if (!m.meta || 'externalize' in m.meta) {
          return false
        }
        // 返回 dependencies 只列入口之外的内部依赖。
        return m.exports !== module
      })
      .map((m) => m.file)
    return {
      module,
      dependencies,
    }
  } finally {
    await environment.close()
  }
}
