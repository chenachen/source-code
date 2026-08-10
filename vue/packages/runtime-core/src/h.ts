import {
  type Comment,
  type Fragment,
  type Text,
  type VNode,
  type VNodeArrayChildren,
  type VNodeProps,
  createVNode,
  isVNode,
  setBlockTracking,
} from './vnode'
import type { Teleport, TeleportProps } from './components/Teleport'
import type { Suspense, SuspenseProps } from './components/Suspense'
import { type IfAny, isArray, isObject } from '@vue/shared'
import type { RawSlots } from './componentSlots'
import type {
  Component,
  ComponentOptions,
  ConcreteComponent,
  FunctionalComponent,
} from './component'
import type { EmitsOptions } from './componentEmits'
import type { DefineComponent } from './apiDefineComponent'

// `h` 是面向手写渲染函数的易用版 `createVNode`，可在没有 props 时省略参数。
// 编译器生成代码直接使用 `createVNode`：其参数形态固定，省去这里的重载判定开销；
// 同时还能传入 patchFlag、dynamicProps 等静态分析结果，启用运行时 diff 快路径。

/*
// 仅传类型
h('div')

// 类型 + props
h('div', {})

// 类型 + 省略 props + children
// 省略 props 时不支持直接传命名插槽对象，因为它与 props 对象无法区分。
h('div', []) // array
h('div', 'foo') // text
h('div', h('br')) // vnode
h(Component, () => {}) // default slot

// 类型 + props + children
h('div', {}, []) // array
h('div', {}, 'foo') // text
h('div', {}, h('br')) // vnode
h(Component, {}, () => {}) // default slot
h(Component, {}, {}) // named slots

// 无 props 但有命名插槽时必须显式传 `null` 消除歧义。
h(Component, null, {})
**/

/**
 * `h()` 可接受的宽松 props 类型。
 * 两个 `never` 字段只参与类型排歧：防止单 VNode 或可迭代数组被错误匹配成 props。
 */
type RawProps = VNodeProps & {
  // 与“单个 VNode 作为 children”的重载区分。
  __v_isVNode?: never
  // 与“数组作为 children”的重载区分。
  [Symbol.iterator]?: never
} & Record<string, any>

/** 省略 props 时可直接作为第二参数的子节点类型；命名插槽对象不在其中。 */
type RawChildren =
  string | number | boolean | VNode | VNodeArrayChildren | (() => any)

/** `defineComponent()` 类型层返回的虚拟构造器，用 `$props` 携带组件 props 信息。 */
interface Constructor<P = any> {
  __isFragment?: never
  __isTeleport?: never
  __isSuspense?: never
  new (...args: any[]): { $props: P }
}

/** 从 DOM 事件映射生成原生元素 `onClick` 等处理器类型。 */
type HTMLElementEventHandler = {
  [K in keyof HTMLElementEventMap as `on${Capitalize<K>}`]?: (
    ev: HTMLElementEventMap[K],
  ) => any
}

// 以下重载专门为手写渲染函数提供 props/children 校验；运行时最终共用底部一个实现。

// 原生 HTML 元素：由标签名推导原生事件类型。
export function h<K extends keyof HTMLElementTagNameMap>(
  type: K,
  children?: RawChildren,
): VNode
export function h<K extends keyof HTMLElementTagNameMap>(
  type: K,
  props?: (RawProps & HTMLElementEventHandler) | null,
  children?: RawChildren | RawSlots,
): VNode

// 自定义元素或运行时才能确定的任意标签。
export function h(type: string, children?: RawChildren): VNode
export function h(
  type: string,
  props?: RawProps | null,
  children?: RawChildren | RawSlots,
): VNode

// 文本与注释节点只能接收可字符串化的 children。
export function h(
  type: typeof Text | typeof Comment,
  children?: string | number | boolean,
): VNode
export function h(
  type: typeof Text | typeof Comment,
  props?: null,
  children?: string | number | boolean,
): VNode
// Fragment 只能承载 VNode 数组。
export function h(type: typeof Fragment, children?: VNodeArrayChildren): VNode
export function h(
  type: typeof Fragment,
  props?: RawProps | null,
  children?: VNodeArrayChildren,
): VNode

