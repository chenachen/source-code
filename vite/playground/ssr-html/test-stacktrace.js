import path from 'node:path'
import { createServer } from 'vite'

/** 由第一个命令行参数选择 Node 原生 source map；外层循环覆盖开/关两个分支。 */
const isSourceMapEnabled = process.argv[2] === 'true'
/** 由第二个命令行参数选择 js 或 ts 错误 fixture；外层循环组合两种扩展名与 source map 开关。 */
const ext = process.argv[3]
process.setSourceMapsEnabled(isSourceMapEnabled)
console.log('# sourcemaps enabled:', isSourceMapEnabled)
console.log('# source file extension:', ext)

/** 读取 Vitest 环境标记以选择日志级别；外层测试启动的子进程继承该环境。 */
const isTest = process.env.VITEST

/** 不启用 WebSocket 的 middleware 服务；三个路径形式都从它加载同一个错误函数，结束后关闭。 */
const vite = await createServer({
  root: import.meta.dirname,
  logLevel: isTest ? 'error' : 'info',
  server: {
    middlewareMode: true,
    ws: false,
  },
  appType: 'custom',
})

/** 用以 /src 开头的根相对 URL 加载错误模块，核对 Vite root 内的解析。 */
const abs1 = await vite.ssrLoadModule(`/src/error-${ext}.${ext}`)
/** 用 path.resolve 得到文件系统绝对路径，核对与根相对 URL 加载同一错误源码。 */
const abs2 = await vite.ssrLoadModule(
  path.resolve(import.meta.dirname, `./src/error-${ext}.${ext}`),
)
/** 相对于 Vite root 的导入形式；与两个绝对路径共同生成供外层测试检查 2:9 错误帧的输出。 */
const relative = await vite.ssrLoadModule(`./src/error-${ext}.${ext}`)

for (const mod of [abs1, abs2, relative]) {
  try {
    mod.error()
  } catch (e) {
    // Node 原生 source map 开启时由 Node 改写堆栈；关闭时才调用 Vite 的手动修正。
    if (!isSourceMapEnabled) {
      vite.ssrFixStacktrace(e)
    }
    console.log(e)
  }
}

await vite.close()
