import { exactRegex } from 'rolldown/filter'
import { viteModulePreloadPolyfillPlugin as nativeModulePreloadPolyfillPlugin } from 'rolldown/experimental'
import type { Plugin } from '../plugin'

/** 用户可显式导入的 modulepreload polyfill 公共模块 ID。 */
export const modulePreloadPolyfillId = 'vite/modulepreload-polyfill'
/** 插件管线内部使用的虚拟模块 ID。 */
const resolvedModulePreloadPolyfillId = '\0' + modulePreloadPolyfillId + '.js'

/**
 * 提供 `vite/modulepreload-polyfill` 虚拟模块。
 * bundled 环境委托 Rolldown 原生插件按 client/server 输出 polyfill；unbundled dev 中浏览器
 * 已原生加载模块图，该入口解析为空模块，避免重复运行构建期 polyfill。
 */
export function modulePreloadPolyfillPlugin(): Plugin {
  return {
    name: 'vite:modulepreload-polyfill',
    /** bundled 模式按 consumer 配置原生 polyfill 插件；非 bundled 模式使用空虚拟模块。 */
    applyToEnvironment(environment) {
      if (environment.config.isBundled) {
        return nativeModulePreloadPolyfillPlugin({
          isServer: environment.config.consumer !== 'client',
        })
      }
      return true
    },
    resolveId: {
      filter: { id: exactRegex(modulePreloadPolyfillId) },
      /** 把公共 polyfill ID 解析为内部 null-byte 虚拟 ID。 */
      handler(_id) {
        return resolvedModulePreloadPolyfillId
      },
    },
    load: {
      filter: { id: exactRegex(resolvedModulePreloadPolyfillId) },
      /** 非 bundled 模式加载空模块；开发模块图不需要产物级 modulepreload 垫片。 */
      handler(_id) {
        // dev 不需要构建产物级的 modulepreload 兼容逻辑。
        return ''
      },
    },
  }
}
