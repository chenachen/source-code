import { hostValidationMiddleware as originalHostValidationMiddleware } from 'host-validation-middleware'
import type { Connect } from '#dep-types/connect'
import type { ResolvedPreviewOptions, ResolvedServerOptions } from '../..'

/**
 * 从显式监听 host、HMR host、preview host 和可解析 origin 收集隐式允许的主机名。
 * 用户配置这些地址即表示期望 Vite 响应它们，无需在 allowedHosts 中重复声明。
 */
export function getAdditionalAllowedHosts(
  resolvedServerOptions: Pick<ResolvedServerOptions, 'host' | 'ws' | 'origin'>,
  resolvedPreviewOptions: Pick<ResolvedPreviewOptions, 'host'>,
): string[] {
  const list = []

  // 显式 server.host/ws.host/preview.host 都代表用户期望 Vite 响应该主机。
  if (
    typeof resolvedServerOptions.host === 'string' &&
    resolvedServerOptions.host
  ) {
    list.push(resolvedServerOptions.host)
  }
  if (
    typeof resolvedServerOptions.ws === 'object' &&
    resolvedServerOptions.ws.host
  ) {
    list.push(resolvedServerOptions.ws.host)
  }
  if (
    typeof resolvedPreviewOptions.host === 'string' &&
    resolvedPreviewOptions.host
  ) {
    list.push(resolvedPreviewOptions.host)
  }

  // server.origin 同样是用户声明的公开地址，应隐式允许其 hostname。
  if (resolvedServerOptions.origin) {
    // 框架可能传入无法作为 URL 解析的占位 origin；这里只做尽力提取，失败不应阻塞启动
    // （#19241）。
    try {
      const serverOriginUrl = new URL(resolvedServerOptions.origin)
      list.push(serverOriginUrl.hostname)
    } catch {}
  }

  return list
}

/**
 * 创建 Host header 校验中间件，阻止恶意网页借 DNS rebinding 读取本地开发服务器内容。
 * allowedHosts 冻结后，底层中间件可以安全缓存判定结果；错误文案按 dev/preview 指向正确配置。
 */
export function hostValidationMiddleware(
  allowedHosts: string[],
  isPreview: boolean,
): Connect.NextHandleFunction {
  return originalHostValidationMiddleware({
    // 冻结副本，既防调用方后改数组，又允许底层按不变量缓存匹配结果。
    allowedHosts: Object.freeze([...allowedHosts]),
    /** 生成同时指出被拒主机和对应 Vite 配置项的错误文案。 */
    generateErrorMessage(hostname) {
      const hostnameWithQuotes = JSON.stringify(hostname)
      const optionName = `${isPreview ? 'preview' : 'server'}.allowedHosts`
      return (
        `Blocked request. This host (${hostnameWithQuotes}) is not allowed.\n` +
        `To allow this host, add ${hostnameWithQuotes} to \`${optionName}\` in vite.config.js.`
      )
    },
  })
}
