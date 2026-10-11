import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import os, { type NetworkInterfaceInfoIPv4 } from 'node:os'
import { describe, expect, test, vi, onTestFinished } from 'vitest'
import { fileURLToPath } from 'mlly'
import {
  asyncFlatten,
  bareImportRE,
  combineSourcemaps,
  extractHostnamesFromCerts,
  extractHostnamesFromSubjectAltName,
  flattenId,
  generateCodeFrame,
  getFileStartIndex,
  getHash,
  getLocalhostAddressIfDiffersFromDNS,
  getServerUrlByHost,
  injectQuery,
  isFileReadable,
  isParentDirectory,
  mergeWithDefaults,
  normalizePath,
  numberToPos,
  posToNumber,
  processSrcSetSync,
  resolveHostname,
  resolveServerUrls,
} from '../utils'
import { isWindows } from '../../shared/utils'
import type { CommonServerOptions, ResolvedServerUrls } from '..'

/** 固定 SAN 解析证书，验证 DNS 提取而非证书时效；包含 localhost、foo.localhost、*.vite.localhost。 */
// 一次性生成方式：
// openssl req -x509 -nodes -newkey rsa:2048 -days 365 -subj "/CN=example.org" \
//   -addext "subjectAltName=DNS:localhost,DNS:foo.localhost,DNS:*.vite.localhost" \
//   -keyout /tmp/test.key -out /tmp/test.crt
// 将生成的 PEM 正文固定在下方，测试不执行生成命令。
const WORKING_TEST_CERT = `
-----BEGIN CERTIFICATE-----
MIID7zCCAtegAwIBAgIJS9D2rIN7tA8mMA0GCSqGSIb3DQEBCwUAMGkxFDASBgNV
BAMTC2V4YW1wbGUub3JnMQswCQYDVQQGEwJVUzERMA8GA1UECBMIVmlyZ2luaWEx
EzARBgNVBAcTCkJsYWNrc2J1cmcxDTALBgNVBAoTBFRlc3QxDTALBgNVBAsTBFRl
c3QwHhcNMjUwMTMwMDQxNTI1WhcNMjUwMzAxMDQxNTI1WjBpMRQwEgYDVQQDEwtl
eGFtcGxlLm9yZzELMAkGA1UEBhMCVVMxETAPBgNVBAgTCFZpcmdpbmlhMRMwEQYD
VQQHEwpCbGFja3NidXJnMQ0wCwYDVQQKEwRUZXN0MQ0wCwYDVQQLEwRUZXN0MIIB
IjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxNPlCqTmUZ7/F7GyFWDopqZ6
w19Y7/98B10JEeFGTAQIj/RP2UgZNcTABQDUvtkF7y+bOeoVJW7Zz8ozQYhRaDp8
CN2gXMcYeTUku/pKLXyCzHHVrOPAXTeU7sMRgLvPCrrJtx5OjvndW+O/PhohPRi3
iEpPvpM8gi7MVRGhnWVSx0/Ynx5c0+/vqyBTzrM2OX7Ufg8Nv7LaTXpCAnmIQp+f
Sqq7HZ7t6Y7laS4RApityvlnFHZ4f2cEibAKv/vXLED7bgAlGb8R1viPRdMtAPuI
MYvHBgGFjyX1fmq6Mz3aqlAscJILtbQlwty1oYyaENE0lq8+nZXQ+t6I+CIVLQID
AQABo4GZMIGWMAsGA1UdDwQEAwIC9DAxBgNVHSUEKjAoBggrBgEFBQcDAQYIKwYB
BQUHAwIGCCsGAQUFBwMDBggrBgEFBQcDCDBUBgNVHREETTBLgglsb2NhbGhvc3SC
DWZvby5sb2NhbGhvc3SCECoudml0ZS5sb2NhbGhvc3SCBVs6OjFdhwR/AAABhxD+
gAAAAAAAAAAAAAAAAAABMA0GCSqGSIb3DQEBCwUAA4IBAQBi302qLCgxWsUalgc2
olFxVKob1xCciS8yUVX6HX0vza0WJ7oGW6qZsBbQtfgDwB/dHv7rwsfpjRWvFhmq
gEUrewa1h0TIC+PPTYYz4M0LOwcLIWZLZr4am1eI7YP9NDgRdhfAfM4hw20vjf2a
kYLKyRTC5+3/ly5opMq+CGLQ8/gnFxhP3ho8JYrRnqLeh3KCTGen3kmbAhD4IOJ9
lxMwFPTTWLFFjxbXjXmt5cEiL2mpcq13VCF2HmheCen37CyYIkrwK9IfLhBd5QQh
WEIBLwjKCAscrtyayXWp6zUTmgvb8PQf//3Mh2DiEngAi3WI/nL+8Y0RkqbvxBar
X2JN
-----END CERTIFICATE-----
`.trim()

describe('bareImportRE', () => {
  /** 输入普通包名 vite；裸导入正则应匹配。 */
  test('should work with normal package name', () => {
    expect(bareImportRE.test('vite')).toBe(true)
  })
  /** 输入 scoped 包名 @vitejs/plugin-vue；裸导入正则应匹配完整包名。 */
  test('should work with scoped package name', () => {
    expect(bareImportRE.test('@vitejs/plugin-vue')).toBe(true)
  })

  /** 输入 POSIX 绝对路径及两种 Windows 盘符路径；裸导入正则均不得匹配。 */
  test('should work with absolute paths', () => {
    expect(bareImportRE.test('/foo')).toBe(false)
    expect(bareImportRE.test('C:/foo')).toBe(false)
    expect(bareImportRE.test('C:\\foo')).toBe(false)
  })
  /** 输入 ./foo 和反斜杠相对路径；裸导入正则均不得匹配。 */
  test('should work with relative path', () => {
    expect(bareImportRE.test('./foo')).toBe(false)
    expect(bareImportRE.test('.\\foo')).toBe(false)
  })
})

describe('isParentDirectory', () => {
  const cases = {
    '/parent': {
      '/parent': false,
      '/parenta': false,
      '/parent/': true,
      '/parent/child': true,
      '/parent/child/child2': true,
    },
    '/parent/': {
      '/parent': false,
      '/parenta': false,
      '/parent/': true,
      '/parent/child': true,
      '/parent/child/child2': true,
    },
  }

  for (const [parent, children] of Object.entries(cases)) {
    for (const [child, expected] of Object.entries(children)) {
      /** 循环比较 parent 带/不带尾斜杠与同名、相似前缀、各级子路径；按表返回 expected，同名无斜杠不是子目录，parenta 不能误匹配。 */
      test(`isParentDirectory("${parent}", "${child}")`, () => {
        expect(isParentDirectory(parent, child)).toBe(expected)
      })
    }
  }
})

