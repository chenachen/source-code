import type {
  prefetchParamList,
  prefetchParam,
  globalAssetsType,
  OnLoadParam,
} from '@micro-app/types'
import type {
  SourceCenter as SourceCenterType,
} from './source/source_center'
import microApp from './micro_app'
import sourceCenter from './source/source_center'
import {
  PREFETCH_LEVEL,
} from './constants'
import CreateApp, {
  appInstanceMap,
} from './create_app'
import {
  requestIdleCallback,
  formatAppURL,
  formatAppName,
  promiseStream,
  logError,
  isBrowser,
  isArray,
  isPlainObject,
  isString,
  isFunction,
  promiseRequestIdle,
  isNumber,
  assign,
  isTargetExtension,
} from './libs/utils'
import {
  fetchSource,
} from './source/fetch'
import {
  initRouterMode,
} from './sandbox/router'

/**
 * 在浏览器空闲后串行预取子应用资源。
 *
 * 调用形态：
 * `preFetch([
 *  {
 *    name: string,
 *    url: string,
 *    iframe: boolean,
 *    inline: boolean,
 *    'disable-scopecss': boolean,
 *    'disable-sandbox': boolean,
 *    level: number,
 *    'default-page': string,
 *    'disable-patch-request': boolean,
 *  },
 *  ...
 * ])`。
 *
 * 预取异步执行且不返回等待句柄；配置最好与最终 `<micro-app>` 元素一致，
 * 否则元素挂载时可能丢弃预取实例并重新创建。
 *
 * @param apps - 应用配置数组，或惰性返回该数组的函数。
 * @param delay - 进入空闲回调后额外等待的毫秒数；默认取全局配置或 3000ms。
 */
export default function preFetch (apps: prefetchParamList, delay?: number): void {
  if (!isBrowser) {
    return logError('preFetch is only supported in browser environment')
  }

  requestIdleCallback(() => {
    const delayTime = isNumber(delay) ? delay : microApp.options.prefetchDelay

    /**
     * TODO：评估移除 setTimeout；若保留，还需在全局释放阶段清理该定时器。
     */
    setTimeout(() => {
      // releasePrefetchEffect()
      preFetchInSerial(apps)
    }, isNumber(delayTime) ? delayTime : 3000)
  })

  // 以下方案保留了曾考虑的 load 事件触发路径；当前实现直接使用空闲回调加延时。
  // const handleOnLoad = (): void => {
  //   releasePrefetchEffect()
  //   requestIdleCallback(() => {
  //     preFetchInSerial(apps)
  //   })
  // }

  // const releasePrefetchEffect = (): void => {
  //   window.removeEventListener('load', handleOnLoad)
  //   clearTimeout(preFetchTime)
  // }

  // window.addEventListener('load', handleOnLoad)
}

/** 解析惰性配置，并用 Promise 链保证各应用按数组顺序进入空闲预取。 */
function preFetchInSerial (apps: prefetchParamList): void {
  isFunction(apps) && (apps = apps())

  if (isArray(apps)) {
    apps.reduce((pre, next) => pre.then(() => preFetchAction(next)), Promise.resolve())
  }
}

/**
 * 在一个空闲任务中校验并创建单个预取实例。
 *
 * 同名实例已注册、配置非法或浏览器离线时直接完成；成功创建后把实例加载回调
 * 包装成 Promise 结算点，使串行调度等待 HTML 与静态资源完成。三级预取还会把
 * 路由和请求补丁配置交给预渲染挂载流程。
 */
