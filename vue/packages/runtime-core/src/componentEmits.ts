import {
  EMPTY_OBJ,
  type OverloadParameters,
  type UnionToIntersection,
  camelize,
  extend,
  hasOwn,
  hyphenate,
  isArray,
  isFunction,
  isObject,
  isOn,
  isString,
  looseToNumber,
  toHandlerKey,
} from '@vue/shared'
import {
  type ComponentInternalInstance,
  type ComponentOptions,
  type ConcreteComponent,
  formatComponentName,
} from './component'
import { ErrorCodes, callWithAsyncErrorHandling } from './errorHandling'
import { warn } from './warning'
import { devtoolsComponentEmit } from './devtools'
import type { AppContext } from './apiCreateApp'
import { emit as compatInstanceEmit } from './compat/instanceEventEmitter'
import {
  compatModelEmit,
  compatModelEventPrefix,
} from './compat/componentVModel'
import type { ComponentTypeEmits } from './apiSetupHelpers'
import { getModelModifiers } from './helpers/useModel'
import type { ComponentPublicInstance } from './componentPublicInstance'

/** 对象 emits 声明：事件名映射校验函数、参数元组或 null。 */
export type ObjectEmitsOptions = Record<
  string,
  ((...args: any[]) => any) | null | any[]
>

/** 运行时 emits 支持对象校验语法或事件名数组语法。 */
export type EmitsOptions = ObjectEmitsOptions | string[]

/** 把 emits 声明转换为父组件可传入的 `onEvent` props 类型。 */
export type EmitsToProps<T extends EmitsOptions | ComponentTypeEmits> =
  T extends string[]
    ? {
        [K in `on${Capitalize<T[number]>}`]?: (...args: any[]) => any
      }
    : T extends ObjectEmitsOptions
      ? {
          [K in string & keyof T as `on${Capitalize<K>}`]?: (
            ...args: T[K] extends (...args: infer P) => any
              ? P
              : T[K] extends null
                ? any[]
                : T[K] extends any[]
                  ? T[K]
                  : never
          ) => any
        }
      : {}

/** 把类型宏产生的 emits 元组/重载声明转换成运行时对象函数形态。 */
export type TypeEmitsToOptions<T extends ComponentTypeEmits> = {
  [K in keyof T & string]: T[K] extends [...args: infer Args]
    ? (...args: Args) => any
    : () => any
} & (T extends (...args: any[]) => any
  ? ParametersToFns<OverloadParameters<T>>
  : {})

/** 把 emit 重载参数联合拆为“事件名 → 参数函数”映射。 */
type ParametersToFns<T extends any[]> = {
  [K in T[0]]: IsStringLiteral<K> extends true
    ? (
        ...args: T extends [e: infer E, ...args: infer P]
          ? K extends E
            ? P
            : never
          : never
      ) => any
    : never
}

/** 区分具体事件字符串字面量与宽泛 string。 */
type IsStringLiteral<T> = T extends string
  ? string extends T
    ? false
    : true
  : false

/** 把 `{ change: [id: number] }` 简写转换成对象 emits 函数签名。 */
export type ShortEmitsToObject<E> =
  E extends Record<string, any[]>
    ? {
        [K in keyof E]: (...args: E[K]) => any
      }
    : E

/** 从 emits 选项生成带事件名区分的 `$emit`/setup emit 重载函数。 */
export type EmitFn<
  Options = ObjectEmitsOptions,
  Event extends keyof Options = keyof Options,
> =
  Options extends Array<infer V>
    ? (event: V, ...args: any[]) => void
    : {} extends Options // 默认空对象仍需转换为接受任意事件的函数。
      ? (event: string, ...args: any[]) => void
      : UnionToIntersection<
          {
            [key in Event]: Options[key] extends (...args: infer Args) => any
              ? (event: key, ...args: Args) => void
              : Options[key] extends any[]
                ? (event: key, ...args: Options[key]) => void
                : (event: key, ...args: any[]) => void
          }[Event]
        >

/**
 * 从组件实例向父 VNode props 分发自定义事件。
 *
 * 开发环境校验声明和参数；v-model update 先应用 trim/number；处理大小写与 kebab 兼容
 * 查找、once 去重、异步错误边界和 Vue 2 compat。组件已卸载时直接忽略迟到异步事件。
 */
