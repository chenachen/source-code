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
  /** 创建沙箱时传入的容器引用；document.body 读取时在其中查找 micro-app-body，预取时可能为 null。 */
  container: HTMLElement | ShadowRoot | null,
  [key: string]: any
}

/**
 * 通过隐藏同源 iframe 提供独立 JavaScript realm 的子应用沙箱。
 *
 * iframe 隔离原生构造器、原型与全局变量，再由 window/document/element 补丁把必要 DOM、事件和路由
 * 能力桥接到主页面。全局计数保护跨沙箱共享补丁，iframe 类型计数保留专属扩展边界，当前没有对应补丁。
 * 实例 active 对正常完成的 start/stop 防重复计数；ready 完成只表示 realm 补丁可用，不自动启动实例。
 */
export default class IframeSandbox {
  /** 当前处于 active 状态的 iframe 沙箱数量。 */
  static activeCount = 0
  /** 当前实例是否已经启动，防止引用计数重复增减。 */
  private active = false
  /** iframe 窗口事件的快照钩子；不记录或清理原生定时器。 */
  private windowEffect!: CommonEffectHook
  /** iframe 文档事件副作用的快照钩子。 */
  private documentEffect!: CommonEffectHook
  /** 当前子应用 popstate 监听器的解除函数。 */
  private removeHistoryListener!: CallableFunction
  /** iframe 缺少自有有效值时允许回退读取主窗口的插件属性键；赋值只保存在 iframe。 */
  public escapeProperties: PropertyKey[] = []
  /** 下一微任务移除隐藏 iframe 节点的清理函数。 */
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
  /** 构造时保存的配置对象；上游切换 app.container 不会自动更新这里的 container 快照。 */
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
      // 补齐 iframe 窗口代理和事件副作用；原生 timer 不进入事件快照钩子。
      this.windowEffect = patchWindow(appName, this.microAppWindow, this)
      // 把 iframe Document API 桥接到子应用容器与主文档。
      this.documentEffect = patchDocument(appName, this.microAppWindow, this)
      // 修补 iframe realm 的 Node/Element 原型，确保 DOM 操作进入宿主容器。
      patchElement(appName, url, this.microAppWindow, this)
      /**
       * 元数据引用 proxyLocation/proxyWindow，必须等路由和窗口补丁完成后注入。
       * 全部补丁完成后才 resolve；上游挂载等 sandboxReady 后再执行子应用脚本。
       */
      this.initStaticGlobalKeys(appName, url, this.microAppWindow)
      resolve()
    })
  }

  /**
   * 创建隐藏 iframe，返回下一微任务移除节点的清理函数。
   * 默认地址与主页面同源；配置 iframeSrc 时也必须可同源访问，后续补丁才能读取其 document。
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
     * realm 和原型提前失效，因此通过 defer 延迟到下一微任务。这里只延后一轮微任务，
     * 后续定时器或更长异步链仍可能在 iframe 移除后执行。
     * 此清理仅删除 iframe，不取消 patchIframe 的轮询任务；尚未 ready 的回调仍可能继续尝试初始化。
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
   * 上游已通过 sandboxReady；active 在路由同步前设为 true，后续同步异常直接上抛，没有状态回滚。
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
     * iframe 路由与主浏览器路由是两个 realm 的独立对象，各路由模式启动时都要主动同步。
     * vue-router 4 等实现会用 `window.location.pathname.slice(base.length)` 推导页面；不同步会读到
     * iframe 初始地址。with 沙箱也使用独立 microLocation；它不需要在 iframe realm 上做原生地址替换。
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
   * @param keepRouteState 是否保留内部 location；浏览器中的应用路径与 state 仍会移除。
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

    // 解除 start 阶段注册的宿主 popstate 监听器；已经排入的路由宏任务仍可运行。
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
   * 在释放 iframe 事件和数据监听前，按生命周期语义记录或丢弃副作用快照。
   *
   * 普通/UMD 卸载、keep-alive 隐藏与预渲染完成都会进入这里；可恢复场景记录快照，默认模式或
   * destroy 对应的 stop 传 preventRecord=true，清空旧快照，防止下一次 realm 重建后恢复失效引用。
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
   * window/document 钩子用可选链调用；数据中心尚未注入时，resetDataCenterSnapshot 也会跳过。
   */
  public resetEffectSnapshot (): void {
    this.windowEffect?.reset()
    this.documentEffect?.reset()
    resetDataCenterSnapshot(this.microAppWindow.microApp)
  }

  /**
   * 记录窗口、文档与数据中心的可恢复副作用。
   *
   * UMD 软卸载时记录 unmount 后仍登记的监听器；隐藏 keep-alive 或完成预渲染时也会记录。
   * 仅 window/document 和数据监听进入快照，iframe 原生定时器保持运行。
   */
  public recordEffectSnapshot (): void {
    this.windowEffect?.record()
    this.documentEffect?.record()
    recordDataCenterSnapshot(this.microAppWindow.microApp)
  }

  /** 在 UMD 重挂载、keep-alive 显示或预渲染转挂载时恢复已记录的事件、onclick 与数据监听。 */
  public rebuildEffectSnapshot (): void {
    this.windowEffect?.rebuild()
    this.documentEffect?.rebuild()
    rebuildDataCenterSnapshot(this.microAppWindow.microApp)
  }

  /**
   * 释放已登记的窗口事件、文档事件与数据监听。
   *
   * 这里不清理 iframe 原生定时器；UMD、keep-alive 与预渲染保留 iframe 时，定时器继续运行。
   * 默认卸载或 destroy 由 stop 移除 iframe。
   * 事件登记表清空不保证原目标解绑：capture=true、独立 Document 或变更逃逸配置均可能不匹配移除目标。
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
   * 等待身份变化。读取文档或补丁回调抛错时继续轮询，Promise 没有 reject 分支；iframeSrc 若跨域，
   * 文档持续不可访问时也不会进入就绪状态。
   *
   * @param microAppWindow 初次读取的 iframe 窗口。
   * @param cb 文档就绪后安装补丁并调用 resolve 的回调。
   */
  private patchIframe (microAppWindow: microAppWindowType, cb: CallableFunction): void {
    const oldMicroDocument = microAppWindow.document
    this.sandboxReady = new Promise<void>((resolve) => {
      (
      /**
        * 每轮排入一个零延时任务检查文档身份；读取或安装失败再排下一轮，不取消也不拒绝 ready。
        */
      function iframeLocationReady () {
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
   *
   * 每次未禁用请求补丁的 start 都新建一个 base；UMD 软卸载保留 iframe，此处不移除之前的 base。
   * baseElement 只保存最近创建的节点，后续 updateIframeBase 也只修改该引用。
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
   * @param keepRouteState - 是否保留非 custom 模式的内部 location；不阻止清理宿主应用路由记录。
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
   * 每个导出槽只在 active 且首次收到合法值时接受赋值；mount/unmount 先后到达会分别上报，
   * 上游等两者成对才切换 UMD。默认卸载或 destroy 清空槽位并移除 iframe，UMD 软卸载保留它们。
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
        /** 返回首次有效赋值捕获的 mount；软卸载后仍保留这一引用。 */
        get: () => mount,
        /** 仅活动期间首次函数赋值进入生命周期收集；是否成对由上游 handleUmdHooks 判断。 */
        set: (value) => {
          if (this.active && isFunction(value) && !mount) {
            handleUmdHooks(mount = value, unmount)
          }
        }
      },
      unmount: {
        configurable: true,
        /** 返回首次有效赋值捕获的 unmount，供业务显式读取。 */
        get: () => unmount,
        /** 仅活动期间首次函数赋值进入生命周期收集；后续重赋值不替换原钩子。 */
        set: (value) => {
          if (this.active && isFunction(value) && !unmount) {
            handleUmdHooks(mount, unmount = value)
          }
        }
      },
      [`micro-app-${appName}`]: {
        configurable: true,
        /** 返回按框架约定名称捕获的库对象；library 元素属性不参与此名称选择。 */
        get: () => microAppLibrary,
        /** 活动期间首次普通对象赋值提交其 mount/unmount；钩子是否有效仍由上游判断。 */
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
   * 更新子应用对外暴露的生命周期状态字符串。
   *
   * @param state 新状态。
   */
  public setStaticAppState (state: string): void {
    this.microAppWindow.__MICRO_APP_STATE__ = state
  }
}
