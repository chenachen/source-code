import type {
  MicroRouter,
  MicroLocation,
} from '@micro-app/types'
import globalEnv from '../../libs/global_env'
import {
  getMicroPathFromURL,
  setMicroPathToURL,
  removeMicroPathFromURL,
  removeMicroState,
  setMicroState,
  isRouterModeCustom,
  isRouterModePure,
} from './core'
import {
  createMicroLocation,
  updateMicroLocation,
  autoTriggerNavigationGuard,
} from './location'
import {
  createMicroHistory,
  attachRouteToBrowserURL,
} from './history'
import {
  createURL,
} from '../../libs/utils'
import {
  clearRouterWhenUnmount,
} from './api'
export {
  router,
} from './api'
export {
  addHistoryListener,
} from './event'
export {
  getNoHashMicroPathFromURL,
  initRouterMode,
  isRouterModeCustom,
  isRouterModeSearch,
} from './core'
export {
  patchHistory,
  releasePatchHistory,
} from './history'

/**
 * 为微应用创建成对的 `location` 与 `history` 路由门面。
 *
 * @remarks
 * 路由读取统一经过 `microLocation`，写入则由 `microHistory` 与 `microLocation` 协作；两者共享同一
 * location 对象，保证一次导航后的内存地址、浏览器 URL 与 `history.state` 可按路由模式同步。
 *
 * @param appName - 路由所属的微应用名称。
 * @param url - 微应用入口地址，用于初始化 location 的 origin 与默认路径。
 * @returns 供沙箱注入的微应用路由对象。
 */
export function createMicroRouter (appName: string, url: string): MicroRouter {
  const microLocation = createMicroLocation(appName, url)
  return {
    microLocation,
    microHistory: createMicroHistory(appName, microLocation),
  }
}

/**
 * 在沙箱启动或 keep-alive 应用重新显示时，恢复微应用路由与浏览器地址的对应关系。
 *
 * @remarks
 * 若浏览器已携带该应用路径，则以浏览器记录恢复内存 location；`pure` 模式只借该记录完成一次恢复，
 * 随后立即移除外部路径。若没有记录，则反向把当前或默认 location 写入浏览器。此二选一规则避免旧的
 * 浏览器状态被应用初始地址覆盖。
 *
 * @param appName - 待初始化的微应用名称。
 * @param microLocation - 沙箱持有且需要原地更新的 location 对象。
 * @param defaultPage - 可选的首次展示页，只有浏览器没有既存路径时生效。
 */
export function initRouteStateWithURL (
  appName: string,
  microLocation: MicroLocation,
  defaultPage?: string,
): void {
  const microPath = getMicroPathFromURL(appName)
  if (microPath) {
    updateMicroLocation(appName, microPath, microLocation, 'auto')
    if (isRouterModePure(appName)) {
      removePathFromBrowser(appName)
    }
  } else {
    updateBrowserURLWithLocation(appName, microLocation, defaultPage)
  }
}

/**
 * 按当前微应用 location 初始化浏览器 URL 与路由状态。
 *
 * @remarks
 * 用于沙箱启动和 keep-alive 应用重新显示。默认页先以 `prevent` 模式更新内存 location；非 `pure`
 * 模式随后原子写入路径与应用级 state。地址完成后才触发导航守卫，使守卫读取到的是已提交的新状态。
 *
 * @param appName - 待同步的微应用名称。
 * @param microLocation - 作为浏览器路由信息来源的 location 对象。
 * @param defaultPage - 可选的首次展示页。
 */
export function updateBrowserURLWithLocation (
  appName: string,
  microLocation: MicroLocation,
  defaultPage?: string,
): void {
  // 默认页只改内存状态，随后再与浏览器地址合并，避免产生中间 history 记录。
  if (defaultPage) updateMicroLocation(appName, defaultPage, microLocation, 'prevent')
  if (!isRouterModePure(appName)) {
    // `pure` 模式刻意不暴露路由；其余模式同时附加路径和应用级 state，保持两者同次提交。
    attachRouteToBrowserURL(
      appName,
      setMicroPathToURL(appName, microLocation),
      setMicroState(appName, null, microLocation),
    )
  }
  // 守卫在 URL 和 location 更新完成后运行；该机制用于通知，不提供回滚或取消当前写入的协议。
  autoTriggerNavigationGuard(appName, microLocation)
}

/**
 * 在应用停止或隐藏时清理浏览器中的路径与 state，并按配置决定是否重置内存 location。
 *
 * @remarks
 * `keepRouteState` 只保护微应用内部 location；非 `pure` 模式写入浏览器的路由信息仍会移除，防止已
 * 隐藏应用继续占用基座地址。自定义原生路由模式使用浏览器路径，不由这里重置为入口地址。
 *
 * @param appName - 待清理的微应用名称。
 * @param url - 微应用入口地址，作为未保留状态时的重置目标。
 * @param microLocation - 沙箱当前持有的 location 对象。
 * @param keepRouteState - 是否保留微应用内部 location，默认由上游解析为 `false`。
 */
export function clearRouteStateFromURL (
  appName: string,
  url: string,
  microLocation: MicroLocation,
  keepRouteState: boolean,
): void {
  // TODO：评估 `keep-router-state` 是否需要更高优先级或移除；当前它不保护浏览器侧路由记录。
  if (!keepRouteState && !isRouterModeCustom(appName)) {
    const { pathname, search, hash } = createURL(url)
    updateMicroLocation(appName, pathname + search + hash, microLocation, 'prevent')
  }
  if (!isRouterModePure(appName)) {
    removePathFromBrowser(appName)
  }

  clearRouterWhenUnmount(appName)
}

/**
 * 从浏览器 URL 与 `history.state` 同时移除指定应用的路由信息。
 *
 * @remarks
 * 沙箱停止或 keep-alive 应用隐藏时调用。通过一次 `replaceState` 式附加操作提交清理结果，不新增历史
 * 条目；其他应用及基座自己的 state 由底层合并函数保留。
 *
 * @param appName - 待从浏览器路由记录中移除的微应用名称。
 */
export function removePathFromBrowser (appName: string): void {
  attachRouteToBrowserURL(
    appName,
    removeMicroPathFromURL(appName),
    removeMicroState(appName, globalEnv.rawWindow.history.state),
  )
}
