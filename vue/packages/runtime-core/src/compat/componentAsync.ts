import { isArray, isObject, isPromise } from '@vue/shared'
import { defineAsyncComponent } from '../apiAsyncComponent'
import type { Component } from '../component'
import { isVNode } from '../vnode'

/** Vue 2 高级异步组件工厂返回的选项对象。 */
interface LegacyAsyncOptions {
  /**
   * 旧工厂返回的组件 Promise，转换为 Vue 3 loader 的结果。
   */
  component: Promise<Component>
  /**
   * 加载等待期间展示的组件。
   */
  loading?: Component
  /**
   * 加载失败或超时后展示的组件。
   */
  error?: Component
  /**
   * 展示 loading 前的等待毫秒数，透传给 defineAsyncComponent。
   */
  delay?: number
  /**
   * 判定超时的毫秒数，透传给 defineAsyncComponent。
   */
  timeout?: number
}

/** Vue 2 异步工厂可直接返回 Promise，或返回含 loading/error/timeout 的选项。 */
type LegacyAsyncReturnValue = Promise<Component> | LegacyAsyncOptions

/**
 * Vue 2 异步组件函数签名：既允许返回值，也允许稍后调用 resolve/reject 回调。
 */
type LegacyAsyncComponent = (
  resolve?: (res: LegacyAsyncReturnValue) => void,
  reject?: (reason?: any) => void,
) => LegacyAsyncReturnValue | undefined

/** 按旧工厂函数身份缓存转换结果，防止每次 render 创建新的组件类型而反复卸载。 */
const normalizedAsyncComponentMap = new WeakMap<
  LegacyAsyncComponent,
  Component
>()

/**
 * 将 Vue 2 异步组件的三种返回协议转换为 Vue 3 `defineAsyncComponent()`。
 * 必须先实际调用旧工厂，因为它不会像 Vue 3 API 那样提前暴露 loader/options。
 */
export function convertLegacyAsyncComponent(
  comp: LegacyAsyncComponent,
): Component {
  if (normalizedAsyncComponentMap.has(comp)) {
    return normalizedAsyncComponentMap.get(comp)!
  }

  // Vue 2 工厂只有执行后才知道它采用 Promise、配置对象还是 resolve 回调协议。
  let resolve: (res: LegacyAsyncReturnValue) => void
  let reject: (reason?: any) => void
  const fallbackPromise = new Promise<Component>((r, rj) => {
    ;((resolve = r), (reject = rj))
  })

  const res = comp(resolve!, reject!)

  let converted: Component
  if (isPromise(res)) {
    converted = defineAsyncComponent(() => res)
  } else if (isObject(res) && !isVNode(res) && !isArray(res)) {
    converted = defineAsyncComponent({
      /**
       * 把旧高级异步选项中的 component Promise 交给 Vue 3 异步组件 loader；旧工厂已在外层执行，此闭包不再次调用工厂。
       */
      loader: () => res.component,
      loadingComponent: res.loading,
      errorComponent: res.error,
      delay: res.delay,
      timeout: res.timeout,
    })
  } else if (res == null) {
    // 无同步返回值表示旧工厂稍后调用 resolve/reject，使用预建 Promise 桥接。
    converted = defineAsyncComponent(() => fallbackPromise)
  } else {
    // 返回其他值更可能是合法 Vue 3 函数组件，不进行旧协议包装。
    converted = comp as any
  }
  normalizedAsyncComponentMap.set(comp, converted)
  return converted
}
