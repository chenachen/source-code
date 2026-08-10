/* eslint-disable no-new */
import type {
  AttrType,
  MicroAppElementInterface,
  AppInterface,
  OptionsType,
  NormalKey,
} from '@micro-app/types'
import microApp from './micro_app'
import dispatchLifecyclesEvent from './interact/lifecycles_event'
import globalEnv from './libs/global_env'
import {
  defer,
  formatAppName,
  formatAppURL,
  version,
  logError,
  logWarn,
  isString,
  isFunction,
  CompletionPath,
  createURL,
  isPlainObject,
  getEffectivePath,
} from './libs/utils'
import {
  ObservedAttrName,
  lifeCycles,
  appStates,
} from './constants'
import CreateApp, {
  appInstanceMap,
} from './create_app'
import {
  router,
  getNoHashMicroPathFromURL,
  initRouterMode,
} from './sandbox/router'

/**
 * 定义承载子应用的自定义元素类并注册到浏览器。
 *
 * 类定义放在函数内部，使配置的标签名对应独立构造器；调用方必须保证同名元素尚未注册。
 *
 * @param tagName - 要注册的自定义元素名称。
*/
export function defineElement (tagName: string): void {
  /**
   * 把 DOM 连接、属性变化转换为 `CreateApp` 的创建、挂载、隐藏和卸载操作。
   *
   * 元素持有宿主层配置和连接代次；应用实例及运行状态由 `appInstanceMap` 中的
   * `CreateApp` 持有，两者通过规范化应用名关联。
   */
  class MicroAppElement extends HTMLElement implements MicroAppElementInterface {
    /** 仅名称和入口 URL 变化会触发实例复用或替换判定。 */
    static get observedAttributes (): string[] {
      return ['name', 'url']
    }

    /** 合并同一任务内连续的 name/url 更新，避免重复卸载和重建。 */
    private isWaiting = false
    /** 在应用名尚未就绪时暂存通过 DOM 属性写入的基座数据。 */
    private cacheData: Record<PropertyKey, unknown> | null = null
    /** 当前元素经历的连接代次；每次连接单调递增。 */
    private connectedCount = 0
    /** 记录各连接代次是否仍有效，供异步挂载任务淘汰过期连接。 */
    private connectStateMap: Map<number, boolean> = new Map()
    /** 规范化后的应用名，同时决定数据中心通道名。 */
    private _appName = ''
    /** 规范化后的子应用 HTML 入口地址。 */
    public appUrl = ''
    /** SSR 模式实际请求的页面地址；非 SSR 模式为空。 */
    public ssrUrl = ''
    /** 暴露给元素使用者和开发者工具的框架版本。 */
    public version = version

    /**
     * 记录一次 DOM 连接，并异步把有效连接转成创建/挂载操作。
     *
     * Firefox 中 iframe 插入文档后可能让节点原型回落到原生 `Node.prototype`，因此先
     * 恢复自定义元素原型。异步边界用于吸收 Vue keep-alive 等场景的瞬时插入/移除；
     * `connectStateMap` 保证已断开的连接代次不会继续渲染。
     */
    public connectedCallback (): void {
      /**
       * Firefox 中 iframe 节点插入文档后，`Node.prototype` 可能重新指向原生对象。
       * 若 `<micro-app>` 丢失本类原型，这里必须先恢复，否则后续生命周期方法不可用。
       */
      if (Object.getPrototypeOf(this) !== MicroAppElement.prototype) {
        Object.setPrototypeOf(this, MicroAppElement.prototype)
      }
      const cacheCount = ++this.connectedCount
      this.connectStateMap.set(cacheCount, true)
      /**
       * Vue keep-alive 等集成可能在同一轮任务内快速插入、删除元素。挂载推迟到异步任务，
       * 并以连接代次验证有效性，防止过期任务重复渲染。
       */
      const effectiveApp = this.appName && this.appUrl
      defer(() => {
        if (this.connectStateMap.get(cacheCount)) {
          dispatchLifecyclesEvent(
            this,
            this.appName,
            lifeCycles.CREATED,
          )
          /**
           * Angular 等场景会先插入空元素、随后再设置 name/url。若当前连接时配置不完整，
           * 只发 `created`；等属性回调补齐后再进入 `handleConnected()`，避免执行两次。
           */
          effectiveApp && this.handleConnected()
        }
      })
    }

    /** 使当前连接代次失效，并把 DOM 移除转换为隐藏或卸载操作。 */
    public disconnectedCallback (): void {
      this.connectStateMap.set(this.connectedCount, false)
      this.handleDisconnected()
    }

    /**
     * 先执行当前实例的断开流程，再用同一元素重新连接应用。
     *
     * Promise 等待 `mounted` 或 `aftershow`，因此普通重挂载和 keep-alive 恢复共用同一完成边界。
     *
     * @param destroy - 是否在重载前彻底销毁旧实例与缓存。
     * @returns 新实例挂载或旧 keep-alive 实例恢复显示后为 `true`。
     */
    public reload (destroy?: boolean): Promise<boolean> {
      return new Promise((resolve) => {
        /** 任一成功恢复生命周期到达后，移除成对监听并结算重载。 */
        const handleAfterReload = () => {
          this.removeEventListener(lifeCycles.MOUNTED, handleAfterReload)
          this.removeEventListener(lifeCycles.AFTERSHOW, handleAfterReload)
          resolve(true)
        }
        this.addEventListener(lifeCycles.MOUNTED, handleAfterReload)
        this.addEventListener(lifeCycles.AFTERSHOW, handleAfterReload)
        this.handleDisconnected(destroy, () => {
          this.handleConnected()
        })
      })
    }

    /**
     * 根据 keep-alive 配置选择隐藏或普通卸载。
     *
     * 已卸载、已隐藏或尚未注册的实例不重复处理。
     *
     * @param destroy - 重载场景要求的彻底销毁标记；开启时不会走 keep-alive 隐藏。
     * @param callback - 隐藏或卸载完成后的续接动作。
     */
    private handleDisconnected (destroy = false, callback?: CallableFunction): void {
      const app = appInstanceMap.get(this.appName)
      if (app && !app.isUnmounted() && !app.isHidden()) {
        // keep-alive 模式只隐藏实例；显式销毁仍走普通卸载。
        if (this.getKeepAliveModeResult() && !destroy) {
          this.handleHiddenKeepAliveApp(callback)
        } else {
          this.unmount(destroy, callback)
        }
      }
    }

    /**
     * 规范化 `name`/`url`，处理首次配置，并合并连接后的连续属性更新。
     *
     * 首次赋值立即尝试连接；已连接元素的更新推迟到同一异步任务，确保 name 与 url
     * 同时变化时只比较、卸载和重建一次。
     */
    public attributeChangedCallback (attr: ObservedAttrName, _oldVal: string, newVal: string): void {
      if (
        this.legalAttribute(attr, newVal) &&
        this[attr === ObservedAttrName.NAME ? 'appName' : 'appUrl'] !== newVal
      ) {
        if (
          attr === ObservedAttrName.URL && (
            !this.appUrl ||
            !this.connectStateMap.get(this.connectedCount)
          )
        ) {
          newVal = formatAppURL(newVal, this.appName)
          if (!newVal) {
            return logError(`Invalid attribute url ${newVal}`, this.appName)
          }
          this.appUrl = newVal
          this.handleInitialNameAndUrl()
        } else if (
          attr === ObservedAttrName.NAME && (
            !this.appName ||
            !this.connectStateMap.get(this.connectedCount)
          )
        ) {
          const formatNewName = formatAppName(newVal)

          if (!formatNewName) {
            return logError(`Invalid attribute name ${newVal}`, this.appName)
          }

          if (this.cacheData) {
            microApp.setData(formatNewName, this.cacheData)
            this.cacheData = null
          }

          this.appName = formatNewName
          if (formatNewName !== newVal) {
            this.setAttribute('name', this.appName)
          }
          this.handleInitialNameAndUrl()
        } else if (!this.isWaiting) {
          this.isWaiting = true
          defer(this.handleAttributeUpdate)
        }
      }
    }

    /** 当连接回调早于属性回调时，在 name/url 均就绪后补触发连接处理。 */
    private handleInitialNameAndUrl (): void {
      this.connectStateMap.get(this.connectedCount) && this.handleConnected()
    }

    /**
     * 首次连接时按同名实例状态决定显示、复用、替换或创建。
     *
     * 正在运行的同名实例不可替换；已隐藏且 URL 一致的 keep-alive 实例直接恢复；
     * 已卸载或兼容的预取实例可复用；其他非活跃实例由新实例替换。
     */
    private handleConnected (): void {
      if (!this.appName || !this.appUrl) return

      if (this.getDisposeResult('shadowDOM') && !this.shadowRoot && isFunction(this.attachShadow)) {
        this.attachShadow({ mode: 'open' })
      }

      this.updateSsrUrl(this.appUrl)
      if (appInstanceMap.has(this.appName)) {
        const oldApp = appInstanceMap.get(this.appName)!
        const oldAppUrl = oldApp.ssrUrl || oldApp.url
        const targetUrl = this.ssrUrl || this.appUrl
        /**
         * 判定约束：
         * 1. keep-alive 恢复只比较入口 URL，不比较随路由变化的 `ssrUrl`；
         * 2. 隐藏实例仍在后台运行，不能被同名新实例静默替换；
         * 3. 预取实例的样式隔离、沙箱或 iframe 配置与目标不同时必须重建。
         */
        if (
          oldApp.isHidden() &&
          oldApp.url === this.appUrl
        ) {
          this.handleShowKeepAliveApp(oldApp)
        } else if (
          oldAppUrl === targetUrl && (
            oldApp.isUnmounted() ||
            (
              oldApp.isPrefetch &&
              this.sameCoreOptions(oldApp)
            )
          )
        ) {
          this.handleMount(oldApp)
        } else if (oldApp.isPrefetch || oldApp.isUnmounted()) {
          if (__DEV__ && this.sameCoreOptions(oldApp)) {
            /**
             * URL 不同且旧实例已卸载或仅预取时，用新实例替换旧实例。
             */
            logWarn(`the ${oldApp.isPrefetch ? 'prefetch' : 'unmounted'} app with url ${oldAppUrl} replaced by a new app with url ${targetUrl}`, this.appName)
          }
          this.handleCreateApp()
        } else {
          logError(`app name conflict, an app named ${this.appName} with url ${oldAppUrl} is running`)
        }
      } else {
        this.handleCreateApp()
      }
    }

    /**
     * 在元素初始化后统一处理 name/url 的变更。
     *
     * 新名称若对应活跃实例则回滚属性；否则按“同名改 URL”“切换到 keep-alive 名称”
     * 或普通名称切换选择销毁、隐藏或卸载旧实例，再执行属性迁移。
     */
    private handleAttributeUpdate = (): void => {
      this.isWaiting = false
      const formatAttrName = formatAppName(this.getAttribute('name'))
      const formatAttrUrl = formatAppURL(this.getAttribute('url'), this.appName)
      if (this.legalAttribute('name', formatAttrName) && this.legalAttribute('url', formatAttrUrl)) {
        const oldApp = appInstanceMap.get(formatAttrName)
        /**
         * 名称发生变化且新名称已有实例时，必须先判断该实例是否仍在运行。
         */
        if (formatAttrName !== this.appName && oldApp) {
          if (!oldApp.isUnmounted() && !oldApp.isHidden() && !oldApp.isPrefetch) {
            this.setAttribute('name', this.appName)
            return logError(`app name conflict, an app named ${formatAttrName} is running`)
          }
        }

        if (formatAttrName !== this.appName || formatAttrUrl !== this.appUrl) {
          if (formatAttrName === this.appName) {
            this.unmount(true, () => {
              this.actionsForAttributeChange(formatAttrName, formatAttrUrl, oldApp)
            })
          } else if (this.getKeepAliveModeResult()) {
            this.handleHiddenKeepAliveApp()
            this.actionsForAttributeChange(formatAttrName, formatAttrUrl, oldApp)
          } else {
            this.unmount(false, () => {
              this.actionsForAttributeChange(formatAttrName, formatAttrUrl, oldApp)
            })
          }
        }
      } else if (formatAttrName !== this.appName) {
        this.setAttribute('name', this.appName)
      }
    }

    /**
     * 把已验证的新属性写入元素，并按目标名称对应的旧实例状态复用或重建。
     *
     * @param formatAttrName - 规范化后的新应用名。
     * @param formatAttrUrl - 规范化后的新入口 URL。
     * @param oldApp - 新名称当前关联的实例；可能不存在。
     */
    private actionsForAttributeChange (
      formatAttrName: string,
      formatAttrUrl: string,
      oldApp: AppInterface | void,
    ): void {
      /**
       * 此处不能因 `formatAttrUrl === this.appUrl` 提前返回：名称变化仍可能要求切换实例。
       */
      this.updateSsrUrl(formatAttrUrl)

      this.appName = formatAttrName
      this.appUrl = formatAttrUrl
      ;(this.shadowRoot ?? this).innerHTML = ''
      if (formatAttrName !== this.getAttribute('name')) {
        this.setAttribute('name', this.appName)
      }

      /**
       * `oldApp` 存在时，它的名称等于新的 `this.appName`。需要覆盖五类组合：
       * 1. 名称未变：当前实例已卸载，入口 URL 必然变化；
       * 2. 名称变化：目标实例只能是预取或已卸载；URL 相同则复用，否则替换；
       * 3. 入口 URL 不同但 SSR 实际页面相同；
       * 4. 入口 URL 相同但 SSR 实际页面不同，此时名称必然变化；
       * 5. 目标实例处于 keep-alive 隐藏态，此时名称必然变化。
       */
      if (oldApp) {
        if (oldApp.isHidden()) {
          if (oldApp.url === this.appUrl) {
            this.handleShowKeepAliveApp(oldApp)
          } else {
            // 隐藏的 keep-alive 实例仍属活跃实例，不能用不同 URL 覆盖。
            logError(`app name conflict, an app named ${this.appName} is running`)
          }
        /**
         * TODO:
         *  1. oldApp必是unmountApp或preFetchApp，这里还应该考虑沙箱、iframe、样式隔离不一致的情况
         *  2. unmountApp要不要判断样式隔离、沙箱、iframe，然后彻底删除并再次渲染？(包括handleConnected里的处理，先不改？)
         * 推荐：if (
         *  oldApp.url === this.appUrl &&
         *  oldApp.ssrUrl === this.ssrUrl && (
         *    oldApp.isUnmounted() ||
         *    (oldApp.isPrefetch && this.sameCoreOptions(oldApp))
         *  )
         * )
         */
        } else if (oldApp.url === this.appUrl && oldApp.ssrUrl === this.ssrUrl) {
          // 入口与 SSR 页面都一致，可直接复用预取或已卸载实例。
          this.handleMount(oldApp)
        } else {
          this.handleCreateApp()
        }
      } else {
        this.handleCreateApp()
      }
    }

    /**
     * 验证必需属性是否为非空字符串，并统一记录非法配置。
     *
     * @param name - 属性名，仅用于错误上下文。
     * @param val - 待验证的属性值。
     * @returns 值为非空字符串时为 `true`。
     */
    private legalAttribute (name: string, val: AttrType): boolean {
      if (!isString(val) || !val) {
        logError(`unexpected attribute ${name}, please check again`, this.appName)
        return false
      }

      return true
    }

    /**
     * 收集 `data-*` 属性并创建新 `CreateApp`，必要时先销毁同名旧实例。
     *
     * 预渲染实例必须走完整异步卸载，普通预取/已卸载实例可直接清缓存并替换。
     */
    private handleCreateApp (): void {
      const attrs: Record<string, string> = {}
      Array.prototype.slice.call(this.attributes).forEach(({ name, value }: Attr) => {
        if (name.startsWith('data-')) {
          attrs[name] = value
        }
      })

      /** 用元素当前配置创建并自动注册新应用实例。 */
      const createAppInstance = () => new CreateApp({
        name: this.appName,
        url: this.appUrl,
        container: this.shadowRoot ?? this,
        scopecss: this.useScopecss(),
        useSandbox: this.useSandbox(),
        inline: this.getDisposeResult('inline'),
        iframe: this.getDisposeResult('iframe'),
        ssrUrl: this.ssrUrl,
        routerMode: this.getMemoryRouterMode(),
        attrs
      })

      /**
       * 同名旧实例若存在，只可能是三类可替换状态：
       * 1. URL 不同的已卸载实例；
       * 2. 核心配置不同、尚未预渲染的预取实例；
       * 3. 核心配置不同的预渲染实例。
       */
      const oldApp = appInstanceMap.get(this.appName)
      if (oldApp) {
        if (oldApp.isPrerender) {
          this.unmount(true, createAppInstance)
        } else {
          oldApp.actionsForCompletelyDestroy()
          createAppInstance()
        }
      } else {
        createAppInstance()
      }
    }

    /**
     * 把可复用实例从预取态转入首次/再次挂载。
     *
     * 挂载前先写入 `BEFORE_MOUNT`，使通过 `microApp.router.push()` 提前导航时路由层
     * 能识别实例已进入挂载流程（对应上游 issue #908）。实际挂载推迟一轮，模拟首次连接。
     */
    private handleMount (app: AppInterface): void {
      app.isPrefetch = false
      /**
       * 提前写入状态，修复在 `app.mount()` 前调用 `microApp.router.push(...)` 的导航错误。
       * 证据：https://github.com/jd-opensource/micro-app/issues/908
       */
      app.setAppState(appStates.BEFORE_MOUNT)
      // 推迟执行，使复用实例与首次自定义元素连接采用相同异步时序。
      defer(() => this.mount(app))
    }

    /**
     * 将元素属性解析成运行配置，并交给 `CreateApp.mount()`。
     *
     * 此方法同时供元素连接流程和预取完成后的回调调用。
     */
    public mount (app: AppInterface): void {
      app.mount({
        container: this.shadowRoot ?? this,
        inline: this.getDisposeResult('inline'),
        routerMode: this.getMemoryRouterMode(),
        baseroute: this.getBaseRouteCompatible(),
        defaultPage: this.getDefaultPage(),
        disablePatchRequest: this.getDisposeResult('disable-patch-request'),
        fiber: this.getDisposeResult('fiber'),
      })
    }

    /**
     * 将元素侧卸载策略交给当前 `CreateApp`，并清除元素上的沙箱应用名标记。
     *
     * @param destroy - 是否删除实例与资源缓存；元素兼容属性也可强制开启。
     * @param unmountcb - 应用卸载及清理完成后的回调。
     */
    public unmount (destroy?: boolean, unmountcb?: CallableFunction): void {
      const app = appInstanceMap.get(this.appName)
      if (app && !app.isUnmounted()) {
        app.unmount({
          destroy: destroy || this.getDestroyCompatibleResult(),
          clearData: this.getDisposeResult('clear-data'),
          keepRouteState: this.getDisposeResult('keep-router-state'),
          unmountcb,
        })
      }
      delete this.__MICRO_APP_NAME__
    }

    /** DOM 断开且启用 keep-alive 时，把仍显示的实例切换到隐藏态。 */
    private handleHiddenKeepAliveApp (callback?: CallableFunction): void {
      const app = appInstanceMap.get(this.appName)
      if (app && !app.isUnmounted() && !app.isHidden()) {
        app.hiddenKeepAliveApp(callback)
      }
    }

    /** DOM 重新连接时异步恢复隐藏实例，避免与当前连接回调堆栈交叠。 */
    private handleShowKeepAliveApp (app: AppInterface): void {
      // 必须异步：当前元素尚处于浏览器的连接生命周期回调中。
      defer(() => app.showKeepAliveApp(this.shadowRoot ?? this))
    }

    /**
     * 合并元素属性与全局默认值，并识别显式字符串 `false`。
     *
     * 元素属性优先级高于全局配置；兼容字段由两个辅助方法统一解析。
     *
     * @param name - 配置项的规范属性名。
     * @returns 配置最终是否开启。
     */
    private getDisposeResult <T extends keyof OptionsType> (name: T): boolean {
      return (this.compatibleProperties(name) || !!microApp.options[name]) && this.compatibleDisableProperties(name)
    }

    /** 判断配置属性是否存在，并兼容 `disableScopecss`/`disableSandbox` 旧写法。 */
    private compatibleProperties (name: string): boolean {
      if (name === 'disable-scopecss') {
        return this.hasAttribute('disable-scopecss') || this.hasAttribute('disableScopecss')
      } else if (name === 'disable-sandbox') {
        return this.hasAttribute('disable-sandbox') || this.hasAttribute('disableSandbox')
      }
      return this.hasAttribute(name)
    }

    /**
     * 判断配置属性是否未被显式设为字符串 `false`，并兼容两个旧驼峰写法。
     *
     * HTML 布尔属性的空字符串仍表示开启，只有精确值 `false` 表示关闭。
     */
    private compatibleDisableProperties (name: string): boolean {
      if (name === 'disable-scopecss') {
        return this.getAttribute('disable-scopecss') !== 'false' && this.getAttribute('disableScopecss') !== 'false'
      } else if (name === 'disable-sandbox') {
        return this.getAttribute('disable-sandbox') !== 'false' && this.getAttribute('disableSandbox') !== 'false'
      }
      return this.getAttribute(name) !== 'false'
    }

    /** 仅在未禁用且未使用原生 Shadow DOM 时开启 CSS 选择器改写。 */
    private useScopecss (): boolean {
      return !(this.getDisposeResult('disable-scopecss') || this.getDisposeResult('shadowDOM'))
    }

    /** 返回当前元素是否启用 JavaScript 沙箱。 */
    private useSandbox (): boolean {
      return !this.getDisposeResult('disable-sandbox')
    }

    /**
     * 比较预取实例与元素最终使用的样式隔离、沙箱及 iframe 三项核心配置。
     *
     * 只有这些执行环境配置一致时，预取实例才能安全复用。
     */
    private sameCoreOptions (app: AppInterface): boolean {
      return (
        app.scopecss === this.useScopecss() &&
        app.useSandbox === this.useSandbox() &&
        app.iframe === this.getDisposeResult('iframe')
      )
    }

    /**
     * 获取路由前缀，并兼容 0.3.1 之前使用的 `baseurl` 属性。
     */
    private getBaseRouteCompatible (): string {
      return this.getAttribute('baseroute') ?? this.getAttribute('baseurl') ?? ''
    }

    /** 读取销毁开关，并兼容历史拼写错误 `destory`。 */
    private getDestroyCompatibleResult (): boolean {
      return this.getDisposeResult('destroy') || this.getDisposeResult('destory')
    }

    /**
     * 判断元素是否进入 keep-alive 模式；显式销毁配置始终优先。
     */
    private getKeepAliveModeResult (): boolean {
      return this.getDisposeResult('keep-alive') && !this.getDestroyCompatibleResult()
    }

    /**
     * 根据 SSR 与路由配置计算实际 HTML 请求地址，并在退出 SSR 时清空旧值。
     *
     * 关闭内存路由时使用基座当前路径；否则优先读取浏览器 URL 中保存的子应用路径，
     * 缺失时再回退到默认页面。
     */
    private updateSsrUrl (baseUrl: string): void {
      if (this.getDisposeResult('ssr')) {
        // TODO: disable-memory-router不存在了，这里需要更新一下
        if (this.getDisposeResult('disable-memory-router') || this.getDisposeResult('disableSandbox')) {
          const rawLocation = globalEnv.rawWindow.location
          this.ssrUrl = CompletionPath(rawLocation.pathname + rawLocation.search, baseUrl)
        } else {
          // 从浏览器 URL 恢复该子应用的虚拟路由路径。
          // TODO: 新版本路由系统要重新兼容ssr
          let targetPath = getNoHashMicroPathFromURL(this.appName, baseUrl)
          const defaultPagePath = this.getDefaultPage()
          if (!targetPath && defaultPagePath) {
            const targetLocation = createURL(defaultPagePath, baseUrl)
            targetPath = targetLocation.origin + targetLocation.pathname + targetLocation.search
          }
          this.ssrUrl = targetPath
        }
      } else if (this.ssrUrl) {
        this.ssrUrl = ''
      }
    }

    /**
     * 获取默认页面，优先使用路由 API 的运行时设置，再读取元素新旧属性写法。
     */
    private getDefaultPage (): string {
      return (
        router.getDefaultPage(this.appName) ||
        this.getAttribute('default-page') ||
        this.getAttribute('defaultPage') ||
        ''
      )
    }

    /**
     * 解析路由模式，并把历史 `disable-memory-router` 配置交给兼容层。
     *
     * @returns 规范化后的路由模式。
     */
    private getMemoryRouterMode () : string {
      return initRouterMode(
        this.getAttribute('router-mode'),
        // 同时区分 `<micro-app disable-memory-router>` 与显式的 `'false'`。
        this.compatibleProperties('disable-memory-router') && this.compatibleDisableProperties('disable-memory-router'),
      )
    }

    /**
     * 扩展元素 `setAttribute`：对象型 `data` 走数据中心，其余属性仍调用原生实现。
     *
     * 数据仅复制自有普通键，并过滤 `__` 前缀内部字段，避免把框架标记传给子应用。
     *
     * @param key - 属性名。
     * @param value - 属性值；`data` 分支要求普通对象。
     */
    public setAttribute (key: string, value: any): void {
      if (key === 'data') {
        if (isPlainObject(value)) {
          const cloneValue: Record<NormalKey, unknown> = {}
          Object.getOwnPropertyNames(value).forEach((ownKey: NormalKey) => {
            if (!(isString(ownKey) && ownKey.indexOf('__') === 0)) {
              cloneValue[ownKey] = value[ownKey]
            }
          })
          this.data = cloneValue
        } else if (value !== '[object Object]') {
          logWarn('property data must be an object', this.appName)
        }
      } else {
        globalEnv.rawSetAttribute.call(this, key, value)
      }
    }

    /**
     * 获取当前应用路由事件的延迟毫秒数。
     *
     * 元素属性优先；其次读取全局固定值或按应用名计算的函数；非法值统一回退为 0。
     *
     * @returns 非负约束由调用方负责，本方法仅保证返回可解析数字或 0。
     */
    public getRouterEventDelay (): number {
      let delay = parseInt(this.getAttribute('router-event-delay') as string)
      if (isNaN(delay)) {
        delay = parseInt((isFunction(microApp.options['router-event-delay']) ? microApp.options['router-event-delay'](this.appName) : microApp.options['router-event-delay']) as unknown as string)
      }
      return !isNaN(delay) ? delay : 0
    }

    /**
     * 写入基座下发的数据；应用名未就绪时先缓存，名称确定后再发送。
     */
    set data (value: Record<PropertyKey, unknown> | null) {
      if (this.appName) {
        microApp.setData(this.appName, value as Record<PropertyKey, unknown>)
      } else {
        this.cacheData = value
      }
    }

    /**
     * 读取基座侧数据快照，主要供 JSX 自定义事件适配器比较 `data` 引用。
     */
    get data (): Record<PropertyKey, unknown> | null {
      if (this.appName) {
        return microApp.getData(this.appName, true)
      } else if (this.cacheData) {
        return this.cacheData
      }
      return null
    }

    /** 更新应用名时同步迁移数据中心事件通道，避免名称变化后遗留旧订阅。 */
    set appName(value: string) {
      if (value !== this._appName) {
        microApp.changeEventAppName(value, this._appName)
        this._appName = value
      }
    }

    /** 返回当前规范化应用名。 */
    get appName(): string {
      return this._appName
    }

    /**
     * 从有效入口地址计算公共资源基址，供 micro-app-devtools 等外部工具读取。
     */
    get publicPath (): string {
      return getEffectivePath(this.appUrl)
    }

    /**
     * 返回兼容解析后的路由前缀，供 micro-app-devtools 等外部工具读取。
     */
    get baseRoute (): string {
      return this.getBaseRouteCompatible()
    }
  }

  window.customElements.define(tagName, MicroAppElement)
}
