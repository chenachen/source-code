import path from 'node:path'
import { viteReporterPlugin as nativeReporterPlugin } from 'rolldown/experimental'
import { type Plugin, perEnvironmentPlugin } from '../plugin'
import type { ResolvedConfig } from '../config'
import { LogLevels } from '../logger'

/**
 * 按当前 Environment 配置原生构建报告器：输出文件体积、可选压缩体积，并只在
 * 已压缩的客户端应用构建中提示大 chunk；库与服务端构建不使用该启发式警告。
 */
export function buildReporterPlugin(config: ResolvedConfig): Plugin {
  return perEnvironmentPlugin('native:reporter', (env) => {
    const tty = process.stdout.isTTY && !process.env.CI
    const shouldLogInfo = LogLevels[config.logLevel || 'info'] >= LogLevels.info
    const assetsDir = path.join(env.config.build.assetsDir, '/')
    return nativeReporterPlugin({
      root: env.config.root,
      isTty: !!tty,
      isLib: !!env.config.build.lib,
      assetsDir,
      chunkLimit: env.config.build.chunkSizeWarningLimit,
      /** 允许 info 级别输出时，将原生报告器的消息转发到当前 Environment logger。 */
      logInfo: shouldLogInfo ? (msg) => env.logger.info(msg) : undefined,
      reportCompressedSize: env.config.build.reportCompressedSize,
      warnLargeChunks:
        env.config.build.minify &&
        !env.config.build.lib &&
        env.config.consumer === 'client',
    })
  })
}
