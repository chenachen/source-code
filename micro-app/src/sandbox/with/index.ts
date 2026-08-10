import type {
  Func,
  microAppWindowType,
  WithSandBoxInterface,
  plugins,
  MicroLocation,
  SandBoxStartParams,
  SandBoxStopParams,
  CommonEffectHook,
  releaseGlobalEffectParams,
} from '@micro-app/types'
import globalEnv from '../../libs/global_env'
import microApp from '../../micro_app'
import {
  EventCenterForMicroApp,
  rebuildDataCenterSnapshot,
  recordDataCenterSnapshot,
  resetDataCenterSnapshot,
} from '../../interact'
import {
  initEnvOfNestedApp,
} from '../../libs/nest_app'
import {
  GLOBAL_KEY_TO_WINDOW
} from '../../constants'
import {
  getEffectivePath,
  isArray,
  isPlainObject,
  removeDomScope,
  throttleDeferForSetAppName,
  rawDefineProperty,
  rawDefineProperties,
  rawHasOwnProperty,
  pureCreateElement,
  assign,
  isFunction,
} from '../../libs/utils'
import {
  patchDocument,
} from './document'
import {
  patchWindow,
} from './window'
import {
  patchElementAndDocument,
  releasePatchElementAndDocument,
} from '../../source/patch'
import {
  router,
  createMicroRouter,
  initRouteStateWithURL,
  clearRouteStateFromURL,
  addHistoryListener,
  removePathFromBrowser,
  updateBrowserURLWithLocation,
  patchHistory,
  releasePatchHistory,
  isRouterModeCustom,
} from '../router'
import {
  BaseSandbox,
  CustomWindow,
  fixBabelPolyfill6,
  patchElementTree,
} from '../adapter'
import {
  createMicroFetch,
  useMicroEventSource,
  createMicroXMLHttpRequest,
} from '../request'
import { releaseWorkersByApp } from '../../proxies/worker'

/**
 * with 沙箱注入到子应用窗口目标对象上的运行时元数据。
 *
 * TODO：后续迁移到 `global.d.ts`，让脚本侧的全局类型与此处实现保持单一来源。
 */
export type MicroAppWindowDataType = {
  /** 标识当前代码运行在 micro-app 子应用环境中。 */
  __MICRO_APP_ENVIRONMENT__: boolean,
  /** 当前子应用的唯一名称。 */
  __MICRO_APP_NAME__: string,
  /** 当前子应用入口 URL。 */
  __MICRO_APP_URL__: string,
  /** 由入口 URL 推导的静态资源公共路径。 */
  __MICRO_APP_PUBLIC_PATH__: string,
  /** 自定义路由模式使用的基础 URL。 */
  __MICRO_APP_BASE_URL__: string,
  /** 子应用路由基址。 */
  __MICRO_APP_BASE_ROUTE__: string,
  /** 当前是否按 UMD 生命周期复用沙箱。 */
  __MICRO_APP_UMD_MODE__: boolean,
  /** 当前是否处于预渲染阶段。 */
  __MICRO_APP_PRE_RENDER__: boolean
  /** 静态应用对外暴露的状态字符串。 */
  __MICRO_APP_STATE__: string
  /** 当前子应用专属的数据中心与路由入口。 */
  microApp: EventCenterForMicroApp,
  /** 未经代理的主应用窗口，仅供显式逃生与兼容场景使用。 */
  rawWindow: Window,
  /** 未经代理的主应用文档，仅供显式逃生与兼容场景使用。 */
  rawDocument: Document,
  /** 主动清除当前 DOM 作用域标记的辅助函数。 */
  removeDomScope: () => void,
}

/** 子应用可见的窗口目标对象类型，组合原生 Window API 与 micro-app 元数据。 */
export type MicroAppWindowType = Window & MicroAppWindowDataType

