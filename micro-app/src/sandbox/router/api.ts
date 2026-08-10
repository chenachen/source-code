import type {
  Func,
  Router,
  RouterTarget,
  navigationMethod,
  MicroLocation,
  RouterGuard,
  GuardLocation,
  AccurateGuard,
  SetDefaultPageOptions,
  AttachAllToURLParam,
  AppInterface,
} from '@micro-app/types'
import {
  encodeMicroPath,
  decodeMicroPath,
  setMicroPathToURL,
  setMicroState,
  getMicroState,
  getMicroPathFromURL,
  isRouterModeSearch,
  isRouterModePure,
  isRouterModeState,
} from './core'
import {
  logError,
  logWarn,
  formatAppName,
  createURL,
  isFunction,
  isPlainObject,
  useSetRecord,
  useMapRecord,
  requestIdleCallback,
  isString,
  noopFalse,
  removeDomScope,
  isObject,
} from '../../libs/utils'
import { appInstanceMap } from '../../create_app'
import { getActiveApps } from '../../micro_app'
import globalEnv from '../../libs/global_env'
import { navigateWithNativeEvent, attachRouteToBrowserURL } from './history'
import bindFunctionToRawTarget from '../bind_function'
import { updateMicroLocationWithEvent } from './event'

/**
 * 路由公共门面及其沙箱生命周期协作函数。
 */
export interface RouterApi {
  /** 暴露给开发者的全局路由 API。 */
  router: Router,
  /** 在 location 提交新快照后更新 current 并执行前置、后置守卫。 */
  executeNavigationGuard: (appName: string, to: GuardLocation, from: GuardLocation) => void
  /** 应用卸载时删除其 current 路由快照。 */
  clearRouterWhenUnmount: (appName: string) => void
}

/**
 * 注册并读取基座路由器代理的 API 契约。
 */
export interface CreteBaseRouter {
  /** 保存经过 DOM 作用域隔离与方法绑定的基座路由器。 */
  setBaseAppRouter (baseRouter: unknown): void
  /** 返回当前基座路由器代理，未注册时返回空值。 */
  getBaseAppRouter(): unknown
}

/**
 * 管理微应用首次挂载默认页面的 API 契约。
 */
export interface CreateDefaultPage {
  /** 登记默认页并返回移除本条登记的幂等回调。 */
  setDefaultPage(options: SetDefaultPageOptions): () => boolean
  /** 按应用名删除默认页登记。 */
  removeDefaultPage(appName: string): boolean
  /** 读取指定应用默认页；不存在时返回 `void`。 */
  getDefaultPage(key: PropertyKey): string | void
}

/**
 * 创建单例路由 API 及其导航守卫、生命周期状态闭包。
 *
 * @remarks
 * 工厂把默认页、基座路由代理与守卫集合封装在同一生命周期中；文件末尾仅实例化一次，因此公共 API
 * 之间共享 `current`、守卫和配置记录。
 */
