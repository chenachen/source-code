import type { VNode, VNodeChild } from '../vnode'
import {
  isReactive,
  isReadonly,
  isShallow,
  shallowReadArray,
  toReactive,
  toReadonly,
} from '@vue/reactivity'
import { isArray, isObject, isString } from '@vue/shared'
import { warn } from '../warning'

/**
 * 渲染字符串形式的 `v-for`，每次回调得到单个字符与索引。
 * @private
 */
export function renderList(
  source: string,
  renderItem: (value: string, index: number) => VNodeChild,
): VNodeChild[]

/**
 * 渲染数字范围形式的 `v-for`；value 从 1 开始，index 从 0 开始。
 */
export function renderList(
  source: number,
  renderItem: (value: number, index: number) => VNodeChild,
): VNodeChild[]

/**
 * 渲染数组形式的 `v-for`。
 */
export function renderList<T>(
  source: T[],
  renderItem: (value: T, index: number) => VNodeChild,
): VNodeChild[]

/**
 * 渲染实现 `Symbol.iterator` 的可迭代对象，如 Set、Map 迭代器。
 */
export function renderList<T>(
  source: Iterable<T>,
  renderItem: (value: T, index: number) => VNodeChild,
): VNodeChild[]

/**
 * 渲染普通对象形式的 `v-for`，回调依次接收 value、key 和索引。
 */
export function renderList<T>(
  source: T,
  renderItem: <K extends keyof T>(
    value: T[K],
    key: string,
    index: number,
  ) => VNodeChild,
): VNodeChild[]

/**
 * `v-for` 编译产物的统一运行时实现。
 *
 * 按 source 类型分别遍历字符串/数组、数字范围、Iterable 与普通对象。编译器可传入
 * `cache/index`，把上一轮对应 VNode 作为第四个参数交给 renderItem，支持 `v-memo`
 * 跳过未变化列表项。
 */
export function renderList(
  source: any,
  renderItem: (...args: any[]) => VNodeChild,
  cache?: any[],
  index?: number,
): VNodeChild[] {
  let ret: VNodeChild[]
  const cached = (cache && cache[index!]) as VNode[] | undefined
  const sourceIsArray = isArray(source)

  if (sourceIsArray || isString(source)) {
    // 响应式数组使用 shallowReadArray 一次性跟踪数组迭代，避免每个索引访问重复走
    // Proxy；深层 reactive/readonly 数组仍需把每个原始元素包装回对应代理语义。
    const sourceIsReactiveArray = sourceIsArray && isReactive(source)
    let needsWrap = false
    let isReadonlySource = false
    if (sourceIsReactiveArray) {
      needsWrap = !isShallow(source)
      isReadonlySource = isReadonly(source)
      source = shallowReadArray(source)
    }
    ret = new Array(source.length)
    for (let i = 0, l = source.length; i < l; i++) {
      ret[i] = renderItem(
        needsWrap
          ? isReadonlySource
            ? toReadonly(toReactive(source[i]))
            : toReactive(source[i])
          : source[i],
        i,
        undefined,
        cached && cached[i],
      )
    }
  } else if (typeof source === 'number') {
    if (__DEV__ && (!Number.isInteger(source) || source < 0)) {
      warn(
        `The v-for range expects a positive integer value but got ${source}.`,
      )
      ret = []
    } else {
      // `v-for="n in count"` 的 n 与模板直觉一致从 1 开始，数组索引仍从 0 开始。
      ret = new Array(source)
      for (let i = 0; i < source; i++) {
        ret[i] = renderItem(i + 1, i, undefined, cached && cached[i])
      }
    }
  } else if (isObject(source)) {
    if (source[Symbol.iterator as any]) {
      // Iterable 用 Array.from 保留协议定义的迭代顺序。
      ret = Array.from(source as Iterable<any>, (item, i) =>
        renderItem(item, i, undefined, cached && cached[i]),
      )
    } else {
      // 普通对象遵循 Object.keys 的自有可枚举字符串键顺序。
      const keys = Object.keys(source)
      ret = new Array(keys.length)
      for (let i = 0, l = keys.length; i < l; i++) {
        const key = keys[i]
        ret[i] = renderItem(source[key], key, i, cached && cached[i])
      }
    }
  } else {
    ret = []
  }

  if (cache) {
    // 将本轮结果留给下一轮 renderItem 的 cached 参数。
    cache[index!] = ret
  }
  return ret
}
