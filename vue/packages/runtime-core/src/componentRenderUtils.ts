import {
  type ComponentInternalInstance,
  type Data,
  type FunctionalComponent,
  getComponentName,
} from './component'
import {
  Comment,
  type VNode,
  type VNodeArrayChildren,
  blockStack,
  cloneVNode,
  createVNode,
  isVNode,
  normalizeVNode,
} from './vnode'
import { ErrorCodes, handleError } from './errorHandling'
import {
  PatchFlags,
  ShapeFlags,
  isModelListener,
  isObject,
  isOn,
  looseEqual,
} from '@vue/shared'
import { warn } from './warning'
import { isHmrUpdating } from './hmr'
import type { NormalizedProps } from './componentProps'
import { isEmitListener } from './componentEmits'
import { setCurrentRenderingInstance } from './componentRenderContext'
import {
  DeprecationTypes,
  isCompatEnabled,
  warnDeprecation,
} from './compat/compatConfig'
import { shallowReadonly } from '@vue/reactivity'
import { getInnerChild, setTransitionHooks } from './components/BaseTransition'
import { isTeleport } from './components/Teleport'

/**
 * 开发环境记录本次 render 是否显式读取过 `$attrs`。
 * 组件若主动消费 attrs，就不应再因多根节点无法自动透传而警告。
 */
let accessedAttrs: boolean = false

/** 标记当前组件渲染已显式消费 attrs。 */
export function markAttrsAccessed(): void {
  accessedAttrs = true
}

/** DEV_ROOT_FRAGMENT 找到真实单根后，将 clone 结果写回原 Fragment 的函数。 */
type SetRootFn = ((root: VNode) => void) | undefined

/**
 * 执行组件 render/函数式组件函数，并生成最终可交给渲染器 patch 的根 VNode。
 *
 * 除调用 render 外，还负责 attrs 透传、v-model listener 过滤、组件 VNode 上指令和
 * Transition 继承、错误降级为注释节点，以及开发根注释 Fragment 的真实单根定位。
 */
