import type {
  Func,
  microAppWindowType,
  MicroLocation,
  SandBoxStartParams,
  CommonEffectHook,
  SandBoxStopParams,
  releaseGlobalEffectParams,
  plugins,
} from '@micro-app/types'
import globalEnv from '../../libs/global_env'
import microApp from '../../micro_app'
import {
  getEffectivePath,
  removeDomScope,
  pureCreateElement,
  assign,
  clearDOM,
  isPlainObject,
  isArray,
  defer,
  createURL,
  rawDefineProperties,
  isFunction,
} from '../../libs/utils'
import {
  EventCenterForMicroApp,
  rebuildDataCenterSnapshot,
  recordDataCenterSnapshot,
  resetDataCenterSnapshot,
} from '../../interact'
import {
  patchRouter,
} from './router'
import {
  router,
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
  patchElementAndDocument,
  releasePatchElementAndDocument,
} from '../../source/patch'
import {
  patchWindow,
} from './window'
import {
  patchDocument,
} from './document'
import {
  patchElement,
} from './element'
import {
  patchElementTree
} from '../adapter'
import { releaseWorkersByApp } from '../../proxies/worker'

/** iframe 沙箱的构造选项及可扩展配置。 */
interface IOption {
  /** 子应用最终挂载的宿主容器。 */
  container: HTMLElement | ShadowRoot | null,
  [key: string]: any
}

/**
 * 通过隐藏同源 iframe 提供独立 JavaScript realm 的子应用沙箱。
 *
 * iframe 隔离原生构造器、原型与全局变量，再由 window/document/element 补丁把必要 DOM、事件和路由
 * 能力桥接到主页面。两个引用计数分别保护跨沙箱共享补丁与 iframe 专属全局环境，实例 `active`
 * 保证 start/stop 严格成对。
 */
export default class IframeSandbox {
  /** 当前处于 active 状态的 iframe 沙箱数量。 */
  static activeCount = 0
  /** 当前实例是否已经启动，防止引用计数重复增减。 */
  private active = false
  /** iframe 窗口事件与定时器副作用的快照钩子。 */
  private windowEffect!: CommonEffectHook
  /** iframe 文档事件副作用的快照钩子。 */
  private documentEffect!: CommonEffectHook
  /** 当前子应用 popstate 监听器的解除函数。 */
  private removeHistoryListener!: CallableFunction
  /** 插件允许从 iframe 窗口逃生到主窗口的属性键。 */
  public escapeProperties: PropertyKey[] = []
  /** 延迟移除 iframe 节点并断开其 realm 的清理函数。 */
  public deleteIframeElement: () => void
  /** 承载子应用独立 realm 的隐藏 iframe；销毁后置空。 */
  public iframe!: HTMLIFrameElement | null
  /** iframe 文档重建并完成全部补丁后的就绪 Promise。 */
  public sandboxReady!: Promise<void>
  /** 子应用脚本访问的窗口代理；模块脚本仍可能直接命中 iframe window。 */
  public proxyWindow: WindowProxy & microAppWindowType
  /** iframe realm 的真实窗口对象。 */
  public microAppWindow: microAppWindowType
  /** 根据 micro-app 路由模式生成的 location 代理。 */
  public proxyLocation!: MicroLocation
  /** 用于补全 iframe 内相对 URL 的 base 元素。 */
  public baseElement!: HTMLBaseElement
  /** iframe 模板中的原生 head，承载 base 等沙箱内部节点。 */
  public microHead!: HTMLHeadElement
  /** iframe 模板中的原生 body，保留 iframe realm 的结构入口。 */
  public microBody!: HTMLBodyElement
  /** 子应用名称；TODO：后续抽到与 with 沙箱共享的基类。 */
  public appName: string
  /** 子应用入口 URL；TODO：后续抽到共享基类。 */
  public url: string
  /** iframe 沙箱配置。 */
  public options: IOption
  /** 默认模式停止时清空已捕获 UMD 生命周期引用的函数。 */
  public clearHijackUmdHooks!: () => void