describe('injectQuery', () => {
  if (isWindows) {
    // Windows 的反斜杠路径解析与 POSIX 不同，以下三例只在 Windows 注册。
    /** 仅在 Windows 注册：为反斜杠目录注入 direct 查询，结果应规范为正斜杠且追加 ?direct。 */
    test('normalize windows path', () => {
      expect(injectQuery('C:\\User\\Vite\\Project', 'direct')).toEqual(
        'C:/User/Vite/Project?direct',
      )
    })

    /** 仅在 Windows 注册：为盘符文件注入 direct，结果应保留盘符并规范分隔符。 */
    test('absolute file path', () => {
      expect(injectQuery('C:\\test-file.vue', 'direct')).toEqual(
        'C:/test-file.vue?direct',
      )
    })

    /** 仅在 Windows 注册：已有 vue/type/lang 查询的盘符文件注入 direct，应把新键放在原查询之前。 */
    test('absolute file path with parameters', () => {
      expect(
        injectQuery('C:\\test-file.vue?vue&type=template&lang.js', 'direct'),
      ).toEqual('C:/test-file.vue?direct&vue&type=template&lang.js')
    })
  }

  /** 对无前缀、./ 和 ../ 三种相对路径注入 direct；相对层级和 %20 编码保持不变。 */
  test('relative path', () => {
    expect(injectQuery('usr/vite/%20a%20', 'direct')).toEqual(
      'usr/vite/%20a%20?direct',
    )
    expect(injectQuery('./usr/vite/%20a%20', 'direct')).toEqual(
      './usr/vite/%20a%20?direct',
    )
    expect(injectQuery('../usr/vite/%20a%20', 'direct')).toEqual(
      '../usr/vite/%20a%20?direct',
    )
  })

  /** 路径含空格和 hash，hash 内还有问号；注入查询应放在 # 前，fragment 原样保留。 */
  test('path with hash', () => {
    expect(injectQuery('/usr/vite/path with space/#1?2/', 'direct')).toEqual(
      '/usr/vite/path with space/?direct#1?2/',
    )
  })

  /** 对 file: 与 http: URL 注入 direct；协议及编码路径保持，末尾增加查询。 */
  test('path with protocol', () => {
    expect(injectQuery('file:///usr/vite/%20a%20', 'direct')).toMatch(
      'file:///usr/vite/%20a%20?direct',
    )
    expect(injectQuery('http://usr.vite/%20a%20', 'direct')).toMatch(
      'http://usr.vite/%20a%20?direct',
    )
  })

  /** 路径带多个原始空格；注入 direct 后空格仍原样保留，不隐式 URL 编码。 */
  test('path with multiple spaces', () => {
    expect(injectQuery('/usr/vite/path with space', 'direct')).toEqual(
      '/usr/vite/path with space?direct',
    )
  })

  /** 路径含多个 %20；注入 direct 不二次编码百分号。 */
  test('path with multiple % characters', () => {
    expect(injectQuery('/usr/vite/not%20a%20space', 'direct')).toEqual(
      '/usr/vite/not%20a%20space?direct',
    )
  })

  /** 路径含 %25；注入 direct 保留已编码百分号，不解码成裸 %。 */
  test('path with %25', () => {
    expect(injectQuery('/usr/vite/%25hello%25', 'direct')).toEqual(
      '/usr/vite/%25hello%25?direct',
    )
  })

  /** 路径含东京 Unicode 字符；注入 direct 后字符原样保留。 */
  test('path with Unicode', () => {
    expect(injectQuery('/usr/vite/東京', 'direct')).toEqual(
      '/usr/vite/東京?direct',
    )
  })

  /** 路径混合 Unicode、空格和 %20；注入 direct 不改变任一类字符。 */
  test('path with Unicode, space, and %', () => {
    expect(injectQuery('/usr/vite/東京 %20 hello', 'direct')).toEqual(
      '/usr/vite/東京 %20 hello?direct',
    )
  })

  /** 已有 url 参数保存编码后的 HTTPS 地址；注入 t=1234 应置于原参数前且不改变其编码值。 */
  test('path with url-encoded path as query parameter', () => {
    const src = '/src/module.ts?url=https%3A%2F%2Fusr.vite%2F'
    const expected = '/src/module.ts?t=1234&url=https%3A%2F%2Fusr.vite%2F'
    expect(injectQuery(src, 't=1234')).toEqual(expected)
  })
})

describe('resolveHostname', () => {
  /** host 缺省时解析 hostname；监听 host 应为 localhost，展示 name 使用 DNS 差异探测结果或 localhost。 */
  test('defaults to localhost', async () => {
    const resolved = await getLocalhostAddressIfDiffersFromDNS()

    expect(await resolveHostname(undefined)).toEqual({
      host: 'localhost',
      name: resolved ?? 'localhost',
    })
  })

  /** 显式 host=localhost；解析后与缺省规则相同，展示名按 DNS 差异结果选择。 */
  test('accepts localhost', async () => {
    const resolved = await getLocalhostAddressIfDiffersFromDNS()

    expect(await resolveHostname('localhost')).toEqual({
      host: 'localhost',
      name: resolved ?? 'localhost',
    })
  })

  /** host=0.0.0.0；解析应保留全接口监听地址，但展示名回退 localhost。 */
  test('accepts 0.0.0.0', async () => {
    expect(await resolveHostname('0.0.0.0')).toEqual({
      host: '0.0.0.0',
      name: 'localhost',
    })
  })

  /** host=::；解析应保留 IPv6 全接口地址，展示名回退 localhost。 */
  test('accepts ::', async () => {
    expect(await resolveHostname('::')).toEqual({
      host: '::',
      name: 'localhost',
    })
  })

  /** host 为展开形式的 IPv6 全零地址；监听值原样保留，展示名仍为 localhost。 */
  test('accepts 0000:0000:0000:0000:0000:0000:0000:0000', async () => {
    expect(
      await resolveHostname('0000:0000:0000:0000:0000:0000:0000:0000'),
    ).toEqual({
      host: '0000:0000:0000:0000:0000:0000:0000:0000',
      name: 'localhost',
    })
  })
})

describe('extractHostnamesFromSubjectAltName', () => {
  const testCases = [
    ['DNS:localhost', ['localhost']],
    ['DNS:localhost, DNS:foo.localhost', ['localhost', 'foo.localhost']],
    ['DNS:*.localhost', ['vite.localhost']],
    ['DNS:[::1]', []], // IPv6 DNS 名跳过
    ['DNS:*.192.168.0.152, DNS:192.168.0.152', ['192.168.0.152']], // 通配 IP 跳过
    ['othername:"foo,bar", DNS:localhost', ['localhost']], // 引号内逗号不拆分
  ] as const

  for (const [input, expected] of testCases) {
    /** 按 SAN 输入表解析单/多 DNS、通配 DNS、IPv6、通配 IP 和带引号逗号的 othername；仅输出可用 hostname，通配 DNS 替换为 vite，IPv6 和通配 IP 跳过。 */
    test(`should extract names from subjectAltName: ${input}`, () => {
      expect(extractHostnamesFromSubjectAltName(input)).toStrictEqual(expected)
    })
  }

  /** 从真实 PEM 证书读取 SAN 再解析；应得到两个 localhost 名与由 *.vite.localhost 推导的 vite.vite.localhost。 */
  test('should extract names from actual certificate', () => {
    const cert = new crypto.X509Certificate(WORKING_TEST_CERT)
    expect(
      extractHostnamesFromSubjectAltName(cert.subjectAltName ?? ''),
    ).toStrictEqual([
      'localhost',
      'foo.localhost',
      'vite.vite.localhost', // 通配 DNS 替换 * 为 vite
    ])
  })
})

describe('posToNumber', () => {
  /** 源码 a 换行 b 的第二行首列转数字偏移；结果应为 2。 */
  test('simple', () => {
    const actual = posToNumber('a\nb', { line: 2, column: 0 })
    expect(actual).toBe(2)
  })
  /** 已经是数字偏移 2 时转换；应直接返回同一数字。 */
  test('pass though pos', () => {
    const actual = posToNumber('a\nb', 2)
    expect(actual).toBe(2)
  })
  /** 源码中含空行，第三行首列转偏移；应计算空行换行符并得到 3。 */
  test('empty line', () => {
    const actual = posToNumber('a\n\nb', { line: 3, column: 0 })
    expect(actual).toBe(3)
  })
  /** 传入超出源码的第四行位置；posToNumber 当前宽松累计得到 4，本例固定此回退行为。 */
  test('out of range', () => {
    const actual = posToNumber('a\nb', { line: 4, column: 0 })
    expect(actual).toBe(4)
  })
})