export function renderComponentRoot(
  instance: ComponentInternalInstance,
): VNode {
  const {
    type: Component,
    vnode,
    proxy,
    withProxy,
    propsOptions: [propsOptions],
    slots,
    attrs,
    emit,
    render,
    renderCache,
    props,
    data,
    setupState,
    ctx,
    inheritAttrs,
  } = instance
  const prev = setCurrentRenderingInstance(instance)

  let result
  let fallthroughAttrs
  if (__DEV__) {
    accessedAttrs = false
  }

  try {
    if (vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT) {
      // runtime 编译模板使用 `with`，withProxy 提供不同 has trap，防止变量错误落到全局。
      const proxyToUse = withProxy || proxy
      // `<script setup>` 生产模板不会暴露 this；开发代理在误用时给出明确警告。
      const thisProxy =
        __DEV__ && setupState.__isScriptSetup
          ? new Proxy(proxyToUse!, {
              get(target, key, receiver) {
                warn(
                  `Property '${String(
                    key,
                  )}' was accessed via 'this'. Avoid using 'this' in templates.`,
                )
                return Reflect.get(target, key, receiver)
              },
            })
          : proxyToUse
      result = normalizeVNode(
        render!.call(
          thisProxy,
          proxyToUse!,
          renderCache,
          __DEV__ ? shallowReadonly(props) : props,
          setupState,
          data,
          ctx,
        ),
      )
      fallthroughAttrs = attrs
    } else {
      // 函数式组件没有 this 代理；按函数形参数量决定是否分配 context。
      const render = Component as FunctionalComponent
      // 无 props 声明时 attrs===props，读取 props 即等价消费 attrs，避免透传警告。
      if (__DEV__ && attrs === props) {
        markAttrsAccessed()
      }
      result = normalizeVNode(
        render.length > 1
          ? render(
              __DEV__ ? shallowReadonly(props) : props,
              __DEV__
                ? {
                    get attrs() {
                      markAttrsAccessed()
                      return shallowReadonly(attrs)
                    },
                    slots,
                    emit,
                  }
                : { attrs, slots, emit },
            )
          : render(
              __DEV__ ? shallowReadonly(props) : props,
              null as any /* 函数形参数量表明不会读取 context。 */,
            ),
      )
      fallthroughAttrs = Component.props
        ? attrs
        : getFunctionalFallthrough(attrs)
    }
  } catch (err) {
    blockStack.length = 0
    handleError(err, instance, ErrorCodes.RENDER_FUNCTION)
    result = createVNode(Comment)
  }

  // 开发保留根级注释，原本单根模板会表现为 Fragment；先找到真实元素根再处理 attrs。
  let root = result
  let setRoot: SetRootFn = undefined
  if (
    __DEV__ &&
    result.patchFlag > 0 &&
    result.patchFlag & PatchFlags.DEV_ROOT_FRAGMENT
  ) {
    ;[root, setRoot] = getChildRoot(result)
  }

  if (fallthroughAttrs && inheritAttrs !== false) {
    const keys = Object.keys(fallthroughAttrs)
    const { shapeFlag } = root
    if (keys.length) {
      if (shapeFlag & (ShapeFlags.ELEMENT | ShapeFlags.COMPONENT)) {
        if (propsOptions && keys.some(isModelListener)) {
          // #1543/#1643/#1989：若 onUpdate:xxx 对应组件已声明 prop，说明组件自行处理
          // v-model。监听器不能继续透传到根 DOM，否则一次 emit 可能触发两次或产生无效事件。
          fallthroughAttrs = filterModelListeners(
            fallthroughAttrs,
            propsOptions,
          )
        }
        root = cloneVNode(root, fallthroughAttrs, false, true)
      } else if (__DEV__ && !accessedAttrs && root.type !== Comment) {
        const allAttrs = Object.keys(attrs)
        const eventAttrs: string[] = []
        const extraAttrs: string[] = []
        for (let i = 0, l = allAttrs.length; i < l; i++) {
          const key = allAttrs[i]
          if (isOn(key)) {
            // v-model handler 已有专门说明，不作为普通多余事件再次警告。
            if (!isModelListener(key)) {
              // 去掉 on 并只小写首字母，保持剩余事件大小写便于定位。
              eventAttrs.push(key[2].toLowerCase() + key.slice(3))
            }
          } else {
            extraAttrs.push(key)
          }
        }
        if (extraAttrs.length) {
          warn(
            `Extraneous non-props attributes (` +
              `${extraAttrs.join(', ')}) ` +
              `were passed to component but could not be automatically inherited ` +
              `because component renders fragment or text or teleport root nodes.`,
          )
        }
        if (eventAttrs.length) {
          warn(
            `Extraneous non-emits event listeners (` +
              `${eventAttrs.join(', ')}) ` +
              `were passed to component but could not be automatically inherited ` +
              `because component renders fragment or text root nodes. ` +
              `If the listener is intended to be a component custom event listener only, ` +
              `declare it using the "emits" option.`,
          )
        }
      }
    }
  }

  if (
    __COMPAT__ &&
    isCompatEnabled(DeprecationTypes.INSTANCE_ATTRS_CLASS_STYLE, instance) &&
    vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT &&
    root.shapeFlag & (ShapeFlags.ELEMENT | ShapeFlags.COMPONENT)
  ) {
    const { class: cls, style } = vnode.props || {}
    if (cls || style) {
      if (__DEV__ && inheritAttrs === false) {
        warnDeprecation(
          DeprecationTypes.INSTANCE_ATTRS_CLASS_STYLE,
          instance,
          getComponentName(instance.type),
        )
      }
      root = cloneVNode(
        root,
        {
          class: cls,
          style: style,
        },
        false,
        true,
      )
    }
  }

  // 组件 VNode 上的运行时指令实际应作用于组件根元素；先 clone 防止修改提升 VNode。
  if (vnode.dirs) {
    if (__DEV__ && !isElementRoot(root)) {
      warn(
        `Runtime directive used on component with non-element root node. ` +
          `The directives will not function as intended.`,
      )
    }
    root = cloneVNode(root, null, false, true)
    root.dirs = root.dirs ? root.dirs.concat(vnode.dirs) : vnode.dirs
  }
  // Transition 包裹组件时把钩子下发到真实元素根；Teleport 使用其内部可动画 child。
  if (vnode.transition) {
    const child = isTeleport(root.type) ? getInnerChild(root) || root : root
    if (__DEV__ && !isElementRoot(child)) {
      warn(
        `Component inside <Transition> renders non-element root node ` +
          `that cannot be animated.`,
      )
    }
    setTransitionHooks(child, vnode.transition)
  }

  if (__DEV__ && setRoot) {
    setRoot(root)
  } else {
    result = root
  }

  setCurrentRenderingInstance(prev)
  return result
}

