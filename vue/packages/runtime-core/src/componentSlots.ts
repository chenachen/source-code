import { type ComponentInternalInstance, currentInstance } from './component'
import {
  type VNode,
  type VNodeChild,
  type VNodeNormalizedChildren,
  normalizeVNode,
} from './vnode'
import {
  EMPTY_OBJ,
  type IfAny,
  type Prettify,
  ShapeFlags,
  SlotFlags,
  def,
  isArray,
  isFunction,
} from '@vue/shared'
import { warn } from './warning'
import { isKeepAlive } from './components/KeepAlive'
import {
  type ContextualRenderFn,
  currentRenderingInstance,
  withCtx,
} from './componentRenderContext'
import { isHmrUpdating } from './hmr'
import { DeprecationTypes, isCompatEnabled } from './compat/compatConfig'
import { TriggerOpTypes, trigger } from '@vue/reactivity'
import { createInternalObject } from './internalObject'

/** 标准化插槽函数：根据 slot props 返回 VNode 数组。 */
export type Slot<T extends any = any> = (
  ...args: IfAny<T, any[], [T] | (T extends undefined ? [] : never)>
) => VNode[]

/** 运行时插槽名到函数的可变内部映射。 */
export type InternalSlots = {
  [name: string]: Slot | undefined
}

/** 对用户暴露的只读 slots 视图。 */
export type Slots = Readonly<InternalSlots>

/** 只存在于类型层的唯一键，用于携带 defineSlots/组件 slots 声明。 */
declare const SlotSymbol: unique symbol
/** 在不生成运行时代码的前提下封装 slots 类型信息。 */
export type SlotsType<T extends Record<string, any> = Record<string, any>> = {
  /**
   * 纯类型 slots 声明的载体键；运行时不建立此 Symbol 属性。
   */
  [SlotSymbol]?: T
}

/** 严格解包已是函数签名的 slots 声明，不自动把值类型包装成 Slot。 */
export type StrictUnwrapSlotsType<
  S extends SlotsType,
  T = NonNullable<S[typeof SlotSymbol]>,
> = [keyof S] extends [never] ? Slots : Readonly<T> & T

/** 把 slots 声明中非函数值转换为接收该值作为 props 的 Slot 函数。 */
export type UnwrapSlotsType<
  S extends SlotsType,
  T = NonNullable<S[typeof SlotSymbol]>,
> = [keyof S] extends [never]
  ? Slots
  : Readonly<
      Prettify<{
        [K in keyof T]: NonNullable<T[K]> extends (...args: any[]) => any
          ? T[K]
          : Slot<T[K]>
      }>
    >

/** 尚未由运行时标准化的 slots 对象及编译器优化标记。 */
export type RawSlots = {
  [name: string]: unknown
  /** 手写 render 提示 slots 稳定，可跳过强制 children 更新。 */
  $stable?: boolean
  /**
   * 插槽声明方实例。组件 VNode 在 `normalizeChildren()` 时附加，执行插槽时用于恢复
   * 资源解析、scopeId 和警告上下文；响应式依赖仍由执行插槽时的活动 effect 收集。
   * @internal
   */
  _ctx?: ComponentInternalInstance | null
  /**
   * 编译器生成的插槽稳定性标记。不能只放 VNode patchFlag：手写 render 可能把 slots
   * 对象直接转发给孙组件，标记必须跟随对象才能跨层保留。
   * @internal
   */
  _?: SlotFlags
}

/** 过滤不应作为用户 slot 暴露的运行时元数据键。 */
const isInternalKey = (key: string) =>
  key === '_' || key === '_ctx' || key === '$stable'

/** 把插槽任意返回值统一成 VNode 数组。 */
const normalizeSlotValue = (value: unknown): VNode[] =>
  isArray(value)
    ? value.map(normalizeVNode)
    : [normalizeVNode(value as VNodeChild)]

/**
 * 包装用户插槽函数：绑定声明上下文、标准化返回值，并诊断 render 外调用。
 * render 外调用不会处在组件 effect 内，插槽读取的响应式依赖无法触发正确更新。
 */
const normalizeSlot = (
  key: string,
  rawSlot: Function,
  ctx: ComponentInternalInstance | null | undefined,
): Slot => {
  if ((rawSlot as any)._n) {
    // #5353：已带 `_n` 的插槽不可重复 withCtx，否则上下文/追踪开关会嵌套错乱。
    return rawSlot as Slot
  }
  const normalized = withCtx((...args: any[]) => {
    if (
      __DEV__ &&
      currentInstance &&
      !(ctx === null && currentRenderingInstance) &&
      !(ctx && ctx.root !== currentInstance.root)
    ) {
      warn(
        `Slot "${key}" invoked outside of the render function: ` +
          `this will not track dependencies used in the slot. ` +
          `Invoke the slot function inside the render function instead.`,
      )
    }
    return normalizeSlotValue(rawSlot(...args))
  }, ctx) as Slot
  // 用户手写插槽不是编译插槽，renderSlot 不应启用编译 block 快路径。
  ;(normalized as ContextualRenderFn)._c = false
  return normalized
}