/** with 代理对外暴露的 WindowProxy 类型。 */
export type proxyWindow = WindowProxy & MicroAppWindowDataType

/** EventSource 的子应用构造器工厂及按应用清理函数。 */
const { createMicroEventSource, clearMicroEventSource } = useMicroEventSource()

/**
 * 基于 `with(proxyWindow)` 与 Proxy 实现的子应用沙箱。
 *
 * 写操作优先落到独立 `microAppWindow`，读取按 scope/escape 规则回退到主窗口；生命周期还统一管理
 * DOM/History 全局补丁、路由状态、网络 API 和事件副作用快照。静态计数用于让共享补丁只在第一个
 * 沙箱启动时安装、最后一个沙箱停止时释放。
 */
export default class WithSandBox extends BaseSandbox implements WithSandBoxInterface {
  /** 当前处于 active 状态的 with 沙箱数量。 */
  static activeCount = 0
  /** 当前实例是否已经启动，防止引用计数重复增减。 */
  private active = false
  /** 窗口事件与定时器副作用的记录/重建/释放钩子。 */
  private windowEffect!: CommonEffectHook
  /** 文档事件副作用的记录/重建/释放钩子。 */
  private documentEffect!: CommonEffectHook
  /** 当前子应用 popstate 监听器的解除函数。 */
  private removeHistoryListener!: CallableFunction
  /** 子应用脚本实际访问的 Proxy 窗口。 */
  public proxyWindow!: proxyWindow
  /** Proxy 的独立目标对象，承载子应用写入与注入的全局变量。 */
  public microAppWindow = new CustomWindow() as MicroAppWindowType

  /**
   * 创建 with 沙箱并异步完成路由、窗口、文档及静态全局补丁。
   *
   * @param appName 子应用名称。
   * @param url 子应用入口 URL。
   */
  constructor (appName: string, url: string) {
    super(appName, url)
    this.patchWith((resolve: CallableFunction) => {
      // 汇总插件声明的强制作用域键与逃生键，供 Proxy 路由读写。
      this.getSpecialProperties(appName)
      // 创建子应用专属 location/history，避免直接改写主应用路由对象。
      this.patchRouter(appName, url, this.microAppWindow)
      // 构造窗口 Proxy 并接管全局事件、定时器等副作用。
      this.windowEffect = patchWindow(appName, this.microAppWindow, this)
      // 构造 document Proxy，并把 DOM 创建与查询限定到当前子应用。
      this.documentEffect = patchDocument(appName, this.microAppWindow, this)
      // 复制依赖原生描述符语义的 self/top/parent 等窗口别名。
      this.setMappingPropertiesWithRawDescriptor(this.microAppWindow)
      // 注入只与当前子应用实例相关的静态运行时元数据。
      this.initStaticGlobalKeys(appName, url, this.microAppWindow)
      resolve()
    })
  }