  /**
   * 创建隐藏 iframe，等待其同源文档完成重建，再安装 realm 与 DOM 桥接补丁。
   *
   * @param appName 子应用名称。
   * @param url 子应用入口 URL。
   * @param options iframe 属性与宿主容器配置。
   */
  constructor (appName: string, url: string, options: IOption) {
    this.appName = appName
    this.url = url
    this.options = options
    const rawLocation = globalEnv.rawWindow.location
    const browserHost = rawLocation.protocol + '//' + rawLocation.host

    this.deleteIframeElement = this.createIframeElement(appName, browserHost + rawLocation.pathname, options)
    this.microAppWindow = this.iframe!.contentWindow

    this.patchIframe(this.microAppWindow, (resolve: CallableFunction) => {
      // iframe 初始化导航可能替换 contentWindow 引用，补丁前重新读取。
      this.microAppWindow = this.iframe!.contentWindow
      // 重建最小 html/head/body，移除浏览器临时文档内容。
      this.createIframeTemplate(this.microAppWindow)
      // 汇总插件允许逃生到主窗口的属性。
      this.getSpecialProperties(appName)
      // 在 iframe realm 中安装与浏览器 URL 同步的虚拟路由。
      this.proxyLocation = patchRouter(appName, url, this.microAppWindow, browserHost)
      // 补齐 iframe 窗口代理与事件、定时器副作用管理。
      this.windowEffect = patchWindow(appName, this.microAppWindow, this)
      // 把 iframe Document API 桥接到子应用容器与主文档。
      this.documentEffect = patchDocument(appName, this.microAppWindow, this)
      // 修补 iframe realm 的 Node/Element 原型，确保 DOM 操作进入宿主容器。
      patchElement(appName, url, this.microAppWindow, this)
      /**
       * 静态全局键要尽早注入，避免子应用脚本在就绪前读取空值；但其中的 location/proxyWindow 又依赖
       * 路由和窗口补丁，所以必须排在两者之后。
       */
      this.initStaticGlobalKeys(appName, url, this.microAppWindow)
      resolve()
    })
  }

  /**
   * 创建并插入同源隐藏 iframe，返回延迟销毁其 realm 的清理函数。
   *
   * @param appName 子应用名称，也作为 iframe id。
   * @param browserPath 默认 iframe 地址，保持与主页面同源。
   * @param options 可选 iframe attrs 等配置。
   * @returns 延迟移除 iframe 并置空引用的函数。
   */
  createIframeElement (
    appName: string,
    browserPath: string,
    options?: Record<string, any>
  ): () => void {
    this.iframe = pureCreateElement('iframe')

    const iframeAttrs: Record<string, string> = {
      ...options?.attrs,
      id: appName,
      src: microApp.options.iframeSrc || browserPath,
      style: 'display: none',
      'powered-by': 'micro-app',
    }

    Object.keys(iframeAttrs).forEach((key) => this.iframe!.setAttribute(key, iframeAttrs[key]))

    // iframe 必须实际插入文档，浏览器才会创建可用的 contentWindow/document realm。
    globalEnv.rawDocument.body.appendChild(this.iframe)

    /**
     * 卸载回调中可能仍有异步 DOM 操作，例如 antd 的 `notification.destroy()`；立即删除 iframe 会让其
     * realm 和原型提前失效，因此延迟到当前任务之后清理。若异步链过长，单次 defer 仍无法完全规避，
     * 后续需要更多兼容测试。
     */
    return () => defer(() => {
      // 仅默认模式或 destroy 会调用此函数，UMD 软卸载需要保留 realm 供重挂载。
      this.iframe?.parentNode?.removeChild(this.iframe)
      this.iframe = null
    })
  }

