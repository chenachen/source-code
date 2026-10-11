import net from 'node:net'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { isServe, isWindows, viteTestUrl } from '~utils'
import './commonTests'

describe.runIf(isServe)('invalid request', () => {
  /** 绕过 fetch/URL 客户端的路径规范化，经 encodeURI 编码后直接写 TCP 请求行，收集完整 HTTP 响应。
   * @param baseUrl 测试服务的主机与端口。
   * @param requestTarget 待检查的原始路径结构。
   * @returns TCP 正常结束后的响应文本；连接错误时拒绝。
   */
  const sendRawRequest = async (baseUrl: string, requestTarget: string) => {
    return new Promise<string>((resolve, reject) => {
      const parsedUrl = new URL(baseUrl)

      const buf: Buffer[] = []
      const client = net.createConnection(
        { port: +parsedUrl.port, host: parsedUrl.hostname },
        () => {
          client.write(
            [
              `GET ${encodeURI(requestTarget)} HTTP/1.1`,
              `Host: ${parsedUrl.host}`,
              'Connection: Close',
              '\r\n',
            ].join('\r\n'),
          )
        },
      )
      client.on('data', (data) => {
        buf.push(data)
      })
      client.on('end', (hadError) => {
        if (!hadError) {
          resolve(Buffer.concat(buf).toString())
        }
      })
      client.on('error', (err) => {
        reject(err)
      })
    })
  }

  const root = path
    .resolve(import.meta.dirname.replace('playground', 'playground-temp'), '..')
    .replace(/\\/g, '/')
  /**
   * 原始 request-target 安全矩阵。
   * 目标：合法 root 与 `/@fs/` 访问保持 200；`#` 按 RFC 返回 400；点段、反斜杠、Source Map
   * 穿越与 root 外 HTML 不能绕过 fs.deny/allow，平台差异只出现在路径是否真实可解析。
   */
  const testCases: Array<{
    /** 原始 request-target 安全场景名称。 */
    name: string
    /** 直接写入 TCP 请求行、未经 URL 客户端规范化的目标。 */
    target: string
    /** 首行响应必须包含的 HTTP 状态。 */
    status: string
    /** 状态允许响应正文时需要包含的文本。 */
    content?: string
  }> = [
    {
      name: 'basic request',
      target: '/src/safe.txt',
      status: 'HTTP/1.1 200 OK',
      content: 'KEY=safe',
    },
    {
      name: 'request with /@fs/',
      target: path.posix.join('/@fs/', root, 'root/src/safe.txt'),
      status: 'HTTP/1.1 200 OK',
      content: 'KEY=safe',
    },
    {
      name: '# in request-target',
      target: '/src/safe.txt#/../../unsafe.txt',
      status: 'HTTP/1.1 400 Bad Request',
    },
    {
      name: '# in request-target with /@fs/',
      target:
        path.posix.join('/@fs/', root, 'root/src/safe.txt') +
        '#/../../unsafe.txt',
      status: 'HTTP/1.1 400 Bad Request',
    },
    {
      name: 'denied file with /.',
      target: '/src/dummy.crt/.',
      status: 'HTTP/1.1 403 Forbidden',
    },
    {
      name: 'denied file ending with \\',
      target: '/src/.env\\',
      status: isWindows ? 'HTTP/1.1 403 Forbidden' : 'HTTP/1.1 404 Not Found',
    },
    {
      name: 'denied file ending with \\ with /@fs/',
      target: path.posix.join('/@fs/', root, 'root/src/.env') + '\\',
      status: isWindows ? 'HTTP/1.1 403 Forbidden' : 'HTTP/1.1 404 Not Found',
    },
    {
      name: 'denied file with /. with /@fs/',
      target: path.posix.join('/@fs/', root, 'root/src/dummy.crt/') + '.',
      status: 'HTTP/1.1 403 Forbidden',
    },
    {
      name: 'denied optimize deps sourcemap handler',
      target:
        path.posix.join('/@fs/', root) +
        '/node_modules/.vite/deps/../../../unsafe.map',
      status: 'HTTP/1.1 403 Forbidden',
    },
    {
      name: 'denied backslash optimize deps sourcemap handler',
      target:
        path.posix.join('/@fs/', root) +
        '/node_modules/.vite/deps/..\\..\\..\\unsafe.map',
      status: isWindows ? 'HTTP/1.1 403 Forbidden' : 'HTTP/1.1 200 OK',
      content: isWindows ? undefined : 'Cache-Control: no-cache',
    },
    {
      name: 'HTML outside root with relative path',
      target: '/../unsafe.html',
      status: 'HTTP/1.1 403 Forbidden',
    },
  ]
  for (const { name, target, status, content } of testCases) {
    /** 仅 dev 按十一行发送 target：安全 root/@fs 返回 200，含 # 返回 400，点段/根外 HTML/正斜杠 map 穿越返回 403；反斜杠行按 Windows 判为 403，其他平台按各行返回 404 或 no-cache 的 200。 */
    test(name, async () => {
      const response = await sendRawRequest(viteTestUrl, target)
      expect(response).toContain(status)
      if (content !== undefined) {
        expect(response).toContain(content)
      }
    })
  }
})