  /**
   * 启动沙箱、恢复路由环境并按引用计数安装共享全局补丁。
   *
   * `active` 是引用计数的前置保护：同一实例重复 start 不得再次递增两个计数。`globalEnv.activeSandbox`
   * 跨沙箱类型保护 DOM/History 补丁，`WithSandBox.activeCount` 则只统计 with 沙箱的嵌套应用环境。
   *
   * @param umdMode 是否复用 UMD 生命周期与全局变量。
   * @param baseroute 子应用路由基址。
   * @param defaultPage 虚拟路由首次挂载时的默认页面。
   * @param disablePatchRequest 是否禁止重写请求 API。
   */
  public start ({
    umdMode,
    baseroute,
    defaultPage,
    disablePatchRequest,
  }: SandBoxStartParams): void {
    if (this.active) return
    this.active = true

    /* --- 内存路由阶段开始 --- */
    // 初始化 microLocation，并把当前子应用路由信息附着到浏览器 URL。
    this.initRouteState(defaultPage)

    // 每个子应用只登记一个 popstate 监听器，并保存精确清理函数。
    this.removeHistoryListener = addHistoryListener(
      this.microAppWindow.__MICRO_APP_NAME__,
    )

    if (isRouterModeCustom(this.microAppWindow.__MICRO_APP_NAME__)) {
      this.microAppWindow.__MICRO_APP_BASE_ROUTE__ = this.microAppWindow.__MICRO_APP_BASE_URL__ = baseroute
    }
    /* --- 内存路由阶段结束 --- */

    /**
     * 默认模式重渲染必须恢复到首次执行前的全局环境：脚本可能改写注入键，而 stop 会删除它们，
     * 所以每次重新启动都要初始化。UMD 模式在 stop 时保留全局键，跳过可避免覆盖应用持久状态；
     * 首次 start 必然走默认模式，因此不会漏初始化。
     */
    if (!umdMode) {
      this.initGlobalKeysWhenStart(
        this.microAppWindow.__MICRO_APP_NAME__,
        this.microAppWindow.__MICRO_APP_URL__,
        this.microAppWindow,
        disablePatchRequest,
      )
    }

    if (++globalEnv.activeSandbox === 1) {
      // WHY：DOM 与 History 原型补丁由所有沙箱共享，只能在全局 0→1 时安装一次。
      patchElementAndDocument()
      patchHistory()
    }

    if (++WithSandBox.activeCount === 1) {
      // effectDocumentEvent()
      initEnvOfNestedApp()
    }

    fixBabelPolyfill6()
  }

  /**
   * 停止沙箱，记录或清空副作用快照，并按引用计数释放共享补丁。
   *
   * `active` 保证 stop 与 start 成对，避免计数降到负数。普通卸载会清理临时全局键；UMD 软卸载保留
   * 可复用状态，只有 destroy 才执行彻底清理。
   *
   * @param umdMode 是否处于 UMD 复用模式。
   * @param keepRouteState 是否保留浏览器 URL 中的子应用路由。
   * @param destroy 是否彻底销毁并删除缓存资源。
   * @param clearData 是否清除主、子应用间的数据。
   */
  public stop ({
    umdMode,
    keepRouteState,
    destroy,
    clearData,
  }: SandBoxStopParams): void {
    if (!this.active) return
    this.recordAndReleaseEffect({ umdMode, clearData, destroy }, !umdMode || destroy)

    /* --- 内存路由阶段开始 --- */
    // 按 keepRouteState 决定恢复或保留浏览器 URL 与 history.state。
    this.clearRouteState(keepRouteState)

    // 使用 start 阶段保存的解除函数，避免遗留 popstate 监听器。
    this.removeHistoryListener?.()
    /* --- 内存路由阶段结束 --- */

    /**
     * 注入键与逃生键必须在副作用释放后删除：初始目标对象上已有但运行期被重写的键也会进入集合，
     * 若过早删除会让清理逻辑读不到依赖。UMD 模式保留全局键；默认模式还必须删除 mount/unmount
     * 等钩子，防止下一次加载误复用旧生命周期。
     */
    if (!umdMode || destroy) {
      clearMicroEventSource(this.microAppWindow.__MICRO_APP_NAME__)
      releaseWorkersByApp(this.microAppWindow.__MICRO_APP_NAME__)

      this.injectedKeys.forEach((key: PropertyKey) => {
        Reflect.deleteProperty(this.microAppWindow, key)
      })
      this.injectedKeys.clear()

      this.escapeKeys.forEach((key: PropertyKey) => {
        Reflect.deleteProperty(globalEnv.rawWindow, key)
      })
      this.escapeKeys.clear()

      this.clearHijackUmdHooks()
    }

    if (--globalEnv.activeSandbox === 0) {
      // WHY：只有最后一个任意类型沙箱停止，才能安全还原共享 DOM/History 原型。
      releasePatchElementAndDocument()
      releasePatchHistory()
    }

    if (--WithSandBox.activeCount === 0) {
      // releaseEffectDocumentEvent()
    }

    this.active = false
  }

