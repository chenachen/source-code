import { getGlobalThis } from '@vue/shared'

/**
 * 初始化 ESM bundler 构建所需的编译期特性开关。
 *
 * 该函数只在创建渲染器时由 `baseCreateRenderer` 调用，而不在模块顶层执行，从而保证
 * 单纯导入 `runtime-core` 没有副作用，打包器可以安全 tree-shaking。若用户的打包配置
 * 未注入开关，则写入兼容默认值，并在开发环境提示：显式替换常量才能让生产构建删除
 * 未启用的 Options API、devtools 或水合诊断代码。
 */
export function initFeatureFlags(): void {
  /** 收集缺失项后一次性警告，避免连续输出三段近似信息。 */
  const needWarn = []

  if (typeof __FEATURE_OPTIONS_API__ !== 'boolean') {
    __DEV__ && needWarn.push(`__VUE_OPTIONS_API__`)
    getGlobalThis().__VUE_OPTIONS_API__ = true
  }

  if (typeof __FEATURE_PROD_DEVTOOLS__ !== 'boolean') {
    __DEV__ && needWarn.push(`__VUE_PROD_DEVTOOLS__`)
    getGlobalThis().__VUE_PROD_DEVTOOLS__ = false
  }

  if (typeof __FEATURE_PROD_HYDRATION_MISMATCH_DETAILS__ !== 'boolean') {
    __DEV__ && needWarn.push(`__VUE_PROD_HYDRATION_MISMATCH_DETAILS__`)
    getGlobalThis().__VUE_PROD_HYDRATION_MISMATCH_DETAILS__ = false
  }

  if (__DEV__ && needWarn.length) {
    const multi = needWarn.length > 1
    console.warn(
      `Feature flag${multi ? `s` : ``} ${needWarn.join(', ')} ${
        multi ? `are` : `is`
      } not explicitly defined. You are running the esm-bundler build of Vue, ` +
        `which expects these compile-time feature flags to be globally injected ` +
        `via the bundler config in order to get better tree-shaking in the ` +
        `production bundle.\n\n` +
        `For more details, see https://link.vuejs.org/feature-flags.`,
    )
  }
}
