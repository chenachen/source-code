import { stripVTControlCharacters } from 'node:util'
import { describe, expect, test } from 'vitest'
import { printServerUrls } from '../logger'
import type { ResolvedServerUrls } from '../server'

/** 调用 printServerUrls 并去掉 ANSI 控制码，生成稳定、可快照比较的纯文本。 */
function collectServerUrls(urls: ResolvedServerUrls): string {
  const messages: string[] = []
  printServerUrls(urls, undefined, (msg) =>
    messages.push(stripVTControlCharacters(msg)),
  )
  return '\n' + messages.join('\n') + '\n'
}

/**
 * 覆盖 #22830 增加的网络接口标签：标签必须与对应 URL 对齐，同时兼容缺失值和
 * 过长名称，不能破坏原有服务器地址输出。
 */
describe('printServerUrls', () => {
  /** 场景：多个网络 URL 都有接口名；验证目标：按索引追加正确标签。 */
  test('appends the network interface name to each network URL', () => {
    const messages = collectServerUrls({
      local: ['http://localhost:5173/'],
      network: ['http://172.18.0.1:5173/', 'http://10.0.0.2:5173/'],
      networkInterfaceNames: ['eth0', 'wlan0'],
    })
    expect(messages).toMatchSnapshot()
  })

  /** 场景：URL 长度不同；验证目标：接口名从同一列开始，便于快速扫描。 */
  test('aligns interface names into a column', () => {
    const messages = collectServerUrls({
      local: [],
      network: ['http://172.18.0.1:5173/', 'http://10.0.0.2:5173/'],
      networkInterfaceNames: ['eth0', 'wlan0'],
    })
    expect(messages).toMatchSnapshot()
  })

  /** 场景：WSL 等平台产生超长接口名；验证目标：截断并以省略号提示。 */
  test('truncates an over-long interface name', () => {
    const messages = collectServerUrls({
      local: [],
      network: ['http://10.0.0.2:5173/'],
      networkInterfaceNames: ['vEthernet (WSL (Hyper-V firewall))'],
    })
    expect(messages).toMatchSnapshot()
  })

  /** 场景：某个 URL 无法反查接口；验证目标：只省略该条注解，不出现 undefined。 */
  test('omits the annotation when the interface name is unknown', () => {
    const messages = collectServerUrls({
      local: [],
      network: ['http://10.0.0.2:5173/'],
      networkInterfaceNames: [undefined],
    })
    expect(messages).toMatchSnapshot()
  })

  /** 场景：旧调用方完全不提供接口数组；验证目标：保持向后兼容输出。 */
  test('works when networkInterfaceNames is absent', () => {
    const messages = collectServerUrls({
      local: [],
      network: ['http://10.0.0.2:5173/'],
    })
    expect(messages).toMatchSnapshot()
  })

  /** 场景：用户显式绑定单个局域网地址；验证目标：单 URL 同样展示接口名。 */
  test('appends interface name for a single explicit host URL', () => {
    const messages = collectServerUrls({
      local: [],
      network: ['http://192.168.1.10:5173/'],
      networkInterfaceNames: ['eth0'],
    })
    expect(messages).toMatchSnapshot()
  })
})
