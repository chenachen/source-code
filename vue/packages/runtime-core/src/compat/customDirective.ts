import { isArray } from '@vue/shared'
import type { ComponentInternalInstance } from '../component'
import type { DirectiveHook, ObjectDirective } from '../directives'
import { DeprecationTypes, softAssertCompatEnabled } from './compatConfig'

/** Vue 2 自定义指令生命周期名称。 */
export interface LegacyDirective {
  bind?: DirectiveHook
  inserted?: DirectiveHook
  update?: DirectiveHook
  componentUpdated?: DirectiveHook
  unbind?: DirectiveHook
}

/** Vue 3 指令钩子到 Vue 2 钩子的时机映射。 */
const legacyDirectiveHookMap: Partial<
  Record<
    keyof ObjectDirective,
    keyof LegacyDirective | (keyof LegacyDirective)[]
  >
> = {
  beforeMount: 'bind',
  mounted: 'inserted',
  updated: ['update', 'componentUpdated'],
  unmounted: 'unbind',
}

/**
 * 为 Vue 3 指令生命周期查找并返回对应的 Vue 2 钩子。
 * `updated` 同时覆盖旧 `update` 与 `componentUpdated`，按旧生命周期顺序依次调用；
 * 每次命中都会经过兼容开关检查和弃用提示。
 */
export function mapCompatDirectiveHook(
  name: keyof ObjectDirective,
  dir: ObjectDirective & LegacyDirective,
  instance: ComponentInternalInstance | null,
): DirectiveHook | DirectiveHook[] | undefined {
  const mappedName = legacyDirectiveHookMap[name]
  if (mappedName) {
    if (isArray(mappedName)) {
      const hook: DirectiveHook[] = []
      mappedName.forEach(mapped => {
        const mappedHook = dir[mapped]
        if (mappedHook) {
          softAssertCompatEnabled(
            DeprecationTypes.CUSTOM_DIR,
            instance,
            mapped,
            name,
          )
          hook.push(mappedHook)
        }
      })
      return hook.length ? hook : undefined
    } else {
      if (dir[mappedName]) {
        softAssertCompatEnabled(
          DeprecationTypes.CUSTOM_DIR,
          instance,
          mappedName,
          name,
        )
      }
      return dir[mappedName]
    }
  }
}
