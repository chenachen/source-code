/* eslint-disable promise/param-names */
import { commonStartEffect, releaseAllEffect, ports, setAppName } from '../common/initial'
import { appInstanceMap } from '../../create_app'
// 本文件保留旧缓存接口；rc.32 不再导出 globalScripts，改用 sourceCenter.script 与静态地址 Set。
import { globalScripts } from '../../source/scripts'
import microApp from '../..'

/** 当前默认 Jest testMatch 未纳入本文件，需显式选择才会发现这些场景。 */
describe('source scripts', () => {
  let appCon: Element
  beforeAll(() => {
    commonStartEffect(ports.source_scripts)
    microApp.start({
      plugins: {
        global: [
          {
            /** 全局脚本插件原样返回源码，覆盖插件管线成功分支。 */
            loader (code, _url, _options) {
              // console.log('全局插件', _url)
              return code
            }
          },
          {
            loader: 'invalid loader' as any,
          },
          'invalid plugin' as any,
        ],
        modules: {
          'test-app1': [
            {
              /** 应用级脚本插件接收全局插件输出，此处原样返回以覆盖有效 loader 分支。 */
              loader (code, _url, _options) {
                // console.log('test-app1', _url)
                return code
              }
            }
          ],
          'test-app2': [
            {
              loader: 'invalid loader' as any,
            }
          ],
          'test-app5': 'invalid plugin' as any,
        }
      }
    })
    appCon = document.querySelector('#app-container')!
  })

  afterAll(() => {
    return releaseAllEffect()
  })

  /**
   * 挂载 dynamic 后在应用作用域插入不存在的外链 script，等待原节点 onerror 回调。
   * 应记录带应用名的下载错误并通知原节点，Promise 在该回调内 resolve，验证动态请求失败时序。
   */
  test('append a script with error href', async () => {
    const microAppElement1 = document.createElement('micro-app')
    microAppElement1.setAttribute('name', 'test-app1')
    microAppElement1.setAttribute('url', `http://127.0.0.1:${ports.source_scripts}/dynamic/`)

    appCon.appendChild(microAppElement1)
    await new Promise((resolve) => {
      microAppElement1.addEventListener('mounted', () => {
        setAppName('test-app1')
        // 动态创建script
        const dynamicScript = document.createElement('script')
        dynamicScript.setAttribute('src', 'http://www.micro-app-test.com/not-exist.js')
        document.head.appendChild(dynamicScript)
        /** 在原节点 error 通知里检查下载日志并完成外层等待。 */
        dynamicScript.onerror = function () {
          expect(console.error).toBeCalledWith('[micro-app] app test-app1:', expect.any(Error))
          resolve(true)
        }
      }, false)
    })
  }, 10000)

  /**
   * 使用默认不具备 noModule 属性的 JSDOM 挂载 common，并再动态插入 type=module 脚本。
   * 模块能力过滤应移除 module，nomodule 保留；本例只等待 mounted 和执行插入，没有直接断言模块日志或替代节点。
   */
  test('noModule or not support modal script', async () => {
    // 测试环境默认不支持module模式
    const microAppElement2 = document.createElement('micro-app')
    microAppElement2.setAttribute('name', 'test-app2')
    microAppElement2.setAttribute('url', `http://127.0.0.1:${ports.source_scripts}/common/`)

    appCon.appendChild(microAppElement2)
    await new Promise((resolve) => {
      microAppElement2.addEventListener('mounted', () => {
        setAppName('test-app2')
        // 插入一个无法运行的module
        const dynamicScript = document.createElement('script')
        dynamicScript.setAttribute('src', './module.js')
        dynamicScript.setAttribute('type', 'module')
        document.head.appendChild(dynamicScript)
        resolve(true)
      }, false)
    })
  })

  /**
   * 挂载 dynamic 后插入既无 src 也无文本的 script。应进入空脚本过滤，占位不执行任何代码；本例没有输出或节点断言，
   * 验证目标是该空输入调用路径。
   */
  test('append an unUseless dynamic inline script element', async () => {
    const microAppElement4 = document.createElement('micro-app')
    microAppElement4.setAttribute('name', 'test-app4')
    microAppElement4.setAttribute('url', `http://127.0.0.1:${ports.source_scripts}/dynamic/`)

    appCon.appendChild(microAppElement4)
    await new Promise((resolve) => {
      microAppElement4.addEventListener('mounted', () => {
        setAppName('test-app4')
        const dynamicScript = document.createElement('script')
        document.head.appendChild(dynamicScript)
        resolve(true)
      }, false)
    })
  })

  /**
   * 在 dynamic 应用插入含 console.error 的内联 script，立即核对日志。
   * Function 执行路径应在插入调用中同步求值，验证动态内联执行与应用插件原样管线。
   */
  test('append an dynamic inline script element', async () => {
    const microAppElement5 = document.createElement('micro-app')
    microAppElement5.setAttribute('name', 'test-app5')
    microAppElement5.setAttribute('url', `http://127.0.0.1:${ports.source_scripts}/dynamic/`)

    appCon.appendChild(microAppElement5)
    await new Promise((resolve) => {
      microAppElement5.addEventListener('mounted', () => {
        setAppName('test-app5')
        const dynamicScript = document.createElement('script')
        dynamicScript.textContent = 'console.error("inline script")'
        document.head.appendChild(dynamicScript)

        expect(console.error).toBeCalledWith('inline script')
        resolve(true)
      }, false)
    })
  })

  /**
   * 先挂载 element-config，再由第二应用重复动态插入 script2.js，目标是共享下载代码但每个节点仍执行。
   * rc.32 非空缓存命中使用 defer，动态地址不进静态 Set；
   * globalScripts 与 app.source.scripts.get 断言沿用旧 Map 接口，无法验证当前资源中心。
   */
  test('get js code from cache', async () => {
    const microAppElement6 = document.createElement('micro-app')
    microAppElement6.setAttribute('name', 'test-app6')
    microAppElement6.setAttribute('url', `http://127.0.0.1:${ports.source_scripts}/element-config`)

    appCon.appendChild(microAppElement6)
    await new Promise((resolve) => {
      microAppElement6.addEventListener('mounted', () => {
        // 旧 globalScripts 只统计 global 标记；rc.32 所有外部地址都登记到 sourceCenter.script。
        expect(globalScripts.size).toBe(2)
        resolve(true)
      }, false)
    })

    const microAppElement7 = document.createElement('micro-app')
    microAppElement7.setAttribute('name', 'test-app7')
    microAppElement7.setAttribute('url', `http://127.0.0.1:${ports.source_scripts}/dynamic`)

    appCon.appendChild(microAppElement7)
    await new Promise((resolve) => {
      microAppElement7.addEventListener('mounted', () => {
        setAppName('test-app7')

        // 从全局缓存中获取js文件内容
        const dynamicScript = document.createElement('script')
        // script2已被test-app6放入全局缓存
        dynamicScript.setAttribute('src', '/element-config/script2.js')
        document.head.appendChild(dynamicScript)

        // 旧接口读取应用 Map；rc.32 的共享 code 应从 sourceCenter.script.getInfo(address) 读取。
        const app = appInstanceMap.get('test-app7')!
        expect(app.source.scripts.get(`http://127.0.0.1:${ports.source_scripts}/element-config/script2.js`)?.code?.length).toBeGreaterThan(1)

        // 新节点再次命中共享代码与已有 appSpace；它仍会进入动态执行流程。
        const dynamicScript2 = document.createElement('script')
        dynamicScript2.setAttribute('src', '/element-config/script2.js')
        document.head.appendChild(dynamicScript2)

        resolve(true)
      }, false)
    })
  })

  /**
   * 挂载含不存在普通外链脚本的 HTML，等待 mounted 后核对最近错误带应用上下文。静态预取失败应记录错误并使下载链结算，
   * 空 code 仍走后续执行流程，验证单项网络失败不直接卡住加载计数。
   */
  test('not exist js in html', async () => {
    const microAppElement8 = document.createElement('micro-app')
    microAppElement8.setAttribute('name', 'test-app8')
    microAppElement8.setAttribute('url', `http://127.0.0.1:${ports.source_scripts}/special-html/notexist-js.html`)

    appCon.appendChild(microAppElement8)
    await new Promise((resolve) => {
      microAppElement8.addEventListener('mounted', () => {
        expect(console.error).toHaveBeenLastCalledWith('[micro-app] app test-app8:', expect.any(Object))
        resolve(true)
      }, false)
    })
  })

  /**
   * 挂载含失败 defer 脚本的 HTML，mounted 后另等 100ms 检查错误日志。
   * 请求在 execScripts 扫描时开始、延迟批次结算后可继续挂载，验证 defer 下载失败出口；
   * 不验证 browser async 下载即执行语义。
   */
  test('error defer js in html', async () => {
    const microAppElement9 = document.createElement('micro-app')
    microAppElement9.setAttribute('name', 'test-app9')
    microAppElement9.setAttribute('url', `http://127.0.0.1:${ports.source_scripts}/special-html/error-deferjs.html`)

    appCon.appendChild(microAppElement9)
    await new Promise((resolve) => {
      microAppElement9.addEventListener('mounted', () => {
        setTimeout(() => {
          expect(console.error).toHaveBeenLastCalledWith('[micro-app] app test-app9:', expect.any(Object))
          resolve(true)
        }, 100)
      }, false)
    })
  })

  /**
   * 以 inline=true 挂载 dynamic，再插入 common/script2 外链，
   * 立即检查原动态节点不在 document。框架应插入替代 script，原节点只保留身份和通知；此断言验证替换，
   * 没有等待下载或代码执行。
   */
  test('append dynamic script with inline mode', async () => {
    const microAppElement10 = document.createElement('micro-app')
    microAppElement10.setAttribute('name', 'test-app10')
    microAppElement10.setAttribute('url', `http://127.0.0.1:${ports.source_scripts}/dynamic`)
    microAppElement10.setAttribute('inline', 'true')

    appCon.appendChild(microAppElement10)
    await new Promise((resolve) => {
      microAppElement10.addEventListener('mounted', () => {
        setAppName('test-app10')
        const dynamicScript = document.createElement('script')
        dynamicScript.setAttribute('src', '/common/script2.js')
        document.head.appendChild(dynamicScript)
        expect(document.contains(dynamicScript)).toBeFalsy()
        resolve(true)
      }, false)
    })
  })

  /**
   * 挂载 dynamic 后插入首次下载的 throw-error.js，正文等待原节点 onload 并期待旧执行日志。
   * 当前非缓存执行异常进入 fetch 链 catch，记录错误并发送 error，因此不会由该 onload 完成 Promise；
   * 这是旧成功通知预期的实际不兼容点。
   */
  test('throw error in dynamic script', async () => {
    const microAppElement11 = document.createElement('micro-app')
    microAppElement11.setAttribute('name', 'test-app11')
    microAppElement11.setAttribute('url', `http://127.0.0.1:${ports.source_scripts}/dynamic`)

    appCon.appendChild(microAppElement11)
    await new Promise((resolve) => {
      microAppElement11.addEventListener('mounted', () => {
        setAppName('test-app11')
        const dynamicScript = document.createElement('script')
        dynamicScript.setAttribute('src', '/dynamic/throw-error.js')
        document.head.appendChild(dynamicScript)
        /** 旧成功通知观察点；当前首次下载后的求值异常走 error，不能由此回调完成等待。 */
        dynamicScript.onload = () => {
          expect(console.error).toHaveBeenLastCalledWith('[micro-app from runDynamicScript] app test-app11: ', expect.any(Error), expect.any(String))
          resolve(true)
        }
      }, false)
    })
  })

  /**
   * 用 disableSandbox=true 挂载含普通脚本的入口，mounted 后查询实例。sandBox 应为 null，
   * 验证关闭沙箱的创建分支；不单独证明脚本全局变量或 CSS 的隔离行为。
   */
  test('coverage code for disable sandbox', async () => {
    const microAppElement12 = document.createElement('micro-app')
    microAppElement12.setAttribute('name', 'test-app12')
    microAppElement12.setAttribute('url', `http://127.0.0.1:${ports.source_scripts}/special-html/disablesandbox.html`)
    microAppElement12.setAttribute('disableSandbox', 'true')

    appCon.appendChild(microAppElement12)
    await new Promise((resolve) => {
      microAppElement12.addEventListener('mounted', () => {
        expect(appInstanceMap.get('test-app12')?.sandBox).toBeNull()
        resolve(true)
      }, false)
    })
  })

  /**
   * 在 dynamic 应用 mounted 时插入远程脚本，第一次 load 后移除并重插同一宿主。
   * 动态资源不加入静态 scripts Set，重挂载复用 source.html；Promise 在再次插入后即结束，
   * 没有等待第二次 mounted 或断言脚本执行次数。
   */
  test('coverage branch of remount an app with dynamic script', async () => {
    const microAppElement13 = document.createElement('micro-app')
    microAppElement13.setAttribute('name', 'test-app13')
    microAppElement13.setAttribute('url', `http://127.0.0.1:${ports.source_scripts}/dynamic`)

    let init = false
    appCon.appendChild(microAppElement13)
    await new Promise((resolve) => {
      microAppElement13.addEventListener('mounted', () => {
        setAppName('test-app13')
        const dynamicScript = document.createElement('script')
        dynamicScript.setAttribute('src', '/dynamic/script1.js')
        document.head.appendChild(dynamicScript)

        if (!init) {
          init = true
          /** 第一次动态脚本 load 后立即重插宿主，触发同实例重挂载但不等待第二次 mounted。 */
          dynamicScript.onload = () => {
            appCon.removeChild(microAppElement13)
            appCon.appendChild(microAppElement13)
            resolve(true)
          }
        }
      }, false)
    })
  })

  /**
   * 在 dynamic 应用插入带 global 的 script1，并在 load 中读取旧 globalScripts 缓存。
   * 当前 global 不影响共享资源策略；mounted 内先 resolve 且旧导出不存在，
   * 故正文不构成当前缓存值或 load 完成的验证。
   */
  test('coverage branch of append a global dynamic script', async () => {
    const microAppElement14 = document.createElement('micro-app')
    microAppElement14.setAttribute('name', 'test-app14')
    microAppElement14.setAttribute('url', `http://127.0.0.1:${ports.source_scripts}/dynamic`)

    appCon.appendChild(microAppElement14)
    await new Promise((resolve) => {
      microAppElement14.addEventListener('mounted', () => {
        setAppName('test-app14')
        const dynamicScript = document.createElement('script')
        dynamicScript.setAttribute('src', '/dynamic/script1.js')
        dynamicScript.setAttribute('global', 'true')
        document.head.appendChild(dynamicScript)
        /** 保留旧全局字符串缓存的观察点；当前资源对象应从 sourceCenter 读取，且外层并未等此回调。 */
        dynamicScript.onload = () => {
          expect(globalScripts.get(`http://127.0.0.1:${ports.source_scripts}/dynamic/script1.js`)).toBe(expect.any(String))
        }
        resolve(true)
      }, false)
    })
  })

  /**
   * 首次挂载 errorjs HTML，让普通脚本同步抛错，旧正文等待 mounted 并期待旧 console.error 文本。
   * 当前 runScript 默认 warn 后重抛，会中断当次求值链，后续 mounted 不保证触发；该旧断言不是当前执行异常出口。
   *
   */
  test('an error occurs at the first rendering', async () => {
    const microAppElement15 = document.createElement('micro-app')
    microAppElement15.setAttribute('name', 'test-app15')
    microAppElement15.setAttribute('url', `http://127.0.0.1:${ports.source_scripts}/dynamic/errorjs.html`)

    appCon.appendChild(microAppElement15)
    await new Promise((resolve) => {
      microAppElement15.addEventListener('mounted', () => {
        expect(console.error).toHaveBeenLastCalledWith('[micro-app from runScript] app test-app15: ', expect.any(Error))
        resolve(true)
      }, false)
    })
  })

  /**
   * 挂载包含两个不存在 defer 地址的 HTML，等待 mounted 后检查错误日志。
   * 延迟请求全部拒绝会累计 errorCount，最终完成判据允许结算；本例只观察最后错误，没有直接断言两个请求数量或完成计数。
   */
  test('coverage: failed to get defer js file', async () => {
    const microAppElement16 = document.createElement('micro-app')
    microAppElement16.setAttribute('name', 'test-app16')
    microAppElement16.setAttribute('url', `http://127.0.0.1:${ports.source_scripts}/special-html/notexistdefer.html`)

    appCon.appendChild(microAppElement16)
    await new Promise((resolve) => {
      microAppElement16.addEventListener('mounted', () => {
        expect(console.error).toHaveBeenLastCalledWith('[micro-app] app test-app16:', expect.any(Object))
        resolve(true)
      }, false)
    })
  })
})
