import { isArray } from '@vue/shared'
import type { TestElement } from './nodeOps'

/**
 * 从测试元素事件表同步调用指定事件的处理器，payload 逐项作为参数传入。
 * 函数数组按原顺序调用；无事件表/处理器便返回。这里不模拟 DOM 冒泡、时间戳过滤或 stopImmediatePropagation。
 */
export function triggerEvent(
  el: TestElement,
  event: string,
  payload: any[] = [],
): void {
  const { eventListeners } = el
  if (eventListeners) {
    const listener = eventListeners[event]
    if (listener) {
      if (isArray(listener)) {
        for (let i = 0; i < listener.length; i++) {
          listener[i](...payload)
        }
      } else {
        listener(...payload)
      }
    }
  }
}
