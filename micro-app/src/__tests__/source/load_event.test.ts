/* eslint-disable promise/param-names */
import { commonStartEffect, releaseAllEffect, ports, setAppName } from '../common/initial'
import microApp from '../..'

/** 当前默认 Jest testMatch 未纳入本文件，需显式选择才会发现这些场景。 */
describe('source load_event', () => {
  let appCon: Element
  beforeAll(() => {
    commonStartEffect(ports.load_event)
    microApp.start()
    appCon = document.querySelector('#app-container')!
  })

  afterAll(() => {
    return releaseAllEffect()
  })

  /**
   * 在 dynamic 应用作用域中插入两个不存在的 stylesheet，
   * 分别使用 onerror 属性和 addEventListener(error)。失败通知应优先走属性回调，否则派 DOM 事件；
   * 监听器分支核对 currentTarget/srcElement/target 为原 link。
   * mounted 内即 resolve，错误回调未纳入 Promise 完成边界。
   */
  test('dispatchOnErrorEvent should support two ways', async () => {
    const microAppElement1 = document.createElement('micro-app')
    microAppElement1.setAttribute('name', 'test-app1')
    microAppElement1.setAttribute('url', `http://127.0.0.1:${ports.load_event}/dynamic/`)

    appCon.appendChild(microAppElement1)
    await new Promise((resolve) => {
      microAppElement1.addEventListener('mounted', () => {
        setAppName('test-app1')
        // 动态创建link
        const dynamicLink1 = document.createElement('link')
        dynamicLink1.setAttribute('rel', 'stylesheet')
        dynamicLink1.setAttribute('href', 'http://www.micro-app-test.com/not-exist.css')
        document.head.appendChild(dynamicLink1)
        /** 检查属性式错误回调收到通知；与另一节点的 DOM error 监听分支对照。 */
        dynamicLink1.onerror = function () {
          expect(console.error).toBeCalledWith('[micro-app] app test-app1:', expect.any(Error))
        }

        // event 监听
        const dynamicLink2 = document.createElement('link')
        dynamicLink2.setAttribute('rel', 'stylesheet')
        dynamicLink2.setAttribute('href', 'http://www.micro-app-test.com/not-exist.css')
        document.head.appendChild(dynamicLink2)
        dynamicLink2.addEventListener('error', (event) => {
          expect(event.currentTarget).toBe(dynamicLink2)
          expect(event.srcElement).toBe(dynamicLink2)
          expect(event.target).toBe(dynamicLink2)
        })
        resolve(true)
      }, false)
    })
  })

  /**
   * 插入两个能下载的同地址 stylesheet，分别绑定 onload mock 与 load 监听器。样式填充后应通知原 link，
   * 监听器核对三个目标字段；onload mock 未单独断言，mounted 内提前 resolve，
   * 不能把本例结束视为两个 load 已完成。
   */
  test('dispatchOnLoadEvent should support two ways', async () => {
    const microAppElement2 = document.createElement('micro-app')
    microAppElement2.setAttribute('name', 'test-app2')
    microAppElement2.setAttribute('url', `http://127.0.0.1:${ports.load_event}/dynamic/`)

    appCon.appendChild(microAppElement2)
    await new Promise((resolve) => {
      microAppElement2.addEventListener('mounted', () => {
        setAppName('test-app2')
        // 动态创建link
        const dynamicLink1 = document.createElement('link')
        dynamicLink1.setAttribute('rel', 'stylesheet')
        dynamicLink1.setAttribute('href', './link1.css')
        document.head.appendChild(dynamicLink1)
        // onload 监听
        dynamicLink1.onload = jest.fn()

        // event 监听
        const dynamicLink2 = document.createElement('link')
        dynamicLink2.setAttribute('rel', 'stylesheet')
        dynamicLink2.setAttribute('href', './link1.css')
        document.head.appendChild(dynamicLink2)
        dynamicLink2.addEventListener('load', (event) => {
          expect(event.currentTarget).toBe(dynamicLink2)
          expect(event.srcElement).toBe(dynamicLink2)
          expect(event.target).toBe(dynamicLink2)
        })
        resolve(true)
      }, false)
    })
  })
})
