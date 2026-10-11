/* eslint-disable promise/param-names */
import {
  commonStartEffect,
  releaseAllEffect,
  ports,
  jestConsoleError,
  jestConsoleWarn,
} from './common/initial'
import { appInstanceMap } from '../create_app'
import {
  appStates,
  keepAliveStates,
} from '../constants'
import microApp, {
  unmountApp,
  unmountAllApps,
  getActiveApps,
} from '..'
import { defer } from '../libs/utils'

/** 使用独立端口与共享实例表的生命周期集成套件；日志按每例 clearMocks，实例由各例卸载策略保留或删除，不在 beforeEach 重建。 */
describe('create_app', () => {
  let appCon: Element
  beforeAll(() => {
    commonStartEffect(ports.create_app)
    microApp.start()
    appCon = document.querySelector('#app-container')!
  })

  afterAll(() => {
    return releaseAllEffect()
  })

  /**
   * 场景：common 应用已发出 created、资源仍为 LOADING，此时移除元素并等待 unmount。
   * 断言主状态已 UNMOUNT、沙箱尚未 active；下一微任务检查 container 为空，再把同一元素插回。
   * 第二次 created 的 defer 回调要求注册表仍为 1 且状态为 BEFORE_MOUNT，检验未完成加载时的复用前置状态。末段 Promise 在 append 后立即结算，没有把后续 mounted 监听纳入等待边界。
   */
  test('unmount app before end of loading resource and remount', async () => {
    const microAppElement1 = document.createElement('micro-app')
    microAppElement1.setAttribute('name', 'test-app1')
    microAppElement1.setAttribute('url', `http://127.0.0.1:${ports.create_app}/common/`)

    let createCount = 0
    await new Promise((resolve) => {
      // 插入后由有效连接微任务创建实例并请求资源；同一监听会分别观察两次连接的 created。
      microAppElement1.addEventListener('created', () => {
        defer(() => {
          createCount++
          expect(appInstanceMap.size).toBe(1)
          if (createCount === 1) {
            expect(appInstanceMap.get('test-app1')!.getAppState()).toBe(appStates.LOADING)
          } else {
            // 二次连接的 mount 已推进到异步挂载前置阶段，此时状态为 BEFORE_MOUNT。
            expect(appInstanceMap.get('test-app1')!.getAppState()).toBe(appStates.BEFORE_MOUNT)
          }
          resolve(true)
        })
      }, false)

      appCon.appendChild(microAppElement1)
    })

    await new Promise((resolve) => {
      microAppElement1.addEventListener('unmount', () => {
        const app = appInstanceMap.get('test-app1')!
        expect(app.getAppState()).toBe(appStates.UNMOUNT)
        // 因为应用还没渲染就卸载，所以active始终为false
        // @ts-ignore
        expect(app.sandBox!.active).toBeFalsy()
        Promise.resolve().then(() => {
          expect(app.container).toBeNull()
          resolve(true)
        })
      }, false)
      appCon.removeChild(microAppElement1)
    })

    await new Promise((resolve) => {
      microAppElement1.addEventListener('mounted', () => {
        expect(createCount).toBe(2)
      }, false)
      appCon.appendChild(microAppElement1)
      resolve(true)
    })
  })

  /**
   * 场景：用旧驼峰 disableSandbox=true 配置 dynamic 入口的新应用。
   * 插入并等待 mounted，断言注册实例 useSandbox 为假，再移除宿主。
   * 验证元素兼容属性能关闭沙箱；不检查动态资源的数量、执行效果或卸载后的宿主全局残留。
   */
  test('disableSandbox in this app', async () => {
    const microAppElement2 = document.createElement('micro-app')
    microAppElement2.setAttribute('name', 'test-app2')
    microAppElement2.setAttribute('url', `http://127.0.0.1:${ports.create_app}/dynamic/`)
    microAppElement2.setAttribute('disableSandbox', 'true')

    appCon.appendChild(microAppElement2)
    await new Promise((resolve) => {
      microAppElement2.addEventListener('mounted', () => {
        expect(appInstanceMap.get('test-app2')!.useSandbox).toBeFalsy()
        resolve(true)
      }, false)
    })

    appCon.removeChild(microAppElement2)
  })

  /**
   * 场景：配置不存在的入口后，在同一调用栈内插入并立即移除元素。
   * 200ms 后断言 error 监听没有被调用，观察连接代次失效使延迟连接任务跳过。
   * 此时没有创建实例或启动 HTML 请求，不能据此归入“请求失败后已卸载”的 onLoadError 分支。
   */
  test('unmount app before fetch html failed', async () => {
    const microAppElement3 = document.createElement('micro-app')
    microAppElement3.setAttribute('name', 'test-app3')
    microAppElement3.setAttribute('url', 'http://www.not-exist.com/')

    const errorHandle = jest.fn()
    microAppElement3.addEventListener('error', errorHandle)

    appCon.appendChild(microAppElement3)
    appCon.removeChild(microAppElement3)

    await new Promise((resolve) => {
      setTimeout(() => {
        expect(errorHandle).not.toBeCalled()
        resolve(true)
      }, 200)
    })
  })

  /**
   * 场景：common/script1 在执行中既派发 unmount-me，又经数据通道发送 unmountMeAsync。
   * 为 test-app4 装宿主 window 监听同步移除，为 test-app5 装基座数据监听在微任务中移除，200ms 后检查两者的 mounted mock 均未调用。
   * 目标是 mounted 收尾遇到 UNMOUNT 时跳过事件；此断言没有检查移除次数、资源取消或卸载后新增副作用。
   */
  test('coverage branch of dispatch mounted event when app has unmounted', async () => {
    const microAppElement4 = document.createElement('micro-app')
    microAppElement4.setAttribute('name', 'test-app4')
    microAppElement4.setAttribute('url', `http://127.0.0.1:${ports.create_app}/common/`)

    appCon.appendChild(microAppElement4)

    const mountedHandler1 = jest.fn()
    microAppElement4.addEventListener('mounted', mountedHandler1)

    /** 模拟子应用 window 事件在 mounted 前同步要求基座移除自身。 */
    function unmountTestApp4 () {
      appCon.removeChild(microAppElement4)
      window.removeEventListener('unmount-me', unmountTestApp4)
    }
    window.addEventListener('unmount-me', unmountTestApp4)

    // 子应用通过数据通信异步通知基座卸载自己，但异步优先于mounted执行
    const microAppElement5 = document.createElement('micro-app')
    microAppElement5.setAttribute('name', 'test-app5')
    microAppElement5.setAttribute('url', `http://127.0.0.1:${ports.create_app}/common/`)

    appCon.appendChild(microAppElement5)

    const mountedHandler2 = jest.fn()
    microAppElement5.addEventListener('mounted', mountedHandler2)

    /** 模拟数据中心微任务在 mounted 前要求基座移除自身。 */
    function unmountTestApp5 (data: Record<string, unknown>) {
      if (data.unmountMeAsync === true) {
        appCon.removeChild(microAppElement5)
        microApp.removeDataListener('test-app5', unmountTestApp5)
      }
    }
    microApp.addDataListener('test-app5', unmountTestApp5)

    await new Promise((resolve) => {
      setTimeout(() => {
        // mounted 钩子不执行
        expect(mountedHandler1).not.toBeCalled()
        expect(mountedHandler2).not.toBeCalled()
        resolve(true)
      }, 200)
    })
  })

  /**
   * 场景：umd3 fixture 以 library=umd-app3、disableSandbox=true、destroy=true 挂载。
   * 等待普通 mounted 后断言真实 window 上的 umd-app3 导出存在，再移除宿主。
   * 当前版本不读取 library，禁用沙箱也不捕获 UMD 钩子；注释掉的导出删除断言不执行，实际验证仅为全局导出存在。
   */
  test('render umd app with disableSandbox & destroy', async () => {
    const microAppElement6 = document.createElement('micro-app')
    microAppElement6.setAttribute('name', 'test-app6')
    microAppElement6.setAttribute('library', 'umd-app3') // 自定义umd名称
    microAppElement6.setAttribute('url', `http://127.0.0.1:${ports.create_app}/umd3`)
    microAppElement6.setAttribute('disableSandbox', 'true')
    microAppElement6.setAttribute('destroy', 'true')

    appCon.appendChild(microAppElement6)

    await new Promise((resolve) => {
      microAppElement6.addEventListener('mounted', () => {
        // @ts-ignore
        expect(window['umd-app3']).not.toBeUndefined()
        appCon.removeChild(microAppElement6)
        // 当前销毁入口不删除无沙箱脚本写入的 umd-app3；这里保留旧断言作兼容待办。
        // expect(window['umd-app3']).toBeUndefined()
        resolve(true)
      })
    })
  })

  /**
   * 场景：umd3 默认导出含返回 Promise 的钩子，但名称放在 window['umd-app3']。
   * 先等第一次普通 mounted 与移除产生的 unmount，再创建同名同 URL 新宿主，等第二次 mounted。
   * 当前沙箱只捕获 window.mount/unmount 或 micro-app-${name}，此导出不被调用；本例以事件作为完成边界，没有验证 Promise 钩子等待。
   */
  test('promised mount & unmount', async () => {
    const microAppElement7 = document.createElement('micro-app')
    microAppElement7.setAttribute('name', 'test-app7')
    microAppElement7.setAttribute('library', 'umd-app3') // 自定义umd名称
    microAppElement7.setAttribute('url', `http://127.0.0.1:${ports.create_app}/umd3`)

    appCon.appendChild(microAppElement7)

    await new Promise((resolve) => {
      microAppElement7.addEventListener('mounted', () => {
        microAppElement7.addEventListener('unmount', () => {
          resolve(true)
        })
        appCon.removeChild(microAppElement7)
      })
    })

    // 新宿主复用同名实例；事件等待仍走普通脚本重执行，不执行 fixture 中未捕获的 Promise 钩子。
    const microAppElement8 = document.createElement('micro-app')
    microAppElement8.setAttribute('name', 'test-app7')
    microAppElement8.setAttribute('library', 'umd-app3') // 自定义umd名称
    microAppElement8.setAttribute('url', `http://127.0.0.1:${ports.create_app}/umd3`)

    appCon.appendChild(microAppElement8)

    await new Promise((resolve) => {
      microAppElement8.addEventListener('mounted', () => {
        resolve(true)
      })
    })
  })

  /**
   * 场景：specialUmdMode=error-hook 让 umd3 导出同步抛错的钩子，插入宿主后等 200ms。
   * 移除前后均断言同一个 console.error mock 曾被调用，没有清空记录或比较新增次数。
   * 导出仍在 umd-app3 键下而未被当前沙箱捕获，所以此测试正文不能证明 mount/unmount 同步抛错分支；全局 specialUmdMode 留给下一例覆盖。
   */
  test('throw error mount & unmount', async () => {
    const microAppElement9 = document.createElement('micro-app')
    microAppElement9.setAttribute('name', 'test-app9')
    microAppElement9.setAttribute('library', 'umd-app3') // 自定义umd名称
    microAppElement9.setAttribute('url', `http://127.0.0.1:${ports.create_app}/umd3`)

    // @ts-ignore
    window.specialUmdMode = 'error-hook'
    appCon.appendChild(microAppElement9)

    await new Promise((resolve) => {
      setTimeout(() => {
        // 检查此时日志 mock 已被调用。
        expect(jestConsoleError).toHaveBeenCalled()

        appCon.removeChild(microAppElement9)

        // 再次检查同一个 mock；没有清空记录或比较调用次数。
        expect(jestConsoleError).toHaveBeenCalled()
        resolve(true)
      }, 200);
    })
  })

  /**
   * 场景：specialUmdMode=error-promise-hook 让 umd3 生成返回拒绝 Promise 的钩子。
   * 宿主插入后等普通 mounted，再移除并等 unmount，最后删除模式开关。
   * 当前捕获规则不读取 umd-app3，两个钩子均未被执行；本例观察普通事件通道，没有等待或断言钩子的拒绝处理。
   */
  test('throw error promise mount & unmount', async () => {
    const microAppElement11 = document.createElement('micro-app')
    microAppElement11.setAttribute('name', 'test-app11')
    microAppElement11.setAttribute('library', 'umd-app3') // 自定义umd名称
    microAppElement11.setAttribute('url', `http://127.0.0.1:${ports.create_app}/umd3`)

    // @ts-ignore
    window.specialUmdMode = 'error-promise-hook'
    appCon.appendChild(microAppElement11)

    await new Promise((resolve) => {
      // 普通脚本执行结束后收到 mounted；fixture 内的钩子尚未被调用。
      microAppElement11.addEventListener('mounted', () => {
        // 移除宿主后收到普通卸载事件。
        microAppElement11.addEventListener('unmount', () => {
          resolve(true)
        })

        appCon.removeChild(microAppElement11)
      })
    })

    // @ts-ignore
    delete window.specialUmdMode
  })

  /**
   * 场景：依次创建显示、已卸载及 keep-alive 隐藏实例，通过 unmountApp 切换七种卸载策略。
   * 检查已卸载实例默认保留、destroy 删除；隐藏实例 clearAliveState 变 UNMOUNT 而仍留 Map；显示 destroy 删除并恢复 destroy/destory 原属性；普通 keep-alive 卸载进入 HIDDEN。
   * 隐藏 destroy 的删除断言被注释，实际只等待返回。不存在名称的警告保留旧文本预期，当前实现还附加“when unmountApp”，该断言与本版本不匹配。
   */
  test('test unmountApp method', async () => {
    // 场景1: 常规卸载操作
    const microAppElement12 = document.createElement('micro-app')
    microAppElement12.setAttribute('name', 'test-app12')
    microAppElement12.setAttribute('url', `http://127.0.0.1:${ports.create_app}/common`)

    appCon.appendChild(microAppElement12)

    await new Promise((resolve) => {
      microAppElement12.addEventListener('mounted', () => {
        unmountApp('test-app12').then(resolve)
      })
    })

    await new Promise((resolve) => {
      unmountApp('not-exist').then(() => {
        expect(jestConsoleWarn).toHaveBeenCalledWith('[micro-app] app not-exist does not exist')
        resolve(true)
      })
    })

    // 场景2: 卸载已经卸载的应用
    const microAppElement13 = document.createElement('micro-app')
    microAppElement13.setAttribute('name', 'test-app13')
    microAppElement13.setAttribute('url', `http://127.0.0.1:${ports.create_app}/common`)

    appCon.appendChild(microAppElement13)

    await new Promise((resolve) => {
      microAppElement13.addEventListener('mounted', () => {
        appCon.removeChild(microAppElement13)
      })

      // 应用已经卸载后执行unmountApp
      microAppElement13.addEventListener('unmount', () => {
        // 首次卸载不传 destroy，则直接返回，test-app13依然存在
        unmountApp('test-app13').then(() => {
          expect(appInstanceMap.has('test-app13')).toBeTruthy()
          // 第二次卸载设置destroy，应用被删除
          unmountApp('test-app13', {
            destroy: true,
          }).then(() => {
            expect(appInstanceMap.has('test-app13')).toBeFalsy()
            resolve(true)
          })
        })
      })
    })

    // 场景3: 卸载已经推入后台的keep-alive应用
    const microAppElement14 = document.createElement('micro-app')
    microAppElement14.setAttribute('name', 'test-app14')
    microAppElement14.setAttribute('url', `http://127.0.0.1:${ports.create_app}/common`)
    microAppElement14.setAttribute('keep-alive', 'true')

    appCon.appendChild(microAppElement14)

    await new Promise((resolve) => {
      microAppElement14.addEventListener('mounted', () => {
        appCon.removeChild(microAppElement14)
      })

      // 应用已隐藏后执行unmountApp
      microAppElement14.addEventListener('afterhidden', () => {
        // 首次卸载不传 destroy，则直接返回，test-app14安然无恙
        unmountApp('test-app14').then(() => {
          expect(appInstanceMap.has('test-app14')).toBeTruthy()
          // 第二次卸载设置clearAliveState，触发应用卸载操作，应用状态被清除
          unmountApp('test-app14', {
            clearAliveState: true,
          }).then(() => {
            expect(appInstanceMap.has('test-app14')).toBeTruthy()
            expect(appInstanceMap.get('test-app14')?.getAppState()).toBe(appStates.UNMOUNT)
            resolve(true)
          })
        })
      })
    })

    // 场景4：对已隐藏实例请求 destroy；以下只等待返回，Map 删除断言已被注释。
    const microAppElement15 = document.createElement('micro-app')
    microAppElement15.setAttribute('name', 'test-app15')
    microAppElement15.setAttribute('url', `http://127.0.0.1:${ports.create_app}/umd1`)
    microAppElement15.setAttribute('keep-alive', 'true')

    appCon.appendChild(microAppElement15)

    await new Promise((resolve) => {
      microAppElement15.addEventListener('mounted', () => {
        appCon.removeChild(microAppElement15)
      })

      // 应用已隐藏后执行unmountApp
      microAppElement15.addEventListener('afterhidden', () => {
        unmountApp('test-app15', {
          destroy: true,
        }).then(() => {
          // expect(appInstanceMap.has('test-app15')).toBeFalsy()
          resolve(true)
        })
      })
    })

    // 场景5: 强制删除正在运行的app
    const microAppElement16 = document.createElement('micro-app')
    microAppElement16.setAttribute('name', 'test-app16')
    microAppElement16.setAttribute('url', `http://127.0.0.1:${ports.create_app}/common`)
    microAppElement16.setAttribute('destroy', 'attr-of-destroy')
    microAppElement16.setAttribute('destory', 'attr-of-destory')

    appCon.appendChild(microAppElement16)

    await new Promise((resolve) => {
      microAppElement16.addEventListener('mounted', () => {
        unmountApp('test-app16', {
          destroy: true,
        }).then(() => {
          expect(appInstanceMap.has('test-app16')).toBeFalsy()
          expect(microAppElement16.getAttribute('destroy')).toBe('attr-of-destroy')
          expect(microAppElement16.getAttribute('destory')).toBe('attr-of-destory')
          resolve(true)
        })
      })
    })

    // 场景6: 卸载正在运行的keep-alive应用并清空状态
    const microAppElement17 = document.createElement('micro-app')
    microAppElement17.setAttribute('name', 'test-app17')
    microAppElement17.setAttribute('url', `http://127.0.0.1:${ports.create_app}/common`)
    microAppElement17.setAttribute('keep-alive', 'attr-of-keep-alive')

    appCon.appendChild(microAppElement17)

    await new Promise((resolve) => {
      microAppElement17.addEventListener('mounted', () => {
        unmountApp('test-app17', {
          clearAliveState: true,
        }).then(() => {
          expect(appInstanceMap.get('test-app17')?.getAppState()).toBe(appStates.UNMOUNT)
          expect(microAppElement17.getAttribute('keep-alive')).toBe('attr-of-keep-alive')
          resolve(true)
        })
      })
    })

    // 场景7: 正常卸载一个keep-alive应用，保留状态
    const microAppElement18 = document.createElement('micro-app')
    microAppElement18.setAttribute('name', 'test-app18')
    microAppElement18.setAttribute('url', `http://127.0.0.1:${ports.create_app}/common`)
    microAppElement18.setAttribute('keep-alive', 'true')

    appCon.appendChild(microAppElement18)

    await new Promise((resolve) => {
      microAppElement18.addEventListener('mounted', () => {
        unmountApp('test-app18').then(() => {
          expect(appInstanceMap.get('test-app18')?.getKeepAliveState()).toBe(keepAliveStates.KEEP_ALIVE_HIDDEN)
          resolve(true)
        })
      })
    })
  })

  /**
   * 场景：新应用宿主含 destroy=true，等 mounted 后调用 unmountAllApps。
   * 等待名称快照的串行卸载链完成，再断言 test-app19 已从 Map 删除。
   * 验证该宿主的 destroy 配置经元素断开生效；没有检查全部条目均删除、调用顺序或各项返回值。
   */
  test('test unmountAllApps method', async () => {
    const microAppElement19 = document.createElement('micro-app')
    microAppElement19.setAttribute('name', 'test-app19')
    microAppElement19.setAttribute('url', `http://127.0.0.1:${ports.create_app}/common`)
    microAppElement19.setAttribute('destroy', 'true')

    appCon.appendChild(microAppElement19)

    await new Promise((resolve) => {
      microAppElement19.addEventListener('mounted', () => {
        unmountAllApps().then(() => {
          expect(appInstanceMap.has('test-app19')).toBeFalsy()
          resolve(true)
        })
      })
    })
  })

  /**
   * 场景：前序场景保留若干注册实例，调用 unmountAllApps({destroy:true})。
   * 在其 then 回调内断言 getActiveApps 长度为 0，目标是销毁批次后没有活跃实例。
   * 测试函数没有 return/await 该 Promise，Jest 的本例完成早于异步断言边界；不把它写成已等待销毁完成。
   */
  test('test getActiveApps method', async () => {
    unmountAllApps({
      destroy: true,
    }).then(() => {
      expect(getActiveApps().length).toBe(0)
    })
  })
})
