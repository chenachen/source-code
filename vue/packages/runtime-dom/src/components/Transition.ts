import {
  BaseTransition,
  type BaseTransitionProps,
  BaseTransitionPropsValidators,
  DeprecationTypes,
  type FunctionalComponent,
  assertNumber,
  compatUtils,
  h,
} from '@vue/runtime-core'
import { extend, isArray, isObject, toNumber } from '@vue/shared'

/** CSS transition 事件/计算样式前缀。 */
const TRANSITION = 'transition'
/** CSS animation 事件/计算样式前缀。 */
const ANIMATION = 'animation'

/** Vue 自动等待的 CSS 过渡机制类型。 */
type AnimationTypes = typeof TRANSITION | typeof ANIMATION

/** DOM `<Transition>` 在平台无关 BaseTransition props 上增加的 CSS 配置。 */
export interface TransitionProps extends BaseTransitionProps<Element> {
  /** 自动生成 class 的前缀，默认 `v`。 */
  name?: string
  /** 强制只检测 transition 或 animation；未设时选择超时更长者。 */
  type?: AnimationTypes
  /** 是否启用 CSS class/结束事件管理；false 表示纯 JS 钩子。 */
  css?: boolean
  /** 显式毫秒时长，可分别指定 enter/leave。 */
  duration?: number | { enter: number; leave: number }
  // 自定义各阶段 class；未提供时由 name 生成。
  enterFromClass?: string
  enterActiveClass?: string
  enterToClass?: string
  appearFromClass?: string
  appearActiveClass?: string
  appearToClass?: string
  leaveFromClass?: string
  leaveActiveClass?: string
  leaveToClass?: string
}

/** 元素上保存 Vue 临时 Transition Classes 集合的私有键。 */
export const vtcKey: unique symbol = Symbol('_vtc')

/** 带运行中过渡 class 记录的元素。 */
export interface ElementWithTransition extends HTMLElement {
  // `_vtc` = Vue Transition Classes。patchClass 会合并这组临时类，避免响应式 class
  // 更新在过渡中途把 enter/leave class 覆盖掉。
  [vtcKey]?: Set<string>
}

/** DOM CSS 过渡专属 props 的运行时校验声明。 */
const DOMTransitionPropsValidators = {
  name: String,
  type: String,
  css: {
    type: Boolean,
    default: true,
  },
  duration: [String, Number, Object],
  enterFromClass: String,
  enterActiveClass: String,
  enterToClass: String,
  appearFromClass: String,
  appearActiveClass: String,
  appearToClass: String,
  leaveFromClass: String,
  leaveActiveClass: String,
  leaveToClass: String,
}

/** BaseTransition 与 DOM Transition props 的合并校验表。 */
export const TransitionPropsValidators: any = /*@__PURE__*/ extend(
  {},
  BaseTransitionPropsValidators as any,
  DOMTransitionPropsValidators,
)

/** 把组件静态字段装饰封装成可标记 PURE 的调用，未使用 Transition 时可整段摇掉。 */
const decorate = (t: typeof Transition) => {
  t.displayName = 'Transition'
  t.props = TransitionPropsValidators
  if (__COMPAT__) {
    t.__isBuiltIn = true
  }
  return t
}

/**
 * DOM `<Transition>` 函数式高阶组件。
 * 把 CSS class/transitionend 逻辑转换成平台无关 BaseTransition 生命周期钩子。
 */
export const Transition: FunctionalComponent<TransitionProps> =
  /*@__PURE__*/ decorate((props, { slots }) =>
    h(BaseTransition, resolveTransitionProps(props), slots),
  )

/**
 * 调用一个或一组过渡钩子。
 * #3227：自定义 HOC 包装 Transition 时，相同传入钩子可能被 VNode props 合并成数组。
 */
const callHook = (
  hook: Function | Function[] | undefined,
  args: any[] = [],
) => {
  if (isArray(hook)) {
    hook.forEach(h => h(...args))
  } else if (hook) {
    hook(...args)
  }
}

/**
 * 钩子是否声明第二个 done 参数。存在时表示用户显式控制结束，Vue 不再自动等 CSS。
 * 数组中任一钩子需要 done，整组都按显式控制处理，避免自动结束抢先清 class。
 */
const hasExplicitCallback = (
  hook: Function | Function[] | undefined,
): boolean => {
  return hook
    ? isArray(hook)
      ? hook.some(h => h.length > 1)
      : hook.length > 1
    : false
}