function preFetchAction (options: prefetchParam): Promise<void> {
  return promiseRequestIdle((resolve: PromiseConstructor['resolve']) => {
    if (isPlainObject(options) && navigator.onLine) {
      options.name = formatAppName(options.name)
      options.url = formatAppURL(options.url, options.name)
      if (options.name && options.url && !appInstanceMap.has(options.name)) {
        const app = new CreateApp({
          name: options.name,
          url: options.url,
          isPrefetch: true,
          scopecss: !(options['disable-scopecss'] ?? options.disableScopecss ?? microApp.options['disable-scopecss']),
          useSandbox: !(options['disable-sandbox'] ?? options.disableSandbox ?? microApp.options['disable-sandbox']),
          inline: options.inline ?? microApp.options.inline,
          iframe: options.iframe ?? microApp.options.iframe,
          prefetchLevel: options.level && PREFETCH_LEVEL.includes(options.level) ? options.level : microApp.options.prefetchLevel && PREFETCH_LEVEL.includes(microApp.options.prefetchLevel) ? microApp.options.prefetchLevel : 2,
        })

        const oldOnload = app.onLoad
        const oldOnLoadError = app.onLoadError
        app.onLoad = (onLoadParam: OnLoadParam): void => {
          if (app.isPrerender) {
            assign(onLoadParam, {
              defaultPage: options['default-page'],
              /**
               * TODO: 预渲染支持disable-memory-router，默认渲染首页即可，文档中也要保留
               * 问题：
               *  1、如何确保子应用进行跳转时不影响到浏览器地址？？pure？？
               */
              routerMode: initRouterMode(options['router-mode']),
              baseroute: options.baseroute,
              disablePatchRequest: options['disable-patch-request'],
            })
          }
          resolve()
          oldOnload.call(app, onLoadParam)
        }

        app.onLoadError = (...rests): void => {
          resolve()
          oldOnLoadError.call(app, ...rests)
        }
      } else {
        resolve()
      }
    } else {
      resolve()
    }
  })
}

/**
 * 在浏览器空闲时把全局 JS/CSS 资源加载到共享源码缓存。
 *
 * 缓存只记录尚不存在且扩展名匹配的资源；单个请求失败只记录错误，不阻断其余资源。
 *
 * @param assets - 待缓存的全局 JS 与 CSS 地址集合。
 */
export function getGlobalAssets (assets: globalAssetsType): void {
  if (isPlainObject(assets)) {
    requestIdleCallback(() => {
      fetchGlobalResources(assets.js, 'js', sourceCenter.script)
      fetchGlobalResources(assets.css, 'css', sourceCenter.link)
    })
  }
}

/**
 * 并发抓取指定类型的全局资源，并按原索引写入对应源码中心。
 *
 * `promiseStream` 允许先完成的请求先入缓存；二次 `hasInfo` 检查避免并发期间被其他
 * 应用填充后重复覆盖。当前仅整个批次位于空闲回调，尚未为每个文件单独调度空闲任务。
 *
 * @param resources - 资源地址列表；缺省时不执行任何动作。
 * @param suffix - 用于过滤扩展名并选择缓存结构的 `js` 或 `css`。
 * @param sourceHandler - 对应脚本或样式源码中心。
 */
function fetchGlobalResources (resources: string[] | void, suffix: string, sourceHandler: SourceCenterType['link'] | SourceCenterType['script']) {
  if (isArray(resources)) {
    const effectiveResource = resources!.filter((path) => isString(path) && isTargetExtension(path, suffix) && !sourceHandler.hasInfo(path))

    const fetchResourcePromise = effectiveResource.map((path) => fetchSource(path))

    // 流式接收结果：无需等待最慢请求，且用索引找回原始 URL。
    promiseStream<string>(fetchResourcePromise, (res: {
      /** 已抓取的源码文本。 */
      data: string,
      /** 该结果在请求数组中的原始位置。 */
      index: number
    }) => {
      const path = effectiveResource[res.index]
      if (suffix === 'js') {
        if (!sourceHandler.hasInfo(path)) {
          sourceHandler.setInfo(path, {
            code: res.data,
            isExternal: false,
            appSpace: {},
          })
        }
      } else {
        if (!sourceHandler.hasInfo(path)) {
          (sourceHandler as SourceCenterType['link']).setInfo(path, {
            code: res.data,
            appSpace: {}
          })
        }
      }
    }, (err: {
      /** 单个资源的抓取错误。 */
      error: Error,
      /** 失败请求在请求数组中的原始位置。 */
      index: number
    }) => {
      logError(err)
    })
  }
}
