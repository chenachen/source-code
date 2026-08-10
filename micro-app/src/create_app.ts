import type {
  Func,
  AppInterface,
  sourceType,
  WithSandBoxInterface,
  MountParam,
  UnmountParam,
  OnLoadParam,
} from '@micro-app/types'
import { HTMLLoader } from './source/loader/html'
import { extractSourceDom } from './source/index'
import { execScripts } from './source/scripts'
import WithSandBox from './sandbox/with'
import IframeSandbox from './sandbox/iframe'
import { router, isRouterModeSearch } from './sandbox/router'
import {
  appStates,
  lifeCycles,
  keepAliveStates,
  microGlobalEvent,
  DEFAULT_ROUTER_MODE,
} from './constants'
import {
  isFunction,
  isPromise,
  logError,
  getRootContainer,
  execMicroAppGlobalHook,
  pureCreateElement,
  isDivElement,
  removeDomScope,
} from './libs/utils'
import dispatchLifecyclesEvent, {
  dispatchCustomEventToMicroApp,
} from './interact/lifecycles_event'
import globalEnv from './libs/global_env'
import microApp from './micro_app'
import sourceCenter from './source/source_center'

/**
 * 进程内应用实例注册表；名称是规范化后的唯一键。
 *
 * 预取、预渲染、已挂载、隐藏和未彻底销毁的已卸载实例都保留在此，供元素复用与公开 API 查询。
 */
export const appInstanceMap = new Map<string, AppInterface>()

/** 创建应用运行实例所需的执行环境与初始加载配置。 */
export interface CreateAppParam {
  /** 规范化后的唯一应用名，也是数据中心与路由隔离键。 */
  name: string
  /** 子应用 HTML 入口基址。 */
  url: string
  /** 是否改写 CSS 选择器，使样式限定在当前应用容器。 */
  scopecss: boolean
  /** 是否创建 JavaScript 沙箱。 */
  useSandbox: boolean
  /** 是否把脚本以内联 DOM 节点方式执行；iframe 沙箱会强制开启。 */
  inline?: boolean
  /** 是否使用 iframe 沙箱，否则使用 with 沙箱。 */
  iframe?: boolean
  /** 当前渲染容器；纯预取实例创建时可以缺省。 */
  container?: HTMLElement | ShadowRoot
  /** SSR 模式实际加载的 HTML 页面地址。 */
  ssrUrl?: string
  /** 是否由预取流程创建。 */
  isPrefetch?: boolean
  /** 预取等级；等级 3 会立即在临时容器中预渲染。 */
  prefetchLevel?: number
  /** 从宿主元素透传给 iframe 的 `data-*` 属性。 */
  attrs?: Record<string, string>,
  /** 预渲染阶段预先确定的路由模式。 */
  routerMode?: string
}

/**
 * 一个子应用的运行时状态机，协调资源加载、沙箱、脚本执行、挂载、隐藏与销毁。
 *
 * 实例一经构造便写入 `appInstanceMap`、启动资源加载并创建所需沙箱。容器 DOM 由实例
 * 在普通模式和 keep-alive/预渲染临时容器之间转移，沙箱负责全局副作用快照与恢复。
 */
export default class CreateApp implements AppInterface {
  /** 当前主生命周期状态，初始为 `CREATED`。 */
  private state: string = appStates.CREATED
  /** 独立于主生命周期的 keep-alive 显示/隐藏状态。 */
  private keepAliveState: string | null = null
  /** HTML 与静态资源两路加载进度；2 表示全部就绪，-1 表示 HTML 加载失败。 */
  private loadSourceLevel: -1|0|1|2 = 0
  /** UMD 子应用提供的挂载钩子；脚本首次执行后识别并缓存。 */
  private umdHookMount: Func | null = null
  /** UMD 子应用提供的卸载钩子；与挂载钩子同时存在时才进入 UMD 模式。 */
  private umdHookUnmount: Func | null = null
  /** 预渲染期间延迟到真实容器挂载后再派发的生命周期动作。 */
  private preRenderEvents?: CallableFunction[] | null
  /** 标记脚本是否已暴露成对 UMD 生命周期钩子，可在重挂载时跳过重复执行源码。 */
  public umdMode = false
  /** 当前实例解析出的 HTML、样式和脚本引用集合。 */
  public source: sourceType
  /** 当前 JavaScript 沙箱；禁用沙箱或 iframe 默认模式卸载后可为空。 */
  public sandBox: WithSandBoxInterface | IframeSandbox | null = null
  /** 应用唯一名称。 */
  public name: string
  /** HTML 入口基址。 */
  public url: string
  /** 当前承载应用 DOM 的真实或临时容器。 */
  public container: HTMLElement | ShadowRoot | null
  /** 是否启用 CSS 作用域改写；关闭沙箱时会强制关闭。 */
  public scopecss: boolean
  /** 是否启用 JavaScript 沙箱。 */
  public useSandbox: boolean
  /** 当前脚本是否以内联节点模式执行。 */
  public inline: boolean
  /** 是否使用 iframe 沙箱。 */
  public iframe: boolean
  /** SSR 模式实际请求地址，非 SSR 模式为空。 */
  public ssrUrl: string
  /** 是否仍是仅由预取流程持有的实例。 */
  public isPrefetch: boolean
  /** 是否正在临时容器内预渲染。 */
  public isPrerender: boolean
  /** 原始预取等级，供加载策略判断。 */
  public prefetchLevel?: number
  /** 是否把脚本执行拆成空闲任务；预渲染会强制开启。 */
  public fiber = false
  /** 当前实例采用的路由隔离模式。 */
  public routerMode: string
  /** 传给 iframe 元素的宿主 `data-*` 属性。 */
  public attrs?: Record<string, string>
  /** 标记当前卸载是否属于 reload，使数据清理逻辑可保留快照。 */
  public isReloading = false

