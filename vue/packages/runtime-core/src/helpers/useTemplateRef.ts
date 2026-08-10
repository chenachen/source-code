import { type ShallowRef, readonly, shallowRef } from '@vue/reactivity'
import { type Data, getCurrentInstance } from '../component'
import { warn } from '../warning'
import { EMPTY_OBJ } from '@vue/shared'

/**
 * 开发环境中由 `useTemplateRef()` 创建的 ref 集合。
 *
 * 使用 WeakSet 不阻止 ref 被回收；渲染器可据此识别只读模板 ref，并在用户同时用旧式
 * `ref()` 接收同名模板引用时给出更准确的诊断。
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
        get: () => r.value,
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
