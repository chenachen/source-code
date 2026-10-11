/* eslint-disable promise/param-names */
import { rawDocumentCreateElement, rawSetAttribute } from './support_module'
import { commonStartEffect, releaseAllEffect, ports, setAppName } from '../common/initial'
import microApp from '../..'

/** 当前默认 Jest testMatch 未纳入本文件，需显式选择才会发现这些场景。 */
describe('source scripts2', () => {
  let appCon: Element
  beforeAll(() => {
    // Jest 环境没有 URL.createObjectURL，这里提供模块脚本分支所需的桩。
    global.URL.createObjectURL = jest.fn()
    commonStartEffect(ports.source_scripts2)
    microApp.start({
      plugins: {}
    })
    appCon = document.querySelector('#app-container')!
  })

  afterAll(() => {
    Document.prototype.createElement = rawDocumentCreateElement
    Element.prototype.setAttribute = rawSetAttribute
    return releaseAllEffect()
  })

  /**
   * 先由 support_module 给显式创建的 script 添 noModule 属性，
   * 再用默认 With 沙箱挂载 common，等 200ms 插入动态 noModule 脚本。动态节点应被过滤；
   * DOMParser 解析的静态 nomodule 未经过桩 setter，仍执行并产生 warn。
   * 此处 module 在 With 下作普通包装代码执行，定时等待不等于原生 module 完成验证。
   */
  test('support module environment', async () => {
    const microAppElement1 = document.createElement('micro-app')
    microAppElement1.setAttribute('name', 'test-app1')
    microAppElement1.setAttribute('url', `http://127.0.0.1:${ports.source_scripts2}/common/`)

    appCon.appendChild(microAppElement1)
    await new Promise((resolve) => {
      setTimeout(() => {
        // 这里按固定时间进入动态操作；默认 With 的 module 仍作普通代码执行，并非等待原生模块 load。
        setAppName('test-app1')
        // 动态创建script，noModulejs不会被执行
        const dynamicScript1 = document.createElement('script')
        dynamicScript1.setAttribute('src', '/common/script2.js')
        dynamicScript1.setAttribute('noModule', 'true')
        document.head.appendChild(dynamicScript1)

        // 模拟环境下，html自带nomodule不会触发setAttribute，所以会执行，此处为特殊情况
        expect(console.warn).toBeCalledWith('nomodule')

        // // 分支覆盖
        // const dynamicScript2 = document.createElement('script')
        // dynamicScript2.setAttribute('type', 'module')
        // dynamicScript2.setAttribute('src', '/common/global.js')
        // document.head.appendChild(dynamicScript2)

        // const dynamicScript3 = document.createElement('script')
        // dynamicScript3.setAttribute('type', 'module')
        // dynamicScript3.setAttribute('src', '/common/script3.js')
        // document.head.appendChild(dynamicScript3)
        resolve(true)
      }, 200)
    })
  })

  /**
   * 关闭沙箱且开启 inline，挂载 dynamic 后插入内联 module、普通外链 module 与同地址重复 module。
   * 当前原生 module 保留 type/src，由浏览器加载；JSDOM 不求值原生 module，日志断言已注释，本例只完成插入，
   * 不等待 load 或证明模块缓存。
   */
  test('use module in inline mode', async () => {
    const microAppElement2 = document.createElement('micro-app')
    microAppElement2.setAttribute('name', 'test-app2')
    microAppElement2.setAttribute('url', `http://127.0.0.1:${ports.source_scripts2}/dynamic/`)
    microAppElement2.setAttribute('inline', 'true')
    microAppElement2.setAttribute('disableSandbox', 'true')

    appCon.appendChild(microAppElement2)
    await new Promise((resolve) => {
      microAppElement2.addEventListener('mounted', () => {
        setAppName('test-app2')

        const dynamicScript1 = document.createElement('script')
        dynamicScript1.setAttribute('type', 'module')
        dynamicScript1.textContent = 'console.warn("inline module")'
        document.head.appendChild(dynamicScript1)

        const dynamicScript2 = document.createElement('script')
        dynamicScript2.setAttribute('src', '/common/module.js')
        dynamicScript2.setAttribute('type', 'module')
        document.head.appendChild(dynamicScript2)

        // 原生外链 module 保留 src；原节点的 load 通知等待替代元素 onload，global 属性不改变该路径。
        const dynamicScript3 = document.createElement('script')
        dynamicScript3.setAttribute('src', '/common/global.js')
        dynamicScript3.setAttribute('type', 'module')
        document.head.appendChild(dynamicScript3)

        // 同地址 module 仍创建原生 script，交给浏览器模块缓存；框架不以 code 命中人工提前发送 load。
        const dynamicScript4 = document.createElement('script')
        dynamicScript4.setAttribute('src', '/common/global.js')
        dynamicScript4.setAttribute('type', 'module')
        document.head.appendChild(dynamicScript4)

        // expect(console.warn).toBeCalledWith('inline module')
        resolve(true)
      }, false)
    })
  })
})