  /**
   * 注册实例、归一化执行环境，随后立即启动资源加载并按需创建沙箱。
   *
   * @param param - 应用身份、隔离方式、容器及预取配置。
   */
  constructor ({
    name,
    url,
    container,
    scopecss,
    useSandbox,
    inline,
    iframe,
    ssrUrl,
    isPrefetch,
    prefetchLevel,
    routerMode,
    attrs,
  }: CreateAppParam) {
    appInstanceMap.set(name, this)
    // 先写入稳定身份和隔离配置，资源加载回调可能异步读取这些字段。
    this.name = name
    this.url = url
    this.useSandbox = useSandbox
    this.scopecss = this.useSandbox && scopecss
    this.attrs = attrs
    // iframe 标记必须先设置，因为它会强制 `getInlineModeState()` 返回 true。
    this.iframe = iframe ?? false
    this.inline = this.getInlineModeState(inline)
    this.isReloading = false
    /**
     * 实例创建后、正式挂载前也允许路由 API 导航，因此构造阶段就必须确定路由模式。
     */
    this.routerMode = routerMode || DEFAULT_ROUTER_MODE

    // 纯预取实例没有真实宿主容器，SSR 地址也可能尚未确定。
    this.container = container ?? null
    this.ssrUrl = ssrUrl ?? ''

    // 预取专属状态；等级 3 会在资源就绪后进入预渲染。
    this.isPrefetch = isPrefetch ?? false
    this.isPrerender = prefetchLevel === 3
    this.prefetchLevel = prefetchLevel

    this.source = { html: null, links: new Set(), scripts: new Set() }
    this.loadSourceCode()
    this.createSandbox()
  }

  /** 将状态切到 `LOADING`，并通过单例 HTMLLoader 启动 HTML 与静态资源提取。 */
  public loadSourceCode (): void {
    this.setAppState(appStates.LOADING)
    HTMLLoader.getInstance().run(this, extractSourceDom)
  }

    /**
   * 汇合 HTML 与静态资源两路完成信号，并按普通、纯预取或预渲染模式继续。
   *
   * `loadSourceLevel` 到 2 才写入 HTML。普通实例通知宿主元素挂载；三级预取实例在
   * 临时 `<div prerender>` 中挂载并冻结对浏览器可见的路由/生命周期副作用。
   * `defaultPage`、`disablePatchRequest`、`routerMode`、`baseroute` 仅供预渲染使用。
   */
  public onLoad ({
    html,
    // 下列参数只在预渲染分支消费。
    defaultPage,
    routerMode,
    baseroute,
    disablePatchRequest,
  }: OnLoadParam): void {
    if (++this.loadSourceLevel === 2) {
      this.source.html = html
      if (this.isUnmounted()) return
      if (!this.isPrefetch) {
        getRootContainer(this.container!).mount(this)
      } else if (this.isPrerender) {
        /**
         * 预渲染是三级预取的执行阶段：强制 fiber，且只支持虚拟路由。
         * 为保持对用户不可见，子应用 `pushState/replaceState` 只更新 microLocation，
         * 不把路由附加到浏览器 URL；不向浏览器派发 popstate/hashchange，不执行会重载
         * window 的 location 导航，也不派发生命周期事件。
         *
         * 卸载可能发生在资源加载中、脚本分片执行中或脚本完成后，后续流程都必须检查状态。
         */
        const container = pureCreateElement('div')
        container.setAttribute('prerender', 'true')
        this.sandBox?.setPreRenderState(true)
        this.mount({
          container,
          inline: this.inline,
          fiber: true,
          defaultPage: defaultPage || '',
          disablePatchRequest: disablePatchRequest ?? false,
          routerMode: routerMode!,
          baseroute: baseroute || '',
        })
      }
    }
  }

