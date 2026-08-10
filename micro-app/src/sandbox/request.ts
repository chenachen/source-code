import globalEnv from '../libs/global_env'
import {
  isFunction,
  isUndefined,
  isString,
  createURL,
  isURL,
  removeDomScope,
  isConstructor,
} from '../libs/utils'

/**
 * 创建微应用专用的 `fetch` 包装器，把字符串或 `URL` 请求补全为相对微应用地址的绝对 URL。
 *
 * @remarks
 * 包装器保留基座可能改写过的 `fetch`，但调用前会退出当前 DOM 作用域。WHY：请求钩子可能同步操作
 * DOM，若仍处于微应用作用域，基座代码会被错误地重定向到微应用文档。`Request` 实例保持原样，避免
 * 重建请求时丢失其 body、headers 等内部状态。
 *
 * @param url - 微应用资源地址，作为相对请求的解析基准。
 * @param target - 可选的代理目标；省略时使用宿主窗口的原始 `fetch`。
 * @returns 与目标 `fetch` 签名一致的包装函数；环境不支持 `fetch` 时原样返回该值。
 * @see https://developer.mozilla.org/en-US/docs/Web/API/fetch
 */
export function createMicroFetch (url: string, target?: Window['fetch']): Window['fetch'] {
  const rawFetch = !isUndefined(target) ? target : globalEnv.rawWindow.fetch
  if (!isFunction(rawFetch)) return rawFetch
  /**
   * 规范化微应用请求地址，并在宿主 DOM 作用域中调用真实 `fetch`。
   */
  return function microFetch (
    input: RequestInfo | URL | string,
    init?: RequestInit,
    ...rests: unknown[]
  ): Promise<Response> {
    if (isString(input) || isURL(input)) {
      input = createURL(input, url).toString()
    }
    // WHY：基座重写的请求函数可能同步访问 DOM；先清除微应用作用域，防止这些访问被沙箱错误劫持。
    // `XMLHttpRequest` 与 `EventSource` 的包装器遵守同一边界。
    removeDomScope()
    return rawFetch.call(globalEnv.rawWindow, input, init, ...rests)
  }
}

/**
 * 创建微应用专用的 `XMLHttpRequest` 构造器，重写 `open` 以补全相对请求地址。
 *
 * @remarks
 * `file:` 与 `ftp:` URL 不参与补全，避免把具有独立协议语义的地址错误拼接到应用 URL。调用原始
 * `open` 前退出 DOM 作用域，使基座对 XHR 的同步补丁始终在宿主上下文执行。
 *
 * @param url - 微应用资源地址，作为相对请求的解析基准。
 * @param target - 可选的代理构造器；省略时使用宿主窗口的原始 `XMLHttpRequest`。
 * @returns 派生后的 XHR 构造器；目标不可构造时原样返回。
 * @see https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest
 */
