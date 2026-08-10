import type { ResolvedConfig } from '../../config'
import type { DevEnvironmentContext } from '../environment'
import { DevEnvironment } from '../environment'
import type { Environment } from '../../environment'

/** FetchableDevEnvironment 的通信上下文。 */
export interface FetchableDevEnvironmentContext extends DevEnvironmentContext {
  /** 把标准 Fetch Request 交给目标运行时，并返回标准 Response。 */
  handleRequest(request: Request): Promise<Response> | Response
}

/**
 * 创建通过 Fetch API 与应用运行时通信的开发 Environment。
 * 工厂提前检查全局 Web Fetch 类型和请求处理器，使 `dispatchFetch()` 的跨运行时契约明确失败。
 *
 * @experimental
 */
export function createFetchableDevEnvironment(
  name: string,
  config: ResolvedConfig,
  context: FetchableDevEnvironmentContext,
): FetchableDevEnvironment {
  if (typeof Request === 'undefined' || typeof Response === 'undefined') {
    throw new TypeError(
      'FetchableDevEnvironment requires a global `Request` and `Response` object.',
    )
  }

  if (!context.handleRequest) {
    throw new TypeError(
      'FetchableDevEnvironment requires a `handleRequest` method during initialisation.',
    )
  }

  return new FetchableDevEnvironment(name, config, context)
}

/** 用 instanceof 收窄到提供 `dispatchFetch()` 的 Environment。 */
export function isFetchableDevEnvironment(
  environment: Environment,
): environment is FetchableDevEnvironment {
  return environment instanceof FetchableDevEnvironment
}

/**
 * 用 Request/Response 序列化边界封装目标运行时的 DevEnvironment。
 * 它适合 Cloudflare Workers 一类不能与 Vite Server 同进程共享任意 JavaScript 值的运行时。
 */
class FetchableDevEnvironment extends DevEnvironment {
  /** 框架提供的目标运行时请求入口。 */
  private _handleRequest: (request: Request) => Promise<Response> | Response

  /** 保存经过工厂校验的请求处理器。 */
  constructor(
    name: string,
    config: ResolvedConfig,
    context: FetchableDevEnvironmentContext,
  ) {
    super(name, config, context)
    this._handleRequest = context.handleRequest
  }

  /**
   * 转发 Fetch 请求并校验两端使用当前全局对象中的 Request/Response 实例。
   * 校验可尽早暴露跨 realm、polyfill 不一致或处理器误返回普通对象的问题。
   */
  public async dispatchFetch(request: Request): Promise<Response> {
    if (!(request instanceof Request)) {
      throw new TypeError(
        'FetchableDevEnvironment `dispatchFetch` must receive a `Request` object.',
      )
    }
    const response = await this._handleRequest(request)
    if (!(response instanceof Response)) {
      throw new TypeError(
        'FetchableDevEnvironment `context.handleRequest` must return a `Response` object.',
      )
    }
    return response
  }
}

export type { FetchableDevEnvironment }