describe('numberToPos', () => {
  /** 把 a 换行 b 的偏移 2 转位置；结果应为第二行零列。 */
  test('simple', () => {
    const actual = numberToPos('a\nb', 2)
    expect(actual).toEqual({ line: 2, column: 0 })
  })
  /** 输入已经是行列对象；numberToPos 应保留对应位置。 */
  test('pass though pos', () => {
    const actual = numberToPos('a\nb', { line: 2, column: 0 })
    expect(actual).toEqual({ line: 2, column: 0 })
  })
  /** 含空行源码的偏移 3 转位置；应为第三行零列。 */
  test('empty line', () => {
    const actual = numberToPos('a\n\nb', 3)
    expect(actual).toEqual({ line: 3, column: 0 })
  })
  /** 两行各三字符的源码偏移 5 转位置；应为第二行第一列。 */
  test('middle of line', () => {
    const actual = numberToPos('abc\ndef', 5)
    expect(actual).toEqual({ line: 2, column: 1 })
  })
  /** 偏移落在首行末尾换行符之前；应为第一行第三列。 */
  test('end of line', () => {
    const actual = numberToPos('abc\ndef', 3)
    expect(actual).toEqual({ line: 1, column: 3 })
  })
  /** 数字偏移超出源码长度；numberToPos 应抛 offset is longer than source length。 */
  test('out of range', () => {
    expect(() => numberToPos('a\nb', 5)).toThrowError(
      'offset is longer than source length',
    )
  })
})

describe('generateCodeFrames', () => {
  const source = `
import foo from './foo'
foo()
`.trim()
  const sourceCrLf = source.replaceAll('\n', '\r\n')
  const longSource = `
import foo from './foo'

foo()
// 1
// 2
// 3
`.trim()
  const veryLongSource = Array.from({ length: 2000 }, (_, i) => `// ${i}`).join(
    '\n',
  )

  /** 给代码框快照补首尾换行；失败时移除此包装函数的堆栈，再重新抛错。 */
  const expectSnapshot = (value: string) => {
    try {
      // 首尾空行让多行代码框快照更易阅读。
      expect('\n' + value + '\n').toMatchSnapshot()
    } catch (e) {
      // 堆栈直接指向用例中的代码框调用。
      if (e instanceof Error) {
        Error.captureStackTrace(e, expectSnapshot)
      }
      throw e
    }
  }

  /** 对两行源码传负值、行首、行内及第二行起点的数字 start；快照固定代码框选区和上下文。 */
  test('start with number', () => {
    expectSnapshot(generateCodeFrame(source, -1))
    expectSnapshot(generateCodeFrame(source, 0))
    expectSnapshot(generateCodeFrame(source, 1))
    expectSnapshot(generateCodeFrame(source, 24))
  })

  /** 以三种行列对象作为代码框 start；快照核对对象位置与标记列转换。 */
  test('start with position', () => {
    expectSnapshot(generateCodeFrame(source, { line: 1, column: 0 }))
    expectSnapshot(generateCodeFrame(source, { line: 1, column: 1 }))
    expectSnapshot(generateCodeFrame(source, { line: 2, column: 0 }))
  })

  /** 同一两行源码改用 CRLF；第二行零列的代码框快照应正确处理双字符换行。 */
  test('works with CRLF', () => {
    expectSnapshot(generateCodeFrame(sourceCrLf, { line: 2, column: 0 }))
  })

  /** 代码框 end 从零长到源码外多个范围；快照固定选区终点与超界截取行为。 */
  test('end', () => {
    expectSnapshot(generateCodeFrame(source, 0, 0))
    expectSnapshot(generateCodeFrame(source, 0, 23))
    expectSnapshot(generateCodeFrame(source, 0, 29))
    expectSnapshot(generateCodeFrame(source, 0, source.length))
    expectSnapshot(generateCodeFrame(source, 0, source.length + 1))
    expectSnapshot(generateCodeFrame(source, 0, source.length + 100))
  })

  /** 多行源码选择第三行起点及跨第三/第四行范围；快照核对上下文和跨行标记。 */
  test('range', () => {
    expectSnapshot(generateCodeFrame(longSource, { line: 3, column: 0 }))
    expectSnapshot(
      generateCodeFrame(
        longSource,
        { line: 3, column: 0 },
        { line: 4, column: 0 },
      ),
    )
  })

  /** 代码框 start=2 大于 end=0；快照固定反向范围的当前处理结果。 */
  test('invalid start > end', () => {
    expectSnapshot(generateCodeFrame(source, 2, 0))
  })

  /** 生成 2000 行源码并定位第 1200 行；快照核对四位行号和上下文没有千行截断。 */
  test('supports more than 1000 lines', () => {
    expectSnapshot(generateCodeFrame(veryLongSource, { line: 1200, column: 0 }))
  })

  /** 180 字符长行选取第 0–30 列；快照核对靠左选区的截取和标记。 */
  test('long line (start)', () => {
    const longLine = 'a'.repeat(60) + 'b'.repeat(60) + 'c'.repeat(60)
    const src = `${longLine}\nshort line\n${longLine}`
    const frame = generateCodeFrame(
      src,
      { line: 1, column: 0 },
      { line: 1, column: 30 },
    )
    expectSnapshot(frame)
  })

  /** 同一长行选取第 90–120 列；快照核对中间选区与两侧省略。 */
  test('long line (center)', () => {
    const longLine = 'a'.repeat(60) + 'b'.repeat(60) + 'c'.repeat(60)
    const src = `${longLine}\nshort line\n${longLine}`
    const frame = generateCodeFrame(
      src,
      { line: 1, column: 90 },
      { line: 1, column: 120 },
    )
    expectSnapshot(frame)
  })

  /** 同一长行选取第 150–180 列；快照核对靠右选区保留终点。 */
  test('long line (end)', () => {
    const longLine = 'a'.repeat(60) + 'b'.repeat(60) + 'c'.repeat(60)
    const src = `${longLine}\nshort line\n${longLine}`
    const frame = generateCodeFrame(
      src,
      { line: 1, column: 150 },
      { line: 1, column: 180 },
    )
    expectSnapshot(frame)
  })

  /** 选取整条 180 字符长行；快照固定超长整行的展示与标记。 */
  test('long line (whole)', () => {
    const longLine = 'a'.repeat(60) + 'b'.repeat(60) + 'c'.repeat(60)
    const src = `${longLine}\nshort line\n${longLine}`
    const frame = generateCodeFrame(
      src,
      { line: 1, column: 0 },
      { line: 1, column: 180 },
    )
    expectSnapshot(frame)
  })

  /** 范围从长行第 170 列跨到下一短行第 5 列；快照核对前长后短的跨行代码框。 */
  test('long line (multiline 1)', () => {
    const longLine = 'a'.repeat(60) + 'b'.repeat(60) + 'c'.repeat(60)
    const src = `${longLine}\nshort line\n${longLine}`
    const frame = generateCodeFrame(
      src,
      { line: 1, column: 170 },
      { line: 2, column: 5 },
    )
    expectSnapshot(frame)
  })

  /** 范围从短行第 5 列跨到下一长行第 30 列；快照核对前短后长的跨行代码框。 */
  test('long line (multiline 2)', () => {
    const longLine = 'a'.repeat(60) + 'b'.repeat(60) + 'c'.repeat(60)
    const src = `${longLine}\nshort line\n${longLine}`
    const frame = generateCodeFrame(
      src,
      { line: 2, column: 5 },
      { line: 3, column: 30 },
    )
    expectSnapshot(frame)
  })
})

describe('getFileStartIndex', () => {
  const LINE_TERMINATORS = {
    LF: '\n',
    CRLF: '\r\n',
    CR: '\r',
    'LINE SEPARATOR': '\u2028',
    'PARAGRAPH SEPARATOR': '\u2029',
  }
  for (const [terminatorName, terminator] of Object.entries(LINE_TERMINATORS)) {
    /** 分别以 LF、CRLF、CR、U+2028、U+2029 结束 hashbang，再接 JS；返回起点应等于含终止符的 hashbang 长度。 */
    test(`returns the index after a hashbang ending in ${terminatorName}`, () => {
      const hashbang = `#!/usr/bin/env node${terminator}`
      expect(getFileStartIndex(`${hashbang}console.log(1)`)).toBe(
        hashbang.length,
      )
    })
  }

  /** 源码只有未换行结束的 hashbang；可插入代码的起点应为源码末尾。 */
  test('returns the end of an unterminated hashbang', () => {
    const code = '#!/usr/bin/env node'
    expect(getFileStartIndex(code)).toBe(code.length)
  })

  /** 普通 JS 不含 hashbang；起点应为 0。 */
  test('returns zero without a hashbang', () => {
    expect(getFileStartIndex('console.log(1)')).toBe(0)
  })
})