  /**
   * 启动 iframe 沙箱、同步虚拟路由并按引用计数安装共享补丁。
   *
   * 同一实例重复 start 会被 `active` 拦截；`globalEnv.activeSandbox` 跨沙箱类型管理 DOM/History 原型，
   * `IframeSandbox.activeCount` 则为 iframe 专属扩展预留 0→1/1→0 边界。
   *
   * @param baseroute 自定义路由模式的子应用基址。
   * @param defaultPage 虚拟路由首次挂载时的默认页面。
   * @param disablePatchRequest 是否禁用通过 base 元素补全请求/资源地址。
   */
  public start ({
    baseroute,
    defaultPage,
    disablePatchRequest,
  }: SandBoxStartParams): void {
    if (this.active) return
    this.active = true
    /* --- 内存路由阶段开始 --- */
    /**
     * iframe 路由与主浏览器路由是两个 realm 的独立对象，无论是否启用内存路由都要主动同步。
     * vue-router 4 等实现会用 `window.location.pathname.slice(base.length)` 推导页面；不同步会读到
     * iframe 初始地址。with 沙箱禁用内存路由时直接使用浏览器 location，不需要这一步。
     */
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
     * base 会同时影响 a、img、link、script 等相对地址；仅在未禁用请求补丁时创建，避免改变应用显式
     * 选择的浏览器解析语义。
     */
    if (!disablePatchRequest) {
      this.createIframeBase()
    }

    if (++globalEnv.activeSandbox === 1) {
      // WHY：共享 DOM/History 原型只能在全部沙箱计数 0→1 时安装一次。
      patchElementAndDocument()
      patchHistory()
    }

    if (++IframeSandbox.activeCount === 1) {
      // TODO：补充多层 iframe 子应用嵌套时的共享环境初始化。
    }
  }

  /**
   * 停止 iframe 沙箱，释放副作用与路由，并在彻底卸载时延迟销毁 realm。
   *
   * stop 可能先于 start（iframe + 默认模式重挂载路径），因此必须先检查 `active`，否则共享计数会
   * 错误减到负数。UMD 软卸载保留 iframe 与生命周期钩子，destroy 才执行完整资源清理。
   *
   * @param umdMode 是否处于 UMD 复用模式。
   * @param keepRouteState 是否保留当前子应用路由。
   * @param destroy 是否彻底销毁缓存与 iframe。
   * @param clearData 是否清除通信数据。
   */
  public stop ({
    umdMode,
    keepRouteState,
    destroy,
    clearData,
  }: SandBoxStopParams): void {
    // WHY：iframe 默认模式重挂载可能出现 stop 先于 start，不能在未激活时减少引用计数。
    if (!this.active) return

    this.recordAndReleaseEffect({ clearData }, !umdMode || destroy)

    /* --- 内存路由阶段开始 --- */
    // keep-route-state 为 true 时保留 microLocation，供下一次显示恢复。
    this.clearRouteState(keepRouteState)

    // 使用 start 阶段保存的解除函数，避免卸载后继续同步 popstate。
    this.removeHistoryListener?.()
    /* --- 内存路由阶段结束 --- */

    if (!umdMode || destroy) {
      this.deleteIframeElement()
      this.clearHijackUmdHooks()
      releaseWorkersByApp(this.microAppWindow.__MICRO_APP_NAME__)
    }

    if (--globalEnv.activeSandbox === 0) {
      // WHY：只有最后一个任意类型沙箱停止，才能还原共享 DOM/History 原型。
      releasePatchElementAndDocument()
      releasePatchHistory()
    }

    if (--IframeSandbox.activeCount === 0) {
      // TODO：若后续增加 iframe 类型共享补丁，应在此 1→0 边界统一释放。
    }

    this.active = false
  }

