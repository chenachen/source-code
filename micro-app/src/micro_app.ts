import type {
  OptionsType,
  MicroAppBaseType,
  AppInterface,
  Router,
  AppName,
  Func,
  lifeCyclesType,
  MicroAppConfig,
  GetActiveAppsParam,
} from '@micro-app/types'
import { defineElement } from './micro_app_element'
import preFetch, { getGlobalAssets } from './prefetch'
import {
  logError,
  logWarn,
  isBrowser,
  isPlainObject,
  formatAppName,
  getRootContainer,
  isString,
  pureCreateElement,
  isElement,
  isFunction,
} from './libs/utils'
import { EventCenterForBaseApp } from './interact'
import { initGlobalEnv } from './libs/global_env'
import { appInstanceMap } from './create_app'
import { lifeCycles } from './constants'
import { router } from './sandbox/router'

/**
 * 返回当前仍参与运行的子应用名称。
 *
 * 预加载但未预渲染的实例不算活跃；预渲染实例和隐藏的 keep-alive 实例是否计入，
 * 分别由两个过滤选项控制。
 *
 * @param excludeHiddenApp - 是否排除已隐藏的 keep-alive 应用，默认不排除。
 * @param excludePreRender - 是否排除仍处于预渲染阶段的应用，默认不排除。
 * @returns 满足活跃条件的规范化应用名。
 */
export function getActiveApps ({
  excludeHiddenApp = false,
  excludePreRender = false,
}: GetActiveAppsParam = {}): AppName[] {
  const activeApps: AppName[] = []
  appInstanceMap.forEach((app: AppInterface, appName: AppName) => {
    if (
      !app.isUnmounted() &&
      (
        !app.isPrefetch || (
          app.isPrerender && !excludePreRender
        )
      ) &&
      (
        !excludeHiddenApp ||
        !app.isHidden()
      )
    ) {
      activeApps.push(appName)
    }
  })

  return activeApps
}

/** 返回实例注册表中的全部应用名，包括预加载、隐藏和已卸载但未销毁的实例。 */
export function getAllApps (): string[] {
  return Array.from(appInstanceMap.keys())
}

/** 命令式卸载的策略；未显式开启的清理动作默认保留实例及其可复用状态。 */
type unmountAppOptions = {
  /** 是否彻底销毁实例和已缓存的内联脚本。 */
  destroy?: boolean
  /** 是否把已隐藏的 keep-alive 实例继续卸载到普通未挂载状态。 */
  clearAliveState?: boolean
  /** 是否同时清除基座与子应用的数据中心数据。 */
  clearData?: boolean
}

/**
 * 按应用名卸载、隐藏或销毁实例，并在对应生命周期事件完成后结算结果。
 *
 * 已卸载/纯预加载实例可同步处理；隐藏实例按策略决定是否继续卸载；正在显示的
 * 实例则通过移除自定义元素触发 `disconnectedCallback`，因此 Promise 必须等待
 * `unmount` 或 `afterhidden` 生命周期事件。
 *
 * @param appName - 待处理的应用名，内部会先规范化。
 * @param options - 销毁、清除 keep-alive 状态和数据的策略。
 * @returns 找到并完成处理时为 `true`，实例不存在时为 `false`。
 */
export function unmountApp (appName: string, options?: unmountAppOptions): Promise<boolean> {
  const app = appInstanceMap.get(formatAppName(appName))
  return new Promise((resolve) => {
    if (app) {
      if (app.isUnmounted() || app.isPrefetch) {
        if (app.isPrerender) {
          app.unmount({
            destroy: !!options?.destroy,
            clearData: !!options?.clearData,
            keepRouteState: false,
            unmountcb: resolve.bind(null, true)
          })
        } else {
          if (options?.destroy) app.actionsForCompletelyDestroy()
          resolve(true)
        }
      } else if (app.isHidden()) {
        if (options?.destroy) {
          app.unmount({
            destroy: true,
            clearData: true,
            keepRouteState: true,
            unmountcb: resolve.bind(null, true)
          })
        } else if (options?.clearAliveState) {
          app.unmount({
            destroy: false,
            clearData: !!options.clearData,
            keepRouteState: true,
            unmountcb: resolve.bind(null, true)
          })
        } else {
          resolve(true)
        }
      } else {
        const container = getRootContainer(app.container!)
        /** 普通卸载完成时移除成对监听器，保证 Promise 只结算一次。 */
        const unmountHandler = () => {
          container.removeEventListener(lifeCycles.UNMOUNT, unmountHandler)
          container.removeEventListener(lifeCycles.AFTERHIDDEN, afterhiddenHandler)
          resolve(true)
        }

        /** keep-alive 隐藏完成时移除成对监听器，保证 Promise 只结算一次。 */
        const afterhiddenHandler = () => {
          container.removeEventListener(lifeCycles.UNMOUNT, unmountHandler)
          container.removeEventListener(lifeCycles.AFTERHIDDEN, afterhiddenHandler)
          resolve(true)
        }

        container.addEventListener(lifeCycles.UNMOUNT, unmountHandler)
        container.addEventListener(lifeCycles.AFTERHIDDEN, afterhiddenHandler)

        if (options?.destroy) {
          let destroyAttrValue, destoryAttrValue
          container.hasAttribute('destroy') && (destroyAttrValue = container.getAttribute('destroy'))
          container.hasAttribute('destory') && (destoryAttrValue = container.getAttribute('destory'))

          container.setAttribute('destroy', 'true')
          container.parentNode!.removeChild(container)

          container.removeAttribute('destroy')

          isString(destroyAttrValue) && container.setAttribute('destroy', destroyAttrValue)
          isString(destoryAttrValue) && container.setAttribute('destory', destoryAttrValue)
        } else if (options?.clearAliveState && container.hasAttribute('keep-alive')) {
          const keepAliveAttrValue = container.getAttribute('keep-alive')!
          container.removeAttribute('keep-alive')

          let clearDataAttrValue = null
          if (options.clearData) {
            clearDataAttrValue = container.getAttribute('clear-data')
            container.setAttribute('clear-data', 'true')
          }

          container.parentNode!.removeChild(container)

          container.setAttribute('keep-alive', keepAliveAttrValue)
          isString(clearDataAttrValue) && container.setAttribute('clear-data', clearDataAttrValue)
        } else {
          let clearDataAttrValue = null
          if (options?.clearData) {
            clearDataAttrValue = container.getAttribute('clear-data')
            container.setAttribute('clear-data', 'true')
          }

          container.parentNode!.removeChild(container)

          isString(clearDataAttrValue) && container.setAttribute('clear-data', clearDataAttrValue)
        }
      }
    } else {
      logWarn(`app ${appName} does not exist when unmountApp`)
      resolve(false)
    }
  })
}