  /**
   * 把 HTML 加载失败转成错误生命周期和 `LOAD_FAILED` 状态。
   *
   * 若实例已在加载期间卸载，则只记录失败标记，不再向失效容器派发事件。
   *
   * @param e - 资源加载错误。
   */
  public onLoadError (e: Error): void {
    this.loadSourceLevel = -1

    if (!this.isUnmounted()) {
      this.onerror(e)
      this.setAppState(appStates.LOAD_FAILED)
    }
  }

  /**
   * 将已加载实例挂载到目标容器，或在资源未完成时先保存挂载意图。
   *
   * 正常路径依次进入 `BEFORE_MOUNT`/`MOUNTING`、转移 HTML、启动沙箱、执行脚本，
   * 再由 UMD 钩子或脚本完成回调进入 `MOUNTED`。iframe 沙箱就绪是异步边界；其间
   * 若实例已卸载，`nextAction` 不再执行。
   *
   * @param container - 真实宿主或预渲染临时容器。
   * @param inline - 是否使用内联脚本节点执行。
   * @param routerMode - 虚拟路由模式。
   * @param defaultPage - 虚拟路由缺少状态时的默认页面。
   * @param baseroute - 子应用路由前缀，默认空字符串。
   * @param disablePatchRequest - 是否禁止沙箱改写子应用请求地址。
   * @param fiber - 是否把脚本执行拆分为空闲任务。
   */
  public mount ({
    container,
    inline,
    routerMode,
    defaultPage,
    baseroute,
    disablePatchRequest,
    fiber,
  }: MountParam): void {
    if (this.loadSourceLevel !== 2) {
      /**
       * 资源完成回调需要非空容器，因此加载结束前发生的预取转渲染或卸载后重挂载，
       * 都先保存最新容器。预渲染标志同时取消，避免旧预取意图覆盖真实挂载。
       */
      this.container = container
      // 真实挂载已先于预渲染开始，取消预渲染身份。
      this.isPrerender = false

      // 元素侧收到加载状态，但完整资源就绪前不启动沙箱与脚本。
      // TODO: statechange 还是 state-change，保持一致
      dispatchCustomEventToMicroApp(this, 'statechange', {
        appState: appStates.LOADING
      })

      // 保持状态机与仍在进行的加载任务一致。
      return this.setAppState(appStates.LOADING)
    }

    this.createSandbox()

    /** 沙箱就绪后执行真实 DOM、路由和脚本挂载。 */
    const nextAction = () => {
      // 放在 ready 后写状态，确保 iframe 内的静态状态同步目标已经可用。
      this.setAppState(appStates.BEFORE_MOUNT)
      /**
       * 预渲染转真实挂载可能发生在预渲染开始前、脚本执行中、脚本完成后或预渲染已卸载后。
       * 只有当前容器仍是带 `prerender` 标记的临时 div，才走快照恢复分支。
       * TODO：补充 Shadow DOM 场景测试。
       */
      if (
        this.isPrerender &&
        isDivElement(this.container) &&
        this.container.hasAttribute('prerender')
      ) {
        /**
         * 当前 `this.container` 是 `<div prerender='true'>`，这里把其 DOM 转移到真实
         * `<micro-app>`。容器引用必须先更新，再恢复沙箱副作用和补派发预渲染事件，
         * 否则回调仍会绑定临时容器。
         */
        this.container = this.cloneContainer(container, this.container, false)
        /**
         * 恢复 window、document 和数据中心副作用：脚本未开始时无操作；fiber 执行中恢复
         * 已记录部分；脚本完成后恢复完整快照。
         */
        this.sandBox?.rebuildEffectSnapshot()
        this.preRenderEvents?.forEach((cb) => cb())
        // 此后生命周期与路由副作用对真实宿主可见。
        this.isPrerender = false
        this.preRenderEvents = null
        // 预渲染期间冻结的路由信息现在才附加到浏览器 URL。
        router.attachToURL(this.name)
        this.sandBox?.setPreRenderState(false)
      } else {
        this.container = container
        this.inline = this.getInlineModeState(inline)
        this.fiber = fiber
        this.routerMode = routerMode

        /** 向基座派发 beforemount；预渲染时先缓存到真实挂载阶段。 */
        const dispatchBeforeMount = () => {
          dispatchLifecyclesEvent(
            this.container,
            this.name,
            lifeCycles.BEFOREMOUNT,
          )
        }

        if (this.isPrerender) {
          (this.preRenderEvents ??= []).push(dispatchBeforeMount)
        } else {
          dispatchBeforeMount()
        }

        this.setAppState(appStates.MOUNTING)

        // 同步子应用可见的状态事件。
        dispatchCustomEventToMicroApp(this, 'statechange', {
          appState: appStates.MOUNTING
        })

        // TODO：验证并补齐 ShadowRoot 容器兼容。
        this.cloneContainer(this.container, this.source.html, !this.umdMode)

        this.sandBox?.start({
          umdMode: this.umdMode,
          baseroute,
          defaultPage,
          disablePatchRequest,
        })

        if (!this.umdMode) {
          // 脚本执行前补丁会在结束时返回可能由子应用注册的 UMD 钩子。
          this.sandBox?.actionsBeforeExecScripts(this.container, (mount, unmount) => {
            if (!this.umdMode && !this.isUnmounted()) {
              this.umdHookMount = isFunction(mount) ? mount : null
              // 即使最初按默认模式执行，子应用也可能通过 window.unmount 注册卸载钩子。
              this.umdHookUnmount = isFunction(unmount) ? unmount : null
              // 只有 mount/unmount 成对存在才切换 UMD 模式，避免半套生命周期不可恢复。
              if (isFunction(this.umdHookMount) && isFunction(this.umdHookUnmount)) {
                this.sandBox?.markUmdMode(this.umdMode = true)
                try {
                  // 脚本完成回调可能已先标记 MOUNTED；此时只补执行刚识别出的 UMD mount。
                  if (this.getAppState() === appStates.MOUNTED) {
                    this.umdHookMount(microApp.getData(this.name, true))
                  } else {
                    this.handleMounted(this.umdHookMount(microApp.getData(this.name, true)))
                  }
                } catch (e) {
                  logError('An error occurred when mount \n', this.name, e)
                }
              }
            }
          })

          // 仅最后一个脚本完成且仍非 UMD 模式时结束普通挂载。
          execScripts(this, (isFinished: boolean) => {
            if (!this.umdMode && isFinished === true) {
              this.handleMounted()
            }
          })
        } else {
          this.sandBox?.rebuildEffectSnapshot()
          try {
            this.handleMounted(this.umdHookMount!(microApp.getData(this.name, true)))
          } catch (e) {
            logError('An error occurred when mount \n', this.name, e)
          }
        }
      }
    }

    /**
     * 沙箱初始化是异步过程，iframe 沙箱尤其跨宏任务。快速切换子应用时，实例可能在
     * `nextAction` 前卸载（容器已为空）、随后再次挂载，或在脚本执行中卸载。因此 ready
     * Promise 完成后必须再次检查主状态，不能无条件启动沙箱。
     */
    // 无沙箱路径同步执行；沙箱路径统一等待 ready，保持 iframe/with 对外时序一致。
    this.sandBox ? this.sandBox.sandboxReady.then(() => !this.isUnmounted() && nextAction()) : nextAction()
  }