  /**
   * 向子应用窗口目标注入稳定的环境元数据、原始对象逃生口与数据中心。
   *
   * TODO：把不应由应用重写的元数据改为只读描述符。
   *
   * @param appName 子应用名称。
   * @param url 子应用入口 URL。
   * @param microAppWindow 子应用窗口目标对象。
   */
  private initStaticGlobalKeys (
    appName: string,
    url: string,
    microAppWindow: microAppWindowType,
  ): void {
    microAppWindow.__MICRO_APP_ENVIRONMENT__ = true
    microAppWindow.__MICRO_APP_NAME__ = appName
    microAppWindow.__MICRO_APP_URL__ = url
    microAppWindow.__MICRO_APP_PUBLIC_PATH__ = getEffectivePath(url)
    microAppWindow.__MICRO_APP_BASE_ROUTE__ = ''
    microAppWindow.__MICRO_APP_WINDOW__ = microAppWindow
    microAppWindow.__MICRO_APP_PRE_RENDER__ = false
    microAppWindow.__MICRO_APP_UMD_MODE__ = false
    microAppWindow.__MICRO_APP_PROXY_WINDOW__ = this.proxyWindow
    microAppWindow.__MICRO_APP_SANDBOX__ = this
    microAppWindow.__MICRO_APP_SANDBOX_TYPE__ = 'with'
    microAppWindow.rawWindow = globalEnv.rawWindow
    microAppWindow.rawDocument = globalEnv.rawDocument
    microAppWindow.microApp = assign(new EventCenterForMicroApp(appName), {
      removeDomScope,
      pureCreateElement,
      location: microAppWindow.location,
      router,
    })
  }

  /**
   * 在释放全局事件、定时器和数据监听前，按生命周期语义记录或丢弃副作用快照。
   *
   * 普通/UMD 卸载、keep-alive 隐藏与预渲染完成都会进入这里；可恢复场景记录快照，彻底销毁或
   * 默认模式则先清空旧快照，避免下一次挂载恢复已经失效的资源。
   *
   * @param options 清理数据、预渲染、keep-alive、UMD 与销毁选项。
   * @param preventRecord 是否禁止记录并改为清空已有快照。
   */
  public recordAndReleaseEffect (
    options: releaseGlobalEffectParams,
    preventRecord = false,
  ): void {
    if (preventRecord) {
      this.resetEffectSnapshot()
    } else {
      this.recordEffectSnapshot()
    }
    this.releaseGlobalEffect(options)
  }

  /**
   * 清空窗口、文档与数据中心的副作用快照。
   *
   * 用于默认模式或彻底销毁，也覆盖手动卸载已隐藏 keep-alive / 预渲染应用的失败恢复边界。
   */
  public resetEffectSnapshot (): void {
    this.windowEffect.reset()
    this.documentEffect.reset()
    resetDataCenterSnapshot(this.microAppWindow.microApp)
  }

  /**
   * 记录窗口、文档与数据中心的可恢复副作用。
   *
   * 在首次执行 UMD mount、隐藏 keep-alive 应用或完成预渲染后调用；各子钩子负责合并重复记录。
   */
  public recordEffectSnapshot (): void {
    this.windowEffect.record()
    this.documentEffect.record()
    recordDataCenterSnapshot(this.microAppWindow.microApp)
  }

  /** 在重新挂载 UMD/keep-alive 应用前重建全部副作用，并由各钩子清空已消费快照。 */
  public rebuildEffectSnapshot (): void {
    this.windowEffect.rebuild()
    this.documentEffect.rebuild()
    rebuildDataCenterSnapshot(this.microAppWindow.microApp)
  }

