/* eslint-disable promise/param-names */
import { commonStartEffect, releaseAllEffect, ports } from '../common/initial'
import { appInstanceMap } from '../../create_app'
import microApp from '../..'

/** 宿主 onclick 不可配置时的历史挂载场景；当前 jest.config.js 未将本文件列入 testMatch。 */
describe('sandbox effect2', () => {
  let appCon: Element
  /** 初始化宿主 onclick、资源服务和容器，再启动默认 with 沙箱；用例随后把宿主描述符锁为不可配置。 */
  beforeAll(() => {
    commonStartEffect(ports.effect2)
    appCon = document.querySelector('#app-container')!

    microApp.start()
  })

  afterAll(() => {
    return releaseAllEffect()
  })

  /**
   * 把已有宿主 onclick 定义为不可配置且值为 null，再挂载会设置 proxyDocument.onclick 的 common fixture。
   * 等待 mounted 后只断言有一个实例，验证该宿主描述符输入没有阻断挂载；没有比较 click 执行次数。
   * 正文只等待 mounted 并断言实例数；rc.32 的子应用 onclick 在 with proxyDocument 内用独立监听器实现，
   * 不需要重新定义宿主 onclick 描述符。
   */
  test('onclick can only be rewritten once', async () => {
    Object.defineProperty(document, 'onclick', {
      configurable: false,
      enumerable: true,
      value: null,
    })

    const microAppElement1 = document.createElement('micro-app')
    microAppElement1.setAttribute('name', 'test-app1')
    microAppElement1.setAttribute('url', `http://127.0.0.1:${ports.effect2}/common/`)

    appCon.appendChild(microAppElement1)

    await new Promise((resolve) => {
      microAppElement1.addEventListener('mounted', () => {
        expect(appInstanceMap.size).toBe(1)
        resolve(true)
      }, false)
    })
  })
})