  /**
   * 统一处理同步或异步 UMD mount 结果，并在失败后仍推进挂载收尾。
   *
   * 预渲染时不立即派发生命周期，而是记录动作并释放副作用；真实挂载恢复快照后再执行。
   *
   * @param umdHookMountResult - 子应用 UMD mount 钩子的返回值。
   */
  private handleMounted (umdHookMountResult?: unknown): void {
    /** 等待 UMD Promise 后进入统一挂载收尾；拒绝只记录错误，不让状态永久停在 MOUNTING。 */
    const dispatchAction = () => {
      /** 完成状态写入与两侧生命周期派发。 */
      const nextAction = () => this.actionsAfterMounted()
      if (isPromise(umdHookMountResult)) {
        umdHookMountResult
          .then(nextAction)
          .catch((e) => {
            logError('An error occurred in window.mount \n', this.name, e)
            nextAction()
          })
      } else {
        nextAction()
      }
    }

    if (this.isPrerender) {
      this.preRenderEvents?.push(dispatchAction)
      this.sandBox?.recordAndReleaseEffect({ isPrerender: true })
    } else {
      dispatchAction()
    }
  }

  /**
   * 在脚本及可选 UMD mount 完成后写入 `MOUNTED`，再通知子应用与基座。
   *
   * 若应用已在异步期间卸载则不再派发。隐藏中的 keep-alive 应用仍需完成首次渲染，
   * 随后立即记录并释放全局副作用，使其保持“后台已运行”状态。
   */
  private actionsAfterMounted (): void {
    if (!this.isUnmounted()) {
      this.setAppState(appStates.MOUNTED)
      // 子应用全局钩子先执行，使后续 mounted 监听器观察到已初始化的应用状态。
      execMicroAppGlobalHook(
        this.getMicroAppGlobalHook(microGlobalEvent.ONMOUNT),
        this.name,
        microGlobalEvent.ONMOUNT,
        microApp.getData(this.name, true)
      )

      // 先同步状态，再派发简化的 mounted 事件。
      dispatchCustomEventToMicroApp(this, 'statechange', {
        appState: appStates.MOUNTED
      })

      dispatchCustomEventToMicroApp(this, 'mounted')

      // 最后通知基座宿主元素。
      dispatchLifecyclesEvent(
        this.container,
        this.name,
        lifeCycles.MOUNTED,
      )

      /**
       * 资源加载期间被隐藏的 keep-alive 应用仍要完成渲染，以维持后台运行语义；挂载完成后
       * 立即记录并释放全部全局事件和定时副作用。
       */
      if (this.isHidden()) {
        this.sandBox?.recordAndReleaseEffect({ keepAlive: true })
      }
    }
    /**
     * TODO: 这里增加一个处理，如果渲染完成时已经卸载，则进行一些操作
     * 如果是默认模式：删除所有事件和定时器
     * 如果是umd模式：重新记录和清空事件
     * 补充：非必需，优先级低
     */
  }

