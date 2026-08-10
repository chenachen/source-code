import fs from 'node:fs/promises'
import path from 'node:path'
import colors from 'picocolors'
import { glob, isDynamicPattern } from 'tinyglobby'
import { FS_PREFIX } from '../constants'
import { normalizePath } from '../utils'
import type { ViteDevServer } from '../index'
import type { DevEnvironment } from './environment'

/**
 * 展开 `server.warmup` 配置并后台预转换匹配文件。
 *
 * 函数刻意不返回 Promise：预热是启动后的性能优化，不应阻塞服务器开始监听；
 * 单文件错误由具体转换路径记录，不让后台任务形成未处理异常。
 */
export function warmupFiles(
  server: ViteDevServer,
  environment: DevEnvironment,
): void {
  const { root } = server.config
  mapFiles(environment.config.dev.warmup, root).then((files) => {
    for (const file of files) {
      warmupFile(server, environment, file)
    }
  })
}

/** 根据文件类型复用正常 HTML 或模块请求流水线进行预热。 */
async function warmupFile(
  server: ViteDevServer,
  environment: DevEnvironment,
  file: string,
) {
  // HTML 必须走 transformIndexHtml，才能像真实请求一样触发其中链接模块的预转换。
  // 后续浏览器请求可能再次执行 HTML 钩子；这里接受这次重复，以换取模块提前就绪。
  if (file.endsWith('.html')) {
    const url = htmlFileToUrl(file, server.config.root)
    if (url) {
      try {
        const html = await fs.readFile(file, 'utf-8')
        await server.transformIndexHtml(url, html)
      } catch (e) {
        // 预热失败不应关闭服务器，但要携带错误对象和时间记录诊断信息。
        environment.logger.error(
          `Pre-transform error (${colors.cyan(file)}): ${e.message}`,
          {
            error: e,
            timestamp: true,
          },
        )
      }
    }
  }
  // 其他资源交给环境的 warmupRequest，复用普通 transformRequest 的缓存语义。
  else {
    const url = fileToUrl(file, server.config.root)
    await environment.warmupRequest(url)
  }
}

/** 将 root 内 HTML 文件转换为根相对 URL；root 外 HTML 不参与预热。 */
function htmlFileToUrl(file: string, root: string) {
  const url = path.relative(root, file)
  // HTML 转换依赖项目根语义，root 外文件直接忽略。
  if (url[0] === '.') return
  // root 内文件生成浏览器正常请求的根相对 URL。
  return '/' + normalizePath(url)
}

/** 将普通文件转换为 Vite 请求 URL，root 外路径使用 `/@fs/` 编码。 */
function fileToUrl(file: string, root: string) {
  const url = path.relative(root, file)
  // root 外模块不能表示为根相对 URL，使用文件系统保留前缀。
  if (url[0] === '.') {
    return path.posix.join(FS_PREFIX, normalizePath(file))
  }
  // root 内模块使用与浏览器请求一致的根相对 URL。
  return '/' + normalizePath(url)
}

/**
 * 把显式路径和 glob 混合配置展开为绝对文件路径。
 *
 * 静态路径直接解析，动态模式集中交给 tinyglobby；禁用目录自动展开并忽略 Git
 * 与 node_modules，避免一个宽泛模式意外预热整个依赖树。
 */
async function mapFiles(files: string[], root: string) {
  if (!files.length) return []

  const result: string[] = []
  const globs: string[] = []
  for (const file of files) {
    if (isDynamicPattern(file)) {
      globs.push(file)
    } else {
      if (path.isAbsolute(file)) {
        result.push(file)
      } else {
        result.push(path.resolve(root, file))
      }
    }
  }
  if (globs.length) {
    result.push(
      ...(await glob(globs, {
        absolute: true,
        cwd: root,
        expandDirectories: false,
        ignore: ['**/.git/**', '**/node_modules/**'],
      })),
    )
  }
  return result
}
