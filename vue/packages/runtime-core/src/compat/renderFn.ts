import {
  ShapeFlags,
  extend,
  hyphenate,
  isArray,
  isObject,
  isString,
  makeMap,
  normalizeClass,
  normalizeStyle,
  toHandlerKey,
} from '@vue/shared'
import type {
  Component,
  ComponentInternalInstance,
  ComponentOptions,
  Data,
  InternalRenderFunction,
} from '../component'
import { currentRenderingInstance } from '../componentRenderContext'
import { type DirectiveArguments, withDirectives } from '../directives'
import {
  resolveDirective,
  resolveDynamicComponent,
} from '../helpers/resolveAssets'
import {
  Comment,
  type VNode,
  type VNodeArrayChildren,
  type VNodeProps,
  createVNode,
  isVNode,
  normalizeChildren,
} from '../vnode'
import {
  DeprecationTypes,
  checkCompatEnabled,
  isCompatEnabled,
} from './compatConfig'
import { compatModelEventPrefix } from './componentVModel'

/**
 * 检测组件 render 是否为 Vue 2 签名，并在需要时包装为 `render.call(this, compatH)`。
 * 运行时编译、已检查或已包装函数直接跳过；参数不少于 2 的预编译函数视为 Vue 3，
 * 因为 Vue 2 普通 render 最多只接收一个 `h` 参数，旧函数组件已在更早阶段转换。
 */
export function convertLegacyRenderFn(
  instance: ComponentInternalInstance,
): void {
  const Component = instance.type as ComponentOptions
  const render = Component.render as InternalRenderFunction | undefined

  // Vue 3 运行时编译标记 `_rc`，以及已检查/包装函数均无需重复处理。
  if (!render || render._rc || render._compatChecked || render._compatWrapped) {
    return
  }

  if (render.length >= 2) {
    // Vue 3 预编译 render 会接收多个 helper 参数；Vue 2 普通 render 不会，旧函数组件
    // 也已先转换为 Vue 3 FunctionalComponent，因此可安全标为已检查。
    render._compatChecked = true
    return
  }

  // 剩余单参数/零参数函数按 Vue 2 render 尝试兼容。
  if (checkCompatEnabled(DeprecationTypes.RENDER_FUNCTION, instance)) {
    const wrapped = (Component.render = function compatRender() {
      // @ts-expect-error
      return render.call(this, compatH)
    })
    // @ts-expect-error
    wrapped._compatWrapped = true
  }
}

/** Vue 2 `h(type, data, children)` 中 data 对象的完整历史结构。 */
interface LegacyVNodeProps {
  key?: string | number
  ref?: string
  refInFor?: boolean

  staticClass?: string
  class?: unknown
  staticStyle?: Record<string, unknown>
  style?: Record<string, unknown>
  attrs?: Record<string, unknown>
  domProps?: Record<string, unknown>
  on?: Record<string, Function | Function[]>
  nativeOn?: Record<string, Function | Function[]>
  directives?: LegacyVNodeDirective[]

  // 以下字段仅用于组件 VNode。
  props?: Record<string, unknown>
  slot?: string
  scopedSlots?: Record<string, Function>
  model?: {
    value: any
    callback: (v: any) => void
    expression: string
  }
}

/** Vue 2 render 编译结果中的指令描述。 */
interface LegacyVNodeDirective {
  name: string
  value: unknown
  arg?: string
  modifiers?: Record<string, boolean>
}

/** Vue 2 `h` 接受的 children 形态。 */
type LegacyVNodeChildren =
  string | number | boolean | VNode | VNodeArrayChildren

export function compatH(
  type: string | Component,
  children?: LegacyVNodeChildren,
): VNode
export function compatH(
  type: string | Component,
  props?: Data & LegacyVNodeProps,
  children?: LegacyVNodeChildren,
): VNode

/**
 * Vue 2 `createElement`/`h` 的兼容实现。
 * 解析字符串组件名与旧内置组件别名，兼容省略 data 的重载，再将嵌套 data、事件前缀、
 * 指令和 slot 结构改写成 Vue 3 扁平 VNode props/函数插槽。
 */
