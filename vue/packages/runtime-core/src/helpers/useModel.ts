import { type Ref, customRef, ref } from '@vue/reactivity'
import { EMPTY_OBJ, camelize, hasChanged, hyphenate } from '@vue/shared'
import type { DefineModelOptions, ModelRef } from '../apiSetupHelpers'
import { getCurrentInstance } from '../component'
import { warn } from '../warning'
import type { NormalizedProps } from '../componentProps'
import { watchSyncEffect } from '../apiWatch'

/**
 * `defineModel()` 编译后的运行时实现。
 * 返回 customRef：父级提供完整 v-model 时写入会 emit 并等 props 回流；未提供时在
 * 本地保存值。同时它实现迭代器，因此可解构为 `[modelRef, modifiers]`。
 */
export function useModel<
  M extends PropertyKey,
  T extends Record<string, any>,
  K extends keyof T,
  G = T[K],
  S = T[K],
>(
  props: T,
  name: K,
  options?: DefineModelOptions<T[K], G, S>,
): ModelRef<T[K], M, G, S>
export function useModel(
  props: Record<string, any>,
  name: string,
  options: DefineModelOptions = EMPTY_OBJ,
): Ref {
  const i = getCurrentInstance()!
  if (__DEV__ && !i) {
    warn(`useModel() called without active instance.`)
    return ref() as any
  }

  const camelizedName = camelize(name)
  if (__DEV__ && !(i.propsOptions[0] as NormalizedProps)[camelizedName]) {
    warn(`useModel() called with prop "${name}" which is not declared.`)
    return ref() as any
  }

  const hyphenatedName = hyphenate(name)
  /** 对应 `modelModifiers` 或 `<name>Modifiers` prop。 */
  const modifiers = getModelModifiers(props, camelizedName)

  const res = customRef((track, trigger) => {
    /** 与父 props 最近一次同步的原始 model 值。 */
    let localValue: any
    /** 最近一次用户写入值，用 EMPTY_OBJ 区分“尚未写入”。 */
    let prevSetValue: any = EMPTY_OBJ
    /** 最近一次经过 setter 转换后 emit 的值。 */
    let prevEmittedValue: any

    // 同步监听父 prop，使 customRef 的消费者在父级更新同一 model 时立即失效。
    watchSyncEffect(() => {
      const propValue = props[camelizedName]
      if (hasChanged(localValue, propValue)) {
        localValue = propValue
        trigger()
      }
    })

    return {
      get() {
        track()
        return options.get ? options.get(localValue) : localValue
      },

      set(value) {
        const emittedValue = options.set ? options.set(value) : value
        // emit 值与当前 prop 相同通常无需工作；但若 setter 把不同输入折叠成相同输出，
        // 仍可能需要更新本地输入显示，故同时比较 prevSetValue。
        if (
          !hasChanged(emittedValue, localValue) &&
          !(prevSetValue !== EMPTY_OBJ && hasChanged(value, prevSetValue))
        ) {
          return
        }
        const rawProps = i.vnode!.props
        const hasVModel = !!(
          rawProps &&
          // 只有父级同时传 prop 和 update 监听器才算受控 v-model；兼容原名、驼峰、横线名。
          (name in rawProps ||
            camelizedName in rawProps ||
            hyphenatedName in rawProps) &&
          (`onUpdate:${name}` in rawProps ||
            `onUpdate:${camelizedName}` in rawProps ||
            `onUpdate:${hyphenatedName}` in rawProps)
        )
        if (!hasVModel) {
          // 无父级 v-model 时作为本地 ref 使用，立即更新并通知依赖。
          localValue = value
          trigger()
        }

        i.emit(`update:${name}`, emittedValue)
        // #10279：setter 可能把不同输入转换为相同 emit 值。父级看到值未变便不会
        // 重新渲染/回传 prop，但本地输入控件仍可能显示用户刚输入的未转换值；强制
        // trigger 可让 DOM 按当前 model 重新同步。
        if (
          hasChanged(value, prevSetValue) &&
          ((hasChanged(value, emittedValue) &&
            !hasChanged(emittedValue, prevEmittedValue)) ||
            // #13524：浏览器在多个事件监听器之间冲刷微任务的时机不同。若 v-model
            // 监听器先产生中间值，后续监听器又在父更新提交前恢复旧 prop，父 render
            // 可能因“最终未变化”被去重。这里仍触发本地更新，使 input.value 等 DOM
            // 状态回到当前模型，而不是残留中间输入。
            (hasVModel &&
              prevSetValue !== EMPTY_OBJ &&
              !hasChanged(emittedValue, localValue)))
        ) {
          trigger()
        }
        prevSetValue = value
        prevEmittedValue = emittedValue
      },
    }
  })

  // 让返回值支持 `[model, modifiers] = useModel(...)`；第一次产出自身，第二次修饰符。
  // @ts-expect-error
  res[Symbol.iterator] = () => {
    let i = 0
    return {
      next() {
        if (i < 2) {
          return { value: i++ ? modifiers || EMPTY_OBJ : res, done: false }
        } else {
          return { done: true }
        }
      },
    }
  }

  return res
}

/**
 * 按 model 名称读取编译器生成的修饰符 prop。
 * 默认 model 使用 `modelModifiers`；具名 model 兼容原名、camelCase 与 kebab-case。
 */
export const getModelModifiers = (
  props: Record<string, any>,
  modelName: string,
): Record<string, boolean> | undefined => {
  return modelName === 'modelValue' || modelName === 'model-value'
    ? props.modelModifiers
    : props[`${modelName}Modifiers`] ||
        props[`${camelize(modelName)}Modifiers`] ||
        props[`${hyphenate(modelName)}Modifiers`]
}
