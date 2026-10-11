/* eslint-disable no-void */
import type {
  MicroLocation,
  GuardLocation,
  microAppWindowType,
} from '@micro-app/types'
import globalEnv from '../../libs/global_env'
import bindFunctionToRawTarget from '../bind_function'
import {
  assign as oAssign,
  createURL,
  rawDefineProperty,
} from '../../libs/utils'
import {
  setMicroPathToURL,
  isEffectiveApp,
  setMicroState,
  getMicroState,
  isRouterModeCustom,
  isRouterModeNative,
  isRouterModeSearch,
  isRouterModePure,
} from './core'
import {
  dispatchNativeEvent,
  updateMicroLocationWithEvent,
} from './event'
import {
  executeNavigationGuard,
} from './api'
import {
  nativeHistoryNavigate,
  navigateWithNativeEvent,
} from './history'
import {
  appInstanceMap,
  isIframeSandbox,
} from '../../create_app'
import {
  HIJACK_LOCATION_KEYS,
} from '../../constants'

/** 守卫快照需从 URL 原型显式复制的可变 location 字段；只读 `origin` 在下方另行补入。 */
const locationKeys: ReadonlyArray<keyof MicroLocation> = ['href', 'pathname', 'search', 'hash', 'host', 'hostname', 'port', 'protocol', 'search']
/** 导航守卫快照字段；在可同步字段之外补上只读 `origin` 与派生的 `fullPath`。 */
const guardLocationKeys: ReadonlyArray<keyof MicroLocation> = [...locationKeys, 'origin', 'fullPath']

/**
 * 创建应用生命周期内唯一的 `MicroLocation` 引用，并代理所有读写与导航方法。
 *
 * @remarks
 * with 沙箱以独立 URL 对象保存内部地址；iframe 沙箱动态读取 iframe 的真实 location，避免 iframe
 * 原生跳转重置窗口后持有失效引用。代理按路由模式决定哪些字段呈现宿主 origin、哪些保持子应用
 * origin，并把 href/pathname/search/hash 写入统一转换为 History、事件与 reload 行为。
 *
 * @param appName - location 所属的微应用名称。
 * @param url - 微应用入口地址，也是内部相对路径的解析基准。
 * @param microAppWindow - iframe 沙箱窗口；仅 iframe 模式传入。
 * @param childStaticLocation - 子应用真实静态 location 信息；用于修正 iframe origin 视图。
 * @param browserHost - iframe 当前地址中的宿主 host。
 * @param childHost - 需要向子应用呈现的真实 host。
 * @returns 注入沙箱且引用稳定的 location 代理。
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Location
 */