  /**
   * 进入 `UNMOUNT` 并执行子应用 UMD 卸载钩子，随后清理沙箱、DOM 和可选缓存。
   *
   * 加载失败会强制销毁。iframe 沙箱可能尚未 ready，因此容器可能已被提前清空；
   * 资源仍在加载时容器也可能存在。参数结构需保持与公开 `unmountApp` 调用链一致。
   *
   * @param destroy - 是否彻底销毁并删除实例/内联脚本缓存。
   * @param clearData - 是否清除两侧数据中心数据。
   * @param keepRouteState - 卸载时是否保留内部路由状态，默认不保留。
   * @param unmountcb - 完成清理后的回调。
   */
  public unmount ({
    destroy,
    clearData,
    keepRouteState,
    unmountcb,
  }: UnmountParam): void {
    destroy = destroy || this.state === appStates.LOAD_FAILED

    this.setAppState(appStates.UNMOUNT)

    try {
      this.handleUnmounted(
        destroy,
        clearData,
        keepRouteState,
        unmountcb,
        this.umdHookUnmount?.(microApp.getData(this.name, true)),
      )
    } catch (e) {
      logError('An error occurred when unmount \n', this.name, e)
    }
  }

  /**
   * 等待异步 UMD unmount，并保证拒绝后仍进入统一清理。
   *
   * 异步等待前清除当前 DOM 作用域，防止嵌套应用把后续异步操作错误绑定到旧应用名。
   *
   * @param destroy - 是否彻底销毁。
   * @param clearData - 是否清除数据中心数据。
   * @param keepRouteState - 是否保留内部路由状态。
   * @param unmountcb - 清理完成后的回调。
   * @param umdHookUnmountResult - 子应用 UMD unmount 钩子的返回值。
   */
  private handleUnmounted (
    destroy: boolean,
    clearData: boolean,
    keepRouteState: boolean,
    unmountcb?: CallableFunction,
    umdHookUnmountResult?: unknown,
  ): void {
    // 先通知子应用状态改变和卸载，再释放其监听与沙箱环境。
    dispatchCustomEventToMicroApp(this, 'statechange', {
      appState: appStates.UNMOUNT
    })

    dispatchCustomEventToMicroApp(this, 'unmount')

    // 全局 onunmount 在沙箱停止前执行，仍可访问子应用运行环境。
    execMicroAppGlobalHook(
      this.getMicroAppGlobalHook(microGlobalEvent.ONUNMOUNT),
      this.name,
      microGlobalEvent.ONUNMOUNT,
    )

    /** 汇合同步/异步 UMD 钩子，进入唯一清理出口。 */
    const nextAction = () => this.actionsAfterUnmounted({
      destroy,
      clearData,
      keepRouteState,
      unmountcb,
    })

    if (isPromise(umdHookUnmountResult)) {
      // 清除 DOM 作用域，避免异步 window.unmount 期间嵌套应用继承错误 appName。
      removeDomScope()
      umdHookUnmountResult
        .then(nextAction)
        .catch((e) => {
          logError('An error occurred in window.unmount \n', this.name, e)
          nextAction()
        })
    } else {
      nextAction()
    }
  }

