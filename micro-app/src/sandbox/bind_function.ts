/* eslint-disable no-return-assign */
import {
  isBoundFunction,
  isConstructor,
  rawDefineProperty,
  isBoolean,
  isFunction,
} from '../libs/utils'

/**
 * 判断函数是否已由原生 `bind` 绑定，并把检测结果缓存到函数自身。
 *
 * WHY：代理 window/document 会频繁读取同一原生方法；缓存可避免反复解析函数名和原型，
 * 同时阻止已经绑定的函数被再次绑定到错误目标。
 */
function isBoundedFunction (value: CallableFunction & {
  /** 已完成绑定函数检测时保存的布尔结果。 */
  __MICRO_APP_IS_BOUND_FUNCTION__: boolean
}): boolean {
  if (isBoolean(value.__MICRO_APP_IS_BOUND_FUNCTION__)) return value.__MICRO_APP_IS_BOUND_FUNCTION__
  return value.__MICRO_APP_IS_BOUND_FUNCTION__ = isBoundFunction(value)
}

/**
 * 判断函数是否可作为构造器，并复用写在函数对象上的检测结果。
 *
 * 构造器不得绑定到原生目标，否则 `new`、原型链和 `instanceof` 语义会改变。
 */
function isConstructorFunction (value: FunctionConstructor & {
  /** 已完成构造器检测时保存的布尔结果。 */
  __MICRO_APP_IS_CONSTRUCTOR__: boolean
}) {
  if (isBoolean(value.__MICRO_APP_IS_CONSTRUCTOR__)) return value.__MICRO_APP_IS_CONSTRUCTOR__
  return value.__MICRO_APP_IS_CONSTRUCTOR__ = isConstructor(value)
}

/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/**
 * 将从代理读取的可调用原生方法绑定回真实宿主，并按宿主类别缓存包装函数。
 *
 * @remarks
 * 普通函数绑定后会复制可枚举静态属性，并保留自有 `prototype` 描述符；构造器、
 * 已绑定函数、无 `bind` 的 Safari 特殊宿主对象以及非函数均原样返回。
 * 缓存键包含 `WINDOW`、`DOCUMENT`、`LOCATION` 等调用方类别，避免同一函数绑定到
 * 不同原生目标时错误复用。
 *
 * @param value - 从代理目标读取的候选值。
 * @param rawTarget - 方法真正执行时应使用的 `this`。
 * @param key - 区分绑定目标类别的缓存后缀。
 * @returns 可安全调用的绑定值，或无需处理的原值。
 */
export default function bindFunctionToRawTarget<T = Window, B = unknown> (value: any, rawTarget: T, key = 'WINDOW'): B {
  /**
   * Safari 的嵌套应用 `A → B → C` 中，如果 B 使用 iframe 沙箱、C 使用 with 沙箱，
   * `document.all` 等宿主属性可能呈现 `typeof === 'function'` 却没有 `bind`。
   * 因此必须同时检查函数类别与 `value.bind`，不能只依赖 `typeof`。
   */
  if (isFunction(value) && !isConstructorFunction(value) && !isBoundedFunction(value) && value.bind) {
    const cacheKey = `__MICRO_APP_BOUND_${key}_FUNCTION__`
    if (value[cacheKey]) return value[cacheKey]

    const bindRawObjectValue = value.bind(rawTarget)

    for (const key in value) {
      bindRawObjectValue[key] = value[key]
    }

    if (value.hasOwnProperty('prototype')) {
      rawDefineProperty(bindRawObjectValue, 'prototype', {
        value: value.prototype,
        configurable: true,
        enumerable: false,
        writable: true,
      })
    }

    return value[cacheKey] = bindRawObjectValue
  }

  return value
}
/* eslint-enable @typescript-eslint/explicit-module-boundary-types */