export function createMicroLocation (
  appName: string,
  url: string,
  microAppWindow?: microAppWindowType,
  childStaticLocation?: MicroLocation,
  browserHost?: string,
  childHost?: string,
): MicroLocation {
  const rawWindow = globalEnv.rawWindow
  const rawLocation = rawWindow.location
  const isIframe = !!microAppWindow
  /** with 沙箱独占的可变 URL 对象，在单个子应用生命周期内保持引用稳定。 */
  const withLocation = createURL(url)

  /**
   * 获取本次操作应访问的真实 location 目标。
   *
   * @remarks
   * iframe 原生导航可能替换 `microAppWindow.location`，故每次动态读取；with 沙箱始终返回稳定 URL。
   */
  function getTarget (): MicroLocation {
    return isIframe ? microAppWindow.location : withLocation
  }

  /**
   * 统一处理 `href`、`assign` 与 `replace` 导航，区分内部路由、hash 特例和跨 origin 跳转。
   *
   * @remarks
   * 同 origin 目标先按模式合成宿主路径。非原生模式拦截导航：仅 hash 变化时模拟 History 与事件，
   * pathname/search 变化时提交后主动 reload；`pure` 强制 replace，避免生成无法在宿主恢复的历史条目。
   * 自定义原生模式与跨 origin 目标返回给真实 location 执行。返回 `void` 表示导航已被沙箱处理。
   *
   * @param value - 应用请求的目标地址。
   * @param methodName - 对应 assign/replace 的 `pushState` 或 `replaceState` 策略。
   * @returns 需交给真实 location 的路径/原值；已内部处理时返回 `void`。
 * @throws URL 解析、History 或 reload 的同步错误向调用方传播；已提交的路由不做回滚。
   */
  function commonHandler (value: string | URL, methodName: string): string | URL | void {
    const targetLocation = createURL(value, proxyLocation.href)
    // 同 origin 仍可能是需要刷新文档的页面跳转，不能一律降级为单页路由更新。
    if (targetLocation.origin === proxyLocation.origin) {
      const setMicroPathResult = setMicroPathToURL(appName, targetLocation)
      // 自定义原生模式直接交给宿主 location；其余模式由沙箱维护路由映射。
      if (!isRouterModeCustom(appName)) {
        methodName = isRouterModePure(appName) ? 'replaceState' : methodName
        /**
         * 浏览器给 `location.href` 赋仅 hash 不同的地址不会刷新文档，因此该分支用 History 与事件模拟
         * hash 导航；pathname/search 相同且目标也相同时不新增历史条目。目标没有 hash 时则显式 reload，
         * 保留 href/assign/replace 的文档导航语义。
         */
        if (
          targetLocation.pathname === proxyLocation.pathname &&
          targetLocation.search === proxyLocation.search
        ) {
          let oldHref = null
          // pure 也进入这一分支：目标带 hash 时只更新内部位置，无 hash 时借宿主 state 保存刷新目标。
          if (targetLocation.hash !== proxyLocation.hash || isRouterModePure(appName)) {
            // search 模式把参数写进 hash 时，保存旧宿主 href 以构造正确 hashchange。
            if (setMicroPathResult.isAttach2Hash) {
              oldHref = rawLocation.href
            }
            // `pure` 且目标含 hash 时完全留在内存，不触碰宿主 History。
            if (!isRouterModePure(appName) || !targetLocation.hash) {
              nativeHistoryNavigate(
                appName,
                methodName,
                setMicroPathResult.fullPath,
                !isRouterModeSearch(appName) ? setMicroState(appName, null, targetLocation) : null,
              )
            }
          }

          if (targetLocation.hash) {
            if (isRouterModeSearch(appName)) {
              dispatchNativeEvent(appName, false, oldHref)
            } else {
              updateMicroLocationWithEvent(appName, targetLocation.pathname + targetLocation.search + targetLocation.hash)
            }
          } else {
            reload()
          }
          return void 0
        }

        // pathname/search 变化应具有文档导航效果：先同步路由记录，再显式刷新宿主页面。
        // search 用 URL 参数保存目标并把宿主 state 置 null；state/pure 则把目标放进应用 state。
        nativeHistoryNavigate(
          appName,
          methodName,
          setMicroPathResult.fullPath,
          !isRouterModeSearch(appName) ? setMicroState(appName, null, targetLocation) : null,
        )
        reload()
        return void 0
      }

      return setMicroPathResult.fullPath
    }

    return value
  }

  /**
   * 处理 `location.pathname` 与 `location.search` 赋值，复现浏览器的历史栈与刷新行为。
   *
   * @remarks
   * 当目标字段相同且现有地址带 hash 时，href 未变化，只补发 popstate；否则相同字段或 `pure` 模式
   * 使用 replace，真实变化使用 push，提交路由后 reload。这样避免 `/path` 到 `/path#hash` 等特殊组合
   * 产生多余历史条目。
   *
   * @param targetPath - 已拼成的微应用目标完整路径。
   * @param key - 当前被赋值的 `pathname` 或 `search`。
   */
  function handleForPathNameAndSearch (targetPath: string, key: keyof Location): void {
    const targetLocation = createURL(targetPath, url)
    // 带 hash 时给 pathname/search 赋相同值不会刷新浏览器，只需模拟路由事件。
    if (targetLocation[key] === proxyLocation[key] && proxyLocation.hash) {
      // href 未变化，因此不提供 oldHref，也不会追加 hashchange。
      dispatchNativeEvent(appName, false)
    } else {
      // 字段值相同或 `pure` 时使用 replace，覆盖 `/path -> /path#hash`、`?query -> ?query#hash` 等
      // 不应新增历史条目的组合。
      nativeHistoryNavigate(
        appName,
        (
          targetLocation[key] === proxyLocation[key] || isRouterModePure(appName)
        )
          ? 'replaceState'
          : 'pushState',
        setMicroPathToURL(appName, targetLocation).fullPath,
        !isRouterModeSearch(appName) ? setMicroState(appName, null, targetLocation) : null,
      )
      reload()
    }
  }

  /**
   * 创建 `location.assign`/`replace` 包装方法，在应用有效时选择 push/replace 策略并执行真实跳转。
   * 有效性是存在且非预加载，不要求 MOUNTED、active 或可见；与 router.push 的活动应用筛选不同。
   */
  const createLocationMethod = (locationMethodName: string) => {
    /** 把 location 方法调用接入统一导航处理器；需真实导航时再补全为宿主 origin。 */
    return function (value: string | URL) {
      if (isEffectiveApp(appName)) {
        const targetPath = commonHandler(value, locationMethodName === 'assign' ? 'pushState' : 'replaceState')
        if (targetPath) {
          // 与 href setter 一致，以宿主 origin 补全路径，避免 Vite 运行时默认拼入子应用 origin。
          rawLocation[locationMethodName](createURL(targetPath, rawLocation.origin).href)
        }
      }
    }
  }

  /** 注入微应用的 `location.assign`，默认以 push 方式执行导航。 */
  const assign = createLocationMethod('assign')
  /** 注入微应用的 `location.replace`，默认替换当前历史条目。 */
  const replace = createLocationMethod('replace')
  /** 把微应用 reload 请求转发给宿主真实 location。 */
  const reload = (forcedReload?: boolean): void => rawLocation.reload(forcedReload)

  rawDefineProperty(getTarget(), 'fullPath', {
    enumerable: true,
    configurable: true,
    /** 每次按当前代理字段派生完整路径，避免维护可失配的额外缓存。 */
    get: () => proxyLocation.pathname + proxyLocation.search + proxyLocation.hash,
  })

  /**
   * 原生 `location.assign/replace` 是只读且含不可配置属性，直接作为 Proxy 目标会触发不变量限制；因此
   * 使用空对象承载代理，并在每次 trap 中转发到动态真实目标。
   */
  const proxyLocation = new Proxy({} as Location, {
    /**
     * 读取导航方法、派生字段与按模式修正后的地址属性，其余成员绑定真实 location 后透传。
     */
    get: (_: Location, key: string): unknown => {
      const target = getTarget()

      if (key === 'assign') return assign
      if (key === 'replace') return replace
      if (key === 'reload') return reload
      if (key === 'self') return target
      if (key === 'fullPath') return target.fullPath

      /**
       * host/hostname/port/protocol/origin 决定应用的来源视图：native 呈现宿主值，其他模式呈现子应用值。
       * iframe 的真实地址指向基座，因此非 native 模式用启动时保存的子应用来源；href 在下一分支把
       * 当前内部路径与相应来源组合，不能直接等同于宿主 href。
       */
      if (HIJACK_LOCATION_KEYS.includes(key)) {
        if (isRouterModeNative(appName)) {
          return rawLocation[key]
        }
        if (isIframe) {
          return childStaticLocation![key]
        }
      }

      if (key === 'href') {
        if (isRouterModeNative(appName)) {
          return target[key].replace(target.origin, rawLocation.origin)
        }
        if (isIframe) {
          // iframe location 目标可能已被导航替换；通过 host 文本映射恢复子应用可见 href。
          return target[key].replace(browserHost!, childHost!)
        }
      }

      return bindFunctionToRawTarget<Location>(Reflect.get(target, key), target, 'LOCATION')
    },
    /**
     * 把 location 属性赋值转换为原生导航或沙箱路由更新，并始终返回成功以满足 Proxy 严格模式。
     */
    set: (_: Location, key: string, value: string): boolean => {
      if (isEffectiveApp(appName)) {
        const target = getTarget()
        if (key === 'href') {
          /**
           * Vite 环境可能把无 origin 的 targetPath 默认补成子应用 origin；这里改用宿主 origin 作为
           * 相对路径基准。若 `commonHandler` 返回的是绝对跨 origin 地址，其自身 origin 仍会保留；若
           * 返回路由模式生成的路径，则稳定落到宿主 origin。
           */
          const targetPath = commonHandler(value, 'pushState')
          if (targetPath) {
            rawLocation.href = createURL(targetPath, rawLocation.origin).href
          }
        } else if (key === 'pathname') {
          if (isRouterModeCustom(appName)) {
            rawLocation.pathname = value
          } else {
            const targetPath = ('/' + value).replace(/^\/+/, '/') + proxyLocation.search + proxyLocation.hash
            handleForPathNameAndSearch(targetPath, 'pathname')
          }
        } else if (key === 'search') {
          if (isRouterModeCustom(appName)) {
            rawLocation.search = value
          } else {
            const targetPath = proxyLocation.pathname + ('?' + value).replace(/^\?+/, '?') + proxyLocation.hash
            handleForPathNameAndSearch(targetPath, 'search')
          }
        } else if (key === 'hash') {
          if (isRouterModeCustom(appName)) {
            rawLocation.hash = value
          } else {
            const targetPath = proxyLocation.pathname + proxyLocation.search + ('#' + value).replace(/^#+/, '#')
            const targetLocation = createURL(targetPath, url)
            // 与当前值相同的 hash 不产生浏览器事件，也不重复写入路由 state。
            if (targetLocation.hash !== proxyLocation.hash) {
              if (!isRouterModePure(appName)) {
                navigateWithNativeEvent(
                  appName,
                  'pushState',
                  setMicroPathToURL(appName, targetLocation),
                  false,
                  setMicroState(appName, null, targetLocation),
                )
              }
              if (!isRouterModeSearch(appName)) {
                updateMicroLocationWithEvent(appName, targetLocation.pathname + targetLocation.search + targetLocation.hash)
              }
            }
          }
        } else {
          Reflect.set(target, key, value)
        }
      }
      return true
    },
  })

  return proxyLocation as MicroLocation
}

/**
 * 从当前 microLocation 创建不可依赖其后续变更的导航守卫快照。
 *
 * @remarks
 * `Object.assign` 只能复制 URL 实例的自有可枚举值；原型上的地址字段需按白名单再次读取并写入普通
 * 对象，确保守卫获得完整的 origin、fullPath 等值。
 *
 * @param appName - 快照所属的微应用名称。
 * @param microLocation - 当前路由位置引用。
 * @returns 供守卫读取的普通位置对象。
 */
export function createGuardLocation (appName: string, microLocation: MicroLocation): GuardLocation {
  const guardLocation = oAssign({ name: appName }, microLocation) as GuardLocation
  // URL 原型字段不会被普通 assign 完整复制，必须按守卫字段清单显式转存。
  for (const key of guardLocationKeys) guardLocation[key] = microLocation[key]
  return guardLocation
}

/**
 * 在首次把 location 附加到浏览器后，以相同的 to/from 快照触发一次初始化守卫通知。
 *
 * @remarks
 * 初始化没有真实旧地址；传入等值快照让守卫仍能建立 `router.current`，同时明确这不是可回滚导航。
 */
export function autoTriggerNavigationGuard (appName: string, microLocation: MicroLocation): void {
  executeNavigationGuard(appName, createGuardLocation(appName, microLocation), createGuardLocation(appName, microLocation))
}

/**
 * 原地更新微应用 location，校正原生模式宿主 URL，并按类型触发导航守卫。
 *
 * @remarks
 * 上游包括 History 写入、popstate、初始化 URL 查询与默认页；pure 或默认页预处理可只更新内部地址。
 * 函数先捕获 `from`，iframe 通过其保存的原始 replaceState 改真实 location；with 沙箱
 * 则改独立 URL 对象且保持子应用 origin。自定义原生模式若 state 中目标路径与当前宿主 URL 不一致，
 * 会以 state 快照为准 replace 校正，避免 Vue Router 4 等主动回写 URL 后出现“页面与地址不一致”。
 *
 * `type='prevent'` 禁止守卫，`type='auto'` 即使路径相同也触发初始化通知；默认仅 fullPath 变化时触发。
 * 守卫发生在 location 完成更新之后，因此只能观察已提交状态，不能取消本次更新。
 *
 * @param appName - 待更新的微应用名称。
 * @param targetFullPath - 目标 pathname、search 与 hash 组合。
 * @param microLocation - 需要原地更新的沙箱 location 引用。
 * @param type - 可选的守卫策略：`auto` 强制通知，`prevent` 禁止通知。
 */
export function updateMicroLocation (
  appName: string,
  targetFullPath: string,
  microLocation: MicroLocation,
  type?: string,
): void {
  // 必须在任何写入前复制旧快照，保证守卫的 `from` 不随引用更新。
  const from = createGuardLocation(appName, microLocation)
  // iframe 必须改其真实 location/history；代理 location 只承担外部视图，不能作为 replaceState 目标。
  const newLocation = createURL(targetFullPath, microLocation.href)
  if (isIframeSandbox(appName)) {
    const microAppWindow = appInstanceMap.get(appName)!.sandBox.microAppWindow
    microAppWindow.rawReplaceState?.call(microAppWindow.history, getMicroState(appName), '', newLocation.href)
  } else {
    let targetHref = newLocation.href
    if (microLocation.self.origin !== newLocation.origin) {
      targetHref = targetHref.replace(newLocation.origin, microLocation.self.origin)
    }
    microLocation.self.href = targetHref
  }

  /**
   * 自定义原生模式仍用 `history.state.__MICRO_APP_STATE__` 作为恢复快照，但基座或 Vue Router 4 可在
   * 初始化、前进/后退过程中主动改宿主 URL，导致两者分叉。响应 popstate 后若目标快照与可见 URL
   * 不同，以快照 replace 宿主地址，保证当前渲染页面与地址一致；`prevent` 用于明确跳过这次校正。
   *
   * 限制：多个原生模式子应用共享同一路径时，一个应用改 URL 不会同步改另一个应用快照，刷新后仍
   * 可能产生冲突；此模式本身不适用于同页多应用共同导航。
   */
  const rawLocation = globalEnv.rawWindow.location
  if (
    isRouterModeCustom(appName) &&
    (targetFullPath !== rawLocation.pathname + rawLocation.search + rawLocation.hash) &&
    type !== 'prevent'
  ) {
    nativeHistoryNavigate(appName, 'replaceState', targetFullPath, globalEnv.rawWindow.history.state)
  }

  // 所有 location 与宿主 URL 校正完成后再捕获 `to`，守卫读取到的是最终提交值。
  const to = createGuardLocation(appName, microLocation)
  // 初始化可强制通知；普通更新去重同路径；内部同步可用 `prevent` 完全静默。
  if (type === 'auto' || (from.fullPath !== to.fullPath && type !== 'prevent')) {
    executeNavigationGuard(appName, to, from)
  }
}
