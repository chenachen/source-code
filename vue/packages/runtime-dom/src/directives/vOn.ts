import {
  type ComponentInternalInstance,
  DeprecationTypes,
  type Directive,
  type LegacyConfig,
  compatUtils,
  getCurrentInstance,
} from '@vue/runtime-core'
import { hyphenate, isArray } from '@vue/shared'

/** 键盘/鼠标事件可读取的系统组合键。 */
const systemModifiers = ['ctrl', 'shift', 'alt', 'meta'] as const
/** 系统组合键字面量联合。 */
type SystemModifiers = (typeof systemModifiers)[number]
/** Vue 2 keyNames 中保留的兼容别名。 */
type CompatModifiers = keyof typeof keyNames

/** `v-on` 非 event-options 修饰符联合。 */
export type VOnModifiers = SystemModifiers | ModifierGuards | CompatModifiers
/** 可同时拥有 modifierKeys/button 的事件范围。 */
type KeyedEvent = KeyboardEvent | MouseEvent | TouchEvent

/** 由 `withModifiers()` 在调用用户处理器前执行的行为/条件修饰符名。 */
type ModifierGuards =
  | 'shift'
  | 'ctrl'
  | 'alt'
  | 'meta'
  | 'left'
  | 'right'
  | 'stop'
  | 'prevent'
  | 'self'
  | 'middle'
  | 'exact'
/**
 * 修饰符 guard 表。返回真表示条件不满足、应中止；stop/prevent 执行动作后返回 void。
 */
const modifierGuards: Record<
  ModifierGuards,
  | ((e: Event) => void | boolean)
  | ((e: Event, modifiers: string[]) => void | boolean)
> = {
  /** 先停止冒泡；返回 void，不阻止同处理器后续修饰符和用户函数。 */
  stop: (e: Event) => e.stopPropagation(),
  /** 先阻止默认行为；返回 void，不阻止后续处理器执行。 */
  prevent: (e: Event) => e.preventDefault(),
  /** target 不等于 currentTarget 时拒绝调用用户处理器。 */
  self: (e: Event) => e.target !== e.currentTarget,
  /** 未按 Ctrl 时返回 true，终止包装处理器。 */
  ctrl: (e: Event) => !(e as KeyedEvent).ctrlKey,
  /** 未按 Shift 时拒绝用户处理器。 */
  shift: (e: Event) => !(e as KeyedEvent).shiftKey,
  /** 未按 Alt 时拒绝用户处理器。 */
  alt: (e: Event) => !(e as KeyedEvent).altKey,
  /** 未按 Meta 时拒绝用户处理器。 */
  meta: (e: Event) => !(e as KeyedEvent).metaKey,
  /** 事件有 button 且不是左键时拒绝；无 button 的事件不据此过滤。 */
  left: (e: Event) => 'button' in e && (e as MouseEvent).button !== 0,
  /** 事件有 button 且不是中键时拒绝。 */
  middle: (e: Event) => 'button' in e && (e as MouseEvent).button !== 1,
  /** 事件有 button 且不是右键时拒绝。 */
  right: (e: Event) => 'button' in e && (e as MouseEvent).button !== 2,
  /** 任何正在按下但未在修饰符中声明的系统键都会拒绝，允许所列键组合。 */
  exact: (e, modifiers) =>
    systemModifiers.some(m => (e as any)[`${m}Key`] && !modifiers.includes(m)),
}

/**
 * 给事件处理器包装 `.stop/.prevent/.self/.ctrl/.exact` 等运行时修饰符。
 * 包装结果按原函数 + 修饰符序列缓存，避免每次 render 创建新函数导致事件 invoker 更新。
 * @private 编译器辅助函数。
 */
export const withModifiers = <
  T extends (event: Event, ...args: unknown[]) => any,
