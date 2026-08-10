// playground/vitestSetup.ts 会自动发现本文件，并用这里的 serve() 替换默认 E2E
// 启动逻辑。这样测试才能真正执行 Vite CLI 子进程，而非直接调用 Node API。

import { stripVTControlCharacters } from 'node:util'
import { execaCommand } from 'execa'
import kill from 'kill-port'
import {
  isBuild,
  isWindows,
  killProcess,
  ports,
  rootDir,
  viteBinPath,
} from '~utils'

/** CLI playground 使用的独占端口，来自全局测试端口分配表。 */
export const port = ports.cli
/**
 * build 与 server 子进程的标准输出/错误缓存。
 * 测试既用它断言重启日志，也在子进程失败时打印诊断信息。
 */
export const streams = {} as {
  /** `vite build` 子进程的输出缓存。 */
  build: {
    /** build stdout 的分块文本。 */
    out: string[]
    /** build stderr 的分块文本。 */
    err: string[]
  }
  /** dev/preview 长运行子进程的输出缓存。 */
  server: {
    /** server stdout 的分块文本。 */
    out: string[]
    /** server stderr 的分块文本。 */
    err: string[]
  }
}

/**
 * 通过真实命令行启动 CLI playground。
 *
 * Serve 测试直接执行 `vite --port ...`；Build 测试先执行 `vite build`，再执行
 * `vite preview --port ...`。两个分支共同验证 bin 入口、cac 参数解析和命令分发。
 *
 * @returns 服务器成功监听后返回包含 `close()` 的清理对象。
 */
export async function serve() {
  // 子进程输出先存入内存，避免正常日志干扰 Vitest；只有断言或进程失败时再读取。
  Object.assign(streams, {
    build: { out: [], err: [] },
    server: { out: [], err: [] },
  })
  /** 持续收集运行中子进程的 stdout/stderr。 */
  const collectStreams = (name, process) => {
    process.stdout.on('data', (d) => streams[name].out.push(d.toString()))
    process.stderr.on('data', (d) => streams[name].err.push(d.toString()))
  }

  /** 收集 execa 抛错对象中已经聚合的 stdout/stderr。 */
  const collectErrorStreams = (name, e) => {
    e.stdout && streams[name].out.push(e.stdout)
    e.stderr && streams[name].err.push(e.stderr)
  }

  /** 仅在失败时输出指定子进程日志，保持成功测试输出干净。 */
  const printStreamsToConsole = async (name) => {
    const std = streams[name]
    if (std.out && std.out.length > 0) {
      console.log(`stdout of ${name}\n${std.out.join('\n')}\n`)
    }
    if (std.err && std.err.length > 0) {
      console.log(`stderr of ${name}\n${std.err.join('\n')}\n`)
    }
  }

  // Build 测试必须先生成 dist；Serve 测试直接走开发服务器，不做多余构建。
  if (isBuild) {
    const buildCommand = `${viteBinPath} build`
    try {
      const buildProcess = execaCommand(buildCommand, {
        cwd: rootDir,
        stdio: 'pipe',
      })
      collectStreams('build', buildProcess)
      await buildProcess
    } catch (e) {
      console.error(`error while executing cli command "${buildCommand}":`, e)
      collectErrorStreams('build', e)
      await printStreamsToConsole('build')
      throw e
    }
  }

  await kill(port)

  // 根据测试矩阵执行 `vite --port x` 或 `vite preview --port x`。
  // strict-port 保证端口冲突立即失败，避免测试误连到其他进程。
  const viteServerArgs = ['--port', `${port}`, '--strict-port']
  if (isBuild) {
    viteServerArgs.unshift('preview')
  }
  const serverCommand = `${viteBinPath} ${viteServerArgs.join(' ')}`
  const serverProcess = execaCommand(serverCommand, {
    cwd: rootDir,
    stdio: 'pipe',
    forceKillAfterDelay: 3000,
  })
  collectStreams('server', serverProcess)

  /**
   * 关闭 CLI 子进程。先请求正常终止，必要时再强制终止，并限制等待时间，防止单个
   * E2E 用例把整个测试进程永久挂住。
   */
  const close = async () => {
    if (serverProcess) {
      const timeoutError = `server process still alive after 3s`
      try {
        await killProcess(serverProcess)
        await resolvedOrTimeout(serverProcess, 5173, timeoutError)
      } catch (e) {
        if (e === timeoutError || (!serverProcess.killed && !isWindows)) {
          collectErrorStreams('server', e)
          console.error(
            `error while killing cli command "${serverCommand}":`,
            e,
          )
          await printStreamsToConsole('server')
        }
      }
    }
  }

  try {
    await startedOnPort(serverProcess, port, 5173)
    return { close }
  } catch (e) {
    collectErrorStreams('server', e)
    console.error(`error while executing cli command "${serverCommand}":`, e)
    await printStreamsToConsole('server')
    try {
      await close()
    } catch (e1) {
      console.error(
        `error while killing cli command after failed execute "${serverCommand}":`,
        e1,
      )
    }
  }
}

/**
 * 等待 Vite 输出监听地址，并校验实际端口与请求端口一致。
 *
 * 不能只等待任意 `http://...` 日志：若端口被占用且 strictPort 失效，Vite 可能
 * 自动选择其他端口，浏览器随后会访问错误目标。
 */
async function startedOnPort(serverProcess, port, timeout) {
  let checkPort
  const startedPromise = new Promise<void>((resolve, reject) => {
    checkPort = (data) => {
      const str = stripVTControlCharacters(data.toString())
      const match = str.match(
        /http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d{4})/,
      )
      if (match) {
        const startedPort = parseInt(match[1], 10)
        if (startedPort === port) {
          resolve()
        } else {
          const msg = `server listens on port ${startedPort} instead of ${port}`
          reject(msg)
        }
      }
    }
    serverProcess.stdout.on('data', checkPort)
  })
  return resolvedOrTimeout(
    startedPromise,
    timeout,
    `failed to start within ${timeout}ms`,
  ).finally(() => serverProcess.stdout.off('data', checkPort))
}

/**
 * 为异步启动或退出操作增加超时边界。
 *
 * @param promise - 要等待的异步操作。
 * @param ms - 最大等待毫秒数。
 * @param errorMessage - 超时时的拒绝原因。
 */
async function resolvedOrTimeout(promise, ms, errorMessage) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(errorMessage), ms)
    }),
  ]).finally(() => {
    clearTimeout(timer)
    timer = null
  })
}
