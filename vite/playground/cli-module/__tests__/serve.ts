// vitestSetup 自动发现此 serve，以真实 CLI 子进程替换默认 E2E 启动。

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

/** type:module CLI 夹具的独占端口，由全局分配表提供。 */
export const port = ports['cli-module']

/** 按矩阵运行真实 CLI：build 先构建后 preview，dev 直接启动；监听地址确认后交回 close。 */
export async function serve() {
  // 把子进程输出缓存在内存，失败时再打印。
  const streams = {
    build: { out: [], err: [] },
    server: { out: [], err: [] },
  }
  /** 持续把指定子进程 stdout/stderr 分块追加到其输出缓存。 */
  const collectStreams = (name, process) => {
    process.stdout.on('data', (d) => streams[name].out.push(d.toString()))
    process.stderr.on('data', (d) => streams[name].err.push(d.toString()))
  }
  /** 收集 execa 拒绝值中已聚合的 stdout/stderr，补足失败诊断。 */
  const collectErrorStreams = (name, e) => {
    e.stdout && streams[name].out.push(e.stdout)
    e.stderr && streams[name].err.push(e.stderr)
  }

  /** 在启动或关闭失败时打印指定子进程的缓存输出。 */
  const printStreamsToConsole = async (name) => {
    const std = streams[name]
    if (std.out && std.out.length > 0) {
      console.log(`stdout of ${name}\n${std.out.join('\n')}\n`)
    }
    if (std.err && std.err.length > 0) {
      console.log(`stderr of ${name}\n${std.err.join('\n')}\n`)
    }
  }

  // 构建矩阵先生成 dist，开发矩阵直接启动。
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

  // 根据矩阵启动 dev/preview，并用 strict-port 固定浏览器访问端口。
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

  /** 请求关闭子进程并最多等待 10000ms；execa 的 forceKillAfterDelay 为 3000ms，失败时输出日志。 */
  const close = async () => {
    if (serverProcess) {
      const timeoutError = `server process still alive after 3s`
      try {
        await killProcess(serverProcess)
        await resolvedOrTimeout(serverProcess, 10000, timeoutError)
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

/** 从 CLI stdout 地址识别实际端口，拒绝错端口或超时，并在结束时移除监听。 */
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

/** 将操作与 ms 超时拒绝竞速，任一结束后清除定时器。 */
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
