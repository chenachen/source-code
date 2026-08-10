import type { lifeCyclesType, AppInterface } from '@micro-app/types'
import microApp from '../micro_app'
import {
  logWarn,
  isFunction,
  removeDomScope,
  getRootContainer,
  assign,
  formatEventType,
} from '../libs/utils'

/**
 * 为全局生命周期钩子预设事件目标，使其与随后容器上的 DOM 监听器观察到同一元素。
 *
 * @remarks
 * 全局钩子在 `dispatchEvent()` 前执行，浏览器此时尚未填充 `target` 和 `currentTarget`，因此用只读 getter 映射到应用根容器。
 */
function formatEventInfo (event: CustomEvent, element: HTMLElement): void {
  Object.defineProperties(event, {
    currentTarget: {
      /** 返回承载当前应用的根容器。 */
      get () {
        return element
      }
    },
    target: {
      /** 返回承载当前应用的根容器。 */
      get () {
        return element
      }
    },
  })
}

/** 全局生命周期配置允许的事件名联合。 */
type LifecycleEventName = keyof lifeCyclesType

/**
 * 向基座全局钩子和应用根容器派发同一个生命周期事件。
 *
 * @remarks
 * ShadowRoot 会先归一化为其宿主元素。全局钩子先执行，随后在元素上派发给 DOM 监听器；容器不存在时仅记录警告。
 *
 * @param element - 应用容器或其 ShadowRoot。
 * @param appName - 当前应用名。
 * @param lifecycleName - 要派发的生命周期名。
 * @param error - 错误生命周期附带的异常。
 */
export default function dispatchLifecyclesEvent (
  element: HTMLElement | ShadowRoot | null,
  appName: string,
  lifecycleName: LifecycleEventName,
  error?: Error,
): void {
  if (!element) {
    return logWarn(`element does not exist in lifecycle ${lifecycleName}`, appName)
  }

  element = getRootContainer(element)

  // 生命周期属于基座观察面；清除 DOM 归属，尤其避免 mounted/unmount 回调污染子应用作用域。
  removeDomScope()

  const detail = assign({
    name: appName,
    container: element,
  }, error && {
    error
  })

  const event = new CustomEvent(lifecycleName, {
    detail,
  })

  formatEventInfo(event, element)
  // 全局配置钩子先观察事件，随后同一事件对象再派发到应用元素。
  if (isFunction(microApp.options.lifeCycles?.[lifecycleName])) {
    microApp.options.lifeCycles![lifecycleName]!(event, appName)
  }

  element.dispatchEvent(event)
}

/**
 * 向子应用代理 window 派发框架内部状态事件。
 *
 * @remarks
 * `mounted`、`unmount` 在 with 沙箱中会附加应用名，避免与元素生命周期同名事件冲突；沙箱尚未创建时安全跳过。
 *
 * @param app - 目标应用实例。
 * @param eventName - mounted、unmount、appstate-change 或 statechange 等事件名。
 * @param detail - 传递给子应用的事件详情。
 */
export function dispatchCustomEventToMicroApp (
  app: AppInterface,
  eventName: string,
  detail: Record<string, any> = {},
): void {
  const event = new CustomEvent(formatEventType(eventName, app.name), {
    detail,
  })

  app.sandBox?.microAppWindow.dispatchEvent(event)
}