/**
 * 按注册顺序串行卸载全部应用。
 *
 * 串行链避免多个自定义元素同时拆除时交叠全局沙箱与 DOM 作用域清理。
 */
export function unmountAllApps (options?: unmountAppOptions): Promise<boolean> {
  return Array.from(appInstanceMap.keys()).reduce((pre, next) => pre.then(() => unmountApp(next, options)), Promise.resolve(true))
}

/**
 * 通过已渲染应用的宿主元素执行卸载后重挂载，并恢复重载前的数据。
 *
 * @param appName - 目标应用名。
 * @param destroy - 重载前是否以彻底销毁模式卸载。
 * @returns 成功找到可渲染宿主并完成重载时为 `true`，否则为 `false`。
 */
export function reload (appName: string, destroy?: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const app = appInstanceMap.get(formatAppName(appName))
    if (app) {
      const rootContainer = app.container && getRootContainer(app.container)
      if (rootContainer) {
        const currentData = microApp.getData(appName)
        app.isReloading = true
        rootContainer.reload(destroy).then(() => {
          if (currentData) {
            microApp.setData(appName, currentData)
          }
          app.isReloading = false
          resolve(true)
        })
      } else {
        logWarn(`app ${appName} is not rendered, cannot use reload`)
        resolve(false)
      }
    } else {
      logWarn(`app ${appName} does not exist when reload app`)
      resolve(false)
    }
  })
}

/** 命令式渲染所需的宿主、应用配置以及可选事件回调。 */
interface RenderAppOptions extends MicroAppConfig {
  /** 子应用唯一名称。 */
  name: string,
  /** 子应用 HTML 入口地址。 */
  url: string,
  /** 接收 `<micro-app>` 元素的 DOM 节点或选择器。 */
  container: string | Element,
  /** 子应用路由前缀。 */
  baseroute?: string,
  /** 虚拟路由没有已保存地址时使用的首个页面。 */
  'default-page'?: string,
  /** 首次渲染前发送给子应用的数据。 */
  data?: Record<PropertyKey, unknown>,
  /** 子应用向基座发送数据时触发的监听器。 */
  onDataChange?: Func,
  /** 按生命周期名注册到宿主元素的回调集合。 */
  lifeCycles?: lifeCyclesType,
  /** 其余微应用配置会转成宿主元素属性。 */
  [key: string]: unknown,
}

/**
 * 创建并插入 `<micro-app>` 元素，以命令式方式渲染子应用。
 *
 * Promise 以 `mounted`/`error` 事件为唯一结算边界，并在结算前成对移除监听器。
 *
 * @param options - 应用、容器、数据和生命周期配置。
 * @returns 挂载成功时为 `true`，资源或渲染阶段报错时为 `false`。
 */