/** 遍历对象 slots，把函数绑定上下文；非函数值冻结成返回固定 VNode 数组的函数。 */
const normalizeObjectSlots = (
  rawSlots: RawSlots,
  slots: InternalSlots,
  instance: ComponentInternalInstance,
) => {
  const ctx = rawSlots._ctx
  for (const key in rawSlots) {
    if (isInternalKey(key)) continue
    const value = rawSlots[key]
    if (isFunction(value)) {
      slots[key] = normalizeSlot(key, value, ctx)
    } else if (value != null) {
      if (
        __DEV__ &&
        !(
          __COMPAT__ &&
          isCompatEnabled(DeprecationTypes.RENDER_FUNCTION, instance)
        )
      ) {
        warn(
          `Non-function value encountered for slot "${key}". ` +
            `Prefer function slots for better performance.`,
        )
      }
      const normalized = normalizeSlotValue(value)
      /**
       * 非函数 slot 的固定内容包装器：返回本次标准化得到的同一 VNode 数组，更新时由 normalizeObjectSlots 替换此函数。
       */
      slots[key] = () => normalized
    }
  }
}

/** 把直接传给组件的普通 children 标准化为 default slot。 */
const normalizeVNodeSlots = (
  instance: ComponentInternalInstance,
  children: VNodeNormalizedChildren,
) => {
  if (
    __DEV__ &&
    !isKeepAlive(instance.vnode) &&
    !(__COMPAT__ && isCompatEnabled(DeprecationTypes.RENDER_FUNCTION, instance))
  ) {
    warn(
      `Non-function value encountered for default slot. ` +
        `Prefer function slots for better performance.`,
    )
  }
  const normalized = normalizeSlotValue(children)
  /**
   * 普通 children 的 default slot 包装器：返回本次标准化数组，保留 Vue 3 所有实例 slots 值为函数的协议。
   */
  instance.slots.default = () => normalized
}

/** 把已编译 slots 复制到实例，并按优化状态决定是否保留内部标记。 */
const assignSlots = (
  slots: InternalSlots,
  children: Slots,
  optimized: boolean,
) => {
  for (const key in children) {
    // #2893：手写 render 若传入带编译标记的 slots，而当前并非 optimized 路径，不能
    // 复制 `_`。否则 renderSlot 会误信结构稳定；移除标记可让 Slot Fragment 用 BAIL
    // 强制完整更新。
    if (optimized || !isInternalKey(key)) {
      slots[key] = children[key]
    }
  }
}

/** 首次建立组件 slots：直接接收已编译 slots，或标准化对象/普通 children。 */
export const initSlots = (
  instance: ComponentInternalInstance,
  children: VNodeNormalizedChildren,
  optimized: boolean,
): void => {
  const slots = (instance.slots = createInternalObject())
  if (instance.vnode.shapeFlag & ShapeFlags.SLOTS_CHILDREN) {
    const type = (children as RawSlots)._
    if (type) {
      assignSlots(slots, children as Slots, optimized)
      // 编译标记需保留供更新快路径读取，但不应出现在用户遍历 `$slots` 中。
      if (optimized) {
        def(slots, '_', type, true)
      }
    } else {
      normalizeObjectSlots(children as RawSlots, slots, instance)
    }
  } else if (children) {
    normalizeVNodeSlots(instance, children)
  }
}

/**
 * 更新组件 slots，并删除新输入已不存在的旧 slot。
 * 优化更新中的稳定编译 slots 可跳过复制和删除；其余编译 slots 直接复制，手写 slots
 * 需要标准化。HMR 强制覆盖并触发 `$slots`。
 */
export const updateSlots = (
  instance: ComponentInternalInstance,
  children: VNodeNormalizedChildren,
  optimized: boolean,
): void => {
  const { vnode, slots } = instance
  let needDeletionCheck = true
  let deletionComparisonTarget = EMPTY_OBJ
  if (vnode.shapeFlag & ShapeFlags.SLOTS_CHILDREN) {
    const type = (children as RawSlots)._
    if (type) {
      // 编译 slots 携带稳定性标志。
      if (__DEV__ && isHmrUpdating) {
        // 父模板 HMR 后内容/函数可能改变，强制复制并通知读取 `$slots` 的依赖。
        assignSlots(slots, children as Slots, optimized)
        trigger(instance, TriggerOpTypes.SET, '$slots')
      } else if (optimized && type === SlotFlags.STABLE) {
        // 稳定编译 slots 能在执行时收集自身依赖；优化更新跳过映射复制和删除检查。
        // STABLE 不保证父组件每次 render 生成的 slot 函数引用相同。
        needDeletionCheck = false
      } else {
        // 动态编译 slots 或未启用优化的稳定 slots：复制映射，函数无需再次标准化。
        assignSlots(slots, children as Slots, optimized)
      }
    } else {
      needDeletionCheck = !(children as RawSlots).$stable
      normalizeObjectSlots(children as RawSlots, slots, instance)
    }
    deletionComparisonTarget = children as RawSlots
  } else if (children) {
    // 直接值 children 作为 default slot，删除比较目标只含 default。
    normalizeVNodeSlots(instance, children)
    deletionComparisonTarget = { default: 1 }
  }

  // 动态键集合可能缩小，清除旧函数避免 `$slots.foo` 残留。
  if (needDeletionCheck) {
    for (const key in slots) {
      if (!isInternalKey(key) && deletionComparisonTarget[key] == null) {
        delete slots[key]
      }
    }
  }
}
