import { isObject, toHandlerKey } from '@vue/shared'
import { warn } from '../warning'

/**
 * 把 `v-on="obj"` 对象转换为 VNode props 使用的事件处理器对象。
 *
 * 普通事件名通过 `toHandlerKey` 转成 `onXxx`。自定义元素可能区分事件名大小写；当
 * `preserveCaseIfNecessary` 为真且键中含大写字母时，改用 `on:原名`，避免 camelize
 * 破坏原始事件名。
 *
 * @private 编译器生成代码使用的运行时辅助函数，不属于稳定的用户 API。
 */
export function toHandlers(
  obj: Record<string, any>,
  preserveCaseIfNecessary?: boolean,
): Record<string, any> {
  const ret: Record<string, any> = {}
  if (__DEV__ && !isObject(obj)) {
    warn(`v-on with no argument expects an object value.`)
    return ret
  }
  for (const key in obj) {
    ret[
      preserveCaseIfNecessary && /[A-Z]/.test(key)
        ? `on:${key}`
        : toHandlerKey(key)
    ] = obj[key]
  }
  return ret
}