  /**
   * 释放窗口事件、定时器、文档事件与数据监听。
   *
   * 默认模式且非 keep-alive/预渲染时会连 on 属性一起清除；可恢复模式只移除当前真实绑定，保留快照。
   * `destroy` 始终走最彻底清理，`clearData` 额外删除主应用和子应用两侧的数据缓存。
   *
   * @param umdMode 是否处于 UMD 复用模式。
   * @param clearData 是否清除通信数据。
   * @param isPrerender 是否处于预渲染阶段。
   * @param keepAlive 是否为 keep-alive 隐藏。
   * @param destroy 是否彻底销毁。
   */
  public releaseGlobalEffect ({
    umdMode = false,
    clearData = false,
    isPrerender = false,
    keepAlive = false,
    destroy = false,
  }: releaseGlobalEffectParams): void {
    // 只有不可恢复的默认模式或 destroy 才允许窗口钩子清除 on* 属性值。
    this.windowEffect.release((!umdMode && !keepAlive && !isPrerender) || destroy)
    this.documentEffect.release()
    this.microAppWindow.microApp?.clearDataListener()
    this.microAppWindow.microApp?.clearGlobalDataListener()
    if (clearData) {
      microApp.clearData(this.microAppWindow.__MICRO_APP_NAME__)
      this.microAppWindow.microApp?.clearData()
    }
  }

  /**
   * 汇总全局插件与当前应用插件声明的 scope/escape 属性。
   *
   * @param appName 子应用名称。
   */
  private getSpecialProperties (appName: string): void {
    if (isPlainObject(microApp.options.plugins)) {
      this.commonActionForSpecialProperties(microApp.options.plugins.global)
      this.commonActionForSpecialProperties(microApp.options.plugins.modules?.[appName])
    }
  }

  /**
   * 合并一组插件声明的强制作用域键和逃生键。
   *
   * @param plugins 全局或单应用插件列表。
   */
  private commonActionForSpecialProperties (plugins: plugins['global']) {
    if (isArray(plugins)) {
      for (const plugin of plugins) {
        if (isPlainObject(plugin)) {
          if (isArray(plugin.scopeProperties)) {
            this.scopeProperties = this.scopeProperties.concat(plugin.scopeProperties)
          }
          if (isArray(plugin.escapeProperties)) {
            this.escapeProperties = this.escapeProperties.concat(plugin.escapeProperties)
          }
        }
      }
    }
  }

  /**
   * 更新子应用可见的预渲染状态。
   *
   * @param state 是否处于预渲染阶段。
   */
  public setPreRenderState (state: boolean): void {
    this.microAppWindow.__MICRO_APP_PRE_RENDER__ = state
  }

  /**
   * 更新子应用可见的 UMD 模式状态。
   *
   * @param state 是否启用 UMD 生命周期复用。
   */
  public markUmdMode (state: boolean): void {
    this.microAppWindow.__MICRO_APP_UMD_MODE__ = state
  }

  /**
   * 建立沙箱初始化 Promise，并把完成权交给同步补丁回调。
   *
   * @param cb 接收 resolve 的初始化过程。
   */
  private patchWith (cb: CallableFunction): void {
    this.sandboxReady = new Promise<void>((resolve) => cb(resolve))
  }

  /**
   * 按原生窗口描述符语义定义 `top`、`parent`、`window` 等自引用属性。
   *
   * 主页面中 top/parent 应指向代理窗口以维持隔离；若 micro-app 自身运行于 iframe，则保留真实跨帧
   * 层级，避免伪造父窗口关系。
   *
   * @param microAppWindow 子应用窗口目标对象。
   */
  private setMappingPropertiesWithRawDescriptor (microAppWindow: microAppWindowType): void {
    let topValue: Window, parentValue: Window
    const rawWindow = globalEnv.rawWindow
    if (rawWindow === rawWindow.parent) { // 主应用不在 iframe 中时，子应用看到的层级根就是自身代理。
      topValue = parentValue = this.proxyWindow
    } else { // 主应用本身位于 iframe 时，沿用浏览器提供的真实 top/parent。
      topValue = rawWindow.top
      parentValue = rawWindow.parent
    }

    rawDefineProperties(microAppWindow, {
      top: this.createDescriptorForMicroAppWindow('top', topValue),
      parent: this.createDescriptorForMicroAppWindow('parent', parentValue),
    })

    GLOBAL_KEY_TO_WINDOW.forEach((key: PropertyKey) => {
      rawDefineProperty(
        microAppWindow,
        key,
        this.createDescriptorForMicroAppWindow(key, this.proxyWindow)
      )
    })
  }

