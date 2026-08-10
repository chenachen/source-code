import { type ComputedRefImpl, computed as _computed } from '@vue/reactivity'
import { getCurrentInstance, isInSSRComponentSetup } from './component'

/**
 * 运行时核心层对响应式 `computed()` 的薄封装。
 *
 * 它把“当前是否处于 SSR 组件 setup”传给响应式层：SSR 单次渲染不需要客户端式的
 * 跨 effect 缓存语义。开发环境还会读取应用配置，把递归 computed 的诊断开关写入
 * 具体实现；公开签名仍与 `@vue/reactivity` 完全一致。
 */
export const computed: typeof _computed = (
  getterOrOptions: any,
  debugOptions?: any,
) => {
  // 第三个参数是 runtime-core 与响应式内部实现之间的私有参数，不属于公开重载签名。
  // @ts-expect-error
  const c = _computed(getterOrOptions, debugOptions, isInSSRComponentSetup)
  if (__DEV__) {
    const i = getCurrentInstance()
    if (i && i.appContext.config.warnRecursiveComputed) {
      ;(c as unknown as ComputedRefImpl<any>)._warnRecursive = true
    }
  }
  return c as any
}
