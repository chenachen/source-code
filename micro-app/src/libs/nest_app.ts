import { AppManager } from '../app_manager'
import { getRootContainer } from '../libs/utils'

/**
 * 响应上层应用的 `unmount` 事件，逐个触发当前应用内部嵌套应用的断开流程。
 *
 * @remarks
 * 先移除自身监听，避免清理 DOM 时再次进入；非 UMD 环境随后清空共享实例表，UMD 环境则保留实例供再次挂载。
 * 只遍历本 bundle 的 Map，且有 container 才能取宿主并调用 disconnectedCallback；
 * 后者仍自行选择 keep-alive 隐藏或普通卸载。本函数不等待内层 UMD Promise，清表只移除索引。
 */
function unmountNestedApp (): void {
  releaseUnmountOfNestedApp()

  AppManager.getInstance().getAll().forEach(app => {
    // @ts-ignore
    app.container && getRootContainer(app.container).disconnectedCallback()
  })

  !window.__MICRO_APP_UMD_MODE__ && AppManager.getInstance().clear()
}

/** 在子应用代理 window 上移除本函数引用；主应用环境无上层 unmount，直接跳过。 */
function releaseUnmountOfNestedApp (): void {
  if (window.__MICRO_APP_ENVIRONMENT__) {
    window.removeEventListener('unmount', unmountNestedApp, false)
  }
}

/**
 * 当基座本身运行在另一个 micro-app 中时，注册嵌套应用级联卸载监听。
 *
 * @remarks
 * 沙箱向子应用 window 派发 `unmount` 时会触发清理；注册前先释放旧监听，使本函数可重复调用。
 * With 沙箱首个 start 调用此入口，监听上层子应用窗口；普通基座没有环境标记，不建立级联。
 */
export function initEnvOfNestedApp (): void {
  if (window.__MICRO_APP_ENVIRONMENT__) {
    releaseUnmountOfNestedApp()
    window.addEventListener('unmount', unmountNestedApp, false)
  }
}
