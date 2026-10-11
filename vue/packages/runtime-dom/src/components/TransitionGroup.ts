import {
  type ElementWithTransition,
  type TransitionProps,
  TransitionPropsValidators,
  addTransitionClass,
  forceReflow,
  getTransitionInfo,
  removeTransitionClass,
  resolveTransitionProps,
  vtcKey,
} from './Transition'
import { type VShowElement, vShowHidden } from '../directives/vShow'
import {
  type ComponentOptions,
  DeprecationTypes,
  Fragment,
  type SetupContext,
  Text,
  type VNode,
  compatUtils,
  createVNode,
  getCurrentInstance,
  getTransitionRawChildren,
  onUpdated,
  resolveTransitionHooks,
  setTransitionHooks,
  toRaw,
  useTransitionState,
  warn,
} from '@vue/runtime-core'
import { extend } from '@vue/shared'

/** 元素布局视口坐标；FLIP 只需要 top/left。 */
interface Position {
  /** 视口中的上边坐标，供新旧布局差值计算。 */
  top: number
  /** 视口中的左边坐标，供新旧布局差值计算。 */
  left: number
}

/** patch 前旧位置。WeakMap 随 VNode 回收。 */
const positionMap = new WeakMap<VNode, Position>()
/** patch 后新位置。 */
const newPositionMap = new WeakMap<VNode, Position>()
/** 元素上当前 move transition 结束回调的私有键。 */
const moveCbKey = Symbol('_moveCb')
/** 本模块独立的入场回调键，与 BaseTransition 保存 enter 回调的 Symbol 不同。 */
const enterCbKey = Symbol('_enterCb')

/** TransitionGroup 不支持 mode，但增加可选包裹 tag 和 moveClass。 */
export type TransitionGroupProps = Omit<TransitionProps, 'mode'> & {
  /** 列表外壳标签；未设置时使用 Fragment，compat 可回退 span。 */
  tag?: string
  /** 移动阶段的 CSS 类；默认由 name 生成，用其 transform transition 决定是否执行 FLIP。 */
  moveClass?: string
}

/** 把删除 mode 等静态装饰封装成 PURE 调用，使未使用组件时可 tree-shaking。 */
const decorate = (t: typeof TransitionGroupImpl) => {
  // TransitionGroup 同时处理多个节点，无法支持单节点 out-in/in-out mode。直接 delete
  // 会被视为模块副作用，放进 PURE decorate 允许整段删除。
  delete t.props.mode
  if (__COMPAT__) {
    t.__isBuiltIn = true
  }
  return t
}

/**
 * 使用 FLIP 技术为 keyed children 的位置变化添加 CSS transform 过渡。
 * render 前记录旧位置；DOM patch 后记录新位置并先反向 translate 回旧视觉位置，强制
 * reflow 后清 transform，浏览器便动画到新布局位置。
 */
const TransitionGroupImpl: ComponentOptions = /*@__PURE__*/ decorate({
  name: 'TransitionGroup',

  props: /*@__PURE__*/ extend({}, TransitionPropsValidators, {
    tag: String,
    moveClass: String,
  }),

  /** 建立跨 render 的 keyed children 与布局缓存，render 记录旧位置，onUpdated 分批读取新布局、写逆向 translate 并登记 move 结束清理。 */
  setup(props: TransitionGroupProps, { slots }: SetupContext) {
    const instance = getCurrentInstance()!
    const state = useTransitionState()
    let prevChildren: VNode[]
    let children: VNode[]

    onUpdated(() => {
      // 首次 render 后 children 才存在；没有旧 keyed 元素便无需 move。
      if (!prevChildren.length) {
        return
      }
      const moveClass = props.moveClass || `${props.name || 'v'}-move`

      if (
        !hasCSSTransform(
          prevChildren[0].el as ElementWithTransition,
          instance.vnode.el as Node,
          moveClass,
        )
      ) {
        prevChildren = []
        return
      }

      // 三个循环按“清回调 → 批量读布局 → 批量写 transform”分离 DOM 读写，避免每个
      // 元素交替读写触发 layout thrashing。
      prevChildren.forEach(callPendingCbs)
      prevChildren.forEach(recordPosition)
      const movedChildren = prevChildren.filter(applyTranslation)

      // 固化反向 translate 起态，再清 transform 触发 move 过渡。
      forceReflow(instance.vnode.el as Node)

      movedChildren.forEach(c => {
        const el = c.el as ElementWithTransition
        const style = el.style
        addTransitionClass(el, moveClass)
        style.transform = style.webkitTransform = style.transitionDuration = ''
        /**
         * move 结束监听：只处理本元素 transform 结束，或无参数的主动清理；解绑 listener、清私有回调并移除 moveClass。
         */
        const cb = ((el as any)[moveCbKey] = (e: TransitionEvent) => {
          if (e && e.target !== el) {
            return
          }
          if (!e || e.propertyName.endsWith('transform')) {
            el.removeEventListener('transitionend', cb)
            ;(el as any)[moveCbKey] = null
            removeTransitionClass(el, moveClass)
          }
        })
        el.addEventListener('transitionend', cb)
      })
      prevChildren = []
    })

    return () => {
      const rawProps = toRaw(props)
      const cssTransitionProps = resolveTransitionProps(rawProps)
      let tag = rawProps.tag || Fragment

      if (
        __COMPAT__ &&
        !rawProps.tag &&
        compatUtils.checkCompatEnabled(
          DeprecationTypes.TRANSITION_GROUP_ROOT,
          instance.parent,
        )
      ) {
        tag = 'span'
      }

      prevChildren = []
      if (children) {
        for (let i = 0; i < children.length; i++) {
          const child = children[i]
          if (
            child.el &&
            child.el instanceof Element &&
            // v-show 隐藏节点没有可用旧布局盒，不能参与 FLIP。
            !(child.el as VShowElement)[vShowHidden]
          ) {
            prevChildren.push(child)
            setTransitionHooks(
              child,
              resolveTransitionHooks(
                child,
                cssTransitionProps,
                state,
                instance,
              ),
            )
            positionMap.set(child, getPosition(child.el as HTMLElement))
          }
        }
      }

      children = slots.default ? getTransitionRawChildren(slots.default()) : []

      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (child.key != null) {
          setTransitionHooks(
            child,
            resolveTransitionHooks(child, cssTransitionProps, state, instance),
          )
        } else if (__DEV__ && child.type !== Text) {
          warn(`<TransitionGroup> children must be keyed.`)
        }
      }

      return createVNode(tag, null, children)
    }
  },
})