/**
 * 把 DOM Transition props 转为 BaseTransition 钩子。
 *
 * enter/appear：首帧写 from+active，双 RAF 后切 to，再按显式 duration 或计算样式结束；
 * leave 流程类似但先强制 reflow 固化起态。用户 JS 钩子与 CSS 状态机在同一 done 汇合。
 */
export function resolveTransitionProps(
  rawProps: TransitionProps,
): BaseTransitionProps<Element> {
  const baseProps: BaseTransitionProps<Element> = {}
  for (const key in rawProps) {
    if (!(key in DOMTransitionPropsValidators)) {
      ;(baseProps as any)[key] = (rawProps as any)[key]
    }
  }

  if (rawProps.css === false) {
    return baseProps
  }

  const {
    name = 'v',
    type,
    duration,
    enterFromClass = `${name}-enter-from`,
    enterActiveClass = `${name}-enter-active`,
    enterToClass = `${name}-enter-to`,
    appearFromClass = enterFromClass,
    appearActiveClass = enterActiveClass,
    appearToClass = enterToClass,
    leaveFromClass = `${name}-leave-from`,
    leaveActiveClass = `${name}-leave-active`,
    leaveToClass = `${name}-leave-to`,
  } = rawProps

  // compat 同时添加 Vue 2 的 `v-enter/v-leave`（无 -from）旧 class。
  const legacyClassEnabled =
    __COMPAT__ &&
    compatUtils.isCompatEnabled(DeprecationTypes.TRANSITION_CLASSES, null)
  let legacyEnterFromClass: string
  let legacyAppearFromClass: string
  let legacyLeaveFromClass: string
  if (__COMPAT__ && legacyClassEnabled) {
    const toLegacyClass = (cls: string) => cls.replace(/-from$/, '')
    if (!rawProps.enterFromClass) {
      legacyEnterFromClass = toLegacyClass(enterFromClass)
    }
    if (!rawProps.appearFromClass) {
      legacyAppearFromClass = toLegacyClass(appearFromClass)
    }
    if (!rawProps.leaveFromClass) {
      legacyLeaveFromClass = toLegacyClass(leaveFromClass)
    }
  }

  const durations = normalizeDuration(duration)
  const enterDuration = durations && durations[0]
  const leaveDuration = durations && durations[1]
  const {
    onBeforeEnter,
    onEnter,
    onEnterCancelled,
    onLeave,
    onLeaveCancelled,
    onBeforeAppear = onBeforeEnter,
    onAppear = onEnter,
    onAppearCancelled = onEnterCancelled,
  } = baseProps

  const finishEnter = (
    el: Element & { _enterCancelled?: boolean },
    isAppear: boolean,
    done?: () => void,
    isCancelled?: boolean,
  ) => {
    el._enterCancelled = isCancelled
    removeTransitionClass(el, isAppear ? appearToClass : enterToClass)
    removeTransitionClass(el, isAppear ? appearActiveClass : enterActiveClass)
    done && done()
  }

  const finishLeave = (
    el: Element & { _isLeaving?: boolean },
    done?: () => void,
  ) => {
    el._isLeaving = false
    removeTransitionClass(el, leaveFromClass)
    removeTransitionClass(el, leaveToClass)
    removeTransitionClass(el, leaveActiveClass)
    done && done()
  }

  const makeEnterHook = (isAppear: boolean) => {
    return (el: Element, done: () => void) => {
      const hook = isAppear ? onAppear : onEnter
      const resolve = () => finishEnter(el, isAppear, done)
      callHook(hook, [el, resolve])
      nextFrame(() => {
        removeTransitionClass(el, isAppear ? appearFromClass : enterFromClass)
        if (__COMPAT__ && legacyClassEnabled) {
          const legacyClass = isAppear
            ? legacyAppearFromClass
            : legacyEnterFromClass
          if (legacyClass) {
            removeTransitionClass(el, legacyClass)
          }
        }
        addTransitionClass(el, isAppear ? appearToClass : enterToClass)
        if (!hasExplicitCallback(hook)) {
          whenTransitionEnds(el, type, enterDuration, resolve)
        }
      })
    }
  }

  return extend(baseProps, {
    onBeforeEnter(el) {
      callHook(onBeforeEnter, [el])
      addTransitionClass(el, enterFromClass)
      if (__COMPAT__ && legacyClassEnabled && legacyEnterFromClass) {
        addTransitionClass(el, legacyEnterFromClass)
      }
      addTransitionClass(el, enterActiveClass)
    },
    onBeforeAppear(el) {
      callHook(onBeforeAppear, [el])
      addTransitionClass(el, appearFromClass)
      if (__COMPAT__ && legacyClassEnabled && legacyAppearFromClass) {
        addTransitionClass(el, legacyAppearFromClass)
      }
      addTransitionClass(el, appearActiveClass)
    },
    onEnter: makeEnterHook(false),
    onAppear: makeEnterHook(true),
    onLeave(
      el: Element & { _isLeaving?: boolean; _enterCancelled?: boolean },
      done,
    ) {
      el._isLeaving = true
      const resolve = () => finishLeave(el, done)
      addTransitionClass(el, leaveFromClass)
      if (__COMPAT__ && legacyClassEnabled && legacyLeaveFromClass) {
        addTransitionClass(el, legacyLeaveFromClass)
      }
      // #10677：若 enter 刚被取消，必须让 leave-active 在 reflow 前生效，CSS 才能得到
      // 正确最终状态；未取消场景则先 reflow 固化 leave-from（#2593）再加 active。
      if (!el._enterCancelled) {
        // #2593：读取布局强制浏览器提交 leave-from，下一帧切 leave-to 才会产生过渡。
        forceReflow(el)
        addTransitionClass(el, leaveActiveClass)
      } else {
        addTransitionClass(el, leaveActiveClass)
        forceReflow(el)
      }
      nextFrame(() => {
        if (!el._isLeaving) {
          // 离场已被反向切换取消，不再推进到 leave-to。
          return
        }
        removeTransitionClass(el, leaveFromClass)
        if (__COMPAT__ && legacyClassEnabled && legacyLeaveFromClass) {
          removeTransitionClass(el, legacyLeaveFromClass)
        }
        addTransitionClass(el, leaveToClass)
        if (!hasExplicitCallback(onLeave)) {
          whenTransitionEnds(el, type, leaveDuration, resolve)
        }
      })
      callHook(onLeave, [el, resolve])
    },
    onEnterCancelled(el) {
      finishEnter(el, false, undefined, true)
      callHook(onEnterCancelled, [el])
    },
    onAppearCancelled(el) {
      finishEnter(el, true, undefined, true)
      callHook(onAppearCancelled, [el])
    },
    onLeaveCancelled(el) {
      finishLeave(el)
      callHook(onLeaveCancelled, [el])
    },
  } as BaseTransitionProps<Element>)
}