  /**
   * 向 iframe 窗口注入稳定的环境元数据、原始对象逃生口与数据中心。
   *
   * 该步骤应尽早执行，但必须晚于路由和窗口代理创建，因为注入值引用 `proxyLocation` 与
   * `proxyWindow`。TODO：将不应被应用重写的元数据改为只读描述符。
   *
   * @param appName 子应用名称。
   * @param url 子应用入口 URL。
   * @param microAppWindow iframe realm 的窗口对象。
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
    microAppWindow.__MICRO_APP_SANDBOX_TYPE__ = 'iframe'
    microAppWindow.rawWindow = globalEnv.rawWindow
    microAppWindow.rawDocument = globalEnv.rawDocument
    microAppWindow.microApp = assign(new EventCenterForMicroApp(appName), {
      removeDomScope,
      pureCreateElement,
      location: this.proxyLocation,
      router,
    })
  }

  /**
   * 在释放 iframe 事件、定时器和数据监听前，按生命周期语义记录或丢弃副作用快照。
   *
   * 普通/UMD 卸载、keep-alive 隐藏与预渲染完成都会进入这里；可恢复场景记录快照，默认模式或
   * destroy 则清空旧快照，防止下一次 realm 重建后恢复失效引用。
   *
   * @param options 数据清理及生命周期选项。
   * @param preventRecord 是否禁止记录并改为清空快照。
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
   * 可选链允许初始化中途失败或 iframe realm 尚未完成补丁时仍能安全执行清理。
   */
  public resetEffectSnapshot (): void {
    this.windowEffect?.reset()
    this.documentEffect?.reset()
    resetDataCenterSnapshot(this.microAppWindow.microApp)
  }

  /**
   * 记录窗口、文档与数据中心的可恢复副作用。
   *
   * 在首次执行 UMD mount、隐藏 keep-alive 应用或完成预渲染后调用；初始化不完整时跳过缺失钩子。
   */
  public recordEffectSnapshot (): void {
    this.windowEffect?.record()
    this.documentEffect?.record()
    recordDataCenterSnapshot(this.microAppWindow.microApp)
  }

  /** 在重新挂载 UMD/keep-alive 应用前重建全部副作用。 */
  public rebuildEffectSnapshot (): void {
    this.windowEffect?.rebuild()
    this.documentEffect?.rebuild()
    rebuildDataCenterSnapshot(this.microAppWindow.microApp)
  }