export function compatH(
  type: any,
  propsOrChildren?: any,
  children?: any,
): VNode {
  if (!type) {
    type = Comment
  }

  // Vue 2 `h('MyComp')` 会按名称查组件，而 Vue 3 h 的字符串默认表示元素。
  if (typeof type === 'string') {
    const t = hyphenate(type)
    if (t === 'transition' || t === 'transition-group' || t === 'keep-alive') {
      // Transition/TransitionGroup 属于 runtime-dom，runtime-core 不能直接导入；
      // @vue/compat 入口会用特殊名称注册这些内置组件，再按普通动态组件解析。
      type = `__compat__${t}`
    }
    type = resolveDynamicComponent(type)
  }

  const l = arguments.length
  const is2ndArgArrayChildren = isArray(propsOrChildren)
  if (l === 2 || is2ndArgArrayChildren) {
    if (isObject(propsOrChildren) && !is2ndArgArrayChildren) {
      // 单个 VNode 第二参数是 children，不是 data。
      if (isVNode(propsOrChildren)) {
        return convertLegacySlots(createVNode(type, null, [propsOrChildren]))
      }
      // 普通对象第二参数是 data，且没有 children。
      return convertLegacySlots(
        convertLegacyDirectives(
          createVNode(type, convertLegacyProps(propsOrChildren, type)),
          propsOrChildren,
        ),
      )
    } else {
      // 数组/标量第二参数表示省略 data 的 children。
      return convertLegacySlots(createVNode(type, null, propsOrChildren))
    }
  } else {
    if (isVNode(children)) {
      children = [children]
    }
    return convertLegacySlots(
      convertLegacyDirectives(
        createVNode(type, convertLegacyProps(propsOrChildren, type), children),
        propsOrChildren,
      ),
    )
  }
}

/** 转换根级 data 时需单独处理或完全忽略的 Vue 2 专用字段。 */
const skipLegacyRootLevelProps = /*@__PURE__*/ makeMap(
  'staticStyle,staticClass,directives,model,hook',
)

/**
 * 把 Vue 2 分区 data 转成 Vue 3 扁平 VNode props。
 * attrs/domProps/component props 合并到同一级；on/nativeOn 变为 onXxx；静态和动态
 * class/style 规范化合并；旧组件 model 转成兼容 model prop/事件。
 */
function convertLegacyProps(
  legacyProps: LegacyVNodeProps | undefined,
  type: any,
): (Data & VNodeProps) | null {
  if (!legacyProps) {
    return null
  }

  const converted: Data & VNodeProps = {}

  for (const key in legacyProps) {
    if (key === 'attrs' || key === 'domProps' || key === 'props') {
      extend(converted, legacyProps[key])
    } else if (key === 'on' || key === 'nativeOn') {
      const listeners = legacyProps[key]
      for (const event in listeners) {
        let handlerKey = convertLegacyEventKey(event)
        if (key === 'nativeOn') handlerKey += `Native`
        // 同名监听器来自多个 data 分区时合并为数组，保留全部回调。
        const existing = converted[handlerKey]
        const incoming = listeners[event]
        if (existing !== incoming) {
          if (existing) {
            converted[handlerKey] = [].concat(existing as any, incoming as any)
          } else {
            converted[handlerKey] = incoming
          }
        }
      }
    } else if (!skipLegacyRootLevelProps(key)) {
      converted[key] = legacyProps[key as keyof LegacyVNodeProps]
    }
  }

  if (legacyProps.staticClass) {
    converted.class = normalizeClass([legacyProps.staticClass, converted.class])
  }
  if (legacyProps.staticStyle) {
    converted.style = normalizeStyle([legacyProps.staticStyle, converted.style])
  }

  if (legacyProps.model && isObject(type)) {
    // Vue 2 编译器把组件 v-model 放在 data.model；按组件 model 选项恢复 prop/event。
    const { prop = 'value', event = 'input' } = (type as any).model || {}
    converted[prop] = legacyProps.model.value
    converted[compatModelEventPrefix + event] = legacyProps.model.callback
  }

  return converted
}

/**
 * 将 Vue 2 编译器写在事件名前的 `&` passive、`~` once、`!` capture 前缀，
 * 转成 Vue 3 patchEvent 识别的 `onXxxPassive/Once/Capture` prop 名。
 */
