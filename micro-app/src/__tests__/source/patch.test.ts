/* eslint-disable promise/param-names, no-extend-native */
import { commonStartEffect, releaseAllEffect, ports, setAppName, clearAppName } from '../common/initial'
import { appInstanceMap } from '../../create_app'
import microApp from '../..'

describe('source patch', () => {
  let appCon: Element
  beforeAll(() => {
    commonStartEffect(ports.source_patch)
    microApp.start({
      plugins: {
        global: [
          {
            excludeChecker: (url) => ['link7.css', 'script9.js'].some(item => url.endsWith(item))
          }
        ],
        modules: {
          'test-app1': [
            {
              excludeChecker: (url) => ['link8.css', 'script10.js'].some(item => url.endsWith(item))
            }
          ]
        }
      }
    })
    appCon = document.querySelector('#app-container')!
  })

  afterAll(() => {
    return releaseAllEffect()
  })

  // 子应用中操作元素的行为需要被拦截和处理
  test('element query', async () => {
    const microAppElement1 = document.createElement('micro-app')
    microAppElement1.setAttribute('name', 'test-app1')
    microAppElement1.setAttribute('url', `http://127.0.0.1:${ports.source_patch}/ssr-render/`)

    appCon.appendChild(microAppElement1)
    await new Promise((resolve) => {
      microAppElement1.addEventListener('mounted', () => {
        const app1 = appInstanceMap.get('test-app1')!
        const saveContainer = app1.container!
        const microAppBody = app1.container!.querySelector('micro-app-body')!
        const microAppHead = app1.container!.querySelector('micro-app-head')!
        // 验证 getElementsByName 的子应用作用域补丁。
        setAppName('test-app1')
        // 子应用环境中的 getElementsByName 只查询当前容器。
        expect(document.getElementsByName('ssr-html-name')[0] instanceof HTMLDivElement).toBeTruthy()
        // 覆盖包含特殊字符的 name 查询。
        expect(document.getElementsByName('1-name')[0]).toBeUndefined()
        clearAppName()
        // 基座 document.getElementsByName 不受子应用作用域限制。
        expect(document.getElementsByName('base-app-name')[0]).toBeUndefined()

        // 验证 getElementsByClassName 的子应用作用域补丁。
        setAppName('test-app1')
        // 子应用环境中的 getElementsByClassName 只查询当前容器。
        expect(document.getElementsByClassName('ssr-html-class')[0] instanceof HTMLDivElement).toBeTruthy()
        // 覆盖包含特殊字符的 class 查询。
        expect(document.getElementsByClassName('1-class')[0]).toBeUndefined()
        clearAppName()
        // 基座 document.getElementsByClassName 不受子应用作用域限制。
        expect(document.getElementsByClassName('base-app-class')[0]).toBeUndefined()

        // 验证 getElementById 的子应用作用域补丁。
        setAppName('test-app1')
        // 子应用环境中的 getElementById 只查询当前容器。
        expect(document.getElementById('ssr-html-id') instanceof HTMLDivElement).toBeTruthy()
        // 覆盖包含特殊字符的 id 查询。
        expect(document.getElementById('1-id')).toBeNull()
        clearAppName()
        // 基座 document.getElementById 不受子应用作用域限制。
        expect(document.getElementById('base-app-id')).toBeNull()

        // 验证 getElementsByTagName 的标签映射与作用域补丁。
        setAppName('test-app1')
        // 子应用环境中的 getElementsByTagName 按隔离容器映射标签。
        expect(document.getElementsByTagName('ssr-html-tag')[0]).not.toBeUndefined()
        // 覆盖特殊 tag-name 查询。
        expect(document.getElementsByTagName('body')[0]).toBe(document.body)
        expect(document.getElementsByTagName('head')[0]).toBe(document.head)
        // 覆盖 script 标签的查询分支。
        expect(document.getElementsByTagName('script')[0]).not.toBeUndefined()
        app1.inline = true
        expect(document.getElementsByTagName('script')[0]).toBeUndefined()
        app1.inline = false
        setAppName('not-exist')
        expect(document.getElementsByTagName('script')[0]).not.toBeUndefined()

        clearAppName()
        // 基座 document.getElementsByTagName 不受子应用作用域限制。
        expect(document.getElementsByTagName('base-app-tag')[0]).toBeUndefined()

        // 验证 querySelector/querySelectorAll 在基座与子应用间切换查询根。
        setAppName('test-app1')
        expect(document.head.querySelector('#base-app-style')).toBeNull()
        expect(document.head.querySelectorAll('style').length).toBe(3)
        expect(document.body.querySelector('#app-container')).toBeNull()
        expect(document.body.querySelectorAll('[id=root]').length).toBe(1)
        clearAppName()
        expect(document.head.querySelector('#base-app-style')).not.toBeNull()
        expect(document.head.querySelectorAll('style')[0].id).toBe('base-app-style')
        expect(document.body.querySelector('#app-container')).not.toBeNull()
        expect(document.body.querySelectorAll('[id=root]').length).toBe(2)
        setAppName('not-exist')
        expect(document.querySelectorAll('div').length).toBe(0)
        expect(document.querySelector('div')).toBeNull()
        // 验证 createElementNS 为新节点记录当前应用名。
        setAppName('test-app1')
        const microSvg = document.createElementNS('http://www.w3.org/1999/xhtml', 'svg')
        expect(microSvg.__MICRO_APP_NAME__).toBe('test-app1')
        document.body.appendChild(microSvg)

        // 验证 removeChild 对映射节点、已卸载应用和非法参数的兜底。
        setAppName('test-app1')
        expect(document.body.removeChild(microSvg)).toBe(microSvg)
        // 模拟app被卸载
        document.body.appendChild(microSvg)
        app1.container = null
        try {
          // 应用卸载之后使用原生方法，microSvg不属于body，所以报错
          document.body.removeChild(microSvg)
        } catch (error) {
          console.error(error)
        }
        expect(console.error).toBeCalled()
        app1.container = saveContainer
        clearAppName()
        const removeChildDom1 = document.createElement('div')
        document.body.appendChild(removeChildDom1)
        document.body.removeChild(removeChildDom1)
        try {
          // @ts-ignore
          document.body.removeChild(null)
        } catch (error) {
          console.error(error)
        }
        expect(console.error).toBeCalled()

        const removeChildDom2 = document.createElement('div')
        document.body.appendChild(removeChildDom2)
        removeChildDom2.__MICRO_APP_NAME__ = 'not-exist'
        document.body.removeChild(removeChildDom2)

        // 验证 prepend 把 head/body 插入重定向到子应用容器。
        setAppName('test-app1')
        const prependDom1 = document.createElement('span')
        document.body.prepend(prependDom1, '123')
        const prependDom2 = document.createElement('span')
        document.head.prepend(prependDom2, '123')
        expect(microAppBody.contains(prependDom1)).toBeTruthy()
        expect(microAppHead.contains(prependDom2)).toBeTruthy()
        clearAppName()
        const prependDom3 = document.createElement('span')
        document.body.prepend(prependDom3)
        const prependDom4 = document.createElement('span')
        document.head.prepend(prependDom4)
        expect(microAppBody.contains(prependDom3)).toBeFalsy()
        expect(microAppHead.contains(prependDom4)).toBeFalsy()
        // 验证 insertBefore 在子应用 body 中保持相对插入语义。
        setAppName('test-app1')
        const insertBeforeDom1 = document.createElement('span')
        const insertBeforeDom2 = document.createElement('span')
        document.body.appendChild(insertBeforeDom1)
        document.body.insertBefore(insertBeforeDom2, insertBeforeDom1)
        expect(microAppBody.contains(insertBeforeDom2)).toBeTruthy()

        // 验证 setAttribute 对 micro-app data 属性的类型校验与对象兼容。
        microAppElement1.setAttribute('data', 'not object')
        expect(console.warn).toHaveBeenLastCalledWith('[micro-app] app test-app1: property data must be an object')
        // 模拟将对象类型转换为字符串
        microAppElement1.setAttribute('data', '[object Object]')
        // @ts-ignore
        microAppElement1.setAttribute('data', {
          __selfName: '',
          1: 'number key',
        })

        // 验证 commonElementHandler 在容器缺失、应用缺失和非节点参数下安全退化。
        // 模拟app被卸载
        document.body.appendChild(microSvg)
        app1.container = null

        setAppName('test-app1')
        const commonElementHandlerDom1 = document.createElement('div')
        const commonElementHandlerDom2 = document.createElement('div')
        document.body.appendChild(commonElementHandlerDom1)
        document.body.append(commonElementHandlerDom2)
        expect(microAppBody.contains(commonElementHandlerDom1)).toBeFalsy()
        expect(microAppBody.contains(commonElementHandlerDom2)).toBeFalsy()

        app1.container = saveContainer
        // appName存在，且插入类型不属于node类型，此时走到兜底处理
        document.body.children[0]?.prepend('123')

        // 模拟app不存在
        setAppName('not-exist')
        document.body.prepend('123')
        const commonElementHandlerDom3 = document.createElement('div')
        commonElementHandlerDom3.__MICRO_APP_NAME__ = 'not-exist'
        document.body.prepend(commonElementHandlerDom3)

        // 目标元素不存在
        document.body.prepend(null as any)

        // 验证 getMappingNode 对已缓存动态资源节点的映射分支。
        // 从缓存中操作元素
        setAppName('test-app1')
        const getMappingNodeDom1 = document.createElement('script')
        getMappingNodeDom1.textContent = 'var a = 1'
        document.head.appendChild(getMappingNodeDom1)
        document.head.removeChild(getMappingNodeDom1)

        // 验证 invokePrototypeMethod 对普通父节点和非映射被动节点的兜底。
        setAppName('test-app1')
        // 父元素非body、head
        const invokePrototypeMethodDom1 = document.createElement('div')
        const invokePrototypeMethodDom2 = document.createElement('div')
        const ssrHtmlId = document.querySelector('#ssr-html-id')!
        ssrHtmlId.appendChild(invokePrototypeMethodDom1)
        ssrHtmlId.append(invokePrototypeMethodDom2)
        expect(ssrHtmlId.contains(invokePrototypeMethodDom1)).toBeTruthy()
        expect(ssrHtmlId.contains(invokePrototypeMethodDom2)).toBeTruthy()

        // insertBefore 或 replaceChild 中 passiveChild不属于microAppHead、microAppBody
        const notExistDom1 = document.createElement('span')
        const invokePrototypeMethodDom3 = document.createElement('span')
        const invokePrototypeMethodDom4 = document.createElement('span')
        document.head.insertBefore(invokePrototypeMethodDom3, notExistDom1)
        document.body.replaceChild(invokePrototypeMethodDom4, notExistDom1)
        expect(microAppHead.contains(invokePrototypeMethodDom3)).toBeTruthy()
        expect(microAppBody.contains(invokePrototypeMethodDom4)).toBeTruthy()

        // removeChild 删除不属于microAppHead、microAppBody的元素
        clearAppName()
        const invokePrototypeMethodDom5 = document.createElement('span')
        const invokePrototypeMethodDom6 = document.createElement('span')
        document.head.appendChild(invokePrototypeMethodDom5)
        document.body.appendChild(invokePrototypeMethodDom6)
        invokePrototypeMethodDom5.__MICRO_APP_NAME__ = 'test-app1'
        invokePrototypeMethodDom6.__MICRO_APP_NAME__ = 'test-app1'
        document.head.removeChild(invokePrototypeMethodDom5)
        document.body.removeChild(invokePrototypeMethodDom6)
        expect(document.head.contains(invokePrototypeMethodDom5)).toBeFalsy()
        expect(document.body.contains(invokePrototypeMethodDom6)).toBeFalsy()
        // 再次删除不会报错
        expect(document.head.removeChild(invokePrototypeMethodDom5)).toBe(invokePrototypeMethodDom5)
        expect(document.body.removeChild(invokePrototypeMethodDom5)).toBe(invokePrototypeMethodDom5)

        // 验证 handleNewNode 对样式隔离、exclude/ignore 与插件排除配置的分流。
        setAppName('test-app1')
        const handleNewNodeDom1 = document.createElement('style')
        handleNewNodeDom1.setAttribute('exclude', 'true')
        document.head.appendChild(handleNewNodeDom1)

        const handleNewNodeDom2 = document.createElement('style')
        document.head.appendChild(handleNewNodeDom2)

        expect(microAppHead.contains(handleNewNodeDom1)).toBeFalsy()
        expect(microAppHead.contains(handleNewNodeDom2)).toBeTruthy()

        // 模拟关闭样式隔离
        app1.scopecss = false
        const handleNewNodeDom3 = document.createElement('style')
        document.head.appendChild(handleNewNodeDom3)

        const handleNewNodeDom5 = document.createElement('link')
        document.head.appendChild(handleNewNodeDom5)
        expect(microAppHead.contains(handleNewNodeDom5)).toBeTruthy()
        app1.scopecss = true

        // link 标签的 exclude
        const handleNewNodeDom4 = document.createElement('link')
        handleNewNodeDom4.setAttribute('exclude', 'true')
        document.head.appendChild(handleNewNodeDom4)
        expect(microAppHead.contains(handleNewNodeDom4)).toBeFalsy()

        // 分支覆盖 - 动态插入具有ignore属性的link元素
        const handleNewNodeDom6 = document.createElement('link')
        handleNewNodeDom6.setAttribute('ignore', 'true')
        document.head.appendChild(handleNewNodeDom6)
        expect(microAppHead.contains(handleNewNodeDom6)).toBeTruthy()

        // microApp.start global plugin excludeChecker link 链接返回 true，则忽略
        const handleNewNodeDom7 = document.createElement('link')
        handleNewNodeDom7.setAttribute('href', '/demo7.css')
        expect(microAppHead.contains(handleNewNodeDom7)).toBeFalsy()

        // microApp.start module plugin excludeChecker link 链接返回 true，则忽略
        const handleNewNodeDom8 = document.createElement('link')
        handleNewNodeDom8.setAttribute('href', '/demo8.css')
        expect(microAppHead.contains(handleNewNodeDom8)).toBeFalsy()

        // microApp.start global plugin excludeChecker script 链接返回 true，则忽略
        const handleNewNodeDom9 = document.createElement('script')
        handleNewNodeDom9.setAttribute('css', '/demo9.js')
        expect(microAppHead.contains(handleNewNodeDom9)).toBeFalsy()

        // microApp.start module plugin excludeChecker link 链接返回 true，则忽略
        const handleNewNodeDom10 = document.createElement('script')
        handleNewNodeDom10.setAttribute('src', '/demo10.js')
        expect(microAppHead.contains(handleNewNodeDom10)).toBeFalsy()

        resolve(true)
      }, false)
    })
  })

  // 分支覆盖 - document 原型方法的 this 指向
  test('coverage of document this', async () => {
    const microAppElement2 = document.createElement('micro-app')
    microAppElement2.setAttribute('name', 'test-app2')
    microAppElement2.setAttribute('url', `http://127.0.0.1:${ports.source_patch}/ssr-render/`)

    appCon.appendChild(microAppElement2)

    await new Promise((resolve) => {
      microAppElement2.addEventListener('mounted', () => {
        setAppName('test-app2')
        const fakerDoc = new Document()

        const querySelector = Document.prototype.querySelector
        querySelector.call(fakerDoc, 'div')

        const querySelectorAll = Document.prototype.querySelectorAll
        querySelectorAll.call(fakerDoc, 'div')

        resolve(true)
      })
    })
  })

  // 分支覆盖 - 错误的 querySelector key
  test('coverage of error querySelector key', async () => {
    const microAppElement3 = document.createElement('micro-app')
    microAppElement3.setAttribute('name', 'test-app3')
    microAppElement3.setAttribute('url', `http://127.0.0.1:${ports.source_patch}/ssr-render/`)

    appCon.appendChild(microAppElement3)

    await new Promise((resolve) => {
      microAppElement3.addEventListener('mounted', () => {
        setAppName('test-app3')
        document.getElementById('sd$fs')
        document.getElementsByClassName('sd$fs')
        document.getElementsByTagName('sd$fs')
        document.getElementsByName('sd$fs')

        resolve(true)
      })
    })
  })
})
