import type { HotPayload } from '#types/hmrPayload'
import { slash, unwrapId } from '../shared/utils'
import { ERR_OUTDATED_OPTIMIZED_DEP } from '../shared/constants'
import { createHMRHandler } from '../shared/hmrHandler'
import type { ModuleRunner } from './runner'

/**
 * 把服务端发来的 HMR 消息应用到 Module Runner。
 *
 * JS 更新交给 HMR client 排队执行；整页重载则清空求值缓存，并从受影响模块
 * 向上寻找没有 importer 的入口重新执行。Runner 没有 DOM，因此 CSS 更新只记录错误。
 */
export function createHMRHandlerForRunner(
  runner: ModuleRunner,
): (payload: HotPayload) => Promise<void> {
  return createHMRHandler(async (payload) => {
    const hmrClient = runner.hmrClient
    if (!hmrClient || runner.isClosed()) return
    switch (payload.type) {
      case 'connected':
        hmrClient.logger.debug(`connected.`)
        break
      case 'update':
        await hmrClient.notifyListeners('vite:beforeUpdate', payload)
        await Promise.all(
          payload.updates.map(async (update): Promise<void> => {
            if (update.type === 'js-update') {
              // Runner 始终用去掉 /@id/ 前缀后的完整路径缓存模块，先统一消息中的键。
              update.acceptedPath = unwrapId(update.acceptedPath)
              update.path = unwrapId(update.path)
              return hmrClient.queueUpdate(update)
            }

            hmrClient.logger.error('css hmr is not supported in runner mode.')
          }),
        )
        await hmrClient.notifyListeners('vite:afterUpdate', payload)
        break
      case 'custom': {
        await hmrClient.notifyListeners(payload.event, payload.data)
        break
      }
      case 'full-reload': {
        const { triggeredBy } = payload
        const clearEntrypointUrls = triggeredBy
          ? getModulesEntrypoints(
              runner,
              getModulesByFile(runner, slash(triggeredBy)),
            )
          : findAllEntrypoints(runner)

        if (!clearEntrypointUrls.size) break

        hmrClient.logger.debug(`program reload`)
        await hmrClient.notifyListeners('vite:beforeFullReload', payload)
        runner.evaluatedModules.clear()

        for (const url of clearEntrypointUrls) {
          if (runner.isClosed()) break
          try {
            await runner.import(url)
          } catch (err) {
            if (runner.isClosed()) break
            if (err.code !== ERR_OUTDATED_OPTIMIZED_DEP) {
              hmrClient.logger.error(
                `An error happened during full reload\n${err.message}\n${err.stack}`,
              )
            }
          }
        }
        break
      }
      case 'prune':
        await hmrClient.notifyListeners('vite:beforePrune', payload)
        await hmrClient.prunePaths(payload.paths)
        break
      case 'error': {
        await hmrClient.notifyListeners('vite:error', payload)
        const err = payload.err
        hmrClient.logger.error(
          `Internal Server Error\n${err.message}\n${err.stack}`,
        )
        break
      }
      case 'ping': // 心跳消息无需处理。
        break
      case 'bundled-dev-update': // 预留给 bundled-dev 更新协议。
        break
      default: {
        const check: never = payload
        return check
      }
    }
  })
}

/** 根据规范化文件名反查所有指向该文件的已求值模块。 */
function getModulesByFile(runner: ModuleRunner, file: string): string[] {
  const nodes = runner.evaluatedModules.getModulesByFile(file)
  if (!nodes) {
    return []
  }
  return [...nodes].map((node) => node.id)
}

/**
 * 沿 importer 关系递归向上查找入口。
 *
 * 没有 importer 的模块代表由宿主直接调用 `runner.import()` 的根；`visited`
 * 同时避免循环依赖让遍历无限递归。
 */
function getModulesEntrypoints(
  runner: ModuleRunner,
  modules: string[],
  visited = new Set<string>(),
  entrypoints = new Set<string>(),
) {
  for (const moduleId of modules) {
    if (visited.has(moduleId)) continue
    visited.add(moduleId)
    const module = runner.evaluatedModules.getModuleById(moduleId)
    if (!module) {
      continue
    }
    if (!module.importers.size) {
      entrypoints.add(module.url)
      continue
    }
    for (const importer of module.importers) {
      getModulesEntrypoints(runner, [importer], visited, entrypoints)
    }
  }
  return entrypoints
}

/** 在没有 `triggeredBy` 提示时，收集当前图中的全部根入口。 */
function findAllEntrypoints(
  runner: ModuleRunner,
  entrypoints = new Set<string>(),
): Set<string> {
  for (const mod of runner.evaluatedModules.idToModuleMap.values()) {
    if (!mod.importers.size) {
      entrypoints.add(mod.url)
    }
  }
  return entrypoints
}
