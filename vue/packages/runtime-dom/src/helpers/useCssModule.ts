import { getCurrentInstance, warn } from '@vue/runtime-core'
import { EMPTY_OBJ } from '@vue/shared'

/**
 * 读取当前 SFC 注入的 CSS Modules 类名映射。
 * 默认模块名为 `$style`；必须在 setup 中调用。global build 没有 SFC 模块注入协议，
 * 因而只返回共享空对象并在开发环境警告。
 */
export function useCssModule(name = '$style'): Record<string, string> {
  if (!__GLOBAL__) {
    const instance = getCurrentInstance()!
    if (!instance) {
      __DEV__ && warn(`useCssModule must be called inside setup()`)
      return EMPTY_OBJ
    }
    const modules = instance.type.__cssModules
    if (!modules) {
      __DEV__ && warn(`Current instance does not have CSS modules injected.`)
      return EMPTY_OBJ
    }
    const mod = modules[name]
    if (!mod) {
      __DEV__ &&
        warn(`Current instance does not have CSS module named "${name}".`)
      return EMPTY_OBJ
    }
    return mod as Record<string, string>
  } else {
    /* v8 ignore start */
    if (__DEV__) {
      warn(`useCssModule() is not supported in the global build.`)
    }
    return EMPTY_OBJ
    /* v8 ignore stop */
  }
}