// Teleport：`to` 等目标 props 必填。
export function h(
  type: typeof Teleport,
  props: RawProps & TeleportProps,
  children: RawChildren | RawSlots,
): VNode

// Suspense：children 通常是 default/fallback 插槽。
export function h(type: typeof Suspense, children?: RawChildren): VNode
export function h(
  type: typeof Suspense,
  props?: (RawProps & SuspenseProps) | null,
  children?: RawChildren | RawSlots,
): VNode

// 函数式组件：同时从 props、emits 与 slots 泛型推导参数。
export function h<
  P,
  E extends EmitsOptions = {},
  S extends Record<string, any> = any,
>(
  type: FunctionalComponent<P, any, S, any>,
  props?: (RawProps & P) | ({} extends P ? null : never),
  children?: RawChildren | IfAny<S, RawSlots, S>,
): VNode

// 通用组件兜底。
export function h(type: Component, children?: RawChildren): VNode

// 明确的组件选项或函数式组件。
export function h<P>(
  type: ConcreteComponent | string,
  children?: RawChildren,
): VNode
export function h<P>(
  type: ConcreteComponent<P> | string,
  props?: (RawProps & P) | ({} extends P ? null : never),
  children?: RawChildren,
): VNode

// 无必填 props 的组件。
export function h<P>(
  type: Component<P>,
  props?: (RawProps & P) | null,
  children?: RawChildren | RawSlots,
): VNode

// 原始 ComponentOptions；与 defineComponent 虚拟构造器分开匹配。
export function h<P>(
  type: ComponentOptions<P>,
  props?: (RawProps & P) | ({} extends P ? null : never),
  children?: RawChildren | RawSlots,
): VNode

// defineComponent 虚拟构造器或类组件。
export function h(type: Constructor, children?: RawChildren): VNode
export function h<P>(
  type: Constructor<P>,
  props?: (RawProps & P) | ({} extends P ? null : never),
  children?: RawChildren | RawSlots,
): VNode

// 完整 DefineComponent 类型。
export function h(type: DefineComponent, children?: RawChildren): VNode
export function h<P>(
  type: DefineComponent<P>,
  props?: (RawProps & P) | ({} extends P ? null : never),
  children?: RawChildren | RawSlots,
): VNode

// 最宽松的字符串/组件联合兜底，防止动态类型无法命中前述精确重载。
export function h(type: string | Component, children?: RawChildren): VNode
export function h<P>(
  type: string | Component<P>,
  props?: (RawProps & P) | ({} extends P ? null : never),
  children?: RawChildren | RawSlots,
): VNode

/**
 * 创建 VNode 的手写渲染函数入口。
 *
 * 两参数调用时，对象可能是 props 或单个 VNode children：VNode 单独包成数组，其余普通
 * 对象视为 props，原始值/数组视为 children。三参数以上则把多余参数收集为子节点。
 */
export function h(type: any, propsOrChildren?: any, children?: any): VNode {
  try {
    // #6913：`h()` 的灵活参数标准化会把已创建 VNode 重新作为 children 传入。若此时
    // 仍启用 block tracking，同一动态节点可能被当前 block 重复收集。调用期间暂停，
    // 最终 VNode 的正常创建流程仍会维护必要关系。
    setBlockTracking(-1)
    const l = arguments.length
    if (l === 2) {
      if (isObject(propsOrChildren) && !isArray(propsOrChildren)) {
        // 单 VNode 是 children，不是 props；统一包成数组便于后续 children 标准化。
        if (isVNode(propsOrChildren)) {
          return createVNode(type, null, [propsOrChildren])
        }
        // 普通非数组对象按 props 处理。
        return createVNode(type, propsOrChildren)
      } else {
        // 数组或原始值表示省略 props，直接作为 children。
        return createVNode(type, null, propsOrChildren)
      }
    } else {
      if (l > 3) {
        children = Array.prototype.slice.call(arguments, 2)
      } else if (l === 3 && isVNode(children)) {
        children = [children]
      }
      return createVNode(type, propsOrChildren, children)
    }
  } finally {
    setBlockTracking(1)
  }
}
