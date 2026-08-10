import {
  camelize,
  extend,
  hyphenate,
  isArray,
  isObject,
  isReservedProp,
  normalizeClass,
} from '@vue/shared'
import type { ComponentInternalInstance, Data } from '../component'
import type { Slot } from '../componentSlots'
import { createSlots } from '../helpers/createSlots'
import { renderSlot } from '../helpers/renderSlot'
import { toHandlers } from '../helpers/toHandlers'
import { type VNode, mergeProps } from '../vnode'

/** 把 Vue 2 `_b` helper 接受的对象数组按顺序浅合并为一个对象。 */
function toObject(arr: Array<any>): Object {
  const res = {}
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]) {
      extend(res, arr[i])
    }
  }
  return res
}

/**
 * Vue 2 `_b`：实现无参数 `v-bind="value"` 的 data 合并。
 * 保留 key/ref 等保留 props，合并 class/style，其余键写入 data.attrs；`.sync` 模式
 * 还生成 `update:key` 监听器，把子组件更新写回原 value 对象。
 */
export function legacyBindObjectProps(
  data: any,
  _tag: string,
  value: any,
  _asProp: boolean,
  isSync?: boolean,
): any {
  if (value && isObject(value)) {
    if (isArray(value)) {
      value = toObject(value)
    }
    for (const key in value) {
      if (isReservedProp(key)) {
        data[key] = value[key]
      } else if (key === 'class') {
        data.class = normalizeClass([data.class, value.class])
      } else if (key === 'style') {
        data.style = normalizeClass([data.style, value.style])
      } else {
        const attrs = data.attrs || (data.attrs = {})
        const camelizedKey = camelize(key)
        const hyphenatedKey = hyphenate(key)
        if (!(camelizedKey in attrs) && !(hyphenatedKey in attrs)) {
          attrs[key] = value[key]

          if (isSync) {
            const on = data.on || (data.on = {})
            on[`update:${key}`] = function ($event: any) {
              value[key] = $event
            }
          }
        }
      }
    }
  }
  return data
}

/** Vue 2 `_g`：把 `v-on="listeners"` 转成 Vue 3 onXxx props，并与已有监听器合并。 */
export function legacyBindObjectListeners(props: any, listeners: any): Data {
  return mergeProps(props, toHandlers(listeners))
}

/** Vue 2 `_t`：合并 `slot` 上的显式 props 与 v-bind 对象后调用 Vue 3 renderSlot。 */
export function legacyRenderSlot(
  instance: ComponentInternalInstance,
  name: string,
  fallback?: VNode[],
  props?: any,
  bindObject?: any,
): VNode {
  if (bindObject) {
    props = mergeProps(props, bindObject)
  }
  return renderSlot(instance.slots, name, props, fallback && (() => fallback))
}

/** Vue 2 编译器 `_u` 生成的可递归 scoped slot 描述数组。 */
type LegacyScopedSlotsData = Array<
  | {
      key: string
      fn: Function
    }
  | LegacyScopedSlotsData
>

/** 把 Vue 2 scoped slot 描述补上 name，并交给 Vue 3 createSlots。 */
export function legacyResolveScopedSlots(
  fns: LegacyScopedSlotsData,
  raw?: Record<string, Slot>,
  // Vue 2.6 增加的动态 key 标记，用来决定 `$stable`。
  hasDynamicKeys?: boolean,
): ReturnType<typeof createSlots> {
  // Vue 2 默认插槽描述没有 name，mapKeyToName 会从 key 推导并回退为 default。
  return createSlots(
    raw || ({ $stable: !hasDynamicKeys } as any),
    mapKeyToName(fns),
  )
}

/** 递归遍历旧 scoped slot 描述，把 key 复制到 Vue 3 所需的 name。 */
function mapKeyToName(slots: LegacyScopedSlotsData) {
  for (let i = 0; i < slots.length; i++) {
    const fn = slots[i]
    if (fn) {
      if (isArray(fn)) {
        mapKeyToName(fn)
      } else {
        ;(fn as any).name = fn.key || 'default'
      }
    }
  }
  return slots as any
}

/** 每个组件实例的 Vue 2 staticRenderFns 结果缓存。 */
const staticCacheMap = /*@__PURE__*/ new WeakMap<
  ComponentInternalInstance,
  any[]
>()

/** Vue 2 `_m`：按索引执行并缓存静态 render 函数，使后续渲染复用同一静态 VNode 树。 */
export function legacyRenderStatic(
  instance: ComponentInternalInstance,
  index: number,
): any {
  let cache = staticCacheMap.get(instance)
  if (!cache) {
    staticCacheMap.set(instance, (cache = []))
  }
  if (cache[index]) {
    return cache[index]
  }
  const fn = (instance.type as any).staticRenderFns[index]
  const ctx = instance.proxy
  return (cache[index] = fn.call(ctx, null, ctx))
}

/**
 * Vue 2 `_k` 键盘修饰符检查。
 * 用户 `config.keyCodes` 优先；否则比较编译器内置 key 名/keyCode。返回 true 表示不匹配，
 * 编译代码据此提前 return，不执行事件处理器。
 */
export function legacyCheckKeyCodes(
  instance: ComponentInternalInstance,
  eventKeyCode: number,
  key: string,
  builtInKeyCode?: number | number[],
  eventKeyName?: string,
  builtInKeyName?: string | string[],
): boolean | undefined {
  const config = instance.appContext.config as any
  const configKeyCodes = config.keyCodes || {}
  const mappedKeyCode = configKeyCodes[key] || builtInKeyCode
  if (builtInKeyName && eventKeyName && !configKeyCodes[key]) {
    return isKeyNotMatch(builtInKeyName, eventKeyName)
  } else if (mappedKeyCode) {
    return isKeyNotMatch(mappedKeyCode, eventKeyCode)
  } else if (eventKeyName) {
    return hyphenate(eventKeyName) !== key
  }
}

/** 比较实际键值是否不在期望单值/数组中。 */
function isKeyNotMatch<T>(expect: T | T[], actual: T): boolean {
  if (isArray(expect)) {
    return !expect.includes(actual)
  } else {
    return expect !== actual
  }
}

/**
 * Vue 2 `_o`（v-once）占位 helper。Vue 3 renderer 已使用不同机制处理静态/once，
 * 兼容编译结果只需原样返回树。
 */
export function legacyMarkOnce(tree: VNode): VNode {
  return tree
}

/** Vue 2 `_d`：把 `[key1,value1,key2,value2]` 动态参数数组写入 props。 */
export function legacyBindDynamicKeys(props: any, values: any[]): any {
  for (let i = 0; i < values.length; i += 2) {
    const key = values[i]
    if (typeof key === 'string' && key) {
      props[values[i]] = values[i + 1]
    }
  }
  return props
}

/** Vue 2 `_p`：为动态事件名加 `!/~ /&` 等编译器修饰符前缀；非字符串原样返回。 */
export function legacyPrependModifier(value: any, symbol: string): any {
  return typeof value === 'string' ? symbol + value : value
}
