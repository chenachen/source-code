/* eslint-disable promise/param-names */
import { commonStartEffect, releaseAllEffect, ports, setAppName } from '../common/initial'
import { appInstanceMap } from '../../create_app'
import microApp from '../..'

/**
 * 沙箱集成场景及历史分支用例；当前 jest.config.js 未将本文件列入 testMatch。
 * common/ssr-render fixture 会调用子应用代理的事件和定时器 API；测试正文多数只观察挂载完成与实例数。
 */
describe('sandbox effect', () => {
  let appCon: Element
  /**
   * 建立独立端口和 #app-container，启动带空 plugins 的框架单例；后续用例累积挂载应用。
   * common fixture 负责主动/未主动移除的监听器和 timer 输入，umd1 提供当前可捕获的 window 钩子。
   */
  beforeAll(() => {
    commonStartEffect(ports.effect)
    appCon = document.querySelector('#app-container')!

    microApp.start({
      plugins: {}, // sandbox/index 分支覆盖
    })
  })

  afterAll(() => {
    return releaseAllEffect()
  })

  /**
   * 宿主 onclick 先清空，再挂载会设置独立 onclick、绑定/解除 click 与遗留 timer 的 common fixture。
   * mounted 后断言一个实例且宿主 onclick 赋值仍返回原 Jest 回调，再成对调用宿主 click API。
   * 验证挂载后宿主事件门面仍可使用；未通过派发或卸载后的计数证明 fixture 残留监听器已经清除。
   */
  test('special branch coverage of document click', async () => {
    const microAppElement1 = document.createElement('micro-app')
    microAppElement1.setAttribute('name', 'test-app1')
    microAppElement1.setAttribute('url', `http://127.0.0.1:${ports.effect}/common/`)

    document.onclick = null

    appCon.appendChild(microAppElement1)

    await new Promise((resolve) => {
      microAppElement1.addEventListener('mounted', () => {
        expect(appInstanceMap.size).toBe(1)
        // fixture 的 proxyDocument.onclick 不应替换宿主的属性读写语义。
        const baseDomOnclick = jest.fn()
        document.onclick = baseDomOnclick
        expect(document.onclick).toBe(baseDomOnclick)

        // 成对调用宿主监听 API，覆盖宿主路径可调用；没有 click 派发，因此不比较执行次数。
        document.addEventListener('click', baseDomOnclick, false)
        document.removeEventListener('click', baseDomOnclick, false)
        resolve(true)
      }, false)
    })
  })

  /**
   * 前例应用仍在容器中，再挂载主动解除 document click/window scroll 的 ssr-render fixture。
   * mounted 后只断言实例数增至两个，目标是确认该输入能完成挂载；没有派发事件验证移除后的回调数。
   */
  test('special branch coverage of window event', async () => {
    const microAppElement2 = document.createElement('micro-app')
    microAppElement2.setAttribute('name', 'test-app2')
    microAppElement2.setAttribute('url', `http://127.0.0.1:${ports.effect}/ssr-render/`)

    appCon.appendChild(microAppElement2)

    await new Promise((resolve) => {
      microAppElement2.addEventListener('mounted', () => {
        expect(appInstanceMap.size).toBe(2)
        resolve(true)
      }, false)
    })
  })

  /**
   * 给第三个元素设置旧 library 名与 umd2 入口；首次 mounted 移除，再插回同一元素并等待第二次 mounted。
   * 等待能完成是本例的实际验证目标，没有快照集合或恢复后事件执行次数断言。
   * fixture 使用 window['umd-app2']，而 rc.32 只捕获 mount/unmount 或 micro-app-${appName}；
   * library 属性不参与当前捕获路径，因此这个输入在本版走默认卸载、重执行脚本，未形成 UMD 快照恢复。
   */
  test('coverage branch of umd effect snapshot', async () => {
    const microAppElement3 = document.createElement('micro-app')
    microAppElement3.setAttribute('name', 'test-app3')
    microAppElement3.setAttribute('library', 'umd-app2') // 自定义umd名称
    microAppElement3.setAttribute('url', `http://127.0.0.1:${ports.effect}/umd2`)

    let commonResolve: CallableFunction
    /** 首次 mounted 后移除元素，并结算本轮等待，供下一步重新插入。 */
    function firstMountHandler () {
      microAppElement3.removeEventListener('mounted', firstMountHandler)
      appCon.removeChild(microAppElement3)
      commonResolve(true)
    }

    microAppElement3.addEventListener('mounted', firstMountHandler)

    await new Promise((resolve) => {
      commonResolve = resolve
      appCon.appendChild(microAppElement3)
    })

    await new Promise((resolve) => {
      microAppElement3.addEventListener('mounted', () => {
        resolve(true)
      })
      // 再次渲染
      appCon.appendChild(microAppElement3)
    })
  })

  /**
   * 挂载具有 window.mount/unmount 的 umd1 后，暂删应用注册、恢复为普通模式、再设为 UMD 模式。
   * 三段分别在宿主 document 上绑定/解除普通函数；等待回调能完成，但没有事件派发或绑定缓存断言。
   * setAppName 只设置 DOM 归属标记，不会把这个宿主 document 变成 proxyDocument；
   * 当前调用因此不进入沙箱文档事件登记。变量虽名为 boundFunc，下面未调用 bind。
   */
  test('coverage of bound function of document event in umd mode', async () => {
    const microAppElement4 = document.createElement('micro-app')
    microAppElement4.setAttribute('name', 'test-app4')
    microAppElement4.setAttribute('url', `http://127.0.0.1:${ports.effect}/umd1/`)

    appCon.appendChild(microAppElement4)

    await new Promise((resolve) => {
      microAppElement4.addEventListener('mounted', () => {
        setAppName('test-app4')
        /** 应用注册被删除时传给宿主 document 的普通回调。 */
        const boundFunc1 = function func1 () {}
        /** 应用注册恢复且 umdMode=false 时传给宿主 document 的普通回调。 */
        const boundFunc2 = function func2 () {}
        /** umdMode=true 时传给宿主 document 的普通回调。 */
        const boundFunc3 = function func3 () {}

        const app = appInstanceMap.get('test-app4')!

        // 场景1：应用不存在。
        appInstanceMap.delete('test-app4')
        document.addEventListener('click', boundFunc1, false)
        document.removeEventListener('click', boundFunc1, false)

        // 场景2：应用存在但不是 UMD 模式。
        app.umdMode = false
        appInstanceMap.set('test-app4', app)
        document.addEventListener('click', boundFunc2, false)
        document.removeEventListener('click', boundFunc2, false)

        // 场景3：应用字段标记为 UMD，但本次监听器仍是未绑定的普通函数。
        app.umdMode = true
        document.addEventListener('click', boundFunc3, false)
        document.removeEventListener('click', boundFunc3, false)

        resolve(true)
      }, false)
    })
  })

  /**
   * 以 iframe 配置挂载 umd4，mounted 后用沙箱 Element 检查静态 #umd-root4 和预期由 mount 创建的 .container。
   * 两个 instanceof 断言预定覆盖静态节点与 iframe 创建节点的 realm 兼容，不仅检查应用已挂载。
   * 当前 fixture 导出 window['umd-app4']，不符合 rc.32 的 UMD 捕获名称；其 mount 不会被调用，
   * 因而 .container 没有创建路径，这条断言需要先适配 fixture 的导出名称才能验证跨 realm 判定。
   */
  test('coverage of instanceof judgement of element in html content under iframe sandbox', async () => {
    const microAppElement5 = document.createElement('micro-app')
    microAppElement5.setAttribute('name', 'test-app5')
    microAppElement5.setAttribute('iframe', 'true');
    microAppElement5.setAttribute('url', `http://127.0.0.1:${ports.effect}/umd4/`)

    appCon.appendChild(microAppElement5)

    await new Promise((resolve) => {
      microAppElement5.addEventListener('mounted', () => {
        setAppName('test-app5')
        const app = appInstanceMap.get('test-app5')!

        const proxyWindow = app.sandBox.proxyWindow;

        expect(app.querySelector('#umd-root4') instanceof proxyWindow.Element).toBe(true)
        expect(app.querySelector('.container') instanceof proxyWindow.Element).toBe(true)

        resolve(true)
      }, false)
    })
  })
})
