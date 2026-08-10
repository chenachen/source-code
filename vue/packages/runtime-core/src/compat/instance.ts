import {
  NOOP,
  extend,
  looseEqual,
  looseIndexOf,
  looseToNumber,
  toDisplayString,
} from '@vue/shared'
import type {
  ComponentPublicInstance,
  PublicPropertiesMap,
} from '../componentPublicInstance'
import { getCompatChildren } from './instanceChildren'
import {
  DeprecationTypes,
  assertCompatEnabled,
  isCompatEnabled,
  warnDeprecation,
} from './compatConfig'
import { off, on, once } from './instanceEventEmitter'
import { getCompatListeners } from './instanceListeners'
import { shallowReadonly } from '@vue/reactivity'
import { legacySlotProxyHandlers } from './componentFunctional'
import { compatH } from './renderFn'
import { createCommentVNode, createTextVNode } from '../vnode'
import { renderList } from '../helpers/renderList'
import {
  legacyBindDynamicKeys,
  legacyBindObjectListeners,
  legacyBindObjectProps,
  legacyCheckKeyCodes,
  legacyMarkOnce,
  legacyPrependModifier,
  legacyRenderSlot,
  legacyRenderStatic,
  legacyResolveScopedSlots,
} from './renderHelpers'
import { resolveFilter } from '../helpers/resolveAssets'
import type { Slots } from '../componentSlots'
import { resolveMergedOptions } from '../componentOptions'

/** 同时包含 Vue 3 公共实例与 Vue 2 兼容属性的实例类型。 */
export type LegacyPublicInstance = ComponentPublicInstance &
  LegacyPublicProperties

/** 兼容构建在公共代理上恢复的 Vue 2 实例 API。 */
export interface LegacyPublicProperties {
  /** @deprecated Proxy 响应式不再需要 `$set`，可直接赋值。 */
  $set<T extends Record<keyof any, any>, K extends keyof T>(
    target: T,
    key: K,
    value: T[K],
  ): void
  /** @deprecated Proxy 响应式不再需要 `$delete`，可直接 delete。 */
  $delete<T extends Record<keyof any, any>, K extends keyof T>(
    target: T,
    key: K,
  ): void
  /** @deprecated 根挂载请使用 `createApp().mount()`。 */
  $mount(el?: string | Element): this
  /** @deprecated 请使用 `app.unmount()` 或组件卸载生命周期。 */
  $destroy(): void
  /** @deprecated scoped slots 已统一到 `$slots`。 */
  $scopedSlots: Slots
  /** @deprecated 实例事件总线 API，建议使用外部 emitter。 */
  $on(event: string | string[], fn: Function): this
  $once(event: string, fn: Function): this
  $off(event?: string | string[], fn?: Function): this
  /** @deprecated Vue 3 不保证直接子组件列表，请使用模板 ref。 */
  $children: LegacyPublicProperties[]
  /** @deprecated 监听器已并入 `$attrs`。 */
  $listeners: Record<string, Function | Function[]>
}

/**
 * 把 Vue 2 公共实例属性安装进 Vue 3 `PublicPropertiesMap`。
 * 每个 getter 都在实际访问时检查 compatConfig；禁用旧行为的组件不会无条件承担兼容
 * 对象开销。文件后半还恢复编译后 Vue 2 render 函数依赖的 `_x` 私有 helper。
 */