  /**
   * 基于主窗口原属性生成指向子应用窗口的值描述符。
   *
   * configurable/enumerable/writable 尽量保持原语义；访问器有 setter 时视为可写，从而兼容赋值。
   *
   * @param key 主窗口属性键。
   * @param value 子应用侧应返回的映射值。
   * @returns 可定义到 `microAppWindow` 的描述符。
   */
  private createDescriptorForMicroAppWindow (key: PropertyKey, value: unknown): PropertyDescriptor {
    const { configurable = true, enumerable = true, writable, set } = Object.getOwnPropertyDescriptor(globalEnv.rawWindow, key) || { writable: true }
    const descriptor: PropertyDescriptor = {
      value,
      configurable,
      enumerable,
      writable: writable ?? !!set
    }

    return descriptor
  }

  /**
   * 每次默认模式 start 时重建可变全局能力。
   *
   * 自有属性判断同时覆盖目标对象和主窗口；随后补回 eval/Image、请求 API 与强制作用域键，确保
   * 上次 stop 删除注入键后重新挂载仍与首次运行一致。
   *
   * @param appName 子应用名称。
   * @param url 子应用入口 URL。
   * @param microAppWindow 子应用窗口目标对象。
   * @param disablePatchRequest 是否禁止改写请求 API。
   */
  private initGlobalKeysWhenStart (
    appName: string,
    url: string,
    microAppWindow: microAppWindowType,
    disablePatchRequest: boolean,
  ): void {
    microAppWindow.hasOwnProperty = (key: PropertyKey) => rawHasOwnProperty.call(microAppWindow, key) || rawHasOwnProperty.call(globalEnv.rawWindow, key)
    this.setHijackProperty(appName, microAppWindow)
    if (!disablePatchRequest) this.patchRequestApi(appName, url, microAppWindow)
    this.setScopeProperties(microAppWindow)
  }

  /**
   * 用访问器劫持 `eval` 与 `Image`，在读取时设置当前应用 DOM 作用域。
   *
   * 子应用后续赋值会保存在局部槽位，不污染主窗口；读取仍先刷新应用名，使 eval 或 Image 创建的
   * 动态节点能被 DOM 适配器归属到正确应用。
   *
   * @param appName 子应用名称。
   * @param microAppWindow 子应用窗口目标对象。
   */
  private setHijackProperty (appName: string, microAppWindow: microAppWindowType): void {
    let modifiedEval: unknown, modifiedImage: unknown
    rawDefineProperties(microAppWindow, {
      eval: {
        configurable: true,
        enumerable: false,
        /** 返回子应用覆盖值或主窗口 eval，并在读取前刷新 DOM 作用域。 */
        get () {
          throttleDeferForSetAppName(appName)
          return modifiedEval || globalEnv.rawWindow.eval
        },
        set: (value) => {
          modifiedEval = value
        },
      },
      Image: {
        configurable: true,
        enumerable: false,
        /** 返回子应用覆盖值或带节点归属标记的 Image 代理。 */
        get () {
          throttleDeferForSetAppName(appName)
          return modifiedImage || globalEnv.ImageProxy
        },
        set: (value) => {
          modifiedImage = value
        },
      },
    })
  }