describe('getHash', () => {
  /** 为空 Buffer 计算默认 hash；结果应匹配八位小写十六进制格式，不固定具体哈希值。 */
  test('8-digit hex', () => {
    const hash = getHash(Buffer.alloc(0))
    expect(hash).toMatch(/^[\da-f]{8}$/)
  })
})

describe('asyncFlatten', () => {
  /** 展平普通数字数组；等待结果后顺序和值应与输入相同。 */
  test('plain array', async () => {
    const arr = await asyncFlatten([1, 2, 3])
    expect(arr).toEqual([1, 2, 3])
  })

  /** 展平含一个嵌套数组的输入；嵌套数字按原顺序追加到一维结果。 */
  test('nested array', async () => {
    const arr = await asyncFlatten([1, 2, 3, [4, 5, 6]])
    expect(arr).toEqual([1, 2, 3, 4, 5, 6])
  })

  /** 嵌套数组含 false/null/undefined；展平后保留这些值，不作 truthy 过滤。 */
  test('nested falsy array', async () => {
    const arr = await asyncFlatten([1, 2, false, [4, null, undefined]])
    expect(arr).toEqual([1, 2, false, 4, null, undefined])
  })

  /** 数组含一个 resolved Promise 标量；展平应等待其值并保持原顺序。 */
  test('plain promise array', async () => {
    const arr = await asyncFlatten([1, 2, Promise.resolve(3)])
    expect(arr).toEqual([1, 2, 3])
  })

  /** 数组同时含 Promise 标量和 Promise 数组；等待后应递归展平为 1–6。 */
  test('nested promise array', async () => {
    const arr = await asyncFlatten([
      1,
      2,
      Promise.resolve(3),
      Promise.resolve([4, 5, 6]),
    ])
    expect(arr).toEqual([1, 2, 3, 4, 5, 6])
  })

  /** Promise 数组中继续嵌套 Promise 标量及数组；递归等待与展平后应按序得到 1–9。 */
  test('2x nested promise array', async () => {
    const arr = await asyncFlatten([
      1,
      2,
      Promise.resolve(3),
      Promise.resolve([4, 5, Promise.resolve(6), Promise.resolve([7, 8, 9])]),
    ])
    expect(arr).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
})

describe('isFileReadable', () => {
  /** 检查不存在的绝对路径；文件可读性应为 false。 */
  test("file doesn't exist", async () => {
    expect(isFileReadable('/does_not_exist')).toBe(false)
  })

  const testFile = path.resolve(
    import.meta.dirname,
    './utils/isFileReadable/permission-test-file',
  )
  /** 检查权限正常的真实 permission-test-file 夹具；应为可读。 */
  test('file with normal permission', async () => {
    expect(isFileReadable(testFile)).toBe(true)
  })

  if (process.platform !== 'win32') {
    /** 仅在非 Windows 注册：将真实文件 chmod 为 400 后检查；仅有所有者读权限仍应返回 true。 */
    test('file with read-only permission', async () => {
      fs.chmodSync(testFile, '400')
      expect(isFileReadable(testFile)).toBe(true)
    })
    /** 仅在非 Windows 且当前非 root、getuid 可用时执行：chmod 为 044 应不可读，断言后恢复 644；其他条件不执行本例。 */
    test.runIf(process.getuid && process.getuid() !== 0)(
      'file without read permission',
      async () => {
        fs.chmodSync(testFile, '044')
        expect(isFileReadable(testFile)).toBe(false)
        fs.chmodSync(testFile, '644')
      },
    )
  }
})

describe('processSrcSetSync', () => {
  /** srcset 两个候选以逗号空格分隔；回调前缀 /base 后两条 URL 改写且 1x/2x 描述符保留。 */
  test('prepend base URL to srcset', async () => {
    const devBase = '/base/'
    expect(
      processSrcSetSync(
        './nested/asset.png 1x, ./nested/asset.png 2x',
        ({ url }) => path.posix.join(devBase, url),
      ),
    ).toBe('/base/nested/asset.png 1x, /base/nested/asset.png 2x')
  })

  /** srcset 候选逗号后无空格；前缀 URL 后输出应规范为逗号空格分隔。 */
  test('prepend base URL to srcset 2', async () => {
    const devBase = '/base/'
    expect(
      processSrcSetSync(
        './nested/asset.png 1x,./nested/asset.png 2x',
        ({ url }) => path.posix.join(devBase, url),
      ),
    ).toBe('/base/nested/asset.png 1x, /base/nested/asset.png 2x')
  })

  /** srcset 的两个 URL 带双引号；回调去引号加 base 再补引号，输出应保留引号和描述符。 */
  test('prepend base URL to srcset 3', async () => {
    const devBase = '/base/'
    expect(
      processSrcSetSync(
        '"./nested/asset.png" 1x,"./nested/asset.png" 2x',
        ({ url }) => `"${path.posix.join(devBase, url.slice(1, -1))}"`,
      ),
    ).toBe('"/base/nested/asset.png" 1x, "/base/nested/asset.png" 2x')
  })

  /** 两个 data:base64 候选自身含逗号；恒等回调后应原样返回，不能把 data 头误分成候选。 */
  test('should not split the comma inside base64 value', async () => {
    const base64 =
      'data:image/avif;base64,aA+/0= 400w, data:image/avif;base64,bB+/9= 800w'
    expect(processSrcSetSync(base64, ({ url }) => url)).toBe(base64)
  })

  /** 两个 URL 的 query 含逗号；恒等回调应保留完整参数和 400w/800w 描述符。 */
  test('should not split the comma inside image URI', async () => {
    const imageURIWithComma =
      'asset.png?param1=true,param2=false 400w, asset.png?param1=true,param2=false 800w'
    expect(processSrcSetSync(imageURIWithComma, ({ url }) => url)).toBe(
      imageURIWithComma,
    )
  })

  /** 首个 srcset 候选没有描述符、第二个有 400w；解析再拼接应保留这两种形式。 */
  test('should handle srcset when descriptor is not present', async () => {
    const srcsetNoDescriptor = 'asset.png, test.png 400w'
    const result = 'asset.png, test.png 400w'
    expect(processSrcSetSync(srcsetNoDescriptor, ({ url }) => url)).toBe(result)
  })

  /** 输入只有一个普通 HTTPS URL；恒等处理应返回完整 URL。 */
  test('should not break a regular URL in srcSet', async () => {
    const source = 'https://anydomain/image.jpg'
    expect(
      processSrcSetSync('https://anydomain/image.jpg', ({ url }) => url),
    ).toBe(source)
  })

  /** 两条 HTTPS URL 路径含多个逗号且间隔有 tab/多空格；输出只规范候选间空白，URL 内逗号保留。 */
  test('should not break URLs with commas in srcSet', async () => {
    const source = `
      \thttps://example.com/dpr_1,f_auto,fl_progressive,q_auto,w_100/v1/img   1x,
      \thttps://example.com/dpr_2,f_auto,fl_progressive,q_auto,w_100/v1/img\t\t2x
    `
    const result =
      'https://example.com/dpr_1,f_auto,fl_progressive,q_auto,w_100/v1/img 1x, https://example.com/dpr_2,f_auto,fl_progressive,q_auto,w_100/v1/img 2x'
    expect(processSrcSetSync(source, ({ url }) => url)).toBe(result)
  })

  /** image-set 两个 url() 候选内部 URL 含逗号，第二个带引号；恒等处理后保留函数与 URL，只规范空白。 */
  test('should not break URLs with commas in image-set-options', async () => {
    const source = `url(https://example.com/dpr_1,f_auto,fl_progressive,q_auto,w_100/v1/img)   1x,
      url("https://example.com/dpr_2,f_auto,fl_progressive,q_auto,w_100/v1/img")\t\t2x
    `
    const result =
      'url(https://example.com/dpr_1,f_auto,fl_progressive,q_auto,w_100/v1/img) 1x, url("https://example.com/dpr_2,f_auto,fl_progressive,q_auto,w_100/v1/img") 2x'
    expect(processSrcSetSync(source, ({ url }) => url)).toBe(result)
  })

  /** image-set 包含 1x、2x、600dpi 三种 resolution；输出保留每种单位并规范空白。 */
  test('should parse image-set-options with resolution', async () => {
    const source = ` "foo.png" 1x,
                     "foo-2x.png" 2x,
                     "foo-print.png" 600dpi`
    const result = '"foo.png" 1x, "foo-2x.png" 2x, "foo-print.png" 600dpi'
    expect(processSrcSetSync(source, ({ url }) => url)).toBe(result)
  })

  /** image-set 两种图片各带 type()；输出保留 MIME 类型和引号，并规范候选空白。 */
  test('should parse image-set-options with type', async () => {
    const source = ` "foo.avif" type("image/avif"),
                     "foo.jpg" type("image/jpeg") `
    const result = '"foo.avif" type("image/avif"), "foo.jpg" type("image/jpeg")'
    expect(processSrcSetSync(source, ({ url }) => url)).toBe(result)
  })

  /** image-set 同时包含逗号分隔参数的 gradient 和 url()；应把每个完整函数视为一个候选。 */
  test('should parse image-set-options with linear-gradient', async () => {
    const source = `linear-gradient(cornflowerblue, white) 1x,
                    url("detailed-gradient.png") 3x`
    const result =
      'linear-gradient(cornflowerblue, white) 1x, url("detailed-gradient.png") 3x'
    expect(processSrcSetSync(source, ({ url }) => url)).toBe(result)
  })

  /** 候选的 resolution 与 type() 使用两种顺序和 tab；输出保持原顺序并规范空白。 */
  test('should parse image-set-options with resolution and type specified', async () => {
    const source = `url("picture.png")\t1x\t type("image/jpeg"), url("picture.png")\t type("image/jpeg")\t2x`
    const result =
      'url("picture.png") 1x type("image/jpeg"), url("picture.png") type("image/jpeg") 2x'
    expect(processSrcSetSync(source, ({ url }) => url)).toBe(result)
  })

  /** 对 gradient 与 url() 两候选记录回调的 url 值；应分别捕获完整函数，不能从内层逗号处分裂。 */
  test('should capture whole image set options', async () => {
    const source = `linear-gradient(cornflowerblue, white) 1x,
                    url("detailed-gradient.png") 3x`
    const expected = [
      'linear-gradient(cornflowerblue, white)',
      'url("detailed-gradient.png")',
    ]
    const result: string[] = []
    processSrcSetSync(source, ({ url }) => {
      result.push(url)
      return url
    })
    expect(result).toEqual(expected)
  })
})

describe('flattenId', () => {
  /** 先构造 170 字符 ID，再增加至 180 字符；flattenId 两次结果都应为 170 字符，固定长度上限。 */
  test('should limit id to 170 characters', () => {
    const tenChars = '1234567890'
    let id = ''

    for (let i = 0; i < 17; i++) {
      id += tenChars
    }
    expect(id).toHaveLength(170)

    const result = flattenId(id)
    expect(result).toHaveLength(170)

    id += tenChars
    const result2 = flattenId(id)
    expect(result2).toHaveLength(170)
  })

  /** 包子路径含三个 +；展平应将分隔符和 + 转为确定编码，结果不得保留 +。 */
  test('should replace + symbols in package subpath exports', () => {
    // ravelinjs 的子路径导出中包含 +，用作真实包名形式的回归输入。
    const id = 'ravelinjs/core+track+encrypt+promise'
    const result = flattenId(id)
    expect(result).not.toContain('+')
    expect(result).toBe('ravelinjs_core_02b_track_02b_encrypt_02b_promise')
  })

  /** ID 含一至四个连续下划线；快照核对转义以区分原有下划线与其他分隔符编码。 */
  test('escape _', () => {
    expect(flattenId('foo_bar')).toMatchInlineSnapshot(`"foo___bar"`)
    expect(flattenId('foo__bar')).toMatchInlineSnapshot(`"foo____bar"`)
    expect(flattenId('foo___bar')).toMatchInlineSnapshot(`"foo_____bar"`)
    expect(flattenId('foo____bar')).toMatchInlineSnapshot(`"foo______bar"`)
  })

  /** ID 含目录斜杠；展平快照应以单下划线替代。 */
  test('escape /', () => {
    expect(flattenId('foo/bar')).toMatchInlineSnapshot(`"foo_bar"`)
  })

  /** ID 含点号；展平快照应以双下划线替代。 */
  test('escape .', () => {
    expect(flattenId('foo.bar')).toMatchInlineSnapshot(`"foo__bar"`)
  })

  /** 分别输入 #、$、*、+ 四种字符；快照核对各自十六进制编码，避免非法 URL 路径字符。 */
  test('escape invalid URL path chars', () => {
    expect(flattenId('foo#bar')).toMatchInlineSnapshot(`"foo_023_bar"`)
    expect(flattenId('foo$bar')).toMatchInlineSnapshot(`"foo_024_bar"`)
    expect(flattenId('foo*bar')).toMatchInlineSnapshot(`"foo_02a_bar"`)
    expect(flattenId('foo+bar')).toMatchInlineSnapshot(`"foo_02b_bar"`)
  })

  /** 嵌套依赖 ID 的 > 两側使用四种空格组合；展平快照应统一为 foo_n_bar。 */
  test('escape nested IDs', () => {
    expect(flattenId('foo>bar')).toMatchInlineSnapshot(`"foo_n_bar"`)
    expect(flattenId('foo >bar')).toMatchInlineSnapshot(`"foo_n_bar"`)
    expect(flattenId('foo> bar')).toMatchInlineSnapshot(`"foo_n_bar"`)
    expect(flattenId('foo > bar')).toMatchInlineSnapshot(`"foo_n_bar"`)
  })
})

describe('mergeWithDefaults', () => {
  /** 合并含 undefined/null/数组/嵌套对象的值与 defaults；undefined 回退、null 保留、数组替换、新键纳入，且缺省对象和数组复制而非复用引用。 */
  test('merges with defaults', () => {
    const actual = mergeWithDefaults(
      {
        useDefault: 1,
        useValueIfNull: 2,
        replaceArray: [0, 1],
        nested: {
          foo: 'bar',
        },
      },
      {
        useDefault: undefined,
        useValueIfNull: null,
        useValueIfNoDefault: 'foo',
        replaceArray: [2, 3],
        nested: {
          foo2: 'bar2',
        },
      },
    )
    expect(actual).toStrictEqual({
      useDefault: 1,
      useValueIfNull: null,
      useValueIfNoDefault: 'foo',
      replaceArray: [2, 3],
      nested: {
        foo: 'bar',
        foo2: 'bar2',
      },
    })

    const defaults = {
      object: {},
      array: [],
      regex: /foo/,
      /** 作为非普通对象的函数缺省值，结果只检查仍为函数。 */
      function: () => {},
    }
    const actual2 = mergeWithDefaults(defaults, {})
    expect(actual2.object).toStrictEqual({})
    expect(actual2.array).toStrictEqual([])
    expect(actual2.regex).toStrictEqual(/foo/)
    expect(actual2.function).toStrictEqual(expect.any(Function))
    // 缺省对象和数组必须复制，防止合并结果修改 defaults。
    expect(actual2.object).not.toBe(defaults.object)
    expect(actual2.array).not.toBe(defaults.array)
  })
})

describe('combineSourcemaps', () => {
  const _dirname = path.dirname(fileURLToPath(import.meta.url))
  /** 从当前测试目录生成规范化绝对路径，使 sourcemap source 比较跨平台一致。 */
  const resolveFile = (file: string) => {
    return normalizePath(path.resolve(_dirname, file))
  }

  /** 组合 MagicString 与 esbuild 两段单 source map；核对最终 file、source 和追溯到原始代码的 mappings。 */
  test('should combine sourcemaps with single sources', () => {
    const sourcemaps = [
      // 此 map 由 MagicString 生成。
      // https://evanw.github.io/source-map-visualization/#MzQALyogY29tbWVudCAqLwpjb25zb2xlLmxvZygiZm9vIik7CjE1NgB7InZlcnNpb24iOjMsInNvdXJjZXMiOlsiL3NyYy9mb28uanMiXSwic291cmNlc0NvbnRlbnQiOlsiY29uc29sZS5sb2coXCJmb29cIik7XG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQzsifQo=
      {
        version: 3 as const,
        mappings: ';AAAA,OAAO,CAAC,GAAG,CAAC,CAAC,GAAG,CAAC,CAAC;',
        names: [],
        sources: [resolveFile('./src/foo.js')],
      },
      // 此 map 由 esbuild 生成。
      // https://evanw.github.io/source-map-visualization/#MjAAY29uc29sZS5sb2coImZvbyIpOwoxNDgAewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiL3NyYy9mb28uanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnNvbGUubG9nKFwiZm9vXCIpIl0sCiAgIm1hcHBpbmdzIjogIkFBQUEsUUFBUSxJQUFJLEtBQUs7IiwKICAibmFtZXMiOiBbXQp9Cg==
      {
        version: 3 as const,
        mappings: 'AAAA,QAAQ,IAAI,KAAK;',
        names: [],
        sources: [resolveFile('./src/foo.js')],
      },
    ]
    const combined = combineSourcemaps(resolveFile('./src/foo.js'), sourcemaps)
    expect(combined).toStrictEqual(
      expect.objectContaining({
        version: 3,
        file: resolveFile('./src/foo.js'),
        mappings: ';AAAA,QAAQ,IAAI,KAAK',
        sources: [resolveFile('./src/foo.js')],
      }),
    )
  })

  /** 上游 MagicString 单 source map 与下游 esbuild 的 b.js/a.js 双 source map 组合；核对最终两个 source 顺序及映射位置。 */
  test('should combine sourcemaps with multiple sources', () => {
    const sourcemaps = [
      // 此 map 由 MagicString 生成。
      // https://evanw.github.io/source-map-visualization/#NzcALyogY29tbWVudCAqLwovLyBiLmpzCmNvbnNvbGUubG9nKCIuL2IuanMiKTsKCi8vIGEuanMKY29uc29sZS5sb2coIi4vYS5qcyIpOwozMzkAeyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi9hLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vIGIuanNcbmNvbnNvbGUubG9nKFwiLi9iLmpzXCIpO1xuXG4vLyBhLmpzXG5jb25zb2xlLmxvZyhcIi4vYS5qc1wiKTtcblxuIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7T0FDRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7O0FBRXJCLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztPQUNFLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQzs7In0K
      {
        version: 3 as const,
        mappings:
          ';AAAA,CAAC,CAAC,CAAC,CAAC,CAAC;OACE,CAAC,GAAG,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,EAAE,CAAC,CAAC;;AAErB,CAAC,CAAC,CAAC,CAAC,CAAC;OACE,CAAC,GAAG,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,EAAE,CAAC,CAAC;;',
        names: [],
        sources: [resolveFile('./src/a.js')],
      },
      // 此 map 由 esbuild 生成。
      // https://evanw.github.io/source-map-visualization/#NjMALy8gYi5qcwpjb25zb2xlLmxvZygiLi9iLmpzIik7CgovLyBhLmpzCmNvbnNvbGUubG9nKCIuL2EuanMiKTsKMjIwAHsKICAidmVyc2lvbiI6IDMsCiAgInNvdXJjZXMiOiBbImIuanMiLCAiYS5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiY29uc29sZS5sb2coJy4vYi5qcycpXG4iLCAiaW1wb3J0ICcuL2IuanMnXG5jb25zb2xlLmxvZygnLi9hLmpzJylcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBQSxRQUFRLElBQUksUUFBUTs7O0FDQ3BCLFFBQVEsSUFBSSxRQUFROyIsCiAgIm5hbWVzIjogW10KfQo=
      {
        version: 3 as const,
        mappings: ';AAAA,QAAQ,IAAI,QAAQ;;;ACCpB,QAAQ,IAAI,QAAQ;',
        names: [],
        sources: [resolveFile('./src/b.js'), resolveFile('./src/a.js')],
      },
    ]
    const combined = combineSourcemaps(resolveFile('./src/a.js'), sourcemaps)
    expect(combined).toStrictEqual(
      expect.objectContaining({
        version: 3,
        file: resolveFile('./src/a.js'),
        mappings: ';;OAAA,CAAQ,IAAI,QAAQ;;;OCCpB,CAAQ,IAAI,QAAQ',
        sources: [resolveFile('./src/b.js'), resolveFile('./src/a.js')],
      }),
    )
  })

  /** 组合 Sass 的 imported2.sass/Foo.vue map 与 Vue SFC map；最终保留 Sass 外部源并将 Foo.vue 位置追溯回 SFC。 */
  test('should combine sourcemaps with multiple sources 2', () => {
    const sourcemaps = [
      // 此 map 由 Sass 生成。
      // https://evanw.github.io/source-map-visualization/#NTYALmltcG9ydGVkMiB7CiAgY29sb3I6IHJlZAp9CgouaW1wb3J0ZWQgewogIGNvbG9yOiByZWQKfQoyNzAAewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsKICAgICIvaW1wb3J0ZWQyLnNhc3MiLAogICAgIi9Gb28udnVlIgogIF0sCiAgIm5hbWVzIjogW10sCiAgIm1hcHBpbmdzIjogIkFBQUE7RUFDRTs7O0FDRUY7RUFDRSIsCiAgImZpbGUiOiAiL0Zvby52dWUiLAogICJzb3VyY2VzQ29udGVudCI6IFsKICAgICIuaW1wb3J0ZWQyXG4gIGNvbG9yOiByZWRcbiIsCiAgICAiXG5AdXNlICcuL2ltcG9ydGVkMidcblxuLmltcG9ydGVkXG4gIGNvbG9yOiByZWRcbiIKICBdCn0K
      {
        version: 3 as const,
        file: resolveFile('./src/Foo.vue'),
        mappings: 'AAAA;EACE;;;ACEF;EACE',
        names: [],
        sources: [
          resolveFile('./src/imported2.sass'),
          resolveFile('./src/Foo.vue'),
        ],
      },
      // 此 map 由 Vue SFC 转换生成。
      // https://evanw.github.io/source-map-visualization/#NDQACkB1c2UgJy4vaW1wb3J0ZWQyJwoKLmltcG9ydGVkCiAgY29sb3I6IHJlZAo0OTQAewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsKICAgICIvRm9vLnZ1ZSIKICBdLAogICJuYW1lcyI6IFtdLAogICJtYXBwaW5ncyI6ICI7QUFNQSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDOztBQUVqQixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7RUFDTixDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMiLAogICJmaWxlIjogIi9Gb28udnVlIiwKICAic291cmNlc0NvbnRlbnQiOiBbCiAgICAiPHRlbXBsYXRlPlxuICA8cCBjbGFzcz1cImltcG9ydGVkXCI+Zm9vPC9wPlxuICA8cCBjbGFzcz1cImltcG9ydGVkMlwiPmJhcjwvcD5cbjwvdGVtcGxhdGU+XG5cbjxzdHlsZSBsYW5nPVwic2Fzc1wiPlxuQHVzZSAnLi9pbXBvcnRlZDInXG5cbi5pbXBvcnRlZFxuICBjb2xvcjogcmVkXG48L3N0eWxlPlxuIgogIF0KfQo=
      {
        version: 3 as const,
        file: resolveFile('./src/Foo.vue'),
        sources: [resolveFile('./src/Foo.vue')],
        names: [],
        mappings:
          ';AAMA,CAAC,CAAC,CAAC,EAAE,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC;;AAEjB,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC,CAAC;EACN,CAAC,CAAC,CAAC,CAAC,CAAC,EAAE,CAAC,CAAC',
      },
    ]
    const combined = combineSourcemaps(resolveFile('./src/Foo.vue'), sourcemaps)
    expect(combined).toStrictEqual(
      expect.objectContaining({
        version: 3,
        file: resolveFile('./src/Foo.vue'),
        mappings: 'AAAA;EACE;;;ACOF;EACE',
        sources: [
          resolveFile('./src/imported2.sass'),
          resolveFile('./src/Foo.vue'),
        ],
      }),
    )
  })

  /** 组合含 PostCSS 虚拟 source 的 map 与 Sass 上游 map；未匹配的虚拟源保留，实际源追溯至 vendor/index.scss。 */
  test('should combine sourcemaps with multiple sources without matched source', () => {
    const sourcemaps = [
      // 此 map 由 PostCSS 生成。
      // https://evanw.github.io/source-map-visualization/#NjYALmZvbyB7CiAgb3ZlcmZsb3c6IHNjcm9sbDsKICAtd2Via2l0LW92ZXJmbG93LXNjcm9sbGluZzogdG91Y2g7Cn0KMjU1AHsKICAiZmlsZSI6ICIvc3JjL3Nhc3Mvc3R5bGUuc2FzcyIsCiAgIm1hcHBpbmdzIjogIkFBQUE7RUFDRSxnQkFBZ0I7RUNEbEIsa0NBQUE7QURFQSIsCiAgIm5hbWVzIjogW10sCiAgInNvdXJjZXMiOiBbCiAgICAiL3NyYy9zYXNzL3N0eWxlLnNhc3MiLAogICAgIlx1MDAwMDxubyBzb3VyY2U+IgogIF0sCiAgInNvdXJjZXNDb250ZW50IjogWyAiLmZvbyB7XG4gIG92ZXJmbG93OiBzY3JvbGw7XG59IiwgbnVsbCBdLAogICJ2ZXJzaW9uIjogMwp9Cg==
      {
        version: 3 as const,
        file: resolveFile('./src/sass/style.sass'),
        mappings: 'AAAA;EACE,gBAAgB;ECDlB,kCAAA;ADEA',
        names: [],
        sources: [
          resolveFile('./src/sass/style.sass'),
          '\x00<no source>', // PostCSS 虚拟 source 保留在最终 map。
        ],
      },
      // 此 map 由 Sass 生成。
      // https://evanw.github.io/source-map-visualization/#MjkALmZvbyB7CiAgb3ZlcmZsb3c6IHNjcm9sbDsKfQoyMDcAewogICJmaWxlIjogIi9zcmMvc2Fzcy9zdHlsZS5zYXNzIiwKICAibWFwcGluZ3MiOiAiQUFBQTtFQUNFIiwKICAibmFtZXMiOiBbXSwKICAic291cmNlcyI6IFsKICAgICIvc3JjL3Nhc3MvdmVuZG9yL2luZGV4LnNjc3MiCiAgXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi5mb28ge1xuICBvdmVyZmxvdzogc2Nyb2xsO1xufVxuIl0sCiAgInZlcnNpb24iOiAzCn0K
      {
        version: 3 as const,
        sources: [resolveFile('./src/sass/vendor/index.scss')],
        names: [],
        mappings: 'AAAA;EACE',
      },
    ]
    const combined = combineSourcemaps(
      resolveFile('./src/sass/style.sass'),
      sourcemaps,
    )
    expect(combined).toStrictEqual(
      expect.objectContaining({
        version: 3,
        file: resolveFile('./src/sass/style.sass'),
        mappings: 'AAAA;EACE;ECDF',
        sources: [
          resolveFile('./src/sass/vendor/index.scss'),
          '\x00<no source>',
        ],
      }),
    )
  })
})

describe('getServerUrlByHost', () => {
  const urls: ResolvedServerUrls = {
    local: ['http://localhost:5173'],
    network: ['http://foo.example.com:5173'],
  }
  const cases = [
    {
      name: 'when host is undefined',
      urls,
      host: undefined,
      expected: 'http://localhost:5173',
    },
    {
      name: 'when host is true',
      urls,
      host: true,
      expected: 'http://localhost:5173',
    },
    {
      name: 'when host is explicit string',
      urls,
      host: 'foo.example.com',
      expected: 'http://foo.example.com:5173',
    },
    {
      name: 'when host is 0.0.0.0',
      urls,
      host: '0.0.0.0',
      expected: 'http://localhost:5173',
    },
    {
      name: 'when host is ::1',
      urls,
      host: '::1',
      expected: 'http://localhost:5173',
    },
  ] satisfies ReadonlyArray<{
    /** 当前 host 分支的显示名称。 */
    name: string
    /** 提供可选择的 local/network 地址。 */
    urls: ResolvedServerUrls
    /** 用户监听 host 配置，本行查询条件。 */
    host: CommonServerOptions['host']
    /** 按 host 选择的单个 URL，未命中时可为 undefined。 */
    expected: string | undefined
  }>

  for (const { name, urls, host, expected } of cases) {
    /** 按 host 表用 local/network URL 查询：缺省、true、0.0.0.0、::1 应选本地地址，显式 foo.example.com 选对应网络 URL。 */
    test(name, () => {
      const actual = getServerUrlByHost(urls, host)
      expect(actual).toBe(expected)
    })
  }
})

describe('extractHostnamesFromCerts', () => {
  /** 从一张 PEM 证书提取 hostname；输出应包含两个具体 DNS 名与通配 DNS 替换结果。 */
  test('should extract hostnames from certificate', () => {
    const certs = [WORKING_TEST_CERT]
    const result = extractHostnamesFromCerts(certs)
    expect(result).toStrictEqual([
      'localhost',
      'foo.localhost',
      'vite.vite.localhost',
    ])
  })

  /** 传入两张相同证书；提取结果应去重并保留第一次出现的 hostname 顺序。 */
  test('should extract hostnames from multiple certificates', () => {
    const certs = [WORKING_TEST_CERT, WORKING_TEST_CERT]
    const result = extractHostnamesFromCerts(certs)
    expect(result).toStrictEqual([
      'localhost',
      'foo.localhost',
      'vite.vite.localhost',
    ])
  })
})

describe('resolveServerUrls', () => {
  /** 模拟 server.address() 返回固定端口与指定地址/协议族，供 URL 分类断言。 */
  const createMockServer = (
    family: 'IPv4' | 'IPv6' = 'IPv4',
    address: string = '127.0.0.1',
  ) =>
    ({
      /** 提供端口 3000 和本行监听地址，避免真实 socket 绑定。 */
      address: () => ({ port: 3000, address, family }),
    }) as any

  /** 提供 HTTPS、localhost 展示名和根 base 的共同配置，单例只替换证书或地址。 */
  const createTestConfig = () => ({
    options: { https: true } as any,
    hostname: { host: '127.0.0.1', name: 'localhost' } as any,
    config: { rawBase: '/' } as any,
  })

  /** HTTPS 监听但没有证书内容；解析 URL 应仍包含 localhost:3000 的 HTTPS 地址。 */
  test('should handle no certificate', () => {
    const mockServer = createMockServer()
    const { options, hostname, config } = createTestConfig()
    const httpsOptions = {}

    const result = resolveServerUrls(
      mockServer,
      options,
      hostname,
      httpsOptions,
      config,
    )

    expect(result.local).toContain('https://localhost:3000/')
  })

  /** IPv4 回环监听配一张证书；解析本地 URL 应包含 localhost、foo.localhost 和通配替换后的 vite.vite.localhost。 */
  test('should handle IPv4 single certificate', () => {
    const mockServer = createMockServer()
    const { options, hostname, config } = createTestConfig()
    const httpsOptions = { cert: [WORKING_TEST_CERT] }

    const result = resolveServerUrls(
      mockServer,
      options,
      hostname,
      httpsOptions,
      config,
    )

    expect(result.local).toContain('https://localhost:3000/')
    expect(result.local).toContain('https://foo.localhost:3000/')
    expect(result.local).toContain('https://vite.vite.localhost:3000/')
  })

  /** IPv4 回环监听配两张相同证书；本地 URL 仍应包含三种证书 hostname，本例使用包含断言而非数量断言。 */
  test('should handle IPv4 multiple certificates', () => {
    const mockServer = createMockServer()
    const { options, hostname, config } = createTestConfig()
    const httpsOptions = { cert: [WORKING_TEST_CERT, WORKING_TEST_CERT] }

    const result = resolveServerUrls(
      mockServer,
      options,
      hostname,
      httpsOptions,
      config,
    )

    expect(result.local).toContain('https://localhost:3000/')
    expect(result.local).toContain('https://foo.localhost:3000/')
    expect(result.local).toContain('https://vite.vite.localhost:3000/')
  })

  /** IPv6 ::1 回环监听配一张证书；本地 URL 应包含三种 HTTPS hostname。 */
  test('should handle IPv6 single certificate', () => {
    const mockServer = createMockServer('IPv6', '::1')
    const { options, hostname, config } = createTestConfig()
    const httpsOptions = { cert: [WORKING_TEST_CERT] }

    const result = resolveServerUrls(
      mockServer,
      options,
      hostname,
      httpsOptions,
      config,
    )

    expect(result.local).toContain('https://localhost:3000/')
    expect(result.local).toContain('https://foo.localhost:3000/')
    expect(result.local).toContain('https://vite.vite.localhost:3000/')
  })

  /** IPv6 ::1 监听配两张相同证书；本地 URL 应继续包含三种证书 hostname。 */
  test('should handle IPv6 multiple certificates', () => {
    const mockServer = createMockServer('IPv6', '::1')
    const { options, hostname, config } = createTestConfig()
    const httpsOptions = { cert: [WORKING_TEST_CERT, WORKING_TEST_CERT] }

    const result = resolveServerUrls(
      mockServer,
      options,
      hostname,
      httpsOptions,
      config,
    )

    expect(result.local).toContain('https://localhost:3000/')
    expect(result.local).toContain('https://foo.localhost:3000/')
    expect(result.local).toContain('https://vite.vite.localhost:3000/')
  })

  /** 证书字符串无效；解析 URL 应忽略证书提取失败，仍提供 localhost 的 HTTPS 地址。 */
  test('should handle invalid certificate', () => {
    const mockServer = createMockServer()
    const { options, hostname, config } = createTestConfig()
    const httpsOptions = { cert: ['invalid-cert'] }

    const result = resolveServerUrls(
      mockServer,
      options,
      hostname,
      httpsOptions,
      config,
    )

    expect(result.local).toContain('https://localhost:3000/')
  })

  /** 全接口监听并 mock 回环、eth0、wlan0 三种接口；核对两个 network URL 与同索引接口名，回环地址归入 local。 */
  test('captures interface names aligned with the network URLs', () => {
    const mockServer = createMockServer('IPv4', '0.0.0.0')
    const networkInterfacesSpy = vi
      .spyOn(os, 'networkInterfaces')
      .mockReturnValue({
        lo: [
          { address: '127.0.0.1', family: 'IPv4' } as NetworkInterfaceInfoIPv4,
        ],
        eth0: [
          {
            address: '192.168.1.10',
            family: 'IPv4',
          } as NetworkInterfaceInfoIPv4,
        ],
        wlan0: [
          { address: '10.0.0.5', family: 'IPv4' } as NetworkInterfaceInfoIPv4,
        ],
      })
    onTestFinished(() => {
      networkInterfacesSpy.mockRestore()
    })

    const result = resolveServerUrls(
      mockServer,
      { https: false } as any,
      { host: undefined, name: 'localhost' } as any,
      {},
      { rawBase: '/' } as any,
    )

    expect(result.network).toEqual([
      'http://192.168.1.10:3000/',
      'http://10.0.0.5:3000/',
    ])
    expect(result.networkInterfaceNames).toStrictEqual(['eth0', 'wlan0'])
    expect(result.networkInterfaceNames).toHaveLength(result.network.length)
    // 回环接口进入 local，因此 network 与 networkInterfaceNames 只对应 eth0/wlan0。
    expect(result.local).toContain('http://localhost:3000/')
  })

  /** 全接口监听且 host 是显式域名；只返回该 network URL，接口名占位应为 undefined。 */
  test('uses an undefined interface name for an explicit network host', () => {
    const mockServer = createMockServer('IPv4', '0.0.0.0')

    const result = resolveServerUrls(
      mockServer,
      { https: false } as any,
      { host: 'example.com', name: 'example.com' } as any,
      {},
      { rawBase: '/' } as any,
    )

    expect(result.network).toStrictEqual(['http://example.com:3000/'])
    expect(result.networkInterfaceNames).toStrictEqual([undefined])
  })

  /** 显式 host IP 命中 mock eth0 地址；network URL 应对应此 IP，接口名应为 eth0。 */
  test('resolves interface name for an explicit host IP that matches a network interface', () => {
    const mockServer = createMockServer('IPv4', '0.0.0.0')
    const networkInterfacesSpy = vi
      .spyOn(os, 'networkInterfaces')
      .mockReturnValue({
        lo: [
          { address: '127.0.0.1', family: 'IPv4' } as NetworkInterfaceInfoIPv4,
        ],
        eth0: [
          {
            address: '192.168.1.10',
            family: 'IPv4',
          } as NetworkInterfaceInfoIPv4,
        ],
      })
    onTestFinished(() => {
      networkInterfacesSpy.mockRestore()
    })

    const result = resolveServerUrls(
      mockServer,
      { https: false } as any,
      { host: '192.168.1.10', name: '192.168.1.10' } as any,
      {},
      { rawBase: '/' } as any,
    )

    expect(result.network).toStrictEqual(['http://192.168.1.10:3000/'])
    expect(result.networkInterfaceNames).toStrictEqual(['eth0'])
  })

  /** 显式 host IP 未命中 mock 的接口地址；仍返回该 IP URL，但接口名应为 undefined。 */
  test('uses undefined interface name when explicit host IP does not match any interface', () => {
    const mockServer = createMockServer('IPv4', '0.0.0.0')
    const networkInterfacesSpy = vi
      .spyOn(os, 'networkInterfaces')
      .mockReturnValue({
        lo: [
          { address: '127.0.0.1', family: 'IPv4' } as NetworkInterfaceInfoIPv4,
        ],
        eth0: [
          {
            address: '192.168.1.10',
            family: 'IPv4',
          } as NetworkInterfaceInfoIPv4,
        ],
      })
    onTestFinished(() => {
      networkInterfacesSpy.mockRestore()
    })

    const result = resolveServerUrls(
      mockServer,
      { https: false } as any,
      { host: '10.0.0.5', name: '10.0.0.5' } as any,
      {},
      { rawBase: '/' } as any,
    )

    expect(result.network).toStrictEqual(['http://10.0.0.5:3000/'])
    expect(result.networkInterfaceNames).toStrictEqual([undefined])
  })
})
