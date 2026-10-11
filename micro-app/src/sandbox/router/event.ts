import type {
  MicroLocation,
  PopStateListener,
  MicroPopStateEvent,
  microAppWindowType,
} from '@micro-app/types'
import {
  appInstanceMap,
  isIframeSandbox,
} from '../../create_app'
import {
  getActiveApps,
} from '../../micro_app'
import {
  getMicroPathFromURL,
  getMicroState,
  getMicroRouterInfoState,
  isEffectiveApp,
  isRouterModeCustom,
} from './core'
import {
  updateMicroLocation,
} from './location'
import {
  removeDomScope,
  isFunction,
  macro,
  getRootContainer,
} from '../../libs/utils'
import globalEnv from '../../libs/global_env'

/**
 * 为微应用订阅宿主 `popstate`，并把有效导航异步转发到子应用。
 *
 * @remarks
 * 沙箱启动时注册、停止时由返回函数释放。隐藏、预渲染应用以及标记为 `onlyForBrowser` 的事件不会
 * 下发。转发使用容器配置的宏任务延迟，让可能异步卸载/切页的基座先响应浏览器导航，避免子应用过早
 * 修改地址或进入已不属于它的页面。此延迟只提供时间窗口，不等待基座异步导航完成；过滤条件在
 * 收到事件时检查，定时器执行时再读取当前宿主 URL，而不是保存本次事件对应的路径；返回的清理
 * 函数只移除监听器，不取消已登记的定时器。
 *
 * @param appName - 订阅宿主历史事件的微应用名称。
 * @returns 移除本次宿主事件监听器的清理函数。
 */
export function addHistoryListener (appName: string): CallableFunction {
  const rawWindow = globalEnv.rawWindow
  /**
   * 过滤宿主历史事件，并在可配置的宏任务边界后更新子应用 location 与派发事件。
   */
  const popStateHandler: PopStateListener = (e: MicroPopStateEvent): void => {
    // 已卸载、隐藏或预渲染应用不接收导航；`onlyForBrowser` 用于明确阻断事件回流子应用。
    if (
      getActiveApps({
        excludeHiddenApp: true,
        excludePreRender: true,
      }).includes(appName) &&
      !e.onlyForBrowser
    ) {
      /**
       * 基座处理返回/前进时可能先懒加载页面，而 Vue 2、React 等子应用通常同步响应 popstate。这里用
       * `router-event-delay` 把子应用响应移到宏任务，给基座完成切页或卸载的窗口。该边界覆盖浏览器
       * 前进/后退，以及 micro-app 为部分 location/History 写入合成的 popstate。原生 pushState/
       * replaceState 本身不产生 popstate。
       *
       * 自定义原生模式还要求当前 history 无 state，或 state 中存在本应用快照才下发，避免把纯基座
       * 页面事件误送给子应用。React 16 hash 模式可能长期保持空 state，因此空值仍允许通过；同页多个
       * 原生子应用共享路径时，仍可能各自用不同快照恢复同一宿主地址。
       */
      if (
        !isRouterModeCustom(appName) ||
        !globalEnv.rawWindow.history.state ||
        getMicroRouterInfoState(appName)
      ) {
        const container = appInstanceMap.get(appName)?.container
        macro(
          () => updateMicroLocationWithEvent(appName, getMicroPathFromURL(appName)),
          (container && getRootContainer(container))?.getRouterEventDelay() ?? 0
        )
      }
    }
  }

  rawWindow.addEventListener('popstate', popStateHandler)

  // 清理函数闭包持有同一 handler 引用，确保沙箱停止时能精确解除而不影响其他应用监听器。
  return () => {
    rawWindow.removeEventListener('popstate', popStateHandler)
  }
}

/**
 * 用宿主导航结果更新微应用 location，并依次派发标准 popstate 与可选 hashchange。
 *
 * @remarks
 * 先保存旧 href，再更新 location，因此 hashchange 能获得正确的新旧 URL。popstate 始终先派发；仅当
 * hash 实际变化时再派发 hashchange。处理完一个应用后清除 DOM 作用域，避免下一个应用事件沿用前一
 * 个应用的节点查询上下文。空目标路径不改 location，但仍通知子应用读取当前 state。
 * 本函数仅检查实例仍有 sandBox，不复查 active/隐藏状态；已排宏任务可能在 stop 后进入这里。
 * location 更新或手调 onpopstate/onhashchange 抛错会打断剩余步骤，末尾作用域清理没有 finally 保证。
 *
 * @param appName - 接收导航的微应用名称。
 * @param targetFullPath - 从宿主路由恢复的目标完整路径；为空时仅派发状态事件。
 */
