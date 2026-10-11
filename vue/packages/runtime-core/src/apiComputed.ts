import { type ComputedRefImpl, computed as _computed } from '@vue/reactivity'
import { getCurrentInstance, isInSSRComponentSetup } from './component'

/**
 * 运行时核心层对响应式 computed 的封装，公开签名与 @vue/reactivity 一致。
 *
 * 将 isInSSRComponentSetup 传给底层实例：SSR 仍复用全局版本缓存，只跳过逐依赖版本/无依赖快路径，并且不安装调试钩子。开发环境还将应用 warnRecursiveComputed 配置写入 _warnRecursive；本版响应式实现未消费该字段发出警告。返回尚未求值的 computed ref。
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
