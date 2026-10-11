/* eslint-disable promise/param-names */
import { commonStartEffect, releaseAllEffect, ports, setAppName } from '../common/initial'
import { appInstanceMap } from '../../create_app'
import microApp from '../..'

/** 自定义 onclick 写入回调，供配置 Map 覆盖 with proxyDocument 的内置 setter。 */
const customDocumentOnClick = () => { console.log('会影响 microApp 内置对 onclick 的处理') }

/**
 * 自定义文档写入处理器的历史用例，当前 jest.config.js 未将本文件列入 testMatch。
 * rc.32 仅在 with proxyDocument 的 set 陷阱读取配置；这里正文操作宿主 document，setAppName 只影响 DOM 归属。
 */
describe('sandbox custom proxy document property', () => {
  let appCon: Element
  /**
   * 启动资源服务并登记 title 空写入器、onclick 日志写入器；这些配置在 with 文档代理创建时合并。
   * #app-container 用于挂载 common fixture，各场景正文仍使用宿主 document，不能以 setAppName 替代代理。
   */
  beforeAll(() => {
    commonStartEffect(ports.custom_proxy_document)
    
    microApp.start({
      customProxyDocumentProps: new Map<string | number | symbol, () => void>([
        ['title', () => {}], // 接到 proxyDocument.title 的写入时忽略该值；不拦截宿主 document。
        ['onclick', customDocumentOnClick]
      ]),
    })
    appCon = document.querySelector('#app-container')!
  })

  afterAll(() => {
    return releaseAllEffect()
  })

  /**
   * common fixture 挂载后保存宿主标题，设置当前 DOM 归属，再把宿主 document.title 改成 new title。
   * 旧断言期待标题不变，以验证配置中的空写入器；但该赋值没有进入 proxyDocument，不能满足这个目标。
   * 对应接管入口是 WithSandBox.proxyWindow.document 的 set 陷阱，不是宿主 document.title。
   */
  test('custom proxy document.title', async () => {
    const microAppElement1 = document.createElement('micro-app')
    microAppElement1.setAttribute('name', 'test-app1')
    microAppElement1.setAttribute('url', `http://127.0.0.1:${ports.custom_proxy_document}/common/`)

    appCon.appendChild(microAppElement1)

    await new Promise((resolve) => {
      microAppElement1.addEventListener('mounted', () => {
        setAppName('test-app1')
        // 读取当前标题。
        const originTitle = document.title

        // 尝试修改标题。
        document.title = 'new title'

        // 这是旧用例期待的结果；上述宿主赋值路径在当前实现中不会被自定义回调忽略。
        expect(document.title).toBe(originTitle)
        resolve(true)
      })
    })
  })

  /**
   * 第二个 common 元素挂载后，先断言实例数为一，再将宿主 onclick 设为 Jest 回调并读取它。
   * 旧断言期望读取值为配置中的日志回调，预定验证定制接管；当前配置只接管写入副作用，proxyDocument 的 getter 仍读
   * onClickHandler 槽位，宿主 document 则保持原生属性；两者都不自动把配置回调作为读取结果。
   */
  test('custom proxy document.onclick will working', async () => {

    const microAppElement2 = document.createElement('micro-app')
    microAppElement2.setAttribute('name', 'test-app2')
    microAppElement2.setAttribute('url', `http://127.0.0.1:${ports.custom_proxy_document}/common/`)

    appCon.appendChild(microAppElement2)

    await new Promise((resolve) => {
      microAppElement2.addEventListener('mounted', () => {
        expect(appInstanceMap.size).toBe(1)
        // 这里的接收者是宿主 document；原生属性保存 baseDomOnclick，而非配置 Map 中的写入器。
        const baseDomOnclick = jest.fn()
        document.onclick = baseDomOnclick
        expect(document.onclick).toBe(customDocumentOnClick)

        resolve(true)
      }, false)
    })
  })

})