/** 把单时长或 enter/leave 对象统一为二元毫秒数组，并验证数字有效性。 */
function normalizeDuration(
  duration: TransitionProps['duration'],
): [number, number] | null {
  if (duration == null) {
    return null
  } else if (isObject(duration)) {
    return [NumberOf(duration.enter), NumberOf(duration.leave)]
  } else {
    const n = NumberOf(duration)
    return [n, n]
  }
}

/** 将 duration 转数值，并在开发环境复用 core 数值断言。 */
function NumberOf(val: unknown): number {
  const res = toNumber(val)
  if (__DEV__) {
    assertNumber(res, '<transition> explicit duration')
  }
  return res
}

/** 添加一个可能含多个 token 的过渡 class，并登记到 `_vtc` 防止 patchClass 覆盖。 */
export function addTransitionClass(el: Element, cls: string): void {
  cls.split(/\s+/).forEach(c => c && el.classList.add(c))
  ;(
    (el as ElementWithTransition)[vtcKey] ||
    ((el as ElementWithTransition)[vtcKey] = new Set())
  ).add(cls)
}

/** 移除过渡 class 及 `_vtc` 记录；集合清空后释放字段。 */
export function removeTransitionClass(el: Element, cls: string): void {
  cls.split(/\s+/).forEach(c => c && el.classList.remove(c))
  const _vtc = (el as ElementWithTransition)[vtcKey]
  if (_vtc) {
    _vtc.delete(cls)
    if (!_vtc!.size) {
      ;(el as ElementWithTransition)[vtcKey] = undefined
    }
  }
}

/** 等待两个 animation frame，确保浏览器已提交起始 class 再切换目标 class。 */
function nextFrame(cb: () => void) {
  requestAnimationFrame(() => {
    requestAnimationFrame(cb)
  })
}

/** 全局结束监听代次，用元素 `_endId` 忽略已被新过渡取代的旧 timeout/event。 */
let endId = 0

/**
 * 在显式 timeout 或全部 CSS transition/animation end 后结束当前过渡。
 * 额外 timeout+1 兜底浏览器不触发 end 事件、属性数量统计差异及节点提前隐藏。
 */