  /**
   * 执行卸载后的唯一清理出口：保存可复用 DOM、停止沙箱、派发生命周期并清字段。
   *
   * UMD 非销毁卸载会把当前 DOM 克隆回源码模板以便重挂载；reload 始终保留数据，
   * 其余场景由 `clearData || destroy` 决定数据清理。
   *
   * @param destroy - 是否彻底销毁。
   * @param clearData - 是否清除数据中心数据。
   * @param keepRouteState - 是否保留内部路由状态。
   * @param unmountcb - 所有同步清理完成后的回调。
   */
  private actionsAfterUnmounted ({
    destroy,
    clearData,
    keepRouteState,
    unmountcb,
  }: UnmountParam): void {
    if (this.umdMode && this.container && !destroy) {
      this.cloneContainer(this.source.html, this.container as HTMLElement, false)
    }
    const shouldClearData = this.isReloading ? false : (clearData || destroy)
    /**
     * 容器中可能包含仍需保存的微应用 DOM，因此必须先克隆再停止沙箱。销毁始终清路由；
     * UMD 非销毁和 keep-alive 模式不会清 EventSource，以支持恢复。
     */
    this.sandBox?.stop({
      umdMode: this.umdMode,
      keepRouteState: keepRouteState && !destroy,
      destroy,
      clearData: shouldClearData,
    })

    // 沙箱副作用已释放后再通知基座，监听器观察到的是稳定卸载状态。
    dispatchLifecyclesEvent(
      this.container,
      this.name,
      lifeCycles.UNMOUNT,
    )

    this.clearOptions(destroy)

    unmountcb?.()
  }

  /**
   * 清空预渲染、keep-alive 和容器引用，并处理未启动 iframe 沙箱的竞态清理。
   *
   * 默认 iframe 模式卸载后删除沙箱以保证 module script 下次可重新执行；彻底销毁时
   * 继续删除实例与内联脚本缓存。最后清除全局 DOM 作用域。
   *
   * @param destroy - 是否继续执行彻底销毁。
   */
  private clearOptions (destroy: boolean): void {
    this.isPrerender = false
    this.preRenderEvents = null
    this.setKeepAliveState(null)
    if (this.container) {
      this.container.innerHTML = ''
      this.container = null
    } else if (!this.umdMode) {
      /**
       * 容器为空说明 `sandBox.start` 尚未执行，因而 `sandBox.stop` 也不会运行；
       * 默认模式必须在这里手动删除已创建的 iframe 元素。
       */
      this.sandBox?.deleteIframeElement?.()
    }
    // iframe 默认模式每次卸载都丢弃 realm，避免 module script 节点无法二次执行。
    /**
     * TODO:
     *  1. with沙箱与iframe沙箱保持一致：with沙箱默认模式下删除 或者 iframe沙箱umd模式下保留
     *  2. 接1.0，this.sandBox置空，还需要注意后续app.sandBox相关操作，比如 scripts.ts --> app.iframe ? app.sandBox!.microBody : app.querySelector('micro-app-body')，如果是fiber或者预加载，会存在卸载后js还在处理的情况
     */
    if (this.iframe && !this.umdMode) this.sandBox = null
    if (destroy) this.actionsForCompletelyDestroy()
    removeDomScope()
  }

  /** 删除 iframe、当前应用的内联脚本缓存及实例注册，完成不可复用销毁。 */
  public actionsForCompletelyDestroy (): void {
    this.sandBox?.deleteIframeElement?.()
    sourceCenter.script.deleteInlineInfo(this.source.scripts)
    appInstanceMap.delete(this.name)
  }