export function renderApp (options: RenderAppOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!isPlainObject<RenderAppOptions>(options)) return logError('renderApp options must be an object')
    const container: Element | null = isElement(options.container) ? options.container : isString(options.container) ? document.querySelector(options.container) : null
    if (!isElement(container)) return logError('Target container is not a DOM element.')

    const microAppElement = pureCreateElement<any>(microApp.tagName)

    for (const attr in options) {
      if (attr === 'onDataChange') {
        if (isFunction(options[attr])) {
          microAppElement.addEventListener('datachange', options[attr])
        }
      } else if (attr === 'lifeCycles') {
        const lifeCycleConfig = options[attr]
        if (isPlainObject(lifeCycleConfig)) {
          for (const lifeName in lifeCycleConfig) {
            if (lifeName.toUpperCase() in lifeCycles && isFunction(lifeCycleConfig[lifeName])) {
              microAppElement.addEventListener(lifeName.toLowerCase(), lifeCycleConfig[lifeName])
            }
          }
        }
      } else if (attr !== 'container') {
        microAppElement.setAttribute(attr, options[attr])
      }
    }

    /** 在挂载生命周期到达时释放临时监听器并成功结算。 */
    const handleMount = () => {
      releaseListener()
      resolve(true)
    }

    /** 在错误生命周期到达时释放临时监听器并失败结算。 */
    const handleError = () => {
      releaseListener()
      resolve(false)
    }

    /** 成对移除一次性生命周期监听器，避免后续重挂载重复结算。 */
    const releaseListener = () => {
      microAppElement.removeEventListener(lifeCycles.MOUNTED, handleMount)
      microAppElement.removeEventListener(lifeCycles.ERROR, handleError)
    }

    microAppElement.addEventListener(lifeCycles.MOUNTED, handleMount)
    microAppElement.addEventListener(lifeCycles.ERROR, handleError)

    container.appendChild(microAppElement)
  })
}

/**
 * 基座侧公开 API 门面，组合数据通信、路由、预加载和命令式生命周期能力。
 *
 * `start()` 负责一次性初始化全局环境并注册自定义元素；其他字段直接暴露各模块入口。
 */
export class MicroApp extends EventCenterForBaseApp implements MicroAppBaseType {
  /** 注册到 `customElements` 的标签名，可在首次启动时覆盖。 */
  tagName = 'micro-app'
  /** 标记全局环境是否已初始化，阻止同一门面重复启动。 */
  hasInit = false
  /** 保存经过兼容字段归一化的全局默认配置。 */
  options: OptionsType = {}
  /** 暴露基座侧路由控制 API。 */
  router: Router = router
  /** 暴露子应用预加载入口。 */
  preFetch = preFetch
  /** 暴露单应用卸载入口。 */
  unmountApp = unmountApp
  /** 暴露串行卸载全部应用入口。 */
  unmountAllApps = unmountAllApps
  /** 暴露活跃应用查询入口。 */
  getActiveApps = getActiveApps
  /** 暴露全部已注册应用查询入口。 */
  getAllApps = getAllApps
  /** 暴露应用重载入口。 */
  reload = reload
  /** 暴露命令式渲染入口。 */
  renderApp = renderApp

  /**
   * 一次性初始化浏览器全局代理、处理全局配置并注册微应用自定义元素。
   *
   * 非浏览器环境、重复调用、非法标签名或已被外部注册的同名元素都会提前返回。
   * 全局资源和应用预加载只负责排队，不阻塞元素注册。
   *
   * @param options - 全局默认配置、插件、预加载和自定义标签名。
   */
  start (options?: OptionsType): void {
    if (!isBrowser || !window.customElements) {
      return logError('micro-app is not supported in this environment')
    }

    /**
     * TODO: 优化代码和逻辑
     *  1、同一个基座中initGlobalEnv不能被多次执行，否则会导致死循环
     *  2、判断逻辑是否放在initGlobalEnv中合适？--- 不合适
     */
    if (this.hasInit) {
      return logError('microApp.start executed repeatedly')
    }

    this.hasInit = true

    if (options?.tagName) {
      if (/^micro-app(-\S+)?/.test(options.tagName)) {
        this.tagName = options.tagName
      } else {
        return logError(`${options.tagName} is invalid tagName`)
      }
    }

    initGlobalEnv()

    if (window.customElements.get(this.tagName)) {
      return logWarn(`element ${this.tagName} is already defined`)
    }

    if (isPlainObject<OptionsType>(options)) {
      this.options = options
      options['disable-scopecss'] = options['disable-scopecss'] ?? options.disableScopecss
      options['disable-sandbox'] = options['disable-sandbox'] ?? options.disableSandbox

      // 应用资源和全局资源都在浏览器空闲时加载，不阻塞自定义元素注册。
      options.preFetchApps && preFetch(options.preFetchApps)

      options.globalAssets && getGlobalAssets(options.globalAssets)

      if (isPlainObject(options.plugins)) {
        const modules = options.plugins.modules
        if (isPlainObject(modules)) {
          for (const appName in modules) {
            const formattedAppName = formatAppName(appName)
            if (formattedAppName && appName !== formattedAppName) {
              modules[formattedAppName] = modules[appName]
              delete modules[appName]
            }
          }
        }
      }
    }

    // 必须在全局环境快照及配置归一化之后定义元素，元素回调会立即依赖这些状态。
    defineElement(this.tagName)
  }
}

/** 默认导出的单例；确保数据中心、路由和一次性启动状态在基座内共享。 */
const microApp = new MicroApp()

export default microApp