function createRouterApi (): RouterApi {
  /**
   * 通过宿主 History 提交 router API 的目标地址与应用 state。
   *
   * @remarks
   * 路径合成与 state 合成在同一次导航调用中完成；提交后清除 DOM 作用域，避免公共 API 在微应用元素
   * 上下文中继续执行基座逻辑。
   *
   * @param appName - 发起公共 API 导航的微应用名称。
   * @param methodName - `replaceState` 或 `pushState`。
   * @param targetLocation - 已相对当前微应用地址解析的目标 location。
   * @param state - 目标路由携带的应用业务 state。
   */
  function navigateWithRawHistory (
    appName: string,
    methodName: string,
    targetLocation: MicroLocation,
    state: unknown,
  ): void {
    navigateWithNativeEvent(
      appName,
      methodName,
      setMicroPathToURL(
        appName,
        targetLocation,
      ),
      false,
      setMicroState(
        appName,
        state ?? null,
        targetLocation,
      ),
    )
    // 公共 API 离开子应用导航边界后必须恢复宿主 DOM 作用域。
    removeDomScope()
  }

  /**
   * 在沙箱就绪后执行一次 `router.push` 或 `router.replace` 导航。
   *
   * @remarks
   * 目标只采用 pathname/search/hash，即使输入包含不同 origin 也不会跨域切换微应用。重复路径仅在浏览器
   * 已同步同一路径时拦截；`pure` 模式跳过宿主 History，仅更新内部 location。`search` 模式通过宿主
   * 模拟事件回流更新子应用，其他模式直接派发子应用事件。
   *
   * @param appName - 目标微应用名称。
   * @param app - 已活动且沙箱就绪的应用实例。
   * @param to - 目标路径、state 与可选 replace 覆盖项。
   * @param replace - 当前方法是否为 `router.replace`。
   */
  function handleNavigate (
    appName: string,
    app: AppInterface,
    to: RouterTarget,
    replace: boolean,
  ): void {
    const microLocation = app.sandBox!.proxyWindow.location as MicroLocation
    const targetLocation = createURL(to.path, microLocation.href)
    // 只截取路径、查询与 hash；输入中的其他 origin 不参与微应用路由切换。
    const currentFullPath = microLocation.pathname + microLocation.search + microLocation.hash
    const targetFullPath = targetLocation.pathname + targetLocation.search + targetLocation.hash
    if (currentFullPath !== targetFullPath || getMicroPathFromURL(appName) !== targetFullPath) {
      // `pure` 模式不写宿主 History，其路径只存在于沙箱 location。
      if (!isRouterModePure(appName)) {
        const methodName = (replace && to.replace !== false) || to.replace === true ? 'replaceState' : 'pushState'
        navigateWithRawHistory(appName, methodName, targetLocation, to.state)
      }
      // search 模式由宿主 popstate 监听器异步回流；其他模式在此直接更新并通知子应用。
      if (!isRouterModeSearch(appName)) {
        updateMicroLocationWithEvent(appName, targetFullPath)
      }
    }
  }

  /**
   * 创建公共 `router.push` 或 `router.replace` 方法。
   *
   * @remarks
   * 应用名与字符串路径为必填；只允许控制已渲染、非隐藏、非预渲染应用。方法等待 `sandboxReady` 后才
   * 导航，避免代理 location/history 尚未建立。相同完整路径由执行层拦截；path 可带域名但域名会被忽略。
   * 失败通过返回 Promise 拒绝，调用方可统一处理未活动应用与参数错误。
   *
   * @param replace - 是否以 replace 作为该方法的默认写入策略；`to.replace` 可显式覆盖。
   * @returns 异步导航方法。
   */
  function createNavigationMethod (replace: boolean): navigationMethod {
    /** 校验目标应用，并把实际导航串接在该应用的沙箱就绪 Promise 之后。 */
    return function (to: RouterTarget): Promise<void> {
      return new Promise((resolve, reject) => {
        const appName = formatAppName(to.name)
        if (appName && isString(to.path)) {
          // 公共 API 只控制当前活动应用；预渲染或隐藏 keep-alive 应用自行记录/清理历史事件，外部强制
          // 导航会破坏其恢复顺序。
          /**
           * TODO：
           *  1、子应用开始渲染但是还没渲染完成，调用跳转改如何处理
           *  2、iframe的沙箱还没初始化时执行跳转报错，如何处理。。。
           *  3、hidden app、预渲染 app 是否支持跳转 --- 支持（这里还涉及子应用内部跳转的支持）
           */
          if (getActiveApps({ excludeHiddenApp: true, excludePreRender: true }).includes(appName)) {
            const app = appInstanceMap.get(appName)!
            resolve(app.sandBox.sandboxReady.then(() => handleNavigate(appName, app, to, replace)))
          } else {
            reject(logError('导航失败，请确保子应用渲染后再调用此方法'))
          }

          // const rawLocation = globalEnv.rawWindow.location
          // const targetLocation = createURL(to.path, rawLocation.origin)
          // const targetFullPath = targetLocation.pathname + targetLocation.search + targetLocation.hash
          // if (getMicroPathFromURL(appName) !== targetFullPath) {
          //   navigateWithRawHistory(
          //     appName,
          //     to.replace === false ? 'pushState' : 'replaceState',
          //     targetLocation,
          //     to.state,
          //   )
          // }
        } else {
          reject(logError(`navigation failed, name & path are required when use router.${replace ? 'replace' : 'push'}`))
        }
      })
    }
  }

  /**
   * 创建 `go`、`back`、`forward` 的宿主 History 直通方法。
   *
   * @remarks
   * 这三种操作移动共享浏览器历史栈，其结果由全局 popstate 监听器再分发给各活动微应用。
   */
  function createRawHistoryMethod (methodName: string): Func {
    /** 把参数原样转发到宿主 History 的同名栈移动方法。 */
    return function (...rests: unknown[]): void {
      return globalEnv.rawWindow.history[methodName](...rests)
    }
  }

  /** 按注册顺序保存同步执行的全局前置守卫，并通过 Set 避免同一引用重复登记。 */
  const beforeGuards = useSetRecord<RouterGuard>()
  /** 保存延迟到空闲回调执行的全局后置守卫。 */
  const afterGuards = useSetRecord<RouterGuard>()

  /**
   * 按登记顺序执行一组全局或应用精确匹配的路由守卫。
   *
   * @remarks
   * 进入基座守卫前清除 DOM 作用域，防止回调内 DOM 操作被绑定到触发导航的微应用。函数守卫接收
   * 应用名；对象守卫只调用以当前应用名为键的函数。守卫异常不在此捕获，会沿当前同步/异步边界抛出。
   *
   * @param appName - 当前发生导航的微应用名称。
   * @param to - 已提交的新路由快照。
   * @param from - 导航前的旧路由快照。
   * @param guards - 本阶段按插入顺序遍历的守卫集合。
   */
  function runGuards (
    appName: string,
    to: GuardLocation,
    from: GuardLocation,
    guards: Set<RouterGuard>,
  ) {
    // 守卫属于基座公共扩展点，执行前必须退出微应用 DOM 作用域。
    removeDomScope()
    for (const guard of guards) {
      if (isFunction(guard)) {
        guard(to, from, appName)
      } else if (isPlainObject(guard) && isFunction((guard as AccurateGuard)[appName])) {
        guard[appName](to, from)
      }
    }
  }

  /**
   * 提交一次导航的 current 快照，并按“前置同步、后置空闲”的顺序执行全局守卫。
   *
   * @remarks
   * 浏览器 URL 与 microLocation 已由调用方先更新，顺序与浏览器前进/后退一致，因此守卫是提交后的
   * 通知钩子，不具备取消或回滚协议。`beforeEach` 在当前调用栈执行；`afterEach` 通过 idle callback
   * 延后，避免阻塞路由主链。后置回调读取本次捕获的 `to/from`，即使期间再次导航也不会改写参数。
   *
   * @param appName - 当前发生导航的微应用名称。
   * @param to - 已提交的新路由快照。
   * @param from - 导航前的旧路由快照。
   */
  function executeNavigationGuard (
    appName: string,
    to: GuardLocation,
    from: GuardLocation,
  ): void {
    router.current.set(appName, to)

    runGuards(appName, to, from, beforeGuards.list())

    requestIdleCallback(() => {
      runGuards(appName, to, from, afterGuards.list())
    })
  }

  /**
   * 应用卸载时删除其 current 快照，避免公共 API 暴露已失效 location 与沙箱引用。
   */
  function clearRouterWhenUnmount (appName: string): void {
    router.current.delete(appName)
  }

  /**
   * 把指定活动应用的内存路由重新附加到浏览器 URL/state。
   *
   * @remarks
   * 只处理 `search` 与 `state`：它们拥有独立于宿主路径的可附加记录。应用不存在、未建立相应路由
   * 模式或使用自定义原生模式时，模式判断直接令本函数无操作；命中分支后再读取实例并以 replace 提交。
   */
  function commonHandlerForAttachToURL (appName: string): void {
    if (isRouterModeSearch(appName) || isRouterModeState(appName)) {
      const app = appInstanceMap.get(appName)!
      attachRouteToBrowserURL(
        appName,
        setMicroPathToURL(appName, app.sandBox.proxyWindow.location as MicroLocation),
        setMicroState(appName, getMicroState(appName), app.sandBox.proxyWindow.location as MicroLocation),
      )
    }
  }

  /**
   * 把指定活动应用的路由信息附加到当前浏览器记录。
   *
   * @param appName - 待附加的应用名；会先按全局规则规范化。
   */
  function attachToURL (appName: string): void {
    appName = formatAppName(appName)
    if (appName && getActiveApps().includes(appName)) {
      commonHandlerForAttachToURL(appName)
    }
  }

  /**
   * 把筛选后的全部活动应用路由信息依次附加到浏览器记录。
   *
   * @param includeHiddenApp - 是否包含隐藏的 keep-alive 应用。
   * @param includePreRender - 是否包含预渲染应用。
   */
  function attachAllToURL ({
    includeHiddenApp = false,
    includePreRender = false,
  }: AttachAllToURLParam): void {
    getActiveApps({
      excludeHiddenApp: !includeHiddenApp,
      excludePreRender: !includePreRender,
    }).forEach(appName => commonHandlerForAttachToURL(appName))
  }

  /**
   * 创建默认页登记、移除与查询 API，共享一个应用名到路径的映射。
   */
  function createDefaultPageApi (): CreateDefaultPage {
    /** 仅保存首次挂载候选页；浏览器已有应用路径时其优先级更高。 */
    const defaultPageRecord = useMapRecord<string>()

    /**
     * 登记应用首次挂载的默认页面，并返回删除该登记的函数。
     *
     * @remarks
     * 默认页只在挂载初始化且浏览器没有该应用路径时生效。应用名或 path 无效时不写记录，开发环境
     * 给出警告，并返回始终失败的清理函数。
     *
     * @param options - 包含应用名称与默认完整路径的配置。
     */
    function setDefaultPage (options: SetDefaultPageOptions): () => boolean {
      const appName = formatAppName(options.name)
      if (!appName || !options.path) {
        if (__DEV__) {
          if (!appName) {
            logWarn(`setDefaultPage: invalid appName "${appName}"`)
          } else {
            logWarn('setDefaultPage: path is required')
          }
        }
        return noopFalse
      }

      return defaultPageRecord.add(appName, options.path)
    }

    /**
     * 规范化应用名后删除其默认页登记，并返回是否实际删除。
     */
    function removeDefaultPage (appName: string): boolean {
      appName = formatAppName(appName)
      if (!appName) return false

      return defaultPageRecord.delete(appName)
    }

    return {
      setDefaultPage,
      removeDefaultPage,
      getDefaultPage: defaultPageRecord.get,
    }
  }

  /**
   * 创建基座路由器的注册与读取 API，使子应用能安全调用基座导航能力。
   */
  function createBaseRouterApi (): CreteBaseRouter {
    /** 保存基座路由器代理；初始为空，只有合法对象才能替换。 */
    let baseRouterProxy: unknown = null
    /**
     * 为基座路由器建立代理：读取方法时绑定真实目标并退出 DOM 作用域，写入时原样转发。
     *
     * @remarks
     * 绑定缓存保证多次读取同一方法获得稳定引用；清除作用域则保证子应用调用基座路由器时，基座内部
     * DOM 操作不会落入子应用容器。
     */
    function setBaseAppRouter (baseRouter: unknown): void {
      if (isObject(baseRouter)) {
        baseRouterProxy = new Proxy(baseRouter, {
          /** 读取成员前退出微应用 DOM 作用域，并把函数接收者稳定绑定到基座路由器。 */
          get (target: History, key: PropertyKey): unknown {
            removeDomScope()
            return bindFunctionToRawTarget(Reflect.get(target, key), target, 'BASEROUTER')
          },
          /** 把属性写入真实基座路由器，并报告赋值成功以兼容严格模式。 */
          set (target: History, key: PropertyKey, value: unknown): boolean {
            Reflect.set(target, key, value)
            return true
          }
        })
      } else if (__DEV__) {
        logWarn('setBaseAppRouter: Invalid base router')
      }
    }

    return {
      setBaseAppRouter,
      /** 返回当前已注册的基座路由器代理。 */
      getBaseAppRouter: () => baseRouterProxy,
    }
  }

  /**
   * 面向开发者的路由单例，汇总编码、导航、守卫、附加、默认页和基座路由器能力。
   */
  const router: Router = {
    current: new Map<string, MicroLocation>(),
    encode: encodeMicroPath,
    decode: decodeMicroPath,
    push: createNavigationMethod(false),
    replace: createNavigationMethod(true),
    go: createRawHistoryMethod('go'),
    back: createRawHistoryMethod('back'),
    forward: createRawHistoryMethod('forward'),
    beforeEach: beforeGuards.add,
    afterEach: afterGuards.add,
    attachToURL,
    attachAllToURL,
    ...createDefaultPageApi(),
    ...createBaseRouterApi(),
  }

  return {
    router,
    executeNavigationGuard,
    clearRouterWhenUnmount,
  }
}

/**
 * 从唯一工厂实例导出的路由门面、守卫执行器与卸载清理器；三者共享同一闭包状态。
 */
export const {
  router,
  executeNavigationGuard,
  clearRouterWhenUnmount,
} = createRouterApi()