  /**
   * 把 keep-alive 应用切换为隐藏态，转移 DOM 并暂停可恢复的全局副作用。
   *
   * `afterhidden` 必须在容器转成临时 div、数据监听被释放前派发。资源尚未完成时无法
   * 保留完整后台实例，会退化为普通卸载；已完成时把 DOM 移入临时容器并保存副作用快照。
   *
   * @param callback - 隐藏或退化卸载完成后的回调。
   */
  public hiddenKeepAliveApp (callback?: CallableFunction): void {
    this.setKeepAliveState(keepAliveStates.KEEP_ALIVE_HIDDEN)
    /**
     * afterhidden事件需要提前发送，原因如下：
     *  1. 此时发送this.container还指向micro-app元素，而不是临时div元素
     *  2. 沙箱执行recordAndReleaseEffect后会将appstate-change方法也清空，之后再发送子应用也接受不到了
     *  3. 对于this.loadSourceLevel !== 2的情况，unmount是同步执行的，所以也会出现2的问题
     * TODO: 有可能导致的问题
     *  1. 在基座接受到afterhidden方法后立即执行unmount，彻底destroy应用时，因为unmount时同步执行，所以this.container为null后才执行cloneContainer
     */
    dispatchCustomEventToMicroApp(this, 'appstate-change', {
      appState: 'afterhidden',
    })

    // 此时 `this.container` 仍指向真实宿主，基座可从正确元素收到事件。
    dispatchLifecyclesEvent(
      this.container,
      this.name,
      lifeCycles.AFTERHIDDEN,
    )

    if (isRouterModeSearch(this.name)) {
      // 事件先观察旧路由，再从宿主 URL 移除隐藏应用信息。
      this.sandBox?.removeRouteInfoForKeepAliveApp()
    }

    /**
     * 资源完成前隐藏无法建立完整快照，必须卸载；否则转移 DOM 并暂停副作用。
     */
    if (this.loadSourceLevel !== 2) {
      getRootContainer(this.container!).unmount()
    } else {
      this.container = this.cloneContainer(
        pureCreateElement('div'),
        this.container,
        false,
      )

      this.sandBox?.recordAndReleaseEffect({ keepAlive: true })
    }

    callback?.()
  }

  /**
   * 把隐藏的 keep-alive 应用恢复到新宿主，并重建副作用与可见路由。
   *
   * @param container - 新连接的 `<micro-app>` 或其 ShadowRoot。
   */
  public showKeepAliveApp (container: HTMLElement | ShadowRoot): void {
    /**
     * 必须先把 `this.container` 指向新宿主，再恢复副作用（对应 issue #1115）；
     * 且快照恢复必须早于 `beforeshow`，保证监听器能够收到该事件。
     */
    const oldContainer = this.container
    this.container = container
    this.sandBox?.rebuildEffectSnapshot()

    // 子应用先收到即将显示状态，再通知基座。
    dispatchCustomEventToMicroApp(this, 'appstate-change', {
      appState: 'beforeshow',
    })

    dispatchLifecyclesEvent(
      container,
      this.name,
      lifeCycles.BEFORESHOW,
    )

    this.setKeepAliveState(keepAliveStates.KEEP_ALIVE_SHOW)

    this.cloneContainer(
      this.container,
      oldContainer,
      false,
    )

    /**
     * TODO:
     *  问题：当路由模式为custom时，keep-alive应用在重新展示，是否需要根据子应用location信息更新浏览器地址？
     *  暂时不这么做，因为无法确定二次展示时新旧地址是否相同，是否带有特殊信息
     */
    if (isRouterModeSearch(this.name)) {
      // 路由先恢复，aftershow 监听器才能读取到可见地址。
      this.sandBox?.setRouteInfoForKeepAliveApp()
    }

    // DOM 与路由都已恢复，最后向两侧发布 aftershow。
    dispatchCustomEventToMicroApp(this, 'appstate-change', {
      appState: 'aftershow',
    })

    dispatchLifecyclesEvent(
      this.container,
      this.name,
      lifeCycles.AFTERSHOW,
    )
  }

  /**
   * 将资源或渲染错误同时通知子应用元素与基座生命周期。
   *
   * @param e - 原始错误对象，作为基座 `error` 事件详情的一部分。
   */
  public onerror (e: Error): void {
    // 子应用先观察 `LOAD_FAILED` 状态，再由基座接收 error 生命周期。
    dispatchCustomEventToMicroApp(this, 'statechange', {
      appState: appStates.LOAD_FAILED
    })

    dispatchLifecyclesEvent(
      this.container,
      this.name,
      lifeCycles.ERROR,
      e,
    )
  }

  /**
   * 使用当前沙箱所属 realm 的 DOMParser 把 HTML 字符串解析为 body。
   *
   * iframe 沙箱使用 iframeWindow 的构造器，with 沙箱使用基座原生构造器，避免节点原型
   * 跨 realm 不一致。
   *
   * @param htmlString - 待解析的 DOM 字符串。
   * @returns 解析文档的 body 元素。
   */
  public parseHtmlString (htmlString: string): HTMLElement {
    const DOMParser = this.sandBox?.proxyWindow
      ? this.sandBox.proxyWindow.DOMParser
      : globalEnv.rawWindow.DOMParser
    return (new DOMParser()).parseFromString(htmlString, 'text/html').body
  }