export function installCompatInstanceProperties(
  map: PublicPropertiesMap,
): void {
  const set = (target: any, key: any, val: any) => {
    target[key] = val
    return target[key]
  }

  const del = (target: any, key: any) => {
    delete target[key]
  }

  extend(map, {
    $set: i => {
      assertCompatEnabled(DeprecationTypes.INSTANCE_SET, i)
      return set
    },

    $delete: i => {
      assertCompatEnabled(DeprecationTypes.INSTANCE_DELETE, i)
      return del
    },

    $mount: i => {
      assertCompatEnabled(
        DeprecationTypes.GLOBAL_MOUNT,
        null /* this warning is global */,
      )
      // 根实例会由 global.ts/installCompatMount 注入真正兼容挂载函数。
      return i.ctx._compat_mount || NOOP
    },

    $destroy: i => {
      assertCompatEnabled(DeprecationTypes.INSTANCE_DESTROY, i)
      // 根实例会由 global.ts/installCompatMount 注入真正兼容销毁函数。
      return i.ctx._compat_destroy || NOOP
    },

    // 覆盖现有 `$slots`：只有兼容 render 包装器需要“读取即执行”的 Vue 2 slot 代理。
    $slots: i => {
      if (
        isCompatEnabled(DeprecationTypes.RENDER_FUNCTION, i) &&
        i.render &&
        i.render._compatWrapped
      ) {
        return new Proxy(i.slots, legacySlotProxyHandlers)
      }
      return __DEV__ ? shallowReadonly(i.slots) : i.slots
    },

    $scopedSlots: i => {
      assertCompatEnabled(DeprecationTypes.INSTANCE_SCOPED_SLOTS, i)
      return __DEV__ ? shallowReadonly(i.slots) : i.slots
    },

    $on: i => on.bind(null, i),
    $once: i => once.bind(null, i),
    $off: i => off.bind(null, i),

    $children: getCompatChildren,
    $listeners: getCompatListeners,

    // 为 `$options` 补充 Vue 2 私有字段（例如旧 Vuex 读取 parent）。仅在 PRIVATE_APIS
    // 开启时克隆结果并安装惰性 getter，正常 Vue 3 路径直接返回合并选项。
    $options: i => {
      if (!isCompatEnabled(DeprecationTypes.PRIVATE_APIS, i)) {
        return resolveMergedOptions(i)
      }
      if (i.resolvedOptions) {
        return i.resolvedOptions
      }
      const res = (i.resolvedOptions = extend({}, resolveMergedOptions(i)))
      Object.defineProperties(res, {
        parent: {
          get() {
            warnDeprecation(DeprecationTypes.PRIVATE_APIS, i, '$options.parent')
            return i.proxy!.$parent
          },
        },
        propsData: {
          get() {
            warnDeprecation(
              DeprecationTypes.PRIVATE_APIS,
              i,
              '$options.propsData',
            )
            return i.vnode.props
          },
        },
      })
      return res
    },
  } as PublicPropertiesMap)

  /** Vue 2 编译器/生态库会读取的私有实例属性与 render helper。 */
  const privateAPIs = {
    // 多个旧库与手写 render 函数依赖的当前 VNode。
    $vnode: i => i.vnode,

    // 常被生态库读取的内部状态别名。
    _self: i => i.proxy,
    _uid: i => i.uid,
    _data: i => i.data,
    _isMounted: i => i.isMounted,
    _isDestroyed: i => i.isUnmounted,

    // Vue 2 模板编译代码使用的短 helper 名称。
    $createElement: () => compatH,
    _c: () => compatH,
    _o: () => legacyMarkOnce,
    _n: () => looseToNumber,
    _s: () => toDisplayString,
    _l: () => renderList,
    _t: i => legacyRenderSlot.bind(null, i),
    _q: () => looseEqual,
    _i: () => looseIndexOf,
    _m: i => legacyRenderStatic.bind(null, i),
    _f: () => resolveFilter,
    _k: i => legacyCheckKeyCodes.bind(null, i),
    _b: () => legacyBindObjectProps,
    _v: () => createTextVNode,
    _e: () => createCommentVNode,
    _u: () => legacyResolveScopedSlots,
    _g: () => legacyBindObjectListeners,
    _d: () => legacyBindDynamicKeys,
    _p: () => legacyPrependModifier,
  } as PublicPropertiesMap

  for (const key in privateAPIs) {
    map[key] = i => {
      if (isCompatEnabled(DeprecationTypes.PRIVATE_APIS, i)) {
        return privateAPIs[key](i)
      }
    }
  }
}