/** 公开 TransitionGroup 虚拟构造器类型。 */
export const TransitionGroup = TransitionGroupImpl as unknown as {
  /** 供 h/TSX 推导 props 的虚拟构造签名；运行时仍是组件对象。 */
  new (): {
    /** TransitionGroup 对外 props 类型，排除单根 mode。 */
    $props: TransitionGroupProps
  }
}

/** 开始新 move 前结束本模块保存的旧 move；下方 enter 键不与 BaseTransition 共享，读不到 core 的入场回调。 */
function callPendingCbs(c: VNode) {
  const el = c.el as any
  if (el[moveCbKey]) {
    el[moveCbKey]()
  }
  if (el[enterCbKey]) {
    el[enterCbKey]()
  }
}

/** 在 DOM 更新后记录节点新布局位置。 */
function recordPosition(c: VNode) {
  newPositionMap.set(c, getPosition(c.el as HTMLElement))
}

/**
 * FLIP 的 Invert 阶段：按新旧坐标差写反向 translate，并暂停 transition。
 * 元素已有 CSS scale 时用 rect/offset 尺寸换算视觉坐标，避免位移量被 scale 放大。
 */
function applyTranslation(c: VNode): VNode | undefined {
  const oldPos = positionMap.get(c)!
  const newPos = newPositionMap.get(c)!
  const dx = oldPos.left - newPos.left
  const dy = oldPos.top - newPos.top
  if (dx || dy) {
    const el = c.el as HTMLElement
    const s = el.style
    const rect = el.getBoundingClientRect()
    let scaleX = 1
    let scaleY = 1
    if (el.offsetWidth) scaleX = rect.width / el.offsetWidth
    if (el.offsetHeight) scaleY = rect.height / el.offsetHeight
    if (!Number.isFinite(scaleX) || scaleX === 0) scaleX = 1
    if (!Number.isFinite(scaleY) || scaleY === 0) scaleY = 1
    // scale 接近 1 时消除浮点测量噪声，避免生成细小错误位移。
    if (Math.abs(scaleX - 1) < 0.01) scaleX = 1
    if (Math.abs(scaleY - 1) < 0.01) scaleY = 1
    s.transform = s.webkitTransform = `translate(${dx / scaleX}px,${
      dy / scaleY
    }px)`
    s.transitionDuration = '0s'
    return c
  }
}

/** 读取元素当前视口布局位置。 */
function getPosition(el: HTMLElement): Position {
  const rect = el.getBoundingClientRect()
  return {
    left: rect.left,
    top: rect.top,
  }
}

/**
 * 探测 moveClass 是否定义了 transform transition。
 * clone 元素并移除 enter/leave 临时类，只保留 moveClass 后读计算样式，避免当前进场过渡
 * 干扰判断；clone 设 display:none，减少对页面布局影响。
 */
function hasCSSTransform(
  el: ElementWithTransition,
  root: Node,
  moveClass: string,
): boolean {
  const clone = el.cloneNode() as HTMLElement
  const _vtc = el[vtcKey]
  if (_vtc) {
    _vtc.forEach(cls => {
      cls.split(/\s+/).forEach(c => c && clone.classList.remove(c))
    })
  }
  moveClass.split(/\s+/).forEach(c => c && clone.classList.add(c))
  clone.style.display = 'none'
  const container = (
    root.nodeType === 1 ? root : root.parentNode
  ) as HTMLElement
  container.appendChild(clone)
  const { hasTransform } = getTransitionInfo(clone)
  container.removeChild(clone)
  return hasTransform
}
