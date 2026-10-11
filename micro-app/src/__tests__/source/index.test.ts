/* eslint-disable promise/param-names */
import { commonStartEffect, releaseAllEffect, ports } from '../common/initial'
import { appInstanceMap } from '../../create_app'
import microApp from '../..'

declare global {
  /** 资源路径补全断言为通用 HTMLElement 补充 src/href 测试字段。 */
  interface HTMLElement {
    /** 资源路径测试读取的 src 字段；是否补全仍由具体静态/动态处理分支决定。 */
    src: string
    /** anchor/link 等元素补全后的资源地址。 */
    href: string
  }
}

/** 当前默认 Jest testMatch 未纳入本文件，需显式选择才会发现这些场景。 */
describe('source index', () => {
  let appCon: Element
  beforeAll(() => {
    commonStartEffect(ports.source_index)
    microApp.start({
      // globalAssets 测试分支覆盖
      globalAssets: {
        js: 'xx' as any,
        css: 'xx' as any,
      },
      plugins: {
        global: [
          {
            /** 以文件名后缀排除全局 link3/script3，使入口提取只登记其余资源。 */
            excludeChecker: (url) => ['link3.css', 'script3.js'].some(item => url.endsWith(item)),
            /** 全局 HTML 插件原样返回源码，覆盖有效插件选择分支。 */
            processHtml (code, _url, _options) {
              return code
            }
          },
          {
            processHtml: 'invalid processHtml' as any,
          }
        ],
        modules: {
          'test-app2': [
            {
              /** 为 test-app2 额外排除 link4/script4，验证应用插件在全局排除之外继续参与判断。 */
              excludeChecker: (url) => ['link4.css', 'script4.js'].some(item => url.endsWith(item))
            }
          ],
          'test-app3': [
            {
              processHtml: 'invalid loader' as any,
            }
          ],
          'test-app4': 'invalid plugin' as any,
          'test-app8': [
            {
              /** 应用级 HTML 插件在全局插件之后替换标记文本，mounted 时用替换后的 id 断言结果。 */
              processHtml (code, _url, _options) {
                return code.replace('app', 'app-replaced')
              }
            }
          ],
        }
      }
    })
    appCon = document.querySelector('#app-container')!
  })

  afterAll(() => {
    return releaseAllEffect()
  })

  /**
   * 以 disableScopecss 挂载 element-config，
   * 配置全局排除 link3/script3 和 app2 专属排除 link4/script4；
   * mounted 后核对 exclude 与插件排除节点已移除及静态地址数。CSS 应保留三个不同地址；
   * 脚本只剩 common/global.js 与 script2.js，重复地址被 Set 去重，
   * 原 size=3 断言与当前 fixture/rc.32 不符。
   */
  test('exclude dom should be ignore', async () => {
    const microAppElement2 = document.createElement('micro-app')
    microAppElement2.setAttribute('name', 'test-app2')
    microAppElement2.setAttribute('url', `http://127.0.0.1:${ports.source_index}/element-config/`)
    microAppElement2.setAttribute('disableScopecss', 'true')

    await new Promise((resolve) => {
      microAppElement2.addEventListener('mounted', () => {
        expect(document.getElementById('app4-style-exclude')).toBeNull()
        expect(document.getElementById('app4-link-exclude')).toBeNull()
        expect(document.getElementById('app4-script-exclude')).toBeNull()
        expect(document.getElementById('app4-link-include')).toBeNull()
        expect(document.getElementById('app4-global-plugin-link-exclude')).toBeNull()
        expect(document.getElementById('app4-module-plugin-link-exclude')).toBeNull()
        expect(document.getElementById('app4-global-plugin-script-exclude')).toBeNull()
        expect(document.getElementById('app4-module-plugin-script-exclude')).toBeNull()

        const app = appInstanceMap.get('test-app2')!
        expect(app.source.links.size).toBe(3)
        expect(app.source.scripts.size).toBe(3)
        resolve(true)
      }, false)

      appCon.appendChild(microAppElement2)
    })
  })

  /**
   * 把 element-config/index.txt 当入口挂载，等待 mounted 后查询静态资源集合。
   * 文本仍按 HTML 解析，exclude 脚本与样式被移除，仅保留一个有效外链 CSS，脚本集合为空；
   * 验证加载器不要求入口必须带 .html。
   */
  test('support text file as index', async () => {
    const microAppElement3 = document.createElement('micro-app')
    microAppElement3.setAttribute('name', 'test-app3')
    microAppElement3.setAttribute('url', `http://127.0.0.1:${ports.source_index}/element-config/index.txt`)
    await new Promise((resolve) => {
      microAppElement3.addEventListener('mounted', () => {
        const app = appInstanceMap.get('test-app3')!
        expect(app.source.links.size).toBe(1)
        expect(app.source.scripts.size).toBe(0)
        resolve(true)
      }, false)

      appCon.appendChild(microAppElement3)
    })
  })

  /**
   * 分别挂载缺 head 与缺 body 的原始 HTML，先插入元素再绑定 error，各等待 200ms。
   * 应记录明确的缺容器日志并派发宿主 error，验证格式化后的 micro-app-head/body 是提取阶段必需的结构。
   */
  test('no head or no body element in html', async () => {
    const microAppElement4 = document.createElement('micro-app')
    microAppElement4.setAttribute('name', 'test-app4')
    microAppElement4.setAttribute('url', `http://127.0.0.1:${ports.source_index}/special-html/nohead.html`)

    appCon.appendChild(microAppElement4)
    const noHeadErrorHandle = jest.fn()
    microAppElement4.addEventListener('error', noHeadErrorHandle)

    await new Promise((resolve) => {
      setTimeout(() => {
        resolve(true)
      }, 200)
    })

    expect(console.error).toBeCalledWith('[micro-app] app test-app4: element head is missing')
    expect(noHeadErrorHandle).toBeCalledWith(expect.any(CustomEvent))

    const microAppElement5 = document.createElement('micro-app')
    microAppElement5.setAttribute('name', 'test-app5')
    microAppElement5.setAttribute('url', `http://127.0.0.1:${ports.source_index}/special-html/nobody.html`)

    appCon.appendChild(microAppElement5)
    const nobodyErrorHandle = jest.fn()
    microAppElement5.addEventListener('error', nobodyErrorHandle)

    await new Promise((resolve) => {
      setTimeout(() => {
        resolve(true)
      }, 200)
    })

    expect(console.error).toHaveBeenLastCalledWith('[micro-app] app test-app5: element body is missing')
    expect(nobodyErrorHandle).toBeCalledWith(expect.any(CustomEvent))
  })

  /**
   * 挂载含 img、iframe、a 的 ssr-render HTML，等待 mounted 后读原始属性。
   * 静态 img.src 应补为子应用 origin 的绝对地址，iframe.src 与 a.href 保持原输入；
   * 验证静态提取的补址标签范围，与动态节点补址不同。
   */
  test('completion path of img/iframe/a in html', async () => {
    const microAppElement6 = document.createElement('micro-app')
    microAppElement6.setAttribute('name', 'test-app6')
    microAppElement6.setAttribute('url', `http://127.0.0.1:${ports.source_index}/ssr-render/`)

    appCon.appendChild(microAppElement6)

    await new Promise((resolve) => {
      microAppElement6.addEventListener('mounted', () => {
        expect(document.getElementById('app2-img1')?.getAttribute('src')).toBe(`http://127.0.0.1:${ports.source_index}/path-a/img.jpg`)
        expect(document.getElementById('app2-iframe1')?.getAttribute('src')).toBe('/path-b/')
        expect(document.getElementById('app2-a1')?.getAttribute('href')).toBe('/abc/')
        resolve(true)
      }, false)
    })
  })

  /**
   * 用字节为空的 empty.html 挂载应用，等待 100ms 后观察最后一条日志。应报告 html is empty，
   * 验证加载器的空响应分支；本例未断言 error 事件或最终应用状态。
   */
  test('test empty html', async () => {
    const microAppElement7 = document.createElement('micro-app')
    microAppElement7.setAttribute('name', 'test-app7')
    microAppElement7.setAttribute('url', `http://127.0.0.1:${ports.source_index}/special-html/empty.html`)

    appCon.appendChild(microAppElement7)

    await new Promise((resolve) => {
      setTimeout(() => {
        expect(console.error).toHaveBeenLastCalledWith('[micro-app] app test-app7: html is empty, please check in detail')
        resolve(true)
      }, 100)
    })
  })

  /**
   * 给 app8 配置应用级 processHtml，把输入中的 app 替换为 app-replaced，
   * 再挂载 process-html fixture。mounted 后应能查到替换后的 id，验证全局原样插件之后运行应用插件，
   * 且插件输出进入 DOM 提取。
   */
  test('executor processHtml plugin', async () => {
    const microAppElement8 = document.createElement('micro-app')
    microAppElement8.setAttribute('name', 'test-app8')
    microAppElement8.setAttribute('url', `http://127.0.0.1:${ports.source_index}/special-html/process-html.html`)

    appCon.appendChild(microAppElement8)
    await new Promise((resolve) => {
      microAppElement8.addEventListener('mounted', () => {
        expect(document.getElementById('app-replaced')).toBeTruthy()
        resolve(true)
      }, false)

      appCon.appendChild(microAppElement8)
    })
  })
})