function convertLegacyEventKey(event: string): string {
  // 前缀可能连续出现，按 Vue 2 编译顺序逐个剥离并追加选项后缀。
  if (event[0] === '&') {
    event = event.slice(1) + 'Passive'
  }
  if (event[0] === '~') {
    event = event.slice(1) + 'Once'
  }
  if (event[0] === '!') {
    event = event.slice(1) + 'Capture'
  }
  return toHandlerKey(event)
}

/** 把 Vue 2 data.directives 转为 Vue 3 `withDirectives(vnode, bindings)`。 */
function convertLegacyDirectives(
  vnode: VNode,
  props?: LegacyVNodeProps,
): VNode {
  if (props && props.directives) {
    return withDirectives(
      vnode,
      props.directives.map(({ name, value, arg, modifiers }) => {
        return [
          resolveDirective(name)!,
          value,
          arg,
          modifiers,
        ] as DirectiveArguments[number]
      }),
    )
  }
  return vnode
}

/**
 * 把 Vue 2 children 上的 `data.slot` 和 `data.scopedSlots` 转成 Vue 3 函数插槽对象。
 * 普通插槽数组包装为返回固定 children 的函数，并以 `_ns` 标记 non-scoped slot；
 * scopedSlots 与同名普通 slot 合并后交给 normalizeChildren 建立 SLOTS_CHILDREN。
 */
function convertLegacySlots(vnode: VNode): VNode {
  const { props, children } = vnode

  let slots: Record<string, any> | undefined

  if (vnode.shapeFlag & ShapeFlags.COMPONENT && isArray(children)) {
    slots = {}
    // 读取每个子 VNode 的 slot 属性，按名称聚合并转成 Vue 3 函数插槽。
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      const slotName =
        (isVNode(child) && child.props && child.props.slot) || 'default'
      const slot = slots[slotName] || (slots[slotName] = [] as any[])
      if (isVNode(child) && child.type === 'template') {
        slot.push(child.children)
      } else {
        slot.push(child)
      }
    }
    if (slots) {
      for (const key in slots) {
        const slotChildren = slots[key]
        slots[key] = () => slotChildren
        // 标记这是 Vue 2 普通插槽，而非接收 props 的 scoped slot。
        slots[key]._ns = true
      }
    }
  }

  const scopedSlots = props && props.scopedSlots
  if (scopedSlots) {
    delete props!.scopedSlots
    if (slots) {
      extend(slots, scopedSlots)
    } else {
      slots = scopedSlots
    }
  }

  if (slots) {
    normalizeChildren(vnode, slots)
  }

  return vnode
}

/**
 * 在 VNode 上惰性安装 Vue 2 私有字段别名（tag/data/elm/componentInstance 等）。
 * 只有 RENDER_FUNCTION 与 PRIVATE_APIS 都开启才安装，避免主路径承担 defineProperty
 * 成本；字段通过 getter 始终映射到 Vue 3 VNode 的最新状态。
 */
export function defineLegacyVNodeProperties(vnode: VNode): void {
  /* v8 ignore start */
  if (
    isCompatEnabled(
      DeprecationTypes.RENDER_FUNCTION,
      currentRenderingInstance,
      true /* 内置组件产生的 VNode 也可能交给旧 render 代码 */,
    ) &&
    isCompatEnabled(
      DeprecationTypes.PRIVATE_APIS,
      currentRenderingInstance,
      true /* 内置组件同样允许兼容私有字段 */,
    )
  ) {
    const context = currentRenderingInstance
    const getInstance = () => vnode.component && vnode.component.proxy
    let componentOptions: any
    Object.defineProperties(vnode, {
      tag: { get: () => vnode.type },
      data: { get: () => vnode.props || {}, set: p => (vnode.props = p) },
      elm: { get: () => vnode.el },
      componentInstance: { get: getInstance },
      child: { get: getInstance },
      text: { get: () => (isString(vnode.children) ? vnode.children : null) },
      context: { get: () => context && context.proxy },
      componentOptions: {
        get: () => {
          if (vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT) {
            if (componentOptions) {
              return componentOptions
            }
            return (componentOptions = {
              Ctor: vnode.type,
              propsData: vnode.props,
              children: vnode.children,
            })
          }
        },
      },
    })
  }
  /* v8 ignore stop */
}
