import { type ShallowRef, readonly, shallowRef } from '@vue/reactivity'
import { type Data, getCurrentInstance } from '../component'
import { warn } from '../warning'
import { EMPTY_OBJ } from '@vue/shared'

/**
 * 开发环境中由 `useTemplateRef()` 创建的 ref 集合。
 *
 * 使用 WeakSet 不阻止 ref 被回收。渲染器据此跳过对 setupState 中该 ref 或直接 ref
 * 值的赋值；模板引用通过 `$refs` 访问器写入内部 shallowRef，避免重复写 readonly 包装。
 */
export const knownTemplateRefs: WeakSet<ShallowRef> = new WeakSet()

/** `useTemplateRef()` 的只读返回类型；渲染器内部负责写入，用户只能读取。 */
export type TemplateRef<T = unknown> = Readonly<ShallowRef<T | null>>

/**
 * 创建一个与当前组件模板中指定 `ref` 名称相连的浅 ref。
 *
 * 组件的 `$refs[key]` 被定义为访问器，并与浅 ref 的 `.value` 双向映射。使用浅 ref 是
 * 因为 DOM 节点和组件公开实例不应被深层响应式代理。开发环境返回 readonly 包装，
 * 明确模板引用的赋值权属于渲染器。
 */
export function useTemplateRef<T = unknown, Keys extends string = string>(
  key: Keys,
): TemplateRef<T> {
  const i = getCurrentInstance()
  const r = shallowRef(null)
  if (i) {
    const refs = i.refs === EMPTY_OBJ ? (i.refs = {}) : i.refs
    if (__DEV__ && isTemplateRefKey(refs, key)) {
      warn(`useTemplateRef('${key}') already exists.`)
    } else {
      Object.defineProperty(refs, key, {
        enumerable: true,
        /** 从 $refs[key] 读取内部 shallowRef.value，使公开模板引用与组合式返回值一致。 */
        get: () => r.value,
        /** 渲染器写入 $refs[key] 时同步内部 shallowRef，不替换用户取得的只读引用对象。 */
        set: val => (r.value = val),
      })
    }
  } else if (__DEV__) {
    warn(
      `useTemplateRef() is called when there is no active component ` +
        `instance to be associated with.`,
    )
  }
  const ret = __DEV__ ? readonly(r) : r
  if (__DEV__) {
    knownTemplateRefs.add(ret)
  }
  return ret
}

/**
 * 判断 `$refs` 上的键是否已由 `useTemplateRef()` 定义。
 *
 * 该 API 创建的属性默认不可配置，可用这一描述符特征与普通用户赋值区分。
 */
export function isTemplateRefKey(refs: Data, key: string): boolean {
  let desc: PropertyDescriptor | undefined
  return !!(
    (desc = Object.getOwnPropertyDescriptor(refs, key)) && !desc.configurable
  )
}