  /**
   * 用相对 URL 感知的包装器重写 fetch、XMLHttpRequest 与 EventSource。
   *
   * 若子应用再覆盖这些构造器，setter 会基于新实现重新生成包装器，既保留用户定制又继续执行 URL
   * 补全与按应用清理。
   *
   * @param appName 子应用名称。
   * @param url 子应用入口 URL，用作相对请求基址。
   * @param microAppWindow 子应用窗口目标对象。
   */
  private patchRequestApi (appName: string, url: string, microAppWindow: microAppWindowType): void {
    let microFetch = createMicroFetch(url)
    let microXMLHttpRequest = createMicroXMLHttpRequest(url)
    let microEventSource = createMicroEventSource(appName, url)

    rawDefineProperties(microAppWindow, {
      fetch: {
        configurable: true,
        enumerable: true,
        /** 返回当前子应用 fetch 包装器。 */
        get () {
          return microFetch
        },
        /** 以子应用新赋值的 fetch 为底层实现重新包装。 */
        set (value) {
          microFetch = createMicroFetch(url, value)
        },
      },
      XMLHttpRequest: {
        configurable: true,
        enumerable: true,
        /** 返回当前子应用 XMLHttpRequest 包装构造器。 */
        get () {
          return microXMLHttpRequest
        },
        /** 以子应用新赋值的构造器重新生成请求包装。 */
        set (value) {
          microXMLHttpRequest = createMicroXMLHttpRequest(url, value)
        },
      },
      EventSource: {
        configurable: true,
        enumerable: true,
        /** 返回当前子应用 EventSource 包装构造器。 */
        get () {
          return microEventSource
        },
        /** 以子应用新赋值的构造器重新生成可按应用回收的包装。 */
        set (value) {
          microEventSource = createMicroEventSource(appName, url, value)
        },
      },
    })
  }

  /**
   * 把插件声明的作用域键预置到 Proxy 目标，阻止 `with(microAppWindow)` 对裸标识符回退到主窗口。
   *
   * `Symbol.unscopables` 无法约束尚不存在的键，因此即使值为 undefined 也要创建自有属性。例如
   * `if (!xxx) {}` 应只观察子应用作用域；显式 `window.xxx` 已经过 proxyWindow，不依赖此机制。
   *
   * @param microAppWindow 子应用窗口目标对象。
   */
  setScopeProperties (microAppWindow: microAppWindowType): void {
    this.scopeProperties.forEach((key: PropertyKey) => {
      Reflect.set(microAppWindow, key, microAppWindow[key])
    })
  }

  /**
   * 把子应用专属 location/history 安装到窗口目标。
   *
   * location 写入仍按浏览器语义跳转主窗口；读取则始终返回虚拟路由对象，history 只读返回与之配套
   * 的实现，从而让二者状态一致。
   *
   * @param appName 子应用名称。
   * @param url 子应用入口 URL。
   * @param microAppWindow 子应用窗口目标对象。
   */
  private patchRouter (appName: string, url: string, microAppWindow: microAppWindowType): void {
    const { microLocation, microHistory } = createMicroRouter(appName, url)
    rawDefineProperties(microAppWindow, {
      location: {
        configurable: false,
        enumerable: true,
        /** 返回当前子应用的虚拟 location。 */
        get () {
          return microLocation
        },
        set: (value) => {
          globalEnv.rawWindow.location = value
        },
      },
      history: {
        configurable: true,
        enumerable: true,
        /** 返回与虚拟 location 同步的子应用 history。 */
        get () {
          return microHistory
        },
      },
    })
  }

  /**
   * 初始化子应用内存路由，并把默认页面写入浏览器 URL 状态。
   *
   * @param defaultPage 首次进入时的默认页面。
   */
  private initRouteState (defaultPage: string): void {
    initRouteStateWithURL(
      this.microAppWindow.__MICRO_APP_NAME__,
      this.microAppWindow.location as MicroLocation,
      defaultPage,
    )
  }

