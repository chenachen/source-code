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
  duration?:
     number
    | {
        /** 入场显式时长，单位毫秒。 */
        enter: number;
        /**
         * 离场显式时长，单位毫秒。
         */
        leave: number
      }
  // 自定义各阶段 class；未提供时由 name 生成。
  /** 入场起态类，双 RAF 后移除；默认由 name 生成。 */
  enterFromClass?: string
  /** 入场整个过程持有的类，完成或取消时移除。 */
  enterActiveClass?: string
  /** 双 RAF 后的入场目标态类，完成或取消时移除。 */
  enterToClass?: string
  /** 首次 appear 的起态类，未设置回退 enterFromClass。 */
  appearFromClass?: string
  /** 首次 appear 的活动类，未设置回退 enterActiveClass。 */
  appearActiveClass?: string
  /** 首次 appear 的目标态类，未设置回退 enterToClass。 */
  appearToClass?: string
  /** 离场起态类，先强制布局固化再切换目标态。 */
  leaveFromClass?: string
  /** 离场期间持有的类，与 enter 取消状态共同决定 reflow 顺序。 */
  leaveActiveClass?: string
  /** 双 RAF 后的离场目标态类，完成/取消时清理。 */
  leaveToClass?: string
}

/** 元素上保存 Vue 临时 Transition Classes 集合的私有键。 */
export const vtcKey: unique symbol = Symbol('_vtc')

/** 带运行中过渡 class 记录的元素。 */
export interface ElementWithTransition extends HTMLElement {
  // `_vtc` = Vue Transition Classes。patchClass 会合并这组临时类，避免响应式 class
  // 更新在过渡中途把 enter/leave class 覆盖掉。
  /** 该元素当前过渡class的Set；patchClass合并这些class以避免普通class更新覆盖动画状态，removeTransitionClass同步移除记录。 */
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
 * 钩子是否声明第二个 done 参数。存在时由用户调用 done 结束，Vue 不再自动等 CSS 或 duration。
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
 * enter/appear：首帧写 from+active，双 RAF 后切 to；未声明 done 的 hook 才自动结束。
 * 自动路径中，显式 duration 直接计时，否则检测 CSS 结束事件并用计算时长兜底。
 * leave 流程类似但先强制 reflow 固化起态；声明 done 时由用户调用它结束。
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
    /** compat 模式去掉 -from 后缀，得到 Vue 2 起态类名。 */
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

  /** 记录是否取消入场，清理 appear/enter 的 to 与 active 类，再调用 core done 结算钩子。 */
  const finishEnter = (
    el: Element & {
      /** 上次入场是否被取消；leave 据此决定 active 类与 reflow 的先后。 */
      _enterCancelled?: boolean
    },
    isAppear: boolean,
    done?: () => void,
    isCancelled?: boolean,
  ) => {
    el._enterCancelled = isCancelled
    removeTransitionClass(el, isAppear ? appearToClass : enterToClass)
    removeTransitionClass(el, isAppear ? appearActiveClass : enterActiveClass)
    done && done()
  }

  /** 清除离场运行标记与 from/to/active 类，再调用 done，让 core 执行移除/完成钩子。 */
  const finishLeave = (
    el: Element & {
      /** 当前离场是否仍有效；双 RAF 恢复时读取，取消后不继续写 leave-to。 */
      _isLeaving?: boolean
    },
    done?: () => void,
  ) => {
    el._isLeaving = false
    removeTransitionClass(el, leaveFromClass)
    removeTransitionClass(el, leaveToClass)
    removeTransitionClass(el, leaveActiveClass)
    done && done()
  }

  /** 生成 enter/appear 桥接器；先调用用户钩子，双 RAF 切目标类；用户未声明 done 才自动等待 CSS/显式时长。 */
  const makeEnterHook = (isAppear: boolean) => {
    return (el: Element, done: () => void) => {
      const hook = isAppear ? onAppear : onEnter
      /** 把本次 enter/appear 自动结束转交 finishEnter，再完成 core 回调。 */
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
    /** 调用用户 beforeEnter，写入 enter-from 与 active 起态类。 */
    onBeforeEnter(el) {
      callHook(onBeforeEnter, [el])
      addTransitionClass(el, enterFromClass)
      if (__COMPAT__ && legacyClassEnabled && legacyEnterFromClass) {
        addTransitionClass(el, legacyEnterFromClass)
      }
      addTransitionClass(el, enterActiveClass)
    },
    /** 调用用户 beforeAppear，写入 appear 起态类及兼容旧类。 */
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
    /** 标记离场，按入场是否取消安排 reflow 与 active 类；双 RAF 切 leave-to，显式 done 与 CSS 自动完成二选一。 */
    onLeave(
      el: Element & {
        /** 离场双 RAF 是否仍可推进的元素状态。 */
        _isLeaving?: boolean;
        /**
         * 入场取消结果，决定本次离场 reflow 顺序。
         */
        _enterCancelled?: boolean
      },
      done,
    ) {
      el._isLeaving = true
      /** 将本次用户 done 或 CSS 自动完成转交 finishLeave。 */
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
    /** 清理入场样式并保留取消标记，然后通知用户取消钩子。 */
    onEnterCancelled(el) {
      finishEnter(el, false, undefined, true)
      callHook(onEnterCancelled, [el])
    },
    /** 清理首次 appear 样式并标记取消，然后通知用户钩子。 */
    onAppearCancelled(el) {
      finishEnter(el, true, undefined, true)
      callHook(onAppearCancelled, [el])
    },
    /** 立即清理离场样式/标记，再调用用户取消钩子。 */
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
  el: Element & {
    /** 元素当前结束监听代次；过期 timeout/event 不得完成更新后的过渡。 */
    _endId?: number
  },
  expectedType: TransitionProps['type'] | undefined,
  explicitTimeout: number | null,
  resolve: () => void,
) {
  const id = (el._endId = ++endId)
  /** 仅在元素 _endId 仍等于捕获代次时调用 resolve，拒绝旧过渡完成。 */
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
  /** 移除 CSS end 监听器后按版本结算；兜底 timeout 与有效 end 事件共用。 */
  const end = () => {
    el.removeEventListener(endEvent, onEnd)
    resolveIfNotStale()
  }
  /** 只统计目标为本元素的 CSS end 事件；达到计算属性数后移除监听并结束。 */
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
  /** 实际需等待的 CSS 类型；无正时长时为 null。 */
  type: AnimationTypes | null
  /** 所选类型的 duration 列表长度，用于统计 end 事件数。 */
  propCount: number
  /** 所选类型最长 delay+duration，单位毫秒。 */
  timeout: number
  /** 有效类型为 transition 且 property 包含 transform/all；供 TransitionGroup 探测 move。 */
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
  /** 读取指定计算样式时间/属性列表，空值归为空字符串列表，兼容 JSDOM。 */
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
