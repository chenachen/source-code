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
  /** 登记实例事件的一次性监听；包装器在调用用户函数之前注销，防止事件重入重复执行。 */
  $once(event: string, fn: Function): this
  /** 无参数清空事件表；指定事件清整组，指定 fn 同时匹配原函数与 once 包装器。 */
  $off(event?: string | string[], fn?: Function): this
  /** @deprecated Vue 3 不保证直接子组件列表，请使用模板 ref。 */
  $children: LegacyPublicProperties[]
  /** @deprecated 监听器已并入 `$attrs`。 */
  $listeners: Record<string, Function | Function[]>
}

/**
 * 把 Vue 2 公共实例属性安装进 Vue 3 `PublicPropertiesMap`。
 * 兼容 API 在读取或调用时检查配置：$set 等读取即检查；$on/$once/$off 先返回绑定
 * 函数，实际调用时再检查。文件后半安装编译后 Vue 2 render 所需的 `_x` 私有 helper。
 */
export function installCompatInstanceProperties(
  map: PublicPropertiesMap,
): void {
  /** 兼容 $set 的赋值适配器；直接写入目标并返回写入后的值，由 Proxy 自行触发响应式。 */
  const set = (target: any, key: any, val: any) => {
    target[key] = val
    return target[key]
  }

  /** 兼容 $delete 的删除适配器；直接 delete，由响应式 Proxy 处理通知。 */
  const del = (target: any, key: any) => {
    delete target[key]
  }

  extend(map, {
    /** 检查实例 SET 兼容开关并返回直接赋值适配器。 */
    $set: i => {
      assertCompatEnabled(DeprecationTypes.INSTANCE_SET, i)
      return set
    },

    /** 检查实例 DELETE 开关并返回直接删除适配器。 */
    $delete: i => {
      assertCompatEnabled(DeprecationTypes.INSTANCE_DELETE, i)
      return del
    },

    /** 检查旧根挂载 API 并读取 ctx 中安装的 $mount；缺失时返回 NOOP。 */
    $mount: i => {
      assertCompatEnabled(
        DeprecationTypes.GLOBAL_MOUNT,
        null /* 以全局上下文检查并报告弃用。 */,
      )
      // 根实例会由 global.ts/installCompatMount 注入真正兼容挂载函数。
      return i.ctx._compat_mount || NOOP
    },

    /** 检查旧 destroy API 并读取 ctx 中的清理闭包；缺失时返回 NOOP。 */
    $destroy: i => {
      assertCompatEnabled(DeprecationTypes.INSTANCE_DESTROY, i)
      // 根实例会由 global.ts/installCompatMount 注入真正兼容销毁函数。
      return i.ctx._compat_destroy || NOOP
    },

    // 覆盖现有 `$slots`：只有兼容 render 包装器需要“读取即执行”的 Vue 2 slot 代理。
    /** 兼容 render 包装器读取执行式旧 slot 代理，普通路径返回当前 slots（开发态浅只读）。 */
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

    /** 检查旧 scopedSlots 开关，返回 Vue 3 函数插槽表，开发态加浅只读包装。 */
    $scopedSlots: i => {
      assertCompatEnabled(DeprecationTypes.INSTANCE_SCOPED_SLOTS, i)
      return __DEV__ ? shallowReadonly(i.slots) : i.slots
    },

    /** 把事件登记入口绑定到当前内部实例，实际调用时再检查兼容配置。 */
    $on: i => on.bind(null, i),
    /** 把一次性事件入口绑定当前内部实例，包装器负责先注销再调用。 */
    $once: i => once.bind(null, i),
    /** 把事件移除入口绑定当前内部实例，支持整表、整事件和单回调删除。 */
    $off: i => off.bind(null, i),

    $children: getCompatChildren,
    $listeners: getCompatListeners,

    // 为 `$options` 补充 Vue 2 私有字段（例如旧 Vuex 读取 parent）。仅在 PRIVATE_APIS
    // 开启时克隆结果并安装惰性 getter，正常 Vue 3 路径直接返回合并选项。
    /** 缓存合并选项的兼容副本，并按需安装 parent/propsData 的惰性访问器。 */
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
          /** 惰性读取当前公开父实例并提示旧 $options.parent 私有 API。 */
          get() {
            warnDeprecation(DeprecationTypes.PRIVATE_APIS, i, '$options.parent')
            return i.proxy!.$parent
          },
        },
        propsData: {
          /** 惰性返回当前 VNode 的原始 props，避免缓存的 $options 对象保存过期 propsData。 */
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
    /** 取得当前组件 VNode，供旧 render/插件读取。 */
    $vnode: i => i.vnode,

    // 常被生态库读取的内部状态别名。
    /** 取得当前公开 proxy，复用 Vue 3 的字段解析。 */
    _self: i => i.proxy,
    /** 读取实例创建时的 uid，不分配新编号。 */
    _uid: i => i.uid,
    /** 返回该实例的响应式 data 对象。 */
    _data: i => i.data,
    /** 转发首次提交标记，卸载不会把该值重置为 false。 */
    _isMounted: i => i.isMounted,
    /** 转发 post 阶段设置的 isUnmounted，而不是检查 DOM 是否已移除。 */
    _isDestroyed: i => i.isUnmounted,

    // Vue 2 模板编译代码使用的短 helper 名称。
    /** 返回旧 h 适配器，保留 Vue 2 data/slot 结构。 */
    $createElement: () => compatH,
    /** 返回 Vue 2 编译 render 使用的兼容 h。 */
    _c: () => compatH,
    /** 返回旧 v-once helper，当前实现原样返回树。 */
    _o: () => legacyMarkOnce,
    /** 返回宽松数字转换 helper，转换失败时保留原输入。 */
    _n: () => looseToNumber,
    /** 返回模板插值的显示字符串转换函数。 */
    _s: () => toDisplayString,
    /** 返回支持数组、范围和对象等输入的 v-for helper。 */
    _l: () => renderList,
    /** 绑定当前实例到旧 slot helper，使其能读取该实例 slots。 */
    _t: i => legacyRenderSlot.bind(null, i),
    /** 返回模板表单值使用的宽松深比较函数。 */
    _q: () => looseEqual,
    /** 返回数组中宽松相等元素的索引查询。 */
    _i: () => looseIndexOf,
    /** 绑定当前实例到旧静态 render 缓存入口。 */
    _m: i => legacyRenderStatic.bind(null, i),
    /** 返回在当前实例上下文解析旧过滤器的入口。 */
    _f: () => resolveFilter,
    /** 绑定当前实例配置到旧 keyCode 修饰符判断。 */
    _k: i => legacyCheckKeyCodes.bind(null, i),
    /** 返回旧 data 对象绑定合并器，保留其 .sync 写回规则。 */
    _b: () => legacyBindObjectProps,
    /** 返回文本 VNode 创建 helper。 */
    _v: () => createTextVNode,
    /** 返回注释占位 VNode 创建 helper。 */
    _e: () => createCommentVNode,
    /** 返回把旧 scoped slot 描述转为 Vue 3 slots 的 helper。 */
    _u: () => legacyResolveScopedSlots,
    /** 返回合并旧对象事件绑定的 helper。 */
    _g: () => legacyBindObjectListeners,
    /** 返回旧动态参数键值数组展开器。 */
    _d: () => legacyBindDynamicKeys,
    /** 返回动态事件名修饰符前缀拼接器。 */
    _p: () => legacyPrependModifier,
  } as PublicPropertiesMap

  for (const key in privateAPIs) {
    /** 读取私有 helper 前检查 PRIVATE_APIS；禁用时返回 undefined，不执行对应实例访问器。 */
    map[key] = i => {
      if (isCompatEnabled(DeprecationTypes.PRIVATE_APIS, i)) {
        return privateAPIs[key](i)
      }
    }
  }
}