export function emit(
  instance: ComponentInternalInstance,
  event: string,
  ...rawArgs: any[]
): ComponentPublicInstance | null | undefined {
  if (instance.isUnmounted) return
  const props = instance.vnode.props || EMPTY_OBJ

  if (__DEV__) {
    const {
      emitsOptions,
      propsOptions: [propsOptions],
    } = instance
    if (emitsOptions) {
      if (
        !(event in emitsOptions) &&
        !(
          __COMPAT__ &&
          (event.startsWith('hook:') ||
            event.startsWith(compatModelEventPrefix))
        )
      ) {
        if (!propsOptions || !(toHandlerKey(camelize(event)) in propsOptions)) {
          warn(
            `Component emitted event "${event}" but it is neither declared in ` +
              `the emits option nor as an "${toHandlerKey(camelize(event))}" prop.`,
          )
        }
      } else {
        const validator = emitsOptions[event]
        if (isFunction(validator)) {
          const isValid = validator(...rawArgs)
          if (!isValid) {
            warn(
              `Invalid event arguments: event validation failed for event "${event}".`,
            )
          }
        }
      }
    }
  }

  let args = rawArgs
  const isCompatModelListener =
    __COMPAT__ && compatModelEventPrefix + event in props
  const isModelListener = isCompatModelListener || event.startsWith('update:')
  const modifiers = isCompatModelListener
    ? props.modelModifiers
    : isModelListener && getModelModifiers(props, event.slice(7))

  // v-model update 在交给父监听器前应用模板修饰符；其他自定义事件保持原参数。
  if (modifiers) {
    if (modifiers.trim) {
      args = rawArgs.map(a => (isString(a) ? a.trim() : a))
    }
    if (modifiers.number) {
      args = rawArgs.map(looseToNumber)
    }
  }

  if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
    devtoolsComponentEmit(instance, event, args)
  }

  if (__DEV__) {
    const lowerCaseEvent = event.toLowerCase()
    if (lowerCaseEvent !== event && props[toHandlerKey(lowerCaseEvent)]) {
      warn(
        `Event "${lowerCaseEvent}" is emitted in component ` +
          `${formatComponentName(
            instance,
            instance.type,
          )} but the handler is registered for "${event}". ` +
          `Note that HTML attributes are case-insensitive and you cannot use ` +
          `v-on to listen to camelCase events when using in-DOM templates. ` +
          `You should probably use "${hyphenate(
            event,
          )}" instead of "${event}".`,
      )
    }
  }

  let handlerName
  let handler =
    props[(handlerName = toHandlerKey(event))] ||
    // #2249：emit('foo-bar') 同时尝试父 props `onFooBar`，兼容模板 camelCase 标准化。
    props[(handlerName = toHandlerKey(camelize(event)))]
  // model listener 再尝试 kebab-case，覆盖父级以原属性名透传的场景。
  if (!handler && isModelListener) {
    handler = props[(handlerName = toHandlerKey(hyphenate(event)))]
  }

  if (handler) {
    callWithAsyncErrorHandling(
      handler,
      instance,
      ErrorCodes.COMPONENT_EVENT_HANDLER,
      args,
    )
  }

  const onceHandler = props[handlerName + `Once`]
  if (onceHandler) {
    if (!instance.emitted) {
      instance.emitted = {}
    } else if (instance.emitted[handlerName]) {
      return
    }
    instance.emitted[handlerName] = true
    callWithAsyncErrorHandling(
      onceHandler,
      instance,
      ErrorCodes.COMPONENT_EVENT_HANDLER,
      args,
    )
  }

  if (__COMPAT__) {
    compatModelEmit(instance, event, args)
    return compatInstanceEmit(instance, event, args)
  }
}

/** mixin/extends emits 规范化结果缓存，避免递归合并重复执行。 */
const mixinEmitsCache = new WeakMap<ConcreteComponent, ObjectEmitsOptions>()
/** 合并全局 mixin、extends、局部 mixins 与组件自身 emits，并统一为对象映射。 */
export function normalizeEmitsOptions(
  comp: ConcreteComponent,
  appContext: AppContext,
  asMixin = false,
): ObjectEmitsOptions | null {
  const cache =
    __FEATURE_OPTIONS_API__ && asMixin ? mixinEmitsCache : appContext.emitsCache
  const cached = cache.get(comp)
  if (cached !== undefined) {
    return cached
  }

  const raw = comp.emits
  let normalized: ObjectEmitsOptions = {}

  // 合并顺序与 Options API 一致，组件自身声明最后覆盖继承校验器。
  let hasExtends = false
  if (__FEATURE_OPTIONS_API__ && !isFunction(comp)) {
    const extendEmits = (raw: ComponentOptions) => {
      const normalizedFromExtend = normalizeEmitsOptions(raw, appContext, true)
      if (normalizedFromExtend) {
        hasExtends = true
        extend(normalized, normalizedFromExtend)
      }
    }
    if (!asMixin && appContext.mixins.length) {
      appContext.mixins.forEach(extendEmits)
    }
    if (comp.extends) {
      extendEmits(comp.extends)
    }
    if (comp.mixins) {
      comp.mixins.forEach(extendEmits)
    }
  }

  if (!raw && !hasExtends) {
    if (isObject(comp)) {
      cache.set(comp, null)
    }
    return null
  }

  if (isArray(raw)) {
    raw.forEach(key => (normalized[key] = null))
  } else {
    extend(normalized, raw)
  }

  if (isObject(comp)) {
    cache.set(comp, normalized)
  }
  return normalized
}

/**
 * 判断输入 prop 是否为已声明事件监听器，因此应由 emit 消费而非落入 `$attrs`。
 * 例如 `emits: { click: null }` 同时匹配 `onClick` 与 `onclick`。
 */
export function isEmitListener(
  options: ObjectEmitsOptions | null,
  key: string,
): boolean {
  if (!options || !isOn(key)) {
    return false
  }

  if (__COMPAT__ && key.startsWith(compatModelEventPrefix)) {
    return true
  }
  key = key.slice(2)
  // #8342：`.once` 给处理器追加 `Once`。事件本身名为 `once` 时 `onOnce` 不应被剥空；
  // `onOnceOnce` 才表示 once 事件的单次监听器，需要去掉最后一个后缀。
  key = key === 'Once' ? key : key.replace(/Once$/, '')
  return (
    hasOwn(options, key[0].toLowerCase() + key.slice(1)) ||
    hasOwn(options, hyphenate(key)) ||
    hasOwn(options, key)
  )
}