function whenTransitionEnds(
  el: Element & { _endId?: number },
  expectedType: TransitionProps['type'] | undefined,
  explicitTimeout: number | null,
  resolve: () => void,
) {
  const id = (el._endId = ++endId)
  const resolveIfNotStale = () => {
    if (id === el._endId) {
      resolve()
    }
  }

  if (explicitTimeout != null) {
    return setTimeout(resolveIfNotStale, explicitTimeout)
  }

  const { type, timeout, propCount } = getTransitionInfo(el, expectedType)
  if (!type) {
    return resolve()
  }

  const endEvent = type + 'end'
  let ended = 0
  const end = () => {
    el.removeEventListener(endEvent, onEnd)
    resolveIfNotStale()
  }
  const onEnd = (e: Event) => {
    if (e.target === el && ++ended >= propCount) {
      end()
    }
  }
  setTimeout(() => {
    if (ended < propCount) {
      end()
    }
  }, timeout + 1)
  el.addEventListener(endEvent, onEnd)
}

/** 从计算样式提取的有效过渡类型、属性数、总超时和 transform 能力。 */
interface CSSTransitionInfo {
  type: AnimationTypes | null
  propCount: number
  timeout: number
  hasTransform: boolean
}

/** 计算样式中 transition/animation 共用的时间属性后缀。 */
type AnimationProperties = 'Delay' | 'Duration'
/** 本模块实际读取的 CSSStyleDeclaration 键联合。 */
type StylePropertiesKey =
  `${AnimationTypes}${AnimationProperties}` | `${typeof TRANSITION}Property`

/**
 * 读取元素计算样式，计算最长 transition/animation 总时间及需等待的属性数量。
 * expectedType 可强制选择一种；否则取总时间更长者。TransitionGroup 还读取 hasTransform。
 */
export function getTransitionInfo(
  el: Element,
  expectedType?: TransitionProps['type'],
): CSSTransitionInfo {
  const styles = window.getComputedStyle(el) as Pick<
    CSSStyleDeclaration,
    StylePropertiesKey
  >
  // JSDOM 可能给 transition 属性返回 undefined，统一成空串数组。
  const getStyleProperties = (key: StylePropertiesKey) =>
    (styles[key] || '').split(', ')
  const transitionDelays = getStyleProperties(`${TRANSITION}Delay`)
  const transitionDurations = getStyleProperties(`${TRANSITION}Duration`)
  const transitionTimeout = getTimeout(transitionDelays, transitionDurations)
  const animationDelays = getStyleProperties(`${ANIMATION}Delay`)
  const animationDurations = getStyleProperties(`${ANIMATION}Duration`)
  const animationTimeout = getTimeout(animationDelays, animationDurations)

  let type: CSSTransitionInfo['type'] = null
  let timeout = 0
  let propCount = 0
  if (expectedType === TRANSITION) {
    if (transitionTimeout > 0) {
      type = TRANSITION
      timeout = transitionTimeout
      propCount = transitionDurations.length
    }
  } else if (expectedType === ANIMATION) {
    if (animationTimeout > 0) {
      type = ANIMATION
      timeout = animationTimeout
      propCount = animationDurations.length
    }
  } else {
    timeout = Math.max(transitionTimeout, animationTimeout)
    type =
      timeout > 0
        ? transitionTimeout > animationTimeout
          ? TRANSITION
          : ANIMATION
        : null
    propCount = type
      ? type === TRANSITION
        ? transitionDurations.length
        : animationDurations.length
      : 0
  }
  const hasTransform =
    type === TRANSITION &&
    /\b(?:transform|all)(?:,|$)/.test(
      getStyleProperties(`${TRANSITION}Property`).toString(),
    )
  return {
    type,
    timeout,
    propCount,
    hasTransform,
  }
}

/**
 * 按 CSS 列表循环规则对齐 delay 与 duration，返回最大 `delay + duration` 毫秒数。
 */
function getTimeout(delays: string[], durations: string[]): number {
  while (delays.length < durations.length) {
    delays = delays.concat(delays)
  }
  return Math.max(...durations.map((d, i) => toMs(d) + toMs(delays[i])))
}

/**
 * 把 CSS 秒值转毫秒。旧 Chromium（<61.0.3163.100）会按地区用逗号作小数点，不替换
 * 会被 Number 错误截断；#8409 还要求把浏览器默认 duration `auto` 视为 0。
 */
function toMs(s: string): number {
  // #8409：部分计算样式 duration 默认值为 auto。
  if (s === 'auto') return 0
  return Number(s.slice(0, -1).replace(',', '.')) * 1000
}

/**
 * 同步读取 body.offsetHeight 强制布局，把当前 class/style 固化为过渡起始状态。
 * 使用元素 ownerDocument，支持 iframe/多 document。
 */
export function forceReflow(el?: Node): number {
  const targetDocument = el ? el.ownerDocument! : document
  return targetDocument.body.offsetHeight
}
