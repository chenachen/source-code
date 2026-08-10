import colors from 'picocolors'
import type { EvaluatedModuleNode } from 'vite/module-runner'
import {
  ESModulesEvaluator,
  ModuleRunner,
  createNodeImportMeta,
} from 'vite/module-runner'
import type { ViteDevServer } from '../server'
import { unwrapId } from '../../shared/utils'
import type { DevEnvironment } from '../server/environment'
import type { NormalizedServerHotChannel } from '../server/hmr'
import { buildErrorMessage } from '../server/middlewares/error'
import { isRunnableDevEnvironment } from '../../node'
import { ssrFixStacktrace } from './ssrStacktrace'
import { createServerModuleRunnerTransport } from './runtime/serverModuleRunner'

/** 旧 ssrLoadModule API 暴露的模块导出命名空间。 */
type SSRModule = Record<string, any>

/**
 * 兼容旧 `server.ssrLoadModule()` API：复用 ssr Runnable Environment 的
 * ModuleRunner 执行模块，并可把错误栈映射回源码。
 */
export async function ssrLoadModule(
  url: string,
  server: ViteDevServer,
  fixStacktrace?: boolean,
): Promise<SSRModule> {
  const environment = server.environments.ssr
  if (!isRunnableDevEnvironment(environment)) {
    throw new Error(
      `ssrLoadModule requires the 'ssr' environment to be a runnable environment.`,
    )
  }
  server._ssrCompatModuleRunner ||= new SSRCompatModuleRunner(environment)
  url = unwrapId(url)

  return instantiateModule(
    url,
    server._ssrCompatModuleRunner,
    environment,
    fixStacktrace,
  )
}

/** 确保模块图入口存在，复用缓存错误/runner，并把结果与错误回写 ModuleNode。 */
async function instantiateModule(
  url: string,
  runner: ModuleRunner,
  environment: DevEnvironment,
  fixStacktrace?: boolean,
): Promise<SSRModule> {
  const mod = await environment.moduleGraph.ensureEntryFromUrl(url)

  if (mod.ssrError) {
    throw mod.ssrError
  }

  try {
    return await runner.import(url)
  } catch (e: any) {
    if (e.stack && fixStacktrace) {
      ssrFixStacktrace(e, environment.moduleGraph)
    }

    environment.logger.error(
      buildErrorMessage(e, [
        colors.red(`Error when evaluating SSR module ${url}: ${e.message}`),
      ]),
      {
        timestamp: true,
        clear: environment.config.clearScreen,
        error: e,
      },
    )

    throw e
  }
}

/**
 * 把新 ModuleRunner 的 evaluated module 缓存桥接回旧 ModuleNode.ssrModule/ssrError，
 * 保持插件与框架对兼容字段的观察结果。
 */
class SSRCompatModuleRunner extends ModuleRunner {
  /** 为旧 SSR API 建立禁用 HMR、使用 Node import.meta 的本地 evaluator。 */
  constructor(private environment: DevEnvironment) {
    super(
      {
        transport: createServerModuleRunnerTransport({
          channel: environment.hot as NormalizedServerHotChannel,
        }),
        createImportMeta: createNodeImportMeta,
        sourcemapInterceptor: false,
        hmr: false,
      },
      new ESModulesEvaluator(),
    )
  }

  /** 求值 internal 模块，并把导出或错误同步回旧 EnvironmentModuleNode 字段。 */
  protected override async directRequest(
    url: string,
    mod: EvaluatedModuleNode,
    callstack: string[],
  ): Promise<any> {
    const id = mod.meta && 'id' in mod.meta && mod.meta.id
    // external module 没有 serverId，直接走 ModuleRunner 的原生 external import。
    if (!id) {
      return super.directRequest(url, mod, callstack)
    }

    const viteMod = this.environment.moduleGraph.getModuleById(id)

    if (!viteMod) {
      return super.directRequest(id, mod, callstack)
    }

    try {
      const exports = await super.directRequest(id, mod, callstack)
      viteMod.ssrModule = exports
      return exports
    } catch (err) {
      viteMod.ssrError = err
      throw err
    }
  }
}