  /**
   * 清空目标容器，并深拷贝 HTML 或直接转移来源子节点。
   *
   * @param target - 接收节点的容器。
   * @param origin - 提供节点或 HTML 模板的容器。
   * @param deep - `true` 时重新解析 HTML 形成深拷贝；`false` 时转移现有节点所有权。
   * @returns 原目标容器，任一容器为空时不执行操作。
   */
  private cloneContainer <T extends HTMLElement | ShadowRoot | null> (
    target: T,
    origin: T,
    deep: boolean,
  ): T {
    // 在基座接受到afterhidden方法后立即执行unmount，彻底destroy应用时，因为unmount时同步执行，所以this.container为null后才执行cloneContainer
    if (origin && target) {
      target.innerHTML = ''
      Array.from(deep ? this.parseHtmlString(origin.innerHTML).childNodes : origin.childNodes).forEach((node) => {
        target.appendChild(node)
      })
    }
    return target
  }

  /**
   * 按配置惰性创建沙箱。
   *
   * 调用场景包括首次创建，以及 iframe 默认模式卸载后的重挂载。后者会删除旧 iframe
   * 与沙箱，并在此创建新 realm，解决 module script 节点再次插入不会重新执行的问题。
   */
  private createSandbox (): void {
    if (this.useSandbox && !this.sandBox) {
      const iframeOption = {
        attrs: this.attrs,
        container: this.container
      }
      this.sandBox = this.iframe ? new IframeSandbox(this.name, this.url, iframeOption) : new WithSandBox(this.name, this.url)
    }
  }

  /** 将主状态写入实例，并同步给已存在沙箱中的静态全局状态。 */
  public setAppState (state: string): void {
    this.state = state

    // 子应用通过 `window.__MICRO_APP_STATE__` 读取同一状态。
    this.sandBox?.setStaticAppState(state)
  }

  /** 返回当前主生命周期状态。 */
  public getAppState (): string {
    return this.state
  }

  /** 更新独立的 keep-alive 显示/隐藏状态。 */
  private setKeepAliveState (state: string | null): void {
    this.keepAliveState = state
  }

  /** 返回 keep-alive 显示/隐藏状态；未进入该模式时为 `null`。 */
  public getKeepAliveState (): string | null {
    return this.keepAliveState
  }

  /** 判断主状态是否已进入 `UNMOUNT`。 */
  public isUnmounted (): boolean {
    return appStates.UNMOUNT === this.state
  }

  /** 判断 keep-alive 状态是否已进入隐藏态。 */
  public isHidden (): boolean {
    return keepAliveStates.KEEP_ALIVE_HIDDEN === this.keepAliveState
  }

  /** 从沙箱窗口读取指定微应用全局钩子，并过滤非函数值。 */
  private getMicroAppGlobalHook (eventName: string): Func | null {
    const listener = (this.sandBox?.proxyWindow as Record<string, any>)?.[eventName]
    return isFunction(listener) ? listener : null
  }

  /** 使用保存的原生查询方法在当前应用容器内查找首个节点。 */
  public querySelector (selectors: string): Node | null {
    return this.container ? globalEnv.rawElementQuerySelector.call(this.container, selectors) : null
  }

  /** 使用保存的原生查询方法在当前应用容器内查找全部节点。 */
  public querySelectorAll (selectors: string): NodeListOf<Node> {
    return this.container ? globalEnv.rawElementQuerySelectorAll.call(this.container, selectors) : []
  }

  /**
   * 计算实际内联模式；当前 iframe 沙箱无条件强制内联执行。
   *
   * 若未来取消该约束，必须同步调整 iframe 中 `getElementsByTagName` 获取 script 的逻辑，
   * 因为非内联模式下 iframe 内的脚本节点可能为空。
   *
   * @param inline - 元素或全局传入的内联配置。
   * @returns iframe 沙箱或显式配置任一开启时为 `true`。
   */
  private getInlineModeState (inline?: boolean): boolean {
    return (this.iframe || inline) ?? false
  }
}

/** 查询指定实例是否采用 iframe 沙箱；实例不存在时返回 `false`。 */
export function isIframeSandbox (appName: string): boolean {
  return appInstanceMap.get(appName)?.iframe ?? false
}
