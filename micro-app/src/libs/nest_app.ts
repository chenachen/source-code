import { AppManager } from '../app_manager'
import { getRootContainer } from '../libs/utils'

/**
 * 响应上层应用的 `unmount` 事件，逐个触发当前应用内部嵌套应用的断开流程。
 *
 * @remarks
 * 先移除自身监听，避免清理 DOM 时再次进入；非 UMD 环境随后清空共享实例表，UMD 环境则保留实例供再次挂载。
 */
function unmountNestedApp (): void {
  releaseUnmountOfNestedApp()

  AppManager.getInstance().getAll().forEach(app => {
    // @ts-ignore
    app.container && getRootContainer(app.container).disconnectedCallback()
  })

  !window.__MICRO_APP_UMD_MODE__ && AppManager.getInstance().clear()
}

/** 在子应用环境中移除已有卸载监听，保证重复初始化不会累积处理器。 */
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
 */
export function initEnvOfNestedApp (): void {
  if (window.__MICRO_APP_ENVIRONMENT__) {
    releaseUnmountOfNestedApp()
    window.addEventListener('unmount', unmountNestedApp, false)
  }
}