>(
  fn: T & {
    /** 原处理器持有的修饰符包装缓存，以修饰符顺序拼接为键；保持跨 render 的函数身份。 */
    _withMods?: { [key: string]: T }
  },
  modifiers: VOnModifiers[],
): T => {
  if (!fn) return fn
  const cache = fn._withMods || (fn._withMods = {})
  const cacheKey = modifiers.join('.')
  return (
    cache[cacheKey] ||

    (
    /**
     * 按声明顺序执行动作/条件 guard，首个返回真者终止；全部通过后将原事件和其余参数传给 fn。
     */
    cache[cacheKey] = ((event, ...args) => {
      for (let i = 0; i < modifiers.length; i++) {
        const guard = modifierGuards[modifiers[i] as ModifierGuards]
        if (guard && guard(event, modifiers)) return
      }
      return fn(event, ...args)
    }) as T)
  )
}

// Vue 2 key alias 兼容；IE11 的 `spacebar` 与 `del` 特例已移除。
/** 旧按键别名到现代 KeyboardEvent.key 经 hyphenate 后值的映射。 */
const keyNames: Record<
  'esc' | 'space' | 'up' | 'left' | 'right' | 'down' | 'delete',
  string
> = {
  esc: 'escape',
  space: ' ',
  up: 'arrow-up',
  left: 'arrow-left',
  right: 'arrow-right',
  down: 'arrow-down',
  delete: 'backspace',
}

/**
 * 给键盘处理器包装按键名过滤。
 * 现代路径比较 `KeyboardEvent.key`；compat 还支持数字 keyCode 与 config.keyCodes。
 * 包装器同样缓存到原函数，保持 render 间身份稳定。
 * @private 编译器辅助函数。
 */
export const withKeys = <T extends (event: KeyboardEvent) => any>(
  fn: T & {
    /** 原处理器持有的按键过滤包装缓存；同一按键序列复用同一函数。 */
    _withKeys?: { [k: string]: T }
  },
  modifiers: string[],
): T => {
  let globalKeyCodes: LegacyConfig['keyCodes']
  let instance: ComponentInternalInstance | null = null
  if (__COMPAT__) {
    instance = getCurrentInstance()
    if (
      compatUtils.isCompatEnabled(DeprecationTypes.CONFIG_KEY_CODES, instance)
    ) {
      if (instance) {
        globalKeyCodes = (instance.appContext.config as LegacyConfig).keyCodes
      }
    }
    if (__DEV__ && modifiers.some(m => /^\d+$/.test(m))) {
      compatUtils.warnDeprecation(
        DeprecationTypes.V_ON_KEYCODE_MODIFIER,
        instance,
      )
    }
  }

  const cache: { [k: string]: T } = fn._withKeys || (fn._withKeys = {})
  const cacheKey = modifiers.join('.')

  return (
    cache[cacheKey] ||

    (
    /**
     * 只处理带 key 的事件，按 hyphenate 后键名/旧别名匹配；compat 再检查数字 keyCode 和 app.keyCodes。
     */
    cache[cacheKey] = (event => {
      if (!('key' in event)) {
        return
      }

      const eventKey = hyphenate(event.key)
      if (
        modifiers.some(
          k =>
            k === eventKey ||
            keyNames[k as unknown as CompatModifiers] === eventKey,
        )
      ) {
        return fn(event)
      }

      if (__COMPAT__) {
        const keyCode = String(event.keyCode)
        if (
          compatUtils.isCompatEnabled(
            DeprecationTypes.V_ON_KEYCODE_MODIFIER,
            instance,
          ) &&
          modifiers.some(mod => mod == keyCode)
        ) {
          return fn(event)
        }
        if (globalKeyCodes) {
          for (const mod of modifiers) {
            const codes = globalKeyCodes[mod]
            if (codes) {
              const matches = isArray(codes)
                ? codes.some(code => String(code) === keyCode)
                : String(codes) === keyCode
              if (matches) {
                return fn(event)
              }
            }
          }
        }
      }
    }) as T)
  )
}

/** TSX/全局指令类型扩展使用的 v-on 指令类型。 */
export type VOnDirective = Directive<any, any, VOnModifiers>
