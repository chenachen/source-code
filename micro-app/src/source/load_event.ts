import { isFunction } from '../libs/utils'

/**
 * 为人工创建的资源事件补上指向原元素的目标属性。
 *
 * `CustomEvent` 默认目标由 `dispatchEvent()` 决定，而直接调用 `onload/onerror` 时没有
 * 分发阶段；三个 getter 让两条通知路径都观察到同一资源元素。
 */
function eventHandler (event: Event, element: HTMLLinkElement | HTMLScriptElement): void {
  Object.defineProperties(event, {
    currentTarget: {
      /** 返回当前执行资源处理器的元素。 */
      get () {
        return element
      }
    },
    srcElement: {
      /** 提供旧式事件 API 使用的资源元素别名。 */
      get () {
        return element
      }
    },
    target: {
      /** 返回触发加载或失败通知的资源元素。 */
      get () {
        return element
      }
    },
  })
}

/**
 * 向 link/script 元素发送加载成功通知。
 *
 * 属性处理器存在时直接调用，否则使用标准事件分发路径。两者是二选一：同一元素同时注册
 * onload 与 addEventListener('load') 时这里只调用 onload，不再通知事件监听器。
 */
export function dispatchOnLoadEvent (element: HTMLLinkElement | HTMLScriptElement): void {
  const event = new CustomEvent('load')
  eventHandler(event, element)
  if (isFunction(element.onload)) {
    element.onload!(event)
  } else {
    element.dispatchEvent(event)
  }
}

/**
 * 向 link/script 元素发送加载失败通知，通知策略与成功事件保持一致。
 */
export function dispatchOnErrorEvent (element: HTMLLinkElement | HTMLScriptElement): void {
  const event = new CustomEvent('error')
  eventHandler(event, element)
  if (isFunction(element.onerror)) {
    element.onerror!(event)
  } else {
    element.dispatchEvent(event)
  }
}
