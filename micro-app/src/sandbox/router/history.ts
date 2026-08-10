/* eslint-disable no-void */
import type {
  MicroState,
  MicroLocation,
  MicroHistory,
  HistoryProxyValue,
  HandleMicroPathResult,
} from '@micro-app/types'
import globalEnv from '../../libs/global_env'
import bindFunctionToRawTarget from '../bind_function'
import {
  isString,
  createURL,
  isPlainObject,
  isURL,
  assign,
  removeDomScope,
  isUndefined,
  isNull,
} from '../../libs/utils'
import {
  setMicroPathToURL,
  setMicroState,
  getMicroState,
  getMicroRouterInfoState,
  getMicroPathFromURL,
  isEffectiveApp,
  isRouterModePure,
  isRouterModeSearch,
  isRouterModeState,
  isRouterModeCustom,
} from './core'
import {
  dispatchNativeEvent,
} from './event'
import {
  updateMicroLocation,
} from './location'
import {
  getActiveApps,
} from '../../micro_app'
import {
  appInstanceMap,
  isIframeSandbox,
} from '../../create_app'

/**
 * 创建微应用 `history` 门面，隔离应用 state 并把导航同步到对应的 location。
 *
 * @remarks
 * `pushState`/`replaceState` 先按路由模式计算宿主 URL 与应用级 state，再更新共享的 microLocation。
 * with 沙箱通过 Proxy 暴露宿主 History 的其余能力、绑定真实接收者，并把 `state` 映射为当前应用
 * 业务 state；iframe 沙箱把显式写入方法合并到其原生 History，`go` 仍转发宿主共享历史栈。
 *
 * @param appName - history 所属的微应用名称。
 * @param microLocation - 与 history 共享的 location；with 为代理 location，iframe 为 iframe location。
 * @returns 注入微应用的 History 兼容对象。
 * @see https://developer.mozilla.org/en-US/docs/Web/API/History
 */
export function createMicroHistory (appName: string, microLocation: MicroLocation): MicroHistory {
  const rawHistory = globalEnv.rawWindow.history
  /**
   * 为 `pushState` 或 `replaceState` 创建微应用导航实现。
   *
   * @remarks
   * 空 URL 按浏览器语义落到当前 microLocation；相对 URL 也基于它解析。非 `pure` 模式先提交宿主
   * 历史，随后仅在路径变化时原地更新 location，最后刷新 iframe base，使后续相对资源解析跟随新路由。
   */
  function getMicroHistoryMethod (methodName: string): CallableFunction {
    /** 规范化 History API 参数，并按当前路由模式完成一次微应用导航。 */
    return function (...rests: any[]): void {
      // TODO：补充 iframe 中 History API 第三个参数为 `URL` 实例时的兼容测试。
      rests[2] = isUndefined(rests[2]) || isNull(rests[2]) || ('' + rests[2] === '') ? microLocation.href : '' + rests[2]
      const targetLocation = createURL(rests[2], microLocation.href)
      const targetFullPath = targetLocation.pathname + targetLocation.search + targetLocation.hash
      if (!isRouterModePure(appName)) {
        navigateWithNativeEvent(
          appName,
          methodName,
          setMicroPathToURL(appName, targetLocation),
          true,
          setMicroState(appName, rests[0], targetLocation),
          rests[1],
        )
      }
      if (targetFullPath !== microLocation.fullPath) {
        updateMicroLocation(appName, targetFullPath, microLocation)
      }
      appInstanceMap.get(appName)?.sandBox.updateIframeBase?.()
    }
  }

  const originalHistory = {
    pushState: getMicroHistoryMethod('pushState'),
    replaceState: getMicroHistoryMethod('replaceState'),
  }

  if (isIframeSandbox(appName)) {
    return assign({
      /** 把 iframe 内的历史栈移动请求转发给宿主共享历史栈。 */
      go (delta?: number) {
        return rawHistory.go(delta)
      }
    }, originalHistory) as MicroHistory
  }

  return new Proxy(rawHistory, {
    /**
     * 返回微应用覆写的写入方法与独立 state；其余宿主 History 成员绑定真实对象后透传。
     */
    get (target: History, key: PropertyKey): HistoryProxyValue {
      if (key === 'pushState' || key === 'replaceState') {
        return originalHistory[key]
      } else if (key === 'state') {
        return getMicroState(appName)
      }
      return bindFunctionToRawTarget<History, HistoryProxyValue>(Reflect.get(target, key), target, 'HISTORY')
    },
    /**
     * 允许应用替换自己的写入包装函数，其余赋值转发宿主 History，并始终报告成功。
     */
    set (target: History, key: PropertyKey, value: unknown): boolean {
      if (key === 'pushState' || key === 'replaceState') {
        originalHistory[key] = value as CallableFunction
      } else {
        Reflect.set(target, key, value)
      }
      // Proxy `set` 在严格模式返回 false 会抛 TypeError，例如给只读 `history.state` 赋值；统一返回
      // true 保持浏览器侧“赋值不生效但不中断应用”的兼容行为。
      return true
    }
  })
}