/**
 * 开发环境从保留根注释产生的 Fragment 中找到真实单根，并返回写回函数。
 * attrs、scopeId、指令和过渡都要作用于该真实根，而非仅逻辑存在的 Fragment。
 */
const getChildRoot = (vnode: VNode): [VNode, SetRootFn] => {
  const rawChildren = vnode.children as VNodeArrayChildren
  const dynamicChildren = vnode.dynamicChildren
  const childRoot = filterSingleRoot(rawChildren, false)
  if (!childRoot) {
    return [vnode, undefined]
  } else if (
    __DEV__ &&
    childRoot.patchFlag > 0 &&
    childRoot.patchFlag & PatchFlags.DEV_ROOT_FRAGMENT
  ) {
    return getChildRoot(childRoot)
  }

  const index = rawChildren.indexOf(childRoot)
  const dynamicIndex = dynamicChildren ? dynamicChildren.indexOf(childRoot) : -1
  const setRoot: SetRootFn = (updatedRoot: VNode) => {
    rawChildren[index] = updatedRoot
    if (dynamicChildren) {
      if (dynamicIndex > -1) {
        dynamicChildren[dynamicIndex] = updatedRoot
      } else if (updatedRoot.patchFlag > 0) {
        vnode.dynamicChildren = [...dynamicChildren, updatedRoot]
      }
    }
  }
  return [normalizeVNode(childRoot), setRoot]
}

/**
 * 忽略普通用户注释后判断 children 是否恰有一个 VNode 根。
 * `v-if` 注释占位仍算根，因为未来分支可切换为元素；遇到原始非 VNode 或第二个根即失败。
 */
export function filterSingleRoot(
  children: VNodeArrayChildren,
  recurse = true,
): VNode | undefined {
  let singleRoot
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (isVNode(child)) {
      // 忽略用户注释，但保留标记为 `v-if` 的结构占位。
      if (child.type !== Comment || child.children === 'v-if') {
        if (singleRoot) {
          // 第二个非注释根出现，不能自动决定 attrs/transition 应落到哪一个。
          return
        } else {
          singleRoot = child
          if (
            __DEV__ &&
            recurse &&
            singleRoot.patchFlag > 0 &&
            singleRoot.patchFlag & PatchFlags.DEV_ROOT_FRAGMENT
          ) {
            return filterSingleRoot(singleRoot.children as VNodeArrayChildren)
          }
        }
      }
    } else {
      return
    }
  }
  return singleRoot
}

/** 无 props 声明的函数式组件只自动透传 class、style 与事件，避免任意 attribute 泄漏。 */
const getFunctionalFallthrough = (attrs: Data): Data | undefined => {
  let res: Data | undefined
  for (const key in attrs) {
    if (key === 'class' || key === 'style' || isOn(key)) {
      ;(res || (res = {}))[key] = attrs[key]
    }
  }
  return res
}

/** 移除已有对应声明 prop 的 v-model update listener，剩余 attrs 继续透传。 */
const filterModelListeners = (attrs: Data, props: NormalizedProps): Data => {
  const res: Data = {}
  for (const key in attrs) {
    if (!isModelListener(key) || !(key.slice(9) in props)) {
      res[key] = attrs[key]
    }
  }
  return res
}

/** 判断根是否能承载 attrs/指令/过渡；v-if 注释可能下次切成元素，因此允许。 */
const isElementRoot = (vnode: VNode) => {
  return (
    vnode.shapeFlag & (ShapeFlags.COMPONENT | ShapeFlags.ELEMENT) ||
    vnode.type === Comment // potential v-if branch switch
  )
}

/**
 * 判断父级新 VNode 是否需要重新执行子组件 render effect。
 *
 * 优化模板按 patchFlag 只检查动态 slots/props；手写 render 无静态保证，children 默认
 * 强制更新。emit listeners 不属于组件渲染输入，单独变化不应导致子组件重渲染。
 */
