import { isArray } from '@vue/shared'
import type { VNode } from '../vnode'

/** #6651：SSR 插槽可直接 push 到输出缓冲而无返回值；客户端插槽则返回 VNode 数组。 */
type SSRSlot = (...args: any[]) => VNode[] | undefined

/** 编译器描述一个动态插槽分支所需的最小运行时信息。 */
interface CompiledSlotDescriptor {
  /** 最终写入 slots 对象的插槽名。 */
  name: string
  /** 已编译插槽渲染函数。 */
  fn: SSRSlot
  /** `v-if` 分支键，用于让 diff 区分名称相同但来源不同的条件分支。 */
  key?: string
}

/**
 * 把编译器生成的动态插槽描述合并进组件 slots 对象。
 *
 * `v-for` 会产生描述符数组，需要逐个展开；`v-if` 产生单个可选描述符，并把分支 key
 * 挂到返回的 VNode 数组上。这个 key 可防止条件切换时把两个同名插槽误判为同一
 * Fragment，从而错误复用旧分支。
 *
 * @private 编译产物使用的运行时辅助函数。
 */
export function createSlots(
  slots: Record<string, SSRSlot>,
  dynamicSlots: (
    CompiledSlotDescriptor | CompiledSlotDescriptor[] | undefined
  )[],
): Record<string, SSRSlot> {
  for (let i = 0; i < dynamicSlots.length; i++) {
    const slot = dynamicSlots[i]
    // `<template v-for="..." #[...]>` 会为每次迭代生成一个动态插槽描述符。
    if (isArray(slot)) {
      for (let j = 0; j < slot.length; j++) {
        slots[slot[j].name] = slot[j].fn
      }
    } else if (slot) {
      // `<template v-if="..." #foo>` 只生成当前命中的条件插槽。
      slots[slot.name] = slot.key
        ? (...args: any[]) => {
            const res = slot.fn(...args)
            // 附加分支 key，使 diff 把同名条件分支视为不同 Fragment。
            if (res) (res as any).key = slot.key
            return res
          }
        : slot.fn
    }
  }
  return slots
}