/**
 * 在应用有效时调用宿主保存的原始 History 方法提交新地址。
 *
 * @remarks
 * 只接受 `pushState` 与 `replaceState` 语义；方法名不是前者时使用后者。直接调用初始化时保存的原始
 * 方法可绕过全局 history 补丁，避免重入 `reWriteHistoryMethod`。
 *
 * @param appName - 发起导航的微应用名称，用于有效性校验。
 * @param methodName - 选择新增或替换历史条目的方法名。
 * @param fullPath - 待提交给宿主 History 的完整路径。
 * @param state - 宿主历史条目 state，默认 `null`。
 * @param title - History API 的 title 参数，默认空字符串。
 */
export function nativeHistoryNavigate (
  appName: string,
  methodName: string,
  fullPath: string,
  state: unknown = null,
  title: unknown = '',
): void {
  if (isEffectiveApp(appName)) {
    const method = methodName === 'pushState' ? globalEnv.rawPushState : globalEnv.rawReplaceState
    method.call(globalEnv.rawWindow.history, state, title, fullPath)
  }
}

/**
 * 提交微应用路由到宿主 History，并在需要时模拟宿主 popstate/hashchange。
 *
 * @remarks
 * 调用场景包括挂载/卸载附加路由、代理 History 写入、公共 router API 与 location 属性导航。先比较
 * 导航前后宿主路径，再调用原始 History 方法；只有 `search` 模式的可见 URL 确实变化时才主动派发
 * 事件，因为其他模式没有查询参数变化需要模拟。`onlyForBrowser` 可阻止该事件重新下发给子应用。
 *
 * @param appName - 发起导航的微应用名称。
 * @param methodName - `pushState` 或 `replaceState`。
 * @param result - 路径合成/移除结果及其 hash 附加位置。
 * @param onlyForBrowser - 是否把模拟事件限制给基座消费。
 * @param state - 可选的宿主历史 state。
 * @param title - 可选的 History API title。
 */
export function navigateWithNativeEvent (
  appName: string,
  methodName: string,
  result: HandleMicroPathResult,
  onlyForBrowser: boolean,
  state?: unknown,
  title?: string,
): void {
  if (isEffectiveApp(appName)) {
    const rawLocation = globalEnv.rawWindow.location
    const oldFullPath = rawLocation.pathname + rawLocation.search + rawLocation.hash
    // 仅 hash 查询段发生真实变化时保存旧 href，用于构造基座 hashchange。
    const oldHref = result.isAttach2Hash && oldFullPath !== result.fullPath ? rawLocation.href : null
    // 先提交 History，使后续事件处理器读取到新 URL 和新 state。
    nativeHistoryNavigate(appName, methodName, result.fullPath, state, title)
    // 只有 search 模式需要为程序化查询参数变化补发浏览器事件。
    if (oldFullPath !== result.fullPath && isRouterModeSearch(appName)) {
      dispatchNativeEvent(appName, onlyForBrowser, oldHref)
    }
  }
}

/**
 * 用 `replaceState` 把微应用路由附加到当前浏览器条目，并只通知基座。
 *
 * @remarks
 * 用于挂载、卸载、隐藏、恢复以及显式 attach API。替换而非新增条目，避免生命周期同步污染用户的
 * 前进/后退栈；事件标记 `onlyForBrowser`，防止子应用把附加动作再次解释为一次导航。
 *
 * @param appName - 待附加路由的微应用名称。
 * @param result - 路径合成或移除后的宿主 URL 信息。
 * @param state - 与该 URL 同步提交的宿主 history state。
 */
export function attachRouteToBrowserURL (
  appName: string,
  result: HandleMicroPathResult,
  state: MicroState,
): void {
  navigateWithNativeEvent(appName, 'replaceState', result, true, state)
}

