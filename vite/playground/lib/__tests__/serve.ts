// vitestSetup.ts 发现此入口后，使用本服务替代默认 playground 服务。

import path from 'node:path'
import http from 'node:http'
import sirv from 'sirv'
import {
  isBuild,
  page,
  ports,
  rootDir,
  serverLogs,
  setViteUrl,
  viteTestUrl,
} from '~utils'

/** 本 serve 模块目录，用于选择各库构建配置。 */
const dirname = import.meta.dirname

/** 库 playground 固定端口；dev 与静态产物服务共用。 */
export const port = ports.lib

/** 收集构建警告；dev 创建 Vite 服务，build 依次运行各库配置再用 sirv 提供 dist 页面。
 * @returns 已启动服务的关闭句柄，交给 harness teardown。
 */
export async function serve(): Promise<{
  /** 等待对应 HTTP 或 Vite 服务关闭。 */
  close(): Promise<void>
}> {
  setupConsoleWarnCollector()

  if (!isBuild) {
    const { createServer } = await import('vite')
    process.env.VITE_INLINE = 'inline-serve'
    const viteServer = await (
      await createServer({
        root: rootDir,
        logLevel: 'silent',
        server: {
          port,
          strictPort: true,
          watch: {
            usePolling: true,
            interval: 100,
          },
          host: true,
          fs: {
            strict: !isBuild,
          },
        },
        build: {
          target: 'esnext',
        },
      })
    ).listen()
    // 测试 URL 使用指定端口与服务器解析后的 base。
    const devBase = viteServer.config.base === '/' ? '' : viteServer.config.base
    setViteUrl(`http://localhost:${port}${devBase}`)
    await page.goto(viteTestUrl)

    return viteServer
  } else {
    const { build } = await import('vite')
    await build({
      root: rootDir,
      logLevel: 'silent',
      configFile: path.resolve(dirname, '../vite.config.js'),
    })

    await build({
      root: rootDir,
      logLevel: 'warn', // 保留构建警告输出。
      configFile: path.resolve(dirname, '../vite.dyimport.config.js'),
    })

    await build({
      root: rootDir,
      logLevel: 'warn', // 保留构建警告输出。
      configFile: path.resolve(dirname, '../vite.multiple-output.config.js'),
    })

    await build({
      root: rootDir,
      logLevel: 'warn', // 保留构建警告输出。
      configFile: path.resolve(dirname, '../vite.nominify.config.js'),
    })

    await build({
      root: rootDir,
      logLevel: 'warn', // 保留构建警告输出。
      configFile: path.resolve(dirname, '../vite.helpers-injection.config.js'),
    })

    await build({
      root: rootDir,
      logLevel: 'warn', // 保留构建警告输出。
      configFile: path.resolve(dirname, '../vite.named-exports.config.js'),
    })

    await build({
      root: rootDir,
      logLevel: 'warn', // 保留构建警告输出。
      configFile: path.resolve(dirname, '../vite.css-single-entry.config.js'),
    })

    await build({
      root: rootDir,
      logLevel: 'warn', // 保留构建警告输出。
      configFile: path.resolve(dirname, '../vite.css-multi-entry.config.js'),
    })

    await build({
      root: rootDir,
      logLevel: 'warn', // 保留构建警告输出。
      configFile: path.resolve(dirname, '../vite.css-code-split.config.js'),
    })

    await build({
      root: rootDir,
      logLevel: 'warn', // 保留构建警告输出。
      configFile: path.resolve(dirname, '../vite.terser.config.js'),
    })

    // 启动 dist 静态文件服务器。
    const serve = sirv(path.resolve(rootDir, 'dist'))
    const httpServer = http.createServer((req, res) => {
      if (req.url === '/ping') {
        res.statusCode = 200
        res.end('pong')
      } else {
        serve(req, res)
      }
    })

    return new Promise((resolve, reject) => {
      try {
        const server = httpServer.listen(port, async () => {
          await page.goto(`http://localhost:${port}`)
          resolve({
            /** 等待静态 HTTP 服务关闭，释放本 fixture 的端口。 */
            async close() {
              await new Promise((resolve) => {
                server.close(resolve)
              })
            },
          })
        })
      } catch (e) {
        reject(e)
      }
    })
  }
}

/** 包装 console.warn，将同一组参数同时写入 serverLogs 和原控制台，供 CSS 压缩警告断言读取。 */
function setupConsoleWarnCollector() {
  const warn = console.warn
  /** 记录拼接后的警告并调用原 warn；该替换在本测试进程持续生效。 */
  console.warn = (...args) => {
    serverLogs.push(args.join(' '))
    return warn.call(console, ...args)
  }
}
