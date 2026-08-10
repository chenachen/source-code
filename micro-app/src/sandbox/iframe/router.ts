import type {
  microAppWindowType,
  MicroLocation,
} from '@micro-app/types'
import {
  createMicroLocation,
  updateMicroLocation,
} from '../router/location'
import {
  createMicroHistory,
} from '../router/history'
import {
  assign,
  createURL,
  rawDefineProperties,
} from '../../libs/utils'
import globalEnv from '../../libs/global_env'

/**
 * 为 iframe realm 安装微应用 history，并创建映射子应用来源的 location 代理。
 *
 * @remarks
 * iframe 的真实地址用于建立同源空壳，不能直接代表子应用路由。这里先保存原生 `replaceState`，再把 history 方法替换为微路由实现；随后以 `prevent` 模式初始化 iframe location，最后返回供 window 代理暴露的 location。
 *
 * @param appName - 路由所属应用名。
 * @param url - 子应用入口地址。
 * @param microAppWindow - iframe 自身的 window realm。
 * @param browserHost - 基座协议与主机，用于在读取 href 时替换来源。
 */
export function patchRouter (
  appName: string,
  url: string,
  microAppWindow: microAppWindowType,
  browserHost: string,
): MicroLocation {
  const rawHistory = globalEnv.rawWindow.history
  const childStaticLocation = createURL(url)
  const childHost = childStaticLocation.protocol + '//' + childStaticLocation.host
  const childFullPath = childStaticLocation.pathname + childStaticLocation.search + childStaticLocation.hash

  // 保存 iframe realm 的 history 对象；子应用持有的引用不能替换，只能原地改写方法。
  const microHistory = microAppWindow.history
  // `updateMicroLocation` 需要绕过已改写方法，直接更新 iframe 的真实地址快照。
  microAppWindow.rawReplaceState = microHistory.replaceState
  // 把 pushState/replaceState 等微路由方法合并到原对象，保持对象身份不变。
  assign(microHistory, createMicroHistory(appName, microAppWindow.location))
  // 滚动恢复属于浏览器级历史状态，始终桥接到基座 history。
  rawDefineProperties(microHistory, {
    scrollRestoration: {
      configurable: true,
      enumerable: true,
      /** 读取基座 history 的滚动恢复策略。 */
      get () {
        return rawHistory.scrollRestoration
      },
      /** 把滚动恢复策略写回基座 history。 */
      set (value: string) {
        rawHistory.scrollRestoration = value
      }
    }
  })

  /**
   * 必须在 history 补丁完成后、`sandbox.start()` 前初始化 iframe location。
   * `prevent` 只同步内部地址，不触发守卫；启动阶段随后再把路由信息同步到浏览器 URL。
   */
  updateMicroLocation(
    appName,
    childFullPath,
    microAppWindow.location,
    'prevent'
  )

  // 代理读取时把 iframe 的基座来源还原为子应用来源，写入时交给统一微路由逻辑。
  return createMicroLocation(
    appName,
    url,
    microAppWindow,
    childStaticLocation,
    browserHost,
    childHost,
  )
}
