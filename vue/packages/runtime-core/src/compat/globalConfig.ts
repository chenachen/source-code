import type { AppConfig } from '../apiCreateApp'
import {
  DeprecationTypes,
  softAssertCompatEnabled,
  warnDeprecation,
} from './compatConfig'
import { isCopyingConfig } from './global'
import { internalOptionMergeStrats } from '../componentOptions'

/** Vue 2 `Vue.config` 中已移除字段的兼容类型。访问仍可工作，但会提示迁移方式。 */
export type LegacyConfig = {
  /**
   * @deprecated `config.silent` 已移除，请使用控制台过滤功能而非全局屏蔽警告。
   */
  silent?: boolean
  /**
   * @deprecated 请改用 `__VUE_PROD_DEVTOOLS__` 编译期特性标志。
   * https://github.com/vuejs/core/tree/main/packages/vue#bundler-build-feature-flags
   */
  devtools?: boolean
  /**
   * @deprecated 请使用 `config.isCustomElement`/编译器 `isCustomElement`。
   * https://v3-migration.vuejs.org/breaking-changes/global-api.html#config-ignoredelements-is-now-config-iscustomelement
   */
  ignoredElements?: (string | RegExp)[]
  /**
   * @deprecated Vue 3 事件修饰符直接使用 kebab-case KeyboardEvent.key。
   * https://v3-migration.vuejs.org/breaking-changes/keycode-modifiers.html
   */
  keyCodes?: Record<string, number | number[]>
  /**
   * @deprecated Vue 3 已移除启动时 production tip。
   * https://v3-migration.vuejs.org/breaking-changes/global-api.html#config-productiontip-removed
   */
  productionTip?: boolean
}

/**
 * 开发环境为旧 config 字段安装 getter/setter。
 * 复制全局 Vue 配置到新 App 时由 `isCopyingConfig` 暂停警告；用户后续主动写入才提示。
 */
export function installLegacyConfigWarnings(config: AppConfig): void {
  /** 旧字段到对应弃用特性的映射。 */
  const legacyConfigOptions: Record<string, DeprecationTypes> = {
    silent: DeprecationTypes.CONFIG_SILENT,
    devtools: DeprecationTypes.CONFIG_DEVTOOLS,
    ignoredElements: DeprecationTypes.CONFIG_IGNORED_ELEMENTS,
    keyCodes: DeprecationTypes.CONFIG_KEY_CODES,
    productionTip: DeprecationTypes.CONFIG_PRODUCTION_TIP,
  }

  Object.keys(legacyConfigOptions).forEach(key => {
    let val = (config as any)[key]
    Object.defineProperty(config, key, {
      enumerable: true,
      /** 读取复制或用户写入的旧配置值；读取本身不发弃用警告。 */
      get() {
        return val
      },
      /** 用户写入旧字段时警告并保存新值；全局配置复制阶段只保存，避免误报。 */
      set(newVal) {
        if (!isCopyingConfig) {
          warnDeprecation(legacyConfigOptions[key], null)
        }
        val = newVal
      },
    })
  })
}

/**
 * 用 Proxy 兼容读取 Vue 2 内置 optionMergeStrategies。
 * 用户自定义策略优先；访问 Vue 内部策略时经过兼容检查。Vue 3 不再公开这些实现，
 * 因为依赖内部合并函数会让库与具体版本强耦合。
 */
export function installLegacyOptionMergeStrats(config: AppConfig): void {
  config.optionMergeStrategies = new Proxy({} as any, {
    /** 优先读取用户策略，未定义时仅在兼容开关允许后暴露 Vue 内部合并策略。 */
    get(target, key) {
      if (key in target) {
        return target[key]
      }
      if (
        key in internalOptionMergeStrats &&
        softAssertCompatEnabled(
          DeprecationTypes.CONFIG_OPTION_MERGE_STRATS,
          null,
        )
      ) {
        return internalOptionMergeStrats[
          key as keyof typeof internalOptionMergeStrats
        ]
      }
    },
  })
}
