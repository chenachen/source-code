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
  /** 多个网络 URL 都有接口名时，应按索引追加对应标签。 */
  test('appends the network interface name to each network URL', () => {
    const messages = collectServerUrls({
      local: ['http://localhost:5173/'],
      network: ['http://172.18.0.1:5173/', 'http://10.0.0.2:5173/'],
      networkInterfaceNames: ['eth0', 'wlan0'],
    })
    expect(messages).toMatchSnapshot()
  })

  /** URL 长度不同时，接口名仍应从同一列开始。 */
  test('aligns interface names into a column', () => {
    const messages = collectServerUrls({
      local: [],
      network: ['http://172.18.0.1:5173/', 'http://10.0.0.2:5173/'],
      networkInterfaceNames: ['eth0', 'wlan0'],
    })
    expect(messages).toMatchSnapshot()
  })

  /** 超长接口名应截断并显示省略号。 */
  test('truncates an over-long interface name', () => {
    const messages = collectServerUrls({
      local: [],
      network: ['http://10.0.0.2:5173/'],
      networkInterfaceNames: ['vEthernet (WSL (Hyper-V firewall))'],
    })
    expect(messages).toMatchSnapshot()
  })

  /** 未提供某条接口名时，应省略该条注解，不输出 undefined。 */
  test('omits the annotation when the interface name is unknown', () => {
    const messages = collectServerUrls({
      local: [],
      network: ['http://10.0.0.2:5173/'],
      networkInterfaceNames: [undefined],
    })
    expect(messages).toMatchSnapshot()
  })

  /** 不提供接口数组时，仍应打印 URL。 */
  test('works when networkInterfaceNames is absent', () => {
    const messages = collectServerUrls({
      local: [],
      network: ['http://10.0.0.2:5173/'],
    })
    expect(messages).toMatchSnapshot()
  })

  /** 单个网络 URL 同样应展示接口名。 */
  test('appends interface name for a single explicit host URL', () => {
    const messages = collectServerUrls({
      local: [],
      network: ['http://192.168.1.10:5173/'],
      networkInterfaceNames: ['eth0'],
    })
    expect(messages).toMatchSnapshot()
  })
})
