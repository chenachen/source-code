import { nanoid } from 'nanoid/non-secure'
import { DevRuntime } from 'rolldown/experimental/runtime'
import {
  BundledDevHMRClient,
  BundledDevHMRContext,
} from './bundledDevHmrClient'
import {
  base,
  clearOverlayOrReloadOnFirstUpdate,
  registerBundledDevClient,
  removeStyle,
  transport,
  updateStyle,
} from './client'

// bundled-dev 内联时会用本入口替换 client.ts，必须保持相同公共导出，避免用户代码因模式切换失效。
export {
  createHotContext,
  injectQuery,
  removeStyle,
  updateStyle,
  ErrorOverlay,
} from './client'

// 常规 dev 构建不会注入实验性 DevRuntime；仅 bundled-dev 环境初始化以下客户端。
if (typeof DevRuntime !== 'undefined') {
  /** 把 Rolldown runtime 的模块热上下文接到 Vite HMRClient。 */
  class ViteDevRuntime extends DevRuntime {
    /** 为每个 runtime 模块创建 bundled-dev 专用 hot context，并暂存 CSS 操作兼容口。 */
    override createModuleHotContext(moduleId: string) {
      const ctx = new BundledDevHMRContext(bundledDevHmrClient, moduleId)
      // @ts-expect-error CSS 尚未进入 Rolldown runtime 的正式 HMR 协议，临时沿用内部扩展
      ctx._internal = { updateStyle, removeStyle }
      return ctx
    }
  }

  // clientId 区分同一 server 上的多个页面，使服务端可为每个 runtime 追踪 bundle 状态。
  const clientId = nanoid()

  transport.send({
    type: 'custom',
    event: 'vite:client-connected',
    data: { clientId },
  })

  // 页面只保留一个 Rolldown runtime；重复载入 client 时复用模块缓存与 factory 图。
  const runtime = ((globalThis as any).__rolldown_runtime__ ??=
    new ViteDevRuntime(clientId))

  const bundledDevHmrClient = new BundledDevHMRClient(
    {
      /** 在浏览器错误通道中显示 bundled-dev 更新失败。 */
      error: (err) => console.error('[vite]', err),
      /** 在浏览器调试通道中显示 patch 应用和本地失效过程。 */
      debug: (...msg) => console.debug('[vite]', ...msg),
    },
    transport,
    runtime,
    {
      base,
      beforeApply: clearOverlayOrReloadOnFirstUpdate,
    },
  )
  registerBundledDevClient(bundledDevHmrClient)

  // Runtime 删除模块缓存时先让 Vite 执行 dispose，创建 hot context 则回到同一 HMR client。
  runtime.hooks = {
    /** 将 Rolldown 模块 ID 接到 Vite 的 bundled-dev 热上下文。 */
    createModuleHotContext: (id: string) => runtime.createModuleHotContext(id),
    /** 缓存删除时同步执行该模块的 dispose；不等待其返回的 Promise。 */
    onModuleCacheRemoval: (id: string) =>
      bundledDevHmrClient.handleModuleCacheRemoval(id),
  }
}