  /**
   * 释放 iframe realm 中的窗口事件、定时器、文档事件与数据监听。
   *
   * @param clearData 是否同时清除主、子应用通信数据。
   */
  public releaseGlobalEffect ({ clearData = false }: releaseGlobalEffectParams): void {
    this.windowEffect?.release()
    this.documentEffect?.release()
    this.microAppWindow.microApp?.clearDataListener()
    this.microAppWindow.microApp?.clearGlobalDataListener()
    if (clearData) {
      microApp.clearData(this.microAppWindow.__MICRO_APP_NAME__)
      this.microAppWindow.microApp?.clearData()
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
   * 更新子应用可见的 UMD 复用状态。
   *
   * @param state 是否启用 UMD 生命周期复用。
   */
  public markUmdMode (state: boolean): void {
    this.microAppWindow.__MICRO_APP_UMD_MODE__ = state
  }

  /**
   * 等待浏览器完成 iframe 初始文档重建，再执行所有依赖新 realm 的补丁。
   *
   * 浏览器插入 iframe 后会替换初始 document，而 Jest 通常始终复用同一对象；轮询只在非测试环境
   * 等待身份变化。访问跨域/过渡态文档失败时继续下一轮，避免 Promise 过早 reject 留下半初始化沙箱。
   *
   * TODO：重构为更明确的 load/readyState 驱动流程。
   *
   * @param microAppWindow 初次读取的 iframe 窗口。
   * @param cb 文档就绪后安装补丁并调用 resolve 的回调。
   */
  private patchIframe (microAppWindow: microAppWindowType, cb: CallableFunction): void {
    const oldMicroDocument = microAppWindow.document
    this.sandboxReady = new Promise<void>((resolve) => {
      (function iframeLocationReady () {
        setTimeout(() => {
          try {
            // 浏览器会重建 iframe document；Jest 不会，因此测试环境跳过身份变化等待。
            if (microAppWindow.document === oldMicroDocument && !__TEST__) {
              iframeLocationReady()
            } else {
              /**
               * window 对象通常保持身份，但 document 等属性会被重建，之前写入 window 的临时变量也可能
               * 被清空；必须在此时重新安装全部补丁。先 stop 当前加载，阻止 iframe 初始页面继续执行。
               */
              microAppWindow.stop()
              cb(resolve)
            }
          } catch (e) {
            iframeLocationReady()
          }
        }, 0)
      })()
    })
  }

  /**
   * 清空 iframe 初始文档并建立最小 html/head/body 模板。
   *
   * 保存原生 head/body 供沙箱内部 base 与 Document 桥接使用；它们不同于宿主中的 micro-app-head/body。
   * TODO：将模板创建与 document 补丁职责重新分层。
   *
   * @param microAppWindow 已完成文档重建的 iframe 窗口。
   */
  private createIframeTemplate (microAppWindow: microAppWindowType): void {
    const microDocument = microAppWindow.document
    clearDOM(microDocument)
    const html = microDocument.createElement('html')
    html.innerHTML = '<head></head><body></body>'
    microDocument.appendChild(html)

    // 记录 iframe realm 的原生结构节点，避免后续 document.body 代理返回宿主容器时丢失内部入口。
    this.microBody = microDocument.body
    this.microHead = microDocument.head
  }

  /**
   * 向 iframe head 插入 base，使 a、img、link、script 及浏览器请求 API 的相对地址基于子应用 URL。
   */
  private createIframeBase (): void {
    this.baseElement = pureCreateElement('base')
    this.updateIframeBase()
    this.microHead.appendChild(this.baseElement)
  }

  /**
   * 在初始化和每次虚拟路由跳转后更新 iframe base.href。
   *
   * origin 必须来自子应用入口而非主页面，pathname 则跟随 proxyLocation，二者组合才能同时满足资源
   * 跨域来源与当前相对路径语义。
   */
  public updateIframeBase = (): void => {
    // 子应用 origin 与当前虚拟 pathname 分别来自两个状态源，不能直接使用主窗口 location。
    this.baseElement?.setAttribute('href', createURL(this.url).origin + this.proxyLocation.pathname)
  }

  /**
   * 汇总全局插件与当前应用插件声明的主窗口逃生属性。
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
   * 合并一组插件的 escapeProperties。
   *
   * @param plugins 全局或单应用插件列表。
   */
  private commonActionForSpecialProperties (plugins: plugins['global']) {
    if (isArray(plugins)) {
      for (const plugin of plugins) {
        if (isPlainObject(plugin)) {
          if (isArray(plugin.escapeProperties)) {
            this.escapeProperties = this.escapeProperties.concat(plugin.escapeProperties)
          }
        }
      }
    }
  }

  /**
   * 初始化 iframe 子应用的虚拟路由并同步默认页面。
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
   * 停止时从浏览器 URL 清理 iframe 子应用路由状态。
   *
   * @param keepRouteState 是否保留当前路由以便恢复。
   */
  private clearRouteState (keepRouteState: boolean): void {
    clearRouteStateFromURL(
      this.microAppWindow.__MICRO_APP_NAME__,
      this.microAppWindow.__MICRO_APP_URL__,
      this.microAppWindow.location as MicroLocation,
      keepRouteState,
    )
  }

  /** 把 keep-alive iframe 子应用当前虚拟 location 重新附着到浏览器 URL。 */
  public setRouteInfoForKeepAliveApp (): void {
    updateBrowserURLWithLocation(
      this.microAppWindow.__MICRO_APP_NAME__,
      this.microAppWindow.location as MicroLocation,
    )
  }

  /** 从浏览器 URL 移除已隐藏 keep-alive iframe 子应用的路由片段。 */
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
   * 只在沙箱 active 且首次收到合法函数/对象时上报，避免脚本重复赋值触发生命周期二次注册；清理
   * 闭包引用后，默认模式还会销毁整个 iframe realm。
   *
   * @param appName 子应用名称。
   * @param microAppWindow iframe realm 的窗口对象。
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
