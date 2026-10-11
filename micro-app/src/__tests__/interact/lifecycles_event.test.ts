/* eslint-disable promise/param-names */
import { commonStartEffect, releaseAllEffect, ports } from '../common/initial'
import microApp from '../..'

/** 当前默认 Jest testMatch 未纳入本文件，需显式选择才会发现这些场景。 */
describe('lifecycles_event', () => {
  let appCon: Element
  beforeAll(() => {
    commonStartEffect(ports.lifecycles_event)
    appCon = document.querySelector('#app-container')!

    microApp.start()
  })

  afterAll(() => {
    return releaseAllEffect()
  })

  /**
   * 挂载 common HTML fixture，等待宿主的 mounted 事件，
   * 在事件回调中核对 target/currentTarget 都是该 micro-app 元素。
   * 验证生命周期 DOM 事件的真实派发目标；不单独观察子应用 window 的自定义事件。
   */
  test('render common app', async () => {
    const microAppElement = document.createElement('micro-app')
    microAppElement.setAttribute('name', 'test-app')
    microAppElement.setAttribute('url', `http://127.0.0.1:${ports.lifecycles_event}/common/`)

    appCon.appendChild(microAppElement)

    await new Promise((resolve) => {
      microAppElement.addEventListener('mounted', (e) => {
        expect(e.currentTarget).toBe(microAppElement)
        expect(e.target).toBe(microAppElement)
        resolve(true)
      }, false)
    })
  })
})
