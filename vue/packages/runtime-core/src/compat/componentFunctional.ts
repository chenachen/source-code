import {
  type ComponentOptions,
  type FunctionalComponent,
  getCurrentInstance,
} from '../component'
import { resolveInjections } from '../componentOptions'
import type { InternalSlots } from '../componentSlots'
import { getCompatListeners } from './instanceListeners'
import { compatH } from './renderFn'

/** 按 Vue 2 选项对象缓存转换后的函数组件，确保组件 type 引用稳定。 */
const normalizedFunctionalComponentMap = new WeakMap<
  ComponentOptions,
  FunctionalComponent
>()
/**
 * Vue 2 `ctx.slots()` 返回“调用后内容”对象，而 Vue 3 slots 属性是函数；此代理在读取
 * 每个 slot 时立即执行，复现旧访问方式。
 */
export const legacySlotProxyHandlers: ProxyHandler<InternalSlots> = {
  get(target, key: string) {
    const slot = target[key]
    return slot && slot()
  },
}

/**
 * 把 Vue 2 `functional: true` 组件包装为 Vue 3 FunctionalComponent。
 * 包装器构造旧版 render context（children/data/scopedSlots/listeners/injections），并把
 * 兼容版 `h` 作为第一个参数传给旧 render 函数。
 */
export function convertLegacyFunctionalComponent(
  comp: ComponentOptions,
): FunctionalComponent {
  if (normalizedFunctionalComponentMap.has(comp)) {
    return normalizedFunctionalComponentMap.get(comp)!
  }

  const legacyFn = comp.render as any

  const Func: FunctionalComponent = (props, ctx) => {
    const instance = getCurrentInstance()!

    const legacyCtx = {
      props,
      children: instance.vnode.children || [],
      data: instance.vnode.props || {},
      scopedSlots: ctx.slots,
      parent: instance.parent && instance.parent.proxy,
      slots() {
        return new Proxy(ctx.slots, legacySlotProxyHandlers)
      },
      get listeners() {
        return getCompatListeners(instance)
      },
      get injections() {
        if (comp.inject) {
          const injections = {}
          resolveInjections(comp.inject, injections)
          return injections
        }
        return {}
      },
    }
    return legacyFn(compatH, legacyCtx)
  }
  Func.props = comp.props
  Func.displayName = comp.name
  Func.compatConfig = comp.compatConfig
  // Vue 2 函数组件不会像 Vue 3 那样自动把未声明 attrs 透传到根节点。
  Func.inheritAttrs = false

  normalizedFunctionalComponentMap.set(comp, Func)
  return Func
}
