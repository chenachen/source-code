import { isOn } from '@vue/shared'
import type { ComponentInternalInstance } from '../component'
import { DeprecationTypes, isCompatEnabled } from './compatConfig'

/**
 * 判断某个 attrs 键是否应从 Vue 3 的自动透传中排除。
 * Vue 2 的 `$attrs` 不包含 class/style/listeners，`is` 也有特殊语义；兼容特性开启时
 * 必须跳过这些键，防止它们既被旧 API 消费又重复落到组件根元素。
 */
export function shouldSkipAttr(
  key: string,
  instance: ComponentInternalInstance,
): boolean {
  if (key === 'is') {
    return true
  }
  if (
    (key === 'class' || key === 'style') &&
    isCompatEnabled(DeprecationTypes.INSTANCE_ATTRS_CLASS_STYLE, instance)
  ) {
    return true
  }
  if (
    isOn(key) &&
    isCompatEnabled(DeprecationTypes.INSTANCE_LISTENERS, instance)
  ) {
    return true
  }
  // Vue Router 旧版向 RouterView 注入内部 attrs，它们不是实际 DOM attribute。
  if (key.startsWith('routerView') || key === 'registerRouteInstance') {
    return true
  }
  return false
}
