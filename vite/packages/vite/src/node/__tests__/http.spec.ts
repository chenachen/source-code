import http from 'node:http'
import net from 'node:net'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { wildcardHosts } from '../constants'
import { createServer } from '..'
import type { InlineConfig, ViteDevServer } from '..'

/** 测试专用高位端口起点，降低与系统服务冲突概率。 */
const BASE_PORT = 15181

// 禁用自动发现，避免 listen 扫描 __tests__ 下全部 HTML 夹具。
const optimizeDeps: InlineConfig['optimizeDeps'] = {
  noDiscovery: true,
  include: [],
}

describe('port detection', () => {
  let blockingServer: http.Server | null = null
  let viteServer: ViteDevServer | null = null

  afterEach(async () => {
    if (viteServer) {
      await viteServer.close()
      viteServer = null
    }

    await new Promise<void>((resolve) => {
      if (blockingServer) {
        blockingServer.close(() => resolve())
        blockingServer = null
      } else {
        resolve()
      }
    })
  })

  /** 创建占用指定 host:port 的最小 HTTP Server，并提供 using 自动清理。 */
  async function createSimpleServer(port: number, host: string) {
    const server = http.createServer()
    await new Promise<void>((resolve) => {
      server.listen(port, host, () => resolve())
    })
    return {
      /** 实现 using 协议，在端口探测用例退出时等待占位 HTTP Server 关闭。 */
      [Symbol.asyncDispose]() {
        return new Promise<void>((resolve) => {
          server.close(() => resolve())
        })
      },
    }
  }

  describe('port fallback', () => {
    /**
     * 场景：配置 port=0，让 OS 分配临时端口。
     * 验证目标：只在第一个 wildcard 请求 0；其余 wildcard、配置 host 和真实 HTTP Server
     * 全部使用同一具体端口（#23158）。
     */
    test('uses the same ephemeral port on every interface', async () => {
      using listen = vi.spyOn(net.Server.prototype, 'listen')

      viteServer = await createServer({
        root: import.meta.dirname,
        optimizeDeps,
        logLevel: 'silent',
        server: { port: 0, ws: false },
      })
      await viteServer.listen()

      const address = viteServer.httpServer!.address()
      expect(address).toStrictEqual(
        expect.objectContaining({ port: expect.any(Number) }),
      )
      const assignedPort = (address as net.AddressInfo).port
      expect(viteServer._currentServerPort).toBe(assignedPort)
      const [firstWildcardHost, ...remainingWildcardHosts] = wildcardHosts
      expect(
        listen.mock.calls.map(([port, host]) => ({ port, host })),
      ).toStrictEqual([
        { port: 0, host: firstWildcardHost },
        ...remainingWildcardHosts.map((host) => ({
          port: assignedPort,
          host,
        })),
        { port: assignedPort, host: 'localhost' }, // 检查配置 host。
        { port: assignedPort, host: 'localhost' }, // 真实绑定 HTTP Server。
      ])
    })

    /**
     * 场景：首选 localhost 端口被占用，strictPort=false。
     * 验证目标：自动回退到下一个可用端口。
     */
    test('detects port conflict', async () => {
      await using _blockingServer = await createSimpleServer(
        BASE_PORT,
        'localhost',
      )

      viteServer = await createServer({
        root: import.meta.dirname,
        optimizeDeps,
        logLevel: 'silent',
        server: { port: BASE_PORT, strictPort: false, ws: false },
      })
      await viteServer.listen()

      const address = viteServer.httpServer!.address()
      expect(address).toStrictEqual(
        expect.objectContaining({ port: BASE_PORT + 1 }),
      )
    })

    /**
     * 场景：连续两个端口被占用。
     * 验证目标：回退循环逐个探测，最终选择 BASE_PORT+2。
     */
    test('detects multiple port conflict', async () => {
      await using _blockingServer1 = await createSimpleServer(
        BASE_PORT,
        'localhost',
      )
      await using _blockingServer2 = await createSimpleServer(
        BASE_PORT + 1,
        'localhost',
      )

      viteServer = await createServer({
        root: import.meta.dirname,
        optimizeDeps,
        logLevel: 'silent',
        server: { port: BASE_PORT, strictPort: false, ws: false },
      })
      await viteServer.listen()

      const address = viteServer.httpServer!.address()
      expect(address).toStrictEqual(
        expect.objectContaining({ port: BASE_PORT + 2 }),
      )
    })

    /**
     * 场景：另一个 Server 在 IPv4 wildcard 0.0.0.0 占用端口，Vite 只配置 localhost。
     * 验证目标：预检查仍识别所有接口冲突并回退（#21381）。
     */
    test('detects port conflict when server listens on 0.0.0.0', async () => {
      await using _blockingServer = await createSimpleServer(
        BASE_PORT,
        '0.0.0.0',
      )

      viteServer = await createServer({
        root: import.meta.dirname,
        optimizeDeps,
        logLevel: 'silent',
        server: { port: BASE_PORT, strictPort: false, ws: false },
      })
      await viteServer.listen()

      const address = viteServer.httpServer!.address()
      expect(address).toStrictEqual(
        expect.objectContaining({ port: BASE_PORT + 1 }),
      )
    })

    /**
     * 场景：IPv6 wildcard `::` 占用端口。
     * 验证目标：支持 IPv6 的系统回退下一端口；系统关闭 IPv6 时跳过平台不适用场景。
     */
    test('detects port conflict when server listens on :: (IPv6)', async (ctx) => {
      let blockingServer
      try {
        blockingServer = await createSimpleServer(BASE_PORT, '::')
      } catch {
        // 当前系统没有 IPv6，不属于端口算法失败。
        ctx.skip()
        return
      }
      await using _blockingServer = blockingServer

      viteServer = await createServer({
        root: import.meta.dirname,
        optimizeDeps,
        logLevel: 'silent',
        server: { port: BASE_PORT, strictPort: false, ws: false },
      })
      await viteServer.listen()

      const address = viteServer.httpServer!.address()
      expect(address).toStrictEqual(
        expect.objectContaining({ port: BASE_PORT + 1 }),
      )
    })

    /**
     * 场景：n 被 localhost 占用，第一次回退的 n+1 又被 wildcard 占用。
     * 验证目标：每轮候选都重新做 wildcard 预检查，不能直接绑定 n+1。
     */
    test('wildcard check also runs after EADDRINUSE fallback', async () => {
      // localhost:n 已占用；0.0.0.0:n+1 已占用；Vite 应选择 n+2。

      await using _localhostServer = await createSimpleServer(
        BASE_PORT,
        'localhost',
      )
      await using _wildcardServer = await createSimpleServer(
        BASE_PORT + 1,
        '0.0.0.0',
      )

      viteServer = await createServer({
        root: import.meta.dirname,
        optimizeDeps,
        logLevel: 'silent',
        server: {
          port: BASE_PORT,
          strictPort: false,
          ws: false,
        },
      })
      await viteServer.listen()

      const address = viteServer.httpServer!.address()
      expect(address).toStrictEqual(
        expect.objectContaining({ port: BASE_PORT + 2 }),
      )
    })
  })

  /**
   * 场景：wildcard 探测收到 EACCES，而非 EADDRINUSE；具体 localhost 实际可绑定。
   * 验证目标：只有“已占用”阻塞候选，平台权限/IPv6 等错误不误判端口冲突（#21642）。
   */
  test('non-EADDRINUSE errors on wildcard do not block port selection', async () => {
    const originalCreateServer = net.createServer.bind(net)
    using _ = vi.spyOn(net, 'createServer').mockImplementation(() => {
      const server = originalCreateServer()
      const originalListen = server.listen.bind(server)
      // @ts-expect-error this is the overload used internally
      server.listen = (
        port: number,
        host: string,
        ...args: unknown[]
      ): net.Server => {
        if (wildcardHosts.has(host)) {
          process.nextTick(() => {
            const err: NodeJS.ErrnoException = new Error(
              'listen EACCES: permission denied',
            )
            err.code = 'EACCES'
            server.emit('error', err)
          })
          return server
        }
        // @ts-expect-error this is the overload used internally
        return originalListen(port, host, ...args)
      }
      return server
    })

    viteServer = await createServer({
      root: import.meta.dirname,
      optimizeDeps,
      logLevel: 'silent',
      server: { port: BASE_PORT, strictPort: false, ws: false },
    })
    await viteServer.listen()

    const address = viteServer.httpServer!.address()
    expect(address).toStrictEqual(expect.objectContaining({ port: BASE_PORT }))
  })

  /**
   * 场景：指定 localhost 端口被占用且 strictPort=true。
   * 验证目标：不尝试后续端口，直接返回稳定占用错误。
   */
  test('throws error when port is blocked and strictPort is true', async () => {
    await using _blockingServer = await createSimpleServer(
      BASE_PORT,
      'localhost',
    )

    viteServer = await createServer({
      root: import.meta.dirname,
      optimizeDeps,
      logLevel: 'silent',
      server: { port: BASE_PORT, strictPort: true, ws: false },
    })

    await expect(viteServer.listen()).rejects.toThrow(
      `Port ${BASE_PORT} is already in use`,
    )
  })

  /**
   * 场景：wildcard 预检查显示端口占用，但 strictPort 指定独立 127.0.0.1。
   * 验证目标：仍尝试真实绑定；平台允许时成功并告警潜在冲突，不允许时才报占用
   * （#22150）。
   */
  test('allows binding to specific host with strictPort when wildcard port is in use', async () => {
    await using _wildcardServer = await createSimpleServer(BASE_PORT, '0.0.0.0')

    const warnMessages: string[] = []
    viteServer = await createServer({
      root: import.meta.dirname,
      optimizeDeps,
      customLogger: {
        info: () => {},
        warn: (msg) => warnMessages.push(msg),
        warnOnce: () => {},
        error: () => {},
        clearScreen: () => {},
        hasErrorLogged: () => false,
        hasWarned: false,
      },
      server: {
        port: BASE_PORT,
        host: '127.0.0.1',
        strictPort: true,
        ws: false,
      },
    })

    try {
      await viteServer.listen()
    } catch (e) {
      // 各 OS 地址复用规则不同；不允许具体地址共存时接受标准占用错误。
      expect(() => {
        throw e
      }).toThrow(`Port ${BASE_PORT} is already in use`)
      return
    }

    const address = viteServer.httpServer!.address()
    expect(address).toStrictEqual(expect.objectContaining({ port: BASE_PORT }))
    expect(warnMessages).toContainEqual(expect.stringContaining('wildcard'))
  })

  describe('port reuse on restart', () => {
    /**
     * 场景：port=0 首次由 OS 分配随机端口，随后配置未变直接重启。
     * 验证目标：复用已监听端口，避免浏览器现有 URL 失效。
     */
    test('reuses the OS-assigned port on restart when port is 0', async () => {
      viteServer = await createServer({
        root: import.meta.dirname,
        optimizeDeps,
        logLevel: 'silent',
        server: { port: 0, ws: false },
      })
      await viteServer.listen()

      const address = viteServer.httpServer!.address() as net.AddressInfo
      const assignedPort = address.port

      await viteServer.restart()

      expect(viteServer.httpServer!.address()).toStrictEqual(
        expect.objectContaining({ port: assignedPort }),
      )
    })

    /**
     * 场景：首选端口占用导致首次监听回退；阻塞者退出后再重启。
     * 验证目标：仍复用回退后的真实端口，不因原端口恢复空闲而切换 URL（#14418）。
     */
    test('reuses the listened port when retrying after a failed listen', async () => {
      await using blockingServer = await createSimpleServer(
        BASE_PORT,
        'localhost',
      )

      viteServer = await createServer({
        root: import.meta.dirname,
        optimizeDeps,
        logLevel: 'silent',
        server: { port: BASE_PORT, ws: false },
      })
      await viteServer.listen()

      const address = viteServer.httpServer!.address() as net.AddressInfo
      const assignedPort = address.port

      await blockingServer[Symbol.asyncDispose]()

      await viteServer.restart()

      expect(viteServer.httpServer!.address()).toStrictEqual(
        expect.objectContaining({ port: assignedPort }),
      )
    })
  })
})