export function createMicroXMLHttpRequest (url: string, target?: XMLHttpRequest): any {
  const rawXMLHttpRequest = !isUndefined(target) ? target : globalEnv.rawWindow.XMLHttpRequest
  if (!isConstructor(rawXMLHttpRequest)) return rawXMLHttpRequest
  /**
   * 仅覆写地址解析边界、其余能力继承自真实 `XMLHttpRequest` 的微应用请求类。
   */
  class MicroXMLHttpRequest extends rawXMLHttpRequest {
    /**
     * 在首次发送配置阶段补全请求 URL，并转发其余参数给原生实现。
     */
    open (method: string, reqUrl: string, ...rests: unknown[]): void {
      if ((isString(reqUrl) && !/^f(ile|tp):\/\//.test(reqUrl)) || isURL(reqUrl)) {
        reqUrl = createURL(reqUrl, url).toString()
      }
      removeDomScope()
      super.open(method, reqUrl, ...rests)
    }
  }
  // 类方法位于原型且默认不可枚举；显式开放枚举性，以兼容依赖旧式 XHR 原型遍历的代码。
  MicroXMLHttpRequest.prototype && Object.defineProperty(MicroXMLHttpRequest.prototype, 'open', { enumerable: true })
  return MicroXMLHttpRequest
}

/**
 * 沙箱清理阶段所需的最小 `EventSource` 实例契约。
 */
export interface EventSourceInstance {
  /** 关闭底层连接，并允许包装器从应用级登记表中移除实例。 */
  close(): void;
}

/**
 * 管理每个微应用 `EventSource` 构造器与存量连接的生命周期接口。
 */
export interface EventSourceApi {
  /** 为指定应用创建会登记连接实例的 `EventSource` 构造器。 */
  createMicroEventSource(appName: string, url: string, target?: EventSource): any
  /** 关闭并清空指定应用尚未释放的全部连接。 */
  clearMicroEventSource (appName: string): void
}

/**
 * 创建一组共享应用级连接登记表的 `EventSource` 包装与清理 API。
 *
 * @remarks
 * 登记表由本次工厂调用的闭包独占，按应用名隔离连接。构造成功后登记、实例主动关闭时移除，应用
 * 卸载时再批量关闭遗留连接，从而避免长连接跨越沙箱生命周期继续接收事件。
 */
export function useMicroEventSource (): EventSourceApi {
  /** 按应用名保存仍由沙箱负责清理的活动连接；首次创建连接时惰性初始化。 */
  let eventSourceMap: Map<string, Set<EventSourceInstance>>

  /**
   * 创建微应用专用的 `EventSource` 构造器，并把实例纳入对应应用的连接登记表。
   *
   * @param appName - 连接归属的微应用名称，也是批量清理时的索引键。
   * @param url - 微应用资源地址，作为相对事件流地址的解析基准。
   * @param target - 可选的代理构造器；省略时使用宿主窗口的原始 `EventSource`。
   * @returns 包装后的构造器；目标不可构造时原样返回。
   * @see https://developer.mozilla.org/en-US/docs/Web/API/EventSource
   */
  function createMicroEventSource (appName: string, url: string, target?: EventSource): any {
    const rawEventSource = !isUndefined(target) ? target : globalEnv.rawWindow.EventSource
    if (!isConstructor(rawEventSource)) return rawEventSource
    /**
     * 在构造和关闭边界维护应用级登记表的微应用事件流类。
     */
    return class MicroEventSource extends rawEventSource {
      /**
       * 补全事件流地址、退出 DOM 作用域后创建连接，并仅在构造成功后登记实例。
       */
      constructor (
        eventSourceUrl: string | URL,
        eventSourceInitDict?: EventSourceInit,
        ...rests: unknown[]
      ) {
        if (isString(eventSourceUrl) || isURL(eventSourceUrl)) {
          eventSourceUrl = createURL(eventSourceUrl, url).toString()
        }
        removeDomScope()
        super(eventSourceUrl, eventSourceInitDict, ...rests)

        if (eventSourceMap) {
          const eventSourceList = eventSourceMap.get(appName)
          if (eventSourceList) {
            eventSourceList.add(this)
          } else {
            eventSourceMap.set(appName, new Set([this]))
          }
        } else {
          eventSourceMap = new Map([[appName, new Set([this])]])
        }
      }

      /**
       * 关闭真实连接并从登记表移除当前实例；重复关闭由原生实现承担幂等边界。
       */
      close (): void {
        super.close()
        eventSourceMap.get(appName)?.delete(this)
      }
    }
  }

  /**
   * 关闭指定应用登记的全部事件流，并清空其集合以释放沙箱持有的引用。
   */
  function clearMicroEventSource (appName: string): void {
    const eventSourceList = eventSourceMap?.get(appName)
    if (eventSourceList?.size) {
      eventSourceList.forEach(item => {
        item.close()
      })
      eventSourceList.clear()
    }
  }

  return {
    createMicroEventSource,
    clearMicroEventSource,
  }
}
