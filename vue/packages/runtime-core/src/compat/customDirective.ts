import { isArray } from '@vue/shared'
import type { ComponentInternalInstance } from '../component'
import type { DirectiveHook, ObjectDirective } from '../directives'
import { DeprecationTypes, softAssertCompatEnabled } from './compatConfig'

/** Vue 2 自定义指令生命周期名称。 */
export interface LegacyDirective {
  /** 映射到元素 beforeMount，宿主插入前初始化。 */
  bind?: DirectiveHook
  /** 映射到 mounted 的 post 阶段，元素已提交。 */
  inserted?: DirectiveHook
  /** 与 componentUpdated 一起映射到 updated，先于后者调用。 */
  update?: DirectiveHook
  /** 映射到 updated 列表第二项；兼容层不额外建立 Vue 2 的独立更新阶段。 */
  componentUpdated?: DirectiveHook
  /** 映射到 unmounted 的 post 阶段，表示指令逻辑收尾。 */
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
 * 调用方只在 Vue 3 对应钩子缺失时使用映射；旧 update 与 componentUpdated 均在
 * Vue 3 updated 阶段按列表顺序调用。此处未使用 softAssertCompatEnabled 的返回值，
 * 因而即使配置禁用 CUSTOM_DIR，仍会返回旧钩子；开发环境检查负责报告弃用提示。
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