  /**
   * 停止时从浏览器 URL 清理子应用路由状态。
   *
   * @param keepRouteState 是否保留当前路由以便后续恢复。
   */
  private clearRouteState (keepRouteState: boolean): void {
    clearRouteStateFromURL(
      this.microAppWindow.__MICRO_APP_NAME__,
      this.microAppWindow.__MICRO_APP_URL__,
      this.microAppWindow.location as MicroLocation,
      keepRouteState,
    )
  }

  /** 把 keep-alive 子应用当前虚拟 location 重新附着到浏览器 URL。 */
  public setRouteInfoForKeepAliveApp (): void {
    updateBrowserURLWithLocation(
      this.microAppWindow.__MICRO_APP_NAME__,
      this.microAppWindow.location as MicroLocation,
    )
  }

  /** 从浏览器 URL 移除已隐藏 keep-alive 子应用的路由片段。 */
  public removeRouteInfoForKeepAliveApp (): void {
    removePathFromBrowser(this.microAppWindow.__MICRO_APP_NAME__)
  }

  /**
   * 遍历初始 HTML 节点并写入子应用归属信息。
   *
   * @param container 子应用容器或其 ShadowRoot。
   */
  public patchStaticElement (container: Element | ShadowRoot): void {
    patchElementTree(container, this.microAppWindow.__MICRO_APP_NAME__)
  }

  /**
   * 在执行子应用脚本前标记静态 DOM，并劫持 UMD 生命周期导出。
   *
   * @param container 子应用容器或其 ShadowRoot。
   * @param handleUmdHooks 收集到 mount/unmount 后的处理函数。
   */
  public actionsBeforeExecScripts (container: Element | ShadowRoot, handleUmdHooks: Func): void {
    this.patchStaticElement(container)
    this.clearHijackUmdHooks = this.hijackUmdHooks(this.appName, this.microAppWindow, handleUmdHooks)
  }

  /**
   * 劫持 `mount`、`unmount` 与 `micro-app-${appName}` 三种 UMD 导出形式。
   *
   * 只在沙箱 active 且首次收到合法函数/对象时上报，避免脚本重复赋值触发生命周期二次注册；返回的
   * 清理函数只丢弃闭包引用，属性本身由 stop 阶段的注入键清理负责删除。
   *
   * @param appName 子应用名称。
   * @param microAppWindow 子应用窗口目标对象。
   * @param handleUmdHooks 生命周期收集回调。
   * @returns 清空已捕获生命周期引用的函数。
   */
  private hijackUmdHooks (
    appName: string,
    microAppWindow: microAppWindowType,
    handleUmdHooks: Func,
  ): () => void {
    let mount: Func | null, unmount: Func | null, microAppLibrary: Record<string, unknown> | null
    rawDefineProperties(microAppWindow, {
      mount: {
        configurable: true,
        get: () => mount,
        set: (value) => {
          if (this.active && isFunction(value) && !mount) {
            handleUmdHooks(mount = value, unmount)
          }
        }
      },
      unmount: {
        configurable: true,
        get: () => unmount,
        set: (value) => {
          if (this.active && isFunction(value) && !unmount) {
            handleUmdHooks(mount, unmount = value)
          }
        }
      },
      [`micro-app-${appName}`]: {
        configurable: true,
        get: () => microAppLibrary,
        set: (value) => {
          if (this.active && isPlainObject(value) && !microAppLibrary) {
            microAppLibrary = value
            handleUmdHooks(microAppLibrary.mount, microAppLibrary.unmount)
          }
        }
      }
    })

    return () => {
      mount = unmount = microAppLibrary = null
    }
  }

  /**
   * 更新静态应用对外暴露的状态字符串。
   *
   * @param state 新状态。
   */
  public setStaticAppState (state: string): void {
    this.microAppWindow.__MICRO_APP_STATE__ = state
  }
}
