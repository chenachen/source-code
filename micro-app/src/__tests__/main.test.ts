/* eslint-disable promise/param-names, no-console */
import {
  commonStartEffect,
  releaseAllEffect,
  ports,
  jestConsoleWarn,
  jestConsoleError,
} from './common/initial'
import microApp, {
  preFetch,
  removeDomScope,
  version,
  pureCreateElement,
  EventCenterForMicroApp,
  getActiveApps,
  getAllApps,
} from '..'
import { appInstanceMap } from '../create_app'
import { getCurrentAppName, defer } from '../libs/utils'

/** 集成场景共用单例、注册表及 fixture 服务；以下用例按前序留下的实例和数据继续操作，Jest clearMocks 仅重置每例的 mock 调用记录。 */

describe('main process', () => {
  // 根容器
  let appCon: Element
  beforeAll(() => {
    commonStartEffect(ports.main)
    appCon = document.querySelector('#app-container')!
    console.log(version, pureCreateElement('div'))
    console.log(new EventCenterForMicroApp('app-name'))

    microApp.start({
      tagName: 'micro-app',
      // shadowDOM: true,
      // inline: true,
      // destroy: true,
      // disableScopecss: true,
      // disableSandbox: true,
      lifeCycles: {
        // created () {
        //   console.log('created 全局监听')
        // },
        // beforemount () {
        //   console.log('beforemount 全局监听')
        // },
        /** 占位全局 mounted 钩子，用于覆盖全局生命周期配置注册分支。 */
        mounted () {
          // console.log('mounted 全局监听')
        },
        // unmount () {
        //   console.log('unmount 全局监听')
        // },
        // error () {
        //   console.log('error 全局监听')
        // }
      },
      plugins: {
        // global: [{
        //   scopeProperties: ['1', '2'],
        //   escapeProperties: ['a', 'b'],
        //   options: { a: 1 },
        //   loader (code, _url, _options) {
        //     console.log('全局插件', _url)
        //     return code
        //   }
        // }],
        modules: {
          test1: [{
            scopeProperties: ['3', '4'],
            escapeProperties: ['c', 'd'],
            /** 为模块名 test1 提供恒等脚本转换；下面运行的名称是 test-app*，没有断言此插件实际被选中。 */
            loader (code, _url) {
              // console.log('test1插件', _url)
              return code
            }
          }],
          test2: [{
            scopeProperties: ['5', '6'],
            escapeProperties: ['e', 'f'],
            /** 为模块名 test2 提供另一组配置和恒等转换；该配置项没有对应的直接用例断言。 */
            loader (code, _url) {
              // console.log('test2插件', _url)
              return code
            }
          }]
        }
      },
      /** 空闲调度时才返回预取列表：一个关闭隔离的有效入口，以及空 URL 会被跳过的配置。 */
      preFetchApps: function () {
        return [
          {
            name: 'test-app5',
            url: `http://127.0.0.1:${ports.main}/ssr-render`,
            disableScopecss: true,
            disableSandbox: true,
          },
          {
            name: 'app-test-error',
            url: '',
          }
        ]
      },
      // globalAssets 测试分支覆盖
      globalAssets: 'xxx' as any,
    })

    // 预加载默认延迟3s执行
    preFetch([{
      name: 'test-app3',
      url: `http://127.0.0.1:${ports.main}/common`,
      // disableScopecss: xx,
      // disableSandbox: xx,
      // shadowDOM: true,
    }])
  })

  afterAll(() => {
    return releaseAllEffect()
  })

  /**
   * 场景：此前未注册 test-app1，以 common HTML 和 inline 脚本模式创建宿主并等待 mounted。
   * 随后移除同一元素，等待 unmount；分别断言 mounted 回调中的活跃表包含它、unmount 回调中已排除它。
   * 验证状态查询随挂载/卸载变化；getActiveApps 在 LOADING 时也可计入，本例没有断言“仅 mounted 期间活跃”。
   */
  test('main process of micro-app', async () => {
    const microAppElement1 = document.createElement('micro-app')
    microAppElement1.setAttribute('name', 'test-app1')
    microAppElement1.setAttribute('url', `http://127.0.0.1:${ports.main}/common`)
    microAppElement1.setAttribute('inline', 'true')

    appCon.appendChild(microAppElement1)

    await new Promise((resolve) => {
      microAppElement1.addEventListener('mounted', () => {
        expect(getActiveApps().includes('test-app1')).toBeTruthy()
        resolve(true)
      }, false)
    })

    await new Promise((resolve) => {
      microAppElement1.addEventListener('unmount', () => {
        expect(getActiveApps().includes('test-app1')).toBeFalsy()
        defer(() => {
          resolve(true)
        })
      }, false)

      appCon.removeChild(microAppElement1)
    })

    removeDomScope()
  })

  /**
   * 场景：前例已 removeDomScope，先断言当前 DOM 归属名为空，再用 iframe 模式挂载 ssr-render 应用。
   * mounted 到达时检查 getAllApps 至少有一个条目，保留宿主到套件清理。
   * 验证 iframe 路径能完成该挂载并留下注册实例；本例未断言整个后续期间始终 active。
   */
  test('app that stay active all the time', async () => {
    expect(getCurrentAppName()).toBeNull()
    const microAppElement2 = document.createElement('micro-app')
    microAppElement2.setAttribute('name', 'test-app2')
    microAppElement2.setAttribute('url', `http://127.0.0.1:${ports.main}/ssr-render`)
    microAppElement2.setAttribute('iframe', 'true')

    appCon.appendChild(microAppElement2)

    await new Promise((resolve) => {
      microAppElement2.addEventListener('mounted', () => {
        expect(getAllApps().length).toBeGreaterThan(0)
        resolve(true)
      }, false)
    })
  })

  /**
   * 场景：未命名元素先缓存两次对象 data，再给 name/url、inline 和 destroy 属性并挂载。
   * 首次 mounted 后延时把 name/url 一起改为已卸载 test-app1 的新入口，第二次 mounted 断言 Map 大小为 2；移除后在微任务中断言大小为 1。
   * 验证未命名数据读取、属性合并切换及 destroy 后注册数量；数量依赖前例遗留实例。setAttribute 的第三个回调参数当前不被接收，其中断言不会执行。
   */
  test('render an unstable app with special attribute', async () => {
    const microAppElement3 = document.createElement('micro-app') as any
    expect(microAppElement3.data).toBeNull()
    // @ts-ignore
    microAppElement3.setAttribute('data', { count: 'count-1' })
    expect(microAppElement3.data.count).toBe('count-1')
    microAppElement3.setAttribute('name', 'test-app3')
    microAppElement3.setAttribute('url', `http://127.0.0.1:${ports.main}/common`)
    microAppElement3.setAttribute('destroy', 'true')
    // TODO: shadowDOM 待补充
    // microAppElement3.setAttribute('shadowDOM', 'true')
    microAppElement3.setAttribute('inline', 'true')
    // @ts-ignore
    microAppElement3.setAttribute('data', { count: 'count-2' }, () => {
      expect(microAppElement3.data.count).toBe('count-2')
    })
    let mountCount = 0

    appCon.appendChild(microAppElement3)

    await new Promise((resolve) => {
      microAppElement3.addEventListener('mounted', () => {
        mountCount++
        if (mountCount === 1) {
          setTimeout(() => {
            // 修改name、url，test-app3被彻底删除
            microAppElement3.setAttribute('name', 'test-app1')
            microAppElement3.setAttribute('url', `http://127.0.0.1:${ports.main}/ssr-render`)
          }, 500)
        } else {
          // 此时存在的应用为：test-app1, test-app2
          expect(appInstanceMap.size).toBe(2)
          resolve(true)
        }
      }, false)
    })

    await new Promise((resolve) => {
      microAppElement3.addEventListener('unmount', () => {
        defer(() => {
          // test-app1也被删除，只剩下test-app2
          expect(appInstanceMap.size).toBe(1)
          resolve(true)
        })
      }, false)

      appCon.removeChild(microAppElement3)
    })
  })

  /**
   * 场景：给新宿主配置无法获取的 HTML 入口，先装 error 监听再插入 DOM。
   * 等待 error 后核对带应用名、规范化入口和 Error 对象的完整 console.error 参数。
   * 验证 HTMLLoader 请求链失败转到 onLoadError 的日志和宿主事件；本例不检查 loadSourceLevel 或最终实例状态。
   */
  test('failed to fetch html', async () => {
    const microAppElement4 = document.createElement('micro-app')
    microAppElement4.setAttribute('name', 'test-app4')
    microAppElement4.setAttribute('url', 'http://not-exist.com/xx')

    await new Promise((resolve) => {
      microAppElement4.addEventListener('error', () => {
        expect(jestConsoleError).toHaveBeenCalledWith('[micro-app] app test-app4: Failed to fetch data from http://not-exist.com/xx/, micro-app stop rendering', expect.any(Error))
        resolve(true)
      }, false)
      appCon.appendChild(microAppElement4)
    })
  })

  /**
   * 场景：umd1 脚本在沙箱内写成对 window.mount/unmount，并安装 window/document 监听。
   * 第一次 mounted 时派发两种事件、检查对应警告再移除；重新插入并等第二次 mounted，再派发并检查同样日志。
   * 观察 UMD 重挂载后的事件回调；两阶段没有清空 mock 或比较次数，所以断言只证明日志曾出现，不单独证明每个监听已释放再恢复。
   */
  test('mount and remount umd app ', async () => {
    const microAppElement6 = document.createElement('micro-app')
    microAppElement6.setAttribute('name', 'test-app6')
    microAppElement6.setAttribute('url', `http://127.0.0.1:${ports.main}/umd1`)

    // microAppElement6.addEventListener('unmount', function () {
    //   setTimeout(() => {
    //     appCon.appendChild(microAppElement6)
    //   }, 1000);
    // })

    await new Promise((resolve) => {
      /** 首次 mounted 时派发 window/document 事件，再移除元素并准备第二次挂载。 */
      function firstMountHandler () {
        window.dispatchEvent(new CustomEvent('umd-window-event'))
        expect(jestConsoleWarn).toHaveBeenCalledWith('umd-window-event is triggered')
        document.dispatchEvent(new CustomEvent('click'))
        expect(jestConsoleWarn).toHaveBeenCalledWith('click event from umd init env')
        microAppElement6.removeEventListener('mounted', firstMountHandler)
        appCon.removeChild(microAppElement6)
        resolve(true)
      }

      microAppElement6.addEventListener('mounted', firstMountHandler)
      appCon.appendChild(microAppElement6)
    })

    await new Promise((resolve) => {
      microAppElement6.addEventListener('mounted', () => {
        window.dispatchEvent(new CustomEvent('umd-window-event'))
        expect(jestConsoleWarn).toHaveBeenCalledWith('umd-window-event is triggered')
        document.dispatchEvent(new CustomEvent('click'))
        expect(jestConsoleWarn).toHaveBeenCalledWith('click event from umd init env')
        resolve(true)
      })
      // 再次渲染
      appCon.appendChild(microAppElement6)
    })
  })

  /**
   * 场景：同一 umd1 fixture 禁用沙箱，两次插入元素并分别等待普通模式 mounted。
   * 两次都派发 umd-window-event，检查相应警告；第一次随后移除，第二次保留到清理。
   * 无沙箱不识别 UMD setter、不建立 effect 快照，脚本按普通路径重执行；共用 mock 的“曾调用”断言不验证第二次新增次数。
   */
  test('render umd app with disableSandbox', async () => {
    const microAppElement7 = document.createElement('micro-app')
    microAppElement7.setAttribute('name', 'test-app7')
    microAppElement7.setAttribute('url', `http://127.0.0.1:${ports.main}/umd1`)
    microAppElement7.setAttribute('disableSandbox', 'true')

    await new Promise((resolve) => {
      /** 首次无沙箱 mounted 时派发事件，再移除元素并安排重挂载。 */
      function firstMountHandler () {
        window.dispatchEvent(new CustomEvent('umd-window-event'))
        expect(jestConsoleWarn).toHaveBeenCalledWith('umd-window-event is triggered')
        microAppElement7.removeEventListener('mounted', firstMountHandler)
        appCon.removeChild(microAppElement7)
        resolve(true)
      }

      microAppElement7.addEventListener('mounted', firstMountHandler)
      appCon.appendChild(microAppElement7)
    })

    await new Promise((resolve) => {
      microAppElement7.addEventListener('mounted', () => {
        window.dispatchEvent(new CustomEvent('umd-window-event'))
        expect(jestConsoleWarn).toHaveBeenCalledWith('umd-window-event is triggered')
        resolve(true)
      })
      // 再次渲染
      appCon.appendChild(microAppElement7)
    })
  })

  /**
    * 已停用的历史场景：清空宿主容器触发所有显示元素断开，再检查注册表大小。
    * 以下 test 整体被注释，未注册为 Jest 用例；固定数量依赖当时的预取和 UMD 保留规则，不计入当前可注册用例清单。
   * 卸载前：appInstanceMap => [
   *  {name: 'test-app2'},
   *  {name: 'test-app6'},
   *  {name: 'test-app7'},
   * ]
   */
  // test('clear all apps', () => {
  //   appCon.innerHTML = ''
  //   // test-app5为预加载，test-app2不强制删除，所以卸载后还有2个应用
  //   expect(appInstanceMap.size).toBe(3)
  // })
})