/**
 * 包装宿主 `pushState`/`replaceState`，在基座写 history 时保住并补回微应用路由快照。
 *
 * @remarks
 * Next.js、Angular 等可能在同地址上用全新 state 调用 `replaceState`。若新 state 没有
 * `__MICRO_APP_STATE__`，直接提交会使所有子应用路由丢失；仅在目标 href 与当前 href 相同的场景合并
 * 旧快照，避免把旧页面的应用状态带到真正的新地址。原方法完成后，再为仍活动且记录缺失的应用补回
 * URL/state。最后清除 DOM 作用域，兼容嵌套应用中上层已补丁化的 History 方法。
 *
 * @param method - 初始化阶段保存的真实 `history.pushState` 或 `history.replaceState`。
 * @returns 安装到宿主 History 的包装函数。
 */
function reWriteHistoryMethod (method: History['pushState' | 'replaceState']): CallableFunction {
  const rawWindow = globalEnv.rawWindow
  /** 在一次基座 History 写入前保留同页快照，并在写入后修复各活动应用记录。 */
  return function (...rests: [data: any, unused: string, url?: string]): void {
    if (
      rawWindow.history.state?.__MICRO_APP_STATE__ &&
      (!isPlainObject(rests[0]) || !rests[0].__MICRO_APP_STATE__) &&
      (isString(rests[2]) || isURL(rests[2]))
    ) {
      const currentHref = rawWindow.location.href
      const targetLocation = createURL(rests[2], currentHref)
      if (targetLocation.href === currentHref) {
        rests[0] = assign({}, rests[0], {
          __MICRO_APP_STATE__: rawWindow.history.state.__MICRO_APP_STATE__,
        })
      }
    }

    method.apply(rawWindow.history, rests)
    /**
     * 必须在基座原方法完成后补回子应用路由，才能基于最终 URL/state 判断缺失项。本补丁只能观察
     * History API，无法截获基座直接通过 location 导航；嵌套应用中保存的 raw 方法也可能已由父应用
     * 包装，因此末尾还需重置 DOM 作用域。
     */
    getActiveApps({
      excludeHiddenApp: true,
      excludePreRender: true,
    }).forEach(appName => {
      if ((isRouterModeSearch(appName) || isRouterModeState(appName)) && !getMicroPathFromURL(appName)) {
        const app = appInstanceMap.get(appName)!
        attachRouteToBrowserURL(
          appName,
          setMicroPathToURL(appName, app.sandBox.proxyWindow.location),
          setMicroState(appName, getMicroState(appName), app.sandBox.proxyWindow.location),
        )
      }

      if (isRouterModeCustom(appName) && !getMicroRouterInfoState(appName)) {
        nativeHistoryNavigate(
          appName,
          'replaceState',
          rawWindow.location.href,
          setMicroState(appName)
        )
      }

      // 曾计划在自定义与 search 模式下主动触发子应用响应，但卸载/恢复的异步边界尚无稳定顺序。
      /**
         * 若 History 写入后立即通知，异步卸载中的子应用可能先跳到不属于自己的地址，造成 404 或反改
         * 浏览器 URL；若用 setTimeout 延迟，keep-alive 应用又可能在恢复渲染后才收到旧事件并丢状态。
         * 同页多应用及 Vue 3 导航前的 replace 还会扩大顺序歧义，因此当前代码只修复路由记录，不在
         * 此处主动向子应用派发事件。
         */

      // }
    })

    // 嵌套应用的上层 History 包装可能留下 DOM 作用域；返回基座前统一清除。
    removeDomScope()
  }
}

/**
 * 为宿主 History 安装路由状态保全补丁。
 *
 * @remarks
 * 基座框架响应 popstate 后可能用新 state 在同一路径执行 `replaceState`；包装两个写入方法可保留
 * `__MICRO_APP_STATE__` 并在基座导航后补齐活动应用记录。补丁应在首个沙箱启动时安装，由最后一个
 * 沙箱停止流程调用 `releasePatchHistory` 恢复。
 */
export function patchHistory (): void {
  const rawWindow = globalEnv.rawWindow
  rawWindow.history.pushState = reWriteHistoryMethod(
    globalEnv.rawPushState,
  )
  rawWindow.history.replaceState = reWriteHistoryMethod(
    globalEnv.rawReplaceState,
  )
}

/**
 * 恢复初始化时保存的原始宿主 History 方法，解除全局路由补丁与其闭包引用。
 */
export function releasePatchHistory (): void {
  const rawWindow = globalEnv.rawWindow
  rawWindow.history.pushState = globalEnv.rawPushState
  rawWindow.history.replaceState = globalEnv.rawReplaceState
}
