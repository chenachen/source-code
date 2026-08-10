import { existsSync, readFileSync } from 'node:fs'
import { ModuleRunner, createNodeImportMeta } from 'vite/module-runner'
import type {
  ModuleEvaluator,
  ModuleRunnerHmr,
  ModuleRunnerOptions,
} from 'vite/module-runner'
import type { HotPayload } from '#types/hmrPayload'
import type { DevEnvironment } from '../../server/environment'
import type {
  HotChannelClient,
  NormalizedServerHotChannel,
} from '../../server/hmr'
import type { ModuleRunnerTransport } from '../../../shared/moduleRunnerTransport'

/**
 * @experimental
 */
export interface ServerModuleRunnerOptions extends Omit<
  ModuleRunnerOptions,
  'root' | 'fetchModule' | 'hmr' | 'transport'
> {
  /**
   * 关闭 HMR 或配置 runner HMR logger。
   */
  hmr?:
    | false
    | {
        /** 覆盖 runner HMR 的调试与错误日志接收器。 */
        logger?: ModuleRunnerHmr['logger']
      }
  /**
   * 自定义 ModuleEvaluator，控制变换后代码怎样执行。
   */
  evaluator?: ModuleEvaluator
}

/** 只有 server HMR 与双向 hot channel 同时可用时才启用 runner HMR。 */
function createHMROptions(
  environment: DevEnvironment,
  options: ServerModuleRunnerOptions,
) {
  if (environment.config.server.hmr === false || options.hmr === false) {
    return false
  }
  if (!('api' in environment.hot)) return false

  const defaultLogger: ModuleRunnerHmr['logger'] = {
    debug: (...msg) =>
      environment.logger.info(msg.join(' '), {
        timestamp: true,
      }),
    error: (err) =>
      environment.logger.error(
        err instanceof Error ? err.message : String(err),
        { timestamp: true },
      ),
  }

  return {
    logger: options.hmr?.logger ?? defaultLogger,
  }
}

/** prepareStackTrace 拦截器读取磁盘源码时使用的最小文件提供器。 */
const prepareStackTrace = {
  /** 存在时同步返回模块源码，缺失文件交由拦截器回退处理。 */
  retrieveFile(id: string) {
    if (existsSync(id)) {
      return readFileSync(id, 'utf-8')
    }
  },
}

/** 按显式选项、Node 原生 sourcemap 能力和 prepareStackTrace fallback 选择拦截器。 */
function resolveSourceMapOptions(options: ServerModuleRunnerOptions) {
  if (options.sourcemapInterceptor != null) {
    if (options.sourcemapInterceptor === 'prepareStackTrace') {
      return prepareStackTrace
    }
    if (typeof options.sourcemapInterceptor === 'object') {
      return { ...prepareStackTrace, ...options.sourcemapInterceptor }
    }
    return options.sourcemapInterceptor
  }
  if (typeof process !== 'undefined' && 'setSourceMapsEnabled' in process) {
    return 'node'
  }
  return prepareStackTrace
}

/**
 * 把同进程 NormalizedServerHotChannel 适配为 ModuleRunnerTransport。
 * runner 与 server 之间只允许 custom payload；协议型 HMR 消息由 channel 的 send 侧推送。
 */
export const createServerModuleRunnerTransport = (options: {
  /** 同进程 Environment 暴露的双向标准化热通道。 */
  channel: NormalizedServerHotChannel
}): ModuleRunnerTransport => {
  const hmrClient: HotChannelClient = {
    send: (payload: HotPayload) => {
      if (payload.type !== 'custom') {
        throw new Error(
          'Cannot send non-custom events from the client to the server.',
        )
      }
      options.channel.send(payload)
    },
  }

  let handler: ((data: HotPayload) => void) | undefined

  return {
    /** 订阅 server→runner 消息，并向 server 宣告客户端连接。 */
    connect({ onMessage }) {
      options.channel.api!.outsideEmitter.on('send', onMessage)
      options.channel.api!.innerEmitter.emit(
        'vite:client:connect',
        undefined,
        hmrClient,
      )
      onMessage({ type: 'connected' })
      handler = onMessage
    },
    /** 注销消息处理器，并向 server 宣告客户端断开。 */
    disconnect() {
      if (handler) {
        options.channel.api!.outsideEmitter.off('send', handler)
      }
      options.channel.api!.innerEmitter.emit(
        'vite:client:disconnect',
        undefined,
        hmrClient,
      )
    },
    /** 把 runner 发出的自定义 payload 注入 Environment 的内部事件总线。 */
    send(payload) {
      if (payload.type !== 'custom') {
        throw new Error(
          'Cannot send non-custom events from the server to the client.',
        )
      }
      options.channel.api!.innerEmitter.emit(
        payload.event,
        payload.data,
        hmrClient,
      )
    },
  }
}

/**
 * 为 DevEnvironment 创建支持 HMR、Node import.meta 与 sourcemap 的 ModuleRunner。
 * @experimental
 */
export function createServerModuleRunner(
  environment: DevEnvironment,
  options: ServerModuleRunnerOptions = {},
): ModuleRunner {
  const hmr = createHMROptions(environment, options)
  return new ModuleRunner(
    {
      ...options,
      transport: createServerModuleRunnerTransport({
        channel: environment.hot as NormalizedServerHotChannel,
      }),
      hmr,
      createImportMeta: createNodeImportMeta,
      sourcemapInterceptor: resolveSourceMapOptions(options),
    },
    options.evaluator,
  )
}
