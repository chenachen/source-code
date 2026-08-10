import { isOn } from '@vue/shared'
import type { ComponentInternalInstance } from '../component'
import { DeprecationTypes, assertCompatEnabled } from './compatConfig'

/**
 * 实现 Vue 2 `$listeners`：从 VNode props 中抽取 `onXxx`，还原为小写首字母事件名。
 * Vue 3 已把监听器并入 `$attrs`；兼容层同时在 attrs 透传中排除这些键，避免重复绑定。
 */
export function getCompatListeners(
  instance: ComponentInternalInstance,
): Record<string, Function | Function[]> {
  assertCompatEnabled(DeprecationTypes.INSTANCE_LISTENERS, instance)

  const listeners: Record<string, Function | Function[]> = {}
  const rawProps = instance.vnode.props
  if (!rawProps) {
    return listeners
  }
  for (const key in rawProps) {
    if (isOn(key)) {
      listeners[key[2].toLowerCase() + key.slice(3)] = rawProps[key]
    }
  }
  return listeners
}