export function shouldUpdateComponent(
  prevVNode: VNode,
  nextVNode: VNode,
  optimized?: boolean,
): boolean {
  const { props: prevProps, children: prevChildren, component } = prevVNode
  const { props: nextProps, children: nextChildren, patchFlag } = nextVNode
  const emits = component!.emitsOptions

  // 父 render HMR 后 slots 函数内容可能变化，即使引用/props 看似相同也强制更新子组件。
  if (__DEV__ && (prevChildren || nextChildren) && isHmrUpdating) {
    return true
  }

  // 组件 VNode 上指令/transition 需要重新下发到新根，强制更新。
  if (nextVNode.dirs || nextVNode.transition) {
    return true
  }

  if (optimized && patchFlag >= 0) {
    if (patchFlag & PatchFlags.DYNAMIC_SLOTS) {
      // 动态 slots（如 v-for 内引用外部值）必须重新执行。
      return true
    }
    if (patchFlag & PatchFlags.FULL_PROPS) {
      if (!prevProps) {
        return !!nextProps
      }
      // FULL_PROPS 由存在 props 的编译节点生成，nextProps 可非空断言。
      return hasPropsChanged(prevProps, nextProps!, emits)
    } else if (patchFlag & PatchFlags.PROPS) {
      const dynamicProps = nextVNode.dynamicProps!
      for (let i = 0; i < dynamicProps.length; i++) {
        const key = dynamicProps[i]
        if (
          hasPropValueChanged(nextProps!, prevProps!, key) &&
          !isEmitListener(emits, key)
        ) {
          return true
        }
      }
    }
  } else {
    // 手写 render 没有编译稳定性；除显式 `$stable` 外，存在 children 即保守更新。
    if (prevChildren || nextChildren) {
      if (!nextChildren || !(nextChildren as any).$stable) {
        return true
      }
    }
    if (prevProps === nextProps) {
      return false
    }
    if (!prevProps) {
      return !!nextProps
    }
    if (!nextProps) {
      return true
    }
    return hasPropsChanged(prevProps, nextProps, emits)
  }

  return false
}

/** 完整比较 props 键集合和值，忽略只由父级消费的 emit listeners。 */
function hasPropsChanged(
  prevProps: Data,
  nextProps: Data,
  emitsOptions: ComponentInternalInstance['emitsOptions'],
): boolean {
  const nextKeys = Object.keys(nextProps)
  if (nextKeys.length !== Object.keys(prevProps).length) {
    return true
  }
  for (let i = 0; i < nextKeys.length; i++) {
    const key = nextKeys[i]
    if (
      hasPropValueChanged(nextProps, prevProps, key) &&
      !isEmitListener(emitsOptions, key)
    ) {
      return true
    }
  }
  return false
}

/**
 * 比较单个 prop。style 对象做宽松深比较，避免每次 render 创建等价对象导致无效更新。
 */
function hasPropValueChanged(
  nextProps: Data,
  prevProps: Data,
  key: string,
): boolean {
  const nextProp = nextProps[key]
  const prevProp = prevProps[key]
  if (key === 'style' && isObject(nextProp) && isObject(prevProp)) {
    return !looseEqual(nextProp, prevProp)
  }
  return nextProp !== prevProp
}

/**
 * 组件自身更新导致根宿主节点变化时，沿仅以该组件为单根的 HOC/Suspense 链传播 el。
 * 外层 VNode 的 move、ref 和 unmount 都依赖它始终指向当前真实根。
 */
export function updateHOCHostEl(
  { vnode, parent, suspense }: ComponentInternalInstance,
  el: typeof vnode.el, // HostNode
): void {
  while (parent) {
    const root = parent.subTree
    if (root.suspense && root.suspense.activeBranch === vnode) {
      // Suspense VNode 代理活动分支宿主节点；先更新边界，再继续向更外层包装传播。
      root.suspense.vnode.el = root.el = el
      vnode = root
    }
    if (root === vnode) {
      ;(vnode = parent.vnode).el = el
      parent = parent.parent
    } else {
      break
    }
  }
  // 当前组件直接属于 Suspense 活动分支时同步边界 VNode。
  if (suspense && suspense.activeBranch === vnode) {
    suspense.vnode.el = el
  }
}