export function updateMicroLocationWithEvent (
  appName: string,
  targetFullPath: string | null,
): void {
  const app = appInstanceMap.get(appName)
  if (app?.sandBox) {
    const proxyWindow = app.sandBox.proxyWindow
    const microAppWindow = app.sandBox.microAppWindow
    let isHashChange = false
    // 在任何 location 更新前捕获旧地址，供后续 hashchange 事件使用。
    const oldHref = proxyWindow.location.href
    // 空路径表示浏览器没有应用路由记录，此时不把空值写回微应用 location。
    if (targetFullPath) {
      const oldHash = proxyWindow.location.hash
      updateMicroLocation(appName, targetFullPath, microAppWindow.location as MicroLocation)
      isHashChange = proxyWindow.location.hash !== oldHash
    }

    // popstate 先通知通用路由监听器；hashchange 是对 hash 差异的追加通知。
    dispatchPopStateEventToMicroApp(appName, proxyWindow, microAppWindow)

    // 只有更新确实改变 hash 时才构造 hashchange，避免重复触发框架路由。
    if (isHashChange) dispatchHashChangeEventToMicroApp(appName, proxyWindow, microAppWindow, oldHref)

    // 事件回调可能建立 DOM 作用域；离开当前应用前必须清除，防止跨应用串扰。
    removeDomScope()
  }
}

/**
 * 为微应用构造携带其独立 state 的标准 `popstate` 事件并派发。
 *
 * @remarks
 * iframe 依赖自身事件系统处理 `onpopstate`；with 沙箱的代理属性不是浏览器原生监听器，因此派发到
 * microAppWindow 后还需显式调用 `proxyWindow.onpopstate`。
 *
 * @param appName - state 所属的微应用名称。
 * @param proxyWindow - 沙箱对外暴露的窗口代理。
 * @param microAppWindow - 实际承载子应用事件监听器的窗口对象。
 */
export function dispatchPopStateEventToMicroApp (
  appName: string,
  proxyWindow: WindowProxy,
  microAppWindow: microAppWindowType,
): void {
  // 保留标准 popstate 名称，应用隔离由派发目标承担。state 只读应用条目；缺少条目时为 null，
  // 原生模式也不会退回基座业务 state。
  const newPopStateEvent = new PopStateEvent(
    'popstate',
    { state: getMicroState(appName) }
  )

  microAppWindow.dispatchEvent(newPopStateEvent)

  if (!isIframeSandbox(appName)) {
    // with 沙箱需手动补调代理窗口上的属性式事件处理器。
    isFunction(proxyWindow.onpopstate) && proxyWindow.onpopstate(newPopStateEvent)
  }
}

/**
 * 为微应用构造带正确新旧 URL 的标准 `hashchange` 事件并派发。
 *
 * @param appName - 接收事件的微应用名称。
 * @param proxyWindow - 提供导航后新地址的沙箱窗口代理。
 * @param microAppWindow - 实际承载子应用事件监听器的窗口对象。
 * @param oldHref - location 更新前的微应用完整地址。
 */
export function dispatchHashChangeEventToMicroApp (
  appName: string,
  proxyWindow: WindowProxy,
  microAppWindow: microAppWindowType,
  oldHref: string,
): void {
  const newHashChangeEvent = new HashChangeEvent(
    'hashchange',
    {
      newURL: proxyWindow.location.href,
      oldURL: oldHref,
    }
  )

  microAppWindow.dispatchEvent(newHashChangeEvent)

  if (!isIframeSandbox(appName)) {
    // with 沙箱需手动补调代理窗口上的属性式事件处理器。
    isFunction(proxyWindow.onhashchange) && proxyWindow.onhashchange(newHashChangeEvent)
  }
}

/**
 * 在宿主窗口派发模拟 location 导航的原生 `popstate` 事件。
 *
 * @param onlyForBrowser - 是否标记事件仅供基座消费，阻止微应用监听器再次下发形成回环。
 */
function dispatchNativePopStateEvent (onlyForBrowser: boolean): void {
  const event = new PopStateEvent('popstate', { state: null }) as MicroPopStateEvent
  if (onlyForBrowser) event.onlyForBrowser = true
  globalEnv.rawWindow.dispatchEvent(event)
}

/**
 * 在宿主窗口派发带真实新旧地址的 `hashchange` 事件。
 *
 * @param oldHref - 宿主导航前的完整地址。
 */
function dispatchNativeHashChangeEvent (oldHref: string): void {
  const newHashChangeEvent = new HashChangeEvent(
    'hashchange',
    {
      newURL: globalEnv.rawWindow.location.href,
      oldURL: oldHref,
    }
  )

  globalEnv.rawWindow.dispatchEvent(newHashChangeEvent)
}

/**
 * 在有效应用完成地址提交后，向宿主派发 popstate 及可选 hashchange。
 *
 * @remarks
 * 派发前清除 DOM 作用域，保证基座事件处理器访问真实文档。应用不存在或仍处于预加载阶段时不产生
 * 全局副作用。是否追加 hashchange 由调用方传入 oldHref 决定，此函数不重新比较 hash。
 *
 * @param appName - 发起导航的微应用名称，用于有效性校验。
 * @param onlyForBrowser - 是否让 popstate 仅供基座消费。
 * @param oldHref - 可选的宿主导航前完整地址；存在时追加派发 hashchange。
 */
export function dispatchNativeEvent (
  appName: string,
  onlyForBrowser: boolean,
  oldHref?: string,
): void {
  // 全局事件必须在宿主 DOM 上下文执行，不能继承微应用元素作用域。
  removeDomScope()
  if (isEffectiveApp(appName)) {
    dispatchNativePopStateEvent(onlyForBrowser)
    if (oldHref) {
      dispatchNativeHashChangeEvent(oldHref)
    }
  }
}
