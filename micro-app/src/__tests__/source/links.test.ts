/* eslint-disable promise/param-names */
import { commonStartEffect, releaseAllEffect, ports, setAppName } from '../common/initial'
import { appInstanceMap } from '../../create_app'
// 本文件保留旧资源接口：rc.32 已改为 sourceCenter.link 与 app.source.links Set，不再导出 globalLinks。
import { globalLinks, fetchLinkSuccess } from '../../source/links'
import microApp from '../..'

/** 当前默认 Jest testMatch 未纳入本文件，需显式选择才会发现这些场景。 */
describe('source links', () => {
  let appCon: Element
  beforeAll(() => {
    commonStartEffect(ports.source_links)
    microApp.start({
      // 自定义fetch
      /** 使用原生 fetch 并返回文本，覆盖框架自定义资源获取器。 */
      fetch (url: string, options: Record<string, unknown>) {
        return fetch(url, options).then((res) => {
          return res.text()
        })
      }
    })
    appCon = document.querySelector('#app-container')!
  })

  afterAll(() => {
    return releaseAllEffect()
  })

  /**
   * 先挂载无资源的 dynamic 入口，再标记应用作用域并插入指向不存在 CSS 的 stylesheet link。
   * 请求失败应记录应用上下文错误并通知原 link.onerror；本例在 mounted 回调末尾即 resolve，
   * 没有等待 onerror 断言完成。
   */
  test('append a link with error href', async () => {
    const microAppElement1 = document.createElement('micro-app')
    microAppElement1.setAttribute('name', 'test-app1')
    microAppElement1.setAttribute('url', `http://127.0.0.1:${ports.source_links}/dynamic/`)

    appCon.appendChild(microAppElement1)
    await new Promise((resolve) => {
      microAppElement1.addEventListener('mounted', () => {
        setAppName('test-app1')
        // 动态创建link
        const dynamicLink = document.createElement('link')
        dynamicLink.setAttribute('rel', 'stylesheet')
        dynamicLink.setAttribute('href', 'http://www.micro-app-test.com/not-exist.css')
        document.head.appendChild(dynamicLink)
        /** 在下载拒绝通知原 link 时检查日志；外层测试已在 mounted 内结束等待。 */
        dynamicLink.onerror = function () {
          expect(console.error).toBeCalledWith('[micro-app] app test-app1:', expect.any(Error))
        }
        resolve(true)
      }, false)
    })
  })

  /**
   * 挂载 dynamic 后插入带 id 的 preload link。节点应被注释替代，document 查询不到原 id，
   * 验证动态 link 的非样式预加载关系过滤分支。
   */
  test('append an unusual link', async () => {
    const microAppElement2 = document.createElement('micro-app')
    microAppElement2.setAttribute('name', 'test-app2')
    microAppElement2.setAttribute('url', `http://127.0.0.1:${ports.source_links}/dynamic/`)

    appCon.appendChild(microAppElement2)
    await new Promise((resolve) => {
      microAppElement2.addEventListener('mounted', () => {
        setAppName('test-app2')
        // 动态创建link
        const dynamicLink = document.createElement('link')
        dynamicLink.setAttribute('rel', 'preload')
        dynamicLink.setAttribute('href', './manifest.js')
        dynamicLink.setAttribute('id', 'dynamic-link-preload')
        document.head.appendChild(dynamicLink)

        expect(document.getElementById('dynamic-link-preload')).toBeNull()
        resolve(true)
      }, false)
    })
  })

  /**
   * 挂载 notexist-css HTML，输入的静态外链请求拒绝。资源链仍应结算并到 mounted，回调只断言曾有错误日志，
   * 验证单个 CSS 下载失败不阻断两路加载汇合。
   */
  test('load css error in html', async () => {
    const microAppElement3 = document.createElement('micro-app')
    microAppElement3.setAttribute('name', 'test-app3')
    microAppElement3.setAttribute('url', `http://127.0.0.1:${ports.source_links}/special-html/notexist-css.html`)

    appCon.appendChild(microAppElement3)
    await new Promise((resolve) => {
      microAppElement3.addEventListener('mounted', () => {
        expect(console.error).toBeCalled()
        resolve(true)
      }, false)
    })
  }, 10000)

  /**
   * 先挂载 element-config，再由另一应用动态插入同一 link1.css 两次，
   * 目标是复用共享原始 CSS 与应用 parsedCode。当前动态缓存命中仍在微任务填充；
   * 正文使用的 globalLinks.size 和 app.source.links.get 是旧 Map 接口，
   * 不能作为 rc.32 Set/sourceCenter 的可执行验证。
   */
  test('get css code from cache', async () => {
    const microAppElement4 = document.createElement('micro-app')
    microAppElement4.setAttribute('name', 'test-app4')
    microAppElement4.setAttribute('url', `http://127.0.0.1:${ports.source_links}/element-config`)

    appCon.appendChild(microAppElement4)
    await new Promise((resolve) => {
      microAppElement4.addEventListener('mounted', () => {
        expect(globalLinks.size).toBe(1)
        resolve(true)
      }, false)
    })

    const microAppElement5 = document.createElement('micro-app')
    microAppElement5.setAttribute('name', 'test-app5')
    microAppElement5.setAttribute('url', `http://127.0.0.1:${ports.source_links}/dynamic`)

    appCon.appendChild(microAppElement5)
    await new Promise((resolve) => {
      microAppElement5.addEventListener('mounted', () => {
        setAppName('test-app5')

        // 从全局缓存中获取css文件内容
        const dynamicLink = document.createElement('link')
        dynamicLink.setAttribute('rel', 'stylesheet')
        dynamicLink.setAttribute('href', '/element-config/link1.css')
        document.head.appendChild(dynamicLink)
        // 旧接口读取应用 Map；rc.32 应从 sourceCenter.link.getInfo(address) 读取共享 code。
        const app = appInstanceMap.get('test-app5')!
        expect(app.source.links.get(`http://127.0.0.1:${ports.source_links}/element-config/link1.css`)?.code?.length).toBeGreaterThan(1)

        // 再次插入同地址：rc.32 复用 sourceCenter 中的 code 与该应用的 appSpace，填充仍在微任务中执行。
        const dynamicLink2 = document.createElement('link')
        dynamicLink2.setAttribute('rel', 'stylesheet')
        dynamicLink2.setAttribute('href', '/element-config/link1.css')
        document.head.appendChild(dynamicLink2)

        resolve(true)
      }, false)
    })
  })

  /**
   * 先加载 common 与 element-config，
   * 再在 dynamic 应用插入带 global 的 stylesheet、无 href 的 prefetch 和无 href 的
   * modulepreload。调用应触达共享代码与关系过滤路径；global 不控制当前缓存，
   * 且 modulepreload 的 href 实际误写到第一个 link，本例没有资源结果断言。
   */
  test('coverage of static html global & dynamic global css', async () => {
    const microAppElement6 = document.createElement('micro-app')
    microAppElement6.setAttribute('name', 'test-app6')
    microAppElement6.setAttribute('url', `http://127.0.0.1:${ports.source_links}/common`)

    appCon.appendChild(microAppElement6)
    await new Promise((resolve) => {
      microAppElement6.addEventListener('mounted', () => {
        resolve(true)
      }, false)
    })

    const microAppElement7 = document.createElement('micro-app')
    microAppElement7.setAttribute('name', 'test-app7')
    microAppElement7.setAttribute('url', `http://127.0.0.1:${ports.source_links}/element-config`)

    appCon.appendChild(microAppElement7)
    await new Promise((resolve) => {
      microAppElement7.addEventListener('mounted', () => {
        resolve(true)
      }, false)
    })

    const microAppElement8 = document.createElement('micro-app')
    microAppElement8.setAttribute('name', 'test-app8')
    microAppElement8.setAttribute('url', `http://127.0.0.1:${ports.source_links}/dynamic`)

    appCon.appendChild(microAppElement8)
    await new Promise((resolve) => {
      microAppElement8.addEventListener('mounted', () => {
        setAppName('test-app8')

        // 动态创建带 global 属性的外链；当前缓存策略只按完整地址判断。
        const dynamicLink1 = document.createElement('link')
        dynamicLink1.setAttribute('rel', 'stylesheet')
        dynamicLink1.setAttribute('href', './link1.css')
        dynamicLink1.setAttribute('global', 'true')
        document.head.appendChild(dynamicLink1)

        // 分支覆盖 -- prefetch 且 无href
        const dynamicLink2 = document.createElement('link')
        dynamicLink2.setAttribute('rel', 'prefetch')
        document.head.appendChild(dynamicLink2)

        // 分支覆盖 -- 动态的 modulepreload
        const dynamicLink3 = document.createElement('link')
        dynamicLink3.setAttribute('rel', 'modulepreload')
        dynamicLink1.setAttribute('href', './test.js')
        document.head.appendChild(dynamicLink3)

        resolve(true)
      }, false)
    })
  })

  /**
   * 构造无 parentNode 的占位注释、head 容器与关闭 CSS 隔离的应用，
   * 以旧五参形式调用 fetchLinkSuccess，原目标是验证追加 style 兜底。
   * 当前函数为四参且先读 sourceCenter，未登记地址会使 linkInfo 为空，旧调用不能到达该兜底断言。
   */
  test('empty parentNode when fetch css success', () => {
    const microAppHead = document.createElement('micro-app-head')
    const info = { placeholder: document.createComment('link comment') } as any
    const app = { scopecss: false } as any

    fetchLinkSuccess(
      'http://empty.parentNode.com/test.css',
      info,
      'css-text',
      microAppHead,
      app,
    )

    expect(microAppHead.children[0] instanceof HTMLStyleElement).toBeTruthy()
  })
})
